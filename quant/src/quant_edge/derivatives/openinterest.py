from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Final

from quant_edge.derivatives.sampled import (
    SampledFeatureValueV1,
    derive_sampled_value,
    require_sampled_quality,
)
from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import FixedPointV1, fp_from_ratio, fp_sub
from quant_edge.labels.rational import make_ratio, scaled_to_aligned
from quant_edge.labels.series import EvidenceSeriesV1
from quant_edge.lake.contracts import (
    UTC_NS_MAX,
    UTC_NS_MIN,
    EvidencePosture,
    ExactScaledValueV1,
    QualityState,
    require_contract_id,
    require_strict_int,
)

MAX_OI_OBSERVATIONS: Final = 100_000
MAX_OI_STALENESS_NS: Final = 86_400_000_000_000

OI_LEVEL_FEATURE_ID: Final = "oi_level:v1"
OI_CHANGE_FEATURE_ID: Final = "oi_change:v1"
OI_ACCELERATION_FEATURE_ID: Final = "oi_acceleration:v1"

_ALLOWED_POSTURES: Final = frozenset({EvidencePosture.SYNTHETIC, EvidencePosture.REPLAY})


class PriceOiQuadrant(StrEnum):
    """Joint price/open-interest movement state; unknown inputs stay UNKNOWN."""

    RISING_PRICE_RISING_OI = "RISING_PRICE_RISING_OI"
    RISING_PRICE_FALLING_OI = "RISING_PRICE_FALLING_OI"
    FALLING_PRICE_RISING_OI = "FALLING_PRICE_RISING_OI"
    FALLING_PRICE_FALLING_OI = "FALLING_PRICE_FALLING_OI"
    FLAT = "FLAT"
    UNKNOWN = "UNKNOWN"


def _require_ns(value: object, *, field: str) -> int:
    return require_strict_int(value, field=field, minimum=UTC_NS_MIN, maximum=UTC_NS_MAX)


@dataclass(frozen=True, slots=True)
class OpenInterestObservationV1:
    """One sampled open-interest observation; polling can never prove completeness."""

    event_time_ns: int
    ordinal: int
    open_interest: ExactScaledValueV1

    def __post_init__(self) -> None:
        _require_ns(self.event_time_ns, field="event_time_ns")
        require_strict_int(self.ordinal, field="ordinal", minimum=0)
        if not isinstance(self.open_interest, ExactScaledValueV1):
            raise ContractValueError("open_interest must be ExactScaledValueV1")
        if self.open_interest.coefficient < 0:
            raise ContractValueError("open_interest cannot be negative")

    def as_mapping(self) -> dict[str, object]:
        return {
            "eventTimeNs": str(self.event_time_ns),
            "openInterest": {
                "coefficient": str(self.open_interest.coefficient),
                "scale": self.open_interest.scale,
                "unitId": self.open_interest.unit_id,
            },
            "ordinal": self.ordinal,
        }


