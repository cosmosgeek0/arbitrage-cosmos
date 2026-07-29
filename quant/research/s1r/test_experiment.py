"""Synthetic, network-free contract tests for S-1R."""

from __future__ import annotations

import ast
import copy
import json
from decimal import Decimal
from pathlib import Path

import experiment as subject
import pytest


def protocol() -> dict:
    return copy.deepcopy(json.loads(subject.PROTOCOL_PATH.read_text(encoding="utf-8")))


def bar(index: int, price: str = "100", volume: str = "100000000") -> subject.Bar:
    value = Decimal(price)
    return subject.Bar(
        ts_ms=index * subject.FIVE_MINUTES_MS,
        open=value,
        high=value,
        low=value,
        close=value,
        quote_volume=Decimal(volume),
    )


def funding(index: int, rate: str, interval: str = "8") -> subject.Funding:
    return subject.Funding(
        ts_ms=index * 8 * 60 * 60 * 1000,
        interval_hours=Decimal(interval),
        rate=Decimal(rate),
    )


def phase(length: int = 400) -> subject.PhaseData:
    spot = tuple(bar(index, "100") for index in range(length))
    perpetual = tuple(bar(index, "101") for index in range(length))
    return subject.PhaseData(
        phase="development",
        start_ms=0,
        end_ms=length * subject.FIVE_MINUTES_MS,
        bars={
            "BTCUSDT": {
                "spotKlines": spot,
                "perpetualKlines": perpetual,
            }
        },
        funding={
            "BTCUSDT": (
                funding(0, "0.0001"),
                funding(1, "0.0001"),
                funding(2, "0.0001"),
            )
        },
    )


