"""Deterministic Q15 generated evidence campaign."""

from __future__ import annotations

import sys
from pathlib import Path
from tempfile import TemporaryDirectory

from quant_edge.canonical import canonical_json_bytes
from quant_edge.features.fixedpoint import FIXED_POINT_SCALE, FixedPointV1
from quant_edge.lake.contracts import EvidencePosture as LakeEvidencePosture
from quant_edge.lake.contracts import QualityState
from quant_edge.regime.contracts import ObservationSeriesV1, ObservationV1
from quant_edge.regime.page_hinkley import PageHinkleyConfigV1
from quant_edge.registry_ops.artifacts import read_verified_artifact
from quant_edge.registry_ops.bundle import (
    MergedQ15BundleV1,
    build_merged_q15_bundle,
    mismatched_q14_binding,
    synthetic_shadow_records,
)
from quant_edge.registry_ops.contracts import (
    DriftLayer,
    ModelLifecycle,
)
from quant_edge.registry_ops.drift import evaluate_page_hinkley_drift
from quant_edge.registry_ops.store import RegistryConflictError, ResearchRegistryStore

FIXED_TIME_MS = 1_783_890_000_000


def _register_bundle(
    store: ResearchRegistryStore,
    bundle: MergedQ15BundleV1,
    repo_root: Path,
) -> None:
    store.register_card(bundle.dataset_card, recorded_at_ms=FIXED_TIME_MS)
    store.register_card(bundle.q11_dataset_card, recorded_at_ms=FIXED_TIME_MS)
    store.register_card(bundle.q11_model_card, recorded_at_ms=FIXED_TIME_MS)
    store.register_card(bundle.q10_baseline_model_card, recorded_at_ms=FIXED_TIME_MS)
    store.register_card(bundle.q10_model_card, recorded_at_ms=FIXED_TIME_MS)
    store.register_card(bundle.experiment_card, recorded_at_ms=FIXED_TIME_MS)
    for artifact in bundle.artifact_manifest.artifacts:
        store.register_artifact(
            artifact,
            artifact_root=repo_root,
            recorded_at_ms=FIXED_TIME_MS,
        )
    store.register_model(bundle.q11_registration, artifact_root=repo_root)
    store.register_model(bundle.q10_baseline_registration, artifact_root=repo_root)
    store.register_model(bundle.q10_registration, artifact_root=repo_root)


