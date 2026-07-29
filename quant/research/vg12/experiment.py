#!/usr/bin/env python3
"""One-shot V-G12 public Spot volume-entropy regime experiment."""

from __future__ import annotations

import argparse
import contextlib
import csv
import hashlib
import io
import json
import math
import os
import platform
import random
import re
import stat
import statistics
import subprocess
import sys
import tempfile
import zipfile
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import ROUND_HALF_EVEN, Decimal, InvalidOperation, localcontext
from pathlib import Path
from typing import Any, Final

PACKET_DIR: Final = Path(__file__).resolve().parent
PROTOCOL_PATH: Final = PACKET_DIR / "protocol.v1.json"
SOURCE_RESEARCH_PATH: Final = PACKET_DIR / "OFFICIAL_SOURCE_RESEARCH.md"
FREEZE_PATH: Final = PACKET_DIR / "freeze.v1.json"
RESULT_PATH: Final = PACKET_DIR / "result.v1.json"
RUN_RECEIPT_PATH: Final = PACKET_DIR / "run-receipt.v1.json"
CHECKSUMS_PATH: Final = PACKET_DIR / "SHA256SUMS"
DEFAULT_SOURCE_ROOT: Final = Path("/private/tmp/cosmos-s1f-weekly-momentum-cash-v1")
DEFAULT_STATE_ROOT: Final = Path("/private/tmp/cosmos-vg12-volume-entropy-regime-1be1-67aa")
DAY_US: Final = 86_400_000_000
SYMBOL_RE: Final = re.compile(r"^[A-Z0-9]+USDT$")
MONTH_RE: Final = re.compile(r"^[0-9]{4}-(?:0[1-9]|1[0-2])$")
SCENARIOS: Final = ("GROSS", "BASE", "STRESS", "FEE_STRESS")
TRIAL_ID: Final = "ENTROPY_07_GT_PRIOR_28_TOP30"
DECIMAL_PRECISION: Final = 80
ENTROPY_TOLERANCE: Final = Decimal("1E-40")
MAXIMUM_ZIP_BYTES: Final = 2_000_000
MAXIMUM_CHECKSUM_BYTES: Final = 256
MAXIMUM_UNCOMPRESSED_CSV_BYTES: Final = 4_000_000
MAXIMUM_COMPRESSION_RATIO: Final = Decimal("100")
ALLOWED_ZIP_METHODS: Final = frozenset((zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED))
ALLOWED_ZIP_FLAG_MASK: Final = 0x800
SHA256_RE: Final = re.compile(r"^[0-9a-f]{64}$")
PHASE_JOURNAL_NAME: Final = "phase-journal.v1.jsonl"
TERMINAL_DRAFT_NAME: Final = "terminal-result-draft.v1.json"


class EvidenceError(RuntimeError):
    """Fail-closed experiment or lifecycle error."""


class CustodyError(EvidenceError):
    """Byte, checksum, source, or frozen-contract error."""


class ArchiveSchemaError(EvidenceError):
    """Checksum-valid archive bytes with unusable semantics."""


class SelectedEvidenceError(EvidenceError):
    """A held member lacks an entry, exit, or required mark."""


class DevelopmentQualificationNoGo(EvidenceError):
    """The valid development measurement failed at least one frozen gate."""


@dataclass(frozen=True)
class Bar:
    day: date
    open_price: float
    close_price: float
    quote_volume: Decimal


@dataclass(frozen=True)
class Scenario:
    name: str
    fee_rate: float
    adverse_rate: float


@dataclass(frozen=True)
class Formation:
    formation_day: date
    entry_day: date
    exit_day: date
    valid: bool
    invalid_reason: str | None
    cohort: tuple[str, ...]
    liquidity: Mapping[str, Decimal]
    base_entropy: Decimal | None
    recent_entropy: Decimal | None
    broadening: bool
    eligible_symbols: int


@dataclass
class Simulation:
    scenario: str
    benchmark: bool
    scheduled_formations: int
    valid_formations: int
    broadening_formations: int
    non_broadening_formations: int
    invested_formations: int
    fills: int
    distinct_symbols: set[str]
    weekly_returns: list[tuple[date, float]]
    weekly_nav: list[tuple[date, float]]
    gross_by_symbol: dict[str, float]
    participation_bps: list[float]
    c1bp_usd: list[float]
    terminal_nav: float


def sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def sha256_path(path: Path) -> str:
    if path.is_symlink() or not path.is_file():
        raise CustodyError(f"required regular file unavailable: {path}")
    return sha256_bytes(path.read_bytes())


def canonical_bytes(value: object) -> bytes:
    return (
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True) + "\n"
    ).encode()


def normalized_lines(values: Sequence[str]) -> bytes:
    return (("\n".join(values) + "\n") if values else "").encode()


def load_json(path: Path) -> tuple[dict[str, Any], bytes]:
    if path.is_symlink() or not path.is_file():
        raise CustodyError(f"required regular JSON unavailable: {path}")
    raw = path.read_bytes()
    try:
        value = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise CustodyError(f"invalid JSON: {path}") from error
    if not isinstance(value, dict):
        raise CustodyError(f"JSON root must be an object: {path}")
    return value, raw


def fsync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def ensure_directory(path: Path, *, mode: int = 0o700) -> None:
    if path.exists():
        if path.is_symlink() or not path.is_dir():
            raise EvidenceError(f"directory has invalid shape: {path}")
        return
    missing: list[Path] = []
    cursor = path
    while not cursor.exists():
        missing.append(cursor)
        cursor = cursor.parent
    if cursor.is_symlink() or not cursor.is_dir():
        raise EvidenceError(f"directory ancestor has invalid shape: {cursor}")
    for directory in reversed(missing):
        directory.mkdir(mode=mode)
        fsync_directory(directory)
        fsync_directory(directory.parent)


def write_exclusive(path: Path, raw: bytes) -> None:
    ensure_directory(path.parent)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        fsync_directory(path.parent)
    except BaseException:
        with contextlib.suppress(OSError):
            path.unlink(missing_ok=True)
            fsync_directory(path.parent)
        raise


def write_atomic(path: Path, raw: bytes) -> None:
    ensure_directory(path.parent)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary_path = Path(temporary)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_path, path)
        fsync_directory(path.parent)
    finally:
        temporary_path.unlink(missing_ok=True)


def utc_now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def read_phase_journal(state_root: Path) -> tuple[list[dict[str, Any]], bytes]:
    path = state_root / PHASE_JOURNAL_NAME
    if path.is_symlink() or not path.is_file():
        raise CustodyError("durable phase journal is unavailable")
    raw = path.read_bytes()
    entries: list[dict[str, Any]] = []
    if not raw or not raw.endswith(b"\n"):
        raise CustodyError("durable phase journal is empty or unterminated")
    for ordinal, line in enumerate(raw.splitlines(keepends=True), start=1):
        try:
            value = json.loads(line)
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise CustodyError("durable phase journal has invalid JSON") from error
        if not isinstance(value, dict) or line != canonical_bytes(value):
            raise CustodyError("durable phase journal entry is not canonical")
        if (
            value.get("schema") != "VG12PhaseJournalEntryV1"
            or value.get("ordinal") != ordinal
            or not isinstance(value.get("phase"), str)
            or SHA256_RE.fullmatch(str(value.get("runMarkerSha256"))) is None
        ):
            raise CustodyError("durable phase journal entry contract mismatch")
        entries.append(value)
    return entries, raw


def append_phase(
    state_root: Path,
    phase: str,
    *,
    run_marker_sha256: str,
    detail_sha256: str | None = None,
) -> dict[str, Any]:
    path = state_root / PHASE_JOURNAL_NAME
    entries: list[dict[str, Any]] = []
    if path.exists():
        entries, _ = read_phase_journal(state_root)
    previous = str(entries[-1]["phase"]) if entries else None
    allowed: dict[str | None, set[str]] = {
        None: {"RUN_MARKER_WRITTEN"},
        "RUN_MARKER_WRITTEN": {
            "DEVELOPMENT_ARCHIVES_OPENING",
            "TERMINAL_FINALIZING",
        },
        "DEVELOPMENT_ARCHIVES_OPENING": {
            "DEVELOPMENT_ANALYZED",
            "TERMINAL_FINALIZING",
        },
        "DEVELOPMENT_ANALYZED": {
            "DEVELOPMENT_NO_GO",
            "CANDIDATE_SEALED",
            "TERMINAL_FINALIZING",
        },
        "DEVELOPMENT_NO_GO": {"TERMINAL_FINALIZING"},
        "CANDIDATE_SEALED": {
            "HOLDOUT_MARKER_WRITTEN",
            "TERMINAL_FINALIZING",
        },
        "HOLDOUT_MARKER_WRITTEN": {
            "HOLDOUT_ARCHIVES_OPENING",
            "TERMINAL_FINALIZING",
        },
        "HOLDOUT_ARCHIVES_OPENING": {
            "HOLDOUT_ANALYZED",
            "TERMINAL_FINALIZING",
        },
        "HOLDOUT_ANALYZED": {"TERMINAL_FINALIZING"},
        "TERMINAL_FINALIZING": set(),
    }
    if phase not in allowed.get(previous, set()):
        raise CustodyError(f"invalid durable phase transition: {previous}->{phase}")
    payload: dict[str, Any] = {
        "schema": "VG12PhaseJournalEntryV1",
        "ordinal": len(entries) + 1,
        "phase": phase,
        "atUtc": utc_now(),
        "runMarkerSha256": run_marker_sha256,
    }
    if detail_sha256 is not None:
        if SHA256_RE.fullmatch(detail_sha256) is None:
            raise CustodyError("phase detail digest malformed")
        payload["detailSha256"] = detail_sha256
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    try:
        with os.fdopen(descriptor, "ab") as handle:
            handle.write(canonical_bytes(payload))
            handle.flush()
            os.fsync(handle.fileno())
        fsync_directory(state_root)
    except BaseException:
        raise
    return payload


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
    first_year, first_month = (int(part) for part in first.split("-"))
    last_year, last_month = (int(part) for part in last.split("-"))
    values: list[str] = []
    year, month = first_year, first_month
    while (year, month) <= (last_year, last_month):
        values.append(f"{year:04d}-{month:02d}")
        month += 1
        if month == 13:
            year += 1
            month = 1
    return tuple(values)


def frozen_shared_manifest_evidence() -> dict[str, object]:
    return {
        "discoverySha256": ("b4a8f7abd36df19eff0510dfcc3c61fd0df9fdcab5f4d248892ee10010fb21c3"),
        "acquisitionSha256": ("01f58272602e43bfb914b649adc00d8273b2d423492220a55f86443bb6441176"),
        "discoveryTargetMonths": list(month_range("2024-03", "2026-06")),
        "discoveryTargetMonthCount": 28,
        "candidateUniverseCount": 605,
        "candidateUniverseSha256": (
            "a597d8339aafb74c40b8899cade9445150c3f431f4c2e7fe2bfac37d8d1b0592"
        ),
        "artifactPairCount": 11_245,
        "absentSymbolMonthCount": 5_695,
        "artifactRowsSha256": ("4209d02f1917a29f63bfcdc472004c08058f287972cc369cd9c7d247899fa2af"),
        "absentSymbolMonthsSha256": (
            "c8f062c921850197afd492784ef4c743fe82f33557768816303c807d7f874924"
        ),
    }


def date_range(first: date, last: date) -> tuple[date, ...]:
    if last < first:
        return ()
    return tuple(first + timedelta(days=offset) for offset in range((last - first).days + 1))


def weekly_dates(first: date, last: date) -> tuple[date, ...]:
    if last < first:
        return ()
    count = (last - first).days // 7
    return tuple(first + timedelta(days=7 * offset) for offset in range(count + 1))


def runtime_binding() -> dict[str, str]:
    return {
        "python": platform.python_version(),
        "implementation": platform.python_implementation(),
        "hashSeed": os.environ.get("PYTHONHASHSEED", "UNSET"),
    }


def packet_source_bindings(packet_dir: Path = PACKET_DIR) -> dict[str, str]:
    names = (
        "OFFICIAL_SOURCE_RESEARCH.md",
        "README.md",
        "experiment.py",
        "protocol.v1.json",
        "test_experiment.py",
        "verify.py",
    )
    return {name: sha256_path(packet_dir / name) for name in names}


def git_output(repo: Path, *args: str) -> str:
    try:
        completed = subprocess.run(
            ("git", "-C", str(repo), *args),
            check=True,
            capture_output=True,
            text=True,
        )
    except (OSError, subprocess.CalledProcessError) as error:
        raise CustodyError(f"Git preflight failed: {' '.join(args)}") from error
    return completed.stdout.strip()


