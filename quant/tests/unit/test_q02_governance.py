import hashlib
from dataclasses import FrozenInstanceError, replace

import pytest

from quant_edge.canonical import parse_canonical_object
from quant_edge.errors import ContractValueError
from quant_edge.lake.governance import (
    SOURCE_GATE_ORDER,
    DataSourceCardV1,
    OutcomeVisibility,
    OwnerAnnotationCohort,
    OwnerAnnotationOutcomeLinkV1,
    OwnerAnnotationTag,
    OwnerAnnotationV1,
    SourceAdoptionDisposition,
    SourceCardReviewStatus,
    SourceCardReviewV1,
    SourceGateCode,
    SourceGateEvidenceV1,
    VisibleEvidenceRefV1,
    evaluate_source_card,
)

AS_OF_MS = 1_783_814_400_000


def _digest(label: str) -> str:
    return hashlib.sha256(label.encode()).hexdigest()


def _gate_evidence(
    gate: SourceGateCode,
    *,
    proven: bool = True,
) -> SourceGateEvidenceV1:
    return SourceGateEvidenceV1(
        gate=gate,
        evidence_digests=(_digest(gate.value),) if proven else (),
        evidence_summary=f"Synthetic evidence boundary for {gate.value}.",
    )


def _source_card() -> DataSourceCardV1:
    return DataSourceCardV1(
        source_id="synthetic.q02",
        contract_revision="source-contract.v1",
        evaluated_at_ms=AS_OF_MS,
        gates=tuple(_gate_evidence(gate) for gate in SOURCE_GATE_ORDER),
        hypothesis_ids=("H5",),
        incremental_value_summary="Tests the source-card boundary without admitting a source.",
        canonical_producer_owner="intelligenceRuntime",
        failure_state_codes=("MISSING", "RATE_LIMITED", "STALE"),
        historical_coverage_summary="SYNTHETIC_ONLY; no historical source is admitted.",
        live_coverage_summary="SYNTHETIC_ONLY; no live source is admitted.",
        expected_latency_summary="No network capture; latency is unavailable.",
        outage_completeness_summary="Synthetic failure states are explicit and deterministic.",
        disposition=SourceAdoptionDisposition.ADOPT,
    )


def _visible_evidence(label: str = "evidence.a") -> VisibleEvidenceRefV1:
    return VisibleEvidenceRefV1(
        evidence_id=label,
        sha256=_digest(label),
        available_at_ms=AS_OF_MS - 2_000,
    )


def _annotation(
    *,
    visibility: OutcomeVisibility = OutcomeVisibility.HIDDEN,
) -> OwnerAnnotationV1:
    return OwnerAnnotationV1(
        target_event_id="event.q02.1",
        target_event_sha256=_digest("event.q02.1"),
        cohort=OwnerAnnotationCohort.MISSED,
        annotator_id="owner.opaque-1",
        annotated_at_ms=AS_OF_MS,
        evidence_cutoff_ms=AS_OF_MS - 1_000,
        visible_evidence=(_visible_evidence(),),
        outcome_visibility=visibility,
        tags=(
            OwnerAnnotationTag.INSUFFICIENT_EVIDENCE,
            OwnerAnnotationTag.PLAUSIBLE_PRECURSOR,
        ),
        rationale="Visible evidence was insufficient at the frozen cutoff.",
        visible_outcome_evidence=(
            ()
            if visibility is OutcomeVisibility.HIDDEN
            else (_visible_evidence("visible.outcome.evidence"),)
        ),
    )


def test_complete_synthetic_source_card_is_only_eligible_for_later_review() -> None:
    card = _source_card()
    result = evaluate_source_card(
        card,
        expected_canonical_producer_owner="intelligenceRuntime",
    )

    assert result.status is SourceCardReviewStatus.ELIGIBLE_FOR_LATER_REVIEW
    assert result.failed_gate_codes == ()
    assert result.authority_posture == "REVIEW_ONLY_NO_ADMISSION"
    assert set(SourceCardReviewStatus) == {
        SourceCardReviewStatus.ELIGIBLE_FOR_LATER_REVIEW,
        SourceCardReviewStatus.INELIGIBLE,
    }
    assert "ADMITTED" not in str(result.as_mapping())


