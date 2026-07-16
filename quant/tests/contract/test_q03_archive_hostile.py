from __future__ import annotations

import hashlib
import io
import stat
import struct
import warnings
import zipfile
from dataclasses import replace
from unittest.mock import MagicMock, patch

import pytest

import quant_edge.bootstrap.archive as archive_module
from quant_edge.bootstrap.archive import (
    BINANCE_SPOT_AGG_TRADES_COLUMNS,
    BINANCE_SPOT_AGG_TRADES_SCHEMA_FINGERPRINT,
    ArchiveImportError,
    ArchiveImportLimitsV1,
    BinanceSpotAggTradesImportV1,
    BinanceSpotAggTradesProvenanceV1,
    import_binance_spot_daily_agg_trades,
)
from quant_edge.lake.contracts import TimestampUnit

UTC_DATE = "2024-01-02"
DAY_START_MS = 1_704_153_600_000
RETRIEVED_NS = 1_783_814_400_000_000_000


def _provenance(
    *, unit: TimestampUnit = TimestampUnit.MILLISECOND
) -> BinanceSpotAggTradesProvenanceV1:
    archive_url = (
        "https://data.binance.vision/data/spot/daily/aggTrades/BNBUSDT/"
        f"BNBUSDT-aggTrades-{UTC_DATE}.zip"
    )
    return BinanceSpotAggTradesProvenanceV1(
        archive_url=archive_url,
        checksum_url=f"{archive_url}.CHECKSUM",
        symbol="BNBUSDT",
        base_asset_id="UNKNOWN_BASE",
        quote_asset_id="UNKNOWN_QUOTE",
        utc_date=UTC_DATE,
        timestamp_unit=unit,
        retrieved_at_ns=RETRIEVED_NS,
        normalization_time_ns=RETRIEVED_NS + 1,
        persistence_time_ns=RETRIEVED_NS + 2,
        instrument_version="archive_symbol_only_v1",
    )


def _valid_row(
    *,
    aggregate_id: str = "0",
    price: str = "1.2300",
    quantity: str = "4.5600",
    first_id: str = "0",
    last_id: str = "0",
    timestamp: str | None = None,
    buyer_maker: str = "True",
    best_match: str = "False",
) -> str:
    time_text = str(DAY_START_MS + 1) if timestamp is None else timestamp
    return ",".join(
        (
            aggregate_id,
            price,
            quantity,
            first_id,
            last_id,
            time_text,
            buyer_maker,
            best_match,
        )
    )


def _csv(*rows: str, final_lf: bool = True) -> bytes:
    suffix = "\n" if final_lf else ""
    return ("\n".join(rows) + suffix).encode("ascii")


def _zip_entries(
    entries: tuple[tuple[zipfile.ZipInfo | str, bytes], ...],
    *,
    compression: int = zipfile.ZIP_DEFLATED,
) -> bytes:
    output = io.BytesIO()
    with (
        zipfile.ZipFile(output, mode="w", compression=compression) as archive,
        warnings.catch_warnings(),
    ):
        warnings.simplefilter("ignore", UserWarning)
        for name, payload in entries:
            archive.writestr(name, payload)
    return output.getvalue()


def _zip(
    payload: bytes,
    *,
    member_name: str | None = None,
    compression: int = zipfile.ZIP_DEFLATED,
) -> bytes:
    return _zip_entries(
        ((member_name or _provenance().member_filename, payload),),
        compression=compression,
    )


def _sidecar(
    archive_bytes: bytes,
    *,
    digest: str | None = None,
    filename: str | None = None,
) -> bytes:
    actual_digest = hashlib.sha256(archive_bytes).hexdigest() if digest is None else digest
    actual_filename = _provenance().archive_filename if filename is None else filename
    return f"{actual_digest}  {actual_filename}\n".encode("ascii")


def _call(
    archive_bytes: bytes,
    *,
    checksum_bytes: bytes | None = None,
    provenance: BinanceSpotAggTradesProvenanceV1 | None = None,
    limits: ArchiveImportLimitsV1 | None = None,
) -> BinanceSpotAggTradesImportV1:
    return import_binance_spot_daily_agg_trades(
        archive_bytes,
        _sidecar(archive_bytes) if checksum_bytes is None else checksum_bytes,
        _provenance() if provenance is None else provenance,
        limits=limits,
    )


