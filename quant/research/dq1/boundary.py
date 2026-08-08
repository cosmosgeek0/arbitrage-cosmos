"""Deterministic offline boundary for Binance Spot public 1d-kline archives.

This module deliberately performs no network access.  Callers freeze an acquisition
receipt before supplying immutable archive and checksum bytes.  The validator then
separates byte custody, physical-row duplicate policy, interval semantics, and the
complete-bar artifact.
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import io
import json
import os
import re
import stat
import struct
import tempfile
import zipfile
import zlib
from contextlib import suppress
from dataclasses import asdict, dataclass
from datetime import UTC, date, datetime
from decimal import Decimal, InvalidOperation
from enum import StrEnum
from pathlib import Path
from typing import Final, Literal, cast
from urllib.parse import urlsplit

POLICY_ID: Final = "binance-spot-public-kline-1d-boundary-v1"
SCHEMA_ID: Final = "binance-spot-public-kline-csv-12-fields-no-header-v1"
CANONICAL_OUTPUT_SCHEMA_ID: Final = "binance-spot-kline-12-fields-timestamps-us-v1"
EXCLUSION_SCHEMA_ID: Final = "dq1-censoring-sidecar-v1"
RECEIPT_SCHEMA_ID: Final = "dq1-boundary-receipt-v1"

DAY_MS: Final = 86_400_000
DAY_US: Final = 86_400_000_000
CUTOVER: Final = date(2025, 1, 1)
EPOCH: Final = date(1970, 1, 1)
INT64_MAX: Final = (1 << 63) - 1

MAX_ARCHIVE_BYTES: Final = 16 * 1024 * 1024
MAX_MEMBER_BYTES: Final = 64 * 1024 * 1024
MAX_ROWS: Final = 100_000
MAX_LINE_BYTES: Final = 4_096
MAX_SIDECAR_BYTES: Final = 256
MAX_COMPRESSION_RATIO: Final = 200
MAX_DUPLICATE_GROUPS: Final = 1
MAX_DUPLICATE_RUN_LENGTH: Final = 2
MAX_CONFIG_BYTES: Final = 64 * 1024

PUBLIC_DATA_DOCS_COMMIT: Final = "5c7f3197591c0d54d85dc43066226bc4c671d47a"
PUBLIC_DATA_DOCS_SHA256: Final = "085ab91377aa9325d44f4c7ad27cce4ab381e158403e1d7df2bad39d1a66f7c6"
SPOT_API_DOCS_COMMIT: Final = "6b8372cad7cecbdf5dd88a3372eafff51988c5cf"
SPOT_API_DOCS_SHA256: Final = "49ea6809243fc7fb426e07f2fe662097736c7bb405bd2da5eef637d715427999"

_DQ1_DIR: Final = Path(__file__).resolve().parent
_QUANT_DIR: Final = _DQ1_DIR.parents[1]

_DIGEST_RE: Final = re.compile(r"^[0-9a-f]{64}$")
_SYMBOL_RE: Final = re.compile(r"^[A-Za-z0-9]{1,40}$")
_UINT_RE: Final = re.compile(r"^(?:0|[1-9][0-9]*)$")
_DECIMAL_RE: Final = re.compile(r"^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$")
_SIDECAR_RE: Final = re.compile(
    rb"(?P<digest>[0-9a-f]{64})  (?P<filename>[A-Za-z0-9][A-Za-z0-9_.-]{0,127})\n?"
)
_RETRIEVED_AT_RE: Final = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$")
_SUPPORTED_COMPRESSIONS: Final = frozenset((zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED))

_LOCAL_FILE_HEADER: Final = struct.Struct("<4s5H3L2H")
_CENTRAL_DIRECTORY_HEADER: Final = struct.Struct("<4s6H3L5H2L")
_END_OF_CENTRAL_DIRECTORY: Final = struct.Struct("<4s4H2LH")
_LOCAL_FILE_SIGNATURE: Final = b"PK\x03\x04"
_CENTRAL_DIRECTORY_SIGNATURE: Final = b"PK\x01\x02"
_END_OF_CENTRAL_DIRECTORY_SIGNATURE: Final = b"PK\x05\x06"
_ZIP_DATA_DESCRIPTOR_FLAG: Final = 1 << 3

KLINE_FIELDS: Final[tuple[str, ...]] = (
    "open_time",
    "open",
    "high",
    "low",
    "close",
    "volume",
    "close_time",
    "quote_asset_volume",
    "number_of_trades",
    "taker_buy_base_asset_volume",
    "taker_buy_quote_asset_volume",
    "ignore",
)


class Decision(StrEnum):
    ADMISSIBLE = "ADMISSIBLE"
    ADMISSIBLE_WITH_EXCLUSIONS = "ADMISSIBLE_WITH_EXCLUSIONS"
    INADMISSIBLE = "INADMISSIBLE"


class NativeUnit(StrEnum):
    MILLISECOND = "MILLISECOND"
    MICROSECOND = "MICROSECOND"


class BoundaryError(ValueError):
    """Expected fail-closed validation error with a stable reason code."""

    def __init__(self, code: str, detail: str) -> None:
        super().__init__(detail)
        self.code = code
        self.detail = detail


def _require_digest(value: str, *, field: str) -> None:
    if not isinstance(value, str) or _DIGEST_RE.fullmatch(value) is None:
        raise ValueError(f"{field} must be a lowercase SHA-256 digest")


def _canonical_json(payload: object) -> bytes:
    return (
        json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True) + "\n"
    ).encode("ascii")


def _sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _parse_retrieved_at(value: str) -> None:
    if _RETRIEVED_AT_RE.fullmatch(value) is None:
        raise ValueError("retrieved_at must be canonical whole-second UTC")
    parsed = datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=UTC)
    if parsed.strftime("%Y-%m-%dT%H:%M:%SZ") != value:
        raise ValueError("retrieved_at must be canonical whole-second UTC")


@dataclass(frozen=True, slots=True)
class AcquisitionReceiptV1:
    """Frozen identity and transport metadata for one official public archive."""

    symbol: str
    cadence: Literal["daily", "monthly"]
    partition: str
    archive_url: str
    checksum_url: str
    retrieved_at: str
    http_etag: str
    http_last_modified: str
    archive_bytes: int
    archive_sha256: str
    checksum_sha256: str
    member_sha256: str

    def __post_init__(self) -> None:
        if _SYMBOL_RE.fullmatch(self.symbol) is None:
            raise ValueError("symbol must be an exact bounded ASCII path-safe identifier")
        if self.cadence not in ("daily", "monthly"):
            raise ValueError("cadence must be daily or monthly")
        _partition_bounds(self.cadence, self.partition)
        _parse_retrieved_at(self.retrieved_at)
        if (
            not self.http_etag
            or not self.http_etag.isascii()
            or len(self.http_etag) > 256
            or not self.http_last_modified
            or not self.http_last_modified.isascii()
            or len(self.http_last_modified) > 256
        ):
            raise ValueError("HTTP acquisition metadata must be bounded nonempty ASCII")
        if (
            isinstance(self.archive_bytes, bool)
            or not isinstance(self.archive_bytes, int)
            or self.archive_bytes <= 0
            or self.archive_bytes > MAX_ARCHIVE_BYTES
        ):
            raise ValueError("archive_bytes is outside the frozen bound")
        for field in ("archive_sha256", "checksum_sha256", "member_sha256"):
            _require_digest(cast(str, getattr(self, field)), field=field)
        if self.archive_url != self.expected_archive_url:
            raise ValueError("archive_url is not the exact official partition URL")
        if self.checksum_url != f"{self.expected_archive_url}.CHECKSUM":
            raise ValueError("checksum_url is not the exact adjacent official sidecar URL")
        for value in (self.archive_url, self.checksum_url):
            parsed = urlsplit(value)
            if (
                parsed.scheme != "https"
                or parsed.netloc != "data.binance.vision"
                or parsed.hostname != "data.binance.vision"
                or parsed.port is not None
                or parsed.username is not None
                or parsed.password is not None
                or parsed.query
                or parsed.fragment
                or "%" in parsed.path
            ):
                raise ValueError("source URLs must use exact unadorned official HTTPS paths")

    @property
    def archive_filename(self) -> str:
        return f"{self.symbol}-1d-{self.partition}.zip"

    @property
    def member_filename(self) -> str:
        return f"{self.symbol}-1d-{self.partition}.csv"

    @property
    def expected_archive_url(self) -> str:
        return (
            "https://data.binance.vision/data/spot/"
            f"{self.cadence}/klines/{self.symbol}/1d/{self.archive_filename}"
        )

    @property
    def canonical_bytes(self) -> bytes:
        return _canonical_json(
            {
                "schema": "dq1-acquisition-receipt-v1",
                "market": "spot",
                "dataType": "klines",
                "interval": "1d",
                **asdict(self),
                "archiveFilename": self.archive_filename,
                "memberFilename": self.member_filename,
            }
        )

    @property
    def digest(self) -> str:
        return _sha256(self.canonical_bytes)


@dataclass(frozen=True, slots=True)
class ValidationContextV1:
    """Digests frozen independently of the input archive."""

    policy_sha256: str
    validator_sha256: str
    runtime_lock_sha256: str
    public_data_docs_commit: str
    public_data_docs_sha256: str
    spot_api_docs_commit: str
    spot_api_docs_sha256: str

    def __post_init__(self) -> None:
        for field in (
            "policy_sha256",
            "validator_sha256",
            "runtime_lock_sha256",
            "public_data_docs_commit",
            "public_data_docs_sha256",
            "spot_api_docs_commit",
            "spot_api_docs_sha256",
        ):
            value = cast(str, getattr(self, field))
            if field.endswith("_commit"):
                if re.fullmatch(r"[0-9a-f]{40}", value) is None:
                    raise ValueError(f"{field} must be an exact Git commit")
            else:
                _require_digest(value, field=field)
        if (
            self.public_data_docs_commit != PUBLIC_DATA_DOCS_COMMIT
            or self.public_data_docs_sha256 != PUBLIC_DATA_DOCS_SHA256
            or self.spot_api_docs_commit != SPOT_API_DOCS_COMMIT
            or self.spot_api_docs_sha256 != SPOT_API_DOCS_SHA256
        ):
            raise ValueError("official source-document pins differ from the frozen DQ-1 policy")


def _verify_local_context(context: ValidationContextV1) -> None:
    expected = (
        ("policy", _DQ1_DIR / "policy.v1.json", context.policy_sha256),
        ("validator", _DQ1_DIR / "boundary.py", context.validator_sha256),
        ("runtime lock", _QUANT_DIR / "uv.lock", context.runtime_lock_sha256),
    )
    for label, path, pinned_digest in expected:
        try:
            computed_digest = _sha256(path.read_bytes())
        except OSError as error:
            raise BoundaryError(
                "LOCAL_CONTEXT_UNAVAILABLE", f"{label} artifact cannot be read"
            ) from error
        if not hmac.compare_digest(computed_digest, pinned_digest):
            raise BoundaryError(
                "CONTEXT_DRIFT", f"{label} digest differs from the executing local artifact"
            )


@dataclass(frozen=True, slots=True)
class _RawRow:
    ordinal: int
    byte_start: int
    byte_end_exclusive: int
    payload: bytes
    digest_with_lf: str
    fields: tuple[str, ...]
    open_native: int
    close_native: int


@dataclass(frozen=True, slots=True)
class BoundaryResultV1:
    decision: Decision
    receipt_bytes: bytes
    canonical_csv: bytes | None
    exclusions_bytes: bytes

    @property
    def receipt_sha256(self) -> str:
        return _sha256(self.receipt_bytes)

    @property
    def exclusions_sha256(self) -> str:
        return _sha256(self.exclusions_bytes)

    @property
    def canonical_csv_sha256(self) -> str | None:
        return None if self.canonical_csv is None else _sha256(self.canonical_csv)


def _partition_bounds(cadence: str, partition: str) -> tuple[date, date]:
    if cadence == "daily":
        try:
            start = date.fromisoformat(partition)
        except (TypeError, ValueError) as error:
            raise ValueError("daily partition must be canonical YYYY-MM-DD") from error
        if start.isoformat() != partition:
            raise ValueError("daily partition must be canonical YYYY-MM-DD")
        return start, date.fromordinal(start.toordinal() + 1)
    if cadence != "monthly" or re.fullmatch(r"[0-9]{4}-[0-9]{2}", partition) is None:
        raise ValueError("monthly partition must be canonical YYYY-MM")
    year, month = (int(value) for value in partition.split("-"))
    try:
        start = date(year, month, 1)
    except ValueError as error:
        raise ValueError("monthly partition must be canonical YYYY-MM") from error
    end = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
    return start, end


def _native_contract(receipt: AcquisitionReceiptV1) -> tuple[NativeUnit, int, int, int]:
    start, end = _partition_bounds(receipt.cadence, receipt.partition)
    native_unit = NativeUnit.MICROSECOND if start >= CUTOVER else NativeUnit.MILLISECOND
    day_native = DAY_US if native_unit is NativeUnit.MICROSECOND else DAY_MS
    partition_start = (start - EPOCH).days * day_native
    partition_end = (end - EPOCH).days * day_native
    return native_unit, day_native, partition_start, partition_end


def _parse_sidecar(checksum_bytes: bytes, *, receipt: AcquisitionReceiptV1) -> str:
    if type(checksum_bytes) is not bytes:
        raise BoundaryError("CHECKSUM_NOT_BYTES", "checksum evidence must be immutable bytes")
    if not checksum_bytes or len(checksum_bytes) > MAX_SIDECAR_BYTES:
        raise BoundaryError("CHECKSUM_SIZE_INVALID", "checksum sidecar violates its byte bound")
    if not hmac.compare_digest(_sha256(checksum_bytes), receipt.checksum_sha256):
        raise BoundaryError("INPUT_DRIFT", "checksum-file digest differs from acquisition receipt")
    match = _SIDECAR_RE.fullmatch(checksum_bytes)
    if match is None:
        raise BoundaryError(
            "CHECKSUM_FORMAT_INVALID", "checksum sidecar is not canonical sha256sum content"
        )
    if match.group("filename").decode("ascii") != receipt.archive_filename:
        raise BoundaryError(
            "CHECKSUM_FILENAME_MISMATCH", "sidecar filename differs from the pinned archive"
        )
    return match.group("digest").decode("ascii")


def _preflight_canonical_zip(archive_bytes: bytes, *, expected_member: str) -> tuple[int, int]:
    """Reject ambiguous or unsafe ZIP structures before decompression."""

    minimum_size = (
        _LOCAL_FILE_HEADER.size + _CENTRAL_DIRECTORY_HEADER.size + _END_OF_CENTRAL_DIRECTORY.size
    )
    if len(archive_bytes) < minimum_size:
        raise BoundaryError("ZIP_MALFORMED", "archive is too short")
    if archive_bytes[:4] != _LOCAL_FILE_SIGNATURE:
        raise BoundaryError("ZIP_MALFORMED", "first local header is not at offset zero")
    eocd_offset = len(archive_bytes) - _END_OF_CENTRAL_DIRECTORY.size
    if archive_bytes[eocd_offset : eocd_offset + 4] != _END_OF_CENTRAL_DIRECTORY_SIGNATURE:
        raise BoundaryError("ZIP_NONCANONICAL", "EOCD is not comment-free at archive end")
    unpacked_eocd = _END_OF_CENTRAL_DIRECTORY.unpack_from(archive_bytes, eocd_offset)
    (
        signature,
        disk_number,
        central_disk_number,
        entries_on_disk,
        total_entries,
        central_size,
        central_offset,
        comment_length,
    ) = unpacked_eocd
    if (signature, disk_number, central_disk_number, comment_length) != (
        _END_OF_CENTRAL_DIRECTORY_SIGNATURE,
        0,
        0,
        0,
    ):
        raise BoundaryError("ZIP_NONCANONICAL", "ZIP must be single-disk and comment-free")
    if (entries_on_disk, total_entries) != (1, 1):
        raise BoundaryError("ZIP_MEMBER_COUNT_INVALID", "ZIP must declare exactly one member")
    if central_offset + central_size != eocd_offset:
        raise BoundaryError("ZIP_NONCANONICAL", "central directory span is ambiguous")
    if central_size < _CENTRAL_DIRECTORY_HEADER.size:
        raise BoundaryError("ZIP_MALFORMED", "central directory is truncated")
    central = _CENTRAL_DIRECTORY_HEADER.unpack_from(archive_bytes, central_offset)
    (
        central_signature,
        _version_made,
        version_needed,
        flags,
        compression,
        modified_time,
        modified_date,
        crc32_value,
        compressed_size,
        uncompressed_size,
        name_length,
        extra_length,
        member_comment_length,
        disk_start,
        _internal_attributes,
        external_attributes,
        local_offset,
    ) = central
    if central_signature != _CENTRAL_DIRECTORY_SIGNATURE:
        raise BoundaryError("ZIP_MALFORMED", "central directory signature is missing")
    central_record_end = (
        central_offset
        + _CENTRAL_DIRECTORY_HEADER.size
        + name_length
        + extra_length
        + member_comment_length
    )
    if central_record_end != eocd_offset:
        raise BoundaryError("ZIP_MEMBER_COUNT_INVALID", "ZIP has extra central entries or bytes")
    if disk_start != 0 or local_offset != 0:
        raise BoundaryError("ZIP_NONCANONICAL", "member offsets are not canonical")
    local = _LOCAL_FILE_HEADER.unpack_from(archive_bytes, 0)
    (
        local_signature,
        local_version_needed,
        local_flags,
        local_compression,
        local_modified_time,
        local_modified_date,
        local_crc32,
        local_compressed_size,
        local_uncompressed_size,
        local_name_length,
        local_extra_length,
    ) = local
    if local_signature != _LOCAL_FILE_SIGNATURE:
        raise BoundaryError("ZIP_MALFORMED", "local header signature is missing")
    local_name_start = _LOCAL_FILE_HEADER.size
    local_name_end = local_name_start + local_name_length
    local_payload_start = local_name_end + local_extra_length
    if local_payload_start > central_offset:
        raise BoundaryError("ZIP_MALFORMED", "local member span is truncated")
    if local_flags & _ZIP_DATA_DESCRIPTOR_FLAG:
        raise BoundaryError("ZIP_NONCANONICAL", "streaming data descriptors are forbidden")
    if (local_extra_length, extra_length, member_comment_length) != (0, 0, 0):
        raise BoundaryError("ZIP_NONCANONICAL", "ZIP extras and member comments are forbidden")
    if (
        local_version_needed,
        local_flags,
        local_compression,
        local_modified_time,
        local_modified_date,
        local_crc32,
        local_compressed_size,
        local_uncompressed_size,
    ) != (
        version_needed,
        flags,
        compression,
        modified_time,
        modified_date,
        crc32_value,
        compressed_size,
        uncompressed_size,
    ):
        raise BoundaryError("ZIP_NONCANONICAL", "local and central metadata disagree")
    central_name_start = central_offset + _CENTRAL_DIRECTORY_HEADER.size
    local_name = archive_bytes[local_name_start:local_name_end]
    central_name = archive_bytes[central_name_start : central_name_start + name_length]
    expected_name = expected_member.encode("ascii")
    if (local_name, central_name) != (expected_name, expected_name):
        raise BoundaryError("ZIP_MEMBER_NAME_INVALID", "member name differs from the pinned CSV")
    if local_payload_start + compressed_size != central_offset:
        raise BoundaryError("ZIP_NONCANONICAL", "ZIP contains unaccounted container bytes")
    if flags & 0x1:
        raise BoundaryError("ZIP_ENCRYPTED", "encrypted members are forbidden")
    if compression not in _SUPPORTED_COMPRESSIONS:
        raise BoundaryError("ZIP_COMPRESSION_UNSUPPORTED", "compression method is unsupported")
    if uncompressed_size <= 0 or uncompressed_size > MAX_MEMBER_BYTES:
        raise BoundaryError("ZIP_MEMBER_SIZE_INVALID", "member violates its byte bound")
    if compressed_size <= 0:
        raise BoundaryError("ZIP_COMPRESSED_SIZE_INVALID", "compressed size must be positive")
    if uncompressed_size > compressed_size * MAX_COMPRESSION_RATIO:
        raise BoundaryError("ZIP_RATIO_EXCEEDED", "member exceeds the compression-ratio cap")
    file_type = stat.S_IFMT(external_attributes >> 16)
    if file_type not in (0, stat.S_IFREG):
        raise BoundaryError("ZIP_MEMBER_TYPE_INVALID", "member is not a regular file")
    if compression == zipfile.ZIP_DEFLATED:
        compressed = archive_bytes[local_payload_start:central_offset]
        decoder = zlib.decompressobj(-zlib.MAX_WBITS)
        try:
            decoded = decoder.decompress(compressed, uncompressed_size + 1)
            decoded += decoder.flush()
        except zlib.error as error:
            raise BoundaryError("ZIP_MALFORMED", "DEFLATE stream is malformed") from error
        if (
            decoder.unconsumed_tail
            or not decoder.eof
            or decoder.unused_data
            or len(decoded) != uncompressed_size
        ):
            raise BoundaryError("ZIP_MALFORMED", "DEFLATE span does not match its declaration")
    return compressed_size, uncompressed_size


def _read_member(archive_bytes: bytes, *, receipt: AcquisitionReceiptV1) -> bytes:
    _preflight_canonical_zip(archive_bytes, expected_member=receipt.member_filename)
    try:
        with zipfile.ZipFile(io.BytesIO(archive_bytes), mode="r") as archive:
            members = archive.infolist()
            if len(members) != 1:
                raise BoundaryError("ZIP_MEMBER_COUNT_INVALID", "ZIP must contain one member")
            member = members[0]
            if (
                member.filename != receipt.member_filename
                or member.orig_filename != receipt.member_filename
                or "/" in member.filename
                or "\\" in member.filename
                or member.is_dir()
            ):
                raise BoundaryError(
                    "ZIP_MEMBER_NAME_INVALID", "member is not the exact pinned basename"
                )
            with archive.open(member, mode="r") as stream:
                payload = stream.read(MAX_MEMBER_BYTES + 1)
    except BoundaryError:
        raise
    except (
        EOFError,
        NotImplementedError,
        OSError,
        RuntimeError,
        ValueError,
        zipfile.BadZipFile,
        zipfile.LargeZipFile,
    ) as error:
        raise BoundaryError("ZIP_MALFORMED", "archive cannot be safely decoded") from error
    if len(payload) > MAX_MEMBER_BYTES:
        raise BoundaryError("ZIP_MEMBER_SIZE_INVALID", "decoded member exceeds its byte bound")
    if not hmac.compare_digest(_sha256(payload), receipt.member_sha256):
        raise BoundaryError("INPUT_DRIFT", "member digest differs from acquisition receipt")
    return payload


def _parse_uint(text: str, *, field: str, allow_zero: bool = True) -> int:
    if _UINT_RE.fullmatch(text) is None:
        raise BoundaryError("CSV_NUMERIC_INVALID", f"{field} is not a canonical unsigned integer")
    if len(text) > len(str(INT64_MAX)) or (
        len(text) == len(str(INT64_MAX)) and text > str(INT64_MAX)
    ):
        raise BoundaryError("CSV_NUMERIC_OVERFLOW", f"{field} exceeds int64")
    value = int(text)
    if not allow_zero and value == 0:
        raise BoundaryError("CSV_NUMERIC_INVALID", f"{field} must be positive")
    return value


def _parse_decimal(text: str, *, field: str, positive: bool) -> Decimal:
    if _DECIMAL_RE.fullmatch(text) is None:
        raise BoundaryError("CSV_NUMERIC_INVALID", f"{field} is not canonical decimal text")
    digits = text.replace(".", "").lstrip("0") or "0"
    fraction = text.partition(".")[2]
    if len(digits) > 38 or len(fraction) > 38:
        raise BoundaryError("CSV_NUMERIC_OVERFLOW", f"{field} exceeds the decimal bound")
    try:
        value = Decimal(text)
    except InvalidOperation as error:
        raise BoundaryError("CSV_NUMERIC_INVALID", f"{field} is invalid") from error
    if (positive and value <= 0) or (not positive and value < 0):
        requirement = "positive" if positive else "nonnegative"
        raise BoundaryError("CSV_NUMERIC_INVALID", f"{field} must be {requirement}")
    return value


def _parse_rows(member: bytes) -> list[_RawRow]:
    if member.startswith(b"\xef\xbb\xbf"):
        raise BoundaryError("CSV_BOM_FORBIDDEN", "CSV must not contain a byte-order mark")
    if not member.endswith(b"\n"):
        raise BoundaryError("CSV_TERMINATOR_INVALID", "CSV must end in one LF")
    if b"\r" in member:
        raise BoundaryError("CSV_TERMINATOR_INVALID", "CSV must use LF, not CRLF")
    if b"\x00" in member:
        raise BoundaryError("CSV_NUL_FORBIDDEN", "CSV must not contain NUL")
    rows: list[_RawRow] = []
    start = 0
    for offset, byte in enumerate(member):
        if byte != 10:
            if offset - start + 1 > MAX_LINE_BYTES:
                raise BoundaryError("CSV_ROW_SIZE_INVALID", "CSV row exceeds its byte bound")
            continue
        ordinal = len(rows) + 1
        if ordinal > MAX_ROWS:
            raise BoundaryError("CSV_ROW_COUNT_INVALID", "CSV row count exceeds its bound")
        payload = member[start:offset]
        if not payload:
            raise BoundaryError("CSV_BLANK_ROW", f"row {ordinal} is blank")
        if b'"' in payload:
            raise BoundaryError("CSV_QUOTING_FORBIDDEN", f"row {ordinal} uses quoting")
        try:
            text = payload.decode("ascii", errors="strict")
        except UnicodeDecodeError as error:
            raise BoundaryError("CSV_ASCII_REQUIRED", f"row {ordinal} is not ASCII") from error
        values = tuple(text.split(","))
        if len(values) != len(KLINE_FIELDS):
            raise BoundaryError(
                "CSV_FIELD_COUNT_INVALID",
                f"row {ordinal} has {len(values)} fields; expected {len(KLINE_FIELDS)}",
            )
        if ordinal == 1 and values == KLINE_FIELDS:
            raise BoundaryError("CSV_HEADER_FORBIDDEN", "header mode is frozen to ABSENT")
        open_native = _parse_uint(values[0], field=f"row {ordinal} open_time", allow_zero=False)
        close_native = _parse_uint(values[6], field=f"row {ordinal} close_time", allow_zero=False)
        open_price = _parse_decimal(values[1], field=f"row {ordinal} open", positive=True)
        high = _parse_decimal(values[2], field=f"row {ordinal} high", positive=True)
        low = _parse_decimal(values[3], field=f"row {ordinal} low", positive=True)
        close_price = _parse_decimal(values[4], field=f"row {ordinal} close", positive=True)
        volume = _parse_decimal(values[5], field=f"row {ordinal} volume", positive=False)
        quote_volume = _parse_decimal(
            values[7], field=f"row {ordinal} quote volume", positive=False
        )
        _parse_uint(values[8], field=f"row {ordinal} trade count")
        taker_base = _parse_decimal(values[9], field=f"row {ordinal} taker base", positive=False)
        taker_quote = _parse_decimal(values[10], field=f"row {ordinal} taker quote", positive=False)
        _parse_decimal(values[11], field=f"row {ordinal} ignore", positive=False)
        if high < max(open_price, close_price, low) or low > min(open_price, close_price, high):
            raise BoundaryError("CSV_OHLC_INVALID", f"row {ordinal} violates OHLC geometry")
        if taker_base > volume or taker_quote > quote_volume:
            raise BoundaryError(
                "CSV_TAKER_VOLUME_INVALID", f"row {ordinal} taker volume exceeds total"
            )
        rows.append(
            _RawRow(
                ordinal=ordinal,
                byte_start=start,
                byte_end_exclusive=offset,
                payload=payload,
                digest_with_lf=_sha256(payload + b"\n"),
                fields=values,
                open_native=open_native,
                close_native=close_native,
            )
        )
        start = offset + 1
    if not rows:
        raise BoundaryError("CSV_ROW_COUNT_INVALID", "CSV contains no data rows")
    return rows


def _group_rows(rows: list[_RawRow]) -> tuple[list[_RawRow], list[dict[str, object]]]:
    logical: list[_RawRow] = []
    duplicate_events: list[dict[str, object]] = []
    seen: dict[int, _RawRow] = {}
    index = 0
    while index < len(rows):
        first = rows[index]
        if logical and first.open_native < logical[-1].open_native:
            code = "NONADJACENT_DUPLICATE" if first.open_native in seen else "OPEN_TIME_DESCENDING"
            raise BoundaryError(code, f"row {first.ordinal} is not in physical open-time order")
        run = [first]
        index += 1
        while index < len(rows) and rows[index].open_native == first.open_native:
            run.append(rows[index])
            index += 1
        if first.open_native in seen:
            raise BoundaryError(
                "NONADJACENT_DUPLICATE",
                f"row {first.ordinal} repeats a nonadjacent logical open time",
            )
        seen[first.open_native] = first
        if len(run) > 1:
            if len(run) > MAX_DUPLICATE_RUN_LENGTH:
                raise BoundaryError(
                    "DUPLICATE_RUN_CAP_EXCEEDED",
                    f"same-open run at row {first.ordinal} exceeds the frozen cap",
                )
            if len(duplicate_events) >= MAX_DUPLICATE_GROUPS:
                raise BoundaryError(
                    "DUPLICATE_GROUP_CAP_EXCEEDED",
                    "archive exceeds the frozen duplicate-group cap",
                )
            if any(candidate.payload != first.payload for candidate in run[1:]):
                raise BoundaryError(
                    "DUPLICATE_BYTE_CONFLICT",
                    f"same-open run at row {first.ordinal} is byte-distinct",
                )
            duplicate_events.append(
                {
                    "code": "ADJACENT_IDENTICAL_DUPLICATE_COLLAPSED",
                    "extraCoverageGranted": False,
                    "openNative": first.open_native,
                    "keptOrdinal": first.ordinal,
                    "droppedOrdinals": [row.ordinal for row in run[1:]],
                    "records": [
                        {
                            "ordinal": row.ordinal,
                            "byteStart": row.byte_start,
                            "byteEndExclusive": row.byte_end_exclusive,
                            "sha256WithLf": row.digest_with_lf,
                        }
                        for row in run
                    ],
                }
            )
        logical.append(first)
    return logical, duplicate_events


def _iso_date_from_native(open_native: int, day_native: int) -> str:
    day_index, remainder = divmod(open_native, day_native)
    if remainder:
        raise BoundaryError("OPEN_NOT_UTC_MIDNIGHT", "open time is not exact UTC midnight")
    try:
        return date.fromordinal(EPOCH.toordinal() + day_index).isoformat()
    except ValueError as error:
        raise BoundaryError("TIMESTAMP_OUT_OF_RANGE", "open time is outside date range") from error


def _range_payload(start_day: int, end_day: int) -> dict[str, str]:
    return {
        "startInclusive": date.fromordinal(EPOCH.toordinal() + start_day).isoformat(),
        "endExclusive": date.fromordinal(EPOCH.toordinal() + end_day).isoformat(),
    }


def _missing_ranges(
    *, partition_start: int, partition_end: int, day_native: int, admitted: list[_RawRow]
) -> list[dict[str, str]]:
    start_day = partition_start // day_native
    end_day = partition_end // day_native
    present = {row.open_native // day_native for row in admitted}
    result: list[dict[str, str]] = []
    cursor = start_day
    while cursor < end_day:
        if cursor in present:
            cursor += 1
            continue
        missing_start = cursor
        while cursor < end_day and cursor not in present:
            cursor += 1
        result.append(_range_payload(missing_start, cursor))
    return result


def _canonical_row(row: _RawRow, *, scale_to_us: int) -> bytes:
    fields = list(row.fields)
    fields[0] = str(row.open_native * scale_to_us)
    fields[6] = str(row.close_native * scale_to_us)
    return (",".join(fields) + "\n").encode("ascii")


def _failure_result(
    *,
    receipt: AcquisitionReceiptV1,
    context: ValidationContextV1,
    error: BoundaryError,
    archive_digest: str,
    checksum_digest: str,
    local_context_verified: bool,
) -> BoundaryResultV1:
    exclusions = _canonical_json(
        {
            "schema": EXCLUSION_SCHEMA_ID,
            "policyId": POLICY_ID,
            "partition": receipt.partition,
            "symbol": receipt.symbol,
            "events": [],
            "status": "NOT_EMITTED_INPUT_INADMISSIBLE",
        }
    )
    payload = {
        "schema": RECEIPT_SCHEMA_ID,
        "decision": Decision.INADMISSIBLE,
        "reasonCodes": [error.code],
        "error": {"code": error.code, "detail": error.detail},
        "policy": {"id": POLICY_ID, "sha256": context.policy_sha256},
        "validatorSha256": context.validator_sha256,
        "runtimeLockSha256": context.runtime_lock_sha256,
        "sourceDocuments": {
            "publicData": {
                "commit": context.public_data_docs_commit,
                "sha256": context.public_data_docs_sha256,
            },
            "spotApi": {
                "commit": context.spot_api_docs_commit,
                "sha256": context.spot_api_docs_sha256,
            },
        },
        "contextVerification": {
            "localPolicyValidatorRuntimeDigestsVerified": local_context_verified,
            "officialDocumentPinsMatchFrozenConstants": True,
        },
        "acquisitionReceiptSha256": receipt.digest,
        "input": {
            "archiveSha256Computed": archive_digest,
            "checksumSha256Computed": checksum_digest,
        },
        "canonicalOutput": None,
        "exclusionsSha256": _sha256(exclusions),
    }
    return BoundaryResultV1(
        decision=Decision.INADMISSIBLE,
        receipt_bytes=_canonical_json(payload),
        canonical_csv=None,
        exclusions_bytes=exclusions,
    )


def validate_archive(
    *,
    archive_bytes: bytes,
    checksum_bytes: bytes,
    receipt: AcquisitionReceiptV1,
    context: ValidationContextV1,
) -> BoundaryResultV1:
    """Validate one frozen archive and emit deterministic complete-bar custody artifacts."""

    archive_digest = _sha256(archive_bytes) if type(archive_bytes) is bytes else "NOT_BYTES"
    checksum_digest = _sha256(checksum_bytes) if type(checksum_bytes) is bytes else "NOT_BYTES"
    local_context_verified = False
    try:
        _verify_local_context(context)
        local_context_verified = True
        if type(archive_bytes) is not bytes:
            raise BoundaryError("ARCHIVE_NOT_BYTES", "archive evidence must be immutable bytes")
        if not archive_bytes or len(archive_bytes) > MAX_ARCHIVE_BYTES:
            raise BoundaryError("ARCHIVE_SIZE_INVALID", "archive violates its byte bound")
        if len(archive_bytes) != receipt.archive_bytes:
            raise BoundaryError(
                "INPUT_DRIFT", "archive byte count differs from acquisition receipt"
            )
        if not hmac.compare_digest(archive_digest, receipt.archive_sha256):
            raise BoundaryError("INPUT_DRIFT", "archive digest differs from acquisition receipt")
        sidecar_archive_digest = _parse_sidecar(checksum_bytes, receipt=receipt)
        if not hmac.compare_digest(sidecar_archive_digest, archive_digest):
            raise BoundaryError(
                "CHECKSUM_ARCHIVE_MISMATCH",
                "computed ZIP digest does not equal the pinned sidecar entry",
            )
        member = _read_member(archive_bytes, receipt=receipt)
        rows = _parse_rows(member)
        logical, duplicate_events = _group_rows(rows)
        native_unit, day_native, partition_start, partition_end = _native_contract(receipt)
        scale_to_us = 1 if native_unit is NativeUnit.MICROSECOND else 1_000
        admitted: list[_RawRow] = []
        terminal_events: list[dict[str, object]] = []
        for logical_index, row in enumerate(logical):
            if not partition_start <= row.open_native < partition_end:
                raise BoundaryError(
                    "OPEN_OUTSIDE_PARTITION",
                    f"row {row.ordinal} open is outside the pinned partition or uses wrong units",
                )
            _iso_date_from_native(row.open_native, day_native)
            expected_close = row.open_native + day_native - 1
            if row.close_native == expected_close:
                admitted.append(row)
                continue
            if row.close_native < row.open_native:
                raise BoundaryError(
                    "CLOSE_BEFORE_OPEN", f"row {row.ordinal} close time precedes open time"
                )
            if row.close_native > expected_close:
                raise BoundaryError(
                    "CLOSE_AFTER_INTERVAL",
                    f"row {row.ordinal} close time exceeds the daily interval",
                )
            if logical_index != len(logical) - 1:
                raise BoundaryError(
                    "NONTERMINAL_TRUNCATED_INTERVAL",
                    f"row {row.ordinal} is truncated before a later logical open",
                )
            terminal_events.append(
                {
                    "code": "TERMINAL_TRUNCATED_INTERVAL_EXCLUDED",
                    "ordinal": row.ordinal,
                    "byteStart": row.byte_start,
                    "byteEndExclusive": row.byte_end_exclusive,
                    "sha256WithLf": row.digest_with_lf,
                    "openNative": row.open_native,
                    "openUs": row.open_native * scale_to_us,
                    "actualCloseNative": row.close_native,
                    "expectedCloseNative": expected_close,
                    "shortfallNative": expected_close - row.close_native,
                    "intervalEndExclusiveUs": (row.open_native + day_native) * scale_to_us,
                    "provedFinalLogicalGroup": True,
                    "reasonUnknown": True,
                    "consumerCensoringRequired": True,
                }
            )
        if not admitted:
            raise BoundaryError(
                "NO_COMPLETE_ROWS", "archive has no complete daily row eligible for output"
            )
        exclusion_events = [*duplicate_events, *terminal_events]
        canonical_csv = b"".join(_canonical_row(row, scale_to_us=scale_to_us) for row in admitted)
        exclusions = _canonical_json(
            {
                "schema": EXCLUSION_SCHEMA_ID,
                "policyId": POLICY_ID,
                "partition": receipt.partition,
                "symbol": receipt.symbol,
                "events": exclusion_events,
                "status": "PRESENT" if exclusion_events else "EMPTY",
            }
        )
        decision = Decision.ADMISSIBLE_WITH_EXCLUSIONS if exclusion_events else Decision.ADMISSIBLE
        dropped_count = sum(
            len(cast(list[int], event["droppedOrdinals"])) for event in duplicate_events
        )
        quarantined_count = len(terminal_events)
        if len(rows) != len(logical) + dropped_count:
            raise AssertionError("raw/logical reconciliation failed")
        if len(logical) != len(admitted) + quarantined_count:
            raise AssertionError("logical/admitted reconciliation failed")
        first = admitted[0]
        last = admitted[-1]
        receipt_payload = {
            "schema": RECEIPT_SCHEMA_ID,
            "decision": decision,
            "reasonCodes": [cast(str, event["code"]) for event in exclusion_events],
            "policy": {
                "id": POLICY_ID,
                "sha256": context.policy_sha256,
                "allowedExclusions": [
                    "ADJACENT_IDENTICAL_DUPLICATE_COLLAPSED",
                    "TERMINAL_TRUNCATED_INTERVAL_EXCLUDED",
                ],
                "maxDuplicateGroups": MAX_DUPLICATE_GROUPS,
                "maxDuplicateRunLength": MAX_DUPLICATE_RUN_LENGTH,
            },
            "validatorSha256": context.validator_sha256,
            "runtimeLockSha256": context.runtime_lock_sha256,
            "sourceDocuments": {
                "publicData": {
                    "commit": context.public_data_docs_commit,
                    "sha256": context.public_data_docs_sha256,
                },
                "spotApi": {
                    "commit": context.spot_api_docs_commit,
                    "sha256": context.spot_api_docs_sha256,
                },
            },
            "contextVerification": {
                "localPolicyValidatorRuntimeDigestsVerified": True,
                "officialDocumentPinsMatchFrozenConstants": True,
            },
            "source": {
                "market": "spot",
                "dataType": "klines",
                "interval": "1d",
                "symbol": receipt.symbol,
                "cadence": receipt.cadence,
                "partition": receipt.partition,
                "archiveUrl": receipt.archive_url,
                "checksumUrl": receipt.checksum_url,
                "archiveFilename": receipt.archive_filename,
                "memberFilename": receipt.member_filename,
                "retrievedAt": receipt.retrieved_at,
                "httpEtag": receipt.http_etag,
                "httpLastModified": receipt.http_last_modified,
            },
            "timestamps": {
                "nativeUnit": native_unit,
                "nativeToUsMultiplier": scale_to_us,
                "unitAuthority": "PINNED_ARCHIVE_PARTITION_CUTOVER_NOT_MAGNITUDE",
                "completePredicate": "closeNative==openNative+dayNative-1",
                "canonicalPublishedCloseRule": "closeUs=closeNative*nativeToUsMultiplier",
                "halfOpenIntervalRule": "[openUs,intervalEndExclusiveUs)",
            },
            "custody": {
                "acquisitionReceiptSha256": receipt.digest,
                "archiveBytes": len(archive_bytes),
                "archiveSha256": archive_digest,
                "checksumFileSha256": checksum_digest,
                "checksumEntrySha256": sidecar_archive_digest,
                "memberBytes": len(member),
                "memberSha256": _sha256(member),
                "rawSequenceSha256": _sha256(b"".join(row.payload + b"\n" for row in rows)),
                "logicalSequenceSha256": _sha256(b"".join(row.payload + b"\n" for row in logical)),
                "canonicalOutputSha256": _sha256(canonical_csv),
                "exclusionsSha256": _sha256(exclusions),
            },
            "counts": {
                "rawRows": len(rows),
                "logicalRows": len(logical),
                "admittedCompleteRows": len(admitted),
                "duplicateDroppedRows": dropped_count,
                "terminalQuarantinedRows": quarantined_count,
                "rawEqualsLogicalPlusDropped": True,
                "logicalEqualsAdmittedPlusQuarantined": True,
            },
            "coverage": {
                "completenessAuthority": "UNASSESSED",
                "firstAdmittedOpenUs": first.open_native * scale_to_us,
                "lastAdmittedOpenUs": last.open_native * scale_to_us,
                "logicalOpenMissingRanges": _missing_ranges(
                    partition_start=partition_start,
                    partition_end=partition_end,
                    day_native=day_native,
                    admitted=logical,
                ),
                "noAdmittedCompleteRowRanges": _missing_ranges(
                    partition_start=partition_start,
                    partition_end=partition_end,
                    day_native=day_native,
                    admitted=admitted,
                ),
                "rangeMeaning": (
                    "LOGICAL_OPEN_OBSERVATION_AND_COMPLETE_BAR_ELIGIBILITY_ONLY_"
                    "NOT_LIFECYCLE_OR_REQUIRED_COVERAGE"
                ),
            },
            "canonicalOutput": {
                "schema": CANONICAL_OUTPUT_SCHEMA_ID,
                "headerMode": "ABSENT",
                "timestamps": "MICROSECOND",
                "completeRowsOnly": True,
            },
            "exclusions": exclusion_events,
            "consumerGate": (
                "MATCH_POLICY_VALIDATOR_RUNTIME_INPUT_OUTPUT_EXCLUSIONS_"
                "DATASET_INVENTORY_AND_PREDECLARED_CENSORING_RULE"
            ),
            "authority": {
                "retroactiveRepair": False,
                "experimentRerun": False,
                "holdoutOpen": False,
                "providerPrivateMoneyEffects": False,
            },
        }
        return BoundaryResultV1(
            decision=decision,
            receipt_bytes=_canonical_json(receipt_payload),
            canonical_csv=canonical_csv,
            exclusions_bytes=exclusions,
        )
    except BoundaryError as error:
        return _failure_result(
            receipt=receipt,
            context=context,
            error=error,
            archive_digest=archive_digest,
            checksum_digest=checksum_digest,
            local_context_verified=local_context_verified,
        )


def _atomic_write(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary_name, path)
    except BaseException:
        with suppress(FileNotFoundError):
            os.unlink(temporary_name)
        raise


def _bounded_read(path: Path, *, maximum: int) -> bytes:
    try:
        metadata = path.stat()
    except OSError as error:
        raise ValueError(f"{path.name} cannot be inspected") from error
    if not stat.S_ISREG(metadata.st_mode):
        raise ValueError(f"{path.name} must be a regular file")
    if metadata.st_size < 0 or metadata.st_size > maximum:
        raise ValueError(f"{path.name} exceeds its read bound")
    try:
        with path.open("rb") as stream:
            payload = stream.read(maximum + 1)
    except OSError as error:
        raise ValueError(f"{path.name} cannot be read") from error
    if len(payload) > maximum:
        raise ValueError(f"{path.name} grew beyond its read bound")
    return payload


def _load_receipt(path: Path) -> AcquisitionReceiptV1:
    payload = json.loads(_bounded_read(path, maximum=MAX_CONFIG_BYTES))
    if not isinstance(payload, dict):
        raise ValueError("acquisition receipt JSON must be an object")
    return AcquisitionReceiptV1(**payload)


def _load_context(path: Path) -> ValidationContextV1:
    payload = json.loads(_bounded_read(path, maximum=MAX_CONFIG_BYTES))
    if not isinstance(payload, dict):
        raise ValueError("validation context JSON must be an object")
    return ValidationContextV1(**payload)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--checksum", type=Path, required=True)
    parser.add_argument("--acquisition-receipt", type=Path, required=True)
    parser.add_argument("--validation-context", type=Path, required=True)
    parser.add_argument("--receipt-out", type=Path, required=True)
    parser.add_argument("--canonical-out", type=Path, required=True)
    parser.add_argument("--exclusions-out", type=Path, required=True)
    arguments = parser.parse_args(argv)
    receipt = _load_receipt(arguments.acquisition_receipt)
    context = _load_context(arguments.validation_context)
    result = validate_archive(
        archive_bytes=_bounded_read(arguments.archive, maximum=MAX_ARCHIVE_BYTES),
        checksum_bytes=_bounded_read(arguments.checksum, maximum=MAX_SIDECAR_BYTES),
        receipt=receipt,
        context=context,
    )
    _atomic_write(arguments.receipt_out, result.receipt_bytes)
    if result.decision is Decision.INADMISSIBLE:
        for path in (arguments.canonical_out, arguments.exclusions_out):
            with suppress(FileNotFoundError):
                path.unlink()
        return 2
    if result.canonical_csv is None:
        raise AssertionError("admissible result must carry canonical output")
    _atomic_write(arguments.canonical_out, result.canonical_csv)
    _atomic_write(arguments.exclusions_out, result.exclusions_bytes)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
