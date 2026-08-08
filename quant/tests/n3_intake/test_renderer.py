from __future__ import annotations

from dataclasses import replace
from typing import cast

import pytest

from quant_edge.canonical import parse_canonical_object
from quant_edge.errors import ContractValueError
from quant_edge.lake.contracts import DigestV1
from quant_edge.n3_intake.contracts import (
    PACKET_ROLE_ORDER,
    AcceptanceState,
    ArtifactPinV1,
    ArtifactRole,
    CandidateAssessmentV1,
    DecisionState,
    GitOidV1,
    IntakeDecisionV1,
    MetricState,
    MetricV1,
    PacketRole,
    _derive_intake_decision,
)
from quant_edge.n3_intake.renderer import decision_to_canonical_bytes, render_fable5

JsonObject = dict[str, object]


def _digest(prefix: str, suffix: str) -> DigestV1:
    return DigestV1(prefix * 60 + suffix)


def _assessment(
    role: PacketRole,
    status: DecisionState,
    raw_prefix: str,
    raw_suffix: str,
    semantic_prefix: str,
    semantic_suffix: str,
) -> CandidateAssessmentV1:
    positive_metric = MetricV1(state=MetricState.MEASURED, value=1_250_000)
    drawdown = MetricV1(state=MetricState.MEASURED, value=2_500)
    source_reason_codes: tuple[str, ...]
    if status is DecisionState.UNKNOWN:
        unknown_metric = MetricV1(state=MetricState.UNKNOWN, value=None)
        net = unknown_metric
        holdout_lower_bound = unknown_metric
        stress_net = unknown_metric
        capacity_usd = unknown_metric
        drawdown = unknown_metric
        reason_codes = ("REQUIRED_FACT_UNKNOWN",)
        source_reason_codes = ("SOURCE_EVIDENCE_UNMEASURED",)
    elif status is DecisionState.NO_GO:
        net = MetricV1(state=MetricState.MEASURED, value=0)
        holdout_lower_bound = positive_metric
        stress_net = positive_metric
        capacity_usd = positive_metric
        reason_codes = ("NET_BELOW_MINIMUM",)
        source_reason_codes = ("SOURCE_NET_BELOW_MINIMUM",)
    else:
        net = positive_metric
        holdout_lower_bound = positive_metric
        stress_net = positive_metric
        capacity_usd = positive_metric
        reason_codes = ("ALL_REQUIRED_GATES_PASS",)
        source_reason_codes = ()
    return CandidateAssessmentV1(
        role=role,
        family_id=f"F_{role.value}",
        candidate_id=f"C_{role.value}",
        status=status,
        reason_codes=reason_codes,
        source_reason_codes=source_reason_codes,
        raw_sha256=_digest(raw_prefix, raw_suffix),
        semantic_sha256=_digest(semantic_prefix, semantic_suffix),
        net=net,
        holdout_lower_bound=holdout_lower_bound,
        stress_net=stress_net,
        capacity_usd=capacity_usd,
        max_drawdown_bps=drawdown,
    )


def _pin(
    *,
    role: ArtifactRole,
    raw_sha256: DigestV1,
    ordinal: int,
    acceptance: AcceptanceState,
) -> ArtifactPinV1:
    acceptance_sha256 = (
        _digest("d", f"{ordinal:04x}") if acceptance is AcceptanceState.ACCEPTED else None
    )
    return ArtifactPinV1(
        role=role,
        raw_sha256=raw_sha256,
        byte_length=1_000 + ordinal,
        producer_commit=GitOidV1(f"{ordinal:x}" * 40),
        producer_tree=GitOidV1(f"{ordinal + 6:x}" * 40),
        relative_path=f"quant/research/n3i1/receipts/{role.value.lower()}.json",
        acceptance=acceptance,
        acceptance_sha256=acceptance_sha256,
    )


