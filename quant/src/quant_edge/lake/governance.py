"""Fail-closed research-source review and non-authoritative owner annotations.

These records are advisory research metadata.  A source card can become eligible for a
later review, but this module deliberately has no admission or producer-registration
operation.  Owner annotations are immutable weak supervision and objective outcomes are
referenced only by a later, separate link record.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from enum import StrEnum
from typing import Final, Literal

from quant_edge.canonical import canonical_json_bytes
from quant_edge.errors import ContractValueError
from quant_edge.primitives import require_utc_millis

_IDENTIFIER_PATTERN: Final = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$")
_SHA256_PATTERN: Final = re.compile(r"^[0-9a-f]{64}$")
_FAILURE_CODE_PATTERN: Final = re.compile(r"^[A-Z][A-Z0-9_]{0,63}$")
_MAX_GATE_EVIDENCE: Final = 32
_MAX_VISIBLE_EVIDENCE: Final = 64
_MAX_HYPOTHESES: Final = 32
_MAX_FAILURE_STATES: Final = 64
_MAX_SUMMARY_BYTES: Final = 1_024
_MAX_RATIONALE_BYTES: Final = 512


class SourceGateCode(StrEnum):
    """The eight evidence gates fixed by launch Section Q-C."""

    OFFICIAL_OR_LICENSED_ACCESS = "OFFICIAL_OR_LICENSED_ACCESS"
    STABLE_IDENTITY_MAPPING = "STABLE_IDENTITY_MAPPING"
    TIMESTAMP_SEQUENCE_SEMANTICS = "TIMESTAMP_SEQUENCE_SEMANTICS"
    RETENTION_PERMISSION = "RETENTION_PERMISSION"
    RESOURCE_RATE_BUDGET = "RESOURCE_RATE_BUDGET"
    EXPLICIT_HYPOTHESIS_VALUE = "EXPLICIT_HYPOTHESIS_VALUE"
    CANONICAL_PRODUCER_OWNERSHIP = "CANONICAL_PRODUCER_OWNERSHIP"
    OBSERVABLE_FAILURE_STATE = "OBSERVABLE_FAILURE_STATE"


SOURCE_GATE_ORDER: Final[tuple[SourceGateCode, ...]] = (
    SourceGateCode.OFFICIAL_OR_LICENSED_ACCESS,
    SourceGateCode.STABLE_IDENTITY_MAPPING,
    SourceGateCode.TIMESTAMP_SEQUENCE_SEMANTICS,
    SourceGateCode.RETENTION_PERMISSION,
    SourceGateCode.RESOURCE_RATE_BUDGET,
    SourceGateCode.EXPLICIT_HYPOTHESIS_VALUE,
    SourceGateCode.CANONICAL_PRODUCER_OWNERSHIP,
    SourceGateCode.OBSERVABLE_FAILURE_STATE,
)


class SourceAdoptionDisposition(StrEnum):
    """A research recommendation, never an admission decision."""

    ADOPT = "ADOPT"
    ADAPT = "ADAPT"
    REFERENCE_ONLY = "REFERENCE_ONLY"
    REJECT = "REJECT"


class SourceCardReviewStatus(StrEnum):
    ELIGIBLE_FOR_LATER_REVIEW = "ELIGIBLE_FOR_LATER_REVIEW"
    INELIGIBLE = "INELIGIBLE"


class OwnerAnnotationCohort(StrEnum):
    ACTED = "ACTED"
    REJECTED = "REJECTED"
    MISSED = "MISSED"


class OutcomeVisibility(StrEnum):
    HIDDEN = "HIDDEN"
    PARTIAL = "PARTIAL"
    KNOWN = "KNOWN"


class OwnerAnnotationTag(StrEnum):
    INSUFFICIENT_EVIDENCE = "INSUFFICIENT_EVIDENCE"
    OBVIOUS_TRAP = "OBVIOUS_TRAP"
    PLAUSIBLE_PRECURSOR = "PLAUSIBLE_PRECURSOR"
    TOO_LATE = "TOO_LATE"


def _require_identifier(value: object, *, field: str) -> str:
    if not isinstance(value, str) or _IDENTIFIER_PATTERN.fullmatch(value) is None:
        raise ContractValueError(
            f"{field} must be a non-path ASCII identifier beginning with an alphanumeric"
        )
    return value


def _require_sha256(value: object, *, field: str) -> str:
    if not isinstance(value, str) or _SHA256_PATTERN.fullmatch(value) is None:
        raise ContractValueError(f"{field} must be a lowercase SHA-256 digest")
    return value


def _require_bounded_text(value: object, *, field: str, max_bytes: int) -> str:
    if not isinstance(value, str) or not value or value != value.strip():
        raise ContractValueError(f"{field} must be non-empty text without outer whitespace")
    if any(ord(character) < 32 or ord(character) == 127 for character in value):
        raise ContractValueError(f"{field} must not contain control characters")
    try:
        encoded = value.encode("utf-8", errors="strict")
    except UnicodeEncodeError as error:
        raise ContractValueError(f"{field} must encode as strict UTF-8") from error
    if len(encoded) > max_bytes:
        raise ContractValueError(f"{field} exceeds the {max_bytes}-byte UTF-8 limit")
    return value


def _require_sorted_identifiers(
    values: object,
    *,
    field: str,
    maximum: int,
    allow_empty: bool,
) -> tuple[str, ...]:
    if not isinstance(values, tuple):
        raise ContractValueError(f"{field} must be an immutable tuple")
    if (not allow_empty and not values) or len(values) > maximum:
        raise ContractValueError(f"{field} has an invalid item count")
    validated = tuple(
        _require_identifier(value, field=f"{field}[{index}]") for index, value in enumerate(values)
    )
    if validated != tuple(sorted(set(validated))):
        raise ContractValueError(f"{field} must be sorted and unique")
    return validated


def _require_sorted_digests(
    values: object,
    *,
    field: str,
    maximum: int,
    allow_empty: bool,
) -> tuple[str, ...]:
    if not isinstance(values, tuple):
        raise ContractValueError(f"{field} must be an immutable tuple")
    if (not allow_empty and not values) or len(values) > maximum:
        raise ContractValueError(f"{field} has an invalid item count")
    validated = tuple(
        _require_sha256(value, field=f"{field}[{index}]") for index, value in enumerate(values)
    )
    if validated != tuple(sorted(set(validated))):
        raise ContractValueError(f"{field} must be sorted and unique")
    return validated


def _content_sha256(mapping: dict[str, object]) -> str:
    return hashlib.sha256(canonical_json_bytes(mapping)).hexdigest()


@dataclass(frozen=True, slots=True)
class SourceGateEvidenceV1:
    """Evidence references for one gate; an empty tuple is an explicit gate failure."""

    gate: SourceGateCode
    evidence_digests: tuple[str, ...]
    evidence_summary: str

    def __post_init__(self) -> None:
        if not isinstance(self.gate, SourceGateCode):
            raise ContractValueError("gate must be a SourceGateCode")
        _require_sorted_digests(
            self.evidence_digests,
            field="evidence_digests",
            maximum=_MAX_GATE_EVIDENCE,
            allow_empty=True,
        )
        _require_bounded_text(
            self.evidence_summary,
            field="evidence_summary",
            max_bytes=_MAX_SUMMARY_BYTES,
        )

    def as_mapping(self) -> dict[str, object]:
        return {
            "evidenceDigests": list(self.evidence_digests),
            "evidenceSummary": self.evidence_summary,
            "gate": self.gate.value,
            "schema": "SourceGateEvidenceV1",
            "version": 1,
        }


@dataclass(frozen=True, slots=True)
class DataSourceCardV1:
    """Versioned evidence card for review; it does not register or admit a source."""

    source_id: str
    contract_revision: str
    evaluated_at_ms: int
    gates: tuple[SourceGateEvidenceV1, ...]
    hypothesis_ids: tuple[str, ...]
    incremental_value_summary: str
    canonical_producer_owner: str | None
    failure_state_codes: tuple[str, ...]
    historical_coverage_summary: str
    live_coverage_summary: str
    expected_latency_summary: str
    outage_completeness_summary: str
    disposition: SourceAdoptionDisposition

    def __post_init__(self) -> None:
        _require_identifier(self.source_id, field="source_id")
        _require_identifier(self.contract_revision, field="contract_revision")
        require_utc_millis(self.evaluated_at_ms, field="evaluated_at_ms")
        if not isinstance(self.gates, tuple):
            raise ContractValueError("gates must be an immutable tuple")
        if any(not isinstance(gate, SourceGateEvidenceV1) for gate in self.gates):
            raise ContractValueError("gates must contain only SourceGateEvidenceV1 records")
        if tuple(gate.gate for gate in self.gates) != SOURCE_GATE_ORDER:
            raise ContractValueError("gates must contain each Q-C gate exactly once in fixed order")
        _require_sorted_identifiers(
            self.hypothesis_ids,
            field="hypothesis_ids",
            maximum=_MAX_HYPOTHESES,
            allow_empty=True,
        )
        _require_bounded_text(
            self.incremental_value_summary,
            field="incremental_value_summary",
            max_bytes=_MAX_SUMMARY_BYTES,
        )
        if self.canonical_producer_owner is not None:
            _require_identifier(
                self.canonical_producer_owner,
                field="canonical_producer_owner",
            )
        _require_sorted_identifiers(
            self.failure_state_codes,
            field="failure_state_codes",
            maximum=_MAX_FAILURE_STATES,
            allow_empty=True,
        )
        for code in self.failure_state_codes:
            if _FAILURE_CODE_PATTERN.fullmatch(code) is None:
                raise ContractValueError(
                    "failure_state_codes must use uppercase controlled-code syntax"
                )
        for field, value in (
            ("historical_coverage_summary", self.historical_coverage_summary),
            ("live_coverage_summary", self.live_coverage_summary),
            ("expected_latency_summary", self.expected_latency_summary),
            ("outage_completeness_summary", self.outage_completeness_summary),
        ):
            _require_bounded_text(value, field=field, max_bytes=_MAX_SUMMARY_BYTES)
        if not isinstance(self.disposition, SourceAdoptionDisposition):
            raise ContractValueError("disposition must be a SourceAdoptionDisposition")

    def as_mapping(self) -> dict[str, object]:
        return {
            "canonicalProducerOwner": self.canonical_producer_owner,
            "contractRevision": self.contract_revision,
            "disposition": self.disposition.value,
            "evaluatedAtMs": self.evaluated_at_ms,
            "expectedLatencySummary": self.expected_latency_summary,
            "failureStateCodes": list(self.failure_state_codes),
            "gates": [gate.as_mapping() for gate in self.gates],
            "historicalCoverageSummary": self.historical_coverage_summary,
            "hypothesisIds": list(self.hypothesis_ids),
            "incrementalValueSummary": self.incremental_value_summary,
            "liveCoverageSummary": self.live_coverage_summary,
            "outageCompletenessSummary": self.outage_completeness_summary,
            "schema": "DataSourceCardV1",
            "sourceId": self.source_id,
            "version": 1,
        }

    def canonical_bytes(self) -> bytes:
        return canonical_json_bytes(self.as_mapping())

    @property
    def sha256(self) -> str:
        return hashlib.sha256(self.canonical_bytes()).hexdigest()

    @property
    def card_id(self) -> str:
        return f"source-card-sha256-{self.sha256}"


@dataclass(frozen=True, slots=True)
class SourceCardReviewV1:
    status: SourceCardReviewStatus
    failed_gate_codes: tuple[SourceGateCode, ...]
    authority_posture: Literal["REVIEW_ONLY_NO_ADMISSION"] = "REVIEW_ONLY_NO_ADMISSION"

    def __post_init__(self) -> None:
        if not isinstance(self.status, SourceCardReviewStatus):
            raise ContractValueError("status must be a SourceCardReviewStatus")
        if not isinstance(self.failed_gate_codes, tuple) or any(
            not isinstance(gate, SourceGateCode) for gate in self.failed_gate_codes
        ):
            raise ContractValueError("failed_gate_codes must be a tuple of SourceGateCode")
        expected_order = tuple(gate for gate in SOURCE_GATE_ORDER if gate in self.failed_gate_codes)
        if self.failed_gate_codes != expected_order or len(set(self.failed_gate_codes)) != len(
            self.failed_gate_codes
        ):
            raise ContractValueError("failed_gate_codes must be unique and in fixed gate order")
        if self.status is SourceCardReviewStatus.ELIGIBLE_FOR_LATER_REVIEW:
            if self.failed_gate_codes:
                raise ContractValueError("eligible review result cannot contain failed gates")
        elif not self.failed_gate_codes:
            raise ContractValueError("ineligible review result must identify failed gates")
        if self.authority_posture != "REVIEW_ONLY_NO_ADMISSION":
            raise ContractValueError("source review cannot carry admission authority")

    def as_mapping(self) -> dict[str, object]:
        return {
            "authorityPosture": self.authority_posture,
            "failedGateCodes": [gate.value for gate in self.failed_gate_codes],
            "schema": "SourceCardReviewV1",
            "status": self.status.value,
            "version": 1,
        }


def evaluate_source_card(
    card: DataSourceCardV1,
    *,
    expected_canonical_producer_owner: str,
) -> SourceCardReviewV1:
    """Derive structural review eligibility without admitting or registering a source."""

    if not isinstance(card, DataSourceCardV1):
        raise ContractValueError("card must be a DataSourceCardV1")
    expected_owner = _require_identifier(
        expected_canonical_producer_owner,
        field="expected_canonical_producer_owner",
    )
    failed: list[SourceGateCode] = [gate.gate for gate in card.gates if not gate.evidence_digests]
    if not card.hypothesis_ids:
        failed.append(SourceGateCode.EXPLICIT_HYPOTHESIS_VALUE)
    if card.canonical_producer_owner != expected_owner:
        failed.append(SourceGateCode.CANONICAL_PRODUCER_OWNERSHIP)
    if not card.failure_state_codes:
        failed.append(SourceGateCode.OBSERVABLE_FAILURE_STATE)
    failed_set = set(failed)
    failed_codes = tuple(gate for gate in SOURCE_GATE_ORDER if gate in failed_set)
    status = (
        SourceCardReviewStatus.INELIGIBLE
        if failed_codes
        else SourceCardReviewStatus.ELIGIBLE_FOR_LATER_REVIEW
    )
    return SourceCardReviewV1(status=status, failed_gate_codes=failed_codes)


@dataclass(frozen=True, slots=True)
class VisibleEvidenceRefV1:
    evidence_id: str
    sha256: str
    available_at_ms: int

    def __post_init__(self) -> None:
        _require_identifier(self.evidence_id, field="evidence_id")
        _require_sha256(self.sha256, field="sha256")
        require_utc_millis(self.available_at_ms, field="available_at_ms")

    def as_mapping(self) -> dict[str, object]:
        return {
            "availableAtMs": self.available_at_ms,
            "evidenceId": self.evidence_id,
            "sha256": self.sha256,
        }


@dataclass(frozen=True, slots=True)
class OwnerAnnotationV1:
    target_event_id: str
    target_event_sha256: str
    cohort: OwnerAnnotationCohort
    annotator_id: str
    annotated_at_ms: int
    evidence_cutoff_ms: int
    visible_evidence: tuple[VisibleEvidenceRefV1, ...]
    outcome_visibility: OutcomeVisibility
    tags: tuple[OwnerAnnotationTag, ...]
    rationale: str
    visible_outcome_evidence: tuple[VisibleEvidenceRefV1, ...] = ()
    supervision_posture: Literal["WEAK_SUPERVISION_ONLY"] = "WEAK_SUPERVISION_ONLY"

    def __post_init__(self) -> None:
        _require_identifier(self.target_event_id, field="target_event_id")
        _require_sha256(self.target_event_sha256, field="target_event_sha256")
        if not isinstance(self.cohort, OwnerAnnotationCohort):
            raise ContractValueError("cohort must be an OwnerAnnotationCohort")
        _require_identifier(self.annotator_id, field="annotator_id")
        annotated_at_ms = require_utc_millis(self.annotated_at_ms, field="annotated_at_ms")
        evidence_cutoff_ms = require_utc_millis(
            self.evidence_cutoff_ms,
            field="evidence_cutoff_ms",
        )
        if evidence_cutoff_ms > annotated_at_ms:
            raise ContractValueError("evidence_cutoff_ms cannot follow annotated_at_ms")
        if not isinstance(self.visible_evidence, tuple):
            raise ContractValueError("visible_evidence must be an immutable tuple")
        if not 1 <= len(self.visible_evidence) <= _MAX_VISIBLE_EVIDENCE:
            raise ContractValueError("visible_evidence has an invalid item count")
        if any(not isinstance(item, VisibleEvidenceRefV1) for item in self.visible_evidence):
            raise ContractValueError("visible_evidence must contain VisibleEvidenceRefV1 records")
        evidence_keys = tuple(
            (item.evidence_id, item.sha256, item.available_at_ms) for item in self.visible_evidence
        )
        if evidence_keys != tuple(sorted(set(evidence_keys))):
            raise ContractValueError("visible_evidence must be sorted and unique")
        evidence_ids = tuple(item.evidence_id for item in self.visible_evidence)
        if len(set(evidence_ids)) != len(evidence_ids):
            raise ContractValueError("visible_evidence IDs must be unique")
        if any(item.available_at_ms > evidence_cutoff_ms for item in self.visible_evidence):
            raise ContractValueError("visible evidence must be available by evidence_cutoff_ms")
        if not isinstance(self.outcome_visibility, OutcomeVisibility):
            raise ContractValueError("outcome_visibility must be an OutcomeVisibility")
        if not isinstance(self.visible_outcome_evidence, tuple) or any(
            not isinstance(item, VisibleEvidenceRefV1) for item in self.visible_outcome_evidence
        ):
            raise ContractValueError(
                "visible_outcome_evidence must be an immutable evidence-reference tuple"
            )
        if len(self.visible_outcome_evidence) > _MAX_VISIBLE_EVIDENCE:
            raise ContractValueError("visible_outcome_evidence exceeds the bounded item count")
        outcome_keys = tuple(
            (item.evidence_id, item.sha256, item.available_at_ms)
            for item in self.visible_outcome_evidence
        )
        if outcome_keys != tuple(sorted(set(outcome_keys))):
            raise ContractValueError("visible_outcome_evidence must be sorted and unique")
        outcome_ids = tuple(item.evidence_id for item in self.visible_outcome_evidence)
        if len(set(outcome_ids)) != len(outcome_ids):
            raise ContractValueError("visible_outcome_evidence IDs must be unique")
        if any(item.available_at_ms > evidence_cutoff_ms for item in self.visible_outcome_evidence):
            raise ContractValueError("visible outcome evidence must be available by the cutoff")
        if self.outcome_visibility is OutcomeVisibility.HIDDEN:
            if self.visible_outcome_evidence:
                raise ContractValueError(
                    "HIDDEN annotations cannot contain visible outcome evidence"
                )
        elif not self.visible_outcome_evidence:
            raise ContractValueError(
                "PARTIAL or KNOWN annotations require visible outcome evidence"
            )
        if not isinstance(self.tags, tuple) or not self.tags:
            raise ContractValueError("tags must be a non-empty immutable tuple")
        if any(not isinstance(tag, OwnerAnnotationTag) for tag in self.tags):
            raise ContractValueError("tags must contain only controlled OwnerAnnotationTag values")
        expected_tags = tuple(sorted(set(self.tags), key=lambda tag: tag.value))
        if self.tags != expected_tags:
            raise ContractValueError("tags must be sorted and unique")
        _require_bounded_text(
            self.rationale,
            field="rationale",
            max_bytes=_MAX_RATIONALE_BYTES,
        )
        if self.supervision_posture != "WEAK_SUPERVISION_ONLY":
            raise ContractValueError("owner annotations are weak supervision only")

    def core_mapping(self) -> dict[str, object]:
        return {
            "annotatedAtMs": self.annotated_at_ms,
            "annotatorId": self.annotator_id,
            "cohort": self.cohort.value,
            "evidenceCutoffMs": self.evidence_cutoff_ms,
            "outcomeVisibility": self.outcome_visibility.value,
            "rationale": self.rationale,
            "schema": "OwnerAnnotationV1",
            "supervisionPosture": self.supervision_posture,
            "tags": [tag.value for tag in self.tags],
            "targetEventId": self.target_event_id,
            "targetEventSha256": self.target_event_sha256,
            "version": 1,
            "visibleEvidence": [item.as_mapping() for item in self.visible_evidence],
            "visibleOutcomeEvidence": [item.as_mapping() for item in self.visible_outcome_evidence],
        }

    def canonical_bytes(self) -> bytes:
        return canonical_json_bytes(self.core_mapping())

    @property
    def sha256(self) -> str:
        return _content_sha256(self.core_mapping())

    @property
    def annotation_id(self) -> str:
        return f"owner-annotation-sha256-{self.sha256}"

    @property
    def visible_evidence_digests(self) -> tuple[str, ...]:
        return tuple(item.sha256 for item in self.visible_evidence)


@dataclass(frozen=True, slots=True)
class OwnerAnnotationOutcomeLinkV1:
    """Append-only reference from weak supervision to later objective truth."""

    annotation: OwnerAnnotationV1
    objective_outcome_owner: str
    objective_outcome_id: str
    objective_outcome_sha256: str
    objective_outcome_available_at_ms: int
    linked_at_ms: int
    linkage_method_version: str
    authority_posture: Literal["OBJECTIVE_REFERENCE_ONLY"] = "OBJECTIVE_REFERENCE_ONLY"

    def __post_init__(self) -> None:
        if not isinstance(self.annotation, OwnerAnnotationV1):
            raise ContractValueError("annotation must be an OwnerAnnotationV1")
        _require_identifier(self.objective_outcome_owner, field="objective_outcome_owner")
        _require_identifier(self.objective_outcome_id, field="objective_outcome_id")
        _require_sha256(self.objective_outcome_sha256, field="objective_outcome_sha256")
        outcome_available_at_ms = require_utc_millis(
            self.objective_outcome_available_at_ms,
            field="objective_outcome_available_at_ms",
        )
        linked_at_ms = require_utc_millis(self.linked_at_ms, field="linked_at_ms")
        if outcome_available_at_ms > linked_at_ms:
            raise ContractValueError("objective outcome must be available before linkage")
        if linked_at_ms < self.annotation.annotated_at_ms:
            raise ContractValueError("outcome linkage cannot predate the immutable annotation")
        if (
            self.annotation.outcome_visibility is OutcomeVisibility.HIDDEN
            and outcome_available_at_ms <= self.annotation.annotated_at_ms
        ):
            raise ContractValueError(
                "a HIDDEN annotation can link only to an outcome available after annotation"
            )
        _require_identifier(self.linkage_method_version, field="linkage_method_version")
        if self.authority_posture != "OBJECTIVE_REFERENCE_ONLY":
            raise ContractValueError("outcome links are references without label/action authority")

    def core_mapping(self) -> dict[str, object]:
        return {
            "annotationId": self.annotation.annotation_id,
            "annotationSha256": self.annotation.sha256,
            "authorityPosture": self.authority_posture,
            "linkageMethodVersion": self.linkage_method_version,
            "linkedAtMs": self.linked_at_ms,
            "objectiveOutcomeAvailableAtMs": self.objective_outcome_available_at_ms,
            "objectiveOutcomeId": self.objective_outcome_id,
            "objectiveOutcomeOwner": self.objective_outcome_owner,
            "objectiveOutcomeSha256": self.objective_outcome_sha256,
            "schema": "OwnerAnnotationOutcomeLinkV1",
            "version": 1,
        }

    def canonical_bytes(self) -> bytes:
        return canonical_json_bytes(self.core_mapping())

    @property
    def sha256(self) -> str:
        return _content_sha256(self.core_mapping())

    @property
    def link_id(self) -> str:
        return f"owner-annotation-outcome-link-sha256-{self.sha256}"
