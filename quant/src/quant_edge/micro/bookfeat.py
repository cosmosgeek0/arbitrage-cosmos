from __future__ import annotations

from collections import deque
from typing import Final

from quant_edge.features.domains import BarDomain
from quant_edge.features.fixedpoint import FixedPointV1
from quant_edge.features.registry import FeatureCardV1
from quant_edge.micro.equivalence import MicroFeatureImplementationV1
from quant_edge.micro.inputs import LadderLevelV1, LadderSnapshotV1
from quant_edge.micro.l1 import fp_from_aligned, fp_from_fraction

BAND_LEVELS: Final = 5
RESILIENCY_EVENTS: Final = 8
DEPLETION_FRACTION_NUM: Final = 1
DEPLETION_FRACTION_DEN: Final = 2  # a band losing >= 1/2 of its depth is a depletion
RECOVERY_FRACTION_NUM: Final = 9
RECOVERY_FRACTION_DEN: Final = 10  # recovery to >= 9/10 of pre-depletion depth
RECOVERY_HORIZON_SNAPSHOTS: Final = 4
INTENDED_SIZE_ALIGNED: Final = 10 * 10**38  # ten size units at alignment scale


def _card(
    name: str,
    hypothesis: str,
    *,
    unit_id: str,
    update_rule: str,
    failure_modes: tuple[str, ...],
    cost: str,
) -> FeatureCardV1:
    return FeatureCardV1(
        name=name,
        version="v1",
        economic_hypothesis=hypothesis,
        inputs=("ladder_series",),
        window_law="event-driven over ladder snapshots; documented per-feature window",
        domain=BarDomain.EVENT_TIME,
        normalization_cohort="symbol-self",
        missing_behavior="empty or insufficient ladders yield UNKNOWN, never zero",
        stale_behavior="staleness is judged by the value-layer freshness bound",
        unit_id=unit_id,
        lower_bound=None,
        upper_bound=None,
        incremental_update_rule=update_rule,
        batch_reference=f"quant_edge.micro.bookfeat:batch_{name}",
        streaming_implementation=f"quant_edge.micro.bookfeat:streaming_{name}",
        provenance="Q07 v1 implemented from directive §13.1 over book-view ladders",
        computational_cost=cost,
        expected_failure_modes=failure_modes,
        test_binding="tests.unit.test_q07_book",
        equivalence_tolerance_ulp=0,
    )


def _band_depth(levels: tuple[LadderLevelV1, ...], count: int) -> int:
    total = 0
    for level in levels[:count]:
        total += level.size_aligned
    return total


def _band_depths(snapshot: LadderSnapshotV1) -> tuple[int, int]:
    return (
        _band_depth(snapshot.bids, BAND_LEVELS),
        _band_depth(snapshot.asks, BAND_LEVELS),
    )


class _StreamingBandFlow:
    __slots__ = ("__ops", "__previous")

    def __init__(self) -> None:
        self.__previous: tuple[int, int] | None = None
        self.__ops = 0

    @property
    def last_update_ops(self) -> int:
        return self.__ops

    def update(self, item: LadderSnapshotV1) -> FixedPointV1 | None:
        self.__ops = BAND_LEVELS
        depths = _band_depths(item)
        previous = self.__previous
        self.__previous = depths
        if previous is None:
            return None
        return fp_from_aligned((depths[0] - previous[0]) - (depths[1] - previous[1]))


def batch_band_flow(items: tuple[LadderSnapshotV1, ...]) -> FixedPointV1 | None:
    if len(items) < 2:
        return None
    current = _band_depths(items[-1])
    previous = _band_depths(items[-2])
    return fp_from_aligned((current[0] - previous[0]) - (current[1] - previous[1]))


class _StreamingBandImbalance:
    __slots__ = ("__ops",)

    def __init__(self) -> None:
        self.__ops = 0

    @property
    def last_update_ops(self) -> int:
        return self.__ops

    def update(self, item: LadderSnapshotV1) -> FixedPointV1 | None:
        self.__ops = BAND_LEVELS
        return _band_imbalance(item)


def _band_imbalance(snapshot: LadderSnapshotV1) -> FixedPointV1 | None:
    bid_depth, ask_depth = _band_depths(snapshot)
    total = bid_depth + ask_depth
    if total == 0:
        return None
    return fp_from_fraction(bid_depth - ask_depth, total)


def batch_cumulative_band_imbalance(
    items: tuple[LadderSnapshotV1, ...],
) -> FixedPointV1 | None:
    return _band_imbalance(items[-1])


