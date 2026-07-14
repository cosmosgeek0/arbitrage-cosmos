"""Deterministic Q12 ensemble/calibration/abstention campaign.

Usage: ``python scripts/q12_ensemble_campaign.py OUTPUT_ROOT``

Writes byte-deterministic SYNTHETIC_ONLY evidence. Host wall time is printed to stdout
only and never enters an artifact. No market, network, environment, secret, registry,
capital, risk or order authority is accessed.
"""

from __future__ import annotations

import hashlib
import sys
import time
from dataclasses import replace
from pathlib import Path
from typing import cast

from quant_edge.canonical import canonical_json_bytes
from quant_edge.ensemble import (
    AbstentionContextV1,
    AdaptiveConformalConfigV1,
    BoundCalibratedAssessmentV1,
    BoundClosureLeakageEvidenceV1,
    BoundClosureStressEvidenceV1,
    BoundConformalAssessmentV1,
    BoundConformalModelEvidenceV1,
    BoundCoverageEvidenceV1,
    BoundDisorderEvidenceV1,
    BoundStressEvidenceV1,
    CalibrationSpecV1,
    ConformalResearchSliceV1,
    ConformalSpecV1,
    FittedStackV1,
    IntervalObservationV1,
    OofFoldPredictionBundleV1,
    SpecialistProbabilityV1,
    StackingSpecV1,
    ValidatedOofMatrixV1,
    ValidationClosureEvidenceV1,
    adaptive_predict,
    adaptive_update,
    apply_conformal,
    bind_calibrated_assessment,
    close_q10_waiting_q14,
    compare_calibrators,
    decide_advisory,
    decompose_uncertainty,
    fit_conformal,
    fit_oof_stacker,
    initialize_adaptive_conformal,
    monitor_coverage,
    stack_predictions_for_folds,
    validate_oof_bundles,
)
from quant_edge.features.fixedpoint import FixedPointV1
from quant_edge.labels.rational import ExactRatioV1, make_ratio
from quant_edge.lake.contracts import EvidencePosture, QualityState
from quant_edge.models.battery import SECTION_14_BATTERY_DISPOSITIONS
from quant_edge.models.contracts import ProbabilitySemantics
from quant_edge.regime.anomaly import (
    DisorderConfigV1,
    fuse_disorder,
)
from quant_edge.validation import (
    BootstrapSpecV1,
    CostStressReportV1,
    CostStressScenarioV1,
    DsrInputsV1,
    HoldoutGrantV1,
    LeakageSpecV1,
    LeakageVerdict,
    MetricKind,
    OpportunityDecayV1,
    PredictionSetV1,
    PredictionV1,
    PrimaryMetricSpecV1,
    SampleSetV1,
    StressSpecV1,
    TrialLedgerV1,
    TrialRecordV1,
    TrialStatus,
    ValidationSampleV1,
    WalkForwardPlanV1,
    WalkForwardSpecV1,
    assess_leakage,
    block_bootstrap_interval,
    build_walk_forward_plan,
    deflated_sharpe_ratio,
    falsify_lineage,
    future_leaked_predictions,
    open_holdout,
    pbo_cscv,
    run_cost_stress,
    subset_by_ids,
)
from quant_edge.validation.splits import SplitScheme

CAMPAIGN_SEED = 20_260_712
BASE_TIME_NS = 1_700_000_000_000_000_000
Q14_ACCEPTANCE = "e266b42913fb721cc2a8470a08774be3fdf1ce0c"
Q14_DIRECTOR_MERGE = "f756f3b582f24857811e6ec4c0d08a3a61026b74"


def _build_samples() -> SampleSetV1:
    samples: list[ValidationSampleV1] = []
    for index in range(96):
        latent = (index * 37 + 17) % 101
        samples.append(
            ValidationSampleV1(
                sample_id=f"sample-{index:04d}",
                symbol=f"SYNTH-{index % 8:02d}",
                group_id=f"event-{index:04d}",
                cutoff_ns=BASE_TIME_NS + index * 100,
                label_end_ns=BASE_TIME_NS + index * 100 + 10,
                strata=(
                    ("liquidity", f"bucket-{index % 2}"),
                    ("regime", f"regime-{index % 3}"),
                    ("stage", "synthetic-transition"),
                ),
                binary_outcome=latent >= 50,
                gross_edge_ratio=make_ratio(3, 1_000),
                # These two plan-bound rows are reserved for independent fail-closed
                # assessment cases. They remain ordinary OOF rows for model fitting;
                # no cost or quality field is consumed by the stack/calibrator.
                base_cost_ratio=(None if index == 78 else make_ratio(1, 1_000)),
                quality=(QualityState.STALE if index == 79 else QualityState.SYNTHETIC),
            )
        )
    return SampleSetV1(
        dataset_id="q12-synthetic-ensemble:v1",
        posture=EvidencePosture.SYNTHETIC,
        samples=tuple(samples),
    )


