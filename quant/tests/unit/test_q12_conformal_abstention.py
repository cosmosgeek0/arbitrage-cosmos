from __future__ import annotations

from dataclasses import fields, replace
from typing import Any, cast

import pytest

import quant_edge.ensemble.abstention as abstention_module
import quant_edge.ensemble.conformal as conformal_module
import quant_edge.ensemble.uncertainty as uncertainty_module
from quant_edge.ensemble import (
    AbstentionContextV1,
    AbstentionReason,
    AdaptiveConformalConfigV1,
    AdaptiveConformalStateV1,
    AdaptivePredictionV1,
    AdvisoryAction,
    BoundAssessmentDecisionV1,
    BoundCalibratedAssessmentV1,
    BoundConformalAssessmentV1,
    BoundConformalModelEvidenceV1,
    BoundCoverageEvidenceV1,
    BoundDisorderEvidenceV1,
    BoundStressEvidenceV1,
    CalibrationSpecV1,
    ConformalModelV1,
    ConformalResearchSliceV1,
    ConformalSpecV1,
    ConformalStatus,
    CostUncertaintyState,
    CoverageReportV1,
    CoverageStatus,
    IntervalObservationV1,
    OofFoldPredictionBundleV1,
    PredictionIntervalV1,
    SpecialistProbabilityV1,
    StackingSpecV1,
    TimingUncertaintyState,
    UncertaintyVectorV1,
    adaptive_predict,
    adaptive_update,
    apply_conformal,
    bind_calibrated_assessment,
    compare_calibrators,
    decide_advisory,
    decompose_uncertainty,
    fit_conformal,
    fit_oof_stacker,
    initialize_adaptive_conformal,
    monitor_coverage,
    validate_oof_bundles,
)
from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import FixedPointV1
from quant_edge.labels.rational import ExactRatioV1, make_ratio
from quant_edge.lake.contracts import DigestV1, EvidencePosture, QualityState
from quant_edge.models.contracts import ProbabilitySemantics
from quant_edge.regime.anomaly import (
    DisorderAssessmentV1,
    DisorderConfigV1,
    DisorderReason,
    DisorderState,
    fuse_disorder,
)
from quant_edge.regime.contracts import InputDisposition, disposition_from_quality
from quant_edge.validation import (
    CostStressReportV1,
    CostStressScenarioV1,
    OpportunityDecayV1,
    PredictionSetV1,
    PredictionV1,
    SampleSetV1,
    ScenarioOutcomeV1,
    StressSpecV1,
    ValidationSampleV1,
    WalkForwardSpecV1,
    build_walk_forward_plan,
    run_cost_stress,
    subset_by_ids,
)
from quant_edge.validation.splits import SplitScheme

BASE = 1_700_000_000_000_000_000
ZERO_DIGEST = DigestV1("0" * 64)


def _unsafe_replace(value: Any, **changes: object) -> Any:
    forged = object.__new__(type(value))
    for field in fields(value):
        object.__setattr__(
            forged,
            field.name,
            changes.get(field.name, getattr(value, field.name)),
        )
    return forged


def _observations(count: int = 20) -> tuple[IntervalObservationV1, ...]:
    return tuple(
        IntervalObservationV1(
            observation_id=f"interval-{index:04d}",
            prediction_time_ns=BASE + index * 100,
            outcome_time_ns=BASE + index * 100 + 10,
            lower=make_ratio(1, 4),
            upper=make_ratio(3, 4),
            outcome=make_ratio(index % 2, 1),
            regime_id="normal-regime",
            cohort_id="liquid-cohort",
            horizon_ns=10,
        )
        for index in range(count)
    )


def _research_environment(
    count: int = 20,
) -> tuple[
    tuple[IntervalObservationV1, ...],
    ConformalResearchSliceV1,
    tuple[IntervalObservationV1, ...],
    ConformalResearchSliceV1,
    ConformalResearchSliceV1,
]:
    calibration = _observations(count)
    evaluation = tuple(
        replace(
            item,
            observation_id=f"evaluation-{index:04d}",
            prediction_time_ns=calibration[-1].outcome_time_ns + (index + 1) * 100,
            outcome_time_ns=calibration[-1].outcome_time_ns + (index + 1) * 100 + 10,
        )
        for index, item in enumerate(calibration)
    )
    assessment_time = evaluation[-1].outcome_time_ns + 100
    all_rows = (*calibration, *evaluation)
    bootstrap_ids = tuple(f"bootstrap-{index:04d}" for index in range(count))
    training_ids = tuple(f"training-{index:04d}" for index in range(count))
    application_ids = (
        "assessment-0001",
        *(f"application-{index:04d}" for index in range(count - 1)),
    )
    samples = SampleSetV1(
        "q12-conformal:v1",
        EvidencePosture.SYNTHETIC,
        (
            *(
                ValidationSampleV1(
                    sample_id,
                    "SYNTH",
                    f"group-{sample_id}",
                    calibration[0].prediction_time_ns - (2 * count - index) * 100,
                    calibration[0].prediction_time_ns - (2 * count - index) * 100 + 10,
                    (),
                    False,
                    None,
                    None,
                    QualityState.SYNTHETIC,
                )
                for index, sample_id in enumerate(bootstrap_ids)
            ),
            *(
                ValidationSampleV1(
                    sample_id,
                    "SYNTH",
                    f"group-{sample_id}",
                    calibration[0].prediction_time_ns - (count - index) * 100,
                    calibration[0].prediction_time_ns - (count - index) * 100 + 10,
                    (),
                    False,
                    None,
                    None,
                    QualityState.SYNTHETIC,
                )
                for index, sample_id in enumerate(training_ids)
            ),
            *(
                ValidationSampleV1(
                    row.observation_id,
                    "SYNTH",
                    f"group-{row.observation_id}",
                    row.prediction_time_ns,
                    row.outcome_time_ns,
                    (),
                    bool(index % 2),
                    None,
                    None,
                    QualityState.SYNTHETIC,
                )
                for index, row in enumerate(all_rows)
            ),
            *(
                ValidationSampleV1(
                    sample_id,
                    "SYNTH",
                    f"group-{sample_id}",
                    assessment_time + index * 100,
                    assessment_time + index * 100 + 10,
                    (),
                    False,
                    None,
                    None,
                    QualityState.SYNTHETIC,
                )
                for index, sample_id in enumerate(application_ids)
            ),
        ),
    )
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
    specialist_ids = ("conformal-specialist-a:v1", "conformal-specialist-b:v1")
    bundles = tuple(
        OofFoldPredictionBundleV1(
            specialist_id=specialist_id,
            target_id="transition-binary:v1",
            horizon_ns=10,
            probability_semantics=ProbabilitySemantics.UNCALIBRATED_SCORE,
            fold_id=fold.fold_id,
            train_sample_ids=fold.train_sample_ids,
            predictions=PredictionSetV1(
                specialist_id,
                subset_by_ids(samples, fold.validation_sample_ids).digest(),
                tuple(
                    PredictionV1(sample_id, make_ratio(1, 2), samples.by_id(sample_id).cutoff_ns)
                    for sample_id in sorted(fold.validation_sample_ids)
                ),
            ),
        )
        for fold in folds
        for specialist_id in specialist_ids
    )
    matrix = validate_oof_bundles(
        samples=samples,
        plan=plan,
        target_id="transition-binary:v1",
        horizon_ns=10,
        specialist_ids=specialist_ids,
        bundles=bundles,
    )
    fitted = fit_oof_stacker(
        samples=samples,
        matrix=matrix,
        spec=StackingSpecV1(("fold-01",), ("fold-02",), 4),
        stack_id="conformal-stack:v1",
    )
    width = make_ratio(1, 4)
    return (
        calibration,
        ConformalResearchSliceV1(
            samples,
            plan,
            "transition-binary:v1",
            ("fold-02",),
            matrix,
            fitted,
            width,
        ),
        evaluation,
        ConformalResearchSliceV1(
            samples,
            plan,
            "transition-binary:v1",
            ("fold-03",),
            matrix,
            fitted,
            width,
        ),
        ConformalResearchSliceV1(
            samples,
            plan,
            "transition-binary:v1",
            ("fold-04",),
            matrix,
            fitted,
            width,
        ),
    )


def _conformal(
    spec: ConformalSpecV1 | None = None,
) -> tuple[
    tuple[IntervalObservationV1, ...],
    BoundConformalModelEvidenceV1,
    PredictionIntervalV1,
    CoverageReportV1,
    ConformalResearchSliceV1,
]:
    calibration, calibration_slice, evaluation, evaluation_slice, assessment_slice = (
        _research_environment()
    )
    conformal_spec = ConformalSpecV1(make_ratio(1, 5), 8) if spec is None else spec
    model = fit_conformal(
        calibration,
        conformal_spec,
        research_slice=calibration_slice,
    )
    model_evidence = BoundConformalModelEvidenceV1(
        calibration,
        conformal_spec,
        calibration_slice,
        model,
    )
    assessment = assessment_slice.samples.by_id("assessment-0001")
    interval = apply_conformal(
        model_evidence,
        make_ratio(1, 4),
        make_ratio(3, 4),
        observation_id=assessment.sample_id,
        prediction_time_ns=assessment.cutoff_ns,
        research_slice=assessment_slice,
    )
    intervals = tuple(
        apply_conformal(
            model_evidence,
            item.lower,
            item.upper,
            observation_id=item.observation_id,
            prediction_time_ns=item.prediction_time_ns,
            research_slice=evaluation_slice,
        )
        for item in evaluation
    )
    coverage = monitor_coverage(
        observations=evaluation,
        intervals=intervals,
        min_support=8,
        minimum_coverage=make_ratio(4, 5),
    )
    return evaluation, model_evidence, interval, coverage, assessment_slice


def _stress(
    *, actionable: int = 1, not_actionable: int = 0, abstain: int = 0, flipped: int = 0
) -> ScenarioOutcomeV1:
    value = FixedPointV1(1) if abstain == 0 else None
    return ScenarioOutcomeV1(
        scenario_id="scenario:v1",
        actionable_count=actionable,
        not_actionable_count=not_actionable,
        abstain_count=abstain,
        flipped_from_base_count=flipped,
        mean_net_edge=value,
        min_net_edge=value,
    )


def _stress_report(stress: ScenarioOutcomeV1, samples: SampleSetV1) -> CostStressReportV1:
    zero = make_ratio(0, 1)
    fee = make_ratio(3, 1_000) if stress.flipped_from_base_count else zero
    return run_cost_stress(
        samples,
        StressSpecV1(
            act_threshold=zero,
            decay=OpportunityDecayV1(zero),
            scenarios=(
                CostStressScenarioV1(
                    stress.scenario_id,
                    fee,
                    zero,
                    zero,
                    zero,
                    zero,
                    0,
                ),
            ),
        ),
    )


