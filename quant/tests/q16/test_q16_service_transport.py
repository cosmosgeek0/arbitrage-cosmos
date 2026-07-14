from __future__ import annotations

import json
import socket
import stat
import tempfile
import threading
from pathlib import Path
from typing import cast

import pytest

from quant_edge.errors import ContractValueError
from quant_edge.inference.contracts import (
    InferenceLimitsV1,
    LocalRequestV1,
    RequestOperation,
    ServingLineageV1,
)
from quant_edge.inference.protocol import (
    ProtocolContractV1,
    protocol_json_bytes,
    strict_json_object,
)
from quant_edge.inference.service import LocalInferenceServiceV1, ServiceResponseV1
from quant_edge.inference.transport import (
    LocalTransportError,
    create_loopback_server,
    create_unix_server,
    require_literal_loopback,
)

NOW_MS = 1_772_000_000_200


def _request(
    operation: RequestOperation,
    *,
    request_id: str,
    raw_fixture: dict[str, object] | None = None,
) -> LocalRequestV1:
    return LocalRequestV1(
        request_id=request_id,
        operation=operation,
        generated_at_ms=NOW_MS,
        items=(() if raw_fixture is None else (raw_fixture,)),
    )


def test_service_assessment_and_batch_are_real_safe_abstentions(
    service: LocalInferenceServiceV1,
    raw_fixture: dict[str, object],
) -> None:
    single = service.handle_request(
        _request(RequestOperation.ASSESS, request_id="q16.single", raw_fixture=raw_fixture),
        evaluation_time_ms=NOW_MS,
    )
    assert isinstance(single, ServiceResponseV1)
    single_payload = cast(dict[str, object], single.payload)
    assert single_payload["advisoryAction"] == "ABSTAIN_UNKNOWN"
    batch_request = LocalRequestV1(
        request_id="q16.batch",
        operation=RequestOperation.BATCH_ASSESS,
        generated_at_ms=NOW_MS,
        items=(raw_fixture, raw_fixture),
    )
    batch = service.handle_request(batch_request, evaluation_time_ms=NOW_MS)
    assert isinstance(batch, ServiceResponseV1)
    batch_payload = cast(list[dict[str, object]], batch.payload)
    assert [item["advisoryAction"] for item in batch_payload] == [
        "ABSTAIN_UNKNOWN",
        "ABSTAIN_UNKNOWN",
    ]


@pytest.mark.parametrize(
    ("operation", "field", "expected"),
    [
        (RequestOperation.HEALTH, "state", "DEGRADED"),
        (RequestOperation.READINESS, "modelReadiness", "READY_ABSTAIN_ONLY"),
        (RequestOperation.LINEAGE, "streaming", "NOT_JUSTIFIED"),
        (RequestOperation.METRICS, "schema", "Q16ServiceMetricsV1"),
    ],
)
def test_service_read_operations_expose_truth(
    service: LocalInferenceServiceV1,
    operation: RequestOperation,
    field: str,
    expected: object,
) -> None:
    response = service.handle_request(
        _request(operation, request_id=f"q16.{operation.value}"),
        evaluation_time_ms=NOW_MS,
    )
    assert isinstance(response, ServiceResponseV1)
    payload = cast(dict[str, object], response.payload)
    assert payload[field] == expected


def test_service_rejects_unimplemented_parallelism(
    lineage: ServingLineageV1,
    protocol: ProtocolContractV1,
) -> None:
    with pytest.raises(ContractValueError, match="concurrency=1"):
        LocalInferenceServiceV1(
            limits=InferenceLimitsV1(concurrency=2),
            lineage=lineage,
            protocol=protocol,
        )


def test_closed_service_rejects_request(service: LocalInferenceServiceV1) -> None:
    service.close()
    assert service.closed is True
    result = service.handle_request(
        _request(RequestOperation.HEALTH, request_id="q16.closed"),
        evaluation_time_ms=NOW_MS,
    )
    assert isinstance(result, dict)
    assert result["code"] == "SERVICE_CLOSED"
    assert service.queue_depth == 0


@pytest.mark.parametrize(
    "raw",
    [
        b'{"schema":"Q16LocalInferenceRequestV1","schema":"duplicate"}',
        b'{"apiSecret":"do-not-echo"}',
        b"not-json",
    ],
)
def test_service_decode_errors_are_bounded_and_do_not_echo(
    raw: bytes,
    service: LocalInferenceServiceV1,
) -> None:
    response = service.handle_bytes(raw, fallback_now_ms=NOW_MS)
    value = strict_json_object(response, maximum_bytes=262_144)
    assert value["schema"] == "ProtocolErrorV1"
    assert value["code"] == "REQUEST_REJECTED"
    assert b"do-not-echo" not in response