def build_campaign(
    repo_root: Path,
    *,
    code_commit: str,
) -> tuple[dict[str, object], dict[str, object], bytes]:
    bundle = build_merged_q15_bundle(
        repo_root,
        code_commit=code_commit,
        recorded_at_ms=FIXED_TIME_MS,
    )
    with TemporaryDirectory(prefix="q15-campaign-") as temporary:  # noqa: SIM117
        with ResearchRegistryStore(Path(temporary)) as store:
            _register_bundle(store, bundle, repo_root)
            initial = store.bootstrap_research_champion(
                slot_id="transition-binary",
                model_id=bundle.q10_baseline_registration.model_id,
                model_revision=bundle.q10_baseline_registration.model_revision,
                transition_id="q15.campaign.bootstrap.v1",
                policy_revision="q15.campaign.policy.v1",
                reason="Explicit synthetic advisory research pin",
                now_ms=FIXED_TIME_MS + 1,
                artifact_root=repo_root,
            )
            batch, feedback, comparison = synthetic_shadow_records(bundle, initial)
            store.record_shadow_batch(batch)
            store.attach_delayed_feedback(feedback)
            store.record_shadow_comparison(comparison)
            mismatch_rejected = False
            try:
                store.promote_challenger(
                    slot_id=initial.slot_id,
                    candidate_model_id=bundle.q10_registration.model_id,
                    candidate_model_revision=bundle.q10_registration.model_revision,
                    transition_id="q15.campaign.q14-mismatch.v1",
                    policy_revision="q15.campaign.policy.v2",
                    evidence=mismatched_q14_binding(
                        bundle,
                        shadow_report_sha256=comparison.content_digest,
                    ),
                    reason="Q14 compared different model identities",
                    now_ms=FIXED_TIME_MS + 2,
                    expected_generation=initial.generation,
                    artifact_root=repo_root,
                )
            except RegistryConflictError as error:
                mismatch_rejected = str(error) == "VALIDATION_ARTIFACT_MISMATCH"
            start_ns = (FIXED_TIME_MS + 20) * 1_000_000
            series = ObservationSeriesV1(
                series_id="q15.campaign.residuals.v1",
                symbol="SYNTHETIC",
                posture=LakeEvidencePosture.SYNTHETIC,
                points=tuple(
                    ObservationV1(
                        event_time_ns=start_ns + index * 1_000_000,
                        ordinal=index,
                        value=FixedPointV1(value),
                        quality=QualityState.COMPLETE,
                    )
                    for index, value in enumerate((0, 0, 0, 20 * FIXED_POINT_SCALE))
                ),
            )
            alarm = evaluate_page_hinkley_drift(
                alarm_id="q15.campaign.drift.v1",
                layer=DriftLayer.RESIDUAL_ERROR,
                monitored_model_id=initial.model_id,
                monitored_model_revision=initial.model_revision,
                monitored_artifact_sha256=initial.artifact_sha256,
                monitored_generation=initial.generation,
                monitored_transition_id=initial.transition_id,
                config=PageHinkleyConfigV1(
                    detector_id="q15.page-hinkley.v1",
                    delta=FixedPointV1(0),
                    threshold_lambda=FixedPointV1(5 * FIXED_POINT_SCALE),
                    warmup=2,
                ),
                series=series,
            )
            final = store.apply_drift_alarm(
                slot_id=initial.slot_id,
                transition_id="q15.campaign.demotion.v1",
                policy_revision="q15.campaign.policy.drift.v1",
                alarm=alarm,
                expected_generation=initial.generation,
            )
            lifecycles = [
                {
                    "lifecycle": lifecycle.value,
                    "modelId": model_id,
                    "modelRevision": revision,
                }
                for model_id, revision, lifecycle in store.list_model_lifecycles()
            ]
            assert any(
                row["modelId"] == bundle.q10_registration.model_id
                and row["lifecycle"] == ModelLifecycle.SHADOW_CHALLENGER.value
                for row in lifecycles
            )
            cards: dict[str, object] = {
                "artifactManifest": bundle.artifact_manifest.as_mapping(),
                "datasetCards": [
                    bundle.dataset_card.as_mapping(),
                    bundle.q11_dataset_card.as_mapping(),
                ],
                "experimentCard": bundle.experiment_card.as_mapping(),
                "modelCards": [
                    bundle.q10_baseline_model_card.as_mapping(),
                    bundle.q10_model_card.as_mapping(),
                    bundle.q11_model_card.as_mapping(),
                ],
                "registrations": [
                    bundle.q10_baseline_registration.as_mapping(),
                    bundle.q10_registration.as_mapping(),
                    bundle.q11_registration.as_mapping(),
                ],
                "schema": "Q15RegistryCardsV1",
                "version": 1,
            }
            campaign: dict[str, object] = {
                "artifactManifestSha256": bundle.artifact_manifest.content_digest.hexdigest,
                "challengerSelfPromotedByDrift": final.model_id == bundle.q10_registration.model_id,
                "delayedFeedback": feedback.as_mapping(),
                "driftAlarm": alarm.as_mapping(),
                "feedbackSha256": feedback.content_digest.hexdigest,
                "feedbackState": store.feedback_state(batch.batch_id),
                "finalChampion": final.as_mapping(),
                "initialChampion": initial.as_mapping(),
                "lifecycles": lifecycles,
                "q14IdentityMismatchRejected": mismatch_rejected,
                "schema": "Q15RegistryCampaignV1",
                "shadowBatch": batch.as_mapping(),
                "shadowBatchSha256": batch.content_digest.hexdigest,
                "shadowComparison": comparison.as_mapping(),
                "shadowComparisonSha256": comparison.content_digest.hexdigest,
                "transitionCount": store.transition_count(initial.slot_id),
                "version": 1,
            }
    synthetic = read_verified_artifact(
        repo_root,
        bundle.artifact("q15.synthetic-promotion-report.v1"),
    )
    return cards, campaign, synthetic


def render_markdown(campaign: dict[str, object]) -> str:
    initial = campaign["initialChampion"]
    final = campaign["finalChampion"]
    if not isinstance(initial, dict) or not isinstance(final, dict):
        raise ValueError("campaign champion mappings are malformed")
    return "\n".join(
        (
            "# Q15 registry campaign",
            "",
            "Posture: `SYNTHETIC_ONLY`",
            f"Initial champion: `{initial['modelId']}` / `{initial['artifactSha256']}`",
            f"Final champion: `{final['modelId']}` / `{final['artifactSha256']}`",
            f"Final posture: `{final['posture']}`",
            f"Q14 identity mismatch rejected: `{campaign['q14IdentityMismatchRejected']}`",
            f"Delayed feedback: `{campaign['feedbackState']}`",
            "Challenger self-promoted by drift: "
            f"`{str(campaign['challengerSelfPromotedByDrift']).lower()}`",
            "",
        )
    )


def write_campaign(output_dir: Path, repo_root: Path, *, code_commit: str) -> None:
    if not isinstance(output_dir, Path) or not output_dir.is_absolute():
        raise ValueError("output_dir must be an absolute pathlib.Path")
    cards, campaign, synthetic = build_campaign(repo_root, code_commit=code_commit)
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "artifact_manifest.v1.json").write_bytes(
        canonical_json_bytes(cards["artifactManifest"])
    )
    (output_dir / "registry_cards.v1.json").write_bytes(canonical_json_bytes(cards))
    (output_dir / "registry_campaign.v1.json").write_bytes(canonical_json_bytes(campaign))
    (output_dir / "registry_campaign.v1.md").write_text(render_markdown(campaign))
    (output_dir / "synthetic_promotion_report.v1.json").write_bytes(synthetic)


def main() -> int:
    if len(sys.argv) != 4:
        raise SystemExit(
            "usage: python -m quant_edge.registry_ops.campaign OUTPUT_DIR REPO_ROOT CODE_COMMIT"
        )
    write_campaign(
        Path(sys.argv[1]).resolve(),
        Path(sys.argv[2]).resolve(),
        code_commit=sys.argv[3],
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
