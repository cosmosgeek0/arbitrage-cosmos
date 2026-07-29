#!/usr/bin/env python3
"""Focused deterministic and hostile-custody tests for N3-S3."""

# ruff: noqa: PT009, PT027

from __future__ import annotations

import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import registry_tool_v3 as tool  # noqa: E402


class N3S3RegistryTests(unittest.TestCase):
    repo: Path
    run_path: Path
    spec_path: Path
    registry_path: Path
    card_path: Path
    spec: dict[str, Any]
    run_raw: bytes
    registry: dict[str, Any]

    @classmethod
    def setUpClass(cls) -> None:
        cls.repo = HERE.parents[2]
        cls.run_path = Path("/Users/cosmosgeek/Desktop/run.md")
        cls.spec_path = HERE / "origin_spec.v3.json"
        cls.registry_path = HERE / "current_profitability_registry.v3.json"
        cls.card_path = HERE / "owner_verdict_card.v3.md"
        cls.spec = tool.load_json(cls.spec_path)
        cls.run_raw = cls.run_path.read_bytes()
        cls.registry = tool.freeze_registry(cls.spec, cls.run_raw, cls.repo)

    def assert_contract_error(self, callable_object: Any, *args: Any) -> None:
        with self.assertRaises(tool.ContractError):
            callable_object(*args)

    def test_01_freeze_matches_frozen_registry(self) -> None:
        self.assertEqual(
            tool._canonical_bytes(self.registry),
            self.registry_path.read_bytes(),
        )

    def test_02_verify_full_frozen_files(self) -> None:
        tool._verify_files(
            self.registry_path,
            self.card_path,
            self.spec,
            self.run_raw,
            self.repo,
        )

    def test_03_two_freezes_are_byte_deterministic(self) -> None:
        second = tool.freeze_registry(self.spec, self.run_raw, self.repo)
        self.assertEqual(tool._canonical_bytes(self.registry), tool._canonical_bytes(second))
        self.assertEqual(
            tool.render_owner_card(self.registry),
            tool.render_owner_card(second),
        )

    def test_04_zero_positive_unknown_and_null_are_preserved(self) -> None:
        summary = self.registry["summary"]
        self.assertEqual(summary["acceptedCrediblePositiveCount"], 0)
        self.assertIsNone(summary["crediblePositiveCount"])
        self.assertEqual(summary["currentProfitabilityVerdict"], "UNKNOWN")
        self.assertEqual(summary["positiveEdgeClaim"], "NOT_MADE")
        self.assertEqual(summary["capitalAuthority"], "NONE")

    def test_05_expected_counts_and_verdicts_are_exact(self) -> None:
        summary = self.registry["summary"]
        self.assertEqual(summary["acceptedOriginCount"], 49)
        self.assertEqual(summary["acceptedFamilyCount"], 48)
        self.assertEqual(summary["localVerdictCounts"], {"NO_GO": 24, "UNMEASURED": 25})
        self.assertEqual(summary["postVG31AcceptedEconomicConsumedCount"], 13)
        self.assertEqual(summary["acceptedSinceN3S2EconomicConsumedCount"], 1)

    def test_06_vg10_is_unmeasured_and_effective_p_one(self) -> None:
        origin = self.registry["origins"][-1]
        family = self.registry["families"][-1]
        self.assertEqual(origin["originId"], "V-G10")
        self.assertEqual(origin["normalizedVerdict"], "UNMEASURED")
        self.assertFalse(origin["verifiedPositive"])
        self.assertEqual(family["originIds"], ["V-G10"])
        self.assertEqual(
            family["effectiveProgramWideP"],
            {"denominator": 1, "numerator": 1},
        )

    def test_07_validators_are_source_only_not_economic(self) -> None:
        pins = self.registry["sourceOnlyPins"][-5:]
        self.assertEqual(
            [pin["bindingId"] for pin in pins],
            ["DQ-7", "DQ-5", "DQ-12", "DQ-13", "DQ-10"],
        )
        self.assertTrue(all(pin["economicContribution"] == "NONE" for pin in pins))
        self.assertEqual(
            [pin["consumerScope"] for pin in pins],
            [
                "SCHEDULER_AND_N3_INTAKE_FINAL_CONVERGENCE",
                "N3_AND_FUTURE_RESEARCH_INTAKE",
                "N3_SUCCESSOR_AND_FINAL_CONVERGENCE",
                "FUTURE_S1_VG_AND_N3_FINAL_CONVERGENCE",
                "N3_SUCCESSOR_AND_FINAL_CONVERGENCE",
            ],
        )
        economic_receipts = [
            receipt["recordId"]
            for receipt in self.registry["ledgerReceipts"]
            if receipt["economicOriginConsumed"]
        ]
        self.assertEqual(economic_receipts, [tool.ECONOMIC_THROUGH_RECORD_ID])

    def test_08_sparse_receipt_allowlist_and_order_are_exact(self) -> None:
        self.assertEqual(
            tuple(row["recordId"] for row in self.registry["ledgerReceipts"]),
            tool.SELECTED_RECORD_IDS,
        )
        self.assertEqual(self.registry["summary"]["selectedReceiptCount"], 6)

    def test_09_only_s1t_is_opaque_active_pending(self) -> None:
        pending = self.registry["pendingInputs"]
        self.assertEqual(pending["activeOutsideBaselineCutoff"], [])
        self.assertEqual(pending["terminalPending"], [])
        self.assertEqual(len(pending["activeWithinBaselineCutoff"]), 1)
        active = pending["activeWithinBaselineCutoff"][0]
        self.assertEqual(active["milestoneId"], "S-1T")
        self.assertEqual(active["taskRefSuffix"], "fea0")
        self.assertFalse(active["outcomeBytesInspected"])
        self.assertFalse(active["taskRefIsEvidence"])

    def test_10_card_is_one_fable5_row_and_redacted(self) -> None:
        card = tool.render_owner_card(self.registry)
        self.assertEqual(card.count("\n"), 1)
        self.assertTrue(card.startswith("- item=`"))
        self.assertIn(" | expected=`", card)
        self.assertIn(" | found=`", card)
        self.assertIn(" | status=`", card)
        self.assertIsNone(tool.FULL_IDENTIFIER.search(card))
        self.assertNotIn("/Users/", card)
        self.assertLessEqual(len(card.encode("utf-8")), 1600)

    def test_11_unknown_cannot_be_rewritten_as_no_go(self) -> None:
        mutated = copy.deepcopy(self.registry)
        mutated["summary"]["currentProfitabilityVerdict"] = "NO_GO"
        self.assert_contract_error(tool.validate_registry, mutated)

    def test_12_null_credible_count_cannot_be_rewritten_as_zero(self) -> None:
        mutated = copy.deepcopy(self.registry)
        mutated["summary"]["crediblePositiveCount"] = 0
        self.assert_contract_error(tool.validate_registry, mutated)

    def test_13_positive_claim_injection_is_rejected(self) -> None:
        mutated = copy.deepcopy(self.registry)
        mutated["origins"][-1]["verifiedPositive"] = True
        self.assert_contract_error(tool.validate_registry, mutated)

    def test_14_effective_p_below_one_is_rejected(self) -> None:
        mutated = copy.deepcopy(self.registry)
        mutated["families"][-1]["effectiveProgramWideP"]["numerator"] = 0
        self.assert_contract_error(tool.validate_registry, mutated)

    def test_15_validator_economic_promotion_is_rejected(self) -> None:
        mutated = copy.deepcopy(self.registry)
        mutated["sourceOnlyPins"][-1]["economicContribution"] = "POSITIVE"
        self.assert_contract_error(tool.validate_registry, mutated)

    def test_16_s1t_outcome_inspection_claim_is_rejected(self) -> None:
        mutated = copy.deepcopy(self.registry)
        active = mutated["pendingInputs"]["activeWithinBaselineCutoff"][0]
        active["outcomeBytesInspected"] = True
        self.assert_contract_error(tool.validate_registry, mutated)

    def test_16b_source_consumer_scope_widening_is_rejected(self) -> None:
        mutated = copy.deepcopy(self.registry)
        mutated["sourceOnlyPins"][-1]["consumerScope"] = "ANY_CONSUMER"
        self.assert_contract_error(tool.validate_registry, mutated)

    def test_17_baseline_origin_prefix_mutation_is_rejected(self) -> None:
        mutated = copy.deepcopy(self.registry)
        mutated["origins"][0]["verifiedPositive"] = True
        self.assert_contract_error(tool.validate_registry, mutated)

    def test_18_baseline_source_pin_prefix_mutation_is_rejected(self) -> None:
        mutated = copy.deepcopy(self.registry)
        mutated["sourceOnlyPins"][0]["status"] = "MUTATED"
        self.assert_contract_error(tool.validate_registry, mutated)

    def test_19_spec_extra_key_is_rejected(self) -> None:
        mutated = copy.deepcopy(self.spec)
        mutated["unexpected"] = None
        self.assert_contract_error(tool._validate_spec, mutated)

    def test_20_spec_source_hash_mutation_is_rejected(self) -> None:
        mutated = copy.deepcopy(self.spec)
        mutated["sourceOnlyPins"][0]["rawSha256"] = "0" * 64
        self.assert_contract_error(tool._validate_spec, mutated)

    def test_21_spec_validator_promotion_is_rejected(self) -> None:
        mutated = copy.deepcopy(self.spec)
        mutated["ledgerRows"][0]["economicOriginConsumed"] = True
        self.assert_contract_error(tool._validate_spec, mutated)

    def test_22_duplicate_selected_run_row_is_rejected(self) -> None:
        row = next(
            line
            for line in self.run_raw.splitlines(keepends=True)
            if line.startswith(b"- item=`2026-07-30 ORCHESTRATOR DQ-7 ACCEPTANCE`")
        )
        self.assert_contract_error(
            tool.verify_run_receipts,
            self.registry,
            self.run_raw + row,
        )

    def test_23_mutated_selected_run_row_is_rejected(self) -> None:
        marker = b"- item=`2026-07-30 ORCHESTRATOR DQ-5 ACCEPTANCE`"
        lines = self.run_raw.splitlines(keepends=True)
        index = next(i for i, line in enumerate(lines) if line.startswith(marker))
        lines[index] = lines[index].replace(b" | status=", b"  | status=", 1)
        self.assert_contract_error(
            tool.verify_run_receipts,
            self.registry,
            b"".join(lines),
        )

    def test_24_selected_run_row_reordering_is_rejected(self) -> None:
        lines = self.run_raw.splitlines(keepends=True)
        positions = {
            record_id: next(
                i
                for i, line in enumerate(lines)
                if line.startswith(f"- item=`{record_id}`".encode())
            )
            for record_id in tool.SELECTED_RECORD_IDS[:2]
        }
        left = positions[tool.SELECTED_RECORD_IDS[0]]
        right = positions[tool.SELECTED_RECORD_IDS[1]]
        lines[left], lines[right] = lines[right], lines[left]
        self.assert_contract_error(
            tool.verify_run_receipts,
            self.registry,
            b"".join(lines),
        )

    def test_25_duplicate_json_key_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "duplicate.json"
            path.write_text('{"schema":"x","schema":"y"}\n', encoding="utf-8")
            self.assert_contract_error(tool.load_json, path)

    def test_26_noncanonical_registry_bytes_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            registry_path = root / "registry.json"
            card_path = root / "card.md"
            registry_path.write_text(
                json.dumps(self.registry, indent=2) + "\n",
                encoding="utf-8",
            )
            card_path.write_text(tool.render_owner_card(self.registry), encoding="utf-8")
            self.assert_contract_error(
                tool._verify_files,
                registry_path,
                card_path,
                self.spec,
                self.run_raw,
                self.repo,
            )


if __name__ == "__main__":
    unittest.main()
