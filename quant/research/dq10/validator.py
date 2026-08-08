#!/usr/bin/env python3
"""DQ-10 portable research-result truth-semantics validator.

The module is deliberately standalone and standard-library-only. It validates
one closed DQ10ResearchResultV1 JSON envelope against caller-supplied exact
DQ10ResultPolicyV1 bytes and emits a digest-bound canonical JSON report. It
owns no research computation, policy approval, capital decision, execution
path, network access, or ambient project state.
"""

from __future__ import annotations

import contextlib
import hashlib
import json
import os
import re
import stat
import sys
from collections.abc import Sequence
from dataclasses import dataclass
from decimal import Context, Decimal, InvalidOperation
from pathlib import Path
from typing import Final, NoReturn, cast

MAX_INPUT_BYTES: Final = 1_048_576
MAX_DEPTH: Final = 32
MAX_NODES: Final = 20_000
MAX_OBJECT_KEYS: Final = 128
MAX_ARRAY_ITEMS: Final = 1_024
MAX_STRING_BYTES: Final = 4_096
MAX_NUMBER_CHARS: Final = 128
MAX_GATES: Final = 128
MAX_LIST_ITEMS: Final = 256
MAX_ERROR_DETAIL_CHARS: Final = 512
MAX_ERROR_PATH_CHARS: Final = 256
SAFE_INTEGER_MAX: Final = 9_007_199_254_740_991
BINARY64_MAX: Final = Decimal("1.7976931348623157e308")
BINARY64_MIN_POSITIVE: Final = Decimal("4.9406564584124654e-324")

SCHEMA: Final = "DQ10ResearchResultV1"
POLICY_SCHEMA: Final = "DQ10ResultPolicyV1"
REPORT_SCHEMA: Final = "DQ10ValidationReportV1"
CONSUMER: Final = "N3 successor/final convergence"
CREDIBLE_POSITIVE_RULE: Final = "ALL_MANDATORY_PASS_AND_LOWER_BOUND_GT_ZERO"
ECONOMICS_METRIC: Final = "NET_ECONOMIC_RETURN"
VERDICTS: Final = frozenset({"GO", "NO_GO", "UNMEASURED"})
TRUTH_STATES: Final = frozenset({"UNKNOWN", "VERIFIED"})
NET_ECONOMIC_UNITS: Final = frozenset(
    {
        "BPS_NET_RETURN",
        "PERCENT_NET_RETURN",
        "USD_PER_1K",
        "USDT_PER_1K",
    }
)

ID_RE: Final = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/@#=-]{0,255}$")
POLICY_ID_RE: Final = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
REASON_RE: Final = re.compile(r"^[A-Z][A-Z0-9_]{0,127}$")
UNIT_RE: Final = re.compile(r"^[A-Z][A-Z0-9_./:-]{0,63}$")
SHA256_RE: Final = re.compile(r"^[0-9a-f]{64}$")

ROOT_KEYS: Final = frozenset(
    {
        "capitalAuthority",
        "capitalVerdict",
        "consumer",
        "crediblePositive",
        "economics",
        "executionAuthority",
        "gateSummary",
        "gates",
        "limitations",
        "measurementVerdict",
        "policy",
        "resultId",
        "sampleDenominator",
        "schema",
    }
)
TRUTH_KEYS: Final = frozenset({"evidenceIds", "reasonCodes", "state", "value"})
SAMPLE_KEYS: Final = frozenset({"count", "evidenceIds", "reasonCodes", "state"})
GATE_KEYS: Final = frozenset({"evidenceIds", "id", "mandatory", "passed", "reasonCodes", "state"})
GATE_SUMMARY_KEYS: Final = frozenset(
    {
        "mandatoryFailed",
        "mandatoryPassed",
        "mandatoryTotal",
        "mandatoryUnknown",
        "mandatoryVerified",
    }
)
ECONOMICS_KEYS: Final = frozenset({"estimate", "lowerBound", "unit", "upperBound"})
POLICY_KEYS: Final = frozenset({"id", "sha256"})
POLICY_ROOT_KEYS: Final = frozenset(
    {
        "consumer",
        "crediblePositiveRule",
        "economicsUnit",
        "mandatoryGateIds",
        "metric",
        "optionalGateIds",
        "policyId",
        "schema",
    }
)


@dataclass(frozen=True)
class JsonNumber:
    """One finite, I-JSON-range numeric token with its original lexical class."""

    raw: str
    decimal: Decimal
    integer_lexeme: bool


@dataclass(frozen=True)
class ContractError(Exception):
    """One deterministic fail-closed validation result."""

    code: str
    path: str
    detail: str

    def __str__(self) -> str:
        return f"{self.code} at {self.path}: {self.detail}"


@dataclass(frozen=True)
class NumberTruth:
    state: str
    value: Decimal | None
    evidence_ids: tuple[str, ...]
    reason_codes: tuple[str, ...]


@dataclass(frozen=True)
class BooleanTruth:
    state: str
    value: bool | None
    evidence_ids: tuple[str, ...]
    reason_codes: tuple[str, ...]


@dataclass(frozen=True)
class SampleDenominator:
    state: str
    count: int | None
    evidence_ids: tuple[str, ...]
    reason_codes: tuple[str, ...]


@dataclass(frozen=True)
class Gate:
    gate_id: str
    mandatory: bool
    state: str
    passed: bool | None
    evidence_ids: tuple[str, ...]
    reason_codes: tuple[str, ...]


@dataclass(frozen=True)
class ResultPolicy:
    policy_id: str
    sha256: str
    consumer: str
    economics_unit: str
    mandatory_gate_ids: tuple[str, ...]
    optional_gate_ids: tuple[str, ...]


