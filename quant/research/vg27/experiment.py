#!/usr/bin/env python3
"""Deterministic sealed V-G27 Binance-public-only experiment."""

from __future__ import annotations

import argparse
import calendar
import contextlib
import csv
import hashlib
import io
import itertools
import json
import math
import os
import platform
import random
import re
import stat
import subprocess
import sys
import tempfile
import time
import urllib.request
import zipfile
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal, InvalidOperation, getcontext
from pathlib import Path
from typing import Any, Final

getcontext().prec = 50

PACKET_DIR: Final = Path(__file__).resolve().parent
REPO_ROOT: Final = PACKET_DIR.parents[2]
PROTOCOL_PATH: Final = PACKET_DIR / "protocol.v1.json"
README_PATH: Final = PACKET_DIR / "README.md"
SOURCE_RESEARCH_PATH: Final = PACKET_DIR / "OFFICIAL_SOURCE_RESEARCH.md"
DISTINCTNESS_PATH: Final = PACKET_DIR / "DISTINCTNESS.md"
INIT_PATH: Final = PACKET_DIR / "__init__.py"
TEST_PATH: Final = PACKET_DIR / "test_experiment.py"
DEFAULT_STATE_ROOT: Final = Path(
    "/Users/cosmosgeek/.codex/research-data/vg27-quote-volume-dispersion-1be1-d010"
)
BASE_COMMIT: Final = "a169b123fb186d1943a75ad648552c4d95be1be1"
ARCHIVE_BASE: Final = "https://data.binance.vision/data/spot/monthly/klines"
COHORT: Final = (
    "ADAUSDT",
    "AVAXUSDT",
    "BNBUSDT",
    "BTCUSDT",
    "DOGEUSDT",
    "ETHUSDT",
    "LINKUSDT",
    "SOLUSDT",
    "TRXUSDT",
    "XRPUSDT",
)
MONTHS: Final = tuple(
    f"{year:04d}-{month:02d}" for year, month in ((2025, month) for month in range(1, 13))
) + tuple(f"2026-{month:02d}" for month in range(1, 7))
DEVELOPMENT_MONTHS: Final = MONTHS[:15]
HOLDOUT_MONTHS: Final = MONTHS[15:]
WARMUP_START: Final = datetime(2025, 1, 1, tzinfo=UTC)
DEVELOPMENT_START: Final = datetime(2025, 7, 1, tzinfo=UTC)
DEVELOPMENT_END: Final = datetime(2026, 4, 1, tzinfo=UTC)
FIRST_ELIGIBLE_FORMATION: Final = datetime(2025, 7, 2, tzinfo=UTC)
HOLDOUT_START: Final = DEVELOPMENT_END
HOLDOUT_END: Final = datetime(2026, 7, 1, tzinfo=UTC)
DEVELOPMENT_ACTIVITY_MONTHS: Final = frozenset(MONTHS[6:15])
HOLDOUT_ACTIVITY_MONTHS: Final = frozenset(HOLDOUT_MONTHS)
FORMATION_HOURS: Final = frozenset((0, 6, 12, 18))
HOUR_US: Final = 3_600_000_000
WEEK: Final = timedelta(days=7)
STARTING_USD: Final = Decimal("1000")
CAPACITY_PARTICIPATION: Final = Decimal("0.0001")
STORED_DECIMAL_TOLERANCE: Final = Decimal("0.000000000005")
BOOTSTRAP_BLOCK_HOURS: Final = 168
BOOTSTRAP_REPLICATES: Final = 2048
BOOTSTRAP_SEED: Final = 270027
DEVELOPMENT_OBSERVATIONS: Final = 6575
HOLDOUT_OBSERVATIONS: Final = 2183
CHECKSUM_RE: Final = re.compile(rb"^([0-9a-f]{64})[ \t]+\*?([^\r\n]+)\r?\n?$")
SOURCE_MANIFEST_NAME: Final = "source-manifest.v1.json"
FREEZE_V1_NAME: Final = "freeze.v1.json"
FREEZE_V2_NAME: Final = "freeze.v2.json"
FREEZE_V3_NAME: Final = "freeze.v3.json"
FREEZE_NAME: Final = "freeze.v4.json"
FREEZE_VERSION: Final = "VG27FreezeV4"
FREEZE_V1_SUPERSESSION_NAME: Final = "freeze-v1-supersession.v1.json"
FREEZE_V2_SUPERSESSION_NAME: Final = "freeze-v2-supersession.v1.json"
FREEZE_V3_SUPERSESSION_NAME: Final = "freeze-v3-supersession.v1.json"
FREEZE_V1_SHA256: Final = "d1a984eee016249fc6863d8e4a36733028d5634b368c4c98594c93de9a788ee6"
FREEZE_V2_SHA256: Final = "f4e21a4d26442f28adea6a80ad237cb18d5c49c7ac7caf6b396d6bcd28ac62b0"
FREEZE_V3_SHA256: Final = "54fdea8026e99b68653368bef2fbb6b44ceb98b11b14848a525a7dd0bfcef2da"
REJECTED_V2_AUTHORITY_HEAD: Final = "05668f7a7cefcaaae412a7c9a2cdb6339818eb75"
REJECTED_V3_AUTHORITY_HEAD: Final = "5b5ff77e4173dff9b4588d9f85f9c79d738a78a8"
DEVELOPMENT_MARKER_NAME: Final = "development-open.v1.json"
DEVELOPMENT_SELECTION_NAME: Final = "development-selection.v1.json"
HOLDOUT_MARKER_NAME: Final = "holdout-open.v1.json"
RESULT_NAME: Final = "result.v1.json"
CUSTODY_TERMINAL_NAME: Final = "custody-terminal.v1.json"
SHA256SUMS_NAME: Final = "SHA256SUMS"
OPEN_MARKER_VERSION: Final = "VG27OpenMarkerV2"
RESULT_VERSION: Final = "VG27ResultV2"
CUSTODY_TERMINAL_VERSION: Final = "VG27CustodyTerminalV2"
TRACKED_RECEIPTS: Final = (
    DEVELOPMENT_MARKER_NAME,
    DEVELOPMENT_SELECTION_NAME,
    HOLDOUT_MARKER_NAME,
    RESULT_NAME,
)
RUNTIME_LOCK_PATHS: Final = (
    REPO_ROOT / "quant" / "pyproject.toml",
    REPO_ROOT / "quant" / "uv.lock",
)
PROGRAM_MULTIPLICITY: Final = {
    "localHolmWhiteCanEstablishVerifiedPositive": False,
    "sharedDateDependence": "NOT_RESOLVED",
    "status": "NOT_CONVERGED",
    "scope": "V_G1_THROUGH_V_G27_PROGRAM_WIDE_FAMILY",
}
PROTOCOL_HOLM_AUTHORITY: Final = (
    "RECONSTRUCT_EXACT_STORED_12DP_ADJUSTMENTS_FROM_ALL_12_VALIDATED_BASE_BOOTSTRAP_RAW_P_VALUES"
)
PROTOCOL_COST_CALCULATION: Final = (
    "EACH_SERIALIZED_ROW_REPORTS_DIRECTLY_ACCUMULATED_ENTRY_PLUS_EXIT_"
    "REFERENCE_NOTIONAL_AND_FROZEN_PER_SIDE_RATES; COSTS_EQUAL_NOTIONAL_"
    "TIMES_RATE_WITHIN_0.000000000005; GROSS_AND_ZERO_EVENT_COSTS_EXACT_ZERO"
)
PROTOCOL_FREEZE_CUSTODY: Final = (
    "FREEZE_V4_BINDS_PRESERVED_V1_V2_V3_STATIC_INPUTS_INTERPRETER_"
    "DECIMAL_CONTEXT_QUANT_RUNTIME_LOCKS_AND_EXACT_V3_SUPERSESSION"
)
DEVELOPMENT_GATE_NAMES: Final = frozenset(
    (
        "activeMonthsAtLeast8",
        "baseLcbPositive",
        "baseNetPositive",
        "drawdownAtMost20Pct",
        "holmAdjustedPBelow0.05",
        "nominalInitial1000ScreenAtLeast1000",
        "onEventsAtLeast100",
        "stressLcbPositive",
        "stressNetPositive",
        "whitePBelow0.05",
    )
)
HOLDOUT_GATE_NAMES: Final = frozenset(
    (
        "baseLcbPositive",
        "baseNetPositive",
        "drawdownAtMost20Pct",
        "nominalInitial1000ScreenAtLeast1000",
        "stressLcbPositive",
        "stressNetPositive",
    )
)


class VG27Error(RuntimeError):
    """Fail-closed V-G27 protocol, custody, or measurement error."""


class CustodyError(VG27Error):
    """Exact-byte or one-run custody failed."""


class MeasurementError(VG27Error):
    """Required cohort evidence is absent or malformed."""


@dataclass(frozen=True, slots=True)
class Trial:
    trial_id: str
    lookback_weeks: int
    dispersion_multiple: Decimal
    hold_hours: int


@dataclass(frozen=True, slots=True)
class Bar:
    symbol: str
    opened_at: datetime
    open_price: Decimal
    high_price: Decimal
    low_price: Decimal
    close_price: Decimal
    quote_volume: Decimal
    open_time_us: int
    close_time_us: int


@dataclass(frozen=True, slots=True)
class Signal:
    on: bool
    current_dispersion: Decimal
    reference_dispersion: Decimal
    nominal_initial_1000_screen_usd: Decimal


@dataclass(frozen=True, slots=True)
class Event:
    signal_at: datetime
    entry_at: datetime
    exit_at: datetime
    nominal_initial_1000_screen_usd: Decimal


@dataclass(frozen=True, slots=True)
class Scenario:
    name: str
    fee_per_side: Decimal
    adverse_per_side: Decimal


@dataclass(frozen=True, slots=True)
class Simulation:
    trial_id: str
    scenario: str
    events: tuple[Event, ...]
    times: tuple[datetime, ...]
    hourly_returns: tuple[Decimal, ...]
    equity_at_open: tuple[Decimal, ...]
    ending_usd: Decimal
    chargeable_entry_exit_reference_notional_usd: Decimal
    gross_trading_pnl_usd: Decimal
    fee_cost_usd: Decimal
    adverse_cost_usd: Decimal
    minimum_nominal_initial_1000_screen_usd: Decimal | None
    maximum_entry_to_screen_ratio: Decimal | None
    max_drawdown: Decimal


def canonical_bytes(value: object) -> bytes:
    return (
        json.dumps(value, ensure_ascii=True, separators=(",", ":"), sort_keys=True) + "\n"
    ).encode()


def sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def packet_artifact(name: str) -> Path:
    return PACKET_DIR / name


def git_output(*arguments: str) -> str:
    completed = subprocess.run(
        ("git", "-C", str(REPO_ROOT), *arguments),
        check=True,
        capture_output=True,
        text=True,
    )
    return completed.stdout.strip()


def utc_now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def fsync_parent(path: Path) -> None:
    descriptor = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def write_exclusive(path: Path, value: object | bytes) -> None:
    raw = value if isinstance(value, bytes) else canonical_bytes(value)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() or path.is_symlink():
        raise CustodyError(f"refusing to overwrite sealed artifact: {path.name}")
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        fsync_parent(path)
    except BaseException:
        with contextlib.suppress(OSError):
            path.unlink(missing_ok=True)
        raise


def cleanup_unpublished_packet_temps(path: Path) -> None:
    """Discard only regular, unpublished temp inodes for this exact authority path."""

    prefix = f".{path.name}.pending."
    removed = False
    for candidate in path.parent.iterdir():
        if not candidate.name.startswith(prefix):
            continue
        metadata = os.lstat(candidate)
        if not stat.S_ISREG(metadata.st_mode):
            raise CustodyError(f"packet pending path is not regular: {candidate.name}")
        candidate.unlink()
        removed = True
    if removed:
        fsync_parent(path)


def write_packet_authority_exclusive(path: Path, value: object | bytes) -> None:
    """Atomically publish complete packet bytes without replacing an existing path.

    The same-directory temp inode is created with O_EXCL, fully written and
    fsynced, then hard-linked at the authority name. POSIX link publication is
    atomic and fails if the authority path already exists. An interrupted
    pre-link temp is not authority and is safely discarded on the next attempt.
    """

    raw = value if isinstance(value, bytes) else canonical_bytes(value)
    path.parent.mkdir(parents=True, exist_ok=True)
    cleanup_unpublished_packet_temps(path)
    if path.exists() or path.is_symlink():
        raise CustodyError(f"refusing to overwrite sealed artifact: {path.name}")
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.pending.",
        dir=path.parent,
    )
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        try:
            os.link(temporary, path, follow_symlinks=False)
        except FileExistsError as error:
            raise CustodyError(f"refusing to overwrite sealed artifact: {path.name}") from error
        fsync_parent(path)
    finally:
        if temporary.exists() or temporary.is_symlink():
            temporary.unlink()
            fsync_parent(path)


def write_atomic(path: Path, value: object | bytes) -> None:
    raw = value if isinstance(value, bytes) else canonical_bytes(value)
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        fsync_parent(path)
    finally:
        temporary.unlink(missing_ok=True)


def write_exclusive_or_accept_identical(path: Path, value: object | bytes) -> None:
    raw = value if isinstance(value, bytes) else canonical_bytes(value)
    if path.exists() or path.is_symlink():
        if path.is_symlink() or not path.is_file() or path.read_bytes() != raw:
            raise CustodyError(f"existing artifact differs: {path.name}")
        return
    write_exclusive(path, raw)


def load_json(path: Path, *, canonical: bool = False) -> dict[str, Any]:
    if path.is_symlink() or not path.is_file():
        raise CustodyError(f"required regular file unavailable: {path}")
    raw = path.read_bytes()
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as error:
        raise CustodyError(f"invalid JSON: {path.name}") from error
    if not isinstance(value, dict):
        raise CustodyError(f"JSON root is not an object: {path.name}")
    if canonical and raw != canonical_bytes(value):
        raise CustodyError(f"non-canonical JSON: {path.name}")
    return value


def decimal_value(raw: str, field: str, *, positive: bool = False) -> Decimal:
    try:
        value = Decimal(raw)
    except InvalidOperation as error:
        raise MeasurementError(f"{field} is not decimal") from error
    if not value.is_finite() or value < 0 or (positive and value <= 0):
        raise MeasurementError(f"{field} is outside its domain")
    return value


def decimal_text(value: Decimal, places: int = 12) -> str:
    return format(value.quantize(Decimal(1).scaleb(-places)), "f")


def required_text(value: object, field: str) -> str:
    if not isinstance(value, str):
        raise MeasurementError(f"{field} must be text")
    return value


def required_mapping(value: object, field: str) -> dict[str, Any]:
    if not isinstance(value, dict) or any(not isinstance(key, str) for key in value):
        raise CustodyError(f"{field} must be an object with text keys")
    return value


def required_bool(value: object, field: str) -> bool:
    if not isinstance(value, bool):
        raise CustodyError(f"{field} must be boolean")
    return value


def required_int(value: object, field: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool):
        raise CustodyError(f"{field} must be integer")
    return value


def receipt_decimal(value: object, field: str) -> Decimal:
    if not isinstance(value, str):
        raise CustodyError(f"{field} must be decimal text")
    try:
        parsed = Decimal(value)
    except InvalidOperation as error:
        raise CustodyError(f"{field} decimal text invalid") from error
    if not parsed.is_finite():
        raise CustodyError(f"{field} must be finite")
    return parsed


