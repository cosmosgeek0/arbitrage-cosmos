from __future__ import annotations

from dataclasses import replace
from typing import Any, cast

import pytest

import quant_edge.ensemble.adapters as adapters_module
from quant_edge.ensemble import (
    ANY_CAUSE_BINARY_TARGET,
    Q14_ACCEPTANCE_COMMIT,
    Q14_DIRECTOR_MERGE,
    WAITING_Q14_IDS,
    BoundClosureLeakageEvidenceV1,
    ClosureStatus,
    OofFoldPredictionBundleV1,
    StackingSpecV1,
    SurvivalPredictionCrosswalkV1,
    ValidationClosureEvidenceV1,
    close_q10_waiting_q14,
    fit_oof_stacker,
    project_survival_probability,
    stack_predictions_for_folds,
    validate_oof_bundles,
)
from quant_edge.ensemble.adapters import (
    BoundClosureStressEvidenceV1,
    ValidationClosureManifestV1,
    ValidationClosureRecordV1,
)
from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import FIXED_POINT_SCALE, FixedPointV1
from quant_edge.labels.rational import ExactRatioV1, make_ratio
from quant_edge.lake.contracts import DigestV1, EvidencePosture, QualityState
from quant_edge.models.battery import SECTION_14_BATTERY_DISPOSITIONS
from quant_edge.models.contracts import BatteryDisposition, ProbabilitySemantics
from quant_edge.survival import (
    ANY_CAUSE,
    SubjectPredictionV1,
    SurvivalTarget,
    TimeGridV1,
)
from quant_edge.survival import (
    PredictionSetV1 as SurvivalPredictionSetV1,
)
from quant_edge.validation import (
    BootstrapSpecV1,
    CostStressScenarioV1,
    DsrInputsV1,
    HoldoutGrantV1,
    LeakageSpecV1,
    LeakageVerdict,
    MetricKind,
    OpportunityDecayV1,
    PrimaryMetricSpecV1,
    SampleSetV1,
    StressSpecV1,
    TrialLedgerV1,
    TrialRecordV1,
    TrialStatus,
    ValidationSampleV1,
    WalkForwardSpecV1,
    assess_leakage,
    block_bootstrap_interval,
    build_walk_forward_plan,
    deflated_sharpe_ratio,
    falsify_lineage,
    future_leaked_predictions,
    open_holdout,
    pbo_cscv,
    random_rank_predictions,
    run_cost_stress,
    subset_by_ids,
)
from quant_edge.validation.splits import SplitScheme

BASE = 1_700_000_000_000_000_000


def _digest(character: str) -> DigestV1:
    return DigestV1(character * 64)


def _closure_samples() -> SampleSetV1:
    return SampleSetV1(
        "q12-closure-evidence:v1",
        EvidencePosture.SYNTHETIC,
        tuple(
            ValidationSampleV1(
                sample_id=f"closure-{index:04d}",
                symbol="SYNTH",
                group_id=f"closure-group-{index:04d}",
                cutoff_ns=BASE + index * 100,
                label_end_ns=BASE + index * 100 + 10,
                strata=(),
                binary_outcome=(index * 7) % 3 == 0,
                gross_edge_ratio=make_ratio(3, 1_000),
                base_cost_ratio=None if index == 1 else make_ratio(1, 1_000),
                quality=QualityState.SYNTHETIC,
            )
            for index in range(60)
        ),
    )


