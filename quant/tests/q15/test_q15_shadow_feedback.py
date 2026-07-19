from __future__ import annotations

from dataclasses import replace
from pathlib import Path

import pytest
from q15_fixtures import FIXED_TIME_MS, populated_registry

from quant_edge.registry_ops.contracts import (
    AnnotationOutcomeLinkV1,
    ChampionSnapshotV1,
    DelayedFeedbackV1,
    FeedbackState,
    ModelRegistrationV1,
    OutcomeDisposition,
    OutcomeReality,
    OwnerAnnotationV1,
    ShadowPredictionV1,
    ShadowScoreBatchV1,
    mapping_digest,
)
from quant_edge.registry_ops.store import RegistryConflictError, ResearchRegistryStore


def _batch(
    champion: ChampionSnapshotV1,
    challenger: ModelRegistrationV1,
    *,
    batch_id: str,
    horizon_ms: int,
) -> ShadowScoreBatchV1:
    return ShadowScoreBatchV1(
        batch_id=batch_id,
        slot_id=champion.slot_id,
        event_id="event-delayed-v1",
        target_id="transition_binary:v1",
        feature_cutoff_ms=FIXED_TIME_MS + 100,
        horizon_ms=horizon_ms,
        champion_generation=champion.generation,
        champion_transition_id=champion.transition_id,
        champion=ShadowPredictionV1(
            champion.model_id,
            champion.model_revision,
            champion.artifact_sha256,
            mapping_digest({"scoreMicros": "250000"}),
            250_000,
        ),
        challengers=(
            ShadowPredictionV1(
                challenger.model_id,
                challenger.model_revision,
                challenger.artifact.sha256,
                mapping_digest({"scoreMicros": "750000"}),
                750_000,
            ),
        ),
        disposition=OutcomeDisposition.REJECTED,
        reality=OutcomeReality.HYPOTHETICAL,
    )


