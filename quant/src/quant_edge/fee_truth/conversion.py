from __future__ import annotations

import calendar
import hashlib
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Final, cast

from quant_edge.canonical import canonical_json_bytes
from quant_edge.errors import ContractValueError
from quant_edge.labels.rational import (
    ZERO_RATIO,
    ExactRatioV1,
    make_ratio,
    ratio_add,
)

from .contracts import (
    CURRENT_POINT_IN_TIME,
    DiscountApplication,
    FeeScenarioV1,
    FeeTruthReceiptV1,
    KnownOrUnknownRateV1,
    RateState,
    TruthState,
)

ACCOUNT_EFFECTIVE_SANITIZED: Final = "ACCOUNT_EFFECTIVE_SANITIZED"
PUBLIC_REGULAR_NO_BNB: Final = "PUBLIC_REGULAR_NO_BNB"
ADVERSE_PLUS_2_BPS_PER_SIDE_PER_FILL_LEG: Final = "ADVERSE_PLUS_2_BPS_PER_SIDE_PER_FILL_LEG"
BNB_OR_PROMOTION_SENSITIVITY_ONLY: Final = "BNB_OR_PROMOTION_SENSITIVITY_ONLY"

CURRENT_RATE_COUNTERFACTUAL: Final = "CURRENT_RATE_COUNTERFACTUAL"
HISTORICAL_ACCOUNT_ACTUAL_UNKNOWN: Final = "HISTORICAL_ACCOUNT_ACTUAL_UNKNOWN"
ADVERSE_RATE: Final = make_ratio(1, 5_000)
_BPS_SCALE: Final = 10_000
_UTC_FORMAT: Final = "%Y-%m-%dT%H:%M:%SZ"


@dataclass(frozen=True, slots=True)
class _RateCalculation:
    value: ExactRatioV1 | None
    reasons: tuple[str, ...]
    components: dict[str, object]


def _ratio_multiply(left: ExactRatioV1, right: ExactRatioV1) -> ExactRatioV1:
    return make_ratio(
        left.numerator * right.numerator,
        left.denominator * right.denominator,
    )


def _ratio_bps(value: ExactRatioV1) -> ExactRatioV1:
    return make_ratio(value.numerator * _BPS_SCALE, value.denominator)


def _epoch_seconds(value: str, *, field: str) -> int:
    if type(value) is not str:
        raise ContractValueError(f"{field} must be a canonical UTC timestamp")
    try:
        parsed = datetime.strptime(value, _UTC_FORMAT).replace(tzinfo=UTC)
    except ValueError as error:
        raise ContractValueError(f"{field} must be a canonical UTC timestamp") from error
    if parsed.strftime(_UTC_FORMAT) != value:
        raise ContractValueError(f"{field} must be a canonical UTC timestamp")
    return calendar.timegm(parsed.utctimetuple())


def _state_value(state: object) -> str:
    value = getattr(state, "value", None)
    if not isinstance(value, str):
        raise ContractValueError("fee truth state must be a string enum")
    return value


def _rate_component(
    rate: KnownOrUnknownRateV1,
    *,
    component: str,
    not_applicable_is_structural_zero: bool,
) -> tuple[ExactRatioV1 | None, dict[str, object], str | None]:
    state = _state_value(rate.state)
    if state == RateState.KNOWN.value:
        if rate.ratio is None:
            raise ContractValueError("known fee rate must contain its exact ratio")
        return (
            rate.ratio,
            {"knownness": "KNOWN", "value": rate.ratio.as_mapping()},
            None,
        )
    if state == "NOT_APPLICABLE" and not_applicable_is_structural_zero:
        return (
            ZERO_RATIO,
            {"knownness": "NOT_APPLICABLE", "value": None},
            None,
        )
    return (
        None,
        {"knownness": "UNKNOWN", "value": None},
        f"{component}_RATE_UNKNOWN",
    )


