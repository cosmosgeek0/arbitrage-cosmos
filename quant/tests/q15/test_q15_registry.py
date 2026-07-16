from __future__ import annotations

from dataclasses import replace
from pathlib import Path

import pytest
from q15_fixtures import FIXED_TIME_MS, REPO_ROOT, populated_registry

from quant_edge.lake.contracts import DigestV1
from quant_edge.registry_ops.bundle import (
    mismatched_q14_binding,
    synthetic_promotion_binding,
    synthetic_shadow_records,
)
from quant_edge.registry_ops.contracts import (
    ModelLifecycle,
    RetirementRecordV1,
    mapping_digest,
)
from quant_edge.registry_ops.store import (
    RegistryConflictError,
    RegistryIntegrityError,
    ResearchRegistryStore,
)


def test_restart_restores_exact_champion_artifact_and_policy(tmp_path: Path) -> None:
    store, _bundle, champion = populated_registry(tmp_path)
    store.close()
    with ResearchRegistryStore(tmp_path) as restarted:
        restored = restarted.restore_champion("transition-binary", artifact_root=REPO_ROOT)
    assert restored == champion
    assert restored.artifact_sha256 == champion.artifact_sha256
    assert restored.model_card_sha256 == champion.model_card_sha256
    assert restored.policy_revision == "q15.policy.v1"


def test_real_q14_identity_mismatch_and_missing_gate_fail_closed(tmp_path: Path) -> None:
    store, bundle, champion = populated_registry(tmp_path)
    shadow_digest = synthetic_shadow_records(bundle, champion)[2].content_digest
    with pytest.raises(RegistryConflictError, match="VALIDATION_ARTIFACT_MISMATCH"):
        store.promote_challenger(
            slot_id=champion.slot_id,
            candidate_model_id=bundle.q10_registration.model_id,
            candidate_model_revision=bundle.q10_registration.model_revision,
            transition_id="q15.promote.mismatch",
            policy_revision="q15.policy.v2",
            evidence=mismatched_q14_binding(bundle, shadow_report_sha256=shadow_digest),
            reason="Must reject unrelated Q14 model identities",
            now_ms=FIXED_TIME_MS + 2,
            expected_generation=champion.generation,
            artifact_root=REPO_ROOT,
        )
    forged_binding = replace(
        mismatched_q14_binding(bundle, shadow_report_sha256=shadow_digest),
        report_baseline_model_id=champion.model_id,
        report_challenger_model_id=bundle.q10_registration.model_id,
        report_verdict="SYNTHETIC_FIXTURE_PASS",
    )
    with pytest.raises(RegistryConflictError, match="Q14_REPORT_NOT_ARTIFACT_IDENTITY_BOUND"):
        store.promote_challenger(
            slot_id=champion.slot_id,
            candidate_model_id=bundle.q10_registration.model_id,
            candidate_model_revision=bundle.q10_registration.model_revision,
            transition_id="q15.promote.forged-report-binding",
            policy_revision="q15.policy.v2",
            evidence=forged_binding,
            reason="Binding fields cannot rewrite report content",
            now_ms=FIXED_TIME_MS + 2,
            expected_generation=champion.generation,
            artifact_root=REPO_ROOT,
        )
    incomplete = synthetic_promotion_binding(bundle, shadow_report_sha256=shadow_digest)
    incomplete = replace(incomplete, gates=replace(incomplete.gates, calibration=False))
    with pytest.raises(RegistryConflictError, match="PROMOTION_GATE_INCOMPLETE"):
        store.promote_challenger(
            slot_id=champion.slot_id,
            candidate_model_id=bundle.q10_registration.model_id,
            candidate_model_revision=bundle.q10_registration.model_revision,
            transition_id="q15.promote.incomplete",
            policy_revision="q15.policy.v2",
            evidence=incomplete,
            reason="Missing one promotion gate must fail",
            now_ms=FIXED_TIME_MS + 2,
            expected_generation=champion.generation,
            artifact_root=REPO_ROOT,
        )
    assert store.current_champion(champion.slot_id) == champion
    assert (
        store.model_lifecycle(
            bundle.q10_registration.model_id, bundle.q10_registration.model_revision
        )
        is ModelLifecycle.SHADOW_CHALLENGER
    )
    store.close()


