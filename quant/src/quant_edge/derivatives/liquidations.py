from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Final

from quant_edge.derivatives.sampled import (
    SampledFeatureValueV1,
    derive_sampled_value,
)
from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import FixedPointV1, fp_from_int, round_half_even
from quant_edge.labels.rational import scaled_to_aligned
from quant_edge.lake.contracts import (
    UTC_NS_MAX,
    UTC_NS_MIN,
    EvidencePosture,
    ExactScaledValueV1,
    QualityState,
    require_contract_id,
    require_strict_int,
)

MAX_LIQUIDATION_EVENTS: Final = 100_000
MAX_LIQUIDATION_STALENESS_NS: Final = 86_400_000_000_000

OBSERVED_LIQUIDATION_COUNT_FEATURE_ID: Final = "observed_liquidation_count:v1"
OBSERVED_LIQUIDATION_NOTIONAL_FEATURE_ID: Final = "observed_liquidation_notional:v1"

_ALLOWED_POSTURES: Final = frozenset({EvidencePosture.SYNTHETIC, EvidencePosture.REPLAY})

# The official liquidation stream semantics cannot prove completeness; the evidence
# quality vocabulary is therefore confined to SAMPLED/PARTIAL by construction, and
# UNKNOWN is not allowed either because an evidence container with unknown sampling
# semantics is not admissible evidence at all.
_ALLOWED_QUALITIES: Final = frozenset({QualityState.SAMPLED, QualityState.PARTIAL})


class LiquidationSide(StrEnum):
    """The side of the liquidated position: a LONG liquidation force-sells."""

    LONG = "LONG"
    SHORT = "SHORT"


def _require_ns(value: object, *, field: str) -> int:
    return require_strict_int(value, field=field, minimum=UTC_NS_MIN, maximum=UTC_NS_MAX)


def _optional_non_negative(value: object, *, field: str) -> ExactScaledValueV1 | None:
    if value is None:
        return None
    if not isinstance(value, ExactScaledValueV1):
        raise ContractValueError(f"{field} must be ExactScaledValueV1 or None")
    if value.coefficient < 0:
        raise ContractValueError(f"{field} cannot be negative")
    return value


@dataclass(frozen=True, slots=True)
class LiquidationEventV1:
    """One observed liquidation; price/quantity may be unknown and stay unknown."""

    event_time_ns: int
    ordinal: int
    side: LiquidationSide
    price: ExactScaledValueV1 | None
    base_quantity: ExactScaledValueV1 | None

    def __post_init__(self) -> None:
        _require_ns(self.event_time_ns, field="event_time_ns")
        require_strict_int(self.ordinal, field="ordinal", minimum=0)
        if not isinstance(self.side, LiquidationSide):
            raise ContractValueError("side must be LiquidationSide")
        _optional_non_negative(self.price, field="price")
        _optional_non_negative(self.base_quantity, field="base_quantity")

    @property
    def notional_aligned(self) -> int | None:
        """Exact notional at double alignment, or None when either fact is unknown."""

        if self.price is None or self.base_quantity is None:
            return None
        return scaled_to_aligned(self.price) * scaled_to_aligned(self.base_quantity)

    def as_mapping(self) -> dict[str, object]:
        def scaled(value: ExactScaledValueV1 | None) -> dict[str, object] | None:
            if value is None:
                return None
            return {
                "coefficient": str(value.coefficient),
                "scale": value.scale,
                "unitId": value.unit_id,
            }

        return {
            "baseQuantity": scaled(self.base_quantity),
            "eventTimeNs": str(self.event_time_ns),
            "ordinal": self.ordinal,
            "price": scaled(self.price),
            "side": self.side.value,
        }


