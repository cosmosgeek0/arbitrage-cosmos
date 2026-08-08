from __future__ import annotations

import hashlib
from dataclasses import replace
from typing import cast

import pytest

from quant_edge.canonical import canonical_json_bytes
from quant_edge.errors import ContractValueError
from quant_edge.fee_truth import (
    CURRENT_POINT_IN_TIME,
    FEE_TRUTH_SCHEMA,
    FEE_TRUTH_VERSION,
    OWNER_SUPPLIED_CAPTURE_KIND,
    SANITIZATION_POLICY_ID,
    ChargeBasis,
    DiscountApplication,
    DiscountTruthV1,
    FeeAsset,
    FeeScenarioV1,
    FeeTruthReceiptV1,
    KnownOrUnknownRateV1,
    ProvenanceSource,
    ReceiptProvenanceV1,
    Role,
    Side,
    SourceFieldRef,
    TruthState,
    Venue,
    scenario_id_for,
)
from quant_edge.fee_truth.conversion import (
    ACCOUNT_EFFECTIVE_SANITIZED,
    ADVERSE_PLUS_2_BPS_PER_SIDE_PER_FILL_LEG,
    BNB_OR_PROMOTION_SENSITIVITY_ONLY,
    CURRENT_RATE_COUNTERFACTUAL,
    HISTORICAL_ACCOUNT_ACTUAL_UNKNOWN,
    PUBLIC_REGULAR_NO_BNB,
    canonical_n3_fee_inputs_bytes,
    convert_receipt_to_n3_inputs,
    effective_rate,
)
from quant_edge.fee_truth.projections import (
    _expected_source_refs as _n3_expected_source_refs,
)
from quant_edge.fee_truth.projections import _validate_n3_inputs
from quant_edge.labels.rational import ExactRatioV1

OBSERVED = "2026-07-28T12:00:00Z"
VALID_UNTIL = "2026-07-28T13:00:00Z"
AS_OF = "2026-07-28T12:30:00Z"


def _source_ref_parity_dimensions() -> tuple[
    tuple[TruthState, Venue, Role, Side, DiscountApplication],
    ...,
]:
    dimensions: list[tuple[TruthState, Venue, Role, Side, DiscountApplication]] = []
    for venue in Venue:
        routes = (
            (
                (Role.MAKER, Side.BUY),
                (Role.MAKER, Side.SELL),
                (Role.TAKER, Side.BUY),
                (Role.TAKER, Side.SELL),
            )
            if venue is Venue.BINANCE_SPOT
            else (
                (Role.MAKER, Side.BOTH),
                (Role.TAKER, Side.BOTH),
                (Role.RPI, Side.BOTH),
            )
        )
        for truth_state in TruthState:
            for role, side in routes:
                if (
                    truth_state
                    in {
                        TruthState.PUBLIC_SCHEDULE,
                        TruthState.SENSITIVITY_ONLY,
                    }
                    and role is Role.RPI
                ):
                    continue
                applications = (
                    (DiscountApplication.UNKNOWN,)
                    if truth_state is TruthState.UNKNOWN
                    else (
                        (DiscountApplication.NOT_APPLIED,)
                        if truth_state is TruthState.PUBLIC_SCHEDULE
                        else tuple(DiscountApplication)
                    )
                )
                dimensions.extend(
                    (truth_state, venue, role, side, application) for application in applications
                )
    return tuple(dimensions)


SOURCE_REF_PARITY_DIMENSIONS = _source_ref_parity_dimensions()
SOURCE_REF_PARITY_IDS = tuple(
    "-".join(
        (
            truth_state.value,
            venue.value,
            role.value,
            side.value,
            application.value,
        )
    )
    for truth_state, venue, role, side, application in SOURCE_REF_PARITY_DIMENSIONS
)


def _rate(decimal: str) -> KnownOrUnknownRateV1:
    return KnownOrUnknownRateV1.known(decimal)


