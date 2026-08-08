from __future__ import annotations

import calendar
import re
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Final, NoReturn, cast

from quant_edge.derivatives.costs import (
    BASIS_ROUND_TRIP_LEGS,
    CostComponentV1,
    CostKind,
    CostStackV1,
    known_component,
    unknown_component,
)
from quant_edge.errors import ContractValueError
from quant_edge.labels.rational import (
    ZERO_RATIO,
    ExactRatioV1,
    make_ratio,
    ratio_add,
    ratio_compare,
)
from quant_edge.lake.contracts import require_contract_id

from .contracts import (
    CURRENT_POINT_IN_TIME,
    MAX_RECEIPT_VALIDITY_SECONDS,
    OWNER_SUPPLIED_CAPTURE_KIND,
    SANITIZATION_POLICY_ID,
    ChargeBasis,
    DiscountApplication,
    FeeAsset,
    ProvenanceSource,
    Role,
    Side,
    SourceFieldRef,
    TruthState,
    Venue,
    is_canonical_symbol,
    scenario_id_for,
)
from .conversion import (
    ACCOUNT_EFFECTIVE_SANITIZED,
    ADVERSE_PLUS_2_BPS_PER_SIDE_PER_FILL_LEG,
    BNB_OR_PROMOTION_SENSITIVITY_ONLY,
    PUBLIC_REGULAR_NO_BNB,
)

_BPS_SCALE: Final = 10_000
_ZERO: Final = ZERO_RATIO
_INTEGER_TEXT: Final = re.compile(r"(?:0|-?[1-9][0-9]{0,60})")
_POSITIVE_INTEGER_TEXT: Final = re.compile(r"[1-9][0-9]{0,60}")
_SHA256_TEXT: Final = re.compile(r"[0-9a-f]{64}")
_UTC_SECONDS_TEXT: Final = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z")
_UTC_FORMAT: Final = "%Y-%m-%dT%H:%M:%SZ"
_N3_REJECTED: Final = "N-3 fee input rejected"
_SCENARIO_IDS: Final = frozenset(
    {
        ACCOUNT_EFFECTIVE_SANITIZED,
        ADVERSE_PLUS_2_BPS_PER_SIDE_PER_FILL_LEG,
        BNB_OR_PROMOTION_SENSITIVITY_ONLY,
        PUBLIC_REGULAR_NO_BNB,
    }
)
_SCENARIO_ORDER: Final = (
    ACCOUNT_EFFECTIVE_SANITIZED,
    ADVERSE_PLUS_2_BPS_PER_SIDE_PER_FILL_LEG,
    BNB_OR_PROMOTION_SENSITIVITY_ONLY,
    PUBLIC_REGULAR_NO_BNB,
)
_REASON_CODES: Final = frozenset(
    {
        "AS_OF_PRECEDES_OBSERVATION",
        "BASE_RATE_UNKNOWN",
        "DISCOUNT_APPLICATION_UNKNOWN",
        "DISCOUNT_MULTIPLIER_RATE_UNKNOWN",
        "NO_RATE_ROWS",
        "RECEIPT_RATE_UNKNOWN",
        "RECEIPT_STALE",
        "SENSITIVITY_ONLY",
        "SPECIAL_RATE_UNKNOWN",
        "STANDARD_RATE_UNKNOWN",
        "TAX_RATE_UNKNOWN",
    }
)
_ROOT_KEYS: Final = frozenset(
    {
        "asOfUtc",
        "consumer",
        "historicalAccountActual",
        "inputReceiptSha256",
        "provenance",
        "scenarios",
        "schema",
        "units",
        "unknownCostsRemainUnknown",
    }
)
_ROW_KEYS: Final = frozenset(
    {
        "chargeBasis",
        "components",
        "effectiveBps",
        "effectiveRate",
        "historicalAccountActualState",
        "knownness",
        "liquidityRole",
        "reasonCodes",
        "routeId",
        "sensitivityEffectiveBps",
        "sensitivityEffectiveRate",
        "side",
        "sourceFieldRefs",
        "symbol",
        "temporalUse",
        "truthState",
        "venue",
    }
)
_COMPONENT_KEYS: Final = frozenset(
    {
        "discountApplication",
        "feeAsset",
        "special",
        "standardAfterDiscount",
        "standardBeforeDiscount",
        "standardPayableMultiplier",
        "tax",
    }
)
_TEMPORAL_USES: Final = frozenset(
    {
        "ADVERSE_CURRENT_RATE_COUNTERFACTUAL",
        CURRENT_POINT_IN_TIME,
        "CURRENT_RATE_COUNTERFACTUAL",
    }
)
_VENUES: Final = frozenset(item.value for item in Venue)
_ROLES: Final = frozenset(item.value for item in Role)
_SIDES: Final = frozenset(item.value for item in Side)
_CHARGE_BASES: Final = frozenset(item.value for item in ChargeBasis)
_SOURCE_FIELD_REFS: Final = frozenset(item.value for item in SourceFieldRef)
_PROVENANCE_SOURCES: Final = frozenset(item.value for item in ProvenanceSource)
_DISCOUNT_APPLICATIONS: Final = frozenset(item.value for item in DiscountApplication)
_FEE_ASSETS: Final = frozenset(item.value for item in FeeAsset)


def _reject_n3() -> NoReturn:
    raise ContractValueError(_N3_REJECTED)


def _as_mapping(value: object) -> dict[str, object]:
    if type(value) is not dict or any(type(key) is not str for key in value):
        _reject_n3()
    return cast(dict[str, object], value)


def _require_exact_keys(value: Mapping[str, object], expected: frozenset[str]) -> None:
    if frozenset(value) != expected:
        _reject_n3()


def _utc_epoch(value: object) -> int:
    if type(value) is not str or _UTC_SECONDS_TEXT.fullmatch(value) is None:
        _reject_n3()
    try:
        parsed = datetime.strptime(value, _UTC_FORMAT).replace(tzinfo=UTC)
    except ValueError:
        _reject_n3()
    if parsed.strftime(_UTC_FORMAT) != value:
        _reject_n3()
    return calendar.timegm(parsed.utctimetuple())


def _safe_enum_list(
    value: object,
    *,
    allowed: frozenset[str],
    maximum: int,
) -> tuple[str, ...]:
    if (
        type(value) is not list
        or len(value) > maximum
        or any(type(item) is not str or item not in allowed for item in value)
    ):
        _reject_n3()
    typed = cast(list[str], value)
    result = tuple(typed)
    if result != tuple(sorted(result)) or len(set(result)) != len(result):
        _reject_n3()
    return result


