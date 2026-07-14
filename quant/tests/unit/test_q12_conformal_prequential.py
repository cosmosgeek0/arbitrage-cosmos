from __future__ import annotations

from dataclasses import dataclass, replace
from functools import cache
from typing import Any, cast

import pytest

import quant_edge.ensemble.conformal as conformal_module
from quant_edge.ensemble import (
    AdaptiveConformalConfigV1,
    AdaptiveConformalStateV1,
    BoundConformalAssessmentV1,
    BoundConformalModelEvidenceV1,
    BoundCoverageEvidenceV1,
    ConformalModelV1,
    ConformalResearchSliceV1,
    ConformalSpecV1,
    ConformalStatus,
    CoverageStatus,
    FittedStackV1,
    IntervalObservationV1,
    OofFoldPredictionBundleV1,
    PredictionIntervalV1,
    StackingSpecV1,
    ValidatedOofMatrixV1,
    adaptive_predict,
    adaptive_update,
    apply_conformal,
    fit_conformal,
    fit_oof_stacker,
    initialize_adaptive_conformal,
    monitor_coverage,
    validate_oof_bundles,
)
from quant_edge.errors import ContractValueError
from quant_edge.labels.rational import ExactRatioV1, make_ratio
from quant_edge.lake.contracts import DigestV1, EvidencePosture, QualityState
from quant_edge.models.contracts import ProbabilitySemantics
from quant_edge.validation import (
    PlanStatus,
    PredictionSetV1,
    PredictionV1,
    SampleSetV1,
    SplitScheme,
    ValidationSampleV1,
    WalkForwardPlanV1,
    WalkForwardSpecV1,
    build_walk_forward_plan,
    subset_by_ids,
)

BASE = 1_700_000_000_000_000_000
TARGET_ID = "q12-prequential-target"


@dataclass(frozen=True, slots=True)
class _ResearchEnvironment:
    samples: SampleSetV1
    plan: WalkForwardPlanV1
    matrix: ValidatedOofMatrixV1
    fitted_stack: FittedStackV1
    calibration_slice: ConformalResearchSliceV1
    application_slice: ConformalResearchSliceV1


@cache
def _research_environment(unknown_target: bool = False) -> _ResearchEnvironment:
    sample_ids = (
        *(f"warmup-{index:04d}" for index in range(8)),
        *(f"meta-{index:04d}" for index in range(8)),
        *(f"calibration-{index:04d}" for index in range(8)),
        *(f"target-{index:04d}" for index in range(8)),
    )
    samples = SampleSetV1(
        dataset_id="q12-prequential-synthetic",
        posture=EvidencePosture.SYNTHETIC,
        samples=tuple(
            ValidationSampleV1(
                sample_id=sample_id,
                symbol="BTCUSDT",
                group_id=f"event-{index:04d}",
                cutoff_ns=BASE + index * 100,
                label_end_ns=BASE + index * 100 + 10,
                strata=(("cohort", "liquid-cohort"), ("regime", "normal-regime")),
                binary_outcome=(
                    None if unknown_target and sample_id == "target-0000" else bool(index % 2)
                ),
                gross_edge_ratio=None,
                base_cost_ratio=None,
                quality=QualityState.SYNTHETIC,
            )
            for index, sample_id in enumerate(sample_ids)
        ),
    )
    plan = build_walk_forward_plan(
        samples,
        WalkForwardSpecV1(
            scheme=SplitScheme.EXPANDING,
            fold_count=3,
            max_label_horizon_ns=10,
            max_feature_lookback_ns=0,
            embargo_ns=10,
            min_train_size=4,
            holdout_fraction=make_ratio(0, 1),
            rolling_train_size=None,
        ),
    )
    assert plan.status is PlanStatus.VALID
    assert plan.folds[0].validation_sample_ids == tuple(f"meta-{index:04d}" for index in range(8))
    assert plan.folds[1].validation_sample_ids == tuple(
        f"calibration-{index:04d}" for index in range(8)
    )
    assert plan.folds[2].validation_sample_ids == tuple(f"target-{index:04d}" for index in range(8))
    specialist_ids = ("alpha-specialist", "beta-specialist")
    bundles = tuple(
        OofFoldPredictionBundleV1(
            specialist_id=specialist_id,
            target_id=TARGET_ID,
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
                            0
                            if sample_id in {"target-0001", "target-0003"}
                            else int(int(sample_id[-4:]) % 2)
                            if specialist_id == "alpha-specialist"
                            else int(not int(sample_id[-4:]) % 2),
                            1,
                        ),
                        max_feature_asof_ns=samples.by_id(sample_id).cutoff_ns,
                    )
                    for sample_id in sorted(fold.validation_sample_ids)
                ),
            ),
        )
        for fold in plan.folds
        for specialist_id in specialist_ids
    )
    matrix = validate_oof_bundles(
        samples=samples,
        plan=plan,
        target_id=TARGET_ID,
        horizon_ns=10,
        specialist_ids=specialist_ids,
        bundles=bundles,
    )
    fitted_stack = fit_oof_stacker(
        samples=samples,
        matrix=matrix,
        spec=StackingSpecV1(
            meta_train_fold_ids=(plan.folds[0].fold_id,),
            calibration_fold_ids=(plan.folds[1].fold_id,),
            weight_divisions=4,
        ),
        stack_id="q12-prequential-stack",
    )
    return _ResearchEnvironment(
        samples=samples,
        plan=plan,
        matrix=matrix,
        fitted_stack=fitted_stack,
        calibration_slice=ConformalResearchSliceV1(
            samples=samples,
            plan=plan,
            target_id=TARGET_ID,
            fold_ids=(plan.folds[1].fold_id,),
            matrix=matrix,
            fitted_stack=fitted_stack,
            base_half_width=make_ratio(1, 5),
        ),
        application_slice=ConformalResearchSliceV1(
            samples=samples,
            plan=plan,
            target_id=TARGET_ID,
            fold_ids=(plan.folds[2].fold_id,),
            matrix=matrix,
            fitted_stack=fitted_stack,
            base_half_width=make_ratio(1, 5),
        ),
    )