def test_implementation_has_no_network_or_process_import() -> None:
    tree = ast.parse(Path(subject.__file__).read_text(encoding="utf-8"))
    imported: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported.update(alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            imported.add(node.module.split(".")[0])
    assert {
        "aiohttp",
        "http",
        "requests",
        "socket",
        "subprocess",
        "urllib",
    }.isdisjoint(imported)


def test_trial_family_is_exactly_twelve_and_stable() -> None:
    trials = subject.trials_from_protocol(protocol())
    assert len(trials) == 12
    assert trials[0].trial_id == "L06_Z2.5_H15"
    assert trials[-1].trial_id == "L12_Z3.5_H45"


def test_surprise_uses_only_prior_settled_observations() -> None:
    prior = [funding(index, "0.0001") for index in range(6)]
    current = funding(6, "0.0002")
    z = subject.funding_surprise_z(current, prior)
    assert z == Decimal("4")
    changed_current = funding(6, "0.0003")
    assert subject.funding_surprise_z(changed_current, prior) == Decimal("8")
    assert [item.rate for item in prior] == [Decimal("0.0001")] * 6


def test_sign_flip_and_nonpositive_lookback_are_structurally_ineligible() -> None:
    positive = [funding(index, "0.0001") for index in range(6)]
    assert subject.funding_surprise_z(funding(6, "-0.0002"), positive) is None
    positive[-1] = funding(5, "-0.0001")
    assert subject.funding_surprise_z(funding(6, "0.0002"), positive) is None


def test_interval_is_normalized_from_each_archived_row() -> None:
    eight_hour = funding(0, "0.0001", "8")
    four_hour = funding(1, "0.00005", "4")
    assert subject.normalized_funding_bps(
        eight_hour.rate, eight_hour.interval_hours
    ) == subject.normalized_funding_bps(four_hour.rate, four_hour.interval_hours)


def test_entry_open_is_strictly_after_settlement_plus_delay() -> None:
    clocks = tuple(index * subject.FIVE_MINUTES_MS for index in range(20))
    assert subject.first_entry_index(clocks, 0, 60) == 1
    assert clocks[subject.first_entry_index(clocks, 240_000, 60)] == 600_000


def test_spot_microseconds_and_usdm_milliseconds_are_not_interchangeable() -> None:
    assert subject.normalize_kline_timestamp("1751328000000000", "spotKlines") == 1_751_328_000_000
    assert (
        subject.normalize_kline_timestamp("1751328000000", "perpetualKlines") == 1_751_328_000_000
    )
    with pytest.raises(subject.EvidenceError, match="SPOT_TIMESTAMP_UNIT_INVALID"):
        subject.normalize_kline_timestamp("1751328000000", "spotKlines")
    with pytest.raises(subject.EvidenceError, match="USD_M_TIMESTAMP_UNIT_INVALID"):
        subject.normalize_kline_timestamp("1751328000000000", "perpetualKlines")


def test_four_fill_cost_and_paired_gross_identity() -> None:
    quantity = Decimal("5")
    gross = quantity * ((Decimal("101") - Decimal("100")) + (Decimal("102") - Decimal("101")))
    assert gross == Decimal("10")
    cost = subject.trade_cost(
        quantity,
        Decimal("100"),
        Decimal("101"),
        Decimal("102"),
        Decimal("101"),
        protocol()["costs"]["base"],
    )
    assert cost > Decimal("1")
    assert gross - cost < gross


def test_trade_refuses_any_later_settlement_inside_horizon() -> None:
    trial = subject.Trial("L06_Z2.5_H15", 6, Decimal("2.5"), 15)
    candidate = subject.Candidate(
        symbol="BTCUSDT",
        event=funding(0, "0.0002"),
        z=Decimal("3"),
        entry_index=300,
        exit_index=303,
        current_row_implied_next_settlement_ms=303 * subject.FIVE_MINUTES_MS,
    )
    with pytest.raises(
        subject.EvidenceError,
        match="CURRENT_ROW_INTERVAL_TOO_SHORT_FOR_FROZEN_HORIZON",
    ):
        subject.build_trade(trial, candidate, phase(), protocol())


def test_last_observed_event_is_not_selected_using_a_future_row() -> None:
    length = 700
    base_phase = phase(length)
    events = tuple([funding(index, "0.0001") for index in range(6)] + [funding(6, "0.0002")])
    current_phase = subject.PhaseData(
        phase=base_phase.phase,
        start_ms=base_phase.start_ms,
        end_ms=base_phase.end_ms,
        bars=base_phase.bars,
        funding={"BTCUSDT": events},
    )
    trial = subject.Trial("L06_Z2.5_H15", 6, Decimal("2.5"), 15)
    grouped, rejected = subject.trial_candidates(trial, current_phase, protocol())
    assert grouped
    assert "NEXT_SETTLEMENT_UNOBSERVED" not in rejected


def test_actual_early_later_settlement_terminates_instead_of_filtering() -> None:
    base_phase = phase()
    event_time = 299 * subject.FIVE_MINUTES_MS
    event = subject.Funding(event_time, Decimal("8"), Decimal("0.0002"))
    actual_early = subject.Funding(
        302 * subject.FIVE_MINUTES_MS,
        Decimal("1"),
        Decimal("0.0001"),
    )
    current_phase = subject.PhaseData(
        phase=base_phase.phase,
        start_ms=base_phase.start_ms,
        end_ms=base_phase.end_ms,
        bars=base_phase.bars,
        funding={"BTCUSDT": (event, actual_early)},
    )
    candidate = subject.Candidate(
        symbol="BTCUSDT",
        event=event,
        z=Decimal("3"),
        entry_index=300,
        exit_index=303,
        current_row_implied_next_settlement_ms=event_time + (8 * 60 * 60 * 1000),
    )
    trial = subject.Trial("L06_Z2.5_H15", 6, Decimal("2.5"), 15)
    with pytest.raises(
        subject.EvidenceError,
        match="UNEXPECTED_LATER_SETTLEMENT_WITHIN_FROZEN_HORIZON",
    ):
        subject.build_trade(trial, candidate, current_phase, protocol())


def test_severe_drawdown_includes_realized_exit_open_loss() -> None:
    current_phase = phase(2)
    trade = subject.Trade(
        trial_id="T",
        symbol="BTCUSDT",
        event_ts_ms=0,
        entry_index=0,
        exit_index=1,
        entry_ts_ms=0,
        exit_ts_ms=subject.FIVE_MINUTES_MS,
        surprise_z=Decimal("3"),
        quantity=Decimal("1"),
        entry_spot=Decimal("100"),
        entry_perpetual=Decimal("101"),
        exit_spot=Decimal("100"),
        exit_perpetual=Decimal("101"),
        entry_basis_bps=Decimal("1"),
        exit_basis_bps=Decimal("1"),
        gross_pnl=Decimal("0"),
        net_by_cost={
            "base": Decimal("-100"),
            "stress": Decimal("-100"),
            "severe": Decimal("-100"),
            "makerSensitivity": Decimal("-100"),
        },
        capacity_proxy_usd=Decimal("1000"),
    )
    assert subject.severe_drawdown((trade,), current_phase, protocol()) >= Decimal("10")


def test_discovery_requires_exact_cartesian_product() -> None:
    frozen = protocol()
    development = set(frozen["calendar"]["development"]["months"])
    rows = [
        {
            "kind": kind,
            "symbol": symbol,
            "month": month,
            "phase": "development" if month in development else "holdout",
            "sha256": "a" * 64,
            "checksumSidecarSha256": "b" * 64,
        }
        for kind, symbol, month in sorted(subject.expected_source_keys(frozen))
    ]
    discovery = {"archiveBodiesOpened": False, "sources": rows}
    assert len(subject.validate_discovery(discovery, frozen)) == 96
    discovery["sources"] = rows[:-1]
    with pytest.raises(subject.EvidenceError, match="DISCOVERY_COUNT_INVALID"):
        subject.validate_discovery(discovery, frozen)


def test_protocol_machine_enforces_lane_distinctness() -> None:
    frozen = protocol()
    forbidden = set(frozen["distinctness"]["forbiddenSignalInputs"])
    assert "SIGN_CHANGE_OR_SIGN_FLIP" in forbidden
    assert "CUMULATIVE_FUNDING_OR_PERSISTENCE" in forbidden
    assert "FIRST_OR_SECOND_DIFFERENCE_ACCELERATION_OR_VELOCITY" in forbidden
    assert frozen["exit"]["fundingCashflows"] == "EXACTLY_ZERO"
    assert frozen["scope"]["orders"] is False
    assert frozen["scope"]["money"] is False
