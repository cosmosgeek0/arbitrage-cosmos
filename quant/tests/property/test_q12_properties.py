from __future__ import annotations

from dataclasses import replace
from fractions import Fraction
from itertools import pairwise

import pytest
from hypothesis import given, seed, settings
from hypothesis import strategies as st

import quant_edge.ensemble.abstention as abstention_module
import quant_edge.ensemble.calibration as calibration_module
import quant_edge.ensemble.stacking as stacking_module
from quant_edge.ensemble import (
    AbstentionReason,
    AdaptiveConformalConfigV1,
    AdvisoryAction,
    BoundConformalModelEvidenceV1,
    BoundDisorderEvidenceV1,
    BoundStressEvidenceV1,
    ConformalResearchSliceV1,
    ConformalSpecV1,
    IntervalObservationV1,
    OofFoldPredictionBundleV1,
    SpecialistProbabilityV1,
    StackingSpecV1,
    adaptive_predict,
    adaptive_update,
    apply_conformal,
    decompose_uncertainty,
    fit_conformal,
    fit_oof_stacker,
    initialize_adaptive_conformal,
    validate_oof_bundles,
)
from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import FIXED_POINT_SCALE, FixedPointV1
from quant_edge.labels.rational import ExactRatioV1, make_ratio
from quant_edge.lake.contracts import DigestV1, EvidencePosture, QualityState
from quant_edge.models.contracts import ProbabilitySemantics
from quant_edge.regime.anomaly import DisorderConfigV1, fuse_disorder
from quant_edge.validation import (
    CostStressScenarioV1,
    OpportunityDecayV1,
    PredictionSetV1,
    PredictionV1,
    SampleSetV1,
    StressSpecV1,
    ValidationSampleV1,
    WalkForwardSpecV1,
    build_walk_forward_plan,
    run_cost_stress,
    subset_by_ids,
)
from quant_edge.validation.splits import SplitScheme

BASE = 1_700_000_000_000_000_000
PROPERTY_SETTINGS = settings(max_examples=30, deadline=None, derandomize=True)


def _ratio_fraction(value: ExactRatioV1) -> Fraction:
    return Fraction(value.numerator, value.denominator)


def _canonical_observation(
    research_slice: ConformalResearchSliceV1,
    sample_id: str,
    outcome: ExactRatioV1 | None,
) -> IntervalObservationV1:
    sample = research_slice.samples.by_id(sample_id)
    center = _ratio_fraction(research_slice.base_score_for(sample_id))
    half_width = _ratio_fraction(research_slice.base_half_width)
    lower = center - half_width
    upper = center + half_width
    return IntervalObservationV1(
        observation_id=sample.sample_id,
        prediction_time_ns=sample.cutoff_ns,
        outcome_time_ns=sample.label_end_ns,
        lower=make_ratio(lower.numerator, lower.denominator),
        upper=make_ratio(upper.numerator, upper.denominator),
        outcome=outcome,
        regime_id="property-regime",
        cohort_id="property-cohort",
        horizon_ns=sample.label_horizon_ns,
    )


