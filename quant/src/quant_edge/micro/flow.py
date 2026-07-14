from __future__ import annotations

from collections import deque
from typing import Final

from quant_edge.features.domains import BarDomain, BarV1
from quant_edge.features.fixedpoint import FixedPointV1
from quant_edge.features.registry import FeatureCardV1
from quant_edge.micro.equivalence import MicroFeatureImplementationV1
from quant_edge.micro.inputs import JoinedTradeV1
from quant_edge.micro.l1 import fp_from_fraction

FLOW_WINDOW: Final = 16
SECOND_NS: Final = 1_000_000_000
ABSORPTION_RESPONSE_WEIGHT: Final = 100  # versioned v1 weight on adverse mid response


def _card(
    name: str,
    hypothesis: str,
    *,
    inputs: tuple[str, ...],
    unit_id: str,
    update_rule: str,
    failure_modes: tuple[str, ...],
    cost: str,
    test_binding: str = "tests.unit.test_q07_flow",
) -> FeatureCardV1:
    return FeatureCardV1(
        name=name,
        version="v1",
        economic_hypothesis=hypothesis,
        inputs=inputs,
        window_law="event-driven; documented per-feature window",
        domain=BarDomain.EVENT_TIME,
        normalization_cohort="symbol-self",
        missing_behavior="missing prevailing quotes or volume yield UNKNOWN, never zero",
        stale_behavior="staleness is judged by the value-layer freshness bound",
        unit_id=unit_id,
        lower_bound=None,
        upper_bound=None,
        incremental_update_rule=update_rule,
        batch_reference=f"quant_edge.micro.flow:batch_{name}",
        streaming_implementation=f"quant_edge.micro.flow:streaming_{name}",
        provenance="Q07 v1 implemented from directive §13.1 over maker-flagged trades",
        computational_cost=cost,
        expected_failure_modes=failure_modes,
        test_binding=test_binding,
        equivalence_tolerance_ulp=0,
    )


def _signed_size(item: JoinedTradeV1) -> int:
    size = item.trade.size_aligned
    return size if item.trade.taker_is_buyer else -size


class _StreamingSignedImbalance:
    __slots__ = ("__ops", "__signed", "__total", "__window")

    def __init__(self) -> None:
        self.__window: deque[tuple[int, int]] = deque()
        self.__signed = 0
        self.__total = 0
        self.__ops = 0

    @property
    def last_update_ops(self) -> int:
        return self.__ops

    def update(self, item: JoinedTradeV1) -> FixedPointV1 | None:
        self.__ops = 1
        signed = _signed_size(item)
        total = item.trade.size_aligned
        self.__window.append((signed, total))
        self.__signed += signed
        self.__total += total
        if len(self.__window) > FLOW_WINDOW:
            old_signed, old_total = self.__window.popleft()
            self.__signed -= old_signed
            self.__total -= old_total
        return fp_from_fraction(self.__signed, self.__total)


def batch_signed_trade_imbalance(
    items: tuple[JoinedTradeV1, ...],
) -> FixedPointV1 | None:
    window = items[-FLOW_WINDOW:]
    signed = sum(_signed_size(item) for item in window)
    total = sum(item.trade.size_aligned for item in window)
    return fp_from_fraction(signed, total)


class _StreamingTradeIntensity:
    __slots__ = ("__ops", "__times")

    def __init__(self) -> None:
        self.__times: deque[int] = deque()
        self.__ops = 0

    @property
    def last_update_ops(self) -> int:
        return self.__ops

    def update(self, item: JoinedTradeV1) -> FixedPointV1 | None:
        self.__ops = 1
        self.__times.append(item.event_time_ns)
        if len(self.__times) > FLOW_WINDOW:
            self.__times.popleft()
        return _intensity(tuple(self.__times))


def _intensity(times: tuple[int, ...]) -> FixedPointV1 | None:
    if len(times) < 2:
        return None
    span_ns = times[-1] - times[0]
    if span_ns == 0:
        return None
    # trades per second over the window span.
    return fp_from_fraction((len(times) - 1) * SECOND_NS, span_ns)