def preflight_git_snapshot(
    packet_dir: Path,
    freeze_path: Path,
    protocol: Mapping[str, Any],
) -> dict[str, Any]:
    repo = Path(git_output(packet_dir, "rev-parse", "--show-toplevel"))
    try:
        packet_relative = packet_dir.resolve(strict=True).relative_to(repo.resolve(strict=True))
        freeze_relative = freeze_path.resolve(strict=True).relative_to(repo.resolve(strict=True))
    except ValueError as error:
        raise CustodyError("packet or freeze is outside its Git repository") from error
    if (
        freeze_path.parent.resolve(strict=True) != packet_dir.resolve(strict=True)
        or freeze_path.name != "freeze.v1.json"
    ):
        raise CustodyError("run freeze must be the packet-local freeze.v1.json")
    status = git_output(
        repo,
        "status",
        "--porcelain=v1",
        "--untracked-files=all",
        "--",
        packet_relative.as_posix(),
    )
    if status:
        raise CustodyError("packet source and freeze snapshot must be clean and committed")
    commit = git_output(repo, "rev-parse", "HEAD")
    tree = git_output(repo, "rev-parse", "HEAD^{tree}")
    parents = git_output(repo, "show", "-s", "--format=%P", "HEAD").split()
    expected_parent = require_text(protocol.get("canonicalBaseCommit"), "canonicalBaseCommit")
    if len(parents) != 1 or parents[0] != expected_parent:
        raise CustodyError("pre-run commit must be a direct child of the canonical base")
    required_paths = [
        *(packet_relative / name for name in packet_source_bindings(packet_dir)),
        freeze_relative,
    ]
    head_blobs: dict[str, str] = {}
    for relative in required_paths:
        relative_text = relative.as_posix()
        git_output(repo, "ls-files", "--error-unmatch", "--", relative_text)
        head_blob = git_output(repo, "rev-parse", f"HEAD:{relative_text}")
        working_blob = git_output(repo, "hash-object", str(repo / relative))
        if head_blob != working_blob:
            raise CustodyError(f"HEAD blob differs from working bytes: {relative_text}")
        head_blobs[relative_text] = head_blob
    return {
        "schema": "VG12PreRunGitSnapshotV1",
        "repositoryRoot": str(repo.resolve(strict=True)),
        "packetRelativePath": packet_relative.as_posix(),
        "commit": commit,
        "tree": tree,
        "parent": parents[0],
        "headBlobs": head_blobs,
    }


def load_protocol(path: Path = PROTOCOL_PATH) -> tuple[dict[str, Any], str]:
    protocol, raw = load_json(path)
    if protocol.get("schema") != "VG12VolumeEntropyRegimeProtocolV1":
        raise CustodyError("protocol schema mismatch")
    if protocol.get("canonicalBaseCommit") != ("a169b123fb186d1943a75ad648552c4d95be1be1"):
        raise CustodyError("canonical base drift")
    trial = require_dict(protocol.get("trial"), "trial")
    if trial.get("attemptedCount") != 1 or trial.get("trialId") != TRIAL_ID:
        raise CustodyError("single frozen trial drift")
    distinctness = require_dict(protocol.get("distinctness"), "distinctness")
    if (
        distinctness.get("siblingInspectionState")
        != "CURRENT_SIBLING_PROTOCOL_BYTES_INSPECTED_PRE_FREEZE"
        or distinctness.get("siblingDistinctnessVerdict") != "MATERIAL_DISTINCTNESS_PASS"
        or distinctness.get("highestOverlap")
        != "VG8_SAME_WEEKLY_DATES_AND_QUOTE_VOLUME_BUT_DIFFERENT_TRANSFORM_AND_ACTION"
        or distinctness.get("correlatedSiblingOutcomes")
        != "GLOBAL_MULTIPLICITY_EVIDENCE_NOT_INDEPENDENT_CONFIRMATION"
        or require_dict(
            distinctness.get("siblingProtocolEvidence"),
            "distinctness.siblingProtocolEvidence",
        )
        != {
            "VG8": {
                "protocolSha256": (
                    "5dddd302a69be73494cb5ed06d674982a5ecebfa5dcc573799b2c0207965a579"
                ),
                "gitState": "COMMITTED",
                "commit": "77216b60011cc3de7abcfc90a43ad5459cc59d3c",
            },
            "VG9": {
                "protocolSha256": (
                    "d8539d23a46aface73bfc6a72c08fcd548a7c8590b0fc7e1c6210b31a8c94b66"
                ),
                "gitState": "COMMITTED",
                "commit": "24093cfd058b840f479d24cdc859f765bab4d4ce",
            },
            "VG10": {
                "protocolSha256": (
                    "3b075f404fde1433205a3615e883e50d78abe8fb76e53fbd065c22947f53738d"
                ),
                "gitState": "UNTRACKED_AT_BASE",
                "commit": "a169b123fb186d1943a75ad648552c4d95be1be1",
            },
            "VG11": {
                "protocolSha256": (
                    "7593b25261ff2972a0a581f15467279e33d04334bab1418d0b39e2d50abdbf50"
                ),
                "gitState": "COMMITTED",
                "commit": "f10287bb791711e416f087d746831d29c186b7e1",
            },
        }
    ):
        raise CustodyError("sibling distinctness evidence drift")
    signal = require_dict(protocol.get("signal"), "signal")
    expected_signal = {
        "priorWindowDays": 120,
        "laggedLiquidityWindowDays": 30,
        "laggedLiquidityStartOffsetDaysBeforeFormation": 65,
        "laggedLiquidityEndOffsetDaysBeforeFormation": 36,
        "baselineWindowDays": 28,
        "baselineStartOffsetDaysBeforeFormation": 35,
        "baselineEndOffsetDaysBeforeFormation": 8,
        "recentWindowDays": 7,
        "recentStartOffsetDaysBeforeFormation": 7,
        "recentEndOffsetDaysBeforeFormation": 1,
    }
    for field, expected in expected_signal.items():
        if signal.get(field) != expected:
            raise CustodyError(f"signal drift: {field}")
    if (
        signal.get("broadening")
        != "RECENT_NORMALIZED_ENTROPY_MINUS_BASELINE_NORMALIZED_ENTROPY_STRICTLY_GREATER_THAN_1E_40"
        or signal.get("tieNarrowingOrUnresolved") != "CASH"
        or signal.get("zeroAggregateEntropyMass") != "UNRESOLVED_CASH"
    ):
        raise CustodyError("signal comparison law drift")
    numeric = require_dict(signal.get("numericDomain"), "signal.numericDomain")
    if numeric != {
        "quoteVolume": "DECIMAL_NONNEGATIVE",
        "windowMass": "DECIMAL_EXACT_SUM",
        "medianLiquidity": "DECIMAL_EXACT_MEDIAN",
        "decimalPrecision": DECIMAL_PRECISION,
        "rounding": "ROUND_HALF_EVEN",
        "entropyComparisonTolerance": "1E-40",
    }:
        raise CustodyError("signal numeric-domain drift")
    data = require_dict(protocol.get("data"), "data")
    if (
        require_dict(data.get("sharedManifestEvidence"), "data.sharedManifestEvidence")
        != frozen_shared_manifest_evidence()
    ):
        raise CustodyError("frozen shared-manifest evidence drift")
    if require_dict(
        data.get("acquisitionManifestValidation"),
        "data.acquisitionManifestValidation",
    ) != {
        "artifactRowsSha256": (
            "SHA256_OF_NEWLINE_TERMINATED_LIST_OF_SHA256_CANONICAL_ARTIFACT_ROW"
        ),
        "rowStateAllowed": ["DOWNLOADED_VERIFIED", "RESUMED_VERIFIED"],
        "rowMetadataMustExactlyMatchDiscovery": True,
        "absenceListMustExactlyMatchDiscovery": True,
        "positiveBoundedArtifactSizesRequired": True,
        "fullDiscoveryScopeAuthenticatedBeforeTargetSlice": True,
        "protocolTargetMonthsMustBeContinuousOrderedSubset": True,
        "targetSliceInventoryBoundSeparately": True,
    }:
        raise CustodyError("acquisition-manifest validation contract drift")
    if require_dict(data.get("archiveSafety"), "data.archiveSafety") != {
        "maximumZipBytes": MAXIMUM_ZIP_BYTES,
        "maximumChecksumBytes": MAXIMUM_CHECKSUM_BYTES,
        "maximumUncompressedCsvBytes": MAXIMUM_UNCOMPRESSED_CSV_BYTES,
        "maximumCompressionRatio": "100",
        "allowedCompressionMethods": [0, 8],
        "allowedGeneralPurposeFlagMask": ALLOWED_ZIP_FLAG_MASK,
        "singleExactCsvMemberRequired": True,
    }:
        raise CustodyError("archive-safety contract drift")
    universe = require_dict(protocol.get("universe"), "universe")
    if (
        universe.get("cohortSize") != 30
        or universe.get("minimumEligibleSymbols") != 30
        or universe.get("priorContiguousBarsRequired") != 120
    ):
        raise CustodyError("universe/cohort drift")
    calendar = require_dict(protocol.get("calendar"), "calendar")
    development = require_dict(calendar.get("development"), "calendar.development")
    holdout = require_dict(calendar.get("holdout"), "calendar.holdout")
    if (
        development.get("firstEntry") != "2025-07-01"
        or development.get("lastEntry") != "2026-02-17"
        or development.get("scheduledFormations") != 34
        or holdout.get("firstEntry") != "2026-03-03"
        or holdout.get("lastEntry") != "2026-06-23"
        or holdout.get("scheduledFormations") != 17
        or development.get("requiredExitMonthBuckets")
        != [
            "2025-07",
            "2025-08",
            "2025-09",
            "2025-10",
            "2025-11",
            "2025-12",
            "2026-01",
            "2026-02",
        ]
        or holdout.get("requiredExitMonthBuckets") != ["2026-03", "2026-04", "2026-05", "2026-06"]
    ):
        raise CustodyError("calendar drift")
    run_control = require_dict(protocol.get("runControl"), "runControl")
    if (
        run_control.get("allowedRunCount") != 1
        or run_control.get("allowedHoldoutOpenCount") != 1
        or run_control.get("networkDuringEvaluation") is not False
        or run_control.get("postMarkerRepairRerunRetuneOrReopen") is not False
    ):
        raise CustodyError("run-control drift")
    if require_dict(
        run_control.get("preRunCommittedSnapshot"),
        "runControl.preRunCommittedSnapshot",
    ) != {
        "packetMustBeClean": True,
        "sourceAndFreezeMustBeTrackedAtHEAD": True,
        "headMustHaveExactlyOneParent": True,
        "headParentMustEqualCanonicalBaseCommit": True,
        "headBlobBytesMustEqualWorkingBytes": True,
        "recordCommitTreeAndParent": True,
    }:
        raise CustodyError("pre-run Git contract drift")
    phase_journal = require_dict(run_control.get("phaseJournal"), "runControl.phaseJournal")
    if (
        phase_journal.get("format") != "CANONICAL_JSON_LINES_APPEND_ONLY"
        or phase_journal.get("fileAndParentDirectoryFsync") is not True
        or run_control.get("interruptionRecovery")
        != "FINALIZE_UNMEASURED_ONLY_FROM_EXISTING_RUN_MARKER_NO_ARCHIVE_REOPEN_RERUN_OR_REPAIR"
    ):
        raise CustodyError("durable lifecycle contract drift")
    if require_dict(
        run_control.get("terminalResultDraft"),
        "runControl.terminalResultDraft",
    ) != {
        "filename": TERMINAL_DRAFT_NAME,
        "canonicalAndFsyncedBeforeTerminalFinalizing": True,
        "terminalJournalDetailBindsDraftSha256": True,
        "immutableAfterFirstWrite": True,
        "resultBytesMustEqualDraftBytes": True,
    }:
        raise CustodyError("terminal-result draft contract drift")
    return protocol, sha256_bytes(raw)


def artifact_lookup(
    acquisition: Mapping[str, Any],
) -> dict[tuple[str, str], Mapping[str, Any]]:
    rows = require_list(acquisition.get("artifactPairs"), "acquisition.artifactPairs")
    output: dict[tuple[str, str], Mapping[str, Any]] = {}
    previous: tuple[str, str] | None = None
    for raw_row in rows:
        if not isinstance(raw_row, dict):
            raise CustodyError("artifact row must be an object")
        key = (
            require_text(raw_row.get("symbol"), "artifact.symbol"),
            require_text(raw_row.get("month"), "artifact.month"),
        )
        if previous is not None and key <= previous:
            raise CustodyError("artifact rows must be strictly sorted and unique")
        previous = key
        output[key] = raw_row
    if acquisition.get("artifactPairCount") != len(output):
        raise CustodyError("artifact pair count mismatch")
    return output


def expected_discovery_inventory(
    discovery: Mapping[str, Any],
    symbols: Sequence[str],
    months: Sequence[str],
) -> tuple[
    dict[tuple[str, str], tuple[Mapping[str, Any], Mapping[str, Any]]],
    list[str],
]:
    inventories = require_list(discovery.get("symbolInventories"), "discovery.symbolInventories")
    if len(inventories) != len(symbols):
        raise CustodyError("discovery inventory count differs from universe")
    expected_pairs: dict[tuple[str, str], tuple[Mapping[str, Any], Mapping[str, Any]]] = {}
    expected_absent: list[str] = []
    previous_symbol: str | None = None
    for index, raw_inventory in enumerate(inventories):
        inventory = require_dict(raw_inventory, "discovery.symbolInventories[]")
        symbol = require_text(inventory.get("symbol"), "inventory.symbol")
        if symbol != symbols[index] or (previous_symbol is not None and symbol <= previous_symbol):
            raise CustodyError("discovery inventories do not exactly match sorted universe")
        previous_symbol = symbol
        inventory_months = require_dict(inventory.get("months"), "inventory.months")
        if not set(inventory_months).issubset(months):
            raise CustodyError(f"discovery inventory has an out-of-scope month: {symbol}")
        for month in months:
            raw_artifacts = inventory_months.get(month)
            if raw_artifacts is None:
                expected_absent.append(f"{symbol}|{month}")
                continue
            artifacts = require_dict(raw_artifacts, f"inventory.{symbol}.{month}")
            zip_meta = artifacts.get("zip")
            checksum_meta = artifacts.get("checksum")
            if zip_meta is None and checksum_meta is None:
                expected_absent.append(f"{symbol}|{month}")
                continue
            if not isinstance(zip_meta, dict) or not isinstance(checksum_meta, dict):
                raise CustodyError(f"orphaned discovery archive pair: {symbol} {month}")
            expected_pairs[(symbol, month)] = (zip_meta, checksum_meta)
    return expected_pairs, expected_absent


