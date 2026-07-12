from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Final

from quant_edge.derivatives.references import ReferenceKind
from quant_edge.errors import ContractValueError
from quant_edge.features.domains import (
    MAX_BARS,
    BarSeriesV1,
    BarV1,
    WallTimeBarSpecV1,
)
from quant_edge.features.fixedpoint import FixedPointV1, fp_from_ratio
from quant_edge.labels.rational import (
    ExactRatioV1,
    make_ratio,
    ratio_add,
    ratio_compare,
    ratio_subtract,
    scaled_to_aligned,
)
from quant_edge.labels.series import EvidenceSeriesV1, GapIntervalV1, SeriesKind
from quant_edge.lake.contracts import (
    UTC_NS_MAX,
    UTC_NS_MIN,
    EvidencePosture,
    require_contract_id,
    require_strict_int,
)

MAX_PATH_POINTS: Final = 100_000
MAX_PATH_STALENESS_NS: Final = 3_600_000_000_000

# Aligned leg prices live at the accepted 10^38 alignment and must stay small enough
# for exact-ratio arithmetic over leg differences to remain lawful.
MAX_ALIGNED_PRICE: Final = 10**60

# One basis unit at the fixed-point scale corresponds to this aligned magnitude; the
# conversion matches ``ExactScaledValueV1(coefficient=mantissa, scale=12)`` under the
# accepted 10^38 alignment, so frozen bar consumers recover the fixed-point basis
# exactly.
BASIS_ALIGNMENT: Final = 10**26

# A basis path may only claim the reference kind its evidence kind can prove; mark
# and index paths need their own evidence kinds, which no accepted series carries yet.
_REFERENCE_BY_SERIES_KIND: Final = {
    SeriesKind.TRADE_MID_PROXY: ReferenceKind.LAST_TRADE,
    SeriesKind.MID: ReferenceKind.MID,
}


class LegDriver(StrEnum):
    SPOT_LEG = "SPOT_LEG"
    PERP_LEG = "PERP_LEG"
    BOTH_EQUAL = "BOTH_EQUAL"
    NONE = "NONE"


def _require_ns(value: object, *, field: str) -> int:
    return require_strict_int(value, field=field, minimum=UTC_NS_MIN, maximum=UTC_NS_MAX)


@dataclass(frozen=True, slots=True)
class BasisPointV1:
    """One indicative basis observation carrying both leg prices at alignment."""

    event_time_ns: int
    ordinal: int
    basis: ExactRatioV1
    spot_aligned: int
    perp_aligned: int

    def __post_init__(self) -> None:
        _require_ns(self.event_time_ns, field="event_time_ns")
        require_strict_int(self.ordinal, field="ordinal", minimum=0)
        if not isinstance(self.basis, ExactRatioV1):
            raise ContractValueError("basis must be ExactRatioV1")
        require_strict_int(
            self.spot_aligned, field="spot_aligned", minimum=1, maximum=MAX_ALIGNED_PRICE
        )
        require_strict_int(
            self.perp_aligned, field="perp_aligned", minimum=1, maximum=MAX_ALIGNED_PRICE
        )
        expected = make_ratio(self.perp_aligned - self.spot_aligned, self.spot_aligned)
        if ratio_compare(expected, self.basis) != 0:
            raise ContractValueError("basis must equal (perp - spot) / spot exactly")

    def as_mapping(self) -> dict[str, object]:
        return {
            "basis": self.basis.as_mapping(),
            "eventTimeNs": str(self.event_time_ns),
            "ordinal": self.ordinal,
            "perpAligned": str(self.perp_aligned),
            "spotAligned": str(self.spot_aligned),
        }


