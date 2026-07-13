from __future__ import annotations

from quant_edge.deep import FIXTURE_COUNT, synthetic_q14_sample_set
from quant_edge.features.fixedpoint import FixedPointV1
from quant_edge.validation import (
    LeakageSpecV1,
    LeakageVerdict,
    MetricKind,
    PrimaryMetricSpecV1,
    assess_leakage,
    audit_temporal_lineage,
    falsify_lineage,
    future_leaked_predictions,
)


def _spec() -> LeakageSpecV1:
    return LeakageSpecV1(
        primary=PrimaryMetricSpecV1(MetricKind.PR_AUC, None, None),
        implausible_skill=FixedPointV1(999_000_000_000),
        band_seed=20260713,
        band_replicates=8,
    )


def test_adversarial_future_value_injection_is_caught_by_accepted_q14_gate() -> None:
    samples = synthetic_q14_sample_set()
    leaked = future_leaked_predictions(samples, model_id="q13-deliberate-future-leak")
    audit = audit_temporal_lineage(samples, leaked)
    assessment = assess_leakage(samples, leaked, _spec())

    assert audit.violation_count == FIXTURE_COUNT
    assert len(audit.violations) == FIXTURE_COUNT
    assert assessment.verdict is LeakageVerdict.REJECTED_TEMPORAL_LEAK
    assert assessment.measured_skill is None


def test_forging_feature_asof_does_not_rescue_perfect_future_knowledge() -> None:
    samples = synthetic_q14_sample_set()
    leaked = future_leaked_predictions(samples, model_id="q13-deliberate-future-leak")
    forged = falsify_lineage(leaked, samples)
    assessment = assess_leakage(samples, forged, _spec())

    assert assessment.audit.violation_count == 0
    assert assessment.verdict is LeakageVerdict.REJECTED_IMPLAUSIBLE_SKILL
    assert assessment.measured_skill is not None
