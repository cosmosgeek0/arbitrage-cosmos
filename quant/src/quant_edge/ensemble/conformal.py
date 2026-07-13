"""Exact fixed-width canonical-stack split-conformal and adaptive challengers.

The static challenger starts from a declared fixed half-width around the canonical OOF
stack score, then applies a finite-sample split-conformal residual order statistic without
interpolation. It does not fit or claim learned conditional quantiles.
The adaptive challenger is explicitly labelled empirical/non-exchangeable: it predicts
from an ordered residual prefix, then updates alpha and the rolling residual window only
after that observation's outcome is available. Future outcomes cannot rewrite an earlier
prediction digest.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, replace
from enum import StrEnum
from fractions import Fraction
from typing import Final, cast

from quant_edge.canonical import canonical_json_bytes
from quant_edge.ensemble.stacking import (
    FittedStackV1,
    ValidatedOofMatrixV1,
    stack_predictions_for_folds,
)
from quant_edge.errors import ContractValueError
from quant_edge.labels.rational import ExactRatioV1, make_ratio
from quant_edge.lake.contracts import (
    DigestV1,
    require_contract_id,
    require_reason_code,
    require_strict_int,
)
from quant_edge.validation import (
    FoldStatus,
    PlanStatus,
    PredictionSetV1,
    SampleSetV1,
    WalkForwardPlanV1,
)

MAX_CONFORMAL_SUPPORT: Final = 100_000
MAX_ADAPTIVE_WINDOW: Final = 4_096
MAX_CONFORMAL_FOLDS: Final = 32
EMPIRICAL_NONEXCHANGEABLE: Final = "EMPIRICAL_NONEXCHANGEABLE_CHALLENGER"


def _fraction(value: ExactRatioV1) -> Fraction:
    return Fraction(value.numerator, value.denominator)


def _ratio(value: Fraction) -> ExactRatioV1:
    return make_ratio(value.numerator, value.denominator)


def _require_unit_ratio(value: ExactRatioV1, *, field: str, open_interval: bool) -> None:
    if not isinstance(value, ExactRatioV1):
        raise ContractValueError(f"{field} must be ExactRatioV1")
    lower_ok = value.numerator > 0 if open_interval else value.numerator >= 0
    upper_ok = (
        value.numerator < value.denominator
        if open_interval
        else (value.numerator <= value.denominator)
    )
    if not lower_ok or not upper_ok:
        bounds = "(0, 1)" if open_interval else "[0, 1]"
        raise ContractValueError(f"{field} must lie in {bounds}")


@dataclass(frozen=True, slots=True)
class IntervalObservationV1:
    observation_id: str
    prediction_time_ns: int
    outcome_time_ns: int
    lower: ExactRatioV1
    upper: ExactRatioV1
    outcome: ExactRatioV1 | None
    regime_id: str
    cohort_id: str
    horizon_ns: int

    def __post_init__(self) -> None:
        require_contract_id(self.observation_id, field="observation_id")
        require_strict_int(self.prediction_time_ns, field="prediction_time_ns", minimum=0)
        require_strict_int(self.outcome_time_ns, field="outcome_time_ns", minimum=0)
        if not isinstance(self.lower, ExactRatioV1) or not isinstance(self.upper, ExactRatioV1):
            raise ContractValueError("interval bounds must be ExactRatioV1")
        if _fraction(self.lower) > _fraction(self.upper):
            raise ContractValueError("base interval lower cannot exceed upper")
        if self.outcome is not None and not isinstance(self.outcome, ExactRatioV1):
            raise ContractValueError("outcome must be ExactRatioV1 or None")
        require_contract_id(self.regime_id, field="regime_id")
        require_contract_id(self.cohort_id, field="cohort_id")
        require_strict_int(self.horizon_ns, field="horizon_ns", minimum=1)
        if self.outcome_time_ns != self.prediction_time_ns + self.horizon_ns:
            raise ContractValueError("outcome_time_ns must equal prediction_time_ns + horizon_ns")

    def nonconformity(self) -> ExactRatioV1 | None:
        if self.outcome is None:
            return None
        value = max(
            Fraction(0),
            _fraction(self.lower) - _fraction(self.outcome),
            _fraction(self.outcome) - _fraction(self.upper),
        )
        return _ratio(value)

    def as_mapping(self) -> dict[str, object]:
        return {
            "cohortId": self.cohort_id,
            "horizonNs": str(self.horizon_ns),
            "lower": self.lower.as_mapping(),
            "observationId": self.observation_id,
            "outcome": None if self.outcome is None else self.outcome.as_mapping(),
            "outcomeTimeNs": str(self.outcome_time_ns),
            "predictionTimeNs": str(self.prediction_time_ns),
            "regimeId": self.regime_id,
            "upper": self.upper.as_mapping(),
        }


class ConformalStatus(StrEnum):
    AVAILABLE = "AVAILABLE"
    UNKNOWN = "UNKNOWN"


@dataclass(frozen=True, slots=True)
class ConformalResearchSliceV1:
    """Exact Q14 and canonical stack provenance for conformal fit or application."""

    samples: SampleSetV1
    plan: WalkForwardPlanV1
    target_id: str
    fold_ids: tuple[str, ...]
    matrix: ValidatedOofMatrixV1
    fitted_stack: FittedStackV1
    base_half_width: ExactRatioV1

    def __post_init__(self) -> None:
        if not isinstance(self.samples, SampleSetV1):
            raise ContractValueError("samples must be SampleSetV1")
        if not isinstance(self.plan, WalkForwardPlanV1) or self.plan.status is not PlanStatus.VALID:
            raise ContractValueError("plan must be a valid WalkForwardPlanV1")
        if self.plan.dataset_digest != self.samples.digest():
            raise ContractValueError("conformal research plan binds a different sample set")
        require_contract_id(self.target_id, field="target_id")
        if not isinstance(self.fold_ids, tuple) or not self.fold_ids:
            raise ContractValueError("fold_ids must be a non-empty tuple")
        if len(self.fold_ids) > MAX_CONFORMAL_FOLDS:
            raise ContractValueError("fold_ids exceeds MAX_CONFORMAL_FOLDS")
        if self.fold_ids != tuple(sorted(set(self.fold_ids))):
            raise ContractValueError("fold_ids must be sorted and unique")
        valid = {fold.fold_id: fold for fold in self.plan.folds if fold.status is FoldStatus.VALID}
        if not set(self.fold_ids).issubset(valid):
            raise ContractValueError("conformal fold_ids must name valid Q14 folds")
        sample_ids = tuple(
            sample_id
            for fold_id in self.fold_ids
            for sample_id in valid[fold_id].validation_sample_ids
        )
        if not sample_ids or len(sample_ids) != len(set(sample_ids)):
            raise ContractValueError("conformal validation rows must be globally exact-once")
        forbidden = set(self.plan.holdout_sample_ids) | set(self.plan.quarantined_sample_ids)
        if forbidden.intersection(sample_ids):
            raise ContractValueError("holdout/quarantined rows cannot enter a conformal slice")
        horizons = {self.samples.by_id(sample_id).label_horizon_ns for sample_id in sample_ids}
        if not isinstance(self.matrix, ValidatedOofMatrixV1):
            raise ContractValueError("matrix must be ValidatedOofMatrixV1")
        if not isinstance(self.fitted_stack, FittedStackV1):
            raise ContractValueError("fitted_stack must be FittedStackV1")
        _require_unit_ratio(self.base_half_width, field="base_half_width", open_interval=True)
        if self.matrix.samples != self.samples or self.matrix.plan != self.plan:
            raise ContractValueError("conformal matrix must bind the exact samples and plan")
        if (
            self.matrix.target_id != self.target_id
            or self.matrix.horizon_ns != next(iter(horizons))
            or self.fitted_stack.matrix_digest != self.matrix.digest()
            or self.fitted_stack.target_id != self.target_id
            or self.fitted_stack.horizon_ns != next(iter(horizons))
        ):
            raise ContractValueError("conformal stack source must bind target and horizon")
        self.canonical_stack_slice()

    @property
    def validation_sample_ids(self) -> tuple[str, ...]:
        valid = {fold.fold_id: fold for fold in self.plan.folds if fold.status is FoldStatus.VALID}
        return tuple(
            sample_id
            for fold_id in self.fold_ids
            for sample_id in valid[fold_id].validation_sample_ids
        )

    @property
    def horizon_ns(self) -> int:
        return self.samples.by_id(self.validation_sample_ids[0]).label_horizon_ns

    def fold_for(self, sample_id: str) -> str:
        matches = tuple(
            fold.fold_id
            for fold in self.plan.folds
            if fold.fold_id in self.fold_ids and sample_id in fold.validation_sample_ids
        )
        if len(matches) != 1:
            raise ContractValueError(
                "sample_id must belong to exactly one conformal validation fold"
            )
        return matches[0]

    def canonical_stack_slice(self) -> tuple[SampleSetV1, PredictionSetV1]:
        return stack_predictions_for_folds(
            samples=self.samples,
            matrix=self.matrix,
            fitted=self.fitted_stack,
            fold_ids=self.fold_ids,
        )

    def base_score_for(self, sample_id: str) -> ExactRatioV1:
        self.fold_for(sample_id)
        _, predictions = self.canonical_stack_slice()
        return predictions.score_for(sample_id).score

    def as_mapping(self) -> dict[str, object]:
        return {
            "baseHalfWidth": self.base_half_width.as_mapping(),
            "datasetDigest": self.samples.digest().hexdigest,
            "fittedStackDigest": self.fitted_stack.digest().hexdigest,
            "foldIds": list(self.fold_ids),
            "horizonNs": str(self.horizon_ns),
            "matrixDigest": self.matrix.digest().hexdigest,
            "planDigest": self.plan.digest().hexdigest,
            "schema": "Q12ConformalResearchSliceV1",
            "targetId": self.target_id,
            "validationSampleIds": list(self.validation_sample_ids),
        }

    def digest(self) -> DigestV1:
        return DigestV1(
            hexdigest=hashlib.sha256(canonical_json_bytes(self.as_mapping())).hexdigest()
        )


def _validate_observation_for_slice(
    observation: IntervalObservationV1,
    research_slice: ConformalResearchSliceV1,
    source_predictions: PredictionSetV1 | None = None,
) -> None:
    if not isinstance(observation, IntervalObservationV1):
        raise ContractValueError("observations must contain IntervalObservationV1")
    sample = research_slice.samples.by_id(observation.observation_id)
    research_slice.fold_for(observation.observation_id)
    if (
        observation.prediction_time_ns != sample.cutoff_ns
        or observation.outcome_time_ns != sample.label_end_ns
        or observation.horizon_ns != sample.label_horizon_ns
    ):
        raise ContractValueError("conformal observation must bind Q14 sample time and horizon")
    if source_predictions is None:
        _, source_predictions = research_slice.canonical_stack_slice()
    base_score = _fraction(source_predictions.score_for(observation.observation_id).score)
    half_width = _fraction(research_slice.base_half_width)
    if observation.lower != _ratio(base_score - half_width) or observation.upper != _ratio(
        base_score + half_width
    ):
        raise ContractValueError("conformal base bounds must equal the canonical stack source")
    if observation.outcome is not None:
        if sample.binary_outcome is None:
            raise ContractValueError("known conformal outcome requires a known Q14 binary outcome")
        binary_outcome = sample.binary_outcome
        expected_outcome = make_ratio(int(binary_outcome), 1)
        if observation.outcome != expected_outcome:
            raise ContractValueError(
                "known conformal outcome must equal the exact Q14 binary outcome"
            )


@dataclass(frozen=True, slots=True)
class ConformalSpecV1:
    alpha: ExactRatioV1
    min_support: int

    def __post_init__(self) -> None:
        _require_unit_ratio(self.alpha, field="alpha", open_interval=True)
        require_strict_int(
            self.min_support,
            field="min_support",
            minimum=2,
            maximum=MAX_CONFORMAL_SUPPORT,
        )

    def as_mapping(self) -> dict[str, object]:
        return {"alpha": self.alpha.as_mapping(), "minSupport": self.min_support}


@dataclass(frozen=True, slots=True)
class ConformalModelV1:
    status: ConformalStatus
    reason: str | None
    alpha: ExactRatioV1
    min_support: int
    base_half_width: ExactRatioV1
    adjustment: ExactRatioV1 | None
    support: int
    calibration_digest: DigestV1
    calibration_outcome_maturity_ns: int | None
    regime_id: str
    cohort_id: str
    horizon_ns: int
    target_id: str
    dataset_digest: DigestV1
    plan_digest: DigestV1
    matrix_digest: DigestV1
    fitted_stack_digest: DigestV1
    fit_fold_ids: tuple[str, ...]
    semantics: str = EMPIRICAL_NONEXCHANGEABLE

    def __post_init__(self) -> None:
        if not isinstance(self.status, ConformalStatus):
            raise ContractValueError("status must be ConformalStatus")
        _require_unit_ratio(self.alpha, field="alpha", open_interval=True)
        _require_unit_ratio(self.base_half_width, field="base_half_width", open_interval=True)
        require_strict_int(
            self.min_support,
            field="min_support",
            minimum=2,
            maximum=MAX_CONFORMAL_SUPPORT,
        )
        require_strict_int(self.support, field="support", minimum=0)
        if not isinstance(self.calibration_digest, DigestV1):
            raise ContractValueError("calibration_digest must be DigestV1")
        if self.calibration_outcome_maturity_ns is not None:
            require_strict_int(
                self.calibration_outcome_maturity_ns,
                field="calibration_outcome_maturity_ns",
                minimum=0,
            )
        require_contract_id(self.regime_id, field="regime_id")
        require_contract_id(self.cohort_id, field="cohort_id")
        require_strict_int(self.horizon_ns, field="horizon_ns", minimum=1)
        require_contract_id(self.target_id, field="target_id")
        if any(
            not isinstance(digest, DigestV1)
            for digest in (
                self.dataset_digest,
                self.plan_digest,
                self.matrix_digest,
                self.fitted_stack_digest,
            )
        ):
            raise ContractValueError("conformal provenance digests must be DigestV1")
        if not isinstance(self.fit_fold_ids, tuple) or not self.fit_fold_ids:
            raise ContractValueError("fit_fold_ids must be a non-empty tuple")
        if self.fit_fold_ids != tuple(sorted(set(self.fit_fold_ids))):
            raise ContractValueError("fit_fold_ids must be sorted and unique")
        if self.semantics != EMPIRICAL_NONEXCHANGEABLE:
            raise ContractValueError("time-series conformal semantics are frozen")
        available = self.status is ConformalStatus.AVAILABLE
        if available != (self.adjustment is not None and self.reason is None):
            raise ContractValueError("conformal availability must match adjustment/reason")
        if not available and self.reason is None:
            raise ContractValueError("UNKNOWN conformal model requires a reason")
        if available and self.calibration_outcome_maturity_ns is None:
            raise ContractValueError("available conformal model requires outcome maturity")
        if self.adjustment is not None:
            if not isinstance(self.adjustment, ExactRatioV1):
                raise ContractValueError("adjustment must be ExactRatioV1 or None")
            if _fraction(self.adjustment) < 0:
                raise ContractValueError("adjustment cannot be negative")
        if self.reason is not None:
            require_reason_code(self.reason, field="reason")

    def as_mapping(self) -> dict[str, object]:
        return {
            "adjustment": None if self.adjustment is None else self.adjustment.as_mapping(),
            "alpha": self.alpha.as_mapping(),
            "baseHalfWidth": self.base_half_width.as_mapping(),
            "minSupport": self.min_support,
            "calibrationDigest": self.calibration_digest.hexdigest,
            "calibrationOutcomeMaturityNs": (
                None
                if self.calibration_outcome_maturity_ns is None
                else str(self.calibration_outcome_maturity_ns)
            ),
            "cohortId": self.cohort_id,
            "horizonNs": str(self.horizon_ns),
            "targetId": self.target_id,
            "datasetDigest": self.dataset_digest.hexdigest,
            "fittedStackDigest": self.fitted_stack_digest.hexdigest,
            "matrixDigest": self.matrix_digest.hexdigest,
            "planDigest": self.plan_digest.hexdigest,
            "fitFoldIds": list(self.fit_fold_ids),
            "reason": self.reason,
            "regimeId": self.regime_id,
            "schema": "Q12ConformalModelV1",
            "semantics": self.semantics,
            "status": self.status.value,
            "support": self.support,
        }


def _observations_digest(observations: tuple[IntervalObservationV1, ...]) -> DigestV1:
    return DigestV1(
        hexdigest=hashlib.sha256(
            canonical_json_bytes([observation.as_mapping() for observation in observations])
        ).hexdigest()
    )


def _rank(alpha: ExactRatioV1, support: int) -> int:
    retained_numerator = alpha.denominator - alpha.numerator
    numerator = (support + 1) * retained_numerator
    return (numerator + alpha.denominator - 1) // alpha.denominator


def fit_conformal(
    observations: tuple[IntervalObservationV1, ...],
    spec: ConformalSpecV1,
    *,
    research_slice: ConformalResearchSliceV1,
) -> ConformalModelV1:
    """Fit an exact split-conformal adjustment around canonical fixed-width bounds."""

    if not isinstance(observations, tuple) or not observations:
        raise ContractValueError("observations must be a non-empty tuple")
    if len(observations) > MAX_CONFORMAL_SUPPORT:
        raise ContractValueError("observation count exceeds MAX_CONFORMAL_SUPPORT")
    if not isinstance(spec, ConformalSpecV1):
        raise ContractValueError("spec must be ConformalSpecV1")
    if not isinstance(research_slice, ConformalResearchSliceV1):
        raise ContractValueError("research_slice must be ConformalResearchSliceV1")
    if any(not isinstance(observation, IntervalObservationV1) for observation in observations):
        raise ContractValueError("observations must contain IntervalObservationV1")
    if len(observations) != len(research_slice.validation_sample_ids) or {
        observation.observation_id for observation in observations
    } != set(research_slice.validation_sample_ids):
        raise ContractValueError("conformal fit must cover the exact research-slice rows")
    previous_time: int | None = None
    scores: list[Fraction] = []
    known_outcome_times: list[int] = []
    identities: set[tuple[str, str, int]] = set()
    _, source_predictions = research_slice.canonical_stack_slice()
    for observation in observations:
        _validate_observation_for_slice(observation, research_slice, source_predictions)
        if previous_time is not None and observation.prediction_time_ns <= previous_time:
            raise ContractValueError("observations must be strictly prediction-time ordered")
        previous_time = observation.prediction_time_ns
        identities.add((observation.regime_id, observation.cohort_id, observation.horizon_ns))
        score = observation.nonconformity()
        if score is None:
            raise ContractValueError("conformal fit requires every outcome to be known")
        scores.append(_fraction(score))
        known_outcome_times.append(observation.outcome_time_ns)
    if len(identities) != 1:
        raise ContractValueError("conformal fit requires one regime/cohort/horizon")
    regime_id, cohort_id, horizon_ns = next(iter(identities))
    outcome_maturity_ns = max(known_outcome_times) if known_outcome_times else None
    digest = _observations_digest(observations)
    if len(scores) < spec.min_support:
        return ConformalModelV1(
            status=ConformalStatus.UNKNOWN,
            reason="INSUFFICIENT_CONFORMAL_SUPPORT",
            alpha=spec.alpha,
            min_support=spec.min_support,
            base_half_width=research_slice.base_half_width,
            adjustment=None,
            support=len(scores),
            calibration_digest=digest,
            calibration_outcome_maturity_ns=outcome_maturity_ns,
            regime_id=regime_id,
            cohort_id=cohort_id,
            horizon_ns=horizon_ns,
            target_id=research_slice.target_id,
            dataset_digest=research_slice.samples.digest(),
            plan_digest=research_slice.plan.digest(),
            matrix_digest=research_slice.matrix.digest(),
            fitted_stack_digest=research_slice.fitted_stack.digest(),
            fit_fold_ids=research_slice.fold_ids,
        )
    rank = _rank(spec.alpha, len(scores))
    if rank > len(scores):
        return ConformalModelV1(
            status=ConformalStatus.UNKNOWN,
            reason="INSUFFICIENT_FINITE_SAMPLE_RANK",
            alpha=spec.alpha,
            min_support=spec.min_support,
            base_half_width=research_slice.base_half_width,
            adjustment=None,
            support=len(scores),
            calibration_digest=digest,
            calibration_outcome_maturity_ns=outcome_maturity_ns,
            regime_id=regime_id,
            cohort_id=cohort_id,
            horizon_ns=horizon_ns,
            target_id=research_slice.target_id,
            dataset_digest=research_slice.samples.digest(),
            plan_digest=research_slice.plan.digest(),
            matrix_digest=research_slice.matrix.digest(),
            fitted_stack_digest=research_slice.fitted_stack.digest(),
            fit_fold_ids=research_slice.fold_ids,
        )
    adjustment = sorted(scores)[rank - 1]
    return ConformalModelV1(
        status=ConformalStatus.AVAILABLE,
        reason=None,
        alpha=spec.alpha,
        min_support=spec.min_support,
        base_half_width=research_slice.base_half_width,
        adjustment=_ratio(adjustment),
        support=len(scores),
        calibration_digest=digest,
        calibration_outcome_maturity_ns=outcome_maturity_ns,
        regime_id=regime_id,
        cohort_id=cohort_id,
        horizon_ns=horizon_ns,
        target_id=research_slice.target_id,
        dataset_digest=research_slice.samples.digest(),
        plan_digest=research_slice.plan.digest(),
        matrix_digest=research_slice.matrix.digest(),
        fitted_stack_digest=research_slice.fitted_stack.digest(),
        fit_fold_ids=research_slice.fold_ids,
    )


@dataclass(frozen=True, slots=True)
class PredictionIntervalV1:
    observation_id: str
    prediction_time_ns: int
    regime_id: str
    cohort_id: str
    horizon_ns: int
    status: ConformalStatus
    reason: str | None
    lower: ExactRatioV1 | None
    upper: ExactRatioV1 | None
    model_digest: DigestV1
    target_id: str
    dataset_digest: DigestV1
    plan_digest: DigestV1
    source_fold_id: str

    def __post_init__(self) -> None:
        require_contract_id(self.observation_id, field="observation_id")
        require_strict_int(self.prediction_time_ns, field="prediction_time_ns", minimum=0)
        require_contract_id(self.regime_id, field="regime_id")
        require_contract_id(self.cohort_id, field="cohort_id")
        require_strict_int(self.horizon_ns, field="horizon_ns", minimum=1)
        if not isinstance(self.status, ConformalStatus):
            raise ContractValueError("status must be ConformalStatus")
        if not isinstance(self.model_digest, DigestV1):
            raise ContractValueError("model_digest must be DigestV1")
        require_contract_id(self.target_id, field="target_id")
        require_contract_id(self.source_fold_id, field="source_fold_id")
        if not isinstance(self.dataset_digest, DigestV1) or not isinstance(
            self.plan_digest, DigestV1
        ):
            raise ContractValueError("interval provenance digests must be DigestV1")
        available = self.status is ConformalStatus.AVAILABLE
        if available != (self.reason is None and self.lower is not None and self.upper is not None):
            raise ContractValueError("interval availability must match bounds/reason")
        if not available and self.reason is None:
            raise ContractValueError("UNKNOWN interval requires a reason")
        if self.reason is not None:
            require_reason_code(self.reason, field="reason")
        if self.lower is not None and not isinstance(self.lower, ExactRatioV1):
            raise ContractValueError("lower must be ExactRatioV1 or None")
        if self.upper is not None and not isinstance(self.upper, ExactRatioV1):
            raise ContractValueError("upper must be ExactRatioV1 or None")
        if (
            self.lower is not None
            and self.upper is not None
            and _fraction(self.lower) > _fraction(self.upper)
        ):
            raise ContractValueError("available interval cannot cross")

    def as_mapping(self) -> dict[str, object]:
        return {
            "cohortId": self.cohort_id,
            "horizonNs": str(self.horizon_ns),
            "targetId": self.target_id,
            "datasetDigest": self.dataset_digest.hexdigest,
            "planDigest": self.plan_digest.hexdigest,
            "sourceFoldId": self.source_fold_id,
            "lower": None if self.lower is None else self.lower.as_mapping(),
            "modelDigest": self.model_digest.hexdigest,
            "observationId": self.observation_id,
            "predictionTimeNs": str(self.prediction_time_ns),
            "reason": self.reason,
            "regimeId": self.regime_id,
            "status": self.status.value,
            "upper": None if self.upper is None else self.upper.as_mapping(),
        }


def _model_digest(model: ConformalModelV1) -> DigestV1:
    return DigestV1(hexdigest=hashlib.sha256(canonical_json_bytes(model.as_mapping())).hexdigest())


def _apply_conformal_model(
    model: ConformalModelV1,
    lower: ExactRatioV1,
    upper: ExactRatioV1,
    *,
    observation_id: str,
    prediction_time_ns: int,
    research_slice: ConformalResearchSliceV1,
    source_predictions: PredictionSetV1 | None = None,
) -> PredictionIntervalV1:
    if not isinstance(model, ConformalModelV1):
        raise ContractValueError("model must be ConformalModelV1")
    if not isinstance(lower, ExactRatioV1) or not isinstance(upper, ExactRatioV1):
        raise ContractValueError("base interval bounds must be ExactRatioV1")
    require_contract_id(observation_id, field="observation_id")
    require_strict_int(prediction_time_ns, field="prediction_time_ns", minimum=0)
    if not isinstance(research_slice, ConformalResearchSliceV1):
        raise ContractValueError("research_slice must be ConformalResearchSliceV1")
    if (
        research_slice.target_id != model.target_id
        or research_slice.samples.digest() != model.dataset_digest
        or research_slice.plan.digest() != model.plan_digest
        or research_slice.matrix.digest() != model.matrix_digest
        or research_slice.fitted_stack.digest() != model.fitted_stack_digest
        or research_slice.horizon_ns != model.horizon_ns
        or research_slice.base_half_width != model.base_half_width
    ):
        raise ContractValueError("conformal application provenance does not match the model")
    if set(research_slice.fold_ids).intersection(model.fit_fold_ids):
        raise ContractValueError("conformal application folds must be disjoint from fit folds")
    plan_order = tuple(
        fold.fold_id for fold in research_slice.plan.folds if fold.status is FoldStatus.VALID
    )
    if min(plan_order.index(fold_id) for fold_id in research_slice.fold_ids) <= max(
        plan_order.index(fold_id) for fold_id in model.fit_fold_ids
    ):
        raise ContractValueError(
            "conformal application folds must be strictly later than fit folds"
        )
    sample = research_slice.samples.by_id(observation_id)
    source_fold_id = research_slice.fold_for(observation_id)
    if prediction_time_ns != sample.cutoff_ns:
        raise ContractValueError("prediction_time_ns must equal the Q14 sample cutoff")
    if source_predictions is None:
        _, source_predictions = research_slice.canonical_stack_slice()
    base_score = _fraction(source_predictions.score_for(observation_id).score)
    half_width = _fraction(research_slice.base_half_width)
    if lower != _ratio(base_score - half_width) or upper != _ratio(base_score + half_width):
        raise ContractValueError("base interval bounds must equal the canonical stack source")
    digest = _model_digest(model)
    if (
        model.calibration_outcome_maturity_ns is not None
        and prediction_time_ns <= model.calibration_outcome_maturity_ns
    ):
        return PredictionIntervalV1(
            observation_id=observation_id,
            prediction_time_ns=prediction_time_ns,
            regime_id=model.regime_id,
            cohort_id=model.cohort_id,
            horizon_ns=model.horizon_ns,
            status=ConformalStatus.UNKNOWN,
            reason="CALIBRATION_OUTCOME_NOT_MATURE",
            lower=None,
            upper=None,
            model_digest=digest,
            target_id=model.target_id,
            dataset_digest=model.dataset_digest,
            plan_digest=model.plan_digest,
            source_fold_id=source_fold_id,
        )
    if model.status is not ConformalStatus.AVAILABLE or model.adjustment is None:
        return PredictionIntervalV1(
            observation_id=observation_id,
            prediction_time_ns=prediction_time_ns,
            regime_id=model.regime_id,
            cohort_id=model.cohort_id,
            horizon_ns=model.horizon_ns,
            status=ConformalStatus.UNKNOWN,
            reason="CONFORMAL_MODEL_UNAVAILABLE",
            lower=None,
            upper=None,
            model_digest=digest,
            target_id=model.target_id,
            dataset_digest=model.dataset_digest,
            plan_digest=model.plan_digest,
            source_fold_id=source_fold_id,
        )
    adjusted_lower = _fraction(lower) - _fraction(model.adjustment)
    adjusted_upper = _fraction(upper) + _fraction(model.adjustment)
    return PredictionIntervalV1(
        observation_id=observation_id,
        prediction_time_ns=prediction_time_ns,
        regime_id=model.regime_id,
        cohort_id=model.cohort_id,
        horizon_ns=model.horizon_ns,
        status=ConformalStatus.AVAILABLE,
        reason=None,
        lower=_ratio(adjusted_lower),
        upper=_ratio(adjusted_upper),
        model_digest=digest,
        target_id=model.target_id,
        dataset_digest=model.dataset_digest,
        plan_digest=model.plan_digest,
        source_fold_id=source_fold_id,
    )


@dataclass(frozen=True, slots=True)
class BoundConformalModelEvidenceV1:
    """Exact Q14 fit inputs whose deterministic recomputation proves a model."""

    observations: tuple[IntervalObservationV1, ...]
    spec: ConformalSpecV1
    research_slice: ConformalResearchSliceV1
    model: ConformalModelV1

    def __post_init__(self) -> None:
        if not isinstance(self.spec, ConformalSpecV1):
            raise ContractValueError("spec must be ConformalSpecV1")
        if not isinstance(self.research_slice, ConformalResearchSliceV1):
            raise ContractValueError("research_slice must be ConformalResearchSliceV1")
        if not isinstance(self.model, ConformalModelV1):
            raise ContractValueError("model must be ConformalModelV1")
        recomputed = fit_conformal(
            self.observations,
            self.spec,
            research_slice=self.research_slice,
        )
        if recomputed != self.model:
            raise ContractValueError(
                "conformal model must equal fit_conformal over the exact bound evidence"
            )

    def as_mapping(self) -> dict[str, object]:
        return {
            "model": self.model.as_mapping(),
            "observations": [observation.as_mapping() for observation in self.observations],
            "researchSlice": self.research_slice.as_mapping(),
            "schema": "Q12BoundConformalModelEvidenceV1",
            "spec": self.spec.as_mapping(),
        }

    def digest(self) -> DigestV1:
        return DigestV1(
            hexdigest=hashlib.sha256(canonical_json_bytes(self.as_mapping())).hexdigest()
        )


def _validated_model_from_evidence(
    model_evidence: BoundConformalModelEvidenceV1,
) -> ConformalModelV1:
    """Recompute public evidence even when an unsafe constructor bypassed post-init."""

    if not isinstance(model_evidence, BoundConformalModelEvidenceV1):
        raise ContractValueError("model_evidence must be BoundConformalModelEvidenceV1")
    try:
        if not isinstance(model_evidence.model, ConformalModelV1):
            raise ContractValueError("bound conformal model must be ConformalModelV1")
        recomputed = fit_conformal(
            model_evidence.observations,
            model_evidence.spec,
            research_slice=model_evidence.research_slice,
        )
    except AttributeError as exc:
        raise ContractValueError("model_evidence must contain complete bound evidence") from exc
    if recomputed != model_evidence.model:
        raise ContractValueError(
            "conformal model must equal fit_conformal over the exact bound evidence"
        )
    return recomputed


def apply_conformal(
    model_evidence: BoundConformalModelEvidenceV1,
    lower: ExactRatioV1,
    upper: ExactRatioV1,
    *,
    observation_id: str,
    prediction_time_ns: int,
    research_slice: ConformalResearchSliceV1,
) -> PredictionIntervalV1:
    """Apply only a canonically recomputable conformal model to canonical stack bounds."""

    model = _validated_model_from_evidence(model_evidence)
    return _apply_conformal_model(
        model,
        lower,
        upper,
        observation_id=observation_id,
        prediction_time_ns=prediction_time_ns,
        research_slice=research_slice,
    )


@dataclass(frozen=True, slots=True)
class BoundConformalAssessmentV1:
    """One pending Q14 row bound to the exact static conformal interval it produced."""

    model_evidence: BoundConformalModelEvidenceV1
    base_observation: IntervalObservationV1
    research_slice: ConformalResearchSliceV1
    interval: PredictionIntervalV1

    def __post_init__(self) -> None:
        if not isinstance(self.model_evidence, BoundConformalModelEvidenceV1):
            raise ContractValueError("model_evidence must be BoundConformalModelEvidenceV1")
        if not isinstance(self.base_observation, IntervalObservationV1):
            raise ContractValueError("base_observation must be IntervalObservationV1")
        if not isinstance(self.research_slice, ConformalResearchSliceV1):
            raise ContractValueError("research_slice must be ConformalResearchSliceV1")
        if not isinstance(self.interval, PredictionIntervalV1):
            raise ContractValueError("interval must be PredictionIntervalV1")
        model = _validated_model_from_evidence(self.model_evidence)
        if (
            self.research_slice.matrix != self.model_evidence.research_slice.matrix
            or self.research_slice.fitted_stack != self.model_evidence.research_slice.fitted_stack
            or self.research_slice.base_half_width
            != self.model_evidence.research_slice.base_half_width
        ):
            raise ContractValueError("assessment must retain the conformal fit stack source")
        if self.base_observation.outcome is not None:
            raise ContractValueError("conformal assessment base observation must be outcome-free")
        _, source_predictions = self.research_slice.canonical_stack_slice()
        _validate_observation_for_slice(
            self.base_observation,
            self.research_slice,
            source_predictions,
        )
        if (
            self.base_observation.regime_id,
            self.base_observation.cohort_id,
            self.base_observation.horizon_ns,
        ) != (model.regime_id, model.cohort_id, model.horizon_ns):
            raise ContractValueError("assessment observation context must match the fitted model")
        recomputed = _apply_conformal_model(
            model,
            self.base_observation.lower,
            self.base_observation.upper,
            observation_id=self.base_observation.observation_id,
            prediction_time_ns=self.base_observation.prediction_time_ns,
            research_slice=self.research_slice,
            source_predictions=source_predictions,
        )
        if recomputed != self.interval:
            raise ContractValueError(
                "assessment interval must equal apply_conformal over the exact bound evidence"
            )

    def as_mapping(self) -> dict[str, object]:
        return {
            "baseObservation": self.base_observation.as_mapping(),
            "interval": self.interval.as_mapping(),
            "modelEvidence": self.model_evidence.as_mapping(),
            "researchSlice": self.research_slice.as_mapping(),
            "schema": "Q12BoundConformalAssessmentV1",
        }

    def digest(self) -> DigestV1:
        return DigestV1(
            hexdigest=hashlib.sha256(canonical_json_bytes(self.as_mapping())).hexdigest()
        )

    @property
    def model(self) -> ConformalModelV1:
        return _validated_model_from_evidence(self.model_evidence)


@dataclass(frozen=True, slots=True)
class AdaptiveConformalConfigV1:
    target_alpha: ExactRatioV1
    gamma: ExactRatioV1
    min_alpha: ExactRatioV1
    max_alpha: ExactRatioV1
    window_size: int
    min_support: int

    def __post_init__(self) -> None:
        _require_unit_ratio(self.target_alpha, field="target_alpha", open_interval=True)
        _require_unit_ratio(self.gamma, field="gamma", open_interval=True)
        _require_unit_ratio(self.min_alpha, field="min_alpha", open_interval=True)
        _require_unit_ratio(self.max_alpha, field="max_alpha", open_interval=True)
        if not _fraction(self.min_alpha) < _fraction(self.target_alpha) < _fraction(self.max_alpha):
            raise ContractValueError("target_alpha must lie strictly inside adaptive bounds")
        require_strict_int(
            self.window_size,
            field="window_size",
            minimum=2,
            maximum=MAX_ADAPTIVE_WINDOW,
        )
        require_strict_int(
            self.min_support,
            field="min_support",
            minimum=2,
            maximum=self.window_size,
        )

    def as_mapping(self) -> dict[str, object]:
        return {
            "gamma": self.gamma.as_mapping(),
            "maxAlpha": self.max_alpha.as_mapping(),
            "minAlpha": self.min_alpha.as_mapping(),
            "minSupport": self.min_support,
            "targetAlpha": self.target_alpha.as_mapping(),
            "windowSize": self.window_size,
        }


@dataclass(frozen=True, slots=True)
class AdaptiveConformalStateV1:
    config: AdaptiveConformalConfigV1
    alpha: ExactRatioV1
    residuals: tuple[ExactRatioV1, ...]
    update_count: int
    target_id: str
    dataset_digest: DigestV1
    plan_digest: DigestV1
    matrix_digest: DigestV1
    fitted_stack_digest: DigestV1
    calibration_fold_ids: tuple[str, ...]
    base_half_width: ExactRatioV1
    last_outcome_time_ns: int | None = None
    regime_id: str | None = None
    cohort_id: str | None = None
    horizon_ns: int | None = None

    def __post_init__(self) -> None:
        if not isinstance(self.config, AdaptiveConformalConfigV1):
            raise ContractValueError("config must be AdaptiveConformalConfigV1")
        _require_unit_ratio(self.alpha, field="alpha", open_interval=True)
        if (
            not _fraction(self.config.min_alpha)
            <= _fraction(self.alpha)
            <= _fraction(self.config.max_alpha)
        ):
            raise ContractValueError("adaptive alpha is outside configured bounds")
        if len(self.residuals) > self.config.window_size:
            raise ContractValueError("residual window exceeds configured size")
        if any(not isinstance(value, ExactRatioV1) for value in self.residuals):
            raise ContractValueError("residuals must contain ExactRatioV1")
        if any(_fraction(value) < 0 for value in self.residuals):
            raise ContractValueError("residuals cannot be negative")
        require_strict_int(self.update_count, field="update_count", minimum=0)
        require_contract_id(self.target_id, field="target_id")
        _require_unit_ratio(self.base_half_width, field="base_half_width", open_interval=True)
        if any(
            not isinstance(digest, DigestV1)
            for digest in (
                self.dataset_digest,
                self.plan_digest,
                self.matrix_digest,
                self.fitted_stack_digest,
            )
        ):
            raise ContractValueError("adaptive provenance digests must be DigestV1")
        if not isinstance(self.calibration_fold_ids, tuple) or not self.calibration_fold_ids:
            raise ContractValueError("calibration_fold_ids must be a non-empty tuple")
        if self.calibration_fold_ids != tuple(sorted(set(self.calibration_fold_ids))):
            raise ContractValueError("calibration_fold_ids must be sorted and unique")
        expected_support = min(self.update_count, self.config.window_size)
        if len(self.residuals) != expected_support:
            raise ContractValueError("residual support must match bounded update history")
        context = (self.regime_id, self.cohort_id, self.horizon_ns)
        if any(value is None for value in context) != all(value is None for value in context):
            raise ContractValueError("adaptive context must be entirely known or unknown")
        if self.regime_id is not None:
            require_contract_id(self.regime_id, field="regime_id")
            require_contract_id(cast(str, self.cohort_id), field="cohort_id")
            require_strict_int(cast(int, self.horizon_ns), field="horizon_ns", minimum=1)
        if self.last_outcome_time_ns is not None:
            require_strict_int(
                self.last_outcome_time_ns,
                field="last_outcome_time_ns",
                minimum=0,
            )
        has_history = self.update_count > 0 or bool(self.residuals)
        if has_history and (self.last_outcome_time_ns is None or self.regime_id is None):
            raise ContractValueError("adaptive history requires outcome maturity and context")
        if not has_history and self.last_outcome_time_ns is not None:
            raise ContractValueError("empty adaptive history cannot claim outcome maturity")

    def as_mapping(self) -> dict[str, object]:
        return {
            "alpha": self.alpha.as_mapping(),
            "config": self.config.as_mapping(),
            "cohortId": self.cohort_id,
            "targetId": self.target_id,
            "datasetDigest": self.dataset_digest.hexdigest,
            "fittedStackDigest": self.fitted_stack_digest.hexdigest,
            "matrixDigest": self.matrix_digest.hexdigest,
            "planDigest": self.plan_digest.hexdigest,
            "calibrationFoldIds": list(self.calibration_fold_ids),
            "baseHalfWidth": self.base_half_width.as_mapping(),
            "horizonNs": None if self.horizon_ns is None else str(self.horizon_ns),
            "lastOutcomeTimeNs": (
                None if self.last_outcome_time_ns is None else str(self.last_outcome_time_ns)
            ),
            "regimeId": self.regime_id,
            "residuals": [value.as_mapping() for value in self.residuals],
            "schema": "Q12AdaptiveConformalStateV1",
            "updateCount": self.update_count,
        }

    def digest(self) -> DigestV1:
        return DigestV1(
            hexdigest=hashlib.sha256(canonical_json_bytes(self.as_mapping())).hexdigest()
        )


@dataclass(frozen=True, slots=True)
class AdaptivePredictionV1:
    state_digest: DigestV1
    observation_id: str
    prediction_time_ns: int
    outcome_time_ns: int
    regime_id: str
    cohort_id: str
    horizon_ns: int
    base_lower: ExactRatioV1
    base_upper: ExactRatioV1
    interval: PredictionIntervalV1

    def __post_init__(self) -> None:
        if not isinstance(self.state_digest, DigestV1):
            raise ContractValueError("state_digest must be DigestV1")
        require_contract_id(self.observation_id, field="observation_id")
        require_strict_int(self.prediction_time_ns, field="prediction_time_ns", minimum=0)
        require_strict_int(
            self.outcome_time_ns,
            field="outcome_time_ns",
            minimum=self.prediction_time_ns + 1,
        )
        require_contract_id(self.regime_id, field="regime_id")
        require_contract_id(self.cohort_id, field="cohort_id")
        require_strict_int(self.horizon_ns, field="horizon_ns", minimum=1)
        if self.outcome_time_ns != self.prediction_time_ns + self.horizon_ns:
            raise ContractValueError(
                "adaptive outcome time must equal prediction time plus horizon"
            )
        if not isinstance(self.base_lower, ExactRatioV1) or not isinstance(
            self.base_upper, ExactRatioV1
        ):
            raise ContractValueError("adaptive base bounds must be ExactRatioV1")
        if _fraction(self.base_lower) > _fraction(self.base_upper):
            raise ContractValueError("adaptive base interval cannot cross")
        if not isinstance(self.interval, PredictionIntervalV1):
            raise ContractValueError("interval must be PredictionIntervalV1")
        interval_identity = (
            self.interval.observation_id,
            self.interval.prediction_time_ns,
            self.interval.regime_id,
            self.interval.cohort_id,
            self.interval.horizon_ns,
        )
        prediction_identity = (
            self.observation_id,
            self.prediction_time_ns,
            self.regime_id,
            self.cohort_id,
            self.horizon_ns,
        )
        if interval_identity != prediction_identity:
            raise ContractValueError("adaptive interval identity must match prediction")

    def as_mapping(self) -> dict[str, object]:
        return {
            "baseLower": self.base_lower.as_mapping(),
            "baseUpper": self.base_upper.as_mapping(),
            "cohortId": self.cohort_id,
            "horizonNs": str(self.horizon_ns),
            "interval": self.interval.as_mapping(),
            "observationId": self.observation_id,
            "outcomeTimeNs": str(self.outcome_time_ns),
            "predictionTimeNs": str(self.prediction_time_ns),
            "regimeId": self.regime_id,
            "stateDigest": self.state_digest.hexdigest,
        }


def adaptive_predict(
    state: AdaptiveConformalStateV1,
    observation: IntervalObservationV1,
    *,
    research_slice: ConformalResearchSliceV1,
) -> AdaptivePredictionV1:
    if not isinstance(state, AdaptiveConformalStateV1):
        raise ContractValueError("state must be AdaptiveConformalStateV1")
    if not isinstance(observation, IntervalObservationV1):
        raise ContractValueError("observation must be IntervalObservationV1")
    if observation.outcome is not None:
        raise ContractValueError("adaptive prediction requires an outcome-free observation")
    if not isinstance(research_slice, ConformalResearchSliceV1):
        raise ContractValueError("research_slice must be ConformalResearchSliceV1")
    _, source_predictions = research_slice.canonical_stack_slice()
    _validate_observation_for_slice(observation, research_slice, source_predictions)
    if (
        research_slice.target_id != state.target_id
        or research_slice.samples.digest() != state.dataset_digest
        or research_slice.plan.digest() != state.plan_digest
        or research_slice.matrix.digest() != state.matrix_digest
        or research_slice.fitted_stack.digest() != state.fitted_stack_digest
        or research_slice.base_half_width != state.base_half_width
    ):
        raise ContractValueError("adaptive prediction provenance does not match state")
    if set(research_slice.fold_ids).intersection(state.calibration_fold_ids):
        raise ContractValueError("adaptive prediction folds must be disjoint from calibration")
    if (
        state.last_outcome_time_ns is not None
        and observation.prediction_time_ns <= state.last_outcome_time_ns
    ):
        raise ContractValueError("adaptive prediction must follow prior outcome maturity")
    if state.regime_id is not None and (
        observation.regime_id,
        observation.cohort_id,
        observation.horizon_ns,
    ) != (state.regime_id, state.cohort_id, state.horizon_ns):
        raise ContractValueError("adaptive prediction must preserve regime/cohort/horizon")
    support = len(state.residuals)
    if support >= state.config.min_support and _rank(state.alpha, support) <= support:
        adjustment = sorted(_fraction(value) for value in state.residuals)[
            _rank(state.alpha, support) - 1
        ]
        model = ConformalModelV1(
            status=ConformalStatus.AVAILABLE,
            reason=None,
            alpha=state.alpha,
            min_support=state.config.min_support,
            base_half_width=state.base_half_width,
            adjustment=_ratio(adjustment),
            support=support,
            calibration_digest=state.digest(),
            calibration_outcome_maturity_ns=state.last_outcome_time_ns,
            regime_id=observation.regime_id,
            cohort_id=observation.cohort_id,
            horizon_ns=observation.horizon_ns,
            target_id=state.target_id,
            dataset_digest=state.dataset_digest,
            plan_digest=state.plan_digest,
            matrix_digest=state.matrix_digest,
            fitted_stack_digest=state.fitted_stack_digest,
            fit_fold_ids=state.calibration_fold_ids,
        )
    else:
        model = ConformalModelV1(
            status=ConformalStatus.UNKNOWN,
            reason="INSUFFICIENT_CONFORMAL_SUPPORT",
            alpha=state.alpha,
            min_support=state.config.min_support,
            base_half_width=state.base_half_width,
            adjustment=None,
            support=support,
            calibration_digest=state.digest(),
            calibration_outcome_maturity_ns=state.last_outcome_time_ns,
            regime_id=observation.regime_id,
            cohort_id=observation.cohort_id,
            horizon_ns=observation.horizon_ns,
            target_id=state.target_id,
            dataset_digest=state.dataset_digest,
            plan_digest=state.plan_digest,
            matrix_digest=state.matrix_digest,
            fitted_stack_digest=state.fitted_stack_digest,
            fit_fold_ids=state.calibration_fold_ids,
        )
    return AdaptivePredictionV1(
        state_digest=state.digest(),
        observation_id=observation.observation_id,
        prediction_time_ns=observation.prediction_time_ns,
        outcome_time_ns=observation.outcome_time_ns,
        regime_id=observation.regime_id,
        cohort_id=observation.cohort_id,
        horizon_ns=observation.horizon_ns,
        base_lower=observation.lower,
        base_upper=observation.upper,
        interval=_apply_conformal_model(
            model,
            observation.lower,
            observation.upper,
            observation_id=observation.observation_id,
            prediction_time_ns=observation.prediction_time_ns,
            research_slice=research_slice,
            source_predictions=source_predictions,
        ),
    )


def adaptive_update(
    state: AdaptiveConformalStateV1,
    prediction: AdaptivePredictionV1,
    observation: IntervalObservationV1,
    *,
    as_of_ns: int,
    research_slice: ConformalResearchSliceV1,
) -> AdaptiveConformalStateV1:
    """Update after outcome maturity; unknown outcomes freeze the exact state."""

    if not isinstance(state, AdaptiveConformalStateV1):
        raise ContractValueError("state must be AdaptiveConformalStateV1")
    if (
        not isinstance(prediction, AdaptivePredictionV1)
        or prediction.state_digest != state.digest()
    ):
        raise ContractValueError("adaptive prediction must bind the current state")
    if not isinstance(observation, IntervalObservationV1):
        raise ContractValueError("observation must be IntervalObservationV1")
    if not isinstance(research_slice, ConformalResearchSliceV1):
        raise ContractValueError("research_slice must be ConformalResearchSliceV1")
    _validate_observation_for_slice(observation, research_slice)
    require_strict_int(as_of_ns, field="as_of_ns", minimum=0)
    if as_of_ns < observation.outcome_time_ns:
        raise ContractValueError("adaptive update cannot precede outcome maturity")
    observation_identity = (
        observation.observation_id,
        observation.prediction_time_ns,
        observation.outcome_time_ns,
        observation.regime_id,
        observation.cohort_id,
        observation.horizon_ns,
        observation.lower,
        observation.upper,
    )
    prediction_identity = (
        prediction.observation_id,
        prediction.prediction_time_ns,
        prediction.outcome_time_ns,
        prediction.regime_id,
        prediction.cohort_id,
        prediction.horizon_ns,
        prediction.base_lower,
        prediction.base_upper,
    )
    if observation_identity != prediction_identity:
        raise ContractValueError("matured observation must match adaptive prediction")
    expected_prediction = adaptive_predict(
        state,
        replace(observation, outcome=None),
        research_slice=research_slice,
    )
    if prediction != expected_prediction:
        raise ContractValueError("adaptive interval must match deterministic state prediction")
    if observation.outcome is None:
        return state
    outcome = observation.outcome
    next_alpha = _fraction(state.alpha)
    if prediction.interval.status is ConformalStatus.AVAILABLE:
        lower = cast(ExactRatioV1, prediction.interval.lower)
        upper = cast(ExactRatioV1, prediction.interval.upper)
        missed = int(not (_fraction(lower) <= _fraction(outcome) <= _fraction(upper)))
        next_alpha += _fraction(state.config.gamma) * (
            _fraction(state.config.target_alpha) - missed
        )
        next_alpha = min(
            max(next_alpha, _fraction(state.config.min_alpha)),
            _fraction(state.config.max_alpha),
        )
    residual = max(
        Fraction(0),
        _fraction(prediction.base_lower) - _fraction(outcome),
        _fraction(outcome) - _fraction(prediction.base_upper),
    )
    residuals = (*state.residuals, _ratio(residual))[-state.config.window_size :]
    return AdaptiveConformalStateV1(
        config=state.config,
        alpha=_ratio(next_alpha),
        residuals=residuals,
        update_count=state.update_count + 1,
        target_id=state.target_id,
        dataset_digest=state.dataset_digest,
        plan_digest=state.plan_digest,
        matrix_digest=state.matrix_digest,
        fitted_stack_digest=state.fitted_stack_digest,
        calibration_fold_ids=state.calibration_fold_ids,
        base_half_width=state.base_half_width,
        last_outcome_time_ns=observation.outcome_time_ns,
        regime_id=observation.regime_id,
        cohort_id=observation.cohort_id,
        horizon_ns=observation.horizon_ns,
    )


def initialize_adaptive_conformal(
    *,
    model_evidence: BoundConformalModelEvidenceV1,
    config: AdaptiveConformalConfigV1,
    observations: tuple[IntervalObservationV1, ...],
    research_slice: ConformalResearchSliceV1,
) -> AdaptiveConformalStateV1:
    """Initialize bounded adaptive state only from the model's exact mature fit prefix."""

    if not isinstance(model_evidence, BoundConformalModelEvidenceV1) or not isinstance(
        config, AdaptiveConformalConfigV1
    ):
        raise ContractValueError("model_evidence and config must be conformal contracts")
    model = _validated_model_from_evidence(model_evidence)
    if not isinstance(research_slice, ConformalResearchSliceV1):
        raise ContractValueError("research_slice must be ConformalResearchSliceV1")
    if (
        model.target_id != research_slice.target_id
        or model.dataset_digest != research_slice.samples.digest()
        or model.plan_digest != research_slice.plan.digest()
        or model.fit_fold_ids != research_slice.fold_ids
        or model.calibration_digest != _observations_digest(observations)
        or model.base_half_width != research_slice.base_half_width
        or model_evidence.observations != observations
        or model_evidence.research_slice != research_slice
    ):
        raise ContractValueError("adaptive initialization must bind the static fit prefix")
    if any(observation.outcome is None for observation in observations):
        raise ContractValueError("adaptive initialization requires mature outcomes")
    _, source_predictions = research_slice.canonical_stack_slice()
    for observation in observations:
        _validate_observation_for_slice(observation, research_slice, source_predictions)
    residuals = tuple(
        cast(ExactRatioV1, observation.nonconformity()) for observation in observations
    )
    residuals = residuals[-config.window_size :]
    maturity = max(observation.outcome_time_ns for observation in observations)
    return AdaptiveConformalStateV1(
        config=config,
        alpha=config.target_alpha,
        residuals=residuals,
        update_count=len(observations),
        target_id=model.target_id,
        dataset_digest=model.dataset_digest,
        plan_digest=model.plan_digest,
        matrix_digest=model.matrix_digest,
        fitted_stack_digest=model.fitted_stack_digest,
        calibration_fold_ids=model.fit_fold_ids,
        base_half_width=model.base_half_width,
        last_outcome_time_ns=maturity,
        regime_id=model.regime_id,
        cohort_id=model.cohort_id,
        horizon_ns=model.horizon_ns,
    )


