from __future__ import annotations

from collections.abc import Callable
from dataclasses import replace
from fractions import Fraction
from typing import Any, cast

import pytest

import quant_edge.ensemble.calibration as calibration_module
import quant_edge.ensemble.stacking as stacking_module
from quant_edge.ensemble import (
    BoundCalibratedAssessmentV1,
    CalibrationComparisonV1,
    CalibrationMethod,
    CalibrationSpecV1,
    CalibrationStatus,
    OofFoldPredictionBundleV1,
    ReliabilityCellV1,
    StackingSpecV1,
    apply_calibrator,
    bind_calibrated_assessment,
    compare_calibrators,
    evaluate_calibrator,
    fit_calibrator,
    fit_oof_stacker,
    stack_predictions_for_folds,
    validate_oof_bundles,
)
from quant_edge.ensemble.calibration import CalibratorV1
from quant_edge.ensemble.regime_mixture import (
    PER_REGIME_CALIBRATION_STATUS,
    RegimeMixtureSpecV1,
    RegimeMixtureStatus,
    RegimeSpecialistV1,
    RegimeWeightsV1,
    RegimeWeightV1,
    mix_regime_specialists,
)
from quant_edge.ensemble.stacking import FittedStackV1, ValidatedOofMatrixV1
from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import FIXED_POINT_SCALE, FixedPointV1
from quant_edge.labels.rational import ExactRatioV1, make_ratio
from quant_edge.lake.contracts import DigestV1, EvidencePosture, QualityState
from quant_edge.models.contracts import ProbabilitySemantics
from quant_edge.validation import (
    PredictionSetV1,
    PredictionV1,
    SampleSetV1,
    ValidationSampleV1,
    WalkForwardPlanV1,
    WalkForwardSpecV1,
    build_walk_forward_plan,
    subset_by_ids,
)
from quant_edge.validation.splits import SplitScheme

BASE = 1_700_000_000_000_000_000
TARGET = "binary-target:v1"
SPECIALISTS = ("specialist-a:v1", "specialist-b:v1")
SPEC = CalibrationSpecV1(6, 3, (4, 8))


def _mixture_spec(*, disagreement: ExactRatioV1 | None = None) -> RegimeMixtureSpecV1:
    return RegimeMixtureSpecV1(
        fallback_probability=make_ratio(1, 5),
        disagreement_threshold=(make_ratio(1, 5) if disagreement is None else disagreement),
        max_unseen_mass=make_ratio(1, 5),
        min_specialist_support=10,
    )


class TestSoftRegimeSpecialistMixture:
    def test_soft_probabilities_mix_specialists_exactly(self) -> None:
        weights = RegimeWeightsV1(
            (
                RegimeWeightV1("CALM", make_ratio(3, 4)),
                RegimeWeightV1("WILD", make_ratio(1, 4)),
            )
        )
        specialists = (
            RegimeSpecialistV1("CALM", make_ratio(4, 5), 100),
            RegimeSpecialistV1("WILD", make_ratio(2, 5), 100),
        )

        result = mix_regime_specialists(weights, specialists, spec=_mixture_spec())

        assert result.status is RegimeMixtureStatus.MIXED_RESEARCH_ONLY
        assert result.final_probability == make_ratio(7, 10)
        assert result.raw_mixture_probability == make_ratio(7, 10)
        assert result.disagreement == make_ratio(3, 20)
        assert result.unseen_mass == make_ratio(0, 1)

    def test_excess_specialist_disagreement_uses_conservative_fallback(self) -> None:
        weights = RegimeWeightsV1(
            (
                RegimeWeightV1("CALM", make_ratio(3, 4)),
                RegimeWeightV1("WILD", make_ratio(1, 4)),
            )
        )
        specialists = (
            RegimeSpecialistV1("CALM", make_ratio(4, 5), 100),
            RegimeSpecialistV1("WILD", make_ratio(2, 5), 100),
        )

        result = mix_regime_specialists(
            weights, specialists, spec=_mixture_spec(disagreement=make_ratio(1, 10))
        )

        assert result.status is RegimeMixtureStatus.FALLBACK_DISAGREEMENT
        assert result.final_probability == make_ratio(1, 5)
        assert result.raw_mixture_probability == make_ratio(7, 10)
        assert result.reason == "SPECIALIST_DISAGREEMENT_EXCEEDS_BOUND"

    def test_small_unseen_mass_is_blended_only_with_declared_fallback(self) -> None:
        weights = RegimeWeightsV1(
            (
                RegimeWeightV1("CALM", make_ratio(9, 10)),
                RegimeWeightV1("NEW", make_ratio(1, 10)),
            )
        )

        result = mix_regime_specialists(
            weights,
            (RegimeSpecialistV1("CALM", make_ratio(4, 5), 100),),
            spec=_mixture_spec(),
        )

        assert result.status is RegimeMixtureStatus.MIXED_WITH_UNSEEN_FALLBACK
        assert result.final_probability == make_ratio(37, 50)
        assert result.unseen_mass == make_ratio(1, 10)
        assert result.substituted_regimes == ("NEW",)

    def test_large_unseen_mass_forces_whole_assessment_fallback(self) -> None:
        weights = RegimeWeightsV1(
            (
                RegimeWeightV1("CALM", make_ratio(3, 5)),
                RegimeWeightV1("NEW", make_ratio(2, 5)),
            )
        )

        result = mix_regime_specialists(
            weights,
            (RegimeSpecialistV1("CALM", make_ratio(4, 5), 100),),
            spec=_mixture_spec(),
        )

        assert result.status is RegimeMixtureStatus.FALLBACK_UNSEEN_REGIME
        assert result.final_probability == make_ratio(1, 5)
        assert result.raw_mixture_probability is None
        assert result.reason == "UNSEEN_REGIME_MASS_EXCEEDS_BOUND"

    def test_real_per_regime_calibration_remains_blocked_by_q13(self) -> None:
        weights = RegimeWeightsV1(
            (
                RegimeWeightV1("CALM", make_ratio(1, 2)),
                RegimeWeightV1("WILD", make_ratio(1, 2)),
            )
        )
        specialists = (
            RegimeSpecialistV1("CALM", make_ratio(3, 5), 100),
            RegimeSpecialistV1("WILD", make_ratio(2, 5), 100),
        )

        result = mix_regime_specialists(weights, specialists, spec=_mixture_spec())

        assert result.calibration_status == PER_REGIME_CALIBRATION_STATUS
        assert "BLOCKED_DATA" in result.calibration_status
        assert "Q13_REAL_EVIDENCE_INSUFFICIENT" in result.calibration_status

    def test_probability_sum_order_support_and_determinism_are_enforced(self) -> None:
        with pytest.raises(ContractValueError, match="sum exactly to one"):
            RegimeWeightsV1(
                (
                    RegimeWeightV1("CALM", make_ratio(1, 4)),
                    RegimeWeightV1("WILD", make_ratio(1, 4)),
                )
            )
        weights = RegimeWeightsV1(
            (
                RegimeWeightV1("CALM", make_ratio(1, 2)),
                RegimeWeightV1("WILD", make_ratio(1, 2)),
            )
        )
        low_support = (
            RegimeSpecialistV1("CALM", make_ratio(3, 5), 1),
            RegimeSpecialistV1("WILD", make_ratio(2, 5), 1),
        )
        first = mix_regime_specialists(weights, low_support, spec=_mixture_spec())

        assert first == mix_regime_specialists(weights, low_support, spec=_mixture_spec())
        assert first.status is RegimeMixtureStatus.FALLBACK_UNSEEN_REGIME
        with pytest.raises(ContractValueError, match="sorted and unique"):
            mix_regime_specialists(weights, tuple(reversed(low_support)), spec=_mixture_spec())


def _samples(count: int = 72) -> SampleSetV1:
    return SampleSetV1(
        "q12-unit:v1",
        EvidencePosture.SYNTHETIC,
        tuple(
            ValidationSampleV1(
                sample_id=f"sample-{index:04d}",
                symbol=f"SYNTH-{index % 4}",
                group_id=f"event-{index:04d}",
                cutoff_ns=BASE + index * 100,
                label_end_ns=BASE + index * 100 + 10,
                strata=(("regime", f"r-{index % 2}"),),
                binary_outcome=((index * 37 + 11) % 101) >= 50,
                gross_edge_ratio=make_ratio(3, 1_000),
                base_cost_ratio=make_ratio(1, 1_000),
                quality=QualityState.SYNTHETIC,
            )
            for index in range(count)
        ),
    )


def _plan(samples: SampleSetV1) -> WalkForwardPlanV1:
    return build_walk_forward_plan(
        samples,
        WalkForwardSpecV1(
            scheme=SplitScheme.EXPANDING,
            fold_count=4,
            max_label_horizon_ns=10,
            max_feature_lookback_ns=5,
            embargo_ns=15,
            min_train_size=6,
            holdout_fraction=make_ratio(1, 6),
            rolling_train_size=None,
        ),
    )


def _score(specialist: str, sample_id: str) -> ExactRatioV1:
    index = int(sample_id.rsplit("-", maxsplit=1)[1])
    latent = (index * 37 + 11) % 101
    numerator = 20 + latent * (9 if specialist.endswith("a:v1") else 7)
    if specialist.endswith("b:v1"):
        numerator += (index % 3 - 1) * 40
    return make_ratio(min(max(numerator, 0), 1_000), 1_000)


