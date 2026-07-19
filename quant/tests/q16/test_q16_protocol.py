from __future__ import annotations

import hashlib
import json
import random
import subprocess
from copy import deepcopy
from pathlib import Path

import pytest

from quant_edge.errors import ContractValueError
from quant_edge.inference.pipeline import PipelineResultV1
from quant_edge.inference.protocol import (
    ProtocolBoundaryError,
    ProtocolContractV1,
    protocol_digest,
    protocol_error,
    protocol_json_bytes,
    reject_forbidden_keys,
    strict_json_object,
)

from .conftest import QUANT_ROOT, REPO_ROOT


@pytest.mark.parametrize(
    "raw",
    [
        b'{"x":1,"x":2}',
        b'{"x":NaN}',
        b'{"x":Infinity}',
        b'{"x":-0}',
        b'{"x":-0.0}',
        b"[1,2]",
        b"\xff",
        b"",
    ],
)
def test_strict_json_rejects_ambiguous_or_non_json_input(raw: bytes) -> None:
    with pytest.raises(ProtocolBoundaryError):
        strict_json_object(raw, maximum_bytes=128)


def test_strict_json_bounds_size_and_nesting() -> None:
    with pytest.raises(ProtocolBoundaryError, match="byte limit"):
        strict_json_object(b'{"long":"123456"}', maximum_bytes=4)
    value: object = 1
    for _ in range(70):
        value = [value]
    raw = json.dumps({"deep": value}).encode()
    with pytest.raises(ProtocolBoundaryError, match=r"nesting|deeply"):
        strict_json_object(raw, maximum_bytes=len(raw))


def test_protocol_bytes_are_order_stable_and_do_not_append_newline() -> None:
    left = {"z": 1, "a": {"b": 2, "a": 1}, "astral_😀": "ok"}
    right = {"astral_😀": "ok", "a": {"a": 1, "b": 2}, "z": 1}
    assert protocol_json_bytes(left) == protocol_json_bytes(right)
    assert not protocol_json_bytes(left).endswith(b"\n")
    assert protocol_digest(left) == protocol_digest(right)


@pytest.mark.parametrize("value", [float("nan"), float("inf"), -0.0, object()])
def test_protocol_bytes_reject_unsupported_primitives(value: object) -> None:
    with pytest.raises(ProtocolBoundaryError):
        protocol_json_bytes({"value": value})


def test_python_protocol_bytes_match_generated_node_over_frozen_valid_fixtures() -> None:
    fixture_path = REPO_ROOT / "packages" / "edge-protocol" / "fixtures" / "fixtures-v1.json"
    fixtures = json.loads(fixture_path.read_text())
    expected = [
        hashlib.sha256(protocol_json_bytes(item["envelope"])).hexdigest()
        for item in fixtures["valid"]
    ]
    client = QUANT_ROOT / "generated" / "q16" / "node_client_v1.mjs"
    script = (
        "import fs from 'node:fs'; import crypto from 'node:crypto'; "
        "const m=await import(process.argv[1]); "
        "const f=JSON.parse(fs.readFileSync(process.argv[2],'utf8')); "
        "console.log(JSON.stringify(f.valid.map(x=>crypto.createHash('sha256')"
        ".update(m.canonicalStringify(x.envelope)).digest('hex'))));"
    )
    completed = subprocess.run(
        ["node", "--input-type=module", "-e", script, str(client), str(fixture_path)],
        check=True,
        capture_output=True,
        text=True,
        timeout=15,
    )
    assert json.loads(completed.stdout) == expected


def test_python_node_protocol_hashes_match_deterministic_numeric_vectors() -> None:
    generator = random.Random(20_260_712)
    vectors: list[dict[str, object]] = [
        {"n": -9_007_199_254_740_991},
        {"n": 9_007_199_254_740_991},
        {"n": 1e-7},
        {"n": 1e-6},
    ]
    vectors.extend({"n": round(generator.uniform(-1_000_000, 1_000_000), 6)} for _ in range(200))
    expected = [hashlib.sha256(protocol_json_bytes(item)).hexdigest() for item in vectors]
    client = QUANT_ROOT / "generated" / "q16" / "node_client_v1.mjs"
    script = (
        "import crypto from 'node:crypto'; const m=await import(process.argv[1]); "
        "const v=JSON.parse(process.argv[2]); console.log(JSON.stringify(v.map(x=>"
        "crypto.createHash('sha256').update(m.canonicalStringify(x)).digest('hex'))));"
    )
    completed = subprocess.run(
        ["node", "--input-type=module", "-e", script, str(client), json.dumps(vectors)],
        check=True,
        capture_output=True,
        text=True,
        timeout=15,
    )
    assert json.loads(completed.stdout) == expected