def _source_ref_parity_row(
    *,
    truth_state: TruthState,
    venue: Venue,
    role: Role,
    side: Side,
    application: DiscountApplication,
) -> FeeScenarioV1:
    if application is DiscountApplication.UNKNOWN:
        discount = DiscountTruthV1(
            application=application,
            standard_payable_multiplier=KnownOrUnknownRateV1.unknown(),
            fee_asset=FeeAsset.UNKNOWN,
        )
    elif application is DiscountApplication.NOT_APPLIED:
        discount = DiscountTruthV1(
            application=application,
            standard_payable_multiplier=_rate("1"),
            fee_asset=(
                FeeAsset.RECEIVED_ASSET
                if venue is Venue.BINANCE_SPOT
                else FeeAsset.SETTLEMENT_ASSET
            ),
        )
    else:
        discount = DiscountTruthV1(
            application=application,
            standard_payable_multiplier=_rate("0.75"),
            fee_asset=FeeAsset.BNB,
        )
    standard = (
        KnownOrUnknownRateV1.unknown() if truth_state is TruthState.UNKNOWN else _rate("0.001")
    )
    if venue is Venue.BINANCE_USDM:
        special = KnownOrUnknownRateV1.not_applicable()
        tax = KnownOrUnknownRateV1.not_applicable()
        charge_basis = ChargeBasis.USDM_QUOTE_NOTIONAL
    else:
        if truth_state in {
            TruthState.PUBLIC_SCHEDULE,
            TruthState.UNKNOWN,
        }:
            special = KnownOrUnknownRateV1.unknown()
            tax = KnownOrUnknownRateV1.unknown()
        else:
            special = _rate("0")
            tax = _rate("0")
        charge_basis = ChargeBasis.RECEIVED_ASSET_AMOUNT
    expected_refs = _n3_expected_source_refs(
        route_truth=truth_state,
        venue=venue.value,
        role=role.value,
        side=side.value,
        discount_application=application.value,
    )
    return FeeScenarioV1(
        scenario_id=scenario_id_for(
            truth_state=truth_state,
            venue=venue,
            symbol="BTCUSDT",
            role=role,
            side=side,
        ),
        truth_state=truth_state,
        venue=venue,
        symbol="BTCUSDT",
        role=role,
        side=side,
        charge_basis=charge_basis,
        standard=standard,
        special=special,
        tax=tax,
        discount=discount,
        source_field_refs=tuple(SourceFieldRef(value) for value in sorted(expected_refs)),
    )


def _spot_row(
    *,
    truth_state: TruthState,
    standard: str = "0.0015",
    special: str | None = "0.00007",
    tax: str | None = "0.000003",
    multiplier: str | None = "0.75",
    application: DiscountApplication = DiscountApplication.APPLIED_TO_STANDARD_ONLY,
    fee_asset: FeeAsset = FeeAsset.BNB,
) -> FeeScenarioV1:
    role = Role.TAKER
    side = Side.BUY
    refs: tuple[SourceFieldRef, ...]
    if truth_state is TruthState.PUBLIC_SCHEDULE:
        refs = (SourceFieldRef.SPOT_FEE_SCHEDULE_TAKER,)
    elif truth_state is TruthState.SENSITIVITY_ONLY:
        refs = (
            SourceFieldRef.SPOT_BNB_DISCOUNT_STANDARD_PAYABLE_MULTIPLIER,
            SourceFieldRef.SPOT_FEE_SCHEDULE_TAKER,
        )
    else:
        component_refs = (
            SourceFieldRef.SPOT_ACCOUNT_SPECIAL_BUYER,
            SourceFieldRef.SPOT_ACCOUNT_SPECIAL_TAKER,
            SourceFieldRef.SPOT_ACCOUNT_STANDARD_BUYER,
            SourceFieldRef.SPOT_ACCOUNT_STANDARD_TAKER,
            SourceFieldRef.SPOT_ACCOUNT_TAX_BUYER,
            SourceFieldRef.SPOT_ACCOUNT_TAX_TAKER,
        )
        discount_refs = (
            (
                SourceFieldRef.SPOT_ACCOUNT_DISCOUNT_ASSET,
                SourceFieldRef.SPOT_ACCOUNT_DISCOUNT_ENABLED_FOR_ACCOUNT,
                SourceFieldRef.SPOT_ACCOUNT_DISCOUNT_ENABLED_FOR_SYMBOL,
                SourceFieldRef.SPOT_ACCOUNT_DISCOUNT_MULTIPLIER,
            )
            if application is DiscountApplication.APPLIED_TO_STANDARD_ONLY
            else ()
        )
        refs = tuple(sorted((*component_refs, *discount_refs), key=lambda item: item.value))
    return FeeScenarioV1(
        scenario_id=scenario_id_for(
            truth_state=truth_state,
            venue=Venue.BINANCE_SPOT,
            symbol="BTCUSDT",
            role=role,
            side=side,
        ),
        truth_state=truth_state,
        venue=Venue.BINANCE_SPOT,
        symbol="BTCUSDT",
        role=role,
        side=side,
        charge_basis=ChargeBasis.RECEIVED_ASSET_AMOUNT,
        standard=_rate(standard),
        special=KnownOrUnknownRateV1.unknown() if special is None else _rate(special),
        tax=KnownOrUnknownRateV1.unknown() if tax is None else _rate(tax),
        discount=DiscountTruthV1(
            application=application,
            standard_payable_multiplier=(
                KnownOrUnknownRateV1.unknown() if multiplier is None else _rate(multiplier)
            ),
            fee_asset=fee_asset,
        ),
        source_field_refs=refs,
    )


