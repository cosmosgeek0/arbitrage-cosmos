"""Chronological out-of-fold stacking over the merged Q14 split authority.

Q12 does not train or inspect Q10/Q11 specialists.  It consumes injected specialist
predictions and proves that every bundle corresponds exactly to one valid Q14 fold:
the recorded train ids equal the fold train ids, predictions cover only that fold's
validation ids, temporal lineage is point-in-time, and holdout/quarantined ids never
enter the meta fit.  A bounded exact simplex search then fits a transparent convex
stacker on earlier OOF folds only.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from fractions import Fraction
from typing import Final, cast

from quant_edge.canonical import canonical_json_bytes
from quant_edge.errors import ContractValueError
from quant_edge.labels.rational import ExactRatioV1, make_ratio
from quant_edge.lake.contracts import DigestV1, require_contract_id, require_strict_int
from quant_edge.models.contracts import ProbabilitySemantics
from quant_edge.validation import (
    FoldStatus,
    PlanStatus,
    PredictionLineageV1,
    PredictionSetV1,
    PredictionV1,
    SampleSetV1,
    WalkForwardPlanV1,
    build_walk_forward_plan,
    subset_by_ids,
)

MAX_SPECIALISTS: Final = 4
MAX_WEIGHT_DIVISIONS: Final = 16
MAX_META_FOLDS: Final = 32


def _ratio(value: ExactRatioV1) -> Fraction:
    return Fraction(value.numerator, value.denominator)


def _require_probability(value: ExactRatioV1, *, field: str) -> None:
    if not isinstance(value, ExactRatioV1):
        raise ContractValueError(f"{field} must be ExactRatioV1")
    if value.numerator < 0 or value.numerator > value.denominator:
        raise ContractValueError(f"{field} must lie in [0, 1]")


def _string_digest(values: tuple[str, ...]) -> DigestV1:
    return DigestV1(hexdigest=hashlib.sha256(canonical_json_bytes(list(values))).hexdigest())


def _bound_stack_model_id(fitted: FittedStackV1) -> str:
    return (
        f"{fitted.stack_id}.matrix-{fitted.matrix_digest.hexdigest[:16]}"
        f".target-{fitted.target_id}.h{fitted.horizon_ns}"
        f".fit-{fitted.digest().hexdigest[:16]}"
    )


@dataclass(frozen=True, slots=True)
class OofFoldPredictionBundleV1:
    """One specialist's exact OOF predictions for one Q14 validation fold."""

    specialist_id: str
    target_id: str
    horizon_ns: int
    probability_semantics: ProbabilitySemantics
    fold_id: str
    train_sample_ids: tuple[str, ...]
    predictions: PredictionSetV1

    def __post_init__(self) -> None:
        require_contract_id(self.specialist_id, field="specialist_id")
        require_contract_id(self.target_id, field="target_id")
        require_strict_int(self.horizon_ns, field="horizon_ns", minimum=1)
        if not isinstance(self.probability_semantics, ProbabilitySemantics):
            raise ContractValueError("probability_semantics must be ProbabilitySemantics")
        if self.probability_semantics is ProbabilitySemantics.NOT_PROBABILITY:
            raise ContractValueError("OOF stacking rejects non-probability specialist outputs")
        require_contract_id(self.fold_id, field="fold_id")
        if not isinstance(self.train_sample_ids, tuple) or not self.train_sample_ids:
            raise ContractValueError("train_sample_ids must be a non-empty tuple")
        if len(set(self.train_sample_ids)) != len(self.train_sample_ids):
            raise ContractValueError("train_sample_ids must be unique")
        for sample_id in self.train_sample_ids:
            require_contract_id(sample_id, field="train sample id")
        if not isinstance(self.predictions, PredictionSetV1):
            raise ContractValueError("predictions must be PredictionSetV1")
        if self.predictions.model_id != self.specialist_id:
            raise ContractValueError("prediction model_id must equal specialist_id")

    def as_mapping(self) -> dict[str, object]:
        return {
            "foldId": self.fold_id,
            "horizonNs": str(self.horizon_ns),
            "probabilitySemantics": self.probability_semantics.value,
            "predictionDigest": self.predictions.digest().hexdigest,
            "specialistId": self.specialist_id,
            "targetId": self.target_id,
            "trainSampleIds": list(self.train_sample_ids),
            "trainSampleIdsDigest": _string_digest(self.train_sample_ids).hexdigest,
        }