def _side_slope(
    levels: tuple[LadderLevelV1, ...],
    mid_x2: int,
    *,
    is_bid: bool,
) -> tuple[int, int] | None:
    """Exact-rational OLS slope of cumulative depth on doubled distance from mid.

    Returns (numerator, denominator) or None when fewer than two levels exist.
    """

    count = min(len(levels), BAND_LEVELS)
    if count < 2:
        return None
    sum_x = sum_y = sum_xy = sum_xx = 0
    cumulative = 0
    for level in levels[:count]:
        price = level.price_aligned
        size = level.size_aligned
        distance_x2 = (mid_x2 - 2 * price) if is_bid else (2 * price - mid_x2)
        cumulative += size
        sum_x += distance_x2
        sum_y += cumulative
        sum_xy += distance_x2 * cumulative
        sum_xx += distance_x2 * distance_x2
    # Strict price ordering makes the distances distinct, so the OLS denominator
    # count*sum_xx - sum_x^2 is strictly positive (Cauchy-Schwarz is strict here);
    # strictly increasing cumulative depth makes the numerator strictly positive too.
    return (count * sum_xy - sum_x * sum_y, count * sum_xx - sum_x * sum_x)


def _slope_imbalance(snapshot: LadderSnapshotV1) -> FixedPointV1 | None:
    mid_x2 = snapshot.mid_aligned_x2
    if mid_x2 is None:
        return None
    bid_slope = _side_slope(snapshot.bids, mid_x2, is_bid=True)
    ask_slope = _side_slope(snapshot.asks, mid_x2, is_bid=False)
    if bid_slope is None or ask_slope is None:
        return None
    # imbalance = (sb - sa) / (sb + sa) over exact rationals; both slopes are
    # strictly positive rationals, so the total is strictly positive.
    difference = bid_slope[0] * ask_slope[1] - ask_slope[0] * bid_slope[1]
    total = bid_slope[0] * ask_slope[1] + ask_slope[0] * bid_slope[1]
    return fp_from_fraction(difference, total)


class _StreamingSlopeImbalance:
    __slots__ = ("__ops",)

    def __init__(self) -> None:
        self.__ops = 0

    @property
    def last_update_ops(self) -> int:
        return self.__ops

    def update(self, item: LadderSnapshotV1) -> FixedPointV1 | None:
        self.__ops = 2 * BAND_LEVELS
        return _slope_imbalance(item)


def batch_book_slope_imbalance(
    items: tuple[LadderSnapshotV1, ...],
) -> FixedPointV1 | None:
    return _slope_imbalance(items[-1])


class _StreamingResiliency:
    """Replenishment ratio over the last bounded set of depletion events."""

    __slots__ = ("__events", "__ops", "__pending", "__previous_depth")

    def __init__(self) -> None:
        self.__previous_depth: int | None = None
        self.__pending: list[tuple[int, int]] = []  # (pre-depletion depth, age)
        self.__events: deque[bool] = deque()
        self.__ops = 0

    @property
    def last_update_ops(self) -> int:
        return self.__ops

    def update(self, item: LadderSnapshotV1) -> FixedPointV1 | None:
        self.__ops = BAND_LEVELS + len(self.__pending)
        depth = _band_depth(item.bids, BAND_LEVELS)
        previous = self.__previous_depth
        self.__previous_depth = depth
        still_pending: list[tuple[int, int]] = []
        for pre_depth, age in self.__pending:
            if depth * RECOVERY_FRACTION_DEN >= pre_depth * RECOVERY_FRACTION_NUM:
                self.__record(True)
            elif age + 1 >= RECOVERY_HORIZON_SNAPSHOTS:
                self.__record(False)
            else:
                still_pending.append((pre_depth, age + 1))
        self.__pending = still_pending
        if (
            previous is not None
            and previous > 0
            and depth * DEPLETION_FRACTION_DEN <= previous * DEPLETION_FRACTION_NUM
        ):
            self.__pending.append((previous, 0))
        if not self.__events:
            return None
        return fp_from_fraction(sum(1 for event in self.__events if event), len(self.__events))

    def __record(self, recovered: bool) -> None:
        self.__events.append(recovered)
        if len(self.__events) > RESILIENCY_EVENTS:
            self.__events.popleft()


def batch_depth_resiliency(items: tuple[LadderSnapshotV1, ...]) -> FixedPointV1 | None:
    streaming = _StreamingResiliency()
    result: FixedPointV1 | None = None
    for item in items:
        result = streaming.update(item)
    return result


def _vwap_at_size(
    levels: tuple[LadderLevelV1, ...],
    target_aligned: int,
) -> tuple[int, int] | None:
    """Executable VWAP for the intended size as (cost, size); None if insufficient."""

    remaining = target_aligned
    cost = 0
    for level in levels:
        price = level.price_aligned
        size = level.size_aligned
        take = min(size, remaining)
        cost += take * price
        remaining -= take
        if remaining == 0:
            return (cost, target_aligned)
    return None


def _spread_at_size(snapshot: LadderSnapshotV1) -> FixedPointV1 | None:
    buy = _vwap_at_size(snapshot.asks, INTENDED_SIZE_ALIGNED)
    sell = _vwap_at_size(snapshot.bids, INTENDED_SIZE_ALIGNED)
    if buy is None or sell is None:
        return None
    # spread_at_size = (vwap_buy - vwap_sell) / mid_of_vwaps, exact; executable
    # costs are strictly positive, so the total is strictly positive.
    difference = buy[0] - sell[0]
    total = buy[0] + sell[0]
    return fp_from_fraction(2 * difference, total)


