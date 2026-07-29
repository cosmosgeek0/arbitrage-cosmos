#!/usr/bin/env python3
"""Data-free V-G37 packet verifier."""

from __future__ import annotations

import json

from research.vg37.experiment import verify_packet


def main() -> int:
    """Verify the packet and print one compact JSON receipt."""

    print(json.dumps(verify_packet(), sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
