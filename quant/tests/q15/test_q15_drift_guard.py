from __future__ import annotations

import sqlite3
from dataclasses import replace
from pathlib import Path

import pytest
from q15_fixtures import FIXED_TIME_MS, REPO_ROOT, populated_registry

from quant_edge.canonical import canonical_json_bytes
from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import FIXED_POINT_SCALE, FixedPointV1
from quant_edge.lake.contracts import DigestV1, QualityState
from quant_edge.lake.contracts import EvidencePosture as LakeEvidencePosture
from quant_edge.regime.contracts import ObservationSeriesV1, ObservationV1
from quant_edge.regime.page_hinkley import PageHinkleyConfigV1
from quant_edge.registry_ops.bundle import synthetic_promotion_binding, synthetic_shadow_records
from quant_edge.registry_ops.contracts import (
    DriftAlarmV1,
    DriftLayer,
    DriftResponse,
    ModelLifecycle,
    OutcomeDisposition,
    OutcomeReality,
    ServingPosture,
    ShadowPredictionV1,
    ShadowScoreBatchV1,
    mapping_digest,
)
from quant_edge.registry_ops.drift import evaluate_page_hinkley_drift
from quant_edge.registry_ops.store import (
    RegistryConflictError,
    RegistryIntegrityError,
    ResearchRegistryStore,
)


def _series(
    *,
    drift: bool = True,
    quality: QualityState = QualityState.COMPLETE,
    start_offset_ms: int = 0,
) -> ObservationSeriesV1:
    values = (0, 0, 0, 20 * FIXED_POINT_SCALE) if drift else (0, 0, 0, 0)
    start = (FIXED_TIME_MS + start_offset_ms) * 1_000_000
    return ObservationSeriesV1(
        series_id="q15.drift.series.v1",
        symbol="SYNTHETIC",
        posture=LakeEvidencePosture.SYNTHETIC,
        points=tuple(
            ObservationV1(
                event_time_ns=start + index * 1_000_000,
                ordinal=index,
                value=FixedPointV1(value),
                quality=quality,
            )
            for index, value in enumerate(values)
        ),
    )


def _alarm(
    champion_model_id: str,
    champion_revision: str,
    artifact: DigestV1,
    layer: DriftLayer,
    *,
    generation: int = 1,
    transition_id: str = "q15.bootstrap.v1",
) -> DriftAlarmV1:
    return evaluate_page_hinkley_drift(
        alarm_id=f"q15.drift.{layer.value.lower()}.v1",
        layer=layer,
        monitored_model_id=champion_model_id,
        monitored_model_revision=champion_revision,
        monitored_artifact_sha256=artifact,
        monitored_generation=generation,
        monitored_transition_id=transition_id,
        config=PageHinkleyConfigV1(
            detector_id="q15.page-hinkley.v1",
            delta=FixedPointV1(0),
            threshold_lambda=FixedPointV1(5 * FIXED_POINT_SCALE),
            warmup=2,
        ),
        series=_series(),
    )


@pytest.mark.parametrize("layer", tuple(DriftLayer))
def test_all_eight_drift_layers_emit_typed_alarms(layer: DriftLayer) -> None:
    alarm = _alarm("model.v1", "revision.v1", DigestV1("1" * 64), layer)
    assert alarm.layer is layer
    assert alarm.alarmed
    assert alarm.reason_code == "PAGE_HINKLEY_DRIFT"


def test_drift_demotes_to_abstain_without_self_promoting_challenger(tmp_path: Path) -> None:
    store, bundle, champion = populated_registry(tmp_path)
    batch = ShadowScoreBatchV1(
        batch_id="q15.shadow.drift.v1",
        slot_id=champion.slot_id,
        event_id="event-drift-v1",
        target_id="transition_binary:v1",
        feature_cutoff_ms=FIXED_TIME_MS + 10,
        horizon_ms=1_000,
        champion_generation=champion.generation,
        champion_transition_id=champion.transition_id,
        champion=ShadowPredictionV1(
            champion.model_id,
            champion.model_revision,
            champion.artifact_sha256,
            mapping_digest({"scoreMicros": "100000"}),
            100_000,
        ),
        challengers=(
            ShadowPredictionV1(
                bundle.q10_registration.model_id,
                bundle.q10_registration.model_revision,
                bundle.q10_registration.artifact.sha256,
                mapping_digest({"scoreMicros": "990000"}),
                990_000,
            ),
        ),
        disposition=OutcomeDisposition.QUIET_CONTROL,
        reality=OutcomeReality.REPLAY,
    )
    store.record_shadow_batch(batch)
    alarm = _alarm(
        champion.model_id,
        champion.model_revision,
        champion.artifact_sha256,
        DriftLayer.RESIDUAL_ERROR,
    )
    demoted = store.apply_drift_alarm(
        slot_id=champion.slot_id,
        transition_id="q15.drift-demotion.v1",
        policy_revision="q15.policy.drift.v1",
        alarm=alarm,
        expected_generation=champion.generation,
    )
    assert demoted.model_id == champion.model_id
    assert demoted.model_revision == champion.model_revision
    assert demoted.artifact_sha256 == champion.artifact_sha256
    assert demoted.posture is ServingPosture.ABSTAIN_UNKNOWN
    assert (
        store.model_lifecycle(
            bundle.q10_registration.model_id, bundle.q10_registration.model_revision
        )
        is ModelLifecycle.SHADOW_CHALLENGER
    )
    store.close()
    with ResearchRegistryStore(tmp_path) as restarted:
        restored = restarted.restore_champion(champion.slot_id, artifact_root=REPO_ROOT)
        assert restored == demoted
        assert (
            restarted.model_lifecycle(
                bundle.q10_registration.model_id, bundle.q10_registration.model_revision
            )
            is ModelLifecycle.SHADOW_CHALLENGER
        )


