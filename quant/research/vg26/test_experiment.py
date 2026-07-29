from __future__ import annotations

import hashlib
import json
import zipfile
from collections.abc import Mapping
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from pathlib import Path

import pytest
from research.vg26 import experiment as vg26


def _timestamp_us(day: date) -> int:
    opened = datetime(day.year, day.month, day.day, tzinfo=UTC)
    return int(opened.timestamp()) * 1_000_000


def _bar(
    symbol: str,
    day: date,
    *,
    open_price: Decimal | str = "100",
    close_price: Decimal | str | None = None,
    quote_volume: Decimal | str = "1000",
) -> vg26.Bar:
    opened = _timestamp_us(day)
    open_value = Decimal(open_price)
    close_value = open_value if close_price is None else Decimal(close_price)
    high = max(open_value, close_value) + Decimal(1)
    low = min(open_value, close_value) - Decimal(1)
    return vg26.Bar(
        symbol=symbol,
        day=day,
        open=open_value,
        high=high,
        low=low,
        close=close_value,
        base_volume=Decimal(1),
        quote_volume=Decimal(quote_volume),
        open_time_us=opened,
        close_time_us=opened + 86_400_000_000 - 1,
    )


def _cohort_bars(
    start: date,
    end_exclusive: date,
) -> dict[str, dict[date, vg26.Bar]]:
    return {
        symbol: {day: _bar(symbol, day) for day in vg26.date_range(start, end_exclusive)}
        for symbol in vg26.COHORT
    }


def _correlated_cohort(
    open_day: date,
    *,
    lookback_days: int = 3,
    inverse_volume: bool = False,
) -> dict[str, dict[date, vg26.Bar]]:
    history_start = open_day - timedelta(days=lookback_days + 1)
    bars = _cohort_bars(history_start, open_day + timedelta(days=1))
    closes = (Decimal("100"), Decimal("110"), Decimal("132"), Decimal("171.6"))
    volumes = closes if not inverse_volume else tuple(reversed(closes))
    for symbol in vg26.COHORT:
        for offset, (close, volume) in enumerate(
            zip(closes, volumes, strict=True),
        ):
            day = history_start + timedelta(days=offset)
            bars[symbol][day] = _bar(
                symbol,
                day,
                close_price=close,
                quote_volume=volume,
            )
    return bars


def _scenario(
    days: tuple[date, ...],
    values: tuple[Decimal, ...],
    *,
    benchmark_values: tuple[Decimal, ...] | None = None,
    capacities: tuple[Decimal, ...] = (),
    on_days: int | None = None,
) -> vg26.ScenarioPath:
    benchmark_returns = values if benchmark_values is None else benchmark_values
    excess_returns = tuple(
        value - benchmark for value, benchmark in zip(values, benchmark_returns, strict=True)
    )
    equity = [vg26.STARTING_NOTIONAL_USD]
    benchmark_equity = [vg26.STARTING_NOTIONAL_USD]
    for value, benchmark in zip(values, benchmark_returns, strict=True):
        equity.append(equity[-1] * (Decimal(1) + value))
        benchmark_equity.append(
            benchmark_equity[-1] * (Decimal(1) + benchmark),
        )
    active_days = len(values) if on_days is None else on_days
    return vg26.ScenarioPath(
        ending_days=days,
        daily_returns=values,
        benchmark_daily_returns=benchmark_returns,
        excess_daily_returns=excess_returns,
        equity_at_open=tuple(equity),
        benchmark_equity_at_open=tuple(benchmark_equity),
        regime_scores=tuple(Decimal(0) for _day in days),
        transition_legs=len(capacities),
        on_days=active_days,
        off_days=len(values) - active_days,
        transition_capacity_proxy_usd=capacities,
    )


