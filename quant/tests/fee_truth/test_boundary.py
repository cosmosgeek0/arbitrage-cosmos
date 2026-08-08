from __future__ import annotations

import json
from copy import deepcopy
from typing import cast

import pytest

from quant_edge.canonical import canonical_json_bytes
from quant_edge.fee_truth import (
    CURRENT_POINT_IN_TIME,
    FEE_TRUTH_SCHEMA,
    FEE_TRUTH_VERSION,
    MAX_EXPECTED_SYMBOLS,
    MAX_RECEIPT_BYTES,
    MAX_RECEIPT_ROWS,
    MAX_RECEIPT_VALIDITY_SECONDS,
    OWNER_SUPPLIED_CAPTURE_KIND,
    SANITIZATION_POLICY_ID,
    FeeReceiptError,
    FeeTruthReceiptV1,
    parse_receipt_bytes,
)

pytestmark = pytest.mark.contract

EXPECTED_SYMBOLS = frozenset({"BTCUSDT"})
REJECTED = "fee receipt rejected"


def _valid_mapping() -> dict[str, object]:
    return {
        "schema": FEE_TRUTH_SCHEMA,
        "version": FEE_TRUTH_VERSION,
        "sanitizationPolicyId": SANITIZATION_POLICY_ID,
        "provenance": {
            "captureKind": OWNER_SUPPLIED_CAPTURE_KIND,
            "observedAtUtc": "2026-07-28T00:00:00Z",
            "validUntilUtc": "2026-07-28T01:00:00Z",
            "temporalScope": CURRENT_POINT_IN_TIME,
            "sources": ["BINANCE_SPOT_FEE_SCHEDULE"],
        },
        "rows": [
            {
                "scenarioId": ("fee1.public_schedule.binance_spot.btcusdt.maker.buy"),
                "truthState": "PUBLIC_SCHEDULE",
                "venue": "BINANCE_SPOT",
                "symbol": "BTCUSDT",
                "role": "MAKER",
                "side": "BUY",
                "chargeBasis": "RECEIVED_ASSET_AMOUNT",
                "standard": {"state": "KNOWN", "decimal": "0.001"},
                "special": {"state": "UNKNOWN", "decimal": None},
                "tax": {"state": "UNKNOWN", "decimal": None},
                "discount": {
                    "application": "NOT_APPLIED",
                    "standardPayableMultiplier": {
                        "state": "KNOWN",
                        "decimal": "1",
                    },
                    "feeAsset": "RECEIVED_ASSET",
                },
                "sourceFieldRefs": ["SPOT_FEE_SCHEDULE_MAKER"],
            }
        ],
    }


def _mapping(value: object) -> dict[str, object]:
    return cast(dict[str, object], value)


def _list(value: object) -> list[object]:
    return cast(list[object], value)


def _row(payload: dict[str, object]) -> dict[str, object]:
    return _mapping(_list(payload["rows"])[0])


def _rate(payload: dict[str, object], name: str = "standard") -> dict[str, object]:
    return _mapping(_row(payload)[name])


def _raw_json(value: object) -> bytes:
    return (
        json.dumps(
            value,
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
            sort_keys=True,
        )
        + "\n"
    ).encode()


def _parse(payload: dict[str, object] | None = None) -> FeeTruthReceiptV1:
    return parse_receipt_bytes(
        canonical_json_bytes(_valid_mapping() if payload is None else payload),
        expected_symbols=EXPECTED_SYMBOLS,
    )


def _assert_rejected(
    raw: object,
    *hostile_text: str,
    expected_symbols: frozenset[str] | set[str] = EXPECTED_SYMBOLS,
) -> None:
    with pytest.raises(FeeReceiptError) as caught:
        parse_receipt_bytes(
            raw,  # type: ignore[arg-type]
            expected_symbols=expected_symbols,  # type: ignore[arg-type]
        )
    message = str(caught.value)
    assert message == REJECTED
    assert caught.value.args == (REJECTED,)
    assert caught.value.__cause__ is None
    assert caught.value.__context__ is None
    assert all(text not in message for text in hostile_text)