def _exact_ratio(value: object) -> ExactRatioV1:
    mapping = _as_mapping(value)
    _require_exact_keys(mapping, frozenset({"denominator", "numerator"}))
    try:
        return _ratio_from_mapping(mapping)
    except ContractValueError:
        _reject_n3()


def _ratio_or_none(value: object) -> ExactRatioV1 | None:
    return None if value is None else _exact_ratio(value)


def _multiply(left: ExactRatioV1, right: ExactRatioV1) -> ExactRatioV1:
    return make_ratio(
        left.numerator * right.numerator,
        left.denominator * right.denominator,
    )


def _expected_bps(value: ExactRatioV1) -> ExactRatioV1:
    return make_ratio(value.numerator * _BPS_SCALE, value.denominator)


def _validate_component(value: object) -> tuple[str, ExactRatioV1 | None]:
    mapping = _as_mapping(value)
    _require_exact_keys(mapping, frozenset({"knownness", "value"}))
    knownness = mapping["knownness"]
    if knownness == "KNOWN":
        if mapping["value"] is None:
            _reject_n3()
        return ("KNOWN", _exact_ratio(mapping["value"]))
    if knownness in {"UNKNOWN", "NOT_APPLICABLE"} and mapping["value"] is None:
        return (knownness, None)
    _reject_n3()


def _component_value(
    component: tuple[str, ExactRatioV1 | None],
) -> ExactRatioV1 | None:
    knownness, value = component
    if knownness == "KNOWN":
        return value
    if knownness == "NOT_APPLICABLE":
        return ZERO_RATIO
    return None


def _validate_components(
    value: object,
    *,
    venue: str,
    route_truth: TruthState,
    adverse: bool,
    numeric_total: ExactRatioV1 | None,
) -> None:
    mapping = _as_mapping(value)
    expected_keys = _COMPONENT_KEYS | (frozenset({"adverse"}) if adverse else frozenset())
    _require_exact_keys(mapping, expected_keys)
    application = mapping["discountApplication"]
    fee_asset = mapping["feeAsset"]
    if application not in _DISCOUNT_APPLICATIONS or fee_asset not in _FEE_ASSETS:
        _reject_n3()
    standard = _validate_component(mapping["standardBeforeDiscount"])
    multiplier = _validate_component(mapping["standardPayableMultiplier"])
    standard_after = _validate_component(mapping["standardAfterDiscount"])
    special = _validate_component(mapping["special"])
    tax = _validate_component(mapping["tax"])
    if standard[0] == "NOT_APPLICABLE" or multiplier[0] == "NOT_APPLICABLE":
        _reject_n3()
    if venue == Venue.BINANCE_USDM.value:
        if special[0] != "NOT_APPLICABLE" or tax[0] != "NOT_APPLICABLE":
            _reject_n3()
    elif special[0] == "NOT_APPLICABLE" or tax[0] == "NOT_APPLICABLE":
        _reject_n3()
    if route_truth is TruthState.UNKNOWN:
        if (
            standard[0] != "UNKNOWN"
            or application != DiscountApplication.UNKNOWN.value
            or (
                venue == Venue.BINANCE_SPOT.value
                and (special[0] != "UNKNOWN" or tax[0] != "UNKNOWN")
            )
        ):
            _reject_n3()
    else:
        if standard[0] != "KNOWN":
            _reject_n3()
        if (
            route_truth is TruthState.CURRENT_ACCOUNT_RATE
            and venue == Venue.BINANCE_SPOT.value
            and (special[0] != "KNOWN" or tax[0] != "KNOWN")
        ):
            _reject_n3()
        if (
            route_truth is TruthState.PUBLIC_SCHEDULE
            and venue == Venue.BINANCE_SPOT.value
            and (special[0] != "UNKNOWN" or tax[0] != "UNKNOWN")
        ):
            _reject_n3()

    multiplier_value = multiplier[1]
    if application == DiscountApplication.UNKNOWN.value:
        if multiplier[0] != "UNKNOWN" or fee_asset != FeeAsset.UNKNOWN.value:
            _reject_n3()
    elif application == DiscountApplication.NOT_APPLIED.value:
        if (
            multiplier[0] != "KNOWN"
            or multiplier_value != make_ratio(1, 1)
            or fee_asset
            != (
                FeeAsset.RECEIVED_ASSET.value
                if venue == Venue.BINANCE_SPOT.value
                else FeeAsset.SETTLEMENT_ASSET.value
            )
        ):
            _reject_n3()
    elif (
        multiplier[0] != "KNOWN"
        or multiplier_value is None
        or ratio_compare(multiplier_value, ZERO_RATIO) < 0
        or ratio_compare(multiplier_value, make_ratio(1, 1)) >= 0
        or fee_asset != FeeAsset.BNB.value
    ):
        _reject_n3()

    if standard[1] is not None and multiplier_value is not None:
        expected_standard_after = _multiply(standard[1], multiplier_value)
        if standard_after != ("KNOWN", expected_standard_after):
            _reject_n3()
    elif standard_after[0] != "UNKNOWN":
        _reject_n3()

    adverse_component: tuple[str, ExactRatioV1 | None] | None = None
    if adverse:
        adverse_component = _validate_component(mapping["adverse"])
        if adverse_component != ("KNOWN", make_ratio(1, 5_000)):
            _reject_n3()
    if numeric_total is None:
        return
    total = ZERO_RATIO
    for component in (standard_after, special, tax):
        component_value = _component_value(component)
        if component_value is None:
            _reject_n3()
        total = ratio_add(total, component_value)
    if adverse_component is not None:
        total = ratio_add(total, cast(ExactRatioV1, adverse_component[1]))
    if total != numeric_total:
        _reject_n3()


def _route_truth(
    route_id: object,
    *,
    venue: str,
    symbol: str,
    role: str,
    side: str,
) -> TruthState:
    if not isinstance(route_id, str):
        _reject_n3()
    venue_enum = Venue(venue)
    role_enum = Role(role)
    side_enum = Side(side)
    matches = tuple(
        state
        for state in TruthState
        if route_id
        == scenario_id_for(
            truth_state=state,
            venue=venue_enum,
            symbol=symbol,
            role=role_enum,
            side=side_enum,
        )
    )
    if len(matches) != 1:
        _reject_n3()
    return matches[0]


def _required_source(value: str) -> str:
    if value == SourceFieldRef.USDM_BNB_DISCOUNT_STATUS.value:
        return ProvenanceSource.BINANCE_USDM_FEE_BURN_STATUS_SCHEMA.value
    if value.startswith("SPOT_ACCOUNT_"):
        return ProvenanceSource.BINANCE_SPOT_ACCOUNT_COMMISSION_SCHEMA.value
    if value.startswith("USDM_ACCOUNT_"):
        return ProvenanceSource.BINANCE_USDM_ACCOUNT_COMMISSION_SCHEMA.value
    if value.startswith("SPOT_FEE_SCHEDULE_"):
        return ProvenanceSource.BINANCE_SPOT_FEE_SCHEDULE.value
    if value.startswith("USDM_FEE_SCHEDULE_"):
        return ProvenanceSource.BINANCE_USDM_FEE_SCHEDULE.value
    return ProvenanceSource.BINANCE_BNB_DISCOUNT_TERMS.value


