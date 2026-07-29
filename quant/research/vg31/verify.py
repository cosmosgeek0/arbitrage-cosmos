#!/usr/bin/env python3
"""Network-free V-G31 packet verifier."""

from __future__ import annotations

import sys

from research.vg31 import evaluator


def main() -> int:
    try:
        print(evaluator.verify())
        return 0
    except evaluator.VG31Error as error:
        print(f"VG31_VERIFY FAIL {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
