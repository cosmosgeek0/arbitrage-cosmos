from __future__ import annotations

from typing import cast

import pytest

from quant_edge.derivatives.costs import CostKind, CostKnownness
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
    PUBLIC_REGULAR_NO_BNB,
    convert_receipt_to_n3_inputs,
)
from quant_edge.fee_truth.projections import (
    FeeRouteAddressV1,
    project_basis_q08_cost_stack,
    project_s1_fee_bps,
    project_volume_fee_bps,
)
from quant_edge.labels.rational import ExactRatioV1, make_ratio

AS_OF = "2026-07-28T12:30:00Z"


def _spot(
    *,
    role: Role,
    side: Side,
    standard: str,
    special: str,
    tax: str,
    truth_state: TruthState = TruthState.CURRENT_ACCOUNT_RATE,
) -> FeeScenarioV1:
    role_suffix = role.value
    side_suffix = "BUYER" if side is Side.BUY else "SELLER"
    refs: tuple[SourceFieldRef, ...]
    if truth_state is TruthState.SENSITIVITY_ONLY:
        refs = (
            SourceFieldRef.SPOT_BNB_DISCOUNT_STANDARD_PAYABLE_MULTIPLIER,
            SourceFieldRef[f"SPOT_FEE_SCHEDULE_{role_suffix}"],
        )
    else:
        refs = tuple(
            sorted(
                (
                    SourceFieldRef.SPOT_ACCOUNT_DISCOUNT_ASSET,
                    SourceFieldRef.SPOT_ACCOUNT_DISCOUNT_ENABLED_FOR_ACCOUNT,
                    SourceFieldRef.SPOT_ACCOUNT_DISCOUNT_ENABLED_FOR_SYMBOL,
                    SourceFieldRef.SPOT_ACCOUNT_DISCOUNT_MULTIPLIER,
                    *(
                        SourceFieldRef[f"SPOT_ACCOUNT_{component}_{suffix}"]
                        for component in ("STANDARD", "SPECIAL", "TAX")
                        for suffix in (role_suffix, side_suffix)
                    ),
                ),
                key=lambda item: item.value,
            )
        )
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
        standard=KnownOrUnknownRateV1.known(standard),
        special=KnownOrUnknownRateV1.known(special),
        tax=KnownOrUnknownRateV1.known(tax),
        discount=DiscountTruthV1(
            application=DiscountApplication.APPLIED_TO_STANDARD_ONLY,
            standard_payable_multiplier=KnownOrUnknownRateV1.known("0.75"),
            fee_asset=FeeAsset.BNB,
        ),
        source_field_refs=refs,
    )


def _usdm(*, role: Role, standard: str) -> FeeScenarioV1:
    return FeeScenarioV1(
        scenario_id=scenario_id_for(
            truth_state=TruthState.CURRENT_ACCOUNT_RATE,
            venue=Venue.BINANCE_USDM,
            symbol="BTCUSDT",
            role=role,
            side=Side.BOTH,
        ),
        truth_state=TruthState.CURRENT_ACCOUNT_RATE,
        venue=Venue.BINANCE_USDM,
        symbol="BTCUSDT",
        role=role,
        side=Side.BOTH,
        charge_basis=ChargeBasis.USDM_QUOTE_NOTIONAL,
        standard=KnownOrUnknownRateV1.known(standard),
        special=KnownOrUnknownRateV1.not_applicable(),
        tax=KnownOrUnknownRateV1.not_applicable(),
        discount=DiscountTruthV1(
            application=DiscountApplication.NOT_APPLIED,
            standard_payable_multiplier=KnownOrUnknownRateV1.known("1"),
            fee_asset=FeeAsset.SETTLEMENT_ASSET,
        ),
        source_field_refs=(
            SourceFieldRef[f"USDM_ACCOUNT_{role.value}_COMMISSION_RATE"],
            SourceFieldRef.USDM_BNB_DISCOUNT_STATUS,
        ),
    )