def _bundles(
    samples: SampleSetV1, plan: WalkForwardPlanV1
) -> tuple[OofFoldPredictionBundleV1, ...]:
    built: list[OofFoldPredictionBundleV1] = []
    for fold in plan.folds:
        subset = subset_by_ids(samples, fold.validation_sample_ids)
        for specialist in SPECIALISTS:
            built.append(
                OofFoldPredictionBundleV1(
                    specialist_id=specialist,
                    target_id=TARGET,
                    horizon_ns=10,
                    probability_semantics=ProbabilitySemantics.UNCALIBRATED_SCORE,
                    fold_id=fold.fold_id,
                    train_sample_ids=fold.train_sample_ids,
                    predictions=PredictionSetV1(
                        model_id=specialist,
                        dataset_digest=subset.digest(),
                        predictions=tuple(
                            PredictionV1(
                                sample.sample_id,
                                _score(specialist, sample.sample_id),
                                sample.cutoff_ns,
                            )
                            for sample in sorted(subset.samples, key=lambda item: item.sample_id)
                        ),
                    ),
                )
            )
    return tuple(built)


def _matrix() -> tuple[SampleSetV1, WalkForwardPlanV1, ValidatedOofMatrixV1]:
    samples = _samples()
    plan = _plan(samples)
    return (
        samples,
        plan,
        validate_oof_bundles(
            samples=samples,
            plan=plan,
            target_id=TARGET,
            horizon_ns=10,
            specialist_ids=SPECIALISTS,
            bundles=_bundles(samples, plan),
        ),
    )


def _fitted() -> tuple[SampleSetV1, WalkForwardPlanV1, ValidatedOofMatrixV1, FittedStackV1]:
    samples, plan, matrix = _matrix()
    fitted = fit_oof_stacker(
        samples=samples,
        matrix=matrix,
        spec=StackingSpecV1(matrix.fold_ids[:1], matrix.fold_ids[1:2], 8),
        stack_id="unit-stack:v1",
    )
    return samples, plan, matrix, fitted


def _rebind_matrix_samples(
    matrix: ValidatedOofMatrixV1,
    samples: SampleSetV1,
) -> ValidatedOofMatrixV1:
    plan = replace(matrix.plan, dataset_digest=samples.digest())
    folds = {fold.fold_id: fold for fold in plan.folds}
    bundles = tuple(
        replace(
            bundle,
            predictions=replace(
                bundle.predictions,
                dataset_digest=subset_by_ids(
                    samples, folds[bundle.fold_id].validation_sample_ids
                ).digest(),
            ),
        )
        for bundle in matrix.bundles
    )
    return replace(
        matrix,
        plan_digest=plan.digest(),
        dataset_digest=samples.digest(),
        bundles=bundles,
        samples=samples,
        plan=plan,
    )


def _slices() -> tuple[
    SampleSetV1,
    ValidatedOofMatrixV1,
    FittedStackV1,
    SampleSetV1,
    PredictionSetV1,
    SampleSetV1,
    PredictionSetV1,
]:
    samples, _, matrix, fitted = _fitted()
    evaluation = stack_predictions_for_folds(
        samples=samples,
        matrix=matrix,
        fitted=fitted,
        fold_ids=matrix.fold_ids[2:3],
    )
    application = stack_predictions_for_folds(
        samples=samples,
        matrix=matrix,
        fitted=fitted,
        fold_ids=matrix.fold_ids[3:4],
    )
    return samples, matrix, fitted, *evaluation, *application


def _models() -> tuple[
    SampleSetV1,
    ValidatedOofMatrixV1,
    FittedStackV1,
    SampleSetV1,
    PredictionSetV1,
    SampleSetV1,
    PredictionSetV1,
    tuple[CalibratorV1, ...],
]:
    samples, matrix, fitted, eval_samples, eval_predictions, app_samples, app_predictions = (
        _slices()
    )
    models = tuple(
        fit_calibrator(
            method=method,
            samples=samples,
            matrix=matrix,
            fitted=fitted,
            spec=SPEC,
        )
        for method in CalibrationMethod
    )
    return (
        samples,
        matrix,
        fitted,
        eval_samples,
        eval_predictions,
        app_samples,
        app_predictions,
        models,
    )


def _bound_assessment() -> BoundCalibratedAssessmentV1:
    samples, matrix, fitted, *_ = _models()
    calibrator, comparison = compare_calibrators(
        samples=samples,
        matrix=matrix,
        fitted=fitted,
        evaluation_fold_ids=matrix.fold_ids[2:3],
        spec=SPEC,
    )
    evaluation = next(item for item in comparison.evaluations if item.method is calibrator.method)
    assessment_sample_id = (
        matrix.bundle(matrix.fold_ids[3], matrix.specialist_ids[0])
        .predictions.predictions[0]
        .sample_id
    )
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


def test_oof_matrix_stacker_and_bound_prediction_identity() -> None:
    samples, plan, matrix, fitted = _fitted()
    assert matrix.plan_digest == plan.digest()
    assert matrix.dataset_digest == samples.digest()
    assert matrix.bundle("fold-01", SPECIALISTS[0]).fold_id == "fold-01"
    assert matrix.as_mapping()["schema"] == "Q12ValidatedOofMatrixV1"
    assert fitted.calibration_fold_ids == matrix.fold_ids[1:2]
    assert fitted.weight_divisions == 8
    assert sum(Fraction(weight.numerator, weight.denominator) for _, weight in fitted.weights) == 1
    assert fitted.as_mapping()["calibrationFoldIds"] == list(matrix.fold_ids[1:2])
    assert len(fitted.digest().hexdigest) == 64
    later_samples, later_predictions = stack_predictions_for_folds(
        samples=samples,
        matrix=matrix,
        fitted=fitted,
        fold_ids=matrix.fold_ids[2:3],
    )
    assert later_predictions.dataset_digest == later_samples.digest()
    assert f"fit-{fitted.digest().hexdigest[:16]}" in later_predictions.model_id
    assert all(
        0 <= row.score.numerator <= row.score.denominator for row in later_predictions.predictions
    )


def test_oof_validation_rejects_global_overlap_and_bundle_substitution() -> None:
    samples, plan, matrix = _matrix()
    first, second = plan.folds[:2]
    overlapping = replace(
        plan,
        folds=(
            first,
            replace(
                second,
                validation_sample_ids=(
                    first.validation_sample_ids[0],
                    *second.validation_sample_ids[1:],
                ),
            ),
            *plan.folds[2:],
        ),
    )
    with pytest.raises(ContractValueError, match="exactly once"):
        validate_oof_bundles(
            samples=samples,
            plan=overlapping,
            target_id=TARGET,
            horizon_ns=10,
            specialist_ids=SPECIALISTS,
            bundles=matrix.bundles,
        )
    with pytest.raises(ContractValueError, match="cover every"):
        validate_oof_bundles(
            samples=samples,
            plan=plan,
            target_id=TARGET,
            horizon_ns=10,
            specialist_ids=SPECIALISTS,
            bundles=matrix.bundles[:-1],
        )
    with pytest.raises(ContractValueError, match="target or horizon"):
        validate_oof_bundles(
            samples=samples,
            plan=plan,
            target_id=TARGET,
            horizon_ns=10,
            specialist_ids=SPECIALISTS,
            bundles=(replace(matrix.bundles[0], target_id="other-target:v1"), *matrix.bundles[1:]),
        )


def test_oof_validation_rejects_membership_digest_lineage_and_forbidden_rows() -> None:
    samples, plan, matrix = _matrix()
    bundle = matrix.bundles[0]

    def validate(
        changed: OofFoldPredictionBundleV1, changed_plan: WalkForwardPlanV1 = plan
    ) -> None:
        validate_oof_bundles(
            samples=samples,
            plan=changed_plan,
            target_id=TARGET,
            horizon_ns=10,
            specialist_ids=SPECIALISTS,
            bundles=(changed, *matrix.bundles[1:]),
        )

    with pytest.raises(ContractValueError, match="train ids"):
        validate(replace(bundle, train_sample_ids=bundle.train_sample_ids[:-1]))
    with pytest.raises(ContractValueError, match="exactly cover"):
        validate(
            replace(
                bundle,
                predictions=replace(
                    bundle.predictions, predictions=bundle.predictions.predictions[:-1]
                ),
            )
        )
    with pytest.raises(ContractValueError, match="exact fold"):
        validate(
            replace(
                bundle, predictions=replace(bundle.predictions, dataset_digest=DigestV1("0" * 64))
            )
        )
    prediction = bundle.predictions.predictions[0]
    late = replace(
        prediction, max_feature_asof_ns=samples.by_id(prediction.sample_id).cutoff_ns + 1
    )
    with pytest.raises(ContractValueError, match="after its cutoff"):
        validate(
            replace(
                bundle,
                predictions=replace(
                    bundle.predictions, predictions=(late, *bundle.predictions.predictions[1:])
                ),
            )
        )
    with pytest.raises(ContractValueError, match="specialist fitting"):
        validate(bundle, replace(plan, holdout_sample_ids=(bundle.train_sample_ids[0],)))
    with pytest.raises(ContractValueError, match="OOF predictions"):
        validate(bundle, replace(plan, holdout_sample_ids=(prediction.sample_id,)))