class _StreamingSpreadAtSize:
    __slots__ = ("__ops",)

    def __init__(self) -> None:
        self.__ops = 0

    @property
    def last_update_ops(self) -> int:
        return self.__ops

    def update(self, item: LadderSnapshotV1) -> FixedPointV1 | None:
        self.__ops = len(item.bids) + len(item.asks)
        return _spread_at_size(item)


def batch_vwap_spread_at_size(
    items: tuple[LadderSnapshotV1, ...],
) -> FixedPointV1 | None:
    return _spread_at_size(items[-1])


def band_flow_feature() -> MicroFeatureImplementationV1[LadderSnapshotV1]:
    return MicroFeatureImplementationV1(
        card=_card(
            "band_flow",
            "net change of top-band depth between snapshots proxies multi-level "
            "order-flow imbalance from snapshot differences",
            unit_id="SIZE_UNITS",
            update_rule=f"delta of top-{BAND_LEVELS} bid depth minus delta of ask depth",
            failure_modes=("SINGLE_SNAPSHOT", "SNAPSHOT_DIFF_NOT_EVENT_FLOW"),
            cost="O_BAND_PER_UPDATE",
        ),
        batch=batch_band_flow,
        make_streaming=_StreamingBandFlow,
        declared_max_update_ops=BAND_LEVELS,
    )


def cumulative_band_imbalance_feature() -> MicroFeatureImplementationV1[LadderSnapshotV1]:
    return MicroFeatureImplementationV1(
        card=_card(
            "cumulative_band_imbalance",
            "cumulative top-band queue imbalance proxies resting book pressure",
            unit_id="RATIO",
            update_rule=f"(B{BAND_LEVELS} - A{BAND_LEVELS}) / (B{BAND_LEVELS} + A{BAND_LEVELS})",
            failure_modes=("EMPTY_BAND",),
            cost="O_BAND_PER_UPDATE",
        ),
        batch=batch_cumulative_band_imbalance,
        make_streaming=_StreamingBandImbalance,
        declared_max_update_ops=BAND_LEVELS,
    )


def book_slope_imbalance_feature() -> MicroFeatureImplementationV1[LadderSnapshotV1]:
    return MicroFeatureImplementationV1(
        card=_card(
            "book_slope_imbalance",
            "asymmetry of cumulative-depth slopes around mid proxies one-sided liquidity provision",
            unit_id="RATIO",
            update_rule="exact OLS slope of cumulative depth on distance per side; "
            "imbalance of the two slopes",
            failure_modes=("FEWER_THAN_TWO_LEVELS", "MISSING_MID"),
            cost="O_BAND_PER_UPDATE",
        ),
        batch=batch_book_slope_imbalance,
        make_streaming=_StreamingSlopeImbalance,
        declared_max_update_ops=2 * BAND_LEVELS,
    )


def depth_resiliency_feature() -> MicroFeatureImplementationV1[LadderSnapshotV1]:
    return MicroFeatureImplementationV1(
        card=_card(
            "depth_resiliency",
            "how often depleted bid-band depth replenishes within a bounded horizon "
            "proxies liquidity resiliency",
            unit_id="RATIO",
            update_rule=(
                f"a >= {DEPLETION_FRACTION_NUM}/{DEPLETION_FRACTION_DEN} band drop opens an "
                f"event; recovery to >= {RECOVERY_FRACTION_NUM}/{RECOVERY_FRACTION_DEN} "
                f"within {RECOVERY_HORIZON_SNAPSHOTS} snapshots counts as replenished; "
                f"value is the recovered fraction of the last {RESILIENCY_EVENTS} events"
            ),
            failure_modes=("NO_DEPLETION_EVENTS_YET", "SNAPSHOT_CADENCE_DEPENDENCE"),
            cost="O_BAND_PLUS_PENDING_PER_UPDATE",
        ),
        batch=batch_depth_resiliency,
        make_streaming=_StreamingResiliency,
        declared_max_update_ops=BAND_LEVELS + RECOVERY_HORIZON_SNAPSHOTS,
    )


def vwap_spread_at_size_feature() -> MicroFeatureImplementationV1[LadderSnapshotV1]:
    return MicroFeatureImplementationV1(
        card=_card(
            "vwap_spread_at_size",
            "the executable round-trip spread for an intended size measures real "
            "liquidity beyond the touch",
            unit_id="RATIO",
            update_rule="walk both ladders for the intended size; exact relative spread "
            "of the two executable VWAPs; insufficient depth is UNKNOWN",
            failure_modes=("INSUFFICIENT_DEPTH", "INTENDED_SIZE_PARAMETER_DEPENDENCE"),
            cost="O_LEVELS_PER_UPDATE",
        ),
        batch=batch_vwap_spread_at_size,
        make_streaming=_StreamingSpreadAtSize,
        declared_max_update_ops=2 * 5_000,
    )