def _expected_source_refs(
    *,
    route_truth: TruthState,
    venue: str,
    role: str,
    side: str,
    discount_application: str,
) -> frozenset[str]:
    if route_truth is TruthState.UNKNOWN:
        return frozenset()
    if route_truth is TruthState.CURRENT_ACCOUNT_RATE:
        if venue == Venue.BINANCE_USDM.value:
            required = {SourceFieldRef[f"USDM_ACCOUNT_{role}_COMMISSION_RATE"].value}
            if discount_application in {
                DiscountApplication.APPLIED_TO_STANDARD_ONLY.value,
                DiscountApplication.NOT_APPLIED.value,
            }:
                required.add(SourceFieldRef.USDM_BNB_DISCOUNT_STATUS.value)
            if discount_application == DiscountApplication.APPLIED_TO_STANDARD_ONLY.value:
                required.add(SourceFieldRef.USDM_BNB_DISCOUNT_STANDARD_PAYABLE_MULTIPLIER.value)
            return frozenset(required)
        side_suffix = "BUYER" if side == Side.BUY.value else "SELLER"
        required = {
            SourceFieldRef[f"SPOT_ACCOUNT_{component}_{suffix}"].value
            for component in ("STANDARD", "SPECIAL", "TAX")
            for suffix in (role, side_suffix)
        }
        if discount_application == DiscountApplication.APPLIED_TO_STANDARD_ONLY.value:
            required.update(
                {
                    SourceFieldRef.SPOT_ACCOUNT_DISCOUNT_ASSET.value,
                    SourceFieldRef.SPOT_ACCOUNT_DISCOUNT_ENABLED_FOR_ACCOUNT.value,
                    SourceFieldRef.SPOT_ACCOUNT_DISCOUNT_ENABLED_FOR_SYMBOL.value,
                    SourceFieldRef.SPOT_ACCOUNT_DISCOUNT_MULTIPLIER.value,
                }
            )
        elif discount_application == DiscountApplication.NOT_APPLIED.value:
            required.update(
                {
                    SourceFieldRef.SPOT_ACCOUNT_DISCOUNT_ENABLED_FOR_ACCOUNT.value,
                    SourceFieldRef.SPOT_ACCOUNT_DISCOUNT_ENABLED_FOR_SYMBOL.value,
                }
            )
        return frozenset(required)
    if role == Role.RPI.value:
        _reject_n3()
    prefix = "SPOT" if venue == Venue.BINANCE_SPOT.value else "USDM"
    required = {SourceFieldRef[f"{prefix}_FEE_SCHEDULE_{role}"].value}
    if discount_application == DiscountApplication.APPLIED_TO_STANDARD_ONLY.value:
        required.add(
            (
                SourceFieldRef.SPOT_BNB_DISCOUNT_STANDARD_PAYABLE_MULTIPLIER
                if venue == Venue.BINANCE_SPOT.value
                else SourceFieldRef.USDM_BNB_DISCOUNT_STANDARD_PAYABLE_MULTIPLIER
            ).value
        )
    return frozenset(required)


