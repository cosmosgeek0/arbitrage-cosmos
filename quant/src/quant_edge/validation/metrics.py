"""Exact §16.4 metrics over injected samples and predictions.

All arithmetic is exact (integer/rational) internally; public values are integer
fixed-point at the accepted scale with half-even rounding. Degenerate support yields
``UNKNOWN`` with an explicit reason — never a fabricated number. Rare-event practice
is honored: PR-AUC is first-class and ROC-AUC is secondary context.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from fractions import Fraction
from typing import cast

from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import FixedPointV1, round_half_even
from quant_edge.lake.contracts import require_contract_id, require_reason_code, require_strict_int
from quant_edge.validation.samples import PredictionSetV1, SampleSetV1, aligned_pairs

FIXED_SCALE = 10**12
MAX_ECE_BINS = 64


class MetricKind(StrEnum):
    PR_AUC = "PR_AUC"
    ROC_AUC = "ROC_AUC"
    PRECISION_AT_K = "PRECISION_AT_K"
    RECALL_AT_K = "RECALL_AT_K"
    BRIER = "BRIER"
    ECE = "ECE"
    CALIBRATION_SLOPE = "CALIBRATION_SLOPE"


HIGHER_IS_BETTER: dict[MetricKind, bool] = {
    MetricKind.PR_AUC: True,
    MetricKind.ROC_AUC: True,
    MetricKind.PRECISION_AT_K: True,
    MetricKind.RECALL_AT_K: True,
    MetricKind.BRIER: False,
    MetricKind.ECE: False,
}


class MetricStatus(StrEnum):
    AVAILABLE = "AVAILABLE"
    UNKNOWN = "UNKNOWN"


@dataclass(frozen=True, slots=True)
class MetricValueV1:
    """One measured metric with explicit support and degeneracy truth."""

    metric_id: str
    status: MetricStatus
    value: FixedPointV1 | None
    reason: str | None
    support: int
    positive_count: int

    def __post_init__(self) -> None:
        require_contract_id(self.metric_id, field="metric_id")
        if not isinstance(self.status, MetricStatus):
            raise ContractValueError("status must be a MetricStatus")
        if self.status is MetricStatus.AVAILABLE:
            if not isinstance(self.value, FixedPointV1) or self.reason is not None:
                raise ContractValueError("available metrics carry a value and no reason")
        else:
            if self.value is not None or self.reason is None:
                raise ContractValueError("unknown metrics carry a reason and no value")
            require_reason_code(self.reason, field="reason")
        require_strict_int(self.support, field="support", minimum=0)
        require_strict_int(self.positive_count, field="positive_count", minimum=0)

    def as_mapping(self) -> dict[str, object]:
        return {
            "metricId": self.metric_id,
            "positiveCount": self.positive_count,
            "reason": self.reason,
            "status": self.status.value,
            "support": self.support,
            "value": None if self.value is None else self.value.as_mapping(),
        }


@dataclass(frozen=True, slots=True)
class PrimaryMetricSpecV1:
    """The declared primary metric of a validation family."""

    kind: MetricKind
    k: int | None
    ece_bins: int | None

    def __post_init__(self) -> None:
        if not isinstance(self.kind, MetricKind):
            raise ContractValueError("kind must be a MetricKind")
        if self.kind is MetricKind.CALIBRATION_SLOPE:
            raise ContractValueError("calibration slope is diagnostic, not a primary metric")
        needs_k = self.kind in (MetricKind.PRECISION_AT_K, MetricKind.RECALL_AT_K)
        if needs_k:
            require_strict_int(self.k, field="k", minimum=1)
        elif self.k is not None:
            raise ContractValueError("k applies only to precision/recall at k")
        if self.kind is MetricKind.ECE:
            require_strict_int(self.ece_bins, field="ece_bins", minimum=1, maximum=MAX_ECE_BINS)
        elif self.ece_bins is not None:
            raise ContractValueError("ece_bins applies only to ECE")

    @property
    def higher_is_better(self) -> bool:
        return HIGHER_IS_BETTER[self.kind]

    def metric_id(self) -> str:
        if self.k is not None:
            return f"{self.kind.value.lower()}:{self.k}"
        if self.ece_bins is not None:
            return f"{self.kind.value.lower()}:{self.ece_bins}"
        return self.kind.value.lower()

    def as_mapping(self) -> dict[str, object]:
        return {"eceBins": self.ece_bins, "k": self.k, "kind": self.kind.value}


@dataclass(frozen=True, slots=True)
class _Scored:
    sample_id: str
    label: bool
    score: Fraction


def _fixed(value: Fraction) -> FixedPointV1:
    return FixedPointV1(round_half_even(value.numerator * FIXED_SCALE, value.denominator))


def _scored_rows(
    samples: SampleSetV1,
    predictions: PredictionSetV1,
    restrict_ids: tuple[str, ...] | None,
) -> list[_Scored]:
    pairs = aligned_pairs(samples, predictions)
    if restrict_ids is not None:
        known = {sample.sample_id for sample, _ in pairs}
        missing = [sample_id for sample_id in restrict_ids if sample_id not in known]
        if missing:
            raise ContractValueError(f"restricted ids are not in the sample set: {missing[:4]}")
        selected = set(restrict_ids)
    else:
        selected = None
    rows: list[_Scored] = []
    for sample, prediction in pairs:
        if selected is not None and sample.sample_id not in selected:
            continue
        if sample.binary_outcome is None:
            continue
        score = Fraction(prediction.score.numerator, prediction.score.denominator)
        rows.append(_Scored(sample.sample_id, sample.binary_outcome, score))
    return rows


def _ranked(rows: list[_Scored]) -> list[_Scored]:
    return sorted(rows, key=lambda row: (-row.score, row.sample_id))


def _unknown(metric_id: str, reason: str, rows: list[_Scored]) -> MetricValueV1:
    return MetricValueV1(
        metric_id=metric_id,
        status=MetricStatus.UNKNOWN,
        value=None,
        reason=reason,
        support=len(rows),
        positive_count=sum(1 for row in rows if row.label),
    )


def _available(metric_id: str, value: Fraction, rows: list[_Scored]) -> MetricValueV1:
    return MetricValueV1(
        metric_id=metric_id,
        status=MetricStatus.AVAILABLE,
        value=_fixed(value),
        reason=None,
        support=len(rows),
        positive_count=sum(1 for row in rows if row.label),
    )


def precision_at_k(
    samples: SampleSetV1,
    predictions: PredictionSetV1,
    *,
    k: int,
    restrict_ids: tuple[str, ...] | None = None,
) -> MetricValueV1:
    require_strict_int(k, field="k", minimum=1)
    rows = _scored_rows(samples, predictions, restrict_ids)
    metric_id = f"precision_at_k:{k}"
    if len(rows) < k:
        return _unknown(metric_id, "INSUFFICIENT_SCOREABLE_SAMPLES", rows)
    top = _ranked(rows)[:k]
    hits = sum(1 for row in top if row.label)
    return _available(metric_id, Fraction(hits, k), rows)


def recall_at_k(
    samples: SampleSetV1,
    predictions: PredictionSetV1,
    *,
    k: int,
    restrict_ids: tuple[str, ...] | None = None,
) -> MetricValueV1:
    require_strict_int(k, field="k", minimum=1)
    rows = _scored_rows(samples, predictions, restrict_ids)
    metric_id = f"recall_at_k:{k}"
    if len(rows) < k:
        return _unknown(metric_id, "INSUFFICIENT_SCOREABLE_SAMPLES", rows)
    positives = sum(1 for row in rows if row.label)
    if positives == 0:
        return _unknown(metric_id, "NO_POSITIVE_SAMPLES", rows)
    top = _ranked(rows)[:k]
    hits = sum(1 for row in top if row.label)
    return _available(metric_id, Fraction(hits, positives), rows)


def pr_auc(
    samples: SampleSetV1,
    predictions: PredictionSetV1,
    *,
    restrict_ids: tuple[str, ...] | None = None,
) -> MetricValueV1:
    """Average precision under the deterministic rank order law."""

    rows = _scored_rows(samples, predictions, restrict_ids)
    if not rows:
        return _unknown("pr_auc", "NO_SCOREABLE_SAMPLES", rows)
    positives = sum(1 for row in rows if row.label)
    if positives == 0:
        return _unknown("pr_auc", "NO_POSITIVE_SAMPLES", rows)
    hits = 0
    total = Fraction(0)
    for rank, row in enumerate(_ranked(rows), start=1):
        if row.label:
            hits += 1
            total += Fraction(hits, rank)
    return _available("pr_auc", total / positives, rows)


def roc_auc(
    samples: SampleSetV1,
    predictions: PredictionSetV1,
    *,
    restrict_ids: tuple[str, ...] | None = None,
) -> MetricValueV1:
    """Mann-Whitney ROC-AUC with exact half-credit tie law; secondary context only."""

    rows = _scored_rows(samples, predictions, restrict_ids)
    positive_scores = sorted(row.score for row in rows if row.label)
    negative_scores = sorted(row.score for row in rows if not row.label)
    if not positive_scores or not negative_scores:
        return _unknown("roc_auc", "DEGENERATE_CLASS_SUPPORT", rows)
    wins = Fraction(0)
    for positive in positive_scores:
        for negative in negative_scores:
            if positive > negative:
                wins += 1
            elif positive == negative:
                wins += Fraction(1, 2)
    denominator = len(positive_scores) * len(negative_scores)
    return _available("roc_auc", wins / denominator, rows)


def _probability_rows(rows: list[_Scored]) -> bool:
    return all(0 <= row.score <= 1 for row in rows)


def brier_score(
    samples: SampleSetV1,
    predictions: PredictionSetV1,
    *,
    restrict_ids: tuple[str, ...] | None = None,
) -> MetricValueV1:
    rows = _scored_rows(samples, predictions, restrict_ids)
    if not rows:
        return _unknown("brier", "NO_SCOREABLE_SAMPLES", rows)
    if not _probability_rows(rows):
        return _unknown("brier", "SCORE_OUTSIDE_PROBABILITY_RANGE", rows)
    total = Fraction(0)
    for row in rows:
        outcome = Fraction(1 if row.label else 0)
        total += (row.score - outcome) ** 2
    return _available("brier", total / len(rows), rows)


def expected_calibration_error(
    samples: SampleSetV1,
    predictions: PredictionSetV1,
    *,
    bins: int,
    restrict_ids: tuple[str, ...] | None = None,
) -> MetricValueV1:
    require_strict_int(bins, field="bins", minimum=1, maximum=MAX_ECE_BINS)
    rows = _scored_rows(samples, predictions, restrict_ids)
    metric_id = f"ece:{bins}"
    if not rows:
        return _unknown(metric_id, "NO_SCOREABLE_SAMPLES", rows)
    if not _probability_rows(rows):
        return _unknown(metric_id, "SCORE_OUTSIDE_PROBABILITY_RANGE", rows)
    buckets: dict[int, list[_Scored]] = {}
    for row in rows:
        index = min(int(row.score * bins), bins - 1)
        buckets.setdefault(index, []).append(row)
    total = Fraction(0)
    for bucket in buckets.values():
        confidence = sum((row.score for row in bucket), Fraction(0)) / len(bucket)
        accuracy = Fraction(sum(1 for row in bucket if row.label), len(bucket))
        total += Fraction(len(bucket), len(rows)) * abs(confidence - accuracy)
    return _available(metric_id, total, rows)


def calibration_slope(
    samples: SampleSetV1,
    predictions: PredictionSetV1,
    *,
    restrict_ids: tuple[str, ...] | None = None,
) -> MetricValueV1:
    """Least-squares slope of outcomes on probability scores (diagnostic)."""

    rows = _scored_rows(samples, predictions, restrict_ids)
    if not rows:
        return _unknown("calibration_slope", "NO_SCOREABLE_SAMPLES", rows)
    if not _probability_rows(rows):
        return _unknown("calibration_slope", "SCORE_OUTSIDE_PROBABILITY_RANGE", rows)
    count = len(rows)
    mean_score = sum((row.score for row in rows), Fraction(0)) / count
    mean_label = Fraction(sum(1 for row in rows if row.label), count)
    covariance = Fraction(0)
    variance = Fraction(0)
    for row in rows:
        centered = row.score - mean_score
        outcome = Fraction(1 if row.label else 0)
        covariance += centered * (outcome - mean_label)
        variance += centered**2
    if variance == 0:
        return _unknown("calibration_slope", "CONSTANT_SCORES", rows)
    return _available("calibration_slope", covariance / variance, rows)


def evaluate_primary(
    spec: PrimaryMetricSpecV1,
    samples: SampleSetV1,
    predictions: PredictionSetV1,
    *,
    restrict_ids: tuple[str, ...] | None = None,
) -> MetricValueV1:
    if not isinstance(spec, PrimaryMetricSpecV1):
        raise ContractValueError("spec must be PrimaryMetricSpecV1")
    if spec.kind is MetricKind.PR_AUC:
        return pr_auc(samples, predictions, restrict_ids=restrict_ids)
    if spec.kind is MetricKind.ROC_AUC:
        return roc_auc(samples, predictions, restrict_ids=restrict_ids)
    if spec.kind is MetricKind.PRECISION_AT_K:
        return precision_at_k(samples, predictions, k=cast(int, spec.k), restrict_ids=restrict_ids)
    if spec.kind is MetricKind.RECALL_AT_K:
        return recall_at_k(samples, predictions, k=cast(int, spec.k), restrict_ids=restrict_ids)
    if spec.kind is MetricKind.BRIER:
        return brier_score(samples, predictions, restrict_ids=restrict_ids)
    return expected_calibration_error(
        samples, predictions, bins=cast(int, spec.ece_bins), restrict_ids=restrict_ids
    )