def _observation(
    sample_id: str,
    *,
    outcome: ExactRatioV1 | None,
) -> IntervalObservationV1:
    environment = _research_environment()
    sample = environment.samples.by_id(sample_id)
    research_slice = (
        environment.calibration_slice
        if sample_id.startswith("calibration-")
        else environment.application_slice
    )
    score = research_slice.base_score_for(sample_id)
    half_width = research_slice.base_half_width
    return IntervalObservationV1(
        observation_id=sample.sample_id,
        prediction_time_ns=sample.cutoff_ns,
        outcome_time_ns=sample.label_end_ns,
        lower=make_ratio(
            score.numerator * half_width.denominator - half_width.numerator * score.denominator,
            score.denominator * half_width.denominator,
        ),
        upper=make_ratio(
            score.numerator * half_width.denominator + half_width.numerator * score.denominator,
            score.denominator * half_width.denominator,
        ),
        outcome=outcome,
        regime_id="normal-regime",
        cohort_id="liquid-cohort",
        horizon_ns=sample.label_horizon_ns,
    )


def _calibration(count: int = 8) -> tuple[IntervalObservationV1, ...]:
    return tuple(
        _observation(
            f"calibration-{index:04d}",
            outcome=make_ratio(index % 2, 1),
        )
        for index in range(count)
    )


def _model() -> ConformalModelV1:
    environment = _research_environment()
    return fit_conformal(
        _calibration(),
        ConformalSpecV1(make_ratio(1, 5), 4),
        research_slice=environment.calibration_slice,
    )


def _model_evidence() -> BoundConformalModelEvidenceV1:
    environment = _research_environment()
    return BoundConformalModelEvidenceV1(
        _calibration(),
        ConformalSpecV1(make_ratio(1, 5), 4),
        environment.calibration_slice,
        _model(),
    )


def _unsafe_model_evidence(model: ConformalModelV1) -> BoundConformalModelEvidenceV1:
    evidence = object.__new__(BoundConformalModelEvidenceV1)
    object.__setattr__(evidence, "observations", _calibration())
    object.__setattr__(evidence, "spec", ConformalSpecV1(make_ratio(1, 5), 4))
    object.__setattr__(evidence, "research_slice", _research_environment().calibration_slice)
    object.__setattr__(evidence, "model", model)
    return evidence


def _target(index: int = 0, *, outcome: ExactRatioV1 | None = None) -> IntervalObservationV1:
    return _observation(f"target-{index:04d}", outcome=outcome)


def _apply(observation: IntervalObservationV1) -> PredictionIntervalV1:
    environment = _research_environment()
    return apply_conformal(
        _model_evidence(),
        observation.lower,
        observation.upper,
        observation_id=observation.observation_id,
        prediction_time_ns=observation.prediction_time_ns,
        research_slice=environment.application_slice,
    )


def _empty_state() -> AdaptiveConformalStateV1:
    model = _model()
    return AdaptiveConformalStateV1(
        config=_config(),
        alpha=make_ratio(1, 5),
        residuals=(),
        update_count=0,
        target_id=model.target_id,
        dataset_digest=model.dataset_digest,
        plan_digest=model.plan_digest,
        matrix_digest=model.matrix_digest,
        fitted_stack_digest=model.fitted_stack_digest,
        calibration_fold_ids=model.fit_fold_ids,
        base_half_width=model.base_half_width,
    )


def _initialized_state() -> AdaptiveConformalStateV1:
    environment = _research_environment()
    return initialize_adaptive_conformal(
        model_evidence=_model_evidence(),
        config=_config(),
        observations=_calibration(),
        research_slice=environment.calibration_slice,
    )


def _config() -> AdaptiveConformalConfigV1:
    return AdaptiveConformalConfigV1(
        target_alpha=make_ratio(1, 5),
        gamma=make_ratio(1, 20),
        min_alpha=make_ratio(1, 20),
        max_alpha=make_ratio(1, 2),
        window_size=8,
        min_support=4,
    )


def test_static_model_persists_maturity_context_and_binds_future_interval() -> None:
    model = _model()
    maturity = model.calibration_outcome_maturity_ns
    assert model.status is ConformalStatus.AVAILABLE
    assert model.min_support == 4
    assert model.as_mapping()["minSupport"] == 4
    assert model.as_mapping()["baseHalfWidth"] == make_ratio(1, 5).as_mapping()
    assert maturity == _calibration()[-1].outcome_time_ns
    assert (model.regime_id, model.cohort_id, model.horizon_ns) == (
        "normal-regime",
        "liquid-cohort",
        10,
    )
    target = _target()
    interval = _apply(target)
    assert interval.status is ConformalStatus.AVAILABLE
    assert interval.observation_id == target.observation_id
    assert interval.prediction_time_ns == target.prediction_time_ns
    assert interval.as_mapping()["regimeId"] == "normal-regime"

    environment = _research_environment()
    premature = conformal_module._apply_conformal_model(
        replace(model, calibration_outcome_maturity_ns=target.prediction_time_ns),
        target.lower,
        target.upper,
        observation_id=target.observation_id,
        prediction_time_ns=target.prediction_time_ns,
        research_slice=environment.application_slice,
    )
    assert premature.status is ConformalStatus.UNKNOWN
    assert premature.reason == "CALIBRATION_OUTCOME_NOT_MATURE"


