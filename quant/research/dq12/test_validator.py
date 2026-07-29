from __future__ import annotations

import copy
import hashlib
import json
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import cast

import pytest
from research.dq12.validator import (
    MAX_ALIAS_DEPTH,
    MAX_INPUT_BYTES,
    MAX_JSON_DEPTH,
    MAX_JSON_NODES,
    MAX_REGISTRY_EDGES,
    MAX_SNAPSHOT_AGE_MS,
    MAX_SNAPSHOT_SKEW_MS,
    MAX_STRING_BYTES,
    REQUEST_SCHEMA_V1,
    SPOT_ENDPOINT_V1,
    USDM_ENDPOINT_V1,
    IdentityDecision,
    PairIdentityReceiptV1,
    canonical_json_bytes,
    validate_spot_usdm_identity_v1,
)

JsonObject = dict[str, object]
RequestMutator = Callable[[JsonObject], None]

HERE = Path(__file__).resolve().parent
FIXTURES = HERE / "fixtures"
EVALUATION_TIME_MS = 2_000_000_000_000
RECEIPT_DOMAIN = b"cosmos-dq12-instrument-identity-receipt-v1\0"


@dataclass(slots=True)
class Packet:
    spot: JsonObject
    usdm: JsonObject
    registry: JsonObject
    expected_spot_instrument_id: str
    expected_usdm_instrument_id: str
    expected_underlying_id: str
    expected_quote_id: str
    expected_settlement_id: str


def _json_object(raw: bytes) -> JsonObject:
    value: object = json.loads(raw.decode("utf-8"))
    assert isinstance(value, dict)
    return cast(JsonObject, value)


