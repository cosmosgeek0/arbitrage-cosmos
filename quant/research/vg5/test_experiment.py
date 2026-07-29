"""Focused, network-free acceptance tests for the sealed V-G5 evaluator."""

from __future__ import annotations

import copy
import hashlib
import random
import zipfile
from dataclasses import replace
from datetime import UTC, date, datetime, timedelta
from decimal import ROUND_DOWN, Decimal, getcontext, setcontext
from pathlib import Path
from typing import Any

import pytest
from research.vg5 import experiment as exp

D = Decimal


def _bar(
    day: date,
    *,
    open_price: str = "100",
    high: str = "101",
    low: str = "99",
    close: str = "100",
    quote_volume: str = "10000000",
) -> exp.Bar:
    return exp.Bar(
        day=day,
        open=D(open_price),
        high=D(high),
        low=D(low),
        close=D(close),
        quote_volume=D(quote_volume),
        trade_count=100,
    )


def _protocol() -> dict[str, Any]:
    protocol, _ = exp.load_protocol()
    return copy.deepcopy(protocol)


def _rising_series(signal_day: date) -> dict[date, exp.Bar]:
    first = signal_day - timedelta(days=220)
    series: dict[date, exp.Bar] = {}
    for offset in range(221):
        day = first + timedelta(days=offset)
        close = D("100") + D(offset) / D("10")
        high = close + D("1")
        low = close - D("1")
        quote_volume = D("10000000")
        if day == signal_day:
            prior_high = max(bar.high for bar in series.values())
            close = prior_high + D("3")
            high = close + D("1")
            low = close - D("1")
            quote_volume = D("20000000")
        series[day] = _bar(
            day,
            open_price=exp.decimal_text(close),
            high=exp.decimal_text(high),
            low=exp.decimal_text(low),
            close=exp.decimal_text(close),
            quote_volume=exp.decimal_text(quote_volume),
        )
    return series


def _spec(*, hold_days: int = 3) -> exp.TrialSpec:
    return exp.TrialSpec(
        trial_id=f"TEST_H{hold_days}",
        breakout_days=20,
        volume_threshold=D("1.5"),
        trend_days=50,
        volatility_regime="LOW",
        hold_days=hold_days,
    )


def _metric(symbol: str = "AUSDT") -> exp.SignalMetric:
    return exp.SignalMetric(
        symbol=symbol,
        volume_multiple=D("2"),
        breakout_excess_20_atr=D("1"),
        breakout_excess_55_atr=D("1"),
        breakout_20=True,
        breakout_55=True,
        trend_50=True,
        trend_100=True,
        volatility_regime="LOW",
    )


def _simulation_panel() -> dict[str, dict[date, exp.Bar]]:
    first = date(2024, 12, 20)
    last = date(2025, 1, 9)
    series: dict[date, exp.Bar] = {}
    for day_offset in range((last - first).days + 1):
        day = first + timedelta(days=day_offset)
        price = "110" if day == date(2025, 1, 6) else "100"
        quote_volume = "8000000" if day == date(2025, 1, 5) else "10000000"
        if day == date(2025, 1, 1):
            quote_volume = "20000000"
        series[day] = _bar(
            day,
            open_price=price,
            high=str(D(price) + D("1")),
            low=str(D(price) - D("1")),
            close=price,
            quote_volume=quote_volume,
        )
    return {"AUSDT": series}


def _run(
    trial_id: str,
    returns: tuple[Decimal, ...],
    dates: tuple[date, ...],
    *,
    net_usd: Decimal | None = None,
) -> exp.TrialRun:
    nav = D("1000")
    for value in returns:
        nav *= D("1") + value
    net = nav - D("1000") if net_usd is None else net_usd
    spec = exp.TrialSpec(trial_id, 20, D("1.5"), 50, "LOW", 3)
    scenario = exp.CostScenario("stress", D("10"), D("10"), D("0.5"))
    decomposition = exp.Decomposition(net=net, reference_gross=net)
    return exp.TrialRun(
        spec=spec,
        scenario=scenario,
        period="development",
        valid=True,
        invalid_reasons=(),
        start_nav=D("1000"),
        end_nav=D("1000") + net,
        net_usd=net,
        fills=0,
        round_trips=0,
        distinct_symbols=(),
        active_months=(),
        cash_signal_days=0,
        trades=(),
        daily_dates=dates,
        daily_returns=returns,
        exit_log_returns_by_day=tuple((D("1") + value).ln() for value in returns),
        max_drawdown_pct=D("0"),
        max_drawdown_usd=D("0"),
        min_capacity_usd=None,
        p05_capacity_usd=None,
        median_capacity_usd=None,
        capacity_share_below_sleeve=None,
        decomposition=decomposition,
    )


def test_protocol_enumerates_exact_complete_32_trial_family() -> None:
    specs = exp.trial_specs(_protocol())

    assert len(specs) == 32
    assert len({spec.trial_id for spec in specs}) == 32
    assert {spec.breakout_days for spec in specs} == {20, 55}
    assert {spec.volume_threshold for spec in specs} == {D("1.5"), D("2.0")}
    assert {spec.trend_days for spec in specs} == {50, 100}
    assert {spec.volatility_regime for spec in specs} == {"LOW", "HIGH"}
    assert {spec.hold_days for spec in specs} == {3, 7}


