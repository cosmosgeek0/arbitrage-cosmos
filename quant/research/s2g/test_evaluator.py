from __future__ import annotations

import inspect
import json
import zipfile
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from pathlib import Path

import pytest
from research.s2g import evaluator as s2g


def make_bar(
    symbol: str,
    day: date,
    *,
    quote_volume: Decimal = Decimal("100"),
    open_price: Decimal = Decimal("10"),
) -> s2g.Bar:
    moment = datetime.combine(day, datetime.min.time(), tzinfo=UTC)
    open_time = int(moment.timestamp()) * 1_000_000
    close_time = open_time + 86_400_000_000 - 1
    fields = (
        str(open_time),
        str(open_price),
        str(open_price),
        str(open_price),
        str(open_price),
        "1",
        str(close_time),
        str(quote_volume),
        "1",
        "0.5",
        str(quote_volume / 2),
        "0",
    )
    return s2g.Bar(
        symbol=symbol,
        day=day,
        open=open_price,
        high=open_price,
        low=open_price,
        close=open_price,
        quote_volume=quote_volume,
        open_time=open_time,
        close_time=close_time,
        timestamp_unit="MICROSECOND",
        fields=fields,
    )


def synthetic_bars(
    start: date,
    end_exclusive: date,
    *,
    flat: bool = False,
) -> dict[str, dict[date, s2g.Bar]]:
    output: dict[str, dict[date, s2g.Bar]] = {}
    days = tuple(s2g.iter_days(start, end_exclusive))
    for symbol_index, symbol in enumerate(s2g.FIXED_COHORT):
        price = Decimal(100 + symbol_index * 5)
        rows: dict[date, s2g.Bar] = {}
        for offset, day in enumerate(days):
            rows[day] = make_bar(
                symbol,
                day,
                quote_volume=(
                    Decimal(1000) if flat else Decimal(1000 + symbol_index * 100 + (offset % 17))
                ),
                open_price=price,
            )
            if not flat:
                signed_group = Decimal((symbol_index % 4) * 2 - 3)
                weekday_shape = Decimal(day.weekday() - 3)
                price *= Decimal(1) + signed_group * weekday_shape / Decimal(10000)
        output[symbol] = rows
    return output


def active_signal(trial: s2g.Trial, entry_day: date) -> s2g.FormationSignal:
    longs = s2g.FIXED_COHORT[: trial.tail_count]
    shorts = s2g.FIXED_COHORT[-trial.tail_count :]
    scores = {
        symbol: (
            Decimal(1 + index)
            if symbol in longs
            else (-Decimal(1 + index) if symbol in shorts else Decimal(0))
        )
        for index, symbol in enumerate(s2g.FIXED_COHORT)
    }
    return s2g.FormationSignal(
        entry_day=entry_day,
        cutoff_day=entry_day - timedelta(days=2),
        weekday_weeks=trial.weekday_weeks,
        volume_days=trial.volume_days,
        tail_count=trial.tail_count,
        scores=tuple(sorted(scores.items())),
        long_symbols=longs,
        short_symbols=shorts,
        active=True,
    )


def path_fixture(trial_id: str, monthly: tuple[tuple[str, float], ...]) -> s2g.PathMetrics:
    return s2g.PathMetrics(
        trial_id=trial_id,
        scenario="PUBLIC_STRESS",
        start_day=s2g.DEVELOPMENT_START,
        end_exclusive=s2g.DEVELOPMENT_END,
        final_nav=Decimal("1001"),
        net_usdt=Decimal("1"),
        valid_formations=200,
        active_days=120,
        fills=240,
        distinct_held_symbols=12,
        maximum_drawdown_pct=Decimal("1"),
        positive_months=8,
        capacity_p05_usdt=Decimal("10000"),
        mean_daily_turnover=Decimal("0.5"),
        boundary_cost_log_return=-0.001,
        daily_log_returns=(0.001,),
        monthly_log_returns=monthly,
        monthly_net_usdt=tuple((month, Decimal(str(value * 1000))) for month, value in monthly),
    )


def test_protocol_freezes_question_authority_and_exact_family() -> None:
    protocol = json.loads(s2g.PROTOCOL_PATH.read_text(encoding="utf-8"))

    assert protocol["canonicalBaseCommit"] == s2g.BASE_COMMIT
    assert protocol["trials"]["attemptedCount"] == 12
    assert protocol["trials"]["weekdayLookbackWeeks"] == [4, 8]
    assert protocol["trials"]["volumeLookbackDays"] == [1, 7, 28]
    assert protocol["trials"]["tailCounts"] == [2, 3]
    assert protocol["calendar"]["maximumSignalObservation"] == "D_MINUS_2_COMPLETE_DAILY_BAR"
    assert protocol["authority"]["capitalAuthority"] == "NONE"
    assert protocol["authority"]["consumer"] == "N3 successor/final convergence"
    assert protocol["globalHoldoutBoundary"]["verifiedPositiveEligible"] is False
    assert protocol["statistics"]["pbo"]["selectionRuleReproduced"] is True
    assert protocol["universe"]["fixedCohort"] == list(s2g.FIXED_COHORT)


