from __future__ import annotations

from dataclasses import dataclass

from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import MAX_FIXED_MANTISSA, FixedPointV1, round_half_even
from quant_edge.lake.contracts import require_contract_id, require_strict_int
from quant_edge.regime.contracts import (
    AlarmDirection,
    InputDisposition,
    ObservationV1,
    OrdinalGuard,
    StepStatus,
    require_fixed_point,
)
from quant_edge.regime.cusum import MAX_WARMUP


@dataclass(frozen=True, slots=True)
class PageHinkleyConfigV1:
    """Two-sided Page-Hinkley law against the exact running mean.

    The mean is the exact integer mean of eligible mantissas quantized half-even at
    every step; that quantization law is the statistic's definition, so streaming
    replay is drift-free by construction.
    """

    detector_id: str
    delta: FixedPointV1
    threshold_lambda: FixedPointV1
    warmup: int

    def __post_init__(self) -> None:
        require_contract_id(self.detector_id, field="detector_id")
        require_fixed_point(self.delta, field="delta")
        if self.delta.mantissa < 0:
            raise ContractValueError("delta cannot be negative")
        require_fixed_point(self.threshold_lambda, field="threshold_lambda")
        if self.threshold_lambda.mantissa < 1:
            raise ContractValueError("threshold_lambda must be strictly positive")
        require_strict_int(self.warmup, field="warmup", minimum=1, maximum=MAX_WARMUP)

    def as_mapping(self) -> dict[str, object]:
        return {
            "delta": self.delta.as_mapping(),
            "detectorId": self.detector_id,
            "thresholdLambda": self.threshold_lambda.as_mapping(),
            "warmup": self.warmup,
        }


@dataclass(frozen=True, slots=True)
class PageHinkleyStepV1:
    detector_id: str
    ordinal: int
    event_time_ns: int
    status: StepStatus
    statistic_up: FixedPointV1
    statistic_down: FixedPointV1
    alarm: bool
    direction: AlarmDirection | None

    def __post_init__(self) -> None:
        require_contract_id(self.detector_id, field="detector_id")
        require_strict_int(self.ordinal, field="ordinal", minimum=0)
        require_strict_int(self.event_time_ns, field="event_time_ns", minimum=0)
        if not isinstance(self.status, StepStatus):
            raise ContractValueError("status must be StepStatus")
        for field_name in ("statistic_up", "statistic_down"):
            statistic = require_fixed_point(getattr(self, field_name), field=field_name)
            if statistic.mantissa < 0:
                raise ContractValueError(f"{field_name} cannot be negative")
        if not isinstance(self.alarm, bool):
            raise ContractValueError("alarm must be boolean")
        if self.alarm and self.status is not StepStatus.OK:
            raise ContractValueError("only an OK step may alarm")
        if (self.direction is not None) != self.alarm:
            raise ContractValueError("a direction exists exactly when the step alarms")
        if self.direction is not None and not isinstance(self.direction, AlarmDirection):
            raise ContractValueError("direction must be AlarmDirection or None")

    def as_mapping(self) -> dict[str, object]:
        return {
            "alarm": self.alarm,
            "detectorId": self.detector_id,
            "direction": None if self.direction is None else self.direction.value,
            "eventTimeNs": str(self.event_time_ns),
            "ordinal": self.ordinal,
            "statisticDown": self.statistic_down.as_mapping(),
            "statisticUp": self.statistic_up.as_mapping(),
            "status": self.status.value,
        }


class TwoSidedPageHinkley:
    """Streaming two-sided Page-Hinkley; an alarm or a gap restarts everything."""

    __slots__ = (
        "__config",
        "__count",
        "__guard",
        "__statistic_down",
        "__statistic_up",
        "__sum",
    )

    def __init__(self, config: PageHinkleyConfigV1) -> None:
        if not isinstance(config, PageHinkleyConfigV1):
            raise ContractValueError("config must be PageHinkleyConfigV1")
        self.__config = config
        self.__guard = OrdinalGuard()
        self.__restart()

    @property
    def config(self) -> PageHinkleyConfigV1:
        return self.__config

    def __restart(self) -> None:
        self.__count = 0
        self.__sum = 0
        self.__statistic_up = 0
        self.__statistic_down = 0

    def __step(
        self,
        observation: ObservationV1,
        *,
        status: StepStatus,
        alarm: bool = False,
        direction: AlarmDirection | None = None,
    ) -> PageHinkleyStepV1:
        return PageHinkleyStepV1(
            detector_id=self.__config.detector_id,
            ordinal=observation.ordinal,
            event_time_ns=observation.event_time_ns,
            status=status,
            statistic_up=FixedPointV1(self.__statistic_up),
            statistic_down=FixedPointV1(self.__statistic_down),
            alarm=alarm,
            direction=direction,
        )

    def update(self, observation: ObservationV1) -> PageHinkleyStepV1:
        if not isinstance(observation, ObservationV1):
            raise ContractValueError("observation must be ObservationV1")
        self.__guard.check(observation.ordinal, observation.event_time_ns)
        disposition = observation.disposition
        if disposition is InputDisposition.SUPPRESS:
            return self.__step(observation, status=StepStatus.SUPPRESSED)
        if disposition is InputDisposition.RESET:
            self.__restart()
            return self.__step(observation, status=StepStatus.RESET)
        self.__count += 1
        self.__sum += observation.value.mantissa
        mean = round_half_even(self.__sum, self.__count)
        delta = self.__config.delta.mantissa
        self.__statistic_up = min(
            MAX_FIXED_MANTISSA,
            max(0, self.__statistic_up + observation.value.mantissa - mean - delta),
        )
        self.__statistic_down = min(
            MAX_FIXED_MANTISSA,
            max(0, self.__statistic_down + mean - observation.value.mantissa - delta),
        )
        if self.__count <= self.__config.warmup:
            return self.__step(observation, status=StepStatus.WARMUP)
        statistic_up = self.__statistic_up
        statistic_down = self.__statistic_down
        threshold = self.__config.threshold_lambda.mantissa
        alarm_up = statistic_up >= threshold
        alarm_down = statistic_down >= threshold
        if not (alarm_up or alarm_down):
            return self.__step(observation, status=StepStatus.OK)
        if alarm_up and (not alarm_down or statistic_up >= statistic_down):
            direction = AlarmDirection.UP
        else:
            direction = AlarmDirection.DOWN
        step = self.__step(observation, status=StepStatus.OK, alarm=True, direction=direction)
        self.__restart()
        return step