def require_exact_keys(
    value: Mapping[str, object],
    expected: set[str],
    field: str,
) -> None:
    if set(value) != expected:
        raise CustodyError(f"{field} keys invalid")


def trial_grid() -> tuple[Trial, ...]:
    return tuple(
        Trial(
            f"VG27-L{lookback:02d}-D{int(multiple * 100):03d}-H{hold:02d}",
            lookback,
            multiple,
            hold,
        )
        for lookback, multiple, hold in itertools.product(
            (8, 13, 26), (Decimal("1.5"), Decimal("2.0")), (4, 12)
        )
    )


def scenarios() -> tuple[Scenario, ...]:
    return (
        Scenario("gross", Decimal(0), Decimal(0)),
        Scenario("base", Decimal("0.0010"), Decimal("0.0005")),
        Scenario("stress", Decimal("0.0010"), Decimal("0.0015")),
        Scenario("severe", Decimal("0.0020"), Decimal("0.0025")),
    )


def hour_range(start: datetime, end_exclusive: datetime) -> tuple[datetime, ...]:
    count = int((end_exclusive - start).total_seconds() // 3600)
    return tuple(start + timedelta(hours=index) for index in range(count))


def month_bounds(month: str) -> tuple[datetime, datetime]:
    year, month_number = (int(part) for part in month.split("-"))
    start = datetime(year, month_number, 1, tzinfo=UTC)
    end = start + timedelta(hours=calendar.monthrange(year, month_number)[1] * 24)
    return start, end


def median(values: Sequence[Decimal]) -> Decimal:
    if not values:
        raise MeasurementError("median requires observations")
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) / Decimal(2)


def mad(values: Sequence[Decimal]) -> Decimal:
    center = median(values)
    return median(tuple(abs(value - center) for value in values))


def log1p_decimal(value: Decimal) -> Decimal:
    if value < 0:
        raise MeasurementError("quote volume cannot be negative")
    return (Decimal(1) + value).ln()


def parse_timestamp_us(raw: str, field: str) -> tuple[int, datetime]:
    if not raw.isascii() or not raw.isdigit() or len(raw) != 16:
        raise MeasurementError(f"{field} must be a 16-digit microsecond timestamp")
    value = int(raw)
    parsed = datetime(1970, 1, 1, tzinfo=UTC) + timedelta(microseconds=value)
    return value, parsed


def verify_checksum_text(raw: bytes, expected_name: str, expected_sha: str) -> None:
    match = CHECKSUM_RE.fullmatch(raw)
    if match is None:
        raise CustodyError("publisher checksum grammar invalid")
    try:
        name = match.group(2).decode("ascii")
    except UnicodeDecodeError as error:
        raise CustodyError("publisher checksum is not ASCII") from error
    if name != expected_name or match.group(1).decode() != expected_sha:
        raise CustodyError("publisher checksum does not bind exact archive")


def _artifact_text(artifact: Mapping[str, object], field: str) -> str:
    value = artifact.get(field)
    if not isinstance(value, str) or not value:
        raise CustodyError(f"artifact {field} invalid")
    return value


def validate_artifact_bytes(
    artifact: Mapping[str, object],
    source_root: Path,
) -> tuple[Path, Path]:
    zip_path = source_root / _artifact_text(artifact, "zipPath")
    checksum_path = source_root / _artifact_text(artifact, "checksumPath")
    for path in (zip_path, checksum_path):
        if path.is_symlink() or not path.is_file():
            raise CustodyError(f"artifact unavailable: {path}")
        try:
            path.resolve().relative_to(source_root.resolve())
        except ValueError as error:
            raise CustodyError("artifact escapes source root") from error
    zip_sha = sha256_path(zip_path)
    checksum_sha = sha256_path(checksum_path)
    if zip_sha != _artifact_text(artifact, "zipSha256"):
        raise CustodyError("archive SHA-256 mismatch")
    if checksum_sha != _artifact_text(artifact, "checksumSha256"):
        raise CustodyError("checksum SHA-256 mismatch")
    if zip_path.stat().st_size != artifact.get("zipBytes"):
        raise CustodyError("archive byte count mismatch")
    if checksum_path.stat().st_size != artifact.get("checksumBytes"):
        raise CustodyError("checksum byte count mismatch")
    verify_checksum_text(checksum_path.read_bytes(), zip_path.name, zip_sha)
    return zip_path, checksum_path


def parse_archive(
    artifact: Mapping[str, object],
    source_root: Path,
) -> tuple[Bar, ...]:
    """Open one already authenticated synthetic/real archive after its phase marker."""

    zip_path, _ = validate_artifact_bytes(artifact, source_root)
    symbol = _artifact_text(artifact, "symbol")
    month = _artifact_text(artifact, "month")
    expected_member = f"{symbol}-1h-{month}.csv"
    try:
        with zipfile.ZipFile(zip_path, "r") as archive:
            names = archive.namelist()
            if names != [expected_member]:
                raise MeasurementError("archive must contain one exact member name")
            with archive.open(expected_member, "r") as member:
                reader = csv.reader(io.TextIOWrapper(member, encoding="ascii", newline=""))
                bars: list[Bar] = []
                seen: set[datetime] = set()
                for row in reader:
                    if len(row) != 12:
                        raise MeasurementError("kline row must contain exactly 12 columns")
                    open_us, opened_at = parse_timestamp_us(row[0], "openTime")
                    close_us, _closed_at = parse_timestamp_us(row[6], "closeTime")
                    if opened_at.microsecond or opened_at.minute or opened_at.second:
                        raise MeasurementError("kline open is not on an exact UTC hour")
                    if close_us != open_us + HOUR_US - 1:
                        raise MeasurementError("kline close boundary invalid")
                    if opened_at in seen:
                        raise MeasurementError("duplicate hourly open")
                    seen.add(opened_at)
                    open_price = decimal_value(row[1], "open", positive=True)
                    high_price = decimal_value(row[2], "high", positive=True)
                    low_price = decimal_value(row[3], "low", positive=True)
                    close_price = decimal_value(row[4], "close", positive=True)
                    decimal_value(row[5], "baseVolume")
                    if not row[8].isascii() or not row[8].isdigit():
                        raise MeasurementError("tradeCount must be an unsigned integer")
                    decimal_value(row[9], "takerBuyBaseVolume")
                    decimal_value(row[10], "takerBuyQuoteVolume")
                    decimal_value(row[11], "ignore")
                    if high_price < max(open_price, close_price) or low_price > min(
                        open_price, close_price
                    ):
                        raise MeasurementError("OHLC envelope invalid")
                    bars.append(
                        Bar(
                            symbol=symbol,
                            opened_at=opened_at,
                            open_price=open_price,
                            high_price=high_price,
                            low_price=low_price,
                            close_price=close_price,
                            quote_volume=decimal_value(row[7], "quoteVolume"),
                            open_time_us=open_us,
                            close_time_us=close_us,
                        )
                    )
    except (UnicodeDecodeError, zipfile.BadZipFile) as error:
        raise MeasurementError("archive body is not a valid ASCII ZIP/CSV") from error
    start, end = month_bounds(month)
    expected = hour_range(start, end)
    actual = tuple(bar.opened_at for bar in bars)
    if actual != expected:
        raise MeasurementError("archive hourly grid is incomplete, unsorted, or out of month")
    if any(bar.symbol != symbol for bar in bars):
        raise MeasurementError("archive symbol mismatch")
    return tuple(bars)


def bar_required(
    bars: Mapping[str, Mapping[datetime, Bar]],
    symbol: str,
    opened_at: datetime,
    purpose: str,
) -> Bar:
    bar = bars.get(symbol, {}).get(opened_at)
    if bar is None:
        raise MeasurementError(f"required {purpose} bar missing: {symbol} {opened_at.isoformat()}")
    return bar


def signal_at(
    bars: Mapping[str, Mapping[datetime, Bar]],
    trial: Trial,
    formation: datetime,
) -> Signal:
    """Compute one as-of-formation statistic from a strictly prior L-by-10 matrix."""

    if formation.tzinfo != UTC or formation.hour not in FORMATION_HOURS:
        raise MeasurementError("formation is not a frozen UTC slot")
    histories: dict[str, tuple[Decimal, ...]] = {}
    current: dict[str, Decimal] = {}
    minimum_quote: Decimal | None = None
    for symbol in COHORT:
        current_bar = bar_required(bars, symbol, formation, "signal")
        current[symbol] = log1p_decimal(current_bar.quote_volume)
        minimum_quote = (
            current_bar.quote_volume
            if minimum_quote is None
            else min(minimum_quote, current_bar.quote_volume)
        )
        histories[symbol] = tuple(
            log1p_decimal(
                bar_required(
                    bars,
                    symbol,
                    formation - lag * WEEK,
                    "same-slot history",
                ).quote_volume
            )
            for lag in range(trial.lookback_weeks, 0, -1)
        )
    baselines = {symbol: median(values) for symbol, values in histories.items()}
    current_residuals = tuple(current[symbol] - baselines[symbol] for symbol in COHORT)
    historical_dispersions = tuple(
        mad(tuple(histories[symbol][row] - baselines[symbol] for symbol in COHORT))
        for row in range(trial.lookback_weeks)
    )
    current_dispersion = mad(current_residuals)
    reference = median(historical_dispersions)
    threshold = trial.dispersion_multiple * reference
    assert minimum_quote is not None
    return Signal(
        on=current_dispersion >= threshold,
        current_dispersion=current_dispersion,
        reference_dispersion=reference,
        nominal_initial_1000_screen_usd=(
            minimum_quote * CAPACITY_PARTICIPATION * Decimal(len(COHORT))
        ),
    )


def build_events(
    bars: Mapping[str, Mapping[datetime, Bar]],
    trial: Trial,
    start: datetime,
    end: datetime,
) -> tuple[Event, ...]:
    events: list[Event] = []
    occupied_until = start
    formation_start = max(start, FIRST_ELIGIBLE_FORMATION)
    for formation in hour_range(formation_start, end):
        if formation.hour not in FORMATION_HOURS:
            continue
        entry = formation + timedelta(hours=2)
        exit_at = entry + timedelta(hours=trial.hold_hours)
        if exit_at >= end or entry < occupied_until:
            continue
        signal = signal_at(bars, trial, formation)
        if not signal.on:
            continue
        events.append(
            Event(
                formation,
                entry,
                exit_at,
                signal.nominal_initial_1000_screen_usd,
            )
        )
        occupied_until = exit_at
    return tuple(events)


def prices_required(
    bars: Mapping[str, Mapping[datetime, Bar]],
    opened_at: datetime,
    purpose: str,
) -> dict[str, Decimal]:
    return {symbol: bar_required(bars, symbol, opened_at, purpose).open_price for symbol in COHORT}


def maximum_drawdown(equity: Sequence[Decimal]) -> Decimal:
    if not equity:
        raise MeasurementError("drawdown path empty")
    peak = equity[0]
    maximum = Decimal(0)
    for value in equity:
        if value <= 0:
            raise MeasurementError("equity is nonpositive")
        peak = max(peak, value)
        maximum = max(maximum, (peak - value) / peak)
    return maximum


def simulate(
    bars: Mapping[str, Mapping[datetime, Bar]],
    trial: Trial,
    cost: Scenario,
    start: datetime,
    end: datetime,
    *,
    events: Sequence[Event] | None = None,
) -> Simulation:
    event_path = tuple(events) if events is not None else build_events(bars, trial, start, end)
    entries = {event.entry_at: event for event in event_path}
    exits = {event.exit_at: event for event in event_path}
    cash = STARTING_USD
    units: dict[str, Decimal] = {}
    reference_entry: dict[str, Decimal] = {}
    fee_cost = Decimal(0)
    adverse_cost = Decimal(0)
    gross_pnl = Decimal(0)
    chargeable_reference_notional = Decimal(0)
    entry_to_screen_ratios: list[Decimal] = []
    times = hour_range(start, end)
    equity: list[Decimal] = []
    for opened_at in times:
        if opened_at in exits:
            prices = prices_required(bars, opened_at, "exit")
            proceeds = sum(units[symbol] * prices[symbol] for symbol in COHORT)
            chargeable_reference_notional += proceeds
            gross_pnl += proceeds - sum(reference_entry.values())
            fee = proceeds * cost.fee_per_side
            adverse = proceeds * cost.adverse_per_side
            fee_cost += fee
            adverse_cost += adverse
            cash = proceeds - fee - adverse
            units = {}
            reference_entry = {}
        if opened_at in entries:
            prices = prices_required(bars, opened_at, "entry")
            all_in = Decimal(1) + cost.fee_per_side + cost.adverse_per_side
            each_reference = cash / (Decimal(len(COHORT)) * all_in)
            nominal_each_screen = entries[opened_at].nominal_initial_1000_screen_usd / Decimal(
                len(COHORT)
            )
            if nominal_each_screen > 0:
                entry_to_screen_ratios.append(each_reference / nominal_each_screen)
            reference_entry = dict.fromkeys(COHORT, each_reference)
            entry_reference_total = each_reference * Decimal(len(COHORT))
            chargeable_reference_notional += entry_reference_total
            fee = entry_reference_total * cost.fee_per_side
            adverse = entry_reference_total * cost.adverse_per_side
            fee_cost += fee
            adverse_cost += adverse
            units = {symbol: each_reference / prices[symbol] for symbol in COHORT}
            cash -= entry_reference_total + fee + adverse
            if abs(cash) < Decimal("1e-30"):
                cash = Decimal(0)
        if units:
            prices = prices_required(bars, opened_at, "hourly mark")
            marked_proceeds = sum(units[symbol] * prices[symbol] for symbol in COHORT)
            value = cash + marked_proceeds * (
                Decimal(1) - cost.fee_per_side - cost.adverse_per_side
            )
        else:
            value = cash
        equity.append(value)
    if units:
        raise MeasurementError("segment ended with an open event")
    returns = tuple(
        equity[index] / equity[index - 1] - Decimal(1) for index in range(1, len(equity))
    )
    reconciled = STARTING_USD + gross_pnl - fee_cost - adverse_cost
    if abs(reconciled - cash) > Decimal("1e-20"):
        raise MeasurementError("cost decomposition does not reconcile")
    return Simulation(
        trial_id=trial.trial_id,
        scenario=cost.name,
        events=event_path,
        times=times,
        hourly_returns=returns,
        equity_at_open=tuple(equity),
        ending_usd=cash,
        chargeable_entry_exit_reference_notional_usd=chargeable_reference_notional,
        gross_trading_pnl_usd=gross_pnl,
        fee_cost_usd=fee_cost,
        adverse_cost_usd=adverse_cost,
        minimum_nominal_initial_1000_screen_usd=min(
            (event.nominal_initial_1000_screen_usd for event in event_path),
            default=None,
        ),
        maximum_entry_to_screen_ratio=max(entry_to_screen_ratios, default=None),
        max_drawdown=maximum_drawdown(equity),
    )


def log_returns(values: Sequence[Decimal]) -> tuple[float, ...]:
    output: list[float] = []
    for value in values:
        if value <= -1:
            raise MeasurementError("return cannot be logged")
        output.append(math.log1p(float(value)))
    return tuple(output)