def _assessment_samples(
    interval: PredictionIntervalV1,
    *,
    stress: ScenarioOutcomeV1 | None = None,
    quality: QualityState = QualityState.SYNTHETIC,
) -> SampleSetV1:
    selected = _stress() if stress is None else stress
    gross = make_ratio(3, 1_000)
    base: ExactRatioV1 | None = make_ratio(1, 1_000)
    if selected.abstain_count:
        base = None
    elif selected.not_actionable_count and not selected.flipped_from_base_count:
        gross = make_ratio(0, 1)
    return SampleSetV1(
        "q12-assessment:v1",
        EvidencePosture.SYNTHETIC,
        (
            ValidationSampleV1(
                sample_id=interval.observation_id,
                symbol="SYNTH",
                group_id="assessment-group:v1",
                cutoff_ns=interval.prediction_time_ns,
                label_end_ns=interval.prediction_time_ns + interval.horizon_ns,
                strata=(),
                binary_outcome=None,
                gross_edge_ratio=gross,
                base_cost_ratio=base,
                quality=quality,
            ),
        ),
    )


def _stress_evidence(
    stress: ScenarioOutcomeV1,
    samples: SampleSetV1,
    *,
    target_id: str = "transition-binary:v1",
) -> BoundStressEvidenceV1:
    report = _stress_report(stress, samples)
    return BoundStressEvidenceV1(
        assessment_samples=samples,
        target_id=target_id,
        report=report,
    )


def _disorder(state: DisorderState) -> DisorderAssessmentV1:
    reasons = {
        DisorderState.NORMAL: (),
        DisorderState.WATCH: (DisorderReason.REGIME_UNCERTAIN,),
        DisorderState.DISORDERED: (DisorderReason.RECENT_CHANGEPOINT,),
        DisorderState.OOD_SUSPECT: (DisorderReason.ANOMALY_PERSISTENCE_OOD,),
        DisorderState.UNKNOWN: (DisorderReason.INPUT_QUALITY,),
    }[state]
    return DisorderAssessmentV1("q12-disorder:v1", state, reasons)


def _disorder_evidence(
    state: DisorderState,
    samples: SampleSetV1,
) -> BoundDisorderEvidenceV1:
    config = DisorderConfigV1(
        "q12-disorder:v1",
        alarm_recency_bars=2,
        persistence_watch=2,
        persistence_ood=4,
        uncertainty_threshold=FixedPointV1(500_000_000_000),
    )
    last_alarm_age: int | None = None
    persistence = 0
    regime_uncertainty = FixedPointV1(0)
    if state is DisorderState.WATCH:
        persistence = 2
    elif state is DisorderState.DISORDERED:
        last_alarm_age = 1
    elif state is DisorderState.OOD_SUSPECT:
        persistence = 4
    assessment = fuse_disorder(
        config=config,
        input_quality=samples.samples[0].quality,
        last_alarm_age=last_alarm_age,
        anomaly_persistence=persistence,
        regime_uncertainty=regime_uncertainty,
    )
    if assessment.state is not state:
        raise AssertionError("test fixture quality cannot produce requested disorder state")
    return BoundDisorderEvidenceV1(
        assessment_samples=samples,
        config=config,
        last_alarm_age=last_alarm_age,
        anomaly_persistence=persistence,
        regime_uncertainty=regime_uncertainty,
        assessment=assessment,
    )


def _specialists(
    left: ExactRatioV1 | None = None,
    right: ExactRatioV1 | None = None,
) -> tuple[SpecialistProbabilityV1, ...]:
    left_value = make_ratio(2, 5) if left is None else left
    right_value = make_ratio(1, 2) if right is None else right
    interval = _conformal()[2]
    samples = _assessment_samples(interval)
    return (
        SpecialistProbabilityV1(
            "specialist-a:v1",
            left_value,
            interval.observation_id,
            "transition-binary:v1",
            interval.horizon_ns,
            samples.digest(),
            DigestV1("a" * 64),
        ),
        SpecialistProbabilityV1(
            "specialist-b:v1",
            right_value,
            interval.observation_id,
            "transition-binary:v1",
            interval.horizon_ns,
            samples.digest(),
            DigestV1("b" * 64),
        ),
    )


def _uncertainty(
    *,
    quality: QualityState = QualityState.SYNTHETIC,
    disorder: DisorderState = DisorderState.NORMAL,
    specialists: tuple[SpecialistProbabilityV1, ...] | None = None,
    stress: ScenarioOutcomeV1 | None = None,
) -> UncertaintyVectorV1:
    _, _, interval, _, _ = _conformal()
    selected_stress = _stress() if stress is None else stress
    effective_quality = QualityState.GAPPED if disorder is DisorderState.UNKNOWN else quality
    effective_disorder = disorder
    if disposition_from_quality(effective_quality) is not InputDisposition.ELIGIBLE:
        effective_disorder = DisorderState.UNKNOWN
    samples = _assessment_samples(interval, stress=selected_stress, quality=effective_quality)
    return decompose_uncertainty(
        disorder_evidence=_disorder_evidence(effective_disorder, samples),
        specialist_probabilities=_specialists() if specialists is None else specialists,
        combined_probability=make_ratio(9, 20),
        interval=interval,
        stress_evidence=_stress_evidence(selected_stress, samples),
    )


_SPECIALIST_IDS = ("specialist-a:v1", "specialist-b:v1")


def _ensemble_score(specialist_id: str, sample_id: str) -> ExactRatioV1:
    index = int(sample_id.rsplit("-", maxsplit=1)[1])
    latent = (index * 37 + 11) % 101
    numerator = 20 + latent * (9 if specialist_id.endswith("a:v1") else 7)
    if specialist_id.endswith("b:v1"):
        numerator += (index % 3 - 1) * 40
    return make_ratio(min(max(numerator, 0), 1_000), 1_000)


def _bound_calibrated(
    *,
    quality: QualityState,
    stress: ScenarioOutcomeV1,
    specialist_values: tuple[ExactRatioV1, ExactRatioV1] | None,
    collapse_coverage: bool = False,
) -> BoundCalibratedAssessmentV1:
    base_samples = SampleSetV1(
        "q12-abstention-ensemble:v1",
        EvidencePosture.SYNTHETIC,
        tuple(
            ValidationSampleV1(
                f"ensemble-{index:04d}",
                "SYNTH",
                f"event-{index:04d}",
                BASE + index * 100,
                BASE + index * 100 + 10,
                (),
                ((index * 37 + 11) % 101) >= 50,
                make_ratio(3, 1_000),
                make_ratio(1, 1_000),
                QualityState.SYNTHETIC,
            )
            for index in range(72)
        ),
    )
    split_spec = WalkForwardSpecV1(
        SplitScheme.EXPANDING,
        4,
        10,
        5,
        15,
        6,
        make_ratio(1, 6),
        None,
    )
    initial_plan = build_walk_forward_plan(base_samples, split_spec)
    assessment_sample_id = initial_plan.folds[-1].validation_sample_ids[0]
    coverage_sample_ids = set(initial_plan.folds[2].validation_sample_ids)
    gross = make_ratio(3, 1_000)
    base_cost: ExactRatioV1 | None = make_ratio(1, 1_000)
    if stress.abstain_count:
        base_cost = None
    elif stress.not_actionable_count and not stress.flipped_from_base_count:
        gross = make_ratio(0, 1)

    def adjusted(sample: ValidationSampleV1) -> ValidationSampleV1:
        binary_outcome = sample.binary_outcome
        if collapse_coverage and sample.sample_id in coverage_sample_ids:
            left = _ensemble_score(_SPECIALIST_IDS[0], sample.sample_id)
            right = _ensemble_score(_SPECIALIST_IDS[1], sample.sample_id)
            binary_outcome = (
                left.numerator * right.denominator + right.numerator * left.denominator
                < left.denominator * right.denominator
            )
        if sample.sample_id == assessment_sample_id:
            return replace(
                sample,
                binary_outcome=binary_outcome,
                quality=quality,
                gross_edge_ratio=gross,
                base_cost_ratio=base_cost,
            )
        if binary_outcome != sample.binary_outcome:
            return replace(sample, binary_outcome=binary_outcome)
        return sample

    samples = SampleSetV1(
        base_samples.dataset_id,
        base_samples.posture,
        tuple(adjusted(sample) for sample in base_samples.samples),
    )
    plan = build_walk_forward_plan(samples, split_spec)
    bundles: list[OofFoldPredictionBundleV1] = []
    for fold in plan.folds:
        subset = subset_by_ids(samples, fold.validation_sample_ids)
        for specialist_index, specialist_id in enumerate(_SPECIALIST_IDS):
            predictions = tuple(
                PredictionV1(
                    sample.sample_id,
                    (
                        specialist_values[specialist_index]
                        if specialist_values is not None
                        and sample.sample_id == assessment_sample_id
                        else _ensemble_score(specialist_id, sample.sample_id)
                    ),
                    sample.cutoff_ns,
                )
                for sample in sorted(subset.samples, key=lambda item: item.sample_id)
            )
            bundles.append(
                OofFoldPredictionBundleV1(
                    specialist_id=specialist_id,
                    target_id="transition-binary:v1",
                    horizon_ns=10,
                    probability_semantics=ProbabilitySemantics.UNCALIBRATED_SCORE,
                    fold_id=fold.fold_id,
                    train_sample_ids=fold.train_sample_ids,
                    predictions=PredictionSetV1(
                        specialist_id,
                        subset.digest(),
                        predictions,
                    ),
                )
            )
    matrix = validate_oof_bundles(
        samples=samples,
        plan=plan,
        target_id="transition-binary:v1",
        horizon_ns=10,
        specialist_ids=_SPECIALIST_IDS,
        bundles=tuple(bundles),
    )
    fitted = fit_oof_stacker(
        samples=samples,
        matrix=matrix,
        spec=StackingSpecV1(matrix.fold_ids[:1], matrix.fold_ids[1:2], 8),
        stack_id="abstention-stack:v1",
    )
    calibration_spec = CalibrationSpecV1(6, 3, (4, 8))
    calibrator, comparison = compare_calibrators(
        samples=samples,
        matrix=matrix,
        fitted=fitted,
        evaluation_fold_ids=matrix.fold_ids[2:3],
        spec=calibration_spec,
    )
    evaluation = next(item for item in comparison.evaluations if item.method is calibrator.method)
    return bind_calibrated_assessment(
        samples=samples,
        matrix=matrix,
        fitted=fitted,
        calibrator=calibrator,
        comparison=comparison,
        evaluation=evaluation,
        application_fold_ids=matrix.fold_ids[3:4],
        assessment_sample_id=assessment_sample_id,
    )


