from __future__ import annotations

from copy import deepcopy
import json
import unittest

import verify


class VerifyTests(unittest.TestCase):
    def test_require(self) -> None:
        verify.require(True, "OK")
        with self.assertRaises(verify.VerificationError):
            verify.require(False, "EXPECTED")

    def test_generated_files_are_not_static_inventory(self) -> None:
        names = {path.name for path in verify.experiment.packet_static_files()}
        self.assertNotIn("result.v1.json", names)
        self.assertNotIn("freeze.v1.json", names)
        self.assertNotIn("terminal_failure.v1.json", names)
        self.assertIn("protocol.v1.json", names)
        self.assertIn("verify.py", names)

    def test_authority_constants(self) -> None:
        protocol = verify.experiment.load_json(verify.experiment.PROTOCOL_PATH)
        self.assertEqual(protocol["consumer"]["capital_authority"], "NONE")
        self.assertEqual(
            protocol["economics"]["account_effective_commission"], "UNKNOWN"
        )
        self.assertEqual(
            protocol["distinctness"]["spot_position"], "FORBIDDEN"
        )

    def test_verdict_is_derived_from_gate_state(self) -> None:
        self.assertEqual(
            verify.derive_verdict(
                False,
                "UNOPENED_CONDITIONAL_DEVELOPMENT_GATE_FAILED",
                None,
            ),
            "NO_GO",
        )
        self.assertEqual(
            verify.derive_verdict(
                True,
                "OPENED_AFTER_DEVELOPMENT_PASS",
                {key: True for key in verify.HOLDOUT_GATE_KEYS},
            ),
            "GO_PUBLIC_PROXY_LOCAL",
        )
        failed = {key: True for key in verify.HOLDOUT_GATE_KEYS}
        failed["stress_lcb"] = False
        self.assertEqual(
            verify.derive_verdict(
                True,
                "OPENED_AFTER_DEVELOPMENT_PASS",
                failed,
            ),
            "NO_GO",
        )
        with self.assertRaises(verify.VerificationError):
            verify.derive_verdict(False, "OPENED_AFTER_DEVELOPMENT_PASS", {})
        with self.assertRaises(verify.VerificationError):
            verify.derive_verdict(
                True, "OPENED_AFTER_DEVELOPMENT_PASS", {}
            )

    def test_candidate_gate_scalars_are_derived_from_audit_ledger(self) -> None:
        experiment = verify.experiment
        start = experiment.DEVELOPMENT_START_MS
        data: dict[str, experiment.SymbolData] = {}
        features: dict[str, dict[int, experiment.Feature]] = {}
        for index, symbol in enumerate(experiment.FIXED_SYMBOLS):
            bars = {
                start + step * experiment.HOUR_MS: experiment.Bar(
                    start + step * experiment.HOUR_MS,
                    100 + step,
                    100 + step,
                    10_000_000,
                )
                for step in range(4)
            }
            data[symbol] = experiment.SymbolData(
                spot=dict(bars),
                contract=bars,
                mark=dict(bars),
                funding=[],
            )
            lead = float(index)
            features[symbol] = {
                start: experiment.Feature(lead, lead, lead, 0.0, 0.0)
            }
        simulation = experiment.simulate(
            data,
            features,
            experiment.FIXED_SYMBOLS,
            start,
            start + experiment.DAY_MS,
            1,
            2,
            "spot_lead",
        )
        audit = json.loads(
            experiment.canonical_json_bytes(
                experiment.simulation_audit_ledger(simulation)
            )
        )
        summary = experiment.simulation_summary(simulation)
        ledger = {
            "candidate": simulation.daily_by_scenario,
            "comparator": simulation.daily_by_scenario,
            "dates": simulation.daily_dates,
        }
        verify.verify_candidate_audit(
            audit,
            ledger,
            summary,
            "h1_k2",
            start,
            start + experiment.DAY_MS,
        )
        mutated = deepcopy(summary)
        mutated["active_utc_days"] = 120
        with self.assertRaises(verify.VerificationError):
            verify.verify_candidate_audit(
                audit,
                ledger,
                mutated,
                "h1_k2",
                start,
                start + experiment.DAY_MS,
            )
        boundary = deepcopy(audit)
        boundary["formations"][0][0] = (
            start + experiment.DAY_MS - experiment.HOUR_MS
        )
        with self.assertRaises(verify.VerificationError):
            verify.verify_candidate_audit(
                boundary,
                ledger,
                summary,
                "h1_k2",
                start,
                start + experiment.DAY_MS,
            )
        out_of_partition = deepcopy(audit)
        out_of_partition["hourly_pnl"]["base"][0][0] = start - 1
        with self.assertRaises(verify.VerificationError):
            verify.verify_candidate_audit(
                out_of_partition,
                ledger,
                summary,
                "h1_k2",
                start,
                start + experiment.DAY_MS,
            )

    def test_pbo_is_recomputed_from_daily_evidence(self) -> None:
        dates = [
            "2025-07-01",
            "2025-08-01",
            "2025-09-01",
            "2025-10-01",
            "2025-11-01",
            "2025-12-01",
            "2026-01-01",
            "2026-02-01",
        ]
        daily = {
            "a": {
                "candidate": {"stress": [2.0] * 8},
                "dates": dates,
            },
            "b": {
                "candidate": {"stress": [1.0] * 8},
                "dates": dates,
            },
        }
        result = verify.recompute_pbo(daily, ["a", "b"])
        self.assertEqual(result["combinations"], 70)
        self.assertEqual(result["selection_counts"], {"a": 70, "b": 0})
        self.assertEqual(result["pbo"], 0.0)

    def test_preserved_development_custody_binds_run_and_partitions(
        self,
    ) -> None:
        manifest = {
            "artifacts": [
                {"key": "a", "lifecycle_partition": "WARMUP"},
                {"key": "b", "lifecycle_partition": "DEVELOPMENT"},
                {"key": "c", "lifecycle_partition": "EMBARGO_HOLDOUT"},
            ]
        }
        identity = {"commit": "1" * 40, "tree": "2" * 40}
        development = {
            "archive_member_keys_opened": ["a", "b"],
            "archive_members_opened": 2,
            "git": identity,
        }
        result = {"git": identity}
        verify.verify_development_custody(
            development, result, manifest
        )
        wrong_run = deepcopy(result)
        wrong_run["git"] = {"commit": "3" * 40, "tree": "4" * 40}
        with self.assertRaises(verify.VerificationError):
            verify.verify_development_custody(
                development, wrong_run, manifest
            )
        early_holdout = deepcopy(development)
        early_holdout["archive_member_keys_opened"].append("c")
        early_holdout["archive_members_opened"] = 3
        with self.assertRaises(verify.VerificationError):
            verify.verify_development_custody(
                early_holdout, result, manifest
            )

    def test_bootstrap_interval_shape_is_exact(self) -> None:
        packet = {
            "absolute_stress_90pct_interval_usd": [-1.0, 2.0],
            "matched_excess_90pct_interval_usd": [-2.0, 1.0],
            "replicates": 8192,
        }
        verify.verify_bootstrap_packet_schema(packet)
        malformed = deepcopy(packet)
        malformed["absolute_stress_90pct_interval_usd"].append(999.0)
        with self.assertRaises(verify.VerificationError):
            verify.verify_bootstrap_packet_schema(malformed)
        extra = deepcopy(packet)
        extra["reported_but_unverified"] = True
        with self.assertRaises(verify.VerificationError):
            verify.verify_bootstrap_packet_schema(extra)


if __name__ == "__main__":
    unittest.main()