def test_research_slice_rejects_unbound_stack_sources_and_half_width() -> None:
    environment = _research_environment()
    assert environment.application_slice.as_mapping()["matrixDigest"] == (
        environment.matrix.digest().hexdigest
    )
    for changes in cast(
        tuple[dict[str, Any], ...],
        (
            {"matrix": object()},
            {"fitted_stack": object()},
            {"base_half_width": make_ratio(0, 1)},
            {
                "matrix": _research_environment(True).matrix,
                "fitted_stack": _research_environment(True).fitted_stack,
            },
        ),
    ):
        with pytest.raises(ContractValueError):
            replace(environment.application_slice, **changes)


def test_static_fit_rejects_duplicate_identity_and_mixed_context() -> None:
    environment = _research_environment()
    observations = _calibration()
    with pytest.raises(ContractValueError, match="exact research-slice rows"):
        fit_conformal(
            (
                *(observations[index] for index in range(2, len(observations))),
                observations[0],
                replace(observations[1], observation_id=observations[0].observation_id),
            ),
            ConformalSpecV1(make_ratio(1, 5), 2),
            research_slice=environment.calibration_slice,
        )
    with pytest.raises(ContractValueError, match="one regime"):
        fit_conformal(
            (
                observations[0],
                replace(observations[1], regime_id="other-regime"),
                *observations[2:],
            ),
            ConformalSpecV1(make_ratio(1, 5), 2),
            research_slice=environment.calibration_slice,
        )


def test_conformal_slice_allows_pending_labels_but_mature_operations_require_truth() -> None:
    environment = _research_environment()
    unknown_environment = _research_environment(True)
    unknown_calibration = _calibration()
    unknown_model = fit_conformal(
        unknown_calibration,
        ConformalSpecV1(make_ratio(1, 5), 4),
        research_slice=unknown_environment.calibration_slice,
    )
    unknown_evidence = BoundConformalModelEvidenceV1(
        unknown_calibration,
        ConformalSpecV1(make_ratio(1, 5), 4),
        unknown_environment.calibration_slice,
        unknown_model,
    )
    unknown_state = initialize_adaptive_conformal(
        model_evidence=unknown_evidence,
        config=_config(),
        observations=unknown_calibration,
        research_slice=unknown_environment.calibration_slice,
    )
    pending = _target()
    prediction = adaptive_predict(
        unknown_state,
        pending,
        research_slice=unknown_environment.application_slice,
    )
    assert prediction.observation_id == pending.observation_id
    with pytest.raises(ContractValueError, match="known Q14 binary outcome"):
        adaptive_update(
            unknown_state,
            prediction,
            replace(pending, outcome=make_ratio(0, 1)),
            as_of_ns=pending.outcome_time_ns,
            research_slice=unknown_environment.application_slice,
        )

    observations = _calibration()
    with pytest.raises(ContractValueError, match="exact Q14 binary outcome"):
        fit_conformal(
            (replace(observations[0], outcome=make_ratio(1, 1)), *observations[1:]),
            ConformalSpecV1(make_ratio(1, 5), 4),
            research_slice=environment.calibration_slice,
        )

    state = _empty_state()
    pending = _target()
    prediction = adaptive_predict(
        state,
        pending,
        research_slice=environment.application_slice,
    )
    with pytest.raises(ContractValueError, match="exact Q14 binary outcome"):
        adaptive_update(
            state,
            prediction,
            replace(pending, outcome=make_ratio(1, 1)),
            as_of_ns=pending.outcome_time_ns,
            research_slice=environment.application_slice,
        )


def test_bound_static_interval_and_coverage_evidence_recompute_exactly() -> None:
    environment = _research_environment()
    model = _model()
    model_evidence = BoundConformalModelEvidenceV1(
        _calibration(),
        ConformalSpecV1(make_ratio(1, 5), 4),
        environment.calibration_slice,
        model,
    )
    assert model_evidence.as_mapping()["schema"] == "Q12BoundConformalModelEvidenceV1"
    assert isinstance(model_evidence.digest(), DigestV1)
    for changes in cast(
        tuple[dict[str, Any], ...],
        (
            {"spec": object()},
            {"research_slice": object()},
            {"model": object()},
            {"model": replace(model, adjustment=make_ratio(1, 1))},
        ),
    ):
        with pytest.raises(ContractValueError):
            replace(model_evidence, **changes)
    pending = _target()
    interval = _apply(pending)
    assessment = BoundConformalAssessmentV1(
        model_evidence,
        pending,
        environment.application_slice,
        interval,
    )
    assert assessment.as_mapping()["schema"] == "Q12BoundConformalAssessmentV1"
    assert isinstance(assessment.digest(), DigestV1)
    assert assessment.model == model
    for changes in cast(
        tuple[dict[str, Any], ...],
        (
            {"model_evidence": object()},
            {"base_observation": object()},
            {"research_slice": object()},
            {"interval": object()},
            {"base_observation": replace(pending, outcome=make_ratio(0, 1))},
            {"interval": replace(interval, lower=make_ratio(-1, 1))},
        ),
    ):
        with pytest.raises(ContractValueError):
            replace(assessment, **changes)
    with pytest.raises(ContractValueError, match="observation context"):
        replace(assessment, base_observation=replace(pending, regime_id="other-regime"))
    with pytest.raises(ContractValueError, match="retain the conformal fit stack source"):
        replace(
            assessment,
            research_slice=replace(
                environment.application_slice,
                base_half_width=make_ratio(1, 4),
            ),
        )

    observations = tuple(_target(index, outcome=make_ratio(index % 2, 1)) for index in range(8))
    intervals = tuple(_apply(observation) for observation in observations)
    report = monitor_coverage(
        observations=observations,
        intervals=intervals,
        min_support=model.min_support,
        minimum_coverage=make_ratio(4, 5),
    )
    coverage_evidence = BoundCoverageEvidenceV1(
        model_evidence,
        observations,
        intervals,
        environment.application_slice,
        report,
    )
    assert coverage_evidence.as_mapping()["schema"] == "Q12BoundCoverageEvidenceV1"
    assert isinstance(coverage_evidence.digest(), DigestV1)
    assert coverage_evidence.model == model
    subset_observations = observations[: model.min_support]
    subset_intervals = intervals[: model.min_support]
    subset_report = monitor_coverage(
        observations=subset_observations,
        intervals=subset_intervals,
        min_support=model.min_support,
        minimum_coverage=make_ratio(4, 5),
    )
    with pytest.raises(ContractValueError, match="exactly cover every"):
        BoundCoverageEvidenceV1(
            model_evidence,
            subset_observations,
            subset_intervals,
            environment.application_slice,
            subset_report,
        )
    forged_report = replace(
        report,
        status=CoverageStatus.AVAILABLE,
        coverage=make_ratio(1, 1),
        covered_count=8,
        missed_count=0,
    )
    for changes in cast(
        tuple[dict[str, Any], ...],
        (
            {"model_evidence": object()},
            {"research_slice": object()},
            {
                "research_slice": replace(
                    environment.application_slice,
                    base_half_width=make_ratio(1, 4),
                )
            },
            {"report": object()},
            {"observations": []},
            {"intervals": (object(),)},
            {
                "report": replace(
                    report,
                    status=CoverageStatus.AVAILABLE,
                    minimum_coverage=make_ratio(1, 2),
                )
            },
            {"report": replace(report, min_support=1)},
            {"report": forged_report},
            {
                "intervals": (
                    replace(intervals[0], model_digest=DigestV1("e" * 64)),
                    *intervals[1:],
                )
            },
            {
                "intervals": (
                    replace(intervals[0], lower=make_ratio(-1, 1)),
                    *intervals[1:],
                )
            },
            {
                "observations": (
                    replace(observations[0], outcome=make_ratio(1, 1)),
                    *observations[1:],
                )
            },
            {
                "observations": (
                    replace(observations[0], outcome=None),
                    *observations[1:],
                )
            },
        ),
    ):
        with pytest.raises(ContractValueError):
            replace(coverage_evidence, **changes)