def batch_trade_intensity(items: tuple[JoinedTradeV1, ...]) -> FixedPointV1 | None:
    window = items[-FLOW_WINDOW:]
    return _intensity(tuple(item.event_time_ns for item in window))


class _StreamingTradeDispersion:
    __slots__ = ("__ops", "__times")

    def __init__(self) -> None:
        self.__times: deque[int] = deque()
        self.__ops = 0

    @property
    def last_update_ops(self) -> int:
        return self.__ops

    def update(self, item: JoinedTradeV1) -> FixedPointV1 | None:
        self.__times.append(item.event_time_ns)
        if len(self.__times) > FLOW_WINDOW:
            self.__times.popleft()
        self.__ops = max(1, len(self.__times))
        return _dispersion(tuple(self.__times))


def _dispersion(times: tuple[int, ...]) -> FixedPointV1 | None:
    if len(times) < 3:
        return None
    durations = [times[index] - times[index - 1] for index in range(1, len(times))]
    total = sum(durations)
    if total == 0:
        return None
    count = len(durations)
    squares = sum(duration * duration for duration in durations)
    # Index of dispersion (variance/mean, no square roots) of inter-arrival
    # times, exact-rationally, reported in seconds.
    return fp_from_fraction(count * squares - total * total, count * total * SECOND_NS)


def batch_trade_dispersion(items: tuple[JoinedTradeV1, ...]) -> FixedPointV1 | None:
    window = items[-FLOW_WINDOW:]
    return _dispersion(tuple(item.event_time_ns for item in window))


class _StreamingSizeHhi:
    __slots__ = ("__ops", "__sizes", "__sum", "__sum_squares")

    def __init__(self) -> None:
        self.__sizes: deque[int] = deque()
        self.__sum = 0
        self.__sum_squares = 0
        self.__ops = 0

    @property
    def last_update_ops(self) -> int:
        return self.__ops

    def update(self, item: JoinedTradeV1) -> FixedPointV1 | None:
        self.__ops = 1
        size = item.trade.size_aligned
        self.__sizes.append(size)
        self.__sum += size
        self.__sum_squares += size * size
        if len(self.__sizes) > FLOW_WINDOW:
            old = self.__sizes.popleft()
            self.__sum -= old
            self.__sum_squares -= old * old
        return fp_from_fraction(self.__sum_squares, self.__sum * self.__sum)


def batch_size_concentration_hhi(
    items: tuple[JoinedTradeV1, ...],
) -> FixedPointV1 | None:
    window = items[-FLOW_WINDOW:]
    total = sum(item.trade.size_aligned for item in window)
    squares = sum(item.trade.size_aligned**2 for item in window)
    return fp_from_fraction(squares, total * total)


class _StreamingEffectiveSpread:
    __slots__ = ("__ops",)

    def __init__(self) -> None:
        self.__ops = 0

    @property
    def last_update_ops(self) -> int:
        return self.__ops

    def update(self, item: JoinedTradeV1) -> FixedPointV1 | None:
        self.__ops = 1
        return _effective_spread(item)


def _effective_spread(item: JoinedTradeV1) -> FixedPointV1 | None:
    quote = item.prevailing
    if quote is None:
        return None
    mid_x2 = quote.mid_aligned_x2
    return fp_from_fraction(2 * abs(2 * item.trade.price_aligned - mid_x2), mid_x2)


def batch_effective_spread(items: tuple[JoinedTradeV1, ...]) -> FixedPointV1 | None:
    return _effective_spread(items[-1])


