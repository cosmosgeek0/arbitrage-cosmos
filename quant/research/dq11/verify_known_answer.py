"""Verify the byte-frozen DQ-11 known answer without writing artifacts."""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path
from typing import cast

from research.dq11.validator import (
    canonical_json_bytes_v1,
    receipt_json_bytes_v1,
    validate_bytes_v1,
)

HERE = Path(__file__).resolve().parent
FIXTURE = HERE / "fixtures" / "valid-mixed.v1.json"
KNOWN_ANSWER = HERE / "known_answer.v1.json"


def main() -> int:
    fixture_bytes = FIXTURE.read_bytes()
    expected_bytes = KNOWN_ANSWER.read_bytes()
    receipt = validate_bytes_v1(fixture_bytes)
    observed_bytes = receipt_json_bytes_v1(receipt)

    expected_object = cast(object, json.loads(expected_bytes))
    observed_object = cast(object, json.loads(observed_bytes))
    if expected_object != observed_object:
        raise SystemExit("KNOWN_ANSWER_OBJECT_MISMATCH")
    if expected_bytes != observed_bytes:
        raise SystemExit("KNOWN_ANSWER_BYTE_MISMATCH")
    if not expected_bytes.endswith(b"\n") or expected_bytes.endswith(b"\n\n"):
        raise SystemExit("KNOWN_ANSWER_NEWLINE_MISMATCH")

    proof = {
        "schema": "cosmos.dq11.known-answer-verification.v1",
        "status": "PASS",
        "fixtureSha256": hashlib.sha256(fixture_bytes).hexdigest(),
        "knownAnswerSha256": hashlib.sha256(expected_bytes).hexdigest(),
        "flowDigest": receipt.flow_digest,
    }
    sys.stdout.buffer.write(canonical_json_bytes_v1(proof) + b"\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
