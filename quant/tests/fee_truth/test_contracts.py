from __future__ import annotations

from dataclasses import replace

import pytest

from quant_edge.errors import ContractValueError
from quant_edge.fee_truth import (
    CURRENT_POINT_IN_TIME,
    FEE_TRUTH_SCHEMA,
    FEE_TRUTH_VERSION,
    MAX_RECEIPT_ROWS,
    MAX_RECEIPT_VALIDITY_SECONDS,
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
    RateState,
    ReceiptProvenanceV1,
    Role,
    Side,
    SourceFieldRef,
    TruthState,
    Venue,
    scenario_id_for,
)
from quant_edge.labels.rational import make_ratio

pytestmark = pytest.mark.contract


def _known(decimal: str = "0.001") -> KnownOrUnknownRateV1:
    return KnownOrUnknownRateV1.known(decimal)


def _unknown() -> KnownOrUnknownRateV1:
    return KnownOrUnknownRateV1.unknown()


def _not_applicable() -> KnownOrUnknownRateV1:
    return KnownOrUnknownRateV1.not_applicable()


def _unknown_discount() -> DiscountTruthV1:
    return DiscountTruthV1(
        application=DiscountApplication.UNKNOWN,
        standard_payable_multiplier=_unknown(),
        fee_asset=FeeAsset.UNKNOWN,
    )


def _applied_bnb_discount() -> DiscountTruthV1:
    return DiscountTruthV1(
        application=DiscountApplication.APPLIED_TO_STANDARD_ONLY,
        standard_payable_multiplier=_known("0.75"),
        fee_asset=FeeAsset.BNB,
    )


def _no_spot_discount() -> DiscountTruthV1:
    return DiscountTruthV1(
        application=DiscountApplication.NOT_APPLIED,
        standard_payable_multiplier=_known("1"),
        fee_asset=FeeAsset.RECEIVED_ASSET,
    )


def _no_usdm_discount() -> DiscountTruthV1:
    return DiscountTruthV1(
        application=DiscountApplication.NOT_APPLIED,
        standard_payable_multiplier=_known("1"),
        fee_asset=FeeAsset.SETTLEMENT_ASSET,
    )


def _spot_public(
    *,
    symbol: str = "BTCUSDT",
    role: Role = Role.MAKER,
    side: Side = Side.BUY,
    truth_state: TruthState = TruthState.PUBLIC_SCHEDULE,
    standard: KnownOrUnknownRateV1 | None = None,
    special: KnownOrUnknownRateV1 | None = None,
    tax: KnownOrUnknownRateV1 | None = None,
    discount: DiscountTruthV1 | None = None,
    source_field_refs: tuple[SourceFieldRef, ...] | None = None,
    charge_basis: ChargeBasis = ChargeBasis.RECEIVED_ASSET_AMOUNT,
) -> FeeScenarioV1:
    if source_field_refs is None:
        source_field_refs = (
            SourceFieldRef.SPOT_FEE_SCHEDULE_MAKER
            if role is Role.MAKER
            else SourceFieldRef.SPOT_FEE_SCHEDULE_TAKER,
        )
    return FeeScenarioV1(
        scenario_id=scenario_id_for(
            truth_state=truth_state,
            venue=Venue.BINANCE_SPOT,
            symbol=symbol,
            role=role,
            side=side,
        ),
        truth_state=truth_state,
        venue=Venue.BINANCE_SPOT,
        symbol=symbol,
        role=role,
        side=side,
        charge_basis=charge_basis,
        standard=_known() if standard is None else standard,
        special=_unknown() if special is None else special,
        tax=_unknown() if tax is None else tax,
        discount=_no_spot_discount() if discount is None else discount,
        source_field_refs=source_field_refs,
    )