def validate_artifact_rows(
    discovery: Mapping[str, Any],
    acquisition: Mapping[str, Any],
    symbols: Sequence[str],
    months: Sequence[str],
) -> dict[tuple[str, str], Mapping[str, Any]]:
    expected_pairs, expected_absent = expected_discovery_inventory(discovery, symbols, months)
    lookup = artifact_lookup(acquisition)
    if len(lookup) != len(expected_pairs):
        raise CustodyError("artifact row coverage differs from frozen discovery")
    row_digests: list[str] = []
    for key, row in lookup.items():
        expected = expected_pairs.get(key)
        if expected is None:
            raise CustodyError("acquisition includes a pair absent from discovery")
        symbol, month = key
        zip_meta, checksum_meta = expected
        expected_fields: dict[str, object] = {
            "zipKey": require_text(zip_meta.get("key"), "discovery.zip.key"),
            "zipFrozenEtag": require_text(zip_meta.get("etag"), "discovery.zip.etag"),
            "zipFrozenLastModified": require_text(
                zip_meta.get("lastModified"), "discovery.zip.lastModified"
            ),
            "zipListedBytes": require_int(zip_meta.get("size"), "discovery.zip.size"),
            "zipBytes": require_int(zip_meta.get("size"), "discovery.zip.size"),
            "checksumKey": require_text(checksum_meta.get("key"), "discovery.checksum.key"),
            "checksumFrozenEtag": require_text(
                checksum_meta.get("etag"), "discovery.checksum.etag"
            ),
            "checksumFrozenLastModified": require_text(
                checksum_meta.get("lastModified"), "discovery.checksum.lastModified"
            ),
            "checksumListedBytes": require_int(
                checksum_meta.get("size"), "discovery.checksum.size"
            ),
            "checksumBytes": require_int(checksum_meta.get("size"), "discovery.checksum.size"),
        }
        if any(row.get(field) != value for field, value in expected_fields.items()):
            raise CustodyError(f"artifact metadata differs from discovery: {symbol} {month}")
        zip_bytes = require_int(row.get("zipBytes"), "artifact.zipBytes")
        checksum_bytes = require_int(row.get("checksumBytes"), "artifact.checksumBytes")
        if not 0 < zip_bytes <= MAXIMUM_ZIP_BYTES:
            raise CustodyError(f"artifact ZIP size outside frozen bounds: {symbol} {month}")
        if not 0 < checksum_bytes <= MAXIMUM_CHECKSUM_BYTES:
            raise CustodyError(f"artifact sidecar size outside frozen bounds: {symbol} {month}")
        if row.get("state") not in {"DOWNLOADED_VERIFIED", "RESUMED_VERIFIED"}:
            raise CustodyError(f"artifact state invalid: {symbol} {month}")
        for field in ("zipSha256", "checksumSha256"):
            digest = require_text(row.get(field), f"artifact.{field}")
            if SHA256_RE.fullmatch(digest) is None:
                raise CustodyError(f"artifact digest malformed: {symbol} {month} {field}")
        row_digests.append(sha256_bytes(canonical_bytes(row)))
    if acquisition.get("artifactRowsSha256") != sha256_bytes(normalized_lines(row_digests)):
        raise CustodyError("artifact row digest mismatch")
    absent_raw = require_list(
        acquisition.get("absentSymbolMonths"), "acquisition.absentSymbolMonths"
    )
    if not all(isinstance(item, str) for item in absent_raw):
        raise CustodyError("acquisition absence row malformed")
    absent = [str(item) for item in absent_raw]
    if absent != sorted(set(absent)):
        raise CustodyError("acquisition absence rows not sorted unique")
    if acquisition.get("absentSymbolMonthCount") != len(absent):
        raise CustodyError("acquisition absence count mismatch")
    if acquisition.get("absentSha256") != sha256_bytes(normalized_lines(absent)):
        raise CustodyError("acquisition absence digest mismatch")
    if absent != sorted(expected_absent):
        raise CustodyError("acquisition absence coverage differs from discovery")
    return lookup


def normalized_inventory_digest(
    lookup: Mapping[tuple[str, str], Mapping[str, Any]],
    symbols: Sequence[str],
    months: Sequence[str],
) -> tuple[str, int, int]:
    lines: list[str] = []
    present = 0
    absent = 0
    for symbol in symbols:
        for month in months:
            row = lookup.get((symbol, month))
            if row is None:
                absent += 1
                lines.append(f"{symbol}|{month}|ABSENT")
                continue
            present += 1
            lines.append(
                "|".join(
                    (
                        symbol,
                        month,
                        require_text(row.get("zipSha256"), "artifact.zipSha256"),
                        require_text(row.get("checksumSha256"), "artifact.checksumSha256"),
                        str(require_int(row.get("zipBytes"), "artifact.zipBytes")),
                        str(require_int(row.get("checksumBytes"), "artifact.checksumBytes")),
                    )
                )
            )
    return (
        sha256_bytes(normalized_lines(lines)),
        present,
        absent,
    )


def protocol_target_months(protocol: Mapping[str, Any]) -> tuple[str, ...]:
    data = require_dict(protocol.get("data"), "data")
    bounds = require_list(data.get("targetMonthsInclusive"), "targetMonthsInclusive")
    if len(bounds) != 2 or not all(
        isinstance(month, str) and MONTH_RE.fullmatch(month) for month in bounds
    ):
        raise CustodyError("protocol target-month bounds malformed")
    months = month_range(str(bounds[0]), str(bounds[1]))
    if not months or months[0] != bounds[0] or months[-1] != bounds[1]:
        raise CustodyError("protocol target-month bounds invalid")
    return months


def discovery_months(discovery: Mapping[str, Any]) -> tuple[str, ...]:
    raw_months = require_list(discovery.get("targetMonths"), "discovery.targetMonths")
    if not all(isinstance(month, str) and MONTH_RE.fullmatch(month) for month in raw_months):
        raise CustodyError("discovery target month malformed")
    months = tuple(str(month) for month in raw_months)
    if not months or tuple(sorted(set(months))) != months:
        raise CustodyError("discovery target months must be sorted unique")
    return months


def require_continuous_target_subset(
    target_months: Sequence[str],
    shared_months: Sequence[str],
) -> None:
    target = tuple(target_months)
    shared = tuple(shared_months)
    try:
        start = shared.index(target[0])
    except (IndexError, ValueError) as error:
        raise CustodyError(
            "protocol target months are not a continuous ordered discovery subset"
        ) from error
    if shared[start : start + len(target)] != target:
        raise CustodyError("protocol target months are not a continuous ordered discovery subset")


def target_slice_lookup(
    full_lookup: Mapping[tuple[str, str], Mapping[str, Any]],
    target_months: Sequence[str],
) -> dict[tuple[str, str], Mapping[str, Any]]:
    target_set = set(target_months)
    return {key: row for key, row in full_lookup.items() if key[1] in target_set}


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
    data = require_dict(protocol.get("data"), "data")
    expected_evidence = require_dict(
        data.get("sharedManifestEvidence"), "data.sharedManifestEvidence"
    )
    if sha256_bytes(discovery_raw) != expected_evidence.get("discoverySha256") or sha256_bytes(
        acquisition_raw
    ) != expected_evidence.get("acquisitionSha256"):
        raise CustodyError("live shared-manifest bytes differ from protocol evidence")
    if discovery.get("schema") != "S1FArchiveDiscoveryV1":
        raise CustodyError("shared discovery schema mismatch")
    if discovery.get("state") != "METADATA_ONLY_NO_ARCHIVE_BODY_OPENED":
        raise CustodyError("shared discovery state mismatch")
    if acquisition.get("schema") != "S1FAcquisitionManifestV1":
        raise CustodyError("shared acquisition schema mismatch")
    if acquisition.get("state") != "CHECKSUM_VERIFIED_ARCHIVES_NOT_DECOMPRESSED":
        raise CustodyError("shared acquisition state mismatch")
    if acquisition.get("discoverySha256") != sha256_bytes(discovery_raw):
        raise CustodyError("acquisition does not bind discovery bytes")
    if acquisition.get("archiveBodiesDecompressed") is not False:
        raise CustodyError("shared acquisition custody declaration drift")
    universe = require_dict(discovery.get("universe"), "discovery.universe")
    raw_symbols = require_list(universe.get("symbols"), "discovery.universe.symbols")
    if not all(isinstance(symbol, str) and SYMBOL_RE.fullmatch(symbol) for symbol in raw_symbols):
        raise CustodyError("candidate universe has malformed symbol")
    symbols = tuple(raw_symbols)
    if tuple(sorted(set(symbols))) != symbols:
        raise CustodyError("candidate universe is not sorted unique")
    universe_raw = ("\n".join(symbols) + "\n").encode()
    if universe.get("count") != len(symbols) or universe.get("sha256") != sha256_bytes(
        universe_raw
    ):
        raise CustodyError("candidate universe digest mismatch")
    if universe.get("count") != expected_evidence.get("candidateUniverseCount") or universe.get(
        "sha256"
    ) != expected_evidence.get("candidateUniverseSha256"):
        raise CustodyError("candidate universe differs from protocol evidence")
    shared_months = discovery_months(discovery)
    if list(shared_months) != expected_evidence.get("discoveryTargetMonths") or len(
        shared_months
    ) != expected_evidence.get("discoveryTargetMonthCount"):
        raise CustodyError("discovery months differ from protocol evidence")
    if (
        acquisition.get("artifactPairCount") != expected_evidence.get("artifactPairCount")
        or acquisition.get("absentSymbolMonthCount")
        != expected_evidence.get("absentSymbolMonthCount")
        or acquisition.get("artifactRowsSha256") != expected_evidence.get("artifactRowsSha256")
        or acquisition.get("absentSha256") != expected_evidence.get("absentSymbolMonthsSha256")
    ):
        raise CustodyError("acquisition summary differs from protocol evidence")
    target_months = protocol_target_months(protocol)
    require_continuous_target_subset(target_months, shared_months)
    full_lookup = validate_artifact_rows(discovery, acquisition, symbols, shared_months)
    lookup = target_slice_lookup(full_lookup, target_months)
    return discovery, discovery_raw, acquisition, acquisition_raw, symbols, lookup


def enforce_source_root(
    protocol: Mapping[str, Any], source_root: Path, *, strict_paths: bool
) -> Path:
    resolved = source_root.resolve(strict=True)
    if strict_paths:
        expected = Path(
            require_text(
                require_dict(protocol.get("data"), "data").get("sharedSourceRoot"),
                "sharedSourceRoot",
            )
        ).resolve(strict=True)
        if resolved != expected or resolved != DEFAULT_SOURCE_ROOT.resolve(strict=True):
            raise CustodyError("shared source root differs from frozen exact path")
    return resolved


def enforce_state_root(
    protocol: Mapping[str, Any], state_root: Path, *, strict_paths: bool
) -> Path:
    actual = Path(os.path.abspath(state_root))
    if strict_paths:
        expected = Path(
            require_text(
                require_dict(protocol.get("runControl"), "runControl").get("stateRoot"),
                "runControl.stateRoot",
            )
        )
        if actual != expected or actual != DEFAULT_STATE_ROOT:
            raise CustodyError("state root differs from frozen exact path")
    return actual


def build_freeze(
    source_root: Path,
    *,
    packet_dir: Path = PACKET_DIR,
    strict_paths: bool = True,
) -> dict[str, Any]:
    protocol, protocol_sha = load_protocol(packet_dir / "protocol.v1.json")
    source_root = enforce_source_root(protocol, source_root, strict_paths=strict_paths)
    (
        discovery,
        discovery_raw,
        acquisition,
        acquisition_raw,
        symbols,
        lookup,
    ) = validate_source_manifests(source_root, protocol)
    shared_evidence = require_dict(
        require_dict(protocol.get("data"), "data").get("sharedManifestEvidence"),
        "data.sharedManifestEvidence",
    )
    months = protocol_target_months(protocol)
    inventory_sha, pair_count, absent_count = normalized_inventory_digest(lookup, symbols, months)
    return {
        "schema": "VG12FreezeV1",
        "state": "FROZEN_BEFORE_ANY_VG12_ARCHIVE_BODY_OPEN",
        "frozenAtUtc": utc_now(),
        "canonicalBaseCommit": protocol["canonicalBaseCommit"],
        "protocolSha256": protocol_sha,
        "packetSourceSha256": packet_source_bindings(packet_dir),
        "sourceRoot": str(source_root),
        "sourceMode": "READ_ONLY",
        "sharedDiscoverySha256": sha256_bytes(discovery_raw),
        "sharedAcquisitionSha256": sha256_bytes(acquisition_raw),
        "sharedDiscoveryObservedAtUtc": discovery.get("observedAtUtc"),
        "sharedAcquisitionCompletedAtUtc": acquisition.get("completedAtUtc"),
        "sharedDiscoveryTargetMonths": shared_evidence.get("discoveryTargetMonths"),
        "sharedDiscoveryTargetMonthCount": shared_evidence.get("discoveryTargetMonthCount"),
        "sharedCandidateUniverseCount": shared_evidence.get("candidateUniverseCount"),
        "sharedCandidateUniverseSha256": shared_evidence.get("candidateUniverseSha256"),
        "sharedArtifactRowsSha256": acquisition.get("artifactRowsSha256"),
        "sharedArtifactPairCount": acquisition.get("artifactPairCount"),
        "sharedAbsentSymbolMonthsSha256": acquisition.get("absentSha256"),
        "sharedAbsentSymbolMonthCount": acquisition.get("absentSymbolMonthCount"),
        "candidateUniverse": list(symbols),
        "candidateUniverseCount": len(symbols),
        "candidateUniverseSha256": sha256_bytes(("\n".join(symbols) + "\n").encode()),
        "targetMonths": list(months),
        "targetArtifactInventorySha256": inventory_sha,
        "targetArtifactPairCount": pair_count,
        "targetAbsentPairCount": absent_count,
        "trialId": TRIAL_ID,
        "attemptedTrialCount": 1,
        "costScenarios": {
            name: require_dict(require_dict(protocol.get("costs"), "costs").get(name), name)
            for name in SCENARIOS
        },
        "bootstrap": require_dict(
            require_dict(protocol.get("statistics"), "statistics").get("bootstrap"),
            "statistics.bootstrap",
        ),
        "runtime": runtime_binding(),
        "archiveBodiesOpenedByVG12": False,
        "holdoutArchiveBodiesOpenedByVG12": False,
    }


