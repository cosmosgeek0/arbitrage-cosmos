from __future__ import annotations

from collections.abc import Callable
from copy import deepcopy
from dataclasses import replace
from pathlib import Path
from typing import cast

import pytest

from quant_edge.canonical import canonical_json_bytes
from quant_edge.errors import ContractValueError
from quant_edge.inference.artifacts import (
    SERVING_ARTIFACTS,
    ServingArtifactError,
    ServingManifestV1,
    build_serving_manifest,
    load_manifest,
    manifest_from_mapping,
    require_manifest_matches_current,
    verify_manifest_artifacts,
)
from quant_edge.inference.contracts import ModelAvailability, ServingLineageV1
from quant_edge.inference.pipeline import PipelineResultV1, run_inference_pipeline
from quant_edge.inference.protocol import ProtocolContractV1
from quant_edge.lake.contracts import DigestV1

from .conftest import QUANT_ROOT


def test_serving_manifest_pins_exact_accepted_truth(
    serving_manifest: ServingManifestV1,
    lineage: ServingLineageV1,
) -> None:
    manifest = serving_manifest
    loaded = lineage
    assert len(manifest.artifacts) == len(SERVING_ARTIFACTS) == 32
    assert manifest.artifact("q06.feature-golden.v1").kind.value == "FEATURE_REGISTRY"
    assert manifest.artifact("q07.micro-golden.v1").kind.value == "FEATURE_REGISTRY"
    assert manifest.artifact("q16.source.inference.service.v1").media_type == "text/x-python"
    assert loaded.champion_model_id == "logistic:v1"
    assert loaded.champion_availability is ModelAvailability.UNAVAILABLE_NONLOADABLE
    assert loaded.champion_posture == "ABSTAIN_UNKNOWN"
    assert loaded.deep_gate == "FAIL_DATA_INSUFFICIENT"
    assert loaded.readiness.value == "READY_ABSTAIN_ONLY"
    assert loaded.blocking_reason_codes() == (
        "CALIBRATION_UNAVAILABLE",
        "CHAMPION_PAYLOAD_UNAVAILABLE",
        "DEEP_DATA_INSUFFICIENT",
        "REGISTRY_POSTURE_ABSTAIN_UNKNOWN",
    )


def test_committed_manifest_is_canonical_and_matches_current(
    serving_manifest: ServingManifestV1,
) -> None:
    path = QUANT_ROOT / "generated" / "q16" / "serving_manifest.v1.json"
    loaded = load_manifest(path)
    assert loaded.canonical_bytes == path.read_bytes()
    assert loaded.canonical_bytes == serving_manifest.canonical_bytes
    require_manifest_matches_current(QUANT_ROOT, loaded)
    verify_manifest_artifacts(QUANT_ROOT, loaded)


def test_manifest_rejects_unknown_fields_bad_inventory_and_unaccepted_digest(
    serving_manifest: ServingManifestV1,
) -> None:
    mapping = serving_manifest.as_mapping()
    extra = deepcopy(mapping)
    extra["extra"] = True
    with pytest.raises((ServingArtifactError, ContractValueError)):
        manifest_from_mapping(extra)
    missing = deepcopy(mapping)
    missing_rows = cast(list[dict[str, object]], missing["artifacts"])
    missing_rows.pop()
    with pytest.raises((ServingArtifactError, ContractValueError)):
        manifest_from_mapping(missing)
    forged = deepcopy(mapping)
    forged_rows = cast(list[dict[str, object]], forged["artifacts"])
    forged_rows[0]["sha256"] = "a" * 64
    with pytest.raises(ServingArtifactError, match="not accepted"):
        manifest_from_mapping(forged)


def test_manifest_file_rejects_relative_symlink_and_noncanonical(tmp_path: Path) -> None:
    with pytest.raises(ContractValueError):
        load_manifest(Path("relative.json"))
    noncanonical = tmp_path / "manifest.json"
    noncanonical.write_text('{"schema":"Q16ServingManifestV1"}')
    with pytest.raises(ServingArtifactError):
        load_manifest(noncanonical)
    target = tmp_path / "target.json"
    target.write_bytes(canonical_json_bytes({"x": 1}))
    link = tmp_path / "link.json"
    link.symlink_to(target)
    with pytest.raises(ServingArtifactError, match="regular file"):
        load_manifest(link)


