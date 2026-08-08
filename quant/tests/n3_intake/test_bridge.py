from __future__ import annotations

import hashlib
import json
from dataclasses import fields, replace
from pathlib import Path
from typing import cast

import pytest

from quant_edge.canonical import canonical_json_bytes
from quant_edge.errors import ContractValueError
from quant_edge.lake.contracts import DigestV1
from quant_edge.n3_intake import (
    adapt_smeta1_n3_bridge,
    bridge_to_canonical_bytes,
    render_bridge_fable5,
)
from quant_edge.n3_intake.bridge import BridgeCustodyState, SMeta1N3BridgeV1
from quant_edge.n3_intake.contracts import DecisionState, PacketRole

BRIDGE_PATH = Path(__file__).resolve().parent / "fixtures" / "smeta1_n3_bridge.v1.json"

FAMILY_IDS = (
    "F01_BASIS_TRIGGER_HOLD",
    "F02_VOLUME_PROXY_THRESHOLD",
    "F03_SPOT_PMA_TREND",
    "F04_USDM_POST_FUNDING_CROWD_UNWIND",
    "F05_VOLUME_ACCEPTED_EXIT_REPLAY",
    "F06_USDM_FUNDING_DISPERSION",
    "F07_SPOT_LIQUIDITY_SHOCK_REVERSAL",
)
ROLE_FAMILIES = (
    (PacketRole.E1, "F01_BASIS_TRIGGER_HOLD"),
    (PacketRole.VE1, "F05_VOLUME_ACCEPTED_EXIT_REPLAY"),
    (PacketRole.S1C, "F04_USDM_POST_FUNDING_CROWD_UNWIND"),
    (PacketRole.S1D, "F06_USDM_FUNDING_DISPERSION"),
    (PacketRole.S1E, "F07_SPOT_LIQUIDITY_SHOCK_REVERSAL"),
)


def _raw() -> bytes:
    return BRIDGE_PATH.read_bytes()


def _body() -> dict[str, object]:
    parsed = json.loads(_raw())
    assert type(parsed) is dict
    return cast(dict[str, object], parsed)


def _objects(value: object) -> list[dict[str, object]]:
    assert type(value) is list
    result = cast(list[object], value)
    assert all(type(item) is dict for item in result)
    return cast(list[dict[str, object]], result)


def _object(value: object) -> dict[str, object]:
    assert type(value) is dict
    return cast(dict[str, object], value)


def test_bridge_maps_exact_five_roles_inside_seven_family_universe() -> None:
    bridge = adapt_smeta1_n3_bridge(_raw())

    assert tuple(item.family_id for item in bridge.family_universe) == FAMILY_IDS
    assert tuple((item.role, item.family_id) for item in bridge.role_bindings) == ROLE_FAMILIES
    assert tuple(item.attempted_hypothesis_count for item in bridge.family_universe) == (
        2_976,
        162,
        1,
        24,
        1,
        None,
        None,
    )
    assert all(
        (item.effective_p_numerator, item.effective_p_denominator) == (1, 1)
        for item in bridge.family_universe
    )
    assert tuple(item.positive_eligible for item in bridge.family_universe) == (
        False,
        False,
        False,
        True,
        True,
        True,
        True,
    )