def _bound_conformal(
    calibrated: BoundCalibratedAssessmentV1,
    *,
    coverage_mode: str,
    interval_available: bool,
    assessment_index: int = 0,
    coverage_on_assessment: bool = False,
) -> tuple[BoundConformalAssessmentV1, BoundCoverageEvidenceV1]:
    samples = calibrated.samples
    plan = calibrated.matrix.plan

    def observation(
        sample: ValidationSampleV1,
        research_slice: ConformalResearchSliceV1,
        *,
        pending: bool = False,
    ) -> IntervalObservationV1:
        score = research_slice.base_score_for(sample.sample_id)
        width = research_slice.base_half_width
        lower = make_ratio(
            score.numerator * width.denominator - width.numerator * score.denominator,
            score.denominator * width.denominator,
        )
        upper = make_ratio(
            score.numerator * width.denominator + width.numerator * score.denominator,
            score.denominator * width.denominator,
        )
        return IntervalObservationV1(
            sample.sample_id,
            sample.cutoff_ns,
            sample.label_end_ns,
            lower,
            upper,
            None if pending else make_ratio(int(cast(bool, sample.binary_outcome)), 1),
            "normal-regime",
            "liquid-cohort",
            sample.label_horizon_ns,
        )

    calibration_fold_id = calibrated.matrix.fold_ids[1]
    evaluation_fold_id = calibrated.matrix.fold_ids[2]
    base_half_width = make_ratio(1, 10)
    calibration_slice = ConformalResearchSliceV1(
        samples,
        plan,
        "transition-binary:v1",
        (calibration_fold_id,),
        calibrated.matrix,
        calibrated.fitted,
        base_half_width,
    )
    evaluation_slice = ConformalResearchSliceV1(
        samples,
        plan,
        "transition-binary:v1",
        (evaluation_fold_id,),
        calibrated.matrix,
        calibrated.fitted,
        base_half_width,
    )
    assessment_slice = ConformalResearchSliceV1(
        samples,
        plan,
        "transition-binary:v1",
        (calibrated.assessment_fold_id,),
        calibrated.matrix,
        calibrated.fitted,
        base_half_width,
    )
    calibration_observations = tuple(
        observation(samples.by_id(sample_id), calibration_slice)
        for sample_id in plan.folds[1].validation_sample_ids
    )
    conformal_spec = ConformalSpecV1(
        make_ratio(1, 5),
        20 if not interval_available or coverage_mode == "unknown" else 6,
    )
    model = fit_conformal(
        calibration_observations,
        conformal_spec,
        research_slice=calibration_slice,
    )
    model_evidence = BoundConformalModelEvidenceV1(
        calibration_observations,
        conformal_spec,
        calibration_slice,
        model,
    )
    assessment_observation = observation(
        samples.by_id(assessment_slice.validation_sample_ids[assessment_index]),
        assessment_slice,
        pending=True,
    )
    interval = apply_conformal(
        model_evidence,
        assessment_observation.lower,
        assessment_observation.upper,
        observation_id=assessment_observation.observation_id,
        prediction_time_ns=assessment_observation.prediction_time_ns,
        research_slice=assessment_slice,
    )
    interval_evidence = BoundConformalAssessmentV1(
        model_evidence,
        assessment_observation,
        assessment_slice,
        interval,
    )
    coverage_slice = assessment_slice if coverage_on_assessment else evaluation_slice
    evaluation_ids = coverage_slice.validation_sample_ids
    evaluation_observations = tuple(
        observation(samples.by_id(sample_id), coverage_slice) for sample_id in evaluation_ids
    )
    evaluation_intervals = tuple(
        apply_conformal(
            model_evidence,
            item.lower,
            item.upper,
            observation_id=item.observation_id,
            prediction_time_ns=item.prediction_time_ns,
            research_slice=coverage_slice,
        )
        for item in evaluation_observations
    )
    coverage = monitor_coverage(
        observations=evaluation_observations,
        intervals=evaluation_intervals,
        min_support=model.min_support,
        minimum_coverage=make_ratio(
            model.alpha.denominator - model.alpha.numerator,
            model.alpha.denominator,
        ),
    )
    return interval_evidence, BoundCoverageEvidenceV1(
        model_evidence,
        evaluation_observations,
        evaluation_intervals,
        coverage_slice,
        coverage,
    )


def _context(
    *,
    quality: QualityState = QualityState.SYNTHETIC,
    disorder: DisorderState = DisorderState.NORMAL,
    specialist_values: tuple[ExactRatioV1, ExactRatioV1] | None = None,
    missing_specialist: bool = False,
    stress: ScenarioOutcomeV1 | None = None,
    calibration_available: bool = True,
    coverage_mode: str = "available",
    interval_available: bool = True,
) -> AbstentionContextV1:
    selected_stress = _stress() if stress is None else stress
    effective_quality = QualityState.GAPPED if disorder is DisorderState.UNKNOWN else quality
    effective_disorder = disorder
    if disposition_from_quality(effective_quality) is not InputDisposition.ELIGIBLE:
        effective_disorder = DisorderState.UNKNOWN
    calibrated = _bound_calibrated(
        quality=effective_quality,
        stress=selected_stress,
        specialist_values=specialist_values,
        collapse_coverage=coverage_mode == "collapsed",
    )
    assessment_samples = calibrated.assessment_samples
    interval_evidence, coverage_evidence = _bound_conformal(
        calibrated,
        coverage_mode=coverage_mode,
        interval_available=interval_available,
    )
    disorder_evidence = _disorder_evidence(effective_disorder, assessment_samples)
    stress_evidence = _stress_evidence(selected_stress, assessment_samples)
    present_ids = _SPECIALIST_IDS[:1] if missing_specialist else _SPECIALIST_IDS
    specialist_probabilities = tuple(
        SpecialistProbabilityV1(
            specialist_id,
            predictions.score_for(calibrated.assessment_sample_id).score,
            calibrated.assessment_sample_id,
            calibrated.matrix.target_id,
            calibrated.matrix.horizon_ns,
            predictions.dataset_digest,
            predictions.digest(),
        )
        for specialist_id in present_ids
        for predictions in (
            calibrated.matrix.bundle(calibrated.assessment_fold_id, specialist_id).predictions,
        )
    )
    bound_calibration = calibrated if calibration_available else None
    uncertainty = decompose_uncertainty(
        disorder_evidence=disorder_evidence,
        specialist_probabilities=specialist_probabilities,
        combined_probability=(
            None if bound_calibration is None else bound_calibration.calibrated_probability
        ),
        interval=interval_evidence.interval,
        stress_evidence=stress_evidence,
    )
    return AbstentionContextV1(
        sample_id=calibrated.assessment_sample_id,
        target_id=calibrated.matrix.target_id,
        horizon_ns=calibrated.matrix.horizon_ns,
        assessment_samples=assessment_samples,
        disorder_evidence=disorder_evidence,
        ensemble_samples=calibrated.samples,
        matrix=calibrated.matrix,
        fitted_stack=calibrated.fitted,
        assessment_fold_id=calibrated.assessment_fold_id,
        present_specialist_ids=present_ids,
        calibrated_evidence=bound_calibration,
        coverage_evidence=coverage_evidence,
        interval_evidence=interval_evidence,
        uncertainty=uncertainty,
        stress_evidence=stress_evidence,
    )


def _context_for_stress(stress: ScenarioOutcomeV1) -> AbstentionContextV1:
    return _context(stress=stress)


def test_static_cqr_model_interval_and_coverage_happy_path() -> None:
    observations, model_evidence, interval, coverage, _ = _conformal()
    model = model_evidence.model
    assert model.status is ConformalStatus.AVAILABLE
    assert model.adjustment is not None
    assert model.calibration_outcome_maturity_ns is not None
    assert model.regime_id == "normal-regime"
    assert model.semantics == "EMPIRICAL_NONEXCHANGEABLE_CHALLENGER"
    assert model.as_mapping()["schema"] == "Q12ConformalModelV1"
    assert interval.status is ConformalStatus.AVAILABLE
    assert interval.lower is not None
    assert interval.upper is not None
    assert coverage.status is CoverageStatus.AVAILABLE
    assert coverage.coverage == make_ratio(1, 1)
    assert coverage.as_mapping()["support"] == len(observations)


def test_conformal_finite_sample_rank_and_support_fail_closed() -> None:
    insufficient_evidence = _conformal(ConformalSpecV1(make_ratio(1, 5), 21))[1]
    insufficient = insufficient_evidence.model
    assert insufficient.status is ConformalStatus.UNKNOWN
    assert insufficient.reason == "INSUFFICIENT_CONFORMAL_SUPPORT"
    _, rank_evidence, _, _, application_slice = _conformal(ConformalSpecV1(make_ratio(1, 100), 8))
    rank_failure = rank_evidence.model
    assert rank_failure.reason == "INSUFFICIENT_FINITE_SAMPLE_RANK"
    assessment = application_slice.samples.by_id("assessment-0001")
    unavailable = apply_conformal(
        rank_evidence,
        make_ratio(1, 4),
        make_ratio(3, 4),
        observation_id=assessment.sample_id,
        prediction_time_ns=assessment.cutoff_ns,
        research_slice=application_slice,
    )
    assert unavailable.reason == "CONFORMAL_MODEL_UNAVAILABLE"


def test_conformal_rejects_crossed_base_and_crossed_adjustment() -> None:
    _, model_evidence, _, _, application_slice = _conformal()
    model = model_evidence.model
    assessment = application_slice.samples.by_id("assessment-0001")
    with pytest.raises(ContractValueError, match="canonical stack source"):
        apply_conformal(
            model_evidence,
            make_ratio(2, 1),
            make_ratio(1, 1),
            observation_id=assessment.sample_id,
            prediction_time_ns=assessment.cutoff_ns,
            research_slice=application_slice,
        )
    with pytest.raises(ContractValueError, match="negative"):
        replace(model, adjustment=make_ratio(-2, 1))


def test_interval_observation_and_conformal_contract_validation() -> None:
    observation = _observations(1)[0]
    assert observation.nonconformity() == make_ratio(1, 4)
    assert observation.as_mapping()["horizonNs"] == "10"
    assert replace(observation, outcome=None).nonconformity() is None
    with pytest.raises(ContractValueError):
        replace(observation, outcome_time_ns=observation.prediction_time_ns)
    with pytest.raises(ContractValueError):
        replace(observation, lower=make_ratio(2, 1), upper=make_ratio(1, 1))
    with pytest.raises(ContractValueError):
        ConformalSpecV1(make_ratio(0, 1), 4)
    with pytest.raises(ContractValueError):
        ConformalModelV1(
            status=ConformalStatus.AVAILABLE,
            reason="BAD",
            alpha=make_ratio(1, 5),
            min_support=4,
            base_half_width=make_ratio(1, 4),
            adjustment=make_ratio(0, 1),
            support=8,
            calibration_digest=ZERO_DIGEST,
            calibration_outcome_maturity_ns=BASE,
            regime_id="normal-regime",
            cohort_id="liquid-cohort",
            horizon_ns=10,
            target_id="transition-binary:v1",
            dataset_digest=ZERO_DIGEST,
            plan_digest=ZERO_DIGEST,
            matrix_digest=ZERO_DIGEST,
            fitted_stack_digest=ZERO_DIGEST,
            fit_fold_ids=("fold-01",),
        )
    with pytest.raises(ContractValueError):
        PredictionIntervalV1(
            observation_id="future-0003",
            prediction_time_ns=BASE,
            regime_id="normal-regime",
            cohort_id="liquid-cohort",
            horizon_ns=10,
            status=ConformalStatus.AVAILABLE,
            reason=None,
            lower=make_ratio(2, 1),
            upper=make_ratio(1, 1),
            model_digest=ZERO_DIGEST,
            target_id="transition-binary:v1",
            dataset_digest=ZERO_DIGEST,
            plan_digest=ZERO_DIGEST,
            source_fold_id="fold-02",
        )