def test_explicit_synthetic_promotion_rollback_and_retirement(tmp_path: Path) -> None:
    store, bundle, initial = populated_registry(tmp_path)
    shadow_digest = synthetic_shadow_records(bundle, initial)[2].content_digest
    promoted = store.promote_challenger(
        slot_id=initial.slot_id,
        candidate_model_id=bundle.q10_registration.model_id,
        candidate_model_revision=bundle.q10_registration.model_revision,
        transition_id="q15.promote.synthetic",
        policy_revision="q15.policy.v2",
        evidence=synthetic_promotion_binding(bundle, shadow_report_sha256=shadow_digest),
        reason="Synthetic state-machine proof only",
        now_ms=FIXED_TIME_MS + 2,
        expected_generation=initial.generation,
        artifact_root=REPO_ROOT,
    )
    assert promoted.model_id == bundle.q10_registration.model_id
    assert promoted.generation == 2
    with pytest.raises(RegistryConflictError, match="stale"):
        store.promote_challenger(
            slot_id=initial.slot_id,
            candidate_model_id=bundle.q11_registration.model_id,
            candidate_model_revision=bundle.q11_registration.model_revision,
            transition_id="q15.promote.stale",
            policy_revision="q15.policy.v3",
            evidence=synthetic_promotion_binding(bundle, shadow_report_sha256=shadow_digest),
            reason="Stale CAS must fail",
            now_ms=FIXED_TIME_MS + 3,
            expected_generation=1,
            artifact_root=REPO_ROOT,
        )
    rolled_back = store.rollback_champion(
        slot_id=initial.slot_id,
        target_model_id=initial.model_id,
        target_model_revision=initial.model_revision,
        target_artifact_sha256=initial.artifact_sha256,
        transition_id="q15.rollback.v1",
        policy_revision="q15.policy.rollback.v1",
        reason="Explicit rollback to exact historical artifact",
        now_ms=FIXED_TIME_MS + 4,
        expected_generation=promoted.generation,
        artifact_root=REPO_ROOT,
    )
    assert rolled_back.artifact_sha256 == initial.artifact_sha256
    assert rolled_back.model_card_sha256 == initial.model_card_sha256
    store.close()
    store = ResearchRegistryStore(tmp_path)
    assert store.restore_champion(initial.slot_id, artifact_root=REPO_ROOT) == rolled_back
    retirement = RetirementRecordV1(
        retirement_id="q15.retire.q10.v1",
        model_id=bundle.q10_registration.model_id,
        model_revision=bundle.q10_registration.model_revision,
        artifact_sha256=bundle.q10_registration.artifact.sha256,
        reason="No persisted fitted weights and no matching Q14 validation",
        last_valid_cohort="Synthetic transition_binary fixture only",
        successor_or_fallback=initial.model_id,
        rollback_path="Preserve artifact; explicit reviewed registration required",
        evidence_digest=mapping_digest(
            synthetic_promotion_binding(bundle, shadow_report_sha256=shadow_digest).as_mapping()
        ),
        retired_at_ms=FIXED_TIME_MS + 5,
    )
    assert store.retire_model(retirement) == retirement.content_digest
    assert store.retire_model(retirement) == retirement.content_digest
    assert (
        store.model_lifecycle(
            bundle.q10_registration.model_id, bundle.q10_registration.model_revision
        )
        is ModelLifecycle.RETIRED
    )
    with pytest.raises(RegistryConflictError, match="already has"):
        store.retire_model(replace(retirement, retirement_id="q15.retire.q10.duplicate"))
    with pytest.raises(RegistryConflictError, match="active champion"):
        store.retire_model(
            replace(
                retirement,
                retirement_id="q15.retire.active.v1",
                model_id=initial.model_id,
                model_revision=initial.model_revision,
                artifact_sha256=initial.artifact_sha256,
            )
        )
    store.close()