def _capture_rejection(raw: bytes) -> FeeReceiptError:
    captured: FeeReceiptError | None = None
    try:
        parse_receipt_bytes(raw, expected_symbols=EXPECTED_SYMBOLS)
    except FeeReceiptError as error:
        captured = error
    finally:
        raw = b""
    if captured is None:
        raise AssertionError("hostile receipt was accepted")
    return captured


def _contains_forbidden_local(
    value: object,
    *,
    forbidden_text: tuple[str, ...],
    forbidden_bytes: tuple[bytes, ...],
    seen: set[int] | None = None,
) -> bool:
    if seen is None:
        seen = set()
    identity = id(value)
    if identity in seen:
        return False
    seen.add(identity)
    if isinstance(value, str):
        return any(item in value for item in forbidden_text)
    if isinstance(value, bytes):
        return any(item in value for item in forbidden_bytes)
    if isinstance(value, dict):
        return any(
            _contains_forbidden_local(
                key,
                forbidden_text=forbidden_text,
                forbidden_bytes=forbidden_bytes,
                seen=seen,
            )
            or _contains_forbidden_local(
                item,
                forbidden_text=forbidden_text,
                forbidden_bytes=forbidden_bytes,
                seen=seen,
            )
            for key, item in value.items()
        )
    if isinstance(value, (list, tuple, set, frozenset)):
        return any(
            _contains_forbidden_local(
                item,
                forbidden_text=forbidden_text,
                forbidden_bytes=forbidden_bytes,
                seen=seen,
            )
            for item in value
        )
    return False


def test_canonical_receipt_round_trips_to_identical_typed_mapping_and_bytes() -> None:
    mapping = _valid_mapping()
    raw = canonical_json_bytes(mapping)

    first = parse_receipt_bytes(raw, expected_symbols=EXPECTED_SYMBOLS)
    second = parse_receipt_bytes(raw, expected_symbols=EXPECTED_SYMBOLS)

    assert first == second
    assert first.as_mapping() == mapping
    assert canonical_json_bytes(first.as_mapping()) == raw
    assert first.rows[0].standard.ratio is not None
    assert first.rows[0].standard.ratio.as_mapping() == {
        "denominator": "1000",
        "numerator": "1",
    }


@pytest.mark.parametrize(
    "raw",
    [
        b"",
        b"{}",
        b"[]\n",
        b"\xef\xbb\xbf{}\n",
        b"\xff",
        b"{not-json}\n",
    ],
)
def test_boundary_rejects_empty_nonobject_bom_non_utf8_and_malformed_input(raw: bytes) -> None:
    _assert_rejected(raw)


def test_boundary_requires_canonical_bytes_without_reformatting_or_trailing_data() -> None:
    mapping = _valid_mapping()
    canonical = canonical_json_bytes(mapping)
    insertion_order = (
        json.dumps(
            mapping,
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
            sort_keys=False,
        )
        + "\n"
    ).encode()
    pretty = (json.dumps(mapping, indent=2, sort_keys=True) + "\n").encode()

    assert insertion_order != canonical
    _assert_rejected(insertion_order)
    _assert_rejected(pretty)
    _assert_rejected(canonical.rstrip(b"\n"))
    _assert_rejected(canonical + b"\n")
    _assert_rejected(canonical + b"HOSTILE-TRAILER", "HOSTILE-TRAILER")