@dataclass(frozen=True, slots=True)
class LiquidationEvidenceV1:
    """Observed liquidation events whose quality can only be SAMPLED or PARTIAL."""

    symbol: str
    posture: EvidencePosture
    quality: QualityState
    completeness_start_ns: int
    completeness_end_ns: int
    events: tuple[LiquidationEventV1, ...]

    def __post_init__(self) -> None:
        require_contract_id(self.symbol, field="symbol")
        if not isinstance(self.posture, EvidencePosture) or self.posture not in _ALLOWED_POSTURES:
            raise ContractValueError(
                "posture must be SYNTHETIC or REPLAY; Q08 owns no live market evidence"
            )
        if not isinstance(self.quality, QualityState) or self.quality not in _ALLOWED_QUALITIES:
            raise ContractValueError(
                "liquidation evidence quality must be SAMPLED or PARTIAL; the stream "
                "semantics cannot prove completeness"
            )
        start = _require_ns(self.completeness_start_ns, field="completeness_start_ns")
        end = _require_ns(self.completeness_end_ns, field="completeness_end_ns")
        if start >= end:
            raise ContractValueError("completeness interval must be non-empty")
        if not isinstance(self.events, tuple) or len(self.events) > MAX_LIQUIDATION_EVENTS:
            raise ContractValueError("events must be a bounded tuple")
        previous_time: int | None = None
        previous_ordinal: int | None = None
        for index, event in enumerate(self.events):
            if not isinstance(event, LiquidationEventV1):
                raise ContractValueError(f"events[{index}] must be LiquidationEventV1")
            if previous_time is not None and previous_ordinal is not None:
                if event.event_time_ns < previous_time:
                    raise ContractValueError("events must be time-ordered")
                if event.ordinal <= previous_ordinal:
                    raise ContractValueError("event ordinals must strictly increase")
            if not start <= event.event_time_ns <= end:
                raise ContractValueError("events must lie inside the completeness interval")
            previous_time = event.event_time_ns
            previous_ordinal = event.ordinal

    def as_mapping(self) -> dict[str, object]:
        return {
            "completenessEndNs": str(self.completeness_end_ns),
            "completenessStartNs": str(self.completeness_start_ns),
            "events": [event.as_mapping() for event in self.events],
            "posture": self.posture.value,
            "quality": self.quality.value,
            "symbol": self.symbol,
        }

    def events_in_window(
        self,
        start_ns: int,
        end_ns: int,
    ) -> tuple[LiquidationEventV1, ...]:
        return tuple(event for event in self.events if start_ns < event.event_time_ns <= end_ns)


def _window(
    evidence: LiquidationEvidenceV1,
    window_start_ns: int,
    window_end_ns: int,
) -> tuple[tuple[LiquidationEventV1, ...], int, int]:
    if not isinstance(evidence, LiquidationEvidenceV1):
        raise ContractValueError("evidence must be LiquidationEvidenceV1")
    start = _require_ns(window_start_ns, field="window_start_ns")
    end = _require_ns(window_end_ns, field="window_end_ns")
    if start >= end:
        raise ContractValueError("the liquidation window must be non-empty")
    if start < evidence.completeness_start_ns or end > evidence.completeness_end_ns:
        raise ContractValueError("the window must lie inside the completeness interval")
    return evidence.events_in_window(start, end), start, end


def observed_liquidation_count(
    evidence: LiquidationEvidenceV1,
    *,
    window_start_ns: int,
    window_end_ns: int,
    side: LiquidationSide | None = None,
) -> SampledFeatureValueV1:
    """The count of OBSERVED liquidations in the window, optionally one side.

    Under a sampled stream this is a lower bound on true liquidation activity,
    never a claim of totality, and the sampling label says so structurally.
    """

    events, _, end = _window(evidence, window_start_ns, window_end_ns)
    if side is not None and not isinstance(side, LiquidationSide):
        raise ContractValueError("side must be LiquidationSide or None")
    matching = tuple(event for event in events if side is None or event.side is side)
    last_event = matching[-1].event_time_ns if matching else end
    return derive_sampled_value(
        feature_id=OBSERVED_LIQUIDATION_COUNT_FEATURE_ID,
        as_of_ns=end,
        input_last_event_ns=last_event,
        freshness_bound_ns=MAX_LIQUIDATION_STALENESS_NS,
        sampling=evidence.quality,
        computed=fp_from_int(len(matching)),
    )


def observed_liquidation_notional(
    evidence: LiquidationEvidenceV1,
    *,
    window_start_ns: int,
    window_end_ns: int,
) -> SampledFeatureValueV1:
    """The summed OBSERVED liquidation notional in the window.

    Any event with unknown price or quantity makes the sum UNKNOWN — an unknown
    notional is never zero and never silently skipped.
    """

    events, _, end = _window(evidence, window_start_ns, window_end_ns)
    total_aligned = 0
    computed: FixedPointV1 | None
    unknown = False
    for event in events:
        notional = event.notional_aligned
        if notional is None:
            unknown = True
            break
        total_aligned += notional
    # Notional products sit at double (10^76) alignment; quantize half-even once to
    # the fixed-point scale (10^76 / 10^12 = 10^64).
    computed = None if unknown else FixedPointV1(round_half_even(total_aligned, 10**64))
    last_event = events[-1].event_time_ns if events else end
    return derive_sampled_value(
        feature_id=OBSERVED_LIQUIDATION_NOTIONAL_FEATURE_ID,
        as_of_ns=end,
        input_last_event_ns=last_event,
        freshness_bound_ns=MAX_LIQUIDATION_STALENESS_NS,
        sampling=evidence.quality,
        computed=computed,
    )
