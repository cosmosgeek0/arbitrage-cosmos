from __future__ import annotations

import functools
from dataclasses import dataclass
from enum import StrEnum
from typing import Final

from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import FIXED_POINT_SCALE, FixedPointV1, round_half_even
from quant_edge.lake.contracts import (
    UTC_NS_MAX,
    UTC_NS_MIN,
    QualityState,
    require_contract_id,
    require_strict_int,
)
from quant_edge.regime.contracts import require_fixed_point

MAX_ANALOG_WINDOW: Final = 256
MAX_ANALOG_RECORDS: Final = 10_000
MAX_NEIGHBORS: Final = 64


class AnalogExclusionReason(StrEnum):
    COHORT = "COHORT"
    SHAPE = "SHAPE"
    FUTURE = "FUTURE"
    OVERLAP = "OVERLAP"
    SAME_EVENT = "SAME_EVENT"
    DEGENERATE = "DEGENERATE"


class AnalogStatus(StrEnum):
    OK = "OK"
    NO_ANALOGS = "NO_ANALOGS"
    NO_QUERY_SIGNAL = "NO_QUERY_SIGNAL"


def _require_ns(value: object, *, field: str) -> int:
    return require_strict_int(value, field=field, minimum=UTC_NS_MIN, maximum=UTC_NS_MAX)


def _require_window_values(values: object, *, field: str) -> tuple[FixedPointV1, ...]:
    if not isinstance(values, tuple) or not 2 <= len(values) <= MAX_ANALOG_WINDOW:
        raise ContractValueError(f"{field} must be a tuple of 2..{MAX_ANALOG_WINDOW} fixed points")
    for index, value in enumerate(values):
        require_fixed_point(value, field=f"{field}[{index}]")
    return values


@dataclass(frozen=True, slots=True)
class AnalogRecordV1:
    """One stored earlier window with its later outcome and honest completeness.

    The outcome label is whatever the label factory assigned, including the honest
    ``UNKNOWN``. Its outcome horizon and availability time are explicit so retrieval
    cannot expose a label before that label was knowable.
    """

    record_id: str
    symbol: str
    regime_id: str
    feature_id: str
    start_ns: int
    end_ns: int
    outcome_start_ns: int
    outcome_end_ns: int
    label_available_ns: int
    values: tuple[FixedPointV1, ...]
    outcome_label: str
    completeness: QualityState
    event_id: str | None

    def __post_init__(self) -> None:
        require_contract_id(self.record_id, field="record_id")
        require_contract_id(self.symbol, field="symbol")
        require_contract_id(self.regime_id, field="regime_id")
        require_contract_id(self.feature_id, field="feature_id")
        start = _require_ns(self.start_ns, field="start_ns")
        end = require_strict_int(self.end_ns, field="end_ns", minimum=start + 1, maximum=UTC_NS_MAX)
        outcome_start = require_strict_int(
            self.outcome_start_ns,
            field="outcome_start_ns",
            minimum=end,
            maximum=UTC_NS_MAX,
        )
        outcome_end = require_strict_int(
            self.outcome_end_ns,
            field="outcome_end_ns",
            minimum=outcome_start + 1,
            maximum=UTC_NS_MAX,
        )
        require_strict_int(
            self.label_available_ns,
            field="label_available_ns",
            minimum=outcome_end,
            maximum=UTC_NS_MAX,
        )
        _require_window_values(self.values, field="values")
        require_contract_id(self.outcome_label, field="outcome_label")
        if not isinstance(self.completeness, QualityState):
            raise ContractValueError("completeness must be QualityState")
        if self.event_id is not None:
            require_contract_id(self.event_id, field="event_id")

    def as_mapping(self) -> dict[str, object]:
        return {
            "completeness": self.completeness.value,
            "endNs": str(self.end_ns),
            "eventId": self.event_id,
            "featureId": self.feature_id,
            "labelAvailableNs": str(self.label_available_ns),
            "outcomeEndNs": str(self.outcome_end_ns),
            "outcomeLabel": self.outcome_label,
            "outcomeStartNs": str(self.outcome_start_ns),
            "recordId": self.record_id,
            "regimeId": self.regime_id,
            "startNs": str(self.start_ns),
            "symbol": self.symbol,
            "values": [value.as_mapping() for value in self.values],
        }


