from __future__ import annotations

import hashlib
import io
import zipfile

from hypothesis import given, seed, settings
from hypothesis import strategies as st

from quant_edge.bootstrap.archive import (
    BinanceSpotAggTradesProvenanceV1,
    import_binance_spot_daily_agg_trades,
)
from quant_edge.lake.contracts import TimestampBasis, TimestampUnit

UTC_DATE = "2024-01-02"
DAY_START_MS = 1_704_153_600_000
RETRIEVED_NS = 1_783_814_400_000_000_000
UNIT_MULTIPLIER: dict[TimestampUnit, int] = {
    TimestampUnit.MILLISECOND: 1_000_000,
    TimestampUnit.MICROSECOND: 1_000,
    TimestampUnit.NANOSECOND: 1,
}


def _provenance(unit: TimestampUnit) -> BinanceSpotAggTradesProvenanceV1:
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


def _archive(row: str, provenance: BinanceSpotAggTradesProvenanceV1) -> tuple[bytes, bytes]:
    output = io.BytesIO()
    with zipfile.ZipFile(output, mode="w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(provenance.member_filename, f"{row}\n".encode("ascii"))
    archive_bytes = output.getvalue()
    checksum = (
        f"{hashlib.sha256(archive_bytes).hexdigest()}  {provenance.archive_filename}\n"
    ).encode("ascii")
    return archive_bytes, checksum


def _decimal_text(coefficient: int, scale: int) -> str:
    digits = str(coefficient)
    if scale == 0:
        return digits
    padded = digits.rjust(scale + 1, "0")
    return f"{padded[:-scale]}.{padded[-scale:]}"


@settings(max_examples=32, deadline=None)
@seed(20260712)
@given(
    price_coefficient=st.integers(min_value=1, max_value=10**30),
    price_scale=st.integers(min_value=0, max_value=38),
    quantity_coefficient=st.integers(min_value=1, max_value=10**30),
    quantity_scale=st.integers(min_value=0, max_value=38),
)
def test_exact_decimal_text_and_scale_survive_archive_normalization(
    price_coefficient: int,
    price_scale: int,
    quantity_coefficient: int,
    quantity_scale: int,
) -> None:
    provenance = _provenance(TimestampUnit.MILLISECOND)
    price = _decimal_text(price_coefficient, price_scale)
    quantity = _decimal_text(quantity_coefficient, quantity_scale)
    row = f"0,{price},{quantity},0,0,{DAY_START_MS + 1},True,False"
    archive_bytes, sidecar = _archive(row, provenance)

    imported = import_binance_spot_daily_agg_trades(archive_bytes, sidecar, provenance)
    raw = imported.raw_rows[0]

    assert raw.price_text == price
    assert raw.quantity_text == quantity
    assert raw.price.coefficient == price_coefficient
    assert raw.price.scale == price_scale
    assert raw.quantity.coefficient == quantity_coefficient
    assert raw.quantity.scale == quantity_scale
    assert imported.normalized_rows[0].price == raw.price
    assert imported.normalized_rows[0].quantity == raw.quantity


@settings(max_examples=24, deadline=None)
@seed(20260712)
@given(
    unit=st.sampled_from(tuple(TimestampUnit)),
    offset_ns=st.integers(min_value=0, max_value=86_399_000_000_000),
)
def test_explicit_unit_is_never_inferred_multiplied_or_truncated(
    unit: TimestampUnit,
    offset_ns: int,
) -> None:
    multiplier = UNIT_MULTIPLIER[unit]
    aligned_offset = (offset_ns // multiplier) * multiplier
    expected_ns = DAY_START_MS * 1_000_000 + aligned_offset
    raw_time = expected_ns // multiplier
    provenance = _provenance(unit)
    row = f"0,1,1,0,0,{raw_time},True,False"
    archive_bytes, sidecar = _archive(row, provenance)

    imported = import_binance_spot_daily_agg_trades(archive_bytes, sidecar, provenance)
    timestamp = imported.raw_rows[0].event_time

    assert timestamp.raw == raw_time
    assert timestamp.unit is unit
    assert timestamp.basis is TimestampBasis.DECLARED
    assert timestamp.normalized_ns == raw_time * multiplier
    assert timestamp.normalized_ns == expected_ns


@settings(max_examples=16, deadline=None)
@seed(20260712)
@given(
    aggregate_id=st.integers(min_value=0, max_value=(1 << 64) - 1),
    first_id=st.integers(min_value=0, max_value=(1 << 63) - 1),
    width=st.integers(min_value=0, max_value=1_000),
)
def test_identical_caller_bytes_and_provenance_are_fully_deterministic(
    aggregate_id: int,
    first_id: int,
    width: int,
) -> None:
    provenance = _provenance(TimestampUnit.MILLISECOND)
    row = (
        f"{aggregate_id},1.00000000,2.00000000,{first_id},{first_id + width},"
        f"{DAY_START_MS + 1},False,True"
    )
    archive_bytes, sidecar = _archive(row, provenance)

    first = import_binance_spot_daily_agg_trades(archive_bytes, sidecar, provenance)
    second = import_binance_spot_daily_agg_trades(archive_bytes, sidecar, provenance)

    assert first == second
    assert first.archive_digest == second.archive_digest
    assert first.member_digest == second.member_digest
    assert first.raw_rows == second.raw_rows
    assert first.normalized_rows == second.normalized_rows