def test_stacking_specs_contracts_and_temporal_gates() -> None:
    samples, _, matrix, fitted = _fitted()
    with pytest.raises(ContractValueError):
        StackingSpecV1((), matrix.fold_ids[1:2], 8)
    with pytest.raises(ContractValueError):
        StackingSpecV1(matrix.fold_ids[:1], matrix.fold_ids[:1], 8)
    with pytest.raises(ContractValueError, match="strictly later"):
        fit_oof_stacker(
            samples=samples,
            matrix=matrix,
            spec=StackingSpecV1(matrix.fold_ids[1:2], matrix.fold_ids[:1], 8),
            stack_id="bad-stack:v1",
        )
    with pytest.raises(ContractValueError, match="later than meta"):
        stack_predictions_for_folds(
            samples=samples,
            matrix=matrix,
            fitted=fitted,
            fold_ids=matrix.fold_ids[:1],
        )
    with pytest.raises(ContractValueError, match="sorted"):
        stack_predictions_for_folds(
            samples=samples,
            matrix=matrix,
            fitted=fitted,
            fold_ids=(matrix.fold_ids[3], matrix.fold_ids[2]),
        )
    with pytest.raises(ContractValueError, match="weights must bind"):
        stack_predictions_for_folds(
            samples=samples,
            matrix=matrix,
            fitted=replace(
                fitted,
                weights=(("other-a:v1", make_ratio(1, 1)), ("other-b:v1", make_ratio(0, 1))),
            ),
            fold_ids=matrix.fold_ids[2:3],
        )
    forged_weights = tuple(
        (specialist_id, make_ratio(index, 1))
        for index, (specialist_id, _) in enumerate(fitted.weights)
    )
    with pytest.raises(ContractValueError, match="canonical OOF fit"):
        stack_predictions_for_folds(
            samples=samples,
            matrix=matrix,
            fitted=replace(fitted, weights=forged_weights),
            fold_ids=matrix.fold_ids[2:3],
        )


def test_direct_stacking_contracts_are_typed() -> None:
    samples, plan, matrix, fitted = _fitted()
    bundle = matrix.bundles[0]
    with pytest.raises(ContractValueError):
        replace(bundle, train_sample_ids=())
    with pytest.raises(ContractValueError):
        replace(bundle, predictions=replace(bundle.predictions, model_id="other:v1"))
    with pytest.raises(ContractValueError):
        replace(matrix, specialist_ids=("only",))
    with pytest.raises(ContractValueError):
        matrix.bundle("missing", "missing")
    with pytest.raises(ContractValueError):
        replace(
            fitted, weights=((SPECIALISTS[0], make_ratio(1, 2)), (SPECIALISTS[1], make_ratio(1, 4)))
        )
    with pytest.raises(ContractValueError):
        replace(fitted, calibration_fold_ids=fitted.meta_train_fold_ids)
    with pytest.raises(ContractValueError):
        replace(
            fitted,
            weight_divisions=3,
            weights=((SPECIALISTS[0], make_ratio(1, 2)), (SPECIALISTS[1], make_ratio(1, 2))),
        )
    with pytest.raises(ContractValueError):
        FittedStackV1(
            stack_id="bad:v1",
            matrix_digest=matrix.digest(),
            target_id=TARGET,
            horizon_ns=10,
            meta_train_fold_ids=(),
            calibration_fold_ids=matrix.fold_ids[1:2],
            weight_divisions=8,
            fit_label_end_ns=fitted.fit_label_end_ns,
            weights=fitted.weights,
            training_brier=make_ratio(1, 2),
        )
    with pytest.raises(ContractValueError):
        ValidatedOofMatrixV1(
            plan.digest(),
            samples.digest(),
            TARGET,
            10,
            SPECIALISTS,
            matrix.fold_ids,
            matrix.bundles[:-1],
            samples,
            plan,
        )


def test_remaining_stacking_constructor_and_public_boundaries_are_typed() -> None:
    samples, plan, matrix, fitted = _fitted()
    bundle = matrix.bundles[0]
    with pytest.raises(ContractValueError):
        stacking_module._require_probability(make_ratio(2, 1), field="x")
    with pytest.raises(ContractValueError):
        replace(bundle, train_sample_ids=(bundle.train_sample_ids[0],) * 2)
    with pytest.raises(ContractValueError):
        replace(bundle, predictions=cast(Any, "bad"))
    with pytest.raises(ContractValueError):
        replace(bundle, probability_semantics=cast(Any, "bad"))
    with pytest.raises(ContractValueError, match="non-probability"):
        replace(bundle, probability_semantics=ProbabilitySemantics.NOT_PROBABILITY)
    mixed = replace(bundle, probability_semantics=ProbabilitySemantics.CALIBRATED)
    with pytest.raises(ContractValueError, match="share probability semantics"):
        replace(matrix, bundles=(mixed, *matrix.bundles[1:]))
    matrix_changes: tuple[dict[str, Any], ...] = (
        {"plan_digest": "bad"},
        {"dataset_digest": "bad"},
        {"specialist_ids": [*SPECIALISTS]},
        {"specialist_ids": tuple(reversed(SPECIALISTS))},
        {"fold_ids": [*matrix.fold_ids]},
        {"fold_ids": ()},
        {"fold_ids": (matrix.fold_ids[0],) * 2},
        {"bundles": cast(Any, [*matrix.bundles])},
        {"bundles": cast(Any, ("bad",))},
    )
    for changes in matrix_changes:
        with pytest.raises(ContractValueError):
            replace(matrix, **changes)
    validation_id = bundle.predictions.predictions[0].sample_id
    forged_plan = replace(matrix.plan, holdout_sample_ids=(validation_id,))
    with pytest.raises(ContractValueError, match="holdout/quarantined"):
        replace(
            matrix,
            plan=forged_plan,
            plan_digest=forged_plan.digest(),
        )
    late_prediction = replace(
        bundle.predictions.predictions[0],
        max_feature_asof_ns=samples.by_id(validation_id).cutoff_ns + 1,
    )
    late_bundle = replace(
        bundle,
        predictions=replace(
            bundle.predictions,
            predictions=(late_prediction, *bundle.predictions.predictions[1:]),
        ),
    )
    with pytest.raises(ContractValueError, match="feature cannot follow"):
        replace(matrix, bundles=(late_bundle, *matrix.bundles[1:]))
    with pytest.raises(ContractValueError, match="samples must"):
        replace(matrix, samples=cast(Any, "bad"))
    with pytest.raises(ContractValueError, match="plan must"):
        replace(matrix, plan=cast(Any, "bad"))
    wrong_dataset_plan = replace(matrix.plan, dataset_digest=DigestV1("9" * 64))
    with pytest.raises(ContractValueError, match="plan must bind"):
        replace(
            matrix,
            plan=wrong_dataset_plan,
            plan_digest=wrong_dataset_plan.digest(),
        )
    missing_fold_plan = replace(matrix.plan, folds=matrix.plan.folds[:-1])
    with pytest.raises(ContractValueError, match="folds must equal"):
        replace(
            matrix,
            plan=missing_fold_plan,
            plan_digest=missing_fold_plan.digest(),
        )
    first_fold, second_fold = matrix.plan.folds[:2]
    overlap_plan = replace(
        matrix.plan,
        folds=(
            first_fold,
            replace(
                second_fold,
                validation_sample_ids=(
                    first_fold.validation_sample_ids[0],
                    *second_fold.validation_sample_ids[1:],
                ),
            ),
            *matrix.plan.folds[2:],
        ),
    )
    with pytest.raises(ContractValueError, match="exactly once"):
        replace(matrix, plan=overlap_plan, plan_digest=overlap_plan.digest())
    wrong_target_bundle = replace(bundle, target_id="other-target:v1")
    with pytest.raises(ContractValueError, match="target or horizon"):
        replace(matrix, bundles=(wrong_target_bundle, *matrix.bundles[1:]))
    wrong_train_bundle = replace(bundle, train_sample_ids=bundle.train_sample_ids[:-1])
    with pytest.raises(ContractValueError, match="train ids"):
        replace(matrix, bundles=(wrong_train_bundle, *matrix.bundles[1:]))
    missing_prediction_bundle = replace(
        bundle,
        predictions=replace(
            bundle.predictions,
            predictions=bundle.predictions.predictions[:-1],
        ),
    )
    with pytest.raises(ContractValueError, match="predictions must equal"):
        replace(matrix, bundles=(missing_prediction_bundle, *matrix.bundles[1:]))
    wrong_subset_bundle = replace(
        bundle,
        predictions=replace(bundle.predictions, dataset_digest=DigestV1("a" * 64)),
    )
    with pytest.raises(ContractValueError, match="exact fold subset"):
        replace(matrix, bundles=(wrong_subset_bundle, *matrix.bundles[1:]))
    raw_horizon_samples = SampleSetV1(
        "raw-horizon-forgery:v1",
        samples.posture,
        tuple(
            replace(sample, label_end_ns=sample.label_end_ns + 1)
            if sample.sample_id == validation_id
            else sample
            for sample in samples.samples
        ),
    )
    with pytest.raises(ContractValueError, match="sample horizon"):
        _rebind_matrix_samples(matrix, raw_horizon_samples)
    calls: tuple[Callable[[], object], ...] = (
        lambda: validate_oof_bundles(
            samples=cast(Any, "bad"),
            plan=plan,
            target_id=TARGET,
            horizon_ns=10,
            specialist_ids=SPECIALISTS,
            bundles=matrix.bundles,
        ),
        lambda: validate_oof_bundles(
            samples=samples,
            plan=replace(plan, status=cast(Any, "bad")),
            target_id=TARGET,
            horizon_ns=10,
            specialist_ids=SPECIALISTS,
            bundles=matrix.bundles,
        ),
        lambda: validate_oof_bundles(
            samples=samples,
            plan=replace(plan, dataset_digest=DigestV1("4" * 64)),
            target_id=TARGET,
            horizon_ns=10,
            specialist_ids=SPECIALISTS,
            bundles=matrix.bundles,
        ),
        lambda: validate_oof_bundles(
            samples=samples,
            plan=plan,
            target_id=TARGET,
            horizon_ns=10,
            specialist_ids=cast(Any, [*SPECIALISTS]),
            bundles=matrix.bundles,
        ),
        lambda: validate_oof_bundles(
            samples=samples,
            plan=plan,
            target_id=TARGET,
            horizon_ns=10,
            specialist_ids=("only",),
            bundles=matrix.bundles,
        ),
        lambda: validate_oof_bundles(
            samples=samples,
            plan=plan,
            target_id=TARGET,
            horizon_ns=10,
            specialist_ids=tuple(reversed(SPECIALISTS)),
            bundles=matrix.bundles,
        ),
        lambda: validate_oof_bundles(
            samples=samples,
            plan=plan,
            target_id=TARGET,
            horizon_ns=10,
            specialist_ids=SPECIALISTS,
            bundles=cast(Any, [*matrix.bundles]),
        ),
        lambda: validate_oof_bundles(
            samples=samples,
            plan=replace(
                plan,
                folds=tuple(replace(fold, status=cast(Any, "bad")) for fold in plan.folds),
            ),
            target_id=TARGET,
            horizon_ns=10,
            specialist_ids=SPECIALISTS,
            bundles=matrix.bundles,
        ),
    )
    for invoke in calls:
        with pytest.raises(ContractValueError):
            invoke()
    with pytest.raises(ContractValueError):
        StackingSpecV1(cast(Any, [matrix.fold_ids[0]]), matrix.fold_ids[1:2], 8)
    with pytest.raises(ContractValueError):
        StackingSpecV1((matrix.fold_ids[0],) * 2, matrix.fold_ids[1:2], 8)
    with pytest.raises(ContractValueError):
        StackingSpecV1(matrix.fold_ids[:1], (matrix.fold_ids[1],) * 2, 8)
    fitted_changes: tuple[dict[str, Any], ...] = (
        {"matrix_digest": "bad"},
        {"meta_train_fold_ids": cast(Any, [matrix.fold_ids[0]])},
        {"meta_train_fold_ids": ()},
        {"meta_train_fold_ids": (matrix.fold_ids[0],) * 2},
        {"calibration_fold_ids": (matrix.fold_ids[1],) * 2},
        {"weights": cast(Any, [*fitted.weights])},
        {"weights": tuple(reversed(fitted.weights))},
        {"training_brier": make_ratio(2, 1)},
    )
    for changes in fitted_changes:
        with pytest.raises(ContractValueError):
            replace(fitted, **changes)


