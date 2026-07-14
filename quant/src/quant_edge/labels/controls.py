from __future__ import annotations

import hashlib
from dataclasses import dataclass
from enum import StrEnum
from typing import Final

from quant_edge.canonical import canonical_json_bytes
from quant_edge.errors import ContractValueError
from quant_edge.labels.identity import SampleIdentityV1
from quant_edge.labels.rational import ExactRatioV1, ratio_compare
from quant_edge.lake.contracts import (
    UTC_NS_MAX,
    UTC_NS_MIN,
    DigestV1,
    require_contract_id,
    require_strict_int,
)

DAY_NS: Final = 86_400_000_000_000
MAX_POOL: Final = 100_000
MAX_BUCKET_EDGES: Final = 64
MAX_MATCHED_CONTROLS: Final = 1_024


class ControlRejectionReason(StrEnum):
    SYMBOL_MISMATCH = "SYMBOL_MISMATCH"
    LIQUIDITY_BUCKET_MISMATCH = "LIQUIDITY_BUCKET_MISMATCH"
    VOLATILITY_BUCKET_MISMATCH = "VOLATILITY_BUCKET_MISMATCH"
    REGIME_MISMATCH = "REGIME_MISMATCH"
    TIME_OF_DAY_MISMATCH = "TIME_OF_DAY_MISMATCH"
    FUNDING_CYCLE_MISMATCH = "FUNDING_CYCLE_MISMATCH"
    INCOMPLETE_EVIDENCE = "INCOMPLETE_EVIDENCE"
    OVERLAPS_FEATURE_OR_LABEL_INTERVAL = "OVERLAPS_FEATURE_OR_LABEL_INTERVAL"


def _require_ns(value: object, *, field: str) -> int:
    return require_strict_int(value, field=field, minimum=UTC_NS_MIN, maximum=UTC_NS_MAX)


@dataclass(frozen=True, slots=True)
class WindowFactsV1:
    """Self-contained observable facts about one window; no future membership field
    exists, so future event knowledge cannot leak into eligibility."""

    window_id: str
    symbol: str
    window_start_ns: int
    window_end_ns: int
    row_count: int
    value_range_ratio: ExactRatioV1
    regime_id: str
    completeness_known: bool
    gap_row_count: int

    def __post_init__(self) -> None:
        require_contract_id(self.window_id, field="window_id")
        require_contract_id(self.symbol, field="symbol")
        start = _require_ns(self.window_start_ns, field="window_start_ns")
        end = _require_ns(self.window_end_ns, field="window_end_ns")
        if start >= end:
            raise ContractValueError("window start must precede window end")
        require_strict_int(self.row_count, field="row_count", minimum=0)
        if not isinstance(self.value_range_ratio, ExactRatioV1):
            raise ContractValueError("value_range_ratio must be ExactRatioV1")
        if self.value_range_ratio.is_negative:
            raise ContractValueError("value_range_ratio cannot be negative")
        require_contract_id(self.regime_id, field="regime_id")
        if not isinstance(self.completeness_known, bool):
            raise ContractValueError("completeness_known must be boolean")
        require_strict_int(self.gap_row_count, field="gap_row_count", minimum=0)

    def as_mapping(self) -> dict[str, object]:
        return {
            "completenessKnown": self.completeness_known,
            "gapRowCount": self.gap_row_count,
            "regimeId": self.regime_id,
            "rowCount": self.row_count,
            "symbol": self.symbol,
            "valueRangeRatio": self.value_range_ratio.as_mapping(),
            "windowEndNs": str(self.window_end_ns),
            "windowId": self.window_id,
            "windowStartNs": str(self.window_start_ns),
        }


