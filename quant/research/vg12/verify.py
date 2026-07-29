#!/usr/bin/env python3
"""Independent byte, lifecycle, Git, and decision verifier for V-G12."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import platform
import re
import subprocess
import sys
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any, Final

PACKET_DIR: Final = Path(__file__).resolve().parent
FREEZE_PATH: Final = PACKET_DIR / "freeze.v1.json"
CHECKSUMS_PATH: Final = PACKET_DIR / "SHA256SUMS"
DEFAULT_SOURCE_ROOT: Final = Path("/private/tmp/cosmos-s1f-weekly-momentum-cash-v1")
DEFAULT_STATE_ROOT: Final = Path("/private/tmp/cosmos-vg12-volume-entropy-regime-1be1-67aa")
TRIAL_ID: Final = "ENTROPY_07_GT_PRIOR_28_TOP30"
BASE_COMMIT: Final = "a169b123fb186d1943a75ad648552c4d95be1be1"
TERMINAL: Final = {"GO", "NO_GO", "UNMEASURED"}
SHA256_RE: Final = re.compile(r"^[0-9a-f]{64}$")
GIT_OBJECT_RE: Final = re.compile(r"^[0-9a-f]{40,64}$")
SYMBOL_RE: Final = re.compile(r"^[A-Z0-9]+USDT$")
MONTH_RE: Final = re.compile(r"^[0-9]{4}-(?:0[1-9]|1[0-2])$")
MAXIMUM_ZIP_BYTES: Final = 2_000_000
MAXIMUM_CHECKSUM_BYTES: Final = 256
SOURCE_FILES: Final = (
    "OFFICIAL_SOURCE_RESEARCH.md",
    "README.md",
    "experiment.py",
    "protocol.v1.json",
    "test_experiment.py",
    "verify.py",
)
SEALED_FILES: Final = (
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
HAPPY_PHASES: Final = (
    "RUN_MARKER_WRITTEN",
    "DEVELOPMENT_ARCHIVES_OPENING",
    "DEVELOPMENT_ANALYZED",
    "CANDIDATE_SEALED",
    "HOLDOUT_MARKER_WRITTEN",
    "HOLDOUT_ARCHIVES_OPENING",
    "HOLDOUT_ANALYZED",
)


class VerificationError(RuntimeError):
    """A frozen packet invariant did not authenticate."""


def sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def sha256_path(path: Path) -> str:
    if path.is_symlink() or not path.is_file():
        raise VerificationError(f"required regular file unavailable: {path}")
    return sha256_bytes(path.read_bytes())


def canonical_bytes(value: object) -> bytes:
    return (
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True) + "\n"
    ).encode()


def normalized_lines(values: Sequence[str]) -> bytes:
    return (("\n".join(values) + "\n") if values else "").encode()


def load_json(path: Path, *, require_canonical: bool = False) -> tuple[dict[str, Any], bytes]:
    if path.is_symlink() or not path.is_file():
        raise VerificationError(f"required regular JSON unavailable: {path}")
    raw = path.read_bytes()
    try:
        value = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise VerificationError(f"invalid JSON: {path}") from error
    if not isinstance(value, dict):
        raise VerificationError(f"JSON root must be object: {path}")
    if require_canonical and raw != canonical_bytes(value):
        raise VerificationError(f"JSON is not canonical: {path}")
    return value, raw


def require_dict(value: object, field: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise VerificationError(f"{field} must be an object")
    return value


def require_list(value: object, field: str) -> list[Any]:
    if not isinstance(value, list):
        raise VerificationError(f"{field} must be an array")
    return value


def require_text(value: object, field: str) -> str:
    if not isinstance(value, str) or not value:
        raise VerificationError(f"{field} must be nonempty text")
    return value


def require_int(value: object, field: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise VerificationError(f"{field} must be an integer")
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


def protocol_target_months(protocol: Mapping[str, Any]) -> tuple[str, ...]:
    data = require_dict(protocol.get("data"), "data")
    bounds = require_list(data.get("targetMonthsInclusive"), "targetMonthsInclusive")
    if len(bounds) != 2 or not all(
        isinstance(month, str) and MONTH_RE.fullmatch(month) for month in bounds
    ):
        raise VerificationError("protocol target-month bounds malformed")
    months = month_range(str(bounds[0]), str(bounds[1]))
    if not months or months[0] != bounds[0] or months[-1] != bounds[1]:
        raise VerificationError("protocol target-month bounds invalid")
    return months


def discovery_months(discovery: Mapping[str, Any]) -> tuple[str, ...]:
    raw_months = require_list(discovery.get("targetMonths"), "discovery.targetMonths")
    if not all(isinstance(month, str) and MONTH_RE.fullmatch(month) for month in raw_months):
        raise VerificationError("discovery target month malformed")
    months = tuple(str(month) for month in raw_months)
    if not months or tuple(sorted(set(months))) != months:
        raise VerificationError("discovery target months must be sorted unique")
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
        raise VerificationError(
            "protocol target months are not a continuous ordered discovery subset"
        ) from error
    if shared[start : start + len(target)] != target:
        raise VerificationError(
            "protocol target months are not a continuous ordered discovery subset"
        )


def assert_finite(value: object, field: str = "root") -> None:
    if isinstance(value, float) and not math.isfinite(value):
        raise VerificationError(f"non-finite number: {field}")
    if isinstance(value, dict):
        for key, child in value.items():
            assert_finite(child, f"{field}.{key}")
    if isinstance(value, list):
        for index, child in enumerate(value):
            assert_finite(child, f"{field}[{index}]")


def runtime_binding() -> dict[str, str]:
    return {
        "python": platform.python_version(),
        "implementation": platform.python_implementation(),
        "hashSeed": os.environ.get("PYTHONHASHSEED", "UNSET"),
    }


def source_bindings(packet_dir: Path) -> dict[str, str]:
    return {name: sha256_path(packet_dir / name) for name in SOURCE_FILES}


def verify_protocol(protocol: Mapping[str, Any]) -> None:
    if (
        protocol.get("schema") != "VG12VolumeEntropyRegimeProtocolV1"
        or protocol.get("canonicalBaseCommit") != BASE_COMMIT
    ):
        raise VerificationError("protocol schema/base mismatch")
    trial = require_dict(protocol.get("trial"), "trial")
    if trial.get("attemptedCount") != 1 or trial.get("trialId") != TRIAL_ID:
        raise VerificationError("single-trial contract mismatch")
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
                "commit": BASE_COMMIT,
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
        raise VerificationError("sibling distinctness evidence drift")
    signal = require_dict(protocol.get("signal"), "signal")
    expected = {
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
        "broadening": (
            "RECENT_NORMALIZED_ENTROPY_MINUS_BASELINE_NORMALIZED_ENTROPY_"
            "STRICTLY_GREATER_THAN_1E_40"
        ),
        "tieNarrowingOrUnresolved": "CASH",
        "zeroAggregateEntropyMass": "UNRESOLVED_CASH",
    }
    if any(signal.get(key) != value for key, value in expected.items()):
        raise VerificationError("signal contract drift")
    if require_dict(signal.get("numericDomain"), "signal.numericDomain") != {
        "quoteVolume": "DECIMAL_NONNEGATIVE",
        "windowMass": "DECIMAL_EXACT_SUM",
        "medianLiquidity": "DECIMAL_EXACT_MEDIAN",
        "decimalPrecision": 80,
        "rounding": "ROUND_HALF_EVEN",
        "entropyComparisonTolerance": "1E-40",
    }:
        raise VerificationError("numeric-domain contract drift")
    data = require_dict(protocol.get("data"), "data")
    if (
        require_dict(data.get("sharedManifestEvidence"), "data.sharedManifestEvidence")
        != frozen_shared_manifest_evidence()
    ):
        raise VerificationError("frozen shared-manifest evidence drift")
    if require_dict(data.get("archiveSafety"), "data.archiveSafety") != {
        "maximumZipBytes": MAXIMUM_ZIP_BYTES,
        "maximumChecksumBytes": MAXIMUM_CHECKSUM_BYTES,
        "maximumUncompressedCsvBytes": 4_000_000,
        "maximumCompressionRatio": "100",
        "allowedCompressionMethods": [0, 8],
        "allowedGeneralPurposeFlagMask": 2048,
        "singleExactCsvMemberRequired": True,
    }:
        raise VerificationError("archive-safety contract drift")
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
        raise VerificationError("acquisition-manifest validation contract drift")
    calendar = require_dict(protocol.get("calendar"), "calendar")
    development = require_dict(calendar.get("development"), "calendar.development")
    holdout = require_dict(calendar.get("holdout"), "calendar.holdout")
    if development.get("requiredExitMonthBuckets") != [
        "2025-07",
        "2025-08",
        "2025-09",
        "2025-10",
        "2025-11",
        "2025-12",
        "2026-01",
        "2026-02",
    ] or holdout.get("requiredExitMonthBuckets") != ["2026-03", "2026-04", "2026-05", "2026-06"]:
        raise VerificationError("exit-month bucket contract drift")
    run_control = require_dict(protocol.get("runControl"), "runControl")
    if (
        run_control.get("allowedRunCount") != 1
        or run_control.get("allowedHoldoutOpenCount") != 1
        or run_control.get("networkDuringEvaluation") is not False
        or run_control.get("postMarkerRepairRerunRetuneOrReopen") is not False
        or run_control.get("developmentMustPassEveryFrozenGateBeforeCandidateSeal") is not True
        or run_control.get("developmentNoGoLeavesHoldoutUnopened") is not True
    ):
        raise VerificationError("run-control lifecycle drift")
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
        raise VerificationError("pre-run Git contract drift")
    phase_journal = require_dict(run_control.get("phaseJournal"), "runControl.phaseJournal")
    if (
        phase_journal.get("format") != "CANONICAL_JSON_LINES_APPEND_ONLY"
        or phase_journal.get("fileAndParentDirectoryFsync") is not True
        or run_control.get("interruptionRecovery")
        != "FINALIZE_UNMEASURED_ONLY_FROM_EXISTING_RUN_MARKER_NO_ARCHIVE_REOPEN_RERUN_OR_REPAIR"
    ):
        raise VerificationError("durable lifecycle contract drift")
    if require_dict(
        run_control.get("terminalResultDraft"),
        "runControl.terminalResultDraft",
    ) != {
        "filename": "terminal-result-draft.v1.json",
        "canonicalAndFsyncedBeforeTerminalFinalizing": True,
        "terminalJournalDetailBindsDraftSha256": True,
        "immutableAfterFirstWrite": True,
        "resultBytesMustEqualDraftBytes": True,
    }:
        raise VerificationError("terminal-result draft contract drift")
    vocabulary = require_list(
        require_dict(protocol.get("verdictLaw"), "verdictLaw").get("terminalVocabulary"),
        "terminalVocabulary",
    )
    if set(vocabulary) != TERMINAL or len(vocabulary) != 3:
        raise VerificationError("terminal vocabulary drift")


def expected_inventory(
    discovery: Mapping[str, Any],
    symbols: Sequence[str],
    months: Sequence[str],
) -> tuple[
    dict[tuple[str, str], tuple[Mapping[str, Any], Mapping[str, Any]]],
    list[str],
]:
    inventories = require_list(discovery.get("symbolInventories"), "discovery.symbolInventories")
    if len(inventories) != len(symbols):
        raise VerificationError("discovery inventory count mismatch")
    pairs: dict[tuple[str, str], tuple[Mapping[str, Any], Mapping[str, Any]]] = {}
    absent: list[str] = []
    for index, raw_inventory in enumerate(inventories):
        inventory = require_dict(raw_inventory, "discovery.symbolInventories[]")
        symbol = require_text(inventory.get("symbol"), "inventory.symbol")
        if symbol != symbols[index]:
            raise VerificationError("discovery inventory/universe mismatch")
        inventory_months = require_dict(inventory.get("months"), "inventory.months")
        if not set(inventory_months).issubset(months):
            raise VerificationError("discovery inventory has an out-of-scope month")
        for month in months:
            raw_artifacts = inventory_months.get(month)
            if raw_artifacts is None:
                absent.append(f"{symbol}|{month}")
                continue
            artifacts = require_dict(raw_artifacts, f"inventory.{symbol}.{month}")
            zip_meta = artifacts.get("zip")
            checksum_meta = artifacts.get("checksum")
            if zip_meta is None and checksum_meta is None:
                absent.append(f"{symbol}|{month}")
                continue
            if not isinstance(zip_meta, dict) or not isinstance(checksum_meta, dict):
                raise VerificationError("discovery has orphaned archive pair")
            pairs[(symbol, month)] = (zip_meta, checksum_meta)
    return pairs, absent


def verify_source_manifests(
    source_root: Path,
    freeze: Mapping[str, Any],
    protocol: Mapping[str, Any],
    *,
    strict_paths: bool,
) -> None:
    resolved = source_root.resolve(strict=True)
    if strict_paths and resolved != DEFAULT_SOURCE_ROOT.resolve(strict=True):
        raise VerificationError("source root differs from exact frozen path")
    discovery, discovery_raw = load_json(resolved / "discovery.v1.json")
    acquisition, acquisition_raw = load_json(resolved / "acquisition-manifest.v1.json")
    expected_evidence = require_dict(
        require_dict(protocol.get("data"), "data").get("sharedManifestEvidence"),
        "data.sharedManifestEvidence",
    )
    if (
        discovery.get("schema") != "S1FArchiveDiscoveryV1"
        or discovery.get("state") != "METADATA_ONLY_NO_ARCHIVE_BODY_OPENED"
        or acquisition.get("schema") != "S1FAcquisitionManifestV1"
        or acquisition.get("state") != "CHECKSUM_VERIFIED_ARCHIVES_NOT_DECOMPRESSED"
        or acquisition.get("archiveBodiesDecompressed") is not False
    ):
        raise VerificationError("shared manifest schema/state mismatch")
    if (
        acquisition.get("discoverySha256") != sha256_bytes(discovery_raw)
        or expected_evidence.get("discoverySha256") != sha256_bytes(discovery_raw)
        or expected_evidence.get("acquisitionSha256") != sha256_bytes(acquisition_raw)
        or freeze.get("sharedDiscoverySha256") != sha256_bytes(discovery_raw)
        or freeze.get("sharedAcquisitionSha256") != sha256_bytes(acquisition_raw)
    ):
        raise VerificationError("shared manifest byte binding mismatch")
    universe = require_dict(discovery.get("universe"), "discovery.universe")
    symbols_raw = require_list(universe.get("symbols"), "discovery.universe.symbols")
    if not all(isinstance(symbol, str) and SYMBOL_RE.fullmatch(symbol) for symbol in symbols_raw):
        raise VerificationError("universe symbol malformed")
    symbols = [str(symbol) for symbol in symbols_raw]
    if symbols != sorted(set(symbols)) or symbols != freeze.get("candidateUniverse"):
        raise VerificationError("frozen universe mismatch")
    universe_raw = normalized_lines(symbols)
    if (
        universe.get("count") != len(symbols)
        or universe.get("sha256") != sha256_bytes(universe_raw)
        or universe.get("count") != expected_evidence.get("candidateUniverseCount")
        or universe.get("sha256") != expected_evidence.get("candidateUniverseSha256")
        or freeze.get("sharedCandidateUniverseCount")
        != expected_evidence.get("candidateUniverseCount")
        or freeze.get("sharedCandidateUniverseSha256")
        != expected_evidence.get("candidateUniverseSha256")
        or freeze.get("candidateUniverseCount") != len(symbols)
        or freeze.get("candidateUniverseSha256") != sha256_bytes(universe_raw)
    ):
        raise VerificationError("universe count/digest mismatch")
    shared_months = discovery_months(discovery)
    if (
        list(shared_months) != expected_evidence.get("discoveryTargetMonths")
        or len(shared_months) != expected_evidence.get("discoveryTargetMonthCount")
        or freeze.get("sharedDiscoveryTargetMonths")
        != expected_evidence.get("discoveryTargetMonths")
        or freeze.get("sharedDiscoveryTargetMonthCount")
        != expected_evidence.get("discoveryTargetMonthCount")
    ):
        raise VerificationError("shared discovery months evidence mismatch")
    target_months = protocol_target_months(protocol)
    require_continuous_target_subset(target_months, shared_months)
    frozen_months_raw = require_list(freeze.get("targetMonths"), "freeze.targetMonths")
    if (
        not all(isinstance(month, str) for month in frozen_months_raw)
        or tuple(str(month) for month in frozen_months_raw) != target_months
    ):
        raise VerificationError("freeze target months differ from protocol")
    expected_pairs, expected_absent = expected_inventory(discovery, symbols, shared_months)
    rows = require_list(acquisition.get("artifactPairs"), "artifactPairs")
    lookup: dict[tuple[str, str], Mapping[str, Any]] = {}
    row_digests: list[str] = []
    previous: tuple[str, str] | None = None
    for raw_row in rows:
        row = require_dict(raw_row, "artifactPairs[]")
        key = (
            require_text(row.get("symbol"), "artifact.symbol"),
            require_text(row.get("month"), "artifact.month"),
        )
        if previous is not None and key <= previous:
            raise VerificationError("artifact rows not strictly sorted")
        previous = key
        expected = expected_pairs.get(key)
        if expected is None:
            raise VerificationError("artifact pair absent from discovery")
        zip_meta, checksum_meta = expected
        expected_fields: dict[str, object] = {
            "zipKey": require_text(zip_meta.get("key"), "zip.key"),
            "zipFrozenEtag": require_text(zip_meta.get("etag"), "zip.etag"),
            "zipFrozenLastModified": require_text(zip_meta.get("lastModified"), "zip.lastModified"),
            "zipListedBytes": require_int(zip_meta.get("size"), "zip.size"),
            "zipBytes": require_int(zip_meta.get("size"), "zip.size"),
            "checksumKey": require_text(checksum_meta.get("key"), "checksum.key"),
            "checksumFrozenEtag": require_text(checksum_meta.get("etag"), "checksum.etag"),
            "checksumFrozenLastModified": require_text(
                checksum_meta.get("lastModified"), "checksum.lastModified"
            ),
            "checksumListedBytes": require_int(checksum_meta.get("size"), "checksum.size"),
            "checksumBytes": require_int(checksum_meta.get("size"), "checksum.size"),
        }
        if any(row.get(field) != value for field, value in expected_fields.items()):
            raise VerificationError("artifact metadata differs from discovery")
        zip_bytes = require_int(row.get("zipBytes"), "artifact.zipBytes")
        checksum_bytes = require_int(row.get("checksumBytes"), "artifact.checksumBytes")
        if not 0 < zip_bytes <= MAXIMUM_ZIP_BYTES:
            raise VerificationError("artifact ZIP size outside bounds")
        if not 0 < checksum_bytes <= MAXIMUM_CHECKSUM_BYTES:
            raise VerificationError("artifact sidecar size outside bounds")
        if row.get("state") not in {"DOWNLOADED_VERIFIED", "RESUMED_VERIFIED"}:
            raise VerificationError("artifact row state invalid")
        zip_sha = require_text(row.get("zipSha256"), "artifact.zipSha256")
        checksum_sha = require_text(row.get("checksumSha256"), "artifact.checksumSha256")
        if SHA256_RE.fullmatch(zip_sha) is None or SHA256_RE.fullmatch(checksum_sha) is None:
            raise VerificationError("artifact digest malformed")
        lookup[key] = row
        row_digests.append(sha256_bytes(canonical_bytes(row)))
    if (
        len(lookup) != len(expected_pairs)
        or acquisition.get("artifactPairCount") != len(rows)
        or acquisition.get("artifactPairCount") != expected_evidence.get("artifactPairCount")
        or acquisition.get("artifactRowsSha256") != sha256_bytes(normalized_lines(row_digests))
        or acquisition.get("artifactRowsSha256") != expected_evidence.get("artifactRowsSha256")
        or freeze.get("sharedArtifactRowsSha256") != acquisition.get("artifactRowsSha256")
        or freeze.get("sharedArtifactRowsSha256") != expected_evidence.get("artifactRowsSha256")
        or freeze.get("sharedArtifactPairCount") != acquisition.get("artifactPairCount")
        or freeze.get("sharedArtifactPairCount") != expected_evidence.get("artifactPairCount")
    ):
        raise VerificationError("artifact coverage/count/row digest mismatch")
    absent_raw = require_list(acquisition.get("absentSymbolMonths"), "absentSymbolMonths")
    if not all(isinstance(item, str) for item in absent_raw):
        raise VerificationError("absence row malformed")
    absent = [str(item) for item in absent_raw]
    if (
        absent != sorted(set(absent))
        or absent != sorted(expected_absent)
        or acquisition.get("absentSymbolMonthCount") != len(absent)
        or acquisition.get("absentSymbolMonthCount")
        != expected_evidence.get("absentSymbolMonthCount")
        or acquisition.get("absentSha256") != sha256_bytes(normalized_lines(absent))
        or acquisition.get("absentSha256") != expected_evidence.get("absentSymbolMonthsSha256")
        or freeze.get("sharedAbsentSymbolMonthsSha256") != acquisition.get("absentSha256")
        or freeze.get("sharedAbsentSymbolMonthsSha256")
        != expected_evidence.get("absentSymbolMonthsSha256")
        or freeze.get("sharedAbsentSymbolMonthCount") != acquisition.get("absentSymbolMonthCount")
        or freeze.get("sharedAbsentSymbolMonthCount")
        != expected_evidence.get("absentSymbolMonthCount")
    ):
        raise VerificationError("absence coverage/count/digest mismatch")
    normalized_target_inventory: list[str] = []
    target_pair_count = 0
    target_absent_count = 0
    for symbol in symbols:
        for month in target_months:
            target_row = lookup.get((symbol, month))
            if target_row is None:
                target_absent_count += 1
                normalized_target_inventory.append(f"{symbol}|{month}|ABSENT")
                continue
            target_pair_count += 1
            normalized_target_inventory.append(
                "|".join(
                    (
                        symbol,
                        month,
                        require_text(target_row.get("zipSha256"), "artifact.zipSha256"),
                        require_text(target_row.get("checksumSha256"), "artifact.checksumSha256"),
                        str(require_int(target_row.get("zipBytes"), "artifact.zipBytes")),
                        str(require_int(target_row.get("checksumBytes"), "artifact.checksumBytes")),
                    )
                )
            )
    inventory_digest = sha256_bytes(normalized_lines(normalized_target_inventory))
    if (
        freeze.get("targetArtifactInventorySha256") != inventory_digest
        or freeze.get("targetArtifactPairCount") != target_pair_count
        or freeze.get("targetAbsentPairCount") != target_absent_count
    ):
        raise VerificationError("frozen target inventory mismatch")


def verify_freeze(
    *,
    packet_dir: Path = PACKET_DIR,
    freeze_path: Path = FREEZE_PATH,
    source_root: Path | None = None,
    strict_paths: bool = True,
) -> dict[str, Any]:
    protocol, protocol_raw = load_json(packet_dir / "protocol.v1.json")
    verify_protocol(protocol)
    freeze, freeze_raw = load_json(freeze_path, require_canonical=True)
    if (
        freeze.get("schema") != "VG12FreezeV1"
        or freeze.get("state") != "FROZEN_BEFORE_ANY_VG12_ARCHIVE_BODY_OPEN"
        or freeze.get("archiveBodiesOpenedByVG12") is not False
        or freeze.get("holdoutArchiveBodiesOpenedByVG12") is not False
        or freeze.get("protocolSha256") != sha256_bytes(protocol_raw)
        or freeze.get("packetSourceSha256") != source_bindings(packet_dir)
        or freeze.get("trialId") != TRIAL_ID
        or freeze.get("attemptedTrialCount") != 1
    ):
        raise VerificationError("freeze contract/binding mismatch")
    frozen_runtime = require_dict(freeze.get("runtime"), "freeze.runtime")
    current_runtime = runtime_binding()
    if any(frozen_runtime.get(key) != current_runtime[key] for key in current_runtime):
        raise VerificationError("freeze runtime drift")
    frozen_root = Path(require_text(freeze.get("sourceRoot"), "freeze.sourceRoot"))
    if source_root is not None and source_root.resolve(strict=True) != frozen_root.resolve(
        strict=True
    ):
        raise VerificationError("requested source root differs from freeze")
    verify_source_manifests(frozen_root, freeze, protocol, strict_paths=strict_paths)
    return {
        "state": "FREEZE_VERIFIED_WITHOUT_ARCHIVE_BODY_OPEN",
        "freezeSha256": sha256_bytes(freeze_raw),
        "protocolSha256": sha256_bytes(protocol_raw),
        "candidateUniverseCount": freeze["candidateUniverseCount"],
        "sharedArtifactPairCount": freeze["sharedArtifactPairCount"],
        "sharedAbsentSymbolMonthCount": freeze["sharedAbsentSymbolMonthCount"],
        "targetArtifactPairCount": freeze["targetArtifactPairCount"],
        "targetAbsentPairCount": freeze["targetAbsentPairCount"],
    }


def verify_checksums(
    *, packet_dir: Path = PACKET_DIR, checksums_path: Path = CHECKSUMS_PATH
) -> dict[str, str]:
    if checksums_path.is_symlink() or not checksums_path.is_file():
        raise VerificationError("SHA256SUMS unavailable")
    expected: dict[str, str] = {}
    for line in checksums_path.read_text(encoding="ascii").splitlines():
        parts = line.split("  ", 1)
        if len(parts) != 2 or SHA256_RE.fullmatch(parts[0]) is None or parts[1] in expected:
            raise VerificationError("SHA256SUMS row malformed/duplicate")
        expected[parts[1]] = parts[0]
    if set(expected) != set(SEALED_FILES):
        raise VerificationError("SHA256SUMS file set mismatch")
    for name, digest in expected.items():
        if sha256_path(packet_dir / name) != digest:
            raise VerificationError(f"sealed packet byte drift: {name}")
    return expected


def marker_copy(
    record: object,
    *,
    expected_name: str,
    required: bool,
) -> tuple[str, dict[str, Any]] | None:
    if record is None:
        if required:
            raise VerificationError(f"required marker missing: {expected_name}")
        return None
    row = require_dict(record, f"marker.{expected_name}")
    payload = require_dict(row.get("payload"), f"marker.{expected_name}.payload")
    digest = sha256_bytes(canonical_bytes(payload))
    if (
        set(row) != {"filename", "sha256", "payload"}
        or row.get("filename") != expected_name
        or row.get("sha256") != digest
    ):
        raise VerificationError(f"self-contained marker copy mismatch: {expected_name}")
    return digest, payload


def git_output(repo: Path, *args: str) -> str:
    try:
        completed = subprocess.run(
            ("git", "-C", str(repo), *args),
            check=True,
            capture_output=True,
            text=True,
        )
    except (OSError, subprocess.CalledProcessError) as error:
        raise VerificationError(f"recorded Git object unavailable: {' '.join(args)}") from error
    return completed.stdout.strip()


def verify_pre_run_git(snapshot: Mapping[str, Any]) -> str:
    if snapshot.get("schema") != "VG12PreRunGitSnapshotV1":
        raise VerificationError("pre-run Git schema mismatch")
    if set(snapshot) != {
        "schema",
        "repositoryRoot",
        "packetRelativePath",
        "commit",
        "tree",
        "parent",
        "headBlobs",
    }:
        raise VerificationError("pre-run Git field roster mismatch")
    repo = Path(require_text(snapshot.get("repositoryRoot"), "preRunGit.repositoryRoot"))
    commit = require_text(snapshot.get("commit"), "preRunGit.commit")
    tree = require_text(snapshot.get("tree"), "preRunGit.tree")
    parent = require_text(snapshot.get("parent"), "preRunGit.parent")
    if (
        parent != BASE_COMMIT
        or GIT_OBJECT_RE.fullmatch(commit) is None
        or GIT_OBJECT_RE.fullmatch(tree) is None
        or GIT_OBJECT_RE.fullmatch(parent) is None
    ):
        raise VerificationError("pre-run Git parent mismatch")
    if (
        git_output(repo, "rev-parse", f"{commit}^{{tree}}") != tree
        or git_output(repo, "show", "-s", "--format=%P", commit) != parent
    ):
        raise VerificationError("pre-run Git commit/tree/parent mismatch")
    blobs = require_dict(snapshot.get("headBlobs"), "preRunGit.headBlobs")
    packet_relative = require_text(
        snapshot.get("packetRelativePath"), "preRunGit.packetRelativePath"
    )
    required = {f"{packet_relative}/{name}" for name in (*SOURCE_FILES, "freeze.v1.json")}
    if set(blobs) != required:
        raise VerificationError("pre-run Git blob roster mismatch")
    for path, digest in blobs.items():
        if not isinstance(path, str) or not isinstance(digest, str):
            raise VerificationError("pre-run Git blob record malformed")
        if GIT_OBJECT_RE.fullmatch(digest) is None:
            raise VerificationError("pre-run Git blob digest malformed")
        if git_output(repo, "rev-parse", f"{commit}:{path}") != digest:
            raise VerificationError(f"pre-run Git blob mismatch: {path}")
    return sha256_bytes(canonical_bytes(snapshot))


def compare(operator: str, observed: float | int, threshold: float | int) -> bool:
    if operator == ">=":
        return observed >= threshold
    if operator == "<=":
        return observed <= threshold
    if operator == ">":
        return observed > threshold
    if operator == "<":
        return observed < threshold
    raise VerificationError(f"unknown gate operator: {operator}")


def reconstructed_period_gates(
    protocol: Mapping[str, Any],
    period: str,
    analysis: Mapping[str, Any],
) -> list[dict[str, Any]]:
    frozen = require_dict(
        require_dict(protocol.get("gates"), "gates").get(period), f"gates.{period}"
    )
    scenarios = require_dict(analysis.get("scenarios"), f"{period}.scenarios")
    stress = require_dict(
        require_dict(scenarios.get("STRESS"), "STRESS").get("strategy"),
        "STRESS.strategy",
    )
    inference = require_dict(analysis.get("stressInference"), "stressInference")
    prefix = period.upper()
    formations = [
        require_dict(item, f"{period}.formations[]")
        for item in require_list(analysis.get("formations"), f"{period}.formations")
    ]
    valid_formations = sum(item.get("valid") is True for item in formations)
    broadening_formations = sum(
        item.get("valid") is True and item.get("broadening") is True for item in formations
    )
    held_symbols: set[str] = set()
    for item in formations:
        if item.get("valid") is True and item.get("broadening") is True:
            cohort = require_list(item.get("cohort"), f"{period}.formation.cohort")
            if len(cohort) != 30 or not all(isinstance(symbol, str) for symbol in cohort):
                raise VerificationError(f"{period} held cohort malformed")
            held_symbols.update(str(symbol) for symbol in cohort)
    if (
        stress.get("scheduledFormations") != len(formations)
        or stress.get("validFormations") != valid_formations
        or stress.get("broadeningFormations") != broadening_formations
        or stress.get("nonBroadeningOrTieFormations") != valid_formations - broadening_formations
        or stress.get("investedFormations") != broadening_formations
        or stress.get("fills") != broadening_formations * 60
        or stress.get("distinctHeldSymbols") != len(held_symbols)
    ):
        raise VerificationError(f"{period} formation-derived summary mismatch")
    exit_month_returns = require_dict(stress.get("exitMonthReturns"), "exitMonthReturns")
    calendar = require_dict(
        require_dict(protocol.get("calendar"), "calendar").get(period),
        f"calendar.{period}",
    )
    required_exit_months = require_list(
        calendar.get("requiredExitMonthBuckets"),
        f"calendar.{period}.requiredExitMonthBuckets",
    )
    if list(exit_month_returns) != required_exit_months:
        raise VerificationError(f"{period} exit-month bucket roster mismatch")
    positive_exit_months = sum(float(value) > 0 for value in exit_month_returns.values())
    if stress.get("positiveExitMonths") != positive_exit_months:
        raise VerificationError(f"{period} positive exit-month count mismatch")
    specs: list[tuple[str, float | int, str, float | int]] = [
        (
            f"{prefix}_VALID_FORMATIONS",
            valid_formations,
            ">=",
            require_int(frozen.get("minimumValidFormations"), "minimumValidFormations"),
        ),
        (
            f"{prefix}_BROADENING_FORMATIONS",
            broadening_formations,
            ">=",
            require_int(
                frozen.get("minimumBroadeningFormations"),
                "minimumBroadeningFormations",
            ),
        ),
        (
            f"{prefix}_NON_BROADENING_FORMATIONS",
            valid_formations - broadening_formations,
            ">=",
            require_int(
                frozen.get("minimumNonBroadeningOrTieFormations"),
                "minimumNonBroadeningOrTieFormations",
            ),
        ),
        (
            f"{prefix}_FILLS",
            broadening_formations * 60,
            ">=",
            require_int(frozen.get("minimumFills"), "minimumFills"),
        ),
        (
            f"{prefix}_DISTINCT_HELD_SYMBOLS",
            len(held_symbols),
            ">=",
            require_int(frozen.get("minimumDistinctHeldSymbols"), "minimumDistinctHeldSymbols"),
        ),
        (
            f"{prefix}_POSITIVE_STRESS_EXIT_MONTHS",
            positive_exit_months,
            ">=",
            require_int(
                frozen.get("minimumPositiveStressExitMonths"),
                "minimumPositiveStressExitMonths",
            ),
        ),
        (
            f"{prefix}_REQUIRED_STRESS_EXIT_MONTHS",
            len(exit_month_returns),
            ">=",
            require_int(frozen.get("requiredStressExitMonths"), "requiredStressExitMonths"),
        ),
        (
            f"{prefix}_STRESS_NET",
            float(stress["netUsdPerInitial1000"]),
            ">",
            float(frozen["stressNetExclusiveMinimumUsd"]),
        ),
        (
            f"{prefix}_STRESS_LCB",
            float(inference["netUsdPerInitial1000Lcb5Pct"]),
            ">",
            float(frozen["stressLcbExclusiveMinimumUsd"]),
        ),
        (
            f"{prefix}_STRESS_ONE_SIDED_P",
            float(inference["oneSidedP"]),
            "<",
            float(frozen["stressOneSidedPExclusiveMaximum"]),
        ),
        (
            f"{prefix}_MATCHED_BENCHMARK_EXCESS_LCB",
            float(inference["matchedBenchmarkExcessUsdLcb5Pct"]),
            ">",
            float(frozen["matchedBenchmarkExcessLcbExclusiveMinimumUsd"]),
        ),
    ]
    if period == "holdout":
        for scenario_name, key in (
            ("BASE", "baseNetExclusiveMinimumUsd"),
            ("FEE_STRESS", "feeStressNetExclusiveMinimumUsd"),
        ):
            summary = require_dict(
                require_dict(scenarios.get(scenario_name), scenario_name).get("strategy"),
                f"{scenario_name}.strategy",
            )
            specs.append(
                (
                    f"HOLDOUT_{scenario_name}_NET",
                    float(summary["netUsdPerInitial1000"]),
                    ">",
                    float(frozen[key]),
                )
            )
        capacity = require_dict(stress.get("capacityProxy"), "capacityProxy")
        specs.extend(
            (
                (
                    "HOLDOUT_MAX_WEEKLY_CLOSE_DRAWDOWN",
                    float(stress["weeklyCloseMaxDrawdownPct"]),
                    "<=",
                    float(frozen["maximumWeeklyCloseDrawdownPct"]),
                ),
                (
                    "HOLDOUT_TOP_ASSET_POSITIVE_GROSS_SHARE",
                    float(stress["topAssetPositiveGrossProfitSharePct"]),
                    "<=",
                    float(frozen["maximumTopAssetPositiveGrossProfitSharePct"]),
                ),
                (
                    "HOLDOUT_MAX_PARTICIPATION_PROXY",
                    float(capacity["maximumParticipationBps"]),
                    "<=",
                    float(frozen["maximumParticipationBps"]),
                ),
                (
                    "HOLDOUT_MINIMUM_C1BP_PROXY",
                    float(capacity["minimumC1bpUsd"]),
                    ">=",
                    float(frozen["minimumC1bpUsd"]),
                ),
            )
        )
    return [
        {
            "gateId": gate_id,
            "observed": observed,
            "operator": operator,
            "threshold": threshold,
            "passed": compare(operator, observed, threshold),
        }
        for gate_id, observed, operator, threshold in specs
    ]


def verify_result_semantics(
    result: Mapping[str, Any],
    protocol: Mapping[str, Any],
) -> list[dict[str, Any]]:
    verdict = result.get("measurementVerdict")
    decisions = require_list(result.get("gateDecisions"), "gateDecisions")
    if verdict == "UNMEASURED":
        if decisions or result.get("development") is not None or result.get("holdout") is not None:
            raise VerificationError("UNMEASURED carries measured evidence")
        return []
    development = require_dict(result.get("development"), "development")
    if len(require_list(development.get("formations"), "development.formations")) != 34:
        raise VerificationError("development formation count mismatch")
    expected = reconstructed_period_gates(protocol, "development", development)
    if result.get("holdout") is not None:
        holdout = require_dict(result.get("holdout"), "holdout")
        if len(require_list(holdout.get("formations"), "holdout.formations")) != 17:
            raise VerificationError("holdout formation count mismatch")
        expected.extend(reconstructed_period_gates(protocol, "holdout", holdout))
    if decisions != expected:
        raise VerificationError("gate roster/observed/operator/threshold/pass mismatch")
    expected_verdict = "GO" if all(row["passed"] for row in expected) else "NO_GO"
    if verdict != expected_verdict:
        raise VerificationError("measurement verdict differs from reconstructed gates")
    return expected


def verify_phase_journal(
    receipt: Mapping[str, Any],
    *,
    run_sha: str,
    result: Mapping[str, Any],
    protocol: Mapping[str, Any],
) -> list[dict[str, Any]]:
    journal = require_dict(receipt.get("phaseJournal"), "receipt.phaseJournal")
    entries_raw = require_list(journal.get("entries"), "receipt.phaseJournal.entries")
    entries = [require_dict(entry, "phaseJournal.entries[]") for entry in entries_raw]
    raw = b"".join(canonical_bytes(entry) for entry in entries)
    if (
        journal.get("filename") != "phase-journal.v1.jsonl"
        or journal.get("sha256") != sha256_bytes(raw)
        or not entries
    ):
        raise VerificationError("phase journal copy/digest mismatch")
    for ordinal, entry in enumerate(entries, start=1):
        if (
            entry.get("schema") != "VG12PhaseJournalEntryV1"
            or entry.get("ordinal") != ordinal
            or entry.get("runMarkerSha256") != run_sha
            or not isinstance(entry.get("atUtc"), str)
            or not isinstance(entry.get("phase"), str)
        ):
            raise VerificationError("phase journal entry contract mismatch")
        detail = entry.get("detailSha256")
        expected_keys = {
            "schema",
            "ordinal",
            "phase",
            "atUtc",
            "runMarkerSha256",
        }
        if detail is not None:
            expected_keys.add("detailSha256")
        if set(entry) != expected_keys:
            raise VerificationError("phase journal entry field roster mismatch")
        if detail is not None and (
            not isinstance(detail, str) or SHA256_RE.fullmatch(detail) is None
        ):
            raise VerificationError("phase journal detail digest malformed")
    phases = tuple(str(entry["phase"]) for entry in entries)
    if phases[-1] != "TERMINAL_FINALIZING":
        raise VerificationError("phase journal is not terminal")
    verdict = result.get("measurementVerdict")
    expected_phases: tuple[str, ...]
    if result.get("holdout") is not None:
        expected_phases = (*HAPPY_PHASES, "TERMINAL_FINALIZING")
        if phases != expected_phases:
            raise VerificationError("measured phase chain mismatch")
        development = require_dict(result.get("development"), "development")
        holdout = require_dict(result.get("holdout"), "holdout")
        markers = require_dict(receipt.get("markers"), "receipt.markers")
        candidate = require_dict(markers.get("candidateSeal"), "candidateSeal")
        holdout_marker = require_dict(markers.get("holdoutOpen"), "holdoutOpen")
        expected_details: dict[str, str] = {
            "DEVELOPMENT_ANALYZED": sha256_bytes(canonical_bytes(development)),
            "CANDIDATE_SEALED": require_text(candidate.get("sha256"), "candidate.sha256"),
            "HOLDOUT_MARKER_WRITTEN": require_text(
                holdout_marker.get("sha256"), "holdoutOpen.sha256"
            ),
            "HOLDOUT_ANALYZED": sha256_bytes(canonical_bytes(holdout)),
        }
        for entry in entries:
            phase = str(entry["phase"])
            if phase in expected_details and entry.get("detailSha256") != expected_details[phase]:
                raise VerificationError(f"phase detail binding mismatch: {phase}")
    elif result.get("state") == "TERMINAL_DEVELOPMENT_NO_GO_HOLDOUT_UNOPENED":
        expected_phases = (
            "RUN_MARKER_WRITTEN",
            "DEVELOPMENT_ARCHIVES_OPENING",
            "DEVELOPMENT_ANALYZED",
            "DEVELOPMENT_NO_GO",
            "TERMINAL_FINALIZING",
        )
        if phases != expected_phases:
            raise VerificationError("development NO_GO phase chain mismatch")
        development = require_dict(result.get("development"), "development")
        development_decisions = reconstructed_period_gates(protocol, "development", development)
        expected_details = {
            "DEVELOPMENT_ANALYZED": sha256_bytes(canonical_bytes(development)),
            "DEVELOPMENT_NO_GO": sha256_bytes(canonical_bytes(development_decisions)),
        }
        for entry in entries:
            phase = str(entry["phase"])
            if phase in expected_details and entry.get("detailSha256") != expected_details[phase]:
                raise VerificationError(f"phase detail binding mismatch: {phase}")
    elif verdict == "UNMEASURED":
        prefix = phases[:-1]
        if tuple(HAPPY_PHASES[: len(prefix)]) != prefix:
            raise VerificationError("UNMEASURED phase chain is not a valid durable prefix")
    else:
        raise VerificationError("result shape has no valid phase chain")
    result_bindings = require_dict(result.get("bindings"), "result.bindings")
    if entries[0].get("detailSha256") != result_bindings.get("preRunGitSha256"):
        raise VerificationError("run-marker phase does not bind pre-run Git")
    for entry in entries:
        if (
            entry["phase"]
            in {
                "DEVELOPMENT_ARCHIVES_OPENING",
                "HOLDOUT_ARCHIVES_OPENING",
            }
            and "detailSha256" in entry
        ):
            raise VerificationError("archive-opening phase may not carry synthetic detail")
    if entries[-1].get("detailSha256") != sha256_bytes(canonical_bytes(result)):
        raise VerificationError("terminal phase does not bind the durable result draft")
    return entries


def verify_packet(
    *,
    packet_dir: Path = PACKET_DIR,
    source_root: Path | None = None,
    state_root: Path = DEFAULT_STATE_ROOT,
    strict_paths: bool = True,
) -> dict[str, Any]:
    freeze_summary = verify_freeze(
        packet_dir=packet_dir,
        freeze_path=packet_dir / "freeze.v1.json",
        source_root=source_root,
        strict_paths=strict_paths,
    )
    checksums = verify_checksums(packet_dir=packet_dir, checksums_path=packet_dir / "SHA256SUMS")
    protocol, _ = load_json(packet_dir / "protocol.v1.json")
    freeze_payload, _ = load_json(packet_dir / "freeze.v1.json", require_canonical=True)
    result, result_raw = load_json(packet_dir / "result.v1.json", require_canonical=True)
    receipt, receipt_raw = load_json(packet_dir / "run-receipt.v1.json", require_canonical=True)
    assert_finite(result)
    if (
        result.get("schema") != "VG12ResultV1"
        or result.get("measurementVerdict") not in TERMINAL
        or result.get("trialId") != TRIAL_ID
        or result.get("attemptedTrialCount") != 1
    ):
        raise VerificationError("result schema/verdict/trial mismatch")
    limitations = require_list(
        protocol.get("limitationsRequiredInEveryTerminalResult"), "limitations"
    )
    if result.get("limitations") != limitations:
        raise VerificationError("terminal limitations mismatch")
    global_search = require_dict(
        require_dict(protocol.get("statistics"), "statistics").get("globalSearch"),
        "globalSearch",
    )
    if result.get("globalSearch") != global_search:
        raise VerificationError("global-search limitation drift")
    authority = require_dict(result.get("authority"), "result.authority")
    if (
        authority.get("capitalVerdict") != "NO_GO"
        or authority.get("capitalAuthority") != "NONE"
        or authority.get("executionAuthority") != "NONE"
    ):
        raise VerificationError("authority boundary mismatch")
    if (
        receipt.get("schema") != "VG12RunReceiptV1"
        or receipt.get("state") != "SELF_AUTHENTICATING_IMMUTABLE_PACKET_COPY_OF_ONE_USE_STATE"
    ):
        raise VerificationError("run receipt schema/state mismatch")
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
        raise VerificationError("run receipt field roster mismatch")
    if receipt.get("terminalPhase") != result.get("terminalPhase"):
        raise VerificationError("receipt/result terminal phase mismatch")
    draft_record = require_dict(receipt.get("terminalResultDraft"), "receipt.terminalResultDraft")
    draft_payload = require_dict(draft_record.get("payload"), "receipt.terminalResultDraft.payload")
    if (
        set(draft_record) != {"filename", "sha256", "payload"}
        or draft_record.get("filename") != "terminal-result-draft.v1.json"
        or draft_record.get("sha256") != sha256_bytes(canonical_bytes(draft_payload))
        or draft_payload != result
        or draft_record.get("sha256") != sha256_bytes(result_raw)
    ):
        raise VerificationError("receipt terminal-result draft mismatch")
    receipt_root = Path(require_text(receipt.get("stateRoot"), "receipt.stateRoot"))
    normalized_state = Path(os.path.abspath(state_root))
    if receipt_root != normalized_state or (
        strict_paths and normalized_state != DEFAULT_STATE_ROOT
    ):
        raise VerificationError("state root binding mismatch")
    markers = require_dict(receipt.get("markers"), "receipt.markers")
    if set(markers) != {"runMarker", "candidateSeal", "holdoutOpen"}:
        raise VerificationError("receipt marker roster mismatch")
    run_copy = marker_copy(
        markers.get("runMarker"), expected_name="run-marker.v1.json", required=True
    )
    if run_copy is None:
        raise AssertionError("required run marker copy absent")
    run_sha, run_marker = run_copy
    pre_run_git = require_dict(run_marker.get("preRunGit"), "runMarker.preRunGit")
    pre_run_git_sha = verify_pre_run_git(pre_run_git)
    expected_source = source_bindings(packet_dir)
    common_bindings: dict[str, str] = {
        "protocolSha256": str(freeze_summary["protocolSha256"]),
        "freezeSha256": str(freeze_summary["freezeSha256"]),
        "sharedDiscoverySha256": require_text(
            freeze_payload.get("sharedDiscoverySha256"),
            "freeze.sharedDiscoverySha256",
        ),
        "sharedAcquisitionSha256": require_text(
            freeze_payload.get("sharedAcquisitionSha256"),
            "freeze.sharedAcquisitionSha256",
        ),
        "targetArtifactInventorySha256": require_text(
            freeze_payload.get("targetArtifactInventorySha256"),
            "freeze.targetArtifactInventorySha256",
        ),
        "preRunGitSha256": pre_run_git_sha,
        "preRunCommit": require_text(pre_run_git.get("commit"), "preRunGit.commit"),
        "preRunTree": require_text(pre_run_git.get("tree"), "preRunGit.tree"),
        "preRunParent": require_text(pre_run_git.get("parent"), "preRunGit.parent"),
        **{f"packet:{name}": digest for name, digest in expected_source.items()},
    }
    expected_run_keys = {
        "schema",
        "state",
        "startedAtUtc",
        "preRunGit",
        "trialId",
        "attemptedTrialCount",
        "allowedRunCount",
        "consumedRunCount",
        "networkPermitted",
        "sharedSourceMutationPermitted",
        *common_bindings,
    }
    if (
        set(run_marker) != expected_run_keys
        or run_marker.get("schema") != "VG12RunMarkerV1"
        or run_marker.get("state") != "SOLE_DEVELOPMENT_ARCHIVE_OPEN_RUN_CONSUMED"
        or run_marker.get("trialId") != TRIAL_ID
        or run_marker.get("attemptedTrialCount") != 1
        or run_marker.get("allowedRunCount") != 1
        or run_marker.get("consumedRunCount") != 1
        or run_marker.get("networkPermitted") is not False
        or run_marker.get("sharedSourceMutationPermitted") is not False
        or run_marker.get("preRunGitSha256") != pre_run_git_sha
        or run_marker.get("startedAtUtc") != result.get("startedAtUtc")
        or any(run_marker.get(key) != value for key, value in common_bindings.items())
    ):
        raise VerificationError("run marker schema/state/counter/binding mismatch")
    bindings = require_dict(result.get("bindings"), "result.bindings")
    if (
        result.get("preRunGit") != pre_run_git
        or bindings.get("preRunGitSha256") != pre_run_git_sha
        or bindings.get("preRunCommit") != pre_run_git.get("commit")
        or bindings.get("preRunTree") != pre_run_git.get("tree")
        or bindings.get("preRunParent") != pre_run_git.get("parent")
        or bindings.get("freezeSha256") != freeze_summary["freezeSha256"]
        or bindings.get("runMarkerSha256") != run_sha
    ):
        raise VerificationError("result run/freeze/Git binding mismatch")
    for name, digest in expected_source.items():
        if run_marker.get(f"packet:{name}") != digest or bindings.get(f"packet:{name}") != digest:
            raise VerificationError(f"packet source binding mismatch: {name}")
    decisions = verify_result_semantics(result, protocol)
    holdout_published = result.get("holdout") is not None
    candidate_copy = marker_copy(
        markers.get("candidateSeal"),
        expected_name="candidate-seal.v1.json",
        required=holdout_published,
    )
    holdout_copy = marker_copy(
        markers.get("holdoutOpen"),
        expected_name="holdout-open.v1.json",
        required=holdout_published,
    )
    if candidate_copy is not None:
        candidate_sha, candidate = candidate_copy
        development_value = result.get("development")
        published_development = (
            require_dict(development_value, "development")
            if development_value is not None
            else None
        )
        sealed_development = require_dict(
            candidate.get("developmentEvidence"),
            "candidate.developmentEvidence",
        )
        sealed_decisions = require_list(
            candidate.get("developmentGateDecisions"),
            "candidate.developmentGateDecisions",
        )
        dev_decisions = reconstructed_period_gates(protocol, "development", sealed_development)
        candidate_bindings = {**common_bindings, "runMarkerSha256": run_sha}
        expected_candidate_keys = {
            "schema",
            "state",
            "sealedAtUtc",
            "trialId",
            "attemptedTrialCount",
            "developmentEvidence",
            "developmentEvidenceSha256",
            "developmentGateDecisions",
            "developmentGateDecisionsSha256",
            "holdoutArchiveBodiesOpened",
            "retuningOrSelection",
            *candidate_bindings,
        }
        if (
            set(candidate) != expected_candidate_keys
            or candidate.get("schema") != "VG12CandidateSealV1"
            or candidate.get("state") != "FIXED_SINGLE_TRIAL_QUALIFIED_BEFORE_HOLDOUT_OPEN"
            or not isinstance(candidate.get("sealedAtUtc"), str)
            or candidate.get("trialId") != TRIAL_ID
            or candidate.get("attemptedTrialCount") != 1
            or candidate.get("holdoutArchiveBodiesOpened") is not False
            or candidate.get("retuningOrSelection") != "NONE"
            or candidate.get("runMarkerSha256") != run_sha
            or candidate.get("preRunGitSha256") != pre_run_git_sha
            or candidate.get("developmentEvidenceSha256")
            != sha256_bytes(canonical_bytes(sealed_development))
            or candidate.get("developmentGateDecisionsSha256")
            != sha256_bytes(canonical_bytes(sealed_decisions))
            or sealed_decisions != dev_decisions
            or not all(row["passed"] for row in dev_decisions)
            or (published_development is not None and published_development != sealed_development)
            or bindings.get("candidateSealSha256") != candidate_sha
            or any(candidate.get(key) != value for key, value in candidate_bindings.items())
        ):
            raise VerificationError("candidate seal schema/state/hash qualification mismatch")
    if holdout_copy is not None:
        holdout_sha, holdout_marker = holdout_copy
        if candidate_copy is None:
            raise VerificationError("holdout marker lacks candidate")
        expected_holdout_bindings = {
            "candidateSealSha256": candidate_copy[0],
            "runMarkerSha256": run_sha,
            "preRunGitSha256": pre_run_git_sha,
            "preRunCommit": common_bindings["preRunCommit"],
            "preRunTree": common_bindings["preRunTree"],
            "preRunParent": common_bindings["preRunParent"],
            "protocolSha256": common_bindings["protocolSha256"],
            "freezeSha256": common_bindings["freezeSha256"],
        }
        expected_holdout_keys = {
            "schema",
            "state",
            "openedAtUtc",
            "trialId",
            "allowedOpenCount",
            "consumedOpenCount",
            "postOpenRepairRerunRetuneOrReopen",
            *expected_holdout_bindings,
        }
        if (
            set(holdout_marker) != expected_holdout_keys
            or holdout_marker.get("schema") != "VG12HoldoutOpenMarkerV1"
            or holdout_marker.get("state") != "SOLE_FIXED_TRIAL_HOLDOUT_OPEN_CONSUMED"
            or not isinstance(holdout_marker.get("openedAtUtc"), str)
            or holdout_marker.get("trialId") != TRIAL_ID
            or holdout_marker.get("allowedOpenCount") != 1
            or holdout_marker.get("consumedOpenCount") != 1
            or holdout_marker.get("postOpenRepairRerunRetuneOrReopen") is not False
            or holdout_marker.get("candidateSealSha256") != candidate_copy[0]
            or holdout_marker.get("runMarkerSha256") != run_sha
            or holdout_marker.get("preRunGitSha256") != pre_run_git_sha
            or bindings.get("holdoutOpenSha256") != holdout_sha
            or any(
                holdout_marker.get(key) != value for key, value in expected_holdout_bindings.items()
            )
        ):
            raise VerificationError("holdout marker schema/state/counter/binding mismatch")
    if not holdout_published and result.get("measurementVerdict") != "UNMEASURED":
        if candidate_copy is not None or holdout_copy is not None:
            raise VerificationError("development NO_GO carries holdout lifecycle")
        if "candidateSealSha256" in bindings or "holdoutOpenSha256" in bindings:
            raise VerificationError("development NO_GO carries holdout bindings")
    expected_result_bindings = {
        **common_bindings,
        "runMarkerSha256": run_sha,
    }
    if candidate_copy is not None:
        expected_result_bindings["candidateSealSha256"] = candidate_copy[0]
    if holdout_copy is not None:
        expected_result_bindings["holdoutOpenSha256"] = holdout_copy[0]
    if bindings != expected_result_bindings:
        raise VerificationError("result binding roster/value mismatch")
    base_result_keys = {
        "schema",
        "protocolId",
        "trialId",
        "attemptedTrialCount",
        "startedAtUtc",
        "completedAtUtc",
        "bindings",
        "preRunGit",
        "authority",
        "globalSearch",
        "limitations",
        "state",
        "terminalPhase",
        "sourceIssues",
        "development",
        "holdout",
        "gateDecisions",
        "measurementVerdict",
    }
    if result.get("state") == "TERMINAL_MEASURED_NO_REPAIR_OR_RERUN":
        if set(result) != base_result_keys or not holdout_published:
            raise VerificationError("measured result state/field roster mismatch")
    elif result.get("state") == "TERMINAL_DEVELOPMENT_NO_GO_HOLDOUT_UNOPENED":
        if (
            set(result) != base_result_keys | {"reasonCode", "reason"}
            or result.get("measurementVerdict") != "NO_GO"
        ):
            raise VerificationError("development NO_GO result field roster mismatch")
    elif result.get("state") == "TERMINAL_UNMEASURED_NO_REPAIR_OR_RERUN":
        if (
            set(result) != base_result_keys | {"reasonCode", "reason"}
            or result.get("measurementVerdict") != "UNMEASURED"
        ):
            raise VerificationError("UNMEASURED result field roster mismatch")
    else:
        raise VerificationError("terminal result state mismatch")
    verify_phase_journal(receipt, run_sha=run_sha, result=result, protocol=protocol)
    return {
        "state": "SEALED_PACKET_VERIFIED_WITHOUT_OUTCOME_RECOMPUTATION",
        "measurementVerdict": result["measurementVerdict"],
        "gateCount": len(decisions),
        "resultSha256": sha256_bytes(result_raw),
        "runReceiptSha256": sha256_bytes(receipt_raw),
        "freeze": freeze_summary,
        "sealedFileCount": len(checksums),
        "limitations": limitations,
    }


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("freeze", "packet"))
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        payload = verify_freeze() if args.command == "freeze" else verify_packet()
        print(json.dumps(payload, sort_keys=True, indent=2))
    except VerificationError as error:
        print(f"V-G12 VERIFY REFUSED: {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