def _set_encrypted_flags(archive_bytes: bytes) -> bytes:
    mutated = bytearray(archive_bytes)
    local = archive_bytes.index(b"PK\x03\x04")
    central = archive_bytes.index(b"PK\x01\x02")
    local_flags = struct.unpack_from("<H", mutated, local + 6)[0]
    central_flags = struct.unpack_from("<H", mutated, central + 8)[0]
    struct.pack_into("<H", mutated, local + 6, local_flags | 0x1)
    struct.pack_into("<H", mutated, central + 8, central_flags | 0x1)
    return bytes(mutated)


def _eocd_offset(archive_bytes: bytes) -> int:
    return len(archive_bytes) - 22


def _central_offset(archive_bytes: bytes) -> int:
    return int(struct.unpack_from("<L", archive_bytes, _eocd_offset(archive_bytes) + 16)[0])


def _replace_u16(archive_bytes: bytes, offset: int, value: int) -> bytes:
    mutated = bytearray(archive_bytes)
    struct.pack_into("<H", mutated, offset, value)
    return bytes(mutated)


def _replace_u32(archive_bytes: bytes, offset: int, value: int) -> bytes:
    mutated = bytearray(archive_bytes)
    struct.pack_into("<L", mutated, offset, value)
    return bytes(mutated)


def _add_local_extra(archive_bytes: bytes) -> bytes:
    central_offset = _central_offset(archive_bytes)
    local_name_length = struct.unpack_from("<H", archive_bytes, 26)[0]
    insertion_offset = 30 + local_name_length
    extra = b"\xfe\xca\x00\x00"
    mutated = bytearray(archive_bytes[:insertion_offset] + extra + archive_bytes[insertion_offset:])
    struct.pack_into("<H", mutated, 28, len(extra))
    new_eocd_offset = _eocd_offset(archive_bytes) + len(extra)
    struct.pack_into("<L", mutated, new_eocd_offset + 16, central_offset + len(extra))
    return bytes(mutated)


def _add_central_variable_field(archive_bytes: bytes, *, length_offset: int) -> bytes:
    central_offset = _central_offset(archive_bytes)
    central_name_length = struct.unpack_from("<H", archive_bytes, central_offset + 28)[0]
    insertion_offset = central_offset + 46 + central_name_length
    extra = b"\xfe\xca\x00\x00"
    mutated = bytearray(archive_bytes[:insertion_offset] + extra + archive_bytes[insertion_offset:])
    struct.pack_into("<H", mutated, central_offset + length_offset, len(extra))
    new_eocd_offset = _eocd_offset(archive_bytes) + len(extra)
    central_size = struct.unpack_from("<L", archive_bytes, _eocd_offset(archive_bytes) + 12)[0]
    struct.pack_into("<L", mutated, new_eocd_offset + 12, central_size + len(extra))
    return bytes(mutated)


def _append_to_compressed_span(archive_bytes: bytes, suffix: bytes) -> bytes:
    central_offset = _central_offset(archive_bytes)
    compressed_size = struct.unpack_from("<L", archive_bytes, 18)[0]
    mutated = bytearray(archive_bytes[:central_offset] + suffix + archive_bytes[central_offset:])
    new_central_offset = central_offset + len(suffix)
    new_eocd_offset = _eocd_offset(archive_bytes) + len(suffix)
    struct.pack_into("<L", mutated, 18, compressed_size + len(suffix))
    struct.pack_into("<L", mutated, new_central_offset + 20, compressed_size + len(suffix))
    struct.pack_into("<L", mutated, new_eocd_offset + 16, new_central_offset)
    return bytes(mutated)


def test_checksum_is_verified_before_any_zip_decoding() -> None:
    not_a_zip = b"definitely not a zip"
    with pytest.raises(ArchiveImportError, match="SHA-256"):
        _call(not_a_zip, checksum_bytes=_sidecar(b"different bytes"))


@pytest.mark.parametrize(
    "checksum_bytes",
    [
        b"",
        b"f" * 64,
        (b"f" * 64) + b" one-space.zip\n",
        (b"F" * 64) + b"  BNBUSDT-aggTrades-2024-01-02.zip\n",
        (b"f" * 64) + b"  ../BNBUSDT-aggTrades-2024-01-02.zip\n",
        (b"f" * 64) + b"  BNBUSDT-aggTrades-2024-01-02.zip\r\n",
        (b"f" * 64) + b"  BNBUSDT-aggTrades-2024-01-02.zip\nextra",
        b"\xff" * 80,
    ],
)
def test_malformed_sidecars_are_rejected(checksum_bytes: bytes) -> None:
    archive_bytes = _zip(_csv(_valid_row()))
    with pytest.raises(ArchiveImportError):
        _call(archive_bytes, checksum_bytes=checksum_bytes)