@dataclass(frozen=True, slots=True)
class BasisPathV1:
    """An indicative basis path for one Spot/perp pair over one reference kind.

    The path never mixes reference kinds across legs and is never executable truth;
    executable basis lives exclusively in the sized-quote construction types.
    """

    path_id: str
    spot_symbol: str
    perp_symbol: str
    reference_kind: ReferenceKind
    posture: EvidencePosture
    max_staleness_ns: int
    completeness_start_ns: int
    completeness_end_ns: int
    points: tuple[BasisPointV1, ...]
    known_gaps: tuple[GapIntervalV1, ...]

    def __post_init__(self) -> None:
        require_contract_id(self.path_id, field="path_id")
        require_contract_id(self.spot_symbol, field="spot_symbol")
        require_contract_id(self.perp_symbol, field="perp_symbol")
        if not isinstance(self.reference_kind, ReferenceKind):
            raise ContractValueError("reference_kind must be ReferenceKind")
        if not isinstance(self.posture, EvidencePosture) or self.posture not in (
            EvidencePosture.SYNTHETIC,
            EvidencePosture.REPLAY,
        ):
            raise ContractValueError(
                "posture must be SYNTHETIC or REPLAY; Q08 owns no live market evidence"
            )
        require_strict_int(
            self.max_staleness_ns,
            field="max_staleness_ns",
            minimum=1,
            maximum=MAX_PATH_STALENESS_NS,
        )
        start = _require_ns(self.completeness_start_ns, field="completeness_start_ns")
        end = _require_ns(self.completeness_end_ns, field="completeness_end_ns")
        if start >= end:
            raise ContractValueError("completeness interval must be non-empty")
        if not isinstance(self.points, tuple) or len(self.points) > MAX_PATH_POINTS:
            raise ContractValueError(f"points must be a tuple of at most {MAX_PATH_POINTS}")
        previous_time: int | None = None
        previous_ordinal: int | None = None
        for index, point in enumerate(self.points):
            if not isinstance(point, BasisPointV1):
                raise ContractValueError(f"points[{index}] must be BasisPointV1")
            if previous_time is not None and previous_ordinal is not None:
                if point.event_time_ns < previous_time:
                    raise ContractValueError("points must be time-ordered")
                if point.ordinal <= previous_ordinal:
                    raise ContractValueError("point ordinals must strictly increase")
            if not start <= point.event_time_ns <= end:
                raise ContractValueError("points must lie inside the completeness interval")
            previous_time = point.event_time_ns
            previous_ordinal = point.ordinal
        if not isinstance(self.known_gaps, tuple) or len(self.known_gaps) > 1_024:
            raise ContractValueError("known_gaps must be a bounded tuple")
        previous_end: int | None = None
        for index, gap in enumerate(self.known_gaps):
            if not isinstance(gap, GapIntervalV1):
                raise ContractValueError(f"known_gaps[{index}] must be GapIntervalV1")
            if previous_end is not None and gap.start_ns < previous_end:
                raise ContractValueError("known_gaps must be sorted and non-overlapping")
            if gap.start_ns < start or gap.end_ns > end:
                raise ContractValueError("gaps must lie inside the completeness interval")
            previous_end = gap.end_ns

    def gap_intersecting(self, start_ns: int, end_ns: int) -> bool:
        return any(gap.intersects(start_ns, end_ns) for gap in self.known_gaps)

    def as_mapping(self) -> dict[str, object]:
        return {
            "completenessEndNs": str(self.completeness_end_ns),
            "completenessStartNs": str(self.completeness_start_ns),
            "knownGaps": [gap.as_mapping() for gap in self.known_gaps],
            "maxStalenessNs": str(self.max_staleness_ns),
            "pathId": self.path_id,
            "perpSymbol": self.perp_symbol,
            "points": [point.as_mapping() for point in self.points],
            "posture": self.posture.value,
            "referenceKind": self.reference_kind.value,
            "spotSymbol": self.spot_symbol,
        }


def _merged_gaps(
    spot_series: EvidenceSeriesV1,
    perp_series: EvidenceSeriesV1,
    start: int,
    end: int,
) -> tuple[GapIntervalV1, ...]:
    raw = sorted(
        (
            (max(gap.start_ns, start), min(gap.end_ns, end))
            for gap in (*spot_series.known_gaps, *perp_series.known_gaps)
            if gap.intersects(start, end)
        ),
    )
    merged: list[tuple[int, int]] = []
    for gap_start, gap_end in raw:
        if merged and gap_start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], gap_end))
        else:
            merged.append((gap_start, gap_end))
    return tuple(GapIntervalV1(start_ns=gap[0], end_ns=gap[1]) for gap in merged)


