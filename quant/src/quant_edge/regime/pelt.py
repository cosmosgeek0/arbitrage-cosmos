from __future__ import annotations

from dataclasses import dataclass
from typing import Final

from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import FIXED_POINT_SCALE, FixedPointV1, round_half_even
from quant_edge.lake.contracts import require_contract_id, require_strict_int
from quant_edge.regime.contracts import require_fixed_point

MAX_PELT_POINTS: Final = 2_048
MAX_PENALTY: Final = 10**38
# Quantized costs are bounded by n * MAX_FIXED_MANTISSA^2 / SCALE, which exceeds
# int64; the explicit magnitude bound keeps the contract strict without lying
# about the arithmetic range.
MAX_COST: Final = 10**76

# Half-even quantization perturbs each segment cost by at most half a cost unit, so
# the exact-SSE subadditivity C(a,c) >= C(a,b) + C(b,c) can be violated by at most
# 3/2 units after quantization; pruning with this integer slack keeps the dynamic
# program exactly optimal for the quantized objective.
PRUNING_SLACK: Final = 2


@dataclass(frozen=True, slots=True)
class PeltConfigV1:
    """Offline PELT law over the declared quantized SSE objective.

    The segment cost is the exact rational SSE quantized half-even once to integer
    units of ``value^2`` at the fixed-point scale; after that single documented
    rounding the search is exact integer arithmetic, so the optimizer is exactly
    optimal for the objective it declares. The penalty is in the same cost units.
    """

    segmenter_id: str
    penalty: int
    min_segment_length: int

    def __post_init__(self) -> None:
        require_contract_id(self.segmenter_id, field="segmenter_id")
        require_strict_int(self.penalty, field="penalty", minimum=0, maximum=MAX_PENALTY)
        require_strict_int(
            self.min_segment_length,
            field="min_segment_length",
            minimum=1,
            maximum=MAX_PELT_POINTS,
        )

    def as_mapping(self) -> dict[str, object]:
        return {
            "minSegmentLength": self.min_segment_length,
            "penalty": str(self.penalty),
            "segmenterId": self.segmenter_id,
        }


@dataclass(frozen=True, slots=True)
class SegmentV1:
    """One half-open ``[start, end)`` segment with its quantized mean and cost."""

    start: int
    end: int
    mean: FixedPointV1
    cost: int

    def __post_init__(self) -> None:
        start = require_strict_int(self.start, field="start", minimum=0)
        require_strict_int(self.end, field="end", minimum=start + 1)
        require_fixed_point(self.mean, field="mean")
        require_strict_int(self.cost, field="cost", minimum=0, maximum=MAX_COST)

    def as_mapping(self) -> dict[str, object]:
        return {
            "cost": str(self.cost),
            "end": self.end,
            "mean": self.mean.as_mapping(),
            "start": self.start,
        }


@dataclass(frozen=True, slots=True)
class SegmentationV1:
    segmenter_id: str
    point_count: int
    penalty: int
    segments: tuple[SegmentV1, ...]
    objective: int

    def __post_init__(self) -> None:
        require_contract_id(self.segmenter_id, field="segmenter_id")
        require_strict_int(self.point_count, field="point_count", minimum=1)
        require_strict_int(self.penalty, field="penalty", minimum=0, maximum=MAX_PENALTY)
        if not isinstance(self.segments, tuple) or not self.segments:
            raise ContractValueError("segments must be a non-empty tuple")
        cursor = 0
        total = 0
        for index, segment in enumerate(self.segments):
            if not isinstance(segment, SegmentV1):
                raise ContractValueError(f"segments[{index}] must be SegmentV1")
            if segment.start != cursor:
                raise ContractValueError("segments must tile the series contiguously")
            cursor = segment.end
            total += segment.cost
        if cursor != self.point_count:
            raise ContractValueError("segments must cover exactly the series length")
        expected = total + self.penalty * (len(self.segments) - 1)
        require_strict_int(self.objective, field="objective", minimum=0, maximum=MAX_COST)
        if self.objective != expected:
            raise ContractValueError("objective must equal segment costs plus penalties")

    @property
    def boundaries(self) -> tuple[int, ...]:
        return tuple(segment.start for segment in self.segments[1:])

    def as_mapping(self) -> dict[str, object]:
        return {
            "objective": str(self.objective),
            "penalty": str(self.penalty),
            "pointCount": self.point_count,
            "segmenterId": self.segmenter_id,
            "segments": [segment.as_mapping() for segment in self.segments],
        }


