from __future__ import annotations

import ast
import hashlib
import os
import socket
import subprocess
import tempfile
import threading
from pathlib import Path
from typing import cast

from quant_edge.inference.contracts import InferenceLimitsV1, ServingLineageV1
from quant_edge.inference.generation import build_q16_artifacts
from quant_edge.inference.protocol import (
    ProtocolContractV1,
    protocol_json_bytes,
    strict_json_object,
)
from quant_edge.inference.service import LocalInferenceServiceV1
from quant_edge.inference.transport import create_unix_server

from .conftest import QUANT_ROOT, REPO_ROOT


def test_generated_artifacts_match_fresh_generation_byte_for_byte() -> None:
    artifacts = build_q16_artifacts(REPO_ROOT)
    for relative_path, expected in artifacts.items():
        observed = (QUANT_ROOT / relative_path).read_bytes()
        assert observed == expected, relative_path


def test_generation_is_cwd_timezone_and_hash_seed_stable(tmp_path: Path) -> None:
    code = (
        "from pathlib import Path; "
        "from quant_edge.inference.generation import build_q16_artifacts; "
        "import hashlib,json,sys; a=build_q16_artifacts(Path(sys.argv[1])); "
        "print(json.dumps({k:hashlib.sha256(v).hexdigest() "
        "for k,v in sorted(a.items())},sort_keys=True))"
    )
    outputs: list[str] = []
    for timezone, seed in (("UTC", "0"), ("Asia/Tokyo", "13"), ("America/New_York", "777")):
        env = os.environ.copy()
        env.update(
            {
                "PYTHONHASHSEED": seed,
                "PYTHONPATH": str(QUANT_ROOT / "src"),
                "TZ": timezone,
            }
        )
        completed = subprocess.run(
            [str(QUANT_ROOT / ".venv" / "bin" / "python"), "-c", code, str(REPO_ROOT)],
            cwd=tmp_path,
            env=env,
            check=True,
            capture_output=True,
            text=True,
        )
        outputs.append(completed.stdout)
    assert len(set(outputs)) == 1


def test_generated_manifest_hashes_every_generated_kit_file() -> None:
    manifest = strict_json_object(
        (QUANT_ROOT / "generated" / "q16" / "protocol_kit_manifest.v1.json").read_bytes(),
        maximum_bytes=262_144,
    )
    rows = manifest["artifacts"]
    assert isinstance(rows, list)
    generated_root = QUANT_ROOT / "generated" / "q16"
    expected_paths = sorted(
        f"generated/q16/{path.name}"
        for path in generated_root.iterdir()
        if path.is_file() and path.name != "protocol_kit_manifest.v1.json"
    )
    observed_paths = [row["relativePath"] for row in rows]
    assert observed_paths == expected_paths
    assert "generated/q16/inference_campaign.v1.md" in observed_paths
    assert "generated/q16/protocol_kit_manifest.v1.json" not in observed_paths
    for row in rows:
        path = QUANT_ROOT / row["relativePath"]
        raw = path.read_bytes()
        assert len(raw) == row["byteLength"]
        assert hashlib.sha256(raw).hexdigest() == row["sha256"]


def test_generated_clients_are_syntax_valid_and_assessment_is_protocol_canonical() -> None:
    subprocess.run(
        ["node", "--check", str(QUANT_ROOT / "generated" / "q16" / "node_client_v1.mjs")],
        check=True,
    )
    subprocess.run(
        [
            str(QUANT_ROOT / ".venv" / "bin" / "python"),
            "-m",
            "py_compile",
            str(QUANT_ROOT / "generated" / "q16" / "python_client_v1.py"),
        ],
        check=True,
    )
    assessment_raw = (QUANT_ROOT / "generated" / "q16" / "edge_assessment.v1.json").read_bytes()
    assessment = strict_json_object(assessment_raw, maximum_bytes=262_144)
    assert protocol_json_bytes(assessment) == assessment_raw