def test_coverage_cannot_widen_canonical_stack_bounds_to_flip_gate() -> None:
    environment = _research_environment()
    model_evidence = _model_evidence()
    model = model_evidence.model
    observations = tuple(_target(index, outcome=make_ratio(index % 2, 1)) for index in range(8))
    intervals = tuple(_apply(observation) for observation in observations)
    report = monitor_coverage(
        observations=observations,
        intervals=intervals,
        min_support=model.min_support,
        minimum_coverage=make_ratio(4, 5),
    )
    assert report.status is CoverageStatus.COLLAPSED
    assert report.coverage == make_ratio(3, 4)

    widened_observations = tuple(
        replace(observation, lower=make_ratio(0, 1), upper=make_ratio(1, 1))
        for observation in observations
    )
    widened_intervals = tuple(
        replace(interval, lower=make_ratio(0, 1), upper=make_ratio(1, 1)) for interval in intervals
    )
    widened_report = monitor_coverage(
        observations=widened_observations,
        intervals=widened_intervals,
        min_support=model.min_support,
        minimum_coverage=make_ratio(4, 5),
    )
    assert widened_report.status is CoverageStatus.AVAILABLE
    assert widened_report.coverage == make_ratio(1, 1)
    with pytest.raises(ContractValueError, match="canonical stack source"):
        BoundCoverageEvidenceV1(
            model_evidence,
            widened_observations,
            widened_intervals,
            environment.application_slice,
            widened_report,
        )


def test_static_contracts_reject_fabricated_maturity_and_negative_adjustment() -> None:
    model = _model()
    with pytest.raises(ContractValueError, match="outcome maturity"):
        replace(model, calibration_outcome_maturity_ns=None)
    with pytest.raises(ContractValueError, match="negative"):
        replace(model, adjustment=make_ratio(-1, 1))
    with pytest.raises(ContractValueError, match="min_support"):
        replace(model, min_support=1)
    with pytest.raises(ContractValueError, match="frozen"):
        replace(model, semantics="EXCHANGEABLE")
    with pytest.raises(ContractValueError, match="observation_id"):
        apply_conformal(
            _model_evidence(),
            _target().lower,
            _target().upper,
            observation_id="",
            prediction_time_ns=BASE,
            research_slice=_research_environment().application_slice,
        )


def test_static_unknown_outcomes_are_rejected_and_unavailable_model_fails_closed() -> None:
    environment = _research_environment()
    observations = tuple(replace(item, outcome=None) for item in _calibration())
    with pytest.raises(ContractValueError, match="every outcome"):
        fit_conformal(
            observations,
            ConformalSpecV1(make_ratio(1, 5), 2),
            research_slice=environment.calibration_slice,
        )
    spec = ConformalSpecV1(make_ratio(1, 5), 20)
    model = fit_conformal(
        _calibration(),
        spec,
        research_slice=environment.calibration_slice,
    )
    model_evidence = BoundConformalModelEvidenceV1(
        _calibration(),
        spec,
        environment.calibration_slice,
        model,
    )
    target = _target()
    interval = apply_conformal(
        model_evidence,
        target.lower,
        target.upper,
        observation_id=target.observation_id,
        prediction_time_ns=target.prediction_time_ns,
        research_slice=environment.application_slice,
    )
    assert interval.reason == "CONFORMAL_MODEL_UNAVAILABLE"


