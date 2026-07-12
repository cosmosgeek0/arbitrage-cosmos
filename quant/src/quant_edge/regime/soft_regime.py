from __future__ import annotations

from dataclasses import dataclass
from typing import Final, Protocol

from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import FIXED_POINT_SCALE, FixedPointV1
from quant_edge.lake.contracts import require_contract_id, require_strict_int
from quant_edge.regime.alphabet import AlphabetConfigV1, RobustDiscretizer
from quant_edge.regime.contracts import (
    InputDisposition,
    ObservationV1,
    OrdinalGuard,
    StepStatus,
    normalize_to_scale,
    require_fixed_point,
)

MAX_STATES: Final = 16

V1_REGIME_STATES: Final = ("QUIET", "TRENDING", "VOLATILE", "DISORDERED")


def _require_probability_row(
    row: object,
    *,
    field: str,
    width: int,
    minimum_mantissa: int,
) -> tuple[FixedPointV1, ...]:
    if not isinstance(row, tuple) or len(row) != width:
        raise ContractValueError(f"{field} must be a tuple of width {width}")
    total = 0
    for index, entry in enumerate(row):
        probability = require_fixed_point(entry, field=f"{field}[{index}]")
        if probability.mantissa < minimum_mantissa:
            raise ContractValueError(f"{field}[{index}] is below the required minimum")
        total += probability.mantissa
    if total != FIXED_POINT_SCALE:
        raise ContractValueError(f"{field} must sum exactly to one")
    return row


@dataclass(frozen=True, slots=True)
class RegimeSpecV1:
    """A fixed soft-regime specification behind the stable `RegimeModel` interface.

    Transition and emission rows are exact fixed-point distributions; every
    emission entry is strictly positive so no symbol is impossible, and the floor
    mixes the posterior with uniform mass so no state can be ruled out — the
    §14.6 unseen-regime overconfidence guard, enforced by construction. The v1
    tables are machinery constants, not market truth.
    """

    spec_id: str
    states: tuple[str, ...]
    alphabet: AlphabetConfigV1
    transition: tuple[tuple[FixedPointV1, ...], ...]
    emission: tuple[tuple[FixedPointV1, ...], ...]
    floor: FixedPointV1

    def __post_init__(self) -> None:
        require_contract_id(self.spec_id, field="spec_id")
        if not isinstance(self.states, tuple) or not 2 <= len(self.states) <= MAX_STATES:
            raise ContractValueError(f"states must be a tuple of 2..{MAX_STATES} names")
        for state in self.states:
            require_contract_id(state, field="states")
        if len(set(self.states)) != len(self.states):
            raise ContractValueError("state names must be unique")
        if not isinstance(self.alphabet, AlphabetConfigV1):
            raise ContractValueError("alphabet must be AlphabetConfigV1")
        count = len(self.states)
        if not isinstance(self.transition, tuple) or len(self.transition) != count:
            raise ContractValueError("transition must carry one row per state")
        for index, row in enumerate(self.transition):
            _require_probability_row(
                row,
                field=f"transition[{index}]",
                width=count,
                minimum_mantissa=0,
            )
        if not isinstance(self.emission, tuple) or len(self.emission) != count:
            raise ContractValueError("emission must carry one row per state")
        for index, row in enumerate(self.emission):
            _require_probability_row(
                row,
                field=f"emission[{index}]",
                width=self.alphabet.symbol_count,
                minimum_mantissa=1,
            )
        require_fixed_point(self.floor, field="floor")
        if self.floor.mantissa < 0:
            raise ContractValueError("floor cannot be negative")
        if self.floor.mantissa * count >= FIXED_POINT_SCALE:
            raise ContractValueError("floor mass must leave room for evidence")

    def as_mapping(self) -> dict[str, object]:
        return {
            "alphabet": self.alphabet.as_mapping(),
            "emission": [[entry.as_mapping() for entry in row] for row in self.emission],
            "floor": self.floor.as_mapping(),
            "specId": self.spec_id,
            "states": list(self.states),
            "transition": [[entry.as_mapping() for entry in row] for row in self.transition],
        }


@dataclass(frozen=True, slots=True)
class RegimeStepV1:
    """Soft regime truth: the full distribution first, the hard label second."""

    spec_id: str
    ordinal: int
    event_time_ns: int
    status: StepStatus
    symbol: int | None
    probabilities: tuple[int, ...]
    map_state: str
    uncertainty: FixedPointV1

    def __post_init__(self) -> None:
        require_contract_id(self.spec_id, field="spec_id")
        require_strict_int(self.ordinal, field="ordinal", minimum=0)
        require_strict_int(self.event_time_ns, field="event_time_ns", minimum=0)
        if not isinstance(self.status, StepStatus):
            raise ContractValueError("status must be StepStatus")
        if self.symbol is not None:
            require_strict_int(self.symbol, field="symbol", minimum=0)
        if (self.symbol is not None) != (self.status is StepStatus.OK):
            raise ContractValueError("a symbol exists exactly when the step is OK")
        if not isinstance(self.probabilities, tuple) or len(self.probabilities) < 2:
            raise ContractValueError("probabilities must cover at least two states")
        total = 0
        best = 0
        for index, mass in enumerate(self.probabilities):
            require_strict_int(
                mass,
                field=f"probabilities[{index}]",
                minimum=0,
                maximum=FIXED_POINT_SCALE,
            )
            total += mass
            best = max(best, mass)
        if total != FIXED_POINT_SCALE:
            raise ContractValueError("probabilities must sum exactly to one")
        require_contract_id(self.map_state, field="map_state")
        require_fixed_point(self.uncertainty, field="uncertainty")
        if self.uncertainty.mantissa != FIXED_POINT_SCALE - best:
            raise ContractValueError("uncertainty must equal one minus the maximum mass")

    def as_mapping(self) -> dict[str, object]:
        return {
            "eventTimeNs": str(self.event_time_ns),
            "mapState": self.map_state,
            "ordinal": self.ordinal,
            "probabilities": [str(mass) for mass in self.probabilities],
            "specId": self.spec_id,
            "status": self.status.value,
            "symbol": self.symbol,
            "uncertainty": self.uncertainty.as_mapping(),
        }


