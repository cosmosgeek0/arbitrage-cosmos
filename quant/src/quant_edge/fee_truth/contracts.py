from __future__ import annotations

import calendar
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum
from typing import Final, Self

from quant_edge.errors import ContractValueError
from quant_edge.labels.rational import ExactRatioV1, make_ratio, ratio_compare

FEE_TRUTH_SCHEMA: Final = "FEE_TRUTH_RECEIPT"
FEE_TRUTH_VERSION: Final = 1
SANITIZATION_POLICY_ID: Final = "FEE1_STRICT_ALLOWLIST_V1"
OWNER_SUPPLIED_CAPTURE_KIND: Final = "OWNER_SUPPLIED_SANITIZED_CAPTURE"
CURRENT_POINT_IN_TIME: Final = "CURRENT_POINT_IN_TIME"
MAX_RECEIPT_BYTES: Final = 262_144
MAX_RECEIPT_ROWS: Final = 512
MAX_RECEIPT_VALIDITY_SECONDS: Final = 3_600
MAX_EXPECTED_SYMBOLS: Final = 4_096
MAX_DECIMAL_PLACES: Final = 18

_UTC_SECONDS_RE: Final = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z")
_SYMBOL_RE: Final = re.compile(r"(?=[A-Z0-9]{5,24}\Z)(?=.*[A-Z])[A-Z0-9]+")
_DECIMAL_RE: Final = re.compile(r"-?(?:0|0\.[0-9]{1,18}|1(?:\.0{1,18})?)")


class Venue(StrEnum):
    BINANCE_SPOT = "BINANCE_SPOT"
    BINANCE_USDM = "BINANCE_USDM"


class Role(StrEnum):
    MAKER = "MAKER"
    TAKER = "TAKER"
    RPI = "RPI"


class Side(StrEnum):
    BUY = "BUY"
    SELL = "SELL"
    BOTH = "BOTH"


class ChargeBasis(StrEnum):
    RECEIVED_ASSET_AMOUNT = "RECEIVED_ASSET_AMOUNT"
    USDM_QUOTE_NOTIONAL = "USDM_QUOTE_NOTIONAL"


class TruthState(StrEnum):
    CURRENT_ACCOUNT_RATE = "CURRENT_ACCOUNT_RATE"
    PUBLIC_SCHEDULE = "PUBLIC_SCHEDULE"
    SENSITIVITY_ONLY = "SENSITIVITY_ONLY"
    UNKNOWN = "UNKNOWN"


class RateState(StrEnum):
    KNOWN = "KNOWN"
    NOT_APPLICABLE = "NOT_APPLICABLE"
    UNKNOWN = "UNKNOWN"


class DiscountApplication(StrEnum):
    APPLIED_TO_STANDARD_ONLY = "APPLIED_TO_STANDARD_ONLY"
    NOT_APPLIED = "NOT_APPLIED"
    UNKNOWN = "UNKNOWN"


class FeeAsset(StrEnum):
    BNB = "BNB"
    RECEIVED_ASSET = "RECEIVED_ASSET"
    SETTLEMENT_ASSET = "SETTLEMENT_ASSET"
    UNKNOWN = "UNKNOWN"


class ProvenanceSource(StrEnum):
    BINANCE_BNB_DISCOUNT_TERMS = "BINANCE_BNB_DISCOUNT_TERMS"
    BINANCE_SPOT_ACCOUNT_COMMISSION_SCHEMA = "BINANCE_SPOT_ACCOUNT_COMMISSION_SCHEMA"
    BINANCE_SPOT_COMMISSION_FAQ = "BINANCE_SPOT_COMMISSION_FAQ"
    BINANCE_SPOT_FEE_SCHEDULE = "BINANCE_SPOT_FEE_SCHEDULE"
    BINANCE_USDM_ACCOUNT_COMMISSION_SCHEMA = "BINANCE_USDM_ACCOUNT_COMMISSION_SCHEMA"
    BINANCE_USDM_FEE_BURN_STATUS_SCHEMA = "BINANCE_USDM_FEE_BURN_STATUS_SCHEMA"
    BINANCE_USDM_FEE_SCHEDULE = "BINANCE_USDM_FEE_SCHEDULE"