def _usdm_public(
    *,
    symbol: str = "BTCUSDT",
    role: Role = Role.MAKER,
    side: Side = Side.BOTH,
    standard: KnownOrUnknownRateV1 | None = None,
    special: KnownOrUnknownRateV1 | None = None,
    tax: KnownOrUnknownRateV1 | None = None,
    discount: DiscountTruthV1 | None = None,
    charge_basis: ChargeBasis = ChargeBasis.USDM_QUOTE_NOTIONAL,
) -> FeeScenarioV1:
    field_ref = (
        SourceFieldRef.USDM_FEE_SCHEDULE_MAKER
        if role is Role.MAKER
        else SourceFieldRef.USDM_FEE_SCHEDULE_TAKER
    )
    return FeeScenarioV1(
        scenario_id=scenario_id_for(
            truth_state=TruthState.PUBLIC_SCHEDULE,
            venue=Venue.BINANCE_USDM,
            symbol=symbol,
            role=role,
            side=side,
        ),
        truth_state=TruthState.PUBLIC_SCHEDULE,
        venue=Venue.BINANCE_USDM,
        symbol=symbol,
        role=role,
        side=side,
        charge_basis=charge_basis,
        standard=_known("0.0004") if standard is None else standard,
        special=_not_applicable() if special is None else special,
        tax=_not_applicable() if tax is None else tax,
        discount=_no_usdm_discount() if discount is None else discount,
        source_field_refs=(field_ref,),
    )


def _provenance(
    *,
    observed_at_utc: str = "2026-07-28T00:00:00Z",
    valid_until_utc: str = "2026-07-28T01:00:00Z",
    sources: tuple[ProvenanceSource, ...] = (ProvenanceSource.BINANCE_SPOT_FEE_SCHEDULE,),
) -> ReceiptProvenanceV1:
    return ReceiptProvenanceV1(
        capture_kind=OWNER_SUPPLIED_CAPTURE_KIND,
        observed_at_utc=observed_at_utc,
        valid_until_utc=valid_until_utc,
        temporal_scope=CURRENT_POINT_IN_TIME,
        sources=sources,
    )


def _receipt(
    rows: tuple[FeeScenarioV1, ...],
    *,
    provenance: ReceiptProvenanceV1 | None = None,
) -> FeeTruthReceiptV1:
    return FeeTruthReceiptV1(
        schema=FEE_TRUTH_SCHEMA,
        version=FEE_TRUTH_VERSION,
        sanitization_policy_id=SANITIZATION_POLICY_ID,
        provenance=_provenance() if provenance is None else provenance,
        rows=rows,
    )


def _contains_float(value: object) -> bool:
    if isinstance(value, float):
        return True
    if isinstance(value, list):
        return any(_contains_float(item) for item in value)
    if isinstance(value, dict):
        return any(_contains_float(item) for item in value.values())
    return False


def test_known_rate_preserves_plain_decimal_and_exact_reduced_ratio() -> None:
    rate = _known("0.00025000")

    assert rate.decimal == "0.00025000"
    assert rate.ratio == make_ratio(1, 4_000)
    assert rate.as_mapping() == {"decimal": "0.00025000", "state": "KNOWN"}
    assert not _contains_float(rate.as_mapping())


def test_negative_commission_rate_round_trips_without_float_or_sign_loss() -> None:
    rate = _known("-0.00025000")

    assert rate.decimal == "-0.00025000"
    assert rate.ratio == make_ratio(-1, 4_000)
    assert rate.as_mapping() == {"decimal": "-0.00025000", "state": "KNOWN"}
    assert _known("-1").ratio == make_ratio(-1, 1)
    assert _known("-1.000000000000000000").ratio == make_ratio(-1, 1)
    assert not _contains_float(rate.as_mapping())


@pytest.mark.parametrize(
    "value",
    [
        "",
        "+0.001",
        ".001",
        "00.1",
        "01",
        "0.",
        "1e-3",
        "1E-3",
        "0.1%",
        "0,001",
        "0.0000000000000000001",
        "1.0000000000000000000",
        "1.000000000000000001",
        "1.1",
        "-1.000000000000000001",
        "-1.1",
    ],
)
def test_known_rate_rejects_noncanonical_or_out_of_range_decimal(value: str) -> None:
    with pytest.raises(ContractValueError):
        KnownOrUnknownRateV1.known(value)


