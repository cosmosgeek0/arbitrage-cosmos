from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

import pytest
from research.vg4 import experiment as vg4


def _bar(
    symbol: str,
    day: date,
    *,
    open_price: str = "100",
    close: str = "100",
    quote_volume: str = "20000000",
) -> vg4.Bar:
    opened = (day - date(1970, 1, 1)).days * 86_400_000_000
    return vg4.Bar(
        symbol=symbol,
        day=day,
        open=Decimal(open_price),
        high=max(Decimal(open_price), Decimal(close)) + Decimal("1"),
        low=min(Decimal(open_price), Decimal(close)) - Decimal("1"),
        close=Decimal(close),
        quote_volume=Decimal(quote_volume),
        open_time_us=opened,
        close_time_us=opened + 86_399_999_999,
    )


def _divergence_bars(
    *,
    shock: bool = False,
    symbol: str = "TESTUSDT",
) -> tuple[dict[date, vg4.Bar], date]:
    decision = date(2025, 8, 15)
    start = decision - timedelta(days=35)
    bars = {day: _bar(symbol, day) for day in vg4.date_range(start, decision + timedelta(days=10))}
    pivot = decision - timedelta(days=1)
    closes = ("100", "98", "96", "94", "92", "90")
    for offset, close in zip(range(5, -1, -1), closes, strict=True):
        day = pivot - timedelta(days=offset)
        volume = "10000000" if offset <= 2 else "20000000"
        if shock and offset == 1:
            volume = "31000000"
        bars[day] = _bar(
            symbol,
            day,
            open_price=str(Decimal(close) + Decimal("0.2")),
            close=close,
            quote_volume=volume,
        )
    bars[decision] = _bar(
        symbol,
        decision,
        open_price="90.2",
        close="91.2",
        quote_volume="12000000",
    )
    bars[decision + timedelta(days=1)] = _bar(
        symbol,
        decision + timedelta(days=1),
        open_price="91.0",
        close="92.0",
    )
    bars[decision + timedelta(days=4)] = _bar(
        symbol,
        decision + timedelta(days=4),
        open_price="95.0",
        close="95.0",
    )
    return bars, decision


def test_trial_grid_is_frozen_family_of_twelve() -> None:
    trials = vg4.trial_grid()
    assert len(trials) == 12
    assert len({trial.trial_id for trial in trials}) == 12
    assert {trial.lookback_days for trial in trials} == {5, 10}
    assert {trial.hold_days for trial in trials} == {3, 5, 7}
    assert {trial.volume_ratio_cap for trial in trials} == {
        Decimal("0.65"),
        Decimal("0.85"),
    }


def test_signal_is_price_low_volume_nonconfirmation_then_reclaim() -> None:
    bars, decision = _divergence_bars()
    trial = next(
        item
        for item in vg4.trial_grid()
        if item.lookback_days == 5
        and item.volume_ratio_cap == Decimal("0.65")
        and item.hold_days == 3
    )
    signal = vg4.detect_signal("TESTUSDT", bars, decision, trial)
    assert signal is not None
    assert signal.price_return == Decimal("-0.10")
    assert signal.volume_ratio == Decimal("0.50")
    assert signal.entry_capacity_proxy_usd >= Decimal("1000")
    assert signal.decision_day == decision


def test_signal_rejects_volume_shock_semantically() -> None:
    bars, decision = _divergence_bars(shock=True)
    trial = next(
        item
        for item in vg4.trial_grid()
        if item.lookback_days == 5
        and item.volume_ratio_cap == Decimal("0.85")
        and item.hold_days == 3
    )
    assert vg4.detect_signal("TESTUSDT", bars, decision, trial) is None
    assert vg4.RECENT_SHOCK_REJECT_RATIO < vg4.SIBLING_SHOCK_FLOOR


def test_simulation_enters_next_open_and_exits_declared_open() -> None:
    symbol_bars, decision = _divergence_bars()
    trial = next(
        item
        for item in vg4.trial_grid()
        if item.lookback_days == 5
        and item.volume_ratio_cap == Decimal("0.65")
        and item.hold_days == 3
    )
    simulation = vg4.simulate_segment(
        {"TESTUSDT": symbol_bars},
        trial,
        decision,
        decision + timedelta(days=6),
    )
    assert len(simulation.trades) == 1
    trade = simulation.trades[0]
    assert trade.decision_day == decision
    assert trade.entry_day == decision + timedelta(days=1)
    assert trade.exit_day == decision + timedelta(days=4)
    assert trade.entry_price == Decimal("91.0")
    assert trade.exit_price == Decimal("95.0")
    assert sum(simulation.base_daily_usd) > 0


def test_cost_attribution_is_monotone() -> None:
    gross, fee, adverse, base, stress = vg4.attribution(
        Decimal("1000"),
        Decimal("100"),
        Decimal("102"),
    )
    assert gross > base > stress
    assert fee > 0
    assert adverse > 0
    assert abs((gross - fee - adverse) - base) < Decimal("0.0000000001")


def test_q14_plan_keeps_final_122_days_untouched() -> None:
    samples, plan = vg4.build_validation_plan()
    assert plan.status.value == "VALID"
    assert len(plan.holdout_sample_ids) == 122
    assert vg4.sample_day(plan.holdout_sample_ids[0]) == date(2026, 3, 1)
    assert vg4.sample_day(plan.holdout_sample_ids[-1]) == date(2026, 6, 30)
    fold_ids = {
        sample_id
        for fold in plan.folds
        for sample_id in fold.train_sample_ids + fold.validation_sample_ids
    }
    assert fold_ids.isdisjoint(plan.holdout_sample_ids)
    assert samples.digest() == plan.dataset_digest


def test_shared_draw_bootstrap_is_deterministic_and_bounded() -> None:
    rows = (
        tuple(Decimal("1") for _ in range(28)),
        tuple(Decimal("-1") for _ in range(28)),
    )
    first = vg4.family_bootstrap_p_values(
        rows,
        seed=123,
        block_length=4,
        replicates=64,
    )
    second = vg4.family_bootstrap_p_values(
        rows,
        seed=123,
        block_length=4,
        replicates=64,
    )
    assert first == second
    assert len(first) == 2
    assert all(0 < item.numerator <= item.denominator for item in first)
    assert first[0].numerator * first[1].denominator < first[1].numerator * first[0].denominator


def test_checksum_text_requires_digest_and_exact_name() -> None:
    digest = "a" * 64
    vg4.verify_checksum_text(
        f"{digest}  TESTUSDT-1d-2025-07.zip\n".encode(),
        "TESTUSDT-1d-2025-07.zip",
        digest,
    )
    with pytest.raises(vg4.VG4Error, match="different object"):
        vg4.verify_checksum_text(
            f"{digest}  OTHER.zip\n".encode(),
            "TESTUSDT-1d-2025-07.zip",
            digest,
        )
