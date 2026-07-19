from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Final, cast

from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import MAX_FIXED_MANTISSA
from quant_edge.labels.rational import scaled_to_aligned
from quant_edge.lake.contracts import (
    UTC_NS_MAX,
    UTC_NS_MIN,
    EvidencePosture,
    ExactScaledValueV1,
    require_contract_id,
    require_strict_int,
)

MAX_FEATURE_POINTS: Final = 100_000
MAX_BARS: Final = 100_000
MAX_TRADES_PER_BAR: Final = 1_000_000
MAX_BAR_ALIGNED_VALUE: Final = MAX_FIXED_MANTISSA * 10**26

_ALLOWED_POSTURES: Final = frozenset({EvidencePosture.SYNTHETIC, EvidencePosture.REPLAY})


class BarDomain(StrEnum):
    WALL_TIME = "WALL_TIME"
    EVENT_TIME = "EVENT_TIME"
    TRADE_COUNT = "TRADE_COUNT"
    VOLUME = "VOLUME"


def _require_ns(value: object, *, field: str) -> int:
    return require_strict_int(value, field=field, minimum=UTC_NS_MIN, maximum=UTC_NS_MAX)


def _require_scaled(value: object, *, field: str, positive: bool) -> ExactScaledValueV1:
    if not isinstance(value, ExactScaledValueV1):
        raise ContractValueError(f"{field} must be ExactScaledValueV1")
    if positive and value.coefficient <= 0:
        raise ContractValueError(f"{field} must be strictly positive")
    if not positive and value.coefficient < 0:
        raise ContractValueError(f"{field} cannot be negative")
    return value


@dataclass(frozen=True, slots=True)
class FeaturePointV1:
    """One observation with value and non-negative volume; volume may be unknown."""

    event_time_ns: int
    ordinal: int
    value: ExactScaledValueV1
    volume: ExactScaledValueV1 | None

    def __post_init__(self) -> None:
        _require_ns(self.event_time_ns, field="event_time_ns")
        require_strict_int(self.ordinal, field="ordinal", minimum=0)
        _require_scaled(self.value, field="value", positive=True)
        if self.volume is not None:
            _require_scaled(self.volume, field="volume", positive=False)

    @property
    def value_aligned(self) -> int:
        return scaled_to_aligned(self.value)

    @property
    def volume_aligned(self) -> int | None:
        return None if self.volume is None else scaled_to_aligned(self.volume)

    def as_mapping(self) -> dict[str, object]:
        return {
            "eventTimeNs": str(self.event_time_ns),
            "ordinal": self.ordinal,
            "value": {
                "coefficient": str(self.value.coefficient),
                "scale": self.value.scale,
                "unitId": self.value.unit_id,
            },
            "volume": (
                None
                if self.volume is None
                else {
                    "coefficient": str(self.volume.coefficient),
                    "scale": self.volume.scale,
                    "unitId": self.volume.unit_id,
                }
            ),
        }


