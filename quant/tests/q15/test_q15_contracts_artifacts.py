from __future__ import annotations

import hashlib
from dataclasses import replace
from pathlib import Path

import pytest
from q15_fixtures import REPO_ROOT, build_bundle

from quant_edge.errors import ContractValueError
from quant_edge.lake.contracts import DigestV1
from quant_edge.registry_ops.artifacts import (
    Q10_GOLDEN_SCHEMA,
    ArtifactIntegrityError,
    read_verified_artifact,
    verify_json_artifact,
)
from quant_edge.registry_ops.bundle import (
    HYPOTHESIS_REGISTRY_SHA256,
    Q06_GOLDEN_SHA256,
    Q10_CAMPAIGN_SHA256,
    Q10_DATASET_SHA256,
    Q10_GOLDEN_SHA256,
    Q11_CAMPAIGN_SHA256,
    Q11_GOLDEN_SHA256,
    Q14_CAMPAIGN_SHA256,
    Q14_GOLDEN_SHA256,
    UV_LOCK_SHA256,
)
from quant_edge.registry_ops.contracts import (
    ArtifactKind,
    ArtifactRefV1,
    DelayedFeedbackV1,
    FeedbackState,
    PromotionGateV1,
    ShadowPredictionV1,
    mapping_digest,
)


def test_exact_merged_artifact_hashes_and_foreign_schema() -> None:
    bundle = build_bundle()
    observed = {
        item.artifact_id: item.sha256.hexdigest for item in bundle.artifact_manifest.artifacts
    }
    assert observed["q10.model-golden.v1"] == Q10_GOLDEN_SHA256
    assert observed["q10.model-campaign.v1"] == Q10_CAMPAIGN_SHA256
    assert observed["q11.survival-golden.v1"] == Q11_GOLDEN_SHA256
    assert observed["q11.survival-campaign.v1"] == Q11_CAMPAIGN_SHA256
    assert observed["q14.validation-golden.v1"] == Q14_GOLDEN_SHA256
    assert observed["q14.validation-campaign.v1"] == Q14_CAMPAIGN_SHA256
    assert observed["q01.uv-lock"] == UV_LOCK_SHA256
    assert observed["q06.feature-golden.v1"] == Q06_GOLDEN_SHA256
    assert observed["q01.edge-hypotheses.v1"] == HYPOTHESIS_REGISTRY_SHA256
    parsed = verify_json_artifact(
        REPO_ROOT,
        bundle.artifact("q10.model-golden.v1"),
        Q10_GOLDEN_SCHEMA,
    )
    assert parsed["schema"] == "Q10ModelGoldenFixtureV1"


def test_artifact_ref_rejects_traversal_absolute_uri_and_oversize() -> None:
    for path in ("../secret", "/tmp/file", "https://example.test/model", "x\\y"):
        with pytest.raises(ContractValueError):
            ArtifactRefV1(
                artifact_id="bad.v1",
                kind=ArtifactKind.MODEL_EVIDENCE,
                schema_name="BadV1",
                schema_version=1,
                relative_path=path,
                sha256=DigestV1("0" * 64),
                byte_length=1,
                media_type="application/json",
            )


def test_artifact_tamper_and_symlink_fail_closed(tmp_path: Path) -> None:
    raw = b'{"schema":"TinyV1","version":1}\n'
    source = tmp_path / "model.json"
    source.write_bytes(raw)
    reference = ArtifactRefV1(
        artifact_id="tiny.v1",
        kind=ArtifactKind.MODEL_PAYLOAD,
        schema_name="TinyV1",
        schema_version=1,
        relative_path="model.json",
        sha256=DigestV1(hashlib.sha256(raw).hexdigest()),
        byte_length=len(raw),
        media_type="application/json",
    )
    assert read_verified_artifact(tmp_path, reference) == raw
    source.write_bytes(raw + b"x")
    with pytest.raises(ArtifactIntegrityError):
        read_verified_artifact(tmp_path, reference)
    source.unlink()
    target = tmp_path / "target.json"
    target.write_bytes(raw)
    source.symlink_to(target)
    with pytest.raises(ArtifactIntegrityError):
        read_verified_artifact(tmp_path, reference)


def test_card_and_manifest_digests_are_stable_and_q10_is_not_loadable() -> None:
    left = build_bundle()
    right = build_bundle()
    assert left.artifact_manifest.content_digest == right.artifact_manifest.content_digest
    assert left.dataset_card.content_digest == right.dataset_card.content_digest
    assert left.q10_model_card.content_digest == right.q10_model_card.content_digest
    assert not left.q10_model_card.loadable_model_payload
    assert dict(left.q10_model_card.periods).keys() == {"test", "train", "validation"}
    assert dict(left.q11_model_card.periods)["validation"].startswith("UNAVAILABLE")
    assert dict(left.q10_baseline_model_card.hyperparameters) == {
        "C": "1.0",
        "maxIter": "2000",
        "solver": "lbfgs",
    }
    assert len(left.experiment_card.attempted_trial_ids) == 48
    assert len(set(left.experiment_card.attempted_trial_ids)) == 48
    assert any(Q10_DATASET_SHA256 in entry for entry in left.dataset_card.gaps_revisions_checksums)
    assert "repository license" not in str(left.dataset_card.as_mapping()).lower()
    assert (
        "Fitted model weights are not persisted" in left.q10_model_card.data_sufficiency_missingness
    )
    with pytest.raises(ContractValueError):
        replace(left.q10_model_card, loadable_model_payload=1)  # type: ignore[arg-type]


def test_promotion_gate_is_exactly_ten_boolean_gates() -> None:
    gate = PromotionGateV1(*(True for _ in range(10)))
    assert gate.all_passed
    assert len(gate.values()) == 10
    assert not replace(gate, calibration=False).all_passed
    with pytest.raises(ContractValueError):
        replace(gate, calibration=1)  # type: ignore[arg-type]


def test_shadow_score_digest_binds_the_exact_persisted_score() -> None:
    prediction = ShadowPredictionV1(
        model_id="model.v1",
        model_revision="revision.v1",
        artifact_sha256=DigestV1("1" * 64),
        output_digest=mapping_digest({"scoreMicros": "500000"}),
        score_micros=500_000,
    )
    with pytest.raises(ContractValueError, match="must bind"):
        replace(prediction, output_digest=DigestV1("0" * 64))
    feedback = DelayedFeedbackV1(
        feedback_id="feedback.v1",
        batch_id="batch.v1",
        event_id="event.v1",
        target_id="transition_binary:v1",
        horizon_ms=1_000,
        source_revision="source.v1",
        observed_at_ms=1_783_890_001_000,
        state=FeedbackState.AVAILABLE,
        outcome_digest=mapping_digest({"outcomeMicros": "1000000"}),
        outcome_micros=1_000_000,
    )
    with pytest.raises(ContractValueError, match="must bind"):
        replace(feedback, outcome_digest=DigestV1("f" * 64))