def _decision() -> IntakeDecisionV1:
    assessments = (
        _assessment(
            PacketRole.E1,
            DecisionState.VERIFIED_POSITIVE,
            "0",
            "5001",
            "1",
            "6001",
        ),
        _assessment(
            PacketRole.VE1,
            DecisionState.NO_GO,
            "2",
            "5002",
            "3",
            "6002",
        ),
        _assessment(
            PacketRole.S1C,
            DecisionState.UNKNOWN,
            "4",
            "5003",
            "5",
            "6003",
        ),
        _assessment(
            PacketRole.S1D,
            DecisionState.NO_GO,
            "6",
            "5004",
            "7",
            "6004",
        ),
        _assessment(
            PacketRole.S1E,
            DecisionState.VERIFIED_POSITIVE,
            "8",
            "5005",
            "9",
            "6005",
        ),
    )
    registry_raw_sha256 = _digest("a", "a1b2")
    registry_pin = _pin(
        role=ArtifactRole.S_META1,
        raw_sha256=registry_raw_sha256,
        ordinal=1,
        acceptance=AcceptanceState.PENDING,
    )
    result_pins = tuple(
        _pin(
            role=ArtifactRole(assessment.role.value),
            raw_sha256=assessment.raw_sha256,
            ordinal=index,
            acceptance=(
                AcceptanceState.PENDING
                if assessment.role is PacketRole.S1C
                else AcceptanceState.ACCEPTED
            ),
        )
        for index, assessment in enumerate(assessments, start=2)
    )
    return _derive_intake_decision(
        registry_raw_sha256=registry_raw_sha256,
        registry_semantic_sha256=_digest("b", "c3d4"),
        registry_pin=registry_pin,
        result_pins=result_pins,
        status=DecisionState.UNKNOWN,
        reason_codes=(
            "REGISTRY_ACCEPTANCE_PENDING",
            "S1C_ACCEPTANCE_PENDING",
            "S1C_ASSESSMENT_UNKNOWN",
        ),
        assessments=assessments,
        credible_positive_count=None,
    )


def _pin_mapping(pin: ArtifactPinV1) -> JsonObject:
    return {
        "acceptanceSha256": (
            None if pin.acceptance_sha256 is None else pin.acceptance_sha256.hexdigest
        ),
        "acceptanceState": pin.acceptance.value,
        "byteLength": pin.byte_length,
        "producerCommit": pin.producer_commit.hexdigest,
        "producerTree": pin.producer_tree.hexdigest,
        "rawSha256": pin.raw_sha256.hexdigest,
        "relativePath": pin.relative_path,
        "role": pin.role.value,
    }


def _full_hashes(decision: IntakeDecisionV1) -> tuple[str, ...]:
    return (
        decision.registry_raw_sha256.hexdigest,
        decision.registry_semantic_sha256.hexdigest,
        *(assessment.raw_sha256.hexdigest for assessment in decision.assessments),
        *(assessment.semantic_sha256.hexdigest for assessment in decision.assessments),
    )


def test_fable5_row_is_ordered_bounded_and_receipt_safe() -> None:
    decision = _decision()

    first = render_fable5(decision)
    second = render_fable5(decision)

    assert first == second
    assert "\n" not in first
    assert first.startswith("- item=`N3-I1 EDGE-VERDICT INTAKE` | expected=`strict custody+")
    assert "S-META1+E1/VE1/S1C/S1D/S1E+trial/multiplicity/fee/cost/" in first
    assert "roleCount=5" in first
    assert "assessmentCounts=VERIFIED_POSITIVE:0,NO_GO:0,UNKNOWN:5" in first
    assert "crediblePositiveCount=null; authority=NONE" in first
    assert first.endswith("| status=`UNKNOWN`")

    role_tokens = (
        "roles=E1:UNKNOWN:",
        ",VE1:UNKNOWN:",
        ",S1C:UNKNOWN:",
        ",S1D:UNKNOWN:",
        ",S1E:UNKNOWN:",
    )
    offsets = tuple(first.index(token) for token in role_tokens)
    assert offsets == tuple(sorted(offsets))

    for full_hash in _full_hashes(decision):
        assert full_hash not in first
        assert f"…{full_hash[-4:]}" in first

    for pin in (decision.registry_pin, *decision.result_pins):
        assert pin.producer_commit.hexdigest not in first
        assert pin.producer_tree.hexdigest not in first
        assert pin.relative_path not in first
        if pin.acceptance_sha256 is not None:
            assert pin.acceptance_sha256.hexdigest not in first
    assert "PENDING" not in first
    assert "ACCEPTED" not in first