@dataclass(frozen=True, slots=True)
class ValidatedOofMatrixV1:
    """Validated rectangular OOF matrix bound to one Q14 plan and target."""

    plan_digest: DigestV1
    dataset_digest: DigestV1
    target_id: str
    horizon_ns: int
    specialist_ids: tuple[str, ...]
    fold_ids: tuple[str, ...]
    bundles: tuple[OofFoldPredictionBundleV1, ...]
    samples: SampleSetV1
    plan: WalkForwardPlanV1

    def __post_init__(self) -> None:
        if not isinstance(self.plan_digest, DigestV1):
            raise ContractValueError("plan_digest must be DigestV1")
        if not isinstance(self.dataset_digest, DigestV1):
            raise ContractValueError("dataset_digest must be DigestV1")
        require_contract_id(self.target_id, field="target_id")
        require_strict_int(self.horizon_ns, field="horizon_ns", minimum=1)
        if not isinstance(self.specialist_ids, tuple):
            raise ContractValueError("specialist_ids must be a tuple")
        if not 2 <= len(self.specialist_ids) <= MAX_SPECIALISTS:
            raise ContractValueError("specialist_ids must hold 2..MAX_SPECIALISTS entries")
        if self.specialist_ids != tuple(sorted(set(self.specialist_ids))):
            raise ContractValueError("specialist_ids must be sorted and unique")
        if not isinstance(self.fold_ids, tuple):
            raise ContractValueError("fold_ids must be a tuple")
        if not self.fold_ids or len(self.fold_ids) > MAX_META_FOLDS:
            raise ContractValueError("fold_ids must be bounded and non-empty")
        if self.fold_ids != tuple(sorted(set(self.fold_ids))):
            raise ContractValueError("fold_ids must be sorted and unique")
        if not isinstance(self.bundles, tuple) or any(
            not isinstance(bundle, OofFoldPredictionBundleV1) for bundle in self.bundles
        ):
            raise ContractValueError("bundles must contain OofFoldPredictionBundleV1 entries")
        expected = tuple(
            (fold_id, specialist_id)
            for fold_id in self.fold_ids
            for specialist_id in self.specialist_ids
        )
        actual = tuple((bundle.fold_id, bundle.specialist_id) for bundle in self.bundles)
        if actual != expected:
            raise ContractValueError("bundles must form the sorted fold/specialist rectangle")
        semantics = {bundle.probability_semantics for bundle in self.bundles}
        if len(semantics) != 1:
            raise ContractValueError("all OOF specialists must share probability semantics")
        if not isinstance(self.samples, SampleSetV1):
            raise ContractValueError("samples must be SampleSetV1")
        if not isinstance(self.plan, WalkForwardPlanV1) or self.plan.status is not PlanStatus.VALID:
            raise ContractValueError("plan must be a valid WalkForwardPlanV1")
        if self.samples.digest() != self.dataset_digest or self.plan.digest() != self.plan_digest:
            raise ContractValueError("validated matrix authority digests must match raw inputs")
        if self.plan.dataset_digest != self.dataset_digest:
            raise ContractValueError("validated matrix plan must bind the sample set")
        valid_folds = tuple(fold for fold in self.plan.folds if fold.status is FoldStatus.VALID)
        if tuple(sorted(fold.fold_id for fold in valid_folds)) != self.fold_ids:
            raise ContractValueError("validated matrix folds must equal the valid plan folds")
        global_validation_ids = tuple(
            sample_id for fold in valid_folds for sample_id in fold.validation_sample_ids
        )
        if len(global_validation_ids) != len(set(global_validation_ids)):
            raise ContractValueError("valid folds must assign every OOF row exactly once")
        forbidden = set(self.plan.holdout_sample_ids) | set(self.plan.quarantined_sample_ids)
        folds_by_id = {fold.fold_id: fold for fold in valid_folds}
        for bundle in self.bundles:
            if bundle.target_id != self.target_id or bundle.horizon_ns != self.horizon_ns:
                raise ContractValueError("validated bundle target or horizon mismatch")
            fold = folds_by_id[bundle.fold_id]
            if bundle.train_sample_ids != fold.train_sample_ids:
                raise ContractValueError("validated bundle train ids must equal plan truth")
            prediction_ids = tuple(
                prediction.sample_id for prediction in bundle.predictions.predictions
            )
            if prediction_ids != tuple(sorted(fold.validation_sample_ids)):
                raise ContractValueError("validated bundle predictions must equal fold truth")
            if forbidden.intersection((*bundle.train_sample_ids, *prediction_ids)):
                raise ContractValueError("holdout/quarantined rows cannot enter OOF truth")
            fold_samples = subset_by_ids(self.samples, fold.validation_sample_ids)
            if bundle.predictions.dataset_digest != fold_samples.digest():
                raise ContractValueError("validated bundle must bind its exact fold subset")
            for prediction in bundle.predictions.predictions:
                _require_probability(prediction.score, field="OOF probability")
                sample = self.samples.by_id(prediction.sample_id)
                if sample.label_horizon_ns != self.horizon_ns:
                    raise ContractValueError("validated sample horizon must match the matrix")
                if prediction.max_feature_asof_ns > sample.cutoff_ns:
                    raise ContractValueError("validated OOF feature cannot follow its cutoff")

    def bundle(self, fold_id: str, specialist_id: str) -> OofFoldPredictionBundleV1:
        for bundle in self.bundles:
            if bundle.fold_id == fold_id and bundle.specialist_id == specialist_id:
                return bundle
        raise ContractValueError("unknown fold/specialist bundle")

    def as_mapping(self) -> dict[str, object]:
        return {
            "bundles": [bundle.as_mapping() for bundle in self.bundles],
            "datasetDigest": self.dataset_digest.hexdigest,
            "foldIds": list(self.fold_ids),
            "horizonNs": str(self.horizon_ns),
            "planDigest": self.plan_digest.hexdigest,
            "probabilitySemantics": self.bundles[0].probability_semantics.value,
            "schema": "Q12ValidatedOofMatrixV1",
            "specialistIds": list(self.specialist_ids),
            "targetId": self.target_id,
        }

    def digest(self) -> DigestV1:
        return DigestV1(
            hexdigest=hashlib.sha256(canonical_json_bytes(self.as_mapping())).hexdigest()
        )


