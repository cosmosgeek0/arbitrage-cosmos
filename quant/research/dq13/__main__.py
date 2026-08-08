from __future__ import annotations

import sys

from research.dq13 import ValidationStatus, validate_causal_asof_json_v1

_MAX_STDIN_BYTES = 2_097_152


def main() -> int:
    data = sys.stdin.buffer.read(_MAX_STDIN_BYTES + 1)
    receipt = validate_causal_asof_json_v1(data)
    sys.stdout.buffer.write(receipt.canonical_bytes())
    if receipt.status is ValidationStatus.VALID:
        return 0
    if receipt.status is ValidationStatus.UNKNOWN:
        return 2
    return 3


if __name__ == "__main__":
    raise SystemExit(main())
