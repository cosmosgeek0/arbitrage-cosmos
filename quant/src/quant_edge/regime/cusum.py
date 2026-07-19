from __future__ import annotations

from dataclasses import dataclass
from typing import Final

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

MAX_WARMUP: Final = 4_096


@dataclass(frozen=True, slots=True)
class CusumConfigV1:
    """Two-sided CUSUM law: slack and threshold are explicit value-unit truth.

    ``reference`` fixes the in-control mean; when ``None`` the detector estimates it
    as the half-even mean of the first ``warmup`` eligible observations, so warmup
    must be zero exactly when the reference is fixed.
    """

    detector_id: str
    reference: FixedPointV1 | None
    warmup: int
    slack_k: FixedPointV1
    threshold_h: FixedPointV1

    def __post_init__(self) -> None:
        require_contract_id(self.detector_id, field="detector_id")
        if self.reference is not None:
            require_fixed_point(self.reference, field="reference")
            if self.warmup != 0:
                raise ContractValueError("a fixed reference forbids a warmup estimate")
        else:
            require_strict_int(self.warmup, field="warmup", minimum=2, maximum=MAX_WARMUP)
        require_fixed_point(self.slack_k, field="slack_k")
        if self.slack_k.mantissa < 0:
            raise ContractValueError("slack_k cannot be negative")
        require_fixed_point(self.threshold_h, field="threshold_h")
        if self.threshold_h.mantissa < 1:
            raise ContractValueError("threshold_h must be strictly positive")

    def as_mapping(self) -> dict[str, object]:
        return {
            "detectorId": self.detector_id,
            "reference": None if self.reference is None else self.reference.as_mapping(),
            "slackK": self.slack_k.as_mapping(),
            "thresholdH": self.threshold_h.as_mapping(),
            "warmup": self.warmup,
        }


@dataclass(frozen=True, slots=True)
class CusumStepV1:
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


class TwoSidedCusum:
    """Streaming two-sided CUSUM with visible warmup, suppression and reset law.

    An alarm restarts monitoring: both cumulative statistics clear and a
    warmup-estimated reference is re-estimated from post-alarm data, so a
    persistent level shift raises one alarm, not an alarm every bar. A fixed
    reference is the caller's absolute target and survives alarms. A gap-class
    input resets the whole detector.
    """

    __slots__ = (
        "__config",
        "__guard",
        "__reference",
        "__s_down",
        "__s_up",
        "__warmup_count",
        "__warmup_sum",
    )

    def __init__(self, config: CusumConfigV1) -> None:
        if not isinstance(config, CusumConfigV1):
            raise ContractValueError("config must be CusumConfigV1")
        self.__config = config
        self.__guard = OrdinalGuard()
        self.__reference = None if config.reference is None else config.reference.mantissa
        self.__warmup_sum = 0
        self.__warmup_count = 0
        self.__s_up = 0
        self.__s_down = 0

    @property
    def config(self) -> CusumConfigV1:
        return self.__config

    def __step(
        self,
        observation: ObservationV1,
        *,
        status: StepStatus,
        alarm: bool = False,
        direction: AlarmDirection | None = None,
    ) -> CusumStepV1:
        return CusumStepV1(
            detector_id=self.__config.detector_id,
            ordinal=observation.ordinal,
            event_time_ns=observation.event_time_ns,
            status=status,
            statistic_up=FixedPointV1(self.__s_up),
            statistic_down=FixedPointV1(self.__s_down),
            alarm=alarm,
            direction=direction,
        )

    def __reset(self) -> None:
        self.__s_up = 0
        self.__s_down = 0
        self.__warmup_sum = 0
        self.__warmup_count = 0
        if self.__config.reference is None:
            self.__reference = None

    def update(self, observation: ObservationV1) -> CusumStepV1:
        if not isinstance(observation, ObservationV1):
            raise ContractValueError("observation must be ObservationV1")
        self.__guard.check(observation.ordinal, observation.event_time_ns)
        disposition = observation.disposition
        if disposition is InputDisposition.SUPPRESS:
            return self.__step(observation, status=StepStatus.SUPPRESSED)
        if disposition is InputDisposition.RESET:
            self.__reset()
            return self.__step(observation, status=StepStatus.RESET)
        if self.__reference is None:
            self.__warmup_sum += observation.value.mantissa
            self.__warmup_count += 1
            if self.__warmup_count == self.__config.warmup:
                self.__reference = round_half_even(self.__warmup_sum, self.__warmup_count)
            return self.__step(observation, status=StepStatus.WARMUP)
        deviation = observation.value.mantissa - self.__reference
        slack = self.__config.slack_k.mantissa
        self.__s_up = min(
            MAX_FIXED_MANTISSA,
            max(0, self.__s_up + deviation - slack),
        )
        self.__s_down = min(
            MAX_FIXED_MANTISSA,
            max(0, self.__s_down - deviation - slack),
        )
        threshold = self.__config.threshold_h.mantissa
        alarm_up = self.__s_up >= threshold
        alarm_down = self.__s_down >= threshold
        if not (alarm_up or alarm_down):
            return self.__step(observation, status=StepStatus.OK)
        # Both sides crossing at once is impossible: the pre-step statistics sum
        # to less than twice the threshold and one side always shrinks.
        direction = AlarmDirection.UP if alarm_up else AlarmDirection.DOWN
        step = self.__step(observation, status=StepStatus.OK, alarm=True, direction=direction)
        self.__reset()
        return step
