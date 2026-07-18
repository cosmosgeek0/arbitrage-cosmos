from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Final, cast

from quant_edge.errors import ContractValueError
from quant_edge.features.baselines import RollingMedianMad
from quant_edge.features.fixedpoint import FixedPointV1, fp_div, fp_sub
from quant_edge.lake.contracts import QualityState, require_contract_id, require_strict_int
from quant_edge.regime.contracts import (
    InputDisposition,
    ObservationV1,
    OrdinalGuard,
    StepStatus,
    disposition_from_quality,
    require_fixed_point,
)

MAX_ANOMALY_WINDOW: Final = 4_096

SCORE_SEMANTICS: Final = "UNCALIBRATED_SCORE"


class AnomalyReason(StrEnum):
    THRESHOLD_EXCEEDED = "THRESHOLD_EXCEEDED"
    ZERO_MAD_DEVIATION = "ZERO_MAD_DEVIATION"


@dataclass(frozen=True, slots=True)
class RobustAnomalyConfigV1:
    """Rolling median/MAD anomaly baseline; scores are explicitly uncalibrated."""

    scorer_id: str
    window: int
    z_threshold: FixedPointV1

    def __post_init__(self) -> None:
        require_contract_id(self.scorer_id, field="scorer_id")
        require_strict_int(self.window, field="window", minimum=2, maximum=MAX_ANOMALY_WINDOW)
        require_fixed_point(self.z_threshold, field="z_threshold")
        if self.z_threshold.mantissa < 1:
            raise ContractValueError("z_threshold must be strictly positive")

    def as_mapping(self) -> dict[str, object]:
        return {
            "scoreSemantics": SCORE_SEMANTICS,
            "scorerId": self.scorer_id,
            "window": self.window,
            "zThreshold": self.z_threshold.as_mapping(),
        }


@dataclass(frozen=True, slots=True)
class AnomalyStepV1:
    scorer_id: str
    ordinal: int
    event_time_ns: int
    status: StepStatus
    score: FixedPointV1 | None
    exceeds: bool
    persistence: int
    reasons: tuple[AnomalyReason, ...]

    def __post_init__(self) -> None:
        require_contract_id(self.scorer_id, field="scorer_id")
        require_strict_int(self.ordinal, field="ordinal", minimum=0)
        require_strict_int(self.event_time_ns, field="event_time_ns", minimum=0)
        if not isinstance(self.status, StepStatus):
            raise ContractValueError("status must be StepStatus")
        if self.score is not None:
            require_fixed_point(self.score, field="score")
        if not isinstance(self.exceeds, bool):
            raise ContractValueError("exceeds must be boolean")
        if self.exceeds and self.status is not StepStatus.OK:
            raise ContractValueError("only an OK step may exceed the threshold")
        require_strict_int(self.persistence, field="persistence", minimum=0)
        # A suppressed step echoes the frozen persistence; an OK step must agree
        # with it exactly.
        if self.status is StepStatus.OK and self.exceeds != (self.persistence > 0):
            raise ContractValueError("persistence counts consecutive exceeding steps")
        if not isinstance(self.reasons, tuple):
            raise ContractValueError("reasons must be a tuple")
        for reason in self.reasons:
            if not isinstance(reason, AnomalyReason):
                raise ContractValueError("reasons must contain AnomalyReason")
        if self.exceeds != bool(self.reasons):
            raise ContractValueError("reasons exist exactly when the step exceeds")

    def as_mapping(self) -> dict[str, object]:
        return {
            "eventTimeNs": str(self.event_time_ns),
            "exceeds": self.exceeds,
            "ordinal": self.ordinal,
            "persistence": self.persistence,
            "reasons": [reason.value for reason in self.reasons],
            "score": None if self.score is None else self.score.as_mapping(),
            "scoreSemantics": SCORE_SEMANTICS,
            "scorerId": self.scorer_id,
            "status": self.status.value,
        }