def test_root_and_every_nested_object_are_closed_allowlists_without_echo() -> None:
    sentinel_key = "hostileExtraKeyDoNotEcho"
    sentinel_value = "HOSTILE-VALUE-DO-NOT-ECHO"
    payloads: list[dict[str, object]] = []

    root = deepcopy(_valid_mapping())
    root[sentinel_key] = sentinel_value
    payloads.append(root)

    provenance = deepcopy(_valid_mapping())
    _mapping(provenance["provenance"])[sentinel_key] = sentinel_value
    payloads.append(provenance)

    row = deepcopy(_valid_mapping())
    _row(row)[sentinel_key] = sentinel_value
    payloads.append(row)

    rate = deepcopy(_valid_mapping())
    _rate(rate)[sentinel_key] = sentinel_value
    payloads.append(rate)

    discount = deepcopy(_valid_mapping())
    _mapping(_row(discount)["discount"])[sentinel_key] = sentinel_value
    payloads.append(discount)

    multiplier = deepcopy(_valid_mapping())
    discount_mapping = _mapping(_row(multiplier)["discount"])
    _mapping(discount_mapping["standardPayableMultiplier"])[sentinel_key] = sentinel_value
    payloads.append(multiplier)

    for payload in payloads:
        _assert_rejected(
            canonical_json_bytes(payload),
            sentinel_key,
            sentinel_value,
        )


def test_forbidden_nested_key_drops_path_revealing_exception_context() -> None:
    sentinel_key = "forbiddenAccountFieldDoNotEcho"
    sentinel_value = "HOSTILE-ACCOUNT-VALUE-DO-NOT-ECHO"
    payload = _valid_mapping()
    _row(payload)[sentinel_key] = sentinel_value
    raw = canonical_json_bytes(payload)

    assert sentinel_key.encode() in raw
    assert sentinel_value.encode() in raw
    _assert_rejected(raw, sentinel_key, sentinel_value)


def test_public_traceback_frame_locals_do_not_retain_rejected_receipt() -> None:
    sentinel_key = "forbiddenTracebackFieldDoNotEcho"
    sentinel_value = "HOSTILE-TRACEBACK-VALUE-DO-NOT-ECHO"
    payload = _valid_mapping()
    _row(payload)[sentinel_key] = sentinel_value
    rejected_raw = canonical_json_bytes(payload)

    error = _capture_rejection(rejected_raw)

    assert str(error) == REJECTED
    assert error.__cause__ is None
    assert error.__context__ is None
    traceback = error.__traceback__
    scanned_frames = 0
    while traceback is not None:
        scanned_frames += 1
        assert not _contains_forbidden_local(
            traceback.tb_frame.f_locals,
            forbidden_text=(sentinel_key, sentinel_value),
            forbidden_bytes=(
                sentinel_key.encode(),
                sentinel_value.encode(),
                rejected_raw,
            ),
        )
        traceback = traceback.tb_next
    assert scanned_frames >= 2


def test_duplicate_root_and_nested_keys_are_rejected_without_echo() -> None:
    sentinel = "HOSTILE-DUPLICATE-DO-NOT-ECHO"
    raw = canonical_json_bytes(_valid_mapping())
    duplicate_root = raw.replace(
        b'"schema":"FEE_TRUTH_RECEIPT"',
        f'"schema":"FEE_TRUTH_RECEIPT","schema":"{sentinel}"'.encode(),
        1,
    )
    duplicate_nested = raw.replace(
        b'"decimal":"0.001"',
        f'"decimal":"0.001","decimal":"{sentinel}"'.encode(),
        1,
    )

    _assert_rejected(duplicate_root, sentinel)
    _assert_rejected(duplicate_nested, sentinel)


@pytest.mark.parametrize(
    "decimal",
    [
        "+0.001",
        ".001",
        "01",
        "1e-3",
        "1E-3",
        "0.1%",
        "0.0000000000000000001",
        "1.000000000000000001",
        "-1.000000000000000001",
        "-1.1",
    ],
)
def test_boundary_rejects_exponent_noncanonical_and_out_of_range_decimal_strings(
    decimal: str,
) -> None:
    payload = _valid_mapping()
    _rate(payload)["decimal"] = decimal
    _assert_rejected(canonical_json_bytes(payload), decimal)


