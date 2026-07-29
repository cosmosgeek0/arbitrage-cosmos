"""Focused, network-free acceptance tests for the sealed S-1H evaluator."""

from __future__ import annotations

import hashlib
import json
import math
import random
import zipfile
from pathlib import Path

import pytest
from research.s1h import experiment as exp


def _bar(index: int, *, price: float = 100.0, quote_volume: float = 20_000_000.0) -> exp.Bar:
    timestamp = 1_750_000_000_000 + index * exp.BAR_MS
    return exp.Bar(timestamp, price, price, price, price, quote_volume)


def _market(length: int = 400) -> exp.MarketData:
    timestamps = tuple(_bar(index).timestamp_ms for index in range(length))
    symbols: dict[str, exp.SymbolData] = {}
    for symbol in exp.SYMBOLS:
        spot = tuple(_bar(index) for index in range(length))
        perpetual = tuple(_bar(index, price=100.1) for index in range(length))
        symbols[symbol] = exp.SymbolData(symbol, timestamps, spot, perpetual, ())
    return exp.MarketData(timestamps, symbols)


def test_trial_family_is_complete_and_unique() -> None:
    family = exp.trial_family()
    assert len(family) == 4
    assert len({trial.trial_id for trial in family}) == 4
    assert {trial.entry_z for trial in family} == {2.5, 3.5}
    assert {trial.maximum_hold_bars for trial in family} == {72, 288}


def test_source_inventory_is_exact_and_unique() -> None:
    rows = exp.source_inventory_rows()
    assert len(rows) == 96
    assert len({row["key"] for row in rows}) == 96
    assert sum(row["phase"] == "development" for row in rows) == 72
    assert sum(row["phase"] == "holdout" for row in rows) == 24
    assert all(row["checksumUrl"].endswith(".zip.CHECKSUM") for row in rows)


def test_source_inventory_contains_every_series() -> None:
    kinds = {row["kind"] for row in exp.source_inventory_rows()}
    assert kinds == {
        "spotKlines",
        "perpetualKlines",
        "markPriceKlines",
        "fundingRate",
    }


def test_canonical_bytes_are_sorted_and_terminated() -> None:
    assert exp.canonical_bytes({"b": 2, "a": 1}) == b'{"a":1,"b":2}\n'


def test_checksum_sidecar_accepts_expected_filename() -> None:
    digest = "a" * 64
    raw = f"{digest}  BTCUSDT-5m-2026-06.zip\n".encode()
    assert exp.parse_checksum_sidecar(raw, expected_filename="BTCUSDT-5m-2026-06.zip") == digest


@pytest.mark.parametrize(
    ("raw", "filename"),
    [
        (b"bad\n", "x.zip"),
        (b"xyz  x.zip\n", "x.zip"),
        ((("a" * 64) + "  y.zip\n").encode(), "x.zip"),
    ],
)
def test_checksum_sidecar_rejects_malformed_rows(raw: bytes, filename: str) -> None:
    with pytest.raises(exp.EvidenceError):
        exp.parse_checksum_sidecar(raw, expected_filename=filename)


def test_timestamp_normalizes_spot_microseconds() -> None:
    assert exp.normalized_timestamp_ms("1750000000000000") == 1_750_000_000_000
    assert exp.normalized_timestamp_ms("1750000000000") == 1_750_000_000_000


@pytest.mark.parametrize("raw", ["nope", "100", "999999999999999999999"])
def test_timestamp_rejects_invalid_values(raw: str) -> None:
    with pytest.raises(exp.EvidenceError):
        exp.normalized_timestamp_ms(raw)


def test_median_and_mad() -> None:
    location, mad = exp.median_and_mad((1.0, 2.0, 3.0, 100.0))
    assert location == 2.5
    assert mad == 1.0


def test_block_indices_have_requested_length_and_bounds() -> None:
    rng = random.Random(7)
    indices = exp.circular_block_indices(length=11, block_length=3, rng=rng)
    assert len(indices) == 11
    assert min(indices) >= 0
    assert max(indices) < 11


def test_block_statistics_are_deterministic() -> None:
    matrix = {
        "A": tuple(0.001 if index % 3 else 0.0 for index in range(56)),
        "B": tuple(-0.001 if index % 4 else 0.0 for index in range(56)),
    }
    first = exp.block_statistics(matrix, replicates=256, seed=42, block_length=7)
    second = exp.block_statistics(matrix, replicates=256, seed=42, block_length=7)
    assert first == second
    assert first["oneSidedPValue"]["A"] < first["oneSidedPValue"]["B"]


def test_holm_is_step_down_not_independent_thresholding() -> None:
    decisions = exp.holm_decisions({"A": 0.01, "B": 0.03, "C": 0.04}, alpha=0.05)
    assert decisions == {"A": True, "B": False, "C": False}


def test_pbo_has_all_seventy_splits() -> None:
    matrix = {
        trial_id: tuple(math.sin(index + trial_index) / 10_000.0 for index in range(80))
        for trial_index, trial_id in enumerate(("A", "B", "C", "D"))
    }
    result = exp.pbo_diagnostic(matrix)
    assert result["splits"] == 70
    assert 0.0 <= result["pbo"] <= 1.0
    assert result["diagnosticOnly"] is True


