"""S-1G deterministic public-archive BTCUSDT Basis carry experiment.

This module is deliberately research-only.  It has no authenticated exchange
surface, no executor, and no order path.  Historical public archives are verified
against their sibling checksums before decoding.  The experiment models every
maker attempt as a non-fill because public candle archives cannot establish queue
priority; both legs therefore fall back together to taker fills on a later bar.

The frozen family has twelve trials:

* positive-funding lookback L in {6, 18} settlements;
* maximum holding period H in {1, 3, 7} days;
* additional forecast buffer in {0, 5} basis points.

Development uses 52 synchronous UTC weeks in 2020-01-01..2020-12-30.  Each
predeclared trial is scored one week at a time, and a causal diagnostic records
52 next-week selections, using a predeclared lexical candidate for the first
week and prior weeks only thereafter: a complete 12-month walk-forward.  The
later four-week historical validation partition in 2021-01-01..2021-01-29 is
inaccessible unless a digest-bound, atomic, single-use marker is consumed.
Account-effective fees and maker execution truth remain UNKNOWN.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import math
import os
import re
import stat
import tempfile
import urllib.request
import zipfile
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from decimal import ROUND_DOWN, Decimal, InvalidOperation, getcontext
from itertools import combinations
from pathlib import Path, PurePosixPath
from typing import Final, Literal, cast

getcontext().prec = 50

HERE: Final = Path(__file__).resolve().parent
FIXED_RAW_ROOT: Final = Path("/private/tmp/cosmos-s1g-basis-carry-v1")
ZERO: Final = Decimal("0")
ONE: Final = Decimal("1")
BPS: Final = Decimal("10000")
MILLISECOND: Final = 1
MINUTE_MS: Final = 60_000
HOUR_MS: Final = 60 * MINUTE_MS
DAY_MS: Final = 24 * HOUR_MS
WEEK_MS: Final = 7 * DAY_MS
ACCOUNT_CAPITAL_USD: Final = Decimal("1000")
PAIR_NOTIONAL_USD: Final = Decimal("400")
QUANTITY_STEP_BTC: Final = Decimal("0.001")
MAKER_TIMEOUT_MS: Final = MINUTE_MS
MAX_ARCHIVE_BYTES: Final = 768 * 1024 * 1024
MAX_MEMBER_BYTES: Final = 2 * 1024 * 1024 * 1024
MAX_COMPRESSION_RATIO: Final = 300
MAX_CSV_ROWS: Final = 1_000_000
SHA256_RE: Final = re.compile(r"^[0-9a-f]{64}$")

DEVELOPMENT_START_MS: Final = int(datetime(2020, 1, 1, tzinfo=UTC).timestamp() * 1000)
DEVELOPMENT_END_MS: Final = int(datetime(2020, 12, 30, tzinfo=UTC).timestamp() * 1000)
HOLDOUT_START_MS: Final = int(datetime(2021, 1, 1, tzinfo=UTC).timestamp() * 1000)
HOLDOUT_END_MS: Final = int(datetime(2021, 1, 29, tzinfo=UTC).timestamp() * 1000)
DEVELOPMENT_WEEKS: Final = 52
WALK_FORWARD_INITIAL_WEEKS: Final = 0
WALK_FORWARD_STEPS: Final = 52
HOLDOUT_WEEKS: Final = 4
PBO_WEEKS_PER_BLOCK: Final = 4
PBO_START_WEEK: Final = 4
PBO_BLOCKS: Final = 12
WALK_FORWARD_HISTORY_DAYS: Final = 18

type ArchiveSchema = Literal["KLINE", "FUNDING"]
type PartitionName = Literal["development", "holdout"]


class ArchiveValidationError(ValueError):
    """A public archive or checksum failed the frozen fail-closed contract."""


class HoldoutAlreadyConsumedError(RuntimeError):
    """The historical validation partition's one-use marker already exists."""


class ProtocolValidationError(ValueError):
    """The predeclared protocol does not match the executable contract."""


@dataclass(frozen=True, slots=True)
class Bar:
    """One complete one-minute candle from an official public archive."""

    ts_ms: int
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    quote_volume: Decimal

    def __post_init__(self) -> None:
        if isinstance(self.ts_ms, bool) or not isinstance(self.ts_ms, int):
            raise TypeError("ts_ms must be an integer")
        if self.ts_ms < 0 or self.ts_ms % MINUTE_MS != 0:
            raise ValueError("bar timestamp must be a non-negative UTC minute")
        if min(self.open, self.high, self.low, self.close) <= ZERO:
            raise ValueError("bar prices must be positive")
        if self.high < max(self.open, self.close) or self.low > min(self.open, self.close):
            raise ValueError("bar OHLC ordering is invalid")
        if self.quote_volume < ZERO:
            raise ValueError("bar quote volume must be non-negative")


@dataclass(frozen=True, slots=True)
class FundingEvent:
    """A settled USD-M funding observation and its causal mark-price proxy."""

    ts_ms: int
    rate: Decimal
    mark_price: Decimal

    def __post_init__(self) -> None:
        if isinstance(self.ts_ms, bool) or not isinstance(self.ts_ms, int):
            raise TypeError("ts_ms must be an integer")
        if self.ts_ms < 0:
            raise ValueError("funding timestamp must be non-negative")
        if not self.rate.is_finite():
            raise ValueError("funding rate must be finite")
        if not self.mark_price.is_finite() or self.mark_price <= ZERO:
            raise ValueError("funding mark price must be positive and finite")


@dataclass(frozen=True, slots=True)
class Fill:
    """One modeled fill; reference price excludes separately reported costs."""

    ts_ms: int
    side: Literal["BUY", "SELL"]
    liquidity: Literal["TAKER"]
    quantity: Decimal
    reference_price: Decimal


@dataclass(frozen=True, slots=True)
class EntryExecution:
    """Paired long-Spot/short-perpetual entry after an unfilled maker attempt."""

    signal_ts_ms: int
    maker_attempts: int
    maker_fills: int
    fallback_used: bool
    spot_fill: Fill
    perp_fill: Fill


@dataclass(frozen=True, slots=True)
class CostScenario:
    """Per-fill cost assumptions in basis points.

    ``latency_bps_per_fill`` has a default solely for backward-compatible pure
    function tests.  Every frozen S-1G scenario declares it explicitly.
    """

    spot_taker_fee_bps: Decimal
    futures_taker_fee_bps: Decimal
    spread_bps_per_fill: Decimal
    slippage_bps_per_fill: Decimal
    latency_bps_per_fill: Decimal = ZERO

    def __post_init__(self) -> None:
        values = (
            self.spot_taker_fee_bps,
            self.futures_taker_fee_bps,
            self.spread_bps_per_fill,
            self.slippage_bps_per_fill,
            self.latency_bps_per_fill,
        )
        if any(not value.is_finite() or value < ZERO for value in values):
            raise ValueError("cost scenario values must be finite and non-negative")


PRIMARY_COSTS: Final = CostScenario(
    spot_taker_fee_bps=Decimal("10"),
    futures_taker_fee_bps=Decimal("10"),
    spread_bps_per_fill=Decimal("3"),
    slippage_bps_per_fill=Decimal("4"),
    latency_bps_per_fill=Decimal("3"),
)
STRESS_COSTS: Final = CostScenario(
    spot_taker_fee_bps=Decimal("10"),
    futures_taker_fee_bps=Decimal("10"),
    spread_bps_per_fill=Decimal("5"),
    slippage_bps_per_fill=Decimal("10"),
    latency_bps_per_fill=Decimal("5"),
)
SEVERE_COSTS: Final = CostScenario(
    spot_taker_fee_bps=Decimal("10"),
    futures_taker_fee_bps=Decimal("10"),
    spread_bps_per_fill=Decimal("10"),
    slippage_bps_per_fill=Decimal("25"),
    latency_bps_per_fill=Decimal("15"),
)


@dataclass(frozen=True, slots=True)
class CostBreakdown:
    """Exact PnL decomposition; every expense is positive and subtracted."""

    gross_basis_usd: Decimal
    funding_usd: Decimal
    spot_fees_usd: Decimal
    futures_fees_usd: Decimal
    spread_usd: Decimal
    slippage_usd: Decimal
    rounding_usd: Decimal
    latency_usd: Decimal
    net_usd: Decimal


@dataclass(frozen=True, slots=True)
class Drawdown:
    max_drawdown_usd: Decimal
    max_drawdown_bps: Decimal
    peak_usd: Decimal
    trough_usd: Decimal


@dataclass(frozen=True, slots=True)
class BootstrapInterval:
    lower: Decimal
    point: Decimal
    upper: Decimal
    replicates: int
    alpha: Decimal


@dataclass(frozen=True, slots=True)
class CscvPboResult:
    """Exact CSCV numerator, denominator, and ratio."""

    underperform_count: int
    split_count: int

    @property
    def value(self) -> Decimal:
        return Decimal(self.underperform_count) / Decimal(self.split_count)


@dataclass(frozen=True, slots=True, order=True)
class Candidate:
    """One of the twelve predeclared trials."""

    lookback_events: int
    hold_days: int
    forecast_buffer_bps: Decimal

    @property
    def candidate_id(self) -> str:
        buffer = int(self.forecast_buffer_bps)
        return f"s1g-l{self.lookback_events:02d}-h{self.hold_days:02d}-b{buffer:03d}"


CANDIDATES: Final = tuple(
    Candidate(lookback, hold_days, buffer)
    for lookback in (6, 18)
    for hold_days in (1, 3, 7)
    for buffer in (Decimal("0"), Decimal("5"))
)


@dataclass(frozen=True, slots=True)
class Position:
    candidate_id: str
    entry_ts_ms: int
    spot_entry: Decimal
    perp_entry: Decimal
    quantity: Decimal
    entry_basis_ratio: Decimal
    scheduled_exit_ts_ms: int
    entry_capacity_usd: Decimal
    entry_stress_capacity_usd: Decimal


@dataclass(frozen=True, slots=True)
class Trade:
    candidate_id: str
    entry_ts_ms: int
    exit_ts_ms: int
    exit_reason: str
    quantity: Decimal
    capacity_usd: Decimal
    stress_capacity_usd: Decimal
    primary: CostBreakdown
    stress: CostBreakdown
    severe: CostBreakdown


@dataclass(frozen=True, slots=True)
class CandidateEvaluation:
    candidate: Candidate
    weekly_primary_usd: tuple[Decimal, ...]
    weekly_stress_usd: tuple[Decimal, ...]
    weekly_severe_usd: tuple[Decimal, ...]
    trades: tuple[Trade, ...]
    drawdown: Drawdown
    stress_drawdown: Drawdown
    active_week_count: int
    paired_maker_attempt_count: int
    ending_primary_equity_usd: Decimal
    ending_running_peak_usd: Decimal
    ending_cooldown_until_ms: int
    terminal_stop: bool
    minimum_capacity_usd: Decimal
    minimum_stress_capacity_usd: Decimal

    @property
    def primary_net_usd(self) -> Decimal:
        return sum(self.weekly_primary_usd, ZERO)

    @property
    def stress_net_usd(self) -> Decimal:
        return sum(self.weekly_stress_usd, ZERO)

    @property
    def severe_net_usd(self) -> Decimal:
        return sum(self.weekly_severe_usd, ZERO)


def _decimal(value: str, *, field: str) -> Decimal:
    try:
        parsed = Decimal(value)
    except InvalidOperation as exc:
        raise ArchiveValidationError(f"{field} schema value is not decimal") from exc
    if not parsed.is_finite():
        raise ArchiveValidationError(f"{field} schema value is not finite")
    return parsed


def _parse_timestamp_ms(value: str, *, field: str) -> int:
    stripped = value.strip()
    if stripped.isdigit():
        timestamp = int(stripped)
        if timestamp >= 10**14:
            raise ArchiveValidationError(
                f"{field} schema timestamp unit is not frozen 2020 milliseconds"
            )
    else:
        try:
            parsed = datetime.strptime(stripped, "%Y-%m-%d %H:%M:%S").replace(tzinfo=UTC)
        except ValueError as exc:
            raise ArchiveValidationError(f"{field} schema timestamp is invalid") from exc
        timestamp = int(parsed.timestamp() * 1000)
    if timestamp < 0:
        raise ArchiveValidationError(f"{field} schema timestamp is negative")
    return timestamp


def _validate_kline_rows(rows: list[tuple[str, ...]]) -> None:
    previous: int | None = None
    for index, row in enumerate(rows):
        if len(row) != 12:
            raise ArchiveValidationError(f"KLINE schema requires 12 columns at row {index}")
        timestamp = _parse_timestamp_ms(row[0], field="KLINE")
        open_price = _decimal(row[1], field="KLINE")
        high = _decimal(row[2], field="KLINE")
        low = _decimal(row[3], field="KLINE")
        close = _decimal(row[4], field="KLINE")
        close_timestamp = _parse_timestamp_ms(row[6], field="KLINE")
        quote_volume = _decimal(row[7], field="KLINE")
        if timestamp % MINUTE_MS != 0:
            raise ArchiveValidationError("KLINE schema timestamp is not minute aligned")
        if min(open_price, high, low, close) <= ZERO:
            raise ArchiveValidationError("KLINE schema prices must be positive")
        if high < max(open_price, close) or low > min(open_price, close):
            raise ArchiveValidationError("KLINE schema OHLC ordering is invalid")
        if quote_volume < ZERO:
            raise ArchiveValidationError("KLINE schema quote volume is negative")
        if close_timestamp != timestamp + MINUTE_MS - MILLISECOND:
            raise ArchiveValidationError("KLINE schema close time is not open plus 59,999ms")
        if previous is not None and timestamp <= previous:
            raise ArchiveValidationError("KLINE schema timestamps are not unique ascending")
        previous = timestamp


def _validate_funding_rows(rows: list[tuple[str, ...]]) -> None:
    expected_header = (
        "calc_time",
        "funding_interval_hours",
        "last_funding_rate",
    )
    if not rows or rows[0] != expected_header:
        raise ArchiveValidationError("FUNDING schema header drift")
    previous: int | None = None
    for index, row in enumerate(rows[1:], start=1):
        if len(row) != 3:
            raise ArchiveValidationError(f"FUNDING schema requires 3 columns at row {index}")
        timestamp = _parse_timestamp_ms(row[0], field="FUNDING")
        interval_hours = _decimal(row[1], field="FUNDING")
        rate = _decimal(row[2], field="FUNDING")
        if interval_hours <= ZERO or interval_hours > Decimal("24"):
            raise ArchiveValidationError("FUNDING schema interval is outside (0, 24]")
        if timestamp % MINUTE_MS != 0:
            raise ArchiveValidationError("FUNDING schema timestamp is not minute aligned")
        if rate.copy_abs() > Decimal("0.1"):
            raise ArchiveValidationError("FUNDING schema rate magnitude is implausible")
        if previous is not None and timestamp <= previous:
            raise ArchiveValidationError("FUNDING schema timestamps are not unique ascending")
        previous = timestamp


def _safe_archive_member(info: zipfile.ZipInfo, *, expected_member: str) -> None:
    path = PurePosixPath(info.filename)
    unix_mode = info.external_attr >> 16
    if (
        info.is_dir()
        or info.filename != expected_member
        or path.is_absolute()
        or ".." in path.parts
        or len(path.parts) != 1
        or stat.S_ISLNK(unix_mode)
    ):
        raise ArchiveValidationError("archive expected member contract failed")
    if info.file_size > MAX_MEMBER_BYTES:
        raise ArchiveValidationError("archive member is too large")
    if info.compress_size == 0 and info.file_size > 0:
        raise ArchiveValidationError("archive member has invalid compression metadata")
    if info.compress_size > 0 and info.file_size > info.compress_size * MAX_COMPRESSION_RATIO:
        raise ArchiveValidationError("archive compression ratio exceeds limit")


