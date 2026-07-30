#!/usr/bin/env python3
"""Fail-closed entrypoint for the retained Volume archive measurement.

The predecessor producer is preserved byte-for-byte in ``measure_volume_12m.py``
as invalid-run evidence. This successor validates every native archive
timestamp, in source order, before invoking any detector or economic work. It
also replaces the predecessor's chronology canonicalizer with a strict,
identity-preserving check.
"""

from __future__ import annotations

import argparse
import importlib.util
import sys
import zipfile
from collections.abc import Callable
from pathlib import Path
from types import ModuleType

import numpy as np
import polars as pl

ROOT = Path(__file__).resolve().parent
LEGACY_PATH = ROOT / "measure_volume_12m.py"
MICROSECONDS_PER_SECOND = 1_000_000


def load_legacy_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location(
        "volume_economics_invalid_run_producer",
        LEGACY_PATH,
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("LEGACY_PRODUCER_IMPORT_FAILED")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


LEGACY = load_legacy_module()


def chronology_error(
    source: str,
    *,
    duplicate_open_times: int,
    out_of_order_transitions: int,
) -> RuntimeError:
    return RuntimeError(
        "SOURCE_CHRONOLOGY_INVALID:"
        f"{source}:"
        f"duplicate_open_times={duplicate_open_times}:"
        f"out_of_order_transitions={out_of_order_transitions}"
    )


def validate_native_open_times(
    open_times: np.ndarray,
    source: str,
    *,
    previous_open_time: int | None = None,
) -> int:
    """Require native microsecond kline keys to be unique and strictly ordered."""

    if len(open_times) == 0:
        raise RuntimeError(f"SOURCE_CHRONOLOGY_EMPTY:{source}")
    if open_times.dtype.kind not in {"i", "u"}:
        raise RuntimeError(f"SOURCE_TIMESTAMP_TYPE_INVALID:{source}")

    duplicate_open_times = 0
    out_of_order_transitions = 0
    if previous_open_time is not None:
        first = int(open_times[0])
        duplicate_open_times += int(first == previous_open_time)
        out_of_order_transitions += int(first < previous_open_time)

    differences = np.diff(open_times)
    duplicate_open_times += int(np.count_nonzero(differences == 0))
    out_of_order_transitions += int(np.count_nonzero(differences < 0))
    if duplicate_open_times or out_of_order_transitions:
        raise chronology_error(
            source,
            duplicate_open_times=duplicate_open_times,
            out_of_order_transitions=out_of_order_transitions,
        )

    if np.any(open_times % MICROSECONDS_PER_SECOND != 0):
        raise RuntimeError(f"SOURCE_TIMESTAMP_ALIGNMENT_INVALID:{source}")
    if previous_open_time is not None:
        boundary_step = int(open_times[0]) - previous_open_time
        if boundary_step != MICROSECONDS_PER_SECOND:
            raise RuntimeError(f"SOURCE_GAP_OR_OVERLAP_INVALID:{source}")
    if np.any(differences != MICROSECONDS_PER_SECOND):
        raise RuntimeError(f"SOURCE_GAP_OR_OVERLAP_INVALID:{source}")
    return int(open_times[-1])


def read_native_open_times(path: Path) -> np.ndarray:
    """Parse the native 12-field member without lossy timestamp conversion."""

    with zipfile.ZipFile(path) as archive:
        members = archive.infolist()
        if len(members) != 1 or members[0].is_dir():
            raise RuntimeError(f"SOURCE_MEMBER_INVALID:{path.name}")
        with archive.open(members[0]) as handle:
            frame = pl.read_csv(
                handle,
                has_header=False,
                schema=LEGACY.SCHEMA,
                infer_schema=False,
            )
    if frame.columns != list(LEGACY.COLUMNS):
        raise RuntimeError(f"SOURCE_SCHEMA_INVALID:{path.name}")
    return frame["open_time"].to_numpy().astype(np.int64, copy=False)


def expected_sources(
    symbol: str,
    raw_dir: Path,
    manifest: list[dict[str, object]],
) -> list[Path]:
    sources = [
        LEGACY.ensure_url(LEGACY.daily_url(symbol, "2025-06-29"), raw_dir, manifest),
        LEGACY.ensure_url(LEGACY.daily_url(symbol, "2025-06-30"), raw_dir, manifest),
    ]
    sources.extend(
        LEGACY.ensure_url(LEGACY.monthly_url(symbol, year, month), raw_dir, manifest)
        for year, month in LEGACY.MONTHS
    )
    sources.append(LEGACY.ensure_url(LEGACY.daily_url(symbol, "2026-07-01"), raw_dir, manifest))
    return sources


def preflight_all_sources(root: Path) -> None:
    """Validate the complete corpus before any feature or event measurement."""

    raw_dir = root / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    manifest: list[dict[str, object]] = []
    source_paths = {symbol: expected_sources(symbol, raw_dir, manifest) for symbol in LEGACY.COHORT}

    for symbol in LEGACY.COHORT:
        previous_open_time: int | None = None
        for path in source_paths[symbol]:
            previous_open_time = validate_native_open_times(
                read_native_open_times(path),
                f"{symbol}/{path.name}",
                previous_open_time=previous_open_time,
            )


def strict_make_contiguous(
    rows: dict[str, np.ndarray],
) -> tuple[dict[str, np.ndarray], int, int, int]:
    """Return original rows only when the second-level chronology is exact."""

    timestamps = rows["ts"]
    if len(timestamps) == 0:
        raise RuntimeError("SOURCE_CHRONOLOGY_EMPTY:combined_rows")
    differences = np.diff(timestamps)
    duplicate_open_times = int(np.count_nonzero(differences == 0))
    out_of_order_transitions = int(np.count_nonzero(differences < 0))
    if duplicate_open_times or out_of_order_transitions:
        raise chronology_error(
            "combined_rows",
            duplicate_open_times=duplicate_open_times,
            out_of_order_transitions=out_of_order_transitions,
        )
    if np.any(differences != 1):
        raise RuntimeError("SOURCE_GAP_OR_OVERLAP_INVALID:combined_rows")
    return rows, 0, 0, 0


def run(
    args: argparse.Namespace,
    *,
    preflight: Callable[[Path], None] = preflight_all_sources,
    measure: Callable[[], None] | None = None,
) -> None:
    preflight(args.workdir.resolve())
    LEGACY.make_contiguous = strict_make_contiguous
    # The legacy producer records ``__file__`` in its output bindings. Point it
    # at this active fail-closed entrypoint before any output can be written.
    LEGACY.__file__ = str(Path(__file__).resolve())
    (measure or LEGACY.main)()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workdir", type=Path, required=True)
    parser.add_argument("--tick-phase", type=int, choices=(0, 1), default=0)
    args = parser.parse_args()
    run(args)


if __name__ == "__main__":
    main()
