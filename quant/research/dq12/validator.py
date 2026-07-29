from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import unicodedata
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from enum import StrEnum
from fractions import Fraction
from itertools import pairwise
from pathlib import Path
from typing import Final, NoReturn, cast

SCHEMA_V1: Final = "cosmos.dq12.spot-usdm-instrument-identity.v1"
REQUEST_SCHEMA_V1: Final = "cosmos.dq12.instrument-identity-request.v1"
REGISTRY_SCHEMA_V1: Final = "cosmos.dq12.identity-registry.v1"

SPOT_ENDPOINT_V1: Final = "https://api.binance.com/api/v3/exchangeInfo"
USDM_ENDPOINT_V1: Final = "https://fapi.binance.com/fapi/v1/exchangeInfo"
SETTLEMENT_BASIS_V1: Final = "SETTLE_PROXY_FROM_MARGIN_ASSET"
STATUS_SCOPE_V1: Final = "CURRENT_AT_TRUSTED_EVALUATION_TIME"

MAX_INPUT_BYTES: Final = 8 * 1024 * 1024
MAX_JSON_DEPTH: Final = 24
MAX_JSON_NODES: Final = 200_000
MAX_STRING_BYTES: Final = 16_384
MAX_SYMBOL_ROWS: Final = 8_192
MAX_REGISTRY_EDGES: Final = 4_096
MAX_ALIAS_DEPTH: Final = 8
MAX_SNAPSHOT_AGE_MS: Final = 300_000
MAX_SNAPSHOT_SKEW_MS: Final = 60_000

_MAX_SAFE_INTEGER: Final = 9_007_199_254_740_991
_RECEIPT_DOMAIN: Final = b"cosmos-dq12-instrument-identity-receipt-v1\0"
_REGISTRY_DOMAIN: Final = b"cosmos-dq12-identity-registry-v1\0"
_ID_PATTERN: Final = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:@+\-/]{0,127}$")
_SHA256_PATTERN: Final = re.compile(r"^[0-9a-f]{64}$")

_REQUEST_KEYS: Final = frozenset(
    {
        "asOfMs",
        "expectedQuoteId",
        "expectedSettlementId",
        "expectedSpotInstrumentId",
        "expectedUnderlyingId",
        "expectedUsdmInstrumentId",
        "registrySha256",
        "schema",
        "spotSource",
        "spotSymbol",
        "statusScope",
        "usdmSource",
        "usdmSymbol",
    }
)
_SOURCE_KEYS: Final = frozenset(
    {
        "endpoint",
        "marketType",
        "payloadSha256",
        "payloadSize",
        "retrievedAtMs",
    }
)
_REGISTRY_KEYS: Final = frozenset({"bindings", "migrations", "registryId", "schema"})
_BINDING_KEYS: Final = frozenset(
    {
        "evidenceSha256",
        "kind",
        "marketType",
        "role",
        "scaleDenominator",
        "scaleNumerator",
        "source",
        "target",
        "validFromMs",
        "validUntilMs",
        "venue",
    }
)
_MIGRATION_KEYS: Final = frozenset(
    {
        "continuity",
        "effectiveAtMs",
        "evidenceSha256",
        "marketType",
        "role",
        "scaleDenominator",
        "scaleNumerator",
        "source",
        "target",
        "validUntilMs",
        "venue",
    }
)

_SPOT_STATUSES: Final = frozenset({"TRADING", "END_OF_DAY", "HALT", "BREAK", "CANCEL_ONLY"})
_USDM_STATUSES: Final = frozenset(
    {
        "PENDING_TRADING",
        "TRADING",
        "PRE_DELIVERING",
        "DELIVERING",
        "DELIVERED",
        "PRE_SETTLE",
        "SETTLING",
        "CLOSE",
        "TRADING_HALT",
        "TRADING_CANCEL_ONLY",
    }
)
_USDM_CONTRACT_TYPES: Final = frozenset(
    {
        "PERPETUAL",
        "CURRENT_MONTH",
        "NEXT_MONTH",
        "CURRENT_QUARTER",
        "NEXT_QUARTER",
        "PERPETUAL_DELIVERING",
    }
)


class IdentityDecision(StrEnum):
    MATCHED = "MATCHED"
    UNKNOWN = "UNKNOWN"


class MarketType(StrEnum):
    SPOT = "SPOT"
    USD_M = "USD_M"


class IdentityRole(StrEnum):
    SYMBOL = "SYMBOL"
    BASE = "BASE"
    QUOTE = "QUOTE"
    SETTLEMENT = "SETTLEMENT"


class BindingKind(StrEnum):
    DIRECT = "DIRECT"
    ALIAS = "ALIAS"


class MigrationContinuity(StrEnum):
    PRESERVES_UNDERLYING = "PRESERVES_UNDERLYING"
    CHANGES_UNDERLYING = "CHANGES_UNDERLYING"


class IdentityContractError(ValueError):
    """Internal stable failure converted to a public UNKNOWN receipt."""

    def __init__(self, code: str, detail: str) -> None:
        self.code = code
        super().__init__(f"{code}: {detail}")


@dataclass(frozen=True, slots=True)
class RationalScaleV1:
    numerator: int
    denominator: int

    @classmethod
    def from_fraction(cls, value: Fraction) -> RationalScaleV1:
        return cls(numerator=value.numerator, denominator=value.denominator)

    def as_dict(self) -> dict[str, int]:
        return {"denominator": self.denominator, "numerator": self.numerator}


@dataclass(frozen=True, slots=True)
class PairIdentityReceiptV1:
    schema: str
    decision: IdentityDecision
    reason_codes: tuple[str, ...]
    status_scope: str
    evaluation_time_ms: int | None
    spot_retrieved_at_ms: int | None
    usdm_retrieved_at_ms: int | None
    spot_symbol: str | None
    usdm_symbol: str | None
    spot_instrument_id: str | None
    usdm_instrument_id: str | None
    canonical_underlying_id: str | None
    canonical_quote_id: str | None
    canonical_settlement_id: str | None
    settlement_basis: str | None
    settlement_source_field: str | None
    spot_base_scale: RationalScaleV1 | None
    usdm_base_scale: RationalScaleV1 | None
    spot_units_per_usdm_base_unit: RationalScaleV1 | None
    historical_status: str
    authority: str
    request_sha256: str | None
    spot_payload_sha256: str | None
    usdm_payload_sha256: str | None
    registry_sha256: str | None
    registry_canonical_digest: str | None
    receipt_digest: str

    def as_dict(self) -> dict[str, object]:
        return {
            "authority": self.authority,
            "canonicalQuoteId": self.canonical_quote_id,
            "canonicalSettlementId": self.canonical_settlement_id,
            "canonicalUnderlyingId": self.canonical_underlying_id,
            "decision": self.decision.value,
            "evaluationTimeMs": self.evaluation_time_ms,
            "historicalStatus": self.historical_status,
            "reasonCodes": list(self.reason_codes),
            "receiptDigest": self.receipt_digest,
            "registryCanonicalDigest": self.registry_canonical_digest,
            "registrySha256": self.registry_sha256,
            "requestSha256": self.request_sha256,
            "schema": self.schema,
            "settlementBasis": self.settlement_basis,
            "settlementSourceField": self.settlement_source_field,
            "spotBaseScale": (
                None if self.spot_base_scale is None else self.spot_base_scale.as_dict()
            ),
            "spotInstrumentId": self.spot_instrument_id,
            "spotPayloadSha256": self.spot_payload_sha256,
            "spotRetrievedAtMs": self.spot_retrieved_at_ms,
            "spotSymbol": self.spot_symbol,
            "spotUnitsPerUsdmBaseUnit": (
                None
                if self.spot_units_per_usdm_base_unit is None
                else self.spot_units_per_usdm_base_unit.as_dict()
            ),
            "statusScope": self.status_scope,
            "usdmBaseScale": (
                None if self.usdm_base_scale is None else self.usdm_base_scale.as_dict()
            ),
            "usdmInstrumentId": self.usdm_instrument_id,
            "usdmPayloadSha256": self.usdm_payload_sha256,
            "usdmRetrievedAtMs": self.usdm_retrieved_at_ms,
            "usdmSymbol": self.usdm_symbol,
        }

    def canonical_bytes(self) -> bytes:
        return canonical_json_bytes(self.as_dict())