def validate_oof_bundles(
    *,
    samples: SampleSetV1,
    plan: WalkForwardPlanV1,
    target_id: str,
    horizon_ns: int,
    specialist_ids: tuple[str, ...],
    bundles: tuple[OofFoldPredictionBundleV1, ...],
) -> ValidatedOofMatrixV1:
    """Validate a complete fold/specialist OOF rectangle against Q14 truth."""

    if not isinstance(samples, SampleSetV1):
        raise ContractValueError("samples must be SampleSetV1")
    if not isinstance(plan, WalkForwardPlanV1) or plan.status is not PlanStatus.VALID:
        raise ContractValueError("plan must be a valid WalkForwardPlanV1")
    if plan.dataset_digest != samples.digest():
        raise ContractValueError("plan is bound to a different sample set")
    if plan != build_walk_forward_plan(samples, plan.spec):
        raise ContractValueError("plan must equal the canonical walk-forward plan")
    require_contract_id(target_id, field="target_id")
    require_strict_int(horizon_ns, field="horizon_ns", minimum=1)
    if not isinstance(specialist_ids, tuple):
        raise ContractValueError("specialist_ids must be a tuple")
    if not 2 <= len(specialist_ids) <= MAX_SPECIALISTS:
        raise ContractValueError("specialist_ids must hold 2..MAX_SPECIALISTS entries")
    if specialist_ids != tuple(sorted(set(specialist_ids))):
        raise ContractValueError("specialist_ids must be sorted and unique")
    if not isinstance(bundles, tuple) or any(
        not isinstance(bundle, OofFoldPredictionBundleV1) for bundle in bundles
    ):
        raise ContractValueError("bundles must contain OofFoldPredictionBundleV1 entries")
    valid_folds = tuple(fold for fold in plan.folds if fold.status is FoldStatus.VALID)
    if not valid_folds:
        raise ContractValueError("plan must contain at least one valid fold")
    global_validation_ids = tuple(
        sample_id for fold in valid_folds for sample_id in fold.validation_sample_ids
    )
    if len(global_validation_ids) != len(set(global_validation_ids)):
        raise ContractValueError("valid folds must assign every OOF validation id exactly once")
    fold_ids = tuple(sorted(fold.fold_id for fold in valid_folds))
    ordered = tuple(sorted(bundles, key=lambda item: (item.fold_id, item.specialist_id)))
    expected_pairs = {
        (fold.fold_id, specialist_id) for fold in valid_folds for specialist_id in specialist_ids
    }
    actual_pairs = {(bundle.fold_id, bundle.specialist_id) for bundle in ordered}
    if len(actual_pairs) != len(ordered) or actual_pairs != expected_pairs:
        raise ContractValueError("OOF bundles must cover every valid fold/specialist exactly once")
    forbidden = set(plan.holdout_sample_ids) | set(plan.quarantined_sample_ids)
    folds_by_id = {fold.fold_id: fold for fold in valid_folds}
    for bundle in ordered:
        if bundle.target_id != target_id or bundle.horizon_ns != horizon_ns:
            raise ContractValueError("OOF bundle target or horizon mismatch")
        fold = folds_by_id[bundle.fold_id]
        if bundle.train_sample_ids != fold.train_sample_ids:
            raise ContractValueError("OOF bundle train ids must equal the Q14 fold train ids")
        if forbidden.intersection(bundle.train_sample_ids):
            raise ContractValueError("holdout/quarantined ids cannot enter specialist fitting")
        validation_ids = tuple(sorted(fold.validation_sample_ids))
        prediction_ids = tuple(pred.sample_id for pred in bundle.predictions.predictions)
        if prediction_ids != validation_ids:
            raise ContractValueError("OOF predictions must exactly cover fold validation ids")
        if forbidden.intersection(prediction_ids):
            raise ContractValueError("holdout/quarantined ids cannot enter OOF predictions")
        fold_samples = subset_by_ids(samples, fold.validation_sample_ids)
        if bundle.predictions.dataset_digest != fold_samples.digest():
            raise ContractValueError("OOF predictions must bind the exact fold sample subset")
        for prediction in bundle.predictions.predictions:
            _require_probability(prediction.score, field="OOF probability")
            sample = samples.by_id(prediction.sample_id)
            if sample.label_horizon_ns != horizon_ns:
                raise ContractValueError("OOF sample label horizon does not match bundle horizon")
            if prediction.max_feature_asof_ns > sample.cutoff_ns:
                raise ContractValueError("OOF prediction uses a feature after its cutoff")
    return ValidatedOofMatrixV1(
        plan_digest=plan.digest(),
        dataset_digest=samples.digest(),
        target_id=target_id,
        horizon_ns=horizon_ns,
        specialist_ids=specialist_ids,
        fold_ids=fold_ids,
        bundles=ordered,
        samples=samples,
        plan=plan,
    )


