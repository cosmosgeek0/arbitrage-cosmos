#!/usr/bin/env python3
"""Hostile focused tests for the RESULT3-PREP1 money-answer contract."""

# ruff: noqa: PT009, PT027

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from collections.abc import Callable
from dataclasses import replace
from pathlib import Path
from typing import Any, ClassVar
from unittest.mock import patch

import verify_current_money_answer as subject


def nested_mutator(path: tuple[str, ...], replacement: Any) -> Callable[[dict[str, Any]], None]:
    def mutate(value: dict[str, Any]) -> None:
        target: Any = value
        for key in path[:-1]:
            target = target[key]
        target[path[-1]] = replacement

    return mutate


class CurrentMoneyAnswerTests(unittest.TestCase):
    base_dir: ClassVar[Path]
    repo: ClassVar[Path]
    answer_path: ClassVar[Path]
    expected: ClassVar[dict[str, Any]]

    @classmethod
    def setUpClass(cls) -> None:
        cls.base_dir = Path(__file__).resolve().parent
        cls.repo = Path(
            subprocess.check_output(
                ["git", "rev-parse", "--show-toplevel"],
                cwd=cls.base_dir,
                text=True,
            ).strip()
        )
        cls.answer_path = cls.base_dir / subject.ANSWER_NAME
        cls.expected = subject.build_answer(cls.repo)

    def temporary_answer(self) -> tuple[tempfile.TemporaryDirectory[str], Path]:
        temporary = tempfile.TemporaryDirectory()
        target = Path(temporary.name) / subject.ANSWER_NAME
        shutil.copy2(self.answer_path, target)
        return temporary, target

    def mutate(
        self,
        target: Path,
        mutator: Callable[[dict[str, Any]], None],
    ) -> None:
        value = json.loads(target.read_text())
        mutator(value)
        target.write_bytes(subject.canonical_bytes(value))

    def assert_materialized_fails(self, target: Path) -> None:
        with self.assertRaises(subject.ContractError):
            subject.verify_materialized(self.expected, target)

    def test_frozen_answer_verifies(self) -> None:
        subject.verify_materialized(self.expected, self.answer_path)

    def test_two_builds_are_byte_identical(self) -> None:
        second = subject.build_answer(self.repo)
        self.assertEqual(subject.canonical_bytes(self.expected), subject.canonical_bytes(second))

    def test_all_pins_are_exact_and_closed(self) -> None:
        pins = self.expected["evidencePins"]
        self.assertEqual(
            list(pins),
            [
                "acceptedVerdictNormalization",
                "acceptedProfitabilityRegistry",
                "acceptedMakerFeeControl",
                "acceptedVolumeControl",
                "acceptedPreparedM0SourceMount",
                "acceptedPreparedM0RiskPolicy",
            ],
        )
        for label, pin in subject.EVIDENCE_PINS:
            self.assertEqual(pins[label], subject.pin_dict(pin))

    def test_main_edge_is_unmeasured_unknown_and_null(self) -> None:
        edge = self.expected["currentMoneyAnswer"]["measuredEdgeAfterStatedFees"]
        self.assertEqual(edge["scope"], "ACCOUNT_EFFECTIVE")
        self.assertEqual(edge["measurementState"], "UNMEASURED")
        self.assertEqual(edge["signState"], "UNKNOWN")
        self.assertIsNone(edge["value"])
        self.assertIsNone(edge["unit"])
        self.assertEqual(edge["accountEffectiveFeeState"], "UNKNOWN")
        self.assertIsNone(edge["accountEffectiveFeeValue"])
        self.assertTrue(edge["inferenceProhibited"])

    def test_negative_proxy_is_context_only_and_noncontributing(self) -> None:
        context = self.expected["currentMoneyAnswer"]["acceptedPublicProxyContext"]
        self.assertEqual(context["value"], "-1.8724979631579157")
        self.assertEqual(context["unit"], "USD_PER_1000_SPOT_ENTRY_NOTIONAL")
        self.assertEqual(context["signState"], "NEGATIVE")
        self.assertEqual(context["custodyQualification"], "RECEIPT_ONLY_NOT_RECOMPUTED")
        self.assertFalse(context["contributesToMeasuredEdge"])
        self.assertFalse(context["contributesToProfitabilityVerdict"])

    def test_stated_public_fees_are_strings_and_economics_remain_null(self) -> None:
        evidence = self.expected["currentMoneyAnswer"]["statedFeeEvidence"]
        self.assertEqual(
            evidence["accountEffective"], {"state": "UNKNOWN", "value": None, "unit": None}
        )
        expected_fees = [
            {
                "spotEntryMaker": "10",
                "spotExitTaker": "10",
                "usdtMEntryMaker": "2",
                "usdtMExitTaker": "5",
            },
            {
                "spotEntryMaker": "7.5",
                "spotExitTaker": "7.5",
                "usdtMEntryMaker": "1.8",
                "usdtMExitTaker": "4.5",
            },
        ]
        for scenario, fees in zip(evidence["publicScenarios"], expected_fees, strict=True):
            self.assertEqual(scenario["measurementState"], "NOT_MEASURED")
            self.assertEqual(scenario["feesBps"], fees)
            for key, value in scenario.items():
                if key not in {"scenarioId", "measurementState", "feesBps"}:
                    self.assertIsNone(value)

    def test_zero_verified_positives_does_not_become_negative(self) -> None:
        profitability = self.expected["currentMoneyAnswer"]["profitability"]
        self.assertEqual(profitability["state"], "UNKNOWN")
        self.assertEqual(profitability["signState"], "UNKNOWN")
        self.assertEqual(profitability["verifiedPositiveCount"], 0)
        self.assertEqual(profitability["acceptedCrediblePositiveCount"], 0)
        self.assertIsNone(profitability["crediblePositiveCount"])
        self.assertEqual(profitability["positiveEdgeClaim"], "NOT_MADE")
        self.assertEqual(profitability["recommendation"], "NONE")
        self.assertFalse(profitability["completeFamilyUniverse"])
        self.assertFalse(profitability["zeroVerifiedPositivesImpliesNegative"])

    def test_current_ceilings_preserve_separate_semantics(self) -> None:
        ceilings = self.expected["currentMoneyAnswer"]["currentCeilings"]
        self.assertEqual(ceilings["capitalAuthority"], "NONE")
        self.assertEqual(ceilings["authorizedCapitalUsd"], {"state": "UNKNOWN", "value": None})
        self.assertEqual(ceilings["executableCapacityUsd"], {"state": "UNKNOWN", "value": None})
        source_ceiling = ceilings["preparedM0SourceOnlyOrderNotionalCeiling"]
        self.assertEqual(source_ceiling["value"], "10")
        self.assertEqual(source_ceiling["unit"], "USDT")
        self.assertFalse(source_ceiling["executableNow"])
        self.assertFalse(source_ceiling["fundingBudget"])
        self.assertFalse(source_ceiling["scalingAuthority"])
        owner_case = ceilings["owner1000FundingCase"]
        self.assertEqual(owner_case["amountUsd"], "1000")
        self.assertEqual(owner_case["verdict"], "NO")
        self.assertEqual(
            owner_case["classification"],
            "FUNDING_VERDICT_NOT_EXECUTABLE_CEILING",
        )

    def test_prepared_protections_are_not_runtime_protections(self) -> None:
        protections = self.expected["protections"]
        self.assertEqual(protections["effectiveRuntimeProtections"], {"state": "UNKNOWN"})
        prepared = protections["preparedM0SourceProtections"]
        self.assertEqual(prepared["evidenceState"], "ACCEPTED_SOURCE_ONLY_NEVER_FIREABLE")
        self.assertFalse(prepared["landed"])
        self.assertFalse(prepared["deployed"])
        self.assertFalse(prepared["live"])
        self.assertFalse(prepared["runtimeAccepted"])
        self.assertFalse(prepared["sourceEnabled"])
        self.assertTrue(prepared["killSwitchEngaged"])
        self.assertEqual(prepared["allowedSymbols"], [])
        self.assertEqual(prepared["approvedUsdQuoteAssets"], [])
        self.assertEqual(prepared["ownerConfirmation"], "ACKNOWLEDGED_NOT_AUTHORITY")
        self.assertEqual(prepared["testOrderAuthorityState"], "NOT_PRESENT")
        self.assertEqual(prepared["submitAuthority"], "NONE")
        self.assertFalse(prepared["automaticRetry"])
        self.assertEqual(prepared["withdrawalPolicy"], "DISABLED")
        self.assertEqual(prepared["transferPolicy"], "DISABLED")

    def test_volume_protections_are_artifact_only(self) -> None:
        artifact = self.expected["protections"]["acceptedVolumeArtifactOnly"]
        self.assertEqual(
            artifact["scope"],
            "VOLUME_CONTROL_ARTIFACT_NOT_LIVE_RUNTIME_VERIFICATION",
        )
        self.assertEqual(artifact["mode"], "SHADOW_ONLY")
        self.assertTrue(artifact["recordOnly"])
        self.assertTrue(artifact["killSwitchEngaged"])
        self.assertFalse(artifact["strategyEnabled"])
        self.assertFalse(artifact["submitAuthority"])
        self.assertFalse(artifact["privateOrSignedAuthority"])
        self.assertFalse(artifact["orderTransferWithdrawalMoneyAuthority"])

    def test_larger_capital_remains_unknown_and_unscalable(self) -> None:
        larger = self.expected["currentMoneyAnswer"]["largerCapitalUnknowns"]
        self.assertEqual(larger["profitabilityState"], "UNKNOWN")
        self.assertEqual(larger["signState"], "UNKNOWN")
        self.assertEqual(larger["accountEffectiveFeeState"], "UNKNOWN")
        self.assertEqual(larger["executableCapacityState"], "UNKNOWN")
        self.assertIsNone(larger["maximumAmountUsd"])
        self.assertEqual(larger["supports1000QuoteNotional"], "UNKNOWN")
        self.assertEqual(larger["fullUniverseCapacity"], "UNKNOWN")
        self.assertIsNone(larger["measuredCapacity"])
        self.assertTrue(larger["extrapolationForbidden"])
        self.assertEqual(larger["capitalAuthority"], "NONE")

    def test_required_truth_is_exact_and_pending(self) -> None:
        self.assertEqual(
            self.expected["requiredTruth"],
            [{"code": code, "state": "PENDING"} for code in subject.REQUIRED_TRUTH],
        )

    def test_result_one_and_m0_remain_first(self) -> None:
        boundary = self.expected["deliveryBoundary"]
        self.assertEqual(boundary["priority"], "RESULT_1_FIRST")
        self.assertEqual(boundary["consumer"], "FINAL_PROFITABILITY")
        self.assertEqual(boundary["eligibleAfter"], "M0")
        self.assertEqual(boundary["stage"], "SOURCE_ONLY_PREPARATION")
        self.assertEqual(boundary["authority"], "NONE")
        self.assertFalse(boundary["landed"])
        self.assertFalse(boundary["deployed"])
        self.assertFalse(boundary["live"])

    def test_effect_zeros_are_scoped_to_source_preparation(self) -> None:
        effects = self.expected["effects"]
        self.assertEqual(effects["scope"], "RESULT3_PREP1_SOURCE_PREPARATION_ONLY")
        self.assertEqual(effects["moneyMovedUsd"], 0)
        self.assertEqual(effects["ordersPlaced"], 0)
        self.assertEqual(effects["transfers"], 0)
        self.assertEqual(effects["withdrawals"], 0)
        self.assertFalse(effects["credentialsUsed"])
        self.assertFalse(effects["privateApiUsed"])
        self.assertFalse(effects["hostEffects"])
        self.assertFalse(effects["uiEffects"])

    def test_duplicate_key_is_rejected(self) -> None:
        temporary, target = self.temporary_answer()
        self.addCleanup(temporary.cleanup)
        target.write_bytes(b'{"schema":"x","schema":"y"}\n')
        self.assert_materialized_fails(target)

    def test_float_is_rejected(self) -> None:
        temporary, target = self.temporary_answer()
        self.addCleanup(temporary.cleanup)
        target.write_bytes(b'{"value":1.0}\n')
        self.assert_materialized_fails(target)

    def test_nonfinite_number_is_rejected(self) -> None:
        temporary, target = self.temporary_answer()
        self.addCleanup(temporary.cleanup)
        target.write_bytes(b'{"value":NaN}\n')
        self.assert_materialized_fails(target)

    def test_noncanonical_pretty_json_is_rejected(self) -> None:
        temporary, target = self.temporary_answer()
        self.addCleanup(temporary.cleanup)
        target.write_text(json.dumps(self.expected, indent=2) + "\n")
        self.assert_materialized_fails(target)

    def test_crlf_and_missing_final_lf_are_rejected(self) -> None:
        transforms: tuple[Callable[[bytes], bytes], ...] = (
            lambda raw: raw.replace(b"\n", b"\r\n"),
            lambda raw: raw.removesuffix(b"\n"),
        )
        for transform in transforms:
            with self.subTest(transform=transform):
                temporary, target = self.temporary_answer()
                self.addCleanup(temporary.cleanup)
                target.write_bytes(transform(target.read_bytes()))
                self.assert_materialized_fails(target)

    def test_extra_or_missing_key_is_rejected(self) -> None:
        def add_extra(value: dict[str, Any]) -> None:
            value["extra"] = True

        def remove_protections(value: dict[str, Any]) -> None:
            del value["protections"]

        for mutator in (add_extra, remove_protections):
            with self.subTest(mutator=mutator):
                temporary, target = self.temporary_answer()
                self.addCleanup(temporary.cleanup)
                self.mutate(target, mutator)
                self.assert_materialized_fails(target)

    def test_main_null_cannot_become_zero_or_proxy(self) -> None:
        for replacement in (0, "-1.8724979631579157"):
            with self.subTest(replacement=replacement):
                temporary, target = self.temporary_answer()
                self.addCleanup(temporary.cleanup)
                self.mutate(
                    target,
                    nested_mutator(
                        ("currentMoneyAnswer", "measuredEdgeAfterStatedFees", "value"),
                        replacement,
                    ),
                )
                self.assert_materialized_fails(target)

    def test_unknown_profitability_cannot_become_no_go(self) -> None:
        temporary, target = self.temporary_answer()
        self.addCleanup(temporary.cleanup)

        def mutate(value: dict[str, Any]) -> None:
            value["currentMoneyAnswer"]["profitability"]["state"] = "NO_GO"
            value["currentMoneyAnswer"]["profitability"]["signState"] = "NEGATIVE"

        self.mutate(target, mutate)
        self.assert_materialized_fails(target)

    def test_proxy_cannot_be_promoted_or_have_sign_changed(self) -> None:
        for key, replacement in (
            ("contributesToMeasuredEdge", True),
            ("contributesToProfitabilityVerdict", True),
            ("signState", "POSITIVE"),
            ("value", "0"),
        ):
            with self.subTest(key=key):
                temporary, target = self.temporary_answer()
                self.addCleanup(temporary.cleanup)
                self.mutate(
                    target,
                    nested_mutator(
                        ("currentMoneyAnswer", "acceptedPublicProxyContext", key),
                        replacement,
                    ),
                )
                self.assert_materialized_fails(target)

    def test_public_scenario_nulls_cannot_become_zero(self) -> None:
        temporary, target = self.temporary_answer()
        self.addCleanup(temporary.cleanup)

        def mutate(value: dict[str, Any]) -> None:
            value["currentMoneyAnswer"]["statedFeeEvidence"]["publicScenarios"][0][
                "netUsdPer1000SpotEntryNotional"
            ] = "0"

        self.mutate(target, mutate)
        self.assert_materialized_fails(target)

    def test_public_fees_cannot_become_account_effective(self) -> None:
        temporary, target = self.temporary_answer()
        self.addCleanup(temporary.cleanup)

        def mutate(value: dict[str, Any]) -> None:
            value["currentMoneyAnswer"]["statedFeeEvidence"]["accountEffective"] = {
                "state": "KNOWN",
                "value": "10",
                "unit": "BPS",
            }

        self.mutate(target, mutate)
        self.assert_materialized_fails(target)

    def test_source_ceiling_cannot_become_budget_or_execution_authority(self) -> None:
        for key in ("executableNow", "fundingBudget", "scalingAuthority"):
            with self.subTest(key=key):
                temporary, target = self.temporary_answer()
                self.addCleanup(temporary.cleanup)
                self.mutate(
                    target,
                    nested_mutator(
                        (
                            "currentMoneyAnswer",
                            "currentCeilings",
                            "preparedM0SourceOnlyOrderNotionalCeiling",
                            key,
                        ),
                        True,
                    ),
                )
                self.assert_materialized_fails(target)

    def test_prepared_protections_cannot_become_live_or_authorized(self) -> None:
        for key, replacement in (
            ("live", True),
            ("runtimeAccepted", True),
            ("sourceEnabled", True),
            ("testOrderAuthorityState", "PRESENT"),
            ("submitAuthority", "PRESENT"),
        ):
            with self.subTest(key=key):
                temporary, target = self.temporary_answer()
                self.addCleanup(temporary.cleanup)
                self.mutate(
                    target,
                    nested_mutator(
                        ("protections", "preparedM0SourceProtections", key),
                        replacement,
                    ),
                )
                self.assert_materialized_fails(target)

    def test_larger_capital_unknowns_cannot_gain_values(self) -> None:
        temporary, target = self.temporary_answer()
        self.addCleanup(temporary.cleanup)

        def mutate(value: dict[str, Any]) -> None:
            larger = value["currentMoneyAnswer"]["largerCapitalUnknowns"]
            larger["maximumAmountUsd"] = "10000"
            larger["executableCapacityState"] = "MEASURED"

        self.mutate(target, mutate)
        self.assert_materialized_fails(target)

    def test_required_gate_cannot_disappear(self) -> None:
        temporary, target = self.temporary_answer()
        self.addCleanup(temporary.cleanup)

        def mutate(value: dict[str, Any]) -> None:
            value["requiredTruth"].pop()

        self.mutate(target, mutate)
        self.assert_materialized_fails(target)

    def test_priority_cannot_move_ahead_of_m0(self) -> None:
        temporary, target = self.temporary_answer()
        self.addCleanup(temporary.cleanup)

        def mutate(value: dict[str, Any]) -> None:
            value["deliveryBoundary"]["priority"] = "RESULT_3_FIRST"
            value["deliveryBoundary"]["eligibleAfter"] = "NOW"

        self.mutate(target, mutate)
        self.assert_materialized_fails(target)

    def test_pinned_normalization_raw_hash_is_recomputed(self) -> None:
        corrupted = replace(subject.NORMALIZATION_PIN, raw_sha256="0" * 64)
        replacement_pins = (
            ("acceptedVerdictNormalization", corrupted),
            *subject.JSON_PINS[1:],
        )
        with (
            patch.object(subject, "JSON_PINS", replacement_pins),
            self.assertRaises(subject.ContractError),
        ):
            subject.build_answer(self.repo)

    def test_normalized_control_must_cross_bind_exact_accepted_pin(self) -> None:
        normalization = subject.read_json_pin(
            self.repo,
            subject.NORMALIZATION_PIN,
            "acceptedVerdictNormalization",
        )
        maker = next(
            record
            for record in normalization["records"]
            if record["id"] == "BASIS-MAKER-REAL-TIER-GRID"
        )
        maker["resultPin"]["gitBlob"] = "0" * 40
        with self.assertRaises(subject.ContractError):
            subject.validate_normalization(normalization)

    def test_pinned_m0_source_raw_hash_is_recomputed(self) -> None:
        corrupted = replace(subject.M0_SOURCE_PIN, raw_sha256="0" * 64)
        with (
            patch.object(subject, "M0_SOURCE_PIN", corrupted),
            self.assertRaises(subject.ContractError),
        ):
            subject.build_answer(self.repo)


if __name__ == "__main__":
    unittest.main()
