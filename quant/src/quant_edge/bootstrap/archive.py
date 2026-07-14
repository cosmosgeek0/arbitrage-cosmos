from __future__ import annotations

import hashlib
import hmac
import io
import re
import stat
import struct
import zipfile
import zlib
from dataclasses import dataclass
from datetime import date
from itertools import pairwise
from typing import Final
from urllib.parse import urlsplit

from quant_edge.errors import ContractValueError
from quant_edge.lake.contracts import (
    INT64_MAX,
    UINT64_MAX,
    UTC_NS_MAX,
    UTC_NS_MIN,
    DigestV1,
    EvidencePosture,
    ExactScaledValueV1,
    QualityFactsV1,
    RawTimestampV1,
    ReferenceMarketEvidenceRowV1,
    TimestampBasis,
    TimestampUnit,
    derive_quality,
    require_contract_id,
    require_strict_int,
)

BINANCE_ARCHIVE_ORIGIN: Final = "https://data.binance.vision"
BINANCE_ARCHIVE_SOURCE_ID: Final = "binance.public.archive.spot.aggTrades"
BINANCE_ARCHIVE_SOURCE_ENDPOINT: Final = "data.binance.vision"
BINANCE_SPOT_AGG_TRADES_COLUMNS: Final[tuple[str, ...]] = (
    "aggregate_trade_id",
    "price",
    "quantity",
    "first_trade_id",
    "last_trade_id",
    "timestamp",
    "buyer_was_maker",
    "best_price_match",
)
BINANCE_SPOT_AGG_TRADES_SCHEMA_FINGERPRINT: Final = DigestV1(
    hashlib.sha256(
        (
            "BinanceSpotDailyAggTradesCsvV1\n"
            + "\n".join(BINANCE_SPOT_AGG_TRADES_COLUMNS)
            + "\nno-header\nstrict-ascii-canonical-numerics\n"
            + "canonical-single-member-zip-v1\n"
            + "strictly-increasing-aggregate-trade-ids\n"
            + "monotone-non-overlapping-underlying-trade-id-ranges\n"
            + "nondecreasing-source-event-time\n"
            + "discontinuity=aggregate-or-underlying-id-break\n"
        ).encode("ascii")
    ).hexdigest()
)

_DAY_NS: Final = 86_400_000_000_000
_EPOCH_DATE: Final = date(1970, 1, 1)
_SYMBOL_PATTERN: Final = re.compile(r"^[A-Z0-9]{2,40}$")
_SIDECAR_PATTERN: Final = re.compile(
    rb"(?P<digest>[0-9a-f]{64})  (?P<filename>[A-Za-z0-9][A-Za-z0-9_.-]{0,127})\n?"
)
_UNSIGNED_INTEGER_PATTERN: Final = re.compile(r"^(?:0|[1-9][0-9]*)$")
_POSITIVE_DECIMAL_PATTERN: Final = re.compile(
    r"^(?P<integer>0|[1-9][0-9]*)(?:\.(?P<fraction>[0-9]+))?$"
)
_FORBIDDEN_NESTED_SUFFIXES: Final = (
    ".7z",
    ".bz2",
    ".gz",
    ".rar",
    ".tar",
    ".tgz",
    ".xz",
    ".zip",
)
_SUPPORTED_COMPRESSIONS: Final = frozenset((zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED))
_LOCAL_FILE_HEADER: Final = struct.Struct("<4s5H3L2H")
_CENTRAL_DIRECTORY_HEADER: Final = struct.Struct("<4s6H3L5H2L")
_END_OF_CENTRAL_DIRECTORY: Final = struct.Struct("<4s4H2LH")
_LOCAL_FILE_SIGNATURE: Final = b"PK\x03\x04"
_CENTRAL_DIRECTORY_SIGNATURE: Final = b"PK\x01\x02"
_END_OF_CENTRAL_DIRECTORY_SIGNATURE: Final = b"PK\x05\x06"
_ZIP_DATA_DESCRIPTOR_FLAG: Final = 1 << 3

DEFAULT_MAX_ARCHIVE_BYTES: Final = 16 * 1024 * 1024
DEFAULT_MAX_MEMBER_BYTES: Final = 64 * 1024 * 1024
DEFAULT_MAX_ROWS: Final = 1_000_000
DEFAULT_MAX_LINE_BYTES: Final = 4_096
DEFAULT_MAX_COMPRESSION_RATIO: Final = 200
DEFAULT_MAX_SIDECAR_BYTES: Final = 256