@pytest.mark.parametrize("failed_gate", SOURCE_GATE_ORDER)
def test_each_qc_gate_fails_closed_with_its_exact_code(failed_gate: SourceGateCode) -> None:
    card = _source_card()
    gates = tuple(
        _gate_evidence(gate, proven=gate is not failed_gate) for gate in SOURCE_GATE_ORDER
    )

    result = evaluate_source_card(
        replace(card, gates=gates),
        expected_canonical_producer_owner="intelligenceRuntime",
    )

    assert result.status is SourceCardReviewStatus.INELIGIBLE
    assert result.failed_gate_codes == (failed_gate,)


@pytest.mark.parametrize(
    ("change", "failed_gate"),
    [
        ({"hypothesis_ids": ()}, SourceGateCode.EXPLICIT_HYPOTHESIS_VALUE),
        ({"canonical_producer_owner": None}, SourceGateCode.CANONICAL_PRODUCER_OWNERSHIP),
        ({"failure_state_codes": ()}, SourceGateCode.OBSERVABLE_FAILURE_STATE),
    ],
)
def test_gate_evidence_cannot_replace_required_structured_values(
    change: dict[str, object],
    failed_gate: SourceGateCode,
) -> None:
    card = replace(_source_card(), **change)  # type: ignore[arg-type]
    result = evaluate_source_card(
        card,
        expected_canonical_producer_owner="intelligenceRuntime",
    )
    assert result.failed_gate_codes == (failed_gate,)


def test_adopt_recommendation_cannot_override_a_failed_gate() -> None:
    card = _source_card()
    gates = tuple(
        _gate_evidence(gate, proven=gate is not SourceGateCode.RETENTION_PERMISSION)
        for gate in SOURCE_GATE_ORDER
    )
    result = evaluate_source_card(
        replace(card, gates=gates),
        expected_canonical_producer_owner="intelligenceRuntime",
    )
    assert card.disposition is SourceAdoptionDisposition.ADOPT
    assert result.status is SourceCardReviewStatus.INELIGIBLE


def test_source_card_is_canonical_content_addressed_and_immutable() -> None:
    card = _source_card()
    parsed = parse_canonical_object(card.canonical_bytes())
    assert parsed == card.as_mapping()
    assert card.sha256 == hashlib.sha256(card.canonical_bytes()).hexdigest()
    assert card.card_id == f"source-card-sha256-{card.sha256}"
    with pytest.raises(FrozenInstanceError):
        card.source_id = "changed"  # type: ignore[misc]


def test_source_card_rejects_missing_duplicate_reordered_or_untyped_gates() -> None:
    card = _source_card()
    invalid_gate_sets: list[tuple[object, ...]] = [
        card.gates[:-1],
        (*card.gates[:-1], card.gates[-2]),
        (card.gates[1], card.gates[0], *card.gates[2:]),
        (*card.gates[:-1], object()),
    ]
    for gates in invalid_gate_sets:
        with pytest.raises(ContractValueError):
            replace(card, gates=gates)  # type: ignore[arg-type]


@pytest.mark.parametrize(
    "mutation",
    [
        {"source_id": "."},
        {"source_id": "../source"},
        {"evaluated_at_ms": True},
        {"hypothesis_ids": ["H5"]},
        {"hypothesis_ids": ("H5", "H5")},
        {"failure_state_codes": ("not_upper",)},
        {"historical_coverage_summary": " bad"},
        {"live_coverage_summary": "bad\ntext"},
        {"disposition": "ADOPT"},
    ],
)
def test_source_card_rejects_ambiguous_or_mutable_values(mutation: dict[str, object]) -> None:
    with pytest.raises(ContractValueError):
        replace(_source_card(), **mutation)  # type: ignore[arg-type]


