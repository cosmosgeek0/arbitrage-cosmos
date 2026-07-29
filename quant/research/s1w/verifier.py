#!/usr/bin/env python3
"""Independent network-free S-1W packet verifier."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import cast

PACKET_ROOT = Path(__file__).resolve().parent
BASE_COMMIT = "a169b123fb186d1943a75ad648552c4d95be1be1"
EXPECTED_FREEZE_BINDING_PATHS = (
    "__init__.py",
    "README.md",
    "OFFICIAL_SOURCE_RESEARCH.md",
    "PRE_FREEZE_EXPOSURE.v1.json",
    "protocol.v1.json",
    "source-plan.v1.json",
    "universe.v1.json",
    "experiment.py",
    "verifier.py",
    "test_experiment.py",
    "test_verifier.py",
    "generated/source-observations.v1.json",
)
EXPECTED_CHECKSUM_PATHS = frozenset(
    (
        *EXPECTED_FREEZE_BINDING_PATHS,
        "generated/freeze.v1.json",
        "generated/RUN_CONSUMED.v1.json",
        "generated/result.v1.json",
    )
)


class VerificationError(RuntimeError):
    """Authenticated packet invariant failure."""


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1 << 20):
            digest.update(chunk)
    return digest.hexdigest()


def load_object(path: Path) -> dict[str, object]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise VerificationError(f"JSON_OBJECT_REQUIRED:{path}")
    return cast(dict[str, object], value)


def _require_mapping(value: object, name: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise VerificationError(f"MAPPING_REQUIRED:{name}")
    return cast(dict[str, object], value)


def verify_checksums(packet_root: Path) -> None:
    checksum_path = packet_root / "SHA256SUMS"
    lines = checksum_path.read_text(encoding="ascii").splitlines()
    if not lines:
        raise VerificationError("CHECKSUMS_EMPTY")
    recorded: dict[str, str] = {}
    for line in lines:
        match = re.fullmatch(r"([0-9a-f]{64})  ([A-Za-z0-9_./-]+)", line)
        if match is None:
            raise VerificationError("CHECKSUM_LINE_INVALID")
        digest, relative = match.groups()
        if relative in recorded:
            raise VerificationError(f"CHECKSUM_DUPLICATE:{relative}")
        path = packet_root / relative
        if not path.is_file() or path.is_symlink():
            raise VerificationError(f"CHECKSUM_FILE_INVALID:{relative}")
        if sha256_file(path) != digest:
            raise VerificationError(f"CHECKSUM_MISMATCH:{relative}")
        recorded[relative] = digest
    discovered = {
        path.relative_to(packet_root).as_posix()
        for path in packet_root.rglob("*")
        if path.is_file()
        and not path.is_symlink()
        and path.name != "SHA256SUMS"
        and "__pycache__" not in path.relative_to(packet_root).parts
        and path.suffix not in {".pyc", ".pyo"}
    }
    if discovered != EXPECTED_CHECKSUM_PATHS:
        raise VerificationError("PACKET_PATH_SET_MISMATCH")
    if set(recorded) != EXPECTED_CHECKSUM_PATHS:
        raise VerificationError("CHECKSUM_PATH_SET_MISMATCH")


def verify_packet(packet_root: Path = PACKET_ROOT) -> None:
    """Authenticate the complete terminal packet without network or raw data."""

    protocol = load_object(packet_root / "protocol.v1.json")
    universe = load_object(packet_root / "universe.v1.json")
    exposure = load_object(packet_root / "PRE_FREEZE_EXPOSURE.v1.json")
    observations = load_object(packet_root / "generated/source-observations.v1.json")
    freeze = load_object(packet_root / "generated/freeze.v1.json")
    marker = load_object(packet_root / "generated/RUN_CONSUMED.v1.json")
    result = load_object(packet_root / "generated/result.v1.json")

    schemas = (
        (protocol.get("schema"), "cosmos.quant.research.s1w.protocol.v1"),
        (universe.get("schema"), "cosmos.quant.research.s1w.universe.v1"),
        (exposure.get("schema"), "cosmos.quant.research.s1w.pre-freeze-exposure.v1"),
        (observations.get("schema"), "cosmos.quant.research.s1w.source-observations.v1"),
        (freeze.get("schema"), "cosmos.quant.research.s1w.freeze.v1"),
        (marker.get("schema"), "cosmos.quant.research.s1w.run-consumed.v1"),
        (result.get("schema"), "cosmos.quant.research.s1w.result.v1"),
    )
    if any(observed != expected for observed, expected in schemas):
        raise VerificationError("SCHEMA_MISMATCH")

    bindings = _require_mapping(freeze.get("bindings"), "freeze.bindings")
    if set(bindings) != set(EXPECTED_FREEZE_BINDING_PATHS):
        raise VerificationError("FREEZE_BINDING_PATH_SET_MISMATCH")
    for relative in EXPECTED_FREEZE_BINDING_PATHS:
        recorded_digest = bindings.get(relative)
        if not isinstance(recorded_digest, str):
            raise VerificationError("FREEZE_BINDING_TYPE")
        path = packet_root / relative
        if not path.is_file() or path.is_symlink():
            raise VerificationError(f"FREEZE_BINDING_FILE_INVALID:{relative}")
        if sha256_file(path) != recorded_digest:
            raise VerificationError(f"FREEZE_BINDING_MISMATCH:{relative}")

    freeze_sha = sha256_file(packet_root / "generated/freeze.v1.json")
    if (
        freeze.get("baseCommit") != BASE_COMMIT
        or freeze.get("state") != "SEALED_BEFORE_ANY_ELIGIBLE_OUTCOME_ARCHIVE_OPEN"
        or freeze.get("eligibleOutcomeArchiveMembersOpened") != 0
        or freeze.get("declaredRuns") != 1
    ):
        raise VerificationError("FREEZE_STATE_MISMATCH")
    if marker.get("freezeSha256") != freeze_sha:
        raise VerificationError("RUN_MARKER_FREEZE_MISMATCH")
    if (
        marker.get("state") != "CONSUMED_BEFORE_ANY_ELIGIBLE_DEVELOPMENT_OUTCOME_READ"
        or marker.get("eligibleOutcomeArchiveMembersOpenedBeforeMarker") != 0
        or marker.get("declaredRuns") != 1
        or marker.get("sourceObservationsSha256")
        != bindings["generated/source-observations.v1.json"]
    ):
        raise VerificationError("RUN_MARKER_STATE_MISMATCH")
    provenance = _require_mapping(result.get("provenance"), "result.provenance")
    if provenance.get("freezeSha256") != freeze_sha:
        raise VerificationError("RESULT_FREEZE_MISMATCH")
    if provenance.get("runMarkerSha256") != sha256_file(
        packet_root / "generated/RUN_CONSUMED.v1.json"
    ):
        raise VerificationError("RESULT_RUN_MARKER_MISMATCH")
    for field, relative in (
        ("protocolSha256", "protocol.v1.json"),
        ("sourceObservationsSha256", "generated/source-observations.v1.json"),
        ("preFreezeExposureSha256", "PRE_FREEZE_EXPOSURE.v1.json"),
    ):
        if provenance.get(field) != sha256_file(packet_root / relative):
            raise VerificationError(f"RESULT_PROVENANCE_MISMATCH:{field}")

    assessment = _require_mapping(observations.get("assessment"), "observations.assessment")
    if assessment.get("pointInTimeCausalOpenInterestInput") != "UNPROVEN":
        raise VerificationError("CAUSAL_SOURCE_STATE_MISMATCH")
    if assessment.get("pointInTimeFundingSignInput") != "UNPROVEN":
        raise VerificationError("FUNDING_SIGN_SOURCE_STATE_MISMATCH")
    documents = observations.get("officialDocuments")
    if not isinstance(documents, list) or len(documents) != 3:
        raise VerificationError("OFFICIAL_DOCUMENT_SET_MISMATCH")
    documents_by_id = {
        document.get("id"): document for document in documents if isinstance(document, dict)
    }
    if set(documents_by_id) != {
        "USD_M_OPEN_INTEREST_STATISTICS",
        "USD_M_FUNDING_RATE_HISTORY",
        "BINANCE_PUBLIC_DATA_README",
    }:
        raise VerificationError("OFFICIAL_DOCUMENT_ID_SET_MISMATCH")
    readme = _require_mapping(
        documents_by_id["BINANCE_PUBLIC_DATA_README"], "officialDocuments.readme"
    )
    readme_fragments = _require_mapping(
        readme.get("requiredFragmentsPresent"), "officialDocuments.readme.fragments"
    )
    if readme.get("accessState") != "CONTENT_VERIFIED" or not all(
        value is True for value in readme_fragments.values()
    ):
        raise VerificationError("OFFICIAL_README_NOT_VERIFIED")
    for identifier in ("USD_M_OPEN_INTEREST_STATISTICS", "USD_M_FUNDING_RATE_HISTORY"):
        document = _require_mapping(documents_by_id[identifier], f"officialDocuments.{identifier}")
        fragments = _require_mapping(
            document.get("requiredFragmentsPresent"),
            f"officialDocuments.{identifier}.fragments",
        )
        content_verified = document.get("accessState") == "CONTENT_VERIFIED" and all(
            value is True for value in fragments.values()
        )
        waf_recorded = (
            document.get("accessState") == "AWS_WAF_CHALLENGE"
            and document.get("httpStatus") == 202
            and document.get("bytes") == 0
            and all(value is False for value in fragments.values())
        )
        if not content_verified and not waf_recorded:
            raise VerificationError(f"OFFICIAL_DOCUMENT_ACCESS_STATE_INVALID:{identifier}")
    archives = observations.get("officialArchiveSamples")
    if not isinstance(archives, list) or len(archives) != 4:
        raise VerificationError("ARCHIVE_SAMPLE_SET_MISMATCH")
    archive_datasets: set[object] = set()
    for archive_value in archives:
        archive = _require_mapping(archive_value, "officialArchiveSamples.item")
        archive_datasets.add(archive.get("dataset"))
        if (
            archive.get("sampleSymbolOutcomeEligibility") != "QUARANTINED"
            or not isinstance(archive.get("rowCount"), int)
            or cast(int, archive["rowCount"]) <= 0
        ):
            raise VerificationError("ARCHIVE_SAMPLE_STATE_INVALID")
        for digest_field in ("archiveSha256", "checksumSidecarSha256", "memberSha256"):
            digest = archive.get(digest_field)
            if not isinstance(digest, str) or re.fullmatch(r"[0-9a-f]{64}", digest) is None:
                raise VerificationError(f"ARCHIVE_SAMPLE_DIGEST_INVALID:{digest_field}")
    if archive_datasets != {
        "metrics",
        "fundingRate",
        "contractKlines1h",
        "markPriceKlines1h",
    }:
        raise VerificationError("ARCHIVE_SAMPLE_DATASET_MISMATCH")
    causal_gate = _require_mapping(protocol.get("causalSourceGate"), "protocol.causalSourceGate")
    if causal_gate.get("currentState") != "FAILED":
        raise VerificationError("PROTOCOL_CAUSAL_GATE_MISMATCH")
    if result.get("terminalState") != "UNMEASURED":
        raise VerificationError("TERMINAL_STATE_MISMATCH")
    if result.get("capitalVerdict") != "NO_GO" or result.get("authority") != "NONE":
        raise VerificationError("AUTHORITY_OR_CAPITAL_MISMATCH")
    if (
        protocol.get("baseCommit") != BASE_COMMIT
        or universe.get("baseCommit") != BASE_COMMIT
        or provenance.get("baseCommit") != BASE_COMMIT
        or provenance.get("runCount") != 1
    ):
        raise VerificationError("BASE_OR_RUN_PROVENANCE_MISMATCH")

    expected_reasons = causal_gate.get("reasonCodes")
    if result.get("reasonCodes") != expected_reasons:
        raise VerificationError("REASON_CODE_MISMATCH")

    headline = _require_mapping(result.get("headline"), "result.headline")
    if any(value is not None for value in headline.values()):
        raise VerificationError("UNMEASURED_HEADLINE_MUST_BE_NULL")
    samples = _require_mapping(result.get("samples"), "result.samples")
    if any(value is not None for value in samples.values()):
        raise VerificationError("UNMEASURED_SAMPLES_MUST_BE_NULL")
    intervals = _require_mapping(result.get("intervals"), "result.intervals")
    if any(value is not None for value in intervals.values()):
        raise VerificationError("UNMEASURED_INTERVALS_MUST_BE_NULL")
    multiplicity = _require_mapping(result.get("multiplicity"), "result.multiplicity")
    if any(value is not None for value in multiplicity.values()):
        raise VerificationError("UNMEASURED_MULTIPLICITY_MUST_BE_NULL")
    comparators = _require_mapping(result.get("comparators"), "result.comparators")
    if any(value is not None for value in comparators.values()):
        raise VerificationError("UNMEASURED_COMPARATORS_MUST_BE_NULL")
    drawdown = _require_mapping(result.get("drawdown"), "result.drawdown")
    if any(value is not None for value in drawdown.values()):
        raise VerificationError("UNMEASURED_DRAWDOWN_MUST_BE_NULL")

    development = _require_mapping(result.get("development"), "result.development")
    holdout = _require_mapping(result.get("holdout"), "result.holdout")
    if development.get("eligibleOutcomeArchiveMembersOpened") != 0:
        raise VerificationError("DEVELOPMENT_OUTCOME_OPEN_COUNT_NONZERO")
    if holdout.get("eligibleOutcomeArchiveMembersOpened") != 0:
        raise VerificationError("HOLDOUT_OUTCOME_OPEN_COUNT_NONZERO")
    forbidden_generated = {
        "candidate-seal.v1.json",
        "HOLDOUT_OPENED.v1.json",
        "development.v1.json",
        "holdout.v1.json",
    }
    present = {path.name for path in (packet_root / "generated").glob("*.json")}
    if forbidden_generated & present:
        raise VerificationError("FORBIDDEN_LIFECYCLE_ARTIFACT_PRESENT")

    symbols = universe.get("symbols")
    if not isinstance(symbols, list) or len(symbols) != 11 or "BTCUSDT" in symbols:
        raise VerificationError("QUARANTINED_UNIVERSE_MISMATCH")
    disposition = _require_mapping(exposure.get("disposition"), "exposure.disposition")
    aggregate_custody = _require_mapping(
        exposure.get("aggregateCustody"), "exposure.aggregateCustody"
    )
    if disposition.get("symbol") != "BTCUSDT":
        raise VerificationError("EXPOSURE_QUARANTINE_MISMATCH")
    if disposition.get("outcomeEligibility") != (
        "QUARANTINED_FOR_ALL_WARMUP_DEVELOPMENT_EMBARGO_HOLDOUT_AND_DIAGNOSTIC_WINDOWS"
    ):
        raise VerificationError("EXPOSURE_DISPOSITION_MISMATCH")
    if (
        aggregate_custody.get("uniqueArchiveMembersOpened") != 10
        or aggregate_custody.get("uniqueSymbolsOpened") != 1
        or aggregate_custody.get("eligibleOutcomeArchiveMembersOpened") != 0
        or aggregate_custody.get("allOpenedMembersQuarantined") is not True
        or disposition.get("uniqueArchiveMembersQuarantined") != 10
    ):
        raise VerificationError("EXPOSURE_AGGREGATE_CUSTODY_MISMATCH")

    capacity = _require_mapping(result.get("capacity"), "result.capacity")
    fees = _require_mapping(result.get("fees"), "result.fees")
    if capacity.get("executableCapacity") != "UNKNOWN":
        raise VerificationError("EXECUTABLE_CAPACITY_MUST_BE_UNKNOWN")
    if fees.get("accountEffectiveFees") != "UNKNOWN":
        raise VerificationError("ACCOUNT_FEES_MUST_BE_UNKNOWN")
    verify_checksums(packet_root)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args()
    try:
        verify_packet()
    except (VerificationError, OSError, ValueError, json.JSONDecodeError) as error:
        print(f"S1W_VERIFY_ERROR {error}")
        return 2
    print("S1W_AUTHENTIC UNMEASURED CAPITAL_NO_GO OUTCOME_ARCHIVE_MEMBERS_OPENED=0")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
