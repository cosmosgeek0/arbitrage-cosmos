from __future__ import annotations

import hashlib
import json
import math
import zipfile
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import pytest
from research.vg8 import experiment as e


def _microseconds(value: datetime) -> int:
    return int(value.timestamp() * 1_000_000)


def _archive_row(symbol: str, month: str, raw: bytes, sidecar: bytes) -> dict[str, object]:
    return {
        "symbol": symbol,
        "month": month,
        "zipBytes": len(raw),
        "zipSha256": hashlib.sha256(raw).hexdigest(),
        "checksumBytes": len(sidecar),
        "checksumSha256": hashlib.sha256(sidecar).hexdigest(),
    }


def _write_archive(
    root: Path,
    *,
    symbol: str = "AAAUSDT",
    month: str = "2025-03",
    quote_volume: str = "10000000",
) -> dict[str, object]:
    opened = datetime(2025, 3, 1, tzinfo=UTC)
    open_us = _microseconds(opened)
    close_us = open_us + e.DAY_US - 1
    csv_row = (f"{open_us},10,12,9,11,100,{close_us},{quote_volume},5,50,2,0\n").encode()
    directory = root / "archives" / symbol / month
    directory.mkdir(parents=True)
    archive_path = directory / f"{symbol}-1d-{month}.zip"
    with zipfile.ZipFile(archive_path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(f"{symbol}-1d-{month}.csv", csv_row)
    raw = archive_path.read_bytes()
    sidecar = f"{hashlib.sha256(raw).hexdigest()}  {archive_path.name}\n".encode()
    sidecar_path = directory / f"{archive_path.name}.CHECKSUM"
    sidecar_path.write_bytes(sidecar)
    return _archive_row(symbol, month, raw, sidecar)


def _bars(
    symbols: list[str],
    first: date,
    last: date,
    *,
    boosted: str | None = None,
) -> dict[str, dict[date, e.Bar]]:
    output: dict[str, dict[date, e.Bar]] = {}
    for symbol_index, symbol in enumerate(symbols):
        series: dict[date, e.Bar] = {}
        current = first
        while current <= last:
            recent = current > last - timedelta(days=5)
            volume = 20_000_000.0 + symbol_index * 1000
            if symbol == boosted and recent:
                volume *= 4
            series[current] = e.Bar(
                current,
                10.0 + symbol_index,
                10.1 + symbol_index,
                volume,
            )
            current += timedelta(days=1)
        output[symbol] = series
    return output


def test_month_range_is_closed_and_ordered() -> None:
    assert e.month_range("2025-11", "2026-02") == (
        "2025-11",
        "2025-12",
        "2026-01",
        "2026-02",
    )


def test_protocol_freezes_six_distinct_trials() -> None:
    protocol, digest = e.load_protocol()
    assert len(digest) == 64
    assert protocol["trials"]["trialIds"] == [
        "K03_B00",
        "K03_B02",
        "K05_B00",
        "K05_B02",
        "K08_B00",
        "K08_B02",
    ]
    forbidden = set(protocol["distinctness"]["explicitlyForbiddenInputs"])
    assert {"BREAKOUT", "REVERSAL", "PRICE_RETURN_SIGN_OR_RANK"} <= forbidden


def test_protocol_requires_python_313_shebang_and_hash_seed() -> None:
    protocol, _digest = e.load_protocol()
    assert Path(e.__file__).read_text().splitlines()[0] == "#!/usr/bin/env python3.13"
    assert protocol["runControl"]["pythonExact"] == "3.13.14"
    assert protocol["runControl"]["pythonHashSeed"] == "0"


def test_alternate_state_root_is_rejected(tmp_path: Path) -> None:
    protocol, _digest = e.load_protocol()
    with pytest.raises(e.CustodyError, match="state root differs"):
        e.enforce_state_root(protocol, tmp_path)


def test_alternate_source_root_is_rejected(tmp_path: Path) -> None:
    protocol, _digest = e.load_protocol()
    with pytest.raises(e.CustodyError, match="source root differs"):
        e.enforce_source_root(protocol, tmp_path)


def test_parse_archive_verifies_official_sidecar(tmp_path: Path) -> None:
    row = _write_archive(tmp_path)
    bars = e.parse_archive(tmp_path, row, "AAAUSDT", "2025-03")
    assert len(bars) == 1
    assert bars[0].day == date(2025, 3, 1)
    assert bars[0].quote_volume == 10_000_000


def test_parse_archive_rejects_tampered_zip(tmp_path: Path) -> None:
    row = _write_archive(tmp_path)
    path = tmp_path / "archives/AAAUSDT/2025-03/AAAUSDT-1d-2025-03.zip"
    path.write_bytes(path.read_bytes() + b"tamper")
    with pytest.raises(e.CustodyError, match="byte length changed"):
        e.parse_archive(tmp_path, row, "AAAUSDT", "2025-03")


def test_parse_timestamp_rejects_post_transition_milliseconds() -> None:
    with pytest.raises(e.ArchiveSchemaError, match="not microseconds"):
        e.parse_timestamp("1740787200000", "AAAUSDT", "2025-03")


def test_volume_share_rank_uses_no_price_direction() -> None:
    symbols = [f"S{index:02d}USDT" for index in range(20)]
    entry = date(2025, 7, 1)
    bars = _bars(
        symbols,
        entry - timedelta(days=91),
        entry - timedelta(days=2),
        boosted="S07USDT",
    )
    formation = e.build_formation(bars, symbols, entry, 10_000_000, 20)
    assert formation.valid
    assert formation.acceleration_rank[0] == "S07USDT"
    changed = {
        symbol: {
            day: e.Bar(bar.day, bar.open_price * 100, bar.close_price / 100, bar.quote_volume)
            for day, bar in series.items()
        }
        for symbol, series in bars.items()
    }
    reranked = e.build_formation(changed, symbols, entry, 10_000_000, 20)
    assert reranked.acceleration_rank == formation.acceleration_rank


def test_retention_buffer_is_path_dependent_but_bounded() -> None:
    first = e.Formation(
        date(2025, 7, 1),
        date(2025, 6, 29),
        True,
        None,
        ("AUSDT", "BUSDT", "CUSDT", "DUSDT"),
        ("AUSDT", "BUSDT", "CUSDT", "DUSDT"),
        {},
    )
    second = e.Formation(
        date(2025, 7, 8),
        date(2025, 7, 6),
        True,
        None,
        ("DUSDT", "CUSDT", "BUSDT", "AUSDT"),
        ("DUSDT", "CUSDT", "BUSDT", "AUSDT"),
        {},
    )
    without_buffer = e.select_targets(
        (first, second), e.TrialSpec("K03_B00", 3, 0), benchmark=False
    )
    with_buffer = e.select_targets((first, second), e.TrialSpec("K03_B02", 3, 2), benchmark=False)
    assert without_buffer[1] == ("BUSDT", "CUSDT", "DUSDT")
    assert with_buffer[1] == ("AUSDT", "BUSDT", "CUSDT")


def test_invalid_formation_moves_target_to_cash() -> None:
    formation = e.Formation(date(2025, 7, 1), date(2025, 6, 29), False, "SPARSE", (), (), {})
    assert e.select_targets((formation,), e.TrialSpec("K03_B00", 3, 0), benchmark=False) == ((),)


def test_simulation_charges_costs_and_closes_every_position() -> None:
    symbols = [f"S{index:02d}USDT" for index in range(20)]
    first_entry = date(2025, 7, 1)
    last_day = first_entry + timedelta(days=14)
    bars = _bars(
        symbols,
        first_entry - timedelta(days=91),
        last_day,
        boosted="S07USDT",
    )
    formations = (
        e.build_formation(bars, symbols, first_entry, 10_000_000, 20),
        e.build_formation(
            bars,
            symbols,
            first_entry + timedelta(days=7),
            10_000_000,
            20,
        ),
    )
    spec = e.TrialSpec("K03_B00", 3, 0)
    gross = e.simulation(
        bars=bars,
        formations=formations,
        spec=spec,
        cost=e.Scenario("PUBLIC_GROSS", 0, 0),
        benchmark=False,
    )
    stress = e.simulation(
        bars=bars,
        formations=formations,
        spec=spec,
        cost=e.Scenario("PUBLIC_STRESS", 0.001, 0.0025),
        benchmark=False,
    )
    assert gross.terminal_nav == pytest.approx(1000)
    assert stress.terminal_nav < gross.terminal_nav
    assert stress.fills
    assert stress.daily_returns[-1][0] == last_day
    assert stress.terminal_nav > 0


def test_holm_adjustment_is_monotone() -> None:
    adjusted = e.holm_adjust({"A": 0.001, "B": 0.02, "C": 0.03})
    assert adjusted["A"] == pytest.approx(0.003)
    assert adjusted["B"] == pytest.approx(0.04)
    assert adjusted["C"] == pytest.approx(0.04)


def test_bootstrap_is_deterministic() -> None:
    returns = [0.01, -0.005, 0.002, 0.0, 0.004, -0.001, 0.003] * 3
    first = e.bootstrap_packet(returns, block_length=7, replicates=128, seed=11)
    second = e.bootstrap_packet(returns, block_length=7, replicates=128, seed=11)
    assert first == second
    assert first["observations"] == 21


def test_pbo_uses_all_seventy_symmetric_splits() -> None:
    months = [f"2025-{month:02d}" for month in range(7, 13)] + ["2026-01", "2026-02"]
    runs: dict[str, e.Simulation] = {}
    for trial_index, trial_id in enumerate(
        ("K03_B00", "K03_B02", "K05_B00", "K05_B02", "K08_B00", "K08_B02")
    ):
        daily = []
        for month_index, month in enumerate(months):
            day = date.fromisoformat(f"{month}-01")
            daily.append((day, (trial_index - month_index % 2) / 10_000))
        deliberately_wrong_weekly_months = [
            (date(2025, 7, 1) + timedelta(days=7 * index), value)
            for index, (_day, value) in enumerate(daily)
        ]
        runs[trial_id] = e.Simulation(
            "PUBLIC_STRESS",
            trial_id,
            False,
            8,
            8,
            [],
            24,
            {"AAAUSDT"},
            [],
            [],
            daily,
            deliberately_wrong_weekly_months,
            {},
            [],
            1000 * math.prod(1 + value for _, value in daily),
        )
    result = e.pbo_cscv(runs, months)
    assert result["splits"] == 70
    assert result["blockObservationCounts"] == dict.fromkeys(months, 1)
    assert 0 <= float(result["pbo"]) <= 1


def test_checksum_inventory_detects_row_drift() -> None:
    lookup = {
        ("AAAUSDT", "2025-03"): {
            "zipSha256": "a" * 64,
            "checksumSha256": "b" * 64,
            "zipBytes": 10,
            "checksumBytes": 88,
        }
    }
    first = e.normalized_inventory_digest(lookup, ("AAAUSDT",), ("2025-03",))
    lookup[("AAAUSDT", "2025-03")]["zipBytes"] = 11
    second = e.normalized_inventory_digest(lookup, ("AAAUSDT",), ("2025-03",))
    assert first[0] != second[0]


def test_marker_record_rejects_noncanonical_bytes(tmp_path: Path) -> None:
    payload = {"schema": "Marker", "value": 1}
    (tmp_path / "run-marker.v1.json").write_text(json.dumps(payload, indent=2))
    with pytest.raises(e.CustodyError, match="not canonical"):
        e.marker_record(tmp_path, "run-marker.v1.json")


def test_exclusive_marker_write_refuses_overwrite(tmp_path: Path) -> None:
    marker = tmp_path / "marker.json"
    e.write_exclusive(marker, b"first\n")
    with pytest.raises(e.EvidenceError, match="refusing to overwrite"):
        e.write_exclusive(marker, b"second\n")
    assert marker.read_bytes() == b"first\n"


def test_result_verdict_vocabulary_is_closed() -> None:
    protocol = json.loads(e.PROTOCOL_PATH.read_text())
    law = protocol["verdictLaw"]
    assert {key for key in law if key in {"GO", "NO_GO", "UNMEASURED"}} == {
        "GO",
        "NO_GO",
        "UNMEASURED",
    }