def _public_spot(*, role: Role, side: Side, standard: str) -> FeeScenarioV1:
    return FeeScenarioV1(
        scenario_id=scenario_id_for(
            truth_state=TruthState.PUBLIC_SCHEDULE,
            venue=Venue.BINANCE_SPOT,
            symbol="BTCUSDT",
            role=role,
            side=side,
        ),
        truth_state=TruthState.PUBLIC_SCHEDULE,
        venue=Venue.BINANCE_SPOT,
        symbol="BTCUSDT",
        role=role,
        side=side,
        charge_basis=ChargeBasis.RECEIVED_ASSET_AMOUNT,
        standard=KnownOrUnknownRateV1.known(standard),
        special=KnownOrUnknownRateV1.unknown(),
        tax=KnownOrUnknownRateV1.unknown(),
        discount=DiscountTruthV1(
            application=DiscountApplication.NOT_APPLIED,
            standard_payable_multiplier=KnownOrUnknownRateV1.known("1"),
            fee_asset=FeeAsset.RECEIVED_ASSET,
        ),
        source_field_refs=(SourceFieldRef[f"SPOT_FEE_SCHEDULE_{role.value}"],),
    )


def _unknown_spot(*, role: Role, side: Side) -> FeeScenarioV1:
    return FeeScenarioV1(
        scenario_id=scenario_id_for(
            truth_state=TruthState.UNKNOWN,
            venue=Venue.BINANCE_SPOT,
            symbol="BTCUSDT",
            role=role,
            side=side,
        ),
        truth_state=TruthState.UNKNOWN,
        venue=Venue.BINANCE_SPOT,
        symbol="BTCUSDT",
        role=role,
        side=side,
        charge_basis=ChargeBasis.RECEIVED_ASSET_AMOUNT,
        standard=KnownOrUnknownRateV1.unknown(),
        special=KnownOrUnknownRateV1.unknown(),
        tax=KnownOrUnknownRateV1.unknown(),
        discount=DiscountTruthV1(
            application=DiscountApplication.UNKNOWN,
            standard_payable_multiplier=KnownOrUnknownRateV1.unknown(),
            fee_asset=FeeAsset.UNKNOWN,
        ),
        source_field_refs=(),
    )


def _receipt(*rows: FeeScenarioV1) -> FeeTruthReceiptV1:
    return FeeTruthReceiptV1(
        schema=FEE_TRUTH_SCHEMA,
        version=FEE_TRUTH_VERSION,
        sanitization_policy_id=SANITIZATION_POLICY_ID,
        provenance=ReceiptProvenanceV1(
            capture_kind=OWNER_SUPPLIED_CAPTURE_KIND,
            observed_at_utc="2026-07-28T12:00:00Z",
            valid_until_utc="2026-07-28T13:00:00Z",
            temporal_scope=CURRENT_POINT_IN_TIME,
            sources=tuple(sorted(ProvenanceSource, key=lambda item: item.value)),
        ),
        rows=tuple(sorted(rows, key=lambda row: row.scenario_id)),
    )


def _route(row: FeeScenarioV1) -> FeeRouteAddressV1:
    return FeeRouteAddressV1(
        venue=row.venue,
        symbol=row.symbol,
        role=row.role,
        side=row.side,
        charge_basis=row.charge_basis,
    )


def _route_with_base(
    row: FeeScenarioV1,
    base_scenario_id: str,
) -> FeeRouteAddressV1:
    return FeeRouteAddressV1(
        venue=row.venue,
        symbol=row.symbol,
        role=row.role,
        side=row.side,
        charge_basis=row.charge_basis,
        base_scenario_id=base_scenario_id,
    )


def _scenario_mapping(
    inputs: dict[str, object],
    scenario_id: str,
) -> dict[str, object]:
    return next(
        scenario
        for scenario in cast(list[dict[str, object]], inputs["scenarios"])
        if scenario["scenarioId"] == scenario_id
    )


def _ratio(mapping: object) -> ExactRatioV1:
    value = cast(dict[str, str], mapping)
    return ExactRatioV1(
        numerator=int(value["numerator"]),
        denominator=int(value["denominator"]),
    )


def _complete_account_routes() -> tuple[
    tuple[FeeScenarioV1, ...],
    tuple[FeeRouteAddressV1, ...],
]:
    rows = (
        _spot(
            role=Role.MAKER,
            side=Side.BUY,
            standard="0.001",
            special="0.00001",
            tax="0.000001",
        ),
        _spot(
            role=Role.TAKER,
            side=Side.SELL,
            standard="0.0012",
            special="0.00002",
            tax="0.000002",
        ),
        _usdm(role=Role.MAKER, standard="0.0002"),
        _usdm(role=Role.TAKER, standard="0.0004"),
    )
    return rows, tuple(_route(row) for row in rows)