def test_simulation_uses_next_bar_and_routes_richer_asset() -> None:
    data = _market()
    calibrations = tuple(exp.Calibration(0.0, 1.0, 0.0, 0.0) for _ in data.timestamps_ms)
    btc_basis = [0.0] * len(data.timestamps_ms)
    eth_basis = [5.0] * len(data.timestamps_ms)
    relative = [0.0] * len(data.timestamps_ms)
    relative[10] = 3.0
    relative[11] = 3.0
    relative[12] = 3.0
    relative[13] = 0.0
    run = exp.simulate_trial(
        data,
        calibrations,
        btc_basis,
        eth_basis,
        relative,
        exp.Trial("TEST", 2.5, 72),
        evaluation_start_ms=data.timestamps_ms[0],
        evaluation_end_ms=data.timestamps_ms[-1] + exp.BAR_MS,
    )
    assert len(run.trades) == 1
    trade = run.trades[0]
    assert trade.asset == "ETHUSDT"
    assert trade.entry_index == 12
    assert trade.exit_index == 14
    assert trade.exit_reason == "RELATIVE_RESIDUAL_NORMALIZED"


def test_trade_pnl_charges_all_four_fees_and_adverse_execution() -> None:
    trade = exp.Trade(
        asset="BTCUSDT",
        entry_index=1,
        exit_index=2,
        entry_timestamp_ms=1,
        exit_timestamp_ms=2,
        quantity=5.0,
        spot_entry=100.0,
        spot_exit=100.0,
        perpetual_entry=100.0,
        perpetual_exit=100.0,
        adverse_funding_usd=0.0,
        omitted_favorable_funding_usd=0.0,
        minimum_causal_quote_volume_usd=20_000_000.0,
        exit_reason="TEST",
    )
    assert exp.trade_pnl(trade, exp.CostScenario("fee", 10.0, 5.0, 0.0)) == pytest.approx(-1.5)
    assert exp.trade_pnl(trade, exp.CostScenario("cost", 10.0, 5.0, 2.0)) < -1.5


def test_funding_discards_positive_and_charges_negative() -> None:
    timestamps = tuple(_bar(index).timestamp_ms for index in range(5))
    bars = tuple(_bar(index) for index in range(5))
    symbol_data = exp.SymbolData(
        "BTCUSDT",
        timestamps,
        bars,
        bars,
        (
            exp.FundingEvent(timestamps[1], 0.001, 100.0),
            exp.FundingEvent(timestamps[2], -0.002, 100.0),
        ),
    )
    adverse, favorable = exp.funding_cashflows(
        symbol_data,
        entry_timestamp_ms=timestamps[0],
        exit_timestamp_ms=timestamps[3],
        quantity=2.0,
    )
    assert adverse == pytest.approx(0.4)
    assert favorable == pytest.approx(0.2)


def test_capacity_is_explicitly_proxy_only() -> None:
    trade = exp.Trade(
        "BTCUSDT",
        1,
        2,
        1,
        2,
        1.0,
        100.0,
        100.0,
        100.0,
        100.0,
        0.0,
        0.0,
        20_000_000.0,
        "TEST",
    )
    result = exp.capacity_metrics((trade,))
    assert result["basePass"] is True
    assert result["stressPass"] is True
    assert result["executableCapacity"] == "UNMEASURED"


def test_empty_capacity_fails() -> None:
    result = exp.capacity_metrics(())
    assert result["basePass"] is False
    assert result["stressPass"] is False


def test_exclusive_write_never_overwrites(tmp_path: Path) -> None:
    target = tmp_path / "evidence.json"
    exp.exclusive_write(target, b"first")
    with pytest.raises(exp.EvidenceError):
        exp.exclusive_write(target, b"second")
    assert target.read_bytes() == b"first"


def test_kline_parser_supports_header_and_no_header(tmp_path: Path) -> None:
    archive_path = tmp_path / "bars.zip"
    csv_text = (
        "open_time,open,high,low,close,volume,close_time,quote_volume\n"
        "1750000000000000,100,101,99,100.5,1,1750000299999999,1000\n"
    )
    with zipfile.ZipFile(archive_path, "w") as archive:
        archive.writestr("bars.csv", csv_text)
    bars = exp.parse_kline_archive(archive_path)
    assert len(bars) == 1
    assert bars[0].timestamp_ms == 1_750_000_000_000
    assert bars[0].quote_volume == 1000.0


def test_funding_parser_uses_actual_rate_column(tmp_path: Path) -> None:
    archive_path = tmp_path / "funding.zip"
    csv_text = "calc_time,funding_interval_hours,last_funding_rate\n1750000000000,8,-0.0001\n"
    with zipfile.ZipFile(archive_path, "w") as archive:
        archive.writestr("funding.csv", csv_text)
    assert exp.parse_funding_archive(archive_path) == [(1_750_000_000_000, -0.0001)]


def test_result_rounding_rejects_non_finite() -> None:
    with pytest.raises(exp.EvidenceError):
        exp.round_float_values({"bad": math.inf})


def test_protocol_declares_no_authority() -> None:
    protocol = json.loads(exp.PROTOCOL_PATH.read_text(encoding="utf-8"))
    assert protocol["scope"]["publicOnly"] is True
    assert protocol["scope"]["executionAuthority"] == "NONE"
    assert protocol["gates"]["capitalVerdictRegardlessOfResearch"] == "NO_GO"
    assert protocol["distinctness"]["notS1G"]


def test_sha256_bytes_matches_hashlib() -> None:
    raw = b"s1h"
    assert exp.sha256_bytes(raw) == hashlib.sha256(raw).hexdigest()
