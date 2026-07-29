"""Focused hostile tests for the frozen S-1U evaluator."""

from __future__ import annotations

import itertools
from pathlib import Path

import pytest
from research.s1u.experiment import (
    BAR_MS,
    DAY_MS,
    Bar,
    CostScenario,
    Selection,
    Trial,
    bootstrap_totals,
    canonical_bytes,
    circular_block_indices,
    cohort_pnl,
    common_settlement_events,
    cscv_pbo,
    evaluate_trials,
    imbalance_for_bars,
    lagged_imbalance,
    parse_utc_ms,
    position_pnl,
    read_json,
    select_atomic_tails,
)

PACKET = Path(__file__).resolve().parent


def bar(
    open_ms: int,
    *,
    price: float = 100.0,
    quote: float = 100.0,
    taker_buy: float = 50.0,
) -> Bar:
    return Bar(
        open_ms=open_ms,
        close_ms=open_ms + BAR_MS - 1,
        open_price=price,
        quote_volume=quote,
        taker_buy_quote_volume=taker_buy,
    )


def test_timestamp_parser_handles_archive_units_and_utc_text() -> None:
    expected = 1_751_328_000_000
    assert parse_utc_ms(expected) == expected
    assert parse_utc_ms(expected * 1_000) == expected
    assert parse_utc_ms(expected * 1_000_000) == expected
    assert parse_utc_ms("2025-07-01 00:00:00") == expected
    assert parse_utc_ms("2025-07-01T00:00:00Z") == expected


def test_imbalance_semantics_are_bounded_and_quote_weighted() -> None:
    rows = [
        bar(0, quote=100.0, taker_buy=75.0),
        bar(BAR_MS, quote=300.0, taker_buy=75.0),
    ]
    assert imbalance_for_bars(rows) == pytest.approx(-0.25)
    with pytest.raises(ValueError, match="semantic range"):
        imbalance_for_bars([bar(0, quote=100.0, taker_buy=110.0)])


def test_lagged_window_excludes_settlement_and_later_flow() -> None:
    settlement = 12 * BAR_MS
    rows = [bar(index * BAR_MS, taker_buy=10.0 + index) for index in range(14)]
    closes = [row.close_ms for row in rows]
    value = lagged_imbalance(rows, closes, settlement, 30, BAR_MS)
    expected_rows = rows[5:11]
    assert value == pytest.approx(imbalance_for_bars(expected_rows))
    mutated = list(rows)
    mutated[11] = bar(11 * BAR_MS, taker_buy=100.0)
    mutated[12] = bar(12 * BAR_MS, taker_buy=100.0)
    assert lagged_imbalance(
        mutated, [row.close_ms for row in mutated], settlement, 30, BAR_MS
    ) == pytest.approx(value)


def test_lagged_window_refuses_gap() -> None:
    settlement = 12 * BAR_MS
    rows = [bar(index * BAR_MS) for index in range(11) if index != 8]
    assert lagged_imbalance(rows, [row.close_ms for row in rows], settlement, 30, BAR_MS) is None


def test_lagged_window_refuses_older_substitute_for_missing_latest_bar() -> None:
    settlement = 12 * BAR_MS
    rows = [bar(index * BAR_MS) for index in range(10)]
    assert lagged_imbalance(rows, [row.close_ms for row in rows], settlement, 30, BAR_MS) is None


def test_atomic_tail_boundary_ties_make_the_whole_cohort_cash() -> None:
    symbols = ("A", "B", "C", "D", "E", "F")
    clean = {symbol: float(index) for index, symbol in enumerate(symbols)}
    selection = select_atomic_tails(clean, symbols, 2)
    assert selection is not None
    assert selection.longs == ("A", "B")
    assert selection.shorts == ("E", "F")
    low_tie = dict(clean)
    low_tie["C"] = low_tie["B"]
    assert select_atomic_tails(low_tie, symbols, 2) is None
    high_tie = dict(clean)
    high_tie["D"] = high_tie["E"]
    assert select_atomic_tails(high_tie, symbols, 2) is None


def test_observed_settlement_intersection_has_no_synthetic_eight_hour_clock() -> None:
    base = parse_utc_ms("2025-07-02T00:00:00Z")
    settlements = {
        "A": [base + 3],
        "B": [base - 7],
        "C": [base + 12],
        "D": [base],
        "E": [base + 1],
        "F": [base - 2],
    }
    events = common_settlement_events(
        settlements, tuple(settlements), base - BAR_MS, base + BAR_MS, 30_000
    )
    assert events == [(base, {symbol: times[0] for symbol, times in settlements.items()})]
    settlements["F"] = [base + 31_000]
    malformed = common_settlement_events(
        settlements, tuple(settlements), base - BAR_MS, base + BAR_MS, 30_000
    )
    assert len(malformed) == 2
    assert all(set(actual) != set(settlements) for _, actual in malformed)


def test_all_taker_costs_are_charged_twice_and_stress_is_monotone() -> None:
    assert position_pnl(100.0, 100.0, 1, 250.0, 0.001) == pytest.approx(-0.5)
    selection = Selection(
        longs=("A", "B"),
        shorts=("E", "F"),
        imbalance={"A": -0.8, "B": -0.6, "C": 0.0, "D": 0.1, "E": 0.6, "F": 0.8},
    )
    prices = {
        "A": (100.0, 101.0),
        "B": (100.0, 101.0),
        "E": (100.0, 99.0),
        "F": (100.0, 99.0),
    }
    scenarios = [
        CostScenario("base", 0.0005, 0.0002),
        CostScenario("stress", 0.0008, 0.0005),
        CostScenario("severe", 0.0010, 0.0010),
    ]
    pnl = cohort_pnl(prices, selection, 250.0, scenarios)
    assert pnl["base"] > pnl["stress"] > pnl["severe"]