def test_basis_equal_notional_four_leg_projection_is_exact_and_fee_only() -> None:
    rows, routes = _complete_account_routes()
    inputs = convert_receipt_to_n3_inputs(_receipt(*rows), as_of_utc=AS_OF)

    stack = project_basis_q08_cost_stack(
        inputs,
        scenario_id=ACCOUNT_EFFECTIVE_SANITIZED,
        routes=routes,
    )

    fee = stack.component(CostKind.PER_LEG_FEE)
    assert fee.knownness is CostKnownness.KNOWN
    assert fee.value == ExactRatioV1(numerator=2_283, denominator=4_000_000)
    assert stack.legs == 4
    assert fee.value is not None
    assert make_ratio(
        fee.value.numerator * stack.legs,
        fee.value.denominator,
    ) == ExactRatioV1(numerator=2_283, denominator=1_000_000)

    non_fee = tuple(
        component for component in stack.components if component.kind is not CostKind.PER_LEG_FEE
    )
    assert all(component.knownness is CostKnownness.UNKNOWN for component in non_fee)
    assert all(component.value is None for component in non_fee)
    assert stack.total_knownness is CostKnownness.UNKNOWN
    assert stack.total() is None


@pytest.mark.parametrize(
    ("scenario_id", "base_scenario_id", "expected_stack_version"),
    [
        (
            ACCOUNT_EFFECTIVE_SANITIZED,
            None,
            "fee1-n3-account-current-counterfactual-v1",
        ),
        (
            PUBLIC_REGULAR_NO_BNB,
            None,
            "fee1-n3-public-current-counterfactual-v1",
        ),
        (
            ADVERSE_PLUS_2_BPS_PER_SIDE_PER_FILL_LEG,
            ACCOUNT_EFFECTIVE_SANITIZED,
            "fee1-n3-adverse-account-plus-2bps-v1",
        ),
        (
            ADVERSE_PLUS_2_BPS_PER_SIDE_PER_FILL_LEG,
            PUBLIC_REGULAR_NO_BNB,
            "fee1-n3-adverse-public-plus-2bps-v1",
        ),
    ],
)
def test_basis_stack_version_is_derived_from_the_scenario_and_adverse_base(
    scenario_id: str,
    base_scenario_id: str | None,
    expected_stack_version: str,
) -> None:
    rows, account_routes = _complete_account_routes()
    inputs = convert_receipt_to_n3_inputs(_receipt(*rows), as_of_utc=AS_OF)
    routes = (
        account_routes
        if base_scenario_id is None
        else tuple(_route_with_base(row, base_scenario_id) for row in rows)
    )

    stack = project_basis_q08_cost_stack(
        inputs,
        scenario_id=scenario_id,
        routes=routes,
    )

    assert stack.stack_version == expected_stack_version


def test_basis_fee_becomes_unknown_when_any_exact_route_is_missing() -> None:
    rows, routes = _complete_account_routes()
    inputs = convert_receipt_to_n3_inputs(_receipt(*rows), as_of_utc=AS_OF)
    missing = FeeRouteAddressV1(
        venue=Venue.BINANCE_SPOT,
        symbol="BTCUSDT",
        role=Role.TAKER,
        side=Side.BUY,
        charge_basis=ChargeBasis.RECEIVED_ASSET_AMOUNT,
    )

    stack = project_basis_q08_cost_stack(
        inputs,
        scenario_id=ACCOUNT_EFFECTIVE_SANITIZED,
        routes=(missing, *routes[1:]),
    )

    fee = stack.component(CostKind.PER_LEG_FEE)
    assert fee.knownness is CostKnownness.UNKNOWN
    assert fee.value is None
    assert stack.total() is None