def _calculate_effective_rate(row: FeeScenarioV1) -> _RateCalculation:
    """Calculate one row without any freshness or historical-use upgrade.

    UNKNOWN is never substituted. A venue-contract ``NOT_APPLICABLE`` state is
    accepted only for special/tax, where it is a structural omission rather than
    an observed zero. The explicit payable multiplier applies to standard only.
    """

    standard, standard_mapping, standard_reason = _rate_component(
        row.standard,
        component="STANDARD",
        not_applicable_is_structural_zero=False,
    )
    special, special_mapping, special_reason = _rate_component(
        row.special,
        component="SPECIAL",
        not_applicable_is_structural_zero=True,
    )
    tax, tax_mapping, tax_reason = _rate_component(
        row.tax,
        component="TAX",
        not_applicable_is_structural_zero=True,
    )
    multiplier, multiplier_mapping, multiplier_reason = _rate_component(
        row.discount.standard_payable_multiplier,
        component="DISCOUNT_MULTIPLIER",
        not_applicable_is_structural_zero=False,
    )
    components: dict[str, object] = {
        "discountApplication": row.discount.application.value,
        "feeAsset": row.discount.fee_asset.value,
        "special": special_mapping,
        "standardBeforeDiscount": standard_mapping,
        "standardPayableMultiplier": multiplier_mapping,
        "tax": tax_mapping,
    }
    reasons = tuple(
        reason
        for reason in (
            standard_reason,
            multiplier_reason,
            special_reason,
            tax_reason,
        )
        if reason is not None
    )
    if row.truth_state is TruthState.UNKNOWN:
        reasons = tuple(sorted({*reasons, "RECEIPT_RATE_UNKNOWN"}))
    if row.discount.application is DiscountApplication.UNKNOWN:
        reasons = tuple(sorted({*reasons, "DISCOUNT_APPLICATION_UNKNOWN"}))
    standard_after_discount: ExactRatioV1 | None = None
    if (
        standard is not None
        and multiplier is not None
        and row.discount.application is not DiscountApplication.UNKNOWN
    ):
        standard_after_discount = _ratio_multiply(standard, multiplier)
        components["standardAfterDiscount"] = {
            "knownness": "KNOWN",
            "value": standard_after_discount.as_mapping(),
        }
    else:
        components["standardAfterDiscount"] = {
            "knownness": "UNKNOWN",
            "value": None,
        }
    if reasons:
        return _RateCalculation(value=None, reasons=reasons, components=components)
    value = ratio_add(
        ratio_add(cast(ExactRatioV1, standard_after_discount), cast(ExactRatioV1, special)),
        cast(ExactRatioV1, tax),
    )
    return _RateCalculation(value=value, reasons=(), components=components)


def effective_rate(row: FeeScenarioV1) -> ExactRatioV1 | None:
    """Return an exact current/public effective rate, or ``None``.

    Sensitivity rows deliberately do not become primary current-account truth;
    use the labeled N-3 projection to retain their hypothetical exact value.
    """

    if not isinstance(row, FeeScenarioV1):
        raise ContractValueError("row must be FeeScenarioV1")
    if row.truth_state in (TruthState.UNKNOWN, TruthState.SENSITIVITY_ONLY):
        return None
    return _calculate_effective_rate(row).value


def _receipt_sha256(receipt: FeeTruthReceiptV1) -> str:
    return hashlib.sha256(canonical_json_bytes(receipt.as_mapping())).hexdigest()


def _freshness_reasons(receipt: FeeTruthReceiptV1, *, as_of_epoch_s: int) -> tuple[str, ...]:
    provenance = receipt.provenance
    if as_of_epoch_s < provenance.observed_at_epoch_s:
        return ("AS_OF_PRECEDES_OBSERVATION",)
    if as_of_epoch_s > provenance.valid_until_epoch_s:
        return ("RECEIPT_STALE",)
    return ()


def _output_truth_state(row: FeeScenarioV1) -> str:
    if row.truth_state is TruthState.CURRENT_ACCOUNT_RATE:
        return "ACCOUNT_CURRENT"
    if row.truth_state is TruthState.PUBLIC_SCHEDULE:
        return "PUBLIC_CURRENT"
    if row.truth_state is TruthState.SENSITIVITY_ONLY:
        return "SENSITIVITY_ONLY"
    return "UNKNOWN"


def _base_scenario_for(row: FeeScenarioV1) -> str | None:
    if row.truth_state is TruthState.CURRENT_ACCOUNT_RATE:
        return ACCOUNT_EFFECTIVE_SANITIZED
    if row.truth_state is TruthState.PUBLIC_SCHEDULE:
        return PUBLIC_REGULAR_NO_BNB
    if row.truth_state is TruthState.SENSITIVITY_ONLY:
        return BNB_OR_PROMOTION_SENSITIVITY_ONLY
    return None