class SourceFieldRef(StrEnum):
    SPOT_ACCOUNT_DISCOUNT_ASSET = "SPOT_ACCOUNT_DISCOUNT_ASSET"
    SPOT_ACCOUNT_DISCOUNT_ENABLED_FOR_ACCOUNT = "SPOT_ACCOUNT_DISCOUNT_ENABLED_FOR_ACCOUNT"
    SPOT_ACCOUNT_DISCOUNT_ENABLED_FOR_SYMBOL = "SPOT_ACCOUNT_DISCOUNT_ENABLED_FOR_SYMBOL"
    SPOT_ACCOUNT_DISCOUNT_MULTIPLIER = "SPOT_ACCOUNT_DISCOUNT_MULTIPLIER"
    SPOT_ACCOUNT_SPECIAL_BUYER = "SPOT_ACCOUNT_SPECIAL_BUYER"
    SPOT_ACCOUNT_SPECIAL_MAKER = "SPOT_ACCOUNT_SPECIAL_MAKER"
    SPOT_ACCOUNT_SPECIAL_SELLER = "SPOT_ACCOUNT_SPECIAL_SELLER"
    SPOT_ACCOUNT_SPECIAL_TAKER = "SPOT_ACCOUNT_SPECIAL_TAKER"
    SPOT_ACCOUNT_STANDARD_BUYER = "SPOT_ACCOUNT_STANDARD_BUYER"
    SPOT_ACCOUNT_STANDARD_MAKER = "SPOT_ACCOUNT_STANDARD_MAKER"
    SPOT_ACCOUNT_STANDARD_SELLER = "SPOT_ACCOUNT_STANDARD_SELLER"
    SPOT_ACCOUNT_STANDARD_TAKER = "SPOT_ACCOUNT_STANDARD_TAKER"
    SPOT_ACCOUNT_TAX_BUYER = "SPOT_ACCOUNT_TAX_BUYER"
    SPOT_ACCOUNT_TAX_MAKER = "SPOT_ACCOUNT_TAX_MAKER"
    SPOT_ACCOUNT_TAX_SELLER = "SPOT_ACCOUNT_TAX_SELLER"
    SPOT_ACCOUNT_TAX_TAKER = "SPOT_ACCOUNT_TAX_TAKER"
    SPOT_FEE_SCHEDULE_MAKER = "SPOT_FEE_SCHEDULE_MAKER"
    SPOT_FEE_SCHEDULE_TAKER = "SPOT_FEE_SCHEDULE_TAKER"
    USDM_ACCOUNT_MAKER_COMMISSION_RATE = "USDM_ACCOUNT_MAKER_COMMISSION_RATE"
    USDM_ACCOUNT_RPI_COMMISSION_RATE = "USDM_ACCOUNT_RPI_COMMISSION_RATE"
    USDM_ACCOUNT_TAKER_COMMISSION_RATE = "USDM_ACCOUNT_TAKER_COMMISSION_RATE"
    USDM_BNB_DISCOUNT_STATUS = "USDM_BNB_DISCOUNT_STATUS"
    SPOT_BNB_DISCOUNT_STANDARD_PAYABLE_MULTIPLIER = "SPOT_BNB_DISCOUNT_STANDARD_PAYABLE_MULTIPLIER"
    USDM_BNB_DISCOUNT_STANDARD_PAYABLE_MULTIPLIER = "USDM_BNB_DISCOUNT_STANDARD_PAYABLE_MULTIPLIER"
    USDM_FEE_SCHEDULE_MAKER = "USDM_FEE_SCHEDULE_MAKER"
    USDM_FEE_SCHEDULE_TAKER = "USDM_FEE_SCHEDULE_TAKER"