def test_observation_order_and_input_type_failures() -> None:
    observations, research_slice, _, _, application_slice = _research_environment(8)
    with pytest.raises(ContractValueError, match="ordered"):
        fit_conformal(
            (observations[1], observations[0], *observations[2:]),
            ConformalSpecV1(make_ratio(1, 5), 4),
            research_slice=research_slice,
        )
    with pytest.raises(ContractValueError):
        fit_conformal((), ConformalSpecV1(make_ratio(1, 5), 4), research_slice=research_slice)
    with pytest.raises(ContractValueError):
        apply_conformal(
            "bad",  # type: ignore[arg-type]
            make_ratio(0, 1),
            make_ratio(1, 1),
            observation_id="future-0004",
            prediction_time_ns=BASE,
            research_slice=application_slice,
        )


def test_adaptive_conformal_predict_then_update_hit_miss_and_unknown() -> None:
    residuals = tuple(make_ratio(value, 10) for value in (0, 0, 1, 0, 0, 1, 0, 1))
    config = AdaptiveConformalConfigV1(
        target_alpha=make_ratio(1, 5),
        gamma=make_ratio(1, 20),
        min_alpha=make_ratio(1, 20),
        max_alpha=make_ratio(1, 2),
        window_size=8,
        min_support=4,
    )
    calibration, calibration_slice, evaluation, evaluation_slice, _ = _research_environment()
    state = AdaptiveConformalStateV1(
        config,
        make_ratio(1, 5),
        residuals,
        8,
        target_id=calibration_slice.target_id,
        dataset_digest=calibration_slice.samples.digest(),
        plan_digest=calibration_slice.plan.digest(),
        matrix_digest=calibration_slice.matrix.digest(),
        fitted_stack_digest=calibration_slice.fitted_stack.digest(),
        calibration_fold_ids=calibration_slice.fold_ids,
        base_half_width=calibration_slice.base_half_width,
        last_outcome_time_ns=calibration[-1].outcome_time_ns,
        regime_id="normal-regime",
        cohort_id="liquid-cohort",
        horizon_ns=10,
    )
    pending = replace(evaluation[0], outcome=None)
    hit_state = replace(state, residuals=tuple(make_ratio(1, 2) for _ in residuals))
    prediction = adaptive_predict(hit_state, pending, research_slice=evaluation_slice)
    assert prediction.interval.status is ConformalStatus.AVAILABLE
    hit_observation = replace(pending, outcome=make_ratio(0, 1))
    hit = adaptive_update(
        hit_state,
        prediction,
        hit_observation,
        as_of_ns=hit_observation.outcome_time_ns,
        research_slice=evaluation_slice,
    )
    assert hit.alpha == make_ratio(21, 100)
    miss_prediction = adaptive_predict(state, pending, research_slice=evaluation_slice)
    miss_observation = replace(pending, outcome=make_ratio(0, 1))
    miss = adaptive_update(
        state,
        miss_prediction,
        miss_observation,
        as_of_ns=miss_observation.outcome_time_ns,
        research_slice=evaluation_slice,
    )
    assert miss.alpha == make_ratio(4, 25)
    assert len(miss.residuals) == config.window_size
    assert (
        adaptive_update(
            hit_state,
            prediction,
            pending,
            as_of_ns=pending.outcome_time_ns,
            research_slice=evaluation_slice,
        )
        == hit_state
    )
    assert prediction.as_mapping()["stateDigest"] == hit_state.digest().hexdigest


def test_adaptive_unknown_prediction_bootstraps_and_contracts_reject_bad_state() -> None:
    config = AdaptiveConformalConfigV1(
        make_ratio(1, 5),
        make_ratio(1, 20),
        make_ratio(1, 20),
        make_ratio(1, 2),
        8,
        4,
    )
    _, calibration_slice, evaluation, evaluation_slice, _ = _research_environment()
    state = AdaptiveConformalStateV1(
        config,
        make_ratio(1, 5),
        (),
        0,
        target_id=calibration_slice.target_id,
        dataset_digest=calibration_slice.samples.digest(),
        plan_digest=calibration_slice.plan.digest(),
        matrix_digest=calibration_slice.matrix.digest(),
        fitted_stack_digest=calibration_slice.fitted_stack.digest(),
        calibration_fold_ids=calibration_slice.fold_ids,
        base_half_width=calibration_slice.base_half_width,
    )
    pending = replace(evaluation[0], outcome=None)
    prediction = adaptive_predict(state, pending, research_slice=evaluation_slice)
    assert prediction.interval.status is ConformalStatus.UNKNOWN
    matured = replace(pending, outcome=make_ratio(0, 1))
    bootstrapped = adaptive_update(
        state,
        prediction,
        matured,
        as_of_ns=matured.outcome_time_ns,
        research_slice=evaluation_slice,
    )
    assert bootstrapped.alpha == state.alpha
    assert bootstrapped.residuals == (make_ratio(1, 4),)
    assert bootstrapped.update_count == 1
    with pytest.raises(ContractValueError):
        adaptive_update(
            bootstrapped,
            prediction,
            matured,
            as_of_ns=matured.outcome_time_ns,
            research_slice=evaluation_slice,
        )
    with pytest.raises(ContractValueError):
        AdaptiveConformalConfigV1(
            make_ratio(1, 20),
            make_ratio(1, 20),
            make_ratio(1, 20),
            make_ratio(1, 2),
            8,
            4,
        )
    with pytest.raises(ContractValueError):
        AdaptiveConformalStateV1(
            config,
            make_ratio(1, 5),
            tuple(make_ratio(0, 1) for _ in range(9)),
            9,
            target_id=calibration_slice.target_id,
            dataset_digest=calibration_slice.samples.digest(),
            plan_digest=calibration_slice.plan.digest(),
            matrix_digest=calibration_slice.matrix.digest(),
            fitted_stack_digest=calibration_slice.fitted_stack.digest(),
            calibration_fold_ids=calibration_slice.fold_ids,
            base_half_width=calibration_slice.base_half_width,
            last_outcome_time_ns=BASE,
            regime_id="normal-regime",
            cohort_id="liquid-cohort",
            horizon_ns=10,
        )


def test_coverage_monitor_unknown_collapsed_and_identity_failures() -> None:
    observations, model_evidence, _, _, application_slice = _conformal()
    evaluation_slice = ConformalResearchSliceV1(
        application_slice.samples,
        application_slice.plan,
        application_slice.target_id,
        ("fold-03",),
        application_slice.matrix,
        application_slice.fitted_stack,
        application_slice.base_half_width,
    )
    intervals = tuple(
        apply_conformal(
            model_evidence,
            item.lower,
            item.upper,
            observation_id=item.observation_id,
            prediction_time_ns=item.prediction_time_ns,
            research_slice=evaluation_slice,
        )
        for item in observations
    )
    unknown = monitor_coverage(
        observations=tuple(replace(item, outcome=None) for item in observations),
        intervals=intervals,
        min_support=2,
        minimum_coverage=make_ratio(4, 5),
    )
    assert unknown.status is CoverageStatus.UNKNOWN
    assert unknown.reason == "INSUFFICIENT_COVERAGE_SUPPORT"
    narrow = tuple(
        replace(interval, lower=item.lower, upper=item.upper)
        for interval, item in zip(intervals, observations, strict=True)
    )
    collapsed = monitor_coverage(
        observations=observations,
        intervals=narrow,
        min_support=2,
        minimum_coverage=make_ratio(9, 10),
    )
    assert collapsed.status is CoverageStatus.COLLAPSED
    with pytest.raises(ContractValueError, match="align"):
        monitor_coverage(
            observations=observations,
            intervals=intervals[:-1],
            min_support=2,
            minimum_coverage=make_ratio(1, 2),
        )
    with pytest.raises(ContractValueError, match="one regime"):
        monitor_coverage(
            observations=(replace(observations[0], regime_id="other"), *observations[1:]),
            intervals=intervals,
            min_support=2,
            minimum_coverage=make_ratio(1, 2),
        )


def test_uncertainty_vector_decomposes_named_components() -> None:
    vector = _uncertainty()
    assert vector.source_quality is QualityState.SYNTHETIC
    assert vector.ood_state is DisorderState.NORMAL
    assert vector.maximum_pairwise_gap == make_ratio(1, 10)
    assert vector.disagreement_variance_proxy == make_ratio(1, 400)
    assert vector.outcome_dispersion_proxy == make_ratio(99, 400)
    assert vector.conformal_interval_width is not None
    assert vector.cost_fill_state is CostUncertaintyState.POSITIVE
    assert vector.timing_decay_state is TimingUncertaintyState.STABLE
    assert vector.as_mapping()["costFillState"] == "POSITIVE"


@pytest.mark.parametrize(
    ("stress", "cost", "timing"),
    [
        (
            _stress(actionable=0, not_actionable=1),
            CostUncertaintyState.NEGATIVE,
            TimingUncertaintyState.STABLE,
        ),
        (
            _stress(actionable=0, not_actionable=1, flipped=1),
            CostUncertaintyState.NEGATIVE,
            TimingUncertaintyState.UNSTABLE,
        ),
        (
            _stress(actionable=0, abstain=1),
            CostUncertaintyState.UNKNOWN,
            TimingUncertaintyState.UNKNOWN,
        ),
        (_stress(flipped=1), CostUncertaintyState.NEGATIVE, TimingUncertaintyState.UNSTABLE),
    ],
)
def test_uncertainty_adapts_q14_cost_and_timing_states(
    stress: ScenarioOutcomeV1,
    cost: CostUncertaintyState,
    timing: TimingUncertaintyState,
) -> None:
    vector = _uncertainty(stress=stress)
    assert vector.cost_fill_state is cost
    assert vector.timing_decay_state is timing


def test_uncertainty_rejects_duplicate_specialists_and_invalid_public_contract() -> None:
    template = _specialists()[0]
    duplicate = (
        replace(template, specialist_id="same:v1", probability=make_ratio(1, 2)),
        replace(template, specialist_id="same:v1", probability=make_ratio(1, 2)),
    )
    with pytest.raises(ContractValueError, match="unique"):
        _uncertainty(specialists=duplicate)
    vector = _uncertainty()
    one_samples = _assessment_samples(_conformal()[2])
    one = decompose_uncertainty(
        disorder_evidence=_disorder_evidence(DisorderState.NORMAL, one_samples),
        specialist_probabilities=(vector.specialist_probabilities[0],),
        combined_probability=make_ratio(9, 20),
        interval=_conformal()[2],
        stress_evidence=_stress_evidence(_stress(), one_samples),
    )
    assert one.disagreement_variance_proxy is None
    assert one.maximum_pairwise_gap is None
    with pytest.raises(ContractValueError):
        replace(vector, conformal_interval_width=make_ratio(-1, 1))


def test_healthy_evidence_is_watch_only() -> None:
    context = _context()
    decision = decide_advisory(context)
    assert decision.action is AdvisoryAction.WATCH
    assert decision.reasons == ()
    assert decision.calibrated_probability == context.calibrated_probability
    assert cast(dict[str, object], decision.as_mapping()["decision"])["action"] == "WATCH"