def _route_sort_key(row: dict[str, object]) -> tuple[str, ...]:
    return (
        str(row.get("baseScenarioId") or ""),
        str(row["venue"]),
        str(row["symbol"]),
        str(row["liquidityRole"]),
        str(row["side"]),
        str(row["chargeBasis"]),
    )


def _receipt_route_key(row: FeeScenarioV1) -> tuple[str, ...]:
    return (
        row.venue.value,
        row.symbol,
        row.role.value,
        row.side.value,
        row.charge_basis.value,
    )


def _project_row(
    row: FeeScenarioV1,
    *,
    freshness_reasons: tuple[str, ...],
) -> dict[str, object]:
    calculated = _calculate_effective_rate(row)
    reasons = tuple(sorted({*freshness_reasons, *calculated.reasons}))
    hypothetical = row.truth_state is TruthState.SENSITIVITY_ONLY
    exact_value = calculated.value
    primary_known = exact_value is not None and not reasons and not hypothetical
    sensitivity_known = exact_value is not None and not reasons and hypothetical
    truth_state = _output_truth_state(row)
    if reasons:
        truth_state = "UNKNOWN"
    return {
        "chargeBasis": row.charge_basis.value,
        "components": calculated.components,
        "effectiveBps": (
            _ratio_bps(exact_value).as_mapping()
            if exact_value is not None and primary_known
            else None
        ),
        "effectiveRate": (
            exact_value.as_mapping() if exact_value is not None and primary_known else None
        ),
        "historicalAccountActualState": HISTORICAL_ACCOUNT_ACTUAL_UNKNOWN,
        "knownness": "KNOWN" if primary_known else "UNKNOWN",
        "liquidityRole": row.role.value,
        "reasonCodes": list(reasons or (("SENSITIVITY_ONLY",) if hypothetical else ())),
        "routeId": row.scenario_id,
        "sensitivityEffectiveBps": (
            _ratio_bps(exact_value).as_mapping()
            if exact_value is not None and sensitivity_known
            else None
        ),
        "sensitivityEffectiveRate": (
            exact_value.as_mapping() if exact_value is not None and sensitivity_known else None
        ),
        "side": row.side.value,
        "sourceFieldRefs": [field.value for field in row.source_field_refs],
        "symbol": row.symbol,
        "temporalUse": (
            CURRENT_RATE_COUNTERFACTUAL
            if row.truth_state is TruthState.CURRENT_ACCOUNT_RATE
            else CURRENT_POINT_IN_TIME
        ),
        "truthState": truth_state,
        "venue": row.venue.value,
    }


def _unknown_row_for_all_bases(
    row: FeeScenarioV1,
    *,
    freshness_reasons: tuple[str, ...],
) -> tuple[tuple[str, dict[str, object]], ...]:
    projected = _project_row(row, freshness_reasons=freshness_reasons)
    projected["truthState"] = "UNKNOWN"
    projected["knownness"] = "UNKNOWN"
    projected["effectiveRate"] = None
    projected["effectiveBps"] = None
    projected["sensitivityEffectiveRate"] = None
    projected["sensitivityEffectiveBps"] = None
    projected["reasonCodes"] = sorted(
        {*cast(list[str], projected["reasonCodes"]), "RECEIPT_RATE_UNKNOWN"}
    )
    return tuple(
        (scenario_id, dict(projected))
        for scenario_id in (
            ACCOUNT_EFFECTIVE_SANITIZED,
            PUBLIC_REGULAR_NO_BNB,
        )
    )


def _scenario_state(rows: tuple[dict[str, object], ...], *, sensitivity: bool) -> str:
    if sensitivity:
        has_values = bool(rows) and all(row["sensitivityEffectiveRate"] is not None for row in rows)
        return "SENSITIVITY_ONLY" if has_values else "UNKNOWN"
    if not rows or any(row["effectiveRate"] is None for row in rows):
        return "UNKNOWN"
    return "READY"