def test_crafted_drift_alarm_cannot_target_challenger(tmp_path: Path) -> None:
    store, bundle, champion = populated_registry(tmp_path)
    crafted = _alarm(
        bundle.q10_registration.model_id,
        bundle.q10_registration.model_revision,
        bundle.q10_registration.artifact.sha256,
        DriftLayer.CALIBRATION,
    )
    with pytest.raises(RegistryConflictError, match="exact champion"):
        store.apply_drift_alarm(
            slot_id=champion.slot_id,
            transition_id="q15.drift-crafted.v1",
            policy_revision="q15.policy.drift.v1",
            alarm=crafted,
            expected_generation=champion.generation,
        )
    assert store.current_champion(champion.slot_id) == champion
    store.close()


def test_drift_and_recovery_cannot_reuse_pre_drift_shadow_to_promote(tmp_path: Path) -> None:
    store, bundle, champion = populated_registry(tmp_path)
    comparison = synthetic_shadow_records(bundle, champion)[2]
    alarm = _alarm(
        champion.model_id,
        champion.model_revision,
        champion.artifact_sha256,
        DriftLayer.RESIDUAL_ERROR,
    )
    demoted = store.apply_drift_alarm(
        slot_id=champion.slot_id,
        transition_id="q15.drift-before-promotion.v1",
        policy_revision="q15.policy.drift.v1",
        alarm=alarm,
        expected_generation=champion.generation,
    )
    binding = synthetic_promotion_binding(bundle, shadow_report_sha256=comparison.content_digest)
    with pytest.raises(RegistryConflictError, match="abstaining"):
        store.promote_challenger(
            slot_id=champion.slot_id,
            candidate_model_id=bundle.q10_registration.model_id,
            candidate_model_revision=bundle.q10_registration.model_revision,
            transition_id="q15.promote-from-abstain.v1",
            policy_revision="q15.policy.promote.v1",
            evidence=binding,
            reason="Drift must never self-promote a challenger",
            now_ms=FIXED_TIME_MS + 5,
            expected_generation=demoted.generation,
            artifact_root=REPO_ROOT,
        )
    with pytest.raises(RegistryConflictError, match="timestamp must advance"):
        store.recover_advisory_posture(
            slot_id=champion.slot_id,
            transition_id="q15.recover-backward-time.v1",
            policy_revision="q15.policy.recovery.v1",
            reason="Recovery cannot move time backward",
            now_ms=demoted.updated_at_ms,
            expected_generation=demoted.generation,
            artifact_root=REPO_ROOT,
        )
    recovered = store.recover_advisory_posture(
        slot_id=champion.slot_id,
        transition_id="q15.recover-before-promotion.v1",
        policy_revision="q15.policy.recovery.v1",
        reason="Explicit posture recovery only",
        now_ms=FIXED_TIME_MS + 6,
        expected_generation=demoted.generation,
        artifact_root=REPO_ROOT,
    )
    with pytest.raises(RegistryConflictError, match="COMPARISON_MISMATCH"):
        store.promote_challenger(
            slot_id=champion.slot_id,
            candidate_model_id=bundle.q10_registration.model_id,
            candidate_model_revision=bundle.q10_registration.model_revision,
            transition_id="q15.promote-with-stale-shadow.v1",
            policy_revision="q15.policy.promote.v2",
            evidence=binding,
            reason="Pre-drift shadow evidence is stale after recovery",
            now_ms=FIXED_TIME_MS + 7,
            expected_generation=recovered.generation,
            artifact_root=REPO_ROOT,
        )
    assert store.current_champion(champion.slot_id) == recovered
    assert (
        store.model_lifecycle(
            bundle.q10_registration.model_id, bundle.q10_registration.model_revision
        )
        is ModelLifecycle.SHADOW_CHALLENGER
    )
    store.close()