@pytest.mark.parametrize(
    ("context", "expected_reason"),
    [
        (
            _context(quality=QualityState.STALE),
            AbstentionReason.EVIDENCE_STALE,
        ),
        (
            _context(quality=QualityState.GAPPED),
            AbstentionReason.EVIDENCE_INCOMPLETE,
        ),
        (
            _context(disorder=DisorderState.OOD_SUSPECT),
            AbstentionReason.OOD_SUSPECT,
        ),
        (
            _context(disorder=DisorderState.UNKNOWN),
            AbstentionReason.OOD_UNKNOWN,
        ),
        (
            _context(missing_specialist=True),
            AbstentionReason.SPECIALIST_MISSING,
        ),
        (
            _context(specialist_values=(make_ratio(0, 1), make_ratio(1, 1))),
            AbstentionReason.SPECIALIST_CONFLICT,
        ),
        (
            _context_for_stress(_stress(actionable=0, abstain=1)),
            AbstentionReason.COST_UNKNOWN,
        ),
        (
            _context_for_stress(_stress(actionable=0, not_actionable=1)),
            AbstentionReason.COST_NEGATIVE,
        ),
        (
            _context_for_stress(_stress(flipped=1)),
            AbstentionReason.COST_STRESS_UNSTABLE,
        ),
        (
            _context_for_stress(_stress(actionable=0, abstain=1)),
            AbstentionReason.TIMING_UNKNOWN,
        ),
        (_context(calibration_available=False), AbstentionReason.CALIBRATION_UNAVAILABLE),
        (
            _context(interval_available=False),
            AbstentionReason.INTERVAL_UNAVAILABLE,
        ),
        (
            _context(coverage_mode="unknown"),
            AbstentionReason.COVERAGE_UNKNOWN,
        ),
        (
            _context(coverage_mode="collapsed"),
            AbstentionReason.COVERAGE_COLLAPSED,
        ),
    ],
)
def test_every_hard_gate_abstains_and_suppresses_outputs(
    context: AbstentionContextV1,
    expected_reason: AbstentionReason,
) -> None:
    decision = decide_advisory(context)
    assert decision.action is AdvisoryAction.ABSTAIN_UNKNOWN
    assert expected_reason in decision.reasons
    assert decision.calibrated_probability is None
    assert decision.interval is None


def test_combined_failures_retain_frozen_reason_precedence() -> None:
    stress = _stress(actionable=0, not_actionable=1, flipped=1)
    context = _context(
        quality=QualityState.STALE,
        disorder=DisorderState.OOD_SUSPECT,
        specialist_values=(make_ratio(0, 1), make_ratio(1, 1)),
        stress=stress,
        calibration_available=False,
        interval_available=False,
    )
    assert decide_advisory(context).reasons == (
        AbstentionReason.EVIDENCE_STALE,
        AbstentionReason.OOD_UNKNOWN,
        AbstentionReason.SPECIALIST_CONFLICT,
        AbstentionReason.COST_NEGATIVE,
        AbstentionReason.COST_STRESS_UNSTABLE,
        AbstentionReason.CALIBRATION_UNAVAILABLE,
        AbstentionReason.INTERVAL_UNAVAILABLE,
        AbstentionReason.COVERAGE_UNKNOWN,
    )


def test_abstention_contracts_reject_incoherent_states() -> None:
    context = _context()
    with pytest.raises(ContractValueError):
        replace(
            context,
            fitted_stack=replace(
                context.fitted_stack,
                weights=(
                    ("specialist-a:v1", make_ratio(1, 2)),
                    ("specialist-c:v1", make_ratio(1, 2)),
                ),
            ),
        )
    bound = decide_advisory(context)
    with pytest.raises(ContractValueError, match="deterministic advisory policy"):
        BoundAssessmentDecisionV1(
            context,
            replace(
                bound.decision,
                action=AdvisoryAction.ABSTAIN_UNKNOWN,
                reasons=(AbstentionReason.OOD_UNKNOWN,),
                calibrated_probability=None,
                interval=None,
            ),
        )
    with pytest.raises(ContractValueError):
        decide_advisory("bad")  # type: ignore[arg-type]


def test_conflict_threshold_equality_abstains() -> None:
    decision = decide_advisory(_context(specialist_values=(make_ratio(1, 3), make_ratio(2, 3))))
    assert AbstentionReason.SPECIALIST_CONFLICT in decision.reasons


def test_abstention_context_rejects_every_cross_evidence_substitution() -> None:
    context = _context()
    assert context.calibrated_evidence is not None
    with pytest.raises(ContractValueError):
        abstention_module._require_probability("bad", field="test")  # type: ignore[arg-type]
    with pytest.raises(ContractValueError):
        abstention_module._require_probability(make_ratio(2, 1), field="test")
    for changes in cast(
        tuple[dict[str, Any], ...],
        (
            {"assessment_samples": object()},
            {
                "assessment_samples": SampleSetV1(
                    "wrong-horizon:v1",
                    EvidencePosture.SYNTHETIC,
                    (
                        replace(
                            context.assessment_samples.samples[0],
                            label_end_ns=context.assessment_samples.samples[0].label_end_ns + 1,
                        ),
                    ),
                )
            },
            {"disorder_evidence": object()},
            {"ensemble_samples": object()},
            {"matrix": object()},
            {"fitted_stack": replace(context.fitted_stack, target_id="other-target:v1")},
            {"assessment_fold_id": "missing-fold"},
            {"present_specialist_ids": tuple(reversed(context.present_specialist_ids))},
            {"present_specialist_ids": ("unexpected-specialist:v1",)},
            {"calibrated_evidence": object()},
            {"coverage_evidence": object()},
            {"interval_evidence": object()},
            {"uncertainty": object()},
            {"stress_evidence": object()},
            {"stress_evidence": replace(context.stress_evidence, target_id="other-target:v1")},
            {
                "stress_evidence": replace(
                    context.stress_evidence,
                    assessment_samples=SampleSetV1(
                        "different-assessment:v1",
                        context.assessment_samples.posture,
                        context.assessment_samples.samples,
                    ),
                )
            },
            {
                "uncertainty": replace(
                    context.uncertainty,
                    specialist_probabilities=tuple(
                        replace(item, source_dataset_digest=DigestV1("a" * 64))
                        for item in context.uncertainty.specialist_probabilities
                    ),
                )
            },
            {
                "uncertainty": replace(
                    context.uncertainty,
                    outcome_dispersion_proxy=make_ratio(1, 10),
                )
            },
            {
                "uncertainty": replace(
                    context.uncertainty,
                    source_quality=QualityState.STALE,
                )
            },
            {
                "uncertainty": replace(
                    context.uncertainty,
                    disorder_evidence_digest=DigestV1("d" * 64),
                )
            },
            {
                "uncertainty": replace(
                    context.uncertainty,
                    maximum_pairwise_gap=make_ratio(0, 1),
                )
            },
            {
                "uncertainty": replace(
                    context.uncertainty,
                    conformal_interval_width=make_ratio(0, 1),
                )
            },
            {
                "uncertainty": replace(
                    context.uncertainty,
                    cost_fill_state=CostUncertaintyState.UNKNOWN,
                )
            },
            {
                "uncertainty": replace(
                    context.uncertainty,
                    timing_decay_state=TimingUncertaintyState.UNKNOWN,
                )
            },
        ),
    ):
        with pytest.raises(ContractValueError):
            replace(context, **changes)

    ood_context = _context(disorder=DisorderState.OOD_SUSPECT)
    with pytest.raises(ContractValueError, match="recomputed Q09"):
        replace(
            ood_context.disorder_evidence,
            assessment=_disorder(DisorderState.NORMAL),
        )
    with pytest.raises(ContractValueError, match=r"known outcomes|monitor_coverage"):
        replace(
            context.coverage_evidence,
            observations=(
                replace(
                    context.coverage_evidence.observations[0],
                    outcome=None,
                ),
                *context.coverage_evidence.observations[1:],
            ),
        )
    with pytest.raises(ContractValueError, match="apply_conformal"):
        replace(
            context.interval_evidence,
            interval=replace(context.interval, lower=make_ratio(1, 10)),
        )
    calibrated = context.calibrated_evidence
    assert calibrated is not None
    with pytest.raises(ContractValueError, match="canonical one-row slice"):
        replace(
            calibrated,
            calibrated_predictions=replace(
                calibrated.calibrated_predictions,
                predictions=(
                    replace(
                        calibrated.calibrated_predictions.predictions[0],
                        score=make_ratio(0, 1),
                    ),
                ),
            ),
        )


def test_assessment_decision_rejects_every_incoherent_action_shape() -> None:
    context = _context()
    interval = context.interval
    decision_type = abstention_module._AssessmentDecisionV1
    with pytest.raises(ContractValueError):
        decision_type("bad", (), None, None)  # type: ignore[arg-type]
    with pytest.raises(ContractValueError):
        decision_type(
            AdvisoryAction.ABSTAIN_UNKNOWN,
            ("bad",),  # type: ignore[arg-type]
            None,
            None,
        )
    with pytest.raises(ContractValueError):
        decision_type(
            AdvisoryAction.ABSTAIN_UNKNOWN,
            (AbstentionReason.OOD_SUSPECT, AbstentionReason.EVIDENCE_STALE),
            None,
            None,
        )
    with pytest.raises(ContractValueError):
        decision_type(
            AdvisoryAction.ABSTAIN_UNKNOWN,
            (AbstentionReason.EVIDENCE_STALE,),
            make_ratio(1, 2),
            None,
        )
    with pytest.raises(ContractValueError):
        decision_type(AdvisoryAction.WATCH, (), None, interval)
    bound = decide_advisory(context)
    with pytest.raises(ContractValueError):
        BoundAssessmentDecisionV1(object(), bound.decision)  # type: ignore[arg-type]
    with pytest.raises(ContractValueError):
        BoundAssessmentDecisionV1(context, object())  # type: ignore[arg-type]