def build_basis_path(
    *,
    path_id: str,
    spot_series: EvidenceSeriesV1,
    perp_series: EvidenceSeriesV1,
    reference_kind: ReferenceKind,
    max_staleness_ns: int,
) -> BasisPathV1:
    """Build the indicative basis path sampled at perp observation times.

    Both legs must be price series (never executable quotes) and the declared
    reference kind applies to both legs; perp observations without a fresh spot
    reference are omitted rather than zero-filled or forward-faked.
    """

    require_contract_id(path_id, field="path_id")
    if not isinstance(reference_kind, ReferenceKind):
        raise ContractValueError("reference_kind must be ReferenceKind")
    for name, series in (("spot_series", spot_series), ("perp_series", perp_series)):
        if not isinstance(series, EvidenceSeriesV1):
            raise ContractValueError(f"{name} must be EvidenceSeriesV1")
        if series.kind is SeriesKind.EXECUTABLE_QUOTES:
            raise ContractValueError(
                "indicative basis paths never consume executable quotes; use the "
                "sized-quote executable construction instead"
            )
        if _REFERENCE_BY_SERIES_KIND[series.kind] is not reference_kind:
            raise ContractValueError(
                f"{name} evidence kind {series.kind.value} cannot prove reference "
                f"kind {reference_kind.value}; kinds are never substituted"
            )
    require_strict_int(
        max_staleness_ns,
        field="max_staleness_ns",
        minimum=1,
        maximum=MAX_PATH_STALENESS_NS,
    )
    if spot_series.posture is not perp_series.posture:
        raise ContractValueError("both legs must share one honest posture")
    start = max(spot_series.completeness_start_ns, perp_series.completeness_start_ns)
    end = min(spot_series.completeness_end_ns, perp_series.completeness_end_ns)
    if start >= end:
        raise ContractValueError("the legs share no completeness overlap")

    points: list[BasisPointV1] = []
    ordinal = 0
    for perp_point in perp_series.price_points:
        time_ns = perp_point.event_time_ns
        if time_ns < start or time_ns > end:
            continue
        spot_point = spot_series.last_price_at_or_before(time_ns)
        if spot_point is None or time_ns - spot_point.event_time_ns > max_staleness_ns:
            continue
        spot_aligned = scaled_to_aligned(spot_point.price)
        perp_aligned = scaled_to_aligned(perp_point.price)
        points.append(
            BasisPointV1(
                event_time_ns=time_ns,
                ordinal=ordinal,
                basis=make_ratio(perp_aligned - spot_aligned, spot_aligned),
                spot_aligned=spot_aligned,
                perp_aligned=perp_aligned,
            )
        )
        ordinal += 1
    return BasisPathV1(
        path_id=path_id,
        spot_symbol=spot_series.symbol,
        perp_symbol=perp_series.symbol,
        reference_kind=reference_kind,
        posture=spot_series.posture,
        max_staleness_ns=max_staleness_ns,
        completeness_start_ns=start,
        completeness_end_ns=end,
        points=tuple(points),
        known_gaps=_merged_gaps(spot_series, perp_series, start, end),
    )


@dataclass(frozen=True, slots=True)
class LegAttributionV1:
    """The exact decomposition of one basis change into its two leg contributions.

    ``basis_delta == spot_contribution + perp_contribution`` exactly, with the perp
    leg evaluated at the current spot price and the spot leg at the previous perp
    price — a documented, deterministic decomposition order.
    """

    from_time_ns: int
    to_time_ns: int
    basis_delta: ExactRatioV1
    spot_contribution: ExactRatioV1
    perp_contribution: ExactRatioV1
    driver: LegDriver

    def __post_init__(self) -> None:
        from_time = _require_ns(self.from_time_ns, field="from_time_ns")
        to_time = _require_ns(self.to_time_ns, field="to_time_ns")
        if from_time > to_time:
            raise ContractValueError("attribution intervals cannot run backwards")
        for name in ("basis_delta", "spot_contribution", "perp_contribution"):
            if not isinstance(getattr(self, name), ExactRatioV1):
                raise ContractValueError(f"{name} must be ExactRatioV1")
        if (
            ratio_compare(
                ratio_add(self.spot_contribution, self.perp_contribution),
                self.basis_delta,
            )
            != 0
        ):
            raise ContractValueError("contributions must sum to the basis delta exactly")
        if not isinstance(self.driver, LegDriver):
            raise ContractValueError("driver must be LegDriver")

    def as_mapping(self) -> dict[str, object]:
        return {
            "basisDelta": self.basis_delta.as_mapping(),
            "driver": self.driver.value,
            "fromTimeNs": str(self.from_time_ns),
            "perpContribution": self.perp_contribution.as_mapping(),
            "spotContribution": self.spot_contribution.as_mapping(),
            "toTimeNs": str(self.to_time_ns),
        }