def _specialist_score(specialist_id: str, sample_id: str) -> ExactRatioV1:
    index = int(sample_id.rsplit("-", maxsplit=1)[1])
    if index == 76:
        return make_ratio(0 if specialist_id == "specialist-linear:v1" else 1, 1)
    latent = (index * 37 + 17) % 101
    if specialist_id == "specialist-linear:v1":
        numerator = 180 + latent * 6 + (((index * 13) % 9) - 4) * 80
    else:
        numerator = 220 + latent * 5 + (((index * 17) % 11) - 5) * 70
    numerator = min(max(numerator, 0), 1_000)
    return make_ratio(numerator, 1_000)


def _build_oof_bundles(
    samples: SampleSetV1,
    plan: WalkForwardPlanV1,
    specialist_ids: tuple[str, ...],
) -> tuple[OofFoldPredictionBundleV1, ...]:
    bundles: list[OofFoldPredictionBundleV1] = []
    for fold in plan.folds:
        subset = subset_by_ids(samples, fold.validation_sample_ids)
        for specialist_id in specialist_ids:
            predictions = tuple(
                PredictionV1(
                    sample_id=sample.sample_id,
                    score=_specialist_score(specialist_id, sample.sample_id),
                    max_feature_asof_ns=sample.cutoff_ns,
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
                        model_id=specialist_id,
                        dataset_digest=subset.digest(),
                        predictions=predictions,
                    ),
                )
            )
    return tuple(bundles)


def _interval_observation(
    sample: ValidationSampleV1,
    base_score: ExactRatioV1,
    *,
    outcome_known: bool,
) -> IntervalObservationV1:
    """Build one deterministic interval row bound to exact Q14 sample lineage."""

    if sample.binary_outcome is None:
        raise RuntimeError("conformal campaign requires bound Q14 binary outcomes")
    return IntervalObservationV1(
        observation_id=sample.sample_id,
        prediction_time_ns=sample.cutoff_ns,
        outcome_time_ns=sample.label_end_ns,
        lower=make_ratio(
            base_score.numerator * 5 - base_score.denominator,
            base_score.denominator * 5,
        ),
        upper=make_ratio(
            base_score.numerator * 5 + base_score.denominator,
            base_score.denominator * 5,
        ),
        outcome=(make_ratio(int(sample.binary_outcome), 1) if outcome_known else None),
        regime_id="synthetic-normal",
        cohort_id="synthetic-liquid",
        horizon_ns=sample.label_horizon_ns,
    )


def _interval_observations(
    samples: SampleSetV1,
    sample_ids: tuple[str, ...],
    predictions: PredictionSetV1,
) -> tuple[IntervalObservationV1, ...]:
    return tuple(
        _interval_observation(
            samples.by_id(sample_id),
            predictions.score_for(sample_id).score,
            outcome_known=True,
        )
        for sample_id in sample_ids
    )


def _scenario(
    scenario_id: str,
    *,
    fee_delta: ExactRatioV1,
    latency_ns: int = 0,
) -> CostStressScenarioV1:
    zero = make_ratio(0, 1)
    return CostStressScenarioV1(
        scenario_id=scenario_id,
        fee_delta=fee_delta,
        slippage_delta=zero,
        funding_delta=zero,
        borrow_delta=zero,
        recovery_delta=zero,
        latency_ns=latency_ns,
    )


def _stress_report(
    samples: SampleSetV1,
    *,
    scenario_id: str,
    fee_delta: ExactRatioV1,
    latency_ns: int = 0,
) -> CostStressReportV1:
    decay = OpportunityDecayV1(decay_ratio_per_second=make_ratio(1, 1_000))
    return run_cost_stress(
        samples,
        StressSpecV1(
            act_threshold=make_ratio(0, 1),
            decay=decay,
            scenarios=(
                _scenario(
                    scenario_id,
                    fee_delta=fee_delta,
                    latency_ns=latency_ns,
                ),
            ),
        ),
    )