def _leakage_evidence(
    samples: SampleSetV1,
    plan: Any,
) -> BoundClosureLeakageEvidenceV1:
    specialist_ids = ("q12-closure-specialist-a:v1", "q12-closure-specialist-b:v1")
    bundles: list[OofFoldPredictionBundleV1] = []
    for fold_index, fold in enumerate(plan.folds):
        fold_samples = subset_by_ids(samples, fold.validation_sample_ids)
        for specialist_index, specialist_id in enumerate(specialist_ids):
            bundles.append(
                OofFoldPredictionBundleV1(
                    specialist_id=specialist_id,
                    target_id="q12-closure-target:v1",
                    horizon_ns=10,
                    probability_semantics=ProbabilitySemantics.UNCALIBRATED_SCORE,
                    fold_id=fold.fold_id,
                    train_sample_ids=fold.train_sample_ids,
                    predictions=random_rank_predictions(
                        fold_samples,
                        seed=100 + fold_index * 10 + specialist_index,
                        model_id=specialist_id,
                    ),
                )
            )
    matrix = validate_oof_bundles(
        samples=samples,
        plan=plan,
        target_id="q12-closure-target:v1",
        horizon_ns=10,
        specialist_ids=specialist_ids,
        bundles=tuple(bundles),
    )
    fitted = fit_oof_stacker(
        samples=samples,
        matrix=matrix,
        spec=StackingSpecV1(
            meta_train_fold_ids=(plan.folds[0].fold_id, plan.folds[1].fold_id),
            calibration_fold_ids=(plan.folds[2].fold_id,),
            weight_divisions=8,
        ),
        stack_id="q12-closure-stack:v1",
    )
    later_fold_ids = (plan.folds[3].fold_id,)
    assessment_samples, honest_predictions = stack_predictions_for_folds(
        samples=samples,
        matrix=matrix,
        fitted=fitted,
        fold_ids=later_fold_ids,
    )
    spec = LeakageSpecV1(
        PrimaryMetricSpecV1(MetricKind.PR_AUC, None, None),
        FixedPointV1(990_000_000_000),
        20_260_712,
        16,
    )
    leaked = future_leaked_predictions(
        assessment_samples,
        model_id=f"q12-temporal-{honest_predictions.digest().hexdigest[:16]}:v1",
    )
    return BoundClosureLeakageEvidenceV1(
        matrix=matrix,
        fitted_stack=fitted,
        later_fold_ids=later_fold_ids,
        spec=spec,
        honest_assessment=assess_leakage(assessment_samples, honest_predictions, spec),
        falsified_lineage_assessment=assess_leakage(
            assessment_samples,
            falsify_lineage(leaked, assessment_samples),
            spec,
        ),
        temporal_leak_assessment=assess_leakage(assessment_samples, leaked, spec),
    )


def _leakage_assessments(
    evidence: BoundClosureLeakageEvidenceV1,
    spec: LeakageSpecV1,
) -> tuple[Any, Any, Any]:
    assessment_samples, honest_predictions = stack_predictions_for_folds(
        samples=evidence.matrix.samples,
        matrix=evidence.matrix,
        fitted=evidence.fitted_stack,
        fold_ids=evidence.later_fold_ids,
    )
    leaked = future_leaked_predictions(
        assessment_samples,
        model_id=f"q12-temporal-{honest_predictions.digest().hexdigest[:16]}:v1",
    )
    return (
        assess_leakage(assessment_samples, honest_predictions, spec),
        assess_leakage(
            assessment_samples,
            falsify_lineage(leaked, assessment_samples),
            spec,
        ),
        assess_leakage(assessment_samples, leaked, spec),
    )


def _copy_matrix_with_plan(matrix: Any, plan: Any) -> Any:
    copied = object.__new__(matrix.__class__)
    for field_name in matrix.__dataclass_fields__:
        object.__setattr__(
            copied,
            field_name,
            plan if field_name == "plan" else getattr(matrix, field_name),
        )
    return copied


