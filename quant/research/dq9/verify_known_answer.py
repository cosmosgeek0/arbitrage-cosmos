from __future__ import annotations

import json
from pathlib import Path
from typing import cast

from .known_answer import known_answer_projection_v1, known_answer_snapshot_v1
from .validator import validate_lifecycle_json_v1

HERE = Path(__file__).resolve().parent
KNOWN_ANSWER_PATH = HERE / "known_answer.v1.json"


def main() -> int:
    persisted_bytes = KNOWN_ANSWER_PATH.read_bytes()
    parsed = json.loads(persisted_bytes)
    if not isinstance(parsed, dict) or any(not isinstance(key, str) for key in parsed):
        raise SystemExit("DQ9_KNOWN_ANSWER_INVALID")
    expected = cast(dict[str, object], parsed)
    first = known_answer_projection_v1()
    second = known_answer_projection_v1()
    if first != second or first != expected:
        raise SystemExit("DQ9_KNOWN_ANSWER_MISMATCH")
    canonical = (
        json.dumps(
            first,
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
        + b"\n"
    )
    if canonical != persisted_bytes:
        raise SystemExit("DQ9_KNOWN_ANSWER_NOT_CANONICAL")
    receipt = validate_lifecycle_json_v1(known_answer_snapshot_v1().canonical_bytes())
    if receipt.as_dict() != expected:
        raise SystemExit("DQ9_JSON_ROUNDTRIP_MISMATCH")
    print(
        json.dumps(
            {
                "receiptDigest": receipt.receipt_digest,
                "schema": receipt.schema,
                "state": receipt.state.value,
                "status": "PASS",
            },
            separators=(",", ":"),
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
