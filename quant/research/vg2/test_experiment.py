"""Hostile synthetic tests for the frozen V-G2 evaluator."""

from __future__ import annotations

import hashlib
import importlib.util
import io
import math
import sys
import zipfile
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from types import ModuleType
from typing import Any, cast

import pytest


def load_subject() -> ModuleType:
    path = Path(__file__).with_name("experiment.py")
    spec = importlib.util.spec_from_file_location("vg2_experiment", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("unable to load V-G2 evaluator")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


vg2 = cast(Any, load_subject())


def make_bars() -> dict[str, dict[date, Any]]:
    start = date(2025, 4, 15)
    end = date(2025, 6, 5)
    signal = date(2025, 5, 31)
    result: dict[str, dict[date, Any]] = {}
    for symbol_index in range(25):
        symbol = f"T{symbol_index:02d}USDT"
        series: dict[date, Any] = {}
        current = start
        while current <= end:
            quote_volume = Decimal("10000000")
            close = Decimal("100")
            if current == signal:
                close = Decimal("101")
                if symbol_index < 5:
                    quote_volume = Decimal(30_000_000 + symbol_index * 1_000_000)
            series[current] = vg2.Bar(
                day=current,
                open=Decimal("100"),
                high=Decimal("103"),
                low=Decimal("98"),
                close=close,
                quote_volume=quote_volume,
            )
            current += timedelta(days=1)
        result[symbol] = series
    return result


def selected_trial() -> Any:
    return vg2.Trial("VG2-L10-Q10-H1", 10, Decimal("0.10"), 1)


def make_archive(
    tmp_path: Path,
    *,
    close_delta_us: int,
    timestamp_divisor: int = 1,
) -> dict[str, object]:
    symbol = "BTCUSDT"
    month = "2025-07"
    archive_name = f"{symbol}-1d-{month}.zip"
    archive_path = tmp_path / archive_name
    open_us = int(datetime(2025, 7, 1, tzinfo=UTC).timestamp() * 1_000_000)
    open_value = open_us // timestamp_divisor
    close_value = (open_us + close_delta_us) // timestamp_divisor
    row = f"{open_value},100,101,99,100,1,{close_value},10000000,10,0.5,5000000,0\n"
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(f"{symbol}-1d-{month}.csv", row)
    raw = buffer.getvalue()
    archive_path.write_bytes(raw)
    return {
        "month": month,
        "symbol": symbol,
        "zipBytes": len(raw),
        "zipPath": str(archive_path),
        "zipSha256": hashlib.sha256(raw).hexdigest(),
    }


def test_trial_family_is_exactly_twelve_and_stable() -> None:
    family = vg2.trials()
    assert len(family) == 12
    assert len({trial.trial_id for trial in family}) == 12
    assert {trial.lookback for trial in family} == {10, 20, 40}
    assert {trial.top_fraction for trial in family} == {
        Decimal("0.10"),
        Decimal("0.20"),
    }
    assert {trial.hold_days for trial in family} == {1, 3}


def test_completed_microsecond_daily_row_is_admitted(tmp_path: Path) -> None:
    record = make_archive(tmp_path, close_delta_us=vg2.DAY_US - 1)
    rows, summary = vg2.parse_archive(record)
    assert len(rows) == 1
    assert rows[0].day == date(2025, 7, 1)
    assert summary["validRowCount"] == 1
    assert summary["partialRowCount"] == 0


def test_partial_daily_row_is_explicitly_excluded(tmp_path: Path) -> None:
    record = make_archive(tmp_path, close_delta_us=3 * 60 * 60 * 1_000_000 - 1)
    rows, summary = vg2.parse_archive(record)
    assert rows == []
    assert summary["rawRowCount"] == 1
    assert summary["partialRowCount"] == 1


def test_millisecond_timestamp_after_2025_is_rejected(tmp_path: Path) -> None:
    record = make_archive(
        tmp_path,
        close_delta_us=vg2.DAY_US - 1,
        timestamp_divisor=1000,
    )
    with pytest.raises(vg2.MeasurementError, match="not microseconds"):
        vg2.parse_archive(record)


def test_checksum_sidecar_binds_digest_and_filename() -> None:
    digest = "a" * 64
    vg2.verify_sidecar(
        f"{digest}  BTCUSDT-1d-2025-07.zip\n".encode(),
        "BTCUSDT-1d-2025-07.zip",
        digest,
    )
    with pytest.raises(vg2.ContractError, match="checksum filename mismatch"):
        vg2.verify_sidecar(
            f"{digest}  ETHUSDT-1d-2025-07.zip\n".encode(),
            "BTCUSDT-1d-2025-07.zip",
            digest,
        )


def test_signal_is_cross_sectional_and_does_not_read_future() -> None:
    bars = make_bars()
    trial = selected_trial()
    signal_day = date(2025, 5, 31)
    selected_before, risk_before = vg2.select_assets(bars, signal_day, trial)
    bars["T24USDT"][date(2025, 6, 2)] = vg2.Bar(
        day=date(2025, 6, 2),
        open=Decimal("1"),
        high=Decimal("1000000"),
        low=Decimal("1"),
        close=Decimal("1000000"),
        quote_volume=Decimal("999999999999999"),
    )
    selected_after, risk_after = vg2.select_assets(bars, signal_day, trial)
    assert risk_before == risk_after == 25
    assert [asset.symbol for asset in selected_before] == [asset.symbol for asset in selected_after]
    assert [asset.symbol for asset in selected_before] == [
        "T04USDT",
        "T03USDT",
        "T02USDT",
    ]


def test_next_open_cash_accounting_and_cost_identity() -> None:
    simulation = vg2.simulate(
        make_bars(),
        selected_trial(),
        date(2025, 6, 1),
        date(2025, 6, 4),
        vg2.BASE_ADVERSE,
        "BASE",
    )
    assert simulation.round_trips == 3
    assert simulation.selected_allocations == 3
    assert simulation.skipped_entries == 0
    assert simulation.final_nav < Decimal("1000")
    assert math.isclose(
        float(
            simulation.gross_pnl
            - simulation.entry_fee_cost
            - simulation.exit_fee_cost
            - simulation.adverse_execution_cost
        ),
        float(simulation.net_usd),
        abs_tol=1e-8,
    )
    assert simulation.capacity_proxy_usd is not None
    assert simulation.capacity_proxy_usd >= Decimal("1000")


def test_missing_entry_remains_cash_without_replacement() -> None:
    bars = make_bars()
    del bars["T04USDT"][date(2025, 6, 1)]
    simulation = vg2.simulate(
        bars,
        selected_trial(),
        date(2025, 6, 1),
        date(2025, 6, 4),
        vg2.BASE_ADVERSE,
        "BASE",
    )
    assert simulation.selected_allocations == 3
    assert simulation.skipped_entries == 1
    assert simulation.round_trips == 2


def test_missing_successful_exit_is_unmeasured() -> None:
    bars = make_bars()
    del bars["T04USDT"][date(2025, 6, 2)]
    with pytest.raises(vg2.MeasurementError, match="missing successful exit"):
        vg2.simulate(
            bars,
            selected_trial(),
            date(2025, 6, 1),
            date(2025, 6, 4),
            vg2.BASE_ADVERSE,
            "BASE",
        )


def test_bootstrap_is_deterministic_and_preserves_unknown() -> None:
    values = [0.001, -0.0005, 0.002, 0.0, 0.001, -0.0002, 0.0007] * 3
    first = vg2.bootstrap_report(values)
    second = vg2.bootstrap_report(values)
    assert first == second
    assert first["status"] == "AVAILABLE"
    unavailable = vg2.bootstrap_report([0.1, 0.2])
    assert unavailable["status"] == "UNAVAILABLE"
    assert unavailable["lowerNetUsdPer1000"] is None


def test_holm_uses_all_trials_and_stops_after_first_failure() -> None:
    p_values = {
        "A": 0.001,
        "B": 0.005,
        "C": 0.06,
    }
    report = vg2.holm_report(p_values)
    assert report["testedCount"] == 3
    assert report["rejectedTrialIds"] == ["A", "B"]


def test_white_reality_check_is_synchronous_and_deterministic() -> None:
    matrix = {
        f"T{index:02d}": [
            (0.001 if index == 0 else 0.0) + ((day % 3) - 1) * 0.0001 for day in range(32)
        ]
        for index in range(12)
    }
    first = vg2.white_reality_check(matrix)
    second = vg2.white_reality_check(matrix)
    assert first == second
    assert first["status"] == "AVAILABLE"
    assert first["testedCount"] == 12


def test_pbo_has_eight_blocks_and_seventy_symmetric_splits() -> None:
    matrix = {
        f"T{index:02d}": [math.sin(day + index) / 1000 + index / 100_000 for day in range(80)]
        for index in range(12)
    }
    report = vg2.pbo_report(matrix)
    assert report["status"] == "AVAILABLE"
    assert report["diagnosticOnly"] is True
    assert report["blockCount"] == 8
    assert report["splitCount"] == 70


def test_write_once_rejects_consumed_authority(tmp_path: Path) -> None:
    target = tmp_path / "marker.json"
    vg2.write_json_once(target, {"state": "OPENED"})
    with pytest.raises(vg2.ContractError, match="refusing to overwrite"):
        vg2.write_json_once(target, {"state": "OPENED_AGAIN"})


def test_unmeasured_is_never_serialized_as_numeric_zero() -> None:
    unavailable = vg2.bootstrap_report([])
    assert unavailable.get("pointNetUsdPer1000") is None
    assert unavailable["oneSidedPValue"] is None