def _scenario_mapping(
    *,
    scenario_id: str,
    rows: Iterable[dict[str, object]],
    base_scenario_ids: tuple[str, ...] = (),
    sensitivity: bool = False,
) -> dict[str, object]:
    ordered = tuple(sorted(rows, key=_route_sort_key))
    state = _scenario_state(ordered, sensitivity=sensitivity)
    reasons: set[str] = set()
    for row in ordered:
        reasons.update(cast(list[str], row["reasonCodes"]))
    if not ordered:
        reasons.add("NO_RATE_ROWS")
    mapping: dict[str, object] = {
        "baseScenarioIds": list(base_scenario_ids),
        "rateRows": list(ordered),
        "reasonCodes": sorted(reasons),
        "scenarioId": scenario_id,
        "scenarioState": state,
        "truthState": (
            "SENSITIVITY_ONLY"
            if state == "SENSITIVITY_ONLY"
            else ("KNOWN" if state == "READY" else "UNKNOWN")
        ),
    }
    if scenario_id == ADVERSE_PLUS_2_BPS_PER_SIDE_PER_FILL_LEG:
        mapping["stressRate"] = ADVERSE_RATE.as_mapping()
    return mapping


def _adverse_row(base_row: dict[str, object], *, base_scenario_id: str) -> dict[str, object]:
    output = dict(base_row)
    output["baseScenarioId"] = base_scenario_id
    output["temporalUse"] = "ADVERSE_CURRENT_RATE_COUNTERFACTUAL"
    effective_mapping = base_row["effectiveRate"]
    if effective_mapping is None:
        output["reasonCodes"] = sorted(
            {*cast(list[str], output["reasonCodes"]), "BASE_RATE_UNKNOWN"}
        )
        return output
    effective = _ratio_from_mapping(effective_mapping)
    stressed = ratio_add(effective, ADVERSE_RATE)
    output["effectiveRate"] = stressed.as_mapping()
    output["effectiveBps"] = _ratio_bps(stressed).as_mapping()
    output["truthState"] = "STRESS_COUNTERFACTUAL"
    components = dict(cast(dict[str, object], output["components"]))
    components["adverse"] = {
        "knownness": "KNOWN",
        "value": ADVERSE_RATE.as_mapping(),
    }
    output["components"] = components
    return output


def _ratio_from_mapping(value: object) -> ExactRatioV1:
    if not isinstance(value, dict):
        raise ContractValueError("exact ratio mapping must be an object")
    numerator = value.get("numerator")
    denominator = value.get("denominator")
    if not isinstance(numerator, str) or not isinstance(denominator, str):
        raise ContractValueError("exact ratio mapping must contain decimal integer strings")
    try:
        return make_ratio(int(numerator), int(denominator))
    except ValueError as error:
        raise ContractValueError(
            "exact ratio mapping must contain decimal integer strings"
        ) from error


