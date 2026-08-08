from __future__ import annotations

import copy
import hashlib
from collections.abc import Callable
from pathlib import Path
from typing import cast

import pytest

from quant_edge.canonical import canonical_json_bytes
from quant_edge.errors import ContractValueError
from quant_edge.fee_truth import (
    CURRENT_POINT_IN_TIME,
    FEE_TRUTH_SCHEMA,
    FEE_TRUTH_VERSION,
    MAX_RECEIPT_VALIDITY_SECONDS,
    OWNER_SUPPLIED_CAPTURE_KIND,
    SANITIZATION_POLICY_ID,
    ChargeBasis,
    DiscountApplication,
    DiscountTruthV1,
    FeeAsset,
    FeeReceiptError,
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
    parse_receipt_bytes,
    scenario_id_for,
)
from quant_edge.fee_truth.conversion import (
    ACCOUNT_EFFECTIVE_SANITIZED,
    ADVERSE_PLUS_2_BPS_PER_SIDE_PER_FILL_LEG,
    PUBLIC_REGULAR_NO_BNB,
    canonical_n3_fee_inputs_bytes,
    convert_receipt_to_n3_inputs,
)
from quant_edge.fee_truth.projections import (
    FeeRouteAddressV1,
    project_basis_q08_cost_stack,
    project_s1_fee_bps,
    project_volume_fee_bps,
)

SENTINEL = "FEE1_REJECTED_PRIVATE_SENTINEL_7e4c"
EXPECTED_SYMBOLS = frozenset({"BTCUSDT"})
AS_OF = "2026-07-28T12:30:00Z"

FORBIDDEN_FIELDS = (
    "rawApiKey",
    "apiSecret",
    "secret",
    "accessToken",
    "token",
    "password",
    "accountId",
    "subaccountId",
    "userId",
    "email",
    "phone",
    "address",
    "IBAN",
    "cardNumber",
    "payment",
    "paymentId",
)

OBJECT_PATHS: tuple[tuple[str | int, ...], ...] = (
    (),
    ("provenance",),
    ("rows", 0),
    ("rows", 0, "standard"),
    ("rows", 0, "special"),
    ("rows", 0, "tax"),
    ("rows", 0, "discount"),
    ("rows", 0, "discount", "standardPayableMultiplier"),
)


def _valid_receipt() -> FeeTruthReceiptV1:
    row = FeeScenarioV1(
        scenario_id=scenario_id_for(
            truth_state=TruthState.CURRENT_ACCOUNT_RATE,
            venue=Venue.BINANCE_SPOT,
            symbol="BTCUSDT",
            role=Role.TAKER,
            side=Side.BUY,
        ),
        truth_state=TruthState.CURRENT_ACCOUNT_RATE,
        venue=Venue.BINANCE_SPOT,
        symbol="BTCUSDT",
        role=Role.TAKER,
        side=Side.BUY,
        charge_basis=ChargeBasis.RECEIVED_ASSET_AMOUNT,
        standard=KnownOrUnknownRateV1.known("0.001"),
        special=KnownOrUnknownRateV1.known("0"),
        tax=KnownOrUnknownRateV1.known("0"),
        discount=DiscountTruthV1(
            application=DiscountApplication.APPLIED_TO_STANDARD_ONLY,
            standard_payable_multiplier=KnownOrUnknownRateV1.known("0.75"),
            fee_asset=FeeAsset.BNB,
        ),
        source_field_refs=(
            SourceFieldRef.SPOT_ACCOUNT_DISCOUNT_ASSET,
            SourceFieldRef.SPOT_ACCOUNT_DISCOUNT_ENABLED_FOR_ACCOUNT,
            SourceFieldRef.SPOT_ACCOUNT_DISCOUNT_ENABLED_FOR_SYMBOL,
            SourceFieldRef.SPOT_ACCOUNT_DISCOUNT_MULTIPLIER,
            SourceFieldRef.SPOT_ACCOUNT_SPECIAL_BUYER,
            SourceFieldRef.SPOT_ACCOUNT_SPECIAL_TAKER,
            SourceFieldRef.SPOT_ACCOUNT_STANDARD_BUYER,
            SourceFieldRef.SPOT_ACCOUNT_STANDARD_TAKER,
            SourceFieldRef.SPOT_ACCOUNT_TAX_BUYER,
            SourceFieldRef.SPOT_ACCOUNT_TAX_TAKER,
        ),
    )
    return FeeTruthReceiptV1(
        schema=FEE_TRUTH_SCHEMA,
        version=FEE_TRUTH_VERSION,
        sanitization_policy_id=SANITIZATION_POLICY_ID,
        provenance=ReceiptProvenanceV1(
            capture_kind=OWNER_SUPPLIED_CAPTURE_KIND,
            observed_at_utc="2026-07-28T12:00:00Z",
            valid_until_utc="2026-07-28T13:00:00Z",
            temporal_scope=CURRENT_POINT_IN_TIME,
            sources=(ProvenanceSource.BINANCE_SPOT_ACCOUNT_COMMISSION_SCHEMA,),
        ),
        rows=(row,),
    )