def circular_indices(
    length: int,
    *,
    block: int,
    replicates: int,
    seed: int,
) -> tuple[tuple[int, ...], ...]:
    if length < block or block < 1 or replicates < 1:
        raise MeasurementError("bootstrap specification invalid")
    rng = random.Random(seed)
    output: list[tuple[int, ...]] = []
    for _ in range(replicates):
        indices: list[int] = []
        while len(indices) < length:
            start = rng.randrange(length)
            for offset in range(block):
                indices.append((start + offset) % length)
                if len(indices) == length:
                    break
        output.append(tuple(indices))
    return tuple(output)


def percentile(values: Sequence[float], probability: float) -> float:
    if not values:
        raise MeasurementError("percentile path empty")
    ordered = sorted(values)
    index = min(len(ordered) - 1, math.floor(probability * len(ordered)))
    return ordered[index]


def terminal_usd(logs: Sequence[float]) -> float:
    return 1000.0 * math.expm1(math.fsum(logs))


def bootstrap_summary(
    returns: Sequence[Decimal],
    indices: Sequence[Sequence[int]],
) -> dict[str, object]:
    logs = log_returns(returns)
    observed = math.fsum(logs)
    mean = observed / len(logs)
    centered = tuple(value - mean for value in logs)
    samples = [terminal_usd([logs[index] for index in sample]) for sample in indices]
    centered_exceedances = sum(
        math.fsum(centered[index] for index in sample) >= observed for sample in indices
    )
    return {
        "blockHours": BOOTSTRAP_BLOCK_HOURS,
        "lower95UsdPer1k": f"{percentile(samples, 0.05):.8f}",
        "medianUsdPer1k": f"{percentile(samples, 0.50):.8f}",
        "observations": len(logs),
        "oneSidedCenteredP": f"{(centered_exceedances + 1) / (len(indices) + 1):.12f}",
        "replicates": len(indices),
        "upper95UsdPer1k": f"{percentile(samples, 0.95):.8f}",
    }


def holm_adjust(raw: Mapping[str, float]) -> dict[str, float]:
    ordered = sorted(raw, key=lambda trial_id: (raw[trial_id], trial_id))
    output: dict[str, float] = {}
    running = 0.0
    count = len(ordered)
    for index, trial_id in enumerate(ordered):
        running = max(running, min(1.0, raw[trial_id] * (count - index)))
        output[trial_id] = running
    return output


def white_max_stat(
    paths: Mapping[str, Sequence[Decimal]],
    indices: Sequence[Sequence[int]],
) -> dict[str, object]:
    identifiers = tuple(sorted(paths))
    logs = {trial_id: log_returns(paths[trial_id]) for trial_id in identifiers}
    length = len(next(iter(logs.values())))
    if any(len(values) != length for values in logs.values()):
        raise MeasurementError("White paths are not synchronous")
    means = {trial_id: math.fsum(values) / length for trial_id, values in logs.items()}
    observed = max(math.fsum(values) for values in logs.values())
    exceedances = 0
    for sample in indices:
        maximum = max(
            math.fsum(logs[trial_id][index] - means[trial_id] for index in sample)
            for trial_id in identifiers
        )
        exceedances += maximum >= observed
    return {
        "method": "CENTERED_SYNCHRONOUS_WHITE_MAX_STAT",
        "observed": f"{observed:.12f}",
        "pValue": f"{(exceedances + 1) / (len(indices) + 1):.12f}",
        "trialCount": len(identifiers),
    }


def average_oos_rank_percentile(
    scores: Mapping[str, float],
    selected_id: str,
) -> float:
    if selected_id not in scores or len(scores) < 2:
        raise MeasurementError("OOS rank requires a selected member and two trials")
    selected = scores[selected_id]
    better = sum(value > selected for value in scores.values())
    tied_others = sum(value == selected for value in scores.values()) - 1
    average_rank = 1.0 + better + tied_others / 2.0
    return (average_rank - 1.0) / (len(scores) - 1)