_FIELD_SOURCE: Final[dict[SourceFieldRef, ProvenanceSource]] = {
    SourceFieldRef.SPOT_ACCOUNT_DISCOUNT_ASSET: (
        ProvenanceSource.BINANCE_SPOT_ACCOUNT_COMMISSION_SCHEMA
    ),
    SourceFieldRef.SPOT_ACCOUNT_DISCOUNT_ENABLED_FOR_ACCOUNT: (
        ProvenanceSource.BINANCE_SPOT_ACCOUNT_COMMISSION_SCHEMA
    ),
    SourceFieldRef.SPOT_ACCOUNT_DISCOUNT_ENABLED_FOR_SYMBOL: (
        ProvenanceSource.BINANCE_SPOT_ACCOUNT_COMMISSION_SCHEMA
    ),
    SourceFieldRef.SPOT_ACCOUNT_DISCOUNT_MULTIPLIER: (
        ProvenanceSource.BINANCE_SPOT_ACCOUNT_COMMISSION_SCHEMA
    ),
    SourceFieldRef.SPOT_ACCOUNT_SPECIAL_BUYER: (
        ProvenanceSource.BINANCE_SPOT_ACCOUNT_COMMISSION_SCHEMA
    ),
    SourceFieldRef.SPOT_ACCOUNT_SPECIAL_MAKER: (
        ProvenanceSource.BINANCE_SPOT_ACCOUNT_COMMISSION_SCHEMA
    ),
    SourceFieldRef.SPOT_ACCOUNT_SPECIAL_SELLER: (
        ProvenanceSource.BINANCE_SPOT_ACCOUNT_COMMISSION_SCHEMA
    ),
    SourceFieldRef.SPOT_ACCOUNT_SPECIAL_TAKER: (
        ProvenanceSource.BINANCE_SPOT_ACCOUNT_COMMISSION_SCHEMA
    ),
    SourceFieldRef.SPOT_ACCOUNT_STANDARD_BUYER: (
        ProvenanceSource.BINANCE_SPOT_ACCOUNT_COMMISSION_SCHEMA
    ),
    SourceFieldRef.SPOT_ACCOUNT_STANDARD_MAKER: (
        ProvenanceSource.BINANCE_SPOT_ACCOUNT_COMMISSION_SCHEMA
    ),
    SourceFieldRef.SPOT_ACCOUNT_STANDARD_SELLER: (
        ProvenanceSource.BINANCE_SPOT_ACCOUNT_COMMISSION_SCHEMA
    ),
    SourceFieldRef.SPOT_ACCOUNT_STANDARD_TAKER: (
        ProvenanceSource.BINANCE_SPOT_ACCOUNT_COMMISSION_SCHEMA
    ),
    SourceFieldRef.SPOT_ACCOUNT_TAX_BUYER: (
        ProvenanceSource.BINANCE_SPOT_ACCOUNT_COMMISSION_SCHEMA
    ),
    SourceFieldRef.SPOT_ACCOUNT_TAX_MAKER: (
        ProvenanceSource.BINANCE_SPOT_ACCOUNT_COMMISSION_SCHEMA
    ),
    SourceFieldRef.SPOT_ACCOUNT_TAX_SELLER: (
        ProvenanceSource.BINANCE_SPOT_ACCOUNT_COMMISSION_SCHEMA
    ),
    SourceFieldRef.SPOT_ACCOUNT_TAX_TAKER: (
        ProvenanceSource.BINANCE_SPOT_ACCOUNT_COMMISSION_SCHEMA
    ),
    SourceFieldRef.SPOT_FEE_SCHEDULE_MAKER: ProvenanceSource.BINANCE_SPOT_FEE_SCHEDULE,
    SourceFieldRef.SPOT_FEE_SCHEDULE_TAKER: ProvenanceSource.BINANCE_SPOT_FEE_SCHEDULE,
    SourceFieldRef.USDM_ACCOUNT_MAKER_COMMISSION_RATE: (
        ProvenanceSource.BINANCE_USDM_ACCOUNT_COMMISSION_SCHEMA
    ),
    SourceFieldRef.USDM_ACCOUNT_RPI_COMMISSION_RATE: (
        ProvenanceSource.BINANCE_USDM_ACCOUNT_COMMISSION_SCHEMA
    ),
    SourceFieldRef.USDM_ACCOUNT_TAKER_COMMISSION_RATE: (
        ProvenanceSource.BINANCE_USDM_ACCOUNT_COMMISSION_SCHEMA
    ),
    SourceFieldRef.USDM_BNB_DISCOUNT_STATUS: (ProvenanceSource.BINANCE_USDM_FEE_BURN_STATUS_SCHEMA),
    SourceFieldRef.SPOT_BNB_DISCOUNT_STANDARD_PAYABLE_MULTIPLIER: (
        ProvenanceSource.BINANCE_BNB_DISCOUNT_TERMS
    ),
    SourceFieldRef.USDM_BNB_DISCOUNT_STANDARD_PAYABLE_MULTIPLIER: (
        ProvenanceSource.BINANCE_BNB_DISCOUNT_TERMS
    ),
    SourceFieldRef.USDM_FEE_SCHEDULE_MAKER: ProvenanceSource.BINANCE_USDM_FEE_SCHEDULE,
    SourceFieldRef.USDM_FEE_SCHEDULE_TAKER: ProvenanceSource.BINANCE_USDM_FEE_SCHEDULE,
}