def freeze(
    source_root: Path = DEFAULT_SOURCE_ROOT,
    *,
    freeze_path: Path = FREEZE_PATH,
    packet_dir: Path = PACKET_DIR,
    strict_paths: bool = True,
) -> dict[str, Any]:
    if freeze_path.exists():
        raise EvidenceError(f"freeze already exists: {freeze_path}")
    if freeze_path == FREEZE_PATH and (
        RESULT_PATH.exists() or RUN_RECEIPT_PATH.exists() or CHECKSUMS_PATH.exists()
    ):
        raise EvidenceError("terminal packet artifact already exists")
    payload = build_freeze(source_root, packet_dir=packet_dir, strict_paths=strict_paths)
    write_exclusive(freeze_path, canonical_bytes(payload))
    return payload


def load_frozen(
    *,
    freeze_path: Path = FREEZE_PATH,
    packet_dir: Path = PACKET_DIR,
    source_root: Path | None = None,
    strict_paths: bool = True,
) -> tuple[
    dict[str, Any],
    dict[str, Any],
    dict[str, Any],
    tuple[str, ...],
    dict[tuple[str, str], Mapping[str, Any]],
    dict[str, str],
]:
    protocol, protocol_sha = load_protocol(packet_dir / "protocol.v1.json")
    freeze_payload, freeze_raw = load_json(freeze_path)
    if freeze_payload.get("schema") != "VG12FreezeV1":
        raise CustodyError("freeze schema mismatch")
    frozen_root = enforce_source_root(
        protocol,
        Path(require_text(freeze_payload.get("sourceRoot"), "freeze.sourceRoot")),
        strict_paths=strict_paths,
    )
    if source_root is not None:
        requested = enforce_source_root(protocol, source_root, strict_paths=strict_paths)
        if requested != frozen_root:
            raise CustodyError("requested source root differs from frozen source root")
    if freeze_payload.get("sourceMode") != "READ_ONLY":
        raise CustodyError("freeze source mode drift")
    if freeze_payload.get("protocolSha256") != protocol_sha:
        raise CustodyError("protocol bytes changed after freeze")
    if freeze_payload.get("packetSourceSha256") != packet_source_bindings(packet_dir):
        raise CustodyError("packet source bytes changed after freeze")
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
    ) = validate_source_manifests(frozen_root, protocol)
    shared_evidence = require_dict(
        require_dict(protocol.get("data"), "data").get("sharedManifestEvidence"),
        "data.sharedManifestEvidence",
    )
    if freeze_payload.get("sharedDiscoverySha256") != sha256_bytes(discovery_raw):
        raise CustodyError("shared discovery bytes changed after freeze")
    if freeze_payload.get("sharedAcquisitionSha256") != sha256_bytes(acquisition_raw):
        raise CustodyError("shared acquisition bytes changed after freeze")
    if (
        freeze_payload.get("sharedDiscoverySha256") != shared_evidence.get("discoverySha256")
        or freeze_payload.get("sharedAcquisitionSha256") != shared_evidence.get("acquisitionSha256")
        or freeze_payload.get("sharedDiscoveryTargetMonths")
        != shared_evidence.get("discoveryTargetMonths")
        or freeze_payload.get("sharedDiscoveryTargetMonthCount")
        != shared_evidence.get("discoveryTargetMonthCount")
        or freeze_payload.get("sharedCandidateUniverseCount")
        != shared_evidence.get("candidateUniverseCount")
        or freeze_payload.get("sharedCandidateUniverseSha256")
        != shared_evidence.get("candidateUniverseSha256")
        or freeze_payload.get("sharedArtifactRowsSha256") != acquisition.get("artifactRowsSha256")
        or freeze_payload.get("sharedArtifactRowsSha256")
        != shared_evidence.get("artifactRowsSha256")
        or freeze_payload.get("sharedArtifactPairCount") != acquisition.get("artifactPairCount")
        or freeze_payload.get("sharedArtifactPairCount") != shared_evidence.get("artifactPairCount")
        or freeze_payload.get("sharedAbsentSymbolMonthsSha256") != acquisition.get("absentSha256")
        or freeze_payload.get("sharedAbsentSymbolMonthsSha256")
        != shared_evidence.get("absentSymbolMonthsSha256")
        or freeze_payload.get("sharedAbsentSymbolMonthCount")
        != acquisition.get("absentSymbolMonthCount")
        or freeze_payload.get("sharedAbsentSymbolMonthCount")
        != shared_evidence.get("absentSymbolMonthCount")
    ):
        raise CustodyError("shared acquisition row or absence binding changed after freeze")
    if freeze_payload.get("candidateUniverse") != list(symbols):
        raise CustodyError("candidate universe changed after freeze")
    months = tuple(
        require_text(month, "freeze.targetMonths[]")
        for month in require_list(freeze_payload.get("targetMonths"), "freeze.targetMonths")
    )
    if months != protocol_target_months(protocol):
        raise CustodyError("freeze target months differ from protocol")
    inventory_sha, pair_count, absent_count = normalized_inventory_digest(lookup, symbols, months)
    if (
        freeze_payload.get("targetArtifactInventorySha256") != inventory_sha
        or freeze_payload.get("targetArtifactPairCount") != pair_count
        or freeze_payload.get("targetAbsentPairCount") != absent_count
    ):
        raise CustodyError("target inventory changed after freeze")
    bindings = {
        "protocolSha256": protocol_sha,
        "freezeSha256": sha256_bytes(freeze_raw),
        "sharedDiscoverySha256": sha256_bytes(discovery_raw),
        "sharedAcquisitionSha256": sha256_bytes(acquisition_raw),
        "targetArtifactInventorySha256": inventory_sha,
        **{f"packet:{name}": digest for name, digest in packet_source_bindings(packet_dir).items()},
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
        raise ArchiveSchemaError(f"{field} is not positive finite: {symbol} {month}")
    return parsed


def nonnegative_decimal(value: str, field: str, symbol: str, month: str) -> Decimal:
    try:
        parsed = Decimal(value)
    except InvalidOperation as error:
        raise ArchiveSchemaError(f"{field} malformed: {symbol} {month}") from error
    if not parsed.is_finite() or parsed < 0:
        raise ArchiveSchemaError(f"{field} is not nonnegative finite: {symbol} {month}")
    return parsed


def verify_sidecar(sidecar_raw: bytes, zip_name: str, archive_raw: bytes) -> None:
    try:
        parts = sidecar_raw.decode("ascii").strip().split()
    except UnicodeDecodeError as error:
        raise CustodyError(f"checksum sidecar not ASCII: {zip_name}") from error
    if len(parts) != 2 or parts[1] != zip_name or not re.fullmatch(r"[0-9a-fA-F]{64}", parts[0]):
        raise CustodyError(f"checksum sidecar shape mismatch: {zip_name}")
    if parts[0].lower() != sha256_bytes(archive_raw):
        raise CustodyError(f"official checksum mismatch: {zip_name}")


def read_bounded_regular(
    path: Path,
    *,
    expected_bytes: int,
    maximum_bytes: int,
    label: str,
) -> bytes:
    if not 0 < expected_bytes <= maximum_bytes:
        raise CustodyError(f"frozen {label} size outside bounds")
    flags = (
        os.O_RDONLY
        | getattr(os, "O_CLOEXEC", 0)
        | getattr(os, "O_NOFOLLOW", 0)
        | getattr(os, "O_NONBLOCK", 0)
    )
    try:
        descriptor = os.open(path, flags)
    except OSError as error:
        raise CustodyError(f"frozen {label} unavailable") from error
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode):
            raise CustodyError(f"frozen {label} is not a regular file")
        if not 0 < metadata.st_size <= maximum_bytes:
            raise CustodyError(f"frozen {label} size outside bounds")
        if metadata.st_size != expected_bytes:
            raise CustodyError(f"frozen {label} byte length changed")
        chunks: list[bytes] = []
        remaining = expected_bytes
        while remaining:
            chunk = os.read(descriptor, remaining)
            if not chunk:
                raise CustodyError(f"frozen {label} ended before its frozen length")
            chunks.append(chunk)
            remaining -= len(chunk)
        if os.read(descriptor, 1):
            raise CustodyError(f"frozen {label} grew during bounded read")
        return b"".join(chunks)
    except OSError as error:
        raise CustodyError(f"frozen {label} bounded read failed") from error
    finally:
        os.close(descriptor)


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
    expected_zip_bytes = require_int(row.get("zipBytes"), "artifact.zipBytes")
    expected_checksum_bytes = require_int(row.get("checksumBytes"), "artifact.checksumBytes")
    archive_raw = read_bounded_regular(
        archive_path,
        expected_bytes=expected_zip_bytes,
        maximum_bytes=MAXIMUM_ZIP_BYTES,
        label="ZIP",
    )
    sidecar_raw = read_bounded_regular(
        sidecar_path,
        expected_bytes=expected_checksum_bytes,
        maximum_bytes=MAXIMUM_CHECKSUM_BYTES,
        label="sidecar",
    )
    if sha256_bytes(archive_raw) != require_text(row.get("zipSha256"), "artifact.zipSha256"):
        raise CustodyError(f"archive digest changed: {symbol} {month}")
    if sha256_bytes(sidecar_raw) != require_text(
        row.get("checksumSha256"), "artifact.checksumSha256"
    ):
        raise CustodyError(f"sidecar digest changed: {symbol} {month}")
    verify_sidecar(sidecar_raw, zip_name, archive_raw)
    try:
        with zipfile.ZipFile(io.BytesIO(archive_raw)) as archive:
            expected_name = f"{symbol}-1d-{month}.csv"
            members = archive.infolist()
            if len(members) != 1:
                raise ArchiveSchemaError(f"ZIP member count invalid: {symbol} {month}")
            member = members[0]
            if member.filename != expected_name or member.is_dir():
                raise ArchiveSchemaError(f"ZIP member contract mismatch: {symbol} {month}")
            if (
                member.file_size <= 0
                or member.file_size > MAXIMUM_UNCOMPRESSED_CSV_BYTES
                or member.compress_type not in ALLOWED_ZIP_METHODS
                or member.flag_bits & ~ALLOWED_ZIP_FLAG_MASK
            ):
                raise ArchiveSchemaError(f"ZIP method/flag/size invalid: {symbol} {month}")
            ratio = Decimal(member.file_size) / Decimal(max(member.compress_size, 1))
            if ratio > MAXIMUM_COMPRESSION_RATIO:
                raise ArchiveSchemaError(f"ZIP compression ratio too high: {symbol} {month}")
            csv_raw = archive.read(member)
        reader = csv.reader(io.StringIO(csv_raw.decode("utf-8"), newline=""))
        bars: list[Bar] = []
        previous: date | None = None
        for index, csv_row in enumerate(reader):
            if (
                index == 0
                and csv_row
                and csv_row[0].strip().lower()
                in {
                    "open_time",
                    "opentime",
                }
            ):
                continue
            if len(csv_row) != 12:
                raise ArchiveSchemaError(
                    f"archive row has {len(csv_row)} columns: {symbol} {month}"
                )
            opened = parse_timestamp(csv_row[0], symbol, month)
            closed = parse_timestamp(csv_row[6], symbol, month)
            if opened.time() != datetime.min.time() or opened.strftime("%Y-%m") != month:
                raise ArchiveSchemaError(f"daily open/month invalid: {symbol} {month}")
            if int(csv_row[6]) - int(csv_row[0]) != DAY_US - 1:
                raise ArchiveSchemaError(f"daily close timestamp invalid: {symbol} {month}")
            if closed.date() != opened.date():
                raise ArchiveSchemaError(f"daily close crosses UTC day: {symbol} {month}")
            open_price = positive_float(csv_row[1], "open", symbol, month)
            high = positive_float(csv_row[2], "high", symbol, month)
            low = positive_float(csv_row[3], "low", symbol, month)
            close_price = positive_float(csv_row[4], "close", symbol, month)
            quote_volume = nonnegative_decimal(csv_row[7], "quote volume", symbol, month)
            if low > min(open_price, close_price) or high < max(open_price, close_price):
                raise ArchiveSchemaError(f"OHLC geometry invalid: {symbol} {month}")
            day = opened.date()
            if previous is not None and day <= previous:
                raise ArchiveSchemaError(f"archive days not strictly increasing: {symbol} {month}")
            previous = day
            bars.append(Bar(day, open_price, close_price, quote_volume))
    except ArchiveSchemaError:
        raise
    except (
        zipfile.BadZipFile,
        RuntimeError,
        UnicodeDecodeError,
        csv.Error,
        ValueError,
        OSError,
    ) as error:
        raise ArchiveSchemaError(
            f"checksum-valid archive has invalid internal semantics: {symbol} {month}"
        ) from error
    if not bars:
        raise ArchiveSchemaError(f"archive has no rows: {symbol} {month}")
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
                issues.append(
                    {
                        "symbol": symbol,
                        "month": month,
                        "kind": "MISSING_ARCHIVE_PAIR",
                        "reason": "artifact pair absent from frozen inventory",
                    }
                )
                continue
            try:
                parsed = parse_archive(source_root, row, symbol, month)
            except ArchiveSchemaError as error:
                issues.append(
                    {
                        "symbol": symbol,
                        "month": month,
                        "kind": "SEMANTIC_ANOMALY",
                        "reason": str(error),
                    }
                )
                continue
            for bar in parsed:
                if bar.day in series:
                    issues.append(
                        {
                            "symbol": symbol,
                            "month": month,
                            "kind": "SEMANTIC_ANOMALY",
                            "reason": f"duplicate day across archives: {bar.day}",
                        }
                    )
                    series = {
                        day: value
                        for day, value in series.items()
                        if day.strftime("%Y-%m") != month
                    }
                    break
                series[bar.day] = bar
        output[symbol] = series
    return output, issues


