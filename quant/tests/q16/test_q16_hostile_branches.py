from __future__ import annotations

import os
import socket
import stat
import tempfile
import threading
from copy import copy, deepcopy
from dataclasses import replace
from pathlib import Path
from typing import cast

import pytest

import quant_edge.inference.artifacts as artifact_module
import quant_edge.inference.pipeline as pipeline_module
import quant_edge.inference.transport as transport_module
from quant_edge.book.replay import run_replay, script_from_mapping
from quant_edge.canonical import canonical_json_bytes
from quant_edge.errors import ContractValueError
from quant_edge.inference.artifacts import (
    ServingArtifactError,
    ServingManifestV1,
    build_serving_manifest,
    load_manifest,
    load_serving_lineage,
    manifest_from_mapping,
    require_manifest_matches_current,
    verify_manifest_artifacts,
)
from quant_edge.inference.contracts import (
    AdmissionState,
    InferenceLimitsV1,
    LocalRequestV1,
    RequestOperation,
    ServiceCountersV1,
    ServingLineageV1,
    StageDigestV1,
)
from quant_edge.inference.generation import build_q16_artifacts, build_raw_fixture
from quant_edge.inference.pipeline import PipelineResultV1, run_inference_pipeline
from quant_edge.inference.protocol import (
    FROZEN_SCHEMA_SHA256,
    ProtocolBoundaryError,
    ProtocolContractV1,
    protocol_error,
    protocol_json_bytes,
    strict_json_object,
)
from quant_edge.inference.service import (
    AdmissionResultV1,
    LocalInferenceServiceV1,
    ServiceResponseV1,
)
from quant_edge.inference.transport import (
    LocalTransportError,
    create_loopback_server,
    create_unix_server,
)
from quant_edge.lake.contracts import DigestV1

from .conftest import QUANT_ROOT, REPO_ROOT

NOW_MS = 1_772_000_000_200


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("request_bytes", 0),
        ("response_bytes", 262_145),
        ("batch_rows", 0),
        ("symbols", 129),
        ("horizons", True),
        ("queue_capacity", 257),
        ("concurrency", 9),
        ("timeout_ms", 30_001),
    ],
)
def test_limits_reject_every_out_of_bound_dimension(field: str, value: object) -> None:
    with pytest.raises(ContractValueError):
        replace(InferenceLimitsV1(), **cast(dict[str, int], {field: value}))


def test_local_request_constructor_rejects_hostile_types() -> None:
    with pytest.raises(ContractValueError, match="operation"):
        LocalRequestV1(
            "q16.bad",
            cast(RequestOperation, "ASSESS"),
            NOW_MS,
            ({},),
        )
    with pytest.raises(ContractValueError, match="tuple"):
        LocalRequestV1(
            "q16.bad",
            RequestOperation.BATCH_ASSESS,
            NOW_MS,
            cast(tuple[dict[str, object], ...], [{}]),
        )
    with pytest.raises(ContractValueError, match="JSON objects"):
        LocalRequestV1(
            "q16.bad",
            RequestOperation.BATCH_ASSESS,
            NOW_MS,
            cast(tuple[dict[str, object], ...], ("bad",)),
        )
    with pytest.raises(ContractValueError, match="exactly one"):
        LocalRequestV1(
            "q16.bad",
            RequestOperation.ASSESS,
            NOW_MS,
            ({}, {}),
        )


def _local_mapping() -> dict[str, object]:
    return {
        "generatedAtMs": NOW_MS,
        "items": [],
        "operation": "HEALTH",
        "requestId": "q16.health",
        "schema": "Q16LocalInferenceRequestV1",
        "version": 1,
    }


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("extra", True, "schema-exact"),
        ("schema", "Q16LocalInferenceRequestV2", "unsupported"),
        ("items", "not-list", "bounded batch"),
        ("operation", 7, "must be text"),
        ("operation", "UNKNOWN", "unsupported"),
        ("requestId", 7, "must be text"),
        ("generatedAtMs", True, "must be an integer"),
    ],
)
def test_local_request_mapping_rejects_each_malformed_field(
    field: str,
    value: object,
    message: str,
) -> None:
    mapping = _local_mapping()
    mapping[field] = value
    with pytest.raises(ContractValueError, match=message):
        LocalRequestV1.from_mapping(mapping, limits=InferenceLimitsV1())
    with pytest.raises(ContractValueError, match="limits"):
        LocalRequestV1.from_mapping(
            _local_mapping(),
            limits=cast(InferenceLimitsV1, object()),
        )


def test_stage_and_counter_contracts_reject_incoherence() -> None:
    digest = DigestV1("a" * 64)
    with pytest.raises(ContractValueError, match="digest"):
        StageDigestV1("RAW", "SchemaV1", cast(DigestV1, "bad"), ())
    with pytest.raises(ContractValueError, match="bounded"):
        StageDigestV1("RAW", "SchemaV1", digest, cast(tuple[DigestV1, ...], []))
    with pytest.raises(ContractValueError, match="contain"):
        StageDigestV1("RAW", "SchemaV1", digest, cast(tuple[DigestV1, ...], ("bad",)))
    with pytest.raises(ContractValueError):
        ServiceCountersV1(accepted=-1)
    assert ServiceCountersV1(accepted=1).as_mapping(queue_depth=2)["queueDepth"] == 2


