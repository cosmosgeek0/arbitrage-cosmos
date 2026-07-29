from __future__ import annotations

import base64
import hashlib
import io
import json
import zipfile
from dataclasses import replace
from pathlib import Path
from typing import Any, Literal, cast

import pytest
from research.dq1.boundary import (
    DAY_US,
    AcquisitionReceiptV1,
    BoundaryResultV1,
    Decision,
    ValidationContextV1,
    _bounded_read,
    main,
    validate_archive,
)

FIXTURES = Path(__file__).with_name("fixtures")
MANIFEST = json.loads((FIXTURES / "fixture-manifest.v1.json").read_text(encoding="utf-8"))
DQ1_DIR = Path(__file__).resolve().parent
QUANT_DIR = DQ1_DIR.parents[1]
CONTEXT = ValidationContextV1(
    policy_sha256=hashlib.sha256((DQ1_DIR / "policy.v1.json").read_bytes()).hexdigest(),
    validator_sha256=hashlib.sha256((DQ1_DIR / "boundary.py").read_bytes()).hexdigest(),
    runtime_lock_sha256=hashlib.sha256((QUANT_DIR / "uv.lock").read_bytes()).hexdigest(),
    public_data_docs_commit="5c7f3197591c0d54d85dc43066226bc4c671d47a",
    public_data_docs_sha256="085ab91377aa9325d44f4c7ad27cce4ab381e158403e1d7df2bad39d1a66f7c6",
    spot_api_docs_commit="6b8372cad7cecbdf5dd88a3372eafff51988c5cf",
    spot_api_docs_sha256="49ea6809243fc7fb426e07f2fe662097736c7bb405bd2da5eef637d715427999",
)


def _sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _decode_fixture(filename: str) -> bytes:
    return base64.b64decode((FIXTURES / f"{filename}.b64").read_bytes(), validate=False)


def _manifest_case(symbol: str, partition: str) -> dict[str, Any]:
    return next(
        item
        for item in MANIFEST["archives"]
        if item["receipt"]["symbol"] == symbol and item["receipt"]["partition"] == partition
    )


def _validate_case(symbol: str, partition: str) -> BoundaryResultV1:
    case = _manifest_case(symbol, partition)
    receipt = AcquisitionReceiptV1(**case["receipt"])
    return validate_archive(
        archive_bytes=_decode_fixture(receipt.archive_filename),
        checksum_bytes=_decode_fixture(f"{receipt.archive_filename}.CHECKSUM"),
        receipt=receipt,
        context=CONTEXT,
    )


def _payload(result: BoundaryResultV1) -> dict[str, Any]:
    parsed: object = json.loads(result.receipt_bytes)
    assert isinstance(parsed, dict)
    return cast(dict[str, Any], parsed)


def _row(
    open_native: int,
    *,
    close_native: int | None = None,
    open_price: str = "1.00000000",
    high: str = "2.00000000",
    low: str = "0.50000000",
    close_price: str = "1.50000000",
    volume: str = "10.00000000",
    quote_volume: str = "12.00000000",
    trade_count: str = "2",
    taker_base: str = "4.00000000",
    taker_quote: str = "5.00000000",
    ignore: str = "0",
    day_native: int = DAY_US,
) -> bytes:
    effective_close = open_native + day_native - 1 if close_native is None else close_native
    return (
        f"{open_native},{open_price},{high},{low},{close_price},{volume},"
        f"{effective_close},{quote_volume},{trade_count},{taker_base},"
        f"{taker_quote},{ignore}\n"
    ).encode("ascii")