def test_generated_node_client_strictly_validates_wrapped_response_and_mutations(
    tmp_path: Path,
) -> None:
    artifacts = build_q16_artifacts(REPO_ROOT)
    client = tmp_path / "node_client_v1.mjs"
    response = tmp_path / "response_assess_wrapped.v1.json"
    health_response = tmp_path / "response_health_wrapped.v1.json"
    client.write_bytes(artifacts["generated/q16/node_client_v1.mjs"])
    response.write_bytes(artifacts["generated/q16/response_assess_wrapped.v1.json"])
    campaign = strict_json_object(
        artifacts["generated/q16/inference_campaign.v1.json"],
        maximum_bytes=262_144,
    )
    health_response.write_bytes(protocol_json_bytes(campaign["health"]))
    script = """
import fs from 'node:fs';
const client = await import(process.argv[1]);
const raw = fs.readFileSync(process.argv[2], 'utf8');
const wrapped = client.validateResponse(client.strictParse(raw));
if (wrapped.payload.advisoryAction !== 'ABSTAIN_UNKNOWN') throw new Error('wrong action');
const healthRaw = fs.readFileSync(process.argv[3], 'utf8');
const health = client.validateResponse(client.strictParse(healthRaw));
if (health.payload.state !== 'DEGRADED') throw new Error('wrong health state');
const rejects = (call) => { try { call(); } catch { return; } throw new Error('accepted bad'); };
rejects(() => client.strictParse('{"schema":"x","schema":"y"}'));
rejects(() => client.strictParse('{"x":NaN}'));
rejects(() => client.canonicalStringify({unsafe: 9007199254740992}));
const forbidden = structuredClone(wrapped); forbidden.payload['api.key'] = 'redacted';
rejects(() => client.validateResponse(forbidden));
const version = structuredClone(wrapped); version.version = 2;
rejects(() => client.validateResponse(version));
const action = structuredClone(wrapped); action.payload.advisoryAction = 'TRADE';
rejects(() => client.validateResponse(action));
const ambiguousAction = structuredClone(wrapped);
ambiguousAction.payload.advisoryAction = 'PROPOSE_CONSIDERATION';
rejects(() => client.validateResponse(ambiguousAction));
const malformedNested = structuredClone(wrapped);
malformedNested.payload.advisoryAction = 'WATCH';
malformedNested.payload.abstentionReasonCodes = [];
malformedNested.payload.predictions = [{}];
malformedNested.payload.netExpectedValue = {state: 'ESTIMATED'};
malformedNested.payload.oodState = 'IN_DISTRIBUTION';
malformedNested.payload.driftState = 'STABLE';
malformedNested.payload.evidence = {supporting: [], conflicting: [], missing: []};
malformedNested.payload.sourceQuality = {
  freshness: 'FRESH', completeness: 'COMPLETE', gapCount: 0,
  duplicate: false, reconstructed: false,
};
malformedNested.payload.uncertainty = 'MALFORMED_BUT_ACTIONABLE';
malformedNested.payload.instrumentGraph = {};
rejects(() => client.validateResponse(malformedNested));
const reason = structuredClone(wrapped); reason.payload.abstentionReasonCodes = [];
rejects(() => client.validateResponse(reason));
const readSchema = structuredClone(health); readSchema.payload.schema = 'UnknownHealthV1';
rejects(() => client.validateResponse(readSchema));
const falseHealth = structuredClone(health);
falseHealth.payload.state = 'OK';
falseHealth.payload.blockingReasons = 'MALFORMED_HIDDEN_BLOCKERS';
rejects(() => client.validateResponse(falseHealth));
const validError = {
  code: 'REQUEST_REJECTED', component: 'quant-edge-q16-local-inference',
  correlationId: null, errorId: 'q16.err.client-test', message: 'rejected',
  occurredAtMs: 1772000000200,
  recommendedOperatorAction: 'inspect lineage', retryable: false, revision: 0,
  safeCurrentState: 'REQUEST_REJECTED_NO_ASSESSMENT', schema: 'ProtocolErrorV1',
  stage: 'decode', version: 1,
};
client.validateResponse(validError);
const malformedError = structuredClone(validError);
malformedError.recommendedOperatorAction = [];
rejects(() => client.validateResponse(malformedError));
const metrics = {
  generatedAtMs: 1772000000200, operation: 'METRICS', requestId: 'q16.metrics.client',
  schema: 'Q16LocalInferenceResponseV1', version: 1,
  payload: {
    abstentions: 0, accepted: 0, completed: 0, protocolErrors: 0, queueDepth: 0,
    queueRejections: 0, schema: 'Q16ServiceMetricsV1', serviceClosedRejections: 0,
    timeouts: 0, transportErrors: 0, version: 1,
  },
};
client.validateResponse(metrics);
metrics.payload.timeouts = '0';
rejects(() => client.validateResponse(metrics));
console.log('strict-ok');
"""
    completed = subprocess.run(
        [
            "node",
            "--input-type=module",
            "-e",
            script,
            str(client),
            str(response),
            str(health_response),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    assert completed.stdout.strip() == "strict-ok"


def test_generated_python_client_strictly_validates_wrapped_response_and_mutations(
    tmp_path: Path,
) -> None:
    artifacts = build_q16_artifacts(REPO_ROOT)
    client = tmp_path / "python_client_v1.py"
    response = tmp_path / "response_assess_wrapped.v1.json"
    health_response = tmp_path / "response_health_wrapped.v1.json"
    client.write_bytes(artifacts["generated/q16/python_client_v1.py"])
    response.write_bytes(artifacts["generated/q16/response_assess_wrapped.v1.json"])
    campaign = strict_json_object(
        artifacts["generated/q16/inference_campaign.v1.json"],
        maximum_bytes=262_144,
    )
    health_response.write_bytes(protocol_json_bytes(campaign["health"]))
    script = """
import copy
import importlib.util
import pathlib
import sys
spec = importlib.util.spec_from_file_location("q16_generated_client", sys.argv[1])
assert spec is not None and spec.loader is not None
client = importlib.util.module_from_spec(spec)
spec.loader.exec_module(client)
wrapped = client._parse(pathlib.Path(sys.argv[2]).read_bytes())
assert wrapped["payload"]["advisoryAction"] == "ABSTAIN_UNKNOWN"
bad_raw = (b'{"schema":"x","schema":"y"}', b'{"x":NaN}')
for raw in bad_raw:
    try:
        client._parse(raw)
    except ValueError:
        pass
    else:
        raise AssertionError("strict parser accepted malformed JSON")
for field, value in (("version", 2), ("schema", "UnknownResponseV1")):
    mutated = copy.deepcopy(wrapped)
    mutated[field] = value
    try:
        client.validate_response(mutated)
    except ValueError:
        pass
    else:
        raise AssertionError("client accepted unsupported wrapper")
mutated = copy.deepcopy(wrapped)
mutated["payload"]["api key"] = "redacted"
try:
    client.validate_response(mutated)
except ValueError:
    pass
else:
    raise AssertionError("client accepted forbidden nested key")
mutated = copy.deepcopy(wrapped)
mutated["payload"]["advisoryAction"] = "PROPOSE_CONSIDERATION"
try:
    client.validate_response(mutated)
except ValueError:
    pass
else:
    raise AssertionError("client accepted actionable advice from ambiguous truth")
mutated = copy.deepcopy(wrapped)
payload = mutated["payload"]
payload["advisoryAction"] = "WATCH"
payload["abstentionReasonCodes"] = []
payload["predictions"] = [{}]
payload["netExpectedValue"] = {"state": "ESTIMATED"}
payload["oodState"] = "IN_DISTRIBUTION"
payload["driftState"] = "STABLE"
payload["evidence"] = {"supporting": [], "conflicting": [], "missing": []}
payload["sourceQuality"] = {
    "freshness": "FRESH", "completeness": "COMPLETE", "gapCount": 0,
    "duplicate": False, "reconstructed": False,
}
payload["uncertainty"] = "MALFORMED_BUT_ACTIONABLE"
payload["instrumentGraph"] = {}
try:
    client.validate_response(mutated)
except ValueError:
    pass
else:
    raise AssertionError("client accepted frozen-protocol-invalid actionable advice")
health = client._parse(pathlib.Path(sys.argv[3]).read_bytes())
health["payload"]["state"] = "OK"
health["payload"]["blockingReasons"] = "MALFORMED_HIDDEN_BLOCKERS"
try:
    client.validate_response(health)
except ValueError:
    pass
else:
    raise AssertionError("client accepted malformed false-green health")
valid_error = {
    "code": "REQUEST_REJECTED", "component": "quant-edge-q16-local-inference",
    "correlationId": None, "errorId": "q16.err.client-test", "message": "rejected",
    "occurredAtMs": 1772000000200, "recommendedOperatorAction": "inspect lineage",
    "retryable": False, "revision": 0,
    "safeCurrentState": "REQUEST_REJECTED_NO_ASSESSMENT",
    "schema": "ProtocolErrorV1", "stage": "decode", "version": 1,
}
client.validate_response(valid_error)
valid_error["recommendedOperatorAction"] = []
try:
    client.validate_response(valid_error)
except ValueError:
    pass
else:
    raise AssertionError("client accepted malformed protocol error")
metrics = {
    "generatedAtMs": 1772000000200, "operation": "METRICS",
    "requestId": "q16.metrics.client", "schema": "Q16LocalInferenceResponseV1",
    "version": 1,
    "payload": {
        "abstentions": 0, "accepted": 0, "completed": 0, "protocolErrors": 0,
        "queueDepth": 0, "queueRejections": 0, "schema": "Q16ServiceMetricsV1",
        "serviceClosedRejections": 0, "timeouts": 0, "transportErrors": 0,
        "version": 1,
    },
}
client.validate_response(metrics)
metrics["payload"]["timeouts"] = "0"
try:
    client.validate_response(metrics)
except ValueError:
    pass
else:
    raise AssertionError("client accepted non-integer metrics")
try:
    client.request(pathlib.Path("/does/not/exist"), {"unsafe": 9007199254740992})
except ValueError:
    pass
else:
    raise AssertionError("client accepted unsafe integer object request")
"""
    subprocess.run(
        [
            str(QUANT_ROOT / ".venv" / "bin" / "python"),
            "-c",
            script,
            str(client),
            str(response),
            str(health_response),
        ],
        check=True,
    )


def test_generated_node_request_file_preserves_committed_large_integers_end_to_end(
    tmp_path: Path,
    lineage: ServingLineageV1,
    protocol: ProtocolContractV1,
) -> None:
    artifacts = build_q16_artifacts(REPO_ROOT)
    client = tmp_path / "node_client_v1.mjs"
    client.write_bytes(artifacts["generated/q16/node_client_v1.mjs"])
    request_path = QUANT_ROOT / "generated" / "q16" / "request_assess.v1.json"
    assert b"1772000000000000001" in request_path.read_bytes()
    private_directory = tempfile.TemporaryDirectory(prefix="q16-node-", dir="/tmp")
    private = Path(private_directory.name)
    private.chmod(0o700)
    socket_path = private / "q16.sock"
    service = LocalInferenceServiceV1(
        limits=InferenceLimitsV1(),
        lineage=lineage,
        protocol=protocol,
    )
    handle = create_unix_server(
        path=socket_path,
        service=service,
        fallback_now_ms=1_772_000_000_200,
    )
    thread = threading.Thread(target=handle.server.serve_forever, daemon=True)
    thread.start()
    script = """
const client = await import(process.argv[1]);
const response = await client.requestFile(process.argv[2], process.argv[3]);
console.log(`${response.schema}:${response.payload.advisoryAction}`);
"""
    try:
        completed = subprocess.run(
            [
                "node",
                "--input-type=module",
                "-e",
                script,
                str(client),
                str(socket_path),
                str(request_path),
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        assert completed.stdout.strip() == ("Q16LocalInferenceResponseV1:ABSTAIN_UNKNOWN")
    finally:
        handle.server.shutdown()
        thread.join(timeout=2)
        handle.close()
        private_directory.cleanup()


def test_generated_node_client_times_out_on_silent_uds_peer(tmp_path: Path) -> None:
    artifacts = build_q16_artifacts(REPO_ROOT)
    client = tmp_path / "node_client_v1.mjs"
    request_path = tmp_path / "request.json"
    client.write_bytes(artifacts["generated/q16/node_client_v1.mjs"])
    request_path.write_bytes(artifacts["generated/q16/request_assess.v1.json"])
    private_directory = tempfile.TemporaryDirectory(prefix="q16-silent-", dir="/tmp")
    socket_path = Path(private_directory.name) / "silent.sock"
    listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    listener.bind(str(socket_path))
    listener.listen(1)
    release = threading.Event()

    def silent_peer() -> None:
        connection, _address = listener.accept()
        with connection:
            release.wait(timeout=2)

    thread = threading.Thread(target=silent_peer, daemon=True)
    thread.start()
    script = """
const client = await import(process.argv[1]);
try {
  await client.requestFile(process.argv[2], process.argv[3], 262144, 30);
  throw new Error('client did not time out');
} catch (error) {
  if (!String(error).includes('timed out')) throw error;
  console.log('timeout-ok');
}
"""
    try:
        completed = subprocess.run(
            [
                "node",
                "--input-type=module",
                "-e",
                script,
                str(client),
                str(socket_path),
                str(request_path),
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        assert completed.stdout.strip() == "timeout-ok"
    finally:
        release.set()
        thread.join(timeout=2)
        listener.close()
        private_directory.cleanup()


def test_generated_python_client_times_out_on_silent_uds_peer(tmp_path: Path) -> None:
    artifacts = build_q16_artifacts(REPO_ROOT)
    client = tmp_path / "python_client_v1.py"
    request_path = tmp_path / "request.json"
    client.write_bytes(artifacts["generated/q16/python_client_v1.py"])
    request_path.write_bytes(artifacts["generated/q16/request_assess.v1.json"])
    private_directory = tempfile.TemporaryDirectory(prefix="q16-silent-", dir="/tmp")
    socket_path = Path(private_directory.name) / "silent.sock"
    listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    listener.bind(str(socket_path))
    listener.listen(1)
    release = threading.Event()

    def silent_peer() -> None:
        connection, _address = listener.accept()
        with connection:
            release.wait(timeout=2)

    thread = threading.Thread(target=silent_peer, daemon=True)
    thread.start()
    script = """
import importlib.util
import pathlib
import socket
import sys
spec = importlib.util.spec_from_file_location("q16_generated_client", sys.argv[1])
assert spec is not None and spec.loader is not None
client = importlib.util.module_from_spec(spec)
spec.loader.exec_module(client)
try:
    client.request_file(
        pathlib.Path(sys.argv[2]),
        pathlib.Path(sys.argv[3]),
        timeout_seconds=0.03,
    )
except socket.timeout:
    print("timeout-ok")
else:
    raise AssertionError("generated Python client did not time out")
"""
    try:
        completed = subprocess.run(
            [
                str(QUANT_ROOT / ".venv" / "bin" / "python"),
                "-c",
                script,
                str(client),
                str(socket_path),
                str(request_path),
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        assert completed.stdout.strip() == "timeout-ok"
    finally:
        release.set()
        thread.join(timeout=2)
        listener.close()
        private_directory.cleanup()


def test_inference_imports_have_no_private_network_money_or_unsafe_deserialization() -> None:
    root = QUANT_ROOT / "src" / "quant_edge" / "inference"
    forbidden_imports = {
        "boto3",
        "httpx",
        "joblib",
        "pickle",
        "requests",
        "urllib",
    }
    forbidden_tokens = (
        "api_secret",
        "borrow(",
        "live_order",
        "margin_mutation",
        "repay(",
        "transfer(",
        "withdraw(",
    )
    for path in root.glob("*.py"):
        source = path.read_text()
        tree = ast.parse(source)
        imports = {
            alias.name.split(".", maxsplit=1)[0]
            for node in ast.walk(tree)
            if isinstance(node, ast.Import)
            for alias in node.names
        } | {
            (node.module or "").split(".", maxsplit=1)[0]
            for node in ast.walk(tree)
            if isinstance(node, ast.ImportFrom)
        }
        assert not imports & forbidden_imports, path
        lowered = source.lower()
        assert not any(token in lowered for token in forbidden_tokens), path


def test_only_transport_imports_socket_and_os() -> None:
    root = QUANT_ROOT / "src" / "quant_edge" / "inference"
    for path in root.glob("*.py"):
        tree = ast.parse(path.read_text())
        imports = {
            alias.name.split(".", maxsplit=1)[0]
            for node in ast.walk(tree)
            if isinstance(node, ast.Import)
            for alias in node.names
        }
        if imports & {"os", "socket", "socketserver", "stat"}:
            assert path.name == "transport.py"


def test_campaign_truth_is_abstain_only_and_no_edge_claim() -> None:
    campaign = strict_json_object(
        (QUANT_ROOT / "generated" / "q16" / "inference_campaign.v1.json").read_bytes(),
        maximum_bytes=262_144,
    )
    assert campaign["posture"] == "SYNTHETIC_ONLY"
    assert campaign["finalAction"] == "ABSTAIN_UNKNOWN"
    assert campaign["championAvailability"] == "UNAVAILABLE_NONLOADABLE"
    assert campaign["calibrationStatus"] == "UNAVAILABLE_MODEL_OUTPUT"
    health = cast(dict[str, object], campaign["health"])
    payload = cast(dict[str, object], health["payload"])
    assert payload["state"] == "DEGRADED"