@dataclass(frozen=True, slots=True)
class _SourceBinding:
    market_type: MarketType
    endpoint: str
    retrieved_at_ms: int
    payload_size: int
    payload_sha256: str


@dataclass(frozen=True, slots=True)
class _Request:
    evaluation_time_ms: int
    spot_symbol: str
    usdm_symbol: str
    expected_spot_instrument_id: str
    expected_usdm_instrument_id: str
    expected_underlying_id: str
    expected_quote_id: str
    expected_settlement_id: str
    spot_source: _SourceBinding
    usdm_source: _SourceBinding
    registry_sha256: str


@dataclass(frozen=True, slots=True)
class _RegistryEdge:
    market_type: MarketType
    role: IdentityRole
    source: str
    target: str
    start_ms: int
    end_ms: int | None
    kind: str
    scale: Fraction
    continuity: MigrationContinuity | None
    evidence_sha256: str


@dataclass(frozen=True, slots=True)
class _Registry:
    registry_id: str
    edges: tuple[_RegistryEdge, ...]
    canonical_digest: str


@dataclass(frozen=True, slots=True)
class _ResolvedIdentity:
    canonical_id: str
    scale: Fraction
    used_migration: bool


@dataclass(frozen=True, slots=True)
class _SpotInstrument:
    symbol: str
    base_asset: str
    quote_asset: str
    current_symbols: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class _UsdmInstrument:
    symbol: str
    base_asset: str
    quote_asset: str
    margin_asset: str
    current_symbols: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class _Matched:
    request: _Request
    registry: _Registry
    spot: _SpotInstrument
    usdm: _UsdmInstrument
    spot_instrument_id: str
    usdm_instrument_id: str
    underlying_id: str
    quote_id: str
    settlement_id: str
    spot_base_scale: Fraction
    usdm_base_scale: Fraction


def _fail(code: str, detail: str) -> NoReturn:
    raise IdentityContractError(code, detail)


def canonical_json_bytes(value: object) -> bytes:
    """Encode a value in the frozen DQ-12 canonical JSON domain."""

    try:
        encoded = json.dumps(
            value,
            allow_nan=False,
            ensure_ascii=True,
            separators=(",", ":"),
            sort_keys=True,
        )
    except (TypeError, ValueError) as error:
        raise IdentityContractError(
            "CANONICAL_JSON_INVALID", "value is outside the frozen JSON domain"
        ) from error
    return f"{encoded}\n".encode("ascii")


def sha256_hex(payload: bytes) -> str:
    """Return lowercase SHA-256 for exact bytes."""

    if type(payload) is not bytes:
        _fail("INPUT_NOT_BYTES", "digest input must be exact bytes")
    return hashlib.sha256(payload).hexdigest()


def registry_canonical_digest_v1(registry_value: object) -> str:
    """Return the domain-separated digest used in receipts."""

    return hashlib.sha256(_REGISTRY_DOMAIN + canonical_json_bytes(registry_value)).hexdigest()


def _receipt_digest(projection: Mapping[str, object]) -> str:
    return hashlib.sha256(_RECEIPT_DOMAIN + canonical_json_bytes(projection)).hexdigest()


def _digest_or_none(value: object) -> str | None:
    if type(value) is not bytes or not 1 <= len(value) <= MAX_INPUT_BYTES:
        return None
    return hashlib.sha256(value).hexdigest()


def _strict_int(
    value: object,
    *,
    field: str,
    minimum: int = 0,
    maximum: int = _MAX_SAFE_INTEGER,
) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        _fail("INTEGER_INVALID", f"{field} must be a strict integer")
    if not minimum <= value <= maximum:
        _fail("INTEGER_OUT_OF_RANGE", f"{field} is outside the frozen range")
    return value


def _identifier(value: object, *, field: str) -> str:
    if not isinstance(value, str) or _ID_PATTERN.fullmatch(value) is None:
        _fail("IDENTIFIER_INVALID", f"{field} must match the frozen identifier contract")
    return value


def _utf8_size(value: str, *, field: str) -> int:
    try:
        return len(value.encode("utf-8"))
    except UnicodeEncodeError as error:
        raise IdentityContractError(
            "JSON_UNICODE_INVALID",
            f"{field} contains an unpaired Unicode surrogate",
        ) from error


def _raw_identifier(value: object, *, field: str) -> str:
    if not isinstance(value, str) or not value:
        _fail("RAW_IDENTIFIER_INVALID", f"{field} must be a non-empty string")
    if _utf8_size(value, field=field) > 128:
        _fail("RAW_IDENTIFIER_INVALID", f"{field} exceeds the frozen byte bound")
    if value != value.strip():
        _fail("RAW_IDENTIFIER_INVALID", f"{field} has surrounding whitespace")
    if any(unicodedata.category(character) in {"Cc", "Cf"} for character in value):
        _fail("RAW_IDENTIFIER_INVALID", f"{field} contains a control character")
    return value


def _sha256(value: object, *, field: str) -> str:
    if not isinstance(value, str) or _SHA256_PATTERN.fullmatch(value) is None:
        _fail("DIGEST_INVALID", f"{field} must be lowercase SHA-256")
    return value


def _mapping(value: object, *, field: str) -> dict[str, object]:
    if not isinstance(value, dict):
        _fail("JSON_SHAPE_INVALID", f"{field} must be an object")
    return cast(dict[str, object], value)


def _strict_keys(
    value: Mapping[str, object],
    *,
    expected: frozenset[str],
    field: str,
) -> None:
    actual = frozenset(value)
    if actual != expected:
        _fail("SCHEMA_KEYS_INVALID", f"{field} keys do not match the frozen schema")