def test_remaining_stacker_fit_and_application_failures_are_typed() -> None:
    samples, _, matrix, fitted = _fitted()
    valid_spec = StackingSpecV1(matrix.fold_ids[:1], matrix.fold_ids[1:2], 8)
    fit_calls: tuple[Callable[[], object], ...] = (
        lambda: fit_oof_stacker(
            samples=cast(Any, "bad"), matrix=matrix, spec=valid_spec, stack_id="x:v1"
        ),
        lambda: fit_oof_stacker(
            samples=_samples(73), matrix=matrix, spec=valid_spec, stack_id="x:v1"
        ),
        lambda: fit_oof_stacker(
            samples=samples, matrix=cast(Any, "bad"), spec=valid_spec, stack_id="x:v1"
        ),
        lambda: fit_oof_stacker(
            samples=samples,
            matrix=replace(matrix, dataset_digest=DigestV1("5" * 64)),
            spec=valid_spec,
            stack_id="x:v1",
        ),
        lambda: fit_oof_stacker(
            samples=samples, matrix=matrix, spec=cast(Any, "bad"), stack_id="x:v1"
        ),
        lambda: fit_oof_stacker(
            samples=samples,
            matrix=matrix,
            spec=StackingSpecV1(("missing",), matrix.fold_ids[1:2], 8),
            stack_id="x:v1",
        ),
        lambda: fit_oof_stacker(
            samples=samples,
            matrix=matrix,
            spec=StackingSpecV1(matrix.fold_ids[:1], ("missing",), 8),
            stack_id="x:v1",
        ),
    )
    for invoke_fit in fit_calls:
        with pytest.raises(ContractValueError):
            invoke_fit()
    meta_id = matrix.bundle(matrix.fold_ids[0], SPECIALISTS[0]).predictions.predictions[0].sample_id
    unknown_samples = SampleSetV1(
        "unknown-meta:v1",
        samples.posture,
        tuple(
            replace(sample, binary_outcome=None) if sample.sample_id == meta_id else sample
            for sample in samples.samples
        ),
    )
    with pytest.raises(ContractValueError, match="known binary"):
        fit_oof_stacker(
            samples=unknown_samples,
            matrix=_rebind_matrix_samples(matrix, unknown_samples),
            spec=valid_spec,
            stack_id="x:v1",
        )
    app_calls: tuple[Callable[[], object], ...] = (
        lambda: stack_predictions_for_folds(
            samples=cast(Any, "bad"), matrix=matrix, fitted=fitted, fold_ids=matrix.fold_ids[2:3]
        ),
        lambda: stack_predictions_for_folds(
            samples=samples,
            matrix=cast(Any, "bad"),
            fitted=fitted,
            fold_ids=matrix.fold_ids[2:3],
        ),
        lambda: stack_predictions_for_folds(
            samples=samples,
            matrix=matrix,
            fitted=cast(Any, "bad"),
            fold_ids=matrix.fold_ids[2:3],
        ),
        lambda: stack_predictions_for_folds(
            samples=samples,
            matrix=matrix,
            fitted=replace(fitted, matrix_digest=DigestV1("6" * 64)),
            fold_ids=matrix.fold_ids[2:3],
        ),
        lambda: stack_predictions_for_folds(
            samples=samples,
            matrix=matrix,
            fitted=replace(fitted, target_id="other:v1"),
            fold_ids=matrix.fold_ids[2:3],
        ),
        lambda: stack_predictions_for_folds(
            samples=samples,
            matrix=matrix,
            fitted=fitted,
            fold_ids=cast(Any, [matrix.fold_ids[2]]),
        ),
        lambda: stack_predictions_for_folds(
            samples=samples, matrix=matrix, fitted=fitted, fold_ids=("missing",)
        ),
    )
    for invoke_application in app_calls:
        with pytest.raises(ContractValueError):
            invoke_application()


def test_both_calibrators_comparison_evaluation_and_application() -> None:
    (
        samples,
        matrix,
        fitted,
        eval_samples,
        _eval_predictions,
        _app_samples,
        _app_predictions,
        models,
    ) = _models()
    assert all(model.status is CalibrationStatus.AVAILABLE for model in models)
    for model in models:
        assert model.target_id == matrix.target_id
        assert model.matrix_digest == matrix.digest()
        assert model.stack_digest == fitted.digest()
        assert model.calibration_fold_ids == fitted.calibration_fold_ids
        assert model.spec == SPEC
        assert model.support_classes == (0, 1)
        evaluation = evaluate_calibrator(
            model=model,
            samples=samples,
            matrix=matrix,
            fitted=fitted,
            evaluation_fold_ids=matrix.fold_ids[2:3],
        )
        assert evaluation.evaluation_fold_ids == matrix.fold_ids[2:3]
        assert evaluation.calibration_spec_digest == SPEC.digest()
        assert len(evaluation.digest().hexdigest) == 64
        assert all(
            sum(cell.support for cell in cells) == len(eval_samples.samples)
            for _, cells in evaluation.reliability
        )
        applied = apply_calibrator(
            model=model,
            evaluation=evaluation,
            samples=samples,
            matrix=matrix,
            fitted=fitted,
            application_fold_ids=matrix.fold_ids[3:4],
        )
        assert f"eval-{evaluation.digest().hexdigest[:16]}" in applied.model_id
        assert all(
            0 <= prediction.score.numerator <= prediction.score.denominator
            for prediction in applied.predictions
        )
    chosen, comparison = compare_calibrators(
        samples=samples,
        matrix=matrix,
        fitted=fitted,
        evaluation_fold_ids=matrix.fold_ids[2:3],
        spec=SPEC,
    )
    assert comparison.chosen_method is chosen.method
    assert comparison.as_mapping()["schema"] == "Q12CalibrationComparisonV1"


def test_bound_calibrated_assessment_recomputes_full_fold_and_one_row_projection() -> None:
    bound = _bound_assessment()
    assert bound.assessment_samples.sample_ids == (bound.assessment_sample_id,)
    assert bound.calibrated_predictions.dataset_digest == bound.assessment_samples.digest()
    assert bound.application_predictions.score_for(bound.assessment_sample_id).score == (
        bound.calibrated_probability
    )
    assert bound.assessment_fold_id in bound.application_fold_ids
    assert bound.as_mapping()["schema"] == "Q12BoundCalibratedAssessmentV1"
    assert len(bound.digest().hexdigest) == 64
    with pytest.raises(ContractValueError, match="full application fold"):
        replace(
            bound,
            application_predictions=replace(
                bound.application_predictions,
                model_id="forged-application:v1",
            ),
        )
    with pytest.raises(ContractValueError, match="one-row slice"):
        replace(
            bound,
            calibrated_predictions=replace(
                bound.calibrated_predictions,
                model_id="forged-assessment:v1",
            ),
        )
    with pytest.raises(ContractValueError, match="exactly one row"):
        replace(bound, assessment_samples=bound.application_samples)
    with pytest.raises(ContractValueError, match="bound application fold"):
        replace(bound, assessment_fold_id=bound.evaluation.evaluation_fold_ids[0])
    forged_evaluation = replace(
        bound.evaluation,
        log_loss=FixedPointV1(cast(FixedPointV1, bound.evaluation.log_loss).mantissa + 1),
    )
    with pytest.raises(ContractValueError, match="chosen canonical evaluation"):
        replace(bound, evaluation=forged_evaluation)
    forged_evaluations = tuple(
        replace(
            evaluation,
            log_loss=FixedPointV1(cast(FixedPointV1, evaluation.log_loss).mantissa + 1),
        )
        if evaluation.method is not bound.comparison.chosen_method
        else evaluation
        for evaluation in bound.comparison.evaluations
    )
    forged_comparison = replace(bound.comparison, evaluations=forged_evaluations)
    with pytest.raises(ContractValueError, match="canonical calibration comparison"):
        replace(
            bound,
            comparison=forged_comparison,
        )
    with pytest.raises(ContractValueError):
        bind_calibrated_assessment(
            samples=bound.samples,
            matrix=bound.matrix,
            fitted=bound.fitted,
            calibrator=bound.calibrator,
            comparison=bound.comparison,
            evaluation=bound.evaluation,
            application_fold_ids=bound.application_fold_ids,
            assessment_sample_id=bound.matrix.plan.holdout_sample_ids[0],
        )
    invalid_types: tuple[dict[str, Any], ...] = (
        {"samples": "bad"},
        {"matrix": "bad"},
        {"fitted": "bad"},
        {"calibrator": "bad"},
        {"comparison": "bad"},
        {"evaluation": "bad"},
        {"application_samples": "bad"},
        {"application_predictions": "bad"},
        {"assessment_samples": "bad"},
        {"calibrated_predictions": "bad"},
    )
    for changes in invalid_types:
        with pytest.raises(ContractValueError):
            replace(bound, **changes)