def test_static_entrypoints_reject_bad_types_and_noncanonical_base() -> None:
    environment = _research_environment()
    model_evidence = _model_evidence()
    target = _target()
    with pytest.raises(ContractValueError, match="model"):
        apply_conformal(
            "bad",  # type: ignore[arg-type]
            target.lower,
            target.upper,
            observation_id=target.observation_id,
            prediction_time_ns=target.prediction_time_ns,
            research_slice=environment.application_slice,
        )
    with pytest.raises(ContractValueError, match="model_evidence"):
        apply_conformal(
            _model(),  # type: ignore[arg-type]
            target.lower,
            target.upper,
            observation_id=target.observation_id,
            prediction_time_ns=target.prediction_time_ns,
            research_slice=environment.application_slice,
        )
    with pytest.raises(ContractValueError, match="model must"):
        conformal_module._apply_conformal_model(
            object(),  # type: ignore[arg-type]
            target.lower,
            target.upper,
            observation_id=target.observation_id,
            prediction_time_ns=target.prediction_time_ns,
            research_slice=environment.application_slice,
        )
    with pytest.raises(ContractValueError, match="bounds"):
        apply_conformal(
            model_evidence,
            "bad",  # type: ignore[arg-type]
            target.upper,
            observation_id=target.observation_id,
            prediction_time_ns=target.prediction_time_ns,
            research_slice=environment.application_slice,
        )
    with pytest.raises(ContractValueError, match="canonical stack source"):
        apply_conformal(
            model_evidence,
            make_ratio(0, 1),
            make_ratio(1, 1),
            observation_id=target.observation_id,
            prediction_time_ns=target.prediction_time_ns,
            research_slice=environment.application_slice,
        )


def test_public_model_consumers_recompute_unsafe_bound_evidence() -> None:
    environment = _research_environment()
    target = _target()
    forged_model = replace(_model(), adjustment=make_ratio(1, 1))
    forged_evidence = _unsafe_model_evidence(forged_model)
    with pytest.raises(ContractValueError, match="exact bound evidence"):
        apply_conformal(
            forged_evidence,
            target.lower,
            target.upper,
            observation_id=target.observation_id,
            prediction_time_ns=target.prediction_time_ns,
            research_slice=environment.application_slice,
        )
    with pytest.raises(ContractValueError, match="exact bound evidence"):
        initialize_adaptive_conformal(
            model_evidence=forged_evidence,
            config=_config(),
            observations=_calibration(),
            research_slice=environment.calibration_slice,
        )
    incomplete = object.__new__(BoundConformalModelEvidenceV1)
    with pytest.raises(ContractValueError, match="complete bound evidence"):
        apply_conformal(
            incomplete,
            target.lower,
            target.upper,
            observation_id=target.observation_id,
            prediction_time_ns=target.prediction_time_ns,
            research_slice=environment.application_slice,
        )
    wrong_model = _unsafe_model_evidence(_model())
    object.__setattr__(wrong_model, "model", object())
    with pytest.raises(ContractValueError, match="ConformalModelV1"):
        apply_conformal(
            wrong_model,
            target.lower,
            target.upper,
            observation_id=target.observation_id,
            prediction_time_ns=target.prediction_time_ns,
            research_slice=environment.application_slice,
        )


def test_application_rejects_substituted_matrix_or_fitted_stack_source() -> None:
    environment = _research_environment()
    target = _target()
    target_fold = environment.application_slice.fold_ids[0]
    altered_bundles = tuple(
        replace(
            bundle,
            predictions=replace(
                bundle.predictions,
                predictions=tuple(
                    replace(prediction, score=make_ratio(1, 1))
                    if prediction.sample_id == target.observation_id
                    else prediction
                    for prediction in bundle.predictions.predictions
                ),
            ),
        )
        if bundle.fold_id == target_fold and bundle.specialist_id == "alpha-specialist"
        else bundle
        for bundle in environment.matrix.bundles
    )
    altered_matrix = validate_oof_bundles(
        samples=environment.samples,
        plan=environment.plan,
        target_id=TARGET_ID,
        horizon_ns=10,
        specialist_ids=environment.matrix.specialist_ids,
        bundles=altered_bundles,
    )
    spec = StackingSpecV1(
        meta_train_fold_ids=environment.fitted_stack.meta_train_fold_ids,
        calibration_fold_ids=environment.fitted_stack.calibration_fold_ids,
        weight_divisions=environment.fitted_stack.weight_divisions,
    )
    altered_fitted = fit_oof_stacker(
        samples=environment.samples,
        matrix=altered_matrix,
        spec=spec,
        stack_id=environment.fitted_stack.stack_id,
    )
    altered_matrix_slice = replace(
        environment.application_slice,
        matrix=altered_matrix,
        fitted_stack=altered_fitted,
    )
    with pytest.raises(ContractValueError, match="provenance"):
        apply_conformal(
            _model_evidence(),
            target.lower,
            target.upper,
            observation_id=target.observation_id,
            prediction_time_ns=target.prediction_time_ns,
            research_slice=altered_matrix_slice,
        )

    alternate_fitted = fit_oof_stacker(
        samples=environment.samples,
        matrix=environment.matrix,
        spec=spec,
        stack_id="q12-prequential-alternate-stack",
    )
    altered_fitted_slice = replace(
        environment.application_slice,
        fitted_stack=alternate_fitted,
    )
    with pytest.raises(ContractValueError, match="provenance"):
        apply_conformal(
            _model_evidence(),
            target.lower,
            target.upper,
            observation_id=target.observation_id,
            prediction_time_ns=target.prediction_time_ns,
            research_slice=altered_fitted_slice,
        )