def test_bridge_binds_exact_published_custody_without_promoting_gaps() -> None:
    bridge = adapt_smeta1_n3_bridge(_raw())
    body = _body()
    registry = _object(body["registryBinding"])
    registry_artifact = _object(registry["registryArtifact"])
    roles = _objects(body["roleBindings"])

    assert registry_artifact == {
        "byteLength": 21_572,
        "gitBlob": "8d0f9bdf05b0a74641828002293a12ab5bd79097",
        "parentCommit": "a169b123fb186d1943a75ad648552c4d95be1be1",
        "path": "quant/registry/smeta1_profitability_evidence_registry.v1.json",
        "producerCommit": "1fb305a7a57724a6904d624894d8e620db19b636",
        "producerTree": "e1c6c1c4a7cff468229cdd8a54020e456b6c3718",
        "rawSha256": ("d51fd2d7f91a4f8087afdcf8131b735e682d42d525d8967a8d556ed15f5b32c4"),
    }
    assert tuple(item.custody_state for item in bridge.role_bindings) == (
        BridgeCustodyState.ACCEPTED_RECEIPT_ONLY,
        BridgeCustodyState.ACCEPTED_EXACT,
        BridgeCustodyState.ACCEPTED_EXACT,
        BridgeCustodyState.ACCEPTED_EXACT,
        BridgeCustodyState.ACCEPTED_VIA_F15_COMPOSITE,
    )
    assert (
        _object(cast(dict[str, object], roles[1]["resultArtifact"]))["producerCommit"]
        == "9017cda8b20dddf5e415bddb965a904ef1286893"
    )
    assert (
        _object(cast(dict[str, object], roles[3]["resultArtifact"]))["producerCommit"]
        == "8f98b3cd30aaf5cad46a16214f5e5808216bc4e5"
    )
    assert (
        _object(cast(dict[str, object], roles[4]["compositeAcceptance"]))["producerCommit"]
        == "9f0e73df14cf46f4447a607bbd35a916048fd52a"
    )
    assert (
        _object(cast(dict[str, object], roles[4]["acceptanceReceipt"]))["decision"]
        == "ACCEPTED_F15"
    )


def test_s1c_binds_the_exact_accepted_native_result_and_supporting_pins() -> None:
    body = _body()
    s1c = _objects(body["roleBindings"])[2]
    receipt = _object(s1c["acceptanceReceipt"])
    result = _object(s1c["resultArtifact"])
    facts = _object(s1c["acceptedFacts"])
    evidence = _objects(s1c["acceptedEvidence"])

    assert receipt == {
        "authority": "ORCHESTRATOR_RUN_MD",
        "decision": "ACCEPTED_SOURCE_ONLY",
        "recordId": "2026-07-29 ORCHESTRATOR S-1C ACCEPTANCE",
        "rowSha256": "14f5be79c56e561c7a157e2713f61e8ded131f278386c01f08d51ae031ec3c49",
        "schema": "FABLE5_ACCEPTANCE_ROW_V1",
    }
    assert result == {
        "byteLength": 78_197,
        "gitBlob": "350ab3f43c792c04f26c1da52c707daa4fa7f4ca",
        "parentCommit": "a169b123fb186d1943a75ad648552c4d95be1be1",
        "path": "quant/generated/s1c/s1c_result_v1.json",
        "producerCommit": "fe6100eaa5b3c57a4786fceaab4122a19096deda",
        "producerTree": "430b56aca13a3a248a08700c8cc2d26fbb9038d7",
        "rawSha256": "a9f393f29f1f1bd6c680c45eea5bc8e305c3b7c33e122b094d58863ef29ee910",
    }
    assert facts == {
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
    }
    assert tuple(item["kind"] for item in evidence) == (
        "CANDIDATE_FREEZE",
        "CANDIDATE_FREEZE_SHA256",
        "RESULT_SHA256",
        "SOURCE_MANIFEST",
        "SOURCE_MANIFEST_SEAL",
        "SOURCE_MANIFEST_SHA256",
    )
    freeze = _object(evidence[0]["artifact"])
    manifest = _object(evidence[3]["artifact"])
    assert (freeze["gitBlob"], freeze["byteLength"], freeze["rawSha256"]) == (
        "5ef9536f0211a17c9391d62d1047b8fc88a94933",
        727,
        "4b11c4b5fcefbc9815e3d98242141dfa1175093a2fd7b83a622076c54408830e",
    )
    assert (manifest["gitBlob"], manifest["byteLength"], manifest["rawSha256"]) == (
        "e45ef5a29db9dcec24a2b4d3261b6a0fd28ec50f",
        32_252_961,
        "1b2d00a58027dd154f02f96870c49a221d6af8d5d8ff260076d4754371dc8f4c",
    )
    assert s1c["custodyState"] == "ACCEPTED_EXACT"
    assert s1c["methodHarness"] is None
    assert s1c["compositeAcceptance"] is None


