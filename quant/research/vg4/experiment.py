"""Checksum-bound Binance Spot monthly 1d-kline ZIP ingestion for V-G4.

This module performs no network access and exposes no execution, account, or
capital authority. It validates already-frozen local archive and checksum bytes.
"""

from __future__ import annotations

import csv
import hashlib
import io
import re
import zipfile
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

SOURCE_ROOT = Path("/private/tmp/cosmos-s1f-weekly-momentum-cash-v1")
CHECKSUM_RE = re.compile(r"^([0-9a-f]{64})[ \t]+\*?([^\r\n]+)[\r\n]*$")
KLINE_HEADER = (
    "open_time",
    "open",
    "high",
    "low",
    "close",
    "volume",
    "close_time",
    "quote_volume",
    "count",
    "taker_buy_volume",
    "taker_buy_quote_volume",
    "ignore",
)


class VG4Error(RuntimeError):
    """A terminal protocol, source, or measurement failure."""


@dataclass(frozen=True, slots=True)
class Bar:
    symbol: str
    day: date
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    quote_volume: Decimal
    open_time_us: int
    close_time_us: int


def sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def decimal_from_text(value: str, *, field: str, nonnegative: bool = False) -> Decimal:
    try:
        parsed = Decimal(value)
    except InvalidOperation as error:
        raise VG4Error(f"{field} is not a decimal") from error
    if not parsed.is_finite() or (nonnegative and parsed < 0):
        raise VG4Error(f"{field} is outside its declared decimal domain")
    return parsed


def verify_checksum_text(checksum_bytes: bytes, zip_name: str, zip_sha: str) -> None:
    try:
        text = checksum_bytes.decode("ascii")
    except UnicodeDecodeError as error:
        raise VG4Error(f"{zip_name} checksum is not ASCII") from error
    match = CHECKSUM_RE.fullmatch(text)
    if match is None:
        raise VG4Error(f"{zip_name} checksum has an invalid grammar")
    published_sha, published_name = match.groups()
    if published_name.strip() != zip_name:
        raise VG4Error(f"{zip_name} checksum names a different object")
    if published_sha != zip_sha:
        raise VG4Error(f"{zip_name} does not match its official checksum")


def parse_timestamp_us(raw: str, *, field: str) -> tuple[int, datetime]:
    try:
        value = int(raw)
    except ValueError as error:
        raise VG4Error(f"{field} is not an integer timestamp") from error
    if value < 1_000_000_000_000_000:
        raise VG4Error(f"{field} is not a post-2025 microsecond timestamp")
    seconds, micros = divmod(value, 1_000_000)
    parsed = datetime.fromtimestamp(seconds, tz=UTC) + timedelta(microseconds=micros)
    return value, parsed


def parse_archive(artifact: Mapping[str, Any]) -> tuple[Bar, ...]:
    symbol = str(artifact["symbol"])
    month = str(artifact["month"])
    zip_path = SOURCE_ROOT / str(artifact["zipPath"])
    checksum_path = SOURCE_ROOT / str(artifact["checksumPath"])
    if sha256_path(zip_path) != artifact["zipSha256"]:
        raise VG4Error(f"{zip_path} changed after freeze")
    if sha256_path(checksum_path) != artifact["checksumSha256"]:
        raise VG4Error(f"{checksum_path} changed after freeze")
    verify_checksum_text(checksum_path.read_bytes(), zip_path.name, str(artifact["zipSha256"]))
    if zip_path.stat().st_size > 10_000_000:
        raise VG4Error(f"{zip_path} exceeds the frozen parser bound")

    with zipfile.ZipFile(zip_path) as archive:
        members = archive.infolist()
        if len(members) != 1 or members[0].is_dir():
            raise VG4Error(f"{zip_path} must contain exactly one regular member")
        member = members[0]
        expected_member = zip_path.name.removesuffix(".zip") + ".csv"
        if member.filename != expected_member or member.file_size > 20_000_000:
            raise VG4Error(f"{zip_path} member identity or size is invalid")
        with archive.open(member, "r") as raw:
            wrapper = io.TextIOWrapper(raw, encoding="ascii", newline="")
            reader = csv.reader(wrapper)
            bars: list[Bar] = []
            for row_number, row in enumerate(reader, start=1):
                if row_number == 1 and tuple(row) == KLINE_HEADER:
                    continue
                if len(row) != 12:
                    raise VG4Error(f"{zip_path}:{row_number} does not have 12 kline fields")
                open_us, open_dt = parse_timestamp_us(row[0], field="openTime")
                close_us, _close_dt = parse_timestamp_us(row[6], field="closeTime")
                if open_dt.time() != datetime.min.time() or open_dt.tzinfo != UTC:
                    raise VG4Error(f"{zip_path}:{row_number} is not a UTC daily open")
                if not open_us <= close_us < open_us + 86_400_000_000:
                    raise VG4Error(f"{zip_path}:{row_number} close boundary is invalid")
                if open_dt.strftime("%Y-%m") != month:
                    raise VG4Error(f"{zip_path}:{row_number} lies outside its archive month")
                open_price = decimal_from_text(row[1], field="open", nonnegative=True)
                high = decimal_from_text(row[2], field="high", nonnegative=True)
                low = decimal_from_text(row[3], field="low", nonnegative=True)
                close = decimal_from_text(row[4], field="close", nonnegative=True)
                quote_volume = decimal_from_text(row[7], field="quoteVolume", nonnegative=True)
                base_volume = decimal_from_text(row[5], field="baseVolume", nonnegative=True)
                taker_buy_base = decimal_from_text(
                    row[9], field="takerBuyBaseVolume", nonnegative=True
                )
                taker_buy_quote = decimal_from_text(
                    row[10], field="takerBuyQuoteVolume", nonnegative=True
                )
                decimal_from_text(row[11], field="ignore", nonnegative=True)
                try:
                    trade_count = int(row[8])
                except ValueError as error:
                    raise VG4Error(
                        f"{zip_path}:{row_number} trade count is not an integer"
                    ) from error
                if (
                    trade_count < 0
                    or taker_buy_base > base_volume
                    or taker_buy_quote > quote_volume
                ):
                    raise VG4Error(
                        f"{zip_path}:{row_number} has invalid trade or taker-volume fields"
                    )
                if open_price <= 0 or close <= 0 or low <= 0:
                    raise VG4Error(f"{zip_path}:{row_number} has a non-positive price")
                if high < max(open_price, close, low) or low > min(open_price, close, high):
                    raise VG4Error(f"{zip_path}:{row_number} violates OHLC geometry")
                bars.append(
                    Bar(
                        symbol=symbol,
                        day=open_dt.date(),
                        open=open_price,
                        high=high,
                        low=low,
                        close=close,
                        quote_volume=quote_volume,
                        open_time_us=open_us,
                        close_time_us=close_us,
                    )
                )
    if not 1 <= len(bars) <= 31:
        raise VG4Error(f"{zip_path} daily row count is outside 1..31")
    if tuple(item.day for item in bars) != tuple(sorted({item.day for item in bars})):
        raise VG4Error(f"{zip_path} daily rows are duplicate or unsorted")
    return tuple(bars)