@dataclass(frozen=True, slots=True)
class StackingSpecV1:
    meta_train_fold_ids: tuple[str, ...]
    calibration_fold_ids: tuple[str, ...]
    weight_divisions: int

    def __post_init__(self) -> None:
        if not isinstance(self.meta_train_fold_ids, tuple) or not isinstance(
            self.calibration_fold_ids, tuple
        ):
            raise ContractValueError("stacking fold partitions must be tuples")
        if not self.meta_train_fold_ids or not self.calibration_fold_ids:
            raise ContractValueError("stacking fold partitions must be non-empty")
        if self.meta_train_fold_ids != tuple(sorted(set(self.meta_train_fold_ids))):
            raise ContractValueError("meta_train_fold_ids must be sorted and unique")
        if self.calibration_fold_ids != tuple(sorted(set(self.calibration_fold_ids))):
            raise ContractValueError("calibration_fold_ids must be sorted and unique")
        if set(self.meta_train_fold_ids).intersection(self.calibration_fold_ids):
            raise ContractValueError("meta and calibration folds must be disjoint")
        require_strict_int(
            self.weight_divisions,
            field="weight_divisions",
            minimum=1,
            maximum=MAX_WEIGHT_DIVISIONS,
        )

    def as_mapping(self) -> dict[str, object]:
        return {
            "calibrationFoldIds": list(self.calibration_fold_ids),
            "metaTrainFoldIds": list(self.meta_train_fold_ids),
            "weightDivisions": self.weight_divisions,
        }