def _enum_value(
    enum_type: type[MarketType] | type[IdentityRole] | type[BindingKind],
    value: object,
    *,
    field: str,
) -> MarketType | IdentityRole | BindingKind:
    if not isinstance(value, str):
        _fail("ENUM_INVALID", f"{field} must be a string enum")
    try:
        return enum_type(value)
    except ValueError as error:
        raise IdentityContractError("ENUM_INVALID", f"{field} is unsupported") from error


def _nullable_time(value: object, *, field: str) -> int | None:
    if value is None:
        return None
    return _strict_int(value, field=field)


def _fraction(
    numerator: object,
    denominator: object,
    *,
    field: str,
) -> Fraction:
    checked_numerator = _strict_int(
        numerator,
        field=f"{field}.numerator",
        minimum=1,
        maximum=1_000_000_000,
    )
    checked_denominator = _strict_int(
        denominator,
        field=f"{field}.denominator",
        minimum=1,
        maximum=1_000_000_000,
    )
    return Fraction(checked_numerator, checked_denominator)


def _reject_float(_value: str) -> float:
    _fail("JSON_NUMBER_INVALID", "floating-point JSON numbers are outside the contract")


def _bounded_json_int(value: str) -> int:
    if len(value.lstrip("-")) > 16:
        _fail("JSON_NUMBER_INVALID", "JSON integer exceeds the frozen digit bound")
    parsed = int(value)
    if not -_MAX_SAFE_INTEGER <= parsed <= _MAX_SAFE_INTEGER:
        _fail("JSON_NUMBER_INVALID", "JSON integer exceeds the frozen range")
    return parsed


def _reject_constant(_value: str) -> None:
    _fail("JSON_NUMBER_INVALID", "non-finite JSON numbers are outside the contract")


def _no_duplicate_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            _fail("JSON_DUPLICATE_KEY", "input contains a duplicate object key")
        result[key] = value
    return result


def _scan_json_depth(payload: bytes) -> None:
    depth = 0
    in_string = False
    escaped = False
    for byte in payload:
        if in_string:
            if escaped:
                escaped = False
            elif byte == 0x5C:
                escaped = True
            elif byte == 0x22:
                in_string = False
            continue
        if byte == 0x22:
            in_string = True
        elif byte in (0x7B, 0x5B):
            depth += 1
            if depth > MAX_JSON_DEPTH:
                _fail("JSON_DEPTH_EXCEEDED", "input exceeds the frozen JSON depth")
        elif byte in (0x7D, 0x5D):
            depth -= 1
            if depth < 0:
                _fail("JSON_SYNTAX_INVALID", "input has unbalanced JSON delimiters")


def _validate_json_tree(root: object) -> None:
    nodes = 0
    stack: list[tuple[object, int]] = [(root, 1)]
    while stack:
        value, depth = stack.pop()
        nodes += 1
        if nodes > MAX_JSON_NODES:
            _fail("JSON_NODE_LIMIT", "input exceeds the frozen JSON node bound")
        if depth > MAX_JSON_DEPTH:
            _fail("JSON_DEPTH_EXCEEDED", "input exceeds the frozen JSON depth")
        if isinstance(value, str):
            if _utf8_size(value, field="JSON string") > MAX_STRING_BYTES:
                _fail("JSON_STRING_LIMIT", "input string exceeds the frozen byte bound")
        elif isinstance(value, list):
            stack.extend((item, depth + 1) for item in value)
        elif isinstance(value, dict):
            for key, item in cast(dict[str, object], value).items():
                if _utf8_size(key, field="JSON object key") > MAX_STRING_BYTES:
                    _fail("JSON_STRING_LIMIT", "input key exceeds the frozen byte bound")
                stack.append((item, depth + 1))


def _parse_json_bytes(value: object, *, field: str) -> object:
    if type(value) is not bytes:
        _fail("INPUT_NOT_BYTES", f"{field} must be exact bytes")
    payload = value
    if not 1 <= len(payload) <= MAX_INPUT_BYTES:
        _fail("INPUT_SIZE_INVALID", f"{field} exceeds the frozen byte bound")
    _scan_json_depth(payload)
    try:
        text = payload.decode("utf-8", errors="strict")
    except UnicodeDecodeError as error:
        raise IdentityContractError("INPUT_UTF8_INVALID", f"{field} is not UTF-8") from error
    try:
        parsed: object = json.loads(
            text,
            object_pairs_hook=_no_duplicate_object,
            parse_float=_reject_float,
            parse_int=_bounded_json_int,
            parse_constant=_reject_constant,
        )
    except IdentityContractError:
        raise
    except (json.JSONDecodeError, RecursionError) as error:
        raise IdentityContractError("JSON_SYNTAX_INVALID", f"{field} is invalid JSON") from error
    _validate_json_tree(parsed)
    return parsed


def _parse_source(
    value: object,
    *,
    field: str,
    expected_market: MarketType,
    expected_endpoint: str,
) -> _SourceBinding:
    raw = _mapping(value, field=field)
    _strict_keys(raw, expected=_SOURCE_KEYS, field=field)
    market = _enum_value(MarketType, raw["marketType"], field=f"{field}.marketType")
    if market is not expected_market:
        _fail("MARKET_TYPE_MISMATCH", f"{field} market type is not the required venue role")
    endpoint = raw["endpoint"]
    if not isinstance(endpoint, str) or endpoint != expected_endpoint:
        _fail("ENDPOINT_MISMATCH", f"{field} is not bound to the exact approved endpoint")
    return _SourceBinding(
        market_type=expected_market,
        endpoint=endpoint,
        retrieved_at_ms=_strict_int(raw["retrievedAtMs"], field=f"{field}.retrievedAtMs"),
        payload_size=_strict_int(
            raw["payloadSize"],
            field=f"{field}.payloadSize",
            minimum=1,
            maximum=MAX_INPUT_BYTES,
        ),
        payload_sha256=_sha256(raw["payloadSha256"], field=f"{field}.payloadSha256"),
    )


def _parse_request(value: object, *, trusted_evaluation_time_ms: int) -> _Request:
    raw = _mapping(value, field="request")
    _strict_keys(raw, expected=_REQUEST_KEYS, field="request")
    if raw["schema"] != REQUEST_SCHEMA_V1:
        _fail("REQUEST_SCHEMA_INVALID", "request schema is unsupported")
    if raw["statusScope"] != "CURRENT":
        _fail("HISTORICAL_STATUS_UNSUPPORTED", "only current exchange status is supported")
    if raw["asOfMs"] is not None:
        _fail("HISTORICAL_STATUS_UNSUPPORTED", "historical status is not established")
    return _Request(
        evaluation_time_ms=trusted_evaluation_time_ms,
        spot_symbol=_raw_identifier(raw["spotSymbol"], field="request.spotSymbol"),
        usdm_symbol=_raw_identifier(raw["usdmSymbol"], field="request.usdmSymbol"),
        expected_spot_instrument_id=_identifier(
            raw["expectedSpotInstrumentId"],
            field="request.expectedSpotInstrumentId",
        ),
        expected_usdm_instrument_id=_identifier(
            raw["expectedUsdmInstrumentId"],
            field="request.expectedUsdmInstrumentId",
        ),
        expected_underlying_id=_identifier(
            raw["expectedUnderlyingId"],
            field="request.expectedUnderlyingId",
        ),
        expected_quote_id=_identifier(
            raw["expectedQuoteId"],
            field="request.expectedQuoteId",
        ),
        expected_settlement_id=_identifier(
            raw["expectedSettlementId"],
            field="request.expectedSettlementId",
        ),
        spot_source=_parse_source(
            raw["spotSource"],
            field="request.spotSource",
            expected_market=MarketType.SPOT,
            expected_endpoint=SPOT_ENDPOINT_V1,
        ),
        usdm_source=_parse_source(
            raw["usdmSource"],
            field="request.usdmSource",
            expected_market=MarketType.USD_M,
            expected_endpoint=USDM_ENDPOINT_V1,
        ),
        registry_sha256=_sha256(raw["registrySha256"], field="request.registrySha256"),
    )