class CoverageStatus(StrEnum):
    AVAILABLE = "AVAILABLE"
    COLLAPSED = "COLLAPSED"
    UNKNOWN = "UNKNOWN"


@dataclass(frozen=True, slots=True)
class CoverageReportV1:
    regime_id: str
    cohort_id: str
    horizon_ns: int
    model_digest: DigestV1
    observations_digest: DigestV1
    observation_ids: tuple[str, ...]
    outcome_maturity_ns: int | None
    status: CoverageStatus
    coverage: ExactRatioV1 | None
    minimum_coverage: ExactRatioV1
    min_support: int
    support: int
    covered_count: int
    missed_count: int
    unavailable_count: int
    unknown_outcome_count: int
    reason: str | None

    def __post_init__(self) -> None:
        require_contract_id(self.regime_id, field="regime_id")
        require_contract_id(self.cohort_id, field="cohort_id")
        require_strict_int(self.horizon_ns, field="horizon_ns", minimum=1)
        if not isinstance(self.model_digest, DigestV1):
            raise ContractValueError("model_digest must be DigestV1")
        if not isinstance(self.observations_digest, DigestV1):
            raise ContractValueError("observations_digest must be DigestV1")
        if (
            not isinstance(self.observation_ids, tuple)
            or not self.observation_ids
            or len(self.observation_ids) > MAX_CONFORMAL_SUPPORT
            or len(set(self.observation_ids)) != len(self.observation_ids)
        ):
            raise ContractValueError("observation_ids must be non-empty and unique")
        if self.outcome_maturity_ns is not None:
            require_strict_int(self.outcome_maturity_ns, field="outcome_maturity_ns", minimum=0)
        if not isinstance(self.status, CoverageStatus):
            raise ContractValueError("status must be CoverageStatus")
        _require_unit_ratio(self.minimum_coverage, field="minimum_coverage", open_interval=False)
        if self.minimum_coverage.is_zero:
            raise ContractValueError("minimum_coverage must be strictly positive")
        require_strict_int(
            self.min_support,
            field="min_support",
            minimum=1,
            maximum=MAX_CONFORMAL_SUPPORT,
        )
        counts = (
            self.support,
            self.covered_count,
            self.missed_count,
            self.unavailable_count,
            self.unknown_outcome_count,
        )
        for index, count in enumerate(counts):
            require_strict_int(count, field=f"coverage count {index}", minimum=0)
        if self.support != self.covered_count + self.missed_count + self.unavailable_count:
            raise ContractValueError("coverage support must equal known-outcome disposition counts")
        if len(self.observation_ids) != self.support + self.unknown_outcome_count:
            raise ContractValueError("coverage counts must account for every observation")
        if (self.support > 0) != (self.outcome_maturity_ns is not None):
            raise ContractValueError("coverage maturity must match known-outcome support")
        available = self.status in (CoverageStatus.AVAILABLE, CoverageStatus.COLLAPSED)
        if available != (self.coverage is not None and self.reason is None):
            raise ContractValueError("coverage status must match value/reason")
        if not available and self.reason is None:
            raise ContractValueError("UNKNOWN coverage requires a reason")
        if self.coverage is not None:
            _require_unit_ratio(self.coverage, field="coverage", open_interval=False)
            if self.support < self.min_support or self.unavailable_count:
                raise ContractValueError(
                    "available coverage requires supported available intervals"
                )
            expected = make_ratio(self.covered_count, self.support)
            if self.coverage != expected:
                raise ContractValueError("coverage value must equal exact covered/support ratio")
            expected_status = (
                CoverageStatus.AVAILABLE
                if _fraction(expected) >= _fraction(self.minimum_coverage)
                else CoverageStatus.COLLAPSED
            )
            if self.status is not expected_status:
                raise ContractValueError("coverage status must match the declared threshold")
        if self.reason is not None:
            require_reason_code(self.reason, field="reason")

    def as_mapping(self) -> dict[str, object]:
        return {
            "cohortId": self.cohort_id,
            "coverage": None if self.coverage is None else self.coverage.as_mapping(),
            "minimumCoverage": self.minimum_coverage.as_mapping(),
            "minSupport": self.min_support,
            "horizonNs": str(self.horizon_ns),
            "modelDigest": self.model_digest.hexdigest,
            "observationsDigest": self.observations_digest.hexdigest,
            "observationIds": list(self.observation_ids),
            "outcomeMaturityNs": (
                None if self.outcome_maturity_ns is None else str(self.outcome_maturity_ns)
            ),
            "reason": self.reason,
            "regimeId": self.regime_id,
            "status": self.status.value,
            "support": self.support,
            "coveredCount": self.covered_count,
            "missedCount": self.missed_count,
            "unavailableCount": self.unavailable_count,
            "unknownOutcomeCount": self.unknown_outcome_count,
        }