def _receipt(
    *rows: FeeScenarioV1,
    valid_until: str = VALID_UNTIL,
) -> FeeTruthReceiptV1:
    sources = tuple(sorted(ProvenanceSource, key=lambda item: item.value))
    return FeeTruthReceiptV1(
        schema=FEE_TRUTH_SCHEMA,
        version=FEE_TRUTH_VERSION,
        sanitization_policy_id=SANITIZATION_POLICY_ID,
        provenance=ReceiptProvenanceV1(
            capture_kind=OWNER_SUPPLIED_CAPTURE_KIND,
            observed_at_utc=OBSERVED,
            valid_until_utc=valid_until,
            temporal_scope=CURRENT_POINT_IN_TIME,
            sources=sources,
        ),
        rows=tuple(sorted(rows, key=lambda row: row.scenario_id)),
    )


def _scenario(mapping: dict[str, object], scenario_id: str) -> dict[str, object]:
    scenarios = cast(list[dict[str, object]], mapping["scenarios"])
    return next(item for item in scenarios if item["scenarioId"] == scenario_id)


def _row(scenario: dict[str, object], route_id: str) -> dict[str, object]:
    rows = cast(list[dict[str, object]], scenario["rateRows"])
    return next(item for item in rows if item["routeId"] == route_id)


def _ratio(mapping: object) -> ExactRatioV1:
    value = cast(dict[str, str], mapping)
    return ExactRatioV1(
        numerator=int(value["numerator"]),
        denominator=int(value["denominator"]),
    )


@pytest.mark.parametrize(
    ("truth_state", "venue", "role", "side", "application"),
    SOURCE_REF_PARITY_DIMENSIONS,
    ids=SOURCE_REF_PARITY_IDS,
)
def test_every_typed_source_ref_state_emits_an_n3_accepted_artifact(
    truth_state: TruthState,
    venue: Venue,
    role: Role,
    side: Side,
    application: DiscountApplication,
) -> None:
    row = _source_ref_parity_row(
        truth_state=truth_state,
        venue=venue,
        role=role,
        side=side,
        application=application,
    )

    converted = convert_receipt_to_n3_inputs(_receipt(row), as_of_utc=AS_OF)

    _validate_n3_inputs(converted)


