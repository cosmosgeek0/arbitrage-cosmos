from __future__ import annotations

import hashlib
import os
import signal
import socket
import stat
import struct
import tempfile
import threading
from collections.abc import Iterator
from contextlib import suppress
from copy import copy, deepcopy
from dataclasses import replace
from multiprocessing import get_context
from multiprocessing.connection import Connection
from multiprocessing.context import SpawnContext
from multiprocessing.process import BaseProcess
from pathlib import Path
from time import monotonic
from typing import Any, SupportsIndex, cast

import pytest

import quant_edge.inference.artifacts as artifact_module
import quant_edge.inference.pipeline as pipeline_module
import quant_edge.inference.service as service_module
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
_HOSTILE_WORKER_HEADER = struct.Struct("!4sBBH32sI32s4x")


class _NonCooperativeFixture(dict[str, object]):
    """Valid request container whose first pipeline read never cooperates."""

    def __init__(
        self,
        value: dict[str, object],
        *,
        entered: Path,
    ) -> None:
        super().__init__(value)
        self._entered = entered

    def __reduce_ex__(self, protocol: SupportsIndex) -> tuple[Any, ...]:
        del protocol
        return (_restore_non_cooperative_fixture, (dict.copy(self), self._entered))

    def __iter__(self) -> Iterator[str]:
        self._entered.write_text(f"{os.getpid()}\n", encoding="utf-8")
        threading.Event().wait()
        return super().__iter__()


def _restore_non_cooperative_fixture(
    value: dict[str, object],
    entered: Path,
) -> _NonCooperativeFixture:
    return _NonCooperativeFixture(value, entered=entered)


def _wait_for_path(path: Path, *, timeout: float) -> bool:
    deadline = monotonic() + timeout
    waiter = threading.Event()
    while monotonic() < deadline:
        if path.exists():
            return True
        waiter.wait(0.001)
    return path.exists()


def _emit_partial_worker_frame(
    connection: Connection,
    request: LocalRequestV1,
    evaluation_time_ms: int,
    lineage: ServingLineageV1,
    protocol: ProtocolContractV1,
    response_bytes: int,
) -> None:
    """Write a valid header plus seven body bytes, then never finish the frame."""

    del evaluation_time_ms, lineage, protocol, response_bytes
    pid_path = Path(cast(str, request.items[0]["workerPidPath"]))
    body = b'{"generatedAtMs":1772000000200}'
    header = _HOSTILE_WORKER_HEADER.pack(
        b"Q16W",
        1,
        1,
        0,
        hashlib.sha256(request.request_id.encode("ascii")).digest(),
        len(body),
        hashlib.sha256(body).digest(),
    )
    pid_path.write_text(f"{os.getpid()}\n", encoding="utf-8")
    assert os.write(connection.fileno(), header) == len(header)
    assert os.write(connection.fileno(), body[:7]) == 7
    threading.Event().wait()


class _RecordingConnection:
    def __init__(self) -> None:
        self.closed = False

    def close(self) -> None:
        self.closed = True


class _FakeProcess:
    def __init__(
        self,
        *,
        alive: bool,
        survives_terminate: bool = False,
        survives_kill: bool = False,
        lookup_errors: bool = False,
        pid: int | None = 123,
        start_error: BaseException | None = None,
    ) -> None:
        self.alive = alive
        self.survives_terminate = survives_terminate
        self.survives_kill = survives_kill
        self.lookup_errors = lookup_errors
        self.pid = pid
        self.start_error = start_error
        self.exitcode = 0
        self.sentinel = -1
        self.join_calls = 0
        self.terminate_calls = 0
        self.kill_calls = 0
        self.closed = False

    def start(self) -> None:
        if self.start_error is not None:
            raise self.start_error

    def join(self, timeout: float | None = None) -> None:
        assert timeout is not None
        assert timeout > 0
        self.join_calls += 1

    def is_alive(self) -> bool:
        return self.alive

    def terminate(self) -> None:
        self.terminate_calls += 1
        if self.lookup_errors:
            raise ProcessLookupError
        if not self.survives_terminate:
            self.alive = False

    def kill(self) -> None:
        self.kill_calls += 1
        if self.lookup_errors:
            raise ProcessLookupError
        if not self.survives_kill:
            self.alive = False

    def close(self) -> None:
        self.closed = True


