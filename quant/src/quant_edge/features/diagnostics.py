from __future__ import annotations

from dataclasses import dataclass
from typing import Final

from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import FixedPointV1
from quant_edge.labels.rational import ExactRatioV1, make_ratio, ratio_compare
from quant_edge.lake.contracts import require_contract_id

MAX_COLUMNS: Final = 512
MAX_ROWS: Final = 100_000
MIN_PAIRWISE_ROWS: Final = 3

DIAGNOSTIC_OBLIGATIONS: Final = (
    "REGIME_PEARSON_RANK_DISTANCE_CORRELATION",
    "HIERARCHICAL_REDUNDANCY_CLUSTERING",
    "VARIANCE_AND_NEAR_CONSTANT_CHECKS",
    "MUTUAL_INFORMATION_IN_TRAINING_FOLDS",
    "PERMUTATION_IMPORTANCE_ON_CHRONOLOGICAL_HOLDOUTS",
    "SHAP_OR_EQUIVALENT_ATTRIBUTION",
    "SIGN_AND_MONOTONICITY_STABILITY_ACROSS_FOLDS_REGIMES",
    "MISSINGNESS_AS_SIGNAL_DETECTION",
    "ADVERSARIAL_FAMILY_ABLATION",
    "INCREMENTAL_VALUE_AFTER_ENGINE_FEATURES",
)
DEFERRED_DIAGNOSTICS: Final[tuple[str, ...]] = ()


@dataclass(frozen=True, slots=True)
class FeatureColumnV1:
    feature_id: str
    values: tuple[FixedPointV1 | None, ...]

    def __post_init__(self) -> None:
        require_contract_id(self.feature_id, field="feature_id")
        if not isinstance(self.values, tuple) or not self.values or (len(self.values) > MAX_ROWS):
            raise ContractValueError(f"values must be a tuple of 1..{MAX_ROWS} entries")
        for value in self.values:
            if value is not None and not isinstance(value, FixedPointV1):
                raise ContractValueError("values must contain FixedPointV1 or None")

    @property
    def missing_count(self) -> int:
        return sum(1 for value in self.values if value is None)


@dataclass(frozen=True, slots=True)
class PairwiseCorrelationV1:
    """Signed squared correlation as an exact rational; no irrational square root."""

    left_feature_id: str
    right_feature_id: str
    kind: str
    rows_used: int
    signed_r_squared: ExactRatioV1 | None

    def as_mapping(self) -> dict[str, object]:
        return {
            "kind": self.kind,
            "leftFeatureId": self.left_feature_id,
            "rightFeatureId": self.right_feature_id,
            "rowsUsed": self.rows_used,
            "signedRSquared": (
                None if self.signed_r_squared is None else self.signed_r_squared.as_mapping()
            ),
        }


@dataclass(frozen=True, slots=True)
class ColumnHealthV1:
    feature_id: str
    rows: int
    missing_count: int
    distinct_count: int
    near_constant: bool

    def as_mapping(self) -> dict[str, object]:
        return {
            "distinctCount": self.distinct_count,
            "featureId": self.feature_id,
            "missingCount": self.missing_count,
            "nearConstant": self.near_constant,
            "rows": self.rows,
        }


def _validate_columns(columns: tuple[FeatureColumnV1, ...]) -> int:
    if not isinstance(columns, tuple) or not columns or len(columns) > MAX_COLUMNS:
        raise ContractValueError(f"columns must be a tuple of 1..{MAX_COLUMNS} feature columns")
    first = columns[0]
    if not isinstance(first, FeatureColumnV1):
        raise ContractValueError("columns must contain FeatureColumnV1")
    length = len(first.values)
    seen: set[str] = set()
    for column in columns:
        if not isinstance(column, FeatureColumnV1):
            raise ContractValueError("columns must contain FeatureColumnV1")
        if column.feature_id in seen:
            raise ContractValueError("feature ids must be unique")
        seen.add(column.feature_id)
        if len(column.values) != length:
            raise ContractValueError("all feature columns must share one row count")
    return length


def column_health(columns: tuple[FeatureColumnV1, ...]) -> tuple[ColumnHealthV1, ...]:
    rows = _validate_columns(columns)
    reports = []
    for column in columns:
        present = [value.mantissa for value in column.values if value is not None]
        distinct = len(set(present))
        reports.append(
            ColumnHealthV1(
                feature_id=column.feature_id,
                rows=rows,
                missing_count=column.missing_count,
                distinct_count=distinct,
                near_constant=distinct <= 1,
            )
        )
    return tuple(reports)


def _signed_r_squared(pairs: list[tuple[int, int]]) -> ExactRatioV1 | None:
    count = len(pairs)
    sum_x = sum(x for x, _ in pairs)
    sum_y = sum(y for _, y in pairs)
    sum_xy = sum(x * y for x, y in pairs)
    sum_xx = sum(x * x for x, _ in pairs)
    sum_yy = sum(y * y for _, y in pairs)
    covariance = count * sum_xy - sum_x * sum_y
    variance_x = count * sum_xx - sum_x * sum_x
    variance_y = count * sum_yy - sum_y * sum_y
    if variance_x == 0 or variance_y == 0:
        return None
    sign = -1 if covariance < 0 else 1
    return make_ratio(sign * covariance * covariance, variance_x * variance_y)