def _fixture_bytes(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


def _rows(payload: JsonObject) -> list[JsonObject]:
    rows = payload["symbols"]
    assert isinstance(rows, list)
    return cast(list[JsonObject], rows)


def _row(payload: JsonObject) -> JsonObject:
    rows = _rows(payload)
    assert len(rows) == 1
    return rows[0]


def _bindings(registry: JsonObject) -> list[JsonObject]:
    bindings = registry["bindings"]
    assert isinstance(bindings, list)
    return cast(list[JsonObject], bindings)


def _migrations(registry: JsonObject) -> list[JsonObject]:
    migrations = registry["migrations"]
    assert isinstance(migrations, list)
    return cast(list[JsonObject], migrations)


def _source(request: JsonObject, key: str) -> JsonObject:
    value = request[key]
    assert isinstance(value, dict)
    return cast(JsonObject, value)


def _evidence(label: str) -> str:
    return hashlib.sha256(f"dq12-test:{label}".encode()).hexdigest()


def _binding(
    *,
    market_type: str,
    role: str,
    source: str,
    target: str,
    kind: str = "DIRECT",
    numerator: int = 1,
    denominator: int = 1,
    valid_from_ms: int = 0,
    valid_until_ms: int | None = None,
) -> JsonObject:
    return {
        "evidenceSha256": _evidence(
            f"binding:{market_type}:{role}:{source}:{target}:{valid_from_ms}"
        ),
        "kind": kind,
        "marketType": market_type,
        "role": role,
        "scaleDenominator": denominator,
        "scaleNumerator": numerator,
        "source": source,
        "target": target,
        "validFromMs": valid_from_ms,
        "validUntilMs": valid_until_ms,
        "venue": "BINANCE",
    }


def _migration(
    *,
    market_type: str,
    role: str,
    source: str,
    target: str,
    continuity: str = "PRESERVES_UNDERLYING",
    numerator: int = 1,
    denominator: int = 1,
    effective_at_ms: int = 0,
    valid_until_ms: int | None = None,
) -> JsonObject:
    return {
        "continuity": continuity,
        "effectiveAtMs": effective_at_ms,
        "evidenceSha256": _evidence(
            f"migration:{market_type}:{role}:{source}:{target}:{effective_at_ms}"
        ),
        "marketType": market_type,
        "role": role,
        "scaleDenominator": denominator,
        "scaleNumerator": numerator,
        "source": source,
        "target": target,
        "validUntilMs": valid_until_ms,
        "venue": "BINANCE",
    }


def _packet(
    *,
    spot_symbol: str = "BTCUSDT",
    usdm_symbol: str = "BTCUSDT",
    spot_base: str = "BTC",
    usdm_base: str = "BTC",
    quote: str = "USDT",
    margin_asset: str | None = None,
    expected_underlying_id: str | None = None,
    expected_quote_id: str | None = None,
) -> Packet:
    margin = quote if margin_asset is None else margin_asset
    underlying_id = (
        f"asset.{spot_base}" if expected_underlying_id is None else expected_underlying_id
    )
    quote_id = f"asset.{quote}" if expected_quote_id is None else expected_quote_id
    settlement_id = f"asset.{margin}"
    spot_instrument_id = f"binance.spot.{spot_symbol}"
    usdm_instrument_id = f"binance.usdm.{usdm_symbol}"
    spot: JsonObject = {
        "symbols": [
            {
                "baseAsset": spot_base,
                "isSpotTradingAllowed": True,
                "quoteAsset": quote,
                "status": "TRADING",
                "symbol": spot_symbol,
            }
        ]
    }
    usdm: JsonObject = {
        "symbols": [
            {
                "baseAsset": usdm_base,
                "contractType": "PERPETUAL",
                "marginAsset": margin,
                "pair": usdm_symbol,
                "quoteAsset": quote,
                "status": "TRADING",
                "symbol": usdm_symbol,
                "underlyingType": "COIN",
            }
        ]
    }
    registry: JsonObject = {
        "bindings": [
            _binding(
                market_type="SPOT",
                role="SYMBOL",
                source=spot_symbol,
                target=spot_instrument_id,
            ),
            _binding(
                market_type="USD_M",
                role="SYMBOL",
                source=usdm_symbol,
                target=usdm_instrument_id,
            ),
            _binding(
                market_type="SPOT",
                role="BASE",
                source=spot_base,
                target=underlying_id,
            ),
            _binding(
                market_type="USD_M",
                role="BASE",
                source=usdm_base,
                target=underlying_id,
            ),
            _binding(
                market_type="SPOT",
                role="QUOTE",
                source=quote,
                target=quote_id,
            ),
            _binding(
                market_type="USD_M",
                role="QUOTE",
                source=quote,
                target=quote_id,
            ),
            _binding(
                market_type="USD_M",
                role="SETTLEMENT",
                source=margin,
                target=settlement_id,
            ),
        ],
        "migrations": [],
        "registryId": "dq12.test.registry.v1",
        "schema": "cosmos.dq12.identity-registry.v1",
    }
    return Packet(
        spot=spot,
        usdm=usdm,
        registry=registry,
        expected_spot_instrument_id=spot_instrument_id,
        expected_usdm_instrument_id=usdm_instrument_id,
        expected_underlying_id=underlying_id,
        expected_quote_id=quote_id,
        expected_settlement_id=settlement_id,
    )


def _request_for(
    packet: Packet,
    *,
    spot_bytes: bytes,
    usdm_bytes: bytes,
    registry_bytes: bytes,
) -> JsonObject:
    return {
        "asOfMs": None,
        "evaluationTimeMs": EVALUATION_TIME_MS,
        "expectedQuoteId": packet.expected_quote_id,
        "expectedSettlementId": packet.expected_settlement_id,
        "expectedSpotInstrumentId": packet.expected_spot_instrument_id,
        "expectedUnderlyingId": packet.expected_underlying_id,
        "expectedUsdmInstrumentId": packet.expected_usdm_instrument_id,
        "registrySha256": hashlib.sha256(registry_bytes).hexdigest(),
        "schema": REQUEST_SCHEMA_V1,
        "spotSource": {
            "endpoint": SPOT_ENDPOINT_V1,
            "marketType": "SPOT",
            "payloadSha256": hashlib.sha256(spot_bytes).hexdigest(),
            "payloadSize": len(spot_bytes),
            "retrievedAtMs": EVALUATION_TIME_MS - 30_000,
        },
        "spotSymbol": _rows(packet.spot)[0]["symbol"],
        "statusScope": "CURRENT",
        "usdmSource": {
            "endpoint": USDM_ENDPOINT_V1,
            "marketType": "USD_M",
            "payloadSha256": hashlib.sha256(usdm_bytes).hexdigest(),
            "payloadSize": len(usdm_bytes),
            "retrievedAtMs": EVALUATION_TIME_MS - 25_000,
        },
        "usdmSymbol": _rows(packet.usdm)[0]["symbol"],
    }


def _validate_packet(
    packet: Packet,
    *,
    request_mutator: RequestMutator | None = None,
    spot_bytes_after_binding: bytes | None = None,
    usdm_bytes_after_binding: bytes | None = None,
    registry_bytes_after_binding: bytes | None = None,
) -> PairIdentityReceiptV1:
    spot_bytes = canonical_json_bytes(packet.spot)
    usdm_bytes = canonical_json_bytes(packet.usdm)
    registry_bytes = canonical_json_bytes(packet.registry)
    request = _request_for(
        packet,
        spot_bytes=spot_bytes,
        usdm_bytes=usdm_bytes,
        registry_bytes=registry_bytes,
    )
    if request_mutator is not None:
        request_mutator(request)
    return validate_spot_usdm_identity_v1(
        request_bytes=canonical_json_bytes(request),
        spot_snapshot_bytes=(
            spot_bytes if spot_bytes_after_binding is None else spot_bytes_after_binding
        ),
        usdm_snapshot_bytes=(
            usdm_bytes if usdm_bytes_after_binding is None else usdm_bytes_after_binding
        ),
        registry_bytes=(
            registry_bytes if registry_bytes_after_binding is None else registry_bytes_after_binding
        ),
    )


def _assert_unknown(receipt: PairIdentityReceiptV1, reason: str) -> None:
    assert receipt.decision is IdentityDecision.UNKNOWN
    assert receipt.reason_codes == (reason,)
    assert receipt.authority == "NONE"
    assert receipt.canonical_underlying_id is None
    assert receipt.canonical_quote_id is None
    assert receipt.canonical_settlement_id is None


def _assert_receipt_digest(receipt: PairIdentityReceiptV1) -> None:
    projection = receipt.as_dict()
    actual = projection.pop("receiptDigest")
    assert isinstance(actual, str)
    expected = hashlib.sha256(RECEIPT_DOMAIN + canonical_json_bytes(projection)).hexdigest()
    assert actual == expected


def _remove_binding(
    registry: JsonObject,
    *,
    market_type: str,
    role: str,
    source: str,
) -> JsonObject:
    matches = [
        item
        for item in _bindings(registry)
        if item["marketType"] == market_type and item["role"] == role and item["source"] == source
    ]
    assert len(matches) == 1
    _bindings(registry).remove(matches[0])
    return matches[0]


def test_committed_known_answer_fixture_is_matched_and_digest_bound() -> None:
    request = _fixture_bytes("request-btcusdt.current.json")
    spot = _fixture_bytes("spot-btcusdt.current.json")
    usdm = _fixture_bytes("usdm-btcusdt.current.json")
    registry = _fixture_bytes("registry-btcusdt.v1.json")
    receipt = validate_spot_usdm_identity_v1(
        request_bytes=request,
        spot_snapshot_bytes=spot,
        usdm_snapshot_bytes=usdm,
        registry_bytes=registry,
    )

    known = _json_object((HERE / "known_answer.v1.json").read_bytes())
    expected = known["expectedReceiptSemantics"]
    assert isinstance(expected, dict)
    actual = receipt.as_dict()
    for key, value in cast(JsonObject, expected).items():
        assert actual[key] == value
    assert receipt.request_sha256 == hashlib.sha256(request).hexdigest()
    assert receipt.spot_payload_sha256 == hashlib.sha256(spot).hexdigest()
    assert receipt.usdm_payload_sha256 == hashlib.sha256(usdm).hexdigest()
    assert receipt.registry_sha256 == hashlib.sha256(registry).hexdigest()
    assert receipt.registry_canonical_digest is not None
    _assert_receipt_digest(receipt)


def test_fixture_manifest_exact_bytes_and_declared_offline_scope() -> None:
    manifest = _json_object((HERE / "fixture-manifest.v1.json").read_bytes())
    assert manifest["networkRequired"] is False
    assert manifest["synthetic"] is True
    fixtures = manifest["fixtures"]
    assert isinstance(fixtures, list)
    for untyped_entry in fixtures:
        assert isinstance(untyped_entry, dict)
        entry = cast(JsonObject, untyped_entry)
        path = HERE / cast(str, entry["path"])
        payload = path.read_bytes()
        assert len(payload) == entry["bytes"]
        assert hashlib.sha256(payload).hexdigest() == entry["sha256"]


@pytest.mark.parametrize(
    ("source_key", "field", "value", "reason"),
    [
        ("spotSource", "endpoint", USDM_ENDPOINT_V1, "ENDPOINT_MISMATCH"),
        ("usdmSource", "endpoint", SPOT_ENDPOINT_V1, "ENDPOINT_MISMATCH"),
        ("spotSource", "marketType", "USD_M", "MARKET_TYPE_MISMATCH"),
        ("usdmSource", "marketType", "SPOT", "MARKET_TYPE_MISMATCH"),
        ("spotSource", "payloadSha256", "0" * 64, "PAYLOAD_DIGEST_MISMATCH"),
        ("spotSource", "payloadSize", 1, "PAYLOAD_SIZE_MISMATCH"),
    ],
)
def test_exact_source_contract_failures(
    source_key: str,
    field: str,
    value: object,
    reason: str,
) -> None:
    def mutate(request: JsonObject) -> None:
        _source(request, source_key)[field] = value

    _assert_unknown(_validate_packet(_packet(), request_mutator=mutate), reason)


def test_payload_tamper_after_binding_fails_digest() -> None:
    packet = _packet()
    original = canonical_json_bytes(packet.spot)
    tampered = original.replace(b'"TRADING"', b'"TRADINH"')
    assert len(tampered) == len(original)
    _assert_unknown(
        _validate_packet(packet, spot_bytes_after_binding=tampered),
        "PAYLOAD_DIGEST_MISMATCH",
    )


def test_leg_swap_is_never_accepted() -> None:
    packet = _packet()
    spot = canonical_json_bytes(packet.spot)
    usdm = canonical_json_bytes(packet.usdm)
    _assert_unknown(
        _validate_packet(
            packet,
            spot_bytes_after_binding=usdm,
            usdm_bytes_after_binding=spot,
        ),
        "PAYLOAD_SIZE_MISMATCH",
    )


@pytest.mark.parametrize(
    ("spot_time", "usdm_time", "reason"),
    [
        (
            EVALUATION_TIME_MS - MAX_SNAPSHOT_AGE_MS - 1,
            EVALUATION_TIME_MS - 25_000,
            "SNAPSHOT_STALE",
        ),
        (
            EVALUATION_TIME_MS + 1,
            EVALUATION_TIME_MS - 25_000,
            "SNAPSHOT_FROM_FUTURE",
        ),
        (
            EVALUATION_TIME_MS - MAX_SNAPSHOT_SKEW_MS - 1,
            EVALUATION_TIME_MS,
            "SNAPSHOT_PAIR_SKEW",
        ),
    ],
)
def test_current_snapshot_time_contract(
    spot_time: int,
    usdm_time: int,
    reason: str,
) -> None:
    def mutate(request: JsonObject) -> None:
        _source(request, "spotSource")["retrievedAtMs"] = spot_time
        _source(request, "usdmSource")["retrievedAtMs"] = usdm_time

    _assert_unknown(_validate_packet(_packet(), request_mutator=mutate), reason)


def test_historical_request_is_explicitly_unknown() -> None:
    def mutate(request: JsonObject) -> None:
        request["statusScope"] = "HISTORICAL"
        request["asOfMs"] = EVALUATION_TIME_MS - 1

    _assert_unknown(
        _validate_packet(_packet(), request_mutator=mutate),
        "HISTORICAL_STATUS_UNSUPPORTED",
    )


@pytest.mark.parametrize(
    ("status", "reason"),
    [
        ("END_OF_DAY", "SPOT_NOT_TRADING"),
        ("HALT", "SPOT_NOT_TRADING"),
        ("BREAK", "SPOT_NOT_TRADING"),
        ("CANCEL_ONLY", "SPOT_NOT_TRADING"),
        ("UNLISTED", "SPOT_STATUS_UNKNOWN"),
    ],
)
def test_spot_status_must_be_current_trading(status: str, reason: str) -> None:
    packet = _packet()
    _row(packet.spot)["status"] = status
    _assert_unknown(_validate_packet(packet), reason)


def test_spot_trading_permission_must_be_explicit_true() -> None:
    packet = _packet()
    _row(packet.spot)["isSpotTradingAllowed"] = False
    _assert_unknown(_validate_packet(packet), "SPOT_TRADING_NOT_ALLOWED")

    packet = _packet()
    del _row(packet.spot)["isSpotTradingAllowed"]
    _assert_unknown(_validate_packet(packet), "REQUIRED_FIELD_TYPE_INVALID")


@pytest.mark.parametrize(
    ("status", "reason"),
    [
        ("PENDING_TRADING", "USDM_NOT_TRADING"),
        ("DELIVERED", "USDM_NOT_TRADING"),
        ("TRADING_HALT", "USDM_NOT_TRADING"),
        ("MYSTERY", "USDM_STATUS_UNKNOWN"),
    ],
)
def test_usdm_status_must_be_current_trading(status: str, reason: str) -> None:
    packet = _packet()
    _row(packet.usdm)["status"] = status
    _assert_unknown(_validate_packet(packet), reason)


@pytest.mark.parametrize("contract_type", ["CURRENT_QUARTER", "NEXT_QUARTER"])
def test_dated_usdm_contract_is_not_a_perpetual_join(contract_type: str) -> None:
    packet = _packet(usdm_symbol="BTCUSDT_260925")
    _row(packet.usdm)["contractType"] = contract_type
    _row(packet.usdm)["pair"] = "BTCUSDT"
    _assert_unknown(_validate_packet(packet), "USDM_CONTRACT_NOT_PERPETUAL")


def test_tradifi_contract_enum_is_not_silently_coerced() -> None:
    packet = _packet(usdm_symbol="XAUUSDT")
    row = _row(packet.usdm)
    row["contractType"] = "TRADIFI_PERPETUAL"
    row["underlyingType"] = "COMMODITY"
    _assert_unknown(_validate_packet(packet), "USDM_CONTRACT_TYPE_UNKNOWN")


@pytest.mark.parametrize("underlying_type", ["INDEX", "EQUITY", "COMMODITY"])
def test_noncoin_usdm_underlying_is_ineligible(underlying_type: str) -> None:
    packet = _packet(usdm_symbol="BTCDOMUSDT")
    _row(packet.usdm)["underlyingType"] = underlying_type
    _assert_unknown(_validate_packet(packet), "USDM_UNDERLYING_NOT_COIN")


def test_usdm_pair_must_equal_current_perpetual_symbol() -> None:
    packet = _packet()
    _row(packet.usdm)["pair"] = "BTCUSD"
    _assert_unknown(_validate_packet(packet), "USDM_PAIR_SYMBOL_MISMATCH")


def test_base_identity_mismatch_is_unknown() -> None:
    packet = _packet()
    _row(packet.usdm)["baseAsset"] = "ETH"
    _remove_binding(packet.registry, market_type="USD_M", role="BASE", source="BTC")
    _bindings(packet.registry).append(
        _binding(
            market_type="USD_M",
            role="BASE",
            source="ETH",
            target="asset.ETH",
        )
    )
    _assert_unknown(_validate_packet(packet), "EXPECTED_UNDERLYING_MISMATCH")


def test_quote_identity_mismatch_is_unknown() -> None:
    packet = _packet()
    _row(packet.spot)["quoteAsset"] = "USDC"
    _bindings(packet.registry).append(
        _binding(
            market_type="SPOT",
            role="QUOTE",
            source="USDC",
            target="asset.USDC",
        )
    )
    _assert_unknown(_validate_packet(packet), "QUOTE_ASSET_IDENTITY_MISMATCH")


def test_margin_asset_is_only_a_settlement_proxy_and_must_match() -> None:
    packet = _packet()
    _row(packet.usdm)["marginAsset"] = "USDC"
    _bindings(packet.registry).append(
        _binding(
            market_type="USD_M",
            role="SETTLEMENT",
            source="USDC",
            target="asset.USDC",
        )
    )
    _assert_unknown(_validate_packet(packet), "SETTLEMENT_ASSET_IDENTITY_MISMATCH")


def test_matched_receipt_labels_margin_asset_as_a_settlement_proxy() -> None:
    receipt = _validate_packet(_packet())
    assert receipt.decision is IdentityDecision.MATCHED
    assert receipt.settlement_basis == "SETTLE_PROXY_FROM_MARGIN_ASSET"
    assert receipt.settlement_source_field == "marginAsset"


def test_quote_and_settlement_scales_must_match() -> None:
    packet = _packet()
    _remove_binding(packet.registry, market_type="SPOT", role="QUOTE", source="USDT")
    _bindings(packet.registry).extend(
        [
            _binding(
                market_type="SPOT",
                role="QUOTE",
                source="USDT",
                target="USDT.scaled",
                kind="ALIAS",
                numerator=100,
            ),
            _binding(
                market_type="SPOT",
                role="QUOTE",
                source="USDT.scaled",
                target="asset.USDT",
            ),
        ]
    )
    _assert_unknown(_validate_packet(packet), "QUOTE_SETTLEMENT_SCALE_MISMATCH")


def test_complete_non_usdt_identity_can_match_without_special_casing() -> None:
    receipt = _validate_packet(_packet(quote="USDC"))
    assert receipt.decision is IdentityDecision.MATCHED
    assert receipt.canonical_quote_id == "asset.USDC"
    assert receipt.canonical_settlement_id == "asset.USDC"


def test_explicit_symbol_alias_can_resolve_current_row() -> None:
    packet = _packet()
    _row(packet.spot)["symbol"] = "XBTUSDT"
    _bindings(packet.registry).append(
        _binding(
            market_type="SPOT",
            role="SYMBOL",
            source="XBTUSDT",
            target="BTCUSDT",
            kind="ALIAS",
        )
    )
    receipt = _validate_packet(packet)
    assert receipt.decision is IdentityDecision.MATCHED
    assert receipt.spot_symbol == "XBTUSDT"
    assert receipt.spot_instrument_id == "binance.spot.BTCUSDT"


def test_explicit_symbol_migration_can_resolve_current_row() -> None:
    packet = _packet()
    _row(packet.spot)["symbol"] = "XBTUSDT"
    _migrations(packet.registry).append(
        _migration(
            market_type="SPOT",
            role="SYMBOL",
            source="XBTUSDT",
            target="BTCUSDT",
        )
    )
    receipt = _validate_packet(packet)
    assert receipt.decision is IdentityDecision.MATCHED
    assert receipt.spot_symbol == "XBTUSDT"


def test_migration_that_changes_underlying_is_unknown() -> None:
    packet = _packet()
    _remove_binding(packet.registry, market_type="SPOT", role="BASE", source="BTC")
    _migrations(packet.registry).append(
        _migration(
            market_type="SPOT",
            role="BASE",
            source="BTC",
            target="XBT",
            continuity="CHANGES_UNDERLYING",
        )
    )
    _bindings(packet.registry).append(
        _binding(
            market_type="SPOT",
            role="BASE",
            source="XBT",
            target="asset.BTC",
        )
    )
    _assert_unknown(_validate_packet(packet), "MIGRATION_CHANGES_UNDERLYING")


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("validUntilMs", EVALUATION_TIME_MS),
        ("validFromMs", EVALUATION_TIME_MS + 1),
    ],
)
def test_inactive_binding_is_never_used(field: str, value: int) -> None:
    packet = _packet()
    binding = _remove_binding(
        packet.registry,
        market_type="SPOT",
        role="BASE",
        source="BTC",
    )
    binding[field] = value
    _bindings(packet.registry).append(binding)
    _assert_unknown(_validate_packet(packet), "BINDING_MISSING")


