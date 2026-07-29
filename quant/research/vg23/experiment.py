#!/usr/bin/env python3.13
"""Sealed V-G23 public Spot abnormal-volume-breadth allocation experiment."""

from __future__ import annotations

import argparse
import contextlib
import csv
import hashlib
import io
import itertools
import json
import math
import os
import platform
import random
import re
import statistics
import subprocess
import sys
import tempfile
import zipfile
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any, Final

PACKET_DIR: Final = Path(__file__).resolve().parent
PROTOCOL_PATH: Final = PACKET_DIR / "protocol.v1.json"
SOURCE_RESEARCH_PATH: Final = PACKET_DIR / "OFFICIAL_SOURCE_RESEARCH.md"
VERIFIER_PATH: Final = PACKET_DIR / "verify.py"
FREEZE_PATH: Final = PACKET_DIR / "freeze.v1.json"
RESULT_PATH: Final = PACKET_DIR / "result.v1.json"
RUN_RECEIPT_PATH: Final = PACKET_DIR / "run-receipt.v1.json"
CHECKSUMS_PATH: Final = PACKET_DIR / "SHA256SUMS"
DEFAULT_SOURCE_ROOT: Final = Path("/private/tmp/cosmos-s1f-weekly-momentum-cash-v1")
DEFAULT_STATE_ROOT: Final = Path("/private/tmp/cosmos-vg23-abnormal-volume-breadth-1be1-a780")
TERMINAL_CORE_FILENAME: Final = "terminal-result-core.v1.json"
DAY_US: Final = 86_400_000_000
SYMBOL_RE: Final = re.compile(r"^[A-Z0-9]+USDT$")
TRIAL_RE: Final = re.compile(r"^A(150|200)_S(20|35|50)$")
SCENARIOS: Final = ("PUBLIC_GROSS", "PUBLIC_BASE", "PUBLIC_STRESS", "FEE_STRESS")
RISK_SLEEVE: Final = ("BTCUSDT", "ETHUSDT")
STATIC_FREEZE_PATHS: Final = (
    "quant/research/vg23/OFFICIAL_SOURCE_RESEARCH.md",
    "quant/research/vg23/README.md",
    "quant/research/vg23/experiment.py",
    "quant/research/vg23/protocol.v1.json",
    "quant/research/vg23/test_experiment.py",
    "quant/research/vg23/verify.py",
)


class EvidenceError(RuntimeError):
    """Fail-closed evidence or lifecycle error."""


class CustodyError(EvidenceError):
    """Checksum, byte-binding, or source-custody error."""


class ArchiveSchemaError(EvidenceError):
    """Checksum-valid archive that cannot furnish a valid causal history."""


class SelectedEvidenceError(EvidenceError):
    """A selected position lacks an entry, mark, or exit needed by the protocol."""


@dataclass(frozen=True)
class Bar:
    day: date
    open_price: float
    close_price: float
    quote_volume: float


@dataclass(frozen=True)
class TrialSpec:
    trial_id: str
    abnormal_multiple: float
    saturation_breadth: float


@dataclass(frozen=True)
class Scenario:
    name: str
    fee_rate: float
    adverse_rate: float


@dataclass(frozen=True)
class Formation:
    entry_day: date
    cutoff_day: date
    valid: bool
    invalid_reason: str | None
    eligible_symbols: tuple[str, ...]
    abnormal_ratios: Mapping[str, float]
    liquidity: Mapping[str, float]


@dataclass
class Fill:
    day: date
    symbol: str
    side: str
    reference_notional: float
    executed_notional: float
    fee_usd: float
    adverse_usd: float
    participation_bps: float | None


@dataclass
class Simulation:
    scenario: str
    trial_id: str
    benchmark: bool
    scheduled_formations: int
    valid_formations: int
    invalid_formations: list[dict[str, str]]
    holding_spells: int
    distinct_symbols: set[str]
    fills: list[Fill]
    daily_nav: list[tuple[date, float]]
    daily_returns: list[tuple[date, float]]
    weekly_returns: list[tuple[date, float]]
    breadth_observations: list[float]
    target_exposures: list[float]
    gross_by_symbol: dict[str, float]
    gross_by_spell: list[float]
    terminal_nav: float


def sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def sha256_path(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def canonical_bytes(value: object) -> bytes:
    return (
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True) + "\n"
    ).encode()


def load_json(path: Path) -> tuple[dict[str, Any], bytes]:
    if path.is_symlink() or not path.is_file():
        raise CustodyError(f"required regular file unavailable: {path}")
    raw = path.read_bytes()
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as error:
        raise CustodyError(f"invalid JSON: {path.name}") from error
    if not isinstance(value, dict):
        raise CustodyError(f"JSON root is not an object: {path.name}")
    return value, raw


