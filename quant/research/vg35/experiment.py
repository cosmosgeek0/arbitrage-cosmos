#!/usr/bin/env python3
"""One-run Binance-public Spot evaluator for the sealed V-G35 protocol.

The four CLI phases are deliberately separate:

* ``bind-sources`` binds an existing read-only public corpus without opening it.
* ``freeze`` authenticates custody and seals code, protocol, tests, and runtime.
* ``run`` is network-free and consumes an exclusive marker before opening data.
* ``verify`` checks hashes and bindings only; it never reopens source archives.
"""

from __future__ import annotations

import argparse
import contextlib
import csv
import hashlib
import itertools
import json
import math
import os
import platform
import random
import statistics
import subprocess
import sys
import zipfile
from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, cast

PACKET_DIR = Path(__file__).resolve().parent
QUANT_DIR = PACKET_DIR.parents[1]
REPO_DIR = QUANT_DIR.parent
PROTOCOL_PATH = PACKET_DIR / "protocol.v1.json"
SOURCE_MANIFEST_PATH = PACKET_DIR / "source_manifest.v1.json"
FREEZE_PATH = PACKET_DIR / "freeze.v1.json"
RUN_MARKER_PATH = PACKET_DIR / "run-marker.v1.json"
SELECTION_PATH = PACKET_DIR / "selection.v1.json"
HOLDOUT_MARKER_PATH = PACKET_DIR / "holdout-open-marker.v1.json"
DEVELOPMENT_PATH = PACKET_DIR / "development.v1.json"
HOLDOUT_PATH = PACKET_DIR / "holdout.v1.json"
RESULT_PATH = PACKET_DIR / "result.v1.json"
SHA256SUMS_PATH = PACKET_DIR / "SHA256SUMS"

JsonObject = dict[str, Any]


class VG35Error(RuntimeError):
    """Base error for a fail-closed V-G35 operation."""


