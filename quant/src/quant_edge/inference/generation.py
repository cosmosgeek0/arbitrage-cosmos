"""Deterministic Q16 fixture, campaign and cross-language protocol-kit generation."""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Final, cast

from quant_edge.canonical import canonical_json_bytes, parse_canonical_object
from quant_edge.errors import ContractValueError
from quant_edge.inference.artifacts import build_serving_manifest, load_serving_lineage
from quant_edge.inference.contracts import InferenceLimitsV1, LocalRequestV1, RequestOperation
from quant_edge.inference.pipeline import run_inference_pipeline
from quant_edge.inference.protocol import ProtocolContractV1, protocol_json_bytes
from quant_edge.inference.service import LocalInferenceServiceV1

FIXTURE_CUTOFF_MS: Final = 1_772_000_000_100
FIXTURE_GENERATED_MS: Final = 1_772_000_000_200
FIXTURE_EXPIRES_MS: Final = 1_772_000_060_200

PYTHON_CLIENT = '''"""Generated Q16 strict one-request UDS client; local use only."""
from __future__ import annotations
import json
import math
import re
import socket
from pathlib import Path

MAXIMUM_SAFE_INTEGER = 9007199254740991
_FROZEN_SCHEMA = json.loads(r"""__FROZEN_SCHEMA_JSON__""")
_FORBIDDEN = (
    "signature", "apikey", "apisecret", "secret", "passphrase", "password",
    "privatekey", "listenkey", "credential", "approvedcapital", "orderrequest",
    "leveragemutation", "livesendpermission",
)
_WRAPPER_FIELDS = {
    "generatedAtMs", "operation", "payload", "requestId", "schema", "version",
}
_ASSESSMENT_REQUIRED = {
    "schema", "version", "revision", "assessmentId", "traceId", "parentEvidenceIds",
    "strategyFamily", "hypothesisId", "instrumentGraph", "eventTimeMs", "receiveTimeMs",
    "generationTimeMs", "expiryTimeMs", "predictions", "uncertainty", "oodState",
    "driftState", "netExpectedValue", "evidence", "lineage", "sourceQuality",
    "advisoryAction", "abstentionReasonCodes", "invalidationConditions",
    "economicAssumptionContext",
}
_ASSESSMENT_ALLOWED = _ASSESSMENT_REQUIRED | {
    "analogues", "capacityEvidence", "costEstimates", "featureAttribution",
    "grossEstimate", "marketStageProbabilities", "regimeProbabilities",
}
_ERROR_REQUIRED = {
    "schema", "version", "revision", "errorId", "code", "message", "occurredAtMs",
    "retryable", "component", "stage", "safeCurrentState",
    "recommendedOperatorAction", "correlationId",
}
_ERROR_ALLOWED = _ERROR_REQUIRED | {"sourceEnvelopeSchema", "sourceEnvelopeId"}
_READ_FIELDS = {
    "HEALTH": (
        "EdgeBrainHealthV1",
        {
            "schema", "version", "revision", "componentId", "generatedAtMs", "state",
            "truthLabel", "blockingReasons",
        },
        {
            "schema", "version", "revision", "componentId", "generatedAtMs", "state",
            "truthLabel", "blockingReasons", "lastSuccessMs", "lastErrorCode",
            "queueDepth", "modelVersions", "driftState",
        },
    ),
    "READINESS": (
        "Q16ReadinessV1",
        {
            "advisoryReady", "blockingReasonCodes", "limits", "modelReadiness",
            "processReady", "safeFallback", "schema", "serviceability", "version",
        },
        {
            "advisoryReady", "blockingReasonCodes", "limits", "modelReadiness",
            "processReady", "safeFallback", "schema", "serviceability", "version",
        },
    ),
    "LINEAGE": (
        "Q16ServingLineageV1",
        {
            "calibrationAvailable", "calibrationRevision", "champion", "deepGate",
            "dependencyLockSha256", "manifestSha256", "readiness", "schema",
            "shadowModelIds", "streaming", "version",
        },
        {
            "calibrationAvailable", "calibrationRevision", "champion", "deepGate",
            "dependencyLockSha256", "manifestSha256", "readiness", "schema",
            "shadowModelIds", "streaming", "version",
        },
    ),
    "METRICS": (
        "Q16ServiceMetricsV1",
        {
            "abstentions", "accepted", "completed", "protocolErrors", "queueDepth",
            "queueRejections", "schema", "serviceClosedRejections", "timeouts",
            "transportErrors", "version",
        },
        {
            "abstentions", "accepted", "completed", "protocolErrors", "queueDepth",
            "queueRejections", "schema", "serviceClosedRejections", "timeouts",
            "transportErrors", "version",
        },
    ),
}

def _pairs(items: list[tuple[str, object]]) -> dict[str, object]:
    value: dict[str, object] = {}
    for key, item in items:
        if key in value:
            raise ValueError("response contains a duplicate JSON key")
        value[key] = item
    return value

def _reject_constant(_token: str) -> object:
    raise ValueError("response contains a non-finite number")

def _walk(value: object, depth: int = 0) -> None:
    if depth > 64:
        raise ValueError("response nesting exceeds the client limit")
    if isinstance(value, dict):
        for key, item in value.items():
            normalized = "".join(character for character in key.casefold() if character.isalnum())
            if any(token in normalized for token in _FORBIDDEN):
                raise ValueError("response contains a forbidden authority or secret key")
            _walk(item, depth + 1)
    elif isinstance(value, list):
        for item in value:
            _walk(item, depth + 1)
    elif isinstance(value, int) and not isinstance(value, bool):
        if abs(value) > MAXIMUM_SAFE_INTEGER:
            raise ValueError("response integer exceeds the cross-language safe range")
    elif isinstance(value, float):
        if not math.isfinite(value) or (value == 0.0 and math.copysign(1.0, value) < 0):
            raise ValueError("response contains a non-finite or negative-zero number")

def _exact(value: dict[str, object], allowed: set[str], required: set[str]) -> None:
    if not required <= set(value) or not set(value) <= allowed:
        raise ValueError("response fields are not schema-exact")

def _integer(value: object, field: str) -> int:
    if (
        isinstance(value, bool)
        or not isinstance(value, int)
        or not 0 <= value <= MAXIMUM_SAFE_INTEGER
    ):
        raise ValueError(f"{field} must be a non-negative safe integer")
    return value

def _identifier(value: object, field: str) -> str:
    if not isinstance(value, str) or not value or len(value) > 256:
        raise ValueError(f"{field} must be bounded non-empty text")
    return value

def _json_type(value: object) -> str:
    if value is None: return "null"
    if isinstance(value, bool): return "boolean"
    if isinstance(value, int): return "integer"
    if isinstance(value, float): return "number"
    if isinstance(value, str): return "string"
    if isinstance(value, list): return "array"
    if isinstance(value, dict): return "object"
    return type(value).__name__

def _resolve(ref: str) -> dict[str, object]:
    if not ref.startswith("#/"):
        raise ValueError("external frozen-schema references are forbidden")
    node: object = _FROZEN_SCHEMA
    for part in ref[2:].split("/"):
        if not isinstance(node, dict) or part not in node:
            raise ValueError("frozen-schema reference is unresolved")
        node = node[part]
    if not isinstance(node, dict):
        raise ValueError("frozen-schema reference is malformed")
    return node

def _schema_errors(schema: dict[str, object], value: object, trail: str) -> list[str]:
    if "$ref" in schema:
        ref = schema["$ref"]
        if not isinstance(ref, str): return [f"{trail}: malformed ref"]
        return _schema_errors(_resolve(ref), value, trail)
    any_of = schema.get("anyOf")
    if isinstance(any_of, list):
        branches = [
            _schema_errors(branch, value, trail)
            for branch in any_of if isinstance(branch, dict)
        ]
        return [] if any(not branch for branch in branches) else [f"{trail}: no anyOf matched"]
    errors: list[str] = []
    if "const" in schema and (
        isinstance(value, bool) != isinstance(schema["const"], bool)
        or value != schema["const"]
    ):
        errors.append(f"{trail}: const mismatch")
    enum = schema.get("enum")
    if isinstance(enum, list) and value not in enum:
        errors.append(f"{trail}: enum mismatch")
    expected = schema.get("type")
    observed = _json_type(value)
    if isinstance(expected, str) and not (
        observed == expected or (expected == "number" and observed in {"integer", "number"})
    ):
        return [*errors, f"{trail}: expected {expected}"]
    if isinstance(value, str):
        pattern = schema.get("pattern")
        if isinstance(pattern, str) and re.fullmatch(pattern, value) is None:
            errors.append(f"{trail}: pattern mismatch")
        minimum = schema.get("minLength")
        maximum = schema.get("maxLength")
        if isinstance(minimum, int) and len(value) < minimum: errors.append(f"{trail}: too short")
        if isinstance(maximum, int) and len(value) > maximum: errors.append(f"{trail}: too long")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        minimum = schema.get("minimum")
        maximum = schema.get("maximum")
        if isinstance(minimum, (int, float)) and value < minimum: errors.append(f"{trail}: low")
        if isinstance(maximum, (int, float)) and value > maximum: errors.append(f"{trail}: high")
    if isinstance(value, list):
        maximum = schema.get("maxItems")
        if isinstance(maximum, int) and len(value) > maximum: errors.append(f"{trail}: too many")
        item_schema = schema.get("items")
        if isinstance(item_schema, dict):
            for index, item in enumerate(value):
                errors.extend(_schema_errors(item_schema, item, f"{trail}[{index}]"))
    if isinstance(value, dict):
        maximum = schema.get("maxProperties")
        if isinstance(maximum, int) and len(value) > maximum:
            errors.append(f"{trail}: too many keys")
        required = schema.get("required")
        if isinstance(required, list):
            errors.extend(f"{trail}: missing {key}" for key in required if key not in value)
        properties = schema.get("properties")
        additional = schema.get("additionalProperties")
        for key, item in value.items():
            if isinstance(properties, dict) and key in properties:
                child = properties[key]
                if isinstance(child, dict):
                    errors.extend(_schema_errors(child, item, f"{trail}.{key}"))
            elif additional is False:
                errors.append(f"{trail}: unknown {key}")
            elif isinstance(additional, dict):
                errors.extend(_schema_errors(additional, item, f"{trail}.{key}"))
    return errors

def _validate_frozen_envelope(value: dict[str, object]) -> None:
    definitions = _FROZEN_SCHEMA.get("$defs")
    schema_name = value.get("schema")
    if not isinstance(definitions, dict) or not isinstance(schema_name, str):
        raise ValueError("frozen envelope schema is unavailable")
    body = definitions.get(schema_name)
    if not isinstance(body, dict):
        raise ValueError("frozen envelope schema is unregistered")
    errors = _schema_errors(body, value, "$")
    if errors:
        raise ValueError("frozen envelope validation failed: " + "; ".join(errors[:4]))

def _validate_error(value: dict[str, object]) -> None:
    _validate_frozen_envelope(value)
    _exact(value, _ERROR_ALLOWED, _ERROR_REQUIRED)
    if (
        value["schema"] != "ProtocolErrorV1"
        or isinstance(value["version"], bool)
        or value["version"] != 1
    ):
        raise ValueError("protocol error schema/version is unsupported")
    _integer(value["revision"], "revision")
    _integer(value["occurredAtMs"], "occurredAtMs")
    _identifier(value["errorId"], "errorId")
    _identifier(value["code"], "code")
    if not isinstance(value["retryable"], bool):
        raise ValueError("retryable must be boolean")

def _validate_probabilities(value: object, field: str) -> None:
    if value is None:
        return
    if not isinstance(value, dict) or len(value) > 16:
        raise ValueError(f"{field} must be a bounded object")
    for probability in value.values():
        if isinstance(probability, bool) or not isinstance(probability, (int, float)):
            raise ValueError(f"{field} values must be numeric")
        if not 0 <= probability <= 1:
            raise ValueError(f"{field} values must be probabilities")

def _validate_assessment(value: dict[str, object]) -> None:
    _validate_frozen_envelope(value)
    _exact(value, _ASSESSMENT_ALLOWED, _ASSESSMENT_REQUIRED)
    if (
        value["schema"] != "EdgeAssessmentEnvelopeV1"
        or isinstance(value["version"], bool)
        or value["version"] != 1
    ):
        raise ValueError("assessment schema/version is unsupported")
    for field in ("revision", "receiveTimeMs", "generationTimeMs", "expiryTimeMs"):
        _integer(value[field], field)
    for field in ("assessmentId", "traceId", "strategyFamily", "hypothesisId"):
        _identifier(value[field], field)
    if value["advisoryAction"] not in {
        "IGNORE", "WATCH", "FOCUS", "PROPOSE_CONSIDERATION", "ABSTAIN_UNKNOWN",
    }:
        raise ValueError("assessment advisoryAction is unsupported")
    reasons = value["abstentionReasonCodes"]
    if not isinstance(reasons, list) or any(not isinstance(item, str) for item in reasons):
        raise ValueError("assessment abstentionReasonCodes must be text")
    if value["advisoryAction"] == "ABSTAIN_UNKNOWN" and not reasons:
        raise ValueError("ABSTAIN_UNKNOWN requires at least one reason")
    if not isinstance(value["predictions"], list) or len(value["predictions"]) > 64:
        raise ValueError("assessment predictions must be bounded")
    _validate_probabilities(value.get("marketStageProbabilities"), "marketStageProbabilities")
    _validate_probabilities(value.get("regimeProbabilities"), "regimeProbabilities")
    if not isinstance(value["netExpectedValue"], dict):
        raise ValueError("assessment netExpectedValue must be an object")
    if value["netExpectedValue"].get("state") not in {"ESTIMATED", "UNKNOWN"}:
        raise ValueError("assessment netExpectedValue state is unsupported")
    evidence = value.get("evidence")
    quality = value.get("sourceQuality")
    ambiguous = (
        value["netExpectedValue"].get("state") != "ESTIMATED"
        or not value["predictions"]
        or bool(reasons)
        or value.get("oodState") != "IN_DISTRIBUTION"
        or value.get("driftState") != "STABLE"
        or not isinstance(evidence, dict)
        or bool(evidence.get("conflicting"))
        or bool(evidence.get("missing"))
        or not isinstance(quality, dict)
        or quality.get("freshness") != "FRESH"
        or quality.get("completeness") != "COMPLETE"
        or quality.get("gapCount") != 0
    )
    if ambiguous and value["advisoryAction"] != "ABSTAIN_UNKNOWN":
        raise ValueError("unavailable or ambiguous truth requires ABSTAIN_UNKNOWN")

def _validate_read_payload(operation: str, value: object) -> None:
    if not isinstance(value, dict):
        raise ValueError("read response payload must be an object")
    schema, required, allowed = _READ_FIELDS[operation]
    _exact(value, allowed, required)
    if value["schema"] != schema or isinstance(value["version"], bool) or value["version"] != 1:
        raise ValueError("read response payload schema/version is unsupported")
    if operation == "HEALTH":
        _validate_frozen_envelope(value)
        _integer(value["revision"], "revision")
        _integer(value["generatedAtMs"], "generatedAtMs")
        if value["state"] not in {"OK", "DEGRADED", "STALE", "FAILED", "UNKNOWN"}:
            raise ValueError("health state is unsupported")
    elif operation == "READINESS":
        if not isinstance(value["processReady"], bool) or not isinstance(
            value["advisoryReady"], bool
        ):
            raise ValueError("readiness booleans are malformed")
        if value["safeFallback"] != "ABSTAIN_UNKNOWN":
            raise ValueError("readiness fallback must remain ABSTAIN_UNKNOWN")
    elif operation == "LINEAGE":
        if not isinstance(value["calibrationAvailable"], bool):
            raise ValueError("lineage calibrationAvailable must be boolean")
        if value["streaming"] != "NOT_JUSTIFIED":
            raise ValueError("lineage streaming state is unsupported")
    else:
        for field in (
            "abstentions", "accepted", "completed", "protocolErrors", "queueDepth",
            "queueRejections", "serviceClosedRejections", "timeouts", "transportErrors",
        ):
            _integer(value[field], field)

def validate_response(value: object) -> dict[str, object]:
    if not isinstance(value, dict):
        raise ValueError("response must be a JSON object")
    _walk(value)
    if value.get("schema") == "ProtocolErrorV1":
        _validate_error(value)
        return value
    _exact(value, _WRAPPER_FIELDS, _WRAPPER_FIELDS)
    if (
        value["schema"] != "Q16LocalInferenceResponseV1"
        or isinstance(value["version"], bool)
        or value["version"] != 1
    ):
        raise ValueError("local response schema/version is unsupported")
    operation = value["operation"]
    if operation not in {"ASSESS", "BATCH_ASSESS", "HEALTH", "READINESS", "LINEAGE", "METRICS"}:
        raise ValueError("local response operation is unsupported")
    _integer(value["generatedAtMs"], "generatedAtMs")
    _identifier(value["requestId"], "requestId")
    payload = value["payload"]
    if operation == "ASSESS":
        if not isinstance(payload, dict):
            raise ValueError("ASSESS payload must be an object")
        _validate_assessment(payload)
    elif operation == "BATCH_ASSESS":
        if not isinstance(payload, list) or not payload or len(payload) > 256:
            raise ValueError("BATCH_ASSESS payload must be a bounded non-empty array")
        for item in payload:
            if not isinstance(item, dict):
                raise ValueError("BATCH_ASSESS item must be an object")
            _validate_assessment(item)
    else:
        _validate_read_payload(operation, payload)
    return value

def _parse(raw: bytes) -> dict[str, object]:
    try:
        text = raw.decode("utf-8", errors="strict")
        value = json.loads(text, object_pairs_hook=_pairs, parse_constant=_reject_constant)
    except (UnicodeDecodeError, json.JSONDecodeError, RecursionError) as error:
        raise ValueError("response is not strict bounded JSON") from error
    return validate_response(value)

def request_bytes(
    socket_path: Path,
    payload_bytes: bytes,
    *,
    maximum_bytes: int = 262144,
    timeout_seconds: float = 2.0,
) -> dict[str, object]:
    if type(payload_bytes) is not bytes or not payload_bytes or len(payload_bytes) > maximum_bytes:
        raise ValueError("request exceeds the bounded local protocol frame")
    if b"\\n" in payload_bytes[:-1] or b"\\r" in payload_bytes:
        raise ValueError("request bytes must contain exactly one JSON frame")
    framed = payload_bytes if payload_bytes.endswith(b"\\n") else payload_bytes + b"\\n"
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
        client.settimeout(timeout_seconds)
        client.connect(str(socket_path))
        client.sendall(framed)
        received = bytearray()
        while not received.endswith(b"\\n"):
            chunk = client.recv(min(65536, maximum_bytes + 1 - len(received)))
            if not chunk:
                raise ValueError("local inference server closed before a complete frame")
            received.extend(chunk)
            if len(received) > maximum_bytes:
                raise ValueError("response exceeds the bounded local protocol frame")
    if b"\\n" in received[:-1]:
        raise ValueError("local inference server returned multiple frames")
    return _parse(bytes(received[:-1]))

def request_file(
    socket_path: Path,
    payload_path: Path,
    *,
    maximum_bytes: int = 262144,
    timeout_seconds: float = 2.0,
) -> dict[str, object]:
    return request_bytes(
        socket_path,
        payload_path.read_bytes(),
        maximum_bytes=maximum_bytes,
        timeout_seconds=timeout_seconds,
    )

def request(
    socket_path: Path,
    payload: dict[str, object],
    *,
    maximum_bytes: int = 262144,
    timeout_seconds: float = 2.0,
) -> dict[str, object]:
    _walk(payload)
    raw = json.dumps(
        payload,
        ensure_ascii=False,
        allow_nan=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return request_bytes(
        socket_path,
        raw,
        maximum_bytes=maximum_bytes,
        timeout_seconds=timeout_seconds,
    )
'''