def merge_bars(
    destination: dict[str, dict[date, Bar]],
    additions: Mapping[str, Mapping[date, Bar]],
) -> None:
    for symbol, incoming in additions.items():
        series = destination.setdefault(symbol, {})
        overlap = set(series).intersection(incoming)
        if overlap:
            raise CustodyError(f"development/holdout bar overlap: {symbol}")
        series.update(incoming)


def issue_months(
    issues: Sequence[Mapping[str, str]],
) -> dict[str, set[str]]:
    output: dict[str, set[str]] = {}
    for issue in issues:
        output.setdefault(str(issue["symbol"]), set()).add(str(issue["month"]))
    return output


def normalized_entropy(volumes: Sequence[Decimal]) -> Decimal | None:
    if len(volumes) != 30:
        raise EvidenceError("entropy requires exactly 30 cohort members")
    if any(not value.is_finite() or value < 0 for value in volumes):
        raise EvidenceError("entropy mass must be nonnegative finite")
    with localcontext() as context:
        context.prec = DECIMAL_PRECISION
        context.rounding = ROUND_HALF_EVEN
        total = sum(volumes, Decimal(0))
        if total <= 0:
            return None
        entropy = -sum(
            ((value / total) * (value / total).ln() for value in volumes if value > 0),
            Decimal(0),
        )
        result = entropy / Decimal(30).ln()
        if not result.is_finite() or result < 0 or result > 1 + ENTROPY_TOLERANCE:
            raise EvidenceError("normalized entropy outside [0,1]")
        if abs(Decimal(1) - result) <= ENTROPY_TOLERANCE:
            return Decimal(1)
        return min(Decimal(1), +result)


def entropy_is_broadening(baseline: Decimal | None, recent: Decimal | None) -> bool:
    with localcontext(prec=DECIMAL_PRECISION, rounding=ROUND_HALF_EVEN):
        return baseline is not None and recent is not None and recent - baseline > ENTROPY_TOLERANCE


def formation_decimal_measurements(
    bars: Mapping[str, Mapping[date, Bar]],
    symbols: Sequence[str],
    anomalous: Mapping[str, set[str]],
    required_days: Sequence[date],
    required_months: set[str],
    liquidity_days: Sequence[date],
    base_days: Sequence[date],
    recent_days: Sequence[date],
) -> tuple[list[tuple[str, Decimal]], Decimal | None, Decimal | None, bool]:
    with localcontext(prec=DECIMAL_PRECISION, rounding=ROUND_HALF_EVEN):
        eligible: list[tuple[str, Decimal]] = []
        for symbol in symbols:
            if required_months.intersection(anomalous.get(symbol, set())):
                continue
            series = bars.get(symbol, {})
            if any(day not in series for day in required_days):
                continue
            median_liquidity = statistics.median(series[day].quote_volume for day in liquidity_days)
            if median_liquidity.is_finite() and median_liquidity > 0:
                eligible.append((symbol, median_liquidity))
        eligible.sort(key=lambda item: (-item[1], item[0]))
        if len(eligible) < 30:
            return eligible, None, None, False
        cohort = tuple(symbol for symbol, _ in eligible[:30])
        base_entropy = normalized_entropy(
            [
                sum(
                    (bars[symbol][day].quote_volume for day in base_days),
                    Decimal(0),
                )
                for symbol in cohort
            ]
        )
        recent_entropy = normalized_entropy(
            [
                sum(
                    (bars[symbol][day].quote_volume for day in recent_days),
                    Decimal(0),
                )
                for symbol in cohort
            ]
        )
        return (
            eligible,
            base_entropy,
            recent_entropy,
            entropy_is_broadening(base_entropy, recent_entropy),
        )


def build_formation(
    bars: Mapping[str, Mapping[date, Bar]],
    symbols: Sequence[str],
    issues: Sequence[Mapping[str, str]],
    entry_day: date,
) -> Formation:
    if entry_day.weekday() != 1:
        raise EvidenceError(f"entry is not Tuesday: {entry_day}")
    formation_day = entry_day - timedelta(days=1)
    exit_day = entry_day + timedelta(days=7)
    required_days = date_range(
        formation_day - timedelta(days=120),
        formation_day - timedelta(days=1),
    )
    required_months = {day.strftime("%Y-%m") for day in required_days}
    anomalous = issue_months(issues)
    liquidity_days = date_range(
        formation_day - timedelta(days=65),
        formation_day - timedelta(days=36),
    )
    base_days = date_range(
        formation_day - timedelta(days=35),
        formation_day - timedelta(days=8),
    )
    recent_days = date_range(
        formation_day - timedelta(days=7),
        formation_day - timedelta(days=1),
    )
    eligible, base_entropy, recent_entropy, broadening = formation_decimal_measurements(
        bars,
        symbols,
        anomalous,
        required_days,
        required_months,
        liquidity_days,
        base_days,
        recent_days,
    )
    if len(eligible) < 30:
        return Formation(
            formation_day,
            entry_day,
            exit_day,
            False,
            f"ELIGIBLE_SYMBOLS_{len(eligible)}_BELOW_30",
            (),
            {},
            None,
            None,
            False,
            len(eligible),
        )
    cohort_rows = eligible[:30]
    cohort = tuple(symbol for symbol, _ in cohort_rows)
    cohort_liquidity = dict(cohort_rows)
    return Formation(
        formation_day,
        entry_day,
        exit_day,
        True,
        None,
        cohort,
        cohort_liquidity,
        base_entropy,
        recent_entropy,
        broadening,
        len(eligible),
    )


def build_formations(
    bars: Mapping[str, Mapping[date, Bar]],
    symbols: Sequence[str],
    issues: Sequence[Mapping[str, str]],
    entries: Sequence[date],
) -> tuple[Formation, ...]:
    return tuple(build_formation(bars, symbols, issues, entry) for entry in entries)


def scenario(protocol: Mapping[str, Any], name: str) -> Scenario:
    costs = require_dict(protocol.get("costs"), "costs")
    row = require_dict(costs.get(name), f"costs.{name}")
    return Scenario(
        name,
        float(require_text(row.get("feeBpsPerFill"), "feeBpsPerFill")) / 10_000,
        float(require_text(row.get("adverseExecutionBpsPerFill"), "adverseExecutionBpsPerFill"))
        / 10_000,
    )


def simulation(
    bars: Mapping[str, Mapping[date, Bar]],
    formations: Sequence[Formation],
    cost: Scenario,
    *,
    benchmark: bool,
) -> Simulation:
    capital = 1000.0
    valid = 0
    broadening = 0
    invested = 0
    fills = 0
    distinct: set[str] = set()
    weekly_returns: list[tuple[date, float]] = []
    weekly_nav: list[tuple[date, float]] = []
    gross_by_symbol: dict[str, float] = {}
    participation: list[float] = []
    c1bp: list[float] = []
    for formation in formations:
        before = capital
        if formation.valid:
            valid += 1
            broadening += int(formation.broadening)
        should_invest = formation.valid and (benchmark or formation.broadening)
        if should_invest:
            invested += 1
            allocation = capital / 30
            spell_proceeds = 0.0
            weakest_liquidity = float(min(formation.liquidity.values()))
            c1bp.append(30 * weakest_liquidity * 0.0001)
            for symbol in formation.cohort:
                series = bars.get(symbol, {})
                entry = series.get(formation.entry_day)
                exit_bar = series.get(formation.exit_day)
                if entry is None or exit_bar is None:
                    raise SelectedEvidenceError(
                        f"held entry/exit missing: {symbol} "
                        f"{formation.entry_day}/{formation.exit_day}"
                    )
                for mark_day in date_range(
                    formation.entry_day, formation.exit_day - timedelta(days=1)
                ):
                    mark = series.get(mark_day)
                    if mark is None or not math.isfinite(mark.close_price):
                        raise SelectedEvidenceError(
                            f"held required mark missing: {symbol} {mark_day}"
                        )
                quantity = (
                    allocation * (1 - cost.fee_rate) / (entry.open_price * (1 + cost.adverse_rate))
                )
                proceeds = (
                    quantity * exit_bar.open_price * (1 - cost.adverse_rate) * (1 - cost.fee_rate)
                )
                spell_proceeds += proceeds
                fills += 2
                distinct.add(symbol)
                gross_by_symbol[symbol] = gross_by_symbol.get(symbol, 0.0) + (
                    allocation * (exit_bar.open_price / entry.open_price - 1)
                )
                liquidity = float(formation.liquidity[symbol])
                participation.extend(
                    (
                        allocation / liquidity * 10_000,
                        (quantity * exit_bar.open_price) / liquidity * 10_000,
                    )
                )
            capital = spell_proceeds
        weekly_return = capital / before - 1 if before > 0 else -1.0
        weekly_returns.append((formation.exit_day, weekly_return))
        weekly_nav.append((formation.exit_day, capital))
    return Simulation(
        scenario=cost.name,
        benchmark=benchmark,
        scheduled_formations=len(formations),
        valid_formations=valid,
        broadening_formations=broadening,
        non_broadening_formations=valid - broadening,
        invested_formations=invested,
        fills=fills,
        distinct_symbols=distinct,
        weekly_returns=weekly_returns,
        weekly_nav=weekly_nav,
        gross_by_symbol=gross_by_symbol,
        participation_bps=participation,
        c1bp_usd=c1bp,
        terminal_nav=capital,
    )


def circular_block_samples(
    values: Sequence[float],
    *,
    block_length: int,
    replicates: int,
    seed: int,
) -> list[list[float]]:
    if not values:
        raise EvidenceError("bootstrap requires observations")
    if block_length <= 0 or replicates <= 0:
        raise EvidenceError("bootstrap controls must be positive")
    rng = random.Random(seed)
    n = len(values)
    samples: list[list[float]] = []
    for _ in range(replicates):
        sample: list[float] = []
        while len(sample) < n:
            start = rng.randrange(n)
            sample.extend(values[(start + offset) % n] for offset in range(block_length))
        samples.append(sample[:n])
    return samples


def percentile(values: Sequence[float], probability: float) -> float:
    ordered = sorted(values)
    if not ordered:
        raise EvidenceError("percentile requires observations")
    index = max(0, min(len(ordered) - 1, math.floor(probability * (len(ordered) - 1))))
    return ordered[index]


def bootstrap_packet(
    returns: Sequence[float],
    *,
    benchmark_returns: Sequence[float] | None,
    block_length: int,
    replicates: int,
    seed: int,
) -> dict[str, float | int | str]:
    if any(value <= -1 or not math.isfinite(value) for value in returns):
        raise EvidenceError("bootstrap return is non-finite or at/below -100%")
    samples = circular_block_samples(
        returns,
        block_length=block_length,
        replicates=replicates,
        seed=seed,
    )
    net_distribution = [1000 * (math.prod(1 + value for value in sample) - 1) for sample in samples]
    logs = [math.log1p(value) for value in returns]
    observed_log = sum(logs)
    mean_log = statistics.fmean(logs)
    centered = [value - mean_log for value in logs]
    null_samples = circular_block_samples(
        centered,
        block_length=block_length,
        replicates=replicates,
        seed=seed + 1,
    )
    exceedances = sum(sum(sample) >= observed_log for sample in null_samples)
    output: dict[str, float | int | str] = {
        "method": "SEEDED_SYNCHRONOUS_CIRCULAR_BLOCK",
        "observations": len(returns),
        "blockLengthWeeks": block_length,
        "replicates": replicates,
        "seed": seed,
        "netUsdPerInitial1000Lcb5Pct": percentile(net_distribution, 0.05),
        "oneSidedP": (exceedances + 1) / (replicates + 1),
    }
    if benchmark_returns is not None:
        if len(benchmark_returns) != len(returns):
            raise EvidenceError("benchmark return length mismatch")
        excess_logs = [
            math.log1p(strategy) - math.log1p(benchmark)
            for strategy, benchmark in zip(returns, benchmark_returns, strict=True)
        ]
        excess_samples = circular_block_samples(
            excess_logs,
            block_length=block_length,
            replicates=replicates,
            seed=seed + 2,
        )
        output["matchedBenchmarkExcessUsdLcb5Pct"] = percentile(
            [1000 * (math.exp(sum(sample)) - 1) for sample in excess_samples],
            0.05,
        )
    return output


def maximum_drawdown_pct(nav: Sequence[tuple[date, float]]) -> float:
    peak = 1000.0
    maximum = 0.0
    for _, value in nav:
        peak = max(peak, value)
        maximum = max(maximum, (peak - value) / peak * 100)
    return maximum


