"""Named Q12 uncertainty components; never a fabricated scalar confidence.

The decomposition deliberately publishes operational proxies rather than pretending to
identify Bayesian quantities: source quality is canonical Q02/Q09 truth, OOD state is
the Q09 disorder owner, between-specialist variance is a disagreement proxy, p(1-p) is
an outcome-dispersion proxy, interval width is conformal evidence, and cost/timing
states are adapted from the Q14 stress owner.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from enum import StrEnum
from fractions import Fraction
from typing import cast

from quant_edge.canonical import canonical_json_bytes
from quant_edge.ensemble.conformal import ConformalStatus, PredictionIntervalV1
from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import FixedPointV1
from quant_edge.labels.rational import ExactRatioV1, make_ratio
from quant_edge.lake.contracts import (
    DigestV1,
    QualityState,
    require_contract_id,
    require_strict_int,
)
from quant_edge.regime.anomaly import (
    DisorderAssessmentV1,
    DisorderConfigV1,
    DisorderState,
    fuse_disorder,
)
from quant_edge.validation import (
    CostStressReportV1,
    SampleSetV1,
    run_cost_stress,
)


def _fraction(value: ExactRatioV1) -> Fraction:
    return Fraction(value.numerator, value.denominator)


def _require_probability(value: ExactRatioV1, *, field: str) -> None:
    if not isinstance(value, ExactRatioV1):
        raise ContractValueError(f"{field} must be ExactRatioV1")
    if not 0 <= value.numerator <= value.denominator:
        raise ContractValueError(f"{field} must lie in [0, 1]")


class CostUncertaintyState(StrEnum):
    POSITIVE = "POSITIVE"
    NEGATIVE = "NEGATIVE"
    UNKNOWN = "UNKNOWN"


class TimingUncertaintyState(StrEnum):
    STABLE = "STABLE"
    UNSTABLE = "UNSTABLE"
    UNKNOWN = "UNKNOWN"


@dataclass(frozen=True, slots=True)
class SpecialistProbabilityV1:
    specialist_id: str
    probability: ExactRatioV1
    sample_id: str
    target_id: str
    horizon_ns: int
    source_dataset_digest: DigestV1
    source_prediction_digest: DigestV1

    def __post_init__(self) -> None:
        require_contract_id(self.specialist_id, field="specialist_id")
        _require_probability(self.probability, field="probability")
        require_contract_id(self.sample_id, field="sample_id")
        require_contract_id(self.target_id, field="target_id")
        require_strict_int(self.horizon_ns, field="horizon_ns", minimum=1)
        if not isinstance(self.source_dataset_digest, DigestV1) or not isinstance(
            self.source_prediction_digest, DigestV1
        ):
            raise ContractValueError("specialist source digests must be DigestV1")

    def as_mapping(self) -> dict[str, object]:
        return {
            "probability": self.probability.as_mapping(),
            "specialistId": self.specialist_id,
            "sampleId": self.sample_id,
            "targetId": self.target_id,
            "horizonNs": str(self.horizon_ns),
            "sourceDatasetDigest": self.source_dataset_digest.hexdigest,
            "sourcePredictionDigest": self.source_prediction_digest.hexdigest,
        }


@dataclass(frozen=True, slots=True)
class BoundStressEvidenceV1:
    assessment_samples: SampleSetV1
    target_id: str
    report: CostStressReportV1

    def __post_init__(self) -> None:
        if not isinstance(self.assessment_samples, SampleSetV1):
            raise ContractValueError("assessment_samples must be SampleSetV1")
        if len(self.assessment_samples.samples) != 1:
            raise ContractValueError("assessment_samples must contain exactly one row")
        require_contract_id(self.target_id, field="target_id")
        if not isinstance(self.report, CostStressReportV1):
            raise ContractValueError("report must be CostStressReportV1")
        recomputed = run_cost_stress(self.assessment_samples, self.report.spec)
        if recomputed != self.report:
            raise ContractValueError(
                "stress report must equal run_cost_stress over the exact assessment samples"
            )

    @property
    def sample_id(self) -> str:
        return self.assessment_samples.samples[0].sample_id

    @property
    def horizon_ns(self) -> int:
        return self.assessment_samples.samples[0].label_horizon_ns

    @property
    def assessment_dataset_digest(self) -> DigestV1:
        return self.assessment_samples.digest()

    def as_mapping(self) -> dict[str, object]:
        return {
            "assessmentDatasetDigest": self.assessment_dataset_digest.hexdigest,
            "assessmentSamples": self.assessment_samples.as_mapping(),
            "horizonNs": str(self.horizon_ns),
            "report": self.report.as_mapping(),
            "sampleId": self.sample_id,
            "targetId": self.target_id,
        }

    def digest(self) -> DigestV1:
        return DigestV1(hashlib.sha256(canonical_json_bytes(self.as_mapping())).hexdigest())


@dataclass(frozen=True, slots=True)
class BoundDisorderEvidenceV1:
    """Exact Q09 fusion inputs and their recomputed one-row disorder assessment."""

    assessment_samples: SampleSetV1
    config: DisorderConfigV1
    last_alarm_age: int | None
    anomaly_persistence: int
    regime_uncertainty: FixedPointV1 | None
    assessment: DisorderAssessmentV1

    def __post_init__(self) -> None:
        if not isinstance(self.assessment_samples, SampleSetV1):
            raise ContractValueError("assessment_samples must be SampleSetV1")
        if len(self.assessment_samples.samples) != 1:
            raise ContractValueError("assessment_samples must contain exactly one row")
        if not isinstance(self.config, DisorderConfigV1):
            raise ContractValueError("config must be DisorderConfigV1")
        if not isinstance(self.assessment, DisorderAssessmentV1):
            raise ContractValueError("assessment must be DisorderAssessmentV1")
        recomputed = fuse_disorder(
            config=self.config,
            input_quality=self.assessment_samples.samples[0].quality,
            last_alarm_age=self.last_alarm_age,
            anomaly_persistence=self.anomaly_persistence,
            regime_uncertainty=self.regime_uncertainty,
        )
        if recomputed != self.assessment:
            raise ContractValueError("assessment must equal the recomputed Q09 disorder fusion")

    @property
    def sample_id(self) -> str:
        return self.assessment_samples.samples[0].sample_id

    def as_mapping(self) -> dict[str, object]:
        return {
            "anomalyPersistence": self.anomaly_persistence,
            "assessment": self.assessment.as_mapping(),
            "assessmentSamples": self.assessment_samples.as_mapping(),
            "assessmentSamplesDigest": self.assessment_samples.digest().hexdigest,
            "config": self.config.as_mapping(),
            "lastAlarmAge": self.last_alarm_age,
            "regimeUncertainty": (
                None if self.regime_uncertainty is None else self.regime_uncertainty.as_mapping()
            ),
        }

    def digest(self) -> DigestV1:
        return DigestV1(hashlib.sha256(canonical_json_bytes(self.as_mapping())).hexdigest())


@dataclass(frozen=True, slots=True)
class UncertaintyVectorV1:
    sample_id: str
    target_id: str
    horizon_ns: int
    source_quality: QualityState
    ood_state: DisorderState
    disorder_evidence_digest: DigestV1
    specialist_probabilities: tuple[SpecialistProbabilityV1, ...]
    disagreement_variance_proxy: ExactRatioV1 | None
    maximum_pairwise_gap: ExactRatioV1 | None
    outcome_dispersion_proxy: ExactRatioV1 | None
    conformal_interval_width: ExactRatioV1 | None
    stress_evidence_digest: DigestV1
    cost_fill_state: CostUncertaintyState
    timing_decay_state: TimingUncertaintyState

    def __post_init__(self) -> None:
        require_contract_id(self.sample_id, field="sample_id")
        require_contract_id(self.target_id, field="target_id")
        require_strict_int(self.horizon_ns, field="horizon_ns", minimum=1)
        if not isinstance(self.source_quality, QualityState):
            raise ContractValueError("source_quality must be QualityState")
        if not isinstance(self.ood_state, DisorderState):
            raise ContractValueError("ood_state must be DisorderState")
        if not isinstance(self.disorder_evidence_digest, DigestV1):
            raise ContractValueError("disorder_evidence_digest must be DigestV1")
        if (
            not isinstance(self.specialist_probabilities, tuple)
            or not 0 <= len(self.specialist_probabilities) <= 8
        ):
            raise ContractValueError("specialist_probabilities must hold 0..8 entries")
        if any(
            not isinstance(item, SpecialistProbabilityV1) for item in self.specialist_probabilities
        ):
            raise ContractValueError("specialist probabilities must be typed")
        ids = tuple(item.specialist_id for item in self.specialist_probabilities)
        if ids != tuple(sorted(set(ids))):
            raise ContractValueError("specialist probabilities must be sorted and unique")
        if any(
            (item.sample_id, item.target_id, item.horizon_ns)
            != (self.sample_id, self.target_id, self.horizon_ns)
            for item in self.specialist_probabilities
        ):
            raise ContractValueError("specialist lineage must match the uncertainty assessment")
        if len(self.specialist_probabilities) < 2:
            if (
                self.disagreement_variance_proxy is not None
                or self.maximum_pairwise_gap is not None
            ):
                raise ContractValueError("missing specialist disagreement and gap must remain None")
        else:
            if self.disagreement_variance_proxy is None or self.maximum_pairwise_gap is None:
                raise ContractValueError("complete specialist disagreement and gap must be present")
            _require_probability(
                self.disagreement_variance_proxy,
                field="disagreement_variance_proxy",
            )
            _require_probability(self.maximum_pairwise_gap, field="maximum_pairwise_gap")
        if self.outcome_dispersion_proxy is not None:
            _require_probability(self.outcome_dispersion_proxy, field="outcome_dispersion_proxy")
        if self.conformal_interval_width is not None and self.conformal_interval_width.is_negative:
            raise ContractValueError("conformal interval width cannot be negative")
        if not isinstance(self.stress_evidence_digest, DigestV1):
            raise ContractValueError("stress_evidence_digest must be DigestV1")
        if not isinstance(self.cost_fill_state, CostUncertaintyState):
            raise ContractValueError("cost_fill_state must be CostUncertaintyState")
        if not isinstance(self.timing_decay_state, TimingUncertaintyState):
            raise ContractValueError("timing_decay_state must be TimingUncertaintyState")

    def as_mapping(self) -> dict[str, object]:
        return {
            "conformalIntervalWidth": (
                None
                if self.conformal_interval_width is None
                else self.conformal_interval_width.as_mapping()
            ),
            "costFillState": self.cost_fill_state.value,
            "disagreementVarianceProxy": (
                None
                if self.disagreement_variance_proxy is None
                else self.disagreement_variance_proxy.as_mapping()
            ),
            "disorderEvidenceDigest": self.disorder_evidence_digest.hexdigest,
            "maximumPairwiseGap": (
                None
                if self.maximum_pairwise_gap is None
                else self.maximum_pairwise_gap.as_mapping()
            ),
            "oodState": self.ood_state.value,
            "outcomeDispersionProxy": (
                None
                if self.outcome_dispersion_proxy is None
                else self.outcome_dispersion_proxy.as_mapping()
            ),
            "sourceQuality": self.source_quality.value,
            "sampleId": self.sample_id,
            "targetId": self.target_id,
            "horizonNs": str(self.horizon_ns),
            "stressEvidenceDigest": self.stress_evidence_digest.hexdigest,
            "specialistProbabilities": [
                item.as_mapping() for item in self.specialist_probabilities
            ],
            "timingDecayState": self.timing_decay_state.value,
        }


def decompose_uncertainty(
    *,
    disorder_evidence: BoundDisorderEvidenceV1,
    specialist_probabilities: tuple[SpecialistProbabilityV1, ...],
    combined_probability: ExactRatioV1 | None,
    interval: PredictionIntervalV1,
    stress_evidence: BoundStressEvidenceV1,
) -> UncertaintyVectorV1:
    if not isinstance(disorder_evidence, BoundDisorderEvidenceV1):
        raise ContractValueError("disorder_evidence must be BoundDisorderEvidenceV1")
    if not isinstance(stress_evidence, BoundStressEvidenceV1):
        raise ContractValueError("stress_evidence must be BoundStressEvidenceV1")
    disorder_evidence.__post_init__()
    stress_evidence.__post_init__()
    if disorder_evidence.assessment_samples != stress_evidence.assessment_samples:
        raise ContractValueError("disorder and stress evidence must bind the same assessment")
    total_stress_support = 0
    any_abstain = False
    any_negative = False
    any_flip = False
    for outcome_index, stress_outcome in enumerate(stress_evidence.report.outcomes):
        counts = (
            stress_outcome.actionable_count,
            stress_outcome.not_actionable_count,
            stress_outcome.abstain_count,
        )
        for count_index, count in enumerate(counts):
            require_strict_int(
                count,
                field=f"stress outcome {outcome_index} count {count_index}",
                minimum=0,
            )
        require_strict_int(
            stress_outcome.flipped_from_base_count,
            field=f"stress outcome {outcome_index} flipped_from_base_count",
            minimum=0,
        )
        support = sum(counts)
        total_stress_support += support
        any_abstain = any_abstain or stress_outcome.abstain_count > 0
        any_negative = any_negative or stress_outcome.not_actionable_count > 0
        any_flip = any_flip or stress_outcome.flipped_from_base_count > 0
    if not isinstance(interval, PredictionIntervalV1):
        raise ContractValueError("interval must be PredictionIntervalV1")
    if combined_probability is not None:
        _require_probability(combined_probability, field="combined_probability")
    if not isinstance(specialist_probabilities, tuple) or len(specialist_probabilities) > 8:
        raise ContractValueError("specialist_probabilities must be a tuple of at most 8 entries")
    if any(not isinstance(item, SpecialistProbabilityV1) for item in specialist_probabilities):
        raise ContractValueError("specialist probabilities must be typed")
    ordered = tuple(sorted(specialist_probabilities, key=lambda item: item.specialist_id))
    if len({item.specialist_id for item in ordered}) != len(ordered):
        raise ContractValueError("specialist probabilities must be unique")
    if any(
        (item.sample_id, item.target_id, item.horizon_ns)
        != (stress_evidence.sample_id, stress_evidence.target_id, stress_evidence.horizon_ns)
        for item in ordered
    ):
        raise ContractValueError("specialist lineage must match the stress assessment")
    disagreement: ExactRatioV1 | None = None
    gap: ExactRatioV1 | None = None
    if len(ordered) >= 2:
        probabilities = tuple(_fraction(item.probability) for item in ordered)
        mean = sum(probabilities, Fraction(0)) / len(probabilities)
        variance = sum(((value - mean) ** 2 for value in probabilities), Fraction(0)) / len(
            probabilities
        )
        pairwise_gap = max(probabilities) - min(probabilities)
        disagreement = make_ratio(variance.numerator, variance.denominator)
        gap = make_ratio(pairwise_gap.numerator, pairwise_gap.denominator)
    outcome_dispersion: ExactRatioV1 | None = None
    if combined_probability is not None:
        combined = _fraction(combined_probability)
        dispersion = combined * (1 - combined)
        outcome_dispersion = make_ratio(dispersion.numerator, dispersion.denominator)
    width: ExactRatioV1 | None = None
    if interval.status is ConformalStatus.AVAILABLE:
        lower = cast(ExactRatioV1, interval.lower)
        upper = cast(ExactRatioV1, interval.upper)
        width_fraction = _fraction(upper) - _fraction(lower)
        width = make_ratio(width_fraction.numerator, width_fraction.denominator)
    if total_stress_support == 0 or any_abstain:
        cost_state = CostUncertaintyState.UNKNOWN
    elif any_negative:
        cost_state = CostUncertaintyState.NEGATIVE
    else:
        cost_state = CostUncertaintyState.POSITIVE
    if any_flip:
        timing_state = TimingUncertaintyState.UNSTABLE
    elif cost_state is CostUncertaintyState.UNKNOWN:
        timing_state = TimingUncertaintyState.UNKNOWN
    else:
        timing_state = TimingUncertaintyState.STABLE
    return UncertaintyVectorV1(
        sample_id=stress_evidence.sample_id,
        target_id=stress_evidence.target_id,
        horizon_ns=stress_evidence.horizon_ns,
        source_quality=stress_evidence.assessment_samples.samples[0].quality,
        ood_state=disorder_evidence.assessment.state,
        disorder_evidence_digest=disorder_evidence.digest(),
        specialist_probabilities=ordered,
        disagreement_variance_proxy=disagreement,
        maximum_pairwise_gap=gap,
        outcome_dispersion_proxy=outcome_dispersion,
        conformal_interval_width=width,
        stress_evidence_digest=stress_evidence.digest(),
        cost_fill_state=cost_state,
        timing_decay_state=timing_state,
    )