@dataclass(frozen=True, slots=True)
class FeatureSeriesV1:
    """Feature-domain evidence series with explicit completeness and honest posture."""

    series_id: str
    symbol: str
    posture: EvidencePosture
    completeness_start_ns: int
    completeness_end_ns: int
    points: tuple[FeaturePointV1, ...]

    def __post_init__(self) -> None:
        require_contract_id(self.series_id, field="series_id")
        require_contract_id(self.symbol, field="symbol")
        if not isinstance(self.posture, EvidencePosture) or (self.posture not in _ALLOWED_POSTURES):
            raise ContractValueError(
                "posture must be SYNTHETIC or REPLAY; Q06 owns no live market evidence"
            )
        start = _require_ns(self.completeness_start_ns, field="completeness_start_ns")
        end = _require_ns(self.completeness_end_ns, field="completeness_end_ns")
        if start >= end:
            raise ContractValueError("completeness interval must be non-empty")
        if (
            not isinstance(self.points, tuple)
            or not self.points
            or len(self.points) > MAX_FEATURE_POINTS
        ):
            raise ContractValueError(
                f"points must be a tuple of 1..{MAX_FEATURE_POINTS} feature points"
            )
        previous_time: int | None = None
        previous_ordinal: int | None = None
        first_point = self.points[0]
        if not isinstance(first_point, FeaturePointV1):
            raise ContractValueError("points[0] must be FeaturePointV1")
        volume_known = first_point.volume is not None
        for index, point in enumerate(self.points):
            if not isinstance(point, FeaturePointV1):
                raise ContractValueError(f"points[{index}] must be FeaturePointV1")
            if previous_time is not None and previous_ordinal is not None:
                if point.event_time_ns < previous_time:
                    raise ContractValueError("points must be time-ordered")
                if point.ordinal <= previous_ordinal:
                    raise ContractValueError("point ordinals must strictly increase")
            if (point.volume is not None) != volume_known:
                raise ContractValueError(
                    "volume must be known for every point or for none; a mixed series "
                    "would let unknown volume masquerade as zero"
                )
            previous_time = point.event_time_ns
            previous_ordinal = point.ordinal
        if self.points[0].event_time_ns < start or self.points[-1].event_time_ns > end:
            raise ContractValueError("points must lie inside the completeness interval")

    @property
    def volume_known(self) -> bool:
        return self.points[0].volume is not None

    def as_mapping(self) -> dict[str, object]:
        return {
            "completenessEndNs": str(self.completeness_end_ns),
            "completenessStartNs": str(self.completeness_start_ns),
            "points": [point.as_mapping() for point in self.points],
            "posture": self.posture.value,
            "seriesId": self.series_id,
            "symbol": self.symbol,
        }


@dataclass(frozen=True, slots=True)
class WallTimeBarSpecV1:
    """Half-open ``[anchor + i*width, anchor + (i+1)*width)`` bars with empty-bar truth."""

    wall_width_ns: int
    anchor_ns: int

    def __post_init__(self) -> None:
        require_strict_int(self.wall_width_ns, field="wall_width_ns", minimum=1)
        _require_ns(self.anchor_ns, field="anchor_ns")

    @property
    def domain(self) -> BarDomain:
        return BarDomain.WALL_TIME

    def as_mapping(self) -> dict[str, object]:
        return {
            "anchorNs": str(self.anchor_ns),
            "domain": self.domain.value,
            "wallWidthNs": str(self.wall_width_ns),
        }


@dataclass(frozen=True, slots=True)
class EventTimeBarSpecV1:
    """One bar per observation; the event clock is the sampling clock."""

    @property
    def domain(self) -> BarDomain:
        return BarDomain.EVENT_TIME

    def as_mapping(self) -> dict[str, object]:
        return {"domain": self.domain.value}


@dataclass(frozen=True, slots=True)
class TradeCountBarSpecV1:
    trades_per_bar: int

    def __post_init__(self) -> None:
        require_strict_int(
            self.trades_per_bar,
            field="trades_per_bar",
            minimum=1,
            maximum=MAX_TRADES_PER_BAR,
        )

    @property
    def domain(self) -> BarDomain:
        return BarDomain.TRADE_COUNT

    def as_mapping(self) -> dict[str, object]:
        return {"domain": self.domain.value, "tradesPerBar": self.trades_per_bar}


@dataclass(frozen=True, slots=True)
class VolumeBarSpecV1:
    volume_threshold: ExactScaledValueV1

    def __post_init__(self) -> None:
        _require_scaled(self.volume_threshold, field="volume_threshold", positive=True)

    @property
    def domain(self) -> BarDomain:
        return BarDomain.VOLUME

    def as_mapping(self) -> dict[str, object]:
        return {
            "domain": self.domain.value,
            "volumeThreshold": {
                "coefficient": str(self.volume_threshold.coefficient),
                "scale": self.volume_threshold.scale,
                "unitId": self.volume_threshold.unit_id,
            },
        }


BarSpec = WallTimeBarSpecV1 | EventTimeBarSpecV1 | TradeCountBarSpecV1 | VolumeBarSpecV1


