#!/usr/bin/env python3
"""Focused deterministic and hostile-custody tests for N3-S4."""

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

import registry_tool_v4 as tool  # noqa: E402


class N3S4RegistryTests(unittest.TestCase):
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
        cls.spec_path = HERE / "origin_spec.v4.json"
        cls.registry_path = HERE / "current_profitability_registry.v4.json"
        cls.card_path = HERE / "owner_verdict_card.v4.md"
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
        self.assertEqual(tool.render_owner_card(self.registry), tool.render_owner_card(second))

    def test_04_exact_final_counts(self) -> None:
        summary = self.registry["summary"]
        self.assertEqual(summary["acceptedOriginCount"], 50)
        self.assertEqual(summary["acceptedFamilyCount"], 49)
        self.assertEqual(summary["localVerdictCounts"], {"NO_GO": 24, "UNMEASURED": 26})
        self.assertEqual(summary["postVG31AcceptedEconomicConsumedCount"], 14)
        self.assertEqual(summary["acceptedSinceN3S3EconomicConsumedCount"], 1)
        self.assertEqual(summary["selectedReceiptCount"], 6)

    def test_05_unknown_null_and_zero_positive_preserved(self) -> None:
        summary = self.registry["summary"]
        self.assertEqual(summary["acceptedCrediblePositiveCount"], 0)
        self.assertEqual(summary["verifiedPositiveCount"], 0)
        self.assertIsNone(summary["crediblePositiveCount"])
        self.assertEqual(summary["currentProfitabilityVerdict"], "UNKNOWN")
        self.assertEqual(summary["owner1000FundingVerdict"], "NO")
        self.assertEqual(summary["capitalAuthority"], "NONE")
        self.assertEqual(summary["recommendation"], "NONE")

    def test_06_s1t_is_unmeasured_p_one(self) -> None:
        origin = self.registry["origins"][-1]
        family = self.registry["families"][-1]
        self.assertEqual(origin["originId"], "S-1T")
        self.assertEqual(origin["normalizedVerdict"], "UNMEASURED")
        self.assertEqual(origin["sourceVerdict"], "UNMEASURED_RUN_CONSUMED_NO_RERUN")
        self.assertFalse(origin["verifiedPositive"])
        self.assertEqual(family["originIds"], ["S-1T"])
        self.assertEqual(
            family["effectiveProgramWideP"],
            {"denominator": 1, "numerator": 1},
        )

    def test_07_s1t_null_and_unknown_fields_preserved(self) -> None:
        semantics = self.registry["origins"][-1]["sourceSemantics"]
        self.assertIsNone(semantics["holmPValues"])
        self.assertIsNone(semantics["whiteRealityCheckPByScenario"])
        self.assertIsNone(semantics["pbo"])
        self.assertIsNone(semantics["reportedTrialId"])
        self.assertTrue(
            all(value is None for value in semantics["netUsdPer1000ByScenario"].values())
        )
        self.assertEqual(semantics["accountEffectiveFees"], "UNKNOWN")
        self.assertEqual(semantics["executableCapacity"], "UNKNOWN")
        self.assertEqual(semantics["holdoutState"], "UNOPENED")
        self.assertEqual(semantics["failureCode"], "FUNDING_SURVEILLANCE_GAP_INVALID")

    def test_08_dq1_is_retained_once_not_duplicated(self) -> None:
        pins = [pin for pin in self.registry["sourceOnlyPins"] if pin["bindingId"] == "DQ-1"]
        self.assertEqual(len(pins), 1)
        self.assertEqual(len(self.registry["sourceOnlyPins"]), 13)
        self.assertEqual(self.registry["retainedSourceBindings"][0]["sourcePinOrdinal"], 1)
        self.assertEqual(
            self.registry["retainedSourceBindings"][0]["durabilityRowSha256"],
            tool.DQ1_ROW_SHA256,
        )

    def test_09_state_only_stops_are_not_economic(self) -> None:
        stops = self.registry["stateOnlyStops"]
        self.assertEqual(
            [stop["milestoneId"] for stop in stops],
            ["LIQ-CUSTODY1", "BORROW-CUSTODY1"],
        )
        for stop in stops:
            self.assertEqual(stop["economicOriginContribution"], "NONE")
            self.assertEqual(stop["familyContribution"], "NONE")
            self.assertEqual(stop["trialContribution"], "NONE")
            self.assertFalse(stop["productBytesCreated"])
            self.assertFalse(stop["taskRefIsEvidence"])
            self.assertEqual(stop["normalizedState"], "UNMEASURED")
            self.assertEqual(stop["capitalVerdict"], "NO_GO")
            self.assertEqual(stop["authority"], "NONE")
            self.assertEqual(
                stop["conservativeAttemptP"],
                {"denominator": 1, "numerator": 1},
            )

    def test_10_selected_receipts_are_exact_and_sparse(self) -> None:
        receipts = self.registry["ledgerReceipts"]
        self.assertEqual(
            [receipt["recordId"] for receipt in receipts],
            list(tool.SELECTED_RECORD_IDS),
        )
        self.assertEqual(
            [receipt["economicOriginConsumed"] for receipt in receipts],
            [False, False, False, True, False, False],
        )

    def test_11_no_active_or_terminal_pending_task(self) -> None:
        pending = self.registry["pendingInputs"]
        self.assertEqual(pending["activeWithinBaselineCutoff"], [])
        self.assertEqual(pending["activeOutsideBaselineCutoff"], [])
        self.assertEqual(pending["terminalPending"], [])
        self.assertEqual(len(pending["requiredTruth"]), 6)

    def test_12_card_is_one_fable5_row_and_redacted(self) -> None:
        card = tool.render_owner_card(self.registry)
        self.assertEqual(card.count("\n"), 1)
        self.assertTrue(card.startswith("- item=`"))
        self.assertIn(" | expected=`", card)
        self.assertIn(" | found=`", card)
        self.assertIn(" | status=`", card)
        self.assertIn("globalProfitability=UNKNOWN", card)
        self.assertIn("owner$1k=NO", card)
        self.assertIsNone(tool.FULL_IDENTIFIER.search(card))
        self.assertNotIn("/Users/", card)
        self.assertLessEqual(len(card.encode()), 1600)

    def test_13_positive_injection_is_rejected(self) -> None:
        mutated = copy.deepcopy(self.registry)
        mutated["origins"][-1]["verifiedPositive"] = True
        self.assert_contract_error(tool.validate_registry, mutated)

    def test_14_family_p_below_one_is_rejected(self) -> None:
        mutated = copy.deepcopy(self.registry)
        mutated["families"][-1]["effectiveProgramWideP"]["numerator"] = 0
        self.assert_contract_error(tool.validate_registry, mutated)

    def test_15_null_credible_count_cannot_be_zero(self) -> None:
        mutated = copy.deepcopy(self.registry)
        mutated["summary"]["crediblePositiveCount"] = 0
        self.assert_contract_error(tool.validate_registry, mutated)

    def test_16_unknown_cannot_be_no_go(self) -> None:
        mutated = copy.deepcopy(self.registry)
        mutated["summary"]["currentProfitabilityVerdict"] = "NO_GO"
        self.assert_contract_error(tool.validate_registry, mutated)

    def test_17_authority_injection_is_rejected(self) -> None:
        mutated = copy.deepcopy(self.registry)
        mutated["summary"]["capitalAuthority"] = "YES"
        self.assert_contract_error(tool.validate_registry, mutated)

    def test_18_money_injection_is_rejected(self) -> None:
        mutated = copy.deepcopy(self.registry)
        mutated["effects"]["moneyMovedUsd"] = 1
        self.assert_contract_error(tool.validate_registry, mutated)

    def test_19_state_stop_economic_promotion_is_rejected(self) -> None:
        mutated = copy.deepcopy(self.registry)
        mutated["stateOnlyStops"][0]["economicOriginContribution"] = "UNMEASURED"
        self.assert_contract_error(tool.validate_registry, mutated)

    def test_20_state_stop_artifact_injection_is_rejected(self) -> None:
        mutated = copy.deepcopy(self.registry)
        mutated["stateOnlyStops"][0]["artifact"] = {}
        self.assert_contract_error(tool.validate_registry, mutated)

    def test_21_state_stop_bool_as_int_is_rejected(self) -> None:
        mutated = copy.deepcopy(self.registry)
        mutated["stateOnlyStops"][0]["conservativeAttemptP"]["numerator"] = True
        self.assert_contract_error(tool.validate_registry, mutated)

    def test_22_source_pin_duplication_is_rejected(self) -> None:
        mutated = copy.deepcopy(self.registry)
        mutated["sourceOnlyPins"].append(copy.deepcopy(mutated["sourceOnlyPins"][0]))
        self.assert_contract_error(tool.validate_registry, mutated)

    def test_23_retained_consumer_widening_is_rejected(self) -> None:
        mutated = copy.deepcopy(self.registry)
        mutated["retainedSourceBindings"][0]["consumerScope"] = "ANY_CONSUMER"
        self.assert_contract_error(tool.validate_registry, mutated)

    def test_24_baseline_origin_mutation_is_rejected(self) -> None:
        mutated = copy.deepcopy(self.registry)
        mutated["origins"][0]["verifiedPositive"] = True
        self.assert_contract_error(tool.validate_registry, mutated)

    def test_25_baseline_source_pin_mutation_is_rejected(self) -> None:
        mutated = copy.deepcopy(self.registry)
        mutated["sourceOnlyPins"][0]["status"] = "PROMOTED"
        self.assert_contract_error(tool.validate_registry, mutated)

    def test_26_pending_task_reintroduction_is_rejected(self) -> None:
        mutated = copy.deepcopy(self.registry)
        mutated["pendingInputs"]["activeWithinBaselineCutoff"] = [{"milestoneId": "S-1T"}]
        self.assert_contract_error(tool.validate_registry, mutated)

    def test_27_spec_extra_key_is_rejected(self) -> None:
        mutated = copy.deepcopy(self.spec)
        mutated["unexpected"] = None
        self.assert_contract_error(tool._validate_spec, mutated)

    def test_28_spec_hash_mutation_is_rejected(self) -> None:
        mutated = copy.deepcopy(self.spec)
        mutated["incrementalOrigin"]["resultRawSha256"] = "0" * 64
        self.assert_contract_error(tool._validate_spec, mutated)

    def test_29_duplicate_selected_row_is_rejected(self) -> None:
        row = next(
            line
            for line in self.run_raw.splitlines(keepends=True)
            if line.startswith(f"- item=`{tool.S1T_RECORD_ID}`".encode())
        )
        self.assert_contract_error(tool.verify_run_receipts, self.registry, self.run_raw + row)

    def test_30_mutated_selected_row_is_rejected(self) -> None:
        marker = f"- item=`{tool.BORROW_RECORD_ID}`".encode()
        lines = self.run_raw.splitlines(keepends=True)
        index = next(i for i, line in enumerate(lines) if line.startswith(marker))
        lines[index] = lines[index].replace(b" | status=", b"  | status=", 1)
        self.assert_contract_error(
            tool.verify_run_receipts,
            self.registry,
            b"".join(lines),
        )

    def test_31_selected_row_reordering_is_rejected(self) -> None:
        lines = self.run_raw.splitlines(keepends=True)
        positions = [
            next(
                i
                for i, line in enumerate(lines)
                if line.startswith(f"- item=`{record_id}`".encode())
            )
            for record_id in tool.SELECTED_RECORD_IDS[-2:]
        ]
        lines[positions[0]], lines[positions[1]] = lines[positions[1]], lines[positions[0]]
        self.assert_contract_error(
            tool.verify_run_receipts,
            self.registry,
            b"".join(lines),
        )

    def test_32_baseline_row_mutation_is_rejected(self) -> None:
        marker = f"- item=`{tool.BASELINE_RECORD_ID}`".encode()
        lines = self.run_raw.splitlines(keepends=True)
        index = next(i for i, line in enumerate(lines) if line.startswith(marker))
        lines[index] = lines[index].replace(b" | found=", b"  | found=", 1)
        self.assert_contract_error(
            tool.verify_run_receipts,
            self.registry,
            b"".join(lines),
        )

    def test_33_duplicate_json_key_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "duplicate.json"
            path.write_text('{"schema":"x","schema":"y"}\n', encoding="utf-8")
            self.assert_contract_error(tool.load_json, path)

    def test_34_nonfinite_json_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "nan.json"
            path.write_text('{"value":NaN}\n', encoding="utf-8")
            self.assert_contract_error(tool.load_json, path)

    def test_35_noncanonical_registry_bytes_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            registry_path = root / "registry.json"
            card_path = root / "card.md"
            registry_path.write_text(json.dumps(self.registry, indent=2) + "\n", encoding="utf-8")
            card_path.write_text(tool.render_owner_card(self.registry), encoding="utf-8")
            self.assert_contract_error(
                tool._verify_files,
                registry_path,
                card_path,
                self.spec,
                self.run_raw,
                self.repo,
            )

    def test_36_result_pin_mutation_is_rejected(self) -> None:
        mutated = copy.deepcopy(self.registry)
        mutated["origins"][-1]["artifact"]["rawSha256"] = "0" * 64
        self.assert_contract_error(tool.validate_registry, mutated)

    def test_37_summary_bool_as_int_is_rejected(self) -> None:
        mutated = copy.deepcopy(self.registry)
        mutated["summary"]["acceptedOriginCount"] = True
        self.assert_contract_error(tool.validate_registry, mutated)


if __name__ == "__main__":
    unittest.main()