NODE_CLIENT = """// Generated Q16 strict one-request UDS client; local use only.
import fs from 'node:fs';
import net from 'node:net';
import { TextDecoder } from 'node:util';

const MAXIMUM_SAFE_INTEGER = 9007199254740991;
const FROZEN_SCHEMA = __FROZEN_SCHEMA_JSON__;
const STRICT_UTF8 = new TextDecoder('utf-8', { fatal: true });
const FORBIDDEN = [
  'signature', 'apikey', 'apisecret', 'secret', 'passphrase', 'password',
  'privatekey', 'listenkey', 'credential', 'approvedcapital', 'orderrequest',
  'leveragemutation', 'livesendpermission',
];
const WRAPPER_FIELDS = ['generatedAtMs', 'operation', 'payload', 'requestId', 'schema', 'version'];
const ASSESSMENT_REQUIRED = [
  'schema', 'version', 'revision', 'assessmentId', 'traceId', 'parentEvidenceIds',
  'strategyFamily', 'hypothesisId', 'instrumentGraph', 'eventTimeMs', 'receiveTimeMs',
  'generationTimeMs', 'expiryTimeMs', 'predictions', 'uncertainty', 'oodState',
  'driftState', 'netExpectedValue', 'evidence', 'lineage', 'sourceQuality',
  'advisoryAction', 'abstentionReasonCodes', 'invalidationConditions',
  'economicAssumptionContext',
];
const ASSESSMENT_ALLOWED = [...ASSESSMENT_REQUIRED,
  'analogues', 'capacityEvidence', 'costEstimates', 'featureAttribution', 'grossEstimate',
  'marketStageProbabilities', 'regimeProbabilities'];
const ERROR_REQUIRED = [
  'schema', 'version', 'revision', 'errorId', 'code', 'message', 'occurredAtMs',
  'retryable', 'component', 'stage', 'safeCurrentState', 'recommendedOperatorAction',
  'correlationId',
];
const ERROR_ALLOWED = [...ERROR_REQUIRED, 'sourceEnvelopeSchema', 'sourceEnvelopeId'];
const READ_FIELDS = {
  HEALTH: [
    'EdgeBrainHealthV1',
    ['schema', 'version', 'revision', 'componentId', 'generatedAtMs', 'state',
      'truthLabel', 'blockingReasons'],
    ['schema', 'version', 'revision', 'componentId', 'generatedAtMs', 'state',
      'truthLabel', 'blockingReasons', 'lastSuccessMs', 'lastErrorCode', 'queueDepth',
      'modelVersions', 'driftState'],
  ],
  READINESS: [
    'Q16ReadinessV1',
    ['advisoryReady', 'blockingReasonCodes', 'limits', 'modelReadiness', 'processReady',
      'safeFallback', 'schema', 'serviceability', 'version'],
    ['advisoryReady', 'blockingReasonCodes', 'limits', 'modelReadiness', 'processReady',
      'safeFallback', 'schema', 'serviceability', 'version'],
  ],
  LINEAGE: [
    'Q16ServingLineageV1',
    ['calibrationAvailable', 'calibrationRevision', 'champion', 'deepGate',
      'dependencyLockSha256', 'manifestSha256', 'readiness', 'schema', 'shadowModelIds',
      'streaming', 'version'],
    ['calibrationAvailable', 'calibrationRevision', 'champion', 'deepGate',
      'dependencyLockSha256', 'manifestSha256', 'readiness', 'schema', 'shadowModelIds',
      'streaming', 'version'],
  ],
  METRICS: [
    'Q16ServiceMetricsV1',
    ['abstentions', 'accepted', 'completed', 'protocolErrors', 'queueDepth',
      'queueRejections', 'schema', 'serviceClosedRejections', 'timeouts',
      'transportErrors', 'version'],
    ['abstentions', 'accepted', 'completed', 'protocolErrors', 'queueDepth',
      'queueRejections', 'schema', 'serviceClosedRejections', 'timeouts',
      'transportErrors', 'version'],
  ],
};

function fail(message) { throw new Error(message); }
function jsonType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}
function resolveRef(ref) {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) fail('external schema ref');
  let node = FROZEN_SCHEMA;
  for (const part of ref.slice(2).split('/')) {
    if (!node || typeof node !== 'object' || !(part in node)) fail('unresolved schema ref');
    node = node[part];
  }
  if (!node || typeof node !== 'object' || Array.isArray(node)) fail('malformed schema ref');
  return node;
}
function schemaErrors(schema, value, trail) {
  if ('$ref' in schema) return schemaErrors(resolveRef(schema.$ref), value, trail);
  if (Array.isArray(schema.anyOf)) {
    const branches = schema.anyOf.map((branch) => schemaErrors(branch, value, trail));
    return branches.some((branch) => branch.length === 0) ? [] : [`${trail}: no anyOf`];
  }
  const errors = [];
  if ('const' in schema && value !== schema.const) errors.push(`${trail}: const`);
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) errors.push(`${trail}: enum`);
  const observed = jsonType(value);
  if (
    typeof schema.type === 'string'
    && observed !== schema.type
    && !(schema.type === 'number' && (observed === 'integer' || observed === 'number'))
  ) return [...errors, `${trail}: type`];
  if (typeof value === 'string') {
    if (typeof schema.pattern === 'string') {
      const expression = new RegExp(`^(?:${schema.pattern})$`, 'u');
      if (!expression.test(value)) errors.push(`${trail}: pattern`);
    }
    if (Number.isInteger(schema.minLength) && value.length < schema.minLength) {
      errors.push(`${trail}: short`);
    }
    if (Number.isInteger(schema.maxLength) && value.length > schema.maxLength) {
      errors.push(`${trail}: long`);
    }
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) errors.push(`${trail}: low`);
    if (typeof schema.maximum === 'number' && value > schema.maximum) errors.push(`${trail}: high`);
  }
  if (Array.isArray(value)) {
    if (Number.isInteger(schema.maxItems) && value.length > schema.maxItems) {
      errors.push(`${trail}: too many`);
    }
    if (schema.items && typeof schema.items === 'object') {
      value.forEach((item, index) => {
        errors.push(...schemaErrors(schema.items, item, `${trail}[${index}]`));
      });
    }
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const keys = Object.keys(value);
    if (Number.isInteger(schema.maxProperties) && keys.length > schema.maxProperties) {
      errors.push(`${trail}: too many keys`);
    }
    if (Array.isArray(schema.required)) {
      schema.required.forEach((key) => {
        if (!(key in value)) errors.push(`${trail}: missing ${key}`);
      });
    }
    keys.forEach((key) => {
      if (schema.properties && key in schema.properties) {
        errors.push(...schemaErrors(schema.properties[key], value[key], `${trail}.${key}`));
      } else if (schema.additionalProperties === false) {
        errors.push(`${trail}: unknown ${key}`);
      } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        errors.push(...schemaErrors(schema.additionalProperties, value[key], `${trail}.${key}`));
      }
    });
  }
  return errors;
}
function validateFrozenEnvelope(value) {
  const body = FROZEN_SCHEMA.$defs && FROZEN_SCHEMA.$defs[value.schema];
  if (!body || typeof body !== 'object') fail('frozen envelope schema is unregistered');
  const errors = schemaErrors(body, value, '$');
  if (errors.length) fail(`frozen envelope validation failed: ${errors.slice(0, 4).join('; ')}`);
}
function exact(value, allowed, required) {
  const keys = Object.keys(value);
  if (keys.some((key) => !allowed.includes(key)) || required.some((key) => !keys.includes(key))) {
    fail('response fields are not schema-exact');
  }
}
function integer(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(`${field} must be a non-negative safe integer`);
  }
  return value;
}
function identifier(value, field) {
  if (typeof value !== 'string' || !value.length || value.length > 256) {
    fail(`${field} must be bounded non-empty text`);
  }
  return value;
}
function walk(value, depth = 0) {
  if (depth > 64) fail('response nesting exceeds the client limit');
  if (Array.isArray(value)) {
    value.forEach((item) => walk(item, depth + 1));
  } else if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) => {
      const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (FORBIDDEN.some((token) => normalized.includes(token))) {
        fail('response contains a forbidden authority or secret key');
      }
      walk(item, depth + 1);
    });
  } else if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) fail('response contains an unsafe number');
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      fail('response integer exceeds safe range');
    }
  }
}

export function strictParse(text) {
  if (typeof text !== 'string' || !text.length) fail('response is not strict JSON');
  let index = 0;
  const whitespace = () => { while (/[\\t\\n\\r ]/.test(text[index] || '')) index += 1; };
  const parseString = () => {
    const start = index;
    index += 1;
    while (index < text.length) {
      if (text[index] === '"') {
        index += 1;
        try {
          return JSON.parse(text.slice(start, index));
        } catch {
          fail('response string is malformed');
        }
      }
      if (text[index] === '\\\\') index += 1;
      index += 1;
    }
    return fail('response string is incomplete');
  };
  const parseNumber = () => {
    const match = text.slice(index).match(/^-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/);
    if (!match) return fail('response number is malformed');
    index += match[0].length;
    const number = Number(match[0]);
    if (!Number.isFinite(number) || Object.is(number, -0)) fail('response number is unsafe');
    if (!match[0].match(/[.eE]/) && !Number.isSafeInteger(number)) {
      fail('response integer exceeds safe range');
    }
    return number;
  };
  const parseValue = (depth = 0) => {
    if (depth > 64) fail('response nesting exceeds the client limit');
    whitespace();
    if (text[index] === '"') return parseString();
    if (text[index] === '[') {
      const result = [];
      index += 1;
      whitespace();
      if (text[index] === ']') { index += 1; return result; }
      while (true) {
        result.push(parseValue(depth + 1));
        whitespace();
        if (text[index] === ']') { index += 1; return result; }
        if (text[index] !== ',') fail('response array is malformed');
        index += 1;
      }
    }
    if (text[index] === '{') {
      const result = {};
      const seen = new Set();
      index += 1;
      whitespace();
      if (text[index] === '}') { index += 1; return result; }
      while (true) {
        whitespace();
        if (text[index] !== '"') fail('response object key is malformed');
        const key = parseString();
        if (seen.has(key)) fail('response contains a duplicate JSON key');
        seen.add(key);
        whitespace();
        if (text[index] !== ':') fail('response object is malformed');
        index += 1;
        result[key] = parseValue(depth + 1);
        whitespace();
        if (text[index] === '}') { index += 1; return result; }
        if (text[index] !== ',') fail('response object is malformed');
        index += 1;
      }
    }
    for (const [token, value] of [['true', true], ['false', false], ['null', null]]) {
      if (text.startsWith(token, index)) { index += token.length; return value; }
    }
    return parseNumber();
  };
  const result = parseValue();
  whitespace();
  if (index !== text.length) fail('response has trailing non-whitespace data');
  walk(result);
  return result;
}

export function canonicalStringify(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const pairs = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`);
    return `{${pairs.join(',')}}`;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) fail('non-finite or negative-zero number');
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) fail('unsafe integer Number');
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) fail('unsupported request value');
  return encoded;
}

function validateError(value) {
  validateFrozenEnvelope(value);
  exact(value, ERROR_ALLOWED, ERROR_REQUIRED);
  if (value.schema !== 'ProtocolErrorV1' || value.version !== 1) {
    fail('protocol error schema/version is unsupported');
  }
  integer(value.revision, 'revision');
  integer(value.occurredAtMs, 'occurredAtMs');
  identifier(value.errorId, 'errorId');
  identifier(value.code, 'code');
  if (typeof value.retryable !== 'boolean') fail('retryable must be boolean');
}
function validateProbabilities(value, field) {
  if (value === undefined || value === null) return;
  if (
    !value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length > 16
  ) {
    fail(`${field} must be a bounded object`);
  }
  Object.values(value).forEach((probability) => {
    if (typeof probability !== 'number' || probability < 0 || probability > 1) {
      fail(`${field} values must be probabilities`);
    }
  });
}
function validateAssessment(value) {
  validateFrozenEnvelope(value);
  exact(value, ASSESSMENT_ALLOWED, ASSESSMENT_REQUIRED);
  if (value.schema !== 'EdgeAssessmentEnvelopeV1' || value.version !== 1) {
    fail('assessment schema/version is unsupported');
  }
  ['revision', 'receiveTimeMs', 'generationTimeMs', 'expiryTimeMs'].forEach(
    (field) => integer(value[field], field),
  );
  ['assessmentId', 'traceId', 'strategyFamily', 'hypothesisId'].forEach(
    (field) => identifier(value[field], field),
  );
  const actions = ['IGNORE', 'WATCH', 'FOCUS', 'PROPOSE_CONSIDERATION', 'ABSTAIN_UNKNOWN'];
  if (!actions.includes(value.advisoryAction)) {
    fail('assessment advisoryAction is unsupported');
  }
  if (
    !Array.isArray(value.abstentionReasonCodes)
    || value.abstentionReasonCodes.some((item) => typeof item !== 'string')
  ) {
    fail('assessment abstentionReasonCodes must be text');
  }
  if (value.advisoryAction === 'ABSTAIN_UNKNOWN' && !value.abstentionReasonCodes.length) {
    fail('ABSTAIN_UNKNOWN requires at least one reason');
  }
  if (!Array.isArray(value.predictions) || value.predictions.length > 64) {
    fail('assessment predictions must be bounded');
  }
  validateProbabilities(value.marketStageProbabilities, 'marketStageProbabilities');
  validateProbabilities(value.regimeProbabilities, 'regimeProbabilities');
  if (
    !value.netExpectedValue || typeof value.netExpectedValue !== 'object'
    || Array.isArray(value.netExpectedValue)
  ) {
    fail('assessment netExpectedValue must be an object');
  }
  if (!['ESTIMATED', 'UNKNOWN'].includes(value.netExpectedValue.state)) {
    fail('netExpectedValue state is unsupported');
  }
  const evidence = value.evidence;
  const quality = value.sourceQuality;
  const ambiguous = (
    value.netExpectedValue.state !== 'ESTIMATED'
    || !value.predictions.length
    || value.abstentionReasonCodes.length > 0
    || value.oodState !== 'IN_DISTRIBUTION'
    || value.driftState !== 'STABLE'
    || !evidence || typeof evidence !== 'object' || Array.isArray(evidence)
    || Boolean(evidence && evidence.conflicting && evidence.conflicting.length)
    || Boolean(evidence && evidence.missing && evidence.missing.length)
    || !quality || typeof quality !== 'object' || Array.isArray(quality)
    || quality.freshness !== 'FRESH'
    || quality.completeness !== 'COMPLETE'
    || quality.gapCount !== 0
  );
  if (ambiguous && value.advisoryAction !== 'ABSTAIN_UNKNOWN') {
    fail('unavailable or ambiguous truth requires ABSTAIN_UNKNOWN');
  }
}
function validateReadPayload(operation, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('read response payload must be an object');
  }
  const [schema, required, allowed] = READ_FIELDS[operation];
  exact(value, allowed, required);
  if (value.schema !== schema || value.version !== 1) {
    fail('read response payload schema/version is unsupported');
  }
  if (operation === 'HEALTH') {
    validateFrozenEnvelope(value);
    integer(value.revision, 'revision');
    integer(value.generatedAtMs, 'generatedAtMs');
    if (!['OK', 'DEGRADED', 'STALE', 'FAILED', 'UNKNOWN'].includes(value.state)) {
      fail('health state is unsupported');
    }
  } else if (operation === 'READINESS') {
    if (typeof value.processReady !== 'boolean' || typeof value.advisoryReady !== 'boolean') {
      fail('readiness booleans are malformed');
    }
    if (value.safeFallback !== 'ABSTAIN_UNKNOWN') fail('readiness fallback is unsafe');
  } else if (operation === 'LINEAGE') {
    if (typeof value.calibrationAvailable !== 'boolean') {
      fail('calibrationAvailable must be boolean');
    }
    if (value.streaming !== 'NOT_JUSTIFIED') fail('lineage streaming state is unsupported');
  } else {
    const counters = [
      'abstentions', 'accepted', 'completed', 'protocolErrors', 'queueDepth',
      'queueRejections', 'serviceClosedRejections', 'timeouts', 'transportErrors',
    ];
    counters.forEach((field) => integer(value[field], field));
  }
}

export function validateResponse(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('response must be a JSON object');
  }
  walk(value);
  if (value.schema === 'ProtocolErrorV1') { validateError(value); return value; }
  exact(value, WRAPPER_FIELDS, WRAPPER_FIELDS);
  if (value.schema !== 'Q16LocalInferenceResponseV1' || value.version !== 1) {
    fail('local response schema/version is unsupported');
  }
  const operations = ['ASSESS', 'BATCH_ASSESS', 'HEALTH', 'READINESS', 'LINEAGE', 'METRICS'];
  if (!operations.includes(value.operation)) {
    fail('local response operation is unsupported');
  }
  integer(value.generatedAtMs, 'generatedAtMs');
  identifier(value.requestId, 'requestId');
  if (value.operation === 'ASSESS') {
    if (!value.payload || typeof value.payload !== 'object' || Array.isArray(value.payload)) {
      fail('ASSESS payload must be an object');
    }
    validateAssessment(value.payload);
  } else if (value.operation === 'BATCH_ASSESS') {
    if (!Array.isArray(value.payload) || !value.payload.length || value.payload.length > 256) {
      fail('BATCH_ASSESS payload must be bounded');
    }
    value.payload.forEach(validateAssessment);
  } else {
    validateReadPayload(value.operation, value.payload);
  }
  return value;
}

export function requestBytes(socketPath, payloadBytes, maximumBytes = 262144, timeoutMs = 2000) {
  if (!(payloadBytes instanceof Uint8Array)) fail('request bytes must be Uint8Array');
  const raw = Buffer.from(payloadBytes);
  if (!raw.length || raw.length > maximumBytes) fail('request exceeds bounded local frame');
  if (raw.includes(13) || raw.subarray(0, -1).includes(10)) {
    fail('request bytes must contain exactly one JSON frame');
  }
  const framed = raw.at(-1) === 10 ? raw : Buffer.concat([raw, Buffer.from('\\n')]);
  return new Promise((resolve, reject) => {
    const client = net.createConnection({ path: socketPath });
    let received = Buffer.alloc(0);
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      client.destroy();
      if (error) reject(error); else resolve(value);
    };
    client.setTimeout(timeoutMs, () => finish(new Error('local inference request timed out')));
    client.on('connect', () => client.write(framed));
    client.on('data', (chunk) => {
      received = Buffer.concat([received, chunk]);
      if (received.length > maximumBytes) {
        return finish(new Error('response exceeds bounded local frame'));
      }
      const newline = received.indexOf(10);
      if (newline >= 0) {
        if (newline !== received.length - 1) {
          return finish(new Error('server returned multiple response frames'));
        }
        try {
          const text = STRICT_UTF8.decode(received.subarray(0, -1));
          const value = strictParse(text);
          return finish(null, validateResponse(value));
        } catch (error) {
          return finish(error);
        }
      }
      return undefined;
    });
    client.on('error', (error) => finish(error));
    client.on('end', () => {
      if (!settled) finish(new Error('incomplete response frame'));
    });
  });
}

export function requestFile(socketPath, payloadPath, maximumBytes = 262144, timeoutMs = 2000) {
  return requestBytes(socketPath, fs.readFileSync(payloadPath), maximumBytes, timeoutMs);
}

export function request(socketPath, payload, maximumBytes = 262144, timeoutMs = 2000) {
  const raw = Buffer.from(canonicalStringify(payload), 'utf8');
  return requestBytes(socketPath, raw, maximumBytes, timeoutMs);
}
"""