def test_serving_lineage_readiness_and_contract_branches(lineage: ServingLineageV1) -> None:
    assert lineage.readiness.value == "READY_ABSTAIN_ONLY"
    assert "CHAMPION_PAYLOAD_UNAVAILABLE" in lineage.blocking_reason_codes()
    seal_field = "identity"
    with pytest.raises(AttributeError):
        setattr(lineage._seal, seal_field, ())
    with pytest.raises(TypeError):
        replace(cast(ServingLineageV1, lineage._seal), identity=())  # type: ignore[call-arg]
    with pytest.raises(ContractValueError, match="verified accepted"):
        replace(lineage, _seal=copy(lineage._seal))
    for changes in (
        {"champion_posture": "ADVISORY"},
        {"calibration_available": True},
        {"deep_gate": "PASS"},
        {"shadow_model_ids": ("z:v1",)},
        {"dependency_lock_sha256": DigestV1("a" * 64)},
        {"manifest_sha256": DigestV1("b" * 64)},
    ):
        with pytest.raises(ContractValueError, match="verified accepted"):
            replace(lineage, **changes)
    with pytest.raises(ContractValueError, match="verified accepted"):
        ServingLineageV1(
            champion_model_id=lineage.champion_model_id,
            champion_revision=lineage.champion_revision,
            champion_posture=lineage.champion_posture,
            champion_availability=lineage.champion_availability,
            shadow_model_ids=lineage.shadow_model_ids,
            deep_gate=lineage.deep_gate,
            calibration_revision=lineage.calibration_revision,
            calibration_available=lineage.calibration_available,
            dependency_lock_sha256=lineage.dependency_lock_sha256,
            manifest_sha256=lineage.manifest_sha256,
            _seal=object(),
        )


def test_protocol_contract_cannot_be_forged(protocol: ProtocolContractV1) -> None:
    with pytest.raises(ProtocolBoundaryError, match="loaded from frozen"):
        ProtocolContractV1(
            protocol.schema_document,
            DigestV1(FROZEN_SCHEMA_SHA256),
            object(),
        )
    exposed = protocol.schema_document
    exposed["$defs"] = {}
    fixture_path = REPO_ROOT / "packages" / "edge-protocol" / "fixtures" / "fixtures-v1.json"
    fixtures = strict_json_object(fixture_path.read_bytes(), maximum_bytes=262_144)
    valid = cast(list[dict[str, object]], fixtures["valid"])
    envelope = cast(dict[str, object], valid[0]["envelope"])
    protocol.validate_envelope(envelope, maximum_bytes=262_144)


def test_every_frozen_invalid_fixture_fails_python_contract(
    protocol: ProtocolContractV1,
) -> None:
    fixture_path = REPO_ROOT / "packages" / "edge-protocol" / "fixtures" / "fixtures-v1.json"
    fixtures = strict_json_object(fixture_path.read_bytes(), maximum_bytes=262_144)
    invalid = cast(list[dict[str, object]], fixtures["invalid"])
    for row in invalid:
        envelope = cast(dict[str, object], row["envelope"])
        with pytest.raises(ProtocolBoundaryError):
            protocol.validate_envelope(envelope, maximum_bytes=262_144)


@pytest.mark.parametrize(
    "value",
    [
        {"bytes": b"bad"},
        {"set": {1}},
        {"key": {1: "bad"}},
    ],
)
def test_protocol_serializer_rejects_non_json_types(value: object) -> None:
    with pytest.raises(ProtocolBoundaryError):
        protocol_json_bytes(value)


@pytest.mark.parametrize(
    ("number", "expected"),
    [
        (0.0, b'{"n":0}'),
        (2.0, b'{"n":2}'),
        (1e-6, b'{"n":0.000001}'),
        (1e-7, b'{"n":1e-7}'),
    ],
)
def test_protocol_number_format_branches(number: float, expected: bytes) -> None:
    assert protocol_json_bytes({"n": number}) == expected


def test_protocol_rejects_unsafe_integer_valued_float() -> None:
    with pytest.raises(ProtocolBoundaryError, match="safe subset"):
        protocol_json_bytes({"n": 1e21})


def test_protocol_rejects_surrogate_keys_and_values() -> None:
    with pytest.raises(ProtocolBoundaryError, match="keys"):
        protocol_json_bytes({"\ud800": 1})
    with pytest.raises(ProtocolBoundaryError, match="strings"):
        protocol_json_bytes({"value": "\ud800"})


def test_protocol_validator_schema_subset_branches(protocol: ProtocolContractV1) -> None:
    assert protocol._validate({"anyOf": [{"type": "string"}]}, "ok", trail="$") == []
    cases: tuple[tuple[dict[str, object], object], ...] = (
        ({"$ref": 7}, "x"),
        ({"anyOf": [{"type": "string"}]}, 7),
        ({"const": "x"}, "y"),
        ({"enum": ["x"]}, "y"),
        ({"type": "string", "pattern": "^x$"}, "y"),
        ({"type": "string", "minLength": 2}, "x"),
        ({"type": "string", "maxLength": 1}, "xx"),
        ({"type": "integer", "minimum": 2}, 1),
        ({"type": "integer", "maximum": 1}, 2),
        ({"type": "array", "maxItems": 1}, [1, 2]),
        ({"type": "array", "items": {"type": "string"}}, [1]),
        ({"type": "object", "maxProperties": 0}, {"x": 1}),
        ({"type": "object", "required": ["x"]}, {}),
        ({"type": "object", "additionalProperties": False}, {"x": 1}),
        ({"type": "object", "additionalProperties": {"type": "string"}}, {"x": 1}),
    )
    for schema, value in cases:
        assert protocol._validate(schema, value, trail="$")
    with pytest.raises(ProtocolBoundaryError, match="external"):
        protocol._resolve("https://example.invalid/schema")
    with pytest.raises(ProtocolBoundaryError, match="unresolved"):
        protocol._resolve("#/$defs/DOES_NOT_EXIST")
    with pytest.raises(ProtocolBoundaryError, match="not an object"):
        protocol._resolve("#/$defs/IdString/pattern")