def test_unresolved_f06_f07_and_global_scoreboard_remain_unknown() -> None:
    bridge = adapt_smeta1_n3_bridge(_raw())
    unresolved = bridge.family_universe[-2:]

    assert tuple(item.attempted_hypothesis_count for item in unresolved) == (None, None)
    assert tuple(item.minimum_attempted_hypothesis_count for item in unresolved) == (1, 1)
    assert all(
        (item.effective_p_numerator, item.effective_p_denominator) == (1, 1)
        and item.positive_eligible is True
        for item in unresolved
    )
    assert bridge.decision_state is DecisionState.UNKNOWN
    assert bridge.credible_positive_count is None
    assert bridge.observed_credible_positive_subsets == 0
    assert bridge.scoreboard_reason_codes == (
        "ACCOUNT_EFFECTIVE_FEES_UNKNOWN",
        "E1_RESULT_PACKET_GIT_BLOB_UNAVAILABLE",
        "F06_F07_ATTEMPT_COUNTS_UNKNOWN",
        "HOLDOUT_UNOPENED",
        "REQUIRED_EVIDENCE_INCOMPLETE",
        "S1E_NO_STANDALONE_ACCEPTANCE",
        "VE1_ECONOMICS_NOT_ESTIMABLE",
    )
    assert bridge.fixture_only is False
    assert bridge.current_verdict == "UNKNOWN"
    assert bridge.positive_edge_claim == "NOT_MADE"
    assert bridge.profitability_state == "UNKNOWN"
    assert bridge.recommendation == "NONE"
    assert bridge.authority == "NONE"


@pytest.mark.parametrize(
    "case",
    [
        "registry_raw",
        "registry_commit",
        "registry_tree",
        "registry_path",
        "registry_size",
        "acceptance_receipt",
        "missing_f02",
        "missing_f03",
        "swapped_role",
        "s1c_artifact",
        "s1c_acceptance",
        "s1c_commit",
        "s1c_tree",
        "s1c_parent",
        "s1c_path",
        "s1c_blob",
        "s1c_size",
        "s1c_raw",
        "s1c_facts",
        "s1c_manifest",
        "f06_count",
        "f07_p",
        "f07_eligibility",
        "scoreboard_verdict",
        "scoreboard_observed_positive",
        "scoreboard_positive_claim",
        "scoreboard_authority",
        "scoreboard_fixture_only",
        "scoreboard_reason",
    ],
)
def test_bridge_rejects_hostile_identity_and_truth_mutations(case: str) -> None:
    body = _body()
    registry = _object(body["registryBinding"])
    registry_artifact = _object(registry["registryArtifact"])
    families = _objects(body["familyUniverse"])
    roles = _objects(body["roleBindings"])

    if case == "registry_raw":
        registry_artifact["rawSha256"] = "0" * 64
    elif case == "registry_commit":
        registry_artifact["producerCommit"] = "0" * 40
    elif case == "registry_tree":
        registry_artifact["producerTree"] = "0" * 40
    elif case == "registry_path":
        registry_artifact["path"] = "quant/registry/other.json"
    elif case == "registry_size":
        registry_artifact["byteLength"] = 21_573
    elif case == "acceptance_receipt":
        _object(registry["acceptanceReceipt"])["rowSha256"] = "0" * 64
    elif case == "missing_f02":
        del families[1]
    elif case == "missing_f03":
        del families[2]
    elif case == "swapped_role":
        roles[0]["familyId"] = "F05_VOLUME_ACCEPTED_EXIT_REPLAY"
    elif case == "s1c_artifact":
        roles[2]["resultArtifact"] = {"rawSha256": "0" * 64}
    elif case == "s1c_acceptance":
        roles[2]["acceptanceReceipt"] = {
            "authority": "ORCHESTRATOR_RUN_MD",
            "decision": "ACCEPTED",
            "recordId": "forged",
            "rowSha256": "0" * 64,
            "schema": "FABLE5_ACCEPTANCE_ROW_V1",
        }
    elif case == "s1c_commit":
        _object(roles[2]["resultArtifact"])["producerCommit"] = "0" * 40
    elif case == "s1c_tree":
        _object(roles[2]["resultArtifact"])["producerTree"] = "0" * 40
    elif case == "s1c_parent":
        _object(roles[2]["resultArtifact"])["parentCommit"] = "0" * 40
    elif case == "s1c_path":
        _object(roles[2]["resultArtifact"])["path"] = "quant/generated/s1c/other.json"
    elif case == "s1c_blob":
        _object(roles[2]["resultArtifact"])["gitBlob"] = "0" * 40
    elif case == "s1c_size":
        _object(roles[2]["resultArtifact"])["byteLength"] = 78_198
    elif case == "s1c_raw":
        _object(roles[2]["resultArtifact"])["rawSha256"] = "0" * 64
    elif case == "s1c_facts":
        _object(roles[2]["acceptedFacts"])["crediblePositiveSubsets"] = 1
    elif case == "s1c_manifest":
        evidence = _objects(roles[2]["acceptedEvidence"])
        _object(evidence[3]["artifact"])["rawSha256"] = "0" * 64
    elif case == "f06_count":
        families[5]["attemptedHypothesisCount"] = 1
    elif case == "f07_p":
        _object(families[6]["effectiveFamilyP"])["denominator"] = 2
    elif case == "f07_eligibility":
        families[6]["positiveEligible"] = False
    elif case == "scoreboard_verdict":
        body["currentVerdict"] = "VERIFIED_POSITIVE"
    elif case == "scoreboard_observed_positive":
        body["observedCrediblePositiveSubsets"] = 1
    elif case == "scoreboard_positive_claim":
        body["positiveEdgeClaim"] = "MADE"
    elif case == "scoreboard_authority":
        body["authority"] = "CAPITAL"
    elif case == "scoreboard_fixture_only":
        body["fixtureOnly"] = True
    elif case == "scoreboard_reason":
        cast(list[object], body["scoreboardReasonCodes"]).pop()
    else:
        raise AssertionError(f"unhandled case: {case}")

    with pytest.raises(ContractValueError):
        adapt_smeta1_n3_bridge(canonical_json_bytes(body))