ABSOLUTE_MAX_ARCHIVE_BYTES: Final = 64 * 1024 * 1024
ABSOLUTE_MAX_MEMBER_BYTES: Final = 256 * 1024 * 1024
ABSOLUTE_MAX_ROWS: Final = 2_000_000
ABSOLUTE_MAX_LINE_BYTES: Final = 16_384
ABSOLUTE_MAX_COMPRESSION_RATIO: Final = 1_000
ABSOLUTE_MAX_SIDECAR_BYTES: Final = 1_024


class ArchiveImportError(ContractValueError):
    """Raised when supplied archive evidence violates the bounded Q03 contract."""


def _bounded_positive_int(value: object, *, field: str, maximum: int) -> int:
    try:
        result = require_strict_int(value, field=field, minimum=1, maximum=maximum)
    except ContractValueError as error:
        raise ArchiveImportError(str(error)) from error
    return result


@dataclass(frozen=True, slots=True)
class ArchiveImportLimitsV1:
    """Caller-tunable limits that can only tighten or stay within hard process ceilings."""

    max_archive_bytes: int = DEFAULT_MAX_ARCHIVE_BYTES
    max_member_bytes: int = DEFAULT_MAX_MEMBER_BYTES
    max_rows: int = DEFAULT_MAX_ROWS
    max_line_bytes: int = DEFAULT_MAX_LINE_BYTES
    max_compression_ratio: int = DEFAULT_MAX_COMPRESSION_RATIO
    max_sidecar_bytes: int = DEFAULT_MAX_SIDECAR_BYTES

    def __post_init__(self) -> None:
        _bounded_positive_int(
            self.max_archive_bytes,
            field="max_archive_bytes",
            maximum=ABSOLUTE_MAX_ARCHIVE_BYTES,
        )
        _bounded_positive_int(
            self.max_member_bytes,
            field="max_member_bytes",
            maximum=ABSOLUTE_MAX_MEMBER_BYTES,
        )
        _bounded_positive_int(
            self.max_rows,
            field="max_rows",
            maximum=ABSOLUTE_MAX_ROWS,
        )
        _bounded_positive_int(
            self.max_line_bytes,
            field="max_line_bytes",
            maximum=ABSOLUTE_MAX_LINE_BYTES,
        )
        _bounded_positive_int(
            self.max_compression_ratio,
            field="max_compression_ratio",
            maximum=ABSOLUTE_MAX_COMPRESSION_RATIO,
        )
        _bounded_positive_int(
            self.max_sidecar_bytes,
            field="max_sidecar_bytes",
            maximum=ABSOLUTE_MAX_SIDECAR_BYTES,
        )


@dataclass(frozen=True, slots=True)
class BinanceSpotAggTradesProvenanceV1:
    """Explicit immutable provenance for one official Spot daily aggregate-trade file.

    Asset identities are deliberately caller supplied. The importer never splits a concatenated
    exchange symbol and permits honest UNKNOWN_BASE/UNKNOWN_QUOTE identifiers when a point-in-time
    instrument registry is unavailable.
    """

    archive_url: str
    checksum_url: str
    symbol: str
    base_asset_id: str
    quote_asset_id: str
    utc_date: str
    timestamp_unit: TimestampUnit
    retrieved_at_ns: int
    normalization_time_ns: int
    persistence_time_ns: int
    instrument_version: str

    def __post_init__(self) -> None:
        if not isinstance(self.symbol, str) or _SYMBOL_PATTERN.fullmatch(self.symbol) is None:
            raise ArchiveImportError("symbol must be a bounded uppercase Binance symbol")
        for field_name in ("base_asset_id", "quote_asset_id", "instrument_version"):
            try:
                require_contract_id(getattr(self, field_name), field=field_name)
            except ContractValueError as error:
                raise ArchiveImportError(str(error)) from error
        parsed_date = _parse_canonical_date(self.utc_date)
        day_start_ns = _date_start_ns(parsed_date)
        if day_start_ns < UTC_NS_MIN or day_start_ns + _DAY_NS > UTC_NS_MAX:
            raise ArchiveImportError("utc_date is outside the frozen plausible UTC range")
        if not isinstance(self.timestamp_unit, TimestampUnit):
            raise ArchiveImportError("timestamp_unit must be an explicit TimestampUnit")
        for field_name in ("retrieved_at_ns", "normalization_time_ns", "persistence_time_ns"):
            try:
                require_strict_int(
                    getattr(self, field_name),
                    field=field_name,
                    minimum=UTC_NS_MIN,
                    maximum=UTC_NS_MAX,
                )
            except ContractValueError as error:
                raise ArchiveImportError(str(error)) from error
        if self.retrieved_at_ns > self.normalization_time_ns:
            raise ArchiveImportError("retrieved_at_ns must not follow normalization_time_ns")
        if self.normalization_time_ns > self.persistence_time_ns:
            raise ArchiveImportError("normalization_time_ns must not follow persistence_time_ns")
        expected_url = f"{BINANCE_ARCHIVE_ORIGIN}{self.expected_archive_path}"
        if self.archive_url != expected_url or not _is_exact_official_https_url(self.archive_url):
            raise ArchiveImportError("archive_url must be the exact official Spot daily path")
        if self.checksum_url != f"{expected_url}.CHECKSUM" or not _is_exact_official_https_url(
            self.checksum_url
        ):
            raise ArchiveImportError("checksum_url must be the exact adjacent official sidecar")

    @property
    def archive_filename(self) -> str:
        return f"{self.symbol}-aggTrades-{self.utc_date}.zip"

    @property
    def member_filename(self) -> str:
        return f"{self.symbol}-aggTrades-{self.utc_date}.csv"

    @property
    def expected_archive_path(self) -> str:
        return (
            f"/data/spot/daily/aggTrades/{self.symbol}/{self.symbol}-aggTrades-{self.utc_date}.zip"
        )

    @property
    def day_start_ns(self) -> int:
        return _date_start_ns(_parse_canonical_date(self.utc_date))

    @property
    def day_end_ns(self) -> int:
        return self.day_start_ns + _DAY_NS