def test_static_application_rejects_overlap_reversed_and_forged_provenance() -> None:
    environment = _research_environment()
    model = _model()
    model_evidence = _model_evidence()
    target = _target()
    with pytest.raises(ContractValueError, match="provenance"):
        apply_conformal(
            model_evidence,
            target.lower,
            target.upper,
            observation_id=target.observation_id,
            prediction_time_ns=target.prediction_time_ns,
            research_slice=replace(environment.application_slice, base_half_width=make_ratio(1, 4)),
        )
    with pytest.raises(ContractValueError, match="disjoint"):
        apply_conformal(
            model_evidence,
            _calibration()[0].lower,
            _calibration()[0].upper,
            observation_id=_calibration()[0].observation_id,
            prediction_time_ns=_calibration()[0].prediction_time_ns,
            research_slice=environment.calibration_slice,
        )
    reverse_model = replace(model, fit_fold_ids=environment.application_slice.fold_ids)
    with pytest.raises(ContractValueError, match="strictly later"):
        conformal_module._apply_conformal_model(
            reverse_model,
            _calibration()[0].lower,
            _calibration()[0].upper,
            observation_id=_calibration()[0].observation_id,
            prediction_time_ns=_calibration()[0].prediction_time_ns,
            research_slice=environment.calibration_slice,
        )


def test_prediction_interval_contract_rejects_invalid_lineage_and_bounds() -> None:
    interval = _apply(_target())
    with pytest.raises(ContractValueError):
        replace(interval, prediction_time_ns=-1)
    with pytest.raises(ContractValueError, match="lower"):
        replace(interval, lower="bad")  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="cross"):
        replace(interval, lower=make_ratio(2, 1), upper=make_ratio(1, 1))
    with pytest.raises(ContractValueError, match="availability"):
        replace(interval, lower=None)


def test_coverage_counts_unavailable_emissions_in_denominator() -> None:
    observations = tuple(_target(index, outcome=make_ratio(index % 2, 1)) for index in range(3))
    intervals = tuple(_apply(item) for item in observations)
    unavailable = replace(
        intervals[-1],
        status=ConformalStatus.UNKNOWN,
        reason="CONFORMAL_MODEL_UNAVAILABLE",
        lower=None,
        upper=None,
    )
    report = monitor_coverage(
        observations=observations,
        intervals=(*intervals[:-1], unavailable),
        min_support=3,
        minimum_coverage=make_ratio(3, 4),
    )
    assert report.support == 3
    assert report.coverage is None
    assert report.covered_count == 1
    assert report.missed_count == 1
    assert report.unavailable_count == 1
    assert report.status is CoverageStatus.UNKNOWN
    assert report.reason == "UNAVAILABLE_INTERVAL_IN_COVERAGE"


def test_coverage_rejects_mixed_model_and_lineage_mismatch() -> None:
    observations = tuple(_target(index, outcome=make_ratio(index % 2, 1)) for index in range(2))
    intervals = tuple(_apply(item) for item in observations)
    with pytest.raises(ContractValueError, match="one conformal model"):
        monitor_coverage(
            observations=observations,
            intervals=(intervals[0], replace(intervals[1], model_digest=DigestV1("f" * 64))),
            min_support=1,
            minimum_coverage=make_ratio(1, 2),
        )


def test_coverage_rejects_bad_collections_context_and_duplicate_identity() -> None:
    observations = tuple(_target(index, outcome=make_ratio(index % 2, 1)) for index in range(2))
    intervals = tuple(_apply(item) for item in observations)
    with pytest.raises(ContractValueError, match="tuples"):
        monitor_coverage(
            observations=list(observations),  # type: ignore[arg-type]
            intervals=intervals,
            min_support=1,
            minimum_coverage=make_ratio(1, 2),
        )
    with pytest.raises(ContractValueError, match="contain IntervalObservation"):
        monitor_coverage(
            observations=(observations[0], "bad"),  # type: ignore[arg-type]
            intervals=intervals,
            min_support=1,
            minimum_coverage=make_ratio(1, 2),
        )
    with pytest.raises(ContractValueError, match="one regime"):
        monitor_coverage(
            observations=(observations[0], replace(observations[1], cohort_id="other-cohort")),
            intervals=intervals,
            min_support=1,
            minimum_coverage=make_ratio(1, 2),
        )
    duplicate = replace(
        observations[1],
        observation_id=observations[0].observation_id,
        prediction_time_ns=observations[0].prediction_time_ns,
        outcome_time_ns=observations[0].outcome_time_ns,
    )
    with pytest.raises(ContractValueError, match="unique"):
        monitor_coverage(
            observations=(observations[0], duplicate),
            intervals=(
                intervals[0],
                replace(intervals[1], observation_id=duplicate.observation_id),
            ),
            min_support=1,
            minimum_coverage=make_ratio(1, 2),
        )


def test_coverage_unknown_outcomes_report_unknown_without_dropping_emissions() -> None:
    observations = tuple(_target(index) for index in range(2))
    intervals = tuple(_apply(item) for item in observations)
    report = monitor_coverage(
        observations=observations,
        intervals=intervals,
        min_support=1,
        minimum_coverage=make_ratio(1, 2),
    )
    assert report.status is CoverageStatus.UNKNOWN
    assert report.support == 0
    assert report.as_mapping()["reason"] == "INSUFFICIENT_COVERAGE_SUPPORT"
    with pytest.raises(ContractValueError, match="identity/time"):
        monitor_coverage(
            observations=observations,
            intervals=(intervals[0], replace(intervals[1], observation_id="wrong-target")),
            min_support=1,
            minimum_coverage=make_ratio(1, 2),
        )
    with pytest.raises(ContractValueError, match="contain PredictionInterval"):
        monitor_coverage(
            observations=observations,
            intervals=(intervals[0], "bad"),  # type: ignore[arg-type]
            min_support=1,
            minimum_coverage=make_ratio(1, 2),
        )