@dataclass(frozen=True)
class ValidationProjection:
    result_id: str
    policy_id: str
    measurement_verdict: str
    credible_positive: bool | None
    capital_verdict: str
    capital_authority: str
    execution_authority: str


def _fail(code: str, path: str, detail: str) -> NoReturn:
    raise ContractError(code=code, path=path, detail=detail)


def _json_adjusted_exponent(raw: str) -> int | None:
    coefficient, separator, exponent_text = raw.lower().partition("e")
    try:
        exponent = int(exponent_text) if separator else 0
    except ValueError:
        _fail("JSON_NUMBER_INVALID", "$", "numeric token is not a finite decimal")
    unsigned = coefficient.removeprefix("-")
    integer_part, decimal_point, fractional_part = unsigned.partition(".")
    digits = integer_part + (fractional_part if decimal_point else "")
    significant = digits.lstrip("0")
    if not significant:
        return None
    return exponent - len(fractional_part) + len(significant) - 1


def _parse_number(raw: str, *, integer_lexeme: bool) -> JsonNumber:
    if len(raw) > MAX_NUMBER_CHARS:
        _fail("JSON_NUMBER_TOO_LONG", "$", "numeric token exceeds the lexical bound")
    adjusted_exponent = _json_adjusted_exponent(raw)
    if adjusted_exponent is None:
        value = Decimal(0)
    else:
        if adjusted_exponent > 308 or adjusted_exponent < -324:
            _fail("JSON_NUMBER_RANGE", "$", "numeric token exceeds binary64 range")
        parse_context = Context(
            prec=MAX_NUMBER_CHARS,
            Emin=-999_999,
            Emax=999_999,
        )
        for signal in parse_context.traps:
            parse_context.traps[signal] = False
        parse_context.clear_flags()
        try:
            value = Decimal(raw, context=parse_context)
        except InvalidOperation:
            _fail("JSON_NUMBER_INVALID", "$", "numeric token is not a finite decimal")
        if parse_context.flags[InvalidOperation]:
            _fail("JSON_NUMBER_INVALID", "$", "numeric token is not a finite decimal")
    if not value.is_finite():
        _fail("JSON_NUMBER_NONFINITE", "$", "NaN and Infinity are forbidden")
    if value.is_zero() and raw.startswith("-"):
        _fail("JSON_NEGATIVE_ZERO", "$", "negative zero is not portable truth")
    absolute = value.copy_abs()
    if absolute > BINARY64_MAX:
        _fail("JSON_NUMBER_RANGE", "$", "numeric token exceeds binary64 range")
    if not value.is_zero() and absolute < BINARY64_MIN_POSITIVE:
        _fail("JSON_NUMBER_RANGE", "$", "numeric token is below binary64 range")
    if integer_lexeme and absolute > SAFE_INTEGER_MAX:
        _fail("JSON_UNSAFE_INTEGER", "$", "integer exceeds the I-JSON exact range")
    return JsonNumber(raw=raw, decimal=value, integer_lexeme=integer_lexeme)


def _parse_int(raw: str) -> JsonNumber:
    return _parse_number(raw, integer_lexeme=True)


def _parse_float(raw: str) -> JsonNumber:
    return _parse_number(raw, integer_lexeme=False)


def _reject_constant(token: str) -> NoReturn:
    _fail("JSON_NUMBER_NONFINITE", "$", f"{token} is forbidden")