def test_fresh_breakout_requires_false_to_true_transition() -> None:
    signal_day = date(2025, 7, 1)
    series = _rising_series(signal_day)

    passed, excess = exp._breakout(series, signal_day, 20)
    assert passed
    assert excess is not None
    assert excess > 0

    previous_day = signal_day - timedelta(days=1)
    previous_prior_high = max(
        series[previous_day - timedelta(days=offset)].high for offset in range(1, 21)
    )
    prior_close = previous_prior_high + D("2")
    series[previous_day] = _bar(
        previous_day,
        open_price=str(prior_close),
        high=str(prior_close + D("1")),
        low=str(prior_close - D("1")),
        close=str(prior_close),
    )
    signal_close = prior_close + D("5")
    series[signal_day] = _bar(
        signal_day,
        open_price=str(signal_close),
        high=str(signal_close + D("1")),
        low=str(signal_close - D("1")),
        close=str(signal_close),
        quote_volume="20000000",
    )

    passed_after, _ = exp._breakout(series, signal_day, 20)
    assert not passed_after


def test_signal_volume_denominator_excludes_signal_day() -> None:
    signal_day = date(2025, 7, 1)
    series = _rising_series(signal_day)
    first = exp.signal_metric("AUSDT", series, signal_day)
    assert first is not None
    assert first.volume_multiple == D("2")

    current = series[signal_day]
    series[signal_day] = replace(current, quote_volume=D("40000000"))
    second = exp.signal_metric("AUSDT", series, signal_day)
    assert second is not None
    assert second.volume_multiple == D("4")


def test_trend_and_volatility_classifier_ignore_signal_and_future_bars() -> None:
    signal_day = date(2025, 7, 1)
    series = _rising_series(signal_day)
    trend_before = exp._trend(series, signal_day, 100)
    regime_before = exp._volatility_regime(series, signal_day)

    series[signal_day] = _bar(
        signal_day,
        open_price="1",
        high="1000000",
        low="0.1",
        close="1",
        quote_volume="999999999999",
    )
    future = signal_day + timedelta(days=30)
    series[future] = _bar(
        future,
        open_price="999999",
        high="1000000",
        low="1",
        close="500000",
        quote_volume="999999999999",
    )

    assert exp._trend(series, signal_day, 100) == trend_before
    assert exp._volatility_regime(series, signal_day) == regime_before


def test_rank_is_volume_then_excess_then_utf8_symbol_bytes() -> None:
    spec = _spec()
    metrics = (
        replace(
            _metric("βUSDT"),
            volume_multiple=D("3"),
            breakout_excess_20_atr=D("1"),
        ),
        replace(
            _metric("AUSDT"),
            volume_multiple=D("2"),
            breakout_excess_20_atr=D("9"),
        ),
        replace(
            _metric("BUSDT"),
            volume_multiple=D("3"),
            breakout_excess_20_atr=D("2"),
        ),
        replace(
            _metric("CUSDT"),
            volume_multiple=D("3"),
            breakout_excess_20_atr=D("2"),
        ),
    )

    ranked = exp.rank_candidates(metrics, spec)

    assert tuple(metric.symbol for metric in ranked) == (
        "BUSDT",
        "CUSDT",
        "βUSDT",
        "AUSDT",
    )


def test_rank_uses_the_trial_specific_breakout_excess() -> None:
    first = replace(
        _metric("AUSDT"),
        breakout_excess_20_atr=D("9"),
        breakout_excess_55_atr=D("1"),
    )
    second = replace(
        _metric("BUSDT"),
        breakout_excess_20_atr=D("1"),
        breakout_excess_55_atr=D("9"),
    )
    spec_20 = _spec()
    spec_55 = replace(spec_20, breakout_days=55)

    assert tuple(item.symbol for item in exp.rank_candidates((first, second), spec_20)) == (
        "AUSDT",
        "BUSDT",
    )
    assert tuple(item.symbol for item in exp.rank_candidates((first, second), spec_55)) == (
        "BUSDT",
        "AUSDT",
    )


def test_rotating_sleeve_trade_reconciles_and_cost_stress_is_monotone() -> None:
    panel = _simulation_panel()
    signal_day = date(2025, 1, 1)
    book = {signal_day: (_metric(),)}
    base = exp.simulate_trial(
        panel,
        book,
        _spec(),
        exp.CostScenario("base", D("10"), D("5"), D("1")),
        period="test",
        signal_start=signal_day,
        signal_end=signal_day,
        entry_start=date(2025, 1, 2),
        last_exit=date(2025, 1, 6),
    )
    severe = exp.simulate_trial(
        panel,
        book,
        _spec(),
        exp.CostScenario("severe", D("10"), D("25"), D("0.25")),
        period="test",
        signal_start=signal_day,
        signal_end=signal_day,
        entry_start=date(2025, 1, 2),
        last_exit=date(2025, 1, 6),
    )

    assert base.round_trips == 1
    assert base.fills == 2
    assert base.trades[0].entry_day == date(2025, 1, 3)
    assert base.trades[0].exit_day == date(2025, 1, 6)
    assert base.decomposition.residual() == 0
    assert abs(base.decomposition.net - base.net_usd) < D("1e-40")
    assert severe.net_usd < base.net_usd
    assert base.min_capacity_usd == D("800")
    assert severe.min_capacity_usd == D("200")
    assert base.capacity_share_below_sleeve == 0
    assert severe.capacity_share_below_sleeve == 1


