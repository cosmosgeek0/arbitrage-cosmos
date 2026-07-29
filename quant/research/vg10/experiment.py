#!/usr/bin/env python3
"""Deterministic sealed evaluator for the V-G10 public-data research packet.

This module has no import-time I/O, network, clock, environment, or randomness.
All runtime state is written under an explicit external ``--state-dir``.  The
shared daily archive is read-only, and holdout bytes are unreachable until a
single development champion is sealed.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import itertools
import json
import math
import os
import random
import re
import statistics
import sys
import urllib.parse
import urllib.request
import zipfile
from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from pathlib import Path, PurePosixPath
from typing import Any

PACKET_DIR = Path(__file__).resolve().parent
REPOSITORY_ROOT = PACKET_DIR.parents[2]
PROTOCOL_PATH = PACKET_DIR / "protocol.v1.json"
STATIC_PACKET_NAMES = (
    "__init__.py",
    "README.md",
    "OFFICIAL_SOURCE_RESEARCH.md",
    "DISTINCTNESS.md",
    "protocol.v1.json",
    "experiment.py",
    "test_experiment.py",
)
VERDICTS = frozenset({"GO", "NO_GO", "UNMEASURED"})
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
SYMBOL_RE = re.compile(r"^[A-Z0-9]+USDT$")
DAILY_ARCHIVE_RE = re.compile(r"^(?P<symbol>[A-Z0-9]+USDT)-1d-(?P<month>\d{4}-\d{2})\.zip$")
INTERVAL_MICROSECONDS = {"15m": 15 * 60 * 1_000_000, "1d": 24 * 60 * 60 * 1_000_000}
ZERO = Decimal("0")
ONE = Decimal("1")
TEN_THOUSAND = Decimal("10000")


class PacketError(RuntimeError):
    """Base error with a stable public reason code."""

    code = "PACKET_ERROR"


class EvidenceError(PacketError):
    """Source, schema, custody, or measurement evidence is invalid."""

    code = "EVIDENCE_INVALID"


class LifecycleError(PacketError):
    """A one-use lifecycle transition was attempted out of order."""

    code = "LIFECYCLE_REFUSED"


class GateError(PacketError):
    """A valid measurement cannot proceed through a frozen gate."""

    code = "GATE_FAILED"


@dataclass(frozen=True)
class KlineBar:
    symbol: str
    open_time: datetime
    open_price: Decimal
    high_price: Decimal
    low_price: Decimal
    close_price: Decimal
    base_volume: Decimal
    quote_volume: Decimal
    close_time_microseconds: int
    trade_count: int
    taker_buy_base_volume: Decimal
    taker_buy_quote_volume: Decimal
    ignored: Decimal
    raw_row: tuple[str, ...]

    @property
    def imbalance(self) -> Decimal:
        return (Decimal(2) * self.taker_buy_quote_volume - self.quote_volume) / self.quote_volume


@dataclass(frozen=True)
class TrialSpec:
    days: int
    persistence: int
    top_k: int
    holding_hours: int

    @property
    def trial_id(self) -> str:
        return f"D{self.days:02d}_P{self.persistence}_K{self.top_k:02d}_H{self.holding_hours:02d}"


@dataclass(frozen=True)
class Scenario:
    name: str
    fee_bps: Decimal
    adverse_bps: Decimal

    @property
    def round_trip_cost_factor(self) -> Decimal:
        fee = self.fee_bps / TEN_THOUSAND
        adverse = self.adverse_bps / TEN_THOUSAND
        return (ONE - fee) * (ONE - fee) * (ONE - adverse) / (ONE + adverse)


@dataclass(frozen=True)
class SignalSnapshot:
    decision: datetime
    scores: Mapping[str, Decimal]
    positive_counts: Mapping[str, int]


@dataclass(frozen=True)
class FormationObservation:
    decision: datetime
    selected: tuple[str, ...]
    benchmark: tuple[str, ...]
    strategy_gross_factor: Decimal
    benchmark_gross_factor: Decimal
    maximum_participation_bps: Decimal
    eligible_symbols: int
    active: bool


def canonical_bytes(value: Any) -> bytes:
    return (
        json.dumps(
            value,
            ensure_ascii=True,
            allow_nan=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        + b"\n"
    )


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_path(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def utc_text(value: datetime) -> str:
    if value.tzinfo != UTC:
        raise EvidenceError("timestamp must be UTC")
    return value.isoformat(timespec="seconds").replace("+00:00", "Z")


def decimal_text(value: Decimal | float | int) -> str:
    number = value if isinstance(value, Decimal) else Decimal(str(value))
    if not number.is_finite():
        raise EvidenceError("non-finite decimal cannot be serialized")
    text = format(number, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text if text not in {"", "-0"} else "0"


def require_mapping(value: Any, field: str) -> Mapping[str, Any]:
    if not isinstance(value, dict):
        raise EvidenceError(f"{field} must be an object")
    return value


def require_list(value: Any, field: str) -> list[Any]:
    if not isinstance(value, list):
        raise EvidenceError(f"{field} must be an array")
    return value


def require_text(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value:
        raise EvidenceError(f"{field} must be non-empty text")
    return value


def read_json(path: Path) -> Mapping[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise EvidenceError(f"cannot read canonical JSON {path.name}: {exc}") from exc
    return require_mapping(value, path.name)


def load_protocol(path: Path = PROTOCOL_PATH) -> Mapping[str, Any]:
    protocol = read_json(path)
    if protocol.get("schema") != "VG10TakerBuyImbalancePersistenceProtocolV1":
        raise EvidenceError("protocol schema mismatch")
    if protocol.get("canonicalBaseCommit") != "a169b123fb186d1943a75ad648552c4d95be1be1":
        raise EvidenceError("protocol base commit mismatch")
    specs = trial_specs(protocol)
    declared = tuple(
        require_list(require_mapping(protocol["trials"], "trials")["trialIds"], "trialIds")
    )
    actual = tuple(spec.trial_id for spec in specs)
    if declared != actual or len(actual) != 16 or len(set(actual)) != 16:
        raise EvidenceError("protocol trial family mismatch")
    return protocol


def parse_month(value: str) -> tuple[int, int]:
    if not MONTH_RE.fullmatch(value):
        raise EvidenceError(f"invalid month: {value}")
    year_text, month_text = value.split("-")
    return int(year_text), int(month_text)


def month_range(start: str, end: str) -> tuple[str, ...]:
    year, month = parse_month(start)
    end_year, end_month = parse_month(end)
    values: list[str] = []
    while (year, month) <= (end_year, end_month):
        values.append(f"{year:04d}-{month:02d}")
        if month == 12:
            year += 1
            month = 1
        else:
            month += 1
    if not values:
        raise EvidenceError("empty month range")
    return tuple(values)


def month_bounds(month: str) -> tuple[datetime, datetime]:
    year, month_number = parse_month(month)
    start = datetime(year, month_number, 1, tzinfo=UTC)
    if month_number == 12:
        end = datetime(year + 1, 1, 1, tzinfo=UTC)
    else:
        end = datetime(year, month_number + 1, 1, tzinfo=UTC)
    return start, end


def parse_decimal(value: str, field: str, *, positive: bool = False) -> Decimal:
    try:
        parsed = Decimal(value)
    except InvalidOperation as exc:
        raise EvidenceError(f"{field} is not decimal") from exc
    if not parsed.is_finite() or (positive and parsed <= ZERO) or (not positive and parsed < ZERO):
        qualifier = "positive" if positive else "nonnegative"
        raise EvidenceError(f"{field} must be finite and {qualifier}")
    return parsed


def parse_microsecond_timestamp(value: str, field: str) -> tuple[int, datetime]:
    if not value.isascii() or not value.isdigit():
        raise EvidenceError(f"{field} must be an integer microsecond timestamp")
    raw = int(value)
    if raw < 1_000_000_000_000_000:
        raise EvidenceError(f"{field} uses milliseconds; 2025+ Spot archives require microseconds")
    try:
        seconds, microseconds = divmod(raw, 1_000_000)
        parsed = datetime.fromtimestamp(seconds, tz=UTC) + timedelta(microseconds=microseconds)
    except (OverflowError, OSError, ValueError) as exc:
        raise EvidenceError(f"{field} timestamp out of range") from exc
    return raw, parsed


def parse_checksum_sidecar(sidecar_bytes: bytes, zip_name: str) -> str:
    try:
        text = sidecar_bytes.decode("ascii")
    except UnicodeDecodeError as exc:
        raise EvidenceError("checksum sidecar is not ASCII") from exc
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if len(lines) != 1:
        raise EvidenceError("checksum sidecar must contain exactly one non-empty line")
    parts = lines[0].split()
    if len(parts) != 2:
        raise EvidenceError("checksum sidecar shape invalid")
    digest = parts[0].lower()
    named = parts[1].lstrip("*")
    if not SHA256_RE.fullmatch(digest) or named != zip_name:
        raise EvidenceError("checksum sidecar digest or member name mismatch")
    return digest


def _parse_kline_row(
    row: Sequence[str],
    *,
    symbol: str,
    month: str,
    interval: str,
) -> KlineBar:
    if len(row) != 12:
        raise EvidenceError(f"{symbol} {month} kline row must have 12 columns")
    open_raw, open_time = parse_microsecond_timestamp(row[0], "open_time")
    close_raw, _close_time = parse_microsecond_timestamp(row[6], "close_time")
    interval_us = INTERVAL_MICROSECONDS[interval]
    if close_raw != open_raw + interval_us - 1:
        raise EvidenceError(f"{symbol} {month} close time is not the exact interval boundary")
    start, end = month_bounds(month)
    if not start <= open_time < end:
        raise EvidenceError(f"{symbol} row lies outside archive month {month}")
    if open_raw % interval_us != 0:
        raise EvidenceError(f"{symbol} row is off the {interval} UTC grid")
    open_price = parse_decimal(row[1], "open", positive=True)
    high_price = parse_decimal(row[2], "high", positive=True)
    low_price = parse_decimal(row[3], "low", positive=True)
    close_price = parse_decimal(row[4], "close", positive=True)
    if high_price < max(open_price, low_price, close_price):
        raise EvidenceError(f"{symbol} high is inconsistent")
    if low_price > min(open_price, high_price, close_price):
        raise EvidenceError(f"{symbol} low is inconsistent")
    base_volume = parse_decimal(row[5], "base_volume")
    quote_volume = parse_decimal(row[7], "quote_volume", positive=True)
    if not row[8].isascii() or not row[8].isdigit():
        raise EvidenceError("trade_count must be a nonnegative integer")
    trade_count = int(row[8])
    taker_base = parse_decimal(row[9], "taker_buy_base_volume")
    taker_quote = parse_decimal(row[10], "taker_buy_quote_volume")
    if taker_base > base_volume:
        raise EvidenceError("taker_buy_base_volume exceeds total base_volume")
    if taker_quote > quote_volume:
        raise EvidenceError("taker_buy_quote_volume exceeds total quote_volume")
    ignored = parse_decimal(row[11], "ignored")
    return KlineBar(
        symbol=symbol,
        open_time=open_time,
        open_price=open_price,
        high_price=high_price,
        low_price=low_price,
        close_price=close_price,
        base_volume=base_volume,
        quote_volume=quote_volume,
        close_time_microseconds=close_raw,
        trade_count=trade_count,
        taker_buy_base_volume=taker_base,
        taker_buy_quote_volume=taker_quote,
        ignored=ignored,
        raw_row=tuple(row),
    )


def parse_kline_archive(
    zip_bytes: bytes,
    sidecar_bytes: bytes,
    *,
    symbol: str,
    month: str,
    interval: str,
    collapse_identical_duplicates: bool = False,
    require_full_month: bool | None = None,
) -> tuple[dict[datetime, KlineBar], int]:
    if interval not in INTERVAL_MICROSECONDS:
        raise EvidenceError(f"unsupported interval: {interval}")
    zip_name = f"{symbol}-{interval}-{month}.zip"
    expected_sha = parse_checksum_sidecar(sidecar_bytes, zip_name)
    if sha256_bytes(zip_bytes) != expected_sha:
        raise EvidenceError(f"{zip_name} checksum mismatch")
    expected_member = f"{symbol}-{interval}-{month}.csv"
    try:
        with zipfile.ZipFile(io.BytesIO(zip_bytes), "r") as archive:
            infos = archive.infolist()
            if len(infos) != 1 or infos[0].filename != expected_member or infos[0].is_dir():
                raise EvidenceError(f"{zip_name} must contain exactly {expected_member}")
            if infos[0].file_size > 256 * 1024 * 1024:
                raise EvidenceError(f"{zip_name} member exceeds safety limit")
            raw_csv = archive.read(infos[0])
    except (zipfile.BadZipFile, RuntimeError, OSError) as exc:
        raise EvidenceError(f"{zip_name} is not a readable ZIP") from exc
    try:
        text = raw_csv.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise EvidenceError(f"{expected_member} is not UTF-8") from exc
    bars: dict[datetime, KlineBar] = {}
    duplicate_count = 0
    previous_time: datetime | None = None
    for row_number, row in enumerate(csv.reader(io.StringIO(text)), start=1):
        if not row:
            raise EvidenceError(f"{expected_member}:{row_number} empty row")
        bar = _parse_kline_row(row, symbol=symbol, month=month, interval=interval)
        existing = bars.get(bar.open_time)
        if existing is not None:
            if collapse_identical_duplicates and existing.raw_row == bar.raw_row:
                duplicate_count += 1
                continue
            raise EvidenceError(f"{symbol} duplicate/conflicting {interval} bar at {bar.open_time}")
        if previous_time is not None and bar.open_time <= previous_time:
            raise EvidenceError(f"{symbol} archive rows are not strictly increasing")
        bars[bar.open_time] = bar
        previous_time = bar.open_time
    if not bars:
        raise EvidenceError(f"{expected_member} contains no rows")
    full_month = interval == "15m" if require_full_month is None else require_full_month
    if full_month:
        start, end = month_bounds(month)
        interval_delta = timedelta(microseconds=INTERVAL_MICROSECONDS[interval])
        expected_count = int((end - start) / interval_delta)
        if len(bars) != expected_count or min(bars) != start or max(bars) != end - interval_delta:
            raise EvidenceError(f"{symbol} {month} does not cover the full {interval} month")
        previous: datetime | None = None
        for timestamp in bars:
            if previous is not None and timestamp != previous + interval_delta:
                raise EvidenceError(f"{symbol} {month} has a non-consecutive {interval} grid")
            previous = timestamp
    return bars, duplicate_count


def merge_bar_maps(
    destination: dict[datetime, KlineBar],
    incoming: Mapping[datetime, KlineBar],
    *,
    collapse_identical_duplicates: bool,
) -> int:
    collapsed = 0
    for timestamp, bar in incoming.items():
        existing = destination.get(timestamp)
        if existing is None:
            destination[timestamp] = bar
        elif collapse_identical_duplicates and existing.raw_row == bar.raw_row:
            collapsed += 1
        else:
            raise EvidenceError(f"{bar.symbol} conflicting duplicate at {utc_text(timestamp)}")
    return collapsed


def excluded_base_asset(
    symbol: str,
    protocol: Mapping[str, Any],
    archive_symbols: Iterable[str] = (),
) -> bool:
    if not SYMBOL_RE.fullmatch(symbol):
        return True
    base = symbol[: -len("USDT")]
    cohort = require_mapping(protocol["cohort"], "cohort")
    stable = {
        require_text(item, "stable exclusion")
        for item in require_list(cohort["stableAndFiatBaseExclusions"], "stable exclusions")
    }
    if base in stable:
        return True
    exact_leveraged = {
        require_text(item, "exact leveraged exclusion")
        for item in require_list(
            cohort["leveragedTokenExactBaseExclusions"],
            "exact leveraged exclusions",
        )
    }
    if base in exact_leveraged:
        return True
    discovered_bases = {
        item[: -len("USDT")]
        for item in archive_symbols
        if isinstance(item, str) and SYMBOL_RE.fullmatch(item)
    }
    for pair_value in require_list(
        cohort["leveragedTokenPairedSuffixes"], "leveraged paired suffixes"
    ):
        pair = require_list(pair_value, "leveraged suffix pair")
        if len(pair) != 2:
            raise EvidenceError("leveraged suffix pairs must contain exactly two suffixes")
        first, second = (require_text(item, "leveraged suffix") for item in pair)
        if base.endswith(first):
            stem = base[: -len(first)]
            if stem and stem + second in discovered_bases:
                return True
        if base.endswith(second):
            stem = base[: -len(second)]
            if stem and stem + first in discovered_bases:
                return True
    return False


def discover_daily_archives(source_root: Path) -> Mapping[tuple[str, str], tuple[Path, Path]]:
    if not source_root.is_dir():
        raise EvidenceError("daily source root is missing")
    found: dict[tuple[str, str], tuple[Path, Path]] = {}
    for archive_path in sorted(source_root.rglob("*.zip")):
        match = DAILY_ARCHIVE_RE.fullmatch(archive_path.name)
        if match is None:
            continue
        month = match.group("month")
        if month not in {"2025-04", "2025-05", "2025-06"}:
            continue
        symbol = match.group("symbol")
        key = (symbol, month)
        if key in found:
            raise EvidenceError(f"multiple daily archives discovered for {symbol} {month}")
        sidecar_path = archive_path.with_name(archive_path.name + ".CHECKSUM")
        if not sidecar_path.is_file():
            raise EvidenceError(f"missing daily checksum sidecar for {archive_path.name}")
        found[key] = (archive_path, sidecar_path)
    if not found:
        raise EvidenceError("no April-June 2025 USDT daily archives discovered")
    return found


def build_static_cohort(
    source_root: Path,
    protocol: Mapping[str, Any],
    *,
    frozen_at: datetime,
) -> Mapping[str, Any]:
    discovered = discover_daily_archives(source_root)
    by_symbol: dict[str, dict[datetime, KlineBar]] = defaultdict(dict)
    duplicate_counts: dict[str, int] = defaultdict(int)
    source_bindings: list[Mapping[str, Any]] = []
    discovered_symbols = {symbol for symbol, _month in discovered}
    for (symbol, month), (archive_path, sidecar_path) in sorted(discovered.items()):
        if excluded_base_asset(symbol, protocol, discovered_symbols):
            continue
        zip_bytes = archive_path.read_bytes()
        sidecar_bytes = sidecar_path.read_bytes()
        parsed, duplicates = parse_kline_archive(
            zip_bytes,
            sidecar_bytes,
            symbol=symbol,
            month=month,
            interval="1d",
            collapse_identical_duplicates=True,
            require_full_month=False,
        )
        duplicates += merge_bar_maps(by_symbol[symbol], parsed, collapse_identical_duplicates=True)
        duplicate_counts[symbol] += duplicates
        source_bindings.append(
            {
                "symbol": symbol,
                "month": month,
                "archiveRelativePath": archive_path.relative_to(source_root).as_posix(),
                "archiveSha256": sha256_bytes(zip_bytes),
                "sidecarRelativePath": sidecar_path.relative_to(source_root).as_posix(),
                "sidecarSha256": sha256_bytes(sidecar_bytes),
            }
        )
    cohort = require_mapping(protocol["cohort"], "cohort")
    start = datetime(2025, 4, 1, tzinfo=UTC)
    ranking_start = datetime(2025, 5, 2, tzinfo=UTC)
    minimum_bars = int(cohort["minimumCompleteDailyBars"])
    ranking_days = int(cohort["rankingWindowDays"])
    eligible: list[tuple[Decimal, str, int]] = []
    exclusions: dict[str, str] = {}
    for symbol in sorted(by_symbol):
        bars = by_symbol[symbol]
        expected_window = tuple(start + timedelta(days=offset) for offset in range(91))
        window = [bars[timestamp] for timestamp in expected_window if timestamp in bars]
        if len(window) < minimum_bars:
            exclusions[symbol] = "FEWER_THAN_90_COMPLETE_DAILY_BARS"
            continue
        trailing = [
            bars[ranking_start + timedelta(days=offset)].quote_volume
            for offset in range(ranking_days)
            if ranking_start + timedelta(days=offset) in bars
        ]
        if len(trailing) != ranking_days:
            exclusions[symbol] = "INCOMPLETE_TRAILING_60_DAY_RANKING_WINDOW"
            continue
        median_quote = statistics.median(trailing)
        eligible.append((median_quote, symbol, len(window)))
    eligible.sort(key=lambda item: (-item[0], item[1]))
    selected_count = int(cohort["selectedCount"])
    if len(eligible) < selected_count:
        raise EvidenceError(
            f"only {len(eligible)} cohort symbols eligible; {selected_count} required"
        )
    selected = eligible[:selected_count]
    return {
        "schema": "VG10StaticCohortV1",
        "protocolSha256": sha256_path(PROTOCOL_PATH),
        "frozenAtUtc": utc_text(frozen_at),
        "sourceRootResolved": str(source_root.resolve()),
        "sourceMode": "READ_ONLY",
        "selectionWindow": ["2025-04-01", "2025-07-01"],
        "rankingWindow": ["2025-05-02", "2025-07-01"],
        "selectedSymbols": [item[1] for item in selected],
        "ranking": [
            {
                "rank": rank,
                "symbol": item[1],
                "medianDailyQuoteVolume": decimal_text(item[0]),
                "completeDailyBars": item[2],
                "missingDailyBars": 91 - item[2],
                "collapsedIdenticalDuplicateRows": duplicate_counts[item[1]],
            }
            for rank, item in enumerate(selected, start=1)
        ],
        "eligibleCount": len(eligible),
        "excludedAfterArchiveDiscovery": exclusions,
        "allCollapsedIdenticalDuplicateRows": sum(duplicate_counts.values()),
        "sourceBindings": source_bindings,
        "currentExchangeInfoUsed": False,
        "futureStatusFilterUsed": False,
    }


def trial_specs(protocol: Mapping[str, Any]) -> tuple[TrialSpec, ...]:
    trials = require_mapping(protocol["trials"], "trials")
    specs = tuple(
        TrialSpec(int(days), int(persistence), int(top_k), int(holding))
        for days in require_list(trials["D"], "D")
        for persistence in require_list(trials["P"], "P")
        for top_k in require_list(trials["K"], "K")
        for holding in require_list(trials["HHours"], "HHours")
    )
    return specs


def scenarios(protocol: Mapping[str, Any]) -> tuple[Scenario, ...]:
    entries = require_mapping(require_mapping(protocol["costs"], "costs")["scenarios"], "scenarios")
    return tuple(
        Scenario(
            name=name,
            fee_bps=Decimal(require_text(require_mapping(value, name)["feeBpsPerFill"], "fee")),
            adverse_bps=Decimal(
                require_text(require_mapping(value, name)["adverseExecutionBpsPerFill"], "adverse")
            ),
        )
        for name, value in entries.items()
    )


def decisions_between(start: datetime, end: datetime, hours: Sequence[int]) -> tuple[datetime, ...]:
    if start.tzinfo != UTC or end.tzinfo != UTC or start >= end:
        raise EvidenceError("decision range must be ordered UTC")
    allowed = tuple(sorted(int(hour) for hour in hours))
    values: list[datetime] = []
    current = start
    while current < end:
        if current.hour in allowed and current.minute == current.second == current.microsecond == 0:
            values.append(current)
        current += timedelta(hours=1)
    return tuple(values)


def assert_nonoverlap(decisions: Sequence[datetime], maximum_holding_hours: int) -> None:
    previous_exit: datetime | None = None
    for decision in decisions:
        entry = decision + timedelta(minutes=15)
        exit_time = entry + timedelta(hours=maximum_holding_hours)
        if previous_exit is not None and entry < previous_exit:
            raise EvidenceError("scheduled formations overlap at maximum H")
        previous_exit = exit_time


def causal_signal_snapshot(
    bars_by_symbol: Mapping[str, Mapping[datetime, KlineBar]],
    symbols: Sequence[str],
    decision: datetime,
    days: int,
) -> SignalSnapshot:
    scores: dict[str, Decimal] = {}
    positive_counts: dict[str, int] = {}
    current_times = tuple(decision - timedelta(minutes=15 * offset) for offset in (4, 3, 2, 1))
    for symbol in symbols:
        bars = bars_by_symbol.get(symbol, {})
        residuals: list[Decimal] = []
        valid = True
        for current_time in current_times:
            current = bars.get(current_time)
            if current is None:
                valid = False
                break
            prior_values: list[Decimal] = []
            for day_offset in range(1, days + 1):
                prior = bars.get(current_time - timedelta(days=day_offset))
                if prior is None:
                    valid = False
                    break
                prior_values.append(prior.imbalance)
            if not valid:
                break
            baseline = statistics.median(prior_values)
            residuals.append(current.imbalance - baseline)
        if valid:
            scores[symbol] = sum(residuals, ZERO) / Decimal(4)
            positive_counts[symbol] = sum(1 for value in residuals if value > ZERO)
    return SignalSnapshot(decision=decision, scores=scores, positive_counts=positive_counts)


def select_formation(
    snapshot: SignalSnapshot,
    spec: TrialSpec,
    *,
    minimum_eligible: int,
) -> tuple[tuple[str, ...], tuple[str, ...]]:
    if len(snapshot.scores) < minimum_eligible:
        return (), ()
    persistent = [
        symbol for symbol in snapshot.scores if snapshot.positive_counts[symbol] >= spec.persistence
    ]
    persistent.sort(key=lambda symbol: (-snapshot.scores[symbol], symbol))
    if len(persistent) < spec.top_k:
        return (), ()
    selected = tuple(persistent[: spec.top_k])
    selected_set = set(selected)
    neutral = [symbol for symbol in snapshot.scores if symbol not in selected_set]
    neutral.sort(key=lambda symbol: (abs(snapshot.scores[symbol]), symbol))
    if len(neutral) < spec.top_k:
        return (), ()
    return selected, tuple(neutral[: spec.top_k])


def _bar_or_fail(
    bars_by_symbol: Mapping[str, Mapping[datetime, KlineBar]],
    symbol: str,
    timestamp: datetime,
    use: str,
) -> KlineBar:
    bar = bars_by_symbol.get(symbol, {}).get(timestamp)
    if bar is None:
        raise EvidenceError(f"{symbol} missing selected {use} bar at {utc_text(timestamp)}")
    return bar


def formation_observation(
    bars_by_symbol: Mapping[str, Mapping[datetime, KlineBar]],
    snapshot: SignalSnapshot,
    spec: TrialSpec,
    *,
    minimum_eligible: int,
    capacity_notional: Decimal = Decimal("1000"),
) -> FormationObservation:
    selected, benchmark = select_formation(snapshot, spec, minimum_eligible=minimum_eligible)
    if not selected:
        return FormationObservation(
            decision=snapshot.decision,
            selected=(),
            benchmark=(),
            strategy_gross_factor=ONE,
            benchmark_gross_factor=ONE,
            maximum_participation_bps=ZERO,
            eligible_symbols=len(snapshot.scores),
            active=False,
        )
    entry_time = snapshot.decision + timedelta(minutes=15)
    exit_time = entry_time + timedelta(hours=spec.holding_hours)
    selected_factors: list[Decimal] = []
    benchmark_factors: list[Decimal] = []
    participation: list[Decimal] = []
    per_leg_notional = capacity_notional / Decimal(spec.top_k)
    for symbol in selected:
        wait_bar = _bar_or_fail(bars_by_symbol, symbol, snapshot.decision, "wait")
        entry = _bar_or_fail(bars_by_symbol, symbol, entry_time, "entry")
        exit_bar = _bar_or_fail(bars_by_symbol, symbol, exit_time, "exit")
        selected_factors.append(exit_bar.open_price / entry.open_price)
        participation.append(per_leg_notional / wait_bar.quote_volume * TEN_THOUSAND)
    for symbol in benchmark:
        _bar_or_fail(bars_by_symbol, symbol, snapshot.decision, "benchmark wait")
        entry = _bar_or_fail(bars_by_symbol, symbol, entry_time, "benchmark entry")
        exit_bar = _bar_or_fail(bars_by_symbol, symbol, exit_time, "benchmark exit")
        benchmark_factors.append(exit_bar.open_price / entry.open_price)
    return FormationObservation(
        decision=snapshot.decision,
        selected=selected,
        benchmark=benchmark,
        strategy_gross_factor=sum(selected_factors, ZERO) / Decimal(spec.top_k),
        benchmark_gross_factor=sum(benchmark_factors, ZERO) / Decimal(spec.top_k),
        maximum_participation_bps=max(participation),
        eligible_symbols=len(snapshot.scores),
        active=True,
    )


def apply_scenario(gross_factor: Decimal, scenario: Scenario) -> Decimal:
    if gross_factor <= ZERO:
        raise EvidenceError("gross factor must be positive")
    return gross_factor * scenario.round_trip_cost_factor


def evaluate_trial_observations(
    bars_by_symbol: Mapping[str, Mapping[datetime, KlineBar]],
    symbols: Sequence[str],
    decisions: Sequence[datetime],
    spec: TrialSpec,
    protocol: Mapping[str, Any],
    signal_cache: dict[tuple[int, datetime], SignalSnapshot] | None = None,
) -> tuple[FormationObservation, ...]:
    cache = signal_cache if signal_cache is not None else {}
    minimum = int(
        require_mapping(protocol["signal"], "signal")["minimumEligibleSymbolsPerFormation"]
    )
    observations: list[FormationObservation] = []
    for decision in decisions:
        key = (spec.days, decision)
        snapshot = cache.get(key)
        if snapshot is None:
            snapshot = causal_signal_snapshot(bars_by_symbol, symbols, decision, spec.days)
            cache[key] = snapshot
        observations.append(
            formation_observation(
                bars_by_symbol,
                snapshot,
                spec,
                minimum_eligible=minimum,
            )
        )
    return tuple(observations)


def daily_compounded_returns(
    observations: Sequence[FormationObservation],
    scenario: Scenario,
) -> tuple[tuple[date, float, float], ...]:
    strategy_factors: dict[date, Decimal] = defaultdict(lambda: ONE)
    benchmark_factors: dict[date, Decimal] = defaultdict(lambda: ONE)
    for observation in observations:
        day = observation.decision.date()
        if observation.active:
            strategy_factors[day] *= apply_scenario(
                observation.strategy_gross_factor,
                scenario,
            )
            benchmark_factors[day] *= apply_scenario(
                observation.benchmark_gross_factor,
                scenario,
            )
        else:
            # An inactive formation remains cash and therefore has no fills or
            # fee/adverse-execution drag.
            strategy_factors[day] *= ONE
            benchmark_factors[day] *= ONE
    if set(strategy_factors) != set(benchmark_factors):
        raise EvidenceError("strategy and benchmark daily paths are not synchronous")
    return tuple(
        (
            day,
            float(strategy_factors[day] - ONE),
            float(benchmark_factors[day] - ONE),
        )
        for day in sorted(strategy_factors)
    )


def simple_to_log(value: float) -> float:
    if not math.isfinite(value) or value <= -1.0:
        raise EvidenceError("daily return cannot be converted to log return")
    return math.log1p(value)


def circular_block_indices(
    length: int,
    block_days: int,
    replicates: int,
    seed: int,
) -> tuple[tuple[int, ...], ...]:
    if length <= 0 or block_days <= 0 or replicates <= 0:
        raise EvidenceError("bootstrap dimensions must be positive")
    rng = random.Random(seed)
    output: list[tuple[int, ...]] = []
    for _ in range(replicates):
        sample: list[int] = []
        while len(sample) < length:
            start = rng.randrange(length)
            sample.extend((start + offset) % length for offset in range(block_days))
        output.append(tuple(sample[:length]))
    return tuple(output)


def percentile(values: Sequence[float], probability: float) -> float:
    if not values or not 0 <= probability <= 1:
        raise EvidenceError("invalid percentile request")
    ordered = sorted(values)
    position = (len(ordered) - 1) * probability
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    fraction = position - lower
    return ordered[lower] * (1 - fraction) + ordered[upper] * fraction


def bootstrap_statistics(
    daily_log_returns: Sequence[float],
    indices: Sequence[Sequence[int]],
) -> Mapping[str, float]:
    if not daily_log_returns:
        raise EvidenceError("bootstrap requires daily returns")
    observed_log = sum(daily_log_returns)
    observed = math.expm1(observed_log)
    sampled = [math.expm1(sum(daily_log_returns[index] for index in sample)) for sample in indices]
    mean_log = sum(daily_log_returns) / len(daily_log_returns)
    centered = [value - mean_log for value in daily_log_returns]
    null_values = [sum(centered[index] for index in sample) for sample in indices]
    p_value = (1 + sum(value >= observed_log for value in null_values)) / (len(indices) + 1)
    return {
        "estimate": observed,
        "lower95": percentile(sampled, 0.05),
        "oneSidedCenteredNullP": p_value,
    }


def holm_adjust(raw_p_values: Mapping[str, float]) -> Mapping[str, float]:
    ordered = sorted(raw_p_values.items(), key=lambda item: (item[1], item[0]))
    count = len(ordered)
    adjusted: dict[str, float] = {}
    running = 0.0
    for index, (trial_id, raw) in enumerate(ordered):
        if not 0 <= raw <= 1 or not math.isfinite(raw):
            raise EvidenceError("Holm input is not a probability")
        running = max(running, min(1.0, (count - index) * raw))
        adjusted[trial_id] = running
    return adjusted


def average_descending_rank(scores: Mapping[str, float], selected_id: str) -> float:
    selected = scores[selected_id]
    better = sum(value > selected for value in scores.values())
    equal = sum(value == selected for value in scores.values())
    return better + (equal + 1) / 2


def pbo_cscv(
    monthly_trial_logs: Mapping[str, Mapping[str, float]],
    blocks: Sequence[str],
) -> Mapping[str, Any]:
    trial_ids = tuple(sorted(monthly_trial_logs))
    if len(trial_ids) != 16 or len(blocks) != 8:
        raise EvidenceError("PBO requires exactly 16 trials and eight blocks")
    splits = tuple(itertools.combinations(range(8), 4))
    if len(splits) != 70:
        raise EvidenceError("PBO did not enumerate all 70 4-vs-4 splits")
    negative = 0
    rows: list[Mapping[str, Any]] = []
    all_indices = set(range(8))
    for train_indices in splits:
        test_indices = tuple(sorted(all_indices - set(train_indices)))
        train_scores = {
            trial_id: sum(monthly_trial_logs[trial_id][blocks[index]] for index in train_indices)
            for trial_id in trial_ids
        }
        champion = min(trial_ids, key=lambda item: (-train_scores[item], item))
        test_scores = {
            trial_id: sum(monthly_trial_logs[trial_id][blocks[index]] for index in test_indices)
            for trial_id in trial_ids
        }
        rank = average_descending_rank(test_scores, champion)
        relative = 1.0 - (rank - 1.0) / (len(trial_ids) - 1.0)
        is_negative = relative <= 0.5
        negative += int(is_negative)
        rows.append(
            {
                "trainBlocks": [blocks[index] for index in train_indices],
                "testBlocks": [blocks[index] for index in test_indices],
                "selectedTrialId": champion,
                "outOfSampleAverageRank": rank,
                "outOfSampleRelativeRank": relative,
                "belowMedian": is_negative,
            }
        )
    return {"splitCount": 70, "belowMedianCount": negative, "pbo": negative / 70, "splits": rows}


def maximum_drawdown_pct(returns: Sequence[float]) -> float:
    nav = 1.0
    peak = 1.0
    maximum = 0.0
    for value in returns:
        nav *= 1.0 + value
        peak = max(peak, nav)
        maximum = max(maximum, (peak - nav) / peak * 100.0)
    return maximum


def _monthly_log_map(
    rows: Sequence[tuple[date, float, float]],
    *,
    benchmark_excess: bool,
) -> Mapping[str, float]:
    output: dict[str, float] = defaultdict(float)
    for day, strategy, benchmark in rows:
        strategy_log = simple_to_log(strategy)
        benchmark_log = simple_to_log(benchmark)
        output[day.strftime("%Y-%m")] += (
            strategy_log - benchmark_log if benchmark_excess else strategy_log
        )
    return output


def summarize_trial(
    observations: Sequence[FormationObservation],
    scenario: Scenario,
    primary_indices: Sequence[Sequence[int]],
    sensitivity_indices: Sequence[Sequence[int]],
) -> Mapping[str, Any]:
    daily = daily_compounded_returns(observations, scenario)
    absolute_logs = [simple_to_log(row[1]) for row in daily]
    excess_logs = [simple_to_log(row[1]) - simple_to_log(row[2]) for row in daily]
    absolute_primary = bootstrap_statistics(absolute_logs, primary_indices)
    excess_primary = bootstrap_statistics(excess_logs, primary_indices)
    absolute_sensitivity = bootstrap_statistics(absolute_logs, sensitivity_indices)
    excess_sensitivity = bootstrap_statistics(excess_logs, sensitivity_indices)
    return {
        "scheduledFormations": len(observations),
        "validFormations": sum(item.active for item in observations),
        "selectedObservations": sum(len(item.selected) for item in observations),
        "minimumEligibleSymbols": min(item.eligible_symbols for item in observations),
        "maximumParticipationBps": float(
            max(item.maximum_participation_bps for item in observations)
        ),
        "dailyObservations": len(daily),
        "absolute7d": absolute_primary,
        "matchedExcess7d": excess_primary,
        "absolute14d": absolute_sensitivity,
        "matchedExcess14d": excess_sensitivity,
        "maximumDrawdownPct": maximum_drawdown_pct([row[1] for row in daily]),
        "daily": [
            {
                "date": row[0].isoformat(),
                "strategyReturn": row[1],
                "benchmarkReturn": row[2],
            }
            for row in daily
        ],
        "monthlyAbsoluteLogReturns": _monthly_log_map(daily, benchmark_excess=False),
    }


def point_summary(
    observations: Sequence[FormationObservation],
    scenario: Scenario,
) -> Mapping[str, Any]:
    daily = daily_compounded_returns(observations, scenario)
    absolute_log = sum(simple_to_log(row[1]) for row in daily)
    excess_log = sum(simple_to_log(row[1]) - simple_to_log(row[2]) for row in daily)
    return {
        "absoluteReturn": math.expm1(absolute_log),
        "matchedExcessReturn": math.expm1(excess_log),
        "maximumDrawdownPct": maximum_drawdown_pct([row[1] for row in daily]),
    }


def gate_trial(
    summary: Mapping[str, Any],
    adjusted_absolute_p: float,
    adjusted_excess_p: float,
    pbo: float,
    gate: Mapping[str, Any],
    *,
    development: bool,
) -> tuple[Mapping[str, Any], ...]:
    decisions: list[Mapping[str, Any]] = []

    def decide(name: str, value: float | int, rule: str, passed: bool) -> None:
        decisions.append({"gate": name, "value": value, "rule": rule, "pass": passed})

    decide(
        "minimumValidFormations",
        int(summary["validFormations"]),
        f">={int(gate['minimumValidFormations'])}",
        int(summary["validFormations"]) >= int(gate["minimumValidFormations"]),
    )
    decide(
        "minimumSelectedObservations",
        int(summary["selectedObservations"]),
        f">={int(gate['minimumSelectedObservations'])}",
        int(summary["selectedObservations"]) >= int(gate["minimumSelectedObservations"]),
    )
    decide(
        "minimumEligibleSymbolsEachFormation",
        int(summary["minimumEligibleSymbols"]),
        f">={int(gate['minimumEligibleSymbolsEachFormation'])}",
        int(summary["minimumEligibleSymbols"]) >= int(gate["minimumEligibleSymbolsEachFormation"]),
    )
    for key, label in (
        ("absolute7d", "feeStressAbsolute7dLcb"),
        ("matchedExcess7d", "feeStressMatchedExcess7dLcb"),
        ("absolute14d", "feeStressAbsolute14dLcb"),
        ("matchedExcess14d", "feeStressMatchedExcess14dLcb"),
    ):
        value = float(require_mapping(summary[key], key)["lower95"])
        decide(label, value, ">0", value > 0)
    drawdown = float(summary["maximumDrawdownPct"])
    drawdown_limit = float(gate["maximumDrawdownPctInclusive"])
    decide("maximumDrawdownPct", drawdown, f"<={drawdown_limit}", drawdown <= drawdown_limit)
    participation = float(summary["maximumParticipationBps"])
    participation_limit = float(gate["maximumPublicParticipationBpsInclusive"])
    decide(
        "maximumPublicParticipationBps",
        participation,
        f"<={participation_limit}",
        participation <= participation_limit,
    )
    if development:
        absolute_limit = float(gate["holmAbsoluteMaximumInclusive"])
        excess_limit = float(gate["holmMatchedExcessMaximumInclusive"])
        pbo_limit = float(gate["pboMaximumInclusive"])
        decide(
            "holmAbsolute",
            adjusted_absolute_p,
            f"<={absolute_limit}",
            adjusted_absolute_p <= absolute_limit,
        )
        decide(
            "holmMatchedExcess",
            adjusted_excess_p,
            f"<={excess_limit}",
            adjusted_excess_p <= excess_limit,
        )
        decide("pbo", pbo, f"<={pbo_limit}", pbo <= pbo_limit)
    return tuple(decisions)


def select_development_champion(
    passing_trial_ids: Sequence[str],
    trial_results: Mapping[str, Mapping[str, Any]],
    specs: Mapping[str, TrialSpec],
) -> str | None:
    def champion_key(trial_id: str) -> tuple[Any, ...]:
        result = trial_results[trial_id]
        spec = specs[trial_id]
        return (
            -float(require_mapping(result["matchedExcess7d"], "matchedExcess7d")["lower95"]),
            -float(require_mapping(result["absolute7d"], "absolute7d")["lower95"]),
            -float(require_mapping(result["matchedExcess14d"], "matchedExcess14d")["lower95"]),
            float(result["maximumDrawdownPct"]),
            spec.days,
            -spec.persistence,
            spec.top_k,
            spec.holding_hours,
            trial_id,
        )

    if not passing_trial_ids:
        return None
    unknown = set(passing_trial_ids) - set(specs)
    if unknown:
        raise EvidenceError(f"passing trials outside frozen family: {sorted(unknown)}")
    return min(passing_trial_ids, key=champion_key)


def analyze_development_family(
    observations_by_trial: Mapping[str, Sequence[FormationObservation]],
    protocol: Mapping[str, Any],
) -> Mapping[str, Any]:
    specs = {spec.trial_id: spec for spec in trial_specs(protocol)}
    if set(observations_by_trial) != set(specs):
        raise EvidenceError("development observations do not cover exact 16-trial family")
    fee_stress = next(item for item in scenarios(protocol) if item.name == "FEE_STRESS")
    all_scenarios = scenarios(protocol)
    statistics_protocol = require_mapping(protocol["statistics"], "statistics")
    bootstrap = require_mapping(statistics_protocol["bootstrap"], "bootstrap")
    replicates = int(bootstrap["replicates"])
    seed = int(bootstrap["seed"])
    first_id = min(observations_by_trial)
    first_daily = daily_compounded_returns(observations_by_trial[first_id], fee_stress)
    length = len(first_daily)
    primary_indices = circular_block_indices(
        length, int(bootstrap["primaryBlockDays"]), replicates, seed
    )
    sensitivity_indices = circular_block_indices(
        length, int(bootstrap["sensitivityBlockDays"]), replicates, seed + 1
    )
    trial_results: dict[str, dict[str, Any]] = {}
    absolute_raw: dict[str, float] = {}
    excess_raw: dict[str, float] = {}
    monthly: dict[str, Mapping[str, float]] = {}
    for trial_id in sorted(observations_by_trial):
        detailed = dict(
            summarize_trial(
                observations_by_trial[trial_id],
                fee_stress,
                primary_indices,
                sensitivity_indices,
            )
        )
        if int(detailed["dailyObservations"]) != length:
            raise EvidenceError("trial daily paths are not synchronous")
        detailed["scenarioPoints"] = {
            scenario.name: point_summary(observations_by_trial[trial_id], scenario)
            for scenario in all_scenarios
        }
        trial_results[trial_id] = detailed
        absolute_raw[trial_id] = float(
            require_mapping(detailed["absolute7d"], "absolute7d")["oneSidedCenteredNullP"]
        )
        excess_raw[trial_id] = float(
            require_mapping(detailed["matchedExcess7d"], "matchedExcess7d")["oneSidedCenteredNullP"]
        )
        monthly[trial_id] = require_mapping(
            detailed["monthlyAbsoluteLogReturns"], "monthlyAbsoluteLogReturns"
        )
    absolute_adjusted = holm_adjust(absolute_raw)
    excess_adjusted = holm_adjust(excess_raw)
    pbo_protocol = require_mapping(statistics_protocol["pbo"], "pbo")
    blocks = tuple(
        require_text(item, "PBO block")
        for item in require_list(pbo_protocol["blocks"], "PBO blocks")
    )
    for trial_id, values in monthly.items():
        missing = [block for block in blocks if block not in values]
        if missing:
            raise EvidenceError(f"{trial_id} missing full PBO blocks: {missing}")
    pbo = pbo_cscv(monthly, blocks)
    gate = require_mapping(require_mapping(protocol["gates"], "gates")["development"], "dev gate")
    passing: list[str] = []
    for trial_id in sorted(trial_results):
        result = trial_results[trial_id]
        result["holmAbsoluteP"] = absolute_adjusted[trial_id]
        result["holmMatchedExcessP"] = excess_adjusted[trial_id]
        decisions = gate_trial(
            result,
            absolute_adjusted[trial_id],
            excess_adjusted[trial_id],
            float(pbo["pbo"]),
            gate,
            development=True,
        )
        result["gates"] = list(decisions)
        result["passesDevelopment"] = all(item["pass"] for item in decisions)
        if result["passesDevelopment"]:
            passing.append(trial_id)

    champion = select_development_champion(passing, trial_results, specs)
    return {
        "schema": "VG10DevelopmentAnalysisV1",
        "primaryScenario": "FEE_STRESS",
        "trialCount": 16,
        "trials": trial_results,
        "holmAbsolute": absolute_adjusted,
        "holmMatchedExcess": excess_adjusted,
        "pbo": pbo,
        "passingTrialIds": sorted(passing),
        "championTrialId": champion,
        "developmentGatesPass": champion is not None,
        "globalSiblingCampaignMultiplicity": "UNKNOWN_UNADJUSTED",
    }


def analyze_holdout(
    observations: Sequence[FormationObservation],
    spec: TrialSpec,
    protocol: Mapping[str, Any],
) -> Mapping[str, Any]:
    fee_stress = next(item for item in scenarios(protocol) if item.name == "FEE_STRESS")
    bootstrap = require_mapping(
        require_mapping(protocol["statistics"], "statistics")["bootstrap"], "bootstrap"
    )
    daily = daily_compounded_returns(observations, fee_stress)
    length = len(daily)
    primary = circular_block_indices(
        length,
        int(bootstrap["primaryBlockDays"]),
        int(bootstrap["replicates"]),
        int(bootstrap["seed"]) + 2,
    )
    sensitivity = circular_block_indices(
        length,
        int(bootstrap["sensitivityBlockDays"]),
        int(bootstrap["replicates"]),
        int(bootstrap["seed"]) + 3,
    )
    detailed = dict(summarize_trial(observations, fee_stress, primary, sensitivity))
    detailed["scenarioPoints"] = {
        scenario.name: point_summary(observations, scenario) for scenario in scenarios(protocol)
    }
    gate = require_mapping(require_mapping(protocol["gates"], "gates")["holdout"], "holdout gate")
    decisions = gate_trial(detailed, 0.0, 0.0, 0.0, gate, development=False)
    detailed.update(
        {
            "schema": "VG10HoldoutAnalysisV1",
            "trialId": spec.trial_id,
            "gates": list(decisions),
            "holdoutGatesPass": all(item["pass"] for item in decisions),
        }
    )
    return detailed


def validate_external_state_dir(state_dir: Path) -> Path:
    resolved = state_dir.expanduser().resolve()
    if resolved == REPOSITORY_ROOT or REPOSITORY_ROOT in resolved.parents:
        raise LifecycleError("--state-dir must be external to the repository")
    if resolved == Path("/") or len(resolved.parts) < 3:
        raise LifecycleError("--state-dir target is too broad")
    return resolved


def write_exclusive(path: Path, raw: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError as exc:
        raise LifecycleError(f"refusing to overwrite {path.name}") from exc
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
    except BaseException:
        try:
            path.unlink(missing_ok=True)
        finally:
            raise


def write_json_exclusive(path: Path, value: Mapping[str, Any]) -> None:
    write_exclusive(path, canonical_bytes(value))


def packet_manifest() -> Mapping[str, Any]:
    files: list[Mapping[str, Any]] = []
    for name in STATIC_PACKET_NAMES:
        path = PACKET_DIR / name
        if not path.is_file():
            raise EvidenceError(f"static packet file missing: {name}")
        raw = path.read_bytes()
        files.append({"path": name, "byteLength": len(raw), "sha256": sha256_bytes(raw)})
    return {
        "schema": "VG10PacketManifestV1",
        "files": files,
        "aggregateSha256": sha256_bytes(canonical_bytes(files)),
    }


def source_freeze(state_dir: Path, *, now: datetime) -> Mapping[str, Any]:
    state = validate_external_state_dir(state_dir)
    state.mkdir(parents=True, exist_ok=True)
    if any(state.iterdir()):
        raise LifecycleError("source-freeze requires a new empty state directory")
    protocol = load_protocol()
    payload = {
        "schema": "VG10SourceFreezeV1",
        "createdAtUtc": utc_text(now),
        "protocolId": protocol["protocolId"],
        "canonicalBaseCommit": protocol["canonicalBaseCommit"],
        "packetManifest": packet_manifest(),
        "outcomesOpened": False,
        "archivesOpened": False,
        "holdoutBytesRequestedOrRead": False,
    }
    write_json_exclusive(state / "source-freeze.v1.json", payload)
    return payload


def verify_source_freeze(state: Path) -> Mapping[str, Any]:
    payload = read_json(state / "source-freeze.v1.json")
    if payload.get("schema") != "VG10SourceFreezeV1":
        raise EvidenceError("source-freeze schema mismatch")
    protocol = load_protocol()
    if payload.get("protocolId") != protocol.get("protocolId"):
        raise EvidenceError("source-freeze protocol identity mismatch")
    if payload.get("canonicalBaseCommit") != protocol.get("canonicalBaseCommit"):
        raise EvidenceError("source-freeze base-commit binding mismatch")
    if payload.get("packetManifest") != packet_manifest():
        raise EvidenceError("static packet changed after source-freeze")
    if (
        payload.get("outcomesOpened") is not False
        or payload.get("archivesOpened") is not False
        or payload.get("holdoutBytesRequestedOrRead") is not False
    ):
        raise EvidenceError("source-freeze outcome declaration drift")
    return payload


def terminal_result_payload(
    verdict: str,
    reason_code: str,
    *,
    now: datetime,
    evidence: Mapping[str, Any] | None = None,
) -> Mapping[str, Any]:
    if verdict not in VERDICTS:
        raise EvidenceError("terminal verdict vocabulary violation")
    return {
        "schema": "VG10TerminalResultV1",
        "completedAtUtc": utc_text(now),
        "researchVerdict": verdict,
        "capitalVerdict": "NO_GO",
        "executionAuthority": "NONE",
        "reasonCode": reason_code,
        "evidence": dict(evidence or {}),
        "globalSiblingCampaignMultiplicity": "UNKNOWN_UNADJUSTED",
        "accountEffectiveFees": "UNKNOWN",
        "executableCapacity": "UNMEASURED",
        "usdtEqualsUsd": "UNPROVEN_REPORTING_CONVENTION",
    }


def write_terminal_result(
    state: Path,
    verdict: str,
    reason_code: str,
    *,
    now: datetime,
    evidence: Mapping[str, Any] | None = None,
) -> Mapping[str, Any]:
    payload = terminal_result_payload(verdict, reason_code, now=now, evidence=evidence)
    write_json_exclusive(state / "result.v1.json", payload)
    return payload


def consume_marker(
    state: Path,
    name: str,
    payload: Mapping[str, Any],
    *,
    now: datetime,
) -> None:
    path = state / name
    if path.exists():
        if not (state / "result.v1.json").exists():
            write_terminal_result(
                state,
                "UNMEASURED",
                f"PREEXISTING_{name.upper().replace('.', '_').replace('-', '_')}",
                now=now,
            )
        raise LifecycleError(f"pre-existing lifecycle marker: {name}")
    write_json_exclusive(path, payload)


def cohort_freeze(
    state_dir: Path,
    daily_source_root: Path,
    *,
    now: datetime,
) -> Mapping[str, Any]:
    state = validate_external_state_dir(state_dir)
    source = verify_source_freeze(state)
    protocol = load_protocol()
    if (state / "result.v1.json").exists():
        raise LifecycleError("experiment is already terminal")
    resolved_source = daily_source_root.expanduser().resolve()
    if (
        resolved_source == state
        or state in resolved_source.parents
        or resolved_source in state.parents
    ):
        raise LifecycleError("daily source root and external state directory must be disjoint")
    consume_marker(
        state,
        "cohort-freeze-start.v1.json",
        {
            "schema": "VG10CohortFreezeStartV1",
            "startedAtUtc": utc_text(now),
            "sourceFreezeSha256": sha256_path(state / "source-freeze.v1.json"),
            "protocolSha256": sha256_path(PROTOCOL_PATH),
            "packetAggregateSha256": require_mapping(source["packetManifest"], "packetManifest")[
                "aggregateSha256"
            ],
        },
        now=now,
    )
    try:
        payload = build_static_cohort(resolved_source, protocol, frozen_at=now)
        write_json_exclusive(state / "cohort.v1.json", payload)
        return payload
    except BaseException as exc:
        if not (state / "result.v1.json").exists():
            write_terminal_result(
                state,
                "UNMEASURED",
                getattr(exc, "code", "COHORT_FREEZE_FAILED"),
                now=now,
                evidence={"message": str(exc)},
            )
        raise


def load_cohort(state: Path) -> Mapping[str, Any]:
    cohort = read_json(state / "cohort.v1.json")
    if cohort.get("schema") != "VG10StaticCohortV1":
        raise EvidenceError("cohort schema mismatch")
    symbols = [
        require_text(item, "selected symbol")
        for item in require_list(cohort.get("selectedSymbols"), "selectedSymbols")
    ]
    ranking = require_list(cohort.get("ranking"), "ranking")
    try:
        rows = [require_mapping(item, "ranking row") for item in ranking]
        ranked_rows = sorted(rows, key=lambda item: int(item["rank"]))
        ranks = [int(item["rank"]) for item in ranked_rows]
        ranked = [require_text(item["symbol"], "ranked symbol") for item in ranked_rows]
    except (KeyError, TypeError, ValueError) as exc:
        raise EvidenceError("cohort ranking rows malformed") from exc
    if (
        symbols != ranked
        or ranks != list(range(1, 41))
        or len(symbols) != 40
        or len(set(symbols)) != 40
        or any(SYMBOL_RE.fullmatch(symbol) is None for symbol in symbols)
    ):
        raise EvidenceError("cohort selected/ranking identity mismatch")
    return cohort


def validate_cohort_chain(
    state: Path,
    protocol: Mapping[str, Any] | None = None,
) -> Mapping[str, Any]:
    active_protocol = protocol if protocol is not None else load_protocol()
    source = verify_source_freeze(state)
    marker = read_json(state / "cohort-freeze-start.v1.json")
    if marker.get("schema") != "VG10CohortFreezeStartV1":
        raise EvidenceError("cohort-freeze marker schema mismatch")
    if marker.get("sourceFreezeSha256") != sha256_path(state / "source-freeze.v1.json"):
        raise EvidenceError("cohort-freeze source binding mismatch")
    if marker.get("protocolSha256") != sha256_path(PROTOCOL_PATH):
        raise EvidenceError("cohort-freeze protocol binding mismatch")
    if (
        marker.get("packetAggregateSha256")
        != require_mapping(source["packetManifest"], "packetManifest")["aggregateSha256"]
    ):
        raise EvidenceError("cohort-freeze packet binding mismatch")
    cohort = load_cohort(state)
    if cohort.get("protocolSha256") != sha256_path(PROTOCOL_PATH):
        raise EvidenceError("cohort protocol binding mismatch")
    if cohort.get("sourceMode") != "READ_ONLY":
        raise EvidenceError("cohort source mode must remain READ_ONLY")
    if (
        cohort.get("currentExchangeInfoUsed") is not False
        or cohort.get("futureStatusFilterUsed") is not False
    ):
        raise EvidenceError("cohort contains a forbidden current/future status filter")
    if active_protocol.get("protocolId") != load_protocol().get("protocolId"):
        raise EvidenceError("cohort validator protocol identity mismatch")
    return cohort


def _single_offline_path(root: Path, name: str) -> Path:
    matches = sorted(path for path in root.rglob(name) if path.is_file())
    if len(matches) != 1:
        raise EvidenceError(f"offline source must contain exactly one {name}; found {len(matches)}")
    return matches[0]


class _NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(
        self,
        req: urllib.request.Request,
        fp: Any,
        code: int,
        msg: str,
        headers: Any,
        newurl: str,
    ) -> urllib.request.Request | None:
        del req, fp, code, msg, headers, newurl
        raise EvidenceError("public archive redirects are forbidden")


def _validate_public_archive_url(url: str) -> None:
    try:
        parsed = urllib.parse.urlsplit(url)
        port = parsed.port
    except ValueError as exc:
        raise EvidenceError("public archive URL is malformed") from exc
    path = PurePosixPath(parsed.path)
    if (
        parsed.scheme != "https"
        or parsed.netloc != "data.binance.vision"
        or port is not None
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
        or not parsed.path.startswith("/data/spot/monthly/klines/")
        or "." in path.parts
        or ".." in path.parts
        or "%" in parsed.path
        or "\\" in parsed.path
    ):
        raise EvidenceError("public archive URL authority/path is not frozen Binance HTTPS")


def _read_bounded(response: Any, maximum_bytes: int) -> bytes:
    if maximum_bytes <= 0:
        raise EvidenceError("HTTP byte cap must be positive")
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = response.read(min(64 * 1024, maximum_bytes - total + 1))
        if not isinstance(chunk, bytes):
            raise EvidenceError("HTTP response returned non-byte data")
        if not chunk:
            break
        total += len(chunk)
        if total > maximum_bytes:
            raise EvidenceError("public archive response exceeds frozen byte cap")
        chunks.append(chunk)
    return b"".join(chunks)


def _http_get(url: str, *, maximum_bytes: int) -> tuple[bytes, Mapping[str, Any]]:
    _validate_public_archive_url(url)
    request = urllib.request.Request(url, method="GET", headers={"User-Agent": "cosmos-vg10/1"})
    opener = urllib.request.build_opener(_NoRedirectHandler())
    try:
        with opener.open(request, timeout=30) as response:
            final_url = response.geturl()
            if final_url != url:
                raise EvidenceError("public archive final URL differs from requested URL")
            _validate_public_archive_url(final_url)
            raw = _read_bounded(response, maximum_bytes)
            return raw, {
                "status": int(response.status),
                "etag": response.headers.get("ETag"),
                "lastModified": response.headers.get("Last-Modified"),
                "finalUrl": final_url,
            }
    except EvidenceError:
        raise
    except Exception as exc:
        raise EvidenceError(f"public archive request failed: {url}: {exc}") from exc


def _acquire_one(
    *,
    symbol: str,
    month: str,
    state: Path,
    phase: str,
    protocol: Mapping[str, Any],
    retrieval_time: datetime,
    offline_source: Path | None,
    network: bool,
) -> Mapping[str, Any]:
    data = require_mapping(protocol["data"], "data")
    zip_name = f"{symbol}-15m-{month}.zip"
    sidecar_name = zip_name + ".CHECKSUM"
    url = require_text(data["archiveTemplate"], "archiveTemplate").format(
        symbol=symbol, month=month
    )
    sidecar_url = require_text(data["sidecarTemplate"], "sidecarTemplate").format(
        symbol=symbol, month=month
    )
    sidecar_metadata: Mapping[str, Any]
    zip_metadata: Mapping[str, Any]
    if offline_source is not None:
        sidecar_path = _single_offline_path(offline_source, sidecar_name)
        archive_path = _single_offline_path(offline_source, zip_name)
        sidecar_bytes = sidecar_path.read_bytes()
        zip_bytes = archive_path.read_bytes()
        sidecar_metadata = {"status": 200, "etag": None, "lastModified": None}
        zip_metadata = {"status": 200, "etag": None, "lastModified": None}
        transport = "OFFLINE_EXPLICIT"
    elif network:
        sidecar_bytes, sidecar_metadata = _http_get(sidecar_url, maximum_bytes=4096)
        zip_bytes, zip_metadata = _http_get(url, maximum_bytes=256 * 1024 * 1024)
        transport = "PUBLIC_HTTPS"
    else:
        raise LifecycleError("acquisition requires --offline-source or explicit --network")
    if sidecar_metadata["status"] != 200 or zip_metadata["status"] != 200:
        raise EvidenceError("archive acquisition status is not 200")
    expected = parse_checksum_sidecar(sidecar_bytes, zip_name)
    observed = sha256_bytes(zip_bytes)
    if expected != observed:
        raise EvidenceError(f"{zip_name} observed SHA does not match sidecar")
    destination = state / "archives" / phase / symbol
    write_exclusive(destination / sidecar_name, sidecar_bytes)
    write_exclusive(destination / zip_name, zip_bytes)
    return {
        "symbol": symbol,
        "month": month,
        "url": url,
        "sidecarUrl": sidecar_url,
        "retrievalUtc": utc_text(retrieval_time),
        "transport": transport,
        "status": {"sidecar": sidecar_metadata["status"], "zip": zip_metadata["status"]},
        "byteLength": {"sidecar": len(sidecar_bytes), "zip": len(zip_bytes)},
        "etag": {"sidecar": sidecar_metadata["etag"], "zip": zip_metadata["etag"]},
        "lastModified": {
            "sidecar": sidecar_metadata["lastModified"],
            "zip": zip_metadata["lastModified"],
        },
        "checksumBytesSha256": sha256_bytes(sidecar_bytes),
        "expectedZipSha256": expected,
        "observedZipSha256": observed,
        "sidecarStateRelativePath": (destination / sidecar_name).relative_to(state).as_posix(),
        "zipStateRelativePath": (destination / zip_name).relative_to(state).as_posix(),
    }


def acquire_archives(
    state_dir: Path,
    phase: str,
    *,
    now: datetime,
    offline_source: Path | None,
    network: bool,
) -> Mapping[str, Any]:
    if phase not in {"development", "holdout"}:
        raise LifecycleError("acquisition phase must be development or holdout")
    if (offline_source is None) == (not network):
        raise LifecycleError("choose exactly one of --offline-source or --network")
    state = validate_external_state_dir(state_dir)
    verify_source_freeze(state)
    if (state / "result.v1.json").exists():
        raise LifecycleError("experiment is already terminal")
    protocol = load_protocol()
    cohort = validate_cohort_chain(state, protocol)
    if phase == "holdout":
        # These checks intentionally precede any offline path traversal or HTTP request.
        if not (state / "candidate-seal.v1.json").is_file():
            raise LifecycleError("holdout acquisition refused before candidate seal")
        if not (state / "holdout-open.v1.json").is_file():
            raise LifecycleError("holdout acquisition refused before holdout-open marker")
        validate_holdout_open_chain(state)
    data = require_mapping(protocol["data"], "data")
    month_key = "developmentMonthsInclusive" if phase == "development" else "holdoutMonthsInclusive"
    bounds = require_list(data[month_key], month_key)
    months = month_range(require_text(bounds[0], month_key), require_text(bounds[1], month_key))
    marker_name = f"acquire-{phase}-start.v1.json"
    consume_marker(
        state,
        marker_name,
        {
            "schema": f"VG10Acquire{phase.title()}StartV1",
            "startedAtUtc": utc_text(now),
            "network": network,
            "offline": offline_source is not None,
            "protocolSha256": sha256_path(PROTOCOL_PATH),
            "cohortSha256": sha256_path(state / "cohort.v1.json"),
            "candidateSealSha256": (
                sha256_path(state / "candidate-seal.v1.json") if phase == "holdout" else None
            ),
            "holdoutOpenSha256": (
                sha256_path(state / "holdout-open.v1.json") if phase == "holdout" else None
            ),
        },
        now=now,
    )
    try:
        records = [
            _acquire_one(
                symbol=require_text(symbol, "cohort symbol"),
                month=month,
                state=state,
                phase=phase,
                protocol=protocol,
                retrieval_time=now,
                offline_source=offline_source.expanduser().resolve()
                if offline_source is not None
                else None,
                network=network,
            )
            for symbol in require_list(cohort["selectedSymbols"], "selectedSymbols")
            for month in months
        ]
        payload = {
            "schema": f"VG10{phase.title()}AcquisitionManifestV1",
            "phase": phase,
            "createdAtUtc": utc_text(now),
            "protocolSha256": sha256_path(PROTOCOL_PATH),
            "cohortSha256": sha256_path(state / "cohort.v1.json"),
            "symbolCount": 40,
            "months": list(months),
            "archiveCount": len(records),
            "records": records,
        }
        write_json_exclusive(state / f"acquisition-{phase}.v1.json", payload)
        return payload
    except BaseException as exc:
        if not (state / "result.v1.json").exists():
            write_terminal_result(
                state,
                "UNMEASURED",
                getattr(exc, "code", f"{phase.upper()}_ACQUISITION_FAILED"),
                now=now,
                evidence={"message": str(exc), "phase": phase},
            )
        raise


def _phase_months(protocol: Mapping[str, Any], phase: str) -> tuple[str, ...]:
    if phase not in {"development", "holdout"}:
        raise EvidenceError("acquisition phase is not closed")
    data = require_mapping(protocol["data"], "data")
    month_key = "developmentMonthsInclusive" if phase == "development" else "holdoutMonthsInclusive"
    bounds = require_list(data[month_key], month_key)
    if len(bounds) != 2:
        raise EvidenceError(f"{phase} protocol month bounds malformed")
    return month_range(require_text(bounds[0], month_key), require_text(bounds[1], month_key))


def _validated_state_file(state: Path, relative_text: str, expected_text: str) -> Path:
    pure = PurePosixPath(relative_text)
    if pure.is_absolute() or ".." in pure.parts or "." in pure.parts:
        raise EvidenceError("acquisition path is absolute or escapes state")
    if pure.as_posix() != expected_text:
        raise EvidenceError("acquisition path does not match frozen inventory")
    path = state.joinpath(*pure.parts)
    archive_root = state / "archives"
    current = path
    while current != state:
        if current.is_symlink():
            raise EvidenceError("acquisition path contains a symlink")
        if state not in current.parents:
            raise EvidenceError("acquisition path escapes state")
        current = current.parent
    if path.is_symlink():
        raise EvidenceError("acquisition path contains a symlink")
    if not path.is_file():
        raise EvidenceError(f"acquisition file missing: {relative_text}")
    if not path.resolve().is_relative_to(archive_root.resolve()):
        raise EvidenceError("acquisition file resolves outside state archive root")
    return path


def validate_acquisition_manifest(
    state: Path,
    phase: str,
    protocol: Mapping[str, Any] | None = None,
    cohort: Mapping[str, Any] | None = None,
) -> tuple[Mapping[str, Any], tuple[Mapping[str, Any], ...]]:
    active_protocol = protocol if protocol is not None else load_protocol()
    active_cohort = cohort if cohort is not None else validate_cohort_chain(state, active_protocol)
    months = _phase_months(active_protocol, phase)
    symbols = tuple(
        require_text(item, "cohort symbol")
        for item in require_list(active_cohort["selectedSymbols"], "selectedSymbols")
    )
    marker = read_json(state / f"acquire-{phase}-start.v1.json")
    if marker.get("schema") != f"VG10Acquire{phase.title()}StartV1":
        raise EvidenceError(f"{phase} acquisition-start schema mismatch")
    if marker.get("protocolSha256") != sha256_path(PROTOCOL_PATH):
        raise EvidenceError(f"{phase} acquisition-start protocol binding mismatch")
    if marker.get("cohortSha256") != sha256_path(state / "cohort.v1.json"):
        raise EvidenceError(f"{phase} acquisition-start cohort binding mismatch")
    if bool(marker.get("network")) == bool(marker.get("offline")):
        raise EvidenceError(f"{phase} acquisition-start transport declaration mismatch")
    expected_transport = "PUBLIC_HTTPS" if marker.get("network") is True else "OFFLINE_EXPLICIT"
    if phase == "holdout":
        candidate, holdout_open = validate_holdout_open_chain(state)
        if marker.get("candidateSealSha256") != sha256_path(state / "candidate-seal.v1.json"):
            raise EvidenceError("holdout acquisition-start candidate binding mismatch")
        if marker.get("holdoutOpenSha256") != sha256_path(state / "holdout-open.v1.json"):
            raise EvidenceError("holdout acquisition-start open binding mismatch")
        if candidate.get("championTrialId") != holdout_open.get("championTrialId"):
            raise EvidenceError("holdout acquisition-start champion mismatch")
    elif (
        marker.get("candidateSealSha256") is not None or marker.get("holdoutOpenSha256") is not None
    ):
        raise EvidenceError("development acquisition-start contains holdout bindings")
    manifest = read_json(state / f"acquisition-{phase}.v1.json")
    if manifest.get("schema") != f"VG10{phase.title()}AcquisitionManifestV1":
        raise EvidenceError(f"{phase} acquisition schema mismatch")
    if manifest.get("phase") != phase:
        raise EvidenceError(f"{phase} acquisition phase mismatch")
    if manifest.get("protocolSha256") != sha256_path(PROTOCOL_PATH):
        raise EvidenceError(f"{phase} acquisition protocol binding mismatch")
    if manifest.get("cohortSha256") != sha256_path(state / "cohort.v1.json"):
        raise EvidenceError(f"{phase} acquisition cohort binding mismatch")
    if manifest.get("symbolCount") != 40 or manifest.get("months") != list(months):
        raise EvidenceError(f"{phase} acquisition declared inventory mismatch")
    expected_keys = {(symbol, month) for symbol in symbols for month in months}
    if manifest.get("archiveCount") != len(expected_keys):
        raise EvidenceError(f"{phase} acquisition count mismatch")
    raw_records = require_list(manifest.get("records"), "records")
    if len(raw_records) != len(expected_keys):
        raise EvidenceError(f"{phase} acquisition record count mismatch")
    records: list[Mapping[str, Any]] = []
    actual_keys: set[tuple[str, str]] = set()
    data = require_mapping(active_protocol["data"], "data")
    for raw_record in raw_records:
        record = require_mapping(raw_record, "acquisition record")
        symbol = require_text(record.get("symbol"), "record symbol")
        month = require_text(record.get("month"), "record month")
        key = (symbol, month)
        if key not in expected_keys or key in actual_keys:
            raise EvidenceError(f"{phase} acquisition duplicate/unexpected record {key}")
        actual_keys.add(key)
        zip_name = f"{symbol}-15m-{month}.zip"
        sidecar_name = zip_name + ".CHECKSUM"
        expected_root = PurePosixPath("archives", phase, symbol)
        zip_relative = require_text(record.get("zipStateRelativePath"), "ZIP relative path")
        sidecar_relative = require_text(
            record.get("sidecarStateRelativePath"), "sidecar relative path"
        )
        zip_path = _validated_state_file(state, zip_relative, (expected_root / zip_name).as_posix())
        sidecar_path = _validated_state_file(
            state, sidecar_relative, (expected_root / sidecar_name).as_posix()
        )
        expected_url = require_text(data["archiveTemplate"], "archiveTemplate").format(
            symbol=symbol, month=month
        )
        expected_sidecar_url = require_text(data["sidecarTemplate"], "sidecarTemplate").format(
            symbol=symbol, month=month
        )
        if record.get("url") != expected_url or record.get("sidecarUrl") != expected_sidecar_url:
            raise EvidenceError(f"{phase} acquisition URL binding mismatch")
        if record.get("transport") != expected_transport:
            raise EvidenceError(f"{phase} acquisition transport mismatch")
        _validate_public_archive_url(expected_url)
        _validate_public_archive_url(expected_sidecar_url)
        zip_bytes = zip_path.read_bytes()
        sidecar_bytes = sidecar_path.read_bytes()
        observed_zip_sha = sha256_bytes(zip_bytes)
        sidecar_sha = sha256_bytes(sidecar_bytes)
        expected_zip_sha = parse_checksum_sidecar(sidecar_bytes, zip_name)
        if (
            record.get("checksumBytesSha256") != sidecar_sha
            or record.get("expectedZipSha256") != expected_zip_sha
            or record.get("observedZipSha256") != observed_zip_sha
            or expected_zip_sha != observed_zip_sha
        ):
            raise EvidenceError(f"{phase} acquisition checksum relation mismatch")
        byte_length = require_mapping(record.get("byteLength"), "byteLength")
        if byte_length.get("sidecar") != len(sidecar_bytes) or byte_length.get("zip") != len(
            zip_bytes
        ):
            raise EvidenceError(f"{phase} acquisition byte-length mismatch")
        status = require_mapping(record.get("status"), "status")
        if status.get("sidecar") != 200 or status.get("zip") != 200:
            raise EvidenceError(f"{phase} acquisition status mismatch")
        _parse_protocol_time(require_text(record.get("retrievalUtc"), "retrievalUtc"))
        etag = require_mapping(record.get("etag"), "etag")
        last_modified = require_mapping(record.get("lastModified"), "lastModified")
        if set(etag) != {"sidecar", "zip"} or set(last_modified) != {"sidecar", "zip"}:
            raise EvidenceError(f"{phase} acquisition HTTP metadata shape mismatch")
        if any(
            value is not None and not isinstance(value, str)
            for value in (*etag.values(), *last_modified.values())
        ):
            raise EvidenceError(f"{phase} acquisition HTTP metadata value mismatch")
        records.append(record)
    if actual_keys != expected_keys:
        raise EvidenceError(f"{phase} acquisition exact inventory mismatch")
    records.sort(key=lambda item: (str(item["symbol"]), str(item["month"])))
    return manifest, tuple(records)


def load_acquired_bars(
    state: Path,
    phase: str,
    symbols: Sequence[str],
) -> tuple[Mapping[str, Mapping[datetime, KlineBar]], int]:
    protocol = load_protocol()
    cohort = validate_cohort_chain(state, protocol)
    expected_symbols = tuple(
        require_text(item, "cohort symbol")
        for item in require_list(cohort["selectedSymbols"], "selectedSymbols")
    )
    if tuple(symbols) != expected_symbols:
        raise EvidenceError(f"{phase} caller symbol inventory differs from bound cohort")
    _manifest, records = validate_acquisition_manifest(state, phase, protocol, cohort)
    output: dict[str, dict[datetime, KlineBar]] = {symbol: {} for symbol in symbols}
    loaded_archive_bodies = 0
    for record in records:
        symbol = require_text(record["symbol"], "symbol")
        month = require_text(record["month"], "month")
        zip_path = state / require_text(record["zipStateRelativePath"], "zip path")
        sidecar_path = state / require_text(record["sidecarStateRelativePath"], "sidecar path")
        zip_bytes = zip_path.read_bytes()
        sidecar_bytes = sidecar_path.read_bytes()
        if sha256_bytes(zip_bytes) != record["observedZipSha256"]:
            raise EvidenceError(f"{symbol} {month} stored ZIP hash drift")
        if sha256_bytes(sidecar_bytes) != record["checksumBytesSha256"]:
            raise EvidenceError(f"{symbol} {month} stored sidecar hash drift")
        bars, _duplicates = parse_kline_archive(
            zip_bytes,
            sidecar_bytes,
            symbol=symbol,
            month=month,
            interval="15m",
            collapse_identical_duplicates=False,
        )
        merge_bar_maps(output[symbol], bars, collapse_identical_duplicates=False)
        loaded_archive_bodies += 1
    return output, loaded_archive_bodies


def merge_symbol_bars(
    first: Mapping[str, Mapping[datetime, KlineBar]],
    second: Mapping[str, Mapping[datetime, KlineBar]],
) -> Mapping[str, Mapping[datetime, KlineBar]]:
    symbols = sorted(set(first) | set(second))
    output: dict[str, dict[datetime, KlineBar]] = {}
    for symbol in symbols:
        merged = dict(first.get(symbol, {}))
        merge_bar_maps(
            merged,
            second.get(symbol, {}),
            collapse_identical_duplicates=False,
        )
        output[symbol] = merged
    return output


def _parse_protocol_time(value: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise EvidenceError(f"invalid protocol UTC time: {value}") from exc
    if parsed.tzinfo != UTC:
        raise EvidenceError("protocol calendar time must be UTC")
    return parsed


def _validate_body_phase_bindings(
    state: Path,
    phase: str,
    receipt: Mapping[str, Any],
    label: str,
) -> None:
    if receipt.get("protocolSha256") != sha256_path(PROTOCOL_PATH):
        raise EvidenceError(f"{phase} {label} protocol binding mismatch")
    if receipt.get("cohortSha256") != sha256_path(state / "cohort.v1.json"):
        raise EvidenceError(f"{phase} {label} cohort binding mismatch")
    acquisition_path = state / f"acquisition-{phase}.v1.json"
    if receipt.get("acquisitionSha256") != sha256_path(acquisition_path):
        raise EvidenceError(f"{phase} {label} acquisition binding mismatch")
    archive_count = read_json(acquisition_path).get("archiveCount")
    if type(archive_count) is not int or archive_count <= 0:
        raise EvidenceError(f"{phase} {label} acquisition archive count is invalid")
    if receipt.get("expectedArchiveCount") != archive_count:
        raise EvidenceError(f"{phase} {label} expected-archive-count binding mismatch")
    if phase == "holdout":
        candidate, holdout_open = validate_holdout_open_chain(state)
        if receipt.get("candidateSealSha256") != sha256_path(state / "candidate-seal.v1.json"):
            raise EvidenceError(f"holdout {label} candidate binding mismatch")
        if receipt.get("holdoutOpenSha256") != sha256_path(state / "holdout-open.v1.json"):
            raise EvidenceError(f"holdout {label} open binding mismatch")
        if candidate.get("championTrialId") != holdout_open.get("championTrialId"):
            raise EvidenceError(f"holdout {label} champion mismatch")
    elif (
        receipt.get("candidateSealSha256") is not None
        or receipt.get("holdoutOpenSha256") is not None
    ):
        raise EvidenceError(f"development {label} contains holdout bindings")


def validate_body_open_attempt_receipt(
    state: Path,
    phase: str,
    protocol: Mapping[str, Any],
    cohort: Mapping[str, Any],
) -> Mapping[str, Any]:
    validate_run_marker(state, phase, protocol, cohort)
    receipt = read_json(state / f"{phase}-body-open-attempt.v1.json")
    if receipt.get("schema") != f"VG10{phase.title()}BodyOpenAttemptV1":
        raise EvidenceError(f"{phase} body-open-attempt schema mismatch")
    _validate_body_phase_bindings(state, phase, receipt, "body-open-attempt")
    if receipt.get("archiveMemberBodiesRead") != "UNMEASURED_MAY_BE_NONZERO":
        raise EvidenceError(f"{phase} body-open-attempt must not claim a member-read count")
    if receipt.get("allExpectedArchiveBodiesLoaded") is not False:
        raise EvidenceError(f"{phase} body-open-attempt must not claim a validated full load")
    if protocol.get("protocolId") != load_protocol().get("protocolId"):
        raise EvidenceError("body-open-attempt protocol identity mismatch")
    if cohort.get("schema") != "VG10StaticCohortV1":
        raise EvidenceError("body-open-attempt cohort identity mismatch")
    return receipt


def validate_body_open_receipt(
    state: Path,
    phase: str,
    protocol: Mapping[str, Any],
    cohort: Mapping[str, Any],
) -> Mapping[str, Any]:
    attempt = validate_body_open_attempt_receipt(state, phase, protocol, cohort)
    receipt = read_json(state / f"{phase}-body-open.v1.json")
    if receipt.get("schema") != f"VG10{phase.title()}BodyOpenV1":
        raise EvidenceError(f"{phase} body-open schema mismatch")
    _validate_body_phase_bindings(state, phase, receipt, "body-open")
    attempt_path = state / f"{phase}-body-open-attempt.v1.json"
    if receipt.get("bodyOpenAttemptSha256") != sha256_path(attempt_path):
        raise EvidenceError(f"{phase} body-open attempt binding mismatch")
    if receipt.get("allExpectedArchiveBodiesLoaded") is not True:
        raise EvidenceError(f"{phase} body-open must record a validated full load")
    loaded = receipt.get("loadedArchiveBodyCount")
    expected = receipt.get("expectedArchiveCount")
    if (
        type(loaded) is not int
        or loaded != expected
        or expected != attempt.get("expectedArchiveCount")
    ):
        raise EvidenceError(f"{phase} body-open loaded/expected archive-body count mismatch")
    if protocol.get("protocolId") != load_protocol().get("protocolId"):
        raise EvidenceError("body-open protocol identity mismatch")
    if cohort.get("schema") != "VG10StaticCohortV1":
        raise EvidenceError("body-open cohort identity mismatch")
    return receipt


def validate_run_marker(
    state: Path,
    phase: str,
    protocol: Mapping[str, Any],
    cohort: Mapping[str, Any],
) -> Mapping[str, Any]:
    if phase not in {"development", "holdout"}:
        raise EvidenceError("run-marker phase is not closed")
    marker = read_json(state / f"{phase}-run-start.v1.json")
    if marker.get("schema") != f"VG10{phase.title()}RunStartV1":
        raise EvidenceError(f"{phase} run-marker schema mismatch")
    if marker.get("protocolSha256") != sha256_path(PROTOCOL_PATH):
        raise EvidenceError(f"{phase} run-marker protocol binding mismatch")
    if marker.get("cohortSha256") != sha256_path(state / "cohort.v1.json"):
        raise EvidenceError(f"{phase} run-marker cohort binding mismatch")
    acquisition_key = "acquisitionSha256"
    if phase == "holdout":
        acquisition_key = "holdoutAcquisitionSha256"
    if marker.get(acquisition_key) != sha256_path(state / f"acquisition-{phase}.v1.json"):
        raise EvidenceError(f"{phase} run-marker acquisition binding mismatch")
    if phase == "holdout":
        candidate, holdout_open_value = validate_holdout_open_chain(state)
        if marker.get("candidateSealSha256") != sha256_path(state / "candidate-seal.v1.json"):
            raise EvidenceError("holdout run-marker candidate binding mismatch")
        if marker.get("holdoutOpenSha256") != sha256_path(state / "holdout-open.v1.json"):
            raise EvidenceError("holdout run-marker open binding mismatch")
        if candidate.get("championTrialId") != holdout_open_value.get("championTrialId"):
            raise EvidenceError("holdout run-marker champion mismatch")
    if protocol.get("protocolId") != load_protocol().get("protocolId"):
        raise EvidenceError("run-marker protocol identity mismatch")
    if cohort.get("schema") != "VG10StaticCohortV1":
        raise EvidenceError("run-marker cohort identity mismatch")
    return marker


def _validated_probability(value: Any, field: str) -> float:
    parsed = float(value)
    if not math.isfinite(parsed) or not 0 <= parsed <= 1:
        raise EvidenceError(f"{field} is not a probability")
    return parsed


def _validate_pbo_shape(
    pbo_value: Any,
    protocol: Mapping[str, Any],
    trial_ids: set[str],
) -> Mapping[str, Any]:
    pbo = require_mapping(pbo_value, "pbo")
    statistics_protocol = require_mapping(protocol["statistics"], "statistics")
    pbo_protocol = require_mapping(statistics_protocol["pbo"], "pbo protocol")
    blocks = tuple(
        require_text(item, "PBO block")
        for item in require_list(pbo_protocol["blocks"], "PBO blocks")
    )
    expected_train = set(itertools.combinations(blocks, 4))
    splits = require_list(pbo.get("splits"), "PBO splits")
    if pbo.get("splitCount") != 70 or len(splits) != 70:
        raise EvidenceError("PBO split count mismatch")
    actual_train: set[tuple[str, ...]] = set()
    below_count = 0
    for raw_split in splits:
        split = require_mapping(raw_split, "PBO split")
        train = tuple(
            require_text(item, "PBO train block")
            for item in require_list(split.get("trainBlocks"), "PBO train blocks")
        )
        test = tuple(
            require_text(item, "PBO test block")
            for item in require_list(split.get("testBlocks"), "PBO test blocks")
        )
        if (
            len(train) != 4
            or len(test) != 4
            or set(train).isdisjoint(test) is False
            or set(train) | set(test) != set(blocks)
            or train in actual_train
        ):
            raise EvidenceError("PBO split partition mismatch")
        actual_train.add(train)
        if split.get("selectedTrialId") not in trial_ids:
            raise EvidenceError("PBO split selected trial outside family")
        rank_value = split.get("outOfSampleAverageRank")
        relative_value = split.get("outOfSampleRelativeRank")
        if (
            isinstance(rank_value, bool)
            or not isinstance(rank_value, (int, float))
            or isinstance(relative_value, bool)
            or not isinstance(relative_value, (int, float))
        ):
            raise EvidenceError("PBO rank values are not numeric")
        rank = float(rank_value)
        relative = float(relative_value)
        if not math.isfinite(rank) or not 1 <= rank <= 16:
            raise EvidenceError("PBO rank out of bounds")
        if not math.isfinite(relative) or not 0 <= relative <= 1:
            raise EvidenceError("PBO relative rank out of bounds")
        expected_relative = 1.0 - (rank - 1.0) / 15.0
        if not math.isclose(relative, expected_relative, rel_tol=0, abs_tol=1e-15):
            raise EvidenceError("PBO relative-rank relation mismatch")
        below = split.get("belowMedian")
        if not isinstance(below, bool) or below != (relative <= 0.5):
            raise EvidenceError("PBO below-median relation mismatch")
        below_count += int(below)
    if actual_train != expected_train:
        raise EvidenceError("PBO does not cover all 70 train partitions")
    if pbo.get("belowMedianCount") != below_count:
        raise EvidenceError("PBO below-median count mismatch")
    measured_pbo = _validated_probability(pbo.get("pbo"), "PBO")
    if not math.isclose(measured_pbo, below_count / 70, rel_tol=0, abs_tol=1e-15):
        raise EvidenceError("PBO probability relation mismatch")
    return pbo


def validate_development_result_chain(
    state: Path,
) -> tuple[
    Mapping[str, Any],
    Mapping[str, Any],
    Mapping[str, Any],
    Mapping[str, Any],
    TrialSpec | None,
]:
    protocol = load_protocol()
    cohort = validate_cohort_chain(state, protocol)
    acquisition, _records = validate_acquisition_manifest(state, "development", protocol, cohort)
    run_marker = read_json(state / "development-run-start.v1.json")
    if run_marker.get("schema") != "VG10DevelopmentRunStartV1":
        raise EvidenceError("development-run marker schema mismatch")
    if run_marker.get("protocolSha256") != sha256_path(PROTOCOL_PATH):
        raise EvidenceError("development-run protocol binding mismatch")
    if run_marker.get("cohortSha256") != sha256_path(state / "cohort.v1.json"):
        raise EvidenceError("development-run cohort binding mismatch")
    if run_marker.get("acquisitionSha256") != sha256_path(
        state / "acquisition-development.v1.json"
    ):
        raise EvidenceError("development-run acquisition binding mismatch")
    validate_body_open_receipt(state, "development", protocol, cohort)
    development = read_json(state / "development-result.v1.json")
    if development.get("schema") != "VG10DevelopmentAnalysisV1":
        raise EvidenceError("development result schema mismatch")
    if development.get("protocolSha256") != sha256_path(PROTOCOL_PATH):
        raise EvidenceError("development result protocol binding mismatch")
    if development.get("cohortSha256") != sha256_path(state / "cohort.v1.json"):
        raise EvidenceError("development result cohort binding mismatch")
    if development.get("acquisitionSha256") != sha256_path(
        state / "acquisition-development.v1.json"
    ):
        raise EvidenceError("development result acquisition binding mismatch")
    specs = {spec.trial_id: spec for spec in trial_specs(protocol)}
    trial_ids = set(specs)
    if development.get("trialCount") != 16:
        raise EvidenceError("development trial count mismatch")
    trials = require_mapping(development.get("trials"), "development trials")
    if set(trials) != trial_ids:
        raise EvidenceError("development trial result family mismatch")
    holm_absolute = require_mapping(development.get("holmAbsolute"), "Holm absolute")
    holm_excess = require_mapping(development.get("holmMatchedExcess"), "Holm excess")
    if set(holm_absolute) != trial_ids or set(holm_excess) != trial_ids:
        raise EvidenceError("development Holm family mismatch")
    pbo = _validate_pbo_shape(development.get("pbo"), protocol, trial_ids)
    raw_absolute: dict[str, float] = {}
    raw_excess: dict[str, float] = {}
    validated_trials: dict[str, Mapping[str, Any]] = {}
    passing: list[str] = []
    gate = require_mapping(require_mapping(protocol["gates"], "gates")["development"], "gate")
    for trial_id in sorted(trial_ids):
        result = require_mapping(trials[trial_id], f"trial {trial_id}")
        absolute7d = require_mapping(result.get("absolute7d"), "absolute7d")
        excess7d = require_mapping(result.get("matchedExcess7d"), "matchedExcess7d")
        raw_absolute[trial_id] = _validated_probability(
            absolute7d.get("oneSidedCenteredNullP"), "absolute raw p"
        )
        raw_excess[trial_id] = _validated_probability(
            excess7d.get("oneSidedCenteredNullP"), "excess raw p"
        )
        adjusted_absolute = _validated_probability(
            result.get("holmAbsoluteP"), "trial Holm absolute"
        )
        adjusted_excess = _validated_probability(
            result.get("holmMatchedExcessP"), "trial Holm excess"
        )
        if adjusted_absolute != _validated_probability(
            holm_absolute[trial_id], "family Holm absolute"
        ) or adjusted_excess != _validated_probability(holm_excess[trial_id], "family Holm excess"):
            raise EvidenceError("trial/family Holm binding mismatch")
        expected_gates = list(
            gate_trial(
                result,
                adjusted_absolute,
                adjusted_excess,
                float(pbo["pbo"]),
                gate,
                development=True,
            )
        )
        if result.get("gates") != expected_gates:
            raise EvidenceError(f"{trial_id} development gate rows mismatch")
        passes = all(item["pass"] for item in expected_gates)
        if result.get("passesDevelopment") is not passes:
            raise EvidenceError(f"{trial_id} development pass flag mismatch")
        if passes:
            passing.append(trial_id)
        validated_trials[trial_id] = result
    recomputed_absolute = holm_adjust(raw_absolute)
    recomputed_excess = holm_adjust(raw_excess)
    if dict(holm_absolute) != recomputed_absolute or dict(holm_excess) != recomputed_excess:
        raise EvidenceError("development Holm values are not recomputable")
    if development.get("passingTrialIds") != passing:
        raise EvidenceError("development passing set mismatch")
    champion_id = select_development_champion(passing, validated_trials, specs)
    if development.get("championTrialId") != champion_id:
        raise EvidenceError("development champion is not deterministic")
    if development.get("developmentGatesPass") is not (champion_id is not None):
        raise EvidenceError("development family pass flag mismatch")
    champion = specs[champion_id] if champion_id is not None else None
    return protocol, cohort, acquisition, development, champion


def validate_candidate_seal_chain(
    state: Path,
) -> tuple[Mapping[str, Any], Mapping[str, Any], TrialSpec]:
    protocol, _cohort, _acquisition, development, champion = validate_development_result_chain(
        state
    )
    if champion is None:
        raise EvidenceError("candidate seal cannot bind a failed development family")
    candidate = read_json(state / "candidate-seal.v1.json")
    if candidate.get("schema") != "VG10CandidateSealV1" or candidate.get("candidateCount") != 1:
        raise EvidenceError("candidate seal schema/count mismatch")
    if candidate.get("protocolSha256") != sha256_path(PROTOCOL_PATH):
        raise EvidenceError("candidate seal protocol binding mismatch")
    if candidate.get("developmentResultSha256") != sha256_path(
        state / "development-result.v1.json"
    ):
        raise EvidenceError("candidate seal development binding mismatch")
    if candidate.get("championTrialId") != champion.trial_id:
        raise EvidenceError("candidate seal champion mismatch")
    if candidate.get("champion") != {
        "D": champion.days,
        "P": champion.persistence,
        "K": champion.top_k,
        "HHours": champion.holding_hours,
    }:
        raise EvidenceError("candidate seal specification mismatch")
    if candidate.get("holdoutBytesRequestedOrRead") is not False:
        raise EvidenceError("candidate seal holdout declaration drift")
    if development.get("championTrialId") != champion.trial_id:
        raise EvidenceError("candidate/development champion mismatch")
    if protocol.get("protocolId") != load_protocol().get("protocolId"):
        raise EvidenceError("candidate protocol identity mismatch")
    return candidate, development, champion


def validate_holdout_open_chain(
    state: Path,
) -> tuple[Mapping[str, Any], Mapping[str, Any]]:
    candidate, development, champion = validate_candidate_seal_chain(state)
    holdout_open_value = read_json(state / "holdout-open.v1.json")
    if (
        holdout_open_value.get("schema") != "VG10HoldoutOpenV1"
        or holdout_open_value.get("allowedOpenCount") != 1
    ):
        raise EvidenceError("holdout-open schema/count mismatch")
    if holdout_open_value.get("protocolSha256") != sha256_path(PROTOCOL_PATH):
        raise EvidenceError("holdout-open protocol binding mismatch")
    if holdout_open_value.get("candidateSealSha256") != sha256_path(
        state / "candidate-seal.v1.json"
    ):
        raise EvidenceError("holdout-open candidate binding mismatch")
    if holdout_open_value.get("developmentResultSha256") != sha256_path(
        state / "development-result.v1.json"
    ):
        raise EvidenceError("holdout-open development binding mismatch")
    if holdout_open_value.get("championTrialId") != champion.trial_id:
        raise EvidenceError("holdout-open champion mismatch")
    if holdout_open_value.get("holdoutBytesRequestedOrReadBeforeThisMarker") is not False:
        raise EvidenceError("holdout-open pre-open declaration drift")
    if development.get("championTrialId") != champion.trial_id:
        raise EvidenceError("holdout-open development champion mismatch")
    return candidate, holdout_open_value


def development_run(state_dir: Path, *, now: datetime) -> Mapping[str, Any]:
    state = validate_external_state_dir(state_dir)
    if (state / "result.v1.json").exists():
        raise LifecycleError("experiment is already terminal")
    protocol = load_protocol()
    cohort = validate_cohort_chain(state, protocol)
    acquisition, _records = validate_acquisition_manifest(state, "development", protocol, cohort)
    acquisition_path = state / "acquisition-development.v1.json"
    expected_archives = int(acquisition["archiveCount"])
    consume_marker(
        state,
        "development-run-start.v1.json",
        {
            "schema": "VG10DevelopmentRunStartV1",
            "startedAtUtc": utc_text(now),
            "protocolSha256": sha256_path(PROTOCOL_PATH),
            "cohortSha256": sha256_path(state / "cohort.v1.json"),
            "acquisitionSha256": sha256_path(acquisition_path),
        },
        now=now,
    )
    try:
        symbols = tuple(
            require_text(item, "symbol")
            for item in require_list(cohort["selectedSymbols"], "selectedSymbols")
        )
        attempt_path = state / "development-body-open-attempt.v1.json"
        write_json_exclusive(
            attempt_path,
            {
                "schema": "VG10DevelopmentBodyOpenAttemptV1",
                "attemptedAtUtc": utc_text(now),
                "protocolSha256": sha256_path(PROTOCOL_PATH),
                "cohortSha256": sha256_path(state / "cohort.v1.json"),
                "acquisitionSha256": sha256_path(acquisition_path),
                "candidateSealSha256": None,
                "holdoutOpenSha256": None,
                "expectedArchiveCount": expected_archives,
                "archiveMemberBodiesRead": "UNMEASURED_MAY_BE_NONZERO",
                "allExpectedArchiveBodiesLoaded": False,
            },
        )
        bars, loaded_archives = load_acquired_bars(state, "development", symbols)
        write_json_exclusive(
            state / "development-body-open.v1.json",
            {
                "schema": "VG10DevelopmentBodyOpenV1",
                "openedAtUtc": utc_text(now),
                "protocolSha256": sha256_path(PROTOCOL_PATH),
                "cohortSha256": sha256_path(state / "cohort.v1.json"),
                "acquisitionSha256": sha256_path(acquisition_path),
                "candidateSealSha256": None,
                "holdoutOpenSha256": None,
                "bodyOpenAttemptSha256": sha256_path(attempt_path),
                "expectedArchiveCount": expected_archives,
                "loadedArchiveBodyCount": loaded_archives,
                "allExpectedArchiveBodiesLoaded": True,
            },
        )
        calendar = require_mapping(protocol["calendar"], "calendar")
        period = require_mapping(calendar["development"], "development")
        decisions = decisions_between(
            _parse_protocol_time(require_text(period["startInclusive"], "start")),
            _parse_protocol_time(require_text(period["endExclusive"], "end")),
            require_list(calendar["decisionUtcHours"], "decision hours"),
        )
        if len(decisions) != int(period["scheduledFormations"]):
            raise EvidenceError("development scheduled formation count mismatch")
        assert_nonoverlap(decisions, max(spec.holding_hours for spec in trial_specs(protocol)))
        cache: dict[tuple[int, datetime], SignalSnapshot] = {}
        observations = {
            spec.trial_id: evaluate_trial_observations(
                bars, symbols, decisions, spec, protocol, cache
            )
            for spec in trial_specs(protocol)
        }
        analysis = dict(analyze_development_family(observations, protocol))
        analysis.update(
            {
                "completedAtUtc": utc_text(now),
                "protocolSha256": sha256_path(PROTOCOL_PATH),
                "cohortSha256": sha256_path(state / "cohort.v1.json"),
                "acquisitionSha256": sha256_path(acquisition_path),
            }
        )
        write_json_exclusive(state / "development-result.v1.json", analysis)
        if not analysis["developmentGatesPass"]:
            write_terminal_result(
                state,
                "NO_GO",
                "DEVELOPMENT_GATES_FAILED_HOLDOUT_UNOPENED",
                now=now,
                evidence={
                    "developmentResultSha256": sha256_path(state / "development-result.v1.json"),
                    "holdoutOpened": False,
                },
            )
        return analysis
    except BaseException as exc:
        attempted = (state / "development-body-open-attempt.v1.json").exists()
        loaded = (state / "development-body-open.v1.json").exists()
        if not (state / "result.v1.json").exists():
            write_terminal_result(
                state,
                "UNMEASURED",
                getattr(exc, "code", "DEVELOPMENT_POST_MARKER_FAILURE"),
                now=now,
                evidence={
                    "message": str(exc),
                    "holdoutOpened": False,
                    "developmentArchiveBodyOpenAttempted": attempted,
                    "developmentAllArchiveBodiesLoaded": loaded,
                },
            )
        raise


def candidate_seal(state_dir: Path, *, now: datetime) -> Mapping[str, Any]:
    state = validate_external_state_dir(state_dir)
    if (state / "result.v1.json").exists():
        raise LifecycleError("terminal result prevents candidate seal")
    _protocol, _cohort, _acquisition, _development, spec = validate_development_result_chain(state)
    if spec is None:
        raise LifecycleError("development did not produce a gate-passing champion")
    development_path = state / "development-result.v1.json"
    payload = {
        "schema": "VG10CandidateSealV1",
        "sealedAtUtc": utc_text(now),
        "candidateCount": 1,
        "championTrialId": spec.trial_id,
        "champion": {
            "D": spec.days,
            "P": spec.persistence,
            "K": spec.top_k,
            "HHours": spec.holding_hours,
        },
        "developmentResultSha256": sha256_path(development_path),
        "protocolSha256": sha256_path(PROTOCOL_PATH),
        "holdoutBytesRequestedOrRead": False,
    }
    consume_marker(state, "candidate-seal.v1.json", payload, now=now)
    validate_candidate_seal_chain(state)
    return payload


def holdout_open(state_dir: Path, *, now: datetime) -> Mapping[str, Any]:
    state = validate_external_state_dir(state_dir)
    if (state / "result.v1.json").exists():
        raise LifecycleError("terminal result prevents holdout open")
    candidate, development, champion = validate_candidate_seal_chain(state)
    seal_path = state / "candidate-seal.v1.json"
    payload = {
        "schema": "VG10HoldoutOpenV1",
        "openedAtUtc": utc_text(now),
        "allowedOpenCount": 1,
        "protocolSha256": sha256_path(PROTOCOL_PATH),
        "candidateSealSha256": sha256_path(seal_path),
        "developmentResultSha256": sha256_path(state / "development-result.v1.json"),
        "championTrialId": champion.trial_id,
        "holdoutBytesRequestedOrReadBeforeThisMarker": False,
    }
    if candidate.get("championTrialId") != development.get("championTrialId"):
        raise EvidenceError("holdout-open candidate/development champion mismatch")
    consume_marker(state, "holdout-open.v1.json", payload, now=now)
    validate_holdout_open_chain(state)
    return payload


def holdout_run(state_dir: Path, *, now: datetime) -> Mapping[str, Any]:
    state = validate_external_state_dir(state_dir)
    if (state / "result.v1.json").exists():
        raise LifecycleError("experiment is already terminal")
    protocol = load_protocol()
    cohort = validate_cohort_chain(state, protocol)
    candidate, holdout_open_value = validate_holdout_open_chain(state)
    validate_acquisition_manifest(state, "development", protocol, cohort)
    holdout_acquisition, _holdout_records = validate_acquisition_manifest(
        state, "holdout", protocol, cohort
    )
    expected_archives = int(holdout_acquisition["archiveCount"])
    consume_marker(
        state,
        "holdout-run-start.v1.json",
        {
            "schema": "VG10HoldoutRunStartV1",
            "startedAtUtc": utc_text(now),
            "protocolSha256": sha256_path(PROTOCOL_PATH),
            "cohortSha256": sha256_path(state / "cohort.v1.json"),
            "candidateSealSha256": sha256_path(state / "candidate-seal.v1.json"),
            "holdoutOpenSha256": sha256_path(state / "holdout-open.v1.json"),
            "holdoutAcquisitionSha256": sha256_path(state / "acquisition-holdout.v1.json"),
        },
        now=now,
    )
    try:
        symbols = tuple(
            require_text(item, "symbol")
            for item in require_list(cohort["selectedSymbols"], "selectedSymbols")
        )
        # Development history is read only for the candidate's causal D-day baseline.
        development_bars, _development_loaded = load_acquired_bars(state, "development", symbols)
        attempt_path = state / "holdout-body-open-attempt.v1.json"
        write_json_exclusive(
            attempt_path,
            {
                "schema": "VG10HoldoutBodyOpenAttemptV1",
                "attemptedAtUtc": utc_text(now),
                "protocolSha256": sha256_path(PROTOCOL_PATH),
                "cohortSha256": sha256_path(state / "cohort.v1.json"),
                "acquisitionSha256": sha256_path(state / "acquisition-holdout.v1.json"),
                "candidateSealSha256": sha256_path(state / "candidate-seal.v1.json"),
                "holdoutOpenSha256": sha256_path(state / "holdout-open.v1.json"),
                "expectedArchiveCount": expected_archives,
                "archiveMemberBodiesRead": "UNMEASURED_MAY_BE_NONZERO",
                "allExpectedArchiveBodiesLoaded": False,
            },
        )
        holdout_bars, loaded_archives = load_acquired_bars(state, "holdout", symbols)
        write_json_exclusive(
            state / "holdout-body-open.v1.json",
            {
                "schema": "VG10HoldoutBodyOpenV1",
                "openedAtUtc": utc_text(now),
                "protocolSha256": sha256_path(PROTOCOL_PATH),
                "cohortSha256": sha256_path(state / "cohort.v1.json"),
                "acquisitionSha256": sha256_path(state / "acquisition-holdout.v1.json"),
                "candidateSealSha256": sha256_path(state / "candidate-seal.v1.json"),
                "holdoutOpenSha256": sha256_path(state / "holdout-open.v1.json"),
                "bodyOpenAttemptSha256": sha256_path(attempt_path),
                "expectedArchiveCount": expected_archives,
                "loadedArchiveBodyCount": loaded_archives,
                "allExpectedArchiveBodiesLoaded": True,
            },
        )
        bars = merge_symbol_bars(development_bars, holdout_bars)
        champion_id = require_text(candidate["championTrialId"], "championTrialId")
        if holdout_open_value.get("championTrialId") != champion_id:
            raise EvidenceError("holdout run open/candidate champion mismatch")
        spec = next((item for item in trial_specs(protocol) if item.trial_id == champion_id), None)
        if spec is None:
            raise EvidenceError("sealed champion is outside frozen family")
        calendar = require_mapping(protocol["calendar"], "calendar")
        period = require_mapping(calendar["holdout"], "holdout")
        decisions = decisions_between(
            _parse_protocol_time(require_text(period["startInclusive"], "start")),
            _parse_protocol_time(require_text(period["endExclusive"], "end")),
            require_list(calendar["decisionUtcHours"], "decision hours"),
        )
        if len(decisions) != int(period["scheduledFormations"]):
            raise EvidenceError("holdout scheduled formation count mismatch")
        assert_nonoverlap(decisions, max(item.holding_hours for item in trial_specs(protocol)))
        observations = evaluate_trial_observations(bars, symbols, decisions, spec, protocol)
        analysis = dict(analyze_holdout(observations, spec, protocol))
        analysis.update(
            {
                "completedAtUtc": utc_text(now),
                "protocolSha256": sha256_path(PROTOCOL_PATH),
                "cohortSha256": sha256_path(state / "cohort.v1.json"),
                "candidateSealSha256": sha256_path(state / "candidate-seal.v1.json"),
                "holdoutOpenSha256": sha256_path(state / "holdout-open.v1.json"),
                "acquisitionSha256": sha256_path(state / "acquisition-holdout.v1.json"),
            }
        )
        write_json_exclusive(state / "holdout-result.v1.json", analysis)
        verdict = "GO" if analysis["holdoutGatesPass"] else "NO_GO"
        reason = "HOLDOUT_GATES_PASSED" if verdict == "GO" else "HOLDOUT_GATES_FAILED"
        write_terminal_result(
            state,
            verdict,
            reason,
            now=now,
            evidence={
                "championTrialId": champion_id,
                "developmentResultSha256": sha256_path(state / "development-result.v1.json"),
                "candidateSealSha256": sha256_path(state / "candidate-seal.v1.json"),
                "holdoutResultSha256": sha256_path(state / "holdout-result.v1.json"),
            },
        )
        return analysis
    except BaseException as exc:
        attempted = (state / "holdout-body-open-attempt.v1.json").exists()
        loaded = (state / "holdout-body-open.v1.json").exists()
        if not (state / "result.v1.json").exists():
            write_terminal_result(
                state,
                "UNMEASURED",
                getattr(exc, "code", "HOLDOUT_POST_MARKER_FAILURE"),
                now=now,
                evidence={
                    "message": str(exc),
                    "holdoutArchiveBodyOpenAttempted": attempted,
                    "holdoutAllArchiveBodiesLoaded": loaded,
                },
            )
        raise


def validate_holdout_result_chain(
    state: Path,
) -> tuple[Mapping[str, Any], Mapping[str, Any], TrialSpec]:
    protocol = load_protocol()
    cohort = validate_cohort_chain(state, protocol)
    candidate, holdout_open_value = validate_holdout_open_chain(state)
    validate_acquisition_manifest(state, "development", protocol, cohort)
    validate_acquisition_manifest(state, "holdout", protocol, cohort)
    validate_run_marker(state, "holdout", protocol, cohort)
    validate_body_open_receipt(state, "holdout", protocol, cohort)
    champion_id = require_text(candidate.get("championTrialId"), "championTrialId")
    specs = {spec.trial_id: spec for spec in trial_specs(protocol)}
    if champion_id not in specs:
        raise EvidenceError("holdout result champion outside frozen family")
    if holdout_open_value.get("championTrialId") != champion_id:
        raise EvidenceError("holdout result open/candidate champion mismatch")
    result = read_json(state / "holdout-result.v1.json")
    if result.get("schema") != "VG10HoldoutAnalysisV1" or result.get("trialId") != champion_id:
        raise EvidenceError("holdout result schema/trial mismatch")
    expected_bindings = {
        "protocolSha256": sha256_path(PROTOCOL_PATH),
        "cohortSha256": sha256_path(state / "cohort.v1.json"),
        "candidateSealSha256": sha256_path(state / "candidate-seal.v1.json"),
        "holdoutOpenSha256": sha256_path(state / "holdout-open.v1.json"),
        "acquisitionSha256": sha256_path(state / "acquisition-holdout.v1.json"),
    }
    for field, expected in expected_bindings.items():
        if result.get(field) != expected:
            raise EvidenceError(f"holdout result {field} binding mismatch")
    gate = require_mapping(require_mapping(protocol["gates"], "gates")["holdout"], "gate")
    expected_gates = list(gate_trial(result, 0.0, 0.0, 0.0, gate, development=False))
    if result.get("gates") != expected_gates:
        raise EvidenceError("holdout result gate rows mismatch")
    passes = all(item["pass"] for item in expected_gates)
    if result.get("holdoutGatesPass") is not passes:
        raise EvidenceError("holdout result pass flag mismatch")
    return result, candidate, specs[champion_id]


def _archive_body_open_state(attempted: bool, loaded: bool) -> str:
    if loaded and not attempted:
        raise EvidenceError("archive-body success receipt lacks an attempt receipt")
    if loaded:
        return "ALL_EXPECTED_BODIES_LOADED_AND_VALIDATED"
    if attempted:
        return "ATTEMPTED_MEMBER_READ_COUNT_UNMEASURED"
    return "NOT_ATTEMPTED"


def verify_final(state_dir: Path) -> Mapping[str, Any]:
    state = validate_external_state_dir(state_dir)
    source = verify_source_freeze(state)
    protocol = load_protocol()
    result = read_json(state / "result.v1.json")
    verdict = result.get("researchVerdict")
    if verdict not in VERDICTS:
        raise EvidenceError("terminal result verdict invalid")
    if result.get("capitalVerdict") != "NO_GO" or result.get("executionAuthority") != "NONE":
        raise EvidenceError("terminal authority invariant violated")
    if (
        result.get("accountEffectiveFees") != "UNKNOWN"
        or result.get("executableCapacity") != "UNMEASURED"
        or result.get("usdtEqualsUsd") != "UNPROVEN_REPORTING_CONVENTION"
    ):
        raise EvidenceError("terminal public-research truth invariant violated")
    cohort_path = state / "cohort.v1.json"
    candidate_path = state / "candidate-seal.v1.json"
    development_path = state / "development-result.v1.json"
    holdout_open_path = state / "holdout-open.v1.json"
    development_acquisition_path = state / "acquisition-development.v1.json"
    holdout_acquisition_path = state / "acquisition-holdout.v1.json"
    development_marker_path = state / "development-run-start.v1.json"
    holdout_marker_path = state / "holdout-run-start.v1.json"
    development_attempt_path = state / "development-body-open-attempt.v1.json"
    holdout_attempt_path = state / "holdout-body-open-attempt.v1.json"
    development_body_path = state / "development-body-open.v1.json"
    holdout_body_path = state / "holdout-body-open.v1.json"
    cohort: Mapping[str, Any] | None = None
    if cohort_path.is_file():
        cohort = validate_cohort_chain(state, protocol)
    if development_acquisition_path.is_file():
        if cohort is None:
            raise EvidenceError("development acquisition lacks cohort chain")
        validate_acquisition_manifest(state, "development", protocol, cohort)
    if holdout_acquisition_path.is_file():
        if cohort is None:
            raise EvidenceError("holdout acquisition lacks cohort chain")
        validate_acquisition_manifest(state, "holdout", protocol, cohort)
    if development_marker_path.is_file():
        if cohort is None or not development_acquisition_path.is_file():
            raise EvidenceError("development run marker lacks acquisition/cohort chain")
        validate_run_marker(state, "development", protocol, cohort)
    if development_attempt_path.is_file():
        if cohort is None or not development_marker_path.is_file():
            raise EvidenceError("development body-open attempt lacks run chain")
        validate_body_open_attempt_receipt(state, "development", protocol, cohort)
    if development_body_path.is_file():
        if cohort is None or not development_attempt_path.is_file():
            raise EvidenceError("development body-open receipt lacks attempt receipt")
        validate_body_open_receipt(state, "development", protocol, cohort)
    if development_path.is_file():
        validate_development_result_chain(state)
    if candidate_path.is_file():
        validate_candidate_seal_chain(state)
    if holdout_open_path.is_file():
        validate_holdout_open_chain(state)
    if holdout_marker_path.is_file():
        if cohort is None or not holdout_acquisition_path.is_file():
            raise EvidenceError("holdout run marker lacks acquisition/cohort chain")
        validate_run_marker(state, "holdout", protocol, cohort)
    if holdout_attempt_path.is_file():
        if cohort is None or not holdout_marker_path.is_file():
            raise EvidenceError("holdout body-open attempt lacks run chain")
        validate_body_open_attempt_receipt(state, "holdout", protocol, cohort)
    if holdout_body_path.is_file():
        if cohort is None or not holdout_attempt_path.is_file():
            raise EvidenceError("holdout body-open receipt lacks attempt receipt")
        validate_body_open_receipt(state, "holdout", protocol, cohort)
    if result.get("reasonCode") == "DEVELOPMENT_GATES_FAILED_HOLDOUT_UNOPENED":
        if verdict != "NO_GO":
            raise EvidenceError("development gate failure must be terminal NO_GO")
        if not development_path.is_file():
            raise EvidenceError("development NO_GO lacks development result")
        _protocol, _cohort, _acquisition, development, champion = validate_development_result_chain(
            state
        )
        if development.get("developmentGatesPass") is not False or champion is not None:
            raise EvidenceError("development NO_GO contradicts development gates")
        evidence = require_mapping(result["evidence"], "result evidence")
        if evidence.get("developmentResultSha256") != sha256_path(development_path):
            raise EvidenceError("development NO_GO result binding mismatch")
        forbidden = (
            "candidate-seal.v1.json",
            "holdout-open.v1.json",
            "acquisition-holdout.v1.json",
            "holdout-run-start.v1.json",
            "holdout-body-open-attempt.v1.json",
            "holdout-body-open.v1.json",
        )
        if any((state / name).exists() for name in forbidden):
            raise EvidenceError("development NO_GO has forbidden holdout state")
    if result.get("reasonCode") in {"HOLDOUT_GATES_PASSED", "HOLDOUT_GATES_FAILED"}:
        expected_verdict = "GO" if result.get("reasonCode") == "HOLDOUT_GATES_PASSED" else "NO_GO"
        if verdict != expected_verdict:
            raise EvidenceError("holdout terminal verdict/reason mismatch")
        holdout_result_path = state / "holdout-result.v1.json"
        if not holdout_result_path.is_file():
            raise EvidenceError("holdout terminal result lacks holdout analysis")
        holdout_result, candidate, champion = validate_holdout_result_chain(state)
        evidence = require_mapping(result["evidence"], "result evidence")
        if evidence.get("holdoutResultSha256") != sha256_path(holdout_result_path):
            raise EvidenceError("holdout result binding mismatch")
        if not candidate_path.is_file() or evidence.get("candidateSealSha256") != sha256_path(
            candidate_path
        ):
            raise EvidenceError("holdout terminal candidate binding mismatch")
        if evidence.get("developmentResultSha256") != sha256_path(development_path):
            raise EvidenceError("holdout terminal development binding mismatch")
        if evidence.get("championTrialId") != champion.trial_id:
            raise EvidenceError("holdout terminal champion binding mismatch")
        if candidate.get("championTrialId") != champion.trial_id:
            raise EvidenceError("holdout terminal candidate champion mismatch")
        expected_pass = result.get("reasonCode") == "HOLDOUT_GATES_PASSED"
        if holdout_result.get("holdoutGatesPass") is not expected_pass:
            raise EvidenceError("holdout terminal verdict contradicts gate result")
    if verdict == "GO" and result.get("reasonCode") != "HOLDOUT_GATES_PASSED":
        raise EvidenceError("GO is not backed by holdout gate pass")
    if verdict == "UNMEASURED" and not candidate_path.exists():
        forbidden_early_holdout = (
            "holdout-open.v1.json",
            "acquire-holdout-start.v1.json",
            "acquisition-holdout.v1.json",
            "holdout-run-start.v1.json",
            "holdout-body-open-attempt.v1.json",
            "holdout-body-open.v1.json",
            "holdout-result.v1.json",
        )
        if any((state / name).exists() for name in forbidden_early_holdout):
            raise EvidenceError("early UNMEASURED state touched holdout")
    development_attempted = development_attempt_path.exists()
    development_loaded = development_body_path.exists()
    holdout_attempted = holdout_attempt_path.exists()
    holdout_loaded = holdout_body_path.exists()
    result_evidence = require_mapping(result["evidence"], "result evidence")
    evidence_truth = {
        "developmentArchiveBodyOpenAttempted": development_attempted,
        "developmentAllArchiveBodiesLoaded": development_loaded,
        "holdoutArchiveBodyOpenAttempted": holdout_attempted,
        "holdoutAllArchiveBodiesLoaded": holdout_loaded,
    }
    for field, expected in evidence_truth.items():
        if field in result_evidence and result_evidence[field] is not expected:
            raise EvidenceError(f"terminal result {field} contradicts lifecycle receipts")
    return {
        "schema": "VG10FinalVerificationV1",
        "packetAggregateSha256": require_mapping(source["packetManifest"], "packetManifest")[
            "aggregateSha256"
        ],
        "resultSha256": sha256_path(state / "result.v1.json"),
        "researchVerdict": verdict,
        "capitalVerdict": "NO_GO",
        "executionAuthority": "NONE",
        "outcomesRecomputed": False,
        "archivesDecompressedDuringVerification": False,
        "developmentRunMarkerConsumed": development_marker_path.exists(),
        "holdoutRunMarkerConsumed": holdout_marker_path.exists(),
        "developmentArchiveBodyOpenAttempted": development_attempted,
        "developmentAllArchiveBodiesLoaded": development_loaded,
        "holdoutArchiveBodyOpenAttempted": holdout_attempted,
        "holdoutAllArchiveBodiesLoaded": holdout_loaded,
        "developmentArchiveBodyOpenState": _archive_body_open_state(
            development_attempted, development_loaded
        ),
        "holdoutArchiveBodyOpenState": _archive_body_open_state(holdout_attempted, holdout_loaded),
        "holdoutOpened": holdout_open_path.exists(),
    }


def _now() -> datetime:
    return datetime.now(tz=UTC).replace(microsecond=0)


def _emit(value: Mapping[str, Any]) -> None:
    sys.stdout.buffer.write(canonical_bytes(value))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="V-G10 sealed public-data research lifecycle")
    parser.add_argument("--state-dir", type=Path, required=True)
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("source-freeze")
    cohort_parser = subparsers.add_parser("cohort-freeze")
    cohort_parser.add_argument(
        "--daily-source-root",
        type=Path,
        default=Path("/private/tmp/cosmos-s1f-weekly-momentum-cash-v1"),
    )
    for phase in ("development", "holdout"):
        acquisition = subparsers.add_parser(f"acquire-{phase}")
        choice = acquisition.add_mutually_exclusive_group(required=True)
        choice.add_argument("--offline-source", type=Path)
        choice.add_argument("--network", action="store_true")
    subparsers.add_parser("development-run")
    subparsers.add_parser("candidate-seal")
    subparsers.add_parser("holdout-open")
    subparsers.add_parser("holdout-run")
    subparsers.add_parser("verify")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = build_parser().parse_args(argv)
    now = _now()
    try:
        if arguments.command == "source-freeze":
            output = source_freeze(arguments.state_dir, now=now)
        elif arguments.command == "cohort-freeze":
            output = cohort_freeze(arguments.state_dir, arguments.daily_source_root, now=now)
        elif arguments.command == "acquire-development":
            output = acquire_archives(
                arguments.state_dir,
                "development",
                now=now,
                offline_source=arguments.offline_source,
                network=arguments.network,
            )
        elif arguments.command == "development-run":
            output = development_run(arguments.state_dir, now=now)
        elif arguments.command == "candidate-seal":
            output = candidate_seal(arguments.state_dir, now=now)
        elif arguments.command == "holdout-open":
            output = holdout_open(arguments.state_dir, now=now)
        elif arguments.command == "acquire-holdout":
            output = acquire_archives(
                arguments.state_dir,
                "holdout",
                now=now,
                offline_source=arguments.offline_source,
                network=arguments.network,
            )
        elif arguments.command == "holdout-run":
            output = holdout_run(arguments.state_dir, now=now)
        elif arguments.command == "verify":
            output = verify_final(arguments.state_dir)
        else:  # pragma: no cover - argparse owns the closed command set.
            raise LifecycleError("unknown command")
        _emit(output)
        return 0
    except PacketError as exc:
        _emit({"status": "REFUSED", "code": exc.code, "message": str(exc)})
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
