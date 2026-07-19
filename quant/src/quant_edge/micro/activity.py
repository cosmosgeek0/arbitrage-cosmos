"""Bounded, prior-only multi-horizon activity-transition evidence.

The family consumes public aggregate observations, not private exchange state. Every
baseline is computed from observations strictly before the assessed print. Missing
activity, spread, depth or peer evidence stays ``UNKNOWN``; no field is silently
replaced with zero. A wake needs more than one consecutive qualifying print, which
prevents a single burst from being promoted into persistent activity.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from enum import StrEnum
from typing import Final

from quant_edge.errors import ContractValueError
from quant_edge.features.domains import BarDomain
from quant_edge.features.fixedpoint import FixedPointV1
from quant_edge.features.registry import FeatureCardV1
from quant_edge.labels.rational import ExactRatioV1, make_ratio
from quant_edge.lake.contracts import require_contract_id, require_strict_int
from quant_edge.micro.equivalence import MicroFeatureImplementationV1
from quant_edge.micro.l1 import fp_from_fraction

MAX_ACTIVITY_COUNT: Final = 10**12
MAX_ACTIVITY_HORIZON: Final = 4_096
MAX_ACTIVITY_OBSERVATIONS: Final = 4_096
MAX_ACTIVITY_HORIZONS: Final = 32
MAX_ACTIVITY_OUTPUT_ROWS: Final = MAX_ACTIVITY_OBSERVATIONS * MAX_ACTIVITY_HORIZONS
ACTIVITY_SURPRISE_LOOKBACK: Final = 4


class ActivityState(StrEnum):
    WARMUP = "WARMUP"
    UNKNOWN = "UNKNOWN"
    QUIET = "QUIET"
    ONE_PRINT_REJECTED = "ONE_PRINT_REJECTED"
    WAKE = "WAKE"
    PERSISTENT = "PERSISTENT"
    FADING = "FADING"


@dataclass(frozen=True, slots=True)
class ActivityObservationV1:
    observation_id: str
    event_time_ns: int
    ordinal: int
    trades: int | None
    quote_updates: int | None
    spread_ticks: int | None
    bid_depth: int | None
    ask_depth: int | None
    peer_activity: int | None

    def __post_init__(self) -> None:
        require_contract_id(self.observation_id, field="observation_id")
        require_strict_int(self.event_time_ns, field="event_time_ns", minimum=0)
        require_strict_int(self.ordinal, field="ordinal", minimum=0)
        for field, value in (
            ("trades", self.trades),
            ("quote_updates", self.quote_updates),
            ("spread_ticks", self.spread_ticks),
            ("bid_depth", self.bid_depth),
            ("ask_depth", self.ask_depth),
            ("peer_activity", self.peer_activity),
        ):
            if value is not None:
                require_strict_int(value, field=field, minimum=0, maximum=MAX_ACTIVITY_COUNT)

    @property
    def activity(self) -> int | None:
        if self.trades is None or self.quote_updates is None:
            return None
        return self.trades + self.quote_updates

    @property
    def depth(self) -> int | None:
        if self.bid_depth is None or self.ask_depth is None:
            return None
        return self.bid_depth + self.ask_depth


@dataclass(frozen=True, slots=True)
class ActivityHorizonV1:
    horizon_id: str
    lookback: int
    surprise_numerator: int
    surprise_denominator: int
    persistence_prints: int
    controlled_spread_ticks: int

    def __post_init__(self) -> None:
        require_contract_id(self.horizon_id, field="horizon_id")
        require_strict_int(self.lookback, field="lookback", minimum=2, maximum=MAX_ACTIVITY_HORIZON)
        require_strict_int(self.surprise_numerator, field="surprise_numerator", minimum=1)
        require_strict_int(self.surprise_denominator, field="surprise_denominator", minimum=1)
        if self.surprise_numerator <= self.surprise_denominator:
            raise ContractValueError("surprise threshold must be greater than one")
        require_strict_int(
            self.persistence_prints,
            field="persistence_prints",
            minimum=2,
            maximum=self.lookback,
        )
        require_strict_int(
            self.controlled_spread_ticks,
            field="controlled_spread_ticks",
            minimum=0,
        )


@dataclass(frozen=True, slots=True)
class ActivityTransitionV1:
    horizon_id: str
    observation_id: str
    ordinal: int
    state: ActivityState
    surprise: ExactRatioV1 | None
    qualifying_prints: int
    controlled_spread: bool | None
    compression: bool | None
    liquidity_arrival: ExactRatioV1 | None
    peer_abnormality: ExactRatioV1 | None

    def __post_init__(self) -> None:
        require_contract_id(self.horizon_id, field="horizon_id")
        require_contract_id(self.observation_id, field="observation_id")
        require_strict_int(self.ordinal, field="ordinal", minimum=0)
        if not isinstance(self.state, ActivityState):
            raise ContractValueError("state must be ActivityState")
        require_strict_int(self.qualifying_prints, field="qualifying_prints", minimum=0)
        for field, ratio_value in (
            ("surprise", self.surprise),
            ("liquidity_arrival", self.liquidity_arrival),
            ("peer_abnormality", self.peer_abnormality),
        ):
            if ratio_value is not None and not isinstance(ratio_value, ExactRatioV1):
                raise ContractValueError(f"{field} must be ExactRatioV1 or None")
        for field, flag_value in (
            ("controlled_spread", self.controlled_spread),
            ("compression", self.compression),
        ):
            if flag_value is not None and not isinstance(flag_value, bool):
                raise ContractValueError(f"{field} must be bool or None")

    def as_mapping(self) -> dict[str, object]:
        return {
            "compression": self.compression,
            "controlledSpread": self.controlled_spread,
            "horizonId": self.horizon_id,
            "liquidityArrival": (
                None if self.liquidity_arrival is None else self.liquidity_arrival.as_mapping()
            ),
            "observationId": self.observation_id,
            "ordinal": self.ordinal,
            "peerAbnormality": (
                None if self.peer_abnormality is None else self.peer_abnormality.as_mapping()
            ),
            "qualifyingPrints": self.qualifying_prints,
            "state": self.state.value,
            "surprise": None if self.surprise is None else self.surprise.as_mapping(),
        }


def _mean_ratio(value: int, baseline: tuple[int, ...]) -> ExactRatioV1:
    return make_ratio(value * len(baseline), sum(baseline))


def _qualifies(
    observation: ActivityObservationV1,
    prior: tuple[ActivityObservationV1, ...],
    horizon: ActivityHorizonV1,
) -> tuple[bool | None, ExactRatioV1 | None, bool | None]:
    activity = observation.activity
    baseline = tuple(item.activity for item in prior)
    if activity is None or any(item is None for item in baseline):
        return None, None, None
    observed_values: list[int] = []
    for item in baseline:
        if item is None:
            raise AssertionError("missing baselines return above")
        observed_values.append(item)
    observed = tuple(observed_values)
    if sum(observed) == 0:
        return None, None, None
    surprise = _mean_ratio(activity, observed)
    controlled = (
        None
        if observation.spread_ticks is None
        else observation.spread_ticks <= horizon.controlled_spread_ticks
    )
    above = (
        surprise.numerator * horizon.surprise_denominator
        >= surprise.denominator * horizon.surprise_numerator
    )
    return (None if controlled is None else above and controlled), surprise, controlled


def _liquidity(
    observation: ActivityObservationV1,
    prior: ActivityObservationV1,
) -> tuple[bool | None, ExactRatioV1 | None]:
    depth = observation.depth
    previous_depth = prior.depth
    if (
        depth is None
        or previous_depth is None
        or previous_depth == 0
        or observation.spread_ticks is None
        or prior.spread_ticks is None
    ):
        return None, None
    arrival = max(0, depth - previous_depth)
    compression = depth > previous_depth and observation.spread_ticks < prior.spread_ticks
    return compression, make_ratio(arrival, previous_depth)


def activity_transitions(
    observations: tuple[ActivityObservationV1, ...],
    horizons: tuple[ActivityHorizonV1, ...],
) -> tuple[ActivityTransitionV1, ...]:
    """Return ordered horizon-major transitions using only each row's prior prefix."""

    if (
        not isinstance(observations, tuple)
        or not observations
        or len(observations) > MAX_ACTIVITY_OBSERVATIONS
    ):
        raise ContractValueError(
            f"observations must be a non-empty tuple bounded at {MAX_ACTIVITY_OBSERVATIONS}"
        )
    if not isinstance(horizons, tuple) or not horizons or len(horizons) > MAX_ACTIVITY_HORIZONS:
        raise ContractValueError(
            f"horizons must be a non-empty tuple bounded at {MAX_ACTIVITY_HORIZONS}"
        )
    if len(observations) * len(horizons) > MAX_ACTIVITY_OUTPUT_ROWS:
        raise ContractValueError(f"activity output must be bounded at {MAX_ACTIVITY_OUTPUT_ROWS}")
    if any(not isinstance(item, ActivityHorizonV1) for item in horizons):
        raise ContractValueError("horizons must contain ActivityHorizonV1")
    if tuple(sorted(item.horizon_id for item in horizons)) != tuple(
        item.horizon_id for item in horizons
    ) or len({item.horizon_id for item in horizons}) != len(horizons):
        raise ContractValueError("horizons must be sorted and unique by horizon_id")
    previous_ordinal: int | None = None
    previous_time = -1
    observation_ids: set[str] = set()
    for observation in observations:
        if not isinstance(observation, ActivityObservationV1):
            raise ContractValueError("observations must contain ActivityObservationV1")
        if previous_ordinal is not None and observation.ordinal <= previous_ordinal:
            raise ContractValueError("observations must be strictly chronological")
        if previous_ordinal is not None and observation.ordinal != previous_ordinal + 1:
            raise ContractValueError("observations must form one gap-free ordinal segment")
        if observation.observation_id in observation_ids:
            raise ContractValueError("observation identifiers must be unique")
        if observation.event_time_ns <= previous_time:
            raise ContractValueError("observations must be strictly chronological")
        observation_ids.add(observation.observation_id)
        previous_ordinal = observation.ordinal
        previous_time = observation.event_time_ns

    output: list[ActivityTransitionV1] = []
    for horizon in horizons:
        active = False
        qualifying_prints = 0
        for index, observation in enumerate(observations):
            if index < horizon.lookback:
                state = ActivityState.WARMUP
                surprise = None
                controlled = None
            else:
                prior = observations[index - horizon.lookback : index]
                qualifies, surprise, controlled = _qualifies(observation, prior, horizon)
                if qualifies is None:
                    state = ActivityState.UNKNOWN
                    qualifying_prints = 0
                    active = False
                elif qualifies:
                    qualifying_prints += 1
                    if qualifying_prints < horizon.persistence_prints:
                        state = ActivityState.ONE_PRINT_REJECTED
                    elif not active:
                        state = ActivityState.WAKE
                        active = True
                    else:
                        state = ActivityState.PERSISTENT
                else:
                    qualifying_prints = 0
                    state = ActivityState.FADING if active else ActivityState.QUIET
                    active = False
            compression, arrival = (
                (None, None) if index == 0 else _liquidity(observation, observations[index - 1])
            )
            peer = (
                None
                if observation.activity is None
                or observation.peer_activity is None
                or observation.peer_activity == 0
                else make_ratio(observation.activity, observation.peer_activity)
            )
            output.append(
                ActivityTransitionV1(
                    horizon_id=horizon.horizon_id,
                    observation_id=observation.observation_id,
                    ordinal=observation.ordinal,
                    state=state,
                    surprise=surprise,
                    qualifying_prints=qualifying_prints,
                    controlled_spread=controlled,
                    compression=compression,
                    liquidity_arrival=arrival,
                    peer_abnormality=peer,
                )
            )
    return tuple(output)


