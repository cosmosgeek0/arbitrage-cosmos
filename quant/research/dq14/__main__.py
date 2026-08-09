"""DQ-14 command entry point."""

from __future__ import annotations

import argparse

from research.dq14.verify_known_answer import main as verify_known_answer


def main() -> int:
    parser = argparse.ArgumentParser(
        prog="python -m research.dq14",
        description=(
            "DQ-14 portable source-access replay validator. The importable API "
            "validates caller-supplied immutable artifacts without opening sources."
        ),
    )
    parser.add_argument(
        "--verify-known-answer",
        action="store_true",
        help="verify the checked-in deterministic synthetic known answer",
    )
    arguments = parser.parse_args()
    if arguments.verify_known_answer:
        return verify_known_answer()
    parser.print_help()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