@dataclass(frozen=True, slots=True)
class OpenInterestEvidenceV1:
    """Sampled open-interest evidence; the quality vocabulary is confined to
    SAMPLED/PARTIAL/UNKNOWN by construction."""

    symbol: str
    posture: EvidencePosture
    quality: QualityState
    completeness_start_ns: int
    completeness_end_ns: int
    observations: tuple[OpenInterestObservationV1, ...]

    def __post_init__(self) -> None:
        require_contract_id(self.symbol, field="symbol")
        if not isinstance(self.posture, EvidencePosture) or self.posture not in _ALLOWED_POSTURES:
            raise ContractValueError(
                "posture must be SYNTHETIC or REPLAY; Q08 owns no live market evidence"
            )
        require_sampled_quality(self.quality, field="quality")
        start = _require_ns(self.completeness_start_ns, field="completeness_start_ns")
        end = _require_ns(self.completeness_end_ns, field="completeness_end_ns")
        if start >= end:
            raise ContractValueError("completeness interval must be non-empty")
        if not isinstance(self.observations, tuple) or len(self.observations) > MAX_OI_OBSERVATIONS:
            raise ContractValueError("observations must be a bounded tuple")
        previous_time: int | None = None
        previous_ordinal: int | None = None
        for index, observation in enumerate(self.observations):
            if not isinstance(observation, OpenInterestObservationV1):
                raise ContractValueError(f"observations[{index}] must be OpenInterestObservationV1")
            if previous_time is not None and previous_ordinal is not None:
                if observation.event_time_ns < previous_time:
                    raise ContractValueError("observations must be time-ordered")
                if observation.ordinal <= previous_ordinal:
                    raise ContractValueError("observation ordinals must strictly increase")
            if not start <= observation.event_time_ns <= end:
                raise ContractValueError("observations must lie inside the completeness interval")
            previous_time = observation.event_time_ns
            previous_ordinal = observation.ordinal

    def as_mapping(self) -> dict[str, object]:
        return {
            "completenessEndNs": str(self.completeness_end_ns),
            "completenessStartNs": str(self.completeness_start_ns),
            "observations": [observation.as_mapping() for observation in self.observations],
            "posture": self.posture.value,
            "quality": self.quality.value,
            "symbol": self.symbol,
        }

    def last_observations_at_or_before(
        self,
        time_ns: int,
        count: int,
    ) -> tuple[OpenInterestObservationV1, ...]:
        eligible = [
            observation for observation in self.observations if observation.event_time_ns <= time_ns
        ]
        return tuple(eligible[-count:])


def _validated(
    evidence: OpenInterestEvidenceV1,
    as_of_ns: int,
    max_staleness_ns: int,
) -> int:
    if not isinstance(evidence, OpenInterestEvidenceV1):
        raise ContractValueError("evidence must be OpenInterestEvidenceV1")
    require_strict_int(
        max_staleness_ns,
        field="max_staleness_ns",
        minimum=1,
        maximum=MAX_OI_STALENESS_NS,
    )
    return _require_ns(as_of_ns, field="as_of_ns")


def _oi_fixed_point(observation: OpenInterestObservationV1) -> FixedPointV1:
    aligned = scaled_to_aligned(observation.open_interest)
    return fp_from_ratio(make_ratio(aligned, 10**38))


def _sampled(
    evidence: OpenInterestEvidenceV1,
    *,
    feature_id: str,
    as_of_ns: int,
    max_staleness_ns: int,
    needed: int,
    compute: int,
) -> SampledFeatureValueV1:
    as_of = _validated(evidence, as_of_ns, max_staleness_ns)
    observations = evidence.last_observations_at_or_before(as_of, needed)
    if len(observations) < needed:
        return derive_sampled_value(
            feature_id=feature_id,
            as_of_ns=as_of,
            input_last_event_ns=(observations[-1].event_time_ns if observations else as_of),
            freshness_bound_ns=max_staleness_ns,
            sampling=evidence.quality,
            computed=None,
        )
    values = [_oi_fixed_point(observation) for observation in observations]
    if compute == 0:
        computed = values[-1]
    elif compute == 1:
        computed = fp_sub(values[-1], values[-2])
    else:
        computed = fp_sub(fp_sub(values[-1], values[-2]), fp_sub(values[-2], values[-3]))
    return derive_sampled_value(
        feature_id=feature_id,
        as_of_ns=as_of,
        input_last_event_ns=observations[-1].event_time_ns,
        freshness_bound_ns=max_staleness_ns,
        sampling=evidence.quality,
        computed=computed,
    )


def oi_level(
    evidence: OpenInterestEvidenceV1,
    *,
    as_of_ns: int,
    max_staleness_ns: int,
) -> SampledFeatureValueV1:
    """Latest sampled open interest; absence stays UNKNOWN, never zero."""

    return _sampled(
        evidence,
        feature_id=OI_LEVEL_FEATURE_ID,
        as_of_ns=as_of_ns,
        max_staleness_ns=max_staleness_ns,
        needed=1,
        compute=0,
    )