def test_missing_quality_forces_abstain_and_no_drift_cannot_auto_reenable(tmp_path: Path) -> None:
    store, _bundle, champion = populated_registry(tmp_path)
    missing = evaluate_page_hinkley_drift(
        alarm_id="q15.missingness.v1",
        layer=DriftLayer.MISSINGNESS_QUALITY,
        monitored_model_id=champion.model_id,
        monitored_model_revision=champion.model_revision,
        monitored_artifact_sha256=champion.artifact_sha256,
        monitored_generation=champion.generation,
        monitored_transition_id=champion.transition_id,
        config=PageHinkleyConfigV1(
            detector_id="q15.page-hinkley.v1",
            delta=FixedPointV1(0),
            threshold_lambda=FixedPointV1(5 * FIXED_POINT_SCALE),
            warmup=2,
        ),
        series=_series(quality=QualityState.UNKNOWN),
    )
    demoted = store.apply_drift_alarm(
        slot_id=champion.slot_id,
        transition_id="q15.missing-demotion.v1",
        policy_revision="q15.policy.missing.v1",
        alarm=missing,
        expected_generation=champion.generation,
    )
    assert demoted.posture is ServingPosture.ABSTAIN_UNKNOWN
    healthy = evaluate_page_hinkley_drift(
        alarm_id="q15.no-drift.v1",
        layer=DriftLayer.MISSINGNESS_QUALITY,
        monitored_model_id=demoted.model_id,
        monitored_model_revision=demoted.model_revision,
        monitored_artifact_sha256=demoted.artifact_sha256,
        monitored_generation=demoted.generation,
        monitored_transition_id=demoted.transition_id,
        config=PageHinkleyConfigV1(
            detector_id="q15.page-hinkley.v1",
            delta=FixedPointV1(0),
            threshold_lambda=FixedPointV1(5 * FIXED_POINT_SCALE),
            warmup=2,
        ),
        series=_series(drift=False, start_offset_ms=10),
    )
    assert not healthy.alarmed
    still_abstaining = store.apply_drift_alarm(
        slot_id=champion.slot_id,
        transition_id="q15.no-auto-reenable.v1",
        policy_revision="q15.policy.missing.v2",
        alarm=healthy,
        expected_generation=demoted.generation,
    )
    assert still_abstaining.posture is ServingPosture.ABSTAIN_UNKNOWN
    assert still_abstaining == demoted
    assert store.transition_count(champion.slot_id) == 2
    recovered = store.recover_advisory_posture(
        slot_id=champion.slot_id,
        transition_id="q15.explicit-recovery.v1",
        policy_revision="q15.policy.recovery.v1",
        reason="Reviewed recovery after immutable artifact verification",
        now_ms=FIXED_TIME_MS + 10,
        expected_generation=demoted.generation,
        artifact_root=REPO_ROOT,
    )
    assert recovered.posture is ServingPosture.ADVISORY
    assert recovered.model_id == demoted.model_id
    assert recovered.artifact_sha256 == demoted.artifact_sha256
    store.close()
    with ResearchRegistryStore(tmp_path) as restarted:
        assert restarted.restore_champion(champion.slot_id, artifact_root=REPO_ROOT) == recovered


def test_warn_command_and_stale_drift_cannot_alias_a_later_generation(tmp_path: Path) -> None:
    store, _bundle, champion = populated_registry(tmp_path)
    healthy = _alarm(
        champion.model_id,
        champion.model_revision,
        champion.artifact_sha256,
        DriftLayer.RESIDUAL_ERROR,
    )
    healthy = replace(
        healthy,
        alarm_id="q15.healthy-residual.v1",
        alarmed=False,
        response=DriftResponse.WARN,
        reason_code="NO_DRIFT_OBSERVED",
    )
    assert (
        store.apply_drift_alarm(
            slot_id=champion.slot_id,
            transition_id="q15.warn-reserved.v1",
            policy_revision="q15.policy.warn.v1",
            alarm=healthy,
            expected_generation=champion.generation,
        )
        == champion
    )
    critical = _alarm(
        champion.model_id,
        champion.model_revision,
        champion.artifact_sha256,
        DriftLayer.CALIBRATION,
    )
    with pytest.raises(RegistryConflictError, match="reserved"):
        store.apply_drift_alarm(
            slot_id=champion.slot_id,
            transition_id="q15.warn-reserved.v1",
            policy_revision="q15.policy.drift.v1",
            alarm=critical,
            expected_generation=champion.generation,
        )
    stale = replace(
        critical,
        alarm_id="q15.stale-time.v1",
        observed_at_ms=champion.updated_at_ms - 1,
    )
    with pytest.raises(RegistryConflictError, match="predates"):
        store.apply_drift_alarm(
            slot_id=champion.slot_id,
            transition_id="q15.stale-time-transition.v1",
            policy_revision="q15.policy.drift.v1",
            alarm=stale,
            expected_generation=champion.generation,
        )
    assert store.current_champion(champion.slot_id) == champion
    store.close()


