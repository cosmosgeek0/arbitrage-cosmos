"""Strict frozen EDGE_PROTOCOL_V1 validation and deterministic protocol bytes."""

from __future__ import annotations

import hashlib
import json
import math
import re
from copy import deepcopy
from dataclasses import dataclass, field
from decimal import Decimal
from pathlib import Path
from typing import Final, cast

from quant_edge.errors import ContractValueError, QuantEdgeError
from quant_edge.lake.contracts import DigestV1

FROZEN_SCHEMA_SHA256: Final = "229af0ff13d600c7d305c6deb7f57b61bdb6f8a35f6f2349d91f5ab1b4972f1c"
MAX_NESTING: Final = 64
MAX_SAFE_INTEGER: Final = 9_007_199_254_740_991
FORBIDDEN_KEY: Final = re.compile(
    r"signature|api_?key|api_?secret|secret|passphrase|password|privatekey|"
    r"listenkey|credential|approvedcapital|orderrequest|leveragemutation|livesendpermission",
    re.IGNORECASE,
)
_PROTOCOL_CONTRACT_TOKEN: Final = object()


class ProtocolBoundaryError(QuantEdgeError):
    """Protocol syntax, integrity, compatibility or size failed closed."""


def _object_without_duplicates(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ProtocolBoundaryError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def _parse_int(token: str) -> int:
    if token == "-0":
        raise ProtocolBoundaryError("negative zero is not accepted")
    return int(token)


def _parse_float(token: str) -> float:
    value = float(token)
    if not math.isfinite(value) or (value == 0.0 and token.startswith("-")):
        raise ProtocolBoundaryError("non-finite and negative-zero numbers are not accepted")
    return value


def _reject_constant(token: str) -> object:
    raise ProtocolBoundaryError(f"non-finite JSON number is forbidden: {token}")


def _check_depth(value: object, *, depth: int = 0) -> None:
    if depth > MAX_NESTING:
        raise ProtocolBoundaryError(f"JSON nesting exceeds {MAX_NESTING}")
    if isinstance(value, list):
        for item in value:
            _check_depth(item, depth=depth + 1)
    elif isinstance(value, dict):
        for key, item in value.items():
            if not isinstance(key, str):
                raise ProtocolBoundaryError("JSON object keys must be strings")
            try:
                key.encode("utf-8", errors="strict")
            except UnicodeEncodeError as error:
                raise ProtocolBoundaryError("JSON keys must be strict UTF-8") from error
            _check_depth(item, depth=depth + 1)
    elif isinstance(value, str):
        try:
            value.encode("utf-8", errors="strict")
        except UnicodeEncodeError as error:
            raise ProtocolBoundaryError("JSON strings must be strict UTF-8") from error
    elif isinstance(value, float) and not math.isfinite(value):
        raise ProtocolBoundaryError("non-finite JSON numbers are forbidden")


def _check_protocol_numbers(value: object) -> None:
    if isinstance(value, list):
        for item in value:
            _check_protocol_numbers(item)
    elif isinstance(value, dict):
        for item in value.values():
            _check_protocol_numbers(item)
    elif isinstance(value, int) and not isinstance(value, bool):
        if abs(value) > MAX_SAFE_INTEGER:
            raise ProtocolBoundaryError("integer exceeds the cross-language safe range")
    elif isinstance(value, float) and (
        (value.is_integer() and abs(value) > MAX_SAFE_INTEGER)
        or float(format(value, ".15g")) != value
    ):
        raise ProtocolBoundaryError("number is outside the cross-language safe subset")


def strict_json_object(raw: bytes, *, maximum_bytes: int) -> dict[str, object]:
    if type(raw) is not bytes or not raw or len(raw) > maximum_bytes:
        raise ProtocolBoundaryError("JSON frame is empty or exceeds the byte limit")
    try:
        text = raw.decode("utf-8", errors="strict")
    except UnicodeDecodeError as error:
        raise ProtocolBoundaryError("JSON frame must be strict UTF-8") from error
    try:
        value = cast(
            object,
            json.loads(
                text,
                object_pairs_hook=_object_without_duplicates,
                parse_int=_parse_int,
                parse_float=_parse_float,
                parse_constant=_reject_constant,
            ),
        )
    except ProtocolBoundaryError:
        raise
    except (json.JSONDecodeError, RecursionError) as error:
        raise ProtocolBoundaryError("JSON frame is malformed or too deeply nested") from error
    _check_depth(value)
    if not isinstance(value, dict):
        raise ProtocolBoundaryError("top-level JSON frame must be an object")
    return value


def _utf16_key(value: str) -> bytes:
    return value.encode("utf-16-be", errors="strict")


def _number_text(value: float) -> str:
    if not math.isfinite(value) or (value == 0.0 and math.copysign(1.0, value) < 0):
        raise ProtocolBoundaryError("non-finite and negative-zero numbers are forbidden")
    if value == 0.0:
        return "0"
    if (value.is_integer() and abs(value) > MAX_SAFE_INTEGER) or float(
        format(value, ".15g")
    ) != value:
        raise ProtocolBoundaryError("number is outside the cross-language safe subset")
    if value.is_integer() and abs(value) < 1e21:
        return str(int(value))
    text = repr(value).lower()
    magnitude = abs(value)
    if "e" in text and 1e-6 <= magnitude < 1e21:
        return format(Decimal(text), "f")
    if "e" in text:
        mantissa, exponent = text.split("e", maxsplit=1)
        sign = ""
        if exponent.startswith(("+", "-")):
            sign, exponent = exponent[0], exponent[1:]
        exponent = exponent.lstrip("0") or "0"
        return f"{mantissa}e{sign}{exponent}"
    return text


def protocol_json_bytes(value: object) -> bytes:
    """Serialize the frozen protocol subset like its dependency-free Node harness.

    This is deliberately named protocol canonicalization, not full RFC 8785/JCS.
    Cross-language parity is tested over every frozen fixture and generated Q16
    envelope; unsupported numeric edge cases fail rather than being normalized.
    """

    _check_depth(value)
    _check_protocol_numbers(value)

    def encode(item: object) -> str:
        if item is None:
            return "null"
        if item is True:
            return "true"
        if item is False:
            return "false"
        if isinstance(item, int):
            return str(item)
        if isinstance(item, float):
            return _number_text(item)
        if isinstance(item, str):
            return json.dumps(item, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
        if isinstance(item, list):
            return "[" + ",".join(encode(child) for child in item) + "]"
        if isinstance(item, dict):
            keys = sorted(item, key=_utf16_key)
            return "{" + ",".join(f"{encode(key)}:{encode(item[key])}" for key in keys) + "}"
        raise ProtocolBoundaryError(f"unsupported protocol value {type(item).__name__}")

    return encode(value).encode("utf-8", errors="strict")


def protocol_digest(value: object) -> DigestV1:
    return DigestV1(hashlib.sha256(protocol_json_bytes(value)).hexdigest())


def _find_forbidden_keys(value: object, *, trail: str = "$") -> tuple[str, ...]:
    hits: list[str] = []
    if isinstance(value, list):
        for index, item in enumerate(value):
            hits.extend(_find_forbidden_keys(item, trail=f"{trail}[{index}]"))
    elif isinstance(value, dict):
        for key, item in value.items():
            normalized = re.sub(r"[^a-z0-9]", "", key.casefold())
            if FORBIDDEN_KEY.search(normalized):
                hits.append(f"{trail}.{key}")
            hits.extend(_find_forbidden_keys(item, trail=f"{trail}.{key}"))
    return tuple(hits)


def reject_forbidden_keys(value: object) -> None:
    if _find_forbidden_keys(value):
        raise ProtocolBoundaryError("forbidden secret/order-authority key is present")


def _json_type(value: object) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, float):
        return "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, list):
        return "array"
    if isinstance(value, dict):
        return "object"
    return type(value).__name__


def _strict_json_equal(left: object, right: object) -> bool:
    """Match Node JSON Schema const/enum semantics, including bool-vs-int."""

    if (
        isinstance(left, int | float)
        and not isinstance(left, bool)
        and isinstance(right, int | float)
        and not isinstance(right, bool)
    ):
        return left == right
    return _json_type(left) == _json_type(right) and left == right


def _assessment_semantic_errors(value: dict[str, object]) -> list[str]:
    if value.get("schema") != "EdgeAssessmentEnvelopeV1":
        return []
    net = value.get("netExpectedValue")
    evidence = value.get("evidence")
    quality = value.get("sourceQuality")
    reasons = value.get("abstentionReasonCodes")
    predictions = value.get("predictions")
    unavailable_or_ambiguous = (
        not isinstance(net, dict)
        or net.get("state") != "ESTIMATED"
        or not isinstance(predictions, list)
        or not predictions
        or not isinstance(reasons, list)
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
    if unavailable_or_ambiguous and value.get("advisoryAction") != "ABSTAIN_UNKNOWN":
        return ["$: unavailable or ambiguous truth requires ABSTAIN_UNKNOWN"]
    return []


@dataclass(frozen=True, slots=True)
class ProtocolContractV1:
    _schema_document: dict[str, object]
    schema_sha256: DigestV1
    _construction_token: object = field(repr=False, compare=False)

    def __post_init__(self) -> None:
        if not isinstance(self._schema_document, dict):
            raise ContractValueError("schema_document must be a mapping")
        if not isinstance(self.schema_sha256, DigestV1):
            raise ContractValueError("schema_sha256 must be DigestV1")
        if self._construction_token is not _PROTOCOL_CONTRACT_TOKEN:
            raise ProtocolBoundaryError("protocol contract must be loaded from frozen bytes")
        if self.schema_sha256.hexdigest != FROZEN_SCHEMA_SHA256:
            raise ProtocolBoundaryError("protocol schema digest is not the frozen Q/L digest")

    @property
    def schema_document(self) -> dict[str, object]:
        """Return a defensive copy; callers cannot mutate the loaded frozen contract."""

        return deepcopy(self._schema_document)

    @classmethod
    def load(cls, repo_root: Path) -> ProtocolContractV1:
        if not isinstance(repo_root, Path) or not repo_root.is_absolute():
            raise ContractValueError("repo_root must be an absolute pathlib.Path")
        path = repo_root / "packages" / "edge-protocol" / "schema" / "edge-protocol-v1.schema.json"
        try:
            raw = path.read_bytes()
        except OSError as error:
            raise ProtocolBoundaryError("frozen protocol schema is unavailable") from error
        digest = DigestV1(hashlib.sha256(raw).hexdigest())
        if digest.hexdigest != FROZEN_SCHEMA_SHA256:
            raise ProtocolBoundaryError("frozen protocol schema digest mismatch")
        document = strict_json_object(raw, maximum_bytes=MAX_REQUEST_SCHEMA_BYTES)
        return cls(document, digest, _PROTOCOL_CONTRACT_TOKEN)

    def _resolve(self, ref: str) -> dict[str, object]:
        if not ref.startswith("#/"):
            raise ProtocolBoundaryError("external protocol schema references are forbidden")
        node: object = self._schema_document
        for part in ref[2:].split("/"):
            if not isinstance(node, dict) or part not in node:
                raise ProtocolBoundaryError("frozen protocol schema reference is unresolved")
            node = node[part]
        if not isinstance(node, dict):
            raise ProtocolBoundaryError("frozen protocol schema reference is not an object")
        return node

    def _validate(self, schema: dict[str, object], value: object, *, trail: str) -> list[str]:
        if "$ref" in schema:
            ref = schema["$ref"]
            if not isinstance(ref, str):
                return [f"{trail}: malformed $ref"]
            return self._validate(self._resolve(ref), value, trail=trail)
        any_of = schema.get("anyOf")
        if isinstance(any_of, list):
            branches = [
                self._validate(branch, value, trail=trail)
                for branch in any_of
                if isinstance(branch, dict)
            ]
            return [] if any(not branch for branch in branches) else [f"{trail}: no anyOf matched"]
        errors: list[str] = []
        if "const" in schema and not _strict_json_equal(value, schema["const"]):
            errors.append(f"{trail}: const mismatch")
        enum = schema.get("enum")
        if isinstance(enum, list) and not any(_strict_json_equal(value, item) for item in enum):
            errors.append(f"{trail}: enum mismatch")
        expected_type = schema.get("type")
        observed_type = _json_type(value)
        if isinstance(expected_type, str):
            type_ok = observed_type == expected_type or (
                expected_type == "number" and observed_type in ("integer", "number")
            )
            if not type_ok:
                return [*errors, f"{trail}: expected {expected_type}, got {observed_type}"]
        if isinstance(value, str):
            pattern = schema.get("pattern")
            if isinstance(pattern, str) and re.fullmatch(pattern, value) is None:
                errors.append(f"{trail}: pattern mismatch")
            minimum = schema.get("minLength")
            maximum = schema.get("maxLength")
            if isinstance(minimum, int) and len(value) < minimum:
                errors.append(f"{trail}: too short")
            if isinstance(maximum, int) and len(value) > maximum:
                errors.append(f"{trail}: too long")
        if isinstance(value, int | float) and not isinstance(value, bool):
            minimum = schema.get("minimum")
            maximum = schema.get("maximum")
            if isinstance(minimum, int | float) and value < minimum:
                errors.append(f"{trail}: below minimum")
            if isinstance(maximum, int | float) and value > maximum:
                errors.append(f"{trail}: above maximum")
        if isinstance(value, list):
            maximum = schema.get("maxItems")
            if isinstance(maximum, int) and len(value) > maximum:
                errors.append(f"{trail}: too many items")
            item_schema = schema.get("items")
            if isinstance(item_schema, dict):
                for index, item in enumerate(value):
                    errors.extend(self._validate(item_schema, item, trail=f"{trail}[{index}]"))
        if isinstance(value, dict):
            maximum = schema.get("maxProperties")
            if isinstance(maximum, int) and len(value) > maximum:
                errors.append(f"{trail}: too many properties")
            required = schema.get("required")
            if isinstance(required, list):
                for key in required:
                    if isinstance(key, str) and key not in value:
                        errors.append(f"{trail}: missing {key}")
            properties = schema.get("properties")
            additional = schema.get("additionalProperties")
            for key, item in value.items():
                if isinstance(properties, dict) and key in properties:
                    child = properties[key]
                    if isinstance(child, dict):
                        errors.extend(self._validate(child, item, trail=f"{trail}.{key}"))
                elif additional is False:
                    errors.append(f"{trail}: unknown field {key}")
                elif isinstance(additional, dict):
                    errors.extend(self._validate(additional, item, trail=f"{trail}.{key}"))
        return errors

    def validate_envelope(self, value: dict[str, object], *, maximum_bytes: int) -> None:
        schema_name = value.get("schema")
        definitions = self._schema_document.get("$defs")
        if (
            not isinstance(schema_name, str)
            or not schema_name.endswith("V1")
            or not isinstance(definitions, dict)
            or schema_name not in definitions
        ):
            raise ProtocolBoundaryError("unregistered envelope schema")
        version = value.get("version")
        if isinstance(version, bool) or not isinstance(version, int | float) or version != 1:
            raise ProtocolBoundaryError("PROTOCOL_VERSION_UNSUPPORTED")
        body_schema = definitions[schema_name]
        if not isinstance(body_schema, dict):
            raise ProtocolBoundaryError("registered envelope schema is malformed")
        errors = self._validate(body_schema, value, trail="$")
        errors.extend(_assessment_semantic_errors(value))
        forbidden = _find_forbidden_keys(value)
        if forbidden:
            errors.append("forbidden key present")
        if len(protocol_json_bytes(value)) > maximum_bytes:
            errors.append("envelope exceeds byte limit")
        if errors:
            raise ProtocolBoundaryError("; ".join(errors[:4]))


MAX_REQUEST_SCHEMA_BYTES: Final = 1_048_576


def protocol_error(
    *,
    code: str,
    message: str,
    occurred_at_ms: int,
    correlation_id: str | None,
    stage: str,
    retryable: bool = False,
) -> dict[str, object]:
    if re.fullmatch(r"[A-Z][A-Z0-9_]{0,99}", code) is None:
        raise ContractValueError("protocol error code must be uppercase snake case")
    if not message or len(message) > 256 or not stage or len(stage) > 256:
        raise ContractValueError("protocol error message/stage must be bounded text")
    identity = hashlib.sha256(
        f"{code}\0{stage}\0{occurred_at_ms}\0{correlation_id or ''}".encode()
    ).hexdigest()[:24]
    return {
        "code": code,
        "component": "quant-edge-q16-local-inference",
        "correlationId": correlation_id,
        "errorId": f"q16.err.{identity}",
        "message": message,
        "occurredAtMs": occurred_at_ms,
        "recommendedOperatorAction": (
            "inspect lineage and retry only after the blocking truth changes"
        ),
        "retryable": retryable,
        "revision": 0,
        "safeCurrentState": "REQUEST_REJECTED_NO_ASSESSMENT",
        "schema": "ProtocolErrorV1",
        "stage": stage,
        "version": 1,
    }