def oi_change(
    evidence: OpenInterestEvidenceV1,
    *,
    as_of_ns: int,
    max_staleness_ns: int,
) -> SampledFeatureValueV1:
    """First difference of the two latest sampled open-interest observations."""

    return _sampled(
        evidence,
        feature_id=OI_CHANGE_FEATURE_ID,
        as_of_ns=as_of_ns,
        max_staleness_ns=max_staleness_ns,
        needed=2,
        compute=1,
    )


def oi_acceleration(
    evidence: OpenInterestEvidenceV1,
    *,
    as_of_ns: int,
    max_staleness_ns: int,
) -> SampledFeatureValueV1:
    """Second difference of the three latest sampled open-interest observations."""

    return _sampled(
        evidence,
        feature_id=OI_ACCELERATION_FEATURE_ID,
        as_of_ns=as_of_ns,
        max_staleness_ns=max_staleness_ns,
        needed=3,
        compute=2,
    )


def price_oi_quadrant(
    *,
    price_series: EvidenceSeriesV1,
    oi_evidence: OpenInterestEvidenceV1,
    window_start_ns: int,
    window_end_ns: int,
    max_staleness_ns: int,
) -> PriceOiQuadrant:
    """The price/OI quadrant over one window; any missing leg stays UNKNOWN.

    Both deltas are taken between the last observations at or before the window
    start and end, under the same staleness bound; either delta being exactly zero
    yields FLAT rather than inventing a direction.
    """

    if not isinstance(price_series, EvidenceSeriesV1):
        raise ContractValueError("price_series must be EvidenceSeriesV1")
    if not isinstance(oi_evidence, OpenInterestEvidenceV1):
        raise ContractValueError("oi_evidence must be OpenInterestEvidenceV1")
    start = _require_ns(window_start_ns, field="window_start_ns")
    end = _require_ns(window_end_ns, field="window_end_ns")
    if start >= end:
        raise ContractValueError("the quadrant window must be non-empty")
    require_strict_int(
        max_staleness_ns,
        field="max_staleness_ns",
        minimum=1,
        maximum=MAX_OI_STALENESS_NS,
    )
    if oi_evidence.quality is QualityState.UNKNOWN:
        return PriceOiQuadrant.UNKNOWN
    if price_series.gap_intersecting(start, end):
        return PriceOiQuadrant.UNKNOWN

    price_start = price_series.last_price_at_or_before(start)
    price_end = price_series.last_price_at_or_before(end)
    if (
        price_start is None
        or price_end is None
        or start - price_start.event_time_ns > max_staleness_ns
        or end - price_end.event_time_ns > max_staleness_ns
    ):
        return PriceOiQuadrant.UNKNOWN
    oi_start = oi_evidence.last_observations_at_or_before(start, 1)
    oi_end = oi_evidence.last_observations_at_or_before(end, 1)
    if (
        not oi_start
        or not oi_end
        or start - oi_start[-1].event_time_ns > max_staleness_ns
        or end - oi_end[-1].event_time_ns > max_staleness_ns
    ):
        return PriceOiQuadrant.UNKNOWN

    price_delta = scaled_to_aligned(price_end.price) - scaled_to_aligned(price_start.price)
    oi_delta = scaled_to_aligned(oi_end[-1].open_interest) - scaled_to_aligned(
        oi_start[-1].open_interest
    )
    if price_delta == 0 or oi_delta == 0:
        return PriceOiQuadrant.FLAT
    if price_delta > 0:
        return (
            PriceOiQuadrant.RISING_PRICE_RISING_OI
            if oi_delta > 0
            else PriceOiQuadrant.RISING_PRICE_FALLING_OI
        )
    return (
        PriceOiQuadrant.FALLING_PRICE_RISING_OI
        if oi_delta > 0
        else PriceOiQuadrant.FALLING_PRICE_FALLING_OI
    )
