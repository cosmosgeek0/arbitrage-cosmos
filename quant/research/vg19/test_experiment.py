"""Focused synthetic contract tests for the sealed V-G19 evaluator."""

from __future__ import annotations

import copy
import hashlib
import json
import math
import random
import zipfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from research.vg19 import experiment


def make_bar(timestamp: int, price: float = 100.0, volume: float = 1_000_000.0) -> experiment.Bar:
    """Create one complete synthetic hourly bar."""

    return experiment.Bar(
        open_time_us=timestamp,
        open_price=price,
        close_price=price,
        quote_volume=volume,
    )


def test_trial_ledger_is_complete_and_primary_is_frozen() -> None:
    candidates = experiment.trials()
    assert len(candidates) == 54
    assert len({candidate.trial_id for candidate in candidates}) == 54
    assert experiment.primary_trial().trial_id == "W26-Z2.5-K3-H4"


def test_surprise_uses_only_prior_matching_hour_of_week() -> None:
    start = int(datetime(2025, 1, 6, tzinfo=UTC).timestamp() * 1_000_000)
    bars: dict[int, experiment.Bar] = {}
    prior_logs: list[float] = []
    for week in range(21):
        timestamp = start + week * 7 * 24 * experiment.HOUR_US
        volume = float((week + 2) ** 2)
        bars[timestamp] = make_bar(timestamp, volume=volume)
        if week < 20:
            prior_logs.append(math.log1p(volume))
    surprises = experiment.compute_surprises({"BTCUSDT": bars}, 26)
    target = start + 20 * 7 * 24 * experiment.HOUR_US
    center, mad = experiment.median_absolute_deviation(prior_logs)
    expected = (math.log1p(float(22**2)) - center) / (1.4826 * mad)
    assert surprises["BTCUSDT"][target] == pytest.approx(expected)


def test_select_cohort_is_top_k_deterministic_and_skips_one_full_bar() -> None:
    start = experiment.parse_utc("2026-03-01T00:00:00Z")
    surprises = {
        "AAAUSDT": {start: 3.0},
        "BBBUSDT": {start: 4.0},
        "CCCUSDT": {start: 4.0},
        "DDDUSDT": {start: 1.0},
    }
    trial = experiment.Trial(26, 2.5, 3, 4, "SYNTHETIC")
    cohorts, _ = experiment.select_cohorts(surprises, trial, start, start + 12 * experiment.HOUR_US)
    assert len(cohorts) == 1
    assert cohorts[0].symbols == ("BBBUSDT", "CCCUSDT", "AAAUSDT")
    assert cohorts[0].entry_us == start + 2 * experiment.HOUR_US
    assert cohorts[0].exit_us == start + 6 * experiment.HOUR_US


def test_select_cohort_holds_cash_when_candidate_count_is_short() -> None:
    start = experiment.parse_utc("2026-03-01T00:00:00Z")
    surprises = {
        "AAAUSDT": {start: 3.0},
        "BBBUSDT": {start: 4.0},
        "CCCUSDT": {start: 2.0},
    }
    trial = experiment.Trial(26, 2.5, 3, 4, "SYNTHETIC")
    cohorts, _ = experiment.select_cohorts(surprises, trial, start, start + 12 * experiment.HOUR_US)
    assert cohorts == []


def test_non_overlapping_rule_ignores_intervening_signals() -> None:
    start = experiment.parse_utc("2026-03-01T00:00:00Z")
    surprises = {
        symbol: {start + offset * experiment.HOUR_US: 4.0 for offset in range(10)}
        for symbol in ("AAAUSDT", "BBBUSDT", "CCCUSDT")
    }
    trial = experiment.Trial(26, 2.5, 3, 4, "SYNTHETIC")
    cohorts, ignored = experiment.select_cohorts(
        surprises, trial, start, start + 16 * experiment.HOUR_US
    )
    assert [item.signal_us for item in cohorts] == [
        start,
        start + 4 * experiment.HOUR_US,
        start + 8 * experiment.HOUR_US,
    ]
    assert ignored >= 6