def test_sidecar_filename_and_changed_checksum_are_rejected() -> None:
    archive_bytes = _zip(_csv(_valid_row()))

    with pytest.raises(ArchiveImportError, match="filename"):
        _call(archive_bytes, checksum_bytes=_sidecar(archive_bytes, filename="other.zip"))
    with pytest.raises(ArchiveImportError, match="SHA-256"):
        _call(archive_bytes, checksum_bytes=_sidecar(archive_bytes, digest="0" * 64))


def test_archive_and_sidecar_evidence_must_be_immutable_bytes() -> None:
    archive_bytes = _zip(_csv(_valid_row()))
    with pytest.raises(ArchiveImportError, match="immutable bytes"):
        import_binance_spot_daily_agg_trades(
            bytearray(archive_bytes),  # type: ignore[arg-type]
            _sidecar(archive_bytes),
            _provenance(),
        )
    with pytest.raises(ArchiveImportError, match="immutable bytes"):
        import_binance_spot_daily_agg_trades(
            archive_bytes,
            bytearray(_sidecar(archive_bytes)),  # type: ignore[arg-type]
            _provenance(),
        )


def test_malformed_or_truncated_zip_is_rejected_after_matching_checksum() -> None:
    for archive_bytes in (b"not-a-zip", _zip(_csv(_valid_row()))[:-8]):
        with pytest.raises(ArchiveImportError, match=r"canonical ZIP|malformed"):
            _call(archive_bytes)


def test_raw_container_rejects_prefix_trailing_concatenated_and_commented_zip() -> None:
    archive_bytes = _zip(_csv(_valid_row()))
    commented = bytearray(archive_bytes)
    struct.pack_into("<H", commented, _eocd_offset(archive_bytes) + 20, 1)
    commented.extend(b"x")

    for hostile in (
        b"prefix" + archive_bytes,
        archive_bytes + b"trailing",
        archive_bytes + archive_bytes,
        bytes(commented),
    ):
        with (
            patch.object(zipfile, "ZipFile", side_effect=AssertionError("reader was constructed")),
            pytest.raises(ArchiveImportError, match="canonical ZIP"),
        ):
            _call(hostile)


def test_raw_container_rejects_hidden_zip_between_payload_and_central_directory() -> None:
    archive_bytes = _zip(_csv(_valid_row()))
    central_offset = _central_offset(archive_bytes)
    hidden_zip = _zip(_csv(_valid_row(price="2")))
    hostile = bytearray(
        archive_bytes[:central_offset] + hidden_zip + archive_bytes[central_offset:]
    )
    new_eocd_offset = _eocd_offset(archive_bytes) + len(hidden_zip)
    struct.pack_into("<L", hostile, new_eocd_offset + 16, central_offset + len(hidden_zip))

    with (
        patch.object(zipfile, "ZipFile", side_effect=AssertionError("reader was constructed")),
        pytest.raises(ArchiveImportError, match=r"hidden|concatenated"),
    ):
        _call(bytes(hostile))


def test_raw_container_rejects_hidden_zip_inside_declared_deflate_span() -> None:
    archive_bytes = _zip(_csv(_valid_row()))
    hostile = _append_to_compressed_span(
        archive_bytes,
        _zip(_csv(_valid_row(price="2"))),
    )

    with (
        patch.object(zipfile, "ZipFile", side_effect=AssertionError("reader was constructed")),
        pytest.raises(ArchiveImportError, match="exact compressed span"),
    ):
        _call(hostile)


def test_raw_container_normalizes_malformed_deflate_before_zip_reader() -> None:
    hostile = bytearray(_zip(_csv(_valid_row())))
    compressed_size = struct.unpack_from("<L", hostile, 18)[0]
    local_name_length = struct.unpack_from("<H", hostile, 26)[0]
    local_extra_length = struct.unpack_from("<H", hostile, 28)[0]
    payload_start = 30 + local_name_length + local_extra_length
    hostile[payload_start : payload_start + compressed_size] = b"\xff" * compressed_size

    with (
        patch.object(zipfile, "ZipFile", side_effect=AssertionError("reader was constructed")),
        pytest.raises(ArchiveImportError, match="DEFLATE stream"),
    ):
        _call(bytes(hostile))