def test_volume_entry_exit_round_trip_sum_is_exact_and_consumer_labeled() -> None:
    entry = _spot(
        role=Role.MAKER,
        side=Side.BUY,
        standard="0.001",
        special="0.00001",
        tax="0.000001",
    )
    exit_ = _spot(
        role=Role.TAKER,
        side=Side.SELL,
        standard="0.0012",
        special="0.00002",
        tax="0.000002",
    )
    inputs = convert_receipt_to_n3_inputs(_receipt(entry, exit_), as_of_utc=AS_OF)

    projection = project_volume_fee_bps(
        inputs,
        scenario_id=ACCOUNT_EFFECTIVE_SANITIZED,
        entry_route=_route(entry),
        exit_route=_route(exit_),
    )

    assert projection["schema"] == "VolumeFeeProjectionV1"
    assert projection["consumer"] == "Volume"
    assert _ratio(projection["entryBps"]) == ExactRatioV1(
        numerator=761,
        denominator=100,
    )
    assert _ratio(projection["exitBps"]) == ExactRatioV1(
        numerator=461,
        denominator=50,
    )
    assert _ratio(projection["roundTripBps"]) == ExactRatioV1(
        numerator=1_683,
        denominator=100,
    )
    assert cast(dict[str, object], projection["entry"])["truthState"] == "KNOWN"
    assert cast(dict[str, object], projection["exit"])["truthState"] == "KNOWN"
    assert cast(dict[str, object], projection["roundTrip"])["truthState"] == "KNOWN"


def test_adverse_volume_preserves_shared_base_and_adds_exact_two_bps_per_fill() -> None:
    entry = _spot(
        role=Role.MAKER,
        side=Side.BUY,
        standard="0.001",
        special="0.00001",
        tax="0.000001",
    )
    exit_ = _spot(
        role=Role.TAKER,
        side=Side.SELL,
        standard="0.0012",
        special="0.00002",
        tax="0.000002",
    )
    inputs = convert_receipt_to_n3_inputs(_receipt(entry, exit_), as_of_utc=AS_OF)

    projection = project_volume_fee_bps(
        inputs,
        scenario_id=ADVERSE_PLUS_2_BPS_PER_SIDE_PER_FILL_LEG,
        entry_route=_route_with_base(entry, ACCOUNT_EFFECTIVE_SANITIZED),
        exit_route=_route_with_base(exit_, ACCOUNT_EFFECTIVE_SANITIZED),
    )

    assert projection["baseScenarioId"] == ACCOUNT_EFFECTIVE_SANITIZED
    assert _ratio(projection["entryBps"]) == ExactRatioV1(
        numerator=961,
        denominator=100,
    )
    assert _ratio(projection["exitBps"]) == ExactRatioV1(
        numerator=561,
        denominator=50,
    )
    assert _ratio(projection["roundTripBps"]) == ExactRatioV1(
        numerator=2_083,
        denominator=100,
    )


def test_adverse_volume_rejects_mixed_base_scenarios() -> None:
    entry = _spot(
        role=Role.MAKER,
        side=Side.BUY,
        standard="0.001",
        special="0",
        tax="0",
    )
    exit_ = _spot(
        role=Role.TAKER,
        side=Side.SELL,
        standard="0.001",
        special="0",
        tax="0",
    )
    inputs = convert_receipt_to_n3_inputs(_receipt(entry, exit_), as_of_utc=AS_OF)

    with pytest.raises(
        ContractValueError,
        match="adverse Volume routes must share one base scenario",
    ):
        project_volume_fee_bps(
            inputs,
            scenario_id=ADVERSE_PLUS_2_BPS_PER_SIDE_PER_FILL_LEG,
            entry_route=_route_with_base(entry, ACCOUNT_EFFECTIVE_SANITIZED),
            exit_route=_route_with_base(exit_, PUBLIC_REGULAR_NO_BNB),
        )


def test_unknown_adverse_projection_carries_base_rate_unknown_without_zero() -> None:
    entry_row = _unknown_spot(role=Role.TAKER, side=Side.BUY)
    exit_row = _unknown_spot(role=Role.MAKER, side=Side.SELL)
    inputs = convert_receipt_to_n3_inputs(_receipt(entry_row, exit_row), as_of_utc=AS_OF)

    projection = project_volume_fee_bps(
        inputs,
        scenario_id=ADVERSE_PLUS_2_BPS_PER_SIDE_PER_FILL_LEG,
        entry_route=_route_with_base(entry_row, ACCOUNT_EFFECTIVE_SANITIZED),
        exit_route=_route_with_base(exit_row, ACCOUNT_EFFECTIVE_SANITIZED),
    )

    entry = cast(dict[str, object], projection["entry"])
    assert projection["baseScenarioId"] == ACCOUNT_EFFECTIVE_SANITIZED
    assert projection["entryBps"] is None
    assert projection["exitBps"] is None
    assert projection["roundTripBps"] is None
    assert "BASE_RATE_UNKNOWN" in cast(list[str], entry["reasonCodes"])