def test_simulation_is_causal_bounded_and_reports_capacity_screen() -> None:
    partition_start = experiment.parse_utc("2026-03-01T00:00:00Z")
    history_start = partition_start - 720 * experiment.HOUR_US
    end = partition_start + 12 * experiment.HOUR_US
    bars: dict[str, dict[int, experiment.Bar]] = {}
    surprises: dict[str, dict[int, float]] = {}
    for symbol in ("AAAUSDT", "BBBUSDT", "CCCUSDT"):
        symbol_bars: dict[int, experiment.Bar] = {}
        for timestamp in range(history_start, end, experiment.HOUR_US):
            step = max(0, (timestamp - partition_start) // experiment.HOUR_US)
            price = 100.0 + 0.2 * step
            symbol_bars[timestamp] = make_bar(timestamp, price=price, volume=1_000_000.0)
        bars[symbol] = symbol_bars
        surprises[symbol] = {partition_start: 4.0}
    trial = experiment.Trial(26, 2.5, 3, 4, "SYNTHETIC")
    simulation = experiment.simulate(
        bars,
        surprises,
        trial,
        partition_start,
        end,
        cost_bps=40,
    )
    assert simulation.cohort_count == 1
    assert simulation.round_trips == 3
    assert simulation.cumulative_return > 0
    assert simulation.public_capacity_proxy_usd_at_1bp == pytest.approx(300.0)
    assert len(simulation.hourly_returns) == 12
    assert simulation.selection_counts == {
        "AAAUSDT": 1,
        "BBBUSDT": 1,
        "CCCUSDT": 1,
    }


def test_cash_simulation_keeps_every_calendar_return_at_zero() -> None:
    start = experiment.parse_utc("2026-03-01T00:00:00Z")
    end = start + 48 * experiment.HOUR_US
    bars = {
        symbol: {
            timestamp: make_bar(timestamp) for timestamp in range(start, end, experiment.HOUR_US)
        }
        for symbol in ("AAAUSDT", "BBBUSDT", "CCCUSDT")
    }
    surprises: dict[str, dict[int, float]] = {symbol: {} for symbol in bars}
    simulation = experiment.simulate(
        bars,
        surprises,
        experiment.Trial(26, 2.5, 3, 4, "SYNTHETIC"),
        start,
        end,
        cost_bps=40,
    )
    assert simulation.cohort_count == 0
    assert simulation.cumulative_return == 0
    assert simulation.maximum_drawdown == 0
    assert simulation.hourly_returns == [0.0] * 48
    assert simulation.daily_returns == [0.0, 0.0]


def test_rank_and_spearman_are_deterministic_with_ties() -> None:
    assert experiment.rank_data([3.0, 1.0, 1.0, 2.0]) == [4.0, 1.5, 1.5, 3.0]
    assert experiment.spearman([1.0, 2.0, 3.0], [2.0, 4.0, 6.0]) == pytest.approx(1.0)


def test_circular_bootstrap_is_seed_deterministic() -> None:
    first = experiment.circular_indices(20, 7, random.Random(19))
    second = experiment.circular_indices(20, 7, random.Random(19))
    assert first == second
    assert len(first) == 20
    assert all(0 <= index < 20 for index in first)


def test_mechanism_report_uses_synchronous_calendar_blocks(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    original = experiment.protocol()
    modified = copy.deepcopy(original)
    inference = modified["inference"]
    inference["bootstrap"]["replicates"] = 32
    inference["bootstrap"]["blockLengthHours"] = 24
    inference["mechanism"]["lagsHours"] = [1, 24]
    monkeypatch.setattr(experiment, "protocol", lambda: modified)
    start = experiment.parse_utc("2026-03-01T00:00:00Z")
    hours = 300
    surprises: dict[str, dict[int, float]] = {}
    for symbol_index in range(10):
        values: dict[int, float] = {}
        prior = 0.0
        for offset in range(hours):
            prior = 0.8 * prior + math.sin((offset + symbol_index) / 7)
            values[start + offset * experiment.HOUR_US] = prior
        surprises[f"S{symbol_index:02d}USDT"] = values
    report = experiment.mechanism_report(surprises, start, start + hours * experiment.HOUR_US)
    assert report["bootstrap"]["replicates"] == 32
    assert float(report["aggregateMedianSpearmanByLag"]["1"]) > 0
    assert report["coverageByLag"]["1"] == "1.0000000000"


def test_sidecar_rejects_filename_and_digest_mismatch() -> None:
    digest = "a" * 64
    experiment.verify_sidecar(f"{digest}  sample.zip\n".encode(), "sample.zip", digest)
    with pytest.raises(experiment.MeasurementError, match="filename mismatch"):
        experiment.verify_sidecar(f"{digest}  other.zip\n".encode(), "sample.zip", digest)
    with pytest.raises(experiment.MeasurementError, match="checksum mismatch"):
        experiment.verify_sidecar(f"{'b' * 64}  sample.zip\n".encode(), "sample.zip", digest)


def archive_record(
    root: Path,
    *,
    symbol: str,
    month: str,
    corrupt_first_timestamp: bool = False,
) -> dict[str, Any]:
    """Write one synthetic official-shape month archive and receipt."""

    objects = root / "objects"
    objects.mkdir(parents=True, exist_ok=True)
    name = f"{symbol}-1h-{month}.zip"
    csv_name = f"{symbol}-1h-{month}.csv"
    start = int(
        datetime.strptime(f"{month}-01", "%Y-%m-%d").replace(tzinfo=UTC).timestamp() * 1_000_000
    )
    end = int(experiment.next_month(experiment.month_start(month)).timestamp() * 1_000_000)
    rows = []
    for index, timestamp in enumerate(range(start, end, experiment.HOUR_US)):
        if corrupt_first_timestamp and index == 0:
            timestamp //= 1000
        rows.append(
            ",".join(
                (
                    str(timestamp),
                    "100",
                    "101",
                    "99",
                    "100",
                    "10",
                    str(timestamp + experiment.HOUR_US - 1),
                    "1000",
                    "5",
                    "5",
                    "500",
                    "0",
                )
            )
        )
    raw_csv = ("\n".join(rows) + "\n").encode()
    archive_path = objects / name
    with zipfile.ZipFile(archive_path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(csv_name, raw_csv)
    archive_raw = archive_path.read_bytes()
    archive_sha = hashlib.sha256(archive_raw).hexdigest()
    sidecar = f"{archive_sha}  {name}\n".encode()
    checksum_path = objects / f"{name}.CHECKSUM"
    checksum_path.write_bytes(sidecar)
    return {
        "archiveName": name,
        "archivePath": f"objects/{name}",
        "archiveSha256": archive_sha,
        "checksumPath": f"objects/{name}.CHECKSUM",
        "checksumSha256": hashlib.sha256(sidecar).hexdigest(),
        "month": month,
        "symbol": symbol,
    }


def test_archive_parser_accepts_exact_microsecond_calendar(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(experiment, "state_root", lambda: tmp_path)
    record = archive_record(tmp_path, symbol="BTCUSDT", month="2025-01")
    bars, receipt = experiment.parse_archive(record)
    assert len(bars) == 744
    assert receipt["rowCount"] == 744
    assert len(receipt["csvSha256"]) == 64


def test_archive_parser_rejects_millisecond_timestamp(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(experiment, "state_root", lambda: tmp_path)
    record = archive_record(
        tmp_path,
        symbol="BTCUSDT",
        month="2025-01",
        corrupt_first_timestamp=True,
    )
    with pytest.raises(experiment.MeasurementError, match="not microseconds"):
        experiment.parse_archive(record)


def test_json_evidence_is_exclusive_create(tmp_path: Path) -> None:
    target = tmp_path / "receipt.json"
    experiment.write_json_once(target, {"value": 1})
    with pytest.raises(FileExistsError):
        experiment.write_json_once(target, {"value": 2})
    assert json.loads(target.read_text()) == {"value": 1}


def test_maximum_drawdown_uses_marked_path() -> None:
    assert experiment.maximum_drawdown([1100.0, 990.0, 1200.0]) == pytest.approx(0.10)