def _validate_rate_row(
    value: object,
    *,
    scenario_id: str,
    provenance_sources: frozenset[str],
    freshness_reason: str | None,
) -> tuple[str, ...]:
    mapping = _as_mapping(value)
    adverse = scenario_id == ADVERSE_PLUS_2_BPS_PER_SIDE_PER_FILL_LEG
    expected_keys = _ROW_KEYS | (frozenset({"baseScenarioId"}) if adverse else frozenset())
    _require_exact_keys(mapping, expected_keys)
    venue = mapping["venue"]
    symbol = mapping["symbol"]
    role = mapping["liquidityRole"]
    side = mapping["side"]
    charge_basis = mapping["chargeBasis"]
    if (
        type(venue) is not str
        or venue not in _VENUES
        or type(symbol) is not str
        or not is_canonical_symbol(symbol)
        or type(role) is not str
        or role not in _ROLES
        or type(side) is not str
        or side not in _SIDES
        or type(charge_basis) is not str
        or charge_basis not in _CHARGE_BASES
        or mapping["historicalAccountActualState"] != "HISTORICAL_ACCOUNT_ACTUAL_UNKNOWN"
        or mapping["temporalUse"] not in _TEMPORAL_USES
    ):
        _reject_n3()
    venue_text = venue
    symbol_text = symbol
    role_text = role
    side_text = side
    if (
        venue_text == Venue.BINANCE_SPOT.value
        and (
            role_text == Role.RPI.value
            or side_text == Side.BOTH.value
            or charge_basis != ChargeBasis.RECEIVED_ASSET_AMOUNT.value
        )
    ) or (
        venue_text == Venue.BINANCE_USDM.value
        and (side_text != Side.BOTH.value or charge_basis != ChargeBasis.USDM_QUOTE_NOTIONAL.value)
    ):
        _reject_n3()
    route_truth = _route_truth(
        mapping["routeId"],
        venue=venue_text,
        symbol=symbol_text,
        role=role_text,
        side=side_text,
    )
    base_scenario_id: str | None = None
    if adverse:
        if mapping["baseScenarioId"] not in {
            ACCOUNT_EFFECTIVE_SANITIZED,
            PUBLIC_REGULAR_NO_BNB,
        }:
            _reject_n3()
        base_scenario_id = mapping["baseScenarioId"]
    allowed_route_truth = {
        ACCOUNT_EFFECTIVE_SANITIZED: {
            TruthState.CURRENT_ACCOUNT_RATE,
            TruthState.UNKNOWN,
        },
        PUBLIC_REGULAR_NO_BNB: {
            TruthState.PUBLIC_SCHEDULE,
            TruthState.UNKNOWN,
        },
        BNB_OR_PROMOTION_SENSITIVITY_ONLY: {TruthState.SENSITIVITY_ONLY},
    }
    route_container = base_scenario_id if adverse else scenario_id
    if (
        route_container not in allowed_route_truth
        or route_truth not in allowed_route_truth[route_container]
    ):
        _reject_n3()

    reasons = _safe_enum_list(
        mapping["reasonCodes"],
        allowed=_REASON_CODES,
        maximum=len(_REASON_CODES),
    )
    source_refs = _safe_enum_list(
        mapping["sourceFieldRefs"],
        allowed=_SOURCE_FIELD_REFS,
        maximum=len(SourceFieldRef),
    )
    components_mapping = _as_mapping(mapping["components"])
    discount_application = components_mapping.get("discountApplication")
    if (
        type(discount_application) is not str
        or (
            route_truth is TruthState.PUBLIC_SCHEDULE
            and discount_application != DiscountApplication.NOT_APPLIED.value
        )
        or frozenset(source_refs)
        != _expected_source_refs(
            route_truth=route_truth,
            venue=venue_text,
            role=role_text,
            side=side_text,
            discount_application=discount_application,
        )
    ):
        _reject_n3()
    if any(
        (ref.startswith("SPOT_")) != (venue_text == Venue.BINANCE_SPOT.value)
        or _required_source(ref) not in provenance_sources
        for ref in source_refs
    ):
        _reject_n3()

    effective_rate = _ratio_or_none(mapping["effectiveRate"])
    effective_bps = _ratio_or_none(mapping["effectiveBps"])
    sensitivity_rate = _ratio_or_none(mapping["sensitivityEffectiveRate"])
    sensitivity_bps = _ratio_or_none(mapping["sensitivityEffectiveBps"])
    knownness = mapping["knownness"]
    truth_state = mapping["truthState"]
    primary_truth = {
        ACCOUNT_EFFECTIVE_SANITIZED: "ACCOUNT_CURRENT",
        PUBLIC_REGULAR_NO_BNB: "PUBLIC_CURRENT",
        ADVERSE_PLUS_2_BPS_PER_SIDE_PER_FILL_LEG: "STRESS_COUNTERFACTUAL",
    }
    numeric_total: ExactRatioV1 | None
    if scenario_id == BNB_OR_PROMOTION_SENSITIVITY_ONLY and sensitivity_rate is not None:
        if (
            knownness != "UNKNOWN"
            or truth_state != "SENSITIVITY_ONLY"
            or effective_rate is not None
            or effective_bps is not None
            or sensitivity_bps != _expected_bps(sensitivity_rate)
            or reasons != ("SENSITIVITY_ONLY",)
        ):
            _reject_n3()
        numeric_total = sensitivity_rate
    elif effective_rate is not None:
        if (
            scenario_id not in primary_truth
            or knownness != "KNOWN"
            or truth_state != primary_truth[scenario_id]
            or effective_bps != _expected_bps(effective_rate)
            or sensitivity_rate is not None
            or sensitivity_bps is not None
            or reasons
        ):
            _reject_n3()
        numeric_total = effective_rate
    else:
        if (
            knownness != "UNKNOWN"
            or truth_state != "UNKNOWN"
            or effective_bps is not None
            or sensitivity_rate is not None
            or sensitivity_bps is not None
            or not reasons
        ):
            _reject_n3()
        numeric_total = None

    expected_temporal_use = CURRENT_POINT_IN_TIME
    if route_truth is TruthState.CURRENT_ACCOUNT_RATE:
        expected_temporal_use = "CURRENT_RATE_COUNTERFACTUAL"
    if adverse:
        expected_temporal_use = "ADVERSE_CURRENT_RATE_COUNTERFACTUAL"
    if mapping["temporalUse"] != expected_temporal_use:
        _reject_n3()
    freshness_codes = {
        "AS_OF_PRECEDES_OBSERVATION",
        "RECEIPT_STALE",
    }
    if freshness_reason is None:
        if freshness_codes.intersection(reasons):
            _reject_n3()
    elif truth_state != "UNKNOWN" or freshness_reason not in reasons:
        _reject_n3()

    _validate_components(
        mapping["components"],
        venue=venue_text,
        route_truth=route_truth,
        adverse=adverse and numeric_total is not None,
        numeric_total=numeric_total,
    )
    return (
        base_scenario_id or "",
        venue_text,
        symbol_text,
        role_text,
        side_text,
        charge_basis,
    )


def _validate_scenario(
    value: object,
    *,
    expected_id: str,
    provenance_sources: frozenset[str],
    freshness_reason: str | None,
) -> None:
    mapping = _as_mapping(value)
    adverse = expected_id == ADVERSE_PLUS_2_BPS_PER_SIDE_PER_FILL_LEG
    expected_keys = frozenset(
        {
            "baseScenarioIds",
            "rateRows",
            "reasonCodes",
            "scenarioId",
            "scenarioState",
            "truthState",
            *(("stressRate",) if adverse else ()),
        }
    )
    _require_exact_keys(mapping, expected_keys)
    if mapping["scenarioId"] != expected_id:
        _reject_n3()
    expected_base_ids: list[str] = {
        ACCOUNT_EFFECTIVE_SANITIZED: [],
        ADVERSE_PLUS_2_BPS_PER_SIDE_PER_FILL_LEG: [
            ACCOUNT_EFFECTIVE_SANITIZED,
            PUBLIC_REGULAR_NO_BNB,
        ],
        BNB_OR_PROMOTION_SENSITIVITY_ONLY: [ACCOUNT_EFFECTIVE_SANITIZED],
        PUBLIC_REGULAR_NO_BNB: [],
    }[expected_id]
    if mapping["baseScenarioIds"] != expected_base_ids:
        _reject_n3()
    if adverse and _exact_ratio(mapping["stressRate"]) != make_ratio(1, 5_000):
        _reject_n3()
    rows = mapping["rateRows"]
    if type(rows) is not list or len(rows) > 1_024:
        _reject_n3()
    row_keys = tuple(
        _validate_rate_row(
            row,
            scenario_id=expected_id,
            provenance_sources=provenance_sources,
            freshness_reason=freshness_reason,
        )
        for row in rows
    )
    if row_keys != tuple(sorted(row_keys)) or len(set(row_keys)) != len(row_keys):
        _reject_n3()
    reasons = _safe_enum_list(
        mapping["reasonCodes"],
        allowed=_REASON_CODES,
        maximum=len(_REASON_CODES),
    )
    expected_reasons = sorted(
        {
            reason
            for row in cast(list[Mapping[str, object]], rows)
            for reason in cast(list[str], row["reasonCodes"])
        }
        | ({"NO_RATE_ROWS"} if not rows else set())
    )
    if list(reasons) != expected_reasons:
        _reject_n3()
    if expected_id == BNB_OR_PROMOTION_SENSITIVITY_ONLY:
        ready = bool(rows) and all(
            _as_mapping(row)["sensitivityEffectiveRate"] is not None for row in rows
        )
        expected_state = "SENSITIVITY_ONLY" if ready else "UNKNOWN"
    else:
        ready = bool(rows) and all(_as_mapping(row)["effectiveRate"] is not None for row in rows)
        expected_state = "READY" if ready else "UNKNOWN"
    expected_truth = (
        "KNOWN"
        if expected_state == "READY"
        else ("SENSITIVITY_ONLY" if expected_state == "SENSITIVITY_ONLY" else "UNKNOWN")
    )
    if mapping["scenarioState"] != expected_state or mapping["truthState"] != expected_truth:
        _reject_n3()