def test_s1_usdm_projection_uses_only_rate_and_fee_burn_provenance() -> None:
    row = _usdm(role=Role.MAKER, standard="0.0002")
    receipt = FeeTruthReceiptV1(
        schema=FEE_TRUTH_SCHEMA,
        version=FEE_TRUTH_VERSION,
        sanitization_policy_id=SANITIZATION_POLICY_ID,
        provenance=ReceiptProvenanceV1(
            capture_kind=OWNER_SUPPLIED_CAPTURE_KIND,
            observed_at_utc="2026-07-28T12:00:00Z",
            valid_until_utc="2026-07-28T13:00:00Z",
            temporal_scope=CURRENT_POINT_IN_TIME,
            sources=(
                ProvenanceSource.BINANCE_USDM_ACCOUNT_COMMISSION_SCHEMA,
                ProvenanceSource.BINANCE_USDM_FEE_BURN_STATUS_SCHEMA,
            ),
        ),
        rows=(row,),
    )
    inputs = convert_receipt_to_n3_inputs(receipt, as_of_utc=AS_OF)

    projection = project_s1_fee_bps(
        inputs,
        scenario_id=ACCOUNT_EFFECTIVE_SANITIZED,
        entry_route=_route(row),
        exit_route=_route(row),
    )

    assert projection["schema"] == "S1FeeProjectionV1"
    assert projection["consumer"] == "S-1"
    assert cast(dict[str, object], inputs["provenance"])["sources"] == [
        "BINANCE_USDM_ACCOUNT_COMMISSION_SCHEMA",
        "BINANCE_USDM_FEE_BURN_STATUS_SCHEMA",
    ]
    assert _ratio(projection["entryBps"]) == ExactRatioV1(numerator=2, denominator=1)
    assert _ratio(projection["exitBps"]) == ExactRatioV1(numerator=2, denominator=1)
    assert _ratio(projection["roundTripBps"]) == ExactRatioV1(
        numerator=4,
        denominator=1,
    )


def test_swapped_spot_and_usdm_not_applied_fee_assets_are_rejected() -> None:
    spot = _public_spot(role=Role.TAKER, side=Side.BUY, standard="0.001")
    spot_inputs = convert_receipt_to_n3_inputs(_receipt(spot), as_of_utc=AS_OF)
    spot_row = cast(
        list[dict[str, object]],
        _scenario_mapping(spot_inputs, PUBLIC_REGULAR_NO_BNB)["rateRows"],
    )[0]
    cast(dict[str, object], spot_row["components"])["feeAsset"] = FeeAsset.SETTLEMENT_ASSET.value

    with pytest.raises(ContractValueError, match="N-3 fee input rejected"):
        project_volume_fee_bps(
            spot_inputs,
            scenario_id=PUBLIC_REGULAR_NO_BNB,
            entry_route=_route(spot),
            exit_route=_route(spot),
        )

    usdm = _usdm(role=Role.MAKER, standard="0.0002")
    usdm_inputs = convert_receipt_to_n3_inputs(_receipt(usdm), as_of_utc=AS_OF)
    usdm_row = cast(
        list[dict[str, object]],
        _scenario_mapping(usdm_inputs, ACCOUNT_EFFECTIVE_SANITIZED)["rateRows"],
    )[0]
    cast(dict[str, object], usdm_row["components"])["feeAsset"] = FeeAsset.RECEIVED_ASSET.value

    with pytest.raises(ContractValueError, match="N-3 fee input rejected"):
        project_s1_fee_bps(
            usdm_inputs,
            scenario_id=ACCOUNT_EFFECTIVE_SANITIZED,
            entry_route=_route(usdm),
            exit_route=_route(usdm),
        )


