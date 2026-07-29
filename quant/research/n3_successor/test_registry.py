#!/usr/bin/env python3
"""Hostile focused proof for the frozen N3-S1 profitability registry."""

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
SPEC_PATH = HERE / "origin_spec.v1.json"
REGISTRY_PATH = HERE / "current_profitability_registry.v1.json"
CARD_PATH = HERE / "owner_verdict_card.v1.md"
sys.path.insert(0, str(HERE))

import registry_tool as rt  # noqa: E402


class StringAlias(enum.StrEnum):
    NONE = "NONE"


class TestRegistryContract:
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
        proof = rt._verify_files(
            REGISTRY_PATH,
            CARD_PATH,
            ROOT,
            SPEC_PATH,
            RUN_PATH,
        )
        assert proof["acceptedOriginCount"] == 36
        assert proof["acceptedFamilyCount"] == 35
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
        assert len(self.card) <= 1100
        assert rt.FULL_IDENTIFIER.search(text) is None
        assert "/Users/" not in text
        assert "crediblePositiveCount=null" in text
        assert "globalProfitability=UNKNOWN" in text
        assert "recommendation=NONE" in text
        assert "authority=NONE" in text

    def test_duplicate_json_keys_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "duplicate.json"
            path.write_bytes(b'{"schema":"one","schema":"two"}\n')
            with pytest.raises(rt.ContractError):
                rt.load_json(path)

    def test_boolean_integer_and_string_aliases_are_rejected(self) -> None:
        candidate = self.fresh()
        candidate["summary"]["acceptedOriginCount"] = True
        self.assert_invalid(candidate)

        candidate = self.fresh()
        candidate["cutoff"]["postCutoffOriginsConsumed"] = 0
        self.assert_invalid(candidate)

        candidate = self.fresh()
        candidate["families"][0]["effectiveProgramWideP"]["numerator"] = True
        self.assert_invalid(candidate)

        candidate = self.fresh()
        candidate["summary"]["recommendation"] = StringAlias.NONE
        self.assert_invalid(candidate)

    def test_receipt_bytes_authority_and_identity_are_strict(self) -> None:
        candidate = self.fresh()
        receipt = candidate["acceptanceReceipts"][0]
        raw = receipt["rowUtf8"].encode("utf-8").rstrip(b"\n")
        receipt["rowUtf8"] = raw.decode("utf-8")
        receipt["rowByteLength"] = len(raw)
        receipt["rowSha256"] = rt._sha256(raw)
        self.assert_invalid(candidate)

        candidate = self.fresh()
        receipt = candidate["acceptanceReceipts"][0]
        raw = receipt["rowUtf8"].replace("- ", "", 1).encode("utf-8")
        receipt["rowUtf8"] = raw.decode("utf-8")
        receipt["rowByteLength"] = len(raw)
        receipt["rowSha256"] = rt._sha256(raw)
        self.assert_invalid(candidate)

        candidate = self.fresh()
        candidate["acceptanceReceipts"].append(copy.deepcopy(candidate["acceptanceReceipts"][0]))
        self.assert_invalid(candidate)

        candidate = self.fresh()
        extra_record = "2026-07-29 ORCHESTRATOR M0-I2 SUCCESSOR ACCEPTANCE"
        extra_receipts, _ = rt._extract_rows(RUN_PATH.read_bytes(), [extra_record])
        candidate["acceptanceReceipts"].append(extra_receipts[extra_record])
        candidate["acceptanceReceipts"].sort(key=lambda item: item["recordId"])
        self.assert_invalid(candidate)

    def test_origin_allowlist_order_and_artifact_dedup_are_strict(self) -> None:
        candidate = self.fresh()
        candidate["origins"][0], candidate["origins"][1] = (
            candidate["origins"][1],
            candidate["origins"][0],
        )
        candidate["origins"][0]["ordinal"] = 1
        candidate["origins"][1]["ordinal"] = 2
        self.assert_invalid(candidate)

        candidate = self.fresh()
        source = candidate["origins"][3]
        target = candidate["origins"][4]
        target["artifact"] = copy.deepcopy(source["artifact"])
        target["producerCommit"] = source["producerCommit"]
        target["producerTree"] = source["producerTree"]
        self.assert_invalid(candidate)

    def test_smeta_family_mapping_order_and_rollups_are_strict(self) -> None:
        candidate = self.fresh()
        s1c = next(origin for origin in candidate["origins"] if origin["originId"] == "S-1C")
        s1c["familyIdentity"]["key"] = "F05_VOLUME_ACCEPTED_EXIT_REPLAY"
        self.assert_invalid(candidate)

        candidate = self.fresh()
        candidate["families"][3], candidate["families"][4] = (
            candidate["families"][4],
            candidate["families"][3],
        )
        candidate["families"][3]["ordinal"] = 4
        candidate["families"][4]["ordinal"] = 5
        self.assert_invalid(candidate)

        candidate = self.fresh()
        candidate["families"][0]["originIds"] = ["E-1"]
        candidate["families"][0]["originCount"] = 1
        candidate["families"][1]["originIds"].append("BASIS-SUCCESSOR")
        candidate["families"][1]["originCount"] += 1
        self.assert_invalid(candidate)

    def test_provisional_protocol_identity_and_p_one_are_strict(self) -> None:
        candidate = self.fresh()
        post = next(
            origin
            for origin in candidate["origins"]
            if origin["familyIdentity"]["state"] == "PROVISIONAL_POST_SMETA1"
        )
        post["familyIdentity"]["protocolArtifact"]["path"] = "README.md"
        self.assert_invalid(candidate)

        candidate = self.fresh()
        candidate["families"][-1]["effectiveProgramWideP"]["denominator"] = 2
        self.assert_invalid(candidate)

    def test_custody_and_required_limitations_are_strict(self) -> None:
        candidate = self.fresh()
        candidate["origins"][0]["custodyState"] = "ACCEPTED_EXACT"
        self.assert_invalid(candidate)

        candidate = self.fresh()
        vg26 = next(origin for origin in candidate["origins"] if origin["originId"] == "V-G26")
        vg26["limitations"].remove("POSITIVE_POINT_ESTIMATE_NOT_CREDIBLE")
        self.assert_invalid(candidate)

        for origin_id, limitation in rt.REQUIRED_LIMITATIONS.items():
            candidate = self.fresh()
            origin = next(item for item in candidate["origins"] if item["originId"] == origin_id)
            origin["limitations"].remove(limitation)
            self.assert_invalid(candidate)

    def test_positive_verdict_recommendation_and_authority_inflation_fail(self) -> None:
        cases = (
            ("acceptedCrediblePositiveCount", 1),
            ("crediblePositiveCount", 0),
            ("verifiedPositiveCount", 1),
            ("currentProfitabilityVerdict", "NO_GO"),
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

        candidate = self.fresh()
        candidate["origins"][0]["verifiedPositive"] = True
        self.assert_invalid(candidate)

        candidate = self.fresh()
        candidate["families"][0]["verifiedPositive"] = True
        self.assert_invalid(candidate)

    def test_unknown_null_and_truth_policy_cannot_be_weakened(self) -> None:
        for policy_name, value in self.registry["truthPolicy"].items():
            candidate = self.fresh()
            candidate["truthPolicy"][policy_name] = not value
            self.assert_invalid(candidate)

        candidate = self.fresh()
        candidate["summary"]["crediblePositiveCount"] = False
        self.assert_invalid(candidate)

    def test_pending_inputs_are_exact_uninspected_and_non_evidence(self) -> None:
        candidate = self.fresh()
        task = candidate["pendingInputs"]["activeUnpublishedWithinCutoff"][0]
        task["outcomeBytesInspected"] = True
        self.assert_invalid(candidate)

        candidate = self.fresh()
        task = candidate["pendingInputs"]["activeUnpublishedWithinCutoff"][0]
        task["taskRefIsEvidence"] = True
        self.assert_invalid(candidate)

        candidate = self.fresh()
        task = candidate["pendingInputs"]["activeUnpublishedWithinCutoff"][0]
        task["inCutoffScope"] = False
        self.assert_invalid(candidate)

        candidate = self.fresh()
        candidate["pendingInputs"]["requiredTruth"][0]["state"] = "COMPLETE"
        self.assert_invalid(candidate)

        candidate = self.fresh()
        candidate["pendingInputs"]["outsideCutoffExcluded"][0]["milestoneId"] = "V-G999"
        self.assert_invalid(candidate)

    def test_post_cutoff_acceptances_are_exact_and_unconsumed(self) -> None:
        candidate = self.fresh()
        candidate["postCutoffAcceptedExcluded"][0]["outcomeBytesConsumed"] = True
        self.assert_invalid(candidate)

        candidate = self.fresh()
        candidate["postCutoffAcceptedExcluded"].reverse()
        self.assert_invalid(candidate)

        assert [item["recordId"] for item in self.registry["postCutoffAcceptedExcluded"]] == list(
            rt.POST_CUTOFF_RECORD_IDS
        )

    def test_summary_counts_are_derived_not_merely_balanced(self) -> None:
        candidate = self.fresh()
        candidate["summary"]["localVerdictCounts"] = {
            "NO_GO": -1,
            "UNMEASURED": 37,
        }
        self.assert_invalid(candidate)

        candidate = self.fresh()
        candidate["summary"]["pendingTaskCountWithinCutoff"] = 8
        self.assert_invalid(candidate)

        candidate = self.fresh()
        candidate["summary"]["postCutoffAcceptedExcludedCount"] = 8
        self.assert_invalid(candidate)

    def test_spec_hash_and_exact_bindings_reject_rebinding(self) -> None:
        candidate = self.fresh()
        candidate["originSpecCanonicalSha256"] = "0" * 64
        with pytest.raises(rt.ContractError):
            rt.verify_spec_binding(candidate, self.spec)

        candidate = self.fresh()
        candidate["aggregateBindings"][0]["artifact"]["path"] = "README.md"
        with pytest.raises(rt.ContractError):
            rt.verify_spec_binding(candidate, self.spec)

        candidate = self.fresh()
        candidate["cutoff"]["resultArtifact"]["path"] = "README.md"
        self.assert_invalid(candidate)

        candidate = self.fresh()
        candidate["origins"][5]["artifact"]["path"] = "README.md"
        with pytest.raises(rt.ContractError):
            rt.verify_spec_binding(candidate, self.spec)

    def test_card_tampering_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            temp = Path(temp_dir)
            registry_path = temp / REGISTRY_PATH.name
            card_path = temp / CARD_PATH.name
            spec_path = temp / SPEC_PATH.name
            registry_path.write_bytes(REGISTRY_PATH.read_bytes())
            spec_path.write_bytes(SPEC_PATH.read_bytes())
            card_path.write_bytes(self.card.replace(b"owner$1k=NO", b"owner$1k=YES"))
            with pytest.raises(rt.ContractError):
                rt._verify_files(
                    registry_path,
                    card_path,
                    ROOT,
                    spec_path,
                    RUN_PATH,
                )