@dataclass(frozen=True, slots=True)
class ControlMatchSpecV1:
    match_version: str
    liquidity_bucket_edges: tuple[int, ...]
    volatility_bucket_edges: tuple[ExactRatioV1, ...]
    time_of_day_bucket_ns: int
    funding_cycle_ns: int
    max_controls: int

    def __post_init__(self) -> None:
        require_contract_id(self.match_version, field="match_version")
        if (
            not isinstance(self.liquidity_bucket_edges, tuple)
            or not self.liquidity_bucket_edges
            or len(self.liquidity_bucket_edges) > MAX_BUCKET_EDGES
        ):
            raise ContractValueError("liquidity_bucket_edges must be a bounded non-empty tuple")
        previous = -1
        for edge in self.liquidity_bucket_edges:
            require_strict_int(edge, field="liquidity_bucket_edges", minimum=0)
            if edge <= previous:
                raise ContractValueError("liquidity bucket edges must strictly increase")
            previous = edge
        if (
            not isinstance(self.volatility_bucket_edges, tuple)
            or not self.volatility_bucket_edges
            or len(self.volatility_bucket_edges) > MAX_BUCKET_EDGES
        ):
            raise ContractValueError("volatility_bucket_edges must be a bounded non-empty tuple")
        previous_ratio: ExactRatioV1 | None = None
        for edge_ratio in self.volatility_bucket_edges:
            if not isinstance(edge_ratio, ExactRatioV1) or edge_ratio.is_negative:
                raise ContractValueError("volatility bucket edges must be non-negative ratios")
            if previous_ratio is not None and ratio_compare(edge_ratio, previous_ratio) <= 0:
                raise ContractValueError("volatility bucket edges must strictly increase")
            previous_ratio = edge_ratio
        require_strict_int(
            self.time_of_day_bucket_ns,
            field="time_of_day_bucket_ns",
            minimum=1,
            maximum=DAY_NS,
        )
        if DAY_NS % self.time_of_day_bucket_ns != 0:
            raise ContractValueError("time-of-day buckets must divide the day exactly")
        require_strict_int(
            self.funding_cycle_ns,
            field="funding_cycle_ns",
            minimum=1,
            maximum=DAY_NS,
        )
        require_strict_int(
            self.max_controls,
            field="max_controls",
            minimum=1,
            maximum=MAX_MATCHED_CONTROLS,
        )

    def as_mapping(self) -> dict[str, object]:
        return {
            "fundingCycleNs": str(self.funding_cycle_ns),
            "liquidityBucketEdges": list(self.liquidity_bucket_edges),
            "matchVersion": self.match_version,
            "maxControls": self.max_controls,
            "timeOfDayBucketNs": str(self.time_of_day_bucket_ns),
            "volatilityBucketEdges": [edge.as_mapping() for edge in self.volatility_bucket_edges],
        }

    def liquidity_bucket(self, row_count: int) -> int:
        bucket = 0
        for edge in self.liquidity_bucket_edges:
            if row_count > edge:
                bucket += 1
        return bucket

    def volatility_bucket(self, value_range_ratio: ExactRatioV1) -> int:
        bucket = 0
        for edge in self.volatility_bucket_edges:
            if ratio_compare(value_range_ratio, edge) > 0:
                bucket += 1
        return bucket

    def time_of_day_bucket(self, time_ns: int) -> int:
        return (time_ns % DAY_NS) // self.time_of_day_bucket_ns

    def funding_cycle_bucket(self, time_ns: int) -> int:
        return (time_ns % DAY_NS) // self.funding_cycle_ns


@dataclass(frozen=True, slots=True)
class ControlMatchResultV1:
    match_version: str
    sample_id: str
    selected_window_ids: tuple[str, ...]
    rejection_counts: tuple[tuple[str, int], ...]
    result_digest: DigestV1

    def __post_init__(self) -> None:
        require_contract_id(self.match_version, field="match_version")
        require_contract_id(self.sample_id, field="sample_id")
        if not isinstance(self.selected_window_ids, tuple) or (
            self.selected_window_ids != tuple(sorted(set(self.selected_window_ids)))
        ):
            raise ContractValueError("selected window ids must be sorted and unique")
        expected = _match_digest(
            match_version=self.match_version,
            sample_id=self.sample_id,
            selected_window_ids=self.selected_window_ids,
            rejection_counts=self.rejection_counts,
        )
        if self.result_digest != expected:
            raise ContractValueError("result digest disagrees with the match content")

    def as_mapping(self) -> dict[str, object]:
        return {
            "matchVersion": self.match_version,
            "rejectionCounts": dict(self.rejection_counts),
            "resultSha256": self.result_digest.hexdigest,
            "sampleId": self.sample_id,
            "schema": "Q05ControlMatchResultV1",
            "selectedWindowIds": list(self.selected_window_ids),
            "version": 1,
        }