def _conformal_research(
    outcomes: tuple[int, ...],
    *,
    assessment_outcome: int = 1,
) -> tuple[
    tuple[IntervalObservationV1, ...],
    ConformalResearchSliceV1,
    ConformalResearchSliceV1,
]:
    segment_size = len(outcomes)
    warmup_ids = tuple(f"property-warmup-{index:04d}" for index in range(segment_size))
    meta_ids = tuple(f"property-meta-{index:04d}" for index in range(segment_size))
    stack_calibration_ids = tuple(
        f"property-stack-calibration-{index:04d}" for index in range(segment_size)
    )
    fit_ids = tuple(f"property-fit-{index:04d}" for index in range(len(outcomes)))
    application_ids = (
        "property-assessment",
        *(f"property-application-{index:04d}" for index in range(segment_size - 1)),
    )
    sample_ids = (
        *warmup_ids,
        *meta_ids,
        *stack_calibration_ids,
        *fit_ids,
        *application_ids,
    )
    binary_outcomes = (
        *(index % 2 for index in range(len(warmup_ids))),
        *(index % 2 for index in range(len(meta_ids))),
        *(index % 2 for index in range(len(stack_calibration_ids))),
        *outcomes,
        assessment_outcome,
        *(index % 2 for index in range(segment_size - 1)),
    )
    rows = tuple(
        ValidationSampleV1(
            sample_id,
            "SYNTH",
            f"group-{sample_id}",
            BASE + index * 100,
            BASE + index * 100 + 10,
            (),
            bool(binary_outcomes[index]),
            make_ratio(1, 100),
            make_ratio(0, 1),
            QualityState.SYNTHETIC,
        )
        for index, sample_id in enumerate(sample_ids)
    )
    samples = SampleSetV1("q12-property-conformal:v1", EvidencePosture.SYNTHETIC, rows)
    split_spec = WalkForwardSpecV1(
        SplitScheme.EXPANDING,
        4,
        10,
        0,
        10,
        1,
        make_ratio(0, 1),
        None,
    )
    plan = build_walk_forward_plan(samples, split_spec)
    folds = plan.folds
    specialist_ids = ("property-specialist-a", "property-specialist-b")
    sample_indexes = {sample_id: index for index, sample_id in enumerate(sample_ids)}
    bundles = tuple(
        OofFoldPredictionBundleV1(
            specialist_id=specialist_id,
            target_id="target",
            horizon_ns=10,
            probability_semantics=ProbabilitySemantics.UNCALIBRATED_SCORE,
            fold_id=fold.fold_id,
            train_sample_ids=fold.train_sample_ids,
            predictions=PredictionSetV1(
                model_id=specialist_id,
                dataset_digest=subset_by_ids(samples, fold.validation_sample_ids).digest(),
                predictions=tuple(
                    PredictionV1(
                        sample_id=sample_id,
                        score=make_ratio(
                            (sample_indexes[sample_id] * (specialist_index + 1) + specialist_index)
                            % 5
                            + 1,
                            6,
                        ),
                        max_feature_asof_ns=samples.by_id(sample_id).cutoff_ns,
                    )
                    for sample_id in sorted(fold.validation_sample_ids)
                ),
            ),
        )
        for fold in folds
        for specialist_index, specialist_id in enumerate(specialist_ids)
    )
    matrix = validate_oof_bundles(
        samples=samples,
        plan=plan,
        target_id="target",
        horizon_ns=10,
        specialist_ids=specialist_ids,
        bundles=bundles,
    )
    fitted_stack = fit_oof_stacker(
        samples=samples,
        matrix=matrix,
        spec=StackingSpecV1(("fold-01",), ("fold-02",), 4),
        stack_id="property-stack",
    )
    fit_slice = ConformalResearchSliceV1(
        samples,
        plan,
        "target",
        ("fold-03",),
        matrix,
        fitted_stack,
        make_ratio(1, 10),
    )
    application_slice = ConformalResearchSliceV1(
        samples,
        plan,
        "target",
        ("fold-04",),
        matrix,
        fitted_stack,
        make_ratio(1, 10),
    )
    observations = tuple(
        _canonical_observation(fit_slice, sample_id, make_ratio(outcomes[index], 1))
        for index, sample_id in enumerate(fit_ids)
    )
    return (
        observations,
        fit_slice,
        application_slice,
    )


