from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal as D

import pytest
from research.s1j.experiment import (
    DailyBar,
    EvidenceError,
    FundingEvent,
    MarketData,
    Scenario,
    WeekReference,
    apply_scenario,
    causal_liquidity,
    complete_funding_window,
    family_bootstrap,
    funding_mark_hour,
    holm_adjust,
    max_drawdown,
    normalize_timestamp,
    pbo_cscv,
    positive_funding_score,
    scenarios_from_protocol,
    trials_from_ledger,
    unlevered_equal_base_quantity,
    weekly_dates,
)


def test_timestamp_normalizes_milliseconds_and_microseconds() -> None:
    expected = datetime(2025, 1, 1, tzinfo=UTC)
    assert normalize_timestamp("1735689600000") == expected
    assert normalize_timestamp("1735689600000000") == expected


def test_funding_plus_one_millisecond_uses_same_hour_mark() -> None:
    funding_time = normalize_timestamp("1717200000001")
    assert funding_time.microsecond == 1000
    assert funding_mark_hour(funding_time) == datetime(2024, 6, 1, tzinfo=UTC)


def test_schedules_have_frozen_51_rows() -> None:
    assert len(weekly_dates("2024-07-01", "2025-06-16")) == 51
    assert len(weekly_dates("2025-07-07", "2026-06-22")) == 51


def test_declared_family_is_exactly_twelve() -> None:
    trials = trials_from_ledger()
    assert len(trials) == 12
    assert {trial.lookback_days for trial in trials} == {3, 7, 14, 28}
    assert {trial.slots for trial in trials} == {3, 5, 10}


def test_maker_is_non_authoritative_and_account_scenarios_exist() -> None:
    scenarios = scenarios_from_protocol()
    assert scenarios["MAKER_SENSITIVITY"].decision_authority is False
    assert scenarios["PROXY"].decision_authority is True
    assert scenarios["STRESS"].adverse_bps > scenarios["PROXY"].adverse_bps


def test_causal_liquidity_uses_only_prior_complete_days() -> None:
    entry = date(2025, 1, 13)
    spot = {
        entry - timedelta(days=offset): DailyBar(D(1), D(100 + offset)) for offset in range(1, 8)
    }
    futures = {
        entry - timedelta(days=offset): DailyBar(D(1), D(90 + offset)) for offset in range(1, 8)
    }
    data = MarketData({"AAAUSDT": spot}, {"AAAUSDT": futures}, {}, {})
    assert causal_liquidity(data, "AAAUSDT", entry) == D(91)
    del spot[entry - timedelta(days=7)]
    assert causal_liquidity(data, "AAAUSDT", entry) is None


def test_funding_signal_excludes_entry_timestamp_and_requires_latest_positive() -> None:
    entry = date(2025, 1, 13)
    entry_dt = datetime.combine(entry, datetime.min.time(), tzinfo=UTC)
    events = [
        FundingEvent(entry_dt - timedelta(days=2), 24, D("0.0001")),
        FundingEvent(entry_dt - timedelta(days=1), 24, D("0.0002")),
        FundingEvent(entry_dt, 24, D("-1")),
    ]
    data = MarketData({}, {}, {}, {"AAAUSDT": events})
    assert positive_funding_score(data, "AAAUSDT", entry, 3) == D("0.0001")
    data.funding["AAAUSDT"][-2] = FundingEvent(entry_dt - timedelta(days=1), 24, D("-0.0002"))
    assert positive_funding_score(data, "AAAUSDT", entry, 3) is None


def test_holding_window_excludes_entry_hour_plus_one_millisecond() -> None:
    start = datetime(2025, 1, 6, tzinfo=UTC)
    end = start + timedelta(days=7)
    events = [
        FundingEvent(start + timedelta(milliseconds=1), 8, D("0.5")),
        *[
            FundingEvent(start + timedelta(hours=hour), 8, D("0.0001"))
            for hour in range(8, 7 * 24, 8)
        ],
    ]
    data = MarketData({}, {}, {}, {"AAAUSDT": events})
    selected = complete_funding_window(data, "AAAUSDT", start, end, strict_start=True)
    assert selected is not None
    assert events[0] not in selected


