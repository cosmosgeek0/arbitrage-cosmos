from __future__ import annotations

from dataclasses import dataclass
from typing import Final

from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import FIXED_POINT_SCALE, FixedPointV1, round_half_even
from quant_edge.labels.rational import ExactRatioV1
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

MAX_RUN_CAP: Final = 128
MAX_HAZARD_DENOMINATOR: Final = 1_000_000


@dataclass(frozen=True, slots=True)
class BocpdConfigV1:
    """Adams-MacKay BOCPD over a bounded robust alphabet with a hard run cap.

    The per-run-length predictive is the exact Dirichlet(1)-categorical rational
    quantized half-even to fixed point; the run-length posterior is fixed-point
    with the largest-remainder normalization law; growth mass beyond the cap folds
    into the cap bin. Those quantization laws are the detector's definition.

    The alarm statistic is the cumulative posterior mass at run lengths at most
    ``alarm_run_length``; ``alarm_warmup`` OK steps must pass after every reset
    before the alarm gains authority, because the initial delta-at-zero posterior
    would otherwise alarm on its own prior.
    """

    detector_id: str
    alphabet: AlphabetConfigV1
    hazard: ExactRatioV1
    run_cap: int
    alarm_run_length: int
    alarm_threshold: FixedPointV1
    alarm_warmup: int

    def __post_init__(self) -> None:
        require_contract_id(self.detector_id, field="detector_id")
        if not isinstance(self.alphabet, AlphabetConfigV1):
            raise ContractValueError("alphabet must be AlphabetConfigV1")
        if not isinstance(self.hazard, ExactRatioV1):
            raise ContractValueError("hazard must be ExactRatioV1")
        if self.hazard.numerator < 1 or self.hazard.numerator >= self.hazard.denominator:
            raise ContractValueError("hazard must lie strictly between zero and one")
        if self.hazard.denominator > MAX_HAZARD_DENOMINATOR:
            raise ContractValueError("hazard denominator exceeds the bounded maximum")
        cap = require_strict_int(self.run_cap, field="run_cap", minimum=2, maximum=MAX_RUN_CAP)
        require_strict_int(
            self.alarm_run_length,
            field="alarm_run_length",
            minimum=0,
            maximum=cap - 1,
        )
        require_fixed_point(self.alarm_threshold, field="alarm_threshold")
        if not 1 <= self.alarm_threshold.mantissa <= FIXED_POINT_SCALE:
            raise ContractValueError("alarm_threshold must lie inside (0, 1]")
        require_strict_int(
            self.alarm_warmup,
            field="alarm_warmup",
            minimum=self.alarm_run_length + 1,
            maximum=MAX_RUN_CAP * 4,
        )

    def as_mapping(self) -> dict[str, object]:
        return {
            "alarmRunLength": self.alarm_run_length,
            "alarmThreshold": self.alarm_threshold.as_mapping(),
            "alarmWarmup": self.alarm_warmup,
            "alphabet": self.alphabet.as_mapping(),
            "detectorId": self.detector_id,
            "hazard": self.hazard.as_mapping(),
            "runCap": self.run_cap,
        }


@dataclass(frozen=True, slots=True)
class BocpdStepV1:
    """One BOCPD step; the posterior always sums exactly to the fixed-point scale."""

    detector_id: str
    ordinal: int
    event_time_ns: int
    status: StepStatus
    symbol: int | None
    posterior: tuple[int, ...]
    map_run_length: int
    change_mass: FixedPointV1
    alarm: bool

    def __post_init__(self) -> None:
        require_contract_id(self.detector_id, field="detector_id")
        require_strict_int(self.ordinal, field="ordinal", minimum=0)
        require_strict_int(self.event_time_ns, field="event_time_ns", minimum=0)
        if not isinstance(self.status, StepStatus):
            raise ContractValueError("status must be StepStatus")
        if self.symbol is not None:
            require_strict_int(self.symbol, field="symbol", minimum=0)
        if (self.symbol is not None) != (self.status is StepStatus.OK):
            raise ContractValueError("a symbol exists exactly when the step is OK")
        if not isinstance(self.posterior, tuple) or len(self.posterior) < 3:
            raise ContractValueError("posterior must be a tuple over run lengths 0..cap")
        total = 0
        for index, mass in enumerate(self.posterior):
            require_strict_int(
                mass,
                field=f"posterior[{index}]",
                minimum=0,
                maximum=FIXED_POINT_SCALE,
            )
            total += mass
        if total != FIXED_POINT_SCALE:
            raise ContractValueError("posterior must sum exactly to the fixed-point scale")
        require_strict_int(
            self.map_run_length,
            field="map_run_length",
            minimum=0,
            maximum=len(self.posterior) - 1,
        )
        require_fixed_point(self.change_mass, field="change_mass")
        if self.change_mass.mantissa != self.posterior[0]:
            raise ContractValueError("change_mass must equal the posterior mass at run zero")
        if not isinstance(self.alarm, bool):
            raise ContractValueError("alarm must be boolean")
        if self.alarm and self.status is not StepStatus.OK:
            raise ContractValueError("only an OK step may alarm")

    def as_mapping(self) -> dict[str, object]:
        return {
            "alarm": self.alarm,
            "changeMass": self.change_mass.as_mapping(),
            "detectorId": self.detector_id,
            "eventTimeNs": str(self.event_time_ns),
            "mapRunLength": self.map_run_length,
            "ordinal": self.ordinal,
            "posterior": [str(mass) for mass in self.posterior],
            "status": self.status.value,
            "symbol": self.symbol,
        }


