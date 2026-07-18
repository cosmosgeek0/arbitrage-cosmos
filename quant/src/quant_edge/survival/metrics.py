"""Time-dependent survival metrics: IPCW Brier, concordance and calibration.

Everything is computed in exact rational arithmetic from integer counts and the
exact rational equivalents of quantized predictions; published numbers are
quantized half-even exactly once. The harness fails closed: calibration bins
whose observed frequency is unknowable under censoring report ``UNAVAILABLE``,
concordance with no usable pair reports ``UNAVAILABLE``, and unavailability
propagates into budget verdicts as ``FAIL``, never as a guess. IPCW weights
come from the same cohort's reverse-KM censoring survival and are structurally
positive wherever a weight is needed. Pairs whose subjects share a ``group_id``
are excluded from concordance and counted (§11.7 adjacent-window law). A
declared budget turns measurements into pass/fail truth.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from fractions import Fraction
from typing import Final

from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import FIXED_POINT_SCALE, FixedPointV1
from quant_edge.labels.rational import ExactRatioV1, make_ratio
from quant_edge.lake.contracts import require_contract_id, require_strict_int
from quant_edge.survival.competing import exact_incidence_steps
from quant_edge.survival.contracts import (
    MAX_DURATION_NS,
    SubjectV1,
    SurvivalCohortV1,
    TimeGridV1,
    event_time_table,
    fixed_point_to_fraction,
    fraction_to_fixed_point,
    require_probability,
)
from quant_edge.survival.km import ONE, CurveRole, exact_survival_steps

ANY_CAUSE: Final = "ANY_CAUSE"
MAX_CALIBRATION_BINS: Final = 32
# Calibration is actionable only when every subject belongs to an evaluable
# bin. This complete-support policy is deterministic and makes no empirical
# claim about how much missing follow-up would be acceptable.
MIN_CALIBRATION_EVALUATED_FRACTION: Final = Fraction(1, 1)

REASON_INTEGRATED_BRIER_UNAVAILABLE: Final = "INTEGRATED_BRIER_UNAVAILABLE"
REASON_INTEGRATED_BRIER_EXCEEDS_BUDGET: Final = "INTEGRATED_BRIER_EXCEEDS_BUDGET"
REASON_CONCORDANCE_UNAVAILABLE: Final = "CONCORDANCE_UNAVAILABLE"
REASON_CONCORDANCE_BELOW_BUDGET: Final = "CONCORDANCE_BELOW_BUDGET"
REASON_CALIBRATION_UNAVAILABLE: Final = "CALIBRATION_UNAVAILABLE"
REASON_CALIBRATION_ERROR_EXCEEDS_BUDGET: Final = "CALIBRATION_ERROR_EXCEEDS_BUDGET"


class MetricStatus(StrEnum):
    AVAILABLE = "AVAILABLE"
    UNAVAILABLE = "UNAVAILABLE"


class BinStatus(StrEnum):
    AVAILABLE = "AVAILABLE"
    EMPTY = "EMPTY"
    UNAVAILABLE = "UNAVAILABLE"


class Verdict(StrEnum):
    PASS = "PASS"
    FAIL = "FAIL"


def _require_cause_scope(scope: object, *, cohort: SurvivalCohortV1) -> int | None:
    """Return the cause index for a cause-specific scope, None for ANY_CAUSE."""

    if scope == ANY_CAUSE:
        return None
    if not isinstance(scope, str):
        raise ContractValueError("cause_scope must be a string")
    return cohort.causes.index_of(scope)


@dataclass(frozen=True, slots=True)
class SubjectPredictionV1:
    """One subject's predicted event-probability curve over a grid (a CDF)."""

    subject_id: str
    event_probabilities: tuple[FixedPointV1, ...]

    def __post_init__(self) -> None:
        require_contract_id(self.subject_id, field="subject_id")
        if not isinstance(self.event_probabilities, tuple) or not self.event_probabilities:
            raise ContractValueError("event_probabilities must be a non-empty tuple")
        previous = 0
        for index, value in enumerate(self.event_probabilities):
            require_probability(value, field=f"event_probabilities[{index}]")
            if value.mantissa < previous:
                raise ContractValueError("event probabilities must be non-decreasing in time")
            previous = value.mantissa

    def as_mapping(self) -> dict[str, object]:
        return {
            "eventProbabilities": [value.as_mapping() for value in self.event_probabilities],
            "subjectId": self.subject_id,
        }