def test_trial_grid_is_unique_cartesian_twelve() -> None:
    trials = s2g.trial_grid()

    assert len(trials) == 12
    assert len({trial.trial_id for trial in trials}) == 12
    assert {trial.weekday_weeks for trial in trials} == {4, 8}
    assert {trial.volume_days for trial in trials} == {1, 7, 28}
    assert {trial.tail_count for trial in trials} == {2, 3}


def test_parse_bar_enforces_post_2025_microsecond_utc_day() -> None:
    day = date(2025, 7, 1)
    bar = make_bar("BTCUSDT", day)

    assert s2g.parse_bar("BTCUSDT", bar.fields, 1) == bar
    millisecond_fields = list(bar.fields)
    millisecond_fields[0] = str(bar.open_time // 1000)
    millisecond_fields[6] = str(int(millisecond_fields[0]) + 86_400_000 - 1)
    with pytest.raises(s2g.S2GError, match="POST_2025_TIMESTAMP_NOT_MICROSECOND"):
        s2g.parse_bar("BTCUSDT", millisecond_fields, 1)


def test_cross_sectional_percentiles_use_midrank_ties() -> None:
    values = {symbol: Decimal(index // 2) for index, symbol in enumerate(s2g.FIXED_COHORT)}

    ranks = s2g.cross_sectional_percentiles(values)

    assert set(ranks) == set(s2g.FIXED_COHORT)
    assert ranks[s2g.FIXED_COHORT[0]] == ranks[s2g.FIXED_COHORT[1]]
    assert min(ranks.values()) > 0
    assert max(ranks.values()) < 1


def test_signal_uses_d_minus_2_and_is_invariant_to_d_minus_1_and_future() -> None:
    entry = date(2025, 7, 22)
    bars = synthetic_bars(entry - timedelta(days=100), entry + timedelta(days=3))
    trial = s2g.Trial("fixture", weekday_weeks=8, volume_days=28, tail_count=2)
    before = s2g.signal_for_entry(bars, trial, entry)
    forbidden_days = (entry - timedelta(days=1), entry, entry + timedelta(days=1))

    for symbol in s2g.FIXED_COHORT:
        for forbidden_day in forbidden_days:
            bars[symbol][forbidden_day] = make_bar(
                symbol,
                forbidden_day,
                quote_volume=Decimal("1e30"),
                open_price=Decimal("1e20"),
            )
    after = s2g.signal_for_entry(bars, trial, entry)

    assert before.cutoff_day == entry - timedelta(days=2)
    assert after == before


def test_flat_main_effects_produce_cash_not_forced_tail_trade() -> None:
    entry = date(2025, 7, 22)
    bars = synthetic_bars(entry - timedelta(days=100), entry + timedelta(days=2), flat=True)
    trial = s2g.Trial("fixture", weekday_weeks=4, volume_days=7, tail_count=3)

    signal = s2g.signal_for_entry(bars, trial, entry)

    assert signal.active is False
    assert signal.long_symbols == ()
    assert signal.short_symbols == ()
    assert set(s2g.target_weights(signal).values()) == {Decimal(0)}


def test_target_is_atomic_market_neutral_and_equal_gross() -> None:
    trial = s2g.Trial("fixture", weekday_weeks=4, volume_days=1, tail_count=2)
    signal = active_signal(trial, date(2025, 7, 10))

    weights = s2g.target_weights(signal)

    assert sum(weights.values(), Decimal(0)) == 0
    assert sum((abs(value) for value in weights.values()), Decimal(0)) == 1
    assert {value for value in weights.values() if value > 0} == {Decimal("0.25")}
    assert {value for value in weights.values() if value < 0} == {Decimal("-0.25")}


def test_missing_fixed_member_or_required_day_is_terminal() -> None:
    entry = date(2025, 7, 22)
    bars = synthetic_bars(entry - timedelta(days=100), entry + timedelta(days=2))
    trial = s2g.Trial("fixture", weekday_weeks=4, volume_days=1, tail_count=2)
    del bars[s2g.FIXED_COHORT[-1]]

    with pytest.raises(s2g.S2GError, match="FIXED_MEMBER_ABSENT"):
        s2g.signal_for_entry(bars, trial, entry)


def test_public_costs_reduce_same_synthetic_path(monkeypatch: pytest.MonkeyPatch) -> None:
    start = date(2025, 7, 1)
    end = date(2025, 7, 8)
    bars = synthetic_bars(start - timedelta(days=40), end + timedelta(days=1), flat=True)
    trial = s2g.Trial("fixture", weekday_weeks=4, volume_days=1, tail_count=2)
    monkeypatch.setattr(
        s2g,
        "signal_for_entry",
        lambda _bars, selected_trial, entry: active_signal(selected_trial, entry),
    )

    gross = s2g.simulate_trial(bars, trial, s2g.SCENARIOS[0], start, end)
    stress = s2g.simulate_trial(bars, trial, s2g.SCENARIOS[2], start, end)

    assert gross.final_nav == s2g.INITIAL_CAPITAL
    assert stress.final_nav < gross.final_nav
    assert gross.active_days == len(s2g.entry_days(start, end))
    assert stress.mean_daily_turnover > 0
    assert stress.capacity_p05_usdt is not None


def test_rebalance_cost_fixed_point_targets_post_cost_nav() -> None:
    target = {symbol: Decimal(0) for symbol in s2g.FIXED_COHORT}
    current = dict(target)
    target[s2g.FIXED_COHORT[0]] = Decimal("0.5")
    target[s2g.FIXED_COHORT[-1]] = Decimal("-0.5")
    cost_rate = Decimal("0.0035")

    turnover, deltas = s2g.rebalance_deltas(target, current, cost_rate)
    post_cost_factor = Decimal(1) - cost_rate * turnover

    assert turnover == sum((abs(value) for value in deltas.values()), Decimal(0))
    assert abs(
        deltas[s2g.FIXED_COHORT[0]] - target[s2g.FIXED_COHORT[0]] * post_cost_factor
    ) <= Decimal("1e-40")
    assert abs(
        deltas[s2g.FIXED_COHORT[-1]] - target[s2g.FIXED_COHORT[-1]] * post_cost_factor
    ) <= Decimal("1e-40")


def test_capacity_observes_initial_and_final_liquidation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    start = date(2025, 7, 1)
    end = date(2025, 7, 5)
    bars = synthetic_bars(start - timedelta(days=40), end + timedelta(days=1), flat=True)
    trial = s2g.Trial("fixture", weekday_weeks=4, volume_days=1, tail_count=2)
    calls: list[date] = []
    original = s2g.capacity_for_rebalance

    monkeypatch.setattr(
        s2g,
        "signal_for_entry",
        lambda _bars, selected_trial, entry: active_signal(selected_trial, entry),
    )

    def observe_capacity(
        selected_bars: dict[str, dict[date, s2g.Bar]],
        entry: date,
        deltas: dict[str, Decimal],
    ) -> Decimal | None:
        calls.append(entry)
        return original(selected_bars, entry, deltas)

    monkeypatch.setattr(s2g, "capacity_for_rebalance", observe_capacity)
    s2g.simulate_trial(bars, trial, s2g.SCENARIOS[2], start, end)

    assert calls[0] == start
    assert calls[-1] == end - timedelta(days=1)
    assert len(calls) >= 2


def test_bootstrap_holm_and_white_are_seeded_and_bounded() -> None:
    returns = [0.001, -0.0002, 0.0008, 0.0001] * 20
    first = s2g.bootstrap_inference(returns, seed=17, replicates=128, block_length=7)
    second = s2g.bootstrap_inference(returns, seed=17, replicates=128, block_length=7)
    adjusted = s2g.holm_adjust({"a": Decimal("0.01"), "b": Decimal("0.02"), "c": Decimal("0.5")})
    white = s2g.white_reality_check(
        {"a": returns, "b": [value / 2 for value in returns]},
        seed=18,
        replicates=128,
        block_length=7,
    )

    assert first == second
    assert Decimal(0) < first["pValueOneSided"] <= Decimal(1)
    assert adjusted == {"a": Decimal("0.03"), "b": Decimal("0.04"), "c": Decimal("0.5")}
    assert Decimal(0) < white <= Decimal(1)


def test_pbo_reproduces_all_70_symmetric_selection_splits() -> None:
    months = (
        *(f"2025-{month:02d}" for month in range(7, 13)),
        "2026-01",
        "2026-02",
    )
    paths = {
        trial.trial_id: path_fixture(
            trial.trial_id,
            tuple(
                (month, ((index + trial_index) % 5 - 2) / 1000)
                for index, month in enumerate(months)
            ),
        )
        for trial_index, trial in enumerate(s2g.trial_grid())
    }

    pbo = s2g.pbo_cscv(paths)

    assert pbo["status"] == "MEASURED"
    assert pbo["selectionRuleReproduced"] is True
    assert pbo["splitCount"] == 70
    assert Decimal("0") <= Decimal(str(pbo["pboOfImplementedSelectionRule"])) <= Decimal("1")


def test_freeze_and_verify_sources_do_not_decompress_archives() -> None:
    freeze_source = inspect.getsource(s2g.freeze) + inspect.getsource(s2g.build_source_manifest)
    verify_source = inspect.getsource(s2g.verify) + inspect.getsource(s2g.assert_frozen)

    assert "ZipFile" not in freeze_source
    assert "_load_archive" not in freeze_source
    assert "ZipFile" not in verify_source
    assert "_load_archive" not in verify_source


def test_archive_loader_rejects_incomplete_month(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    symbol = "BTCUSDT"
    month = "2025-07"
    directory = tmp_path / "archives" / symbol / month
    directory.mkdir(parents=True)
    zip_path = directory / f"{symbol}-1d-{month}.zip"
    member = f"{symbol}-1d-{month}.csv"
    bar = make_bar(symbol, date(2025, 7, 1))
    with zipfile.ZipFile(zip_path, "w") as archive:
        archive.writestr(member, ",".join(bar.fields) + "\n")
    monkeypatch.setattr(s2g, "SOURCE_ROOT", tmp_path)

    with pytest.raises(s2g.S2GError, match="ARCHIVE_MONTH_BOUNDS_INVALID"):
        s2g._load_archive(symbol, month)


def test_run_marker_precedes_first_archive_load_and_no_rerun_path_exists() -> None:
    source = inspect.getsource(s2g.run)

    assert source.index("write_exclusive(\n        RUN_MARKER_PATH") < source.index(
        "load_bars(DEVELOPMENT_MONTHS)"
    )
    assert "RUN_OR_OUTCOME_STATE_ALREADY_EXISTS" in source
    assert source.count("load_bars(HOLDOUT_MONTHS)") == 1


def test_exclusive_marker_refuses_existing_different_bytes(tmp_path: Path) -> None:
    marker = tmp_path / "marker.json"
    s2g.write_exclusive(marker, {"schema": "first"})

    with pytest.raises(s2g.S2GError, match="ONE_USE_STATE_ALREADY_EXISTS"):
        s2g.write_exclusive(marker, {"schema": "second"})
    assert json.loads(marker.read_text(encoding="utf-8")) == {"schema": "first"}


def test_recorded_development_gates_are_recomputable() -> None:
    path = path_fixture(
        "fixture",
        tuple(
            (month, 0.001)
            for month in (
                "2025-07",
                "2025-08",
                "2025-09",
                "2025-10",
                "2025-11",
                "2025-12",
                "2026-01",
                "2026-02",
            )
        ),
    )
    row = {
        "inference": {
            "lcb5Usdt": "1",
            "pValueOneSided": "0.01",
            "twoSided90LowerUsdt": "1",
            "twoSided90UpperUsdt": "2",
        },
        "paths": {"PUBLIC_STRESS": s2g._metrics_dict(path)},
    }

    gates = s2g._development_gates_from_record(
        row,
        Decimal("0.02"),
        Decimal("0.03"),
        "fixture",
    )

    assert set(gates) == s2g.DEVELOPMENT_GATE_NAMES
    assert all(gates.values())


def test_path_schema_rejects_unexpected_fields() -> None:
    row = s2g._metrics_dict(path_fixture("fixture", (("2025-07", 0.001),)))
    row["unexpected"] = "tamper"

    with pytest.raises(s2g.S2GError, match="RESULT_PATH_FIELDS_INVALID"):
        s2g._validate_path_record(
            row,
            trial_id="fixture",
            scenario="PUBLIC_STRESS",
            start_day=s2g.DEVELOPMENT_START,
            end_exclusive=s2g.DEVELOPMENT_END,
            expected_months=("2025-07",),
        )


def test_terminal_result_keeps_unknowns_and_no_authority(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(s2g, "sha256_path", lambda _path: "0" * 64)
    result = s2g._terminal_result(
        "NO_GO",
        development={"championTrialId": None},
        holdout=None,
        blocker=None,
        terminal_phase="DEVELOPMENT_GATES_FAILED",
    )

    assert set(result) == s2g.TERMINAL_CORE_RECORD_NAMES
    assert result["authority"] == "NONE"
    assert result["capitalVerdict"] == "NO_GO"
    assert result["accountEffectiveFees"] == "UNKNOWN"
    assert result["executableCapacity"] == "UNMEASURED"
    assert result["shortBorrowAvailabilityAndCost"] == "UNKNOWN_NOT_MODELED"
    assert result["globalHoldoutStatus"] == "NOT_CERTIFIED_SHARED_REUSE_RISK"