def _expected_adverse_row(
    base_row: dict[str, object],
    *,
    base_scenario_id: str,
) -> dict[str, object]:
    expected = dict(base_row)
    expected["baseScenarioId"] = base_scenario_id
    expected["temporalUse"] = "ADVERSE_CURRENT_RATE_COUNTERFACTUAL"
    base_rate = base_row["effectiveRate"]
    if base_rate is None:
        expected["reasonCodes"] = sorted(
            {
                *cast(list[str], base_row["reasonCodes"]),
                "BASE_RATE_UNKNOWN",
            }
        )
        return expected
    stressed = ratio_add(_exact_ratio(base_rate), make_ratio(1, 5_000))
    expected["effectiveRate"] = stressed.as_mapping()
    expected["effectiveBps"] = _expected_bps(stressed).as_mapping()
    expected["truthState"] = "STRESS_COUNTERFACTUAL"
    components = dict(_as_mapping(base_row["components"]))
    components["adverse"] = {
        "knownness": "KNOWN",
        "value": make_ratio(1, 5_000).as_mapping(),
    }
    expected["components"] = components
    return expected


def _validate_adverse_derivation(
    scenarios: tuple[dict[str, object], ...],
) -> None:
    by_id = {cast(str, scenario["scenarioId"]): scenario for scenario in scenarios}
    adverse = by_id[ADVERSE_PLUS_2_BPS_PER_SIDE_PER_FILL_LEG]
    actual_rows = cast(list[object], adverse["rateRows"])
    expected_rows = [
        _expected_adverse_row(
            _as_mapping(row),
            base_scenario_id=base_scenario_id,
        )
        for base_scenario_id in (
            ACCOUNT_EFFECTIVE_SANITIZED,
            PUBLIC_REGULAR_NO_BNB,
        )
        for row in cast(list[object], by_id[base_scenario_id]["rateRows"])
    ]
    if actual_rows != expected_rows:
        _reject_n3()


def _validate_n3_inputs(inputs: Mapping[str, object]) -> None:
    root = _as_mapping(inputs)
    _require_exact_keys(root, _ROOT_KEYS)
    if (
        root["consumer"] != "N-3"
        or root["schema"] != "N3FeeScenarioInputsV1"
        or root["unknownCostsRemainUnknown"] is not True
        or type(root["inputReceiptSha256"]) is not str
        or _SHA256_TEXT.fullmatch(root["inputReceiptSha256"]) is None
    ):
        _reject_n3()
    as_of = _utc_epoch(root["asOfUtc"])
    historical = _as_mapping(root["historicalAccountActual"])
    _require_exact_keys(historical, frozenset({"knownness", "reasonCodes", "value"}))
    if historical != {
        "knownness": "UNKNOWN",
        "reasonCodes": ["CURRENT_RATE_NOT_HISTORICAL_ACTUAL"],
        "value": None,
    }:
        _reject_n3()
    provenance = _as_mapping(root["provenance"])
    _require_exact_keys(
        provenance,
        frozenset(
            {
                "captureKind",
                "observedAtUtc",
                "sanitizationPolicyId",
                "sources",
                "temporalScope",
                "validUntilUtc",
            }
        ),
    )
    if (
        provenance["captureKind"] != OWNER_SUPPLIED_CAPTURE_KIND
        or provenance["sanitizationPolicyId"] != SANITIZATION_POLICY_ID
        or provenance["temporalScope"] != CURRENT_POINT_IN_TIME
    ):
        _reject_n3()
    observed = _utc_epoch(provenance["observedAtUtc"])
    valid_until = _utc_epoch(provenance["validUntilUtc"])
    if valid_until <= observed or valid_until - observed > MAX_RECEIPT_VALIDITY_SECONDS:
        _reject_n3()
    sources = frozenset(
        _safe_enum_list(
            provenance["sources"],
            allowed=_PROVENANCE_SOURCES,
            maximum=len(ProvenanceSource),
        )
    )
    if not sources:
        _reject_n3()
    units = _as_mapping(root["units"])
    _require_exact_keys(
        units,
        frozenset(
            {
                "basisPoints",
                "exchangeFeeAssetRounding",
                "monetaryRounding",
                "rate",
            }
        ),
    )
    if units != {
        "basisPoints": "EXACT_RATE_FRACTION_TIMES_10000",
        "exchangeFeeAssetRounding": "UNKNOWN",
        "monetaryRounding": "NONE",
        "rate": "EXACT_REDUCED_FRACTION",
    }:
        _reject_n3()
    scenarios = root["scenarios"]
    if type(scenarios) is not list or len(scenarios) != len(_SCENARIO_ORDER):
        _reject_n3()
    freshness_reason: str | None = None
    if as_of < observed:
        freshness_reason = "AS_OF_PRECEDES_OBSERVATION"
    elif as_of > valid_until:
        freshness_reason = "RECEIPT_STALE"
    typed_scenarios = tuple(_as_mapping(scenario) for scenario in scenarios)
    for scenario, expected_id in zip(typed_scenarios, _SCENARIO_ORDER, strict=True):
        _validate_scenario(
            scenario,
            expected_id=expected_id,
            provenance_sources=sources,
            freshness_reason=freshness_reason,
        )
    _validate_adverse_derivation(typed_scenarios)


def _n3_validation_failed(inputs: Mapping[str, object]) -> bool:
    try:
        _validate_n3_inputs(inputs)
    except (KeyboardInterrupt, SystemExit):
        raise
    except Exception:
        return True
    return False