@dataclass(frozen=True, slots=True)
class FittedStackV1:
    stack_id: str
    matrix_digest: DigestV1
    target_id: str
    horizon_ns: int
    meta_train_fold_ids: tuple[str, ...]
    calibration_fold_ids: tuple[str, ...]
    weight_divisions: int
    fit_label_end_ns: int
    weights: tuple[tuple[str, ExactRatioV1], ...]
    training_brier: ExactRatioV1

    def __post_init__(self) -> None:
        require_contract_id(self.stack_id, field="stack_id")
        if not isinstance(self.matrix_digest, DigestV1):
            raise ContractValueError("matrix_digest must be DigestV1")
        require_contract_id(self.target_id, field="target_id")
        require_strict_int(self.horizon_ns, field="horizon_ns", minimum=1)
        if not isinstance(self.meta_train_fold_ids, tuple) or not isinstance(
            self.calibration_fold_ids, tuple
        ):
            raise ContractValueError("fitted stack fold partitions must be tuples")
        if not self.meta_train_fold_ids or not self.calibration_fold_ids:
            raise ContractValueError("fitted stack fold partitions must be non-empty")
        if self.meta_train_fold_ids != tuple(sorted(set(self.meta_train_fold_ids))):
            raise ContractValueError("meta_train_fold_ids must be sorted and unique")
        if self.calibration_fold_ids != tuple(sorted(set(self.calibration_fold_ids))):
            raise ContractValueError("calibration_fold_ids must be sorted and unique")
        if set(self.meta_train_fold_ids).intersection(self.calibration_fold_ids):
            raise ContractValueError("fitted stack fold partitions must be disjoint")
        require_strict_int(
            self.weight_divisions,
            field="weight_divisions",
            minimum=1,
            maximum=MAX_WEIGHT_DIVISIONS,
        )
        require_strict_int(self.fit_label_end_ns, field="fit_label_end_ns", minimum=1)
        if not isinstance(self.weights, tuple):
            raise ContractValueError("weights must be a tuple")
        ids = tuple(specialist_id for specialist_id, _ in self.weights)
        if ids != tuple(sorted(set(ids))) or not 2 <= len(ids) <= MAX_SPECIALISTS:
            raise ContractValueError("weights must be sorted for 2..MAX_SPECIALISTS")
        total = Fraction(0)
        for specialist_id, weight in self.weights:
            require_contract_id(specialist_id, field="specialist_id")
            _require_probability(weight, field="stack weight")
            exact_weight = _ratio(weight)
            if (exact_weight * self.weight_divisions).denominator != 1:
                raise ContractValueError("stack weight must lie on the declared simplex grid")
            total += exact_weight
        if total != 1:
            raise ContractValueError("stack weights must sum exactly to one")
        _require_probability(self.training_brier, field="training_brier")

    def as_mapping(self) -> dict[str, object]:
        return {
            "horizonNs": str(self.horizon_ns),
            "matrixDigest": self.matrix_digest.hexdigest,
            "metaTrainFoldIds": list(self.meta_train_fold_ids),
            "calibrationFoldIds": list(self.calibration_fold_ids),
            "weightDivisions": self.weight_divisions,
            "fitLabelEndNs": str(self.fit_label_end_ns),
            "schema": "Q12FittedStackV1",
            "stackId": self.stack_id,
            "targetId": self.target_id,
            "trainingBrier": self.training_brier.as_mapping(),
            "weights": {key: value.as_mapping() for key, value in self.weights},
        }

    def digest(self) -> DigestV1:
        return DigestV1(
            hexdigest=hashlib.sha256(canonical_json_bytes(self.as_mapping())).hexdigest()
        )


def _compositions(total: int, parts: int) -> tuple[tuple[int, ...], ...]:
    if parts == 1:
        return ((total,),)
    values: list[tuple[int, ...]] = []
    for head in range(total + 1):
        values.extend((head, *tail) for tail in _compositions(total - head, parts - 1))
    return tuple(values)


def _fold_rows(
    samples: SampleSetV1,
    matrix: ValidatedOofMatrixV1,
    fold_ids: tuple[str, ...],
) -> tuple[tuple[bool, tuple[Fraction, ...]], ...]:
    rows: list[tuple[bool, tuple[Fraction, ...]]] = []
    for fold_id in fold_ids:
        bundles = tuple(matrix.bundle(fold_id, model_id) for model_id in matrix.specialist_ids)
        sample_ids = tuple(pred.sample_id for pred in bundles[0].predictions.predictions)
        for sample_id in sample_ids:
            sample = samples.by_id(sample_id)
            if sample.binary_outcome is None:
                raise ContractValueError("stack fitting requires known binary outcomes")
            scores = tuple(
                _ratio(bundle.predictions.score_for(sample_id).score) for bundle in bundles
            )
            rows.append((sample.binary_outcome, scores))
    return tuple(rows)