class RobustAnomalyScorer:
    """Point-in-time MAD-unit scorer: classify against the prior window, then learn.

    A zero-MAD baseline with a non-zero deviation is an unbounded surprise: the
    step exceeds with an explicit reason and no finite score, never a fabricated
    number.
    """

    __slots__ = ("__baseline", "__config", "__guard", "__persistence")

    def __init__(self, config: RobustAnomalyConfigV1) -> None:
        if not isinstance(config, RobustAnomalyConfigV1):
            raise ContractValueError("config must be RobustAnomalyConfigV1")
        self.__config = config
        self.__guard = OrdinalGuard()
        self.__baseline = RollingMedianMad(config.window)
        self.__persistence = 0

    @property
    def config(self) -> RobustAnomalyConfigV1:
        return self.__config

    def __step(
        self,
        observation: ObservationV1,
        *,
        status: StepStatus,
        score: FixedPointV1 | None = None,
        exceeds: bool = False,
        reasons: tuple[AnomalyReason, ...] = (),
    ) -> AnomalyStepV1:
        return AnomalyStepV1(
            scorer_id=self.__config.scorer_id,
            ordinal=observation.ordinal,
            event_time_ns=observation.event_time_ns,
            status=status,
            score=score,
            exceeds=exceeds,
            persistence=self.__persistence,
            reasons=reasons,
        )

    def __reset(self) -> None:
        self.__baseline = RollingMedianMad(self.__config.window)
        self.__persistence = 0

    def update(self, observation: ObservationV1) -> AnomalyStepV1:
        if not isinstance(observation, ObservationV1):
            raise ContractValueError("observation must be ObservationV1")
        self.__guard.check(observation.ordinal, observation.event_time_ns)
        disposition = observation.disposition
        if disposition is InputDisposition.SUPPRESS:
            return self.__step(observation, status=StepStatus.SUPPRESSED)
        if disposition is InputDisposition.RESET:
            self.__reset()
            return self.__step(observation, status=StepStatus.RESET)
        if self.__baseline.count < self.__config.window:
            self.__baseline.push(observation.value)
            return self.__step(observation, status=StepStatus.WARMUP)
        median = cast(FixedPointV1, self.__baseline.median())
        mad = cast(FixedPointV1, self.__baseline.mad())
        self.__baseline.push(observation.value)
        deviation = fp_sub(observation.value, median)
        if mad.is_zero:
            if deviation.is_zero:
                self.__persistence = 0
                return self.__step(observation, status=StepStatus.OK, score=FixedPointV1(0))
            self.__persistence += 1
            return self.__step(
                observation,
                status=StepStatus.OK,
                score=None,
                exceeds=True,
                reasons=(AnomalyReason.ZERO_MAD_DEVIATION,),
            )
        score = fp_div(deviation, mad)
        if abs(score.mantissa) >= self.__config.z_threshold.mantissa:
            self.__persistence += 1
            return self.__step(
                observation,
                status=StepStatus.OK,
                score=score,
                exceeds=True,
                reasons=(AnomalyReason.THRESHOLD_EXCEEDED,),
            )
        self.__persistence = 0
        return self.__step(observation, status=StepStatus.OK, score=score)


class DisorderState(StrEnum):
    NORMAL = "NORMAL"
    WATCH = "WATCH"
    DISORDERED = "DISORDERED"
    OOD_SUSPECT = "OOD_SUSPECT"
    UNKNOWN = "UNKNOWN"


class DisorderReason(StrEnum):
    INPUT_QUALITY = "INPUT_QUALITY"
    RECENT_CHANGEPOINT = "RECENT_CHANGEPOINT"
    ANOMALY_PERSISTENCE_WATCH = "ANOMALY_PERSISTENCE_WATCH"
    ANOMALY_PERSISTENCE_OOD = "ANOMALY_PERSISTENCE_OOD"
    REGIME_UNCERTAIN = "REGIME_UNCERTAIN"
    REGIME_STATE_UNAVAILABLE = "REGIME_STATE_UNAVAILABLE"


_SEVERITY: Final[dict[DisorderState, int]] = {
    DisorderState.NORMAL: 0,
    DisorderState.WATCH: 1,
    DisorderState.DISORDERED: 2,
    DisorderState.OOD_SUSPECT: 3,
}


