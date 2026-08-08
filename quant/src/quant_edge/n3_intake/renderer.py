"""Deterministic machine and FABLE5 projections for an N3-I1 intake decision."""

from __future__ import annotations

from typing import Final

from quant_edge.canonical import canonical_json_bytes
from quant_edge.errors import ContractValueError
from quant_edge.lake.contracts import DigestV1
from quant_edge.n3_intake.contracts import (
    AcceptanceState,
    ArtifactPinV1,
    CandidateAssessmentV1,
    DecisionState,
    IntakeDecisionV1,
    MetricV1,
    PacketRole,
)

_ITEM: Final = "N3-I1 EDGE-VERDICT INTAKE"
_EXPECTED: Final = (
    "strict custody+S-META1+E1/VE1/S1C/S1D/S1E+"
    "trial/multiplicity/fee/cost/capacity/drawdown/holdout"
)
_DECISION_STATE_ORDER: Final = (
    DecisionState.VERIFIED_POSITIVE,
    DecisionState.NO_GO,
    DecisionState.UNKNOWN,
)
_PACKET_ROLE_RANK: Final = {role: index for index, role in enumerate(PacketRole)}


def _require_decision(decision: object) -> IntakeDecisionV1:
    if not isinstance(decision, IntakeDecisionV1):
        raise ContractValueError("decision must be IntakeDecisionV1")
    if decision.authority != "NONE":
        raise ContractValueError("decision authority must be NONE")
    return decision


def _ordered_assessments(
    decision: IntakeDecisionV1,
) -> tuple[CandidateAssessmentV1, ...]:
    return tuple(
        sorted(
            decision.assessments,
            key=lambda assessment: (
                _PACKET_ROLE_RANK[assessment.role],
                assessment.family_id,
                assessment.candidate_id,
            ),
        )
    )


def _digest_suffix(digest: DigestV1) -> str:
    return digest.hexdigest[-4:]


def _effective_assessment_states(
    decision: IntakeDecisionV1,
    assessments: tuple[CandidateAssessmentV1, ...],
) -> tuple[DecisionState, ...]:
    registry_accepted = decision.registry_pin.acceptance is AcceptanceState.ACCEPTED
    effective_states: list[DecisionState] = []
    for assessment, pin in zip(assessments, decision.result_pins, strict=True):
        if assessment.role.value != pin.role.value:
            raise ContractValueError("assessment and result pin roles must match")
        effective_states.append(
            assessment.status
            if registry_accepted and pin.acceptance is AcceptanceState.ACCEPTED
            else DecisionState.UNKNOWN
        )
    return tuple(effective_states)


def _metric_mapping(metric: MetricV1) -> dict[str, object]:
    return {
        "state": metric.state.value,
        "value": metric.value,
    }


def _pin_mapping(pin: ArtifactPinV1) -> dict[str, object]:
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


def decision_to_canonical_bytes(decision: IntakeDecisionV1) -> bytes:
    """Project every validated machine field with full hashes and exact metric truth."""

    exact = _require_decision(decision)
    assessments: list[dict[str, object]] = []
    for assessment in _ordered_assessments(exact):
        assessments.append(
            {
                "candidateId": assessment.candidate_id,
                "capacityUsd": _metric_mapping(assessment.capacity_usd),
                "familyId": assessment.family_id,
                "holdoutLowerBound": _metric_mapping(assessment.holdout_lower_bound),
                "maxDrawdownBps": _metric_mapping(assessment.max_drawdown_bps),
                "net": _metric_mapping(assessment.net),
                "rawSha256": assessment.raw_sha256.hexdigest,
                "reasonCodes": list(assessment.reason_codes),
                "role": assessment.role.value,
                "semanticSha256": assessment.semantic_sha256.hexdigest,
                "sourceReasonCodes": list(assessment.source_reason_codes),
                "status": assessment.status.value,
                "stressNet": _metric_mapping(assessment.stress_net),
            }
        )
    return canonical_json_bytes(
        {
            "assessments": assessments,
            "authority": exact.authority,
            "crediblePositiveCount": exact.credible_positive_count,
            "reasonCodes": list(exact.reason_codes),
            "registryPin": _pin_mapping(exact.registry_pin),
            "registryRawSha256": exact.registry_raw_sha256.hexdigest,
            "registrySemanticSha256": exact.registry_semantic_sha256.hexdigest,
            "resultPins": [_pin_mapping(pin) for pin in exact.result_pins],
            "schema": "IntakeDecisionV1",
            "status": exact.status.value,
        }
    )


def render_fable5(decision: IntakeDecisionV1) -> str:
    """Render one terse owner-safe Markdown bullet from validated machine fields only."""

    exact = _require_decision(decision)
    assessments = _ordered_assessments(exact)
    effective_states = _effective_assessment_states(exact, assessments)
    counts = {
        state: sum(effective is state for effective in effective_states)
        for state in _DECISION_STATE_ORDER
    }
    role_count = len({assessment.role for assessment in assessments})
    credible_positive_count = (
        "null" if exact.credible_positive_count is None else str(exact.credible_positive_count)
    )
    role_cards = ",".join(
        (
            f"{assessment.role.value}:{effective.value}:"
            f"raw…{_digest_suffix(assessment.raw_sha256)}:"
            f"semantic…{_digest_suffix(assessment.semantic_sha256)}"
        )
        for assessment, effective in zip(assessments, effective_states, strict=True)
    )
    found = (
        f"registry=raw…{_digest_suffix(exact.registry_raw_sha256)}:"
        f"semantic…{_digest_suffix(exact.registry_semantic_sha256)}; "
        f"roleCount={role_count}; "
        "assessmentCounts="
        f"VERIFIED_POSITIVE:{counts[DecisionState.VERIFIED_POSITIVE]},"
        f"NO_GO:{counts[DecisionState.NO_GO]},"
        f"UNKNOWN:{counts[DecisionState.UNKNOWN]}; "
        f"crediblePositiveCount={credible_positive_count}; "
        f"authority={exact.authority}; "
        f"roles={role_cards}"
    )
    return (
        f"- item=`{_ITEM}` | expected=`{_EXPECTED}` | found=`{found}` "
        f"| status=`{exact.status.value}`"
    )
