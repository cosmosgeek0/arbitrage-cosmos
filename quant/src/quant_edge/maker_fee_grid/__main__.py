"""Verify the maker-fee grid evidence package."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from quant_edge.maker_fee_grid.verify import verify_package


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("package_dir", type=Path)
    args = parser.parse_args()
    report = verify_package(args.package_dir)
    print(json.dumps(report, sort_keys=True, separators=(",", ":")))
    return 0 if report["evidenceStatus"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