def test_protocol_error_rejects_empty_and_oversized_text() -> None:
    for message, stage in (("", "decode"), ("ok", ""), ("x" * 257, "decode")):
        with pytest.raises(ContractValueError, match="bounded"):
            protocol_error(
                code="REQUEST_REJECTED",
                message=message,
                occurred_at_ms=NOW_MS,
                correlation_id=None,
                stage=stage,
            )


def test_manifest_mapping_hostile_shapes(serving_manifest: ServingManifestV1) -> None:
    base = serving_manifest.as_mapping()
    mutations: list[dict[str, object]] = []
    for key, value in (
        ("schema", "OtherV1"),
        ("version", 2),
        ("version", True),
        ("posture", "LIVE"),
        ("artifacts", "bad"),
        ("featureOwner", 7),
    ):
        mutation = deepcopy(base)
        mutation[key] = value
        mutations.append(mutation)
    row_shapes: list[object] = ["bad", {"artifactId": "only"}]
    for row in row_shapes:
        mutation = deepcopy(base)
        mutation["artifacts"] = [row]
        mutations.append(mutation)
    for mutation in mutations:
        with pytest.raises((ServingArtifactError, ContractValueError)):
            manifest_from_mapping(mutation)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("kind", "NOPE"),
        ("sha256", "bad"),
        ("artifactId", 7),
        ("byteLength", True),
        ("schemaVersion", True),
        ("relativePath", "../escape"),
    ],
)
def test_manifest_artifact_row_rejects_bad_field(
    serving_manifest: ServingManifestV1,
    field: str,
    value: object,
) -> None:
    mapping = serving_manifest.as_mapping()
    rows = cast(list[dict[str, object]], mapping["artifacts"])
    rows[0][field] = value
    with pytest.raises((ServingArtifactError, ContractValueError)):
        manifest_from_mapping(mapping)


def test_manifest_lookup_and_missing_file_fail_closed(serving_manifest: ServingManifestV1) -> None:
    with pytest.raises(ServingArtifactError, match="absent"):
        serving_manifest.artifact("missing:v1")
    with pytest.raises(ServingArtifactError, match="regular file"):
        load_manifest(Path("/tmp/q16-definitely-missing.json"))


def test_manifest_builder_rejects_missing_empty_tampered_and_unsafe_paths(
    tmp_path: Path,
) -> None:
    with pytest.raises(ServingArtifactError, match="unavailable"):
        build_serving_manifest(tmp_path)
    q04 = tmp_path / "fixtures" / "q04_replay_golden_v1.json"
    q04.parent.mkdir()
    q04.write_bytes(b"")
    with pytest.raises(ServingArtifactError, match="empty"):
        build_serving_manifest(tmp_path)
    q04.write_bytes(b"tampered")
    with pytest.raises(ServingArtifactError, match="accepted digest"):
        build_serving_manifest(tmp_path)
    for relative in ("/absolute", "../escape", "bad\\path", "https://remote"):
        with pytest.raises(ServingArtifactError, match="safe relative"):
            artifact_module._safe_path(tmp_path, relative)


def test_manifest_verification_and_current_match_hostile_paths(
    serving_manifest: ServingManifestV1,
) -> None:
    with pytest.raises(ContractValueError, match="absolute"):
        verify_manifest_artifacts(Path("relative"), serving_manifest)
    changed = replace(serving_manifest, feature_owner="other.owner")
    with pytest.raises(ServingArtifactError, match="does not match"):
        require_manifest_matches_current(QUANT_ROOT, changed)
    q15 = serving_manifest.artifact("q15.registry-cards.v1")
    non_json = replace(q15, media_type="text/plain")
    bad = replace(
        serving_manifest,
        artifacts=tuple(non_json if row is q15 else row for row in serving_manifest.artifacts),
    )
    with pytest.raises(ServingArtifactError, match="does not match"):
        load_serving_lineage(QUANT_ROOT, bad)


def test_verified_artifact_body_rejects_boolean_version(
    monkeypatch: pytest.MonkeyPatch,
    serving_manifest: ServingManifestV1,
) -> None:
    reference = serving_manifest.artifact("q15.registry-campaign.v1")

    def boolean_version(_root: Path, _reference: object) -> bytes:
        return canonical_json_bytes({"schema": reference.schema_name, "version": True})

    monkeypatch.setattr(artifact_module, "read_verified_artifact", boolean_version)
    with pytest.raises(ServingArtifactError, match="schema/version"):
        artifact_module._verified_json(
            QUANT_ROOT,
            serving_manifest,
            reference.artifact_id,
        )


@pytest.mark.parametrize(
    ("artifact_id", "mutation", "message"),
    [
        ("q15.registry-campaign.v1", {"finalChampion": None}, "lifecycle"),
        ("q15.registry-campaign.v1", {"finalChampion": {}}, "identity"),
        ("q15.registry-cards.v1", {"modelCards": []}, "exactly one"),
        (
            "q15.registry-cards.v1",
            {"modelCards.0.loadableModelPayload": "bad"},
            "loadability",
        ),
        ("q15.registry-campaign.v1", {"lifecycles": []}, "shadow inventory"),
        ("q13.data-sufficiency.v1", {"status": "PASS"}, "deep gate"),
        ("q12.ensemble-golden.v1", {"calibration": None}, "calibration lineage"),
    ],
)
def test_serving_lineage_semantic_substitution_fails_closed(
    monkeypatch: pytest.MonkeyPatch,
    serving_manifest: ServingManifestV1,
    artifact_id: str,
    mutation: dict[str, object],
    message: str,
) -> None:
    original = artifact_module._verified_json

    def fake(
        quant_root: Path,
        manifest: ServingManifestV1,
        requested_id: str,
    ) -> dict[str, object]:
        value = deepcopy(original(quant_root, manifest, requested_id))
        if requested_id != artifact_id:
            return value
        for path, replacement in mutation.items():
            if path == "modelCards.0.loadableModelPayload":
                cards = cast(list[dict[str, object]], value["modelCards"])
                cards[0]["loadableModelPayload"] = replacement
            else:
                value[path] = replacement
        return value

    monkeypatch.setattr(artifact_module, "_verified_json", fake)
    with pytest.raises(ServingArtifactError, match=message):
        load_serving_lineage(QUANT_ROOT, serving_manifest)