_ZERO: Final = make_ratio(0, 1)
_ONE: Final = make_ratio(1, 1)


def _parse_utc_seconds(value: object, *, field: str) -> int:
    if not isinstance(value, str) or _UTC_SECONDS_RE.fullmatch(value) is None:
        raise ContractValueError(f"{field} must be an RFC3339 UTC timestamp at whole seconds")
    try:
        parsed = datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=UTC)
    except ValueError as error:
        raise ContractValueError(f"{field} must be a valid UTC timestamp") from error
    if parsed.strftime("%Y-%m-%dT%H:%M:%SZ") != value:
        raise ContractValueError(f"{field} must use canonical UTC timestamp text")
    return calendar.timegm(parsed.utctimetuple())


def _ratio_from_decimal(value: object, *, field: str) -> ExactRatioV1:
    if not isinstance(value, str) or _DECIMAL_RE.fullmatch(value) is None:
        raise ContractValueError(f"{field} must be a signed plain decimal rate in [-1, 1]")
    is_negative = value.startswith("-")
    unsigned = value.removeprefix("-")
    if "." not in unsigned:
        numerator = int(unsigned)
        if is_negative:
            numerator = -numerator
        if is_negative and numerator == 0:
            raise ContractValueError(f"{field} must not use negative zero")
        return make_ratio(numerator, 1)
    whole, fractional = unsigned.split(".", maxsplit=1)
    denominator = 10 ** len(fractional)
    numerator = int(whole) * denominator + int(fractional)
    if is_negative:
        numerator = -numerator
    if is_negative and numerator == 0:
        raise ContractValueError(f"{field} must not use negative zero")
    return make_ratio(numerator, denominator)


def is_canonical_symbol(value: object) -> bool:
    return isinstance(value, str) and _SYMBOL_RE.fullmatch(value) is not None


def scenario_id_for(
    *,
    truth_state: TruthState,
    venue: Venue,
    symbol: str,
    role: Role,
    side: Side,
) -> str:
    """Return the only accepted scenario identifier; arbitrary identifiers are forbidden."""

    return (
        f"fee1.{truth_state.value.lower()}.{venue.value.lower()}."
        f"{symbol.lower()}.{role.value.lower()}.{side.value.lower()}"
    )


@dataclass(frozen=True, slots=True)
class KnownOrUnknownRateV1:
    state: RateState
    decimal: str | None
    ratio: ExactRatioV1 | None

    def __post_init__(self) -> None:
        if not isinstance(self.state, RateState):
            raise ContractValueError("rate state must be RateState")
        if self.state is not RateState.KNOWN:
            if self.decimal is not None or self.ratio is not None:
                raise ContractValueError("non-known rate must have null decimal and ratio")
            return
        parsed = _ratio_from_decimal(self.decimal, field="known rate decimal")
        if not isinstance(self.ratio, ExactRatioV1) or self.ratio != parsed:
            raise ContractValueError("known rate ratio must exactly match its decimal")

    @classmethod
    def known(cls, decimal: str) -> Self:
        return cls(
            state=RateState.KNOWN,
            decimal=decimal,
            ratio=_ratio_from_decimal(decimal, field="known rate decimal"),
        )

    @classmethod
    def unknown(cls) -> Self:
        return cls(state=RateState.UNKNOWN, decimal=None, ratio=None)

    @classmethod
    def not_applicable(cls) -> Self:
        return cls(state=RateState.NOT_APPLICABLE, decimal=None, ratio=None)

    @property
    def is_known(self) -> bool:
        return self.state is RateState.KNOWN

    def as_mapping(self) -> dict[str, object]:
        return {"decimal": self.decimal, "state": self.state.value}


