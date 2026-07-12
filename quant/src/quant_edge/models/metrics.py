"""Exact-rational battery metrics over once-quantized predictions.

Every metric except ``log_loss`` is computed with exact integer/rational
arithmetic from the quantized fixed-point predictions and integer labels, then
rounded half-even once onto the fixed-point grid for reporting. ``log_loss``
needs logarithms, so it is computed in binary64 under a documented clip law and
honestly labeled ``BINARY64``.
"""

from __future__ import annotations

import math
from fractions import Fraction

from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import (
    FIXED_POINT_SCALE,
    FixedPointV1,
    round_half_even,
)
from quant_edge.models.contracts import MetricDerivation, MetricDirection, MetricValueV1
from quant_edge.models.synthetic import QUANTILE_LEVELS

_PROB_ONE = FIXED_POINT_SCALE
_ECE_BINS = 10
_QUANTILE_FRACTIONS = {level: Fraction(level) for level in QUANTILE_LEVELS}


def _fp_from_fraction(value: Fraction) -> FixedPointV1:
    scaled = value * FIXED_POINT_SCALE
    if scaled >= 0:
        mantissa = round_half_even(scaled.numerator, scaled.denominator)
    else:
        magnitude = -scaled
        mantissa = -round_half_even(magnitude.numerator, magnitude.denominator)
    return FixedPointV1(mantissa)


def _exact_metric(name: str, value: Fraction, direction: MetricDirection) -> MetricValueV1:
    return MetricValueV1(
        name=name,
        value=_fp_from_fraction(value),
        derivation=MetricDerivation.EXACT_RATIONAL,
        direction=direction,
    )


def _require_pair(
    predictions: tuple[FixedPointV1, ...], labels: tuple[int, ...], *, field: str
) -> None:
    if not isinstance(predictions, tuple) or not predictions:
        raise ContractValueError(f"{field} predictions must be a non-empty tuple")
    if any(not isinstance(item, FixedPointV1) for item in predictions):
        raise ContractValueError(f"{field} predictions must be FixedPointV1 values")
    if not isinstance(labels, tuple) or len(labels) != len(predictions):
        raise ContractValueError(f"{field} labels must align with predictions")


def _require_probabilities(
    predictions: tuple[FixedPointV1, ...], labels: tuple[int, ...], *, field: str
) -> None:
    _require_pair(predictions, labels, field=field)
    if any(not 0 <= item.mantissa <= _PROB_ONE for item in predictions):
        raise ContractValueError(f"{field} probabilities must lie in [0, 1]")
    if any(label not in (0, 1) for label in labels):
        raise ContractValueError(f"{field} labels must be binary")


def brier_score(predictions: tuple[FixedPointV1, ...], labels: tuple[int, ...]) -> MetricValueV1:
    _require_probabilities(predictions, labels, field="brier")
    total = Fraction(0)
    for prediction, label in zip(predictions, labels, strict=True):
        difference = Fraction(prediction.mantissa - label * _PROB_ONE, _PROB_ONE)
        total += difference * difference
    return _exact_metric("brier", total / len(labels), MetricDirection.LOWER_IS_BETTER)


def exact_auc(predictions: tuple[FixedPointV1, ...], labels: tuple[int, ...]) -> MetricValueV1:
    """Tie-aware Mann-Whitney AUC as an exact rational."""

    _require_probabilities(predictions, labels, field="auc")
    positives = sum(labels)
    negatives = len(labels) - positives
    if positives == 0 or negatives == 0:
        raise ContractValueError("auc requires both classes present")
    ordered = sorted(zip((p.mantissa for p in predictions), labels, strict=True))
    doubled_u = 0
    negatives_below = 0
    index = 0
    while index < len(ordered):
        cursor = index
        group_pos = 0
        group_neg = 0
        while cursor < len(ordered) and ordered[cursor][0] == ordered[index][0]:
            if ordered[cursor][1] == 1:
                group_pos += 1
            else:
                group_neg += 1
            cursor += 1
        doubled_u += group_pos * (2 * negatives_below + group_neg)
        negatives_below += group_neg
        index = cursor
    value = Fraction(doubled_u, 2 * positives * negatives)
    return _exact_metric("auc", value, MetricDirection.HIGHER_IS_BETTER)


