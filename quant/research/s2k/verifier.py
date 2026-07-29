"""Network-free verifier for the committed S-2K terminal packet."""

from __future__ import annotations

import json
import sys

from research.s2k.experiment import EvidenceError, verify_terminal_packet


def main() -> int:
    """Authenticate bindings, holdout state, and authority boundaries."""

    try:
        result = verify_terminal_packet()
    except EvidenceError as error:
        print(f"S2K_VERIFY_FAIL: {error}", file=sys.stderr)
        return 2
    print(
        json.dumps(
            {
                "verification": "PASS",
                "researchVerdict": result["researchVerdict"],
                "capitalVerdict": result["capitalVerdict"],
                "executionAuthority": result["executionAuthority"],
                "holdoutState": result["holdout"]["state"],
                "staticCommit": result["staticCommit"],
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