class BocpdDetector:
    """Streaming bounded-run-length BOCPD; gaps reset the posterior and baseline."""

    __slots__ = (
        "__config",
        "__guard",
        "__history",
        "__ok_steps",
        "__posterior",
        "__symbolizer",
    )

    def __init__(self, config: BocpdConfigV1) -> None:
        if not isinstance(config, BocpdConfigV1):
            raise ContractValueError("config must be BocpdConfigV1")
        self.__config = config
        self.__guard = OrdinalGuard()
        self.__symbolizer = RobustDiscretizer(config.alphabet)
        self.__history: list[int] = []
        self.__ok_steps = 0
        self.__posterior = _initial_posterior(config.run_cap)

    @property
    def config(self) -> BocpdConfigV1:
        return self.__config

    def __step(
        self,
        observation: ObservationV1,
        *,
        status: StepStatus,
        symbol: int | None = None,
        alarm: bool = False,
    ) -> BocpdStepV1:
        posterior = tuple(self.__posterior)
        return BocpdStepV1(
            detector_id=self.__config.detector_id,
            ordinal=observation.ordinal,
            event_time_ns=observation.event_time_ns,
            status=status,
            symbol=symbol,
            posterior=posterior,
            map_run_length=_argmax(posterior),
            change_mass=FixedPointV1(posterior[0]),
            alarm=alarm,
        )

    def __reset(self) -> None:
        self.__symbolizer.reset()
        self.__history = []
        self.__ok_steps = 0
        self.__posterior = _initial_posterior(self.__config.run_cap)

    def update(self, observation: ObservationV1) -> BocpdStepV1:
        if not isinstance(observation, ObservationV1):
            raise ContractValueError("observation must be ObservationV1")
        self.__guard.check(observation.ordinal, observation.event_time_ns)
        disposition = observation.disposition
        if disposition is InputDisposition.SUPPRESS:
            return self.__step(observation, status=StepStatus.SUPPRESSED)
        if disposition is InputDisposition.RESET:
            self.__reset()
            return self.__step(observation, status=StepStatus.RESET)
        symbol = self.__symbolizer.classify_and_push(observation.value)
        if symbol is None:
            return self.__step(observation, status=StepStatus.WARMUP)
        self.__advance(symbol)
        self.__ok_steps += 1
        short_run_mass = sum(self.__posterior[: self.__config.alarm_run_length + 1])
        alarm = (
            self.__ok_steps > self.__config.alarm_warmup
            and short_run_mass >= self.__config.alarm_threshold.mantissa
        )
        return self.__step(observation, status=StepStatus.OK, symbol=symbol, alarm=alarm)

    def __advance(self, symbol: int) -> None:
        cap = self.__config.run_cap
        alphabet_size = self.__config.alphabet.symbol_count
        hazard_num = self.__config.hazard.numerator
        hazard_den = self.__config.hazard.denominator
        survive_num = hazard_den - hazard_num
        history = self.__history
        posterior = self.__posterior
        # predictive[r] uses counts of the incoming symbol over the last r symbols;
        # the cap bin may see less history than its nominal run length, a documented
        # consequence of the bounded-run-length approximation.
        growth = [0] * (cap + 1)
        change_mass = 0
        matches = 0
        for run_length in range(cap + 1):
            observed = min(run_length, len(history))
            if 0 < run_length <= len(history) and history[-run_length] == symbol:
                matches += 1
            predictive = round_half_even(
                (matches + 1) * FIXED_POINT_SCALE,
                observed + alphabet_size,
            )
            weighted = posterior[run_length] * predictive
            change_mass += weighted * hazard_num
            target = min(run_length + 1, cap)
            growth[target] += weighted * survive_num
        growth[0] = change_mass
        self.__posterior = list(normalize_to_scale(tuple(growth)))
        history.append(symbol)
        if len(history) > cap:
            del history[0]


def _initial_posterior(run_cap: int) -> list[int]:
    posterior = [0] * (run_cap + 1)
    posterior[0] = FIXED_POINT_SCALE
    return posterior


def _argmax(posterior: tuple[int, ...]) -> int:
    best_index = 0
    for index in range(1, len(posterior)):
        if posterior[index] > posterior[best_index]:
            best_index = index
    return best_index