def test_retirement_rejects_unresolved_evidence(tmp_path: Path) -> None:
    store, bundle, _initial = populated_registry(tmp_path)
    record = RetirementRecordV1(
        retirement_id="q15.retire.unresolved.v1",
        model_id=bundle.q10_registration.model_id,
        model_revision=bundle.q10_registration.model_revision,
        artifact_sha256=bundle.q10_registration.artifact.sha256,
        reason="Evidence must resolve before retirement",
        last_valid_cohort="UNKNOWN",
        successor_or_fallback="logistic:v1",
        rollback_path="Explicit reviewed rollback only",
        evidence_digest=bundle.q11_registration.artifact.sha256,
        retired_at_ms=FIXED_TIME_MS + 5,
    )
    with pytest.raises(RegistryConflictError, match="does not bind"):
        store.retire_model(record)
    assert (
        store.model_lifecycle(record.model_id, record.model_revision)
        is ModelLifecycle.SHADOW_CHALLENGER
    )
    store.close()


def test_conflicting_transition_id_is_rejected(tmp_path: Path) -> None:
    store, bundle, initial = populated_registry(tmp_path)
    shadow_digest = synthetic_shadow_records(bundle, initial)[2].content_digest
    promoted = store.promote_challenger(
        slot_id=initial.slot_id,
        candidate_model_id=bundle.q10_registration.model_id,
        candidate_model_revision=bundle.q10_registration.model_revision,
        transition_id="q15.promote.idempotent",
        policy_revision="q15.policy.v2",
        evidence=synthetic_promotion_binding(bundle, shadow_report_sha256=shadow_digest),
        reason="Synthetic state-machine proof only",
        now_ms=FIXED_TIME_MS + 2,
        expected_generation=initial.generation,
        artifact_root=REPO_ROOT,
    )
    again = store.promote_challenger(
        slot_id=initial.slot_id,
        candidate_model_id=bundle.q10_registration.model_id,
        candidate_model_revision=bundle.q10_registration.model_revision,
        transition_id="q15.promote.idempotent",
        policy_revision="q15.policy.v2",
        evidence=synthetic_promotion_binding(bundle, shadow_report_sha256=shadow_digest),
        reason="Synthetic state-machine proof only",
        now_ms=FIXED_TIME_MS + 2,
        expected_generation=initial.generation,
        artifact_root=REPO_ROOT,
    )
    assert again == promoted
    with pytest.raises(RegistryConflictError, match="idempotency"):
        store.promote_challenger(
            slot_id=initial.slot_id,
            candidate_model_id=bundle.q11_registration.model_id,
            candidate_model_revision=bundle.q11_registration.model_revision,
            transition_id="q15.promote.idempotent",
            policy_revision="q15.policy.other",
            evidence=synthetic_promotion_binding(bundle, shadow_report_sha256=shadow_digest),
            reason="Conflicting reuse",
            now_ms=FIXED_TIME_MS + 3,
            expected_generation=promoted.generation,
            artifact_root=REPO_ROOT,
        )
    store.close()


def test_artifact_corruption_does_not_fall_back_or_select_challenger(tmp_path: Path) -> None:
    # A separate registry root and artifact root make corruption safe and explicit.
    registry_root = tmp_path / "registry"
    registry_root.mkdir()
    store, bundle, champion = populated_registry(registry_root)
    store.close()
    corrupt_root = tmp_path / "artifacts"
    target = corrupt_root / bundle.q10_baseline_registration.artifact.relative_path
    target.parent.mkdir(parents=True)
    target.write_bytes(b"corrupt\n")
    with ResearchRegistryStore(registry_root) as restarted:
        with pytest.raises(RegistryIntegrityError):
            restarted.restore_champion(champion.slot_id, artifact_root=corrupt_root)
        assert restarted.current_champion(champion.slot_id) == champion
        assert (
            restarted.model_lifecycle(
                bundle.q10_registration.model_id, bundle.q10_registration.model_revision
            )
            is ModelLifecycle.SHADOW_CHALLENGER
        )


def test_digest_type_remains_exact() -> None:
    assert DigestV1("0" * 64).hexdigest == "0" * 64