def test_adaptive_bootstraps_residual_when_interval_unavailable() -> None:
    environment = _research_environment()
    state = _empty_state()
    pending = _target()
    prediction = adaptive_predict(
        state,
        pending,
        research_slice=environment.application_slice,
    )
    assert prediction.interval.status is ConformalStatus.UNKNOWN
    matured = replace(pending, outcome=make_ratio(0, 1))
    updated = adaptive_update(
        state,
        prediction,
        matured,
        as_of_ns=matured.outcome_time_ns,
        research_slice=environment.application_slice,
    )
    assert updated.alpha == state.alpha
    assert updated.residuals == (make_ratio(0, 1),)
    assert updated.last_outcome_time_ns == matured.outcome_time_ns
    assert updated.regime_id == matured.regime_id


def test_adaptive_update_rejects_future_outcome_and_mismatched_observation() -> None:
    environment = _research_environment()
    state = _empty_state()
    pending = _target()
    prediction = adaptive_predict(
        state,
        pending,
        research_slice=environment.application_slice,
    )
    matured = replace(pending, outcome=make_ratio(0, 1))
    with pytest.raises(ContractValueError, match="outcome maturity"):
        adaptive_update(
            state,
            prediction,
            matured,
            as_of_ns=matured.outcome_time_ns - 1,
            research_slice=environment.application_slice,
        )
    with pytest.raises(ContractValueError, match=r"unknown sample|match"):
        adaptive_update(
            state,
            prediction,
            replace(matured, observation_id="different-target"),
            as_of_ns=matured.outcome_time_ns,
            research_slice=environment.application_slice,
        )
    with pytest.raises(ContractValueError, match="research_slice"):
        adaptive_update(
            state,
            prediction,
            matured,
            as_of_ns=matured.outcome_time_ns,
            research_slice=object(),  # type: ignore[arg-type]
        )
    other_matured = _target(1, outcome=make_ratio(1, 1))
    with pytest.raises(ContractValueError, match="match adaptive prediction"):
        adaptive_update(
            state,
            prediction,
            other_matured,
            as_of_ns=other_matured.outcome_time_ns,
            research_slice=environment.application_slice,
        )


def test_adaptive_updates_alpha_only_for_available_interval() -> None:
    environment = _research_environment()
    state = _initialized_state()
    pending = _target()
    prediction = adaptive_predict(
        state,
        pending,
        research_slice=environment.application_slice,
    )
    assert prediction.interval.status is ConformalStatus.AVAILABLE
    hit = adaptive_update(
        state,
        prediction,
        replace(pending, outcome=make_ratio(0, 1)),
        as_of_ns=pending.outcome_time_ns,
        research_slice=environment.application_slice,
    )
    miss_pending = _target(1)
    miss_prediction = adaptive_predict(
        state,
        miss_pending,
        research_slice=environment.application_slice,
    )
    miss = adaptive_update(
        state,
        miss_prediction,
        replace(miss_pending, outcome=make_ratio(1, 1)),
        as_of_ns=miss_pending.outcome_time_ns,
        research_slice=environment.application_slice,
    )
    assert hit.alpha == make_ratio(21, 100)
    assert hit.residuals[-1] == make_ratio(0, 1)
    assert miss.alpha == make_ratio(4, 25)
    assert miss.residuals[-1] == make_ratio(4, 5)


def test_adaptive_prediction_is_prequential_and_context_bound() -> None:
    environment = _research_environment()
    state = _initialized_state()
    with pytest.raises(ContractValueError, match="outcome-free"):
        adaptive_predict(
            state,
            replace(_target(), outcome=make_ratio(0, 1)),
            research_slice=environment.application_slice,
        )
    with pytest.raises(ContractValueError, match="prior outcome maturity"):
        adaptive_predict(
            replace(state, last_outcome_time_ns=_target().prediction_time_ns),
            _target(),
            research_slice=environment.application_slice,
        )
    with pytest.raises(ContractValueError, match="preserve regime"):
        adaptive_predict(
            state,
            replace(_target(), regime_id="other-regime"),
            research_slice=environment.application_slice,
        )


def test_adaptive_unknown_outcome_freezes_and_contracts_reject_false_history() -> None:
    environment = _research_environment()
    state = _empty_state()
    pending = _target()
    prediction = adaptive_predict(
        state,
        pending,
        research_slice=environment.application_slice,
    )
    assert (
        adaptive_update(
            state,
            prediction,
            pending,
            as_of_ns=pending.outcome_time_ns,
            research_slice=environment.application_slice,
        )
        == state
    )
    with pytest.raises(ContractValueError, match="negative"):
        replace(
            state,
            residuals=(make_ratio(-1, 1),),
            update_count=1,
            last_outcome_time_ns=BASE,
            regime_id="normal-regime",
            cohort_id="liquid-cohort",
            horizon_ns=10,
        )
    with pytest.raises(ContractValueError, match="bounded update history"):
        replace(
            state,
            residuals=(make_ratio(0, 1),),
            update_count=2,
            last_outcome_time_ns=BASE,
            regime_id="normal-regime",
            cohort_id="liquid-cohort",
            horizon_ns=10,
        )