@pytest.mark.parametrize("value", ["-0", "-0.0", "-0.000000000000000000"])
def test_known_rate_rejects_every_negative_zero_spelling(value: str) -> None:
    with pytest.raises(ContractValueError):
        KnownOrUnknownRateV1.known(value)


@pytest.mark.parametrize("value", [0, 1, 0.001, -0.001, True, None])
def test_known_rate_rejects_non_string_json_number_types(value: object) -> None:
    with pytest.raises(ContractValueError):
        KnownOrUnknownRateV1.known(value)  # type: ignore[arg-type]


def test_known_zero_unknown_and_not_applicable_are_three_distinct_states() -> None:
    known_zero = _known("0")
    unknown = _unknown()
    not_applicable = _not_applicable()

    assert known_zero.as_mapping() == {"decimal": "0", "state": "KNOWN"}
    assert known_zero.ratio == make_ratio(0, 1)
    assert unknown.as_mapping() == {"decimal": None, "state": "UNKNOWN"}
    assert not_applicable.as_mapping() == {
        "decimal": None,
        "state": "NOT_APPLICABLE",
    }
    assert unknown.ratio is None
    assert not_applicable.ratio is None


def test_null_law_rejects_values_on_unknown_or_not_applicable() -> None:
    with pytest.raises(ContractValueError):
        KnownOrUnknownRateV1(
            state=RateState.UNKNOWN,
            decimal="0",
            ratio=None,
        )
    with pytest.raises(ContractValueError):
        KnownOrUnknownRateV1(
            state=RateState.NOT_APPLICABLE,
            decimal="0",
            ratio=None,
        )
    with pytest.raises(ContractValueError):
        KnownOrUnknownRateV1(
            state=RateState.KNOWN,
            decimal=None,
            ratio=None,
        )


def test_discount_multiplier_is_explicit_and_applies_to_standard_only() -> None:
    applied = DiscountTruthV1(
        application=DiscountApplication.APPLIED_TO_STANDARD_ONLY,
        standard_payable_multiplier=_known("0.75"),
        fee_asset=FeeAsset.BNB,
    )

    assert applied.as_mapping() == {
        "application": "APPLIED_TO_STANDARD_ONLY",
        "feeAsset": "BNB",
        "standardPayableMultiplier": {"decimal": "0.75", "state": "KNOWN"},
    }
    assert _no_spot_discount().standard_payable_multiplier.ratio == make_ratio(1, 1)
    assert _unknown_discount().standard_payable_multiplier.ratio is None


def test_discount_multiplier_rules_fail_closed() -> None:
    with pytest.raises(ContractValueError):
        DiscountTruthV1(
            application=DiscountApplication.APPLIED_TO_STANDARD_ONLY,
            standard_payable_multiplier=_known("-0.25"),
            fee_asset=FeeAsset.BNB,
        )
    with pytest.raises(ContractValueError):
        DiscountTruthV1(
            application=DiscountApplication.APPLIED_TO_STANDARD_ONLY,
            standard_payable_multiplier=_known("1"),
            fee_asset=FeeAsset.BNB,
        )
    with pytest.raises(ContractValueError):
        DiscountTruthV1(
            application=DiscountApplication.APPLIED_TO_STANDARD_ONLY,
            standard_payable_multiplier=_known("0.75"),
            fee_asset=FeeAsset.RECEIVED_ASSET,
        )
    with pytest.raises(ContractValueError):
        DiscountTruthV1(
            application=DiscountApplication.NOT_APPLIED,
            standard_payable_multiplier=_known("0.75"),
            fee_asset=FeeAsset.RECEIVED_ASSET,
        )
    with pytest.raises(ContractValueError):
        DiscountTruthV1(
            application=DiscountApplication.UNKNOWN,
            standard_payable_multiplier=_known("1"),
            fee_asset=FeeAsset.UNKNOWN,
        )
    with pytest.raises(ContractValueError):
        DiscountTruthV1(
            application=DiscountApplication.UNKNOWN,
            standard_payable_multiplier=_unknown(),
            fee_asset=FeeAsset.BNB,
        )


