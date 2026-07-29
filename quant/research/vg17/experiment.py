"""Sealed V-G17 public-only impact-efficiency regime experiment.

The evaluator has no network, private API, account, order, execution, provider,
host, UI, or money capability. It admits frozen Binance public archive bytes,
forms lagged long-or-cash cohorts, and emits one terminal research verdict.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import os
import subprocess
import sys
import zipfile
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import ROUND_HALF_EVEN, Decimal, InvalidOperation, getcontext
from itertools import combinations
from pathlib import Path
from typing import Any, cast

getcontext().prec = 38

HERE = Path(__file__).resolve().parent
PROTOCOL_PATH = HERE / "protocol.v1.json"
SOURCE_MANIFEST_PATH = HERE / "source-manifest.v1.json"
FREEZE_PATH = HERE / "freeze.v1.json"
RUN_MARKER_PATH = HERE / "run-marker.v1.json"
CANDIDATE_SEAL_PATH = HERE / "candidate-seal.v1.json"
HOLDOUT_OPEN_PATH = HERE / "holdout-open.v1.json"
RESULT_PATH = HERE / "result.v1.json"
SHA256SUMS_PATH = HERE / "SHA256SUMS"

STATIC_FREEZE_FILES = (
    "OFFICIAL_SOURCE_RESEARCH.md",
    "README.md",
    "experiment.py",
    "protocol.v1.json",
    "source-manifest.v1.json",
    "test_experiment.py",
)

MILLION = Decimal(1_000_000)
TEN_THOUSAND = Decimal(10_000)
ZERO = Decimal(0)
ONE = Decimal(1)
INITIAL_USD = Decimal(1_000)
SLEEVE_COUNT = 7
MASK_64 = (1 << 64) - 1


class ContractError(RuntimeError):
    """Frozen packet or invocation contract failed."""


class MeasurementError(RuntimeError):
    """Required source or outcome evidence cannot support a measurement."""


@dataclass(frozen=True, slots=True)
class Bar:
    symbol: str
    day: date
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    quote_volume: Decimal


@dataclass(frozen=True, slots=True)
class Trial:
    trial_id: str
    lookback_days: int
    selected_count: int


@dataclass(frozen=True, slots=True)
class Selection:
    entry_day: date
    signal_day: date
    selected: tuple[str, ...]
    eligible_count: int
    reason: str


@dataclass(frozen=True, slots=True)
class Position:
    symbol: str
    quantity: Decimal
    entry_day: date
    entry_notional: Decimal


@dataclass(slots=True)
class Sleeve:
    cash: Decimal
    positions: tuple[Position, ...]


@dataclass(frozen=True, slots=True)
class Simulation:
    trial: Trial
    adverse_bps: int
    daily_pnl: tuple[Decimal, ...]
    daily_equity: tuple[Decimal, ...]
    active_entry_days: int
    round_trips: int
    distinct_assets: tuple[str, ...]
    maximum_drawdown_fraction: Decimal
    minimum_participation_headroom: Decimal | None
    minimum_stress_participation_headroom: Decimal | None
    final_net_usd: Decimal


@dataclass(frozen=True, slots=True)
class FamilyBootstrap:
    trial_intervals: Mapping[str, Mapping[str, object]]
    raw_p_values: Mapping[str, Decimal]
    white_reality_p_value: Decimal


class SplitMix64:
    """Small explicit deterministic generator; no runtime-global RNG state."""

    def __init__(self, seed: int) -> None:
        self._state = seed & MASK_64

    def next_u64(self) -> int:
        self._state = (self._state + 0x9E3779B97F4A7C15) & MASK_64
        value = self._state
        value = ((value ^ (value >> 30)) * 0xBF58476D1CE4E5B9) & MASK_64
        value = ((value ^ (value >> 27)) * 0x94D049BB133111EB) & MASK_64
        return (value ^ (value >> 31)) & MASK_64


def canonical_bytes(value: object) -> bytes:
    return (
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n"
    ).encode()


def sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_json(path: Path) -> dict[str, object]:
    try:
        value: Any = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ContractError(f"invalid JSON at {path.name}: {exc}") from exc
    if not isinstance(value, dict):
        raise ContractError(f"{path.name} must contain an object")
    return cast(dict[str, object], value)


def require_mapping(value: object, field: str) -> Mapping[str, object]:
    if not isinstance(value, dict):
        raise ContractError(f"{field} must be an object")
    return cast(Mapping[str, object], value)


def require_list(value: object, field: str) -> list[object]:
    if not isinstance(value, list):
        raise ContractError(f"{field} must be an array")
    return cast(list[object], value)


def require_str(value: object, field: str) -> str:
    if not isinstance(value, str):
        raise ContractError(f"{field} must be a string")
    return value


def require_int(value: object, field: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ContractError(f"{field} must be an integer")
    return value


def write_json_once(path: Path, value: object) -> None:
    payload = canonical_bytes(value)
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
    except FileExistsError as exc:
        raise ContractError(
            f"{path.name} already exists; sealed lifecycle forbids overwrite"
        ) from exc
    with os.fdopen(descriptor, "wb") as handle:
        handle.write(payload)
        handle.flush()
        os.fsync(handle.fileno())


def write_bytes_once(path: Path, payload: bytes) -> None:
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
    except FileExistsError as exc:
        raise ContractError(
            f"{path.name} already exists; sealed lifecycle forbids overwrite"
        ) from exc
    with os.fdopen(descriptor, "wb") as handle:
        handle.write(payload)
        handle.flush()
        os.fsync(handle.fileno())


def utc_now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def decimal_text(value: Decimal, places: int = 12) -> str:
    quantum = ONE.scaleb(-places)
    return format(value.quantize(quantum), "f")


def parse_day(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise ContractError(f"invalid UTC date: {value}") from exc


def dates(start: date, end: date) -> Iterable[date]:
    current = start
    while current <= end:
        yield current
        current += timedelta(days=1)


def median(values: Sequence[Decimal]) -> Decimal:
    if not values:
        raise MeasurementError("median requires observations")
    ordered = sorted(values)
    midpoint = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[midpoint]
    return (ordered[midpoint - 1] + ordered[midpoint]) / 2


def protocol() -> dict[str, object]:
    value = load_json(PROTOCOL_PATH)
    law = require_mapping(value.get("verdictLaw"), "verdictLaw")
    if law.get("version") != "VG17ProtocolV1":
        raise ContractError("unexpected protocol version")
    return value


def trials() -> tuple[Trial, ...]:
    config = require_mapping(protocol().get("trials"), "trials")
    lookbacks = tuple(
        require_int(value, "trials.lookbackDays[]")
        for value in require_list(config.get("lookbackDays"), "trials.lookbackDays")
    )
    selected = tuple(
        require_int(value, "trials.selectedCounts[]")
        for value in require_list(config.get("selectedCounts"), "trials.selectedCounts")
    )
    result = tuple(
        Trial(
            trial_id=f"vg17-l{lookback:02d}-k{count:02d}",
            lookback_days=lookback,
            selected_count=count,
        )
        for lookback in lookbacks
        for count in selected
    )
    expected = require_int(config.get("attemptedCount"), "trials.attemptedCount")
    if len(result) != expected or len({item.trial_id for item in result}) != expected:
        raise ContractError("frozen trial grid count or identity mismatch")
    return result


def symbols() -> tuple[str, ...]:
    cohort = require_mapping(protocol().get("cohort"), "cohort")
    values = tuple(
        require_str(value, "cohort.fixedSymbols[]")
        for value in require_list(cohort.get("fixedSymbols"), "cohort.fixedSymbols")
    )
    if values != tuple(sorted(set(values))) or any(not value.endswith("USDT") for value in values):
        raise ContractError("fixed cohort must be sorted unique USDT symbols")
    return values


def source_root() -> Path:
    data = require_mapping(protocol().get("data"), "data")
    return Path(require_str(data.get("sourceRoot"), "data.sourceRoot"))


def source_months() -> tuple[str, ...]:
    data = require_mapping(protocol().get("data"), "data")
    values: list[str] = []
    for field in ("developmentArchiveMonths", "holdoutArchiveMonths"):
        values.extend(
            require_str(item, f"data.{field}[]")
            for item in require_list(data.get(field), f"data.{field}")
        )
    result = tuple(values)
    if len(result) != len(set(result)):
        raise ContractError("archive months must be unique across partitions")
    return result


def expected_source_paths(symbol: str, month: str) -> tuple[Path, Path]:
    name = f"{symbol}-1d-{month}.zip"
    archive = source_root() / "archives" / symbol / month / name
    return archive, archive.with_name(f"{name}.CHECKSUM")


def verify_sidecar(sidecar: bytes, archive_name: str, archive_sha256: str) -> None:
    try:
        text = sidecar.decode("ascii").strip()
    except UnicodeDecodeError as exc:
        raise MeasurementError(f"non-ASCII checksum sidecar for {archive_name}") from exc
    fields = text.split()
    if len(fields) != 2:
        raise MeasurementError(f"malformed checksum sidecar for {archive_name}")
    digest, filename = fields
    if filename.startswith("*"):
        filename = filename[1:]
    if filename != archive_name:
        raise MeasurementError(f"checksum filename mismatch for {archive_name}")
    if len(digest) != 64 or any(character not in "0123456789abcdefABCDEF" for character in digest):
        raise MeasurementError(f"malformed checksum digest for {archive_name}")
    if digest.lower() != archive_sha256:
        raise MeasurementError(f"official checksum mismatch for {archive_name}")


def inventory_sources() -> dict[str, object]:
    if SOURCE_MANIFEST_PATH.exists():
        raise ContractError("source-manifest.v1.json already exists")
    records: list[dict[str, object]] = []
    root = source_root()
    for symbol in symbols():
        for month in source_months():
            archive, sidecar = expected_source_paths(symbol, month)
            try:
                archive_bytes = archive.read_bytes()
                sidecar_bytes = sidecar.read_bytes()
            except OSError as exc:
                raise MeasurementError(f"required public source missing: {archive}") from exc
            archive_sha = sha256_bytes(archive_bytes)
            verify_sidecar(sidecar_bytes, archive.name, archive_sha)
            relative_archive = archive.relative_to(root).as_posix()
            relative_sidecar = sidecar.relative_to(root).as_posix()
            records.append(
                {
                    "archiveBytes": len(archive_bytes),
                    "archivePath": relative_archive,
                    "archiveSha256": archive_sha,
                    "archiveUrl": (
                        "https://data.binance.vision/data/spot/monthly/klines/"
                        f"{symbol}/1d/{archive.name}"
                    ),
                    "checksumBytes": len(sidecar_bytes),
                    "checksumPath": relative_sidecar,
                    "checksumSha256": sha256_bytes(sidecar_bytes),
                    "checksumUrl": (
                        "https://data.binance.vision/data/spot/monthly/klines/"
                        f"{symbol}/1d/{archive.name}.CHECKSUM"
                    ),
                    "month": month,
                    "symbol": symbol,
                }
            )
    manifest: dict[str, object] = {
        "archiveBodiesDecompressed": False,
        "artifactCount": len(records),
        "baseCommit": require_str(protocol().get("baseCommit"), "baseCommit"),
        "createdAtUtc": utc_now(),
        "protocolSha256": sha256_path(PROTOCOL_PATH),
        "records": records,
        "schema": "VG17FrozenPublicSourceManifestV1",
        "sourceRoot": str(root),
        "state": "COMPRESSED_BYTES_AND_OFFICIAL_SIDECARS_VERIFIED_NO_MEMBERS_OPENED",
        "symbolCount": len(symbols()),
    }
    write_json_once(SOURCE_MANIFEST_PATH, manifest)
    return manifest


def freeze_packet() -> dict[str, object]:
    if FREEZE_PATH.exists():
        raise ContractError("freeze.v1.json already exists")
    manifest = load_json(SOURCE_MANIFEST_PATH)
    if manifest.get("state") != "COMPRESSED_BYTES_AND_OFFICIAL_SIDECARS_VERIFIED_NO_MEMBERS_OPENED":
        raise ContractError("source manifest is not in the pre-decompression state")
    bindings = {name: sha256_path(HERE / name) for name in STATIC_FREEZE_FILES}
    receipt: dict[str, object] = {
        "baseCommit": require_str(protocol().get("baseCommit"), "baseCommit"),
        "bindings": bindings,
        "createdAtUtc": utc_now(),
        "holdoutArchiveBodiesOpened": False,
        "protocolSha256": bindings["protocol.v1.json"],
        "schema": "VG17FreezeV1",
        "sourceManifestSha256": bindings["source-manifest.v1.json"],
        "state": "PROTOCOL_EVALUATOR_TESTS_AND_COMPRESSED_SOURCE_BYTES_FROZEN_BEFORE_OUTCOMES",
    }
    write_json_once(FREEZE_PATH, receipt)
    return receipt


def verify_freeze() -> dict[str, object]:
    freeze = load_json(FREEZE_PATH)
    if freeze.get("schema") != "VG17FreezeV1":
        raise ContractError("unexpected freeze schema")
    bindings = require_mapping(freeze.get("bindings"), "freeze.bindings")
    if tuple(sorted(bindings)) != tuple(sorted(STATIC_FREEZE_FILES)):
        raise ContractError("freeze binding inventory mismatch")
    for name in STATIC_FREEZE_FILES:
        expected = require_str(bindings.get(name), f"freeze.bindings.{name}")
        if sha256_path(HERE / name) != expected:
            raise ContractError(f"frozen file drift: {name}")
    if sha256_path(PROTOCOL_PATH) != freeze.get("protocolSha256"):
        raise ContractError("protocol digest drift")
    if sha256_path(SOURCE_MANIFEST_PATH) != freeze.get("sourceManifestSha256"):
        raise ContractError("source manifest digest drift")
    return freeze


def parse_decimal(raw: str, field: str, *, positive: bool = False) -> Decimal:
    try:
        value = Decimal(raw)
    except InvalidOperation as exc:
        raise MeasurementError(f"{field} is not a canonical decimal") from exc
    if not value.is_finite():
        raise MeasurementError(f"{field} must be finite")
    if positive and value <= ZERO:
        raise MeasurementError(f"{field} must be positive")
    if not positive and value < ZERO:
        raise MeasurementError(f"{field} must be nonnegative")
    return value


def parse_timestamp_us(raw: str, field: str) -> tuple[int, date]:
    if not raw.isdigit():
        raise MeasurementError(f"{field} must be unsigned integer microseconds")
    value = int(raw)
    if value < 10**15 or value >= 10**16:
        raise MeasurementError(f"{field} is not a frozen 2025+ microsecond timestamp")
    if value % 1_000 != 0:
        raise MeasurementError(f"{field} is not millisecond-aligned open time")
    seconds, microseconds = divmod(value, 1_000_000)
    timestamp = datetime.fromtimestamp(seconds, tz=UTC).replace(microsecond=microseconds)
    if (
        timestamp.hour,
        timestamp.minute,
        timestamp.second,
        timestamp.microsecond,
    ) != (0, 0, 0, 0):
        raise MeasurementError(f"{field} is not a UTC daily open")
    return value, timestamp.date()


def parse_close_timestamp_us(raw: str, expected_day: date, field: str) -> None:
    if not raw.isdigit():
        raise MeasurementError(f"{field} must be unsigned integer microseconds")
    value = int(raw)
    if value < 10**15 or value >= 10**16:
        raise MeasurementError(f"{field} is not a frozen 2025+ microsecond timestamp")
    seconds, microseconds = divmod(value, 1_000_000)
    timestamp = datetime.fromtimestamp(seconds, tz=UTC).replace(microsecond=microseconds)
    if (
        timestamp.date() != expected_day
        or timestamp.hour != 23
        or timestamp.minute != 59
        or timestamp.second != 59
        or timestamp.microsecond != 999_999
    ):
        raise MeasurementError(f"{field} is not the declared UTC daily close")


def manifest_records() -> tuple[Mapping[str, object], ...]:
    manifest = load_json(SOURCE_MANIFEST_PATH)
    records = tuple(
        require_mapping(value, "sourceManifest.records[]")
        for value in require_list(manifest.get("records"), "sourceManifest.records")
    )
    expected = len(symbols()) * len(source_months())
    if len(records) != expected or manifest.get("artifactCount") != expected:
        raise ContractError("source manifest artifact count mismatch")
    identities = tuple(
        (
            require_str(record.get("symbol"), "record.symbol"),
            require_str(record.get("month"), "record.month"),
        )
        for record in records
    )
    if identities != tuple(sorted(set(identities))):
        raise ContractError("source manifest identities must be sorted and unique")
    return records


def parse_archive(record: Mapping[str, object]) -> tuple[Bar, ...]:
    symbol = require_str(record.get("symbol"), "record.symbol")
    month = require_str(record.get("month"), "record.month")
    root = source_root()
    archive = root / require_str(record.get("archivePath"), "record.archivePath")
    sidecar = root / require_str(record.get("checksumPath"), "record.checksumPath")
    try:
        archive_bytes = archive.read_bytes()
        sidecar_bytes = sidecar.read_bytes()
    except OSError as exc:
        raise MeasurementError(f"frozen source unavailable: {symbol} {month}") from exc
    archive_sha = sha256_bytes(archive_bytes)
    if archive_sha != record.get("archiveSha256"):
        raise MeasurementError(f"frozen archive drift: {symbol} {month}")
    if sha256_bytes(sidecar_bytes) != record.get("checksumSha256"):
        raise MeasurementError(f"frozen checksum sidecar drift: {symbol} {month}")
    verify_sidecar(sidecar_bytes, archive.name, archive_sha)
    try:
        with zipfile.ZipFile(io.BytesIO(archive_bytes)) as bundle:
            members = [member for member in bundle.infolist() if not member.is_dir()]
            expected_name = f"{symbol}-1d-{month}.csv"
            if len(members) != 1 or members[0].filename != expected_name:
                raise MeasurementError(f"unexpected ZIP member layout: {symbol} {month}")
            member = members[0]
            if "/" in member.filename or member.file_size <= 0 or member.file_size > 1_000_000:
                raise MeasurementError(f"unsafe ZIP member: {symbol} {month}")
            raw = bundle.read(member)
    except (OSError, zipfile.BadZipFile, RuntimeError) as exc:
        raise MeasurementError(f"invalid ZIP archive: {symbol} {month}") from exc
    try:
        text = raw.decode("ascii")
    except UnicodeDecodeError as exc:
        raise MeasurementError(f"non-ASCII kline CSV: {symbol} {month}") from exc

    parsed: list[Bar] = []
    prior_timestamp: int | None = None
    for line_number, row in enumerate(csv.reader(io.StringIO(text)), start=1):
        if len(row) != 12:
            raise MeasurementError(f"{symbol} {month} line {line_number} does not have 12 fields")
        open_time, day = parse_timestamp_us(row[0], f"{symbol}.{month}.openTime")
        if day.strftime("%Y-%m") != month:
            raise MeasurementError(f"{symbol} {month} contains out-of-month row")
        if prior_timestamp is not None and open_time <= prior_timestamp:
            raise MeasurementError(f"duplicate or unsorted bar: {symbol} {month}")
        prior_timestamp = open_time
        open_price = parse_decimal(row[1], "open", positive=True)
        high = parse_decimal(row[2], "high", positive=True)
        low = parse_decimal(row[3], "low", positive=True)
        close = parse_decimal(row[4], "close", positive=True)
        parse_decimal(row[5], "baseVolume")
        parse_close_timestamp_us(row[6], day, f"{symbol}.{month}.closeTime")
        quote_volume = parse_decimal(row[7], "quoteVolume", positive=True)
        if not row[8].isdigit() or int(row[8]) < 0:
            raise MeasurementError(f"{symbol} {month} invalid trade count")
        parse_decimal(row[9], "takerBuyBaseVolume")
        parse_decimal(row[10], "takerBuyQuoteVolume")
        parse_decimal(row[11], "ignore")
        if low > min(open_price, close) or high < max(open_price, close) or low > high:
            raise MeasurementError(f"{symbol} {month} violates OHLC ordering")
        parsed.append(
            Bar(
                symbol=symbol,
                day=day,
                open=open_price,
                high=high,
                low=low,
                close=close,
                quote_volume=quote_volume,
            )
        )
    if not parsed:
        raise MeasurementError(f"empty archive: {symbol} {month}")
    expected_days = tuple(
        dates(
            date.fromisoformat(f"{month}-01"),
            (date.fromisoformat(f"{month}-28") + timedelta(days=4)).replace(day=1)
            - timedelta(days=1),
        )
    )
    actual_days = tuple(item.day for item in parsed)
    if actual_days != expected_days:
        raise MeasurementError(f"incomplete or non-daily archive grid: {symbol} {month}")
    return tuple(parsed)


def load_bars(months: set[str]) -> dict[str, dict[date, Bar]]:
    bars: dict[str, dict[date, Bar]] = {symbol: {} for symbol in symbols()}
    selected_records = [
        record
        for record in manifest_records()
        if require_str(record.get("month"), "record.month") in months
    ]
    expected = len(symbols()) * len(months)
    if len(selected_records) != expected:
        raise MeasurementError("source manifest does not cover requested months")
    for record in selected_records:
        for bar in parse_archive(record):
            symbol_bars = bars[bar.symbol]
            if bar.day in symbol_bars:
                raise MeasurementError(f"duplicate cross-archive day: {bar.symbol} {bar.day}")
            symbol_bars[bar.day] = bar
    return bars


def merge_bars(
    left: Mapping[str, Mapping[date, Bar]], right: Mapping[str, Mapping[date, Bar]]
) -> dict[str, dict[date, Bar]]:
    merged: dict[str, dict[date, Bar]] = {}
    for symbol in symbols():
        values = dict(left.get(symbol, {}))
        for day, bar in right.get(symbol, {}).items():
            if day in values:
                raise MeasurementError(f"duplicate merged day: {symbol} {day}")
            values[day] = bar
        merged[symbol] = values
    return merged


def daily_impact_terms(bars: Mapping[str, Mapping[date, Bar]]) -> dict[tuple[str, date], Decimal]:
    terms: dict[tuple[str, date], Decimal] = {}
    for symbol in symbols():
        symbol_bars = bars.get(symbol, {})
        for day, bar in sorted(symbol_bars.items()):
            prior = symbol_bars.get(day - timedelta(days=1))
            if prior is None:
                continue
            log_return = (bar.close / prior.close).ln()
            terms[(symbol, day)] = abs(log_return) * TEN_THOUSAND * MILLION / bar.quote_volume
    return terms


def impact_score(
    symbol: str,
    signal_day: date,
    lookback_days: int,
    bars: Mapping[str, Mapping[date, Bar]],
    terms: Mapping[tuple[str, date], Decimal],
) -> Decimal | None:
    symbol_bars = bars.get(symbol, {})
    required_days = tuple(signal_day - timedelta(days=offset) for offset in range(lookback_days))
    history_days = tuple(signal_day - timedelta(days=offset) for offset in range(57))
    if any(day not in symbol_bars for day in history_days):
        return None
    volume_days = tuple(signal_day - timedelta(days=offset) for offset in range(28))
    trailing_volume = median([symbol_bars[day].quote_volume for day in volume_days])
    if trailing_volume < Decimal(5_000_000):
        return None
    values: list[Decimal] = []
    for day in required_days:
        value = terms.get((symbol, day))
        if value is None:
            return None
        values.append(value)
    return sum(values, ZERO) / Decimal(lookback_days)


def select_cohort(
    entry_day: date,
    trial: Trial,
    bars: Mapping[str, Mapping[date, Bar]],
    terms: Mapping[tuple[str, date], Decimal],
) -> Selection:
    signal_day = entry_day - timedelta(days=2)
    scored: list[tuple[Decimal, str]] = []
    for symbol in symbols():
        score = impact_score(symbol, signal_day, trial.lookback_days, bars, terms)
        if score is not None:
            scored.append((score, symbol))
    if len(scored) < 15:
        return Selection(entry_day, signal_day, (), len(scored), "ELIGIBLE_COHORT_BELOW_15")
    scored.sort(key=lambda item: (-item[0], item[1]))
    selected: list[str] = []
    cursor = 0
    while cursor < len(scored) and len(selected) < trial.selected_count:
        score = scored[cursor][0]
        group: list[str] = []
        while cursor < len(scored) and scored[cursor][0] == score:
            group.append(scored[cursor][1])
            cursor += 1
        remaining = trial.selected_count - len(selected)
        if len(group) > remaining:
            break
        selected.extend(group)
    reason = "SELECTED" if selected else "BOUNDARY_TIE_OR_EMPTY"
    return Selection(entry_day, signal_day, tuple(selected), len(scored), reason)


def fill_cost_multiplier(adverse_bps: int, *, buy: bool) -> Decimal:
    costs = require_mapping(protocol().get("costs"), "costs")
    fee_bps = require_int(
        costs.get("publicRegularTakerFeeBasisPointsPerFill"),
        "costs.publicRegularTakerFeeBasisPointsPerFill",
    )
    fee = Decimal(fee_bps) / TEN_THOUSAND
    adverse = Decimal(adverse_bps) / TEN_THOUSAND
    return (ONE + adverse) * (ONE + fee) if buy else (ONE - adverse) * (ONE - fee)


def participation_limit(
    symbol: str,
    reference_day: date,
    bars: Mapping[str, Mapping[date, Bar]],
    participation_bps: Decimal,
) -> Decimal:
    symbol_bars = bars.get(symbol, {})
    reference = symbol_bars.get(reference_day)
    trailing = [symbol_bars.get(reference_day - timedelta(days=offset)) for offset in range(7)]
    if reference is None or any(item is None for item in trailing):
        raise MeasurementError(f"missing participation reference: {symbol} {reference_day}")
    volumes = [cast(Bar, item).quote_volume for item in trailing]
    return min(reference.quote_volume, median(volumes)) * participation_bps / TEN_THOUSAND


def maximum_drawdown(equity: Sequence[Decimal]) -> Decimal:
    if not equity:
        raise MeasurementError("drawdown requires an equity path")
    peak = INITIAL_USD
    maximum = ZERO
    for value in equity:
        if value > peak:
            peak = value
        if peak > ZERO:
            maximum = max(maximum, (peak - value) / peak)
    return maximum


def add_day_order(
    day_orders: dict[str, tuple[Decimal, list[Decimal], list[Decimal]]],
    *,
    symbol: str,
    notional: Decimal,
    reference_day: date,
    bars: Mapping[str, Mapping[date, Bar]],
) -> None:
    limit = participation_limit(symbol, reference_day, bars, Decimal("1"))
    stress_limit = participation_limit(symbol, reference_day, bars, Decimal("0.5"))
    prior = day_orders.get(symbol)
    if prior is None:
        day_orders[symbol] = (notional, [limit], [stress_limit])
        return
    prior_notional, limits, stress_limits = prior
    limits.append(limit)
    stress_limits.append(stress_limit)
    day_orders[symbol] = (
        prior_notional + notional,
        limits,
        stress_limits,
    )


def simulate(
    trial: Trial,
    adverse_bps: int,
    bars: Mapping[str, Mapping[date, Bar]],
    terms: Mapping[tuple[str, date], Decimal],
    *,
    start_day: date,
    entry_end_day: date,
    path_end_day: date,
    selection_cache: dict[tuple[str, date], Selection],
) -> Simulation:
    sleeves = [Sleeve(INITIAL_USD / SLEEVE_COUNT, ()) for _ in range(SLEEVE_COUNT)]
    prior_equity = INITIAL_USD
    daily_pnl: list[Decimal] = []
    daily_equity: list[Decimal] = []
    active_entry_days = 0
    round_trips = 0
    distinct_assets: set[str] = set()
    headrooms: list[Decimal] = []
    stress_headrooms: list[Decimal] = []
    buy_multiplier = fill_cost_multiplier(adverse_bps, buy=True)
    sell_multiplier = fill_cost_multiplier(adverse_bps, buy=False)

    for day in dates(start_day, path_end_day):
        sleeve = sleeves[(day - start_day).days % SLEEVE_COUNT]
        day_orders: dict[str, tuple[Decimal, list[Decimal], list[Decimal]]] = {}

        if sleeve.positions:
            if any(position.entry_day + timedelta(days=7) != day for position in sleeve.positions):
                raise MeasurementError("vintage sleeve exit schedule drift")
            exit_value = ZERO
            for position in sleeve.positions:
                exit_bar = bars.get(position.symbol, {}).get(day)
                if exit_bar is None:
                    raise MeasurementError(f"missing opened position exit: {position.symbol} {day}")
                exit_value += position.quantity * exit_bar.open * sell_multiplier
                add_day_order(
                    day_orders,
                    symbol=position.symbol,
                    notional=position.quantity * exit_bar.open,
                    reference_day=day - timedelta(days=1),
                    bars=bars,
                )
                round_trips += 1
            sleeve.cash += exit_value
            sleeve.positions = ()

        if day <= entry_end_day:
            key = (trial.trial_id, day)
            selection = selection_cache.get(key)
            if selection is None:
                selection = select_cohort(day, trial, bars, terms)
                selection_cache[key] = selection
            if selection.selected:
                active_entry_days += 1
                slot_notional = sleeve.cash / Decimal(trial.selected_count)
                opened: list[Position] = []
                for symbol in selection.selected:
                    entry_bar = bars.get(symbol, {}).get(day)
                    if entry_bar is None:
                        continue
                    sleeve.cash -= slot_notional
                    quantity = slot_notional / (entry_bar.open * buy_multiplier)
                    opened.append(Position(symbol, quantity, day, slot_notional))
                    distinct_assets.add(symbol)
                    add_day_order(
                        day_orders,
                        symbol=symbol,
                        notional=slot_notional,
                        reference_day=selection.signal_day,
                        bars=bars,
                    )
                sleeve.positions = tuple(opened)

        for total_notional, limits, stress_limits in day_orders.values():
            headrooms.append(min(limits) / total_notional)
            stress_headrooms.append(min(stress_limits) / total_notional)

        equity = ZERO
        for current in sleeves:
            equity += current.cash
            for position in current.positions:
                mark = bars.get(position.symbol, {}).get(day)
                if mark is None:
                    raise MeasurementError(
                        f"missing close mark for opened position: {position.symbol} {day}"
                    )
                equity += position.quantity * mark.close * sell_multiplier
        daily_equity.append(equity)
        daily_pnl.append(equity - prior_equity)
        prior_equity = equity

    if any(sleeve.positions for sleeve in sleeves):
        raise MeasurementError("segment ended with open positions")
    return Simulation(
        trial=trial,
        adverse_bps=adverse_bps,
        daily_pnl=tuple(daily_pnl),
        daily_equity=tuple(daily_equity),
        active_entry_days=active_entry_days,
        round_trips=round_trips,
        distinct_assets=tuple(sorted(distinct_assets)),
        maximum_drawdown_fraction=maximum_drawdown(daily_equity),
        minimum_participation_headroom=min(headrooms) if headrooms else None,
        minimum_stress_participation_headroom=(min(stress_headrooms) if stress_headrooms else None),
        final_net_usd=daily_equity[-1] - INITIAL_USD,
    )


def percentile(values: Sequence[Decimal], numerator: int, denominator: int) -> Decimal:
    if not values or numerator <= 0 or numerator >= denominator:
        raise ContractError("invalid percentile request")
    ordered = sorted(values)
    index = (numerator * len(ordered) + denominator - 1) // denominator - 1
    return ordered[index]


def circular_indices(count: int, block_length: int, rng: SplitMix64) -> tuple[int, ...]:
    if count <= 0 or block_length <= 0 or block_length > count:
        raise ContractError("invalid circular block geometry")
    output: list[int] = []
    while len(output) < count:
        start = rng.next_u64() % count
        output.extend((start + offset) % count for offset in range(block_length))
    return tuple(output[:count])


def family_bootstrap(
    matrix: Mapping[str, tuple[Decimal, ...]],
    *,
    block_length: int,
    replicates: int,
    seed: int,
) -> FamilyBootstrap:
    trial_ids = tuple(sorted(matrix))
    if len(trial_ids) != 12:
        raise ContractError("bootstrap family must contain all twelve trials")
    counts = {len(matrix[trial_id]) for trial_id in trial_ids}
    if len(counts) != 1:
        raise ContractError("bootstrap family paths must be synchronous")
    count = next(iter(counts))
    if count < block_length:
        raise ContractError("bootstrap block exceeds path")
    means = {trial_id: sum(matrix[trial_id], ZERO) / Decimal(count) for trial_id in trial_ids}
    centered = {
        trial_id: tuple(value - means[trial_id] for value in matrix[trial_id])
        for trial_id in trial_ids
    }
    replicate_means: dict[str, list[Decimal]] = {trial_id: [] for trial_id in trial_ids}
    null_exceedances = dict.fromkeys(trial_ids, 0)
    white_exceedances = 0
    observed_max = max(means.values())
    rng = SplitMix64(seed)
    for _ in range(replicates):
        indices = circular_indices(count, block_length, rng)
        null_max: Decimal | None = None
        for trial_id in trial_ids:
            sampled_mean = sum((matrix[trial_id][index] for index in indices), ZERO) / Decimal(
                count
            )
            null_mean = sum((centered[trial_id][index] for index in indices), ZERO) / Decimal(count)
            replicate_means[trial_id].append(sampled_mean)
            if null_mean >= means[trial_id]:
                null_exceedances[trial_id] += 1
            null_max = null_mean if null_max is None else max(null_max, null_mean)
        if cast(Decimal, null_max) >= observed_max:
            white_exceedances += 1
    intervals: dict[str, Mapping[str, object]] = {}
    p_values: dict[str, Decimal] = {}
    for trial_id in trial_ids:
        samples = replicate_means[trial_id]
        intervals[trial_id] = {
            "blockLengthDays": block_length,
            "coveragePerMyriad": 9500,
            "lowerUsdPerDay": decimal_text(percentile(samples, 25, 1000)),
            "pointUsdPerDay": decimal_text(means[trial_id]),
            "replicates": replicates,
            "upperUsdPerDay": decimal_text(percentile(samples, 975, 1000)),
        }
        p_values[trial_id] = Decimal(null_exceedances[trial_id] + 1) / Decimal(replicates + 1)
    return FamilyBootstrap(
        trial_intervals=intervals,
        raw_p_values=p_values,
        white_reality_p_value=Decimal(white_exceedances + 1) / Decimal(replicates + 1),
    )


def pbo_report(matrix: Mapping[str, tuple[Decimal, ...]]) -> Mapping[str, object]:
    trial_ids = tuple(sorted(matrix))
    block_scores: list[tuple[Decimal, ...]] = []
    for trial_id in trial_ids:
        path = matrix[trial_id]
        if len(path) < 240:
            raise MeasurementError("development path has fewer than 240 PBO rows")
        blocks: list[Decimal] = []
        for block_index in range(12):
            block = path[block_index * 20 : (block_index + 1) * 20]
            blocks.append(sum(block, ZERO) / Decimal(len(block)))
        block_scores.append(tuple(blocks))
    if len(block_scores) != 12:
        raise MeasurementError("PBO requires all twelve trial paths")
    split_count = 0
    underperform_count = 0
    for in_sample in combinations(range(12), 6):
        split_count += 1
        out_sample = tuple(index for index in range(12) if index not in in_sample)
        in_sample_means = [
            sum((block_scores[trial][index] for index in in_sample), ZERO) / Decimal(6)
            for trial in range(12)
        ]
        champion_index = max(range(12), key=lambda index: (in_sample_means[index], -index))
        out_sample_means = [
            sum((block_scores[trial][index] for index in out_sample), ZERO) / Decimal(6)
            for trial in range(12)
        ]
        ordered = sorted(out_sample_means)
        out_sample_median = (ordered[5] + ordered[6]) / 2
        if out_sample_means[champion_index] <= out_sample_median:
            underperform_count += 1
    if split_count != 924:
        raise MeasurementError("PBO symmetric split count mismatch")
    pbo_mantissa = int(
        (Decimal(underperform_count) * Decimal(10**12) / Decimal(split_count)).to_integral_value(
            rounding=ROUND_HALF_EVEN
        )
    )
    return {
        "blockCount": 12,
        "pbo": {"mantissa": str(pbo_mantissa), "scale": str(10**12)},
        "reason": None,
        "splitCount": split_count,
        "status": "AVAILABLE",
        "trialCount": 12,
        "underperformCount": underperform_count,
    }


def trial_ledger() -> dict[str, object]:
    return {
        "attemptedCount": 12,
        "schema": "VG17AttemptLedgerV1",
        "trials": [
            {
                "familyId": "vg17-impact-efficiency",
                "metricId": "stress-net-usd-per-day",
                "modelId": (f"lookback-{trial.lookback_days}-top-{trial.selected_count}"),
                "note": "frozen public-only impact-efficiency trial",
                "status": "COMPLETED",
                "trialId": trial.trial_id,
            }
            for trial in trials()
        ],
    }


def holm_report(raw_p_values: Mapping[str, Decimal]) -> dict[str, object]:
    trial_ids = tuple(sorted(raw_p_values))
    if trial_ids != tuple(sorted(trial.trial_id for trial in trials())):
        raise ContractError("Holm identities must equal the frozen attempt ledger")
    ordered = sorted((raw_p_values[trial_id], trial_id) for trial_id in trial_ids)
    selected: set[str] = set()
    latched_failure = False
    thresholds: dict[str, Decimal] = {}
    for index, (p_value, trial_id) in enumerate(ordered):
        threshold = Decimal("0.05") / Decimal(12 - index)
        thresholds[trial_id] = threshold
        passes = not latched_failure and p_value <= threshold
        if not passes:
            latched_failure = True
        if passes:
            selected.add(trial_id)
    return {
        "familywiseAlphaPerMyriad": 500,
        "rejectedTrialIds": sorted(selected),
        "testedCount": 12,
        "decisions": [
            {
                "rawPValue": decimal_text(raw_p_values[trial_id]),
                "selected": trial_id in selected,
                "threshold": decimal_text(thresholds[trial_id]),
                "trialId": trial_id,
            }
            for trial_id in trial_ids
        ],
    }


def simulation_mapping(simulation: Simulation) -> dict[str, object]:
    mean = sum(simulation.daily_pnl, ZERO) / Decimal(len(simulation.daily_pnl))
    return {
        "activeEntryDays": simulation.active_entry_days,
        "adversePriceBpsPerFill": simulation.adverse_bps,
        "dailyPathRows": len(simulation.daily_pnl),
        "distinctAssets": list(simulation.distinct_assets),
        "finalNetUsdPer1000": decimal_text(simulation.final_net_usd),
        "maximumCloseMarkDrawdownFraction": decimal_text(simulation.maximum_drawdown_fraction),
        "minimumParticipationHeadroom": (
            None
            if simulation.minimum_participation_headroom is None
            else decimal_text(simulation.minimum_participation_headroom)
        ),
        "minimumStressParticipationHeadroom": (
            None
            if simulation.minimum_stress_participation_headroom is None
            else decimal_text(simulation.minimum_stress_participation_headroom)
        ),
        "netMeanUsdPerDayPer1000": decimal_text(mean),
        "roundTrips": simulation.round_trips,
    }


def development_analysis(
    bars: Mapping[str, Mapping[date, Bar]],
) -> tuple[dict[str, object], Trial, tuple[str, ...]]:
    partitions = require_mapping(protocol().get("partitions"), "partitions")
    development = require_mapping(partitions.get("development"), "partitions.development")
    start = parse_day(require_str(development.get("entryStartUtcDate"), "development.start"))
    entry_end = parse_day(require_str(development.get("entryEndUtcDate"), "development.entryEnd"))
    path_end = parse_day(require_str(development.get("dailyPathEndUtcDate"), "development.pathEnd"))
    costs = require_mapping(protocol().get("costs"), "costs")
    base_adverse = require_int(costs.get("baseAdversePriceBasisPointsPerFill"), "costs.baseAdverse")
    stress_adverse = require_int(
        costs.get("stressAdversePriceBasisPointsPerFill"), "costs.stressAdverse"
    )
    terms = daily_impact_terms(bars)
    selection_cache: dict[tuple[str, date], Selection] = {}
    base: dict[str, Simulation] = {}
    stress: dict[str, Simulation] = {}
    for trial in trials():
        base[trial.trial_id] = simulate(
            trial,
            base_adverse,
            bars,
            terms,
            start_day=start,
            entry_end_day=entry_end,
            path_end_day=path_end,
            selection_cache=selection_cache,
        )
        stress[trial.trial_id] = simulate(
            trial,
            stress_adverse,
            bars,
            terms,
            start_day=start,
            entry_end_day=entry_end,
            path_end_day=path_end,
            selection_cache=selection_cache,
        )
    bootstrap_config = require_mapping(protocol().get("bootstrap"), "bootstrap")
    replicates = require_int(bootstrap_config.get("replicates"), "bootstrap.replicates")
    seed = require_int(bootstrap_config.get("seed"), "bootstrap.seed")
    base_paths = {trial_id: value.daily_pnl for trial_id, value in base.items()}
    stress_paths = {trial_id: value.daily_pnl for trial_id, value in stress.items()}
    primary_length = require_int(
        bootstrap_config.get("primaryBlockLengthDays"), "bootstrap.primaryBlockLengthDays"
    )
    secondary_length = require_int(
        bootstrap_config.get("secondaryBlockLengthDays"),
        "bootstrap.secondaryBlockLengthDays",
    )
    base_primary = family_bootstrap(
        base_paths, block_length=primary_length, replicates=replicates, seed=seed
    )
    base_secondary = family_bootstrap(
        base_paths, block_length=secondary_length, replicates=replicates, seed=seed + 1
    )
    stress_primary = family_bootstrap(
        stress_paths, block_length=primary_length, replicates=replicates, seed=seed + 2
    )
    stress_secondary = family_bootstrap(
        stress_paths, block_length=secondary_length, replicates=replicates, seed=seed + 3
    )
    ledger = trial_ledger()
    holm = holm_report(stress_primary.raw_p_values)
    pbo = pbo_report(stress_paths)
    ordered_trials = sorted(
        trials(),
        key=lambda trial: (
            -Decimal(
                require_str(
                    stress_primary.trial_intervals[trial.trial_id].get("lowerUsdPerDay"),
                    "stressPrimary.lowerUsdPerDay",
                )
            ),
            trial.lookback_days,
            trial.selected_count,
            trial.trial_id,
        ),
    )
    champion = ordered_trials[0]
    champion_id = champion.trial_id
    pbo_value_mapping = require_mapping(pbo.get("pbo"), "pbo.pbo")
    pbo_fraction = Decimal(
        require_str(pbo_value_mapping.get("mantissa"), "pbo.pbo.mantissa")
    ) / Decimal(10**12)
    champion_base = base[champion_id]
    champion_stress = stress[champion_id]
    reasons: list[str] = []
    for label, family in (
        ("BASE_7D", base_primary),
        ("BASE_14D", base_secondary),
        ("STRESS_7D", stress_primary),
        ("STRESS_14D", stress_secondary),
    ):
        lower = Decimal(
            require_str(
                family.trial_intervals[champion_id].get("lowerUsdPerDay"),
                f"{label}.lower",
            )
        )
        if lower <= ZERO:
            reasons.append(f"{label}_BOOTSTRAP_LOWER_NOT_POSITIVE")
    stress_mean = sum(champion_stress.daily_pnl, ZERO) / Decimal(len(champion_stress.daily_pnl))
    if stress_mean <= ZERO:
        reasons.append("STRESS_NET_MEAN_NOT_POSITIVE")
    if pbo_fraction > Decimal("0.50"):
        reasons.append("PBO_EXCEEDS_0_50")
    rejected = tuple(
        require_str(value, "holm.rejectedTrialIds[]")
        for value in require_list(holm.get("rejectedTrialIds"), "holm.rejectedTrialIds")
    )
    if champion_id not in rejected:
        reasons.append("HOLM_CHAMPION_NOT_REJECTED")
    if stress_primary.white_reality_p_value >= Decimal("0.05"):
        reasons.append("WHITE_REALITY_CHECK_NOT_BELOW_0_05")
    if champion_base.maximum_drawdown_fraction > Decimal("0.40"):
        reasons.append("BASE_DRAWDOWN_EXCEEDS_0_40")
    if champion_stress.maximum_drawdown_fraction > Decimal("0.40"):
        reasons.append("STRESS_DRAWDOWN_EXCEEDS_0_40")
    if champion_stress.active_entry_days < 160:
        reasons.append("ACTIVE_ENTRY_DAYS_BELOW_160")
    if champion_stress.round_trips < 100:
        reasons.append("ROUND_TRIPS_BELOW_100")
    if len(champion_stress.distinct_assets) < 15:
        reasons.append("DISTINCT_ASSETS_BELOW_15")
    if (
        champion_stress.minimum_stress_participation_headroom is None
        or champion_stress.minimum_stress_participation_headroom < ONE
    ):
        reasons.append("STRESS_PUBLIC_PARTICIPATION_SENSITIVITY_DOES_NOT_COVER")

    trial_rows: list[dict[str, object]] = []
    for trial in trials():
        trial_id = trial.trial_id
        trial_rows.append(
            {
                "base": simulation_mapping(base[trial_id]),
                "baseBootstrap14d": dict(base_secondary.trial_intervals[trial_id]),
                "baseBootstrap7d": dict(base_primary.trial_intervals[trial_id]),
                "lookbackDays": trial.lookback_days,
                "selectedCount": trial.selected_count,
                "stress": simulation_mapping(stress[trial_id]),
                "stressBootstrap14d": dict(stress_secondary.trial_intervals[trial_id]),
                "stressBootstrap7d": dict(stress_primary.trial_intervals[trial_id]),
                "trialId": trial_id,
            }
        )
    analysis: dict[str, object] = {
        "attemptLedger": ledger,
        "baseWhiteRealityPValue": decimal_text(base_primary.white_reality_p_value),
        "championId": champion_id,
        "gateReasons": reasons,
        "holm": holm,
        "pbo": dict(pbo),
        "status": "PASS" if not reasons else "FAIL",
        "stressWhiteRealityPValue": decimal_text(stress_primary.white_reality_p_value),
        "trials": trial_rows,
    }
    return analysis, champion, tuple(reasons)


def holdout_analysis(
    champion: Trial,
    bars: Mapping[str, Mapping[date, Bar]],
) -> tuple[dict[str, object], tuple[str, ...]]:
    partitions = require_mapping(protocol().get("partitions"), "partitions")
    holdout = require_mapping(partitions.get("holdout"), "partitions.holdout")
    start = parse_day(require_str(holdout.get("entryStartUtcDate"), "holdout.start"))
    entry_end = parse_day(require_str(holdout.get("entryEndUtcDate"), "holdout.entryEnd"))
    path_end = parse_day(require_str(holdout.get("dailyPathEndUtcDate"), "holdout.pathEnd"))
    costs = require_mapping(protocol().get("costs"), "costs")
    base_adverse = require_int(costs.get("baseAdversePriceBasisPointsPerFill"), "costs.baseAdverse")
    stress_adverse = require_int(
        costs.get("stressAdversePriceBasisPointsPerFill"), "costs.stressAdverse"
    )
    terms = daily_impact_terms(bars)
    cache: dict[tuple[str, date], Selection] = {}
    base = simulate(
        champion,
        base_adverse,
        bars,
        terms,
        start_day=start,
        entry_end_day=entry_end,
        path_end_day=path_end,
        selection_cache=cache,
    )
    stress = simulate(
        champion,
        stress_adverse,
        bars,
        terms,
        start_day=start,
        entry_end_day=entry_end,
        path_end_day=path_end,
        selection_cache=cache,
    )
    bootstrap_config = require_mapping(protocol().get("bootstrap"), "bootstrap")
    replicates = require_int(bootstrap_config.get("replicates"), "bootstrap.replicates")
    seed = require_int(bootstrap_config.get("seed"), "bootstrap.seed") + 10_000
    primary_length = require_int(
        bootstrap_config.get("primaryBlockLengthDays"), "bootstrap.primaryBlockLengthDays"
    )
    secondary_length = require_int(
        bootstrap_config.get("secondaryBlockLengthDays"),
        "bootstrap.secondaryBlockLengthDays",
    )
    padded_base = {trial.trial_id: base.daily_pnl for trial in trials()}
    padded_stress = {trial.trial_id: stress.daily_pnl for trial in trials()}
    base_primary = family_bootstrap(
        padded_base, block_length=primary_length, replicates=replicates, seed=seed
    )
    base_secondary = family_bootstrap(
        padded_base, block_length=secondary_length, replicates=replicates, seed=seed + 1
    )
    stress_primary = family_bootstrap(
        padded_stress, block_length=primary_length, replicates=replicates, seed=seed + 2
    )
    stress_secondary = family_bootstrap(
        padded_stress, block_length=secondary_length, replicates=replicates, seed=seed + 3
    )
    champion_id = champion.trial_id
    reasons: list[str] = []
    for label, family in (
        ("BASE_7D", base_primary),
        ("BASE_14D", base_secondary),
        ("STRESS_7D", stress_primary),
        ("STRESS_14D", stress_secondary),
    ):
        lower = Decimal(
            require_str(
                family.trial_intervals[champion_id].get("lowerUsdPerDay"),
                f"holdout.{label}.lower",
            )
        )
        if lower <= ZERO:
            reasons.append(f"HOLDOUT_{label}_BOOTSTRAP_LOWER_NOT_POSITIVE")
    stress_mean = sum(stress.daily_pnl, ZERO) / Decimal(len(stress.daily_pnl))
    if stress_mean <= ZERO:
        reasons.append("HOLDOUT_STRESS_NET_MEAN_NOT_POSITIVE")
    if base.maximum_drawdown_fraction > Decimal("0.40"):
        reasons.append("HOLDOUT_BASE_DRAWDOWN_EXCEEDS_0_40")
    if stress.maximum_drawdown_fraction > Decimal("0.40"):
        reasons.append("HOLDOUT_STRESS_DRAWDOWN_EXCEEDS_0_40")
    if stress.active_entry_days < 80:
        reasons.append("HOLDOUT_ACTIVE_ENTRY_DAYS_BELOW_80")
    if stress.round_trips < 40:
        reasons.append("HOLDOUT_ROUND_TRIPS_BELOW_40")
    if len(stress.distinct_assets) < 12:
        reasons.append("HOLDOUT_DISTINCT_ASSETS_BELOW_12")
    if (
        stress.minimum_stress_participation_headroom is None
        or stress.minimum_stress_participation_headroom < ONE
    ):
        reasons.append("HOLDOUT_STRESS_PUBLIC_PARTICIPATION_SENSITIVITY_DOES_NOT_COVER")
    analysis: dict[str, object] = {
        "base": simulation_mapping(base),
        "baseBootstrap14d": dict(base_secondary.trial_intervals[champion_id]),
        "baseBootstrap7d": dict(base_primary.trial_intervals[champion_id]),
        "gateReasons": reasons,
        "status": "PASS" if not reasons else "FAIL",
        "stress": simulation_mapping(stress),
        "stressBootstrap14d": dict(stress_secondary.trial_intervals[champion_id]),
        "stressBootstrap7d": dict(stress_primary.trial_intervals[champion_id]),
    }
    return analysis, tuple(reasons)


def git_output(*args: str) -> str:
    completed = subprocess.run(
        ("git", *args),
        cwd=HERE,
        check=True,
        capture_output=True,
        text=True,
    )
    return completed.stdout.strip()


def assert_clean_before_run() -> str:
    status = git_output("status", "--short")
    if status:
        raise ContractError("sealed run requires a clean freeze commit")
    return git_output("rev-parse", "HEAD")


def base_result(
    *,
    verdict: str,
    development: object,
    holdout: object,
    reason: object,
) -> dict[str, object]:
    costs = require_mapping(protocol().get("costs"), "costs")
    return {
        "accountEffectiveFee": "UNKNOWN",
        "authority": {
            "capital": "NONE",
            "consumer": "N3 successor/final convergence",
            "effectUsd": "0",
            "execution": "NONE",
            "orders": "NONE",
            "scope": "PUBLIC_RESEARCH_ONLY",
        },
        "capacityTruth": {
            "executableCapacityUsd": None,
            "historicalBookDepth": "UNMEASURED",
            "publicQuoteVolumeParticipationSensitivity": "MEASURED_WHEN_ECONOMICS_MEASURED",
            "status": "EXECUTABLE_CAPACITY_UNMEASURED",
        },
        "completedAtUtc": utc_now(),
        "costScenario": {
            "accountEffectiveFee": "UNKNOWN",
            "baseAdversePriceBasisPointsPerFill": costs.get("baseAdversePriceBasisPointsPerFill"),
            "historicalSpreadImpact": "UNKNOWN",
            "publicRegularTakerFeeBasisPointsPerFill": costs.get(
                "publicRegularTakerFeeBasisPointsPerFill"
            ),
            "stressAdversePriceBasisPointsPerFill": costs.get(
                "stressAdversePriceBasisPointsPerFill"
            ),
        },
        "development": development,
        "drawdownTruth": {
            "closeMarkReferencePath": "MEASURED_WHEN_ECONOMICS_MEASURED",
            "intradayDrawdown": "UNMEASURED",
        },
        "freezeSha256": sha256_path(FREEZE_PATH),
        "globalVerifiedPositiveEligibility": (
            "UNAVAILABLE_WITHOUT_UPDATED_GLOBAL_V_G_ATTEMPT_LEDGER"
        ),
        "holdout": holdout,
        "protocolSha256": sha256_path(PROTOCOL_PATH),
        "reason": reason,
        "repairOrRerunPerformed": False,
        "runMarkerSha256": sha256_path(RUN_MARKER_PATH),
        "schema": "VG17ResultV1",
        "sourceManifestSha256": sha256_path(SOURCE_MANIFEST_PATH),
        "verdict": verdict,
    }


def terminal_unmeasured(exc: Exception, phase: str) -> dict[str, object]:
    holdout_opened = HOLDOUT_OPEN_PATH.exists()
    result = base_result(
        verdict="UNMEASURED",
        development={
            "metrics": None,
            "status": "UNMEASURED",
        },
        holdout={
            "archiveBodiesOpened": holdout_opened,
            "metrics": None,
            "openCount": 1 if holdout_opened else 0,
            "state": "OPENED_TERMINAL_FAILURE" if holdout_opened else "UNOPENED_UNTOUCHED",
        },
        reason={
            "code": type(exc).__name__.upper(),
            "detail": str(exc),
            "phase": phase,
        },
    )
    write_json_once(RESULT_PATH, result)
    return result


def run_experiment() -> dict[str, object]:
    if RUN_MARKER_PATH.exists() or RESULT_PATH.exists():
        raise ContractError("sole run already consumed or terminal result already exists")
    verify_freeze()
    git_head = assert_clean_before_run()
    marker: dict[str, object] = {
        "consumedAtUtc": utc_now(),
        "freezeSha256": sha256_path(FREEZE_PATH),
        "gitHead": git_head,
        "holdoutOpenedAtStart": False,
        "protocolSha256": sha256_path(PROTOCOL_PATH),
        "schema": "VG17SoleRunMarkerV1",
        "sourceManifestSha256": sha256_path(SOURCE_MANIFEST_PATH),
        "state": "SOLE_ARCHIVE_DECOMPRESSION_RUN_CONSUMED",
    }
    write_json_once(RUN_MARKER_PATH, marker)
    phase = "DEVELOPMENT_SOURCE_OPEN"
    try:
        data = require_mapping(protocol().get("data"), "data")
        development_months = {
            require_str(value, "data.developmentArchiveMonths[]")
            for value in require_list(
                data.get("developmentArchiveMonths"), "data.developmentArchiveMonths"
            )
        }
        development_bars = load_bars(development_months)
        phase = "DEVELOPMENT_EVALUATION"
        development, champion, development_reasons = development_analysis(development_bars)
        if development_reasons:
            result = base_result(
                verdict="NO_GO",
                development=development,
                holdout={
                    "archiveBodiesOpened": False,
                    "metrics": None,
                    "openCount": 0,
                    "state": "UNOPENED_UNTOUCHED_DEVELOPMENT_FAILED",
                },
                reason={
                    "code": "DEVELOPMENT_GATES_FAILED",
                    "details": list(development_reasons),
                },
            )
            write_json_once(RESULT_PATH, result)
            return result

        phase = "CANDIDATE_SEAL"
        development_sha = sha256_bytes(canonical_bytes(development))
        candidate: dict[str, object] = {
            "championId": champion.trial_id,
            "createdAtUtc": utc_now(),
            "developmentSha256": development_sha,
            "freezeSha256": sha256_path(FREEZE_PATH),
            "runMarkerSha256": sha256_path(RUN_MARKER_PATH),
            "schema": "VG17CandidateSealV1",
        }
        write_json_once(CANDIDATE_SEAL_PATH, candidate)
        holdout_receipt: dict[str, object] = {
            "candidateSealSha256": sha256_path(CANDIDATE_SEAL_PATH),
            "openedAtUtc": utc_now(),
            "openOrdinal": 1,
            "schema": "VG17HoldoutOpenV1",
            "state": "SINGLE_HOLDOUT_OPEN_CONSUMED",
        }
        write_json_once(HOLDOUT_OPEN_PATH, holdout_receipt)
        phase = "HOLDOUT_SOURCE_OPEN"
        holdout_months = {
            require_str(value, "data.holdoutArchiveMonths[]")
            for value in require_list(data.get("holdoutArchiveMonths"), "data.holdoutArchiveMonths")
        }
        holdout_only = load_bars(holdout_months)
        all_bars = merge_bars(development_bars, holdout_only)
        phase = "HOLDOUT_EVALUATION"
        holdout, holdout_reasons = holdout_analysis(champion, all_bars)
        result = base_result(
            verdict="GO" if not holdout_reasons else "NO_GO",
            development=development,
            holdout={
                "archiveBodiesOpened": True,
                "candidateSealSha256": sha256_path(CANDIDATE_SEAL_PATH),
                "holdoutOpenSha256": sha256_path(HOLDOUT_OPEN_PATH),
                "metrics": holdout,
                "openCount": 1,
                "state": "SINGLE_OPEN_COMPLETE",
            },
            reason=(
                {"code": "ALL_LOCAL_PUBLIC_SCENARIO_GATES_PASSED"}
                if not holdout_reasons
                else {"code": "HOLDOUT_GATES_FAILED", "details": list(holdout_reasons)}
            ),
        )
        write_json_once(RESULT_PATH, result)
        return result
    except (ContractError, MeasurementError, ArithmeticError, zipfile.BadZipFile) as exc:
        return terminal_unmeasured(exc, phase)


def expected_packet_names() -> tuple[str, ...]:
    names = list(STATIC_FREEZE_FILES)
    names.extend(("freeze.v1.json", "run-marker.v1.json", "result.v1.json"))
    if CANDIDATE_SEAL_PATH.exists():
        names.append("candidate-seal.v1.json")
    if HOLDOUT_OPEN_PATH.exists():
        names.append("holdout-open.v1.json")
    return tuple(sorted(names))


def seal_packet() -> None:
    if SHA256SUMS_PATH.exists():
        raise ContractError("SHA256SUMS already exists")
    verify_freeze()
    if not RUN_MARKER_PATH.exists() or not RESULT_PATH.exists():
        raise ContractError("terminal run evidence is incomplete")
    lines = [f"{sha256_path(HERE / name)}  {name}" for name in expected_packet_names()]
    write_bytes_once(SHA256SUMS_PATH, ("\n".join(lines) + "\n").encode())


def verify_sha256s() -> None:
    try:
        lines = SHA256SUMS_PATH.read_text(encoding="ascii").splitlines()
    except OSError as exc:
        raise ContractError("SHA256SUMS unavailable") from exc
    observed: dict[str, str] = {}
    for line in lines:
        fields = line.split("  ", 1)
        if len(fields) != 2:
            raise ContractError("malformed SHA256SUMS line")
        digest, name = fields
        if name in observed or Path(name).name != name:
            raise ContractError("unsafe or duplicate SHA256SUMS name")
        observed[name] = digest
    if tuple(sorted(observed)) != expected_packet_names():
        raise ContractError("SHA256SUMS packet inventory mismatch")
    for name, digest in observed.items():
        if sha256_path(HERE / name) != digest:
            raise ContractError(f"packet checksum mismatch: {name}")


def report_packet() -> dict[str, object]:
    verify_freeze()
    verify_sha256s()
    marker = load_json(RUN_MARKER_PATH)
    result = load_json(RESULT_PATH)
    if marker.get("schema") != "VG17SoleRunMarkerV1":
        raise ContractError("unexpected run marker schema")
    if result.get("schema") != "VG17ResultV1":
        raise ContractError("unexpected result schema")
    if result.get("runMarkerSha256") != sha256_path(RUN_MARKER_PATH):
        raise ContractError("result/run-marker binding mismatch")
    if result.get("freezeSha256") != sha256_path(FREEZE_PATH):
        raise ContractError("result/freeze binding mismatch")
    verdict = result.get("verdict")
    if verdict not in {"GO", "NO_GO", "UNMEASURED"}:
        raise ContractError("unexpected terminal verdict")
    if result.get("repairOrRerunPerformed") is not False:
        raise ContractError("repair/rerun truth mismatch")
    return result


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("inventory", "freeze", "run", "seal", "report"))
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.command == "inventory":
            output = inventory_sources()
        elif args.command == "freeze":
            output = freeze_packet()
        elif args.command == "run":
            output = run_experiment()
        elif args.command == "seal":
            seal_packet()
            output = {"schema": "VG17SealReceipt", "state": "SHA256SUMS_WRITTEN"}
        else:
            output = report_packet()
    except (ContractError, MeasurementError) as exc:
        print(f"VG17_ERROR:{type(exc).__name__}:{exc}", file=sys.stderr)
        return 2
    print(canonical_bytes(output).decode(), end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