def batch_activity_surprise(
    observations: tuple[ActivityObservationV1, ...],
) -> FixedPointV1 | None:
    """Return current activity divided by its strictly-prior four-print mean."""

    if not observations:
        return None
    horizon = ActivityHorizonV1(
        horizon_id="q07-activity-surprise-v1",
        lookback=ACTIVITY_SURPRISE_LOOKBACK,
        surprise_numerator=2,
        surprise_denominator=1,
        persistence_prints=2,
        controlled_spread_ticks=2,
    )
    transition = activity_transitions(observations, (horizon,))[-1]
    surprise = transition.surprise
    if surprise is None:
        return None
    return fp_from_fraction(surprise.numerator, surprise.denominator)


class _StreamingActivitySurprise:
    __slots__ = (
        "__count",
        "__ids",
        "__last_ordinal",
        "__last_time",
        "__ops",
        "__prior",
    )

    def __init__(self) -> None:
        self.__count = 0
        self.__ids: set[str] = set()
        self.__last_ordinal: int | None = None
        self.__last_time = -1
        self.__ops = 0
        self.__prior: deque[int | None] = deque()

    @property
    def last_update_ops(self) -> int:
        return self.__ops

    def update(self, observation: ActivityObservationV1) -> FixedPointV1 | None:
        if not isinstance(observation, ActivityObservationV1):
            raise ContractValueError("observations must contain ActivityObservationV1")
        if self.__count >= MAX_ACTIVITY_OBSERVATIONS:
            raise ContractValueError(f"observations must be bounded at {MAX_ACTIVITY_OBSERVATIONS}")
        if self.__last_ordinal is not None and observation.ordinal <= self.__last_ordinal:
            raise ContractValueError("observations must be strictly chronological")
        if self.__last_ordinal is not None and observation.ordinal != self.__last_ordinal + 1:
            raise ContractValueError("observations must form one gap-free ordinal segment")
        if observation.observation_id in self.__ids:
            raise ContractValueError("observation identifiers must be unique")
        if observation.event_time_ns <= self.__last_time:
            raise ContractValueError("observations must be strictly chronological")

        self.__count += 1
        self.__ids.add(observation.observation_id)
        self.__last_ordinal = observation.ordinal
        self.__last_time = observation.event_time_ns
        current = observation.activity
        value: FixedPointV1 | None = None
        if (
            len(self.__prior) == ACTIVITY_SURPRISE_LOOKBACK
            and current is not None
            and all(item is not None for item in self.__prior)
        ):
            prior_sum = sum(item for item in self.__prior if item is not None)
            if prior_sum > 0:
                value = fp_from_fraction(
                    current * ACTIVITY_SURPRISE_LOOKBACK,
                    prior_sum,
                )
        self.__prior.append(current)
        if len(self.__prior) > ACTIVITY_SURPRISE_LOOKBACK:
            self.__prior.popleft()
        self.__ops = 1
        return value


