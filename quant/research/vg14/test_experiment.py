"""Synthetic-only focused verification for the sealed V-G14 evaluator."""

from __future__ import annotations

import hashlib
import io
import json
import os
import zipfile
from collections.abc import Callable
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from typing import cast

import pytest

from . import experiment as vg14


def month_start_us(month: str) -> int:
    value = datetime.strptime(f"{month}-01", "%Y-%m-%d").replace(tzinfo=UTC)
    return int(value.timestamp() * 1_000_000)


def csv_bytes(
    month: str,
    *,
    header: bool = False,
    quote_volume: str = "20000000",
    skip_index: int | None = None,
) -> bytes:
    start, end = vg14.month_bounds_us(month)
    rows: list[str] = []
    if header:
        rows.append(",".join(vg14.CSV_HEADER))
    for index, timestamp in enumerate(range(start, end, vg14.BAR_US)):
        if index == skip_index:
            continue
        rows.append(
            ",".join(
                (
                    str(timestamp),
                    "100",
                    "101",
                    "99",
                    "100",
                    "1",
                    str(timestamp + vg14.BAR_US - 1),
                    quote_volume,
                    "10",
                    "0.5",
                    "10000000",
                    "0",
                )
            )
        )
    return ("\n".join(rows) + "\n").encode()


def zip_bytes(symbol: str, month: str, payload: bytes, *, member: str | None = None) -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(member or f"{symbol}-30m-{month}.csv", payload)
    return output.getvalue()


def bar(symbol: str, timestamp: int, price: str, volume: str) -> vg14.Bar:
    return vg14.Bar(symbol, timestamp, Decimal(price), Decimal(volume))


def minimal_config(symbols: list[str]) -> dict[str, vg14.JsonValue]:
    return {
        "bootstrap": {
            "blockLengthRoundTrips": 2,
            "replicates": 64,
            "seed": 14,
        },
        "costs": {
            "base": {
                "feeBasisPointsPerFill": 10,
                "adverseExecutionBasisPointsPerFill": 5,
            },
            "stress": {
                "feeBasisPointsPerFill": 10,
                "adverseExecutionBasisPointsPerFill": 15,
            },
            "severeDiagnostic": {
                "feeBasisPointsPerFill": 20,
                "adverseExecutionBasisPointsPerFill": 25,
            },
        },
        "data": {"fixedCohort": cast(vg14.JsonValue, list(symbols))},
        "formalGoGates": {
            "development": {
                "activeUtcMonthsMinimum": 1,
                "bootstrapLowerBoundExclusiveMinimum": "0",
                "distinctSymbolsMinimum": 1,
                "holmAdjustedPValueMaximum": "1",
                "maximumStressDrawdownMaximum": "1",
                "positiveUtcMonthsMinimum": 1,
                "roundTripsMinimum": 1,
                "stressCompoundedReturnExclusiveMinimum": "0",
            },
            "holdout": {
                "activeUtcMonthsMinimum": 1,
                "bootstrapLowerBoundExclusiveMinimum": "0",
                "maximumStressDrawdownMaximum": "1",
                "oneSidedPValueMaximum": "1",
                "positiveUtcMonthsMinimum": 1,
                "roundTripsMinimum": 1,
                "stressCompoundedReturnExclusiveMinimum": "0",
            },
            "proxyCapacity": {
                "entryNotionalUsd": "1000",
                "maximumFailedRoundTripFraction": "1",
                "participationBasisPointsOfSignalBarQuoteVolume": 1,
            },
        },
        "trials": {
            "attemptedCount": 4,
            "holdHours": [6, 12],
            "residualMultiples": ["2", "4"],
        },
    }


def passing_summary(spec: vg14.TrialSpec, stress_return: str) -> dict[str, vg14.JsonValue]:
    return {
        "activeUtcMonths": 1,
        "baseCompoundedReturn": stress_return,
        "bootstrapLowerBoundMeanStressReturn": "0.01",
        "distinctSymbols": 1,
        "grossCompoundedReturn": stress_return,
        "holdHours": spec.hold_hours,
        "maximumStressDrawdown": "0.01",
        "positiveUtcMonths": 1,
        "proxyCapacityFailedFraction": "0",
        "rawOneSidedBootstrapPValue": "0.01",
        "residualMultiple": str(spec.residual_multiple),
        "roundTrips": 10,
        "severeCompoundedReturn": stress_return,
        "stressCompoundedReturn": stress_return,
        "trialId": spec.trial_id,
    }


