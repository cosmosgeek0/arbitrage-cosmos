from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path
from typing import NoReturn, cast

from research.dq12.validator import (
    IdentityDecision,
    canonical_json_bytes,
    registry_canonical_digest_v1,
    validate_spot_usdm_identity_v1,
)

JsonObject = dict[str, object]

HERE = Path(__file__).resolve().parent
RECEIPT_DOMAIN = b"cosmos-dq12-instrument-identity-receipt-v1\0"
TRUSTED_EVALUATION_TIME_MS = 1_785_356_000_000
RECEIPT_DIGEST_FIELDS = frozenset(
    {
        "receiptDigest",
        "registryCanonicalDigest",
        "registrySha256",
        "requestSha256",
        "spotPayloadSha256",
        "usdmPayloadSha256",
    }
)


def _fail(message: str) -> NoReturn:
    raise RuntimeError(message)


def _require(condition: bool, message: str) -> None:
    if not condition:
        _fail(message)


def _object_from_bytes(payload: bytes, *, label: str) -> JsonObject:
    try:
        value: object = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RuntimeError(f"{label} is not valid UTF-8 JSON") from error
    if not isinstance(value, dict):
        _fail(f"{label} is not a JSON object")
    return cast(JsonObject, value)


def _string(value: object, *, label: str) -> str:
    if not isinstance(value, str):
        _fail(f"{label} is not a string")
    return value


