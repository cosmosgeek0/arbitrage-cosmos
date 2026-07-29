#!/usr/bin/env python3
"""Hostile focused proof for the N3-S2 accepted-only successor."""

from __future__ import annotations

import copy
import enum
import sys
import tempfile
from pathlib import Path
from typing import Any

import pytest

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
RUN_PATH = Path("/Users/cosmosgeek/Desktop/run.md")
SPEC_PATH = HERE / "origin_spec.v2.json"
REGISTRY_PATH = HERE / "current_profitability_registry.v2.json"
CARD_PATH = HERE / "owner_verdict_card.v2.md"
sys.path.insert(0, str(HERE))

import registry_tool_v2 as rt  # noqa: E402


class StringAlias(str, enum.Enum):  # noqa: UP042 -- Python 3.9 compatibility proof
    NONE = "NONE"


class TestN3S2RegistryContract:
    spec: dict[str, Any]
    registry: dict[str, Any]
    card: bytes

    @classmethod
    def setup_class(cls) -> None:
        cls.spec = rt.load_json(SPEC_PATH)
        cls.registry = rt.load_json(REGISTRY_PATH)
        cls.card = CARD_PATH.read_bytes()

    def fresh(self) -> dict[str, Any]:
        return copy.deepcopy(self.registry)

    def assert_invalid(self, candidate: object) -> None:
        with pytest.raises(rt.ContractError):
            rt.validate_registry(candidate)

    def test_frozen_files_full_exact_verification(self) -> None:
        proof = rt._verify_files(REGISTRY_PATH, CARD_PATH, ROOT, SPEC_PATH, RUN_PATH)
        assert proof["acceptedOriginCount"] == 48
        assert proof["acceptedFamilyCount"] == 47
        assert proof["postVG31AcceptedEconomicConsumedCount"] == 12
        assert proof["activeProfitabilityTaskCount"] == 2
        assert proof["terminalPendingCount"] == 0
        assert proof["verifiedPositiveCount"] == 0
        assert proof["crediblePositiveCount"] is None
        assert proof["verdict"] == "UNKNOWN"

    def test_freeze_is_byte_deterministic(self) -> None:
        generated = rt.freeze_registry(self.spec, RUN_PATH.read_bytes(), ROOT)
        assert rt._canonical_bytes(generated) == REGISTRY_PATH.read_bytes()
        assert rt.render_owner_card(generated).encode("utf-8") == self.card

    def test_card_is_one_bounded_suffix_only_row(self) -> None:
        text = self.card.decode("utf-8")
        assert text.count("\n") == 1
        assert len(self.card) <= 1600
        assert rt.FULL_IDENTIFIER.search(text) is None
        assert "/Users/" not in text
        assert "origins=48/48" in text
        assert "acceptedFamilies=47" in text
        assert "acceptedSourceOnly=8" in text
        assert "crediblePositiveCount=null" in text
        assert "globalProfitability=UNKNOWN" in text
        assert "owner$1k=NO" in text
        assert "recommendation=NONE" in text
        assert "authority=NONE" in text

    def test_duplicate_keys_nonfinite_and_alias_types_fail(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            duplicate = Path(temp_dir) / "duplicate.json"
            duplicate.write_bytes(b'{"schema":"one","schema":"two"}\n')
            with pytest.raises(rt.ContractError):
                rt.load_json(duplicate)
            nonfinite = Path(temp_dir) / "nonfinite.json"
            nonfinite.write_bytes(b'{"value":NaN}\n')
            with pytest.raises(rt.ContractError):
                rt.load_json(nonfinite)

        candidate = self.fresh()
        candidate["summary"]["acceptedOriginCount"] = True
        self.assert_invalid(candidate)

        candidate = self.fresh()
        candidate["ledgerReceipts"][0]["economicOriginConsumed"] = 0
        self.assert_invalid(candidate)

        candidate = self.fresh()
        candidate["summary"]["recommendation"] = StringAlias.NONE
        self.assert_invalid(candidate)

    def test_baseline_commit_tree_and_artifacts_are_immutable(self) -> None:
        candidate = self.fresh()
        candidate["baseline"]["producerTree"] = "0" * 40
        self.assert_invalid(candidate)

        candidate = self.fresh()
        candidate["baseline"]["registryArtifact"]["path"] = "README.md"
        self.assert_invalid(candidate)

        candidate = self.fresh()
        candidate["origins"][0]["limitations"].append("INJECTED")
        self.assert_invalid(candidate)

        candidate = self.fresh()
        candidate["families"][0]["originIds"] = ["E-1"]
        candidate["families"][0]["originCount"] = 1
        self.assert_invalid(candidate)

    def test_dual_boundaries_and_delta_allowlist_are_strict(self) -> None:
        candidate = self.fresh()
        candidate["deltaWindow"]["startExclusive"]["recordId"] = (
            "2026-07-30 ORCHESTRATOR V-G30 ACCEPTANCE"
        )
        self.assert_invalid(candidate)

        candidate = self.fresh()
        candidate["deltaWindow"]["economicEvidenceThrough"]["recordId"] = (
            "2026-07-30 ORCHESTRATOR V-G36 ACCEPTANCE"
        )
        self.assert_invalid(candidate)

        candidate = self.fresh()
        candidate["deltaWindow"]["acceptedEconomicOriginIds"].append("V-G38")
        self.assert_invalid(candidate)

    def test_ledger_receipt_bytes_order_class_and_reference_set_are_strict(self) -> None:
        candidate = self.fresh()
        receipt = candidate["ledgerReceipts"][0]
        raw = receipt["rowUtf8"].encode("utf-8").rstrip(b"\n")
        receipt["rowUtf8"] = raw.decode("utf-8")
        receipt["rowByteLength"] = len(raw)
        receipt["rowSha256"] = rt._sha256(raw)
        self.assert_invalid(candidate)

        candidate = self.fresh()
        candidate["ledgerReceipts"][0], candidate["ledgerReceipts"][1] = (
            candidate["ledgerReceipts"][1],
            candidate["ledgerReceipts"][0],
        )
        self.assert_invalid(candidate)

        candidate = self.fresh()
        candidate["ledgerReceipts"][0]["classification"] = "ACCEPTED_ECONOMIC_ORIGIN"
        self.assert_invalid(candidate)

        candidate = self.fresh()
        candidate["ledgerReceipts"].append(copy.deepcopy(candidate["ledgerReceipts"][0]))
        self.assert_invalid(candidate)

    def test_only_twelve_accepted_rows_can_consume_economics(self) -> None:
        consumed = [
            row["recordId"]
            for row in self.registry["ledgerReceipts"]
            if row["economicOriginConsumed"]
        ]
        assert consumed == [
            "2026-07-30 ORCHESTRATOR V-G28 ACCEPTANCE",
            "2026-07-30 ORCHESTRATOR V-G37 ACCEPTANCE",
            "2026-07-30 ORCHESTRATOR S-1Y ACCEPTANCE + REFILL",
            "2026-07-30 ORCHESTRATOR S-2C ACCEPTANCE",
            "2026-07-30 ORCHESTRATOR S-1Z ACCEPTANCE",
            "2026-07-30 ORCHESTRATOR V-G36 ACCEPTANCE",
            "2026-07-30 ORCHESTRATOR S-2G ACCEPTANCE",
            "2026-07-30 ORCHESTRATOR S-2H ACCEPTANCE + DQ-11 DURABILITY RESUME",
            "2026-07-30 ORCHESTRATOR V-G27 ACCEPTANCE",
            "2026-07-30 ORCHESTRATOR S-2A ACCEPTANCE",
            "2026-07-30 ORCHESTRATOR S-2K ACCEPTANCE",
            "2026-07-30 ORCHESTRATOR S-2I ACCEPTANCE + OPUS 5 FOLD-PREP REFILL",
        ]

        candidate = self.fresh()
        rejected = next(
            row
            for row in candidate["ledgerReceipts"]
            if row["recordId"] == "2026-07-30 ORCHESTRATOR V-G35 REJECTION"
        )
        rejected["economicOriginConsumed"] = True
        self.assert_invalid(candidate)

        candidate = self.fresh()
        source_only = next(
            row
            for row in candidate["ledgerReceipts"]
            if row["recordId"] == "2026-07-30 ORCHESTRATOR DQ-6 ACCEPTANCE"
        )
        source_only["economicOriginConsumed"] = True
        self.assert_invalid(candidate)

    def test_incremental_origin_order_verdict_artifact_and_protocol_are_strict(self) -> None:
        candidate = self.fresh()
        candidate["origins"][36], candidate["origins"][37] = (
            candidate["origins"][37],
            candidate["origins"][36],
        )
        candidate["origins"][36]["ordinal"] = 37
        candidate["origins"][37]["ordinal"] = 38
        self.assert_invalid(candidate)

        candidate = self.fresh()
        candidate["origins"][36]["normalizedVerdict"] = "VERIFIED_POSITIVE"
        self.assert_invalid(candidate)

        candidate = self.fresh()
        candidate["origins"][36]["artifact"]["path"] = "README.md"
        self.assert_invalid(candidate)

        candidate = self.fresh()
        candidate["origins"][37]["familyIdentity"]["protocolArtifact"]["path"] = "README.md"
        self.assert_invalid(candidate)

    def test_incremental_family_identity_dedup_and_p_one_are_strict(self) -> None:
        candidate = self.fresh()
        candidate["origins"][38]["familyIdentity"]["key"] = candidate["origins"][36][
            "familyIdentity"
        ]["key"]
        self.assert_invalid(candidate)

        candidate = self.fresh()
        candidate["families"][-1]["effectiveProgramWideP"]["numerator"] = 0
        self.assert_invalid(candidate)

        candidate = self.fresh()
        candidate["families"][-1]["verifiedPositive"] = True
        self.assert_invalid(candidate)

    def test_every_incremental_and_disposition_limitation_is_required(self) -> None:
        for origin_id in rt.INCREMENTAL_ORIGIN_IDS:
            candidate = self.fresh()
            origin = next(item for item in candidate["origins"] if item["originId"] == origin_id)
            origin["limitations"].pop()
            self.assert_invalid(candidate)

        for record_id in (
            "2026-07-30 ORCHESTRATOR V-G12 REJECTION",
            "2026-07-30 ORCHESTRATOR V-G32 REJECTION",
            "2026-07-30 ORCHESTRATOR V-G35 REJECTION",
            "2026-07-30 ORCHESTRATOR S-2J DISTINCTNESS STOP",
        ):
            candidate = self.fresh()
            receipt = next(
                item for item in candidate["ledgerReceipts"] if item["recordId"] == record_id
            )
            receipt["limitations"].pop()
            self.assert_invalid(candidate)

    def test_source_only_pins_cannot_be_promoted_or_rebound(self) -> None:
        candidate = self.fresh()
        candidate["sourceOnlyPins"][0]["economicContribution"] = "POSITIVE_EDGE"
        self.assert_invalid(candidate)

        candidate = self.fresh()
        candidate["sourceOnlyPins"][1]["artifact"]["path"] = "quant/research/dq3/README.md"
        self.assert_invalid(candidate)

        candidate = self.fresh()
        candidate["sourceOnlyPins"][0]["status"] = "ACCEPTED_ECONOMIC_ORIGIN"
        self.assert_invalid(candidate)

        candidate = self.fresh()
        dq6 = next(item for item in candidate["sourceOnlyPins"] if item["bindingId"] == "DQ-6")
        dq6["artifact"]["path"] = "quant/research/dq6/validator.py"
        self.assert_invalid(candidate)

        candidate = self.fresh()
        dq8 = next(item for item in candidate["sourceOnlyPins"] if item["bindingId"] == "DQ-8")
        dq8["economicContribution"] = "NAV_PROFIT"
        self.assert_invalid(candidate)

        candidate = self.fresh()
        dq4 = next(item for item in candidate["sourceOnlyPins"] if item["bindingId"] == "DQ-4")
        dq4["artifact"]["path"] = "quant/research/dq4/origin_validator.py"
        self.assert_invalid(candidate)

        candidate = self.fresh()
        dq14 = next(item for item in candidate["sourceOnlyPins"] if item["bindingId"] == "DQ-14")
        dq14["economicContribution"] = "PROFITABILITY_EVIDENCE"
        self.assert_invalid(candidate)

    def test_unknown_null_no_authority_and_no_money_cannot_inflate(self) -> None:
        cases = (
            ("acceptedCrediblePositiveCount", 1),
            ("crediblePositiveCount", 0),
            ("verifiedPositiveCount", 1),
            ("currentProfitabilityVerdict", "VERIFIED_POSITIVE"),
            ("owner1000FundingVerdict", "YES"),
            ("positiveEdgeClaim", "MADE"),
            ("recommendation", "GO"),
            ("capitalAuthority", "CAPITAL_ALLOWED"),
            ("moneyUsd", 1),
            ("completeFamilyUniverse", True),
        )
        for field, value in cases:
            candidate = self.fresh()
            candidate["summary"][field] = value
            self.assert_invalid(candidate)

    def test_counts_are_exactly_derived_not_merely_balanced(self) -> None:
        candidate = self.fresh()
        candidate["summary"]["localVerdictCounts"] = {"NO_GO": 21, "UNMEASURED": 23}
        self.assert_invalid(candidate)

        candidate = self.fresh()
        candidate["summary"]["acceptedOriginCount"] = 49
        candidate["summary"]["acceptedFamilyCount"] = 48
        self.assert_invalid(candidate)

        candidate = self.fresh()
        candidate["summary"]["rejectedAttemptP1DispositionCount"] = 5
        self.assert_invalid(candidate)

    def test_legacy_accepted_rows_remain_excluded_and_unconsumed(self) -> None:
        assert len(self.registry["legacyAcceptedExcluded"]) == 13
        assert all(
            item["outcomeBytesConsumed"] is False
            for item in self.registry["legacyAcceptedExcluded"]
        )

        candidate = self.fresh()
        candidate["legacyAcceptedExcluded"][0]["outcomeBytesConsumed"] = True
        self.assert_invalid(candidate)

        candidate = self.fresh()
        candidate["legacyAcceptedExcluded"].reverse()
        self.assert_invalid(candidate)

    def test_pending_tasks_are_exact_uninspected_and_non_evidence(self) -> None:
        candidate = self.fresh()
        task = candidate["pendingInputs"]["activeWithinBaselineCutoff"][0]
        task["outcomeBytesInspected"] = True
        self.assert_invalid(candidate)

        candidate = self.fresh()
        task = candidate["pendingInputs"]["activeWithinBaselineCutoff"][1]
        task["taskRefIsEvidence"] = True
        self.assert_invalid(candidate)

        candidate = self.fresh()
        candidate["pendingInputs"]["terminalPending"].append(
            {
                "evidenceState": "TERMINAL_PENDING_ORCHESTRATOR",
                "inBaselineCutoffScope": False,
                "milestoneId": "V-G27",
                "outcomeBytesInspected": False,
                "taskRefIsEvidence": False,
                "taskRefSuffix": "d010",
            }
        )
        self.assert_invalid(candidate)

        candidate = self.fresh()
        candidate["pendingInputs"]["requiredTruth"][0]["state"] = "COMPLETE"
        self.assert_invalid(candidate)

    def test_latest_economic_and_source_only_rows_are_classified_exactly(self) -> None:
        ledger_ids = {item["recordId"] for item in self.registry["ledgerReceipts"]}
        origin_ids = {item["originId"] for item in self.registry["origins"]}
        assert "2026-07-30 ORCHESTRATOR S-2G ACCEPTANCE" in ledger_ids
        assert "2026-07-30 ORCHESTRATOR S-2H ACCEPTANCE + DQ-11 DURABILITY RESUME" in ledger_ids
        assert "2026-07-30 ORCHESTRATOR V-G38 REJECTION + REFILL" in ledger_ids
        assert "2026-07-30 ORCHESTRATOR DQ-8 ACCEPTANCE + PRODUCT REFILL" in ledger_ids
        assert "2026-07-30 ORCHESTRATOR V-G27 ACCEPTANCE" in ledger_ids
        assert "2026-07-30 ORCHESTRATOR S-2A ACCEPTANCE" in ledger_ids
        assert "2026-07-30 ORCHESTRATOR DQ-4 ACCEPTANCE" in ledger_ids
        assert "2026-07-30 ORCHESTRATOR S-2K ACCEPTANCE" in ledger_ids
        assert "2026-07-30 ORCHESTRATOR S-2I ACCEPTANCE + OPUS 5 FOLD-PREP REFILL" in ledger_ids
        assert "2026-07-30 ORCHESTRATOR DQ-14 DURABILITY REJECTION + SAME-TASK RESUME" in ledger_ids
        assert "2026-07-30 ORCHESTRATOR DQ-14 ACCEPTANCE" in ledger_ids
        assert "S-2G" in origin_ids
        assert "S-2H" in origin_ids
        assert "V-G27" in origin_ids
        assert "S-2A" in origin_ids
        assert "S-2K" in origin_ids
        assert "S-2I" in origin_ids
        assert "V-G38" not in origin_ids
        assert "DQ-8" not in origin_ids
        assert "DQ-4" not in origin_ids
        assert "DQ-14" not in origin_ids
        assert self.registry["pendingInputs"]["activeOutsideBaselineCutoff"] == []
        assert self.registry["pendingInputs"]["terminalPending"] == []

    def test_truth_policy_spec_hash_and_card_tampering_fail(self) -> None:
        for policy_name, value in self.registry["truthPolicy"].items():
            candidate = self.fresh()
            candidate["truthPolicy"][policy_name] = not value
            self.assert_invalid(candidate)

        candidate = self.fresh()
        candidate["originSpecCanonicalSha256"] = "0" * 64
        with pytest.raises(rt.ContractError):
            rt.verify_spec_binding(candidate, self.spec)

        with tempfile.TemporaryDirectory() as temp_dir:
            temp = Path(temp_dir)
            registry_path = temp / REGISTRY_PATH.name
            card_path = temp / CARD_PATH.name
            spec_path = temp / SPEC_PATH.name
            registry_path.write_bytes(REGISTRY_PATH.read_bytes())
            spec_path.write_bytes(SPEC_PATH.read_bytes())
            card_path.write_bytes(self.card.replace(b"owner$1k=NO", b"owner$1k=YES"))
            with pytest.raises(rt.ContractError):
                rt._verify_files(registry_path, card_path, ROOT, spec_path, RUN_PATH)