def test_service_contract_hostile_branches(
    service: LocalInferenceServiceV1,
    lineage: ServingLineageV1,
    protocol: ProtocolContractV1,
) -> None:
    with pytest.raises(ContractValueError, match="state"):
        AdmissionResultV1(cast(object, "bad"), "q16", 0)  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="request_id"):
        AdmissionResultV1(AdmissionState.ENQUEUED, "", 0)
    with pytest.raises(ContractValueError, match="queue_depth"):
        AdmissionResultV1(AdmissionState.ENQUEUED, "q16", cast(int, "bad"))
    with pytest.raises(ContractValueError, match="limits"):
        LocalInferenceServiceV1(
            limits=cast(InferenceLimitsV1, object()),
            lineage=lineage,
            protocol=protocol,
        )
    with pytest.raises(ContractValueError, match="lineage"):
        LocalInferenceServiceV1(
            limits=InferenceLimitsV1(),
            lineage=cast(ServingLineageV1, object()),
            protocol=protocol,
        )
    with pytest.raises(ContractValueError, match="protocol"):
        LocalInferenceServiceV1(
            limits=InferenceLimitsV1(),
            lineage=lineage,
            protocol=cast(ProtocolContractV1, object()),
        )
    response = ServiceResponseV1("q16", RequestOperation.HEALTH, NOW_MS, {"ok": True})
    assert response.as_mapping()["payload"] == {"ok": True}
    admission = AdmissionResultV1(AdmissionState.ENQUEUED, "q16", 1)
    assert admission.as_mapping()["queueDepth"] == 1
    with pytest.raises(ContractValueError, match="transport failure"):
        service.record_transport_failure(code="UNKNOWN")
    with pytest.raises(ContractValueError, match="request"):
        service.handle_request(cast(LocalRequestV1, object()), evaluation_time_ms=NOW_MS)


def test_closed_service_wire_state_is_distinct_from_saturation(
    service: LocalInferenceServiceV1,
) -> None:
    service.close()
    response = service.handle_request(
        LocalRequestV1("q16.closed", RequestOperation.HEALTH, NOW_MS),
        evaluation_time_ms=NOW_MS,
    )
    assert isinstance(response, dict)
    assert response["code"] == "SERVICE_CLOSED"
    assert response["retryable"] is False


def test_bounded_queue_wait_times_out_without_cross_request_response(
    monkeypatch: pytest.MonkeyPatch,
    raw_fixture: dict[str, object],
    lineage: ServingLineageV1,
    protocol: ProtocolContractV1,
) -> None:
    service = LocalInferenceServiceV1(
        limits=InferenceLimitsV1(queue_capacity=1, timeout_ms=1),
        lineage=lineage,
        protocol=protocol,
    )
    entered = threading.Event()
    release = threading.Event()
    original = LocalInferenceServiceV1._assess

    def blocking_assess(
        self: LocalInferenceServiceV1,
        item: dict[str, object],
        *,
        evaluation_time_ms: int,
    ) -> PipelineResultV1:
        entered.set()
        assert release.wait(timeout=1)
        return original(self, item, evaluation_time_ms=evaluation_time_ms)

    monkeypatch.setattr(LocalInferenceServiceV1, "_assess", blocking_assess)
    first_response: list[ServiceResponseV1 | dict[str, object]] = []
    first = LocalRequestV1("q16.timeout.first", RequestOperation.ASSESS, NOW_MS, (raw_fixture,))
    thread = threading.Thread(
        target=lambda: first_response.append(
            service.handle_request(first, evaluation_time_ms=NOW_MS)
        )
    )
    thread.start()
    assert entered.wait(timeout=1)
    thread.join(timeout=0.2)
    assert not thread.is_alive()
    assert isinstance(first_response[0], dict)
    assert first_response[0]["code"] == "REQUEST_TIMEOUT"
    timed_out = service.handle_request(
        LocalRequestV1("q16.timeout.second", RequestOperation.HEALTH, NOW_MS),
        evaluation_time_ms=NOW_MS,
    )
    assert isinstance(timed_out, dict)
    assert timed_out["code"] == "REQUEST_TIMEOUT"
    release.set()
    for _ in range(1_000):
        if service.queue_depth == 0:
            break
        threading.Event().wait(0.001)
    assert service.counters.timeouts == 2


def test_waiting_request_observes_shutdown_before_processing(
    monkeypatch: pytest.MonkeyPatch,
    raw_fixture: dict[str, object],
    lineage: ServingLineageV1,
    protocol: ProtocolContractV1,
) -> None:
    service = LocalInferenceServiceV1(
        limits=InferenceLimitsV1(queue_capacity=1, timeout_ms=1_000),
        lineage=lineage,
        protocol=protocol,
    )
    entered = threading.Event()
    release = threading.Event()
    original = LocalInferenceServiceV1._assess

    def blocking_assess(
        self: LocalInferenceServiceV1,
        item: dict[str, object],
        *,
        evaluation_time_ms: int,
    ) -> PipelineResultV1:
        entered.set()
        assert release.wait(timeout=1)
        return original(self, item, evaluation_time_ms=evaluation_time_ms)

    monkeypatch.setattr(LocalInferenceServiceV1, "_assess", blocking_assess)
    responses: dict[str, ServiceResponseV1 | dict[str, object]] = {}
    first = LocalRequestV1("q16.close.first", RequestOperation.ASSESS, NOW_MS, (raw_fixture,))
    second = LocalRequestV1("q16.close.second", RequestOperation.HEALTH, NOW_MS)
    thread_one = threading.Thread(
        target=lambda: responses.update(
            first=service.handle_request(first, evaluation_time_ms=NOW_MS)
        )
    )
    thread_two = threading.Thread(
        target=lambda: responses.update(
            second=service.handle_request(second, evaluation_time_ms=NOW_MS)
        )
    )
    thread_one.start()
    assert entered.wait(timeout=1)
    thread_two.start()
    for _ in range(1_000):
        if service.queue_depth == 1:
            break
        threading.Event().wait(0.001)
    service.close()
    release.set()
    thread_one.join(timeout=2)
    thread_two.join(timeout=2)
    second_response = responses["second"]
    assert isinstance(second_response, dict)
    assert second_response["code"] == "SERVICE_CLOSED"