def test_volume_missing_row_and_mixed_sum_remain_unknown_not_zero() -> None:
    entry = _spot(
        role=Role.MAKER,
        side=Side.BUY,
        standard="0.001",
        special="0.00001",
        tax="0.000001",
    )
    inputs = convert_receipt_to_n3_inputs(_receipt(entry), as_of_utc=AS_OF)
    missing_exit = FeeRouteAddressV1(
        venue=Venue.BINANCE_SPOT,
        symbol="BTCUSDT",
        role=Role.TAKER,
        side=Side.SELL,
        charge_basis=ChargeBasis.RECEIVED_ASSET_AMOUNT,
    )

    projection = project_volume_fee_bps(
        inputs,
        scenario_id=ACCOUNT_EFFECTIVE_SANITIZED,
        entry_route=_route(entry),
        exit_route=missing_exit,
    )

    assert projection["entryBps"] is not None
    assert projection["exitBps"] is None
    assert projection["roundTripBps"] is None
    assert cast(dict[str, object], projection["exit"])["truthState"] == "UNKNOWN"
    assert cast(dict[str, object], projection["roundTrip"])["truthState"] == "UNKNOWN"


def test_volume_sensitivity_stays_out_of_primary_bps() -> None:
    entry = _spot(
        role=Role.MAKER,
        side=Side.BUY,
        standard="0.001",
        special="0",
        tax="0",
        truth_state=TruthState.SENSITIVITY_ONLY,
    )
    exit_ = _spot(
        role=Role.TAKER,
        side=Side.SELL,
        standard="0.0012",
        special="0",
        tax="0",
        truth_state=TruthState.SENSITIVITY_ONLY,
    )
    inputs = convert_receipt_to_n3_inputs(_receipt(entry, exit_), as_of_utc=AS_OF)

    projection = project_volume_fee_bps(
        inputs,
        scenario_id=BNB_OR_PROMOTION_SENSITIVITY_ONLY,
        entry_route=_route(entry),
        exit_route=_route(exit_),
    )

    assert projection["entryBps"] is None
    assert projection["exitBps"] is None
    assert projection["roundTripBps"] is None
    entry_mapping = cast(dict[str, object], projection["entry"])
    exit_mapping = cast(dict[str, object], projection["exit"])
    round_trip = cast(dict[str, object], projection["roundTrip"])
    assert entry_mapping["truthState"] == "SENSITIVITY_ONLY"
    assert exit_mapping["truthState"] == "SENSITIVITY_ONLY"
    assert round_trip["truthState"] == "SENSITIVITY_ONLY"
    assert entry_mapping["sensitivityBps"] is not None
    assert exit_mapping["sensitivityBps"] is not None
    assert round_trip["sensitivityBps"] is not None


def test_s1_spot_projection_has_distinct_schema_and_consumer_label() -> None:
    entry = _spot(
        role=Role.MAKER,
        side=Side.BUY,
        standard="0.001",
        special="0",
        tax="0",
    )
    exit_ = _spot(
        role=Role.TAKER,
        side=Side.SELL,
        standard="0.001",
        special="0",
        tax="0",
    )
    inputs = convert_receipt_to_n3_inputs(_receipt(entry, exit_), as_of_utc=AS_OF)

    projection = project_s1_fee_bps(
        inputs,
        scenario_id=ACCOUNT_EFFECTIVE_SANITIZED,
        entry_route=_route(entry),
        exit_route=_route(exit_),
    )

    assert projection["schema"] == "S1FeeProjectionV1"
    assert projection["consumer"] == "S-1"
    assert _ratio(projection["roundTripBps"]) == ExactRatioV1(
        numerator=15,
        denominator=1,
    )


@pytest.mark.parametrize(
    "symbol",
    [
        "",
        "btcusdt",
        "BTC-USDT",
        "BTC",
        "A" * 25,
        "12345",
    ],
)
def test_fee_route_rejects_noncanonical_symbols(symbol: str) -> None:
    with pytest.raises(ContractValueError, match="symbol must be canonical"):
        FeeRouteAddressV1(
            venue=Venue.BINANCE_SPOT,
            symbol=symbol,
            role=Role.TAKER,
            side=Side.BUY,
            charge_basis=ChargeBasis.RECEIVED_ASSET_AMOUNT,
        )
