"""Q14 leakage law — including the phase acceptance test.

Section 20 Q14 acceptance: a deliberately leaked model is detected and rejected. The
first test in this file is that acceptance test, covering both detection paths (true
lineage and falsified lineage) plus the honest-baseline non-rejection control.
"""

from __future__ import annotations

from dataclasses import replace

import pytest
from q14_fixtures import (
    informative_predictions,
    make_sample_set,
    outcome_derived_predictions,
    predictions_from_scores,
)

from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import FixedPointV1
from quant_edge.labels.rational import make_ratio
from quant_edge.validation.controls import (
    falsify_lineage,
    future_leaked_predictions,
    random_rank_predictions,
)
from quant_edge.validation.leakage import (
    AuditStatus,
    LeakageSpecV1,
    LeakageVerdict,
    NoSkillBandV1,
    assess_leakage,
    audit_temporal_lineage,
    control_probe_ok,
    no_skill_band,
)
from quant_edge.validation.metrics import (
    MetricKind,
    MetricStatus,
    MetricValueV1,
    PrimaryMetricSpecV1,
)
from quant_edge.validation.samples import PredictionSetV1, PredictionV1

SCALE = 10**12
SEED = 20260712


def _spec(**overrides: object) -> LeakageSpecV1:
    base = LeakageSpecV1(
        primary=PrimaryMetricSpecV1(kind=MetricKind.PR_AUC, k=None, ece_bins=None),
        implausible_skill=FixedPointV1(990_000_000_000),
        band_seed=SEED,
        band_replicates=16,
    )
    return replace(base, **overrides)  # type: ignore[arg-type]


def test_acceptance_deliberately_leaked_model_is_detected_and_rejected() -> None:
    """§20 Q14 acceptance: the deliberate leak is rejected on both detection paths."""

    samples = make_sample_set(60)
    spec = _spec()

    # Path 1: the leak declares its true lineage; the temporal audit rejects it.
    leaked = future_leaked_predictions(samples, model_id="leaked-model")
    truthful = assess_leakage(samples, leaked, spec)
    assert truthful.verdict is LeakageVerdict.REJECTED_TEMPORAL_LEAK
    assert truthful.audit.status is AuditStatus.FAILED
    assert truthful.audit.violation_count == 60
    assert len(truthful.audit.violations) == 32  # bounded evidence

    # Path 2: the same leak forges its as-of times back to the cutoffs; the
    # behavioral battery rejects perfect skill as implausible pending falsification.
    forged = falsify_lineage(leaked, samples)
    behavioral = assess_leakage(samples, forged, spec)
    assert behavioral.verdict is LeakageVerdict.REJECTED_IMPLAUSIBLE_SKILL
    assert behavioral.audit.status is AuditStatus.PASSED
    assert behavioral.measured_skill is not None
    assert behavioral.measured_skill.value == FixedPointV1(SCALE)  # PR-AUC exactly 1

    # Control: an honest no-skill baseline on the same data is NOT rejected.
    honest = random_rank_predictions(samples, seed=7, model_id="random-baseline")
    accepted = assess_leakage(samples, honest, spec)
    assert accepted.verdict is LeakageVerdict.ACCEPTED_FOR_COMPARISON
    assert accepted.band is not None
    assert accepted.shuffled_probe is not None
    mapping = accepted.as_mapping()
    assert mapping["schema"] == "Q14LeakageAssessmentV1"
    assert mapping["verdict"] == "ACCEPTED_FOR_COMPARISON"

    # A skilled model with immutable pre-cutoff feature and fit lineage survives.
    skilled = assess_leakage(samples, informative_predictions(samples), spec)
    assert skilled.verdict is LeakageVerdict.ACCEPTED_FOR_COMPARISON

    # Imperfect outcome-derived controls at several strengths exceed the
    # predeclared permutation/null envelope but carry no feature/fit lineage.
    # They must remain explicit rejected controls rather than comparison evidence.
    for positive, negative, flip_modulus in ((6, 4, 4), (7, 3, 5), (8, 2, 6)):
        outcome_derived = outcome_derived_predictions(
            samples,
            positive_score=make_ratio(positive, 10),
            negative_score=make_ratio(negative, 10),
            flip_modulus=flip_modulus,
        )
        rejected = assess_leakage(samples, outcome_derived, spec)
        assert rejected.verdict is LeakageVerdict.REJECTED_UNVERIFIED_SKILL
        assert rejected.band is not None


def test_temporal_audit_law() -> None:
    samples = make_sample_set(6)
    honest = random_rank_predictions(samples, seed=1, model_id="m")
    report = audit_temporal_lineage(samples, honest)
    assert report.status is AuditStatus.PASSED
    assert report.violation_count == 0
    assert report.as_mapping()["status"] == "PASSED"

    single_leak = PredictionSetV1(
        model_id="m",
        dataset_digest=samples.digest(),
        predictions=tuple(
            PredictionV1(
                sample_id=sample.sample_id,
                score=make_ratio(1, 2),
                max_feature_asof_ns=(
                    sample.label_end_ns if sample.sample_id == "s-0003" else sample.cutoff_ns
                ),
            )
            for sample in samples.samples
        ),
    )
    failed = audit_temporal_lineage(samples, single_leak)
    assert failed.status is AuditStatus.FAILED
    assert failed.violation_count == 1
    assert failed.violations[0].sample_id == "s-0003"

    with pytest.raises(ContractValueError, match="SampleSetV1"):
        audit_temporal_lineage("nope", honest)  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="PredictionSetV1"):
        audit_temporal_lineage(samples, "nope")  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="different sample set"):
        audit_temporal_lineage(make_sample_set(6, dataset_id="other"), honest)
    foreign = PredictionSetV1(
        model_id="m",
        dataset_digest=samples.digest(),
        predictions=(
            PredictionV1(
                sample_id="x-0000",
                score=make_ratio(1, 2),
                max_feature_asof_ns=samples.samples[0].cutoff_ns,
            ),
        ),
    )
    with pytest.raises(ContractValueError, match="unknown sample id"):
        audit_temporal_lineage(samples, foreign)


