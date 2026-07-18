"""Bounded passive-fill queue and survival challenger (L-065).

The owner consumes caller-supplied, versioned observations. It never observes a
book, places an order, or reads ambient state. Integer queue-ahead facts are
used only to form conservative position strata and an observed queue-progress
ratio. Fill hazards and survival are empirical integer ratios over a declared
time grid. Missing or unstable evidence publishes no probabilities.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, replace
from enum import StrEnum
from fractions import Fraction
from typing import Final

from quant_edge.canonical import canonical_json_bytes
from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import FixedPointV1
from quant_edge.labels.rational import ExactRatioV1
from quant_edge.lake.contracts import (
    DigestV1,
    EvidencePosture,
    QualityState,
    require_contract_id,
    require_strict_int,
)
from quant_edge.primitives import require_utc_millis
from quant_edge.survival.contracts import (
    MAX_DURATION_NS,
    MAX_SUBJECTS,
    CauseSetV1,
    SubjectStatus,
    SubjectV1,
    SurvivalCohortV1,
    SurvivalTarget,
    TimeGridV1,
    fraction_to_fixed_point,
)
from quant_edge.survival.hazard_model import (
    HazardModelConfigV1,
    PredictionStatus,
    fit_discrete_hazard,
)

MAX_QUEUE_UNITS: Final = 10**15
MAX_SOURCE_REVISIONS: Final = 32
MISSING_PASSIVE_FILL_CALIBRATION_ATTESTATION: Final = (
    "CANONICAL_RECORDED_OUTCOME_CHRONOLOGICAL_CALIBRATION_ATTESTATION_MISSING"
)


class PassiveFillOutcome(StrEnum):
    FILLED = "FILLED"
    RIGHT_CENSORED = "RIGHT_CENSORED"
    INVALIDATED = "INVALIDATED"


class QueuePosition(StrEnum):
    NEAR = "NEAR"
    MIDDLE = "MIDDLE"
    DEEP = "DEEP"


class PassiveFillFitStatus(StrEnum):
    RESEARCH_CHALLENGER_READY = "RESEARCH_CHALLENGER_READY"
    DATA_INSUFFICIENT = "DATA_INSUFFICIENT"
    SYNTHETIC_ONLY = "SYNTHETIC_ONLY"
    UNSTABLE_FIT = "UNSTABLE_FIT"


class PassiveFillStratumStatus(StrEnum):
    CALIBRATED = "CALIBRATED"
    POOLED_FALLBACK = "POOLED_FALLBACK"
    UNAVAILABLE = "UNAVAILABLE"


@dataclass(frozen=True, slots=True)
class PassiveFillObservationV1:
    observation_id: str
    event_id: str
    source_revision: str
    queue_model_revision: str
    duration_ns: int
    queue_ahead_units: int
    queue_total_units: int
    executed_ahead_units: int
    cancelled_ahead_units: int
    observed_at_ms: int
    outcome: PassiveFillOutcome
    posture: EvidencePosture
    quality: QualityState

    def __post_init__(self) -> None:
        for field_name in (
            "observation_id",
            "event_id",
            "source_revision",
            "queue_model_revision",
        ):
            require_contract_id(getattr(self, field_name), field=field_name)
        require_strict_int(
            self.duration_ns, field="duration_ns", minimum=1, maximum=MAX_DURATION_NS
        )
        require_strict_int(
            self.queue_ahead_units,
            field="queue_ahead_units",
            minimum=0,
            maximum=MAX_QUEUE_UNITS,
        )
        require_strict_int(
            self.queue_total_units,
            field="queue_total_units",
            minimum=1,
            maximum=MAX_QUEUE_UNITS,
        )
        if self.queue_ahead_units > self.queue_total_units:
            raise ContractValueError("queue_ahead_units cannot exceed queue_total_units")
        for field_name in ("executed_ahead_units", "cancelled_ahead_units"):
            require_strict_int(
                getattr(self, field_name),
                field=field_name,
                minimum=0,
                maximum=MAX_QUEUE_UNITS,
            )
        require_utc_millis(self.observed_at_ms, field="observed_at_ms")
        if not isinstance(self.outcome, PassiveFillOutcome):
            raise ContractValueError("outcome must be PassiveFillOutcome")
        if self.posture not in (EvidencePosture.REPLAY, EvidencePosture.SYNTHETIC):
            raise ContractValueError("passive-fill observations must be REPLAY or SYNTHETIC")
        if self.quality not in (QualityState.COMPLETE, QualityState.SYNTHETIC):
            raise ContractValueError("passive-fill observations must be COMPLETE or SYNTHETIC")
        if self.posture is EvidencePosture.REPLAY and self.quality is not QualityState.COMPLETE:
            raise ContractValueError("REPLAY observations require COMPLETE quality")
        if self.posture is EvidencePosture.SYNTHETIC and self.quality is not QualityState.SYNTHETIC:
            raise ContractValueError("SYNTHETIC observations require SYNTHETIC quality")

    @property
    def queue_position(self) -> QueuePosition:
        scaled = self.queue_ahead_units * 3
        if scaled <= self.queue_total_units:
            return QueuePosition.NEAR
        if scaled <= self.queue_total_units * 2:
            return QueuePosition.MIDDLE
        return QueuePosition.DEEP

    @property
    def conservative_queue_progress(self) -> Fraction:
        # Cancellation has no credit: without order-level lineage a cancellation
        # may have occurred behind us. Executions are capped at queue ahead.
        return Fraction(
            min(self.executed_ahead_units, self.queue_ahead_units), self.queue_total_units
        )

    def as_mapping(self) -> dict[str, object]:
        return {
            "cancelledAheadUnits": str(self.cancelled_ahead_units),
            "durationNs": str(self.duration_ns),
            "eventId": self.event_id,
            "executedAheadUnits": str(self.executed_ahead_units),
            "observationId": self.observation_id,
            "observedAtMs": str(self.observed_at_ms),
            "outcome": self.outcome.value,
            "posture": self.posture.value,
            "quality": self.quality.value,
            "queueAheadUnits": str(self.queue_ahead_units),
            "queueModelRevision": self.queue_model_revision,
            "queuePosition": self.queue_position.value,
            "queueTotalUnits": str(self.queue_total_units),
            "sourceRevision": self.source_revision,
        }


@dataclass(frozen=True, slots=True)
class PassiveFillFitConfigV1:
    model_revision: str
    grid: TimeGridV1
    minimum_observations: int
    minimum_fills: int
    maximum_censor_fraction_micros: int
    maximum_source_revisions: int = MAX_SOURCE_REVISIONS
    minimum_stratum_observations: int = 2
    minimum_stratum_fills: int = 1
    minimum_stratum_nonfills: int = 1

    def __post_init__(self) -> None:
        require_contract_id(self.model_revision, field="model_revision")
        if not isinstance(self.grid, TimeGridV1):
            raise ContractValueError("grid must be TimeGridV1")
        require_strict_int(
            self.minimum_observations,
            field="minimum_observations",
            minimum=1,
            maximum=MAX_SUBJECTS,
        )
        require_strict_int(
            self.minimum_fills,
            field="minimum_fills",
            minimum=1,
            maximum=MAX_SUBJECTS,
        )
        if self.minimum_fills > self.minimum_observations:
            raise ContractValueError("minimum_fills cannot exceed minimum_observations")
        require_strict_int(
            self.maximum_censor_fraction_micros,
            field="maximum_censor_fraction_micros",
            minimum=0,
            maximum=1_000_000,
        )
        require_strict_int(
            self.maximum_source_revisions,
            field="maximum_source_revisions",
            minimum=1,
            maximum=MAX_SOURCE_REVISIONS,
        )
        require_strict_int(
            self.minimum_stratum_observations,
            field="minimum_stratum_observations",
            minimum=2,
            maximum=MAX_SUBJECTS,
        )
        require_strict_int(
            self.minimum_stratum_fills,
            field="minimum_stratum_fills",
            minimum=1,
            maximum=MAX_SUBJECTS,
        )
        require_strict_int(
            self.minimum_stratum_nonfills,
            field="minimum_stratum_nonfills",
            minimum=1,
            maximum=MAX_SUBJECTS,
        )
        if self.minimum_stratum_fills + self.minimum_stratum_nonfills > (
            self.minimum_stratum_observations
        ):
            raise ContractValueError(
                "stratum fill and non-fill minima cannot exceed stratum observations"
            )

    def as_mapping(self) -> dict[str, object]:
        return {
            "grid": self.grid.as_mapping(),
            "maximumCensorFractionMicros": self.maximum_censor_fraction_micros,
            "maximumSourceRevisions": self.maximum_source_revisions,
            "minimumFills": self.minimum_fills,
            "minimumObservations": self.minimum_observations,
            "minimumStratumFills": self.minimum_stratum_fills,
            "minimumStratumNonfills": self.minimum_stratum_nonfills,
            "minimumStratumObservations": self.minimum_stratum_observations,
            "modelRevision": self.model_revision,
        }


@dataclass(frozen=True, slots=True)
class PassiveFillBinV1:
    bin_index: int
    end_ns: int
    at_risk: int
    fills: int
    invalidations: int
    censored: int
    status: PredictionStatus
    fill_hazard: FixedPointV1 | None
    survival: FixedPointV1 | None
    fill_cumulative_incidence: FixedPointV1 | None
    invalidation_cumulative_incidence: FixedPointV1 | None
    mean_conservative_queue_progress: FixedPointV1 | None

    def as_mapping(self) -> dict[str, object]:
        return {
            "atRisk": self.at_risk,
            "binIndex": self.bin_index,
            "censored": self.censored,
            "endNs": str(self.end_ns),
            "fillCumulativeIncidence": None
            if self.fill_cumulative_incidence is None
            else self.fill_cumulative_incidence.as_mapping(),
            "fillHazard": None if self.fill_hazard is None else self.fill_hazard.as_mapping(),
            "fills": self.fills,
            "invalidations": self.invalidations,
            "invalidationCumulativeIncidence": None
            if self.invalidation_cumulative_incidence is None
            else self.invalidation_cumulative_incidence.as_mapping(),
            "meanConservativeQueueProgress": None
            if self.mean_conservative_queue_progress is None
            else self.mean_conservative_queue_progress.as_mapping(),
            "status": self.status.value,
            "survival": None if self.survival is None else self.survival.as_mapping(),
        }


@dataclass(frozen=True, slots=True)
class PassiveFillStratumV1:
    queue_position: QueuePosition
    observations: int
    fit_observations: int
    status: PassiveFillStratumStatus
    reason_codes: tuple[str, ...]
    bins: tuple[PassiveFillBinV1, ...]

    def as_mapping(self) -> dict[str, object]:
        return {
            "bins": [item.as_mapping() for item in self.bins],
            "fitObservations": self.fit_observations,
            "observations": self.observations,
            "queuePosition": self.queue_position.value,
            "reasonCodes": list(self.reason_codes),
            "status": self.status.value,
        }


@dataclass(frozen=True, slots=True)
class PassiveFillChallengerV1:
    config: PassiveFillFitConfigV1
    status: PassiveFillFitStatus
    observations: int
    fills: int
    source_revisions: tuple[str, ...]
    queue_model_revisions: tuple[str, ...]
    training_event_ids: tuple[str, ...]
    training_observation_sha256: DigestV1
    training_started_at_ms: int | None
    training_ended_at_ms: int | None
    reason_codes: tuple[str, ...]
    promotion_blockers: tuple[str, ...]
    strata: tuple[PassiveFillStratumV1, ...] | None

    @property
    def is_promotable(self) -> bool:
        # Promotion is intentionally not an in-memory fit property. Rank L-068's
        # durable recorded-outcome owner is the only authority that can attest a
        # chronological held-out calibration. Caller-created counts, revisions,
        # or even a copied challenger object therefore never promote this value.
        return False

    @property
    def is_research_ready(self) -> bool:
        return self.status is PassiveFillFitStatus.RESEARCH_CHALLENGER_READY

    def as_mapping(self) -> dict[str, object]:
        return {
            "config": self.config.as_mapping(),
            "fills": self.fills,
            "observations": self.observations,
            "promotionBlockers": list(self.promotion_blockers),
            "queueModelRevisions": list(self.queue_model_revisions),
            "reasonCodes": list(self.reason_codes),
            "schema": "Q11PassiveFillChallengerV1",
            "sourceRevisions": list(self.source_revisions),
            "status": self.status.value,
            "strata": None if self.strata is None else [item.as_mapping() for item in self.strata],
            "trainingEventIds": list(self.training_event_ids),
            "trainingEndedAtMs": None
            if self.training_ended_at_ms is None
            else str(self.training_ended_at_ms),
            "trainingObservationSha256": self.training_observation_sha256.hexdigest,
            "trainingStartedAtMs": None
            if self.training_started_at_ms is None
            else str(self.training_started_at_ms),
            "version": 1,
        }

    @property
    def content_digest(self) -> DigestV1:
        return DigestV1(hashlib.sha256(canonical_json_bytes(self.as_mapping())).hexdigest())


_PASSIVE_FILL_CAUSES: Final = CauseSetV1(("passive.fill", "passive.invalidation"))


def _stratum_reasons(
    observations: tuple[PassiveFillObservationV1, ...], config: PassiveFillFitConfigV1
) -> tuple[str, ...]:
    fills = sum(item.outcome is PassiveFillOutcome.FILLED for item in observations)
    nonfills = len(observations) - fills
    reasons: list[str] = []
    if len(observations) < config.minimum_stratum_observations:
        reasons.append("STRATUM_OBSERVATION_COUNT_BELOW_MINIMUM")
    if fills < config.minimum_stratum_fills:
        reasons.append("STRATUM_FILL_COUNT_BELOW_MINIMUM")
    if nonfills < config.minimum_stratum_nonfills:
        reasons.append("STRATUM_NONFILL_COUNT_BELOW_MINIMUM")
    return tuple(reasons)


def _as_subject(observation: PassiveFillObservationV1, *, stratum_id: str) -> SubjectV1:
    cause_id = {
        PassiveFillOutcome.FILLED: "passive.fill",
        PassiveFillOutcome.INVALIDATED: "passive.invalidation",
        PassiveFillOutcome.RIGHT_CENSORED: None,
    }[observation.outcome]
    return SubjectV1(
        subject_id=observation.observation_id,
        group_id=observation.source_revision,
        stratum_id=stratum_id,
        duration_ns=observation.duration_ns,
        status=SubjectStatus.RIGHT_CENSORED if cause_id is None else SubjectStatus.EVENT,
        cause_id=cause_id,
        quality=observation.quality,
    )


def _fit_stratum(
    all_observations: tuple[PassiveFillObservationV1, ...],
    position: QueuePosition,
    config: PassiveFillFitConfigV1,
) -> PassiveFillStratumV1:
    selected = tuple(item for item in all_observations if item.queue_position is position)
    selected_reasons = _stratum_reasons(selected, config)
    pooled_reasons = _stratum_reasons(all_observations, config)
    if not selected_reasons:
        status = PassiveFillStratumStatus.CALIBRATED
        fit_rows = selected
        stratum_id = position.value
        reasons: tuple[str, ...] = ()
    elif not pooled_reasons:
        status = PassiveFillStratumStatus.POOLED_FALLBACK
        fit_rows = all_observations
        stratum_id = "POOLED"
        reasons = (*selected_reasons, "POOLED_FALLBACK_USED")
    else:
        status = PassiveFillStratumStatus.UNAVAILABLE
        fit_rows = selected
        stratum_id = position.value
        reasons = selected_reasons

    cohort = SurvivalCohortV1(
        cohort_id=f"{config.model_revision}.{position.value.lower()}",
        target=SurvivalTarget.ACTIONABILITY_WINDOW,
        causes=_PASSIVE_FILL_CAUSES,
        posture=EvidencePosture.REPLAY
        if all(item.posture is EvidencePosture.REPLAY for item in fit_rows)
        else EvidencePosture.SYNTHETIC,
        subjects=tuple(_as_subject(item, stratum_id=stratum_id) for item in fit_rows),
    )
    hazard_config = HazardModelConfigV1(
        model_version=config.model_revision,
        grid=config.grid,
        causes=_PASSIVE_FILL_CAUSES,
        smoothing=ExactRatioV1(0, 1),
        min_risk_set=config.minimum_stratum_observations,
    )
    model = fit_discrete_hazard(cohort, hazard_config)
    table = model.stratum(stratum_id)
    prediction = model.predict(stratum_id)
    if table is None or prediction is None:  # pragma: no cover - owner invariant
        raise ContractValueError("passive-fill hazard owner omitted the fitted stratum")
    bins: list[PassiveFillBinV1] = []
    for table_bin, predicted in zip(table.bins, prediction.bins, strict=True):
        start_ns = 0 if table_bin.bin_index == 0 else config.grid.times_ns[table_bin.bin_index - 1]
        at_risk_rows = tuple(item for item in fit_rows if item.duration_ns > start_ns)
        known = (
            predicted.status is PredictionStatus.KNOWN
            and status is not PassiveFillStratumStatus.UNAVAILABLE
        )
        mean_progress = None
        if known:
            mean_progress = fraction_to_fixed_point(
                sum((item.conservative_queue_progress for item in at_risk_rows), start=Fraction(0))
                / len(at_risk_rows)
            )
        bins.append(
            PassiveFillBinV1(
                bin_index=table_bin.bin_index,
                end_ns=table_bin.end_ns,
                at_risk=table_bin.at_risk,
                fills=table_bin.events[0],
                invalidations=table_bin.events[1],
                censored=table_bin.censored,
                status=PredictionStatus.KNOWN if known else PredictionStatus.UNKNOWN,
                fill_hazard=predicted.hazards[0] if known and predicted.hazards else None,
                survival=predicted.survival if known else None,
                fill_cumulative_incidence=predicted.incidence[0]
                if known and predicted.incidence
                else None,
                invalidation_cumulative_incidence=predicted.incidence[1]
                if known and predicted.incidence
                else None,
                mean_conservative_queue_progress=mean_progress,
            )
        )
    return PassiveFillStratumV1(
        queue_position=position,
        observations=len(selected),
        fit_observations=len(fit_rows),
        status=status,
        reason_codes=reasons,
        bins=tuple(bins),
    )


def fit_passive_fill_challenger(
    observations: tuple[PassiveFillObservationV1, ...],
    config: PassiveFillFitConfigV1,
) -> PassiveFillChallengerV1:
    if not isinstance(observations, tuple) or len(observations) > MAX_SUBJECTS:
        raise ContractValueError(f"observations must be a tuple bounded to {MAX_SUBJECTS}")
    if not isinstance(config, PassiveFillFitConfigV1):
        raise ContractValueError("config must be PassiveFillFitConfigV1")
    if any(not isinstance(item, PassiveFillObservationV1) for item in observations):
        raise ContractValueError("observations must contain PassiveFillObservationV1")
    ids = [item.observation_id for item in observations]
    if len(ids) != len(set(ids)):
        raise ContractValueError("observation IDs must be unique")
    event_ids = [item.event_id for item in observations]
    if len(event_ids) != len(set(event_ids)):
        raise ContractValueError("underlying event IDs must be unique")
    canonical_observations = tuple(sorted(observations, key=lambda item: item.observation_id))
    training_observation_sha256 = DigestV1(
        hashlib.sha256(
            canonical_json_bytes([item.as_mapping() for item in canonical_observations])
        ).hexdigest()
    )
    revisions = tuple(sorted({item.source_revision for item in observations}))
    queue_revisions = tuple(sorted({item.queue_model_revision for item in observations}))
    fills = sum(item.outcome is PassiveFillOutcome.FILLED for item in observations)
    censored = sum(item.outcome is PassiveFillOutcome.RIGHT_CENSORED for item in observations)
    reasons: set[str] = set()
    if len(observations) < config.minimum_observations:
        reasons.add("OBSERVATION_COUNT_BELOW_MINIMUM")
    if fills < config.minimum_fills:
        reasons.add("FILL_COUNT_BELOW_MINIMUM")
    if not observations:
        reasons.add("RECORDED_EVIDENCE_ABSENT")
    if len(revisions) > config.maximum_source_revisions:
        reasons.add("SOURCE_REVISION_FRAGMENTED")
    if len(queue_revisions) > 1:
        reasons.add("QUEUE_MODEL_REVISION_MIXED")
    if observations and censored * 1_000_000 > (
        len(observations) * config.maximum_censor_fraction_micros
    ):
        reasons.add("CENSORING_EXCEEDS_BUDGET")

    strata = (
        tuple(
            _fit_stratum(observations, position, config)
            for position in QueuePosition
            if any(item.queue_position is position for item in observations)
        )
        if observations
        else None
    )
    if strata is not None and any(
        item.status is not PassiveFillStratumStatus.CALIBRATED for item in strata
    ):
        reasons.add("STRATUM_CALIBRATION_BELOW_MINIMUM")

    data_reasons = {
        "FILL_COUNT_BELOW_MINIMUM",
        "OBSERVATION_COUNT_BELOW_MINIMUM",
        "RECORDED_EVIDENCE_ABSENT",
        "STRATUM_CALIBRATION_BELOW_MINIMUM",
    }
    if reasons & data_reasons:
        status = PassiveFillFitStatus.DATA_INSUFFICIENT
    elif reasons & {
        "CENSORING_EXCEEDS_BUDGET",
        "QUEUE_MODEL_REVISION_MIXED",
        "SOURCE_REVISION_FRAGMENTED",
    }:
        status = PassiveFillFitStatus.UNSTABLE_FIT
    elif any(item.posture is not EvidencePosture.REPLAY for item in observations):
        status = PassiveFillFitStatus.SYNTHETIC_ONLY
        reasons.add("RECORDED_REPLAY_REQUIRED_FOR_PROMOTION")
    else:
        status = PassiveFillFitStatus.RESEARCH_CHALLENGER_READY
    if (
        status
        in (
            PassiveFillFitStatus.DATA_INSUFFICIENT,
            PassiveFillFitStatus.UNSTABLE_FIT,
        )
        and strata is not None
    ):
        strata = tuple(
            replace(
                stratum,
                bins=tuple(
                    replace(
                        item,
                        status=PredictionStatus.UNKNOWN,
                        fill_hazard=None,
                        survival=None,
                        fill_cumulative_incidence=None,
                        invalidation_cumulative_incidence=None,
                        mean_conservative_queue_progress=None,
                    )
                    for item in stratum.bins
                ),
            )
            for stratum in strata
        )
    return PassiveFillChallengerV1(
        config=config,
        status=status,
        observations=len(observations),
        fills=fills,
        source_revisions=revisions,
        queue_model_revisions=queue_revisions,
        training_event_ids=tuple(sorted(event_ids)),
        training_observation_sha256=training_observation_sha256,
        training_started_at_ms=min((item.observed_at_ms for item in observations), default=None),
        training_ended_at_ms=max((item.observed_at_ms for item in observations), default=None),
        reason_codes=tuple(sorted(reasons)),
        promotion_blockers=(MISSING_PASSIVE_FILL_CALIBRATION_ATTESTATION,),
        strata=strata,
    )
