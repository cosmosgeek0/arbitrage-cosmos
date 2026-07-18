from __future__ import annotations

import shutil
import sqlite3
from dataclasses import replace
from pathlib import Path

import pytest
from q15_fixtures import FIXED_TIME_MS, REPO_ROOT, build_bundle, populated_registry

from quant_edge.lake.contracts import DigestV1
from quant_edge.registry_ops.artifacts import ArtifactIntegrityError
from quant_edge.registry_ops.bundle import (
    MergedQ15BundleV1,
    synthetic_promotion_binding,
    synthetic_shadow_records,
)
from quant_edge.registry_ops.contracts import CommitStage, mapping_digest
from quant_edge.registry_ops.store import (
    RegistryConflictError,
    RegistryIntegrityError,
    ResearchRegistryStore,
)


def _copy_artifact(root: Path, relative_path: str) -> None:
    target = root / relative_path
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(REPO_ROOT / relative_path, target)


def _registered_store(root: Path) -> tuple[ResearchRegistryStore, MergedQ15BundleV1]:
    bundle = build_bundle()
    root.mkdir(parents=True)
    store = ResearchRegistryStore(root)
    for card in (
        bundle.dataset_card,
        bundle.q11_dataset_card,
        bundle.q11_model_card,
        bundle.q10_baseline_model_card,
        bundle.q10_model_card,
        bundle.experiment_card,
    ):
        store.register_card(card, recorded_at_ms=FIXED_TIME_MS)
    for artifact in bundle.artifact_manifest.artifacts:
        store.register_artifact(artifact, artifact_root=REPO_ROOT, recorded_at_ms=FIXED_TIME_MS)
    for registration in (
        bundle.q11_registration,
        bundle.q10_baseline_registration,
        bundle.q10_registration,
    ):
        store.register_model(registration, artifact_root=REPO_ROOT)
    return store, bundle


def test_bootstrap_reverifies_registered_artifact_and_one_model_owns_one_slot(
    tmp_path: Path,
) -> None:
    store, bundle = _registered_store(tmp_path / "registry")
    empty_artifacts = tmp_path / "empty-artifacts"
    empty_artifacts.mkdir()
    with pytest.raises(ArtifactIntegrityError):
        store.bootstrap_research_champion(
            slot_id="transition-binary",
            model_id=bundle.q10_baseline_registration.model_id,
            model_revision=bundle.q10_baseline_registration.model_revision,
            transition_id="q15.bootstrap.missing-artifact",
            policy_revision="q15.policy.v1",
            reason="Artifact bytes must still exist",
            now_ms=FIXED_TIME_MS + 1,
            artifact_root=empty_artifacts,
        )
    assert store.current_champion("transition-binary") is None
    champion = store.bootstrap_research_champion(
        slot_id="transition-binary",
        model_id=bundle.q10_baseline_registration.model_id,
        model_revision=bundle.q10_baseline_registration.model_revision,
        transition_id="q15.bootstrap.valid",
        policy_revision="q15.policy.v1",
        reason="Exact registered artifact is present",
        now_ms=FIXED_TIME_MS + 1,
        artifact_root=REPO_ROOT,
    )
    with pytest.raises(RegistryConflictError, match="shadow challenger"):
        store.bootstrap_research_champion(
            slot_id="second-slot",
            model_id=champion.model_id,
            model_revision=champion.model_revision,
            transition_id="q15.bootstrap.second-slot",
            policy_revision="q15.policy.v1",
            reason="One model cannot champion two slots",
            now_ms=FIXED_TIME_MS + 2,
            artifact_root=REPO_ROOT,
        )
    store.close()