def test_local_request_contract_rejects_wrong_item_arity() -> None:
    with pytest.raises(ContractValueError, match="require items"):
        LocalRequestV1(
            request_id="q16.bad",
            operation=RequestOperation.ASSESS,
            generated_at_ms=NOW_MS,
        )
    with pytest.raises(ContractValueError, match="forbid"):
        LocalRequestV1(
            request_id="q16.bad-read",
            operation=RequestOperation.HEALTH,
            generated_at_ms=NOW_MS,
            items=({},),
        )
    mapping = _request(RequestOperation.HEALTH, request_id="q16.bool-version").as_mapping()
    mapping["version"] = True
    with pytest.raises(ContractValueError, match="version"):
        LocalRequestV1.from_mapping(mapping, limits=InferenceLimitsV1())


def test_wire_boolean_version_is_rejected(service: LocalInferenceServiceV1) -> None:
    mapping = _request(RequestOperation.HEALTH, request_id="q16.bool-wire").as_mapping()
    mapping["version"] = True
    response = strict_json_object(
        service.handle_bytes(protocol_json_bytes(mapping), fallback_now_ms=NOW_MS),
        maximum_bytes=262_144,
    )
    assert response["schema"] == "ProtocolErrorV1"
    assert response["code"] == "REQUEST_REJECTED"


def test_permissioned_uds_round_trip(
    service: LocalInferenceServiceV1,
) -> None:
    with tempfile.TemporaryDirectory(prefix="q16-", dir="/tmp") as directory:
        private = Path(directory)
        socket_path = private / "q16.sock"
        handle = create_unix_server(path=socket_path, service=service, fallback_now_ms=NOW_MS)
        assert stat.S_IMODE(socket_path.stat().st_mode) == 0o600
        thread = threading.Thread(target=handle.server.serve_forever, daemon=True)
        thread.start()
        request = _request(RequestOperation.HEALTH, request_id="q16.uds").as_mapping()
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            client.connect(str(socket_path))
            client.sendall(protocol_json_bytes(request) + b"\n")
            response = client.makefile("rb").readline(262_145)
        value = json.loads(response)
        assert value["payload"]["state"] == "DEGRADED"
        handle.server.shutdown()
        thread.join(timeout=2)
        handle.close()
        assert not socket_path.exists()


def test_uds_resolves_injected_trusted_clock_per_request(
    service: LocalInferenceServiceV1,
) -> None:
    now = [NOW_MS]
    with tempfile.TemporaryDirectory(prefix="q16-", dir="/tmp") as directory:
        socket_path = Path(directory) / "q16.sock"
        handle = create_unix_server(
            path=socket_path,
            service=service,
            fallback_now_ms=lambda: now[0],
        )
        thread = threading.Thread(target=handle.server.serve_forever)
        thread.start()
        for _ in range(1_000):
            try:
                with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as probe:
                    probe.connect(str(socket_path))
                break
            except ConnectionRefusedError:
                threading.Event().wait(0.001)
        for expected in (NOW_MS, NOW_MS + 10):
            now[0] = expected
            request = _request(RequestOperation.HEALTH, request_id=f"q16.clock.{expected}")
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
                client.connect(str(socket_path))
                client.sendall(protocol_json_bytes(request.as_mapping()) + b"\n")
                response = json.loads(client.makefile("rb").readline(262_145))
            assert response["generatedAtMs"] == expected
        handle.close()
        thread.join(timeout=2)
        assert not thread.is_alive()


def test_uds_rejects_collision_and_unsafe_parent(
    service: LocalInferenceServiceV1,
) -> None:
    with tempfile.TemporaryDirectory(prefix="q16-", dir="/tmp") as directory:
        private = Path(directory)
        collision = private / "q16.sock"
        collision.write_text("owner data")
        with pytest.raises(LocalTransportError, match="collision"):
            create_unix_server(path=collision, service=service, fallback_now_ms=NOW_MS)
        unsafe = private / "unsafe"
        unsafe.mkdir(mode=0o755)
        unsafe.chmod(0o755)
        with pytest.raises(LocalTransportError, match="0700"):
            create_unix_server(path=unsafe / "q16.sock", service=service, fallback_now_ms=NOW_MS)


@pytest.mark.parametrize("host", ["0.0.0.0", "localhost", "::", "192.0.2.1"])
def test_external_and_hostname_binds_are_rejected(host: str) -> None:
    with pytest.raises(LocalTransportError, match="loopback"):
        require_literal_loopback(host)


def test_literal_loopback_server_is_optional_and_bounded(
    service: LocalInferenceServiceV1,
) -> None:
    handle = create_loopback_server(
        host="127.0.0.1",
        port=0,
        service=service,
        fallback_now_ms=NOW_MS,
    )
    host, _port = cast(tuple[str, int], handle.server.server_address)
    assert host == "127.0.0.1"
    handle.close()