def _decision(
    *,
    sample_id: str,
    target_id: str,
    horizon_ns: int,
    assessment_samples: SampleSetV1,
    disorder_evidence: BoundDisorderEvidenceV1,
    ensemble_samples: SampleSetV1,
    matrix: ValidatedOofMatrixV1,
    fitted_stack: FittedStackV1,
    assessment_fold_id: str,
    present_specialist_ids: tuple[str, ...],
    calibrated_evidence: BoundCalibratedAssessmentV1,
    coverage_evidence: BoundCoverageEvidenceV1,
    interval_evidence: BoundConformalAssessmentV1,
    stress_report: CostStressReportV1,
) -> dict[str, dict[str, object]]:
    stress_evidence = BoundStressEvidenceV1(
        assessment_samples=assessment_samples,
        target_id=target_id,
        report=stress_report,
    )
    specialists = tuple(
        SpecialistProbabilityV1(
            specialist_id=specialist_id,
            probability=predictions.score_for(sample_id).score,
            sample_id=sample_id,
            target_id=target_id,
            horizon_ns=horizon_ns,
            source_dataset_digest=predictions.dataset_digest,
            source_prediction_digest=predictions.digest(),
        )
        for specialist_id in present_specialist_ids
        for predictions in (matrix.bundle(assessment_fold_id, specialist_id).predictions,)
    )
    uncertainty = decompose_uncertainty(
        disorder_evidence=disorder_evidence,
        specialist_probabilities=specialists,
        combined_probability=calibrated_evidence.calibrated_probability,
        interval=interval_evidence.interval,
        stress_evidence=stress_evidence,
    )
    decision = decide_advisory(
        AbstentionContextV1(
            sample_id=sample_id,
            target_id=target_id,
            horizon_ns=horizon_ns,
            assessment_samples=assessment_samples,
            disorder_evidence=disorder_evidence,
            ensemble_samples=ensemble_samples,
            matrix=matrix,
            fitted_stack=fitted_stack,
            assessment_fold_id=assessment_fold_id,
            present_specialist_ids=present_specialist_ids,
            calibrated_evidence=calibrated_evidence,
            coverage_evidence=coverage_evidence,
            interval_evidence=interval_evidence,
            uncertainty=uncertainty,
            stress_evidence=stress_evidence,
        )
    )
    return {
        "boundDecision": decision.as_mapping(),
        "decision": decision.decision.as_mapping(),
        "uncertainty": uncertainty.as_mapping(),
    }