def test_promotion_and_rollback_reverify_bytes_without_mutating_on_failure(tmp_path: Path) -> None:
    registry_root = tmp_path / "registry"
    registry_root.mkdir()
    store, bundle, initial = populated_registry(registry_root)
    report_only = tmp_path / "report-only"
    _copy_artifact(report_only, bundle.artifact("q15.synthetic-promotion-report.v1").relative_path)
    comparison = synthetic_shadow_records(bundle, initial)[2]
    with pytest.raises(ArtifactIntegrityError):
        store.promote_challenger(
            slot_id=initial.slot_id,
            candidate_model_id=bundle.q10_registration.model_id,
            candidate_model_revision=bundle.q10_registration.model_revision,
            transition_id="q15.promote.missing-model-bytes",
            policy_revision="q15.policy.v2",
            evidence=synthetic_promotion_binding(
                bundle, shadow_report_sha256=comparison.content_digest
            ),
            reason="Current and candidate bytes must be present",
            now_ms=FIXED_TIME_MS + 2,
            expected_generation=initial.generation,
            artifact_root=report_only,
        )
    assert store.current_champion(initial.slot_id) == initial
    promoted = store.promote_challenger(
        slot_id=initial.slot_id,
        candidate_model_id=bundle.q10_registration.model_id,
        candidate_model_revision=bundle.q10_registration.model_revision,
        transition_id="q15.promote.valid-for-rollback",
        policy_revision="q15.policy.v2",
        evidence=synthetic_promotion_binding(
            bundle, shadow_report_sha256=comparison.content_digest
        ),
        reason="Synthetic state-machine proof",
        now_ms=FIXED_TIME_MS + 2,
        expected_generation=initial.generation,
        artifact_root=REPO_ROOT,
    )
    with pytest.raises(ArtifactIntegrityError):
        store.rollback_champion(
            slot_id=initial.slot_id,
            target_model_id=initial.model_id,
            target_model_revision=initial.model_revision,
            target_artifact_sha256=initial.artifact_sha256,
            transition_id="q15.rollback.missing-bytes",
            policy_revision="q15.policy.rollback.v1",
            reason="Rollback target bytes must exist",
            now_ms=FIXED_TIME_MS + 3,
            expected_generation=promoted.generation,
            artifact_root=report_only,
        )
    assert store.current_champion(initial.slot_id) == promoted
    store.close()


