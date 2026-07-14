from __future__ import annotations

import hashlib
import io
import zipfile
from dataclasses import FrozenInstanceError, replace

import pytest

from quant_edge.bootstrap.archive import (
    BINANCE_ARCHIVE_SOURCE_ENDPOINT,
    BINANCE_ARCHIVE_SOURCE_ID,
    BINANCE_SPOT_AGG_TRADES_SCHEMA_FINGERPRINT,
    ArchiveImportError,
    ArchiveImportLimitsV1,
    BinanceSpotAggTradesImportV1,
    BinanceSpotAggTradesProvenanceV1,
    import_binance_spot_daily_agg_trades,
)
from quant_edge.lake.contracts import (
    EvidencePosture,
    ExactScaledValueV1,
    QualityState,
    TimestampBasis,
    TimestampUnit,
)

UTC_DATE = "2024-01-02"
DAY_START_MS = 1_704_153_600_000
RETRIEVED_NS = 1_783_814_400_000_000_000
NORMALIZATION_NS = RETRIEVED_NS + 1_000
PERSISTENCE_NS = RETRIEVED_NS + 2_000


def _provenance(
    *,
    unit: TimestampUnit = TimestampUnit.MILLISECOND,
    base_asset_id: str = "UNKNOWN_BASE",
    quote_asset_id: str = "UNKNOWN_QUOTE",
) -> BinanceSpotAggTradesProvenanceV1:
    archive_url = (
        "https://data.binance.vision/data/spot/daily/aggTrades/BNBUSDT/"
        f"BNBUSDT-aggTrades-{UTC_DATE}.zip"
    )
    return BinanceSpotAggTradesProvenanceV1(
        archive_url=archive_url,
        checksum_url=f"{archive_url}.CHECKSUM",
        symbol="BNBUSDT",
        base_asset_id=base_asset_id,
        quote_asset_id=quote_asset_id,
        utc_date=UTC_DATE,
        timestamp_unit=unit,
        retrieved_at_ns=RETRIEVED_NS,
        normalization_time_ns=NORMALIZATION_NS,
        persistence_time_ns=PERSISTENCE_NS,
        instrument_version="archive_symbol_only_v1",
    )


def _csv(*rows: str) -> bytes:
    return ("\n".join(rows) + "\n").encode("ascii")


