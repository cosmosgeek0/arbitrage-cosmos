"""Exact accepted-evidence S-META1 to N3 bridge and scoreboard.

The bridge is deliberately separate from the synthetic N3 decision evaluator.
It binds accepted publication identities and producer-native result facts
without coercing those bytes into the fixture-only evaluator schema.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from enum import StrEnum
from typing import Final

from quant_edge.canonical import canonical_json_bytes, parse_canonical_object
from quant_edge.errors import CanonicalJsonError, ContractValueError
from quant_edge.lake.contracts import DigestV1
from quant_edge.n3_intake.canonical import semantic_digest
from quant_edge.n3_intake.contracts import MAX_DOCUMENT_BYTES, DecisionState, PacketRole

_BRIDGE_TOKEN: Final = object()
_BRIDGE_DOMAIN: Final = "BRIDGE:S_META1_TO_N3"
_BRIDGE_RAW_SHA256: Final = "5304990b92578750bfb861049e30307146432a83c6c9d0fe7625a5bff1918aad"
_BRIDGE_SEMANTIC_SHA256: Final = "432d4805920b586d5b549a95f480983068e4ea634ef70ad2f3c3c79e75fb1ca6"
_REGISTRY_RAW_SHA256: Final = "d51fd2d7f91a4f8087afdcf8131b735e682d42d525d8967a8d556ed15f5b32c4"


class BridgeCustodyState(StrEnum):
    """Publication/custody state without verdict semantics."""

    ACCEPTED_RECEIPT_ONLY = "ACCEPTED_RECEIPT_ONLY"
    ACCEPTED_EXACT = "ACCEPTED_EXACT"
    PENDING = "PENDING"
    ACCEPTED_VIA_F15_COMPOSITE = "ACCEPTED_VIA_F15_COMPOSITE"


@dataclass(frozen=True, slots=True)
class BridgeFamilyV1:
    """One immutable member of the seven-family Holm universe."""

    family_id: str
    attempted_hypothesis_count: int | None
    minimum_attempted_hypothesis_count: int
    effective_p_numerator: int
    effective_p_denominator: int
    positive_eligible: bool

    def __post_init__(self) -> None:
        if type(self.family_id) is not str:
            raise ContractValueError("bridge family id must be an exact string")
        if (
            self.attempted_hypothesis_count is not None
            and type(self.attempted_hypothesis_count) is not int
        ):
            raise ContractValueError("bridge attempted count must be an exact integer or null")
        for field_name in (
            "minimum_attempted_hypothesis_count",
            "effective_p_numerator",
            "effective_p_denominator",
        ):
            if type(getattr(self, field_name)) is not int:
                raise ContractValueError(f"bridge family {field_name} must be an exact integer")
        if type(self.positive_eligible) is not bool:
            raise ContractValueError("bridge family positive eligibility must be an exact boolean")


@dataclass(frozen=True, slots=True)
class BridgeRoleBindingV1:
    """One N3 role mapped to its exact S-META1 family."""

    role: PacketRole
    family_id: str
    custody_state: BridgeCustodyState

    def __post_init__(self) -> None:
        if type(self.role) is not PacketRole:
            raise ContractValueError("bridge role must be an exact PacketRole")
        if type(self.family_id) is not str:
            raise ContractValueError("bridge role family id must be an exact string")
        if type(self.custody_state) is not BridgeCustodyState:
            raise ContractValueError("bridge custody state must be exact")


@dataclass(frozen=True, slots=True)
class SMeta1N3BridgeV1:
    """Validated frozen bridge; construction is adapter-only."""

    raw_sha256: DigestV1
    semantic_sha256: DigestV1
    family_universe: tuple[BridgeFamilyV1, ...]
    role_bindings: tuple[BridgeRoleBindingV1, ...]
    decision_state: DecisionState
    credible_positive_count: None
    observed_credible_positive_subsets: int
    scoreboard_reason_codes: tuple[str, ...]
    fixture_only: bool
    current_verdict: str
    positive_edge_claim: str
    profitability_state: str
    recommendation: str
    authority: str
    _token: object

    def __post_init__(self) -> None:
        if self._token is not _BRIDGE_TOKEN:
            raise ContractValueError("S-META1 bridge construction is adapter-only")
        if type(self.raw_sha256) is not DigestV1 or type(self.semantic_sha256) is not DigestV1:
            raise ContractValueError("bridge hashes must be DigestV1 values")
        if (
            self.raw_sha256.hexdigest != _BRIDGE_RAW_SHA256
            or self.semantic_sha256.hexdigest != _BRIDGE_SEMANTIC_SHA256
        ):
            raise ContractValueError("bridge hashes differ from the frozen canonical bridge")
        if type(self.family_universe) is not tuple or any(
            type(item) is not BridgeFamilyV1 for item in self.family_universe
        ):
            raise ContractValueError("bridge family universe must contain exact family values")
        for family in self.family_universe:
            family.__post_init__()
        if self.family_universe != _FAMILY_UNIVERSE:
            raise ContractValueError("bridge family universe differs from frozen S-META1")
        if type(self.role_bindings) is not tuple or any(
            type(item) is not BridgeRoleBindingV1 for item in self.role_bindings
        ):
            raise ContractValueError("bridge role bindings must contain exact role values")
        for binding in self.role_bindings:
            binding.__post_init__()
        if self.role_bindings != _ROLE_BINDINGS:
            raise ContractValueError("bridge role bindings differ from the frozen mapping")
        if self.decision_state is not DecisionState.UNKNOWN:
            raise ContractValueError("incomplete-evidence bridge decision state must be UNKNOWN")
        if self.credible_positive_count is not None:
            raise ContractValueError("global UNKNOWN bridge credible count must be null")
        if (
            type(self.observed_credible_positive_subsets) is not int
            or self.observed_credible_positive_subsets != 0
        ):
            raise ContractValueError("accepted observed credible-positive subsets must be zero")
        if type(self.scoreboard_reason_codes) is not tuple or any(
            type(reason) is not str for reason in self.scoreboard_reason_codes
        ):
            raise ContractValueError("scoreboard reasons must be exact strings")
        if self.scoreboard_reason_codes != _SCOREBOARD_REASON_CODES:
            raise ContractValueError("scoreboard reasons differ from frozen accepted evidence")
        if self.fixture_only is not False:
            raise ContractValueError("accepted-evidence bridge must not be fixture-only")
        if type(self.current_verdict) is not str or self.current_verdict != "UNKNOWN":
            raise ContractValueError("global scoreboard verdict must remain UNKNOWN")
        if type(self.positive_edge_claim) is not str or self.positive_edge_claim != "NOT_MADE":
            raise ContractValueError("bridge must not make a positive-edge claim")
        if type(self.profitability_state) is not str or self.profitability_state != "UNKNOWN":
            raise ContractValueError("bridge profitability must remain UNKNOWN")
        if type(self.recommendation) is not str or self.recommendation != "NONE":
            raise ContractValueError("bridge recommendation must remain NONE")
        if type(self.authority) is not str or self.authority != "NONE":
            raise ContractValueError("accepted-evidence bridge authority must be NONE")


_FAMILY_UNIVERSE: Final = (
    BridgeFamilyV1(
        "F01_BASIS_TRIGGER_HOLD",
        2_976,
        2_976,
        1,
        1,
        False,
    ),
    BridgeFamilyV1(
        "F02_VOLUME_PROXY_THRESHOLD",
        162,
        162,
        1,
        1,
        False,
    ),
    BridgeFamilyV1(
        "F03_SPOT_PMA_TREND",
        1,
        1,
        1,
        1,
        False,
    ),
    BridgeFamilyV1(
        "F04_USDM_POST_FUNDING_CROWD_UNWIND",
        24,
        24,
        1,
        1,
        True,
    ),
    BridgeFamilyV1(
        "F05_VOLUME_ACCEPTED_EXIT_REPLAY",
        1,
        1,
        1,
        1,
        True,
    ),
    BridgeFamilyV1(
        "F06_USDM_FUNDING_DISPERSION",
        None,
        1,
        1,
        1,
        True,
    ),
    BridgeFamilyV1(
        "F07_SPOT_LIQUIDITY_SHOCK_REVERSAL",
        None,
        1,
        1,
        1,
        True,
    ),
)

_ROLE_BINDINGS: Final = (
    BridgeRoleBindingV1(
        PacketRole.E1,
        "F01_BASIS_TRIGGER_HOLD",
        BridgeCustodyState.ACCEPTED_RECEIPT_ONLY,
    ),
    BridgeRoleBindingV1(
        PacketRole.VE1,
        "F05_VOLUME_ACCEPTED_EXIT_REPLAY",
        BridgeCustodyState.ACCEPTED_EXACT,
    ),
    BridgeRoleBindingV1(
        PacketRole.S1C,
        "F04_USDM_POST_FUNDING_CROWD_UNWIND",
        BridgeCustodyState.ACCEPTED_EXACT,
    ),
    BridgeRoleBindingV1(
        PacketRole.S1D,
        "F06_USDM_FUNDING_DISPERSION",
        BridgeCustodyState.ACCEPTED_EXACT,
    ),
    BridgeRoleBindingV1(
        PacketRole.S1E,
        "F07_SPOT_LIQUIDITY_SHOCK_REVERSAL",
        BridgeCustodyState.ACCEPTED_VIA_F15_COMPOSITE,
    ),
)

_SCOREBOARD_REASON_CODES: Final = (
    "ACCOUNT_EFFECTIVE_FEES_UNKNOWN",
    "E1_RESULT_PACKET_GIT_BLOB_UNAVAILABLE",
    "F06_F07_ATTEMPT_COUNTS_UNKNOWN",
    "HOLDOUT_UNOPENED",
    "REQUIRED_EVIDENCE_INCOMPLETE",
    "S1E_NO_STANDALONE_ACCEPTANCE",
    "VE1_ECONOMICS_NOT_ESTIMABLE",
)


def _artifact(
    *,
    byte_length: int,
    git_blob: str,
    parent_commit: str,
    path: str,
    producer_commit: str,
    producer_tree: str,
    raw_sha256: str,
) -> dict[str, object]:
    return {
        "byteLength": byte_length,
        "gitBlob": git_blob,
        "parentCommit": parent_commit,
        "path": path,
        "producerCommit": producer_commit,
        "producerTree": producer_tree,
        "rawSha256": raw_sha256,
    }


def _named_artifact(
    *,
    byte_length: int,
    git_blob: str,
    kind: str,
    parent_commit: str,
    path: str,
    producer_commit: str,
    producer_tree: str,
    raw_sha256: str,
) -> dict[str, object]:
    return {
        "artifact": _artifact(
            byte_length=byte_length,
            git_blob=git_blob,
            parent_commit=parent_commit,
            path=path,
            producer_commit=producer_commit,
            producer_tree=producer_tree,
            raw_sha256=raw_sha256,
        ),
        "kind": kind,
    }


def _acceptance_receipt(
    *,
    decision: str,
    record_id: str,
    row_sha256: str,
) -> dict[str, object]:
    return {
        "authority": "ORCHESTRATOR_RUN_MD",
        "decision": decision,
        "recordId": record_id,
        "rowSha256": row_sha256,
        "schema": "FABLE5_ACCEPTANCE_ROW_V1",
    }


def _family(
    *,
    attempted: int | None,
    family_id: str,
    minimum_attempted: int,
    ordinal: int,
    positive_eligible: bool,
) -> dict[str, object]:
    return {
        "attemptedHypothesisCount": attempted,
        "effectiveFamilyP": {"denominator": 1, "numerator": 1},
        "familyId": family_id,
        "minimumAttemptedHypothesisCount": minimum_attempted,
        "ordinal": ordinal,
        "positiveEligible": positive_eligible,
    }


def _role(
    *,
    acceptance_receipt: dict[str, object] | None,
    accepted_evidence: list[object],
    accepted_facts: dict[str, object] | None,
    composite_acceptance: dict[str, object] | None,
    custody_state: str,
    family_id: str,
    method_harness: dict[str, object] | None,
    reason_codes: list[object],
    result_artifact: dict[str, object] | None,
    role: str,
) -> dict[str, object]:
    return {
        "acceptanceReceipt": acceptance_receipt,
        "acceptedEvidence": accepted_evidence,
        "acceptedFacts": accepted_facts,
        "compositeAcceptance": composite_acceptance,
        "custodyState": custody_state,
        "familyId": family_id,
        "methodHarness": method_harness,
        "reasonCodes": reason_codes,
        "resultArtifact": result_artifact,
        "role": role,
    }


def _expected_bridge_body() -> dict[str, object]:
    return {
        "authority": "NONE",
        "baseCommit": "a169b123fb186d1943a75ad648552c4d95be1be1",
        "bridgeId": "N3-I1-SMETA1-TO-N3",
        "crediblePositiveCount": None,
        "currentVerdict": "UNKNOWN",
        "decisionState": "UNKNOWN",
        "familyUniverse": [
            _family(
                attempted=2_976,
                family_id="F01_BASIS_TRIGGER_HOLD",
                minimum_attempted=2_976,
                ordinal=1,
                positive_eligible=False,
            ),
            _family(
                attempted=162,
                family_id="F02_VOLUME_PROXY_THRESHOLD",
                minimum_attempted=162,
                ordinal=2,
                positive_eligible=False,
            ),
            _family(
                attempted=1,
                family_id="F03_SPOT_PMA_TREND",
                minimum_attempted=1,
                ordinal=3,
                positive_eligible=False,
            ),
            _family(
                attempted=24,
                family_id="F04_USDM_POST_FUNDING_CROWD_UNWIND",
                minimum_attempted=24,
                ordinal=4,
                positive_eligible=True,
            ),
            _family(
                attempted=1,
                family_id="F05_VOLUME_ACCEPTED_EXIT_REPLAY",
                minimum_attempted=1,
                ordinal=5,
                positive_eligible=True,
            ),
            _family(
                attempted=None,
                family_id="F06_USDM_FUNDING_DISPERSION",
                minimum_attempted=1,
                ordinal=6,
                positive_eligible=True,
            ),
            _family(
                attempted=None,
                family_id="F07_SPOT_LIQUIDITY_SHOCK_REVERSAL",
                minimum_attempted=1,
                ordinal=7,
                positive_eligible=True,
            ),
        ],
        "fixtureOnly": False,
        "observedCrediblePositiveSubsets": 0,
        "positiveEdgeClaim": "NOT_MADE",
        "profitabilityState": "UNKNOWN",
        "recommendation": "NONE",
        "registryBinding": {
            "acceptanceReceipt": _acceptance_receipt(
                decision="ACCEPTED_SOURCE_ONLY",
                record_id="2026-07-29 ORCHESTRATOR S-META1 ACCEPTANCE",
                row_sha256=("2147b6c153280c792f8f76a09f4e35dabe09b2ffa11a01f45c29ef5e3715a4fd"),
            ),
            "freezeReceiptArtifact": _artifact(
                byte_length=2_775,
                git_blob="feafae7720bb3645979634c38cb2a40ffe5aa817",
                parent_commit="a169b123fb186d1943a75ad648552c4d95be1be1",
                path="quant/generated/smeta1/freeze_receipt.v1.json",
                producer_commit="1fb305a7a57724a6904d624894d8e620db19b636",
                producer_tree="e1c6c1c4a7cff468229cdd8a54020e456b6c3718",
                raw_sha256=("6963988d98db92ee5a2328e359aa601ae5ee22a981de7e05fd06949354582b01"),
            ),
            "registryArtifact": _artifact(
                byte_length=21_572,
                git_blob="8d0f9bdf05b0a74641828002293a12ab5bd79097",
                parent_commit="a169b123fb186d1943a75ad648552c4d95be1be1",
                path="quant/registry/smeta1_profitability_evidence_registry.v1.json",
                producer_commit="1fb305a7a57724a6904d624894d8e620db19b636",
                producer_tree="e1c6c1c4a7cff468229cdd8a54020e456b6c3718",
                raw_sha256=_REGISTRY_RAW_SHA256,
            ),
        },
        "roleBindings": [
            _role(
                acceptance_receipt=_acceptance_receipt(
                    decision="E-1_METHOD_CORRECTED_RAW_UNCHANGED",
                    record_id="2026-07-28 ORCHESTRATOR E-1 FINAL ACCEPTANCE",
                    row_sha256=("fc8330109e6d3aa77b7436be1504194677efee3af65cadeedae7e2f6614c62bf"),
                ),
                accepted_evidence=[
                    {
                        "byteLength": None,
                        "kind": "AUDIT_PLAN_DIGEST",
                        "rawSha256": (
                            "e7e60e1e648de1583bc925d93bfcf8c94d0e73e165a4a5fce3f7b81b9e197fca"
                        ),
                        "storageState": "ACCEPTED_DIGEST_ONLY",
                    },
                    {
                        "byteLength": None,
                        "kind": "DERIVED_LEDGER_DIGEST",
                        "rawSha256": (
                            "a2e4ef2ad8ff63f5a2cb325dec2355c1c3ab8c4ccf1025e28fc2d0810df8102f"
                        ),
                        "storageState": "ACCEPTED_DIGEST_ONLY",
                    },
                    {
                        "byteLength": 63_443,
                        "kind": "MEASUREMENT_PACKET",
                        "rawSha256": (
                            "9dbcfc8db6b420b9187330278459d597b70d9cdf938d4be566a3a6279bc68f7c"
                        ),
                        "storageState": "TEMP_PACKET_ABSENT",
                    },
                    {
                        "byteLength": 486_732,
                        "kind": "SOURCE_MANIFEST",
                        "rawSha256": (
                            "79e2544a0620e03ee09644e21a9ab563ec7eca1b699f9ea823eecef0b6a305ea"
                        ),
                        "storageState": "TEMP_PACKET_ABSENT",
                    },
                ],
                accepted_facts=None,
                composite_acceptance=None,
                custody_state="ACCEPTED_RECEIPT_ONLY",
                family_id="F01_BASIS_TRIGGER_HOLD",
                method_harness={
                    "producerCommit": "eab86ad297f4d7eaa7d647bb7da7835b748a652c",
                    "producerTree": "ca082220e9c3419db6c995657ec82ead853f175c",
                },
                reason_codes=[
                    "ACCOUNT_ACTUAL_FEE_UNKNOWN",
                    "RESULT_PACKET_GIT_BLOB_UNAVAILABLE",
                ],
                result_artifact=None,
                role="E1",
            ),
            _role(
                acceptance_receipt=_acceptance_receipt(
                    decision="ACCEPTED_EXACT_UNMEASURED",
                    record_id="2026-07-28 ORCHESTRATOR V-E1 ACCEPTANCE",
                    row_sha256=("a565dd3a3c546ec37e16cebfd286a139e00baeee62479331d40eaaae3af1f658"),
                ),
                accepted_evidence=[],
                accepted_facts=None,
                composite_acceptance=None,
                custody_state="ACCEPTED_EXACT",
                family_id="F05_VOLUME_ACCEPTED_EXIT_REPLAY",
                method_harness=None,
                reason_codes=["ECONOMICS_NOT_ESTIMABLE"],
                result_artifact=_artifact(
                    byte_length=8_865,
                    git_blob="254ccb0424af068f2c405e52b43c317713289c68",
                    parent_commit="6c8184331d85d098d2919e37d217f220f4c3214c",
                    path="quant/research/ve1/verdict.v1.json",
                    producer_commit="9017cda8b20dddf5e415bddb965a904ef1286893",
                    producer_tree="ed1353e939c0b7a73541e226df09005903b53cdb",
                    raw_sha256=("a15fa15ce3f0b1e00361c529893a50d89c1ea991e0807f820b2685489b278223"),
                ),
                role="VE1",
            ),
            _role(
                acceptance_receipt=_acceptance_receipt(
                    decision="ACCEPTED_SOURCE_ONLY",
                    record_id="2026-07-29 ORCHESTRATOR S-1C ACCEPTANCE",
                    row_sha256=("14f5be79c56e561c7a157e2713f61e8ded131f278386c01f08d51ae031ec3c49"),
                ),
                accepted_evidence=[
                    _named_artifact(
                        byte_length=727,
                        git_blob="5ef9536f0211a17c9391d62d1047b8fc88a94933",
                        kind="CANDIDATE_FREEZE",
                        parent_commit="a169b123fb186d1943a75ad648552c4d95be1be1",
                        path="quant/generated/s1c/s1c_candidate_freeze_v1.json",
                        producer_commit="fe6100eaa5b3c57a4786fceaab4122a19096deda",
                        producer_tree="430b56aca13a3a248a08700c8cc2d26fbb9038d7",
                        raw_sha256=(
                            "4b11c4b5fcefbc9815e3d98242141dfa1175093a2fd7b83a622076c54408830e"
                        ),
                    ),
                    _named_artifact(
                        byte_length=95,
                        git_blob="a07aab91f3cecdde4260a6830ac8f7d9956a79be",
                        kind="CANDIDATE_FREEZE_SHA256",
                        parent_commit="a169b123fb186d1943a75ad648552c4d95be1be1",
                        path="quant/generated/s1c/s1c_candidate_freeze_v1.json.sha256",
                        producer_commit="fe6100eaa5b3c57a4786fceaab4122a19096deda",
                        producer_tree="430b56aca13a3a248a08700c8cc2d26fbb9038d7",
                        raw_sha256=(
                            "e2d754bc1e3914fd327b626c3e780d79822f403e8cc128750e985ae2b0e46c2a"
                        ),
                    ),
                    _named_artifact(
                        byte_length=85,
                        git_blob="2a0be4919d052ab7ff4f657d15ee99d716e1cf47",
                        kind="RESULT_SHA256",
                        parent_commit="a169b123fb186d1943a75ad648552c4d95be1be1",
                        path="quant/generated/s1c/s1c_result_v1.json.sha256",
                        producer_commit="fe6100eaa5b3c57a4786fceaab4122a19096deda",
                        producer_tree="430b56aca13a3a248a08700c8cc2d26fbb9038d7",
                        raw_sha256=(
                            "c1a640301addc1149c4c383b8ee9f9137ef513258f6db6c9491653cb63950f9a"
                        ),
                    ),
                    _named_artifact(
                        byte_length=32_252_961,
                        git_blob="e45ef5a29db9dcec24a2b4d3261b6a0fd28ec50f",
                        kind="SOURCE_MANIFEST",
                        parent_commit="a169b123fb186d1943a75ad648552c4d95be1be1",
                        path="quant/generated/s1c/s1c_source_manifest_v1.json",
                        producer_commit="fe6100eaa5b3c57a4786fceaab4122a19096deda",
                        producer_tree="430b56aca13a3a248a08700c8cc2d26fbb9038d7",
                        raw_sha256=(
                            "1b2d00a58027dd154f02f96870c49a221d6af8d5d8ff260076d4754371dc8f4c"
                        ),
                    ),
                    _named_artifact(
                        byte_length=264,
                        git_blob="4189320fcacd73d4cf9830cd33e1ecaf05333212",
                        kind="SOURCE_MANIFEST_SEAL",
                        parent_commit="a169b123fb186d1943a75ad648552c4d95be1be1",
                        path="quant/generated/s1c/s1c_source_manifest_v1.json.SEALED",
                        producer_commit="fe6100eaa5b3c57a4786fceaab4122a19096deda",
                        producer_tree="430b56aca13a3a248a08700c8cc2d26fbb9038d7",
                        raw_sha256=(
                            "7a78e9a5f0d23207bc072a248bb1502a43148e2852e2baf92191fb48f74e331a"
                        ),
                    ),
                    _named_artifact(
                        byte_length=94,
                        git_blob="77386cbfb9b9963bead0091522e7da7488061a0d",
                        kind="SOURCE_MANIFEST_SHA256",
                        parent_commit="a169b123fb186d1943a75ad648552c4d95be1be1",
                        path="quant/generated/s1c/s1c_source_manifest_v1.json.sha256",
                        producer_commit="fe6100eaa5b3c57a4786fceaab4122a19096deda",
                        producer_tree="430b56aca13a3a248a08700c8cc2d26fbb9038d7",
                        raw_sha256=(
                            "2fe9c18ed34495a18cebc502320701a5007c299966ac9ec1fad8df1be4af4b16"
                        ),
                    ),
                ],
                accepted_facts={
                    "accountEffectiveFees": "UNKNOWN",
                    "baseMultiplicityLowerPositive": "FAIL",
                    "capitalAuthority": "NONE",
                    "crediblePositiveSubsets": 0,
                    "developmentSampleFloors": "FAIL",
                    "fundingRecommendation": "NONE",
                    "historicalMakerRestingAtPlacement": "UNKNOWN",
                    "holdoutState": "UNOPENED",
                    "positiveEdgeClaim": "NOT_MADE",
                    "profitability": "UNKNOWN",
                    "stressMultiplicityLowerPositive": "FAIL",
                    "verdictLabel": "NO_GO_ACCOUNT_EFFECTIVE_FEES_UNKNOWN",
                },
                composite_acceptance=None,
                custody_state="ACCEPTED_EXACT",
                family_id="F04_USDM_POST_FUNDING_CROWD_UNWIND",
                method_harness=None,
                reason_codes=[
                    "ACCOUNT_EFFECTIVE_FEES_UNKNOWN",
                    "DEVELOPMENT_MULTIPLICITY_BASE_LOWER_POSITIVE_FAIL",
                    "DEVELOPMENT_MULTIPLICITY_STRESS_LOWER_POSITIVE_FAIL",
                    "DEVELOPMENT_SAMPLE_FLOORS_FAIL",
                    "HISTORICAL_MAKER_RESTING_AT_PLACEMENT_UNKNOWN",
                    "HOLDOUT_UNOPENED",
                ],
                result_artifact=_artifact(
                    byte_length=78_197,
                    git_blob="350ab3f43c792c04f26c1da52c707daa4fa7f4ca",
                    parent_commit="a169b123fb186d1943a75ad648552c4d95be1be1",
                    path="quant/generated/s1c/s1c_result_v1.json",
                    producer_commit="fe6100eaa5b3c57a4786fceaab4122a19096deda",
                    producer_tree="430b56aca13a3a248a08700c8cc2d26fbb9038d7",
                    raw_sha256=("a9f393f29f1f1bd6c680c45eea5bc8e305c3b7c33e122b094d58863ef29ee910"),
                ),
                role="S1C",
            ),
            _role(
                acceptance_receipt=_acceptance_receipt(
                    decision="ACCEPTED_EXACT_NO_GO",
                    record_id="2026-07-28 ORCHESTRATOR S-1D ACCEPTANCE",
                    row_sha256=("7e192a0eb120684cdc8da97152864772b301b2ab8596a6ac5b4684e93e66e80a"),
                ),
                accepted_evidence=[],
                accepted_facts=None,
                composite_acceptance=None,
                custody_state="ACCEPTED_EXACT",
                family_id="F06_USDM_FUNDING_DISPERSION",
                method_harness=None,
                reason_codes=["ATTEMPT_COUNT_UNKNOWN_EFFECTIVE_P_ONE"],
                result_artifact=_artifact(
                    byte_length=6_125,
                    git_blob="830ae1be46c9120947915892f84e6992d129f0c2",
                    parent_commit="a169b123fb186d1943a75ad648552c4d95be1be1",
                    path="quant/fixtures/s1d_funding_dispersion_result_v1.json",
                    producer_commit="8f98b3cd30aaf5cad46a16214f5e5808216bc4e5",
                    producer_tree="b9bf915b323b5a76822f453c9ea1bf2ec4eece2a",
                    raw_sha256=("d73b0df24dd8eee9afe1e725e4826356fc38019336a312aa54c3b2c35124a599"),
                ),
                role="S1D",
            ),
            _role(
                acceptance_receipt=_acceptance_receipt(
                    decision="ACCEPTED_F15",
                    record_id="2026-07-29 ORCHESTRATOR F15 ACCEPTANCE",
                    row_sha256=("f14d686c9759bd6fcf789cf7cdc52bc9688cb9dfd9893fe3fa5ca533ac9b6b08"),
                ),
                accepted_evidence=[],
                accepted_facts=None,
                composite_acceptance={
                    "producerCommit": "9f0e73df14cf46f4447a607bbd35a916048fd52a",
                    "producerTree": "3ab213f03174c014e420e5d0feff5efdbecee351",
                },
                custody_state="ACCEPTED_VIA_F15_COMPOSITE",
                family_id="F07_SPOT_LIQUIDITY_SHOCK_REVERSAL",
                method_harness=None,
                reason_codes=[
                    "ATTEMPT_COUNT_UNKNOWN_EFFECTIVE_P_ONE",
                    "NO_STANDALONE_S1E_ACCEPTANCE",
                ],
                result_artifact=_artifact(
                    byte_length=3_811,
                    git_blob="441982db71c4c1c8e3d29219b907c8c3fc01290a",
                    parent_commit="a169b123fb186d1943a75ad648552c4d95be1be1",
                    path=(
                        "quant/fixtures/s1e_spot_liquidity_shock_reversal_terminal_result_v1.json"
                    ),
                    producer_commit="77e133fe8ebff3253fa158572c5fa3a1f0642dfd",
                    producer_tree="0379d68deb7ceca058827175edb8533f60728976",
                    raw_sha256=("8be49727408a19c2f9405698edc7483edfd8f31632f5dfe865bb483053bede6e"),
                ),
                role="S1E",
            ),
        ],
        "scoreboardReasonCodes": list(_SCOREBOARD_REASON_CODES),
        "schema": "SMeta1N3BridgeV1",
        "version": 1,
    }


def adapt_smeta1_n3_bridge(raw: bytes) -> SMeta1N3BridgeV1:
    """Adapt the one frozen canonical bridge without filesystem discovery."""

    if type(raw) is not bytes:
        raise ContractValueError("bridge raw value must be bytes")
    if not 1 <= len(raw) <= MAX_DOCUMENT_BYTES:
        raise ContractValueError("bridge raw bytes must contain 1..1048576 bytes")
    try:
        parsed = parse_canonical_object(raw)
    except CanonicalJsonError as error:
        raise ContractValueError("bridge raw bytes must be canonical JSON") from error
    expected = _expected_bridge_body()
    if parsed != expected:
        raise ContractValueError("bridge bytes differ from the frozen S-META1/N3 binding")
    return SMeta1N3BridgeV1(
        raw_sha256=DigestV1(hashlib.sha256(raw).hexdigest()),
        semantic_sha256=semantic_digest(_BRIDGE_DOMAIN, parsed),
        family_universe=_FAMILY_UNIVERSE,
        role_bindings=_ROLE_BINDINGS,
        decision_state=DecisionState.UNKNOWN,
        credible_positive_count=None,
        observed_credible_positive_subsets=0,
        scoreboard_reason_codes=_SCOREBOARD_REASON_CODES,
        fixture_only=False,
        current_verdict="UNKNOWN",
        positive_edge_claim="NOT_MADE",
        profitability_state="UNKNOWN",
        recommendation="NONE",
        authority="NONE",
        _token=_BRIDGE_TOKEN,
    )


def _require_bridge(bridge: object) -> SMeta1N3BridgeV1:
    if type(bridge) is not SMeta1N3BridgeV1:
        raise ContractValueError("bridge must be SMeta1N3BridgeV1")
    bridge.__post_init__()
    return bridge


def bridge_to_canonical_bytes(bridge: SMeta1N3BridgeV1) -> bytes:
    """Render the full machine-checkable bridge receipt."""

    exact = _require_bridge(bridge)
    return canonical_json_bytes(
        {
            "bridge": _expected_bridge_body(),
            "bridgeRawSha256": exact.raw_sha256.hexdigest,
            "bridgeSemanticSha256": exact.semantic_sha256.hexdigest,
            "schema": "SMeta1N3BridgeReceiptV1",
        }
    )


def render_bridge_fable5(bridge: SMeta1N3BridgeV1) -> str:
    """Render one terse owner-safe current scoreboard row."""

    exact = _require_bridge(bridge)
    roles = ",".join(
        f"{binding.role.value}:{binding.custody_state.value}" for binding in exact.role_bindings
    )
    found = (
        f"bridge=raw…{exact.raw_sha256.hexdigest[-4:]}:"
        f"semantic…{exact.semantic_sha256.hexdigest[-4:]}; "
        f"registry=raw…{_REGISTRY_RAW_SHA256[-4:]}; "
        f"families={len(exact.family_universe)}; roles={roles}; "
        "F06/F07=count:null,p=1; S1C-local=NO_GO; "
        "observedCrediblePositiveSubsets=0; scoreboard=UNKNOWN; "
        "profitability=UNKNOWN; crediblePositiveCount=null; fixtureOnly=false; "
        "positiveEdgeClaim=NOT_MADE; recommendation=NONE; authority=NONE"
    )
    return (
        "- item=`N3-I1 S-META1→N3 SCOREBOARD` | "
        "expected=`accepted S-META1 + full five-role custody + current verdict` | "
        f"found=`{found}` | "
        "status=`SCOREBOARD_READY; GLOBAL_VERDICT_UNKNOWN; NO_VERIFIED_POSITIVE_EDGE`"
    )