def test_raw_container_rejects_zero_compressed_size_for_nonempty_member() -> None:
    archive_bytes = _zip(_csv(_valid_row()), compression=zipfile.ZIP_STORED)
    central_offset = _central_offset(archive_bytes)
    eocd_offset = _eocd_offset(archive_bytes)
    payload_start = 30 + struct.unpack_from("<H", archive_bytes, 26)[0]
    payload_size = central_offset - payload_start
    hostile = bytearray(archive_bytes[:payload_start] + archive_bytes[central_offset:])
    new_central_offset = central_offset - payload_size
    new_eocd_offset = eocd_offset - payload_size
    struct.pack_into("<L", hostile, 18, 0)
    struct.pack_into("<L", hostile, new_central_offset + 20, 0)
    struct.pack_into("<L", hostile, new_eocd_offset + 16, new_central_offset)

    with pytest.raises(ArchiveImportError, match="invalid compressed size"):
        _call(bytes(hostile))


def test_raw_container_rejects_deflate_output_beyond_declared_size() -> None:
    hostile = bytearray(_zip(_csv(_valid_row())))
    central_offset = _central_offset(bytes(hostile))
    struct.pack_into("<L", hostile, 22, 1)
    struct.pack_into("<L", hostile, central_offset + 24, 1)

    with pytest.raises(ArchiveImportError, match="exceeds its declared size"):
        _call(bytes(hostile))


def test_raw_eocd_entry_count_is_bounded_before_zip_reader_construction() -> None:
    archive_bytes = _zip(_csv(_valid_row()))
    eocd_offset = _eocd_offset(archive_bytes)
    hostile = _replace_u16(archive_bytes, eocd_offset + 8, 65_535)
    hostile = _replace_u16(hostile, eocd_offset + 10, 65_535)

    with (
        patch.object(zipfile, "ZipFile", side_effect=AssertionError("reader was constructed")),
        pytest.raises(ArchiveImportError, match="exactly one central entry"),
    ):
        _call(hostile)


def test_raw_container_rejects_ambiguous_directory_and_local_header_metadata() -> None:
    archive_bytes = _zip(_csv(_valid_row()))
    eocd_offset = _eocd_offset(archive_bytes)
    central_offset = _central_offset(archive_bytes)

    two_entries = _zip_entries(
        (
            (_provenance().member_filename, _csv(_valid_row())),
            ("hidden.csv", _csv(_valid_row(price="2"))),
        )
    )
    two_entries = _replace_u16(two_entries, _eocd_offset(two_entries) + 8, 1)
    two_entries = _replace_u16(two_entries, _eocd_offset(two_entries) + 10, 1)

    descriptor = _replace_u16(archive_bytes, 6, 1 << 3)
    descriptor = _replace_u16(descriptor, central_offset + 8, 1 << 3)

    hostiles = (
        _replace_u16(archive_bytes, eocd_offset + 20, 1),
        _replace_u32(archive_bytes, eocd_offset + 12, 45),
        _replace_u32(archive_bytes, eocd_offset + 12, 46),
        archive_bytes[:central_offset] + b"X" + archive_bytes[central_offset + 1 :],
        two_entries,
        _replace_u16(archive_bytes, central_offset + 34, 1),
        _replace_u32(archive_bytes, central_offset + 42, 1),
        _replace_u16(archive_bytes, 26, 65_535),
        descriptor,
        _replace_u32(archive_bytes, 14, 0),
    )

    for hostile in hostiles:
        with (
            patch.object(zipfile, "ZipFile", side_effect=AssertionError("reader was constructed")),
            pytest.raises(ArchiveImportError, match="canonical ZIP"),
        ):
            _call(hostile)


def test_raw_container_rejects_local_central_extras_and_member_comments() -> None:
    archive_bytes = _zip(_csv(_valid_row()))
    hostiles = (
        _add_local_extra(archive_bytes),
        _add_central_variable_field(archive_bytes, length_offset=30),
        _add_central_variable_field(archive_bytes, length_offset=32),
    )

    for hostile in hostiles:
        with (
            patch.object(zipfile, "ZipFile", side_effect=AssertionError("reader was constructed")),
            pytest.raises(ArchiveImportError, match="extras and comments"),
        ):
            _call(hostile)


@pytest.mark.parametrize(
    ("mutate_local", "mutate_central", "replacement"),
    [
        (True, False, 0),
        (False, True, 0),
        (True, True, 0),
        (True, True, ord("X")),
    ],
)
def test_raw_local_and_central_names_must_exactly_match_without_nul(
    mutate_local: bool,
    mutate_central: bool,
    replacement: int,
) -> None:
    hostile = bytearray(_zip(_csv(_valid_row())))
    central_offset = _central_offset(bytes(hostile))
    if mutate_local:
        hostile[30] = replacement
    if mutate_central:
        hostile[central_offset + 46] = replacement

    with pytest.raises(ArchiveImportError, match="raw member names"):
        _call(bytes(hostile))


