#!/usr/bin/env python3

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


FINALIZER = load_module(
    "volume_economics_invalid_test_finalizer",
    ROOT / "finalize_volume_economics.py",
)
FAIL_CLOSED = load_module(
    "volume_economics_fail_closed_measurement",
    ROOT / "measure_volume_12m_fail_closed.py",
)


class FinalizeVolumeEconomicsTest(unittest.TestCase):
    def test_current_packet_regenerates_byte_identically(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "terminal-result.v1.json"
            FINALIZER.main(
                [
                    "--policy",
                    str(ROOT / "economics-policy.v1.json"),
                    "--raw-manifest",
                    str(ROOT / "archive-manifest.raw.json"),
                    "--sealed-manifest",
                    str(ROOT / "archive-manifest.v1.json"),
                    "--phase0-events",
                    str(ROOT / "accepted-events.phase0.csv"),
                    "--phase1-events",
                    str(ROOT / "accepted-events.phase1.csv"),
                    "--phase0-result",
                    str(ROOT / "raw-result.phase0.json"),
                    "--phase1-result",
                    str(ROOT / "raw-result.phase1.json"),
                    "--output",
                    str(output),
                ]
            )
            self.assertEqual(
                output.read_bytes(),
                (ROOT / "terminal-result.v1.json").read_bytes(),
            )

    def test_duplicate_only_map_is_invalid(self) -> None:
        symbols = ["BTCUSDT", "NEARUSDT"]
        result = {
            "archiveIdenticalDuplicateRowsBySymbol": {
                "BTCUSDT": 0,
                "NEARUSDT": 1,
            }
        }
        observed = FINALIZER.validate_chronology_map(
            result,
            "archiveIdenticalDuplicateRowsBySymbol",
            symbols,
            Path("phase.json"),
        )
        self.assertEqual(observed["NEARUSDT"], 1)

    def test_chronology_map_rejects_bad_shape_and_counts(self) -> None:
        symbols = ["BTCUSDT"]
        invalid_values = [
            {},
            {"BTCUSDT": True},
            {"BTCUSDT": "1"},
            {"BTCUSDT": -1},
            {"BTCUSDT": 0, "EXTRA": 0},
        ]
        for value in invalid_values:
            with self.subTest(value=value):
                with self.assertRaises(RuntimeError):
                    FINALIZER.validate_chronology_map(
                        {"field": value},
                        "field",
                        symbols,
                        Path("phase.json"),
                    )

    def test_terminal_has_no_decision_bearing_economics(self) -> None:
        packet = json.loads((ROOT / "terminal-result.v1.json").read_text())
        self.assertEqual(packet["testStatus"], "INVALID_TEST")
        self.assertEqual(packet["measurementStatus"], "UNMEASURED")
        self.assertEqual(packet["goNoGo"], "NOT_APPLICABLE")
        self.assertIsNone(packet["sample"])
        self.assertIsNone(packet["phases"])
        self.assertTrue(all(value is None for value in packet["economics"].values()))
        self.assertEqual(packet["verdict"]["archiveConditional"], "UNMEASURED")
        self.assertEqual(packet["verdict"]["repairAuthority"], "NONE")
        self.assertEqual(packet["verdict"]["rerunAuthority"], "NONE")


class FailClosedSourceChronologyTest(unittest.TestCase):
    def test_valid_native_rows_remain_in_original_order(self) -> None:
        open_times = np.array([1_000_000, 2_000_000, 3_000_000], dtype=np.int64)
        last = FAIL_CLOSED.validate_native_open_times(open_times, "valid")
        self.assertEqual(last, 3_000_000)
        rows = {
            "ts": np.array([1, 2, 3], dtype=np.int64),
            "open": np.array([10.0, 11.0, 12.0]),
        }
        validated, gaps, duplicates, out_of_order = FAIL_CLOSED.strict_make_contiguous(rows)
        self.assertIs(validated, rows)
        self.assertEqual((gaps, duplicates, out_of_order), (0, 0, 0))

    def test_adjacent_duplicate_hard_stops(self) -> None:
        with self.assertRaisesRegex(
            RuntimeError,
            r"duplicate_open_times=1:out_of_order_transitions=0",
        ):
            FAIL_CLOSED.validate_native_open_times(
                np.array([1_000_000, 2_000_000, 2_000_000], dtype=np.int64),
                "duplicate",
            )

    def test_non_adjacent_duplicate_hard_stops_without_sorting(self) -> None:
        with self.assertRaisesRegex(
            RuntimeError,
            r"duplicate_open_times=0:out_of_order_transitions=1",
        ):
            FAIL_CLOSED.validate_native_open_times(
                np.array([1_000_000, 3_000_000, 2_000_000], dtype=np.int64),
                "non-adjacent",
            )

    def test_decreasing_timestamp_hard_stops(self) -> None:
        with self.assertRaisesRegex(
            RuntimeError,
            r"out_of_order_transitions=1",
        ):
            FAIL_CLOSED.validate_native_open_times(
                np.array([3_000_000, 2_000_000], dtype=np.int64),
                "decreasing",
            )

    def test_cross_archive_duplicate_hard_stops(self) -> None:
        with self.assertRaisesRegex(RuntimeError, r"duplicate_open_times=1"):
            FAIL_CLOSED.validate_native_open_times(
                np.array([2_000_000, 3_000_000], dtype=np.int64),
                "boundary",
                previous_open_time=2_000_000,
            )

    def test_gap_hard_stops_instead_of_filling(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "SOURCE_GAP_OR_OVERLAP_INVALID"):
            FAIL_CLOSED.strict_make_contiguous({"ts": np.array([1, 3], dtype=np.int64)})

    def test_failed_preflight_never_invokes_measurement(self) -> None:
        called = False

        def reject(_: Path) -> None:
            raise RuntimeError("SOURCE_CHRONOLOGY_INVALID:test")

        def measure() -> None:
            nonlocal called
            called = True

        args = argparse.Namespace(workdir=ROOT, tick_phase=0)
        with self.assertRaisesRegex(RuntimeError, "SOURCE_CHRONOLOGY_INVALID"):
            FAIL_CLOSED.run(args, preflight=reject, measure=measure)
        self.assertFalse(called)


if __name__ == "__main__":
    unittest.main()