def build_raw_fixture(quant_root: Path) -> dict[str, object]:
    if not isinstance(quant_root, Path) or not quant_root.is_absolute():
        raise ContractValueError("quant_root must be an absolute pathlib.Path")
    path = quant_root / "fixtures" / "q04_replay_golden_v1.json"
    raw = path.read_bytes()
    source = parse_canonical_object(raw)
    spot = source.get("spot")
    if not isinstance(spot, dict) or not isinstance(spot.get("script"), dict):
        raise ContractValueError("accepted Q04 Spot fixture is malformed")
    fixture_id = "q16.synthetic.raw.spot-book.v1"
    return {
        "economicAssumptionContext": {
            "asOfMs": FIXTURE_GENERATED_MS,
            "borrow": {
                "availability": "UNKNOWN",
                "expiresAtMs": None,
                "interestConvention": None,
                "quantity": None,
                "rateHourly": None,
            },
            "expiresAtMs": FIXTURE_EXPIRES_MS,
            "feeTier": {
                "makerBps": None,
                "source": "UNAVAILABLE_SYNTHETIC_FIXTURE",
                "takerBps": None,
                "uncertainty": "No account or venue fee truth in Q16.",
            },
            "funding": {
                "intervalHours": None,
                "nextFundingTimeMs": None,
                "rate": None,
                "source": None,
            },
            "intendedSize": "1000",
            "latencyScenarioMs": None,
            "missingFields": [
                "borrow",
                "feeTier",
                "funding",
                "latencyScenarioMs",
                "recoveryCostScenario",
            ],
            "quoteCurrency": "USDT",
            "recoveryCostScenario": None,
            "sourceSnapshotIds": [fixture_id],
            "spreadSlippageModel": {"name": "UNAVAILABLE", "version": "v1"},
            "state": "HYPOTHETICAL",
        },
        "expiresAtMs": FIXTURE_EXPIRES_MS,
        "featureCutoffTimeMs": FIXTURE_CUTOFF_MS,
        "fixtureId": fixture_id,
        "generatedAtMs": FIXTURE_GENERATED_MS,
        "schema": "Q16RawInferenceFixtureV1",
        "sourceFixtureSha256": hashlib.sha256(raw).hexdigest(),
        "spotBookScript": spot["script"],
        "traceId": "q16.trace.synthetic.v1",
        "truthLabel": "SYNTHETIC",
        "version": 1,
    }


