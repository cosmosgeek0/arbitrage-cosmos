import hashlib
from dataclasses import replace

import pytest

from quant_edge.errors import ContractValueError
from quant_edge.lake import governance as governance_module
from quant_edge.lake.governance import (
    SOURCE_GATE_ORDER,
    DataSourceCardV1,
    OutcomeVisibility,
    OwnerAnnotationCohort,
    OwnerAnnotationTag,
    OwnerAnnotationV1,
    SourceAdoptionDisposition,
    SourceCardReviewStatus,
    SourceCardReviewV1,
    SourceGateCode,
    SourceGateEvidenceV1,
    VisibleEvidenceRefV1,
)

AS_OF_MS = 1_783_814_400_000


def _digest(label: str) -> str:
    return hashlib.sha256(label.encode()).hexdigest()


def _gates() -> tuple[SourceGateEvidenceV1, ...]:
    return tuple(
        SourceGateEvidenceV1(
            gate=gate,
            evidence_digests=(_digest(gate.value),),
            evidence_summary=f"Synthetic proof for {gate.value}.",
        )
        for gate in SOURCE_GATE_ORDER
    )


def _card() -> DataSourceCardV1:
    return DataSourceCardV1(
        source_id="synthetic.q02.hostile",
        contract_revision="source-contract.v1",
        evaluated_at_ms=AS_OF_MS,
        gates=_gates(),
        hypothesis_ids=("H5",),
        incremental_value_summary="Hostile validation fixture only.",
        canonical_producer_owner="intelligenceRuntime",
        failure_state_codes=("MISSING",),
        historical_coverage_summary="SYNTHETIC_ONLY.",
        live_coverage_summary="SYNTHETIC_ONLY.",
        expected_latency_summary="UNAVAILABLE.",
        outage_completeness_summary="Synthetic missing state is observable.",
        disposition=SourceAdoptionDisposition.REFERENCE_ONLY,
    )


def _evidence(*, digest: str = "a" * 64) -> VisibleEvidenceRefV1:
    return VisibleEvidenceRefV1(
        evidence_id="evidence.same-id",
        sha256=digest,
        available_at_ms=AS_OF_MS - 2_000,
    )


def _annotation(
    visible_evidence: tuple[VisibleEvidenceRefV1, ...],
) -> OwnerAnnotationV1:
    return OwnerAnnotationV1(
        target_event_id="event.q02.hostile",
        target_event_sha256=_digest("event.q02.hostile"),
        cohort=OwnerAnnotationCohort.REJECTED,
        annotator_id="owner.opaque-hostile",
        annotated_at_ms=AS_OF_MS,
        evidence_cutoff_ms=AS_OF_MS - 1_000,
        visible_evidence=visible_evidence,
        outcome_visibility=OutcomeVisibility.HIDDEN,
        tags=(OwnerAnnotationTag.INSUFFICIENT_EVIDENCE,),
        rationale="Hostile validation fixture.",
    )


def test_bounded_text_rejects_unpaired_surrogate_as_non_utf8() -> None:
    with pytest.raises(ContractValueError, match="strict UTF-8"):
        SourceGateEvidenceV1(
            gate=SourceGateCode.OFFICIAL_OR_LICENSED_ACCESS,
            evidence_digests=(),
            evidence_summary="\ud800",
        )


def test_identifier_validator_rejects_empty_required_and_over_limit_tuples() -> None:
    with pytest.raises(ContractValueError, match="invalid item count"):
        governance_module._require_sorted_identifiers(
            (),
            field="hostile",
            maximum=1,
            allow_empty=False,
        )
    with pytest.raises(ContractValueError, match="invalid item count"):
        replace(_card(), hypothesis_ids=tuple(f"H{i:02d}" for i in range(33)))
    with pytest.raises(ContractValueError, match="immutable tuple"):
        governance_module._require_sorted_identifiers(
            [],
            field="hostile",
            maximum=1,
            allow_empty=True,
        )


def test_digest_validator_rejects_empty_required_and_over_limit_tuples() -> None:
    with pytest.raises(ContractValueError, match="invalid item count"):
        governance_module._require_sorted_digests(
            (),
            field="hostile",
            maximum=1,
            allow_empty=False,
        )
    too_many = tuple(sorted(_digest(f"proof-{index}") for index in range(33)))
    with pytest.raises(ContractValueError, match="invalid item count"):
        SourceGateEvidenceV1(
            gate=SourceGateCode.OFFICIAL_OR_LICENSED_ACCESS,
            evidence_digests=too_many,
            evidence_summary="Too many proof references.",
        )
    with pytest.raises(ContractValueError, match="immutable tuple"):
        governance_module._require_sorted_digests(
            [],
            field="hostile",
            maximum=1,
            allow_empty=True,
        )


def test_source_card_rejects_mutable_gate_container_before_member_access() -> None:
    card = _card()
    with pytest.raises(ContractValueError, match="gates must be an immutable tuple"):
        replace(card, gates=list(card.gates))  # type: ignore[arg-type]


def test_review_result_rejects_raw_status_and_invalid_failed_gate_containers() -> None:
    with pytest.raises(ContractValueError, match="status must be"):
        SourceCardReviewV1(
            status="INELIGIBLE",  # type: ignore[arg-type]
            failed_gate_codes=(SourceGateCode.RETENTION_PERMISSION,),
        )
    with pytest.raises(ContractValueError, match="tuple of SourceGateCode"):
        SourceCardReviewV1(
            status=SourceCardReviewStatus.INELIGIBLE,
            failed_gate_codes=[SourceGateCode.RETENTION_PERMISSION],  # type: ignore[arg-type]
        )
    with pytest.raises(ContractValueError, match="tuple of SourceGateCode"):
        SourceCardReviewV1(
            status=SourceCardReviewStatus.INELIGIBLE,
            failed_gate_codes=("RETENTION_PERMISSION",),  # type: ignore[arg-type]
        )


def test_review_result_rejects_duplicate_and_noncanonical_gate_order() -> None:
    for failed_gate_codes in (
        (
            SourceGateCode.RETENTION_PERMISSION,
            SourceGateCode.RETENTION_PERMISSION,
        ),
        (
            SourceGateCode.RETENTION_PERMISSION,
            SourceGateCode.OFFICIAL_OR_LICENSED_ACCESS,
        ),
    ):
        with pytest.raises(ContractValueError, match="unique and in fixed gate order"):
            SourceCardReviewV1(
                status=SourceCardReviewStatus.INELIGIBLE,
                failed_gate_codes=failed_gate_codes,
            )


def test_annotation_rejects_mutable_evidence_container() -> None:
    with pytest.raises(ContractValueError, match="visible_evidence must be an immutable tuple"):
        _annotation([_evidence()])  # type: ignore[arg-type]


def test_annotation_rejects_duplicate_evidence_id_even_with_distinct_hashes() -> None:
    first = _evidence(digest="a" * 64)
    second = _evidence(digest="b" * 64)
    with pytest.raises(ContractValueError, match="IDs must be unique"):
        _annotation((first, second))
