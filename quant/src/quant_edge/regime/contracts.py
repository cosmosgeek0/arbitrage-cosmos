from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Final, Protocol

from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import FIXED_POINT_SCALE, FixedPointV1
from quant_edge.lake.contracts import (
    UTC_NS_MAX,
    UTC_NS_MIN,
    EvidencePosture,
    QualityState,
    require_contract_id,
    require_strict_int,
)

MAX_OBSERVATIONS: Final = 100_000
MAX_WEIGHT_BINS: Final = 4_096

_ALLOWED_POSTURES: Final = frozenset({EvidencePosture.SYNTHETIC, EvidencePosture.REPLAY})


class InputDisposition(StrEnum):
    """What a sequential detector may do with one observation; fail closed."""

    ELIGIBLE = "ELIGIBLE"
    SUPPRESS = "SUPPRESS"
    RESET = "RESET"


class StepStatus(StrEnum):
    OK = "OK"
    WARMUP = "WARMUP"
    SUPPRESSED = "SUPPRESSED"
    RESET = "RESET"


class AlarmDirection(StrEnum):
    UP = "UP"
    DOWN = "DOWN"


_DISPOSITION_BY_QUALITY: Final[dict[QualityState, InputDisposition]] = {
    QualityState.COMPLETE: InputDisposition.ELIGIBLE,
    QualityState.SYNTHETIC: InputDisposition.ELIGIBLE,
    QualityState.STALE: InputDisposition.SUPPRESS,
    QualityState.PARTIAL: InputDisposition.RESET,
    QualityState.GAPPED: InputDisposition.RESET,
    QualityState.RECONSTRUCTING: InputDisposition.RESET,
    QualityState.SAMPLED: InputDisposition.RESET,
    QualityState.UNAVAILABLE: InputDisposition.RESET,
    QualityState.UNKNOWN: InputDisposition.RESET,
}


def disposition_from_quality(quality: QualityState) -> InputDisposition:
    """Stale input freezes state; every gap-class quality resets it; missing never
    becomes zero and a gap never masquerades as continuity."""

    if not isinstance(quality, QualityState):
        raise ContractValueError("quality must be QualityState")
    return _DISPOSITION_BY_QUALITY[quality]


def _require_ns(value: object, *, field: str) -> int:
    return require_strict_int(value, field=field, minimum=UTC_NS_MIN, maximum=UTC_NS_MAX)


def require_fixed_point(value: object, *, field: str) -> FixedPointV1:
    if not isinstance(value, FixedPointV1):
        raise ContractValueError(f"{field} must be FixedPointV1")
    return value


@dataclass(frozen=True, slots=True)
class ObservationV1:
    """One detector input with explicit quality truth; quality is never implied."""

    event_time_ns: int
    ordinal: int
    value: FixedPointV1
    quality: QualityState

    def __post_init__(self) -> None:
        _require_ns(self.event_time_ns, field="event_time_ns")
        require_strict_int(self.ordinal, field="ordinal", minimum=0)
        require_fixed_point(self.value, field="value")
        if not isinstance(self.quality, QualityState):
            raise ContractValueError("quality must be QualityState")

    @property
    def disposition(self) -> InputDisposition:
        return disposition_from_quality(self.quality)

    def as_mapping(self) -> dict[str, object]:
        return {
            "eventTimeNs": str(self.event_time_ns),
            "ordinal": self.ordinal,
            "quality": self.quality.value,
            "value": self.value.as_mapping(),
        }


@dataclass(frozen=True, slots=True)
class ObservationSeriesV1:
    """Bounded, ordered detector-input series; posture is honest, never live."""

    series_id: str
    symbol: str
    posture: EvidencePosture
    points: tuple[ObservationV1, ...]

    def __post_init__(self) -> None:
        require_contract_id(self.series_id, field="series_id")
        require_contract_id(self.symbol, field="symbol")
        if not isinstance(self.posture, EvidencePosture) or (self.posture not in _ALLOWED_POSTURES):
            raise ContractValueError(
                "posture must be SYNTHETIC or REPLAY; Q09 owns no live market evidence"
            )
        if (
            not isinstance(self.points, tuple)
            or not self.points
            or len(self.points) > MAX_OBSERVATIONS
        ):
            raise ContractValueError(
                f"points must be a tuple of 1..{MAX_OBSERVATIONS} observations"
            )
        previous_time: int | None = None
        previous_ordinal: int | None = None
        for index, point in enumerate(self.points):
            if not isinstance(point, ObservationV1):
                raise ContractValueError(f"points[{index}] must be ObservationV1")
            if previous_time is not None and previous_ordinal is not None:
                if point.event_time_ns < previous_time:
                    raise ContractValueError("points must be time-ordered")
                if point.ordinal <= previous_ordinal:
                    raise ContractValueError("point ordinals must strictly increase")
            previous_time = point.event_time_ns
            previous_ordinal = point.ordinal

    def as_mapping(self) -> dict[str, object]:
        return {
            "points": [point.as_mapping() for point in self.points],
            "posture": self.posture.value,
            "seriesId": self.series_id,
            "symbol": self.symbol,
        }


class OrdinalGuard:
    """Rejects out-of-order streaming input instead of silently reordering it."""

    __slots__ = ("__last",)

    def __init__(self) -> None:
        self.__last: int | None = None

    def check(self, ordinal: int) -> None:
        require_strict_int(ordinal, field="ordinal", minimum=0)
        if self.__last is not None and ordinal <= self.__last:
            raise ContractValueError("streaming observations must be ordinal-ordered")
        self.__last = ordinal


def normalize_to_scale(
    weights: tuple[int, ...],
    *,
    target: int = FIXED_POINT_SCALE,
) -> tuple[int, ...]:
    """Deterministic largest-remainder normalization to an exact integer total.

    Ties between remainders break toward the lower index, so the law is total and
    platform-independent; the result always sums exactly to ``target``.
    """

    if not isinstance(weights, tuple) or not weights or len(weights) > MAX_WEIGHT_BINS:
        raise ContractValueError(f"weights must be a tuple of 1..{MAX_WEIGHT_BINS} integers")
    total = 0
    for index, weight in enumerate(weights):
        require_strict_int(weight, field=f"weights[{index}]", minimum=0, maximum=10**76)
        total += weight
    if total == 0:
        raise ContractValueError("weights must carry positive total mass")
    require_strict_int(target, field="target", minimum=1)
    base = [weight * target // total for weight in weights]
    remainders = [weight * target % total for weight in weights]
    leftover = target - sum(base)
    order = sorted(range(len(weights)), key=lambda index: (-remainders[index], index))
    for index in order[:leftover]:
        base[index] += 1
    return tuple(base)


class SequentialDetector[TStep](Protocol):
    def update(self, observation: ObservationV1) -> TStep:
        """Consume one observation and return the detector's typed step record."""


def run_series[TStep](
    detector: SequentialDetector[TStep],
    series: ObservationSeriesV1,
) -> tuple[TStep, ...]:
    if not isinstance(series, ObservationSeriesV1):
        raise ContractValueError("series must be ObservationSeriesV1")
    return tuple(detector.update(point) for point in series.points)


class AlarmStep(Protocol):
    @property
    def ordinal(self) -> int: ...

    @property
    def alarm(self) -> bool: ...


def alarm_ordinals(steps: tuple[AlarmStep, ...]) -> tuple[int, ...]:
    if not isinstance(steps, tuple):
        raise ContractValueError("steps must be a tuple")
    return tuple(step.ordinal for step in steps if step.alarm)
