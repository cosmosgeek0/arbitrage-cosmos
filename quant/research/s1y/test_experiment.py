#!/usr/bin/env python3
"""Network-free unit tests for the frozen S-1Y evaluator."""

from __future__ import annotations

import json
import math
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import experiment as s1y


class ProtocolTests(unittest.TestCase):
    def test_trial_family_and_primary_are_exact(self) -> None:
        trials = s1y.trial_family()
        self.assertEqual(len(trials), 12)
        self.assertEqual(len({trial.trial_id for trial in trials}), 12)
        self.assertEqual(s1y.primary_trial().trial_id, "lb1440_entry2p0_hold168")

    def test_code_constants_match_protocol(self) -> None:
        protocol = json.loads(
            (Path(__file__).parent / "protocol.v1.json").read_text()
        )
        self.assertEqual(
            protocol["base_commit"],
            "a169b123fb186d1943a75ad648552c4d95be1be1",
        )
        self.assertEqual(
            tuple(tuple(pair) for pair in protocol["pairs"]),
            s1y.PAIRS,
        )
        self.assertEqual(protocol["trial_family"]["trial_count"], 12)
        self.assertEqual(
            protocol["trial_family"]["primary_trial_id"],
            s1y.primary_trial().trial_id,
        )

    def test_checksum_sidecar_is_filename_bound(self) -> None:
        digest = "a" * 64
        self.assertEqual(
            s1y.parse_checksum_sidecar(
                f"{digest}  BTCUSDT-1h-2025-05.zip\n".encode(),
                "BTCUSDT-1h-2025-05.zip",
            ),
            digest,
        )
        with self.assertRaises(s1y.CustodyError):
            s1y.parse_checksum_sidecar(
                f"{digest}  other.zip\n".encode(),
                "BTCUSDT-1h-2025-05.zip",
            )

    def test_create_once_refuses_replacement(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "receipt.json"
            s1y.create_once(path, {"value": 1})
            with self.assertRaises(s1y.SealError):
                s1y.create_once(path, {"value": 2})
            self.assertEqual(json.loads(path.read_text()), {"value": 1})
            stale = Path(directory) / ".recovered.json.1.stale.tmp"
            stale.write_text("partial")
            recovered = Path(directory) / "recovered.json"
            s1y.create_once(recovered, {"status": "complete"})
            self.assertEqual(
                json.loads(recovered.read_text()),
                {"status": "complete"},
            )

    def test_archive_member_must_match_zip_stem(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            wrong = Path(directory) / "expected.zip"
            with zipfile.ZipFile(wrong, "w") as archive:
                archive.writestr("wrong.csv", "x\n")
            with self.assertRaises(s1y.CustodyError):
                s1y.archive_member_bytes(wrong)

    def test_funding_cadence_allows_ms_jitter_but_rejects_missing_row(
        self,
    ) -> None:
        rows = (
            s1y.Funding(0 + 11, 8, 0.001),
            s1y.Funding(8 * s1y.HOUR_MS + 8, 8, 0.001),
            s1y.Funding(16 * s1y.HOUR_MS + 15, 8, 0.001),
        )
        s1y.validate_funding_cadence(
            rows, "TESTUSDT", 0, 24 * s1y.HOUR_MS
        )
        with self.assertRaises(s1y.CustodyError):
            s1y.validate_funding_cadence(
                (rows[0], rows[2]),
                "TESTUSDT",
                0,
                24 * s1y.HOUR_MS,
            )

    def test_consumed_failure_seal_resumes_without_outcome_replay(
        self,
    ) -> None:
        original_packet = s1y.PACKET_DIR
        try:
            with tempfile.TemporaryDirectory() as directory:
                packet = Path(directory)
                s1y.PACKET_DIR = packet
                s1y.create_once(
                    packet / "freeze.v1.json",
                    {"schema": "freeze"},
                )
                s1y.create_once(
                    packet / "RUN_CONSUMED.v1.json",
                    {"schema": "run"},
                )
                result = s1y.seal_consumed_failure(
                    s1y.CustodyError("synthetic custody failure")
                )
                self.assertEqual(result["verdict"], "UNMEASURED")
                self.assertTrue(
                    (packet / "terminal_failure.v1.json").is_file()
                )
                receipt = packet / "FINAL_RECEIPT.v1.json"
                self.assertTrue(receipt.is_file())
                receipt.unlink()
                resumed = s1y.seal_consumed_failure(
                    s1y.SealError("interrupted final receipt")
                )
                self.assertEqual(resumed, result)
                self.assertTrue(receipt.is_file())
                pinned = json.loads(receipt.read_text())
                self.assertEqual(
                    pinned["result_sha256"],
                    s1y.sha256_path(packet / "result.v1.json"),
                )
        finally:
            s1y.PACKET_DIR = original_packet


class MathematicsTests(unittest.TestCase):
    def test_ols_uses_prior_window_and_scores_current_residual(self) -> None:
        x = [1.0 + index / 100.0 for index in range(240)]
        residual = [
            0.02 * math.sin(index * 0.9)
            for index in range(240)
        ]
        y = [
            0.5 + 1.8 * x_value + error
            for x_value, error in zip(x, residual)
        ]
        model = s1y.fit_pair_model(x, y)
        self.assertIsNotNone(model)
        assert model is not None
        baseline = s1y.score_pair_model(0, model, 3.5, 6.85)
        changed_current = s1y.score_pair_model(0, model, 3.5, 100.0)
        self.assertGreater(model.beta, 1.7)
        self.assertAlmostEqual(baseline.beta, changed_current.beta)
        self.assertGreater(changed_current.zscore, baseline.zscore)
        self.assertLess(model.residual_df_t, 0.0)

    def test_holm_adjustment_is_monotone_in_sorted_order(self) -> None:
        adjusted = s1y.holm_adjust({"a": 0.001, "b": 0.02, "c": 0.2})
        self.assertAlmostEqual(adjusted["a"], 0.003)
        self.assertAlmostEqual(adjusted["b"], 0.04)
        self.assertAlmostEqual(adjusted["c"], 0.2)

    def test_bootstrap_is_seeded_and_interval_is_finite(self) -> None:
        first = s1y.bootstrap_indices(12, replicates=32, seed=7)
        second = s1y.bootstrap_indices(12, replicates=32, seed=7)
        self.assertEqual(first, second)
        interval = s1y.bootstrap_interval(
            [float(index) for index in range(12)], first
        )
        self.assertTrue(all(math.isfinite(value) for value in interval))
        self.assertLessEqual(interval[0], interval[1])

    def test_pbo_is_bounded(self) -> None:
        vectors = [
            [float((trial + day) % 5 - 2) for day in range(80)]
            for trial in range(12)
        ]
        value = s1y.pbo_probability(vectors)
        self.assertGreaterEqual(value, 0.0)
        self.assertLessEqual(value, 1.0)

    def test_trade_books_two_leg_cost_and_strictly_interior_funding(self) -> None:
        entry = 2 * s1y.DAY_MS
        exit_time = entry + 2 * s1y.HOUR_MS
        signal_time = entry - s1y.HOUR_MS
        pair = s1y.PAIRS[0]
        contract = {
            pair[0]: {
                entry: s1y.Bar(entry, 100.0, 100.0, 1_000_000.0),
                entry + s1y.HOUR_MS: s1y.Bar(
                    entry + s1y.HOUR_MS, 95.0, 95.0, 1_000_000.0
                ),
                exit_time: s1y.Bar(
                    exit_time, 90.0, 90.0, 1_000_000.0
                ),
            },
            pair[1]: {
                entry: s1y.Bar(entry, 50.0, 50.0, 1_000_000.0),
                entry + s1y.HOUR_MS: s1y.Bar(
                    entry + s1y.HOUR_MS, 52.0, 52.0, 1_000_000.0
                ),
                exit_time: s1y.Bar(
                    exit_time, 55.0, 55.0, 1_000_000.0
                ),
            },
        }
        mark = {
            pair[0]: {
                entry + s1y.HOUR_MS: s1y.Bar(
                    entry + s1y.HOUR_MS, 95.0, 95.0, 0.0
                )
            },
            pair[1]: {
                entry + s1y.HOUR_MS: s1y.Bar(
                    entry + s1y.HOUR_MS, 52.0, 52.0, 0.0
                )
            },
        }
        market = s1y.Market(
            contract=contract,
            mark=mark,
            funding={
                pair[0]: (
                    s1y.Funding(entry, 8, 0.01),
                    s1y.Funding(entry + s1y.HOUR_MS + 11, 8, 0.01),
                    s1y.Funding(exit_time, 8, 0.01),
                ),
                pair[1]: (
                    s1y.Funding(entry + s1y.HOUR_MS + 8, 8, 0.01),
                ),
            },
            daily_quote={
                pair[0]: {entry - s1y.DAY_MS: 1_000_000.0},
                pair[1]: {entry - s1y.DAY_MS: 1_000_000.0},
            },
            start_ms=entry,
            end_ms=exit_time + s1y.HOUR_MS,
        )
        position = s1y.OpenPosition(
            pair_index=0,
            pair=pair,
            entry_signal_ms=signal_time,
            entry_ms=entry,
            model_time_ms=signal_time - signal_time % s1y.DAY_MS,
            alpha=0.0,
            beta=1.0,
            sigma=1.0,
            r_squared=0.9,
            ar1_phi=0.9,
            half_life_hours=7.0,
            residual_df_t=-4.0,
            entry_z=2.5,
            side_a=-1,
            side_b=1,
            weight_a=0.5,
            weight_b=0.5,
        )
        trade = s1y.close_trade(
            market, position, exit_time, 0.2, "NORMALIZED"
        )
        self.assertEqual(trade.direction, "SHORT_A_LONG_B")
        self.assertGreater(trade.price_pnl_usd, 0.0)
        self.assertGreater(trade.base_cost_usd, 0.0)
        self.assertNotEqual(trade.funding_pnl_usd, 0.0)
        self.assertGreater(
            trade.base_net_usd,
            trade.stress_net_usd,
        )
        hourly = s1y.hourly_equity_increments(
            market,
            (trade,),
            entry - s1y.HOUR_MS,
            exit_time + s1y.HOUR_MS,
            "stress",
        )
        self.assertAlmostEqual(sum(hourly), trade.stress_net_usd, places=7)
        self.assertGreaterEqual(s1y.maximum_drawdown(hourly), 0.0)


if __name__ == "__main__":
    unittest.main()