@dataclass(frozen=True, slots=True)
class AnalogQueryV1:
    """The as-of query window; the cutoff/embargo law is the leakage boundary."""

    query_id: str
    symbol: str
    regime_id: str | None
    feature_id: str
    start_ns: int
    cutoff_ns: int
    embargo_ns: int
    values: tuple[FixedPointV1, ...]
    event_id: str | None

    def __post_init__(self) -> None:
        require_contract_id(self.query_id, field="query_id")
        require_contract_id(self.symbol, field="symbol")
        if self.regime_id is not None:
            require_contract_id(self.regime_id, field="regime_id")
        require_contract_id(self.feature_id, field="feature_id")
        start = _require_ns(self.start_ns, field="start_ns")
        require_strict_int(self.cutoff_ns, field="cutoff_ns", minimum=start + 1, maximum=UTC_NS_MAX)
        require_strict_int(self.embargo_ns, field="embargo_ns", minimum=0)
        _require_window_values(self.values, field="values")
        if self.event_id is not None:
            require_contract_id(self.event_id, field="event_id")

    def as_mapping(self) -> dict[str, object]:
        return {
            "cutoffNs": str(self.cutoff_ns),
            "embargoNs": str(self.embargo_ns),
            "eventId": self.event_id,
            "featureId": self.feature_id,
            "queryId": self.query_id,
            "regimeId": self.regime_id,
            "startNs": str(self.start_ns),
            "symbol": self.symbol,
            "values": [value.as_mapping() for value in self.values],
        }


@dataclass(frozen=True, slots=True)
class AnalogNeighborV1:
    record_id: str
    end_ns: int
    similarity: FixedPointV1
    outcome_label: str
    completeness: QualityState

    def __post_init__(self) -> None:
        require_contract_id(self.record_id, field="record_id")
        require_strict_int(self.end_ns, field="end_ns", minimum=0)
        similarity = require_fixed_point(self.similarity, field="similarity")
        if abs(similarity.mantissa) > FIXED_POINT_SCALE:
            raise ContractValueError("similarity must lie inside [-1, 1]")
        require_contract_id(self.outcome_label, field="outcome_label")
        if not isinstance(self.completeness, QualityState):
            raise ContractValueError("completeness must be QualityState")

    def as_mapping(self) -> dict[str, object]:
        return {
            "completeness": self.completeness.value,
            "endNs": str(self.end_ns),
            "outcomeLabel": self.outcome_label,
            "recordId": self.record_id,
            "similarity": self.similarity.as_mapping(),
        }