def test_archive_member_count_duplicate_and_expected_name_are_strict() -> None:
    payload = _csv(_valid_row())
    expected = _provenance().member_filename
    archives = (
        _zip_entries(((expected, payload), ("extra.csv", payload))),
        _zip_entries(((expected, payload), (expected, payload))),
        _zip(payload, member_name="other.csv"),
        _zip(payload, member_name=f"nested/{expected}"),
        _zip(payload, member_name="../escape.csv"),
        _zip(payload, member_name="payload.zip"),
    )

    for archive_bytes in archives:
        with pytest.raises(ArchiveImportError):
            _call(archive_bytes)


def test_archive_member_rejects_nul_truncation_hidden_by_zipfile() -> None:
    expected = _provenance().member_filename
    raw_name = f"{expected}\x00../escape"
    member = zipfile.ZipInfo(raw_name)
    member.filename = raw_name
    member.compress_type = zipfile.ZIP_DEFLATED
    archive_bytes = _zip_entries(((member, _csv(_valid_row())),))

    with pytest.raises(ArchiveImportError, match="member name"):
        _call(archive_bytes)


def test_symlink_special_encrypted_and_unsupported_members_are_rejected() -> None:
    expected = _provenance().member_filename
    payload = _csv(_valid_row())

    symlink = zipfile.ZipInfo(expected)
    symlink.create_system = 3
    symlink.external_attr = (stat.S_IFLNK | 0o777) << 16
    with pytest.raises(ArchiveImportError, match="symlink"):
        _call(_zip_entries(((symlink, b"target"),), compression=zipfile.ZIP_STORED))

    directory = zipfile.ZipInfo(expected)
    directory.create_system = 3
    directory.external_attr = (stat.S_IFDIR | 0o755) << 16
    with pytest.raises(ArchiveImportError, match="special file"):
        _call(_zip_entries(((directory, payload),), compression=zipfile.ZIP_STORED))

    encrypted = _set_encrypted_flags(_zip(payload))
    with pytest.raises(ArchiveImportError, match="encrypted"):
        _call(encrypted)

    with pytest.raises(ArchiveImportError, match="compression"):
        _call(_zip(payload, compression=zipfile.ZIP_BZIP2))


def test_empty_oversized_and_high_ratio_archives_are_rejected() -> None:
    with pytest.raises(ArchiveImportError, match="empty"):
        _call(b"")

    normal = _zip(_csv(_valid_row()))
    with pytest.raises(ArchiveImportError, match="archive is empty or exceeds"):
        _call(normal, limits=ArchiveImportLimitsV1(max_archive_bytes=len(normal) - 1))

    with pytest.raises(ArchiveImportError, match="member is empty"):
        _call(_zip(b""))

    payload = (_valid_row() + "\n") * 1_000
    high_ratio = _zip(payload.encode())
    with pytest.raises(ArchiveImportError, match="compression-ratio"):
        _call(high_ratio, limits=ArchiveImportLimitsV1(max_compression_ratio=2))

    with pytest.raises(ArchiveImportError, match="member is empty or exceeds"):
        _call(
            normal,
            limits=ArchiveImportLimitsV1(max_member_bytes=len(_csv(_valid_row())) - 1),
        )


@pytest.mark.parametrize(
    "payload",
    [
        b"\xff\n",
        "0,é,2,0,0,1704153600001,True,False\n".encode(),
        b"\xef\xbb\xbf0,1,2,0,0,1704153600001,True,False\n",
        b"0,1,2,0,0,1704153600001,True,False\x00\n",
        b"0,1,2,0,0,1704153600001,True,False\r\n",
        b"0,1,2,0,0,1704153600001,True,False",
        b"\n",
        b'0,"1,2",2,0,0,1704153600001,True,False\n',
    ],
)
def test_noncanonical_utf8_line_and_csv_encodings_are_rejected(payload: bytes) -> None:
    with pytest.raises(ArchiveImportError):
        _call(_zip(payload))


