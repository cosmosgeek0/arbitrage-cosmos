"""Fail-closed Q12 abstention policy over existing owner truth.

Every hard gate is evaluated independently and all reasons are retained in a frozen
precedence order.  Scores are never allowed to override evidence integrity.  The only
non-abstaining action emitted by this phase is the frozen advisory action ``WATCH``;
the output carries no strategy, proposal, capital, risk or order authority.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from enum import StrEnum

from quant_edge.canonical import canonical_json_bytes
from quant_edge.ensemble.calibration import BoundCalibratedAssessmentV1
from quant_edge.ensemble.conformal import (
    BoundConformalAssessmentV1,
    BoundCoverageEvidenceV1,
    ConformalStatus,
    CoverageStatus,
    PredictionIntervalV1,
)
from quant_edge.ensemble.stacking import FittedStackV1, ValidatedOofMatrixV1
from quant_edge.ensemble.uncertainty import (
    BoundDisorderEvidenceV1,
    BoundStressEvidenceV1,
    CostUncertaintyState,
    SpecialistProbabilityV1,
    TimingUncertaintyState,
    UncertaintyVectorV1,
    decompose_uncertainty,
)
from quant_edge.errors import ContractValueError
from quant_edge.labels.rational import ExactRatioV1
from quant_edge.lake.contracts import (
    DigestV1,
    QualityState,
    require_contract_id,
    require_strict_int,
)
from quant_edge.regime.anomaly import DisorderState
from quant_edge.regime.contracts import InputDisposition, disposition_from_quality
from quant_edge.validation import SampleSetV1

_CONFLICT_THRESHOLD: ExactRatioV1 = ExactRatioV1(1, 3)


class AdvisoryAction(StrEnum):
    WATCH = "WATCH"
    ABSTAIN_UNKNOWN = "ABSTAIN_UNKNOWN"


class AbstentionReason(StrEnum):
    EVIDENCE_STALE = "EVIDENCE_STALE"
    EVIDENCE_INCOMPLETE = "EVIDENCE_INCOMPLETE"
    OOD_SUSPECT = "OOD_SUSPECT"
    OOD_UNKNOWN = "OOD_UNKNOWN"
    SPECIALIST_MISSING = "SPECIALIST_MISSING"
    SPECIALIST_CONFLICT = "SPECIALIST_CONFLICT"
    COST_UNKNOWN = "COST_UNKNOWN"
    COST_NEGATIVE = "COST_NEGATIVE"
    COST_STRESS_UNSTABLE = "COST_STRESS_UNSTABLE"
    TIMING_UNKNOWN = "TIMING_UNKNOWN"
    CALIBRATION_UNAVAILABLE = "CALIBRATION_UNAVAILABLE"
    INTERVAL_UNAVAILABLE = "INTERVAL_UNAVAILABLE"
    COVERAGE_UNKNOWN = "COVERAGE_UNKNOWN"
    COVERAGE_COLLAPSED = "COVERAGE_COLLAPSED"


_REASON_ORDER: tuple[AbstentionReason, ...] = (
    AbstentionReason.EVIDENCE_STALE,
    AbstentionReason.EVIDENCE_INCOMPLETE,
    AbstentionReason.OOD_SUSPECT,
    AbstentionReason.OOD_UNKNOWN,
    AbstentionReason.SPECIALIST_MISSING,
    AbstentionReason.SPECIALIST_CONFLICT,
    AbstentionReason.COST_UNKNOWN,
    AbstentionReason.COST_NEGATIVE,
    AbstentionReason.COST_STRESS_UNSTABLE,
    AbstentionReason.TIMING_UNKNOWN,
    AbstentionReason.CALIBRATION_UNAVAILABLE,
    AbstentionReason.INTERVAL_UNAVAILABLE,
    AbstentionReason.COVERAGE_UNKNOWN,
    AbstentionReason.COVERAGE_COLLAPSED,
)


def _require_probability(value: ExactRatioV1, *, field: str) -> None:
    if not isinstance(value, ExactRatioV1):
        raise ContractValueError(f"{field} must be ExactRatioV1")
    if not 0 <= value.numerator <= value.denominator:
        raise ContractValueError(f"{field} must lie in [0, 1]")


@dataclass(frozen=True, slots=True)
class AbstentionContextV1:
    sample_id: str
    target_id: str
    horizon_ns: int
    assessment_samples: SampleSetV1
    disorder_evidence: BoundDisorderEvidenceV1
    ensemble_samples: SampleSetV1
    matrix: ValidatedOofMatrixV1
    fitted_stack: FittedStackV1
    assessment_fold_id: str
    present_specialist_ids: tuple[str, ...]
    calibrated_evidence: BoundCalibratedAssessmentV1 | None
    coverage_evidence: BoundCoverageEvidenceV1
    interval_evidence: BoundConformalAssessmentV1
    uncertainty: UncertaintyVectorV1
    stress_evidence: BoundStressEvidenceV1

    def __post_init__(self) -> None:
        require_contract_id(self.sample_id, field="sample_id")
        require_contract_id(self.target_id, field="target_id")
        require_strict_int(self.horizon_ns, field="horizon_ns", minimum=1)
        if not isinstance(self.assessment_samples, SampleSetV1):
            raise ContractValueError("assessment_samples must be SampleSetV1")
        if len(self.assessment_samples.samples) != 1:
            raise ContractValueError("assessment_samples must contain exactly one row")
        sample = self.assessment_samples.by_id(self.sample_id)
        if sample.label_horizon_ns != self.horizon_ns:
            raise ContractValueError("assessment sample horizon must match assessment horizon")
        if not isinstance(self.disorder_evidence, BoundDisorderEvidenceV1):
            raise ContractValueError("disorder_evidence must be BoundDisorderEvidenceV1")
        self.disorder_evidence.__post_init__()
        if self.disorder_evidence.assessment_samples != self.assessment_samples:
            raise ContractValueError("disorder evidence must bind the assessment samples")
        if not isinstance(self.ensemble_samples, SampleSetV1):
            raise ContractValueError("ensemble_samples must be SampleSetV1")
        if not isinstance(self.matrix, ValidatedOofMatrixV1):
            raise ContractValueError("matrix must be ValidatedOofMatrixV1")
        if not isinstance(self.fitted_stack, FittedStackV1):
            raise ContractValueError("fitted_stack must be FittedStackV1")
        self.matrix.__post_init__()
        self.fitted_stack.__post_init__()
        if (
            self.matrix.dataset_digest != self.ensemble_samples.digest()
            or self.fitted_stack.matrix_digest != self.matrix.digest()
            or self.matrix.target_id != self.target_id
            or self.matrix.horizon_ns != self.horizon_ns
            or self.fitted_stack.target_id != self.target_id
            or self.fitted_stack.horizon_ns != self.horizon_ns
            or self.expected_specialist_ids != self.matrix.specialist_ids
        ):
            raise ContractValueError("ensemble evidence must bind the fitted stack assessment")
        require_contract_id(self.assessment_fold_id, field="assessment_fold_id")
        if self.present_specialist_ids != tuple(sorted(set(self.present_specialist_ids))):
            raise ContractValueError("present_specialist_ids must be sorted and unique")
        if not set(self.present_specialist_ids).issubset(self.expected_specialist_ids):
            raise ContractValueError("present specialists must be a subset of fitted specialists")
        assessment_bundle = self.matrix.bundle(
            self.assessment_fold_id, self.expected_specialist_ids[0]
        )
        if self.sample_id not in {
            prediction.sample_id for prediction in assessment_bundle.predictions.predictions
        }:
            raise ContractValueError("assessment row must belong to the bound ensemble fold")
        for specialist_id in self.present_specialist_ids:
            predictions = self.matrix.bundle(self.assessment_fold_id, specialist_id).predictions
            prediction = predictions.score_for(self.sample_id)
            _require_probability(prediction.score, field="specialist probability")
        if self.calibrated_evidence is not None:
            if not isinstance(self.calibrated_evidence, BoundCalibratedAssessmentV1):
                raise ContractValueError(
                    "calibrated_evidence must be BoundCalibratedAssessmentV1 or None"
                )
            self.calibrated_evidence.__post_init__()
            if (
                self.calibrated_evidence.samples != self.ensemble_samples
                or self.calibrated_evidence.matrix != self.matrix
                or self.calibrated_evidence.fitted != self.fitted_stack
                or self.calibrated_evidence.assessment_fold_id != self.assessment_fold_id
                or self.calibrated_evidence.assessment_samples != self.assessment_samples
            ):
                raise ContractValueError("calibrated evidence must bind the ensemble assessment")
        if not isinstance(self.coverage_evidence, BoundCoverageEvidenceV1):
            raise ContractValueError("coverage_evidence must be BoundCoverageEvidenceV1")
        self.coverage_evidence.__post_init__()
        coverage = self.coverage_evidence.report
        if not isinstance(self.interval_evidence, BoundConformalAssessmentV1):
            raise ContractValueError("interval_evidence must be BoundConformalAssessmentV1")
        self.interval_evidence.__post_init__()
        if self.interval_evidence.base_observation.observation_id != self.sample_id:
            raise ContractValueError("conformal evidence must bind the exact assessment sample")
        if self.coverage_evidence.model_evidence != self.interval_evidence.model_evidence:
            raise ContractValueError("coverage and interval must bind the same conformal model")
        conformal_slices = (
            self.coverage_evidence.model_evidence.research_slice,
            self.coverage_evidence.research_slice,
            self.interval_evidence.research_slice,
        )
        if any(
            research_slice.matrix != self.matrix or research_slice.fitted_stack != self.fitted_stack
            for research_slice in conformal_slices
        ):
            raise ContractValueError(
                "conformal evidence must bind the ensemble matrix and fitted stack"
            )
        if self.sample_id in coverage.observation_ids or (
            coverage.outcome_maturity_ns is not None
            and coverage.outcome_maturity_ns >= sample.cutoff_ns
        ):
            raise ContractValueError("coverage evidence must be prior and disjoint from assessment")
        if not isinstance(self.uncertainty, UncertaintyVectorV1):
            raise ContractValueError("uncertainty must be UncertaintyVectorV1")
        if not isinstance(self.stress_evidence, BoundStressEvidenceV1):
            raise ContractValueError("stress_evidence must be BoundStressEvidenceV1")
        self.stress_evidence.__post_init__()
        if (
            self.stress_evidence.assessment_samples != self.assessment_samples
            or (
                self.stress_evidence.sample_id,
                self.stress_evidence.target_id,
                self.stress_evidence.horizon_ns,
            )
            != (self.sample_id, self.target_id, self.horizon_ns)
            or self.stress_evidence.digest() != self.uncertainty.stress_evidence_digest
        ):
            raise ContractValueError("stress and uncertainty must bind the assessment")
        if (
            self.uncertainty.sample_id,
            self.uncertainty.target_id,
            self.uncertainty.horizon_ns,
        ) != (self.sample_id, self.target_id, self.horizon_ns):
            raise ContractValueError("uncertainty lineage must bind the assessment")
        expected_uncertainty = decompose_uncertainty(
            disorder_evidence=self.disorder_evidence,
            specialist_probabilities=self.bound_specialist_probabilities,
            combined_probability=self.calibrated_probability,
            interval=self.interval,
            stress_evidence=self.stress_evidence,
        )
        if self.uncertainty != expected_uncertainty:
            raise ContractValueError(
                "uncertainty must equal the deterministic evidence decomposition"
            )

    @property
    def calibrated_probability(self) -> ExactRatioV1 | None:
        if self.calibrated_evidence is None:
            return None
        return self.calibrated_evidence.calibrated_probability

    @property
    def interval(self) -> PredictionIntervalV1:
        return self.interval_evidence.interval

    @property
    def expected_specialist_ids(self) -> tuple[str, ...]:
        """Specialist completeness comes only from the fitted stack owner."""

        return tuple(specialist_id for specialist_id, _ in self.fitted_stack.weights)

    @property
    def bound_specialist_probabilities(self) -> tuple[SpecialistProbabilityV1, ...]:
        """Project raw, digest-bound specialist outputs for deterministic decomposition."""

        return tuple(
            SpecialistProbabilityV1(
                specialist_id=specialist_id,
                probability=predictions.score_for(self.sample_id).score,
                sample_id=self.sample_id,
                target_id=self.target_id,
                horizon_ns=self.horizon_ns,
                source_dataset_digest=predictions.dataset_digest,
                source_prediction_digest=predictions.digest(),
            )
            for specialist_id in self.present_specialist_ids
            for predictions in (
                self.matrix.bundle(self.assessment_fold_id, specialist_id).predictions,
            )
        )

    def as_mapping(self) -> dict[str, object]:
        return {
            "assessmentFoldId": self.assessment_fold_id,
            "assessmentSamplesDigest": self.assessment_samples.digest().hexdigest,
            "calibratedEvidenceDigest": (
                None
                if self.calibrated_evidence is None
                else self.calibrated_evidence.digest().hexdigest
            ),
            "coverageEvidenceDigest": self.coverage_evidence.digest().hexdigest,
            "disorderEvidenceDigest": self.disorder_evidence.digest().hexdigest,
            "fittedStackDigest": self.fitted_stack.digest().hexdigest,
            "horizonNs": str(self.horizon_ns),
            "intervalEvidenceDigest": self.interval_evidence.digest().hexdigest,
            "matrixDigest": self.matrix.digest().hexdigest,
            "presentSpecialistIds": list(self.present_specialist_ids),
            "sampleId": self.sample_id,
            "stressEvidenceDigest": self.stress_evidence.digest().hexdigest,
            "targetId": self.target_id,
            "uncertainty": self.uncertainty.as_mapping(),
        }

    def digest(self) -> DigestV1:
        return DigestV1(hashlib.sha256(canonical_json_bytes(self.as_mapping())).hexdigest())


@dataclass(frozen=True, slots=True)
class _AssessmentDecisionV1:
    action: AdvisoryAction
    reasons: tuple[AbstentionReason, ...]
    calibrated_probability: ExactRatioV1 | None
    interval: PredictionIntervalV1 | None

    def __post_init__(self) -> None:
        if not isinstance(self.action, AdvisoryAction):
            raise ContractValueError("action must be AdvisoryAction")
        if any(not isinstance(reason, AbstentionReason) for reason in self.reasons):
            raise ContractValueError("reasons must contain AbstentionReason")
        if self.calibrated_probability is not None:
            _require_probability(self.calibrated_probability, field="calibrated_probability")
        if self.interval is not None and not isinstance(self.interval, PredictionIntervalV1):
            raise ContractValueError("interval must be PredictionIntervalV1 or None")
        expected_order = tuple(reason for reason in _REASON_ORDER if reason in self.reasons)
        if self.reasons != expected_order or len(set(self.reasons)) != len(self.reasons):
            raise ContractValueError("reasons must be unique and in frozen precedence order")
        if self.action is AdvisoryAction.ABSTAIN_UNKNOWN:
            if not self.reasons:
                raise ContractValueError("abstention requires at least one reason")
            if self.calibrated_probability is not None or self.interval is not None:
                raise ContractValueError("abstention must suppress probability and interval")
        else:
            if self.reasons:
                raise ContractValueError("WATCH carries no abstention reasons")
            if self.calibrated_probability is None or self.interval is None:
                raise ContractValueError("WATCH requires calibrated probability and interval")
            if self.interval.status is not ConformalStatus.AVAILABLE:
                raise ContractValueError("WATCH requires an available interval")

    def as_mapping(self) -> dict[str, object]:
        return {
            "action": self.action.value,
            "calibratedProbability": (
                None
                if self.calibrated_probability is None
                else self.calibrated_probability.as_mapping()
            ),
            "interval": None if self.interval is None else self.interval.as_mapping(),
            "reasons": [reason.value for reason in self.reasons],
            "schema": "Q12AssessmentDecisionV1",
        }


def _evaluate_advisory(context: AbstentionContextV1) -> _AssessmentDecisionV1:
    reasons: set[AbstentionReason] = set()
    quality = context.assessment_samples.samples[0].quality
    disposition = disposition_from_quality(quality)
    if quality is QualityState.STALE:
        reasons.add(AbstentionReason.EVIDENCE_STALE)
    elif disposition is not InputDisposition.ELIGIBLE:
        reasons.add(AbstentionReason.EVIDENCE_INCOMPLETE)
    disorder = context.disorder_evidence.assessment
    if disorder.state is DisorderState.OOD_SUSPECT:
        reasons.add(AbstentionReason.OOD_SUSPECT)
    elif disorder.state is DisorderState.UNKNOWN:
        reasons.add(AbstentionReason.OOD_UNKNOWN)
    actual_ids = tuple(item.specialist_id for item in context.uncertainty.specialist_probabilities)
    if actual_ids != context.expected_specialist_ids:
        reasons.add(AbstentionReason.SPECIALIST_MISSING)
    gap = context.uncertainty.maximum_pairwise_gap
    if gap is not None and gap.numerator * _CONFLICT_THRESHOLD.denominator >= (
        _CONFLICT_THRESHOLD.numerator * gap.denominator
    ):
        reasons.add(AbstentionReason.SPECIALIST_CONFLICT)
    if context.uncertainty.cost_fill_state is CostUncertaintyState.UNKNOWN:
        reasons.add(AbstentionReason.COST_UNKNOWN)
    elif context.uncertainty.cost_fill_state is CostUncertaintyState.NEGATIVE:
        reasons.add(AbstentionReason.COST_NEGATIVE)
    if context.uncertainty.timing_decay_state is TimingUncertaintyState.UNSTABLE:
        reasons.add(AbstentionReason.COST_STRESS_UNSTABLE)
    elif context.uncertainty.timing_decay_state is TimingUncertaintyState.UNKNOWN:
        reasons.add(AbstentionReason.TIMING_UNKNOWN)
    if context.calibrated_evidence is None:
        reasons.add(AbstentionReason.CALIBRATION_UNAVAILABLE)
    if context.interval.status is not ConformalStatus.AVAILABLE:
        reasons.add(AbstentionReason.INTERVAL_UNAVAILABLE)
    coverage = context.coverage_evidence.report
    if coverage.status is CoverageStatus.UNKNOWN:
        reasons.add(AbstentionReason.COVERAGE_UNKNOWN)
    elif coverage.status is CoverageStatus.COLLAPSED:
        reasons.add(AbstentionReason.COVERAGE_COLLAPSED)
    ordered_reasons = tuple(reason for reason in _REASON_ORDER if reason in reasons)
    if ordered_reasons:
        return _AssessmentDecisionV1(
            action=AdvisoryAction.ABSTAIN_UNKNOWN,
            reasons=ordered_reasons,
            calibrated_probability=None,
            interval=None,
        )
    calibrated_probability = context.calibrated_probability
    if calibrated_probability is None:
        raise AssertionError("non-abstaining context must carry calibrated evidence")
    return _AssessmentDecisionV1(
        action=AdvisoryAction.WATCH,
        reasons=(),
        calibrated_probability=calibrated_probability,
        interval=context.interval,
    )


@dataclass(frozen=True, slots=True)
class BoundAssessmentDecisionV1:
    """A decision retained with, and reproducible from, its complete evidence context."""

    context: AbstentionContextV1
    decision: _AssessmentDecisionV1

    def __post_init__(self) -> None:
        if not isinstance(self.context, AbstentionContextV1):
            raise ContractValueError("context must be AbstentionContextV1")
        if not isinstance(self.decision, _AssessmentDecisionV1):
            raise ContractValueError("decision must be the internal assessment decision")
        self.context.__post_init__()
        if self.decision != _evaluate_advisory(self.context):
            raise ContractValueError("decision must equal the deterministic advisory policy")

    @property
    def action(self) -> AdvisoryAction:
        return self.decision.action

    @property
    def reasons(self) -> tuple[AbstentionReason, ...]:
        return self.decision.reasons

    @property
    def calibrated_probability(self) -> ExactRatioV1 | None:
        return self.decision.calibrated_probability

    @property
    def interval(self) -> PredictionIntervalV1 | None:
        return self.decision.interval

    def as_mapping(self) -> dict[str, object]:
        return {
            "contextDigest": self.context.digest().hexdigest,
            "decision": self.decision.as_mapping(),
            "schema": "Q12BoundAssessmentDecisionV1",
        }


def decide_advisory(context: AbstentionContextV1) -> BoundAssessmentDecisionV1:
    """Evaluate every gate and retain the full evidence that reproduces the result."""

    if not isinstance(context, AbstentionContextV1):
        raise ContractValueError("context must be AbstentionContextV1")
    context.__post_init__()
    return BoundAssessmentDecisionV1(context=context, decision=_evaluate_advisory(context))