def _evaluation(
    trial: vg26.Trial,
    days: tuple[date, ...],
    value: Decimal,
) -> vg26.DevelopmentEvaluation:
    returns = tuple(value for _day in days)
    benchmark_returns = tuple(Decimal(0) for _day in days)
    scenario = _scenario(days, returns, benchmark_values=benchmark_returns)
    paths = vg26.TrialPaths(
        trial=trial,
        gross=scenario,
        base=scenario,
        stress=scenario,
    )
    bootstrap = vg26.BootstrapSummary(
        mean=value,
        one_sided_95_lcb=value,
        two_sided_90_ucb=value,
        one_sided_p_value=Decimal("0.5"),
    )
    return vg26.DevelopmentEvaluation(
        paths=paths,
        absolute_bootstrap=bootstrap,
        excess_bootstrap=bootstrap,
        fold_returns=(value, value, value, value, value),
        fold_excess_returns=(value, value, value, value, value),
        max_drawdown=Decimal(0),
        base_total_return=vg26.compound_return(returns),
        benchmark_total_return=Decimal(0),
        base_excess_return=vg26.compound_return(returns),
        stress_mean=value,
        capacity_proxy_usd=None,
        holm_adjusted_p=Decimal(1),
        gates={},
    )


def _csv_row(
    day: date,
    *,
    open_time_delta_us: int = 0,
    close_time_delta_us: int = 0,
    field_overrides: Mapping[int, str] | None = None,
) -> str:
    opened = _timestamp_us(day) + open_time_delta_us
    closed = opened + 86_400_000_000 - 1 + close_time_delta_us
    fields = [
        str(opened),
        "100",
        "101",
        "99",
        "100",
        "10",
        str(closed),
        "1000",
        "7",
        "5",
        "500",
        "0",
    ]
    for index, value in (field_overrides or {}).items():
        fields[index] = value
    return ",".join(fields)


def _archive_artifact(
    root: Path,
    rows: list[str],
    *,
    symbol: str = "BTCUSDT",
    month: str = "2025-07",
) -> dict[str, object]:
    directory = root / "archives" / symbol / month
    directory.mkdir(parents=True)
    zip_name = f"{symbol}-1d-{month}.zip"
    zip_path = directory / zip_name
    with zipfile.ZipFile(zip_path, "w") as archive:
        archive.writestr(
            zip_name.removesuffix(".zip") + ".csv",
            ",".join(vg26.KLINE_HEADER) + "\n" + "\n".join(rows) + "\n",
        )
    zip_sha = hashlib.sha256(zip_path.read_bytes()).hexdigest()
    checksum_path = directory / f"{zip_name}.CHECKSUM"
    checksum_path.write_text(f"{zip_sha}  {zip_name}\n", encoding="ascii")
    return {
        "checksumPath": str(checksum_path.relative_to(root)),
        "checksumSha256": hashlib.sha256(checksum_path.read_bytes()).hexdigest(),
        "month": month,
        "symbol": symbol,
        "zipPath": str(zip_path.relative_to(root)),
        "zipSha256": zip_sha,
    }


def test_trial_grid_is_exact_frozen_family_of_twelve() -> None:
    trials = vg26.trial_grid()
    assert tuple(trial.trial_id for trial in trials) == (
        "vg26-l20-r0000",
        "vg26-l20-r1000",
        "vg26-l20-r2000",
        "vg26-l20-r3000",
        "vg26-l40-r0000",
        "vg26-l40-r1000",
        "vg26-l40-r2000",
        "vg26-l40-r3000",
        "vg26-l60-r0000",
        "vg26-l60-r1000",
        "vg26-l60-r2000",
        "vg26-l60-r3000",
    )
    assert {(trial.lookback_days, trial.correlation_threshold) for trial in trials} == {
        (lookback, threshold)
        for lookback in (20, 40, 60)
        for threshold in (
            Decimal("0.00"),
            Decimal("0.10"),
            Decimal("0.20"),
            Decimal("0.30"),
        )
    }