def test_uncertainty_contracts_reject_invalid_owner_and_numeric_states() -> None:
    vector = _uncertainty()
    interval = _conformal()[2]
    with pytest.raises(ContractValueError):
        uncertainty_module._require_probability("bad", field="test")  # type: ignore[arg-type]
    with pytest.raises(ContractValueError):
        uncertainty_module._require_probability(make_ratio(2, 1), field="test")
    for changes in (
        {"source_quality": "bad"},
        {"ood_state": "bad"},
        {"specialist_probabilities": tuple(reversed(vector.specialist_probabilities))},
        {"stress_evidence_digest": "bad"},
        {"cost_fill_state": "bad"},
        {"timing_decay_state": "bad"},
    ):
        with pytest.raises(ContractValueError):
            replace(vector, **changes)
    kwargs: dict[str, Any] = {
        "disorder_evidence": _disorder_evidence(
            DisorderState.NORMAL,
            _assessment_samples(interval),
        ),
        "specialist_probabilities": _specialists(),
        "combined_probability": make_ratio(9, 20),
        "interval": interval,
        "stress_evidence": _stress_evidence(_stress(), _assessment_samples(interval)),
    }
    for changes in cast(
        tuple[dict[str, Any], ...],
        (
            {"disorder_evidence": object()},
            {"stress_evidence": object()},
            {"interval": object()},
            {"combined_probability": make_ratio(2, 1)},
        ),
    ):
        with pytest.raises(ContractValueError):
            decompose_uncertainty(**{**kwargs, **changes})
    evidence = _stress_evidence(_stress(), _assessment_samples(interval))
    with pytest.raises(ContractValueError, match="run_cost_stress"):
        replace(
            evidence,
            report=replace(
                evidence.report,
                outcomes=(ScenarioOutcomeV1("bad", -1, 0, 0, 0, None, None),),
            ),
        )
    unavailable_interval = replace(
        interval,
        status=ConformalStatus.UNKNOWN,
        reason="NO_INTERVAL",
        lower=None,
        upper=None,
    )
    without_width = decompose_uncertainty(**{**kwargs, "interval": unavailable_interval})
    assert without_width.conformal_interval_width is None
    unknown_samples = _assessment_samples(
        interval,
        stress=_stress(actionable=0, abstain=1),
    )
    unknown_cost = decompose_uncertainty(
        **{
            **kwargs,
            "disorder_evidence": _disorder_evidence(
                DisorderState.NORMAL,
                unknown_samples,
            ),
            "stress_evidence": _stress_evidence(
                _stress(actionable=0, abstain=1),
                unknown_samples,
            ),
        }
    )
    assert unknown_cost.cost_fill_state is CostUncertaintyState.UNKNOWN
    assert unknown_cost.timing_decay_state is TimingUncertaintyState.UNKNOWN


def test_conformal_research_slice_rejects_every_provenance_forgery(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calibration, fit_slice, _, evaluation_slice, _ = _research_environment(8)
    plan = fit_slice.plan
    with pytest.raises(ContractValueError, match="samples must"):
        replace(fit_slice, samples=object())  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="valid WalkForward"):
        replace(fit_slice, plan=object())  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="different sample"):
        replace(fit_slice, plan=replace(plan, dataset_digest=ZERO_DIGEST))
    with pytest.raises(ContractValueError, match="non-empty tuple"):
        (replace(fit_slice, fold_ids=[]),)  # type: ignore[arg-type]
    with monkeypatch.context() as scoped:
        scoped.setattr(conformal_module, "MAX_CONFORMAL_FOLDS", 0)
        with pytest.raises(ContractValueError, match="MAX_CONFORMAL_FOLDS"):
            replace(fit_slice, fold_ids=("fold-02",))
    with pytest.raises(ContractValueError, match="sorted and unique"):
        replace(fit_slice, fold_ids=("fold-02", "fold-01"))
    with pytest.raises(ContractValueError, match="valid Q14 folds"):
        replace(fit_slice, fold_ids=("fold-99",))

    first_fold, second_fold, third_fold, fourth_fold = plan.folds
    empty_plan = replace(
        plan,
        folds=(first_fold, replace(second_fold, validation_sample_ids=()), third_fold, fourth_fold),
    )
    with pytest.raises(ContractValueError):
        replace(fit_slice, plan=empty_plan)
    duplicate_plan = replace(
        plan,
        folds=(
            first_fold,
            second_fold,
            replace(third_fold, validation_sample_ids=second_fold.validation_sample_ids),
            fourth_fold,
        ),
    )
    duplicate_matrix = _unsafe_replace(
        fit_slice.matrix,
        plan=duplicate_plan,
        plan_digest=duplicate_plan.digest(),
    )
    with pytest.raises(ContractValueError):
        ConformalResearchSliceV1(
            fit_slice.samples,
            duplicate_plan,
            fit_slice.target_id,
            ("fold-02", "fold-03"),
            duplicate_matrix,
            fit_slice.fitted_stack,
            fit_slice.base_half_width,
        )
    forbidden_plan = replace(plan, holdout_sample_ids=(calibration[0].observation_id,))
    with pytest.raises(ContractValueError, match="holdout/quarantined"):
        replace(fit_slice, plan=forbidden_plan)

    changed_rows = tuple(
        replace(sample, label_end_ns=sample.label_end_ns + 1)
        if sample.sample_id == calibration[0].observation_id
        else sample
        for sample in fit_slice.samples.samples
    )
    mixed_samples = SampleSetV1(
        fit_slice.samples.dataset_id,
        fit_slice.samples.posture,
        changed_rows,
    )
    mixed_plan = replace(plan, dataset_digest=mixed_samples.digest())
    mixed_matrix = _unsafe_replace(
        fit_slice.matrix,
        samples=mixed_samples,
        plan=mixed_plan,
        dataset_digest=mixed_samples.digest(),
        plan_digest=mixed_plan.digest(),
    )
    with pytest.raises(ContractValueError):
        ConformalResearchSliceV1(
            mixed_samples,
            mixed_plan,
            fit_slice.target_id,
            fit_slice.fold_ids,
            mixed_matrix,
            fit_slice.fitted_stack,
            fit_slice.base_half_width,
        )

    with pytest.raises(ContractValueError, match="exactly one"):
        fit_slice.fold_for("not-a-validation-row")
    assert fit_slice.as_mapping()["validationSampleIds"] == list(fit_slice.validation_sample_ids)
    assert isinstance(fit_slice.digest(), DigestV1)
    with pytest.raises(ContractValueError, match="contain IntervalObservation"):
        conformal_module._validate_observation_for_slice(object(), fit_slice)  # type: ignore[arg-type]
    shifted = replace(
        calibration[0],
        prediction_time_ns=calibration[0].prediction_time_ns + 1,
        outcome_time_ns=calibration[0].outcome_time_ns + 1,
    )
    with pytest.raises(ContractValueError, match="bind Q14 sample time"):
        conformal_module._validate_observation_for_slice(shifted, fit_slice)
    assert evaluation_slice.fold_for(evaluation_slice.validation_sample_ids[0]) == "fold-03"


def test_conformal_models_intervals_and_entrypoints_reject_malformed_contracts() -> None:
    calibration, fit_slice, _, evaluation_slice, _ = _research_environment(8)
    spec = ConformalSpecV1(make_ratio(1, 5), 4)
    model = fit_conformal(
        calibration,
        spec,
        research_slice=fit_slice,
    )
    model_evidence = BoundConformalModelEvidenceV1(calibration, spec, fit_slice, model)
    malformed_evidence = _unsafe_replace(model_evidence, model=object())
    with pytest.raises(ContractValueError, match="bound conformal model"):
        conformal_module._validated_model_from_evidence(malformed_evidence)
    interval = _conformal()[2]
    for changes in cast(
        tuple[dict[str, Any], ...],
        (
            {"dataset_digest": object()},
            {"fit_fold_ids": ()},
            {"fit_fold_ids": ("fold-02", "fold-01")},
            {
                "status": ConformalStatus.UNKNOWN,
                "adjustment": None,
                "reason": None,
            },
        ),
    ):
        with pytest.raises(ContractValueError):
            replace(model, **changes)
    with pytest.raises(ContractValueError, match="provenance digests"):
        replace(interval, plan_digest=object())  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="requires a reason"):
        replace(
            interval,
            status=ConformalStatus.UNKNOWN,
            reason=None,
            lower=None,
            upper=None,
        )
    with pytest.raises(ContractValueError, match="research_slice"):
        fit_conformal(
            calibration,
            ConformalSpecV1(make_ratio(1, 5), 4),
            research_slice=object(),  # type: ignore[arg-type]
        )
    assessment = evaluation_slice.samples.by_id(evaluation_slice.validation_sample_ids[0])
    with pytest.raises(ContractValueError, match="research_slice"):
        apply_conformal(
            model_evidence,
            make_ratio(1, 4),
            make_ratio(3, 4),
            observation_id=assessment.sample_id,
            prediction_time_ns=assessment.cutoff_ns,
            research_slice=object(),  # type: ignore[arg-type]
        )
    with pytest.raises(ContractValueError, match="sample cutoff"):
        apply_conformal(
            model_evidence,
            make_ratio(1, 4),
            make_ratio(3, 4),
            observation_id=assessment.sample_id,
            prediction_time_ns=assessment.cutoff_ns + 1,
            research_slice=evaluation_slice,
        )


def test_adaptive_initialization_and_provenance_guards_are_hostile(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calibration, fit_slice, evaluation, evaluation_slice, _ = _research_environment(8)
    spec = ConformalSpecV1(make_ratio(1, 5), 4)
    model = fit_conformal(
        calibration,
        spec,
        research_slice=fit_slice,
    )
    model_evidence = BoundConformalModelEvidenceV1(calibration, spec, fit_slice, model)
    config = AdaptiveConformalConfigV1(
        make_ratio(1, 5),
        make_ratio(1, 20),
        make_ratio(1, 20),
        make_ratio(1, 2),
        8,
        4,
    )
    state = initialize_adaptive_conformal(
        model_evidence=model_evidence,
        config=config,
        observations=calibration,
        research_slice=fit_slice,
    )
    assert state.update_count == len(calibration)
    assert state.as_mapping()["targetId"] == fit_slice.target_id
    for changes in cast(
        tuple[dict[str, Any], ...],
        (
            {"dataset_digest": object()},
            {"calibration_fold_ids": ()},
            {"calibration_fold_ids": ("fold-02", "fold-01")},
        ),
    ):
        with pytest.raises(ContractValueError):
            replace(state, **changes)

    pending = replace(evaluation[0], outcome=None)
    prediction = adaptive_predict(state, pending, research_slice=evaluation_slice)
    with pytest.raises(ContractValueError, match="plus horizon"):
        replace(prediction, outcome_time_ns=prediction.outcome_time_ns + 1)
    with pytest.raises(ContractValueError, match="research_slice"):
        adaptive_predict(state, pending, research_slice=object())  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match=r"provenance|stack source"):
        adaptive_predict(
            state,
            pending,
            research_slice=replace(evaluation_slice, target_id="other-target:v1"),
        )
    with pytest.raises(ContractValueError, match="disjoint"):
        adaptive_predict(
            state,
            replace(calibration[0], outcome=None),
            research_slice=fit_slice,
        )

    with pytest.raises(ContractValueError, match="conformal contracts"):
        initialize_adaptive_conformal(
            model_evidence=object(),  # type: ignore[arg-type]
            config=config,
            observations=calibration,
            research_slice=fit_slice,
        )
    with pytest.raises(ContractValueError, match="conformal contracts"):
        initialize_adaptive_conformal(
            model_evidence=model_evidence,
            config=object(),  # type: ignore[arg-type]
            observations=calibration,
            research_slice=fit_slice,
        )
    with pytest.raises(ContractValueError, match="research_slice"):
        initialize_adaptive_conformal(
            model_evidence=model_evidence,
            config=config,
            observations=calibration,
            research_slice=object(),  # type: ignore[arg-type]
        )
    with pytest.raises(ContractValueError, match="static fit prefix"):
        initialize_adaptive_conformal(
            model_evidence=model_evidence,
            config=config,
            observations=tuple(reversed(calibration)),
            research_slice=fit_slice,
        )
    pending_calibration = (replace(calibration[0], outcome=None), *calibration[1:])
    pending_model = replace(
        model,
        calibration_digest=conformal_module._observations_digest(pending_calibration),
    )
    pending_evidence = _unsafe_replace(
        model_evidence,
        observations=pending_calibration,
        model=pending_model,
    )
    with monkeypatch.context() as scoped:
        scoped.setattr(
            conformal_module,
            "_validated_model_from_evidence",
            lambda evidence: evidence.model,
        )
        with pytest.raises(ContractValueError, match="mature outcomes"):
            initialize_adaptive_conformal(
                model_evidence=pending_evidence,
                config=config,
                observations=pending_calibration,
                research_slice=fit_slice,
            )
    assert isinstance(prediction, AdaptivePredictionV1)