@dataclass(frozen=True, slots=True)
class BinanceSpotAggTradeRawRowV1:
    row_number: int
    aggregate_trade_id: int
    price_text: str
    quantity_text: str
    first_trade_id: int
    last_trade_id: int
    event_time: RawTimestampV1
    buyer_was_maker: bool
    best_price_match: bool
    price: ExactScaledValueV1
    quantity: ExactScaledValueV1
    raw_row_bytes: bytes
    raw_row_digest: DigestV1


def count_archive_discontinuities(
    rows: tuple[BinanceSpotAggTradeRawRowV1, ...],
) -> int:
    """Count adjacent aggregate or underlying trade-ID continuity breaks once."""

    return sum(
        1
        for previous, current in pairwise(rows)
        if current.aggregate_trade_id != previous.aggregate_trade_id + 1
        or current.first_trade_id != previous.last_trade_id + 1
    )


@dataclass(frozen=True, slots=True)
class BinanceSpotAggTradesImportV1:
    provenance: BinanceSpotAggTradesProvenanceV1
    official_checksum: DigestV1
    sidecar_digest: DigestV1
    archive_digest: DigestV1
    member_digest: DigestV1
    schema_fingerprint: DigestV1
    compressed_bytes: int
    member_bytes: int
    raw_rows: tuple[BinanceSpotAggTradeRawRowV1, ...]
    normalized_rows: tuple[ReferenceMarketEvidenceRowV1, ...]

    @property
    def row_count(self) -> int:
        return len(self.raw_rows)

    @property
    def discontinuity_count(self) -> int:
        return count_archive_discontinuities(self.raw_rows)

    @property
    def first_source_time(self) -> RawTimestampV1:
        return min((row.event_time for row in self.raw_rows), key=lambda item: item.normalized_ns)

    @property
    def last_source_time(self) -> RawTimestampV1:
        return max((row.event_time for row in self.raw_rows), key=lambda item: item.normalized_ns)


def _parse_canonical_date(value: object) -> date:
    if not isinstance(value, str):
        raise ArchiveImportError("utc_date must be canonical YYYY-MM-DD")
    try:
        parsed = date.fromisoformat(value)
    except ValueError as error:
        raise ArchiveImportError("utc_date must be canonical YYYY-MM-DD") from error
    if parsed.isoformat() != value:
        raise ArchiveImportError("utc_date must be canonical YYYY-MM-DD")
    return parsed


def _date_start_ns(value: date) -> int:
    return (value - _EPOCH_DATE).days * _DAY_NS


def _is_exact_official_https_url(value: object) -> bool:
    if not isinstance(value, str) or len(value) > 512 or not value.isascii():
        return False
    parsed = urlsplit(value)
    return (
        parsed.scheme == "https"
        and parsed.netloc == "data.binance.vision"
        and parsed.hostname == "data.binance.vision"
        and parsed.port is None
        and parsed.username is None
        and parsed.password is None
        and not parsed.query
        and not parsed.fragment
        and parsed.path.startswith("/data/spot/daily/aggTrades/")
        and "%" not in parsed.path
    )


def _sha256(value: bytes) -> DigestV1:
    return DigestV1(hashlib.sha256(value).hexdigest())