def test_public_spot_and_usdm_scenarios_encode_distinct_venue_laws() -> None:
    spot = _spot_public()
    usdm = _usdm_public()

    assert spot.side is Side.BUY
    assert spot.charge_basis is ChargeBasis.RECEIVED_ASSET_AMOUNT
    assert spot.special.state is RateState.UNKNOWN
    assert usdm.side is Side.BOTH
    assert usdm.charge_basis is ChargeBasis.USDM_QUOTE_NOTIONAL
    assert usdm.special.state is RateState.NOT_APPLICABLE
    assert usdm.tax.state is RateState.NOT_APPLICABLE


def test_venue_role_side_and_charge_basis_laws_reject_invalid_combinations() -> None:
    with pytest.raises(ContractValueError):
        _spot_public(role=Role.RPI)
    with pytest.raises(ContractValueError):
        _spot_public(charge_basis=ChargeBasis.USDM_QUOTE_NOTIONAL)
    with pytest.raises(ContractValueError):
        _usdm_public(charge_basis=ChargeBasis.RECEIVED_ASSET_AMOUNT)
    with pytest.raises(ContractValueError):
        _usdm_public(special=_known("0"))
    with pytest.raises(ContractValueError):
        _usdm_public(tax=_unknown())


@pytest.mark.parametrize("truth_state", list(TruthState))
def test_every_spot_truth_state_rejects_side_both(truth_state: TruthState) -> None:
    with pytest.raises(ContractValueError):
        _spot_public(side=Side.BOTH, truth_state=truth_state)


@pytest.mark.parametrize("side", [Side.BUY, Side.SELL])
def test_usdm_requires_side_both(side: Side) -> None:
    with pytest.raises(ContractValueError):
        _usdm_public(side=side)


def test_public_schedule_rejects_bnb_discount_but_sensitivity_allows_it() -> None:
    discount_refs = (
        SourceFieldRef.SPOT_BNB_DISCOUNT_STANDARD_PAYABLE_MULTIPLIER,
        SourceFieldRef.SPOT_FEE_SCHEDULE_MAKER,
    )

    with pytest.raises(ContractValueError):
        _spot_public(
            truth_state=TruthState.PUBLIC_SCHEDULE,
            discount=_applied_bnb_discount(),
            source_field_refs=discount_refs,
        )

    sensitivity = _spot_public(
        truth_state=TruthState.SENSITIVITY_ONLY,
        discount=_applied_bnb_discount(),
        source_field_refs=discount_refs,
    )
    assert sensitivity.truth_state is TruthState.SENSITIVITY_ONLY
    assert sensitivity.discount.application is DiscountApplication.APPLIED_TO_STANDARD_ONLY


def test_not_applicable_is_lawful_only_for_unpublished_usdm_components() -> None:
    assert _usdm_public().special.state is RateState.NOT_APPLICABLE
    with pytest.raises(ContractValueError):
        _spot_public(special=_not_applicable())
    with pytest.raises(ContractValueError):
        _spot_public(tax=_not_applicable())
    with pytest.raises(ContractValueError):
        _usdm_public(standard=_not_applicable())


def test_unknown_scenario_carries_no_numeric_or_discount_truth() -> None:
    unknown = FeeScenarioV1(
        scenario_id=scenario_id_for(
            truth_state=TruthState.UNKNOWN,
            venue=Venue.BINANCE_SPOT,
            symbol="BTCUSDT",
            role=Role.MAKER,
            side=Side.BUY,
        ),
        truth_state=TruthState.UNKNOWN,
        venue=Venue.BINANCE_SPOT,
        symbol="BTCUSDT",
        role=Role.MAKER,
        side=Side.BUY,
        charge_basis=ChargeBasis.RECEIVED_ASSET_AMOUNT,
        standard=_unknown(),
        special=_unknown(),
        tax=_unknown(),
        discount=_unknown_discount(),
        source_field_refs=(),
    )

    assert unknown.truth_state is TruthState.UNKNOWN
    assert unknown.standard.decimal is None
    assert unknown.discount.standard_payable_multiplier.decimal is None
    with pytest.raises(ContractValueError):
        replace(unknown, standard=_known("0"))
    with pytest.raises(ContractValueError):
        replace(unknown, discount=_no_spot_discount())
    with pytest.raises(ContractValueError):
        _spot_public(standard=_unknown())