def _midranks(values: list[int]) -> list[int]:
    """Average ranks doubled so tied midranks stay exact integers."""

    order = sorted(range(len(values)), key=lambda index: (values[index], index))
    doubled_ranks = [0] * len(values)
    position = 0
    while position < len(order):
        tail = position
        while tail + 1 < len(order) and values[order[tail + 1]] == values[order[position]]:
            tail += 1
        doubled = (position + 1) + (tail + 1)  # twice the average one-based rank
        for index in order[position : tail + 1]:
            doubled_ranks[index] = doubled
        position = tail + 1
    return doubled_ranks


def pairwise_correlation(
    left: FeatureColumnV1,
    right: FeatureColumnV1,
    *,
    kind: str,
) -> PairwiseCorrelationV1:
    """Pearson or Spearman signed r-squared over pairwise-complete rows."""

    _validate_columns((left, right))
    if kind not in ("PEARSON", "SPEARMAN"):
        raise ContractValueError("kind must be PEARSON or SPEARMAN")
    pairs = [
        (left_value.mantissa, right_value.mantissa)
        for left_value, right_value in zip(left.values, right.values, strict=True)
        if left_value is not None and right_value is not None
    ]
    if len(pairs) < MIN_PAIRWISE_ROWS:
        return PairwiseCorrelationV1(
            left_feature_id=left.feature_id,
            right_feature_id=right.feature_id,
            kind=kind,
            rows_used=len(pairs),
            signed_r_squared=None,
        )
    if kind == "SPEARMAN":
        left_ranks = _midranks([x for x, _ in pairs])
        right_ranks = _midranks([y for _, y in pairs])
        pairs = list(zip(left_ranks, right_ranks, strict=True))
    return PairwiseCorrelationV1(
        left_feature_id=left.feature_id,
        right_feature_id=right.feature_id,
        kind=kind,
        rows_used=len(pairs),
        signed_r_squared=_signed_r_squared(pairs),
    )


@dataclass(frozen=True, slots=True)
class RedundancyClusterV1:
    cluster_id: int
    feature_ids: tuple[str, ...]

    def as_mapping(self) -> dict[str, object]:
        return {"clusterId": self.cluster_id, "featureIds": list(self.feature_ids)}


def redundancy_clusters(
    columns: tuple[FeatureColumnV1, ...],
    *,
    r_squared_threshold: ExactRatioV1,
) -> tuple[RedundancyClusterV1, ...]:
    """Greedy single-link clustering on |signed r-squared| above the threshold.

    A cluster of correlated features is redundancy evidence, not intelligence.
    """

    _validate_columns(columns)
    if not isinstance(r_squared_threshold, ExactRatioV1) or r_squared_threshold.is_negative:
        raise ContractValueError("r_squared_threshold must be a non-negative ratio")
    parents = list(range(len(columns)))

    def find(index: int) -> int:
        while parents[index] != index:
            parents[index] = parents[parents[index]]
            index = parents[index]
        return index

    for i in range(len(columns)):
        for j in range(i + 1, len(columns)):
            correlation = pairwise_correlation(columns[i], columns[j], kind="PEARSON")
            observed = correlation.signed_r_squared
            if observed is None:
                continue
            magnitude = make_ratio(abs(observed.numerator), observed.denominator)
            if ratio_compare(magnitude, r_squared_threshold) >= 0:
                parents[find(i)] = find(j)
    grouped: dict[int, list[str]] = {}
    for index, column in enumerate(columns):
        grouped.setdefault(find(index), []).append(column.feature_id)
    clusters = sorted(
        (sorted(feature_ids) for feature_ids in grouped.values()),
        key=lambda ids: ids[0],
    )
    return tuple(
        RedundancyClusterV1(cluster_id=index, feature_ids=tuple(ids))
        for index, ids in enumerate(clusters)
    )


@dataclass(frozen=True, slots=True)
class MissingnessSignalV1:
    """Missingness may itself be signal; report it, never hide it."""

    feature_id: str
    rows: int
    missing_count: int
    longest_missing_run: int

    def as_mapping(self) -> dict[str, object]:
        return {
            "featureId": self.feature_id,
            "longestMissingRun": self.longest_missing_run,
            "missingCount": self.missing_count,
            "rows": self.rows,
        }


def missingness_signals(
    columns: tuple[FeatureColumnV1, ...],
) -> tuple[MissingnessSignalV1, ...]:
    rows = _validate_columns(columns)
    signals = []
    for column in columns:
        longest = 0
        current = 0
        for value in column.values:
            if value is None:
                current += 1
                longest = max(longest, current)
            else:
                current = 0
        signals.append(
            MissingnessSignalV1(
                feature_id=column.feature_id,
                rows=rows,
                missing_count=column.missing_count,
                longest_missing_run=longest,
            )
        )
    return tuple(signals)


def deferred_diagnostics() -> tuple[str, ...]:
    """All §12.3 obligations now have an owner; none remains silently deferred."""

    return DEFERRED_DIAGNOSTICS


def diagnostic_obligations() -> tuple[str, ...]:
    """The exact ten §12.3 obligations closed by Q06 plus Q14 diagnostics."""

    return DIAGNOSTIC_OBLIGATIONS