def test_capacity_must_cover_larger_pre_fee_exit_notional() -> None:
    panel = _simulation_panel()
    exit_day = date(2025, 1, 6)
    panel["AUSDT"][exit_day] = _bar(
        exit_day,
        open_price="1000",
        high="1001",
        low="999",
        close="1000",
    )
    run = exp.simulate_trial(
        panel,
        {date(2025, 1, 1): (_metric(),)},
        _spec(),
        exp.CostScenario("base", D("10"), D("5"), D("1")),
        period="test",
        signal_start=date(2025, 1, 1),
        signal_end=date(2025, 1, 1),
        entry_start=date(2025, 1, 2),
        last_exit=exit_day,
    )

    assert run.trades[0].required_capacity_notional_usd > D("3000")
    assert run.trades[0].capacity_usd == D("800")
    assert run.capacity_share_below_sleeve == 1


def test_capacity_aggregates_same_symbol_exit_and_reentry_at_one_open() -> None:
    panel = _simulation_panel()
    for day, bar in tuple(panel["AUSDT"].items()):
        panel["AUSDT"][day] = replace(
            bar,
            open=D("100"),
            high=D("101"),
            low=D("99"),
            close=D("100"),
            quote_volume=D("5000000"),
        )
    signal_book = {
        date(2025, 1, 1): (_metric(),),
        date(2025, 1, 4): (_metric(),),
    }
    run = exp.simulate_trial(
        panel,
        signal_book,
        _spec(),
        exp.CostScenario("stress", D("10"), D("10"), D("1")),
        period="test",
        signal_start=date(2025, 1, 1),
        signal_end=date(2025, 1, 4),
        entry_start=date(2025, 1, 2),
        last_exit=date(2025, 1, 9),
    )

    assert len(run.trades) == 2
    assert run.trades[0].exit_day == run.trades[1].entry_day
    assert run.trades[0].capacity_usd == D("500")
    assert all(trade.capacity_below_sleeve for trade in run.trades)
    assert run.capacity_share_below_sleeve == 1


@pytest.mark.parametrize(
    ("missing_day", "reason"),
    [
        (date(2025, 1, 3), "selected entry proof missing"),
        (date(2025, 1, 4), "held daily mark missing"),
        (date(2025, 1, 6), "selected exit proof missing"),
    ],
)
def test_selected_missing_entry_mark_or_exit_is_terminal(
    missing_day: date,
    reason: str,
) -> None:
    panel = _simulation_panel()
    del panel["AUSDT"][missing_day]

    with pytest.raises(exp.MeasurementError, match=reason):
        exp.simulate_trial(
            panel,
            {date(2025, 1, 1): (_metric(),)},
            _spec(),
            exp.CostScenario("stress", D("10"), D("10"), D("0.5")),
            period="test",
            signal_start=date(2025, 1, 1),
            signal_end=date(2025, 1, 1),
            entry_start=date(2025, 1, 2),
            last_exit=date(2025, 1, 6),
        )


def test_circular_bootstrap_is_synchronous_and_deterministic() -> None:
    dates = tuple(date(2025, 7, 1) + timedelta(days=offset) for offset in range(28))
    runs = {
        "A": _run("A", tuple(D("0.001") for _ in dates), dates),
        "B": _run(
            "B",
            tuple(D("0.002") if offset % 2 else D("-0.001") for offset in range(28)),
            dates,
        ),
    }

    first = exp.family_statistics(
        runs,
        seed=7,
        block_length=7,
        replicates=128,
        lower_probability=D("0.05"),
        upper_probability=D("0.95"),
        alpha=D("0.05"),
    )
    second = exp.family_statistics(
        runs,
        seed=7,
        block_length=7,
        replicates=128,
        lower_probability=D("0.05"),
        upper_probability=D("0.95"),
        alpha=D("0.05"),
    )

    assert first == second
    assert first.packets["A"].replicates == 128
    assert D("0") < first.packets["A"].individual_p_value <= D("1")
    assert D("0") < first.white_reality_check_p_value <= D("1")


def test_block_sum_optimization_matches_frozen_circular_indices_with_remainder() -> None:
    values = tuple(float(index) for index in range(10))
    indices = exp.circular_indices(10, 4, random.Random(19))
    starts_rng = random.Random(19)
    starts = tuple(starts_rng.randrange(10) for _ in range(3))
    full, partial = exp._circular_block_sums(values, 4)
    optimized = full[starts[0]] + full[starts[1]] + partial[starts[2]]

    assert optimized == sum(values[index] for index in indices)


def test_capacity_quantiles_use_frozen_nearest_rank_and_even_median() -> None:
    values = tuple(D(index) for index in range(1, 41))

    assert exp._percentile_decimal(values, D("0.05")) == D("2")
    assert exp._percentile_decimal(values, D("0.5")) == D("20.5")


def test_protocol_statistics_freeze_resolved_corrected_tail() -> None:
    config = exp._statistics_config(_protocol())

    assert config.replicates == 65_536
    assert config.alpha == D("0.05")
    assert config.bonferroni_probability == D("0.0015625")
    assert D(config.replicates) * config.bonferroni_probability > D("100")