@dataclass(frozen=True, slots=True)
class BarV1:
    """One closed or explicitly incomplete bar; empty wall bars are honest truth."""

    index: int
    start_ns: int
    end_ns: int
    point_count: int
    first_value_aligned: int | None
    last_value_aligned: int | None
    volume_aligned_total: int | None
    complete: bool

    def __post_init__(self) -> None:
        require_strict_int(self.index, field="index", minimum=0, maximum=MAX_BARS)
        start = _require_ns(self.start_ns, field="start_ns")
        require_strict_int(self.end_ns, field="end_ns", minimum=start + 1)
        require_strict_int(self.point_count, field="point_count", minimum=0)
        if (self.first_value_aligned is None) != (self.point_count == 0) or (
            (self.last_value_aligned is None) != (self.point_count == 0)
        ):
            raise ContractValueError("bar values exist exactly when the bar has points")
        if self.point_count > 0:
            require_strict_int(
                self.first_value_aligned,
                field="first_value_aligned",
                minimum=-MAX_BAR_ALIGNED_VALUE,
                maximum=MAX_BAR_ALIGNED_VALUE,
            )
            require_strict_int(
                self.last_value_aligned,
                field="last_value_aligned",
                minimum=-MAX_BAR_ALIGNED_VALUE,
                maximum=MAX_BAR_ALIGNED_VALUE,
            )
        if self.volume_aligned_total is not None:
            require_strict_int(
                self.volume_aligned_total,
                field="volume_aligned_total",
                minimum=0,
                maximum=MAX_BAR_ALIGNED_VALUE,
            )
        if not isinstance(self.complete, bool):
            raise ContractValueError("complete must be boolean")

    def as_mapping(self) -> dict[str, object]:
        return {
            "complete": self.complete,
            "endNs": str(self.end_ns),
            "firstValueAligned": (
                None if self.first_value_aligned is None else str(self.first_value_aligned)
            ),
            "index": self.index,
            "lastValueAligned": (
                None if self.last_value_aligned is None else str(self.last_value_aligned)
            ),
            "pointCount": self.point_count,
            "startNs": str(self.start_ns),
            "volumeAlignedTotal": (
                None if self.volume_aligned_total is None else str(self.volume_aligned_total)
            ),
        }


@dataclass(frozen=True, slots=True)
class BarSeriesV1:
    spec: BarSpec
    bars: tuple[BarV1, ...]

    def __post_init__(self) -> None:
        if not isinstance(
            self.spec,
            WallTimeBarSpecV1 | EventTimeBarSpecV1 | TradeCountBarSpecV1 | VolumeBarSpecV1,
        ):
            raise ContractValueError("spec must be a typed bar spec")
        if not isinstance(self.bars, tuple) or len(self.bars) > MAX_BARS:
            raise ContractValueError(f"bars must be a tuple of at most {MAX_BARS} bars")
        for index, bar in enumerate(self.bars):
            if not isinstance(bar, BarV1):
                raise ContractValueError(f"bars[{index}] must be BarV1")
            if bar.index != index:
                raise ContractValueError("bar indexes must be dense and ordered")

    def as_mapping(self) -> dict[str, object]:
        return {
            "bars": [bar.as_mapping() for bar in self.bars],
            "spec": self.spec.as_mapping(),
        }


def build_bars(series: FeatureSeriesV1, spec: BarSpec) -> BarSeriesV1:
    """Deterministically build bars under the spec's explicit boundary law.

    Trailing partial trade-count/volume bars are emitted with ``complete=False``,
    never silently dropped, and unknown volume never builds a volume bar.
    """

    if not isinstance(series, FeatureSeriesV1):
        raise ContractValueError("series must be FeatureSeriesV1")
    if not isinstance(
        spec,
        WallTimeBarSpecV1 | EventTimeBarSpecV1 | TradeCountBarSpecV1 | VolumeBarSpecV1,
    ):
        raise ContractValueError("spec must be a typed bar spec")
    if isinstance(spec, WallTimeBarSpecV1):
        return _build_wall_bars(series, spec)
    if isinstance(spec, EventTimeBarSpecV1):
        return _build_event_bars(series, spec)
    if isinstance(spec, TradeCountBarSpecV1):
        return _build_trade_count_bars(series, spec)
    return _build_volume_bars(series, spec)


def _volume_total(points: list[FeaturePointV1]) -> int | None:
    total = 0
    for point in points:
        aligned = point.volume_aligned
        if aligned is None:
            return None
        total += aligned
    return total


