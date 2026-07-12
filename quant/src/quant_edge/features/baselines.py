from __future__ import annotations

import bisect
from dataclasses import dataclass, field
from typing import Final, cast

from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import (
    FIXED_POINT_SCALE,
    FixedPointV1,
    fp_add,
    fp_mean_of_two,
    fp_mul,
    fp_sub,
)
from quant_edge.labels.rational import ExactRatioV1
from quant_edge.lake.contracts import require_contract_id, require_strict_int

MAX_WINDOW: Final = 100_000
DAY_NS: Final = 86_400_000_000_000


def _require_window(value: object) -> int:
    return require_strict_int(value, field="window", minimum=1, maximum=MAX_WINDOW)


def _require_fp(value: object, *, field: str) -> FixedPointV1:
    if not isinstance(value, FixedPointV1):
        raise ContractValueError(f"{field} must be FixedPointV1")
    return value


class RollingMedianMad:
    """Bounded-window exact rolling median and MAD over fixed-point values.

    Even-length medians are the half-even rounded mean of the two central values, a
    documented deterministic law.
    """

    __slots__ = ("__sorted", "__values", "__window")

    def __init__(self, window: int) -> None:
        self.__window = _require_window(window)
        self.__values: list[FixedPointV1] = []
        self.__sorted: list[int] = []

    @property
    def window(self) -> int:
        return self.__window

    @property
    def count(self) -> int:
        return len(self.__values)

    def push(self, value: FixedPointV1) -> None:
        _require_fp(value, field="value")
        if len(self.__values) == self.__window:
            oldest = self.__values.pop(0)
            index = bisect.bisect_left(self.__sorted, oldest.mantissa)
            del self.__sorted[index]
        self.__values.append(value)
        bisect.insort(self.__sorted, value.mantissa)

    def median(self) -> FixedPointV1 | None:
        if not self.__sorted:
            return None
        return _median_of(self.__sorted)

    def mad(self) -> FixedPointV1 | None:
        median = self.median()
        if median is None:
            return None
        deviations = sorted(abs(mantissa - median.mantissa) for mantissa in self.__sorted)
        return _median_of(deviations)


def _median_of(sorted_mantissas: list[int]) -> FixedPointV1:
    count = len(sorted_mantissas)
    middle = count // 2
    if count % 2 == 1:
        return FixedPointV1(sorted_mantissas[middle])
    return fp_mean_of_two(
        FixedPointV1(sorted_mantissas[middle - 1]),
        FixedPointV1(sorted_mantissas[middle]),
    )


class EwmaMeanVariance:
    """Fixed-point EWMA mean/variance with an explicit alpha and rounding law."""

    __slots__ = ("__alpha", "__count", "__mean", "__variance")

    def __init__(self, alpha: FixedPointV1) -> None:
        _require_fp(alpha, field="alpha")
        if not 0 < alpha.mantissa < FIXED_POINT_SCALE:
            raise ContractValueError("alpha must lie strictly between zero and one")
        self.__alpha = alpha
        self.__count = 0
        self.__mean = FixedPointV1(0)
        self.__variance = FixedPointV1(0)

    @property
    def count(self) -> int:
        return self.__count

    def push(self, value: FixedPointV1) -> None:
        _require_fp(value, field="value")
        if self.__count == 0:
            self.__mean = value
            self.__variance = FixedPointV1(0)
            self.__count = 1
            return
        delta = fp_sub(value, self.__mean)
        increment = fp_mul(self.__alpha, delta)
        self.__mean = fp_add(self.__mean, increment)
        one_minus_alpha = FixedPointV1(FIXED_POINT_SCALE - self.__alpha.mantissa)
        self.__variance = fp_mul(
            one_minus_alpha,
            fp_add(self.__variance, fp_mul(self.__alpha, fp_mul(delta, delta))),
        )
        self.__count += 1

    def mean(self) -> FixedPointV1 | None:
        return None if self.__count == 0 else self.__mean

    def variance(self) -> FixedPointV1 | None:
        return None if self.__count == 0 else self.__variance