def write_exclusive(path: Path, raw: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() or path.is_symlink():
        raise EvidenceError(f"refusing to overwrite sealed artifact: {path}")
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
    except BaseException:
        with contextlib.suppress(OSError):
            path.unlink(missing_ok=True)
        raise


def write_atomic(path: Path, raw: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary_path = Path(temporary)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_path, path)
    finally:
        temporary_path.unlink(missing_ok=True)


def utc_now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def script_sha() -> str:
    return sha256_path(Path(__file__).resolve())


def git_text(*arguments: str) -> str:
    try:
        completed = subprocess.run(
            ("git", *arguments),
            cwd=PACKET_DIR,
            check=True,
            capture_output=True,
            text=True,
        )
    except (OSError, subprocess.CalledProcessError) as error:
        raise CustodyError(f"Git evidence unavailable: {' '.join(arguments)}") from error
    return completed.stdout.strip()


def code_freeze_lineage() -> dict[str, Any]:
    if git_text("status", "--porcelain"):
        raise CustodyError("worktree must be clean before metadata freeze")
    commit = git_text("rev-parse", "HEAD")
    parent = git_text("rev-parse", "HEAD^")
    tree = git_text("rev-parse", "HEAD^{tree}")
    paths = tuple(
        line
        for line in git_text(
            "diff", "--name-only", "a169b123fb186d1943a75ad648552c4d95be1be1..HEAD"
        ).splitlines()
        if line
    )
    if parent != "a169b123fb186d1943a75ad648552c4d95be1be1":
        raise CustodyError("code freeze must be a direct child of canonical base")
    if paths != STATIC_FREEZE_PATHS:
        raise CustodyError("code freeze path set differs from exclusive static scope")
    return {
        "codeFreezeCommit": commit,
        "codeFreezeParent": parent,
        "codeFreezeTree": tree,
        "codeFreezePaths": list(paths),
        "codeFreezePathsSha256": sha256_bytes(("\n".join(paths) + "\n").encode()),
    }


def source_freeze_lineage(freeze_payload: Mapping[str, Any]) -> dict[str, str]:
    if git_text("status", "--porcelain"):
        raise CustodyError("worktree must be clean before sole run")
    code_commit = require_text(freeze_payload.get("codeFreezeCommit"), "codeFreezeCommit")
    commit = git_text("rev-parse", "HEAD")
    parent = git_text("rev-parse", "HEAD^")
    tree = git_text("rev-parse", "HEAD^{tree}")
    paths = tuple(
        line
        for line in git_text("diff", "--name-only", f"{code_commit}..{commit}").splitlines()
        if line
    )
    if parent != code_commit or paths != ("quant/research/vg23/freeze.v1.json",):
        raise CustodyError("source freeze must be one direct metadata-only successor")
    return {"sourceFreezeCommit": commit, "sourceFreezeTree": tree}


def text_number(value: float | int, places: int = 8) -> str:
    if not math.isfinite(float(value)):
        raise EvidenceError("non-finite public number")
    rendered = f"{float(value):.{places}f}".rstrip("0").rstrip(".")
    return rendered if rendered not in {"", "-0"} else "0"


def require_dict(value: object, field: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise CustodyError(f"{field} must be an object")
    return value


def require_list(value: object, field: str) -> list[Any]:
    if not isinstance(value, list):
        raise CustodyError(f"{field} must be an array")
    return value


def require_text(value: object, field: str) -> str:
    if not isinstance(value, str) or not value:
        raise CustodyError(f"{field} must be nonempty text")
    return value


def require_int(value: object, field: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise CustodyError(f"{field} must be an integer")
    return value


def month_range(first: str, last: str) -> tuple[str, ...]:
    start_year, start_month = (int(part) for part in first.split("-"))
    end_year, end_month = (int(part) for part in last.split("-"))
    values: list[str] = []
    year, month = start_year, start_month
    while (year, month) <= (end_year, end_month):
        values.append(f"{year:04d}-{month:02d}")
        month += 1
        if month == 13:
            year += 1
            month = 1
    return tuple(values)


def date_range(first: date, last: date) -> tuple[date, ...]:
    values: list[date] = []
    current = first
    while current <= last:
        values.append(current)
        current += timedelta(days=1)
    return tuple(values)


def weekly_dates(first: date, last: date) -> tuple[date, ...]:
    values: list[date] = []
    current = first
    while current <= last:
        values.append(current)
        current += timedelta(days=7)
    return tuple(values)


def load_protocol() -> tuple[dict[str, Any], str]:
    protocol, raw = load_json(PROTOCOL_PATH)
    if protocol.get("schema") != "VG23AbnormalVolumeBreadthProtocolV1":
        raise CustodyError("protocol schema mismatch")
    if protocol.get("canonicalBaseCommit") != ("a169b123fb186d1943a75ad648552c4d95be1be1"):
        raise CustodyError("protocol canonical base mismatch")
    trials = require_dict(protocol.get("trials"), "trials")
    ids = require_list(trials.get("trialIds"), "trials.trialIds")
    expected_ids = [
        "A150_S20",
        "A150_S35",
        "A150_S50",
        "A200_S20",
        "A200_S35",
        "A200_S50",
    ]
    if ids != expected_ids or trials.get("attemptedCount") != 6:
        raise CustodyError("frozen six-trial family mismatch")
    if any(not isinstance(value, str) or not TRIAL_RE.fullmatch(value) for value in ids):
        raise CustodyError("trial identifier malformed")
    calendar = require_dict(protocol.get("calendar"), "calendar")
    measurement = require_dict(calendar.get("measurementWindow"), "measurementWindow")
    if (
        measurement.get("startInclusive") != "2025-07-01"
        or measurement.get("endExclusive") != "2026-07-01"
        or measurement.get("completeCalendarMonths") != 12
    ):
        raise CustodyError("measurement window drift")
    data = require_dict(protocol.get("data"), "data")
    if (
        data.get("sharedSourceMode") != "READ_ONLY"
        or data.get("interval") != "1d"
        or data.get("developmentSchemaOnlySupportAuditBeforeFreeze")
        != "DISCLOSED_AND_LIMITED_TO_SCHEMA_NO_PRICE_OR_VOLUME_OUTCOMES_RETAINED"
        or data.get("economicOutcomeFieldAccessBeforeFreeze") != "FORBIDDEN_AND_NOT_OBSERVED"
        or data.get("vg23EvaluatorArchiveBodyOpenBeforeFreeze") != "FORBIDDEN_AND_NOT_OBSERVED"
        or data.get("vg23EvaluatorHoldoutArchiveBodyOpenBeforeCandidateSeal")
        != "FORBIDDEN_AND_NOT_OBSERVED"
    ):
        raise CustodyError("source mode or interval drift")
    cross_lane = require_dict(protocol.get("crossLaneHoldout"), "crossLaneHoldout")
    if (
        cross_lane.get("globalVolumeFamilyHoldoutStatus") != "NOT_CERTIFIED_SHARED_REUSE_RISK"
        or cross_lane.get("consumerAdjustedPValue") != "1"
        or cross_lane.get("verifiedPositiveEligible") is not False
    ):
        raise CustodyError("cross-lane holdout disclosure drift")
    run_control = require_dict(protocol.get("runControl"), "runControl")
    if (
        run_control.get("stateRoot") != str(DEFAULT_STATE_ROOT)
        or run_control.get("pythonExact") != platform.python_version()
        or run_control.get("pythonCommand") != "python3.13"
        or run_control.get("pythonHashSeed") != "0"
        or os.environ.get("PYTHONHASHSEED") != "0"
        or run_control.get("allowedRunCount") != 1
        or run_control.get("allowedHoldoutOpenCount") != 1
        or run_control.get("networkDuringEvaluation") is not False
        or run_control.get("dataFreeFinalizeAllowedAfterConsumedRun") is not True
        or run_control.get("finalizeReopensArchives") is not False
        or run_control.get("terminalResultCoreBeforeReceipt") is not True
    ):
        raise CustodyError("run-control drift")
    return protocol, sha256_bytes(raw)


def artifact_lookup(manifest: Mapping[str, Any]) -> dict[tuple[str, str], Mapping[str, Any]]:
    rows = require_list(manifest.get("artifactPairs"), "artifactPairs")
    result: dict[tuple[str, str], Mapping[str, Any]] = {}
    previous: tuple[str, str] | None = None
    for raw in rows:
        if not isinstance(raw, dict):
            raise CustodyError("artifact row is not an object")
        symbol = require_text(raw.get("symbol"), "artifact.symbol")
        month = require_text(raw.get("month"), "artifact.month")
        key = (symbol, month)
        if previous is not None and key <= previous:
            raise CustodyError("artifact rows are not strictly sorted unique")
        previous = key
        result[key] = raw
    if manifest.get("artifactPairCount") != len(result):
        raise CustodyError("artifact pair count mismatch")
    return result


def normalized_inventory_digest(
    lookup: Mapping[tuple[str, str], Mapping[str, Any]],
    symbols: Sequence[str],
    months: Sequence[str],
) -> tuple[str, int, int]:
    lines: list[str] = []
    absent = 0
    for symbol in symbols:
        for month in months:
            row = lookup.get((symbol, month))
            if row is None:
                absent += 1
                continue
            line = "|".join(
                (
                    symbol,
                    month,
                    require_text(row.get("zipSha256"), "artifact.zipSha256"),
                    require_text(row.get("checksumSha256"), "artifact.checksumSha256"),
                    str(require_int(row.get("zipBytes"), "artifact.zipBytes")),
                    str(require_int(row.get("checksumBytes"), "artifact.checksumBytes")),
                )
            )
            lines.append(line)
    raw = ("\n".join(lines) + ("\n" if lines else "")).encode()
    return sha256_bytes(raw), len(lines), absent


def validate_source_manifests(
    source_root: Path,
    protocol: Mapping[str, Any],
) -> tuple[
    dict[str, Any],
    bytes,
    dict[str, Any],
    bytes,
    tuple[str, ...],
    dict[tuple[str, str], Mapping[str, Any]],
]:
    if source_root.is_symlink() or not source_root.is_dir():
        raise CustodyError("shared source root must be a real directory")
    discovery, discovery_raw = load_json(source_root / "discovery.v1.json")
    acquisition, acquisition_raw = load_json(source_root / "acquisition-manifest.v1.json")
    if discovery.get("schema") != "S1FArchiveDiscoveryV1":
        raise CustodyError("shared discovery schema mismatch")
    if discovery.get("state") != "METADATA_ONLY_NO_ARCHIVE_BODY_OPENED":
        raise CustodyError("shared discovery state mismatch")
    if acquisition.get("schema") != "S1FAcquisitionManifestV1":
        raise CustodyError("shared acquisition schema mismatch")
    if acquisition.get("state") != "CHECKSUM_VERIFIED_ARCHIVES_NOT_DECOMPRESSED":
        raise CustodyError("shared acquisition state mismatch")
    if acquisition.get("discoverySha256") != sha256_bytes(discovery_raw):
        raise CustodyError("shared acquisition does not bind discovery bytes")
    if acquisition.get("archiveBodiesDecompressed") is not False:
        raise CustodyError("shared acquisition custody declaration drift")
    universe = require_dict(discovery.get("universe"), "discovery.universe")
    symbols_raw = require_list(universe.get("symbols"), "discovery.universe.symbols")
    if not all(isinstance(symbol, str) and SYMBOL_RE.fullmatch(symbol) for symbol in symbols_raw):
        raise CustodyError("archive-discovered universe contains malformed symbol")
    symbols = tuple(symbols_raw)
    if tuple(sorted(set(symbols))) != symbols:
        raise CustodyError("archive-discovered universe is not sorted unique")
    joined = ("\n".join(symbols) + "\n").encode()
    if universe.get("count") != len(symbols) or universe.get("sha256") != sha256_bytes(joined):
        raise CustodyError("archive-discovered universe digest mismatch")
    lookup = artifact_lookup(acquisition)
    data = require_dict(protocol.get("data"), "data")
    target = month_range(
        require_list(data.get("targetMonthsInclusive"), "targetMonthsInclusive")[0],
        require_list(data.get("targetMonthsInclusive"), "targetMonthsInclusive")[1],
    )
    discovered_months = require_list(discovery.get("targetMonths"), "discovery.targetMonths")
    if not set(target).issubset(set(discovered_months)):
        raise CustodyError("V-G23 target months are not covered by shared discovery")
    return discovery, discovery_raw, acquisition, acquisition_raw, symbols, lookup


def runtime_binding() -> dict[str, str]:
    return {
        "python": platform.python_version(),
        "implementation": platform.python_implementation(),
        "platform": platform.platform(),
        "hashSeed": os.environ.get("PYTHONHASHSEED", "UNSET"),
    }


def resolved_existing_directory(path: Path, field: str) -> Path:
    if path.is_symlink() or not path.is_dir():
        raise CustodyError(f"{field} must be a real directory")
    return path.resolve(strict=True)


def enforce_source_root(protocol: Mapping[str, Any], source_root: Path) -> Path:
    data = require_dict(protocol.get("data"), "data")
    expected_text = require_text(data.get("sharedSourceRoot"), "data.sharedSourceRoot")
    expected = resolved_existing_directory(Path(expected_text), "protocol shared source root")
    actual = resolved_existing_directory(source_root, "requested shared source root")
    constant = resolved_existing_directory(DEFAULT_SOURCE_ROOT, "evaluator shared source root")
    if actual != expected or actual != constant:
        raise CustodyError("shared source root differs from frozen protocol/evaluator path")
    return actual


def enforce_state_root(protocol: Mapping[str, Any], state_root: Path) -> Path:
    run_control = require_dict(protocol.get("runControl"), "runControl")
    expected = Path(require_text(run_control.get("stateRoot"), "runControl.stateRoot"))
    normalized_expected = Path(os.path.abspath(expected))
    normalized_actual = Path(os.path.abspath(state_root))
    normalized_constant = Path(os.path.abspath(DEFAULT_STATE_ROOT))
    if normalized_actual != normalized_expected or normalized_actual != normalized_constant:
        raise CustodyError("state root differs from frozen protocol/evaluator path")
    return normalized_actual


def freeze(source_root: Path) -> dict[str, Any]:
    if FREEZE_PATH.exists():
        raise EvidenceError(f"freeze already exists: {FREEZE_PATH}")
    if RESULT_PATH.exists() or CHECKSUMS_PATH.exists():
        raise EvidenceError("terminal packet artifact already exists")
    lineage = code_freeze_lineage()
    protocol, protocol_sha = load_protocol()
    source_root = enforce_source_root(protocol, source_root)
    (
        discovery,
        discovery_raw,
        acquisition,
        acquisition_raw,
        symbols,
        lookup,
    ) = validate_source_manifests(source_root, protocol)
    data = require_dict(protocol["data"], "data")
    months_value = require_list(data["targetMonthsInclusive"], "targetMonthsInclusive")
    months = month_range(str(months_value[0]), str(months_value[1]))
    inventory_sha, pair_count, absent_count = normalized_inventory_digest(lookup, symbols, months)
    payload: dict[str, Any] = {
        "schema": "VG23FreezeV1",
        "state": "FROZEN_BEFORE_ANY_VG23_ECONOMIC_OUTCOME_ACCESS",
        "frozenAtUtc": utc_now(),
        "canonicalBaseCommit": protocol["canonicalBaseCommit"],
        **lineage,
        "protocolSha256": protocol_sha,
        "evaluatorSha256": script_sha(),
        "verifierSha256": sha256_path(VERIFIER_PATH),
        "officialSourceResearchSha256": sha256_path(SOURCE_RESEARCH_PATH),
        "sourceRoot": str(source_root),
        "sourceMode": "READ_ONLY",
        "sharedDiscoverySha256": sha256_bytes(discovery_raw),
        "sharedAcquisitionSha256": sha256_bytes(acquisition_raw),
        "sharedDiscoveryObservedAtUtc": discovery.get("observedAtUtc"),
        "sharedAcquisitionCompletedAtUtc": acquisition.get("completedAtUtc"),
        "sharedArtifactRowsSha256": acquisition.get("artifactRowsSha256"),
        "candidateUniverse": list(symbols),
        "candidateUniverseCount": len(symbols),
        "candidateUniverseSha256": sha256_bytes(("\n".join(symbols) + "\n").encode()),
        "targetMonths": list(months),
        "targetArtifactInventorySha256": inventory_sha,
        "targetArtifactPairCount": pair_count,
        "targetAbsentPairCount": absent_count,
        "trialIds": require_list(
            require_dict(protocol["trials"], "trials")["trialIds"], "trialIds"
        ),
        "costScenarios": {
            name: require_dict(require_dict(protocol["costs"], "costs")[name], name)
            for name in SCENARIOS
        },
        "bootstrap": require_dict(
            require_dict(protocol["statistics"], "statistics")["bootstrap"], "bootstrap"
        ),
        "runtime": runtime_binding(),
        "archiveBodiesOpenedByVG23Evaluator": False,
        "developmentSchemaOnlyPrefreezeAuditObserved": True,
        "developmentSchemaOnlyPrefreezeAuditScope": (
            "DEVELOPMENT_MONTHS_ONLY_NO_PRICE_OR_VOLUME_OUTCOMES_RETAINED"
        ),
        "economicOutcomeFieldsAccessedByVG23BeforeFreeze": False,
        "holdoutArchiveBodiesOpenedByVG23": False,
    }
    write_exclusive(FREEZE_PATH, canonical_bytes(payload))
    return payload


def load_frozen(
    source_root: Path | None = None,
) -> tuple[
    dict[str, Any],
    dict[str, Any],
    dict[str, Any],
    tuple[str, ...],
    dict[tuple[str, str], Mapping[str, Any]],
    dict[str, str],
]:
    protocol, protocol_sha = load_protocol()
    freeze_payload, freeze_raw = load_json(FREEZE_PATH)
    if freeze_payload.get("schema") != "VG23FreezeV1":
        raise CustodyError("freeze schema mismatch")
    expected_root = enforce_source_root(
        protocol,
        Path(require_text(freeze_payload.get("sourceRoot"), "freeze.sourceRoot")),
    )
    if source_root is not None and enforce_source_root(protocol, source_root) != expected_root:
        raise CustodyError("requested source root differs from frozen source root")
    if freeze_payload.get("sourceMode") != "READ_ONLY":
        raise CustodyError("freeze source mode drift")
    if freeze_payload.get("protocolSha256") != protocol_sha:
        raise CustodyError("protocol bytes changed after freeze")
    if freeze_payload.get("evaluatorSha256") != script_sha():
        raise CustodyError("evaluator bytes changed after freeze")
    if freeze_payload.get("verifierSha256") != sha256_path(VERIFIER_PATH):
        raise CustodyError("verifier bytes changed after freeze")
    if freeze_payload.get("officialSourceResearchSha256") != sha256_path(SOURCE_RESEARCH_PATH):
        raise CustodyError("official-source note changed after freeze")
    frozen_runtime = require_dict(freeze_payload.get("runtime"), "freeze.runtime")
    current_runtime = runtime_binding()
    for field in ("python", "implementation", "hashSeed"):
        if frozen_runtime.get(field) != current_runtime[field]:
            raise CustodyError(f"runtime binding changed after freeze: {field}")
    (
        _discovery,
        discovery_raw,
        acquisition,
        acquisition_raw,
        symbols,
        lookup,
    ) = validate_source_manifests(expected_root, protocol)
    if freeze_payload.get("sharedDiscoverySha256") != sha256_bytes(discovery_raw):
        raise CustodyError("shared discovery bytes changed after freeze")
    if freeze_payload.get("sharedAcquisitionSha256") != sha256_bytes(acquisition_raw):
        raise CustodyError("shared acquisition bytes changed after freeze")
    if freeze_payload.get("candidateUniverse") != list(symbols):
        raise CustodyError("candidate universe changed after freeze")
    months = tuple(require_list(freeze_payload.get("targetMonths"), "freeze.targetMonths"))
    inventory_sha, pair_count, absent_count = normalized_inventory_digest(lookup, symbols, months)
    if (
        freeze_payload.get("targetArtifactInventorySha256") != inventory_sha
        or freeze_payload.get("targetArtifactPairCount") != pair_count
        or freeze_payload.get("targetAbsentPairCount") != absent_count
    ):
        raise CustodyError("target artifact inventory changed after freeze")
    bindings = {
        "protocolSha256": protocol_sha,
        "freezeSha256": sha256_bytes(freeze_raw),
        "evaluatorSha256": script_sha(),
        "verifierSha256": sha256_path(VERIFIER_PATH),
        "officialSourceResearchSha256": sha256_path(SOURCE_RESEARCH_PATH),
        "sharedDiscoverySha256": sha256_bytes(discovery_raw),
        "sharedAcquisitionSha256": sha256_bytes(acquisition_raw),
        "targetArtifactInventorySha256": inventory_sha,
    }
    return protocol, freeze_payload, acquisition, symbols, lookup, bindings


def parse_timestamp(value: str, symbol: str, month: str) -> datetime:
    try:
        integer = int(value)
    except ValueError as error:
        raise ArchiveSchemaError(f"timestamp malformed: {symbol} {month}") from error
    if integer < 1_000_000_000_000_000:
        raise ArchiveSchemaError(f"post-2025 timestamp is not microseconds: {symbol} {month}")
    seconds, micros = divmod(integer, 1_000_000)
    try:
        return datetime.fromtimestamp(seconds, tz=UTC).replace(microsecond=micros)
    except (OverflowError, OSError, ValueError) as error:
        raise ArchiveSchemaError(f"timestamp outside UTC range: {symbol} {month}") from error


def positive_float(value: str, field: str, symbol: str, month: str) -> float:
    try:
        parsed = float(value)
    except ValueError as error:
        raise ArchiveSchemaError(f"{field} malformed: {symbol} {month}") from error
    if not math.isfinite(parsed) or parsed <= 0:
        raise ArchiveSchemaError(f"{field} is not positive: {symbol} {month}")
    return parsed


def nonnegative_float(value: str, field: str, symbol: str, month: str) -> float:
    try:
        parsed = float(value)
    except ValueError as error:
        raise ArchiveSchemaError(f"{field} malformed: {symbol} {month}") from error
    if not math.isfinite(parsed) or parsed < 0:
        raise ArchiveSchemaError(f"{field} is negative/non-finite: {symbol} {month}")
    return parsed


def verify_sidecar(sidecar_raw: bytes, zip_name: str, archive_raw: bytes) -> None:
    try:
        parts = sidecar_raw.decode("ascii").strip().split()
    except UnicodeDecodeError as error:
        raise CustodyError(f"checksum sidecar is not ASCII: {zip_name}") from error
    if len(parts) != 2 or parts[1] != zip_name or not re.fullmatch(r"[0-9a-fA-F]{64}", parts[0]):
        raise CustodyError(f"checksum sidecar shape mismatch: {zip_name}")
    if parts[0].lower() != sha256_bytes(archive_raw):
        raise CustodyError(f"official checksum mismatch: {zip_name}")


def parse_archive(
    source_root: Path,
    row: Mapping[str, Any],
    symbol: str,
    month: str,
) -> tuple[Bar, ...]:
    zip_name = f"{symbol}-1d-{month}.zip"
    directory = source_root / "archives" / symbol / month
    archive_path = directory / zip_name
    sidecar_path = directory / f"{zip_name}.CHECKSUM"
    if archive_path.is_symlink() or sidecar_path.is_symlink():
        raise CustodyError(f"archive pair may not be symlinked: {symbol} {month}")
    archive_raw = archive_path.read_bytes()
    sidecar_raw = sidecar_path.read_bytes()
    if len(archive_raw) != require_int(row.get("zipBytes"), "artifact.zipBytes"):
        raise CustodyError(f"archive byte length changed: {symbol} {month}")
    if len(sidecar_raw) != require_int(row.get("checksumBytes"), "artifact.checksumBytes"):
        raise CustodyError(f"sidecar byte length changed: {symbol} {month}")
    if sha256_bytes(archive_raw) != require_text(row.get("zipSha256"), "artifact.zipSha256"):
        raise CustodyError(f"archive digest changed: {symbol} {month}")
    if sha256_bytes(sidecar_raw) != require_text(
        row.get("checksumSha256"), "artifact.checksumSha256"
    ):
        raise CustodyError(f"sidecar digest changed: {symbol} {month}")
    verify_sidecar(sidecar_raw, zip_name, archive_raw)
    try:
        archive = zipfile.ZipFile(io.BytesIO(archive_raw))
    except zipfile.BadZipFile as error:
        raise ArchiveSchemaError(f"invalid ZIP: {symbol} {month}") from error
    with archive:
        members = archive.infolist()
        expected_csv = f"{symbol}-1d-{month}.csv"
        if (
            len(members) != 1
            or members[0].filename != expected_csv
            or members[0].is_dir()
            or members[0].file_size > 2_000_000
        ):
            raise ArchiveSchemaError(f"ZIP member contract mismatch: {symbol} {month}")
        csv_raw = archive.read(members[0])
    try:
        rows = csv.reader(io.StringIO(csv_raw.decode("utf-8"), newline=""))
    except UnicodeDecodeError as error:
        raise ArchiveSchemaError(f"archive CSV is not UTF-8: {symbol} {month}") from error
    bars: list[Bar] = []
    previous: date | None = None
    for row_index, csv_row in enumerate(rows):
        if (
            row_index == 0
            and csv_row
            and csv_row[0].strip().lower()
            in {
                "open_time",
                "opentime",
            }
        ):
            continue
        if len(csv_row) != 12:
            raise ArchiveSchemaError(f"archive row has {len(csv_row)} columns: {symbol} {month}")
        opened = parse_timestamp(csv_row[0], symbol, month)
        closed = parse_timestamp(csv_row[6], symbol, month)
        if opened.time() != datetime.min.time() or opened.strftime("%Y-%m") != month:
            raise ArchiveSchemaError(f"daily open/month invalid: {symbol} {month}")
        delta_us = int(csv_row[6]) - int(csv_row[0])
        if delta_us != DAY_US - 1 or closed.date() != opened.date():
            raise ArchiveSchemaError(f"daily close boundary invalid: {symbol} {month}")
        open_price = positive_float(csv_row[1], "open", symbol, month)
        high = positive_float(csv_row[2], "high", symbol, month)
        low = positive_float(csv_row[3], "low", symbol, month)
        close_price = positive_float(csv_row[4], "close", symbol, month)
        quote_volume = nonnegative_float(csv_row[7], "quote volume", symbol, month)
        if low > min(open_price, close_price) or high < max(open_price, close_price):
            raise ArchiveSchemaError(f"OHLC geometry invalid: {symbol} {month}")
        day = opened.date()
        if previous is not None and day <= previous:
            raise ArchiveSchemaError(f"archive days not increasing: {symbol} {month}")
        previous = day
        bars.append(Bar(day, open_price, close_price, quote_volume))
    if not bars:
        raise ArchiveSchemaError(f"archive has no daily rows: {symbol} {month}")
    return tuple(bars)


def load_bars(
    source_root: Path,
    lookup: Mapping[tuple[str, str], Mapping[str, Any]],
    symbols: Sequence[str],
    months: Sequence[str],
) -> tuple[dict[str, dict[date, Bar]], list[dict[str, str]]]:
    output: dict[str, dict[date, Bar]] = {}
    issues: list[dict[str, str]] = []
    for symbol in symbols:
        series: dict[date, Bar] = {}
        for month in months:
            row = lookup.get((symbol, month))
            if row is None:
                continue
            try:
                parsed = parse_archive(source_root, row, symbol, month)
            except ArchiveSchemaError as error:
                issues.append(
                    {
                        "symbol": symbol,
                        "month": month,
                        "reason": str(error),
                        "disposition": "CAUSALLY_INELIGIBLE_UNTIL_COMPLETE_HISTORY_RESTORED",
                    }
                )
                continue
            for bar in parsed:
                if bar.day in series:
                    raise CustodyError(f"duplicate bar across archives: {symbol} {bar.day}")
                series[bar.day] = bar
        if series:
            output[symbol] = series
    return output, issues


def merge_bars(
    destination: dict[str, dict[date, Bar]],
    incoming: Mapping[str, Mapping[date, Bar]],
) -> None:
    for symbol, rows in incoming.items():
        target = destination.setdefault(symbol, {})
        overlap = set(target) & set(rows)
        if overlap:
            raise CustodyError(f"development/holdout bar overlap: {symbol} {min(overlap)}")
        target.update(rows)


def complete_window(
    series: Mapping[date, Bar],
    first: date,
    last: date,
    *,
    require_positive_volume: bool,
) -> tuple[Bar, ...] | None:
    values: list[Bar] = []
    for day in date_range(first, last):
        bar = series.get(day)
        if bar is None or (require_positive_volume and bar.quote_volume <= 0):
            return None
        values.append(bar)
    return tuple(values)


def liquidity_at(
    bars: Mapping[str, Mapping[date, Bar]],
    symbol: str,
    cutoff: date,
    days: int = 30,
) -> float | None:
    series = bars.get(symbol)
    if series is None:
        return None
    window = complete_window(
        series,
        cutoff - timedelta(days=days - 1),
        cutoff,
        require_positive_volume=True,
    )
    if window is None:
        return None
    return float(statistics.median(bar.quote_volume for bar in window))


def build_formation(
    bars: Mapping[str, Mapping[date, Bar]],
    symbols: Sequence[str],
    entry_day: date,
    minimum_liquidity: float,
    minimum_symbols: int,
) -> Formation:
    cutoff = entry_day - timedelta(days=2)
    eligible: list[str] = []
    liquidity: dict[str, float] = {}
    abnormal_ratios: dict[str, float] = {}
    for symbol in symbols:
        series = bars.get(symbol)
        if series is None:
            continue
        history = complete_window(
            series,
            cutoff - timedelta(days=89),
            cutoff,
            require_positive_volume=True,
        )
        if history is None:
            continue
        median_30 = float(statistics.median(bar.quote_volume for bar in history[-30:]))
        if median_30 < minimum_liquidity:
            continue
        recent_mean = math.fsum(bar.quote_volume for bar in history[-5:]) / 5
        baseline_median = float(statistics.median(bar.quote_volume for bar in history[-65:-5]))
        if recent_mean <= 0 or baseline_median <= 0:
            continue
        eligible.append(symbol)
        liquidity[symbol] = median_30
        abnormal_ratios[symbol] = recent_mean / baseline_median
    eligible.sort()
    if len(eligible) < minimum_symbols:
        return Formation(
            entry_day,
            cutoff,
            False,
            f"ELIGIBLE_SYMBOLS_{len(eligible)}_BELOW_{minimum_symbols}",
            (),
            {},
            liquidity,
        )
    return Formation(
        entry_day,
        cutoff,
        True,
        None,
        tuple(eligible),
        abnormal_ratios,
        liquidity,
    )


def build_formations(
    bars: Mapping[str, Mapping[date, Bar]],
    symbols: Sequence[str],
    entries: Sequence[date],
    protocol: Mapping[str, Any],
) -> tuple[Formation, ...]:
    eligibility = require_dict(
        require_dict(protocol["universe"], "universe")["pointInTimeEligibility"],
        "pointInTimeEligibility",
    )
    minimum_liquidity = float(eligibility["minimumMedianDailyQuoteVolumeUsd"])
    minimum_symbols = int(eligibility["minimumEligibleSymbols"])
    return tuple(
        build_formation(bars, symbols, entry, minimum_liquidity, minimum_symbols)
        for entry in entries
    )


def trial_specs(protocol: Mapping[str, Any]) -> tuple[TrialSpec, ...]:
    trials = require_dict(protocol["trials"], "trials")
    output: list[TrialSpec] = []
    for trial_id in require_list(trials["trialIds"], "trialIds"):
        match = TRIAL_RE.fullmatch(str(trial_id))
        if match is None:
            raise CustodyError("trial ID cannot be decoded")
        output.append(
            TrialSpec(
                str(trial_id),
                int(match.group(1)) / 100,
                int(match.group(2)) / 100,
            )
        )
    return tuple(output)


def scenario(protocol: Mapping[str, Any], name: str) -> Scenario:
    if name not in SCENARIOS:
        raise EvidenceError(f"unknown scenario: {name}")
    row = require_dict(require_dict(protocol["costs"], "costs")[name], name)
    return Scenario(
        name,
        float(row["feeBpsPerFill"]) / 10_000,
        float(row["adverseExecutionBpsPerFill"]) / 10_000,
    )


def breadth_for(formation: Formation, spec: TrialSpec) -> float:
    if not formation.valid or not formation.abnormal_ratios:
        return 0.0
    abnormal = sum(ratio >= spec.abnormal_multiple for ratio in formation.abnormal_ratios.values())
    return abnormal / len(formation.abnormal_ratios)


def exposure_for(formation: Formation, spec: TrialSpec) -> float:
    if not formation.valid:
        return 0.0
    return min(1.0, breadth_for(formation, spec) / spec.saturation_breadth)


def target_weights(
    formations: Sequence[Formation],
    spec: TrialSpec,
    *,
    benchmark: bool,
) -> tuple[dict[str, float], ...]:
    targets: list[dict[str, float]] = []
    for formation in formations:
        if not formation.valid:
            targets.append({})
            continue
        exposure = 1.0 if benchmark else exposure_for(formation, spec)
        targets.append({symbol: exposure / len(RISK_SLEEVE) for symbol in RISK_SLEEVE})
    return tuple(targets)


def bar_or_fail(
    bars: Mapping[str, Mapping[date, Bar]],
    symbol: str,
    day: date,
    field: str,
) -> Bar:
    bar = bars.get(symbol, {}).get(day)
    if bar is None:
        raise SelectedEvidenceError(f"selected {field} missing: {symbol} {day}")
    return bar


def mark_open(
    positions: Mapping[str, float],
    cash: float,
    bars: Mapping[str, Mapping[date, Bar]],
    day: date,
) -> float:
    return cash + math.fsum(
        quantity * bar_or_fail(bars, symbol, day, "open").open_price
        for symbol, quantity in positions.items()
    )


def participation_bps(
    reference_notional: float,
    liquidity: float | None,
) -> float | None:
    if liquidity is None or liquidity <= 0:
        return None
    return reference_notional / liquidity * 10_000


def rebalance(
    *,
    day: date,
    cutoff: date,
    target: Mapping[str, float],
    positions: dict[str, float],
    cash: float,
    bars: Mapping[str, Mapping[date, Bar]],
    cost: Scenario,
    fills: list[Fill],
    liquidate: bool = False,
) -> tuple[dict[str, float], float]:
    if any(weight < 0 or not math.isfinite(weight) for weight in target.values()):
        raise EvidenceError("target weights must be finite and nonnegative")
    target_weight = math.fsum(target.values())
    if target_weight > 1 + 1e-12:
        raise EvidenceError("target weights exceed unlevered capital")
    all_symbols = sorted(set(positions) | set(target))
    prices = {
        symbol: bar_or_fail(bars, symbol, day, "rebalance open").open_price
        for symbol in all_symbols
    }
    pre_nav = cash + math.fsum(positions[symbol] * prices[symbol] for symbol in positions)
    desired = {
        symbol: (pre_nav * target.get(symbol, 0.0) / prices[symbol] if not liquidate else 0.0)
        for symbol in all_symbols
    }
    for symbol in all_symbols:
        current = positions.get(symbol, 0.0)
        quantity = max(0.0, current - desired[symbol])
        reference = quantity * prices[symbol]
        if reference <= 1e-10:
            continue
        executed = reference * (1 - cost.adverse_rate)
        fee = executed * cost.fee_rate
        cash += executed - fee
        remaining = current - quantity
        if remaining <= 1e-14:
            positions.pop(symbol, None)
        else:
            positions[symbol] = remaining
        liquidity = liquidity_at(bars, symbol, cutoff)
        capacity_notional = max(reference, executed)
        fills.append(
            Fill(
                day,
                symbol,
                "SELL",
                reference,
                executed,
                fee,
                reference * cost.adverse_rate,
                participation_bps(capacity_notional, liquidity),
            )
        )
    buy_needs: list[tuple[str, float]] = []
    for symbol in sorted(target):
        current = positions.get(symbol, 0.0)
        needed = max(0.0, desired[symbol] - current)
        reference = needed * prices[symbol]
        if reference > 1e-10:
            buy_needs.append((symbol, reference))
    required_cash = math.fsum(reference for _, reference in buy_needs)
    scale = min(1.0, cash / required_cash) if required_cash > 0 else 1.0
    for symbol, requested_reference in buy_needs:
        reference = requested_reference * scale
        executed = reference / (1 + cost.adverse_rate)
        fee = executed * cost.fee_rate
        cash -= reference
        positions[symbol] = positions.get(symbol, 0.0) + (
            executed * (1 - cost.fee_rate) / prices[symbol]
        )
        liquidity = liquidity_at(bars, symbol, cutoff)
        capacity_notional = max(reference, executed)
        fills.append(
            Fill(
                day,
                symbol,
                "BUY",
                reference,
                executed,
                fee,
                reference - executed,
                participation_bps(capacity_notional, liquidity),
            )
        )
    if cash < -1e-7:
        raise EvidenceError("rebalance produced negative cash")
    if abs(cash) < 1e-10:
        cash = 0.0
    return positions, cash


def simulation(
    *,
    bars: Mapping[str, Mapping[date, Bar]],
    formations: Sequence[Formation],
    spec: TrialSpec,
    cost: Scenario,
    benchmark: bool,
) -> Simulation:
    targets = target_weights(formations, spec, benchmark=benchmark)
    entries = tuple(formation.entry_day for formation in formations)
    if not entries:
        raise EvidenceError("simulation has no entries")
    positions: dict[str, float] = {}
    cash = 1000.0
    fills: list[Fill] = []
    daily_nav: list[tuple[date, float]] = []
    weekly_returns: list[tuple[date, float]] = []
    distinct_symbols: set[str] = set()
    gross_by_symbol: dict[str, float] = {}
    gross_by_spell: list[float] = []
    holding_spells = 0
    invalid = [
        {
            "entryDate": formation.entry_day.isoformat(),
            "reason": str(formation.invalid_reason),
        }
        for formation in formations
        if not formation.valid
    ]
    positions, cash = rebalance(
        day=entries[0],
        cutoff=formations[0].cutoff_day,
        target=targets[0],
        positions=positions,
        cash=cash,
        bars=bars,
        cost=cost,
        fills=fills,
    )
    previous_week_nav = 1000.0
    breadth_observations = [breadth_for(formation, spec) for formation in formations]
    target_exposures = [math.fsum(target.values()) for target in targets]
    for index, entry in enumerate(entries):
        target = targets[index]
        distinct_symbols.update(symbol for symbol, weight in target.items() if weight > 0)
        holding_spells += sum(weight > 0 for weight in target.values())
        next_entry = entry + timedelta(days=7)
        start_quantities = dict(positions)
        start_prices = {
            symbol: bar_or_fail(bars, symbol, entry, "entry").open_price
            for symbol in start_quantities
        }
        for day in date_range(entry, next_entry - timedelta(days=1)):
            nav = cash + math.fsum(
                quantity * bar_or_fail(bars, symbol, day, "daily close").close_price
                for symbol, quantity in positions.items()
            )
            if nav <= 0 or not math.isfinite(nav):
                raise SelectedEvidenceError(f"daily NAV invalid: {day}")
            daily_nav.append((day, nav))
        for symbol, quantity in start_quantities.items():
            end_open = bar_or_fail(bars, symbol, next_entry, "exit").open_price
            gross = quantity * (end_open - start_prices[symbol])
            gross_by_symbol[symbol] = gross_by_symbol.get(symbol, 0.0) + gross
            gross_by_spell.append(gross)
        if index + 1 < len(entries):
            positions, cash = rebalance(
                day=next_entry,
                cutoff=formations[index + 1].cutoff_day,
                target=targets[index + 1],
                positions=positions,
                cash=cash,
                bars=bars,
                cost=cost,
                fills=fills,
            )
            end_nav = mark_open(positions, cash, bars, next_entry)
        else:
            positions, cash = rebalance(
                day=next_entry,
                cutoff=next_entry - timedelta(days=2),
                target={},
                positions=positions,
                cash=cash,
                bars=bars,
                cost=cost,
                fills=fills,
                liquidate=True,
            )
            end_nav = cash
        if end_nav <= 0 or not math.isfinite(end_nav):
            raise SelectedEvidenceError(f"weekly NAV invalid: {next_entry}")
        weekly_returns.append((entry, end_nav / previous_week_nav - 1))
        previous_week_nav = end_nav
    final_day = entries[-1] + timedelta(days=7)
    daily_nav.append((final_day, cash))
    daily_returns: list[tuple[date, float]] = []
    previous_nav = 1000.0
    for day, nav in daily_nav:
        daily_returns.append((day, nav / previous_nav - 1))
        previous_nav = nav
    return Simulation(
        cost.name,
        spec.trial_id,
        benchmark,
        len(formations),
        sum(formation.valid for formation in formations),
        invalid,
        holding_spells,
        distinct_symbols,
        fills,
        daily_nav,
        daily_returns,
        weekly_returns,
        breadth_observations,
        target_exposures,
        gross_by_symbol,
        gross_by_spell,
        cash,
    )


def circular_indices(
    length: int,
    block_length: int,
    replicates: int,
    seed: int,
) -> Iterable[tuple[int, ...]]:
    if length < block_length or block_length < 1 or replicates < 100:
        raise EvidenceError("bootstrap specification invalid")
    rng = random.Random(seed)
    for _ in range(replicates):
        indices: list[int] = []
        while len(indices) < length:
            start = rng.randrange(length)
            for offset in range(block_length):
                indices.append((start + offset) % length)
                if len(indices) == length:
                    break
        yield tuple(indices)


def log_returns(values: Sequence[float]) -> tuple[float, ...]:
    output: list[float] = []
    for value in values:
        if value <= -1 or not math.isfinite(value):
            raise EvidenceError("return cannot be logged")
        output.append(math.log1p(value))
    return tuple(output)


def terminal_from_logs(values: Sequence[float]) -> float:
    return 1000 * math.expm1(math.fsum(values))


def percentile(values: Sequence[float], probability: float) -> float:
    if not values or not 0 <= probability <= 1:
        raise EvidenceError("percentile input invalid")
    ordered = sorted(values)
    index = min(len(ordered) - 1, math.floor(probability * len(ordered)))
    return ordered[index]


def bootstrap_packet(
    returns: Sequence[float],
    *,
    block_length: int,
    replicates: int,
    seed: int,
) -> dict[str, Any]:
    logs = log_returns(returns)
    samples = [
        terminal_from_logs([logs[index] for index in indices])
        for indices in circular_indices(len(logs), block_length, replicates, seed)
    ]
    return {
        "method": "SEEDED_CIRCULAR_BLOCK_PERCENTILE",
        "observations": len(logs),
        "blockLengthDays": block_length,
        "replicates": replicates,
        "seed": seed,
        "lower5PctNetUsdPer1k": text_number(percentile(samples, 0.05)),
        "lower5PctIsOneSided95Lcb": True,
        "medianNetUsdPer1k": text_number(percentile(samples, 0.50)),
        "upper95PctNetUsdPer1k": text_number(percentile(samples, 0.95)),
        "pointNetUsdPer1k": text_number(terminal_from_logs(logs)),
    }


def one_sided_p(
    returns: Sequence[float],
    *,
    block_length: int,
    replicates: int,
    seed: int,
) -> float:
    logs = log_returns(returns)
    observed = math.fsum(logs)
    mean = observed / len(logs)
    centered = tuple(value - mean for value in logs)
    exceedances = 0
    for indices in circular_indices(len(logs), block_length, replicates, seed):
        if math.fsum(centered[index] for index in indices) >= observed:
            exceedances += 1
    return (exceedances + 1) / (replicates + 1)


def common_bootstrap_indices(
    length: int,
    protocol: Mapping[str, Any],
) -> tuple[tuple[int, ...], ...]:
    spec = require_dict(
        require_dict(protocol["statistics"], "statistics")["bootstrap"], "bootstrap"
    )
    return tuple(
        circular_indices(
            length,
            int(spec["blockLengthDays"]),
            int(spec["replicates"]),
            int(spec["seed"]),
        )
    )


def white_reality_check(
    paths: Mapping[str, Sequence[float]],
    indices_set: Sequence[Sequence[int]],
) -> dict[str, Any]:
    ordered_ids = tuple(sorted(paths))
    logs_by_id = {trial_id: log_returns(paths[trial_id]) for trial_id in ordered_ids}
    length = len(next(iter(logs_by_id.values())))
    if any(len(values) != length for values in logs_by_id.values()):
        raise EvidenceError("Reality Check paths are not synchronous")
    observed = max(math.fsum(logs_by_id[trial_id]) for trial_id in ordered_ids)
    means = {trial_id: math.fsum(logs_by_id[trial_id]) / length for trial_id in ordered_ids}
    exceedances = 0
    for indices in indices_set:
        maximum = max(
            math.fsum(logs_by_id[trial_id][index] - means[trial_id] for index in indices)
            for trial_id in ordered_ids
        )
        if maximum >= observed:
            exceedances += 1
    p_value = (exceedances + 1) / (len(indices_set) + 1)
    return {
        "method": "WHITE_SYNCHRONOUS_CENTERED_CIRCULAR_BLOCK",
        "trialCount": len(ordered_ids),
        "observationsPerTrial": length,
        "replicates": len(indices_set),
        "observedMaximumSumLogReturn": text_number(observed, 12),
        "pValue": text_number(p_value, 12),
    }


def holm_adjust(raw_p: Mapping[str, float]) -> dict[str, float]:
    ordered = sorted(raw_p, key=lambda trial_id: (raw_p[trial_id], trial_id))
    adjusted: dict[str, float] = {}
    running = 0.0
    family_size = len(ordered)
    for rank, trial_id in enumerate(ordered, start=1):
        candidate = min(1.0, raw_p[trial_id] * (family_size - rank + 1))
        running = max(running, candidate)
        adjusted[trial_id] = running
    return adjusted


def excess_returns(
    strategy: Sequence[tuple[date, float]],
    benchmark: Sequence[tuple[date, float]],
) -> tuple[float, ...]:
    if [day for day, _ in strategy] != [day for day, _ in benchmark]:
        raise EvidenceError("strategy and benchmark paths are not synchronous")
    output: list[float] = []
    for (_, strategy_return), (_, benchmark_return) in zip(strategy, benchmark, strict=True):
        log_excess = math.log1p(strategy_return) - math.log1p(benchmark_return)
        output.append(math.expm1(log_excess))
    return tuple(output)


def pbo_cscv(
    trial_runs: Mapping[str, Simulation],
    months: Sequence[str],
) -> dict[str, Any]:
    ordered_ids = tuple(sorted(trial_runs))
    block_scores: dict[str, dict[str, float]] = {}
    frozen_observation_counts: dict[str, int] | None = None
    for trial_id in ordered_ids:
        scores = dict.fromkeys(months, 0.0)
        observations = dict.fromkeys(months, 0)
        for day, value in trial_runs[trial_id].daily_returns:
            month = day.strftime("%Y-%m")
            if month not in scores:
                raise EvidenceError(f"PBO daily row outside frozen blocks: {day}")
            scores[month] += math.log1p(value)
            observations[month] += 1
        if any(count == 0 for count in observations.values()):
            raise EvidenceError("PBO calendar-month block has no daily observations")
        if frozen_observation_counts is None:
            frozen_observation_counts = observations
        elif observations != frozen_observation_counts:
            raise EvidenceError("PBO daily calendar blocks are not synchronous")
        block_scores[trial_id] = scores
    underperform = 0
    logits: list[float] = []
    splits = 0
    for in_sample_indices in itertools.combinations(range(len(months)), len(months) // 2):
        in_sample = {months[index] for index in in_sample_indices}
        out_sample = set(months) - in_sample
        in_scores = {
            trial_id: math.fsum(block_scores[trial_id][month] for month in in_sample)
            for trial_id in ordered_ids
        }
        champion = max(
            ordered_ids,
            key=lambda trial_id: (
                in_scores[trial_id],
                -ordered_ids.index(trial_id),
            ),
        )
        out_scores = {
            trial_id: math.fsum(block_scores[trial_id][month] for month in out_sample)
            for trial_id in ordered_ids
        }
        champion_score = out_scores[champion]
        lower_count = sum(score < champion_score for score in out_scores.values())
        tied_count = sum(score == champion_score for score in out_scores.values())
        rank = lower_count + (tied_count + 1) / 2
        relative_rank = rank / (len(ordered_ids) + 1)
        logit = math.log(relative_rank / (1 - relative_rank))
        logits.append(logit)
        if logit <= 0:
            underperform += 1
        splits += 1
    expected = math.comb(len(months), len(months) // 2)
    if splits != expected:
        raise EvidenceError("PBO split count mismatch")
    return {
        "status": "MEASURED",
        "method": "CSCV",
        "role": "DIAGNOSTIC_ONLY",
        "blocks": list(months),
        "blockObservationCounts": frozen_observation_counts,
        "splits": splits,
        "underperformingSplits": underperform,
        "pbo": text_number(underperform / splits, 12),
        "medianOosRankLogit": text_number(statistics.median(logits), 12),
    }


def max_drawdown_pct(nav: Sequence[tuple[date, float]]) -> float:
    peak = 1000.0
    maximum = 0.0
    for _day, value in nav:
        peak = max(peak, value)
        maximum = max(maximum, (peak - value) / peak * 100)
    return maximum


def monthly_positive_count(returns: Sequence[tuple[date, float]]) -> tuple[int, dict[str, str]]:
    monthly: dict[str, float] = {}
    for day, value in returns:
        month = day.strftime("%Y-%m")
        monthly[month] = monthly.get(month, 0.0) + math.log1p(value)
    rendered = {
        month: text_number(1000 * math.expm1(value)) for month, value in sorted(monthly.items())
    }
    return sum(value > 0 for value in monthly.values()), rendered


def simulation_summary(
    run: Simulation,
    bootstrap: dict[str, Any],
) -> dict[str, Any]:
    fees = math.fsum(fill.fee_usd for fill in run.fills)
    adverse = math.fsum(fill.adverse_usd for fill in run.fills)
    turnover = math.fsum(fill.reference_notional for fill in run.fills)
    measured_capacity_fills: list[tuple[Fill, float]] = []
    for fill in run.fills:
        participation_bps_value = fill.participation_bps
        if participation_bps_value is not None:
            measured_capacity_fills.append((fill, participation_bps_value))
    participation = sorted(value for _fill, value in measured_capacity_fills)
    missing_capacity = sum(fill.participation_bps is None for fill in run.fills)
    capacity_complete = missing_capacity == 0 and bool(participation)
    maximum_participation = max(participation) if capacity_complete else None
    p95_participation = percentile(participation, 0.95) if capacity_complete else None
    c_1bp_strategy_capital = (
        1000 / maximum_participation
        if maximum_participation is not None and maximum_participation > 0
        else None
    )
    minimum_fill_notional_at_1bp = (
        min(
            max(fill.reference_notional, fill.executed_notional) / participation_value
            for fill, participation_value in measured_capacity_fills
        )
        if capacity_complete
        else None
    )
    capacity_status = (
        "MEASURED_PUBLIC_PRINT_PROXY"
        if capacity_complete
        else (
            "UNMEASURED_REQUIRED_FILL_LIQUIDITY_MISSING"
            if missing_capacity
            else "NOT_APPLICABLE_NO_FILLS"
        )
    )
    positive_by_symbol = [max(0.0, value) for value in run.gross_by_symbol.values()]
    total_positive_symbol = math.fsum(positive_by_symbol)
    top_asset_share = (
        max(positive_by_symbol, default=0.0) / total_positive_symbol * 100
        if total_positive_symbol > 0
        else None
    )
    positive_spells = sorted((max(0.0, value) for value in run.gross_by_spell), reverse=True)
    total_positive_spells = math.fsum(positive_spells)
    top_five_spell_share = (
        math.fsum(positive_spells[:5]) / total_positive_spells * 100
        if total_positive_spells > 0
        else None
    )
    positive_months, monthly = monthly_positive_count(run.daily_returns)
    breadth_values = run.breadth_observations
    exposure_values = run.target_exposures
    return {
        "scenario": run.scenario,
        "trialId": run.trial_id,
        "isMatchedBenchmark": run.benchmark,
        "scheduledFormations": run.scheduled_formations,
        "validFormations": run.valid_formations,
        "invalidFormations": run.invalid_formations,
        "holdingSpells": run.holding_spells,
        "fills": len(run.fills),
        "roundTripEquivalentFills": text_number(len(run.fills) / 2, 2),
        "distinctHeldSymbols": len(run.distinct_symbols),
        "dailyObservations": len(run.daily_returns),
        "weeklyObservations": len(run.weekly_returns),
        "breadth": {
            "observations": len(breadth_values),
            "mean": text_number(statistics.fmean(breadth_values), 12),
            "minimum": text_number(min(breadth_values), 12),
            "maximum": text_number(max(breadth_values), 12),
        },
        "allocation": {
            "meanRiskExposure": text_number(statistics.fmean(exposure_values), 12),
            "minimumRiskExposure": text_number(min(exposure_values), 12),
            "maximumRiskExposure": text_number(max(exposure_values), 12),
            "fullRiskFormations": sum(value >= 1 - 1e-12 for value in exposure_values),
            "cashOnlyFormations": sum(value <= 1e-12 for value in exposure_values),
            "riskSleeve": list(RISK_SLEEVE),
        },
        "terminalNavUsd": text_number(run.terminal_nav),
        "netUsdPerInitial1000": text_number(run.terminal_nav - 1000),
        "feeUsd": text_number(fees),
        "adverseExecutionUsd": text_number(adverse),
        "referenceTurnoverUsd": text_number(turnover),
        "dailyCloseMaxDrawdownPct": text_number(max_drawdown_pct(run.daily_nav)),
        "positiveMonths": positive_months,
        "monthlyNetUsdPer1k": monthly,
        "bootstrap": bootstrap,
        "capacityProxy": {
            "label": "PUBLIC_PRINT_CAPACITY_PROXY_ONLY",
            "status": capacity_status,
            "fillsWithMeasuredProxy": len(participation),
            "fillsMissingProxy": missing_capacity,
            "maximumParticipationBps": (
                text_number(maximum_participation, 12)
                if maximum_participation is not None
                else None
            ),
            "p95ParticipationBps": (
                text_number(p95_participation, 12) if p95_participation is not None else None
            ),
            "c1bpUsd": (
                text_number(c_1bp_strategy_capital) if c_1bp_strategy_capital is not None else None
            ),
            "c1bpStrategyCapitalUsd": (
                text_number(c_1bp_strategy_capital) if c_1bp_strategy_capital is not None else None
            ),
            "minimumPerFillNotionalAt1bpUsd": (
                text_number(minimum_fill_notional_at_1bp)
                if minimum_fill_notional_at_1bp is not None
                else None
            ),
            "historicalExecutableBookCapacity": "UNMEASURED",
        },
        "concentration": {
            "topAssetPositiveGrossProfitSharePct": (
                text_number(top_asset_share) if top_asset_share is not None else None
            ),
            "topFiveHoldingSpellPositiveGrossProfitSharePct": (
                text_number(top_five_spell_share) if top_five_spell_share is not None else None
            ),
        },
    }


def bootstrap_for_run(
    run: Simulation,
    protocol: Mapping[str, Any],
    seed_offset: int = 0,
) -> dict[str, Any]:
    spec = require_dict(
        require_dict(protocol["statistics"], "statistics")["bootstrap"], "bootstrap"
    )
    return bootstrap_packet(
        [value for _, value in run.daily_returns],
        block_length=int(spec["blockLengthDays"]),
        replicates=int(spec["replicates"]),
        seed=int(spec["seed"]) + seed_offset,
    )


def development_analysis(
    strategy_runs: Mapping[str, Simulation],
    benchmark_runs: Mapping[str, Simulation],
    protocol: Mapping[str, Any],
) -> tuple[dict[str, Any], str]:
    ordered_ids = tuple(sorted(strategy_runs))
    if tuple(sorted(benchmark_runs)) != ordered_ids:
        raise EvidenceError("development strategy/benchmark family mismatch")
    observation_count = len(strategy_runs[ordered_ids[0]].daily_returns)
    if any(len(run.daily_returns) != observation_count for run in strategy_runs.values()):
        raise EvidenceError("development trial daily paths are not synchronous")
    bootstrap_spec = require_dict(
        require_dict(protocol["statistics"], "statistics")["bootstrap"], "bootstrap"
    )
    block_length = int(bootstrap_spec["blockLengthDays"])
    replicates = int(bootstrap_spec["replicates"])
    seed = int(bootstrap_spec["seed"])
    indices_set = common_bootstrap_indices(observation_count, protocol)
    raw_p: dict[str, float] = {}
    rows: dict[str, Any] = {}
    absolute_paths: dict[str, tuple[float, ...]] = {}
    excess_paths: dict[str, tuple[float, ...]] = {}
    for index, trial_id in enumerate(ordered_ids):
        run = strategy_runs[trial_id]
        benchmark = benchmark_runs[trial_id]
        values = tuple(value for _, value in run.daily_returns)
        excess = excess_returns(run.daily_returns, benchmark.daily_returns)
        absolute_paths[trial_id] = values
        excess_paths[trial_id] = excess
        raw = one_sided_p(
            values,
            block_length=block_length,
            replicates=replicates,
            seed=seed + 100 + index,
        )
        raw_p[trial_id] = raw
        rows[trial_id] = {
            "strategy": simulation_summary(
                run, bootstrap_for_run(run, protocol, seed_offset=index)
            ),
            "matchedBenchmark": simulation_summary(
                benchmark,
                bootstrap_for_run(benchmark, protocol, seed_offset=50 + index),
            ),
            "rawOneSidedP": text_number(raw, 12),
            "matchedBenchmarkExcess": bootstrap_packet(
                excess,
                block_length=block_length,
                replicates=replicates,
                seed=seed + 200 + index,
            ),
        }
    adjusted = holm_adjust(raw_p)
    for trial_id in ordered_ids:
        rows[trial_id]["holmAdjustedP"] = text_number(adjusted[trial_id], 12)
    reality_absolute = white_reality_check(absolute_paths, indices_set)
    reality_excess = white_reality_check(excess_paths, indices_set)
    specs = {spec.trial_id: spec for spec in trial_specs(protocol)}
    champion = min(
        ordered_ids,
        key=lambda trial_id: (
            -float(rows[trial_id]["strategy"]["bootstrap"]["lower5PctNetUsdPer1k"]),
            float(rows[trial_id]["strategy"]["referenceTurnoverUsd"]),
            -specs[trial_id].abnormal_multiple,
            -specs[trial_id].saturation_breadth,
            trial_id,
        ),
    )
    pbo_spec = require_dict(require_dict(protocol["statistics"], "statistics")["pbo"], "pbo")
    months = require_list(
        require_dict(require_dict(protocol["calendar"], "calendar")["development"], "development")[
            "calendarMonthBlocks"
        ],
        "calendarMonthBlocks",
    )
    pbo = pbo_cscv(strategy_runs, [str(value) for value in months])
    if pbo["splits"] != pbo_spec["symmetricSplits"]:
        raise EvidenceError("PBO split count differs from protocol")
    return (
        {
            "status": "MEASURED",
            "scenario": "PUBLIC_STRESS",
            "trialCount": len(ordered_ids),
            "trials": rows,
            "whiteRealityCheckVersusCash": reality_absolute,
            "whiteRealityCheckVersusMatchedBenchmark": reality_excess,
            "pbo": pbo,
            "championTrialId": champion,
        },
        champion,
    )


def evaluate_gates(
    protocol: Mapping[str, Any],
    development: Mapping[str, Any],
    champion_id: str,
    holdout: Mapping[str, Any],
) -> tuple[list[dict[str, Any]], str]:
    decisions: list[dict[str, Any]] = []

    def decide(gate: str, actual: object, rule: str, passed: bool) -> None:
        decisions.append({"gate": gate, "actual": actual, "rule": rule, "passed": passed})

    gates = require_dict(protocol["gates"], "gates")
    dev_gates = require_dict(gates["development"], "gates.development")
    hold_gates = require_dict(gates["holdout"], "gates.holdout")
    dev_trial = development["trials"][champion_id]
    dev_summary = dev_trial["strategy"]
    decide(
        "DEV_VALID_FORMATIONS",
        dev_summary["validFormations"],
        f">={dev_gates['minimumValidFormations']}",
        int(dev_summary["validFormations"]) >= int(dev_gates["minimumValidFormations"]),
    )
    decide(
        "DEV_HOLDING_SPELLS",
        dev_summary["holdingSpells"],
        f">={dev_gates['minimumHoldingSpells']}",
        int(dev_summary["holdingSpells"]) >= int(dev_gates["minimumHoldingSpells"]),
    )
    decide(
        "DEV_FILLS",
        dev_summary["fills"],
        f">={dev_gates['minimumFills']}",
        int(dev_summary["fills"]) >= int(dev_gates["minimumFills"]),
    )
    decide(
        "DEV_DISTINCT_SYMBOLS",
        dev_summary["distinctHeldSymbols"],
        f">={dev_gates['minimumDistinctSymbols']}",
        int(dev_summary["distinctHeldSymbols"]) >= int(dev_gates["minimumDistinctSymbols"]),
    )
    decide(
        "DEV_POSITIVE_STRESS_MONTHS",
        dev_summary["positiveMonths"],
        f">={dev_gates['minimumPositiveStressMonths']}/{dev_gates['requiredPositiveStressMonthsOf']}",
        int(dev_summary["positiveMonths"]) >= int(dev_gates["minimumPositiveStressMonths"]),
    )
    holm = float(dev_trial["holmAdjustedP"])
    holm_limit = float(dev_gates["holmAdjustedPExclusiveMaximum"])
    decide("DEV_HOLM_P", dev_trial["holmAdjustedP"], f"<{holm_limit}", holm < holm_limit)
    for label, key in (
        ("DEV_WHITE_RC_CASH", "whiteRealityCheckVersusCash"),
        ("DEV_WHITE_RC_BENCHMARK", "whiteRealityCheckVersusMatchedBenchmark"),
    ):
        value = float(development[key]["pValue"])
        limit = float(dev_gates["whiteRealityCheckPExclusiveMaximum"])
        decide(label, development[key]["pValue"], f"<{limit}", value < limit)
    dev_net = float(dev_summary["netUsdPerInitial1000"])
    dev_lcb = float(dev_summary["bootstrap"]["lower5PctNetUsdPer1k"])
    decide("DEV_STRESS_NET", dev_summary["netUsdPerInitial1000"], ">0", dev_net > 0)
    decide("DEV_STRESS_LCB", text_number(dev_lcb), ">0", dev_lcb > 0)

    base = holdout["PUBLIC_BASE"]["strategy"]
    stress = holdout["PUBLIC_STRESS"]["strategy"]
    fee_stress = holdout["FEE_STRESS"]["strategy"]
    stress_excess = holdout["PUBLIC_STRESS"]["matchedBenchmarkExcess"]
    decide(
        "HOLDOUT_VALID_FORMATIONS",
        stress["validFormations"],
        f">={hold_gates['minimumValidFormations']}",
        int(stress["validFormations"]) >= int(hold_gates["minimumValidFormations"]),
    )
    decide(
        "HOLDOUT_HOLDING_SPELLS",
        stress["holdingSpells"],
        f">={hold_gates['minimumHoldingSpells']}",
        int(stress["holdingSpells"]) >= int(hold_gates["minimumHoldingSpells"]),
    )
    decide(
        "HOLDOUT_FILLS",
        stress["fills"],
        f">={hold_gates['minimumFills']}",
        int(stress["fills"]) >= int(hold_gates["minimumFills"]),
    )
    decide(
        "HOLDOUT_DISTINCT_SYMBOLS",
        stress["distinctHeldSymbols"],
        f">={hold_gates['minimumDistinctSymbols']}",
        int(stress["distinctHeldSymbols"]) >= int(hold_gates["minimumDistinctSymbols"]),
    )
    decide(
        "HOLDOUT_POSITIVE_STRESS_MONTHS",
        stress["positiveMonths"],
        f">={hold_gates['minimumPositiveStressMonths']}/{hold_gates['requiredPositiveStressMonthsOf']}",
        int(stress["positiveMonths"]) >= int(hold_gates["minimumPositiveStressMonths"]),
    )
    for label, summary in (
        ("HOLDOUT_BASE_NET", base),
        ("HOLDOUT_STRESS_NET", stress),
        ("HOLDOUT_FEE_STRESS_NET", fee_stress),
    ):
        value = float(summary["netUsdPerInitial1000"])
        decide(label, summary["netUsdPerInitial1000"], ">0", value > 0)
    stress_lcb = float(stress["bootstrap"]["lower5PctNetUsdPer1k"])
    decide(
        "HOLDOUT_STRESS_LCB",
        stress["bootstrap"]["lower5PctNetUsdPer1k"],
        ">0",
        stress_lcb > 0,
    )
    holdout_p = float(holdout["PUBLIC_STRESS"]["oneSidedP"])
    p_limit = float(hold_gates["publicStressOneSidedPExclusiveMaximum"])
    decide(
        "HOLDOUT_STRESS_ONE_SIDED_P",
        holdout["PUBLIC_STRESS"]["oneSidedP"],
        f"<{p_limit}",
        holdout_p < p_limit,
    )
    excess_lcb = float(stress_excess["lower5PctNetUsdPer1k"])
    decide(
        "HOLDOUT_MATCHED_BENCHMARK_EXCESS_LCB",
        stress_excess["lower5PctNetUsdPer1k"],
        ">0",
        excess_lcb > 0,
    )
    drawdown = float(stress["dailyCloseMaxDrawdownPct"])
    drawdown_limit = float(hold_gates["maximumDailyCloseDrawdownPct"])
    decide(
        "HOLDOUT_DRAWDOWN",
        stress["dailyCloseMaxDrawdownPct"],
        f"<={drawdown_limit}",
        drawdown <= drawdown_limit,
    )
    top_asset = stress["concentration"]["topAssetPositiveGrossProfitSharePct"]
    top_asset_limit = float(hold_gates["maximumTopAssetPositiveGrossProfitSharePct"])
    decide(
        "HOLDOUT_TOP_ASSET_CONCENTRATION",
        top_asset,
        f"<={top_asset_limit}",
        top_asset is not None and float(top_asset) <= top_asset_limit,
    )
    top_five = stress["concentration"]["topFiveHoldingSpellPositiveGrossProfitSharePct"]
    top_five_limit = float(hold_gates["maximumTopFiveHoldingSpellPositiveGrossProfitSharePct"])
    decide(
        "HOLDOUT_TOP_FIVE_SPELL_CONCENTRATION",
        top_five,
        f"<={top_five_limit}",
        top_five is not None and float(top_five) <= top_five_limit,
    )
    capacity = stress["capacityProxy"]
    max_participation = capacity["maximumParticipationBps"]
    c1bp = capacity["c1bpUsd"]
    capacity_spec = require_dict(protocol["capacity"], "capacity")
    max_limit = float(capacity_spec["gateMaximumParticipationBps"])
    minimum_capacity = float(capacity_spec["gateMinimumC1bpUsd"])
    decide(
        "HOLDOUT_CAPACITY_PROXY_COMPLETE",
        capacity["fillsMissingProxy"],
        "==0",
        int(capacity["fillsMissingProxy"]) == 0,
    )
    decide(
        "HOLDOUT_MAX_PARTICIPATION_PROXY",
        max_participation,
        f"<={max_limit}bp",
        max_participation is not None and float(max_participation) <= max_limit,
    )
    decide(
        "HOLDOUT_C1BP_PROXY",
        c1bp,
        f">={minimum_capacity}",
        c1bp is not None and float(c1bp) >= minimum_capacity,
    )
    return decisions, ("GO" if all(row["passed"] for row in decisions) else "NO_GO")


def holdout_analysis(
    bars: Mapping[str, Mapping[date, Bar]],
    formations: Sequence[Formation],
    champion: TrialSpec,
    protocol: Mapping[str, Any],
) -> tuple[dict[str, Any], dict[str, Simulation]]:
    packets: dict[str, Any] = {}
    runs: dict[str, Simulation] = {}
    bootstrap_spec = require_dict(
        require_dict(protocol["statistics"], "statistics")["bootstrap"], "bootstrap"
    )
    for offset, name in enumerate(SCENARIOS):
        strategy_run = simulation(
            bars=bars,
            formations=formations,
            spec=champion,
            cost=scenario(protocol, name),
            benchmark=False,
        )
        benchmark_run = simulation(
            bars=bars,
            formations=formations,
            spec=champion,
            cost=scenario(protocol, name),
            benchmark=True,
        )
        runs[name] = strategy_run
        excess = excess_returns(strategy_run.daily_returns, benchmark_run.daily_returns)
        packets[name] = {
            "strategy": simulation_summary(
                strategy_run,
                bootstrap_for_run(strategy_run, protocol, seed_offset=300 + offset),
            ),
            "matchedBenchmark": simulation_summary(
                benchmark_run,
                bootstrap_for_run(benchmark_run, protocol, seed_offset=400 + offset),
            ),
            "oneSidedP": text_number(
                one_sided_p(
                    [value for _, value in strategy_run.daily_returns],
                    block_length=int(bootstrap_spec["blockLengthDays"]),
                    replicates=int(bootstrap_spec["replicates"]),
                    seed=int(bootstrap_spec["seed"]) + 500 + offset,
                ),
                12,
            ),
            "matchedBenchmarkExcess": bootstrap_packet(
                excess,
                block_length=int(bootstrap_spec["blockLengthDays"]),
                replicates=int(bootstrap_spec["replicates"]),
                seed=int(bootstrap_spec["seed"]) + 600 + offset,
            ),
        }
    return packets, runs


def base_result(
    bindings: Mapping[str, str],
    *,
    started_at: str,
    completed_at: str,
) -> dict[str, Any]:
    return {
        "schema": "VG23ResultV1",
        "task": "V-G23",
        "taskSuffix": "a780",
        "startedAtUtc": started_at,
        "completedAtUtc": completed_at,
        "bindings": dict(bindings),
        "measurementWindow": {
            "startInclusive": "2025-07-01",
            "endExclusive": "2026-07-01",
            "calendarMonths": 12,
        },
        "globalVolumeFamilyHoldoutStatus": "NOT_CERTIFIED_SHARED_REUSE_RISK",
        "programWideMultiplicity": {
            "status": "UNRESOLVED_OUTSIDE_PACKET",
            "consumerAdjustedPValue": "1",
            "localHolmAndWhiteRealityCheckScope": "VG23_SIX_TRIAL_FAMILY_ONLY",
            "verifiedPositiveEligible": False,
        },
        "authority": {
            "scope": "PUBLIC_RESEARCH_ONLY",
            "capitalVerdict": "NO_GO",
            "executionAuthority": "NONE",
            "effectUsd": "0",
        },
        "costTruth": {
            "publicScenarioFees": "SENSITIVITY_ONLY",
            "accountEffectiveCommission": "UNKNOWN_PUBLIC_ONLY",
            "historicalAccountActualFee": "UNMEASURED",
        },
        "capacityTruth": {
            "publicPrintCapacity": "PROXY_ONLY",
            "historicalExecutableBookCapacity": "UNMEASURED",
        },
    }


def marker_record(state_root: Path, filename: str) -> dict[str, Any] | None:
    path = state_root / filename
    if not path.exists():
        return None
    payload, raw = load_json(path)
    if raw != canonical_bytes(payload):
        raise CustodyError(f"run marker is not canonical JSON: {filename}")
    return {
        "filename": filename,
        "sha256": sha256_bytes(raw),
        "payload": payload,
    }


def clone_json_object(payload: Mapping[str, Any]) -> dict[str, Any]:
    cloned = json.loads(canonical_bytes(payload))
    if not isinstance(cloned, dict):
        raise CustodyError("canonical JSON clone is not an object")
    return cloned


def write_terminal_result_core(
    state_root: Path,
    result_core: Mapping[str, Any],
    *,
    terminal_phase: str,
) -> str:
    bindings = require_dict(result_core.get("bindings"), "resultCore.bindings")
    if "terminalResultCoreSha256" in bindings or "runReceiptSha256" in bindings:
        raise CustodyError("result core contains post-core circular bindings")
    core = clone_json_object(result_core)
    payload = {
        "schema": "VG23TerminalResultCoreV1",
        "state": "IMMUTABLE_PRE_RECEIPT_TERMINAL_RESULT_CORE",
        "createdAtUtc": utc_now(),
        "terminalPhase": terminal_phase,
        "resultCoreSha256": sha256_bytes(canonical_bytes(core)),
        "resultCore": core,
    }
    path = state_root / TERMINAL_CORE_FILENAME
    write_exclusive(path, canonical_bytes(payload))
    return sha256_path(path)


def result_core_from_terminal_record(record: Mapping[str, Any]) -> dict[str, Any]:
    payload = require_dict(record.get("payload"), "terminalResultCore.payload")
    if (
        payload.get("schema") != "VG23TerminalResultCoreV1"
        or payload.get("state") != "IMMUTABLE_PRE_RECEIPT_TERMINAL_RESULT_CORE"
    ):
        raise CustodyError("terminal result-core marker schema/state mismatch")
    core = require_dict(payload.get("resultCore"), "terminalResultCore.resultCore")
    if payload.get("resultCoreSha256") != sha256_bytes(canonical_bytes(core)):
        raise CustodyError("terminal result-core payload digest mismatch")
    return clone_json_object(core)


def reconstruct_final_result(
    result_core: Mapping[str, Any],
    *,
    terminal_core_sha: str,
    run_receipt_sha: str,
) -> dict[str, Any]:
    result = clone_json_object(result_core)
    bindings = require_dict(result.get("bindings"), "result.bindings")
    if "terminalResultCoreSha256" in bindings or "runReceiptSha256" in bindings:
        raise CustodyError("result core already contains terminal bindings")
    bindings["terminalResultCoreSha256"] = terminal_core_sha
    bindings["runReceiptSha256"] = run_receipt_sha
    return result


def write_run_receipt(
    state_root: Path,
    *,
    terminal_phase: str,
) -> str:
    records = {
        "runMarker": marker_record(state_root, "run-marker.v1.json"),
        "candidateSeal": marker_record(state_root, "candidate-seal.v1.json"),
        "holdoutOpen": marker_record(state_root, "holdout-open.v1.json"),
        "terminalResultCore": marker_record(state_root, TERMINAL_CORE_FILENAME),
    }
    if records["runMarker"] is None or records["terminalResultCore"] is None:
        raise CustodyError("required run or terminal-core marker missing")
    payload = {
        "schema": "VG23RunReceiptV1",
        "state": "IMMUTABLE_PACKET_COPY_OF_ONE_USE_EXTERNAL_MARKERS",
        "createdAtUtc": utc_now(),
        "stateRoot": str(state_root),
        "terminalPhase": terminal_phase,
        "markers": records,
    }
    write_exclusive(RUN_RECEIPT_PATH, canonical_bytes(payload))
    return sha256_path(RUN_RECEIPT_PATH)


def commit_terminal_result(
    state_root: Path,
    result_core: Mapping[str, Any],
    *,
    terminal_phase: str,
) -> dict[str, Any]:
    terminal_core_sha = write_terminal_result_core(
        state_root,
        result_core,
        terminal_phase=terminal_phase,
    )
    run_receipt_sha = write_run_receipt(state_root, terminal_phase=terminal_phase)
    result = reconstruct_final_result(
        result_core,
        terminal_core_sha=terminal_core_sha,
        run_receipt_sha=run_receipt_sha,
    )
    write_exclusive(RESULT_PATH, canonical_bytes(result))
    return result


def finalize_interrupted(state_root: Path) -> dict[str, Any]:
    if RESULT_PATH.exists():
        raise EvidenceError("terminal result already exists")
    protocol, _protocol_sha = load_protocol()
    state_root = enforce_state_root(protocol, state_root)
    run_record = marker_record(state_root, "run-marker.v1.json")
    if run_record is None:
        raise EvidenceError("no consumed V-G23 run marker is available to finalize")
    run_payload = require_dict(run_record.get("payload"), "runMarker.payload")
    if RUN_RECEIPT_PATH.exists():
        receipt, receipt_raw = load_json(RUN_RECEIPT_PATH)
        if receipt_raw != canonical_bytes(receipt):
            raise CustodyError("existing run receipt is not canonical JSON")
        records = require_dict(receipt.get("markers"), "runReceipt.markers")
        terminal_record = require_dict(
            records.get("terminalResultCore"),
            "runReceipt.markers.terminalResultCore",
        )
        external_terminal_record = marker_record(state_root, TERMINAL_CORE_FILENAME)
        if external_terminal_record is None or terminal_record != external_terminal_record:
            raise CustodyError("receipt terminal core differs from external marker")
        core = result_core_from_terminal_record(terminal_record)
        terminal_sha = require_text(terminal_record.get("sha256"), "terminalResultCore.sha256")
        result = reconstruct_final_result(
            core,
            terminal_core_sha=terminal_sha,
            run_receipt_sha=sha256_bytes(receipt_raw),
        )
        write_exclusive(RESULT_PATH, canonical_bytes(result))
        return result

    recovered_terminal_record = marker_record(state_root, TERMINAL_CORE_FILENAME)
    if recovered_terminal_record is None:
        binding_names = (
            "protocolSha256",
            "freezeSha256",
            "evaluatorSha256",
            "verifierSha256",
            "officialSourceResearchSha256",
            "sharedDiscoverySha256",
            "sharedAcquisitionSha256",
            "targetArtifactInventorySha256",
            "sourceFreezeCommit",
            "sourceFreezeTree",
        )
        bindings = {
            name: require_text(run_payload.get(name), f"runMarker.{name}") for name in binding_names
        }
        bindings["runMarkerSha256"] = require_text(run_record.get("sha256"), "runMarker.sha256")
        for filename, binding_name in (
            ("candidate-seal.v1.json", "candidateSealSha256"),
            ("holdout-open.v1.json", "holdoutOpenSha256"),
        ):
            record = marker_record(state_root, filename)
            if record is not None:
                bindings[binding_name] = require_text(
                    record.get("sha256"), f"{binding_name}.sha256"
                )
        core = terminal_unmeasured(
            bindings,
            started_at=require_text(run_payload.get("startedAtUtc"), "runMarker.startedAtUtc"),
            phase="INTERRUPTED_AFTER_RUN_MARKER",
            error=EvidenceError("DATA_FREE_FINALIZER_USED_AFTER_CONSUMED_RUN"),
        )
        terminal_sha = write_terminal_result_core(
            state_root,
            core,
            terminal_phase="INTERRUPTED_AFTER_RUN_MARKER",
        )
        receipt_terminal_phase = "INTERRUPTED_AFTER_RUN_MARKER"
    else:
        core = result_core_from_terminal_record(recovered_terminal_record)
        terminal_sha = require_text(
            recovered_terminal_record.get("sha256"),
            "terminalResultCore.sha256",
        )
        recovered_terminal_payload = require_dict(
            recovered_terminal_record.get("payload"),
            "terminalResultCore.payload",
        )
        receipt_terminal_phase = require_text(
            recovered_terminal_payload.get("terminalPhase"),
            "terminalResultCore.terminalPhase",
        )
    receipt_sha = write_run_receipt(
        state_root,
        terminal_phase=receipt_terminal_phase,
    )
    result = reconstruct_final_result(
        core,
        terminal_core_sha=terminal_sha,
        run_receipt_sha=receipt_sha,
    )
    write_exclusive(RESULT_PATH, canonical_bytes(result))
    return result


def terminal_unmeasured(
    bindings: Mapping[str, str],
    *,
    started_at: str,
    phase: str,
    error: BaseException,
    source_issues: Sequence[Mapping[str, str]] | None = None,
) -> dict[str, Any]:
    payload = base_result(bindings, started_at=started_at, completed_at=utc_now())
    payload.update(
        {
            "state": "TERMINAL_UNMEASURED_NO_REPAIR_OR_RERUN",
            "terminalPhase": phase,
            "reasonCode": type(error).__name__.upper(),
            "reason": str(error),
            "sourceSchemaIssues": list(source_issues or ()),
            "development": None,
            "holdout": None,
            "headline": {
                "netUsdPerInitial1000": None,
                "samples": None,
                "fills": None,
                "holdoutInterval": None,
                "pbo": None,
                "drawdownPct": None,
                "capacity": "UNMEASURED",
                "feeStressNetUsdPerInitial1000": None,
            },
            "gateDecisions": [],
            "measurementVerdict": "UNMEASURED",
            "limitations": [
                "SEALED_FAILURE_CANNOT_BE_REPAIRED_RERUN_OR_REOPENED",
                "ACCOUNT_EFFECTIVE_FEES_UNKNOWN_PUBLIC_ONLY",
                "HISTORICAL_FILTERS_BOOK_DEPTH_IMPACT_AND_EXECUTABLE_CAPACITY_UNMEASURED",
                "GLOBAL_VOLUME_FAMILY_HOLDOUT_NOT_CERTIFIED_SHARED_REUSE_RISK",
                "USDT_USD_PARITY_ASSUMED_FOR_REPORTING",
            ],
        }
    )
    return payload


def run_experiment(state_root: Path) -> dict[str, Any]:
    if RESULT_PATH.exists() or RUN_RECEIPT_PATH.exists():
        raise EvidenceError("terminal result or run receipt already exists")
    protocol, freeze_payload, _acquisition, symbols, lookup, bindings = load_frozen()
    bindings.update(source_freeze_lineage(freeze_payload))
    state_root = enforce_state_root(protocol, state_root)
    if state_root.exists():
        if state_root.is_symlink() or not state_root.is_dir():
            raise EvidenceError("V-G23 state root has invalid shape")
        existing = sorted(path.name for path in state_root.iterdir())
        if existing:
            raise EvidenceError(f"V-G23 run state already consumed: {','.join(existing)}")
    else:
        state_root.mkdir(parents=True, mode=0o700)
    started_at = utc_now()
    run_marker = {
        "schema": "VG23RunMarkerV1",
        "state": "SOLE_DEVELOPMENT_ARCHIVE_OPEN_RUN_CONSUMED",
        "startedAtUtc": started_at,
        **bindings,
        "allowedRunCount": 1,
        "consumedRunCount": 1,
        "networkPermitted": False,
        "sharedSourceMutationPermitted": False,
    }
    run_marker_path = state_root / "run-marker.v1.json"
    write_exclusive(run_marker_path, canonical_bytes(run_marker))
    bindings["runMarkerSha256"] = sha256_path(run_marker_path)
    phase = "DEVELOPMENT_ARCHIVE_OPEN"
    source_issues: list[dict[str, str]] = []
    try:
        data = require_dict(protocol["data"], "data")
        source_root = Path(require_text(freeze_payload["sourceRoot"], "freeze.sourceRoot"))
        dev_month_bounds = require_list(
            data["developmentArchiveMonthsInclusive"],
            "developmentArchiveMonthsInclusive",
        )
        dev_months = month_range(str(dev_month_bounds[0]), str(dev_month_bounds[1]))
        bars, source_issues = load_bars(source_root, lookup, symbols, dev_months)
        calendar = require_dict(protocol["calendar"], "calendar")
        dev_calendar = require_dict(calendar["development"], "development")
        dev_entries = weekly_dates(
            date.fromisoformat(str(dev_calendar["firstEntry"])),
            date.fromisoformat(str(dev_calendar["lastEntry"])),
        )
        if len(dev_entries) != int(dev_calendar["scheduledFormations"]):
            raise CustodyError("development formation calendar mismatch")
        phase = "DEVELOPMENT_FORMATIONS_AND_TRIALS"
        dev_formations = build_formations(bars, symbols, dev_entries, protocol)
        specs = trial_specs(protocol)
        public_stress = scenario(protocol, "PUBLIC_STRESS")
        strategy_runs = {
            spec.trial_id: simulation(
                bars=bars,
                formations=dev_formations,
                spec=spec,
                cost=public_stress,
                benchmark=False,
            )
            for spec in specs
        }
        benchmark_runs = {
            spec.trial_id: simulation(
                bars=bars,
                formations=dev_formations,
                spec=spec,
                cost=public_stress,
                benchmark=True,
            )
            for spec in specs
        }
        phase = "DEVELOPMENT_INFERENCE_AND_SELECTION"
        development, champion_id = development_analysis(strategy_runs, benchmark_runs, protocol)
        champion = next(spec for spec in specs if spec.trial_id == champion_id)
        development_sha = sha256_bytes(canonical_bytes(development))
        phase = "CANDIDATE_SEAL"
        candidate = {
            "schema": "VG23CandidateSealV1",
            "state": "ONE_DEVELOPMENT_CHAMPION_SEALED_BEFORE_HOLDOUT_OPEN",
            "sealedAtUtc": utc_now(),
            **bindings,
            "developmentEvidenceSha256": development_sha,
            "championTrialId": champion_id,
            "championTrial": {
                "abnormalMultiple": text_number(champion.abnormal_multiple, 2),
                "saturationBreadth": text_number(champion.saturation_breadth, 2),
            },
            "selectionRule": require_dict(protocol["trials"], "trials")["championSelection"],
            "holdoutArchiveBodiesOpened": False,
        }
        candidate_path = state_root / "candidate-seal.v1.json"
        write_exclusive(candidate_path, canonical_bytes(candidate))
        bindings["candidateSealSha256"] = sha256_path(candidate_path)
        phase = "HOLDOUT_OPEN_MARKER"
        holdout_marker = {
            "schema": "VG23HoldoutOpenMarkerV1",
            "state": "SOLE_CHAMPION_ONLY_HOLDOUT_OPEN_CONSUMED",
            "openedAtUtc": utc_now(),
            "candidateSealSha256": bindings["candidateSealSha256"],
            "championTrialId": champion_id,
            "allowedOpenCount": 1,
            "consumedOpenCount": 1,
            "postOpenRepairAllowed": False,
            "runnerUpOpenAllowed": False,
        }
        holdout_marker_path = state_root / "holdout-open.v1.json"
        write_exclusive(holdout_marker_path, canonical_bytes(holdout_marker))
        bindings["holdoutOpenSha256"] = sha256_path(holdout_marker_path)
        phase = "HOLDOUT_ARCHIVE_OPEN"
        hold_month_bounds = require_list(
            data["holdoutArchiveMonthsInclusive"], "holdoutArchiveMonthsInclusive"
        )
        hold_months = month_range(str(hold_month_bounds[0]), str(hold_month_bounds[1]))
        holdout_bars, holdout_source_issues = load_bars(source_root, lookup, symbols, hold_months)
        source_issues.extend(holdout_source_issues)
        merge_bars(bars, holdout_bars)
        hold_calendar = require_dict(calendar["holdout"], "holdout")
        hold_entries = weekly_dates(
            date.fromisoformat(str(hold_calendar["firstEntry"])),
            date.fromisoformat(str(hold_calendar["lastEntry"])),
        )
        if len(hold_entries) != int(hold_calendar["scheduledFormations"]):
            raise CustodyError("holdout formation calendar mismatch")
        hold_formations = build_formations(bars, symbols, hold_entries, protocol)
        phase = "HOLDOUT_CHAMPION_ONLY_EVALUATION"
        holdout, _holdout_runs = holdout_analysis(bars, hold_formations, champion, protocol)
        phase = "FROZEN_GATE_EVALUATION"
        decisions, verdict = evaluate_gates(protocol, development, champion_id, holdout)
        stress = holdout["PUBLIC_STRESS"]["strategy"]
        fee_stress = holdout["FEE_STRESS"]["strategy"]
        result = base_result(bindings, started_at=started_at, completed_at=utc_now())
        result.update(
            {
                "state": "TERMINAL_MEASURED_NO_RERUN",
                "sourceSchemaIssues": source_issues,
                "development": development,
                "holdout": holdout,
                "headline": {
                    "netUsdPerInitial1000": stress["netUsdPerInitial1000"],
                    "samples": {
                        "developmentFormations": development["trials"][champion_id]["strategy"][
                            "validFormations"
                        ],
                        "holdoutFormations": stress["validFormations"],
                        "holdoutDailyObservations": stress["dailyObservations"],
                    },
                    "fills": {
                        "development": development["trials"][champion_id]["strategy"]["fills"],
                        "holdout": stress["fills"],
                    },
                    "holdoutInterval": stress["bootstrap"],
                    "pbo": development["pbo"],
                    "drawdownPct": stress["dailyCloseMaxDrawdownPct"],
                    "capacity": stress["capacityProxy"],
                    "feeStressNetUsdPerInitial1000": fee_stress["netUsdPerInitial1000"],
                },
                "gateDecisions": decisions,
                "measurementVerdict": verdict,
                "limitations": [
                    "HOLDOUT_IS_FOUR_MONTHS_AND_SEVENTEEN_WEEKLY_FORMATIONS_ONLY",
                    "ACCOUNT_EFFECTIVE_MAKER_TAKER_VIP_BNB_SPECIAL_TAX_DISCOUNT_AND_PROMOTION_FEES_UNKNOWN",
                    "HISTORICAL_FILTER_PERMISSION_SPREAD_DEPTH_LATENCY_IMPACT_AND_EXECUTABLE_CAPACITY_UNMEASURED",
                    "PUBLIC_PRINT_CAPACITY_IS_A_TURNOVER_PROXY_NOT_FILL_PROOF",
                    "CHECKSUM_VALID_MALFORMED_UNSELECTED_ARCHIVES_ARE_CAUSALLY_INELIGIBLE_AND_RECORDED",
                    "ARCHIVE_DISCOVERY_REDUCES_BUT_CANNOT_PROVE_ABSENCE_OF_LISTING_SURVIVORSHIP_BIAS",
                    "DEVELOPMENT_SCHEMA_ONLY_PREFREEZE_SUPPORT_SCAN_DISCLOSED_NO_ECONOMIC_OUTCOMES_RETAINED",
                    "GLOBAL_VOLUME_FAMILY_HOLDOUT_NOT_CERTIFIED_SHARED_REUSE_RISK",
                    "PROGRAM_WIDE_MULTIPLICITY_UNRESOLVED_CONSUMER_ADJUSTED_P_VALUE_ONE",
                    "USDT_TREATED_AS_USD_ONE_TO_ONE_FOR_REPORTING_ONLY",
                    "PBO_IS_DIAGNOSTIC_ONLY",
                    "NO_RERUN_RETUNE_RUNNER_UP_OR_HOLDOUT_REOPEN_ALLOWED",
                ],
            }
        )
    except BaseException as error:
        result = terminal_unmeasured(
            bindings,
            started_at=started_at,
            phase=phase,
            error=error,
            source_issues=source_issues,
        )
    return commit_terminal_result(state_root, result, terminal_phase=phase)


def packet_files() -> tuple[Path, ...]:
    names = (
        "HANDOFF.md",
        "OFFICIAL_SOURCE_RESEARCH.md",
        "README.md",
        "run-receipt.v1.json",
        "VERIFICATION.md",
        "experiment.py",
        "freeze.v1.json",
        "protocol.v1.json",
        "result.v1.json",
        "test_experiment.py",
        "verify.py",
    )
    paths = tuple(PACKET_DIR / name for name in names)
    missing = [path.name for path in paths if not path.is_file() or path.is_symlink()]
    if missing:
        raise EvidenceError(f"packet files unavailable: {','.join(missing)}")
    return paths


def seal_packet() -> dict[str, str]:
    if CHECKSUMS_PATH.exists():
        raise EvidenceError("SHA256SUMS already exists")
    rows = [f"{sha256_path(path)}  {path.name}" for path in packet_files()]
    write_exclusive(CHECKSUMS_PATH, ("\n".join(rows) + "\n").encode())
    return {path.name: sha256_path(path) for path in packet_files()}


def verify_checksums() -> dict[str, str]:
    if CHECKSUMS_PATH.is_symlink() or not CHECKSUMS_PATH.is_file():
        raise CustodyError("SHA256SUMS unavailable")
    expected: dict[str, str] = {}
    for line in CHECKSUMS_PATH.read_text(encoding="ascii").splitlines():
        parts = line.split("  ", 1)
        if len(parts) != 2 or not re.fullmatch(r"[0-9a-f]{64}", parts[0]):
            raise CustodyError("SHA256SUMS row malformed")
        name = parts[1]
        if (
            not name
            or name.startswith(".")
            or "/" in name
            or "\\" in name
            or name in expected
            or not re.fullmatch(r"[A-Za-z0-9_.-]+", name)
        ):
            raise CustodyError("SHA256SUMS filename malformed or duplicate")
        expected[name] = parts[0]
    actual_names = {path.name for path in packet_files()}
    if set(expected) != actual_names:
        raise CustodyError("SHA256SUMS file set mismatch")
    for name, digest in expected.items():
        if sha256_path(PACKET_DIR / name) != digest:
            raise CustodyError(f"packet byte drift: {name}")
    return expected


def verify_run_receipt(
    protocol: Mapping[str, Any],
    result: Mapping[str, Any],
) -> dict[str, Any]:
    receipt, receipt_raw = load_json(RUN_RECEIPT_PATH)
    if receipt.get("schema") != "VG23RunReceiptV1":
        raise CustodyError("run receipt schema mismatch")
    state_root = enforce_state_root(
        protocol, Path(require_text(receipt.get("stateRoot"), "runReceipt.stateRoot"))
    )
    markers = require_dict(receipt.get("markers"), "runReceipt.markers")
    result_bindings = require_dict(result.get("bindings"), "result.bindings")
    if result_bindings.get("runReceiptSha256") != sha256_bytes(receipt_raw):
        raise CustodyError("result does not bind run receipt bytes")
    marker_contract = (
        ("runMarker", "run-marker.v1.json", "runMarkerSha256", True),
        ("candidateSeal", "candidate-seal.v1.json", "candidateSealSha256", False),
        ("holdoutOpen", "holdout-open.v1.json", "holdoutOpenSha256", False),
        (
            "terminalResultCore",
            TERMINAL_CORE_FILENAME,
            "terminalResultCoreSha256",
            True,
        ),
    )
    verified: list[str] = []
    for receipt_key, filename, binding_key, required in marker_contract:
        record = markers.get(receipt_key)
        if record is None:
            if required:
                raise CustodyError(f"required receipt marker missing: {receipt_key}")
            if binding_key in result_bindings:
                raise CustodyError(f"result claims absent receipt marker: {receipt_key}")
            continue
        row = require_dict(record, f"runReceipt.markers.{receipt_key}")
        if row.get("filename") != filename:
            raise CustodyError(f"receipt marker filename mismatch: {receipt_key}")
        payload = require_dict(row.get("payload"), f"runReceipt.{receipt_key}.payload")
        embedded_raw = canonical_bytes(payload)
        digest = require_text(row.get("sha256"), f"runReceipt.{receipt_key}.sha256")
        if sha256_bytes(embedded_raw) != digest:
            raise CustodyError(f"embedded receipt marker digest mismatch: {receipt_key}")
        external_path = state_root / filename
        _external_payload, external_raw = load_json(external_path)
        if sha256_bytes(external_raw) != digest or external_raw != embedded_raw:
            raise CustodyError(f"external one-use marker differs from receipt: {receipt_key}")
        if result_bindings.get(binding_key) != digest:
            raise CustodyError(f"result marker binding mismatch: {receipt_key}")
        verified.append(receipt_key)
    run_payload = require_dict(
        require_dict(markers.get("runMarker"), "runReceipt.runMarker").get("payload"),
        "runReceipt.runMarker.payload",
    )
    if (
        run_payload.get("schema") != "VG23RunMarkerV1"
        or run_payload.get("state") != "SOLE_DEVELOPMENT_ARCHIVE_OPEN_RUN_CONSUMED"
        or run_payload.get("allowedRunCount") != 1
        or run_payload.get("consumedRunCount") != 1
        or run_payload.get("networkPermitted") is not False
        or run_payload.get("sharedSourceMutationPermitted") is not False
    ):
        raise CustodyError("run marker semantic mismatch")
    terminal_record = require_dict(
        markers.get("terminalResultCore"),
        "runReceipt.terminalResultCore",
    )
    terminal_core = result_core_from_terminal_record(terminal_record)
    expected_result = reconstruct_final_result(
        terminal_core,
        terminal_core_sha=require_text(terminal_record.get("sha256"), "terminalResultCore.sha256"),
        run_receipt_sha=sha256_bytes(receipt_raw),
    )
    if expected_result != result:
        raise CustodyError("result differs from immutable terminal result core")
    if result.get("measurementVerdict") in {"GO", "NO_GO"} and set(verified) != {
        "runMarker",
        "candidateSeal",
        "holdoutOpen",
        "terminalResultCore",
    }:
        raise CustodyError("measured result lacks the complete one-use marker chain")
    if markers.get("candidateSeal") is not None:
        candidate_record = require_dict(markers["candidateSeal"], "candidateSeal")
        candidate = require_dict(candidate_record.get("payload"), "candidateSeal.payload")
        if (
            candidate.get("schema") != "VG23CandidateSealV1"
            or candidate.get("state") != "ONE_DEVELOPMENT_CHAMPION_SEALED_BEFORE_HOLDOUT_OPEN"
        ):
            raise CustodyError("candidate marker semantic mismatch")
        development = result.get("development")
        if isinstance(development, dict) and (
            candidate.get("developmentEvidenceSha256") != sha256_bytes(canonical_bytes(development))
            or candidate.get("championTrialId") != development.get("championTrialId")
        ):
            raise CustodyError("candidate marker does not bind result development")
    if markers.get("holdoutOpen") is not None:
        holdout_record = require_dict(markers["holdoutOpen"], "holdoutOpen")
        holdout = require_dict(holdout_record.get("payload"), "holdoutOpen.payload")
        candidate_record = require_dict(markers.get("candidateSeal"), "candidateSeal")
        if (
            holdout.get("schema") != "VG23HoldoutOpenMarkerV1"
            or holdout.get("state") != "SOLE_CHAMPION_ONLY_HOLDOUT_OPEN_CONSUMED"
            or holdout.get("allowedOpenCount") != 1
            or holdout.get("consumedOpenCount") != 1
            or holdout.get("candidateSealSha256") != candidate_record.get("sha256")
            or holdout.get("championTrialId")
            != require_dict(candidate_record.get("payload"), "candidateSeal.payload").get(
                "championTrialId"
            )
        ):
            raise CustodyError("holdout marker semantic mismatch")
    return {
        "runReceiptSha256": sha256_bytes(receipt_raw),
        "verifiedMarkers": verified,
        "stateRoot": str(state_root),
    }


def verify_packet() -> dict[str, Any]:
    checksums = verify_checksums()
    protocol, freeze_payload, _acquisition, _symbols, _lookup, bindings = load_frozen()
    result, _raw = load_json(RESULT_PATH)
    if result.get("schema") != "VG23ResultV1":
        raise CustodyError("result schema mismatch")
    if result.get("measurementVerdict") not in {"GO", "NO_GO", "UNMEASURED"}:
        raise CustodyError("result verdict is not closed")
    if result.get("authority", {}).get("capitalVerdict") != "NO_GO":
        raise CustodyError("result capital authority drift")
    result_bindings = require_dict(result.get("bindings"), "result.bindings")
    for key, value in bindings.items():
        if result_bindings.get(key) != value:
            raise CustodyError(f"result binding mismatch: {key}")
    receipt_evidence = verify_run_receipt(protocol, result)
    if (
        freeze_payload.get("archiveBodiesOpenedByVG23Evaluator") is not False
        or freeze_payload.get("economicOutcomeFieldsAccessedByVG23BeforeFreeze") is not False
        or freeze_payload.get("developmentSchemaOnlyPrefreezeAuditObserved") is not True
    ):
        raise CustodyError("freeze pre-outcome declaration drift")
    return {
        "status": "PASS",
        "measurementVerdict": result["measurementVerdict"],
        "capitalVerdict": "NO_GO",
        "packetFileCount": len(checksums),
        "protocolId": protocol["protocolId"],
        "resultSha256": checksums["result.v1.json"],
        "runControl": receipt_evidence,
    }


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--source-root", type=Path, default=DEFAULT_SOURCE_ROOT, help=argparse.SUPPRESS
    )
    parser.add_argument(
        "--state-root", type=Path, default=DEFAULT_STATE_ROOT, help=argparse.SUPPRESS
    )
    parser.add_argument(
        "command", choices=("freeze", "run", "finalize", "seal", "verify", "report")
    )
    arguments = parser.parse_args(argv)
    try:
        if arguments.command == "freeze":
            payload = freeze(arguments.source_root)
        elif arguments.command == "run":
            payload = run_experiment(arguments.state_root)
        elif arguments.command == "finalize":
            payload = finalize_interrupted(arguments.state_root)
        elif arguments.command == "seal":
            payload = {"status": "SEALED", "files": seal_packet()}
        elif arguments.command == "verify":
            payload = verify_packet()
        else:
            payload, _raw = load_json(RESULT_PATH)
        print(json.dumps(payload, indent=2, sort_keys=True))
    except EvidenceError as error:
        print(f"V-G23 ERROR: {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