@dataclass(frozen=True, slots=True)
class PredictionSetV1:
    """Predicted event-probability curves for a cohort, aligned to one grid."""

    prediction_id: str
    grid: TimeGridV1
    cause_scope: str
    predictions: tuple[SubjectPredictionV1, ...]

    def __post_init__(self) -> None:
        require_contract_id(self.prediction_id, field="prediction_id")
        if not isinstance(self.grid, TimeGridV1):
            raise ContractValueError("grid must be TimeGridV1")
        if self.cause_scope != ANY_CAUSE:
            require_contract_id(self.cause_scope, field="cause_scope")
        if not isinstance(self.predictions, tuple) or not self.predictions:
            raise ContractValueError("predictions must be a non-empty tuple")
        seen: set[str] = set()
        for index, prediction in enumerate(self.predictions):
            if not isinstance(prediction, SubjectPredictionV1):
                raise ContractValueError(f"predictions[{index}] must be SubjectPredictionV1")
            if len(prediction.event_probabilities) != self.grid.bin_count:
                raise ContractValueError("predictions must cover every grid time")
            if prediction.subject_id in seen:
                raise ContractValueError(f"duplicate prediction for {prediction.subject_id}")
            seen.add(prediction.subject_id)

    def as_mapping(self) -> dict[str, object]:
        return {
            "causeScope": self.cause_scope,
            "gridId": self.grid.grid_id,
            "predictionId": self.prediction_id,
            "predictions": [prediction.as_mapping() for prediction in self.predictions],
        }


def _prediction_lookup(
    cohort: SurvivalCohortV1,
    prediction_set: PredictionSetV1,
) -> dict[str, SubjectPredictionV1]:
    lookup = {prediction.subject_id: prediction for prediction in prediction_set.predictions}
    cohort_ids = {subject.subject_id for subject in cohort.subjects}
    if set(lookup) != cohort_ids:
        raise ContractValueError("predictions must cover exactly the cohort subjects")
    return lookup


class _StepFunction:
    """Exact right-continuous step lookup over (time, value) steps starting at one."""

    __slots__ = ("__steps",)

    def __init__(self, steps: tuple[tuple[int, Fraction], ...], *, initial: Fraction) -> None:
        self.__steps = ((0, initial), *steps)

    def at(self, time_ns: int) -> Fraction:
        value = self.__steps[0][1]
        for step_time, step_value in self.__steps:
            if step_time <= time_ns:
                value = step_value
        return value

    def before(self, time_ns: int) -> Fraction:
        value = self.__steps[0][1]
        for step_time, step_value in self.__steps:
            if step_time < time_ns:
                value = step_value
        return value


@dataclass(frozen=True, slots=True)
class BrierPointV1:
    """IPCW Brier score at one grid time, or an explicit unavailability."""

    time_ns: int
    status: MetricStatus
    score: FixedPointV1 | None
    contributors: int
    zero_weight_subjects: int
    reason: str | None

    def __post_init__(self) -> None:
        require_strict_int(self.time_ns, field="time_ns", minimum=1, maximum=MAX_DURATION_NS)
        if not isinstance(self.status, MetricStatus):
            raise ContractValueError("status must be MetricStatus")
        require_strict_int(self.contributors, field="contributors", minimum=0)
        require_strict_int(self.zero_weight_subjects, field="zero_weight_subjects", minimum=0)
        available = self.status is MetricStatus.AVAILABLE
        if available and (self.score is None or self.reason is not None):
            raise ContractValueError("AVAILABLE points carry a score and no reason")
        if not available and (self.score is not None or self.reason is None):
            raise ContractValueError("UNAVAILABLE points carry a reason and no score")
        if self.score is not None and self.score.mantissa < 0:
            raise ContractValueError("a Brier score cannot be negative")

    def as_mapping(self) -> dict[str, object]:
        return {
            "contributors": self.contributors,
            "reason": self.reason,
            "score": None if self.score is None else self.score.as_mapping(),
            "status": self.status.value,
            "timeNs": str(self.time_ns),
            "zeroWeightSubjects": self.zero_weight_subjects,
        }