def expected_calibration_error(
    predictions: tuple[FixedPointV1, ...],
    labels: tuple[int, ...],
    *,
    name: str = "ece",
) -> MetricValueV1:
    """Ten equal-width bins on [0, 1]; the last bin is closed at 1."""

    _require_probabilities(predictions, labels, field=name)
    counts = [0] * _ECE_BINS
    mantissa_sums = [0] * _ECE_BINS
    positive_counts = [0] * _ECE_BINS
    for prediction, label in zip(predictions, labels, strict=True):
        bin_index = min(prediction.mantissa * _ECE_BINS // _PROB_ONE, _ECE_BINS - 1)
        counts[bin_index] += 1
        mantissa_sums[bin_index] += prediction.mantissa
        positive_counts[bin_index] += label
    total = Fraction(0)
    for bin_index in range(_ECE_BINS):
        if counts[bin_index] == 0:
            continue
        mean_probability = Fraction(mantissa_sums[bin_index], counts[bin_index] * _PROB_ONE)
        positive_rate = Fraction(positive_counts[bin_index], counts[bin_index])
        weight = Fraction(counts[bin_index], len(labels))
        total += weight * abs(mean_probability - positive_rate)
    return _exact_metric(name, total, MetricDirection.LOWER_IS_BETTER)


def binary64_log_loss(
    predictions: tuple[FixedPointV1, ...], labels: tuple[int, ...]
) -> MetricValueV1:
    """Binary64 log loss over quantized probabilities, clip law: one grid unit."""

    _require_probabilities(predictions, labels, field="log_loss")
    total = 0.0
    for prediction, label in zip(predictions, labels, strict=True):
        clipped = min(max(prediction.mantissa, 1), _PROB_ONE - 1)
        probability = clipped / _PROB_ONE
        total += -math.log(probability) if label == 1 else -math.log(1.0 - probability)
    mean = total / len(labels)
    exact = Fraction.from_float(mean)
    return MetricValueV1(
        name="log_loss",
        value=_fp_from_fraction(exact),
        derivation=MetricDerivation.BINARY64,
        direction=MetricDirection.LOWER_IS_BETTER,
    )


def _value_difference(prediction: FixedPointV1, label: int) -> Fraction:
    return Fraction(prediction.mantissa - label * FIXED_POINT_SCALE, FIXED_POINT_SCALE)


def mean_squared_error(
    predictions: tuple[FixedPointV1, ...], labels: tuple[int, ...]
) -> MetricValueV1:
    _require_pair(predictions, labels, field="mse")
    total = Fraction(0)
    for prediction, label in zip(predictions, labels, strict=True):
        difference = _value_difference(prediction, label)
        total += difference * difference
    return _exact_metric("mse", total / len(labels), MetricDirection.LOWER_IS_BETTER)


def mean_absolute_error(
    predictions: tuple[FixedPointV1, ...], labels: tuple[int, ...]
) -> MetricValueV1:
    _require_pair(predictions, labels, field="mae")
    total = Fraction(0)
    for prediction, label in zip(predictions, labels, strict=True):
        total += abs(_value_difference(prediction, label))
    return _exact_metric("mae", total / len(labels), MetricDirection.LOWER_IS_BETTER)


def _require_level(level: str) -> Fraction:
    if level not in _QUANTILE_FRACTIONS:
        raise ContractValueError(f"unknown quantile level {level}")
    return _QUANTILE_FRACTIONS[level]


def _pinball_fraction(
    predictions: tuple[FixedPointV1, ...], labels: tuple[int, ...], quantile: Fraction
) -> Fraction:
    total = Fraction(0)
    for prediction, label in zip(predictions, labels, strict=True):
        residual = -_value_difference(prediction, label)
        total += quantile * residual if residual >= 0 else (quantile - 1) * residual
    return total / len(labels)


def pinball_loss(
    predictions: tuple[FixedPointV1, ...], labels: tuple[int, ...], *, level: str
) -> MetricValueV1:
    quantile = _require_level(level)
    _require_pair(predictions, labels, field=f"pinball_{level}")
    value = _pinball_fraction(predictions, labels, quantile)
    return _exact_metric(f"pinball_{level}", value, MetricDirection.LOWER_IS_BETTER)


def pinball_mean(
    predictions_by_level: dict[str, tuple[FixedPointV1, ...]], labels: tuple[int, ...]
) -> MetricValueV1:
    """Exact mean pinball loss across the declared quantile levels."""

    if set(predictions_by_level) != set(QUANTILE_LEVELS):
        raise ContractValueError("pinball_mean requires exactly the declared levels")
    total = Fraction(0)
    for level in QUANTILE_LEVELS:
        predictions = predictions_by_level[level]
        _require_pair(predictions, labels, field=f"pinball_{level}")
        total += _pinball_fraction(predictions, labels, _QUANTILE_FRACTIONS[level])
    value = total / len(QUANTILE_LEVELS)
    return _exact_metric("pinball_mean", value, MetricDirection.LOWER_IS_BETTER)


def coverage_abs_error(
    predictions: tuple[FixedPointV1, ...], labels: tuple[int, ...], *, level: str
) -> MetricValueV1:
    quantile = _require_level(level)
    _require_pair(predictions, labels, field=f"coverage_abs_error_{level}")
    covered = sum(
        1
        for prediction, label in zip(predictions, labels, strict=True)
        if label * FIXED_POINT_SCALE <= prediction.mantissa
    )
    value = abs(Fraction(covered, len(labels)) - quantile)
    return _exact_metric(f"coverage_abs_error_{level}", value, MetricDirection.LOWER_IS_BETTER)


def crossing_fraction(
    lower: tuple[FixedPointV1, ...],
    middle: tuple[FixedPointV1, ...],
    upper: tuple[FixedPointV1, ...],
) -> MetricValueV1:
    if not (len(lower) == len(middle) == len(upper)) or not lower:
        raise ContractValueError("crossing_fraction requires aligned non-empty quantile vectors")
    crossings = sum(
        1
        for low, mid, high in zip(lower, middle, upper, strict=True)
        if low.mantissa > mid.mantissa or mid.mantissa > high.mantissa
    )
    value = Fraction(crossings, len(lower))
    return _exact_metric("crossing_fraction", value, MetricDirection.LOWER_IS_BETTER)


def _grouped(
    scores: tuple[FixedPointV1, ...], grades: tuple[int, ...], group_size: int
) -> list[list[tuple[int, int]]]:
    _require_pair(scores, grades, field="rank")
    if group_size < 2 or len(scores) % group_size != 0:
        raise ContractValueError("rank metrics require whole groups of size at least two")
    groups: list[list[tuple[int, int]]] = []
    for start in range(0, len(scores), group_size):
        group = [
            (scores[index].mantissa, grades[index]) for index in range(start, start + group_size)
        ]
        groups.append(group)
    return groups


def _top_k(group: list[tuple[int, int]], k: int) -> list[tuple[int, int]]:
    ordered = sorted(
        enumerate(group), key=lambda item: (-item[1][0], item[0])
    )  # score descending; earlier row wins ties
    return [entry for _, entry in ordered[:k]]


def precision_at_k(
    scores: tuple[FixedPointV1, ...],
    grades: tuple[int, ...],
    *,
    group_size: int,
    k: int,
    relevant_grade: int,
) -> MetricValueV1:
    groups = _grouped(scores, grades, group_size)
    if not 1 <= k <= group_size:
        raise ContractValueError("k must lie within the group size")
    total = Fraction(0)
    for group in groups:
        relevant = sum(1 for _, grade in _top_k(group, k) if grade >= relevant_grade)
        total += Fraction(relevant, k)
    return _exact_metric(f"precision_at_{k}", total / len(groups), MetricDirection.HIGHER_IS_BETTER)


def recall_at_k(
    scores: tuple[FixedPointV1, ...],
    grades: tuple[int, ...],
    *,
    group_size: int,
    k: int,
    relevant_grade: int,
) -> MetricValueV1:
    """Micro-averaged recall: retrieved relevant over all relevant, exact."""

    groups = _grouped(scores, grades, group_size)
    if not 1 <= k <= group_size:
        raise ContractValueError("k must lie within the group size")
    retrieved = 0
    relevant_total = 0
    for group in groups:
        retrieved += sum(1 for _, grade in _top_k(group, k) if grade >= relevant_grade)
        relevant_total += sum(1 for _, grade in group if grade >= relevant_grade)
    if relevant_total == 0:
        raise ContractValueError("recall requires at least one relevant row")
    value = Fraction(retrieved, relevant_total)
    return _exact_metric(f"recall_at_{k}", value, MetricDirection.HIGHER_IS_BETTER)


def kendall_tau_a(
    scores: tuple[FixedPointV1, ...],
    grades: tuple[int, ...],
    *,
    group_size: int,
) -> MetricValueV1:
    """Tau-a over within-group pairs; ties in either variable count zero."""

    groups = _grouped(scores, grades, group_size)
    concordant_minus_discordant = 0
    pair_count = 0
    for group in groups:
        for left in range(len(group)):
            for right in range(left + 1, len(group)):
                score_sign = group[left][0] - group[right][0]
                grade_sign = group[left][1] - group[right][1]
                product = score_sign * grade_sign
                if product > 0:
                    concordant_minus_discordant += 1
                elif product < 0:
                    concordant_minus_discordant -= 1
                pair_count += 1
    value = Fraction(concordant_minus_discordant, pair_count)
    return _exact_metric("kendall_tau_a", value, MetricDirection.HIGHER_IS_BETTER)