def positive_exit_months(
    returns: Sequence[tuple[date, float]], required_exit_months: Sequence[str]
) -> tuple[int, dict[str, float]]:
    if list(required_exit_months) != sorted(set(required_exit_months)):
        raise EvidenceError("required exit-month buckets must be sorted unique")
    values: dict[str, list[float]] = {month: [] for month in required_exit_months}
    for day, value in returns:
        month = day.strftime("%Y-%m")
        if month in values:
            values[month].append(value)
    missing = [month for month, month_returns in values.items() if not month_returns]
    if missing:
        raise EvidenceError(f"required exit-month bucket has no return: {','.join(missing)}")
    compounded = {
        month: math.prod(1 + value for value in month_returns) - 1
        for month, month_returns in values.items()
    }
    return sum(value > 0 for value in compounded.values()), compounded


def top_positive_profit_share_pct(gross_by_symbol: Mapping[str, float]) -> float:
    positives = [value for value in gross_by_symbol.values() if value > 0]
    if not positives:
        return 100.0
    return max(positives) / sum(positives) * 100


def simulation_summary(value: Simulation, required_exit_months: Sequence[str]) -> dict[str, Any]:
    positive_count, month_returns = positive_exit_months(value.weekly_returns, required_exit_months)
    return {
        "scenario": value.scenario,
        "benchmark": value.benchmark,
        "scheduledFormations": value.scheduled_formations,
        "validFormations": value.valid_formations,
        "broadeningFormations": value.broadening_formations,
        "nonBroadeningOrTieFormations": value.non_broadening_formations,
        "investedFormations": value.invested_formations,
        "fills": value.fills,
        "distinctHeldSymbols": len(value.distinct_symbols),
        "terminalNavUsd": value.terminal_nav,
        "netUsdPerInitial1000": value.terminal_nav - 1000,
        "positiveExitMonths": positive_count,
        "exitMonthReturns": month_returns,
        "weeklyCloseMaxDrawdownPct": maximum_drawdown_pct(value.weekly_nav),
        "topAssetPositiveGrossProfitSharePct": top_positive_profit_share_pct(value.gross_by_symbol),
        "capacityProxy": {
            "label": "PUBLIC_QUOTE_VOLUME_PARTICIPATION_PROXY_ONLY",
            "maximumParticipationBps": max(value.participation_bps, default=0.0),
            "minimumC1bpUsd": min(value.c1bp_usd, default=0.0),
            "executableBookCapacity": "UNMEASURED",
        },
        "weeklyReturns": [
            {"exitDate": day.isoformat(), "return": item} for day, item in value.weekly_returns
        ],
    }


def period_analysis(
    bars: Mapping[str, Mapping[date, Bar]],
    formations: Sequence[Formation],
    protocol: Mapping[str, Any],
    *,
    required_exit_months: Sequence[str],
    seed: int,
) -> dict[str, Any]:
    scenarios: dict[str, Any] = {}
    runs: dict[str, tuple[Simulation, Simulation]] = {}
    for name in SCENARIOS:
        cost = scenario(protocol, name)
        strategy_run = simulation(bars, formations, cost, benchmark=False)
        benchmark_run = simulation(bars, formations, cost, benchmark=True)
        runs[name] = (strategy_run, benchmark_run)
        scenarios[name] = {
            "strategy": simulation_summary(strategy_run, required_exit_months),
            "matchedAlwaysInvestedBenchmark": simulation_summary(
                benchmark_run, required_exit_months
            ),
        }
    stress_strategy, stress_benchmark = runs["STRESS"]
    bootstrap = require_dict(
        require_dict(protocol.get("statistics"), "statistics").get("bootstrap"),
        "statistics.bootstrap",
    )
    inference = bootstrap_packet(
        [value for _, value in stress_strategy.weekly_returns],
        benchmark_returns=[value for _, value in stress_benchmark.weekly_returns],
        block_length=require_int(bootstrap.get("blockLengthWeeks"), "bootstrap.blockLengthWeeks"),
        replicates=require_int(bootstrap.get("replicates"), "bootstrap.replicates"),
        seed=seed,
    )
    return {
        "trialId": TRIAL_ID,
        "attemptedTrialCount": 1,
        "formations": [
            {
                "formationDate": item.formation_day.isoformat(),
                "entryDate": item.entry_day.isoformat(),
                "exitDate": item.exit_day.isoformat(),
                "valid": item.valid,
                "invalidReason": item.invalid_reason,
                "eligibleSymbols": item.eligible_symbols,
                "cohort": list(item.cohort),
                "baseEntropy": str(item.base_entropy) if item.base_entropy is not None else None,
                "recentEntropy": (
                    str(item.recent_entropy) if item.recent_entropy is not None else None
                ),
                "broadening": item.broadening,
            }
            for item in formations
        ],
        "scenarios": scenarios,
        "stressInference": inference,
    }


def gate(
    decisions: list[dict[str, Any]],
    gate_id: str,
    observed: float | int,
    operator: str,
    threshold: float | int,
) -> None:
    if operator == ">=":
        passed = observed >= threshold
    elif operator == "<=":
        passed = observed <= threshold
    elif operator == ">":
        passed = observed > threshold
    elif operator == "<":
        passed = observed < threshold
    else:
        raise EvidenceError(f"unknown gate operator: {operator}")
    decisions.append(
        {
            "gateId": gate_id,
            "observed": observed,
            "operator": operator,
            "threshold": threshold,
            "passed": passed,
        }
    )


def evaluate_period_gates(
    protocol: Mapping[str, Any],
    period_name: str,
    analysis: Mapping[str, Any],
) -> list[dict[str, Any]]:
    if period_name not in {"development", "holdout"}:
        raise EvidenceError(f"unknown gate period: {period_name}")
    gates = require_dict(protocol.get("gates"), "gates")
    decisions: list[dict[str, Any]] = []
    frozen = require_dict(gates.get(period_name), f"gates.{period_name}")
    scenarios = require_dict(analysis.get("scenarios"), f"{period_name}.scenarios")
    stress = require_dict(
        require_dict(scenarios.get("STRESS"), "STRESS").get("strategy"),
        "STRESS.strategy",
    )
    inference = require_dict(analysis.get("stressInference"), f"{period_name}.stressInference")
    prefix = period_name.upper()
    gate(
        decisions,
        f"{prefix}_VALID_FORMATIONS",
        require_int(stress.get("validFormations"), "validFormations"),
        ">=",
        require_int(frozen.get("minimumValidFormations"), "minimumValidFormations"),
    )
    gate(
        decisions,
        f"{prefix}_BROADENING_FORMATIONS",
        require_int(stress.get("broadeningFormations"), "broadeningFormations"),
        ">=",
        require_int(
            frozen.get("minimumBroadeningFormations"),
            "minimumBroadeningFormations",
        ),
    )
    gate(
        decisions,
        f"{prefix}_NON_BROADENING_FORMATIONS",
        require_int(
            stress.get("nonBroadeningOrTieFormations"),
            "nonBroadeningOrTieFormations",
        ),
        ">=",
        require_int(
            frozen.get("minimumNonBroadeningOrTieFormations"),
            "minimumNonBroadeningOrTieFormations",
        ),
    )
    gate(
        decisions,
        f"{prefix}_FILLS",
        require_int(stress.get("fills"), "fills"),
        ">=",
        require_int(frozen.get("minimumFills"), "minimumFills"),
    )
    gate(
        decisions,
        f"{prefix}_DISTINCT_HELD_SYMBOLS",
        require_int(stress.get("distinctHeldSymbols"), "distinctHeldSymbols"),
        ">=",
        require_int(
            frozen.get("minimumDistinctHeldSymbols"),
            "minimumDistinctHeldSymbols",
        ),
    )
    gate(
        decisions,
        f"{prefix}_POSITIVE_STRESS_EXIT_MONTHS",
        require_int(stress.get("positiveExitMonths"), "positiveExitMonths"),
        ">=",
        require_int(
            frozen.get("minimumPositiveStressExitMonths"),
            "minimumPositiveStressExitMonths",
        ),
    )
    exit_month_returns = require_dict(stress.get("exitMonthReturns"), "exitMonthReturns")
    gate(
        decisions,
        f"{prefix}_REQUIRED_STRESS_EXIT_MONTHS",
        len(exit_month_returns),
        ">=",
        require_int(frozen.get("requiredStressExitMonths"), "requiredStressExitMonths"),
    )
    gate(
        decisions,
        f"{prefix}_STRESS_NET",
        float(stress["netUsdPerInitial1000"]),
        ">",
        float(frozen["stressNetExclusiveMinimumUsd"]),
    )
    gate(
        decisions,
        f"{prefix}_STRESS_LCB",
        float(inference["netUsdPerInitial1000Lcb5Pct"]),
        ">",
        float(frozen["stressLcbExclusiveMinimumUsd"]),
    )
    gate(
        decisions,
        f"{prefix}_STRESS_ONE_SIDED_P",
        float(inference["oneSidedP"]),
        "<",
        float(frozen["stressOneSidedPExclusiveMaximum"]),
    )
    gate(
        decisions,
        f"{prefix}_MATCHED_BENCHMARK_EXCESS_LCB",
        float(inference["matchedBenchmarkExcessUsdLcb5Pct"]),
        ">",
        float(frozen["matchedBenchmarkExcessLcbExclusiveMinimumUsd"]),
    )
    if period_name == "holdout":
        for scenario_name, key in (
            ("BASE", "baseNetExclusiveMinimumUsd"),
            ("FEE_STRESS", "feeStressNetExclusiveMinimumUsd"),
        ):
            summary = require_dict(
                require_dict(scenarios.get(scenario_name), scenario_name).get("strategy"),
                f"{scenario_name}.strategy",
            )
            gate(
                decisions,
                f"HOLDOUT_{scenario_name}_NET",
                float(summary["netUsdPerInitial1000"]),
                ">",
                float(frozen[key]),
            )
        gate(
            decisions,
            "HOLDOUT_MAX_WEEKLY_CLOSE_DRAWDOWN",
            float(stress["weeklyCloseMaxDrawdownPct"]),
            "<=",
            float(frozen["maximumWeeklyCloseDrawdownPct"]),
        )
        gate(
            decisions,
            "HOLDOUT_TOP_ASSET_POSITIVE_GROSS_SHARE",
            float(stress["topAssetPositiveGrossProfitSharePct"]),
            "<=",
            float(frozen["maximumTopAssetPositiveGrossProfitSharePct"]),
        )
        capacity = require_dict(stress.get("capacityProxy"), "capacityProxy")
        gate(
            decisions,
            "HOLDOUT_MAX_PARTICIPATION_PROXY",
            float(capacity["maximumParticipationBps"]),
            "<=",
            float(frozen["maximumParticipationBps"]),
        )
        gate(
            decisions,
            "HOLDOUT_MINIMUM_C1BP_PROXY",
            float(capacity["minimumC1bpUsd"]),
            ">=",
            float(frozen["minimumC1bpUsd"]),
        )
    return decisions


def evaluate_gates(
    protocol: Mapping[str, Any],
    development: Mapping[str, Any],
    holdout: Mapping[str, Any],
) -> tuple[list[dict[str, Any]], str]:
    decisions = evaluate_period_gates(protocol, "development", development)
    decisions.extend(evaluate_period_gates(protocol, "holdout", holdout))
    return decisions, "GO" if all(item["passed"] for item in decisions) else "NO_GO"


def result_limitations(protocol: Mapping[str, Any]) -> list[str]:
    return [
        require_text(value, "limitationsRequiredInEveryTerminalResult[]")
        for value in require_list(
            protocol.get("limitationsRequiredInEveryTerminalResult"),
            "limitationsRequiredInEveryTerminalResult",
        )
    ]


def base_result(
    protocol: Mapping[str, Any],
    bindings: Mapping[str, Any],
    *,
    started_at: str,
    completed_at: str,
    pre_run_git: Mapping[str, Any],
) -> dict[str, Any]:
    return {
        "schema": "VG12ResultV1",
        "protocolId": protocol["protocolId"],
        "trialId": TRIAL_ID,
        "attemptedTrialCount": 1,
        "startedAtUtc": started_at,
        "completedAtUtc": completed_at,
        "bindings": dict(bindings),
        "preRunGit": dict(pre_run_git),
        "authority": {
            "scope": "PUBLIC_RESEARCH_ONLY",
            "capitalVerdict": "NO_GO",
            "capitalAuthority": "NONE",
            "executionAuthority": "NONE",
        },
        "globalSearch": require_dict(
            require_dict(protocol.get("statistics"), "statistics").get("globalSearch"),
            "statistics.globalSearch",
        ),
        "limitations": result_limitations(protocol),
    }


def terminal_unmeasured(
    protocol: Mapping[str, Any],
    bindings: Mapping[str, Any],
    *,
    started_at: str,
    phase: str,
    error: BaseException,
    source_issues: Sequence[Mapping[str, str]],
    pre_run_git: Mapping[str, Any],
) -> dict[str, Any]:
    result = base_result(
        protocol,
        bindings,
        started_at=started_at,
        completed_at=utc_now(),
        pre_run_git=pre_run_git,
    )
    result.update(
        {
            "state": "TERMINAL_UNMEASURED_NO_REPAIR_OR_RERUN",
            "terminalPhase": phase,
            "reasonCode": type(error).__name__.upper(),
            "reason": str(error),
            "sourceIssues": list(source_issues),
            "development": None,
            "holdout": None,
            "gateDecisions": [],
            "measurementVerdict": "UNMEASURED",
        }
    )
    return result


def marker_record(state_root: Path, name: str) -> dict[str, Any] | None:
    path = state_root / name
    if not path.exists():
        return None
    payload, raw = load_json(path)
    if raw != canonical_bytes(payload):
        raise CustodyError(f"marker is not canonical JSON: {name}")
    return {"filename": name, "sha256": sha256_bytes(raw), "payload": payload}