def test_artifact_hash_and_symlink_fail_closed(
    serving_manifest: ServingManifestV1,
    tmp_path: Path,
) -> None:
    reference = serving_manifest.artifact("q04.replay-golden.v1")
    forged = replace(reference, sha256=DigestV1("a" * 64))
    bad_manifest = replace(
        serving_manifest,
        artifacts=tuple(
            forged if item.artifact_id == reference.artifact_id else item
            for item in serving_manifest.artifacts
        ),
    )
    with pytest.raises(ServingArtifactError):
        verify_manifest_artifacts(QUANT_ROOT, bad_manifest)
    with pytest.raises(ContractValueError):
        build_serving_manifest(Path("relative"))


def test_pipeline_is_exact_hash_chain_and_abstains(
    pipeline_result: PipelineResultV1,
    protocol: ProtocolContractV1,
) -> None:
    result = pipeline_result
    assert result.assessment["advisoryAction"] == "ABSTAIN_UNKNOWN"
    assert result.assessment["predictions"] == []
    assert result.assessment["netExpectedValue"] == {"state": "UNKNOWN"}
    champion = cast(dict[str, object], result.model_state["champion"])
    assert champion["score"] is None
    assert result.calibration_state["calibratedProbability"] is None
    assert all(
        stage.parent_digests == (() if index == 0 else (result.stages[index - 1].digest,))
        for index, stage in enumerate(result.stages)
    )
    assert len(result.assessment_sha256.hexdigest) == 64
    protocol.validate_envelope(result.evidence, maximum_bytes=262_144)
    protocol.validate_envelope(result.assessment, maximum_bytes=262_144)


def test_pipeline_features_are_owner_computed_and_available(
    pipeline_result: PipelineResultV1,
) -> None:
    features = cast(list[dict[str, object]], pipeline_result.feature_snapshot["features"])
    feature_ids = [cast(str, item["featureId"]) for item in features]
    assert feature_ids == sorted(feature_ids)
    assert len(features) == 5
    assert all(item["status"] == "AVAILABLE" for item in features)
    assert pipeline_result.feature_snapshot["modelEligibleBook"] is True


def test_pipeline_is_repeatable(
    raw_fixture: dict[str, object],
    lineage: ServingLineageV1,
    protocol: ProtocolContractV1,
) -> None:
    first = run_inference_pipeline(raw_fixture, lineage=lineage, protocol=protocol)
    second = run_inference_pipeline(deepcopy(raw_fixture), lineage=lineage, protocol=protocol)
    assert first.as_mapping() == second.as_mapping()
    assert first.assessment_sha256 == second.assessment_sha256


def test_expired_fixture_remains_valid_but_stale_and_abstaining(
    raw_fixture: dict[str, object],
    lineage: ServingLineageV1,
    protocol: ProtocolContractV1,
) -> None:
    expired = run_inference_pipeline(
        raw_fixture,
        lineage=lineage,
        protocol=protocol,
        evaluation_time_ms=1_772_000_060_201,
    )
    assert expired.assessment["advisoryAction"] == "ABSTAIN_UNKNOWN"
    reasons = cast(list[str], expired.assessment["abstentionReasonCodes"])
    assert "ASSESSMENT_EXPIRED" in reasons
    assert "SOURCE_STALE" in reasons
    quality = cast(dict[str, object], expired.assessment["sourceQuality"])
    assert quality["freshness"] == "STALE"


def test_evaluation_before_generation_is_unknown_and_abstaining(
    raw_fixture: dict[str, object],
    lineage: ServingLineageV1,
    protocol: ProtocolContractV1,
) -> None:
    early = run_inference_pipeline(
        raw_fixture,
        lineage=lineage,
        protocol=protocol,
        evaluation_time_ms=1_772_000_000_199,
    )
    quality = cast(dict[str, object], early.assessment["sourceQuality"])
    reasons = cast(list[str], early.assessment["abstentionReasonCodes"])
    assert quality["freshness"] == "UNKNOWN"
    assert "EVALUATION_PRECEDES_GENERATION" in reasons
    assert early.assessment["advisoryAction"] == "ABSTAIN_UNKNOWN"


