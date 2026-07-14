from __future__ import annotations

from pathlib import Path

from quant_edge.registry_ops.bundle import (
    MergedQ15BundleV1,
    build_merged_q15_bundle,
    synthetic_shadow_records,
)
from quant_edge.registry_ops.contracts import ChampionSnapshotV1
from quant_edge.registry_ops.store import ResearchRegistryStore

REPO_ROOT = Path(__file__).resolve().parents[3]
BASE_COMMIT = "6b18928c282f19128a033ed33910754cbdc2cbe0"
FIXED_TIME_MS = 1_783_890_000_000


def build_bundle() -> MergedQ15BundleV1:
    return build_merged_q15_bundle(
        REPO_ROOT,
        code_commit=BASE_COMMIT,
        recorded_at_ms=FIXED_TIME_MS,
    )


def populated_registry(
    root: Path,
) -> tuple[ResearchRegistryStore, MergedQ15BundleV1, ChampionSnapshotV1]:
    bundle = build_bundle()
    store = ResearchRegistryStore(root)
    store.register_card(bundle.dataset_card, recorded_at_ms=FIXED_TIME_MS)
    store.register_card(bundle.q11_dataset_card, recorded_at_ms=FIXED_TIME_MS)
    store.register_card(bundle.q11_model_card, recorded_at_ms=FIXED_TIME_MS)
    store.register_card(bundle.q10_baseline_model_card, recorded_at_ms=FIXED_TIME_MS)
    store.register_card(bundle.q10_model_card, recorded_at_ms=FIXED_TIME_MS)
    store.register_card(bundle.experiment_card, recorded_at_ms=FIXED_TIME_MS)
    for artifact in bundle.artifact_manifest.artifacts:
        store.register_artifact(
            artifact,
            artifact_root=REPO_ROOT,
            recorded_at_ms=FIXED_TIME_MS,
        )
    store.register_model(bundle.q11_registration, artifact_root=REPO_ROOT)
    store.register_model(bundle.q10_baseline_registration, artifact_root=REPO_ROOT)
    store.register_model(bundle.q10_registration, artifact_root=REPO_ROOT)
    champion = store.bootstrap_research_champion(
        slot_id="transition-binary",
        model_id=bundle.q10_baseline_registration.model_id,
        model_revision=bundle.q10_baseline_registration.model_revision,
        transition_id="q15.bootstrap.v1",
        policy_revision="q15.policy.v1",
        reason="Explicit synthetic advisory research pin",
        now_ms=FIXED_TIME_MS + 1,
        artifact_root=REPO_ROOT,
    )
    batch, feedback, comparison = synthetic_shadow_records(bundle, champion)
    store.record_shadow_batch(batch)
    store.attach_delayed_feedback(feedback)
    store.record_shadow_comparison(comparison)
    return store, bundle, champion