def persist_terminal_draft(
    state_root: Path,
    result: Mapping[str, Any],
) -> dict[str, Any]:
    path = state_root / TERMINAL_DRAFT_NAME
    raw = canonical_bytes(result)
    if path.exists():
        payload, existing_raw = load_json(path)
        if existing_raw != canonical_bytes(payload) or existing_raw != raw:
            raise CustodyError("durable terminal-result draft already differs")
    else:
        write_exclusive(path, raw)
        payload = dict(result)
        existing_raw = raw
    return {
        "filename": TERMINAL_DRAFT_NAME,
        "sha256": sha256_bytes(existing_raw),
        "payload": payload,
    }


def terminal_draft_record(state_root: Path) -> dict[str, Any] | None:
    return marker_record(state_root, TERMINAL_DRAFT_NAME)


def write_run_receipt(
    state_root: Path,
    receipt_path: Path,
    *,
    terminal_phase: str,
) -> str:
    markers: dict[str, dict[str, Any] | None] = {
        "runMarker": marker_record(state_root, "run-marker.v1.json"),
        "candidateSeal": marker_record(state_root, "candidate-seal.v1.json"),
        "holdoutOpen": marker_record(state_root, "holdout-open.v1.json"),
    }
    if markers["runMarker"] is None:
        raise CustodyError("run marker missing at receipt")
    terminal_draft = terminal_draft_record(state_root)
    if terminal_draft is None:
        raise CustodyError("durable terminal-result draft missing at receipt")
    journal_entries, journal_raw = read_phase_journal(state_root)
    if (
        require_dict(journal_entries[-1], "phaseJournal.last").get("detailSha256")
        != terminal_draft["sha256"]
    ):
        raise CustodyError("terminal journal does not bind durable result draft")
    payload: dict[str, Any] = {
        "schema": "VG12RunReceiptV1",
        "state": "SELF_AUTHENTICATING_IMMUTABLE_PACKET_COPY_OF_ONE_USE_STATE",
        "createdAtUtc": utc_now(),
        "stateRoot": str(state_root),
        "terminalPhase": terminal_phase,
        "markers": markers,
        "phaseJournal": {
            "filename": PHASE_JOURNAL_NAME,
            "sha256": sha256_bytes(journal_raw),
            "entries": journal_entries,
        },
        "terminalResultDraft": terminal_draft,
    }
    write_exclusive(receipt_path, canonical_bytes(payload))
    return sha256_path(receipt_path)


def authenticate_receipt_copy(
    receipt: Mapping[str, Any],
    *,
    run_marker_sha256: str,
) -> None:
    if (
        receipt.get("schema") != "VG12RunReceiptV1"
        or receipt.get("state") != "SELF_AUTHENTICATING_IMMUTABLE_PACKET_COPY_OF_ONE_USE_STATE"
    ):
        raise CustodyError("run receipt schema/state mismatch")
    if set(receipt) != {
        "schema",
        "state",
        "createdAtUtc",
        "stateRoot",
        "terminalPhase",
        "markers",
        "phaseJournal",
        "terminalResultDraft",
    }:
        raise CustodyError("run receipt field roster mismatch")
    markers = require_dict(receipt.get("markers"), "receipt.markers")
    run_record = require_dict(markers.get("runMarker"), "receipt.markers.runMarker")
    payload = require_dict(run_record.get("payload"), "receipt.runMarker.payload")
    if (
        set(run_record) != {"filename", "sha256", "payload"}
        or run_record.get("filename") != "run-marker.v1.json"
        or run_record.get("sha256") != sha256_bytes(canonical_bytes(payload))
        or run_record.get("sha256") != run_marker_sha256
    ):
        raise CustodyError("run receipt marker copy does not self-authenticate")
    journal = require_dict(receipt.get("phaseJournal"), "receipt.phaseJournal")
    entries = require_list(journal.get("entries"), "receipt.phaseJournal.entries")
    journal_raw = b"".join(canonical_bytes(entry) for entry in entries)
    if (
        journal.get("filename") != PHASE_JOURNAL_NAME
        or journal.get("sha256") != sha256_bytes(journal_raw)
        or not entries
    ):
        raise CustodyError("run receipt journal copy does not self-authenticate")
    for ordinal, raw_entry in enumerate(entries, start=1):
        entry = require_dict(raw_entry, "receipt.phaseJournal.entries[]")
        if (
            entry.get("schema") != "VG12PhaseJournalEntryV1"
            or entry.get("ordinal") != ordinal
            or entry.get("runMarkerSha256") != run_marker_sha256
        ):
            raise CustodyError("run receipt journal entry contract mismatch")
    if require_dict(entries[-1], "receipt.phaseJournal.last").get("phase") != (
        "TERMINAL_FINALIZING"
    ):
        raise CustodyError("run receipt journal is not terminal")
    draft = require_dict(receipt.get("terminalResultDraft"), "receipt.terminalResultDraft")
    draft_payload = require_dict(draft.get("payload"), "receipt.terminalResultDraft.payload")
    if (
        set(draft) != {"filename", "sha256", "payload"}
        or draft.get("filename") != TERMINAL_DRAFT_NAME
        or draft.get("sha256") != sha256_bytes(canonical_bytes(draft_payload))
    ):
        raise CustodyError("run receipt terminal-result draft does not self-authenticate")
    if require_dict(entries[-1], "receipt.phaseJournal.last").get("detailSha256") != draft.get(
        "sha256"
    ):
        raise CustodyError("run receipt terminal phase does not bind terminal-result draft")
    for marker_name, filename in (
        ("candidateSeal", "candidate-seal.v1.json"),
        ("holdoutOpen", "holdout-open.v1.json"),
    ):
        record = markers.get(marker_name)
        if record is None:
            continue
        marker_record_payload = require_dict(record, f"receipt.markers.{marker_name}")
        marker_payload = require_dict(
            marker_record_payload.get("payload"), f"receipt.{marker_name}.payload"
        )
        if (
            set(marker_record_payload) != {"filename", "sha256", "payload"}
            or marker_record_payload.get("filename") != filename
            or marker_record_payload.get("sha256") != sha256_bytes(canonical_bytes(marker_payload))
        ):
            raise CustodyError(f"run receipt {marker_name} copy does not self-authenticate")


def finalize_unmeasured_only(
    *,
    state_root: Path = DEFAULT_STATE_ROOT,
    freeze_path: Path = FREEZE_PATH,
    result_path: Path = RESULT_PATH,
    receipt_path: Path = RUN_RECEIPT_PATH,
    packet_dir: Path = PACKET_DIR,
    strict_paths: bool = True,
) -> dict[str, Any]:
    """Finalize an already-consumed run without reopening source evidence."""
    if result_path.exists():
        raise EvidenceError("terminal result already exists")
    protocol, protocol_sha = load_protocol(packet_dir / "protocol.v1.json")
    state_root = enforce_state_root(protocol, state_root, strict_paths=strict_paths)
    if state_root.is_symlink() or not state_root.is_dir():
        raise EvidenceError("existing one-run state root unavailable")
    freeze_payload, freeze_raw = load_json(freeze_path)
    if (
        freeze_payload.get("schema") != "VG12FreezeV1"
        or freeze_payload.get("protocolSha256") != protocol_sha
        or freeze_payload.get("packetSourceSha256") != packet_source_bindings(packet_dir)
    ):
        raise CustodyError("freeze/source binding changed before interruption finalization")
    run_record = marker_record(state_root, "run-marker.v1.json")
    if run_record is None:
        raise EvidenceError("interruption finalization requires an existing run marker")
    run_marker = require_dict(run_record.get("payload"), "runMarker.payload")
    run_marker_sha = require_text(run_record.get("sha256"), "runMarker.sha256")
    if (
        run_marker.get("schema") != "VG12RunMarkerV1"
        or run_marker.get("state") != "SOLE_DEVELOPMENT_ARCHIVE_OPEN_RUN_CONSUMED"
        or run_marker.get("trialId") != TRIAL_ID
        or run_marker.get("attemptedTrialCount") != 1
        or run_marker.get("allowedRunCount") != 1
        or run_marker.get("consumedRunCount") != 1
        or run_marker.get("networkPermitted") is not False
        or run_marker.get("sharedSourceMutationPermitted") is not False
        or run_marker.get("protocolSha256") != protocol_sha
        or run_marker.get("freezeSha256") != sha256_bytes(freeze_raw)
    ):
        raise CustodyError("existing run marker contract mismatch")
    pre_run_git = require_dict(run_marker.get("preRunGit"), "runMarker.preRunGit")
    if run_marker.get("preRunGitSha256") != sha256_bytes(canonical_bytes(pre_run_git)):
        raise CustodyError("existing run marker Git snapshot binding mismatch")
    journal_path = state_root / PHASE_JOURNAL_NAME
    if not journal_path.exists():
        append_phase(
            state_root,
            "RUN_MARKER_WRITTEN",
            run_marker_sha256=run_marker_sha,
            detail_sha256=require_text(
                run_marker.get("preRunGitSha256"), "runMarker.preRunGitSha256"
            ),
        )
    entries, _ = read_phase_journal(state_root)
    if any(entry.get("runMarkerSha256") != run_marker_sha for entry in entries):
        raise CustodyError("phase journal binds a different run marker")
    terminal_positions = [
        index for index, entry in enumerate(entries) if entry.get("phase") == "TERMINAL_FINALIZING"
    ]
    if terminal_positions and terminal_positions != [len(entries) - 1]:
        raise CustodyError("phase journal has nonterminal data after finalization")
    draft_record = terminal_draft_record(state_root)
    if draft_record is None:
        if terminal_positions:
            raise CustodyError("terminal journal exists without its durable result draft")
        bindings: dict[str, Any] = {
            key: value
            for key, value in run_marker.items()
            if (
                key.endswith("Sha256")
                or key.startswith("packet:")
                or key in {"preRunCommit", "preRunTree", "preRunParent"}
            )
        }
        bindings["runMarkerSha256"] = run_marker_sha
        for name, binding_name in (
            ("candidate-seal.v1.json", "candidateSealSha256"),
            ("holdout-open.v1.json", "holdoutOpenSha256"),
        ):
            record = marker_record(state_root, name)
            if record is not None:
                bindings[binding_name] = require_text(record.get("sha256"), f"{name}.sha256")
        result = base_result(
            protocol,
            bindings,
            started_at=require_text(run_marker.get("startedAtUtc"), "runMarker.startedAtUtc"),
            completed_at=utc_now(),
            pre_run_git=pre_run_git,
        )
        result.update(
            {
                "state": "TERMINAL_UNMEASURED_NO_REPAIR_OR_RERUN",
                "terminalPhase": "INTERRUPTION_RECOVERY_WITHOUT_ARCHIVE_REOPEN",
                "reasonCode": "INTERRUPTED_RUN_FINALIZED_WITHOUT_REOPEN",
                "reason": (
                    "an existing consumed run was finalized without archive reopen, "
                    "repair, rerun, or retuning"
                ),
                "sourceIssues": [],
                "development": None,
                "holdout": None,
                "gateDecisions": [],
                "measurementVerdict": "UNMEASURED",
            }
        )
        draft_record = persist_terminal_draft(state_root, result)
    else:
        result = require_dict(draft_record.get("payload"), "terminalDraft.payload")
    if (
        require_dict(result.get("bindings"), "terminalDraft.bindings").get("runMarkerSha256")
        != run_marker_sha
        or result.get("schema") != "VG12ResultV1"
        or result.get("measurementVerdict") not in {"GO", "NO_GO", "UNMEASURED"}
    ):
        raise CustodyError("durable terminal-result draft does not bind this run")
    draft_sha = require_text(draft_record.get("sha256"), "terminalDraft.sha256")
    if terminal_positions:
        if entries[-1].get("detailSha256") != draft_sha:
            raise CustodyError("terminal journal binds a different result draft")
    else:
        append_phase(
            state_root,
            "TERMINAL_FINALIZING",
            run_marker_sha256=run_marker_sha,
            detail_sha256=draft_sha,
        )
    if receipt_path.exists():
        receipt, receipt_raw = load_json(receipt_path)
        if receipt_raw != canonical_bytes(receipt):
            raise CustodyError("existing run receipt is not canonical")
        authenticate_receipt_copy(receipt, run_marker_sha256=run_marker_sha)
        receipt_draft = require_dict(
            receipt.get("terminalResultDraft"), "receipt.terminalResultDraft"
        )
        if receipt_draft != draft_record:
            raise CustodyError("existing receipt binds a different terminal-result draft")
        journal_entries, journal_raw = read_phase_journal(state_root)
        receipt_journal = require_dict(receipt.get("phaseJournal"), "receipt.phaseJournal")
        if receipt_journal.get("entries") != journal_entries or receipt_journal.get(
            "sha256"
        ) != sha256_bytes(journal_raw):
            raise CustodyError("existing receipt differs from durable journal")
        if receipt.get("terminalPhase") != result.get("terminalPhase"):
            raise CustodyError("existing receipt terminal phase differs from result draft")
    else:
        write_run_receipt(
            state_root,
            receipt_path,
            terminal_phase=require_text(result.get("terminalPhase"), "terminalPhase"),
        )
    draft_path = state_root / TERMINAL_DRAFT_NAME
    draft_payload, draft_raw = load_json(draft_path)
    if draft_payload != result or draft_raw != canonical_bytes(result):
        raise CustodyError("durable terminal-result draft changed before result write")
    write_exclusive(result_path, draft_raw)
    return result