def test_shadow_metrics_require_exact_order_and_restart_from_same_evidence(
    tmp_path: Path,
) -> None:
    store, bundle, champion = populated_registry(tmp_path)
    base_batch, base_feedback, comparison = synthetic_shadow_records(bundle, champion)
    forged = replace(
        comparison,
        comparison_id="q15.forged-comparison.v1",
        champion_metric_micros=999_999,
        challenger_metric_micros=0,
    )
    with pytest.raises(RegistryConflictError, match="do not reproduce"):
        store.record_shadow_comparison(forged)
    binding = synthetic_promotion_binding(bundle, shadow_report_sha256=comparison.content_digest)
    with pytest.raises(RegistryConflictError, match="MISSING"):
        store.promote_challenger(
            slot_id=champion.slot_id,
            candidate_model_id=bundle.q10_registration.model_id,
            candidate_model_revision=bundle.q10_registration.model_revision,
            transition_id="q15.promote.unknown-comparison",
            policy_revision="q15.policy.v2",
            evidence=replace(binding, shadow_report_sha256=DigestV1("0" * 64)),
            reason="Arbitrary comparison digests are not evidence",
            now_ms=FIXED_TIME_MS + 2,
            expected_generation=champion.generation,
            artifact_root=REPO_ROOT,
        )
    assert store.current_champion(champion.slot_id) == champion

    def persist_score_pair(
        *,
        prefix: str,
        champion_scores: tuple[int, int],
        challenger_scores: tuple[int, int],
    ) -> tuple[tuple[str, ...], tuple[DigestV1, ...], int, int]:
        batch_ids: list[str] = []
        feedback_digests: list[DigestV1] = []
        for ordinal, (champion_score, challenger_score) in enumerate(
            zip(champion_scores, challenger_scores, strict=True),
            start=1,
        ):
            batch_id = f"q15.{prefix}.batch.{ordinal}"
            event_id = f"q15.{prefix}.event.{ordinal}"
            batch = replace(
                base_batch,
                batch_id=batch_id,
                event_id=event_id,
                feature_cutoff_ms=base_batch.feature_cutoff_ms + ordinal,
                champion=replace(
                    base_batch.champion,
                    output_digest=mapping_digest({"scoreMicros": str(champion_score)}),
                    score_micros=champion_score,
                ),
                challengers=(
                    replace(
                        base_batch.challengers[0],
                        output_digest=mapping_digest({"scoreMicros": str(challenger_score)}),
                        score_micros=challenger_score,
                    ),
                ),
            )
            feedback = replace(
                base_feedback,
                feedback_id=f"q15.{prefix}.feedback.{ordinal}",
                batch_id=batch_id,
                event_id=event_id,
                source_revision=f"q15.{prefix}.outcome.v1",
                observed_at_ms=batch.matures_at_ms,
                outcome_digest=mapping_digest({"outcomeMicros": "0"}),
                outcome_micros=0,
            )
            store.record_shadow_batch(batch)
            store.attach_delayed_feedback(feedback)
            batch_ids.append(batch_id)
            feedback_digests.append(feedback.content_digest)
        return (
            tuple(batch_ids),
            tuple(sorted(feedback_digests, key=lambda digest: digest.hexdigest)),
            sum(score * score for score in champion_scores),
            sum(score * score for score in challenger_scores),
        )

    reversal_batches, reversal_feedback, champion_sum, challenger_sum = persist_score_pair(
        prefix="exact-reversal",
        champion_scores=(1_000, 1_000),
        challenger_scores=(1_414, 999),
    )
    assert champion_sum == 2_000_000
    assert challenger_sum == 2_997_397
    assert challenger_sum > champion_sum
    exact_reversal = replace(
        comparison,
        comparison_id="q15.exact-reversal-comparison.v1",
        batch_ids=reversal_batches,
        feedback_digests=reversal_feedback,
        champion_metric_micros=1,
        challenger_metric_micros=1,
        verdict="FAIL",
    )
    assert store.record_shadow_comparison(exact_reversal) == exact_reversal.content_digest

    pass_batches, pass_feedback, pass_champion_sum, pass_challenger_sum = persist_score_pair(
        prefix="exact-restart",
        champion_scores=(2_000, 2_000),
        challenger_scores=(1_414, 999),
    )
    assert pass_champion_sum == 8_000_000
    assert pass_challenger_sum == 2_997_397
    exact_pass = replace(
        comparison,
        comparison_id="q15.exact-restart-comparison.v1",
        batch_ids=pass_batches,
        feedback_digests=pass_feedback,
        champion_metric_micros=4,
        challenger_metric_micros=1,
        verdict="PASS",
    )
    assert store.record_shadow_comparison(exact_pass) == exact_pass.content_digest
    promoted = store.promote_challenger(
        slot_id=champion.slot_id,
        candidate_model_id=bundle.q10_registration.model_id,
        candidate_model_revision=bundle.q10_registration.model_revision,
        transition_id="q15.promote.exact-brier.v1",
        policy_revision="q15.policy.exact-brier.v1",
        evidence=replace(binding, shadow_report_sha256=exact_pass.content_digest),
        reason="Exact aggregate Brier evidence",
        now_ms=FIXED_TIME_MS + 2,
        expected_generation=champion.generation,
        artifact_root=REPO_ROOT,
    )
    store.close()
    with ResearchRegistryStore(tmp_path) as restarted:
        assert restarted.restore_champion(champion.slot_id, artifact_root=REPO_ROOT) == promoted


def test_hook_exception_rolls_back_and_connection_remains_usable(tmp_path: Path) -> None:
    store, bundle, initial = populated_registry(tmp_path)
    comparison = synthetic_shadow_records(bundle, initial)[2]

    def fail_after_begin(stage: CommitStage) -> None:
        if stage is CommitStage.AFTER_BEGIN:
            raise RuntimeError("injected fault")

    with pytest.raises(RuntimeError, match="injected fault"):
        store.promote_challenger(
            slot_id=initial.slot_id,
            candidate_model_id=bundle.q10_registration.model_id,
            candidate_model_revision=bundle.q10_registration.model_revision,
            transition_id="q15.promote.hook-fault",
            policy_revision="q15.policy.v2",
            evidence=synthetic_promotion_binding(
                bundle, shadow_report_sha256=comparison.content_digest
            ),
            reason="Fault injection",
            now_ms=FIXED_TIME_MS + 2,
            expected_generation=initial.generation,
            artifact_root=REPO_ROOT,
            hook=fail_after_begin,
        )
    assert store.current_champion(initial.slot_id) == initial
    assert store.transition_count(initial.slot_id) == 1
    store.close()