def _object_without_duplicates(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            _fail("JSON_DUPLICATE_KEY", "$", "object names must be unique")
        result[key] = value
    return result


def _validate_shape(value: object, *, path: str, depth: int, nodes: list[int]) -> None:
    if depth > MAX_DEPTH:
        _fail("JSON_DEPTH_EXCEEDED", path, f"maximum depth is {MAX_DEPTH}")
    nodes[0] += 1
    if nodes[0] > MAX_NODES:
        _fail("JSON_NODE_LIMIT", path, f"maximum node count is {MAX_NODES}")

    if value is None or isinstance(value, (bool, JsonNumber)):
        return
    if isinstance(value, str):
        try:
            encoded = value.encode("utf-8", errors="strict")
        except UnicodeEncodeError:
            _fail("JSON_UNICODE_INVALID", path, "string is not strict UTF-8")
        if len(encoded) > MAX_STRING_BYTES:
            _fail("JSON_STRING_TOO_LONG", path, f"maximum string size is {MAX_STRING_BYTES}")
        return
    if isinstance(value, list):
        if len(value) > MAX_ARRAY_ITEMS:
            _fail("JSON_ARRAY_TOO_LONG", path, f"maximum array length is {MAX_ARRAY_ITEMS}")
        for index, item in enumerate(cast(list[object], value)):
            _validate_shape(item, path=f"{path}[{index}]", depth=depth + 1, nodes=nodes)
        return
    if isinstance(value, dict):
        mapping = cast(dict[str, object], value)
        if len(mapping) > MAX_OBJECT_KEYS:
            _fail("JSON_OBJECT_TOO_LARGE", path, f"maximum key count is {MAX_OBJECT_KEYS}")
        for index, (key, item) in enumerate(mapping.items()):
            if not isinstance(key, str):
                _fail("JSON_KEY_INVALID", path, "object names must be strings")
            _validate_shape(
                key,
                path=f"{path}.<key[{index}]>",
                depth=depth + 1,
                nodes=nodes,
            )
            _validate_shape(
                item,
                path=f"{path}.<value[{index}]>",
                depth=depth + 1,
                nodes=nodes,
            )
        return
    _fail("JSON_TYPE_INVALID", path, f"unsupported decoded type {type(value).__name__}")


def parse_document(raw: bytes) -> dict[str, object]:
    """Decode one bounded strict JSON object without collapsing numeric truth."""

    if len(raw) > MAX_INPUT_BYTES:
        _fail("INPUT_TOO_LARGE", "$", f"maximum input size is {MAX_INPUT_BYTES} bytes")
    try:
        text = raw.decode("utf-8", errors="strict")
    except UnicodeDecodeError:
        _fail("JSON_UTF8_INVALID", "$", "input must be strict UTF-8")
    try:
        parsed = cast(
            object,
            json.loads(
                text,
                object_pairs_hook=_object_without_duplicates,
                parse_constant=_reject_constant,
                parse_float=_parse_float,
                parse_int=_parse_int,
            ),
        )
    except json.JSONDecodeError as error:
        _fail(
            "JSON_SYNTAX_INVALID",
            "$",
            f"invalid JSON at line {error.lineno} column {error.colno}",
        )
    except RecursionError:
        _fail("JSON_DEPTH_EXCEEDED", "$", f"maximum depth is {MAX_DEPTH}")
    _validate_shape(parsed, path="$", depth=0, nodes=[0])
    if not isinstance(parsed, dict):
        _fail("ROOT_TYPE_INVALID", "$", "top-level JSON value must be an object")
    return cast(dict[str, object], parsed)


def _require_object(value: object, *, path: str, keys: frozenset[str]) -> dict[str, object]:
    if not isinstance(value, dict):
        _fail("OBJECT_REQUIRED", path, "value must be an object")
    mapping = cast(dict[str, object], value)
    actual = frozenset(mapping)
    if actual != keys:
        _fail("KEY_SET_MISMATCH", path, "object keys do not match the closed schema")
    return mapping


def _require_string(value: object, *, path: str) -> str:
    if not isinstance(value, str):
        _fail("STRING_REQUIRED", path, "value must be a string")
    return value


def _require_exact_string(value: object, *, path: str, expected: str) -> str:
    result = _require_string(value, path=path)
    if result != expected:
        _fail("STRING_VALUE_INVALID", path, f"value must equal {expected!r}")
    return result


def _require_bool(value: object, *, path: str) -> bool:
    if not isinstance(value, bool):
        _fail("BOOLEAN_REQUIRED", path, "value must be a boolean")
    return value


def _require_token(value: object, *, path: str, pattern: re.Pattern[str]) -> str:
    token = _require_string(value, path=path)
    if pattern.fullmatch(token) is None:
        _fail("TOKEN_INVALID", path, "value has an invalid token form")
    return token


def _require_state(value: object, *, path: str) -> str:
    state = _require_string(value, path=path)
    if state not in TRUTH_STATES:
        _fail("TRUTH_STATE_INVALID", path, "state must be UNKNOWN or VERIFIED")
    return state


def _require_string_list(
    value: object,
    *,
    path: str,
    pattern: re.Pattern[str],
    allow_empty: bool,
) -> tuple[str, ...]:
    if not isinstance(value, list):
        _fail("ARRAY_REQUIRED", path, "value must be an array")
    items = cast(list[object], value)
    if len(items) > MAX_LIST_ITEMS:
        _fail("ARRAY_TOO_LONG", path, f"maximum length is {MAX_LIST_ITEMS}")
    if not allow_empty and not items:
        _fail("ARRAY_EMPTY", path, "array must not be empty")
    result: list[str] = []
    for index, item in enumerate(items):
        result.append(_require_token(item, path=f"{path}[{index}]", pattern=pattern))
    expected = sorted(set(result))
    if result != expected:
        _fail("ARRAY_ORDER_OR_DUPLICATE", path, "tokens must be sorted and unique")
    return tuple(result)


def _require_count(value: object, *, path: str) -> int:
    if not isinstance(value, JsonNumber) or not value.integer_lexeme:
        _fail("COUNT_INTEGER_REQUIRED", path, "count must be a JSON integer")
    integer = int(value.decimal)
    if integer < 0:
        _fail("COUNT_NEGATIVE", path, "count must be non-negative")
    if integer > SAFE_INTEGER_MAX:
        _fail("JSON_UNSAFE_INTEGER", path, "count exceeds the I-JSON exact range")
    return integer


def _parse_number_truth(value: object, *, path: str) -> NumberTruth:
    mapping = _require_object(value, path=path, keys=TRUTH_KEYS)
    state = _require_state(mapping["state"], path=f"{path}.state")
    evidence_ids = _require_string_list(
        mapping["evidenceIds"],
        path=f"{path}.evidenceIds",
        pattern=ID_RE,
        allow_empty=True,
    )
    reason_codes = _require_string_list(
        mapping["reasonCodes"],
        path=f"{path}.reasonCodes",
        pattern=REASON_RE,
        allow_empty=True,
    )
    raw_value = mapping["value"]
    if state == "UNKNOWN":
        if raw_value is not None:
            _fail("UNKNOWN_VALUE_NOT_NULL", f"{path}.value", "UNKNOWN requires explicit null")
        if not reason_codes:
            _fail("UNKNOWN_REASON_REQUIRED", f"{path}.reasonCodes", "UNKNOWN requires a reason")
        return NumberTruth(
            state=state,
            value=None,
            evidence_ids=evidence_ids,
            reason_codes=reason_codes,
        )
    if not isinstance(raw_value, JsonNumber):
        _fail("VERIFIED_NUMBER_REQUIRED", f"{path}.value", "VERIFIED requires a JSON number")
    if not evidence_ids:
        _fail(
            "VERIFIED_EVIDENCE_REQUIRED",
            f"{path}.evidenceIds",
            "VERIFIED numeric truth requires evidence",
        )
    if reason_codes:
        _fail(
            "VERIFIED_REASON_FORBIDDEN",
            f"{path}.reasonCodes",
            "VERIFIED truth cannot retain unknown reasons",
        )
    return NumberTruth(
        state=state,
        value=raw_value.decimal,
        evidence_ids=evidence_ids,
        reason_codes=reason_codes,
    )


def _parse_boolean_truth(value: object, *, path: str) -> BooleanTruth:
    mapping = _require_object(value, path=path, keys=TRUTH_KEYS)
    state = _require_state(mapping["state"], path=f"{path}.state")
    evidence_ids = _require_string_list(
        mapping["evidenceIds"],
        path=f"{path}.evidenceIds",
        pattern=ID_RE,
        allow_empty=True,
    )
    reason_codes = _require_string_list(
        mapping["reasonCodes"],
        path=f"{path}.reasonCodes",
        pattern=REASON_RE,
        allow_empty=True,
    )
    raw_value = mapping["value"]
    if state == "UNKNOWN":
        if raw_value is not None:
            _fail("UNKNOWN_VALUE_NOT_NULL", f"{path}.value", "UNKNOWN requires explicit null")
        if not reason_codes:
            _fail("UNKNOWN_REASON_REQUIRED", f"{path}.reasonCodes", "UNKNOWN requires a reason")
        return BooleanTruth(
            state=state,
            value=None,
            evidence_ids=evidence_ids,
            reason_codes=reason_codes,
        )
    verified = _require_bool(raw_value, path=f"{path}.value")
    if not evidence_ids:
        _fail(
            "VERIFIED_EVIDENCE_REQUIRED",
            f"{path}.evidenceIds",
            "VERIFIED boolean truth requires evidence",
        )
    if reason_codes:
        _fail(
            "VERIFIED_REASON_FORBIDDEN",
            f"{path}.reasonCodes",
            "VERIFIED truth cannot retain unknown reasons",
        )
    return BooleanTruth(
        state=state,
        value=verified,
        evidence_ids=evidence_ids,
        reason_codes=reason_codes,
    )


def _parse_sample(value: object, *, path: str) -> SampleDenominator:
    mapping = _require_object(value, path=path, keys=SAMPLE_KEYS)
    state = _require_state(mapping["state"], path=f"{path}.state")
    evidence_ids = _require_string_list(
        mapping["evidenceIds"],
        path=f"{path}.evidenceIds",
        pattern=ID_RE,
        allow_empty=True,
    )
    reason_codes = _require_string_list(
        mapping["reasonCodes"],
        path=f"{path}.reasonCodes",
        pattern=REASON_RE,
        allow_empty=True,
    )
    raw_count = mapping["count"]
    if state == "UNKNOWN":
        if raw_count is not None:
            _fail("UNKNOWN_COUNT_NOT_NULL", f"{path}.count", "UNKNOWN requires explicit null")
        if not reason_codes:
            _fail("UNKNOWN_REASON_REQUIRED", f"{path}.reasonCodes", "UNKNOWN requires a reason")
        return SampleDenominator(
            state=state,
            count=None,
            evidence_ids=evidence_ids,
            reason_codes=reason_codes,
        )
    count = _require_count(raw_count, path=f"{path}.count")
    if not evidence_ids:
        _fail(
            "VERIFIED_EVIDENCE_REQUIRED",
            f"{path}.evidenceIds",
            "a verified denominator requires evidence",
        )
    if reason_codes:
        _fail(
            "VERIFIED_REASON_FORBIDDEN",
            f"{path}.reasonCodes",
            "a verified denominator cannot retain unknown reasons",
        )
    return SampleDenominator(
        state=state,
        count=count,
        evidence_ids=evidence_ids,
        reason_codes=reason_codes,
    )


def _parse_gates(value: object, *, path: str) -> tuple[Gate, ...]:
    if not isinstance(value, list):
        _fail("ARRAY_REQUIRED", path, "gates must be an array")
    items = cast(list[object], value)
    if not items:
        _fail("GATE_LIST_EMPTY", path, "at least one gate is required")
    if len(items) > MAX_GATES:
        _fail("GATE_LIST_TOO_LONG", path, f"maximum gate count is {MAX_GATES}")
    gates: list[Gate] = []
    for index, item in enumerate(items):
        gate_path = f"{path}[{index}]"
        mapping = _require_object(item, path=gate_path, keys=GATE_KEYS)
        gate_id = _require_token(mapping["id"], path=f"{gate_path}.id", pattern=POLICY_ID_RE)
        mandatory = _require_bool(mapping["mandatory"], path=f"{gate_path}.mandatory")
        state = _require_state(mapping["state"], path=f"{gate_path}.state")
        evidence_ids = _require_string_list(
            mapping["evidenceIds"],
            path=f"{gate_path}.evidenceIds",
            pattern=ID_RE,
            allow_empty=True,
        )
        reason_codes = _require_string_list(
            mapping["reasonCodes"],
            path=f"{gate_path}.reasonCodes",
            pattern=REASON_RE,
            allow_empty=True,
        )
        raw_passed = mapping["passed"]
        if state == "UNKNOWN":
            if raw_passed is not None:
                _fail(
                    "UNKNOWN_GATE_NOT_NULL",
                    f"{gate_path}.passed",
                    "UNKNOWN gate requires explicit null",
                )
            if not reason_codes:
                _fail(
                    "UNKNOWN_REASON_REQUIRED",
                    f"{gate_path}.reasonCodes",
                    "UNKNOWN gate requires a reason",
                )
            passed: bool | None = None
        else:
            passed = _require_bool(raw_passed, path=f"{gate_path}.passed")
            if not evidence_ids:
                _fail(
                    "VERIFIED_EVIDENCE_REQUIRED",
                    f"{gate_path}.evidenceIds",
                    "verified gate requires evidence",
                )
            if reason_codes:
                _fail(
                    "VERIFIED_REASON_FORBIDDEN",
                    f"{gate_path}.reasonCodes",
                    "verified gate cannot retain unknown reasons",
                )
        gates.append(
            Gate(
                gate_id=gate_id,
                mandatory=mandatory,
                state=state,
                passed=passed,
                evidence_ids=evidence_ids,
                reason_codes=reason_codes,
            )
        )
    gate_ids = [gate.gate_id for gate in gates]
    if gate_ids != sorted(set(gate_ids)):
        _fail("GATE_ORDER_OR_DUPLICATE", path, "gate ids must be sorted and unique")
    if not any(gate.mandatory for gate in gates):
        _fail("MANDATORY_GATE_EMPTY", path, "at least one mandatory gate is required")
    return tuple(gates)


def _parse_gate_summary(value: object, *, path: str) -> dict[str, int]:
    mapping = _require_object(value, path=path, keys=GATE_SUMMARY_KEYS)
    return {
        key: _require_count(mapping[key], path=f"{path}.{key}") for key in sorted(GATE_SUMMARY_KEYS)
    }


def _validate_gate_summary(
    gates: tuple[Gate, ...],
    summary: dict[str, int],
    *,
    path: str,
) -> None:
    mandatory = tuple(gate for gate in gates if gate.mandatory)
    expected = {
        "mandatoryFailed": sum(
            gate.state == "VERIFIED" and gate.passed is False for gate in mandatory
        ),
        "mandatoryPassed": sum(
            gate.state == "VERIFIED" and gate.passed is True for gate in mandatory
        ),
        "mandatoryTotal": len(mandatory),
        "mandatoryUnknown": sum(gate.state == "UNKNOWN" for gate in mandatory),
        "mandatoryVerified": sum(gate.state == "VERIFIED" for gate in mandatory),
    }
    if summary != expected:
        _fail("GATE_SUMMARY_MISMATCH", path, f"declared={summary}; recomputed={expected}")
    if summary["mandatoryVerified"] != (summary["mandatoryPassed"] + summary["mandatoryFailed"]):
        _fail("GATE_DENOMINATOR_INVALID", path, "verified must equal passed plus failed")
    if summary["mandatoryTotal"] != (summary["mandatoryVerified"] + summary["mandatoryUnknown"]):
        _fail("GATE_DENOMINATOR_INVALID", path, "total must equal verified plus unknown")


def _parse_economics(
    value: object,
    *,
    path: str,
) -> tuple[str | None, NumberTruth, NumberTruth, NumberTruth]:
    mapping = _require_object(value, path=path, keys=ECONOMICS_KEYS)
    raw_unit = mapping["unit"]
    unit: str | None
    if raw_unit is None:
        unit = None
    else:
        unit = _require_token(raw_unit, path=f"{path}.unit", pattern=UNIT_RE)
    estimate = _parse_number_truth(mapping["estimate"], path=f"{path}.estimate")
    lower = _parse_number_truth(mapping["lowerBound"], path=f"{path}.lowerBound")
    upper = _parse_number_truth(mapping["upperBound"], path=f"{path}.upperBound")
    states = {estimate.state, lower.state, upper.state}
    if len(states) != 1:
        _fail(
            "ECONOMICS_PARTIAL",
            path,
            "estimate and interval bounds must be all UNKNOWN or all VERIFIED",
        )
    if estimate.state == "UNKNOWN":
        if unit is not None:
            _fail("UNKNOWN_UNIT_NOT_NULL", f"{path}.unit", "unknown economics require null unit")
        return unit, estimate, lower, upper
    if unit is None:
        _fail("VERIFIED_UNIT_REQUIRED", f"{path}.unit", "verified economics require a unit")
    if estimate.value is None or lower.value is None or upper.value is None:
        _fail("INTERNAL_VALIDATION_ERROR", path, "verified numeric truth lost its value")
    if not lower.value <= estimate.value <= upper.value:
        _fail(
            "ECONOMICS_INTERVAL_INVALID",
            path,
            "lowerBound must be <= estimate <= upperBound",
        )
    return unit, estimate, lower, upper


def _verified_evidence_union(
    sample: SampleDenominator,
    economics: tuple[NumberTruth, NumberTruth, NumberTruth],
    gates: tuple[Gate, ...],
) -> tuple[str, ...]:
    evidence: set[str] = set(sample.evidence_ids)
    for truth in economics:
        evidence.update(truth.evidence_ids)
    for gate in gates:
        if gate.mandatory:
            evidence.update(gate.evidence_ids)
    return tuple(sorted(evidence))


def parse_policy_document(
    document: dict[str, object],
    *,
    sha256: str,
) -> ResultPolicy:
    """Validate one caller-supplied, exact-byte-bound DQ-10 result policy."""

    root = _require_object(document, path="$policy", keys=POLICY_ROOT_KEYS)
    _require_exact_string(root["schema"], path="$policy.schema", expected=POLICY_SCHEMA)
    policy_id = _require_token(
        root["policyId"],
        path="$policy.policyId",
        pattern=POLICY_ID_RE,
    )
    consumer = _require_exact_string(
        root["consumer"],
        path="$policy.consumer",
        expected=CONSUMER,
    )
    _require_exact_string(
        root["metric"],
        path="$policy.metric",
        expected=ECONOMICS_METRIC,
    )
    economics_unit = _require_token(
        root["economicsUnit"],
        path="$policy.economicsUnit",
        pattern=UNIT_RE,
    )
    if economics_unit not in NET_ECONOMIC_UNITS:
        _fail(
            "POLICY_ECONOMICS_UNIT_INVALID",
            "$policy.economicsUnit",
            "unit must identify a supported net-economic-return measure",
        )
    _require_exact_string(
        root["crediblePositiveRule"],
        path="$policy.crediblePositiveRule",
        expected=CREDIBLE_POSITIVE_RULE,
    )
    mandatory_gate_ids = _require_string_list(
        root["mandatoryGateIds"],
        path="$policy.mandatoryGateIds",
        pattern=POLICY_ID_RE,
        allow_empty=False,
    )
    optional_gate_ids = _require_string_list(
        root["optionalGateIds"],
        path="$policy.optionalGateIds",
        pattern=POLICY_ID_RE,
        allow_empty=True,
    )
    overlap = sorted(set(mandatory_gate_ids) & set(optional_gate_ids))
    if overlap:
        _fail(
            "POLICY_GATE_OVERLAP",
            "$policy",
            "mandatory and optional gate inventories must be disjoint",
        )
    if len(mandatory_gate_ids) + len(optional_gate_ids) > MAX_GATES:
        _fail(
            "POLICY_GATE_LIST_TOO_LONG",
            "$policy",
            f"maximum total gate count is {MAX_GATES}",
        )
    _require_token(sha256, path="$policy.<sha256>", pattern=SHA256_RE)
    return ResultPolicy(
        policy_id=policy_id,
        sha256=sha256,
        consumer=consumer,
        economics_unit=economics_unit,
        mandatory_gate_ids=mandatory_gate_ids,
        optional_gate_ids=optional_gate_ids,
    )


def parse_policy_bytes(raw: bytes) -> ResultPolicy:
    """Parse and bind a policy to the SHA-256 of the exact supplied bytes."""

    return parse_policy_document(
        parse_document(raw),
        sha256=hashlib.sha256(raw).hexdigest(),
    )


def _validate_policy_gate_inventory(
    gates: tuple[Gate, ...],
    policy: ResultPolicy,
    *,
    path: str,
) -> None:
    expected_ids = frozenset(policy.mandatory_gate_ids + policy.optional_gate_ids)
    actual_ids = frozenset(gate.gate_id for gate in gates)
    if actual_ids != expected_ids:
        _fail(
            "POLICY_GATE_INVENTORY_MISMATCH",
            path,
            "result gate inventory does not match the supplied policy",
        )
    mandatory_ids = frozenset(policy.mandatory_gate_ids)
    for index, gate in enumerate(gates):
        expected_mandatory = gate.gate_id in mandatory_ids
        if gate.mandatory is not expected_mandatory:
            _fail(
                "POLICY_GATE_CLASS_MISMATCH",
                f"{path}[{index}].mandatory",
                "gate mandatory classification does not match the supplied policy",
            )


def validate_document(
    document: dict[str, object],
    policy_contract: ResultPolicy,
) -> ValidationProjection:
    """Validate the complete closed DQ10ResearchResultV1 semantic envelope."""

    root = _require_object(document, path="$", keys=ROOT_KEYS)
    _require_exact_string(root["schema"], path="$.schema", expected=SCHEMA)
    result_id = _require_token(root["resultId"], path="$.resultId", pattern=POLICY_ID_RE)
    _require_exact_string(
        root["consumer"],
        path="$.consumer",
        expected=policy_contract.consumer,
    )

    declared_policy = _require_object(root["policy"], path="$.policy", keys=POLICY_KEYS)
    declared_policy_id = _require_token(
        declared_policy["id"],
        path="$.policy.id",
        pattern=POLICY_ID_RE,
    )
    if declared_policy_id != policy_contract.policy_id:
        _fail(
            "POLICY_ID_MISMATCH",
            "$.policy.id",
            "result policy id does not match the supplied policy",
        )
    declared_policy_sha256 = _require_token(
        declared_policy["sha256"],
        path="$.policy.sha256",
        pattern=SHA256_RE,
    )
    if declared_policy_sha256 != policy_contract.sha256:
        _fail(
            "POLICY_DIGEST_MISMATCH",
            "$.policy.sha256",
            "result policy digest does not match the exact supplied policy bytes",
        )

    limitations = _require_string_list(
        root["limitations"],
        path="$.limitations",
        pattern=REASON_RE,
        allow_empty=False,
    )
    if "CAPITAL_AUTHORITY_NOT_GRANTED" not in limitations:
        _fail(
            "CAPITAL_LIMITATION_REQUIRED",
            "$.limitations",
            "CAPITAL_AUTHORITY_NOT_GRANTED must remain explicit",
        )

    sample = _parse_sample(root["sampleDenominator"], path="$.sampleDenominator")
    economics_unit, estimate, lower, upper = _parse_economics(
        root["economics"],
        path="$.economics",
    )
    if economics_unit is not None and economics_unit != policy_contract.economics_unit:
        _fail(
            "POLICY_ECONOMICS_UNIT_MISMATCH",
            "$.economics.unit",
            "verified economics unit does not match the supplied policy",
        )
    gates = _parse_gates(root["gates"], path="$.gates")
    _validate_policy_gate_inventory(gates, policy_contract, path="$.gates")
    summary = _parse_gate_summary(root["gateSummary"], path="$.gateSummary")
    _validate_gate_summary(gates, summary, path="$.gateSummary")
    credible = _parse_boolean_truth(root["crediblePositive"], path="$.crediblePositive")

    verdict = _require_string(root["measurementVerdict"], path="$.measurementVerdict")
    if verdict not in VERDICTS:
        _fail(
            "MEASUREMENT_VERDICT_INVALID",
            "$.measurementVerdict",
            "verdict must be GO, NO_GO, or UNMEASURED",
        )

    capital_verdict = _require_exact_string(
        root["capitalVerdict"],
        path="$.capitalVerdict",
        expected="NO_GO",
    )
    capital_authority = _require_exact_string(
        root["capitalAuthority"],
        path="$.capitalAuthority",
        expected="NONE",
    )
    execution_authority = _require_exact_string(
        root["executionAuthority"],
        path="$.executionAuthority",
        expected="NONE",
    )

    sample_ready = sample.state == "VERIFIED" and sample.count is not None and sample.count > 0
    economics_ready = estimate.state == lower.state == upper.state == "VERIFIED"
    gates_ready = summary["mandatoryTotal"] > 0 and summary["mandatoryUnknown"] == 0
    decision_ready = sample_ready and economics_ready and gates_ready

    if not decision_ready:
        if verdict != "UNMEASURED":
            _fail(
                "UNMEASURED_VERDICT_REQUIRED",
                "$.measurementVerdict",
                "unknown or zero-denominator decision input requires UNMEASURED",
            )
        if any(truth.state != "UNKNOWN" for truth in (estimate, lower, upper)):
            _fail(
                "UNMEASURED_ECONOMICS_NOT_NULL",
                "$.economics",
                "UNMEASURED result cannot retain primary numeric economics",
            )
        if credible.state != "UNKNOWN" or credible.value is not None:
            _fail(
                "CREDIBLE_POSITIVE_MUST_BE_UNKNOWN",
                "$.crediblePositive",
                "UNMEASURED result requires UNKNOWN/null credible-positive truth",
            )
        if credible.evidence_ids:
            _fail(
                "UNKNOWN_CREDIBLE_EVIDENCE_FORBIDDEN",
                "$.crediblePositive.evidenceIds",
                "unmeasured credible-positive truth cannot claim supporting evidence",
            )
        if "DECISION_INPUT_UNMEASURED" not in credible.reason_codes:
            _fail(
                "CREDIBLE_UNKNOWN_REASON_REQUIRED",
                "$.crediblePositive.reasonCodes",
                "DECISION_INPUT_UNMEASURED must remain explicit",
            )
        return ValidationProjection(
            result_id=result_id,
            policy_id=policy_contract.policy_id,
            measurement_verdict=verdict,
            credible_positive=None,
            capital_verdict=capital_verdict,
            capital_authority=capital_authority,
            execution_authority=execution_authority,
        )

    if credible.state != "VERIFIED" or credible.value is None:
        _fail(
            "CREDIBLE_POSITIVE_MUST_BE_VERIFIED",
            "$.crediblePositive",
            "measured decision inputs require verified credible-positive truth",
        )
    if estimate.value is None or lower.value is None or upper.value is None:
        _fail("INTERNAL_VALIDATION_ERROR", "$.economics", "verified economics lost values")

    all_mandatory_pass = summary["mandatoryPassed"] == summary["mandatoryTotal"]
    derived_credible = all_mandatory_pass and lower.value > 0
    if credible.value is not derived_credible:
        _fail(
            "CREDIBLE_POSITIVE_MISMATCH",
            "$.crediblePositive.value",
            f"declared={credible.value}; recomputed={derived_credible}",
        )

    expected_evidence = _verified_evidence_union(sample, (estimate, lower, upper), gates)
    if credible.evidence_ids != expected_evidence:
        _fail(
            "CREDIBLE_EVIDENCE_MISMATCH",
            "$.crediblePositive.evidenceIds",
            f"declared={credible.evidence_ids}; recomputed={expected_evidence}",
        )

    derived_verdict = "GO" if derived_credible else "NO_GO"
    if verdict != derived_verdict:
        _fail(
            "MEASUREMENT_VERDICT_MISMATCH",
            "$.measurementVerdict",
            f"declared={verdict}; recomputed={derived_verdict}",
        )
    return ValidationProjection(
        result_id=result_id,
        policy_id=policy_contract.policy_id,
        measurement_verdict=verdict,
        credible_positive=credible.value,
        capital_verdict=capital_verdict,
        capital_authority=capital_authority,
        execution_authority=execution_authority,
    )


def validate_bytes(policy_raw: bytes, result_raw: bytes) -> ValidationProjection:
    """Parse and validate one result against exact caller-supplied policy bytes."""

    policy_contract = parse_policy_bytes(policy_raw)
    return validate_document(parse_document(result_raw), policy_contract)


def _bounded_error_detail(detail: str) -> str:
    if len(detail) <= MAX_ERROR_DETAIL_CHARS:
        return detail
    return detail[: MAX_ERROR_DETAIL_CHARS - 3] + "..."


def _bounded_error_path(path: str) -> str:
    if len(path) <= MAX_ERROR_PATH_CHARS:
        return path
    return "$<path-truncated>"


def _report_bytes(
    error: ContractError | None,
    *,
    policy_raw: bytes | None,
    result_raw: bytes | None,
    projection: ValidationProjection | None,
) -> bytes:
    errors: list[dict[str, str]]
    if error is None:
        errors = []
    else:
        errors = [
            {
                "code": error.code,
                "message": _bounded_error_detail(error.detail),
                "path": _bounded_error_path(error.path),
            }
        ]
    projected_result: dict[str, object] | None
    if projection is None:
        projected_result = None
    else:
        projected_result = {
            "capitalAuthority": projection.capital_authority,
            "capitalVerdict": projection.capital_verdict,
            "crediblePositive": projection.credible_positive,
            "executionAuthority": projection.execution_authority,
            "measurementVerdict": projection.measurement_verdict,
            "policyId": projection.policy_id,
            "resultId": projection.result_id,
        }
    report: dict[str, object] = {
        "errors": errors,
        "inputSha256": hashlib.sha256(result_raw).hexdigest() if result_raw is not None else None,
        "policySha256": hashlib.sha256(policy_raw).hexdigest() if policy_raw is not None else None,
        "result": projected_result,
        "schema": REPORT_SCHEMA,
        "valid": error is None and projection is not None,
    }
    return (
        json.dumps(
            report,
            allow_nan=False,
            ensure_ascii=True,
            separators=(",", ":"),
            sort_keys=True,
        )
        + "\n"
    ).encode("utf-8")


def _read_stdin() -> bytes:
    stream = getattr(sys.stdin, "buffer", None)
    if stream is None:
        _fail("INPUT_READ_FAILED", "$", "standard input is unavailable")
    try:
        raw_value = cast(object, stream.read(MAX_INPUT_BYTES + 1))
    except (OSError, ValueError):
        _fail("INPUT_READ_FAILED", "$", "standard input could not be read")
    if not isinstance(raw_value, bytes):
        _fail("INPUT_READ_FAILED", "$", "standard input did not provide bytes")
    raw = raw_value
    if len(raw) > MAX_INPUT_BYTES:
        _fail("INPUT_TOO_LARGE", "$", f"maximum input size is {MAX_INPUT_BYTES} bytes")
    return raw


def _stable_stat(snapshot: os.stat_result) -> tuple[int, int, int, int, int]:
    return (
        snapshot.st_dev,
        snapshot.st_ino,
        snapshot.st_size,
        snapshot.st_mtime_ns,
        snapshot.st_ctime_ns,
    )


def _read_regular_file(path_text: str) -> bytes:
    path = Path(path_text)
    try:
        before = path.lstat()
    except OSError as error:
        _fail("INPUT_OPEN_FAILED", "$", f"cannot inspect input: {error.strerror or 'error'}")
    if not stat.S_ISREG(before.st_mode):
        _fail("INPUT_NOT_REGULAR", "$", "input path must be a regular file, not a link or device")
    if before.st_size > MAX_INPUT_BYTES:
        _fail("INPUT_TOO_LARGE", "$", f"maximum input size is {MAX_INPUT_BYTES} bytes")

    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_BINARY", 0)
    flags |= getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(path, flags)
    except OSError as error:
        _fail("INPUT_OPEN_FAILED", "$", f"cannot open input: {error.strerror or 'error'}")
    try:
        opened = os.fstat(descriptor)
        if not stat.S_ISREG(opened.st_mode):
            _fail("INPUT_NOT_REGULAR", "$", "opened input must remain a regular file")
        if _stable_stat(before) != _stable_stat(opened):
            _fail("INPUT_CHANGED", "$", "input identity changed before read")
        chunks: list[bytes] = []
        remaining = MAX_INPUT_BYTES + 1
        while remaining > 0:
            chunk = os.read(descriptor, min(65_536, remaining))
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        raw = b"".join(chunks)
        after = os.fstat(descriptor)
        current_path = path.lstat()
    except ContractError:
        raise
    except OSError as error:
        _fail("INPUT_READ_FAILED", "$", f"cannot read input: {error.strerror or 'error'}")
    finally:
        with contextlib.suppress(OSError):
            os.close(descriptor)
    if len(raw) > MAX_INPUT_BYTES:
        _fail("INPUT_TOO_LARGE", "$", f"maximum input size is {MAX_INPUT_BYTES} bytes")
    if _stable_stat(opened) != _stable_stat(after):
        _fail("INPUT_CHANGED", "$", "input changed during read")
    if len(raw) != after.st_size:
        _fail("INPUT_CHANGED", "$", "input size does not match bytes read")
    if not stat.S_ISREG(current_path.st_mode):
        _fail("INPUT_CHANGED", "$", "input path changed type during read")
    if _stable_stat(current_path) != _stable_stat(after):
        _fail("INPUT_CHANGED", "$", "input path no longer names the validated bytes")
    return raw


def _usage() -> bytes:
    return b"usage: validator.py POLICY.json RESULT.json|-\n"


def _write_binary(stream: object, raw: bytes) -> bool:
    buffer = getattr(stream, "buffer", None)
    if buffer is None:
        return False
    offset = 0
    while offset < len(raw):
        try:
            written = buffer.write(raw[offset:])
        except (OSError, ValueError):
            return False
        if (
            isinstance(written, bool)
            or not isinstance(written, int)
            or written <= 0
            or written > len(raw) - offset
        ):
            return False
        offset += written
    try:
        buffer.flush()
    except (OSError, ValueError):
        return False
    return True


def main(argv: Sequence[str] | None = None) -> int:
    """CLI entry point: exit 0 valid, 1 invalid policy/result, 2 bad invocation."""

    arguments = list(sys.argv[1:] if argv is None else argv)
    if arguments in (["-h"], ["--help"]):
        return 0 if _write_binary(sys.stdout, _usage()) else 1
    if arguments and arguments[0] in {"-h", "--help"}:
        _write_binary(sys.stderr, _usage())
        return 2
    if len(arguments) != 2 or arguments[0] == "-":
        _write_binary(sys.stderr, _usage())
        return 2
    policy_raw: bytes | None = None
    result_raw: bytes | None = None
    projection: ValidationProjection | None = None
    try:
        policy_raw = _read_regular_file(arguments[0])
        result_raw = _read_stdin() if arguments[1] == "-" else _read_regular_file(arguments[1])
        projection = validate_bytes(policy_raw, result_raw)
    except ContractError as error:
        _write_binary(
            sys.stdout,
            _report_bytes(
                error,
                policy_raw=policy_raw,
                result_raw=result_raw,
                projection=None,
            ),
        )
        return 1
    report = _report_bytes(
        None,
        policy_raw=policy_raw,
        result_raw=result_raw,
        projection=projection,
    )
    return 0 if _write_binary(sys.stdout, report) else 1


if __name__ == "__main__":
    raise SystemExit(main())