def _zip(member_name: str, member: bytes, *, extra_member: bool = False) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, mode="w") as archive:
        info = zipfile.ZipInfo(member_name, date_time=(2026, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        archive.writestr(info, member)
        if extra_member:
            second = zipfile.ZipInfo("extra.csv", date_time=(2026, 1, 1, 0, 0, 0))
            second.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(second, b"x\n")
    return buffer.getvalue()


def _synthetic(
    member: bytes,
    *,
    symbol: str = "TESTUSDT",
    cadence: str = "monthly",
    partition: str = "2026-02",
    member_name: str | None = None,
    extra_member: bool = False,
) -> tuple[bytes, bytes, AcquisitionReceiptV1]:
    expected_member = f"{symbol}-1d-{partition}.csv"
    archive_name = f"{symbol}-1d-{partition}.zip"
    archive = _zip(member_name or expected_member, member, extra_member=extra_member)
    checksum = f"{_sha256(archive)}  {archive_name}".encode("ascii")
    receipt = AcquisitionReceiptV1(
        symbol=symbol,
        cadence=cast(Literal["daily", "monthly"], cadence),
        partition=partition,
        archive_url=(
            f"https://data.binance.vision/data/spot/{cadence}/klines/{symbol}/1d/{archive_name}"
        ),
        checksum_url=(
            "https://data.binance.vision/data/spot/"
            f"{cadence}/klines/{symbol}/1d/{archive_name}.CHECKSUM"
        ),
        retrieved_at="2026-07-29T18:58:02Z",
        http_etag='"synthetic"',
        http_last_modified="Wed, 29 Jul 2026 18:58:02 GMT",
        archive_bytes=len(archive),
        archive_sha256=_sha256(archive),
        checksum_sha256=_sha256(checksum),
        member_sha256=_sha256(member),
    )
    return archive, checksum, receipt


def _validate_synthetic(
    member: bytes,
    **kwargs: Any,
) -> BoundaryResultV1:
    archive, checksum, receipt = _synthetic(member, **kwargs)
    return validate_archive(
        archive_bytes=archive,
        checksum_bytes=checksum,
        receipt=receipt,
        context=CONTEXT,
    )


@pytest.mark.parametrize(
    ("symbol", "partition"),
    [
        ("ACAUSDT", "2026-02"),
        ("AXSUSDT", "2026-02"),
        ("BTCUSDT", "2024-12-31"),
        ("BTCUSDT", "2025-01-01"),
    ],
)
def test_official_fixtures_match_frozen_receipts_and_expected_counts(
    symbol: str, partition: str
) -> None:
    case = _manifest_case(symbol, partition)
    result = _validate_case(symbol, partition)
    payload = _payload(result)

    assert result.decision == case["expected"]["decision"]
    assert payload["counts"]["rawEqualsLogicalPlusDropped"] is True
    assert payload["counts"]["logicalEqualsAdmittedPlusQuarantined"] is True
    for name, expected in case["expected"].items():
        if name != "decision":
            assert payload["counts"][name] == expected
    assert payload["custody"]["archiveSha256"] == case["receipt"]["archive_sha256"]
    assert payload["custody"]["checksumFileSha256"] == case["receipt"]["checksum_sha256"]
    assert payload["custody"]["memberSha256"] == case["receipt"]["member_sha256"]
    assert result.canonical_csv is not None


def test_aca_terminal_truncation_is_quarantined_without_claiming_cause() -> None:
    result = _validate_case("ACAUSDT", "2026-02")
    payload = _payload(result)
    event = payload["exclusions"][0]

    assert result.decision is Decision.ADMISSIBLE_WITH_EXCLUSIONS
    assert event["code"] == "TERMINAL_TRUNCATED_INTERVAL_EXCLUDED"
    assert event["ordinal"] == 13
    assert event["openNative"] == 1_770_940_800_000_000
    assert event["actualCloseNative"] == 1_770_951_599_999_000
    assert event["expectedCloseNative"] == 1_771_027_199_999_999
    assert event["reasonUnknown"] is True
    assert event["consumerCensoringRequired"] is True
    assert payload["coverage"]["completenessAuthority"] == "UNASSESSED"
    assert payload["coverage"]["logicalOpenMissingRanges"] == [
        {"startInclusive": "2026-02-14", "endExclusive": "2026-03-01"}
    ]
    assert payload["coverage"]["noAdmittedCompleteRowRanges"] == [
        {"startInclusive": "2026-02-13", "endExclusive": "2026-03-01"}
    ]
    assert result.canonical_csv is not None
    assert len(result.canonical_csv.splitlines()) == 12


def test_axs_adjacent_byte_identical_pair_collapses_with_custody() -> None:
    result = _validate_case("AXSUSDT", "2026-02")
    payload = _payload(result)
    event = payload["exclusions"][0]

    assert result.decision is Decision.ADMISSIBLE_WITH_EXCLUSIONS
    assert event["code"] == "ADJACENT_IDENTICAL_DUPLICATE_COLLAPSED"
    assert event["keptOrdinal"] == 10
    assert event["droppedOrdinals"] == [11]
    assert event["extraCoverageGranted"] is False
    assert [item["sha256WithLf"] for item in event["records"]] == [
        "36e86b2b8bdd586e5672faa0b9beda042442895f8de7bde3e4479c8d047a51ba",
        "36e86b2b8bdd586e5672faa0b9beda042442895f8de7bde3e4479c8d047a51ba",
    ]
    assert result.canonical_csv is not None
    assert len(result.canonical_csv.splitlines()) == 28


def test_cutover_uses_partition_not_magnitude_and_preserves_close_precision() -> None:
    before = _validate_case("BTCUSDT", "2024-12-31")
    after = _validate_case("BTCUSDT", "2025-01-01")
    before_payload = _payload(before)
    after_payload = _payload(after)
    assert before_payload["timestamps"]["nativeUnit"] == "MILLISECOND"
    assert before_payload["timestamps"]["nativeToUsMultiplier"] == 1_000
    assert after_payload["timestamps"]["nativeUnit"] == "MICROSECOND"
    assert after_payload["timestamps"]["nativeToUsMultiplier"] == 1
    assert before.canonical_csv is not None
    assert after.canonical_csv is not None
    assert before.canonical_csv.split(b",")[0] == b"1735603200000000"
    assert before.canonical_csv.split(b",")[6] == b"1735689599999000"
    assert after.canonical_csv.split(b",")[0] == b"1735689600000000"
    assert after.canonical_csv.split(b",")[6] == b"1735775999999999"


def test_receipt_output_and_exclusions_are_byte_deterministic() -> None:
    first = _validate_case("AXSUSDT", "2026-02")
    second = _validate_case("AXSUSDT", "2026-02")
    assert first == second
    assert first.receipt_bytes.endswith(b"\n")
    assert first.exclusions_bytes.endswith(b"\n")
    assert _payload(first)["contextVerification"] == {
        "localPolicyValidatorRuntimeDigestsVerified": True,
        "officialDocumentPinsMatchFrozenConstants": True,
    }


def test_declared_context_cannot_drift_from_executing_local_artifacts() -> None:
    case = _manifest_case("AXSUSDT", "2026-02")
    receipt = AcquisitionReceiptV1(**case["receipt"])
    result = validate_archive(
        archive_bytes=_decode_fixture(receipt.archive_filename),
        checksum_bytes=_decode_fixture(f"{receipt.archive_filename}.CHECKSUM"),
        receipt=receipt,
        context=replace(CONTEXT, validator_sha256="0" * 64),
    )
    payload = _payload(result)
    assert result.decision is Decision.INADMISSIBLE
    assert payload["error"]["code"] == "CONTEXT_DRIFT"
    assert payload["contextVerification"]["localPolicyValidatorRuntimeDigestsVerified"] is False


def test_official_document_pins_cannot_drift_from_frozen_constants() -> None:
    with pytest.raises(ValueError, match="official source-document pins"):
        replace(CONTEXT, public_data_docs_sha256="0" * 64)


def test_bounded_file_read_rejects_oversize_before_loading_payload(tmp_path: Path) -> None:
    oversized = tmp_path / "oversized.bin"
    oversized.write_bytes(b"12345")
    with pytest.raises(ValueError, match="exceeds its read bound"):
        _bounded_read(oversized, maximum=4)


@pytest.mark.parametrize(
    ("member", "code"),
    [
        (
            _row(1_769_904_000_000),
            "OPEN_OUTSIDE_PARTITION",
        ),
        (
            _row(1_769_904_000_000_001),
            "OPEN_NOT_UTC_MIDNIGHT",
        ),
        (
            _row(1_769_904_000_000_000, close_native=1_769_990_400_000_000),
            "CLOSE_AFTER_INTERVAL",
        ),
        (
            _row(
                1_769_904_000_000_000,
                close_native=1_769_903_999_999_999,
            ),
            "CLOSE_BEFORE_OPEN",
        ),
    ],
)
def test_timestamp_contract_fails_closed(member: bytes, code: str) -> None:
    result = _validate_synthetic(member)
    assert result.decision is Decision.INADMISSIBLE
    assert _payload(result)["error"]["code"] == code
    assert result.canonical_csv is None


def test_pre_cutover_wrong_microsecond_unit_is_outside_partition() -> None:
    member = _row(
        1_735_603_200_000_000,
        day_native=DAY_US,
    )
    result = _validate_synthetic(
        member,
        cadence="daily",
        partition="2024-12-31",
    )
    assert _payload(result)["error"]["code"] == "OPEN_OUTSIDE_PARTITION"


def test_nonterminal_truncation_is_not_an_allowed_exclusion() -> None:
    start = 1_769_904_000_000_000
    member = _row(start, close_native=start + 3_600_000_000) + _row(start + DAY_US)
    result = _validate_synthetic(member)
    assert result.decision is Decision.INADMISSIBLE
    assert _payload(result)["error"]["code"] == "NONTERMINAL_TRUNCATED_INTERVAL"


def test_truncated_only_archive_has_no_admitted_artifact() -> None:
    start = 1_769_904_000_000_000
    result = _validate_synthetic(_row(start, close_native=start + 3_600_000_000))
    assert result.decision is Decision.INADMISSIBLE
    assert _payload(result)["error"]["code"] == "NO_COMPLETE_ROWS"
    assert result.canonical_csv is None


def test_one_tick_short_final_interval_is_explicitly_quarantined() -> None:
    start = 1_769_904_000_000_000
    result = _validate_synthetic(
        _row(start) + _row(start + DAY_US, close_native=start + 2 * DAY_US - 2)
    )
    payload = _payload(result)
    event = payload["exclusions"][0]
    assert result.decision is Decision.ADMISSIBLE_WITH_EXCLUSIONS
    assert event["code"] == "TERMINAL_TRUNCATED_INTERVAL_EXCLUDED"
    assert event["shortfallNative"] == 1
    assert payload["counts"]["admittedCompleteRows"] == 1


def test_exact_adjacent_duplicate_is_the_only_duplicate_normalization() -> None:
    start = 1_769_904_000_000_000
    first = _row(start)
    second = _row(start + DAY_US)
    result = _validate_synthetic(first + first + second)
    payload = _payload(result)
    assert result.decision is Decision.ADMISSIBLE_WITH_EXCLUSIONS
    assert payload["counts"]["rawRows"] == 3
    assert payload["counts"]["logicalRows"] == 2
    assert payload["counts"]["duplicateDroppedRows"] == 1


def test_identical_final_duplicate_group_preserves_one_terminal_quarantine() -> None:
    start = 1_769_904_000_000_000
    truncated = _row(
        start + DAY_US,
        close_native=start + DAY_US + 3_600_000_000,
    )
    result = _validate_synthetic(_row(start) + truncated + truncated)
    payload = _payload(result)
    assert result.decision is Decision.ADMISSIBLE_WITH_EXCLUSIONS
    assert [event["code"] for event in payload["exclusions"]] == [
        "ADJACENT_IDENTICAL_DUPLICATE_COLLAPSED",
        "TERMINAL_TRUNCATED_INTERVAL_EXCLUDED",
    ]
    assert payload["counts"] == {
        "rawRows": 3,
        "logicalRows": 2,
        "admittedCompleteRows": 1,
        "duplicateDroppedRows": 1,
        "terminalQuarantinedRows": 1,
        "rawEqualsLogicalPlusDropped": True,
        "logicalEqualsAdmittedPlusQuarantined": True,
    }


def test_byte_distinct_same_open_is_inadmissible() -> None:
    start = 1_769_904_000_000_000
    result = _validate_synthetic(_row(start) + _row(start, close_price="1.60000000"))
    assert _payload(result)["error"]["code"] == "DUPLICATE_BYTE_CONFLICT"


def test_nonadjacent_recurrence_is_inadmissible() -> None:
    start = 1_769_904_000_000_000
    result = _validate_synthetic(_row(start) + _row(start + DAY_US) + _row(start))
    assert _payload(result)["error"]["code"] == "NONADJACENT_DUPLICATE"


def test_descending_new_open_is_inadmissible() -> None:
    start = 1_769_904_000_000_000
    result = _validate_synthetic(_row(start + DAY_US) + _row(start))
    assert _payload(result)["error"]["code"] == "OPEN_TIME_DESCENDING"


def test_duplicate_run_and_group_caps_are_frozen() -> None:
    start = 1_769_904_000_000_000
    one = _row(start)
    run_result = _validate_synthetic(one + one + one)
    group_result = _validate_synthetic(one + one + _row(start + DAY_US) + _row(start + DAY_US))
    assert _payload(run_result)["error"]["code"] == "DUPLICATE_RUN_CAP_EXCEEDED"
    assert _payload(group_result)["error"]["code"] == "DUPLICATE_GROUP_CAP_EXCEEDED"


@pytest.mark.parametrize(
    ("member", "code"),
    [
        (b"1,2,3\n", "CSV_FIELD_COUNT_INVALID"),
        (b'"1",2,3\n', "CSV_QUOTING_FORBIDDEN"),
        (b"\xef\xbb\xbf" + _row(1_769_904_000_000_000), "CSV_BOM_FORBIDDEN"),
        (_row(1_769_904_000_000_000).replace(b"\n", b"\r\n"), "CSV_TERMINATOR_INVALID"),
        (_row(1_769_904_000_000_000).removesuffix(b"\n"), "CSV_TERMINATOR_INVALID"),
        (_row(1_769_904_000_000_000).replace(b",0\n", b",0\x00\n"), "CSV_NUL_FORBIDDEN"),
        (_row(1_769_904_000_000_000).replace(b",0\n", b",\xff\n"), "CSV_ASCII_REQUIRED"),
        (_row(1_769_904_000_000_000).replace(b",10.00000000,", b",-1,"), "CSV_NUMERIC_INVALID"),
        (_row(1_769_904_000_000_000, high="0.75000000"), "CSV_OHLC_INVALID"),
        (
            _row(1_769_904_000_000_000, volume="1.00000000"),
            "CSV_TAKER_VOLUME_INVALID",
        ),
    ],
)
def test_csv_schema_and_economic_invariants(member: bytes, code: str) -> None:
    result = _validate_synthetic(member)
    assert _payload(result)["error"]["code"] == code
    assert result.canonical_csv is None


def test_archive_checksum_and_acquisition_receipt_form_three_way_gate() -> None:
    case = _manifest_case("AXSUSDT", "2026-02")
    receipt = AcquisitionReceiptV1(**case["receipt"])
    archive = _decode_fixture(receipt.archive_filename)
    checksum = _decode_fixture(f"{receipt.archive_filename}.CHECKSUM")

    tampered_archive = archive[:-1] + bytes([archive[-1] ^ 1])
    result = validate_archive(
        archive_bytes=tampered_archive,
        checksum_bytes=checksum,
        receipt=receipt,
        context=CONTEXT,
    )
    assert _payload(result)["error"]["code"] == "INPUT_DRIFT"

    wrong_entry_checksum = f"{'0' * 64}  {receipt.archive_filename}".encode("ascii")
    sidecar_pinned_receipt = replace(
        receipt,
        checksum_sha256=_sha256(wrong_entry_checksum),
    )
    wrong_entry = validate_archive(
        archive_bytes=archive,
        checksum_bytes=wrong_entry_checksum,
        receipt=sidecar_pinned_receipt,
        context=CONTEXT,
    )
    assert _payload(wrong_entry)["error"]["code"] == "CHECKSUM_ARCHIVE_MISMATCH"

    wrong_filename_checksum = f"{receipt.archive_sha256}  other.zip".encode("ascii")
    filename_pinned_receipt = replace(
        receipt,
        checksum_sha256=_sha256(wrong_filename_checksum),
    )
    wrong_filename = validate_archive(
        archive_bytes=archive,
        checksum_bytes=wrong_filename_checksum,
        receipt=filename_pinned_receipt,
        context=CONTEXT,
    )
    assert _payload(wrong_filename)["error"]["code"] == "CHECKSUM_FILENAME_MISMATCH"


def test_new_matching_publisher_pair_still_fails_old_receipt_as_input_drift() -> None:
    case = _manifest_case("ACAUSDT", "2026-02")
    receipt = AcquisitionReceiptV1(**case["receipt"])
    archive = _decode_fixture(receipt.archive_filename) + b"x"
    checksum = f"{_sha256(archive)}  {receipt.archive_filename}".encode("ascii")
    result = validate_archive(
        archive_bytes=archive,
        checksum_bytes=checksum,
        receipt=receipt,
        context=CONTEXT,
    )
    assert _payload(result)["error"]["code"] == "INPUT_DRIFT"


def test_wrong_and_extra_zip_members_fail_before_csv_parsing() -> None:
    member = _row(1_769_904_000_000_000)
    wrong_archive, wrong_checksum, wrong_receipt = _synthetic(
        member, member_name="../TESTUSDT-1d-2026-02.csv"
    )
    wrong = validate_archive(
        archive_bytes=wrong_archive,
        checksum_bytes=wrong_checksum,
        receipt=wrong_receipt,
        context=CONTEXT,
    )
    assert _payload(wrong)["error"]["code"] == "ZIP_MEMBER_NAME_INVALID"

    extra_archive, extra_checksum, extra_receipt = _synthetic(member, extra_member=True)
    extra = validate_archive(
        archive_bytes=extra_archive,
        checksum_bytes=extra_checksum,
        receipt=extra_receipt,
        context=CONTEXT,
    )
    assert _payload(extra)["error"]["code"] == "ZIP_MEMBER_COUNT_INVALID"


def test_cli_removes_stale_admitted_artifacts_on_hard_failure(tmp_path: Path) -> None:
    case = _manifest_case("AXSUSDT", "2026-02")
    receipt_payload = case["receipt"]
    receipt_path = tmp_path / "acquisition.json"
    context_path = tmp_path / "context.json"
    archive_path = tmp_path / "archive.zip"
    checksum_path = tmp_path / "archive.zip.CHECKSUM"
    receipt_out = tmp_path / "receipt.json"
    canonical_out = tmp_path / "canonical.csv"
    exclusions_out = tmp_path / "exclusions.json"
    receipt_path.write_text(json.dumps(receipt_payload), encoding="utf-8")
    context_path.write_text(
        json.dumps(
            {
                "policy_sha256": CONTEXT.policy_sha256,
                "validator_sha256": CONTEXT.validator_sha256,
                "runtime_lock_sha256": CONTEXT.runtime_lock_sha256,
                "public_data_docs_commit": CONTEXT.public_data_docs_commit,
                "public_data_docs_sha256": CONTEXT.public_data_docs_sha256,
                "spot_api_docs_commit": CONTEXT.spot_api_docs_commit,
                "spot_api_docs_sha256": CONTEXT.spot_api_docs_sha256,
            }
        ),
        encoding="utf-8",
    )
    archive_path.write_bytes(b"not the pinned archive")
    checksum_path.write_bytes(_decode_fixture("AXSUSDT-1d-2026-02.zip.CHECKSUM"))
    canonical_out.write_bytes(b"stale\n")
    exclusions_out.write_bytes(b"stale\n")

    exit_code = main(
        [
            "--archive",
            str(archive_path),
            "--checksum",
            str(checksum_path),
            "--acquisition-receipt",
            str(receipt_path),
            "--validation-context",
            str(context_path),
            "--receipt-out",
            str(receipt_out),
            "--canonical-out",
            str(canonical_out),
            "--exclusions-out",
            str(exclusions_out),
        ]
    )

    assert exit_code == 2
    assert receipt_out.exists()
    assert not canonical_out.exists()
    assert not exclusions_out.exists()