@dataclass(frozen=True, slots=True)
class DiscountTruthV1:
    application: DiscountApplication
    standard_payable_multiplier: KnownOrUnknownRateV1
    fee_asset: FeeAsset

    def __post_init__(self) -> None:
        if not isinstance(self.application, DiscountApplication):
            raise ContractValueError("discount application must be DiscountApplication")
        if not isinstance(self.standard_payable_multiplier, KnownOrUnknownRateV1):
            raise ContractValueError("discount multiplier must be a rate contract")
        if not isinstance(self.fee_asset, FeeAsset):
            raise ContractValueError("discount fee asset must be FeeAsset")
        multiplier = self.standard_payable_multiplier
        if multiplier.state is RateState.NOT_APPLICABLE:
            raise ContractValueError("discount multiplier cannot be not-applicable")
        if self.application is DiscountApplication.UNKNOWN:
            if multiplier.state is not RateState.UNKNOWN or self.fee_asset is not FeeAsset.UNKNOWN:
                raise ContractValueError("unknown discount must keep multiplier and asset unknown")
            return
        if multiplier.ratio is None:
            raise ContractValueError("known discount application requires a known multiplier")
        if self.application is DiscountApplication.NOT_APPLIED:
            if multiplier.ratio != _ONE or self.fee_asset is FeeAsset.UNKNOWN:
                raise ContractValueError(
                    "non-applied discount requires multiplier one and known asset"
                )
            return
        if (
            ratio_compare(multiplier.ratio, _ZERO) < 0
            or ratio_compare(multiplier.ratio, _ONE) >= 0
            or self.fee_asset is not FeeAsset.BNB
        ):
            raise ContractValueError(
                "standard-only discount requires multiplier below one and BNB fee asset"
            )

    def as_mapping(self) -> dict[str, object]:
        return {
            "application": self.application.value,
            "feeAsset": self.fee_asset.value,
            "standardPayableMultiplier": self.standard_payable_multiplier.as_mapping(),
        }


def _require_scenario_types(scenario: FeeScenarioV1) -> None:
    if not isinstance(scenario.truth_state, TruthState):
        raise ContractValueError("truth state must be TruthState")
    if not isinstance(scenario.venue, Venue):
        raise ContractValueError("venue must be Venue")
    if not isinstance(scenario.role, Role):
        raise ContractValueError("role must be Role")
    if not isinstance(scenario.side, Side):
        raise ContractValueError("side must be Side")
    if not isinstance(scenario.charge_basis, ChargeBasis):
        raise ContractValueError("charge basis must be ChargeBasis")
    for rate in (scenario.standard, scenario.special, scenario.tax):
        if not isinstance(rate, KnownOrUnknownRateV1):
            raise ContractValueError("commission components must be rate contracts")
    if not isinstance(scenario.discount, DiscountTruthV1):
        raise ContractValueError("discount must be a discount contract")