def test_bounded_wire_error_cannot_exceed_response_limit(
    lineage: ServingLineageV1,
    protocol: ProtocolContractV1,
) -> None:
    service = LocalInferenceServiceV1(
        limits=InferenceLimitsV1(response_bytes=32),
        lineage=lineage,
        protocol=protocol,
    )
    with pytest.raises(ProtocolBoundaryError, match="bounded error"):
        service.handle_bytes(b"bad", fallback_now_ms=NOW_MS)


def test_handle_request_response_limit(
    lineage: ServingLineageV1,
    protocol: ProtocolContractV1,
) -> None:
    tiny = LocalInferenceServiceV1(
        limits=InferenceLimitsV1(response_bytes=32),
        lineage=lineage,
        protocol=protocol,
    )
    with pytest.raises(ProtocolBoundaryError):
        tiny.handle_request(
            LocalRequestV1("q16.health", RequestOperation.HEALTH, NOW_MS),
            evaluation_time_ms=NOW_MS,
        )
    assert tiny.counters.completed == 0


def test_valid_wire_request_and_metrics_error_count(
    service: LocalInferenceServiceV1,
) -> None:
    request = LocalRequestV1("q16.health", RequestOperation.HEALTH, NOW_MS)
    response = strict_json_object(
        service.handle_bytes(protocol_json_bytes(request.as_mapping()), fallback_now_ms=NOW_MS),
        maximum_bytes=262_144,
    )
    assert response["operation"] == "HEALTH"
    service.handle_bytes(b"bad", fallback_now_ms=NOW_MS)
    metrics_request = LocalRequestV1("q16.metrics", RequestOperation.METRICS, NOW_MS)
    metrics_response = service.handle_request(metrics_request, evaluation_time_ms=NOW_MS)
    assert isinstance(metrics_response, ServiceResponseV1)
    metrics = cast(dict[str, object], metrics_response.payload)
    assert metrics["protocolErrors"] == 1


def test_service_correlates_concurrent_requests_and_applies_real_backpressure(
    monkeypatch: pytest.MonkeyPatch,
    raw_fixture: dict[str, object],
    lineage: ServingLineageV1,
    protocol: ProtocolContractV1,
) -> None:
    service = LocalInferenceServiceV1(
        limits=InferenceLimitsV1(queue_capacity=1, timeout_ms=1_000),
        lineage=lineage,
        protocol=protocol,
    )
    entered = threading.Event()
    release = threading.Event()
    original = LocalInferenceServiceV1._assess

    def blocking_assess(
        self: LocalInferenceServiceV1,
        item: dict[str, object],
        *,
        evaluation_time_ms: int,
    ) -> PipelineResultV1:
        entered.set()
        assert release.wait(timeout=1)
        return original(self, item, evaluation_time_ms=evaluation_time_ms)

    monkeypatch.setattr(LocalInferenceServiceV1, "_assess", blocking_assess)
    responses: dict[str, ServiceResponseV1 | dict[str, object]] = {}

    def invoke(name: str, request: LocalRequestV1) -> None:
        responses[name] = service.handle_request(request, evaluation_time_ms=NOW_MS)

    first = LocalRequestV1(
        "q16.concurrent.first",
        RequestOperation.ASSESS,
        NOW_MS,
        (raw_fixture,),
    )
    second = LocalRequestV1("q16.concurrent.second", RequestOperation.HEALTH, NOW_MS)
    thread_one = threading.Thread(target=invoke, args=("first", first))
    thread_two = threading.Thread(target=invoke, args=("second", second))
    thread_one.start()
    assert entered.wait(timeout=1)
    thread_two.start()
    for _ in range(1_000):
        if service.queue_depth == 1:
            break
        threading.Event().wait(0.001)
    assert service.queue_depth == 1
    third = service.handle_request(
        LocalRequestV1("q16.concurrent.third", RequestOperation.HEALTH, NOW_MS),
        evaluation_time_ms=NOW_MS,
    )
    assert isinstance(third, dict)
    assert third["code"] == "QUEUE_FULL"
    release.set()
    thread_one.join(timeout=2)
    thread_two.join(timeout=2)
    assert not thread_one.is_alive()
    assert not thread_two.is_alive()
    first_response = responses["first"]
    second_response = responses["second"]
    assert isinstance(first_response, ServiceResponseV1)
    assert isinstance(second_response, ServiceResponseV1)
    assert first_response.request_id == first.request_id
    assert second_response.request_id == second.request_id


def test_wire_assessment_uses_trusted_server_time(
    service: LocalInferenceServiceV1,
    raw_fixture: dict[str, object],
) -> None:
    request = LocalRequestV1(
        "q16.trusted-time",
        RequestOperation.ASSESS,
        NOW_MS,
        (raw_fixture,),
    )
    trusted_after_expiry = 1_772_000_060_201
    response = strict_json_object(
        service.handle_bytes(
            canonical_json_bytes(request.as_mapping()).rstrip(b"\n"),
            fallback_now_ms=trusted_after_expiry,
        ),
        maximum_bytes=262_144,
    )
    assert response["generatedAtMs"] == trusted_after_expiry
    payload = cast(dict[str, object], response["payload"])
    assert payload["advisoryAction"] == "ABSTAIN_UNKNOWN"
    assert "ASSESSMENT_EXPIRED" in cast(list[str], payload["abstentionReasonCodes"])


