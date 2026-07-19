"""Leakage detection and rejection verdicts — the falsification core of Q14.

Two independent detection paths reject the deliberately leaked model:

1. The temporal audit compares every prediction's declared latest feature as-of time
   against its sample's feature cutoff. A leak built from future values carries a
   future as-of time and fails loudly.
2. The behavioral battery catches leaks whose declared lineage lies: skill at or
   beyond the declared implausibility bound is rejected pending falsification, and a
   seeded shuffled-label draw escaping the measured no-skill envelope rejects the
   evaluation pipeline itself.

Rejection has no tolerance-widening path; a rejected model does not reach comparison.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Final, cast

from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import FixedPointV1
from quant_edge.lake.contracts import require_strict_int
from quant_edge.validation.controls import shuffled_labels
from quant_edge.validation.metrics import (
    MetricStatus,
    MetricValueV1,
    PrimaryMetricSpecV1,
    evaluate_primary,
)
from quant_edge.validation.samples import PredictionSetV1, SampleSetV1, rebind_predictions

MAX_VIOLATION_EVIDENCE: Final = 32
MIN_BAND_REPLICATES: Final = 8
MAX_BAND_REPLICATES: Final = 256


class AuditStatus(StrEnum):
    PASSED = "PASSED"
    FAILED = "FAILED"


class LeakageVerdict(StrEnum):
    ACCEPTED_FOR_COMPARISON = "ACCEPTED_FOR_COMPARISON"
    REJECTED_TEMPORAL_LEAK = "REJECTED_TEMPORAL_LEAK"
    REJECTED_IMPLAUSIBLE_SKILL = "REJECTED_IMPLAUSIBLE_SKILL"
    REJECTED_UNVERIFIED_SKILL = "REJECTED_UNVERIFIED_SKILL"
    REJECTED_CONTROL_FAILURE = "REJECTED_CONTROL_FAILURE"
    INVALID_INPUT = "INVALID_INPUT"


@dataclass(frozen=True, slots=True)
class TemporalViolationV1:
    """One prediction whose declared feature as-of time exceeds the sample cutoff."""

    sample_id: str
    max_feature_asof_ns: int
    cutoff_ns: int

    def as_mapping(self) -> dict[str, object]:
        return {
            "cutoffNs": str(self.cutoff_ns),
            "maxFeatureAsofNs": str(self.max_feature_asof_ns),
            "sampleId": self.sample_id,
        }


@dataclass(frozen=True, slots=True)
class TemporalAuditReportV1:
    """Temporal lineage audit outcome with bounded violation evidence."""

    status: AuditStatus
    violation_count: int
    violations: tuple[TemporalViolationV1, ...]

    def as_mapping(self) -> dict[str, object]:
        return {
            "status": self.status.value,
            "violationCount": self.violation_count,
            "violations": [violation.as_mapping() for violation in self.violations],
        }


def audit_temporal_lineage(
    samples: SampleSetV1,
    predictions: PredictionSetV1,
) -> TemporalAuditReportV1:
    """Fail loudly when any declared feature as-of time is after its cutoff."""

    if not isinstance(samples, SampleSetV1):
        raise ContractValueError("samples must be SampleSetV1")
    if not isinstance(predictions, PredictionSetV1):
        raise ContractValueError("predictions must be PredictionSetV1")
    if predictions.dataset_digest != samples.digest():
        raise ContractValueError("prediction set is bound to a different sample set")
    cutoff_by_id = {sample.sample_id: sample.cutoff_ns for sample in samples.samples}
    violations: list[TemporalViolationV1] = []
    violation_count = 0
    for prediction in predictions.predictions:
        cutoff = cutoff_by_id.get(prediction.sample_id)
        if cutoff is None:
            raise ContractValueError(f"unknown sample id: {prediction.sample_id}")
        if prediction.max_feature_asof_ns > cutoff:
            violation_count += 1
            if len(violations) < MAX_VIOLATION_EVIDENCE:
                violations.append(
                    TemporalViolationV1(
                        sample_id=prediction.sample_id,
                        max_feature_asof_ns=prediction.max_feature_asof_ns,
                        cutoff_ns=cutoff,
                    )
                )
    status = AuditStatus.FAILED if violation_count else AuditStatus.PASSED
    return TemporalAuditReportV1(
        status=status,
        violation_count=violation_count,
        violations=tuple(violations),
    )


@dataclass(frozen=True, slots=True)
class LeakageSpecV1:
    """Declared leakage law: primary metric, implausibility bound and band seeds."""

    primary: PrimaryMetricSpecV1
    implausible_skill: FixedPointV1
    band_seed: int
    band_replicates: int

    def __post_init__(self) -> None:
        if not isinstance(self.primary, PrimaryMetricSpecV1):
            raise ContractValueError("primary must be PrimaryMetricSpecV1")
        if not isinstance(self.implausible_skill, FixedPointV1):
            raise ContractValueError("implausible_skill must be FixedPointV1")
        require_strict_int(self.band_seed, field="band_seed", minimum=0)
        require_strict_int(
            self.band_replicates,
            field="band_replicates",
            minimum=MIN_BAND_REPLICATES,
            maximum=MAX_BAND_REPLICATES,
        )

    def as_mapping(self) -> dict[str, object]:
        return {
            "bandReplicates": self.band_replicates,
            "bandSeed": str(self.band_seed),
            "implausibleSkill": self.implausible_skill.as_mapping(),
            "primary": self.primary.as_mapping(),
        }


@dataclass(frozen=True, slots=True)
class NoSkillBandV1:
    """Measured envelope of the primary metric over seeded label shuffles."""

    lower: FixedPointV1
    upper: FixedPointV1
    replicates: int

    def as_mapping(self) -> dict[str, object]:
        return {
            "lower": self.lower.as_mapping(),
            "replicates": self.replicates,
            "upper": self.upper.as_mapping(),
        }


def no_skill_band(
    samples: SampleSetV1,
    predictions: PredictionSetV1,
    spec: LeakageSpecV1,
) -> NoSkillBandV1 | None:
    """Envelope of the metric under seeded shuffles, or None when unmeasurable."""

    if not isinstance(spec, LeakageSpecV1):
        raise ContractValueError("spec must be LeakageSpecV1")
    mantissas: list[int] = []
    for replicate in range(spec.band_replicates):
        shuffled = shuffled_labels(samples, seed=spec.band_seed + replicate)
        rebound = rebind_predictions(predictions, shuffled)
        metric = evaluate_primary(spec.primary, shuffled, rebound)
        if metric.status is MetricStatus.AVAILABLE and metric.value is not None:
            mantissas.append(metric.value.mantissa)
    if not mantissas:
        return None
    return NoSkillBandV1(
        lower=FixedPointV1(min(mantissas)),
        upper=FixedPointV1(max(mantissas)),
        replicates=len(mantissas),
    )


@dataclass(frozen=True, slots=True)
class LeakageAssessmentV1:
    """Verdict plus all evidence used to reach it."""

    model_id: str
    verdict: LeakageVerdict
    audit: TemporalAuditReportV1
    measured_skill: MetricValueV1 | None
    band: NoSkillBandV1 | None
    shuffled_probe: MetricValueV1 | None
    spec: LeakageSpecV1

    def as_mapping(self) -> dict[str, object]:
        return {
            "audit": self.audit.as_mapping(),
            "band": None if self.band is None else self.band.as_mapping(),
            "measuredSkill": (
                None if self.measured_skill is None else self.measured_skill.as_mapping()
            ),
            "modelId": self.model_id,
            "schema": "Q14LeakageAssessmentV1",
            "shuffledProbe": (
                None if self.shuffled_probe is None else self.shuffled_probe.as_mapping()
            ),
            "spec": self.spec.as_mapping(),
            "verdict": self.verdict.value,
        }


def _implausible(skill: FixedPointV1, spec: LeakageSpecV1) -> bool:
    if spec.primary.higher_is_better:
        return skill.mantissa >= spec.implausible_skill.mantissa
    return skill.mantissa <= spec.implausible_skill.mantissa


def _exceeds_no_skill_band(
    skill: FixedPointV1,
    band: NoSkillBandV1,
    spec: LeakageSpecV1,
) -> bool:
    if spec.primary.higher_is_better:
        return skill.mantissa > band.upper.mantissa
    return skill.mantissa < band.lower.mantissa


def control_probe_ok(band: NoSkillBandV1 | None, probe: MetricValueV1) -> bool:
    """The shuffled-label probe must land inside the measured no-skill envelope."""

    if not isinstance(probe, MetricValueV1):
        raise ContractValueError("probe must be MetricValueV1")
    if band is None or probe.status is not MetricStatus.AVAILABLE:
        return False
    value = cast(FixedPointV1, probe.value)
    return band.lower.mantissa <= value.mantissa <= band.upper.mantissa


def assess_leakage(
    samples: SampleSetV1,
    predictions: PredictionSetV1,
    spec: LeakageSpecV1,
) -> LeakageAssessmentV1:
    """Run both detection paths and return the ordered verdict."""

    if not isinstance(spec, LeakageSpecV1):
        raise ContractValueError("spec must be LeakageSpecV1")
    audit = audit_temporal_lineage(samples, predictions)
    if audit.status is AuditStatus.FAILED:
        return LeakageAssessmentV1(
            model_id=predictions.model_id,
            verdict=LeakageVerdict.REJECTED_TEMPORAL_LEAK,
            audit=audit,
            measured_skill=None,
            band=None,
            shuffled_probe=None,
            spec=spec,
        )

    measured = evaluate_primary(spec.primary, samples, predictions)
    if measured.status is not MetricStatus.AVAILABLE or measured.value is None:
        return LeakageAssessmentV1(
            model_id=predictions.model_id,
            verdict=LeakageVerdict.INVALID_INPUT,
            audit=audit,
            measured_skill=measured,
            band=None,
            shuffled_probe=None,
            spec=spec,
        )

    if _implausible(measured.value, spec):
        return LeakageAssessmentV1(
            model_id=predictions.model_id,
            verdict=LeakageVerdict.REJECTED_IMPLAUSIBLE_SKILL,
            audit=audit,
            measured_skill=measured,
            band=None,
            shuffled_probe=None,
            spec=spec,
        )

    band = no_skill_band(samples, predictions, spec)
    if (
        band is not None
        and _exceeds_no_skill_band(measured.value, band, spec)
        and predictions.lineage is None
    ):
        return LeakageAssessmentV1(
            model_id=predictions.model_id,
            verdict=LeakageVerdict.REJECTED_UNVERIFIED_SKILL,
            audit=audit,
            measured_skill=measured,
            band=band,
            shuffled_probe=None,
            spec=spec,
        )
    probe_samples = shuffled_labels(samples, seed=spec.band_seed + spec.band_replicates)
    probe_predictions = rebind_predictions(predictions, probe_samples)
    probe = evaluate_primary(spec.primary, probe_samples, probe_predictions)
    if not control_probe_ok(band, probe):
        return LeakageAssessmentV1(
            model_id=predictions.model_id,
            verdict=LeakageVerdict.REJECTED_CONTROL_FAILURE,
            audit=audit,
            measured_skill=measured,
            band=band,
            shuffled_probe=probe,
            spec=spec,
        )
    return LeakageAssessmentV1(
        model_id=predictions.model_id,
        verdict=LeakageVerdict.ACCEPTED_FOR_COMPARISON,
        audit=audit,
        measured_skill=measured,
        band=band,
        shuffled_probe=probe,
        spec=spec,
    )