@dataclass(frozen=True, slots=True)
class DisorderConfigV1:
    """Fusion thresholds turning detector evidence into one disorder/OOD state."""

    fusion_id: str
    alarm_recency_bars: int
    persistence_watch: int
    persistence_ood: int
    uncertainty_threshold: FixedPointV1

    def __post_init__(self) -> None:
        require_contract_id(self.fusion_id, field="fusion_id")
        require_strict_int(self.alarm_recency_bars, field="alarm_recency_bars", minimum=1)
        watch = require_strict_int(self.persistence_watch, field="persistence_watch", minimum=1)
        require_strict_int(self.persistence_ood, field="persistence_ood", minimum=watch)
        require_fixed_point(self.uncertainty_threshold, field="uncertainty_threshold")
        if self.uncertainty_threshold.mantissa < 1:
            raise ContractValueError("uncertainty_threshold must be strictly positive")

    def as_mapping(self) -> dict[str, object]:
        return {
            "alarmRecencyBars": self.alarm_recency_bars,
            "fusionId": self.fusion_id,
            "persistenceOod": self.persistence_ood,
            "persistenceWatch": self.persistence_watch,
            "uncertaintyThreshold": self.uncertainty_threshold.as_mapping(),
        }


@dataclass(frozen=True, slots=True)
class DisorderAssessmentV1:
    fusion_id: str
    state: DisorderState
    reasons: tuple[DisorderReason, ...]

    def __post_init__(self) -> None:
        require_contract_id(self.fusion_id, field="fusion_id")
        if not isinstance(self.state, DisorderState):
            raise ContractValueError("state must be DisorderState")
        if not isinstance(self.reasons, tuple):
            raise ContractValueError("reasons must be a tuple")
        for reason in self.reasons:
            if not isinstance(reason, DisorderReason):
                raise ContractValueError("reasons must contain DisorderReason")
        if tuple(sorted(reason.value for reason in self.reasons)) != tuple(
            reason.value for reason in self.reasons
        ):
            raise ContractValueError("reasons must be sorted")

    def as_mapping(self) -> dict[str, object]:
        return {
            "fusionId": self.fusion_id,
            "reasons": [reason.value for reason in self.reasons],
            "state": self.state.value,
        }


def fuse_disorder(
    *,
    config: DisorderConfigV1,
    input_quality: QualityState,
    last_alarm_age: int | None,
    anomaly_persistence: int,
    regime_uncertainty: FixedPointV1 | None,
) -> DisorderAssessmentV1:
    """Worst-of fusion; ineligible input yields UNKNOWN, never fabricated normality."""

    if not isinstance(config, DisorderConfigV1):
        raise ContractValueError("config must be DisorderConfigV1")
    if last_alarm_age is not None:
        require_strict_int(last_alarm_age, field="last_alarm_age", minimum=0)
    require_strict_int(anomaly_persistence, field="anomaly_persistence", minimum=0)
    if regime_uncertainty is not None:
        require_fixed_point(regime_uncertainty, field="regime_uncertainty")
    if disposition_from_quality(input_quality) is not InputDisposition.ELIGIBLE:
        return DisorderAssessmentV1(
            fusion_id=config.fusion_id,
            state=DisorderState.UNKNOWN,
            reasons=(DisorderReason.INPUT_QUALITY,),
        )
    findings: list[tuple[DisorderState, DisorderReason]] = []
    if last_alarm_age is not None and last_alarm_age <= config.alarm_recency_bars:
        findings.append((DisorderState.DISORDERED, DisorderReason.RECENT_CHANGEPOINT))
    if anomaly_persistence >= config.persistence_ood:
        findings.append((DisorderState.OOD_SUSPECT, DisorderReason.ANOMALY_PERSISTENCE_OOD))
    elif anomaly_persistence >= config.persistence_watch:
        findings.append((DisorderState.WATCH, DisorderReason.ANOMALY_PERSISTENCE_WATCH))
    if regime_uncertainty is None:
        findings.append((DisorderState.WATCH, DisorderReason.REGIME_STATE_UNAVAILABLE))
    elif regime_uncertainty.mantissa >= config.uncertainty_threshold.mantissa:
        findings.append((DisorderState.WATCH, DisorderReason.REGIME_UNCERTAIN))
    state = DisorderState.NORMAL
    for candidate, _ in findings:
        if _SEVERITY[candidate] > _SEVERITY[state]:
            state = candidate
    reasons = tuple(sorted((reason for _, reason in findings), key=lambda item: item.value))
    return DisorderAssessmentV1(fusion_id=config.fusion_id, state=state, reasons=reasons)