def test_promotion_and_rollback_timestamps_must_advance(tmp_path: Path) -> None:
    store, bundle, initial = populated_registry(tmp_path)
    comparison = synthetic_shadow_records(bundle, initial)[2]
    binding = synthetic_promotion_binding(bundle, shadow_report_sha256=comparison.content_digest)
    with pytest.raises(RegistryConflictError, match="timestamp must advance"):
        store.promote_challenger(
            slot_id=initial.slot_id,
            candidate_model_id=bundle.q10_registration.model_id,
            candidate_model_revision=bundle.q10_registration.model_revision,
            transition_id="q15.promote.backward-time",
            policy_revision="q15.policy.v2",
            evidence=binding,
            reason="Time must advance",
            now_ms=initial.updated_at_ms,
            expected_generation=initial.generation,
            artifact_root=REPO_ROOT,
        )
    promoted = store.promote_challenger(
        slot_id=initial.slot_id,
        candidate_model_id=bundle.q10_registration.model_id,
        candidate_model_revision=bundle.q10_registration.model_revision,
        transition_id="q15.promote.forward-time",
        policy_revision="q15.policy.v2",
        evidence=binding,
        reason="Valid chronological promotion",
        now_ms=FIXED_TIME_MS + 2,
        expected_generation=initial.generation,
        artifact_root=REPO_ROOT,
    )
    with pytest.raises(RegistryConflictError, match="timestamp must advance"):
        store.rollback_champion(
            slot_id=initial.slot_id,
            target_model_id=initial.model_id,
            target_model_revision=initial.model_revision,
            target_artifact_sha256=initial.artifact_sha256,
            transition_id="q15.rollback.backward-time",
            policy_revision="q15.policy.rollback.v1",
            reason="Time must advance",
            now_ms=promoted.updated_at_ms,
            expected_generation=promoted.generation,
            artifact_root=REPO_ROOT,
        )
    assert store.current_champion(initial.slot_id) == promoted
    store.close()


@pytest.mark.parametrize(
    ("statement", "parameters"),
    [
        ("UPDATE champions SET generation=generation+1", ()),
        ("UPDATE cards SET body=x'7b7d0a' WHERE kind='MODEL'", ()),
        ("UPDATE models SET body=x'7b7d0a' WHERE lifecycle='CHAMPION'", ()),
        ("UPDATE models SET lifecycle='CHAMPION' WHERE lifecycle='SHADOW_CHALLENGER'", ()),
        ("DELETE FROM champion_history WHERE generation=1", ()),
        (
            "UPDATE transitions SET previous_snapshot_sha='"
            + "0" * 64
            + "' WHERE kind='BOOTSTRAP'",
            (),
        ),
    ],
)
def test_restart_rejects_projection_card_registration_and_history_tamper(
    tmp_path: Path,
    statement: str,
    parameters: tuple[object, ...],
) -> None:
    store, _bundle, champion = populated_registry(tmp_path)
    store.close()
    connection = sqlite3.connect(tmp_path / "q15-registry.sqlite3")
    connection.execute(statement, parameters)
    connection.commit()
    connection.close()
    with ResearchRegistryStore(tmp_path) as restarted, pytest.raises(RegistryIntegrityError):
        restarted.restore_champion(champion.slot_id, artifact_root=REPO_ROOT)