def _parse_binding(value: object, *, index: int) -> _RegistryEdge:
    field = f"registry.bindings[{index}]"
    raw = _mapping(value, field=field)
    _strict_keys(raw, expected=_BINDING_KEYS, field=field)
    if raw["venue"] != "BINANCE":
        _fail("REGISTRY_SCOPE_INVALID", f"{field} venue must be BINANCE")
    market = _enum_value(MarketType, raw["marketType"], field=f"{field}.marketType")
    role = _enum_value(IdentityRole, raw["role"], field=f"{field}.role")
    kind = _enum_value(BindingKind, raw["kind"], field=f"{field}.kind")
    assert isinstance(market, MarketType)
    assert isinstance(role, IdentityRole)
    assert isinstance(kind, BindingKind)
    start = _strict_int(raw["validFromMs"], field=f"{field}.validFromMs")
    end = _nullable_time(raw["validUntilMs"], field=f"{field}.validUntilMs")
    if end is not None and end <= start:
        _fail("REGISTRY_INTERVAL_INVALID", f"{field} has an empty validity interval")
    scale = _fraction(
        raw["scaleNumerator"],
        raw["scaleDenominator"],
        field=f"{field}.scale",
    )
    if kind is BindingKind.DIRECT and scale != 1:
        _fail("REGISTRY_SCALE_INVALID", f"{field} DIRECT binding must be one-to-one")
    return _RegistryEdge(
        market_type=market,
        role=role,
        source=_raw_identifier(raw["source"], field=f"{field}.source"),
        target=_identifier(raw["target"], field=f"{field}.target"),
        start_ms=start,
        end_ms=end,
        kind=kind.value,
        scale=scale,
        continuity=None,
        evidence_sha256=_sha256(raw["evidenceSha256"], field=f"{field}.evidenceSha256"),
    )


def _parse_migration(value: object, *, index: int) -> _RegistryEdge:
    field = f"registry.migrations[{index}]"
    raw = _mapping(value, field=field)
    _strict_keys(raw, expected=_MIGRATION_KEYS, field=field)
    if raw["venue"] != "BINANCE":
        _fail("REGISTRY_SCOPE_INVALID", f"{field} venue must be BINANCE")
    market = _enum_value(MarketType, raw["marketType"], field=f"{field}.marketType")
    role = _enum_value(IdentityRole, raw["role"], field=f"{field}.role")
    assert isinstance(market, MarketType)
    assert isinstance(role, IdentityRole)
    continuity_raw = raw["continuity"]
    if not isinstance(continuity_raw, str):
        _fail("ENUM_INVALID", f"{field}.continuity must be a string enum")
    try:
        continuity = MigrationContinuity(continuity_raw)
    except ValueError as error:
        raise IdentityContractError("ENUM_INVALID", f"{field}.continuity is unsupported") from error
    start = _strict_int(raw["effectiveAtMs"], field=f"{field}.effectiveAtMs")
    end = _nullable_time(raw["validUntilMs"], field=f"{field}.validUntilMs")
    if end is not None and end <= start:
        _fail("REGISTRY_INTERVAL_INVALID", f"{field} has an empty validity interval")
    source = _raw_identifier(raw["source"], field=f"{field}.source")
    target = _raw_identifier(raw["target"], field=f"{field}.target")
    if source == target:
        _fail("MIGRATION_CHAIN_INVALID", f"{field} is a self-edge")
    return _RegistryEdge(
        market_type=market,
        role=role,
        source=source,
        target=target,
        start_ms=start,
        end_ms=end,
        kind="MIGRATION",
        scale=_fraction(
            raw["scaleNumerator"],
            raw["scaleDenominator"],
            field=f"{field}.scale",
        ),
        continuity=continuity,
        evidence_sha256=_sha256(raw["evidenceSha256"], field=f"{field}.evidenceSha256"),
    )


def _intervals_overlap(left: _RegistryEdge, right: _RegistryEdge) -> bool:
    left_end = _MAX_SAFE_INTEGER + 1 if left.end_ms is None else left.end_ms
    right_end = _MAX_SAFE_INTEGER + 1 if right.end_ms is None else right.end_ms
    return left.start_ms < right_end and right.start_ms < left_end


def _validate_registry_edges(edges: tuple[_RegistryEdge, ...]) -> None:
    if not 1 <= len(edges) <= MAX_REGISTRY_EDGES:
        _fail("REGISTRY_CARDINALITY_INVALID", "registry edge count is outside the bound")
    seen: set[tuple[object, ...]] = set()
    by_source: dict[tuple[MarketType, IdentityRole, str], list[_RegistryEdge]] = {}
    for edge in edges:
        identity = (
            edge.market_type,
            edge.role,
            edge.source,
            edge.target,
            edge.start_ms,
            edge.end_ms,
            edge.kind,
            edge.scale,
            edge.continuity,
            edge.evidence_sha256,
        )
        if identity in seen:
            _fail("REGISTRY_DUPLICATE_EDGE", "registry contains a duplicate edge")
        seen.add(identity)
        by_source.setdefault((edge.market_type, edge.role, edge.source), []).append(edge)
    for scoped_edges in by_source.values():
        ordered = sorted(
            scoped_edges,
            key=lambda item: (
                item.start_ms,
                _MAX_SAFE_INTEGER + 1 if item.end_ms is None else item.end_ms,
                item.target,
            ),
        )
        for previous, current in pairwise(ordered):
            if _intervals_overlap(previous, current):
                _fail(
                    "REGISTRY_AMBIGUOUS_EDGE",
                    "registry has overlapping edges for one scoped source",
                )