def test_calibration_fit_uses_exact_designated_fold_and_derives_identity() -> None:
    samples, matrix, fitted, *_ = _slices()
    model = fit_calibrator(
        method=CalibrationMethod.PLATT_CHRONOLOGICAL,
        samples=samples,
        matrix=matrix,
        fitted=fitted,
        spec=SPEC,
    )
    expected_samples, expected_predictions = stack_predictions_for_folds(
        samples=samples,
        matrix=matrix,
        fitted=fitted,
        fold_ids=fitted.calibration_fold_ids,
    )
    assert model.fit_dataset_digest == expected_samples.digest()
    assert model.fit_prediction_digest == expected_predictions.digest()
    assert model.source_model_id == expected_predictions.model_id
    assert model.target_id == TARGET
    with pytest.raises(ContractValueError, match="canonical OOF fit"):
        fit_calibrator(
            method=CalibrationMethod.PLATT_CHRONOLOGICAL,
            samples=samples,
            matrix=matrix,
            fitted=replace(fitted, matrix_digest=DigestV1("1" * 64)),
            spec=SPEC,
        )
    forged_weights = tuple(
        (specialist_id, make_ratio(0 if index == 0 else 1, 1))
        for index, (specialist_id, _) in enumerate(fitted.weights)
    )
    with pytest.raises(ContractValueError, match="canonical OOF fit"):
        fit_calibrator(
            method=CalibrationMethod.PLATT_CHRONOLOGICAL,
            samples=samples,
            matrix=matrix,
            fitted=replace(fitted, weights=forged_weights),
            spec=SPEC,
        )