def activity_surprise_feature() -> MicroFeatureImplementationV1[ActivityObservationV1]:
    """Canonical Q07 feature adapter for the richer activity-transition report."""

    return MicroFeatureImplementationV1(
        card=FeatureCardV1(
            name="activity_surprise",
            version="v1",
            economic_hypothesis=(
                "activity relative to a strictly-prior local baseline measures an "
                "auditable transition in public aggregate flow"
            ),
            inputs=("public_activity_observations",),
            window_law=(
                f"current print divided by the mean of exactly the prior "
                f"{ACTIVITY_SURPRISE_LOOKBACK} gap-free prints"
            ),
            domain=BarDomain.EVENT_TIME,
            normalization_cohort="symbol-self",
            missing_behavior=(
                "missing current or baseline activity and zero baseline activity yield "
                "UNKNOWN, never zero"
            ),
            stale_behavior="gap or non-monotonic chronology is rejected",
            unit_id="RATIO",
            lower_bound=FixedPointV1(0),
            upper_bound=None,
            incremental_update_rule=(
                "retain a bounded four-print prior window, evaluate before inserting the "
                "current print, then evict the oldest print"
            ),
            batch_reference="quant_edge.micro.activity:batch_activity_surprise",
            streaming_implementation=("quant_edge.micro.activity:_StreamingActivitySurprise"),
            provenance=(
                "Q07 public aggregate activity transition adapter; research machinery only"
            ),
            computational_cost="O_1_PER_UPDATE",
            expected_failure_modes=(
                "GAPPED_ORDINALS",
                "MISSING_ACTIVITY",
                "ZERO_PRIOR_BASELINE",
            ),
            test_binding="tests.unit.test_q07_families",
            equivalence_tolerance_ulp=0,
        ),
        batch=batch_activity_surprise,
        make_streaming=_StreamingActivitySurprise,
        declared_max_update_ops=1,
    )