@dataclass(frozen=True, slots=True)
class FeeRouteAddressV1:
    """Exact address of one fee row; no positional or venue default is allowed."""

    venue: Venue
    symbol: str
    role: Role
    side: Side
    charge_basis: ChargeBasis
    base_scenario_id: str | None = None

    def __post_init__(self) -> None:
        if not isinstance(self.venue, Venue):
            raise ContractValueError("fee route venue must be Venue")
        if type(self.symbol) is not str or not is_canonical_symbol(self.symbol):
            raise ContractValueError("fee route symbol must be canonical")
        if not isinstance(self.role, Role):
            raise ContractValueError("fee route role must be Role")
        if not isinstance(self.side, Side):
            raise ContractValueError("fee route side must be Side")
        if not isinstance(self.charge_basis, ChargeBasis):
            raise ContractValueError("fee route charge basis must be ChargeBasis")
        if self.venue is Venue.BINANCE_SPOT and (
            self.role is Role.RPI
            or self.side is Side.BOTH
            or self.charge_basis is not ChargeBasis.RECEIVED_ASSET_AMOUNT
        ):
            raise ContractValueError("Spot fee route tuple is invalid")
        if self.venue is Venue.BINANCE_USDM and (
            self.side is not Side.BOTH or self.charge_basis is not ChargeBasis.USDM_QUOTE_NOTIONAL
        ):
            raise ContractValueError("USD-M fee route tuple is invalid")
        if self.base_scenario_id is not None:
            require_contract_id(self.base_scenario_id, field="base_scenario_id")
            if self.base_scenario_id not in {
                ACCOUNT_EFFECTIVE_SANITIZED,
                PUBLIC_REGULAR_NO_BNB,
            }:
                raise ContractValueError("fee route base scenario is unsupported")

    def as_mapping(self) -> dict[str, object]:
        return {
            "baseScenarioId": self.base_scenario_id,
            "chargeBasis": self.charge_basis.value,
            "liquidityRole": self.role.value,
            "side": self.side.value,
            "symbol": self.symbol,
            "venue": self.venue.value,
        }


@dataclass(frozen=True, slots=True)
class _ResolvedRate:
    truth_state: str
    primary_value: ExactRatioV1 | None
    sensitivity_value: ExactRatioV1 | None
    reasons: tuple[str, ...]


def _ratio_from_mapping(value: object) -> ExactRatioV1:
    if not isinstance(value, Mapping):
        raise ContractValueError("exact ratio must be an object")
    numerator = value.get("numerator")
    denominator = value.get("denominator")
    if (
        not isinstance(numerator, str)
        or _INTEGER_TEXT.fullmatch(numerator) is None
        or not isinstance(denominator, str)
        or _POSITIVE_INTEGER_TEXT.fullmatch(denominator) is None
    ):
        raise ContractValueError("exact ratio must use decimal integer strings")
    try:
        ratio = ExactRatioV1(numerator=int(numerator), denominator=int(denominator))
    except (ContractValueError, ValueError) as error:
        raise ContractValueError("exact ratio must use decimal integer strings") from error
    return ratio


def _scenario(inputs: Mapping[str, object], scenario_id: str) -> Mapping[str, object] | None:
    if (
        inputs.get("schema") != "N3FeeScenarioInputsV1"
        or inputs.get("unknownCostsRemainUnknown") is not True
    ):
        raise ContractValueError("N-3 fee input contract is unsupported")
    scenarios = inputs.get("scenarios")
    if not isinstance(scenarios, list):
        raise ContractValueError("N-3 inputs scenarios must be a list")
    matches: list[Mapping[str, object]] = []
    for candidate in scenarios:
        if not isinstance(candidate, Mapping):
            raise ContractValueError("N-3 input scenario must be an object")
        if candidate.get("scenarioId") == scenario_id:
            matches.append(candidate)
    if len(matches) > 1:
        raise ContractValueError("N-3 input scenario identifiers must be unique")
    return matches[0] if matches else None


def _matches_route(row: Mapping[str, object], route: FeeRouteAddressV1) -> bool:
    return (
        row.get("venue") == route.venue.value
        and row.get("symbol") == route.symbol
        and row.get("liquidityRole") == route.role.value
        and row.get("side") == route.side.value
        and row.get("chargeBasis") == route.charge_basis.value
        and (route.base_scenario_id is None or row.get("baseScenarioId") == route.base_scenario_id)
    )


def _resolve_rate(
    inputs: Mapping[str, object],
    *,
    scenario_id: str,
    route: FeeRouteAddressV1,
) -> _ResolvedRate:
    scenario = _scenario(inputs, scenario_id)
    if scenario is None:
        return _ResolvedRate("UNKNOWN", None, None, ("SCENARIO_MISSING",))
    rows = scenario.get("rateRows")
    if not isinstance(rows, list):
        raise ContractValueError("N-3 input rateRows must be a list")
    matches: list[Mapping[str, object]] = []
    for candidate in rows:
        if not isinstance(candidate, Mapping):
            raise ContractValueError("N-3 input rate row must be an object")
        if _matches_route(candidate, route):
            matches.append(candidate)
    if len(matches) > 1:
        return _ResolvedRate("UNKNOWN", None, None, ("ROUTE_AMBIGUOUS",))
    if not matches:
        return _ResolvedRate("UNKNOWN", None, None, ("ROUTE_MISSING",))
    row = matches[0]
    raw_reasons = row.get("reasonCodes")
    if not isinstance(raw_reasons, list) or any(
        not isinstance(reason, str) for reason in raw_reasons
    ):
        raise ContractValueError("N-3 input reasonCodes must be a string list")
    reasons = tuple(cast(list[str], raw_reasons))
    primary_mapping = row.get("effectiveRate")
    sensitivity_mapping = row.get("sensitivityEffectiveRate")
    primary = None if primary_mapping is None else _ratio_from_mapping(primary_mapping)
    sensitivity = None if sensitivity_mapping is None else _ratio_from_mapping(sensitivity_mapping)
    if primary is not None and sensitivity is not None:
        raise ContractValueError("a fee row cannot be primary and sensitivity simultaneously")
    value = primary if primary is not None else sensitivity
    if value is not None and ratio_compare(value, _ZERO) < 0:
        return _ResolvedRate(
            "UNKNOWN",
            None,
            None,
            tuple(sorted({*reasons, "NEGATIVE_RATE_NOT_A_COST"})),
        )
    if primary is not None:
        if row.get("knownness") != "KNOWN" or row.get("truthState") not in {
            "ACCOUNT_CURRENT",
            "PUBLIC_CURRENT",
            "STRESS_COUNTERFACTUAL",
        }:
            return _ResolvedRate(
                "UNKNOWN",
                None,
                None,
                tuple(sorted({*reasons, "ROW_TRUTH_CONFLICT"})),
            )
        return _ResolvedRate(cast(str, row.get("truthState")), primary, None, reasons)
    if sensitivity is not None:
        if row.get("knownness") != "UNKNOWN" or row.get("truthState") != "SENSITIVITY_ONLY":
            return _ResolvedRate(
                "UNKNOWN",
                None,
                None,
                tuple(sorted({*reasons, "ROW_TRUTH_CONFLICT"})),
            )
        return _ResolvedRate("SENSITIVITY_ONLY", None, sensitivity, reasons)
    return _ResolvedRate(
        "UNKNOWN",
        None,
        None,
        tuple(sorted({*reasons, "RATE_UNKNOWN"})),
    )


