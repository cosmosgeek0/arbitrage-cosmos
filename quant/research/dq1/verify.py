"""Network-free golden-fixture verifier for DQ-1."""

from __future__ import annotations

import base64
import hashlib
import json
from pathlib import Path
from typing import Any, cast

from research.dq1.boundary import (
    AcquisitionReceiptV1,
    ValidationContextV1,
    validate_archive,
)

DQ1_DIR = Path(__file__).resolve().parent
QUANT_DIR = DQ1_DIR.parents[1]
FIXTURE_DIR = DQ1_DIR / "fixtures"
CANONICAL_BASE = "a169b123fb186d1943a75ad648552c4d95be1be1"


def _sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _read_json(path: Path) -> dict[str, Any]:
    payload: object = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise AssertionError(f"{path.name} must contain a JSON object")
    return cast(dict[str, Any], payload)


def _decode_fixture(filename: str) -> bytes:
    return base64.b64decode((FIXTURE_DIR / f"{filename}.b64").read_bytes(), validate=False)


def _context() -> ValidationContextV1:
    return ValidationContextV1(
        policy_sha256=_sha256((DQ1_DIR / "policy.v1.json").read_bytes()),
        validator_sha256=_sha256((DQ1_DIR / "boundary.py").read_bytes()),
        runtime_lock_sha256=_sha256((QUANT_DIR / "uv.lock").read_bytes()),
        public_data_docs_commit="5c7f3197591c0d54d85dc43066226bc4c671d47a",
        public_data_docs_sha256=(
            "085ab91377aa9325d44f4c7ad27cce4ab381e158403e1d7df2bad39d1a66f7c6"
        ),
        spot_api_docs_commit="6b8372cad7cecbdf5dd88a3372eafff51988c5cf",
        spot_api_docs_sha256=("49ea6809243fc7fb426e07f2fe662097736c7bb405bd2da5eef637d715427999"),
    )


def build_proof_payload() -> dict[str, Any]:
    manifest_path = FIXTURE_DIR / "fixture-manifest.v1.json"
    manifest = _read_json(manifest_path)
    context = _context()
    cases: list[dict[str, Any]] = []
    for item_value in cast(list[object], manifest["archives"]):
        if not isinstance(item_value, dict):
            raise AssertionError("fixture manifest archive entry must be an object")
        item = cast(dict[str, Any], item_value)
        receipt = AcquisitionReceiptV1(**cast(dict[str, Any], item["receipt"]))
        expected = cast(dict[str, Any], item["expected"])
        archive = _decode_fixture(receipt.archive_filename)
        checksum = _decode_fixture(f"{receipt.archive_filename}.CHECKSUM")
        result = validate_archive(
            archive_bytes=archive,
            checksum_bytes=checksum,
            receipt=receipt,
            context=context,
        )
        repeated = validate_archive(
            archive_bytes=archive,
            checksum_bytes=checksum,
            receipt=receipt,
            context=context,
        )
        if result != repeated:
            raise AssertionError(f"{receipt.archive_filename}: nondeterministic result")
        boundary_receipt = _read_json_bytes(result.receipt_bytes)
        if result.decision != expected["decision"]:
            raise AssertionError(
                f"{receipt.archive_filename}: {result.decision} != {expected['decision']}"
            )
        for field in (
            "rawRows",
            "logicalRows",
            "admittedCompleteRows",
            "duplicateDroppedRows",
            "terminalQuarantinedRows",
        ):
            if boundary_receipt["counts"][field] != expected[field]:
                raise AssertionError(f"{receipt.archive_filename}: count mismatch for {field}")
        cases.append(
            {
                "archiveFilename": receipt.archive_filename,
                "archiveSha256": receipt.archive_sha256,
                "checksumFileSha256": receipt.checksum_sha256,
                "memberSha256": receipt.member_sha256,
                "decision": result.decision,
                "counts": boundary_receipt["counts"],
                "nativeUnit": boundary_receipt["timestamps"]["nativeUnit"],
                "eventCodes": [
                    event["code"]
                    for event in cast(list[dict[str, Any]], boundary_receipt["exclusions"])
                ],
                "boundaryReceiptSha256": result.receipt_sha256,
                "canonicalOutputSha256": result.canonical_csv_sha256,
                "censoringSha256": result.exclusions_sha256,
                "deterministicRepeatEqual": True,
            }
        )
    aca = next(case for case in cases if case["archiveFilename"].startswith("ACAUSDT"))
    axs = next(case for case in cases if case["archiveFilename"].startswith("AXSUSDT"))
    if aca["eventCodes"] != ["TERMINAL_TRUNCATED_INTERVAL_EXCLUDED"]:
        raise AssertionError("ACA golden exclusion drift")
    if axs["eventCodes"] != ["ADJACENT_IDENTICAL_DUPLICATE_COLLAPSED"]:
        raise AssertionError("AXS golden exclusion drift")
    return {
        "schema": "dq1-focused-proof-v1",
        "canonicalBase": CANONICAL_BASE,
        "proofScope": "OFFLINE_GOLDEN_FIXTURE_VALIDATION_ONLY",
        "context": {
            "policySha256": context.policy_sha256,
            "validatorSha256": context.validator_sha256,
            "runtimeLockSha256": context.runtime_lock_sha256,
            "fixtureManifestSha256": _sha256(manifest_path.read_bytes()),
            "testSha256": _sha256((DQ1_DIR / "test_boundary.py").read_bytes()),
            "publicDataDocsCommit": context.public_data_docs_commit,
            "publicDataDocsSha256": context.public_data_docs_sha256,
            "spotApiDocsCommit": context.spot_api_docs_commit,
            "spotApiDocsSha256": context.spot_api_docs_sha256,
        },
        "cases": cases,
        "assertions": {
            "officialFixtureCount": len(cases),
            "knownBlockerShapes": [
                "ACAUSDT-2026-02-terminal-truncated-interval",
                "AXSUSDT-2026-02-adjacent-byte-identical-duplicate",
            ],
            "cleanCutoverControls": [
                "BTCUSDT-2024-12-31-millisecond",
                "BTCUSDT-2025-01-01-microsecond",
            ],
        },
        "consumerAuthority": "PROSPECTIVE_DIGEST_MATCH_ONLY",
    }


def _read_json_bytes(payload: bytes) -> dict[str, Any]:
    parsed: object = json.loads(payload)
    if not isinstance(parsed, dict):
        raise AssertionError("boundary receipt must contain a JSON object")
    return cast(dict[str, Any], parsed)


def main() -> int:
    payload = build_proof_payload()
    persisted = _read_json(DQ1_DIR / "proof.v1.json")
    if payload != persisted:
        raise AssertionError("proof.v1.json differs from live deterministic verification")
    print(
        json.dumps(
            payload,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
