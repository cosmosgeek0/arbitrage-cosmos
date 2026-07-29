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
import random
import re
import subprocess
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
FORMATION_HOURS: Final = frozenset((0, 6, 12, 18))
HOUR_US: Final = 3_600_000_000
WEEK: Final = timedelta(days=7)
STARTING_USD: Final = Decimal("1000")
CAPACITY_PARTICIPATION: Final = Decimal("0.0001")
BOOTSTRAP_BLOCK_HOURS: Final = 168
BOOTSTRAP_REPLICATES: Final = 2048
BOOTSTRAP_SEED: Final = 270027
CHECKSUM_RE: Final = re.compile(rb"^([0-9a-f]{64})[ \t]+\*?([^\r\n]+)\r?\n?$")
SOURCE_MANIFEST_NAME: Final = "source-manifest.v1.json"
FREEZE_NAME: Final = "freeze.v1.json"
DEVELOPMENT_MARKER_NAME: Final = "development-open.v1.json"
HOLDOUT_MARKER_NAME: Final = "holdout-open.v1.json"
RESULT_NAME: Final = "result.v1.json"
SHA256SUMS_NAME: Final = "SHA256SUMS"


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
    capacity_usd: Decimal


@dataclass(frozen=True, slots=True)
class Event:
    signal_at: datetime
    entry_at: datetime
    exit_at: datetime
    capacity_usd: Decimal


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
    gross_trading_pnl_usd: Decimal
    fee_cost_usd: Decimal
    adverse_cost_usd: Decimal
    minimum_capacity_usd: Decimal | None
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
        capacity_usd=minimum_quote * CAPACITY_PARTICIPATION * Decimal(len(COHORT)),
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
        events.append(Event(formation, entry, exit_at, signal.capacity_usd))
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
    times = hour_range(start, end)
    equity: list[Decimal] = []
    for opened_at in times:
        if opened_at in exits:
            prices = prices_required(bars, opened_at, "exit")
            proceeds = sum(units[symbol] * prices[symbol] for symbol in COHORT)
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
            reference_entry = dict.fromkeys(COHORT, each_reference)
            entry_reference_total = each_reference * Decimal(len(COHORT))
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
        gross_trading_pnl_usd=gross_pnl,
        fee_cost_usd=fee_cost,
        adverse_cost_usd=adverse_cost,
        minimum_capacity_usd=min((event.capacity_usd for event in event_path), default=None),
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


