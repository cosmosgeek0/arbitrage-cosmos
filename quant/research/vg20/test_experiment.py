from __future__ import annotations

import hashlib
import json
import zipfile
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path

import pytest
from research.vg20 import experiment as vg20


def _bar(
    symbol: str,
    day: date,
    *,
    open_price: str = "100",
    close: str = "100",
    quote_volume: str = "100000000",
) -> vg20.Bar:
    opened = (day - date(1970, 1, 1)).days * vg20.DAY_US
    open_decimal = Decimal(open_price)
    close_decimal = Decimal(close)
    return vg20.Bar(
        symbol,
        day,
        open_decimal,
        max(open_decimal, close_decimal) + Decimal("1"),
        min(open_decimal, close_decimal) - Decimal("1"),
        close_decimal,
        Decimal(quote_volume),
        opened,
        opened + vg20.DAY_US - 1,
    )


def _panel(
    *,
    signal_day: date,
    entry_missing: bool = False,
    exit_missing: bool = False,
    alt_signal_volume: str = "100000000",
) -> tuple[dict[str, dict[date, vg20.Bar]], tuple[str, ...]]:
    cohort = tuple(f"ALT{index:02d}USDT" for index in range(vg20.COHORT_SIZE))
    start = signal_day - timedelta(days=45)
    end = signal_day + timedelta(days=8)
    panel: dict[str, dict[date, vg20.Bar]] = {}
    for symbol in (*vg20.LEADERS, *cohort):
        panel[symbol] = {day: _bar(symbol, day) for day in vg20.date_range(start, end)}
    for leader in vg20.LEADERS:
        panel[leader][signal_day] = _bar(
            leader,
            signal_day,
            quote_volume="200000000",
        )
    for symbol in cohort:
        panel[symbol][signal_day] = _bar(
            symbol,
            signal_day,
            quote_volume=alt_signal_volume,
        )
        panel[symbol][signal_day + timedelta(days=2)] = _bar(
            symbol,
            signal_day + timedelta(days=2),
            open_price="100",
        )
        panel[symbol][signal_day + timedelta(days=3)] = _bar(
            symbol,
            signal_day + timedelta(days=3),
            open_price="102",
            close="102",
        )
    if entry_missing:
        del panel[cohort[0]][signal_day + timedelta(days=2)]
    if exit_missing:
        del panel[cohort[0]][signal_day + timedelta(days=3)]
    return panel, cohort


def test_trial_grid_is_exact_frozen_family_of_twelve() -> None:
    trials = vg20.trial_grid()
    assert len(trials) == 12
    assert len({trial.trial_id for trial in trials}) == 12
    assert {trial.lookback_days for trial in trials} == {10, 20, 40}
    assert {trial.joint_shock_ratio for trial in trials} == {
        Decimal("1.50"),
        Decimal("2.00"),
    }
    assert {trial.hold_days for trial in trials} == {1, 3}


def test_protocol_forbids_nearest_sibling_collisions() -> None:
    protocol = json.loads(vg20.PROTOCOL_PATH.read_text(encoding="utf-8"))
    collision = protocol["collisionLaw"]
    assert collision["altVolumeAsTrigger"] == "FORBIDDEN"
    assert collision["altEventTimeRanking"] == "FORBIDDEN"
    assert collision["priceOrReturnAsLeaderTrigger"] == "FORBIDDEN"
    assert collision["structuralCausationClaim"] == "FORBIDDEN"
    assert protocol["signal"]["entry"].startswith("T_PLUS_2")


def test_joint_leader_event_requires_both_leaders() -> None:
    signal_day = date(2025, 8, 15)
    panel, _ = _panel(signal_day=signal_day)
    trial = vg20.Trial("TEST", 10, Decimal("1.50"), 1)
    assert vg20.leader_event(panel, signal_day, trial)
    panel["ETHUSDT"][signal_day] = _bar("ETHUSDT", signal_day)
    assert not vg20.leader_event(panel, signal_day, trial)


def test_alt_volume_never_changes_the_trigger_or_cohort() -> None:
    signal_day = date(2025, 8, 15)
    ordinary, cohort = _panel(signal_day=signal_day, alt_signal_volume="1")
    shocked, shocked_cohort = _panel(
        signal_day=signal_day,
        alt_signal_volume="999999999999",
    )
    trial = vg20.Trial("TEST", 10, Decimal("1.50"), 1)
    ordinary_result = vg20.simulate(
        ordinary,
        cohort,
        trial,
        signal_day,
        signal_day + timedelta(days=6),
    )
    shocked_result = vg20.simulate(
        shocked,
        shocked_cohort,
        trial,
        signal_day,
        signal_day + timedelta(days=6),
    )
    assert ordinary_result.events == shocked_result.events
    assert ordinary_result.events[0].entry_day == signal_day + timedelta(days=2)
    assert ordinary_result.events[0].exit_day == signal_day + timedelta(days=3)


def test_qualifying_event_is_whole_cohort_or_cash() -> None:
    signal_day = date(2025, 8, 15)
    panel, cohort = _panel(signal_day=signal_day, entry_missing=True)
    trial = vg20.Trial("TEST", 10, Decimal("1.50"), 1)
    simulation = vg20.simulate(
        panel,
        cohort,
        trial,
        signal_day,
        signal_day + timedelta(days=6),
    )
    assert simulation.potential_events == 1
    assert simulation.cash_incomplete_cohort_events == 1
    assert simulation.events == ()
    assert sum(simulation.stress_daily_usd) == 0