def test_delayed_feedback_is_horizon_exact_idempotent_and_immutable(tmp_path: Path) -> None:
    store, bundle, champion = populated_registry(tmp_path)
    one_second = _batch(champion, bundle.q10_registration, batch_id="batch-1s", horizon_ms=1_000)
    one_hour = _batch(
        champion,
        bundle.q10_registration,
        batch_id="batch-1h",
        horizon_ms=3_600_000,
    )
    assert store.record_shadow_batch(one_second) == one_second.content_digest
    assert store.record_shadow_batch(one_second) == one_second.content_digest
    store.record_shadow_batch(one_hour)
    cloned_event = replace(one_second, batch_id="batch-1s-clone")
    with pytest.raises(RegistryConflictError, match="evaluation unit"):
        store.record_shadow_batch(cloned_event)
    counts = store.shadow_evaluation_counts(champion.slot_id)
    assert counts.evaluation_unit_count == 3
    assert counts.distinct_event_count == 2
    early = DelayedFeedbackV1(
        feedback_id="feedback-early",
        batch_id=one_second.batch_id,
        event_id=one_second.event_id,
        target_id=one_second.target_id,
        horizon_ms=one_second.horizon_ms,
        source_revision="outcome.v1",
        observed_at_ms=one_second.matures_at_ms - 1,
        state=FeedbackState.AVAILABLE,
        outcome_digest=mapping_digest({"outcomeMicros": "1000000"}),
        outcome_micros=1_000_000,
    )
    with pytest.raises(RegistryConflictError, match="not matured"):
        store.attach_delayed_feedback(early)
    matured = replace(
        early,
        feedback_id="feedback-1s",
        observed_at_ms=one_second.matures_at_ms,
    )
    assert store.attach_delayed_feedback(matured) == matured.content_digest
    assert store.attach_delayed_feedback(matured) == matured.content_digest
    assert store.feedback_state(one_second.batch_id) == "MATURED"
    assert store.feedback_state(one_hour.batch_id) == "PENDING"
    wrong_horizon = replace(
        matured,
        feedback_id="feedback-wrong-horizon",
        horizon_ms=one_hour.horizon_ms,
    )
    with pytest.raises(RegistryConflictError, match="cross event, target or horizon"):
        store.attach_delayed_feedback(wrong_horizon)
    conflicting = replace(matured, source_revision="outcome.v2")
    with pytest.raises(RegistryConflictError, match="conflicts"):
        store.attach_delayed_feedback(conflicting)
    annotation = OwnerAnnotationV1(
        annotation_id="annotation-before-outcome-v1",
        event_id=one_second.event_id,
        evidence_digest=one_second.content_digest,
        outcome_hidden_when_tagged=True,
        tagged_at_ms=one_second.feature_cutoff_ms,
        schema_revision="owner-annotation.v1",
        tags=("plausible_precursor",),
    )
    store.record_owner_annotation(annotation)
    early_link = AnnotationOutcomeLinkV1(
        link_id="annotation-link-early-v1",
        annotation_id=annotation.annotation_id,
        feedback_id=matured.feedback_id,
        linked_at_ms=matured.observed_at_ms - 1,
    )
    with pytest.raises(RegistryConflictError, match="lineage mismatch"):
        store.link_annotation_outcome(early_link)
    mature_link = replace(
        early_link,
        link_id="annotation-link-mature-v1",
        linked_at_ms=matured.observed_at_ms,
    )
    assert store.link_annotation_outcome(mature_link) == mature_link.content_digest
    known_annotation = replace(
        annotation,
        annotation_id="annotation-after-outcome-v1",
        outcome_hidden_when_tagged=False,
        tagged_at_ms=matured.observed_at_ms + 1,
    )
    assert store.record_owner_annotation(known_annotation) == known_annotation.content_digest
    known_link = AnnotationOutcomeLinkV1(
        link_id="annotation-known-link-v1",
        annotation_id=known_annotation.annotation_id,
        feedback_id=matured.feedback_id,
        linked_at_ms=known_annotation.tagged_at_ms,
    )
    assert store.link_annotation_outcome(known_link) == known_link.content_digest
    premature_known = replace(
        known_annotation,
        annotation_id="annotation-known-without-outcome-v1",
        event_id=one_hour.event_id,
        evidence_digest=one_hour.content_digest,
        tagged_at_ms=one_hour.feature_cutoff_ms,
    )
    with pytest.raises(RegistryConflictError, match="requires available"):
        store.record_owner_annotation(premature_known)
    store.close()
    with ResearchRegistryStore(tmp_path) as restarted:
        assert restarted.shadow_evaluation_counts(champion.slot_id) == counts
        with pytest.raises(RegistryConflictError, match="evaluation unit"):
            restarted.record_shadow_batch(cloned_event)


def test_unknown_feedback_stays_unknown_and_owner_annotation_is_separate(tmp_path: Path) -> None:
    store, bundle, champion = populated_registry(tmp_path)
    batch = _batch(champion, bundle.q10_registration, batch_id="batch-unknown", horizon_ms=2_000)
    store.record_shadow_batch(batch)
    feedback = DelayedFeedbackV1(
        feedback_id="feedback-unknown",
        batch_id=batch.batch_id,
        event_id=batch.event_id,
        target_id=batch.target_id,
        horizon_ms=batch.horizon_ms,
        source_revision="outcome.unknown.v1",
        observed_at_ms=batch.matures_at_ms,
        state=FeedbackState.UNKNOWN,
        outcome_digest=None,
        outcome_micros=None,
    )
    store.attach_delayed_feedback(feedback)
    annotation = OwnerAnnotationV1(
        annotation_id="annotation-v1",
        event_id=batch.event_id,
        evidence_digest=batch.content_digest,
        outcome_hidden_when_tagged=True,
        tagged_at_ms=batch.feature_cutoff_ms,
        schema_revision="owner-annotation.v1",
        tags=("insufficient_evidence", "plausible_precursor"),
    )
    assert store.record_owner_annotation(annotation) == annotation.content_digest
    assert store.record_owner_annotation(annotation) == annotation.content_digest
    link = AnnotationOutcomeLinkV1(
        link_id="annotation-outcome-link-v1",
        annotation_id=annotation.annotation_id,
        feedback_id=feedback.feedback_id,
        linked_at_ms=feedback.observed_at_ms,
    )
    with pytest.raises(RegistryConflictError, match="lineage mismatch"):
        store.link_annotation_outcome(link)
    with pytest.raises(RegistryConflictError, match="already differs"):
        store.record_owner_annotation(replace(annotation, tags=("too_late",)))
    store.close()