def _parse_registry(value: object) -> _Registry:
    raw = _mapping(value, field="registry")
    _strict_keys(raw, expected=_REGISTRY_KEYS, field="registry")
    if raw["schema"] != REGISTRY_SCHEMA_V1:
        _fail("REGISTRY_SCHEMA_INVALID", "registry schema is unsupported")
    registry_id = _identifier(raw["registryId"], field="registry.registryId")
    bindings_raw = raw["bindings"]
    migrations_raw = raw["migrations"]
    if not isinstance(bindings_raw, list) or not isinstance(migrations_raw, list):
        _fail("JSON_SHAPE_INVALID", "registry bindings and migrations must be arrays")
    if len(bindings_raw) + len(migrations_raw) > MAX_REGISTRY_EDGES:
        _fail("REGISTRY_CARDINALITY_INVALID", "registry edge count exceeds the bound")
    edges = (
        *(_parse_binding(value, index=index) for index, value in enumerate(bindings_raw)),
        *(_parse_migration(value, index=index) for index, value in enumerate(migrations_raw)),
    )
    _validate_registry_edges(edges)
    return _Registry(
        registry_id=registry_id,
        edges=edges,
        canonical_digest=registry_canonical_digest_v1(raw),
    )


def _verify_exact_source_binding(
    source: _SourceBinding,
    payload: bytes,
    *,
    evaluation_time_ms: int,
    field: str,
) -> None:
    if len(payload) != source.payload_size:
        _fail("PAYLOAD_SIZE_MISMATCH", f"{field} payload size does not match its receipt")
    if sha256_hex(payload) != source.payload_sha256:
        _fail("PAYLOAD_DIGEST_MISMATCH", f"{field} payload digest does not match its receipt")
    if source.retrieved_at_ms > evaluation_time_ms:
        _fail("SNAPSHOT_FROM_FUTURE", f"{field} snapshot follows evaluation time")
    if evaluation_time_ms - source.retrieved_at_ms > MAX_SNAPSHOT_AGE_MS:
        _fail("SNAPSHOT_STALE", f"{field} snapshot exceeds the current-status freshness bound")


def _symbols(value: object, *, field: str) -> list[dict[str, object]]:
    raw = _mapping(value, field=field)
    values = raw.get("symbols")
    if not isinstance(values, list):
        _fail("JSON_SHAPE_INVALID", f"{field}.symbols must be an array")
    if not 1 <= len(values) <= MAX_SYMBOL_ROWS:
        _fail("SYMBOL_CARDINALITY_INVALID", f"{field}.symbols is outside the bound")
    symbols: list[dict[str, object]] = []
    seen: set[str] = set()
    for index, value in enumerate(values):
        row = _mapping(value, field=f"{field}.symbols[{index}]")
        symbol = _raw_identifier(
            row.get("symbol"),
            field=f"{field}.symbols[{index}].symbol",
        )
        if symbol in seen:
            _fail("DUPLICATE_VENUE_SYMBOL", f"{field} contains a duplicate symbol")
        seen.add(symbol)
        symbols.append(row)
    return symbols


def _select_symbol(
    rows: Sequence[dict[str, object]],
    symbol: str,
    *,
    field: str,
) -> dict[str, object]:
    selected = [row for row in rows if row["symbol"] == symbol]
    if len(selected) != 1:
        _fail("SYMBOL_NOT_UNIQUE", f"{field} symbol is absent or ambiguous")
    return selected[0]


def _required_raw(row: Mapping[str, object], key: str, *, field: str) -> str:
    if key not in row:
        _fail("REQUIRED_FIELD_MISSING", f"{field}.{key} is required")
    return _raw_identifier(row[key], field=f"{field}.{key}")


def _parse_spot_payload(value: object, *, symbol: str) -> _SpotInstrument:
    rows = _symbols(value, field="spot")
    row = _select_symbol(rows, symbol, field="spot")
    status = _required_raw(row, "status", field="spot.symbol")
    if status not in _SPOT_STATUSES:
        _fail("SPOT_STATUS_UNKNOWN", "Spot status is outside the documented current enum")
    if status != "TRADING":
        _fail("SPOT_NOT_TRADING", "Spot symbol is not currently TRADING")
    allowed = row.get("isSpotTradingAllowed")
    if type(allowed) is not bool:
        _fail(
            "REQUIRED_FIELD_TYPE_INVALID",
            "spot.symbol.isSpotTradingAllowed must be a strict boolean",
        )
    if not allowed:
        _fail("SPOT_TRADING_NOT_ALLOWED", "Spot trading is not currently allowed")
    return _SpotInstrument(
        symbol=_required_raw(row, "symbol", field="spot.symbol"),
        base_asset=_required_raw(row, "baseAsset", field="spot.symbol"),
        quote_asset=_required_raw(row, "quoteAsset", field="spot.symbol"),
        current_symbols=tuple(
            cast(str, candidate["symbol"])
            for candidate in rows
            if candidate.get("status") == "TRADING"
            and candidate.get("isSpotTradingAllowed") is True
        ),
    )


def _parse_usdm_payload(value: object, *, symbol: str) -> _UsdmInstrument:
    rows = _symbols(value, field="usdm")
    row = _select_symbol(rows, symbol, field="usdm")
    status = _required_raw(row, "status", field="usdm.symbol")
    if status not in _USDM_STATUSES:
        _fail("USDM_STATUS_UNKNOWN", "USD-M status is outside the documented current enum")
    if status != "TRADING":
        _fail("USDM_NOT_TRADING", "USD-M symbol is not currently TRADING")
    contract_type = _required_raw(row, "contractType", field="usdm.symbol")
    if contract_type not in _USDM_CONTRACT_TYPES:
        _fail(
            "USDM_CONTRACT_TYPE_UNKNOWN",
            "USD-M contract type is outside the documented enum",
        )
    if contract_type != "PERPETUAL":
        _fail("USDM_CONTRACT_NOT_PERPETUAL", "USD-M contract is not PERPETUAL")
    underlying_type = _required_raw(row, "underlyingType", field="usdm.symbol")
    if underlying_type != "COIN":
        _fail("USDM_UNDERLYING_NOT_COIN", "USD-M underlying type is not COIN")
    row_symbol = _required_raw(row, "symbol", field="usdm.symbol")
    pair = _required_raw(row, "pair", field="usdm.symbol")
    if pair != row_symbol:
        _fail("USDM_PAIR_SYMBOL_MISMATCH", "USD-M pair does not equal symbol")
    return _UsdmInstrument(
        symbol=row_symbol,
        base_asset=_required_raw(row, "baseAsset", field="usdm.symbol"),
        quote_asset=_required_raw(row, "quoteAsset", field="usdm.symbol"),
        margin_asset=_required_raw(row, "marginAsset", field="usdm.symbol"),
        current_symbols=tuple(
            cast(str, candidate["symbol"])
            for candidate in rows
            if candidate.get("status") == "TRADING"
            and candidate.get("contractType") == "PERPETUAL"
            and candidate.get("underlyingType") == "COIN"
            and candidate.get("pair") == candidate.get("symbol")
        ),
    )


def _edge_active(edge: _RegistryEdge, at_ms: int) -> bool:
    return edge.start_ms <= at_ms and (edge.end_ms is None or at_ms < edge.end_ms)