def test_overlapping_scoped_binding_is_rejected_before_resolution() -> None:
    packet = _packet()
    _bindings(packet.registry).append(
        _binding(
            market_type="SPOT",
            role="BASE",
            source="BTC",
            target="asset.NOT_BTC",
        )
    )
    _assert_unknown(_validate_packet(packet), "REGISTRY_AMBIGUOUS_EDGE")


def test_alias_cycle_is_unknown() -> None:
    packet = _packet()
    _remove_binding(packet.registry, market_type="SPOT", role="BASE", source="BTC")
    _bindings(packet.registry).extend(
        [
            _binding(
                market_type="SPOT",
                role="BASE",
                source="BTC",
                target="XBT",
                kind="ALIAS",
            ),
            _binding(
                market_type="SPOT",
                role="BASE",
                source="XBT",
                target="BTC",
                kind="ALIAS",
            ),
        ]
    )
    _assert_unknown(_validate_packet(packet), "ALIAS_CYCLE")


def test_alias_depth_is_bounded() -> None:
    packet = _packet()
    _remove_binding(packet.registry, market_type="SPOT", role="BASE", source="BTC")
    source = "BTC"
    for index in range(MAX_ALIAS_DEPTH + 1):
        target = f"alias{index}"
        _bindings(packet.registry).append(
            _binding(
                market_type="SPOT",
                role="BASE",
                source=source,
                target=target,
                kind="ALIAS",
            )
        )
        source = target
    _assert_unknown(_validate_packet(packet), "ALIAS_DEPTH_EXCEEDED")