@PROPERTY_SETTINGS
@given(st.lists(st.integers(min_value=0, max_value=1), min_size=8, max_size=30))
def test_conformal_order_statistic_is_deterministic_and_intervals_are_ordered(
    outcomes: list[int],
) -> None:
    observations, fit_slice, application_slice = _conformal_research(tuple(outcomes))
    spec = ConformalSpecV1(make_ratio(1, 5), 8)
    left = fit_conformal(observations, spec, research_slice=fit_slice)
    right = fit_conformal(observations, spec, research_slice=fit_slice)
    assert left == right
    evidence = BoundConformalModelEvidenceV1(observations, spec, fit_slice, left)
    assessment = _canonical_observation(
        application_slice,
        "property-assessment",
        None,
    )
    interval = apply_conformal(
        evidence,
        assessment.lower,
        assessment.upper,
        observation_id=assessment.observation_id,
        prediction_time_ns=assessment.prediction_time_ns,
        research_slice=application_slice,
    )
    assert interval.lower is not None
    assert interval.upper is not None
    assert _ratio_fraction(interval.lower) <= _ratio_fraction(interval.upper)


@PROPERTY_SETTINGS
@given(st.integers(min_value=0, max_value=1))
def test_adaptive_prefix_invariance_and_update_direction(
    outcome: int,
) -> None:
    config = AdaptiveConformalConfigV1(
        make_ratio(1, 5),
        make_ratio(1, 20),
        make_ratio(1, 20),
        make_ratio(1, 2),
        8,
        4,
    )
    observations, fit_slice, application_slice = _conformal_research(
        tuple(index % 2 for index in range(8)),
        assessment_outcome=outcome,
    )
    conformal_spec = ConformalSpecV1(make_ratio(1, 5), 4)
    model = fit_conformal(observations, conformal_spec, research_slice=fit_slice)
    model_evidence = BoundConformalModelEvidenceV1(
        observations,
        conformal_spec,
        fit_slice,
        model,
    )
    state = initialize_adaptive_conformal(
        model_evidence=model_evidence,
        config=config,
        observations=observations,
        research_slice=fit_slice,
    )
    pending = _canonical_observation(
        application_slice,
        "property-assessment",
        None,
    )
    prediction = adaptive_predict(state, pending, research_slice=application_slice)
    digest = prediction.as_mapping()
    assert (
        adaptive_update(
            state,
            prediction,
            pending,
            as_of_ns=pending.outcome_time_ns,
            research_slice=application_slice,
        )
        == state
    )
    assert prediction.as_mapping() == digest
    matured = replace(pending, outcome=make_ratio(outcome, 1))
    updated = adaptive_update(
        state,
        prediction,
        matured,
        as_of_ns=matured.outcome_time_ns,
        research_slice=application_slice,
    )
    interval = prediction.interval
    assert interval.lower is not None
    assert interval.upper is not None
    hit = _ratio_fraction(interval.lower) <= Fraction(outcome, 1) <= _ratio_fraction(interval.upper)
    if hit:
        assert _ratio_fraction(updated.alpha) >= _ratio_fraction(state.alpha)
    else:
        assert _ratio_fraction(updated.alpha) <= _ratio_fraction(state.alpha)


