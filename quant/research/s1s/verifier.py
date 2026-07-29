"""Read-only verifier for the sealed S-1S packet."""

from __future__ import annotations

import json

from experiment import EvidenceError, verify_packet


def main() -> int:
    """Authenticate the packet and print the bounded verdict."""

    try:
        result = verify_packet(verify_archives=True)
    except EvidenceError as exc:
        print(json.dumps({"verification": "FAIL", "error": str(exc)}, sort_keys=True))
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