def _resolve_identity(
    registry: _Registry,
    *,
    market_type: MarketType,
    role: IdentityRole,
    source: str,
    at_ms: int,
) -> _ResolvedIdentity:
    current = source
    scale = Fraction(1)
    visited: set[str] = set()
    used_migration = False
    for depth in range(MAX_ALIAS_DEPTH + 1):
        if current in visited:
            _fail("ALIAS_CYCLE", "registry resolution contains a cycle")
        visited.add(current)
        active = [
            edge
            for edge in registry.edges
            if edge.market_type is market_type
            and edge.role is role
            and edge.source == current
            and _edge_active(edge, at_ms)
        ]
        if not active:
            if depth == 0:
                _fail("BINDING_MISSING", "registry has no active scoped identity binding")
            _fail("BINDING_TERMINAL_UNPROVEN", "identity chain does not end in DIRECT")
        if len(active) != 1:
            _fail("BINDING_AMBIGUOUS", "registry has multiple active scoped bindings")
        edge = active[0]
        scale *= edge.scale
        if edge.kind == BindingKind.DIRECT.value:
            return _ResolvedIdentity(
                canonical_id=edge.target,
                scale=scale,
                used_migration=used_migration,
            )
        if depth == MAX_ALIAS_DEPTH:
            _fail("ALIAS_DEPTH_EXCEEDED", "identity chain exceeds the frozen edge bound")
        if edge.kind == "MIGRATION":
            used_migration = True
            if edge.continuity is MigrationContinuity.CHANGES_UNDERLYING:
                _fail(
                    "MIGRATION_CHANGES_UNDERLYING",
                    "migration does not preserve underlying identity",
                )
        current = edge.target
    _fail("ALIAS_DEPTH_EXCEEDED", "identity chain exceeds the frozen edge bound")


def _validate_active_registry_graph(registry: _Registry, *, at_ms: int) -> None:
    scoped_sources = {
        (edge.market_type, edge.role, edge.source)
        for edge in registry.edges
        if _edge_active(edge, at_ms)
    }
    for market_type, role, source in sorted(
        scoped_sources,
        key=lambda item: (item[0].value, item[1].value, item[2]),
    ):
        resolved = _resolve_identity(
            registry,
            market_type=market_type,
            role=role,
            source=source,
            at_ms=at_ms,
        )
        if role is IdentityRole.SYMBOL and resolved.scale != 1:
            _fail("SYMBOL_SCALE_INVALID", "symbol identities must be one-to-one")


def _require_unique_current_symbol_identity(
    registry: _Registry,
    *,
    market_type: MarketType,
    selected_symbol: str,
    selected_identity: str,
    current_symbols: tuple[str, ...],
    at_ms: int,
) -> None:
    for candidate in current_symbols:
        if candidate == selected_symbol:
            continue
        try:
            resolved = _resolve_identity(
                registry,
                market_type=market_type,
                role=IdentityRole.SYMBOL,
                source=candidate,
                at_ms=at_ms,
            )
        except IdentityContractError as error:
            if error.code == "BINDING_MISSING":
                continue
            raise
        if resolved.canonical_id == selected_identity:
            _fail(
                "CANONICAL_INSTRUMENT_COLLISION",
                "multiple currently eligible venue symbols resolve to one instrument",
            )


def _require_identity(
    actual: _ResolvedIdentity,
    expected: str,
    *,
    code: str,
) -> None:
    if actual.canonical_id != expected:
        _fail(code, "resolved canonical identity differs from the request")


def _validate_join(
    request: _Request,
    registry: _Registry,
    spot: _SpotInstrument,
    usdm: _UsdmInstrument,
) -> _Matched:
    at_ms = request.evaluation_time_ms
    spot_symbol = _resolve_identity(
        registry,
        market_type=MarketType.SPOT,
        role=IdentityRole.SYMBOL,
        source=spot.symbol,
        at_ms=at_ms,
    )
    usdm_symbol = _resolve_identity(
        registry,
        market_type=MarketType.USD_M,
        role=IdentityRole.SYMBOL,
        source=usdm.symbol,
        at_ms=at_ms,
    )
    if spot_symbol.scale != 1 or usdm_symbol.scale != 1:
        _fail("SYMBOL_SCALE_INVALID", "symbol identities must be one-to-one")
    _require_identity(
        spot_symbol,
        request.expected_spot_instrument_id,
        code="SPOT_INSTRUMENT_IDENTITY_MISMATCH",
    )
    _require_identity(
        usdm_symbol,
        request.expected_usdm_instrument_id,
        code="USDM_INSTRUMENT_IDENTITY_MISMATCH",
    )
    if spot_symbol.canonical_id == usdm_symbol.canonical_id:
        _fail(
            "CROSS_MARKET_INSTRUMENT_COLLISION",
            "Spot and USD-M legs must retain distinct instrument identities",
        )
    _require_unique_current_symbol_identity(
        registry,
        market_type=MarketType.SPOT,
        selected_symbol=spot.symbol,
        selected_identity=spot_symbol.canonical_id,
        current_symbols=spot.current_symbols,
        at_ms=at_ms,
    )
    _require_unique_current_symbol_identity(
        registry,
        market_type=MarketType.USD_M,
        selected_symbol=usdm.symbol,
        selected_identity=usdm_symbol.canonical_id,
        current_symbols=usdm.current_symbols,
        at_ms=at_ms,
    )

    spot_base = _resolve_identity(
        registry,
        market_type=MarketType.SPOT,
        role=IdentityRole.BASE,
        source=spot.base_asset,
        at_ms=at_ms,
    )
    usdm_base = _resolve_identity(
        registry,
        market_type=MarketType.USD_M,
        role=IdentityRole.BASE,
        source=usdm.base_asset,
        at_ms=at_ms,
    )
    _require_identity(
        spot_base,
        request.expected_underlying_id,
        code="EXPECTED_UNDERLYING_MISMATCH",
    )
    _require_identity(
        usdm_base,
        request.expected_underlying_id,
        code="EXPECTED_UNDERLYING_MISMATCH",
    )
    if spot_base.canonical_id != usdm_base.canonical_id:
        _fail("SAME_UNDERLYING_MISMATCH", "legs do not resolve to one underlying")

    spot_quote = _resolve_identity(
        registry,
        market_type=MarketType.SPOT,
        role=IdentityRole.QUOTE,
        source=spot.quote_asset,
        at_ms=at_ms,
    )
    usdm_quote = _resolve_identity(
        registry,
        market_type=MarketType.USD_M,
        role=IdentityRole.QUOTE,
        source=usdm.quote_asset,
        at_ms=at_ms,
    )
    usdm_settlement = _resolve_identity(
        registry,
        market_type=MarketType.USD_M,
        role=IdentityRole.SETTLEMENT,
        source=usdm.margin_asset,
        at_ms=at_ms,
    )
    for identity in (spot_quote, usdm_quote):
        _require_identity(
            identity,
            request.expected_quote_id,
            code="QUOTE_ASSET_IDENTITY_MISMATCH",
        )
    _require_identity(
        usdm_settlement,
        request.expected_settlement_id,
        code="SETTLEMENT_ASSET_IDENTITY_MISMATCH",
    )
    if request.expected_quote_id != request.expected_settlement_id:
        _fail(
            "QUOTE_SETTLEMENT_IDENTITY_MISMATCH",
            "Spot/USD-M v1 requires quote and settlement identity",
        )
    if not (spot_quote.canonical_id == usdm_quote.canonical_id == usdm_settlement.canonical_id):
        _fail(
            "QUOTE_SETTLEMENT_IDENTITY_MISMATCH",
            "quote and settlement do not resolve to one canonical asset",
        )
    if not (spot_quote.scale == usdm_quote.scale == usdm_settlement.scale):
        _fail(
            "QUOTE_SETTLEMENT_SCALE_MISMATCH",
            "quote and settlement unit scales are not identical",
        )
    return _Matched(
        request=request,
        registry=registry,
        spot=spot,
        usdm=usdm,
        spot_instrument_id=spot_symbol.canonical_id,
        usdm_instrument_id=usdm_symbol.canonical_id,
        underlying_id=spot_base.canonical_id,
        quote_id=spot_quote.canonical_id,
        settlement_id=usdm_settlement.canonical_id,
        spot_base_scale=spot_base.scale,
        usdm_base_scale=usdm_base.scale,
    )