def test_source_times_come_from_q04_truth_not_caller_cutoff(
    raw_fixture: dict[str, object],
    lineage: ServingLineageV1,
    protocol: ProtocolContractV1,
) -> None:
    result = run_inference_pipeline(raw_fixture, lineage=lineage, protocol=protocol)
    assert result.evidence["exchangeEventTimeMs"] == 1_772_000_000_009
    assert result.evidence["localReceiveTimeMs"] == 1_772_000_000_059
    assert result.evidence["featureCutoffTimeMs"] == 1_772_000_000_100

    moved = deepcopy(raw_fixture)
    moved["featureCutoffTimeMs"] = 1_773_000_000_100
    moved["generatedAtMs"] = 1_773_000_000_200
    moved["expiresAtMs"] = 1_773_000_060_200
    economics = cast(dict[str, object], moved["economicAssumptionContext"])
    economics["asOfMs"] = moved["generatedAtMs"]
    economics["expiresAtMs"] = moved["expiresAtMs"]
    stale = run_inference_pipeline(moved, lineage=lineage, protocol=protocol)
    quality = cast(dict[str, object], stale.assessment["sourceQuality"])
    assert quality["freshness"] == "STALE"
    assert "SOURCE_STALE" in cast(list[str], stale.assessment["abstentionReasonCodes"])


def test_source_time_and_economics_chain_fail_closed(
    raw_fixture: dict[str, object],
    lineage: ServingLineageV1,
    protocol: ProtocolContractV1,
) -> None:
    before_final_event = deepcopy(raw_fixture)
    before_final_event["featureCutoffTimeMs"] = 1_772_000_000_008
    economics_mismatch = deepcopy(raw_fixture)
    economics = cast(dict[str, object], economics_mismatch["economicAssumptionContext"])
    economics["asOfMs"] = 1_772_000_000_199
    for mutation in (before_final_event, economics_mismatch):
        with pytest.raises(ContractValueError):
            run_inference_pipeline(mutation, lineage=lineage, protocol=protocol)


@pytest.mark.parametrize(
    "mutator",
    [
        lambda value: value.update(schema="Q16RawInferenceFixtureV2"),
        lambda value: value.update(version=2),
        lambda value: value.update(version=True),
        lambda value: value.update(truthLabel="LIVE"),
        lambda value: value.update(featureCutoffTimeMs=value["generatedAtMs"] + 1),
        lambda value: value.update(expiresAtMs=value["generatedAtMs"]),
        lambda value: value.update(sourceFixtureSha256="bad"),
        lambda value: value.update(spotBookScript=[]),
    ],
)
def test_pipeline_rejects_malformed_or_authority_escalating_raw_fixture(
    raw_fixture: dict[str, object],
    lineage: ServingLineageV1,
    protocol: ProtocolContractV1,
    mutator: Callable[[dict[str, object]], object],
) -> None:
    value = deepcopy(raw_fixture)
    mutator(value)
    with pytest.raises(ContractValueError):
        run_inference_pipeline(value, lineage=lineage, protocol=protocol)


def test_manifest_parser_rejects_invalid_digest_type(
    serving_manifest: ServingManifestV1,
) -> None:
    mapping = serving_manifest.as_mapping()
    rows = cast(list[dict[str, object]], mapping["artifacts"])
    rows[0]["sha256"] = 7
    with pytest.raises(ServingArtifactError):
        manifest_from_mapping(mapping)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("kind", "EXPERIMENT"),
        ("mediaType", "application/octet-stream"),
        ("relativePath", "fixtures/q12_ensemble_golden_v1.json"),
        ("schemaName", "Q12EnsembleGoldenFixtureV1"),
        ("schemaVersion", 2),
        ("byteLength", 14_051),
    ],
)
def test_manifest_parser_rejects_valid_but_unaccepted_metadata(
    serving_manifest: ServingManifestV1,
    field: str,
    value: object,
) -> None:
    mapping = serving_manifest.as_mapping()
    rows = cast(list[dict[str, object]], mapping["artifacts"])
    rows[0][field] = value
    with pytest.raises(ServingArtifactError, match="metadata"):
        manifest_from_mapping(mapping)


def test_manifest_parser_rejects_forged_owner(serving_manifest: ServingManifestV1) -> None:
    mapping = serving_manifest.as_mapping()
    mapping["featureOwner"] = "forged.feature.owner"
    with pytest.raises(ServingArtifactError, match="owner"):
        manifest_from_mapping(mapping)