@dataclass(frozen=True, slots=True)
class BrierReportV1:
    """Per-time IPCW Brier scores plus the integrated score over the grid."""

    cohort_id: str
    prediction_id: str
    cause_scope: str
    points: tuple[BrierPointV1, ...]
    integrated_status: MetricStatus
    integrated: FixedPointV1 | None
    integrated_reason: str | None

    def __post_init__(self) -> None:
        require_contract_id(self.cohort_id, field="cohort_id")
        require_contract_id(self.prediction_id, field="prediction_id")
        if self.cause_scope != ANY_CAUSE:
            require_contract_id(self.cause_scope, field="cause_scope")
        if not isinstance(self.points, tuple) or not self.points:
            raise ContractValueError("points must be a non-empty tuple")
        for index, point in enumerate(self.points):
            if not isinstance(point, BrierPointV1):
                raise ContractValueError(f"points[{index}] must be BrierPointV1")
        if not isinstance(self.integrated_status, MetricStatus):
            raise ContractValueError("integrated_status must be MetricStatus")
        available = self.integrated_status is MetricStatus.AVAILABLE
        if available and (self.integrated is None or self.integrated_reason is not None):
            raise ContractValueError("an AVAILABLE integral carries a value and no reason")
        if not available and (self.integrated is not None or self.integrated_reason is None):
            raise ContractValueError("an UNAVAILABLE integral carries a reason and no value")

    def as_mapping(self) -> dict[str, object]:
        return {
            "causeScope": self.cause_scope,
            "cohortId": self.cohort_id,
            "integrated": None if self.integrated is None else self.integrated.as_mapping(),
            "integratedReason": self.integrated_reason,
            "integratedStatus": self.integrated_status.value,
            "points": [point.as_mapping() for point in self.points],
            "predictionId": self.prediction_id,
        }


def evaluate_brier(
    cohort: SurvivalCohortV1,
    prediction_set: PredictionSetV1,
) -> BrierReportV1:
    """IPCW Brier score at every grid time with the exact step-integrated score.

    The integration law is the right-endpoint step integral from zero to the
    last grid time: ``IBS = sum_j BS(t_j) * (t_j - t_{j-1}) / t_J`` with
    ``t_0 = 0``.
    """

    if not isinstance(cohort, SurvivalCohortV1):
        raise ContractValueError("cohort must be SurvivalCohortV1")
    if not isinstance(prediction_set, PredictionSetV1):
        raise ContractValueError("prediction_set must be PredictionSetV1")
    cause_index = _require_cause_scope(prediction_set.cause_scope, cohort=cohort)
    lookup = _prediction_lookup(cohort, prediction_set)
    table = event_time_table(cohort.subjects, cohort.causes)
    censoring = _StepFunction(
        tuple(
            (time_ns, survival)
            for time_ns, survival, _ in exact_survival_steps(
                table, role=CurveRole.CENSORING_SURVIVAL
            )
        ),
        initial=ONE,
    )
    # Same-cohort reverse-KM weights are structurally positive: a subject that
    # still needs a weight at time t sat in every earlier censoring risk set
    # without being censored there, so each factor of G it depends on keeps a
    # strictly positive numerator. The UNAVAILABLE shape in the report contract
    # exists for future externally estimated censoring curves, which carry no
    # such guarantee.
    grid = prediction_set.grid
    points: list[BrierPointV1] = []
    exact_scores: list[Fraction] = []
    for time_index, time_ns in enumerate(grid.times_ns):
        weighted_total = Fraction(0)
        contributors = 0
        zero_weight = 0
        for subject in cohort.subjects:
            probability = fixed_point_to_fraction(
                lookup[subject.subject_id].event_probabilities[time_index]
            )
            if subject.is_event and subject.duration_ns <= time_ns:
                weight_denominator = censoring.before(subject.duration_ns)
                is_scope_event = cause_index is None or (
                    subject.cause_id == cohort.causes.cause_ids[cause_index]
                )
                residual = (ONE - probability) if is_scope_event else probability
            elif subject.duration_ns > time_ns:
                weight_denominator = censoring.at(time_ns)
                residual = probability
            else:
                zero_weight += 1
                continue
            weighted_total += (residual * residual) / weight_denominator
            contributors += 1
        score = weighted_total / cohort.size
        exact_scores.append(score)
        points.append(
            BrierPointV1(
                time_ns=time_ns,
                status=MetricStatus.AVAILABLE,
                score=fraction_to_fixed_point(score),
                contributors=contributors,
                zero_weight_subjects=zero_weight,
                reason=None,
            )
        )
    integral = Fraction(0)
    previous_time = 0
    for time_ns, score in zip(grid.times_ns, exact_scores, strict=True):
        integral += score * (time_ns - previous_time)
        previous_time = time_ns
    return BrierReportV1(
        cohort_id=cohort.cohort_id,
        prediction_id=prediction_set.prediction_id,
        cause_scope=prediction_set.cause_scope,
        points=tuple(points),
        integrated_status=MetricStatus.AVAILABLE,
        integrated=fraction_to_fixed_point(integral / grid.end_ns),
        integrated_reason=None,
    )