def _build_receipt(
    *,
    decision: IdentityDecision,
    reason_codes: tuple[str, ...],
    request_sha256: str | None,
    spot_payload_sha256: str | None,
    usdm_payload_sha256: str | None,
    registry_sha256: str | None,
    registry_canonical_digest: str | None = None,
    evaluation_time_ms: int | None = None,
    spot_retrieved_at_ms: int | None = None,
    usdm_retrieved_at_ms: int | None = None,
    matched: _Matched | None = None,
) -> PairIdentityReceiptV1:
    if decision is IdentityDecision.MATCHED:
        if matched is None or reason_codes:
            _fail("RECEIPT_STATE_INVALID", "MATCHED requires complete identity and no reasons")
        spot_units_per_usdm = matched.usdm_base_scale / matched.spot_base_scale
        values: dict[str, object] = {
            "authority": "NONE",
            "canonicalQuoteId": matched.quote_id,
            "canonicalSettlementId": matched.settlement_id,
            "canonicalUnderlyingId": matched.underlying_id,
            "decision": decision.value,
            "evaluationTimeMs": matched.request.evaluation_time_ms,
            "historicalStatus": "UNKNOWN",
            "reasonCodes": [],
            "registryCanonicalDigest": matched.registry.canonical_digest,
            "registrySha256": registry_sha256,
            "requestSha256": request_sha256,
            "schema": SCHEMA_V1,
            "settlementBasis": SETTLEMENT_BASIS_V1,
            "settlementSourceField": "marginAsset",
            "spotBaseScale": RationalScaleV1.from_fraction(matched.spot_base_scale).as_dict(),
            "spotInstrumentId": matched.spot_instrument_id,
            "spotPayloadSha256": spot_payload_sha256,
            "spotRetrievedAtMs": matched.request.spot_source.retrieved_at_ms,
            "spotSymbol": matched.spot.symbol,
            "spotUnitsPerUsdmBaseUnit": RationalScaleV1.from_fraction(
                spot_units_per_usdm
            ).as_dict(),
            "statusScope": STATUS_SCOPE_V1,
            "usdmBaseScale": RationalScaleV1.from_fraction(matched.usdm_base_scale).as_dict(),
            "usdmInstrumentId": matched.usdm_instrument_id,
            "usdmPayloadSha256": usdm_payload_sha256,
            "usdmRetrievedAtMs": matched.request.usdm_source.retrieved_at_ms,
            "usdmSymbol": matched.usdm.symbol,
        }
    else:
        if matched is not None or len(reason_codes) != 1:
            _fail("RECEIPT_STATE_INVALID", "UNKNOWN requires exactly one stable reason")
        values = {
            "authority": "NONE",
            "canonicalQuoteId": None,
            "canonicalSettlementId": None,
            "canonicalUnderlyingId": None,
            "decision": decision.value,
            "evaluationTimeMs": evaluation_time_ms,
            "historicalStatus": "UNKNOWN",
            "reasonCodes": list(reason_codes),
            "registryCanonicalDigest": registry_canonical_digest,
            "registrySha256": registry_sha256,
            "requestSha256": request_sha256,
            "schema": SCHEMA_V1,
            "settlementBasis": None,
            "settlementSourceField": None,
            "spotBaseScale": None,
            "spotInstrumentId": None,
            "spotPayloadSha256": spot_payload_sha256,
            "spotRetrievedAtMs": spot_retrieved_at_ms,
            "spotSymbol": None,
            "spotUnitsPerUsdmBaseUnit": None,
            "statusScope": STATUS_SCOPE_V1,
            "usdmBaseScale": None,
            "usdmInstrumentId": None,
            "usdmPayloadSha256": usdm_payload_sha256,
            "usdmRetrievedAtMs": usdm_retrieved_at_ms,
            "usdmSymbol": None,
        }
    digest = _receipt_digest(values)
    if matched is None:
        return PairIdentityReceiptV1(
            schema=SCHEMA_V1,
            decision=decision,
            reason_codes=reason_codes,
            status_scope=STATUS_SCOPE_V1,
            evaluation_time_ms=evaluation_time_ms,
            spot_retrieved_at_ms=spot_retrieved_at_ms,
            usdm_retrieved_at_ms=usdm_retrieved_at_ms,
            spot_symbol=None,
            usdm_symbol=None,
            spot_instrument_id=None,
            usdm_instrument_id=None,
            canonical_underlying_id=None,
            canonical_quote_id=None,
            canonical_settlement_id=None,
            settlement_basis=None,
            settlement_source_field=None,
            spot_base_scale=None,
            usdm_base_scale=None,
            spot_units_per_usdm_base_unit=None,
            historical_status="UNKNOWN",
            authority="NONE",
            request_sha256=request_sha256,
            spot_payload_sha256=spot_payload_sha256,
            usdm_payload_sha256=usdm_payload_sha256,
            registry_sha256=registry_sha256,
            registry_canonical_digest=registry_canonical_digest,
            receipt_digest=digest,
        )
    return PairIdentityReceiptV1(
        schema=SCHEMA_V1,
        decision=decision,
        reason_codes=(),
        status_scope=STATUS_SCOPE_V1,
        evaluation_time_ms=matched.request.evaluation_time_ms,
        spot_retrieved_at_ms=matched.request.spot_source.retrieved_at_ms,
        usdm_retrieved_at_ms=matched.request.usdm_source.retrieved_at_ms,
        spot_symbol=matched.spot.symbol,
        usdm_symbol=matched.usdm.symbol,
        spot_instrument_id=matched.spot_instrument_id,
        usdm_instrument_id=matched.usdm_instrument_id,
        canonical_underlying_id=matched.underlying_id,
        canonical_quote_id=matched.quote_id,
        canonical_settlement_id=matched.settlement_id,
        settlement_basis=SETTLEMENT_BASIS_V1,
        settlement_source_field="marginAsset",
        spot_base_scale=RationalScaleV1.from_fraction(matched.spot_base_scale),
        usdm_base_scale=RationalScaleV1.from_fraction(matched.usdm_base_scale),
        spot_units_per_usdm_base_unit=RationalScaleV1.from_fraction(
            matched.usdm_base_scale / matched.spot_base_scale
        ),
        historical_status="UNKNOWN",
        authority="NONE",
        request_sha256=request_sha256,
        spot_payload_sha256=spot_payload_sha256,
        usdm_payload_sha256=usdm_payload_sha256,
        registry_sha256=registry_sha256,
        registry_canonical_digest=matched.registry.canonical_digest,
        receipt_digest=digest,
    )