def convert_receipt_to_n3_inputs(
    receipt: FeeTruthReceiptV1,
    *,
    as_of_utc: str,
) -> dict[str, object]:
    """Convert a validated receipt into deterministic, exact N-3 fee inputs.

    ``as_of_utc`` is mandatory: the adapter has no wall-clock authority. Current
    account readback is labeled counterfactual for historical evidence, and
    historical account-actual truth stays explicitly UNKNOWN.
    """

    if type(receipt) is not FeeTruthReceiptV1:
        raise ContractValueError("receipt must be FeeTruthReceiptV1")
    as_of_epoch_s = _epoch_seconds(as_of_utc, field="as_of_utc")
    freshness_reasons = _freshness_reasons(receipt, as_of_epoch_s=as_of_epoch_s)

    grouped: dict[str, list[dict[str, object]]] = {
        ACCOUNT_EFFECTIVE_SANITIZED: [],
        PUBLIC_REGULAR_NO_BNB: [],
        BNB_OR_PROMOTION_SENSITIVITY_ONLY: [],
    }
    explicit_routes: dict[str, set[tuple[str, ...]]] = {
        ACCOUNT_EFFECTIVE_SANITIZED: set(),
        PUBLIC_REGULAR_NO_BNB: set(),
    }
    for row in receipt.rows:
        scenario_id = _base_scenario_for(row)
        if scenario_id in explicit_routes:
            explicit_routes[scenario_id].add(_receipt_route_key(row))

    for row in receipt.rows:
        scenario_id = _base_scenario_for(row)
        if scenario_id is None:
            for unknown_scenario, projected in _unknown_row_for_all_bases(
                row,
                freshness_reasons=freshness_reasons,
            ):
                if _receipt_route_key(row) not in explicit_routes[unknown_scenario]:
                    grouped[unknown_scenario].append(projected)
            continue
        grouped[scenario_id].append(_project_row(row, freshness_reasons=freshness_reasons))

    adverse_rows = tuple(
        _adverse_row(row, base_scenario_id=base_scenario_id)
        for base_scenario_id in (
            ACCOUNT_EFFECTIVE_SANITIZED,
            PUBLIC_REGULAR_NO_BNB,
        )
        for row in grouped[base_scenario_id]
    )
    scenarios = (
        _scenario_mapping(
            scenario_id=ACCOUNT_EFFECTIVE_SANITIZED,
            rows=grouped[ACCOUNT_EFFECTIVE_SANITIZED],
        ),
        _scenario_mapping(
            scenario_id=ADVERSE_PLUS_2_BPS_PER_SIDE_PER_FILL_LEG,
            rows=adverse_rows,
            base_scenario_ids=(
                ACCOUNT_EFFECTIVE_SANITIZED,
                PUBLIC_REGULAR_NO_BNB,
            ),
        ),
        _scenario_mapping(
            scenario_id=BNB_OR_PROMOTION_SENSITIVITY_ONLY,
            rows=grouped[BNB_OR_PROMOTION_SENSITIVITY_ONLY],
            base_scenario_ids=(ACCOUNT_EFFECTIVE_SANITIZED,),
            sensitivity=True,
        ),
        _scenario_mapping(
            scenario_id=PUBLIC_REGULAR_NO_BNB,
            rows=grouped[PUBLIC_REGULAR_NO_BNB],
        ),
    )
    return {
        "asOfUtc": as_of_utc,
        "consumer": "N-3",
        "historicalAccountActual": {
            "knownness": "UNKNOWN",
            "reasonCodes": ["CURRENT_RATE_NOT_HISTORICAL_ACTUAL"],
            "value": None,
        },
        "inputReceiptSha256": _receipt_sha256(receipt),
        "provenance": {
            "captureKind": receipt.provenance.capture_kind,
            "observedAtUtc": receipt.provenance.observed_at_utc,
            "sanitizationPolicyId": receipt.sanitization_policy_id,
            "sources": [source.value for source in receipt.provenance.sources],
            "temporalScope": receipt.provenance.temporal_scope,
            "validUntilUtc": receipt.provenance.valid_until_utc,
        },
        "scenarios": sorted(scenarios, key=lambda item: cast(str, item["scenarioId"])),
        "schema": "N3FeeScenarioInputsV1",
        "units": {
            "basisPoints": "EXACT_RATE_FRACTION_TIMES_10000",
            "exchangeFeeAssetRounding": "UNKNOWN",
            "monetaryRounding": "NONE",
            "rate": "EXACT_REDUCED_FRACTION",
        },
        "unknownCostsRemainUnknown": True,
    }


def build_consumer_projection(
    receipt: FeeTruthReceiptV1,
    *,
    evaluated_at_utc: str,
) -> dict[str, object]:
    """Return the deterministic mapping form for in-process consumers."""

    return convert_receipt_to_n3_inputs(receipt, as_of_utc=evaluated_at_utc)


def canonical_n3_fee_inputs_bytes(
    receipt: FeeTruthReceiptV1,
    *,
    as_of_utc: str,
) -> bytes:
    """Validate the input type, convert it, and emit canonical N-3 bytes.

    Arbitrary caller-provided mappings cannot cross this public serialization
    boundary. The only public source is a validated sanitized receipt plus the
    caller-injected evaluation clock.
    """

    if type(receipt) is not FeeTruthReceiptV1:
        raise ContractValueError("receipt must be FeeTruthReceiptV1")
    return canonical_json_bytes(convert_receipt_to_n3_inputs(receipt, as_of_utc=as_of_utc))


__all__ = [
    "ACCOUNT_EFFECTIVE_SANITIZED",
    "ADVERSE_PLUS_2_BPS_PER_SIDE_PER_FILL_LEG",
    "ADVERSE_RATE",
    "BNB_OR_PROMOTION_SENSITIVITY_ONLY",
    "CURRENT_RATE_COUNTERFACTUAL",
    "HISTORICAL_ACCOUNT_ACTUAL_UNKNOWN",
    "PUBLIC_REGULAR_NO_BNB",
    "build_consumer_projection",
    "canonical_n3_fee_inputs_bytes",
    "convert_receipt_to_n3_inputs",
    "effective_rate",
]