def fit_oof_stacker(
    *,
    samples: SampleSetV1,
    matrix: ValidatedOofMatrixV1,
    spec: StackingSpecV1,
    stack_id: str,
) -> FittedStackV1:
    """Fit a bounded exact convex stack by minimum OOF Brier score."""

    if not isinstance(samples, SampleSetV1):
        raise ContractValueError("samples must be SampleSetV1")
    if not isinstance(matrix, ValidatedOofMatrixV1):
        raise ContractValueError("matrix must be ValidatedOofMatrixV1")
    if matrix.dataset_digest != samples.digest():
        raise ContractValueError("matrix is bound to a different sample set")
    if not isinstance(spec, StackingSpecV1):
        raise ContractValueError("spec must be StackingSpecV1")
    require_contract_id(stack_id, field="stack_id")
    known_folds = set(matrix.fold_ids)
    if not set(spec.meta_train_fold_ids).issubset(known_folds):
        raise ContractValueError("meta folds are not present in the OOF matrix")
    if not set(spec.calibration_fold_ids).issubset(known_folds):
        raise ContractValueError("calibration folds are not present in the OOF matrix")
    latest_meta = max(matrix.fold_ids.index(fold_id) for fold_id in spec.meta_train_fold_ids)
    earliest_calibration = min(
        matrix.fold_ids.index(fold_id) for fold_id in spec.calibration_fold_ids
    )
    if latest_meta >= earliest_calibration:
        raise ContractValueError("calibration folds must be strictly later than meta folds")
    rows = _fold_rows(samples, matrix, spec.meta_train_fold_ids)
    meta_sample_ids = tuple(
        prediction.sample_id
        for fold_id in spec.meta_train_fold_ids
        for prediction in matrix.bundle(fold_id, matrix.specialist_ids[0]).predictions.predictions
    )
    fit_label_end_ns = max(samples.by_id(sample_id).label_end_ns for sample_id in meta_sample_ids)
    calibration_cutoff_ns = min(
        samples.by_id(prediction.sample_id).cutoff_ns
        for fold_id in spec.calibration_fold_ids
        for prediction in matrix.bundle(fold_id, matrix.specialist_ids[0]).predictions.predictions
    )
    if calibration_cutoff_ns <= fit_label_end_ns:
        raise ContractValueError("calibration folds begin before all meta labels mature")
    best_weights: tuple[int, ...] | None = None
    best_loss: Fraction | None = None
    for weights in _compositions(spec.weight_divisions, len(matrix.specialist_ids)):
        loss = Fraction(0)
        for label, scores in rows:
            combined = (
                sum(
                    (score * weight for score, weight in zip(scores, weights, strict=True)),
                    Fraction(0),
                )
                / spec.weight_divisions
            )
            residual = combined - int(label)
            loss += residual * residual
        loss /= len(rows)
        if best_loss is None or (loss, weights) < (best_loss, best_weights):
            best_loss = loss
            best_weights = weights
    best_weights = cast(tuple[int, ...], best_weights)
    best_loss = cast(Fraction, best_loss)
    return FittedStackV1(
        stack_id=stack_id,
        matrix_digest=matrix.digest(),
        target_id=matrix.target_id,
        horizon_ns=matrix.horizon_ns,
        meta_train_fold_ids=spec.meta_train_fold_ids,
        calibration_fold_ids=spec.calibration_fold_ids,
        weight_divisions=spec.weight_divisions,
        fit_label_end_ns=fit_label_end_ns,
        weights=tuple(
            (specialist_id, make_ratio(weight, spec.weight_divisions))
            for specialist_id, weight in zip(matrix.specialist_ids, best_weights, strict=True)
        ),
        training_brier=make_ratio(best_loss.numerator, best_loss.denominator),
    )