def _evidence() -> ValidationClosureEvidenceV1:
    samples = _closure_samples()
    plan = build_walk_forward_plan(
        samples,
        WalkForwardSpecV1(
            SplitScheme.EXPANDING,
            4,
            10,
            5,
            15,
            6,
            make_ratio(1, 5),
            None,
        ),
    )
    grant = HoldoutGrantV1("q12-holdout-grant:v1", "frozen Q12 final read", plan.digest())
    opened = open_holdout(samples, plan, grant)
    forbidden_ids = set(plan.holdout_sample_ids).union(plan.quarantined_sample_ids)
    research = subset_by_ids(
        samples,
        tuple(sample_id for sample_id in samples.sample_ids if sample_id not in forbidden_ids),
    )
    first = SampleSetV1("q12-stress:v1", EvidencePosture.SYNTHETIC, (samples.samples[0],))
    zero = make_ratio(0, 1)
    decay = OpportunityDecayV1(make_ratio(1, 1_000))

    def scenario(
        identifier: str,
        fee: ExactRatioV1,
        latency_ns: int = 0,
    ) -> CostStressScenarioV1:
        return CostStressScenarioV1(identifier, fee, zero, zero, zero, zero, latency_ns)

    negative = run_cost_stress(
        first,
        StressSpecV1(
            zero,
            decay,
            (scenario("negative-latency", make_ratio(1, 1_000), 2_000_000_000),),
        ),
    )
    unknown_samples = SampleSetV1(
        "q12-stress-unknown:v1",
        EvidencePosture.SYNTHETIC,
        (samples.samples[1],),
    )
    unknown = run_cost_stress(
        unknown_samples,
        StressSpecV1(zero, decay, (scenario("unknown", zero),)),
    )
    ledger = TrialLedgerV1(
        (
            TrialRecordV1("trial-0", "q12", "stack-8", "brier", TrialStatus.COMPLETED, ""),
            TrialRecordV1("trial-1", "q12", "stack-16", "brier", TrialStatus.COMPLETED, ""),
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
        BootstrapSpecV1(20_260_712, 2, 16, 9_000),
    )
    dsr = deflated_sharpe_ratio(
        DsrInputsV1(
            tuple(make_ratio(value, 100) for value in (1, 2, -1, 3, 2, -2, 4, 1) * 3),
            2,
            make_ratio(1, 100),
        )
    )
    return ValidationClosureEvidenceV1(
        plan_samples=samples,
        research_samples=research,
        walk_forward_plan=plan,
        holdout_grant=grant,
        opened_holdout_sample_ids=tuple(sample.sample_id for sample in opened),
        leakage_evidence=_leakage_evidence(samples, plan),
        stress_evidence=(
            BoundClosureStressEvidenceV1(first, negative),
            BoundClosureStressEvidenceV1(unknown_samples, unknown),
        ),
        trial_ledger=ledger,
        pbo_report=pbo,
        dsr_report=dsr,
        bootstrap_report=bootstrap,
    )


def _samples() -> SampleSetV1:
    return SampleSetV1(
        dataset_id="q12-survival-adapter:v1",
        posture=EvidencePosture.SYNTHETIC,
        samples=tuple(
            ValidationSampleV1(
                sample_id=f"sample-{index}",
                symbol="SYNTH",
                group_id=f"group-{index}",
                cutoff_ns=BASE + index * 100,
                label_end_ns=BASE + index * 100 + 20,
                strata=(),
                binary_outcome=bool(index),
                gross_edge_ratio=None,
                base_cost_ratio=None,
                quality=QualityState.SYNTHETIC,
            )
            for index in range(2)
        ),
    )


def _survival() -> SurvivalPredictionSetV1:
    return SurvivalPredictionSetV1(
        prediction_id="survival:v1",
        cohort_id="q12-survival-adapter-cohort:v1",
        model_id="q12-survival-adapter-model:v1",
        target=SurvivalTarget.TIME_TO_CONVERGENCE,
        split_id="q12-survival-adapter-split:v1",
        grid=TimeGridV1("survival-grid:v1", (10, 20)),
        cause_scope=ANY_CAUSE,
        predictions=(
            SubjectPredictionV1(
                "subject-0",
                (FixedPointV1(FIXED_POINT_SCALE // 10), FixedPointV1(FIXED_POINT_SCALE // 5)),
            ),
            SubjectPredictionV1(
                "subject-1",
                (FixedPointV1(FIXED_POINT_SCALE // 5), FixedPointV1(FIXED_POINT_SCALE // 2)),
            ),
        ),
    )


def _crosswalk(samples: SampleSetV1) -> tuple[SurvivalPredictionCrosswalkV1, ...]:
    return tuple(
        SurvivalPredictionCrosswalkV1(
            subject_id=f"subject-{index}",
            sample_id=sample.sample_id,
            group_id=sample.group_id,
            max_feature_asof_ns=sample.cutoff_ns,
        )
        for index, sample in enumerate(samples.samples)
    )


def test_q10_waiting_q14_closure_is_exact_additive_and_digest_bound() -> None:
    manifest = close_q10_waiting_q14(
        q10_dispositions=SECTION_14_BATTERY_DISPOSITIONS,
        evidence=_evidence(),
        q14_acceptance_commit=Q14_ACCEPTANCE_COMMIT,
        q14_director_merge=Q14_DIRECTOR_MERGE,
    )
    assert tuple(record.bullet_id for record in manifest.records) == WAITING_Q14_IDS
    assert all(record.status is ClosureStatus.ADAPTED_CLOSED for record in manifest.records)
    assert all(record.closure_apis for record in manifest.records)
    assert (
        manifest.evidence.for_bullet(WAITING_Q14_IDS[0])
        == manifest.evidence.walk_forward_plan.digest()
    )
    assert manifest.as_mapping()["schema"] == "Q12ValidationClosureManifestV1"
    assert len(manifest.digest().hexdigest) == 64
    assert manifest.evidence.leakage_assessments == manifest.evidence.leakage_evidence.assessments


def test_bound_closure_leakage_evidence_recomputes_every_control() -> None:
    evidence = _evidence()
    leakage = evidence.leakage_evidence
    assessment_ids = leakage.assessment_sample_ids
    assert assessment_ids == tuple(
        sorted(evidence.walk_forward_plan.folds[-1].validation_sample_ids)
    )
    assert set(assessment_ids).issubset(evidence.research_samples.sample_ids)
    assert tuple(item.verdict for item in leakage.assessments) == (
        LeakageVerdict.ACCEPTED_FOR_COMPARISON,
        LeakageVerdict.REJECTED_IMPLAUSIBLE_SKILL,
        LeakageVerdict.REJECTED_TEMPORAL_LEAK,
    )
    assert leakage.as_mapping()["laterFoldIds"] == ["fold-04"]

    with pytest.raises(ContractValueError, match="matrix must"):
        replace(leakage, matrix=object())  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="fitted_stack"):
        replace(leakage, fitted_stack=object())  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="spec must"):
        replace(leakage, spec=object())  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="later_fold_ids"):
        replace(leakage, later_fold_ids=["fold-04"])  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="LeakageAssessmentV1"):
        replace(leakage, honest_assessment=object())  # type: ignore[arg-type]

    forged_verdict = replace(
        leakage.honest_assessment,
        verdict=LeakageVerdict.REJECTED_IMPLAUSIBLE_SKILL,
    )
    with pytest.raises(ContractValueError, match="exactly recompute"):
        replace(leakage, honest_assessment=forged_verdict)

    implausible_spec = replace(leakage.spec, implausible_skill=FixedPointV1(0))
    honest, falsified, temporal = _leakage_assessments(leakage, implausible_spec)
    with pytest.raises(ContractValueError, match="honest and both leak paths"):
        replace(
            leakage,
            spec=implausible_spec,
            honest_assessment=honest,
            falsified_lineage_assessment=falsified,
            temporal_leak_assessment=temporal,
        )

    forged_plan = replace(
        leakage.matrix.plan,
        holdout_sample_ids=(
            *leakage.matrix.plan.holdout_sample_ids,
            assessment_ids[0],
        ),
    )
    forged_matrix = _copy_matrix_with_plan(leakage.matrix, forged_plan)
    with pytest.raises(ContractValueError, match="holdout or quarantine"):
        replace(leakage, matrix=forged_matrix)


def test_closure_rejects_missing_retyped_or_unknown_historical_seams() -> None:
    with pytest.raises(ContractValueError, match="immutable history"):
        close_q10_waiting_q14(
            q10_dispositions=SECTION_14_BATTERY_DISPOSITIONS[:-1],
            evidence=_evidence(),
            q14_acceptance_commit=Q14_ACCEPTANCE_COMMIT,
            q14_director_merge=Q14_DIRECTOR_MERGE,
        )
    index = next(
        index
        for index, record in enumerate(SECTION_14_BATTERY_DISPOSITIONS)
        if record.bullet_id == WAITING_Q14_IDS[0]
    )
    rewritten = list(SECTION_14_BATTERY_DISPOSITIONS)
    rewritten[index] = replace(rewritten[index], disposition=BatteryDisposition.REFERENCE_ONLY)
    with pytest.raises(ContractValueError, match="immutable history"):
        close_q10_waiting_q14(
            q10_dispositions=tuple(rewritten),
            evidence=_evidence(),
            q14_acceptance_commit=Q14_ACCEPTANCE_COMMIT,
            q14_director_merge=Q14_DIRECTOR_MERGE,
        )
    with pytest.raises(ContractValueError, match="unknown"):
        _evidence().for_bullet("not-a-seam")


def test_closure_contracts_reject_incoherent_records_and_manifest() -> None:
    record = ValidationClosureRecordV1(
        bullet_id=WAITING_Q14_IDS[0],
        status=ClosureStatus.ADAPTED_CLOSED,
        closure_apis=("a", "b"),
        evidence_digest=_digest("1"),
    )
    with pytest.raises(ContractValueError):
        replace(record, bullet_id="unknown")
    with pytest.raises(ContractValueError):
        replace(record, closure_apis=("b", "a"))
    manifest = close_q10_waiting_q14(
        q10_dispositions=SECTION_14_BATTERY_DISPOSITIONS,
        evidence=_evidence(),
        q14_acceptance_commit=Q14_ACCEPTANCE_COMMIT,
        q14_director_merge=Q14_DIRECTOR_MERGE,
    )
    with pytest.raises(ContractValueError):
        ValidationClosureManifestV1(
            q10_disposition_digest=manifest.q10_disposition_digest,
            q14_acceptance_commit=manifest.q14_acceptance_commit,
            q14_director_merge=manifest.q14_director_merge,
            evidence=manifest.evidence,
            records=manifest.records[:-1],
        )
    assert record.as_mapping()["status"] == "ADAPTED_CLOSED"


def test_q11_survival_projection_requires_exact_horizon_and_identity_crosswalk() -> None:
    samples = _samples()
    projected = project_survival_probability(
        survival_predictions=_survival(),
        samples=samples,
        crosswalk=_crosswalk(samples),
        horizon_ns=20,
        target_id=ANY_CAUSE_BINARY_TARGET,
        model_id="q11-projected:v1",
    )
    assert projected.dataset_digest == samples.digest()
    assert projected.score_for("sample-0").score.numerator == 1
    assert projected.score_for("sample-0").score.denominator == 5
    assert projected.score_for("sample-1").score.numerator == 1
    assert projected.score_for("sample-1").score.denominator == 2


def test_survival_projection_rejects_unknown_horizon_duplicate_or_incomplete_crosswalk() -> None:
    samples = _samples()
    crosswalk = _crosswalk(samples)
    with pytest.raises(ContractValueError, match="grid time"):
        project_survival_probability(
            survival_predictions=_survival(),
            samples=samples,
            crosswalk=crosswalk,
            horizon_ns=15,
            target_id=ANY_CAUSE_BINARY_TARGET,
            model_id="projected:v1",
        )
    with pytest.raises(ContractValueError, match="unique"):
        project_survival_probability(
            survival_predictions=_survival(),
            samples=samples,
            crosswalk=(crosswalk[0], replace(crosswalk[1], sample_id=crosswalk[0].sample_id)),
            horizon_ns=20,
            target_id=ANY_CAUSE_BINARY_TARGET,
            model_id="projected:v1",
        )
    with pytest.raises(ContractValueError, match="exactly"):
        project_survival_probability(
            survival_predictions=_survival(),
            samples=samples,
            crosswalk=crosswalk[:-1],
            horizon_ns=20,
            target_id=ANY_CAUSE_BINARY_TARGET,
            model_id="projected:v1",
        )


def test_survival_projection_rejects_group_mismatch_and_future_lineage() -> None:
    samples = _samples()
    crosswalk = _crosswalk(samples)
    with pytest.raises(ContractValueError, match="group_id"):
        project_survival_probability(
            survival_predictions=_survival(),
            samples=samples,
            crosswalk=(replace(crosswalk[0], group_id="wrong"), crosswalk[1]),
            horizon_ns=20,
            target_id=ANY_CAUSE_BINARY_TARGET,
            model_id="projected:v1",
        )
    with pytest.raises(ContractValueError, match="after cutoff"):
        project_survival_probability(
            survival_predictions=_survival(),
            samples=samples,
            crosswalk=(
                replace(crosswalk[0], max_feature_asof_ns=samples.samples[0].cutoff_ns + 1),
                crosswalk[1],
            ),
            horizon_ns=20,
            target_id=ANY_CAUSE_BINARY_TARGET,
            model_id="projected:v1",
        )


def test_survival_crosswalk_contract_rejects_non_integer_time() -> None:
    with pytest.raises(ContractValueError):
        SurvivalPredictionCrosswalkV1(
            subject_id="subject",
            sample_id="sample",
            group_id="group",
            max_feature_asof_ns=True,
        )


def test_q12_consumes_q14_negative_control_and_both_leak_rejection_paths() -> None:
    samples = SampleSetV1(
        "q12-q14-leakage:v1",
        EvidencePosture.SYNTHETIC,
        tuple(
            ValidationSampleV1(
                sample_id=f"leak-{index:04d}",
                symbol="SYNTH",
                group_id=f"group-{index:04d}",
                cutoff_ns=BASE + index * 100,
                label_end_ns=BASE + index * 100 + 10,
                strata=(),
                binary_outcome=(index * 7) % 3 == 0,
                gross_edge_ratio=None,
                base_cost_ratio=None,
                quality=QualityState.SYNTHETIC,
            )
            for index in range(60)
        ),
    )
    spec = LeakageSpecV1(
        primary=PrimaryMetricSpecV1(MetricKind.PR_AUC, None, None),
        implausible_skill=FixedPointV1(990_000_000_000),
        band_seed=20_260_712,
        band_replicates=16,
    )
    leaked = future_leaked_predictions(samples, model_id="q12-leaked:v1")
    truthful = assess_leakage(samples, leaked, spec)
    forged = assess_leakage(samples, falsify_lineage(leaked, samples), spec)
    honest = assess_leakage(
        samples,
        random_rank_predictions(samples, seed=7, model_id="q12-honest:v1"),
        spec,
    )
    assert truthful.verdict is LeakageVerdict.REJECTED_TEMPORAL_LEAK
    assert forged.verdict is LeakageVerdict.REJECTED_IMPLAUSIBLE_SKILL
    assert honest.verdict is LeakageVerdict.ACCEPTED_FOR_COMPARISON


def test_survival_projection_rejects_every_unbound_semantic_input() -> None:
    samples = _samples()
    crosswalk = _crosswalk(samples)
    kwargs: dict[str, Any] = {
        "survival_predictions": _survival(),
        "samples": samples,
        "crosswalk": crosswalk,
        "horizon_ns": 20,
        "target_id": ANY_CAUSE_BINARY_TARGET,
        "model_id": "projected:v1",
    }
    with pytest.raises(ContractValueError):
        project_survival_probability(**{**kwargs, "survival_predictions": object()})
    with pytest.raises(ContractValueError, match="ANY_CAUSE"):
        project_survival_probability(
            **{**kwargs, "survival_predictions": replace(_survival(), cause_scope="cause-x")}
        )
    with pytest.raises(ContractValueError):
        project_survival_probability(**{**kwargs, "samples": object()})
    with pytest.raises(ContractValueError, match="target semantics"):
        project_survival_probability(**{**kwargs, "target_id": "other-target:v1"})
    with pytest.raises(ContractValueError, match="non-empty"):
        project_survival_probability(**{**kwargs, "crosswalk": ()})
    with pytest.raises(ContractValueError, match="must contain"):
        project_survival_probability(**{**kwargs, "crosswalk": (object(),)})
    with pytest.raises(ContractValueError, match="sample set"):
        project_survival_probability(
            **{
                **kwargs,
                "crosswalk": (
                    crosswalk[0],
                    replace(crosswalk[1], sample_id="foreign-sample"),
                ),
            }
        )
    mismatched_horizon = SampleSetV1(
        "mismatched-horizon:v1",
        samples.posture,
        (
            replace(samples.samples[0], label_end_ns=samples.samples[0].label_end_ns + 1),
            *samples.samples[1:],
        ),
    )
    with pytest.raises(ContractValueError, match="sample horizon"):
        project_survival_probability(
            **{
                **kwargs,
                "samples": mismatched_horizon,
                "crosswalk": _crosswalk(mismatched_horizon),
            }
        )


def test_typed_q14_closure_evidence_rejects_substitution_and_missing_proofs() -> None:
    evidence = _evidence()
    with pytest.raises(ContractValueError, match="valid Q14 plan"):
        replace(
            evidence,
            walk_forward_plan=replace(
                evidence.walk_forward_plan,
                status=cast(Any, "bad"),
            ),
        )
    with pytest.raises(ContractValueError, match="bind the Q14 plan"):
        replace(evidence, holdout_grant=replace(evidence.holdout_grant, plan_digest=_digest("9")))
    with pytest.raises(ContractValueError, match="opened holdout"):
        replace(evidence, opened_holdout_sample_ids=evidence.opened_holdout_sample_ids[:-1])
    with pytest.raises(ContractValueError, match="exactly recompute"):
        replace(
            evidence.leakage_evidence,
            temporal_leak_assessment=evidence.leakage_evidence.honest_assessment,
        )
    with pytest.raises(ContractValueError, match="bound Q14"):
        replace(evidence, stress_evidence=())
    with pytest.raises(ContractValueError, match="cost-negative and unknown"):
        replace(evidence, stress_evidence=evidence.stress_evidence[:1])
    with pytest.raises(ContractValueError, match="trial_ledger"):
        replace(evidence, trial_ledger=object())  # type: ignore[arg-type]
    invalid_pbo = pbo_cscv(())
    with pytest.raises(ContractValueError, match="pbo_report"):
        replace(evidence, pbo_report=invalid_pbo)
    invalid_dsr = deflated_sharpe_ratio(DsrInputsV1((), 1, make_ratio(0, 1)))
    with pytest.raises(ContractValueError, match="dsr_report"):
        replace(evidence, dsr_report=invalid_dsr)
    invalid_bootstrap = block_bootstrap_interval((), BootstrapSpecV1(1, 1, 8, 9_000))
    with pytest.raises(ContractValueError, match="bootstrap_report"):
        replace(evidence, bootstrap_report=invalid_bootstrap)
    with pytest.raises(ContractValueError, match="canonical mappings"):
        evidence._digest_mapping(object())


def test_closure_stress_evidence_rejects_rebound_rows_and_reports() -> None:
    evidence = _evidence()
    bound = evidence.stress_evidence[0]
    forged_outcome = replace(
        bound.report.outcomes[0],
        actionable_count=1,
        not_actionable_count=0,
        flipped_from_base_count=0,
    )
    with pytest.raises(ContractValueError, match="recomputable"):
        replace(bound, report=replace(bound.report, outcomes=(forged_outcome,)))

    holdout = evidence.plan_samples.by_id(evidence.walk_forward_plan.holdout_sample_ids[0])
    holdout_samples = SampleSetV1(
        "holdout-stress:v1",
        evidence.plan_samples.posture,
        (holdout,),
    )
    holdout_bound = BoundClosureStressEvidenceV1(
        holdout_samples,
        run_cost_stress(holdout_samples, bound.report.spec),
    )
    with pytest.raises(ContractValueError, match="holdout or quarantine"):
        replace(
            evidence,
            stress_evidence=(holdout_bound, *evidence.stress_evidence[1:]),
        )

    altered = replace(bound.samples.samples[0], base_cost_ratio=None)
    altered_samples = SampleSetV1(
        "altered-stress:v1",
        bound.samples.posture,
        (altered,),
    )
    altered_bound = BoundClosureStressEvidenceV1(
        altered_samples,
        run_cost_stress(altered_samples, bound.report.spec),
    )
    with pytest.raises(ContractValueError, match="exactly from the plan"):
        replace(
            evidence,
            stress_evidence=(altered_bound, *evidence.stress_evidence[1:]),
        )


def test_closure_record_manifest_and_entrypoint_reject_type_and_commit_substitution() -> None:
    evidence = _evidence()
    manifest = close_q10_waiting_q14(
        q10_dispositions=SECTION_14_BATTERY_DISPOSITIONS,
        evidence=evidence,
        q14_acceptance_commit=Q14_ACCEPTANCE_COMMIT,
        q14_director_merge=Q14_DIRECTOR_MERGE,
    )
    record = manifest.records[0]
    with pytest.raises(ContractValueError):
        replace(record, status=cast(Any, "bad"))
    with pytest.raises(ContractValueError):
        replace(record, evidence_digest=cast(Any, "bad"))
    with pytest.raises(ContractValueError):
        replace(manifest, q10_disposition_digest=cast(Any, "bad"))
    with pytest.raises(ContractValueError, match="accepted Q14"):
        replace(manifest, q14_acceptance_commit="e266b42")
    with pytest.raises(ContractValueError, match="director Q14"):
        replace(manifest, q14_director_merge="f756f3b")
    with pytest.raises(ContractValueError):
        replace(manifest, evidence=cast(Any, object()))
    with pytest.raises(ContractValueError, match="record APIs"):
        replace(
            manifest,
            records=(replace(record, closure_apis=("fake.api",)), *manifest.records[1:]),
        )
    with pytest.raises(ContractValueError, match="record evidence"):
        replace(
            manifest,
            records=(
                replace(record, evidence_digest=DigestV1("0" * 64)),
                *manifest.records[1:],
            ),
        )
    tampered = list(SECTION_14_BATTERY_DISPOSITIONS)
    seam_index = next(
        index for index, item in enumerate(tampered) if item.bullet_id == WAITING_Q14_IDS[0]
    )
    tampered[seam_index] = replace(tampered[seam_index], reason="tampered-but-valid")
    with pytest.raises(ContractValueError, match="immutable history"):
        close_q10_waiting_q14(
            q10_dispositions=tuple(tampered),
            evidence=evidence,
            q14_acceptance_commit=Q14_ACCEPTANCE_COMMIT,
            q14_director_merge=Q14_DIRECTOR_MERGE,
        )
    with pytest.raises(ContractValueError, match="non-empty"):
        close_q10_waiting_q14(
            q10_dispositions=(),
            evidence=evidence,
            q14_acceptance_commit=Q14_ACCEPTANCE_COMMIT,
            q14_director_merge=Q14_DIRECTOR_MERGE,
        )


def test_adapters_hostile_types_and_cross_bindings_are_fail_closed() -> None:
    evidence = _evidence()
    bound = evidence.stress_evidence[0]
    with pytest.raises(ContractValueError, match="stress samples"):
        BoundClosureStressEvidenceV1(object(), bound.report)  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="stress report"):
        BoundClosureStressEvidenceV1(bound.samples, object())  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="research_samples"):
        replace(evidence, research_samples=object())  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="plan_samples"):
        replace(evidence, plan_samples=object())  # type: ignore[arg-type]

    rebound_plan_samples = SampleSetV1(
        "rebound-plan-authority:v1",
        evidence.plan_samples.posture,
        evidence.plan_samples.samples,
    )
    with pytest.raises(ContractValueError, match="exact plan sample set"):
        replace(evidence, plan_samples=rebound_plan_samples)

    with pytest.raises(ContractValueError, match="BoundClosureLeakageEvidenceV1"):
        replace(evidence, leakage_evidence=object())  # type: ignore[arg-type]

    leakage = evidence.leakage_evidence
    forged_plan = replace(
        leakage.matrix.plan,
        quarantined_sample_ids=(leakage.matrix.plan.folds[0].validation_sample_ids[0],),
    )
    foreign_matrix = _copy_matrix_with_plan(leakage.matrix, forged_plan)
    foreign_leakage = replace(leakage, matrix=foreign_matrix)
    with pytest.raises(ContractValueError, match="exact plan authority"):
        replace(evidence, leakage_evidence=foreign_leakage)

    class ForeignResearchLeakage(BoundClosureLeakageEvidenceV1):
        @property
        def assessment_sample_ids(self) -> tuple[str, ...]:
            return evidence.walk_forward_plan.holdout_sample_ids

    foreign_research = ForeignResearchLeakage(
        matrix=leakage.matrix,
        fitted_stack=leakage.fitted_stack,
        later_fold_ids=leakage.later_fold_ids,
        spec=leakage.spec,
        honest_assessment=leakage.honest_assessment,
        falsified_lineage_assessment=leakage.falsified_lineage_assessment,
        temporal_leak_assessment=leakage.temporal_leak_assessment,
    )
    with pytest.raises(ContractValueError, match="only exact research rows"):
        replace(evidence, leakage_evidence=foreign_research)

    rebound_samples = SampleSetV1(
        "rebound-plan-samples:v1",
        evidence.research_samples.posture,
        evidence.research_samples.samples,
    )
    with pytest.raises(ContractValueError, match="non-holdout/non-quarantined"):
        replace(evidence, research_samples=rebound_samples)

    replay_samples = SampleSetV1(
        "replay-stress:v1",
        EvidencePosture.REPLAY,
        bound.samples.samples,
    )
    replay_bound = BoundClosureStressEvidenceV1(
        replay_samples,
        run_cost_stress(replay_samples, bound.report.spec),
    )
    with pytest.raises(ContractValueError, match="evidence posture"):
        replace(
            evidence,
            stress_evidence=(replay_bound, *evidence.stress_evidence[1:]),
        )


