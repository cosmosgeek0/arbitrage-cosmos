"""Chronological Platt and isotonic probability calibration for Q12.

Calibration fitting rows must be strictly later than stack meta-fitting (enforced by
the stacking API) and application rows must be strictly later than calibration fit.
Platt arithmetic is binary64 only inside the bounded optimizer and dies at the accepted
Q10 quantization boundary. Isotonic fitting is exact rational PAVA. Public contracts
contain only exact ratios, fixed point values and typed availability.
"""

from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass
from enum import StrEnum
from fractions import Fraction
from typing import Final, cast

from quant_edge.canonical import canonical_json_bytes
from quant_edge.ensemble.stacking import (
    FittedStackV1,
    StackingSpecV1,
    ValidatedOofMatrixV1,
    fit_oof_stacker,
    stack_predictions_for_folds,
)
from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import FIXED_POINT_SCALE, FixedPointV1, fp_from_ratio
from quant_edge.labels.rational import ExactRatioV1, make_ratio
from quant_edge.lake.contracts import (
    DigestV1,
    require_contract_id,
    require_reason_code,
    require_strict_int,
)
from quant_edge.models.metrics import binary64_log_loss
from quant_edge.models.quantize import quantize_binary64, quantize_probability
from quant_edge.validation import (
    MetricStatus,
    PredictionSetV1,
    PredictionV1,
    SampleSetV1,
    brier_score,
    calibration_slope,
    expected_calibration_error,
    subset_by_ids,
)

MAX_CALIBRATION_SAMPLES: Final = 100_000
MAX_RELIABILITY_BINS: Final = 64
PLATT_ITERATIONS: Final = 64


class CalibrationMethod(StrEnum):
    PLATT_CHRONOLOGICAL = "PLATT_CHRONOLOGICAL"
    ISOTONIC_CHRONOLOGICAL = "ISOTONIC_CHRONOLOGICAL"


class CalibrationStatus(StrEnum):
    AVAILABLE = "AVAILABLE"
    UNKNOWN = "UNKNOWN"


def _fraction(value: ExactRatioV1) -> Fraction:
    return Fraction(value.numerator, value.denominator)


def _ratio(value: Fraction) -> ExactRatioV1:
    return make_ratio(value.numerator, value.denominator)


def _require_probability(value: ExactRatioV1, *, field: str) -> None:
    if not isinstance(value, ExactRatioV1):
        raise ContractValueError(f"{field} must be ExactRatioV1")
    if not 0 <= value.numerator <= value.denominator:
        raise ContractValueError(f"{field} must lie in [0, 1]")


@dataclass(frozen=True, slots=True)
class CalibrationSpecV1:
    min_support: int
    min_unique_scores: int
    reliability_bins: tuple[int, ...]

    def __post_init__(self) -> None:
        require_strict_int(
            self.min_support,
            field="min_support",
            minimum=4,
            maximum=MAX_CALIBRATION_SAMPLES,
        )
        require_strict_int(
            self.min_unique_scores,
            field="min_unique_scores",
            minimum=2,
            maximum=MAX_CALIBRATION_SAMPLES,
        )
        if not isinstance(self.reliability_bins, tuple) or not self.reliability_bins:
            raise ContractValueError("reliability_bins must be non-empty")
        if self.reliability_bins != tuple(sorted(set(self.reliability_bins))):
            raise ContractValueError("reliability_bins must be sorted and unique")
        for bins in self.reliability_bins:
            require_strict_int(
                bins,
                field="reliability bin count",
                minimum=2,
                maximum=MAX_RELIABILITY_BINS,
            )

    def as_mapping(self) -> dict[str, object]:
        return {
            "minSupport": self.min_support,
            "minUniqueScores": self.min_unique_scores,
            "reliabilityBins": list(self.reliability_bins),
        }

    def digest(self) -> DigestV1:
        return DigestV1(
            hexdigest=hashlib.sha256(canonical_json_bytes(self.as_mapping())).hexdigest()
        )