def monitor_coverage(
    *,
    observations: tuple[IntervalObservationV1, ...],
    intervals: tuple[PredictionIntervalV1, ...],
    min_support: int,
    minimum_coverage: ExactRatioV1,
) -> CoverageReportV1:
    if not isinstance(observations, tuple) or not isinstance(intervals, tuple):
        raise ContractValueError("observations and intervals must be tuples")
    if not observations or len(observations) != len(intervals):
        raise ContractValueError("observations and intervals must align and be non-empty")
    require_strict_int(
        min_support,
        field="min_support",
        minimum=1,
        maximum=MAX_CONFORMAL_SUPPORT,
    )
    _require_unit_ratio(minimum_coverage, field="minimum_coverage", open_interval=False)
    if minimum_coverage.is_zero:
        raise ContractValueError("minimum_coverage must be strictly positive")
    if len(observations) > MAX_CONFORMAL_SUPPORT:
        raise ContractValueError("coverage observation count exceeds MAX_CONFORMAL_SUPPORT")
    if any(not isinstance(item, IntervalObservationV1) for item in observations):
        raise ContractValueError("observations must contain IntervalObservationV1")
    if any(not isinstance(item, PredictionIntervalV1) for item in intervals):
        raise ContractValueError("intervals must contain PredictionIntervalV1")
    identity = {(item.regime_id, item.cohort_id, item.horizon_ns) for item in observations}
    if len(identity) != 1:
        raise ContractValueError("coverage monitor requires one regime/cohort/horizon")
    regime_id, cohort_id, horizon_ns = next(iter(identity))
    model_digests = {item.model_digest for item in intervals}
    if len(model_digests) != 1:
        raise ContractValueError("coverage monitor requires one conformal model")
    interval_provenance = {
        (item.target_id, item.dataset_digest, item.plan_digest) for item in intervals
    }
    if len(interval_provenance) != 1:
        raise ContractValueError("coverage monitor requires one conformal provenance")
    model_digest = next(iter(model_digests))
    observations_digest = _observations_digest(observations)
    observation_ids = tuple(item.observation_id for item in observations)
    known_outcome_times = tuple(
        item.outcome_time_ns for item in observations if item.outcome is not None
    )
    outcome_maturity_ns = max(known_outcome_times) if known_outcome_times else None
    if len({item.observation_id for item in observations}) != len(observations):
        raise ContractValueError("coverage observations require unique identities")
    covered = 0
    missed = 0
    unavailable = 0
    unknown = 0
    support = 0
    for observation, interval in zip(observations, intervals, strict=True):
        observation_identity = (
            observation.observation_id,
            observation.prediction_time_ns,
            observation.regime_id,
            observation.cohort_id,
            observation.horizon_ns,
        )
        interval_identity = (
            interval.observation_id,
            interval.prediction_time_ns,
            interval.regime_id,
            interval.cohort_id,
            interval.horizon_ns,
        )
        if observation_identity != interval_identity:
            raise ContractValueError("coverage interval identity/time must match observation")
        if observation.outcome is None:
            unknown += 1
            continue
        support += 1
        if interval.status is not ConformalStatus.AVAILABLE:
            unavailable += 1
            continue
        lower = cast(ExactRatioV1, interval.lower)
        upper = cast(ExactRatioV1, interval.upper)
        if _fraction(lower) <= _fraction(observation.outcome) <= _fraction(upper):
            covered += 1
        else:
            missed += 1
    if support < min_support:
        return CoverageReportV1(
            regime_id=regime_id,
            cohort_id=cohort_id,
            horizon_ns=horizon_ns,
            model_digest=model_digest,
            observations_digest=observations_digest,
            observation_ids=observation_ids,
            outcome_maturity_ns=outcome_maturity_ns,
            status=CoverageStatus.UNKNOWN,
            coverage=None,
            minimum_coverage=minimum_coverage,
            min_support=min_support,
            support=support,
            covered_count=covered,
            missed_count=missed,
            unavailable_count=unavailable,
            unknown_outcome_count=unknown,
            reason="INSUFFICIENT_COVERAGE_SUPPORT",
        )
    if unavailable:
        return CoverageReportV1(
            regime_id=regime_id,
            cohort_id=cohort_id,
            horizon_ns=horizon_ns,
            model_digest=model_digest,
            observations_digest=observations_digest,
            observation_ids=observation_ids,
            outcome_maturity_ns=outcome_maturity_ns,
            status=CoverageStatus.UNKNOWN,
            coverage=None,
            minimum_coverage=minimum_coverage,
            min_support=min_support,
            support=support,
            covered_count=covered,
            missed_count=missed,
            unavailable_count=unavailable,
            unknown_outcome_count=unknown,
            reason="UNAVAILABLE_INTERVAL_IN_COVERAGE",
        )
    coverage = make_ratio(covered, support)
    status = (
        CoverageStatus.AVAILABLE
        if _fraction(coverage) >= _fraction(minimum_coverage)
        else CoverageStatus.COLLAPSED
    )
    return CoverageReportV1(
        regime_id=regime_id,
        cohort_id=cohort_id,
        horizon_ns=horizon_ns,
        model_digest=model_digest,
        observations_digest=observations_digest,
        observation_ids=observation_ids,
        outcome_maturity_ns=outcome_maturity_ns,
        status=status,
        coverage=coverage,
        minimum_coverage=minimum_coverage,
        min_support=min_support,
        support=support,
        covered_count=covered,
        missed_count=missed,
        unavailable_count=unavailable,
        unknown_outcome_count=unknown,
        reason=None,
    )