def _parse_sidecar(
    checksum_bytes: bytes,
    *,
    expected_filename: str,
    limits: ArchiveImportLimitsV1,
) -> tuple[DigestV1, DigestV1]:
    if type(checksum_bytes) is not bytes:
        raise ArchiveImportError("checksum evidence must be immutable bytes")
    if not checksum_bytes or len(checksum_bytes) > limits.max_sidecar_bytes:
        raise ArchiveImportError("checksum sidecar is empty or exceeds its byte limit")
    match = _SIDECAR_PATTERN.fullmatch(checksum_bytes)
    if match is None:
        raise ArchiveImportError("checksum sidecar must be canonical sha256sum bytes")
    filename = match.group("filename").decode("ascii")
    if filename != expected_filename:
        raise ArchiveImportError("checksum sidecar filename does not match the expected archive")
    return DigestV1(match.group("digest").decode("ascii")), _sha256(checksum_bytes)


def _preflight_canonical_single_member_zip(
    archive_bytes: bytes,
    *,
    expected_member: str,
    limits: ArchiveImportLimitsV1,
) -> None:
    """Reject ambiguous ZIP containers before constructing a general-purpose ZIP reader."""

    minimum_size = (
        _LOCAL_FILE_HEADER.size + _CENTRAL_DIRECTORY_HEADER.size + _END_OF_CENTRAL_DIRECTORY.size
    )
    if len(archive_bytes) < minimum_size:
        raise ArchiveImportError("archive is too short for the canonical ZIP container")
    if archive_bytes[:4] != _LOCAL_FILE_SIGNATURE:
        raise ArchiveImportError("canonical ZIP must place its first local header at offset zero")

    eocd_offset = len(archive_bytes) - _END_OF_CENTRAL_DIRECTORY.size
    if archive_bytes[eocd_offset : eocd_offset + 4] != _END_OF_CENTRAL_DIRECTORY_SIGNATURE:
        raise ArchiveImportError("canonical ZIP EOCD must be comment-free and end at archive end")
    (
        eocd_signature,
        disk_number,
        central_disk_number,
        entries_on_disk,
        total_entries,
        central_size,
        central_offset,
        eocd_comment_length,
    ) = _END_OF_CENTRAL_DIRECTORY.unpack_from(archive_bytes, eocd_offset)
    if (
        eocd_signature,
        disk_number,
        central_disk_number,
        eocd_comment_length,
    ) != (_END_OF_CENTRAL_DIRECTORY_SIGNATURE, 0, 0, 0):
        raise ArchiveImportError("canonical ZIP must be single-disk and have no EOCD comment")
    if (entries_on_disk, total_entries) != (1, 1):
        raise ArchiveImportError("canonical ZIP must declare exactly one central entry")
    if central_size < _CENTRAL_DIRECTORY_HEADER.size:
        raise ArchiveImportError("canonical ZIP central directory is truncated")
    if central_offset + central_size != eocd_offset:
        raise ArchiveImportError("canonical ZIP central directory must end immediately at EOCD")
    (
        central_signature,
        _central_version_made,
        central_version_needed,
        central_flags,
        central_compression,
        central_modified_time,
        central_modified_date,
        central_crc32,
        central_compressed_size,
        central_uncompressed_size,
        central_name_length,
        central_extra_length,
        central_comment_length,
        central_disk_start,
        _central_internal_attributes,
        _central_external_attributes,
        local_header_offset,
    ) = _CENTRAL_DIRECTORY_HEADER.unpack_from(archive_bytes, central_offset)
    if central_signature != _CENTRAL_DIRECTORY_SIGNATURE:
        raise ArchiveImportError("canonical ZIP central directory signature is missing")
    central_record_end = (
        central_offset
        + _CENTRAL_DIRECTORY_HEADER.size
        + central_name_length
        + central_extra_length
        + central_comment_length
    )
    if central_record_end != eocd_offset:
        raise ArchiveImportError("canonical ZIP must contain exactly one complete central entry")
    if central_disk_start != 0:
        raise ArchiveImportError("canonical ZIP member must start on disk zero")
    if local_header_offset != 0:
        raise ArchiveImportError("canonical ZIP member local header must have offset zero")

    (
        _local_signature,
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
    ) = _LOCAL_FILE_HEADER.unpack_from(archive_bytes, 0)
    local_name_start = _LOCAL_FILE_HEADER.size
    local_name_end = local_name_start + local_name_length
    local_payload_start = local_name_end + local_extra_length
    if local_payload_start > central_offset:
        raise ArchiveImportError("canonical ZIP local header is malformed or truncated")
    if local_flags & _ZIP_DATA_DESCRIPTOR_FLAG:
        raise ArchiveImportError("canonical ZIP streaming data descriptors are forbidden")
    if (local_extra_length, central_extra_length, central_comment_length) != (0, 0, 0):
        raise ArchiveImportError("canonical ZIP member extras and comments are forbidden")
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
        central_version_needed,
        central_flags,
        central_compression,
        central_modified_time,
        central_modified_date,
        central_crc32,
        central_compressed_size,
        central_uncompressed_size,
    ):
        raise ArchiveImportError("canonical ZIP local and central metadata disagree")

    central_name_start = central_offset + _CENTRAL_DIRECTORY_HEADER.size
    central_name_end = central_name_start + central_name_length
    local_raw_name = archive_bytes[local_name_start:local_name_end]
    central_raw_name = archive_bytes[central_name_start:central_name_end]
    expected_raw_name = expected_member.encode("ascii")
    if (local_raw_name, central_raw_name) != (expected_raw_name, expected_raw_name):
        raise ArchiveImportError(
            "canonical ZIP raw member names must exactly match the expected CSV"
        )
    if local_payload_start + central_compressed_size != central_offset:
        raise ArchiveImportError(
            "canonical ZIP contains hidden, concatenated, or unaccounted container bytes"
        )
    if central_uncompressed_size <= 0 or central_uncompressed_size > limits.max_member_bytes:
        raise ArchiveImportError("archive member is empty or exceeds its byte limit")
    if central_compressed_size <= 0:
        raise ArchiveImportError("non-empty archive member has invalid compressed size")
    if central_uncompressed_size > central_compressed_size * limits.max_compression_ratio:
        raise ArchiveImportError("archive member exceeds the compression-ratio limit")
    if central_compression == zipfile.ZIP_DEFLATED:
        compressed_payload = archive_bytes[local_payload_start:central_offset]
        decompressor = zlib.decompressobj(-zlib.MAX_WBITS)
        try:
            decoded = decompressor.decompress(
                compressed_payload,
                central_uncompressed_size + 1,
            )
        except zlib.error as error:
            raise ArchiveImportError("canonical ZIP DEFLATE stream is malformed") from error
        if decompressor.unconsumed_tail:
            raise ArchiveImportError("canonical ZIP DEFLATE stream exceeds its declared size")
        decoded += decompressor.flush()
        if (
            not decompressor.eof
            or decompressor.unused_data
            or len(decoded) != central_uncompressed_size
        ):
            raise ArchiveImportError(
                "canonical ZIP DEFLATE stream must consume its exact compressed span"
            )