def test_alarm_contract_rejects_candidate_fields_by_construction() -> None:
    alarm = _alarm("model.v1", "revision.v1", DigestV1("2" * 64), DriftLayer.REGIME_MIX)
    assert "candidate" not in "".join(alarm.as_mapping()).lower()
    with pytest.raises(ContractValueError):
        replace(alarm, alarmed=False)


def test_restart_rejects_forged_demotion_and_recovery_lineage(tmp_path: Path) -> None:
    store, bundle, champion = populated_registry(tmp_path)
    alarm = _alarm(
        champion.model_id,
        champion.model_revision,
        champion.artifact_sha256,
        DriftLayer.RESIDUAL_ERROR,
    )
    demoted = store.apply_drift_alarm(
        slot_id=champion.slot_id,
        transition_id="q15.demotion-for-lineage-tamper",
        policy_revision="q15.policy.drift.v1",
        alarm=alarm,
        expected_generation=champion.generation,
    )
    recovered = store.recover_advisory_posture(
        slot_id=champion.slot_id,
        transition_id="q15.recovery-for-lineage-tamper",
        policy_revision="q15.policy.recovery.v1",
        reason="Explicit reviewed recovery",
        now_ms=FIXED_TIME_MS + 10,
        expected_generation=demoted.generation,
        artifact_root=REPO_ROOT,
    )
    store.close()
    connection = sqlite3.connect(tmp_path / "q15-registry.sqlite3")
    forged_recovery: dict[str, object] = {"historicalSnapshotSha256": "0" * 64}
    connection.execute(
        "UPDATE transitions SET evidence_sha=?,evidence=? WHERE transition_id=?",
        (
            mapping_digest(forged_recovery).hexdigest,
            canonical_json_bytes(forged_recovery),
            recovered.transition_id,
        ),
    )
    connection.commit()
    connection.close()
    with (
        ResearchRegistryStore(tmp_path) as restarted,
        pytest.raises(RegistryIntegrityError, match="recovery historical"),
    ):
        restarted.restore_champion(champion.slot_id, artifact_root=REPO_ROOT)

    second_root = tmp_path / "demotion"
    second_root.mkdir()
    store, bundle, champion = populated_registry(second_root)
    alarm = _alarm(
        champion.model_id,
        champion.model_revision,
        champion.artifact_sha256,
        DriftLayer.RESIDUAL_ERROR,
    )
    demoted = store.apply_drift_alarm(
        slot_id=champion.slot_id,
        transition_id="q15.demotion-for-subject-tamper",
        policy_revision="q15.policy.drift.v1",
        alarm=alarm,
        expected_generation=champion.generation,
    )
    store.close()
    forged_alarm = alarm.as_mapping() | {
        "monitoredArtifactSha256": bundle.q10_registration.artifact.sha256.hexdigest,
        "monitoredModelId": bundle.q10_registration.model_id,
        "monitoredModelRevision": bundle.q10_registration.model_revision,
    }
    forged_command = {
        "alarm": forged_alarm,
        "expectedGeneration": champion.generation,
        "kind": "DEMOTION",
        "policyRevision": demoted.policy_revision,
        "slotId": champion.slot_id,
        "transitionId": demoted.transition_id,
    }
    connection = sqlite3.connect(second_root / "q15-registry.sqlite3")
    values = (
        mapping_digest(forged_command).hexdigest,
        canonical_json_bytes(forged_command),
        mapping_digest(forged_alarm).hexdigest,
        canonical_json_bytes(forged_alarm),
        demoted.transition_id,
    )
    connection.execute(
        "UPDATE transitions SET command_sha=?,command=?,evidence_sha=?,evidence=? "
        "WHERE transition_id=?",
        values,
    )
    connection.execute(
        "UPDATE drift_alarms SET command_sha=?,command=?,body_sha=?,body=? WHERE transition_id=?",
        values,
    )
    connection.commit()
    connection.close()
    with (
        ResearchRegistryStore(second_root) as restarted,
        pytest.raises(RegistryIntegrityError, match="transition semantics"),
    ):
        restarted.restore_champion(champion.slot_id, artifact_root=REPO_ROOT)