@PROPERTY_SETTINGS
@given(
    st.integers(min_value=0, max_value=1_000),
    st.integers(min_value=0, max_value=1_000),
)
def test_uncertainty_disagreement_is_exact_and_specialist_order_independent(
    left: int,
    right: int,
) -> None:
    observations, fit_slice, application_slice = _conformal_research(
        tuple(index % 2 for index in range(8))
    )
    model = fit_conformal(
        observations,
        ConformalSpecV1(make_ratio(1, 5), 4),
        research_slice=fit_slice,
    )
    model_evidence = BoundConformalModelEvidenceV1(
        observations,
        ConformalSpecV1(make_ratio(1, 5), 4),
        fit_slice,
        model,
    )
    assessment = application_slice.samples.by_id("property-assessment")
    assessment_observation = _canonical_observation(
        application_slice,
        assessment.sample_id,
        None,
    )
    interval = apply_conformal(
        model_evidence,
        assessment_observation.lower,
        assessment_observation.upper,
        observation_id=assessment.sample_id,
        prediction_time_ns=assessment.cutoff_ns,
        research_slice=application_slice,
    )
    zero = make_ratio(0, 1)
    assessment_samples = subset_by_ids(application_slice.samples, (assessment.sample_id,))
    stress_spec = StressSpecV1(
        zero,
        OpportunityDecayV1(zero),
        (CostStressScenarioV1("s", zero, zero, zero, zero, zero, 0),),
    )
    stress_report = run_cost_stress(assessment_samples, stress_spec)
    stress_evidence = BoundStressEvidenceV1(
        assessment_samples=assessment_samples,
        target_id="target",
        report=stress_report,
    )
    dataset_digest = assessment_samples.digest()
    disorder_config = DisorderConfigV1("d", 2, 1, 2, FixedPointV1(1))
    disorder = fuse_disorder(
        config=disorder_config,
        input_quality=assessment.quality,
        last_alarm_age=None,
        anomaly_persistence=0,
        regime_uncertainty=FixedPointV1(0),
    )
    disorder_evidence = BoundDisorderEvidenceV1(
        assessment_samples,
        disorder_config,
        None,
        0,
        FixedPointV1(0),
        disorder,
    )
    specialists = (
        SpecialistProbabilityV1(
            "b",
            make_ratio(right, 1_000),
            assessment.sample_id,
            "target",
            assessment.label_horizon_ns,
            dataset_digest,
            DigestV1("b" * 64),
        ),
        SpecialistProbabilityV1(
            "a",
            make_ratio(left, 1_000),
            assessment.sample_id,
            "target",
            assessment.label_horizon_ns,
            dataset_digest,
            DigestV1("a" * 64),
        ),
    )
    vector = decompose_uncertainty(
        disorder_evidence=disorder_evidence,
        specialist_probabilities=specialists,
        combined_probability=make_ratio(left + right, 2_000),
        interval=interval,
        stress_evidence=stress_evidence,
    )
    expected_gap = Fraction(abs(left - right), 1_000)
    expected_variance = expected_gap * expected_gap / 4
    assert vector.maximum_pairwise_gap is not None
    assert vector.disagreement_variance_proxy is not None
    assert _ratio_fraction(vector.maximum_pairwise_gap) == expected_gap
    assert _ratio_fraction(vector.disagreement_variance_proxy) == expected_variance
    assert tuple(item.specialist_id for item in vector.specialist_probabilities) == ("a", "b")


@PROPERTY_SETTINGS
@given(st.integers(min_value=40, max_value=80))
def test_oof_matrix_membership_and_digest_are_deterministic(count: int) -> None:
    samples = SampleSetV1(
        "property-oof:v1",
        EvidencePosture.SYNTHETIC,
        tuple(
            ValidationSampleV1(
                f"s-{index:04d}",
                "SYNTH",
                f"g-{index:04d}",
                BASE + index * 100,
                BASE + index * 100 + 10,
                (),
                index % 2 == 0,
                None,
                None,
                QualityState.SYNTHETIC,
            )
            for index in range(count)
        ),
    )
    plan = build_walk_forward_plan(
        samples,
        WalkForwardSpecV1(
            SplitScheme.EXPANDING,
            3,
            10,
            5,
            15,
            5,
            make_ratio(1, 5),
            None,
        ),
    )
    specialist_ids = ("a", "b")
    bundles = []
    for fold in plan.folds:
        subset = subset_by_ids(samples, fold.validation_sample_ids)
        for specialist_id in specialist_ids:
            bundles.append(
                OofFoldPredictionBundleV1(
                    specialist_id,
                    "target",
                    10,
                    ProbabilitySemantics.UNCALIBRATED_SCORE,
                    fold.fold_id,
                    fold.train_sample_ids,
                    PredictionSetV1(
                        specialist_id,
                        subset.digest(),
                        tuple(
                            PredictionV1(
                                sample.sample_id,
                                make_ratio((index % 3) + 1, 4),
                                sample.cutoff_ns,
                            )
                            for index, sample in enumerate(
                                sorted(subset.samples, key=lambda item: item.sample_id)
                            )
                        ),
                    ),
                )
            )
    matrix = validate_oof_bundles(
        samples=samples,
        plan=plan,
        target_id="target",
        horizon_ns=10,
        specialist_ids=specialist_ids,
        bundles=tuple(bundles),
    )
    again = validate_oof_bundles(
        samples=samples,
        plan=plan,
        target_id="target",
        horizon_ns=10,
        specialist_ids=specialist_ids,
        bundles=tuple(reversed(bundles)),
    )
    assert matrix == again
    assert matrix.digest() == again.digest()