def test_scenario_dimensions_and_semantic_source_references_are_derived() -> None:
    row = _spot_public()
    assert row.scenario_id == "fee1.public_schedule.binance_spot.btcusdt.maker.buy"

    with pytest.raises(ContractValueError):
        replace(
            row,
            scenario_id="fee1.public_schedule.binance_spot.btcusdt.taker.buy",
        )
    with pytest.raises(ContractValueError):
        _spot_public(source_field_refs=(SourceFieldRef.SPOT_FEE_SCHEDULE_TAKER,))
    with pytest.raises(ContractValueError):
        _spot_public(source_field_refs=())
    with pytest.raises(ContractValueError):
        _spot_public(source_field_refs=(SourceFieldRef.USDM_FEE_SCHEDULE_MAKER,))


def test_source_references_are_sorted_and_unique() -> None:
    with pytest.raises(ContractValueError):
        _spot_public(
            source_field_refs=(
                SourceFieldRef.SPOT_FEE_SCHEDULE_TAKER,
                SourceFieldRef.SPOT_FEE_SCHEDULE_MAKER,
            )
        )
    with pytest.raises(ContractValueError):
        _spot_public(
            source_field_refs=(
                SourceFieldRef.SPOT_FEE_SCHEDULE_MAKER,
                SourceFieldRef.SPOT_FEE_SCHEDULE_MAKER,
            )
        )


def test_provenance_time_window_is_exact_and_strictly_forward() -> None:
    one_second = _provenance(
        observed_at_utc="2026-07-28T00:00:00Z",
        valid_until_utc="2026-07-28T00:00:01Z",
    )

    assert one_second.valid_until_epoch_s - one_second.observed_at_epoch_s == 1
    one_hour = _provenance(valid_until_utc="2026-07-28T01:00:00Z")
    assert (
        one_hour.valid_until_epoch_s - one_hour.observed_at_epoch_s == MAX_RECEIPT_VALIDITY_SECONDS
    )
    with pytest.raises(ContractValueError):
        _provenance(valid_until_utc="2026-07-28T00:00:00Z")
    with pytest.raises(ContractValueError):
        _provenance(valid_until_utc="2026-07-27T23:59:59Z")
    with pytest.raises(ContractValueError):
        _provenance(valid_until_utc="2026-07-28T01:00:01Z")


@pytest.mark.parametrize(
    "timestamp",
    [
        "2026-07-28T00:00:00+00:00",
        "2026-07-28T00:00:00.000Z",
        "2026-7-28T00:00:00Z",
        "2026-02-30T00:00:00Z",
        "2026-07-28 00:00:00Z",
        "2026-07-28T24:00:00Z",
    ],
)
def test_provenance_rejects_noncanonical_or_invalid_time(timestamp: str) -> None:
    with pytest.raises(ContractValueError):
        _provenance(observed_at_utc=timestamp)


def test_provenance_sources_are_nonempty_sorted_and_unique() -> None:
    with pytest.raises(ContractValueError):
        _provenance(sources=())
    with pytest.raises(ContractValueError):
        _provenance(
            sources=(
                ProvenanceSource.BINANCE_USDM_FEE_SCHEDULE,
                ProvenanceSource.BINANCE_SPOT_FEE_SCHEDULE,
            )
        )
    with pytest.raises(ContractValueError):
        _provenance(
            sources=(
                ProvenanceSource.BINANCE_SPOT_FEE_SCHEDULE,
                ProvenanceSource.BINANCE_SPOT_FEE_SCHEDULE,
            )
        )


