from __future__ import annotations

import csv
import io
import zipfile
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from pathlib import Path

import pytest
from research.vg6 import experiment as vg6
from research.vg6.experiment import (
    DAY_US,
    Bar,
    ContractError,
    MeasurementError,
    Scenario,
    Signal,
    Simulation,
    Trial,
    build_features,
    calendar_block_scores,
    cscv_pbo,
    holm_decisions,
    modeled_proceeds,
    month_range,
    parse_kline_archive,
    signals_for_trial,
    simulate,
    stitched_net_and_drawdown,
    trials,
)


def zip_kline_rows(
    symbol: str,
    month: str,
    rows: list[list[str]],
) -> bytes:
    csv_buffer = io.StringIO()
    writer = csv.writer(csv_buffer, lineterminator="\n")
    writer.writerows(rows)
    zip_buffer = io.BytesIO()
    member = f"{symbol}-1d-{month}.csv"
    with zipfile.ZipFile(zip_buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(member, csv_buffer.getvalue().encode("ascii"))
    return zip_buffer.getvalue()


def kline_row(day: date, *, close_time_delta: int = DAY_US - 1) -> list[str]:
    open_time = int(datetime(day.year, day.month, day.day, tzinfo=UTC).timestamp()) * 1_000_000
    return [
        str(open_time),
        "100",
        "102",
        "99",
        "101",
        "10",
        str(open_time + close_time_delta),
        "10000000",
        "20",
        "4",
        "4000000",
        "0",
    ]


def synthetic_bars() -> dict[str, dict[date, Bar]]:
    signal_day = date(2025, 3, 12)
    start = signal_day - timedelta(days=70)
    symbol_bars: dict[date, Bar] = {}
    for offset in range(71):
        day = start + timedelta(days=offset)
        in_compression = signal_day - timedelta(days=10) <= day < signal_day
        quote_volume = Decimal("5000000") if in_compression else Decimal("20000000")
        symbol_bars[day] = Bar(
            day=day,
            open=Decimal("100"),
            high=Decimal("100.5"),
            low=Decimal("99.5"),
            close=Decimal("100"),
            quote_volume=quote_volume,
        )
    symbol_bars[signal_day] = Bar(
        day=signal_day,
        open=Decimal("100"),
        high=Decimal("104"),
        low=Decimal("99"),
        close=Decimal("103"),
        quote_volume=Decimal("10000000"),
    )
    return {"BTCUSDT": symbol_bars}


def test_frozen_trial_family_is_complete_and_unique() -> None:
    family = trials()
    assert len(family) == 16
    assert len({trial.trial_id for trial in family}) == 16
    assert {
        (trial.compression_days, trial.range_maximum, trial.volume_maximum, trial.holding_days)
        for trial in family
    } == {
        (compression, range_maximum, volume_maximum, holding)
        for compression in (5, 10)
        for range_maximum in (Decimal("0.04"), Decimal("0.07"))
        for volume_maximum in (Decimal("0.50"), Decimal("0.75"))
        for holding in (3, 7)
    }


def test_archive_parser_accepts_exact_microsecond_daily_boundaries() -> None:
    symbol = "BTCUSDT"
    month = "2025-01"
    archive_name = f"{symbol}-1d-{month}.zip"
    raw = zip_kline_rows(symbol, month, [kline_row(date(2025, 1, 1))])
    bars = parse_kline_archive(
        raw,
        archive_name=archive_name,
        symbol=symbol,
        month=month,
    )
    assert bars[0].day == date(2025, 1, 1)
    assert bars[0].quote_volume == Decimal("10000000")


def test_archive_parser_rejects_partial_daily_close() -> None:
    symbol = "BTCUSDT"
    month = "2025-01"
    archive_name = f"{symbol}-1d-{month}.zip"
    raw = zip_kline_rows(
        symbol,
        month,
        [kline_row(date(2025, 1, 1), close_time_delta=DAY_US // 2)],
    )
    with pytest.raises(MeasurementError, match="daily timestamp boundary invalid"):
        parse_kline_archive(
            raw,
            archive_name=archive_name,
            symbol=symbol,
            month=month,
        )


def test_signal_uses_only_lagged_compression_and_completed_breakout() -> None:
    bars = synthetic_bars()
    signal_day = date(2025, 3, 12)
    features = build_features(bars, start=signal_day, end=signal_day)
    assert len(features) == 1
    trial = Trial(
        "VG6-C10-R04-V50-H03",
        10,
        Decimal("0.04"),
        Decimal("0.50"),
        3,
    )
    selected = signals_for_trial(features, trial)
    assert [(signal.signal_day, signal.symbol) for signal in selected] == [(signal_day, "BTCUSDT")]

    future_day = signal_day + timedelta(days=1)
    bars["BTCUSDT"][future_day] = Bar(
        future_day,
        Decimal("1"),
        Decimal("1"),
        Decimal("1"),
        Decimal("1"),
        Decimal("1"),
    )
    assert build_features(bars, start=signal_day, end=signal_day) == features


def test_normal_volume_cap_excludes_abnormal_breakout() -> None:
    bars = synthetic_bars()
    signal_day = date(2025, 3, 12)
    original = bars["BTCUSDT"][signal_day]
    bars["BTCUSDT"][signal_day] = Bar(
        day=original.day,
        open=original.open,
        high=original.high,
        low=original.low,
        close=original.close,
        quote_volume=Decimal("18750000"),
    )
    assert build_features(bars, start=signal_day, end=signal_day) == ()


def test_modeled_costs_are_decomposed_and_monotone() -> None:
    fee_only = Scenario("feeOnly", Decimal("0.001"), Decimal(0))
    stress = Scenario("combinedStress", Decimal("0.002"), Decimal("0.001"))
    fee_proceeds, _, fee_adverse, fee_cost = modeled_proceeds(
        Decimal("1000"),
        Decimal("100"),
        Decimal("110"),
        fee_only,
    )
    stress_proceeds, _, stress_adverse, stress_fee = modeled_proceeds(
        Decimal("1000"),
        Decimal("100"),
        Decimal("110"),
        stress,
    )
    assert fee_adverse == 0
    assert fee_cost > 0
    assert stress_adverse > 0
    assert stress_fee > fee_cost
    assert stress_proceeds < fee_proceeds


def test_simulation_uses_cash_sleeves_and_two_fills_per_round_trip() -> None:
    start = date(2025, 1, 1)
    end = date(2025, 1, 9)
    symbol_bars = {
        day: Bar(
            day,
            Decimal("100"),
            Decimal("100"),
            Decimal("100"),
            Decimal("100"),
            Decimal("20000000"),
        )
        for day in (start + timedelta(days=offset) for offset in range(9))
    }
    signal = Signal(date(2025, 1, 5), "BTCUSDT", Decimal("2000"))
    simulation = simulate(
        {"BTCUSDT": symbol_bars},
        (signal,),
        start=start,
        end=end,
        holding_days=3,
        scenario=Scenario("zero", Decimal(0), Decimal(0)),
    )
    assert simulation.final_nav == Decimal("1000")
    assert simulation.net_usd == 0
    assert len(simulation.trades) == 1
    assert simulation.trades[0].allocation == Decimal("1000") / Decimal(3)


def test_missing_exit_after_entry_is_unmeasured() -> None:
    start = date(2025, 1, 1)
    end = date(2025, 1, 9)
    symbol_bars = {
        day: Bar(
            day,
            Decimal("100"),
            Decimal("100"),
            Decimal("100"),
            Decimal("100"),
            Decimal("20000000"),
        )
        for day in (start + timedelta(days=offset) for offset in range(8))
    }
    signal = Signal(date(2025, 1, 5), "BTCUSDT", Decimal("2000"))
    with pytest.raises(MeasurementError, match="missing exit"):
        simulate(
            {"BTCUSDT": symbol_bars},
            (signal,),
            start=start,
            end=end,
            holding_days=3,
            scenario=Scenario("zero", Decimal(0), Decimal(0)),
        )


def test_holm_and_pbo_are_deterministic_diagnostics() -> None:
    holm = holm_decisions(("A", "B", "C"), (0.001, 0.02, 0.5))
    assert [row["selected"] for row in holm] == [True, True, False]
    pbo = cscv_pbo(
        (
            tuple(Decimal(value) for value in (9, 9, 9, 9)),
            tuple(Decimal(value) for value in (1, 1, 1, 1)),
            tuple(Decimal(value) for value in (2, 1, 2, 1)),
        )
    )
    assert pbo["role"] == "DIAGNOSTIC_ONLY"
    assert pbo["splitCount"] == 6


def test_pbo_calendar_blocks_slice_continuous_nav_without_reset() -> None:
    simulation = Simulation(
        scenario=Scenario("combinedStress", Decimal("0.002"), Decimal("0.001")),
        final_nav=Decimal("1010"),
        net_usd=Decimal("10"),
        max_drawdown=Decimal(0),
        daily_changes=(
            Decimal("1"),
            Decimal("2"),
            Decimal("3"),
            Decimal("4"),
        ),
        trades=(),
        raw_signals=0,
        suppressed_signals=0,
        skipped_entries=0,
    )
    assert calendar_block_scores(
        simulation,
        start=date(2025, 1, 30),
        block_months=("2025-01", "2025-02"),
    ) == (Decimal("3"), Decimal("7"))


def test_stitched_path_reports_coherent_return_and_drawdown() -> None:
    scenario = Scenario("base", Decimal("0.001"), Decimal("0.0005"))
    development = Simulation(
        scenario,
        Decimal("950"),
        Decimal("-50"),
        Decimal("0.10"),
        (Decimal("-100"), Decimal("50")),
        (),
        0,
        0,
        0,
    )
    holdout = Simulation(
        scenario,
        Decimal("1050"),
        Decimal("50"),
        Decimal("0.05"),
        (Decimal("100"), Decimal("-50")),
        (),
        0,
        0,
        0,
    )
    net, drawdown = stitched_net_and_drawdown((development, holdout))
    assert net == Decimal("-2.50")
    assert drawdown == Decimal("0.10")


def test_marker_open_counts_are_monotone(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    marker_path = tmp_path / "run-marker.v1.json"
    monkeypatch.setattr(vg6, "MARKER_PATH", marker_path)
    marker = {
        "developmentOpenCount": 1,
        "holdoutOpenCount": 1,
        "schema": "VG6RunMarkerV1",
    }
    vg6.write_json_once(marker_path, marker)
    with pytest.raises(ContractError, match="holdoutOpenCount"):
        vg6.marker_update(marker, holdoutOpenCount=0)
    assert vg6.load_json(marker_path)["holdoutOpenCount"] == 1


def test_terminal_finalize_is_idempotent_and_data_free(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    paths = {
        "PACKET": tmp_path,
        "MARKER_PATH": tmp_path / "run-marker.v1.json",
        "RESULT_PATH": tmp_path / "result.v1.json",
        "VERDICT_PATH": tmp_path / "VERDICT.md",
        "SHA256SUMS_PATH": tmp_path / "SHA256SUMS",
    }
    for name, path in paths.items():
        monkeypatch.setattr(vg6, name, path)
    marker = {
        "developmentOpenCount": 1,
        "holdoutOpenCount": 1,
        "schema": "VG6RunMarkerV1",
        "state": "MEASUREMENT_UNMEASURED_PENDING_SEAL",
        "verdict": "UNMEASURED",
    }
    vg6.write_json_once(paths["MARKER_PATH"], marker)
    result = {
        "capitalVerdict": "NO_GO",
        "headline": {"valueHorizon": "UNMEASURED"},
        "holdout": {"status": "UNMEASURED"},
        "limitations": ["synthetic terminal test"],
        "schema": "VG6ResultV1",
        "verdict": "UNMEASURED",
        "verdictReason": "SYNTHETIC_TEST",
    }
    vg6.finalize_result(result)
    first_checksum = paths["SHA256SUMS_PATH"].read_bytes()
    vg6.finalize_result(result)
    assert paths["SHA256SUMS_PATH"].read_bytes() == first_checksum
    durable = vg6.load_json(paths["MARKER_PATH"])
    assert durable["state"] == "TERMINAL_UNMEASURED"
    assert durable["holdoutOpenCount"] == 1


def test_month_range_is_inclusive() -> None:
    assert month_range("2025-11", "2026-02") == (
        "2025-11",
        "2025-12",
        "2026-01",
        "2026-02",
    )