def test_manifest_rejects_forged_digest_and_record_status() -> None:
    manifest = close_q10_waiting_q14(
        q10_dispositions=SECTION_14_BATTERY_DISPOSITIONS,
        evidence=_evidence(),
        q14_acceptance_commit=Q14_ACCEPTANCE_COMMIT,
        q14_director_merge=Q14_DIRECTOR_MERGE,
    )
    with pytest.raises(ContractValueError, match="immutable Q10 table"):
        replace(manifest, q10_disposition_digest=DigestV1("e" * 64))

    source = manifest.records[0]
    forged = object.__new__(ValidationClosureRecordV1)
    object.__setattr__(forged, "bullet_id", source.bullet_id)
    object.__setattr__(forged, "status", "FORGED")
    object.__setattr__(forged, "closure_apis", source.closure_apis)
    object.__setattr__(forged, "evidence_digest", source.evidence_digest)
    with pytest.raises(ContractValueError, match="status is not accepted"):
        replace(manifest, records=(forged, *manifest.records[1:]))


def test_close_rechecks_waiting_seam_even_after_digest_boundary(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    altered = list(SECTION_14_BATTERY_DISPOSITIONS)
    seam_index = next(
        index for index, item in enumerate(altered) if item.bullet_id == WAITING_Q14_IDS[0]
    )
    altered[seam_index] = replace(altered[seam_index], bullet_id="16-00-forged-waiting")
    monkeypatch.setattr(
        adapters_module,
        "disposition_table_digest",
        lambda _records: DigestV1(adapters_module.Q10_DISPOSITION_DIGEST),
    )
    with pytest.raises(ContractValueError, match="WAITING_Q14 records"):
        close_q10_waiting_q14(
            q10_dispositions=tuple(altered),
            evidence=_evidence(),
            q14_acceptance_commit=Q14_ACCEPTANCE_COMMIT,
            q14_director_merge=Q14_DIRECTOR_MERGE,
        )
    with pytest.raises(ContractValueError, match="ValidationClosureEvidenceV1"):
        close_q10_waiting_q14(
            q10_dispositions=SECTION_14_BATTERY_DISPOSITIONS,
            evidence=object(),  # type: ignore[arg-type]
            q14_acceptance_commit=Q14_ACCEPTANCE_COMMIT,
            q14_director_merge=Q14_DIRECTOR_MERGE,
        )