def test_frozen_valid_fixtures_pass_python_contract(protocol: ProtocolContractV1) -> None:
    fixture_path = REPO_ROOT / "packages" / "edge-protocol" / "fixtures" / "fixtures-v1.json"
    fixtures = strict_json_object(fixture_path.read_bytes(), maximum_bytes=262_144)
    valid = fixtures["valid"]
    assert isinstance(valid, list)
    for item in valid:
        assert isinstance(item, dict)
        envelope = item["envelope"]
        assert isinstance(envelope, dict)
        protocol.validate_envelope(envelope, maximum_bytes=262_144)


def test_protocol_rejects_unknown_version_field_schema_and_forbidden_key(
    protocol: ProtocolContractV1,
    pipeline_result: PipelineResultV1,
) -> None:
    assessment = deepcopy(pipeline_result.assessment)
    mutations = []
    version = deepcopy(assessment)
    version["version"] = 2
    mutations.append(version)
    boolean_version = deepcopy(assessment)
    boolean_version["version"] = True
    mutations.append(boolean_version)
    unknown_field = deepcopy(assessment)
    unknown_field["unexpected"] = True
    mutations.append(unknown_field)
    unknown_schema = deepcopy(assessment)
    unknown_schema["schema"] = "UnknownEnvelopeV1"
    mutations.append(unknown_schema)
    forbidden = deepcopy(assessment)
    economics = forbidden["economicAssumptionContext"]
    assert isinstance(economics, dict)
    economics["apiSecret"] = "redacted"
    mutations.append(forbidden)
    for mutation in mutations:
        with pytest.raises(ProtocolBoundaryError):
            protocol.validate_envelope(mutation, maximum_bytes=262_144)
    numeric_version = deepcopy(assessment)
    numeric_version["version"] = 1.0
    protocol.validate_envelope(numeric_version, maximum_bytes=262_144)


def test_forbidden_scan_is_recursive_without_echoing_value() -> None:
    with pytest.raises(ProtocolBoundaryError, match="forbidden") as error:
        reject_forbidden_keys({"outer": [{"api_key": "do-not-echo"}]})
    assert "do-not-echo" not in str(error.value)


@pytest.mark.parametrize(
    "key",
    ["api key", "api.key", "api/key", "private key", "listen.key", "order request"],
)
def test_forbidden_scan_rejects_separator_bypasses(key: str) -> None:
    with pytest.raises(ProtocolBoundaryError, match="forbidden"):
        reject_forbidden_keys({"outer": [{key: "redacted"}]})


def test_protocol_rejects_cross_language_unsafe_numbers() -> None:
    assert protocol_json_bytes({"value": 9_007_199_254_740_991})
    with pytest.raises(ProtocolBoundaryError, match="safe range"):
        protocol_json_bytes({"value": 9_007_199_254_740_992})
    with pytest.raises(ProtocolBoundaryError, match="safe subset"):
        protocol_json_bytes({"value": -5.205026471640213e16})


def test_ambiguous_assessment_cannot_become_actionable(
    protocol: ProtocolContractV1,
    pipeline_result: PipelineResultV1,
) -> None:
    for action in ("WATCH", "PROPOSE_CONSIDERATION"):
        assessment = deepcopy(pipeline_result.assessment)
        assessment["advisoryAction"] = action
        with pytest.raises(ProtocolBoundaryError, match="ABSTAIN_UNKNOWN"):
            protocol.validate_envelope(assessment, maximum_bytes=262_144)


def test_protocol_error_is_frozen_protocol_valid(protocol: ProtocolContractV1) -> None:
    value = protocol_error(
        code="REQUEST_REJECTED",
        message="request failed strict bounded validation",
        occurred_at_ms=1_772_000_000_200,
        correlation_id="q16.request.v1",
        stage="decode",
    )
    protocol.validate_envelope(value, maximum_bytes=262_144)
    assert value["safeCurrentState"] == "REQUEST_REJECTED_NO_ASSESSMENT"
    with pytest.raises(ContractValueError):
        protocol_error(
            code="not-upper",
            message="bad",
            occurred_at_ms=1_772_000_000_200,
            correlation_id=None,
            stage="decode",
        )


def test_protocol_contract_load_rejects_wrong_root_and_tampered_schema(tmp_path: Path) -> None:
    with pytest.raises(ContractValueError):
        ProtocolContractV1.load(Path("relative"))
    schema = REPO_ROOT / "packages" / "edge-protocol" / "schema" / "edge-protocol-v1.schema.json"
    target = tmp_path / "packages" / "edge-protocol" / "schema"
    target.mkdir(parents=True)
    (target / schema.name).write_bytes(schema.read_bytes() + b" ")
    with pytest.raises(ProtocolBoundaryError, match="digest mismatch"):
        ProtocolContractV1.load(tmp_path)
