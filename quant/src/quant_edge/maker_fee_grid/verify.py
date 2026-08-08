"""Deterministic verification for the public maker-fee grid evidence package."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from decimal import Decimal
from pathlib import Path
from typing import Any

REQUIRED_POSITIVE_GATES = (
    "familyPositiveEligible",
    "completeAttemptLedgerVerified",
    "sealedInputBodiesVerified",
    "causalMakerEntryFillVerified",
    "publicNoBnbPlus2BpsPerSidePassed",
    "accountEffectiveFeeScenarioPassed",
    "independentOosHoldoutPassed",
    "simultaneousLowerBoundPositive",
    "holmFamilywisePassed",
    "pboPassed",
    "markedDrawdownPassed",
    "executableCapacityPassed",
)

EXPECTED_ARTIFACTS = (
    "custody_receipt.v1.json",
    "official_fee_sources.v1.json",
    "protocol.v1.json",
    "result.v1.json",
)


def sha256_path(path: Path) -> str:
    """Return the SHA-256 digest of one file."""

    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _load_object(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path.name} must contain one JSON object")
    return value


def classify_positive(
    point_usd_per_1000: Decimal | None,
    gates: Mapping[str, object],
) -> str:
    """Apply the frozen positive-result law without allowing PBO to override another gate."""

    if point_usd_per_1000 is None:
        return "NOT_ASSESSED"
    if point_usd_per_1000 <= 0:
        return "NON_POSITIVE"
    if all(gates.get(gate) is True for gate in REQUIRED_POSITIVE_GATES):
        return "FAMILY_QUALIFYING_NOT_CAPITAL_AUTHORITY"
    return "REJECTED_POSITIVE_UNVERIFIED"


def _verify_manifest(package_dir: Path) -> tuple[dict[str, Any], list[str]]:
    errors: list[str] = []
    manifest = _load_object(package_dir / "artifact_manifest.v1.json")
    if manifest.get("schema") != "MakerFeeGridArtifactManifestV1":
        errors.append("MANIFEST_SCHEMA_MISMATCH")
    entries = manifest.get("artifacts")
    if not isinstance(entries, list):
        return manifest, [*errors, "MANIFEST_ARTIFACTS_NOT_LIST"]

    listed: set[str] = set()
    for entry in entries:
        if not isinstance(entry, dict):
            errors.append("MANIFEST_ENTRY_NOT_OBJECT")
            continue
        name = entry.get("path")
        expected = entry.get("sha256")
        if not isinstance(name, str) or name not in EXPECTED_ARTIFACTS:
            errors.append("MANIFEST_PATH_NOT_ALLOWED")
            continue
        if name in listed:
            errors.append("MANIFEST_DUPLICATE_PATH")
            continue
        listed.add(name)
        artifact = package_dir / name
        if not artifact.is_file():
            errors.append(f"ARTIFACT_ABSENT:{name}")
            continue
        if not isinstance(expected, str) or sha256_path(artifact) != expected:
            errors.append(f"ARTIFACT_HASH_MISMATCH:{name}")
    if listed != set(EXPECTED_ARTIFACTS):
        errors.append("MANIFEST_ARTIFACT_SET_MISMATCH")
    return manifest, errors


def _all_requested_metrics_are_null(result: Mapping[str, Any]) -> bool:
    scenarios = result.get("scenarios")
    if not isinstance(scenarios, list) or len(scenarios) != 2:
        return False
    required_nulls = (
        "netUsdPer1000SpotEntryNotional",
        "interval95UsdPer1000SpotEntryNotional",
        "maxDrawdownUsd",
        "maxDrawdownFraction",
        "capacityUsd",
        "positiveSubsetCount",
        "feeDecompositionUsd",
        "pairAndPredeclaredRegimeBreakdown",
    )
    for scenario in scenarios:
        if not isinstance(scenario, dict):
            return False
        if scenario.get("measurementState") != "NOT_MEASURED":
            return False
        if any(field not in scenario or scenario[field] is not None for field in required_nulls):
            return False
    return True


def verify_package(package_dir: Path) -> dict[str, Any]:
    """Verify artifact hashes and the fail-closed blocked-result invariants."""

    _, errors = _verify_manifest(package_dir)
    protocol = _load_object(package_dir / "protocol.v1.json")
    sources = _load_object(package_dir / "official_fee_sources.v1.json")
    custody = _load_object(package_dir / "custody_receipt.v1.json")
    result = _load_object(package_dir / "result.v1.json")

    if protocol.get("schema") != "MakerFeeEdgeGridProtocolV1":
        errors.append("PROTOCOL_SCHEMA_MISMATCH")
    if protocol.get("freezeState") != "FROZEN_BEFORE_GRID_OUTCOMES":
        errors.append("PROTOCOL_NOT_PREOUTCOME_FROZEN")
    if sources.get("schema") != "MakerFeeGridOfficialSourcesV1":
        errors.append("OFFICIAL_SOURCES_SCHEMA_MISMATCH")
    if sources.get("feePosture") != "PUBLIC_SCHEDULE_SCENARIO_ONLY":
        errors.append("PUBLIC_FEE_POSTURE_MISMATCH")
    if sources.get("accountEffectiveFees") != "UNKNOWN":
        errors.append("ACCOUNT_FEE_TRUTH_OVERSTATED")
    if custody.get("schema") != "MakerFeeGridCustodyReceiptV1":
        errors.append("CUSTODY_SCHEMA_MISMATCH")
    if custody.get("custodyState") != "ACCEPTED_RECEIPT_ONLY":
        errors.append("CUSTODY_STATE_MISMATCH")
    if custody.get("requiredBodyAvailability") != "ABSENT":
        errors.append("CUSTODY_ABSENCE_NOT_RECORDED")
    if result.get("schema") != "MakerFeeEdgeGridResultV1":
        errors.append("RESULT_SCHEMA_MISMATCH")
    if result.get("status") != "BLOCKED":
        errors.append("RESULT_MUST_BE_BLOCKED")
    if result.get("normalizedVerdict") != "UNKNOWN_DATA":
        errors.append("RESULT_VERDICT_MUST_BE_UNKNOWN_DATA")
    if result.get("blocker") != "ACCEPTED_E1_BODY_BYTES_UNAVAILABLE":
        errors.append("RESULT_BLOCKER_MISMATCH")
    if result.get("positiveEdgeClaim") != "NOT_MADE":
        errors.append("POSITIVE_EDGE_CLAIM_FORBIDDEN")
    if not _all_requested_metrics_are_null(result):
        errors.append("BLOCKED_RESULT_CONTAINS_MEASURED_METRIC")

    protocol_sha = sha256_path(package_dir / "protocol.v1.json")
    if custody.get("protocolSha256") != protocol_sha:
        errors.append("CUSTODY_PROTOCOL_BINDING_MISMATCH")
    if result.get("protocolSha256") != protocol_sha:
        errors.append("RESULT_PROTOCOL_BINDING_MISMATCH")

    return {
        "schema": "MakerFeeGridVerificationV1",
        "artifactCount": len(EXPECTED_ARTIFACTS),
        "blocker": result.get("blocker"),
        "errors": errors,
        "evidenceStatus": "PASS" if not errors else "FAIL",
        "measurementStatus": result.get("status"),
        "normalizedVerdict": result.get("normalizedVerdict"),
    }