def _integer(value: object, *, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        _fail(f"{label} is not a strict integer")
    return value


def _load_committed_fixtures(manifest: JsonObject) -> dict[str, bytes]:
    raw_entries = manifest.get("fixtures")
    if not isinstance(raw_entries, list):
        _fail("fixture manifest has no fixtures array")
    result: dict[str, bytes] = {}
    for index, raw_entry in enumerate(raw_entries):
        if not isinstance(raw_entry, dict):
            _fail(f"fixture entry {index} is not an object")
        entry = cast(JsonObject, raw_entry)
        relative_path = _string(entry.get("path"), label=f"fixtures[{index}].path")
        role = _string(entry.get("role"), label=f"fixtures[{index}].role")
        expected_digest = _string(
            entry.get("sha256"),
            label=f"fixtures[{index}].sha256",
        )
        expected_size = _integer(
            entry.get("bytes"),
            label=f"fixtures[{index}].bytes",
        )
        if role in result:
            _fail(f"duplicate fixture role: {role}")
        payload = (HERE / relative_path).read_bytes()
        _require(len(payload) == expected_size, f"fixture size drift: {relative_path}")
        _require(
            hashlib.sha256(payload).hexdigest() == expected_digest,
            f"fixture digest drift: {relative_path}",
        )
        result[role] = payload
    required = {
        "request",
        "spot-exchange-info",
        "usdm-exchange-info",
        "identity-registry",
    }
    _require(set(result) == required, "fixture role set drift")
    return result


def _verify_receipt_digest(receipt: JsonObject) -> str:
    projection = dict(receipt)
    actual = _string(
        projection.pop("receiptDigest", None),
        label="receipt.receiptDigest",
    )
    expected = hashlib.sha256(RECEIPT_DOMAIN + canonical_json_bytes(projection)).hexdigest()
    _require(actual == expected, "receipt digest is not self-consistent")
    return actual


def main() -> int:
    manifest_bytes = (HERE / "fixture-manifest.v1.json").read_bytes()
    known_answer_bytes = (HERE / "known_answer.v1.json").read_bytes()
    manifest = _object_from_bytes(manifest_bytes, label="fixture manifest")
    known_answer = _object_from_bytes(known_answer_bytes, label="known answer")
    _require(
        manifest.get("schema") == "cosmos.dq12.fixture-manifest.v1",
        "fixture manifest schema drift",
    )
    _require(manifest.get("networkRequired") is False, "proof must be network-free")
    _require(manifest.get("synthetic") is True, "fixture provenance must be explicit")
    _require(
        known_answer.get("schema") == "cosmos.dq12.known-answer.v1",
        "known-answer schema drift",
    )

    fixtures = _load_committed_fixtures(manifest)
    request_value = _object_from_bytes(fixtures["request"], label="request")
    _require(
        "evaluationTimeMs" not in request_value,
        "request bytes must not author the evaluation time",
    )
    receipt = validate_spot_usdm_identity_v1(
        trusted_evaluation_time_ms=TRUSTED_EVALUATION_TIME_MS,
        request_bytes=fixtures["request"],
        spot_snapshot_bytes=fixtures["spot-exchange-info"],
        usdm_snapshot_bytes=fixtures["usdm-exchange-info"],
        registry_bytes=fixtures["identity-registry"],
    )
    _require(
        receipt.decision is IdentityDecision.MATCHED,
        f"known answer did not match: {receipt.reason_codes}",
    )
    receipt_value = receipt.as_dict()

    raw_expected = known_answer.get("expectedReceiptSemantics")
    if not isinstance(raw_expected, dict):
        _fail("known answer has no expectedReceiptSemantics object")
    expected = cast(JsonObject, raw_expected)
    _require(
        "receiptDigest" not in expected,
        "known answer must not hardcode an executed receipt digest",
    )
    _require(
        set(expected) == set(receipt_value) - RECEIPT_DIGEST_FIELDS,
        "known answer does not cover the exact non-digest receipt schema",
    )
    for key, value in expected.items():
        _require(
            receipt_value.get(key) == value,
            f"semantic known-answer mismatch at {key}",
        )

    _require(
        receipt.request_sha256 == hashlib.sha256(fixtures["request"]).hexdigest(),
        "request digest binding mismatch",
    )
    _require(
        receipt.spot_payload_sha256 == hashlib.sha256(fixtures["spot-exchange-info"]).hexdigest(),
        "Spot digest binding mismatch",
    )
    _require(
        receipt.usdm_payload_sha256 == hashlib.sha256(fixtures["usdm-exchange-info"]).hexdigest(),
        "USD-M digest binding mismatch",
    )
    _require(
        receipt.registry_sha256 == hashlib.sha256(fixtures["identity-registry"]).hexdigest(),
        "registry byte digest binding mismatch",
    )
    registry_value = _object_from_bytes(
        fixtures["identity-registry"],
        label="identity registry",
    )
    expected_registry_digest = registry_canonical_digest_v1(registry_value)
    _require(
        receipt.registry_canonical_digest == expected_registry_digest,
        "registry canonical digest mismatch",
    )

    receipt_digest = _verify_receipt_digest(receipt_value)
    repeated = validate_spot_usdm_identity_v1(
        trusted_evaluation_time_ms=TRUSTED_EVALUATION_TIME_MS,
        request_bytes=fixtures["request"],
        spot_snapshot_bytes=fixtures["spot-exchange-info"],
        usdm_snapshot_bytes=fixtures["usdm-exchange-info"],
        registry_bytes=fixtures["identity-registry"],
    )
    _require(
        receipt.canonical_bytes() == repeated.canonical_bytes(),
        "exact-byte replay is not deterministic",
    )

    proof: JsonObject = {
        "authority": "NONE",
        "checks": [
            "fixture-bytes",
            "request-authors-no-evaluation-time",
            "known-answer-schema-coverage",
            "semantic-known-answer",
            "input-digest-bindings",
            "registry-canonical-digest",
            "receipt-digest-self-consistency",
            "exact-byte-replay",
        ],
        "decision": receipt.decision.value,
        "fixtureManifestSha256": hashlib.sha256(manifest_bytes).hexdigest(),
        "knownAnswerSha256": hashlib.sha256(known_answer_bytes).hexdigest(),
        "receiptDigest": receipt_digest,
        "registryCanonicalDigest": expected_registry_digest,
        "schema": "cosmos.dq12.known-answer-proof.v1",
    }
    sys.stdout.buffer.write(canonical_json_bytes(proof))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