def test_uds_transport_exercises_application_backpressure(
    monkeypatch: pytest.MonkeyPatch,
    raw_fixture: dict[str, object],
    lineage: ServingLineageV1,
    protocol: ProtocolContractV1,
) -> None:
    service = LocalInferenceServiceV1(
        limits=InferenceLimitsV1(queue_capacity=1, timeout_ms=1_000),
        lineage=lineage,
        protocol=protocol,
    )
    entered = threading.Event()
    release = threading.Event()
    original = LocalInferenceServiceV1._assess

    def blocking_assess(
        self: LocalInferenceServiceV1,
        item: dict[str, object],
        *,
        evaluation_time_ms: int,
    ) -> PipelineResultV1:
        entered.set()
        assert release.wait(timeout=1)
        return original(self, item, evaluation_time_ms=evaluation_time_ms)

    monkeypatch.setattr(LocalInferenceServiceV1, "_assess", blocking_assess)
    with tempfile.TemporaryDirectory(prefix="q16-", dir="/tmp") as directory:
        socket_path = Path(directory) / "q16.sock"
        handle = create_unix_server(path=socket_path, service=service, fallback_now_ms=NOW_MS)
        server_thread = threading.Thread(target=handle.server.serve_forever)
        server_thread.start()
        for _ in range(1_000):
            if cast(transport_module._LifecycleMixin, handle.server).q16_serving:
                break
            threading.Event().wait(0.001)
        assert cast(transport_module._LifecycleMixin, handle.server).q16_serving
        clients = [socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) for _ in range(3)]
        for client in clients:
            client.settimeout(2)
        assess = LocalRequestV1(
            "q16.uds.first",
            RequestOperation.ASSESS,
            NOW_MS,
            (raw_fixture,),
        )
        health_two = LocalRequestV1("q16.uds.second", RequestOperation.HEALTH, NOW_MS)
        health_three = LocalRequestV1("q16.uds.third", RequestOperation.HEALTH, NOW_MS)
        clients[0].connect(str(socket_path))
        clients[0].sendall(canonical_json_bytes(assess.as_mapping()))
        assert entered.wait(timeout=1)
        clients[1].connect(str(socket_path))
        clients[1].sendall(protocol_json_bytes(health_two.as_mapping()) + b"\n")
        for _ in range(1_000):
            if service.queue_depth == 1:
                break
            threading.Event().wait(0.001)
        clients[2].connect(str(socket_path))
        clients[2].sendall(protocol_json_bytes(health_three.as_mapping()) + b"\n")
        third = strict_json_object(
            clients[2].makefile("rb").readline(262_145).rstrip(b"\n"),
            maximum_bytes=262_144,
        )
        assert third["code"] == "QUEUE_FULL"
        release.set()
        first = strict_json_object(
            clients[0].makefile("rb").readline(262_145).rstrip(b"\n"),
            maximum_bytes=262_144,
        )
        second = strict_json_object(
            clients[1].makefile("rb").readline(262_145).rstrip(b"\n"),
            maximum_bytes=262_144,
        )
        assert first["requestId"] == "q16.uds.first"
        assert second["requestId"] == "q16.uds.second"
        for client in clients:
            client.close()
        handle.close()
        server_thread.join(timeout=2)
        assert not server_thread.is_alive()


def test_transport_rejects_bad_types_paths_ports_and_service(
    service: LocalInferenceServiceV1,
) -> None:
    with pytest.raises(ContractValueError, match="types"):
        create_unix_server(
            path=cast(Path, "bad"),
            service=service,
            fallback_now_ms=NOW_MS,
        )
    with pytest.raises(LocalTransportError, match="absolute"):
        create_unix_server(
            path=Path("relative.sock"),
            service=service,
            fallback_now_ms=NOW_MS,
        )
    for port in (-1, 65_536, True):
        with pytest.raises(ContractValueError, match="port"):
            create_loopback_server(
                host="127.0.0.1",
                port=port,
                service=service,
                fallback_now_ms=NOW_MS,
            )
    with pytest.raises(ContractValueError, match="service"):
        create_loopback_server(
            host="127.0.0.1",
            port=0,
            service=cast(LocalInferenceServiceV1, object()),
            fallback_now_ms=NOW_MS,
        )


def test_transport_silent_close_for_unframed_request(service: LocalInferenceServiceV1) -> None:
    with tempfile.TemporaryDirectory(prefix="q16-", dir="/tmp") as directory:
        socket_path = Path(directory) / "q16.sock"
        handle = create_unix_server(path=socket_path, service=service, fallback_now_ms=NOW_MS)
        thread = threading.Thread(target=handle.server.serve_forever, daemon=True)
        thread.start()
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            client.connect(str(socket_path))
            client.sendall(b"{}")
            client.shutdown(socket.SHUT_WR)
            assert client.recv(1) == b""
        handle.server.shutdown()
        thread.join(timeout=2)
        handle.close()


def test_server_handle_refuses_replaced_socket_cleanup(
    service: LocalInferenceServiceV1,
) -> None:
    with tempfile.TemporaryDirectory(prefix="q16-", dir="/tmp") as directory:
        socket_path = Path(directory) / "q16.sock"
        handle = create_unix_server(path=socket_path, service=service, fallback_now_ms=NOW_MS)
        handle.server.server_close()
        socket_path.unlink()
        socket_path.write_text("replacement")
        with pytest.raises(LocalTransportError, match="changed"):
            handle.close()
        socket_path.unlink()


