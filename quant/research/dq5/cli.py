from __future__ import annotations

import argparse
import os
import stat
import sys
from collections.abc import Sequence
from pathlib import Path
from typing import BinaryIO

from research.dq5.contracts import Dq5InputError
from research.dq5.validator import ValidationStatus, validate_bytes

from quant_edge.canonical import canonical_json_bytes

MAX_INPUT_BYTES = 2 * 1024 * 1024
ERROR_SCHEMA_VERSION = "DQ5_ERROR_V1"


def _error_bytes(*, code: str, path: str, reason: str) -> bytes:
    return canonical_json_bytes(
        {
            "authority": "NONE",
            "code": code,
            "path": path,
            "reason": reason,
            "schemaVersion": ERROR_SCHEMA_VERSION,
            "status": "INVALID",
        }
    )


def read_bounded_regular_file(path: Path) -> bytes:
    try:
        before = path.lstat()
    except OSError as error:
        raise Dq5InputError("$file", "metadata file is unavailable") from error
    if not stat.S_ISREG(before.st_mode):
        raise Dq5InputError("$file", "metadata path must be a regular non-symlink file")
    if before.st_size > MAX_INPUT_BYTES:
        raise Dq5InputError("$file", f"metadata file exceeds {MAX_INPUT_BYTES} bytes")

    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(path, flags)
    except OSError as error:
        raise Dq5InputError("$file", "metadata file cannot be opened safely") from error
    try:
        after = os.fstat(descriptor)
        if not stat.S_ISREG(after.st_mode):
            raise Dq5InputError("$file", "opened metadata must remain a regular file")
        if (before.st_dev, before.st_ino) != (after.st_dev, after.st_ino):
            raise Dq5InputError("$file", "metadata identity changed during open")
        if after.st_size > MAX_INPUT_BYTES:
            raise Dq5InputError("$file", f"metadata file exceeds {MAX_INPUT_BYTES} bytes")
        chunks: list[bytes] = []
        remaining = MAX_INPUT_BYTES + 1
        while remaining:
            chunk = os.read(descriptor, min(65_536, remaining))
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        raw = b"".join(chunks)
        if len(raw) > MAX_INPUT_BYTES:
            raise Dq5InputError("$file", f"metadata file exceeds {MAX_INPUT_BYTES} bytes")
        return raw
    finally:
        os.close(descriptor)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="dq5",
        description="Validate one research intake against the global DQ-5 metadata registry.",
    )
    parser.add_argument("--registry", required=True, type=Path)
    parser.add_argument("--candidate", required=True, type=Path)
    return parser


def run(argv: Sequence[str], *, stdout: BinaryIO) -> int:
    arguments = _parser().parse_args(list(argv))
    try:
        registry_raw = read_bounded_regular_file(arguments.registry)
    except Dq5InputError as error:
        stdout.write(
            _error_bytes(
                code="DQ5_REGISTRY_INVALID",
                path=error.path,
                reason=error.reason,
            )
        )
        return 2
    try:
        candidate_raw = read_bounded_regular_file(arguments.candidate)
    except Dq5InputError as error:
        stdout.write(
            _error_bytes(
                code="DQ5_CANDIDATE_INVALID",
                path=error.path,
                reason=error.reason,
            )
        )
        return 2
    try:
        report = validate_bytes(registry_raw, candidate_raw)
    except Dq5InputError as error:
        code = (
            "DQ5_REGISTRY_INVALID"
            if error.path.startswith("$registry")
            else "DQ5_CANDIDATE_INVALID"
        )
        stdout.write(_error_bytes(code=code, path=error.path, reason=error.reason))
        return 2
    stdout.write(report.canonical_bytes())
    return 0 if report.status is ValidationStatus.ELIGIBLE_FOR_INTAKE else 1


def main(argv: Sequence[str] | None = None) -> int:
    return run(sys.argv[1:] if argv is None else argv, stdout=sys.stdout.buffer)