def test_missing_bar_after_successful_entry_is_terminal() -> None:
    signal_day = date(2025, 8, 15)
    panel, cohort = _panel(signal_day=signal_day, exit_missing=True)
    trial = vg20.Trial("TEST", 10, Decimal("1.50"), 1)
    with pytest.raises(vg20.MeasurementError, match="successful entry lacks later bar"):
        vg20.simulate(
            panel,
            cohort,
            trial,
            signal_day,
            signal_day + timedelta(days=6),
        )


def test_public_cost_scenarios_are_monotone() -> None:
    gross = vg20.round_trip_return(
        Decimal("100"),
        Decimal("102"),
        fee=Decimal("0"),
        adverse=Decimal("0"),
    )
    base = vg20.round_trip_return(
        Decimal("100"),
        Decimal("102"),
        fee=vg20.FEE_RATE,
        adverse=vg20.BASE_ADVERSE,
    )
    stress = vg20.round_trip_return(
        Decimal("100"),
        Decimal("102"),
        fee=vg20.FEE_RATE,
        adverse=vg20.STRESS_ADVERSE,
    )
    assert gross > base > stress


def test_pbo_uses_all_seventy_symmetric_splits() -> None:
    matrix = {
        f"T{trial:02d}": tuple(Decimal((trial + day) % 7 - 3) for day in range(80))
        for trial in range(12)
    }
    report = vg20.pbo_report(matrix)
    assert report["status"] == "AVAILABLE"
    assert report["blockCount"] == 8
    assert report["splitCount"] == 70


def test_archive_parser_accepts_exact_microsecond_daily_contract(tmp_path: Path) -> None:
    symbol = "TESTUSDT"
    month = "2025-07"
    directory = tmp_path / "archives" / symbol / month
    directory.mkdir(parents=True)
    zip_name = f"{symbol}-1d-{month}.zip"
    zip_path = directory / zip_name
    opened = (date(2025, 7, 1) - date(1970, 1, 1)).days * vg20.DAY_US
    row = f"{opened},100,102,99,101,12,{opened + vg20.DAY_US - 1},1200,7,5,500,0\n"
    with zipfile.ZipFile(zip_path, "w") as archive:
        archive.writestr(zip_name.removesuffix(".zip") + ".csv", row)
    zip_sha = hashlib.sha256(zip_path.read_bytes()).hexdigest()
    checksum_path = directory / f"{zip_name}.CHECKSUM"
    checksum_path.write_text(f"{zip_sha}  {zip_name}\n", encoding="ascii")
    pair_path = directory / "pair.v1.json"
    pair_path.write_text("{}\n", encoding="utf-8")
    record = {
        "checksumBytes": checksum_path.stat().st_size,
        "checksumPath": str(checksum_path.relative_to(tmp_path)),
        "checksumSha256": hashlib.sha256(checksum_path.read_bytes()).hexdigest(),
        "month": month,
        "pairBytes": pair_path.stat().st_size,
        "pairPath": str(pair_path.relative_to(tmp_path)),
        "pairSha256": hashlib.sha256(pair_path.read_bytes()).hexdigest(),
        "symbol": symbol,
        "zipBytes": zip_path.stat().st_size,
        "zipPath": str(zip_path.relative_to(tmp_path)),
        "zipSha256": zip_sha,
    }
    bars = vg20.parse_archive(record, tmp_path)
    assert len(bars) == 1
    assert bars[0].day == date(2025, 7, 1)
    assert bars[0].quote_volume == Decimal("1200")


def test_archive_parser_rejects_duplicate_open_time(tmp_path: Path) -> None:
    symbol = "TESTUSDT"
    month = "2025-07"
    directory = tmp_path / "archives" / symbol / month
    directory.mkdir(parents=True)
    zip_name = f"{symbol}-1d-{month}.zip"
    zip_path = directory / zip_name
    opened = (date(2025, 7, 1) - date(1970, 1, 1)).days * vg20.DAY_US
    row = f"{opened},100,102,99,101,12,{opened + vg20.DAY_US - 1},1200,7,5,500,0\n"
    with zipfile.ZipFile(zip_path, "w") as archive:
        archive.writestr(zip_name.removesuffix(".zip") + ".csv", row + row)
    zip_sha = hashlib.sha256(zip_path.read_bytes()).hexdigest()
    checksum_path = directory / f"{zip_name}.CHECKSUM"
    checksum_path.write_text(f"{zip_sha}  {zip_name}\n", encoding="ascii")
    pair_path = directory / "pair.v1.json"
    pair_path.write_text("{}\n", encoding="utf-8")
    record = {
        "checksumBytes": checksum_path.stat().st_size,
        "checksumPath": str(checksum_path.relative_to(tmp_path)),
        "checksumSha256": hashlib.sha256(checksum_path.read_bytes()).hexdigest(),
        "month": month,
        "pairBytes": pair_path.stat().st_size,
        "pairPath": str(pair_path.relative_to(tmp_path)),
        "pairSha256": hashlib.sha256(pair_path.read_bytes()).hexdigest(),
        "symbol": symbol,
        "zipBytes": zip_path.stat().st_size,
        "zipPath": str(zip_path.relative_to(tmp_path)),
        "zipSha256": zip_sha,
    }
    with pytest.raises(vg20.MeasurementError, match="duplicate or unsorted"):
        vg20.parse_archive(record, tmp_path)