@dataclass(frozen=True, slots=True)
class BoundCoverageEvidenceV1:
    """Exact observations and intervals whose recomputation proves a coverage report."""

    model_evidence: BoundConformalModelEvidenceV1
    observations: tuple[IntervalObservationV1, ...]
    intervals: tuple[PredictionIntervalV1, ...]
    research_slice: ConformalResearchSliceV1
    report: CoverageReportV1

    def __post_init__(self) -> None:
        if not isinstance(self.model_evidence, BoundConformalModelEvidenceV1):
            raise ContractValueError("model_evidence must be BoundConformalModelEvidenceV1")
        model = _validated_model_from_evidence(self.model_evidence)
        if not isinstance(self.research_slice, ConformalResearchSliceV1):
            raise ContractValueError("research_slice must be ConformalResearchSliceV1")
        if not isinstance(self.report, CoverageReportV1):
            raise ContractValueError("report must be CoverageReportV1")
        if not isinstance(self.observations, tuple) or any(
            not isinstance(observation, IntervalObservationV1) for observation in self.observations
        ):
            raise ContractValueError("observations must contain IntervalObservationV1")
        if not isinstance(self.intervals, tuple) or any(
            not isinstance(interval, PredictionIntervalV1) for interval in self.intervals
        ):
            raise ContractValueError("intervals must contain PredictionIntervalV1")
        observation_ids = tuple(observation.observation_id for observation in self.observations)
        if observation_ids != self.research_slice.validation_sample_ids:
            raise ContractValueError(
                "coverage observations must exactly cover every research-slice validation row"
            )
        if any(observation.outcome is None for observation in self.observations):
            raise ContractValueError(
                "coverage observations require known outcomes for every prior-fold row"
            )
        if (
            self.research_slice.matrix != self.model_evidence.research_slice.matrix
            or self.research_slice.fitted_stack != self.model_evidence.research_slice.fitted_stack
            or self.research_slice.base_half_width
            != self.model_evidence.research_slice.base_half_width
        ):
            raise ContractValueError("coverage must retain the conformal fit stack source")
        model_digest = _model_digest(model)
        if any(
            interval.model_digest != model_digest
            or interval.target_id != model.target_id
            or interval.dataset_digest != model.dataset_digest
            or interval.plan_digest != model.plan_digest
            for interval in self.intervals
        ):
            raise ContractValueError("coverage intervals must bind the exact conformal model")
        required_coverage = make_ratio(
            model.alpha.denominator - model.alpha.numerator,
            model.alpha.denominator,
        )
        if self.report.minimum_coverage != required_coverage:
            raise ContractValueError("coverage threshold must equal exact one minus model alpha")
        if self.report.min_support != model.min_support:
            raise ContractValueError("coverage min_support must equal the conformal model policy")
        _, source_predictions = self.research_slice.canonical_stack_slice()
        for observation in self.observations:
            _validate_observation_for_slice(
                observation,
                self.research_slice,
                source_predictions,
            )
        recomputed_intervals = tuple(
            _apply_conformal_model(
                model,
                observation.lower,
                observation.upper,
                observation_id=observation.observation_id,
                prediction_time_ns=observation.prediction_time_ns,
                research_slice=self.research_slice,
                source_predictions=source_predictions,
            )
            for observation in self.observations
        )
        if recomputed_intervals != self.intervals:
            raise ContractValueError(
                "coverage intervals must equal apply_conformal over the exact bound evidence"
            )
        recomputed = monitor_coverage(
            observations=self.observations,
            intervals=self.intervals,
            min_support=self.report.min_support,
            minimum_coverage=self.report.minimum_coverage,
        )
        if recomputed != self.report:
            raise ContractValueError(
                "coverage report must equal monitor_coverage over the exact bound evidence"
            )

    def as_mapping(self) -> dict[str, object]:
        return {
            "intervals": [interval.as_mapping() for interval in self.intervals],
            "modelEvidence": self.model_evidence.as_mapping(),
            "observations": [observation.as_mapping() for observation in self.observations],
            "report": self.report.as_mapping(),
            "researchSlice": self.research_slice.as_mapping(),
            "schema": "Q12BoundCoverageEvidenceV1",
        }

    def digest(self) -> DigestV1:
        return DigestV1(
            hexdigest=hashlib.sha256(canonical_json_bytes(self.as_mapping())).hexdigest()
        )

    @property
    def model(self) -> ConformalModelV1:
        return _validated_model_from_evidence(self.model_evidence)