def test_1000shib_requires_explicit_rational_multiplier() -> None:
    packet = _packet(
        spot_symbol="1000SHIBUSDT",
        usdm_symbol="SHIBUSDT",
        spot_base="1000SHIB",
        usdm_base="SHIB",
        expected_underlying_id="asset.SHIB",
    )
    _remove_binding(
        packet.registry,
        market_type="SPOT",
        role="BASE",
        source="1000SHIB",
    )
    _bindings(packet.registry).extend(
        [
            _binding(
                market_type="SPOT",
                role="BASE",
                source="1000SHIB",
                target="SHIB",
                kind="ALIAS",
                numerator=1000,
            ),
            _binding(
                market_type="SPOT",
                role="BASE",
                source="SHIB",
                target="asset.SHIB",
            ),
        ]
    )
    receipt = _validate_packet(packet)
    assert receipt.decision is IdentityDecision.MATCHED
    assert receipt.spot_base_scale is not None
    assert receipt.spot_base_scale.as_dict() == {
        "denominator": 1,
        "numerator": 1000,
    }
    assert receipt.spot_units_per_usdm_base_unit is not None
    assert receipt.spot_units_per_usdm_base_unit.as_dict() == {
        "denominator": 1000,
        "numerator": 1,
    }


def test_1000shib_is_not_implicitly_stripped_or_scaled() -> None:
    packet = _packet(
        spot_symbol="1000SHIBUSDT",
        usdm_symbol="SHIBUSDT",
        spot_base="1000SHIB",
        usdm_base="SHIB",
        expected_underlying_id="asset.SHIB",
    )
    _remove_binding(
        packet.registry,
        market_type="SPOT",
        role="BASE",
        source="1000SHIB",
    )
    _assert_unknown(_validate_packet(packet), "BINDING_MISSING")