@dataclass(frozen=True, slots=True)
class RiskScoreSetV1:
    """One relative risk score per subject; higher means expected-earlier event."""

    score_id: str
    scores: tuple[tuple[str, FixedPointV1], ...]

    def __post_init__(self) -> None:
        require_contract_id(self.score_id, field="score_id")
        if not isinstance(self.scores, tuple) or not self.scores:
            raise ContractValueError("scores must be a non-empty tuple")
        seen: set[str] = set()
        for index, entry in enumerate(self.scores):
            if not isinstance(entry, tuple) or len(entry) != 2:
                raise ContractValueError(f"scores[{index}] must be (subject_id, score)")
            subject_id, score = entry
            require_contract_id(subject_id, field=f"scores[{index}].subject_id")
            if not isinstance(score, FixedPointV1):
                raise ContractValueError(f"scores[{index}].score must be FixedPointV1")
            if subject_id in seen:
                raise ContractValueError(f"duplicate score for {subject_id}")
            seen.add(subject_id)

    def as_mapping(self) -> dict[str, object]:
        return {
            "scoreId": self.score_id,
            "scores": {subject_id: score.as_mapping() for subject_id, score in self.scores},
        }


@dataclass(frozen=True, slots=True)
class ConcordanceReportV1:
    """Harrell-law concordance with measured same-group and tie accounting."""

    cohort_id: str
    score_id: str
    cause_scope: str
    horizon_ns: int | None
    concordant: int
    discordant: int
    tied_scores: int
    excluded_same_group: int
    status: MetricStatus
    concordance: FixedPointV1 | None

    def __post_init__(self) -> None:
        require_contract_id(self.cohort_id, field="cohort_id")
        require_contract_id(self.score_id, field="score_id")
        if self.cause_scope != ANY_CAUSE:
            require_contract_id(self.cause_scope, field="cause_scope")
        if self.horizon_ns is not None:
            require_strict_int(
                self.horizon_ns, field="horizon_ns", minimum=1, maximum=MAX_DURATION_NS
            )
        require_strict_int(self.concordant, field="concordant", minimum=0)
        require_strict_int(self.discordant, field="discordant", minimum=0)
        require_strict_int(self.tied_scores, field="tied_scores", minimum=0)
        require_strict_int(self.excluded_same_group, field="excluded_same_group", minimum=0)
        if not isinstance(self.status, MetricStatus):
            raise ContractValueError("status must be MetricStatus")
        available = self.status is MetricStatus.AVAILABLE
        if available and self.concordance is None:
            raise ContractValueError("AVAILABLE concordance carries a value")
        if not available and self.concordance is not None:
            raise ContractValueError("UNAVAILABLE concordance carries no value")

    @property
    def usable_pairs(self) -> int:
        return self.concordant + self.discordant + self.tied_scores

    def as_mapping(self) -> dict[str, object]:
        return {
            "causeScope": self.cause_scope,
            "cohortId": self.cohort_id,
            "concordance": None if self.concordance is None else self.concordance.as_mapping(),
            "concordant": self.concordant,
            "discordant": self.discordant,
            "excludedSameGroup": self.excluded_same_group,
            "horizonNs": None if self.horizon_ns is None else str(self.horizon_ns),
            "scoreId": self.score_id,
            "status": self.status.value,
            "tiedScores": self.tied_scores,
        }