def _abs_ratio(value: ExactRatioV1) -> ExactRatioV1:
    return make_ratio(abs(value.numerator), value.denominator)


def attribute_leg_changes(path: BasisPathV1) -> tuple[LegAttributionV1, ...]:
    """Which leg caused each consecutive basis change, exactly and conservatively."""

    if not isinstance(path, BasisPathV1):
        raise ContractValueError("path must be BasisPathV1")
    attributions: list[LegAttributionV1] = []
    for previous, current in zip(path.points, path.points[1:], strict=False):
        basis_delta = ratio_subtract(current.basis, previous.basis)
        perp_contribution = make_ratio(
            current.perp_aligned - previous.perp_aligned,
            current.spot_aligned,
        )
        spot_contribution = ratio_subtract(basis_delta, perp_contribution)
        perp_size = _abs_ratio(perp_contribution)
        spot_size = _abs_ratio(spot_contribution)
        comparison = ratio_compare(spot_size, perp_size)
        if spot_size.is_zero and perp_size.is_zero:
            driver = LegDriver.NONE
        elif comparison > 0:
            driver = LegDriver.SPOT_LEG
        elif comparison < 0:
            driver = LegDriver.PERP_LEG
        else:
            driver = LegDriver.BOTH_EQUAL
        attributions.append(
            LegAttributionV1(
                from_time_ns=previous.event_time_ns,
                to_time_ns=current.event_time_ns,
                basis_delta=basis_delta,
                spot_contribution=spot_contribution,
                perp_contribution=perp_contribution,
                driver=driver,
            )
        )
    return tuple(attributions)


def basis_fixed_point(point: BasisPointV1) -> FixedPointV1:
    """The path point's basis quantized half-even once to the fixed-point scale."""

    if not isinstance(point, BasisPointV1):
        raise ContractValueError("point must be BasisPointV1")
    return fp_from_ratio(point.basis)


def build_basis_bars(
    path: BasisPathV1,
    *,
    wall_width_ns: int,
    anchor_ns: int,
) -> BarSeriesV1:
    """Wall-time basis bars in the frozen Q06 bar shape.

    Bar values are basis fixed-point mantissas at the documented ``BASIS_ALIGNMENT``
    so frozen consumers recover the quantized basis exactly. A bar is complete only
    when it closes inside the completeness interval and intersects no known gap;
    basis bars carry no volume because a basis observation has none.
    """

    if not isinstance(path, BasisPathV1):
        raise ContractValueError("path must be BasisPathV1")
    spec = WallTimeBarSpecV1(wall_width_ns=wall_width_ns, anchor_ns=anchor_ns)
    if spec.anchor_ns > path.completeness_start_ns:
        raise ContractValueError("the wall anchor must not follow the completeness start")
    width = spec.wall_width_ns
    first_index = (path.completeness_start_ns - spec.anchor_ns) // width
    last_index = (path.completeness_end_ns - 1 - spec.anchor_ns) // width
    if last_index - first_index + 1 > MAX_BARS:
        raise ContractValueError("the wall-time bar count exceeds the bounded maximum")
    bars: list[BarV1] = []
    cursor = 0
    points = path.points
    for bar_number in range(first_index, last_index + 1):
        start_ns = spec.anchor_ns + bar_number * width
        end_ns = start_ns + width
        bucket: list[BasisPointV1] = []
        while cursor < len(points) and points[cursor].event_time_ns < end_ns:
            bucket.append(points[cursor])
            cursor += 1
        complete = end_ns <= path.completeness_end_ns and not path.gap_intersecting(
            start_ns, end_ns
        )
        first_value = basis_fixed_point(bucket[0]).mantissa * BASIS_ALIGNMENT if bucket else None
        last_value = basis_fixed_point(bucket[-1]).mantissa * BASIS_ALIGNMENT if bucket else None
        bars.append(
            BarV1(
                index=len(bars),
                start_ns=start_ns,
                end_ns=end_ns,
                point_count=len(bucket),
                first_value_aligned=first_value,
                last_value_aligned=last_value,
                volume_aligned_total=None,
                complete=complete,
            )
        )
    return BarSeriesV1(spec=spec, bars=tuple(bars))