def test_digit_leading_1inch_is_an_exact_identity_not_a_multiplier() -> None:
    receipt = _validate_packet(
        _packet(
            spot_symbol="1INCHUSDT",
            usdm_symbol="1INCHUSDT",
            spot_base="1INCH",
            usdm_base="1INCH",
        )
    )
    assert receipt.decision is IdentityDecision.MATCHED
    assert receipt.canonical_underlying_id == "asset.1INCH"
    assert receipt.spot_base_scale is not None
    assert receipt.spot_base_scale.as_dict() == {
        "denominator": 1,
        "numerator": 1,
    }


def test_same_underlying_can_be_proven_only_by_explicit_scoped_alias() -> None:
    packet = _packet(
        spot_symbol="XBTUSDT",
        spot_base="XBT",
        usdm_base="BTC",
        expected_underlying_id="asset.BTC",
    )
    _remove_binding(packet.registry, market_type="SPOT", role="BASE", source="XBT")
    _bindings(packet.registry).extend(
        [
            _binding(
                market_type="SPOT",
                role="BASE",
                source="XBT",
                target="BTC",
                kind="ALIAS",
            ),
            _binding(
                market_type="SPOT",
                role="BASE",
                source="BTC",
                target="asset.BTC",
            ),
        ]
    )
    receipt = _validate_packet(packet)
    assert receipt.decision is IdentityDecision.MATCHED
    assert receipt.canonical_underlying_id == "asset.BTC"


