#!/usr/bin/env python3
"""Sealed V-G29 Binance-public-only profitability experiment."""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import itertools
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from collections.abc import Mapping, Sequence
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal, InvalidOperation, getcontext
from pathlib import Path
from typing import Final, cast

getcontext().prec = 50

HERE: Final = Path(__file__).resolve().parent
PROTOCOL_PATH: Final = HERE / "protocol.v1.json"
SOURCE_MANIFEST_PATH: Final = HERE / "source-manifest.v1.json"
FREEZE_PATH: Final = HERE / "freeze.v1.json"
RUN_MARKER_PATH: Final = HERE / "development-run-marker.v1.json"
DEVELOPMENT_EVIDENCE_PATH: Final = HERE / "development-evidence.v1.json"
CHAMPION_SEAL_PATH: Final = HERE / "development-champion.v1.json"
HOLDOUT_OPEN_PATH: Final = HERE / "holdout-open.v1.json"
RESULT_PATH: Final = HERE / "result.v1.json"
SHA256SUMS_PATH: Final = HERE / "SHA256SUMS"

STATIC_FREEZE_NAMES: Final = (
    "COLLISION_AUDIT.md",
    "OFFICIAL_SOURCE_RESEARCH.md",
    "README.md",
    "__init__.py",
    "experiment.py",
    "protocol.v1.json",
    "source-manifest.v1.json",
    "test_experiment.py",
)

JsonObject = dict[str, object]


class ContractError(RuntimeError):
    """A frozen protocol, source, or custody contract failed."""


class MeasurementError(RuntimeError):
    """The sealed public measurement is structurally unavailable."""


@dataclass(frozen=True)
class Bar:
    day: date
    open_price: Decimal
    high_price: Decimal
    low_price: Decimal
    close_price: Decimal
    quote_volume: Decimal


@dataclass(frozen=True)
class Trial:
    short_days: int
    baseline_days: int
    breadth: Decimal

    @property
    def trial_id(self) -> str:
        breadth_code = int(self.breadth * 100)
        return f"vg29-s{self.short_days:02d}-b{self.baseline_days:03d}-q{breadth_code:02d}"


@dataclass(frozen=True)
class Simulation:
    trial: Trial
    adverse_bps_per_fill: int
    weekly_returns: tuple[Decimal, ...]
    final_net_usd_per_1000: Decimal
    active_weeks: int
    round_trips: int
    distinct_assets: tuple[str, ...]
    maximum_close_mark_drawdown: Decimal
    minimum_capacity_headroom: Decimal | None
    minimum_stress_capacity_headroom: Decimal | None
    regime_breadths: tuple[Decimal, ...]


@dataclass(frozen=True)
class BootstrapInterval:
    lower_net_usd_per_1000: Decimal
    point_net_usd_per_1000: Decimal
    upper_net_usd_per_1000: Decimal


class SplitMix64:
    """Small deterministic PRNG with stable cross-version output."""

    def __init__(self, seed: int) -> None:
        self._state = seed & 0xFFFFFFFFFFFFFFFF

    def next_u64(self) -> int:
        self._state = (self._state + 0x9E3779B97F4A7C15) & 0xFFFFFFFFFFFFFFFF
        value = self._state
        value = ((value ^ (value >> 30)) * 0xBF58476D1CE4E5B9) & 0xFFFFFFFFFFFFFFFF
        value = ((value ^ (value >> 27)) * 0x94D049BB133111EB) & 0xFFFFFFFFFFFFFFFF
        return (value ^ (value >> 31)) & 0xFFFFFFFFFFFFFFFF

    def randbelow(self, bound: int) -> int:
        if bound <= 0:
            raise ContractError("PRNG bound must be positive")
        return self.next_u64() % bound


def canonical_bytes(value: object) -> bytes:
    return (
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n"
    ).encode("utf-8")


def sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_json(path: Path) -> JsonObject:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ContractError(f"invalid JSON artifact: {path.name}") from exc
    if not isinstance(value, dict):
        raise ContractError(f"JSON artifact must be an object: {path.name}")
    return cast(JsonObject, value)


def require_mapping(value: object, field: str) -> Mapping[str, object]:
    if not isinstance(value, dict):
        raise ContractError(f"{field} must be an object")
    return cast(Mapping[str, object], value)


def require_list(value: object, field: str) -> list[object]:
    if not isinstance(value, list):
        raise ContractError(f"{field} must be an array")
    return cast(list[object], value)


def require_str(value: object, field: str) -> str:
    if not isinstance(value, str) or not value:
        raise ContractError(f"{field} must be a non-empty string")
    return value