@dataclass(frozen=True, slots=True)
class CalibratorV1:
    method: CalibrationMethod
    status: CalibrationStatus
    reason: str | None
    target_id: str
    horizon_ns: int
    matrix_digest: DigestV1
    stack_digest: DigestV1
    calibration_fold_ids: tuple[str, ...]
    spec: CalibrationSpecV1
    fit_dataset_digest: DigestV1
    fit_prediction_digest: DigestV1
    source_model_id: str
    fit_start_ns: int
    fit_end_ns: int
    fit_label_end_ns: int
    support: int
    support_classes: tuple[int, ...]
    unique_score_count: int
    thresholds: tuple[ExactRatioV1, ...]
    values: tuple[ExactRatioV1, ...]
    coefficient: FixedPointV1 | None
    intercept: FixedPointV1 | None

    def __post_init__(self) -> None:
        if not isinstance(self.method, CalibrationMethod):
            raise ContractValueError("method must be CalibrationMethod")
        if not isinstance(self.status, CalibrationStatus):
            raise ContractValueError("status must be CalibrationStatus")
        require_contract_id(self.target_id, field="target_id")
        require_strict_int(self.horizon_ns, field="horizon_ns", minimum=1)
        if any(
            not isinstance(value, DigestV1)
            for value in (
                self.matrix_digest,
                self.stack_digest,
                self.fit_dataset_digest,
                self.fit_prediction_digest,
            )
        ):
            raise ContractValueError("calibrator provenance digests must be DigestV1")
        if not isinstance(self.calibration_fold_ids, tuple) or not self.calibration_fold_ids:
            raise ContractValueError("calibration_fold_ids must be a non-empty tuple")
        if self.calibration_fold_ids != tuple(sorted(set(self.calibration_fold_ids))):
            raise ContractValueError("calibration_fold_ids must be sorted and unique")
        if not isinstance(self.spec, CalibrationSpecV1):
            raise ContractValueError("spec must be CalibrationSpecV1")
        require_contract_id(self.source_model_id, field="source_model_id")
        require_strict_int(self.fit_start_ns, field="fit_start_ns", minimum=0)
        require_strict_int(self.fit_end_ns, field="fit_end_ns", minimum=self.fit_start_ns)
        require_strict_int(
            self.fit_label_end_ns,
            field="fit_label_end_ns",
            minimum=self.fit_end_ns + 1,
        )
        require_strict_int(self.support, field="support", minimum=0)
        if not isinstance(self.support_classes, tuple) or self.support_classes != tuple(
            sorted(set(self.support_classes))
        ):
            raise ContractValueError("support_classes must be a sorted unique tuple")
        if any(label not in (0, 1) for label in self.support_classes):
            raise ContractValueError("support_classes may contain only binary labels")
        require_strict_int(
            self.unique_score_count,
            field="unique_score_count",
            minimum=0,
            maximum=self.support,
        )
        available = self.status is CalibrationStatus.AVAILABLE
        if available != (self.reason is None):
            raise ContractValueError("available calibrators carry no reason; unknown ones do")
        if self.reason is not None:
            require_reason_code(self.reason, field="reason")
        if available:
            if self.support < self.spec.min_support:
                raise ContractValueError("available calibrator support is below its bound spec")
            if self.support_classes != (0, 1):
                raise ContractValueError("available calibrator requires both support classes")
            if self.unique_score_count < self.spec.min_unique_scores:
                raise ContractValueError(
                    "available calibrator lacks the bound unique-score support"
                )
        if self.method is CalibrationMethod.ISOTONIC_CHRONOLOGICAL:
            if available:
                if len(self.thresholds) < 2 or len(self.thresholds) != len(self.values):
                    raise ContractValueError("available isotonic calibrator needs aligned knots")
                previous: Fraction | None = None
                previous_value: Fraction | None = None
                for threshold, value in zip(self.thresholds, self.values, strict=True):
                    _require_probability(threshold, field="isotonic threshold")
                    _require_probability(value, field="isotonic value")
                    current = _fraction(threshold)
                    current_value = _fraction(value)
                    if previous is not None and current <= previous:
                        raise ContractValueError("isotonic thresholds must strictly increase")
                    if previous_value is not None and current_value < previous_value:
                        raise ContractValueError("isotonic values must be non-decreasing")
                    previous = current
                    previous_value = current_value
                if len(set(self.values)) < 2:
                    raise ContractValueError("available isotonic calibrator output cannot collapse")
            elif self.thresholds or self.values:
                raise ContractValueError("unknown isotonic calibrator forbids numeric parameters")
            if self.coefficient is not None or self.intercept is not None:
                raise ContractValueError("isotonic calibrator forbids Platt parameters")
        else:
            if self.thresholds or self.values:
                raise ContractValueError("Platt calibrator forbids isotonic knots")
            if available and not (
                isinstance(self.coefficient, FixedPointV1)
                and isinstance(self.intercept, FixedPointV1)
            ):
                raise ContractValueError("available Platt calibrator needs both parameters")
            if available and cast(FixedPointV1, self.coefficient).mantissa < 0:
                raise ContractValueError("available Platt calibrator must be non-decreasing")
            if not available and (self.coefficient is not None or self.intercept is not None):
                raise ContractValueError("unknown Platt calibrator forbids numeric parameters")

    def as_mapping(self) -> dict[str, object]:
        return {
            "coefficient": None if self.coefficient is None else self.coefficient.as_mapping(),
            "fitDatasetDigest": self.fit_dataset_digest.hexdigest,
            "fitEndNs": str(self.fit_end_ns),
            "fitPredictionDigest": self.fit_prediction_digest.hexdigest,
            "fitStartNs": str(self.fit_start_ns),
            "fitLabelEndNs": str(self.fit_label_end_ns),
            "intercept": None if self.intercept is None else self.intercept.as_mapping(),
            "method": self.method.value,
            "targetId": self.target_id,
            "horizonNs": str(self.horizon_ns),
            "matrixDigest": self.matrix_digest.hexdigest,
            "stackDigest": self.stack_digest.hexdigest,
            "calibrationFoldIds": list(self.calibration_fold_ids),
            "spec": self.spec.as_mapping(),
            "reason": self.reason,
            "schema": "Q12CalibratorV1",
            "status": self.status.value,
            "sourceModelId": self.source_model_id,
            "support": self.support,
            "supportClasses": list(self.support_classes),
            "uniqueScoreCount": self.unique_score_count,
            "thresholds": [item.as_mapping() for item in self.thresholds],
            "values": [item.as_mapping() for item in self.values],
        }

    def digest(self) -> DigestV1:
        return DigestV1(
            hexdigest=hashlib.sha256(canonical_json_bytes(self.as_mapping())).hexdigest()
        )


def _fit_rows(
    samples: SampleSetV1, predictions: PredictionSetV1
) -> tuple[tuple[Fraction, int], ...]:
    if not isinstance(samples, SampleSetV1) or not isinstance(predictions, PredictionSetV1):
        raise ContractValueError("calibration inputs must be Q14 sample/prediction sets")
    if predictions.dataset_digest != samples.digest():
        raise ContractValueError("calibration predictions bind a different sample set")
    prediction_ids = tuple(prediction.sample_id for prediction in predictions.predictions)
    if prediction_ids != tuple(sorted(samples.sample_ids)):
        raise ContractValueError("calibration predictions must exactly cover every sample")
    rows: list[tuple[Fraction, int]] = []
    for sample in samples.samples:
        if sample.binary_outcome is None:
            raise ContractValueError("calibration fitting requires known binary outcomes")
        prediction = predictions.score_for(sample.sample_id)
        _require_probability(prediction.score, field="calibration score")
        if prediction.max_feature_asof_ns > sample.cutoff_ns:
            raise ContractValueError("calibration input uses a feature after cutoff")
        rows.append((_fraction(prediction.score), int(sample.binary_outcome)))
    return tuple(rows)