def test_gate_evidence_rejects_bad_enum_digest_order_and_unbounded_text() -> None:
    with pytest.raises(ContractValueError):
        SourceGateEvidenceV1(
            gate="OFFICIAL_OR_LICENSED_ACCESS",  # type: ignore[arg-type]
            evidence_digests=(),
            evidence_summary="Missing.",
        )
    for evidence_digests in (
        (_digest("z").upper(),),
        ("f" * 64, "a" * 64),
        (_digest("z"), _digest("z")),
        [_digest("z")],
    ):
        with pytest.raises(ContractValueError):
            SourceGateEvidenceV1(
                gate=SourceGateCode.OFFICIAL_OR_LICENSED_ACCESS,
                evidence_digests=evidence_digests,  # type: ignore[arg-type]
                evidence_summary="Evidence.",
            )
    for summary in ("", " outer ", "bad\x00text", "x" * 1_025):
        with pytest.raises(ContractValueError):
            SourceGateEvidenceV1(
                gate=SourceGateCode.OFFICIAL_OR_LICENSED_ACCESS,
                evidence_digests=(),
                evidence_summary=summary,
            )


def test_source_review_result_rejects_inconsistent_or_authoritative_states() -> None:
    with pytest.raises(ContractValueError):
        SourceCardReviewV1(
            status=SourceCardReviewStatus.ELIGIBLE_FOR_LATER_REVIEW,
            failed_gate_codes=(SourceGateCode.RETENTION_PERMISSION,),
        )
    with pytest.raises(ContractValueError):
        SourceCardReviewV1(
            status=SourceCardReviewStatus.INELIGIBLE,
            failed_gate_codes=(),
        )
    with pytest.raises(ContractValueError):
        SourceCardReviewV1(
            status=SourceCardReviewStatus.INELIGIBLE,
            failed_gate_codes=(
                SourceGateCode.RETENTION_PERMISSION,
                SourceGateCode.OFFICIAL_OR_LICENSED_ACCESS,
            ),
        )
    with pytest.raises(ContractValueError):
        SourceCardReviewV1(
            status=SourceCardReviewStatus.INELIGIBLE,
            failed_gate_codes=(SourceGateCode.RETENTION_PERMISSION,),
            authority_posture="ADMITTED",  # type: ignore[arg-type]
        )
    with pytest.raises(ContractValueError):
        evaluate_source_card(
            object(),  # type: ignore[arg-type]
            expected_canonical_producer_owner="intelligenceRuntime",
        )


def test_source_card_cannot_self_assign_a_different_canonical_owner() -> None:
    card = _source_card()
    result = evaluate_source_card(
        card,
        expected_canonical_producer_owner="differentCanonicalOwner",
    )
    assert result.failed_gate_codes == (SourceGateCode.CANONICAL_PRODUCER_OWNERSHIP,)


def test_owner_annotation_records_only_visible_at_tag_evidence_and_is_content_addressed() -> None:
    annotation = _annotation()
    before = annotation.sha256
    parsed = parse_canonical_object(annotation.canonical_bytes())

    assert parsed == annotation.core_mapping()
    assert annotation.annotation_id == f"owner-annotation-sha256-{before}"
    assert annotation.visible_evidence_digests == (_digest("evidence.a"),)
    assert annotation.supervision_posture == "WEAK_SUPERVISION_ONLY"
    assert annotation.sha256 == before
    forbidden = {"objectiveLabel", "probability", "action", "capital", "order", "approval"}
    assert forbidden.isdisjoint(annotation.core_mapping())
    with pytest.raises(FrozenInstanceError):
        annotation.rationale = "changed"  # type: ignore[misc]


@pytest.mark.parametrize("cohort", list(OwnerAnnotationCohort))
@pytest.mark.parametrize("visibility", list(OutcomeVisibility))
def test_owner_annotation_accepts_only_fixed_cohorts_and_visibility(
    cohort: OwnerAnnotationCohort,
    visibility: OutcomeVisibility,
) -> None:
    annotation = replace(_annotation(visibility=visibility), cohort=cohort)
    assert annotation.cohort is cohort
    assert annotation.outcome_visibility is visibility


def test_owner_annotation_rejects_evidence_not_visible_by_cutoff() -> None:
    annotation = _annotation()
    late_evidence = replace(
        _visible_evidence(),
        available_at_ms=annotation.evidence_cutoff_ms + 1,
    )
    with pytest.raises(ContractValueError):
        replace(annotation, visible_evidence=(late_evidence,))
    with pytest.raises(ContractValueError):
        replace(annotation, evidence_cutoff_ms=annotation.annotated_at_ms + 1)