def test_bridge_machine_receipt_and_fable5_are_deterministic_and_safe() -> None:
    first = adapt_smeta1_n3_bridge(_raw())
    second = adapt_smeta1_n3_bridge(_raw())
    first_machine = bridge_to_canonical_bytes(first)
    second_machine = bridge_to_canonical_bytes(second)
    first_row = render_bridge_fable5(first)
    second_row = render_bridge_fable5(second)

    assert first_machine == second_machine
    assert first_row == second_row
    assert first.raw_sha256.hexdigest == hashlib.sha256(_raw()).hexdigest()
    assert first.raw_sha256.hexdigest == (
        "5304990b92578750bfb861049e30307146432a83c6c9d0fe7625a5bff1918aad"
    )
    assert hashlib.sha256(first_machine).hexdigest() == (
        "d4e244da39d6b78455b59ef34e060aaeb12635e4a9c8c0e1e7a9743cf28ea92c"
    )
    machine = json.loads(first_machine)
    assert machine["schema"] == "SMeta1N3BridgeReceiptV1"
    assert machine["bridge"]["decisionState"] == "UNKNOWN"
    assert machine["bridge"]["crediblePositiveCount"] is None
    assert machine["bridge"]["observedCrediblePositiveSubsets"] == 0
    assert machine["bridge"]["fixtureOnly"] is False
    assert machine["bridge"]["currentVerdict"] == "UNKNOWN"
    assert machine["bridge"]["positiveEdgeClaim"] == "NOT_MADE"
    assert machine["bridge"]["profitabilityState"] == "UNKNOWN"
    assert machine["bridge"]["recommendation"] == "NONE"
    assert machine["bridge"]["authority"] == "NONE"

    assert "families=7" in first_row
    assert "S1C:ACCEPTED_EXACT" in first_row
    assert "F06/F07=count:null,p=1" in first_row
    assert "S1C-local=NO_GO" in first_row
    assert "observedCrediblePositiveSubsets=0" in first_row
    assert "scoreboard=UNKNOWN" in first_row
    assert "profitability=UNKNOWN" in first_row
    assert "positiveEdgeClaim=NOT_MADE" in first_row
    assert "recommendation=NONE" in first_row
    assert "authority=NONE" in first_row
    assert "\n" not in first_row
    assert first_row == (
        "- item=`N3-I1 S-META1→N3 SCOREBOARD` | "
        "expected=`accepted S-META1 + full five-role custody + current verdict` | "
        "found=`bridge=raw…8aad:semantic…1ca6; registry=raw…32c4; families=7; "
        "roles=E1:ACCEPTED_RECEIPT_ONLY,VE1:ACCEPTED_EXACT,S1C:ACCEPTED_EXACT,"
        "S1D:ACCEPTED_EXACT,S1E:ACCEPTED_VIA_F15_COMPOSITE; "
        "F06/F07=count:null,p=1; S1C-local=NO_GO; "
        "observedCrediblePositiveSubsets=0; scoreboard=UNKNOWN; "
        "profitability=UNKNOWN; crediblePositiveCount=null; fixtureOnly=false; "
        "positiveEdgeClaim=NOT_MADE; recommendation=NONE; authority=NONE` | "
        "status=`SCOREBOARD_READY; GLOBAL_VERDICT_UNKNOWN; NO_VERIFIED_POSITIVE_EDGE`"
    )
    for forbidden in (
        "1fb305a7a57724a6904d624894d8e620db19b636",
        "quant/registry/",
        "9017cda8b20dddf5e415bddb965a904ef1286893",
        "fe6100eaa5b3c57a4786fceaab4122a19096deda",
        "quant/generated/s1c/",
    ):
        assert forbidden not in first_row