@pytest.mark.parametrize(
    ("explicit_truth", "venue", "role", "side"),
    [
        (TruthState.CURRENT_ACCOUNT_RATE, Venue.BINANCE_SPOT, Role.TAKER, Side.BUY),
        (TruthState.PUBLIC_SCHEDULE, Venue.BINANCE_SPOT, Role.TAKER, Side.BUY),
        (TruthState.CURRENT_ACCOUNT_RATE, Venue.BINANCE_USDM, Role.TAKER, Side.BOTH),
        (TruthState.PUBLIC_SCHEDULE, Venue.BINANCE_USDM, Role.TAKER, Side.BOTH),
    ],
)
def test_unknown_row_is_only_a_missing_base_route_fallback(
    explicit_truth: TruthState,
    venue: Venue,
    role: Role,
    side: Side,
) -> None:
    explicit = _source_ref_parity_row(
        truth_state=explicit_truth,
        venue=venue,
        role=role,
        side=side,
        application=DiscountApplication.NOT_APPLIED,
    )
    unknown = _source_ref_parity_row(
        truth_state=TruthState.UNKNOWN,
        venue=venue,
        role=role,
        side=side,
        application=DiscountApplication.UNKNOWN,
    )

    converted = convert_receipt_to_n3_inputs(_receipt(explicit, unknown), as_of_utc=AS_OF)
    _validate_n3_inputs(converted)

    explicit_base = (
        ACCOUNT_EFFECTIVE_SANITIZED
        if explicit_truth is TruthState.CURRENT_ACCOUNT_RATE
        else PUBLIC_REGULAR_NO_BNB
    )
    fallback_base = (
        PUBLIC_REGULAR_NO_BNB
        if explicit_base == ACCOUNT_EFFECTIVE_SANITIZED
        else ACCOUNT_EFFECTIVE_SANITIZED
    )
    assert [
        row["routeId"]
        for row in cast(list[dict[str, object]], _scenario(converted, explicit_base)["rateRows"])
    ] == [explicit.scenario_id]
    assert [
        row["routeId"]
        for row in cast(list[dict[str, object]], _scenario(converted, fallback_base)["rateRows"])
    ] == [unknown.scenario_id]


@pytest.mark.parametrize(
    ("venue", "role", "side"),
    [
        (Venue.BINANCE_SPOT, Role.TAKER, Side.BUY),
        (Venue.BINANCE_USDM, Role.TAKER, Side.BOTH),
    ],
)
def test_current_and_public_rows_shadow_redundant_unknown_route(
    venue: Venue,
    role: Role,
    side: Side,
) -> None:
    current = _source_ref_parity_row(
        truth_state=TruthState.CURRENT_ACCOUNT_RATE,
        venue=venue,
        role=role,
        side=side,
        application=DiscountApplication.NOT_APPLIED,
    )
    public = _source_ref_parity_row(
        truth_state=TruthState.PUBLIC_SCHEDULE,
        venue=venue,
        role=role,
        side=side,
        application=DiscountApplication.NOT_APPLIED,
    )
    unknown = _source_ref_parity_row(
        truth_state=TruthState.UNKNOWN,
        venue=venue,
        role=role,
        side=side,
        application=DiscountApplication.UNKNOWN,
    )

    converted = convert_receipt_to_n3_inputs(
        _receipt(current, public, unknown),
        as_of_utc=AS_OF,
    )
    _validate_n3_inputs(converted)

    account_rows = cast(
        list[dict[str, object]],
        _scenario(converted, ACCOUNT_EFFECTIVE_SANITIZED)["rateRows"],
    )
    public_rows = cast(
        list[dict[str, object]],
        _scenario(converted, PUBLIC_REGULAR_NO_BNB)["rateRows"],
    )
    assert [row["routeId"] for row in account_rows] == [current.scenario_id]
    assert [row["routeId"] for row in public_rows] == [public.scenario_id]
    assert unknown.scenario_id not in {
        cast(str, row["routeId"])
        for scenario in cast(list[dict[str, object]], converted["scenarios"])
        for row in cast(list[dict[str, object]], scenario["rateRows"])
    }