def _sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def _protocol_kit_manifest(
    artifacts: dict[str, bytes],
    *,
    protocol: ProtocolContractV1,
) -> bytes:
    rows = [
        {
            "byteLength": len(raw),
            "relativePath": relative_path,
            "sha256": _sha(raw),
        }
        for relative_path, raw in sorted(artifacts.items())
        if relative_path.startswith("generated/q16/")
    ]
    return canonical_json_bytes(
        {
            "artifacts": rows,
            "frozenProtocolSchemaSha256": protocol.schema_sha256.hexdigest,
            "generator": "quant_edge.inference.generation:build_q16_artifacts",
            "posture": "SYNTHETIC_ONLY",
            "schema": "Q16GeneratedProtocolKitManifestV1",
            "version": 1,
        }
    )


def build_q16_artifacts(repo_root: Path) -> dict[str, bytes]:
    if not isinstance(repo_root, Path) or not repo_root.is_absolute():
        raise ContractValueError("repo_root must be an absolute pathlib.Path")
    quant_root = repo_root / "quant"
    protocol = ProtocolContractV1.load(repo_root)
    serving_manifest = build_serving_manifest(quant_root)
    lineage = load_serving_lineage(quant_root, serving_manifest)
    raw_fixture = build_raw_fixture(quant_root)
    pipeline = run_inference_pipeline(raw_fixture, lineage=lineage, protocol=protocol)
    request = LocalRequestV1(
        request_id="q16.request.synthetic.v1",
        operation=RequestOperation.ASSESS,
        generated_at_ms=FIXTURE_GENERATED_MS,
        items=(raw_fixture,),
    )
    service = LocalInferenceServiceV1(
        limits=InferenceLimitsV1(),
        lineage=lineage,
        protocol=protocol,
    )
    health_request = LocalRequestV1(
        request_id="q16.request.health.v1",
        operation=RequestOperation.HEALTH,
        generated_at_ms=FIXTURE_GENERATED_MS,
    )
    health_response = service.handle_request(
        health_request,
        evaluation_time_ms=FIXTURE_GENERATED_MS,
    )
    if not hasattr(health_response, "as_mapping"):
        raise ContractValueError("deterministic health request was unexpectedly rejected")
    health_mapping = cast(object, health_response.as_mapping())
    wrapped_assessment = service.handle_request(
        request,
        evaluation_time_ms=FIXTURE_GENERATED_MS,
    )
    if not hasattr(wrapped_assessment, "as_mapping"):
        raise ContractValueError("deterministic assessment request was unexpectedly rejected")
    wrapped_assessment_mapping = cast(object, wrapped_assessment.as_mapping())
    frozen_schema_json = protocol_json_bytes(protocol.schema_document).decode("utf-8")
    python_client = PYTHON_CLIENT.replace("__FROZEN_SCHEMA_JSON__", frozen_schema_json)
    node_client = NODE_CLIENT.replace("__FROZEN_SCHEMA_JSON__", frozen_schema_json)
    artifacts: dict[str, bytes] = {
        "fixtures/q16_raw_fixture_v1.json": canonical_json_bytes(raw_fixture),
        "generated/q16/edge_assessment.v1.json": protocol_json_bytes(pipeline.assessment),
        "generated/q16/inference_campaign.v1.json": canonical_json_bytes(
            {
                "assessmentSha256": pipeline.assessment_sha256.hexdigest,
                "calibrationStatus": pipeline.calibration_state["status"],
                "championAvailability": lineage.champion_availability.value,
                "finalAction": pipeline.assessment["advisoryAction"],
                "health": health_mapping,
                "pipeline": pipeline.as_mapping(),
                "posture": "SYNTHETIC_ONLY",
                "schema": "Q16InferenceCampaignV1",
                "servingManifestSha256": serving_manifest.digest.hexdigest,
                "version": 1,
            }
        ),
        "generated/q16/market_evidence.v1.json": protocol_json_bytes(pipeline.evidence),
        "generated/q16/node_client_v1.mjs": node_client.encode(),
        "generated/q16/python_client_v1.py": python_client.encode(),
        "generated/q16/request_assess.v1.json": canonical_json_bytes(
            request.as_mapping()
        ).removesuffix(b"\n"),
        "generated/q16/response_assess_wrapped.v1.json": protocol_json_bytes(
            wrapped_assessment_mapping
        ),
        "generated/q16/serving_manifest.v1.json": serving_manifest.canonical_bytes,
    }
    markdown = [
        "# Q16 local inference campaign (synthetic only)",
        "",
        "- Frozen protocol: `22/22` remains a separate required gate.",
        f"- Serving manifest SHA-256: `{serving_manifest.digest.hexdigest}`.",
        f"- Assessment SHA-256: `{pipeline.assessment_sha256.hexdigest}`.",
        "- Final action: `ABSTAIN_UNKNOWN`.",
        "- Health: `DEGRADED`; process readiness is safe-abstain-only.",
        "- Q15 champion payload: `UNAVAILABLE_NONLOADABLE`; no score was fabricated.",
        "",
        "## Local startup (Python 3.13)",
        "",
        "Create the service with `build_serving_manifest(QUANT_ROOT)`, then",
        "`load_serving_lineage(QUANT_ROOT, manifest)`,",
        "`ProtocolContractV1.load(REPO_ROOT)` and `LocalInferenceServiceV1`.",
        "Create `create_unix_server(path=SOCKET_PATH, service=service,",
        "fallback_now_ms=trusted_clock_ms)`, where `trusted_clock_ms` is an injected",
        "callable returning current UTC milliseconds. Run `handle.server.serve_forever()`",
        "inside `try`, and always call `handle.close()` in `finally`.",
        "The socket parent must be owner mode `0700`; the socket is forced to `0600`.",
        "Optional TCP may use only literal `127.0.0.1` or `::1`.",
        "",
        "## Client calls",
        "",
        "Python: import `python_client_v1.py` and call",
        "`request_file(SOCKET_PATH, Path('request_assess.v1.json'))`.",
        "Node: import `node_client_v1.mjs` and call",
        "`await requestFile(socketPath, 'request_assess.v1.json')`.",
        "Use the raw-file APIs for the committed request so nanosecond integers are not",
        "rounded by JavaScript. Both clients default to a 2-second timeout.",
        "Supported operations are ASSESS, BATCH_ASSESS, HEALTH, READINESS, LINEAGE and",
        "METRICS. Treat ProtocolErrorV1, timeout, disconnect, malformed response or",
        "anything other than a validated response as no assessment.",
        "",
        "## Fail-closed posture",
        "",
        "The generated assessment is synthetic and must remain `ABSTAIN_UNKNOWN` while",
        "the accepted model/calibration payload is unavailable. Never convert health",
        "`DEGRADED`, readiness `SAFE_ABSTAIN_ONLY`, unknown economics, stale evidence or",
        "any blocker into actionable advice. Shared Node/product wiring remains a later",
        "director integration action.",
        "",
    ]
    artifacts["generated/q16/inference_campaign.v1.md"] = "\n".join(markdown).encode()
    artifacts["generated/q16/protocol_kit_manifest.v1.json"] = _protocol_kit_manifest(
        artifacts,
        protocol=protocol,
    )
    return artifacts
