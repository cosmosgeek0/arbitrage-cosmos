"""Focused, synthetic, network-free contract tests for the V-G35 evaluator."""

from __future__ import annotations

import hashlib
import io
import json
import math
import zipfile
from collections.abc import Mapping, Sequence
from copy import deepcopy
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from itertools import pairwise
from pathlib import Path
from typing import Any

import pytest
from research.vg35 import experiment as vg35


def _bar(day: date, volume: str = "10", price: str = "100") -> vg35.Bar:
    return vg35.Bar(day, Decimal(price), Decimal(volume))


def _daily_bars(
    start: date,
    count: int,
    *,
    volumes: Mapping[int, str] | None = None,
    prices: Mapping[int, str] | None = None,
) -> tuple[vg35.Bar, ...]:
    volume_overrides = volumes or {}
    price_overrides = prices or {}
    return tuple(
        _bar(
            start + timedelta(days=offset),
            volume_overrides.get(offset, "10"),
            price_overrides.get(offset, "100"),
        )
        for offset in range(count)
    )


def _duration_fixture(
    exact_age_days: int,
    holding_days: int = 1,
) -> tuple[tuple[vg35.Bar, ...], vg35.TrialSpec, date, date]:
    origin = date(2025, 1, 1)
    partition_start = origin + timedelta(days=60)
    partition_end = partition_start + timedelta(days=20)
    volumes = {60 + offset: "20" for offset in range(exact_age_days)}
    bars = _daily_bars(origin, 80, volumes=volumes)
    spec = vg35.TrialSpec(
        f"SYNTHETIC-D{exact_age_days:02d}-H{holding_days:02d}",
        exact_age_days,
        holding_days,
    )
    return bars, spec, partition_start, partition_end


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _write_json(path: Path, value: Mapping[str, Any]) -> None:
    path.write_text(
        json.dumps(value, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _refresh_sha256sums(packet: Path, checksums: Path) -> None:
    inputs = sorted(path for path in packet.iterdir() if path.is_file() and path != checksums)
    checksums.write_text(
        "".join(f"{_sha256(path)}  {path.name}\n" for path in inputs),
        encoding="utf-8",
    )


def _install_verifier_fixture(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> dict[str, Path]:
    packet = tmp_path / "packet"
    packet.mkdir()
    paths = {
        "packet": packet,
        "protocol": packet / "protocol.v1.json",
        "manifest": packet / "source_manifest.v1.json",
        "freeze": packet / "freeze.v1.json",
        "marker": packet / "run-marker.v1.json",
        "development": packet / "development.v1.json",
        "selection": packet / "selection.v1.json",
        "holdout_marker": packet / "holdout-open-marker.v1.json",
        "holdout": packet / "holdout.v1.json",
        "result": packet / "result.v1.json",
        "checksums": packet / "SHA256SUMS",
    }
    _write_json(paths["protocol"], {"synthetic": True})
    _write_json(paths["manifest"], {"synthetic": True})
    _write_json(paths["freeze"], {"version": "VG35FreezeV1"})
    protocol_sha = _sha256(paths["protocol"])
    freeze_sha = _sha256(paths["freeze"])
    marker = {
        "version": "VG35RunMarkerV1",
        "protocolSha256": protocol_sha,
        "freezeSha256": freeze_sha,
    }
    _write_json(paths["marker"], marker)
    marker_sha = _sha256(paths["marker"])
    gates = {"syntheticGate": False}
    development = {
        "version": "VG35DevelopmentV1",
        "freezeSha256": freeze_sha,
        "runMarkerSha256": marker_sha,
        "championTrialId": "VG35-D02-H01",
        "developmentGates": gates,
        "allDevelopmentGatesPass": False,
    }
    _write_json(paths["development"], development)
    result = {
        "version": "VG35ResultV1",
        "verdict": "NO_GO",
        "disposition": "DEVELOPMENT_GATE_FAILURE",
        "protocolSha256": protocol_sha,
        "freezeSha256": freeze_sha,
        "runMarkerSha256": marker_sha,
        "developmentOpened": True,
        "holdoutOpened": False,
        "developmentSha256": _sha256(paths["development"]),
        "championTrialId": "VG35-D02-H01",
        "developmentGates": gates,
        "capitalAuthority": "NONE",
        "capitalVerdict": "NO_GO",
        "accountEffectiveFee": "UNKNOWN",
        "executableCapacity": "UNMEASURED",
        "causalIdentification": "NOT_CLAIMED",
        "globalHoldoutCertification": "NOT_CERTIFIED_SHARED_REUSE_RISK",
        "programAdjustedPValue": 1.0,
        "verifiedPositiveEligible": False,
        "consumer": "N3 successor/orchestrator scoreboard",
        "moneyEffectUsd": 0,
    }
    _write_json(paths["result"], result)
    _refresh_sha256sums(packet, paths["checksums"])

    monkeypatch.setattr(vg35, "PACKET_DIR", packet)
    monkeypatch.setattr(vg35, "PROTOCOL_PATH", paths["protocol"])
    monkeypatch.setattr(vg35, "SOURCE_MANIFEST_PATH", paths["manifest"])
    monkeypatch.setattr(vg35, "FREEZE_PATH", paths["freeze"])
    monkeypatch.setattr(vg35, "RUN_MARKER_PATH", paths["marker"])
    monkeypatch.setattr(vg35, "DEVELOPMENT_PATH", paths["development"])
    monkeypatch.setattr(vg35, "SELECTION_PATH", paths["selection"])
    monkeypatch.setattr(vg35, "HOLDOUT_MARKER_PATH", paths["holdout_marker"])
    monkeypatch.setattr(vg35, "HOLDOUT_PATH", paths["holdout"])
    monkeypatch.setattr(vg35, "RESULT_PATH", paths["result"])
    monkeypatch.setattr(vg35, "SHA256SUMS_PATH", paths["checksums"])
    monkeypatch.setattr(vg35, "_verify_freeze", lambda _protocol: {})
    monkeypatch.setattr(
        vg35,
        "_validate_manifest_shape",
        lambda _protocol, _manifest, verify_bytes: None,
    )
    monkeypatch.setattr(
        vg35,
        "_verify_external_inputs",
        lambda _protocol, _manifest, _freeze: None,
    )

    def forbid_zip_open(*_args: Any, **_kwargs: Any) -> None:
        raise AssertionError("terminal verifier reopened a ZIP")

    monkeypatch.setattr(zipfile, "ZipFile", forbid_zip_open)
    return paths


def test_trial_grid_is_exactly_the_six_preregistered_specs() -> None:
    specs = vg35.generate_trial_specs(vg35.load_protocol())

    assert [(item.trial_id, item.exact_age_days, item.holding_days) for item in specs] == [
        ("VG35-D02-H01", 2, 1),
        ("VG35-D02-H03", 2, 3),
        ("VG35-D03-H01", 3, 1),
        ("VG35-D03-H03", 3, 3),
        ("VG35-D05-H01", 5, 1),
        ("VG35-D05-H03", 5, 3),
    ]


def test_trial_grid_count_mismatch_fails_closed() -> None:
    protocol = deepcopy(vg35.load_protocol())
    protocol["trialFamily"]["attemptedCount"] = 5

    with pytest.raises(vg35.VG35Error, match="TRIAL_FAMILY_MISMATCH"):
        vg35.generate_trial_specs(protocol)


def test_one_day_abnormal_spike_cannot_signal_a_two_day_trial() -> None:
    bars, _spec, start, end = _duration_fixture(1)
    two_day_spec = vg35.TrialSpec("SYNTHETIC-D02-H01", 2, 1)

    observations, trades = vg35.detect_duration_signals(
        "BTCUSDT",
        bars,
        two_day_spec,
        start,
        end,
    )

    assert [item.age_days for item in observations] == [1]
    assert trades == ()


@pytest.mark.parametrize("exact_age_days", [2, 3, 5])
def test_exact_age_signal_occurs_once_when_spell_newly_attains_age(
    exact_age_days: int,
) -> None:
    bars, spec, start, end = _duration_fixture(exact_age_days)

    observations, trades = vg35.detect_duration_signals(
        "BTCUSDT",
        bars,
        spec,
        start,
        end,
    )

    assert [item.age_days for item in observations] == list(range(1, exact_age_days + 1))
    assert len(trades) == 1
    assert trades[0].signal_day == start + timedelta(days=exact_age_days - 1)


def test_future_skipped_day_mutation_cannot_change_signal_day_membership() -> None:
    bars, spec, start, end = _duration_fixture(2)
    signal_day = start + timedelta(days=1)
    skipped_day = signal_day + timedelta(days=1)
    mutated = tuple(
        _bar(
            item.day,
            "1000" if item.day == skipped_day else str(item.quote_volume),
            str(item.open_price),
        )
        for item in bars
    )

    _, original_trades = vg35.detect_duration_signals("BTCUSDT", bars, spec, start, end)
    _, mutated_trades = vg35.detect_duration_signals("BTCUSDT", mutated, spec, start, end)

    original = next(item for item in original_trades if item.signal_day == signal_day)
    changed = next(item for item in mutated_trades if item.signal_day == signal_day)
    assert (original.symbol, original.signal_day, original.entry_day, original.exit_day) == (
        changed.symbol,
        changed.signal_day,
        changed.entry_day,
        changed.exit_day,
    )


@pytest.mark.parametrize("holding_days", [1, 3])
def test_signal_skips_full_next_day_then_enters_t_plus_two_and_exits_at_h(
    holding_days: int,
) -> None:
    bars, _, start, end = _duration_fixture(2, holding_days)
    spec = vg35.TrialSpec(f"SYNTHETIC-H{holding_days:02d}", 2, holding_days)

    _, trades = vg35.detect_duration_signals("BTCUSDT", bars, spec, start, end)

    assert len(trades) == 1
    trade = trades[0]
    assert trade.entry_day == trade.signal_day + timedelta(days=2)
    assert trade.exit_day == trade.entry_day + timedelta(days=holding_days)


def test_signal_baseline_uses_only_the_rolling_prior_sixty_days() -> None:
    origin = date(2025, 1, 1)
    start = origin + timedelta(days=160)
    volumes = {
        **dict.fromkeys(range(100), "100"),
        **dict.fromkeys(range(100, 160), "10"),
        160: "20",
    }
    bars = _daily_bars(origin, 170, volumes=volumes)
    spec = vg35.TrialSpec("SYNTHETIC-D01-H01", 1, 1)

    _, trades = vg35.detect_duration_signals(
        "BTCUSDT",
        bars,
        spec,
        start,
        start + timedelta(days=10),
    )

    assert [item.signal_day for item in trades] == [start]


def test_partition_boundary_resets_spell_age_even_if_preboundary_days_are_abnormal() -> None:
    origin = date(2025, 1, 1)
    start = origin + timedelta(days=65)
    bars = _daily_bars(
        origin,
        85,
        volumes=dict.fromkeys(range(60, 67), "20"),
    )
    spec = vg35.TrialSpec("SYNTHETIC-D02-H01", 2, 1)

    _, trades = vg35.detect_duration_signals(
        "BTCUSDT",
        bars,
        spec,
        start,
        start + timedelta(days=15),
    )

    assert [item.signal_day for item in trades] == [start + timedelta(days=1)]


def test_overlap_filter_keeps_earliest_cohort_and_marks_full_daily_path(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    start = date(2026, 1, 1)
    end = start + timedelta(days=8)
    bars = {"AAAUSDT": _daily_bars(start, 8)}
    first = vg35.Trade(
        "AAAUSDT",
        start,
        start + timedelta(days=2),
        start + timedelta(days=5),
        1.0,
        2_000.0,
    )
    overlapping = vg35.Trade(
        "AAAUSDT",
        start + timedelta(days=1),
        start + timedelta(days=3),
        start + timedelta(days=6),
        1.0,
        2_000.0,
    )

    def synthetic_detect(
        _symbol: str,
        _bars: Sequence[vg35.Bar],
        _spec: vg35.TrialSpec,
        _start: date,
        _end: date,
        lookback: int = 60,
    ) -> tuple[tuple[vg35.SpellObservation, ...], tuple[vg35.Trade, ...]]:
        assert lookback == 60
        return (), (first, overlapping)

    monkeypatch.setattr(vg35, "detect_duration_signals", synthetic_detect)
    evaluation = vg35._evaluate_partition(
        vg35.load_protocol(),
        bars,
        vg35.TrialSpec("SYNTHETIC", 2, 3),
        start,
        end,
    )

    assert evaluation.report["completedCohorts"] == 1
    assert evaluation.report["suppressedOverlappingFormationDays"] == 1
    assert len(evaluation.stress_log_returns) == (end - start).days
    assert evaluation.report["gross"]["maximumDrawdownFraction"] == 0.0


def test_flat_price_cost_scenarios_are_strictly_monotone(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    start = date(2026, 1, 1)
    end = start + timedelta(days=5)
    bars = {"AAAUSDT": _daily_bars(start, 5)}
    trade = vg35.Trade(
        "AAAUSDT",
        start,
        start + timedelta(days=2),
        start + timedelta(days=3),
        1.0,
        2_000.0,
    )

    monkeypatch.setattr(
        vg35,
        "detect_duration_signals",
        lambda *_args, **_kwargs: ((), (trade,)),
    )
    report = vg35._evaluate_partition(
        vg35.load_protocol(),
        bars,
        vg35.TrialSpec("SYNTHETIC", 2, 1),
        start,
        end,
    ).report

    values = [
        report["gross"]["endingNavUsd"],
        report["publicFeeOnly"]["endingNavUsd"],
        report["base"]["endingNavUsd"],
        report["stress"]["endingNavUsd"],
        report["severe"]["endingNavUsd"],
        report["feeStress"]["endingNavUsd"],
    ]
    assert values == sorted(values, reverse=True)
    assert len(set(values)) == len(values)


def test_timing_comparator_holds_fixed_full_universe_on_identical_window() -> None:
    start = date(2026, 1, 1)
    days = [start + timedelta(days=offset) for offset in range(5)]
    bars = {
        "AAAUSDT": _daily_bars(
            start,
            5,
            prices={3: "110", 4: "110"},
        ),
        "BBBUSDT": _daily_bars(start, 5),
    }
    trade = vg35.Trade(
        "AAAUSDT",
        start,
        start + timedelta(days=1),
        start + timedelta(days=3),
        1.1,
        2_000.0,
    )
    cohorts = ((trade.signal_day, trade.entry_day, trade.exit_day, (trade,)),)

    strategy, comparator = vg35._mark_to_market_logs(
        bars,
        cohorts,
        days,
        fee_bp=0,
        adverse_bp=0,
    )

    assert math.exp(sum(strategy)) == pytest.approx(1.1)
    assert math.exp(sum(comparator)) == pytest.approx(1.05)
    assert strategy[0] == comparator[0] == 0.0
    assert strategy[-1] == comparator[-1] == 0.0


def test_supported_capital_uses_prior_thirty_day_medians_for_both_legs() -> None:
    start = date(2025, 1, 1)
    bars = {
        bar.day: bar
        for bar in _daily_bars(
            start,
            45,
            volumes={
                **dict.fromkeys(range(45), "20000000"),
                35: "1",
                38: "999999999",
            },
        )
    }
    entry = start + timedelta(days=35)
    exit_day = start + timedelta(days=38)

    assert vg35._supported_capital(bars, entry, exit_day, 30) == 2_000.0
    with pytest.raises(vg35.MeasurementError, match="CAPACITY_LOOKBACK_INCOMPLETE"):
        vg35._supported_capital(
            bars,
            start + timedelta(days=29),
            start + timedelta(days=30),
            30,
        )


@pytest.mark.parametrize("block_length", [14, 28])
def test_circular_calendar_blocks_are_deterministic_contiguous_and_wrapped(
    block_length: int,
) -> None:
    first = vg35.circular_block_indices(45, block_length, 4, 350725)
    second = vg35.circular_block_indices(45, block_length, 4, 350725)

    assert first == second
    assert len(first) == 4
    assert all(len(sample) == 45 for sample in first)
    for sample in first:
        for block_start in range(0, len(sample), block_length):
            block = sample[block_start : block_start + block_length]
            assert all(right == (left + 1) % 45 for left, right in pairwise(block))


def test_family_inference_holm_family_contains_all_twelve_hypotheses() -> None:
    protocol = deepcopy(vg35.load_protocol())
    protocol["inference"]["bootstrap"]["replicates"] = 32
    trial_ids = [item.trial_id for item in vg35.generate_trial_specs(protocol)]
    stress = {
        trial_id: tuple(0.001 * (index + 1) if day % 5 == 0 else 0.0 for day in range(80))
        for index, trial_id in enumerate(trial_ids)
    }
    benchmark = dict.fromkeys(trial_ids, (0.0,) * 80)

    result = vg35._family_inference(protocol, stress, benchmark)

    assert result["holmHypothesisCount"] == 12
    assert set(result["trials"]) == set(trial_ids)
    assert all(
        "absoluteHolmAdjustedPValue" in result["trials"][trial_id]
        and "timingMatchedExcessHolmAdjustedPValue" in result["trials"][trial_id]
        for trial_id in trial_ids
    )


def test_cscv_uses_all_eight_choose_four_splits() -> None:
    matrix = {
        f"T{index}": tuple(float(((day + index) % 7) - 3) / 10_000 for day in range(80))
        for index in range(6)
    }

    result = vg35.cscv_pbo(matrix, block_count=8, in_sample_blocks=4)

    assert result["status"] == "AVAILABLE"
    assert result["splitCount"] == 70
    assert result["role"] == "DIAGNOSTIC_ONLY_NOT_A_P_VALUE_OR_GATE"


def test_kline_parser_accepts_microseconds_and_rejects_milliseconds() -> None:
    moment = datetime(2025, 1, 1, tzinfo=UTC)
    open_microseconds = int(moment.timestamp()) * 1_000_000
    row = [
        str(open_microseconds),
        "100",
        "110",
        "90",
        "105",
        "1000",
        str(open_microseconds + 86_400_000_000 - 1),
        "100000",
        "10",
        "500",
        "50000",
        "0",
    ]
    columns = vg35.load_protocol()["data"]["klineColumnsZeroBased"]

    assert vg35._parse_bar(row, columns) == vg35.Bar(
        date(2025, 1, 1),
        Decimal("100"),
        Decimal("100000"),
    )
    row[0] = str(open_microseconds // 1_000)
    with pytest.raises(vg35.MeasurementError, match="TIMESTAMP_NOT_MICROSECONDS"):
        vg35._parse_bar(row, columns)


def test_archive_loader_rejects_non_twelve_column_schema_without_real_zip(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    (tmp_path / "synthetic.zip").touch()
    protocol = deepcopy(vg35.load_protocol())
    protocol["data"]["sourceCorpusRoot"] = str(tmp_path)
    protocol["data"]["symbols"] = ["BTCUSDT"]
    manifest = {
        "archives": [
            {
                "symbol": "BTCUSDT",
                "month": "2025-01",
                "archive": {"path": "synthetic.zip"},
            }
        ]
    }

    class FakeInfo:
        filename = "BTCUSDT-1d-2025-01.csv"

        @staticmethod
        def is_dir() -> bool:
            return False

    class FakeZip:
        def __enter__(self) -> FakeZip:
            return self

        def __exit__(self, *_args: object) -> None:
            return None

        @staticmethod
        def infolist() -> list[FakeInfo]:
            return [FakeInfo()]

        @staticmethod
        def open(_member: FakeInfo, _mode: str) -> io.BytesIO:
            return io.BytesIO(b"1,2,3,4,5,6,7,8,9,10,11\n")

    monkeypatch.setattr(zipfile, "ZipFile", lambda *_args, **_kwargs: FakeZip())

    with pytest.raises(vg35.MeasurementError, match="CSV_SCHEMA_MISMATCH"):
        vg35._load_bars(
            protocol,
            manifest,
            allowed_months=("2025-01",),
            expected_start=date(2025, 1, 1),
            expected_end=date(2025, 2, 1),
        )


def test_exclusive_marker_write_never_overwrites_consumed_state(tmp_path: Path) -> None:
    marker = tmp_path / "run-marker.v1.json"

    vg35._write_json_exclusive(marker, {"state": "CONSUMED"})

    first_bytes = marker.read_bytes()
    with pytest.raises(FileExistsError):
        vg35._write_json_exclusive(marker, {"state": "REPLACED"})
    assert marker.read_bytes() == first_bytes


def test_terminal_verifier_is_hash_only_zip_closed_and_detects_chain_tamper(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    paths = _install_verifier_fixture(tmp_path, monkeypatch)

    verified = vg35.verify()

    assert verified["status"] == "PASS"
    assert verified["sourceArchivesReopened"] == 0
    assert verified["statisticsRecomputed"] is False
    assert verified["networkUsed"] is False

    development = json.loads(paths["development"].read_text(encoding="utf-8"))
    development["syntheticTamper"] = True
    _write_json(paths["development"], development)
    _refresh_sha256sums(paths["packet"], paths["checksums"])
    with pytest.raises(vg35.VG35Error, match="RESULT_DEVELOPMENT_HASH_MISMATCH"):
        vg35.verify()