def test_coverage_contract_and_monitor_reject_every_arithmetic_forgery(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    observations, model_evidence, _, report, application_slice = _conformal()
    evaluation_slice = replace(application_slice, fold_ids=("fold-03",))
    intervals = tuple(
        apply_conformal(
            model_evidence,
            observation.lower,
            observation.upper,
            observation_id=observation.observation_id,
            prediction_time_ns=observation.prediction_time_ns,
            research_slice=evaluation_slice,
        )
        for observation in observations
    )
    for changes in cast(
        tuple[dict[str, Any], ...],
        (
            {"observations_digest": object()},
            {"observation_ids": []},
            {"minimum_coverage": make_ratio(0, 1)},
            {"support": report.support + 1},
            {"unknown_outcome_count": 1},
            {"outcome_maturity_ns": None},
            {"status": CoverageStatus.UNKNOWN, "coverage": None, "reason": None},
            {"min_support": report.support + 1},
            {"coverage": make_ratio(4, 5)},
            {"status": CoverageStatus.COLLAPSED},
        ),
    ):
        with pytest.raises(ContractValueError):
            replace(report, **changes)

    with pytest.raises(ContractValueError, match="strictly positive"):
        monitor_coverage(
            observations=observations,
            intervals=intervals,
            min_support=2,
            minimum_coverage=make_ratio(0, 1),
        )
    with monkeypatch.context() as scoped:
        scoped.setattr(conformal_module, "MAX_CONFORMAL_SUPPORT", 1)
        with pytest.raises(ContractValueError, match="exceeds"):
            monitor_coverage(
                observations=observations,
                intervals=intervals,
                min_support=1,
                minimum_coverage=make_ratio(1, 2),
            )
    with pytest.raises(ContractValueError, match="one conformal provenance"):
        monitor_coverage(
            observations=observations,
            intervals=(replace(intervals[0], target_id="other-target:v1"), *intervals[1:]),
            min_support=2,
            minimum_coverage=make_ratio(1, 2),
        )


def test_uncertainty_contracts_reject_every_typed_collection_forgery() -> None:
    vector = _uncertainty()
    interval = _conformal()[2]
    samples = _assessment_samples(interval)
    evidence = _stress_evidence(_stress(), samples)
    with pytest.raises(ContractValueError, match="source digests"):
        replace(vector.specialist_probabilities[0], source_dataset_digest=object())  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="assessment_samples"):
        replace(evidence, assessment_samples=object())  # type: ignore[arg-type]
    second = replace(
        samples.samples[0],
        sample_id="assessment-second:v1",
        group_id="assessment-second-group:v1",
        cutoff_ns=samples.samples[0].cutoff_ns + 20,
        label_end_ns=samples.samples[0].label_end_ns + 20,
    )
    two_samples = SampleSetV1(samples.dataset_id, samples.posture, (*samples.samples, second))
    with pytest.raises(ContractValueError, match="exactly one"):
        replace(evidence, assessment_samples=two_samples)
    with pytest.raises(ContractValueError, match="report must"):
        replace(evidence, report=object())  # type: ignore[arg-type]
    one_specialist = (vector.specialist_probabilities[0],)
    for changes in cast(
        tuple[dict[str, Any], ...],
        (
            {"disorder_evidence_digest": object()},
            {"specialist_probabilities": []},
            {"specialist_probabilities": (object(),)},
            {
                "specialist_probabilities": (
                    replace(vector.specialist_probabilities[0], sample_id="other-sample:v1"),
                ),
            },
            {
                "specialist_probabilities": one_specialist,
                "disagreement_variance_proxy": make_ratio(0, 1),
                "maximum_pairwise_gap": make_ratio(0, 1),
            },
            {"disagreement_variance_proxy": None},
        ),
    ):
        with pytest.raises(ContractValueError):
            replace(vector, **changes)

    kwargs: dict[str, Any] = {
        "disorder_evidence": _disorder_evidence(DisorderState.NORMAL, samples),
        "specialist_probabilities": vector.specialist_probabilities,
        "combined_probability": make_ratio(9, 20),
        "interval": interval,
        "stress_evidence": evidence,
    }
    with pytest.raises(ContractValueError, match="tuple of at most 8"):
        decompose_uncertainty(**{**kwargs, "specialist_probabilities": []})
    with pytest.raises(ContractValueError, match="typed"):
        decompose_uncertainty(**{**kwargs, "specialist_probabilities": (object(),)})
    with pytest.raises(ContractValueError, match="lineage"):
        decompose_uncertainty(
            **{
                **kwargs,
                "specialist_probabilities": (
                    replace(vector.specialist_probabilities[0], target_id="other-target:v1"),
                ),
            }
        )
    impossible_flip = ScenarioOutcomeV1("scenario:v1", 1, 0, 0, 2, FixedPointV1(1), FixedPointV1(1))
    forged = object.__new__(BoundStressEvidenceV1)
    object.__setattr__(forged, "assessment_samples", samples)
    object.__setattr__(forged, "target_id", "transition-binary:v1")
    object.__setattr__(
        forged,
        "report",
        replace(evidence.report, outcomes=(impossible_flip,)),
    )
    with pytest.raises(ContractValueError, match=r"stress report|cannot exceed"):
        decompose_uncertainty(**{**kwargs, "stress_evidence": forged})


def test_abstention_context_and_decision_reject_remaining_boundary_shapes() -> None:
    context = _context()
    row = context.assessment_samples.samples[0]
    second = replace(
        row,
        sample_id="assessment-extra:v1",
        group_id="assessment-extra-group:v1",
        cutoff_ns=row.cutoff_ns + 20,
        label_end_ns=row.label_end_ns + 20,
    )
    two_samples = SampleSetV1(
        context.assessment_samples.dataset_id,
        context.assessment_samples.posture,
        (row, second),
    )
    foreign_calibration = _context(quality=QualityState.STALE).calibrated_evidence
    assert foreign_calibration is not None
    for changes in cast(
        tuple[dict[str, Any], ...],
        (
            {"assessment_samples": two_samples},
            {"disorder_evidence": object()},
            {"ensemble_samples": object()},
            {"matrix": object()},
            {"fitted_stack": object()},
            {"present_specialist_ids": []},
            {"present_specialist_ids": ("specialist-b:v1", "specialist-a:v1")},
            {"calibrated_evidence": foreign_calibration},
            {"coverage_evidence": object()},
            {"interval_evidence": object()},
        ),
    ):
        with pytest.raises(ContractValueError):
            replace(context, **changes)

    foreign_specialists = tuple(
        replace(item, sample_id="other-assessment:v1")
        for item in context.uncertainty.specialist_probabilities
    )
    foreign_uncertainty = replace(
        context.uncertainty,
        sample_id="other-assessment:v1",
        specialist_probabilities=foreign_specialists,
    )
    with pytest.raises(ContractValueError, match="lineage must bind"):
        replace(context, uncertainty=foreign_uncertainty)
    decision_type = abstention_module._AssessmentDecisionV1
    with pytest.raises(ContractValueError, match="interval must"):
        decision_type(
            AdvisoryAction.ABSTAIN_UNKNOWN,
            (AbstentionReason.EVIDENCE_STALE,),
            None,
            object(),  # type: ignore[arg-type]
        )
    unavailable = replace(
        context.interval,
        status=ConformalStatus.UNKNOWN,
        reason="NO_INTERVAL",
        lower=None,
        upper=None,
    )
    with pytest.raises(ContractValueError, match="available interval"):
        decision_type(AdvisoryAction.WATCH, (), make_ratio(1, 2), unavailable)
    assert len(context.digest().hexdigest) == 64


def test_bound_disorder_recomputes_q09_and_rejects_substitution() -> None:
    context = _context(disorder=DisorderState.OOD_SUSPECT)
    evidence = context.disorder_evidence
    assert evidence.assessment.state is DisorderState.OOD_SUSPECT
    assert (
        evidence.as_mapping()["assessmentSamplesDigest"]
        == context.assessment_samples.digest().hexdigest
    )
    assert len(evidence.digest().hexdigest) == 64
    assert evidence.sample_id == context.sample_id
    with pytest.raises(ContractValueError, match="assessment_samples"):
        replace(evidence, assessment_samples=object())  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="config"):
        replace(evidence, config=object())  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="assessment must"):
        replace(evidence, assessment=object())  # type: ignore[arg-type]
    row = context.assessment_samples.samples[0]
    second = replace(
        row,
        sample_id="disorder-second:v1",
        group_id="disorder-second-group:v1",
        cutoff_ns=row.cutoff_ns + 20,
        label_end_ns=row.label_end_ns + 20,
    )
    two_samples = SampleSetV1(
        context.assessment_samples.dataset_id,
        context.assessment_samples.posture,
        (row, second),
    )
    with pytest.raises(ContractValueError, match="exactly one"):
        replace(evidence, assessment_samples=two_samples)
    with pytest.raises(ContractValueError, match="recomputed Q09"):
        replace(evidence, assessment=_disorder(DisorderState.NORMAL))
    foreign_stress = _context(quality=QualityState.STALE).stress_evidence
    with pytest.raises(ContractValueError, match="same assessment"):
        decompose_uncertainty(
            disorder_evidence=evidence,
            specialist_probabilities=context.bound_specialist_probabilities,
            combined_probability=context.calibrated_probability,
            interval=context.interval,
            stress_evidence=foreign_stress,
        )


def test_stress_evidence_aggregates_every_scenario_worst_case() -> None:
    context = _context()
    samples = context.assessment_samples
    zero = make_ratio(0, 1)
    spec = StressSpecV1(
        zero,
        OpportunityDecayV1(zero),
        (
            CostStressScenarioV1("favorable:v1", zero, zero, zero, zero, zero, 0),
            CostStressScenarioV1("negative:v1", make_ratio(1, 100), zero, zero, zero, zero, 0),
        ),
    )
    stress_evidence = BoundStressEvidenceV1(
        samples,
        context.target_id,
        run_cost_stress(samples, spec),
    )
    vector = decompose_uncertainty(
        disorder_evidence=context.disorder_evidence,
        specialist_probabilities=context.bound_specialist_probabilities,
        combined_probability=context.calibrated_probability,
        interval=context.interval,
        stress_evidence=stress_evidence,
    )
    assert vector.cost_fill_state is CostUncertaintyState.NEGATIVE