class RegimeModel(Protocol):
    def update(self, observation: ObservationV1) -> RegimeStepV1:
        """Consume one observation and return the soft-regime step record."""


class SoftRegimeFilter:
    """Deterministic recursive Bayesian filter over a fixed regime specification."""

    __slots__ = ("__guard", "__posterior", "__spec", "__symbolizer")

    def __init__(self, spec: RegimeSpecV1) -> None:
        if not isinstance(spec, RegimeSpecV1):
            raise ContractValueError("spec must be RegimeSpecV1")
        self.__spec = spec
        self.__guard = OrdinalGuard()
        self.__symbolizer = RobustDiscretizer(spec.alphabet)
        self.__posterior = _uniform_posterior(len(spec.states))

    @property
    def spec(self) -> RegimeSpecV1:
        return self.__spec

    def __step(
        self,
        observation: ObservationV1,
        *,
        status: StepStatus,
        symbol: int | None = None,
    ) -> RegimeStepV1:
        probabilities = tuple(self.__posterior)
        best_index = 0
        for index in range(1, len(probabilities)):
            if probabilities[index] > probabilities[best_index]:
                best_index = index
        return RegimeStepV1(
            spec_id=self.__spec.spec_id,
            ordinal=observation.ordinal,
            event_time_ns=observation.event_time_ns,
            status=status,
            symbol=symbol,
            probabilities=probabilities,
            map_state=self.__spec.states[best_index],
            uncertainty=FixedPointV1(FIXED_POINT_SCALE - probabilities[best_index]),
        )

    def __reset(self) -> None:
        self.__symbolizer.reset()
        self.__posterior = _uniform_posterior(len(self.__spec.states))

    def update(self, observation: ObservationV1) -> RegimeStepV1:
        if not isinstance(observation, ObservationV1):
            raise ContractValueError("observation must be ObservationV1")
        self.__guard.check(observation.ordinal)
        disposition = observation.disposition
        if disposition is InputDisposition.SUPPRESS:
            return self.__step(observation, status=StepStatus.SUPPRESSED)
        if disposition is InputDisposition.RESET:
            self.__reset()
            return self.__step(observation, status=StepStatus.RESET)
        symbol = self.__symbolizer.classify_and_push(observation.value)
        if symbol is None:
            return self.__step(observation, status=StepStatus.WARMUP)
        spec = self.__spec
        count = len(spec.states)
        weights = []
        for target in range(count):
            predicted = sum(
                self.__posterior[source] * spec.transition[source][target].mantissa
                for source in range(count)
            )
            weights.append(predicted * spec.emission[target][symbol].mantissa)
        floor = spec.floor.mantissa
        evidence_mass = FIXED_POINT_SCALE - floor * count
        shares = normalize_to_scale(tuple(weights), target=evidence_mass)
        self.__posterior = [floor + share for share in shares]
        return self.__step(observation, status=StepStatus.OK, symbol=symbol)


def _uniform_posterior(count: int) -> list[int]:
    return list(normalize_to_scale(tuple([1] * count)))


def v1_regime_spec() -> RegimeSpecV1:
    """The v1 joint quiet/trending/volatile/disordered machinery specification."""

    def fp(thousandths: int) -> FixedPointV1:
        return FixedPointV1(thousandths * (FIXED_POINT_SCALE // 1_000))

    sticky = fp(850)
    drift = fp(50)
    return RegimeSpecV1(
        spec_id="regime-spec-v1",
        states=V1_REGIME_STATES,
        alphabet=AlphabetConfigV1(
            baseline_window=16,
            thresholds=(FixedPointV1(FIXED_POINT_SCALE), FixedPointV1(3 * FIXED_POINT_SCALE)),
        ),
        transition=(
            (sticky, drift, drift, drift),
            (drift, sticky, drift, drift),
            (drift, drift, sticky, drift),
            (drift, drift, drift, sticky),
        ),
        emission=(
            (fp(50), fp(150), fp(600), fp(150), fp(50)),
            (fp(100), fp(300), fp(200), fp(300), fp(100)),
            (fp(250), fp(150), fp(200), fp(150), fp(250)),
            (fp(200), fp(200), fp(200), fp(200), fp(200)),
        ),
        floor=FixedPointV1(FIXED_POINT_SCALE // 1_000),
    )