def _require_values(values: object) -> tuple[FixedPointV1, ...]:
    if not isinstance(values, tuple) or not values or len(values) > MAX_PELT_POINTS:
        raise ContractValueError(f"values must be a tuple of 1..{MAX_PELT_POINTS} fixed points")
    for index, value in enumerate(values):
        require_fixed_point(value, field=f"values[{index}]")
    return values


class _QuantizedSse:
    """Prefix-sum evaluator for the quantized segment cost, exact after quantization."""

    __slots__ = ("__sum", "__sum_sq")

    def __init__(self, values: tuple[FixedPointV1, ...]) -> None:
        self.__sum = [0]
        self.__sum_sq = [0]
        for value in values:
            self.__sum.append(self.__sum[-1] + value.mantissa)
            self.__sum_sq.append(self.__sum_sq[-1] + value.mantissa * value.mantissa)

    def cost(self, start: int, end: int) -> int:
        length = end - start
        linear = self.__sum[end] - self.__sum[start]
        square = self.__sum_sq[end] - self.__sum_sq[start]
        return round_half_even(length * square - linear * linear, length * FIXED_POINT_SCALE)

    def mean(self, start: int, end: int) -> FixedPointV1:
        linear = self.__sum[end] - self.__sum[start]
        return FixedPointV1(_signed_mean(linear, end - start))


def _signed_mean(total: int, count: int) -> int:
    sign = -1 if total < 0 else 1
    return sign * round_half_even(abs(total), count)


def segment_pelt(values: tuple[FixedPointV1, ...], config: PeltConfigV1) -> SegmentationV1:
    """Exact PELT over the quantized SSE objective with a documented pruning slack."""

    checked = _require_values(values)
    if not isinstance(config, PeltConfigV1):
        raise ContractValueError("config must be PeltConfigV1")
    length = len(checked)
    minimum = config.min_segment_length
    if length < minimum:
        raise ContractValueError("the series is shorter than one minimum segment")
    evaluator = _QuantizedSse(checked)
    penalty = config.penalty
    best_cost: list[int] = [-penalty] + [0] * length
    previous: list[int] = [0] * (length + 1)
    # Candidate starts stay ascending, are admitted only once a minimum-length
    # segment fits, and the running argmin always survives pruning, so the first
    # strict minimum is the lowest-start optimum and the list is never empty.
    candidates: list[int] = [0]
    for end in range(minimum, length + 1):
        best_start = candidates[0]
        best = best_cost[best_start] + evaluator.cost(best_start, end) + penalty
        for start in candidates[1:]:
            candidate = best_cost[start] + evaluator.cost(start, end) + penalty
            if candidate < best:
                best = candidate
                best_start = start
        best_cost[end] = best
        previous[end] = best_start
        candidates = [
            start
            for start in candidates
            if best_cost[start] + evaluator.cost(start, end) <= best + PRUNING_SLACK
        ]
        next_start = end - minimum + 1
        # A start is a lawful partition point only when the segment before it can
        # itself satisfy the minimum length (or it is the series origin).
        if next_start >= minimum:
            candidates.append(next_start)
    boundaries: list[int] = []
    cursor = length
    while cursor > 0:
        boundaries.append(previous[cursor])
        cursor = previous[cursor]
    boundaries.reverse()
    segments = []
    for index, start in enumerate(boundaries):
        end = boundaries[index + 1] if index + 1 < len(boundaries) else length
        segments.append(
            SegmentV1(
                start=start,
                end=end,
                mean=evaluator.mean(start, end),
                cost=evaluator.cost(start, end),
            )
        )
    objective = best_cost[length]
    return SegmentationV1(
        segmenter_id=config.segmenter_id,
        point_count=length,
        penalty=penalty,
        segments=tuple(segments),
        objective=objective,
    )