def replace_json(path: Path, value: vg14.JsonValue) -> None:
    path.chmod(0o644)
    path.write_bytes(vg14.canonical_json_bytes(value))
    path.chmod(0o444)


def make_candidate_state(
    state_root: Path, monkeypatch: pytest.MonkeyPatch
) -> tuple[dict[str, vg14.JsonValue], dict[str, vg14.JsonValue]]:
    config = minimal_config(["BTCUSDT"])
    monkeypatch.setattr(vg14, "verify_evaluator_freeze", lambda _root: {})
    evaluator_freeze: dict[str, vg14.JsonValue] = {"version": "synthetic-evaluator-freeze"}
    vg14.write_once(state_root / "evaluator_freeze.v1.json", evaluator_freeze)
    source_manifest: dict[str, vg14.JsonValue] = {
        "objects": [{"archive": "synthetic.zip"}],
        "partition": "development",
        "protocolSha256": vg14.sha256_file(vg14.PROTOCOL_PATH),
        "version": "VG14SourceManifestV1",
        "zipMembersOpened": 0,
    }
    source_path = state_root / "development_source_manifest.v1.json"
    vg14.write_once(source_path, source_manifest)
    marker: dict[str, vg14.JsonValue] = {
        "law": "WRITTEN_BEFORE_FIRST_DEVELOPMENT_ZIP_MEMBER_OPEN",
        "sourceManifestSha256": vg14.sha256_file(source_path),
        "version": "VG14DevelopmentConsumptionMarkerV1",
    }
    marker_path = state_root / "markers" / "development_consumed.v1.json"
    vg14.write_once(marker_path, marker)
    summaries = [
        passing_summary(spec, "0.2" if spec.trial_id == "R2x-H6h" else "0.1")
        for spec in vg14.trial_specs(config)
    ]
    vg14.apply_development_gates(summaries, config)
    champion = vg14.select_champion(summaries)
    assert champion is not None
    result: dict[str, vg14.JsonValue] = {
        "accountEffectiveFees": "UNKNOWN",
        "archiveObjectCount": 1,
        "barsValidated": 1,
        "championTrialId": champion["trialId"],
        "evaluatorSha256": vg14.evaluator_digest(),
        "limitations": vg14.limitations(),
        "partition": "development",
        "protocolFreezeSha256": vg14.sha256_file(vg14.FREEZE_PATH),
        "protocolSha256": vg14.sha256_file(vg14.PROTOCOL_PATH),
        "sourceManifestSha256": vg14.sha256_file(source_path),
        "trials": cast(vg14.JsonValue, summaries),
        "verdict": "CANDIDATE_SEALED",
        "version": "VG14DevelopmentResultV1",
    }
    result_path = state_root / "development_result.v1.json"
    vg14.write_once(result_path, result)
    tail_path = state_root / "development_history_tail.v1.jsonl"
    tail_path.write_bytes(b'{"open":"1","openTimeUs":1,"quoteVolume":"1","symbol":"BTCUSDT"}\n')
    seal: dict[str, vg14.JsonValue] = {
        "champion": champion,
        "developmentConsumptionMarkerSha256": vg14.sha256_file(marker_path),
        "developmentResultSha256": vg14.sha256_file(result_path),
        "developmentSourceManifestSha256": vg14.sha256_file(source_path),
        "evaluatorFreezeSha256": vg14.sha256_file(state_root / "evaluator_freeze.v1.json"),
        "evaluatorSha256": vg14.evaluator_digest(),
        "historyTailPath": tail_path.name,
        "historyTailSha256": vg14.sha256_file(tail_path),
        "protocolFreezeSha256": vg14.sha256_file(vg14.FREEZE_PATH),
        "protocolSha256": vg14.sha256_file(vg14.PROTOCOL_PATH),
        "version": "VG14CandidateSealV1",
    }
    vg14.write_once(state_root / "candidate_seal.v1.json", seal)
    return config, seal