class MeasurementError(VG35Error):
    """Evidence defect that requires an UNMEASURED terminal disposition."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _safe_shared_file(root: Path, relative: str) -> Path:
    """Resolve one regular non-symlink shared input beneath the frozen root."""

    path = root / relative
    try:
        resolved_root = root.resolve(strict=True)
        resolved = path.resolve(strict=True)
    except OSError as error:
        raise VG35Error(f"SHARED_SOURCE_UNREADABLE:{path.name}") from error
    if path.is_symlink() or not path.is_file() or not resolved.is_relative_to(resolved_root):
        raise VG35Error(f"SHARED_SOURCE_PATH_INVALID:{relative}")
    if resolved.is_relative_to(PACKET_DIR.resolve()):
        raise VG35Error("SHARED_SOURCE_OVERLAPS_WRITABLE_PACKET")
    return path


@dataclass(frozen=True)
class TrialSpec:
    """One immutable member of the six-trial exact-duration family."""

    trial_id: str
    exact_age_days: int
    holding_days: int


@dataclass(frozen=True)
class Bar:
    """Strictly validated complete UTC daily public kline."""

    day: date
    open_price: Decimal
    quote_volume: Decimal


@dataclass(frozen=True)
class SpellObservation:
    """One causal abnormal-volume spell-day used for a descriptive hazard."""

    symbol: str
    day: date
    age_days: int
    terminated_next_day: bool | None


@dataclass(frozen=True)
class Trade:
    """A preregistered open-to-open observation."""

    symbol: str
    signal_day: date
    entry_day: date
    exit_day: date
    gross_factor: float
    supported_capital_usd: float


@dataclass(frozen=True)
class PartitionEvaluation:
    """Complete trial output and its synchronous daily series."""

    report: JsonObject
    stress_log_returns: tuple[float, ...]
    benchmark_stress_log_returns: tuple[float, ...]


def load_protocol() -> JsonObject:
    """Load the sealed protocol object."""

    return _read_json(PROTOCOL_PATH)


def generate_trial_specs(protocol: Mapping[str, Any]) -> tuple[TrialSpec, ...]:
    """Generate the exact preregistered trial family in stable ID order."""

    family = _mapping(protocol, "trialFamily")
    specs = [
        TrialSpec(
            trial_id=f"VG35-D{age:02d}-H{holding:02d}",
            exact_age_days=age,
            holding_days=holding,
        )
        for age in _int_sequence(family, "exactAbnormalAgeDays")
        for holding in _int_sequence(family, "holdingDays")
    ]
    specs.sort(key=lambda item: item.trial_id)
    expected = _int(family, "attemptedCount")
    if len(specs) != expected or len({item.trial_id for item in specs}) != expected:
        raise VG35Error("TRIAL_FAMILY_MISMATCH")
    return tuple(specs)


def detect_duration_signals(
    symbol: str,
    bars: Sequence[Bar],
    spec: TrialSpec,
    partition_start: date,
    partition_end: date,
    lookback: int = 60,
) -> tuple[tuple[SpellObservation, ...], tuple[Trade, ...]]:
    """Detect exact-age abnormal states with a rolling prior-only baseline.

    The spell age is reset at the scored partition boundary.  Membership is
    fixed after the signal-day close, the complete next day is skipped, and
    entry occurs at ``t+2`` open.  No next-day state participates in selection.
    """

    ordered = sorted(bars, key=lambda bar: bar.day)
    by_day = {bar.day: bar for bar in ordered}
    abnormal: dict[date, bool] = {}
    for index, bar in enumerate(ordered):
        prior = ordered[max(0, index - lookback) : index]
        if len(prior) != lookback:
            continue
        baseline = _median_decimal(item.quote_volume for item in prior)
        if baseline <= 0:
            raise MeasurementError("NON_POSITIVE_VOLUME_BASELINE")
        abnormal[bar.day] = bar.quote_volume >= Decimal("2.0") * baseline

    observations: list[SpellObservation] = []
    trades: list[Trade] = []
    age = 0
    current = partition_start
    while current < partition_end:
        state = abnormal.get(current)
        if state is None:
            raise MeasurementError("MISSING_SIGNAL_STATE")
        age = age + 1 if state else 0
        if state:
            next_day = current + timedelta(days=1)
            next_state = abnormal.get(next_day) if next_day < partition_end else None
            observations.append(
                SpellObservation(
                    symbol=symbol,
                    day=current,
                    age_days=age,
                    terminated_next_day=None if next_state is None else not next_state,
                )
            )
        if age == spec.exact_age_days:
            entry_day = current + timedelta(days=2)
            exit_day = entry_day + timedelta(days=spec.holding_days)
            if exit_day >= partition_end:
                current += timedelta(days=1)
                continue
            entry = by_day.get(entry_day)
            exit_bar = by_day.get(exit_day)
            if entry is None or exit_bar is None:
                raise MeasurementError("SELECTED_ENTRY_OR_EXIT_MISSING")
            if entry.open_price <= 0 or exit_bar.open_price <= 0:
                raise MeasurementError("NON_POSITIVE_SELECTED_PRICE")
            supported = _supported_capital(by_day, entry_day, exit_day, lookback=30)
            trades.append(
                Trade(
                    symbol,
                    current,
                    entry_day,
                    exit_day,
                    float(exit_bar.open_price / entry.open_price),
                    supported,
                )
            )
        current += timedelta(days=1)
    return tuple(observations), tuple(trades)


def termination_hazard(
    observations: Sequence[SpellObservation],
    exact_age_days: int,
) -> JsonObject:
    """Report a descriptive one-step termination hazard at the trial age."""

    risk = [item for item in observations if item.age_days == exact_age_days]
    observed = [item for item in risk if item.terminated_next_day is not None]
    terminations = sum(item.terminated_next_day is True for item in observed)
    probability = terminations / len(observed) if observed else None
    interval: list[float] | None = None
    if probability is not None:
        z = 1.959963984540054
        count = len(observed)
        denominator = 1.0 + z * z / count
        center = (probability + z * z / (2.0 * count)) / denominator
        half_width = (
            z
            * math.sqrt(probability * (1.0 - probability) / count + z * z / (4.0 * count * count))
            / denominator
        )
        interval = [_rounded(center - half_width), _rounded(center + half_width)]
    return {
        "status": "AVAILABLE" if observed else "NOT_ESTIMABLE_NO_RISK_SET",
        "ageDays": exact_age_days,
        "atRisk": len(risk),
        "observedNextDay": len(observed),
        "terminatedNextDay": terminations,
        "rightCensoredAtPartitionEnd": len(risk) - len(observed),
        "terminationProbability": _rounded(probability) if probability is not None else None,
        "wilson95Interval": interval,
        "role": "DESCRIPTIVE_ONLY_NEVER_SELECTS_OR_RESCUES",
    }


def circular_block_indices(
    length: int,
    block_length: int,
    replicates: int,
    seed: int,
) -> tuple[tuple[int, ...], ...]:
    """Create deterministic circular calendar-block draws."""

    if length <= 0 or block_length <= 0 or replicates <= 0:
        raise ValueError("positive length, block length, and replicates required")
    rng = random.Random(seed)
    samples: list[tuple[int, ...]] = []
    for _ in range(replicates):
        selected: list[int] = []
        while len(selected) < length:
            start = rng.randrange(length)
            selected.extend((start + offset) % length for offset in range(block_length))
        samples.append(tuple(selected[:length]))
    return tuple(samples)


def holm_adjust(raw_p_values: Mapping[str, float]) -> dict[str, float]:
    """Apply Holm step-down adjustment, retaining all family members."""

    ordered = sorted(raw_p_values.items(), key=lambda item: (item[1], item[0]))
    adjusted: dict[str, float] = {}
    running = 0.0
    family_size = len(ordered)
    for rank, (trial_id, raw_value) in enumerate(ordered):
        running = max(running, min(1.0, (family_size - rank) * raw_value))
        adjusted[trial_id] = _rounded(running)
    return adjusted


def cscv_pbo(
    series_by_trial: Mapping[str, Sequence[float]],
    block_count: int = 8,
    in_sample_blocks: int = 4,
) -> JsonObject:
    """Compute diagnostic-only CSCV PBO from a complete trial matrix."""

    trial_ids = sorted(series_by_trial)
    if not trial_ids:
        return {"status": "UNAVAILABLE", "reason": "EMPTY_TRIAL_MATRIX"}
    length = len(series_by_trial[trial_ids[0]])
    if length < block_count or any(len(series_by_trial[item]) != length for item in trial_ids):
        return {"status": "UNAVAILABLE", "reason": "INCOMPLETE_TRIAL_MATRIX"}
    calendar_month_lengths = (31, 31, 30, 31, 30, 31, 31, 28)
    if block_count == 8 and length == sum(calendar_month_lengths):
        boundaries = [0]
        for month_length in calendar_month_lengths:
            boundaries.append(boundaries[-1] + month_length)
    else:
        boundaries = [(index * length) // block_count for index in range(block_count + 1)]
    if all(
        tuple(series_by_trial[trial_id]) == tuple(series_by_trial[trial_ids[0]])
        for trial_id in trial_ids[1:]
    ):
        return {
            "status": "NOT_ESTIMABLE_DEGENERATE_IDENTICAL_PATHS",
            "splitCount": 0,
            "probabilityBacktestOverfitting": None,
            "role": "DIAGNOSTIC_ONLY_NOT_A_P_VALUE_OR_GATE",
        }
    logits: list[float] = []
    selections: dict[str, int] = defaultdict(int)
    for chosen in itertools.combinations(range(block_count), in_sample_blocks):
        chosen_set = set(chosen)
        in_indices = [
            index for block in chosen for index in range(boundaries[block], boundaries[block + 1])
        ]
        out_indices = [
            index
            for block in range(block_count)
            if block not in chosen_set
            for index in range(boundaries[block], boundaries[block + 1])
        ]
        in_scores = {
            trial_id: sum(series_by_trial[trial_id][index] for index in in_indices)
            for trial_id in trial_ids
        }
        champion = min(trial_ids, key=lambda item: (-in_scores[item], item))
        selections[champion] += 1
        out_scores = {
            trial_id: sum(series_by_trial[trial_id][index] for index in out_indices)
            for trial_id in trial_ids
        }
        ascending = sorted(trial_ids, key=lambda item: (out_scores[item], item))
        rank = ascending.index(champion) + 1
        omega = rank / (len(trial_ids) + 1)
        logits.append(math.log(omega / (1.0 - omega)))
    return {
        "status": "AVAILABLE",
        "splitCount": len(logits),
        "probabilityBacktestOverfitting": _rounded(
            sum(value <= 0 for value in logits) / len(logits)
        ),
        "medianLogit": _rounded(statistics.median(logits)),
        "selectionCounts": dict(sorted(selections.items())),
        "role": "DIAGNOSTIC_ONLY_NOT_A_P_VALUE_OR_GATE",
    }


def bind_sources() -> JsonObject:
    """Bind shared public ZIP/checksum bytes without network or decompression."""

    protocol = load_protocol()
    _require_acquire_git_precondition(protocol)
    if SOURCE_MANIFEST_PATH.exists():
        raise VG35Error("SOURCE_MANIFEST_ALREADY_EXISTS")
    data = _mapping(protocol, "data")
    raw_root = Path(_str(data, "sourceCorpusRoot"))
    shared_manifest_path = Path(_str(data, "sharedCustodyManifest"))
    if not shared_manifest_path.is_file() or shared_manifest_path.is_symlink():
        raise VG35Error("SHARED_CUSTODY_MANIFEST_PATH_INVALID")
    shared = _read_json(shared_manifest_path)
    shared_archives = shared.get("archives")
    if not isinstance(shared_archives, list):
        raise VG35Error("SHARED_CUSTODY_ARCHIVES_INVALID")
    shared_by_key: dict[tuple[str, str], JsonObject] = {}
    for raw_entry in shared_archives:
        if isinstance(raw_entry, dict):
            entry = cast(JsonObject, raw_entry)
            key = (str(entry.get("symbol", "")), str(entry.get("month", "")))
            shared_by_key[key] = entry

    entries: list[JsonObject] = []
    template = _str(data, "archiveUrlTemplate")
    interval = _str(data, "archiveInterval")
    for symbol in _str_sequence(data, "symbols"):
        for month in _str_sequence(data, "archiveMonths"):
            source_entry = shared_by_key.get((symbol, month))
            if source_entry is None:
                raise VG35Error(f"SHARED_CUSTODY_PAIR_MISSING:{symbol}:{month}")
            prefix = f"{symbol}-{interval}-{month}.zip"
            archive_path = _safe_shared_file(raw_root, f"{symbol}/{prefix}")
            checksum_path = _safe_shared_file(raw_root, f"{symbol}/{prefix}.CHECKSUM")
            archive_sha = _sha256_path(archive_path)
            checksum_sha = _sha256_path(checksum_path)
            publisher_sha = _parse_publisher_checksum(checksum_path, prefix)
            if archive_sha != publisher_sha:
                raise VG35Error(f"ARCHIVE_PUBLISHER_CHECKSUM_MISMATCH:{symbol}:{month}")
            source_archive = _mapping(source_entry, "archive")
            source_checksum = _mapping(source_entry, "checksum")
            if (
                source_archive.get("sha256") != archive_sha
                or source_checksum.get("sha256") != checksum_sha
                or source_entry.get("publisherSha256") != publisher_sha
            ):
                raise VG35Error(f"SHARED_CUSTODY_HASH_MISMATCH:{symbol}:{month}")
            url = template.format(symbol=symbol, month=month)
            entries.append(
                {
                    "symbol": symbol,
                    "interval": interval,
                    "month": month,
                    "archive": {
                        "path": f"{symbol}/{prefix}",
                        "url": url,
                        "sha256": archive_sha,
                        "bytes": archive_path.stat().st_size,
                        "headers": source_archive.get("headers"),
                        "retrievedAtUtc": source_archive.get("retrievedAtUtc"),
                    },
                    "checksum": {
                        "path": f"{symbol}/{prefix}.CHECKSUM",
                        "url": f"{url}.CHECKSUM",
                        "sha256": checksum_sha,
                        "bytes": checksum_path.stat().st_size,
                        "headers": source_checksum.get("headers"),
                        "retrievedAtUtc": source_checksum.get("retrievedAtUtc"),
                    },
                    "publisherSha256": publisher_sha,
                }
            )
    manifest: JsonObject = {
        "version": "VG35SourceManifestV1",
        "completedAtUtc": _utc_now(),
        "protocolSha256": _sha256_path(PROTOCOL_PATH),
        "sourceCorpusRoot": str(raw_root),
        "sharedCustodyManifest": str(shared_manifest_path),
        "sharedCustodyManifestSha256": _sha256_path(shared_manifest_path),
        "sharedCorpusReuse": "READ_ONLY_PRIOR_PROGRAM_CORPUS",
        "globalHoldoutCertification": "NOT_CERTIFIED_SHARED_REUSE_RISK",
        "archiveCount": len(entries),
        "checksumCount": len(entries),
        "archiveMembersOpenedByVg35": 0,
        "archives": entries,
    }
    _validate_manifest_shape(protocol, manifest, verify_bytes=True)
    _write_json_exclusive(SOURCE_MANIFEST_PATH, manifest)
    return manifest


def freeze() -> JsonObject:
    """Seal source custody, code, protocol, tests, runtime, and empty state."""

    protocol = load_protocol()
    _require_freeze_git_precondition(protocol)
    manifest = _read_json(SOURCE_MANIFEST_PATH)
    _validate_manifest_shape(protocol, manifest, verify_bytes=True)
    for path in _outcome_paths():
        if path.exists():
            raise VG35Error(f"OUTCOME_STATE_NOT_EMPTY:{path.name}")
    lifecycle = _mapping(protocol, "lifecycle")
    packet_inputs = _str_sequence(lifecycle, "freezeBoundPacketPaths")
    runtime_inputs = _str_sequence(lifecycle, "freezeBoundRuntimePathsRelativeToQuant")
    inputs: list[JsonObject] = []
    for name in packet_inputs:
        path = PACKET_DIR / name
        inputs.append(_file_identity(path, f"quant/research/vg35/{name}"))
    for name in runtime_inputs:
        path = QUANT_DIR / name
        inputs.append(_file_identity(path, f"quant/{name}"))
    external_inputs = _external_input_identities(protocol, manifest)
    freeze_object: JsonObject = {
        "version": "VG35FreezeV1",
        "createdAtUtc": _utc_now(),
        "protocolSha256": _sha256_path(PROTOCOL_PATH),
        "sourceManifestSha256": _sha256_path(SOURCE_MANIFEST_PATH),
        "inputs": inputs,
        "externalInputs": external_inputs,
        "runtime": {
            "python": sys.version,
            "implementation": platform.python_implementation(),
            "platform": platform.platform(),
            "pythonHashSeed": os.environ.get("PYTHONHASHSEED", "UNSET"),
            "uvVersion": _uv_version(),
        },
        "git": _freeze_git_identity(protocol),
        "outcomeRoot": str(PACKET_DIR),
        "outcomeState": "EMPTY",
        "archiveMembersOpenedBeforeFreeze": 0,
    }
    if FREEZE_PATH.exists():
        raise VG35Error("FREEZE_ALREADY_EXISTS")
    _write_json_exclusive(FREEZE_PATH, freeze_object)
    return freeze_object


def run() -> JsonObject:
    """Consume the sealed evaluator exactly once and write one terminal verdict."""

    protocol = load_protocol()
    freeze_object = _verify_freeze(protocol)
    _require_run_git_precondition(freeze_object)
    manifest = _read_json(SOURCE_MANIFEST_PATH)
    _validate_manifest_shape(protocol, manifest, verify_bytes=True)
    _verify_external_inputs(protocol, manifest, freeze_object)
    if RUN_MARKER_PATH.exists():
        raise VG35Error("DEVELOPMENT_RUN_ALREADY_CONSUMED")
    stale_outcomes = [
        path for path in _outcome_paths() if path.name != RUN_MARKER_PATH.name and path.exists()
    ]
    if stale_outcomes:
        raise VG35Error(f"PRE_MARKER_OUTCOME_STATE_NOT_EMPTY:{stale_outcomes[0].name}")
    marker: JsonObject = {
        "version": "VG35RunMarkerV1",
        "createdAtUtc": _utc_now(),
        "freezeSha256": _sha256_path(FREEZE_PATH),
        "protocolSha256": _sha256_path(PROTOCOL_PATH),
        "purpose": "CONSUMED_BEFORE_FIRST_ZIP_MEMBER_OPEN",
    }
    _write_json_exclusive(RUN_MARKER_PATH, marker)
    marker_sha = _sha256_path(RUN_MARKER_PATH)
    try:
        development_bars = _load_bars(
            protocol,
            manifest,
            allowed_months=tuple(
                month
                for month in _str_sequence(_mapping(protocol, "data"), "archiveMonths")
                if month < "2026-03"
            ),
            expected_start=date(2025, 1, 1),
            expected_end=date(2026, 3, 1),
        )
        development = _evaluate_development(protocol, development_bars)
        development["freezeSha256"] = _sha256_path(FREEZE_PATH)
        development["runMarkerSha256"] = marker_sha
        _write_json_exclusive(DEVELOPMENT_PATH, development)
        champion_id = cast(str, development["championTrialId"])
        all_gates_pass = bool(development["allDevelopmentGatesPass"])
        if not all_gates_pass:
            result = _terminal_result(
                "NO_GO",
                "DEVELOPMENT_GATE_FAILURE",
                freeze_object,
                marker_sha,
                development,
                holdout=None,
            )
            _write_json_exclusive(RESULT_PATH, result)
            return result

        selection: JsonObject = {
            "version": "VG35SelectionV1",
            "createdAtUtc": _utc_now(),
            "freezeSha256": _sha256_path(FREEZE_PATH),
            "runMarkerSha256": marker_sha,
            "championTrialId": champion_id,
            "selectionMetric": "DEVELOPMENT_FEE_STRESS_PRIMARY_LCB_THEN_NET_THEN_TRIAL_ID",
            "developmentSha256": _sha256_path(DEVELOPMENT_PATH),
            "immutable": True,
        }
        _write_json_exclusive(SELECTION_PATH, selection)
        holdout_marker = {
            "version": "VG35HoldoutOpenMarkerV1",
            "createdAtUtc": _utc_now(),
            "freezeSha256": _sha256_path(FREEZE_PATH),
            "selectionSha256": _sha256_path(SELECTION_PATH),
            "championTrialId": champion_id,
            "purpose": "CONSUMED_BEFORE_FIRST_HOLDOUT_ZIP_MEMBER_OPEN",
        }
        _write_json_exclusive(HOLDOUT_MARKER_PATH, holdout_marker)
        holdout_bars = _load_bars(
            protocol,
            manifest,
            allowed_months=("2026-03", "2026-04", "2026-05", "2026-06"),
            expected_start=date(2026, 3, 1),
            expected_end=date(2026, 7, 1),
            baseline_bars=development_bars,
        )
        specs = {item.trial_id: item for item in generate_trial_specs(protocol)}
        holdout = _evaluate_holdout(protocol, holdout_bars, specs[champion_id])
        champion_development = next(
            trial
            for trial in cast(list[JsonObject], development["trials"])
            if trial["trialId"] == champion_id
        )
        development_stress = _float(_mapping(champion_development, "feeStress"), "netUsdPer1000")
        holdout_stress = _float(_mapping(_mapping(holdout, "trial"), "feeStress"), "netUsdPer1000")
        holdout_gates = _mapping(holdout, "holdoutGates")
        holdout_gates["noDevelopmentHoldoutSignReversal"] = (
            development_stress > 0 and holdout_stress > 0
        )
        holdout["allHoldoutGatesPass"] = all(holdout_gates.values())
        holdout["freezeSha256"] = _sha256_path(FREEZE_PATH)
        holdout["selectionSha256"] = _sha256_path(SELECTION_PATH)
        holdout["holdoutMarkerSha256"] = _sha256_path(HOLDOUT_MARKER_PATH)
        _write_json_exclusive(HOLDOUT_PATH, holdout)
        verdict = "PUBLIC_RESEARCH_GO_LOCAL" if holdout["allHoldoutGatesPass"] else "NO_GO"
        disposition = (
            "ALL_LOCAL_PUBLIC_GATES_PASS"
            if verdict == "PUBLIC_RESEARCH_GO_LOCAL"
            else "HOLDOUT_GATE_FAILURE"
        )
        result = _terminal_result(
            verdict,
            disposition,
            freeze_object,
            marker_sha,
            development,
            holdout=holdout,
        )
        _write_json_exclusive(RESULT_PATH, result)
        return result
    except Exception as error:
        if RESULT_PATH.exists():
            raise
        if isinstance(error, MeasurementError):
            reason = error.code
        elif isinstance(error, VG35Error):
            reason = str(error)
        else:
            reason = "EVALUATOR_FAILURE"
        result = _terminal_result(
            "UNMEASURED",
            reason,
            freeze_object,
            marker_sha,
            development=None,
            holdout=None,
        )
        result["errorClass"] = type(error).__name__
        result["developmentOpened"] = DEVELOPMENT_PATH.exists()
        result["holdoutOpened"] = HOLDOUT_MARKER_PATH.exists()
        if DEVELOPMENT_PATH.exists():
            failed_development = _read_json(DEVELOPMENT_PATH)
            result["developmentSha256"] = _sha256_path(DEVELOPMENT_PATH)
            result["championTrialId"] = failed_development["championTrialId"]
            result["developmentGates"] = failed_development["developmentGates"]
        if SELECTION_PATH.exists():
            result["selectionSha256"] = _sha256_path(SELECTION_PATH)
        if HOLDOUT_PATH.exists():
            failed_holdout = _read_json(HOLDOUT_PATH)
            result["holdoutSha256"] = _sha256_path(HOLDOUT_PATH)
            result["holdoutGates"] = failed_holdout["holdoutGates"]
        _write_json_exclusive(RESULT_PATH, result)
        return result


def verify() -> JsonObject:
    """Verify immutable hashes and cross-file bindings without recomputation."""

    protocol = load_protocol()
    freeze_object = _verify_freeze(protocol)
    manifest = _read_json(SOURCE_MANIFEST_PATH)
    _validate_manifest_shape(protocol, manifest, verify_bytes=True)
    _verify_external_inputs(protocol, manifest, freeze_object)
    result = _read_json(RESULT_PATH)
    result_sha = _sha256_path(RESULT_PATH)
    marker = _read_json(RUN_MARKER_PATH)
    marker_sha = _sha256_path(RUN_MARKER_PATH)
    protocol_sha = _sha256_path(PROTOCOL_PATH)
    freeze_sha = _sha256_path(FREEZE_PATH)
    if result.get("version") != "VG35ResultV1":
        raise VG35Error("RESULT_VERSION_MISMATCH")
    if marker.get("version") != "VG35RunMarkerV1":
        raise VG35Error("RUN_MARKER_VERSION_MISMATCH")
    if result.get("protocolSha256") != protocol_sha:
        raise VG35Error("RESULT_PROTOCOL_BINDING_MISMATCH")
    if marker.get("protocolSha256") != protocol_sha:
        raise VG35Error("RUN_MARKER_PROTOCOL_BINDING_MISMATCH")
    if result.get("freezeSha256") != freeze_sha:
        raise VG35Error("RESULT_FREEZE_BINDING_MISMATCH")
    if result.get("runMarkerSha256") != marker_sha:
        raise VG35Error("RESULT_RUN_MARKER_BINDING_MISMATCH")
    if marker.get("freezeSha256") != freeze_sha:
        raise VG35Error("RUN_MARKER_FREEZE_BINDING_MISMATCH")
    expected_constants = {
        "capitalAuthority": "NONE",
        "capitalVerdict": "NO_GO",
        "accountEffectiveFee": "UNKNOWN",
        "executableCapacity": "UNMEASURED",
        "causalIdentification": "NOT_CLAIMED",
        "globalHoldoutCertification": "NOT_CERTIFIED_SHARED_REUSE_RISK",
        "programAdjustedPValue": 1.0,
        "verifiedPositiveEligible": False,
        "consumer": "N3 successor/orchestrator scoreboard",
    }
    if (
        any(result.get(key) != value for key, value in expected_constants.items())
        or type(result.get("moneyEffectUsd")) is not int
        or result.get("moneyEffectUsd") != 0
    ):
        raise VG35Error("RESULT_AUTHORITY_CONSTANT_MISMATCH")

    development_exists = DEVELOPMENT_PATH.is_file()
    selection_exists = SELECTION_PATH.is_file()
    holdout_marker_exists = HOLDOUT_MARKER_PATH.is_file()
    holdout_exists = HOLDOUT_PATH.is_file()
    if bool(result.get("developmentOpened")) != development_exists:
        raise VG35Error("RESULT_DEVELOPMENT_PRESENCE_MISMATCH")
    if bool(result.get("holdoutOpened")) != holdout_marker_exists:
        raise VG35Error("RESULT_HOLDOUT_BINDING_MISMATCH")
    if selection_exists and not development_exists:
        raise VG35Error("SELECTION_WITHOUT_DEVELOPMENT")
    if holdout_marker_exists and not selection_exists:
        raise VG35Error("HOLDOUT_MARKER_WITHOUT_SELECTION")
    if holdout_exists and not holdout_marker_exists:
        raise VG35Error("HOLDOUT_WITHOUT_MARKER")

    development: JsonObject | None = None
    selection: JsonObject | None = None
    holdout_marker: JsonObject | None = None
    holdout: JsonObject | None = None
    development_gates: JsonObject | None = None
    holdout_gates: JsonObject | None = None
    development_all = False
    holdout_all = False
    champion: str | None = None

    if development_exists:
        development = _read_json(DEVELOPMENT_PATH)
        if development.get("version") != "VG35DevelopmentV1":
            raise VG35Error("DEVELOPMENT_VERSION_MISMATCH")
        development_sha = _sha256_path(DEVELOPMENT_PATH)
        if development.get("freezeSha256") != freeze_sha:
            raise VG35Error("DEVELOPMENT_FREEZE_BINDING_MISMATCH")
        if development.get("runMarkerSha256") != marker_sha:
            raise VG35Error("DEVELOPMENT_RUN_MARKER_BINDING_MISMATCH")
        if result.get("developmentSha256") != development_sha:
            raise VG35Error("RESULT_DEVELOPMENT_HASH_MISMATCH")
        champion = _str(development, "championTrialId")
        development_gates, development_all = _verified_gate_map(
            development, "developmentGates", "allDevelopmentGatesPass"
        )
        if result.get("developmentGates") != development_gates:
            raise VG35Error("RESULT_DEVELOPMENT_GATES_COPY_MISMATCH")
        if result.get("championTrialId") != champion:
            raise VG35Error("RESULT_CHAMPION_MISMATCH")
    if selection_exists:
        selection = _read_json(SELECTION_PATH)
        if selection.get("version") != "VG35SelectionV1":
            raise VG35Error("SELECTION_VERSION_MISMATCH")
        if selection.get("freezeSha256") != freeze_sha:
            raise VG35Error("SELECTION_FREEZE_BINDING_MISMATCH")
        if selection.get("runMarkerSha256") != marker_sha:
            raise VG35Error("SELECTION_RUN_MARKER_BINDING_MISMATCH")
        if selection.get("developmentSha256") != _sha256_path(DEVELOPMENT_PATH):
            raise VG35Error("SELECTION_DEVELOPMENT_BINDING_MISMATCH")
        if result.get("selectionSha256") != _sha256_path(SELECTION_PATH):
            raise VG35Error("RESULT_SELECTION_HASH_MISMATCH")
        if selection.get("championTrialId") != champion:
            raise VG35Error("SELECTION_CHAMPION_MISMATCH")
    if holdout_marker_exists:
        holdout_marker = _read_json(HOLDOUT_MARKER_PATH)
        if holdout_marker.get("version") != "VG35HoldoutOpenMarkerV1":
            raise VG35Error("HOLDOUT_MARKER_VERSION_MISMATCH")
        if holdout_marker.get("freezeSha256") != freeze_sha:
            raise VG35Error("HOLDOUT_MARKER_FREEZE_BINDING_MISMATCH")
        if holdout_marker.get("selectionSha256") != _sha256_path(SELECTION_PATH):
            raise VG35Error("HOLDOUT_MARKER_SELECTION_BINDING_MISMATCH")
        if holdout_marker.get("championTrialId") != champion:
            raise VG35Error("HOLDOUT_MARKER_CHAMPION_MISMATCH")
    if holdout_exists:
        holdout = _read_json(HOLDOUT_PATH)
        if holdout.get("version") != "VG35HoldoutV1":
            raise VG35Error("HOLDOUT_VERSION_MISMATCH")
        if holdout.get("freezeSha256") != freeze_sha:
            raise VG35Error("HOLDOUT_FREEZE_BINDING_MISMATCH")
        if holdout.get("selectionSha256") != _sha256_path(SELECTION_PATH):
            raise VG35Error("HOLDOUT_SELECTION_BINDING_MISMATCH")
        if holdout.get("holdoutMarkerSha256") != _sha256_path(HOLDOUT_MARKER_PATH):
            raise VG35Error("HOLDOUT_MARKER_BINDING_MISMATCH")
        if result.get("holdoutSha256") != _sha256_path(HOLDOUT_PATH):
            raise VG35Error("RESULT_HOLDOUT_HASH_MISMATCH")
        if holdout.get("championTrialId") != champion:
            raise VG35Error("HOLDOUT_CHAMPION_MISMATCH")
        holdout_gates, holdout_all = _verified_gate_map(
            holdout, "holdoutGates", "allHoldoutGatesPass"
        )
        if result.get("holdoutGates") != holdout_gates:
            raise VG35Error("RESULT_HOLDOUT_GATES_COPY_MISMATCH")

    verdict = result.get("verdict")
    if verdict not in {"PUBLIC_RESEARCH_GO_LOCAL", "NO_GO", "UNMEASURED"}:
        raise VG35Error("INVALID_VERDICT")
    disposition = result.get("disposition")
    full_chain = (
        development_exists and selection_exists and holdout_marker_exists and holdout_exists
    )
    if verdict == "PUBLIC_RESEARCH_GO_LOCAL":
        if (
            disposition != "ALL_LOCAL_PUBLIC_GATES_PASS"
            or not full_chain
            or not development_all
            or not holdout_all
            or result.get("developmentGates") != development_gates
            or result.get("holdoutGates") != holdout_gates
            or result.get("championTrialId") != champion
        ):
            raise VG35Error("INVALID_GO_CHAIN")
    elif verdict == "NO_GO":
        valid_development_failure = (
            disposition == "DEVELOPMENT_GATE_FAILURE"
            and development_exists
            and not development_all
            and not selection_exists
            and not holdout_marker_exists
            and not holdout_exists
            and result.get("developmentGates") == development_gates
            and result.get("championTrialId") == champion
        )
        valid_holdout_failure = (
            disposition == "HOLDOUT_GATE_FAILURE"
            and full_chain
            and development_all
            and not holdout_all
            and result.get("developmentGates") == development_gates
            and result.get("holdoutGates") == holdout_gates
            and result.get("championTrialId") == champion
        )
        if not (valid_development_failure or valid_holdout_failure):
            raise VG35Error("INVALID_NO_GO_CHAIN")
    elif disposition in {
        "DEVELOPMENT_GATE_FAILURE",
        "HOLDOUT_GATE_FAILURE",
        "ALL_LOCAL_PUBLIC_GATES_PASS",
    }:
        raise VG35Error("UNMEASURED_RESERVED_DISPOSITION")
    checksum_count = _verify_sha256sums_exact()
    return {
        "status": "PASS",
        "verdict": verdict,
        "resultSha256": result_sha,
        "developmentOpened": development_exists,
        "holdoutOpened": holdout_marker_exists,
        "verifiedSha256SumEntries": checksum_count,
        "sourceArchivesReopened": 0,
        "statisticsRecomputed": False,
        "networkUsed": False,
    }


def _evaluate_development(
    protocol: Mapping[str, Any],
    bars_by_symbol: Mapping[str, Sequence[Bar]],
) -> JsonObject:
    specs = generate_trial_specs(protocol)
    start = date(2025, 7, 1)
    end = date(2026, 3, 1)
    evaluations = {
        spec.trial_id: _evaluate_partition(protocol, bars_by_symbol, spec, start, end)
        for spec in specs
    }
    stress_matrix = {
        trial_id: evaluation.stress_log_returns for trial_id, evaluation in evaluations.items()
    }
    benchmark_matrix = {
        trial_id: evaluation.benchmark_stress_log_returns
        for trial_id, evaluation in evaluations.items()
    }
    inference = _family_inference(protocol, stress_matrix, benchmark_matrix)
    for trial_id, evaluation in evaluations.items():
        evaluation.report["inference"] = inference["trials"][trial_id]
    leader = min(
        specs,
        key=lambda item: (
            -cast(
                float,
                evaluations[item.trial_id].report["inference"][
                    "primary14DayFeeStressNetLowerBoundUsdPer1000"
                ],
            ),
            -cast(float, evaluations[item.trial_id].report["feeStress"]["netUsdPer1000"]),
            item.trial_id,
        ),
    )
    gate_results = _development_gates(
        protocol,
        evaluations[leader.trial_id].report,
        cast(JsonObject, inference["trials"][leader.trial_id]),
        cast(JsonObject, inference["whiteRealityChecks"]),
    )
    return {
        "version": "VG35DevelopmentV1",
        "partition": {"startUtc": start.isoformat(), "endExclusiveUtc": end.isoformat()},
        "trialCount": len(specs),
        "trials": [evaluations[item.trial_id].report for item in specs],
        "championTrialId": leader.trial_id,
        "championMeaning": "SEALED_ONLY_IF_ALL_DEVELOPMENT_GATES_PASS_OTHERWISE_DIAGNOSTIC_LEADER",
        "selectionMetric": "DEVELOPMENT_FEE_STRESS_PRIMARY_LCB_THEN_NET_THEN_TRIAL_ID",
        "familyInference": {
            "whiteRealityChecks": inference["whiteRealityChecks"],
            "pbo": inference["pbo"],
            "bootstrapReplicates": inference["bootstrapReplicates"],
            "holmHypothesisCount": inference["holmHypothesisCount"],
        },
        "developmentGates": gate_results,
        "allDevelopmentGatesPass": all(gate_results.values()),
    }


def _evaluate_holdout(
    protocol: Mapping[str, Any],
    bars_by_symbol: Mapping[str, Sequence[Bar]],
    spec: TrialSpec,
) -> JsonObject:
    start = date(2026, 3, 1)
    end = date(2026, 7, 1)
    evaluation = _evaluate_partition(protocol, bars_by_symbol, spec, start, end)
    bootstrap = _single_trial_inference(
        protocol,
        evaluation.stress_log_returns,
        evaluation.benchmark_stress_log_returns,
        seed_offset=_int(
            _mapping(_mapping(protocol, "inference"), "bootstrap"),
            "holdoutSeedOffset",
        ),
    )
    evaluation.report["inference"] = bootstrap
    gates = _holdout_gates(protocol, evaluation.report, bootstrap)
    return {
        "version": "VG35HoldoutV1",
        "partition": {"startUtc": start.isoformat(), "endExclusiveUtc": end.isoformat()},
        "championTrialId": spec.trial_id,
        "trial": evaluation.report,
        "holdoutGates": gates,
        "allHoldoutGatesPass": all(gates.values()),
    }


def _evaluate_partition(
    protocol: Mapping[str, Any],
    bars_by_symbol: Mapping[str, Sequence[Bar]],
    spec: TrialSpec,
    start: date,
    end: date,
) -> PartitionEvaluation:
    observations: list[SpellObservation] = []
    raw_trades: list[Trade] = []
    for symbol in sorted(bars_by_symbol):
        symbol_observations, symbol_trades = detect_duration_signals(
            symbol,
            bars_by_symbol[symbol],
            spec,
            start,
            end,
        )
        observations.extend(symbol_observations)
        raw_trades.extend(symbol_trades)

    candidates_by_signal: dict[date, list[Trade]] = defaultdict(list)
    for trade in raw_trades:
        candidates_by_signal[trade.signal_day].append(trade)
    accepted: list[tuple[date, date, date, tuple[Trade, ...]]] = []
    next_flat_day = start
    suppressed_overlap_count = 0
    for signal_day in sorted(candidates_by_signal):
        cohort = tuple(sorted(candidates_by_signal[signal_day], key=lambda item: item.symbol))
        entry_days = {trade.entry_day for trade in cohort}
        exit_days = {trade.exit_day for trade in cohort}
        if len(entry_days) != 1 or len(exit_days) != 1:
            raise MeasurementError("COHORT_LIFECYCLE_NOT_ALIGNED")
        if signal_day < next_flat_day:
            suppressed_overlap_count += 1
            continue
        entry_day = next(iter(entry_days))
        exit_day = next(iter(exit_days))
        accepted.append((signal_day, entry_day, exit_day, cohort))
        next_flat_day = exit_day

    fee_bp = _int(_mapping(protocol, "costs"), "publicTypicalTakerFeeBasisPointsPerFill")
    costs = {
        "gross": (0, 0),
        "feeOnly": (fee_bp, 0),
        "base": (
            fee_bp,
            _int(_mapping(protocol, "costs"), "baseAdverseExecutionBasisPointsPerFill"),
        ),
        "stress": (
            fee_bp,
            _int(_mapping(protocol, "costs"), "stressAdverseExecutionBasisPointsPerFill"),
        ),
        "severe": (
            fee_bp,
            _int(_mapping(protocol, "costs"), "severeAdverseExecutionBasisPointsPerFill"),
        ),
        "feeStress": (
            _int(_mapping(protocol, "costs"), "feeStressFeeBasisPointsPerFill"),
            _int(_mapping(protocol, "costs"), "feeStressAdverseExecutionBasisPointsPerFill"),
        ),
    }
    days = [start + timedelta(days=offset) for offset in range((end - start).days)]
    scenario_logs: dict[str, tuple[float, ...]] = {}
    benchmark_logs: dict[str, tuple[float, ...]] = {}
    for scenario, (fee, adverse) in costs.items():
        strategy, benchmark = _mark_to_market_logs(
            bars_by_symbol,
            accepted,
            days,
            fee,
            adverse,
        )
        scenario_logs[scenario] = strategy
        benchmark_logs[scenario] = benchmark

    cohort_reports: list[JsonObject] = []
    capacity_values: list[float] = []
    accepted_trades: list[Trade] = []
    for signal_day, entry_day, exit_day, cohort in accepted:
        accepted_trades.extend(cohort)
        capacity = len(cohort) * min(trade.supported_capital_usd for trade in cohort)
        capacity_values.append(capacity)
        gross_factor = statistics.fmean(trade.gross_factor for trade in cohort)
        cohort_reports.append(
            {
                "signalDay": signal_day.isoformat(),
                "skippedCompleteDay": (signal_day + timedelta(days=1)).isoformat(),
                "entryDay": entry_day.isoformat(),
                "exitDay": exit_day.isoformat(),
                "symbols": [trade.symbol for trade in cohort],
                "tradeCount": len(cohort),
                "grossReturn": _rounded(gross_factor - 1.0),
                "feeStressReturn": _rounded(
                    _net_factor(
                        gross_factor,
                        costs["feeStress"][0],
                        costs["feeStress"][1],
                    )
                    - 1.0
                ),
                "supportedCapitalUsd": _rounded(capacity),
            }
        )

    scenario_reports = {
        scenario: _path_report(values, days) for scenario, values in scenario_logs.items()
    }
    timing_matched_fee_stress = _path_report(benchmark_logs["feeStress"], days)
    p05_capacity: float | None = None
    if capacity_values:
        ordered_capacity = sorted(capacity_values)
        p05_capacity = ordered_capacity[math.floor(0.05 * (len(ordered_capacity) - 1))]
    selected_symbols = sorted({trade.symbol for trade in accepted_trades})
    active_weeks = {
        (trade.entry_day.isocalendar().year, trade.entry_day.isocalendar().week)
        for trade in accepted_trades
    }
    active_days = {
        entry_day + timedelta(days=offset)
        for _signal, entry_day, exit_day, _cohort in accepted
        for offset in range((exit_day - entry_day).days)
    }
    monthly_fee_stress = {
        month: sum(
            value
            for day_value, value in zip(days, scenario_logs["feeStress"], strict=True)
            if day_value.strftime("%Y-%m") == month
        )
        for month in sorted({day_value.strftime("%Y-%m") for day_value in days})
    }
    report: JsonObject = {
        "trialId": spec.trial_id,
        "parameters": {
            "abnormalThresholdMultiple": "2.0",
            "exactAbnormalAgeDays": spec.exact_age_days,
            "holdingDays": spec.holding_days,
        },
        "completedCohorts": len(cohort_reports),
        "tradeCount": len(accepted_trades),
        "completedSymbolSides": 2 * len(accepted_trades),
        "activeCalendarDays": len(active_days),
        "cashCalendarDays": len(days) - len(active_days),
        "activeWeeks": len(active_weeks),
        "distinctSelectedSymbols": len(selected_symbols),
        "selectedSymbols": selected_symbols,
        "suppressedOverlappingFormationDays": suppressed_overlap_count,
        "gross": scenario_reports["gross"],
        "publicFeeOnly": scenario_reports["feeOnly"],
        "base": scenario_reports["base"],
        "stress": scenario_reports["stress"],
        "severe": scenario_reports["severe"],
        "feeStress": scenario_reports["feeStress"],
        "positiveFeeStressMonths": sum(value > 0 for value in monthly_fee_stress.values()),
        "feeStressMonthlyLogReturns": {
            month: _rounded(value) for month, value in monthly_fee_stress.items()
        },
        "cash": {
            "endingNavUsd": 1000.0,
            "netUsdPer1000": 0.0,
            "maximumDrawdownFraction": 0.0,
            "intradayBound": "UNMEASURED",
        },
        "timingMatchedFeeStress": timing_matched_fee_stress,
        "capacity": {
            "status": "AVAILABLE" if capacity_values else "NULL_NO_TRADES",
            "allOneThousandUsdPathsFit": bool(capacity_values)
            and all(value >= 1000.0 for value in capacity_values),
            "p05SupportedCapitalUsd": (
                _rounded(p05_capacity) if p05_capacity is not None else None
            ),
            "minimumSupportedCapitalUsd": (
                _rounded(min(capacity_values)) if capacity_values else None
            ),
            "executableCapacity": "UNMEASURED",
        },
        "mechanism": termination_hazard(observations, spec.exact_age_days),
        "cohorts": cohort_reports,
    }
    return PartitionEvaluation(
        report,
        scenario_logs["feeStress"],
        benchmark_logs["feeStress"],
    )


def _mark_to_market_logs(
    bars_by_symbol: Mapping[str, Sequence[Bar]],
    cohorts: Sequence[tuple[date, date, date, tuple[Trade, ...]]],
    days: Sequence[date],
    fee_bp: int,
    adverse_bp: int,
) -> tuple[tuple[float, ...], tuple[float, ...]]:
    """Build synchronous daily strategy and timing-benchmark log paths."""

    lookups = {symbol: {bar.day: bar for bar in bars} for symbol, bars in bars_by_symbol.items()}
    entries = {entry: cohort for _signal, entry, _exit, cohort in cohorts}
    exits = {exit_day: cohort for _signal, _entry, exit_day, cohort in cohorts}
    fee = fee_bp / 10_000.0
    adverse = adverse_bp / 10_000.0
    buy_multiplier = (1.0 - fee) / (1.0 + adverse)
    sell_multiplier = (1.0 - fee) * (1.0 - adverse)

    def one_path(*, benchmark: bool) -> tuple[float, ...]:
        cash = 1000.0
        units: dict[str, float] | None = None
        previous_nav = cash
        logs: list[float] = []
        for day_value in days:
            prices = {
                symbol: float(lookup[day_value].open_price) for symbol, lookup in lookups.items()
            }
            exiting = exits.get(day_value)
            if exiting is not None:
                if units is None:
                    raise MeasurementError("EXIT_WITHOUT_OPEN_COHORT")
                cash = sum(units[symbol] * prices[symbol] for symbol in units) * sell_multiplier
                units = None
            entering = entries.get(day_value)
            if entering is not None:
                if units is not None:
                    raise MeasurementError("OVERLAPPING_COHORT_STATE")
                symbols = (
                    tuple(sorted(lookups))
                    if benchmark
                    else tuple(trade.symbol for trade in entering)
                )
                per_symbol = cash * buy_multiplier / len(symbols)
                units = {symbol: per_symbol / prices[symbol] for symbol in symbols}
                cash = 0.0
            nav = cash if units is None else sum(units[symbol] * prices[symbol] for symbol in units)
            if nav <= 0 or previous_nav <= 0:
                raise MeasurementError("NON_POSITIVE_PORTFOLIO_FACTOR")
            logs.append(math.log(nav / previous_nav))
            previous_nav = nav
        if units is not None:
            raise MeasurementError("PARTITION_END_POSITION_NOT_FLAT")
        return tuple(logs)

    return one_path(benchmark=False), one_path(benchmark=True)


def _family_inference(
    protocol: Mapping[str, Any],
    stress_matrix: Mapping[str, Sequence[float]],
    benchmark_matrix: Mapping[str, Sequence[float]],
) -> JsonObject:
    inference = _mapping(protocol, "inference")
    bootstrap = _mapping(inference, "bootstrap")
    replicates = _int(bootstrap, "replicates")
    seed = _int(bootstrap, "seed")
    primary = _int(bootstrap, "primaryBlockLengthDays")
    sensitivity = _int(bootstrap, "sensitivityBlockLengthDays")
    first_series = next(iter(stress_matrix.values()))
    primary_indices = circular_block_indices(len(first_series), primary, replicates, seed)
    sensitivity_indices = circular_block_indices(len(first_series), sensitivity, replicates, seed)
    raw_p_values: dict[str, float] = {}
    per_trial: dict[str, JsonObject] = {}
    excess_matrix: dict[str, tuple[float, ...]] = {}
    for trial_id in sorted(stress_matrix):
        series = tuple(stress_matrix[trial_id])
        benchmark = tuple(benchmark_matrix[trial_id])
        excess = tuple(left - right for left, right in zip(series, benchmark, strict=True))
        excess_matrix[trial_id] = excess
        primary_lcb, primary_median, primary_ucb = _bootstrap_net_bounds(series, primary_indices)
        sensitivity_lcb, sensitivity_median, sensitivity_ucb = _bootstrap_net_bounds(
            series, sensitivity_indices
        )
        excess_lcb, excess_median, excess_ucb = _bootstrap_net_bounds(excess, primary_indices)
        (
            sensitivity_excess_lcb,
            sensitivity_excess_median,
            sensitivity_excess_ucb,
        ) = _bootstrap_net_bounds(excess, sensitivity_indices)
        absolute_key = f"{trial_id}:cash"
        excess_key = f"{trial_id}:timing"
        raw_p_values[absolute_key] = _centered_one_sided_p(series, primary_indices)
        raw_p_values[excess_key] = _centered_one_sided_p(excess, primary_indices)
        per_trial[trial_id] = {
            "primary14DayFeeStressNetLowerBoundUsdPer1000": primary_lcb,
            "primary14DayFeeStressNetMedianUsdPer1000": primary_median,
            "primary14DayFeeStressNetUpperBoundUsdPer1000": primary_ucb,
            "sensitivity28DayFeeStressNetLowerBoundUsdPer1000": sensitivity_lcb,
            "sensitivity28DayFeeStressNetMedianUsdPer1000": sensitivity_median,
            "sensitivity28DayFeeStressNetUpperBoundUsdPer1000": sensitivity_ucb,
            "timingMatchedExcessLowerBoundUsdPer1000": excess_lcb,
            "timingMatchedExcessMedianUsdPer1000": excess_median,
            "timingMatchedExcessUpperBoundUsdPer1000": excess_ucb,
            "sensitivity28DayTimingMatchedExcessLowerBoundUsdPer1000": (sensitivity_excess_lcb),
            "sensitivity28DayTimingMatchedExcessMedianUsdPer1000": (sensitivity_excess_median),
            "sensitivity28DayTimingMatchedExcessUpperBoundUsdPer1000": (sensitivity_excess_ucb),
            "absoluteRawPValue": _rounded(raw_p_values[absolute_key]),
            "timingMatchedExcessRawPValue": _rounded(raw_p_values[excess_key]),
        }
    adjusted = holm_adjust(raw_p_values)
    for trial_id in per_trial:
        per_trial[trial_id]["absoluteHolmAdjustedPValue"] = adjusted[f"{trial_id}:cash"]
        per_trial[trial_id]["timingMatchedExcessHolmAdjustedPValue"] = adjusted[
            f"{trial_id}:timing"
        ]
    return {
        "trials": per_trial,
        "whiteRealityChecks": {
            "cash": _white_reality_check(stress_matrix, primary_indices),
            "timingMatched": _white_reality_check(excess_matrix, primary_indices),
        },
        "pbo": cscv_pbo(excess_matrix),
        "bootstrapReplicates": replicates,
        "holmHypothesisCount": len(raw_p_values),
    }


def _single_trial_inference(
    protocol: Mapping[str, Any],
    stress: Sequence[float],
    benchmark: Sequence[float],
    seed_offset: int,
) -> JsonObject:
    bootstrap = _mapping(_mapping(protocol, "inference"), "bootstrap")
    replicates = _int(bootstrap, "replicates")
    seed = _int(bootstrap, "seed") + seed_offset
    primary = circular_block_indices(
        len(stress),
        _int(bootstrap, "primaryBlockLengthDays"),
        replicates,
        seed,
    )
    sensitivity = circular_block_indices(
        len(stress),
        _int(bootstrap, "sensitivityBlockLengthDays"),
        replicates,
        seed,
    )
    excess = tuple(left - right for left, right in zip(stress, benchmark, strict=True))
    primary_stress = _bootstrap_net_bounds(stress, primary)
    sensitivity_stress = _bootstrap_net_bounds(stress, sensitivity)
    primary_excess = _bootstrap_net_bounds(excess, primary)
    return {
        "primary14DayFeeStressNetLowerBoundUsdPer1000": primary_stress[0],
        "primary14DayFeeStressNetMedianUsdPer1000": primary_stress[1],
        "primary14DayFeeStressNetUpperBoundUsdPer1000": primary_stress[2],
        "sensitivity28DayFeeStressNetLowerBoundUsdPer1000": sensitivity_stress[0],
        "sensitivity28DayFeeStressNetMedianUsdPer1000": sensitivity_stress[1],
        "sensitivity28DayFeeStressNetUpperBoundUsdPer1000": sensitivity_stress[2],
        "timingMatchedExcessLowerBoundUsdPer1000": primary_excess[0],
        "timingMatchedExcessMedianUsdPer1000": primary_excess[1],
        "timingMatchedExcessUpperBoundUsdPer1000": primary_excess[2],
        "absoluteOneSidedPValue": _rounded(_centered_one_sided_p(stress, primary)),
        "timingMatchedExcessOneSidedPValue": _rounded(_centered_one_sided_p(excess, primary)),
        "bootstrapReplicates": replicates,
    }


def _white_reality_check(
    excess_matrix: Mapping[str, Sequence[float]],
    indices: Sequence[Sequence[int]],
) -> JsonObject:
    observed = {trial_id: statistics.fmean(series) for trial_id, series in excess_matrix.items()}
    best_trial = min(observed, key=lambda item: (-observed[item], item))
    observed_max = observed[best_trial]
    centered = {
        trial_id: tuple(value - observed[trial_id] for value in series)
        for trial_id, series in excess_matrix.items()
    }
    exceedances = 0
    for sample in indices:
        replicate_max = max(
            sum(centered[trial_id][index] for index in sample) / len(sample)
            for trial_id in centered
        )
        if replicate_max >= observed_max:
            exceedances += 1
    p_value = (exceedances + 1) / (len(indices) + 1)
    return {
        "bestTrialId": best_trial,
        "observedBestMeanDailyExcessLogReturn": _rounded(observed_max),
        "pValue": _rounded(p_value),
        "familySize": len(excess_matrix),
    }


def _development_gates(
    protocol: Mapping[str, Any],
    report: Mapping[str, Any],
    trial_inference: Mapping[str, Any],
    white: Mapping[str, Any],
) -> dict[str, bool]:
    gates = _mapping(protocol, "developmentGates")
    capacity = _mapping(report, "capacity")
    fee_stress = _mapping(report, "feeStress")
    mechanism = _mapping(report, "mechanism")
    white_cash = _mapping(white, "cash")
    white_timing = _mapping(white, "timingMatched")
    stress = _mapping(report, "stress")
    severe = _mapping(report, "severe")
    return {
        "completedCohorts": _int(report, "completedCohorts")
        >= _int(gates, "completedCohortsMinimum"),
        "completedSymbolSides": _int(report, "completedSymbolSides")
        >= _int(gates, "completedSymbolSidesMinimum"),
        "activeCalendarDays": _int(report, "activeCalendarDays")
        >= _int(gates, "activeCalendarDaysMinimum"),
        "cashCalendarDays": _int(report, "cashCalendarDays")
        >= _int(gates, "cashCalendarDaysMinimum"),
        "distinctSelectedSymbols": _int(report, "distinctSelectedSymbols")
        >= _int(gates, "distinctSelectedSymbolsMinimum"),
        "hazardRiskSet": _int(mechanism, "observedNextDay") >= _int(gates, "hazardRiskSetMinimum"),
        "positiveFeeStressMonths": _int(report, "positiveFeeStressMonths")
        >= _int(gates, "positiveStressMonthsMinimum"),
        "stressNet": _float(stress, "netUsdPer1000")
        > float(_str(gates, "stressNetUsdPer1000ExclusiveMinimum")),
        "severeNet": _float(severe, "netUsdPer1000")
        > float(_str(gates, "severeNetUsdPer1000ExclusiveMinimum")),
        "feeStressNet": _float(fee_stress, "netUsdPer1000")
        > float(_str(gates, "feeStressNetUsdPer1000ExclusiveMinimum")),
        "primaryInterval": _float(trial_inference, "primary14DayFeeStressNetLowerBoundUsdPer1000")
        > float(_str(gates, "primary14DayStressAbsoluteLowerBoundExclusiveMinimum")),
        "sensitivityInterval": _float(
            trial_inference, "sensitivity28DayFeeStressNetLowerBoundUsdPer1000"
        )
        > float(_str(gates, "sensitivity28DayStressAbsoluteLowerBoundExclusiveMinimum")),
        "timingBenchmarkInterval": _float(
            trial_inference, "timingMatchedExcessLowerBoundUsdPer1000"
        )
        > float(
            _str(
                gates,
                "primary14DayStressBenchmarkExcessLowerBoundExclusiveMinimum",
            )
        ),
        "sensitivityTimingBenchmarkInterval": _float(
            trial_inference,
            "sensitivity28DayTimingMatchedExcessLowerBoundUsdPer1000",
        )
        > float(
            _str(
                gates,
                "sensitivity28DayStressBenchmarkExcessLowerBoundExclusiveMinimum",
            )
        ),
        "holmAbsolute": _float(trial_inference, "absoluteHolmAdjustedPValue")
        <= float(_str(gates, "holmSelectedTrialAbsoluteAdjustedPMaximum")),
        "holmTimingMatched": _float(trial_inference, "timingMatchedExcessHolmAdjustedPValue")
        <= float(_str(gates, "holmSelectedTrialBenchmarkExcessAdjustedPMaximum")),
        "whiteCash": _float(white_cash, "pValue")
        <= float(_str(gates, "whiteRealityCheckCashPMaximum")),
        "whiteTimingMatched": _float(white_timing, "pValue")
        <= float(_str(gates, "whiteRealityCheckBenchmarkPMaximum")),
        "feeStressDrawdown": _float(fee_stress, "maximumDrawdownFraction")
        <= float(_str(gates, "stressMaximumDrawdownMaximum")),
        "publicCapacity": bool(capacity.get("allOneThousandUsdPathsFit"))
        and _optional_float(capacity.get("p05SupportedCapitalUsd"))
        >= float(_str(gates, "p05SupportedCapitalUsdMinimum")),
    }


def _holdout_gates(
    protocol: Mapping[str, Any],
    report: Mapping[str, Any],
    trial_inference: Mapping[str, Any],
) -> dict[str, bool]:
    gates = _mapping(_mapping(protocol, "holdout"), "holdoutGates")
    capacity = _mapping(report, "capacity")
    fee_stress = _mapping(report, "feeStress")
    mechanism = _mapping(report, "mechanism")
    stress = _mapping(report, "stress")
    severe = _mapping(report, "severe")
    return {
        "completedCohorts": _int(report, "completedCohorts")
        >= _int(gates, "completedCohortsMinimum"),
        "completedSymbolSides": _int(report, "completedSymbolSides")
        >= _int(gates, "completedSymbolSidesMinimum"),
        "activeCalendarDays": _int(report, "activeCalendarDays")
        >= _int(gates, "activeCalendarDaysMinimum"),
        "cashCalendarDays": _int(report, "cashCalendarDays")
        >= _int(gates, "cashCalendarDaysMinimum"),
        "distinctSelectedSymbols": _int(report, "distinctSelectedSymbols")
        >= _int(gates, "distinctSelectedSymbolsMinimum"),
        "hazardRiskSet": _int(mechanism, "observedNextDay") >= _int(gates, "hazardRiskSetMinimum"),
        "positiveFeeStressMonths": _int(report, "positiveFeeStressMonths")
        >= _int(gates, "positiveStressMonthsMinimum"),
        "stressNet": _float(stress, "netUsdPer1000")
        > float(_str(gates, "stressNetUsdPer1000ExclusiveMinimum")),
        "severeNet": _float(severe, "netUsdPer1000")
        > float(_str(gates, "severeNetUsdPer1000ExclusiveMinimum")),
        "feeStressNet": _float(fee_stress, "netUsdPer1000")
        > float(_str(gates, "feeStressNetUsdPer1000ExclusiveMinimum")),
        "primaryInterval": _float(trial_inference, "primary14DayFeeStressNetLowerBoundUsdPer1000")
        > float(_str(gates, "primary14DayStressAbsoluteLowerBoundExclusiveMinimum")),
        "timingBenchmarkInterval": _float(
            trial_inference, "timingMatchedExcessLowerBoundUsdPer1000"
        )
        > float(
            _str(
                gates,
                "primary14DayStressBenchmarkExcessLowerBoundExclusiveMinimum",
            )
        ),
        "absolutePValue": _float(trial_inference, "absoluteOneSidedPValue")
        <= float(_str(gates, "stressAbsolutePMaximum")),
        "timingMatchedPValue": _float(trial_inference, "timingMatchedExcessOneSidedPValue")
        <= float(_str(gates, "stressBenchmarkExcessPMaximum")),
        "feeStressDrawdown": _float(fee_stress, "maximumDrawdownFraction")
        <= float(_str(gates, "stressMaximumDrawdownMaximum")),
        "publicCapacity": bool(capacity.get("allOneThousandUsdPathsFit"))
        and _optional_float(capacity.get("p05SupportedCapitalUsd"))
        >= float(_str(gates, "p05SupportedCapitalUsdMinimum")),
    }


def _terminal_result(
    verdict: str,
    disposition: str,
    freeze_object: Mapping[str, Any],
    marker_sha: str,
    development: Mapping[str, Any] | None,
    holdout: Mapping[str, Any] | None,
) -> JsonObject:
    result: JsonObject = {
        "version": "VG35ResultV1",
        "createdAtUtc": _utc_now(),
        "verdict": verdict,
        "disposition": disposition,
        "freezeSha256": _sha256_path(FREEZE_PATH),
        "protocolSha256": freeze_object["protocolSha256"],
        "runMarkerSha256": marker_sha,
        "developmentOpened": development is not None,
        "holdoutOpened": holdout is not None,
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
    if development is not None:
        result["developmentSha256"] = _sha256_path(DEVELOPMENT_PATH)
        result["championTrialId"] = development["championTrialId"]
        result["developmentGates"] = development["developmentGates"]
    if holdout is not None:
        result["selectionSha256"] = _sha256_path(SELECTION_PATH)
        result["holdoutSha256"] = _sha256_path(HOLDOUT_PATH)
        result["holdoutGates"] = holdout["holdoutGates"]
    return result


def _load_bars(
    protocol: Mapping[str, Any],
    manifest: Mapping[str, Any],
    allowed_months: Sequence[str],
    expected_start: date,
    expected_end: date,
    baseline_bars: Mapping[str, Sequence[Bar]] | None = None,
) -> dict[str, tuple[Bar, ...]]:
    source_root = Path(_str(_mapping(protocol, "data"), "sourceCorpusRoot"))
    columns = _mapping(_mapping(protocol, "data"), "klineColumnsZeroBased")
    wanted = set(allowed_months)
    grouped: dict[str, list[Bar]] = defaultdict(list)
    archives = manifest.get("archives")
    if not isinstance(archives, list):
        raise MeasurementError("MANIFEST_ARCHIVES_INVALID")
    for raw_entry in archives:
        if not isinstance(raw_entry, dict) or raw_entry.get("month") not in wanted:
            continue
        entry = cast(JsonObject, raw_entry)
        symbol = _str(entry, "symbol")
        month = _str(entry, "month")
        archive = _mapping(entry, "archive")
        path = _safe_shared_file(source_root, _str(archive, "path"))
        try:
            with zipfile.ZipFile(path, "r") as handle:
                members = handle.infolist()
                if len(members) != 1 or members[0].is_dir():
                    raise MeasurementError("ZIP_MEMBER_COUNT_NOT_ONE")
                expected_member = f"{symbol}-1d-{month}.csv"
                if members[0].filename != expected_member:
                    raise MeasurementError("ZIP_MEMBER_NAME_MISMATCH")
                with handle.open(members[0], "r") as raw:
                    text = (line.decode("utf-8") for line in raw)
                    for row in csv.reader(text):
                        if len(row) != 12:
                            raise MeasurementError("CSV_SCHEMA_MISMATCH")
                        bar = _parse_bar(row, columns)
                        if bar.day.strftime("%Y-%m") != month:
                            raise MeasurementError("BAR_OUTSIDE_MANIFEST_MONTH")
                        grouped[symbol].append(bar)
        except (OSError, zipfile.BadZipFile, UnicodeDecodeError) as error:
            raise MeasurementError("ARCHIVE_OPEN_OR_DECODE_FAILURE") from error

    symbols = _str_sequence(_mapping(protocol, "data"), "symbols")
    complete: dict[str, tuple[Bar, ...]] = {}
    for symbol in symbols:
        loaded = grouped.get(symbol, [])
        if any(not expected_start <= bar.day < expected_end for bar in loaded):
            raise MeasurementError("UNINTENDED_OUT_OF_WINDOW_BAR")
        if baseline_bars is not None:
            prior = [bar for bar in baseline_bars.get(symbol, ()) if bar.day < expected_start]
            loaded = prior + loaded
        _validate_daily_completeness(loaded, expected_start, expected_end)
        complete[symbol] = tuple(loaded)
    return complete


def _parse_bar(row: Sequence[str], columns: Mapping[str, Any]) -> Bar:
    try:
        timestamp = int(row[_int(columns, "openTime")])
        close_timestamp = int(row[_int(columns, "closeTime")])
        open_price = Decimal(row[_int(columns, "open")])
        high_price = Decimal(row[_int(columns, "high")])
        low_price = Decimal(row[_int(columns, "low")])
        close_price = Decimal(row[_int(columns, "close")])
        base_volume = Decimal(row[_int(columns, "baseVolume")])
        quote_volume = Decimal(row[_int(columns, "quoteVolume")])
        trade_count = int(row[_int(columns, "tradeCount")])
        taker_buy_base = Decimal(row[_int(columns, "takerBuyBaseVolume")])
        taker_buy_quote = Decimal(row[_int(columns, "takerBuyQuoteVolume")])
        ignored = Decimal(row[_int(columns, "ignore")])
    except (ValueError, InvalidOperation, IndexError) as error:
        raise MeasurementError("INVALID_KLINE_VALUE") from error
    if timestamp < 1_000_000_000_000_000:
        raise MeasurementError("TIMESTAMP_NOT_MICROSECONDS")
    if timestamp % 1_000_000 != 0:
        raise MeasurementError("KLINE_OPEN_NOT_WHOLE_SECOND")
    if close_timestamp != timestamp + 86_400_000_000 - 1:
        raise MeasurementError("KLINE_CLOSE_TIME_MISMATCH")
    try:
        moment = datetime.fromtimestamp(timestamp // 1_000_000, tz=UTC)
    except (OverflowError, OSError, ValueError) as error:
        raise MeasurementError("INVALID_KLINE_TIMESTAMP") from error
    if moment.time() != datetime.min.time():
        raise MeasurementError("KLINE_NOT_UTC_DAILY_OPEN")
    decimals = (
        open_price,
        high_price,
        low_price,
        close_price,
        base_volume,
        quote_volume,
        taker_buy_base,
        taker_buy_quote,
        ignored,
    )
    if not all(value.is_finite() for value in decimals):
        raise MeasurementError("NON_FINITE_KLINE_VALUE")
    if (
        any(value <= 0 for value in (open_price, high_price, low_price, close_price))
        or any(value < 0 for value in (base_volume, quote_volume, taker_buy_base, taker_buy_quote))
        or trade_count < 0
    ):
        raise MeasurementError("INVALID_KLINE_DOMAIN")
    if high_price < max(open_price, low_price, close_price) or low_price > min(
        open_price, high_price, close_price
    ):
        raise MeasurementError("INVALID_KLINE_OHLC_ORDER")
    return Bar(moment.date(), open_price, quote_volume)


def _validate_daily_completeness(
    bars: Sequence[Bar],
    expected_start: date,
    expected_end: date,
) -> None:
    days = [bar.day for bar in bars]
    if days != sorted(days) or len(days) != len(set(days)):
        raise MeasurementError("DUPLICATE_OR_UNSORTED_DAILY_BAR")
    selected = {day for day in days if expected_start <= day < expected_end}
    expected: set[date] = set()
    current = expected_start
    while current < expected_end:
        expected.add(current)
        current += timedelta(days=1)
    if selected != expected:
        raise MeasurementError("MISSING_OR_OFF_GRID_DAILY_BAR")


def _supported_capital(
    bars_by_day: Mapping[date, Bar],
    entry_day: date,
    exit_day: date,
    lookback: int,
) -> float:
    proxies: list[Decimal] = []
    for leg_day in (entry_day, exit_day):
        prior = [
            bars_by_day[leg_day - timedelta(days=offset)].quote_volume
            for offset in range(1, lookback + 1)
            if leg_day - timedelta(days=offset) in bars_by_day
        ]
        if len(prior) != lookback:
            raise MeasurementError("CAPACITY_LOOKBACK_INCOMPLETE")
        proxies.append(_median_decimal(prior) * Decimal("0.0001"))
    return float(min(proxies))


def _path_report(log_returns: Sequence[float], days: Sequence[date]) -> JsonObject:
    nav = 1000.0
    peak = nav
    peak_day = days[0]
    max_drawdown = 0.0
    drawdown_peak = days[0]
    drawdown_trough = days[0]
    for day_value, log_return in zip(days, log_returns, strict=True):
        mark_day = day_value + timedelta(days=1)
        nav *= math.exp(log_return)
        if nav > peak:
            peak = nav
            peak_day = mark_day
        drawdown = 1.0 - nav / peak
        if drawdown > max_drawdown:
            max_drawdown = drawdown
            drawdown_peak = peak_day
            drawdown_trough = mark_day
    return {
        "endingNavUsd": _rounded(nav),
        "netUsdPer1000": _rounded(nav - 1000.0),
        "maximumDrawdownFraction": _rounded(max_drawdown),
        "drawdownPeakDay": drawdown_peak.isoformat(),
        "drawdownTroughDay": drawdown_trough.isoformat(),
        "intradayBound": "UNMEASURED",
    }


def _bootstrap_net_bounds(
    series: Sequence[float],
    indices: Sequence[Sequence[int]],
) -> tuple[float, float, float]:
    estimates = sorted(
        1000.0 * math.expm1(sum(series[index] for index in sample)) for sample in indices
    )
    lower_index = math.floor(0.05 * (len(estimates) - 1))
    median_index = math.floor(0.50 * (len(estimates) - 1))
    upper_index = math.ceil(0.95 * (len(estimates) - 1))
    return (
        _rounded(estimates[lower_index]),
        _rounded(estimates[median_index]),
        _rounded(estimates[upper_index]),
    )


def _centered_one_sided_p(
    series: Sequence[float],
    indices: Sequence[Sequence[int]],
) -> float:
    observed = statistics.fmean(series)
    centered = tuple(value - observed for value in series)
    exceedances = sum(
        statistics.fmean(centered[index] for index in sample) >= observed for sample in indices
    )
    return (exceedances + 1) / (len(indices) + 1)


def _net_factor(gross_factor: float, fee_bp: int, adverse_bp: int) -> float:
    fee = fee_bp / 10_000.0
    adverse = adverse_bp / 10_000.0
    return gross_factor * ((1.0 - fee) / (1.0 + adverse)) * (1.0 - adverse) * (1.0 - fee)


def _validate_manifest_shape(
    protocol: Mapping[str, Any],
    manifest: Mapping[str, Any],
    verify_bytes: bool,
) -> None:
    data = _mapping(protocol, "data")
    if manifest.get("version") != "VG35SourceManifestV1":
        raise VG35Error("SOURCE_MANIFEST_VERSION_MISMATCH")
    if manifest.get("protocolSha256") != _sha256_path(PROTOCOL_PATH):
        raise VG35Error("SOURCE_MANIFEST_PROTOCOL_MISMATCH")
    archives_raw = manifest.get("archives")
    if not isinstance(archives_raw, list):
        raise VG35Error("SOURCE_MANIFEST_ARCHIVES_INVALID")
    expected = _int(data, "expectedArchiveCount")
    if len(archives_raw) != expected or manifest.get("archiveCount") != expected:
        raise VG35Error("SOURCE_ARCHIVE_COUNT_MISMATCH")
    if manifest.get("checksumCount") != _int(data, "expectedChecksumCount"):
        raise VG35Error("SOURCE_CHECKSUM_COUNT_MISMATCH")
    if manifest.get("archiveMembersOpenedByVg35") != 0:
        raise VG35Error("ACQUISITION_OPENED_ARCHIVE_MEMBER")
    source_root = Path(_str(data, "sourceCorpusRoot"))
    if manifest.get("sourceCorpusRoot") != str(source_root):
        raise VG35Error("SOURCE_CORPUS_ROOT_MISMATCH")
    custody_path = Path(_str(data, "sharedCustodyManifest"))
    if (
        not custody_path.is_file()
        or custody_path.is_symlink()
        or manifest.get("sharedCustodyManifest") != str(custody_path)
        or manifest.get("sharedCustodyManifestSha256") != _sha256_path(custody_path)
    ):
        raise VG35Error("SHARED_CUSTODY_MANIFEST_BINDING_MISMATCH")
    seen: set[tuple[str, str]] = set()
    for raw_entry in archives_raw:
        if not isinstance(raw_entry, dict):
            raise VG35Error("SOURCE_MANIFEST_ENTRY_INVALID")
        entry = cast(JsonObject, raw_entry)
        key = (_str(entry, "symbol"), _str(entry, "month"))
        if key in seen:
            raise VG35Error("SOURCE_MANIFEST_DUPLICATE")
        seen.add(key)
        symbol, month = key
        interval = _str(data, "archiveInterval")
        if _str(entry, "interval") != interval:
            raise VG35Error("SOURCE_MANIFEST_INTERVAL_MISMATCH")
        archive = _mapping(entry, "archive")
        checksum = _mapping(entry, "checksum")
        expected_url = _str(data, "archiveUrlTemplate").format(symbol=symbol, month=month)
        expected_archive_path = f"{symbol}/{symbol}-{interval}-{month}.zip"
        if _str(archive, "url") != expected_url or _str(archive, "path") != expected_archive_path:
            raise VG35Error("SOURCE_MANIFEST_ARCHIVE_IDENTITY_MISMATCH")
        if (
            _str(checksum, "url") != expected_url + _str(data, "checksumUrlSuffix")
            or _str(checksum, "path") != expected_archive_path + ".CHECKSUM"
        ):
            raise VG35Error("SOURCE_MANIFEST_CHECKSUM_IDENTITY_MISMATCH")
        if verify_bytes:
            archive_path = _safe_shared_file(source_root, _str(archive, "path"))
            checksum_path = _safe_shared_file(source_root, _str(checksum, "path"))
            if archive_path.stat().st_size != _int(archive, "bytes"):
                raise VG35Error("ARCHIVE_BYTE_SIZE_MISMATCH")
            if checksum_path.stat().st_size != _int(checksum, "bytes"):
                raise VG35Error("CHECKSUM_BYTE_SIZE_MISMATCH")
            if _sha256_path(archive_path) != _str(archive, "sha256"):
                raise VG35Error("ARCHIVE_BYTE_HASH_MISMATCH")
            if _sha256_path(checksum_path) != _str(checksum, "sha256"):
                raise VG35Error("CHECKSUM_BYTE_HASH_MISMATCH")
            publisher = _parse_publisher_checksum(checksum_path, archive_path.name)
            if publisher != _str(entry, "publisherSha256"):
                raise VG35Error("PUBLISHER_CHECKSUM_BINDING_MISMATCH")
            if publisher != _sha256_path(archive_path):
                raise VG35Error("ARCHIVE_PUBLISHER_CHECKSUM_MISMATCH")
    expected_keys = {
        (symbol, month)
        for symbol in _str_sequence(data, "symbols")
        for month in _str_sequence(data, "archiveMonths")
    }
    if seen != expected_keys:
        raise VG35Error("SOURCE_MANIFEST_COVERAGE_MISMATCH")


def _verify_freeze(protocol: Mapping[str, Any]) -> JsonObject:
    freeze_object = _read_json(FREEZE_PATH)
    if freeze_object.get("version") != "VG35FreezeV1":
        raise VG35Error("FREEZE_VERSION_MISMATCH")
    if freeze_object.get("protocolSha256") != _sha256_path(PROTOCOL_PATH):
        raise VG35Error("FREEZE_PROTOCOL_MISMATCH")
    if freeze_object.get("sourceManifestSha256") != _sha256_path(SOURCE_MANIFEST_PATH):
        raise VG35Error("FREEZE_SOURCE_MANIFEST_MISMATCH")
    if freeze_object.get("outcomeRoot") != str(PACKET_DIR):
        raise VG35Error("FREEZE_OUTCOME_ROOT_MISMATCH")
    runtime = _mapping(freeze_object, "runtime")
    if _str(runtime, "python") != sys.version:
        raise VG35Error("FREEZE_PYTHON_RUNTIME_MISMATCH")
    if _str(runtime, "implementation") != platform.python_implementation():
        raise VG35Error("FREEZE_PYTHON_IMPLEMENTATION_MISMATCH")
    if _str(runtime, "uvVersion") != _uv_version():
        raise VG35Error("FREEZE_UV_RUNTIME_MISMATCH")
    raw_inputs = freeze_object.get("inputs")
    if not isinstance(raw_inputs, list):
        raise VG35Error("FREEZE_INPUT_SET_INVALID")
    expected_paths = {
        *(
            f"quant/research/vg35/{name}"
            for name in _str_sequence(_mapping(protocol, "lifecycle"), "freezeBoundPacketPaths")
        ),
        *(
            f"quant/{name}"
            for name in _str_sequence(
                _mapping(protocol, "lifecycle"), "freezeBoundRuntimePathsRelativeToQuant"
            )
        ),
    }
    found_paths: set[str] = set()
    for raw in raw_inputs:
        if not isinstance(raw, dict):
            raise VG35Error("FREEZE_INPUT_INVALID")
        entry = cast(JsonObject, raw)
        relative = _str(entry, "path")
        if relative in found_paths:
            raise VG35Error("FREEZE_INPUT_DUPLICATE")
        found_paths.add(relative)
        if relative.startswith("quant/research/vg35/"):
            path = PACKET_DIR / relative.removeprefix("quant/research/vg35/")
        elif relative.startswith("quant/"):
            path = QUANT_DIR / relative.removeprefix("quant/")
        else:
            raise VG35Error("FREEZE_INPUT_PATH_INVALID")
        if _sha256_path(path) != _str(entry, "sha256"):
            raise VG35Error(f"FREEZE_INPUT_HASH_MISMATCH:{path.name}")
        if path.stat().st_size != _int(entry, "bytes"):
            raise VG35Error(f"FREEZE_INPUT_SIZE_MISMATCH:{path.name}")
    if found_paths != expected_paths:
        raise VG35Error("FREEZE_INPUT_SET_MISMATCH")
    git_identity = _mapping(freeze_object, "git")
    if _str(git_identity, "canonicalBase") != _str(protocol, "canonicalBase"):
        raise VG35Error("FREEZE_CANONICAL_BASE_MISMATCH")
    if not _git_is_ancestor(
        _str(git_identity, "canonicalBase"), _str(git_identity, "authorityHead")
    ):
        raise VG35Error("FREEZE_GIT_ANCESTRY_MISMATCH")
    if _str(git_identity, "authorityTree") != _git_output(
        "rev-parse", f"{_str(git_identity, 'authorityHead')}^{{tree}}"
    ):
        raise VG35Error("FREEZE_GIT_TREE_MISMATCH")
    return freeze_object


def _parse_publisher_checksum(path: Path, expected_name: str) -> str:
    fields = path.read_text(encoding="utf-8").strip().split()
    if len(fields) != 2:
        raise VG35Error("PUBLISHER_CHECKSUM_FORMAT_INVALID")
    digest, filename = fields
    if filename.lstrip("*") != expected_name:
        raise VG35Error("PUBLISHER_CHECKSUM_FILENAME_MISMATCH")
    if len(digest) != 64 or any(character not in "0123456789abcdefABCDEF" for character in digest):
        raise VG35Error("PUBLISHER_CHECKSUM_DIGEST_INVALID")
    return digest.lower()


def _outcome_paths() -> tuple[Path, ...]:
    names = (
        RUN_MARKER_PATH.name,
        SELECTION_PATH.name,
        HOLDOUT_MARKER_PATH.name,
        DEVELOPMENT_PATH.name,
        HOLDOUT_PATH.name,
        RESULT_PATH.name,
    )
    return tuple(PACKET_DIR / name for name in names)


def _verified_gate_map(
    artifact: Mapping[str, Any],
    gates_key: str,
    all_key: str,
) -> tuple[JsonObject, bool]:
    gates = _mapping(artifact, gates_key)
    if not gates or any(not isinstance(value, bool) for value in gates.values()):
        raise VG35Error(f"INVALID_GATE_MAP:{gates_key}")
    all_value = artifact.get(all_key)
    if not isinstance(all_value, bool) or all_value != all(gates.values()):
        raise VG35Error(f"INVALID_GATE_SUMMARY:{all_key}")
    return gates, all_value


def _verify_sha256sums_exact() -> int:
    if not SHA256SUMS_PATH.is_file():
        raise VG35Error("SHA256SUMS_MISSING")
    expected_names = sorted(
        path.name
        for path in PACKET_DIR.iterdir()
        if path.is_file() and path.name != SHA256SUMS_PATH.name
    )
    lines = SHA256SUMS_PATH.read_text(encoding="utf-8").splitlines()
    if not lines or any(not line for line in lines):
        raise VG35Error("SHA256SUMS_EMPTY_OR_BLANK")
    found_names: list[str] = []
    for line in lines:
        digest, separator, relative = line.partition("  ")
        if (
            not separator
            or "/" in relative
            or relative == SHA256SUMS_PATH.name
            or len(digest) != 64
            or any(character not in "0123456789abcdef" for character in digest)
        ):
            raise VG35Error("INVALID_SHA256SUMS_ENTRY")
        found_names.append(relative)
        if _sha256_path(PACKET_DIR / relative) != digest:
            raise VG35Error(f"SHA256SUMS_MISMATCH:{relative}")
    if found_names != expected_names:
        raise VG35Error("SHA256SUMS_COVERAGE_OR_ORDER_MISMATCH")
    return len(found_names)


def hashes() -> JsonObject:
    """Refresh the deterministic packet-local SHA-256 inventory."""

    paths = sorted(
        (
            path
            for path in PACKET_DIR.iterdir()
            if path.is_file() and path.name != SHA256SUMS_PATH.name
        ),
        key=lambda item: item.name,
    )
    payload = "".join(f"{_sha256_path(path)}  {path.name}\n" for path in paths).encode()
    temporary = SHA256SUMS_PATH.with_name(f".{SHA256SUMS_PATH.name}.part")
    _write_bytes_replace(temporary, SHA256SUMS_PATH, payload)
    return {"status": "WRITTEN", "entryCount": len(paths)}


def _write_json_exclusive(path: Path, value: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    data = _canonical_json(value)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "wb", closefd=True) as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        _fsync_directory(path.parent)
    except Exception:
        with contextlib.suppress(OSError):
            os.close(descriptor)
        raise


def _write_json_replace(path: Path, value: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".part")
    _write_bytes_replace(temporary, path, _canonical_json(value))


def _write_bytes_replace(temporary: Path, destination: Path, data: bytes) -> None:
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "wb", closefd=True) as handle:
        handle.write(data)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, destination)
    _fsync_directory(destination.parent)


def _fsync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _file_identity(path: Path, label: str) -> JsonObject:
    if not path.is_file():
        raise VG35Error(f"FREEZE_INPUT_MISSING:{label}")
    return {"path": label, "sha256": _sha256_path(path), "bytes": path.stat().st_size}


def _sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError as error:
        raise VG35Error(f"FILE_UNREADABLE:{path.name}") from error
    return digest.hexdigest()


def _read_json(path: Path) -> JsonObject:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise VG35Error(f"JSON_UNREADABLE:{path.name}") from error
    if not isinstance(value, dict):
        raise VG35Error(f"JSON_ROOT_NOT_OBJECT:{path.name}")
    return cast(JsonObject, value)


def _canonical_json(value: Mapping[str, Any]) -> bytes:
    return (json.dumps(value, indent=2, sort_keys=True, ensure_ascii=True) + "\n").encode()


def _mapping(value: Mapping[str, Any], key: str) -> JsonObject:
    found = value.get(key)
    if not isinstance(found, dict):
        raise VG35Error(f"EXPECTED_OBJECT:{key}")
    return cast(JsonObject, found)


def _str(value: Mapping[str, Any], key: str) -> str:
    found = value.get(key)
    if not isinstance(found, str):
        raise VG35Error(f"EXPECTED_STRING:{key}")
    return found


def _int(value: Mapping[str, Any], key: str) -> int:
    found = value.get(key)
    if not isinstance(found, int) or isinstance(found, bool):
        raise VG35Error(f"EXPECTED_INTEGER:{key}")
    return found


def _float(value: Mapping[str, Any], key: str) -> float:
    found = value.get(key)
    if not isinstance(found, (float, int)) or isinstance(found, bool):
        raise VG35Error(f"EXPECTED_NUMBER:{key}")
    return float(found)


def _str_sequence(value: Mapping[str, Any], key: str) -> tuple[str, ...]:
    found = value.get(key)
    if not isinstance(found, list) or not all(isinstance(item, str) for item in found):
        raise VG35Error(f"EXPECTED_STRING_ARRAY:{key}")
    return tuple(cast(list[str], found))


def _int_sequence(value: Mapping[str, Any], key: str) -> tuple[int, ...]:
    found = value.get(key)
    if not isinstance(found, list) or not all(
        isinstance(item, int) and not isinstance(item, bool) for item in found
    ):
        raise VG35Error(f"EXPECTED_INTEGER_ARRAY:{key}")
    return tuple(cast(list[int], found))


def _optional_float(value: Any) -> float:
    if isinstance(value, (float, int)) and not isinstance(value, bool):
        return float(value)
    return -math.inf


def _git_output(*arguments: str) -> str:
    try:
        completed = subprocess.run(
            ("git", *arguments),
            cwd=REPO_DIR,
            check=True,
            capture_output=True,
            text=True,
            timeout=30,
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise VG35Error(f"GIT_COMMAND_FAILED:{arguments[0]}") from error
    return completed.stdout.strip()


def _require_clean_git(phase: str) -> None:
    status = _git_output("status", "--porcelain=v1", "--untracked-files=all")
    if status:
        raise VG35Error(f"{phase}_GIT_NOT_CLEAN")


def _require_tracked_at_head(relative_paths: Sequence[str], phase: str) -> None:
    for relative in relative_paths:
        repository_relative = f"quant/research/vg35/{relative}"
        try:
            _git_output("cat-file", "-e", f"HEAD:{repository_relative}")
        except VG35Error as error:
            raise VG35Error(f"{phase}_INPUT_NOT_COMMITTED:{relative}") from error


def _require_acquire_git_precondition(protocol: Mapping[str, Any]) -> None:
    _require_clean_git("SOURCE_ACQUISITION")
    lifecycle = _mapping(protocol, "lifecycle")
    required = tuple(
        name
        for name in _str_sequence(lifecycle, "freezeBoundPacketPaths")
        if name != SOURCE_MANIFEST_PATH.name
    )
    _require_tracked_at_head(required, "SOURCE_ACQUISITION")
    canonical_base = _str(protocol, "canonicalBase")
    if not _git_is_ancestor(canonical_base, _git_output("rev-parse", "HEAD")):
        raise VG35Error("SOURCE_ACQUISITION_BASE_ANCESTRY_MISMATCH")


def _require_freeze_git_precondition(protocol: Mapping[str, Any]) -> None:
    _require_clean_git("FREEZE")
    lifecycle = _mapping(protocol, "lifecycle")
    _require_tracked_at_head(_str_sequence(lifecycle, "freezeBoundPacketPaths"), "FREEZE")
    for relative in _str_sequence(lifecycle, "freezeBoundRuntimePathsRelativeToQuant"):
        try:
            _git_output("cat-file", "-e", f"HEAD:quant/{relative}")
        except VG35Error as error:
            raise VG35Error(f"FREEZE_RUNTIME_NOT_COMMITTED:{relative}") from error


def _freeze_git_identity(protocol: Mapping[str, Any]) -> JsonObject:
    authority_head = _git_output("rev-parse", "HEAD")
    canonical_base = _str(protocol, "canonicalBase")
    if not _git_is_ancestor(canonical_base, authority_head):
        raise VG35Error("FREEZE_BASE_ANCESTRY_MISMATCH")
    return {
        "authorityHead": authority_head,
        "authorityTree": _git_output("rev-parse", "HEAD^{tree}"),
        "canonicalBase": canonical_base,
        "canonicalBaseIsAncestor": True,
        "worktreeStatus": "CLEAN",
    }


def _require_run_git_precondition(freeze_object: Mapping[str, Any]) -> None:
    _require_clean_git("RUN")
    git_identity = _mapping(freeze_object, "git")
    authority_head = _str(git_identity, "authorityHead")
    current_head = _git_output("rev-parse", "HEAD")
    if _git_output("rev-parse", f"{current_head}^") != authority_head:
        raise VG35Error("RUN_HEAD_NOT_SINGLE_FREEZE_COMMIT")
    changed = _git_output("diff", "--name-only", authority_head, current_head).splitlines()
    if changed != ["quant/research/vg35/freeze.v1.json"]:
        raise VG35Error("RUN_HEAD_DIFF_NOT_EXACT_FREEZE")


def _git_is_ancestor(ancestor: str, descendant: str) -> bool:
    try:
        subprocess.run(
            ("git", "merge-base", "--is-ancestor", ancestor, descendant),
            cwd=REPO_DIR,
            check=True,
            capture_output=True,
            text=True,
            timeout=30,
        )
    except subprocess.CalledProcessError as error:
        if error.returncode == 1:
            return False
        raise VG35Error("GIT_ANCESTRY_CHECK_FAILED") from error
    except (OSError, subprocess.SubprocessError) as error:
        raise VG35Error("GIT_ANCESTRY_CHECK_FAILED") from error
    return True


def _external_input_identities(
    protocol: Mapping[str, Any],
    manifest: Mapping[str, Any],
) -> list[JsonObject]:
    source_root = Path(_str(_mapping(protocol, "data"), "sourceCorpusRoot"))
    identities: list[JsonObject] = []
    archives = manifest.get("archives")
    if not isinstance(archives, list):
        raise VG35Error("SOURCE_MANIFEST_ARCHIVES_INVALID")
    for raw_entry in archives:
        if not isinstance(raw_entry, dict):
            raise VG35Error("SOURCE_MANIFEST_ENTRY_INVALID")
        entry = cast(JsonObject, raw_entry)
        for kind in ("archive", "checksum"):
            item = _mapping(entry, kind)
            path = _safe_shared_file(source_root, _str(item, "path"))
            identities.append(
                {
                    "kind": kind,
                    "symbol": _str(entry, "symbol"),
                    "month": _str(entry, "month"),
                    "path": _str(item, "path"),
                    "url": _str(item, "url"),
                    "sha256": _sha256_path(path),
                    "bytes": path.stat().st_size,
                    "headers": item.get("headers"),
                    "retrievedAtUtc": item.get("retrievedAtUtc"),
                }
            )
    custody_path = Path(_str(_mapping(protocol, "data"), "sharedCustodyManifest"))
    identities.append(
        {
            "kind": "sharedCustodyManifest",
            "path": str(custody_path),
            "url": None,
            "sha256": _sha256_path(custody_path),
            "bytes": custody_path.stat().st_size,
            "headers": None,
            "retrievedAtUtc": None,
        }
    )
    return identities


def _verify_external_inputs(
    protocol: Mapping[str, Any],
    manifest: Mapping[str, Any],
    freeze_object: Mapping[str, Any],
) -> None:
    current = _external_input_identities(protocol, manifest)
    if freeze_object.get("externalInputs") != current:
        raise VG35Error("FREEZE_EXTERNAL_INPUT_BINDING_MISMATCH")


def _uv_version() -> str:
    try:
        completed = subprocess.run(
            ("uv", "--version"),
            check=True,
            capture_output=True,
            text=True,
            timeout=10,
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise VG35Error("UV_RUNTIME_IDENTITY_UNAVAILABLE") from error
    return completed.stdout.strip()


def _median_decimal(values: Iterable[Decimal]) -> Decimal:
    ordered = sorted(values)
    if not ordered:
        raise MeasurementError("EMPTY_MEDIAN")
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) / 2


def _rounded(value: float) -> float:
    if not math.isfinite(value):
        raise MeasurementError("NON_FINITE_RESULT")
    return round(value, 12)


def _utc_now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _parse_args(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "phase",
        choices=("bind-sources", "freeze", "run", "hashes", "verify"),
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    """Run one explicit lifecycle phase."""

    arguments = _parse_args(argv)
    functions = {
        "bind-sources": bind_sources,
        "freeze": freeze,
        "run": run,
        "hashes": hashes,
        "verify": verify,
    }
    try:
        result = functions[arguments.phase]()
    except VG35Error as error:
        print(json.dumps({"status": "ERROR", "reason": str(error)}, sort_keys=True))
        return 2
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
