"""Sealed S-1S public-only pre-settlement funding-squeeze packet.

Preparation authenticates compressed public archives without opening a ZIP
member. The sole run is consumed before outcome access. Because the required
historical advertised-settlement snapshots are absent, the run terminates
UNMEASURED and opens neither development nor holdout outcomes.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
from collections import Counter
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Final, cast

HERE: Final = Path(__file__).resolve().parent
REPO_ROOT: Final = HERE.parents[2]
BASE_COMMIT: Final = "a169b123fb186d1943a75ad648552c4d95be1be1"
PROTOCOL_ID: Final = "s1s-binance-usdm-pre-settlement-funding-squeeze-v1"

PROTOCOL_PATH: Final = HERE / "protocol.v1.json"
TRIAL_LEDGER_PATH: Final = HERE / "trial_ledger.v1.json"
SOURCE_PLAN_PATH: Final = HERE / "source_plan.v1.json"
SOURCE_MANIFEST_PATH: Final = HERE / "source_manifest.v1.json"
FREEZE_PATH: Final = HERE / "freeze.v1.json"
RUN_MARKER_PATH: Final = HERE / "run_consumed.v1.json"
RESULT_PATH: Final = HERE / "result.v1.json"
SHA256SUMS_PATH: Final = HERE / "SHA256SUMS"

FREEZE_INPUT_NAMES: Final = (
    "README.md",
    "OFFICIAL_SOURCE_RESEARCH.md",
    "protocol.v1.json",
    "trial_ledger.v1.json",
    "source_plan.v1.json",
    "source_manifest.v1.json",
    "experiment.py",
    "verifier.py",
    "test_experiment.py",
    "test_verifier.py",
)
CHECKSUM_INPUT_NAMES: Final = (
    *FREEZE_INPUT_NAMES,
    "freeze.v1.json",
    "run_consumed.v1.json",
    "result.v1.json",
)
EXPECTED_PACKET_FILES: Final = frozenset((*CHECKSUM_INPUT_NAMES, "SHA256SUMS"))


class EvidenceError(RuntimeError):
    """Fail-closed source, custody, seal, or verdict error."""


def canonical_bytes(value: object) -> bytes:
    """Return canonical packet JSON bytes."""

    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


def read_object(path: Path) -> dict[str, Any]:
    """Read one JSON object."""

    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise EvidenceError(f"cannot read JSON {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise EvidenceError(f"expected JSON object: {path}")
    return cast(dict[str, Any], value)


def exclusive_write(path: Path, payload: bytes) -> None:
    """Create one single-use file and fsync it."""

    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
    except FileExistsError as exc:
        raise EvidenceError(f"single-use file already exists: {path.name}") from exc
    with os.fdopen(descriptor, "wb") as stream:
        stream.write(payload)
        stream.flush()
        os.fsync(stream.fileno())


def write_object_exclusive(path: Path, value: object) -> None:
    """Create one canonical single-use JSON object."""

    exclusive_write(path, canonical_bytes(value))


def sha256_file(path: Path) -> str:
    """Hash exact bytes without interpreting their contents."""

    digest = hashlib.sha256()
    try:
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError as exc:
        raise EvidenceError(f"cannot hash {path}: {exc}") from exc
    return digest.hexdigest()


def utc_now() -> str:
    """Return an explicit UTC timestamp."""

    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def git_output(arguments: Sequence[str]) -> str:
    """Run a read-only Git command in the isolated worktree."""

    completed = subprocess.run(
        ["git", *arguments],
        cwd=REPO_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        raise EvidenceError(f"git {' '.join(arguments)} failed: {completed.stderr.strip()}")
    return completed.stdout.strip()


def require_string(value: object, label: str) -> str:
    """Require a non-empty string."""

    if not isinstance(value, str) or not value:
        raise EvidenceError(f"{label} must be a non-empty string")
    return value


def require_string_list(value: object, label: str) -> list[str]:
    """Require a list containing only non-empty strings."""

    if not isinstance(value, list):
        raise EvidenceError(f"{label} must be a list")
    result: list[str] = []
    for index, item in enumerate(value):
        result.append(require_string(item, f"{label}[{index}]"))
    return result


def validate_protocol(protocol: Mapping[str, object], ledger: Mapping[str, object]) -> list[str]:
    """Validate the frozen protocol and complete 12-attempt ledger."""

    if protocol.get("schema") != "S1SProtocolV1":
        raise EvidenceError("protocol schema mismatch")
    if protocol.get("protocolId") != PROTOCOL_ID:
        raise EvidenceError("protocol id mismatch")
    if protocol.get("canonicalBaseCommit") != BASE_COMMIT:
        raise EvidenceError("canonical base mismatch")
    if ledger.get("schema") != "S1STrialLedgerV1":
        raise EvidenceError("trial ledger schema mismatch")
    if ledger.get("protocolId") != PROTOCOL_ID:
        raise EvidenceError("trial ledger protocol mismatch")
    raw_trials = ledger.get("trials")
    if not isinstance(raw_trials, list) or len(raw_trials) != 12:
        raise EvidenceError("trial ledger must contain exactly 12 attempts")
    trial_ids: list[str] = []
    combinations: set[tuple[int, float, int, int]] = set()
    for index, raw_trial in enumerate(raw_trials):
        if not isinstance(raw_trial, dict):
            raise EvidenceError(f"trial {index} must be an object")
        trial = cast(dict[str, object], raw_trial)
        trial_id = require_string(trial.get("trialId"), f"trial {index} id")
        lookback = trial.get("lookbackEvents")
        threshold = trial.get("zThreshold")
        lead = trial.get("entryLeadMinutes")
        exit_lead = trial.get("exitLeadMinutes")
        if not isinstance(lookback, int) or lookback not in {6, 12}:
            raise EvidenceError(f"trial {trial_id} lookback is invalid")
        if not isinstance(threshold, (int, float)) or float(threshold) not in {
            1.5,
            2.5,
        }:
            raise EvidenceError(f"trial {trial_id} threshold is invalid")
        if not isinstance(lead, int) or lead not in {30, 60, 120}:
            raise EvidenceError(f"trial {trial_id} lead is invalid")
        if exit_lead != 5:
            raise EvidenceError(f"trial {trial_id} exit lead is invalid")
        trial_ids.append(trial_id)
        combinations.add((lookback, float(threshold), lead, 5))
    if len(set(trial_ids)) != 12 or len(combinations) != 12:
        raise EvidenceError("trial family contains duplicates")
    primary = ledger.get("primaryTrialId")
    if primary != "lb12_z2p5_lead60" or primary not in trial_ids:
        raise EvidenceError("primary trial binding mismatch")
    if ledger.get("abandonedOrInspectedActualDataVariants") != []:
        raise EvidenceError("actual-data trial attempts were not empty at freeze")
    return trial_ids


def validate_source_plan(plan: Mapping[str, object]) -> None:
    """Validate the pre-outcome public-source plan."""

    if plan.get("schema") != "S1SSourcePlanV1":
        raise EvidenceError("source plan schema mismatch")
    if plan.get("protocolId") != PROTOCOL_ID:
        raise EvidenceError("source plan protocol mismatch")
    if plan.get("expectedArchiveCount") != 96:
        raise EvidenceError("source plan archive count mismatch")
    if require_string_list(plan.get("expectedSymbols"), "expectedSymbols") != [
        "BTCUSDT",
        "ETHUSDT",
    ]:
        raise EvidenceError("source plan symbol universe mismatch")
    if plan.get("historicalScheduleSnapshotPaths") != []:
        raise EvidenceError("unexpected historical schedule snapshot path")
    if plan.get("historicalScheduleSnapshotInventoryStatus") != "ABSENT":
        raise EvidenceError("schedule snapshot inventory must be ABSENT")


def source_inventory(
    discovery: Mapping[str, object], plan: Mapping[str, object]
) -> list[dict[str, str]]:
    """Authenticate compressed archives without opening any ZIP member."""

    raw_sources = discovery.get("sources")
    if not isinstance(raw_sources, list) or len(raw_sources) != 96:
        raise EvidenceError("shared discovery must contain exactly 96 sources")
    archive_root = Path(require_string(plan.get("sharedArchiveRoot"), "sharedArchiveRoot"))
    rows: list[dict[str, str]] = []
    logical_keys: set[tuple[str, str, str]] = set()
    for index, raw_source in enumerate(raw_sources):
        if not isinstance(raw_source, dict):
            raise EvidenceError(f"source {index} must be an object")
        source = cast(dict[str, object], raw_source)
        digest = require_string(source.get("sha256"), f"source {index} sha256")
        key = require_string(source.get("key"), f"source {index} key")
        kind = require_string(source.get("kind"), f"source {index} kind")
        month = require_string(source.get("month"), f"source {index} month")
        phase = require_string(source.get("phase"), f"source {index} phase")
        symbol = require_string(source.get("symbol"), f"source {index} symbol")
        checksum_digest = require_string(
            source.get("checksumSidecarSha256"),
            f"source {index} checksumSidecarSha256",
        )
        if len(digest) != 64 or len(checksum_digest) != 64:
            raise EvidenceError(f"source {index} digest length mismatch")
        logical_key = (kind, symbol, month)
        if logical_key in logical_keys:
            raise EvidenceError(f"duplicate source key: {logical_key}")
        logical_keys.add(logical_key)
        archive = archive_root / f"{digest}.zip"
        if not archive.is_file():
            raise EvidenceError(f"source archive is absent: {archive}")
        if sha256_file(archive) != digest:
            raise EvidenceError(f"source archive digest mismatch: {archive}")
        rows.append(
            {
                "checksumSidecarSha256": checksum_digest,
                "key": key,
                "kind": kind,
                "month": month,
                "phase": phase,
                "sha256": digest,
                "symbol": symbol,
            }
        )
    expected_kinds = set(require_string_list(plan.get("expectedKinds"), "expectedKinds"))
    expected_symbols = set(require_string_list(plan.get("expectedSymbols"), "expectedSymbols"))
    expected_months = set(require_string_list(plan.get("expectedMonths"), "expectedMonths"))
    if {row["kind"] for row in rows} != expected_kinds:
        raise EvidenceError("source kind coverage mismatch")
    if {row["symbol"] for row in rows} != expected_symbols:
        raise EvidenceError("source symbol coverage mismatch")
    if {row["month"] for row in rows} != expected_months:
        raise EvidenceError("source month coverage mismatch")
    counts = Counter((row["kind"], row["symbol"]) for row in rows)
    if any(count != 12 for count in counts.values()) or len(counts) != 8:
        raise EvidenceError("source kind/symbol monthly coverage mismatch")
    return sorted(rows, key=lambda row: row["key"])


def prepare() -> dict[str, object]:
    """Seal source metadata and raw ZIP hashes before any outcome member access."""

    if SOURCE_MANIFEST_PATH.exists():
        raise EvidenceError("source manifest already exists")
    plan = read_object(SOURCE_PLAN_PATH)
    validate_source_plan(plan)
    discovery_path = Path(require_string(plan.get("sharedDiscoveryPath"), "sharedDiscoveryPath"))
    discovery = read_object(discovery_path)
    inventory = source_inventory(discovery, plan)
    phase_counts = Counter(row["phase"] for row in inventory)
    manifest: dict[str, object] = {
        "schema": "S1SSourceManifestV1",
        "protocolId": PROTOCOL_ID,
        "preparedAt": utc_now(),
        "sourceAuthority": plan["sourceAuthority"],
        "sharedDiscoveryPath": str(discovery_path),
        "sharedDiscoverySha256": sha256_file(discovery_path),
        "sharedArchiveRoot": plan["sharedArchiveRoot"],
        "archiveCount": len(inventory),
        "phaseCounts": dict(sorted(phase_counts.items())),
        "sources": inventory,
        "rawZipSha256Verified": True,
        "zipMembersOpenedByPrepare": False,
        "developmentMembersOpenedByS1S": False,
        "holdoutMembersOpenedByS1S": False,
        "sharedArchivesPreviouslyOpenedByOtherResearch": True,
        "causalScheduleEvidence": {
            "status": "ABSENT",
            "available": False,
            "historicalNextFundingTimeSnapshots": 0,
            "historicalFundingInfoSnapshots": 0,
            "historicalScheduleChangeLedger": 0,
            "realizedCalcTimeAcceptedAsSubstitute": False,
            "reasonCode": "HISTORICAL_NEXT_FUNDING_TIME_CAUSALITY_UNAVAILABLE",
        },
    }
    write_object_exclusive(SOURCE_MANIFEST_PATH, manifest)
    return {
        "state": "SOURCE_MANIFEST_SEALED_NO_ZIP_MEMBERS_OPENED",
        "archiveCount": len(inventory),
        "scheduleEvidence": "ABSENT",
        "sourceManifestSha256": sha256_file(SOURCE_MANIFEST_PATH),
    }


def static_hashes() -> dict[str, str]:
    """Hash every frozen input."""

    return {name: sha256_file(HERE / name) for name in FREEZE_INPUT_NAMES}


def freeze() -> dict[str, object]:
    """Freeze protocol, trials, costs, holdout, sources, and evaluator bytes."""

    if FREEZE_PATH.exists():
        raise EvidenceError("freeze already exists")
    if git_output(("rev-parse", "HEAD")) != BASE_COMMIT:
        raise EvidenceError("freeze must begin at the exact canonical base")
    protocol = read_object(PROTOCOL_PATH)
    ledger = read_object(TRIAL_LEDGER_PATH)
    plan = read_object(SOURCE_PLAN_PATH)
    manifest = read_object(SOURCE_MANIFEST_PATH)
    trial_ids = validate_protocol(protocol, ledger)
    validate_source_plan(plan)
    validate_source_manifest(manifest, verify_archives=False)
    freeze_value: dict[str, object] = {
        "schema": "S1SFreezeV1",
        "protocolId": PROTOCOL_ID,
        "frozenAt": utc_now(),
        "canonicalBaseCommit": BASE_COMMIT,
        "worktreeHeadAtFreezeConstruction": BASE_COMMIT,
        "trackedInputSha256": static_hashes(),
        "trialIds": trial_ids,
        "primaryTrialId": ledger["primaryTrialId"],
        "development": protocol["partitions"]["development"],
        "holdout": protocol["partitions"]["holdout"],
        "costScenarios": protocol["costScenarios"],
        "causalScheduleEvidenceStatus": "ABSENT",
        "archiveMembersOpenedBeforeFreeze": False,
        "holdoutMembersOpenedBeforeFreeze": False,
        "runCountAllowed": 1,
        "missingCausalEvidenceDisposition": "UNMEASURED",
    }
    write_object_exclusive(FREEZE_PATH, freeze_value)
    return {
        "state": "FROZEN_BEFORE_OUTCOMES",
        "freezeSha256": sha256_file(FREEZE_PATH),
        "trialCount": len(trial_ids),
        "holdoutStatus": "UNOPENED",
    }


def validate_source_manifest(manifest: Mapping[str, object], *, verify_archives: bool) -> None:
    """Validate source binding and the exact causal blocker."""

    if manifest.get("schema") != "S1SSourceManifestV1":
        raise EvidenceError("source manifest schema mismatch")
    if manifest.get("protocolId") != PROTOCOL_ID:
        raise EvidenceError("source manifest protocol mismatch")
    if manifest.get("archiveCount") != 96:
        raise EvidenceError("source manifest archive count mismatch")
    if manifest.get("rawZipSha256Verified") is not True:
        raise EvidenceError("raw ZIP verification is not true")
    for field in (
        "zipMembersOpenedByPrepare",
        "developmentMembersOpenedByS1S",
        "holdoutMembersOpenedByS1S",
    ):
        if manifest.get(field) is not False:
            raise EvidenceError(f"source custody field must be false: {field}")
    raw_schedule = manifest.get("causalScheduleEvidence")
    if not isinstance(raw_schedule, dict):
        raise EvidenceError("causal schedule evidence is invalid")
    schedule = cast(dict[str, object], raw_schedule)
    if schedule.get("available") is not False or schedule.get("status") != "ABSENT":
        raise EvidenceError("causal schedule evidence must be absent")
    if schedule.get("reasonCode") != "HISTORICAL_NEXT_FUNDING_TIME_CAUSALITY_UNAVAILABLE":
        raise EvidenceError("causal schedule reason mismatch")
    raw_sources = manifest.get("sources")
    if not isinstance(raw_sources, list) or len(raw_sources) != 96:
        raise EvidenceError("source manifest rows are invalid")
    if verify_archives:
        archive_root = Path(require_string(manifest.get("sharedArchiveRoot"), "sharedArchiveRoot"))
        for index, raw_source in enumerate(raw_sources):
            if not isinstance(raw_source, dict):
                raise EvidenceError(f"manifest source {index} is invalid")
            digest = require_string(raw_source.get("sha256"), f"source {index} sha256")
            if sha256_file(archive_root / f"{digest}.zip") != digest:
                raise EvidenceError(f"manifest archive {index} digest mismatch")


def verify_freeze() -> dict[str, Any]:
    """Authenticate every frozen byte."""

    freeze_value = read_object(FREEZE_PATH)
    if freeze_value.get("schema") != "S1SFreezeV1":
        raise EvidenceError("freeze schema mismatch")
    if freeze_value.get("protocolId") != PROTOCOL_ID:
        raise EvidenceError("freeze protocol mismatch")
    if freeze_value.get("canonicalBaseCommit") != BASE_COMMIT:
        raise EvidenceError("freeze base mismatch")
    raw_hashes = freeze_value.get("trackedInputSha256")
    if not isinstance(raw_hashes, dict):
        raise EvidenceError("freeze input hash map is invalid")
    hashes = cast(dict[str, object], raw_hashes)
    if set(hashes) != set(FREEZE_INPUT_NAMES):
        raise EvidenceError("freeze input inventory mismatch")
    for name in FREEZE_INPUT_NAMES:
        if hashes.get(name) != sha256_file(HERE / name):
            raise EvidenceError(f"post-freeze mutation detected: {name}")
    return freeze_value


def verify_run_checkout() -> str:
    """Require a clean isolated descendant containing only S-1S history."""

    head = git_output(("rev-parse", "HEAD"))
    if git_output(("merge-base", BASE_COMMIT, head)) != BASE_COMMIT:
        raise EvidenceError("run checkout is not a descendant of canonical base")
    if git_output(("status", "--porcelain=v1", "--untracked-files=all")):
        raise EvidenceError("run checkout is not clean")
    changed = git_output(("diff", "--name-only", "--no-renames", f"{BASE_COMMIT}..{head}"))
    for path in changed.splitlines():
        if path and not path.startswith("quant/research/s1s/"):
            raise EvidenceError(f"out-of-scope history path: {path}")
    return head


def build_run_marker(head: str) -> dict[str, object]:
    """Bind the one consumed run before any possible outcome access."""

    return {
        "schema": "S1SRunConsumedV1",
        "protocolId": PROTOCOL_ID,
        "consumedAt": utc_now(),
        "freezeCommit": head,
        "freezeSha256": sha256_file(FREEZE_PATH),
        "protocolSha256": sha256_file(PROTOCOL_PATH),
        "trialLedgerSha256": sha256_file(TRIAL_LEDGER_PATH),
        "sourceManifestSha256": sha256_file(SOURCE_MANIFEST_PATH),
        "evaluatorSha256": sha256_file(Path(__file__).resolve()),
        "runOrdinal": 1,
        "runCountAllowed": 1,
        "developmentMembersOpenedAtConsumption": False,
        "holdoutMembersOpenedAtConsumption": False,
    }


def null_metric(reason: str) -> dict[str, object]:
    """Create one explicit unmeasured numeric metric."""

    return {"status": "UNMEASURED", "value": None, "reason": reason}


def build_unmeasured_result(run_marker: Mapping[str, object]) -> dict[str, object]:
    """Build the terminal causal-source verdict without outcome access."""

    reason = "HISTORICAL_NEXT_FUNDING_TIME_CAUSALITY_UNAVAILABLE"
    return {
        "schema": "S1SResultV1",
        "protocolId": PROTOCOL_ID,
        "sealedAt": utc_now(),
        "researchVerdict": "UNMEASURED",
        "capitalDisposition": "NO_GO",
        "reasonCode": reason,
        "reason": (
            "No historical timestamped nextFundingTime/fundingInfo corpus proves "
            "the settlement advertised before entry; realized calc_time is a "
            "forbidden future schedule substitute."
        ),
        "runConsumed": True,
        "runMarkerSha256": sha256_file(RUN_MARKER_PATH),
        "freezeSha256": sha256_file(FREEZE_PATH),
        "sourceManifestSha256": sha256_file(SOURCE_MANIFEST_PATH),
        "development": {
            "interval": {
                "startInclusive": "2025-07-01T00:00:00Z",
                "endExclusive": "2026-04-01T00:00:00Z",
            },
            "archiveMembersOpenedByS1S": False,
            "status": "UNOPENED_CAUSAL_PREFLIGHT_FAILED",
            "trades": None,
            "activeWeeks": None,
            "symbols": None,
        },
        "holdout": {
            "interval": {
                "startInclusive": "2026-04-01T00:00:00Z",
                "endExclusive": "2026-07-01T00:00:00Z",
            },
            "archiveMembersOpenedByS1S": False,
            "status": "UNOPENED",
            "candidateSealCreated": False,
        },
        "metrics": {
            "netPer1000Usd": {
                "status": "UNMEASURED",
                "publicTakerProxyUsd": None,
                "takerStressUsd": None,
                "takerSevereDiagnosticUsd": None,
                "accountNetUsd": None,
                "reason": reason,
            },
            "holdoutNetPer1000Usd": null_metric("HOLDOUT_UNOPENED"),
            "multiplicity": {
                "status": "UNMEASURED",
                "frozenTrialCount": 12,
                "holmAdjustedP": None,
                "whiteRealityCheckP": None,
                "simultaneousLowerBoundUsd": None,
                "globalRegistryStatus": "NOT_REGISTERED_BEFORE_OUTCOMES",
                "globalEffectiveP": 1.0,
                "reason": reason,
            },
            "pbo": {
                "status": "UNMEASURED",
                "plannedBlocks": 12,
                "plannedSplits": 924,
                "value": None,
                "reason": reason,
            },
            "drawdown": {
                "status": "UNMEASURED",
                "label": "SAMPLED_MARK_DRAWDOWN_PROXY",
                "maximumFraction": None,
                "limitFraction": 0.1,
                "reason": reason,
            },
            "capacity": {
                "status": "UNMEASURED",
                "label": "PUBLIC_COARSE_VOLUME_PARTICIPATION_PROXY",
                "publicProxyMinimumGrossUsd": None,
                "publicProxyP05GrossUsd": None,
                "publicProxyMedianGrossUsd": None,
                "executableCapacityUsd": None,
                "executableCapacityStatus": "UNKNOWN",
                "reason": reason,
            },
            "fundingCashflowUsd": null_metric("SETTLEMENT_CHRONOLOGY_NOT_PROVEN"),
        },
        "frozenCosts": {
            "publicTakerProxy": {
                "spotFeeBpsPerFill": 10,
                "usdmFeeBpsPerFill": 5,
                "adverseExecutionBpsPerFillPerLeg": 2,
            },
            "takerStress": {
                "spotFeeBpsPerFill": 10,
                "usdmFeeBpsPerFill": 10,
                "adverseExecutionBpsPerFillPerLeg": 5,
            },
            "takerSevereDiagnostic": {
                "spotFeeBpsPerFill": 10,
                "usdmFeeBpsPerFill": 10,
                "adverseExecutionBpsPerFillPerLeg": 10,
            },
            "accountEffectiveFees": "UNKNOWN",
        },
        "custody": {
            "rawZipSha256VerifiedCount": 96,
            "zipMembersOpenedByPrepare": False,
            "developmentMembersOpenedByS1S": False,
            "holdoutMembersOpenedByS1S": False,
            "outcomeRowsReadByS1S": 0,
            "rerunAllowed": False,
        },
        "limitations": [
            "historical nextFundingTime snapshots absent",
            "historical fundingInfo cap/floor/interval snapshots absent",
            "current endpoints cannot backfill historical advertised schedules",
            "realized calc_time cannot be used as pre-entry knowledge",
            "exact pre-settlement funding estimate not reconstructible",
            "account-effective fees unknown",
            "historical spreads, fills, depth, latency, and impact unknown",
            "executable capacity unknown",
            "shared archives were previously opened by other research",
            "S1S was not registered in a superseding global family before outcomes",
        ],
        "consumer": "N3 successor/orchestrator scoreboard",
        "authority": {
            "execution": "NONE",
            "privateRead": "NONE",
            "orders": "NONE",
            "transfers": "NONE",
            "withdrawals": "NONE",
            "provider": "NONE",
            "host": "NONE",
            "deployment": "NONE",
            "ui": "NONE",
            "moneyMovedUsd": 0,
        },
        "runBinding": dict(run_marker),
    }


def checksum_payload() -> bytes:
    """Create packet-relative SHA256SUMS bytes."""

    lines = [f"{sha256_file(HERE / name)}  {name}" for name in CHECKSUM_INPUT_NAMES]
    return ("\n".join(lines) + "\n").encode()


def run() -> dict[str, object]:
    """Consume the only run and seal the pre-outcome UNMEASURED verdict."""

    if RUN_MARKER_PATH.exists() or RESULT_PATH.exists() or SHA256SUMS_PATH.exists():
        raise EvidenceError("sealed run is already consumed")
    verify_freeze()
    head = verify_run_checkout()
    manifest = read_object(SOURCE_MANIFEST_PATH)
    validate_source_manifest(manifest, verify_archives=True)
    marker = build_run_marker(head)
    write_object_exclusive(RUN_MARKER_PATH, marker)
    result = build_unmeasured_result(marker)
    write_object_exclusive(RESULT_PATH, result)
    exclusive_write(SHA256SUMS_PATH, checksum_payload())
    return {
        "state": "TERMINAL_SEALED",
        "researchVerdict": "UNMEASURED",
        "capitalDisposition": "NO_GO",
        "reasonCode": result["reasonCode"],
        "developmentMembersOpened": False,
        "holdoutMembersOpened": False,
        "moneyMovedUsd": 0,
    }


def parse_checksum_manifest(path: Path) -> dict[str, str]:
    """Parse a strict packet-relative checksum manifest."""

    result: dict[str, str] = {}
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError as exc:
        raise EvidenceError(f"cannot read checksum manifest: {exc}") from exc
    for index, line in enumerate(lines):
        parts = line.split("  ")
        if len(parts) != 2:
            raise EvidenceError(f"invalid checksum line {index + 1}")
        digest, name = parts
        if (
            len(digest) != 64
            or any(character not in "0123456789abcdef" for character in digest)
            or not name
            or "/" in name
        ):
            raise EvidenceError(f"invalid checksum entry {index + 1}")
        if name in result:
            raise EvidenceError(f"duplicate checksum entry: {name}")
        result[name] = digest
    return result


def validate_terminal_result(result: Mapping[str, object]) -> None:
    """Enforce null economics, unopened outcomes, and zero authority."""

    if result.get("schema") != "S1SResultV1":
        raise EvidenceError("result schema mismatch")
    if result.get("protocolId") != PROTOCOL_ID:
        raise EvidenceError("result protocol mismatch")
    if result.get("researchVerdict") != "UNMEASURED":
        raise EvidenceError("research verdict must be UNMEASURED")
    if result.get("capitalDisposition") != "NO_GO":
        raise EvidenceError("capital disposition must be NO_GO")
    if result.get("reasonCode") != "HISTORICAL_NEXT_FUNDING_TIME_CAUSALITY_UNAVAILABLE":
        raise EvidenceError("result reason mismatch")
    metrics_raw = result.get("metrics")
    if not isinstance(metrics_raw, dict):
        raise EvidenceError("result metrics are invalid")
    metrics = cast(dict[str, object], metrics_raw)
    net_raw = metrics.get("netPer1000Usd")
    if not isinstance(net_raw, dict):
        raise EvidenceError("net metric is invalid")
    for field in (
        "publicTakerProxyUsd",
        "takerStressUsd",
        "takerSevereDiagnosticUsd",
        "accountNetUsd",
    ):
        if net_raw.get(field) is not None:
            raise EvidenceError(f"unmeasured net must be null: {field}")
    pbo_raw = metrics.get("pbo")
    if not isinstance(pbo_raw, dict) or pbo_raw.get("value") is not None:
        raise EvidenceError("PBO must be unmeasured and null")
    drawdown_raw = metrics.get("drawdown")
    if not isinstance(drawdown_raw, dict) or drawdown_raw.get("maximumFraction") is not None:
        raise EvidenceError("drawdown must be unmeasured and null")
    capacity_raw = metrics.get("capacity")
    if not isinstance(capacity_raw, dict):
        raise EvidenceError("capacity metric is invalid")
    for field in (
        "publicProxyMinimumGrossUsd",
        "publicProxyP05GrossUsd",
        "publicProxyMedianGrossUsd",
        "executableCapacityUsd",
    ):
        if capacity_raw.get(field) is not None:
            raise EvidenceError(f"unmeasured capacity must be null: {field}")
    for partition_name in ("development", "holdout"):
        partition = result.get(partition_name)
        if (
            not isinstance(partition, dict)
            or partition.get("archiveMembersOpenedByS1S") is not False
        ):
            raise EvidenceError(f"{partition_name} custody mismatch")
    authority = result.get("authority")
    if not isinstance(authority, dict):
        raise EvidenceError("authority object is invalid")
    for field, value in authority.items():
        if field == "moneyMovedUsd":
            if value != 0:
                raise EvidenceError("money moved must be zero")
        elif value != "NONE":
            raise EvidenceError(f"authority must be NONE: {field}")


def verify_packet(*, verify_archives: bool = True) -> dict[str, object]:
    """Verify the sealed packet without recomputing or opening outcomes."""

    actual_files = {path.name for path in HERE.iterdir() if path.is_file()}
    if actual_files != EXPECTED_PACKET_FILES:
        missing = sorted(EXPECTED_PACKET_FILES - actual_files)
        extra = sorted(actual_files - EXPECTED_PACKET_FILES)
        raise EvidenceError(f"packet inventory mismatch: missing={missing}, extra={extra}")
    verify_freeze()
    manifest = read_object(SOURCE_MANIFEST_PATH)
    validate_source_manifest(manifest, verify_archives=verify_archives)
    marker = read_object(RUN_MARKER_PATH)
    if marker.get("schema") != "S1SRunConsumedV1":
        raise EvidenceError("run marker schema mismatch")
    if marker.get("runOrdinal") != 1 or marker.get("runCountAllowed") != 1:
        raise EvidenceError("run count binding mismatch")
    if marker.get("developmentMembersOpenedAtConsumption") is not False:
        raise EvidenceError("development was opened at run consumption")
    if marker.get("holdoutMembersOpenedAtConsumption") is not False:
        raise EvidenceError("holdout was opened at run consumption")
    result = read_object(RESULT_PATH)
    validate_terminal_result(result)
    if result.get("runMarkerSha256") != sha256_file(RUN_MARKER_PATH):
        raise EvidenceError("result/run marker hash mismatch")
    if result.get("freezeSha256") != sha256_file(FREEZE_PATH):
        raise EvidenceError("result/freeze hash mismatch")
    if result.get("sourceManifestSha256") != sha256_file(SOURCE_MANIFEST_PATH):
        raise EvidenceError("result/source manifest hash mismatch")
    checksum_map = parse_checksum_manifest(SHA256SUMS_PATH)
    if set(checksum_map) != set(CHECKSUM_INPUT_NAMES):
        raise EvidenceError("checksum inventory mismatch")
    for name, expected in checksum_map.items():
        if sha256_file(HERE / name) != expected:
            raise EvidenceError(f"packet checksum mismatch: {name}")
    return {
        "verification": "PASS",
        "researchVerdict": "UNMEASURED",
        "capitalDisposition": "NO_GO",
        "reasonCode": result["reasonCode"],
        "netPer1000Usd": None,
        "holdout": "[2026-04-01T00:00:00Z,2026-07-01T00:00:00Z) UNOPENED",
        "holmAdjustedP": None,
        "whiteRealityCheckP": None,
        "pbo": None,
        "drawdown": None,
        "capacity": None,
        "executionAuthority": "NONE",
        "moneyMovedUsd": 0,
    }


def report() -> dict[str, object]:
    """Return a compact consumer-facing verdict after authentication."""

    return verify_packet(verify_archives=True)


def build_parser() -> argparse.ArgumentParser:
    """Build the command-line parser."""

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("prepare", "freeze", "run", "verify", "report"))
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    """Run one lifecycle command."""

    arguments = build_parser().parse_args(argv)
    try:
        if arguments.command == "prepare":
            value = prepare()
        elif arguments.command == "freeze":
            value = freeze()
        elif arguments.command == "run":
            value = run()
        elif arguments.command == "verify":
            value = verify_packet()
        else:
            value = report()
    except EvidenceError as exc:
        print(json.dumps({"status": "FAIL", "error": str(exc)}, sort_keys=True))
        return 1
    print(json.dumps(value, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