def test_header_column_count_line_and_row_bounds_are_rejected() -> None:
    header = _csv(",".join(BINANCE_SPOT_AGG_TRADES_COLUMNS))
    with pytest.raises(ArchiveImportError, match="header"):
        _call(_zip(header))

    for row in (
        ",".join(_valid_row().split(",")[:-1]),
        f"{_valid_row()},extra",
        f"{_valid_row()}\n",
    ):
        with pytest.raises(ArchiveImportError):
            _call(_zip(_csv(row)))

    payload = _csv(_valid_row())
    with pytest.raises(ArchiveImportError, match="byte limit"):
        _call(_zip(payload), limits=ArchiveImportLimitsV1(max_line_bytes=8))
    with pytest.raises(ArchiveImportError, match="row count"):
        _call(
            _zip(_csv(_valid_row(), replace_row_id(_valid_row(), "1", "1", "1"))),
            limits=ArchiveImportLimitsV1(max_rows=1),
        )


def replace_row_id(row: str, aggregate_id: str, first_id: str, last_id: str) -> str:
    fields = row.split(",")
    fields[0] = aggregate_id
    fields[3] = first_id
    fields[4] = last_id
    return ",".join(fields)


@pytest.mark.parametrize(
    ("field", "bad_value"),
    [
        ("price", "0"),
        ("price", "0.0000"),
        ("price", "-1"),
        ("price", "1e2"),
        ("price", "+1"),
        ("price", "01.0"),
        ("price", ".1"),
        ("price", "1."),
        ("price", "1" * 39),
        ("quantity", "0"),
        ("quantity", "-1"),
        ("quantity", "NaN"),
        ("quantity", "Infinity"),
    ],
)
def test_floats_noncanonical_economic_values_and_repair_markers_are_rejected(
    field: str,
    bad_value: str,
) -> None:
    changes = {field: bad_value}
    with pytest.raises(ArchiveImportError):
        _call(_zip(_csv(_valid_row(**changes))))


@pytest.mark.parametrize(
    ("field", "bad_value"),
    [
        ("aggregate_id", "-1"),
        ("aggregate_id", "01"),
        ("aggregate_id", str(1 << 64)),
        ("first_id", "-1"),
        ("first_id", "01"),
        ("last_id", "-1"),
        ("last_id", str(1 << 64)),
    ],
)
def test_negative_noncanonical_and_overflowing_ids_are_rejected(
    field: str,
    bad_value: str,
) -> None:
    with pytest.raises(ArchiveImportError):
        _call(_zip(_csv(_valid_row(**{field: bad_value}))))


def test_zero_ids_are_valid_but_reversed_ranges_are_not() -> None:
    imported = _call(_zip(_csv(_valid_row(aggregate_id="0", first_id="0", last_id="0"))))
    assert imported.raw_rows[0].aggregate_trade_id == 0
    assert imported.raw_rows[0].first_trade_id == 0
    assert imported.raw_rows[0].last_trade_id == 0

    with pytest.raises(ArchiveImportError, match="reversed"):
        _call(_zip(_csv(_valid_row(first_id="2", last_id="1"))))


@pytest.mark.parametrize(
    "bad_timestamp",
    [
        "0",
        "-1",
        "01",
        str(1 << 63),
        str(DAY_START_MS - 1),
        str(DAY_START_MS + 86_400_000),
    ],
)
def test_invalid_overflowing_and_out_of_day_timestamps_are_rejected(
    bad_timestamp: str,
) -> None:
    with pytest.raises(ArchiveImportError):
        _call(_zip(_csv(_valid_row(timestamp=bad_timestamp))))


def test_mixed_same_column_timestamp_units_are_rejected_without_inference() -> None:
    millisecond_row = _valid_row(timestamp=str(DAY_START_MS + 1))
    microsecond_row = _valid_row(
        aggregate_id="1",
        first_id="1",
        last_id="1",
        timestamp=str((DAY_START_MS + 2) * 1_000),
    )

    with pytest.raises(ArchiveImportError, match=r"declared unit|mixed"):
        _call(_zip(_csv(millisecond_row, microsecond_row)))


@pytest.mark.parametrize(("field", "value"), [("buyer_maker", "true"), ("best_match", "0")])
def test_boolean_schema_drift_is_rejected(field: str, value: str) -> None:
    with pytest.raises(ArchiveImportError, match="True or False"):
        _call(_zip(_csv(_valid_row(**{field: value}))))