@pytest.mark.parametrize(
    ("dimensions", "extra_ref"),
    [
        (
            (
                TruthState.CURRENT_ACCOUNT_RATE,
                Venue.BINANCE_SPOT,
                Role.MAKER,
                Side.BUY,
                DiscountApplication.APPLIED_TO_STANDARD_ONLY,
            ),
            SourceFieldRef.SPOT_BNB_DISCOUNT_STANDARD_PAYABLE_MULTIPLIER,
        ),
        (
            (
                TruthState.SENSITIVITY_ONLY,
                Venue.BINANCE_USDM,
                Role.TAKER,
                Side.BOTH,
                DiscountApplication.APPLIED_TO_STANDARD_ONLY,
            ),
            SourceFieldRef.USDM_BNB_DISCOUNT_STATUS,
        ),
        (
            (
                TruthState.CURRENT_ACCOUNT_RATE,
                Venue.BINANCE_USDM,
                Role.MAKER,
                Side.BOTH,
                DiscountApplication.NOT_APPLIED,
            ),
            SourceFieldRef.USDM_BNB_DISCOUNT_STANDARD_PAYABLE_MULTIPLIER,
        ),
        (
            (
                TruthState.PUBLIC_SCHEDULE,
                Venue.BINANCE_SPOT,
                Role.MAKER,
                Side.BUY,
                DiscountApplication.NOT_APPLIED,
            ),
            SourceFieldRef.SPOT_ACCOUNT_STANDARD_BUYER,
        ),
    ],
    ids=(
        "spot-applied-public-multiplier",
        "usdm-sensitivity-burn-status",
        "usdm-no-discount-applied-multiplier",
        "spot-public-account-component",
    ),
)
def test_typed_receipt_rejects_hostile_extra_source_refs(
    dimensions: tuple[TruthState, Venue, Role, Side, DiscountApplication],
    extra_ref: SourceFieldRef,
) -> None:
    truth_state, venue, role, side, application = dimensions
    row = _source_ref_parity_row(
        truth_state=truth_state,
        venue=venue,
        role=role,
        side=side,
        application=application,
    )
    hostile_refs = tuple(sorted((*row.source_field_refs, extra_ref), key=lambda item: item.value))

    with pytest.raises(
        ContractValueError,
        match="source field references must exactly match scenario truth",
    ):
        replace(row, source_field_refs=hostile_refs)


def test_effective_rate_discounts_only_standard_then_adds_special_and_tax() -> None:
    row = _spot_row(truth_state=TruthState.CURRENT_ACCOUNT_RATE)

    effective = effective_rate(row)

    assert effective == ExactRatioV1(numerator=599, denominator=500_000)
    converted = convert_receipt_to_n3_inputs(_receipt(row), as_of_utc=AS_OF)
    projected = _row(_scenario(converted, ACCOUNT_EFFECTIVE_SANITIZED), row.scenario_id)
    components = cast(dict[str, dict[str, object]], projected["components"])
    assert _ratio(components["standardBeforeDiscount"]["value"]) == ExactRatioV1(
        numerator=3,
        denominator=2_000,
    )
    assert _ratio(components["standardAfterDiscount"]["value"]) == ExactRatioV1(
        numerator=9,
        denominator=8_000,
    )
    assert _ratio(components["special"]["value"]) == ExactRatioV1(
        numerator=7,
        denominator=100_000,
    )
    assert _ratio(components["tax"]["value"]) == ExactRatioV1(
        numerator=3,
        denominator=1_000_000,
    )
    assert _ratio(projected["effectiveRate"]) == effective


def test_current_readback_is_counterfactual_never_historical_account_actual() -> None:
    row = _spot_row(truth_state=TruthState.CURRENT_ACCOUNT_RATE)

    converted = convert_receipt_to_n3_inputs(_receipt(row), as_of_utc=AS_OF)
    projected = _row(_scenario(converted, ACCOUNT_EFFECTIVE_SANITIZED), row.scenario_id)

    assert projected["temporalUse"] == CURRENT_RATE_COUNTERFACTUAL
    assert projected["historicalAccountActualState"] == HISTORICAL_ACCOUNT_ACTUAL_UNKNOWN
    assert converted["historicalAccountActual"] == {
        "knownness": "UNKNOWN",
        "reasonCodes": ["CURRENT_RATE_NOT_HISTORICAL_ACTUAL"],
        "value": None,
    }