class _StreamingKyleSlope:
    """Exact-rational OLS slope of mid change on signed flow over a bounded window."""

    __slots__ = ("__ops", "__pairs", "__previous_mid_x2")

    def __init__(self) -> None:
        self.__previous_mid_x2: int | None = None
        self.__pairs: deque[tuple[int, int]] = deque()
        self.__ops = 0

    @property
    def last_update_ops(self) -> int:
        return self.__ops

    def update(self, item: JoinedTradeV1) -> FixedPointV1 | None:
        quote = item.prevailing
        if quote is None:
            # No prevailing quote: the pair set is unchanged, as in the batch law.
            self.__ops = max(1, len(self.__pairs))
            return _kyle_slope(tuple(self.__pairs))
        mid_x2 = quote.mid_aligned_x2
        previous = self.__previous_mid_x2
        self.__previous_mid_x2 = mid_x2
        if previous is not None:
            self.__pairs.append((_signed_size(item), mid_x2 - previous))
            if len(self.__pairs) > FLOW_WINDOW:
                self.__pairs.popleft()
        self.__ops = max(1, len(self.__pairs))
        return _kyle_slope(tuple(self.__pairs))


def _kyle_slope(pairs: tuple[tuple[int, int], ...]) -> FixedPointV1 | None:
    if len(pairs) < 3:
        return None
    count = len(pairs)
    sum_x = sum(x for x, _ in pairs)
    sum_y = sum(y for _, y in pairs)
    sum_xy = sum(x * y for x, y in pairs)
    sum_xx = sum(x * x for x, _ in pairs)
    denominator = count * sum_xx - sum_x * sum_x
    if denominator == 0:
        return None
    # Slope of doubled-mid change per aligned signed size unit, scaled to fixed point.
    return fp_from_fraction(count * sum_xy - sum_x * sum_y, denominator)


def batch_kyle_slope(items: tuple[JoinedTradeV1, ...]) -> FixedPointV1 | None:
    pairs: list[tuple[int, int]] = []
    previous_mid: int | None = None
    for item in items:
        quote = item.prevailing
        if quote is None:
            continue
        mid_x2 = quote.mid_aligned_x2
        if previous_mid is not None:
            pairs.append((_signed_size(item), mid_x2 - previous_mid))
        previous_mid = mid_x2
    return _kyle_slope(tuple(pairs[-FLOW_WINDOW:]))


class _StreamingAbsorption:
    """Aggressive volume absorbed per unit adverse mid response (versioned v1)."""

    __slots__ = ("__ops", "__window")

    def __init__(self) -> None:
        self.__window: deque[tuple[int, int | None]] = deque()
        self.__ops = 0

    @property
    def last_update_ops(self) -> int:
        return self.__ops

    def update(self, item: JoinedTradeV1) -> FixedPointV1 | None:
        quote = item.prevailing
        mid_x2 = None if quote is None else quote.mid_aligned_x2
        self.__window.append((item.trade.size_aligned, mid_x2))
        if len(self.__window) > FLOW_WINDOW:
            self.__window.popleft()
        self.__ops = len(self.__window)
        return _absorption(tuple(self.__window))


def _absorption(window: tuple[tuple[int, int | None], ...]) -> FixedPointV1 | None:
    if len(window) < 2:
        return None
    mids = [mid for _, mid in window if mid is not None]
    if len(mids) < 2:
        return None
    volume = sum(size for size, _ in window)
    response = abs(mids[-1] - mids[0])
    # absorption = volume / (volume + weight * response), exact.
    return fp_from_fraction(
        volume,
        volume + ABSORPTION_RESPONSE_WEIGHT * response,
    )


def batch_absorption_ratio(items: tuple[JoinedTradeV1, ...]) -> FixedPointV1 | None:
    window = items[-FLOW_WINDOW:]
    return _absorption(
        tuple(
            (
                item.trade.size_aligned,
                None if item.prevailing is None else item.prevailing.mid_aligned_x2,
            )
            for item in window
        )
    )