def test_duplicate_aggregate_ids_trade_ranges_and_records_are_rejected() -> None:
    first = _valid_row()
    duplicate_id = _valid_row(first_id="1", last_id="1", timestamp=str(DAY_START_MS + 2))
    duplicate_range = _valid_row(aggregate_id="1", timestamp=str(DAY_START_MS + 2), price="2")

    with pytest.raises(ArchiveImportError, match="duplicate aggregate"):
        _call(_zip(_csv(first, duplicate_id)))
    with pytest.raises(ArchiveImportError, match="duplicate underlying"):
        _call(_zip(_csv(first, duplicate_range)))
    with pytest.raises(ArchiveImportError, match=r"duplicate aggregate|duplicate raw"):
        _call(_zip(_csv(first, first)))


def test_overlapping_or_nonmonotone_trade_identity_ranges_are_rejected() -> None:
    overlapping = (
        _valid_row(aggregate_id="0", first_id="10", last_id="12"),
        _valid_row(
            aggregate_id="1",
            first_id="12",
            last_id="14",
            timestamp=str(DAY_START_MS + 2),
        ),
    )
    nonmonotone_aggregate = (
        _valid_row(aggregate_id="2", first_id="10", last_id="12"),
        _valid_row(
            aggregate_id="1",
            first_id="13",
            last_id="14",
            timestamp=str(DAY_START_MS + 2),
        ),
    )

    with pytest.raises(ArchiveImportError, match="non-overlapping"):
        _call(_zip(_csv(*overlapping)))
    with pytest.raises(ArchiveImportError, match="strictly increasing"):
        _call(_zip(_csv(*nonmonotone_aggregate)))


def test_decreasing_source_timestamps_are_rejected_without_false_late_flags() -> None:
    rows = (
        _valid_row(timestamp=str(DAY_START_MS + 2)),
        _valid_row(
            aggregate_id="1",
            first_id="1",
            last_id="1",
            timestamp=str(DAY_START_MS + 1),
        ),
    )

    with pytest.raises(ArchiveImportError, match="timestamps must be nondecreasing"):
        _call(_zip(_csv(*rows)))


def test_discontinuities_count_aggregate_or_underlying_break_once_per_transition() -> None:
    rows = (
        _valid_row(aggregate_id="0", first_id="0", last_id="0"),
        _valid_row(
            aggregate_id="2",
            first_id="1",
            last_id="1",
            timestamp=str(DAY_START_MS + 2),
        ),
        _valid_row(
            aggregate_id="3",
            first_id="3",
            last_id="3",
            timestamp=str(DAY_START_MS + 3),
        ),
        _valid_row(
            aggregate_id="5",
            first_id="5",
            last_id="5",
            timestamp=str(DAY_START_MS + 4),
        ),
    )

    imported = _call(_zip(_csv(*rows)))

    assert imported.discontinuity_count == 3


def test_schema_fingerprint_binds_strict_container_and_ordering_semantics() -> None:
    assert BINANCE_SPOT_AGG_TRADES_SCHEMA_FINGERPRINT.hexdigest == (
        "272a42976182a5a97a2c926ee90f88d784fc232aaadbd8477d4a219d76c3af71"
    )


def test_retrieval_time_must_not_precede_any_source_evidence() -> None:
    archive_bytes = _zip(_csv(_valid_row()))
    event_ns = (DAY_START_MS + 1) * 1_000_000
    provenance = replace(
        _provenance(),
        retrieved_at_ns=event_ns - 1,
        normalization_time_ns=event_ns,
        persistence_time_ns=event_ns + 1,
    )

    with pytest.raises(ArchiveImportError, match="retrieved_at_ns"):
        _call(archive_bytes, provenance=provenance)


def test_provenance_and_limits_must_use_nominal_contract_types() -> None:
    archive_bytes = _zip(_csv(_valid_row()))
    with pytest.raises(ArchiveImportError, match="provenance"):
        import_binance_spot_daily_agg_trades(
            archive_bytes,
            _sidecar(archive_bytes),
            object(),  # type: ignore[arg-type]
        )
    with pytest.raises(ArchiveImportError, match="limits"):
        import_binance_spot_daily_agg_trades(
            archive_bytes,
            _sidecar(archive_bytes),
            _provenance(),
            limits=object(),  # type: ignore[arg-type]
        )


def test_private_url_guard_rejects_non_text_before_url_parsing() -> None:
    assert archive_module._is_exact_official_https_url(object()) is False


@pytest.mark.parametrize(
    ("member_name", "message"),
    [
        ("nested/payload.csv", "unnested basename"),
        ("payload.zip", "expected unnested CSV"),
    ],
)
def test_private_member_guard_defensively_rejects_unsafe_expected_names(
    member_name: str,
    message: str,
) -> None:
    archive_bytes = _zip_entries(((member_name, _csv(_valid_row())),))

    with pytest.raises(ArchiveImportError, match=message):
        archive_module._verified_member_bytes(
            archive_bytes,
            expected_member=member_name,
            limits=ArchiveImportLimitsV1(),
        )