def test_receipt_rows_are_nonempty_bounded_sorted_and_unique() -> None:
    btc = _spot_public(symbol="BTCUSDT")
    eth = _spot_public(symbol="ETHUSDT")

    assert _receipt((btc, eth)).rows == (btc, eth)
    with pytest.raises(ContractValueError):
        _receipt(())
    with pytest.raises(ContractValueError):
        _receipt((eth, btc))
    with pytest.raises(ContractValueError):
        _receipt((btc, btc))
    with pytest.raises(ContractValueError):
        _receipt(tuple(btc for _ in range(MAX_RECEIPT_ROWS + 1)))


def test_receipt_requires_provenance_for_every_typed_source_reference() -> None:
    with pytest.raises(ContractValueError):
        _receipt(
            (_spot_public(),),
            provenance=_provenance(sources=(ProvenanceSource.BINANCE_USDM_FEE_SCHEDULE,)),
        )


def test_usdm_fee_burn_status_requires_dedicated_schema_provenance() -> None:
    row = FeeScenarioV1(
        scenario_id=scenario_id_for(
            truth_state=TruthState.CURRENT_ACCOUNT_RATE,
            venue=Venue.BINANCE_USDM,
            symbol="BTCUSDT",
            role=Role.TAKER,
            side=Side.BOTH,
        ),
        truth_state=TruthState.CURRENT_ACCOUNT_RATE,
        venue=Venue.BINANCE_USDM,
        symbol="BTCUSDT",
        role=Role.TAKER,
        side=Side.BOTH,
        charge_basis=ChargeBasis.USDM_QUOTE_NOTIONAL,
        standard=_known("0.0004"),
        special=_not_applicable(),
        tax=_not_applicable(),
        discount=_applied_bnb_discount(),
        source_field_refs=(
            SourceFieldRef.USDM_ACCOUNT_TAKER_COMMISSION_RATE,
            SourceFieldRef.USDM_BNB_DISCOUNT_STANDARD_PAYABLE_MULTIPLIER,
            SourceFieldRef.USDM_BNB_DISCOUNT_STATUS,
        ),
    )
    incomplete = _provenance(
        sources=(
            ProvenanceSource.BINANCE_BNB_DISCOUNT_TERMS,
            ProvenanceSource.BINANCE_USDM_ACCOUNT_COMMISSION_SCHEMA,
        )
    )

    with pytest.raises(ContractValueError):
        _receipt((row,), provenance=incomplete)

    complete = _receipt(
        (row,),
        provenance=_provenance(
            sources=(
                ProvenanceSource.BINANCE_BNB_DISCOUNT_TERMS,
                ProvenanceSource.BINANCE_USDM_ACCOUNT_COMMISSION_SCHEMA,
                ProvenanceSource.BINANCE_USDM_FEE_BURN_STATUS_SCHEMA,
            )
        ),
    )
    assert ProvenanceSource.BINANCE_USDM_FEE_BURN_STATUS_SCHEMA in complete.provenance.sources


def test_typed_mapping_is_deterministic_sorted_and_float_free() -> None:
    spot = _spot_public()
    usdm = _usdm_public()
    receipt = _receipt(
        (spot, usdm),
        provenance=_provenance(
            sources=(
                ProvenanceSource.BINANCE_SPOT_FEE_SCHEDULE,
                ProvenanceSource.BINANCE_USDM_FEE_SCHEDULE,
            )
        ),
    )

    first = receipt.as_mapping()
    second = receipt.as_mapping()
    assert first == second
    assert not _contains_float(first)
    assert first["schema"] == "FEE_TRUTH_RECEIPT"
    assert first["version"] == 1
    rows = first["rows"]
    assert isinstance(rows, list)
    assert [row["scenarioId"] for row in rows if isinstance(row, dict)] == [
        "fee1.public_schedule.binance_spot.btcusdt.maker.buy",
        "fee1.public_schedule.binance_usdm.btcusdt.maker.both",
    ]