def _verified_member_bytes(
    archive_bytes: bytes,
    *,
    expected_member: str,
    limits: ArchiveImportLimitsV1,
) -> tuple[bytes, int]:
    try:
        with zipfile.ZipFile(io.BytesIO(archive_bytes), mode="r") as archive:
            members = archive.infolist()
            names = tuple(member.filename for member in members)
            if len(names) != len(set(names)):
                raise ArchiveImportError("archive contains duplicate member names")
            if len(members) != 1:
                raise ArchiveImportError("archive must contain exactly one member")
            member = members[0]
            if (
                member.orig_filename != member.filename
                or not member.orig_filename.isascii()
                or "\x00" in member.orig_filename
                or member.orig_filename != expected_member
                or member.filename != expected_member
            ):
                raise ArchiveImportError("archive member name does not match the expected CSV")
            if (
                "/" in member.filename
                or "\\" in member.filename
                or member.filename in (".", "..")
                or member.filename.startswith(("/", "\\"))
            ):
                raise ArchiveImportError("archive member must be one unnested basename")
            if not member.filename.endswith(".csv") or member.filename.lower().endswith(
                _FORBIDDEN_NESTED_SUFFIXES
            ):
                raise ArchiveImportError("archive member must be the expected unnested CSV")
            if member.is_dir():
                raise ArchiveImportError("archive member must be a regular file")
            unix_mode = member.external_attr >> 16
            file_type = stat.S_IFMT(unix_mode)
            if file_type not in (0, stat.S_IFREG):
                raise ArchiveImportError("archive member must not be a symlink or special file")
            if member.flag_bits & 0x1:
                raise ArchiveImportError("encrypted archive members are forbidden")
            if member.compress_type not in _SUPPORTED_COMPRESSIONS:
                raise ArchiveImportError("archive compression method is unsupported")
            if member.file_size <= 0 or member.file_size > limits.max_member_bytes:
                raise ArchiveImportError("archive member is empty or exceeds its byte limit")
            if member.compress_size <= 0:
                raise ArchiveImportError("non-empty archive member has invalid compressed size")
            if member.file_size > member.compress_size * limits.max_compression_ratio:
                raise ArchiveImportError("archive member exceeds the compression-ratio limit")
            with archive.open(member, mode="r") as stream:
                payload = stream.read(limits.max_member_bytes + 1)
            if len(payload) > limits.max_member_bytes:
                raise ArchiveImportError("decompressed archive member exceeds its byte limit")
            if len(payload) != member.file_size:
                raise ArchiveImportError("archive member size disagrees with the ZIP directory")
            return payload, member.compress_size
    except ArchiveImportError:
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
        raise ArchiveImportError("archive is malformed or cannot be safely decoded") from error


