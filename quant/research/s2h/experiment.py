"""Sealed Binance Spot UTC-boundary gap-reversal experiment.

Only ``acquire`` performs network I/O. ``prepare`` reads a checksum-verified
June-2025 daily archive cache for point-in-time universe selection. ``freeze``
binds the complete compressed source set and evaluator. ``run`` is network-free,
creates an exclusive marker before the first hourly archive member is opened,
and opens holdout members only after a development champion passes every frozen
gate.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import csv
import hashlib
import io
import itertools
import json
import math
import os
import platform
import random
import statistics
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from decimal import ROUND_FLOOR, Decimal, InvalidOperation, getcontext
from pathlib import Path
from typing import Any, Final, TypeVar, cast

getcontext().prec = 60

D = Decimal
DECIMAL_ZERO: Final = D(0)
INITIAL_NAV: Final = D(1000)
HERE: Final = Path(__file__).resolve().parent
PROTOCOL_PATH: Final = HERE / "protocol.v1.json"
README_PATH: Final = HERE / "README.md"
DISTINCTNESS_PATH: Final = HERE / "DISTINCTNESS.md"
SOURCE_RESEARCH_PATH: Final = HERE / "OFFICIAL_SOURCE_RESEARCH.md"
UNIVERSE_PATH: Final = HERE / "universe.v1.json"
SCREEN_MARKER_PATH: Final = HERE / "screen-consumed.v1.json"
SOURCE_MANIFEST_PATH: Final = HERE / "source-manifest.v1.json"
FREEZE_PATH: Final = HERE / "freeze.v1.json"
RUN_MARKER_PATH: Final = HERE / "run-marker.v1.json"
DEVELOPMENT_PATH: Final = HERE / "development.v1.json"
SELECTION_PATH: Final = HERE / "selection.v1.json"
HOLDOUT_OPEN_PATH: Final = HERE / "holdout-open.v1.json"
HOLDOUT_PATH: Final = HERE / "holdout.v1.json"
RESULT_PATH: Final = HERE / "result.v1.json"
DEFAULT_STATE_ROOT: Final = Path("/private/tmp/cosmos-s2h-spot-utc-gap-reversal-v1")
ARCHIVE_BASE: Final = "https://data.binance.vision/data/spot/monthly/klines"
USER_AGENT: Final = "cosmos-s2h-public-research/1.0"
BASE_COMMIT: Final = "a169b123fb186d1943a75ad648552c4d95be1be1"
DAY_US: Final = 86_400_000_000
HOUR_US: Final = 3_600_000_000
UNIX_EPOCH: Final = datetime(1970, 1, 1, tzinfo=UTC)
T = TypeVar("T")


class EvidenceError(RuntimeError):
    """Fail-closed protocol, source, lifecycle, or measurement error."""


@dataclass(frozen=True, slots=True)
class DailyBar:
    day: date
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    quote_volume: Decimal
    trades: int


@dataclass(frozen=True, slots=True)
class HourBar:
    opened_at: datetime
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    quote_volume: Decimal
    trades: int


@dataclass(frozen=True, slots=True)
class TrialSpec:
    trial_id: str
    tail_size: int
    exit_hour: int

    def as_mapping(self) -> dict[str, object]:
        return {
            "trialId": self.trial_id,
            "tailSize": self.tail_size,
            "entryHourUtc": 2,
            "exitHourUtc": self.exit_hour,
        }


@dataclass(frozen=True, slots=True)
class CostScenario:
    scenario_id: str
    fee_rate: Decimal
    adverse_rate: Decimal

    @property
    def total_return_cost(self) -> Decimal:
        return D(2) * (self.fee_rate + self.adverse_rate)


@dataclass(frozen=True, slots=True)
class DayOutcome:
    day: date
    active: bool
    cash_reason: str | None
    longs: tuple[str, ...]
    shorts: tuple[str, ...]
    gross_return: Decimal
    scenario_returns: Mapping[str, Decimal]
    capacity_proxy_usd: Decimal | None
    mark_returns: Mapping[str, tuple[tuple[datetime, Decimal], ...]]

    def as_mapping(self) -> dict[str, object]:
        return {
            "day": self.day.isoformat(),
            "active": self.active,
            "cashReason": self.cash_reason,
            "longs": list(self.longs),
            "shorts": list(self.shorts),
            "grossReturn": decimal_text(self.gross_return),
            "scenarioReturns": {
                key: decimal_text(value) for key, value in sorted(self.scenario_returns.items())
            },
            "capacityProxyUsd": optional_decimal_text(self.capacity_proxy_usd),
        }


@dataclass(slots=True)
class DrawdownTracker:
    peak_nav: Decimal = INITIAL_NAV
    peak_time: datetime | None = None
    maximum_pct: Decimal = DECIMAL_ZERO
    maximum_usd: Decimal = DECIMAL_ZERO
    trough_time: datetime | None = None
    source_peak_time: datetime | None = None

    def observe(self, observed_at: datetime, nav: Decimal) -> None:
        if self.peak_time is None:
            self.peak_time = observed_at
        if nav > self.peak_nav:
            self.peak_nav = nav
            self.peak_time = observed_at
        if self.peak_nav <= 0:
            raise EvidenceError("nonpositive drawdown peak")
        drawdown_usd = self.peak_nav - nav
        drawdown_pct = drawdown_usd / self.peak_nav * D(100)
        if drawdown_pct > self.maximum_pct:
            self.maximum_pct = drawdown_pct
            self.maximum_usd = drawdown_usd
            self.trough_time = observed_at
            self.source_peak_time = self.peak_time

    def as_mapping(self) -> dict[str, object]:
        return {
            "maximumPct": decimal_text(self.maximum_pct),
            "maximumUsd": decimal_text(self.maximum_usd),
            "peakTimeUtc": iso_or_none(self.source_peak_time),
            "troughTimeUtc": iso_or_none(self.trough_time),
        }


@dataclass(slots=True)
class ScenarioAccumulator:
    scenario: CostScenario
    nav: Decimal = INITIAL_NAV
    gross_usd: Decimal = DECIMAL_ZERO
    fees_usd: Decimal = DECIMAL_ZERO
    adverse_usd: Decimal = DECIMAL_ZERO
    net_usd_sum: Decimal = DECIMAL_ZERO
    daily_returns: list[Decimal] = field(default_factory=list)
    monthly_start_nav: dict[str, Decimal] = field(default_factory=dict)
    monthly_end_nav: dict[str, Decimal] = field(default_factory=dict)
    drawdown: DrawdownTracker = field(default_factory=DrawdownTracker)

    def apply(self, outcome: DayOutcome) -> None:
        month = outcome.day.strftime("%Y-%m")
        self.monthly_start_nav.setdefault(month, self.nav)
        start_nav = self.nav
        net_return = outcome.scenario_returns[self.scenario.scenario_id]
        if net_return <= D(-1):
            raise EvidenceError(
                f"scenario bankrupts NAV: {self.scenario.scenario_id} {outcome.day}"
            )
        if outcome.active:
            self.gross_usd += start_nav * outcome.gross_return
            self.fees_usd += start_nav * D(2) * self.scenario.fee_rate
            self.adverse_usd += start_nav * D(2) * self.scenario.adverse_rate
        self.nav = start_nav * (D(1) + net_return)
        self.net_usd_sum += self.nav - start_nav
        self.daily_returns.append(net_return)
        midnight = datetime.combine(outcome.day, datetime.min.time(), tzinfo=UTC)
        self.drawdown.observe(midnight, start_nav)
        for marked_at, relative_return in outcome.mark_returns[self.scenario.scenario_id]:
            self.drawdown.observe(marked_at, start_nav * (D(1) + relative_return))
        self.drawdown.observe(
            datetime.combine(outcome.day + timedelta(days=1), datetime.min.time(), tzinfo=UTC),
            self.nav,
        )
        self.monthly_end_nav[month] = self.nav

    def positive_months(self) -> int:
        return sum(
            1
            for month, start_nav in self.monthly_start_nav.items()
            if self.monthly_end_nav[month] > start_nav
        )

    def as_mapping(self) -> dict[str, object]:
        identity_residual = self.gross_usd - self.fees_usd - self.adverse_usd - self.net_usd_sum
        return {
            "scenarioId": self.scenario.scenario_id,
            "startNavUsd": "1000",
            "endNavUsd": decimal_text(self.nav),
            "netUsdPerInitial1000": decimal_text(self.nav - D(1000)),
            "grossPriceMoveUsd": decimal_text(self.gross_usd),
            "publicFeeUsd": decimal_text(self.fees_usd),
            "adverseExecutionUsd": decimal_text(self.adverse_usd),
            "borrowCostUsd": None,
            "accountEffectiveNetUsdPerInitial1000": None,
            "identityResidualUsd": decimal_text(identity_residual),
            "dailyReturns": [decimal_text(item) for item in self.daily_returns],
            "positiveMonths": self.positive_months(),
            "monthCount": len(self.monthly_start_nav),
            "drawdown": self.drawdown.as_mapping(),
        }


@dataclass(frozen=True, slots=True)
class TrialEvaluation:
    spec: TrialSpec
    scheduled_days: int
    active_days: int
    cash_days: int
    distinct_symbols: tuple[str, ...]
    capacities: tuple[Decimal, ...]
    days: tuple[DayOutcome, ...]
    scenarios: Mapping[str, ScenarioAccumulator]

    def scenario(self, scenario_id: str) -> ScenarioAccumulator:
        return self.scenarios[scenario_id]

    def capacity_summary(self) -> dict[str, object]:
        if not self.capacities:
            return {
                "count": 0,
                "minimumUsd": None,
                "p05Usd": None,
                "medianUsd": None,
                "authority": "PUBLIC_PRIOR_COMPLETE_DAY_QUOTE_VOLUME_PROXY_ONLY",
                "executableCapacity": "UNMEASURED",
            }
        values = sorted(self.capacities)
        return {
            "count": len(values),
            "minimumUsd": decimal_text(values[0]),
            "p05Usd": decimal_text(empirical_quantile_decimal(values, D("0.05"))),
            "medianUsd": decimal_text(median_decimal(values)),
            "authority": "PUBLIC_PRIOR_COMPLETE_DAY_QUOTE_VOLUME_PROXY_ONLY",
            "executableCapacity": "UNMEASURED",
        }

    def as_mapping(self) -> dict[str, object]:
        return {
            "trial": self.spec.as_mapping(),
            "scheduledDays": self.scheduled_days,
            "activeDays": self.active_days,
            "cashDays": self.cash_days,
            "distinctTradedSymbols": list(self.distinct_symbols),
            "capacity": self.capacity_summary(),
            "scenarios": {key: value.as_mapping() for key, value in sorted(self.scenarios.items())},
            "days": [item.as_mapping() for item in self.days],
        }


def canonical_bytes(value: object) -> bytes:
    return (
        json.dumps(
            value,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
            allow_nan=False,
        )
        + "\n"
    ).encode("utf-8")


def reject_json_constant(raw: str) -> object:
    raise ValueError(f"nonfinite JSON constant: {raw}")


def load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(
            safe_file(path).read_text(encoding="utf-8"),
            parse_constant=reject_json_constant,
        )
    except (OSError, UnicodeError, ValueError) as exc:
        raise EvidenceError(f"invalid JSON {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise EvidenceError(f"JSON root must be object: {path}")
    return cast(dict[str, Any], value)


def safe_file(path: Path) -> Path:
    if path.is_symlink() or not path.is_file():
        raise EvidenceError(f"required regular file missing or unsafe: {path}")
    return path


def sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def sha256_path(path: Path) -> str:
    return sha256_bytes(safe_file(path).read_bytes())


def utc_now_text() -> str:
    return datetime.now(tz=UTC).isoformat().replace("+00:00", "Z")


def iso_or_none(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def decimal_text(value: Decimal) -> str:
    if not value.is_finite():
        raise EvidenceError("nonfinite Decimal")
    text = format(value, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    if text in {"", "-0"}:
        return "0"
    return text


def optional_decimal_text(value: Decimal | None) -> str | None:
    return None if value is None else decimal_text(value)


def parse_decimal(raw: str, field_name: str, *, positive: bool = False) -> Decimal:
    try:
        value = D(raw)
    except InvalidOperation as exc:
        raise EvidenceError(f"{field_name}: invalid decimal") from exc
    if not value.is_finite() or (positive and value <= 0):
        raise EvidenceError(f"{field_name}: invalid decimal domain")
    return value


def empirical_quantile_decimal(values: Sequence[Decimal], probability: Decimal) -> Decimal:
    if not values:
        raise EvidenceError("empty Decimal quantile")
    if probability < 0 or probability > 1:
        raise EvidenceError("invalid quantile probability")
    ordered = sorted(values)
    index = int((probability * D(len(ordered) - 1)).to_integral_value(rounding=ROUND_FLOOR))
    return ordered[index]


def empirical_quantile_float(values: Sequence[float], probability: float) -> float:
    if not values:
        raise EvidenceError("empty float quantile")
    if not 0 <= probability <= 1:
        raise EvidenceError("invalid float quantile probability")
    ordered = sorted(values)
    index = math.floor(probability * (len(ordered) - 1))
    return ordered[index]


def median_decimal(values: Sequence[Decimal]) -> Decimal:
    if not values:
        raise EvidenceError("empty Decimal median")
    ordered = sorted(values)
    midpoint = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[midpoint]
    return (ordered[midpoint - 1] + ordered[midpoint]) / D(2)


def _fsync_parent(path: Path) -> None:
    descriptor = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def write_exclusive_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = canonical_bytes(value)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    # Existence consumes the lifecycle name. Preserve even a partial marker
    # after write/fsync failure so interruption can never authorize a retry.
    with os.fdopen(descriptor, "wb", closefd=True) as output:
        output.write(raw)
        output.flush()
        os.fsync(output.fileno())
    _fsync_parent(path)


def write_atomic_bytes(path: Path, raw: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb", closefd=True) as output:
            output.write(raw)
            output.flush()
            os.fsync(output.fileno())
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
        _fsync_parent(path)
    finally:
        if temporary.exists():
            temporary.unlink()


def ensure_physical_directory(root: Path, relative: Path) -> Path:
    if relative.is_absolute() or ".." in relative.parts:
        raise EvidenceError("unsafe directory path")
    current = root
    for part in relative.parts:
        current /= part
        if current.exists() and current.is_symlink():
            raise EvidenceError("directory path contains symlink")
        current.mkdir(mode=0o700, exist_ok=True)
        if current.is_symlink() or not current.is_dir():
            raise EvidenceError("directory path is not physical")
    return current


def protocol() -> dict[str, Any]:
    value = load_json(PROTOCOL_PATH)
    if value.get("schema") != "cosmos.quant.research.s2h.protocol.v1":
        raise EvidenceError("protocol schema mismatch")
    if value.get("canonicalBaseCommit") != BASE_COMMIT:
        raise EvidenceError("protocol base mismatch")
    return value


def month_sequence(start: str, end: str) -> tuple[str, ...]:
    start_year, start_month = (int(item) for item in start.split("-"))
    end_year, end_month = (int(item) for item in end.split("-"))
    output: list[str] = []
    year, month = start_year, start_month
    while (year, month) <= (end_year, end_month):
        output.append(f"{year:04d}-{month:02d}")
        month += 1
        if month == 13:
            year += 1
            month = 1
    return tuple(output)


def days_in_month(month: str) -> int:
    year, month_number = (int(item) for item in month.split("-"))
    following = date(year + 1, 1, 1) if month_number == 12 else date(year, month_number + 1, 1)
    return (following - date(year, month_number, 1)).days


def timestamp_microseconds(value: datetime) -> int:
    if value.tzinfo is None or value.utcoffset() != timedelta(0):
        raise EvidenceError("timestamp must be UTC aware")
    delta = value - UNIX_EPOCH
    return delta.days * DAY_US + delta.seconds * 1_000_000 + delta.microseconds


def expected_member_name(symbol: str, interval: str, month: str) -> str:
    return f"{symbol}-{interval}-{month}.csv"


def validate_safe_symbol(symbol: str) -> None:
    if (
        not symbol
        or symbol in {".", ".."}
        or "/" in symbol
        or "\\" in symbol
        or "\x00" in symbol
        or any(ord(character) < 32 for character in symbol)
    ):
        raise EvidenceError(f"unsafe symbol folder: {symbol!r}")


def parse_checksum_text(raw: bytes, expected_name: str) -> str:
    try:
        text = raw.decode("ascii").strip()
    except UnicodeDecodeError as exc:
        raise EvidenceError("checksum is not ASCII") from exc
    fields = text.split()
    if len(fields) != 2:
        raise EvidenceError("checksum field count")
    digest, filename = fields
    filename = filename.removeprefix("*")
    if (
        len(digest) != 64
        or any(character not in "0123456789abcdefABCDEF" for character in digest)
        or filename != expected_name
    ):
        raise EvidenceError("checksum content mismatch")
    return digest.lower()


def verify_pair(zip_path: Path, checksum_path: Path) -> tuple[str, str]:
    zip_raw = safe_file(zip_path).read_bytes()
    checksum_raw = safe_file(checksum_path).read_bytes()
    expected = parse_checksum_text(checksum_raw, zip_path.name)
    observed = sha256_bytes(zip_raw)
    if observed != expected:
        raise EvidenceError(f"official checksum mismatch: {zip_path}")
    return observed, sha256_bytes(checksum_raw)


def single_zip_member(archive_raw: bytes, expected_name: str) -> bytes:
    try:
        with zipfile.ZipFile(io.BytesIO(archive_raw)) as archive:
            members = archive.infolist()
            if len(members) != 1:
                raise EvidenceError("archive must contain exactly one member")
            member = members[0]
            if (
                member.filename != expected_name
                or member.is_dir()
                or member.flag_bits & 0x1
                or member.file_size > 50_000_000
            ):
                raise EvidenceError("unsafe or unexpected archive member")
            if (member.external_attr >> 16) & 0o170000 == 0o120000:
                raise EvidenceError("symlink archive member")
            return archive.read(member)
    except EvidenceError:
        raise
    except (zipfile.BadZipFile, RuntimeError) as exc:
        raise EvidenceError("invalid ZIP archive") from exc


def csv_rows(raw: bytes) -> list[list[str]]:
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise EvidenceError("CSV is not UTF-8") from exc
    try:
        rows = list(csv.reader(io.StringIO(text, newline="")))
    except csv.Error as exc:
        raise EvidenceError("invalid CSV") from exc
    if (
        rows
        and rows[0]
        and rows[0][0].strip().lower()
        in {
            "open_time",
            "open time",
        }
    ):
        rows = rows[1:]
    return rows


def parse_daily_archive(
    zip_path: Path, checksum_path: Path, *, symbol: str, month: str
) -> tuple[DailyBar, ...]:
    verify_pair(zip_path, checksum_path)
    raw = single_zip_member(
        safe_file(zip_path).read_bytes(), expected_member_name(symbol, "1d", month)
    )
    rows = csv_rows(raw)
    expected_days = days_in_month(month)
    if len(rows) != expected_days:
        raise EvidenceError(f"{symbol} {month}: daily row count")
    year, month_number = (int(item) for item in month.split("-"))
    month_start = datetime(year, month_number, 1, tzinfo=UTC)
    output: list[DailyBar] = []
    for index, row in enumerate(rows):
        if len(row) != 12:
            raise EvidenceError(f"{symbol} {month}: daily column count")
        try:
            open_time = int(row[0])
            close_time = int(row[6])
            trades = int(row[8])
        except ValueError as exc:
            raise EvidenceError(f"{symbol} {month}: daily integer") from exc
        expected_open = timestamp_microseconds(month_start + timedelta(days=index))
        if open_time != expected_open or close_time != expected_open + DAY_US - 1:
            raise EvidenceError(f"{symbol} {month}: daily time grid")
        opened = parse_decimal(row[1], "open", positive=True)
        high = parse_decimal(row[2], "high", positive=True)
        low = parse_decimal(row[3], "low", positive=True)
        closed = parse_decimal(row[4], "close", positive=True)
        quote_volume = parse_decimal(row[7], "quote_volume")
        if (
            high < max(opened, closed)
            or low > min(opened, closed)
            or high < low
            or quote_volume < 0
            or trades < 0
        ):
            raise EvidenceError(f"{symbol} {month}: daily economic domain")
        output.append(
            DailyBar(
                day=(month_start + timedelta(days=index)).date(),
                open=opened,
                high=high,
                low=low,
                close=closed,
                quote_volume=quote_volume,
                trades=trades,
            )
        )
    return tuple(output)


def parse_hour_archive(
    zip_path: Path, checksum_path: Path, *, symbol: str, month: str
) -> tuple[HourBar, ...]:
    verify_pair(zip_path, checksum_path)
    raw = single_zip_member(
        safe_file(zip_path).read_bytes(), expected_member_name(symbol, "1h", month)
    )
    rows = csv_rows(raw)
    expected_hours = days_in_month(month) * 24
    if not rows or len(rows) > expected_hours:
        raise EvidenceError(f"{symbol} {month}: hourly row count domain")
    year, month_number = (int(item) for item in month.split("-"))
    month_start = datetime(year, month_number, 1, tzinfo=UTC)
    month_start_us = timestamp_microseconds(month_start)
    month_end_us = month_start_us + expected_hours * HOUR_US
    output: list[HourBar] = []
    previous_open_time: int | None = None
    for row in rows:
        if len(row) != 12:
            raise EvidenceError(f"{symbol} {month}: hourly column count")
        try:
            open_time = int(row[0])
            close_time = int(row[6])
            trades = int(row[8])
        except ValueError as exc:
            raise EvidenceError(f"{symbol} {month}: hourly integer") from exc
        if (
            open_time < month_start_us
            or open_time >= month_end_us
            or (open_time - month_start_us) % HOUR_US != 0
            or close_time != open_time + HOUR_US - 1
            or (previous_open_time is not None and open_time <= previous_open_time)
        ):
            raise EvidenceError(f"{symbol} {month}: hourly time grid")
        previous_open_time = open_time
        opened = parse_decimal(row[1], "open", positive=True)
        high = parse_decimal(row[2], "high", positive=True)
        low = parse_decimal(row[3], "low", positive=True)
        closed = parse_decimal(row[4], "close", positive=True)
        quote_volume = parse_decimal(row[7], "quote_volume")
        if (
            high < max(opened, closed)
            or low > min(opened, closed)
            or high < low
            or quote_volume < 0
            or trades < 0
        ):
            raise EvidenceError(f"{symbol} {month}: hourly economic domain")
        output.append(
            HourBar(
                opened_at=month_start
                + timedelta(
                    microseconds=open_time - month_start_us,
                ),
                open=opened,
                high=high,
                low=low,
                close=closed,
                quote_volume=quote_volume,
                trades=trades,
            )
        )
    return tuple(output)


def excluded_base(symbol: str, protocol_value: Mapping[str, Any]) -> str | None:
    if not symbol.endswith("USDT"):
        return "NOT_USDT_SUFFIX"
    base = symbol[: -len("USDT")]
    stable = set(cast(list[str], protocol_value["universe"]["stableAndFiatBaseExclusions"]))
    if base in stable:
        return "STABLE_OR_FIAT_BASE"
    suffixes = cast(list[str], protocol_value["universe"]["leveragedTokenSuffixExclusions"])
    if any(base.endswith(suffix) for suffix in suffixes):
        return "LEVERAGED_TOKEN_SUFFIX"
    return None


def prepare(anchor_cache: Path) -> dict[str, Any]:
    protocol_value = protocol()
    if SCREEN_MARKER_PATH.exists() or UNIVERSE_PATH.exists():
        raise EvidenceError("screen already consumed")
    cache = anchor_cache.resolve(strict=True)
    if cache.is_symlink() or not cache.is_dir():
        raise EvidenceError("anchor cache must be a physical directory")
    discovery_path = safe_file(cache.parent / "discovery.v1.json")
    discovery = load_json(discovery_path)
    expected_discovery_sha = cast(str, protocol_value["universe"]["inheritedDiscoverySha256"])
    if (
        discovery.get("schema") != "S1FArchiveDiscoveryV1"
        or discovery.get("state") != "METADATA_ONLY_NO_ARCHIVE_BODY_OPENED"
        or sha256_path(discovery_path) != expected_discovery_sha
    ):
        raise EvidenceError("inherited discovery receipt mismatch")
    acquisition_path = safe_file(cache.parent / "acquisition-manifest.v1.json")
    acquisition_manifest = load_json(acquisition_path)
    expected_acquisition_sha = cast(
        str,
        protocol_value["universe"]["inheritedAcquisitionManifestSha256"],
    )
    if (
        acquisition_manifest.get("schema") != "S1FAcquisitionManifestV1"
        or acquisition_manifest.get("state") != "CHECKSUM_VERIFIED_ARCHIVES_NOT_DECOMPRESSED"
        or acquisition_manifest.get("discoverySha256") != expected_discovery_sha
        or sha256_path(acquisition_path) != expected_acquisition_sha
    ):
        raise EvidenceError("inherited acquisition manifest mismatch")
    acquisition_rows = cast(list[Mapping[str, Any]], acquisition_manifest.get("artifactPairs"))
    if acquisition_manifest.get("artifactPairCount") != 11_245 or len(acquisition_rows) != 11_245:
        raise EvidenceError("inherited acquisition manifest cardinality")
    acquisition_index: dict[tuple[str, str], Mapping[str, Any]] = {}
    for acquisition_row in acquisition_rows:
        key = (
            cast(str, acquisition_row.get("symbol")),
            cast(str, acquisition_row.get("month")),
        )
        if key in acquisition_index:
            raise EvidenceError("duplicate inherited acquisition pair")
        acquisition_index[key] = acquisition_row
    discovery_universe = cast(Mapping[str, Any], discovery.get("universe"))
    inherited_symbols = cast(list[str], discovery_universe.get("symbols"))
    exclusions = cast(Mapping[str, Any], discovery.get("exclusions"))
    inherited_exclusions = [
        *cast(list[str], exclusions.get("stableOrFiatSymbols")),
        *cast(list[str], exclusions.get("pairedLeveragedSymbols")),
    ]
    candidate_symbols = sorted(
        {*inherited_symbols, *inherited_exclusions},
        key=lambda item: item.encode("utf-8"),
    )
    if (
        discovery_universe.get("count") != 605
        or len(inherited_symbols) != 605
        or len(set(inherited_symbols)) != 605
        or len(inherited_exclusions) != 74
        or len(candidate_symbols) != 679
    ):
        raise EvidenceError("inherited discovery cardinality mismatch")
    for symbol in candidate_symbols:
        validate_safe_symbol(symbol)
    cached_directories = {
        item.name for item in cache.iterdir() if item.is_dir() and not item.is_symlink()
    }
    unexpected_cached = cached_directories - set(inherited_symbols)
    if unexpected_cached:
        raise EvidenceError("anchor cache contains symbols outside discovery")
    marker = {
        "schema": "cosmos.quant.research.s2h.screen_consumed.v1",
        "state": "SCREEN_CONSUMED_BEFORE_ANCHOR_MEMBER_OPEN",
        "createdAtUtc": utc_now_text(),
        "protocolSha256": sha256_path(PROTOCOL_PATH),
        "experimentSha256": sha256_path(HERE / "experiment.py"),
        "preScreenHead": git_output(["rev-parse", "HEAD"]),
        "preScreenTree": git_output(["rev-parse", "HEAD^{tree}"]),
        "anchorCacheResolved": str(cache),
        "inheritedDiscoveryResolved": str(discovery_path.resolve()),
        "inheritedDiscoverySha256": sha256_path(discovery_path),
        "inheritedAcquisitionManifestResolved": str(acquisition_path.resolve()),
        "inheritedAcquisitionManifestSha256": sha256_path(acquisition_path),
        "inheritedRawPrefixCount": discovery["root"]["allPrefixCount"],
        "inheritedAsciiUsdtCandidateCount": 679,
        "outcomeRowsOpened": 0,
        "strategyRunCount": 0,
    }
    write_exclusive_json(SCREEN_MARKER_PATH, marker)
    attempts: list[dict[str, object]] = []
    candidates: list[tuple[Decimal, str, dict[str, object]]] = []
    for symbol in candidate_symbols:
        reason = excluded_base(symbol, protocol_value)
        if reason is not None:
            attempts.append({"symbol": symbol, "status": "EXCLUDED", "reason": reason})
            continue
        path = cache / symbol
        if path.is_symlink() or not path.is_dir():
            attempts.append(
                {
                    "symbol": symbol,
                    "status": "INVALID_EVIDENCE",
                    "reason": "NOT_MATERIALIZED_IN_INHERITED_JUNE_CACHE",
                }
            )
            continue
        month_path = path / "2025-06"
        zip_path = month_path / f"{symbol}-1d-2025-06.zip"
        checksum_path = month_path / f"{symbol}-1d-2025-06.zip.CHECKSUM"
        try:
            bars = parse_daily_archive(zip_path, checksum_path, symbol=symbol, month="2025-06")
            median_volume = median_decimal([bar.quote_volume for bar in bars])
            zip_sha, checksum_sha = verify_pair(zip_path, checksum_path)
            inherited_pair = acquisition_index.get((symbol, "2025-06"))
            if (
                inherited_pair is None
                or inherited_pair.get("state") != "DOWNLOADED_VERIFIED"
                or inherited_pair.get("zipSha256") != zip_sha
                or inherited_pair.get("checksumSha256") != checksum_sha
                or inherited_pair.get("zipBytes") != zip_path.stat().st_size
                or inherited_pair.get("checksumBytes") != checksum_path.stat().st_size
            ):
                raise EvidenceError("inherited June pair binding mismatch")
        except EvidenceError as exc:
            attempts.append(
                {
                    "symbol": symbol,
                    "status": "INVALID_EVIDENCE",
                    "reason": str(exc),
                }
            )
            continue
        minimum_volume = D(
            cast(str, protocol_value["universe"]["minimumAnchorMedianDailyQuoteVolumeUsdt"])
        )
        status = "SUCCESS" if median_volume >= minimum_volume else "BELOW_LIQUIDITY"
        row: dict[str, object] = {
            "symbol": symbol,
            "status": status,
            "reason": None if status == "SUCCESS" else "MEDIAN_QUOTE_VOLUME_BELOW_FLOOR",
            "medianDailyQuoteVolumeUsdt": decimal_text(median_volume),
            "zipSha256": zip_sha,
            "checksumSha256": checksum_sha,
            "archiveRelativePath": str(zip_path.relative_to(cache)),
        }
        attempts.append(row)
        if status == "SUCCESS":
            candidates.append((median_volume, symbol, row))
    candidates.sort(key=lambda item: (-item[0], item[1].encode("utf-8")))
    required = int(protocol_value["universe"]["frozenUniverseSize"])
    if len(candidates) < required:
        raise EvidenceError(f"screen has only {len(candidates)} valid candidates; need {required}")
    selected = [
        {
            "rank": index + 1,
            "symbol": symbol,
            "medianDailyQuoteVolumeUsdt": decimal_text(volume),
            "zipSha256": row["zipSha256"],
            "checksumSha256": row["checksumSha256"],
            "archiveRelativePath": row["archiveRelativePath"],
        }
        for index, (volume, symbol, row) in enumerate(candidates[:required])
    ]
    universe = {
        "schema": "cosmos.quant.research.s2h.universe.v1",
        "state": "POINT_IN_TIME_UNIVERSE_FROZEN",
        "createdAtUtc": utc_now_text(),
        "protocolSha256": sha256_path(PROTOCOL_PATH),
        "screenMarkerSha256": sha256_path(SCREEN_MARKER_PATH),
        "anchorCacheResolved": str(cache),
        "inheritedDiscoveryResolved": str(discovery_path.resolve()),
        "inheritedDiscoverySha256": sha256_path(discovery_path),
        "inheritedAcquisitionManifestResolved": str(acquisition_path.resolve()),
        "inheritedAcquisitionManifestSha256": sha256_path(acquisition_path),
        "inheritedRawPrefixCount": discovery["root"]["allPrefixCount"],
        "inheritedAsciiUsdtCandidateCount": len(candidate_symbols),
        "priorAsciiCandidateGrammarLimitation": (
            "RAW_NON_ASCII_PREFIXES_EXIST_BUT_WERE_NOT_CANDIDATES;JUNE_2025_TOP30_EFFECT_UNMEASURED"
        ),
        "inheritedExclusions": {
            "stableOrFiatCount": len(cast(list[str], exclusions["stableOrFiatSymbols"])),
            "pairedLeveragedCount": len(cast(list[str], exclusions["pairedLeveragedSymbols"])),
            "stableOrFiatSha256": exclusions["stableOrFiatSha256"],
            "pairedLeveragedSha256": exclusions["pairedLeveragedSha256"],
        },
        "anchorMonth": "2025-06",
        "attemptCount": len(attempts),
        "attempts": attempts,
        "successfulCandidateCount": len(candidates),
        "selectedCount": len(selected),
        "selected": selected,
        "selectedSymbols": [item["symbol"] for item in selected],
        "currentExchangeInfoUsed": False,
        "futureCompletenessUsed": False,
        "holdoutOutcomeRowsOpened": 0,
    }
    write_exclusive_json(UNIVERSE_PATH, universe)
    return universe


def request_bytes(url: str, *, attempts: int = 4) -> tuple[bytes, dict[str, str]]:
    last_error: BaseException | None = None
    for attempt in range(attempts):
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                final_url = urllib.parse.urlparse(response.geturl())
                if final_url.scheme != "https" or final_url.hostname != "data.binance.vision":
                    raise EvidenceError("download redirected outside source authority")
                raw = response.read(50_000_001)
                if len(raw) > 50_000_000:
                    raise EvidenceError("download exceeds frozen byte ceiling")
                headers = {
                    "etag": response.headers.get("ETag", ""),
                    "lastModified": response.headers.get("Last-Modified", ""),
                    "contentLength": response.headers.get("Content-Length", ""),
                }
                if headers["contentLength"]:
                    try:
                        declared_length = int(headers["contentLength"])
                    except ValueError as exc:
                        raise EvidenceError("invalid source content length") from exc
                    if declared_length != len(raw):
                        raise EvidenceError("source content length mismatch")
                return raw, headers
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last_error = exc
            if attempt + 1 < attempts:
                time.sleep(0.5 * (2**attempt))
    raise EvidenceError(f"download failed {url}: {last_error}")


def acquire_pair(state_root: Path, symbol: str, month: str) -> dict[str, object]:
    relative = Path("archives") / symbol / month
    directory = ensure_physical_directory(state_root, relative)
    zip_name = f"{symbol}-1h-{month}.zip"
    zip_path = directory / zip_name
    checksum_path = directory / f"{zip_name}.CHECKSUM"
    receipt_path = directory / "receipt.v1.json"
    zip_url = (
        f"{ARCHIVE_BASE}/{urllib.parse.quote(symbol, safe='')}/1h/"
        f"{urllib.parse.quote(zip_name, safe='')}"
    )
    checksum_url = f"{zip_url}.CHECKSUM"
    if zip_path.exists() or checksum_path.exists() or receipt_path.exists():
        if not (zip_path.is_file() and checksum_path.is_file() and receipt_path.is_file()):
            raise EvidenceError(f"partial existing acquisition: {symbol} {month}")
        zip_sha, checksum_sha = verify_pair(zip_path, checksum_path)
        receipt = load_json(receipt_path)
        if (
            receipt.get("schema") != "cosmos.quant.research.s2h.source_pair_receipt.v1"
            or receipt.get("symbol") != symbol
            or receipt.get("month") != month
            or receipt.get("interval") != "1h"
            or receipt.get("zipSha256") != zip_sha
            or receipt.get("checksumSha256") != checksum_sha
            or receipt.get("zipUrl") != zip_url
            or receipt.get("checksumUrl") != checksum_url
            or receipt.get("archiveMemberOpened") is not False
            or receipt.get("zipBytes") != zip_path.stat().st_size
            or receipt.get("checksumBytes") != checksum_path.stat().st_size
            or not isinstance(receipt.get("zipHeaders"), dict)
            or not isinstance(receipt.get("checksumHeaders"), dict)
            or not isinstance(receipt.get("acquiredAtUtc"), str)
        ):
            raise EvidenceError(f"existing receipt mismatch: {symbol} {month}")
    else:
        checksum_raw, checksum_headers = request_bytes(checksum_url)
        expected = parse_checksum_text(checksum_raw, zip_name)
        zip_raw, zip_headers = request_bytes(zip_url)
        observed = sha256_bytes(zip_raw)
        if observed != expected:
            raise EvidenceError(f"downloaded checksum mismatch: {symbol} {month}")
        write_atomic_bytes(checksum_path, checksum_raw)
        write_atomic_bytes(zip_path, zip_raw)
        receipt = {
            "schema": "cosmos.quant.research.s2h.source_pair_receipt.v1",
            "symbol": symbol,
            "month": month,
            "interval": "1h",
            "zipUrl": zip_url,
            "checksumUrl": checksum_url,
            "zipSha256": observed,
            "checksumSha256": sha256_bytes(checksum_raw),
            "zipBytes": len(zip_raw),
            "checksumBytes": len(checksum_raw),
            "zipHeaders": zip_headers,
            "checksumHeaders": checksum_headers,
            "acquiredAtUtc": utc_now_text(),
            "archiveMemberOpened": False,
        }
        write_exclusive_json(receipt_path, receipt)
        zip_sha = observed
        checksum_sha = sha256_bytes(checksum_raw)
    return {
        "symbol": symbol,
        "month": month,
        "interval": "1h",
        "zipUrl": zip_url,
        "checksumUrl": checksum_url,
        "zipRelativePath": str((relative / zip_name).as_posix()),
        "checksumRelativePath": str((relative / f"{zip_name}.CHECKSUM").as_posix()),
        "receiptRelativePath": str((relative / "receipt.v1.json").as_posix()),
        "zipSha256": zip_sha,
        "checksumSha256": checksum_sha,
        "receiptSha256": sha256_path(receipt_path),
        "zipBytes": zip_path.stat().st_size,
        "checksumBytes": checksum_path.stat().st_size,
        "zipHeaders": receipt["zipHeaders"],
        "checksumHeaders": receipt["checksumHeaders"],
        "acquiredAtUtc": receipt["acquiredAtUtc"],
        "archiveMemberOpened": False,
    }


def acquire(state_root: Path, workers: int) -> dict[str, Any]:
    if SOURCE_MANIFEST_PATH.exists():
        raise EvidenceError("source manifest already frozen")
    universe = load_json(UNIVERSE_PATH)
    if universe.get("state") != "POINT_IN_TIME_UNIVERSE_FROZEN":
        raise EvidenceError("universe is not frozen")
    symbols = cast(list[str], universe["selectedSymbols"])
    if len(symbols) != 30 or len(set(symbols)) != 30:
        raise EvidenceError("selected universe cardinality")
    months = month_sequence("2025-06", "2026-06")
    root = state_root.resolve()
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    if root.is_symlink() or not root.is_dir():
        raise EvidenceError("state root must be physical directory")
    jobs = [(symbol, month) for symbol in symbols for month in months]
    rows: list[dict[str, object]] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {
            executor.submit(acquire_pair, root, symbol, month): (symbol, month)
            for symbol, month in jobs
        }
        for future in concurrent.futures.as_completed(futures):
            symbol, month = futures[future]
            try:
                rows.append(future.result())
            except BaseException as exc:
                raise EvidenceError(f"acquisition failed {symbol} {month}: {exc}") from exc
    rows.sort(key=lambda row: (cast(str, row["symbol"]), cast(str, row["month"])))
    expected = 30 * len(months)
    if len(rows) != expected:
        raise EvidenceError("source pair count")
    manifest = {
        "schema": "cosmos.quant.research.s2h.source_manifest.v1",
        "state": "COMPRESSED_SOURCE_FROZEN_MEMBERS_UNOPENED",
        "createdAtUtc": utc_now_text(),
        "protocolSha256": sha256_path(PROTOCOL_PATH),
        "universeSha256": sha256_path(UNIVERSE_PATH),
        "stateRootResolved": str(root),
        "months": list(months),
        "symbols": symbols,
        "pairCount": len(rows),
        "zipCount": len(rows),
        "checksumCount": len(rows),
        "archiveMemberOpenCount": 0,
        "developmentMemberOpenCount": 0,
        "holdoutMemberOpenCount": 0,
        "pairs": rows,
    }
    write_exclusive_json(SOURCE_MANIFEST_PATH, manifest)
    return manifest


def git_output(arguments: Sequence[str]) -> str:
    completed = subprocess.run(
        ["git", *arguments],
        cwd=HERE,
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        raise EvidenceError(f"git command failed: {' '.join(arguments)}")
    return completed.stdout.strip()


def freeze(state_root: Path) -> dict[str, Any]:
    if FREEZE_PATH.exists():
        raise EvidenceError("freeze already exists")
    disallowed = [
        RUN_MARKER_PATH,
        DEVELOPMENT_PATH,
        SELECTION_PATH,
        HOLDOUT_OPEN_PATH,
        HOLDOUT_PATH,
        RESULT_PATH,
    ]
    if any(path.exists() for path in disallowed):
        raise EvidenceError("outcome state exists before freeze")
    protocol_value = protocol()
    universe = load_json(UNIVERSE_PATH)
    manifest = load_json(SOURCE_MANIFEST_PATH)
    if universe.get("state") != "POINT_IN_TIME_UNIVERSE_FROZEN":
        raise EvidenceError("freeze universe state mismatch")
    root = state_root.resolve(strict=True)
    if manifest.get("stateRootResolved") != str(root):
        raise EvidenceError("source root mismatch")
    if manifest.get("archiveMemberOpenCount") != 0:
        raise EvidenceError("source manifest member-open count")
    static_names = [
        "README.md",
        "DISTINCTNESS.md",
        "OFFICIAL_SOURCE_RESEARCH.md",
        "__init__.py",
        "protocol.v1.json",
        "experiment.py",
        "verify.py",
        "test_experiment.py",
        "screen-consumed.v1.json",
        "universe.v1.json",
        "source-manifest.v1.json",
    ]
    static_hashes: dict[str, str] = {}
    for name in static_names:
        static_hashes[name] = sha256_path(HERE / name)
    head = git_output(["rev-parse", "HEAD"])
    tree = git_output(["rev-parse", "HEAD^{tree}"])
    base_tree = git_output(["rev-parse", f"{BASE_COMMIT}^{{tree}}"])
    if protocol_value["canonicalBaseCommit"] != BASE_COMMIT:
        raise EvidenceError("freeze protocol base")
    freeze_value = {
        "schema": "cosmos.quant.research.s2h.freeze.v1",
        "state": "FROZEN_BEFORE_HOURLY_ARCHIVE_MEMBER_OPEN",
        "frozenAtUtc": utc_now_text(),
        "canonicalBaseCommit": BASE_COMMIT,
        "canonicalBaseTree": base_tree,
        "preOutcomeHead": head,
        "preOutcomeTree": tree,
        "protocolSha256": sha256_path(PROTOCOL_PATH),
        "universeSha256": sha256_path(UNIVERSE_PATH),
        "sourceManifestSha256": sha256_path(SOURCE_MANIFEST_PATH),
        "screenMarkerSha256": sha256_path(SCREEN_MARKER_PATH),
        "staticFileSha256": static_hashes,
        "stateRootResolved": str(root),
        "runtime": {
            "pythonImplementation": platform.python_implementation().lower(),
            "pythonVersion": platform.python_version(),
            "platform": platform.platform(),
            "decimalPrecision": getcontext().prec,
            "random": "PYTHON_RANDOM_MT19937_RANDRANGE",
        },
        "trialFamily": trial_family_mapping(),
        "outcomeState": {
            "runMarkerExists": False,
            "developmentExists": False,
            "selectionExists": False,
            "holdoutOpenExists": False,
            "holdoutExists": False,
            "resultExists": False,
            "hourlyArchiveMemberOpenCount": 0,
        },
        "authority": protocol_value["authority"],
    }
    write_exclusive_json(FREEZE_PATH, freeze_value)
    return freeze_value


def trial_specs() -> tuple[TrialSpec, ...]:
    return tuple(
        TrialSpec(
            trial_id=f"K{tail_size:02d}_X{exit_hour:02d}",
            tail_size=tail_size,
            exit_hour=exit_hour,
        )
        for tail_size in (3, 5, 8)
        for exit_hour in (6, 10)
    )


def trial_family_mapping() -> list[dict[str, object]]:
    return [item.as_mapping() for item in trial_specs()]


def cost_scenarios() -> tuple[CostScenario, ...]:
    value = protocol()
    output: list[CostScenario] = []
    for row in cast(list[dict[str, str]], value["costs"]["scenarios"]):
        output.append(
            CostScenario(
                scenario_id=row["id"],
                fee_rate=D(row["feeBpsPerFill"]) / D(10_000),
                adverse_rate=D(row["adverseExecutionBpsPerFill"]) / D(10_000),
            )
        )
    expected = {"gross", "public_base", "public_stress", "fee_stress"}
    if {item.scenario_id for item in output} != expected:
        raise EvidenceError("cost scenario family mismatch")
    return tuple(output)


def safe_relative_path(root: Path, relative_raw: str) -> Path:
    relative = Path(relative_raw)
    if relative.is_absolute() or ".." in relative.parts:
        raise EvidenceError("unsafe manifest relative path")
    candidate = root
    for part in relative.parts:
        candidate /= part
        if candidate.is_symlink():
            raise EvidenceError("manifest path contains symlink")
    resolved = candidate.resolve(strict=True)
    if root not in resolved.parents:
        raise EvidenceError("manifest path escapes state root")
    if not resolved.is_file():
        raise EvidenceError("manifest path is not physical regular file")
    return resolved


def source_pair_index(
    manifest: Mapping[str, Any],
) -> dict[tuple[str, str], Mapping[str, Any]]:
    rows = cast(list[Mapping[str, Any]], manifest["pairs"])
    output: dict[tuple[str, str], Mapping[str, Any]] = {}
    for row in rows:
        key = (cast(str, row["symbol"]), cast(str, row["month"]))
        if key in output:
            raise EvidenceError("duplicate source-manifest pair")
        output[key] = row
    return output


def load_hour_series(
    state_root: Path,
    symbols: Sequence[str],
    months: Sequence[str],
) -> tuple[dict[str, dict[datetime, HourBar]], int]:
    manifest = load_json(SOURCE_MANIFEST_PATH)
    root = state_root.resolve(strict=True)
    if manifest.get("stateRootResolved") != str(root):
        raise EvidenceError("evaluation source root mismatch")
    pair_index = source_pair_index(manifest)
    output: dict[str, dict[datetime, HourBar]] = {}
    member_open_count = 0
    for symbol in symbols:
        series: dict[datetime, HourBar] = {}
        for month in months:
            row = pair_index.get((symbol, month))
            if row is None:
                raise EvidenceError(f"source pair absent: {symbol} {month}")
            zip_path = safe_relative_path(root, cast(str, row["zipRelativePath"]))
            checksum_path = safe_relative_path(root, cast(str, row["checksumRelativePath"]))
            receipt_path = safe_relative_path(root, cast(str, row["receiptRelativePath"]))
            if (
                sha256_path(zip_path) != row["zipSha256"]
                or sha256_path(checksum_path) != row["checksumSha256"]
                or sha256_path(receipt_path) != row["receiptSha256"]
            ):
                raise EvidenceError(f"source-manifest digest drift: {symbol} {month}")
            receipt = load_json(receipt_path)
            if (
                receipt.get("zipSha256") != row["zipSha256"]
                or receipt.get("checksumSha256") != row["checksumSha256"]
                or receipt.get("zipUrl") != row["zipUrl"]
                or receipt.get("checksumUrl") != row["checksumUrl"]
                or receipt.get("zipHeaders") != row["zipHeaders"]
                or receipt.get("checksumHeaders") != row["checksumHeaders"]
                or receipt.get("acquiredAtUtc") != row["acquiredAtUtc"]
                or receipt.get("archiveMemberOpened") is not False
            ):
                raise EvidenceError(f"source receipt drift: {symbol} {month}")
            bars = parse_hour_archive(zip_path, checksum_path, symbol=symbol, month=month)
            member_open_count += 1
            for bar in bars:
                if bar.opened_at in series:
                    raise EvidenceError(f"duplicate hourly timestamp: {symbol}")
                series[bar.opened_at] = bar
        output[symbol] = series
    return output, member_open_count


def date_range(start: date, end_exclusive: date) -> tuple[date, ...]:
    output: list[date] = []
    current = start
    while current < end_exclusive:
        output.append(current)
        current += timedelta(days=1)
    return tuple(output)


def hour_key(day: date, hour: int) -> datetime:
    return datetime(day.year, day.month, day.day, hour, tzinfo=UTC)


def cash_day(day: date, reason: str) -> DayOutcome:
    zero_returns = {item.scenario_id: D(0) for item in cost_scenarios()}
    empty_marks: dict[str, tuple[tuple[datetime, Decimal], ...]] = {
        item.scenario_id: () for item in cost_scenarios()
    }
    return DayOutcome(
        day=day,
        active=False,
        cash_reason=reason,
        longs=(),
        shorts=(),
        gross_return=D(0),
        scenario_returns=zero_returns,
        capacity_proxy_usd=None,
        mark_returns=empty_marks,
    )


def cross_section_return(
    longs: Sequence[str],
    shorts: Sequence[str],
    entry_prices: Mapping[str, Decimal],
    mark_prices: Mapping[str, Decimal],
) -> Decimal:
    if not longs or len(longs) != len(shorts):
        raise EvidenceError("unbalanced long-short cohort")
    long_return = sum((mark_prices[symbol] / entry_prices[symbol] - D(1)) for symbol in longs) / D(
        len(longs)
    )
    short_return = sum(
        (D(1) - mark_prices[symbol] / entry_prices[symbol]) for symbol in shorts
    ) / D(len(shorts))
    return (long_return + short_return) / D(2)


def evaluate_day(
    series: Mapping[str, Mapping[datetime, HourBar]],
    symbols: Sequence[str],
    spec: TrialSpec,
    day: date,
) -> DayOutcome:
    previous_day = day - timedelta(days=1)
    previous_key = hour_key(previous_day, 23)
    boundary_key = hour_key(day, 0)
    entry_key = hour_key(day, 2)
    exit_key = hour_key(day, spec.exit_hour)
    gaps: list[tuple[Decimal, str]] = []
    for symbol in symbols:
        symbol_series = series[symbol]
        previous = symbol_series.get(previous_key)
        boundary = symbol_series.get(boundary_key)
        if previous is None or boundary is None:
            return cash_day(day, "FROZEN_UNIVERSE_SIGNAL_CLOCK_INCOMPLETE")
        ratio = boundary.open / previous.close
        if ratio <= 0:
            raise EvidenceError("nonpositive boundary ratio")
        gaps.append((getcontext().ln(ratio), symbol))
    gaps.sort(key=lambda item: (item[0], item[1].encode("utf-8")))
    k = spec.tail_size
    if len(gaps) < 2 * k:
        return cash_day(day, "INSUFFICIENT_FROZEN_UNIVERSE_FOR_TAILS")
    if gaps[k - 1][0] == gaps[k][0] or gaps[-k][0] == gaps[-k - 1][0]:
        return cash_day(day, "ATOMIC_BOUNDARY_TIE")
    longs = tuple(symbol for _, symbol in gaps[:k])
    shorts = tuple(symbol for _, symbol in gaps[-k:])
    if set(longs) & set(shorts):
        raise EvidenceError("overlapping long-short tails")
    selected = (*longs, *shorts)
    entry_prices: dict[str, Decimal] = {}
    exit_prices: dict[str, Decimal] = {}
    prior_day_volumes: list[Decimal] = []
    for symbol in selected:
        symbol_series = series[symbol]
        entry = symbol_series.get(entry_key)
        exit_bar = symbol_series.get(exit_key)
        if entry is None or exit_bar is None:
            raise EvidenceError(f"selected entry or exit missing: {symbol} {day} {spec.trial_id}")
        entry_prices[symbol] = entry.open
        exit_prices[symbol] = exit_bar.open
        prior_bars = [symbol_series.get(hour_key(previous_day, hour)) for hour in range(24)]
        if any(bar is None for bar in prior_bars):
            raise EvidenceError(f"selected prior-day capacity basis missing: {symbol} {day}")
        prior_day_volumes.append(
            sum(
                (cast(HourBar, bar).quote_volume for bar in prior_bars),
                D(0),
            )
        )
    gross_return = cross_section_return(longs, shorts, entry_prices, exit_prices)
    scenario_returns = {
        scenario.scenario_id: gross_return - scenario.total_return_cost
        for scenario in cost_scenarios()
    }
    capacity_proxy = D(2) * D(k) * min(prior_day_volumes) * D("0.0001")
    mark_returns: dict[str, tuple[tuple[datetime, Decimal], ...]] = {}
    for scenario in cost_scenarios():
        marks: list[tuple[datetime, Decimal]] = [(entry_key, -scenario.total_return_cost)]
        for hour in range(2, spec.exit_hour):
            mark_prices: dict[str, Decimal] = {}
            for symbol in selected:
                bar = series[symbol].get(hour_key(day, hour))
                if bar is None:
                    raise EvidenceError(f"selected hourly mark missing: {symbol} {day} {hour}")
                mark_prices[symbol] = bar.close
            marked_at = hour_key(day, hour) + timedelta(hours=1, microseconds=-1)
            marked_return = cross_section_return(longs, shorts, entry_prices, mark_prices)
            marks.append((marked_at, marked_return - scenario.total_return_cost))
        marks.append((exit_key, gross_return - scenario.total_return_cost))
        mark_returns[scenario.scenario_id] = tuple(marks)
    return DayOutcome(
        day=day,
        active=True,
        cash_reason=None,
        longs=longs,
        shorts=shorts,
        gross_return=gross_return,
        scenario_returns=scenario_returns,
        capacity_proxy_usd=capacity_proxy,
        mark_returns=mark_returns,
    )


def evaluate_trial(
    series: Mapping[str, Mapping[datetime, HourBar]],
    symbols: Sequence[str],
    spec: TrialSpec,
    dates: Sequence[date],
) -> TrialEvaluation:
    outcomes: list[DayOutcome] = []
    traded_symbols: set[str] = set()
    capacities: list[Decimal] = []
    accumulators = {
        scenario.scenario_id: ScenarioAccumulator(scenario=scenario)
        for scenario in cost_scenarios()
    }
    active_days = 0
    for day in dates:
        outcome = evaluate_day(series, symbols, spec, day)
        outcomes.append(outcome)
        if outcome.active:
            active_days += 1
            traded_symbols.update(outcome.longs)
            traded_symbols.update(outcome.shorts)
            if outcome.capacity_proxy_usd is None:
                raise EvidenceError("active day missing capacity proxy")
            capacities.append(outcome.capacity_proxy_usd)
        for accumulator in accumulators.values():
            accumulator.apply(outcome)
    for accumulator in accumulators.values():
        residual = D(
            cast(
                str,
                accumulator.as_mapping()["identityResidualUsd"],
            )
        )
        if abs(residual) > D("1e-45"):
            raise EvidenceError(
                f"cost identity failed: {spec.trial_id} {accumulator.scenario.scenario_id}"
            )
    return TrialEvaluation(
        spec=spec,
        scheduled_days=len(dates),
        active_days=active_days,
        cash_days=len(dates) - active_days,
        distinct_symbols=tuple(sorted(traded_symbols)),
        capacities=tuple(capacities),
        days=tuple(outcomes),
        scenarios=accumulators,
    )


def evaluate_family(
    series: Mapping[str, Mapping[datetime, HourBar]],
    symbols: Sequence[str],
    dates: Sequence[date],
    specs: Sequence[TrialSpec],
) -> tuple[TrialEvaluation, ...]:
    return tuple(evaluate_trial(series, symbols, spec, dates) for spec in specs)


def stable_seed(base_seed: int, label: str) -> int:
    digest = hashlib.sha256(label.encode("utf-8")).digest()
    return base_seed + int.from_bytes(digest[:4], "big")


def circular_indices(length: int, block_length: int, rng: random.Random) -> tuple[int, ...]:
    if length <= 0 or block_length <= 0:
        raise EvidenceError("invalid circular-block shape")
    output: list[int] = []
    while len(output) < length:
        start = rng.randrange(length)
        for offset in range(block_length):
            output.append((start + offset) % length)
            if len(output) == length:
                break
    return tuple(output)


def bootstrap_terminal_distribution(
    returns: Sequence[Decimal],
    *,
    block_length: int,
    replicates: int,
    seed: int,
) -> list[float]:
    if not returns:
        raise EvidenceError("empty bootstrap return series")
    float_returns = [float(item) for item in returns]
    if any(item <= -1 or not math.isfinite(item) for item in float_returns):
        raise EvidenceError("invalid bootstrap return")
    log_returns = [math.log1p(item) for item in float_returns]
    rng = random.Random(seed)
    output: list[float] = []
    for _ in range(replicates):
        indices = circular_indices(len(log_returns), block_length, rng)
        terminal = math.expm1(math.fsum(log_returns[index] for index in indices))
        output.append(terminal * 1000.0)
    return output


def sample_standard_deviation(values: Sequence[float]) -> float:
    if len(values) < 2:
        return 0.0
    return statistics.stdev(values)


def white_style_statistics(
    evaluations: Sequence[TrialEvaluation],
    *,
    block_length: int,
    replicates: int,
    seed: int,
) -> dict[str, object]:
    returns_by_trial = [
        [float(item) for item in evaluation.scenario("public_stress").daily_returns]
        for evaluation in evaluations
    ]
    lengths = {len(items) for items in returns_by_trial}
    if len(lengths) != 1:
        raise EvidenceError("White matrix is not synchronous")
    length = lengths.pop()
    if length < 2:
        raise EvidenceError("White matrix too short")
    means = [statistics.fmean(items) for items in returns_by_trial]
    standard_errors = [
        sample_standard_deviation(items) / math.sqrt(length) for items in returns_by_trial
    ]
    observed = [
        0.0 if standard_error == 0 else mean / standard_error
        for mean, standard_error in zip(means, standard_errors, strict=True)
    ]
    centered = [
        [item - mean for item in items] for items, mean in zip(returns_by_trial, means, strict=True)
    ]
    individual_counts = [0 for _ in evaluations]
    maximum_observed = max(observed)
    maximum_count = 0
    rng = random.Random(seed)
    for _ in range(replicates):
        indices = circular_indices(length, block_length, rng)
        bootstrap_statistics: list[float] = []
        for trial_index, values in enumerate(centered):
            bootstrap_mean = math.fsum(values[index] for index in indices) / length
            standard_error = standard_errors[trial_index]
            statistic = 0.0 if standard_error == 0 else bootstrap_mean / standard_error
            bootstrap_statistics.append(statistic)
            if statistic >= observed[trial_index]:
                individual_counts[trial_index] += 1
        if max(bootstrap_statistics) >= maximum_observed:
            maximum_count += 1
    p_values = [(count + 1) / (replicates + 1) for count in individual_counts]
    return {
        "method": "SYNCHRONOUS_CENTERED_CIRCULAR_BLOCK_MAX_STUDENTIZED",
        "blockDays": block_length,
        "replicates": replicates,
        "observedStudentized": {
            evaluation.spec.trial_id: observed[index]
            for index, evaluation in enumerate(evaluations)
        },
        "individualOneSidedP": {
            evaluation.spec.trial_id: p_values[index]
            for index, evaluation in enumerate(evaluations)
        },
        "jointMaximumP": (maximum_count + 1) / (replicates + 1),
    }


def holm_adjust(p_values: Mapping[str, float], alpha: float) -> dict[str, dict[str, object]]:
    ordered = sorted(p_values.items(), key=lambda item: (item[1], item[0]))
    adjusted: dict[str, float] = {}
    running = 0.0
    total = len(ordered)
    for index, (trial_id, p_value) in enumerate(ordered):
        candidate = min(1.0, (total - index) * p_value)
        running = max(running, candidate)
        adjusted[trial_id] = running
    return {
        trial_id: {
            "rawP": p_values[trial_id],
            "adjustedP": adjusted[trial_id],
            "passed": adjusted[trial_id] <= alpha,
        }
        for trial_id in sorted(p_values)
    }


def pbo_cscv(evaluations: Sequence[TrialEvaluation]) -> dict[str, object]:
    month_order = [
        "2025-07",
        "2025-08",
        "2025-09",
        "2025-10",
        "2025-11",
        "2025-12",
        "2026-01",
        "2026-02",
    ]
    month_scores: dict[str, dict[str, float]] = {}
    for evaluation in evaluations:
        by_month = dict.fromkeys(month_order, 0.0)
        for outcome, item in zip(
            evaluation.days,
            evaluation.scenario("public_stress").daily_returns,
            strict=True,
        ):
            month = outcome.day.strftime("%Y-%m")
            if month not in by_month:
                raise EvidenceError("development day outside PBO months")
            value = float(item)
            if value <= -1:
                raise EvidenceError("PBO log return invalid")
            by_month[month] += math.log1p(value)
        month_scores[evaluation.spec.trial_id] = by_month
    underperforming = 0
    rows: list[dict[str, object]] = []
    trial_ids = sorted(month_scores)
    for in_sample_indexes in itertools.combinations(range(8), 4):
        in_sample = {month_order[index] for index in in_sample_indexes}
        out_sample = set(month_order) - in_sample
        in_scores = {
            trial_id: math.fsum(month_scores[trial_id][month] for month in sorted(in_sample))
            for trial_id in trial_ids
        }
        selected = sorted(trial_ids, key=lambda trial_id: (-in_scores[trial_id], trial_id))[0]
        out_scores = {
            trial_id: math.fsum(month_scores[trial_id][month] for month in sorted(out_sample))
            for trial_id in trial_ids
        }
        median_score = statistics.median(out_scores.values())
        failed = out_scores[selected] <= median_score
        underperforming += int(failed)
        rows.append(
            {
                "inSampleMonths": sorted(in_sample),
                "selectedTrialId": selected,
                "selectedOutSampleScore": out_scores[selected],
                "allTrialOutSampleMedian": median_score,
                "underperformed": failed,
            }
        )
    return {
        "method": "CSCV",
        "blocks": 8,
        "inSampleBlocks": 4,
        "splits": len(rows),
        "underperformingSplits": underperforming,
        "pbo": underperforming / len(rows),
        "role": "DIAGNOSTIC_ONLY_NOT_SELECTOR_PVALUE_LCB_OR_VERDICT_OVERRIDE",
        "rows": rows,
    }


def scenario_intervals(
    evaluation: TrialEvaluation,
    scenario_id: str,
    *,
    base_seed: int,
    replicates: int,
) -> dict[str, object]:
    returns = evaluation.scenario(scenario_id).daily_returns
    output: dict[str, object] = {}
    for block_length in (7, 14):
        distribution = bootstrap_terminal_distribution(
            returns,
            block_length=block_length,
            replicates=replicates,
            seed=stable_seed(
                base_seed,
                f"{evaluation.spec.trial_id}:{scenario_id}:{block_length}",
            ),
        )
        output[str(block_length)] = {
            "blockDays": block_length,
            "lower95UsdPer1000": empirical_quantile_float(distribution, 0.025),
            "upper95UsdPer1000": empirical_quantile_float(distribution, 0.975),
            "bonferroniLowerUsdPer1000": empirical_quantile_float(distribution, 0.05 / 6.0),
        }
    return output


def build_development_statistics(
    evaluations: Sequence[TrialEvaluation],
) -> dict[str, object]:
    protocol_value = protocol()
    bootstrap_config = protocol_value["statistics"]["bootstrap"]
    replicates = int(bootstrap_config["replicates"])
    base_seed = int(bootstrap_config["developmentSeed"])
    stress_intervals = {
        evaluation.spec.trial_id: scenario_intervals(
            evaluation,
            "public_stress",
            base_seed=base_seed,
            replicates=replicates,
        )
        for evaluation in evaluations
    }
    white = white_style_statistics(
        evaluations,
        block_length=7,
        replicates=replicates,
        seed=stable_seed(base_seed, "white-style"),
    )
    raw_p = cast(dict[str, float], white["individualOneSidedP"])
    holm = holm_adjust(raw_p, 0.05)
    pbo = pbo_cscv(evaluations)

    def selection_key(evaluation: TrialEvaluation) -> tuple[float, float, float, str]:
        intervals = cast(
            dict[str, dict[str, float]],
            stress_intervals[evaluation.spec.trial_id],
        )
        minimum_bonferroni = min(
            intervals["7"]["bonferroniLowerUsdPer1000"],
            intervals["14"]["bonferroniLowerUsdPer1000"],
        )
        stress_net = float(evaluation.scenario("public_stress").nav - D(1000))
        drawdown = float(evaluation.scenario("public_stress").drawdown.maximum_pct)
        return (-minimum_bonferroni, -stress_net, drawdown, evaluation.spec.trial_id)

    champion = sorted(evaluations, key=selection_key)[0]
    champion_intervals = {
        scenario_id: scenario_intervals(
            champion,
            scenario_id,
            base_seed=base_seed,
            replicates=replicates,
        )
        for scenario_id in ("public_base", "public_stress", "fee_stress")
    }
    return {
        "schema": "cosmos.quant.research.s2h.development_statistics.v1",
        "bootstrapReplicates": replicates,
        "stressIntervalsByTrial": stress_intervals,
        "whiteStyleRealityCheck": white,
        "holm": holm,
        "pbo": pbo,
        "championTrialId": champion.spec.trial_id,
        "championIntervals": champion_intervals,
        "championSelection": (
            "HIGHEST_MINIMUM_STRESS_BONFERRONI_LOWER_7_14_THEN_STRESS_NET_"
            "THEN_LOWER_STRESS_DRAWDOWN_THEN_TRIAL_ID"
        ),
    }


def capacity_p05(evaluation: TrialEvaluation) -> Decimal | None:
    if not evaluation.capacities:
        return None
    return empirical_quantile_decimal(sorted(evaluation.capacities), D("0.05"))


def development_gate(
    champion: TrialEvaluation,
    statistics_value: Mapping[str, Any],
) -> dict[str, object]:
    trial_id = champion.spec.trial_id
    intervals = cast(
        Mapping[str, Mapping[str, float]],
        statistics_value["championIntervals"]["public_stress"],
    )
    holm = cast(Mapping[str, Mapping[str, Any]], statistics_value["holm"])
    capacity = capacity_p05(champion)
    checks: dict[str, bool] = {
        "publicBaseNetPositive": champion.scenario("public_base").nav > D(1000),
        "publicStressNetPositive": champion.scenario("public_stress").nav > D(1000),
        "feeStressNetPositive": champion.scenario("fee_stress").nav > D(1000),
        "stressPrimary95LowerPositive": intervals["7"]["lower95UsdPer1000"] > 0,
        "stressSensitivity95LowerPositive": intervals["14"]["lower95UsdPer1000"] > 0,
        "stressPrimaryBonferroniLowerPositive": (intervals["7"]["bonferroniLowerUsdPer1000"] > 0),
        "stressSensitivityBonferroniLowerPositive": (
            intervals["14"]["bonferroniLowerUsdPer1000"] > 0
        ),
        "holmPassed": bool(holm[trial_id]["passed"]),
        "whiteStyleRealityCheckPassed": (
            float(statistics_value["whiteStyleRealityCheck"]["jointMaximumP"]) <= 0.05
        ),
        "minimumActiveDays": champion.active_days >= 180,
        "minimumDistinctTradedSymbols": len(champion.distinct_symbols) >= 15,
        "minimumPositiveStressMonths": (champion.scenario("public_stress").positive_months() >= 5),
        "maximumStressDrawdown": (champion.scenario("public_stress").drawdown.maximum_pct <= D(25)),
        "minimumStressCapacityProxy": (capacity is not None and capacity >= D(1000)),
    }
    return {
        "trialId": trial_id,
        "checks": checks,
        "passedCount": sum(checks.values()),
        "requiredCount": len(checks),
        "allPassed": all(checks.values()),
        "pboIsGate": False,
    }


def centered_single_trial_pvalue(
    returns: Sequence[Decimal],
    *,
    block_length: int,
    replicates: int,
    seed: int,
) -> float:
    values = [float(item) for item in returns]
    observed = statistics.fmean(values)
    centered = [item - observed for item in values]
    rng = random.Random(seed)
    exceed = 0
    for _ in range(replicates):
        indices = circular_indices(len(centered), block_length, rng)
        bootstrap_mean = math.fsum(centered[index] for index in indices) / len(centered)
        if bootstrap_mean >= observed:
            exceed += 1
    return (exceed + 1) / (replicates + 1)


def build_holdout_statistics(evaluation: TrialEvaluation) -> dict[str, object]:
    bootstrap_config = protocol()["statistics"]["bootstrap"]
    replicates = int(bootstrap_config["replicates"])
    base_seed = int(bootstrap_config["holdoutSeed"])
    intervals = {
        scenario_id: scenario_intervals(
            evaluation,
            scenario_id,
            base_seed=base_seed,
            replicates=replicates,
        )
        for scenario_id in ("public_base", "public_stress", "fee_stress")
    }
    p_value = centered_single_trial_pvalue(
        evaluation.scenario("public_stress").daily_returns,
        block_length=7,
        replicates=replicates,
        seed=stable_seed(base_seed, "holdout-p"),
    )
    return {
        "bootstrapReplicates": replicates,
        "intervals": intervals,
        "stressOneSidedP": p_value,
    }


def holdout_gate(
    evaluation: TrialEvaluation,
    statistics_value: Mapping[str, Any],
) -> dict[str, object]:
    stress_intervals = cast(
        Mapping[str, Mapping[str, float]],
        statistics_value["intervals"]["public_stress"],
    )
    capacity = capacity_p05(evaluation)
    checks: dict[str, bool] = {
        "publicBaseNetPositive": evaluation.scenario("public_base").nav > D(1000),
        "publicStressNetPositive": evaluation.scenario("public_stress").nav > D(1000),
        "feeStressNetPositive": evaluation.scenario("fee_stress").nav > D(1000),
        "stressPrimary95LowerPositive": (stress_intervals["7"]["lower95UsdPer1000"] > 0),
        "stressSensitivity95LowerPositive": (stress_intervals["14"]["lower95UsdPer1000"] > 0),
        "stressOneSidedP": float(statistics_value["stressOneSidedP"]) <= 0.05,
        "minimumActiveDays": evaluation.active_days >= 90,
        "minimumDistinctTradedSymbols": len(evaluation.distinct_symbols) >= 10,
        "minimumPositiveStressMonths": (
            evaluation.scenario("public_stress").positive_months() >= 3
        ),
        "maximumStressDrawdown": (
            evaluation.scenario("public_stress").drawdown.maximum_pct <= D(25)
        ),
        "minimumStressCapacityProxy": (capacity is not None and capacity >= D(1000)),
    }
    return {
        "checks": checks,
        "passedCount": sum(checks.values()),
        "requiredCount": len(checks),
        "allPassed": all(checks.values()),
    }


def verify_freeze_binding(state_root: Path) -> dict[str, Any]:
    freeze_value = load_json(FREEZE_PATH)
    if freeze_value.get("state") != "FROZEN_BEFORE_HOURLY_ARCHIVE_MEMBER_OPEN":
        raise EvidenceError("freeze state mismatch")
    if freeze_value.get("canonicalBaseCommit") != BASE_COMMIT:
        raise EvidenceError("freeze base mismatch")
    if freeze_value.get("stateRootResolved") != str(state_root.resolve(strict=True)):
        raise EvidenceError("freeze state root mismatch")
    static_hashes = cast(dict[str, str], freeze_value["staticFileSha256"])
    for name, expected in static_hashes.items():
        if sha256_path(HERE / name) != expected:
            raise EvidenceError(f"static freeze drift: {name}")
    if (
        sha256_path(PROTOCOL_PATH) != freeze_value["protocolSha256"]
        or sha256_path(UNIVERSE_PATH) != freeze_value["universeSha256"]
        or sha256_path(SOURCE_MANIFEST_PATH) != freeze_value["sourceManifestSha256"]
        or sha256_path(SCREEN_MARKER_PATH) != freeze_value["screenMarkerSha256"]
    ):
        raise EvidenceError("freeze directed hash mismatch")
    return freeze_value


def result_common(
    *,
    terminal_label: str,
    reason: str,
    holdout_state: str,
    development: Mapping[str, Any] | None,
    holdout: Mapping[str, Any] | None,
) -> dict[str, object]:
    champion_id: str | None = None
    champion: Mapping[str, Any] | None = None
    statistics_value: Mapping[str, Any] | None = None
    if development is not None:
        statistics_value = cast(Mapping[str, Any], development["statistics"])
        champion_id = cast(str, statistics_value["championTrialId"])
        for row in cast(list[Mapping[str, Any]], development["trials"]):
            if row["trial"]["trialId"] == champion_id:
                champion = row
                break
    return {
        "schema": "cosmos.quant.research.s2h.result.v1",
        "milestone": "S-2H",
        "terminalLabel": terminal_label,
        "reason": reason,
        "createdAtUtc": utc_now_text(),
        "canonicalBaseCommit": BASE_COMMIT,
        "protocolSha256": sha256_path(PROTOCOL_PATH),
        "freezeSha256": sha256_path(FREEZE_PATH),
        "runMarkerSha256": sha256_path(RUN_MARKER_PATH),
        "developmentSha256": (sha256_path(DEVELOPMENT_PATH) if DEVELOPMENT_PATH.exists() else None),
        "selectionSha256": (sha256_path(SELECTION_PATH) if SELECTION_PATH.exists() else None),
        "holdoutOpenSha256": (
            sha256_path(HOLDOUT_OPEN_PATH) if HOLDOUT_OPEN_PATH.exists() else None
        ),
        "holdoutSha256": (sha256_path(HOLDOUT_PATH) if HOLDOUT_PATH.exists() else None),
        "championTrialId": champion_id,
        "championDevelopment": champion,
        "developmentStatistics": statistics_value,
        "holdout": holdout,
        "holdoutState": holdout_state,
        "publicSyntheticNetMeasured": development is not None,
        "accountEffectiveNetUsdPerInitial1000": None,
        "accountEffectiveFees": "UNKNOWN",
        "shortBorrowAvailabilityAndCost": "UNKNOWN",
        "historicalFilters": "UNKNOWN",
        "executableCapacity": "UNMEASURED",
        "capacityAuthority": "PUBLIC_PRIOR_COMPLETE_DAY_QUOTE_VOLUME_PROXY_ONLY",
        "globalHoldoutState": "NOT_CERTIFIED_SHARED_REUSE_RISK",
        "limitations": [
            "SPOT_IS_CONTINUOUS_UTC_BOUNDARY_IS_NOT_A_MARKET_CLOSE",
            "SYNTHETIC_SHORT_BORROW_INVENTORY_AND_INTEREST_UNKNOWN",
            "ACCOUNT_EFFECTIVE_COMMISSION_UNKNOWN",
            ("HISTORICAL_FILTERS_SPREAD_DEPTH_IMPACT_AND_EXECUTABLE_CAPACITY_UNMEASURED"),
            "PRIOR_DISCOVERY_ASCII_CANDIDATE_GRAMMAR_LIMITATION",
            "GLOBAL_HOLDOUT_NOT_CERTIFIED_SHARED_REUSE_RISK",
        ],
        "capitalVerdict": "NO_GO",
        "executionAuthority": "NONE",
        "moneyMovedUsd": 0,
        "consumer": "N3-S1_OR_SUCCESSOR_SCOREBOARD",
    }


def write_terminal_unmeasured(reason: str) -> dict[str, object]:
    if RESULT_PATH.exists():
        return cast(dict[str, object], load_json(RESULT_PATH))
    holdout_state = (
        "OPENED_TERMINAL_UNMEASURED" if HOLDOUT_OPEN_PATH.exists() else "SEALED_UNOPENED"
    )
    result = result_common(
        terminal_label="UNMEASURED",
        reason=reason,
        holdout_state=holdout_state,
        development=load_json(DEVELOPMENT_PATH) if DEVELOPMENT_PATH.exists() else None,
        holdout=load_json(HOLDOUT_PATH) if HOLDOUT_PATH.exists() else None,
    )
    write_exclusive_json(RESULT_PATH, result)
    return result


def run_experiment(state_root: Path) -> dict[str, object]:
    if RUN_MARKER_PATH.exists() or RESULT_PATH.exists():
        raise EvidenceError("sealed outcome run already consumed")
    root = state_root.resolve(strict=True)
    freeze_value = verify_freeze_binding(root)
    marker = {
        "schema": "cosmos.quant.research.s2h.run_marker.v1",
        "state": "SOLE_OUTCOME_RUN_CONSUMED_BEFORE_DEVELOPMENT_MEMBER_OPEN",
        "createdAtUtc": utc_now_text(),
        "freezeSha256": sha256_path(FREEZE_PATH),
        "protocolSha256": sha256_path(PROTOCOL_PATH),
        "sourceManifestSha256": sha256_path(SOURCE_MANIFEST_PATH),
        "preOutcomeHead": freeze_value["preOutcomeHead"],
        "allowedRunCount": 1,
        "runOrdinal": 1,
        "networkDuringEvaluation": False,
        "holdoutMemberOpenCountAtCreation": 0,
    }
    write_exclusive_json(RUN_MARKER_PATH, marker)
    try:
        universe = load_json(UNIVERSE_PATH)
        symbols = cast(list[str], universe["selectedSymbols"])
        development_months = month_sequence("2025-06", "2026-02")
        development_series, development_member_count = load_hour_series(
            root, symbols, development_months
        )
        development_dates = date_range(date(2025, 7, 1), date(2026, 3, 1))
        if len(development_dates) != 243:
            raise EvidenceError("development calendar count")
        evaluations = evaluate_family(development_series, symbols, development_dates, trial_specs())
        statistics_value = build_development_statistics(evaluations)
        champion_id = cast(str, statistics_value["championTrialId"])
        champion = next(item for item in evaluations if item.spec.trial_id == champion_id)
        gate = development_gate(champion, statistics_value)
        development = {
            "schema": "cosmos.quant.research.s2h.development.v1",
            "state": "DEVELOPMENT_EVALUATED_ONCE",
            "createdAtUtc": utc_now_text(),
            "runMarkerSha256": sha256_path(RUN_MARKER_PATH),
            "freezeSha256": sha256_path(FREEZE_PATH),
            "memberOpenCount": development_member_count,
            "monthsOpened": list(development_months),
            "scheduledDays": len(development_dates),
            "trials": [item.as_mapping() for item in evaluations],
            "statistics": statistics_value,
            "gate": gate,
            "holdoutMembersOpened": 0,
        }
        write_exclusive_json(DEVELOPMENT_PATH, development)
        if not bool(gate["allPassed"]):
            result = result_common(
                terminal_label="NO_GO",
                reason="DEVELOPMENT_GATES_NOT_ALL_PASSED",
                holdout_state="SEALED_UNOPENED",
                development=development,
                holdout=None,
            )
            write_exclusive_json(RESULT_PATH, result)
            return result
        selection = {
            "schema": "cosmos.quant.research.s2h.selection.v1",
            "state": "ONE_DEVELOPMENT_CHAMPION_SEALED",
            "createdAtUtc": utc_now_text(),
            "trialId": champion_id,
            "developmentSha256": sha256_path(DEVELOPMENT_PATH),
            "developmentGate": gate,
            "runnerUpSubstitution": False,
            "reselection": False,
        }
        write_exclusive_json(SELECTION_PATH, selection)
        holdout_open = {
            "schema": "cosmos.quant.research.s2h.holdout_open.v1",
            "state": "SOLE_HOLDOUT_OPEN_CONSUMED_BEFORE_MEMBER_OPEN",
            "createdAtUtc": utc_now_text(),
            "selectionSha256": sha256_path(SELECTION_PATH),
            "developmentSha256": sha256_path(DEVELOPMENT_PATH),
            "freezeSha256": sha256_path(FREEZE_PATH),
            "trialId": champion_id,
            "openOrdinal": 1,
        }
        write_exclusive_json(HOLDOUT_OPEN_PATH, holdout_open)
        holdout_months = month_sequence("2026-03", "2026-06")
        holdout_series, holdout_member_count = load_hour_series(root, symbols, holdout_months)
        holdout_dates = date_range(date(2026, 3, 8), date(2026, 7, 1))
        if len(holdout_dates) != 115:
            raise EvidenceError("holdout calendar count")
        holdout_evaluation = evaluate_trial(
            holdout_series,
            symbols,
            champion.spec,
            holdout_dates,
        )
        holdout_statistics = build_holdout_statistics(holdout_evaluation)
        holdout_gate_value = holdout_gate(holdout_evaluation, holdout_statistics)
        holdout = {
            "schema": "cosmos.quant.research.s2h.holdout.v1",
            "state": "HOLDOUT_EVALUATED_ONCE_CHAMPION_ONLY",
            "createdAtUtc": utc_now_text(),
            "holdoutOpenSha256": sha256_path(HOLDOUT_OPEN_PATH),
            "trial": holdout_evaluation.as_mapping(),
            "statistics": holdout_statistics,
            "gate": holdout_gate_value,
            "memberOpenCount": holdout_member_count,
            "monthsOpened": list(holdout_months),
            "scheduledDays": len(holdout_dates),
        }
        write_exclusive_json(HOLDOUT_PATH, holdout)
        if bool(holdout_gate_value["allPassed"]):
            label = "PUBLIC_PROXY_PASS_CAPITAL_NO_GO"
            reason = "LOCAL_PUBLIC_PROXY_GATES_PASSED_CAPITAL_BLOCKERS_REMAIN"
        else:
            label = "NO_GO"
            reason = "HOLDOUT_GATES_NOT_ALL_PASSED"
        result = result_common(
            terminal_label=label,
            reason=reason,
            holdout_state="OPENED_EVALUATED_ONCE",
            development=development,
            holdout=holdout,
        )
        write_exclusive_json(RESULT_PATH, result)
        return result
    except BaseException as exc:
        reason = f"{type(exc).__name__}:{exc}"
        write_terminal_unmeasured(reason)
        raise


def print_json(value: object) -> None:
    sys.stdout.write(canonical_bytes(value).decode("utf-8"))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Sealed S-2H Binance Spot UTC-boundary gap experiment"
    )
    subparsers = parser.add_subparsers(dest="command", required=True)
    prepare_parser = subparsers.add_parser("prepare")
    prepare_parser.add_argument("--anchor-cache", type=Path, required=True)
    acquire_parser = subparsers.add_parser("acquire")
    acquire_parser.add_argument("--state-root", type=Path, default=DEFAULT_STATE_ROOT)
    acquire_parser.add_argument("--workers", type=int, default=8)
    freeze_parser = subparsers.add_parser("freeze")
    freeze_parser.add_argument("--state-root", type=Path, default=DEFAULT_STATE_ROOT)
    run_parser = subparsers.add_parser("run")
    run_parser.add_argument("--state-root", type=Path, default=DEFAULT_STATE_ROOT)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = build_parser().parse_args(argv)
    try:
        if arguments.command == "prepare":
            value = prepare(cast(Path, arguments.anchor_cache))
        elif arguments.command == "acquire":
            workers = int(arguments.workers)
            if not 1 <= workers <= 32:
                raise EvidenceError("workers must be between 1 and 32")
            value = acquire(cast(Path, arguments.state_root), workers)
        elif arguments.command == "freeze":
            value = freeze(cast(Path, arguments.state_root))
        elif arguments.command == "run":
            value = run_experiment(cast(Path, arguments.state_root))
        else:
            raise EvidenceError("unknown command")
    except EvidenceError as exc:
        sys.stderr.write(f"S2H_ERROR {exc}\n")
        return 2
    print_json(value)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