def _reference(net_gross: D = D(10)) -> WeekReference:
    entry = date(2025, 1, 6)
    return WeekReference(
        entry,
        True,
        None,
        ("AAAUSDT",),
        ("AAAUSDT",),
        net_gross,
        D(0),
        D(0),
        D(500),
        D(500),
        D(500),
        D(500),
        (D(100),),
        tuple(
            (entry + timedelta(days=offset), net_gross * D(offset) / D(7)) for offset in range(8)
        ),
    )


def test_cost_identity_and_stress_monotonicity() -> None:
    proxy = Scenario("PROXY", D(10), D(10), D(5), D(5), D(2), D("0.5"), True)
    stress = Scenario("STRESS", D(10), D(10), D(10), D(10), D(5), D("0.25"), True)
    proxy_week = apply_scenario(_reference(), proxy)
    stress_week = apply_scenario(_reference(), stress)
    assert proxy_week.net is not None
    assert stress_week.net is not None
    assert stress_week.net < proxy_week.net
    assert proxy_week.spot_pnl is not None
    assert proxy_week.futures_pnl is not None
    assert proxy_week.funding_pnl is not None
    assert proxy_week.spot_fees is not None
    assert proxy_week.futures_fees is not None
    assert proxy_week.adverse_execution is not None
    assert proxy_week.net == (
        proxy_week.spot_pnl
        + proxy_week.futures_pnl
        + proxy_week.funding_pnl
        - proxy_week.spot_fees
        - proxy_week.futures_fees
        - proxy_week.adverse_execution
    )


def test_capacity_is_proxy_and_scales_from_weakest_ratio() -> None:
    scenario = Scenario("PROXY", D(10), D(10), D(5), D(5), D(2), D("0.5"), True)
    week = apply_scenario(_reference(), scenario)
    assert week.supported_account_capital == D(5)


def test_equal_base_sizing_never_exceeds_either_unlevered_budget() -> None:
    quantity = unlevered_equal_base_quantity(D(100), D(95), D(105))
    assert quantity * D(95) <= D(100)
    assert quantity * D(105) <= D(100)


def test_drawdown_uses_daily_path_and_exit() -> None:
    scenario = Scenario("ZERO", D(0), D(0), D(0), D(0), D(0), None, False)
    week = apply_scenario(_reference(D(-20)), scenario)
    usd, pct = max_drawdown([week])
    assert usd == D(20)
    assert pct == D(2)


def test_holm_is_monotone_in_sorted_order() -> None:
    adjusted = holm_adjust({"a": 0.001, "b": 0.02, "c": 0.5})
    assert adjusted["a"] == pytest.approx(0.003)
    assert adjusted["b"] == pytest.approx(0.04)
    assert adjusted["c"] == pytest.approx(0.5)


def test_joint_bootstrap_shape_and_reproducibility() -> None:
    matrix = {
        f"T{index:02d}": [D(index) / D(100) + D(week % 3) for week in range(51)]
        for index in range(12)
    }
    first = family_bootstrap(matrix, 4, 64, 7, 0.05)
    second = family_bootstrap(matrix, 4, 64, 7, 0.05)
    assert first == second
    assert set(first["rawP"]) == set(matrix)


def test_pbo_uses_all_924_splits_and_is_deterministic() -> None:
    matrix = {f"T{index:02d}": [D((week + index) % 5) for week in range(51)] for index in range(12)}
    report = pbo_cscv(matrix)
    assert report["splitCount"] == 924
    assert 0 <= float(report["pbo"]) <= 1
    assert report == pbo_cscv(matrix)


def test_invalid_timestamp_fails_closed() -> None:
    with pytest.raises(EvidenceError, match="invalid timestamp"):
        normalize_timestamp("not-a-timestamp")