def _validation_evidence(
    *,
    samples: SampleSetV1,
    plan: WalkForwardPlanV1,
    matrix: ValidatedOofMatrixV1,
    fitted_stack: FittedStackV1,
    later_fold_ids: tuple[str, ...],
    stress_evidence: tuple[BoundClosureStressEvidenceV1, ...],
) -> tuple[ValidationClosureEvidenceV1, dict[str, object]]:
    grant = HoldoutGrantV1(
        grant_id="q12-final-holdout-grant:v1",
        reason="Q12 specs frozen; final synthetic holdout read for closure evidence only",
        plan_digest=plan.digest(),
    )
    holdout = open_holdout(samples, plan, grant)
    leakage_spec = LeakageSpecV1(
        primary=PrimaryMetricSpecV1(MetricKind.PR_AUC, None, None),
        implausible_skill=FixedPointV1(990_000_000_000),
        band_seed=CAMPAIGN_SEED,
        band_replicates=64,
    )
    leakage_samples, honest_predictions = stack_predictions_for_folds(
        samples=samples,
        matrix=matrix,
        fitted=fitted_stack,
        fold_ids=later_fold_ids,
    )
    leaked = future_leaked_predictions(
        leakage_samples,
        model_id=f"q12-temporal-{honest_predictions.digest().hexdigest[:16]}:v1",
    )
    leakage_assessments = (
        assess_leakage(leakage_samples, honest_predictions, leakage_spec),
        assess_leakage(
            leakage_samples,
            falsify_lineage(leaked, leakage_samples),
            leakage_spec,
        ),
        assess_leakage(leakage_samples, leaked, leakage_spec),
    )
    if tuple(item.verdict for item in leakage_assessments) != (
        LeakageVerdict.ACCEPTED_FOR_COMPARISON,
        LeakageVerdict.REJECTED_IMPLAUSIBLE_SKILL,
        LeakageVerdict.REJECTED_TEMPORAL_LEAK,
    ):
        raise RuntimeError(
            "Q12 leakage evidence did not produce all predeclared verdicts: "
            f"{tuple(item.verdict.value for item in leakage_assessments)}"
        )
    ledger = TrialLedgerV1(
        trials=(
            TrialRecordV1(
                trial_id="trial-0000",
                family_id="q12-stack",
                model_id="convex-stack:grid-8",
                metric_id="brier",
                status=TrialStatus.COMPLETED,
                note="predeclared exact simplex baseline",
            ),
            TrialRecordV1(
                trial_id="trial-0001",
                family_id="q12-stack",
                model_id="convex-stack:grid-16",
                metric_id="brier",
                status=TrialStatus.COMPLETED,
                note="bounded resolution challenger",
            ),
        )
    )
    pbo = pbo_cscv(
        (
            (make_ratio(3, 5), make_ratio(4, 5), make_ratio(2, 5), make_ratio(3, 5)),
            (make_ratio(2, 5), make_ratio(3, 5), make_ratio(4, 5), make_ratio(2, 5)),
        )
    )
    bootstrap = block_bootstrap_interval(
        tuple(make_ratio(value, 100) for value in (1, 3, 2, 4, 2, 5, 3, 4)),
        BootstrapSpecV1(
            seed=CAMPAIGN_SEED, block_length=2, replicates=32, coverage_per_myriad=9_000
        ),
    )
    returns = tuple(make_ratio(value, 100) for value in (1, 2, -1, 3, 2, -2, 4, 1) * 3)
    dsr = deflated_sharpe_ratio(
        DsrInputsV1(returns=returns, trial_count=2, trial_sr_variance=make_ratio(1, 100))
    )
    forbidden_ids = set(plan.holdout_sample_ids).union(plan.quarantined_sample_ids)
    research_samples = subset_by_ids(
        samples,
        tuple(sample_id for sample_id in samples.sample_ids if sample_id not in forbidden_ids),
    )
    leakage_evidence = BoundClosureLeakageEvidenceV1(
        matrix=matrix,
        fitted_stack=fitted_stack,
        later_fold_ids=later_fold_ids,
        spec=leakage_spec,
        honest_assessment=leakage_assessments[0],
        falsified_lineage_assessment=leakage_assessments[1],
        temporal_leak_assessment=leakage_assessments[2],
    )
    evidence = ValidationClosureEvidenceV1(
        plan_samples=samples,
        research_samples=research_samples,
        walk_forward_plan=plan,
        holdout_grant=grant,
        opened_holdout_sample_ids=tuple(sample.sample_id for sample in holdout),
        leakage_evidence=leakage_evidence,
        stress_evidence=stress_evidence,
        trial_ledger=ledger,
        pbo_report=pbo,
        dsr_report=dsr,
        bootstrap_report=bootstrap,
    )
    return evidence, {
        "bootstrapStatus": bootstrap.status.value,
        "dsrStatus": dsr.status.value,
        "honestLeakageVerdict": leakage_assessments[0].verdict.value,
        "holdoutCount": len(holdout),
        "implausibleLeakageVerdict": leakage_assessments[1].verdict.value,
        "multiplicity": {
            "bootstrap": bootstrap.as_mapping(),
            "dsr": dsr.as_mapping(),
            "ledger": ledger.as_mapping(),
            "pbo": pbo.as_mapping(),
        },
        "pboStatus": pbo.status.value,
        "holdoutOpenCallsPerBuild": 1,
        "temporalLeakageVerdict": leakage_assessments[2].verdict.value,
    }