def _sum_rates(values: tuple[ExactRatioV1, ...]) -> ExactRatioV1:
    total = ZERO_RATIO
    for value in values:
        total = ratio_add(total, value)
    return total


def _cost_components(
    per_leg_fee: ExactRatioV1 | None,
) -> tuple[CostComponentV1, ...]:
    components = {kind: unknown_component(kind) for kind in CostKind}
    if per_leg_fee is not None:
        components[CostKind.PER_LEG_FEE] = known_component(
            CostKind.PER_LEG_FEE,
            per_leg_fee.numerator,
            per_leg_fee.denominator,
        )
    return tuple(components[kind] for kind in sorted(CostKind, key=lambda item: item.value))


def _basis_stack_version(
    scenario_id: str,
    *,
    base_scenario_id: str | None,
) -> str:
    if scenario_id == ACCOUNT_EFFECTIVE_SANITIZED:
        return "fee1-n3-account-current-counterfactual-v1"
    if scenario_id == PUBLIC_REGULAR_NO_BNB:
        return "fee1-n3-public-current-counterfactual-v1"
    if scenario_id == BNB_OR_PROMOTION_SENSITIVITY_ONLY:
        return "fee1-n3-bnb-promotion-sensitivity-only-v1"
    if base_scenario_id == ACCOUNT_EFFECTIVE_SANITIZED:
        return "fee1-n3-adverse-account-plus-2bps-v1"
    if base_scenario_id == PUBLIC_REGULAR_NO_BNB:
        return "fee1-n3-adverse-public-plus-2bps-v1"
    raise ContractValueError("adverse Basis base scenario is unsupported")


def project_basis_q08_cost_stack(
    inputs: Mapping[str, object],
    *,
    scenario_id: str,
    routes: tuple[FeeRouteAddressV1, ...],
) -> CostStackV1:
    """Build an equal-notional Q08 four-leg stack from exact addressed rows.

    ``PER_LEG_FEE`` is the exact arithmetic mean, making Q08's fixed
    ``4 * per_leg_fee`` equal the leg sum. It is UNKNOWN unless all four routes
    resolve to non-negative primary values. Every non-fee component remains
    explicitly UNKNOWN.
    """

    if _n3_validation_failed(inputs):
        inputs = {}
        raise ContractValueError(_N3_REJECTED)
    if scenario_id not in _SCENARIO_IDS:
        raise ContractValueError("fee scenario identifier is unsupported")
    if (
        not isinstance(routes, tuple)
        or len(routes) != BASIS_ROUND_TRIP_LEGS
        or any(not isinstance(route, FeeRouteAddressV1) for route in routes)
    ):
        raise ContractValueError("Basis projection requires exactly four fee routes")
    spot_routes = tuple(route for route in routes if route.venue is Venue.BINANCE_SPOT)
    usdm_routes = tuple(route for route in routes if route.venue is Venue.BINANCE_USDM)
    if len(spot_routes) != 2 or len(usdm_routes) != 2:
        raise ContractValueError(
            "Basis projection requires exactly two Spot and two USD-M fee routes"
        )
    if len({route.symbol for route in routes}) != 1:
        raise ContractValueError("Basis projection routes must share one symbol")
    if {route.side for route in spot_routes} != {Side.BUY, Side.SELL}:
        raise ContractValueError("Basis projection Spot routes require BUY and SELL sides")
    if scenario_id == ADVERSE_PLUS_2_BPS_PER_SIDE_PER_FILL_LEG and any(
        route.base_scenario_id is None for route in routes
    ):
        raise ContractValueError("adverse Basis routes require an explicit base scenario")
    base_scenario_ids = {route.base_scenario_id for route in routes}
    if scenario_id == ADVERSE_PLUS_2_BPS_PER_SIDE_PER_FILL_LEG:
        if len(base_scenario_ids) != 1:
            raise ContractValueError("adverse Basis routes must share one base scenario")
        base_scenario_id = next(iter(base_scenario_ids))
    else:
        if base_scenario_ids != {None}:
            raise ContractValueError("non-adverse Basis routes cannot declare a base scenario")
        base_scenario_id = None
    stack_version = _basis_stack_version(
        scenario_id,
        base_scenario_id=base_scenario_id,
    )
    require_contract_id(stack_version, field="stack_version")
    resolved = tuple(
        _resolve_rate(inputs, scenario_id=scenario_id, route=route) for route in routes
    )
    values = tuple(item.primary_value for item in resolved if item.primary_value is not None)
    per_leg_fee: ExactRatioV1 | None = None
    if len(values) == BASIS_ROUND_TRIP_LEGS:
        summed = _sum_rates(values)
        per_leg_fee = make_ratio(
            summed.numerator,
            summed.denominator * BASIS_ROUND_TRIP_LEGS,
        )
    return CostStackV1(
        stack_version=stack_version,
        components=_cost_components(per_leg_fee),
    )


def _aggregate_routes(
    inputs: Mapping[str, object],
    *,
    scenario_id: str,
    routes: tuple[FeeRouteAddressV1, ...],
) -> _ResolvedRate:
    if not routes:
        return _ResolvedRate("UNKNOWN", None, None, ("NO_ROUTES",))
    resolved = tuple(
        _resolve_rate(inputs, scenario_id=scenario_id, route=route) for route in routes
    )
    reasons = tuple(sorted({reason for item in resolved for reason in item.reasons}))
    if any(item.primary_value is None and item.sensitivity_value is None for item in resolved):
        return _ResolvedRate("UNKNOWN", None, None, reasons or ("RATE_UNKNOWN",))
    if any(item.sensitivity_value is not None for item in resolved):
        values = tuple(
            item.sensitivity_value
            if item.sensitivity_value is not None
            else cast(ExactRatioV1, item.primary_value)
            for item in resolved
        )
        return _ResolvedRate(
            "SENSITIVITY_ONLY",
            None,
            _sum_rates(values),
            tuple(sorted({*reasons, "SENSITIVITY_ONLY"})),
        )
    return _ResolvedRate(
        "KNOWN",
        _sum_rates(tuple(cast(ExactRatioV1, item.primary_value) for item in resolved)),
        None,
        reasons,
    )


def _bps_mapping(value: ExactRatioV1 | None) -> dict[str, object] | None:
    if value is None:
        return None
    return make_ratio(value.numerator * _BPS_SCALE, value.denominator).as_mapping()


def _aggregate_mapping(value: _ResolvedRate) -> dict[str, object]:
    return {
        "bps": _bps_mapping(value.primary_value),
        "rate": None if value.primary_value is None else value.primary_value.as_mapping(),
        "reasonCodes": list(value.reasons),
        "sensitivityBps": _bps_mapping(value.sensitivity_value),
        "sensitivityRate": (
            None if value.sensitivity_value is None else value.sensitivity_value.as_mapping()
        ),
        "truthState": value.truth_state,
    }