def test_support_and_shape_failures_return_parameter_free_unknown(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    samples, matrix, fitted, *_ = _slices()
    insufficient = fit_calibrator(
        method=CalibrationMethod.PLATT_CHRONOLOGICAL,
        samples=samples,
        matrix=matrix,
        fitted=fitted,
        spec=CalibrationSpecV1(20, 3, (4,)),
    )
    assert insufficient.status is CalibrationStatus.UNKNOWN
    assert insufficient.reason == "INSUFFICIENT_CALIBRATION_SUPPORT"
    assert insufficient.coefficient is None
    assert insufficient.intercept is None
    monkeypatch.setattr(
        calibration_module,
        "_fit_isotonic",
        lambda rows: ((make_ratio(0, 1), make_ratio(1, 1)), (make_ratio(1, 2), make_ratio(1, 2))),
    )
    collapsed = fit_calibrator(
        method=CalibrationMethod.ISOTONIC_CHRONOLOGICAL,
        samples=samples,
        matrix=matrix,
        fitted=fitted,
        spec=SPEC,
    )
    assert collapsed.reason == "COLLAPSED_ISOTONIC_OUTPUT"
    assert not collapsed.thresholds
    assert not collapsed.values
    monkeypatch.setattr(
        calibration_module,
        "_fit_platt",
        lambda rows: (FixedPointV1(-1), FixedPointV1(0)),
    )
    descending = fit_calibrator(
        method=CalibrationMethod.PLATT_CHRONOLOGICAL,
        samples=samples,
        matrix=matrix,
        fitted=fitted,
        spec=SPEC,
    )
    assert descending.reason == "NON_MONOTONE_PLATT_CALIBRATION"
    assert descending.coefficient is None
    assert descending.intercept is None


def test_calibrator_structural_contract_rejects_forged_available_and_unknown_models() -> None:
    *_, models = _models()
    platt = next(model for model in models if model.method is CalibrationMethod.PLATT_CHRONOLOGICAL)
    isotonic = next(
        model for model in models if model.method is CalibrationMethod.ISOTONIC_CHRONOLOGICAL
    )
    invalid_changes: tuple[tuple[CalibratorV1, dict[str, Any]], ...] = (
        (platt, {"spec": cast(Any, "bad")}),
        (platt, {"support_classes": (0,)}),
        (platt, {"unique_score_count": 0}),
        (platt, {"coefficient": FixedPointV1(-1)}),
        (platt, {"thresholds": (make_ratio(1, 2),)}),
        (isotonic, {"values": tuple(make_ratio(1, 2) for _ in isotonic.values)}),
        (isotonic, {"coefficient": FixedPointV1(1)}),
    )
    for model, changes in invalid_changes:
        with pytest.raises(ContractValueError):
            replace(model, **changes)
    unknown = replace(
        platt,
        status=CalibrationStatus.UNKNOWN,
        reason="INSUFFICIENT_CALIBRATION_SUPPORT",
        coefficient=None,
        intercept=None,
    )
    with pytest.raises(ContractValueError, match="forbids numeric"):
        replace(unknown, coefficient=FixedPointV1(1))
    unknown_isotonic = replace(
        isotonic,
        status=CalibrationStatus.UNKNOWN,
        reason="COLLAPSED_ISOTONIC_OUTPUT",
        thresholds=(),
        values=(),
    )
    with pytest.raises(ContractValueError, match="forbids numeric"):
        replace(unknown_isotonic, thresholds=(make_ratio(1, 2),), values=(make_ratio(1, 2),))


def test_evaluation_and_application_require_exact_coverage_matching_and_maturity() -> None:
    samples, matrix, fitted, _, _, _, _, models = _models()
    model = next(model for model in models if model.method is CalibrationMethod.PLATT_CHRONOLOGICAL)
    evaluation = evaluate_calibrator(
        model=model,
        samples=samples,
        matrix=matrix,
        fitted=fitted,
        evaluation_fold_ids=matrix.fold_ids[2:3],
    )
    forged_model = replace(
        model,
        coefficient=FixedPointV1(cast(FixedPointV1, model.coefficient).mantissa + 1),
    )
    with pytest.raises(ContractValueError, match="canonical calibration fit"):
        evaluate_calibrator(
            model=forged_model,
            samples=samples,
            matrix=matrix,
            fitted=fitted,
            evaluation_fold_ids=matrix.fold_ids[2:3],
        )
    with pytest.raises(ContractValueError, match="canonical calibration fit"):
        apply_calibrator(
            model=forged_model,
            evaluation=evaluation,
            samples=samples,
            matrix=matrix,
            fitted=fitted,
            application_fold_ids=matrix.fold_ids[3:4],
        )
    with pytest.raises(ContractValueError, match="evaluation must"):
        apply_calibrator(
            model=model,
            evaluation=cast(Any, "bad"),
            samples=samples,
            matrix=matrix,
            fitted=fitted,
            application_fold_ids=matrix.fold_ids[3:4],
        )
    with pytest.raises(ContractValueError, match="bind"):
        apply_calibrator(
            model=model,
            evaluation=replace(evaluation, model_digest=DigestV1("2" * 64)),
            samples=samples,
            matrix=matrix,
            fitted=fitted,
            application_fold_ids=matrix.fold_ids[3:4],
        )
    forged_evaluation = replace(
        evaluation,
        log_loss=FixedPointV1(cast(FixedPointV1, evaluation.log_loss).mantissa + 1),
    )
    with pytest.raises(ContractValueError, match="canonical OOF fold evaluation"):
        apply_calibrator(
            model=model,
            evaluation=forged_evaluation,
            samples=samples,
            matrix=matrix,
            fitted=fitted,
            application_fold_ids=matrix.fold_ids[3:4],
        )
    with pytest.raises(ContractValueError, match="disjoint"):
        apply_calibrator(
            model=model,
            evaluation=evaluation,
            samples=samples,
            matrix=matrix,
            fitted=fitted,
            application_fold_ids=evaluation.evaluation_fold_ids,
        )
    with pytest.raises(ContractValueError, match="strictly later"):
        apply_calibrator(
            model=model,
            evaluation=evaluation,
            samples=samples,
            matrix=matrix,
            fitted=fitted,
            application_fold_ids=fitted.calibration_fold_ids,
        )
    with pytest.raises(ContractValueError, match="validated OOF matrix"):
        apply_calibrator(
            model=model,
            evaluation=evaluation,
            samples=samples,
            matrix=matrix,
            fitted=fitted,
            application_fold_ids=(matrix.plan.holdout_sample_ids[0],),
        )
    invalid_evaluation_folds: tuple[object, ...] = (
        [],
        (),
        (matrix.fold_ids[2], matrix.fold_ids[2]),
        (matrix.fold_ids[3], matrix.fold_ids[2]),
        ("missing-fold",),
        (matrix.plan.holdout_sample_ids[0],),
        fitted.calibration_fold_ids,
        fitted.meta_train_fold_ids,
    )
    for fold_ids in invalid_evaluation_folds:
        with pytest.raises(ContractValueError):
            evaluate_calibrator(
                model=model,
                samples=samples,
                matrix=matrix,
                fitted=fitted,
                evaluation_fold_ids=cast(Any, fold_ids),
            )
    with pytest.raises(ContractValueError, match="validated OOF matrix"):
        compare_calibrators(
            samples=samples,
            matrix=matrix,
            fitted=fitted,
            evaluation_fold_ids=(matrix.plan.holdout_sample_ids[0],),
            spec=SPEC,
        )
    invalid_application_folds: tuple[object, ...] = (
        [],
        (),
        (matrix.fold_ids[3], matrix.fold_ids[3]),
        ("missing-fold",),
    )
    for fold_ids in invalid_application_folds:
        with pytest.raises(ContractValueError):
            apply_calibrator(
                model=model,
                evaluation=evaluation,
                samples=samples,
                matrix=matrix,
                fitted=fitted,
                application_fold_ids=cast(Any, fold_ids),
            )


def test_evaluation_support_fails_closed_under_model_spec() -> None:
    samples, matrix, fitted, *_ = _models()
    evaluation_fold_ids = matrix.fold_ids[2:3]
    evaluation_ids = {
        prediction.sample_id
        for prediction in matrix.bundle(
            evaluation_fold_ids[0], SPECIALISTS[0]
        ).predictions.predictions
    }
    one_class_samples = SampleSetV1(
        "one-class-evaluation:v1",
        samples.posture,
        tuple(
            replace(sample, binary_outcome=True) if sample.sample_id in evaluation_ids else sample
            for sample in samples.samples
        ),
    )
    one_class_matrix = _rebind_matrix_samples(matrix, one_class_samples)
    one_class_fitted = fit_oof_stacker(
        samples=one_class_samples,
        matrix=one_class_matrix,
        spec=StackingSpecV1(
            fitted.meta_train_fold_ids,
            fitted.calibration_fold_ids,
            fitted.weight_divisions,
        ),
        stack_id=fitted.stack_id,
    )
    one_class_model = fit_calibrator(
        method=CalibrationMethod.PLATT_CHRONOLOGICAL,
        samples=one_class_samples,
        matrix=one_class_matrix,
        fitted=one_class_fitted,
        spec=SPEC,
    )
    with pytest.raises(ContractValueError, match="SINGLE_CLASS"):
        evaluate_calibrator(
            model=one_class_model,
            samples=one_class_samples,
            matrix=one_class_matrix,
            fitted=one_class_fitted,
            evaluation_fold_ids=evaluation_fold_ids,
        )
    constant_bundles = tuple(
        replace(
            bundle,
            predictions=replace(
                bundle.predictions,
                predictions=tuple(
                    replace(prediction, score=make_ratio(1, 2))
                    for prediction in bundle.predictions.predictions
                ),
            ),
        )
        if bundle.fold_id in evaluation_fold_ids
        else bundle
        for bundle in matrix.bundles
    )
    constant_matrix = replace(matrix, bundles=constant_bundles)
    constant_fitted = fit_oof_stacker(
        samples=samples,
        matrix=constant_matrix,
        spec=StackingSpecV1(
            fitted.meta_train_fold_ids,
            fitted.calibration_fold_ids,
            fitted.weight_divisions,
        ),
        stack_id=fitted.stack_id,
    )
    constant_model = fit_calibrator(
        method=CalibrationMethod.PLATT_CHRONOLOGICAL,
        samples=samples,
        matrix=constant_matrix,
        fitted=constant_fitted,
        spec=SPEC,
    )
    with pytest.raises(ContractValueError, match="UNIQUE"):
        evaluate_calibrator(
            model=constant_model,
            samples=samples,
            matrix=constant_matrix,
            fitted=constant_fitted,
            evaluation_fold_ids=evaluation_fold_ids,
        )
    wide_calibration_fitted = fit_oof_stacker(
        samples=samples,
        matrix=matrix,
        spec=StackingSpecV1(matrix.fold_ids[:1], matrix.fold_ids[1:3], 8),
        stack_id="wide-calibration:v1",
    )
    wide_model = fit_calibrator(
        method=CalibrationMethod.PLATT_CHRONOLOGICAL,
        samples=samples,
        matrix=matrix,
        fitted=wide_calibration_fitted,
        spec=CalibrationSpecV1(20, 3, (4,)),
    )
    with pytest.raises(ContractValueError, match="INSUFFICIENT_CALIBRATION_SUPPORT"):
        evaluate_calibrator(
            model=wide_model,
            samples=samples,
            matrix=matrix,
            fitted=wide_calibration_fitted,
            evaluation_fold_ids=matrix.fold_ids[3:4],
        )


def test_evaluation_reliability_and_comparison_contracts_recompute_truth() -> None:
    samples, matrix, fitted, _, _, _, _, models = _models()
    evaluations = tuple(
        sorted(
            (
                evaluate_calibrator(
                    model=model,
                    samples=samples,
                    matrix=matrix,
                    fitted=fitted,
                    evaluation_fold_ids=matrix.fold_ids[2:3],
                )
                for model in models
            ),
            key=lambda item: item.method.value,
        )
    )
    winner = min(
        evaluations,
        key=lambda item: (cast(FixedPointV1, item.brier).mantissa, item.method.value),
    ).method
    assert CalibrationComparisonV1(winner, evaluations).chosen_method is winner
    with pytest.raises(ContractValueError, match="exactly both"):
        CalibrationComparisonV1(evaluations[0].method, evaluations[:1])
    loser = next(method for method in CalibrationMethod if method is not winner)
    with pytest.raises(ContractValueError, match="recomputed"):
        CalibrationComparisonV1(loser, evaluations)
    with pytest.raises(ContractValueError, match="same slice"):
        CalibrationComparisonV1(
            winner,
            (evaluations[0], replace(evaluations[1], evaluation_start_ns=BASE)),
        )
    report = evaluations[0]
    cells = report.reliability[0][1]
    with pytest.raises(ContractValueError, match="sorted and unique"):
        replace(report, reliability=((4, tuple(reversed(cells))), *report.reliability[1:]))
    with pytest.raises(ContractValueError, match="support"):
        replace(
            report,
            reliability=(
                (4, (replace(cells[0], support=cells[0].support + 1), *cells[1:])),
                *report.reliability[1:],
            ),
        )
    with pytest.raises(ContractValueError, match="non-empty"):
        replace(report, reliability=((4, ()), *report.reliability[1:]))
    with pytest.raises(ContractValueError, match="bind spec"):
        replace(report, calibration_spec_digest=DigestV1("3" * 64))
    with pytest.raises(ContractValueError, match="sample-id count"):
        replace(report, support=report.support + 1)
    with pytest.raises(ContractValueError, match="both binary"):
        replace(report, support_classes=(0,))
    with pytest.raises(ContractValueError, match="jointly available"):
        replace(report, calibration_slope=None, calibration_intercept=FixedPointV1(0))
    narrow_spec = CalibrationSpecV1(6, 3, (4,))
    with pytest.raises(ContractValueError, match="bound calibration spec"):
        replace(report, spec=narrow_spec, calibration_spec_digest=narrow_spec.digest())


@pytest.mark.parametrize(
    "call",
    [
        lambda: calibration_module._require_probability(cast(Any, "bad"), field="x"),
        lambda: stacking_module._require_probability(cast(Any, "bad"), field="x"),
        lambda: fit_calibrator(
            method=cast(Any, "bad"),
            samples=cast(Any, "x"),
            matrix=cast(Any, "x"),
            fitted=cast(Any, "x"),
            spec=cast(Any, "x"),
        ),
        lambda: evaluate_calibrator(
            model=cast(Any, "bad"),
            samples=cast(Any, "x"),
            matrix=cast(Any, "x"),
            fitted=cast(Any, "x"),
            evaluation_fold_ids=cast(Any, "x"),
        ),
        lambda: apply_calibrator(
            model=cast(Any, "bad"),
            evaluation=cast(Any, "bad"),
            samples=cast(Any, "bad"),
            matrix=cast(Any, "bad"),
            fitted=cast(Any, "bad"),
            application_fold_ids=cast(Any, "bad"),
        ),
        lambda: compare_calibrators(
            samples=cast(Any, "bad"),
            matrix=cast(Any, "bad"),
            fitted=cast(Any, "bad"),
            evaluation_fold_ids=cast(Any, "bad"),
            spec=cast(Any, "bad"),
        ),
    ],
)
def test_public_type_failures_are_contract_errors(call: Any) -> None:
    with pytest.raises(ContractValueError):
        call()


def test_internal_calibration_helpers_are_bounded_and_exact() -> None:
    rows = (
        (Fraction(1, 10), 1),
        (Fraction(1, 10), 0),
        (Fraction(2, 10), 0),
        (Fraction(3, 10), 1),
    )
    thresholds, values = calibration_module._fit_isotonic(rows)
    assert thresholds
    assert values
    assert calibration_module._sigmoid(-1.0) < calibration_module._sigmoid(1.0)
    assert calibration_module._support_reason(rows[:3], SPEC) == "INSUFFICIENT_CALIBRATION_SUPPORT"
    assert (
        calibration_module._support_reason(((Fraction(1, 10), 1),) * 6, SPEC)
        == "SINGLE_CLASS_CALIBRATION_SUPPORT"
    )
    constant = tuple((Fraction(1, 2), index % 2) for index in range(6))
    assert (
        calibration_module._support_reason(constant, SPEC)
        == "INSUFFICIENT_UNIQUE_CALIBRATION_SCORES"
    )
    assert calibration_module._support_reason(rows * 2, CalibrationSpecV1(4, 2, (4,))) is None
    assert stacking_module._compositions(3, 1) == ((3,),)


def test_reliability_cell_and_spec_boundaries_are_typed() -> None:
    assert SPEC.as_mapping()["reliabilityBins"] == [4, 8]
    assert len(SPEC.digest().hexdigest) == 64
    with pytest.raises(ContractValueError):
        CalibrationSpecV1(3, 2, (4,))
    with pytest.raises(ContractValueError):
        CalibrationSpecV1(4, 2, (4, 4))
    with pytest.raises(ContractValueError):
        CalibrationSpecV1(4, 2, (1,))
    with pytest.raises(ContractValueError):
        CalibrationSpecV1(4, 2, cast(Any, [4]))
    with pytest.raises(ContractValueError):
        ReliabilityCellV1(0, 0, make_ratio(1, 2), make_ratio(1, 2))


def test_close_remaining_stacking_chronology_and_search_branches(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    samples, plan, matrix, fitted = _fitted()
    assert StackingSpecV1(matrix.fold_ids[:1], matrix.fold_ids[1:2], 8).as_mapping()
    validation_id = matrix.bundles[0].predictions.predictions[0].sample_id
    horizon_samples = SampleSetV1(
        "stack-horizon:v1",
        samples.posture,
        tuple(
            replace(sample, label_end_ns=sample.label_end_ns + 1)
            if sample.sample_id == validation_id
            else sample
            for sample in samples.samples
        ),
    )
    horizon_plan = replace(plan, dataset_digest=horizon_samples.digest())
    horizon_bundles = tuple(
        replace(
            bundle,
            predictions=replace(
                bundle.predictions,
                dataset_digest=subset_by_ids(
                    horizon_samples,
                    next(
                        fold.validation_sample_ids
                        for fold in horizon_plan.folds
                        if fold.fold_id == bundle.fold_id
                    ),
                ).digest(),
            ),
        )
        for bundle in matrix.bundles
    )
    with pytest.raises(ContractValueError, match="label horizon"):
        validate_oof_bundles(
            samples=horizon_samples,
            plan=horizon_plan,
            target_id=TARGET,
            horizon_ns=10,
            specialist_ids=SPECIALISTS,
            bundles=horizon_bundles,
        )

    def dense_cutoff(index: int) -> int:
        return BASE + index if index < 12 else BASE + 88 + index

    maturity_samples = SampleSetV1(
        "stack-maturity-dense:v1",
        samples.posture,
        tuple(
            replace(
                sample,
                cutoff_ns=dense_cutoff(index),
                label_end_ns=dense_cutoff(index) + 10,
            )
            for index, sample in enumerate(samples.samples)
        ),
    )
    maturity_plan = build_walk_forward_plan(
        maturity_samples,
        WalkForwardSpecV1(
            SplitScheme.EXPANDING,
            4,
            10,
            0,
            10,
            6,
            make_ratio(1, 6),
            None,
        ),
    )
    maturity_matrix = validate_oof_bundles(
        samples=maturity_samples,
        plan=maturity_plan,
        target_id=TARGET,
        horizon_ns=10,
        specialist_ids=SPECIALISTS,
        bundles=_bundles(maturity_samples, maturity_plan),
    )
    with pytest.raises(ContractValueError, match="labels mature"):
        fit_oof_stacker(
            samples=maturity_samples,
            matrix=maturity_matrix,
            spec=StackingSpecV1(maturity_matrix.fold_ids[:1], maturity_matrix.fold_ids[1:2], 8),
            stack_id="maturity:v1",
        )
    with pytest.raises(ContractValueError, match="fold partitions"):
        stack_predictions_for_folds(
            samples=samples,
            matrix=matrix,
            fitted=replace(fitted, calibration_fold_ids=("missing-fold",)),
            fold_ids=matrix.fold_ids[2:3],
        )
    application_cutoff = samples.by_id(
        matrix.bundle(matrix.fold_ids[2], SPECIALISTS[0]).predictions.predictions[0].sample_id
    ).cutoff_ns
    forged_maturity = replace(fitted, fit_label_end_ns=application_cutoff)
    with monkeypatch.context() as scoped:
        scoped.setattr(stacking_module, "fit_oof_stacker", lambda **kwargs: forged_maturity)
        with pytest.raises(ContractValueError, match="labels mature"):
            stack_predictions_for_folds(
                samples=samples,
                matrix=matrix,
                fitted=forged_maturity,
                fold_ids=matrix.fold_ids[2:3],
            )
    monkeypatch.setattr(
        stacking_module,
        "_compositions",
        lambda total, parts: ((total, 0), (total, 0)),
    )
    repeated = fit_oof_stacker(
        samples=samples,
        matrix=matrix,
        spec=StackingSpecV1(matrix.fold_ids[:1], matrix.fold_ids[1:2], 8),
        stack_id="repeat-grid:v1",
    )
    assert repeated.weights[0][1] == make_ratio(1, 1)


def test_close_remaining_calibrator_constructor_branches() -> None:
    *_, models = _models()
    platt = next(model for model in models if model.method is CalibrationMethod.PLATT_CHRONOLOGICAL)
    isotonic = next(
        model for model in models if model.method is CalibrationMethod.ISOTONIC_CHRONOLOGICAL
    )
    invalid: tuple[tuple[CalibratorV1, dict[str, Any]], ...] = (
        (platt, {"method": "bad"}),
        (platt, {"status": "bad"}),
        (platt, {"matrix_digest": "bad"}),
        (platt, {"calibration_fold_ids": ()}),
        (platt, {"calibration_fold_ids": (platt.calibration_fold_ids[0],) * 2}),
        (platt, {"support_classes": cast(Any, [0, 1])}),
        (platt, {"support_classes": (0, 2)}),
        (platt, {"reason": "UNEXPECTED_REASON"}),
        (
            platt,
            {
                "support": SPEC.min_support - 1,
                "unique_score_count": SPEC.min_unique_scores,
            },
        ),
        (platt, {"coefficient": None}),
        (isotonic, {"thresholds": isotonic.thresholds[:1], "values": isotonic.values[:1]}),
        (
            isotonic,
            {
                "thresholds": (make_ratio(1, 2), make_ratio(1, 2)),
                "values": (make_ratio(0, 1), make_ratio(1, 1)),
            },
        ),
        (
            isotonic,
            {
                "thresholds": (make_ratio(1, 3), make_ratio(2, 3)),
                "values": (make_ratio(1, 1), make_ratio(0, 1)),
            },
        ),
    )
    for model, changes in invalid:
        with pytest.raises(ContractValueError):
            replace(model, **changes)
    with pytest.raises(ContractValueError):
        replace(
            platt,
            status=CalibrationStatus.UNKNOWN,
            reason=None,
            coefficient=None,
            intercept=None,
        )


def test_close_remaining_calibration_input_and_slice_branches(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    (
        samples,
        matrix,
        fitted,
        eval_samples,
        eval_predictions,
        app_samples,
        app_predictions,
        models,
    ) = _models()
    model = next(model for model in models if model.method is CalibrationMethod.PLATT_CHRONOLOGICAL)
    with pytest.raises(ContractValueError):
        calibration_module._require_probability(make_ratio(2, 1), field="x")
    with pytest.raises(ContractValueError):
        calibration_module._fit_rows(cast(Any, "bad"), eval_predictions)
    with pytest.raises(ContractValueError, match="different sample"):
        calibration_module._fit_rows(
            eval_samples,
            replace(eval_predictions, dataset_digest=DigestV1("7" * 64)),
        )
    with pytest.raises(ContractValueError, match="exactly cover"):
        calibration_module._fit_rows(
            eval_samples,
            replace(eval_predictions, predictions=eval_predictions.predictions[:-1]),
        )
    unknown_samples = SampleSetV1(
        "unknown-eval:v1",
        eval_samples.posture,
        (replace(eval_samples.samples[0], binary_outcome=None), *eval_samples.samples[1:]),
    )
    with pytest.raises(ContractValueError, match="known binary"):
        calibration_module._fit_rows(
            unknown_samples,
            replace(eval_predictions, dataset_digest=unknown_samples.digest()),
        )
    out_of_range = replace(
        eval_predictions,
        predictions=(
            replace(eval_predictions.predictions[0], score=make_ratio(2, 1)),
            *eval_predictions.predictions[1:],
        ),
    )
    with pytest.raises(ContractValueError, match=r"\[0, 1\]"):
        calibration_module._fit_rows(eval_samples, out_of_range)
    late = replace(
        eval_predictions,
        predictions=(
            replace(
                eval_predictions.predictions[0],
                max_feature_asof_ns=eval_samples.samples[0].cutoff_ns + 1,
            ),
            *eval_predictions.predictions[1:],
        ),
    )
    with pytest.raises(ContractValueError, match="after cutoff"):
        calibration_module._fit_rows(eval_samples, late)
    slice_calls: tuple[Callable[[], object], ...] = (
        lambda: calibration_module._calibration_slice(cast(Any, "bad"), matrix, fitted),
        lambda: calibration_module._calibration_slice(samples, cast(Any, "bad"), fitted),
        lambda: calibration_module._calibration_slice(samples, matrix, cast(Any, "bad")),
        lambda: calibration_module._calibration_slice(_samples(73), matrix, fitted),
        lambda: calibration_module._calibration_slice(
            samples, matrix, replace(fitted, target_id="other:v1")
        ),
        lambda: calibration_module._calibration_slice(
            samples, matrix, replace(fitted, calibration_fold_ids=("missing",))
        ),
    )
    for invoke in slice_calls:
        with pytest.raises(ContractValueError):
            invoke()
    with pytest.raises(ContractValueError):
        fit_calibrator(
            method=CalibrationMethod.PLATT_CHRONOLOGICAL,
            samples=samples,
            matrix=matrix,
            fitted=fitted,
            spec=cast(Any, "bad"),
        )
    fit_samples, fit_predictions = stack_predictions_for_folds(
        samples=samples,
        matrix=matrix,
        fitted=fitted,
        fold_ids=fitted.calibration_fold_ids,
    )
    horizon_samples = SampleSetV1(
        "calibration-horizon:v1",
        fit_samples.posture,
        (
            replace(fit_samples.samples[0], label_end_ns=fit_samples.samples[0].label_end_ns + 1),
            *fit_samples.samples[1:],
        ),
    )
    horizon_predictions = replace(
        fit_predictions,
        dataset_digest=horizon_samples.digest(),
    )

    def forged_horizon_slice(**kwargs: object) -> tuple[SampleSetV1, PredictionSetV1]:
        return horizon_samples, horizon_predictions

    with monkeypatch.context() as scoped:
        scoped.setattr(
            calibration_module,
            "stack_predictions_for_folds",
            forged_horizon_slice,
        )
        with pytest.raises(ContractValueError, match="horizon"):
            fit_calibrator(
                method=CalibrationMethod.PLATT_CHRONOLOGICAL,
                samples=samples,
                matrix=matrix,
                fitted=fitted,
                spec=SPEC,
            )
    unknown_model = replace(
        model,
        status=CalibrationStatus.UNKNOWN,
        reason="INSUFFICIENT_CALIBRATION_SUPPORT",
        coefficient=None,
        intercept=None,
    )
    with pytest.raises(ContractValueError, match="available"):
        calibration_module._apply_to_slice(
            unknown_model,
            app_samples,
            app_predictions,
            begins_after_ns=model.fit_label_end_ns,
            output_model_id="unknown-apply:v1",
        )
    with pytest.raises(ContractValueError):
        calibration_module._apply_to_slice(
            model,
            cast(Any, "bad"),
            app_predictions,
            begins_after_ns=model.fit_label_end_ns,
            output_model_id="bad-input:v1",
        )
    with pytest.raises(ContractValueError, match="different sample"):
        calibration_module._apply_to_slice(
            model,
            app_samples,
            replace(app_predictions, dataset_digest=DigestV1("8" * 64)),
            begins_after_ns=model.fit_label_end_ns,
            output_model_id="bad-digest:v1",
        )
    with pytest.raises(ContractValueError, match="exactly cover"):
        calibration_module._apply_to_slice(
            model,
            app_samples,
            replace(app_predictions, predictions=app_predictions.predictions[:-1]),
            begins_after_ns=model.fit_label_end_ns,
            output_model_id="missing-coverage:v1",
        )
    with pytest.raises(ContractValueError, match="source model"):
        calibration_module._apply_to_slice(
            model,
            app_samples,
            replace(app_predictions, model_id="wrong-source:v1"),
            begins_after_ns=model.fit_label_end_ns,
            output_model_id="wrong-source-output:v1",
        )
    with pytest.raises(ContractValueError, match="outcomes mature"):
        calibration_module._apply_to_slice(
            model,
            app_samples,
            app_predictions,
            begins_after_ns=app_samples.samples[0].cutoff_ns,
            output_model_id="immature-apply:v1",
        )
    late_application = replace(
        app_predictions,
        predictions=(
            replace(
                app_predictions.predictions[0],
                max_feature_asof_ns=app_samples.samples[0].cutoff_ns + 1,
            ),
            *app_predictions.predictions[1:],
        ),
    )
    with pytest.raises(ContractValueError, match="after cutoff"):
        calibration_module._apply_to_slice(
            model,
            app_samples,
            late_application,
            begins_after_ns=model.fit_label_end_ns,
            output_model_id="late-lineage:v1",
        )
    with pytest.raises(ContractValueError, match="calibrator must bind"):
        calibration_module._require_model_context(
            replace(model, stack_digest=DigestV1("b" * 64)),
            matrix,
            fitted,
        )
    with pytest.raises(ContractValueError):
        calibration_module._derived_later_stack_slice(
            samples=samples,
            matrix=cast(Any, "bad"),
            fitted=fitted,
            fold_ids=matrix.fold_ids[2:3],
            prior_fold_ids=fitted.calibration_fold_ids,
            role="test",
        )
    with pytest.raises(ContractValueError):
        calibration_module._derived_later_stack_slice(
            samples=samples,
            matrix=matrix,
            fitted=cast(Any, "bad"),
            fold_ids=matrix.fold_ids[2:3],
            prior_fold_ids=fitted.calibration_fold_ids,
            role="test",
        )
    with pytest.raises(ContractValueError, match="prior_fold_ids"):
        calibration_module._derived_later_stack_slice(
            samples=samples,
            matrix=matrix,
            fitted=fitted,
            fold_ids=matrix.fold_ids[2:3],
            prior_fold_ids=("missing-fold",),
            role="test",
        )
    wrong_horizon_samples = SampleSetV1(
        "application-horizon:v1",
        app_samples.posture,
        tuple(
            replace(sample, label_end_ns=sample.label_end_ns + 1) for sample in app_samples.samples
        ),
    )
    with pytest.raises(ContractValueError, match="horizon"):
        calibration_module._apply_to_slice(
            model,
            wrong_horizon_samples,
            replace(app_predictions, dataset_digest=wrong_horizon_samples.digest()),
            begins_after_ns=model.fit_label_end_ns,
            output_model_id="bad-horizon:v1",
        )


def test_close_remaining_evaluation_and_comparison_contract_branches(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    samples, matrix, fitted, *_ = _models()
    models = tuple(
        fit_calibrator(
            method=method,
            samples=samples,
            matrix=matrix,
            fitted=fitted,
            spec=SPEC,
        )
        for method in CalibrationMethod
    )
    evaluations = tuple(
        sorted(
            (
                evaluate_calibrator(
                    model=model,
                    samples=samples,
                    matrix=matrix,
                    fitted=fitted,
                    evaluation_fold_ids=matrix.fold_ids[2:3],
                )
                for model in models
            ),
            key=lambda item: item.method.value,
        )
    )
    report = evaluations[0]
    last_cell = report.reliability[0][1][-1]
    invalid: tuple[dict[str, Any], ...] = (
        {"method": "bad"},
        {"spec": "bad"},
        {"model_digest": "bad"},
        {"calibration_fold_ids": ()},
        {"calibration_fold_ids": (report.calibration_fold_ids[0],) * 2},
        {"evaluation_fold_ids": ()},
        {"evaluation_fold_ids": (report.evaluation_fold_ids[0],) * 2},
        {"evaluation_fold_ids": report.calibration_fold_ids},
        {"evaluation_sample_ids": ()},
        {"evaluation_sample_ids": (report.evaluation_sample_ids[0],) * 2},
        {"brier": None},
        {"brier": FixedPointV1(FIXED_POINT_SCALE + 1)},
        {"log_loss": FixedPointV1(-1)},
        {"calibration_intercept": "bad"},
        {"calibration_slope": "bad"},
        {"ece_by_bins": cast(Any, ((4, FixedPointV1(0), "extra"),))},
        {"ece_by_bins": ()},
        {"ece_by_bins": ((4, None), (8, FixedPointV1(0)))},
        {
            "ece_by_bins": (
                (4, FixedPointV1(FIXED_POINT_SCALE + 1)),
                report.ece_by_bins[1],
            )
        },
        {"reliability": cast(Any, ((4, report.reliability[0][1], "extra"),))},
        {"reliability": report.reliability[:1]},
        {
            "reliability": (
                (4, (cast(Any, "bad"), *report.reliability[0][1][1:])),
                report.reliability[1],
            )
        },
        {
            "reliability": (
                (4, (*report.reliability[0][1][:-1], replace(last_cell, bin_index=4))),
                report.reliability[1],
            )
        },
    )
    for changes in invalid:
        with pytest.raises(ContractValueError):
            replace(report, **changes)
    with pytest.raises(ContractValueError):
        ReliabilityCellV1(0, 1, make_ratio(2, 1), make_ratio(1, 2))
    with pytest.raises(ContractValueError):
        CalibrationComparisonV1(cast(Any, "bad"), evaluations)
    with pytest.raises(ContractValueError):
        CalibrationComparisonV1(evaluations[0].method, cast(Any, [*evaluations]))
    with pytest.raises(ContractValueError, match="valid support"):
        compare_calibrators(
            samples=samples,
            matrix=matrix,
            fitted=fitted,
            evaluation_fold_ids=matrix.fold_ids[2:3],
            spec=CalibrationSpecV1(20, 3, (4,)),
        )
    zero_slope_model = replace(
        next(model for model in models if model.method is CalibrationMethod.PLATT_CHRONOLOGICAL),
        coefficient=FixedPointV1(0),
    )

    def canonical_zero_slope(**kwargs: object) -> CalibratorV1:
        return zero_slope_model

    with monkeypatch.context() as scoped:
        scoped.setattr(calibration_module, "fit_calibrator", canonical_zero_slope)
        constant_report = evaluate_calibrator(
            model=zero_slope_model,
            samples=samples,
            matrix=matrix,
            fitted=fitted,
            evaluation_fold_ids=matrix.fold_ids[2:3],
        )
    assert constant_report.calibration_slope is None
    assert constant_report.calibration_intercept is None
    with pytest.raises(ContractValueError):
        evaluate_calibrator(
            model=models[0],
            samples=cast(Any, "bad"),
            matrix=matrix,
            fitted=fitted,
            evaluation_fold_ids=matrix.fold_ids[2:3],
        )