def test_duplicate_json_key_fails_closed() -> None:
    receipt = validate_spot_usdm_identity_v1(
        request_bytes=b'{"schema":"first","schema":"second"}',
        spot_snapshot_bytes=_fixture_bytes("spot-btcusdt.current.json"),
        usdm_snapshot_bytes=_fixture_bytes("usdm-btcusdt.current.json"),
        registry_bytes=_fixture_bytes("registry-btcusdt.v1.json"),
    )
    _assert_unknown(receipt, "JSON_DUPLICATE_KEY")
    _assert_receipt_digest(receipt)


def test_duplicate_venue_symbol_fails_closed() -> None:
    packet = _packet()
    _rows(packet.spot).append(copy.deepcopy(_row(packet.spot)))
    _assert_unknown(_validate_packet(packet), "DUPLICATE_VENUE_SYMBOL")


@pytest.mark.parametrize(
    ("request_bytes", "reason"),
    [
        (b"{", "JSON_SYNTAX_INVALID"),
        (b'{"number":1.5}', "JSON_NUMBER_INVALID"),
        (b"\xff", "INPUT_UTF8_INVALID"),
        (b"", "INPUT_SIZE_INVALID"),
    ],
)
def test_raw_json_hostility_is_unknown(request_bytes: bytes, reason: str) -> None:
    receipt = validate_spot_usdm_identity_v1(
        request_bytes=request_bytes,
        spot_snapshot_bytes=_fixture_bytes("spot-btcusdt.current.json"),
        usdm_snapshot_bytes=_fixture_bytes("usdm-btcusdt.current.json"),
        registry_bytes=_fixture_bytes("registry-btcusdt.v1.json"),
    )
    _assert_unknown(receipt, reason)