def test_stale_and_discount_unknown_are_unknown_never_numeric_zero() -> None:
    current = _spot_row(truth_state=TruthState.CURRENT_ACCOUNT_RATE)
    stale = convert_receipt_to_n3_inputs(
        _receipt(current, valid_until="2026-07-28T12:15:00Z"),
        as_of_utc=AS_OF,
    )
    stale_row = _row(_scenario(stale, ACCOUNT_EFFECTIVE_SANITIZED), current.scenario_id)
    assert stale_row["knownness"] == "UNKNOWN"
    assert stale_row["effectiveRate"] is None
    assert stale_row["effectiveBps"] is None
    assert "RECEIPT_STALE" in cast(list[str], stale_row["reasonCodes"])

    discount_unknown = _spot_row(
        truth_state=TruthState.CURRENT_ACCOUNT_RATE,
        multiplier=None,
        application=DiscountApplication.UNKNOWN,
        fee_asset=FeeAsset.UNKNOWN,
    )
    assert effective_rate(discount_unknown) is None
    converted = convert_receipt_to_n3_inputs(
        _receipt(discount_unknown),
        as_of_utc=AS_OF,
    )
    unknown_row = _row(
        _scenario(converted, ACCOUNT_EFFECTIVE_SANITIZED),
        discount_unknown.scenario_id,
    )
    assert unknown_row["knownness"] == "UNKNOWN"
    assert unknown_row["effectiveRate"] is None
    assert {
        "DISCOUNT_APPLICATION_UNKNOWN",
        "DISCOUNT_MULTIPLIER_RATE_UNKNOWN",
    } <= set(cast(list[str], unknown_row["reasonCodes"]))


def test_partial_public_row_is_unknown_never_numeric_zero() -> None:
    partial = _spot_row(
        truth_state=TruthState.PUBLIC_SCHEDULE,
        standard="0.001",
        special=None,
        tax=None,
        multiplier="1",
        application=DiscountApplication.NOT_APPLIED,
        fee_asset=FeeAsset.RECEIVED_ASSET,
    )

    assert effective_rate(partial) is None
    converted = convert_receipt_to_n3_inputs(_receipt(partial), as_of_utc=AS_OF)
    scenario = _scenario(converted, PUBLIC_REGULAR_NO_BNB)
    projected = _row(scenario, partial.scenario_id)
    components = cast(dict[str, dict[str, object]], projected["components"])

    assert scenario["scenarioState"] == "UNKNOWN"
    assert projected["knownness"] == "UNKNOWN"
    assert projected["effectiveRate"] is None
    assert projected["effectiveBps"] is None
    assert components["standardBeforeDiscount"]["knownness"] == "KNOWN"
    assert components["special"] == {"knownness": "UNKNOWN", "value": None}
    assert components["tax"] == {"knownness": "UNKNOWN", "value": None}


def test_sensitivity_value_is_separate_and_never_upgrades_primary_truth() -> None:
    sensitivity = _spot_row(
        truth_state=TruthState.SENSITIVITY_ONLY,
        standard="0.001",
        special="0",
        tax="0",
    )

    assert effective_rate(sensitivity) is None
    converted = convert_receipt_to_n3_inputs(_receipt(sensitivity), as_of_utc=AS_OF)
    scenario = _scenario(converted, BNB_OR_PROMOTION_SENSITIVITY_ONLY)
    projected = _row(scenario, sensitivity.scenario_id)

    assert scenario["scenarioState"] == "SENSITIVITY_ONLY"
    assert scenario["truthState"] == "SENSITIVITY_ONLY"
    assert projected["knownness"] == "UNKNOWN"
    assert projected["effectiveRate"] is None
    assert projected["effectiveBps"] is None
    assert _ratio(projected["sensitivityEffectiveRate"]) == ExactRatioV1(
        numerator=3,
        denominator=4_000,
    )