class BoundedQuantile:
    """Bounded-window exact lower-order-statistic quantile."""

    __slots__ = ("__denominator", "__numerator", "__sorted", "__values", "__window")

    def __init__(self, window: int, quantile: ExactRatioV1) -> None:
        self.__window = _require_window(window)
        if not isinstance(quantile, ExactRatioV1):
            raise ContractValueError("quantile must be ExactRatioV1")
        if quantile.is_negative or quantile.numerator > quantile.denominator:
            raise ContractValueError("quantile must lie inside [0, 1]")
        self.__numerator = quantile.numerator
        self.__denominator = quantile.denominator
        self.__values: list[FixedPointV1] = []
        self.__sorted: list[int] = []

    @property
    def count(self) -> int:
        return len(self.__values)

    def push(self, value: FixedPointV1) -> None:
        _require_fp(value, field="value")
        if len(self.__values) == self.__window:
            oldest = self.__values.pop(0)
            index = bisect.bisect_left(self.__sorted, oldest.mantissa)
            del self.__sorted[index]
        self.__values.append(value)
        bisect.insort(self.__sorted, value.mantissa)

    def value(self) -> FixedPointV1 | None:
        if not self.__sorted:
            return None
        index = (len(self.__sorted) - 1) * self.__numerator // self.__denominator
        return FixedPointV1(self.__sorted[index])


@dataclass(frozen=True, slots=True)
class BaselineCohortKeyV1:
    """Context conditioning per §12.2; baselines never mix cohorts silently."""

    symbol: str
    time_of_day_bucket: int
    funding_cycle_bucket: int
    regime_id: str
    liquidity_bucket: int

    def __post_init__(self) -> None:
        require_contract_id(self.symbol, field="symbol")
        require_strict_int(self.time_of_day_bucket, field="time_of_day_bucket", minimum=0)
        require_strict_int(
            self.funding_cycle_bucket,
            field="funding_cycle_bucket",
            minimum=0,
        )
        require_contract_id(self.regime_id, field="regime_id")
        require_strict_int(self.liquidity_bucket, field="liquidity_bucket", minimum=0)

    def as_mapping(self) -> dict[str, object]:
        return {
            "fundingCycleBucket": self.funding_cycle_bucket,
            "liquidityBucket": self.liquidity_bucket,
            "regimeId": self.regime_id,
            "symbol": self.symbol,
            "timeOfDayBucket": self.time_of_day_bucket,
        }


def cohort_key(
    *,
    symbol: str,
    event_time_ns: int,
    time_of_day_bucket_ns: int,
    funding_cycle_ns: int,
    regime_id: str,
    liquidity_bucket: int,
) -> BaselineCohortKeyV1:
    require_strict_int(
        time_of_day_bucket_ns,
        field="time_of_day_bucket_ns",
        minimum=1,
        maximum=DAY_NS,
    )
    require_strict_int(funding_cycle_ns, field="funding_cycle_ns", minimum=1, maximum=DAY_NS)
    require_strict_int(event_time_ns, field="event_time_ns", minimum=0)
    return BaselineCohortKeyV1(
        symbol=symbol,
        time_of_day_bucket=(event_time_ns % DAY_NS) // time_of_day_bucket_ns,
        funding_cycle_bucket=(event_time_ns % DAY_NS) // funding_cycle_ns,
        regime_id=regime_id,
        liquidity_bucket=liquidity_bucket,
    )


@dataclass(frozen=True, slots=True)
class HistorySufficiencyV1:
    """Listing-age/history gate; insufficient history yields UNKNOWN, never a value."""

    observed_start_ns: int
    observed_end_ns: int
    observation_count: int
    min_span_ns: int
    min_observations: int

    def __post_init__(self) -> None:
        start = require_strict_int(self.observed_start_ns, field="observed_start_ns", minimum=0)
        require_strict_int(self.observed_end_ns, field="observed_end_ns", minimum=start)
        require_strict_int(self.observation_count, field="observation_count", minimum=0)
        require_strict_int(self.min_span_ns, field="min_span_ns", minimum=1)
        require_strict_int(self.min_observations, field="min_observations", minimum=1)

    @property
    def sufficient(self) -> bool:
        return (
            self.observed_end_ns - self.observed_start_ns >= self.min_span_ns
            and self.observation_count >= self.min_observations
        )

    def as_mapping(self) -> dict[str, object]:
        return {
            "minObservations": self.min_observations,
            "minSpanNs": str(self.min_span_ns),
            "observationCount": self.observation_count,
            "observedEndNs": str(self.observed_end_ns),
            "observedStartNs": str(self.observed_start_ns),
            "sufficient": self.sufficient,
        }