def _require_venue_laws(scenario: FeeScenarioV1) -> None:
    if scenario.venue is Venue.BINANCE_SPOT:
        if any(
            rate.state is RateState.NOT_APPLICABLE
            for rate in (scenario.standard, scenario.special, scenario.tax)
        ):
            raise ContractValueError("spot commission components are never not-applicable")
        if scenario.role is Role.RPI:
            raise ContractValueError("spot scenarios do not support the RPI role")
        if scenario.charge_basis is not ChargeBasis.RECEIVED_ASSET_AMOUNT:
            raise ContractValueError("spot scenarios require received-asset charge basis")
        if scenario.side is Side.BOTH:
            raise ContractValueError("spot commission scenarios require an exact buy or sell side")
        if (
            scenario.discount.application is DiscountApplication.NOT_APPLIED
            and scenario.discount.fee_asset is not FeeAsset.RECEIVED_ASSET
        ):
            raise ContractValueError("spot non-discounted fees require received-asset fee truth")
        return
    if scenario.side is not Side.BOTH:
        raise ContractValueError("USD-M commission rates are side-invariant")
    if scenario.charge_basis is not ChargeBasis.USDM_QUOTE_NOTIONAL:
        raise ContractValueError("USD-M scenarios require quote-notional charge basis")
    if (
        scenario.special.state is not RateState.NOT_APPLICABLE
        or scenario.tax.state is not RateState.NOT_APPLICABLE
    ):
        raise ContractValueError("USD-M special and tax components must be not-applicable")
    if scenario.standard.state is RateState.NOT_APPLICABLE:
        raise ContractValueError("USD-M standard commission is applicable")
    if (
        scenario.discount.application is DiscountApplication.NOT_APPLIED
        and scenario.discount.fee_asset is not FeeAsset.SETTLEMENT_ASSET
    ):
        raise ContractValueError("USD-M non-discounted fees require settlement-asset fee truth")


def _require_truth_state_laws(scenario: FeeScenarioV1) -> None:
    rates = (scenario.standard, scenario.special, scenario.tax)
    if scenario.truth_state is TruthState.UNKNOWN:
        if scenario.standard.state is not RateState.UNKNOWN:
            raise ContractValueError("unknown scenario cannot contain known commission rates")
        if scenario.venue is Venue.BINANCE_SPOT and any(
            rate.state is not RateState.UNKNOWN for rate in rates
        ):
            raise ContractValueError("unknown spot scenario cannot contain rate truth")
        if scenario.discount.application is not DiscountApplication.UNKNOWN:
            raise ContractValueError("unknown scenario cannot contain discount truth")
        return
    if scenario.standard.state is not RateState.KNOWN:
        raise ContractValueError("non-unknown scenario requires a known standard rate")
    if (
        scenario.truth_state is TruthState.PUBLIC_SCHEDULE
        and scenario.discount.application is not DiscountApplication.NOT_APPLIED
    ):
        raise ContractValueError("public schedule scenarios cannot assert a discount")
    if scenario.truth_state is TruthState.CURRENT_ACCOUNT_RATE:
        if scenario.venue is Venue.BINANCE_SPOT and any(
            rate.state is not RateState.KNOWN for rate in rates
        ):
            raise ContractValueError("spot account scenario requires all published rate components")
        return
    if (
        scenario.truth_state is TruthState.PUBLIC_SCHEDULE
        and scenario.venue is Venue.BINANCE_SPOT
        and (
            scenario.special.state is not RateState.UNKNOWN
            or scenario.tax.state is not RateState.UNKNOWN
        )
    ):
        raise ContractValueError("public schedule rows cannot assert account fee components")