def _route_address(
    *,
    venue: Venue,
    side: Side,
    symbol: str = "BTCUSDT",
    role: Role = Role.TAKER,
) -> FeeRouteAddressV1:
    return FeeRouteAddressV1(
        venue=venue,
        symbol=symbol,
        role=role,
        side=side,
        charge_basis=(
            ChargeBasis.RECEIVED_ASSET_AMOUNT
            if venue is Venue.BINANCE_SPOT
            else ChargeBasis.USDM_QUOTE_NOTIONAL
        ),
    )


def _unknown_receipt() -> FeeTruthReceiptV1:
    row = FeeScenarioV1(
        scenario_id=scenario_id_for(
            truth_state=TruthState.UNKNOWN,
            venue=Venue.BINANCE_SPOT,
            symbol="BTCUSDT",
            role=Role.TAKER,
            side=Side.BUY,
        ),
        truth_state=TruthState.UNKNOWN,
        venue=Venue.BINANCE_SPOT,
        symbol="BTCUSDT",
        role=Role.TAKER,
        side=Side.BUY,
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
    return FeeTruthReceiptV1(
        schema=FEE_TRUTH_SCHEMA,
        version=FEE_TRUTH_VERSION,
        sanitization_policy_id=SANITIZATION_POLICY_ID,
        provenance=ReceiptProvenanceV1(
            capture_kind=OWNER_SUPPLIED_CAPTURE_KIND,
            observed_at_utc="2026-07-28T12:00:00Z",
            valid_until_utc="2026-07-28T13:00:00Z",
            temporal_scope=CURRENT_POINT_IN_TIME,
            sources=(ProvenanceSource.BINANCE_SPOT_ACCOUNT_COMMISSION_SCHEMA,),
        ),
        rows=(row,),
    )


def _public_receipt() -> FeeTruthReceiptV1:
    row = FeeScenarioV1(
        scenario_id=scenario_id_for(
            truth_state=TruthState.PUBLIC_SCHEDULE,
            venue=Venue.BINANCE_SPOT,
            symbol="BTCUSDT",
            role=Role.TAKER,
            side=Side.BUY,
        ),
        truth_state=TruthState.PUBLIC_SCHEDULE,
        venue=Venue.BINANCE_SPOT,
        symbol="BTCUSDT",
        role=Role.TAKER,
        side=Side.BUY,
        charge_basis=ChargeBasis.RECEIVED_ASSET_AMOUNT,
        standard=KnownOrUnknownRateV1.known("0.001"),
        special=KnownOrUnknownRateV1.unknown(),
        tax=KnownOrUnknownRateV1.unknown(),
        discount=DiscountTruthV1(
            application=DiscountApplication.NOT_APPLIED,
            standard_payable_multiplier=KnownOrUnknownRateV1.known("1"),
            fee_asset=FeeAsset.RECEIVED_ASSET,
        ),
        source_field_refs=(SourceFieldRef.SPOT_FEE_SCHEDULE_TAKER,),
    )
    return FeeTruthReceiptV1(
        schema=FEE_TRUTH_SCHEMA,
        version=FEE_TRUTH_VERSION,
        sanitization_policy_id=SANITIZATION_POLICY_ID,
        provenance=ReceiptProvenanceV1(
            capture_kind=OWNER_SUPPLIED_CAPTURE_KIND,
            observed_at_utc="2026-07-28T12:00:00Z",
            valid_until_utc="2026-07-28T13:00:00Z",
            temporal_scope=CURRENT_POINT_IN_TIME,
            sources=(ProvenanceSource.BINANCE_SPOT_FEE_SCHEDULE,),
        ),
        rows=(row,),
    )


def _usdm_receipt() -> FeeTruthReceiptV1:
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
        standard=KnownOrUnknownRateV1.known("0.0004"),
        special=KnownOrUnknownRateV1.not_applicable(),
        tax=KnownOrUnknownRateV1.not_applicable(),
        discount=DiscountTruthV1(
            application=DiscountApplication.NOT_APPLIED,
            standard_payable_multiplier=KnownOrUnknownRateV1.known("1"),
            fee_asset=FeeAsset.SETTLEMENT_ASSET,
        ),
        source_field_refs=(
            SourceFieldRef.USDM_ACCOUNT_TAKER_COMMISSION_RATE,
            SourceFieldRef.USDM_BNB_DISCOUNT_STATUS,
        ),
    )
    return FeeTruthReceiptV1(
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


def _scenario(
    inputs: dict[str, object],
    scenario_id: str,
) -> dict[str, object]:
    return next(
        scenario
        for scenario in cast(list[dict[str, object]], inputs["scenarios"])
        if scenario["scenarioId"] == scenario_id
    )


def _object_at(
    root: dict[str, object],
    path: tuple[str | int, ...],
) -> dict[str, object]:
    current: object = root
    for segment in path:
        if isinstance(segment, int):
            current = cast(list[object], current)[segment]
        else:
            current = cast(dict[str, object], current)[segment]
    return cast(dict[str, object], current)


def _parse_project_and_digest(
    raw: bytes,
    *,
    digests: list[str],
) -> bytes:
    receipt = parse_receipt_bytes(raw, expected_symbols=EXPECTED_SYMBOLS)
    artifact = canonical_n3_fee_inputs_bytes(receipt, as_of_utc=AS_OF)
    digests.append(hashlib.sha256(artifact).hexdigest())
    return artifact


@pytest.mark.parametrize("forbidden_field", FORBIDDEN_FIELDS)
@pytest.mark.parametrize("object_path", OBJECT_PATHS)
def test_forbidden_private_fields_are_rejected_at_every_object_depth_without_output(
    forbidden_field: str,
    object_path: tuple[str | int, ...],
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    mapping = copy.deepcopy(_valid_receipt().as_mapping())
    _object_at(mapping, object_path)[forbidden_field] = SENTINEL
    raw = canonical_json_bytes(mapping)
    artifact_path = tmp_path / "fee-inputs.json"
    digests: list[str] = []

    with pytest.raises(FeeReceiptError) as caught:
        _parse_project_and_digest(raw, digests=digests)

    captured = capsys.readouterr()
    assert str(caught.value) == "fee receipt rejected"
    assert SENTINEL not in str(caught.value)
    assert forbidden_field not in str(caught.value)
    assert captured.out == ""
    assert captured.err == ""
    assert SENTINEL not in captured.out
    assert SENTINEL not in captured.err
    assert digests == []
    assert not artifact_path.exists()


def test_account_like_symbol_value_cannot_cross_caller_allowlist(
    capsys: pytest.CaptureFixture[str],
) -> None:
    mapping = copy.deepcopy(_valid_receipt().as_mapping())
    row = cast(dict[str, object], cast(list[object], mapping["rows"])[0])
    row["symbol"] = "ACCOUNTIDENTIFIER"
    row["scenarioId"] = "fee1.current_account_rate.binance_spot.accountidentifier.taker.buy"
    raw = canonical_json_bytes(mapping)
    digests: list[str] = []

    with pytest.raises(FeeReceiptError) as caught:
        _parse_project_and_digest(raw, digests=digests)

    captured = capsys.readouterr()
    assert str(caught.value) == "fee receipt rejected"
    assert "ACCOUNTIDENTIFIER" not in str(caught.value)
    assert "ACCOUNTIDENTIFIER" not in captured.out
    assert "ACCOUNTIDENTIFIER" not in captured.err
    assert digests == []


def test_accepted_artifact_contains_only_allowlisted_safe_keys_and_no_sentinel() -> None:
    raw = canonical_json_bytes(_valid_receipt().as_mapping())
    receipt = parse_receipt_bytes(raw, expected_symbols=EXPECTED_SYMBOLS)
    artifact = canonical_n3_fee_inputs_bytes(receipt, as_of_utc=AS_OF)
    forbidden_fragments = (
        b"apikey",
        b"secret",
        b"token",
        b"password",
        b"accountid",
        b"subaccount",
        b"userid",
        b"email",
        b"phone",
        b"address",
        b"iban",
        b"card",
        b"payment",
    )

    assert SENTINEL.encode() not in artifact
    lowered = artifact.lower()
    assert all(fragment not in lowered for fragment in forbidden_fragments)


def test_arbitrary_mapping_with_forbidden_sentinel_cannot_be_serialized() -> None:
    unsafe = cast(
        FeeTruthReceiptV1,
        {
            "schema": "N3FeeScenarioInputsV1",
            "rawApiKey": SENTINEL,
        },
    )

    with pytest.raises(ContractValueError) as caught:
        canonical_n3_fee_inputs_bytes(unsafe, as_of_utc=AS_OF)

    assert str(caught.value) == "receipt must be FeeTruthReceiptV1"
    assert SENTINEL not in str(caught.value)


@pytest.mark.parametrize(
    ("routes", "message"),
    [
        (
            (
                _route_address(
                    venue=Venue.BINANCE_SPOT,
                    side=Side.BUY,
                    role=Role.MAKER,
                ),
                _route_address(venue=Venue.BINANCE_SPOT, side=Side.SELL),
                _route_address(venue=Venue.BINANCE_SPOT, side=Side.BUY),
                _route_address(
                    venue=Venue.BINANCE_SPOT,
                    side=Side.SELL,
                    role=Role.MAKER,
                ),
            ),
            "exactly two Spot and two USD-M",
        ),
        (
            (
                _route_address(
                    venue=Venue.BINANCE_SPOT,
                    side=Side.BUY,
                    role=Role.MAKER,
                ),
                _route_address(venue=Venue.BINANCE_SPOT, side=Side.SELL),
                _route_address(venue=Venue.BINANCE_SPOT, side=Side.BUY),
                _route_address(venue=Venue.BINANCE_USDM, side=Side.BOTH),
            ),
            "exactly two Spot and two USD-M",
        ),
        (
            (
                _route_address(
                    venue=Venue.BINANCE_SPOT,
                    side=Side.BUY,
                    role=Role.MAKER,
                ),
                _route_address(venue=Venue.BINANCE_SPOT, side=Side.SELL),
                _route_address(
                    venue=Venue.BINANCE_USDM,
                    side=Side.BOTH,
                    role=Role.MAKER,
                ),
                _route_address(
                    venue=Venue.BINANCE_USDM,
                    side=Side.BOTH,
                    symbol="ETHUSDT",
                ),
            ),
            "share one symbol",
        ),
        (
            (
                _route_address(
                    venue=Venue.BINANCE_SPOT,
                    side=Side.BUY,
                    role=Role.MAKER,
                ),
                _route_address(venue=Venue.BINANCE_SPOT, side=Side.BUY),
                _route_address(
                    venue=Venue.BINANCE_USDM,
                    side=Side.BOTH,
                    role=Role.MAKER,
                ),
                _route_address(venue=Venue.BINANCE_USDM, side=Side.BOTH),
            ),
            "BUY and SELL sides",
        ),
    ],
    ids=("all-spot", "wrong-venue-counts", "cross-symbol", "wrong-spot-sides"),
)
def test_basis_rejects_non_four_fill_topologies(
    routes: tuple[FeeRouteAddressV1, ...],
    message: str,
) -> None:
    inputs = convert_receipt_to_n3_inputs(_valid_receipt(), as_of_utc=AS_OF)

    with pytest.raises(ContractValueError, match=message):
        project_basis_q08_cost_stack(
            inputs,
            scenario_id=ACCOUNT_EFFECTIVE_SANITIZED,
            routes=routes,
        )


@pytest.mark.parametrize(
    ("entry_route", "exit_route"),
    [
        (
            _route_address(
                venue=Venue.BINANCE_USDM,
                side=Side.BOTH,
                role=Role.MAKER,
            ),
            _route_address(venue=Venue.BINANCE_USDM, side=Side.BOTH),
        ),
        (
            _route_address(venue=Venue.BINANCE_SPOT, side=Side.BUY),
            _route_address(
                venue=Venue.BINANCE_SPOT,
                side=Side.SELL,
                symbol="ETHUSDT",
            ),
        ),
        (
            _route_address(venue=Venue.BINANCE_SPOT, side=Side.BUY),
            _route_address(venue=Venue.BINANCE_USDM, side=Side.BOTH),
        ),
        (
            _route_address(venue=Venue.BINANCE_SPOT, side=Side.BUY),
            _route_address(
                venue=Venue.BINANCE_SPOT,
                side=Side.BUY,
                role=Role.MAKER,
            ),
        ),
    ],
    ids=("all-usdm", "cross-symbol", "cross-venue", "wrong-side"),
)
def test_volume_rejects_non_spot_round_trip_topologies(
    entry_route: FeeRouteAddressV1,
    exit_route: FeeRouteAddressV1,
) -> None:
    inputs = convert_receipt_to_n3_inputs(_valid_receipt(), as_of_utc=AS_OF)

    with pytest.raises(
        ContractValueError,
        match="same-symbol opposite-side Spot entry and exit",
    ):
        project_volume_fee_bps(
            inputs,
            scenario_id=ACCOUNT_EFFECTIVE_SANITIZED,
            entry_route=entry_route,
            exit_route=exit_route,
        )


@pytest.mark.parametrize(
    ("entry_route", "exit_route"),
    [
        (
            _route_address(venue=Venue.BINANCE_SPOT, side=Side.BUY),
            _route_address(
                venue=Venue.BINANCE_SPOT,
                side=Side.SELL,
                symbol="ETHUSDT",
            ),
        ),
        (
            _route_address(venue=Venue.BINANCE_SPOT, side=Side.BUY),
            _route_address(venue=Venue.BINANCE_USDM, side=Side.BOTH),
        ),
        (
            _route_address(venue=Venue.BINANCE_SPOT, side=Side.BUY),
            _route_address(
                venue=Venue.BINANCE_SPOT,
                side=Side.BUY,
                role=Role.MAKER,
            ),
        ),
    ],
    ids=("cross-symbol", "cross-venue", "wrong-spot-side"),
)
def test_s1_rejects_mismatched_entry_exit_topologies(
    entry_route: FeeRouteAddressV1,
    exit_route: FeeRouteAddressV1,
) -> None:
    inputs = convert_receipt_to_n3_inputs(_valid_receipt(), as_of_utc=AS_OF)

    with pytest.raises(
        ContractValueError,
        match="same-symbol same-venue entry and exit routes",
    ):
        project_s1_fee_bps(
            inputs,
            scenario_id=ACCOUNT_EFFECTIVE_SANITIZED,
            entry_route=entry_route,
            exit_route=exit_route,
        )


def test_projection_boundary_rejection_has_constant_no_echo_traceback_state() -> None:
    inputs = convert_receipt_to_n3_inputs(_valid_receipt(), as_of_utc=AS_OF)
    inputs["rawApiKey"] = SENTINEL
    route = FeeRouteAddressV1(
        venue=Venue.BINANCE_SPOT,
        symbol="BTCUSDT",
        role=Role.TAKER,
        side=Side.BUY,
        charge_basis=ChargeBasis.RECEIVED_ASSET_AMOUNT,
    )
    output: dict[str, object] | None = None

    with pytest.raises(ContractValueError) as caught:
        output = project_volume_fee_bps(
            inputs,
            scenario_id=ACCOUNT_EFFECTIVE_SANITIZED,
            entry_route=route,
            exit_route=route,
        )

    error = caught.value
    assert str(error) == "N-3 fee input rejected"
    assert SENTINEL not in str(error)
    assert error.__cause__ is None
    assert error.__context__ is None
    traceback = error.__traceback__
    projection_frames = 0
    while traceback is not None:
        if traceback.tb_frame.f_code.co_filename.endswith("quant_edge/fee_truth/projections.py"):
            projection_frames += 1
            assert SENTINEL not in repr(traceback.tb_frame.f_locals)
        traceback = traceback.tb_next
    assert projection_frames >= 1
    assert output is None


def _mutate_n3_input(mapping: dict[str, object], mutation: str) -> None:
    scenarios = cast(list[dict[str, object]], mapping["scenarios"])
    account = scenarios[0]
    account_rows = cast(list[dict[str, object]], account["rateRows"])
    account_row = account_rows[0]
    if mutation == "root-extra":
        mapping["rawApiKey"] = SENTINEL
    elif mutation == "provenance-extra":
        cast(dict[str, object], mapping["provenance"])["email"] = SENTINEL
    elif mutation == "scenario-extra":
        account["payment"] = SENTINEL
    elif mutation == "row-extra":
        account_row["accountId"] = SENTINEL
    elif mutation == "reason-sentinel":
        account_row["reasonCodes"] = [SENTINEL]
    elif mutation == "source-ref-sentinel":
        account_row["sourceFieldRefs"] = [SENTINEL]
    elif mutation == "route-dimension-sentinel":
        account_row["symbol"] = SENTINEL
    elif mutation == "spot-rpi":
        account_row["liquidityRole"] = "RPI"
        account_row["routeId"] = "fee1.current_account_rate.binance_spot.btcusdt.rpi.buy"
    elif mutation == "spot-both":
        account_row["side"] = "BOTH"
        account_row["routeId"] = "fee1.current_account_rate.binance_spot.btcusdt.taker.both"
    elif mutation == "spot-charge-basis":
        account_row["chargeBasis"] = "USDM_QUOTE_NOTIONAL"
    elif mutation == "usdm-side":
        account_row["venue"] = "BINANCE_USDM"
        account_row["chargeBasis"] = "USDM_QUOTE_NOTIONAL"
        account_row["routeId"] = "fee1.current_account_rate.binance_usdm.btcusdt.taker.buy"
    elif mutation == "usdm-charge-basis":
        account_row["venue"] = "BINANCE_USDM"
        account_row["side"] = "BOTH"
        account_row["routeId"] = "fee1.current_account_rate.binance_usdm.btcusdt.taker.both"
    elif mutation == "temporal-use":
        account_row["temporalUse"] = "CURRENT_POINT_IN_TIME"
    elif mutation == "truth-conflict":
        account_row["knownness"] = "UNKNOWN"
    elif mutation == "unreduced-ratio":
        account_row["effectiveRate"] = {"denominator": "4", "numerator": "2"}
    elif mutation == "scenario-order":
        scenarios.reverse()
    elif mutation == "base-scenario-id":
        scenarios[2]["baseScenarioIds"] = [PUBLIC_REGULAR_NO_BNB]
    else:
        raise AssertionError("unknown mutation")


@pytest.mark.parametrize(
    "mutation",
    [
        "root-extra",
        "provenance-extra",
        "scenario-extra",
        "row-extra",
        "reason-sentinel",
        "source-ref-sentinel",
        "route-dimension-sentinel",
        "spot-rpi",
        "spot-both",
        "spot-charge-basis",
        "usdm-side",
        "usdm-charge-basis",
        "temporal-use",
        "truth-conflict",
        "unreduced-ratio",
        "scenario-order",
        "base-scenario-id",
    ],
)
def test_projection_rejects_crafted_n3_mapping_before_emitting_output(
    mutation: str,
) -> None:
    inputs = convert_receipt_to_n3_inputs(_valid_receipt(), as_of_utc=AS_OF)
    _mutate_n3_input(inputs, mutation)
    route = FeeRouteAddressV1(
        venue=Venue.BINANCE_SPOT,
        symbol="BTCUSDT",
        role=Role.TAKER,
        side=Side.BUY,
        charge_basis=ChargeBasis.RECEIVED_ASSET_AMOUNT,
    )
    output: dict[str, object] | None = None

    with pytest.raises(ContractValueError) as caught:
        output = project_volume_fee_bps(
            inputs,
            scenario_id=ACCOUNT_EFFECTIVE_SANITIZED,
            entry_route=route,
            exit_route=route,
        )

    assert str(caught.value) == "N-3 fee input rejected"
    assert SENTINEL not in str(caught.value)
    assert output is None


def _assert_projection_rejected(inputs: dict[str, object]) -> None:
    route = FeeRouteAddressV1(
        venue=Venue.BINANCE_SPOT,
        symbol="BTCUSDT",
        role=Role.TAKER,
        side=Side.BUY,
        charge_basis=ChargeBasis.RECEIVED_ASSET_AMOUNT,
    )
    output: dict[str, object] | None = None

    with pytest.raises(ContractValueError) as caught:
        output = project_volume_fee_bps(
            inputs,
            scenario_id=ACCOUNT_EFFECTIVE_SANITIZED,
            entry_route=route,
            exit_route=route,
        )

    assert str(caught.value) == "N-3 fee input rejected"
    assert output is None


@pytest.mark.parametrize(
    "mutation",
    [
        "missing",
        "extra",
        "mutated-known-plus-2bps",
    ],
)
def test_adverse_rows_must_be_an_exact_one_to_one_derivation_of_base_rows(
    mutation: str,
) -> None:
    inputs = convert_receipt_to_n3_inputs(_valid_receipt(), as_of_utc=AS_OF)
    adverse = _scenario(inputs, ADVERSE_PLUS_2_BPS_PER_SIDE_PER_FILL_LEG)
    rows = cast(list[dict[str, object]], adverse["rateRows"])

    if mutation == "missing":
        rows.clear()
        adverse["reasonCodes"] = ["NO_RATE_ROWS"]
        adverse["scenarioState"] = "UNKNOWN"
        adverse["truthState"] = "UNKNOWN"
    elif mutation == "extra":
        extra = copy.deepcopy(rows[0])
        extra["symbol"] = "ETHUSDT"
        extra["routeId"] = cast(str, extra["routeId"]).replace("btcusdt", "ethusdt")
        rows.append(extra)
    elif mutation == "mutated-known-plus-2bps":
        row = rows[0]
        components = cast(dict[str, object], row["components"])
        components["special"] = {
            "knownness": "KNOWN",
            "value": {"denominator": "20000", "numerator": "1"},
        }
        row["effectiveRate"] = {"denominator": "1000", "numerator": "1"}
        row["effectiveBps"] = {"denominator": "1", "numerator": "10"}
    else:
        raise AssertionError("unknown mutation")

    _assert_projection_rejected(inputs)


def test_unknown_adverse_row_cannot_drop_base_rate_unknown_transformation() -> None:
    inputs = convert_receipt_to_n3_inputs(_unknown_receipt(), as_of_utc=AS_OF)
    adverse = _scenario(inputs, ADVERSE_PLUS_2_BPS_PER_SIDE_PER_FILL_LEG)
    row = cast(list[dict[str, object]], adverse["rateRows"])[0]
    reasons = cast(list[str], row["reasonCodes"])
    assert "BASE_RATE_UNKNOWN" in reasons
    row["reasonCodes"] = [reason for reason in reasons if reason != "BASE_RATE_UNKNOWN"]
    adverse["reasonCodes"] = sorted(cast(list[str], row["reasonCodes"]))

    _assert_projection_rejected(inputs)


def test_public_regular_no_bnb_rejects_applied_discount_mislabel() -> None:
    inputs = convert_receipt_to_n3_inputs(_public_receipt(), as_of_utc=AS_OF)
    public = _scenario(inputs, PUBLIC_REGULAR_NO_BNB)
    row = cast(list[dict[str, object]], public["rateRows"])[0]
    cast(dict[str, object], row["components"])["discountApplication"] = (
        DiscountApplication.APPLIED_TO_STANDARD_ONLY.value
    )

    _assert_projection_rejected(inputs)


@pytest.mark.parametrize(
    ("receipt_factory", "scenario_id", "wrong_fee_asset"),
    [
        (_public_receipt, PUBLIC_REGULAR_NO_BNB, FeeAsset.SETTLEMENT_ASSET.value),
        (_usdm_receipt, ACCOUNT_EFFECTIVE_SANITIZED, FeeAsset.RECEIVED_ASSET.value),
    ],
)
def test_external_mapping_rejects_venue_swapped_not_applied_fee_asset(
    receipt_factory: Callable[[], FeeTruthReceiptV1],
    scenario_id: str,
    wrong_fee_asset: str,
) -> None:
    receipt = receipt_factory()
    inputs = convert_receipt_to_n3_inputs(receipt, as_of_utc=AS_OF)
    scenario = _scenario(inputs, scenario_id)
    row = cast(list[dict[str, object]], scenario["rateRows"])[0]
    cast(dict[str, object], row["components"])["feeAsset"] = wrong_fee_asset

    _assert_projection_rejected(inputs)


@pytest.mark.parametrize(
    "truth_law",
    [
        "unknown-standard",
        "unknown-discount",
        "spot-current-special",
        "spot-public-special",
        "usdm-special",
    ],
)
def test_external_mapping_preserves_receipt_truth_state_component_laws(
    truth_law: str,
) -> None:
    receipt = (
        _unknown_receipt()
        if truth_law.startswith("unknown-")
        else (
            _public_receipt()
            if truth_law == "spot-public-special"
            else (_usdm_receipt() if truth_law == "usdm-special" else _valid_receipt())
        )
    )
    inputs = convert_receipt_to_n3_inputs(receipt, as_of_utc=AS_OF)
    scenario_id = (
        PUBLIC_REGULAR_NO_BNB if truth_law == "spot-public-special" else ACCOUNT_EFFECTIVE_SANITIZED
    )
    scenario = _scenario(inputs, scenario_id)
    row = cast(list[dict[str, object]], scenario["rateRows"])[0]
    components = cast(dict[str, object], row["components"])

    if truth_law == "unknown-standard":
        components["standardBeforeDiscount"] = {
            "knownness": "KNOWN",
            "value": {"denominator": "1000", "numerator": "1"},
        }
    elif truth_law == "unknown-discount":
        components["discountApplication"] = DiscountApplication.NOT_APPLIED.value
        components["feeAsset"] = FeeAsset.RECEIVED_ASSET.value
        components["standardPayableMultiplier"] = {
            "knownness": "KNOWN",
            "value": {"denominator": "1", "numerator": "1"},
        }
    elif truth_law in {"spot-current-special", "spot-public-special", "usdm-special"}:
        components["special"] = (
            {"knownness": "UNKNOWN", "value": None}
            if truth_law == "spot-current-special"
            else {
                "knownness": "KNOWN",
                "value": {"denominator": "1", "numerator": "0"},
            }
        )
    else:
        raise AssertionError("unknown truth law")

    _assert_projection_rejected(inputs)


def test_stale_as_of_cannot_retain_known_fee_rows() -> None:
    inputs = convert_receipt_to_n3_inputs(_valid_receipt(), as_of_utc=AS_OF)
    inputs["asOfUtc"] = "2026-07-28T14:00:00Z"

    _assert_projection_rejected(inputs)


def test_n3_consumer_rejects_overlong_receipt_validity_window() -> None:
    inputs = convert_receipt_to_n3_inputs(_valid_receipt(), as_of_utc=AS_OF)
    provenance = cast(dict[str, object], inputs["provenance"])
    provenance["validUntilUtc"] = "2026-07-28T13:00:01Z"

    assert MAX_RECEIPT_VALIDITY_SECONDS == 3_600
    _assert_projection_rejected(inputs)


@pytest.mark.parametrize(
    "stale_or_pre_observation",
    [
        "2026-07-28T11:00:00Z",
        "2026-07-28T14:00:00Z",
    ],
)
def test_fresh_as_of_cannot_retain_stale_or_pre_observation_reasons(
    stale_or_pre_observation: str,
) -> None:
    inputs = convert_receipt_to_n3_inputs(
        _valid_receipt(),
        as_of_utc=stale_or_pre_observation,
    )
    inputs["asOfUtc"] = AS_OF

    _assert_projection_rejected(inputs)