@dataclass(slots=True)
class CohortBaselineSet:
    """Per-cohort baselines gated by history sufficiency."""

    window: int
    alpha: FixedPointV1
    min_span_ns: int
    min_observations: int
    _median_mad: dict[BaselineCohortKeyV1, RollingMedianMad] = field(default_factory=dict)
    _ewma: dict[BaselineCohortKeyV1, EwmaMeanVariance] = field(default_factory=dict)
    _first_ns: dict[BaselineCohortKeyV1, int] = field(default_factory=dict)
    _last_ns: dict[BaselineCohortKeyV1, int] = field(default_factory=dict)
    _counts: dict[BaselineCohortKeyV1, int] = field(default_factory=dict)

    def __post_init__(self) -> None:
        _require_window(self.window)
        if not isinstance(self.alpha, FixedPointV1) or not (
            0 < self.alpha.mantissa < FIXED_POINT_SCALE
        ):
            raise ContractValueError("alpha must lie strictly between zero and one")
        require_strict_int(self.min_span_ns, field="min_span_ns", minimum=1)
        require_strict_int(self.min_observations, field="min_observations", minimum=1)

    def observe(
        self,
        key: BaselineCohortKeyV1,
        event_time_ns: int,
        value: FixedPointV1,
    ) -> None:
        if not isinstance(key, BaselineCohortKeyV1):
            raise ContractValueError("key must be BaselineCohortKeyV1")
        require_strict_int(event_time_ns, field="event_time_ns", minimum=0)
        _require_fp(value, field="value")
        if key not in self._median_mad:
            self._median_mad[key] = RollingMedianMad(self.window)
            self._ewma[key] = EwmaMeanVariance(self.alpha)
            self._first_ns[key] = event_time_ns
            self._counts[key] = 0
        last = self._last_ns.get(key)
        if last is not None and event_time_ns < last:
            raise ContractValueError("cohort observations must be time-ordered")
        self._last_ns[key] = event_time_ns
        self._counts[key] += 1
        self._median_mad[key].push(value)
        self._ewma[key].push(value)

    def sufficiency(self, key: BaselineCohortKeyV1) -> HistorySufficiencyV1 | None:
        if key not in self._median_mad:
            return None
        return HistorySufficiencyV1(
            observed_start_ns=self._first_ns[key],
            observed_end_ns=self._last_ns[key],
            observation_count=self._counts[key],
            min_span_ns=self.min_span_ns,
            min_observations=self.min_observations,
        )

    def median_mad(
        self,
        key: BaselineCohortKeyV1,
    ) -> tuple[FixedPointV1, FixedPointV1] | None:
        """Baseline values only when the cohort history is sufficient; else None."""

        sufficiency = self.sufficiency(key)
        if sufficiency is None or not sufficiency.sufficient:
            return None
        baseline = self._median_mad[key]
        # A sufficient cohort has at least one observation, so both values exist.
        return (cast(FixedPointV1, baseline.median()), cast(FixedPointV1, baseline.mad()))

    def ewma_mean_variance(
        self,
        key: BaselineCohortKeyV1,
    ) -> tuple[FixedPointV1, FixedPointV1] | None:
        sufficiency = self.sufficiency(key)
        if sufficiency is None or not sufficiency.sufficient:
            return None
        ewma = self._ewma[key]
        # A sufficient cohort has at least one observation, so both values exist.
        return (cast(FixedPointV1, ewma.mean()), cast(FixedPointV1, ewma.variance()))