def _expected_source_refs(scenario: FeeScenarioV1) -> frozenset[SourceFieldRef]:
    if scenario.truth_state is TruthState.UNKNOWN:
        return frozenset()
    if scenario.truth_state is TruthState.CURRENT_ACCOUNT_RATE:
        if scenario.venue is Venue.BINANCE_USDM:
            required = {SourceFieldRef[f"USDM_ACCOUNT_{scenario.role.value}_COMMISSION_RATE"]}
            if scenario.discount.application in {
                DiscountApplication.APPLIED_TO_STANDARD_ONLY,
                DiscountApplication.NOT_APPLIED,
            }:
                required.add(SourceFieldRef.USDM_BNB_DISCOUNT_STATUS)
            if scenario.discount.application is DiscountApplication.APPLIED_TO_STANDARD_ONLY:
                required.add(SourceFieldRef.USDM_BNB_DISCOUNT_STANDARD_PAYABLE_MULTIPLIER)
            return frozenset(required)
        side_suffix = "BUYER" if scenario.side is Side.BUY else "SELLER"
        required = {
            SourceFieldRef[f"SPOT_ACCOUNT_{component}_{suffix}"]
            for component in ("STANDARD", "SPECIAL", "TAX")
            for suffix in (scenario.role.value, side_suffix)
        }
        if scenario.discount.application is DiscountApplication.APPLIED_TO_STANDARD_ONLY:
            required.update(
                {
                    SourceFieldRef.SPOT_ACCOUNT_DISCOUNT_ASSET,
                    SourceFieldRef.SPOT_ACCOUNT_DISCOUNT_ENABLED_FOR_ACCOUNT,
                    SourceFieldRef.SPOT_ACCOUNT_DISCOUNT_ENABLED_FOR_SYMBOL,
                    SourceFieldRef.SPOT_ACCOUNT_DISCOUNT_MULTIPLIER,
                }
            )
        elif scenario.discount.application is DiscountApplication.NOT_APPLIED:
            required.update(
                {
                    SourceFieldRef.SPOT_ACCOUNT_DISCOUNT_ENABLED_FOR_ACCOUNT,
                    SourceFieldRef.SPOT_ACCOUNT_DISCOUNT_ENABLED_FOR_SYMBOL,
                }
            )
        return frozenset(required)
    if scenario.role is Role.RPI:
        raise ContractValueError("RPI has no public schedule field")
    prefix = "SPOT" if scenario.venue is Venue.BINANCE_SPOT else "USDM"
    required = {SourceFieldRef[f"{prefix}_FEE_SCHEDULE_{scenario.role.value}"]}
    if scenario.discount.application is DiscountApplication.APPLIED_TO_STANDARD_ONLY:
        required.add(
            SourceFieldRef.SPOT_BNB_DISCOUNT_STANDARD_PAYABLE_MULTIPLIER
            if scenario.venue is Venue.BINANCE_SPOT
            else SourceFieldRef.USDM_BNB_DISCOUNT_STANDARD_PAYABLE_MULTIPLIER
        )
    return frozenset(required)


def _require_source_ref_laws(scenario: FeeScenarioV1) -> None:
    refs = frozenset(scenario.source_field_refs)
    if refs != _expected_source_refs(scenario):
        raise ContractValueError("source field references must exactly match scenario truth")


@dataclass(frozen=True, slots=True)
class FeeScenarioV1:
    scenario_id: str
    truth_state: TruthState
    venue: Venue
    symbol: str
    role: Role
    side: Side
    charge_basis: ChargeBasis
    standard: KnownOrUnknownRateV1
    special: KnownOrUnknownRateV1
    tax: KnownOrUnknownRateV1
    discount: DiscountTruthV1
    source_field_refs: tuple[SourceFieldRef, ...]

    def __post_init__(self) -> None:
        _require_scenario_types(self)
        if not is_canonical_symbol(self.symbol):
            raise ContractValueError("symbol must be a canonical Binance symbol")
        if self.scenario_id != scenario_id_for(
            truth_state=self.truth_state,
            venue=self.venue,
            symbol=self.symbol,
            role=self.role,
            side=self.side,
        ):
            raise ContractValueError("scenario id must be derived from its scenario dimensions")
        if (
            not isinstance(self.source_field_refs, tuple)
            or any(not isinstance(item, SourceFieldRef) for item in self.source_field_refs)
            or tuple(sorted(self.source_field_refs, key=lambda item: item.value))
            != self.source_field_refs
            or len(set(self.source_field_refs)) != len(self.source_field_refs)
        ):
            raise ContractValueError("source field references must be sorted unique enums")
        _require_venue_laws(self)
        _require_truth_state_laws(self)
        _require_source_ref_laws(self)

    def as_mapping(self) -> dict[str, object]:
        return {
            "chargeBasis": self.charge_basis.value,
            "discount": self.discount.as_mapping(),
            "role": self.role.value,
            "scenarioId": self.scenario_id,
            "side": self.side.value,
            "sourceFieldRefs": [item.value for item in self.source_field_refs],
            "special": self.special.as_mapping(),
            "standard": self.standard.as_mapping(),
            "symbol": self.symbol,
            "tax": self.tax.as_mapping(),
            "truthState": self.truth_state.value,
            "venue": self.venue.value,
        }