def _parse_uint(value: str, *, field: str, maximum: int, allow_zero: bool = True) -> int:
    if _UNSIGNED_INTEGER_PATTERN.fullmatch(value) is None:
        if value == "-1":
            raise ArchiveImportError(f"{field} contains a negative repair marker")
        raise ArchiveImportError(f"{field} must be a canonical unsigned integer")
    if len(value) > len(str(maximum)) or (len(value) == len(str(maximum)) and value > str(maximum)):
        raise ArchiveImportError(f"{field} exceeds its integer range")
    result = int(value)
    if not allow_zero and result == 0:
        raise ArchiveImportError(f"{field} zero is an invalid repair/economic marker")
    return result


def _parse_exact_positive_decimal(
    value: str,
    *,
    field: str,
    unit_id: str,
) -> ExactScaledValueV1:
    match = _POSITIVE_DECIMAL_PATTERN.fullmatch(value)
    if match is None:
        if value == "-1":
            raise ArchiveImportError(f"{field} contains a negative repair marker")
        raise ArchiveImportError(f"{field} must be a canonical non-floating decimal string")
    fraction = match.group("fraction") or ""
    digits = f"{match.group('integer')}{fraction}"
    significant_digits = digits.lstrip("0") or "0"
    if len(fraction) > 38 or len(significant_digits) > 38:
        raise ArchiveImportError(f"{field} exceeds the exact decimal coefficient range")
    coefficient = int(digits)
    if coefficient == 0:
        raise ArchiveImportError(f"{field} must be strictly positive")
    return ExactScaledValueV1(
        coefficient=coefficient,
        scale=len(fraction),
        unit_id=unit_id,
    )


def _parse_boolean(value: str, *, field: str) -> bool:
    if value == "True":
        return True
    if value == "False":
        return False
    raise ArchiveImportError(f"{field} must be exactly True or False")