def test_boundary_round_trips_negative_commission_as_an_exact_ratio() -> None:
    payload = _valid_mapping()
    _rate(payload)["decimal"] = "-0.00025000"

    parsed = _parse(payload)

    assert parsed.as_mapping() == payload
    assert parsed.rows[0].standard.ratio is not None
    assert parsed.rows[0].standard.ratio.as_mapping() == {
        "denominator": "4000",
        "numerator": "-1",
    }


@pytest.mark.parametrize("decimal", ["-0", "-0.0", "-0.000000000000000000"])
def test_boundary_rejects_negative_zero_commission(decimal: str) -> None:
    payload = _valid_mapping()
    _rate(payload)["decimal"] = decimal
    _assert_rejected(canonical_json_bytes(payload), decimal)


def test_boundary_rejects_negative_discount_multiplier() -> None:
    payload = _valid_mapping()
    discount = _mapping(_row(payload)["discount"])
    discount["application"] = "APPLIED_TO_STANDARD_ONLY"
    _mapping(discount["standardPayableMultiplier"])["decimal"] = "-0.25"
    discount["feeAsset"] = "BNB"

    _assert_rejected(canonical_json_bytes(payload), "-0.25")


@pytest.mark.parametrize("number", [0, 1, 0.001, -0.001, 1e20])
def test_boundary_rejects_json_number_literals_for_rates(number: int | float) -> None:
    payload = _valid_mapping()
    _rate(payload)["decimal"] = number
    _assert_rejected(_raw_json(payload), str(number))


@pytest.mark.parametrize(
    ("state", "decimal"),
    [
        ("UNKNOWN", "0"),
        ("NOT_APPLICABLE", "0"),
        ("KNOWN", None),
        ("UNKNOWN", "0.001"),
    ],
)
def test_boundary_enforces_unknown_and_not_applicable_null_law(
    state: str,
    decimal: str | None,
) -> None:
    payload = _valid_mapping()
    rate = _rate(payload)
    rate["state"] = state
    rate["decimal"] = decimal
    _assert_rejected(canonical_json_bytes(payload))


def test_boundary_distinguishes_known_zero_from_unknown() -> None:
    known_zero = _valid_mapping()
    _rate(known_zero)["decimal"] = "0"
    parsed_zero = _parse(known_zero)
    assert parsed_zero.rows[0].standard.ratio is not None
    assert parsed_zero.rows[0].standard.ratio.numerator == 0

    unknown = _valid_mapping()
    rate = _rate(unknown)
    rate["state"] = "UNKNOWN"
    rate["decimal"] = None
    _assert_rejected(canonical_json_bytes(unknown))


def test_boundary_rejects_symbols_outside_the_caller_frozen_allowlist() -> None:
    raw = canonical_json_bytes(_valid_mapping())

    _assert_rejected(raw, expected_symbols=frozenset())
    _assert_rejected(raw, expected_symbols=frozenset({"ETHUSDT"}))
    _assert_rejected(raw, expected_symbols={"BTCUSDT"})


@pytest.mark.parametrize(
    "expected_symbols",
    [
        frozenset({"btcusdt"}),
        frozenset({"BTC-USDT"}),
        frozenset({"A"}),
        frozenset({"BTCUSDT", ""}),
    ],
)
def test_boundary_rejects_noncanonical_expected_symbol_sets(
    expected_symbols: frozenset[str],
) -> None:
    raw = canonical_json_bytes(_valid_mapping())
    _assert_rejected(raw, expected_symbols=expected_symbols)


def test_boundary_bounds_expected_symbol_set() -> None:
    raw = canonical_json_bytes(_valid_mapping())
    oversized = frozenset(f"S{index:04d}USDT" for index in range(MAX_EXPECTED_SYMBOLS + 1))

    assert len(oversized) == MAX_EXPECTED_SYMBOLS + 1
    _assert_rejected(raw, expected_symbols=oversized)