def evaluate_concordance(
    cohort: SurvivalCohortV1,
    score_set: RiskScoreSetV1,
    *,
    cause_scope: str = ANY_CAUSE,
    horizon_ns: int | None = None,
) -> ConcordanceReportV1:
    """Harrell concordance: index events must precede their comparators.

    A pair is usable when the index subject has a scope event strictly before
    the comparator's observed time (and at or before the horizon when one is
    declared). Score ties earn half credit; same-group pairs are excluded and
    counted, never silently used.
    """

    if not isinstance(cohort, SurvivalCohortV1):
        raise ContractValueError("cohort must be SurvivalCohortV1")
    if not isinstance(score_set, RiskScoreSetV1):
        raise ContractValueError("score_set must be RiskScoreSetV1")
    cause_index = _require_cause_scope(cause_scope, cohort=cohort)
    if horizon_ns is not None:
        require_strict_int(horizon_ns, field="horizon_ns", minimum=1, maximum=MAX_DURATION_NS)
    lookup = dict(score_set.scores)
    cohort_ids = {subject.subject_id for subject in cohort.subjects}
    if set(lookup) != cohort_ids:
        raise ContractValueError("scores must cover exactly the cohort subjects")
    concordant = 0
    discordant = 0
    tied = 0
    excluded_same_group = 0
    for index_subject in cohort.subjects:
        if not index_subject.is_event:
            continue
        if cause_index is not None and (
            index_subject.cause_id != cohort.causes.cause_ids[cause_index]
        ):
            continue
        if horizon_ns is not None and index_subject.duration_ns > horizon_ns:
            continue
        index_score = lookup[index_subject.subject_id].mantissa
        for comparator in cohort.subjects:
            if comparator.duration_ns <= index_subject.duration_ns:
                continue
            if comparator.group_id == index_subject.group_id:
                excluded_same_group += 1
                continue
            comparator_score = lookup[comparator.subject_id].mantissa
            if index_score > comparator_score:
                concordant += 1
            elif index_score < comparator_score:
                discordant += 1
            else:
                tied += 1
    usable = concordant + discordant + tied
    if usable == 0:
        return ConcordanceReportV1(
            cohort_id=cohort.cohort_id,
            score_id=score_set.score_id,
            cause_scope=cause_scope,
            horizon_ns=horizon_ns,
            concordant=0,
            discordant=0,
            tied_scores=0,
            excluded_same_group=excluded_same_group,
            status=MetricStatus.UNAVAILABLE,
            concordance=None,
        )
    value = Fraction(2 * concordant + tied, 2 * usable)
    return ConcordanceReportV1(
        cohort_id=cohort.cohort_id,
        score_id=score_set.score_id,
        cause_scope=cause_scope,
        horizon_ns=horizon_ns,
        concordant=concordant,
        discordant=discordant,
        tied_scores=tied,
        excluded_same_group=excluded_same_group,
        status=MetricStatus.AVAILABLE,
        concordance=fraction_to_fixed_point(value),
    )


@dataclass(frozen=True, slots=True)
class CalibrationBinV1:
    """One predicted-probability bin with a censoring-aware observed frequency."""

    bin_index: int
    lower: ExactRatioV1
    upper: ExactRatioV1
    status: BinStatus
    count: int
    mean_predicted: FixedPointV1 | None
    observed: FixedPointV1 | None
    signed_gap: FixedPointV1 | None

    def __post_init__(self) -> None:
        require_strict_int(self.bin_index, field="bin_index", minimum=0)
        if not isinstance(self.lower, ExactRatioV1) or not isinstance(self.upper, ExactRatioV1):
            raise ContractValueError("bin bounds must be ExactRatioV1")
        if not isinstance(self.status, BinStatus):
            raise ContractValueError("status must be BinStatus")
        require_strict_int(self.count, field="count", minimum=0)
        values = (self.mean_predicted, self.observed, self.signed_gap)
        if self.status is BinStatus.AVAILABLE:
            if any(value is None for value in values) or self.count == 0:
                raise ContractValueError("AVAILABLE bins carry all values and members")
        elif self.status is BinStatus.EMPTY:
            if any(value is not None for value in values) or self.count != 0:
                raise ContractValueError("EMPTY bins carry no values and no members")
        elif any(value is not None for value in values) or self.count == 0:
            raise ContractValueError("UNAVAILABLE bins carry members but no values")

    def as_mapping(self) -> dict[str, object]:
        return {
            "binIndex": self.bin_index,
            "count": self.count,
            "lower": self.lower.as_mapping(),
            "meanPredicted": None
            if self.mean_predicted is None
            else self.mean_predicted.as_mapping(),
            "observed": None if self.observed is None else self.observed.as_mapping(),
            "signedGap": None if self.signed_gap is None else self.signed_gap.as_mapping(),
            "status": self.status.value,
            "upper": self.upper.as_mapping(),
        }