def test_required_identity_field_missing_or_wrong_type_is_unknown() -> None:
    packet = _packet()
    del _row(packet.spot)["baseAsset"]
    _assert_unknown(_validate_packet(packet), "REQUIRED_FIELD_MISSING")

    packet = _packet()
    _row(packet.usdm)["marginAsset"] = None
    _assert_unknown(_validate_packet(packet), "RAW_IDENTIFIER_INVALID")


def test_input_size_depth_string_and_node_bounds_fail_closed() -> None:
    valid_spot = _fixture_bytes("spot-btcusdt.current.json")
    valid_usdm = _fixture_bytes("usdm-btcusdt.current.json")
    valid_registry = _fixture_bytes("registry-btcusdt.v1.json")

    oversized = validate_spot_usdm_identity_v1(
        request_bytes=b"x" * (MAX_INPUT_BYTES + 1),
        spot_snapshot_bytes=valid_spot,
        usdm_snapshot_bytes=valid_usdm,
        registry_bytes=valid_registry,
    )
    _assert_unknown(oversized, "INPUT_SIZE_INVALID")

    too_deep = validate_spot_usdm_identity_v1(
        request_bytes=b"[" * (MAX_JSON_DEPTH + 1) + b"]" * (MAX_JSON_DEPTH + 1),
        spot_snapshot_bytes=valid_spot,
        usdm_snapshot_bytes=valid_usdm,
        registry_bytes=valid_registry,
    )
    _assert_unknown(too_deep, "JSON_DEPTH_EXCEEDED")

    long_string = validate_spot_usdm_identity_v1(
        request_bytes=canonical_json_bytes({"x": "x" * (MAX_STRING_BYTES + 1)}),
        spot_snapshot_bytes=valid_spot,
        usdm_snapshot_bytes=valid_usdm,
        registry_bytes=valid_registry,
    )
    _assert_unknown(long_string, "JSON_STRING_LIMIT")

    many_nodes = validate_spot_usdm_identity_v1(
        request_bytes=canonical_json_bytes({"x": [None] * MAX_JSON_NODES}),
        spot_snapshot_bytes=valid_spot,
        usdm_snapshot_bytes=valid_usdm,
        registry_bytes=valid_registry,
    )
    _assert_unknown(many_nodes, "JSON_NODE_LIMIT")