def run_experiment(
    *,
    state_root: Path = DEFAULT_STATE_ROOT,
    source_root: Path = DEFAULT_SOURCE_ROOT,
    freeze_path: Path = FREEZE_PATH,
    result_path: Path = RESULT_PATH,
    receipt_path: Path = RUN_RECEIPT_PATH,
    packet_dir: Path = PACKET_DIR,
    strict_paths: bool = True,
) -> dict[str, Any]:
    if result_path.exists() or receipt_path.exists():
        raise EvidenceError("terminal result or run receipt already exists")
    (
        protocol,
        freeze_payload,
        _acquisition,
        symbols,
        lookup,
        bindings,
    ) = load_frozen(
        freeze_path=freeze_path,
        packet_dir=packet_dir,
        source_root=source_root,
        strict_paths=strict_paths,
    )
    pre_run_git = preflight_git_snapshot(packet_dir, freeze_path, protocol)
    bindings.update(
        {
            "preRunGitSha256": sha256_bytes(canonical_bytes(pre_run_git)),
            "preRunCommit": require_text(pre_run_git.get("commit"), "preRunGit.commit"),
            "preRunTree": require_text(pre_run_git.get("tree"), "preRunGit.tree"),
            "preRunParent": require_text(pre_run_git.get("parent"), "preRunGit.parent"),
        }
    )
    state_root = enforce_state_root(protocol, state_root, strict_paths=strict_paths)
    if state_root.exists():
        if state_root.is_symlink() or not state_root.is_dir():
            raise EvidenceError("state root has invalid shape")
        existing = sorted(path.name for path in state_root.iterdir())
        if existing:
            raise EvidenceError(f"V-G12 one-run state already consumed: {','.join(existing)}")
    else:
        ensure_directory(state_root)
    started_at = utc_now()
    run_marker = {
        "schema": "VG12RunMarkerV1",
        "state": "SOLE_DEVELOPMENT_ARCHIVE_OPEN_RUN_CONSUMED",
        "startedAtUtc": started_at,
        **bindings,
        "preRunGit": pre_run_git,
        "trialId": TRIAL_ID,
        "attemptedTrialCount": 1,
        "allowedRunCount": 1,
        "consumedRunCount": 1,
        "networkPermitted": False,
        "sharedSourceMutationPermitted": False,
    }
    run_marker_path = state_root / "run-marker.v1.json"
    write_exclusive(run_marker_path, canonical_bytes(run_marker))
    bindings["runMarkerSha256"] = sha256_path(run_marker_path)
    append_phase(
        state_root,
        "RUN_MARKER_WRITTEN",
        run_marker_sha256=bindings["runMarkerSha256"],
        detail_sha256=bindings["preRunGitSha256"],
    )
    phase = "DEVELOPMENT_ARCHIVE_OPEN"
    source_issues: list[dict[str, str]] = []
    development: dict[str, Any] | None = None
    development_decisions: list[dict[str, Any]] = []
    try:
        data = require_dict(protocol.get("data"), "data")
        calendar = require_dict(protocol.get("calendar"), "calendar")
        source_root = Path(require_text(freeze_payload.get("sourceRoot"), "freeze.sourceRoot"))
        dev_bounds = require_list(
            data.get("developmentArchiveMonthsInclusive"),
            "developmentArchiveMonthsInclusive",
        )
        dev_months = month_range(str(dev_bounds[0]), str(dev_bounds[1]))
        append_phase(
            state_root,
            "DEVELOPMENT_ARCHIVES_OPENING",
            run_marker_sha256=bindings["runMarkerSha256"],
        )
        bars, source_issues = load_bars(source_root, lookup, symbols, dev_months)
        dev_calendar = require_dict(calendar.get("development"), "calendar.development")
        dev_entries = weekly_dates(
            date.fromisoformat(str(dev_calendar["firstEntry"])),
            date.fromisoformat(str(dev_calendar["lastEntry"])),
        )
        if len(dev_entries) != require_int(
            dev_calendar.get("scheduledFormations"), "scheduledFormations"
        ):
            raise CustodyError("development formation calendar mismatch")
        phase = "DEVELOPMENT_FIXED_TRIAL"
        dev_formations = build_formations(bars, symbols, source_issues, dev_entries)
        bootstrap = require_dict(
            require_dict(protocol.get("statistics"), "statistics").get("bootstrap"),
            "statistics.bootstrap",
        )
        development = period_analysis(
            bars,
            dev_formations,
            protocol,
            required_exit_months=require_list(
                dev_calendar.get("requiredExitMonthBuckets"),
                "development.requiredExitMonthBuckets",
            ),
            seed=require_int(bootstrap.get("developmentSeed"), "bootstrap.developmentSeed"),
        )
        append_phase(
            state_root,
            "DEVELOPMENT_ANALYZED",
            run_marker_sha256=bindings["runMarkerSha256"],
            detail_sha256=sha256_bytes(canonical_bytes(development)),
        )
        phase = "DEVELOPMENT_QUALIFICATION"
        development_decisions = evaluate_period_gates(protocol, "development", development)
        if not all(item["passed"] for item in development_decisions):
            raise DevelopmentQualificationNoGo(
                "one or more frozen development gates failed; holdout remains sealed"
            )
        phase = "CANDIDATE_SEAL"
        candidate = {
            "schema": "VG12CandidateSealV1",
            "state": "FIXED_SINGLE_TRIAL_QUALIFIED_BEFORE_HOLDOUT_OPEN",
            "sealedAtUtc": utc_now(),
            **bindings,
            "trialId": TRIAL_ID,
            "attemptedTrialCount": 1,
            "developmentEvidence": development,
            "developmentEvidenceSha256": sha256_bytes(canonical_bytes(development)),
            "developmentGateDecisions": development_decisions,
            "developmentGateDecisionsSha256": sha256_bytes(canonical_bytes(development_decisions)),
            "holdoutArchiveBodiesOpened": False,
            "retuningOrSelection": "NONE",
            "runMarkerSha256": bindings["runMarkerSha256"],
            "preRunGitSha256": bindings["preRunGitSha256"],
        }
        candidate_path = state_root / "candidate-seal.v1.json"
        write_exclusive(candidate_path, canonical_bytes(candidate))
        bindings["candidateSealSha256"] = sha256_path(candidate_path)
        append_phase(
            state_root,
            "CANDIDATE_SEALED",
            run_marker_sha256=bindings["runMarkerSha256"],
            detail_sha256=bindings["candidateSealSha256"],
        )
        phase = "HOLDOUT_OPEN_MARKER"
        holdout_marker = {
            "schema": "VG12HoldoutOpenMarkerV1",
            "state": "SOLE_FIXED_TRIAL_HOLDOUT_OPEN_CONSUMED",
            "openedAtUtc": utc_now(),
            "candidateSealSha256": bindings["candidateSealSha256"],
            "trialId": TRIAL_ID,
            "allowedOpenCount": 1,
            "consumedOpenCount": 1,
            "postOpenRepairRerunRetuneOrReopen": False,
            "runMarkerSha256": bindings["runMarkerSha256"],
            "preRunGitSha256": bindings["preRunGitSha256"],
            "preRunCommit": bindings["preRunCommit"],
            "preRunTree": bindings["preRunTree"],
            "preRunParent": bindings["preRunParent"],
            "protocolSha256": bindings["protocolSha256"],
            "freezeSha256": bindings["freezeSha256"],
        }
        holdout_marker_path = state_root / "holdout-open.v1.json"
        write_exclusive(holdout_marker_path, canonical_bytes(holdout_marker))
        bindings["holdoutOpenSha256"] = sha256_path(holdout_marker_path)
        append_phase(
            state_root,
            "HOLDOUT_MARKER_WRITTEN",
            run_marker_sha256=bindings["runMarkerSha256"],
            detail_sha256=bindings["holdoutOpenSha256"],
        )
        phase = "HOLDOUT_ARCHIVE_OPEN"
        hold_bounds = require_list(
            data.get("holdoutArchiveMonthsInclusive"),
            "holdoutArchiveMonthsInclusive",
        )
        hold_months = month_range(str(hold_bounds[0]), str(hold_bounds[1]))
        append_phase(
            state_root,
            "HOLDOUT_ARCHIVES_OPENING",
            run_marker_sha256=bindings["runMarkerSha256"],
        )
        hold_bars, hold_issues = load_bars(source_root, lookup, symbols, hold_months)
        source_issues.extend(hold_issues)
        merge_bars(bars, hold_bars)
        hold_calendar = require_dict(calendar.get("holdout"), "calendar.holdout")
        hold_entries = weekly_dates(
            date.fromisoformat(str(hold_calendar["firstEntry"])),
            date.fromisoformat(str(hold_calendar["lastEntry"])),
        )
        if len(hold_entries) != require_int(
            hold_calendar.get("scheduledFormations"), "scheduledFormations"
        ):
            raise CustodyError("holdout formation calendar mismatch")
        phase = "HOLDOUT_FIXED_TRIAL"
        hold_formations = build_formations(bars, symbols, source_issues, hold_entries)
        holdout = period_analysis(
            bars,
            hold_formations,
            protocol,
            required_exit_months=require_list(
                hold_calendar.get("requiredExitMonthBuckets"),
                "holdout.requiredExitMonthBuckets",
            ),
            seed=require_int(bootstrap.get("holdoutSeed"), "bootstrap.holdoutSeed"),
        )
        append_phase(
            state_root,
            "HOLDOUT_ANALYZED",
            run_marker_sha256=bindings["runMarkerSha256"],
            detail_sha256=sha256_bytes(canonical_bytes(holdout)),
        )
        phase = "FROZEN_GATE_EVALUATION"
        decisions = [
            *development_decisions,
            *evaluate_period_gates(protocol, "holdout", holdout),
        ]
        verdict = "GO" if all(item["passed"] for item in decisions) else "NO_GO"
        result = base_result(
            protocol,
            bindings,
            started_at=started_at,
            completed_at=utc_now(),
            pre_run_git=pre_run_git,
        )
        result.update(
            {
                "state": "TERMINAL_MEASURED_NO_REPAIR_OR_RERUN",
                "terminalPhase": phase,
                "sourceIssues": source_issues,
                "development": development,
                "holdout": holdout,
                "gateDecisions": decisions,
                "measurementVerdict": verdict,
            }
        )
    except DevelopmentQualificationNoGo as error:
        if development is None:
            raise AssertionError("development qualification lacks analysis") from error
        append_phase(
            state_root,
            "DEVELOPMENT_NO_GO",
            run_marker_sha256=bindings["runMarkerSha256"],
            detail_sha256=sha256_bytes(canonical_bytes(development_decisions)),
        )
        result = base_result(
            protocol,
            bindings,
            started_at=started_at,
            completed_at=utc_now(),
            pre_run_git=pre_run_git,
        )
        result.update(
            {
                "state": "TERMINAL_DEVELOPMENT_NO_GO_HOLDOUT_UNOPENED",
                "terminalPhase": phase,
                "reasonCode": type(error).__name__.upper(),
                "reason": str(error),
                "sourceIssues": source_issues,
                "development": development,
                "holdout": None,
                "gateDecisions": development_decisions,
                "measurementVerdict": "NO_GO",
            }
        )
    except BaseException as error:
        result = terminal_unmeasured(
            protocol,
            bindings,
            started_at=started_at,
            phase=phase,
            error=error,
            source_issues=source_issues,
            pre_run_git=pre_run_git,
        )
    draft_record = persist_terminal_draft(state_root, result)
    append_phase(
        state_root,
        "TERMINAL_FINALIZING",
        run_marker_sha256=bindings["runMarkerSha256"],
        detail_sha256=require_text(draft_record.get("sha256"), "terminalDraft.sha256"),
    )
    write_run_receipt(
        state_root,
        receipt_path,
        terminal_phase=phase,
    )
    write_exclusive(result_path, canonical_bytes(result))
    return result


def packet_files(packet_dir: Path = PACKET_DIR) -> tuple[Path, ...]:
    names = (
        "OFFICIAL_SOURCE_RESEARCH.md",
        "README.md",
        "experiment.py",
        "freeze.v1.json",
        "protocol.v1.json",
        "result.v1.json",
        "run-receipt.v1.json",
        "test_experiment.py",
        "verify.py",
    )
    paths = tuple(packet_dir / name for name in names)
    missing = [path.name for path in paths if path.is_symlink() or not path.is_file()]
    if missing:
        raise EvidenceError(f"packet files unavailable: {','.join(missing)}")
    return paths


def seal_packet(
    *,
    packet_dir: Path = PACKET_DIR,
    checksums_path: Path = CHECKSUMS_PATH,
) -> dict[str, str]:
    if checksums_path.exists():
        raise EvidenceError("SHA256SUMS already exists")
    paths = packet_files(packet_dir)
    rows = [f"{sha256_path(path)}  {path.name}" for path in paths]
    write_exclusive(checksums_path, ("\n".join(rows) + "\n").encode())
    return {path.name: sha256_path(path) for path in paths}


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("freeze", "run", "finalize-unmeasured", "seal"))
    parser.add_argument(
        "--source-root", type=Path, default=DEFAULT_SOURCE_ROOT, help=argparse.SUPPRESS
    )
    parser.add_argument(
        "--state-root", type=Path, default=DEFAULT_STATE_ROOT, help=argparse.SUPPRESS
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        if args.command == "freeze":
            payload = freeze(args.source_root)
        elif args.command == "run":
            payload = run_experiment(state_root=args.state_root, source_root=args.source_root)
        elif args.command == "finalize-unmeasured":
            payload = finalize_unmeasured_only(state_root=args.state_root)
        else:
            payload = seal_packet()
        print(json.dumps(payload, sort_keys=True, indent=2))
    except EvidenceError as error:
        print(f"V-G12 REFUSED: {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