class _WorkerContext:
    def __init__(
        self,
        *,
        process: _FakeProcess | None = None,
        pipe_error: BaseException | None = None,
        process_error: BaseException | None = None,
    ) -> None:
        self.receive = _RecordingConnection()
        self.send = _RecordingConnection()
        self.process = process or _FakeProcess(alive=False)
        self.pipe_error = pipe_error
        self.process_error = process_error

    def Pipe(self, *, duplex: bool) -> tuple[_RecordingConnection, _RecordingConnection]:
        assert duplex is False
        if self.pipe_error is not None:
            raise self.pipe_error
        return self.receive, self.send

    def Process(self, **kwargs: object) -> _FakeProcess:
        assert kwargs["daemon"] is True
        if self.process_error is not None:
            raise self.process_error
        return self.process


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
    assert admission.accepted
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


def test_worker_boundary_emits_only_bounded_sanitized_messages(
    monkeypatch: pytest.MonkeyPatch,
    raw_fixture: dict[str, object],
    lineage: ServingLineageV1,
    protocol: ProtocolContractV1,
) -> None:
    def invoke(
        request: LocalRequestV1,
        *,
        response_bytes: int = 262_144,
    ) -> service_module._WorkerFrameV1:
        receive_connection, send_connection = get_context("spawn").Pipe(duplex=False)
        worker = threading.Thread(
            target=service_module._run_inference_worker,
            args=(
                send_connection,
                request,
                NOW_MS,
                lineage,
                protocol,
                response_bytes,
            ),
        )
        worker.start()
        frame = service_module._read_worker_frame(
            receive_connection,
            request_id=request.request_id,
            response_bytes=response_bytes,
            deadline=monotonic() + 2,
            closed_event=threading.Event(),
            process_sentinel=None,
        )
        worker.join(timeout=2)
        assert not worker.is_alive()
        receive_connection.close()
        send_connection.close()
        return frame

    assess = LocalRequestV1("q16.worker.assess", RequestOperation.ASSESS, NOW_MS, (raw_fixture,))
    batch = LocalRequestV1(
        "q16.worker.batch",
        RequestOperation.BATCH_ASSESS,
        NOW_MS,
        (raw_fixture, raw_fixture),
    )
    assess_frame = invoke(assess)
    batch_frame = invoke(batch)
    assert assess_frame.status == service_module._WORKER_STATUS_OK
    assert strict_json_object(assess_frame.body, maximum_bytes=262_144)["requestId"] == (
        assess.request_id
    )
    assert batch_frame.status == service_module._WORKER_STATUS_OK
    assert strict_json_object(batch_frame.body, maximum_bytes=262_144)["requestId"] == (
        batch.request_id
    )
    limited = invoke(assess, response_bytes=1)
    assert limited.status == service_module._WORKER_STATUS_ERROR
    assert strict_json_object(limited.body, maximum_bytes=256)["code"] == "RESPONSE_LIMIT"
    health = LocalRequestV1("q16.worker.health", RequestOperation.HEALTH, NOW_MS)
    rejected = invoke(health)
    assert rejected.status == service_module._WORKER_STATUS_ERROR
    assert strict_json_object(rejected.body, maximum_bytes=256)["code"] == "REQUEST_REJECTED"

    def interrupt(*args: object, **kwargs: object) -> PipelineResultV1:
        del args, kwargs
        raise KeyboardInterrupt

    monkeypatch.setattr(service_module, "run_inference_pipeline", interrupt)
    failed = invoke(assess)
    assert failed.status == service_module._WORKER_STATUS_ERROR
    assert strict_json_object(failed.body, maximum_bytes=256)["code"] == ("INFERENCE_WORKER_FAILED")


def test_worker_writer_propagates_broken_pipe(
    raw_fixture: dict[str, object],
    lineage: ServingLineageV1,
    protocol: ProtocolContractV1,
) -> None:
    receive_connection, send_connection = get_context("spawn").Pipe(duplex=False)
    receive_connection.close()
    request = LocalRequestV1(
        "q16.worker.broken-pipe",
        RequestOperation.ASSESS,
        NOW_MS,
        (raw_fixture,),
    )
    with pytest.raises(BrokenPipeError):
        service_module._run_inference_worker(
            send_connection,
            request,
            NOW_MS,
            lineage,
            protocol,
            262_144,
        )
    assert send_connection.closed


