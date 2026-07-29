"""Focused S-1W causal-source, selector, and accounting tests."""

from __future__ import annotations

import hashlib
import io
import zipfile
from decimal import Decimal

import pytest
from research.s1w.experiment import (
    METRICS_HEADER,
    ArchiveSample,
    EvidenceError,
    FetchResult,
    OISelectionRow,
    as_of_value,
    funding_cash,
    inspect_archive,
    inspect_document,
    net_components,
    oi_acceleration,
    parse_checksum_sidecar,
    receive_funding_side,
    select_oi_cohort,
)


def _archive_fixture(member_name: str, rows: list[str]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(member_name, "\n".join(rows) + "\n")
    return buffer.getvalue()


def test_checksum_sidecar_is_filename_bound() -> None:
    digest = "a" * 64
    assert parse_checksum_sidecar(f"{digest}  sample.zip\n".encode(), "sample.zip") == digest
    with pytest.raises(EvidenceError, match="CHECKSUM_FILENAME_MISMATCH"):
        parse_checksum_sidecar(f"{digest}  other.zip\n".encode(), "sample.zip")


def test_document_observation_accepts_only_explicit_empty_waf_challenge() -> None:
    url = "https://developers.binance.com/en/docs/example"

    def challenge_fetcher(_url: str, _maximum: int) -> FetchResult:
        return FetchResult(
            body=b"",
            final_url=url,
            headers={"x-amzn-waf-action": "challenge"},
            status=202,
        )

    observed = inspect_document(
        "DOC",
        url,
        ("required",),
        challenge_fetcher,
        allow_empty_waf_challenge=True,
    )
    assert observed["accessState"] == "AWS_WAF_CHALLENGE"
    assert observed["requiredFragmentsPresent"] == {"required": False}


def test_document_observation_rejects_ordinary_missing_content() -> None:
    url = "https://developers.binance.com/en/docs/example"

    def empty_fetcher(_url: str, _maximum: int) -> FetchResult:
        return FetchResult(body=b"", final_url=url, headers={}, status=200)

    with pytest.raises(EvidenceError, match="OFFICIAL_DOCUMENT_FRAGMENT_MISSING"):
        inspect_document("DOC", url, ("required",), empty_fetcher)


def test_metrics_archive_accepts_real_irregular_seconds_without_grid_snapping() -> None:
    sample = ArchiveSample(
        dataset="metrics",
        relative_path="data/futures/um/daily/metrics/X/X-metrics-2025-01-01.zip",
        header=METRICS_HEADER,
        timestamp_column="create_time",
        timestamp_kind="UTC_TEXT",
    )
    member = "X-metrics-2025-01-01.csv"
    archive_bytes = _archive_fixture(
        member,
        [
            ",".join(METRICS_HEADER),
            "2025-01-01 00:05:00,X,100,1000,1,1,1,1",
            "2025-01-01 00:10:01,X,101,1010,1,1,1,1",
        ],
    )
    digest = hashlib.sha256(archive_bytes).hexdigest()

    def fetcher(url: str, _maximum: int) -> FetchResult:
        body = f"{digest}  X-metrics-2025-01-01.zip\n".encode()
        if not url.endswith(".CHECKSUM"):
            body = archive_bytes
        return FetchResult(body=body, final_url=url, headers={})

    result = inspect_archive(sample, fetcher)
    assert result["rowCount"] == 2
    assert result["nonFiveMinuteGridTimestampCount"] == 1


def test_zip_member_path_or_name_is_rejected() -> None:
    sample = ArchiveSample(
        dataset="metrics",
        relative_path="data/futures/um/daily/metrics/X/X-metrics-2025-01-01.zip",
        header=METRICS_HEADER,
        timestamp_column="create_time",
        timestamp_kind="UTC_TEXT",
    )
    archive_bytes = _archive_fixture(
        "../X-metrics-2025-01-01.csv",
        [",".join(METRICS_HEADER), "2025-01-01 00:05:00,X,100,1000,1,1,1,1"],
    )
    digest = hashlib.sha256(archive_bytes).hexdigest()

    def fetcher(url: str, _maximum: int) -> FetchResult:
        body = f"{digest}  X-metrics-2025-01-01.zip\n".encode()
        if not url.endswith(".CHECKSUM"):
            body = archive_bytes
        return FetchResult(body=body, final_url=url, headers={})

    with pytest.raises(EvidenceError, match="ZIP_MEMBER_MISMATCH"):
        inspect_archive(sample, fetcher)


def test_oi_acceleration_is_base_oi_log_second_difference() -> None:
    acceleration = oi_acceleration(Decimal("121"), Decimal("110"), Decimal("100"))
    assert abs(acceleration) < Decimal("1e-25")
    positive = oi_acceleration(Decimal("130"), Decimal("110"), Decimal("100"))
    assert positive > 0
    with pytest.raises(EvidenceError, match="OPEN_INTEREST_POSITIVE_FINITE_REQUIRED"):
        oi_acceleration(Decimal("0"), Decimal("1"), Decimal("1"))


def test_selector_uses_only_oi_rows_and_stable_symbol_order() -> None:
    rows = (
        OISelectionRow("ETHUSDT", Decimal("130"), Decimal("110"), Decimal("100")),
        OISelectionRow("ADAUSDT", Decimal("121"), Decimal("110"), Decimal("100")),
    )
    selected = select_oi_cohort(rows, Decimal("0.01"))
    assert [item.symbol for item in selected] == ["ETHUSDT"]


def test_as_of_uses_actual_timestamp_and_bounded_age() -> None:
    rows = (
        (1_000, Decimal("10")),
        (301_001, Decimal("11")),
        (601_500, Decimal("12")),
    )
    assert as_of_value(rows, 601_600, maximum_age_ms=1_000) == Decimal("12")
    with pytest.raises(EvidenceError, match="AS_OF_VALUE_STALE"):
        as_of_value(rows, 1_300_000, maximum_age_ms=10_000)


@pytest.mark.parametrize(
    ("rate", "side"),
    [
        (Decimal("0.0001"), -1),
        (Decimal("-0.0001"), 1),
        (Decimal("0"), 0),
    ],
)
def test_receive_funding_side_uses_sign_only(rate: Decimal, side: int) -> None:
    assert receive_funding_side(rate) == side


@pytest.mark.parametrize(
    ("position_sign", "rate", "positive"),
    [
        (-1, Decimal("0.0001"), True),
        (1, Decimal("-0.0001"), True),
        (1, Decimal("0.0001"), False),
        (-1, Decimal("-0.0001"), False),
    ],
)
def test_funding_cash_sign(
    position_sign: int,
    rate: Decimal,
    positive: bool,
) -> None:
    cash = funding_cash(position_sign, Decimal("2"), Decimal("100"), rate)
    assert (cash > 0) is positive


def test_total_and_carry_only_net_are_separate() -> None:
    total, carry_only = net_components(
        Decimal("5"),
        Decimal("2"),
        Decimal("1"),
        Decimal("0.5"),
    )
    assert total == Decimal("5.5")
    assert carry_only == Decimal("0.5")


def test_duplicate_selector_symbol_fails_closed() -> None:
    row = OISelectionRow("ETHUSDT", Decimal("130"), Decimal("110"), Decimal("100"))
    with pytest.raises(EvidenceError, match="SYMBOL_DUPLICATE"):
        select_oi_cohort((row, row), Decimal("0"))
