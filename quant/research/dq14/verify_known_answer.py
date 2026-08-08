"""Verify the checked-in DQ-14 deterministic known answer."""

from __future__ import annotations

import json
from pathlib import Path
from typing import cast

from research.dq14.known_answer import known_answer_projection_v1


def main() -> int:
    expected_path = Path(__file__).with_name("known_answer.v1.json")
    expected_bytes = expected_path.read_text(encoding="utf-8")
    expected = cast(object, json.loads(expected_bytes))
    actual = known_answer_projection_v1()
    rendered = f"{json.dumps(actual, ensure_ascii=False, indent=2, sort_keys=True)}\n"
    if actual != expected or rendered != expected_bytes:
        print("DQ14_KNOWN_ANSWER_MISMATCH")
        return 1
    print("DQ14_KNOWN_ANSWER_PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