def test_abstention_remaining_evidence_guards_are_hostile(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    context = _context()
    with pytest.raises(ContractValueError, match="disorder evidence"):
        replace(
            context,
            disorder_evidence=_context(quality=QualityState.STALE).disorder_evidence,
        )

    row = context.assessment_samples.samples[0]
    altered_row = replace(row, symbol="ALTERED")
    altered_ensemble = SampleSetV1(
        context.ensemble_samples.dataset_id,
        context.ensemble_samples.posture,
        tuple(
            altered_row if item.sample_id == context.sample_id else item
            for item in context.ensemble_samples.samples
        ),
    )
    with monkeypatch.context() as scoped:
        original_digest = context.matrix.dataset_digest
        scoped.setattr(SampleSetV1, "digest", lambda _self: original_digest)
        with pytest.raises(ContractValueError, match=r"exact assessment row|exact fold subset"):
            replace(context, ensemble_samples=altered_ensemble)

    foreign_id = (
        context.matrix.bundle(context.matrix.fold_ids[1], context.matrix.specialist_ids[0])
        .predictions.predictions[0]
        .sample_id
    )
    foreign_samples = subset_by_ids(context.ensemble_samples, (foreign_id,))
    foreign_disorder = _disorder_evidence(DisorderState.NORMAL, foreign_samples)
    with pytest.raises(ContractValueError, match="bound ensemble fold"):
        replace(
            context,
            sample_id=foreign_id,
            assessment_samples=foreign_samples,
            disorder_evidence=foreign_disorder,
        )

    bundle = context.matrix.bundle(context.assessment_fold_id, _SPECIALIST_IDS[0])
    late = replace(
        bundle.predictions.score_for(context.sample_id),
        max_feature_asof_ns=row.cutoff_ns + 1,
    )
    late_predictions = replace(
        bundle.predictions,
        predictions=tuple(
            late if item.sample_id == context.sample_id else item
            for item in bundle.predictions.predictions
        ),
    )
    late_bundle = replace(bundle, predictions=late_predictions)
    late_matrix = _unsafe_replace(
        context.matrix,
        bundles=tuple(late_bundle if item == bundle else item for item in context.matrix.bundles),
    )
    late_fitted = replace(context.fitted_stack, matrix_digest=late_matrix.digest())
    with pytest.raises(ContractValueError, match=r"feature after cutoff|feature cannot follow"):
        replace(context, matrix=late_matrix, fitted_stack=late_fitted)

    wrong_horizon_report = _unsafe_replace(
        context.coverage_evidence.report,
        horizon_ns=context.horizon_ns + 1,
    )
    wrong_horizon_coverage = _unsafe_replace(
        context.coverage_evidence,
        report=wrong_horizon_report,
    )
    with pytest.raises(ContractValueError, match=r"coverage horizon|exact bound evidence"):
        replace(context, coverage_evidence=wrong_horizon_coverage)

    wrong_observation_interval = _unsafe_replace(
        context.interval_evidence,
        base_observation=replace(
            context.interval_evidence.base_observation,
            observation_id="other-assessment:v1",
        ),
    )
    with pytest.raises(ContractValueError, match=r"exact assessment sample|unknown sample id"):
        replace(context, interval_evidence=wrong_observation_interval)

    wrong_identity_interval = _unsafe_replace(
        context.interval_evidence,
        interval=replace(context.interval, target_id="other-target:v1"),
    )
    with pytest.raises(ContractValueError, match=r"identity, target|exact bound evidence"):
        replace(context, interval_evidence=wrong_identity_interval)

    foreign_interval = _context(interval_available=False).interval_evidence
    with pytest.raises(ContractValueError, match="same conformal model"):
        replace(context, interval_evidence=foreign_interval)

    wrong_model_report = _unsafe_replace(
        context.coverage_evidence.report,
        model_digest=DigestV1("5" * 64),
    )
    wrong_model_coverage = _unsafe_replace(
        context.coverage_evidence,
        report=wrong_model_report,
    )
    with pytest.raises(ContractValueError, match=r"assessment interval model|exact bound evidence"):
        replace(context, coverage_evidence=wrong_model_coverage)

    late_report = _unsafe_replace(
        context.coverage_evidence.report,
        observation_ids=(
            context.sample_id,
            *context.coverage_evidence.report.observation_ids[1:],
        ),
    )
    late_coverage = _unsafe_replace(context.coverage_evidence, report=late_report)
    with pytest.raises(ContractValueError, match=r"prior and disjoint|exact bound evidence"):
        replace(context, coverage_evidence=late_coverage)


def test_conformal_stack_source_substitution_is_rejected_at_abstention_boundary() -> None:
    context = _context()
    foreign = _context(
        specialist_values=(make_ratio(2, 5), make_ratio(1, 2)),
    )
    assert foreign.ensemble_samples == context.ensemble_samples
    assert foreign.matrix != context.matrix
    assert context.interval_evidence.model == context.interval_evidence.model_evidence.model
    assert context.coverage_evidence.model == context.coverage_evidence.model_evidence.model

    with pytest.raises(ContractValueError, match="ensemble matrix"):
        replace(
            context,
            coverage_evidence=foreign.coverage_evidence,
            interval_evidence=foreign.interval_evidence,
        )

    forged_model_evidence = _unsafe_replace(
        context.coverage_evidence.model_evidence,
        research_slice=foreign.coverage_evidence.model_evidence.research_slice,
    )
    forged_fit_coverage = _unsafe_replace(
        context.coverage_evidence,
        model_evidence=forged_model_evidence,
    )
    forged_fit_assessment = _unsafe_replace(
        context.interval_evidence,
        model_evidence=forged_model_evidence,
    )
    with pytest.raises(ContractValueError, match=r"ensemble matrix|exact bound evidence"):
        replace(
            context,
            coverage_evidence=forged_fit_coverage,
            interval_evidence=forged_fit_assessment,
        )

    forged_coverage_slice = _unsafe_replace(
        context.coverage_evidence,
        research_slice=foreign.coverage_evidence.research_slice,
    )
    with pytest.raises(ContractValueError, match="retain the conformal fit stack"):
        replace(
            context.coverage_evidence,
            research_slice=foreign.coverage_evidence.research_slice,
        )
    with pytest.raises(ContractValueError, match=r"ensemble matrix|conformal fit stack"):
        replace(context, coverage_evidence=forged_coverage_slice)

    forged_assessment_slice = _unsafe_replace(
        context.interval_evidence,
        research_slice=foreign.interval_evidence.research_slice,
    )
    with pytest.raises(ContractValueError, match=r"ensemble matrix|conformal fit stack"):
        replace(context, interval_evidence=forged_assessment_slice)


def test_abstention_requires_its_exact_interval_row_and_prior_coverage() -> None:
    context = _context()
    calibrated = cast(BoundCalibratedAssessmentV1, context.calibrated_evidence)
    other_interval, _ = _bound_conformal(
        calibrated,
        coverage_mode="available",
        interval_available=True,
        assessment_index=1,
    )
    with pytest.raises(ContractValueError, match="exact assessment sample"):
        replace(context, interval_evidence=other_interval)

    _, late_coverage = _bound_conformal(
        calibrated,
        coverage_mode="available",
        interval_available=True,
        coverage_on_assessment=True,
    )
    with pytest.raises(ContractValueError, match="prior and disjoint"):
        replace(context, coverage_evidence=late_coverage)


def test_widened_conformal_bounds_cannot_launder_collapsed_coverage_into_watch() -> None:
    context = _context(coverage_mode="collapsed")
    decision = decide_advisory(context)
    assert decision.action is AdvisoryAction.ABSTAIN_UNKNOWN
    assert AbstentionReason.COVERAGE_COLLAPSED in decision.reasons

    widened_base = replace(
        context.interval_evidence.base_observation,
        lower=make_ratio(-1, 1),
        upper=make_ratio(2, 1),
    )
    widened_assessment = replace(
        context.interval,
        lower=make_ratio(-1, 1),
        upper=make_ratio(2, 1),
    )
    with pytest.raises(ContractValueError, match="canonical stack source"):
        replace(
            context.interval_evidence,
            base_observation=widened_base,
            interval=widened_assessment,
        )

    widened_coverage_intervals = tuple(
        replace(interval, lower=make_ratio(-1, 1), upper=make_ratio(2, 1))
        for interval in context.coverage_evidence.intervals
    )
    forged_available_report = replace(
        context.coverage_evidence.report,
        status=CoverageStatus.AVAILABLE,
        coverage=make_ratio(1, 1),
        covered_count=context.coverage_evidence.report.support,
        missed_count=0,
    )
    with pytest.raises(ContractValueError, match="exact bound evidence"):
        replace(
            context.coverage_evidence,
            intervals=widened_coverage_intervals,
            report=forged_available_report,
        )


@pytest.mark.parametrize(
    "report_changes",
    [
        {"status": CoverageStatus.COLLAPSED},
        {"covered_count": 0, "missed_count": 0},
    ],
)
def test_decide_rejects_unsafe_forged_coverage_status_and_counts(
    report_changes: dict[str, object],
) -> None:
    context = _context()
    assert decide_advisory(context).action is AdvisoryAction.WATCH
    forged_report = _unsafe_replace(context.coverage_evidence.report, **report_changes)
    forged_coverage = _unsafe_replace(context.coverage_evidence, report=forged_report)
    forged_context = _unsafe_replace(context, coverage_evidence=forged_coverage)

    with pytest.raises(ContractValueError):
        decide_advisory(forged_context)


def test_decide_rejects_unsafe_forged_disorder_and_stress_evidence() -> None:
    context = _context()
    forged_disorder = _unsafe_replace(
        context.disorder_evidence,
        assessment=_disorder(DisorderState.OOD_SUSPECT),
    )
    with pytest.raises(ContractValueError):
        decide_advisory(_unsafe_replace(context, disorder_evidence=forged_disorder))

    forged_stress_report = _unsafe_replace(
        context.stress_evidence.report,
        base_actionable_count=context.stress_evidence.report.base_actionable_count + 1,
    )
    forged_stress = _unsafe_replace(
        context.stress_evidence,
        report=forged_stress_report,
    )
    with pytest.raises(ContractValueError):
        decide_advisory(_unsafe_replace(context, stress_evidence=forged_stress))


@pytest.mark.parametrize(
    "changes",
    [
        {"assessment_samples": object()},
        {"coverage_evidence": object()},
        {"disorder_evidence": object()},
        {"stress_evidence": object()},
    ],
)
def test_decide_revalidates_an_unsafe_context_before_evaluating(
    changes: dict[str, object],
) -> None:
    with pytest.raises(ContractValueError):
        decide_advisory(_unsafe_replace(_context(), **changes))


def test_internal_decision_guards_and_unreachable_assertion(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    context = _context()
    decision_type = abstention_module._AssessmentDecisionV1
    with pytest.raises(ContractValueError, match="at least one reason"):
        decision_type(AdvisoryAction.ABSTAIN_UNKNOWN, (), None, None)
    with pytest.raises(ContractValueError, match="WATCH carries no"):
        decision_type(
            AdvisoryAction.WATCH,
            (AbstentionReason.EVIDENCE_STALE,),
            context.calibrated_probability,
            context.interval,
        )
    with monkeypatch.context() as scoped:
        scoped.setattr(
            AbstentionContextV1,
            "calibrated_probability",
            property(lambda _self: None),
        )
        with pytest.raises(AssertionError, match="calibrated evidence"):
            abstention_module._evaluate_advisory(context)