def test_bridge_rejects_dataclass_digest_replacement() -> None:
    bridge = adapt_smeta1_n3_bridge(_raw())

    with pytest.raises(ContractValueError, match="frozen canonical bridge"):
        replace(bridge, raw_sha256=DigestV1("0" * 64))
    with pytest.raises(ContractValueError, match="frozen canonical bridge"):
        replace(bridge, semantic_sha256=DigestV1("1" * 64))
    with pytest.raises(ContractValueError, match="scoreboard verdict"):
        replace(bridge, current_verdict="VERIFIED_POSITIVE")
    with pytest.raises(ContractValueError, match="credible-positive subsets"):
        replace(bridge, observed_credible_positive_subsets=1)
    with pytest.raises(ContractValueError, match="credible-positive subsets"):
        replace(bridge, observed_credible_positive_subsets=cast(int, False))
    with pytest.raises(ContractValueError, match="authority"):
        replace(bridge, authority="CAPITAL")
    with pytest.raises(ContractValueError, match="exact PacketRole"):
        replace(bridge.role_bindings[0], role=cast(PacketRole, "E1"))
    with pytest.raises(ContractValueError, match="custody state"):
        replace(
            bridge.role_bindings[0],
            custody_state=cast(BridgeCustodyState, "ACCEPTED_RECEIPT_ONLY"),
        )
    with pytest.raises(ContractValueError, match="exact integer"):
        replace(bridge.family_universe[0], effective_p_numerator=cast(int, True))


def test_renderer_revalidates_crafted_inner_types_before_projection() -> None:
    bridge = adapt_smeta1_n3_bridge(_raw())
    crafted_binding = replace(bridge.role_bindings[0])
    object.__setattr__(crafted_binding, "role", "E1")
    crafted_bridge = object.__new__(SMeta1N3BridgeV1)
    for field in fields(bridge):
        object.__setattr__(crafted_bridge, field.name, getattr(bridge, field.name))
    object.__setattr__(
        crafted_bridge,
        "role_bindings",
        (crafted_binding, *bridge.role_bindings[1:]),
    )

    with pytest.raises(ContractValueError, match="exact PacketRole"):
        render_bridge_fable5(crafted_bridge)
    with pytest.raises(ContractValueError, match="exact PacketRole"):
        bridge_to_canonical_bytes(crafted_bridge)


def test_bridge_rejects_noncanonical_and_nonbyte_input() -> None:
    with pytest.raises(ContractValueError):
        adapt_smeta1_n3_bridge(cast(bytes, "not-bytes"))
    with pytest.raises(ContractValueError):
        adapt_smeta1_n3_bridge(_raw().rstrip(b"\n"))