def test_boundary_rejects_wrong_semantic_source_reference() -> None:
    wrong_role = _valid_mapping()
    _row(wrong_role)["sourceFieldRefs"] = ["SPOT_FEE_SCHEDULE_TAKER"]
    _assert_rejected(canonical_json_bytes(wrong_role))

    missing = _valid_mapping()
    _row(missing)["sourceFieldRefs"] = []
    _assert_rejected(canonical_json_bytes(missing))

    wrong_venue = _valid_mapping()
    _row(wrong_venue)["sourceFieldRefs"] = ["USDM_FEE_SCHEDULE_MAKER"]
    _assert_rejected(canonical_json_bytes(wrong_venue))


def test_boundary_enforces_sorted_unique_sources_and_rows() -> None:
    duplicate_source = _valid_mapping()
    _mapping(duplicate_source["provenance"])["sources"] = [
        "BINANCE_SPOT_FEE_SCHEDULE",
        "BINANCE_SPOT_FEE_SCHEDULE",
    ]
    _assert_rejected(canonical_json_bytes(duplicate_source))

    unsorted_source = _valid_mapping()
    _mapping(unsorted_source["provenance"])["sources"] = [
        "BINANCE_USDM_FEE_SCHEDULE",
        "BINANCE_SPOT_FEE_SCHEDULE",
    ]
    _assert_rejected(canonical_json_bytes(unsorted_source))

    duplicate_row = _valid_mapping()
    original_row = deepcopy(_row(duplicate_row))
    duplicate_row["rows"] = [original_row, deepcopy(original_row)]
    _assert_rejected(canonical_json_bytes(duplicate_row))


def test_boundary_enforces_time_and_freshness_provenance_invariants() -> None:
    exact_boundary = _valid_mapping()
    provenance = _mapping(exact_boundary["provenance"])
    provenance["validUntilUtc"] = "2026-07-28T00:00:01Z"
    parsed = _parse(exact_boundary)
    assert parsed.provenance.valid_until_epoch_s - parsed.provenance.observed_at_epoch_s == 1

    maximum_boundary = _valid_mapping()
    parsed = _parse(maximum_boundary)
    assert (
        parsed.provenance.valid_until_epoch_s - parsed.provenance.observed_at_epoch_s
        == MAX_RECEIPT_VALIDITY_SECONDS
    )

    for invalid_until in (
        "2026-07-28T00:00:00Z",
        "2026-07-27T23:59:59Z",
        "2026-07-28T01:00:01Z",
        "2026-07-28T00:00:00+00:00",
        "2026-07-28T00:00:00.001Z",
    ):
        payload = _valid_mapping()
        _mapping(payload["provenance"])["validUntilUtc"] = invalid_until
        _assert_rejected(canonical_json_bytes(payload), invalid_until)


def test_boundary_enforces_receipt_byte_and_row_bounds() -> None:
    _assert_rejected(b"x" * (MAX_RECEIPT_BYTES + 1))

    empty_rows = _valid_mapping()
    empty_rows["rows"] = []
    _assert_rejected(canonical_json_bytes(empty_rows))

    too_many_rows = _valid_mapping()
    original = deepcopy(_row(too_many_rows))
    too_many_rows["rows"] = [deepcopy(original) for _ in range(MAX_RECEIPT_ROWS + 1)]
    _assert_rejected(_raw_json(too_many_rows))


def test_all_boundary_failures_return_one_constant_secret_free_error() -> None:
    hostile_values = (
        "RAW-KEY-MATERIAL-DO-NOT-ECHO",
        "ACCOUNT-IDENTIFIER-DO-NOT-ECHO",
        "HOSTILE-FIELD-NAME-DO-NOT-ECHO",
    )
    for hostile in hostile_values:
        payload = _valid_mapping()
        payload[hostile] = hostile
        _assert_rejected(canonical_json_bytes(payload), hostile)