@PROPERTY_SETTINGS
@given(st.lists(st.integers(min_value=0, max_value=1_000), min_size=8, max_size=24))
def test_isotonic_calibration_outputs_are_monotone_and_bounded(scores: list[int]) -> None:
    ordered = sorted(scores)
    rows = tuple(
        (Fraction(score, 1_000), int(index % 3 == 0)) for index, score in enumerate(ordered)
    )
    _, values = calibration_module._fit_isotonic(rows)
    assert all(0 <= value.numerator <= value.denominator for value in values)
    assert all(_ratio_fraction(left) <= _ratio_fraction(right) for left, right in pairwise(values))


@seed(20260712)
@PROPERTY_SETTINGS
@given(
    st.integers(min_value=1, max_value=16),
    st.integers(min_value=2, max_value=4),
)
def test_stacking_compositions_always_produce_normalized_simplex_weights(
    divisions: int,
    specialists: int,
) -> None:
    compositions = stacking_module._compositions(divisions, specialists)
    assert compositions
    for composition in compositions:
        weights = tuple(Fraction(value, divisions) for value in composition)
        assert len(weights) == specialists
        assert sum(weights) == 1
        assert all(0 <= weight <= 1 for weight in weights)


@seed(20260712)
@PROPERTY_SETTINGS
@given(
    st.lists(
        st.tuples(st.integers(min_value=0, max_value=1_000), st.integers(min_value=0, max_value=1)),
        min_size=4,
        max_size=30,
    )
)
def test_platt_outputs_are_bounded_and_available_mapping_is_nondecreasing(
    observations: list[tuple[int, int]],
) -> None:
    rows = tuple((Fraction(score, 1_000), label) for score, label in observations)
    coefficient, intercept = calibration_module._fit_platt(rows)
    ordered_scores = sorted({score for score, _ in rows})
    probabilities = tuple(
        calibration_module._sigmoid(
            coefficient.mantissa / FIXED_POINT_SCALE * float(score)
            + intercept.mantissa / FIXED_POINT_SCALE
        )
        for score in ordered_scores
    )
    assert all(0.0 <= probability <= 1.0 for probability in probabilities)
    if coefficient.mantissa >= 0:
        assert all(left <= right for left, right in pairwise(probabilities))


_ABSTENTION_REASON_ORDER = (
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


@seed(20260712)
@PROPERTY_SETTINGS
@given(
    st.lists(
        st.sampled_from(_ABSTENTION_REASON_ORDER),
        min_size=1,
        max_size=len(_ABSTENTION_REASON_ORDER) * 2,
    )
)
def test_abstention_reasons_have_stable_unique_precedence(
    generated: list[AbstentionReason],
) -> None:
    chosen = set(generated)
    ordered = tuple(reason for reason in _ABSTENTION_REASON_ORDER if reason in chosen)
    decision = abstention_module._AssessmentDecisionV1(
        AdvisoryAction.ABSTAIN_UNKNOWN, ordered, None, None
    )
    assert decision.reasons == ordered
    assert decision.as_mapping()["reasons"] == [reason.value for reason in ordered]

    supplied = tuple(generated)
    if supplied != ordered:
        with pytest.raises(ContractValueError, match="unique and in frozen precedence order"):
            abstention_module._AssessmentDecisionV1(
                AdvisoryAction.ABSTAIN_UNKNOWN, supplied, None, None
            )