@dataclass(frozen=True, slots=True)
class ReceiptProvenanceV1:
    capture_kind: str
    observed_at_utc: str
    valid_until_utc: str
    temporal_scope: str
    sources: tuple[ProvenanceSource, ...]

    def __post_init__(self) -> None:
        if self.capture_kind != OWNER_SUPPLIED_CAPTURE_KIND:
            raise ContractValueError("receipt provenance must be owner-supplied sanitized capture")
        if self.temporal_scope != CURRENT_POINT_IN_TIME:
            raise ContractValueError("receipt provenance must be current point-in-time")
        observed = _parse_utc_seconds(self.observed_at_utc, field="observedAtUtc")
        valid_until = _parse_utc_seconds(self.valid_until_utc, field="validUntilUtc")
        if valid_until <= observed:
            raise ContractValueError("receipt validity must end after observation")
        if valid_until - observed > MAX_RECEIPT_VALIDITY_SECONDS:
            raise ContractValueError("receipt validity exceeds the maximum window")
        if (
            not isinstance(self.sources, tuple)
            or not self.sources
            or any(not isinstance(item, ProvenanceSource) for item in self.sources)
            or tuple(sorted(self.sources, key=lambda item: item.value)) != self.sources
            or len(set(self.sources)) != len(self.sources)
        ):
            raise ContractValueError("provenance sources must be non-empty sorted unique enums")

    @property
    def observed_at_epoch_s(self) -> int:
        return _parse_utc_seconds(self.observed_at_utc, field="observedAtUtc")

    @property
    def valid_until_epoch_s(self) -> int:
        return _parse_utc_seconds(self.valid_until_utc, field="validUntilUtc")

    def as_mapping(self) -> dict[str, object]:
        return {
            "captureKind": self.capture_kind,
            "observedAtUtc": self.observed_at_utc,
            "sources": [item.value for item in self.sources],
            "temporalScope": self.temporal_scope,
            "validUntilUtc": self.valid_until_utc,
        }


@dataclass(frozen=True, slots=True)
class FeeTruthReceiptV1:
    schema: str
    version: int
    sanitization_policy_id: str
    provenance: ReceiptProvenanceV1
    rows: tuple[FeeScenarioV1, ...]

    def __post_init__(self) -> None:
        if self.schema != FEE_TRUTH_SCHEMA:
            raise ContractValueError("fee truth schema is unsupported")
        if isinstance(self.version, bool) or self.version != FEE_TRUTH_VERSION:
            raise ContractValueError("fee truth version is unsupported")
        if self.sanitization_policy_id != SANITIZATION_POLICY_ID:
            raise ContractValueError("sanitization policy is unsupported")
        if not isinstance(self.provenance, ReceiptProvenanceV1):
            raise ContractValueError("provenance must be a provenance contract")
        if (
            not isinstance(self.rows, tuple)
            or not self.rows
            or len(self.rows) > MAX_RECEIPT_ROWS
            or any(not isinstance(row, FeeScenarioV1) for row in self.rows)
        ):
            raise ContractValueError("receipt rows must be a non-empty bounded tuple")
        scenario_ids = tuple(row.scenario_id for row in self.rows)
        if scenario_ids != tuple(sorted(scenario_ids)) or len(set(scenario_ids)) != len(
            scenario_ids
        ):
            raise ContractValueError("receipt rows must have sorted unique scenario ids")
        sources = set(self.provenance.sources)
        if any(
            _FIELD_SOURCE[field_ref] not in sources
            for row in self.rows
            for field_ref in row.source_field_refs
        ):
            raise ContractValueError("row field references require matching provenance sources")

    def as_mapping(self) -> dict[str, object]:
        return {
            "provenance": self.provenance.as_mapping(),
            "rows": [row.as_mapping() for row in self.rows],
            "sanitizationPolicyId": self.sanitization_policy_id,
            "schema": self.schema,
            "version": self.version,
        }