@dataclass(frozen=True, slots=True)
class AnalogRetrievalV1:
    """Earlier-only retrieval truth: neighbors, measured exclusions and the outcome
    distribution over the retrieved cohort, never cherry-picked examples."""

    query_id: str
    status: AnalogStatus
    requested_k: int
    cohort_size: int
    neighbors: tuple[AnalogNeighborV1, ...]
    outcome_counts: tuple[tuple[str, int], ...]
    exclusion_counts: tuple[tuple[AnalogExclusionReason, int], ...]

    def __post_init__(self) -> None:
        require_contract_id(self.query_id, field="query_id")
        if not isinstance(self.status, AnalogStatus):
            raise ContractValueError("status must be AnalogStatus")
        require_strict_int(self.requested_k, field="requested_k", minimum=1)
        require_strict_int(self.cohort_size, field="cohort_size", minimum=0)
        if not isinstance(self.neighbors, tuple) or len(self.neighbors) > self.requested_k:
            raise ContractValueError("neighbors must be a tuple bounded by requested_k")
        for index, neighbor in enumerate(self.neighbors):
            if not isinstance(neighbor, AnalogNeighborV1):
                raise ContractValueError(f"neighbors[{index}] must be AnalogNeighborV1")
        if (self.status is AnalogStatus.OK) != bool(self.neighbors):
            raise ContractValueError("neighbors exist exactly when the status is OK")
        if self.status is AnalogStatus.NO_QUERY_SIGNAL and self.cohort_size != 0:
            raise ContractValueError("a signal-free query retrieves no cohort")
        if len(self.neighbors) != min(self.requested_k, self.cohort_size):
            raise ContractValueError("neighbors must exhaust the cohort up to requested_k")
        if not isinstance(self.outcome_counts, tuple):
            raise ContractValueError("outcome_counts must be a tuple")
        total = 0
        previous_label: str | None = None
        for label, count in self.outcome_counts:
            require_contract_id(label, field="outcome_counts")
            require_strict_int(count, field="outcome_counts", minimum=1)
            if previous_label is not None and label <= previous_label:
                raise ContractValueError("outcome_counts must be sorted by unique label")
            previous_label = label
            total += count
        if total != len(self.neighbors):
            raise ContractValueError("outcome_counts must cover exactly the neighbors")
        if not isinstance(self.exclusion_counts, tuple) or len(self.exclusion_counts) != len(
            AnalogExclusionReason
        ):
            raise ContractValueError("exclusion_counts must cover every reason once")
        seen = []
        for reason, count in self.exclusion_counts:
            if not isinstance(reason, AnalogExclusionReason):
                raise ContractValueError("exclusion_counts keys must be reasons")
            require_strict_int(count, field="exclusion_counts", minimum=0)
            seen.append(reason.value)
        if seen != sorted(seen):
            raise ContractValueError("exclusion_counts must be sorted by reason")

    def as_mapping(self) -> dict[str, object]:
        return {
            "cohortSize": self.cohort_size,
            "exclusionCounts": {reason.value: count for reason, count in self.exclusion_counts},
            "neighbors": [neighbor.as_mapping() for neighbor in self.neighbors],
            "outcomeCounts": dict(self.outcome_counts),
            "queryId": self.query_id,
            "requestedK": self.requested_k,
            "status": self.status.value,
        }


def _centered_moments(values: tuple[FixedPointV1, ...]) -> tuple[int, int]:
    total = sum(value.mantissa for value in values)
    square = sum(value.mantissa * value.mantissa for value in values)
    return total, len(values) * square - total * total


def _correlation_key(cov: int, variance: int) -> tuple[int, int, int]:
    """Correlation-order pieces compared exactly by `_beats`; no square roots."""

    sign = 0 if cov == 0 else (1 if cov > 0 else -1)
    return (sign, cov, variance)


def _beats(candidate: tuple[int, int, int], incumbent: tuple[int, int, int]) -> bool:
    candidate_sign, candidate_cov, candidate_var = candidate
    incumbent_sign, incumbent_cov, incumbent_var = incumbent
    if candidate_sign != incumbent_sign:
        return candidate_sign > incumbent_sign
    if candidate_sign == 0:
        return False
    candidate_magnitude = candidate_cov * candidate_cov * incumbent_var
    incumbent_magnitude = incumbent_cov * incumbent_cov * candidate_var
    if candidate_sign > 0:
        return candidate_magnitude > incumbent_magnitude
    return candidate_magnitude < incumbent_magnitude