def test_pbo_identical_32_trial_clones_is_one_and_diagnostic_only() -> None:
    months = (
        *(f"2025-{month:02d}" for month in range(7, 13)),
        "2026-01",
        "2026-02",
    )
    dates = tuple(date.fromisoformat(f"{month}-15") for month in months)
    returns = tuple(D("0.01") for _ in dates)
    runs = {f"T{index:02d}": _run(f"T{index:02d}", returns, dates) for index in range(32)}

    packet = exp.pbo_cscv(
        runs,
        blocks=8,
        rows_per_block=1,
        excluded_tail_rows=0,
        expected_trials=32,
    )

    assert packet["trialCount"] == 32
    assert packet["splits"] == 70
    assert packet["underperformanceSplits"] == 70
    assert packet["pbo"] == "1"
    assert packet["role"] == "DIAGNOSTIC_ONLY_NOT_RANK_GATE_OR_VERDICT_OVERRIDE"


def test_pbo_persistently_ordered_complete_family_is_zero() -> None:
    dates = tuple(date(2025, 7, 1) + timedelta(days=offset) for offset in range(8))
    runs = {
        f"T{index:02d}": _run(
            f"T{index:02d}",
            tuple(D(index + 1) / D("10000") for _ in dates),
            dates,
        )
        for index in range(32)
    }

    packet = exp.pbo_cscv(
        runs,
        blocks=8,
        rows_per_block=1,
        excluded_tail_rows=0,
        expected_trials=32,
    )

    assert packet["pbo"] == "0"
    assert packet["underperformanceSplits"] == 0
    selections = packet["selectionCounts"]
    assert isinstance(selections, dict)
    assert selections["T31"] == 70


def test_champion_selector_matches_pbo_sum_log_return_law() -> None:
    dates = tuple(date(2025, 7, 1) + timedelta(days=offset) for offset in range(4))
    first = _run("A", (D("0.01"), D("0.01"), D("0"), D("0")), dates)
    second = _run("B", (D("0"), D("0"), D("0.03"), D("0")), dates)

    selected = exp._select_champion(
        (first.spec, second.spec),
        {"A": first, "B": second},
        selection_rows=2,
    )

    assert selected.trial_id == "A"


def test_drawdown_exactly_40_percent_passes_frozen_cap() -> None:
    protocol = _protocol()
    dates = tuple(date(2025, 7, 1) + timedelta(days=offset) for offset in range(10))
    base_run = replace(
        _run("CHAMP", tuple(D("0.01") for _ in dates), dates, net_usd=D("10")),
        fills=80,
        round_trips=40,
        distinct_symbols=tuple(f"S{index}USDT" for index in range(12)),
        active_months=tuple(f"2025-{month:02d}" for month in range(7, 13)),
        max_drawdown_pct=D("40"),
        capacity_share_below_sleeve=D("0"),
    )
    packet = exp.BootstrapPacket(D("1"), D("20"), D("0.5"), 4096, D("0.001"))
    family = exp.FamilyStatistics(
        packets={"CHAMP": packet},
        holm_rejected={"CHAMP": True},
        white_reality_check_p_value=D("0.01"),
        seed=1,
        block_length=7,
        replicates=4096,
    )
    runs = {
        name: {"CHAMP": replace(base_run, scenario=exp.scenario(protocol, name))}
        for name in ("base", "stress", "severe")
    }

    gates = exp.development_gates("CHAMP", runs, family, family, protocol)

    drawdown_gates = [row for row in gates if "DRAWDOWN" in str(row["gate"])]
    assert drawdown_gates
    assert all(row["passed"] is True for row in drawdown_gates)


def test_drawdown_uses_prior_close_peak_and_same_day_low_mark() -> None:
    max_pct, max_usd = exp._max_drawdown(
        (D("1200"), D("1000"), D("800"), D("1300")),
        (D("1000"), D("900"), D("800"), D("750")),
        D("1000"),
    )

    assert max_usd == D("450")
    assert max_pct == D("37.5")


def _development_failure_result() -> dict[str, object]:
    def scenario_packet(
        net: str,
        *,
        holm: bool | None = None,
    ) -> dict[str, object]:
        packet: dict[str, object] = {
            "netUsdPerInitial1000": net,
            "roundTrips": 10,
            "fills": 20,
            "distinctSymbols": 5,
            "activeCalendarMonths": 4,
            "maxDrawdownPct": "12",
            "capacityProxyUsd": {
                "minimum": "500",
                "p05": "600",
                "median": "700",
                "shareBelowAggregatedSameSymbolSameOpenRequiredNotional": "0",
                "executableCapacity": "UNKNOWN",
            },
        }
        if holm is not None:
            packet["holmRejected"] = holm
            packet["bootstrap"] = {
                "lower90AndOneSided95LcbUsdPer1000": "-1",
                "upper90UsdPer1000": "5",
                "bonferroniLowerUsdPer1000": "-3",
                "individualNullCenteredPValue": "0.2",
                "replicates": 65536,
            }
        return packet

    result: dict[str, object] = {
        "schema": "VG5ResultV1",
        "measurementVerdict": "NO_GO",
        "measurementState": "TERMINAL_VALID_MEASUREMENT",
        "capitalAuthority": "NONE",
        "executionAuthority": "NONE",
        "family": {
            "attemptCount": 32,
            "championTrialId": "T01",
            "pbo": "0.5",
            "pboRole": "DIAGNOSTIC_ONLY_NOT_RANK_GATE_OR_VERDICT_OVERRIDE",
        },
        "development": {
            "championTrialId": "T01",
            "trialMatrix": [
                {
                    "trialId": "T01",
                    "scenarios": {
                        "base": scenario_packet("2", holm=False),
                        "stress": scenario_packet("-1", holm=False),
                        "severe": scenario_packet("-3"),
                    },
                    "costStress": {
                        "stressIncrementVsBaseUsdPer1000": "-3",
                        "severeIncrementVsBaseUsdPer1000": "-5",
                    },
                }
            ],
            "multiplicity": {
                "whiteRealityCheckPValue": "0.4",
                "holmRejectedTrialIds": [],
            },
            "pbo": {"pbo": "0.5"},
            "gates": [{"gate": "X", "found": 0, "passed": False}],
            "passed": False,
        },
        "holdout": {"state": "UNOPENED_BY_GOVERNING_DEVELOPMENT_FAILURE"},
    }
    result["scoreboard"] = exp._derived_scoreboard(result)
    return result