def cscv_pbo(paths: Mapping[str, Sequence[Decimal]]) -> dict[str, object]:
    identifiers = tuple(sorted(paths))
    logs = {trial_id: log_returns(paths[trial_id]) for trial_id in identifiers}
    length = len(next(iter(logs.values())))
    if any(len(values) != length for values in logs.values()) or length < 8:
        raise MeasurementError("PBO paths are not aligned for eight blocks")
    blocks = tuple(
        tuple(range(length * index // 8, length * (index + 1) // 8)) for index in range(8)
    )
    overfit = 0
    splits = 0
    for training_blocks in itertools.combinations(range(8), 4):
        if 0 not in training_blocks:
            continue
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
        ordered_oos = sorted(
            identifiers,
            key=lambda trial_id: (
                -math.fsum(logs[trial_id][index] for index in testing),
                trial_id,
            ),
        )
        overfit += ordered_oos.index(champion) >= len(identifiers) / 2
        splits += 1
    return {
        "blocks": 8,
        "diagnosticOnlyNeverSelectionRescue": True,
        "probabilityOverfit": f"{overfit / splits:.12f}",
        "splits": splits,
    }


def monthly_activity(events: Sequence[Event]) -> dict[str, int]:
    output: dict[str, int] = {}
    for event in events:
        month = event.entry_at.strftime("%Y-%m")
        output[month] = output.get(month, 0) + 1
    return dict(sorted(output.items()))


def simulation_mapping(simulation: Simulation) -> dict[str, object]:
    activity = monthly_activity(simulation.events)
    reconciliation = (
        STARTING_USD
        + simulation.gross_trading_pnl_usd
        - simulation.fee_cost_usd
        - simulation.adverse_cost_usd
    )
    return {
        "activeMonths": len(activity),
        "activityByMonth": activity,
        "adverseCostUsd": decimal_text(simulation.adverse_cost_usd),
        "costReconciliation": {
            "endingUsd": decimal_text(simulation.ending_usd),
            "matches": reconciliation == simulation.ending_usd,
            "startingPlusGrossMinusFeeMinusAdverseUsd": decimal_text(reconciliation),
        },
        "endingUsd": decimal_text(simulation.ending_usd),
        "eventCount": len(simulation.events),
        "feeCostUsd": decimal_text(simulation.fee_cost_usd),
        "grossTradingPnlUsd": decimal_text(simulation.gross_trading_pnl_usd),
        "maxDrawdownFraction": decimal_text(simulation.max_drawdown),
        "minimumPublicCapacityUsd": (
            decimal_text(simulation.minimum_capacity_usd)
            if simulation.minimum_capacity_usd is not None
            else None
        ),
        "netUsdPer1k": decimal_text(simulation.ending_usd - STARTING_USD),
        "publicCapacity1000Pass": (
            simulation.minimum_capacity_usd is not None
            and simulation.minimum_capacity_usd >= STARTING_USD
        ),
        "scenario": simulation.scenario,
        "trialId": simulation.trial_id,
    }


def development_analysis(
    bars: Mapping[str, Mapping[datetime, Bar]],
    *,
    replicates: int = BOOTSTRAP_REPLICATES,
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
        replicates=replicates,
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
    holm = holm_adjust(raw_p)
    white = white_max_stat(
        {trial.trial_id: all_runs[trial.trial_id]["base"].hourly_returns for trial in trials},
        indices,
    )
    pbo = cscv_pbo(
        {trial.trial_id: all_runs[trial.trial_id]["base"].hourly_returns for trial in trials}
    )
    champion = max(
        trials,
        key=lambda trial: (
            all_runs[trial.trial_id]["base"].ending_usd,
            tuple(-ord(character) for character in trial.trial_id),
        ),
    )
    champion_runs = all_runs[champion.trial_id]
    base = champion_runs["base"]
    stress = champion_runs["stress"]
    activity = monthly_activity(base.events)
    event_concentration = (
        Decimal(max(activity.values())) / Decimal(len(base.events)) if base.events else Decimal(0)
    )
    formal_gates = {
        "activeMonthsAtLeast8": len(activity) >= 8,
        "baseLcbPositive": Decimal(
            required_text(
                base_bootstrap[champion.trial_id]["lower95UsdPer1k"],
                "base lower95UsdPer1k",
            )
        )
        > 0,
        "baseNetPositive": base.ending_usd > STARTING_USD,
        "drawdownAtMost20Pct": base.max_drawdown <= Decimal("0.20")
        and stress.max_drawdown <= Decimal("0.20"),
        "holmAdjustedPBelow0.05": holm[champion.trial_id] < 0.05,
        "onEventsAtLeast100": len(base.events) >= 100,
        "publicCapacityAtLeast1000": base.minimum_capacity_usd is not None
        and base.minimum_capacity_usd >= STARTING_USD,
        "stressLcbPositive": Decimal(
            required_text(
                stress_bootstrap[champion.trial_id]["lower95UsdPer1k"],
                "stress lower95UsdPer1k",
            )
        )
        > 0,
        "stressNetPositive": stress.ending_usd > STARTING_USD,
        "whitePBelow0.05": float(required_text(white["pValue"], "white pValue")) < 0.05,
    }
    diagnostics = {
        "pboAtMost0.5": float(required_text(pbo["probabilityOverfit"], "probabilityOverfit"))
        <= 0.5,
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
        "holmAdjustedP": {trial_id: f"{value:.12f}" for trial_id, value in sorted(holm.items())},
        "pbo": pbo,
        "trials": {
            trial.trial_id: {
                scenario_name: simulation_mapping(simulation)
                for scenario_name, simulation in sorted(all_runs[trial.trial_id].items())
            }
            for trial in trials
        },
        "white": white,
    }


def holdout_analysis(
    bars: Mapping[str, Mapping[datetime, Bar]],
    champion: Trial,
    *,
    replicates: int = BOOTSTRAP_REPLICATES,
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
        replicates=replicates,
        seed=BOOTSTRAP_SEED + 1,
    )
    intervals = {
        name: bootstrap_summary(runs[name].hourly_returns, indices) for name in ("base", "stress")
    }
    gates = {
        "baseLcbPositive": Decimal(
            required_text(
                intervals["base"]["lower95UsdPer1k"],
                "holdout base lower95UsdPer1k",
            )
        )
        > 0,
        "baseNetPositive": runs["base"].ending_usd > STARTING_USD,
        "drawdownAtMost20Pct": runs["base"].max_drawdown <= Decimal("0.20")
        and runs["stress"].max_drawdown <= Decimal("0.20"),
        "publicCapacityAtLeast1000": runs["base"].minimum_capacity_usd is not None
        and runs["base"].minimum_capacity_usd >= STARTING_USD,
        "stressLcbPositive": Decimal(
            required_text(
                intervals["stress"]["lower95UsdPer1k"],
                "holdout stress lower95UsdPer1k",
            )
        )
        > 0,
        "stressNetPositive": runs["stress"].ending_usd > STARTING_USD,
    }
    return {
        "confirmationGates": gates,
        "intervals": intervals,
        "publicVerdict": "GO" if all(gates.values()) else "NO_GO",
        "scenarios": {
            name: simulation_mapping(simulation) for name, simulation in sorted(runs.items())
        },
    }


def validate_protocol() -> dict[str, Any]:
    protocol = load_json(PROTOCOL_PATH)
    if protocol.get("canonicalBase") != BASE_COMMIT:
        raise CustodyError("canonical base drift")
    data = protocol.get("data")
    family = protocol.get("trialFamily")
    if not isinstance(data, dict) or data.get("symbols") != list(COHORT):
        raise CustodyError("cohort drift")
    if not isinstance(family, dict) or family.get("count") != 12:
        raise CustodyError("trial-family drift")
    if tuple(trial.trial_id for trial in trial_grid()) != tuple(
        sorted(trial.trial_id for trial in trial_grid())
    ):
        raise CustodyError("trial IDs are not stable")
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
    )
    missing = [path.name for path in paths if not path.is_file() or path.is_symlink()]
    if missing:
        raise CustodyError(f"static freeze input unavailable: {missing}")
    return {path.name: sha256_path(path) for path in paths}


def freeze(state_root: Path) -> dict[str, object]:
    validate_protocol()
    if packet_artifact(FREEZE_NAME).exists():
        raise CustodyError("packet freeze already exists")
    if any(
        packet_artifact(name).exists()
        for name in (
            DEVELOPMENT_MARKER_NAME,
            HOLDOUT_MARKER_NAME,
            RESULT_NAME,
            SHA256SUMS_NAME,
        )
    ):
        raise CustodyError("outcome artifact exists before freeze")
    manifest, _ = validate_manifest(state_root, open_archives=False)
    manifest_raw = canonical_bytes(manifest)
    external_manifest = state_root / SOURCE_MANIFEST_NAME
    if external_manifest.read_bytes() != manifest_raw:
        raise CustodyError("external source manifest is not canonical")
    write_exclusive(packet_artifact(SOURCE_MANIFEST_NAME), manifest_raw)
    git_output("merge-base", "--is-ancestor", BASE_COMMIT, "HEAD")
    receipt: dict[str, object] = {
        "archiveBodiesOpened": 0,
        "authorityHead": git_output("rev-parse", "HEAD"),
        "canonicalBase": BASE_COMMIT,
        "createdAtUtc": utc_now(),
        "sourceManifestSha256": sha256_path(external_manifest),
        "staticHashes": static_hashes(),
        "version": "VG27FreezeV1",
    }
    write_exclusive(packet_artifact(FREEZE_NAME), receipt)
    write_exclusive(state_root / FREEZE_NAME, receipt)
    return receipt


def validate_freeze(state_root: Path) -> dict[str, Any]:
    packet_freeze = packet_artifact(FREEZE_NAME)
    external_freeze = state_root / FREEZE_NAME
    freeze_receipt = load_json(packet_freeze, canonical=True)
    if external_freeze.read_bytes() != packet_freeze.read_bytes():
        raise CustodyError("external and packet freeze receipts differ")
    if freeze_receipt.get("canonicalBase") != BASE_COMMIT:
        raise CustodyError("freeze canonical base drift")
    authority_head = freeze_receipt.get("authorityHead")
    if not isinstance(authority_head, str) or len(authority_head) != 40:
        raise CustodyError("freeze authority head invalid")
    git_output("merge-base", "--is-ancestor", authority_head, "HEAD")
    if freeze_receipt.get("staticHashes") != static_hashes():
        raise CustodyError("static packet changed after freeze")
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


def write_paired_exclusive(state_root: Path, name: str, value: object) -> None:
    packet_path, external_path = paired_paths(state_root, name)
    write_exclusive(packet_path, value)
    write_exclusive(external_path, value)


def validate_receipt_pair(state_root: Path, name: str) -> tuple[Path, Path]:
    packet_path, external_path = paired_paths(state_root, name)
    load_json(packet_path, canonical=True)
    load_json(external_path, canonical=True)
    if packet_path.read_bytes() != external_path.read_bytes():
        raise CustodyError(f"external and packet {name} receipts differ")
    return packet_path, external_path


def terminal_unmeasured(
    state_root: Path,
    reason: str,
    *,
    interrupted: bool,
) -> dict[str, object]:
    holdout_consumed = any(path.exists() for path in paired_paths(state_root, HOLDOUT_MARKER_NAME))
    result: dict[str, object] = {
        "accountProfitability": "UNKNOWN",
        "capitalVerdict": "NO_GO",
        "createdAtUtc": utc_now(),
        "executionAuthority": "NONE",
        "freezeSha256": (
            sha256_path(packet_artifact(FREEZE_NAME))
            if packet_artifact(FREEZE_NAME).is_file()
            else None
        ),
        "holdout": ("OPEN_AUTHORITY_CONSUMED_UNMEASURED" if holdout_consumed else "UNOPENED"),
        "interruptedAfterMarker": interrupted,
        "moneyEffectUsd": "0",
        "reason": reason,
        "status": "UNMEASURED",
        "version": "VG27ResultV1",
    }
    write_paired_exclusive(state_root, RESULT_NAME, result)
    return result


def run(state_root: Path, *, replicates: int = BOOTSTRAP_REPLICATES) -> dict[str, object]:
    packet_result = packet_artifact(RESULT_NAME)
    if result_path(state_root).exists() or packet_result.exists():
        raise CustodyError("terminal result exists; rerun refused")
    packet_development_marker, development_marker = paired_paths(
        state_root, DEVELOPMENT_MARKER_NAME
    )
    packet_holdout_marker, holdout_marker = paired_paths(state_root, HOLDOUT_MARKER_NAME)
    if any(
        path.exists()
        for path in (
            packet_development_marker,
            development_marker,
            packet_holdout_marker,
            holdout_marker,
        )
    ):
        return terminal_unmeasured(
            state_root,
            "INTERRUPTION_AFTER_CONSUMED_MARKER",
            interrupted=True,
        )
    validate_freeze(state_root)
    marker = {
        "createdAtUtc": utc_now(),
        "freezeSha256": sha256_path(packet_artifact(FREEZE_NAME)),
        "phase": "DEVELOPMENT",
        "version": "VG27OpenMarkerV1",
    }
    write_paired_exclusive(state_root, DEVELOPMENT_MARKER_NAME, marker)
    try:
        _manifest, development_bars = validate_manifest(
            state_root,
            open_archives=True,
            months=frozenset(DEVELOPMENT_MONTHS),
        )
        development = development_analysis(development_bars, replicates=replicates)
        result: dict[str, object] = {
            "accountProfitability": "UNKNOWN",
            "capitalVerdict": "NO_GO",
            "createdAtUtc": utc_now(),
            "development": development,
            "executionAuthority": "NONE",
            "freezeSha256": sha256_path(packet_artifact(FREEZE_NAME)),
            "holdout": "UNOPENED",
            "moneyEffectUsd": "0",
            "status": "PUBLIC_GO" if development["authorizedToOpenHoldout"] else "NO_GO",
            "version": "VG27ResultV1",
        }
        if not development["authorizedToOpenHoldout"]:
            write_paired_exclusive(state_root, RESULT_NAME, result)
            return result
        holdout_receipt = {
            "champion": development["champion"],
            "createdAtUtc": utc_now(),
            "developmentMarkerSha256": sha256_path(packet_development_marker),
            "phase": "HOLDOUT",
            "version": "VG27OpenMarkerV1",
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
        holdout_report = holdout_analysis(
            development_bars,
            champion,
            replicates=replicates,
        )
        result["holdout"] = holdout_report
        result["status"] = holdout_report["publicVerdict"]
        write_paired_exclusive(state_root, RESULT_NAME, result)
        return result
    except BaseException as error:
        if not result_path(state_root).exists() and not packet_result.exists():
            return terminal_unmeasured(
                state_root,
                f"{type(error).__name__}:{error}",
                interrupted=False,
            )
        raise


def verify(state_root: Path) -> dict[str, object]:
    validate_protocol()
    validate_freeze(state_root)
    packet_result, _external_result = validate_receipt_pair(state_root, RESULT_NAME)
    packet_marker, _external_marker = validate_receipt_pair(state_root, DEVELOPMENT_MARKER_NAME)
    result = load_json(packet_result, canonical=True)
    marker = load_json(packet_marker, canonical=True)
    freeze_sha = sha256_path(packet_artifact(FREEZE_NAME))
    if marker.get("freezeSha256") != freeze_sha:
        raise CustodyError("development marker freeze binding invalid")
    if result.get("freezeSha256") != freeze_sha:
        raise CustodyError("result freeze binding invalid")
    if result.get("version") != "VG27ResultV1":
        raise CustodyError("result version invalid")
    if result.get("status") not in {"GO", "NO_GO", "UNMEASURED"}:
        raise CustodyError("terminal public status invalid")
    if result.get("accountProfitability") != "UNKNOWN":
        raise CustodyError("account profitability must remain UNKNOWN")
    if result.get("capitalVerdict") != "NO_GO":
        raise CustodyError("capital verdict must remain NO_GO")
    if result.get("executionAuthority") != "NONE":
        raise CustodyError("execution authority must remain NONE")
    if result.get("moneyEffectUsd") != "0":
        raise CustodyError("money effect must remain zero")
    packet_holdout = packet_artifact(HOLDOUT_MARKER_NAME)
    external_holdout = state_root / HOLDOUT_MARKER_NAME
    if packet_holdout.exists() or external_holdout.exists():
        validate_receipt_pair(state_root, HOLDOUT_MARKER_NAME)
        valid_unmeasured = (
            result.get("status") == "UNMEASURED"
            and result.get("holdout") == "OPEN_AUTHORITY_CONSUMED_UNMEASURED"
        )
        if not isinstance(result.get("holdout"), dict) and not valid_unmeasured:
            raise CustodyError("holdout marker exists without measured holdout")
    if packet_artifact(SHA256SUMS_NAME).exists():
        verify_sha256s()
    return {
        "archiveBodiesOpened": 0,
        "resultSha256": sha256_path(packet_result),
        "status": "VERIFIED_WITHOUT_RECOMPUTATION",
    }


def packet_files_without_inventory() -> tuple[Path, ...]:
    return tuple(
        sorted(
            (
                path
                for path in PACKET_DIR.iterdir()
                if path.is_file() and path.name != SHA256SUMS_NAME
            ),
            key=lambda path: path.name,
        )
    )


def seal(_state_root: Path) -> dict[str, object]:
    inventory_path = packet_artifact(SHA256SUMS_NAME)
    if inventory_path.exists():
        raise CustodyError("packet inventory already exists")
    if not packet_artifact(RESULT_NAME).is_file():
        raise CustodyError("terminal result absent before packet seal")
    lines = [f"{sha256_path(path)}  {path.name}\n" for path in packet_files_without_inventory()]
    write_exclusive(inventory_path, "".join(lines).encode("ascii"))
    return {
        "fileCount": len(lines),
        "sha256sSha256": sha256_path(inventory_path),
        "version": "VG27PacketSealV1",
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