def test_server_handle_context_manager_closes_loopback(service: LocalInferenceServiceV1) -> None:
    with create_loopback_server(
        host="127.0.0.1",
        port=0,
        service=service,
        fallback_now_ms=NOW_MS,
    ) as handle:
        assert handle.service.closed is False
    assert service.closed is True


def test_uds_parent_creation_symlink_rejection_and_missing_socket_cleanup(
    service: LocalInferenceServiceV1,
) -> None:
    with tempfile.TemporaryDirectory(prefix="q16-", dir="/tmp") as directory:
        root = Path(directory)
        socket_path = root / "new-private" / "q16.sock"
        handle = create_unix_server(path=socket_path, service=service, fallback_now_ms=NOW_MS)
        assert stat.S_IMODE(socket_path.parent.stat().st_mode) == 0o700
        handle.server.server_close()
        socket_path.unlink()
        handle.close()
        target = root / "target"
        target.mkdir(mode=0o700)
        link = root / "link"
        link.symlink_to(target)
        with pytest.raises(LocalTransportError, match="real directory"):
            create_unix_server(
                path=link / "q16.sock",
                service=service,
                fallback_now_ms=NOW_MS,
            )


def test_uds_bind_activation_and_permission_failures_cleanup(
    monkeypatch: pytest.MonkeyPatch,
    service: LocalInferenceServiceV1,
) -> None:
    with tempfile.TemporaryDirectory(prefix="q16-", dir="/tmp") as directory:
        root = Path(directory)

        def fail_bind(_server: object) -> None:
            raise OSError("bind failed")

        monkeypatch.setattr(transport_module._UnixServer, "server_bind", fail_bind)
        with pytest.raises(LocalTransportError, match="could not bind"):
            create_unix_server(
                path=root / "bind.sock",
                service=service,
                fallback_now_ms=NOW_MS,
            )
        monkeypatch.undo()

        def fail_activate(_server: object) -> None:
            raise OSError("activate failed")

        monkeypatch.setattr(transport_module._UnixServer, "server_activate", fail_activate)
        activation_path = root / "activate.sock"
        with pytest.raises(LocalTransportError, match="could not bind"):
            create_unix_server(
                path=activation_path,
                service=service,
                fallback_now_ms=NOW_MS,
            )
        assert not activation_path.exists()
        monkeypatch.undo()

        monkeypatch.setattr(os, "chmod", lambda _path, _mode: None)
        mode_path = root / "mode.sock"
        with pytest.raises(LocalTransportError, match="mode 0600"):
            create_unix_server(
                path=mode_path,
                service=service,
                fallback_now_ms=NOW_MS,
            )
        assert not mode_path.exists()


def test_uds_failed_bind_preserves_foreign_race_winner(
    monkeypatch: pytest.MonkeyPatch,
    service: LocalInferenceServiceV1,
) -> None:
    with tempfile.TemporaryDirectory(prefix="q16-", dir="/tmp") as directory:
        socket_path = Path(directory) / "race.sock"
        foreign = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)

        def bind_foreign_then_fail(_server: object) -> None:
            foreign.bind(str(socket_path))
            raise OSError("lost bind race")

        monkeypatch.setattr(transport_module._UnixServer, "server_bind", bind_foreign_then_fail)
        with pytest.raises(LocalTransportError, match="could not bind"):
            create_unix_server(
                path=socket_path,
                service=service,
                fallback_now_ms=NOW_MS,
            )
        assert socket_path.exists()
        assert stat.S_ISSOCK(socket_path.lstat().st_mode)
        foreign.close()
        socket_path.unlink()


def test_handle_close_stops_owned_serve_forever_and_closes_service(
    service: LocalInferenceServiceV1,
) -> None:
    with tempfile.TemporaryDirectory(prefix="q16-", dir="/tmp") as directory:
        socket_path = Path(directory) / "q16.sock"
        handle = create_unix_server(path=socket_path, service=service, fallback_now_ms=NOW_MS)
        thread = threading.Thread(target=handle.server.serve_forever)
        thread.start()
        for _ in range(1_000):
            if cast(transport_module._LifecycleMixin, handle.server).q16_serving:
                break
            threading.Event().wait(0.001)
        assert cast(transport_module._LifecycleMixin, handle.server).q16_serving
        handle.close()
        thread.join(timeout=2)
        assert not thread.is_alive()
        assert service.closed is True
        assert not socket_path.exists()


def test_loopback_bind_failure_is_structured(
    monkeypatch: pytest.MonkeyPatch,
    service: LocalInferenceServiceV1,
) -> None:
    def fail_bind(_server: object) -> None:
        raise OSError("bind failed")

    monkeypatch.setattr(transport_module._Tcp4Server, "server_bind", fail_bind)
    with pytest.raises(LocalTransportError, match="could not bind"):
        create_loopback_server(
            host="127.0.0.1",
            port=0,
            service=service,
            fallback_now_ms=NOW_MS,
        )


def test_uds_idle_client_times_out_without_response(
    lineage: ServingLineageV1,
    protocol: ProtocolContractV1,
) -> None:
    service = LocalInferenceServiceV1(
        limits=InferenceLimitsV1(timeout_ms=1),
        lineage=lineage,
        protocol=protocol,
    )
    with tempfile.TemporaryDirectory(prefix="q16-", dir="/tmp") as directory:
        socket_path = Path(directory) / "q16.sock"
        handle = create_unix_server(path=socket_path, service=service, fallback_now_ms=NOW_MS)
        thread = threading.Thread(target=handle.server.serve_forever, daemon=True)
        thread.start()
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            client.settimeout(1)
            client.connect(str(socket_path))
            assert client.recv(1) == b""
        handle.server.shutdown()
        thread.join(timeout=2)
        handle.close()