def read_verified_archive(
    archive_path: Path,
    checksum_path: Path,
    *,
    expected_member: str,
    schema: ArchiveSchema,
) -> tuple[tuple[str, ...], ...]:
    """Verify a Binance sibling checksum and decode one exact ordinary CSV member."""

    if schema not in ("KLINE", "FUNDING"):
        raise ArchiveValidationError("unknown archive schema")
    if not archive_path.is_file() or not checksum_path.is_file():
        raise ArchiveValidationError("archive and checksum must both exist")
    if archive_path.stat().st_size > MAX_ARCHIVE_BYTES:
        raise ArchiveValidationError("archive exceeds size limit")
    try:
        checksum_text = checksum_path.read_text(encoding="ascii")
    except (OSError, UnicodeError) as exc:
        raise ArchiveValidationError("checksum is unreadable") from exc
    checksum_lines = checksum_text.splitlines()
    if len(checksum_lines) != 1:
        raise ArchiveValidationError("checksum must contain exactly one line")
    fields = checksum_lines[0].split()
    if len(fields) != 2:
        raise ArchiveValidationError("checksum line shape is invalid")
    published_digest, published_name = fields
    if not SHA256_RE.fullmatch(published_digest) or published_name.lstrip("*") != archive_path.name:
        raise ArchiveValidationError("checksum filename or digest is invalid")
    digest = hashlib.sha256()
    try:
        with archive_path.open("rb") as stream:
            while chunk := stream.read(1024 * 1024):
                digest.update(chunk)
    except OSError as exc:
        raise ArchiveValidationError("archive is unreadable") from exc
    if digest.hexdigest() != published_digest:
        raise ArchiveValidationError("archive checksum mismatch")

    try:
        with zipfile.ZipFile(archive_path) as archive:
            members = archive.infolist()
            if len(members) != 1:
                raise ArchiveValidationError("archive must contain a single member")
            info = members[0]
            _safe_archive_member(info, expected_member=expected_member)
            with archive.open(info, "r") as raw:
                text = io.TextIOWrapper(raw, encoding="utf-8", newline="")
                reader = csv.reader(text, strict=True)
                rows = [tuple(cell.strip() for cell in row) for row in reader]
    except ArchiveValidationError:
        raise
    except (OSError, UnicodeError, csv.Error, zipfile.BadZipFile) as exc:
        raise ArchiveValidationError("archive member could not be decoded") from exc
    if not rows or len(rows) > MAX_CSV_ROWS:
        raise ArchiveValidationError("archive CSV row count is invalid")
    if any(not row or any(cell == "" for cell in row) for row in rows):
        raise ArchiveValidationError("archive CSV contains empty schema values")
    if schema == "KLINE":
        _validate_kline_rows(rows)
    else:
        _validate_funding_rows(rows)
    return tuple(rows)


def rows_to_bars(rows: Iterable[tuple[str, ...]]) -> tuple[Bar, ...]:
    """Convert already verified KLINE rows into strict minute bars."""

    bars = tuple(
        Bar(
            ts_ms=_parse_timestamp_ms(row[0], field="KLINE"),
            open=_decimal(row[1], field="KLINE"),
            high=_decimal(row[2], field="KLINE"),
            low=_decimal(row[3], field="KLINE"),
            close=_decimal(row[4], field="KLINE"),
            quote_volume=_decimal(row[7], field="KLINE"),
        )
        for row in rows
    )
    if not bars:
        raise ArchiveValidationError("KLINE schema produced no bars")
    return bars


def rows_to_funding(
    rows: Sequence[tuple[str, ...]],
    mark_bars: Mapping[int, Bar],
) -> tuple[FundingEvent, ...]:
    """Join verified funding settlements to the same-minute mark-price open."""

    if not rows:
        raise ArchiveValidationError("FUNDING schema produced no rows")
    events: list[FundingEvent] = []
    for row in rows[1:]:
        timestamp = _parse_timestamp_ms(row[0], field="FUNDING")
        bar = mark_bars.get(timestamp - timestamp % MINUTE_MS)
        if bar is None:
            raise ArchiveValidationError("funding-to-mark join loss is non-zero")
        events.append(
            FundingEvent(
                ts_ms=timestamp,
                rate=_decimal(row[2], field="FUNDING"),
                mark_price=bar.open,
            )
        )
    if not events:
        raise ArchiveValidationError("FUNDING schema produced no events")
    return tuple(events)


def execute_entry(
    *,
    signal_ts_ms: int,
    spot_bars: Sequence[Bar],
    perp_bars: Sequence[Bar],
    quantity: Decimal,
    maker_timeout_ms: int = MAKER_TIMEOUT_MS,
) -> EntryExecution:
    """Model two maker attempts as non-fills, then pair taker fills causally."""

    if quantity <= ZERO:
        raise ValueError("quantity must be positive")
    if maker_timeout_ms <= 0 or maker_timeout_ms % MINUTE_MS != 0:
        raise ValueError("maker timeout must be a positive minute multiple")
    fallback_ts = signal_ts_ms + maker_timeout_ms
    spot_by_time = {bar.ts_ms: bar for bar in spot_bars}
    perp_by_time = {bar.ts_ms: bar for bar in perp_bars}
    spot_bar = spot_by_time.get(fallback_ts)
    perp_bar = perp_by_time.get(fallback_ts)
    if spot_bar is None and perp_bar is None:
        raise ValueError("fallback bar is unavailable for both legs")
    if spot_bar is None or perp_bar is None:
        raise ValueError("paired fallback requires both legs at the same timestamp")
    return EntryExecution(
        signal_ts_ms=signal_ts_ms,
        maker_attempts=2,
        maker_fills=0,
        fallback_used=True,
        spot_fill=Fill(
            ts_ms=fallback_ts,
            side="BUY",
            liquidity="TAKER",
            quantity=quantity,
            reference_price=spot_bar.open,
        ),
        perp_fill=Fill(
            ts_ms=fallback_ts,
            side="SELL",
            liquidity="TAKER",
            quantity=quantity,
            reference_price=perp_bar.open,
        ),
    )


def funding_pnl(
    events: Iterable[FundingEvent],
    *,
    entry_ts_ms: int,
    exit_ts_ms: int,
    short_quantity: Decimal,
) -> Decimal:
    """Return short-perpetual funding for settlements strictly inside the trade."""

    if short_quantity <= ZERO:
        raise ValueError("short quantity must be positive")
    if exit_ts_ms <= entry_ts_ms:
        raise ValueError("exit must follow entry")
    return sum(
        (
            short_quantity * event.mark_price * event.rate
            for event in events
            if entry_ts_ms < event.ts_ms < exit_ts_ms
        ),
        ZERO,
    )


def reconcile_costs(
    *,
    gross_basis_usd: Decimal,
    funding_usd: Decimal,
    spot_fees_usd: Decimal,
    futures_fees_usd: Decimal,
    spread_usd: Decimal,
    slippage_usd: Decimal,
    rounding_usd: Decimal,
    latency_usd: Decimal = ZERO,
) -> CostBreakdown:
    """Reconcile every named component exactly; hidden netting is forbidden."""

    expenses = (
        spot_fees_usd,
        futures_fees_usd,
        spread_usd,
        slippage_usd,
        rounding_usd,
        latency_usd,
    )
    if any(not value.is_finite() or value < ZERO for value in expenses):
        raise ValueError("cost components must be finite and non-negative")
    if not gross_basis_usd.is_finite() or not funding_usd.is_finite():
        raise ValueError("gross PnL components must be finite")
    net = gross_basis_usd + funding_usd - sum(expenses, ZERO)
    return CostBreakdown(
        gross_basis_usd=gross_basis_usd,
        funding_usd=funding_usd,
        spot_fees_usd=spot_fees_usd,
        futures_fees_usd=futures_fees_usd,
        spread_usd=spread_usd,
        slippage_usd=slippage_usd,
        rounding_usd=rounding_usd,
        latency_usd=latency_usd,
        net_usd=net,
    )


def scenario_costs(
    *,
    pair_notional_usd: Decimal,
    scenario: CostScenario,
) -> CostBreakdown:
    """Round-trip costs for two Spot and two futures taker fills."""

    if pair_notional_usd <= ZERO:
        raise ValueError("pair notional must be positive")
    spot_fees = pair_notional_usd * Decimal(2) * scenario.spot_taker_fee_bps / BPS
    futures_fees = pair_notional_usd * Decimal(2) * scenario.futures_taker_fee_bps / BPS
    spread = pair_notional_usd * Decimal(4) * scenario.spread_bps_per_fill / BPS
    slippage = pair_notional_usd * Decimal(4) * scenario.slippage_bps_per_fill / BPS
    latency = pair_notional_usd * Decimal(4) * scenario.latency_bps_per_fill / BPS
    return reconcile_costs(
        gross_basis_usd=ZERO,
        funding_usd=ZERO,
        spot_fees_usd=spot_fees,
        futures_fees_usd=futures_fees,
        spread_usd=spread,
        slippage_usd=slippage,
        rounding_usd=ZERO,
        latency_usd=latency,
    )


def quantize_quantity(
    *,
    target_notional_usd: Decimal,
    reference_price: Decimal,
    quantity_step: Decimal,
) -> Decimal:
    """Round quantity down to the declared common Spot/futures step."""

    if target_notional_usd <= ZERO:
        raise ValueError("target notional must be positive")
    if reference_price <= ZERO:
        raise ValueError("reference price must be positive")
    if quantity_step <= ZERO:
        raise ValueError("quantity step must be positive")
    steps = (target_notional_usd / reference_price / quantity_step).to_integral_value(
        rounding=ROUND_DOWN
    )
    quantity = steps * quantity_step
    if quantity <= ZERO:
        raise ValueError("quantized quantity is zero")
    return quantity


def volume_proxy_capacity(
    *,
    spot_previous_day_quote_usd: Decimal,
    spot_trailing7_median_quote_usd: Decimal,
    futures_previous_day_quote_usd: Decimal,
    futures_trailing7_median_quote_usd: Decimal,
    participation_bps: Decimal,
) -> Decimal:
    """Conservative causal volume-proxy capacity using the weakest input leg."""

    inputs = (
        spot_previous_day_quote_usd,
        spot_trailing7_median_quote_usd,
        futures_previous_day_quote_usd,
        futures_trailing7_median_quote_usd,
        participation_bps,
    )
    if any(not value.is_finite() or value <= ZERO for value in inputs):
        raise ValueError("capacity inputs must be finite and positive")
    weakest = min(inputs[:4])
    return weakest * participation_bps / BPS


def max_drawdown(equity_path: Sequence[Decimal]) -> Drawdown:
    """Maximum peak-to-subsequent-trough loss over the full supplied path."""

    if not equity_path:
        raise ValueError("equity path must be non-empty")
    if any(not value.is_finite() for value in equity_path):
        raise ValueError("equity path values must be finite")
    peak = equity_path[0]
    worst_peak = peak
    worst_trough = peak
    maximum = ZERO
    for value in equity_path:
        if value > peak:
            peak = value
        loss = peak - value
        if loss > maximum:
            maximum = loss
            worst_peak = peak
            worst_trough = value
    drawdown_bps = ZERO if worst_peak <= ZERO else maximum / worst_peak * BPS
    return Drawdown(
        max_drawdown_usd=maximum,
        max_drawdown_bps=drawdown_bps,
        peak_usd=worst_peak,
        trough_usd=worst_trough,
    )


def holm_adjusted_pvalues(p_values: Mapping[str, Decimal]) -> dict[str, Decimal]:
    """Exact Holm step-down adjusted p-values, keyed in lexical trial order."""

    if not p_values:
        raise ValueError("p-values must be non-empty")
    for trial_id, value in p_values.items():
        if not trial_id or not value.is_finite() or value < ZERO or value > ONE:
            raise ValueError("p-values and trial identities must be valid")
    ordered = sorted(p_values.items(), key=lambda item: (item[1], item[0]))
    total = len(ordered)
    running = ZERO
    adjusted: dict[str, Decimal] = {}
    for index, (trial_id, value) in enumerate(ordered):
        candidate = min(ONE, value * Decimal(total - index))
        running = max(running, candidate)
        adjusted[trial_id] = running
    return {trial_id: adjusted[trial_id] for trial_id in sorted(adjusted)}