def test_average_ranks_are_one_based_and_use_exact_tie_averages() -> None:
    assert vg26.average_ranks(
        (Decimal(30), Decimal(10), Decimal(20), Decimal(20)),
    ) == (Decimal(4), Decimal(1), Decimal("2.5"), Decimal("2.5"))


def test_spearman_correlation_reports_exact_positive_and_negative_one() -> None:
    increasing = (Decimal(1), Decimal(2), Decimal(3), Decimal(4))
    assert vg26.spearman_correlation(increasing, increasing) == Decimal(1)
    assert vg26.spearman_correlation(increasing, tuple(reversed(increasing))) == Decimal(-1)
    with pytest.raises(vg26.VG26Error, match="constant input"):
        vg26.spearman_correlation(increasing, (Decimal(1),) * 4)


def test_regime_score_is_cross_symbol_median_of_lagged_correlations() -> None:
    open_day = date(2025, 8, 1)
    bars = _correlated_cohort(open_day)
    inverse_symbols = vg26.COHORT[:5]
    for symbol in inverse_symbols:
        negative = _correlated_cohort(open_day, inverse_volume=True)[symbol]
        bars[symbol].update(negative)
    trial = vg26.Trial("median", 3, Decimal("0.5"))
    assert vg26.regime_score_at_open(bars, trial, open_day) == Decimal(1)
    assert vg26.target_at_open(bars, trial, open_day)


def test_causal_signal_uses_completed_day_and_excludes_target_open() -> None:
    open_day = date(2025, 8, 1)
    bars = _correlated_cohort(open_day)
    trial = vg26.Trial("causal", 3, Decimal("0.5"))
    score = vg26.regime_score_at_open(bars, trial, open_day)
    for symbol in vg26.COHORT:
        bars[symbol][open_day] = _bar(
            symbol,
            open_day,
            close_price="0.000001",
            quote_volume="999999999999",
        )
    assert vg26.regime_score_at_open(bars, trial, open_day) == score


def test_longest_lookback_first_eligible_open_needs_no_pre_january_or_target_bar() -> None:
    history_start = date(2025, 1, 1)
    open_day = date(2025, 3, 3)
    bars = _cohort_bars(history_start, open_day + timedelta(days=1))
    for symbol in vg26.COHORT:
        for offset, day in enumerate(vg26.date_range(history_start, open_day + timedelta(days=1))):
            value = Decimal((offset + 10) ** 2)
            bars[symbol][day] = _bar(
                symbol,
                day,
                close_price=value,
                quote_volume=value,
            )
        del bars[symbol][open_day]
    assert open_day == vg26.DEVELOPMENT_START
    assert min(min(by_day) for by_day in bars.values()) == history_start
    assert vg26.regime_score_at_open(
        bars,
        vg26.Trial("l60-first-eligible", 60, Decimal(0)),
        open_day,
    ) == Decimal(1)


def test_whole_cohort_units_do_not_rebalance_while_regime_stays_on() -> None:
    first = {symbol: Decimal(100) for symbol in vg26.COHORT}
    later = {symbol: Decimal(200 + index) for index, symbol in enumerate(vg26.COHORT)}
    portfolio = vg26.Portfolio(cash=vg26.STARTING_NOTIONAL_USD)
    assert vg26.transition_at_open(portfolio, True, first, Decimal(0))
    assert portfolio.units is not None
    frozen_units = dict(portfolio.units)
    assert not vg26.transition_at_open(portfolio, True, later, Decimal(0))
    assert portfolio.units == frozen_units
    assert set(portfolio.units) == set(vg26.COHORT)