def _require_fitted_context(
    matrix: ValidatedOofMatrixV1,
    fitted: FittedStackV1,
) -> None:
    if not isinstance(matrix, ValidatedOofMatrixV1):
        raise ContractValueError("matrix must be ValidatedOofMatrixV1")
    if not isinstance(fitted, FittedStackV1):
        raise ContractValueError("fitted must be FittedStackV1")
    canonical_fitted = fit_oof_stacker(
        samples=matrix.samples,
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


def _calibration_slice(
    samples: SampleSetV1,
    matrix: ValidatedOofMatrixV1,
    fitted: FittedStackV1,
) -> tuple[SampleSetV1, PredictionSetV1]:
    if not isinstance(samples, SampleSetV1):
        raise ContractValueError("samples must be SampleSetV1")
    _require_fitted_context(matrix, fitted)
    if matrix.dataset_digest != samples.digest():
        raise ContractValueError("matrix is bound to a different full sample set")
    return stack_predictions_for_folds(
        samples=samples,
        matrix=matrix,
        fitted=fitted,
        fold_ids=fitted.calibration_fold_ids,
    )


def _require_model_context(
    model: CalibratorV1,
    matrix: ValidatedOofMatrixV1,
    fitted: FittedStackV1,
) -> None:
    if not isinstance(model, CalibratorV1):
        raise ContractValueError("model must be CalibratorV1")
    _require_fitted_context(matrix, fitted)
    if (
        model.matrix_digest != matrix.digest()
        or model.stack_digest != fitted.digest()
        or model.target_id != matrix.target_id
        or model.horizon_ns != matrix.horizon_ns
        or model.calibration_fold_ids != fitted.calibration_fold_ids
    ):
        raise ContractValueError("calibrator must bind the supplied matrix and fitted stack")
    canonical_model = fit_calibrator(
        method=model.method,
        samples=matrix.samples,
        matrix=matrix,
        fitted=fitted,
        spec=model.spec,
    )
    if model != canonical_model:
        raise ContractValueError("calibrator must equal the canonical calibration fit")


def _derived_later_stack_slice(
    *,
    samples: SampleSetV1,
    matrix: ValidatedOofMatrixV1,
    fitted: FittedStackV1,
    fold_ids: tuple[str, ...],
    prior_fold_ids: tuple[str, ...],
    role: str,
) -> tuple[SampleSetV1, PredictionSetV1]:
    if not isinstance(samples, SampleSetV1):
        raise ContractValueError("samples must be SampleSetV1")
    if not isinstance(matrix, ValidatedOofMatrixV1):
        raise ContractValueError("matrix must be ValidatedOofMatrixV1")
    if not isinstance(fitted, FittedStackV1):
        raise ContractValueError("fitted must be FittedStackV1")
    if not isinstance(fold_ids, tuple) or not fold_ids:
        raise ContractValueError(f"{role}_fold_ids must be a non-empty tuple")
    if fold_ids != tuple(sorted(set(fold_ids))):
        raise ContractValueError(f"{role}_fold_ids must be sorted and unique")
    if not set(fold_ids).issubset(matrix.fold_ids):
        raise ContractValueError(f"{role} folds must exist in the validated OOF matrix")
    if (
        not isinstance(prior_fold_ids, tuple)
        or not prior_fold_ids
        or prior_fold_ids != tuple(sorted(set(prior_fold_ids)))
        or not set(prior_fold_ids).issubset(matrix.fold_ids)
    ):
        raise ContractValueError("prior_fold_ids must bind the validated OOF matrix")
    if set(fold_ids).intersection(prior_fold_ids):
        raise ContractValueError(f"{role} folds must be disjoint from prior folds")
    latest_prior = max(matrix.fold_ids.index(fold_id) for fold_id in prior_fold_ids)
    earliest_current = min(matrix.fold_ids.index(fold_id) for fold_id in fold_ids)
    if earliest_current <= latest_prior:
        raise ContractValueError(f"{role} folds must be strictly later than prior folds")
    return stack_predictions_for_folds(
        samples=samples,
        matrix=matrix,
        fitted=fitted,
        fold_ids=fold_ids,
    )


def _unknown_calibrator(
    method: CalibrationMethod,
    fit_samples: SampleSetV1,
    predictions: PredictionSetV1,
    matrix: ValidatedOofMatrixV1,
    fitted: FittedStackV1,
    spec: CalibrationSpecV1,
    rows: tuple[tuple[Fraction, int], ...],
    reason: str,
) -> CalibratorV1:
    return CalibratorV1(
        method=method,
        status=CalibrationStatus.UNKNOWN,
        reason=reason,
        target_id=matrix.target_id,
        horizon_ns=matrix.horizon_ns,
        matrix_digest=matrix.digest(),
        stack_digest=fitted.digest(),
        calibration_fold_ids=fitted.calibration_fold_ids,
        spec=spec,
        fit_dataset_digest=fit_samples.digest(),
        fit_prediction_digest=predictions.digest(),
        source_model_id=predictions.model_id,
        fit_start_ns=fit_samples.samples[0].cutoff_ns,
        fit_end_ns=fit_samples.samples[-1].cutoff_ns,
        fit_label_end_ns=max(sample.label_end_ns for sample in fit_samples.samples),
        support=len(rows),
        support_classes=tuple(sorted({label for _, label in rows})),
        unique_score_count=len({score for score, _ in rows}),
        thresholds=(),
        values=(),
        coefficient=None,
        intercept=None,
    )


def _support_reason(rows: tuple[tuple[Fraction, int], ...], spec: CalibrationSpecV1) -> str | None:
    if len(rows) < spec.min_support:
        return "INSUFFICIENT_CALIBRATION_SUPPORT"
    if len({label for _, label in rows}) != 2:
        return "SINGLE_CLASS_CALIBRATION_SUPPORT"
    if len({score for score, _ in rows}) < spec.min_unique_scores:
        return "INSUFFICIENT_UNIQUE_CALIBRATION_SCORES"
    return None


def _fit_isotonic(
    rows: tuple[tuple[Fraction, int], ...],
) -> tuple[tuple[ExactRatioV1, ...], tuple[ExactRatioV1, ...]]:
    grouped: list[list[Fraction | int]] = []
    for score, label in sorted(rows):
        if grouped and grouped[-1][1] == score:
            grouped[-1][2] = int(grouped[-1][2]) + label
            grouped[-1][3] = int(grouped[-1][3]) + 1
        else:
            grouped.append([score, score, label, 1])
    blocks = grouped
    index = 1
    while index < len(blocks):
        left_rate = Fraction(int(blocks[index - 1][2]), int(blocks[index - 1][3]))
        right_rate = Fraction(int(blocks[index][2]), int(blocks[index][3]))
        if left_rate <= right_rate:
            index += 1
            continue
        left = blocks[index - 1]
        right = blocks[index]
        blocks[index - 1 : index + 1] = [
            [
                left[0],
                right[1],
                int(left[2]) + int(right[2]),
                int(left[3]) + int(right[3]),
            ]
        ]
        index = max(1, index - 1)
    thresholds = tuple(_ratio(Fraction(block[1])) for block in blocks)
    values = tuple(_ratio(Fraction(int(block[2]), int(block[3]))) for block in blocks)
    return thresholds, values


def _sigmoid(value: float) -> float:
    if value >= 0.0:
        inverse = math.exp(-value)
        return 1.0 / (1.0 + inverse)
    exponent = math.exp(value)
    return exponent / (1.0 + exponent)


def _fit_platt(rows: tuple[tuple[Fraction, int], ...]) -> tuple[FixedPointV1, FixedPointV1]:
    xs = tuple(float(score) for score, _ in rows)
    ys = tuple(label for _, label in rows)
    positives = sum(ys)
    negatives = len(ys) - positives
    coefficient = 0.0
    intercept = math.log((positives + 1.0) / (negatives + 1.0))
    ridge = 1e-9
    for _ in range(PLATT_ITERATIONS):
        gradient_a = ridge * coefficient
        gradient_b = ridge * intercept
        hessian_aa = ridge
        hessian_ab = 0.0
        hessian_bb = ridge
        for x_value, label in zip(xs, ys, strict=True):
            probability = _sigmoid(coefficient * x_value + intercept)
            difference = probability - label
            curvature = probability * (1.0 - probability)
            gradient_a += difference * x_value
            gradient_b += difference
            hessian_aa += curvature * x_value * x_value
            hessian_ab += curvature * x_value
            hessian_bb += curvature
        determinant = hessian_aa * hessian_bb - hessian_ab * hessian_ab
        delta_a = (hessian_bb * gradient_a - hessian_ab * gradient_b) / determinant
        delta_b = (-hessian_ab * gradient_a + hessian_aa * gradient_b) / determinant
        coefficient -= delta_a
        intercept -= delta_b
    return (
        quantize_binary64(coefficient, field="Platt coefficient"),
        quantize_binary64(intercept, field="Platt intercept"),
    )


def fit_calibrator(
    *,
    method: CalibrationMethod,
    samples: SampleSetV1,
    matrix: ValidatedOofMatrixV1,
    fitted: FittedStackV1,
    spec: CalibrationSpecV1,
) -> CalibratorV1:
    """Fit on the exact stack-designated calibration folds or return UNKNOWN."""

    if not isinstance(method, CalibrationMethod):
        raise ContractValueError("method must be CalibrationMethod")
    if not isinstance(spec, CalibrationSpecV1):
        raise ContractValueError("spec must be CalibrationSpecV1")
    fit_samples, predictions = _calibration_slice(samples, matrix, fitted)
    if any(sample.label_horizon_ns != matrix.horizon_ns for sample in fit_samples.samples):
        raise ContractValueError("calibration sample horizon does not match the declared horizon")
    rows = _fit_rows(fit_samples, predictions)
    reason = _support_reason(rows, spec)
    if reason is not None:
        return _unknown_calibrator(
            method, fit_samples, predictions, matrix, fitted, spec, rows, reason
        )
    if method is CalibrationMethod.ISOTONIC_CHRONOLOGICAL:
        thresholds, values = _fit_isotonic(rows)
        if len(thresholds) < 2 or len(set(values)) < 2:
            return _unknown_calibrator(
                method,
                fit_samples,
                predictions,
                matrix,
                fitted,
                spec,
                rows,
                "COLLAPSED_ISOTONIC_OUTPUT",
            )
        return CalibratorV1(
            method=method,
            status=CalibrationStatus.AVAILABLE,
            reason=None,
            target_id=matrix.target_id,
            horizon_ns=matrix.horizon_ns,
            matrix_digest=matrix.digest(),
            stack_digest=fitted.digest(),
            calibration_fold_ids=fitted.calibration_fold_ids,
            spec=spec,
            fit_dataset_digest=fit_samples.digest(),
            fit_prediction_digest=predictions.digest(),
            source_model_id=predictions.model_id,
            fit_start_ns=fit_samples.samples[0].cutoff_ns,
            fit_end_ns=fit_samples.samples[-1].cutoff_ns,
            fit_label_end_ns=max(sample.label_end_ns for sample in fit_samples.samples),
            support=len(rows),
            support_classes=tuple(sorted({label for _, label in rows})),
            unique_score_count=len({score for score, _ in rows}),
            thresholds=thresholds,
            values=values,
            coefficient=None,
            intercept=None,
        )
    coefficient, intercept = _fit_platt(rows)
    if coefficient.mantissa < 0:
        return _unknown_calibrator(
            method,
            fit_samples,
            predictions,
            matrix,
            fitted,
            spec,
            rows,
            "NON_MONOTONE_PLATT_CALIBRATION",
        )
    return CalibratorV1(
        method=method,
        status=CalibrationStatus.AVAILABLE,
        reason=None,
        target_id=matrix.target_id,
        horizon_ns=matrix.horizon_ns,
        matrix_digest=matrix.digest(),
        stack_digest=fitted.digest(),
        calibration_fold_ids=fitted.calibration_fold_ids,
        spec=spec,
        fit_dataset_digest=fit_samples.digest(),
        fit_prediction_digest=predictions.digest(),
        source_model_id=predictions.model_id,
        fit_start_ns=fit_samples.samples[0].cutoff_ns,
        fit_end_ns=fit_samples.samples[-1].cutoff_ns,
        fit_label_end_ns=max(sample.label_end_ns for sample in fit_samples.samples),
        support=len(rows),
        support_classes=tuple(sorted({label for _, label in rows})),
        unique_score_count=len({score for score, _ in rows}),
        thresholds=(),
        values=(),
        coefficient=coefficient,
        intercept=intercept,
    )


def _apply_one(model: CalibratorV1, score: ExactRatioV1) -> ExactRatioV1:
    _require_probability(score, field="calibrator input")
    if model.method is CalibrationMethod.ISOTONIC_CHRONOLOGICAL:
        target = _fraction(score)
        for threshold, value in zip(model.thresholds, model.values, strict=True):
            if target <= _fraction(threshold):
                return value
        return model.values[-1]
    coefficient = cast(FixedPointV1, model.coefficient)
    intercept = cast(FixedPointV1, model.intercept)
    argument = (
        coefficient.mantissa / FIXED_POINT_SCALE * float(_fraction(score))
        + intercept.mantissa / FIXED_POINT_SCALE
    )
    quantized = quantize_probability(_sigmoid(argument), field="Platt probability")
    return make_ratio(quantized.mantissa, FIXED_POINT_SCALE)


def _apply_to_slice(
    model: CalibratorV1,
    samples: SampleSetV1,
    predictions: PredictionSetV1,
    *,
    begins_after_ns: int,
    output_model_id: str,
) -> PredictionSetV1:
    if not isinstance(model, CalibratorV1) or model.status is not CalibrationStatus.AVAILABLE:
        raise ContractValueError("only an available calibrator may be applied")
    if not isinstance(samples, SampleSetV1) or not isinstance(predictions, PredictionSetV1):
        raise ContractValueError("application inputs must be Q14 sample/prediction sets")
    require_strict_int(begins_after_ns, field="begins_after_ns", minimum=0)
    require_contract_id(output_model_id, field="output_model_id")
    if predictions.dataset_digest != samples.digest():
        raise ContractValueError("application predictions bind a different sample set")
    prediction_ids = tuple(prediction.sample_id for prediction in predictions.predictions)
    if prediction_ids != tuple(sorted(samples.sample_ids)):
        raise ContractValueError("application predictions must exactly cover every sample")
    if predictions.model_id != model.source_model_id:
        raise ContractValueError(
            "application predictions must come from the calibrated source model"
        )
    if samples.samples[0].cutoff_ns <= begins_after_ns:
        raise ContractValueError("calibrator application must begin after bound outcomes mature")
    if any(sample.label_horizon_ns != model.horizon_ns for sample in samples.samples):
        raise ContractValueError("application sample horizon does not match the calibrator")
    calibrated: list[PredictionV1] = []
    for sample in samples.samples:
        prediction = predictions.score_for(sample.sample_id)
        if prediction.max_feature_asof_ns > sample.cutoff_ns:
            raise ContractValueError("calibrator input uses a feature after cutoff")
        calibrated.append(
            PredictionV1(
                sample_id=sample.sample_id,
                score=_apply_one(model, prediction.score),
                max_feature_asof_ns=prediction.max_feature_asof_ns,
            )
        )
    return PredictionSetV1(
        model_id=output_model_id,
        dataset_digest=samples.digest(),
        predictions=tuple(sorted(calibrated, key=lambda item: item.sample_id)),
    )


def apply_calibrator(
    *,
    model: CalibratorV1,
    evaluation: CalibrationEvaluationV1,
    samples: SampleSetV1,
    matrix: ValidatedOofMatrixV1,
    fitted: FittedStackV1,
    application_fold_ids: tuple[str, ...],
) -> PredictionSetV1:
    """Apply only to an exact later OOF fold slice after evaluation maturity."""

    _require_model_context(model, matrix, fitted)
    if not isinstance(evaluation, CalibrationEvaluationV1):
        raise ContractValueError("evaluation must be CalibrationEvaluationV1")
    if (
        evaluation.method is not model.method
        or evaluation.target_id != model.target_id
        or evaluation.horizon_ns != model.horizon_ns
        or evaluation.model_digest != model.digest()
        or evaluation.spec != model.spec
        or evaluation.calibration_spec_digest != model.spec.digest()
        or evaluation.matrix_digest != model.matrix_digest
        or evaluation.stack_digest != model.stack_digest
        or evaluation.calibration_fold_ids != model.calibration_fold_ids
        or evaluation.source_model_id != model.source_model_id
    ):
        raise ContractValueError("evaluation must exactly bind the applied calibrator")
    canonical_evaluation = evaluate_calibrator(
        model=model,
        samples=samples,
        matrix=matrix,
        fitted=fitted,
        evaluation_fold_ids=evaluation.evaluation_fold_ids,
    )
    if evaluation != canonical_evaluation:
        raise ContractValueError("evaluation must equal the canonical OOF fold evaluation")
    application_samples, predictions = _derived_later_stack_slice(
        samples=samples,
        matrix=matrix,
        fitted=fitted,
        fold_ids=application_fold_ids,
        prior_fold_ids=evaluation.evaluation_fold_ids,
        role="application",
    )
    return _apply_to_slice(
        model,
        application_samples,
        predictions,
        begins_after_ns=evaluation.evaluation_outcome_maturity_ns,
        output_model_id=(
            f"q12cal-{model.digest().hexdigest[:16]}.eval-{evaluation.digest().hexdigest[:16]}"
        ),
    )


@dataclass(frozen=True, slots=True)
class ReliabilityCellV1:
    bin_index: int
    support: int
    mean_probability: ExactRatioV1
    event_rate: ExactRatioV1

    def __post_init__(self) -> None:
        require_strict_int(self.bin_index, field="bin_index", minimum=0)
        require_strict_int(self.support, field="support", minimum=1)
        _require_probability(self.mean_probability, field="mean_probability")
        _require_probability(self.event_rate, field="event_rate")

    def as_mapping(self) -> dict[str, object]:
        return {
            "binIndex": self.bin_index,
            "eventRate": self.event_rate.as_mapping(),
            "meanProbability": self.mean_probability.as_mapping(),
            "support": self.support,
        }


def _reliability(
    samples: SampleSetV1, predictions: PredictionSetV1, bins: int
) -> tuple[ReliabilityCellV1, ...]:
    buckets: dict[int, list[tuple[Fraction, int]]] = {}
    for sample in samples.samples:
        score = _fraction(predictions.score_for(sample.sample_id).score)
        index = min(int(score * bins), bins - 1)
        buckets.setdefault(index, []).append((score, int(cast(bool, sample.binary_outcome))))
    return tuple(
        ReliabilityCellV1(
            bin_index=index,
            support=len(rows),
            mean_probability=_ratio(sum((row[0] for row in rows), Fraction(0)) / len(rows)),
            event_rate=make_ratio(sum(row[1] for row in rows), len(rows)),
        )
        for index, rows in sorted(buckets.items())
    )


@dataclass(frozen=True, slots=True)
class CalibrationEvaluationV1:
    method: CalibrationMethod
    target_id: str
    horizon_ns: int
    model_digest: DigestV1
    spec: CalibrationSpecV1
    calibration_spec_digest: DigestV1
    matrix_digest: DigestV1
    stack_digest: DigestV1
    calibration_fold_ids: tuple[str, ...]
    evaluation_fold_ids: tuple[str, ...]
    source_model_id: str
    source_prediction_digest: DigestV1
    prediction_digest: DigestV1
    evaluation_dataset_digest: DigestV1
    evaluation_sample_ids: tuple[str, ...]
    evaluation_start_ns: int
    evaluation_outcome_maturity_ns: int
    support: int
    support_classes: tuple[int, ...]
    unique_score_count: int
    brier: FixedPointV1 | None
    log_loss: FixedPointV1 | None
    calibration_intercept: FixedPointV1 | None
    calibration_slope: FixedPointV1 | None
    ece_by_bins: tuple[tuple[int, FixedPointV1 | None], ...]
    reliability: tuple[tuple[int, tuple[ReliabilityCellV1, ...]], ...]

    def __post_init__(self) -> None:
        if not isinstance(self.method, CalibrationMethod):
            raise ContractValueError("method must be CalibrationMethod")
        require_contract_id(self.target_id, field="target_id")
        require_strict_int(self.horizon_ns, field="horizon_ns", minimum=1)
        if not isinstance(self.spec, CalibrationSpecV1):
            raise ContractValueError("spec must be CalibrationSpecV1")
        if any(
            not isinstance(value, DigestV1)
            for value in (
                self.model_digest,
                self.calibration_spec_digest,
                self.matrix_digest,
                self.stack_digest,
                self.source_prediction_digest,
                self.prediction_digest,
                self.evaluation_dataset_digest,
            )
        ):
            raise ContractValueError("evaluation digests must be DigestV1")
        if self.calibration_spec_digest != self.spec.digest():
            raise ContractValueError("calibration_spec_digest must bind spec")
        if not isinstance(self.calibration_fold_ids, tuple) or not self.calibration_fold_ids:
            raise ContractValueError("calibration_fold_ids must be a non-empty tuple")
        if self.calibration_fold_ids != tuple(sorted(set(self.calibration_fold_ids))):
            raise ContractValueError("calibration_fold_ids must be sorted and unique")
        if not isinstance(self.evaluation_fold_ids, tuple) or not self.evaluation_fold_ids:
            raise ContractValueError("evaluation_fold_ids must be a non-empty tuple")
        if self.evaluation_fold_ids != tuple(sorted(set(self.evaluation_fold_ids))):
            raise ContractValueError("evaluation_fold_ids must be sorted and unique")
        if set(self.calibration_fold_ids).intersection(self.evaluation_fold_ids):
            raise ContractValueError("calibration and evaluation folds must be disjoint")
        require_contract_id(self.source_model_id, field="source_model_id")
        if not isinstance(self.evaluation_sample_ids, tuple) or not self.evaluation_sample_ids:
            raise ContractValueError("evaluation_sample_ids must be a non-empty tuple")
        if len(set(self.evaluation_sample_ids)) != len(self.evaluation_sample_ids):
            raise ContractValueError("evaluation_sample_ids must be non-empty and unique")
        require_strict_int(self.evaluation_start_ns, field="evaluation_start_ns", minimum=0)
        require_strict_int(
            self.evaluation_outcome_maturity_ns,
            field="evaluation_outcome_maturity_ns",
            minimum=self.evaluation_start_ns + 1,
        )
        require_strict_int(
            self.support,
            field="support",
            minimum=self.spec.min_support,
            maximum=MAX_CALIBRATION_SAMPLES,
        )
        if self.support != len(self.evaluation_sample_ids):
            raise ContractValueError("evaluation support must equal sample-id count")
        if self.support_classes != (0, 1):
            raise ContractValueError("evaluation support must contain both binary classes")
        require_strict_int(
            self.unique_score_count,
            field="unique_score_count",
            minimum=self.spec.min_unique_scores,
            maximum=self.support,
        )
        if not isinstance(self.brier, FixedPointV1) or not isinstance(self.log_loss, FixedPointV1):
            raise ContractValueError("valid calibration evaluation requires Brier and log loss")
        if not 0 <= self.brier.mantissa <= FIXED_POINT_SCALE:
            raise ContractValueError("Brier score must lie in [0, 1]")
        if self.log_loss.mantissa < 0:
            raise ContractValueError("log loss cannot be negative")
        if self.calibration_intercept is not None and not isinstance(
            self.calibration_intercept, FixedPointV1
        ):
            raise ContractValueError("calibration_intercept must be FixedPointV1 or None")
        if self.calibration_slope is not None and not isinstance(
            self.calibration_slope, FixedPointV1
        ):
            raise ContractValueError("calibration_slope must be FixedPointV1 or None")
        if (self.calibration_intercept is None) != (self.calibration_slope is None):
            raise ContractValueError("calibration intercept and slope must be jointly available")
        if not isinstance(self.ece_by_bins, tuple) or any(
            not isinstance(entry, tuple) or len(entry) != 2 for entry in self.ece_by_bins
        ):
            raise ContractValueError("ECE entries must be (bin_count, value) tuples")
        bins = tuple(bin_count for bin_count, _ in self.ece_by_bins)
        if not bins or bins != tuple(sorted(set(bins))):
            raise ContractValueError("ECE bin counts must be sorted, unique, and non-empty")
        if bins != self.spec.reliability_bins:
            raise ContractValueError("evaluation bins must equal the bound calibration spec")
        for bin_count in bins:
            require_strict_int(
                bin_count,
                field="ECE bin count",
                minimum=2,
                maximum=MAX_RELIABILITY_BINS,
            )
        if any(not isinstance(value, FixedPointV1) for _, value in self.ece_by_bins):
            raise ContractValueError("valid calibration evaluation requires every ECE value")
        if any(
            not 0 <= cast(FixedPointV1, value).mantissa <= FIXED_POINT_SCALE
            for _, value in self.ece_by_bins
        ):
            raise ContractValueError("ECE values must lie in [0, 1]")
        if not isinstance(self.reliability, tuple) or any(
            not isinstance(entry, tuple) or len(entry) != 2 for entry in self.reliability
        ):
            raise ContractValueError("reliability entries must be (bin_count, cells) tuples")
        if tuple(bin_count for bin_count, _ in self.reliability) != bins:
            raise ContractValueError("reliability cells must align with ECE bin counts")
        for bin_count, cells in self.reliability:
            if not isinstance(cells, tuple) or not cells or len(cells) > bin_count:
                raise ContractValueError("reliability cells must be non-empty and bounded")
            if any(not isinstance(cell, ReliabilityCellV1) for cell in cells):
                raise ContractValueError("reliability entries must be ReliabilityCellV1")
            indices = tuple(cell.bin_index for cell in cells)
            if indices != tuple(sorted(set(indices))):
                raise ContractValueError("reliability cell indices must be sorted and unique")
            if any(cell.bin_index >= bin_count for cell in cells):
                raise ContractValueError("reliability cell index must be below its bin count")
            if sum(cell.support for cell in cells) != len(self.evaluation_sample_ids):
                raise ContractValueError("reliability support must equal evaluation sample count")

    def as_mapping(self) -> dict[str, object]:
        return {
            "brier": None if self.brier is None else self.brier.as_mapping(),
            "calibrationIntercept": (
                None
                if self.calibration_intercept is None
                else self.calibration_intercept.as_mapping()
            ),
            "calibrationSlope": (
                None if self.calibration_slope is None else self.calibration_slope.as_mapping()
            ),
            "eceByBins": {
                str(bins): None if value is None else value.as_mapping()
                for bins, value in self.ece_by_bins
            },
            "logLoss": None if self.log_loss is None else self.log_loss.as_mapping(),
            "method": self.method.value,
            "targetId": self.target_id,
            "horizonNs": str(self.horizon_ns),
            "modelDigest": self.model_digest.hexdigest,
            "spec": self.spec.as_mapping(),
            "calibrationSpecDigest": self.calibration_spec_digest.hexdigest,
            "matrixDigest": self.matrix_digest.hexdigest,
            "stackDigest": self.stack_digest.hexdigest,
            "calibrationFoldIds": list(self.calibration_fold_ids),
            "evaluationFoldIds": list(self.evaluation_fold_ids),
            "sourceModelId": self.source_model_id,
            "sourcePredictionDigest": self.source_prediction_digest.hexdigest,
            "predictionDigest": self.prediction_digest.hexdigest,
            "evaluationDatasetDigest": self.evaluation_dataset_digest.hexdigest,
            "evaluationSampleIds": list(self.evaluation_sample_ids),
            "evaluationStartNs": str(self.evaluation_start_ns),
            "evaluationOutcomeMaturityNs": str(self.evaluation_outcome_maturity_ns),
            "support": self.support,
            "supportClasses": list(self.support_classes),
            "uniqueScoreCount": self.unique_score_count,
            "reliability": {
                str(bins): [cell.as_mapping() for cell in cells] for bins, cells in self.reliability
            },
        }

    def digest(self) -> DigestV1:
        return DigestV1(
            hexdigest=hashlib.sha256(canonical_json_bytes(self.as_mapping())).hexdigest()
        )


def evaluate_calibrator(
    *,
    model: CalibratorV1,
    samples: SampleSetV1,
    matrix: ValidatedOofMatrixV1,
    fitted: FittedStackV1,
    evaluation_fold_ids: tuple[str, ...],
) -> CalibrationEvaluationV1:
    _require_model_context(model, matrix, fitted)
    evaluation_samples, predictions = _derived_later_stack_slice(
        samples=samples,
        matrix=matrix,
        fitted=fitted,
        fold_ids=evaluation_fold_ids,
        prior_fold_ids=model.calibration_fold_ids,
        role="evaluation",
    )
    rows = _fit_rows(evaluation_samples, predictions)
    support_reason = _support_reason(rows, model.spec)
    if support_reason is not None:
        raise ContractValueError(f"calibration evaluation support is unavailable: {support_reason}")
    calibrated = _apply_to_slice(
        model,
        evaluation_samples,
        predictions,
        begins_after_ns=model.fit_label_end_ns,
        output_model_id=f"q12cal-{model.digest().hexdigest[:16]}",
    )
    brier = brier_score(evaluation_samples, calibrated)
    slope = calibration_slope(evaluation_samples, calibrated)
    fixed_predictions = tuple(
        fp_from_ratio(calibrated.score_for(sample.sample_id).score)
        for sample in evaluation_samples.samples
    )
    labels = tuple(1 if sample.binary_outcome else 0 for sample in evaluation_samples.samples)
    log_loss = binary64_log_loss(fixed_predictions, labels).value
    brier_value = brier.value if brier.status is MetricStatus.AVAILABLE else None
    slope_value = slope.value if slope.status is MetricStatus.AVAILABLE else None
    intercept_value: FixedPointV1 | None = None
    if slope_value is not None:
        mean_probability = sum(
            (
                _fraction(calibrated.score_for(sample.sample_id).score)
                for sample in evaluation_samples.samples
            ),
            Fraction(0),
        ) / len(evaluation_samples.samples)
        mean_outcome = Fraction(sum(labels), len(labels))
        slope_fraction = Fraction(slope_value.mantissa, FIXED_POINT_SCALE)
        intercept_value = fp_from_ratio(_ratio(mean_outcome - slope_fraction * mean_probability))
    eces: list[tuple[int, FixedPointV1 | None]] = []
    reliability: list[tuple[int, tuple[ReliabilityCellV1, ...]]] = []
    for bins in model.spec.reliability_bins:
        ece = expected_calibration_error(evaluation_samples, calibrated, bins=bins)
        eces.append((bins, ece.value if ece.status is MetricStatus.AVAILABLE else None))
        reliability.append((bins, _reliability(evaluation_samples, calibrated, bins)))
    return CalibrationEvaluationV1(
        method=model.method,
        target_id=model.target_id,
        horizon_ns=model.horizon_ns,
        model_digest=model.digest(),
        spec=model.spec,
        calibration_spec_digest=model.spec.digest(),
        matrix_digest=model.matrix_digest,
        stack_digest=model.stack_digest,
        calibration_fold_ids=model.calibration_fold_ids,
        evaluation_fold_ids=evaluation_fold_ids,
        source_model_id=predictions.model_id,
        source_prediction_digest=predictions.digest(),
        prediction_digest=calibrated.digest(),
        evaluation_dataset_digest=evaluation_samples.digest(),
        evaluation_sample_ids=evaluation_samples.sample_ids,
        evaluation_start_ns=evaluation_samples.samples[0].cutoff_ns,
        evaluation_outcome_maturity_ns=max(
            sample.label_end_ns for sample in evaluation_samples.samples
        ),
        support=len(rows),
        support_classes=tuple(sorted({label for _, label in rows})),
        unique_score_count=len({score for score, _ in rows}),
        brier=brier_value,
        log_loss=log_loss,
        calibration_intercept=intercept_value,
        calibration_slope=slope_value,
        ece_by_bins=tuple(eces),
        reliability=tuple(reliability),
    )


@dataclass(frozen=True, slots=True)
class CalibrationComparisonV1:
    chosen_method: CalibrationMethod
    evaluations: tuple[CalibrationEvaluationV1, ...]

    def __post_init__(self) -> None:
        if not isinstance(self.chosen_method, CalibrationMethod):
            raise ContractValueError("chosen_method must be CalibrationMethod")
        if not isinstance(self.evaluations, tuple) or any(
            not isinstance(evaluation, CalibrationEvaluationV1) for evaluation in self.evaluations
        ):
            raise ContractValueError("evaluations must contain CalibrationEvaluationV1 entries")
        methods = tuple(evaluation.method for evaluation in self.evaluations)
        expected_methods = tuple(sorted(CalibrationMethod, key=lambda item: item.value))
        if methods != expected_methods:
            raise ContractValueError("evaluations must contain exactly both sorted methods")
        first = self.evaluations[0]
        slice_identity = (
            first.target_id,
            first.horizon_ns,
            first.calibration_spec_digest,
            first.matrix_digest,
            first.stack_digest,
            first.calibration_fold_ids,
            first.evaluation_fold_ids,
            first.source_model_id,
            first.source_prediction_digest,
            first.evaluation_dataset_digest,
            first.evaluation_sample_ids,
            first.evaluation_start_ns,
            first.evaluation_outcome_maturity_ns,
        )
        if any(
            (
                evaluation.target_id,
                evaluation.horizon_ns,
                evaluation.calibration_spec_digest,
                evaluation.matrix_digest,
                evaluation.stack_digest,
                evaluation.calibration_fold_ids,
                evaluation.evaluation_fold_ids,
                evaluation.source_model_id,
                evaluation.source_prediction_digest,
                evaluation.evaluation_dataset_digest,
                evaluation.evaluation_sample_ids,
                evaluation.evaluation_start_ns,
                evaluation.evaluation_outcome_maturity_ns,
            )
            != slice_identity
            for evaluation in self.evaluations[1:]
        ):
            raise ContractValueError("calibration evaluations must bind the same slice")
        winner = min(
            self.evaluations,
            key=lambda evaluation: (
                cast(FixedPointV1, evaluation.brier).mantissa,
                evaluation.method.value,
            ),
        ).method
        if self.chosen_method is not winner:
            raise ContractValueError("chosen_method must equal the recomputed comparison winner")

    def as_mapping(self) -> dict[str, object]:
        return {
            "chosenMethod": self.chosen_method.value,
            "evaluations": [evaluation.as_mapping() for evaluation in self.evaluations],
            "schema": "Q12CalibrationComparisonV1",
        }


def compare_calibrators(
    *,
    samples: SampleSetV1,
    matrix: ValidatedOofMatrixV1,
    fitted: FittedStackV1,
    evaluation_fold_ids: tuple[str, ...],
    spec: CalibrationSpecV1,
) -> tuple[CalibratorV1, CalibrationComparisonV1]:
    """Fit both declared challengers and choose by later-slice Brier score."""

    models = tuple(
        fit_calibrator(
            method=method,
            samples=samples,
            matrix=matrix,
            fitted=fitted,
            spec=spec,
        )
        for method in CalibrationMethod
    )
    if any(model.status is not CalibrationStatus.AVAILABLE for model in models):
        raise ContractValueError("calibrator comparison requires valid support for both methods")
    evaluations = tuple(
        sorted(
            (
                evaluate_calibrator(
                    model=model,
                    samples=samples,
                    matrix=matrix,
                    fitted=fitted,
                    evaluation_fold_ids=evaluation_fold_ids,
                )
                for model in models
            ),
            key=lambda item: item.method.value,
        )
    )
    chosen_evaluation = min(
        evaluations,
        key=lambda item: (
            cast(FixedPointV1, item.brier).mantissa,
            item.method.value,
        ),
    )
    chosen_model = next(model for model in models if model.method is chosen_evaluation.method)
    return chosen_model, CalibrationComparisonV1(
        chosen_method=chosen_model.method,
        evaluations=evaluations,
    )


@dataclass(frozen=True, slots=True)
class BoundCalibratedAssessmentV1:
    """One exact assessment projection bound to its canonical full-fold calibration."""

    samples: SampleSetV1
    matrix: ValidatedOofMatrixV1
    fitted: FittedStackV1
    calibrator: CalibratorV1
    comparison: CalibrationComparisonV1
    evaluation: CalibrationEvaluationV1
    application_fold_ids: tuple[str, ...]
    application_samples: SampleSetV1
    application_predictions: PredictionSetV1
    assessment_fold_id: str
    assessment_samples: SampleSetV1
    calibrated_predictions: PredictionSetV1

    def __post_init__(self) -> None:
        if not isinstance(self.samples, SampleSetV1):
            raise ContractValueError("samples must be SampleSetV1")
        if not isinstance(self.matrix, ValidatedOofMatrixV1):
            raise ContractValueError("matrix must be ValidatedOofMatrixV1")
        if not isinstance(self.fitted, FittedStackV1):
            raise ContractValueError("fitted must be FittedStackV1")
        if not isinstance(self.calibrator, CalibratorV1):
            raise ContractValueError("calibrator must be CalibratorV1")
        if not isinstance(self.comparison, CalibrationComparisonV1):
            raise ContractValueError("comparison must be CalibrationComparisonV1")
        if not isinstance(self.evaluation, CalibrationEvaluationV1):
            raise ContractValueError("evaluation must be CalibrationEvaluationV1")
        if not isinstance(self.application_samples, SampleSetV1) or not isinstance(
            self.application_predictions, PredictionSetV1
        ):
            raise ContractValueError("application evidence must be sample/prediction sets")
        if not isinstance(self.assessment_samples, SampleSetV1) or not isinstance(
            self.calibrated_predictions, PredictionSetV1
        ):
            raise ContractValueError("assessment evidence must be sample/prediction sets")
        require_contract_id(self.assessment_fold_id, field="assessment_fold_id")
        canonical_calibrator, canonical_comparison = compare_calibrators(
            samples=self.samples,
            matrix=self.matrix,
            fitted=self.fitted,
            evaluation_fold_ids=self.evaluation.evaluation_fold_ids,
            spec=self.calibrator.spec,
        )
        if self.calibrator != canonical_calibrator or self.comparison != canonical_comparison:
            raise ContractValueError("assessment must bind the canonical calibration comparison")
        canonical_evaluation = next(
            evaluation
            for evaluation in canonical_comparison.evaluations
            if evaluation.method is canonical_calibrator.method
        )
        if self.evaluation != canonical_evaluation:
            raise ContractValueError("assessment must bind the chosen canonical evaluation")
        canonical_application_samples, _ = _derived_later_stack_slice(
            samples=self.samples,
            matrix=self.matrix,
            fitted=self.fitted,
            fold_ids=self.application_fold_ids,
            prior_fold_ids=self.evaluation.evaluation_fold_ids,
            role="application",
        )
        canonical_application_predictions = apply_calibrator(
            model=self.calibrator,
            evaluation=self.evaluation,
            samples=self.samples,
            matrix=self.matrix,
            fitted=self.fitted,
            application_fold_ids=self.application_fold_ids,
        )
        if (
            self.application_samples != canonical_application_samples
            or self.application_predictions != canonical_application_predictions
        ):
            raise ContractValueError("assessment must bind the canonical full application fold")
        if len(self.assessment_samples.samples) != 1:
            raise ContractValueError("assessment_samples must contain exactly one row")
        assessment_sample_id = self.assessment_samples.samples[0].sample_id
        containing_folds = tuple(
            fold_id
            for fold_id in self.application_fold_ids
            if assessment_sample_id
            in {
                prediction.sample_id
                for prediction in self.matrix.bundle(
                    fold_id, self.matrix.specialist_ids[0]
                ).predictions.predictions
            }
        )
        if containing_folds != (self.assessment_fold_id,):
            raise ContractValueError(
                "assessment row must belong to exactly its bound application fold"
            )
        canonical_assessment_samples = subset_by_ids(self.samples, (assessment_sample_id,))
        canonical_assessment_predictions = PredictionSetV1(
            model_id=canonical_application_predictions.model_id,
            dataset_digest=canonical_assessment_samples.digest(),
            predictions=(canonical_application_predictions.score_for(assessment_sample_id),),
        )
        if (
            self.assessment_samples != canonical_assessment_samples
            or self.calibrated_predictions != canonical_assessment_predictions
        ):
            raise ContractValueError("assessment projection must equal the canonical one-row slice")

    @property
    def assessment_sample_id(self) -> str:
        return self.assessment_samples.samples[0].sample_id

    @property
    def calibrated_probability(self) -> ExactRatioV1:
        return self.calibrated_predictions.predictions[0].score

    def as_mapping(self) -> dict[str, object]:
        return {
            "applicationFoldIds": list(self.application_fold_ids),
            "applicationPredictionDigest": self.application_predictions.digest().hexdigest,
            "applicationSampleDigest": self.application_samples.digest().hexdigest,
            "assessmentFoldId": self.assessment_fold_id,
            "assessmentPredictionDigest": self.calibrated_predictions.digest().hexdigest,
            "assessmentSampleDigest": self.assessment_samples.digest().hexdigest,
            "assessmentSampleId": self.assessment_sample_id,
            "calibratorDigest": self.calibrator.digest().hexdigest,
            "comparison": self.comparison.as_mapping(),
            "evaluationDigest": self.evaluation.digest().hexdigest,
            "fittedDigest": self.fitted.digest().hexdigest,
            "matrixDigest": self.matrix.digest().hexdigest,
            "schema": "Q12BoundCalibratedAssessmentV1",
        }

    def digest(self) -> DigestV1:
        return DigestV1(
            hexdigest=hashlib.sha256(canonical_json_bytes(self.as_mapping())).hexdigest()
        )


def bind_calibrated_assessment(
    *,
    samples: SampleSetV1,
    matrix: ValidatedOofMatrixV1,
    fitted: FittedStackV1,
    calibrator: CalibratorV1,
    comparison: CalibrationComparisonV1,
    evaluation: CalibrationEvaluationV1,
    application_fold_ids: tuple[str, ...],
    assessment_sample_id: str,
) -> BoundCalibratedAssessmentV1:
    """Build the unique lawful one-row projection from a canonical full-fold apply."""

    require_contract_id(assessment_sample_id, field="assessment_sample_id")
    application_samples, _ = _derived_later_stack_slice(
        samples=samples,
        matrix=matrix,
        fitted=fitted,
        fold_ids=application_fold_ids,
        prior_fold_ids=evaluation.evaluation_fold_ids,
        role="application",
    )
    application_predictions = apply_calibrator(
        model=calibrator,
        evaluation=evaluation,
        samples=samples,
        matrix=matrix,
        fitted=fitted,
        application_fold_ids=application_fold_ids,
    )
    containing_folds = tuple(
        fold_id
        for fold_id in application_fold_ids
        if assessment_sample_id
        in {
            prediction.sample_id
            for prediction in matrix.bundle(
                fold_id, matrix.specialist_ids[0]
            ).predictions.predictions
        }
    )
    if len(containing_folds) != 1:
        raise ContractValueError("assessment_sample_id must belong to exactly one application fold")
    assessment_samples = subset_by_ids(samples, (assessment_sample_id,))
    calibrated_predictions = PredictionSetV1(
        model_id=application_predictions.model_id,
        dataset_digest=assessment_samples.digest(),
        predictions=(application_predictions.score_for(assessment_sample_id),),
    )
    return BoundCalibratedAssessmentV1(
        samples=samples,
        matrix=matrix,
        fitted=fitted,
        calibrator=calibrator,
        comparison=comparison,
        evaluation=evaluation,
        application_fold_ids=application_fold_ids,
        application_samples=application_samples,
        application_predictions=application_predictions,
        assessment_fold_id=containing_folds[0],
        assessment_samples=assessment_samples,
        calibrated_predictions=calibrated_predictions,
    )