def test_worker_frame_helpers_reject_every_invalid_boundary(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with pytest.raises(service_module.InferenceWorkerError, match="status"):
        service_module._worker_body_limit(status=99, response_bytes=1)
    with pytest.raises(service_module.InferenceWorkerError, match="error code"):
        service_module._worker_error_bytes(request_id="q16.worker", code="UNKNOWN")
    with pytest.raises(service_module.InferenceWorkerError, match="status"):
        service_module._worker_frame_header(request_id="q16.worker", status=99, body=b"x")

    receive_connection, send_connection = get_context("spawn").Pipe(duplex=False)
    try:
        monkeypatch.setattr(os, "fpathconf", lambda *args: 1)
        with pytest.raises(service_module.InferenceWorkerError, match="atomically"):
            service_module._require_atomic_worker_pipe(send_connection)
        monkeypatch.setattr(
            os,
            "fpathconf",
            lambda *args: (_ for _ in ()).throw(OSError("unavailable")),
        )
        with pytest.raises(service_module.InferenceWorkerError, match="unavailable"):
            service_module._require_atomic_worker_pipe(send_connection)
    finally:
        receive_connection.close()
        send_connection.close()


def test_worker_frame_writer_rejects_invalid_short_or_stalled_writes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = cast(Connection, _RecordingConnection())
    monkeypatch.setattr(service_module, "_require_atomic_worker_pipe", lambda _connection: 7)
    with pytest.raises(service_module.InferenceWorkerError, match="body was invalid"):
        service_module._write_worker_frame(
            connection,
            request_id="q16.worker",
            status=service_module._WORKER_STATUS_OK,
            body=b"",
            response_bytes=1,
        )
    with pytest.raises(service_module.InferenceWorkerError, match="exceeded"):
        service_module._write_worker_frame(
            connection,
            request_id="q16.worker",
            status=service_module._WORKER_STATUS_OK,
            body=b"xx",
            response_bytes=1,
        )

    monkeypatch.setattr(os, "write", lambda descriptor, raw: len(raw) - 1)
    with pytest.raises(service_module.InferenceWorkerError, match="header was truncated"):
        service_module._write_worker_frame(
            connection,
            request_id="q16.worker",
            status=service_module._WORKER_STATUS_OK,
            body=b"x",
            response_bytes=1,
        )

    writes = 0

    def stalled_write(descriptor: int, raw: object) -> int:
        nonlocal writes
        del descriptor
        writes += 1
        return len(cast(bytes, raw)) if writes == 1 else 0

    monkeypatch.setattr(os, "write", stalled_write)
    with pytest.raises(service_module.InferenceWorkerError, match="body was truncated"):
        service_module._write_worker_frame(
            connection,
            request_id="q16.worker",
            status=service_module._WORKER_STATUS_OK,
            body=b"x",
            response_bytes=1,
        )


@pytest.mark.parametrize(
    ("process", "terminate", "expected"),
    [
        (_FakeProcess(alive=False), False, (True, False, 0)),
        (_FakeProcess(alive=True), True, (True, True, 0)),
        (
            _FakeProcess(alive=True, survives_terminate=True),
            True,
            (True, True, 0),
        ),
        (
            _FakeProcess(
                alive=True,
                survives_terminate=True,
                survives_kill=True,
            ),
            True,
            (False, True, None),
        ),
        (
            _FakeProcess(alive=True, lookup_errors=True),
            True,
            (False, True, None),
        ),
    ],
)
def test_worker_reaper_is_bounded_and_closes_only_stopped_processes(
    process: _FakeProcess,
    terminate: bool,
    expected: tuple[bool, bool, int | None],
) -> None:
    observed = service_module._reap_worker(
        cast(BaseProcess, process),
        terminate=terminate,
    )
    assert observed == expected
    assert process.closed is expected[0]


@pytest.mark.parametrize(
    "context",
    [
        _WorkerContext(pipe_error=OSError("pipe")),
        _WorkerContext(process_error=RuntimeError("construct")),
        _WorkerContext(
            process=_FakeProcess(
                alive=False,
                pid=None,
                start_error=RuntimeError("start"),
            )
        ),
        _WorkerContext(
            process=_FakeProcess(
                alive=True,
                start_error=RuntimeError("start after pid"),
            )
        ),
    ],
)
def test_worker_manager_closes_ipc_and_fails_closed_on_lifecycle_errors(
    context: _WorkerContext,
    service: LocalInferenceServiceV1,
) -> None:
    service._worker_context = cast(SpawnContext, context)
    request = LocalRequestV1("q16.worker-manager", RequestOperation.ASSESS, NOW_MS, ({},))
    with pytest.raises(service_module.InferenceWorkerError):
        service._run_assessment_worker(
            request,
            evaluation_time_ms=NOW_MS,
            deadline=monotonic() + 1,
        )
    if context.pipe_error is None:
        assert context.receive.closed
        assert context.send.closed


def test_unreapable_worker_closes_parent_service(
    monkeypatch: pytest.MonkeyPatch,
    service: LocalInferenceServiceV1,
) -> None:
    context = _WorkerContext()
    service._worker_context = cast(SpawnContext, context)
    monkeypatch.setattr(
        service_module,
        "_read_worker_frame",
        lambda *args, **kwargs: service_module._WorkerFrameV1(
            status=service_module._WORKER_STATUS_OK,
            body=b"{}",
        ),
    )
    monkeypatch.setattr(
        service_module,
        "_reap_worker",
        lambda process, *, terminate: (False, terminate, None),
    )
    request = LocalRequestV1("q16.unreaped", RequestOperation.ASSESS, NOW_MS, ({},))
    with pytest.raises(service_module.InferenceWorkerError, match="could not be reaped"):
        service._run_assessment_worker(
            request,
            evaluation_time_ms=NOW_MS,
            deadline=monotonic() + 1,
        )
    assert service.closed


@pytest.mark.parametrize("failure", ["read", "missing", "decode"])
def test_worker_manager_reaps_and_marks_every_invalid_frame_path(
    failure: str,
    monkeypatch: pytest.MonkeyPatch,
    service: LocalInferenceServiceV1,
) -> None:
    context = _WorkerContext()
    service._worker_context = cast(SpawnContext, context)
    if failure == "read":

        def read_failure(*args: object, **kwargs: object) -> service_module._WorkerFrameV1:
            del args, kwargs
            raise service_module.InferenceWorkerError("bad frame")

        monkeypatch.setattr(service_module, "_read_worker_frame", read_failure)
    elif failure == "missing":
        monkeypatch.setattr(
            service_module,
            "_read_worker_frame",
            lambda *args, **kwargs: None,
        )
    else:
        monkeypatch.setattr(
            service_module,
            "_read_worker_frame",
            lambda *args, **kwargs: service_module._WorkerFrameV1(
                status=service_module._WORKER_STATUS_OK,
                body=b"{}",
            ),
        )

        def decode_failure(*args: object, **kwargs: object) -> object:
            del args, kwargs
            raise service_module.InferenceWorkerError("decode failed")

        monkeypatch.setattr(service, "_decode_worker_frame", decode_failure)
    request = LocalRequestV1("q16.worker.invalid-frame", RequestOperation.ASSESS, NOW_MS, ({},))
    with pytest.raises(service_module.InferenceWorkerError):
        service._run_assessment_worker(
            request,
            evaluation_time_ms=NOW_MS,
            deadline=monotonic() + 1,
        )
    assert service._last_error_code == "INFERENCE_WORKER_FAILED"
    assert context.receive.closed
    assert context.send.closed


def test_worker_frame_decoder_rejects_malformed_or_uncorrelated_results(
    service: LocalInferenceServiceV1,
) -> None:
    request = LocalRequestV1("q16.decode", RequestOperation.ASSESS, NOW_MS, ({},))
    invalid_frames: tuple[object, ...] = (
        "bad",
        service_module._WorkerFrameV1(status=99, body=b"{}"),
        service_module._WorkerFrameV1(
            status=service_module._WORKER_STATUS_ERROR,
            body=b"{",
        ),
        service_module._WorkerFrameV1(
            status=service_module._WORKER_STATUS_ERROR,
            body=protocol_json_bytes(
                {
                    "code": "REQUEST_REJECTED",
                    "extra": True,
                    "requestId": request.request_id,
                    "schema": "Q16InferenceWorkerErrorV1",
                    "version": 1,
                }
            ),
        ),
        service_module._WorkerFrameV1(
            status=service_module._WORKER_STATUS_ERROR,
            body=service_module._worker_error_bytes(
                request_id="q16.other",
                code="REQUEST_REJECTED",
            ),
        ),
        service_module._WorkerFrameV1(
            status=service_module._WORKER_STATUS_OK,
            body=b"{",
        ),
        service_module._WorkerFrameV1(status=service_module._WORKER_STATUS_OK, body=b"{}"),
        service_module._WorkerFrameV1(
            status=service_module._WORKER_STATUS_OK,
            body=protocol_json_bytes(
                ServiceResponseV1(
                    request_id="q16.other",
                    operation=request.operation,
                    generated_at_ms=NOW_MS,
                    payload={},
                ).as_mapping()
            ),
        ),
        service_module._WorkerFrameV1(
            status=service_module._WORKER_STATUS_OK,
            body=protocol_json_bytes(
                ServiceResponseV1(
                    request_id=request.request_id,
                    operation=request.operation,
                    generated_at_ms=NOW_MS,
                    payload=[],
                ).as_mapping()
            ),
        ),
        service_module._WorkerFrameV1(
            status=service_module._WORKER_STATUS_ERROR,
            body=service_module._worker_error_bytes(
                request_id=request.request_id,
                code="REQUEST_REJECTED",
            ),
        ),
    )
    for frame in invalid_frames:
        with pytest.raises(service_module.InferenceWorkerError):
            service._decode_worker_frame(
                cast(service_module._WorkerFrameV1, frame),
                request=request,
                evaluation_time_ms=NOW_MS,
            )
    with pytest.raises(ProtocolBoundaryError, match="response exceeds"):
        service._decode_worker_frame(
            service_module._WorkerFrameV1(
                status=service_module._WORKER_STATUS_ERROR,
                body=service_module._worker_error_bytes(
                    request_id=request.request_id,
                    code="RESPONSE_LIMIT",
                ),
            ),
            request=request,
            evaluation_time_ms=NOW_MS,
        )
    batch = LocalRequestV1(
        "q16.decode.batch",
        RequestOperation.BATCH_ASSESS,
        NOW_MS,
        ({}, {}),
    )
    with pytest.raises(service_module.InferenceWorkerError, match="batch payload"):
        service._decode_worker_frame(
            service_module._WorkerFrameV1(
                status=service_module._WORKER_STATUS_OK,
                body=protocol_json_bytes(
                    ServiceResponseV1(
                        request_id=batch.request_id,
                        operation=batch.operation,
                        generated_at_ms=NOW_MS,
                        payload=[{}],
                    ).as_mapping()
                ),
            ),
            request=batch,
            evaluation_time_ms=NOW_MS,
        )


@pytest.mark.parametrize(
    "failure",
    ["partial", "extra", "digest", "correlation", "header", "length"],
)
def test_worker_frame_reader_rejects_partial_or_malformed_frames(failure: str) -> None:
    request_id = "q16.frame.hostile"
    body = b'{"schema":"Q16LocalInferenceResponseV1"}'
    correlation = request_id if failure != "correlation" else "q16.frame.other"
    digest = hashlib.sha256(body).digest()
    if failure == "digest":
        digest = b"\x00" * 32
    header = _HOSTILE_WORKER_HEADER.pack(
        b"BAD!" if failure == "header" else b"Q16W",
        1,
        service_module._WORKER_STATUS_OK,
        0,
        hashlib.sha256(correlation.encode("ascii")).digest(),
        0 if failure == "length" else len(body),
        digest,
    )
    if failure == "partial":
        emitted = header + body[:7]
    elif failure == "extra":
        emitted = header + body + b"x"
    else:
        emitted = header + body
    receive_connection, send_connection = get_context("spawn").Pipe(duplex=False)
    assert os.write(send_connection.fileno(), emitted) == len(emitted)
    send_connection.close()
    with pytest.raises(service_module.InferenceWorkerError):
        service_module._read_worker_frame(
            receive_connection,
            request_id=request_id,
            response_bytes=262_144,
            deadline=monotonic() + 1,
            closed_event=threading.Event(),
            process_sentinel=None,
        )
    receive_connection.close()


def test_worker_frame_reader_sanitizes_pipe_read_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    receive_connection, send_connection = get_context("spawn").Pipe(duplex=False)
    monkeypatch.setattr(
        os,
        "read",
        lambda *args: (_ for _ in ()).throw(OSError("read failed")),
    )
    with pytest.raises(service_module.InferenceWorkerError, match="pipe read failed"):
        service_module._read_worker_frame(
            receive_connection,
            request_id="q16.read-error",
            response_bytes=262_144,
            deadline=monotonic() + 1,
            closed_event=threading.Event(),
            process_sentinel=None,
        )
    receive_connection.close()
    send_connection.close()


def test_partial_worker_frame_cannot_block_request_deadline(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    lineage: ServingLineageV1,
    protocol: ProtocolContractV1,
) -> None:
    pid_path = tmp_path / "partial-worker-pid"
    service = LocalInferenceServiceV1(
        limits=InferenceLimitsV1(queue_capacity=1, timeout_ms=1_000),
        lineage=lineage,
        protocol=protocol,
    )
    request = LocalRequestV1(
        "q16.partial-frame",
        RequestOperation.ASSESS,
        NOW_MS,
        ({"workerPidPath": str(pid_path)},),
    )
    monkeypatch.setattr(service_module, "_run_inference_worker", _emit_partial_worker_frame)
    responses: list[ServiceResponseV1 | dict[str, object]] = []
    caller = threading.Thread(
        target=lambda: responses.append(service.handle_request(request, evaluation_time_ms=NOW_MS))
    )
    caller.start()
    worker_pid: int | None = None
    completed_before_cleanup = False
    try:
        assert _wait_for_path(pid_path, timeout=5)
        worker_pid = int(pid_path.read_text(encoding="utf-8").strip())
        caller.join(timeout=2)
        completed_before_cleanup = not caller.is_alive()
        if caller.is_alive():
            with suppress(ProcessLookupError):
                os.kill(worker_pid, signal.SIGKILL)
            caller.join(timeout=2)
        assert completed_before_cleanup
        assert not caller.is_alive()
        assert len(responses) == 1
        timed_out = responses[0]
        assert isinstance(timed_out, dict)
        assert timed_out["code"] == "REQUEST_TIMEOUT"
        assert timed_out["stage"] == "inference"
        with pytest.raises(ProcessLookupError):
            os.kill(worker_pid, 0)

        recovered = service.handle_request(
            LocalRequestV1("q16.after-partial", RequestOperation.HEALTH, NOW_MS),
            evaluation_time_ms=NOW_MS,
        )
        assert isinstance(recovered, ServiceResponseV1)
        assert service.queue_depth == 0
        assert service.counters.accepted == 2
        assert service.counters.completed == 1
        assert service.counters.timeouts == 1
    finally:
        if caller.is_alive() and worker_pid is not None:
            with suppress(ProcessLookupError):
                os.kill(worker_pid, signal.SIGKILL)
        caller.join(timeout=2)
        service.close()


def test_non_cooperative_inference_timeout_reclaims_only_worker_slot(
    tmp_path: Path,
    raw_fixture: dict[str, object],
    lineage: ServingLineageV1,
    protocol: ProtocolContractV1,
) -> None:
    entered = tmp_path / "worker-entered"
    service = LocalInferenceServiceV1(
        limits=InferenceLimitsV1(queue_capacity=1, timeout_ms=2_000),
        lineage=lineage,
        protocol=protocol,
    )
    request = LocalRequestV1(
        "q16.non-cooperative",
        RequestOperation.ASSESS,
        NOW_MS,
        (
            _NonCooperativeFixture(
                raw_fixture,
                entered=entered,
            ),
        ),
    )
    responses: list[ServiceResponseV1 | dict[str, object]] = []
    caller = threading.Thread(
        target=lambda: responses.append(service.handle_request(request, evaluation_time_ms=NOW_MS))
    )
    caller.start()
    try:
        assert _wait_for_path(entered, timeout=5)
        caller.join(timeout=3)
        assert not caller.is_alive()
        assert len(responses) == 1
        timed_out = responses[0]
        assert isinstance(timed_out, dict)
        assert timed_out["code"] == "REQUEST_TIMEOUT"
        assert timed_out["stage"] == "inference"
        worker_pid = int(entered.read_text(encoding="utf-8").strip())
        assert worker_pid != os.getpid()
        with pytest.raises(ProcessLookupError):
            os.kill(worker_pid, 0)

        recovered = service.handle_request(
            LocalRequestV1("q16.after-timeout", RequestOperation.HEALTH, NOW_MS),
            evaluation_time_ms=NOW_MS,
        )
        assert isinstance(recovered, ServiceResponseV1)
        assert service.queue_depth == 0
        assert service.counters.accepted == 2
        assert service.counters.completed == 1
        assert service.counters.timeouts == 1
    finally:
        caller.join(timeout=2)
        service.close()


def test_close_cancels_and_reaps_active_non_cooperative_worker(
    tmp_path: Path,
    raw_fixture: dict[str, object],
    lineage: ServingLineageV1,
    protocol: ProtocolContractV1,
) -> None:
    entered = tmp_path / "worker-entered"
    service = LocalInferenceServiceV1(
        limits=InferenceLimitsV1(queue_capacity=1, timeout_ms=5_000),
        lineage=lineage,
        protocol=protocol,
    )
    request = LocalRequestV1(
        "q16.close-worker",
        RequestOperation.ASSESS,
        NOW_MS,
        (_NonCooperativeFixture(raw_fixture, entered=entered),),
    )
    responses: list[ServiceResponseV1 | dict[str, object]] = []
    caller = threading.Thread(
        target=lambda: responses.append(service.handle_request(request, evaluation_time_ms=NOW_MS))
    )
    caller.start()
    assert _wait_for_path(entered, timeout=5)
    worker_pid = int(entered.read_text(encoding="utf-8").strip())
    service.close()
    caller.join(timeout=2)
    assert not caller.is_alive()
    assert len(responses) == 1
    cancelled = responses[0]
    assert isinstance(cancelled, dict)
    assert cancelled["code"] == "SERVICE_CLOSED"
    assert cancelled["stage"] == "inference"
    with pytest.raises(ProcessLookupError):
        os.kill(worker_pid, 0)


def test_bounded_queue_wait_times_out_without_cross_request_response(
    raw_fixture: dict[str, object],
    lineage: ServingLineageV1,
    protocol: ProtocolContractV1,
) -> None:
    service = LocalInferenceServiceV1(
        limits=InferenceLimitsV1(queue_capacity=1, timeout_ms=1),
        lineage=lineage,
        protocol=protocol,
    )
    assert service._work_slot.acquire(timeout=1)
    first_response: list[ServiceResponseV1 | dict[str, object]] = []
    first = LocalRequestV1("q16.timeout.first", RequestOperation.ASSESS, NOW_MS, (raw_fixture,))
    thread = threading.Thread(
        target=lambda: first_response.append(
            service.handle_request(first, evaluation_time_ms=NOW_MS)
        )
    )
    thread.start()
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
    service._work_slot.release()
    for _ in range(1_000):
        if service.queue_depth == 0:
            break
        threading.Event().wait(0.001)
    assert service.counters.timeouts == 2


def test_waiting_request_observes_shutdown_before_processing(
    raw_fixture: dict[str, object],
    lineage: ServingLineageV1,
    protocol: ProtocolContractV1,
) -> None:
    service = LocalInferenceServiceV1(
        limits=InferenceLimitsV1(queue_capacity=1, timeout_ms=1_000),
        lineage=lineage,
        protocol=protocol,
    )
    assert service._work_slot.acquire(timeout=1)
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
    thread_two.start()
    for _ in range(1_000):
        if service.queue_depth == 1:
            break
        threading.Event().wait(0.001)
    service.close()
    service._work_slot.release()
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
    with pytest.raises(ProtocolBoundaryError):
        tiny.handle_request(
            LocalRequestV1("q16.readiness", RequestOperation.READINESS, NOW_MS),
            evaluation_time_ms=NOW_MS,
        )


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
    raw_fixture: dict[str, object],
    lineage: ServingLineageV1,
    protocol: ProtocolContractV1,
) -> None:
    service = LocalInferenceServiceV1(
        limits=InferenceLimitsV1(queue_capacity=1, timeout_ms=1_000),
        lineage=lineage,
        protocol=protocol,
    )
    assert service._work_slot.acquire(timeout=1)
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
    service._work_slot.release()
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
    raw_fixture: dict[str, object],
    lineage: ServingLineageV1,
    protocol: ProtocolContractV1,
) -> None:
    service = LocalInferenceServiceV1(
        limits=InferenceLimitsV1(queue_capacity=1, timeout_ms=1_000),
        lineage=lineage,
        protocol=protocol,
    )
    assert service._work_slot.acquire(timeout=1)
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
        service._work_slot.release()
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