def test_uds_preframe_handler_threads_are_bounded(
    lineage: ServingLineageV1,
    protocol: ProtocolContractV1,
) -> None:
    service = LocalInferenceServiceV1(
        limits=InferenceLimitsV1(queue_capacity=1, timeout_ms=500),
        lineage=lineage,
        protocol=protocol,
    )
    with tempfile.TemporaryDirectory(prefix="q16-", dir="/tmp") as directory:
        socket_path = Path(directory) / "q16.sock"
        handle = create_unix_server(path=socket_path, service=service, fallback_now_ms=NOW_MS)
        server_thread = threading.Thread(target=handle.server.serve_forever)
        server_thread.start()
        clients: list[socket.socket] = []
        for _ in range(10):
            client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            client.settimeout(1)
            try:
                client.connect(str(socket_path))
                clients.append(client)
            except ConnectionRefusedError:
                client.close()
            threading.Event().wait(0.002)
        for _ in range(1_000):
            server = cast(transport_module._ThreadedLifecycleMixin, handle.server)
            if service.counters.queue_rejections > 0:
                break
            threading.Event().wait(0.001)
        assert server.active_handler_count <= 3
        assert service.counters.queue_rejections > 0
        for client in clients:
            client.close()
        handle.close()
        server_thread.join(timeout=2)
        assert not server_thread.is_alive()


def test_pipeline_result_and_entrypoint_reject_hostile_types(
    pipeline_result: PipelineResultV1,
    raw_fixture: dict[str, object],
    lineage: ServingLineageV1,
    protocol: ProtocolContractV1,
) -> None:
    with pytest.raises(ContractValueError, match="mappings"):
        replace(pipeline_result, evidence=cast(dict[str, object], "bad"))
    with pytest.raises(ContractValueError, match="six-stage"):
        replace(pipeline_result, stages=())
    with pytest.raises(ContractValueError, match="order"):
        replace(pipeline_result, stages=tuple(reversed(pipeline_result.stages)))
    with pytest.raises(ContractValueError, match="raw_fixture"):
        run_inference_pipeline(
            cast(dict[str, object], "bad"),
            lineage=lineage,
            protocol=protocol,
        )
    with pytest.raises(ContractValueError, match="lineage"):
        run_inference_pipeline(
            raw_fixture,
            lineage=cast(ServingLineageV1, object()),
            protocol=protocol,
        )
    with pytest.raises(ContractValueError, match="protocol"):
        run_inference_pipeline(
            raw_fixture,
            lineage=lineage,
            protocol=cast(ProtocolContractV1, object()),
        )
    with pytest.raises(ContractValueError, match="evaluation_time_ms"):
        run_inference_pipeline(
            raw_fixture,
            lineage=lineage,
            protocol=protocol,
            evaluation_time_ms=True,
        )


def test_raw_fixture_rejects_integer_economics_and_script_substitution(
    raw_fixture: dict[str, object],
    lineage: ServingLineageV1,
    protocol: ProtocolContractV1,
) -> None:
    mutations = []
    non_integer = deepcopy(raw_fixture)
    non_integer["generatedAtMs"] = "bad"
    mutations.append(non_integer)
    bad_economics = deepcopy(raw_fixture)
    bad_economics["economicAssumptionContext"] = []
    mutations.append(bad_economics)
    bad_script = deepcopy(raw_fixture)
    script = cast(dict[str, object], bad_script["spotBookScript"])
    script["steps"] = cast(list[object], script["steps"])[:-1]
    mutations.append(bad_script)
    for mutation in mutations:
        with pytest.raises(ContractValueError):
            run_inference_pipeline(mutation, lineage=lineage, protocol=protocol)


@pytest.mark.parametrize(
    "steps",
    [
        "bad",
        ["bad"],
        [{"delta": {"eventTimeMs": True, "receive": {"receiveWallTimeMs": 2}}}],
        [{"delta": {"eventTimeMs": 1, "receive": "bad"}}],
        [{"delta": {"eventTimeMs": 1, "receive": {"receiveWallTimeMs": True}}}],
        [{"snapshot": {"provenance": "bad"}}],
        [{"snapshot": {"provenance": {"acquiredWallTimeMs": True}}}],
        [],
        [
            {"delta": {"eventTimeMs": 3, "receive": {"receiveWallTimeMs": 2}}},
        ],
    ],
)
def test_source_time_extraction_rejects_every_malformed_branch(steps: object) -> None:
    raw = {
        "featureCutoffTimeMs": 4,
        "generatedAtMs": 5,
        "spotBookScript": {"steps": steps},
    }
    with pytest.raises(ContractValueError):
        pipeline_module._source_times(raw)


def test_feature_projection_rejects_one_sided_book(pipeline_result: PipelineResultV1) -> None:
    raw = pipeline_result.raw_fixture
    script = script_from_mapping(cast(dict[str, object], raw["spotBookScript"]))
    result = run_replay(script)
    empty_view = replace(result.final_view, bids=())
    with pytest.raises(ContractValueError, match="two-sided"):
        pipeline_module._feature_values(
            replace(result, final_view=empty_view),
            cutoff_ms=NOW_MS,
            input_event_ms=NOW_MS,
        )


def test_generation_entrypoints_reject_bad_roots_and_malformed_q04(tmp_path: Path) -> None:
    with pytest.raises(ContractValueError, match="absolute"):
        build_raw_fixture(Path("relative"))
    with pytest.raises(ContractValueError, match="absolute"):
        build_q16_artifacts(Path("relative"))
    fixture = tmp_path / "fixtures" / "q04_replay_golden_v1.json"
    fixture.parent.mkdir()
    fixture.write_bytes(canonical_json_bytes({"schema": "Q04ReplayGoldenFixtureV1"}))
    with pytest.raises(ContractValueError, match="malformed"):
        build_raw_fixture(tmp_path)