def _match_digest(
    *,
    match_version: str,
    sample_id: str,
    selected_window_ids: tuple[str, ...],
    rejection_counts: tuple[tuple[str, int], ...],
) -> DigestV1:
    mapping = {
        "matchVersion": match_version,
        "rejectionCounts": dict(rejection_counts),
        "sampleId": sample_id,
        "schema": "Q05ControlMatchResultV1",
        "selectedWindowIds": list(selected_window_ids),
        "version": 1,
    }
    return DigestV1(hashlib.sha256(canonical_json_bytes(mapping)).hexdigest())


def match_controls(
    sample: SampleIdentityV1,
    candidate_facts: WindowFactsV1,
    pool: tuple[WindowFactsV1, ...],
    spec: ControlMatchSpecV1,
) -> ControlMatchResultV1:
    """Deterministically match §11.6 non-event controls to one candidate sample.

    Eligibility uses only each window's own observable facts plus the candidate's
    pre-cutoff facts; there is no field through which future event membership could
    influence selection.
    """

    if not isinstance(sample, SampleIdentityV1):
        raise ContractValueError("sample must be SampleIdentityV1")
    if not isinstance(candidate_facts, WindowFactsV1):
        raise ContractValueError("candidate_facts must be WindowFactsV1")
    if candidate_facts.symbol != sample.instrument.symbol:
        raise ContractValueError("candidate facts must describe the sample instrument")
    if (
        not isinstance(pool, tuple)
        or len(pool) > MAX_POOL
        or any(not isinstance(entry, WindowFactsV1) for entry in pool)
    ):
        raise ContractValueError("pool must be a bounded tuple of WindowFactsV1")
    pool_ids = [entry.window_id for entry in pool]
    if len(set(pool_ids)) != len(pool_ids):
        raise ContractValueError("pool window ids must be unique")
    if not isinstance(spec, ControlMatchSpecV1):
        raise ContractValueError("spec must be ControlMatchSpecV1")

    exclusion_start = sample.feature_lookback_start_ns
    exclusion_end = sample.label_end_ns
    candidate_liquidity = spec.liquidity_bucket(candidate_facts.row_count)
    candidate_volatility = spec.volatility_bucket(candidate_facts.value_range_ratio)
    candidate_time_bucket = spec.time_of_day_bucket(candidate_facts.window_start_ns)
    candidate_funding_bucket = spec.funding_cycle_bucket(candidate_facts.window_start_ns)

    rejections: dict[str, int] = {reason.value: 0 for reason in ControlRejectionReason}
    eligible: list[str] = []
    for entry in sorted(pool, key=lambda facts: facts.window_id):
        if entry.symbol != sample.instrument.symbol:
            rejections[ControlRejectionReason.SYMBOL_MISMATCH.value] += 1
            continue
        if not entry.completeness_known or entry.gap_row_count > 0:
            rejections[ControlRejectionReason.INCOMPLETE_EVIDENCE.value] += 1
            continue
        if entry.window_start_ns < exclusion_end and exclusion_start < entry.window_end_ns:
            rejections[ControlRejectionReason.OVERLAPS_FEATURE_OR_LABEL_INTERVAL.value] += 1
            continue
        if entry.regime_id != candidate_facts.regime_id:
            rejections[ControlRejectionReason.REGIME_MISMATCH.value] += 1
            continue
        if spec.liquidity_bucket(entry.row_count) != candidate_liquidity:
            rejections[ControlRejectionReason.LIQUIDITY_BUCKET_MISMATCH.value] += 1
            continue
        if spec.volatility_bucket(entry.value_range_ratio) != candidate_volatility:
            rejections[ControlRejectionReason.VOLATILITY_BUCKET_MISMATCH.value] += 1
            continue
        if spec.time_of_day_bucket(entry.window_start_ns) != candidate_time_bucket:
            rejections[ControlRejectionReason.TIME_OF_DAY_MISMATCH.value] += 1
            continue
        if spec.funding_cycle_bucket(entry.window_start_ns) != candidate_funding_bucket:
            rejections[ControlRejectionReason.FUNDING_CYCLE_MISMATCH.value] += 1
            continue
        eligible.append(entry.window_id)
    selected = tuple(eligible[: spec.max_controls])
    rejection_counts = tuple(sorted(rejections.items()))
    return ControlMatchResultV1(
        match_version=spec.match_version,
        sample_id=sample.sample_id,
        selected_window_ids=selected,
        rejection_counts=rejection_counts,
        result_digest=_match_digest(
            match_version=spec.match_version,
            sample_id=sample.sample_id,
            selected_window_ids=selected,
            rejection_counts=rejection_counts,
        ),
    )