def test_fixed_scenario_ids_and_two_basis_point_stress_are_exact() -> None:
    current = _spot_row(truth_state=TruthState.CURRENT_ACCOUNT_RATE)
    public = _spot_row(
        truth_state=TruthState.PUBLIC_SCHEDULE,
        standard="0.001",
        special=None,
        tax=None,
        multiplier="1",
        application=DiscountApplication.NOT_APPLIED,
        fee_asset=FeeAsset.RECEIVED_ASSET,
    )
    sensitivity = _spot_row(
        truth_state=TruthState.SENSITIVITY_ONLY,
        standard="0.001",
        special="0",
        tax="0",
    )

    converted = convert_receipt_to_n3_inputs(
        _receipt(current, public, sensitivity),
        as_of_utc=AS_OF,
    )
    scenarios = cast(list[dict[str, object]], converted["scenarios"])
    assert {item["scenarioId"] for item in scenarios} == {
        ACCOUNT_EFFECTIVE_SANITIZED,
        ADVERSE_PLUS_2_BPS_PER_SIDE_PER_FILL_LEG,
        BNB_OR_PROMOTION_SENSITIVITY_ONLY,
        PUBLIC_REGULAR_NO_BNB,
    }
    adverse = _scenario(converted, ADVERSE_PLUS_2_BPS_PER_SIDE_PER_FILL_LEG)
    assert _ratio(adverse["stressRate"]) == ExactRatioV1(
        numerator=1,
        denominator=5_000,
    )
    stressed_current = next(
        row
        for row in cast(list[dict[str, object]], adverse["rateRows"])
        if row.get("baseScenarioId") == ACCOUNT_EFFECTIVE_SANITIZED
    )
    assert _ratio(stressed_current["effectiveRate"]) == ExactRatioV1(
        numerator=699,
        denominator=500_000,
    )


def test_canonical_bytes_and_receipt_digest_are_deterministic() -> None:
    receipt = _receipt(_spot_row(truth_state=TruthState.CURRENT_ACCOUNT_RATE))

    first = convert_receipt_to_n3_inputs(receipt, as_of_utc=AS_OF)
    second = convert_receipt_to_n3_inputs(receipt, as_of_utc=AS_OF)
    first_bytes = canonical_n3_fee_inputs_bytes(receipt, as_of_utc=AS_OF)
    second_bytes = canonical_n3_fee_inputs_bytes(receipt, as_of_utc=AS_OF)

    assert first == second
    assert first_bytes == second_bytes
    assert first_bytes == canonical_json_bytes(first)
    assert first_bytes.endswith(b"\n")
    assert first["inputReceiptSha256"] == second["inputReceiptSha256"]
    assert hashlib.sha256(first_bytes).hexdigest() == hashlib.sha256(second_bytes).hexdigest()


def test_n3_provenance_and_unknown_exchange_rounding_are_preserved() -> None:
    receipt = _receipt(_spot_row(truth_state=TruthState.CURRENT_ACCOUNT_RATE))

    converted = convert_receipt_to_n3_inputs(receipt, as_of_utc=AS_OF)
    provenance = cast(dict[str, object], converted["provenance"])
    units = cast(dict[str, object], converted["units"])

    assert provenance["captureKind"] == OWNER_SUPPLIED_CAPTURE_KIND
    assert provenance["sources"] == [
        source.value for source in sorted(ProvenanceSource, key=lambda item: item.value)
    ]
    assert units["exchangeFeeAssetRounding"] == "UNKNOWN"
    assert units["monetaryRounding"] == "NONE"


def test_conversion_and_serializer_reject_receipt_subclasses() -> None:
    class ReceiptSubclass(FeeTruthReceiptV1):
        pass

    receipt = _receipt(_spot_row(truth_state=TruthState.CURRENT_ACCOUNT_RATE))
    subclass = ReceiptSubclass(
        schema=receipt.schema,
        version=receipt.version,
        sanitization_policy_id=receipt.sanitization_policy_id,
        provenance=receipt.provenance,
        rows=receipt.rows,
    )

    with pytest.raises(ContractValueError, match="receipt must be FeeTruthReceiptV1"):
        convert_receipt_to_n3_inputs(subclass, as_of_utc=AS_OF)
    with pytest.raises(ContractValueError, match="receipt must be FeeTruthReceiptV1"):
        canonical_n3_fee_inputs_bytes(subclass, as_of_utc=AS_OF)


def test_conversion_requires_exact_builtin_utc_text() -> None:
    class UtcTextSubclass(str):
        pass

    receipt = _receipt(_spot_row(truth_state=TruthState.CURRENT_ACCOUNT_RATE))

    with pytest.raises(ContractValueError, match="as_of_utc must be a canonical UTC timestamp"):
        convert_receipt_to_n3_inputs(receipt, as_of_utc=UtcTextSubclass(AS_OF))