def test_semantic_validator_rejects_go_with_failed_development() -> None:
    valid_no_go = _development_failure_result()
    exp.validate_result_semantics(valid_no_go)

    contradictory = copy.deepcopy(valid_no_go)
    contradictory["measurementVerdict"] = "GO"
    scoreboard = contradictory["scoreboard"]
    assert isinstance(scoreboard, dict)
    scoreboard["verdict"] = "GO"
    with pytest.raises(exp.EvidenceError, match="development failure"):
        exp.validate_result_semantics(contradictory)


def test_semantic_validator_rejects_mutated_headline_and_unmeasured_scoreboard() -> None:
    contradictory = _development_failure_result()
    scoreboard = contradictory["scoreboard"]
    assert isinstance(scoreboard, dict)
    development = scoreboard["development"]
    assert isinstance(development, dict)
    development["baseNetUsdPer1000"] = "999"
    with pytest.raises(exp.EvidenceError, match="scoreboard differs"):
        exp.validate_result_semantics(contradictory)

    champion_mutation = _development_failure_result()
    champion_scoreboard = champion_mutation["scoreboard"]
    assert isinstance(champion_scoreboard, dict)
    champion_scoreboard["championTrialId"] = "T99"
    with pytest.raises(exp.EvidenceError, match="scoreboard differs"):
        exp.validate_result_semantics(champion_mutation)

    holdout_mutation = _development_failure_result()
    holdout_scoreboard = holdout_mutation["scoreboard"]
    assert isinstance(holdout_scoreboard, dict)
    holdout_scoreboard["holdoutState"] = "MEASURED_SINGLE_OPEN_CHAMPION_ONLY"
    with pytest.raises(exp.EvidenceError, match="scoreboard differs"):
        exp.validate_result_semantics(holdout_mutation)

    unmeasured: dict[str, object] = {
        "schema": "VG5ResultV1",
        "measurementVerdict": "UNMEASURED",
        "measurementState": "TERMINAL_ONE_RUN_CONSUMED_INVALID_MEASUREMENT",
        "capitalAuthority": "NONE",
        "executionAuthority": "NONE",
        "development": {"state": "INVALID_OR_INCOMPLETE"},
        "holdout": {"state": "UNOPENED_TERMINAL_UNMEASURED"},
        "scoreboard": {"verdict": "GO"},
    }
    with pytest.raises(exp.EvidenceError, match="must not carry a scoreboard"):
        exp.validate_result_semantics(unmeasured)


def test_root_validator_refuses_any_writable_shared_overlap(tmp_path: Path) -> None:
    with pytest.raises(exp.EvidenceError, match="state root differs"):
        exp.validate_roots(tmp_path, exp.DEFAULT_SHARED_ROOT)