def test_frozen_anchor_hashes_verify_and_base_is_exact() -> None:
    vg14.verify_protocol_freeze()
    assert vg14.verify_repository_base() == "a169b123fb186d1943a75ad648552c4d95be1be1"


def test_frozen_anchor_digest_mismatch_is_unmeasured(monkeypatch: pytest.MonkeyPatch) -> None:
    real_sha256_file: Callable[[Path], str] = vg14.sha256_file

    def mismatched(path: Path) -> str:
        if path == vg14.PROTOCOL_PATH:
            return "0" * 64
        return real_sha256_file(path)

    monkeypatch.setattr(vg14, "sha256_file", mismatched)
    with pytest.raises(vg14.UnmeasuredError, match="digest mismatch"):
        vg14.verify_protocol_freeze()


@pytest.mark.parametrize(
    ("payload", "expected"),
    [
        (b"a" * 64 + b"  BTCUSDT-30m-2025-05.zip\n", "a" * 64),
        (b"B" * 64 + b"\tBTCUSDT-30m-2025-05.zip\r\n", "b" * 64),
    ],
)
def test_sidecar_parser_accepts_one_exact_digest_line(payload: bytes, expected: str) -> None:
    assert vg14.parse_sidecar(payload, "BTCUSDT-30m-2025-05.zip") == expected


@pytest.mark.parametrize(
    "payload",
    [
        b"",
        b"a" * 63 + b"  BTCUSDT-30m-2025-05.zip\n",
        b"a" * 64 + b"  ../BTCUSDT-30m-2025-05.zip\n",
        b"a" * 64 + b"  wrong.zip\n",
        b"a" * 64 + b"  BTCUSDT-30m-2025-05.zip\nextra\n",
    ],
)
def test_sidecar_parser_rejects_malformed_or_mismatched(payload: bytes) -> None:
    with pytest.raises(vg14.UnmeasuredError):
        vg14.parse_sidecar(payload, "BTCUSDT-30m-2025-05.zip")