def retrieve_analogs(
    query: AnalogQueryV1,
    records: tuple[AnalogRecordV1, ...],
    *,
    k: int,
) -> AnalogRetrievalV1:
    """Rank earlier, label-available, identity-safe records against the query.

    Exclusions are measured per reason and ties break deterministically by earlier
    end time then record identity.
    """

    if not isinstance(query, AnalogQueryV1):
        raise ContractValueError("query must be AnalogQueryV1")
    if not isinstance(records, tuple) or len(records) > MAX_ANALOG_RECORDS:
        raise ContractValueError(f"records must be a tuple of at most {MAX_ANALOG_RECORDS}")
    require_strict_int(k, field="k", minimum=1, maximum=MAX_NEIGHBORS)
    exclusions = dict.fromkeys(AnalogExclusionReason, 0)
    query_total, query_variance = _centered_moments(query.values)
    if query_variance == 0:
        return _empty(query, k, AnalogStatus.NO_QUERY_SIGNAL, exclusions)
    horizon = query.cutoff_ns - query.embargo_ns
    ranked: list[tuple[tuple[int, int, int], int, str, AnalogRecordV1]] = []
    for position, record in enumerate(records):
        if not isinstance(record, AnalogRecordV1):
            raise ContractValueError(f"records[{position}] must be AnalogRecordV1")
        if record.symbol != query.symbol or (
            query.regime_id is not None and record.regime_id != query.regime_id
        ):
            exclusions[AnalogExclusionReason.COHORT] += 1
            continue
        if record.feature_id != query.feature_id or len(record.values) != len(query.values):
            exclusions[AnalogExclusionReason.SHAPE] += 1
            continue
        if record.end_ns > horizon or record.label_available_ns > horizon:
            exclusions[AnalogExclusionReason.FUTURE] += 1
            continue
        if record.end_ns > query.start_ns:
            exclusions[AnalogExclusionReason.OVERLAP] += 1
            continue
        if record.event_id is None or query.event_id is None or record.event_id == query.event_id:
            exclusions[AnalogExclusionReason.SAME_EVENT] += 1
            continue
        record_total, record_variance = _centered_moments(record.values)
        if record_variance == 0:
            exclusions[AnalogExclusionReason.DEGENERATE] += 1
            continue
        window = len(query.values)
        cross = sum(
            query.values[index].mantissa * record.values[index].mantissa for index in range(window)
        )
        cov = window * cross - query_total * record_total
        ranked.append(
            (_correlation_key(cov, record_variance), record.end_ns, record.record_id, record)
        )
    if not ranked:
        return _empty(query, k, AnalogStatus.NO_ANALOGS, exclusions)
    ordered = sorted(ranked, key=functools.cmp_to_key(_rank_order))
    neighbors = []
    counts: dict[str, int] = {}
    for key, end_ns, record_id, record in ordered[:k]:
        _, cov, variance = key
        sign = -1 if cov < 0 else 1
        mantissa = round_half_even(cov * cov * FIXED_POINT_SCALE, query_variance * variance)
        neighbors.append(
            AnalogNeighborV1(
                record_id=record_id,
                end_ns=end_ns,
                similarity=FixedPointV1(sign * mantissa),
                outcome_label=record.outcome_label,
                completeness=record.completeness,
            )
        )
        counts[record.outcome_label] = counts.get(record.outcome_label, 0) + 1
    return AnalogRetrievalV1(
        query_id=query.query_id,
        status=AnalogStatus.OK,
        requested_k=k,
        cohort_size=len(ranked),
        neighbors=tuple(neighbors),
        outcome_counts=tuple(sorted(counts.items())),
        exclusion_counts=tuple(sorted(exclusions.items(), key=lambda item: item[0].value)),
    )


def _rank_order(
    left: tuple[tuple[int, int, int], int, str, AnalogRecordV1],
    right: tuple[tuple[int, int, int], int, str, AnalogRecordV1],
) -> int:
    """Higher correlation first; ties by earlier end time, then record identity."""

    if _beats(left[0], right[0]):
        return -1
    if _beats(right[0], left[0]):
        return 1
    if (left[1], left[2]) < (right[1], right[2]):
        return -1
    if (left[1], left[2]) > (right[1], right[2]):
        return 1
    return 0


def _empty(
    query: AnalogQueryV1,
    k: int,
    status: AnalogStatus,
    exclusions: dict[AnalogExclusionReason, int],
) -> AnalogRetrievalV1:
    return AnalogRetrievalV1(
        query_id=query.query_id,
        status=status,
        requested_k=k,
        cohort_size=0,
        neighbors=(),
        outcome_counts=(),
        exclusion_counts=tuple(sorted(exclusions.items(), key=lambda item: item[0].value)),
    )