def stack_predictions_for_folds(
    *,
    samples: SampleSetV1,
    matrix: ValidatedOofMatrixV1,
    fitted: FittedStackV1,
    fold_ids: tuple[str, ...],
) -> tuple[SampleSetV1, PredictionSetV1]:
    """Apply frozen stack weights to later OOF folds and bind the exact subset."""

    if not isinstance(samples, SampleSetV1):
        raise ContractValueError("samples must be SampleSetV1")
    if not isinstance(matrix, ValidatedOofMatrixV1):
        raise ContractValueError("matrix must be ValidatedOofMatrixV1")
    if not isinstance(fitted, FittedStackV1):
        raise ContractValueError("fitted must be FittedStackV1")
    if fitted.matrix_digest != matrix.digest():
        raise ContractValueError("fitted stack must bind this OOF matrix")
    if fitted.target_id != matrix.target_id or fitted.horizon_ns != matrix.horizon_ns:
        raise ContractValueError("fitted stack target/horizon must bind this OOF matrix")
    if tuple(specialist_id for specialist_id, _ in fitted.weights) != matrix.specialist_ids:
        raise ContractValueError("fitted stack weights must bind the matrix specialists")
    if not set(fitted.meta_train_fold_ids).issubset(matrix.fold_ids) or not set(
        fitted.calibration_fold_ids
    ).issubset(matrix.fold_ids):
        raise ContractValueError("fitted stack fold partitions must bind the OOF matrix")
    canonical_fitted = fit_oof_stacker(
        samples=samples,
        matrix=matrix,
        spec=StackingSpecV1(
            meta_train_fold_ids=fitted.meta_train_fold_ids,
            calibration_fold_ids=fitted.calibration_fold_ids,
            weight_divisions=fitted.weight_divisions,
        ),
        stack_id=fitted.stack_id,
    )
    if fitted != canonical_fitted:
        raise ContractValueError("fitted stack must equal the canonical OOF fit")
    if not isinstance(fold_ids, tuple):
        raise ContractValueError("fold_ids must be a tuple")
    if not fold_ids or fold_ids != tuple(sorted(set(fold_ids))):
        raise ContractValueError("fold_ids must be a sorted non-empty unique tuple")
    if not set(fold_ids).issubset(matrix.fold_ids):
        raise ContractValueError("requested folds are not present in the OOF matrix")
    latest_meta = max(matrix.fold_ids.index(fold_id) for fold_id in fitted.meta_train_fold_ids)
    if min(matrix.fold_ids.index(fold_id) for fold_id in fold_ids) <= latest_meta:
        raise ContractValueError("stack application folds must be later than meta fitting")
    application_cutoff_ns = min(
        samples.by_id(prediction.sample_id).cutoff_ns
        for fold_id in fold_ids
        for prediction in matrix.bundle(fold_id, matrix.specialist_ids[0]).predictions.predictions
    )
    if application_cutoff_ns <= fitted.fit_label_end_ns:
        raise ContractValueError("stack application begins before all meta labels mature")
    weights = {specialist_id: _ratio(weight) for specialist_id, weight in fitted.weights}
    sample_ids: list[str] = []
    predictions: list[PredictionV1] = []
    for fold_id in fold_ids:
        bundles = tuple(matrix.bundle(fold_id, model_id) for model_id in matrix.specialist_ids)
        for first_prediction in bundles[0].predictions.predictions:
            sample_id = first_prediction.sample_id
            components = tuple(bundle.predictions.score_for(sample_id) for bundle in bundles)
            score = sum(
                (
                    _ratio(component.score) * weights[bundle.specialist_id]
                    for bundle, component in zip(bundles, components, strict=True)
                ),
                Fraction(0),
            )
            sample_ids.append(sample_id)
            predictions.append(
                PredictionV1(
                    sample_id=sample_id,
                    score=make_ratio(score.numerator, score.denominator),
                    max_feature_asof_ns=max(
                        component.max_feature_asof_ns for component in components
                    ),
                )
            )
    subset = subset_by_ids(samples, tuple(sample_ids))
    return (
        subset,
        PredictionSetV1(
            model_id=_bound_stack_model_id(fitted),
            dataset_digest=subset.digest(),
            predictions=tuple(sorted(predictions, key=lambda item: item.sample_id)),
            lineage=PredictionLineageV1(
                feature_artifact_digest=matrix.digest(),
                fit_receipt_digest=fitted.digest(),
            ),
        ),
    )