def test_database_symlink_is_rejected(tmp_path: Path) -> None:
    target = tmp_path / "outside.sqlite3"
    target.write_bytes(b"not a registry")
    (tmp_path / "q15-registry.sqlite3").symlink_to(target)
    with pytest.raises(RegistryIntegrityError, match="unsafe"):
        ResearchRegistryStore(tmp_path)


def test_producer_neutral_contract_allows_future_model_family_to_shadow(tmp_path: Path) -> None:
    store, bundle = _registered_store(tmp_path / "registry")
    generic_card = replace(
        bundle.q10_model_card,
        card_id="q15.test-card.generic-composer.v1",
        model_id="generic-composer:v1",
        model_revision="generic.v1",
    )
    generic_experiment = replace(
        bundle.experiment_card,
        card_id="q15.test-experiment.generic-composer.v1",
        revision="generic.v1",
        model_card_ids=tuple(
            sorted((*bundle.experiment_card.model_card_ids, generic_card.card_id))
        ),
    )
    store.register_card(generic_card, recorded_at_ms=FIXED_TIME_MS)
    store.register_card(generic_experiment, recorded_at_ms=FIXED_TIME_MS)
    generic_registration = replace(
        bundle.q10_registration,
        model_id=generic_card.model_id,
        model_revision=generic_card.model_revision,
        model_card_digest=generic_card.content_digest,
        experiment_card_digest=generic_experiment.content_digest,
        output_contract_id="FutureProducerEnvelopeV1.transition_binary:v1",
    )
    store.register_model(generic_registration, artifact_root=REPO_ROOT)
    champion = store.bootstrap_research_champion(
        slot_id="transition-binary",
        model_id=bundle.q10_baseline_registration.model_id,
        model_revision=bundle.q10_baseline_registration.model_revision,
        transition_id="q15.bootstrap.generic-shadow",
        policy_revision="q15.policy.v1",
        reason="Producer-neutral compatibility proof",
        now_ms=FIXED_TIME_MS + 1,
        artifact_root=REPO_ROOT,
    )
    batch, _feedback, _comparison = synthetic_shadow_records(bundle, champion)
    generic_prediction = replace(
        batch.challengers[0],
        model_id=generic_registration.model_id,
        model_revision=generic_registration.model_revision,
    )
    generic_batch = replace(
        batch,
        batch_id="q15.generic-producer-shadow.v1",
        challengers=(generic_prediction,),
    )
    assert store.record_shadow_batch(generic_batch) == generic_batch.content_digest
    store.close()


@pytest.mark.parametrize(
    "statement",
    [
        "DELETE FROM shadow_comparisons",
        "DELETE FROM artifacts WHERE artifact_id='q15.synthetic-promotion-report.v1'",
        "DELETE FROM feedback",
        "DELETE FROM shadow_batches",
    ],
)
def test_restart_requires_promotion_evidence_to_remain_resolvable(
    tmp_path: Path,
    statement: str,
) -> None:
    store, bundle, initial = populated_registry(tmp_path)
    comparison = synthetic_shadow_records(bundle, initial)[2]
    promoted = store.promote_challenger(
        slot_id=initial.slot_id,
        candidate_model_id=bundle.q10_registration.model_id,
        candidate_model_revision=bundle.q10_registration.model_revision,
        transition_id="q15.promote.for-restore-lineage",
        policy_revision="q15.policy.v2",
        evidence=synthetic_promotion_binding(
            bundle, shadow_report_sha256=comparison.content_digest
        ),
        reason="Promotion lineage must remain resolvable",
        now_ms=FIXED_TIME_MS + 2,
        expected_generation=initial.generation,
        artifact_root=REPO_ROOT,
    )
    store.close()
    connection = sqlite3.connect(tmp_path / "q15-registry.sqlite3")
    connection.execute("PRAGMA foreign_keys=OFF")
    connection.execute(statement)
    connection.commit()
    connection.close()
    with (
        ResearchRegistryStore(tmp_path) as restarted,
        pytest.raises(RegistryIntegrityError, match=r"promotion lineage|shadow"),
    ):
        restarted.restore_champion(promoted.slot_id, artifact_root=REPO_ROOT)