def test_owner_annotation_structurally_binds_outcome_visibility() -> None:
    hidden = _annotation()
    visible = _visible_evidence("visible.outcome.evidence")
    with pytest.raises(ContractValueError, match="immutable evidence-reference"):
        replace(hidden, visible_outcome_evidence=[visible])  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="HIDDEN"):
        replace(hidden, visible_outcome_evidence=(visible,))
    for visibility in (OutcomeVisibility.PARTIAL, OutcomeVisibility.KNOWN):
        with pytest.raises(ContractValueError, match="require visible outcome"):
            replace(hidden, outcome_visibility=visibility)
    known = _annotation(visibility=OutcomeVisibility.KNOWN)
    assert known.visible_outcome_evidence == (visible,)
    first = _visible_evidence("visible.outcome.a")
    second = _visible_evidence("visible.outcome.z")
    with pytest.raises(ContractValueError, match="sorted and unique"):
        replace(known, visible_outcome_evidence=(second, first))
    conflicting = replace(first, sha256=_digest("conflicting.outcome"))
    conflicting_pair = tuple(
        sorted(
            (first, conflicting),
            key=lambda item: (item.evidence_id, item.sha256, item.available_at_ms),
        )
    )
    with pytest.raises(ContractValueError, match="IDs must be unique"):
        replace(known, visible_outcome_evidence=conflicting_pair)
    late = replace(visible, available_at_ms=known.evidence_cutoff_ms + 1)
    with pytest.raises(ContractValueError, match="available by the cutoff"):
        replace(known, visible_outcome_evidence=(late,))
    too_many = tuple(_visible_evidence(f"visible.outcome.{index:03}") for index in range(65))
    with pytest.raises(ContractValueError, match="bounded item count"):
        replace(known, visible_outcome_evidence=too_many)


def test_owner_annotation_rejects_mutable_duplicate_or_unsorted_evidence() -> None:
    annotation = _annotation()
    first = _visible_evidence("evidence.a")
    second = _visible_evidence("evidence.b")
    invalid_visible_evidence: tuple[object, ...] = (
        [],
        (),
        (second, first),
        (first, first),
        (first, object()),
    )
    for visible_evidence in invalid_visible_evidence:
        with pytest.raises(ContractValueError):
            replace(annotation, visible_evidence=visible_evidence)  # type: ignore[arg-type]


@pytest.mark.parametrize(
    "mutation",
    [
        {"target_event_id": "."},
        {"target_event_sha256": "A" * 64},
        {"cohort": "MISSED"},
        {"annotated_at_ms": True},
        {"outcome_visibility": "HIDDEN"},
        {"tags": [OwnerAnnotationTag.TOO_LATE]},
        {"tags": ("TOO_LATE",)},
        {
            "tags": (
                OwnerAnnotationTag.TOO_LATE,
                OwnerAnnotationTag.INSUFFICIENT_EVIDENCE,
            )
        },
        {"tags": (OwnerAnnotationTag.TOO_LATE, OwnerAnnotationTag.TOO_LATE)},
        {"rationale": " outer "},
        {"rationale": "bad\ntext"},
        {"rationale": "x" * 513},
        {"supervision_posture": "MODEL_LABEL"},
    ],
)
def test_owner_annotation_rejects_ambiguous_or_authoritative_values(
    mutation: dict[str, object],
) -> None:
    with pytest.raises(ContractValueError):
        replace(_annotation(), **mutation)  # type: ignore[arg-type]


def test_visible_evidence_reference_rejects_boolean_time_and_malformed_values() -> None:
    evidence = _visible_evidence()
    for mutation in (
        {"evidence_id": "../escape"},
        {"sha256": "0" * 63},
        {"available_at_ms": True},
    ):
        with pytest.raises(ContractValueError):
            replace(evidence, **mutation)