def require_int(value: object, field: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ContractError(f"{field} must be an integer")
    return value


def require_bool(value: object, field: str) -> bool:
    if not isinstance(value, bool):
        raise ContractError(f"{field} must be a boolean")
    return value


def write_bytes_once(path: Path, payload: bytes, *, mode: int = 0o644) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    descriptor = os.open(path, flags, mode)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
    except BaseException:
        path.unlink(missing_ok=True)
        raise


def write_json_once(path: Path, value: object, *, mode: int = 0o644) -> None:
    write_bytes_once(path, canonical_bytes(value), mode=mode)


def write_json_replace(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = canonical_bytes(value)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def utc_now() -> str:
    return datetime.now(tz=UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def decimal_text(value: Decimal, places: int = 12) -> str:
    quantum = Decimal(1).scaleb(-places)
    return format(value.quantize(quantum), "f")


def parse_decimal(raw: str, field: str, *, positive: bool = False) -> Decimal:
    try:
        value = Decimal(raw)
    except InvalidOperation as exc:
        raise MeasurementError(f"{field} is not decimal") from exc
    if not value.is_finite() or (positive and value <= 0):
        raise MeasurementError(f"{field} violates decimal bounds")
    return value


def parse_day(raw: str) -> date:
    try:
        return date.fromisoformat(raw)
    except ValueError as exc:
        raise ContractError("invalid protocol UTC date") from exc


def protocol() -> JsonObject:
    value = load_json(PROTOCOL_PATH)
    if value.get("schema") != "VG29ProtocolV1":
        raise ContractError("wrong protocol schema")
    return value


def state_root() -> Path:
    data = require_mapping(protocol().get("data"), "data")
    raw = require_str(data.get("stateRoot"), "data.stateRoot")
    root = Path(raw)
    if not root.is_absolute():
        raise ContractError("state root must be absolute")
    return root


def symbols() -> tuple[str, ...]:
    universe = require_mapping(protocol().get("universe"), "universe")
    values = tuple(
        require_str(value, "universe.symbols[]")
        for value in require_list(universe.get("symbols"), "universe.symbols")
    )
    if values != tuple(sorted(values)) or len(values) != len(set(values)):
        raise ContractError("universe symbols must be sorted and unique")
    if len(values) != require_int(universe.get("requiredCount"), "universe.requiredCount"):
        raise ContractError("universe cardinality mismatch")
    return values


def archive_months() -> tuple[str, ...]:
    data = require_mapping(protocol().get("data"), "data")
    values = tuple(
        require_str(value, "data.archiveMonths[]")
        for value in require_list(data.get("archiveMonths"), "data.archiveMonths")
    )
    if values != tuple(sorted(values)) or len(values) != len(set(values)):
        raise ContractError("archive months must be sorted and unique")
    for value in values:
        if re.fullmatch(r"\d{4}-\d{2}", value) is None:
            raise ContractError("invalid archive month")
    return values


def trials() -> tuple[Trial, ...]:
    config = require_mapping(protocol().get("trials"), "trials")
    shorts = tuple(
        require_int(value, "trials.shortWindowDays[]")
        for value in require_list(config.get("shortWindowDays"), "trials.shortWindowDays")
    )
    baselines = tuple(
        require_int(value, "trials.baselineWindowDays[]")
        for value in require_list(config.get("baselineWindowDays"), "trials.baselineWindowDays")
    )
    breadths = tuple(
        parse_decimal(
            require_str(value, "trials.positiveBreakBreadth[]"),
            "trials.positiveBreakBreadth[]",
            positive=True,
        )
        for value in require_list(config.get("positiveBreakBreadth"), "trials.positiveBreakBreadth")
    )
    result = tuple(
        Trial(short, baseline, breadth)
        for short in shorts
        for baseline in baselines
        for breadth in breadths
    )
    expected = require_int(config.get("attemptedCount"), "trials.attemptedCount")
    if len(result) != expected or len({trial.trial_id for trial in result}) != expected:
        raise ContractError("trial family is not closed")
    if any(trial.short_days >= trial.baseline_days for trial in result):
        raise ContractError("short elasticity window must be shorter than baseline")
    return result


def source_urls(symbol: str, month: str) -> tuple[str, str]:
    data = require_mapping(protocol().get("data"), "data")
    template = require_str(data.get("archiveUrlTemplate"), "data.archiveUrlTemplate")
    archive_url = template.format(symbol=symbol, month=month)
    parsed = urllib.parse.urlparse(archive_url)
    if parsed.scheme != "https" or parsed.hostname != "data.binance.vision":
        raise ContractError("source URL escaped official Binance archive host")
    suffix = require_str(data.get("checksumSuffix"), "data.checksumSuffix")
    return archive_url, archive_url + suffix


def source_paths(symbol: str, month: str) -> tuple[Path, Path]:
    archive_name = f"{symbol}-1d-{month}.zip"
    directory = state_root() / "archives" / symbol / month
    return directory / archive_name, directory / f"{archive_name}.CHECKSUM"


def verify_sidecar(sidecar: bytes, archive_name: str, archive_sha256: str) -> None:
    try:
        line = sidecar.decode("ascii").strip()
    except UnicodeDecodeError as exc:
        raise ContractError("checksum sidecar must be ASCII") from exc
    match = re.fullmatch(r"([0-9a-fA-F]{64})\s+\*?([^\s/]+)", line)
    if match is None:
        raise ContractError("checksum sidecar shape invalid")
    if match.group(2) != archive_name:
        raise ContractError("checksum sidecar filename mismatch")
    if match.group(1).lower() != archive_sha256:
        raise ContractError("checksum sidecar digest mismatch")


def _download(url: str) -> tuple[bytes, Mapping[str, str]]:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "Cosmos-VG29-public-research/1.0"},
        method="GET",
    )
    last_error: Exception | None = None
    for _attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                status = getattr(response, "status", 200)
                if status != 200:
                    raise ContractError(f"official archive returned HTTP {status}")
                raw = response.read()
                if not raw:
                    raise ContractError("official archive returned an empty body")
                headers = {str(key).lower(): str(value) for key, value in response.headers.items()}
                return raw, headers
        except (OSError, urllib.error.URLError, ContractError) as exc:
            last_error = exc
    raise ContractError(f"official archive acquisition failed: {url}") from last_error


def _atomic_replace_bytes(path: Path, raw: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def acquire_record(symbol: str, month: str) -> JsonObject:
    archive_path, checksum_path = source_paths(symbol, month)
    archive_url, checksum_url = source_urls(symbol, month)
    checksum_headers: Mapping[str, str] = {}
    archive_headers: Mapping[str, str] = {}

    if checksum_path.exists():
        checksum_raw = checksum_path.read_bytes()
    else:
        checksum_raw, checksum_headers = _download(checksum_url)
        _atomic_replace_bytes(checksum_path, checksum_raw)

    if archive_path.exists():
        archive_raw = archive_path.read_bytes()
    else:
        archive_raw, archive_headers = _download(archive_url)
        _atomic_replace_bytes(archive_path, archive_raw)

    archive_sha = sha256_bytes(archive_raw)
    verify_sidecar(checksum_raw, archive_path.name, archive_sha)
    return {
        "symbol": symbol,
        "month": month,
        "archivePath": str(archive_path.relative_to(state_root())),
        "archiveUrl": archive_url,
        "archiveBytes": len(archive_raw),
        "archiveSha256": archive_sha,
        "archiveEtag": archive_headers.get("etag"),
        "archiveLastModified": archive_headers.get("last-modified"),
        "checksumPath": str(checksum_path.relative_to(state_root())),
        "checksumUrl": checksum_url,
        "checksumBytes": len(checksum_raw),
        "checksumSha256": sha256_bytes(checksum_raw),
        "checksumEtag": checksum_headers.get("etag"),
        "checksumLastModified": checksum_headers.get("last-modified"),
    }


def acquire_sources() -> JsonObject:
    if FREEZE_PATH.exists() or RUN_MARKER_PATH.exists() or RESULT_PATH.exists():
        raise ContractError("acquisition is closed after freeze or run")
    records: list[JsonObject] = []
    work = [(symbol, month) for symbol in symbols() for month in archive_months()]
    with ThreadPoolExecutor(max_workers=8, thread_name_prefix="vg29-public") as executor:
        future_map = {
            executor.submit(acquire_record, symbol, month): (symbol, month)
            for symbol, month in work
        }
        for future in as_completed(future_map):
            records.append(future.result())
    records.sort(key=lambda record: (cast(str, record["symbol"]), cast(str, record["month"])))
    manifest: JsonObject = {
        "schema": "VG29SourceManifestV1",
        "baseCommit": require_str(protocol().get("baseCommit"), "baseCommit"),
        "createdAtUtc": utc_now(),
        "sourceRoot": str(state_root()),
        "archiveBodiesDecompressed": False,
        "recordCount": len(records),
        "artifactCount": len(records) * 2,
        "records": records,
    }
    expected = len(symbols()) * len(archive_months())
    if len(records) != expected:
        raise ContractError("source acquisition cardinality mismatch")
    write_json_replace(SOURCE_MANIFEST_PATH, manifest)
    return manifest


def manifest_records() -> tuple[Mapping[str, object], ...]:
    manifest = load_json(SOURCE_MANIFEST_PATH)
    if manifest.get("schema") != "VG29SourceManifestV1":
        raise ContractError("wrong source manifest schema")
    if manifest.get("baseCommit") != require_str(protocol().get("baseCommit"), "baseCommit"):
        raise ContractError("source manifest base commit mismatch")
    if manifest.get("archiveBodiesDecompressed") is not False:
        raise ContractError("source manifest claims an opened archive")
    raw_records = require_list(manifest.get("records"), "sourceManifest.records")
    records = tuple(require_mapping(value, "sourceManifest.records[]") for value in raw_records)
    expected = len(symbols()) * len(archive_months())
    if len(records) != expected:
        raise ContractError("source manifest record count mismatch")
    if manifest.get("recordCount") != expected or manifest.get("artifactCount") != expected * 2:
        raise ContractError("source manifest declared cardinality mismatch")
    identities = [
        (
            require_str(record.get("symbol"), "sourceRecord.symbol"),
            require_str(record.get("month"), "sourceRecord.month"),
        )
        for record in records
    ]
    if identities != sorted(identities) or len(identities) != len(set(identities)):
        raise ContractError("source manifest records are not sorted and unique")
    return records


def verify_source_inventory() -> None:
    expected_identities = {(symbol, month) for symbol in symbols() for month in archive_months()}
    found: set[tuple[str, str]] = set()
    for record in manifest_records():
        symbol = require_str(record.get("symbol"), "sourceRecord.symbol")
        month = require_str(record.get("month"), "sourceRecord.month")
        archive_path, checksum_path = source_paths(symbol, month)
        archive_url, checksum_url = source_urls(symbol, month)
        if require_str(record.get("archivePath"), "sourceRecord.archivePath") != str(
            archive_path.relative_to(state_root())
        ):
            raise ContractError("source archive path mismatch")
        if require_str(record.get("checksumPath"), "sourceRecord.checksumPath") != str(
            checksum_path.relative_to(state_root())
        ):
            raise ContractError("source checksum path mismatch")
        if require_str(record.get("archiveUrl"), "sourceRecord.archiveUrl") != archive_url:
            raise ContractError("source archive URL mismatch")
        if require_str(record.get("checksumUrl"), "sourceRecord.checksumUrl") != checksum_url:
            raise ContractError("source checksum URL mismatch")
        if not archive_path.is_file() or not checksum_path.is_file():
            raise ContractError("frozen source artifact missing")
        if archive_path.stat().st_size != require_int(
            record.get("archiveBytes"), "sourceRecord.archiveBytes"
        ):
            raise ContractError("frozen source archive byte count mismatch")
        if checksum_path.stat().st_size != require_int(
            record.get("checksumBytes"), "sourceRecord.checksumBytes"
        ):
            raise ContractError("frozen source sidecar byte count mismatch")
        archive_sha = sha256_path(archive_path)
        checksum_sha = sha256_path(checksum_path)
        if archive_sha != require_str(record.get("archiveSha256"), "sourceRecord.archiveSha256"):
            raise ContractError("frozen source archive digest mismatch")
        if checksum_sha != require_str(record.get("checksumSha256"), "sourceRecord.checksumSha256"):
            raise ContractError("frozen source sidecar digest mismatch")
        verify_sidecar(checksum_path.read_bytes(), archive_path.name, archive_sha)
        found.add((symbol, month))
    if found != expected_identities:
        raise ContractError("frozen source identity set mismatch")


def freeze_packet() -> JsonObject:
    if FREEZE_PATH.exists():
        return verify_freeze()
    if RUN_MARKER_PATH.exists() or RESULT_PATH.exists():
        raise ContractError("cannot freeze after development custody is consumed")
    verify_source_inventory()
    bindings: JsonObject = {}
    for name in STATIC_FREEZE_NAMES:
        path = HERE / name
        if not path.is_file():
            raise ContractError(f"static freeze input missing: {name}")
        bindings[name] = sha256_path(path)
    value: JsonObject = {
        "schema": "VG29FreezeV1",
        "baseCommit": require_str(protocol().get("baseCommit"), "baseCommit"),
        "createdAtUtc": utc_now(),
        "state": "PROTOCOL_EVALUATOR_TESTS_AND_COMPRESSED_SOURCE_BYTES_FROZEN_BEFORE_OUTCOMES",
        "archiveBodiesDecompressed": False,
        "holdoutArchiveBodiesOpened": False,
        "protocolSha256": sha256_path(PROTOCOL_PATH),
        "sourceManifestSha256": sha256_path(SOURCE_MANIFEST_PATH),
        "bindings": bindings,
    }
    write_json_once(FREEZE_PATH, value)
    return value


def verify_freeze() -> JsonObject:
    value = load_json(FREEZE_PATH)
    if value.get("schema") != "VG29FreezeV1":
        raise ContractError("wrong freeze schema")
    if value.get("archiveBodiesDecompressed") is not False:
        raise ContractError("freeze says archives were decompressed")
    if value.get("holdoutArchiveBodiesOpened") is not False:
        raise ContractError("freeze says holdout was opened")
    if value.get("protocolSha256") != sha256_path(PROTOCOL_PATH):
        raise ContractError("protocol changed after freeze")
    if value.get("sourceManifestSha256") != sha256_path(SOURCE_MANIFEST_PATH):
        raise ContractError("source manifest changed after freeze")
    bindings = require_mapping(value.get("bindings"), "freeze.bindings")
    if set(bindings) != set(STATIC_FREEZE_NAMES):
        raise ContractError("freeze binding set changed")
    for name in STATIC_FREEZE_NAMES:
        expected = require_str(bindings.get(name), f"freeze.bindings.{name}")
        if sha256_path(HERE / name) != expected:
            raise ContractError(f"frozen input changed: {name}")
    verify_source_inventory()
    return value


def _month_bounds(month: str) -> tuple[date, date]:
    start = date.fromisoformat(f"{month}-01")
    end = date(start.year + 1, 1, 1) if start.month == 12 else date(start.year, start.month + 1, 1)
    return start, end


def _timestamp_to_day(open_raw: str, close_raw: str, month: str) -> date:
    try:
        open_value = int(open_raw)
        close_value = int(close_raw)
    except ValueError as exc:
        raise MeasurementError("kline timestamp is not an integer") from exc
    month_start, month_end = _month_bounds(month)
    microsecond_era = month_start >= date(2025, 1, 1)
    if microsecond_era:
        if len(open_raw) != 16 or len(close_raw) != 16:
            raise MeasurementError("post-2025 Spot archive timestamp unit mismatch")
        open_us = open_value
        close_us = close_value
        terminal_delta = 1
    else:
        if len(open_raw) != 13 or len(close_raw) != 13:
            raise MeasurementError("pre-2025 Spot archive timestamp unit mismatch")
        open_us = open_value * 1000
        close_us = close_value * 1000
        terminal_delta = 1000
    opened = datetime.fromtimestamp(open_us / 1_000_000, tz=UTC)
    if opened.hour != 0 or opened.minute != 0 or opened.second != 0 or opened.microsecond != 0:
        raise MeasurementError("daily kline does not open at 00:00 UTC")
    day = opened.date()
    if not (month_start <= day < month_end):
        raise MeasurementError("daily kline escaped archive month")
    next_open_us = int(
        datetime.combine(day + timedelta(days=1), datetime.min.time(), tzinfo=UTC).timestamp()
        * 1_000_000
    )
    if close_us != next_open_us - terminal_delta:
        raise MeasurementError("daily kline close timestamp mismatch")
    return day


def parse_archive(record: Mapping[str, object]) -> tuple[Bar, ...]:
    symbol = require_str(record.get("symbol"), "sourceRecord.symbol")
    month = require_str(record.get("month"), "sourceRecord.month")
    archive_path, checksum_path = source_paths(symbol, month)
    archive_raw = archive_path.read_bytes()
    archive_sha = sha256_bytes(archive_raw)
    if archive_sha != require_str(record.get("archiveSha256"), "sourceRecord.archiveSha256"):
        raise MeasurementError("archive digest changed before decompression")
    verify_sidecar(checksum_path.read_bytes(), archive_path.name, archive_sha)
    expected_member = f"{symbol}-1d-{month}.csv"
    try:
        with zipfile.ZipFile(io.BytesIO(archive_raw), "r") as archive:
            members = archive.infolist()
            if len(members) != 1 or members[0].filename != expected_member:
                raise MeasurementError("archive member set mismatch")
            member = members[0]
            if member.is_dir() or member.flag_bits & 0x1:
                raise MeasurementError("archive member shape invalid")
            payload = archive.read(member)
    except (OSError, zipfile.BadZipFile, RuntimeError) as exc:
        raise MeasurementError("archive decompression failed") from exc
    try:
        text = payload.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise MeasurementError("kline CSV is not UTF-8") from exc
    bars: list[Bar] = []
    for row_number, row in enumerate(csv.reader(io.StringIO(text)), start=1):
        if len(row) != 12:
            raise MeasurementError(f"kline row {row_number} does not have 12 fields")
        day = _timestamp_to_day(row[0], row[6], month)
        open_price = parse_decimal(row[1], "open", positive=True)
        high_price = parse_decimal(row[2], "high", positive=True)
        low_price = parse_decimal(row[3], "low", positive=True)
        close_price = parse_decimal(row[4], "close", positive=True)
        quote_volume = parse_decimal(row[7], "quoteVolume", positive=True)
        if high_price < max(open_price, close_price) or low_price > min(open_price, close_price):
            raise MeasurementError("OHLC ordering invalid")
        if high_price <= low_price:
            raise MeasurementError("daily high-low range is non-positive")
        bars.append(
            Bar(
                day=day,
                open_price=open_price,
                high_price=high_price,
                low_price=low_price,
                close_price=close_price,
                quote_volume=quote_volume,
            )
        )
    month_start, month_end = _month_bounds(month)
    expected_days: list[date] = []
    cursor = month_start
    while cursor < month_end:
        expected_days.append(cursor)
        cursor += timedelta(days=1)
    if [bar.day for bar in bars] != expected_days:
        raise MeasurementError("archive daily grid is incomplete, duplicate, or unordered")
    return tuple(bars)


def load_bars(month_set: set[str]) -> dict[str, dict[date, Bar]]:
    if not month_set or not month_set.issubset(set(archive_months())):
        raise ContractError("requested archive month set invalid")
    result: dict[str, dict[date, Bar]] = {symbol: {} for symbol in symbols()}
    opened = 0
    for record in manifest_records():
        month = require_str(record.get("month"), "sourceRecord.month")
        if month not in month_set:
            continue
        symbol = require_str(record.get("symbol"), "sourceRecord.symbol")
        for bar in parse_archive(record):
            if bar.day in result[symbol]:
                raise MeasurementError("duplicate bar across archives")
            result[symbol][bar.day] = bar
        opened += 1
    expected = len(symbols()) * len(month_set)
    if opened != expected:
        raise MeasurementError("opened archive count mismatch")
    return result


def merge_bars(
    first: Mapping[str, Mapping[date, Bar]],
    second: Mapping[str, Mapping[date, Bar]],
) -> dict[str, dict[date, Bar]]:
    merged: dict[str, dict[date, Bar]] = {}
    for symbol in symbols():
        values = dict(first[symbol])
        for day, bar in second[symbol].items():
            if day in values and values[day] != bar:
                raise MeasurementError("conflicting bar across partition loads")
            values[day] = bar
        merged[symbol] = values
    return merged


def _median(values: Sequence[Decimal]) -> Decimal:
    if not values:
        raise MeasurementError("median requires observations")
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) / Decimal(2)


def _ols_slope(x_values: Sequence[Decimal], y_values: Sequence[Decimal]) -> Decimal:
    if len(x_values) != len(y_values) or len(x_values) < 2:
        raise MeasurementError("elasticity window dimensions invalid")
    count = Decimal(len(x_values))
    x_mean = sum(x_values, Decimal(0)) / count
    y_mean = sum(y_values, Decimal(0)) / count
    denominator = sum(((value - x_mean) ** 2 for value in x_values), Decimal(0))
    if denominator == 0:
        raise MeasurementError("elasticity range variance is zero")
    numerator = sum(
        (
            (x_value - x_mean) * (y_value - y_mean)
            for x_value, y_value in zip(x_values, y_values, strict=True)
        ),
        Decimal(0),
    )
    return numerator / denominator


def _window_days(end_day: date, count: int) -> tuple[date, ...]:
    start = end_day - timedelta(days=count - 1)
    return tuple(start + timedelta(days=offset) for offset in range(count))


def elasticity_break(
    bars: Mapping[date, Bar],
    cutoff: date,
    short_days: int,
    baseline_days: int,
) -> Decimal:
    all_days = _window_days(cutoff, short_days + baseline_days)
    baseline_slice = all_days[:baseline_days]
    short_slice = all_days[baseline_days:]

    def elasticity(days: Sequence[date]) -> Decimal:
        x_values: list[Decimal] = []
        y_values: list[Decimal] = []
        for day in days:
            bar = bars.get(day)
            if bar is None:
                raise MeasurementError("elasticity window has a missing day")
            log_range = (bar.high_price / bar.low_price).ln()
            if log_range <= 0:
                raise MeasurementError("elasticity log range is non-positive")
            x_values.append(log_range.ln())
            y_values.append(bar.quote_volume.ln())
        return _ols_slope(x_values, y_values)

    return elasticity(short_slice) - elasticity(baseline_slice)


def _weekly_entries(start: date, end: date) -> tuple[date, ...]:
    if start.weekday() != 0 or end.weekday() != 0:
        raise ContractError("entry partition boundaries must be Mondays")
    values: list[date] = []
    cursor = start
    while cursor <= end:
        values.append(cursor)
        cursor += timedelta(days=7)
    return tuple(values)


def _trailing_quote_volume_reference(bars: Mapping[date, Bar], leg_day: date) -> Decimal:
    cutoff = leg_day - timedelta(days=2)
    values: list[Decimal] = []
    for day in _window_days(cutoff, 7):
        bar = bars.get(day)
        if bar is None:
            raise MeasurementError("capacity reference has a missing day")
        values.append(bar.quote_volume)
    return _median(values)


def _fill_fraction(basis_points: object, field: str) -> Decimal:
    value = require_int(basis_points, field)
    if value < 0:
        raise ContractError(f"{field} must be non-negative")
    return Decimal(value) / Decimal(10_000)


def maximum_drawdown(equity: Sequence[Decimal]) -> Decimal:
    if not equity or equity[0] <= 0:
        raise MeasurementError("drawdown path invalid")
    peak = equity[0]
    maximum = Decimal(0)
    for value in equity:
        if value <= 0:
            return Decimal(1)
        peak = max(peak, value)
        maximum = max(maximum, (peak - value) / peak)
    return maximum


def simulate(
    trial: Trial,
    bars_by_symbol: Mapping[str, Mapping[date, Bar]],
    entry_start: date,
    entry_end: date,
    adverse_bps_per_fill: int,
) -> Simulation:
    portfolio = require_mapping(protocol().get("portfolio"), "portfolio")
    costs = require_mapping(protocol().get("costs"), "costs")
    capacity = require_mapping(protocol().get("capacity"), "capacity")
    initial = parse_decimal(
        require_str(portfolio.get("initialUsd"), "portfolio.initialUsd"),
        "portfolio.initialUsd",
        positive=True,
    )
    fee = _fill_fraction(
        costs.get("publicRegularTakerFeeBasisPointsPerFill"),
        "costs.publicRegularTakerFeeBasisPointsPerFill",
    )
    adverse = Decimal(adverse_bps_per_fill) / Decimal(10_000)
    base_participation = parse_decimal(
        require_str(
            capacity.get("baseParticipationBasisPoints"),
            "capacity.baseParticipationBasisPoints",
        ),
        "capacity.baseParticipationBasisPoints",
        positive=True,
    ) / Decimal(10_000)
    stress_participation = parse_decimal(
        require_str(
            capacity.get("stressParticipationBasisPoints"),
            "capacity.stressParticipationBasisPoints",
        ),
        "capacity.stressParticipationBasisPoints",
        positive=True,
    ) / Decimal(10_000)

    equity = initial
    marks: list[Decimal] = [initial]
    weekly_returns: list[Decimal] = []
    active_weeks = 0
    traded_assets: set[str] = set()
    capacity_headrooms: list[Decimal] = []
    stress_capacity_headrooms: list[Decimal] = []
    regime_breadths: list[Decimal] = []

    for entry_day in _weekly_entries(entry_start, entry_end):
        cutoff = entry_day - timedelta(days=2)
        positive = 0
        for symbol in symbols():
            if (
                elasticity_break(
                    bars_by_symbol[symbol],
                    cutoff,
                    trial.short_days,
                    trial.baseline_days,
                )
                > 0
            ):
                positive += 1
        breadth = Decimal(positive) / Decimal(len(symbols()))
        regime_breadths.append(breadth)
        regime_on = breadth >= trial.breadth
        previous_equity = equity
        exit_day = entry_day + timedelta(days=7)
        if not regime_on:
            weekly_returns.append(Decimal(0))
            marks.extend([equity] * 7)
            continue

        active_weeks += 1
        allocation = equity / Decimal(len(symbols()))
        exit_proceeds = Decimal(0)
        quantities: dict[str, Decimal] = {}
        for symbol in symbols():
            entry_bar = bars_by_symbol[symbol].get(entry_day)
            exit_bar = bars_by_symbol[symbol].get(exit_day)
            if entry_bar is None or exit_bar is None:
                raise MeasurementError("full-cohort entry or exit bar missing")
            quantity = (
                allocation * (Decimal(1) - fee) / (entry_bar.open_price * (Decimal(1) + adverse))
            )
            quantities[symbol] = quantity
            proceeds = quantity * exit_bar.open_price * (Decimal(1) - adverse) * (Decimal(1) - fee)
            exit_proceeds += proceeds
            entry_capacity_reference = _trailing_quote_volume_reference(
                bars_by_symbol[symbol], entry_day
            )
            exit_capacity_reference = _trailing_quote_volume_reference(
                bars_by_symbol[symbol], exit_day
            )
            entry_public_capacity = entry_capacity_reference * base_participation
            exit_public_capacity = exit_capacity_reference * base_participation
            entry_stress_capacity = entry_capacity_reference * stress_participation
            exit_stress_capacity = exit_capacity_reference * stress_participation
            capacity_headrooms.extend(
                [
                    entry_public_capacity / allocation,
                    exit_public_capacity / proceeds,
                ]
            )
            stress_capacity_headrooms.extend(
                [
                    entry_stress_capacity / allocation,
                    exit_stress_capacity / proceeds,
                ]
            )
            traded_assets.add(symbol)

        for offset in range(7):
            mark_day = entry_day + timedelta(days=offset)
            liquidation_value = Decimal(0)
            for symbol, quantity in quantities.items():
                mark_bar = bars_by_symbol[symbol].get(mark_day)
                if mark_bar is None:
                    raise MeasurementError("close-mark drawdown bar missing")
                liquidation_value += (
                    quantity * mark_bar.close_price * (Decimal(1) - adverse) * (Decimal(1) - fee)
                )
            marks.append(liquidation_value)
        equity = exit_proceeds
        weekly_returns.append(equity / previous_equity - Decimal(1))

    return Simulation(
        trial=trial,
        adverse_bps_per_fill=adverse_bps_per_fill,
        weekly_returns=tuple(weekly_returns),
        final_net_usd_per_1000=equity - initial,
        active_weeks=active_weeks,
        round_trips=active_weeks * len(symbols()),
        distinct_assets=tuple(sorted(traded_assets)),
        maximum_close_mark_drawdown=maximum_drawdown(marks),
        minimum_capacity_headroom=min(capacity_headrooms) if capacity_headrooms else None,
        minimum_stress_capacity_headroom=(
            min(stress_capacity_headrooms) if stress_capacity_headrooms else None
        ),
        regime_breadths=tuple(regime_breadths),
    )


def compounded_net_usd_per_1000(weekly_returns: Sequence[Decimal]) -> Decimal:
    equity = Decimal(1000)
    for weekly_return in weekly_returns:
        if not weekly_return.is_finite() or weekly_return <= Decimal(-1):
            raise MeasurementError("weekly return path is invalid")
        equity *= Decimal(1) + weekly_return
    return equity - Decimal(1000)


def circular_block_indices(
    count: int,
    block_length: int,
    generator: SplitMix64,
) -> tuple[int, ...]:
    if count <= 0 or block_length <= 0:
        raise ContractError("circular block dimensions must be positive")
    result: list[int] = []
    while len(result) < count:
        start = generator.randbelow(count)
        result.extend((start + offset) % count for offset in range(block_length))
    return tuple(result[:count])


def _seed_for(label: str, base_seed: int) -> int:
    digest = hashlib.sha256(f"{base_seed}:{label}".encode()).digest()
    return int.from_bytes(digest[:8], "big")


def _quantile(values: Sequence[Decimal], probability: Decimal) -> Decimal:
    if not values or probability < 0 or probability > 1:
        raise ContractError("quantile inputs invalid")
    ordered = sorted(values)
    position = probability * Decimal(len(ordered) - 1)
    lower_index = int(position)
    upper_index = min(lower_index + 1, len(ordered) - 1)
    fraction = position - Decimal(lower_index)
    return ordered[lower_index] * (Decimal(1) - fraction) + ordered[upper_index] * fraction


def bootstrap_interval(
    weekly_returns: Sequence[Decimal],
    *,
    replicates: int | None = None,
    block_length: int | None = None,
    seed: int | None = None,
    label: str = "interval",
) -> BootstrapInterval:
    if not weekly_returns:
        raise MeasurementError("bootstrap return path is empty")
    config = require_mapping(protocol().get("bootstrap"), "bootstrap")
    replicate_count = (
        require_int(config.get("replicates"), "bootstrap.replicates")
        if replicates is None
        else replicates
    )
    block_count = (
        require_int(config.get("blockLengthWeeks"), "bootstrap.blockLengthWeeks")
        if block_length is None
        else block_length
    )
    base_seed = require_int(config.get("seed"), "bootstrap.seed") if seed is None else seed
    if replicate_count < 2 or block_count <= 0:
        raise ContractError("bootstrap configuration invalid")
    generator = SplitMix64(_seed_for(label, base_seed))
    samples: list[Decimal] = []
    for _replicate in range(replicate_count):
        indices = circular_block_indices(len(weekly_returns), block_count, generator)
        samples.append(
            compounded_net_usd_per_1000(tuple(weekly_returns[index] for index in indices))
        )
    return BootstrapInterval(
        lower_net_usd_per_1000=_quantile(samples, Decimal("0.025")),
        point_net_usd_per_1000=compounded_net_usd_per_1000(weekly_returns),
        upper_net_usd_per_1000=_quantile(samples, Decimal("0.975")),
    )


def holm_adjust(raw_p_values: Mapping[str, Decimal]) -> dict[str, Decimal]:
    if not raw_p_values:
        raise ContractError("Holm family is empty")
    for value in raw_p_values.values():
        if not value.is_finite() or value < 0 or value > 1:
            raise ContractError("raw p-value outside [0,1]")
    ordered = sorted(raw_p_values.items(), key=lambda item: (item[1], item[0]))
    adjusted: dict[str, Decimal] = {}
    running = Decimal(0)
    family_size = len(ordered)
    for rank, (trial_id, raw_value) in enumerate(ordered):
        candidate = min(Decimal(1), raw_value * Decimal(family_size - rank))
        running = max(running, candidate)
        adjusted[trial_id] = running
    return adjusted


def family_inference(
    simulations: Mapping[str, Simulation],
    *,
    replicates: int | None = None,
    block_length: int | None = None,
    seed: int | None = None,
) -> tuple[dict[str, Decimal], dict[str, Decimal], Decimal]:
    if set(simulations) != {trial.trial_id for trial in trials()}:
        raise ContractError("multiplicity family does not contain all frozen trials")
    ordered_ids = tuple(sorted(simulations))
    week_counts = {len(simulations[trial_id].weekly_returns) for trial_id in ordered_ids}
    if len(week_counts) != 1 or next(iter(week_counts)) <= 0:
        raise MeasurementError("multiplicity paths do not share one positive length")
    week_count = next(iter(week_counts))
    config = require_mapping(protocol().get("bootstrap"), "bootstrap")
    replicate_count = (
        require_int(config.get("replicates"), "bootstrap.replicates")
        if replicates is None
        else replicates
    )
    block_count = (
        require_int(config.get("blockLengthWeeks"), "bootstrap.blockLengthWeeks")
        if block_length is None
        else block_length
    )
    base_seed = require_int(config.get("seed"), "bootstrap.seed") if seed is None else seed
    if replicate_count < 2 or block_count <= 0:
        raise ContractError("multiplicity bootstrap configuration invalid")

    observed_means: dict[str, Decimal] = {}
    centered: dict[str, tuple[Decimal, ...]] = {}
    for trial_id in ordered_ids:
        path = simulations[trial_id].weekly_returns
        observed = sum(path, Decimal(0)) / Decimal(week_count)
        observed_means[trial_id] = observed
        centered[trial_id] = tuple(value - observed for value in path)
    observed_maximum = max(observed_means.values())
    exceedances = dict.fromkeys(ordered_ids, 0)
    white_exceedances = 0
    generator = SplitMix64(_seed_for("family-inference", base_seed))
    for _replicate in range(replicate_count):
        indices = circular_block_indices(week_count, block_count, generator)
        bootstrap_means: dict[str, Decimal] = {}
        for trial_id in ordered_ids:
            bootstrap_mean = sum(
                (centered[trial_id][index] for index in indices), Decimal(0)
            ) / Decimal(week_count)
            bootstrap_means[trial_id] = bootstrap_mean
            if bootstrap_mean >= observed_means[trial_id]:
                exceedances[trial_id] += 1
        if max(bootstrap_means.values()) >= observed_maximum:
            white_exceedances += 1
    denominator = Decimal(replicate_count + 1)
    raw = {trial_id: Decimal(exceedances[trial_id] + 1) / denominator for trial_id in ordered_ids}
    white = Decimal(white_exceedances + 1) / denominator
    return raw, holm_adjust(raw), white


def probability_of_backtest_overfitting(
    simulations: Mapping[str, Simulation],
) -> tuple[Decimal, int]:
    ordered_ids = tuple(sorted(simulations))
    if set(ordered_ids) != {trial.trial_id for trial in trials()}:
        raise ContractError("PBO family does not contain all frozen trials")
    week_counts = {len(simulations[trial_id].weekly_returns) for trial_id in ordered_ids}
    if len(week_counts) != 1:
        raise MeasurementError("PBO paths have different lengths")
    total_weeks = next(iter(week_counts))
    config = require_mapping(protocol().get("pbo"), "pbo")
    block_count = require_int(config.get("blockCount"), "pbo.blockCount")
    usable_weeks = total_weeks // block_count * block_count
    if usable_weeks < block_count:
        raise MeasurementError("PBO has too few weeks")
    block_size = usable_weeks // block_count
    blocks = tuple(
        tuple(range(block * block_size, (block + 1) * block_size)) for block in range(block_count)
    )
    failures = 0
    split_count = 0
    for in_sample_blocks in itertools.combinations(range(block_count), block_count // 2):
        in_sample_set = set(in_sample_blocks)
        in_indices = tuple(
            index
            for block, indices in enumerate(blocks)
            if block in in_sample_set
            for index in indices
        )
        out_indices = tuple(
            index
            for block, indices in enumerate(blocks)
            if block not in in_sample_set
            for index in indices
        )

        def mean_for(trial_id: str, indices: Sequence[int]) -> Decimal:
            path = simulations[trial_id].weekly_returns
            return sum((path[index] for index in indices), Decimal(0)) / Decimal(len(indices))

        selected = min(
            ordered_ids,
            key=lambda trial_id: (-mean_for(trial_id, in_indices), trial_id),
        )
        out_values = {trial_id: mean_for(trial_id, out_indices) for trial_id in ordered_ids}
        selected_value = out_values[selected]
        below = sum(value < selected_value for value in out_values.values())
        equal = sum(value == selected_value for value in out_values.values())
        average_rank = Decimal(below + 1) + Decimal(equal - 1) / Decimal(2)
        if average_rank <= Decimal(len(ordered_ids) + 1) / Decimal(2):
            failures += 1
        split_count += 1
    expected = require_int(
        config.get("expectedSymmetricSplitCount"),
        "pbo.expectedSymmetricSplitCount",
    )
    if split_count != expected:
        raise ContractError("PBO symmetric split count mismatch")
    return Decimal(failures) / Decimal(split_count), split_count


def _interval_payload(interval: BootstrapInterval) -> JsonObject:
    return {
        "lowerNetUsdPer1000": decimal_text(interval.lower_net_usd_per_1000),
        "pointNetUsdPer1000": decimal_text(interval.point_net_usd_per_1000),
        "upperNetUsdPer1000": decimal_text(interval.upper_net_usd_per_1000),
    }


def _simulation_payload(simulation: Simulation) -> JsonObject:
    return {
        "adverseBasisPointsPerFill": simulation.adverse_bps_per_fill,
        "netUsdPer1000": decimal_text(simulation.final_net_usd_per_1000),
        "activeWeeks": simulation.active_weeks,
        "roundTrips": simulation.round_trips,
        "distinctAssets": list(simulation.distinct_assets),
        "maximumCloseMarkDrawdownFraction": decimal_text(simulation.maximum_close_mark_drawdown),
        "minimumPublicCapacityHeadroom": (
            None
            if simulation.minimum_capacity_headroom is None
            else decimal_text(simulation.minimum_capacity_headroom)
        ),
        "minimumStressPublicCapacityHeadroom": (
            None
            if simulation.minimum_stress_capacity_headroom is None
            else decimal_text(simulation.minimum_stress_capacity_headroom)
        ),
        "weeklyObservationCount": len(simulation.weekly_returns),
        "weeklyNetReturns": [decimal_text(value) for value in simulation.weekly_returns],
        "regimeBreadths": [decimal_text(value) for value in simulation.regime_breadths],
    }


def _cost_levels() -> tuple[int, int, int]:
    costs = require_mapping(protocol().get("costs"), "costs")
    return (
        require_int(
            costs.get("baseAdversePriceBasisPointsPerFill"),
            "costs.baseAdversePriceBasisPointsPerFill",
        ),
        require_int(
            costs.get("stressAdversePriceBasisPointsPerFill"),
            "costs.stressAdversePriceBasisPointsPerFill",
        ),
        require_int(
            costs.get("severeAdversePriceBasisPointsPerFill"),
            "costs.severeAdversePriceBasisPointsPerFill",
        ),
    )


def _partition(name: str) -> Mapping[str, object]:
    partitions = require_mapping(protocol().get("partitions"), "partitions")
    return require_mapping(partitions.get(name), f"partitions.{name}")


def _simulate_family(
    bars_by_symbol: Mapping[str, Mapping[date, Bar]],
    partition_name: str,
) -> tuple[
    dict[str, Simulation],
    dict[str, Simulation],
    dict[str, Simulation],
    dict[str, BootstrapInterval],
    dict[str, BootstrapInterval],
]:
    partition = _partition(partition_name)
    entry_start = parse_day(
        require_str(partition.get("entryStartUtcDate"), f"{partition_name}.entryStart")
    )
    entry_end = parse_day(
        require_str(partition.get("entryEndUtcDate"), f"{partition_name}.entryEnd")
    )
    base_cost, stress_cost, severe_cost = _cost_levels()
    base: dict[str, Simulation] = {}
    stress: dict[str, Simulation] = {}
    severe: dict[str, Simulation] = {}
    base_intervals: dict[str, BootstrapInterval] = {}
    stress_intervals: dict[str, BootstrapInterval] = {}
    for trial in trials():
        trial_id = trial.trial_id
        base[trial_id] = simulate(trial, bars_by_symbol, entry_start, entry_end, base_cost)
        stress[trial_id] = simulate(trial, bars_by_symbol, entry_start, entry_end, stress_cost)
        severe[trial_id] = simulate(trial, bars_by_symbol, entry_start, entry_end, severe_cost)
        base_intervals[trial_id] = bootstrap_interval(
            base[trial_id].weekly_returns,
            label=f"{partition_name}:{trial_id}:base",
        )
        stress_intervals[trial_id] = bootstrap_interval(
            stress[trial_id].weekly_returns,
            label=f"{partition_name}:{trial_id}:stress",
        )
    return base, stress, severe, base_intervals, stress_intervals


def _select_development_champion(
    stress: Mapping[str, Simulation],
    stress_intervals: Mapping[str, BootstrapInterval],
) -> str:
    trial_by_id = {trial.trial_id: trial for trial in trials()}
    return min(
        sorted(stress),
        key=lambda trial_id: (
            -stress_intervals[trial_id].lower_net_usd_per_1000,
            -stress[trial_id].final_net_usd_per_1000,
            trial_by_id[trial_id].short_days,
            trial_by_id[trial_id].baseline_days,
            -trial_by_id[trial_id].breadth,
            trial_id,
        ),
    )


def _economic_gate_failures(
    *,
    partition_name: str,
    base: Simulation,
    stress: Simulation,
    base_interval: BootstrapInterval,
    stress_interval: BootstrapInterval,
) -> list[str]:
    gate_root = require_mapping(protocol().get("formalGates"), "formalGates")
    gates = require_mapping(gate_root.get(partition_name), f"formalGates.{partition_name}")
    failures: list[str] = []
    if stress.active_weeks < require_int(
        gates.get("activeWeeksMinimum"), "gates.activeWeeksMinimum"
    ):
        failures.append("ACTIVE_WEEKS_BELOW_MINIMUM")
    if stress.round_trips < require_int(gates.get("roundTripsMinimum"), "gates.roundTripsMinimum"):
        failures.append("ROUND_TRIPS_BELOW_MINIMUM")
    if len(stress.distinct_assets) != require_int(
        gates.get("distinctAssetsRequired"), "gates.distinctAssetsRequired"
    ):
        failures.append("DISTINCT_ASSETS_NOT_FULL_COHORT")
    if base.final_net_usd_per_1000 <= parse_decimal(
        require_str(
            gates.get("baseNetUsdPer1000ExclusiveMinimum"),
            "gates.baseNetUsdPer1000ExclusiveMinimum",
        ),
        "gates.baseNetUsdPer1000ExclusiveMinimum",
    ):
        failures.append("BASE_NET_NOT_POSITIVE")
    if stress.final_net_usd_per_1000 <= parse_decimal(
        require_str(
            gates.get("stressNetUsdPer1000ExclusiveMinimum"),
            "gates.stressNetUsdPer1000ExclusiveMinimum",
        ),
        "gates.stressNetUsdPer1000ExclusiveMinimum",
    ):
        failures.append("STRESS_NET_NOT_POSITIVE")
    if base_interval.lower_net_usd_per_1000 <= parse_decimal(
        require_str(
            gates.get("baseBootstrapLowerNetUsdPer1000ExclusiveMinimum"),
            "gates.baseBootstrapLowerNetUsdPer1000ExclusiveMinimum",
        ),
        "gates.baseBootstrapLowerNetUsdPer1000ExclusiveMinimum",
    ):
        failures.append("BASE_INTERVAL_LOWER_BOUND_NOT_POSITIVE")
    if stress_interval.lower_net_usd_per_1000 <= parse_decimal(
        require_str(
            gates.get("stressBootstrapLowerNetUsdPer1000ExclusiveMinimum"),
            "gates.stressBootstrapLowerNetUsdPer1000ExclusiveMinimum",
        ),
        "gates.stressBootstrapLowerNetUsdPer1000ExclusiveMinimum",
    ):
        failures.append("STRESS_INTERVAL_LOWER_BOUND_NOT_POSITIVE")
    drawdown_limit = parse_decimal(
        require_str(
            gates.get("maximumCloseMarkDrawdownFraction"),
            "gates.maximumCloseMarkDrawdownFraction",
        ),
        "gates.maximumCloseMarkDrawdownFraction",
        positive=True,
    )
    if stress.maximum_close_mark_drawdown > drawdown_limit:
        failures.append("MAXIMUM_DRAWDOWN_ABOVE_LIMIT")
    headroom_minimum = parse_decimal(
        require_str(
            gates.get("publicCapacityHeadroomMinimum"),
            "gates.publicCapacityHeadroomMinimum",
        ),
        "gates.publicCapacityHeadroomMinimum",
        positive=True,
    )
    if (
        stress.minimum_stress_capacity_headroom is None
        or stress.minimum_stress_capacity_headroom < headroom_minimum
    ):
        failures.append("PUBLIC_CAPACITY_HEADROOM_BELOW_MINIMUM")
    return failures


def _trial_payload(
    trial_id: str,
    base: Mapping[str, Simulation],
    stress: Mapping[str, Simulation],
    severe: Mapping[str, Simulation],
    base_intervals: Mapping[str, BootstrapInterval],
    stress_intervals: Mapping[str, BootstrapInterval],
) -> JsonObject:
    trial = {value.trial_id: value for value in trials()}[trial_id]
    return {
        "trialId": trial_id,
        "shortWindowDays": trial.short_days,
        "baselineWindowDays": trial.baseline_days,
        "positiveBreakBreadth": decimal_text(trial.breadth),
        "base": _simulation_payload(base[trial_id]),
        "baseBootstrap95": _interval_payload(base_intervals[trial_id]),
        "stress": _simulation_payload(stress[trial_id]),
        "stressBootstrap95": _interval_payload(stress_intervals[trial_id]),
        "severe": _simulation_payload(severe[trial_id]),
    }


def development_analysis(
    bars_by_symbol: Mapping[str, Mapping[date, Bar]],
) -> tuple[JsonObject, str, list[str]]:
    base, stress, severe, base_intervals, stress_intervals = _simulate_family(
        bars_by_symbol, "development"
    )
    raw_p, holm_p, white_p = family_inference(stress)
    pbo, split_count = probability_of_backtest_overfitting(stress)
    champion = _select_development_champion(stress, stress_intervals)
    multiplicity = require_mapping(protocol().get("multiplicity"), "multiplicity")
    external_factor = require_int(
        multiplicity.get("externalNamedVGAttemptFactor"),
        "multiplicity.externalNamedVGAttemptFactor",
    )
    external_p = min(Decimal(1), holm_p[champion] * Decimal(external_factor))
    failures = _economic_gate_failures(
        partition_name="development",
        base=base[champion],
        stress=stress[champion],
        base_interval=base_intervals[champion],
        stress_interval=stress_intervals[champion],
    )
    gate_root = require_mapping(protocol().get("formalGates"), "formalGates")
    gates = require_mapping(gate_root.get("development"), "formalGates.development")
    if pbo > parse_decimal(
        require_str(gates.get("pboMaximum"), "gates.pboMaximum"),
        "gates.pboMaximum",
        positive=True,
    ):
        failures.append("PBO_ABOVE_LIMIT")
    if holm_p[champion] >= parse_decimal(
        require_str(
            gates.get("withinFamilyHolmAdjustedPExclusiveMaximum"),
            "gates.withinFamilyHolmAdjustedPExclusiveMaximum",
        ),
        "gates.withinFamilyHolmAdjustedPExclusiveMaximum",
        positive=True,
    ):
        failures.append("HOLM_ADJUSTED_P_NOT_BELOW_LIMIT")
    if white_p >= parse_decimal(
        require_str(
            gates.get("whiteRealityCheckPExclusiveMaximum"),
            "gates.whiteRealityCheckPExclusiveMaximum",
        ),
        "gates.whiteRealityCheckPExclusiveMaximum",
        positive=True,
    ):
        failures.append("WHITE_REALITY_CHECK_P_NOT_BELOW_LIMIT")
    if external_p >= parse_decimal(
        require_str(
            gates.get("externalAdjustedPExclusiveMaximum"),
            "gates.externalAdjustedPExclusiveMaximum",
        ),
        "gates.externalAdjustedPExclusiveMaximum",
        positive=True,
    ):
        failures.append("EXTERNAL_VG_ADJUSTED_P_NOT_BELOW_LIMIT")
    payload: JsonObject = {
        "partition": "DEVELOPMENT_12_MONTHS",
        "championTrialId": champion,
        "champion": _trial_payload(
            champion, base, stress, severe, base_intervals, stress_intervals
        ),
        "trials": [
            _trial_payload(trial_id, base, stress, severe, base_intervals, stress_intervals)
            for trial_id in sorted(base)
        ],
        "multiplicity": {
            "rawOneSidedPByTrial": {
                trial_id: decimal_text(raw_p[trial_id]) for trial_id in sorted(raw_p)
            },
            "holmAdjustedPByTrial": {
                trial_id: decimal_text(holm_p[trial_id]) for trial_id in sorted(holm_p)
            },
            "championRawOneSidedP": decimal_text(raw_p[champion]),
            "championHolmAdjustedP": decimal_text(holm_p[champion]),
            "whiteRealityCheckP": decimal_text(white_p),
            "externalNamedVGAttemptFactor": external_factor,
            "externalAdjustedP": decimal_text(external_p),
        },
        "pbo": {
            "probability": decimal_text(pbo),
            "symmetricSplitCount": split_count,
        },
        "gateFailures": failures,
        "allGatesPass": not failures,
    }
    return payload, champion, failures


def holdout_analysis(
    bars_by_symbol: Mapping[str, Mapping[date, Bar]],
    champion_trial_id: str,
) -> tuple[JsonObject, list[str]]:
    trial_by_id = {trial.trial_id: trial for trial in trials()}
    if champion_trial_id not in trial_by_id:
        raise ContractError("holdout champion is outside frozen family")
    partition = _partition("holdout")
    entry_start = parse_day(
        require_str(partition.get("entryStartUtcDate"), "holdout.entryStartUtcDate")
    )
    entry_end = parse_day(require_str(partition.get("entryEndUtcDate"), "holdout.entryEndUtcDate"))
    base_cost, stress_cost, severe_cost = _cost_levels()
    champion = trial_by_id[champion_trial_id]
    base = simulate(champion, bars_by_symbol, entry_start, entry_end, base_cost)
    stress = simulate(champion, bars_by_symbol, entry_start, entry_end, stress_cost)
    severe = simulate(champion, bars_by_symbol, entry_start, entry_end, severe_cost)
    base_interval = bootstrap_interval(
        base.weekly_returns, label=f"holdout:{champion_trial_id}:base"
    )
    stress_interval = bootstrap_interval(
        stress.weekly_returns, label=f"holdout:{champion_trial_id}:stress"
    )
    failures = _economic_gate_failures(
        partition_name="holdout",
        base=base,
        stress=stress,
        base_interval=base_interval,
        stress_interval=stress_interval,
    )
    payload = _trial_payload(
        champion_trial_id,
        {champion_trial_id: base},
        {champion_trial_id: stress},
        {champion_trial_id: severe},
        {champion_trial_id: base_interval},
        {champion_trial_id: stress_interval},
    )
    return {
        "partition": "SEALED_HOLDOUT_12_MONTHS",
        "champion": payload,
        "gateFailures": failures,
        "allGatesPass": not failures,
    }, failures


def _git_output(arguments: Sequence[str]) -> str:
    completed = subprocess.run(
        ["git", *arguments],
        cwd=HERE,
        check=True,
        capture_output=True,
        text=True,
    )
    return completed.stdout.strip()


def assert_clean_scoped_candidate() -> str:
    if _git_output(["status", "--porcelain=v1", "--untracked-files=all"]):
        raise ContractError("candidate must be clean before custody consumption")
    base_commit = require_str(protocol().get("baseCommit"), "baseCommit")
    head = _git_output(["rev-parse", "HEAD"])
    merge_base = _git_output(["merge-base", base_commit, head])
    if merge_base != base_commit:
        raise ContractError("candidate does not descend from exact frozen base")
    changed = tuple(
        line
        for line in _git_output(["diff", "--name-only", f"{base_commit}..{head}"]).splitlines()
        if line
    )
    if not changed or any(not path.startswith("quant/research/vg29/") for path in changed):
        raise ContractError("candidate changed paths outside exclusive V-G29 scope")
    return head


def _development_months() -> set[str]:
    data = require_mapping(protocol().get("data"), "data")
    terminal = require_str(
        data.get("developmentArchiveEndMonth"), "data.developmentArchiveEndMonth"
    )
    result = {month for month in archive_months() if month <= terminal}
    if not result:
        raise ContractError("development month partition is empty")
    return result


def _holdout_months() -> set[str]:
    data = require_mapping(protocol().get("data"), "data")
    initial = require_str(data.get("holdoutArchiveStartMonth"), "data.holdoutArchiveStartMonth")
    result = {month for month in archive_months() if month >= initial}
    if not result:
        raise ContractError("holdout month partition is empty")
    return result


def consume_development_custody(head: str) -> JsonObject:
    external_path = state_root() / "custody" / "development-run-marker.v1.json"
    if (
        RUN_MARKER_PATH.exists()
        or DEVELOPMENT_EVIDENCE_PATH.exists()
        or RESULT_PATH.exists()
        or CHAMPION_SEAL_PATH.exists()
        or HOLDOUT_OPEN_PATH.exists()
        or external_path.exists()
    ):
        raise ContractError("development run custody is already consumed")
    freeze = verify_freeze()
    marker: JsonObject = {
        "schema": "VG29DevelopmentRunMarkerV1",
        "consumedAtUtc": utc_now(),
        "candidateCommit": head,
        "state": "CONSUMED_BEFORE_FIRST_ARCHIVE_DECOMPRESSION",
        "maximumRunCount": 1,
        "archiveBodiesOpenedBeforeMarker": False,
        "holdoutArchiveBodiesOpened": False,
        "protocolSha256": sha256_path(PROTOCOL_PATH),
        "sourceManifestSha256": sha256_path(SOURCE_MANIFEST_PATH),
        "freezeSha256": sha256_bytes(canonical_bytes(freeze)),
    }
    write_json_once(external_path, marker, mode=0o600)
    try:
        write_json_once(RUN_MARKER_PATH, marker)
    except BaseException as exc:
        raise ContractError(
            "external custody consumed but packet-local marker could not be written"
        ) from exc
    return marker


def _write_development_evidence(
    head: str,
    development: Mapping[str, object],
) -> JsonObject:
    evidence: JsonObject = {
        "schema": "VG29DevelopmentEvidenceV1",
        "createdAtUtc": utc_now(),
        "candidateCommit": head,
        "protocolSha256": sha256_path(PROTOCOL_PATH),
        "sourceManifestSha256": sha256_path(SOURCE_MANIFEST_PATH),
        "freezeSha256": sha256_path(FREEZE_PATH),
        "developmentPayloadSha256": sha256_bytes(canonical_bytes(development)),
        "development": dict(development),
    }
    write_json_once(DEVELOPMENT_EVIDENCE_PATH, evidence)
    return evidence


def _open_holdout(
    head: str,
    champion_trial_id: str,
    development: Mapping[str, object],
) -> None:
    if HOLDOUT_OPEN_PATH.exists() or CHAMPION_SEAL_PATH.exists():
        raise ContractError("holdout custody already exists")
    if development.get("allGatesPass") is not True:
        raise ContractError("holdout cannot open after development gate failure")
    champion: JsonObject = {
        "schema": "VG29DevelopmentChampionV1",
        "sealedAtUtc": utc_now(),
        "candidateCommit": head,
        "championTrialId": champion_trial_id,
        "developmentEvidenceSha256": sha256_path(DEVELOPMENT_EVIDENCE_PATH),
        "developmentPayloadSha256": sha256_bytes(canonical_bytes(development)),
        "protocolSha256": sha256_path(PROTOCOL_PATH),
        "freezeSha256": sha256_path(FREEZE_PATH),
        "state": "DEVELOPMENT_CHAMPION_SEALED_BEFORE_HOLDOUT",
    }
    write_json_once(CHAMPION_SEAL_PATH, champion)
    receipt: JsonObject = {
        "schema": "VG29HoldoutOpenV1",
        "openedAtUtc": utc_now(),
        "candidateCommit": head,
        "championTrialId": champion_trial_id,
        "championSealSha256": sha256_path(CHAMPION_SEAL_PATH),
        "maximumOpenCount": 1,
        "state": "AUTHORIZED_SINGLE_CHAMPION_HOLDOUT_OPEN",
    }
    external_path = state_root() / "custody" / "holdout-open.v1.json"
    if external_path.exists():
        raise ContractError("external holdout custody is already consumed")
    write_json_once(external_path, receipt, mode=0o600)
    try:
        write_json_once(HOLDOUT_OPEN_PATH, receipt)
    except BaseException as exc:
        raise ContractError(
            "external holdout custody consumed but packet-local receipt failed"
        ) from exc


def _result_truth(verdict: str) -> JsonObject:
    return {
        "binancePublicProxyVerdict": verdict,
        "accountEffectiveFee": "UNKNOWN",
        "accountExecutableProfitability": "UNKNOWN",
        "historicalSpreadDepthImpactLatency": "UNMEASURED",
        "historicalListingAndFilterExecutability": "UNMEASURED",
        "historicalIntradayDrawdown": "UNMEASURED",
        "executableCapacity": "UNMEASURED",
        "capitalAuthority": "NONE",
        "effectUsd": "0",
    }


def terminal_unmeasured(reason: str, marker: Mapping[str, object] | None) -> JsonObject:
    result: JsonObject = {
        "schema": "VG29ResultV1",
        "createdAtUtc": utc_now(),
        "verdict": "UNMEASURED",
        "state": "TERMINAL_SINGLE_RUN_INVALID_NO_REPAIR_OR_RERUN",
        "protocolSha256": sha256_path(PROTOCOL_PATH),
        "sourceManifestSha256": (
            sha256_path(SOURCE_MANIFEST_PATH) if SOURCE_MANIFEST_PATH.exists() else None
        ),
        "freezeSha256": sha256_path(FREEZE_PATH) if FREEZE_PATH.exists() else None,
        "custody": {
            "developmentRunConsumed": marker is not None,
            "holdoutOpened": HOLDOUT_OPEN_PATH.exists(),
        },
        "failure": reason,
        "development": None,
        "holdout": None,
        "truth": _result_truth("UNMEASURED"),
        "limitations": [
            "NULL_MEASUREMENT_VALUES_ARE_NOT_NUMERIC_ZERO",
            "NO_REPAIR_RERUN_RETUNE_RUNNER_UP_OR_SYMBOL_DROP",
        ],
    }
    write_json_once(RESULT_PATH, result)
    return result


def run_once() -> JsonObject:
    if RESULT_PATH.exists():
        raise ContractError("sealed result already exists; recomputation is forbidden")
    verify_freeze()
    head = assert_clean_scoped_candidate()
    marker: JsonObject | None = None
    try:
        marker = consume_development_custody(head)
        development_bars = load_bars(_development_months())
        development, champion, development_failures = development_analysis(development_bars)
        _write_development_evidence(head, development)
        if development_failures:
            result: JsonObject = {
                "schema": "VG29ResultV1",
                "createdAtUtc": utc_now(),
                "verdict": "NO_GO",
                "state": "VALID_PUBLIC_DEVELOPMENT_MEASUREMENT_FAILED_FROZEN_GATES",
                "protocolSha256": sha256_path(PROTOCOL_PATH),
                "sourceManifestSha256": sha256_path(SOURCE_MANIFEST_PATH),
                "freezeSha256": sha256_path(FREEZE_PATH),
                "custody": {
                    "developmentRunConsumed": True,
                    "holdoutOpened": False,
                    "holdoutReason": "DEVELOPMENT_GATES_FAILED",
                },
                "development": development,
                "holdout": None,
                "truth": _result_truth("NO_GO"),
                "limitations": [
                    "FIXED_DISCLOSED_SURVIVOR_COHORT_NOT_HISTORICAL_BINANCE_UNIVERSE",
                    "DAILY_REFERENCE_OPEN_AND_CLOSE_MARKS_NOT_OBSERVED_FILLS",
                    "PUBLIC_REGULAR_TAKER_FEE_AND_ADVERSE_PRICE_PROXIES_NOT_ACCOUNT_TRUTH",
                    "QUOTE_VOLUME_PARTICIPATION_IS_NOT_ORDER_BOOK_OR_EXECUTABLE_CAPACITY",
                    "HOLDOUT_ARCHIVES_UNOPENED",
                ],
            }
            write_json_once(RESULT_PATH, result)
            return result

        _open_holdout(head, champion, development)
        holdout_bars = load_bars(_holdout_months())
        combined_bars = merge_bars(development_bars, holdout_bars)
        holdout, holdout_failures = holdout_analysis(combined_bars, champion)
        verdict = "NO_GO" if holdout_failures else "GO"
        state = (
            "VALID_PUBLIC_HOLDOUT_MEASUREMENT_FAILED_FROZEN_GATES"
            if holdout_failures
            else "VALID_PUBLIC_PROXY_SCENARIO_PASSED_ALL_FROZEN_GATES_NO_CAPITAL_AUTHORITY"
        )
        result = {
            "schema": "VG29ResultV1",
            "createdAtUtc": utc_now(),
            "verdict": verdict,
            "state": state,
            "protocolSha256": sha256_path(PROTOCOL_PATH),
            "sourceManifestSha256": sha256_path(SOURCE_MANIFEST_PATH),
            "freezeSha256": sha256_path(FREEZE_PATH),
            "custody": {
                "developmentRunConsumed": True,
                "developmentChampionSealed": True,
                "holdoutOpened": True,
                "holdoutOpenCount": 1,
            },
            "development": development,
            "holdout": holdout,
            "truth": _result_truth(verdict),
            "limitations": [
                "FIXED_DISCLOSED_SURVIVOR_COHORT_NOT_HISTORICAL_BINANCE_UNIVERSE",
                "DAILY_REFERENCE_OPEN_AND_CLOSE_MARKS_NOT_OBSERVED_FILLS",
                "PUBLIC_REGULAR_TAKER_FEE_AND_ADVERSE_PRICE_PROXIES_NOT_ACCOUNT_TRUTH",
                "QUOTE_VOLUME_PARTICIPATION_IS_NOT_ORDER_BOOK_OR_EXECUTABLE_CAPACITY",
            ],
        }
        write_json_once(RESULT_PATH, result)
        return result
    except Exception as exc:
        if marker is None:
            raise
        if RESULT_PATH.exists():
            raise
        return terminal_unmeasured(f"{type(exc).__name__}: {exc}", marker)


def _validate_candidate_commit(candidate: str) -> None:
    if re.fullmatch(r"[0-9a-f]{40}", candidate) is None:
        raise ContractError("custody candidate commit shape invalid")
    _git_output(["cat-file", "-e", f"{candidate}^{{commit}}"])
    base_commit = require_str(protocol().get("baseCommit"), "baseCommit")
    if _git_output(["merge-base", base_commit, candidate]) != base_commit:
        raise ContractError("custody candidate does not descend from exact base")
    changed = tuple(
        line
        for line in _git_output(["diff", "--name-only", f"{base_commit}..{candidate}"]).splitlines()
        if line
    )
    if not changed or any(not path.startswith("quant/research/vg29/") for path in changed):
        raise ContractError("custody candidate escaped exclusive V-G29 scope")


def _validate_gate_partition(
    value: Mapping[str, object],
    field: str,
) -> bool:
    failures = require_list(value.get("gateFailures"), f"{field}.gateFailures")
    for failure in failures:
        require_str(failure, f"{field}.gateFailures[]")
    all_gates_pass = require_bool(value.get("allGatesPass"), f"{field}.allGatesPass")
    if all_gates_pass != (len(failures) == 0):
        raise ContractError(f"{field} gate state contradicts failure list")
    champion = require_mapping(value.get("champion"), f"{field}.champion")
    champion_trial_id = require_str(champion.get("trialId"), f"{field}.champion.trialId")
    if champion_trial_id not in {trial.trial_id for trial in trials()}:
        raise ContractError(f"{field} champion is outside frozen family")
    if field == "development":
        if value.get("championTrialId") != champion_trial_id:
            raise ContractError("development champion identifiers disagree")
        raw_trials = require_list(value.get("trials"), "development.trials")
        identities = [
            require_str(
                require_mapping(item, "development.trials[]").get("trialId"),
                "development.trials[].trialId",
            )
            for item in raw_trials
        ]
        expected = sorted(trial.trial_id for trial in trials())
        if identities != expected:
            raise ContractError("development trial evidence is not the exact frozen family")
    return all_gates_pass


def validate_evidence_chain() -> JsonObject:
    result = load_json(RESULT_PATH)
    if result.get("schema") != "VG29ResultV1":
        raise ContractError("result schema invalid")
    current_protocol_sha = sha256_path(PROTOCOL_PATH)
    current_source_sha = sha256_path(SOURCE_MANIFEST_PATH)
    current_freeze_sha = sha256_path(FREEZE_PATH)
    if result.get("protocolSha256") != current_protocol_sha:
        raise ContractError("result protocol binding invalid")
    if result.get("sourceManifestSha256") != current_source_sha:
        raise ContractError("result source binding invalid")
    if result.get("freezeSha256") != current_freeze_sha:
        raise ContractError("result freeze binding invalid")

    marker = load_json(RUN_MARKER_PATH)
    if marker.get("schema") != "VG29DevelopmentRunMarkerV1":
        raise ContractError("development marker schema invalid")
    if marker.get("protocolSha256") != current_protocol_sha:
        raise ContractError("development marker protocol binding invalid")
    if marker.get("sourceManifestSha256") != current_source_sha:
        raise ContractError("development marker source binding invalid")
    if marker.get("freezeSha256") != sha256_bytes(canonical_bytes(load_json(FREEZE_PATH))):
        raise ContractError("development marker freeze binding invalid")
    if marker.get("state") != "CONSUMED_BEFORE_FIRST_ARCHIVE_DECOMPRESSION":
        raise ContractError("development marker state invalid")
    if marker.get("maximumRunCount") != 1:
        raise ContractError("development marker run count invalid")
    if marker.get("archiveBodiesOpenedBeforeMarker") is not False:
        raise ContractError("development marker ordering invalid")
    if marker.get("holdoutArchiveBodiesOpened") is not False:
        raise ContractError("development marker pre-opens holdout")
    candidate = require_str(marker.get("candidateCommit"), "marker.candidateCommit")
    _validate_candidate_commit(candidate)
    external_marker_path = state_root() / "custody" / "development-run-marker.v1.json"
    if canonical_bytes(load_json(external_marker_path)) != canonical_bytes(marker):
        raise ContractError("external and packet development markers disagree")

    development_evidence: Mapping[str, object] | None = None
    development_evidence_payload: Mapping[str, object] | None = None
    if DEVELOPMENT_EVIDENCE_PATH.exists():
        development_evidence = load_json(DEVELOPMENT_EVIDENCE_PATH)
        if development_evidence.get("schema") != "VG29DevelopmentEvidenceV1":
            raise ContractError("development evidence schema invalid")
        if development_evidence.get("candidateCommit") != candidate:
            raise ContractError("development evidence candidate commit mismatch")
        if development_evidence.get("protocolSha256") != current_protocol_sha:
            raise ContractError("development evidence protocol binding invalid")
        if development_evidence.get("sourceManifestSha256") != current_source_sha:
            raise ContractError("development evidence source binding invalid")
        if development_evidence.get("freezeSha256") != current_freeze_sha:
            raise ContractError("development evidence freeze binding invalid")
        development_evidence_payload = require_mapping(
            development_evidence.get("development"),
            "developmentEvidence.development",
        )
        if development_evidence.get("developmentPayloadSha256") != sha256_bytes(
            canonical_bytes(development_evidence_payload)
        ):
            raise ContractError("development evidence payload binding invalid")
        _validate_gate_partition(development_evidence_payload, "development")

    custody = require_mapping(result.get("custody"), "result.custody")
    if (
        require_bool(custody.get("developmentRunConsumed"), "custody.developmentRunConsumed")
        is not True
    ):
        raise ContractError("result denies consumed development custody")
    verdict = require_str(result.get("verdict"), "result.verdict")
    if verdict not in {"GO", "NO_GO", "UNMEASURED"}:
        raise ContractError("result verdict invalid")
    if require_mapping(result.get("truth"), "result.truth") != _result_truth(verdict):
        raise ContractError("result truth boundary invalid")

    champion_exists = CHAMPION_SEAL_PATH.exists()
    holdout_exists = HOLDOUT_OPEN_PATH.exists()
    external_holdout_path = state_root() / "custody" / "holdout-open.v1.json"
    external_holdout_exists = external_holdout_path.exists()
    claimed_holdout_open = require_bool(custody.get("holdoutOpened"), "custody.holdoutOpened")
    if claimed_holdout_open != holdout_exists:
        raise ContractError("result holdout custody contradicts packet receipt")
    if holdout_exists != external_holdout_exists:
        raise ContractError("external and packet holdout receipt presence disagrees")

    if verdict == "UNMEASURED":
        if result.get("development") is not None or result.get("holdout") is not None:
            raise ContractError("UNMEASURED result contains numeric partition evidence")
        require_str(result.get("failure"), "result.failure")
        if result.get("state") != "TERMINAL_SINGLE_RUN_INVALID_NO_REPAIR_OR_RERUN":
            raise ContractError("UNMEASURED terminal state invalid")
        if holdout_exists and not champion_exists:
            raise ContractError("UNMEASURED holdout receipt lacks champion seal")
        if (champion_exists or holdout_exists) and development_evidence is None:
            raise ContractError("UNMEASURED holdout custody lacks development evidence")
    else:
        development = require_mapping(result.get("development"), "result.development")
        if development_evidence_payload is None:
            raise ContractError("measured result lacks standalone development evidence")
        if canonical_bytes(development) != canonical_bytes(development_evidence_payload):
            raise ContractError("result and standalone development evidence disagree")
        development_pass = _validate_gate_partition(development, "development")
        holdout_raw = result.get("holdout")
        if not development_pass:
            if verdict != "NO_GO" or holdout_raw is not None:
                raise ContractError("development failure did not terminate as NO_GO")
            if champion_exists or holdout_exists:
                raise ContractError("development failure has forbidden holdout artifacts")
            if result.get("state") != ("VALID_PUBLIC_DEVELOPMENT_MEASUREMENT_FAILED_FROZEN_GATES"):
                raise ContractError("development NO_GO state invalid")
        else:
            if not champion_exists or not holdout_exists:
                raise ContractError("passed development lacks sealed holdout custody")
            holdout = require_mapping(holdout_raw, "result.holdout")
            holdout_pass = _validate_gate_partition(holdout, "holdout")
            expected_verdict = "GO" if holdout_pass else "NO_GO"
            if verdict != expected_verdict:
                raise ContractError("holdout gates contradict verdict")
            expected_state = (
                "VALID_PUBLIC_PROXY_SCENARIO_PASSED_ALL_FROZEN_GATES_NO_CAPITAL_AUTHORITY"
                if holdout_pass
                else "VALID_PUBLIC_HOLDOUT_MEASUREMENT_FAILED_FROZEN_GATES"
            )
            if result.get("state") != expected_state:
                raise ContractError("holdout result state invalid")

    if champion_exists:
        champion = load_json(CHAMPION_SEAL_PATH)
        if champion.get("schema") != "VG29DevelopmentChampionV1":
            raise ContractError("development champion seal schema invalid")
        if champion.get("candidateCommit") != candidate:
            raise ContractError("champion and marker candidate commits disagree")
        if champion.get("protocolSha256") != current_protocol_sha:
            raise ContractError("champion protocol binding invalid")
        if champion.get("freezeSha256") != current_freeze_sha:
            raise ContractError("champion freeze binding invalid")
        if development_evidence is None or development_evidence_payload is None:
            raise ContractError("champion lacks standalone development evidence")
        if champion.get("developmentEvidenceSha256") != sha256_path(DEVELOPMENT_EVIDENCE_PATH):
            raise ContractError("champion development artifact binding invalid")
        if champion.get("developmentPayloadSha256") != sha256_bytes(
            canonical_bytes(development_evidence_payload)
        ):
            raise ContractError("champion development payload binding invalid")
        if _validate_gate_partition(development_evidence_payload, "development") is not True:
            raise ContractError("champion sealed development that failed gates")
        champion_trial_id = require_str(champion.get("championTrialId"), "champion.championTrialId")
        if verdict != "UNMEASURED":
            development = require_mapping(result.get("development"), "result.development")
            if development.get("championTrialId") != champion_trial_id:
                raise ContractError("champion seal trial identifier mismatch")
        elif development_evidence_payload.get("championTrialId") != champion_trial_id:
            raise ContractError("terminal champion trial identifier mismatch")
        if holdout_exists:
            receipt = load_json(HOLDOUT_OPEN_PATH)
            if receipt.get("schema") != "VG29HoldoutOpenV1":
                raise ContractError("holdout receipt schema invalid")
            if receipt.get("candidateCommit") != candidate:
                raise ContractError("holdout and marker candidate commits disagree")
            if receipt.get("championTrialId") != champion_trial_id:
                raise ContractError("holdout and champion trial identifiers disagree")
            if receipt.get("championSealSha256") != sha256_path(CHAMPION_SEAL_PATH):
                raise ContractError("holdout champion seal binding invalid")
            if receipt.get("maximumOpenCount") != 1:
                raise ContractError("holdout receipt open count invalid")
            if canonical_bytes(load_json(external_holdout_path)) != canonical_bytes(receipt):
                raise ContractError("external and packet holdout receipts disagree")
            if verdict != "UNMEASURED":
                holdout = require_mapping(result.get("holdout"), "result.holdout")
                holdout_champion = require_mapping(holdout.get("champion"), "holdout.champion")
                if holdout_champion.get("trialId") != champion_trial_id:
                    raise ContractError("holdout evidence trial identifier mismatch")
    return result


def _sealable_names() -> tuple[str, ...]:
    required = [
        *STATIC_FREEZE_NAMES,
        "freeze.v1.json",
        "development-run-marker.v1.json",
        "result.v1.json",
    ]
    optional = [
        "development-evidence.v1.json",
        "development-champion.v1.json",
        "holdout-open.v1.json",
    ]
    required.extend(name for name in optional if (HERE / name).exists())
    for name in required:
        if not (HERE / name).is_file():
            raise ContractError(f"sealable artifact missing: {name}")
    return tuple(sorted(required))


def verify_seal() -> None:
    if not SHA256SUMS_PATH.is_file():
        raise ContractError("SHA256SUMS is missing")
    entries: dict[str, str] = {}
    for line in SHA256SUMS_PATH.read_text(encoding="ascii").splitlines():
        match = re.fullmatch(r"([0-9a-f]{64})  ([A-Za-z0-9_.-]+)", line)
        if match is None:
            raise ContractError("SHA256SUMS line shape invalid")
        digest, name = match.groups()
        if name in entries:
            raise ContractError("SHA256SUMS contains duplicate filename")
        entries[name] = digest
    expected_names = set(_sealable_names())
    if set(entries) != expected_names:
        raise ContractError("SHA256SUMS artifact set mismatch")
    for name, expected in entries.items():
        if sha256_path(HERE / name) != expected:
            raise ContractError(f"sealed artifact digest mismatch: {name}")


def seal_packet() -> None:
    verify_freeze()
    validate_evidence_chain()
    if SHA256SUMS_PATH.exists():
        verify_seal()
        return
    lines = [f"{sha256_path(HERE / name)}  {name}" for name in _sealable_names()]
    write_bytes_once(SHA256SUMS_PATH, ("\n".join(lines) + "\n").encode("ascii"))
    verify_seal()


def report_packet() -> JsonObject:
    verify_freeze()
    verify_seal()
    return validate_evidence_chain()


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "command",
        choices=("acquire", "freeze", "run", "seal", "report"),
    )
    args = parser.parse_args(argv)
    try:
        if args.command == "acquire":
            value = acquire_sources()
        elif args.command == "freeze":
            value = freeze_packet()
        elif args.command == "run":
            value = run_once()
        elif args.command == "seal":
            seal_packet()
            value = report_packet()
        else:
            value = report_packet()
    except (ContractError, MeasurementError, OSError, subprocess.CalledProcessError) as exc:
        print(f"V-G29 ERROR: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 2
    print(canonical_bytes(value).decode("utf-8"), end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