def _parse_csv_rows(
    member_bytes: bytes,
    *,
    provenance: BinanceSpotAggTradesProvenanceV1,
    limits: ArchiveImportLimitsV1,
) -> tuple[BinanceSpotAggTradeRawRowV1, ...]:
    if member_bytes.startswith(b"\xef\xbb\xbf"):
        raise ArchiveImportError("CSV member must not contain a UTF-8 byte-order mark")
    if not member_bytes.endswith(b"\n"):
        raise ArchiveImportError("CSV member must end with one canonical LF")

    line_payloads: list[bytes] = []
    line_start = 0
    for offset, byte in enumerate(member_bytes):
        row_number = len(line_payloads) + 1
        if byte == 0:
            raise ArchiveImportError("CSV member must not contain NUL bytes")
        if byte == 13:
            raise ArchiveImportError("CSV member must use canonical LF line endings")
        if byte == 10:
            if row_number > limits.max_rows:
                raise ArchiveImportError("CSV row count is empty or exceeds its bound")
            if offset == line_start:
                raise ArchiveImportError(f"CSV row {row_number} is blank")
            line_payloads.append(member_bytes[line_start:offset])
            line_start = offset + 1
        elif offset - line_start + 1 > limits.max_line_bytes:
            raise ArchiveImportError(f"CSV row {row_number} exceeds its byte limit")
    rows: list[BinanceSpotAggTradeRawRowV1] = []
    previous_aggregate_trade_id: int | None = None
    previous_first_trade_id: int | None = None
    previous_last_trade_id: int | None = None
    previous_event_time_ns: int | None = None
    for row_number, line_bytes in enumerate(line_payloads, start=1):
        if b'"' in line_bytes:
            raise ArchiveImportError(f"CSV row {row_number} uses unsupported quoting")
        try:
            line = line_bytes.decode("ascii", errors="strict")
        except UnicodeDecodeError as error:
            raise ArchiveImportError(f"CSV row {row_number} must use the ASCII schema") from error
        parsed = line.split(",")
        if len(parsed) != len(BINANCE_SPOT_AGG_TRADES_COLUMNS):
            raise ArchiveImportError(f"CSV row {row_number} has {len(parsed)} fields; expected 8")
        if row_number == 1 and tuple(parsed) == BINANCE_SPOT_AGG_TRADES_COLUMNS:
            raise ArchiveImportError("CSV header/schema drift is forbidden for this family")

        aggregate_trade_id = _parse_uint(
            parsed[0],
            field=f"row {row_number} aggregate_trade_id",
            maximum=UINT64_MAX,
        )
        price = _parse_exact_positive_decimal(
            parsed[1],
            field=f"row {row_number} price",
            unit_id=provenance.quote_asset_id,
        )
        quantity = _parse_exact_positive_decimal(
            parsed[2],
            field=f"row {row_number} quantity",
            unit_id=provenance.base_asset_id,
        )
        first_trade_id = _parse_uint(
            parsed[3],
            field=f"row {row_number} first_trade_id",
            maximum=UINT64_MAX,
        )
        last_trade_id = _parse_uint(
            parsed[4],
            field=f"row {row_number} last_trade_id",
            maximum=UINT64_MAX,
        )
        if first_trade_id > last_trade_id:
            raise ArchiveImportError(f"CSV row {row_number} has a reversed trade-ID range")
        timestamp_raw = _parse_uint(
            parsed[5],
            field=f"row {row_number} timestamp",
            maximum=INT64_MAX,
            allow_zero=False,
        )
        try:
            event_time = RawTimestampV1(
                raw=timestamp_raw,
                unit=provenance.timestamp_unit,
                basis=TimestampBasis.DECLARED,
            )
        except ContractValueError as error:
            raise ArchiveImportError(
                f"CSV row {row_number} timestamp violates the declared unit contract"
            ) from error
        if not provenance.day_start_ns <= event_time.normalized_ns < provenance.day_end_ns:
            raise ArchiveImportError(
                f"CSV row {row_number} timestamp is outside the declared UTC day; "
                "mixed or incorrect units are forbidden"
            )
        buyer_was_maker = _parse_boolean(parsed[6], field=f"row {row_number} buyer_was_maker")
        best_price_match = _parse_boolean(parsed[7], field=f"row {row_number} best_price_match")
        raw_row_bytes = line_bytes + b"\n"
        raw_row_digest = _sha256(raw_row_bytes)

        if (
            previous_aggregate_trade_id is not None
            and aggregate_trade_id == previous_aggregate_trade_id
        ):
            raise ArchiveImportError("CSV contains a duplicate aggregate-trade ID")
        if (
            previous_first_trade_id is not None
            and previous_last_trade_id is not None
            and (first_trade_id, last_trade_id) == (previous_first_trade_id, previous_last_trade_id)
        ):
            raise ArchiveImportError("CSV contains a duplicate underlying trade-ID range")
        if (
            previous_aggregate_trade_id is not None
            and aggregate_trade_id <= previous_aggregate_trade_id
        ):
            raise ArchiveImportError("CSV aggregate-trade IDs must be strictly increasing")
        if previous_last_trade_id is not None and first_trade_id <= previous_last_trade_id:
            raise ArchiveImportError(
                "CSV underlying trade-ID ranges must be monotone and non-overlapping"
            )
        if previous_event_time_ns is not None and event_time.normalized_ns < previous_event_time_ns:
            raise ArchiveImportError("CSV source timestamps must be nondecreasing")
        previous_aggregate_trade_id = aggregate_trade_id
        previous_first_trade_id = first_trade_id
        previous_last_trade_id = last_trade_id
        previous_event_time_ns = event_time.normalized_ns
        rows.append(
            BinanceSpotAggTradeRawRowV1(
                row_number=row_number,
                aggregate_trade_id=aggregate_trade_id,
                price_text=parsed[1],
                quantity_text=parsed[2],
                first_trade_id=first_trade_id,
                last_trade_id=last_trade_id,
                event_time=event_time,
                buyer_was_maker=buyer_was_maker,
                best_price_match=best_price_match,
                price=price,
                quantity=quantity,
                raw_row_bytes=raw_row_bytes,
                raw_row_digest=raw_row_digest,
            )
        )
    return tuple(rows)