def _zip(payload: bytes, *, member_name: str | None = None) -> bytes:
    provenance = _provenance()
    output = io.BytesIO()
    with zipfile.ZipFile(output, mode="w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(member_name or provenance.member_filename, payload)
    return output.getvalue()


def _sidecar(archive_bytes: bytes, *, terminal_lf: bool = True) -> bytes:
    suffix = "\n" if terminal_lf else ""
    return (
        f"{hashlib.sha256(archive_bytes).hexdigest()}  {_provenance().archive_filename}{suffix}"
    ).encode("ascii")


def _import(
    *rows: str,
    provenance: BinanceSpotAggTradesProvenanceV1 | None = None,
) -> BinanceSpotAggTradesImportV1:
    effective = _provenance() if provenance is None else provenance
    archive_bytes = _zip(_csv(*rows))
    return import_binance_spot_daily_agg_trades(
        archive_bytes,
        _sidecar(archive_bytes),
        effective,
    )


def test_import_preserves_exact_archive_rows_and_normalizes_to_q02_contract() -> None:
    first = f"0,12.3400,0.50000000,0,2,{DAY_START_MS + 123},True,True"
    second = f"1,12.3500,1.25000000,3,3,{DAY_START_MS + 456},False,True"
    archive_bytes = _zip(_csv(first, second))
    sidecar = _sidecar(archive_bytes)

    imported = import_binance_spot_daily_agg_trades(
        archive_bytes,
        sidecar,
        _provenance(),
    )

    assert imported.row_count == 2
    assert imported.archive_digest.hexdigest == hashlib.sha256(archive_bytes).hexdigest()
    assert imported.official_checksum == imported.archive_digest
    assert imported.sidecar_digest.hexdigest == hashlib.sha256(sidecar).hexdigest()
    assert imported.member_digest.hexdigest == hashlib.sha256(_csv(first, second)).hexdigest()
    assert imported.schema_fingerprint == BINANCE_SPOT_AGG_TRADES_SCHEMA_FINGERPRINT
    assert imported.compressed_bytes > 0
    assert imported.member_bytes == len(_csv(first, second))

    raw = imported.raw_rows[0]
    assert raw.row_number == 1
    assert raw.aggregate_trade_id == 0
    assert raw.first_trade_id == 0
    assert raw.last_trade_id == 2
    assert raw.price_text == "12.3400"
    assert raw.quantity_text == "0.50000000"
    assert raw.price == ExactScaledValueV1(123_400, 4, "UNKNOWN_QUOTE")
    assert raw.quantity == ExactScaledValueV1(50_000_000, 8, "UNKNOWN_BASE")
    assert raw.raw_row_bytes == f"{first}\n".encode()
    assert raw.raw_row_digest.hexdigest == hashlib.sha256(raw.raw_row_bytes).hexdigest()
    assert raw.buyer_was_maker is True
    assert raw.best_price_match is True

    row = imported.normalized_rows[0]
    assert row.record_id == "binance.spot.aggTrade.BNBUSDT.0"
    assert row.source_id == BINANCE_ARCHIVE_SOURCE_ID
    assert row.source_endpoint == BINANCE_ARCHIVE_SOURCE_ENDPOINT
    assert (row.venue, row.product, row.event_kind) == ("binance", "spot", "aggTrades")
    assert row.symbol == "BNBUSDT"
    assert row.instrument_version == "archive_symbol_only_v1"
    assert row.event_time is raw.event_time
    assert row.trade_time is raw.event_time
    assert row.receive_wall_time is None
    assert row.receive_monotonic_ns is None
    assert row.normalization_time_ns == NORMALIZATION_NS
    assert row.persistence_time_ns == PERSISTENCE_NS
    assert row.sequence_first == 0
    assert row.sequence_last == 2
    assert row.raw_payload_digest == raw.raw_row_digest
    assert row.posture is EvidencePosture.REPLAY
    assert row.duplicate is False
    assert row.late is False
    assert row.quality.state is QualityState.PARTIAL
    assert "ARCHIVE_COMPLETENESS_UNPROVEN" in row.quality.reason_codes
    assert "ARCHIVE_RECEIVE_CLOCK_UNAVAILABLE" in row.quality.reason_codes
    assert row.price is raw.price
    assert row.quantity is raw.quantity
    assert imported.first_source_time.raw == DAY_START_MS + 123
    assert imported.last_source_time.raw == DAY_START_MS + 456


def test_symbol_is_never_split_into_fabricated_asset_identity() -> None:
    imported = _import(
        f"0,1.00,2.00,0,0,{DAY_START_MS + 1},True,False",
        provenance=_provenance(
            base_asset_id="UNKNOWN_BASE",
            quote_asset_id="UNKNOWN_QUOTE",
        ),
    )

    raw = imported.raw_rows[0]
    normalized = imported.normalized_rows[0]
    assert raw.price.unit_id == "UNKNOWN_QUOTE"
    assert raw.quantity.unit_id == "UNKNOWN_BASE"
    assert normalized.base_asset_id == "UNKNOWN_BASE"
    assert normalized.quote_asset_id == "UNKNOWN_QUOTE"
    assert normalized.base_asset_id != "BNB"
    assert normalized.quote_asset_id != "USDT"


def test_scale_38_fraction_is_preserved_when_its_coefficient_fits_decimal128() -> None:
    price = f"0.{('0' * 37)}1"
    imported = _import(f"0,{price},1,0,0,{DAY_START_MS + 1},True,False")

    assert imported.raw_rows[0].price_text == price
    assert imported.raw_rows[0].price == ExactScaledValueV1(1, 38, "UNKNOWN_QUOTE")


@pytest.mark.parametrize(
    ("unit", "raw", "expected_ns"),
    [
        (
            TimestampUnit.MILLISECOND,
            DAY_START_MS + 123,
            (DAY_START_MS + 123) * 1_000_000,
        ),
        (
            TimestampUnit.MICROSECOND,
            DAY_START_MS * 1_000 + 123_456,
            (DAY_START_MS * 1_000 + 123_456) * 1_000,
        ),
        (
            TimestampUnit.NANOSECOND,
            DAY_START_MS * 1_000_000 + 123_456_789,
            DAY_START_MS * 1_000_000 + 123_456_789,
        ),
    ],
)
def test_explicit_timestamp_units_normalize_losslessly_without_guessing(
    unit: TimestampUnit,
    raw: int,
    expected_ns: int,
) -> None:
    imported = _import(
        f"0,1,2,0,0,{raw},True,False",
        provenance=_provenance(unit=unit),
    )

    timestamp = imported.raw_rows[0].event_time
    assert timestamp.raw == raw
    assert timestamp.unit is unit
    assert timestamp.basis is TimestampBasis.DECLARED
    assert timestamp.normalized_ns == expected_ns
    assert imported.normalized_rows[0].event_time is timestamp


def test_identical_bytes_and_provenance_produce_identical_immutable_results() -> None:
    payload = _csv(
        f"0,1.2300,4.5600,0,1,{DAY_START_MS + 1},True,False",
        f"1,1.2400,5.6700,2,2,{DAY_START_MS + 2},False,True",
    )
    archive_bytes = _zip(payload)
    sidecar = _sidecar(archive_bytes)
    provenance = _provenance()

    first = import_binance_spot_daily_agg_trades(archive_bytes, sidecar, provenance)
    second = import_binance_spot_daily_agg_trades(archive_bytes, sidecar, provenance)

    assert first == second
    assert first.raw_rows == second.raw_rows
    assert first.normalized_rows == second.normalized_rows
    with pytest.raises(FrozenInstanceError):
        first.raw_rows[0].price_text = "changed"  # type: ignore[misc]


def test_official_sidecar_with_or_without_one_terminal_lf_is_exactly_bound() -> None:
    archive_bytes = _zip(_csv(f"0,1,2,0,0,{DAY_START_MS + 1},True,False"))

    with_lf = import_binance_spot_daily_agg_trades(
        archive_bytes, _sidecar(archive_bytes), _provenance()
    )
    without_lf = import_binance_spot_daily_agg_trades(
        archive_bytes,
        _sidecar(archive_bytes, terminal_lf=False),
        _provenance(),
    )

    assert with_lf.official_checksum == without_lf.official_checksum
    assert with_lf.archive_digest == without_lf.archive_digest
    assert with_lf.sidecar_digest != without_lf.sidecar_digest


def test_provenance_derives_exact_expected_official_names_and_day_bounds() -> None:
    provenance = _provenance()

    assert provenance.archive_filename == f"BNBUSDT-aggTrades-{UTC_DATE}.zip"
    assert provenance.member_filename == f"BNBUSDT-aggTrades-{UTC_DATE}.csv"
    assert provenance.expected_archive_path.endswith(provenance.archive_filename)
    assert provenance.day_start_ns == DAY_START_MS * 1_000_000
    assert provenance.day_end_ns == (DAY_START_MS + 86_400_000) * 1_000_000


@pytest.mark.parametrize(
    "changes",
    [
        {"archive_url": "http://data.binance.vision/nope.zip"},
        {"archive_url": "https://evil.invalid/data/spot/daily/aggTrades/nope.zip"},
        {
            "archive_url": (
                "https://data.binance.vision/data/spot/daily/aggTrades/BNBUSDT/"
                f"BNBUSDT-aggTrades-{UTC_DATE}.zip?x=1"
            )
        },
        {"checksum_url": "https://data.binance.vision/not-adjacent.CHECKSUM"},
        {"symbol": "bnbusdt"},
        {"utc_date": 20240102},
        {"utc_date": "20240102"},
        {"utc_date": "2024-1-2"},
        {"utc_date": "2009-12-31"},
        {"timestamp_unit": "MILLISECOND"},
        {"retrieved_at_ns": True},
        {"normalization_time_ns": RETRIEVED_NS - 1},
        {"persistence_time_ns": NORMALIZATION_NS - 1},
        {"base_asset_id": "../BNB"},
    ],
)
def test_provenance_rejects_ambiguous_or_nonofficial_identity(
    changes: dict[str, object],
) -> None:
    with pytest.raises(ArchiveImportError):
        replace(_provenance(), **changes)  # type: ignore[arg-type]


@pytest.mark.parametrize(
    "field",
    [
        "max_archive_bytes",
        "max_member_bytes",
        "max_rows",
        "max_line_bytes",
        "max_compression_ratio",
        "max_sidecar_bytes",
    ],
)
def test_limits_reject_zero_bool_and_values_beyond_hard_ceilings(field: str) -> None:
    with pytest.raises(ArchiveImportError):
        ArchiveImportLimitsV1(**{field: 0})
    with pytest.raises(ArchiveImportError):
        ArchiveImportLimitsV1(**{field: True})
    with pytest.raises(ArchiveImportError):
        ArchiveImportLimitsV1(**{field: 1 << 62})