@pytest.mark.parametrize(
    ("file_size", "compressed_size", "limit", "payload", "is_dir", "message"),
    [
        (0, 1, 8, b"", False, "empty or exceeds"),
        (1, 1, 8, b"x", True, "regular file"),
        (1, 0, 8, b"x", False, "invalid compressed size"),
        (1, 1, 1, b"xx", False, "decompressed archive member"),
        (2, 1, 8, b"x", False, "size disagrees"),
    ],
)
def test_private_member_guard_covers_defensive_metadata_and_stream_disagreement(
    file_size: int,
    compressed_size: int,
    limit: int,
    payload: bytes,
    is_dir: bool,
    message: str,
) -> None:
    member = MagicMock(spec=zipfile.ZipInfo)
    member.filename = _provenance().member_filename
    member.orig_filename = member.filename
    member.is_dir.return_value = is_dir
    member.external_attr = (stat.S_IFREG | 0o600) << 16
    member.flag_bits = 0
    member.compress_type = zipfile.ZIP_STORED
    member.file_size = file_size
    member.compress_size = compressed_size

    stream = MagicMock()
    stream.__enter__.return_value = stream
    stream.read.return_value = payload
    archive = MagicMock()
    archive.__enter__.return_value = archive
    archive.infolist.return_value = [member]
    archive.open.return_value = stream

    with (
        patch.object(zipfile, "ZipFile", return_value=archive),
        pytest.raises(ArchiveImportError, match=message),
    ):
        archive_module._verified_member_bytes(
            b"caller-bytes-verified-elsewhere",
            expected_member=_provenance().member_filename,
            limits=ArchiveImportLimitsV1(max_member_bytes=limit),
        )


def test_private_member_guard_defensively_rejects_reader_member_ambiguity() -> None:
    expected = _provenance().member_filename
    first = MagicMock(spec=zipfile.ZipInfo)
    first.filename = expected
    first.orig_filename = expected
    duplicate = MagicMock(spec=zipfile.ZipInfo)
    duplicate.filename = expected
    duplicate.orig_filename = expected
    other = MagicMock(spec=zipfile.ZipInfo)
    other.filename = "other.csv"
    other.orig_filename = "other.csv"
    mismatched = MagicMock(spec=zipfile.ZipInfo)
    mismatched.filename = expected
    mismatched.orig_filename = "mismatched.csv"

    for members, message in (
        ([first, duplicate], "duplicate member names"),
        ([first, other], "exactly one member"),
        ([mismatched], "member name"),
    ):
        archive = MagicMock()
        archive.__enter__.return_value = archive
        archive.infolist.return_value = members
        with (
            patch.object(zipfile, "ZipFile", return_value=archive),
            pytest.raises(ArchiveImportError, match=message),
        ):
            archive_module._verified_member_bytes(
                b"caller-bytes-verified-elsewhere",
                expected_member=expected,
                limits=ArchiveImportLimitsV1(),
            )


def test_private_member_guard_normalizes_zip_reader_failures() -> None:
    with (
        patch.object(zipfile, "ZipFile", side_effect=zipfile.BadZipFile("hostile")),
        pytest.raises(ArchiveImportError, match="malformed"),
    ):
        archive_module._verified_member_bytes(
            b"caller-bytes-verified-elsewhere",
            expected_member=_provenance().member_filename,
            limits=ArchiveImportLimitsV1(),
        )


def test_private_member_guard_defensively_rechecks_compression_ratio() -> None:
    member = MagicMock(spec=zipfile.ZipInfo)
    member.filename = _provenance().member_filename
    member.orig_filename = member.filename
    member.is_dir.return_value = False
    member.external_attr = (stat.S_IFREG | 0o600) << 16
    member.flag_bits = 0
    member.compress_type = zipfile.ZIP_STORED
    member.file_size = 3
    member.compress_size = 1
    archive = MagicMock()
    archive.__enter__.return_value = archive
    archive.infolist.return_value = [member]

    with (
        patch.object(zipfile, "ZipFile", return_value=archive),
        pytest.raises(ArchiveImportError, match="compression-ratio"),
    ):
        archive_module._verified_member_bytes(
            b"caller-bytes-verified-elsewhere",
            expected_member=member.filename,
            limits=ArchiveImportLimitsV1(max_compression_ratio=2),
        )