def _normalized_rows(
    raw_rows: tuple[BinanceSpotAggTradeRawRowV1, ...],
    *,
    provenance: BinanceSpotAggTradesProvenanceV1,
    archive_digest: DigestV1,
) -> tuple[ReferenceMarketEvidenceRowV1, ...]:
    quality = derive_quality(
        QualityFactsV1(
            available=True,
            synthetic=False,
            gap=False,
            stale=False,
            reconstructing=False,
            sampled=False,
            partial=True,
            complete_proven=False,
            observed_reasons=(
                "ARCHIVE_COMPLETENESS_UNPROVEN",
                "ARCHIVE_IDENTITY_CALLER_SUPPLIED",
                "ARCHIVE_RECEIVE_CLOCK_UNAVAILABLE",
            ),
        )
    )
    stream_id = "binance.spot.daily.aggTrades"
    session_id = f"archive.{archive_digest.hexdigest[:32]}"
    return tuple(
        ReferenceMarketEvidenceRowV1(
            record_id=(f"binance.spot.aggTrade.{provenance.symbol}.{raw_row.aggregate_trade_id}"),
            source_id=BINANCE_ARCHIVE_SOURCE_ID,
            source_endpoint=BINANCE_ARCHIVE_SOURCE_ENDPOINT,
            venue="binance",
            product="spot",
            event_kind="aggTrades",
            symbol=provenance.symbol,
            base_asset_id=provenance.base_asset_id,
            quote_asset_id=provenance.quote_asset_id,
            instrument_version=provenance.instrument_version,
            stream_id=stream_id,
            event_time=raw_row.event_time,
            trade_time=raw_row.event_time,
            receive_wall_time=None,
            receive_monotonic_ns=None,
            normalization_time_ns=provenance.normalization_time_ns,
            persistence_time_ns=provenance.persistence_time_ns,
            session_id=session_id,
            sequence_first=raw_row.first_trade_id,
            sequence_last=raw_row.last_trade_id,
            raw_payload_digest=raw_row.raw_row_digest,
            posture=EvidencePosture.REPLAY,
            duplicate=False,
            late=False,
            quality=quality,
            price=raw_row.price,
            quantity=raw_row.quantity,
        )
        for raw_row in raw_rows
    )


def import_binance_spot_daily_agg_trades(
    archive_bytes: bytes,
    checksum_bytes: bytes,
    provenance: BinanceSpotAggTradesProvenanceV1,
    *,
    limits: ArchiveImportLimitsV1 | None = None,
) -> BinanceSpotAggTradesImportV1:
    """Verify and normalize one caller-supplied official archive without external effects."""

    if not isinstance(provenance, BinanceSpotAggTradesProvenanceV1):
        raise ArchiveImportError("provenance must be BinanceSpotAggTradesProvenanceV1")
    effective_limits = ArchiveImportLimitsV1() if limits is None else limits
    if not isinstance(effective_limits, ArchiveImportLimitsV1):
        raise ArchiveImportError("limits must be ArchiveImportLimitsV1 or null")
    if type(archive_bytes) is not bytes:
        raise ArchiveImportError("archive evidence must be immutable bytes")
    if not archive_bytes or len(archive_bytes) > effective_limits.max_archive_bytes:
        raise ArchiveImportError("archive is empty or exceeds its byte limit")

    official_checksum, sidecar_digest = _parse_sidecar(
        checksum_bytes,
        expected_filename=provenance.archive_filename,
        limits=effective_limits,
    )
    archive_digest = _sha256(archive_bytes)
    if not hmac.compare_digest(
        archive_digest.hexdigest.encode("ascii"), official_checksum.hexdigest.encode("ascii")
    ):
        raise ArchiveImportError("archive SHA-256 does not match the official sidecar")

    _preflight_canonical_single_member_zip(
        archive_bytes,
        expected_member=provenance.member_filename,
        limits=effective_limits,
    )
    member_bytes, compressed_bytes = _verified_member_bytes(
        archive_bytes,
        expected_member=provenance.member_filename,
        limits=effective_limits,
    )
    raw_rows = _parse_csv_rows(
        member_bytes,
        provenance=provenance,
        limits=effective_limits,
    )
    if max(row.event_time.normalized_ns for row in raw_rows) > provenance.retrieved_at_ns:
        raise ArchiveImportError("retrieved_at_ns must not precede source evidence")
    normalized_rows = _normalized_rows(
        raw_rows,
        provenance=provenance,
        archive_digest=archive_digest,
    )
    return BinanceSpotAggTradesImportV1(
        provenance=provenance,
        official_checksum=official_checksum,
        sidecar_digest=sidecar_digest,
        archive_digest=archive_digest,
        member_digest=_sha256(member_bytes),
        schema_fingerprint=BINANCE_SPOT_AGG_TRADES_SCHEMA_FINGERPRINT,
        compressed_bytes=compressed_bytes,
        member_bytes=len(member_bytes),
        raw_rows=raw_rows,
        normalized_rows=normalized_rows,
    )