def test_adaptive_entrypoints_and_prediction_contract_reject_bad_types() -> None:
    environment = _research_environment()
    state = _empty_state()
    pending = _target()
    prediction = adaptive_predict(
        state,
        pending,
        research_slice=environment.application_slice,
    )
    assert prediction.as_mapping()["observationId"] == pending.observation_id
    with pytest.raises(ContractValueError, match="state"):
        adaptive_predict(
            "bad",  # type: ignore[arg-type]
            pending,
            research_slice=environment.application_slice,
        )
    with pytest.raises(ContractValueError, match="observation"):
        adaptive_predict(
            state,
            "bad",  # type: ignore[arg-type]
            research_slice=environment.application_slice,
        )
    with pytest.raises(ContractValueError, match="current state"):
        adaptive_update(
            replace(state, alpha=make_ratio(1, 4)),
            prediction,
            pending,
            as_of_ns=pending.outcome_time_ns,
            research_slice=environment.application_slice,
        )
    with pytest.raises(ContractValueError, match="state"):
        adaptive_update(
            "bad",  # type: ignore[arg-type]
            prediction,
            pending,
            as_of_ns=pending.outcome_time_ns,
            research_slice=environment.application_slice,
        )
    with pytest.raises(ContractValueError, match="state_digest"):
        replace(prediction, state_digest="bad")  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="base bounds"):
        replace(prediction, base_lower="bad")  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="base interval"):
        replace(prediction, base_lower=make_ratio(2, 1), base_upper=make_ratio(1, 1))
    with pytest.raises(ContractValueError, match="interval must"):
        replace(prediction, interval="bad")  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="observation"):
        adaptive_update(
            state,
            prediction,
            "bad",  # type: ignore[arg-type]
            as_of_ns=pending.outcome_time_ns,
            research_slice=environment.application_slice,
        )
    with pytest.raises(ContractValueError, match="identity"):
        replace(prediction, interval=replace(prediction.interval, observation_id="other-target"))
    with pytest.raises(ContractValueError, match="requires outcome maturity"):
        replace(state, residuals=(make_ratio(0, 1),), update_count=1)
    with pytest.raises(ContractValueError, match="empty adaptive history"):
        replace(
            state,
            last_outcome_time_ns=BASE,
            regime_id="normal-regime",
            cohort_id="liquid-cohort",
            horizon_ns=10,
        )
    with pytest.raises(ContractValueError, match="entirely known"):
        replace(state, regime_id="normal-regime")


def test_adaptive_prediction_binds_stack_source_and_half_width() -> None:
    environment = _research_environment()
    pending = _target()
    for state in (
        replace(_empty_state(), matrix_digest=DigestV1("d" * 64)),
        replace(_empty_state(), fitted_stack_digest=DigestV1("e" * 64)),
        replace(_empty_state(), base_half_width=make_ratio(1, 4)),
    ):
        with pytest.raises(ContractValueError, match="provenance"):
            adaptive_predict(
                state,
                pending,
                research_slice=environment.application_slice,
            )


def test_remaining_static_conformal_contract_branches_fail_closed() -> None:
    environment = _research_environment()
    observation = _calibration(1)[0]
    model = _model()
    interval = _apply(_target())
    with pytest.raises(ContractValueError):
        conformal_module._require_unit_ratio("bad", field="test", open_interval=True)  # type: ignore[arg-type]
    with pytest.raises(ContractValueError):
        replace(observation, lower="bad")  # type: ignore[arg-type]
    with pytest.raises(ContractValueError):
        replace(observation, outcome="bad")  # type: ignore[arg-type]
    assert ConformalSpecV1(make_ratio(1, 5), 2).as_mapping()["minSupport"] == 2
    for changes in cast(
        tuple[dict[str, Any], ...],
        (
            {"status": "bad"},
            {"calibration_digest": "bad"},
            {"adjustment": "bad"},
        ),
    ):
        with pytest.raises(ContractValueError):
            replace(model, **changes)
    with pytest.raises(ContractValueError, match="exceeds"):
        fit_conformal(
            (observation,) * (conformal_module.MAX_CONFORMAL_SUPPORT + 1),
            ConformalSpecV1(make_ratio(1, 5), 2),
            research_slice=environment.calibration_slice,
        )
    with pytest.raises(ContractValueError):
        fit_conformal(
            (observation,),
            "bad",  # type: ignore[arg-type]
            research_slice=environment.calibration_slice,
        )
    with pytest.raises(ContractValueError, match="contain"):
        fit_conformal(
            ("bad",),  # type: ignore[arg-type]
            ConformalSpecV1(make_ratio(1, 5), 2),
            research_slice=environment.calibration_slice,
        )
    for changes in cast(
        tuple[dict[str, Any], ...],
        (
            {"status": "bad"},
            {"model_digest": "bad"},
            {"upper": "bad"},
        ),
    ):
        with pytest.raises(ContractValueError):
            replace(interval, **changes)


def test_remaining_adaptive_and_coverage_contract_branches_fail_closed() -> None:
    state = _empty_state()
    with pytest.raises(ContractValueError):
        replace(state, config="bad")  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="outside"):
        replace(state, alpha=make_ratio(9, 10))
    with pytest.raises(ContractValueError, match="contain"):
        replace(
            state,
            residuals=("bad",),  # type: ignore[arg-type]
            update_count=1,
            last_outcome_time_ns=BASE,
            regime_id="normal-regime",
            cohort_id="liquid-cohort",
            horizon_ns=10,
        )
    report = monitor_coverage(
        observations=(_target(outcome=make_ratio(0, 1)),),
        intervals=(_apply(_target(outcome=make_ratio(0, 1))),),
        min_support=1,
        minimum_coverage=make_ratio(1, 2),
    )
    for changes in cast(
        tuple[dict[str, Any], ...],
        (
            {"model_digest": "bad"},
            {"status": "bad"},
            {"coverage": None},
        ),
    ):
        with pytest.raises(ContractValueError):
            replace(report, **changes)


def test_adaptive_update_rejects_forged_state_bound_interval() -> None:
    environment = _research_environment()
    state = _empty_state()
    pending = _target()
    prediction = adaptive_predict(
        state,
        pending,
        research_slice=environment.application_slice,
    )
    forged_interval = replace(
        prediction.interval,
        model_digest=DigestV1("e" * 64),
    )
    forged_prediction = replace(prediction, interval=forged_interval)
    matured = replace(pending, outcome=make_ratio(0, 1))
    with pytest.raises(ContractValueError, match="deterministic state prediction"):
        adaptive_update(
            state,
            forged_prediction,
            matured,
            as_of_ns=matured.outcome_time_ns,
            research_slice=environment.application_slice,
        )