def test_root_validator_refuses_a_pinned_final_component_symlink(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    state_target = tmp_path / "state-target"
    state_target.mkdir()
    state_link = tmp_path / "state-link"
    state_link.symlink_to(state_target, target_is_directory=True)
    shared = tmp_path / "shared"
    shared.mkdir()
    monkeypatch.setattr(exp, "DEFAULT_STATE_ROOT", state_link)
    monkeypatch.setattr(exp, "DEFAULT_SHARED_ROOT", shared)

    with pytest.raises(exp.EvidenceError, match="unsafe evidence directory"):
        exp.validate_roots(state_link, shared)


def test_runtime_binding_refuses_nonzero_seed_claim(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("PYTHONHASHSEED", "123")
    with pytest.raises(exp.EvidenceError, match="interpreter startup"):
        exp.runtime_binding()


def test_runtime_binding_refuses_decimal_context_drift() -> None:
    original = getcontext().copy()
    try:
        getcontext().rounding = ROUND_DOWN
        with pytest.raises(exp.EvidenceError, match="Decimal context"):
            exp.runtime_binding()
    finally:
        setcontext(original)


def _kline_row(day: date, *, microseconds: bool) -> str:
    opened = datetime(day.year, day.month, day.day, tzinfo=UTC)
    closed = opened + timedelta(days=1) - timedelta(microseconds=1)
    multiplier = 1_000_000 if microseconds else 1_000
    open_timestamp = int(opened.timestamp()) * multiplier
    close_timestamp = int(closed.timestamp() * multiplier)
    return ",".join(
        (
            str(open_timestamp),
            "100",
            "101",
            "99",
            "100",
            "1",
            str(close_timestamp),
            "10000000",
            "100",
            "0.5",
            "5000000",
            "0",
        )
    )


def test_archive_parser_accepts_frozen_microsecond_daily_boundary(
    tmp_path: Path,
) -> None:
    day = date(2025, 1, 1)
    symbol = "AUSDT"
    month = day.strftime("%Y-%m")
    path = tmp_path / f"{symbol}-1d-{month}.zip"
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(
            f"{symbol}-1d-{month}.csv",
            _kline_row(day, microseconds=True),
        )
    expected_sha = hashlib.sha256(path.read_bytes()).hexdigest()

    bars = exp.parse_archive(
        path,
        symbol=symbol,
        month=month,
        expected_sha=expected_sha,
    )

    assert len(bars) == 1
    assert bars[0].day == day


def test_archive_parser_rejects_milliseconds_and_nonexact_close(
    tmp_path: Path,
) -> None:
    day = date(2025, 1, 1)
    milliseconds_path = tmp_path / "AUSDT-1d-2025-01.zip"
    with zipfile.ZipFile(milliseconds_path, "w") as archive:
        archive.writestr(
            "AUSDT-1d-2025-01.csv",
            _kline_row(day, microseconds=False),
        )
    with pytest.raises(exp.MeasurementError, match="not microseconds"):
        exp.parse_archive(
            milliseconds_path,
            symbol="AUSDT",
            month="2025-01",
            expected_sha=hashlib.sha256(milliseconds_path.read_bytes()).hexdigest(),
        )

    fields = _kline_row(day, microseconds=True).split(",")
    fields[6] = str(int(fields[6]) - 1)
    close_path = tmp_path / "BUSDT-1d-2025-01.zip"
    with zipfile.ZipFile(close_path, "w") as archive:
        archive.writestr("BUSDT-1d-2025-01.csv", ",".join(fields))
    with pytest.raises(exp.MeasurementError, match="timestamp boundary"):
        exp.parse_archive(
            close_path,
            symbol="BUSDT",
            month="2025-01",
            expected_sha=hashlib.sha256(close_path.read_bytes()).hexdigest(),
        )


def test_archive_parser_rejects_extra_member(tmp_path: Path) -> None:
    day = date(2025, 1, 1)
    path = tmp_path / "AUSDT-1d-2025-01.zip"
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("AUSDT-1d-2025-01.csv", _kline_row(day, microseconds=True))
        archive.writestr("extra.csv", "bad")
    expected_sha = hashlib.sha256(path.read_bytes()).hexdigest()

    with pytest.raises(exp.MeasurementError, match="member count"):
        exp.parse_archive(
            path,
            symbol="AUSDT",
            month="2025-01",
            expected_sha=expected_sha,
        )


def test_archive_parser_accepts_named_header_and_rejects_mixed_units(tmp_path: Path) -> None:
    day = date(2025, 1, 1)
    header = ",".join(
        (
            "open_time",
            "open",
            "high",
            "low",
            "close",
            "volume",
            "close_time",
            "quote_volume",
            "count",
            "taker_base",
            "taker_quote",
            "ignore",
        )
    )
    good_path = tmp_path / "AUSDT-1d-2025-01.zip"
    with zipfile.ZipFile(good_path, "w") as archive:
        archive.writestr(
            "AUSDT-1d-2025-01.csv",
            f"{header}\n{_kline_row(day, microseconds=True)}\n",
        )
    bars = exp.parse_archive(
        good_path,
        symbol="AUSDT",
        month="2025-01",
        expected_sha=hashlib.sha256(good_path.read_bytes()).hexdigest(),
    )
    assert len(bars) == 1

    fields = _kline_row(day, microseconds=True).split(",")
    fields[6] = str(int(fields[6]) // 1_000)
    bad_path = tmp_path / "BUSDT-1d-2025-01.zip"
    with zipfile.ZipFile(bad_path, "w") as archive:
        archive.writestr("BUSDT-1d-2025-01.csv", ",".join(fields))
    with pytest.raises(exp.MeasurementError, match="not microseconds"):
        exp.parse_archive(
            bad_path,
            symbol="BUSDT",
            month="2025-01",
            expected_sha=hashlib.sha256(bad_path.read_bytes()).hexdigest(),
        )


def test_exclusive_marker_cannot_be_reused(tmp_path: Path) -> None:
    marker = tmp_path / "marker.json"
    exp.exclusive_write(marker, b"first\n")

    with pytest.raises(FileExistsError):
        exp.exclusive_write(marker, b"second\n")

    assert marker.read_bytes() == b"first\n"
    assert not tuple(tmp_path.glob(".marker.json.publish.*"))


def test_external_freeze_and_candidate_receipts_restore_repo_bytes(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    state = tmp_path / "state"
    state.mkdir()
    freeze_path = tmp_path / "freeze.v1.json"
    candidate_path = tmp_path / "candidate-seal.v1.json"
    monkeypatch.setattr(exp, "FREEZE_PATH", freeze_path)
    monkeypatch.setattr(exp, "CANDIDATE_SEAL_PATH", candidate_path)

    freeze_payload = {
        "schema": "VG5FreezeV1",
        "state": "FROZEN_BEFORE_ANY_VG5_ARCHIVE_BODY_OPEN",
        "inputs": {"stateRootIdentity": exp.directory_identity(state)},
    }
    freeze_raw = exp.canonical_bytes(freeze_payload)
    (state / exp.EXTERNAL_FREEZE).write_bytes(
        exp.canonical_bytes(
            {
                "schema": "VG5ExternalFreezeReceiptV1",
                "freezeSha256": hashlib.sha256(freeze_raw).hexdigest(),
                "freeze": freeze_payload,
            }
        )
    )
    assert exp._restore_freeze_from_receipt(state) == freeze_payload
    assert freeze_path.read_bytes() == freeze_raw
    freeze_path.write_bytes(b"partial")
    exp._restore_freeze_from_receipt(state)
    assert freeze_path.read_bytes() == freeze_raw

    candidate_payload = {
        "schema": "VG5CandidateSealV1",
        "state": "ONE_CHAMPION_SEALED_BEFORE_ANY_HOLDOUT_ARCHIVE_BODY_OPEN",
        "developmentGateRowsSha256": hashlib.sha256(exp.canonical_bytes([])).hexdigest(),
        "developmentMatrixSha256": hashlib.sha256(exp.canonical_bytes([])).hexdigest(),
        "pboSha256": hashlib.sha256(exp.canonical_bytes({})).hexdigest(),
        "developmentEvidence": {
            "developmentGateRows": [],
            "developmentMatrix": [],
            "pbo": {},
        },
    }
    candidate_raw = exp.canonical_bytes(candidate_payload)
    (state / "candidate-seal.v1.json").write_bytes(candidate_raw)
    assert exp._restore_candidate_from_external(state) == candidate_payload
    assert candidate_path.read_bytes() == candidate_raw
    candidate_path.write_bytes(b"partial")
    exp._restore_candidate_from_external(state)
    assert candidate_path.read_bytes() == candidate_raw

    corrupted = copy.deepcopy(candidate_payload)
    evidence = corrupted["developmentEvidence"]
    assert isinstance(evidence, dict)
    evidence["pbo"] = {"pbo": "1"}
    with pytest.raises(exp.EvidenceError, match="evidence hash mismatch"):
        exp._candidate_development_evidence(corrupted)


def test_finalize_enforces_freeze_and_rejects_repo_only_result(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    state = tmp_path / "state"
    shared = tmp_path / "shared"
    state.mkdir()
    shared.mkdir()
    calls: list[str] = []

    monkeypatch.setattr(
        exp,
        "validate_roots",
        lambda state_root, shared_root: (state_root, shared_root),
    )

    def fake_load_freeze(
        state_root: Path,
        shared_root: Path,
    ) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any], tuple[str, ...]]:
        del state_root, shared_root
        calls.append("load_freeze")
        return {}, {}, {}, ()

    monkeypatch.setattr(exp, "load_freeze", fake_load_freeze)
    restored = {"measurementVerdict": "UNMEASURED"}
    monkeypatch.setattr(
        exp,
        "_restore_result_from_receipt",
        lambda state_root: restored,
    )
    assert exp.finalize_terminal(state, shared) is restored
    assert calls == ["load_freeze"]

    result_path = tmp_path / "result.v1.json"
    result_path.write_text("{}\n")
    monkeypatch.setattr(exp, "RESULT_PATH", result_path)
    monkeypatch.setattr(
        exp,
        "_restore_result_from_receipt",
        lambda state_root: None,
    )
    with pytest.raises(exp.EvidenceError, match="repo-only result"):
        exp.finalize_terminal(state, shared)


def test_failed_development_marker_publication_does_not_terminalize(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    state = tmp_path / "state"
    shared = tmp_path / "shared"
    monkeypatch.setattr(
        exp,
        "validate_roots",
        lambda state_root, shared_root: (state_root, shared_root),
    )
    monkeypatch.setattr(exp, "RESULT_PATH", tmp_path / "missing-result.json")
    monkeypatch.setattr(exp, "CANDIDATE_SEAL_PATH", tmp_path / "missing-candidate.json")
    monkeypatch.setattr(exp, "load_protocol", lambda: ({}, "protocol-sha"))
    monkeypatch.setattr(exp, "_assert_run_stage_git", lambda protocol: "freeze-commit")
    monkeypatch.setattr(
        exp,
        "load_freeze",
        lambda state_root, shared_root: ({}, {}, {}, ()),
    )
    monkeypatch.setattr(
        exp,
        "preflight",
        lambda state_root, shared_root: {"freezeCommit": "freeze-commit"},
    )
    monkeypatch.setattr(exp, "sha256_path", lambda path: "a" * 64)
    monkeypatch.setattr(
        exp,
        "exclusive_write",
        lambda path, raw: (_ for _ in ()).throw(OSError("publish failed")),
    )
    monkeypatch.setattr(
        exp,
        "_terminal_unmeasured",
        lambda *args: (_ for _ in ()).throw(AssertionError("marker failure must not terminalize")),
    )

    with pytest.raises(OSError, match="publish failed"):
        exp.run_experiment(state, shared)


def test_terminal_lifecycle_presence_matrix() -> None:
    created = "a" * 64
    absent = "NOT_CREATED"

    def provenance(
        *,
        candidate: bool = False,
        holdout: bool = False,
    ) -> dict[str, object]:
        return {
            "preflightReceiptSha256": created,
            "developmentRunMarkerSha256": created,
            "candidateSealSha256": created if candidate else absent,
            "externalCandidateSealSha256": created if candidate else absent,
            "holdoutOpenMarkerSha256": created if holdout else absent,
        }

    development_failure = _development_failure_result()
    exp._validate_lifecycle_presence(
        development_failure,
        provenance(),
    )
    with pytest.raises(exp.EvidenceError, match="development-failure"):
        exp._validate_lifecycle_presence(
            development_failure,
            provenance(candidate=True, holdout=True),
        )

    measured_holdout: dict[str, object] = {
        "measurementVerdict": "GO",
        "development": {"passed": True},
        "holdout": {"state": "MEASURED_SINGLE_OPEN_CHAMPION_ONLY"},
    }
    exp._validate_lifecycle_presence(
        measured_holdout,
        provenance(candidate=True, holdout=True),
    )
    with pytest.raises(exp.EvidenceError, match="measured holdout"):
        exp._validate_lifecycle_presence(measured_holdout, provenance())

    unopened: dict[str, object] = {
        "measurementVerdict": "UNMEASURED",
        "development": {"state": "INVALID_OR_INCOMPLETE"},
        "holdout": {"state": "UNOPENED_TERMINAL_UNMEASURED"},
    }
    exp._validate_lifecycle_presence(unopened, provenance())
    exp._validate_lifecycle_presence(unopened, provenance(candidate=True))
    with pytest.raises(exp.EvidenceError, match="unopened UNMEASURED"):
        exp._validate_lifecycle_presence(
            unopened,
            provenance(candidate=True, holdout=True),
        )

    open_attempted = copy.deepcopy(unopened)
    holdout_packet = open_attempted["holdout"]
    assert isinstance(holdout_packet, dict)
    holdout_packet["state"] = "OPEN_ATTEMPTED_INVALID"
    exp._validate_lifecycle_presence(
        open_attempted,
        provenance(candidate=True, holdout=True),
    )
    with pytest.raises(exp.EvidenceError, match="open-attempted"):
        exp._validate_lifecycle_presence(open_attempted, provenance())

    missing_development_marker = provenance()
    missing_development_marker["developmentRunMarkerSha256"] = absent
    with pytest.raises(exp.EvidenceError, match="preflight or development"):
        exp._validate_lifecycle_presence(
            development_failure,
            missing_development_marker,
        )


def test_not_created_provenance_rejects_broken_symlink(tmp_path: Path) -> None:
    path = tmp_path / "broken"
    path.symlink_to(tmp_path / "missing-target")
    with pytest.raises(exp.EvidenceError, match="says NOT_CREATED"):
        exp._verify_bound_optional_file(
            {"artifact": "NOT_CREATED"},
            "artifact",
            path,
        )


def test_checksum_verifier_requires_exact_unique_packet_set(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    packet = tmp_path / "packet"
    packet.mkdir()
    result_path = packet / "result.v1.json"
    checksums_path = packet / "SHA256SUMS"
    monkeypatch.setattr(exp, "PACKET_DIR", packet)
    monkeypatch.setattr(exp, "RESULT_PATH", result_path)
    monkeypatch.setattr(exp, "CHECKSUMS_PATH", checksums_path)

    result = _development_failure_result()
    result["provenance"] = {"candidateSealSha256": "NOT_CREATED"}
    for name in exp.REQUIRED_PACKET_FILES:
        path = packet / name
        path.write_bytes(exp.canonical_bytes(result) if name == "result.v1.json" else b"fixture\n")

    sealed = exp.seal_checksums()
    assert sealed["fileCount"] == len(exp.REQUIRED_PACKET_FILES)
    assert exp._verify_checksums() == len(exp.REQUIRED_PACKET_FILES)

    unlisted = packet / "unlisted.txt"
    unlisted.write_text("not sealed\n")
    with pytest.raises(exp.EvidenceError, match="file set"):
        exp._verify_checksums()
    unlisted.unlink()

    first_row = checksums_path.read_text().splitlines()[0]
    checksums_path.write_text(f"{first_row}\n{first_row}\n")
    with pytest.raises(exp.EvidenceError, match="duplicate, unsorted, or incomplete"):
        exp._verify_checksums()


def test_pair_paths_rejects_escaping_symbol_component() -> None:
    pair = {
        "symbol": "../AUSDT",
        "month": "2025-01",
        "zipKey": "irrelevant",
        "checksumKey": "irrelevant",
    }
    with pytest.raises(exp.EvidenceError, match="safe UTF-8 path component"):
        exp._pair_paths(exp.DEFAULT_SHARED_ROOT, pair)


def test_protocol_preserves_shared_corpus_and_authority_boundaries() -> None:
    protocol = _protocol()

    assert protocol["data"]["sharedCorpusPolicy"].startswith("READ_ONLY")
    assert protocol["data"]["currentExchangeInfoMaySelectUniverse"] is False
    assert protocol["trials"]["runnerUpOrSubgroupRescue"] is False
    assert protocol["consumer"]["capitalAuthority"] == "NONE"
    assert protocol["verdict"]["capitalAuthorityAlways"] == "NONE"