class _StreamingAmihud:
    """Mean |bar return| per volume unit over complete bars with volume."""

    __slots__ = ("__ops", "__previous_close", "__values")

    def __init__(self) -> None:
        self.__previous_close: int | None = None
        self.__values: deque[tuple[int, int]] = deque()  # (|return| numerator, volume)
        self.__ops = 0

    @property
    def last_update_ops(self) -> int:
        return self.__ops

    def update(self, bar: BarV1) -> FixedPointV1 | None:
        self.__ops = max(1, len(self.__values))
        if not bar.complete or bar.last_value_aligned is None:
            return _amihud(tuple(self.__values))
        close = bar.last_value_aligned
        previous = self.__previous_close
        self.__previous_close = close
        volume = bar.volume_aligned_total
        if previous is None or volume is None or volume == 0:
            return _amihud(tuple(self.__values))
        self.__values.append((abs(close - previous), previous * volume))
        if len(self.__values) > FLOW_WINDOW:
            self.__values.popleft()
        return _amihud(tuple(self.__values))


def _amihud(values: tuple[tuple[int, int], ...]) -> FixedPointV1 | None:
    if not values:
        return None
    # mean of |return| / volume, each an exact fraction; combined exactly.
    numerator = 0
    denominator = 1
    for absolute_move, scaled_volume in values:
        numerator = numerator * scaled_volume + absolute_move * denominator
        denominator *= scaled_volume
    return fp_from_fraction(numerator, denominator * len(values))


def batch_amihud_illiquidity(items: tuple[BarV1, ...]) -> FixedPointV1 | None:
    values: list[tuple[int, int]] = []
    previous: int | None = None
    for bar in items:
        if not bar.complete or bar.last_value_aligned is None:
            continue
        close = bar.last_value_aligned
        if (
            previous is not None
            and bar.volume_aligned_total is not None
            and bar.volume_aligned_total > 0
        ):
            values.append((abs(close - previous), previous * bar.volume_aligned_total))
        previous = close
    return _amihud(tuple(values[-FLOW_WINDOW:]))


def signed_trade_imbalance_feature() -> MicroFeatureImplementationV1[JoinedTradeV1]:
    return MicroFeatureImplementationV1(
        card=_card(
            "signed_trade_imbalance",
            "net taker volume direction over recent trades proxies aggressor pressure",
            inputs=("joined_trades",),
            unit_id="RATIO",
            update_rule=f"signed/total volume over the last {FLOW_WINDOW} trades",
            failure_modes=("MAKER_FLAG_SEMANTICS",),
            cost="O_1_PER_UPDATE",
        ),
        batch=batch_signed_trade_imbalance,
        make_streaming=_StreamingSignedImbalance,
        declared_max_update_ops=1,
    )


def trade_intensity_feature() -> MicroFeatureImplementationV1[JoinedTradeV1]:
    return MicroFeatureImplementationV1(
        card=_card(
            "trade_intensity",
            "trade arrival rate over the recent window proxies activity",
            inputs=("joined_trades",),
            unit_id="TRADES_PER_SECOND",
            update_rule=f"(n-1)/span over the last {FLOW_WINDOW} trade times",
            failure_modes=("SINGLE_TRADE", "ZERO_SPAN"),
            cost="O_1_PER_UPDATE",
        ),
        batch=batch_trade_intensity,
        make_streaming=_StreamingTradeIntensity,
        declared_max_update_ops=1,
    )


def trade_dispersion_feature() -> MicroFeatureImplementationV1[JoinedTradeV1]:
    return MicroFeatureImplementationV1(
        card=_card(
            "trade_dispersion",
            "burstiness of trade arrivals relative to a memoryless flow proxies "
            "clustered aggression",
            inputs=("joined_trades",),
            unit_id="SECONDS",
            update_rule=(
                f"index of dispersion (variance/mean, no square roots) of inter-arrival "
                f"times over the last {FLOW_WINDOW} trade times, exact rational in seconds"
            ),
            failure_modes=("FEWER_THAN_THREE_TRADES", "ZERO_MEAN_INTERARRIVAL"),
            cost="O_WINDOW_PER_UPDATE",
        ),
        batch=batch_trade_dispersion,
        make_streaming=_StreamingTradeDispersion,
        declared_max_update_ops=FLOW_WINDOW,
    )


