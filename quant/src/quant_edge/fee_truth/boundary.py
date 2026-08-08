from __future__ import annotations

from collections.abc import Callable
from enum import StrEnum
from typing import cast

from quant_edge.canonical import parse_canonical_object, require_exact_keys

from .contracts import (
    FEE_TRUTH_SCHEMA,
    FEE_TRUTH_VERSION,
    MAX_EXPECTED_SYMBOLS,
    MAX_RECEIPT_BYTES,
    MAX_RECEIPT_ROWS,
    SANITIZATION_POLICY_ID,
    ChargeBasis,
    DiscountApplication,
    DiscountTruthV1,
    FeeAsset,
    FeeScenarioV1,
    FeeTruthReceiptV1,
    KnownOrUnknownRateV1,
    ProvenanceSource,
    RateState,
    ReceiptProvenanceV1,
    Role,
    Side,
    SourceFieldRef,
    TruthState,
    Venue,
    is_canonical_symbol,
)


class FeeReceiptError(ValueError):
    """Safe boundary failure that never reflects rejected receipt bytes."""


_REJECTED = "fee receipt rejected"


def _object(value: object, *, expected: tuple[str, ...], path: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise ValueError(_REJECTED)
    typed = cast(dict[str, object], value)
    require_exact_keys(typed, expected=expected, path=path)
    return typed


def _string(value: object) -> str:
    if not isinstance(value, str):
        raise ValueError(_REJECTED)
    return value


def _enum[EnumT: StrEnum](value: object, enum_type: Callable[[str], EnumT]) -> EnumT:
    return enum_type(_string(value))


def _rate(value: object, *, path: str) -> KnownOrUnknownRateV1:
    mapping = _object(value, expected=("state", "decimal"), path=path)
    state = _enum(mapping["state"], RateState)
    decimal = mapping["decimal"]
    if state is RateState.UNKNOWN:
        if decimal is not None:
            raise ValueError(_REJECTED)
        return KnownOrUnknownRateV1.unknown()
    if state is RateState.NOT_APPLICABLE:
        if decimal is not None:
            raise ValueError(_REJECTED)
        return KnownOrUnknownRateV1.not_applicable()
    return KnownOrUnknownRateV1.known(_string(decimal))


def _discount(value: object, *, path: str) -> DiscountTruthV1:
    mapping = _object(
        value,
        expected=("application", "standardPayableMultiplier", "feeAsset"),
        path=path,
    )
    return DiscountTruthV1(
        application=_enum(mapping["application"], DiscountApplication),
        standard_payable_multiplier=_rate(
            mapping["standardPayableMultiplier"],
            path=f"{path}.standardPayableMultiplier",
        ),
        fee_asset=_enum(mapping["feeAsset"], FeeAsset),
    )


def _enum_tuple[EnumT: StrEnum](
    value: object,
    enum_type: Callable[[str], EnumT],
    *,
    maximum: int,
) -> tuple[EnumT, ...]:
    if not isinstance(value, list) or len(value) > maximum:
        raise ValueError(_REJECTED)
    return tuple(_enum(item, enum_type) for item in value)


def _scenario(value: object, *, index: int) -> FeeScenarioV1:
    path = f"$.rows[{index}]"
    mapping = _object(
        value,
        expected=(
            "scenarioId",
            "truthState",
            "venue",
            "symbol",
            "role",
            "side",
            "chargeBasis",
            "standard",
            "special",
            "tax",
            "discount",
            "sourceFieldRefs",
        ),
        path=path,
    )
    return FeeScenarioV1(
        scenario_id=_string(mapping["scenarioId"]),
        truth_state=_enum(mapping["truthState"], TruthState),
        venue=_enum(mapping["venue"], Venue),
        symbol=_string(mapping["symbol"]),
        role=_enum(mapping["role"], Role),
        side=_enum(mapping["side"], Side),
        charge_basis=_enum(mapping["chargeBasis"], ChargeBasis),
        standard=_rate(mapping["standard"], path=f"{path}.standard"),
        special=_rate(mapping["special"], path=f"{path}.special"),
        tax=_rate(mapping["tax"], path=f"{path}.tax"),
        discount=_discount(mapping["discount"], path=f"{path}.discount"),
        source_field_refs=_enum_tuple(
            mapping["sourceFieldRefs"],
            SourceFieldRef,
            maximum=len(SourceFieldRef),
        ),
    )


def _provenance(value: object) -> ReceiptProvenanceV1:
    mapping = _object(
        value,
        expected=(
            "captureKind",
            "observedAtUtc",
            "validUntilUtc",
            "temporalScope",
            "sources",
        ),
        path="$.provenance",
    )
    return ReceiptProvenanceV1(
        capture_kind=_string(mapping["captureKind"]),
        observed_at_utc=_string(mapping["observedAtUtc"]),
        valid_until_utc=_string(mapping["validUntilUtc"]),
        temporal_scope=_string(mapping["temporalScope"]),
        sources=_enum_tuple(
            mapping["sources"],
            ProvenanceSource,
            maximum=len(ProvenanceSource),
        ),
    )


def _parse_receipt_bytes(
    raw: bytes,
    *,
    expected_symbols: frozenset[str],
) -> FeeTruthReceiptV1:
    if not isinstance(raw, bytes) or not raw or len(raw) > MAX_RECEIPT_BYTES:
        raise ValueError(_REJECTED)
    if (
        not isinstance(expected_symbols, frozenset)
        or not expected_symbols
        or len(expected_symbols) > MAX_EXPECTED_SYMBOLS
        or any(not is_canonical_symbol(symbol) for symbol in expected_symbols)
    ):
        raise ValueError(_REJECTED)
    mapping = parse_canonical_object(raw)
    require_exact_keys(
        mapping,
        expected=("schema", "version", "sanitizationPolicyId", "provenance", "rows"),
        path="$",
    )
    if mapping["schema"] != FEE_TRUTH_SCHEMA:
        raise ValueError(_REJECTED)
    version = mapping["version"]
    if isinstance(version, bool) or version != FEE_TRUTH_VERSION:
        raise ValueError(_REJECTED)
    if mapping["sanitizationPolicyId"] != SANITIZATION_POLICY_ID:
        raise ValueError(_REJECTED)
    raw_rows = mapping["rows"]
    if not isinstance(raw_rows, list) or not raw_rows or len(raw_rows) > MAX_RECEIPT_ROWS:
        raise ValueError(_REJECTED)
    rows = tuple(_scenario(row, index=index) for index, row in enumerate(raw_rows))
    if any(row.symbol not in expected_symbols for row in rows):
        raise ValueError(_REJECTED)
    return FeeTruthReceiptV1(
        schema=FEE_TRUTH_SCHEMA,
        version=FEE_TRUTH_VERSION,
        sanitization_policy_id=SANITIZATION_POLICY_ID,
        provenance=_provenance(mapping["provenance"]),
        rows=rows,
    )


def parse_receipt_bytes(
    raw: bytes,
    *,
    expected_symbols: frozenset[str],
) -> FeeTruthReceiptV1:
    """Parse one strict canonical, recursively allowlisted, sanitized fee receipt."""

    try:
        return _parse_receipt_bytes(raw, expected_symbols=expected_symbols)
    except (KeyboardInterrupt, SystemExit):
        raise
    except Exception:
        pass
    raw = b""
    raise FeeReceiptError(_REJECTED)


__all__ = ["FeeReceiptError", "parse_receipt_bytes"]