def synthetic_market() -> tuple[dict[str, list[Bar]], dict[str, list[int]], int]:
    protocol = read_json(PACKET / "protocol.v1.json")
    symbols = [str(symbol) for symbol in protocol["universe"]["symbols"]]
    event = parse_utc_ms("2025-07-02T00:00:00Z")
    first = event - DAY_MS
    last = event + 60 * 60 * 1000
    taker_shares = dict(zip(symbols, (0.05, 0.20, 0.40, 0.60, 0.80, 0.95), strict=True))
    bars: dict[str, list[Bar]] = {}
    for symbol in symbols:
        rows: list[Bar] = []
        for open_ms in range(first, last + BAR_MS, BAR_MS):
            price = 100.0
            if open_ms >= event + 20 * 60 * 1000:
                price = 101.0 if taker_shares[symbol] < 0.5 else 99.0
            rows.append(
                bar(
                    open_ms,
                    price=price,
                    quote=1_000_000.0,
                    taker_buy=1_000_000.0 * taker_shares[symbol],
                )
            )
        bars[symbol] = rows
    settlements = {symbol: [event, event + DAY_MS] for symbol in symbols}
    return bars, settlements, event


def test_evaluator_builds_only_complete_atomic_cohort() -> None:
    protocol = read_json(PACKET / "protocol.v1.json")
    bars, settlements, event = synthetic_market()
    days, ledgers, event_summary = evaluate_trials(
        protocol, bars, settlements, event, event + DAY_MS, [Trial(30, 15)]
    )
    ledger = ledgers["L030_H015"]
    assert days == ["2025-07-02"]
    assert event_summary["candidate_union_settlement_count"] == 1
    assert event_summary["complete_observed_settlement_count"] == 1
    assert ledger.candidate_count == 1
    assert ledger.active_count == 1
    assert ledger.cash_reasons == {}
    assert ledger.long_counts == {
        str(protocol["universe"]["symbols"][0]): 1,
        str(protocol["universe"]["symbols"][1]): 1,
    }
    assert ledger.daily["base"][0] > ledger.daily["stress"][0]


@pytest.mark.parametrize(
    ("mutation", "reason"),
    [
        ("missing_exit", "ENTRY_OR_EXIT_BAR_MISSING"),
        ("later_settlement", "LATER_SETTLEMENT_GUARD_FAILED"),
        ("missing_prior_day", "PRIOR_COMPLETE_DAY_VOLUME_MISSING"),
    ],
)
def test_any_member_failure_turns_entire_cohort_to_cash(mutation: str, reason: str) -> None:
    protocol = read_json(PACKET / "protocol.v1.json")
    bars, settlements, event = synthetic_market()
    target = str(protocol["universe"]["symbols"][0])
    if mutation == "missing_exit":
        exit_ms = event + 20 * 60 * 1000
        bars[target] = [row for row in bars[target] if row.open_ms != exit_ms]
    elif mutation == "later_settlement":
        settlements[target] = [event, event + 10 * 60 * 1000]
    else:
        missing = event - DAY_MS + 3 * BAR_MS
        bars[target] = [row for row in bars[target] if row.open_ms != missing]
    _, ledgers, _ = evaluate_trials(
        protocol, bars, settlements, event, event + DAY_MS, [Trial(30, 15)]
    )
    ledger = ledgers["L030_H015"]
    expected_candidates = 2 if mutation == "later_settlement" else 1
    assert ledger.candidate_count == expected_candidates
    assert ledger.active_count == 0
    expected_reasons = {reason: 1}
    if mutation == "later_settlement":
        expected_reasons["SETTLEMENT_COHORT_INVALID"] = 1
    assert ledger.cash_reasons == expected_reasons
    assert ledger.daily["base"] == [0.0]
    assert ledger.daily["stress"] == [0.0]
    assert ledger.daily["severe"] == [0.0]


def test_bootstrap_and_pbo_are_deterministic_and_complete() -> None:
    samples_a = circular_block_indices(24, 32, 7, 20260729)
    samples_b = circular_block_indices(24, 32, 7, 20260729)
    assert samples_a == samples_b
    series = [float(index % 5 - 2) for index in range(24)]
    assert bootstrap_totals(series, samples_a) == bootstrap_totals(series, samples_b)
    family = {f"T{trial}": [value + trial * 0.01 for value in series] for trial in range(9)}
    pbo = cscv_pbo(family, 12)
    assert pbo["splits"] == 924
    assert 0.0 <= pbo["pbo"] <= 1.0


def test_protocol_freezes_exact_nine_contrarian_trials() -> None:
    protocol = read_json(PACKET / "protocol.v1.json")
    lookbacks = protocol["signal"]["lookback_minutes"]
    horizons = protocol["response"]["horizon_minutes"]
    trials = list(itertools.product(lookbacks, horizons))
    assert len(trials) == 9
    assert protocol["signal"]["direction"] == "contrarian"
    assert protocol["clock"]["nominal_schedule_forbidden"] is True
    assert protocol["clock"]["event_funding_cashflow_booked"] is False
    assert protocol["allocation"]["partial_cohort"] is False
    assert canonical_bytes(protocol).endswith(b"\n")