def test_entry_and_exit_costs_match_identical_always_on_benchmark(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    start = date(2025, 8, 1)
    bars = _cohort_bars(start, start + timedelta(days=3))
    for symbol in vg26.COHORT:
        bars[symbol][start + timedelta(days=1)] = _bar(
            symbol,
            start + timedelta(days=1),
            open_price="110",
        )
        bars[symbol][start + timedelta(days=2)] = _bar(
            symbol,
            start + timedelta(days=2),
            open_price="110",
        )
    monkeypatch.setattr(
        vg26,
        "regime_score_at_open",
        lambda _bars, _trial, _day: Decimal(1),
    )
    monkeypatch.setattr(
        vg26,
        "capacity_at_open",
        lambda _bars, _day: Decimal("4321"),
    )
    path = vg26.simulate_scenario(
        bars,
        vg26.Trial("test", 20, Decimal("0.5")),
        start,
        start + timedelta(days=3),
        Decimal("0.02"),
    )
    expected = Decimal(1000) / Decimal("1.02") * Decimal("1.10") * Decimal("0.98")
    assert path.transition_legs == 2
    assert path.transition_capacity_proxy_usd == (Decimal("4321"), Decimal("4321"))
    assert path.equity_at_open[-1] == expected
    assert path.benchmark_equity_at_open[-1] == expected
    assert path.excess_daily_returns == (Decimal(0), Decimal(0))


def test_cash_regime_is_measured_against_always_on_cohort_benchmark(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    start = date(2025, 8, 1)
    bars = _cohort_bars(start, start + timedelta(days=3))
    for symbol in vg26.COHORT:
        bars[symbol][start + timedelta(days=1)] = _bar(
            symbol,
            start + timedelta(days=1),
            open_price="110",
        )
        bars[symbol][start + timedelta(days=2)] = _bar(
            symbol,
            start + timedelta(days=2),
            open_price="110",
        )
    monkeypatch.setattr(
        vg26,
        "regime_score_at_open",
        lambda _bars, _trial, _day: Decimal(-1),
    )
    path = vg26.simulate_scenario(
        bars,
        vg26.Trial("cash", 20, Decimal(0)),
        start,
        start + timedelta(days=3),
        Decimal(0),
    )
    assert path.equity_at_open[-1] == vg26.STARTING_NOTIONAL_USD
    assert abs(path.benchmark_equity_at_open[-1] - Decimal("1100")) < Decimal("1e-40")
    assert vg26.compound_return(path.daily_returns) == Decimal(0)
    assert abs(vg26.compound_return(path.benchmark_daily_returns) - Decimal("0.10")) < Decimal(
        "1e-40"
    )
    assert sum(path.excess_daily_returns, Decimal(0)) < 0


def test_segment_boundary_forces_final_liquidation_even_when_score_is_on(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    start = date(2025, 8, 1)
    end = start + timedelta(days=4)
    bars = _cohort_bars(start, end)
    calls: list[date] = []

    def always_on(
        _bars: Mapping[str, Mapping[date, vg26.Bar]],
        _trial: vg26.Trial,
        day: date,
    ) -> Decimal:
        calls.append(day)
        return Decimal(1)

    monkeypatch.setattr(vg26, "regime_score_at_open", always_on)
    monkeypatch.setattr(
        vg26,
        "capacity_at_open",
        lambda _bars, _day: Decimal("1000"),
    )
    path = vg26.simulate_scenario(
        bars,
        vg26.Trial("test", 20, Decimal("0.5")),
        start,
        end,
        Decimal(0),
    )
    assert calls == list(vg26.date_range(start, end))
    assert path.transition_legs == 2
    assert path.on_days == 3
    assert path.off_days == 0
    assert abs(path.equity_at_open[-1] - vg26.STARTING_NOTIONAL_USD) < Decimal("1e-40")


def test_marked_open_drawdown_includes_immediate_entry_cost_trough() -> None:
    recovery_return = Decimal("1010") / Decimal("980") - Decimal(1)
    path = vg26.ScenarioPath(
        ending_days=(date(2025, 8, 2),),
        daily_returns=(recovery_return,),
        benchmark_daily_returns=(recovery_return,),
        excess_daily_returns=(Decimal(0),),
        equity_at_open=(Decimal("980"), Decimal("1010")),
        benchmark_equity_at_open=(Decimal("980"), Decimal("1010")),
        regime_scores=(Decimal(1),),
        transition_legs=2,
        on_days=1,
        off_days=0,
        transition_capacity_proxy_usd=(Decimal("1000"), Decimal("1000")),
    )
    return_only_equity = Decimal(1) + recovery_return
    return_only_drawdown = max(
        Decimal(0),
        Decimal(1) - return_only_equity / max(Decimal(1), return_only_equity),
    )
    assert return_only_drawdown == Decimal(0)
    assert vg26.marked_open_drawdown(path) == Decimal("0.02")


def test_capacity_is_twelve_times_lagged_least_constituent_median_one_bp() -> None:
    open_day = date(2025, 8, 1)
    bars = _cohort_bars(open_day - timedelta(days=30), open_day + timedelta(days=1))
    least_symbol = vg26.COHORT[-1]
    for day in vg26.date_range(open_day - timedelta(days=30), open_day):
        bars[least_symbol][day] = _bar(
            least_symbol,
            day,
            quote_volume="500",
        )
    bars[least_symbol][open_day] = _bar(
        least_symbol,
        open_day,
        quote_volume="999999999999",
    )
    assert vg26.capacity_at_open(bars, open_day) == Decimal("0.6")


@pytest.mark.parametrize(
    ("payload", "message"),
    [
        (b"a" * 64 + b"  TEST.zip\nextra", "invalid grammar"),
        (b"A" * 64 + b"  TEST.zip\n", "invalid grammar"),
        (b"a" * 63 + b"  TEST.zip\n", "invalid grammar"),
        (b"\xff" + b"a" * 64 + b"  TEST.zip\n", "not ASCII"),
    ],
)
def test_checksum_grammar_fails_closed(payload: bytes, message: str) -> None:
    with pytest.raises(vg26.VG26Error, match=message):
        vg26.verify_checksum_text(payload, "TEST.zip", "a" * 64)


def test_timestamp_requires_microseconds_and_exact_utc_midnight() -> None:
    with pytest.raises(vg26.VG26Error, match="microsecond"):
        vg26.parse_timestamp_us("1751328000000", field="openTime")
    value, parsed = vg26.parse_timestamp_us(
        str(_timestamp_us(date(2025, 7, 1))),
        field="openTime",
    )
    assert value == _timestamp_us(date(2025, 7, 1))
    assert parsed == datetime(2025, 7, 1, tzinfo=UTC)


def test_valid_archive_schema_parses_all_calendar_days(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    rows = [_csv_row(day) for day in vg26.date_range(date(2025, 7, 1), date(2025, 8, 1))]
    artifact = _archive_artifact(tmp_path, rows)
    monkeypatch.setattr(vg26, "SOURCE_ROOT", tmp_path)
    parsed = vg26.parse_archive(artifact)
    assert len(parsed) == 31
    assert parsed[0].day == date(2025, 7, 1)
    assert parsed[-1].day == date(2025, 7, 31)
    assert parsed[0].quote_volume == Decimal(1000)


@pytest.mark.parametrize(
    ("rows", "message"),
    [
        (
            [_csv_row(day) for day in vg26.date_range(date(2025, 7, 1), date(2025, 8, 1))][:-1],
            "calendar gap",
        ),
        (
            [_csv_row(day) for day in vg26.date_range(date(2025, 7, 1), date(2025, 8, 1))]
            + [_csv_row(date(2025, 7, 1))],
            "duplicate UTC daily rows",
        ),
        (
            [_csv_row(date(2025, 7, 1), close_time_delta_us=1)]
            + [_csv_row(day) for day in vg26.date_range(date(2025, 7, 2), date(2025, 8, 1))],
            "close boundary",
        ),
        (
            [_csv_row(date(2025, 7, 1), open_time_delta_us=1)]
            + [_csv_row(day) for day in vg26.date_range(date(2025, 7, 2), date(2025, 8, 1))],
            "UTC daily open",
        ),
        (
            [_csv_row(date(2025, 7, 1), field_overrides={7: "0"})]
            + [_csv_row(day) for day in vg26.date_range(date(2025, 7, 2), date(2025, 8, 1))],
            "positive-volume bounds",
        ),
        (
            [_csv_row(date(2025, 7, 1), field_overrides={2: "98"})]
            + [_csv_row(day) for day in vg26.date_range(date(2025, 7, 2), date(2025, 8, 1))],
            "OHLC",
        ),
    ],
)
def test_archive_schema_and_continuity_fail_closed(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    rows: list[str],
    message: str,
) -> None:
    artifact = _archive_artifact(tmp_path, rows)
    monkeypatch.setattr(vg26, "SOURCE_ROOT", tmp_path)
    with pytest.raises(vg26.VG26Error, match=message):
        vg26.parse_archive(artifact)


def test_seeded_centered_circular_bootstrap_is_deterministic(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(vg26, "BOOTSTRAP_REPLICATES", 64)
    monkeypatch.setattr(vg26, "BOOTSTRAP_BLOCK_DAYS", 2)
    returns = tuple(Decimal("0.01") for _index in range(14))
    first = vg26.circular_block_bootstrap(returns, seed=17)
    second = vg26.circular_block_bootstrap(returns, seed=17)
    assert first == second
    assert first.mean == Decimal("0.01")
    assert first.one_sided_95_lcb == Decimal("0.01")
    assert first.one_sided_p_value == Decimal(1) / Decimal(65)


def test_development_inference_serializes_distinct_absolute_and_excess_seeds() -> None:
    days = tuple(date.fromisoformat(f"{month}-15") for month in vg26.DEVELOPMENT_MONTHS)
    mapping = vg26.evaluation_mapping(_evaluation(vg26.trial_grid()[0], days, Decimal("0.001")))
    inference = mapping["inference"]
    assert isinstance(inference, dict)
    absolute = inference["absoluteBase"]
    excess = inference["excessVsAlwaysOn"]
    assert isinstance(absolute, dict)
    assert isinstance(excess, dict)
    assert "seed" not in inference
    assert absolute["seed"] == vg26.BOOTSTRAP_SEED
    assert excess["seed"] == vg26.BOOTSTRAP_SEED + 10_000


def test_holdout_analysis_uses_and_serializes_distinct_frozen_seeds(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    days = tuple(date.fromisoformat(f"{month}-15") for month in vg26.HOLDOUT_MONTHS)
    returns = (Decimal("0.001"), Decimal("0.002"), Decimal("0.003"))
    benchmark = (Decimal(0), Decimal(0), Decimal(0))
    scenario = _scenario(
        days,
        returns,
        benchmark_values=benchmark,
        capacities=(Decimal("1000"),),
    )
    paths = vg26.TrialPaths(
        trial=vg26.trial_grid()[0],
        gross=scenario,
        base=scenario,
        stress=scenario,
    )
    seeds: list[int] = []

    def capture_bootstrap(
        daily_returns: tuple[Decimal, ...],
        *,
        seed: int,
    ) -> vg26.BootstrapSummary:
        seeds.append(seed)
        mean = vg26.mean_decimal(daily_returns)
        return vg26.BootstrapSummary(
            mean=mean,
            one_sided_95_lcb=mean,
            two_sided_90_ucb=mean,
            one_sided_p_value=Decimal("0.01"),
        )

    monkeypatch.setattr(vg26, "circular_block_bootstrap", capture_bootstrap)
    metrics, _gates = vg26.holdout_analysis(paths)
    assert seeds == [vg26.BOOTSTRAP_SEED + 1, vg26.BOOTSTRAP_SEED + 10_001]
    inference = metrics["inference"]
    assert isinstance(inference, dict)
    absolute = inference["absoluteBase"]
    excess = inference["excessVsAlwaysOn"]
    assert isinstance(absolute, dict)
    assert isinstance(excess, dict)
    assert "seed" not in inference
    assert absolute["seed"] == vg26.BOOTSTRAP_SEED + 1
    assert excess["seed"] == vg26.BOOTSTRAP_SEED + 10_001


def test_holm_adjustment_is_ordered_monotone_and_bounded() -> None:
    adjusted = vg26.holm_adjusted(
        {
            "second": Decimal("0.02"),
            "third": Decimal("0.20"),
            "first": Decimal("0.01"),
        }
    )
    assert adjusted == {
        "first": Decimal("0.03"),
        "second": Decimal("0.04"),
        "third": Decimal("0.20"),
    }


def test_fold_excess_is_difference_of_compounded_economic_returns() -> None:
    days = (date(2025, 3, 1), date(2025, 3, 2))
    strategy = (Decimal(0), Decimal(0))
    benchmark = (Decimal("-0.10"), Decimal("0.11"))
    naive_daily_difference_compound = vg26.compound_return(
        tuple(
            strategy_return - benchmark_return
            for strategy_return, benchmark_return in zip(
                strategy,
                benchmark,
                strict=True,
            )
        )
    )
    assert naive_daily_difference_compound < 0
    assert vg26.fold_excess_returns(
        days,
        strategy,
        benchmark,
        (("2025-03",),),
    ) == (Decimal("0.001"),)


def test_pbo_is_ten_month_choose_five_and_report_only() -> None:
    days = tuple(date.fromisoformat(f"{month}-15") for month in vg26.DEVELOPMENT_MONTHS)
    evaluations = tuple(
        _evaluation(trial, days, Decimal(index + 1) / Decimal("100000"))
        for index, trial in enumerate(vg26.trial_grid())
    )
    report = vg26.cscv_pbo(evaluations)
    assert report["method"] == "CSCV_10_MONTHS_CHOOSE_5_REPORT_ONLY"
    assert report["status"] == "MEASURED_REPORT_ONLY"
    assert report["splitCount"] == 252
    assert Decimal(str(report["pbo"])) >= 0
    assert Decimal(str(report["pbo"])) <= 1


def test_freeze_source_row_authenticates_bytes_without_opening_zip(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    zip_path = tmp_path / "BTCUSDT-1d-2025-07.zip"
    zip_path.write_bytes(b"authenticated compressed bytes, deliberately not a ZIP")
    digest = hashlib.sha256(zip_path.read_bytes()).hexdigest()
    checksum_path = tmp_path / f"{zip_path.name}.CHECKSUM"
    checksum_path.write_text(f"{digest}  {zip_path.name}\n", encoding="ascii")
    monkeypatch.setattr(
        vg26,
        "expected_archive_paths",
        lambda _symbol, _month: (zip_path, checksum_path),
    )
    monkeypatch.setattr(vg26, "SOURCE_ROOT", tmp_path)

    def forbidden_zip_open(*_args: object, **_kwargs: object) -> zipfile.ZipFile:
        raise AssertionError("freeze boundary opened an archive")

    monkeypatch.setattr(zipfile, "ZipFile", forbidden_zip_open)
    row = vg26.source_artifact_row(
        {
            "checksumBytes": checksum_path.stat().st_size,
            "checksumFrozenEtag": "checksum-etag",
            "checksumFrozenLastModified": "now",
            "checksumSha256": hashlib.sha256(checksum_path.read_bytes()).hexdigest(),
            "checksumUrl": vg26.archive_url("BTCUSDT", "2025-07", checksum=True),
            "month": "2025-07",
            "state": "DOWNLOADED_VERIFIED",
            "symbol": "BTCUSDT",
            "zipBytes": zip_path.stat().st_size,
            "zipFrozenEtag": "zip-etag",
            "zipFrozenLastModified": "now",
            "zipSha256": digest,
            "zipUrl": vg26.archive_url("BTCUSDT", "2025-07"),
        }
    )
    assert row["zipSha256"] == digest


def test_run_marker_is_created_exclusively_before_any_run(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    marker_path = tmp_path / "run-marker.v1.json"
    result_path = tmp_path / "result.v1.json"
    freeze_path = tmp_path / "freeze.v1.json"
    manifest_path = tmp_path / "source-manifest.v1.json"
    freeze_path.write_text("{}\n", encoding="utf-8")
    manifest_path.write_text("{}\n", encoding="utf-8")
    monkeypatch.setattr(vg26, "RUN_MARKER_PATH", marker_path)
    monkeypatch.setattr(vg26, "RESULT_PATH", result_path)
    monkeypatch.setattr(vg26, "FREEZE_PATH", freeze_path)
    monkeypatch.setattr(vg26, "SOURCE_MANIFEST_PATH", manifest_path)
    monkeypatch.setattr(
        vg26,
        "git_output",
        lambda *arguments: "" if arguments == ("status", "--porcelain") else "f" * 40,
    )
    freeze_receipt = {"evaluatorSha256": "e" * 64}
    marker_sha = vg26.consume_run_marker(freeze_receipt)
    assert marker_sha == vg26.sha256_path(marker_path)
    assert vg26.load_json(marker_path)["archiveDecompressionRunOrdinal"] == 1
    with pytest.raises(vg26.VG26Error, match="already consumed"):
        vg26.consume_run_marker(freeze_receipt)


def test_holdout_lifecycle_requires_seal_and_is_single_use(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seal_path = tmp_path / "candidate-seal.v1.json"
    open_path = tmp_path / "holdout-open.v1.json"
    monkeypatch.setattr(vg26, "CANDIDATE_SEAL_PATH", seal_path)
    monkeypatch.setattr(vg26, "HOLDOUT_OPEN_PATH", open_path)
    candidate = {"candidate": {"trialId": "vg26-l20-r0000"}}
    with pytest.raises(vg26.VG26Error, match="candidate seal"):
        vg26.open_holdout_once(candidate)
    seal_path.write_text(json.dumps(candidate) + "\n", encoding="utf-8")
    receipt = vg26.open_holdout_once(candidate)
    assert receipt["firstEligibleEntryOpenUtc"] == "2026-01-02T00:00:00Z"
    assert receipt["reuseCount"] == 1
    assert receipt["state"] == "HOLDOUT_OPENED_ONCE"
    with pytest.raises(vg26.VG26Error, match="already opened"):
        vg26.open_holdout_once(candidate)


def test_development_no_go_keeps_holdout_unopened(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(vg26, "FREEZE_PATH", tmp_path / "freeze.v1.json")
    monkeypatch.setattr(vg26, "SOURCE_MANIFEST_PATH", tmp_path / "source-manifest.v1.json")
    monkeypatch.setattr(vg26, "PROTOCOL_PATH", tmp_path / "protocol.v1.json")
    monkeypatch.setattr(vg26, "HOLDOUT_OPEN_PATH", tmp_path / "holdout-open.v1.json")
    for path in (vg26.FREEZE_PATH, vg26.SOURCE_MANIFEST_PATH, vg26.PROTOCOL_PATH):
        path.write_text("{}\n", encoding="utf-8")
    days = tuple(date.fromisoformat(f"{month}-15") for month in vg26.DEVELOPMENT_MONTHS)
    evaluation = _evaluation(vg26.trial_grid()[0], days, Decimal("-0.001"))
    result = vg26.development_no_go_result(
        marker_sha="a" * 64,
        source_manifest={"state": "FROZEN"},
        evaluations=(evaluation,),
        pbo={"status": "MEASURED_REPORT_ONLY"},
    )
    holdout = result["holdout"]
    assert isinstance(holdout, dict)
    assert holdout == {
        "archiveBodiesOpened": False,
        "metrics": None,
        "reuseCount": 0,
        "state": "UNOPENED_UNTOUCHED",
    }
    assert not vg26.HOLDOUT_OPEN_PATH.exists()
