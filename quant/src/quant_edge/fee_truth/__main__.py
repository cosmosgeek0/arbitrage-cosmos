from __future__ import annotations

import sys
from collections.abc import Sequence
from dataclasses import dataclass
from typing import BinaryIO, Final, TextIO

from .boundary import parse_receipt_bytes
from .contracts import MAX_EXPECTED_SYMBOLS, MAX_RECEIPT_BYTES
from .conversion import canonical_n3_fee_inputs_bytes

_ERROR: Final = "fee-truth: rejected\n"


class _CliRejected(ValueError):
    """Internal non-echo marker for every rejected invocation."""


@dataclass(frozen=True, slots=True)
class _Options:
    evaluated_at_utc: str
    expected_symbols: frozenset[str]


def _parse_options(argv: Sequence[str]) -> _Options:
    evaluated_at_utc: str | None = None
    expected_symbols: set[str] = set()
    index = 0
    while index < len(argv):
        option = argv[index]
        if not isinstance(option, str) or option not in (
            "--evaluation-time-utc",
            "--expected-symbol",
        ):
            raise _CliRejected
        index += 1
        if index >= len(argv):
            raise _CliRejected
        value = argv[index]
        if not isinstance(value, str):
            raise _CliRejected
        if option == "--evaluation-time-utc":
            if evaluated_at_utc is not None:
                raise _CliRejected
            evaluated_at_utc = value
        else:
            if value in expected_symbols or len(expected_symbols) >= MAX_EXPECTED_SYMBOLS:
                raise _CliRejected
            expected_symbols.add(value)
        index += 1
    if evaluated_at_utc is None or not expected_symbols:
        raise _CliRejected
    return _Options(
        evaluated_at_utc=evaluated_at_utc,
        expected_symbols=frozenset(expected_symbols),
    )


def _read_receipt(stdin: BinaryIO) -> bytes:
    raw = stdin.read(MAX_RECEIPT_BYTES + 1)
    if not isinstance(raw, bytes) or not raw or len(raw) > MAX_RECEIPT_BYTES:
        raise _CliRejected
    return raw


def main(
    argv: Sequence[str] | None = None,
    *,
    stdin: BinaryIO | None = None,
    stdout: BinaryIO | None = None,
    stderr: TextIO | None = None,
) -> int:
    """Convert one offline sanitized receipt with no ambient input authority."""

    arguments = tuple(sys.argv[1:] if argv is None else argv)
    input_stream = sys.stdin.buffer if stdin is None else stdin
    output_stream = sys.stdout.buffer if stdout is None else stdout
    error_stream = sys.stderr if stderr is None else stderr
    try:
        options = _parse_options(arguments)
        raw = _read_receipt(input_stream)
        receipt = parse_receipt_bytes(raw, expected_symbols=options.expected_symbols)
        encoded = canonical_n3_fee_inputs_bytes(
            receipt,
            as_of_utc=options.evaluated_at_utc,
        )
    except Exception:
        error_stream.write(_ERROR)
        return 2
    output_stream.write(encoded)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