@dataclass(frozen=True, slots=True)
class CalibrationReportV1:
    """Reliability table whose ECE is available only at the minimum support."""

    cohort_id: str
    prediction_id: str
    cause_scope: str
    horizon_ns: int
    bins: tuple[CalibrationBinV1, ...]
    evaluated: int
    unavailable_subjects: int
    status: MetricStatus
    expected_calibration_error: FixedPointV1 | None

    def __post_init__(self) -> None:
        require_contract_id(self.cohort_id, field="cohort_id")
        require_contract_id(self.prediction_id, field="prediction_id")
        if self.cause_scope != ANY_CAUSE:
            require_contract_id(self.cause_scope, field="cause_scope")
        require_strict_int(self.horizon_ns, field="horizon_ns", minimum=1, maximum=MAX_DURATION_NS)
        if not isinstance(self.bins, tuple) or not 2 <= len(self.bins) <= MAX_CALIBRATION_BINS:
            raise ContractValueError(
                f"bins must be a tuple of 2..{MAX_CALIBRATION_BINS} calibration bins"
            )
        for index, calibration_bin in enumerate(self.bins):
            if not isinstance(calibration_bin, CalibrationBinV1):
                raise ContractValueError(f"bins[{index}] must be CalibrationBinV1")
            if calibration_bin.bin_index != index:
                raise ContractValueError("bins must be dense and ordered")
        require_strict_int(self.evaluated, field="evaluated", minimum=0)
        require_strict_int(self.unavailable_subjects, field="unavailable_subjects", minimum=0)
        evaluated_from_bins = sum(
            calibration_bin.count
            for calibration_bin in self.bins
            if calibration_bin.status is BinStatus.AVAILABLE
        )
        unavailable_from_bins = sum(
            calibration_bin.count
            for calibration_bin in self.bins
            if calibration_bin.status is BinStatus.UNAVAILABLE
        )
        if self.evaluated != evaluated_from_bins:
            raise ContractValueError("evaluated must equal AVAILABLE-bin support")
        if self.unavailable_subjects != unavailable_from_bins:
            raise ContractValueError("unavailable_subjects must equal UNAVAILABLE-bin support")
        if not isinstance(self.status, MetricStatus):
            raise ContractValueError("status must be MetricStatus")
        available = self.status is MetricStatus.AVAILABLE
        total_support = self.evaluated + self.unavailable_subjects
        has_minimum_support = (
            total_support > 0
            and Fraction(self.evaluated, total_support) >= MIN_CALIBRATION_EVALUATED_FRACTION
        )
        if available and (self.expected_calibration_error is None or self.evaluated == 0):
            raise ContractValueError("an AVAILABLE report carries an ECE over members")
        if available and not has_minimum_support:
            raise ContractValueError("an AVAILABLE report requires minimum evaluated support")
        if not available and self.expected_calibration_error is not None:
            raise ContractValueError("an UNAVAILABLE report carries no ECE")

    def as_mapping(self) -> dict[str, object]:
        return {
            "bins": [calibration_bin.as_mapping() for calibration_bin in self.bins],
            "causeScope": self.cause_scope,
            "cohortId": self.cohort_id,
            "evaluated": self.evaluated,
            "expectedCalibrationError": None
            if self.expected_calibration_error is None
            else self.expected_calibration_error.as_mapping(),
            "horizonNs": str(self.horizon_ns),
            "predictionId": self.prediction_id,
            "status": self.status.value,
            "unavailableSubjects": self.unavailable_subjects,
        }


def _observed_event_fraction(
    subjects: tuple[SubjectV1, ...],
    cohort: SurvivalCohortV1,
    cause_index: int | None,
    horizon_ns: int,
) -> Fraction | None:
    """Censoring-aware observed event frequency at the horizon (KM or AJ)."""

    table = event_time_table(subjects, cohort.causes)
    if horizon_ns > table[-1].time_ns:
        return None
    if cause_index is None:
        value = ONE
        for time_ns, survival, _ in exact_survival_steps(table, role=CurveRole.EVENT_SURVIVAL):
            if time_ns > horizon_ns:
                break
            value = survival
        return ONE - value
    incidence = Fraction(0)
    for time_ns, step_incidence in exact_incidence_steps(table, cause_index):
        if time_ns > horizon_ns:
            break
        incidence = step_incidence
    return incidence


