from __future__ import annotations

import itertools
import math
from collections.abc import Callable
from dataclasses import dataclass
from typing import Final, Protocol

from quant_edge.errors import ContractValueError
from quant_edge.features.baselines import RollingMedianMad
from quant_edge.features.domains import BarDomain, BarV1
from quant_edge.features.fixedpoint import (
    FIXED_POINT_SCALE,
    MAX_FIXED_MANTISSA,
    FixedPointV1,
    fp_div,
    fp_from_int,
    fp_sub,
    round_half_even,
)
from quant_edge.features.registry import FeatureCardV1

MAX_BATCH_POINTS: Final = 512
EWMA_ALPHA: Final = FixedPointV1(FIXED_POINT_SCALE // 5)  # 0.2, the documented v1 alpha
ROBUST_WINDOW: Final = 8


class StreamingFeature(Protocol):
    def update(self, bar: BarV1) -> FixedPointV1 | None:
        """Consume one bar and return the feature value, or None when unknown."""


BatchFeature = Callable[[tuple[BarV1, ...]], "FixedPointV1 | None"]


@dataclass(frozen=True, slots=True)
class FeatureImplementationV1:
    card: FeatureCardV1
    batch: BatchFeature
    make_streaming: Callable[[], StreamingFeature]

    def __post_init__(self) -> None:
        if not isinstance(self.card, FeatureCardV1):
            raise ContractValueError("card must be FeatureCardV1")
        if not callable(self.batch) or not callable(self.make_streaming):
            raise ContractValueError("batch and make_streaming must be callable")


def _bar_close(bar: BarV1) -> int | None:
    if not bar.complete:
        return None
    return bar.last_value_aligned


def _fp_close(bar: BarV1) -> FixedPointV1 | None:
    aligned = _bar_close(bar)
    if aligned is None:
        return None
    # Aligned integers sit at 10^38; quantize to the fixed-point scale half-even.
    return FixedPointV1(round_half_even(aligned, 10**26))


def _return_fp(previous_aligned: int, current_aligned: int) -> FixedPointV1 | None:
    if previous_aligned <= 0 or current_aligned <= 0:
        return None
    mantissa = _signed_round(
        (current_aligned - previous_aligned) * FIXED_POINT_SCALE,
        previous_aligned,
    )
    if abs(mantissa) > MAX_FIXED_MANTISSA:
        return None
    return FixedPointV1(mantissa)


def _signed_round(numerator: int, denominator: int) -> int:
    sign = -1 if (numerator < 0) != (denominator < 0) else 1
    return sign * round_half_even(abs(numerator), abs(denominator))


# -- bar return -----------------------------------------------------------------------


class _StreamingBarReturn:
    __slots__ = ("__previous",)

    def __init__(self) -> None:
        self.__previous: int | None = None

    def update(self, bar: BarV1) -> FixedPointV1 | None:
        close = _bar_close(bar)
        if close is None:
            return None
        previous = self.__previous
        self.__previous = close
        if previous is None:
            return None
        return _return_fp(previous, close)


def _batch_bar_return(bars: tuple[BarV1, ...]) -> FixedPointV1 | None:
    closes = [close for close in (_bar_close(bar) for bar in bars) if close is not None]
    if len(closes) < 2 or _bar_close(bars[-1]) is None:
        return None
    return _return_fp(closes[-2], closes[-1])


# -- activity intensity ---------------------------------------------------------------


class _StreamingActivity:
    __slots__ = ()

    def update(self, bar: BarV1) -> FixedPointV1 | None:
        if not bar.complete:
            return None
        return fp_from_int(bar.point_count)


def _batch_activity(bars: tuple[BarV1, ...]) -> FixedPointV1 | None:
    last = bars[-1]
    if not last.complete:
        return None
    return fp_from_int(last.point_count)


# -- robust z-distance ----------------------------------------------------------------


class _StreamingRobustZ:
    __slots__ = ("__baseline",)

    def __init__(self) -> None:
        self.__baseline = RollingMedianMad(ROBUST_WINDOW)

    def update(self, bar: BarV1) -> FixedPointV1 | None:
        close = _fp_close(bar)
        if close is None:
            return None
        result: FixedPointV1 | None = None
        if self.__baseline.count == ROBUST_WINDOW:
            median = self.__baseline.median()
            mad = self.__baseline.mad()
            if median is not None and mad is not None and not mad.is_zero:
                deviation = fp_sub(close, median)
                if abs(deviation.mantissa) * FIXED_POINT_SCALE <= MAX_FIXED_MANTISSA * abs(
                    mad.mantissa
                ):
                    result = fp_div(deviation, mad)
        self.__baseline.push(close)
        return result


def _batch_robust_z(bars: tuple[BarV1, ...]) -> FixedPointV1 | None:
    closes = [close for close in (_fp_close(bar) for bar in bars) if close is not None]
    if not closes or _fp_close(bars[-1]) is None or len(closes) < ROBUST_WINDOW + 1:
        return None
    window = closes[-(ROBUST_WINDOW + 1) : -1]
    baseline = RollingMedianMad(ROBUST_WINDOW)
    for value in window:
        baseline.push(value)
    median = baseline.median()
    mad = baseline.mad()
    if median is None or mad is None or mad.is_zero:
        return None
    deviation = fp_sub(closes[-1], median)
    if abs(deviation.mantissa) * FIXED_POINT_SCALE > MAX_FIXED_MANTISSA * abs(mad.mantissa):
        return None
    return fp_div(deviation, mad)


# -- EWMA variance of bar returns -----------------------------------------------------


class _StreamingEwmaVariance:
    __slots__ = ("__mean", "__previous_close", "__variance")

    def __init__(self) -> None:
        self.__previous_close: int | None = None
        self.__mean: FixedPointV1 | None = None
        self.__variance = FixedPointV1(0)

    def update(self, bar: BarV1) -> FixedPointV1 | None:
        close = _bar_close(bar)
        if close is None:
            return None
        previous = self.__previous_close
        self.__previous_close = close
        if previous is None:
            return None
        observed = _return_fp(previous, close)
        if observed is None:
            self.__mean = None
            self.__variance = FixedPointV1(0)
            return None
        mean = self.__mean
        if mean is None:
            self.__mean = observed
            self.__variance = FixedPointV1(0)
            return self.__variance
        alpha = EWMA_ALPHA.mantissa
        delta = observed.mantissa - mean.mantissa
        self.__mean = FixedPointV1(mean.mantissa + _signed_round(alpha * delta, FIXED_POINT_SCALE))
        delta_squared = _signed_round(delta * delta, FIXED_POINT_SCALE)
        alpha_delta_squared = _signed_round(alpha * delta_squared, FIXED_POINT_SCALE)
        inner = self.__variance.mantissa + alpha_delta_squared
        self.__variance = FixedPointV1(
            _signed_round((FIXED_POINT_SCALE - alpha) * inner, FIXED_POINT_SCALE)
        )
        return self.__variance


def _batch_ewma_variance(bars: tuple[BarV1, ...]) -> FixedPointV1 | None:
    closes = [close for close in (_bar_close(bar) for bar in bars) if close is not None]
    if len(closes) < 2 or _bar_close(bars[-1]) is None:
        return None
    last_nonpositive = next(
        (index for index in range(len(closes) - 1, -1, -1) if closes[index] <= 0),
        None,
    )
    if last_nonpositive is not None:
        closes = closes[last_nonpositive + 1 :]
    if len(closes) < 2:
        return None
    if len(closes) > MAX_BATCH_POINTS:
        raise ContractValueError("the batch reference is bounded to MAX_BATCH_POINTS closes")
    # Exact-rational replay of the recurrence, quantized half-even once at the end.
    alpha_num = EWMA_ALPHA.mantissa
    scale = FIXED_POINT_SCALE
    mean_num = 0
    mean_den = 1
    var_num = 0
    var_den = 1
    seeded = False
    for previous, current in itertools.pairwise(closes):
        observed_num = current - previous
        observed_den = previous
        if not seeded:
            mean_num, mean_den = observed_num, observed_den
            var_num, var_den = 0, 1
            seeded = True
            continue
        delta_num = observed_num * mean_den - mean_num * observed_den
        delta_den = observed_den * mean_den
        mean_num = mean_num * scale * delta_den + alpha_num * delta_num * mean_den
        mean_den = mean_den * scale * delta_den
        inner_num = var_num * (delta_den**2) * scale + alpha_num * (delta_num**2) * var_den
        inner_den = var_den * (delta_den**2) * scale
        var_num = (scale - alpha_num) * inner_num
        var_den = scale * inner_den
        # Keep the exact fractions bounded by reducing with a cheap power-of-ten gcd.
        mean_num, mean_den = _reduce(mean_num, mean_den)
        var_num, var_den = _reduce(var_num, var_den)
    mantissa = _signed_round(var_num * scale, var_den)
    if abs(mantissa) > MAX_FIXED_MANTISSA:
        return None
    return FixedPointV1(mantissa)


def _reduce(numerator: int, denominator: int) -> tuple[int, int]:
    divisor = math.gcd(abs(numerator), abs(denominator))
    if divisor > 1:
        return numerator // divisor, denominator // divisor
    return numerator, denominator


def _card(
    name: str,
    hypothesis: str,
    *,
    unit_id: str,
    tolerance_ulp: int,
    update_rule: str,
    failure_modes: tuple[str, ...],
) -> FeatureCardV1:
    return FeatureCardV1(
        name=name,
        version="v1",
        economic_hypothesis=hypothesis,
        inputs=("bar_series",),
        window_law="complete bars only; incomplete bars yield no value",
        domain=BarDomain.WALL_TIME,
        normalization_cohort="symbol-self",
        missing_behavior="missing or empty input yields UNKNOWN, never zero",
        stale_behavior="staleness is judged by the value-layer freshness bound",
        unit_id=unit_id,
        lower_bound=None,
        upper_bound=None,
        incremental_update_rule=update_rule,
        batch_reference=f"quant_edge.features.primitives:batch_{name}",
        streaming_implementation=f"quant_edge.features.primitives:streaming_{name}",
        provenance="Q06 v1 primitive implemented from the directive's common law",
        computational_cost="O_1_PER_BAR" if name != "robust_z" else "O_WINDOW_PER_BAR",
        expected_failure_modes=failure_modes,
        test_binding="tests.unit.test_q06_primitives",
        equivalence_tolerance_ulp=tolerance_ulp,
    )


def bar_return_feature() -> FeatureImplementationV1:
    return FeatureImplementationV1(
        card=_card(
            "bar_return",
            "price change between consecutive complete bars approximates short-horizon "
            "momentum/reversion pressure",
            unit_id="RATIO",
            tolerance_ulp=0,
            update_rule="return of current close against the previous complete close",
            failure_modes=("EMPTY_BARS", "PARTIAL_TAIL_BAR"),
        ),
        batch=_batch_bar_return,
        make_streaming=_StreamingBarReturn,
    )


def activity_intensity_feature() -> FeatureImplementationV1:
    return FeatureImplementationV1(
        card=_card(
            "activity_intensity",
            "observation count per bar proxies participation intensity",
            unit_id="COUNT",
            tolerance_ulp=0,
            update_rule="point count of the completed bar",
            failure_modes=("PARTIAL_TAIL_BAR",),
        ),
        batch=_batch_activity,
        make_streaming=_StreamingActivity,
    )


def robust_z_feature() -> FeatureImplementationV1:
    return FeatureImplementationV1(
        card=_card(
            "robust_z",
            "distance of the close from its rolling median in MAD units resists "
            "outlier-driven normalization",
            unit_id="MAD_UNITS",
            tolerance_ulp=0,
            update_rule="(close - rolling median) / MAD over the prior fixed window",
            failure_modes=("INSUFFICIENT_HISTORY", "ZERO_MAD"),
        ),
        batch=_batch_robust_z,
        make_streaming=_StreamingRobustZ,
    )


def ewma_variance_feature() -> FeatureImplementationV1:
    return FeatureImplementationV1(
        card=_card(
            "ewma_variance",
            "exponentially weighted variance of bar returns tracks local volatility",
            unit_id="RATIO_SQUARED",
            tolerance_ulp=64,
            update_rule="West EWMA recurrence on bar returns with fixed alpha 0.2",
            failure_modes=("EMPTY_BARS", "ROUNDING_DRIFT_BEYOND_TOLERANCE"),
        ),
        batch=_batch_ewma_variance,
        make_streaming=_StreamingEwmaVariance,
    )


def v1_features() -> tuple[FeatureImplementationV1, ...]:
    return (
        activity_intensity_feature(),
        bar_return_feature(),
        ewma_variance_feature(),
        robust_z_feature(),
    )
