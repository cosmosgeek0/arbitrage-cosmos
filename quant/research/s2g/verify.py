#!/usr/bin/env python3
"""Network-free S-2G packet verifier; never opens an archive member."""

from __future__ import annotations

from research.s2g.evaluator import S2GError, verify


def main() -> int:
    try:
        print(verify())
        return 0
    except S2GError as error:
        print(f"S2G_VERIFY FAIL {error}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