def cscv_pbo_result(block_scores: Sequence[Sequence[Decimal]]) -> CscvPboResult:
    """Exact CSCV counts with deterministic lowest-id tie-breaking."""

    if len(block_scores) < 2:
        raise ValueError("PBO requires at least two trials")
    block_count = len(block_scores[0])
    if block_count < 4 or block_count > 16 or block_count % 2:
        raise ValueError("PBO requires an even block count in [4, 16]")
    if any(len(row) != block_count for row in block_scores):
        raise ValueError("PBO trials must share synchronous blocks")
    if any(not value.is_finite() for row in block_scores for value in row):
        raise ValueError("PBO scores must be finite")
    half = block_count // 2
    split_count = 0
    underperform_count = 0
    for in_sample in combinations(range(block_count), half):
        split_count += 1
        selected_set = set(in_sample)
        out_sample = tuple(index for index in range(block_count) if index not in selected_set)
        in_means = tuple(
            sum((row[index] for index in in_sample), ZERO) / Decimal(half) for row in block_scores
        )
        champion = max(range(len(block_scores)), key=lambda index: (in_means[index], -index))
        out_means = tuple(
            sum((row[index] for index in out_sample), ZERO) / Decimal(half) for row in block_scores
        )
        ordered = sorted(out_means)
        trial_count = len(ordered)
        if trial_count % 2:
            median = ordered[trial_count // 2]
        else:
            median = (ordered[trial_count // 2 - 1] + ordered[trial_count // 2]) / Decimal(2)
        if out_means[champion] <= median:
            underperform_count += 1
    return CscvPboResult(
        underperform_count=underperform_count,
        split_count=split_count,
    )


def cscv_pbo(block_scores: Sequence[Sequence[Decimal]]) -> Decimal:
    """Backward-compatible exact CSCV PBO ratio."""

    return cscv_pbo_result(block_scores).value


class _HashRandom:
    """Small version-stable deterministic stream; not used for security."""

    def __init__(self, seed: int) -> None:
        if isinstance(seed, bool) or not isinstance(seed, int) or seed < 0:
            raise ValueError("seed must be a non-negative integer")
        self._seed = seed.to_bytes(max(1, (seed.bit_length() + 7) // 8), "big")
        self._counter = 0

    def next_u64(self) -> int:
        payload = self._seed + self._counter.to_bytes(16, "big")
        self._counter += 1
        return int.from_bytes(hashlib.sha256(payload).digest()[:8], "big")


def _empirical_quantile(sorted_values: Sequence[Decimal], probability: Decimal) -> Decimal:
    count = len(sorted_values)
    rank = (probability * Decimal(count)).to_integral_value(rounding="ROUND_CEILING")
    index = max(0, min(count - 1, int(rank) - 1))
    return sorted_values[index]


def stationary_bootstrap_interval(
    values: Sequence[Decimal],
    *,
    replicates: int,
    expected_block_length: int,
    seed: int,
    alpha: Decimal,
) -> BootstrapInterval:
    """Stationary circular bootstrap interval over aggregate USD, not a mean."""

    if len(values) < 4:
        raise ValueError("bootstrap requires at least four values")
    if any(not value.is_finite() for value in values):
        raise ValueError("bootstrap values must be finite")
    if replicates < 8 or replicates > 100_000:
        raise ValueError("bootstrap replicate count is invalid")
    if expected_block_length < 1 or expected_block_length > len(values):
        raise ValueError("bootstrap block length is invalid")
    if not alpha.is_finite() or alpha <= ZERO or alpha >= ONE:
        raise ValueError("bootstrap alpha must be in (0, 1)")
    rng = _HashRandom(seed)
    count = len(values)
    restart_threshold = (2**64) // expected_block_length
    samples: list[Decimal] = []
    for _ in range(replicates):
        index = rng.next_u64() % count
        total = ZERO
        for draw_index in range(count):
            if draw_index > 0:
                if rng.next_u64() < restart_threshold:
                    index = rng.next_u64() % count
                else:
                    index = (index + 1) % count
            total += values[index]
        samples.append(total)
    samples.sort()
    return BootstrapInterval(
        lower=_empirical_quantile(samples, alpha / Decimal(2)),
        point=sum(values, ZERO),
        upper=_empirical_quantile(samples, ONE - alpha / Decimal(2)),
        replicates=replicates,
        alpha=alpha,
    )


def classify_verdict(
    *,
    economic_pass: bool,
    actual_fee_state: str,
    maker_entry_state: str,
    evidence_class: str,
    holdout_state: str,
) -> Literal["GO", "NO_GO", "UNMEASURED"]:
    """Map evidence to the owner gate without upgrading public proxies."""

    if not economic_pass or holdout_state == "FAIL":
        return "NO_GO"
    # This module is a public-only historical lane.  Caller-provided strings may
    # never upgrade its authority, even if a caller supplies syntactic PASS values.
    del actual_fee_state, maker_entry_state, evidence_class
    return "UNMEASURED"


def _canonical_json_bytes(payload: Mapping[str, object]) -> bytes:
    return (
        json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True) + "\n"
    ).encode("ascii")


def consume_holdout_once(marker_path: Path, payload: Mapping[str, object]) -> dict[str, object]:
    """Atomically consume a digest-bound historical validation marker once."""

    if not payload:
        raise ValueError("holdout marker payload must be non-empty")
    encoded = _canonical_json_bytes(payload)
    marker_path.parent.mkdir(parents=True, exist_ok=True)
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    try:
        descriptor = os.open(marker_path, flags, 0o600)
    except FileExistsError as exc:
        raise HoldoutAlreadyConsumedError(f"holdout marker already exists: {marker_path}") from exc
    try:
        with os.fdopen(descriptor, "wb", closefd=True) as stream:
            stream.write(encoded)
            stream.flush()
            os.fsync(stream.fileno())
        directory_descriptor = os.open(marker_path.parent, os.O_RDONLY)
        try:
            os.fsync(directory_descriptor)
        finally:
            os.close(directory_descriptor)
    except BaseException:
        # Marker existence consumes the run even when the post-create write fails.
        raise
    return dict(payload)


@dataclass(frozen=True, slots=True)
class ArchiveSpec:
    """One exact official monthly archive in the predeclared source matrix."""

    source_id: str
    month: str
    url: str
    local_relative_path: str
    expected_member: str
    schema: ArchiveSchema


@dataclass(frozen=True, slots=True)
class MarketData:
    spot_bars: tuple[Bar, ...]
    perp_bars: tuple[Bar, ...]
    mark_bars: tuple[Bar, ...]
    funding_events: tuple[FundingEvent, ...]


def _month_strings(start: str, end: str) -> tuple[str, ...]:
    current = datetime.strptime(start, "%Y-%m").replace(tzinfo=UTC)
    finish = datetime.strptime(end, "%Y-%m").replace(tzinfo=UTC)
    months: list[str] = []
    while current <= finish:
        months.append(current.strftime("%Y-%m"))
        if current.month == 12:
            current = current.replace(year=current.year + 1, month=1)
        else:
            current = current.replace(month=current.month + 1)
    return tuple(months)


def archive_specs(partition: PartitionName) -> tuple[ArchiveSpec, ...]:
    """Return the exact non-overlapping local source matrix for a partition."""

    if partition == "development":
        months = _month_strings("2020-01", "2020-12")
    elif partition == "holdout":
        months = _month_strings("2021-01", "2021-01")
    else:
        raise ValueError("partition must be development or holdout")
    specs: list[ArchiveSpec] = []
    for month in months:
        filename = f"BTCUSDT-1m-{month}.zip"
        member = filename.removesuffix(".zip") + ".csv"
        specs.extend(
            (
                ArchiveSpec(
                    source_id="SPOT_KLINES_1M",
                    month=month,
                    url=(
                        "https://data.binance.vision/data/spot/monthly/klines/"
                        f"BTCUSDT/1m/{filename}"
                    ),
                    local_relative_path=f"{partition}/SPOT_KLINES_1M/{filename}",
                    expected_member=member,
                    schema="KLINE",
                ),
                ArchiveSpec(
                    source_id="USDM_KLINES_1M",
                    month=month,
                    url=(
                        "https://data.binance.vision/data/futures/um/monthly/klines/"
                        f"BTCUSDT/1m/{filename}"
                    ),
                    local_relative_path=f"{partition}/USDM_KLINES_1M/{filename}",
                    expected_member=member,
                    schema="KLINE",
                ),
                ArchiveSpec(
                    source_id="USDM_MARK_PRICE_KLINES_1M",
                    month=month,
                    url=(
                        "https://data.binance.vision/data/futures/um/monthly/"
                        f"markPriceKlines/BTCUSDT/1m/{filename}"
                    ),
                    local_relative_path=f"{partition}/USDM_MARK_PRICE_KLINES_1M/{filename}",
                    expected_member=member,
                    schema="KLINE",
                ),
            )
        )
        funding_filename = f"BTCUSDT-fundingRate-{month}.zip"
        specs.append(
            ArchiveSpec(
                source_id="USDM_FUNDING_RATE",
                month=month,
                url=(
                    "https://data.binance.vision/data/futures/um/monthly/fundingRate/"
                    f"BTCUSDT/{funding_filename}"
                ),
                local_relative_path=f"{partition}/USDM_FUNDING_RATE/{funding_filename}",
                expected_member=funding_filename.removesuffix(".zip") + ".csv",
                schema="FUNDING",
            )
        )
    relative_paths = tuple(spec.local_relative_path for spec in specs)
    if len(relative_paths) != len(set(relative_paths)):
        raise AssertionError("source matrix local paths are not distinct")
    return tuple(specs)


def executable_plan() -> dict[str, object]:
    """Canonical executable predeclaration, safe to inspect before any outcomes."""

    return {
        "accountCapitalUsd": str(ACCOUNT_CAPITAL_USD),
        "accountEffectiveFeeState": "UNKNOWN",
        "authority": "NONE",
        "capacityEvidence": "VOLUME_PROXY_CAPACITY",
        "candidateIds": [candidate.candidate_id for candidate in CANDIDATES],
        "custody": {
            "archiveChecksumPairs": 52,
            "developmentPairs": 48,
            "fetchObjects": 104,
            "holdoutPairs": 4,
        },
        "development": {
            "coldStartCandidateId": CANDIDATES[0].candidate_id,
            "endExclusive": "2020-12-30T00:00:00Z",
            "initialSelectionWeeks": WALK_FORWARD_INITIAL_WEEKS,
            "start": "2020-01-01T00:00:00Z",
            "walkForwardCausalHistoryDays": WALK_FORWARD_HISTORY_DAYS,
            "walkForwardExecution": (
                "ONE_WEEK_FLAT_TO_FLAT_SWITCHED_PORTFOLIO_WITH_BOUNDARY_TAKER_EXIT_"
                "AND_CARRIED_EQUITY_PEAK_TERMINAL_STOP_COOLDOWN"
            ),
            "walkForwardSteps": WALK_FORWARD_STEPS,
            "weeks": DEVELOPMENT_WEEKS,
        },
        "evidenceClass": "HISTORICAL_VALIDATION",
        "holdout": {
            "endExclusive": "2021-01-29T00:00:00Z",
            "minimumActiveWeeks": 3,
            "minimumRoundTrips": 6,
            "start": "2021-01-01T00:00:00Z",
            "uncertaintyDecisionState": "UNMEASURED_ONE_EFFECTIVE_FOUR_WEEK_BLOCK",
            "weeks": HOLDOUT_WEEKS,
        },
        "makerEntryState": "UNKNOWN",
        "historicalDepthState": "UNKNOWN",
        "historicalFilterContinuity": "UNKNOWN",
        "liquidationState": "UNKNOWN",
        "makerExecution": "ALL_NONFILL_THEN_PAIRED_TAKER_FALLBACK",
        "minimumDevelopmentActiveWeeks": 8,
        "minimumDevelopmentRoundTrips": 12,
        "pairNotionalUsd": str(PAIR_NOTIONAL_USD),
        "selection": {
            "candidateEligibilityBeforeRanking": True,
            "pboBlocks": PBO_BLOCKS,
            "pboStartWeek": PBO_START_WEEK,
            "pboSplitCount": math.comb(PBO_BLOCKS, PBO_BLOCKS // 2),
            "pboWeeksPerBlock": PBO_WEEKS_PER_BLOCK,
            "walkForwardEarlyTieRule": ("PRIOR_WEEKS_1_TO_3_SKIP_BOOTSTRAP_THEN_DRAWDOWN_THEN_ID"),
            "walkForwardDiagnosticIsAuthorizationGate": False,
        },
        "primaryCostScenario": _jsonable(asdict(PRIMARY_COSTS)),
        "schema": "S1GExecutablePlanV1",
        "severeCostScenario": _jsonable(asdict(SEVERE_COSTS)),
        "stressCostScenario": _jsonable(asdict(STRESS_COSTS)),
        "symbol": "BTCUSDT",
        "trialCount": len(CANDIDATES),
        "usdAssumption": "1_USDT_EQUALS_1_USD_UNVERIFIED",
    }


def executable_plan_sha256() -> str:
    return hashlib.sha256(_canonical_json_bytes(executable_plan())).hexdigest()


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _load_json_object(path: Path) -> dict[str, object]:
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ProtocolValidationError(f"JSON artifact is unreadable: {path}") from exc
    if not isinstance(parsed, dict):
        raise ProtocolValidationError(f"JSON artifact must be an object: {path}")
    return cast(dict[str, object], parsed)


def verify_frozen_protocol(protocol_path: Path, freeze_path: Path) -> str:
    """Require a digest-bound protocol whose executable plan matches this code."""

    protocol = _load_json_object(protocol_path)
    freeze = _load_json_object(freeze_path)
    if (
        freeze.get("schema") != "cosmos.quant.research.s1g.protocol-freeze.v1"
        or freeze.get("milestone") != "S-1G"
        or freeze.get("createdBeforeOutcomeAccess") is not True
    ):
        raise ProtocolValidationError("freeze identity is invalid")
    protocol_digest = _sha256_file(protocol_path)
    frozen_protocol_digest = freeze.get("protocolSha256")
    if frozen_protocol_digest != protocol_digest:
        raise ProtocolValidationError("freeze does not bind the exact protocol bytes")
    if protocol.get("schema") != "cosmos.quant.research.s1g.protocol.v1":
        raise ProtocolValidationError("unexpected S-1G protocol schema")
    if protocol.get("authority") != "NONE" or protocol.get("evidenceClass") != (
        "HISTORICAL_VALIDATION"
    ):
        raise ProtocolValidationError("protocol attempts to upgrade public-only authority")
    capital = protocol.get("capital")
    candidates = protocol.get("candidates")
    if not isinstance(capital, dict) or capital.get("targetNotionalPerLegUsdEquivalent") != "400":
        raise ProtocolValidationError("protocol capital does not match runner")
    if (
        not isinstance(candidates, dict)
        or candidates.get("trialCount") != 12
        or candidates.get("trailingSettledFundingCounts") != [6, 18]
        or candidates.get("maximumHoldDays") != [1, 3, 7]
        or candidates.get("entryBufferBp") != [0, 5]
    ):
        raise ProtocolValidationError("protocol candidate grid does not match runner")
    if protocol.get("executablePlanSha256") != executable_plan_sha256():
        raise ProtocolValidationError("protocol executable plan digest does not match runner")
    required_sibling_digests = {
        "experimentPySha256": Path(__file__),
        "methodologyMdSha256": HERE / "METHODOLOGY.md",
        "officialSourcesSha256": HERE / "official_sources.v1.json",
        "priorPeriodInventorySha256": HERE / "prior_period_inventory.v1.json",
        "readmeMdSha256": HERE / "README.md",
        "sourcePlanSha256": HERE / "source_plan.v1.json",
        "trialLedgerSha256": HERE / "trial_ledger.v1.json",
        "testExperimentPySha256": HERE / "test_experiment.py",
    }
    for field, path in required_sibling_digests.items():
        if freeze.get(field) != _sha256_file(path):
            raise ProtocolValidationError(f"freeze does not bind exact {field} bytes")
    return protocol_digest


def validate_trial_ledger(trial_ledger_path: Path) -> str:
    """Require the complete predeclared 12-trial ledger in exact candidate order."""

    ledger = _load_json_object(trial_ledger_path)
    trials = ledger.get("trials")
    multiplicity = ledger.get("multiplicity")
    if (
        ledger.get("schema") != "cosmos.quant.research.s1g.trial-ledger.v1"
        or ledger.get("milestone") != "S-1G"
        or ledger.get("createdBeforeOutcomeAccess") is not True
        or ledger.get("family") != "CAUSAL_FUNDED_BASIS_CARRY_LONG_SPOT_SHORT_USDM_PERPETUAL"
        or ledger.get("attemptedTrialCount") != len(CANDIDATES)
        or not isinstance(trials, list)
        or not isinstance(multiplicity, dict)
        or multiplicity.get("familyIncludesEveryListedTrial") is not True
        or multiplicity.get("failedOrZeroTradeTrialsDropped") is not False
        or multiplicity.get("holmFwer") != "0.05"
        or multiplicity.get("cscvPboMaximum") != "0.20"
    ):
        raise ProtocolValidationError("trial ledger schema is invalid")
    expected_trials = tuple(
        {
            "trialId": candidate.candidate_id,
            "L": candidate.lookback_events,
            "HDays": candidate.hold_days,
            "bufferBp": int(candidate.forecast_buffer_bps),
            "status": "PREDECLARED_UNRUN",
        }
        for candidate in CANDIDATES
    )
    if tuple(trials) != expected_trials:
        raise ProtocolValidationError("trial ledger does not match exact candidate family")
    return _sha256_file(trial_ledger_path)


def verify_source_plan(source_plan_path: Path) -> str:
    """Bind the checked-in 52 archive/checksum pairs to the exact matrix."""

    source_plan = _load_json_object(source_plan_path)
    if (
        source_plan.get("schema") != "cosmos.quant.research.s1g.source-plan.v1"
        or source_plan.get("expandedPairCount") != 52
        or source_plan.get("expandedFetchObjectCount") != 104
        or source_plan.get("expandedPairsCanonicalJsonSha256")
        != "9d10060f718a43731f79cd6b9040e5e525bb02bcaa942c2a1525e1be1c5f058d"
    ):
        raise ProtocolValidationError("source plan identity or expanded digest is invalid")
    products = source_plan.get("products")
    partitions = source_plan.get("partitions")
    expected_partitions: list[dict[str, object]] = [
        {
            "id": "development",
            "months": list(_month_strings("2020-01", "2020-12")),
            "expandedPairCount": 48,
            "expandedFetchObjectCount": 96,
            "archiveCount": 48,
            "checksumCount": 48,
            "fixedRoot": "/private/tmp/cosmos-s1g-basis-carry-v1/development",
        },
        {
            "id": "holdout",
            "months": list(_month_strings("2021-01", "2021-01")),
            "expandedPairCount": 4,
            "expandedFetchObjectCount": 8,
            "archiveCount": 4,
            "checksumCount": 4,
            "fixedRoot": "/private/tmp/cosmos-s1g-basis-carry-v1/holdout",
            "state": "UNOPENED",
        },
    ]
    if not isinstance(products, list) or partitions != expected_partitions:
        raise ProtocolValidationError("source plan products are absent")
    product_ids = tuple(item.get("id") for item in products if isinstance(item, dict))
    expected_ids = (
        "SPOT_KLINES_1M",
        "USDM_KLINES_1M",
        "USDM_MARK_PRICE_KLINES_1M",
        "USDM_FUNDING_RATE",
    )
    if product_ids != expected_ids:
        raise ProtocolValidationError("source plan product order differs from runner")
    first_specs = {spec.source_id: spec for spec in archive_specs("development")[:4]}
    expected_product_rows: list[dict[str, str]] = []
    for source_id in expected_ids:
        spec = first_specs[source_id]
        expected_product_rows.append(
            {
                "id": source_id,
                "archiveUrlTemplate": spec.url.replace(spec.month, "{month}"),
                "checksumUrlTemplate": f"{spec.url.replace(spec.month, '{month}')}.CHECKSUM",
                "expectedMemberTemplate": spec.expected_member.replace(
                    spec.month,
                    "{month}",
                ),
                "localArchivePathTemplate": spec.local_relative_path.replace(
                    "development",
                    "{partition}",
                    1,
                ).replace(spec.month, "{month}"),
                "localChecksumPathTemplate": (
                    spec.local_relative_path.replace(
                        "development",
                        "{partition}",
                        1,
                    ).replace(spec.month, "{month}")
                    + ".CHECKSUM"
                ),
                "schema": (
                    "KLINE_12_COLUMNS_UTC_MILLISECONDS"
                    if spec.schema == "KLINE"
                    else "FUNDING_RATE_3_COLUMNS_UTC_MILLISECONDS_OR_YYYY_MM_DD_HH_MM_SS"
                ),
            }
        )
    if products != expected_product_rows:
        raise ProtocolValidationError("source plan templates differ from runner")
    specs = archive_specs("development") + archive_specs("holdout")
    if len(specs) != 52 or {spec.source_id for spec in specs} != set(expected_ids):
        raise ProtocolValidationError("runner source expansion differs from source plan")
    expanded: list[dict[str, str]] = []
    for spec in specs:
        partition = spec.local_relative_path.split("/", 1)[0]
        expanded.append(
            {
                "partition": partition,
                "month": spec.month,
                "product": spec.source_id,
                "archiveUrl": spec.url,
                "checksumUrl": f"{spec.url}.CHECKSUM",
                "expectedMember": spec.expected_member,
                "localArchivePath": spec.local_relative_path,
                "localChecksumPath": f"{spec.local_relative_path}.CHECKSUM",
            }
        )
    expanded_bytes = (json.dumps(expanded, separators=(",", ":"), ensure_ascii=True) + "\n").encode(
        "ascii"
    )
    if hashlib.sha256(expanded_bytes).hexdigest() != source_plan.get(
        "expandedPairsCanonicalJsonSha256"
    ):
        raise ProtocolValidationError("runner expanded source matrix digest differs from plan")
    return _sha256_file(source_plan_path)


def _verify_checksum_only(archive_path: Path, checksum_path: Path) -> str:
    if (
        archive_path.is_symlink()
        or checksum_path.is_symlink()
        or not archive_path.is_file()
        or not checksum_path.is_file()
    ):
        raise ArchiveValidationError("archive/checksum pair is missing")
    if archive_path.stat().st_size > MAX_ARCHIVE_BYTES:
        raise ArchiveValidationError("archive exceeds size limit")
    try:
        lines = checksum_path.read_text(encoding="ascii").splitlines()
    except (OSError, UnicodeError) as exc:
        raise ArchiveValidationError("checksum is unreadable") from exc
    if len(lines) != 1:
        raise ArchiveValidationError("checksum must contain exactly one line")
    fields = lines[0].split()
    if (
        len(fields) != 2
        or not SHA256_RE.fullmatch(fields[0])
        or fields[1].lstrip("*") != archive_path.name
    ):
        raise ArchiveValidationError("checksum line is invalid")
    observed = _sha256_file(archive_path)
    if observed != fields[0]:
        raise ArchiveValidationError("archive checksum mismatch")
    return observed


def _download_atomic(url: str, destination: Path) -> None:
    """Download one allowlisted public object without decoding or overwriting."""

    if not url.startswith("https://data.binance.vision/data/"):
        raise ValueError("only official public archive URLs are allowed")
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.is_symlink():
        raise ArchiveValidationError("download destination may not be a symlink")
    if destination.exists():
        return
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{destination.name}.", suffix=".partial", dir=destination.parent
    )
    os.close(descriptor)
    temporary_path = Path(temporary_name)
    try:
        request = urllib.request.Request(
            url, headers={"User-Agent": "cosmos-s1g-public-research/1"}
        )
        with (
            urllib.request.urlopen(request, timeout=120) as response,
            temporary_path.open("wb") as output,
        ):
            if response.geturl() != url:
                redirected = response.geturl()
                if not redirected.startswith("https://data.binance.vision/data/"):
                    raise ArchiveValidationError("archive redirected outside allowlist")
            copied = 0
            while chunk := response.read(1024 * 1024):
                copied += len(chunk)
                if copied > MAX_ARCHIVE_BYTES:
                    raise ArchiveValidationError("download exceeds size limit")
                output.write(chunk)
            output.flush()
            os.fsync(output.fileno())
        os.link(temporary_path, destination)
    except FileExistsError:
        pass
    finally:
        temporary_path.unlink(missing_ok=True)


def _atomic_write_json(path: Path, payload: Mapping[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    encoded = _canonical_json_bytes(payload)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".partial", dir=path.parent
    )
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb", closefd=True) as stream:
            stream.write(encoded)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _write_json_create_once(path: Path, payload: Mapping[str, object]) -> None:
    """Publish evidence once without replacement and durably sync its directory."""

    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_symlink():
        raise ProtocolValidationError("evidence path may not be a symlink")
    encoded = _canonical_json_bytes(payload)
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    descriptor = os.open(path, flags, 0o600)
    try:
        with os.fdopen(descriptor, "wb", closefd=True) as stream:
            stream.write(encoded)
            stream.flush()
            os.fsync(stream.fileno())
        directory_descriptor = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory_descriptor)
        finally:
            os.close(directory_descriptor)
    except BaseException:
        path.unlink(missing_ok=True)
        raise


def acquire_partition(
    partition: PartitionName,
    *,
    raw_root: Path,
    manifest_path: Path,
) -> dict[str, object]:
    """Acquire and checksum archives without opening any ZIP member."""

    if manifest_path.exists() or manifest_path.is_symlink():
        raise ProtocolValidationError("source manifest already exists")
    rows: list[dict[str, object]] = []
    for spec in archive_specs(partition):
        archive_path = raw_root / spec.local_relative_path
        checksum_path = archive_path.with_name(f"{archive_path.name}.CHECKSUM")
        _download_atomic(f"{spec.url}.CHECKSUM", checksum_path)
        _download_atomic(spec.url, archive_path)
        digest = _verify_checksum_only(archive_path, checksum_path)
        rows.append(
            {
                "archiveSha256": digest,
                "checksumSha256": _sha256_file(checksum_path),
                "expectedMember": spec.expected_member,
                "localRelativePath": spec.local_relative_path,
                "month": spec.month,
                "schema": spec.schema,
                "sourceId": spec.source_id,
                "url": spec.url,
            }
        )
    manifest: dict[str, object] = {
        "archives": rows,
        "decoded": False,
        "partition": partition,
        "schema": "S1GSourceManifestV1",
    }
    _write_json_create_once(manifest_path, manifest)
    return manifest


def validate_source_manifest(
    partition: PartitionName,
    *,
    raw_root: Path,
    manifest_path: Path,
) -> str:
    """Recompute the exact manifest from the frozen raw object set."""

    if manifest_path.is_symlink():
        raise ProtocolValidationError("source manifest may not be a symlink")
    manifest = _load_json_object(manifest_path)
    rows = manifest.get("archives")
    specs = archive_specs(partition)
    if (
        manifest.get("schema") != "S1GSourceManifestV1"
        or manifest.get("partition") != partition
        or manifest.get("decoded") is not False
        or not isinstance(rows, list)
        or len(rows) != len(specs)
    ):
        raise ProtocolValidationError("source manifest identity or row count is invalid")
    expected_files: set[Path] = set()
    recomputed_rows: list[dict[str, object]] = []
    for spec in specs:
        archive_path = raw_root / spec.local_relative_path
        checksum_path = archive_path.with_name(f"{archive_path.name}.CHECKSUM")
        expected_files.update((archive_path.resolve(), checksum_path.resolve()))
        digest = _verify_checksum_only(archive_path, checksum_path)
        recomputed_rows.append(
            {
                "archiveSha256": digest,
                "checksumSha256": _sha256_file(checksum_path),
                "expectedMember": spec.expected_member,
                "localRelativePath": spec.local_relative_path,
                "month": spec.month,
                "schema": spec.schema,
                "sourceId": spec.source_id,
                "url": spec.url,
            }
        )
    partition_root = raw_root / partition
    if not partition_root.is_dir() or partition_root.is_symlink():
        raise ProtocolValidationError("partition root is absent or linked")
    observed_files: set[Path] = set()
    for item in partition_root.rglob("*"):
        if item.is_symlink():
            raise ProtocolValidationError("raw partition contains a symlink")
        if item.is_file():
            observed_files.add(item.resolve())
    if observed_files != expected_files:
        raise ProtocolValidationError("raw partition object set differs from source plan")
    if rows != recomputed_rows:
        raise ProtocolValidationError("source manifest differs from recomputed raw custody")
    return _sha256_file(manifest_path)


def _next_month(month: str) -> str:
    current = datetime.strptime(month, "%Y-%m").replace(tzinfo=UTC)
    if current.month == 12:
        return current.replace(year=current.year + 1, month=1).strftime("%Y-%m")
    return current.replace(month=current.month + 1).strftime("%Y-%m")


def _validate_complete_month(bars: Sequence[Bar], month: str, source_id: str) -> None:
    start = int(datetime.strptime(month, "%Y-%m").replace(tzinfo=UTC).timestamp() * 1000)
    end = int(datetime.strptime(_next_month(month), "%Y-%m").replace(tzinfo=UTC).timestamp() * 1000)
    expected_count = (end - start) // MINUTE_MS
    if len(bars) != expected_count:
        raise ArchiveValidationError(f"{source_id} {month} minute grid is incomplete")
    for index, bar in enumerate(bars):
        if bar.ts_ms != start + index * MINUTE_MS:
            raise ArchiveValidationError(f"{source_id} {month} minute grid has a gap")


def _validate_complete_funding_month(
    rows: Sequence[tuple[str, ...]],
    month: str,
) -> None:
    """Reject out-of-month or boundary-truncated settlement sequences."""

    if len(rows) < 2:
        raise ArchiveValidationError(f"funding {month} has no settlements")
    start = int(datetime.strptime(month, "%Y-%m").replace(tzinfo=UTC).timestamp() * 1000)
    end = int(datetime.strptime(_next_month(month), "%Y-%m").replace(tzinfo=UTC).timestamp() * 1000)
    timestamps = tuple(_parse_timestamp_ms(row[0], field="FUNDING") for row in rows[1:])
    intervals = tuple(_decimal(row[1], field="FUNDING") * Decimal(HOUR_MS) for row in rows[1:])
    if any(timestamp < start or timestamp >= end for timestamp in timestamps):
        raise ArchiveValidationError(f"funding {month} contains an out-of-month settlement")
    if timestamps[0] - start >= int(intervals[0]):
        raise ArchiveValidationError(f"funding {month} leading boundary is incomplete")
    if end - timestamps[-1] > int(intervals[-1]):
        raise ArchiveValidationError(f"funding {month} trailing boundary is incomplete")
    for index in range(1, len(timestamps)):
        if timestamps[index] - timestamps[index - 1] != int(intervals[index]):
            raise ArchiveValidationError(f"funding {month} internal cadence is incomplete")


def _validate_funding_cadence(
    events: Sequence[FundingEvent],
    declared_intervals_hours: Sequence[Decimal],
) -> None:
    """Verify every adjacent settlement, including monthly archive seams."""

    if len(events) != len(declared_intervals_hours):
        raise ArchiveValidationError("funding cadence inputs have different lengths")
    for index in range(1, len(events)):
        elapsed_hours = Decimal(events[index].ts_ms - events[index - 1].ts_ms) / Decimal(HOUR_MS)
        if elapsed_hours != declared_intervals_hours[index]:
            raise ArchiveValidationError("funding cadence conflicts with declared interval")


def load_partition(partition: PartitionName, *, raw_root: Path) -> MarketData:
    """Verify, decode and merge an exact partition after its opening gate."""

    spot: list[Bar] = []
    perp: list[Bar] = []
    mark_by_time: dict[int, Bar] = {}
    funding_rows: list[tuple[str, ...]] = []
    funding_intervals: list[Decimal] = []
    for spec in archive_specs(partition):
        archive_path = raw_root / spec.local_relative_path
        checksum_path = archive_path.with_name(f"{archive_path.name}.CHECKSUM")
        rows = read_verified_archive(
            archive_path,
            checksum_path,
            expected_member=spec.expected_member,
            schema=spec.schema,
        )
        if spec.schema == "KLINE":
            bars = rows_to_bars(rows)
            _validate_complete_month(bars, spec.month, spec.source_id)
            if spec.source_id == "SPOT_KLINES_1M":
                spot.extend(bars)
            elif spec.source_id == "USDM_KLINES_1M":
                perp.extend(bars)
            else:
                for bar in bars:
                    if bar.ts_ms in mark_by_time:
                        raise ArchiveValidationError("duplicate mark-price minute")
                    mark_by_time[bar.ts_ms] = bar
        else:
            _validate_complete_funding_month(rows, spec.month)
            # Keep one header followed by all data records.
            if not funding_rows:
                funding_rows.append(rows[0])
            funding_rows.extend(rows[1:])
            funding_intervals.extend(_decimal(row[1], field="FUNDING") for row in rows[1:])
    if not spot or not perp or not funding_rows:
        raise ArchiveValidationError("partition source family is incomplete")
    if len({bar.ts_ms for bar in spot}) != len(spot):
        raise ArchiveValidationError("duplicate Spot minute across monthly archives")
    if len({bar.ts_ms for bar in perp}) != len(perp):
        raise ArchiveValidationError("duplicate futures minute across monthly archives")
    spot_times = {bar.ts_ms for bar in spot}
    perp_times = {bar.ts_ms for bar in perp}
    if spot_times != perp_times or spot_times != set(mark_by_time):
        raise ArchiveValidationError("Spot, futures, and mark minute grids are not synchronous")
    events = rows_to_funding(tuple(funding_rows), mark_by_time)
    _validate_funding_cadence(events, funding_intervals)
    return MarketData(
        spot_bars=tuple(spot),
        perp_bars=tuple(perp),
        mark_bars=tuple(mark_by_time[timestamp] for timestamp in sorted(mark_by_time)),
        funding_events=events,
    )


def _daily_quote_volume(bars: Sequence[Bar]) -> dict[int, Decimal]:
    totals: dict[int, Decimal] = {}
    for bar in bars:
        day = bar.ts_ms // DAY_MS
        totals[day] = totals.get(day, ZERO) + bar.quote_volume
    return totals


def _median(values: Sequence[Decimal]) -> Decimal:
    ordered = sorted(values)
    if not ordered:
        raise ValueError("median requires values")
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) / Decimal(2)


def _capacity_at(
    timestamp_ms: int,
    spot_daily: Mapping[int, Decimal],
    perp_daily: Mapping[int, Decimal],
) -> Decimal:
    day = timestamp_ms // DAY_MS
    prior_days = tuple(day - offset for offset in range(1, 8))
    if any(item not in spot_daily or item not in perp_daily for item in prior_days):
        raise ValueError("seven complete causal volume days are unavailable")
    return volume_proxy_capacity(
        spot_previous_day_quote_usd=spot_daily[day - 1],
        spot_trailing7_median_quote_usd=_median([spot_daily[item] for item in prior_days]),
        futures_previous_day_quote_usd=perp_daily[day - 1],
        futures_trailing7_median_quote_usd=_median([perp_daily[item] for item in prior_days]),
        participation_bps=Decimal("0.5"),
    )


def _forecast_funding_usd(
    events_through_signal: Sequence[FundingEvent],
    candidate: Candidate,
    *,
    quantity: Decimal,
    mark_price: Decimal,
) -> Decimal | None:
    """Conservative causal forecast: minimum positive trailing rate times inferred events."""

    lookback = candidate.lookback_events
    if len(events_through_signal) < lookback:
        return None
    trailing = events_through_signal[-lookback:]
    if any(event.rate <= ZERO for event in trailing):
        return None
    intervals_ms = tuple(
        Decimal(trailing[index].ts_ms - trailing[index - 1].ts_ms)
        for index in range(1, len(trailing))
    )
    if not intervals_ms or any(interval <= ZERO for interval in intervals_ms):
        return None
    causal_interval_ms = _median(intervals_ms)
    inferred_count = int(
        (Decimal(candidate.hold_days * DAY_MS) / causal_interval_ms).to_integral_value(
            rounding=ROUND_DOWN
        )
    )
    if inferred_count < 1:
        return None
    return quantity * mark_price * min(event.rate for event in trailing) * Decimal(inferred_count)


def _scenario_trade_costs(
    position: Position,
    *,
    spot_exit: Decimal,
    perp_exit: Decimal,
    funding_usd: Decimal,
    scenario: CostScenario,
) -> CostBreakdown:
    quantity = position.quantity
    spot_entry_notional = quantity * position.spot_entry
    spot_exit_notional = quantity * spot_exit
    perp_entry_notional = quantity * position.perp_entry
    perp_exit_notional = quantity * perp_exit
    all_fill_notional = (
        spot_entry_notional + spot_exit_notional + perp_entry_notional + perp_exit_notional
    )
    gross_basis = quantity * (spot_exit - position.spot_entry) + quantity * (
        position.perp_entry - perp_exit
    )
    return reconcile_costs(
        gross_basis_usd=gross_basis,
        funding_usd=funding_usd,
        spot_fees_usd=(
            (spot_entry_notional + spot_exit_notional) * scenario.spot_taker_fee_bps / BPS
        ),
        futures_fees_usd=(
            (perp_entry_notional + perp_exit_notional) * scenario.futures_taker_fee_bps / BPS
        ),
        spread_usd=all_fill_notional * scenario.spread_bps_per_fill / BPS,
        slippage_usd=all_fill_notional * scenario.slippage_bps_per_fill / BPS,
        rounding_usd=ZERO,
        latency_usd=all_fill_notional * scenario.latency_bps_per_fill / BPS,
    )


def _equity_with_reserved_exit_costs(
    *,
    realized_usd: Decimal,
    position: Position | None,
    spot_price: Decimal,
    perp_price: Decimal,
    accrued_funding_usd: Decimal,
    scenario: CostScenario = PRIMARY_COSTS,
) -> Decimal:
    equity = ACCOUNT_CAPITAL_USD + realized_usd
    if position is None:
        return equity
    provisional = _scenario_trade_costs(
        position,
        spot_exit=spot_price,
        perp_exit=perp_price,
        funding_usd=accrued_funding_usd,
        scenario=scenario,
    )
    return equity + provisional.net_usd


def evaluate_candidate(
    candidate: Candidate,
    data: MarketData,
    *,
    start_ms: int,
    end_ms: int,
    expected_weeks: int,
    force_flat_at_end: bool = False,
    initial_realized_usd: Decimal = ZERO,
    initial_running_peak_usd: Decimal | None = None,
    initial_cooldown_until_ms: int | None = None,
    initial_terminal_stop: bool = False,
) -> CandidateEvaluation:
    """Run one candidate and slice conservative PnL into exact UTC weeks.

    ``force_flat_at_end`` is reserved for the diagnostic one-week switched
    portfolio. It permits an entry whose scheduled hold extends past that
    diagnostic week and liquidates it at the week boundary. Development
    candidate selection and holdout scoring retain the stricter full-hold
    boundary rule.
    """

    if end_ms - start_ms != expected_weeks * WEEK_MS:
        raise ValueError("evaluation interval does not equal expected synchronous weeks")
    if not initial_realized_usd.is_finite():
        raise ValueError("initial realized equity must be finite")
    starting_equity = ACCOUNT_CAPITAL_USD + initial_realized_usd
    if starting_equity <= ZERO:
        raise ValueError("initial primary equity must be positive")
    if initial_running_peak_usd is None:
        initial_running_peak_usd = starting_equity
    if not initial_running_peak_usd.is_finite() or initial_running_peak_usd < starting_equity:
        raise ValueError("initial running peak is invalid")
    if initial_cooldown_until_ms is None:
        initial_cooldown_until_ms = start_ms
    if initial_cooldown_until_ms > end_ms + DAY_MS:
        raise ValueError("initial cooldown is outside the supported carry window")
    spot_by_time = {bar.ts_ms: bar for bar in data.spot_bars}
    perp_by_time = {bar.ts_ms: bar for bar in data.perp_bars}
    mark_by_time = {bar.ts_ms: bar for bar in data.mark_bars}
    for timestamp in range(start_ms, end_ms, MINUTE_MS):
        if (
            timestamp not in spot_by_time
            or timestamp not in perp_by_time
            or timestamp not in mark_by_time
        ):
            raise ArchiveValidationError("selected evaluation minute join loss is non-zero")
    funding = tuple(sorted(data.funding_events, key=lambda item: item.ts_ms))
    funding_by_time = {event.ts_ms: event for event in funding}
    spot_daily = _daily_quote_volume(data.spot_bars)
    perp_daily = _daily_quote_volume(data.perp_bars)

    weekly_primary = [ZERO for _ in range(expected_weeks)]
    weekly_stress = [ZERO for _ in range(expected_weeks)]
    weekly_severe = [ZERO for _ in range(expected_weeks)]
    active_weeks: set[int] = set()
    trades: list[Trade] = []
    paired_maker_attempt_count = 0
    realized = initial_realized_usd
    realized_stress = ZERO
    realized_severe = ZERO
    position: Position | None = None
    accrued_funding = ZERO
    pending_exit: str | None = None
    pending_exit_at_ms: int | None = None
    cooldown_until = max(start_ms, initial_cooldown_until_ms)
    terminal_stop = initial_terminal_stop
    running_peak = initial_running_peak_usd
    maximum_drawdown = running_peak - starting_equity
    drawdown_peak = running_peak
    drawdown_trough = starting_equity
    stress_running_peak = ACCOUNT_CAPITAL_USD
    stress_maximum_drawdown = ZERO
    stress_drawdown_peak = ACCOUNT_CAPITAL_USD
    stress_drawdown_trough = ACCOUNT_CAPITAL_USD
    prior_week_equity = starting_equity
    prior_week_stress_equity = ACCOUNT_CAPITAL_USD
    prior_week_severe_equity = ACCOUNT_CAPITAL_USD
    event_history: list[FundingEvent] = [event for event in funding if event.ts_ms < start_ms]

    def observe_equity(
        spot_price: Decimal,
        perp_price: Decimal,
    ) -> tuple[Decimal, Decimal, Decimal, Decimal]:
        nonlocal running_peak, maximum_drawdown, drawdown_peak, drawdown_trough
        nonlocal stress_running_peak, stress_maximum_drawdown
        nonlocal stress_drawdown_peak, stress_drawdown_trough
        equity = _equity_with_reserved_exit_costs(
            realized_usd=realized,
            position=position,
            spot_price=spot_price,
            perp_price=perp_price,
            accrued_funding_usd=accrued_funding,
        )
        if equity > running_peak:
            running_peak = equity
        loss = running_peak - equity
        if loss > maximum_drawdown:
            maximum_drawdown = loss
            drawdown_peak = running_peak
            drawdown_trough = equity
        stress_equity = _equity_with_reserved_exit_costs(
            realized_usd=realized_stress,
            position=position,
            spot_price=spot_price,
            perp_price=perp_price,
            accrued_funding_usd=accrued_funding,
            scenario=STRESS_COSTS,
        )
        if stress_equity > stress_running_peak:
            stress_running_peak = stress_equity
        stress_loss = stress_running_peak - stress_equity
        if stress_loss > stress_maximum_drawdown:
            stress_maximum_drawdown = stress_loss
            stress_drawdown_peak = stress_running_peak
            stress_drawdown_trough = stress_equity
        severe_equity = _equity_with_reserved_exit_costs(
            realized_usd=realized_severe,
            position=position,
            spot_price=spot_price,
            perp_price=perp_price,
            accrued_funding_usd=accrued_funding,
            scenario=SEVERE_COSTS,
        )
        return equity, stress_equity, severe_equity, loss

    def close_position(
        timestamp: int,
        spot_price: Decimal,
        perp_price: Decimal,
        reason: str,
    ) -> None:
        nonlocal position, accrued_funding, realized, realized_stress, realized_severe
        nonlocal cooldown_until
        if position is None:
            raise AssertionError("cannot close an absent position")
        primary = _scenario_trade_costs(
            position,
            spot_exit=spot_price,
            perp_exit=perp_price,
            funding_usd=accrued_funding,
            scenario=PRIMARY_COSTS,
        )
        stress = _scenario_trade_costs(
            position,
            spot_exit=spot_price,
            perp_exit=perp_price,
            funding_usd=accrued_funding,
            scenario=STRESS_COSTS,
        )
        severe = _scenario_trade_costs(
            position,
            spot_exit=spot_price,
            perp_exit=perp_price,
            funding_usd=accrued_funding,
            scenario=SEVERE_COSTS,
        )
        try:
            exit_capacity_leg = _capacity_at(timestamp, spot_daily, perp_daily)
            exit_stress_capacity_leg = exit_capacity_leg / Decimal(2)
        except ValueError:
            exit_capacity_leg = ZERO
            exit_stress_capacity_leg = ZERO
        exit_leg_notional = position.quantity * max(spot_price, perp_price)
        account_capacity = min(
            position.entry_capacity_usd,
            (
                ZERO
                if exit_leg_notional <= ZERO
                else exit_capacity_leg * ACCOUNT_CAPITAL_USD / exit_leg_notional
            ),
        )
        stress_account_capacity = min(
            position.entry_stress_capacity_usd,
            (
                ZERO
                if exit_leg_notional <= ZERO
                else exit_stress_capacity_leg * ACCOUNT_CAPITAL_USD / exit_leg_notional
            ),
        )
        trades.append(
            Trade(
                candidate_id=candidate.candidate_id,
                entry_ts_ms=position.entry_ts_ms,
                exit_ts_ms=timestamp,
                exit_reason=reason,
                quantity=position.quantity,
                capacity_usd=account_capacity,
                stress_capacity_usd=stress_account_capacity,
                primary=primary,
                stress=stress,
                severe=severe,
            )
        )
        realized += primary.net_usd
        realized_stress += stress.net_usd
        realized_severe += severe.net_usd
        position = None
        accrued_funding = ZERO
        cooldown_until = timestamp + DAY_MS

    for timestamp in range(start_ms, end_ms, MINUTE_MS):
        spot_bar = spot_by_time[timestamp]
        perp_bar = perp_by_time[timestamp]
        week_index = (timestamp - start_ms) // WEEK_MS
        if (
            pending_exit is not None
            and pending_exit_at_ms is not None
            and timestamp >= pending_exit_at_ms
            and position is not None
        ):
            close_position(timestamp, spot_bar.open, perp_bar.open, pending_exit)
            pending_exit = None
            pending_exit_at_ms = None
        if position is not None:
            active_weeks.add(week_index)

        nonpositive_funding_trigger = False
        event = funding_by_time.get(timestamp)
        if event is not None:
            event_history.append(event)
            if position is not None and position.entry_ts_ms < timestamp:
                accrued_funding += position.quantity * event.mark_price * event.rate
                if event.rate <= ZERO:
                    nonpositive_funding_trigger = True

        equity, stress_equity, severe_equity, loss = observe_equity(
            spot_bar.close,
            mark_by_time[timestamp].close,
        )

        if loss >= Decimal("100"):
            terminal_stop = True
            if position is not None and pending_exit is None:
                pending_exit = "TERMINAL_DRAWDOWN_10_PERCENT"
                pending_exit_at_ms = timestamp + MINUTE_MS
        elif position is not None and pending_exit is None:
            current_basis = perp_bar.close / spot_bar.close - ONE
            if current_basis - position.entry_basis_ratio >= Decimal("0.01"):
                pending_exit = "BASIS_WIDENED_100BP"
                pending_exit_at_ms = timestamp + MINUTE_MS
            elif nonpositive_funding_trigger:
                pending_exit = "NONPOSITIVE_FUNDING_SETTLEMENT"
                pending_exit_at_ms = timestamp + MINUTE_MS
            elif current_basis <= ZERO:
                pending_exit = "BASIS_NONPOSITIVE_CONVERGENCE"
                pending_exit_at_ms = timestamp + MINUTE_MS
            elif timestamp + MINUTE_MS >= position.scheduled_exit_ts_ms:
                pending_exit = "MAX_HOLD"
                pending_exit_at_ms = timestamp + MINUTE_MS

        if timestamp == end_ms - MINUTE_MS and position is not None:
            boundary_reason = (
                pending_exit
                if pending_exit is not None
                and pending_exit_at_ms is not None
                and pending_exit_at_ms <= end_ms
                else "PARTITION_END"
            )
            close_position(end_ms, spot_bar.close, perp_bar.close, boundary_reason)
            pending_exit = None
            pending_exit_at_ms = None
            equity, stress_equity, severe_equity, boundary_loss = observe_equity(
                spot_bar.close,
                perp_bar.close,
            )
            if boundary_loss >= Decimal("100"):
                terminal_stop = True

        if (timestamp + MINUTE_MS - start_ms) % WEEK_MS == 0:
            score_index = (timestamp + MINUTE_MS - start_ms) // WEEK_MS - 1
            weekly_primary[score_index] = equity - prior_week_equity
            weekly_stress[score_index] = stress_equity - prior_week_stress_equity
            weekly_severe[score_index] = severe_equity - prior_week_severe_equity
            prior_week_equity = equity
            prior_week_stress_equity = stress_equity
            prior_week_severe_equity = severe_equity

        if (
            position is None
            and event is not None
            and not terminal_stop
            and timestamp >= cooldown_until
            and timestamp + MAKER_TIMEOUT_MS < end_ms
            and (
                force_flat_at_end
                or timestamp + MAKER_TIMEOUT_MS + candidate.hold_days * DAY_MS <= end_ms
            )
        ):
            reference_timestamp = timestamp - MINUTE_MS
            reference_spot = spot_by_time.get(reference_timestamp)
            reference_perp = perp_by_time.get(reference_timestamp)
            if reference_spot is None or reference_perp is None:
                continue
            reference_quantity = quantize_quantity(
                target_notional_usd=PAIR_NOTIONAL_USD,
                reference_price=max(reference_spot.close, reference_perp.close),
                quantity_step=QUANTITY_STEP_BTC,
            )
            forecast = _forecast_funding_usd(
                event_history,
                candidate,
                quantity=reference_quantity,
                mark_price=event.mark_price,
            )
            if forecast is None:
                continue
            signal_basis = reference_perp.close / reference_spot.close - ONE
            reference_leg_notional = reference_quantity * max(
                reference_spot.close, reference_perp.close
            )
            primary_roundtrip_cost = -scenario_costs(
                pair_notional_usd=reference_leg_notional,
                scenario=PRIMARY_COSTS,
            ).net_usd
            threshold = (
                primary_roundtrip_cost
                + reference_quantity * reference_spot.close * candidate.forecast_buffer_bps / BPS
            )
            if (
                signal_basis <= ZERO
                or reference_quantity * (reference_perp.close - reference_spot.close) + forecast
                < threshold
            ):
                continue
            paired_maker_attempt_count += 1
            fallback_timestamp = timestamp + MAKER_TIMEOUT_MS
            try:
                capacity_leg = _capacity_at(fallback_timestamp, spot_daily, perp_daily)
            except ValueError:
                continue
            stress_capacity_leg = capacity_leg / Decimal(2)
            quantity = quantize_quantity(
                target_notional_usd=PAIR_NOTIONAL_USD,
                reference_price=max(
                    spot_by_time[fallback_timestamp].open,
                    perp_by_time[fallback_timestamp].open,
                ),
                quantity_step=QUANTITY_STEP_BTC,
            )
            try:
                execution = execute_entry(
                    signal_ts_ms=timestamp,
                    spot_bars=(spot_bar, spot_by_time[timestamp + MAKER_TIMEOUT_MS]),
                    perp_bars=(perp_bar, perp_by_time[timestamp + MAKER_TIMEOUT_MS]),
                    quantity=quantity,
                    maker_timeout_ms=MAKER_TIMEOUT_MS,
                )
            except ValueError:
                continue
            fallback_basis = (
                execution.perp_fill.reference_price / execution.spot_fill.reference_price - ONE
            )
            entry_leg_notional = quantity * max(
                execution.spot_fill.reference_price,
                execution.perp_fill.reference_price,
            )
            if capacity_leg < entry_leg_notional or stress_capacity_leg < entry_leg_notional:
                continue
            fallback_forecast = _forecast_funding_usd(
                event_history,
                candidate,
                quantity=quantity,
                mark_price=event.mark_price,
            )
            if fallback_forecast is None:
                continue
            fallback_threshold = (
                -scenario_costs(
                    pair_notional_usd=entry_leg_notional,
                    scenario=PRIMARY_COSTS,
                ).net_usd
                + quantity
                * execution.spot_fill.reference_price
                * candidate.forecast_buffer_bps
                / BPS
            )
            if (
                fallback_basis <= ZERO
                or quantity
                * (execution.perp_fill.reference_price - execution.spot_fill.reference_price)
                + fallback_forecast
                < fallback_threshold
            ):
                continue
            position = Position(
                candidate_id=candidate.candidate_id,
                entry_ts_ms=execution.spot_fill.ts_ms,
                spot_entry=execution.spot_fill.reference_price,
                perp_entry=execution.perp_fill.reference_price,
                quantity=quantity,
                entry_basis_ratio=fallback_basis,
                scheduled_exit_ts_ms=execution.spot_fill.ts_ms + candidate.hold_days * DAY_MS,
                entry_capacity_usd=capacity_leg * ACCOUNT_CAPITAL_USD / entry_leg_notional,
                entry_stress_capacity_usd=(
                    stress_capacity_leg * ACCOUNT_CAPITAL_USD / entry_leg_notional
                ),
            )
            accrued_funding = ZERO
            fallback_week_index = (execution.spot_fill.ts_ms - start_ms) // WEEK_MS
            if fallback_week_index < 0 or fallback_week_index >= expected_weeks:
                raise AssertionError("fallback fill is outside the scored weeks")
            active_weeks.add(fallback_week_index)
            _, _, _, entry_loss = observe_equity(
                execution.spot_fill.reference_price,
                execution.perp_fill.reference_price,
            )
            if entry_loss >= Decimal("100"):
                pending_exit = "TERMINAL_DRAWDOWN_10_PERCENT"
                pending_exit_at_ms = execution.spot_fill.ts_ms + MINUTE_MS
                terminal_stop = True
    drawdown_bps = ZERO if drawdown_peak <= ZERO else maximum_drawdown / drawdown_peak * BPS
    stress_drawdown_bps = (
        ZERO
        if stress_drawdown_peak <= ZERO
        else stress_maximum_drawdown / stress_drawdown_peak * BPS
    )
    capacities = tuple(trade.capacity_usd for trade in trades)
    stress_capacities = tuple(trade.stress_capacity_usd for trade in trades)
    return CandidateEvaluation(
        candidate=candidate,
        weekly_primary_usd=tuple(weekly_primary),
        weekly_stress_usd=tuple(weekly_stress),
        weekly_severe_usd=tuple(weekly_severe),
        trades=tuple(trades),
        drawdown=Drawdown(
            max_drawdown_usd=maximum_drawdown,
            max_drawdown_bps=drawdown_bps,
            peak_usd=drawdown_peak,
            trough_usd=drawdown_trough,
        ),
        stress_drawdown=Drawdown(
            max_drawdown_usd=stress_maximum_drawdown,
            max_drawdown_bps=stress_drawdown_bps,
            peak_usd=stress_drawdown_peak,
            trough_usd=stress_drawdown_trough,
        ),
        active_week_count=len(active_weeks),
        paired_maker_attempt_count=paired_maker_attempt_count,
        ending_primary_equity_usd=ACCOUNT_CAPITAL_USD + realized,
        ending_running_peak_usd=running_peak,
        ending_cooldown_until_ms=cooldown_until,
        terminal_stop=terminal_stop,
        minimum_capacity_usd=min(capacities) if capacities else ZERO,
        minimum_stress_capacity_usd=min(stress_capacities) if stress_capacities else ZERO,
    )


def _centered_bootstrap_pvalue(
    values: Sequence[Decimal],
    *,
    replicates: int,
    expected_block_length: int,
    seed: int,
) -> Decimal:
    if len(values) < 4:
        return ONE
    observed = sum(values, ZERO)
    mean = observed / Decimal(len(values))
    centered = tuple(value - mean for value in values)
    rng = _HashRandom(seed)
    count = len(centered)
    restart_threshold = (2**64) // expected_block_length
    exceed = 0
    for _ in range(replicates):
        index = rng.next_u64() % count
        total = ZERO
        for draw_index in range(count):
            if draw_index:
                if rng.next_u64() < restart_threshold:
                    index = rng.next_u64() % count
                else:
                    index = (index + 1) % count
            total += centered[index]
        if total >= observed:
            exceed += 1
    return Decimal(exceed + 1) / Decimal(replicates + 1)


def _jsonable(value: object) -> object:
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, dict):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(item) for item in value]
    return value


def _evaluation_mapping(evaluation: CandidateEvaluation) -> dict[str, object]:
    interval = stationary_bootstrap_interval(
        evaluation.weekly_primary_usd,
        replicates=9999,
        expected_block_length=4,
        seed=9999,
        alpha=Decimal("0.05"),
    )
    return {
        "activeWeekCount": evaluation.active_week_count,
        "candidate": _jsonable(asdict(evaluation.candidate)),
        "candidateId": evaluation.candidate.candidate_id,
        "drawdownPrimary": _jsonable(asdict(evaluation.drawdown)),
        "drawdownStress": _jsonable(asdict(evaluation.stress_drawdown)),
        "endingCooldownUntilMs": evaluation.ending_cooldown_until_ms,
        "endingPrimaryEquityUsd": str(evaluation.ending_primary_equity_usd),
        "endingRunningPeakUsd": str(evaluation.ending_running_peak_usd),
        "intervalUsdPer1000": _jsonable(asdict(interval)),
        "minimumCapacityUsd": str(evaluation.minimum_capacity_usd),
        "minimumStressCapacityUsd": str(evaluation.minimum_stress_capacity_usd),
        "primaryNetUsdPer1000": str(evaluation.primary_net_usd),
        "roundTripCount": len(evaluation.trades),
        "severeNetUsdPer1000": str(evaluation.severe_net_usd),
        "stressNetUsdPer1000": str(evaluation.stress_net_usd),
        "terminalStop": evaluation.terminal_stop,
        "weeklyPrimaryUsd": [str(value) for value in evaluation.weekly_primary_usd],
        "weeklySevereUsd": [str(value) for value in evaluation.weekly_severe_usd],
        "weeklyStressUsd": [str(value) for value in evaluation.weekly_stress_usd],
        "costDecompositionPrimary": _aggregate_costs(
            tuple(trade.primary for trade in evaluation.trades)
        ),
        "costDecompositionStress": _aggregate_costs(
            tuple(trade.stress for trade in evaluation.trades)
        ),
        "costDecompositionSevere": _aggregate_costs(
            tuple(trade.severe for trade in evaluation.trades)
        ),
        "modeledExecution": {
            "makerAttempts": 2 * evaluation.paired_maker_attempt_count,
            "makerFills": 0,
            "pairedMakerAttempts": evaluation.paired_maker_attempt_count,
            "pairedTakerFallbackEntries": len(evaluation.trades),
            "pairedFallbackSkips": (evaluation.paired_maker_attempt_count - len(evaluation.trades)),
            "takerExitCount": len(evaluation.trades),
        },
    }


def _aggregate_costs(costs: Sequence[CostBreakdown]) -> dict[str, str]:
    fields = (
        "gross_basis_usd",
        "funding_usd",
        "spot_fees_usd",
        "futures_fees_usd",
        "spread_usd",
        "slippage_usd",
        "latency_usd",
        "rounding_usd",
        "net_usd",
    )
    return {
        field: str(sum((cast(Decimal, getattr(item, field)) for item in costs), ZERO))
        for field in fields
    }


def _candidate_by_id(candidate_id: str) -> Candidate:
    for candidate in CANDIDATES:
        if candidate.candidate_id == candidate_id:
            return candidate
    raise ValueError("selected candidate is outside the frozen ledger")


def _weekly_close_drawdown_usd(values: Sequence[Decimal]) -> Decimal:
    equity = ACCOUNT_CAPITAL_USD
    peak = equity
    maximum = ZERO
    for value in values:
        equity += value
        peak = max(peak, equity)
        maximum = max(maximum, peak - equity)
    return maximum


def _walk_forward_rank(
    weekly_scores: Mapping[str, Sequence[Decimal]],
    *,
    prior_weeks: int,
) -> tuple[str, ...]:
    """Apply the frozen mean/lower-bound/drawdown/id rule to prior weeks only."""

    if prior_weeks <= 0:
        raise ValueError("walk-forward ranking requires prior weeks")
    expected_ids = tuple(candidate.candidate_id for candidate in CANDIDATES)
    if tuple(weekly_scores) != expected_ids:
        raise ValueError("walk-forward score family differs from frozen candidates")
    means: dict[Decimal, list[str]] = {}
    for candidate_id, all_values in weekly_scores.items():
        if prior_weeks > len(all_values) or len(all_values) > DEVELOPMENT_WEEKS:
            raise ValueError("walk-forward scores have the wrong horizon")
        values = all_values[:prior_weeks]
        mean = sum(values, ZERO) / Decimal(prior_weeks)
        means.setdefault(mean, []).append(candidate_id)
    ordered: list[str] = []
    for mean in sorted(means, reverse=True):
        tied = means[mean]
        if len(tied) == 1:
            ordered.extend(tied)
            continue
        # A four-week bootstrap is undefined for weeks 2-4 of the diagnostic.
        # Those exact early ties therefore use drawdown and ID only.
        lower_bounds = (
            {
                candidate_id: stationary_bootstrap_interval(
                    weekly_scores[candidate_id][:prior_weeks],
                    replicates=9999,
                    expected_block_length=4,
                    seed=9999,
                    alpha=Decimal("0.05"),
                ).lower
                for candidate_id in tied
            }
            if prior_weeks >= 4
            else dict.fromkeys(tied, ZERO)
        )
        ordered.extend(
            sorted(
                tied,
                key=lambda candidate_id: (
                    -lower_bounds[candidate_id],
                    _weekly_close_drawdown_usd(weekly_scores[candidate_id][:prior_weeks]),
                    candidate_id,
                ),
            )
        )
    return tuple(ordered)


def _walk_forward_diagnostic(
    data: MarketData,
) -> tuple[
    dict[str, tuple[Decimal, ...]],
    tuple[str, ...],
    tuple[Decimal, ...],
    Decimal,
]:
    """Run a causal switched portfolio while preserving account state."""

    score_lists: dict[str, list[Decimal]] = {candidate.candidate_id: [] for candidate in CANDIDATES}
    selected_ids: list[str] = []
    selected_values: list[Decimal] = []
    realized_usd = ZERO
    running_peak_usd = ACCOUNT_CAPITAL_USD
    cooldown_until_ms = DEVELOPMENT_START_MS
    terminal_stop = False
    maximum_drawdown_usd = ZERO
    for week in range(DEVELOPMENT_WEEKS):
        selected_id = (
            CANDIDATES[0].candidate_id
            if week == 0
            else _walk_forward_rank(score_lists, prior_weeks=week)[0]
        )
        week_start = DEVELOPMENT_START_MS + week * WEEK_MS
        history_start = max(
            DEVELOPMENT_START_MS,
            week_start - WALK_FORWARD_HISTORY_DAYS * DAY_MS,
        )
        week_end = week_start + WEEK_MS
        week_data = MarketData(
            spot_bars=tuple(bar for bar in data.spot_bars if history_start <= bar.ts_ms < week_end),
            perp_bars=tuple(bar for bar in data.perp_bars if history_start <= bar.ts_ms < week_end),
            mark_bars=tuple(bar for bar in data.mark_bars if history_start <= bar.ts_ms < week_end),
            funding_events=tuple(
                event for event in data.funding_events if history_start <= event.ts_ms < week_end
            ),
        )
        weekly_evaluations: dict[str, CandidateEvaluation] = {}
        for candidate in CANDIDATES:
            evaluation = evaluate_candidate(
                candidate,
                week_data,
                start_ms=week_start,
                end_ms=week_end,
                expected_weeks=1,
                force_flat_at_end=True,
                initial_realized_usd=realized_usd,
                initial_running_peak_usd=running_peak_usd,
                initial_cooldown_until_ms=cooldown_until_ms,
                initial_terminal_stop=terminal_stop,
            )
            if len(evaluation.weekly_primary_usd) != 1:
                raise AssertionError("walk-forward week must emit exactly one score")
            weekly_evaluations[candidate.candidate_id] = evaluation
            score_lists[candidate.candidate_id].append(evaluation.primary_net_usd)
        selected = weekly_evaluations[selected_id]
        selected_ids.append(selected_id)
        selected_values.append(selected.primary_net_usd)
        realized_usd += selected.primary_net_usd
        if selected.ending_primary_equity_usd != ACCOUNT_CAPITAL_USD + realized_usd:
            raise AssertionError("walk-forward realized equity does not reconcile")
        running_peak_usd = selected.ending_running_peak_usd
        cooldown_until_ms = selected.ending_cooldown_until_ms
        terminal_stop = selected.terminal_stop
        maximum_drawdown_usd = max(
            maximum_drawdown_usd,
            selected.drawdown.max_drawdown_usd,
        )
    return (
        {candidate_id: tuple(values) for candidate_id, values in score_lists.items()},
        tuple(selected_ids),
        tuple(selected_values),
        maximum_drawdown_usd,
    )


def _selection_evidence_payload(result: Mapping[str, object]) -> dict[str, object]:
    return {
        field: result.get(field)
        for field in (
            "accountEffectiveFeeState",
            "authority",
            "candidateEligibility",
            "developmentGate",
            "evidenceClass",
            "evaluations",
            "gates",
            "holm",
            "makerEntryState",
            "n3EquivalentDecisionState",
            "n3TrialGates",
            "pbo",
            "selectedCandidateId",
            "topMeasuredCandidateId",
            "walkForward",
        )
    }


def _public_truth_fields() -> dict[str, object]:
    """N3-compatible truth shared by every public-only terminal packet."""

    return {
        "accountEffectiveFeeState": "UNKNOWN",
        "authority": "NONE",
        "crediblePositiveCount": None,
        "evidenceClass": "HISTORICAL_VALIDATION",
        "historicalDepthState": "UNKNOWN",
        "historicalFilterContinuity": "UNKNOWN",
        "liquidationState": "UNKNOWN",
        "makerEntryState": "UNKNOWN",
        "modeledMakerEntryState": "MAKER_NONFILL_PUBLIC_QUEUE_UNKNOWN",
        "n3EquivalentDecisionState": "UNKNOWN",
        "ownerVerifiedPositive": False,
        "positiveEdgeClaim": "NOT_MADE",
        "sealedForwardPerformanceState": "UNKNOWN_NOT_SEALED_FORWARD",
        "sourceAuthority": "NONE",
        "usdtUsdParityState": "UNKNOWN_MODELED_1_TO_1",
        "verifiedPositiveCount": None,
    }


def run_development(
    data: MarketData,
    *,
    development_marker_digest: str,
    source_manifest_digest: str,
    protocol_digest: str,
    source_plan_digest: str,
    trial_ledger_digest: str,
) -> dict[str, object]:
    """Evaluate all twelve trials and emit the single predeclared champion seal."""

    if not SHA256_RE.fullmatch(development_marker_digest):
        raise ValueError("development marker digest is invalid")
    evaluations = tuple(
        evaluate_candidate(
            candidate,
            data,
            start_ms=DEVELOPMENT_START_MS,
            end_ms=DEVELOPMENT_END_MS,
            expected_weeks=DEVELOPMENT_WEEKS,
        )
        for candidate in CANDIDATES
    )
    if any(len(item.weekly_primary_usd) != DEVELOPMENT_WEEKS for item in evaluations):
        raise AssertionError("development score slicing is not exactly 12x52")
    intervals = {
        item.candidate.candidate_id: stationary_bootstrap_interval(
            item.weekly_primary_usd,
            replicates=9999,
            expected_block_length=4,
            seed=9999,
            alpha=Decimal("0.05"),
        )
        for item in evaluations
    }
    raw_p_values = {
        item.candidate.candidate_id: _centered_bootstrap_pvalue(
            item.weekly_primary_usd,
            replicates=9999,
            expected_block_length=4,
            seed=9999,
        )
        for item in evaluations
    }
    adjusted_p_values = holm_adjusted_pvalues(raw_p_values)
    pbo_blocks = tuple(
        tuple(
            sum(item.weekly_primary_usd[offset : offset + PBO_WEEKS_PER_BLOCK], ZERO)
            for offset in range(
                PBO_START_WEEK,
                DEVELOPMENT_WEEKS,
                PBO_WEEKS_PER_BLOCK,
            )
        )
        for item in evaluations
    )
    if len(pbo_blocks) != 12 or any(len(row) != PBO_BLOCKS for row in pbo_blocks):
        raise AssertionError("PBO matrix must be exactly 12 trials by 12 blocks")
    pbo_result = cscv_pbo_result(pbo_blocks)
    pbo = pbo_result.value

    ordered_all = sorted(
        evaluations,
        key=lambda item: (
            -(item.primary_net_usd / Decimal(DEVELOPMENT_WEEKS)),
            -intervals[item.candidate.candidate_id].lower,
            item.drawdown.max_drawdown_usd,
            item.candidate.candidate_id,
        ),
    )
    candidate_eligibility: dict[str, dict[str, bool]] = {}
    for item in evaluations:
        candidate_id = item.candidate.candidate_id
        candidate_eligibility[candidate_id] = {
            "capacity": item.minimum_capacity_usd >= ACCOUNT_CAPITAL_USD
            and item.minimum_stress_capacity_usd >= ACCOUNT_CAPITAL_USD,
            "costReconciliation": all(
                costs.net_usd
                == costs.gross_basis_usd
                + costs.funding_usd
                - costs.spot_fees_usd
                - costs.futures_fees_usd
                - costs.spread_usd
                - costs.slippage_usd
                - costs.latency_usd
                - costs.rounding_usd
                for trade in item.trades
                for costs in (trade.primary, trade.stress, trade.severe)
            ),
            "drawdownPrimary": item.drawdown.max_drawdown_usd < Decimal("100"),
            "drawdownStress": item.stress_drawdown.max_drawdown_usd < Decimal("100"),
            "holm": adjusted_p_values[candidate_id] <= Decimal("0.05"),
            "primaryInterval": intervals[candidate_id].lower > ZERO,
            "primaryPoint": item.primary_net_usd > ZERO,
            "sample": len(item.trades) >= 12 and item.active_week_count >= 8,
            "stress": item.stress_net_usd > ZERO,
        }
    eligible = tuple(
        item
        for item in ordered_all
        if all(candidate_eligibility[item.candidate.candidate_id].values())
    )
    champion = eligible[0] if eligible else None
    champion_id = champion.candidate.candidate_id if champion is not None else None
    top_measured = ordered_all[0]
    top_measured_id = top_measured.candidate.candidate_id

    (
        _walk_forward_scores,
        walk_forward_ids,
        walk_forward_values,
        walk_forward_drawdown_usd,
    ) = _walk_forward_diagnostic(data)
    walk_interval = stationary_bootstrap_interval(
        tuple(walk_forward_values),
        replicates=9999,
        expected_block_length=4,
        seed=9999,
        alpha=Decimal("0.05"),
    )
    gates = (
        {
            **candidate_eligibility[champion_id],
            "pbo": pbo <= Decimal("0.20"),
        }
        if champion_id is not None
        else {
            "candidateEligibility": False,
            "pbo": pbo <= Decimal("0.20"),
        }
    )
    development_pass = champion_id is not None and all(gates.values())
    result: dict[str, object] = {
        **_public_truth_fields(),
        "capacityEvidence": "VOLUME_PROXY_CAPACITY",
        "candidateDigest": None,
        "candidateEligibility": candidate_eligibility,
        "candidateSeal": None,
        "developmentGate": "PASS" if development_pass else "FAIL",
        "evaluations": [_evaluation_mapping(item) for item in evaluations],
        "gates": gates,
        "holm": {
            "adjustedPValues": {key: str(value) for key, value in adjusted_p_values.items()},
            "fwer": "0.05",
            "rawPValues": {key: str(value) for key, value in raw_p_values.items()},
        },
        "pbo": {
            "blockCount": PBO_BLOCKS,
            "selectionRule": "HIGHEST_IN_SAMPLE_MEAN_THEN_LEXICOGRAPHIC_ID",
            "splitCount": pbo_result.split_count,
            "underperformCount": pbo_result.underperform_count,
            "value": str(pbo),
            "weeksPerBlock": PBO_WEEKS_PER_BLOCK,
        },
        "n3TrialGates": {
            "dsr": "UNMEASURED_NOT_NATIVE_SELECTION_GATE",
            "globalTest": "UNMEASURED_NOT_IMPLEMENTED",
            "holm": (
                "PASS"
                if champion_id is not None and adjusted_p_values[champion_id] <= Decimal("0.05")
                else "FAIL"
            ),
            "pbo": "PASS" if pbo <= Decimal("0.20") else "FAIL",
        },
        "schema": "S1GDevelopmentResultV1",
        "selectedCandidateId": champion_id,
        "topMeasuredCandidateId": top_measured_id,
        "localVerdict": "PENDING_HOLDOUT" if development_pass else "NO_GO",
        "proxyPositiveCount": None,
        "walkForward": {
            "diagnosticOnly": True,
            "diagnosticPositive": walk_interval.lower > ZERO and walk_interval.point > ZERO,
            "eligibilityRule": "ALL_12_DATA_VALID_CANDIDATES",
            "executionLaw": (
                "FLAT_AT_EACH_WEEK_BOUNDARY_WITH_BOUNDARY_TAKER_EXIT_AND_CARRIED_"
                "EQUITY_PEAK_DRAWDOWN_TERMINAL_STOP_AND_COOLDOWN"
            ),
            "coldStartCandidateId": CANDIDATES[0].candidate_id,
            "initialWeeks": WALK_FORWARD_INITIAL_WEEKS,
            "intervalUsdPer1000": _jsonable(asdict(walk_interval)),
            "maximumDrawdownUsd": str(walk_forward_drawdown_usd),
            "oneWeekAheadCandidateIds": list(walk_forward_ids),
            "oneWeekAheadWeeklyUsd": [str(value) for value in walk_forward_values],
            "steps": WALK_FORWARD_STEPS,
            "tieBreak": [
                "HIGHEST_PRIOR_WEEKLY_MEAN",
                "FOR_PRIOR_WEEKS_1_TO_3_SKIP_UNDEFINED_BOOTSTRAP",
                "FROM_PRIOR_WEEK_4_HIGHEST_BOOTSTRAP_LOWER_BOUND_ON_EXACT_MEAN_TIE",
                "LOWEST_PRIOR_WEEKLY_CLOSE_DRAWDOWN_ON_REMAINING_TIE",
                "LEXICOGRAPHIC_CANDIDATE_ID",
            ],
        },
    }
    if champion is not None:
        selection_evidence_digest = hashlib.sha256(
            _canonical_json_bytes(_selection_evidence_payload(result))
        ).hexdigest()
        candidate_seal_payload: dict[str, object] = {
            "candidate": _jsonable(asdict(champion.candidate)),
            "candidateId": champion_id,
            "developmentMarkerSha256": development_marker_digest,
            "executablePlanSha256": executable_plan_sha256(),
            "experimentPySha256": _sha256_file(Path(__file__)),
            "protocolSha256": protocol_digest,
            "selectionEvidenceSha256": selection_evidence_digest,
            "sourcePlanSha256": source_plan_digest,
            "sourceManifestSha256": source_manifest_digest,
            "trialLedgerSha256": trial_ledger_digest,
        }
        result["candidateSeal"] = candidate_seal_payload
        result["candidateDigest"] = hashlib.sha256(
            _canonical_json_bytes(candidate_seal_payload)
        ).hexdigest()
    return result


def _authorization_payload(
    *,
    development_result_path: Path,
    development_marker_path: Path,
    development_source_manifest_digest: str,
    freeze_digest: str,
    protocol_digest: str,
    source_plan_digest: str,
    trial_ledger_digest: str,
    holdout_root: Path,
) -> dict[str, object]:
    fixed_development_marker = FIXED_RAW_ROOT / "development.consumed.json"
    if (
        development_marker_path.is_symlink()
        or development_marker_path.resolve() != fixed_development_marker
        or not development_marker_path.is_file()
    ):
        raise ProtocolValidationError("development marker path is invalid")
    expected_development_marker = {
        "experimentPySha256": _sha256_file(Path(__file__)),
        "freezeSha256": freeze_digest,
        "protocolSha256": protocol_digest,
        "sourceManifestSha256": development_source_manifest_digest,
        "sourcePlanSha256": source_plan_digest,
        "trialLedgerSha256": trial_ledger_digest,
    }
    if _load_json_object(development_marker_path) != expected_development_marker:
        raise ProtocolValidationError("development marker differs from current inputs")
    development_marker_digest = _sha256_file(development_marker_path)
    result = _load_json_object(development_result_path)
    if result.get("schema") != "S1GDevelopmentResultV1":
        raise ProtocolValidationError("development result schema is invalid")
    if (
        result.get("developmentGate") != "PASS"
        or result.get("authority") != "NONE"
        or result.get("evidenceClass") != "HISTORICAL_VALIDATION"
        or result.get("accountEffectiveFeeState") != "UNKNOWN"
        or result.get("makerEntryState") != "UNKNOWN"
        or result.get("n3EquivalentDecisionState") != "UNKNOWN"
    ):
        raise ProtocolValidationError("failed development cannot open holdout")
    candidate_digest = result.get("candidateDigest")
    candidate_id = result.get("selectedCandidateId")
    if not isinstance(candidate_digest, str) or not SHA256_RE.fullmatch(candidate_digest):
        raise ProtocolValidationError("development candidate digest is invalid")
    if not isinstance(candidate_id, str):
        raise ProtocolValidationError("development candidate id is invalid")
    candidate = _candidate_by_id(candidate_id)
    candidate_seal = result.get("candidateSeal")
    if not isinstance(candidate_seal, dict):
        raise ProtocolValidationError("development candidate seal is absent")
    recomputed_candidate_digest = hashlib.sha256(_canonical_json_bytes(candidate_seal)).hexdigest()
    if recomputed_candidate_digest != candidate_digest:
        raise ProtocolValidationError("development candidate digest does not match its seal")
    selection_evidence_digest = hashlib.sha256(
        _canonical_json_bytes(_selection_evidence_payload(result))
    ).hexdigest()
    expected_seal = {
        "candidate": _jsonable(asdict(candidate)),
        "candidateId": candidate_id,
        "developmentMarkerSha256": development_marker_digest,
        "executablePlanSha256": executable_plan_sha256(),
        "experimentPySha256": _sha256_file(Path(__file__)),
        "protocolSha256": protocol_digest,
        "selectionEvidenceSha256": selection_evidence_digest,
        "sourcePlanSha256": source_plan_digest,
        "sourceManifestSha256": development_source_manifest_digest,
        "trialLedgerSha256": trial_ledger_digest,
    }
    if candidate_seal != expected_seal:
        raise ProtocolValidationError("development candidate seal differs from current inputs")
    gates = result.get("gates")
    eligibility = result.get("candidateEligibility")
    if (
        not isinstance(gates, dict)
        or not gates
        or any(value is not True for value in gates.values())
        or not isinstance(eligibility, dict)
        or not isinstance(eligibility.get(candidate_id), dict)
        or any(value is not True for value in eligibility[candidate_id].values())
    ):
        raise ProtocolValidationError("development PASS is inconsistent with frozen gates")
    fixed_root = FIXED_RAW_ROOT / "holdout"
    if Path(os.path.abspath(holdout_root)) != Path(os.path.abspath(fixed_root)):
        raise ProtocolValidationError("holdout root differs from frozen fixed root")
    return {
        "candidateDigest": candidate_digest,
        "candidateId": candidate_id,
        "developmentMarkerSha256": development_marker_digest,
        "developmentResultSha256": _sha256_file(development_result_path),
        "developmentSourceManifestSha256": development_source_manifest_digest,
        "experimentPySha256": _sha256_file(Path(__file__)),
        "freezeSha256": freeze_digest,
        "holdoutRoot": str(fixed_root),
        "protocolSha256": protocol_digest,
        "sourcePlanSha256": source_plan_digest,
        "trialLedgerSha256": trial_ledger_digest,
    }


def run_holdout(
    data: MarketData,
    *,
    development_result_path: Path,
    marker_path: Path,
    evaluation_marker_path: Path,
    holdout_source_manifest_digest: str,
    holdout_root: Path,
) -> dict[str, object]:
    """Evaluate only the digest-sealed champion after authorization consumption."""

    result = _load_json_object(development_result_path)
    marker = _load_json_object(marker_path)
    candidate_id = result.get("selectedCandidateId")
    candidate_digest = result.get("candidateDigest")
    if (
        not isinstance(candidate_id, str)
        or marker.get("candidateId") != candidate_id
        or marker.get("candidateDigest") != candidate_digest
        or marker.get("holdoutRoot") != str(Path(os.path.abspath(holdout_root)))
    ):
        raise ProtocolValidationError("holdout marker does not bind candidate and fixed root")
    candidate = _candidate_by_id(candidate_id)
    evaluation = evaluate_candidate(
        candidate,
        data,
        start_ms=HOLDOUT_START_MS,
        end_ms=HOLDOUT_END_MS,
        expected_weeks=HOLDOUT_WEEKS,
    )
    interval = stationary_bootstrap_interval(
        evaluation.weekly_primary_usd,
        replicates=9999,
        expected_block_length=4,
        seed=9999,
        alpha=Decimal("0.05"),
    )
    proxy_gates = {
        "capacity": evaluation.minimum_capacity_usd >= ACCOUNT_CAPITAL_USD
        and evaluation.minimum_stress_capacity_usd >= ACCOUNT_CAPITAL_USD,
        "costReconciliation": all(
            costs.net_usd
            == costs.gross_basis_usd
            + costs.funding_usd
            - costs.spot_fees_usd
            - costs.futures_fees_usd
            - costs.spread_usd
            - costs.slippage_usd
            - costs.latency_usd
            - costs.rounding_usd
            for trade in evaluation.trades
            for costs in (trade.primary, trade.stress, trade.severe)
        ),
        "drawdownPrimary": evaluation.drawdown.max_drawdown_usd < Decimal("100"),
        "drawdownStress": evaluation.stress_drawdown.max_drawdown_usd < Decimal("100"),
        "primaryIntervalNominalDescriptive": interval.lower > ZERO,
        "primaryPoint": evaluation.primary_net_usd > ZERO,
        "sample": len(evaluation.trades) >= 6 and evaluation.active_week_count >= 3,
        "stress": evaluation.stress_net_usd > ZERO,
    }
    proxy_economic_pass = all(proxy_gates.values())
    gates = {
        **proxy_gates,
        "uncertaintyEffectiveBlocksAtLeastTwo": False,
    }
    # Four observations with a frozen expected block length of four provide
    # only one approximate independent block. The nominal interval is retained
    # descriptively but cannot authorize a positive validation claim.
    economic_pass = all(gates.values())
    holdout_state = "UNMEASURED" if proxy_economic_pass else "FAIL"
    return {
        **_public_truth_fields(),
        "capacityEvidence": "VOLUME_PROXY_CAPACITY",
        "candidateDigest": candidate_digest,
        "economicPass": economic_pass,
        "evaluation": _evaluation_mapping(evaluation),
        "gates": gates,
        "holdoutState": holdout_state,
        "localVerdict": "UNMEASURED" if proxy_economic_pass else "NO_GO",
        "observedProxyPositive": proxy_economic_pass,
        "provenance": {
            "authorizationMarkerSha256": _sha256_file(marker_path),
            "developmentMarkerSha256": marker.get("developmentMarkerSha256"),
            "developmentResultSha256": _sha256_file(development_result_path),
            "developmentSourceManifestSha256": marker.get("developmentSourceManifestSha256"),
            "evaluationMarkerSha256": _sha256_file(evaluation_marker_path),
            "experimentPySha256": _sha256_file(Path(__file__)),
            "freezeSha256": marker.get("freezeSha256"),
            "holdoutSourceManifestSha256": holdout_source_manifest_digest,
            "protocolSha256": marker.get("protocolSha256"),
            "sourcePlanSha256": marker.get("sourcePlanSha256"),
            "trialLedgerSha256": marker.get("trialLedgerSha256"),
        },
        "proxyEconomicPass": proxy_economic_pass,
        "proxyPositiveCount": 1 if proxy_economic_pass else 0,
        "schema": "S1GBasisCarryResultV1",
        "selectedCandidateId": candidate_id,
        "uncertainty": {
            "approximateEffectiveBlocks": "1",
            "decisionAuthority": "NONE",
            "expectedBlockLengthWeeks": 4,
            "nominalIntervalUse": "DESCRIPTIVE_ONLY",
            "state": "UNMEASURED_INSUFFICIENT_EFFECTIVE_BLOCKS",
            "weeklyObservations": 4,
        },
    }


def _terminal_unmeasured_result(
    *,
    stage: str,
    failure_class: str,
    provenance: Mapping[str, object],
    selected_candidate_id: object = None,
) -> dict[str, object]:
    return {
        **_public_truth_fields(),
        "economicPass": None,
        "failureClass": failure_class,
        "holdoutState": "UNMEASURED",
        "localVerdict": "UNMEASURED",
        "observedProxyPositive": None,
        "provenance": dict(provenance),
        "proxyPositiveCount": None,
        "schema": "S1GBasisCarryResultV1",
        "selectedCandidateId": selected_candidate_id,
        "stage": stage,
    }


def _development_no_go_result(
    development_result: Mapping[str, object],
    *,
    provenance: Mapping[str, object],
) -> dict[str, object]:
    selected_id = development_result.get("selectedCandidateId")
    top_id = development_result.get("topMeasuredCandidateId")
    evidence_rows = development_result.get("evaluations")
    chosen_evidence: object = None
    if isinstance(evidence_rows, list):
        target_id = selected_id if isinstance(selected_id, str) else top_id
        chosen_evidence = next(
            (
                row
                for row in evidence_rows
                if isinstance(row, dict) and row.get("candidateId") == target_id
            ),
            None,
        )
    return {
        **_public_truth_fields(),
        "development": dict(development_result),
        "economicPass": False,
        "evaluation": chosen_evidence,
        "holdoutState": "SEALED_UNOPENED",
        "localVerdict": "NO_GO",
        "observedProxyPositive": False,
        "provenance": dict(provenance),
        "proxyPositiveCount": 0,
        "schema": "S1GBasisCarryResultV1",
        "selectedCandidateId": selected_id,
    }


def _require_exact_path(path: Path, expected: Path, field: str) -> None:
    if path.is_symlink() or path.resolve() != expected.resolve():
        raise ProtocolValidationError(f"{field} differs from frozen exact path")


def _require_lexical_path(path: Path, expected: Path, field: str) -> None:
    """Check the named target without dereferencing a possibly hostile symlink."""

    if Path(os.path.abspath(path)) != Path(os.path.abspath(expected)):
        raise ProtocolValidationError(f"{field} differs from frozen lexical path")


def _path_present(path: Path) -> bool:
    """Treat ordinary paths and broken symlinks alike as pre-existing custody."""

    return path.exists() or path.is_symlink()


def _holdout_custody_conflicts(
    *,
    holdout_root: Path,
    authorization_marker: Path,
    evaluation_marker: Path,
    holdout_manifest: Path,
) -> tuple[str, ...]:
    paths = (
        ("HOLDOUT_ROOT", holdout_root),
        ("HOLDOUT_AUTHORIZATION_MARKER", authorization_marker),
        ("HOLDOUT_EVALUATION_MARKER", evaluation_marker),
        ("HOLDOUT_SOURCE_MANIFEST", holdout_manifest),
    )
    return tuple(label for label, path in paths if _path_present(path))


def _sha256_if_readable(path: Path) -> str | None:
    try:
        return _sha256_file(path)
    except OSError:
        return None


def _preflight(args: argparse.Namespace) -> tuple[str, str, str, str]:
    protocol_path = cast(Path, args.protocol)
    freeze_path = cast(Path, args.freeze)
    source_plan_path = cast(Path, args.source_plan)
    trial_ledger_path = cast(Path, args.trial_ledger)
    _require_exact_path(protocol_path, HERE / "protocol.v1.json", "protocol")
    _require_exact_path(freeze_path, HERE / "protocol.freeze.v1.json", "freeze")
    _require_exact_path(source_plan_path, HERE / "source_plan.v1.json", "source plan")
    _require_exact_path(trial_ledger_path, HERE / "trial_ledger.v1.json", "trial ledger")
    protocol_digest = verify_frozen_protocol(protocol_path, freeze_path)
    source_plan_digest = verify_source_plan(source_plan_path)
    trial_ledger_digest = validate_trial_ledger(trial_ledger_path)
    freeze = _load_json_object(freeze_path)
    if (
        freeze.get("sourcePlanSha256") != source_plan_digest
        or freeze.get("trialLedgerSha256") != trial_ledger_digest
    ):
        raise ProtocolValidationError("CLI source plan or ledger differs from freeze")
    return protocol_digest, source_plan_digest, trial_ledger_digest, _sha256_file(freeze_path)


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="S-1G public-only Basis carry experiment")
    subparsers = parser.add_subparsers(dest="command", required=True)
    plan = subparsers.add_parser("plan")
    plan.add_argument("--output", type=Path)
    for name in ("acquire-development", "run-development", "acquire-holdout", "run-holdout"):
        command = subparsers.add_parser(name)
        command.add_argument("--protocol", type=Path, required=True)
        command.add_argument("--freeze", type=Path, required=True)
        command.add_argument("--source-plan", type=Path, required=True)
        command.add_argument("--trial-ledger", type=Path, required=True)
        command.add_argument("--raw-root", type=Path, required=True)
        command.add_argument("--output", type=Path, required=True)
        if name == "run-development":
            command.add_argument("--source-manifest", type=Path, required=True)
            command.add_argument("--marker", type=Path, required=True)
        if "holdout" in name:
            command.add_argument("--development-result", type=Path, required=True)
            command.add_argument("--development-source-manifest", type=Path, required=True)
            command.add_argument("--marker", type=Path, required=True)
        if name == "run-holdout":
            command.add_argument("--evaluation-marker", type=Path, required=True)
            command.add_argument("--source-manifest", type=Path, required=True)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    if args.command == "plan":
        payload = executable_plan()
        payload["executablePlanSha256"] = executable_plan_sha256()
        if args.output is None:
            print(_canonical_json_bytes(payload).decode("ascii"), end="")
        else:
            _write_json_create_once(args.output, payload)
        return 0
    protocol_digest, source_plan_digest, trial_ledger_digest, freeze_digest = _preflight(args)
    raw_root = cast(Path, args.raw_root)
    fixed_raw_root = FIXED_RAW_ROOT
    if raw_root.is_symlink() or raw_root.resolve() != fixed_raw_root:
        raise ProtocolValidationError("raw root differs from the frozen fixed root")
    output = cast(Path, args.output)
    fixed_development_manifest = HERE / "development-source-manifest.v1.json"
    fixed_development_result = HERE / "development-result.v1.json"
    fixed_holdout_manifest = HERE / "holdout-source-manifest.v1.json"
    fixed_result = HERE / "result.v1.json"
    fixed_development_marker = fixed_raw_root / "development.consumed.json"
    fixed_holdout_root = fixed_raw_root / "holdout"
    fixed_holdout_marker = fixed_raw_root / "holdout.consumed.json"
    fixed_evaluation_marker = fixed_raw_root / "holdout.evaluation.consumed.json"
    holdout_conflicts = _holdout_custody_conflicts(
        holdout_root=fixed_holdout_root,
        authorization_marker=fixed_holdout_marker,
        evaluation_marker=fixed_evaluation_marker,
        holdout_manifest=fixed_holdout_manifest,
    )
    if args.command in ("acquire-development", "run-development") and holdout_conflicts:
        if not _path_present(fixed_result):
            _write_json_create_once(
                fixed_result,
                _terminal_unmeasured_result(
                    stage="PREDEVELOPMENT_HOLDOUT_CUSTODY",
                    failure_class="PREEXISTING_HOLDOUT_CUSTODY",
                    provenance={
                        "experimentPySha256": _sha256_file(Path(__file__)),
                        "freezeSha256": freeze_digest,
                        "preexistingHoldoutArtifacts": list(holdout_conflicts),
                        "protocolSha256": protocol_digest,
                        "sourcePlanSha256": source_plan_digest,
                        "trialLedgerSha256": trial_ledger_digest,
                    },
                ),
            )
        return 2
    if args.command == "acquire-development":
        _require_exact_path(output, fixed_development_manifest, "development manifest output")
        if (
            _path_present(fixed_development_marker)
            or _path_present(fixed_development_result)
            or _path_present(fixed_result)
        ):
            raise ProtocolValidationError("development acquisition is no longer pristine")
        acquire_partition("development", raw_root=raw_root, manifest_path=output)
        return 0
    if args.command == "run-development":
        _require_exact_path(output, fixed_development_result, "development result output")
        development_marker = cast(Path, args.marker)
        _require_exact_path(development_marker, fixed_development_marker, "development marker")
        source_manifest = cast(Path, args.source_manifest)
        _require_exact_path(
            source_manifest,
            fixed_development_manifest,
            "development source manifest",
        )
        if _path_present(output) or _path_present(fixed_result):
            raise ProtocolValidationError("development output already exists")
        source_manifest_digest = validate_source_manifest(
            "development",
            raw_root=raw_root,
            manifest_path=source_manifest,
        )
        marker_payload = {
            "experimentPySha256": _sha256_file(Path(__file__)),
            "freezeSha256": freeze_digest,
            "protocolSha256": protocol_digest,
            "sourceManifestSha256": source_manifest_digest,
            "sourcePlanSha256": source_plan_digest,
            "trialLedgerSha256": trial_ledger_digest,
        }
        base_development_provenance: dict[str, object] = {
            "developmentSourceManifestSha256": source_manifest_digest,
            "experimentPySha256": _sha256_file(Path(__file__)),
            "freezeSha256": freeze_digest,
            "protocolSha256": protocol_digest,
            "sourcePlanSha256": source_plan_digest,
            "trialLedgerSha256": trial_ledger_digest,
        }
        try:
            consume_holdout_once(
                development_marker,
                marker_payload,
            )
            development_marker_digest = _sha256_file(development_marker)
            development_provenance = {
                **base_development_provenance,
                "developmentMarkerSha256": development_marker_digest,
            }
            data = load_partition("development", raw_root=raw_root)
            result = run_development(
                data,
                development_marker_digest=development_marker_digest,
                source_manifest_digest=source_manifest_digest,
                protocol_digest=protocol_digest,
                source_plan_digest=source_plan_digest,
                trial_ledger_digest=trial_ledger_digest,
            )
            _write_json_create_once(output, result)
            if result.get("developmentGate") != "PASS":
                _write_json_create_once(
                    fixed_result,
                    _development_no_go_result(
                        result,
                        provenance={
                            **development_provenance,
                            "developmentResultSha256": _sha256_file(output),
                        },
                    ),
                )
        except BaseException as exc:
            if not _path_present(development_marker):
                raise
            marker_digest = _sha256_if_readable(development_marker)
            failure_provenance: dict[str, object] = {
                **base_development_provenance,
                "developmentMarkerSha256": marker_digest,
                "developmentMarkerDigestState": (
                    "PASS" if marker_digest is not None else "UNKNOWN_UNREADABLE"
                ),
            }
            if not _path_present(output):
                failure = {
                    **_public_truth_fields(),
                    "developmentGate": "UNMEASURED",
                    "failureClass": type(exc).__name__,
                    "localVerdict": "UNMEASURED",
                    "proxyPositiveCount": None,
                    "schema": "S1GDevelopmentResultV1",
                    "selectedCandidateId": None,
                }
                _write_json_create_once(output, failure)
            failure_provenance["developmentResultSha256"] = _sha256_if_readable(output)
            if not _path_present(fixed_result):
                _write_json_create_once(
                    fixed_result,
                    _terminal_unmeasured_result(
                        stage="DEVELOPMENT_AFTER_CONSUMPTION",
                        failure_class=type(exc).__name__,
                        provenance=failure_provenance,
                    ),
                )
            if not isinstance(exc, Exception):
                raise
            return 2
        return 0
    development_result = cast(Path, args.development_result)
    development_source_manifest = cast(Path, args.development_source_manifest)
    _require_exact_path(development_result, fixed_development_result, "development result")
    _require_exact_path(
        development_source_manifest,
        fixed_development_manifest,
        "development source manifest",
    )
    development_source_manifest_digest = validate_source_manifest(
        "development",
        raw_root=raw_root,
        manifest_path=development_source_manifest,
    )
    marker = cast(Path, args.marker)
    holdout_root = fixed_holdout_root
    _require_lexical_path(marker, fixed_holdout_marker, "holdout marker")
    if args.command == "acquire-holdout":
        _require_lexical_path(output, fixed_holdout_manifest, "holdout manifest output")
        if _path_present(fixed_result):
            raise ProtocolValidationError("terminal result already exists")
        preexisting = _holdout_custody_conflicts(
            holdout_root=holdout_root,
            authorization_marker=marker,
            evaluation_marker=fixed_evaluation_marker,
            holdout_manifest=output,
        )
        if preexisting:
            development_payload = _load_json_object(development_result)
            _write_json_create_once(
                fixed_result,
                _terminal_unmeasured_result(
                    stage="HOLDOUT_ACQUISITION_PREEXISTING_CUSTODY",
                    failure_class="PREEXISTING_HOLDOUT_CUSTODY",
                    provenance={
                        "candidateDigest": development_payload.get("candidateDigest"),
                        "developmentMarkerSha256": _sha256_if_readable(fixed_development_marker),
                        "developmentResultSha256": _sha256_file(development_result),
                        "developmentSourceManifestSha256": (development_source_manifest_digest),
                        "experimentPySha256": _sha256_file(Path(__file__)),
                        "freezeSha256": freeze_digest,
                        "preexistingHoldoutArtifacts": list(preexisting),
                        "protocolSha256": protocol_digest,
                        "sourcePlanSha256": source_plan_digest,
                        "trialLedgerSha256": trial_ledger_digest,
                    },
                    selected_candidate_id=development_payload.get("selectedCandidateId"),
                ),
            )
            return 2
        _require_exact_path(marker, fixed_holdout_marker, "holdout marker")
        _require_exact_path(output, fixed_holdout_manifest, "holdout manifest output")
        authorization = _authorization_payload(
            development_result_path=development_result,
            development_marker_path=fixed_development_marker,
            development_source_manifest_digest=development_source_manifest_digest,
            freeze_digest=freeze_digest,
            protocol_digest=protocol_digest,
            source_plan_digest=source_plan_digest,
            trial_ledger_digest=trial_ledger_digest,
            holdout_root=holdout_root,
        )
        try:
            consume_holdout_once(marker, authorization)
            acquire_partition("holdout", raw_root=raw_root, manifest_path=output)
        except BaseException as exc:
            if not _path_present(marker):
                raise
            if not _path_present(fixed_result):
                _write_json_create_once(
                    fixed_result,
                    _terminal_unmeasured_result(
                        stage="HOLDOUT_ACQUISITION_AFTER_CONSUMPTION",
                        failure_class=type(exc).__name__,
                        provenance={
                            "authorizationMarkerSha256": _sha256_if_readable(marker),
                            **authorization,
                        },
                        selected_candidate_id=authorization.get("candidateId"),
                    ),
                )
            if not isinstance(exc, Exception):
                raise
            return 2
        return 0
    _require_exact_path(marker, fixed_holdout_marker, "holdout marker")
    _require_exact_path(output, fixed_result, "holdout result output")
    holdout_source_manifest = cast(Path, args.source_manifest)
    _require_exact_path(
        holdout_source_manifest,
        fixed_holdout_manifest,
        "holdout source manifest",
    )
    expected_authorization = _authorization_payload(
        development_result_path=development_result,
        development_marker_path=fixed_development_marker,
        development_source_manifest_digest=development_source_manifest_digest,
        freeze_digest=freeze_digest,
        protocol_digest=protocol_digest,
        source_plan_digest=source_plan_digest,
        trial_ledger_digest=trial_ledger_digest,
        holdout_root=holdout_root,
    )
    evaluation_marker = cast(Path, args.evaluation_marker)
    _require_exact_path(
        evaluation_marker,
        fixed_evaluation_marker,
        "holdout evaluation marker",
    )
    if _path_present(output):
        raise ProtocolValidationError("holdout result output already exists")
    try:
        authorization_marker_payload = _load_json_object(marker)
        if authorization_marker_payload != expected_authorization:
            raise ProtocolValidationError(
                "holdout authorization digests do not match current inputs"
            )
        if holdout_source_manifest.is_symlink() or not holdout_source_manifest.is_file():
            raise ProtocolValidationError("holdout source manifest is absent or linked")
        consume_holdout_once(
            evaluation_marker,
            {
                "authorizationSha256": _sha256_file(marker),
                "developmentResultSha256": _sha256_file(development_result),
                "experimentPySha256": _sha256_file(Path(__file__)),
                "holdoutSourceManifestSha256": _sha256_file(holdout_source_manifest),
                "outputPath": str(output.resolve()),
            },
        )
        holdout_source_manifest_digest = validate_source_manifest(
            "holdout",
            raw_root=raw_root,
            manifest_path=holdout_source_manifest,
        )
        data = load_partition("holdout", raw_root=raw_root)
        result = run_holdout(
            data,
            development_result_path=development_result,
            marker_path=marker,
            evaluation_marker_path=evaluation_marker,
            holdout_source_manifest_digest=holdout_source_manifest_digest,
            holdout_root=holdout_root,
        )
        _write_json_create_once(output, result)
    except BaseException as exc:
        if not _path_present(marker):
            raise
        stage = (
            "HOLDOUT_EVALUATION_AFTER_CONSUMPTION"
            if _path_present(evaluation_marker)
            else "HOLDOUT_EVALUATION_AFTER_AUTHORIZATION"
        )
        if not _path_present(output):
            _write_json_create_once(
                output,
                _terminal_unmeasured_result(
                    stage=stage,
                    failure_class=type(exc).__name__,
                    provenance={
                        **expected_authorization,
                        "authorizationMarkerSha256": _sha256_if_readable(marker),
                        "evaluationMarkerSha256": _sha256_if_readable(evaluation_marker),
                        "holdoutSourceManifestSha256": _sha256_if_readable(holdout_source_manifest),
                    },
                    selected_candidate_id=expected_authorization.get("candidateId"),
                ),
            )
        if not isinstance(exc, Exception):
            raise
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