def cscv_pbo(paths: Mapping[str, Sequence[Decimal]]) -> dict[str, object]:
    identifiers = tuple(sorted(paths))
    if not identifiers:
        raise MeasurementError("PBO requires trial paths")
    logs = {trial_id: log_returns(paths[trial_id]) for trial_id in identifiers}
    length = len(next(iter(logs.values())))
    if any(len(values) != length for values in logs.values()) or length < 8:
        raise MeasurementError("PBO paths are not aligned for eight blocks")
    distinct_paths = len({tuple(values) for values in logs.values()})
    split_count = math.comb(8, 4)
    if distinct_paths < 2:
        return {
            "blocks": 8,
            "diagnosticOnlyNeverSelectionRescue": True,
            "distinctTrialPaths": distinct_paths,
            "probabilityOverfit": None,
            "splitCount": split_count,
            "status": "NOT_ESTIMABLE",
        }
    blocks = tuple(
        tuple(range(length * index // 8, length * (index + 1) // 8)) for index in range(8)
    )
    overfit = 0
    splits = 0
    for training_blocks in itertools.combinations(range(8), 4):
        training = tuple(index for block in training_blocks for index in blocks[block])
        testing = tuple(
            index for block in range(8) if block not in training_blocks for index in blocks[block]
        )
        champion = max(
            identifiers,
            key=lambda trial_id: (
                math.fsum(logs[trial_id][index] for index in training),
                tuple(-ord(character) for character in trial_id),
            ),
        )
        oos_scores = {
            trial_id: math.fsum(logs[trial_id][index] for index in testing)
            for trial_id in identifiers
        }
        overfit += average_oos_rank_percentile(oos_scores, champion) > 0.5
        splits += 1
    return {
        "blocks": 8,
        "diagnosticOnlyNeverSelectionRescue": True,
        "distinctTrialPaths": distinct_paths,
        "probabilityOverfit": f"{overfit / splits:.12f}",
        "splitCount": splits,
        "status": "ESTIMATED",
    }


def monthly_activity(events: Sequence[Event]) -> dict[str, int]:
    output: dict[str, int] = {}
    for event in events:
        month = event.entry_at.strftime("%Y-%m")
        output[month] = output.get(month, 0) + 1
    return dict(sorted(output.items()))


def frozen_champion_id(displayed_base_net: Mapping[str, Decimal]) -> str:
    if set(displayed_base_net) != {trial.trial_id for trial in trial_grid()}:
        raise MeasurementError("champion selection requires the frozen 12-trial family")
    return min(
        displayed_base_net,
        key=lambda trial_id: (-displayed_base_net[trial_id], trial_id),
    )


def simulation_mapping(simulation: Simulation) -> dict[str, object]:
    activity = monthly_activity(simulation.events)
    frozen_cost = next(scenario for scenario in scenarios() if scenario.name == simulation.scenario)
    ending_text = decimal_text(simulation.ending_usd)
    gross_text = decimal_text(simulation.gross_trading_pnl_usd)
    fee_text = decimal_text(simulation.fee_cost_usd)
    adverse_text = decimal_text(simulation.adverse_cost_usd)
    stored_reconciliation = (
        STARTING_USD + Decimal(gross_text) - Decimal(fee_text) - Decimal(adverse_text)
    )
    screen_text = (
        decimal_text(simulation.minimum_nominal_initial_1000_screen_usd)
        if simulation.minimum_nominal_initial_1000_screen_usd is not None
        else None
    )
    return {
        "activeMonths": len(activity),
        "activityByMonth": activity,
        "adverseCostUsd": adverse_text,
        "adverseExecutionBpsPerSide": decimal_text(frozen_cost.adverse_per_side * Decimal(10_000)),
        "chargeableEntryExitReferenceNotionalUsd": decimal_text(
            simulation.chargeable_entry_exit_reference_notional_usd
        ),
        "costReconciliation": {
            "endingUsd": ending_text,
            "matches": abs(Decimal(ending_text) - stored_reconciliation)
            <= STORED_DECIMAL_TOLERANCE,
            "startingPlusGrossMinusFeeMinusAdverseUsd": decimal_text(stored_reconciliation),
        },
        "endingUsd": ending_text,
        "eventCount": len(simulation.events),
        "feeCostUsd": fee_text,
        "feeBpsPerSide": decimal_text(frozen_cost.fee_per_side * Decimal(10_000)),
        "grossTradingPnlUsd": gross_text,
        "maxDrawdownFraction": decimal_text(simulation.max_drawdown),
        "minimumNominalInitial1000ScreenUsd": screen_text,
        "maximumActualEntryToNominalScreenRatio": (
            decimal_text(simulation.maximum_entry_to_screen_ratio)
            if simulation.maximum_entry_to_screen_ratio is not None
            else None
        ),
        "netUsdPer1k": decimal_text(simulation.ending_usd - STARTING_USD),
        "nominalInitial1000ScreenPass": (
            screen_text is not None and Decimal(screen_text) >= STARTING_USD
        ),
        "reinvestmentMayExceedNominalScreen": True,
        "executableCapacity": "UNMEASURED",
        "scenario": simulation.scenario,
        "trialId": simulation.trial_id,
    }


def development_analysis(
    bars: Mapping[str, Mapping[datetime, Bar]],
) -> dict[str, object]:
    trials = trial_grid()
    all_runs: dict[str, dict[str, Simulation]] = {}
    for trial in trials:
        events = build_events(bars, trial, DEVELOPMENT_START, DEVELOPMENT_END)
        all_runs[trial.trial_id] = {
            cost.name: simulate(
                bars,
                trial,
                cost,
                DEVELOPMENT_START,
                DEVELOPMENT_END,
                events=events,
            )
            for cost in scenarios()
        }
    length = len(all_runs[trials[0].trial_id]["base"].hourly_returns)
    indices = circular_indices(
        length,
        block=BOOTSTRAP_BLOCK_HOURS,
        replicates=BOOTSTRAP_REPLICATES,
        seed=BOOTSTRAP_SEED,
    )
    base_bootstrap = {
        trial.trial_id: bootstrap_summary(all_runs[trial.trial_id]["base"].hourly_returns, indices)
        for trial in trials
    }
    stress_bootstrap = {
        trial.trial_id: bootstrap_summary(
            all_runs[trial.trial_id]["stress"].hourly_returns, indices
        )
        for trial in trials
    }
    raw_p = {
        trial_id: float(required_text(packet["oneSidedCenteredP"], "oneSidedCenteredP"))
        for trial_id, packet in base_bootstrap.items()
    }
    holm_mapping = {
        trial_id: f"{value:.12f}" for trial_id, value in sorted(holm_adjust(raw_p).items())
    }
    white = white_max_stat(
        {trial.trial_id: all_runs[trial.trial_id]["base"].hourly_returns for trial in trials},
        indices,
    )
    pbo = cscv_pbo(
        {trial.trial_id: all_runs[trial.trial_id]["base"].hourly_returns for trial in trials}
    )
    trial_mappings = {
        trial.trial_id: {
            scenario_name: simulation_mapping(simulation)
            for scenario_name, simulation in sorted(all_runs[trial.trial_id].items())
        }
        for trial in trials
    }
    champion_id = frozen_champion_id(
        {
            trial.trial_id: receipt_decimal(
                trial_mappings[trial.trial_id]["base"]["netUsdPer1k"],
                f"{trial.trial_id} displayed base net",
            )
            for trial in trials
        }
    )
    champion = next(trial for trial in trials if trial.trial_id == champion_id)
    base_row = trial_mappings[champion_id]["base"]
    stress_row = trial_mappings[champion_id]["stress"]
    activity = monthly_activity(all_runs[champion_id]["base"].events)
    event_count = required_int(base_row["eventCount"], "displayed base eventCount")
    event_concentration = (
        Decimal(max(activity.values())) / Decimal(event_count) if event_count else Decimal(0)
    )
    formal_gates = {
        "activeMonthsAtLeast8": required_int(
            base_row["activeMonths"],
            "displayed base activeMonths",
        )
        >= 8,
        "baseLcbPositive": Decimal(
            required_text(
                base_bootstrap[champion_id]["lower95UsdPer1k"],
                "base lower95UsdPer1k",
            )
        )
        > 0,
        "baseNetPositive": receipt_decimal(
            base_row["netUsdPer1k"],
            "displayed base net",
        )
        > 0,
        "drawdownAtMost20Pct": receipt_decimal(
            base_row["maxDrawdownFraction"],
            "displayed base drawdown",
        )
        <= Decimal("0.20")
        and receipt_decimal(
            stress_row["maxDrawdownFraction"],
            "displayed stress drawdown",
        )
        <= Decimal("0.20"),
        "holmAdjustedPBelow0.05": receipt_decimal(
            holm_mapping[champion_id],
            "displayed Holm p",
        )
        < Decimal("0.05"),
        "onEventsAtLeast100": event_count >= 100,
        "nominalInitial1000ScreenAtLeast1000": required_bool(
            base_row["nominalInitial1000ScreenPass"],
            "displayed nominal screen pass",
        ),
        "stressLcbPositive": Decimal(
            required_text(
                stress_bootstrap[champion_id]["lower95UsdPer1k"],
                "stress lower95UsdPer1k",
            )
        )
        > 0,
        "stressNetPositive": receipt_decimal(
            stress_row["netUsdPer1k"],
            "displayed stress net",
        )
        > 0,
        "whitePBelow0.05": receipt_decimal(
            white["pValue"],
            "displayed White p",
        )
        < Decimal("0.05"),
    }
    pbo_probability = pbo["probabilityOverfit"]
    diagnostics = {
        "pboAtMost0.5": (
            float(pbo_probability) <= 0.5 if isinstance(pbo_probability, str) else None
        ),
        "pboRole": "DIAGNOSTIC_ONLY_NEVER_SELECTION_OR_HOLDOUT_AUTHORIZATION",
    }
    return {
        "authorizedToOpenHoldout": all(formal_gates.values()),
        "bootstrap": {
            "base": base_bootstrap,
            "stress": stress_bootstrap,
        },
        "champion": champion.trial_id,
        "championEventConcentrationMaximumMonthFraction": decimal_text(event_concentration),
        "diagnostics": diagnostics,
        "formalGates": formal_gates,
        "holmAdjustedP": holm_mapping,
        "pbo": pbo,
        "programWideMultiplicity": dict(PROGRAM_MULTIPLICITY),
        "trials": trial_mappings,
        "white": white,
    }


def holdout_analysis(
    bars: Mapping[str, Mapping[datetime, Bar]],
    champion: Trial,
) -> dict[str, object]:
    events = build_events(bars, champion, HOLDOUT_START, HOLDOUT_END)
    runs = {
        cost.name: simulate(
            bars,
            champion,
            cost,
            HOLDOUT_START,
            HOLDOUT_END,
            events=events,
        )
        for cost in scenarios()
    }
    length = len(runs["base"].hourly_returns)
    indices = circular_indices(
        length,
        block=BOOTSTRAP_BLOCK_HOURS,
        replicates=BOOTSTRAP_REPLICATES,
        seed=BOOTSTRAP_SEED + 1,
    )
    intervals = {
        name: bootstrap_summary(runs[name].hourly_returns, indices) for name in ("base", "stress")
    }
    scenario_mappings = {
        name: simulation_mapping(simulation) for name, simulation in sorted(runs.items())
    }
    base_row = scenario_mappings["base"]
    stress_row = scenario_mappings["stress"]
    gates = {
        "baseLcbPositive": Decimal(
            required_text(
                intervals["base"]["lower95UsdPer1k"],
                "holdout base lower95UsdPer1k",
            )
        )
        > 0,
        "baseNetPositive": receipt_decimal(
            base_row["netUsdPer1k"],
            "displayed holdout base net",
        )
        > 0,
        "drawdownAtMost20Pct": receipt_decimal(
            base_row["maxDrawdownFraction"],
            "displayed holdout base drawdown",
        )
        <= Decimal("0.20")
        and receipt_decimal(
            stress_row["maxDrawdownFraction"],
            "displayed holdout stress drawdown",
        )
        <= Decimal("0.20"),
        "nominalInitial1000ScreenAtLeast1000": required_bool(
            base_row["nominalInitial1000ScreenPass"],
            "displayed holdout nominal screen pass",
        ),
        "stressLcbPositive": Decimal(
            required_text(
                intervals["stress"]["lower95UsdPer1k"],
                "holdout stress lower95UsdPer1k",
            )
        )
        > 0,
        "stressNetPositive": receipt_decimal(
            stress_row["netUsdPer1k"],
            "displayed holdout stress net",
        )
        > 0,
    }
    return {
        "confirmationGates": gates,
        "intervals": intervals,
        "publicVerdict": "GO" if all(gates.values()) else "NO_GO",
        "scenarios": scenario_mappings,
    }


def validate_protocol() -> dict[str, Any]:
    protocol = load_json(PROTOCOL_PATH)
    if protocol.get("canonicalBase") != BASE_COMMIT:
        raise CustodyError("canonical base drift")
    data = protocol.get("data")
    family = protocol.get("trialFamily")
    claim_boundary = protocol.get("claimBoundary")
    inference = protocol.get("inference")
    costs = protocol.get("costs")
    custody = protocol.get("custody")
    gates = protocol.get("gates")
    if not isinstance(data, dict) or data.get("symbols") != list(COHORT):
        raise CustodyError("cohort drift")
    if (
        not isinstance(family, dict)
        or family.get("count") != 12
        or family.get("selection")
        != "HIGHEST_STORED_12DP_DEVELOPMENT_BASE_NET_USD_PER_1000_THEN_TRIAL_ID_ASCENDING"
    ):
        raise CustodyError("trial-family drift")
    if (
        not isinstance(claim_boundary, dict)
        or claim_boundary.get("programWideVgMultiplicity") != PROGRAM_MULTIPLICITY
    ):
        raise CustodyError("program-wide multiplicity protocol drift")
    if not isinstance(inference, dict):
        raise CustodyError("inference protocol invalid")
    bootstrap_protocol = inference.get("bootstrap")
    pbo_protocol = inference.get("cscvPbo")
    if (
        not isinstance(bootstrap_protocol, dict)
        or bootstrap_protocol.get("replicates") != BOOTSTRAP_REPLICATES
        or bootstrap_protocol.get("developmentObservations") != DEVELOPMENT_OBSERVATIONS
        or bootstrap_protocol.get("holdoutObservations") != HOLDOUT_OBSERVATIONS
        or bootstrap_protocol.get("pValueGrid") != "K_OVER_2049_K_1_THROUGH_2049_SERIALIZED_12DP"
        or inference.get("holm") != PROTOCOL_HOLM_AUTHORITY
    ):
        raise CustodyError("bootstrap or Holm protocol drift")
    if (
        not isinstance(pbo_protocol, dict)
        or pbo_protocol.get("orientations") != 70
        or pbo_protocol.get("distinctPathsRange") != "1_THROUGH_12"
        or pbo_protocol.get("estimatedPValueGrid") != "K_OVER_70_K_0_THROUGH_70_SERIALIZED_12DP"
    ):
        raise CustodyError("PBO protocol drift")
    if (
        not isinstance(costs, dict)
        or costs.get("serializedDecimalTolerance") != "0.000000000005"
        or costs.get("chargeableNotional")
        != "DIRECT_ACCUMULATION_OF_EACH_EVENT_ENTRY_REFERENCE_NOTIONAL_PLUS_EXIT_REFERENCE_PROCEEDS"
        or costs.get("activeRowFirstEntryFloor") != "1000_DIVIDED_BY_ONE_PLUS_FEE_PLUS_ADVERSE"
        or costs.get("calculation") != PROTOCOL_COST_CALCULATION
        or costs.get("base") != {"adverseExecutionBpsPerSide": "5", "feeBpsPerSide": "10"}
        or costs.get("stress") != {"adverseExecutionBpsPerSide": "15", "feeBpsPerSide": "10"}
        or costs.get("severe") != {"adverseExecutionBpsPerSide": "25", "feeBpsPerSide": "20"}
    ):
        raise CustodyError("cost protocol drift")
    if not isinstance(custody, dict) or custody.get("freeze") != PROTOCOL_FREEZE_CUSTODY:
        raise CustodyError("freeze custody protocol drift")
    if (
        not isinstance(gates, dict)
        or gates.get("serializedAuthority")
        != "ALL_GATES_AND_VERDICT_DERIVED_FROM_SEALED_CANONICAL_STORED_ROWS"
    ):
        raise CustodyError("stored gate authority protocol drift")
    if tuple(trial.trial_id for trial in trial_grid()) != tuple(
        sorted(trial.trial_id for trial in trial_grid())
    ):
        raise CustodyError("trial IDs are not stable")
    v1_supersession = load_json(
        packet_artifact(FREEZE_V1_SUPERSESSION_NAME),
        canonical=True,
    )
    if v1_supersession.get("version") != "VG27FreezeV1SupersessionV1":
        raise CustodyError("freeze v1 supersession version invalid")
    if v1_supersession.get("supersededFreezeSha256") != FREEZE_V1_SHA256:
        raise CustodyError("freeze v1 supersession digest invalid")
    receipt_counts = v1_supersession.get("outcomeReceiptsAtSupersession")
    if not isinstance(receipt_counts, dict) or any(value != 0 for value in receipt_counts.values()):
        raise CustodyError("freeze v1 supersession outcome state invalid")
    if sha256_path(packet_artifact(FREEZE_V1_NAME)) != FREEZE_V1_SHA256:
        raise CustodyError("preserved packet freeze v1 digest invalid")
    if sha256_path(packet_artifact(FREEZE_V2_NAME)) != FREEZE_V2_SHA256:
        raise CustodyError("preserved packet freeze v2 digest invalid")
    v2_supersession = load_json(
        packet_artifact(FREEZE_V2_SUPERSESSION_NAME),
        canonical=True,
    )
    require_exact_keys(
        v2_supersession,
        {
            "createdAtUtc",
            "externalFreezeV2",
            "maxRejectReasons",
            "outcomeReceiptsAtSupersession",
            "packetFreezeV2",
            "supersededAuthorityHead",
            "supersededExternalFreezeSha256",
            "supersededPacketFreezeSha256",
            "version",
        },
        "freeze v2 supersession",
    )
    if v2_supersession.get("version") != "VG27FreezeV2SupersessionV1":
        raise CustodyError("freeze v2 supersession version invalid")
    if (
        v2_supersession.get("supersededPacketFreezeSha256") != FREEZE_V2_SHA256
        or v2_supersession.get("supersededExternalFreezeSha256") != FREEZE_V2_SHA256
        or v2_supersession.get("supersededAuthorityHead") != REJECTED_V2_AUTHORITY_HEAD
        or v2_supersession.get("packetFreezeV2") != "READ_ONLY_PRESERVED_NOT_CONSUMED"
        or v2_supersession.get("externalFreezeV2") != "READ_ONLY_PRESERVED_NOT_CONSUMED"
    ):
        raise CustodyError("freeze v2 supersession binding invalid")
    receipt_counts = v2_supersession.get("outcomeReceiptsAtSupersession")
    if (
        not isinstance(receipt_counts, dict)
        or set(receipt_counts)
        != {
            "custodyTerminal",
            "developmentMarker",
            "developmentSelection",
            "holdoutMarker",
            "packetInventory",
            "result",
        }
        or any(value != 0 for value in receipt_counts.values())
    ):
        raise CustodyError("freeze v2 supersession outcome state invalid")
    reasons = v2_supersession.get("maxRejectReasons")
    if (
        not isinstance(reasons, list)
        or any(not isinstance(reason, str) for reason in reasons)
        or {
            "PRE_CONSUMPTION_FAILURE_FALSE_TERMINAL",
            "DAMAGED_PACKET_AUTHORITY_UNSEALABLE",
            "DEVELOPMENT_CHAMPION_NOT_RECONSTRUCTED",
            "SKELETAL_MEASURED_ROWS_ACCEPTED",
        }
        - set(reasons)
    ):
        raise CustodyError("freeze v2 supersession MAX reasons incomplete")
    required_text(v2_supersession.get("createdAtUtc"), "freeze v2 supersession createdAtUtc")
    if sha256_path(packet_artifact(FREEZE_V3_NAME)) != FREEZE_V3_SHA256:
        raise CustodyError("preserved packet freeze v3 digest invalid")
    v3_supersession = load_json(
        packet_artifact(FREEZE_V3_SUPERSESSION_NAME),
        canonical=True,
    )
    require_exact_keys(
        v3_supersession,
        {
            "createdAtUtc",
            "externalFreezeV3",
            "maxRejectReasons",
            "outcomeReceiptsAtSupersession",
            "packetFreezeV3",
            "supersededAuthorityHead",
            "supersededExternalFreezeSha256",
            "supersededPacketFreezeSha256",
            "version",
        },
        "freeze v3 supersession",
    )
    if v3_supersession.get("version") != "VG27FreezeV3SupersessionV1":
        raise CustodyError("freeze v3 supersession version invalid")
    if (
        v3_supersession.get("supersededPacketFreezeSha256") != FREEZE_V3_SHA256
        or v3_supersession.get("supersededExternalFreezeSha256") != FREEZE_V3_SHA256
        or v3_supersession.get("supersededAuthorityHead") != REJECTED_V3_AUTHORITY_HEAD
        or v3_supersession.get("packetFreezeV3") != "READ_ONLY_PRESERVED_NOT_CONSUMED"
        or v3_supersession.get("externalFreezeV3") != "READ_ONLY_PRESERVED_NOT_CONSUMED"
    ):
        raise CustodyError("freeze v3 supersession binding invalid")
    receipt_counts = v3_supersession.get("outcomeReceiptsAtSupersession")
    if (
        not isinstance(receipt_counts, dict)
        or set(receipt_counts)
        != {
            "custodyTerminal",
            "developmentMarker",
            "developmentSelection",
            "holdoutMarker",
            "packetInventory",
            "result",
        }
        or any(value != 0 for value in receipt_counts.values())
    ):
        raise CustodyError("freeze v3 supersession outcome state invalid")
    reasons = v3_supersession.get("maxRejectReasons")
    if (
        not isinstance(reasons, list)
        or any(not isinstance(reason, str) for reason in reasons)
        or {
            "HOLM_ADJUSTMENT_NOT_RECONSTRUCTED",
            "COST_SCENARIO_SEMANTICS_UNBOUND",
        }
        - set(reasons)
    ):
        raise CustodyError("freeze v3 supersession MAX reasons incomplete")
    required_text(v3_supersession.get("createdAtUtc"), "freeze v3 supersession createdAtUtc")
    return protocol


def expected_artifact_keys() -> tuple[tuple[str, str], ...]:
    return tuple(itertools.product(COHORT, MONTHS))


def source_paths(state_root: Path, symbol: str, month: str) -> tuple[Path, Path]:
    directory = state_root / "sources" / symbol / month
    zip_path = directory / f"{symbol}-1h-{month}.zip"
    return zip_path, zip_path.with_name(f"{zip_path.name}.CHECKSUM")


def acquire(state_root: Path) -> dict[str, object]:
    validate_protocol()
    manifest_path = state_root / SOURCE_MANIFEST_NAME
    if manifest_path.exists():
        raise CustodyError("source manifest already exists")
    artifacts: list[dict[str, object]] = []
    downloaded_count = 0
    for symbol, month in expected_artifact_keys():
        zip_path, checksum_path = source_paths(state_root, symbol, month)
        zip_path.parent.mkdir(parents=True, exist_ok=True)
        zip_url = f"{ARCHIVE_BASE}/{symbol}/1h/{symbol}-1h-{month}.zip"
        downloaded = False
        for url, path in ((zip_url, zip_path), (f"{zip_url}.CHECKSUM", checksum_path)):
            if not path.exists():
                request = urllib.request.Request(url, headers={"User-Agent": "cosmos-vg27/1"})
                with urllib.request.urlopen(request, timeout=60) as response:
                    raw = response.read()
                write_exclusive(path, raw)
                downloaded = True
                downloaded_count += 1
                time.sleep(0.5)
        zip_sha = sha256_path(zip_path)
        verify_checksum_text(checksum_path.read_bytes(), zip_path.name, zip_sha)
        artifacts.append(
            {
                "archiveUrl": zip_url,
                "checksumBytes": checksum_path.stat().st_size,
                "checksumPath": str(checksum_path.relative_to(state_root)),
                "checksumSha256": sha256_path(checksum_path),
                "checksumUrl": f"{zip_url}.CHECKSUM",
                "custodyMode": (
                    "DOWNLOADED_CURRENT_RUN" if downloaded else "PRESTAGED_VERIFIED_PUBLIC_BYTES"
                ),
                "month": month,
                "symbol": symbol,
                "zipBytes": zip_path.stat().st_size,
                "zipPath": str(zip_path.relative_to(state_root)),
                "zipSha256": zip_sha,
            }
        )
    manifest: dict[str, object] = {
        "artifacts": artifacts,
        "createdAtUtc": utc_now(),
        "downloadedObjectCount": downloaded_count,
        "officialArchiveBase": ARCHIVE_BASE,
        "objectsOpened": 0,
        "prestagedObjectCount": len(expected_artifact_keys()) * 2 - downloaded_count,
        "version": "VG27SourceManifestV1",
    }
    write_exclusive(manifest_path, manifest)
    return manifest


def validate_manifest(
    state_root: Path,
    *,
    open_archives: bool = False,
    months: frozenset[str] | None = None,
) -> tuple[dict[str, Any], dict[str, dict[datetime, Bar]]]:
    manifest = load_json(state_root / SOURCE_MANIFEST_NAME, canonical=True)
    if manifest.get("version") != "VG27SourceManifestV1":
        raise CustodyError("source manifest version invalid")
    if manifest.get("officialArchiveBase") != ARCHIVE_BASE:
        raise CustodyError("source manifest official base drift")
    if manifest.get("objectsOpened") != 0:
        raise CustodyError("source manifest indicates pre-freeze archive access")
    artifacts = manifest.get("artifacts")
    if not isinstance(artifacts, list) or len(artifacts) != len(expected_artifact_keys()):
        raise CustodyError("source manifest artifact count invalid")
    lookup: dict[tuple[str, str], Mapping[str, object]] = {}
    for item in artifacts:
        if not isinstance(item, dict):
            raise CustodyError("source manifest artifact shape invalid")
        key = (_artifact_text(item, "symbol"), _artifact_text(item, "month"))
        if key in lookup:
            raise CustodyError("source manifest artifact duplicate")
        expected_zip, expected_checksum = source_paths(state_root, *key)
        expected_zip_url = f"{ARCHIVE_BASE}/{key[0]}/1h/{key[0]}-1h-{key[1]}.zip"
        if _artifact_text(item, "zipPath") != str(expected_zip.relative_to(state_root)):
            raise CustodyError("source manifest archive path drift")
        if _artifact_text(item, "checksumPath") != str(expected_checksum.relative_to(state_root)):
            raise CustodyError("source manifest checksum path drift")
        if _artifact_text(item, "archiveUrl") != expected_zip_url:
            raise CustodyError("source manifest archive URL drift")
        if _artifact_text(item, "checksumUrl") != f"{expected_zip_url}.CHECKSUM":
            raise CustodyError("source manifest checksum URL drift")
        if item.get("custodyMode") not in {
            "DOWNLOADED_CURRENT_RUN",
            "PRESTAGED_VERIFIED_PUBLIC_BYTES",
        }:
            raise CustodyError("source manifest custody mode invalid")
        lookup[key] = item
    if tuple(sorted(lookup)) != tuple(sorted(expected_artifact_keys())):
        raise CustodyError("source manifest matrix drift")
    bars: dict[str, dict[datetime, Bar]] = {symbol: {} for symbol in COHORT}
    for key in expected_artifact_keys():
        artifact = lookup[key]
        validate_artifact_bytes(artifact, state_root)
        if open_archives and (months is None or key[1] in months):
            for bar in parse_archive(artifact, state_root):
                if bar.opened_at in bars[bar.symbol]:
                    raise MeasurementError("cross-archive duplicate hourly bar")
                bars[bar.symbol][bar.opened_at] = bar
    return manifest, bars


def static_hashes() -> dict[str, str]:
    paths = (
        INIT_PATH,
        DISTINCTNESS_PATH,
        SOURCE_RESEARCH_PATH,
        README_PATH,
        PROTOCOL_PATH,
        Path(__file__).resolve(),
        TEST_PATH,
        packet_artifact(SOURCE_MANIFEST_NAME),
        packet_artifact(FREEZE_V1_NAME),
        packet_artifact(FREEZE_V2_NAME),
        packet_artifact(FREEZE_V3_NAME),
        packet_artifact(FREEZE_V1_SUPERSESSION_NAME),
        packet_artifact(FREEZE_V2_SUPERSESSION_NAME),
        packet_artifact(FREEZE_V3_SUPERSESSION_NAME),
    )
    missing = [path.name for path in paths if not path.is_file() or path.is_symlink()]
    if missing:
        raise CustodyError(f"static freeze input unavailable: {missing}")
    return {path.name: sha256_path(path) for path in paths}


def runtime_identity() -> dict[str, object]:
    context = getcontext()
    lock_inputs: dict[str, str] = {}
    for path in RUNTIME_LOCK_PATHS:
        if not path.is_file() or path.is_symlink():
            raise CustodyError(f"runtime lock input unavailable: {path}")
        lock_inputs[str(path.relative_to(REPO_ROOT))] = sha256_path(path)
    optional_python_version = REPO_ROOT / "quant" / ".python-version"
    if optional_python_version.exists() or optional_python_version.is_symlink():
        if not optional_python_version.is_file() or optional_python_version.is_symlink():
            raise CustodyError("optional Python version pin is not a regular file")
        lock_inputs[str(optional_python_version.relative_to(REPO_ROOT))] = sha256_path(
            optional_python_version
        )
    executable = Path(sys.executable).resolve()
    if not executable.is_file():
        raise CustodyError("Python interpreter executable unavailable")
    return {
        "decimalContext": {
            "capitals": context.capitals,
            "clamp": context.clamp,
            "emax": context.Emax,
            "emin": context.Emin,
            "precision": context.prec,
            "rounding": context.rounding,
            "traps": {
                signal.__name__: enabled
                for signal, enabled in sorted(
                    context.traps.items(),
                    key=lambda item: item[0].__name__,
                )
            },
        },
        "interpreter": {
            "cacheTag": sys.implementation.cache_tag,
            "executable": str(executable),
            "executableSha256": sha256_path(executable),
            "implementation": platform.python_implementation(),
            "implementationName": sys.implementation.name,
            "version": platform.python_version(),
            "versionInfo": list(sys.version_info[:5]),
        },
        "runtimeLocks": dict(sorted(lock_inputs.items())),
    }


def freeze(state_root: Path) -> dict[str, object]:
    validate_protocol()
    if (
        packet_artifact(FREEZE_NAME).exists()
        or packet_artifact(FREEZE_NAME).is_symlink()
        or (state_root / FREEZE_NAME).exists()
        or (state_root / FREEZE_NAME).is_symlink()
    ):
        raise CustodyError("packet freeze already exists")
    if any(
        packet_artifact(name).exists()
        or packet_artifact(name).is_symlink()
        or (state_root / name).exists()
        or (state_root / name).is_symlink()
        for name in (
            DEVELOPMENT_MARKER_NAME,
            DEVELOPMENT_SELECTION_NAME,
            HOLDOUT_MARKER_NAME,
            RESULT_NAME,
            CUSTODY_TERMINAL_NAME,
            SHA256SUMS_NAME,
        )
    ):
        raise CustodyError("outcome artifact exists before freeze")
    manifest, _ = validate_manifest(state_root, open_archives=False)
    manifest_raw = canonical_bytes(manifest)
    external_manifest = state_root / SOURCE_MANIFEST_NAME
    if external_manifest.read_bytes() != manifest_raw:
        raise CustodyError("external source manifest is not canonical")
    for prior_name, expected_sha in (
        (FREEZE_V1_NAME, FREEZE_V1_SHA256),
        (FREEZE_V2_NAME, FREEZE_V2_SHA256),
        (FREEZE_V3_NAME, FREEZE_V3_SHA256),
    ):
        packet_prior = packet_artifact(prior_name)
        external_prior = state_root / prior_name
        if (
            packet_prior.is_symlink()
            or external_prior.is_symlink()
            or not packet_prior.is_file()
            or not external_prior.is_file()
            or sha256_path(packet_prior) != expected_sha
            or sha256_path(external_prior) != expected_sha
        ):
            raise CustodyError(f"preserved {prior_name} packet/external binding invalid")
    write_exclusive_or_accept_identical(
        packet_artifact(SOURCE_MANIFEST_NAME),
        manifest_raw,
    )
    git_output("merge-base", "--is-ancestor", BASE_COMMIT, "HEAD")
    receipt: dict[str, object] = {
        "archiveBodiesOpened": 0,
        "authorityHead": git_output("rev-parse", "HEAD"),
        "canonicalBase": BASE_COMMIT,
        "createdAtUtc": utc_now(),
        "runtimeIdentity": runtime_identity(),
        "sourceManifestSha256": sha256_path(external_manifest),
        "staticHashes": static_hashes(),
        "supersedesFreezeV3AuthorityHead": REJECTED_V3_AUTHORITY_HEAD,
        "supersedesFreezeV3ExternalSha256": FREEZE_V3_SHA256,
        "supersedesFreezeV3PacketSha256": FREEZE_V3_SHA256,
        "supersessionReceiptSha256": sha256_path(packet_artifact(FREEZE_V3_SUPERSESSION_NAME)),
        "version": FREEZE_VERSION,
    }
    write_packet_authority_exclusive(packet_artifact(FREEZE_NAME), receipt)
    write_exclusive(state_root / FREEZE_NAME, receipt)
    return receipt


def validate_freeze(state_root: Path) -> dict[str, Any]:
    packet_freeze = packet_artifact(FREEZE_NAME)
    external_freeze = state_root / FREEZE_NAME
    freeze_receipt = load_json(packet_freeze, canonical=True)
    require_exact_keys(
        freeze_receipt,
        {
            "archiveBodiesOpened",
            "authorityHead",
            "canonicalBase",
            "createdAtUtc",
            "runtimeIdentity",
            "sourceManifestSha256",
            "staticHashes",
            "supersedesFreezeV3AuthorityHead",
            "supersedesFreezeV3ExternalSha256",
            "supersedesFreezeV3PacketSha256",
            "supersessionReceiptSha256",
            "version",
        },
        "freeze v4",
    )
    if (
        external_freeze.is_symlink()
        or not external_freeze.is_file()
        or external_freeze.read_bytes() != packet_freeze.read_bytes()
    ):
        raise CustodyError("external and packet freeze receipts differ")
    if freeze_receipt.get("archiveBodiesOpened") != 0:
        raise CustodyError("freeze v4 archive-open posture invalid")
    required_text(freeze_receipt.get("createdAtUtc"), "freeze v4 createdAtUtc")
    if freeze_receipt.get("canonicalBase") != BASE_COMMIT:
        raise CustodyError("freeze canonical base drift")
    if freeze_receipt.get("version") != FREEZE_VERSION:
        raise CustodyError("freeze version invalid")
    authority_head = freeze_receipt.get("authorityHead")
    if not isinstance(authority_head, str) or len(authority_head) != 40:
        raise CustodyError("freeze authority head invalid")
    git_output("merge-base", "--is-ancestor", authority_head, "HEAD")
    if freeze_receipt.get("staticHashes") != static_hashes():
        raise CustodyError("static packet changed after freeze")
    if freeze_receipt.get("runtimeIdentity") != runtime_identity():
        raise CustodyError("runtime identity changed after freeze")
    if (
        freeze_receipt.get("supersedesFreezeV3AuthorityHead") != REJECTED_V3_AUTHORITY_HEAD
        or freeze_receipt.get("supersedesFreezeV3PacketSha256") != FREEZE_V3_SHA256
        or freeze_receipt.get("supersedesFreezeV3ExternalSha256") != FREEZE_V3_SHA256
        or freeze_receipt.get("supersessionReceiptSha256")
        != sha256_path(packet_artifact(FREEZE_V3_SUPERSESSION_NAME))
    ):
        raise CustodyError("freeze v4 supersession binding invalid")
    for prior_name, expected_sha in (
        (FREEZE_V1_NAME, FREEZE_V1_SHA256),
        (FREEZE_V2_NAME, FREEZE_V2_SHA256),
        (FREEZE_V3_NAME, FREEZE_V3_SHA256),
    ):
        packet_prior = packet_artifact(prior_name)
        external_prior = state_root / prior_name
        if (
            packet_prior.is_symlink()
            or external_prior.is_symlink()
            or not packet_prior.is_file()
            or not external_prior.is_file()
            or sha256_path(packet_prior) != expected_sha
            or sha256_path(external_prior) != expected_sha
        ):
            raise CustodyError(f"preserved {prior_name} changed after freeze v4")
    manifest_path = state_root / SOURCE_MANIFEST_NAME
    packet_manifest = packet_artifact(SOURCE_MANIFEST_NAME)
    if freeze_receipt.get("sourceManifestSha256") != sha256_path(manifest_path):
        raise CustodyError("source manifest changed after freeze")
    if packet_manifest.read_bytes() != manifest_path.read_bytes():
        raise CustodyError("external and packet source manifests differ")
    validate_manifest(state_root, open_archives=False)
    return freeze_receipt


def merge_bars(
    destination: dict[str, dict[datetime, Bar]],
    source: Mapping[str, Mapping[datetime, Bar]],
) -> None:
    for symbol in COHORT:
        overlap = set(destination[symbol]) & set(source[symbol])
        if overlap:
            raise MeasurementError("duplicate bar while merging partitions")
        destination[symbol].update(source[symbol])


def result_path(state_root: Path) -> Path:
    return state_root / RESULT_NAME


def paired_paths(state_root: Path, name: str) -> tuple[Path, Path]:
    return packet_artifact(name), state_root / name


def receipt_state(state_root: Path, name: str) -> str:
    packet_path, external_path = paired_paths(state_root, name)
    packet_exists = packet_path.exists() or packet_path.is_symlink()
    external_exists = external_path.exists() or external_path.is_symlink()
    if not packet_exists and not external_exists:
        return "ABSENT"
    if packet_exists and not external_exists:
        return "PACKET_ONLY"
    if external_exists and not packet_exists:
        return "EXTERNAL_ONLY"
    if (
        packet_path.is_symlink()
        or external_path.is_symlink()
        or not packet_path.is_file()
        or not external_path.is_file()
    ):
        return "INVALID"
    if packet_path.read_bytes() != external_path.read_bytes():
        return "DIVERGED"
    return "MATCHED"


def receipt_states(state_root: Path) -> dict[str, str]:
    return {name: receipt_state(state_root, name) for name in TRACKED_RECEIPTS}


def path_custody_evidence(path: Path) -> dict[str, object]:
    try:
        metadata = os.lstat(path)
    except FileNotFoundError:
        return {
            "authorityJson": "ABSENT",
            "kind": "ABSENT",
        }
    if stat.S_ISLNK(metadata.st_mode):
        link_bytes = os.fsencode(os.readlink(path))
        return {
            "authorityJson": "INVALID_NONREGULAR",
            "kind": "SYMLINK",
            "linkTextBytes": len(link_bytes),
            "linkTextSha256": sha256_bytes(link_bytes),
        }
    if not stat.S_ISREG(metadata.st_mode):
        return {
            "authorityJson": "INVALID_NONREGULAR",
            "kind": "SPECIAL",
            "modeType": stat.S_IFMT(metadata.st_mode),
        }
    raw = path.read_bytes()
    authority_json = "INVALID_OR_NONCANONICAL"
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict) and raw == canonical_bytes(parsed):
            authority_json = "CANONICAL_OBJECT"
    except (UnicodeDecodeError, json.JSONDecodeError):
        pass
    return {
        "authorityJson": authority_json,
        "bytes": len(raw),
        "kind": "REGULAR",
        "sha256": sha256_bytes(raw),
    }


def receipt_evidence(state_root: Path) -> dict[str, object]:
    output: dict[str, object] = {}
    for name in TRACKED_RECEIPTS:
        packet_path, external_path = paired_paths(state_root, name)
        output[name] = {
            "external": path_custody_evidence(external_path),
            "packet": path_custody_evidence(packet_path),
            "state": receipt_state(state_root, name),
        }
    return output


def write_paired_exclusive(state_root: Path, name: str, value: object) -> None:
    """Write the packet authority first, then its external replica."""

    packet_path, external_path = paired_paths(state_root, name)
    write_packet_authority_exclusive(packet_path, value)
    write_exclusive(external_path, value)


def validate_receipt_pair(state_root: Path, name: str) -> tuple[Path, Path]:
    packet_path, external_path = paired_paths(state_root, name)
    if receipt_state(state_root, name) != "MATCHED":
        raise CustodyError(f"{name} receipt pair is not matched")
    load_json(packet_path, canonical=True)
    load_json(external_path, canonical=True)
    return packet_path, external_path


def holdout_custody_label(state_root: Path) -> str:
    return (
        "OPEN_AUTHORITY_CONSUMED_UNMEASURED"
        if receipt_state(state_root, HOLDOUT_MARKER_NAME) != "ABSENT"
        else "UNOPENED"
    )


def custody_snapshot(state_root: Path) -> dict[str, str]:
    return {
        name: receipt_state(state_root, name)
        for name in (
            DEVELOPMENT_MARKER_NAME,
            DEVELOPMENT_SELECTION_NAME,
            HOLDOUT_MARKER_NAME,
        )
    }


def common_terminal_fields() -> dict[str, object]:
    return {
        "accountProfitability": "UNKNOWN",
        "capitalVerdict": "NO_GO",
        "executionAuthority": "NONE",
        "moneyEffectUsd": "0",
        "programWideMultiplicity": dict(PROGRAM_MULTIPLICITY),
    }


def custody_terminal(
    state_root: Path,
    reason: str,
) -> dict[str, object]:
    path = packet_artifact(CUSTODY_TERMINAL_NAME)
    if path.exists() or path.is_symlink():
        return load_json(path, canonical=True)
    result: dict[str, object] = {
        **common_terminal_fields(),
        "createdAtUtc": utc_now(),
        "custodyOnly": True,
        "freezeSha256": (
            sha256_path(packet_artifact(FREEZE_NAME))
            if packet_artifact(FREEZE_NAME).is_file()
            else None
        ),
        "holdout": holdout_custody_label(state_root),
        "interruptedAfterMarker": True,
        "reason": reason,
        "receiptEvidence": receipt_evidence(state_root),
        "receiptStates": receipt_states(state_root),
        "status": "UNMEASURED",
        "version": CUSTODY_TERMINAL_VERSION,
    }
    write_packet_authority_exclusive(path, result)
    return result


def terminal_unmeasured(state_root: Path, reason: str) -> dict[str, object]:
    if any(
        state in {"PACKET_ONLY", "EXTERNAL_ONLY", "DIVERGED", "INVALID"}
        for state in receipt_states(state_root).values()
    ):
        return custody_terminal(state_root, reason)
    result: dict[str, object] = {
        **common_terminal_fields(),
        "createdAtUtc": utc_now(),
        "custodySnapshot": custody_snapshot(state_root),
        "freezeSha256": sha256_path(packet_artifact(FREEZE_NAME)),
        "holdout": holdout_custody_label(state_root),
        "interruptedAfterMarker": True,
        "reason": reason,
        "status": "UNMEASURED",
        "version": RESULT_VERSION,
    }
    try:
        write_paired_exclusive(state_root, RESULT_NAME, result)
    except BaseException:
        return custody_terminal(state_root, f"{reason}:RESULT_REPLICA_PARTIAL")
    return result


def development_selection(
    freeze_sha: str,
    development_marker_sha: str,
    report: Mapping[str, object],
) -> dict[str, object]:
    champion = required_text(report.get("champion"), "development champion")
    formal_gates = required_mapping(report.get("formalGates"), "development formalGates")
    authorized = required_bool(
        report.get("authorizedToOpenHoldout"),
        "development authorizedToOpenHoldout",
    )
    report_copy = json.loads(canonical_bytes(report))
    if not isinstance(report_copy, dict):
        raise CustodyError("development report copy invalid")
    return {
        "authorizedToOpenHoldout": authorized,
        "champion": champion,
        "createdAtUtc": utc_now(),
        "development": report_copy,
        "developmentMarkerSha256": development_marker_sha,
        "developmentReportSha256": sha256_bytes(canonical_bytes(report_copy)),
        "formalGates": formal_gates,
        "freezeSha256": freeze_sha,
        "version": "VG27DevelopmentSelectionV1",
    }


def write_normal_result(
    state_root: Path,
    result: Mapping[str, object],
) -> dict[str, object]:
    result_copy = json.loads(canonical_bytes(result))
    if not isinstance(result_copy, dict):
        raise CustodyError("result copy invalid")
    try:
        write_paired_exclusive(state_root, RESULT_NAME, result_copy)
    except BaseException:
        return custody_terminal(state_root, "RESULT_REPLICA_PARTIAL")
    return result_copy


def run(state_root: Path) -> dict[str, object]:
    states = receipt_states(state_root)
    if packet_artifact(SHA256SUMS_NAME).exists() or packet_artifact(SHA256SUMS_NAME).is_symlink():
        raise CustodyError("packet inventory exists before run; run refused")
    if (
        packet_artifact(CUSTODY_TERMINAL_NAME).exists()
        or packet_artifact(CUSTODY_TERMINAL_NAME).is_symlink()
    ):
        raise CustodyError("custody terminal exists; rerun refused")
    if states[RESULT_NAME] == "MATCHED":
        raise CustodyError("terminal result exists; rerun refused")
    if any(state != "ABSENT" for state in states.values()):
        return custody_terminal(state_root, "INTERRUPTION_AFTER_CONSUMED_RECEIPT")
    validate_freeze(state_root)
    freeze_sha = sha256_path(packet_artifact(FREEZE_NAME))
    marker = {
        "createdAtUtc": utc_now(),
        "freezeSha256": freeze_sha,
        "phase": "DEVELOPMENT",
        "version": OPEN_MARKER_VERSION,
    }
    try:
        write_paired_exclusive(state_root, DEVELOPMENT_MARKER_NAME, marker)
        packet_development_marker, _ = validate_receipt_pair(
            state_root,
            DEVELOPMENT_MARKER_NAME,
        )
        _manifest, development_bars = validate_manifest(
            state_root,
            open_archives=True,
            months=frozenset(DEVELOPMENT_MONTHS),
        )
        development = validate_development_report(development_analysis(development_bars))
        selection = development_selection(
            freeze_sha,
            sha256_path(packet_development_marker),
            development,
        )
        write_paired_exclusive(
            state_root,
            DEVELOPMENT_SELECTION_NAME,
            selection,
        )
        packet_selection, _ = validate_receipt_pair(
            state_root,
            DEVELOPMENT_SELECTION_NAME,
        )
        selection_sha = sha256_path(packet_selection)
        result: dict[str, object] = {
            **common_terminal_fields(),
            "createdAtUtc": utc_now(),
            "development": development,
            "developmentSelectionSha256": selection_sha,
            "freezeSha256": freeze_sha,
            "holdout": "UNOPENED",
            "status": "NO_GO",
            "version": RESULT_VERSION,
        }
        if not required_bool(
            development.get("authorizedToOpenHoldout"),
            "development authorization",
        ):
            return write_normal_result(state_root, result)
        holdout_receipt = {
            "champion": required_text(development.get("champion"), "champion"),
            "createdAtUtc": utc_now(),
            "developmentMarkerSha256": sha256_path(packet_development_marker),
            "developmentSelectionSha256": selection_sha,
            "freezeSha256": freeze_sha,
            "phase": "HOLDOUT",
            "version": OPEN_MARKER_VERSION,
        }
        write_paired_exclusive(state_root, HOLDOUT_MARKER_NAME, holdout_receipt)
        _manifest, holdout_bars = validate_manifest(
            state_root,
            open_archives=True,
            months=frozenset(HOLDOUT_MONTHS),
        )
        merge_bars(development_bars, holdout_bars)
        champion = next(
            trial for trial in trial_grid() if trial.trial_id == development["champion"]
        )
        holdout_report = validate_holdout_report(
            holdout_analysis(development_bars, champion),
            champion.trial_id,
        )
        result["holdout"] = holdout_report
        result["status"] = holdout_report["publicVerdict"]
        return write_normal_result(state_root, result)
    except BaseException as error:
        if receipt_state(state_root, RESULT_NAME) == "MATCHED":
            raise
        if all(state == "ABSENT" for state in receipt_states(state_root).values()):
            raise
        return terminal_unmeasured(
            state_root,
            f"{type(error).__name__}:{error}",
        )


def validate_common_terminal(value: Mapping[str, object]) -> None:
    if value.get("accountProfitability") != "UNKNOWN":
        raise CustodyError("account profitability must remain UNKNOWN")
    if value.get("capitalVerdict") != "NO_GO":
        raise CustodyError("capital verdict must remain NO_GO")
    if value.get("executionAuthority") != "NONE":
        raise CustodyError("execution authority must remain NONE")
    if value.get("moneyEffectUsd") != "0":
        raise CustodyError("money effect must remain zero")
    if value.get("programWideMultiplicity") != PROGRAM_MULTIPLICITY:
        raise CustodyError("program-wide multiplicity boundary invalid")


def validate_marker(
    marker: Mapping[str, object],
    *,
    phase: str,
    freeze_sha: str,
) -> None:
    expected = {
        "createdAtUtc",
        "freezeSha256",
        "phase",
        "version",
    }
    if phase == "HOLDOUT":
        expected |= {
            "champion",
            "developmentMarkerSha256",
            "developmentSelectionSha256",
        }
    require_exact_keys(marker, expected, f"{phase} marker")
    if marker.get("version") != OPEN_MARKER_VERSION or marker.get("phase") != phase:
        raise CustodyError(f"{phase} marker version or phase invalid")
    if marker.get("freezeSha256") != freeze_sha:
        raise CustodyError(f"{phase} marker freeze binding invalid")
    required_text(marker.get("createdAtUtc"), f"{phase} marker createdAtUtc")


def scenario_row(
    report: Mapping[str, object],
    trial_id: str,
    scenario_name: str,
) -> dict[str, Any]:
    trials = required_mapping(report.get("trials"), "development trials")
    trial = required_mapping(trials.get(trial_id), f"trial {trial_id}")
    row = required_mapping(trial.get(scenario_name), f"{trial_id} {scenario_name}")
    if row.get("trialId") != trial_id or row.get("scenario") != scenario_name:
        raise CustodyError("trial scenario identity invalid")
    return row


def validate_probability(value: object, field: str) -> Decimal:
    parsed = receipt_decimal(value, field)
    if parsed < 0 or parsed > 1:
        raise CustodyError(f"{field} outside unit interval")
    return parsed


def validate_discrete_probability(
    value: object,
    field: str,
    *,
    denominator: int,
    allow_zero: bool,
) -> Decimal:
    text = required_text(value, field)
    parsed = validate_probability(text, field)
    numerator = int((parsed * Decimal(denominator)).to_integral_value())
    minimum = 0 if allow_zero else 1
    if numerator < minimum or numerator > denominator:
        raise CustodyError(f"{field} outside frozen discrete grid")
    if text != f"{numerator / denominator:.12f}":
        raise CustodyError(f"{field} outside frozen discrete grid")
    return parsed


def validate_bootstrap_summary(
    value: object,
    field: str,
    *,
    expected_observations: int,
) -> dict[str, Any]:
    summary = required_mapping(value, field)
    require_exact_keys(
        summary,
        {
            "blockHours",
            "lower95UsdPer1k",
            "medianUsdPer1k",
            "observations",
            "oneSidedCenteredP",
            "replicates",
            "upper95UsdPer1k",
        },
        field,
    )
    if summary.get("blockHours") != BOOTSTRAP_BLOCK_HOURS:
        raise CustodyError(f"{field} block length invalid")
    if summary.get("replicates") != BOOTSTRAP_REPLICATES:
        raise CustodyError(f"{field} replicate count invalid")
    if required_int(summary.get("observations"), f"{field} observations") != expected_observations:
        raise CustodyError(f"{field} observations invalid")
    lower = receipt_decimal(summary.get("lower95UsdPer1k"), f"{field} lower95")
    median_value = receipt_decimal(summary.get("medianUsdPer1k"), f"{field} median")
    upper = receipt_decimal(summary.get("upper95UsdPer1k"), f"{field} upper95")
    if not lower <= median_value <= upper:
        raise CustodyError(f"{field} interval ordering invalid")
    validate_discrete_probability(
        summary.get("oneSidedCenteredP"),
        f"{field} p",
        denominator=BOOTSTRAP_REPLICATES + 1,
        allow_zero=False,
    )
    return summary


def validate_simulation_mapping(
    value: object,
    *,
    allowed_activity_months: frozenset[str],
    trial_id: str,
    scenario_name: str,
) -> dict[str, Any]:
    row = required_mapping(value, f"{trial_id} {scenario_name}")
    require_exact_keys(
        row,
        {
            "activeMonths",
            "activityByMonth",
            "adverseCostUsd",
            "adverseExecutionBpsPerSide",
            "chargeableEntryExitReferenceNotionalUsd",
            "costReconciliation",
            "endingUsd",
            "eventCount",
            "executableCapacity",
            "feeBpsPerSide",
            "feeCostUsd",
            "grossTradingPnlUsd",
            "maxDrawdownFraction",
            "maximumActualEntryToNominalScreenRatio",
            "minimumNominalInitial1000ScreenUsd",
            "netUsdPer1k",
            "nominalInitial1000ScreenPass",
            "reinvestmentMayExceedNominalScreen",
            "scenario",
            "trialId",
        },
        f"{trial_id} {scenario_name}",
    )
    if row.get("trialId") != trial_id or row.get("scenario") != scenario_name:
        raise CustodyError("trial scenario identity invalid")
    activity = required_mapping(row.get("activityByMonth"), "activityByMonth")
    for month, count in activity.items():
        if not re.fullmatch(r"\d{4}-\d{2}", month):
            raise CustodyError("activity month key invalid")
        if month not in allowed_activity_months:
            raise CustodyError("activity month outside frozen partition")
        if required_int(count, f"activity {month}") < 1:
            raise CustodyError("activity month count invalid")
    active_months = required_int(row.get("activeMonths"), "activeMonths")
    event_count = required_int(row.get("eventCount"), "eventCount")
    if active_months != len(activity) or event_count != sum(activity.values()):
        raise CustodyError("activity and event count do not reconcile")
    ending = receipt_decimal(row.get("endingUsd"), "endingUsd")
    net = receipt_decimal(row.get("netUsdPer1k"), "netUsdPer1k")
    gross = receipt_decimal(row.get("grossTradingPnlUsd"), "grossTradingPnlUsd")
    fee = receipt_decimal(row.get("feeCostUsd"), "feeCostUsd")
    adverse = receipt_decimal(row.get("adverseCostUsd"), "adverseCostUsd")
    turnover = receipt_decimal(
        row.get("chargeableEntryExitReferenceNotionalUsd"),
        "chargeableEntryExitReferenceNotionalUsd",
    )
    fee_bps = receipt_decimal(row.get("feeBpsPerSide"), "feeBpsPerSide")
    adverse_bps = receipt_decimal(
        row.get("adverseExecutionBpsPerSide"),
        "adverseExecutionBpsPerSide",
    )
    frozen_cost = next(scenario for scenario in scenarios() if scenario.name == scenario_name)
    expected_fee_bps = frozen_cost.fee_per_side * Decimal(10_000)
    expected_adverse_bps = frozen_cost.adverse_per_side * Decimal(10_000)
    if fee_bps != expected_fee_bps or adverse_bps != expected_adverse_bps:
        raise CustodyError("scenario per-side basis points invalid")
    if ending <= 0 or turnover < 0 or fee < 0 or adverse < 0:
        raise CustodyError("ending or modeled costs outside domain")
    if event_count == 0:
        if any(value != 0 for value in (turnover, fee, adverse, gross, net)):
            raise CustodyError("zero-event scenario must have zero PnL and costs")
    elif turnover <= 0:
        raise CustodyError("event scenario chargeable notional must be positive")
    elif turnover + STORED_DECIMAL_TOLERANCE < STARTING_USD / (
        Decimal(1) + frozen_cost.fee_per_side + frozen_cost.adverse_per_side
    ):
        raise CustodyError("event scenario chargeable notional below first-entry floor")
    elif scenario_name == "gross":
        if fee != 0 or adverse != 0:
            raise CustodyError("gross scenario modeled costs must be zero")
    else:
        if fee <= 0 or adverse <= 0:
            raise CustodyError("cost scenario modeled costs must be positive")
        expected_fee = turnover * fee_bps / Decimal(10_000)
        expected_adverse = turnover * adverse_bps / Decimal(10_000)
        if (
            abs(fee - expected_fee) > STORED_DECIMAL_TOLERANCE
            or abs(adverse - expected_adverse) > STORED_DECIMAL_TOLERANCE
        ):
            raise CustodyError("scenario costs contradict chargeable notional")
        if scenario_name == "base" and abs(fee - Decimal(2) * adverse) > STORED_DECIMAL_TOLERANCE:
            raise CustodyError("base scenario cost ratio invalid")
        if (
            scenario_name == "stress"
            and abs(Decimal(2) * adverse - Decimal(3) * fee) > STORED_DECIMAL_TOLERANCE
        ):
            raise CustodyError("stress scenario cost ratio invalid")
        if (
            scenario_name == "severe"
            and abs(Decimal(4) * adverse - Decimal(5) * fee) > STORED_DECIMAL_TOLERANCE
        ):
            raise CustodyError("severe scenario cost ratio invalid")
    if ending != STARTING_USD + net:
        raise CustodyError("ending and net do not reconcile")
    reconciled = STARTING_USD + gross - fee - adverse
    if abs(ending - reconciled) > STORED_DECIMAL_TOLERANCE:
        raise CustodyError("ending and cost decomposition do not reconcile")
    reconciliation = required_mapping(
        row.get("costReconciliation"),
        "costReconciliation",
    )
    require_exact_keys(
        reconciliation,
        {
            "endingUsd",
            "matches",
            "startingPlusGrossMinusFeeMinusAdverseUsd",
        },
        "costReconciliation",
    )
    if (
        reconciliation.get("matches") is not True
        or receipt_decimal(reconciliation.get("endingUsd"), "reconciliation ending") != ending
        or abs(
            receipt_decimal(
                reconciliation.get("startingPlusGrossMinusFeeMinusAdverseUsd"),
                "reconciliation decomposition",
            )
            - reconciled
        )
        > STORED_DECIMAL_TOLERANCE
    ):
        raise CustodyError("stored cost reconciliation invalid")
    drawdown = receipt_decimal(row.get("maxDrawdownFraction"), "maxDrawdownFraction")
    if drawdown < 0 or drawdown > 1:
        raise CustodyError("drawdown outside unit interval")
    screen_raw = row.get("minimumNominalInitial1000ScreenUsd")
    screen = (
        None
        if screen_raw is None
        else receipt_decimal(screen_raw, "minimumNominalInitial1000ScreenUsd")
    )
    if screen is not None and screen < 0:
        raise CustodyError("nominal screen cannot be negative")
    screen_pass = required_bool(
        row.get("nominalInitial1000ScreenPass"),
        "nominalInitial1000ScreenPass",
    )
    if screen_pass != (screen is not None and screen >= STARTING_USD):
        raise CustodyError("nominal screen flag contradicts value")
    ratio_raw = row.get("maximumActualEntryToNominalScreenRatio")
    ratio = (
        None
        if ratio_raw is None
        else receipt_decimal(ratio_raw, "maximumActualEntryToNominalScreenRatio")
    )
    if ratio is not None and ratio < 0:
        raise CustodyError("entry-to-screen ratio cannot be negative")
    if event_count == 0 and (screen is not None or ratio is not None):
        raise CustodyError("zero-event row cannot report screen or ratio")
    if event_count > 0 and screen is None:
        raise CustodyError("event row must report nominal screen")
    if event_count > 0 and screen is not None and screen > 0 and ratio is None:
        raise CustodyError("positive event screen requires actual-entry ratio")
    if row.get("reinvestmentMayExceedNominalScreen") is not True:
        raise CustodyError("reinvestment screen boundary invalid")
    if row.get("executableCapacity") != "UNMEASURED":
        raise CustodyError("executable capacity must remain UNMEASURED")
    return row


def validate_shared_event_path(rows: Mapping[str, Mapping[str, object]]) -> None:
    scenario_names = tuple(sorted(rows))
    if not scenario_names:
        raise CustodyError("shared event path is empty")
    first = rows[scenario_names[0]]
    for name in scenario_names[1:]:
        row = rows[name]
        for field in (
            "activeMonths",
            "activityByMonth",
            "eventCount",
            "minimumNominalInitial1000ScreenUsd",
        ):
            if row.get(field) != first.get(field):
                raise CustodyError(f"scenario event path field differs: {field}")


def validate_pbo(value: object) -> None:
    pbo = required_mapping(value, "PBO")
    require_exact_keys(
        pbo,
        {
            "blocks",
            "diagnosticOnlyNeverSelectionRescue",
            "distinctTrialPaths",
            "probabilityOverfit",
            "splitCount",
            "status",
        },
        "PBO",
    )
    if pbo.get("blocks") != 8 or pbo.get("splitCount") != math.comb(8, 4):
        raise CustodyError("PBO block or split count invalid")
    if pbo.get("diagnosticOnlyNeverSelectionRescue") is not True:
        raise CustodyError("PBO role invalid")
    distinct = required_int(pbo.get("distinctTrialPaths"), "PBO distinctTrialPaths")
    if distinct < 1 or distinct > len(trial_grid()):
        raise CustodyError("PBO distinct trial paths outside frozen family")
    status = pbo.get("status")
    probability = pbo.get("probabilityOverfit")
    if distinct < 2:
        if status != "NOT_ESTIMABLE" or probability is not None:
            raise CustodyError("PBO non-estimable state invalid")
    else:
        if status != "ESTIMATED":
            raise CustodyError("PBO estimated state invalid")
        validate_discrete_probability(
            probability,
            "PBO probabilityOverfit",
            denominator=math.comb(8, 4),
            allow_zero=True,
        )


def validate_development_report(value: object) -> dict[str, Any]:
    report = required_mapping(value, "development")
    require_exact_keys(
        report,
        {
            "authorizedToOpenHoldout",
            "bootstrap",
            "champion",
            "championEventConcentrationMaximumMonthFraction",
            "diagnostics",
            "formalGates",
            "holmAdjustedP",
            "pbo",
            "programWideMultiplicity",
            "trials",
            "white",
        },
        "development",
    )
    trial_ids = tuple(trial.trial_id for trial in trial_grid())
    champion = required_text(report.get("champion"), "development champion")
    if champion not in trial_ids:
        raise CustodyError("development champion not in frozen family")
    trials = required_mapping(report.get("trials"), "development trials")
    if set(trials) != set(trial_ids):
        raise CustodyError("development must contain all 12 trials")
    base_net_by_trial: dict[str, Decimal] = {}
    for trial_id in trial_ids:
        trial = required_mapping(trials[trial_id], f"trial {trial_id}")
        if set(trial) != {scenario.name for scenario in scenarios()}:
            raise CustodyError("development scenario family incomplete")
        validated_rows = {
            scenario_name: validate_simulation_mapping(
                trial[scenario_name],
                allowed_activity_months=DEVELOPMENT_ACTIVITY_MONTHS,
                trial_id=trial_id,
                scenario_name=scenario_name,
            )
            for scenario_name in trial
        }
        validate_shared_event_path(validated_rows)
        base_net_by_trial[trial_id] = receipt_decimal(
            validated_rows["base"].get("netUsdPer1k"),
            f"{trial_id} base net",
        )
    reconstructed_champion = frozen_champion_id(base_net_by_trial)
    if champion != reconstructed_champion:
        raise CustodyError("development champion contradicts frozen selection rule")
    bootstrap = required_mapping(report.get("bootstrap"), "development bootstrap")
    if set(bootstrap) != {"base", "stress"}:
        raise CustodyError("development bootstrap scenarios invalid")
    bootstrap_observations: set[int] = set()
    base_raw_p: dict[str, float] = {}
    for name in ("base", "stress"):
        rows = required_mapping(bootstrap[name], f"bootstrap {name}")
        if set(rows) != set(trial_ids):
            raise CustodyError("bootstrap trial family incomplete")
        for trial_id in trial_ids:
            summary = validate_bootstrap_summary(
                rows[trial_id],
                f"bootstrap {name} {trial_id}",
                expected_observations=DEVELOPMENT_OBSERVATIONS,
            )
            bootstrap_observations.add(
                required_int(
                    summary.get("observations"),
                    f"bootstrap {name} {trial_id} observations",
                )
            )
            if name == "base":
                base_raw_p[trial_id] = float(
                    required_text(
                        summary.get("oneSidedCenteredP"),
                        f"bootstrap base {trial_id} p",
                    )
                )
    if len(bootstrap_observations) != 1:
        raise CustodyError("development bootstrap observation counts differ")
    holm = required_mapping(report.get("holmAdjustedP"), "Holm")
    if set(holm) != set(trial_ids):
        raise CustodyError("Holm trial family incomplete")
    reconstructed_holm = {
        trial_id: f"{value:.12f}" for trial_id, value in holm_adjust(base_raw_p).items()
    }
    if holm != reconstructed_holm:
        raise CustodyError("Holm adjustments contradict frozen raw p-values")
    for trial_id, adjusted in reconstructed_holm.items():
        validate_probability(adjusted, f"Holm {trial_id}")
    white = required_mapping(report.get("white"), "White")
    require_exact_keys(
        white,
        {"method", "observed", "pValue", "trialCount"},
        "White",
    )
    if (
        white.get("trialCount") != len(trial_ids)
        or white.get("method") != "CENTERED_SYNCHRONOUS_WHITE_MAX_STAT"
    ):
        raise CustodyError("White trial count invalid")
    receipt_decimal(white.get("observed"), "White observed")
    validate_discrete_probability(
        white.get("pValue"),
        "White p",
        denominator=BOOTSTRAP_REPLICATES + 1,
        allow_zero=False,
    )
    validate_pbo(report.get("pbo"))
    pbo = required_mapping(report.get("pbo"), "PBO")
    diagnostics = required_mapping(report.get("diagnostics"), "development diagnostics")
    require_exact_keys(
        diagnostics,
        {"pboAtMost0.5", "pboRole"},
        "development diagnostics",
    )
    if diagnostics.get("pboRole") != "DIAGNOSTIC_ONLY_NEVER_SELECTION_OR_HOLDOUT_AUTHORIZATION":
        raise CustodyError("development PBO diagnostic role invalid")
    pbo_probability = pbo.get("probabilityOverfit")
    expected_pbo_gate = (
        receipt_decimal(pbo_probability, "PBO diagnostic probability") <= Decimal("0.5")
        if isinstance(pbo_probability, str)
        else None
    )
    if diagnostics.get("pboAtMost0.5") != expected_pbo_gate:
        raise CustodyError("development PBO diagnostic value invalid")
    if report.get("programWideMultiplicity") != PROGRAM_MULTIPLICITY:
        raise CustodyError("development program multiplicity invalid")
    gates = required_mapping(report.get("formalGates"), "development formalGates")
    if set(gates) != DEVELOPMENT_GATE_NAMES:
        raise CustodyError("development gate family invalid")
    if any(not isinstance(value, bool) for value in gates.values()):
        raise CustodyError("development gates must be boolean")
    base = scenario_row(report, champion, "base")
    stress = scenario_row(report, champion, "stress")
    champion_activity = required_mapping(
        base.get("activityByMonth"),
        "champion activityByMonth",
    )
    champion_events = required_int(base.get("eventCount"), "champion eventCount")
    expected_concentration = (
        Decimal(
            max(
                required_int(count, "champion activity count")
                for count in champion_activity.values()
            )
        )
        / Decimal(champion_events)
        if champion_events
        else Decimal(0)
    )
    if report.get("championEventConcentrationMaximumMonthFraction") != decimal_text(
        expected_concentration
    ):
        raise CustodyError("champion concentration contradicts activity path")
    base_bootstrap = required_mapping(
        required_mapping(bootstrap["base"], "base bootstrap").get(champion),
        "champion base bootstrap",
    )
    stress_bootstrap = required_mapping(
        required_mapping(bootstrap["stress"], "stress bootstrap").get(champion),
        "champion stress bootstrap",
    )
    expected_gates = {
        "activeMonthsAtLeast8": required_int(
            base.get("activeMonths"),
            "base activeMonths",
        )
        >= 8,
        "baseLcbPositive": receipt_decimal(
            base_bootstrap.get("lower95UsdPer1k"),
            "base lower95UsdPer1k",
        )
        > 0,
        "baseNetPositive": receipt_decimal(base.get("netUsdPer1k"), "base net") > 0,
        "drawdownAtMost20Pct": (
            receipt_decimal(base.get("maxDrawdownFraction"), "base drawdown") <= Decimal("0.20")
            and receipt_decimal(
                stress.get("maxDrawdownFraction"),
                "stress drawdown",
            )
            <= Decimal("0.20")
        ),
        "holmAdjustedPBelow0.05": receipt_decimal(
            holm[champion],
            "champion Holm p",
        )
        < Decimal("0.05"),
        "nominalInitial1000ScreenAtLeast1000": (
            base.get("minimumNominalInitial1000ScreenUsd") is not None
            and receipt_decimal(
                base.get("minimumNominalInitial1000ScreenUsd"),
                "nominal initial screen",
            )
            >= STARTING_USD
        ),
        "onEventsAtLeast100": required_int(base.get("eventCount"), "eventCount") >= 100,
        "stressLcbPositive": receipt_decimal(
            stress_bootstrap.get("lower95UsdPer1k"),
            "stress lower95UsdPer1k",
        )
        > 0,
        "stressNetPositive": receipt_decimal(
            stress.get("netUsdPer1k"),
            "stress net",
        )
        > 0,
        "whitePBelow0.05": receipt_decimal(
            white.get("pValue"),
            "White p",
        )
        < Decimal("0.05"),
    }
    if gates != expected_gates:
        raise CustodyError("development gate values contradict report metrics")
    authorized = required_bool(
        report.get("authorizedToOpenHoldout"),
        "authorizedToOpenHoldout",
    )
    if authorized != all(expected_gates.values()):
        raise CustodyError("development authorization contradicts formal gates")
    return report


def validate_development_selection(
    value: object,
    *,
    freeze_sha: str,
    development_marker_sha: str,
) -> dict[str, Any]:
    selection = required_mapping(value, "development selection")
    require_exact_keys(
        selection,
        {
            "authorizedToOpenHoldout",
            "champion",
            "createdAtUtc",
            "development",
            "developmentMarkerSha256",
            "developmentReportSha256",
            "formalGates",
            "freezeSha256",
            "version",
        },
        "development selection",
    )
    if selection.get("version") != "VG27DevelopmentSelectionV1":
        raise CustodyError("development selection version invalid")
    if selection.get("freezeSha256") != freeze_sha:
        raise CustodyError("development selection freeze binding invalid")
    if selection.get("developmentMarkerSha256") != development_marker_sha:
        raise CustodyError("development selection marker binding invalid")
    report = validate_development_report(selection.get("development"))
    if selection.get("developmentReportSha256") != sha256_bytes(canonical_bytes(report)):
        raise CustodyError("development selection report digest invalid")
    if selection.get("champion") != report.get("champion"):
        raise CustodyError("development selection champion mismatch")
    if selection.get("formalGates") != report.get("formalGates"):
        raise CustodyError("development selection gates mismatch")
    if selection.get("authorizedToOpenHoldout") != report.get("authorizedToOpenHoldout"):
        raise CustodyError("development selection authorization mismatch")
    return selection


def validate_holdout_report(value: object, champion: str) -> dict[str, Any]:
    report = required_mapping(value, "holdout")
    require_exact_keys(
        report,
        {"confirmationGates", "intervals", "publicVerdict", "scenarios"},
        "holdout",
    )
    scenarios_value = required_mapping(report.get("scenarios"), "holdout scenarios")
    scenario_names = {scenario.name for scenario in scenarios()}
    if set(scenarios_value) != scenario_names:
        raise CustodyError("holdout scenario family incomplete")
    validated_rows: dict[str, dict[str, Any]] = {}
    for name in scenario_names:
        validated_rows[name] = validate_simulation_mapping(
            scenarios_value[name],
            allowed_activity_months=HOLDOUT_ACTIVITY_MONTHS,
            trial_id=champion,
            scenario_name=name,
        )
    validate_shared_event_path(validated_rows)
    intervals = required_mapping(report.get("intervals"), "holdout intervals")
    if set(intervals) != {"base", "stress"}:
        raise CustodyError("holdout interval family invalid")
    interval_observations: set[int] = set()
    for name in ("base", "stress"):
        summary = validate_bootstrap_summary(
            intervals[name],
            f"holdout interval {name}",
            expected_observations=HOLDOUT_OBSERVATIONS,
        )
        interval_observations.add(
            required_int(
                summary.get("observations"),
                f"holdout interval {name} observations",
            )
        )
    if len(interval_observations) != 1:
        raise CustodyError("holdout interval observation counts differ")
    gates = required_mapping(report.get("confirmationGates"), "holdout gates")
    if set(gates) != HOLDOUT_GATE_NAMES or any(
        not isinstance(value, bool) for value in gates.values()
    ):
        raise CustodyError("holdout gate family invalid")
    base = validated_rows["base"]
    stress = validated_rows["stress"]
    expected = {
        "baseLcbPositive": receipt_decimal(
            required_mapping(intervals["base"], "holdout base interval").get("lower95UsdPer1k"),
            "holdout base lower95",
        )
        > 0,
        "baseNetPositive": receipt_decimal(base.get("netUsdPer1k"), "holdout base net") > 0,
        "drawdownAtMost20Pct": (
            receipt_decimal(base.get("maxDrawdownFraction"), "holdout base drawdown")
            <= Decimal("0.20")
            and receipt_decimal(
                stress.get("maxDrawdownFraction"),
                "holdout stress drawdown",
            )
            <= Decimal("0.20")
        ),
        "nominalInitial1000ScreenAtLeast1000": (
            base.get("minimumNominalInitial1000ScreenUsd") is not None
            and receipt_decimal(
                base.get("minimumNominalInitial1000ScreenUsd"),
                "holdout nominal initial screen",
            )
            >= STARTING_USD
        ),
        "stressLcbPositive": receipt_decimal(
            required_mapping(intervals["stress"], "holdout stress interval").get("lower95UsdPer1k"),
            "holdout stress lower95",
        )
        > 0,
        "stressNetPositive": receipt_decimal(
            stress.get("netUsdPer1k"),
            "holdout stress net",
        )
        > 0,
    }
    if gates != expected:
        raise CustodyError("holdout gates contradict report metrics")
    expected_verdict = "GO" if all(expected.values()) else "NO_GO"
    if report.get("publicVerdict") != expected_verdict:
        raise CustodyError("holdout verdict contradicts gates")
    return report


def validate_custody_terminal(state_root: Path, freeze_sha: str) -> dict[str, Any]:
    terminal_path = packet_artifact(CUSTODY_TERMINAL_NAME)
    if terminal_path.is_symlink() or not terminal_path.is_file():
        raise CustodyError("custody terminal is not a regular packet authority")
    terminal = load_json(terminal_path, canonical=True)
    require_exact_keys(
        terminal,
        {
            "accountProfitability",
            "capitalVerdict",
            "createdAtUtc",
            "custodyOnly",
            "executionAuthority",
            "freezeSha256",
            "holdout",
            "interruptedAfterMarker",
            "moneyEffectUsd",
            "programWideMultiplicity",
            "reason",
            "receiptEvidence",
            "receiptStates",
            "status",
            "version",
        },
        "custody terminal",
    )
    validate_common_terminal(terminal)
    if terminal.get("version") != CUSTODY_TERMINAL_VERSION:
        raise CustodyError("custody terminal version invalid")
    if terminal.get("status") != "UNMEASURED" or terminal.get("custodyOnly") is not True:
        raise CustodyError("custody terminal posture invalid")
    if terminal.get("freezeSha256") != freeze_sha:
        raise CustodyError("custody terminal freeze binding invalid")
    states = receipt_states(state_root)
    if terminal.get("receiptStates") != states:
        raise CustodyError("custody terminal receipt states drift")
    if terminal.get("receiptEvidence") != receipt_evidence(state_root):
        raise CustodyError("custody terminal receipt evidence drift")
    if all(state == "ABSENT" for state in states.values()):
        raise CustodyError("custody terminal has no consumed receipt")
    if states[RESULT_NAME] == "MATCHED":
        raise CustodyError("custody terminal cannot override matched result")
    if terminal.get("holdout") != holdout_custody_label(state_root):
        raise CustodyError("custody terminal holdout label invalid")
    required_text(terminal.get("reason"), "custody terminal reason")
    return terminal


def verify_semantic_state(
    state_root: Path,
    *,
    check_inventory: bool,
) -> dict[str, object]:
    validate_protocol()
    validate_freeze(state_root)
    freeze_sha = sha256_path(packet_artifact(FREEZE_NAME))
    if (
        packet_artifact(CUSTODY_TERMINAL_NAME).exists()
        or packet_artifact(CUSTODY_TERMINAL_NAME).is_symlink()
    ):
        terminal = validate_custody_terminal(state_root, freeze_sha)
        if check_inventory:
            verify_sha256s()
        return {
            "archiveBodiesOpened": 0,
            "receiptStates": receipt_states(state_root),
            "status": "VERIFIED_CUSTODY_UNMEASURED",
            "terminalAuthority": CUSTODY_TERMINAL_NAME,
            "terminalSha256": sha256_path(packet_artifact(CUSTODY_TERMINAL_NAME)),
            "terminalStatus": terminal["status"],
        }
    packet_result, _ = validate_receipt_pair(state_root, RESULT_NAME)
    packet_marker, _ = validate_receipt_pair(state_root, DEVELOPMENT_MARKER_NAME)
    result = load_json(packet_result, canonical=True)
    marker = load_json(packet_marker, canonical=True)
    validate_marker(marker, phase="DEVELOPMENT", freeze_sha=freeze_sha)
    validate_common_terminal(result)
    if result.get("version") != RESULT_VERSION:
        raise CustodyError("result version invalid")
    if result.get("freezeSha256") != freeze_sha:
        raise CustodyError("result freeze binding invalid")
    status = result.get("status")
    if status == "UNMEASURED":
        require_exact_keys(
            result,
            {
                "accountProfitability",
                "capitalVerdict",
                "createdAtUtc",
                "custodySnapshot",
                "executionAuthority",
                "freezeSha256",
                "holdout",
                "interruptedAfterMarker",
                "moneyEffectUsd",
                "programWideMultiplicity",
                "reason",
                "status",
                "version",
            },
            "UNMEASURED result",
        )
        required_text(result.get("createdAtUtc"), "UNMEASURED createdAtUtc")
        if result.get("interruptedAfterMarker") is not True:
            raise CustodyError("UNMEASURED interruption flag invalid")
        if result.get("custodySnapshot") != custody_snapshot(state_root):
            raise CustodyError("UNMEASURED custody snapshot invalid")
        if result.get("holdout") != holdout_custody_label(state_root):
            raise CustodyError("UNMEASURED holdout label invalid")
        required_text(result.get("reason"), "UNMEASURED reason")
        selection_state = receipt_state(state_root, DEVELOPMENT_SELECTION_NAME)
        holdout_state = receipt_state(state_root, HOLDOUT_MARKER_NAME)
        if selection_state not in {"ABSENT", "MATCHED"}:
            raise CustodyError("UNMEASURED selection receipt is partial")
        if holdout_state not in {"ABSENT", "MATCHED"}:
            raise CustodyError("UNMEASURED holdout receipt is partial")
        selection: dict[str, Any] | None = None
        selection_path = packet_artifact(DEVELOPMENT_SELECTION_NAME)
        if selection_state == "MATCHED":
            selection = validate_development_selection(
                load_json(selection_path, canonical=True),
                freeze_sha=freeze_sha,
                development_marker_sha=sha256_path(packet_marker),
            )
        if holdout_state == "MATCHED":
            if selection is None or selection.get("authorizedToOpenHoldout") is not True:
                raise CustodyError("UNMEASURED holdout lacks an authorized selection")
            holdout_path = packet_artifact(HOLDOUT_MARKER_NAME)
            holdout_marker = load_json(holdout_path, canonical=True)
            validate_marker(
                holdout_marker,
                phase="HOLDOUT",
                freeze_sha=freeze_sha,
            )
            if holdout_marker.get("developmentMarkerSha256") != sha256_path(packet_marker):
                raise CustodyError("UNMEASURED holdout development binding invalid")
            if holdout_marker.get("developmentSelectionSha256") != sha256_path(selection_path):
                raise CustodyError("UNMEASURED holdout selection binding invalid")
            if holdout_marker.get("champion") != selection.get("champion"):
                raise CustodyError("UNMEASURED holdout champion binding invalid")
    elif status in {"GO", "NO_GO"}:
        require_exact_keys(
            result,
            {
                "accountProfitability",
                "capitalVerdict",
                "createdAtUtc",
                "development",
                "developmentSelectionSha256",
                "executionAuthority",
                "freezeSha256",
                "holdout",
                "moneyEffectUsd",
                "programWideMultiplicity",
                "status",
                "version",
            },
            "measured result",
        )
        required_text(result.get("createdAtUtc"), "measured result createdAtUtc")
        selection_path, _ = validate_receipt_pair(
            state_root,
            DEVELOPMENT_SELECTION_NAME,
        )
        selection = validate_development_selection(
            load_json(selection_path, canonical=True),
            freeze_sha=freeze_sha,
            development_marker_sha=sha256_path(packet_marker),
        )
        if result.get("developmentSelectionSha256") != sha256_path(selection_path):
            raise CustodyError("result development selection binding invalid")
        if result.get("development") != selection.get("development"):
            raise CustodyError("result development report differs from selection")
        authorized = required_bool(
            selection.get("authorizedToOpenHoldout"),
            "selection authorization",
        )
        holdout_state = receipt_state(state_root, HOLDOUT_MARKER_NAME)
        if not authorized:
            if status != "NO_GO" or result.get("holdout") != "UNOPENED":
                raise CustodyError("development NO_GO result posture invalid")
            if holdout_state != "ABSENT":
                raise CustodyError("development NO_GO must not have holdout marker")
        else:
            holdout_path, _ = validate_receipt_pair(
                state_root,
                HOLDOUT_MARKER_NAME,
            )
            holdout_marker = load_json(holdout_path, canonical=True)
            validate_marker(
                holdout_marker,
                phase="HOLDOUT",
                freeze_sha=freeze_sha,
            )
            if holdout_marker.get("developmentMarkerSha256") != sha256_path(packet_marker):
                raise CustodyError("holdout marker development marker binding invalid")
            if holdout_marker.get("developmentSelectionSha256") != sha256_path(selection_path):
                raise CustodyError("holdout marker selection binding invalid")
            if holdout_marker.get("champion") != selection.get("champion"):
                raise CustodyError("holdout marker champion binding invalid")
            holdout_report = validate_holdout_report(
                result.get("holdout"),
                required_text(selection.get("champion"), "selection champion"),
            )
            if status != holdout_report.get("publicVerdict"):
                raise CustodyError("terminal status differs from holdout verdict")
    else:
        raise CustodyError("terminal public status invalid")
    if check_inventory:
        verify_sha256s()
    return {
        "archiveBodiesOpened": 0,
        "receiptStates": receipt_states(state_root),
        "status": "VERIFIED_WITHOUT_RECOMPUTATION",
        "terminalAuthority": RESULT_NAME,
        "terminalSha256": sha256_path(packet_result),
        "terminalStatus": status,
    }


def verify(state_root: Path) -> dict[str, object]:
    return verify_semantic_state(state_root, check_inventory=True)


def packet_files_without_inventory() -> tuple[Path, ...]:
    files: list[Path] = []
    custody_bound = packet_artifact(CUSTODY_TERMINAL_NAME).is_file()
    for path in PACKET_DIR.iterdir():
        if path.name == SHA256SUMS_NAME:
            continue
        if path.is_symlink() or not path.is_file():
            if path.name in TRACKED_RECEIPTS and custody_bound:
                continue
            raise CustodyError(f"unbound nonregular packet path: {path.name}")
        files.append(path)
    return tuple(sorted(files, key=lambda path: path.name))


def seal(state_root: Path) -> dict[str, object]:
    inventory_path = packet_artifact(SHA256SUMS_NAME)
    if inventory_path.exists() or inventory_path.is_symlink():
        raise CustodyError("packet inventory already exists")
    if not (
        packet_artifact(CUSTODY_TERMINAL_NAME).exists()
        or packet_artifact(CUSTODY_TERMINAL_NAME).is_symlink()
    ) and any(
        state in {"PACKET_ONLY", "EXTERNAL_ONLY", "DIVERGED", "INVALID"}
        for state in receipt_states(state_root).values()
    ):
        custody_terminal(state_root, "SEAL_DETECTED_PARTIAL_RECEIPT")
    semantic = verify_semantic_state(state_root, check_inventory=False)
    lines = [f"{sha256_path(path)}  {path.name}\n" for path in packet_files_without_inventory()]
    write_packet_authority_exclusive(inventory_path, "".join(lines).encode("ascii"))
    verify_sha256s()
    return {
        "fileCount": len(lines),
        "semanticStatus": semantic["status"],
        "sha256sSha256": sha256_path(inventory_path),
        "version": "VG27PacketSealV4",
    }


def verify_sha256s() -> None:
    inventory_path = packet_artifact(SHA256SUMS_NAME)
    if not inventory_path.is_file() or inventory_path.is_symlink():
        raise CustodyError("packet inventory absent")
    parsed: dict[str, str] = {}
    for line in inventory_path.read_text(encoding="ascii").splitlines():
        digest, separator, name = line.partition("  ")
        if not separator or len(digest) != 64 or Path(name).name != name or name in parsed:
            raise CustodyError("packet inventory grammar invalid")
        parsed[name] = digest
    expected = {path.name for path in packet_files_without_inventory()}
    if set(parsed) != expected:
        raise CustodyError("packet inventory membership mismatch")
    for name, digest in parsed.items():
        if sha256_path(packet_artifact(name)) != digest:
            raise CustodyError(f"packet digest mismatch: {name}")


def parse_args(arguments: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("acquire", "freeze", "run", "seal", "verify"))
    parser.add_argument("--state-root", type=Path, default=DEFAULT_STATE_ROOT)
    return parser.parse_args(arguments)


def main(arguments: Sequence[str] | None = None) -> int:
    args = parse_args(arguments)
    action = {
        "acquire": acquire,
        "freeze": freeze,
        "run": run,
        "seal": seal,
        "verify": verify,
    }[args.command]
    output = action(args.state_root)
    print(canonical_bytes(output).decode(), end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