def _make_bar(
    index: int,
    start_ns: int,
    end_ns: int,
    points: list[FeaturePointV1],
    *,
    complete: bool,
) -> BarV1:
    return BarV1(
        index=index,
        start_ns=start_ns,
        end_ns=end_ns,
        point_count=len(points),
        first_value_aligned=points[0].value_aligned if points else None,
        last_value_aligned=points[-1].value_aligned if points else None,
        volume_aligned_total=_volume_total(points) if points else None,
        complete=complete,
    )


def _build_wall_bars(series: FeatureSeriesV1, spec: WallTimeBarSpecV1) -> BarSeriesV1:
    width = spec.wall_width_ns
    anchor = spec.anchor_ns
    if anchor > series.completeness_start_ns:
        raise ContractValueError("the wall anchor must not follow the completeness start")
    first_index = (series.completeness_start_ns - anchor) // width
    last_index = (series.completeness_end_ns - 1 - anchor) // width
    if last_index - first_index + 1 > MAX_BARS:
        raise ContractValueError("the wall-time bar count exceeds the bounded maximum")
    bars: list[BarV1] = []
    point_cursor = 0
    points = series.points
    for bar_number in range(first_index, last_index + 1):
        start_ns = anchor + bar_number * width
        end_ns = start_ns + width
        bucket: list[FeaturePointV1] = []
        # Bars tile the completeness interval from below its start, so every point
        # belongs to exactly one bar and no skip case exists.
        while point_cursor < len(points) and points[point_cursor].event_time_ns < end_ns:
            bucket.append(points[point_cursor])
            point_cursor += 1
        complete = end_ns <= series.completeness_end_ns
        bars.append(_make_bar(len(bars), start_ns, end_ns, bucket, complete=complete))
    return BarSeriesV1(spec=spec, bars=tuple(bars))


def _build_event_bars(series: FeatureSeriesV1, spec: EventTimeBarSpecV1) -> BarSeriesV1:
    bars = [
        _make_bar(
            index,
            point.event_time_ns,
            point.event_time_ns + 1,
            [point],
            complete=True,
        )
        for index, point in enumerate(series.points)
    ]
    return BarSeriesV1(spec=spec, bars=tuple(bars))


def _build_trade_count_bars(
    series: FeatureSeriesV1,
    spec: TradeCountBarSpecV1,
) -> BarSeriesV1:
    bars: list[BarV1] = []
    bucket: list[FeaturePointV1] = []
    for point in series.points:
        bucket.append(point)
        if len(bucket) == spec.trades_per_bar:
            bars.append(
                _make_bar(
                    len(bars),
                    bucket[0].event_time_ns,
                    bucket[-1].event_time_ns + 1,
                    bucket,
                    complete=True,
                )
            )
            bucket = []
    if bucket:
        bars.append(
            _make_bar(
                len(bars),
                bucket[0].event_time_ns,
                bucket[-1].event_time_ns + 1,
                bucket,
                complete=False,
            )
        )
    return BarSeriesV1(spec=spec, bars=tuple(bars))


def _build_volume_bars(series: FeatureSeriesV1, spec: VolumeBarSpecV1) -> BarSeriesV1:
    if not series.volume_known:
        raise ContractValueError(
            "volume-time bars require known volume; unknown volume is not zero"
        )
    threshold_aligned = scaled_to_aligned(spec.volume_threshold)
    bars: list[BarV1] = []
    bucket: list[FeaturePointV1] = []
    accumulated = 0
    for point in series.points:
        bucket.append(point)
        # The series volume law guarantees every point carries volume here.
        accumulated += cast(int, point.volume_aligned)
        if accumulated >= threshold_aligned:
            bars.append(
                _make_bar(
                    len(bars),
                    bucket[0].event_time_ns,
                    bucket[-1].event_time_ns + 1,
                    bucket,
                    complete=True,
                )
            )
            bucket = []
            accumulated = 0
    if bucket:
        bars.append(
            _make_bar(
                len(bars),
                bucket[0].event_time_ns,
                bucket[-1].event_time_ns + 1,
                bucket,
                complete=False,
            )
        )
    return BarSeriesV1(spec=spec, bars=tuple(bars))