def test_later_objective_link_is_separate_immutable_and_preserves_annotation_hash() -> None:
    annotation = _annotation()
    annotation_hash = annotation.sha256
    link = OwnerAnnotationOutcomeLinkV1(
        annotation=annotation,
        objective_outcome_owner="intelligenceFoundation",
        objective_outcome_id="objective.event.q02.1",
        objective_outcome_sha256=_digest("objective.event.q02.1"),
        objective_outcome_available_at_ms=AS_OF_MS + 1_000,
        linked_at_ms=AS_OF_MS + 2_000,
        linkage_method_version="outcome-link.v1",
    )

    parsed = parse_canonical_object(link.canonical_bytes())
    assert parsed == link.core_mapping()
    assert link.sha256 == hashlib.sha256(link.canonical_bytes()).hexdigest()
    assert link.link_id == f"owner-annotation-outcome-link-sha256-{link.sha256}"
    assert link.core_mapping()["annotationSha256"] == annotation_hash
    assert annotation.sha256 == annotation_hash
    assert "rationale" not in link.core_mapping()
    assert "objectiveLabel" not in link.core_mapping()
    assert link.authority_posture == "OBJECTIVE_REFERENCE_ONLY"
    with pytest.raises(FrozenInstanceError):
        link.linked_at_ms = AS_OF_MS  # type: ignore[misc]


def test_hidden_annotation_rejects_outcome_that_was_available_when_tagged() -> None:
    annotation = _annotation()
    with pytest.raises(ContractValueError):
        OwnerAnnotationOutcomeLinkV1(
            annotation=annotation,
            objective_outcome_owner="intelligenceFoundation",
            objective_outcome_id="objective.event.q02.1",
            objective_outcome_sha256=_digest("objective.event.q02.1"),
            objective_outcome_available_at_ms=annotation.annotated_at_ms,
            linked_at_ms=annotation.annotated_at_ms + 1,
            linkage_method_version="outcome-link.v1",
        )


def test_known_annotation_can_link_to_an_already_available_objective_outcome() -> None:
    annotation = _annotation(visibility=OutcomeVisibility.KNOWN)
    link = OwnerAnnotationOutcomeLinkV1(
        annotation=annotation,
        objective_outcome_owner="intelligenceFoundation",
        objective_outcome_id="objective.event.q02.1",
        objective_outcome_sha256=_digest("objective.event.q02.1"),
        objective_outcome_available_at_ms=AS_OF_MS - 5_000,
        linked_at_ms=AS_OF_MS + 1,
        linkage_method_version="outcome-link.v1",
    )
    assert link.annotation.outcome_visibility is OutcomeVisibility.KNOWN


def test_outcome_link_cannot_predate_the_annotation() -> None:
    annotation = _annotation(visibility=OutcomeVisibility.KNOWN)
    with pytest.raises(ContractValueError, match="cannot predate"):
        OwnerAnnotationOutcomeLinkV1(
            annotation=annotation,
            objective_outcome_owner="intelligenceFoundation",
            objective_outcome_id="objective.event.q02.1",
            objective_outcome_sha256=_digest("objective.event.q02.1"),
            objective_outcome_available_at_ms=annotation.annotated_at_ms - 2,
            linked_at_ms=annotation.annotated_at_ms - 1,
            linkage_method_version="outcome-link.v1",
        )


@pytest.mark.parametrize(
    "mutation",
    [
        {"annotation": object()},
        {"objective_outcome_owner": "../owner"},
        {"objective_outcome_id": "."},
        {"objective_outcome_sha256": "A" * 64},
        {"objective_outcome_available_at_ms": True},
        {"linked_at_ms": AS_OF_MS},
        {"linkage_method_version": "bad version"},
        {"authority_posture": "LABEL_AUTHORITY"},
    ],
)
def test_outcome_link_rejects_ambiguous_or_authoritative_values(
    mutation: dict[str, object],
) -> None:
    values: dict[str, object] = {
        "annotation": _annotation(),
        "objective_outcome_owner": "intelligenceFoundation",
        "objective_outcome_id": "objective.event.q02.1",
        "objective_outcome_sha256": _digest("objective.event.q02.1"),
        "objective_outcome_available_at_ms": AS_OF_MS + 1_000,
        "linked_at_ms": AS_OF_MS + 2_000,
        "linkage_method_version": "outcome-link.v1",
    }
    values.update(mutation)
    with pytest.raises(ContractValueError):
        OwnerAnnotationOutcomeLinkV1(**values)  # type: ignore[arg-type]