def evaluate_calibration(
    cohort: SurvivalCohortV1,
    prediction_set: PredictionSetV1,
    *,
    horizon_ns: int,
    bin_count: int,
) -> CalibrationReportV1:
    """Reliability of predicted event probabilities at one on-grid horizon.

    Subjects are binned by predicted probability into equal-width bins; each
    bin's observed frequency is the censoring-aware KM/AJ estimate over the bin
    members, so censored subjects never bias the observed side. Bins whose
    observed frequency is unknowable (the horizon outruns the bin's follow-up)
    are ``UNAVAILABLE`` and never guessed. The report is actionable only when
    the evaluated-subject fraction meets the explicit minimum-support law.
    """

    if not isinstance(cohort, SurvivalCohortV1):
        raise ContractValueError("cohort must be SurvivalCohortV1")
    if not isinstance(prediction_set, PredictionSetV1):
        raise ContractValueError("prediction_set must be PredictionSetV1")
    require_strict_int(bin_count, field="bin_count", minimum=2, maximum=MAX_CALIBRATION_BINS)
    cause_index = _require_cause_scope(prediction_set.cause_scope, cohort=cohort)
    lookup = _prediction_lookup(cohort, prediction_set)
    time_index = prediction_set.grid.index_of_time(horizon_ns)
    members: list[list[SubjectV1]] = [[] for _ in range(bin_count)]
    for subject in cohort.subjects:
        mantissa = lookup[subject.subject_id].event_probabilities[time_index].mantissa
        position = min(mantissa * bin_count // FIXED_POINT_SCALE, bin_count - 1)
        members[position].append(subject)
    bins: list[CalibrationBinV1] = []
    error_total = Fraction(0)
    evaluated = 0
    unavailable_subjects = 0
    for position in range(bin_count):
        lower = make_ratio(position, bin_count)
        upper = make_ratio(position + 1, bin_count)
        bin_subjects = tuple(members[position])
        if not bin_subjects:
            bins.append(
                CalibrationBinV1(
                    bin_index=position,
                    lower=lower,
                    upper=upper,
                    status=BinStatus.EMPTY,
                    count=0,
                    mean_predicted=None,
                    observed=None,
                    signed_gap=None,
                )
            )
            continue
        observed = _observed_event_fraction(bin_subjects, cohort, cause_index, horizon_ns)
        if observed is None:
            unavailable_subjects += len(bin_subjects)
            bins.append(
                CalibrationBinV1(
                    bin_index=position,
                    lower=lower,
                    upper=upper,
                    status=BinStatus.UNAVAILABLE,
                    count=len(bin_subjects),
                    mean_predicted=None,
                    observed=None,
                    signed_gap=None,
                )
            )
            continue
        predicted_total = Fraction(0)
        for subject in bin_subjects:
            predicted_total += fixed_point_to_fraction(
                lookup[subject.subject_id].event_probabilities[time_index]
            )
        mean_predicted = predicted_total / len(bin_subjects)
        gap = observed - mean_predicted
        error_total += len(bin_subjects) * abs(gap)
        evaluated += len(bin_subjects)
        bins.append(
            CalibrationBinV1(
                bin_index=position,
                lower=lower,
                upper=upper,
                status=BinStatus.AVAILABLE,
                count=len(bin_subjects),
                mean_predicted=fraction_to_fixed_point(mean_predicted),
                observed=fraction_to_fixed_point(observed),
                signed_gap=fraction_to_fixed_point(gap),
            )
        )
    total_support = evaluated + unavailable_subjects
    has_minimum_support = (
        total_support > 0
        and Fraction(evaluated, total_support) >= MIN_CALIBRATION_EVALUATED_FRACTION
    )
    if not has_minimum_support:
        status = MetricStatus.UNAVAILABLE
        expected_error: FixedPointV1 | None = None
    else:
        status = MetricStatus.AVAILABLE
        expected_error = fraction_to_fixed_point(error_total / evaluated)
    return CalibrationReportV1(
        cohort_id=cohort.cohort_id,
        prediction_id=prediction_set.prediction_id,
        cause_scope=prediction_set.cause_scope,
        horizon_ns=horizon_ns,
        bins=tuple(bins),
        evaluated=evaluated,
        unavailable_subjects=unavailable_subjects,
        status=status,
        expected_calibration_error=expected_error,
    )


@dataclass(frozen=True, slots=True)
class SurvivalBudgetV1:
    """Declared acceptance thresholds; measurements become pass/fail truth."""

    budget_id: str
    max_integrated_brier: FixedPointV1
    min_concordance: FixedPointV1
    max_calibration_error: FixedPointV1

    def __post_init__(self) -> None:
        require_contract_id(self.budget_id, field="budget_id")
        if not isinstance(self.max_integrated_brier, FixedPointV1):
            raise ContractValueError("max_integrated_brier must be FixedPointV1")
        if self.max_integrated_brier.mantissa < 0:
            raise ContractValueError("max_integrated_brier cannot be negative")
        require_probability(self.min_concordance, field="min_concordance")
        require_probability(self.max_calibration_error, field="max_calibration_error")

    def as_mapping(self) -> dict[str, object]:
        return {
            "budgetId": self.budget_id,
            "maxCalibrationError": self.max_calibration_error.as_mapping(),
            "maxIntegratedBrier": self.max_integrated_brier.as_mapping(),
            "minConcordance": self.min_concordance.as_mapping(),
        }


@dataclass(frozen=True, slots=True)
class SurvivalVerdictV1:
    """Fail-closed budget verdict with sorted reason codes."""

    budget_id: str
    verdict: Verdict
    reasons: tuple[str, ...]

    def __post_init__(self) -> None:
        require_contract_id(self.budget_id, field="budget_id")
        if not isinstance(self.verdict, Verdict):
            raise ContractValueError("verdict must be Verdict")
        if not isinstance(self.reasons, tuple):
            raise ContractValueError("reasons must be a tuple")
        if list(self.reasons) != sorted(set(self.reasons)):
            raise ContractValueError("reasons must be sorted and unique")
        if (self.verdict is Verdict.PASS) != (not self.reasons):
            raise ContractValueError("PASS carries no reasons; FAIL carries at least one")

    def as_mapping(self) -> dict[str, object]:
        return {
            "budgetId": self.budget_id,
            "reasons": list(self.reasons),
            "verdict": self.verdict.value,
        }


def judge_survival(
    budget: SurvivalBudgetV1,
    *,
    brier: BrierReportV1,
    concordance: ConcordanceReportV1,
    calibration: CalibrationReportV1,
) -> SurvivalVerdictV1:
    """Compare measurements against the declared budget; unavailability fails."""

    if not isinstance(budget, SurvivalBudgetV1):
        raise ContractValueError("budget must be SurvivalBudgetV1")
    if not isinstance(brier, BrierReportV1):
        raise ContractValueError("brier must be BrierReportV1")
    if not isinstance(concordance, ConcordanceReportV1):
        raise ContractValueError("concordance must be ConcordanceReportV1")
    if not isinstance(calibration, CalibrationReportV1):
        raise ContractValueError("calibration must be CalibrationReportV1")
    reasons: set[str] = set()
    if brier.integrated is None:
        reasons.add(REASON_INTEGRATED_BRIER_UNAVAILABLE)
    elif brier.integrated.mantissa > budget.max_integrated_brier.mantissa:
        reasons.add(REASON_INTEGRATED_BRIER_EXCEEDS_BUDGET)
    if concordance.concordance is None:
        reasons.add(REASON_CONCORDANCE_UNAVAILABLE)
    elif concordance.concordance.mantissa < budget.min_concordance.mantissa:
        reasons.add(REASON_CONCORDANCE_BELOW_BUDGET)
    if calibration.expected_calibration_error is None:
        reasons.add(REASON_CALIBRATION_UNAVAILABLE)
    elif calibration.expected_calibration_error.mantissa > budget.max_calibration_error.mantissa:
        reasons.add(REASON_CALIBRATION_ERROR_EXCEEDS_BUDGET)
    verdict = Verdict.PASS if not reasons else Verdict.FAIL
    return SurvivalVerdictV1(
        budget_id=budget.budget_id,
        verdict=verdict,
        reasons=tuple(sorted(reasons)),
    )