def test_registry_edge_count_is_bounded() -> None:
    packet = _packet()
    template = _bindings(packet.registry)[0]
    packet.registry["bindings"] = [copy.deepcopy(template) for _ in range(MAX_REGISTRY_EDGES + 1)]
    _assert_unknown(_validate_packet(packet), "REGISTRY_CARDINALITY_INVALID")


def test_duplicate_registry_edge_is_rejected() -> None:
    packet = _packet()
    _bindings(packet.registry).append(copy.deepcopy(_bindings(packet.registry)[0]))
    _assert_unknown(_validate_packet(packet), "REGISTRY_DUPLICATE_EDGE")


def _reverse_object_order(value: object) -> object:
    if isinstance(value, dict):
        mapping = cast(JsonObject, value)
        return {key: _reverse_object_order(mapping[key]) for key in reversed(tuple(mapping))}
    if isinstance(value, list):
        return [_reverse_object_order(item) for item in value]
    return value


def _unordered_json_bytes(value: object) -> bytes:
    return (
        json.dumps(
            value,
            allow_nan=False,
            ensure_ascii=True,
            separators=(",", ":"),
            sort_keys=False,
        )
        + "\n"
    ).encode("ascii")


def test_repeated_exact_bytes_are_deterministic() -> None:
    packet = _packet()
    first = _validate_packet(packet)
    second = _validate_packet(packet)
    assert first.canonical_bytes() == second.canonical_bytes()
    _assert_receipt_digest(first)


def test_json_object_order_does_not_change_semantic_identity() -> None:
    packet = _packet()
    canonical_receipt = _validate_packet(packet)

    spot_bytes = _unordered_json_bytes(_reverse_object_order(packet.spot))
    usdm_bytes = _unordered_json_bytes(_reverse_object_order(packet.usdm))
    registry_bytes = _unordered_json_bytes(_reverse_object_order(packet.registry))
    request = _request_for(
        packet,
        spot_bytes=spot_bytes,
        usdm_bytes=usdm_bytes,
        registry_bytes=registry_bytes,
    )
    request_bytes = _unordered_json_bytes(_reverse_object_order(request))
    reordered_receipt = validate_spot_usdm_identity_v1(
        request_bytes=request_bytes,
        spot_snapshot_bytes=spot_bytes,
        usdm_snapshot_bytes=usdm_bytes,
        registry_bytes=registry_bytes,
    )

    assert reordered_receipt.decision is IdentityDecision.MATCHED
    for key in (
        "authority",
        "canonicalQuoteId",
        "canonicalSettlementId",
        "canonicalUnderlyingId",
        "decision",
        "historicalStatus",
        "reasonCodes",
        "schema",
        "settlementBasis",
        "settlementSourceField",
        "spotBaseScale",
        "spotInstrumentId",
        "spotSymbol",
        "spotUnitsPerUsdmBaseUnit",
        "statusScope",
        "usdmBaseScale",
        "usdmInstrumentId",
        "usdmSymbol",
    ):
        assert reordered_receipt.as_dict()[key] == canonical_receipt.as_dict()[key]
    _assert_receipt_digest(reordered_receipt)


def test_non_bytes_input_is_a_stable_unknown() -> None:
    receipt = validate_spot_usdm_identity_v1(
        request_bytes=cast(bytes, "not-bytes"),
        spot_snapshot_bytes=_fixture_bytes("spot-btcusdt.current.json"),
        usdm_snapshot_bytes=_fixture_bytes("usdm-btcusdt.current.json"),
        registry_bytes=_fixture_bytes("registry-btcusdt.v1.json"),
    )
    _assert_unknown(receipt, "INPUT_NOT_BYTES")