def test_machine_bytes_preserve_full_receipts_unknown_nulls_and_source_reasons() -> None:
    decision = _decision()

    first = decision_to_canonical_bytes(decision)
    second = decision_to_canonical_bytes(decision)

    assert first == second
    assert first.endswith(b"\n")
    assert all(full_hash.encode() in first for full_hash in _full_hashes(decision))

    payload = parse_canonical_object(first)
    assert payload["authority"] == "NONE"
    assert payload["crediblePositiveCount"] is None
    assert payload["registryPin"] == _pin_mapping(decision.registry_pin)
    assert payload["registryRawSha256"] == decision.registry_pin.raw_sha256.hexdigest

    registry_pin = cast(JsonObject, payload["registryPin"])
    assert registry_pin["acceptanceState"] == "PENDING"
    assert registry_pin["acceptanceSha256"] is None

    result_pin_values = payload["resultPins"]
    assert isinstance(result_pin_values, list)
    assert result_pin_values == [_pin_mapping(pin) for pin in decision.result_pins]
    assert [cast(JsonObject, value)["role"] for value in result_pin_values] == [
        role.value for role in PACKET_ROLE_ORDER
    ]
    pending_result_pin = cast(JsonObject, result_pin_values[2])
    assert pending_result_pin["role"] == "S1C"
    assert pending_result_pin["acceptanceState"] == "PENDING"
    assert pending_result_pin["acceptanceSha256"] is None
    for result_pin in (
        cast(JsonObject, value) for index, value in enumerate(result_pin_values) if index != 2
    ):
        assert result_pin["acceptanceState"] == "ACCEPTED"
        assert isinstance(result_pin["acceptanceSha256"], str)

    assessment_values = payload["assessments"]
    assert isinstance(assessment_values, list)
    assessments = [cast(JsonObject, value) for value in assessment_values]
    assert [assessment["role"] for assessment in assessments] == [
        role.value for role in PACKET_ROLE_ORDER
    ]
    assert [assessment["sourceReasonCodes"] for assessment in assessments] == [
        [],
        ["SOURCE_NET_BELOW_MINIMUM"],
        ["SOURCE_EVIDENCE_UNMEASURED"],
        ["SOURCE_NET_BELOW_MINIMUM"],
        [],
    ]
    unknown = assessments[2]
    for field in (
        "net",
        "holdoutLowerBound",
        "stressNet",
        "capacityUsd",
        "maxDrawdownBps",
    ):
        assert unknown[field] == {"state": "UNKNOWN", "value": None}


def test_direct_unsealed_decision_construction_is_rejected() -> None:
    decision = _decision()

    with pytest.raises(ContractValueError, match="engine-derived"):
        IntakeDecisionV1(
            registry_raw_sha256=decision.registry_raw_sha256,
            registry_semantic_sha256=decision.registry_semantic_sha256,
            registry_pin=decision.registry_pin,
            result_pins=decision.result_pins,
            status=decision.status,
            reason_codes=decision.reason_codes,
            assessments=decision.assessments,
            credible_positive_count=decision.credible_positive_count,
            authority="NONE",
        )

    with pytest.raises(ContractValueError, match="engine-derived"):
        replace(
            decision,
            registry_semantic_sha256=DigestV1("f" * 64),
        )