def validate_spot_usdm_identity_v1(
    *,
    trusted_evaluation_time_ms: int,
    request_bytes: bytes,
    spot_snapshot_bytes: bytes,
    usdm_snapshot_bytes: bytes,
    registry_bytes: bytes,
) -> PairIdentityReceiptV1:
    """Validate one fresh current Binance Spot to USD-M perpetual identity join.

    The caller must inject a trusted current evaluation time outside the
    self-described request bytes. The function performs no I/O and catches every
    input-contract failure as an ineligible ``UNKNOWN`` receipt. A ``MATCHED``
    result proves identity only at that disclosed current-time boundary; it grants
    no execution, order, transfer, withdrawal, or capital authority.
    """

    request_digest = _digest_or_none(request_bytes)
    spot_digest = _digest_or_none(spot_snapshot_bytes)
    usdm_digest = _digest_or_none(usdm_snapshot_bytes)
    registry_digest = _digest_or_none(registry_bytes)
    registry_canonical_digest: str | None = None
    evaluation_time_ms: int | None = None
    request: _Request | None = None
    try:
        evaluation_time_ms = _strict_int(
            trusted_evaluation_time_ms,
            field="trustedEvaluationTimeMs",
        )
        for field, value in (
            ("request", request_bytes),
            ("spot", spot_snapshot_bytes),
            ("usdm", usdm_snapshot_bytes),
            ("registry", registry_bytes),
        ):
            if type(value) is not bytes:
                _fail("INPUT_NOT_BYTES", f"{field} must be exact bytes")
            if not 1 <= len(value) <= MAX_INPUT_BYTES:
                _fail("INPUT_SIZE_INVALID", f"{field} exceeds the frozen byte bound")

        request_value = _parse_json_bytes(request_bytes, field="request")
        registry_value = _parse_json_bytes(registry_bytes, field="registry")
        spot_value = _parse_json_bytes(spot_snapshot_bytes, field="spot")
        usdm_value = _parse_json_bytes(usdm_snapshot_bytes, field="usdm")
        request = _parse_request(
            request_value,
            trusted_evaluation_time_ms=evaluation_time_ms,
        )
        registry = _parse_registry(registry_value)
        registry_canonical_digest = registry.canonical_digest

        if request.registry_sha256 != registry_digest:
            _fail("REGISTRY_DIGEST_MISMATCH", "registry bytes do not match the request")
        _verify_exact_source_binding(
            request.spot_source,
            spot_snapshot_bytes,
            evaluation_time_ms=request.evaluation_time_ms,
            field="spot",
        )
        _verify_exact_source_binding(
            request.usdm_source,
            usdm_snapshot_bytes,
            evaluation_time_ms=request.evaluation_time_ms,
            field="usdm",
        )
        if (
            abs(request.spot_source.retrieved_at_ms - request.usdm_source.retrieved_at_ms)
            > MAX_SNAPSHOT_SKEW_MS
        ):
            _fail("SNAPSHOT_PAIR_SKEW", "Spot and USD-M snapshots exceed the skew bound")
        _validate_active_registry_graph(
            registry,
            at_ms=request.evaluation_time_ms,
        )

        spot = _parse_spot_payload(spot_value, symbol=request.spot_symbol)
        usdm = _parse_usdm_payload(usdm_value, symbol=request.usdm_symbol)
        matched = _validate_join(request, registry, spot, usdm)
        return _build_receipt(
            decision=IdentityDecision.MATCHED,
            reason_codes=(),
            request_sha256=request_digest,
            spot_payload_sha256=spot_digest,
            usdm_payload_sha256=usdm_digest,
            registry_sha256=registry_digest,
            matched=matched,
        )
    except IdentityContractError as error:
        return _build_receipt(
            decision=IdentityDecision.UNKNOWN,
            reason_codes=(error.code,),
            request_sha256=request_digest,
            spot_payload_sha256=spot_digest,
            usdm_payload_sha256=usdm_digest,
            registry_sha256=registry_digest,
            registry_canonical_digest=registry_canonical_digest,
            evaluation_time_ms=evaluation_time_ms,
            spot_retrieved_at_ms=(None if request is None else request.spot_source.retrieved_at_ms),
            usdm_retrieved_at_ms=(None if request is None else request.usdm_source.retrieved_at_ms),
        )


def _read_cli_input(path: Path, *, field: str) -> bytes:
    try:
        value = path.read_bytes()
    except OSError as error:
        raise IdentityContractError("CLI_INPUT_UNAVAILABLE", f"{field} is unavailable") from error
    if len(value) > MAX_INPUT_BYTES:
        _fail("INPUT_SIZE_INVALID", f"{field} exceeds the frozen byte bound")
    return value


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="dq12-instrument-identity",
        description="Offline Binance Spot to USD-M current instrument-identity validator",
    )
    parser.add_argument("--request", type=Path, required=True)
    parser.add_argument("--spot", type=Path, required=True)
    parser.add_argument("--usdm", type=Path, required=True)
    parser.add_argument("--registry", type=Path, required=True)
    parser.add_argument("--trusted-evaluation-time-ms", type=int, required=True)
    arguments = parser.parse_args(argv)
    evaluation_time_ms: int | None = None
    try:
        evaluation_time_ms = _strict_int(
            arguments.trusted_evaluation_time_ms,
            field="trustedEvaluationTimeMs",
        )
        request = _read_cli_input(arguments.request, field="request")
        spot = _read_cli_input(arguments.spot, field="spot")
        usdm = _read_cli_input(arguments.usdm, field="usdm")
        registry = _read_cli_input(arguments.registry, field="registry")
        receipt = validate_spot_usdm_identity_v1(
            trusted_evaluation_time_ms=evaluation_time_ms,
            request_bytes=request,
            spot_snapshot_bytes=spot,
            usdm_snapshot_bytes=usdm,
            registry_bytes=registry,
        )
    except IdentityContractError as error:
        receipt = _build_receipt(
            decision=IdentityDecision.UNKNOWN,
            reason_codes=(error.code,),
            request_sha256=None,
            spot_payload_sha256=None,
            usdm_payload_sha256=None,
            registry_sha256=None,
            evaluation_time_ms=evaluation_time_ms,
        )
    sys.stdout.buffer.write(receipt.canonical_bytes())
    return 0 if receipt.decision is IdentityDecision.MATCHED else 2


if __name__ == "__main__":
    raise SystemExit(main())
