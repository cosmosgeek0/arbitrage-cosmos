"""Q15 drift policy adapter over the accepted Q09 Page-Hinkley owner."""

from __future__ import annotations

from quant_edge.errors import ContractValueError
from quant_edge.lake.contracts import DigestV1, QualityState
from quant_edge.regime.contracts import InputDisposition, ObservationSeriesV1, run_series
from quant_edge.regime.page_hinkley import PageHinkleyConfigV1, TwoSidedPageHinkley
from quant_edge.registry_ops.contracts import (
    DriftAlarmV1,
    DriftLayer,
    DriftResponse,
    mapping_digest,
)


def evaluate_page_hinkley_drift(
    *,
    alarm_id: str,
    layer: DriftLayer,
    monitored_model_id: str,
    monitored_model_revision: str,
    monitored_artifact_sha256: DigestV1,
    monitored_generation: int,
    monitored_transition_id: str,
    config: PageHinkleyConfigV1,
    series: ObservationSeriesV1,
) -> DriftAlarmV1:
    """Replay one bounded, quality-aware epoch and return conservative policy evidence.

    Q09 owns the detector.  Q15 only converts its typed steps into an immutable
    registry alarm.  Gap/unknown quality resets and abstains; stale-only evidence
    freezes advisory output; eligible no-drift evidence never relaxes an existing
    abstention automatically.
    """

    if not isinstance(layer, DriftLayer):
        raise ContractValueError("layer must be DriftLayer")
    if not isinstance(monitored_artifact_sha256, DigestV1):
        raise ContractValueError("monitored_artifact_sha256 must be DigestV1")
    if not isinstance(config, PageHinkleyConfigV1):
        raise ContractValueError("config must be PageHinkleyConfigV1")
    if not isinstance(series, ObservationSeriesV1):
        raise ContractValueError("series must be ObservationSeriesV1")

    steps = run_series(TwoSidedPageHinkley(config), series)
    reset_quality = any(point.disposition is InputDisposition.RESET for point in series.points)
    stale_quality = any(point.quality is QualityState.STALE for point in series.points)
    detector_alarm = any(step.alarm for step in steps)
    if reset_quality:
        alarmed = True
        response = DriftResponse.ABSTAIN_UNKNOWN
        reason = "QUALITY_RESET_ABSTAIN"
    elif stale_quality:
        alarmed = True
        response = DriftResponse.FREEZE_ADVISORY
        reason = "STALE_EVIDENCE_FREEZE"
    elif detector_alarm:
        alarmed = True
        response = DriftResponse.ABSTAIN_UNKNOWN
        reason = "PAGE_HINKLEY_DRIFT"
    else:
        alarmed = False
        response = DriftResponse.WARN
        reason = "NO_DRIFT_OBSERVED"

    evidence: dict[str, object] = {
        "config": config.as_mapping(),
        "layer": layer.value,
        "series": series.as_mapping(),
        "steps": [step.as_mapping() for step in steps],
    }
    return DriftAlarmV1(
        alarm_id=alarm_id,
        layer=layer,
        monitored_model_id=monitored_model_id,
        monitored_model_revision=monitored_model_revision,
        monitored_artifact_sha256=monitored_artifact_sha256,
        monitored_generation=monitored_generation,
        monitored_transition_id=monitored_transition_id,
        detector_id=config.detector_id,
        evidence_digest=mapping_digest(evidence),
        response=response,
        reason_code=reason,
        observed_at_ms=series.points[-1].event_time_ns // 1_000_000,
        alarmed=alarmed,
    )