def _entry_exit_base_scenario_id(
    *,
    consumer: str,
    scenario_id: str,
    entry_route: FeeRouteAddressV1,
    exit_route: FeeRouteAddressV1,
) -> str | None:
    routes = (entry_route, exit_route)
    if scenario_id == ADVERSE_PLUS_2_BPS_PER_SIDE_PER_FILL_LEG and any(
        route.base_scenario_id is None for route in routes
    ):
        raise ContractValueError(f"adverse {consumer} routes require an explicit base scenario")
    base_scenario_ids = {route.base_scenario_id for route in routes}
    if scenario_id == ADVERSE_PLUS_2_BPS_PER_SIDE_PER_FILL_LEG:
        if len(base_scenario_ids) != 1:
            raise ContractValueError(f"adverse {consumer} routes must share one base scenario")
        return next(iter(base_scenario_ids))
    if base_scenario_ids != {None}:
        raise ContractValueError(f"non-adverse {consumer} routes cannot declare a base scenario")
    return None


def _project_entry_exit_fee_bps(
    inputs: Mapping[str, object],
    *,
    consumer: str,
    schema: str,
    scenario_id: str,
    entry_route: FeeRouteAddressV1,
    exit_route: FeeRouteAddressV1,
    base_scenario_id: str | None,
) -> dict[str, object]:
    """Project exact entry/exit fee sums after consumer topology validation.

    Missing or ambiguous routes make the affected sum UNKNOWN. Sensitivity values
    remain in separately labeled fields and never populate primary bps.
    """

    entry = _aggregate_routes(
        inputs,
        scenario_id=scenario_id,
        routes=(entry_route,),
    )
    exit_ = _aggregate_routes(
        inputs,
        scenario_id=scenario_id,
        routes=(exit_route,),
    )
    if entry.primary_value is not None and exit_.primary_value is not None:
        round_trip = _ResolvedRate(
            "KNOWN",
            ratio_add(entry.primary_value, exit_.primary_value),
            None,
            tuple(sorted({*entry.reasons, *exit_.reasons})),
        )
    elif entry.sensitivity_value is not None and exit_.sensitivity_value is not None:
        round_trip = _ResolvedRate(
            "SENSITIVITY_ONLY",
            None,
            ratio_add(entry.sensitivity_value, exit_.sensitivity_value),
            tuple(sorted({*entry.reasons, *exit_.reasons})),
        )
    else:
        round_trip = _ResolvedRate(
            "UNKNOWN",
            None,
            None,
            tuple(sorted({*entry.reasons, *exit_.reasons, "ROUND_TRIP_UNKNOWN"})),
        )

    entry_mapping = _aggregate_mapping(entry)
    exit_mapping = _aggregate_mapping(exit_)
    round_trip_mapping = _aggregate_mapping(round_trip)
    return {
        "baseScenarioId": base_scenario_id,
        "consumer": consumer,
        "entry": entry_mapping,
        "entryBps": entry_mapping["bps"],
        "exit": exit_mapping,
        "exitBps": exit_mapping["bps"],
        "roundTrip": round_trip_mapping,
        "roundTripBps": round_trip_mapping["bps"],
        "scenarioId": scenario_id,
        "schema": schema,
    }


def project_volume_fee_bps(
    inputs: Mapping[str, object],
    *,
    scenario_id: str,
    entry_route: FeeRouteAddressV1,
    exit_route: FeeRouteAddressV1,
) -> dict[str, object]:
    """Project one same-symbol Spot entry and opposite-side Spot exit for Volume."""

    if _n3_validation_failed(inputs):
        inputs = {}
        raise ContractValueError(_N3_REJECTED)
    if scenario_id not in _SCENARIO_IDS:
        raise ContractValueError("fee scenario identifier is unsupported")
    if not isinstance(entry_route, FeeRouteAddressV1) or not isinstance(
        exit_route, FeeRouteAddressV1
    ):
        raise ContractValueError("Volume projection requires explicit entry and exit routes")
    if (
        entry_route.venue is not Venue.BINANCE_SPOT
        or exit_route.venue is not Venue.BINANCE_SPOT
        or entry_route.symbol != exit_route.symbol
        or entry_route.side is exit_route.side
    ):
        raise ContractValueError(
            "Volume projection requires same-symbol opposite-side Spot entry and exit routes"
        )
    base_scenario_id = _entry_exit_base_scenario_id(
        consumer="Volume",
        scenario_id=scenario_id,
        entry_route=entry_route,
        exit_route=exit_route,
    )
    return _project_entry_exit_fee_bps(
        inputs,
        consumer="Volume",
        schema="VolumeFeeProjectionV1",
        scenario_id=scenario_id,
        entry_route=entry_route,
        exit_route=exit_route,
        base_scenario_id=base_scenario_id,
    )


def project_s1_fee_bps(
    inputs: Mapping[str, object],
    *,
    scenario_id: str,
    entry_route: FeeRouteAddressV1,
    exit_route: FeeRouteAddressV1,
) -> dict[str, object]:
    """Project one explicit same-symbol, same-venue entry and exit for S-1."""

    if _n3_validation_failed(inputs):
        inputs = {}
        raise ContractValueError(_N3_REJECTED)
    if scenario_id not in _SCENARIO_IDS:
        raise ContractValueError("fee scenario identifier is unsupported")
    if not isinstance(entry_route, FeeRouteAddressV1) or not isinstance(
        exit_route, FeeRouteAddressV1
    ):
        raise ContractValueError("S-1 projection requires explicit entry and exit routes")
    if (
        entry_route.symbol != exit_route.symbol
        or entry_route.venue is not exit_route.venue
        or (entry_route.venue is Venue.BINANCE_SPOT and entry_route.side is exit_route.side)
    ):
        raise ContractValueError(
            "S-1 projection requires same-symbol same-venue entry and exit routes, "
            "with opposite Spot sides"
        )
    base_scenario_id = _entry_exit_base_scenario_id(
        consumer="S-1",
        scenario_id=scenario_id,
        entry_route=entry_route,
        exit_route=exit_route,
    )
    return _project_entry_exit_fee_bps(
        inputs,
        consumer="S-1",
        schema="S1FeeProjectionV1",
        scenario_id=scenario_id,
        entry_route=entry_route,
        exit_route=exit_route,
        base_scenario_id=base_scenario_id,
    )


__all__ = [
    "FeeRouteAddressV1",
    "project_basis_q08_cost_stack",
    "project_s1_fee_bps",
    "project_volume_fee_bps",
]