def test_leakage_spec_contract_law() -> None:
    with pytest.raises(ContractValueError, match="PrimaryMetricSpecV1"):
        _spec(primary="pr_auc")
    with pytest.raises(ContractValueError, match="implausible_skill"):
        _spec(implausible_skill=0.99)
    with pytest.raises(ContractValueError, match="band_replicates"):
        _spec(band_replicates=4)
    mapping = _spec().as_mapping()
    assert mapping["bandReplicates"] == 16


def test_no_skill_band_law() -> None:
    samples = make_sample_set(20)
    predictions = informative_predictions(samples)
    spec = _spec(band_replicates=8)
    band = no_skill_band(samples, predictions, spec)
    assert band is not None
    assert band.replicates == 8
    assert band.lower.mantissa <= band.upper.mantissa
    assert band.as_mapping()["replicates"] == 8

    unknowable = make_sample_set(8, outcome_of=lambda index: None)
    silent = no_skill_band(
        unknowable,
        random_rank_predictions(unknowable, seed=2, model_id="m"),
        spec,
    )
    assert silent is None
    with pytest.raises(ContractValueError, match="LeakageSpecV1"):
        no_skill_band(samples, predictions, "nope")  # type: ignore[arg-type]


def test_control_probe_law() -> None:
    available = MetricValueV1(
        metric_id="m",
        status=MetricStatus.AVAILABLE,
        value=FixedPointV1(500),
        reason=None,
        support=4,
        positive_count=2,
    )
    unknown = MetricValueV1(
        metric_id="m",
        status=MetricStatus.UNKNOWN,
        value=None,
        reason="NO_POSITIVE_SAMPLES",
        support=4,
        positive_count=0,
    )
    band = NoSkillBandV1(lower=FixedPointV1(100), upper=FixedPointV1(900), replicates=8)
    assert control_probe_ok(band, available)
    assert not control_probe_ok(None, available)
    assert not control_probe_ok(band, unknown)
    low = MetricValueV1(
        metric_id="m",
        status=MetricStatus.AVAILABLE,
        value=FixedPointV1(50),
        reason=None,
        support=4,
        positive_count=2,
    )
    high = MetricValueV1(
        metric_id="m",
        status=MetricStatus.AVAILABLE,
        value=FixedPointV1(950),
        reason=None,
        support=4,
        positive_count=2,
    )
    assert not control_probe_ok(band, low)
    assert not control_probe_ok(band, high)
    with pytest.raises(ContractValueError, match="MetricValueV1"):
        control_probe_ok(band, "probe")  # type: ignore[arg-type]


def test_invalid_input_verdict_when_metric_is_unmeasurable() -> None:
    unknowable = make_sample_set(12, outcome_of=lambda index: None)
    predictions = random_rank_predictions(unknowable, seed=3, model_id="m")
    assessment = assess_leakage(unknowable, predictions, _spec())
    assert assessment.verdict is LeakageVerdict.INVALID_INPUT
    assert assessment.measured_skill is not None
    assert assessment.measured_skill.reason == "NO_SCOREABLE_SAMPLES"
    with pytest.raises(ContractValueError, match="LeakageSpecV1"):
        assess_leakage(unknowable, predictions, "nope")  # type: ignore[arg-type]


def test_control_failure_verdict_when_probe_escapes_band() -> None:
    # Regression fixture found by deterministic search: with 9 samples, 8 band
    # replicates and band seed 10, the extra shuffled probe draw falls outside the
    # measured envelope and the factory rejects the evaluation pipeline.
    samples = make_sample_set(9)
    predictions = informative_predictions(samples)
    assessment = assess_leakage(samples, predictions, _spec(band_seed=10, band_replicates=8))
    assert assessment.verdict is LeakageVerdict.REJECTED_CONTROL_FAILURE
    assert assessment.band is not None
    assert assessment.shuffled_probe is not None


def test_lower_is_better_implausibility_direction() -> None:
    samples = make_sample_set(24)
    perfect_scores = {
        sample.sample_id: make_ratio(1 if sample.binary_outcome else 0, 1)
        for sample in samples.samples
    }
    perfect = predictions_from_scores(samples, perfect_scores, model_id="perfect-brier")
    spec = _spec(
        primary=PrimaryMetricSpecV1(kind=MetricKind.BRIER, k=None, ece_bins=None),
        implausible_skill=FixedPointV1(10_000_000_000),  # brier <= 0.01 is implausible
    )
    assessment = assess_leakage(samples, perfect, spec)
    assert assessment.verdict is LeakageVerdict.REJECTED_IMPLAUSIBLE_SKILL