def test_inventory_authenticates_without_opening_zip(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    config: dict[str, vg14.JsonValue] = {
        "data": {
            "archiveUrlTemplate": (
                "https://data.binance.vision/data/spot/monthly/klines/"
                "{symbol}/30m/{symbol}-30m-{yyyy_mm}.zip"
            ),
            "developmentArchiveMonths": ["2025-05"],
            "holdoutArchiveMonths": ["2026-03"],
            "fixedCohort": ["BTCUSDT"],
        }
    }
    monkeypatch.setattr(vg14, "protocol", lambda: config)
    monkeypatch.setattr(vg14, "verify_evaluator_freeze", lambda _root: {})
    archive_path, sidecar_path = vg14.custody_paths(tmp_path, "development", "BTCUSDT", "2025-05")
    archive_path.parent.mkdir(parents=True)
    opaque = b"authenticated but intentionally not a ZIP"
    archive_path.write_bytes(opaque)
    sidecar_path.write_bytes(
        f"{hashlib.sha256(opaque).hexdigest()}  {archive_path.name}\n".encode()
    )
    manifest = vg14.inventory_partition(tmp_path, "development")
    assert manifest["zipMembersOpened"] == 0
    assert manifest["objects"] == [
        {
            "archiveBytes": len(opaque),
            "archiveSha256": hashlib.sha256(opaque).hexdigest(),
            "archiveUrl": (
                "https://data.binance.vision/data/spot/monthly/klines/"
                "BTCUSDT/30m/BTCUSDT-30m-2025-05.zip"
            ),
            "sidecarBytes": sidecar_path.stat().st_size,
            "sidecarSha256": vg14.sha256_file(sidecar_path),
            "sidecarUrl": (
                "https://data.binance.vision/data/spot/monthly/klines/"
                "BTCUSDT/30m/BTCUSDT-30m-2025-05.zip.CHECKSUM"
            ),
            "symbol": "BTCUSDT",
            "utcMonth": "2025-05",
        }
    ]


def test_inventory_rejects_checksum_mismatch(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    config: dict[str, vg14.JsonValue] = {
        "data": {
            "archiveUrlTemplate": (
                "https://data.binance.vision/data/spot/monthly/klines/"
                "{symbol}/30m/{symbol}-30m-{yyyy_mm}.zip"
            ),
            "developmentArchiveMonths": ["2025-05"],
            "holdoutArchiveMonths": [],
            "fixedCohort": ["BTCUSDT"],
        }
    }
    monkeypatch.setattr(vg14, "protocol", lambda: config)
    monkeypatch.setattr(vg14, "verify_evaluator_freeze", lambda _root: {})
    archive_path, sidecar_path = vg14.custody_paths(tmp_path, "development", "BTCUSDT", "2025-05")
    archive_path.parent.mkdir(parents=True)
    archive_path.write_bytes(b"archive")
    sidecar_path.write_bytes(f"{'0' * 64}  {archive_path.name}\n".encode())
    with pytest.raises(vg14.UnmeasuredError, match="checksum mismatch"):
        vg14.inventory_partition(tmp_path, "development")


@pytest.mark.parametrize("header", [False, True])
def test_full_month_csv_accepts_documented_schema_and_exact_grid(header: bool) -> None:
    bars = vg14.parse_csv_member(csv_bytes("2025-05", header=header), "BTCUSDT", "2025-05")
    expected = (vg14.month_bounds_us("2025-05")[1] - month_start_us("2025-05")) // vg14.BAR_US
    assert len(bars) == expected
    assert bars[0].open_time_us == month_start_us("2025-05")
    assert bars[0].quote_volume == Decimal("20000000")


def test_csv_rejects_gap_wrong_unit_nonpositive_and_bad_header() -> None:
    with pytest.raises(vg14.UnmeasuredError, match="grid gap"):
        vg14.parse_csv_member(
            csv_bytes("2025-05", skip_index=10),
            "BTCUSDT",
            "2025-05",
        )
    bad_unit = csv_bytes("2025-05").replace(
        str(month_start_us("2025-05")).encode(),
        str(month_start_us("2025-05") // 1000).encode(),
        1,
    )
    with pytest.raises(vg14.UnmeasuredError, match="microsecond"):
        vg14.parse_csv_member(bad_unit, "BTCUSDT", "2025-05")
    with pytest.raises(vg14.UnmeasuredError, match="nonpositive"):
        vg14.parse_csv_member(
            csv_bytes("2025-05", quote_volume="0"),
            "BTCUSDT",
            "2025-05",
        )
    bad_header = b"timestamp,open\n" + csv_bytes("2025-05")
    with pytest.raises(vg14.UnmeasuredError, match="header/schema"):
        vg14.parse_csv_member(bad_header, "BTCUSDT", "2025-05")


def test_csv_rejects_duplicate_timestamp() -> None:
    rows = csv_bytes("2025-05").splitlines()
    first_time = rows[0].split(b",", maxsplit=1)[0]
    rows[1] = first_time + b"," + rows[1].split(b",", maxsplit=1)[1]
    with pytest.raises(vg14.UnmeasuredError, match="duplicate bar"):
        vg14.parse_csv_member(b"\n".join(rows) + b"\n", "BTCUSDT", "2025-05")


def test_zip_rejects_traversal_multiple_members_and_wrong_member(tmp_path: Path) -> None:
    payload = csv_bytes("2025-05")
    for index, member in enumerate(("../escape.csv", "wrong.csv")):
        path = tmp_path / f"bad-{index}.zip"
        path.write_bytes(zip_bytes("BTCUSDT", "2025-05", payload, member=member))
        with pytest.raises(vg14.UnmeasuredError, match="unsafe or unexpected"):
            vg14.open_authenticated_archive(path, "BTCUSDT", "2025-05")
    multiple = tmp_path / "multiple.zip"
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr("BTCUSDT-30m-2025-05.csv", payload)
        archive.writestr("extra.csv", b"x")
    multiple.write_bytes(output.getvalue())
    with pytest.raises(vg14.UnmeasuredError, match="exactly one"):
        vg14.open_authenticated_archive(multiple, "BTCUSDT", "2025-05")


def test_valid_zip_opens_one_expected_member(tmp_path: Path) -> None:
    path = tmp_path / "BTCUSDT-30m-2025-05.zip"
    path.write_bytes(zip_bytes("BTCUSDT", "2025-05", csv_bytes("2025-05")))
    bars = vg14.open_authenticated_archive(path, "BTCUSDT", "2025-05")
    assert len(bars) == 31 * 48


def test_signal_uses_prior_eight_weeks_tie_break_delay_and_flat_law() -> None:
    config = minimal_config(["AAAUSDT", "BBBUSDT"])
    start = month_start_us("2026-01")
    hold_hours = 6
    end = start + 24 * 60 * 60 * 1_000_000
    bars: list[vg14.Bar] = []
    for symbol in ("AAAUSDT", "BBBUSDT"):
        for timestamp in range(start - 8 * vg14.WEEK_US, end + 1, vg14.BAR_US):
            price = Decimal("100") + Decimal(timestamp - start) / Decimal(vg14.BAR_US * 100)
            volume = "100"
            if timestamp in (start, start + vg14.BAR_US):
                volume = "400" if symbol == "AAAUSDT" else "500"
            bars.append(bar(symbol, timestamp, str(price), volume))
    trips = vg14.evaluate_round_trips(
        bars,
        vg14.TrialSpec("R2x-H6h", Decimal("2"), hold_hours),
        start,
        end,
        config,
    )
    assert len(trips) == 1
    assert trips[0].symbol == "BBBUSDT"
    assert trips[0].entry_time_us == start + 2 * vg14.BAR_US
    assert trips[0].exit_time_us == trips[0].entry_time_us + hold_hours * 60 * 60 * 1_000_000


def test_signal_rejects_missing_prior_week_or_entry_bar() -> None:
    config = minimal_config(["BTCUSDT"])
    start = month_start_us("2026-01")
    end = start + 24 * 60 * 60 * 1_000_000
    bars = [
        bar("BTCUSDT", timestamp, "100", "100")
        for timestamp in range(start - 8 * vg14.WEEK_US, end + 1, vg14.BAR_US)
    ]
    bars = [item for item in bars if item.open_time_us != start - 4 * vg14.WEEK_US]
    with pytest.raises(vg14.UnmeasuredError, match="prior seasonal"):
        vg14.evaluate_round_trips(
            bars,
            vg14.TrialSpec("R2x-H6h", Decimal("2"), 6),
            start,
            end,
            config,
        )
    bars = [
        bar(
            "BTCUSDT",
            timestamp,
            "100",
            "400" if timestamp == start else "100",
        )
        for timestamp in range(start - 8 * vg14.WEEK_US, end + 1, vg14.BAR_US)
        if timestamp != start + 2 * vg14.BAR_US
    ]
    with pytest.raises(vg14.UnmeasuredError, match="entry/exit"):
        vg14.evaluate_round_trips(
            bars,
            vg14.TrialSpec("R2x-H6h", Decimal("2"), 6),
            start,
            end,
            config,
        )


def test_end_exclusive_boundary_never_requires_next_partition_open() -> None:
    config = minimal_config(["BTCUSDT"])
    start = month_start_us("2026-01")
    end = start + 24 * 60 * 60 * 1_000_000
    hold_us = 6 * 60 * 60 * 1_000_000
    excluded_signal_time = end - 2 * vg14.BAR_US - hold_us
    bars = [
        bar(
            "BTCUSDT",
            timestamp,
            "100",
            "400" if timestamp == excluded_signal_time else "100",
        )
        for timestamp in range(start - 8 * vg14.WEEK_US, end, vg14.BAR_US)
    ]
    trips = vg14.evaluate_round_trips(
        bars,
        vg14.TrialSpec("R2x-H6h", Decimal("2"), 6),
        start,
        end,
        config,
    )
    assert trips == []


def test_proxy_cost_formula_compounding_and_drawdown() -> None:
    gross_factor = 1.02
    assert vg14.proxy_return(gross_factor, 10, 15) == pytest.approx(
        gross_factor * (1 - 0.0025) ** 2 - 1
    )
    assert vg14.compounded_return([0.1, -0.1]) == pytest.approx(-0.01)
    assert vg14.maximum_drawdown([0.1, -0.2, 0.05]) == pytest.approx(0.2)


def test_bootstrap_is_deterministic_and_holm_is_monotone() -> None:
    first = vg14.bootstrap_inference([0.01, 0.02, -0.005], replicates=128, block_length=2, seed=14)
    second = vg14.bootstrap_inference([0.01, 0.02, -0.005], replicates=128, block_length=2, seed=14)
    assert first == second
    adjusted = vg14.holm_adjust({"a": 0.01, "b": 0.02, "c": 0.5, "d": 0.03})
    assert adjusted == {"a": 0.04, "b": 0.06, "d": 0.06, "c": 0.5}


def test_gate_failure_is_no_champion_and_passer_selection_is_deterministic() -> None:
    config = minimal_config(["BTCUSDT"])
    summaries: list[dict[str, vg14.JsonValue]] = [
        {
            "activeUtcMonths": 1,
            "bootstrapLowerBoundMeanStressReturn": "0.01",
            "distinctSymbols": 1,
            "holdHours": 12,
            "maximumStressDrawdown": "0.1",
            "positiveUtcMonths": 1,
            "proxyCapacityFailedFraction": "0",
            "rawOneSidedBootstrapPValue": "0.01",
            "residualMultiple": "4",
            "roundTrips": 10,
            "stressCompoundedReturn": "0.2",
            "trialId": "R4x-H12h",
        },
        {
            "activeUtcMonths": 1,
            "bootstrapLowerBoundMeanStressReturn": "0.01",
            "distinctSymbols": 1,
            "holdHours": 6,
            "maximumStressDrawdown": "0.1",
            "positiveUtcMonths": 1,
            "proxyCapacityFailedFraction": "0",
            "rawOneSidedBootstrapPValue": "0.01",
            "residualMultiple": "2",
            "roundTrips": 10,
            "stressCompoundedReturn": "0.2",
            "trialId": "R2x-H6h",
        },
    ]
    vg14.apply_development_gates(summaries, config)
    assert vg14.select_champion(summaries) is summaries[1]
    summaries[0]["passesAllDevelopmentGates"] = False
    summaries[1]["passesAllDevelopmentGates"] = False
    assert vg14.select_champion(summaries) is None


def test_valid_development_gate_failure_is_terminal_no_go_and_holdout_absent(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    config = minimal_config(["BTCUSDT"])
    monkeypatch.setattr(vg14, "protocol", lambda: config)
    monkeypatch.setattr(vg14, "verify_evaluator_freeze", lambda _root: {})
    monkeypatch.setattr(
        vg14,
        "consume_archives",
        lambda _root, _partition: (
            [],
            {
                "objects": [],
                "partition": "development",
                "version": "synthetic",
            },
        ),
    )
    monkeypatch.setattr(vg14, "partition_bounds", lambda _config, _partition: (0, 1))
    result = vg14.consume_development(tmp_path)
    assert result["verdict"] == "NO_GO"
    terminal = json.loads((tmp_path / "terminal_evidence.v1.json").read_text())
    assert terminal["verdict"] == "NO_GO"
    result_path = tmp_path / "development_result.v1.json"
    assert terminal["resultSha256"] == vg14.sha256_file(result_path)
    assert result["evaluatorSha256"] == vg14.evaluator_digest()
    assert result["protocolFreezeSha256"] == vg14.sha256_file(vg14.FREEZE_PATH)
    assert result["sourceManifestSha256"] == vg14.sha256_bytes(
        vg14.canonical_json_bytes(
            {
                "objects": [],
                "partition": "development",
                "version": "synthetic",
            }
        )
    )
    assert not (tmp_path / "candidate_seal.v1.json").exists()
    assert not (tmp_path / "custody" / "holdout").exists()
    assert not (tmp_path / "markers" / "holdout_opened.v1.json").exists()


def test_candidate_seal_verifies_entire_development_custody_chain(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    config, seal = make_candidate_state(tmp_path, monkeypatch)
    assert vg14.verify_candidate_seal(tmp_path, config) == seal


@pytest.mark.parametrize(
    "tamper_target",
    [
        "development_result.v1.json",
        "development_source_manifest.v1.json",
        "markers/development_consumed.v1.json",
        "evaluator_freeze.v1.json",
        "development_history_tail.v1.jsonl",
    ],
)
def test_candidate_seal_rejects_any_bound_artifact_tamper(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, tamper_target: str
) -> None:
    config, _seal = make_candidate_state(tmp_path, monkeypatch)
    path = tmp_path / tamper_target
    path.chmod(0o644)
    path.write_bytes(path.read_bytes() + b"x")
    with pytest.raises(vg14.UnmeasuredError, match=r"mismatch|invalid"):
        vg14.verify_candidate_seal(tmp_path, config)


def test_candidate_seal_rejects_fabricated_passing_champion(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    config, seal = make_candidate_state(tmp_path, monkeypatch)
    result_path = tmp_path / "development_result.v1.json"
    result = vg14.read_json_object(result_path)
    trials = cast(list[dict[str, vg14.JsonValue]], result["trials"])
    champion = next(trial for trial in trials if trial["trialId"] == result["championTrialId"])
    champion["passesAllDevelopmentGates"] = False
    checks = cast(dict[str, vg14.JsonValue], champion["gateChecks"])
    checks["roundTrips"] = False
    replace_json(result_path, result)
    seal["champion"] = champion
    seal["developmentResultSha256"] = vg14.sha256_file(result_path)
    replace_json(tmp_path / "candidate_seal.v1.json", seal)
    with pytest.raises(vg14.UnmeasuredError, match="did not pass every"):
        vg14.verify_candidate_seal(tmp_path, config)


def test_candidate_seal_rejects_stale_evaluator_identity(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    config, seal = make_candidate_state(tmp_path, monkeypatch)
    seal["evaluatorSha256"] = "0" * 64
    replace_json(tmp_path / "candidate_seal.v1.json", seal)
    with pytest.raises(vg14.UnmeasuredError, match="evaluatorSha256"):
        vg14.verify_candidate_seal(tmp_path, config)


@pytest.mark.parametrize(
    "relative_path",
    [
        "custody/holdout",
        "holdout_acquisition.v1.json",
        "holdout_source_manifest.v1.json",
        "holdout_result.v1.json",
        "markers/holdout_opened.v1.json",
        "markers/holdout_consumed.v1.json",
    ],
)
def test_predevelopment_rejects_any_physical_holdout_state(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    relative_path: str,
) -> None:
    config: dict[str, vg14.JsonValue] = {
        "data": {
            "archiveUrlTemplate": (
                "https://data.binance.vision/data/spot/monthly/klines/"
                "{symbol}/30m/{symbol}-30m-{yyyy_mm}.zip"
            ),
            "developmentArchiveMonths": [],
            "holdoutArchiveMonths": [],
            "fixedCohort": [],
        }
    }
    monkeypatch.setattr(vg14, "protocol", lambda: config)
    monkeypatch.setattr(vg14, "verify_evaluator_freeze", lambda _root: {})
    path = tmp_path / relative_path
    if path.suffix:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("synthetic", encoding="utf-8")
    else:
        path.mkdir(parents=True)
    with pytest.raises(vg14.UnmeasuredError, match="holdout must be physically absent"):
        vg14.acquire_partition(tmp_path, "development", fetcher=lambda _url: b"")


def test_acquisition_is_public_only_and_holdout_needs_seal(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    with pytest.raises(vg14.UnmeasuredError, match="non-frozen"):
        vg14.validate_public_url("file:///tmp/archive.zip")
    with pytest.raises(vg14.UnmeasuredError, match="non-frozen"):
        vg14.validate_public_url("https://example.com/archive.zip")
    config: dict[str, vg14.JsonValue] = {
        "data": {
            "archiveUrlTemplate": (
                "https://data.binance.vision/data/spot/monthly/klines/"
                "{symbol}/30m/{symbol}-30m-{yyyy_mm}.zip"
            ),
            "developmentArchiveMonths": [],
            "holdoutArchiveMonths": ["2026-03"],
            "fixedCohort": ["BTCUSDT"],
        }
    }
    monkeypatch.setattr(vg14, "protocol", lambda: config)
    monkeypatch.setattr(vg14, "verify_evaluator_freeze", lambda _root: {})
    with pytest.raises(vg14.UnmeasuredError, match="without candidate seal"):
        vg14.acquire_partition(tmp_path, "holdout", fetcher=lambda _url: b"")
    assert not (tmp_path / "markers" / "holdout_opened.v1.json").exists()


def test_holdout_marker_precedes_first_fetch(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    config, _seal = make_candidate_state(tmp_path, monkeypatch)
    data = cast(dict[str, vg14.JsonValue], config["data"])
    data["archiveUrlTemplate"] = (
        "https://data.binance.vision/data/spot/monthly/klines/"
        "{symbol}/30m/{symbol}-30m-{yyyy_mm}.zip"
    )
    data["developmentArchiveMonths"] = []
    data["holdoutArchiveMonths"] = ["2026-03"]
    monkeypatch.setattr(vg14, "protocol", lambda: config)

    def failing_fetch(_url: str) -> bytes:
        assert (tmp_path / "markers" / "holdout_opened.v1.json").exists()
        raise vg14.UnmeasuredError("synthetic stop")

    with pytest.raises(vg14.UnmeasuredError, match="synthetic stop"):
        vg14.acquire_partition(tmp_path, "holdout", fetcher=failing_fetch)


def test_write_once_refuses_rerun_and_terminal_is_immutable(tmp_path: Path) -> None:
    path = tmp_path / "marker.json"
    vg14.write_once(path, {"value": 1})
    mode = path.stat().st_mode & 0o777
    assert mode == 0o444
    with pytest.raises(vg14.UnmeasuredError, match="already exists"):
        vg14.write_once(path, {"value": 2})
    vg14.record_unmeasured(tmp_path, "synthetic", "failure")
    first = (tmp_path / "terminal_evidence.v1.json").read_bytes()
    vg14.record_unmeasured(tmp_path, "synthetic", "different")
    assert (tmp_path / "terminal_evidence.v1.json").read_bytes() == first


def test_history_tail_is_digest_bound_and_path_data_round_trips(tmp_path: Path) -> None:
    bars = [
        bar("BTCUSDT", month_start_us("2026-01"), "100", "20000000"),
        bar("ETHUSDT", month_start_us("2026-01"), "200", "30000000"),
    ]
    payload = vg14.serialize_tail(bars, month_start_us("2026-01"))
    path = tmp_path / "tail.jsonl"
    path.write_bytes(payload)
    restored = vg14.parse_tail(path, hashlib.sha256(payload).hexdigest())
    assert restored == bars
    path.write_bytes(payload + b"\n")
    with pytest.raises(vg14.UnmeasuredError, match="digest mismatch"):
        vg14.parse_tail(path, hashlib.sha256(payload).hexdigest())


def test_status_has_no_mutation_and_no_secret_fields(tmp_path: Path) -> None:
    before = set(os.listdir(tmp_path))
    value = vg14.status(tmp_path)
    assert value["developmentConsumed"] is False
    assert value["holdoutOpened"] is False
    assert set(os.listdir(tmp_path)) == before
    serialized = json.dumps(value)
    assert "apiKey" not in serialized
    assert "secret" not in serialized.lower()


def test_cli_unmeasured_writes_terminal_without_network(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(
        vg14,
        "freeze_evaluator",
        lambda _root: (_ for _ in ()).throw(vg14.UnmeasuredError("synthetic failure")),
    )
    assert vg14.main(["freeze-evaluator", "--state-root", str(tmp_path)]) == 2
    output = json.loads(capsys.readouterr().out)
    assert output == {"error": "synthetic failure", "verdict": "UNMEASURED"}
    terminal = json.loads((tmp_path / "terminal_evidence.v1.json").read_text())
    assert terminal["verdict"] == "UNMEASURED"
    assert terminal["effectUsd"] == "0"
    assert terminal["accountEffectiveFees"] == "UNKNOWN"


def test_no_private_host_or_money_action_tokens_in_runtime_source() -> None:
    source = Path(vg14.__file__).read_text(encoding="utf-8")
    forbidden = (
        "api_key",
        "api_secret",
        "/api/v3/order",
        "/sapi/",
        "withdraw/apply",
        "transfer",
        "paramiko",
        "boto3",
    )
    assert not any(token in source.lower() for token in forbidden)