def size_concentration_hhi_feature() -> MicroFeatureImplementationV1[JoinedTradeV1]:
    return MicroFeatureImplementationV1(
        card=_card(
            "size_concentration_hhi",
            "trade-size concentration distinguishes few-large from many-small flow",
            inputs=("joined_trades",),
            unit_id="RATIO",
            update_rule=f"sum(size^2)/total^2 over the last {FLOW_WINDOW} trades",
            failure_modes=("WINDOW_SIZE_SENSITIVITY",),
            cost="O_1_PER_UPDATE",
        ),
        batch=batch_size_concentration_hhi,
        make_streaming=_StreamingSizeHhi,
        declared_max_update_ops=1,
    )


def effective_spread_feature() -> MicroFeatureImplementationV1[JoinedTradeV1]:
    return MicroFeatureImplementationV1(
        card=_card(
            "effective_spread",
            "executed price distance from the prevailing mid measures realized cost",
            inputs=("joined_trades",),
            unit_id="RATIO",
            update_rule="2|price - mid|/mid against the prevailing quote per trade",
            failure_modes=("NO_PREVAILING_QUOTE",),
            cost="O_1_PER_UPDATE",
        ),
        batch=batch_effective_spread,
        make_streaming=_StreamingEffectiveSpread,
        declared_max_update_ops=1,
    )


def kyle_slope_feature() -> MicroFeatureImplementationV1[JoinedTradeV1]:
    return MicroFeatureImplementationV1(
        card=_card(
            "kyle_slope",
            "mid response per unit signed flow proxies local price impact",
            inputs=("joined_trades",),
            unit_id="IMPACT_PER_SIZE",
            update_rule=(
                f"exact OLS slope of doubled-mid change on signed size over the last "
                f"{FLOW_WINDOW} joined trades"
            ),
            failure_modes=("FEWER_THAN_THREE_PAIRS", "MISSING_QUOTES", "ZERO_FLOW_VARIANCE"),
            cost="O_WINDOW_PER_UPDATE",
        ),
        batch=batch_kyle_slope,
        make_streaming=_StreamingKyleSlope,
        declared_max_update_ops=FLOW_WINDOW,
    )


def absorption_ratio_feature() -> MicroFeatureImplementationV1[JoinedTradeV1]:
    return MicroFeatureImplementationV1(
        card=_card(
            "absorption_ratio",
            "high traded volume with limited adverse mid response suggests absorption",
            inputs=("joined_trades",),
            unit_id="RATIO",
            update_rule=(
                f"volume/(volume + {ABSORPTION_RESPONSE_WEIGHT}*|mid drift|) over the "
                f"last {FLOW_WINDOW} trades; the weight is a versioned v1 parameter"
            ),
            failure_modes=("FEWER_THAN_TWO_MIDS", "MISSING_QUOTES", "PARAMETER_DEPENDENCE"),
            cost="O_WINDOW_PER_UPDATE",
        ),
        batch=batch_absorption_ratio,
        make_streaming=_StreamingAbsorption,
        declared_max_update_ops=FLOW_WINDOW,
    )


def amihud_illiquidity_feature() -> MicroFeatureImplementationV1[BarV1]:
    return MicroFeatureImplementationV1(
        card=_card(
            "amihud_illiquidity",
            "absolute return per traded volume proxies illiquidity",
            inputs=("bar_series",),
            unit_id="RETURN_PER_VOLUME",
            update_rule=(
                f"mean |close move|/(previous close * volume) over the last "
                f"{FLOW_WINDOW} valid complete bars"
            ),
            failure_modes=("EMPTY_BARS", "ZERO_OR_UNKNOWN_VOLUME"),
            cost="O_WINDOW_PER_UPDATE",
            test_binding="tests.unit.test_q07_flow",
        ),
        batch=batch_amihud_illiquidity,
        make_streaming=_StreamingAmihud,
        declared_max_update_ops=FLOW_WINDOW,
    )
