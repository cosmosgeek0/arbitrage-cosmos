"""Command-line boundary for the DQ-11 validator."""

from __future__ import annotations

import argparse
import sys
from collections.abc import Sequence
from pathlib import Path

from .validator import (
    MAX_INPUT_BYTES,
    ContractError,
    canonical_json_bytes_v1,
    receipt_json_bytes_v1,
    validate_bytes_v1,
)


def _read_bounded_stdin() -> bytes:
    raw = sys.stdin.buffer.read(MAX_INPUT_BYTES + 1)
    if len(raw) > MAX_INPUT_BYTES:
        raise ContractError(
            "INPUT_BOUND_EXCEEDED",
            "$",
            f"stdin exceeds {MAX_INPUT_BYTES} bytes",
        )
    return raw


def _read_bounded_path(path: str) -> bytes:
    with Path(path).open("rb") as handle:
        raw = handle.read(MAX_INPUT_BYTES + 1)
    if len(raw) > MAX_INPUT_BYTES:
        raise ContractError(
            "INPUT_BOUND_EXCEEDED",
            "$",
            f"file exceeds {MAX_INPUT_BYTES} bytes",
        )
    return raw


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Validate one DQ-11 sample/admission denominator packet.",
    )
    parser.add_argument("input", help="JSON packet path, or '-' for stdin")
    args = parser.parse_args(argv)
    try:
        raw = _read_bounded_stdin() if args.input == "-" else _read_bounded_path(args.input)
        receipt = validate_bytes_v1(raw)
    except (ContractError, OSError) as exc:
        if isinstance(exc, ContractError):
            error = exc.to_object()
        else:
            error = {
                "schema": "cosmos.dq11.error.v1",
                "code": "INPUT_IO",
                "path": "$",
                "detail": str(exc),
            }
        sys.stderr.buffer.write(canonical_json_bytes_v1(error) + b"\n")
        return 2
    sys.stdout.buffer.write(receipt_json_bytes_v1(receipt))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