def build_artifacts() -> tuple[bytes, bytes, bytes]:
    samples = _build_samples()
    plan = build_walk_forward_plan(
        samples,
        WalkForwardSpecV1(
            scheme=SplitScheme.EXPANDING,
            fold_count=6,
            max_label_horizon_ns=10,
            max_feature_lookback_ns=5,
            embargo_ns=15,
            min_train_size=8,
            holdout_fraction=make_ratio(1, 6),
            rolling_train_size=None,
        ),
    )
    specialist_ids = ("specialist-linear:v1", "specialist-robust:v1")
    bundles = _build_oof_bundles(samples, plan, specialist_ids)
    matrix = validate_oof_bundles(
        samples=samples,
        plan=plan,
        target_id="transition-binary:v1",
        horizon_ns=10,
        specialist_ids=specialist_ids,
        bundles=bundles,
    )
    meta_folds = matrix.fold_ids[:2]
    calibration_fold_ids = (matrix.fold_ids[2],)
    evaluation_fold_ids = (matrix.fold_ids[3],)
    coverage_fold_ids = (matrix.fold_ids[4],)
    assessment_fold_ids = (matrix.fold_ids[5],)
    coarse_fitted = fit_oof_stacker(
        samples=samples,
        matrix=matrix,
        spec=StackingSpecV1(
            meta_train_fold_ids=meta_folds,
            calibration_fold_ids=calibration_fold_ids,
            weight_divisions=8,
        ),
        stack_id="q12-convex-stack:v1",
    )
    fitted = fit_oof_stacker(
        samples=samples,
        matrix=matrix,
        spec=StackingSpecV1(
            meta_train_fold_ids=meta_folds,
            calibration_fold_ids=calibration_fold_ids,
            weight_divisions=16,
        ),
        stack_id="q12-convex-stack:v1",
    )
    _, evaluate_predictions = stack_predictions_for_folds(
        samples=samples,
        matrix=matrix,
        fitted=fitted,
        fold_ids=evaluation_fold_ids,
    )
    _, later_predictions = stack_predictions_for_folds(
        samples=samples,
        matrix=matrix,
        fitted=fitted,
        fold_ids=assessment_fold_ids,
    )
    _, coverage_predictions = stack_predictions_for_folds(
        samples=samples,
        matrix=matrix,
        fitted=fitted,
        fold_ids=coverage_fold_ids,
    )
    calibration_spec = CalibrationSpecV1(
        min_support=8,
        min_unique_scores=4,
        reliability_bins=(5, 10),
    )
    calibrator, comparison = compare_calibrators(
        samples=samples,
        matrix=matrix,
        fitted=fitted,
        evaluation_fold_ids=evaluation_fold_ids,
        spec=calibration_spec,
    )
    chosen_calibration_evaluation = next(
        evaluation
        for evaluation in comparison.evaluations
        if evaluation.method is calibrator.method
    )
    conformal_fit_slice = ConformalResearchSliceV1(
        samples=samples,
        plan=plan,
        target_id=matrix.target_id,
        fold_ids=evaluation_fold_ids,
        matrix=matrix,
        fitted_stack=fitted,
        base_half_width=make_ratio(1, 5),
    )
    conformal_application_slice = ConformalResearchSliceV1(
        samples=samples,
        plan=plan,
        target_id=matrix.target_id,
        fold_ids=assessment_fold_ids,
        matrix=matrix,
        fitted_stack=fitted,
        base_half_width=make_ratio(1, 5),
    )
    conformal_coverage_slice = ConformalResearchSliceV1(
        samples=samples,
        plan=plan,
        target_id=matrix.target_id,
        fold_ids=coverage_fold_ids,
        matrix=matrix,
        fitted_stack=fitted,
        base_half_width=make_ratio(1, 5),
    )
    conformal_calibration = _interval_observations(
        samples,
        conformal_fit_slice.validation_sample_ids,
        evaluate_predictions,
    )
    conformal_spec = ConformalSpecV1(alpha=make_ratio(2, 5), min_support=8)
    conformal_model = fit_conformal(
        conformal_calibration,
        conformal_spec,
        research_slice=conformal_fit_slice,
    )
    conformal_model_evidence = BoundConformalModelEvidenceV1(
        conformal_calibration,
        conformal_spec,
        conformal_fit_slice,
        conformal_model,
    )
    application_observations = _interval_observations(
        samples,
        conformal_application_slice.validation_sample_ids,
        later_predictions,
    )
    observations_by_id = {
        observation.observation_id: observation for observation in application_observations
    }
    coverage_observations = _interval_observations(
        samples,
        conformal_coverage_slice.validation_sample_ids,
        coverage_predictions,
    )
    observed_intervals = tuple(
        apply_conformal(
            conformal_model_evidence,
            observation.lower,
            observation.upper,
            observation_id=observation.observation_id,
            prediction_time_ns=observation.prediction_time_ns,
            research_slice=conformal_coverage_slice,
        )
        for observation in coverage_observations
    )
    coverage = monitor_coverage(
        observations=coverage_observations,
        intervals=observed_intervals,
        min_support=8,
        minimum_coverage=make_ratio(3, 5),
    )
    coverage_evidence = BoundCoverageEvidenceV1(
        conformal_model_evidence,
        coverage_observations,
        observed_intervals,
        conformal_coverage_slice,
        coverage,
    )
    adaptive_state = initialize_adaptive_conformal(
        model_evidence=conformal_model_evidence,
        config=AdaptiveConformalConfigV1(
            target_alpha=make_ratio(2, 5),
            gamma=make_ratio(1, 20),
            min_alpha=make_ratio(1, 20),
            max_alpha=make_ratio(1, 2),
            window_size=20,
            min_support=8,
        ),
        observations=conformal_calibration,
        research_slice=conformal_fit_slice,
    )
    conflict_sample_id, healthy_sample_id, unknown_sample_id, stale_sample_id = (
        conformal_application_slice.validation_sample_ids[-4:]
    )
    adaptive_matured = observations_by_id[healthy_sample_id]
    adaptive_pending = replace(adaptive_matured, outcome=None)
    adaptive_prediction = adaptive_predict(
        adaptive_state,
        adaptive_pending,
        research_slice=conformal_application_slice,
    )
    adaptive_next = adaptive_update(
        adaptive_state,
        adaptive_prediction,
        adaptive_matured,
        as_of_ns=adaptive_matured.outcome_time_ns,
        research_slice=conformal_application_slice,
    )

    def assessment_samples(sample_id: str) -> SampleSetV1:
        return subset_by_ids(samples, (sample_id,))

    def calibrated_assessment(sample_id: str) -> BoundCalibratedAssessmentV1:
        return bind_calibrated_assessment(
            samples=samples,
            matrix=matrix,
            fitted=fitted,
            calibrator=calibrator,
            comparison=comparison,
            evaluation=chosen_calibration_evaluation,
            application_fold_ids=assessment_fold_ids,
            assessment_sample_id=sample_id,
        )

    assessment_fold_id = assessment_fold_ids[0]

    def assessment_interval(sample_id: str) -> BoundConformalAssessmentV1:
        observation = observations_by_id[sample_id]
        pending = replace(observation, outcome=None)
        interval = apply_conformal(
            conformal_model_evidence,
            pending.lower,
            pending.upper,
            observation_id=sample_id,
            prediction_time_ns=pending.prediction_time_ns,
            research_slice=conformal_application_slice,
        )
        return BoundConformalAssessmentV1(
            conformal_model_evidence,
            pending,
            conformal_application_slice,
            interval,
        )

    disorder_config = DisorderConfigV1(
        fusion_id="q12-disorder:v1",
        alarm_recency_bars=2,
        persistence_watch=1,
        persistence_ood=2,
        uncertainty_threshold=FixedPointV1(1),
    )

    def disorder_evidence(
        case_samples: SampleSetV1,
        *,
        ood: bool = False,
    ) -> BoundDisorderEvidenceV1:
        persistence = 2 if ood else 0
        assessment = fuse_disorder(
            config=disorder_config,
            input_quality=case_samples.samples[0].quality,
            last_alarm_age=None,
            anomaly_persistence=persistence,
            regime_uncertainty=FixedPointV1(0),
        )
        return BoundDisorderEvidenceV1(
            case_samples,
            disorder_config,
            None,
            persistence,
            FixedPointV1(0),
            assessment,
        )

    conflict_samples = assessment_samples(conflict_sample_id)
    healthy_samples = assessment_samples(healthy_sample_id)
    unknown_samples = assessment_samples(unknown_sample_id)
    stale_samples = assessment_samples(stale_sample_id)
    if unknown_samples.samples[0].base_cost_ratio is not None:
        raise RuntimeError("cost-unknown assessment row must be plan-bound missing cost")
    if stale_samples.samples[0].quality is not QualityState.STALE:
        raise RuntimeError("stale assessment row must be plan-bound stale evidence")
    healthy_stress_report = _stress_report(
        healthy_samples,
        scenario_id="healthy-cost",
        fee_delta=make_ratio(0, 1),
    )
    conflict_stress_report = _stress_report(
        conflict_samples,
        scenario_id="conflict-cost",
        fee_delta=make_ratio(0, 1),
    )
    negative_stress_report = _stress_report(
        healthy_samples,
        scenario_id="negative-cost-latency",
        fee_delta=make_ratio(1, 1_000),
        latency_ns=2_000_000_000,
    )
    unknown_stress_report = _stress_report(
        unknown_samples,
        scenario_id="unknown-cost",
        fee_delta=make_ratio(0, 1),
    )
    stale_stress_report = _stress_report(
        stale_samples,
        scenario_id="stale-cost",
        fee_delta=make_ratio(0, 1),
    )

    def decision_case(
        *,
        sample_id: str,
        stress_report: CostStressReportV1,
        ood: bool = False,
    ) -> dict[str, dict[str, object]]:
        case_samples = assessment_samples(sample_id)
        calibrated = calibrated_assessment(sample_id)
        interval_evidence = assessment_interval(sample_id)
        bound_disorder = disorder_evidence(case_samples, ood=ood)
        return _decision(
            sample_id=sample_id,
            target_id=matrix.target_id,
            horizon_ns=matrix.horizon_ns,
            assessment_samples=case_samples,
            disorder_evidence=bound_disorder,
            ensemble_samples=samples,
            matrix=matrix,
            fitted_stack=fitted,
            assessment_fold_id=assessment_fold_id,
            present_specialist_ids=specialist_ids,
            calibrated_evidence=calibrated,
            coverage_evidence=coverage_evidence,
            interval_evidence=interval_evidence,
            stress_report=stress_report,
        )

    decisions: dict[str, dict[str, dict[str, object]]] = {
        "conflicting": decision_case(
            sample_id=conflict_sample_id,
            stress_report=conflict_stress_report,
        ),
        "costNegative": decision_case(
            sample_id=healthy_sample_id,
            stress_report=negative_stress_report,
        ),
        "costUnknown": decision_case(
            sample_id=unknown_sample_id,
            stress_report=unknown_stress_report,
        ),
        "healthy": decision_case(
            sample_id=healthy_sample_id,
            stress_report=healthy_stress_report,
        ),
        "ood": decision_case(
            sample_id=healthy_sample_id,
            stress_report=healthy_stress_report,
            ood=True,
        ),
        "stale": decision_case(
            sample_id=stale_sample_id,
            stress_report=stale_stress_report,
        ),
    }
    closure_stress_evidence = (
        BoundClosureStressEvidenceV1(
            samples=healthy_samples,
            report=healthy_stress_report,
        ),
        BoundClosureStressEvidenceV1(
            samples=healthy_samples,
            report=negative_stress_report,
        ),
        BoundClosureStressEvidenceV1(
            samples=unknown_samples,
            report=unknown_stress_report,
        ),
    )
    evidence, validation_summary = _validation_evidence(
        samples=samples,
        plan=plan,
        matrix=matrix,
        fitted_stack=fitted,
        later_fold_ids=matrix.fold_ids[2:],
        stress_evidence=closure_stress_evidence,
    )
    closure = close_q10_waiting_q14(
        q10_dispositions=SECTION_14_BATTERY_DISPOSITIONS,
        evidence=evidence,
        q14_acceptance_commit=Q14_ACCEPTANCE,
        q14_director_merge=Q14_DIRECTOR_MERGE,
    )
    fixture = {
        "adaptive": {
            "nextState": adaptive_next.as_mapping(),
            "prediction": adaptive_prediction.as_mapping(),
            "prefixDigestUnchangedByUnknownOutcome": adaptive_update(
                adaptive_state,
                adaptive_prediction,
                adaptive_pending,
                as_of_ns=adaptive_pending.outcome_time_ns,
                research_slice=conformal_application_slice,
            )
            .digest()
            .hexdigest
            == adaptive_state.digest().hexdigest,
        },
        "calibration": comparison.as_mapping(),
        "closure": closure.as_mapping(),
        "conformal": {
            "coverage": coverage.as_mapping(),
            "coverageEvidenceDigest": coverage_evidence.digest().hexdigest,
            "interval": assessment_interval(healthy_sample_id).interval.as_mapping(),
            "intervalEvidenceDigest": assessment_interval(healthy_sample_id).digest().hexdigest,
            "model": conformal_model.as_mapping(),
            "modelEvidenceDigest": conformal_model_evidence.digest().hexdigest,
        },
        "chronology": {
            "assessmentFoldIds": list(assessment_fold_ids),
            "assessmentSampleIds": [
                conflict_sample_id,
                healthy_sample_id,
                unknown_sample_id,
                stale_sample_id,
            ],
            "calibrationFoldIds": list(calibration_fold_ids),
            "conformalFitFoldIds": list(conformal_fit_slice.fold_ids),
            "coverageFoldIds": list(conformal_coverage_slice.fold_ids),
            "evaluationFoldIds": list(evaluation_fold_ids),
            "metaFoldIds": list(meta_folds),
        },
        "decisions": decisions,
        "evidencePosture": "SYNTHETIC_ONLY",
        "matrixDigest": matrix.digest().hexdigest,
        "plan": plan.as_mapping(),
        "schema": "Q12EnsembleGoldenFixtureV1",
        "seed": str(CAMPAIGN_SEED),
        "stack": {
            "coarseGrid8": coarse_fitted.as_mapping(),
            "selectedGrid16": fitted.as_mapping(),
        },
        "validationSummary": validation_summary,
        "version": 1,
    }
    fixture_bytes = canonical_json_bytes(fixture)
    campaign = {
        "abstentionActions": {
            case: details["decision"]["action"] for case, details in decisions.items()
        },
        "closureDigest": closure.digest().hexdigest,
        "coverageStatus": coverage.status.value,
        "evidencePosture": "SYNTHETIC_ONLY",
        "fixtureSha256": hashlib.sha256(fixture_bytes).hexdigest(),
        "q10WaitingQ14Closed": len(closure.records),
        "schema": "Q12EnsembleCampaignV1",
        "seed": str(CAMPAIGN_SEED),
        "selectedCalibration": comparison.chosen_method.value,
        "specialistWeights": {
            specialist_id: weight.as_mapping() for specialist_id, weight in fitted.weights
        },
        "stackTrainingBrier": {
            "grid8": coarse_fitted.training_brier.as_mapping(),
            "grid16": fitted.training_brier.as_mapping(),
        },
        "validation": validation_summary,
        "version": 1,
    }
    campaign_bytes = canonical_json_bytes(campaign)
    lines = [
        "# Q12 ensemble, calibration and abstention campaign (synthetic only)",
        "",
        f"- Seed: `{CAMPAIGN_SEED}`",
        f"- Golden fixture SHA-256: `{hashlib.sha256(fixture_bytes).hexdigest()}`",
        f"- Q10 WAITING_Q14 seams closed: `{len(closure.records)}/5`",
        f"- Selected chronological calibration: `{comparison.chosen_method.value}`",
        f"- Coverage monitor: `{coverage.status.value}`",
        "- Evidence posture: `SYNTHETIC_ONLY`; no edge, market validity, promotion, capital,",
        "  risk or order authority is claimed.",
        "",
        "## Deterministic abstention matrix",
        "",
        "| Case | Action | Reasons |",
        "| --- | --- | --- |",
    ]
    for case, details in decisions.items():
        decision = details["decision"]
        reasons = ", ".join(cast(list[str], decision["reasons"])) or "—"
        lines.append(f"| {case} | {decision['action']} | {reasons} |")
    lines.extend(["", "## Q14 closure", ""])
    for record in closure.records:
        lines.append(
            f"- `{record.bullet_id}` → `{record.status.value}` via "
            + ", ".join(f"`{owner}`" for owner in record.closure_apis)
        )
    lines.append("")
    markdown_bytes = "\n".join(lines).encode("utf-8")
    return fixture_bytes, campaign_bytes, markdown_bytes


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: q12_ensemble_campaign.py OUTPUT_ROOT", file=sys.stderr)
        return 2
    output_root = Path(argv[1])
    started = time.perf_counter_ns()
    fixture_bytes, campaign_bytes, markdown_bytes = build_artifacts()
    elapsed = time.perf_counter_ns() - started
    fixture_path = output_root / "fixtures" / "q12_ensemble_golden_v1.json"
    campaign_path = output_root / "generated" / "q12" / "ensemble_campaign.v1.json"
    markdown_path = output_root / "generated" / "q12" / "ensemble_campaign.v1.md"
    fixture_path.parent.mkdir(parents=True, exist_ok=True)
    campaign_path.parent.mkdir(parents=True, exist_ok=True)
    fixture_path.write_bytes(fixture_bytes)
    campaign_path.write_bytes(campaign_bytes)
    markdown_path.write_bytes(markdown_bytes)
    print(f"fixture sha256 {hashlib.sha256(fixture_bytes).hexdigest()}")
    print(f"campaign sha256 {hashlib.sha256(campaign_bytes).hexdigest()}")
    print(f"markdown sha256 {hashlib.sha256(markdown_bytes).hexdigest()}")
    print("# environment-specific wall-time evidence (non-deterministic, informational)")
    print(f"wall-ns q12-ensemble-artifact-build {elapsed}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
