#!/usr/bin/env python3
"""Sealed public-only S-1N research lifecycle and evaluator."""

from __future__ import annotations

import argparse
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
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from collections import defaultdict
from collections.abc import Callable, Mapping, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from pathlib import Path
from statistics import median
from typing import Any, Final

MILESTONE: Final = "S-1N"
ROOT = Path(__file__).resolve().parent
PROTOCOL_PATH = ROOT / "protocol.v1.json"
OFFICIAL_SOURCES_PATH = ROOT / "official_sources.v1.json"
README_PATH = ROOT / "README.md"
TEST_PATH = ROOT / "test_experiment.py"
FREEZE_PATH = ROOT / "freeze.v1.json"
RESULT_PATH = ROOT / "result.v1.json"
DEFAULT_STATE_ROOT = Path("/private/tmp/cosmos-s1n-funding-dispersion-beta-matched-v1")
ARCHIVE_ROOT: Final = "https://data.binance.vision"
S3_ROOT: Final = "https://s3-ap-northeast-1.amazonaws.com/data.binance.vision"
HOUR_MS: Final = 3_600_000
DAY_MS: Final = 24 * HOUR_MS
MAX_ARCHIVE_BYTES: Final = 64 * 1024 * 1024
MAX_CSV_BYTES: Final = 256 * 1024 * 1024
MAX_SIDECAR_BYTES: Final = 4_096
NETWORK_ATTEMPTS: Final = 5
NETWORK_WORKERS: Final = 16
RAW_SYMBOL_RE = re.compile(r"^[A-Z0-9_]+$")
SYMBOL_RE = re.compile(r"^[A-Z0-9]+USDT$")
SHA_RE = re.compile(r"^[0-9a-f]{64}$")
MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
ZERO = Decimal("0")
ONE = Decimal("1")
TEN_THOUSAND = Decimal("10000")
EXCLUDED_BASE_ASSETS: Final = frozenset(
    {"BUSD", "DAI", "EUR", "FDUSD", "JPY", "TUSD", "TRY", "USD1", "USDC", "USDP"}
)

JsonObject = dict[str, Any]
Fetcher = Callable[[str], bytes]


class EvidenceError(RuntimeError):
    """Fail-closed evidence or lifecycle error."""


class EconomicGateFailure(EvidenceError):
    """Valid observation that cannot form the frozen portfolio."""


@dataclass(frozen=True)
class FundingEvent:
    time_ms: int
    interval_hours: Decimal
    rate: Decimal


@dataclass(frozen=True)
class Bar:
    open_time_ms: int
    open: Decimal
    close: Decimal
    quote_volume: Decimal


@dataclass(frozen=True)
class SymbolData:
    funding: tuple[FundingEvent, ...]
    bars: Mapping[int, Bar]
    marks: Mapping[int, Decimal]


@dataclass(frozen=True, order=True)
class Trial:
    trial_id: str
    lookback_hours: int
    dispersion_multiplier: Decimal
    hold_hours: int


@dataclass(frozen=True)
class Match:
    long_symbol: str
    short_symbol: str
    long_beta: Decimal
    short_beta: Decimal

    @property
    def absolute_gap(self) -> Decimal:
        return abs(self.long_beta - self.short_beta)


@dataclass(frozen=True)
class CostScenario:
    name: str
    fee_rate: Decimal
    adverse_rate: Decimal


@dataclass(frozen=True)
class Cohort:
    signal_time_ms: int
    entry_time_ms: int
    exit_time_ms: int
    base_net_usd: Decimal
    stress_net_usd: Decimal
    portfolio_beta_gap: Decimal
    maximum_pair_beta_gap: Decimal
    capacity_pass: bool


def canonical_bytes(value: object) -> bytes:
    return (
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
        + b"\n"
    )


def sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def load_json(path: Path) -> tuple[JsonObject, bytes]:
    raw = path.read_bytes()
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise EvidenceError(f"{path.name} must contain a JSON object")
    return value, raw


def exclusive_write(path: Path, raw: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
    except BaseException:
        path.unlink(missing_ok=True)
        raise


def decimal_value(raw: object, *, field: str, positive: bool = False) -> Decimal:
    if not isinstance(raw, (str, int)):
        raise EvidenceError(f"{field} must be a decimal string or integer")
    try:
        value = Decimal(str(raw))
    except InvalidOperation as error:
        raise EvidenceError(f"{field} is not decimal") from error
    if not value.is_finite() or (positive and value <= ZERO):
        raise EvidenceError(f"{field} is outside the allowed domain")
    return value


def parse_utc(value: str) -> int:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise EvidenceError(f"invalid UTC timestamp: {value}") from error
    if parsed.tzinfo != UTC:
        raise EvidenceError(f"timestamp must be UTC: {value}")
    return int(parsed.timestamp() * 1000)


def month_sequence(first: str, last: str) -> tuple[str, ...]:
    if not MONTH_RE.fullmatch(first) or not MONTH_RE.fullmatch(last):
        raise EvidenceError("invalid month")
    cursor = datetime.strptime(first, "%Y-%m").replace(tzinfo=UTC)
    end = datetime.strptime(last, "%Y-%m").replace(tzinfo=UTC)
    rows: list[str] = []
    while cursor <= end:
        rows.append(cursor.strftime("%Y-%m"))
        cursor = (cursor.replace(day=28) + timedelta(days=4)).replace(day=1)
    return tuple(rows)


def trial_family() -> tuple[Trial, ...]:
    rows = [
        Trial(
            trial_id=f"L{lookback:02d}_D{str(multiplier).replace('.', '')}_H{hold:02d}",
            lookback_hours=lookback,
            dispersion_multiplier=multiplier,
            hold_hours=hold,
        )
        for lookback, multiplier, hold in itertools.product(
            (24, 72), (Decimal("1.25"), Decimal("1.75")), (6, 12, 24)
        )
    ]
    return tuple(sorted(rows))


def scenarios() -> tuple[CostScenario, CostScenario]:
    return (
        CostScenario("base", Decimal("0.0005"), Decimal("0.0002")),
        CostScenario("stress", Decimal("0.0010"), Decimal("0.0005")),
    )


def fetch_bytes(url: str, *, timeout_seconds: int = 30) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "cosmos-s1n-public-research/1"})
    last_error: OSError | None = None
    for attempt in range(NETWORK_ATTEMPTS):
        try:
            with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
                raw = bytes(response.read(MAX_ARCHIVE_BYTES + 1))
            if len(raw) > MAX_ARCHIVE_BYTES:
                raise EvidenceError("public response exceeds byte cap")
            return raw
        except urllib.error.HTTPError:
            raise
        except (TimeoutError, urllib.error.URLError) as error:
            last_error = error
            if attempt + 1 < NETWORK_ATTEMPTS:
                time.sleep(min(0.25 * (2**attempt), 2.0))
    raise EvidenceError(f"public fetch exhausted retries: {last_error}")


def parse_checksum_sidecar(raw: bytes, *, expected_filename: str) -> str:
    try:
        text = raw.decode("ascii").strip()
    except UnicodeDecodeError as error:
        raise EvidenceError("checksum sidecar is not ASCII") from error
    fields = text.split()
    if len(fields) != 2 or fields[1].lstrip("*") != expected_filename:
        raise EvidenceError(f"checksum sidecar filename mismatch for {expected_filename}")
    digest = fields[0].lower()
    if not SHA_RE.fullmatch(digest):
        raise EvidenceError(f"invalid checksum for {expected_filename}")
    return digest


def archive_key(symbol: str, month: str, dataset: str) -> str:
    if dataset == "fundingRate":
        return f"data/futures/um/monthly/fundingRate/{symbol}/{symbol}-fundingRate-{month}.zip"
    if dataset == "klines_1h":
        return f"data/futures/um/monthly/klines/{symbol}/1h/{symbol}-1h-{month}.zip"
    if dataset == "markPriceKlines_1h":
        return f"data/futures/um/monthly/markPriceKlines/{symbol}/1h/{symbol}-1h-{month}.zip"
    raise EvidenceError(f"unknown dataset: {dataset}")


def list_june_funding_symbols(fetcher: Fetcher = fetch_bytes) -> tuple[str, ...]:
    prefix = "data/futures/um/monthly/fundingRate/"
    continuation: str | None = None
    keys: list[str] = []
    while True:
        query: dict[str, str] = {"list-type": "2", "prefix": prefix}
        if continuation is not None:
            query["continuation-token"] = continuation
        raw = fetcher(f"{S3_ROOT}?{urllib.parse.urlencode(query)}")
        try:
            root = ET.fromstring(raw)
        except ET.ParseError as error:
            raise EvidenceError("invalid S3 listing XML") from error
        namespace = {"s3": "http://s3.amazonaws.com/doc/2006-03-01/"}
        keys.extend(node.text or "" for node in root.findall(".//s3:Key", namespace))
        truncated = (root.findtext("s3:IsTruncated", default="false", namespaces=namespace)).lower()
        continuation = root.findtext("s3:NextContinuationToken", namespaces=namespace)
        if truncated != "true":
            break
        if not continuation:
            raise EvidenceError("truncated S3 listing omitted continuation token")
    suffix = "-fundingRate-2025-06.zip"
    symbols = {
        key.split("/")[-2] for key in keys if key.endswith(suffix) and len(key.split("/")) >= 2
    }
    invalid = sorted(symbol for symbol in symbols if RAW_SYMBOL_RE.fullmatch(symbol) is None)
    if invalid:
        raise EvidenceError(f"June funding listing contains invalid symbol: {invalid[0]}")
    rows = tuple(sorted(symbols))
    if len(rows) != 523:
        raise EvidenceError(f"June funding symbol count {len(rows)} != 523")
    return rows


def screen_eligible_symbol(symbol: str) -> bool:
    if SYMBOL_RE.fullmatch(symbol) is None or "_" in symbol:
        return False
    base = symbol.removesuffix("USDT")
    return base not in EXCLUDED_BASE_ASSETS


def sidecar_row(symbol: str, month: str, dataset: str, fetcher: Fetcher) -> JsonObject:
    key = archive_key(symbol, month, dataset)
    filename = key.rsplit("/", 1)[-1]
    checksum_url = f"{ARCHIVE_ROOT}/{key}.CHECKSUM"
    checksum_raw = fetcher(checksum_url)
    if len(checksum_raw) > MAX_SIDECAR_BYTES:
        raise EvidenceError(f"checksum sidecar too large for {filename}")
    return {
        "symbol": symbol,
        "month": month,
        "dataset": dataset,
        "key": key,
        "url": f"{ARCHIVE_ROOT}/{key}",
        "checksumUrl": checksum_url,
        "expectedSha256": parse_checksum_sidecar(checksum_raw, expected_filename=filename),
        "sidecarSha256": sha256_bytes(checksum_raw),
    }


def discover_sidecar(
    symbol: str,
    dataset: str,
    fetcher: Fetcher,
) -> tuple[str, str, JsonObject | None]:
    try:
        return (
            symbol,
            dataset,
            sidecar_row(
                symbol,
                "2025-06",
                dataset,
                fetcher,
            ),
        )
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
        return symbol, dataset, None


def discover(state_root: Path, fetcher: Fetcher = fetch_bytes) -> JsonObject:
    output = state_root / "discovery.v1.json"
    if output.exists():
        raise EvidenceError("discovery already exists")
    symbols = list_june_funding_symbols(fetcher)
    cells = [
        *((symbol, "fundingRate") for symbol in symbols),
        *((symbol, "klines_1h") for symbol in symbols),
    ]

    def worker(cell: tuple[str, str]) -> tuple[str, str, JsonObject | None]:
        symbol, dataset = cell
        return discover_sidecar(symbol, dataset, fetcher)

    with ThreadPoolExecutor(max_workers=NETWORK_WORKERS) as executor:
        discovered = list(executor.map(worker, cells))
    available_rows: list[JsonObject] = []
    missing_rows: list[JsonObject] = []
    for symbol, dataset, row in discovered:
        if row is None:
            key = archive_key(symbol, "2025-06", dataset)
            missing_rows.append(
                {
                    "symbol": symbol,
                    "dataset": dataset,
                    "month": "2025-06",
                    "checksumUrl": f"{ARCHIVE_ROOT}/{key}.CHECKSUM",
                    "reason": "HTTP_404",
                }
            )
        else:
            available_rows.append(row)
    result: JsonObject = {
        "schema": "cosmos.quant.research.s1n.discovery.v1",
        "protocolId": "s1n-usdm-funding-dispersion-beta-matched-continuation-v1",
        "symbolCount": len(symbols),
        "symbols": symbols,
        "screenSources": available_rows,
        "screenMissingSources": missing_rows,
        "stageOrder": ["FUNDING_ARCHIVE_LIST", "JUNE_SIDECAR_SCREEN"],
        "archiveBodiesDownloaded": False,
        "archiveBodiesOpened": False,
    }
    result["discoverySha256"] = sha256_bytes(canonical_bytes(result))
    exclusive_write(output, canonical_bytes(result))
    return result


def git_head() -> str:
    return subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


def tracked_inputs() -> Mapping[str, Path]:
    return {
        "README.md": README_PATH,
        "experiment.py": Path(__file__).resolve(),
        "official_sources.v1.json": OFFICIAL_SOURCES_PATH,
        "protocol.v1.json": PROTOCOL_PATH,
        "test_experiment.py": TEST_PATH,
    }


def freeze(state_root: Path) -> JsonObject:
    discovery, discovery_raw = load_json(state_root / "discovery.v1.json")
    if discovery.get("symbolCount") != 523 or discovery.get("archiveBodiesOpened") is not False:
        raise EvidenceError("discovery is not the frozen unopened 523-symbol screen")
    result: JsonObject = {
        "schema": "cosmos.quant.research.s1n.freeze.v1",
        "protocolId": "s1n-usdm-funding-dispersion-beta-matched-continuation-v1",
        "canonicalBaseCommit": "a169b123fb186d1943a75ad648552c4d95be1be1",
        "worktreeHeadAtFreeze": git_head(),
        "discoverySha256": sha256_bytes(discovery_raw),
        "trackedInputSha256": {
            name: sha256_file(path) for name, path in sorted(tracked_inputs().items())
        },
        "trialIds": [trial.trial_id for trial in trial_family()],
        "runtime": {
            "pythonImplementation": platform.python_implementation(),
            "pythonVersion": platform.python_version(),
            "pythonHexVersion": sys.hexversion,
            "platform": platform.platform(),
            "json": "CPYTHON_STDLIB_SORTED_COMPACT_UTF8",
            "decimal": "CPYTHON_DECIMAL",
            "rng": "PYTHON_RANDOM_MT19937",
        },
        "archiveBodiesDownloaded": False,
        "archiveBodiesOpened": False,
        "runCountAllowed": 1,
        "holdoutArchiveBodiesOpened": False,
    }
    exclusive_write(state_root / "freeze.candidate.json", canonical_bytes(result))
    return result


def seal_freeze(state_root: Path) -> JsonObject:
    candidate, candidate_raw = load_json(state_root / "freeze.candidate.json")
    discovery, discovery_raw = load_json(state_root / "discovery.v1.json")
    expected_inputs = candidate.get("trackedInputSha256")
    if (
        candidate.get("schema") != "cosmos.quant.research.s1n.freeze.v1"
        or candidate.get("canonicalBaseCommit") != "a169b123fb186d1943a75ad648552c4d95be1be1"
        or candidate.get("worktreeHeadAtFreeze") != "a169b123fb186d1943a75ad648552c4d95be1be1"
        or git_head() != "a169b123fb186d1943a75ad648552c4d95be1be1"
        or candidate.get("discoverySha256") != sha256_bytes(discovery_raw)
        or discovery.get("archiveBodiesOpened") is not False
        or not isinstance(expected_inputs, dict)
    ):
        raise EvidenceError("freeze candidate bindings invalid")
    for name, path in tracked_inputs().items():
        if expected_inputs.get(name) != sha256_file(path):
            raise EvidenceError(f"tracked input changed before freeze seal: {name}")
    exclusive_write(FREEZE_PATH, candidate_raw)
    return {
        "schema": "cosmos.quant.research.s1n.freeze-seal.v1",
        "freezeSha256": sha256_bytes(candidate_raw),
        "sealed": True,
    }


def verify_freeze(state_root: Path) -> JsonObject:
    freeze_value, freeze_raw = load_json(FREEZE_PATH)
    discovery, discovery_raw = load_json(state_root / "discovery.v1.json")
    if freeze_value.get("discoverySha256") != sha256_bytes(discovery_raw):
        raise EvidenceError("committed freeze discovery digest mismatch")
    expected = freeze_value.get("trackedInputSha256")
    if not isinstance(expected, dict):
        raise EvidenceError("freeze trackedInputSha256 missing")
    for name, path in tracked_inputs().items():
        if expected.get(name) != sha256_file(path):
            raise EvidenceError(f"tracked input changed after freeze: {name}")
    if discovery.get("symbolCount") != 523:
        raise EvidenceError("discovery symbol count changed")
    freeze_value["_sha256"] = sha256_bytes(freeze_raw)
    return freeze_value


def archive_local(root: Path, row: Mapping[str, object]) -> Path:
    key = row.get("key")
    if not isinstance(key, str):
        raise EvidenceError("source key missing")
    return root / key


def acquire_one(
    row: Mapping[str, object],
    destination_root: Path,
    fetcher: Fetcher,
) -> JsonObject:
    expected = row.get("expectedSha256")
    url = row.get("url")
    if not isinstance(expected, str) or not isinstance(url, str):
        raise EvidenceError("source row incomplete")
    destination = archive_local(destination_root, row)
    if destination.exists():
        observed = sha256_file(destination)
        if observed != expected:
            raise EvidenceError(f"existing archive checksum mismatch: {destination.name}")
        size = destination.stat().st_size
    else:
        raw = fetcher(url)
        if len(raw) > MAX_ARCHIVE_BYTES:
            raise EvidenceError(f"archive exceeds byte cap: {destination.name}")
        observed = sha256_bytes(raw)
        if observed != expected:
            raise EvidenceError(f"download checksum mismatch: {destination.name}")
        exclusive_write(destination, raw)
        size = len(raw)
    return {
        **row,
        "observedSha256": observed,
        "byteCount": size,
    }


def acquire_many(
    rows: Sequence[Mapping[str, object]],
    destination_root: Path,
    fetcher: Fetcher,
) -> list[JsonObject]:
    def worker(row: Mapping[str, object]) -> JsonObject:
        return acquire_one(row, destination_root, fetcher)

    with ThreadPoolExecutor(max_workers=NETWORK_WORKERS) as executor:
        return list(executor.map(worker, rows))


def archive_csv_rows(path: Path) -> list[list[str]]:
    if path.stat().st_size > MAX_ARCHIVE_BYTES:
        raise EvidenceError(f"archive exceeds byte cap: {path.name}")
    try:
        with zipfile.ZipFile(path) as archive:
            members = [name for name in archive.namelist() if not name.endswith("/")]
            if len(members) != 1 or not members[0].lower().endswith(".csv"):
                raise EvidenceError(f"{path.name} must contain exactly one CSV")
            if archive.getinfo(members[0]).file_size > MAX_CSV_BYTES:
                raise EvidenceError(f"archive CSV exceeds byte cap: {path.name}")
            raw = archive.read(members[0])
    except (OSError, zipfile.BadZipFile, RuntimeError) as error:
        raise EvidenceError(f"cannot open archive: {path.name}") from error
    try:
        return list(csv.reader(io.StringIO(raw.decode("utf-8-sig"), newline="")))
    except UnicodeDecodeError as error:
        raise EvidenceError(f"archive CSV is not UTF-8: {path.name}") from error


def parse_funding_rows(rows: Sequence[Sequence[str]], *, label: str) -> tuple[FundingEvent, ...]:
    if not rows:
        raise EvidenceError(f"{label} funding archive empty")
    header = [field.strip().lower() for field in rows[0]]
    required = ("calc_time", "funding_interval_hours", "last_funding_rate")
    if all(field in header for field in required):
        positions = tuple(header.index(field) for field in required)
        data_rows = rows[1:]
    else:
        if len(rows[0]) != 3:
            raise EvidenceError(f"{label} funding schema invalid")
        positions = (0, 1, 2)
        data_rows = rows
    parsed: list[FundingEvent] = []
    seen: set[int] = set()
    for index, row in enumerate(data_rows, 1):
        if len(row) <= max(positions):
            raise EvidenceError(f"{label} funding row {index} short")
        try:
            time_ms = int(row[positions[0]])
        except ValueError as error:
            raise EvidenceError(f"{label} funding time invalid") from error
        interval = decimal_value(row[positions[1]], field="funding_interval_hours", positive=True)
        rate = decimal_value(row[positions[2]], field="last_funding_rate")
        if time_ms in seen:
            raise EvidenceError(f"{label} duplicate funding time")
        seen.add(time_ms)
        parsed.append(FundingEvent(time_ms, interval, rate))
    if not parsed:
        raise EvidenceError(f"{label} funding archive has no observations")
    return tuple(sorted(parsed, key=lambda event: event.time_ms))


def parse_kline_rows(rows: Sequence[Sequence[str]], *, label: str) -> tuple[Bar, ...]:
    if not rows:
        raise EvidenceError(f"{label} kline archive empty")
    header = [field.strip().lower().replace(" ", "_") for field in rows[0]]
    has_header = "open_time" in header or "open_time" in "_".join(header)
    data_rows = rows[1:] if has_header else rows
    parsed: list[Bar] = []
    seen: set[int] = set()
    for index, row in enumerate(data_rows, 1):
        if len(row) < 8:
            raise EvidenceError(f"{label} kline row {index} short")
        try:
            open_time = int(row[0])
        except ValueError as error:
            raise EvidenceError(f"{label} kline time invalid") from error
        if open_time in seen or open_time % HOUR_MS != 0:
            raise EvidenceError(f"{label} duplicate or off-grid kline")
        seen.add(open_time)
        open_price = decimal_value(row[1], field="open", positive=True)
        close_price = decimal_value(row[4], field="close", positive=True)
        quote_volume = decimal_value(row[7], field="quote_volume")
        if quote_volume < ZERO:
            raise EvidenceError(f"{label} negative quote volume")
        parsed.append(Bar(open_time, open_price, close_price, quote_volume))
    if not parsed:
        raise EvidenceError(f"{label} kline archive has no observations")
    return tuple(sorted(parsed, key=lambda bar: bar.open_time_ms))


def expected_hourly_times(month: str) -> tuple[int, ...]:
    start = datetime.strptime(month, "%Y-%m").replace(tzinfo=UTC)
    end = (start.replace(day=28) + timedelta(days=4)).replace(day=1)
    return tuple(
        range(
            int(start.timestamp() * 1_000),
            int(end.timestamp() * 1_000),
            HOUR_MS,
        )
    )


def require_complete_monthly_hours(
    bars: Sequence[Bar],
    *,
    month: str,
    label: str,
) -> None:
    observed = tuple(bar.open_time_ms for bar in bars)
    expected = expected_hourly_times(month)
    if observed != expected:
        raise EvidenceError(f"{label} hourly grid incomplete: {len(observed)} != {len(expected)}")


def reconstruct_screen_evidence(
    state_root: Path,
    discovery: Mapping[str, object],
) -> tuple[list[JsonObject], list[JsonObject], list[JsonObject]]:
    sources = discovery.get("screenSources")
    symbols = discovery.get("symbols")
    if not isinstance(sources, list) or not isinstance(symbols, list):
        raise EvidenceError("discovery screen inventory missing")
    by_symbol: dict[str, dict[str, Mapping[str, object]]] = defaultdict(dict)
    screen_manifest: list[JsonObject] = []
    for raw_row in sources:
        if not isinstance(raw_row, dict):
            raise EvidenceError("screen source row malformed")
        expected = raw_row.get("expectedSha256")
        path = archive_local(state_root / "screen-archives", raw_row)
        if not isinstance(expected, str) or not path.is_file() or sha256_file(path) != expected:
            raise EvidenceError(f"screen archive custody invalid: {path.name}")
        observed: JsonObject = {
            **raw_row,
            "observedSha256": expected,
            "byteCount": path.stat().st_size,
        }
        screen_manifest.append(observed)
        symbol = observed.get("symbol")
        dataset = observed.get("dataset")
        if not isinstance(symbol, str) or not isinstance(dataset, str):
            raise EvidenceError("screen source identity missing")
        by_symbol[symbol][dataset] = observed
    volumes: list[tuple[Decimal, str]] = []
    exclusions: list[JsonObject] = []
    for raw_symbol in symbols:
        if not isinstance(raw_symbol, str):
            raise EvidenceError("discovery symbol malformed")
        symbol_sources = by_symbol.get(raw_symbol, {})
        if set(symbol_sources) != {"fundingRate", "klines_1h"}:
            missing = sorted({"fundingRate", "klines_1h"} - set(symbol_sources))
            exclusions.append(
                {
                    "symbol": raw_symbol,
                    "reason": f"SCREEN_SOURCE_MISSING:{','.join(missing)}",
                }
            )
            continue
        funding_path = archive_local(
            state_root / "screen-archives",
            symbol_sources["fundingRate"],
        )
        kline_path = archive_local(
            state_root / "screen-archives",
            symbol_sources["klines_1h"],
        )
        try:
            parse_funding_rows(archive_csv_rows(funding_path), label=raw_symbol)
            bars = parse_kline_rows(archive_csv_rows(kline_path), label=raw_symbol)
            require_complete_monthly_hours(
                bars,
                month="2025-06",
                label=f"{raw_symbol} screen",
            )
        except EvidenceError as error:
            exclusions.append({"symbol": raw_symbol, "reason": str(error)})
            continue
        if screen_eligible_symbol(raw_symbol):
            volumes.append((sum((bar.quote_volume for bar in bars), ZERO), raw_symbol))
    ranked = sorted(volumes, key=lambda row: (-row[0], row[1]))
    ranking = [
        {"rank": index + 1, "symbol": symbol, "juneQuoteVolume": str(volume)}
        for index, (volume, symbol) in enumerate(ranked)
    ]
    return screen_manifest, ranking, exclusions


def screen(state_root: Path, fetcher: Fetcher = fetch_bytes) -> JsonObject:
    freeze_value = verify_freeze(state_root)
    discovery, _ = load_json(state_root / "discovery.v1.json")
    sources = discovery.get("screenSources")
    symbols = discovery.get("symbols")
    if not isinstance(sources, list) or not isinstance(symbols, list):
        raise EvidenceError("discovery screen inventory missing")
    screen_rows: list[Mapping[str, object]] = []
    for raw_row in sources:
        if not isinstance(raw_row, dict):
            raise EvidenceError("screen source row malformed")
        screen_rows.append(raw_row)
    acquire_many(screen_rows, state_root / "screen-archives", fetcher)
    screen_manifest, ranking, screen_exclusions = reconstruct_screen_evidence(
        state_root,
        discovery,
    )
    selected = [str(row["symbol"]) for row in ranking[:30]]
    if len(selected) != 30 or len(set(selected)) != 30:
        raise EvidenceError("top-30 selection is not exact and unique")
    result: JsonObject = {
        "schema": "cosmos.quant.research.s1n.selection.v1",
        "protocolId": freeze_value.get("protocolId"),
        "freezeSha256": freeze_value["_sha256"],
        "screenSymbolCount": len(symbols),
        "screenArtifactCount": len(screen_manifest),
        "screenManifestSha256": sha256_bytes(canonical_bytes(screen_manifest)),
        "screenExclusions": screen_exclusions,
        "ranking": ranking,
        "selectedSymbols": selected,
        "selectedCount": 30,
        "replacement": "FORBIDDEN",
        "outcomeArchiveBodiesOpened": False,
    }
    result["selectionSha256"] = sha256_bytes(canonical_bytes(result))
    exclusive_write(state_root / "selection.v1.json", canonical_bytes(result))
    return result


def verify_selection(
    state_root: Path,
    *,
    freeze_sha256: str,
) -> tuple[JsonObject, bytes]:
    selection, selection_raw = load_json(state_root / "selection.v1.json")
    freeze_value, freeze_raw = load_json(FREEZE_PATH)
    discovery, discovery_raw = load_json(state_root / "discovery.v1.json")
    screen_manifest, reconstructed_ranking, reconstructed_exclusions = reconstruct_screen_evidence(
        state_root, discovery
    )
    ranking = selection.get("ranking")
    selected = selection.get("selectedSymbols")
    unsigned = {key: value for key, value in selection.items() if key != "selectionSha256"}
    if (
        selection.get("schema") != "cosmos.quant.research.s1n.selection.v1"
        or selection.get("freezeSha256") != freeze_sha256
        or sha256_bytes(freeze_raw) != freeze_sha256
        or freeze_value.get("discoverySha256") != sha256_bytes(discovery_raw)
        or selection.get("screenSymbolCount") != discovery.get("symbolCount")
        or selection.get("screenArtifactCount") != len(screen_manifest)
        or selection.get("screenManifestSha256") != sha256_bytes(canonical_bytes(screen_manifest))
        or ranking != reconstructed_ranking
        or selection.get("screenExclusions") != reconstructed_exclusions
        or selection.get("selectedCount") != 30
        or selection.get("replacement") != "FORBIDDEN"
        or selection.get("selectionSha256") != sha256_bytes(canonical_bytes(unsigned))
        or not isinstance(ranking, list)
        or not isinstance(selected, list)
        or len(selected) != 30
        or len(set(selected)) != 30
        or not all(isinstance(symbol, str) for symbol in selected)
    ):
        raise EvidenceError("selection seal invalid")
    ranked_symbols: list[str] = []
    for expected_rank, row in enumerate(ranking, 1):
        if (
            not isinstance(row, dict)
            or row.get("rank") != expected_rank
            or not isinstance(row.get("symbol"), str)
        ):
            raise EvidenceError("selection ranking invalid")
        ranked_symbols.append(str(row["symbol"]))
    if len(set(ranked_symbols)) != len(ranked_symbols) or selected != ranked_symbols[:30]:
        raise EvidenceError("selected symbols do not match frozen top-30 ranking")
    return selection, selection_raw


def selected_source_rows(symbols: Sequence[str], fetcher: Fetcher) -> list[JsonObject]:
    cells = list(
        itertools.product(
            sorted(symbols),
            month_sequence("2025-06", "2026-06"),
            ("fundingRate", "klines_1h", "markPriceKlines_1h"),
        )
    )

    def worker(cell: tuple[str, str, str]) -> JsonObject:
        symbol, month, dataset = cell
        return sidecar_row(symbol, month, dataset, fetcher)

    with ThreadPoolExecutor(max_workers=NETWORK_WORKERS) as executor:
        rows = list(executor.map(worker, cells))
    if len(rows) != 1170:
        raise EvidenceError("selected archive Cartesian is not 1170")
    return rows


def acquire(state_root: Path, fetcher: Fetcher = fetch_bytes) -> JsonObject:
    freeze_value = verify_freeze(state_root)
    selection, selection_raw = verify_selection(
        state_root,
        freeze_sha256=str(freeze_value["_sha256"]),
    )
    symbols = selection.get("selectedSymbols")
    if (
        not isinstance(symbols, list)
        or len(symbols) != 30
        or not all(isinstance(symbol, str) for symbol in symbols)
    ):
        raise EvidenceError("selection seal invalid")
    rows = selected_source_rows(symbols, fetcher)
    development_rows = [row for row in rows if row["month"] < "2026-04"]
    downloaded = acquire_many(
        development_rows,
        state_root / "selected-archives",
        fetcher,
    )
    downloaded_by_key = {str(row["key"]): row for row in downloaded}
    observed: list[JsonObject] = []
    for row in rows:
        month = row["month"]
        if month >= "2026-04":
            observed.append({**row, "bodyState": "HOLDOUT_NOT_FETCHED"})
        else:
            acquired = downloaded_by_key.get(str(row["key"]))
            if acquired is None:
                raise EvidenceError("development archive download set incomplete")
            observed.append(
                {
                    **acquired,
                    "bodyState": "CHECKSUM_VERIFIED",
                }
            )
    result: JsonObject = {
        "schema": "cosmos.quant.research.s1n.archive-manifest.v1",
        "freezeSha256": freeze_value["_sha256"],
        "selectionSha256": sha256_bytes(selection_raw),
        "sourceCount": len(observed),
        "sources": observed,
        "developmentBodyCount": sum(
            row.get("bodyState") == "CHECKSUM_VERIFIED" for row in observed
        ),
        "holdoutBodyCount": 0,
        "archiveBodiesOpened": False,
        "holdoutArchiveBodiesOpened": False,
    }
    result["manifestSha256"] = sha256_bytes(canonical_bytes(result))
    exclusive_write(state_root / "archive-manifest.v1.json", canonical_bytes(result))
    return result


def verify_manifest(
    state_root: Path,
    *,
    holdout_fetched: bool = False,
    freeze_sha256: str | None = None,
) -> tuple[JsonObject, str]:
    manifest, raw = load_json(state_root / "archive-manifest.v1.json")
    manifest_freeze_sha256 = manifest.get("freezeSha256")
    if not isinstance(manifest_freeze_sha256, str):
        raise EvidenceError("selected manifest freeze binding missing")
    if freeze_sha256 is not None and manifest_freeze_sha256 != freeze_sha256:
        raise EvidenceError("selected manifest does not bind active freeze")
    selection, selection_raw = verify_selection(
        state_root,
        freeze_sha256=manifest_freeze_sha256,
    )
    selected_symbols = selection.get("selectedSymbols")
    if not isinstance(selected_symbols, list):
        raise EvidenceError("selection symbols missing")
    sources = manifest.get("sources")
    if (
        manifest.get("sourceCount") != 1170
        or manifest.get("selectionSha256") != sha256_bytes(selection_raw)
        or not isinstance(sources, list)
    ):
        raise EvidenceError("selected manifest is not the frozen 1170-source Cartesian")
    identities: set[tuple[str, str, str]] = set()
    for row in sources:
        if not isinstance(row, dict):
            raise EvidenceError("manifest source row malformed")
        expected = row.get("expectedSha256")
        observed = row.get("observedSha256")
        symbol = row.get("symbol")
        month = row.get("month")
        dataset = row.get("dataset")
        if (
            not isinstance(symbol, str)
            or not isinstance(month, str)
            or not isinstance(dataset, str)
        ):
            raise EvidenceError("manifest identity malformed")
        identity = (symbol, month, dataset)
        if identity in identities:
            raise EvidenceError("duplicate selected source identity")
        identities.add(identity)
        body_state = row.get("bodyState")
        path = archive_local(state_root / "selected-archives", row)
        if month >= "2026-04":
            if body_state != "HOLDOUT_NOT_FETCHED" or (path.exists() and not holdout_fetched):
                raise EvidenceError(f"holdout archive fetched before development pass: {path.name}")
        elif (
            body_state != "CHECKSUM_VERIFIED"
            or expected != observed
            or not path.is_file()
            or sha256_file(path) != expected
        ):
            raise EvidenceError(f"selected archive custody invalid: {path.name}")
    expected_identities = set(
        itertools.product(
            selected_symbols,
            month_sequence("2025-06", "2026-06"),
            ("fundingRate", "klines_1h", "markPriceKlines_1h"),
        )
    )
    if identities != expected_identities:
        raise EvidenceError("selected manifest identities differ from frozen Cartesian")
    return manifest, sha256_bytes(raw)


def acquire_holdout(state_root: Path, fetcher: Fetcher = fetch_bytes) -> JsonObject:
    freeze_value = verify_freeze(state_root)
    run_marker, run_marker_raw = load_json(state_root / "RUN_STARTED.json")
    candidate, candidate_raw = load_json(state_root / "candidate-seal.v1.json")
    authorization, authorization_raw = load_json(state_root / "HOLDOUT_ACQUISITION_AUTHORIZED.json")
    manifest, manifest_sha256 = verify_manifest(
        state_root,
        freeze_sha256=str(freeze_value["_sha256"]),
    )
    if (
        candidate.get("developmentPassed") is not True
        or candidate.get("freezeSha256") != freeze_value["_sha256"]
        or candidate.get("manifestSha256") != manifest_sha256
        or candidate.get("evaluatorSha256") != sha256_file(Path(__file__).resolve())
        or candidate.get("runMarkerSha256") != sha256_bytes(run_marker_raw)
        or run_marker.get("freezeSha256") != candidate.get("freezeSha256")
        or run_marker.get("manifestSha256") != candidate.get("manifestSha256")
        or run_marker.get("evaluatorSha256") != candidate.get("evaluatorSha256")
        or run_marker.get("runCount") != 1
        or authorization.get("candidateSealSha256") != sha256_bytes(candidate_raw)
        or authorization.get("manifestSha256") != manifest_sha256
    ):
        raise EvidenceError("holdout acquisition bindings invalid")
    sources = manifest.get("sources")
    if not isinstance(sources, list):
        raise EvidenceError("selected source manifest missing")
    predeclared_rows: list[Mapping[str, object]] = []
    for row in sources:
        if not isinstance(row, dict) or row.get("month", "") < "2026-04":
            continue
        if row.get("bodyState") != "HOLDOUT_NOT_FETCHED":
            raise EvidenceError("holdout source was not predeclared as unfetched")
        predeclared_rows.append(row)
    if len(predeclared_rows) != 270:
        raise EvidenceError(f"holdout source count {len(predeclared_rows)} != 270")
    holdout_rows = [
        {
            **row,
            "bodyState": "CHECKSUM_VERIFIED_AFTER_DEVELOPMENT_PASS",
        }
        for row in acquire_many(
            predeclared_rows,
            state_root / "selected-archives",
            fetcher,
        )
    ]
    result: JsonObject = {
        "schema": "cosmos.quant.research.s1n.holdout-acquisition.v1",
        "authorizationSha256": sha256_bytes(authorization_raw),
        "candidateSealSha256": sha256_bytes(candidate_raw),
        "sourceCount": len(holdout_rows),
        "sources": holdout_rows,
        "archiveBodiesOpened": False,
    }
    result["holdoutManifestSha256"] = sha256_bytes(canonical_bytes(result))
    exclusive_write(state_root / "holdout-manifest.v1.json", canonical_bytes(result))
    return result


def source_index(
    manifest: Mapping[str, object],
) -> dict[tuple[str, str, str], Mapping[str, object]]:
    raw_sources = manifest.get("sources")
    if not isinstance(raw_sources, list):
        raise EvidenceError("manifest sources missing")
    index: dict[tuple[str, str, str], Mapping[str, object]] = {}
    for row in raw_sources:
        if not isinstance(row, dict):
            raise EvidenceError("manifest row malformed")
        symbol, month, dataset = row.get("symbol"), row.get("month"), row.get("dataset")
        if (
            not isinstance(symbol, str)
            or not isinstance(month, str)
            or not isinstance(dataset, str)
        ):
            raise EvidenceError("manifest row identity malformed")
        index[(symbol, month, dataset)] = row
    return index


def load_partition_data(
    state_root: Path,
    *,
    start_ms: int,
    end_ms: int,
    holdout: bool,
) -> dict[str, SymbolData]:
    manifest, _ = load_json(state_root / "archive-manifest.v1.json")
    index = source_index(manifest)
    if holdout:
        holdout_manifest, _ = load_json(state_root / "holdout-manifest.v1.json")
        index.update(source_index(holdout_manifest))
    selection, _ = load_json(state_root / "selection.v1.json")
    raw_symbols = selection.get("selectedSymbols")
    if not isinstance(raw_symbols, list) or not all(
        isinstance(symbol, str) for symbol in raw_symbols
    ):
        raise EvidenceError("selected symbols missing")
    warmup_start = start_ms - 30 * DAY_MS
    first_month = datetime.fromtimestamp(warmup_start / 1000, tz=UTC).strftime("%Y-%m")
    final_month = datetime.fromtimestamp((end_ms - 1) / 1000, tz=UTC).strftime("%Y-%m")
    months = month_sequence(first_month, final_month)
    output: dict[str, SymbolData] = {}
    for symbol in raw_symbols:
        funding: list[FundingEvent] = []
        bars: dict[int, Bar] = {}
        marks: dict[int, Decimal] = {}
        for month in months:
            funding_row = index.get((symbol, month, "fundingRate"))
            kline_row = index.get((symbol, month, "klines_1h"))
            mark_row = index.get((symbol, month, "markPriceKlines_1h"))
            if funding_row is None or kline_row is None or mark_row is None:
                raise EvidenceError(f"partition Cartesian missing: {symbol} {month}")
            funding.extend(
                parse_funding_rows(
                    archive_csv_rows(archive_local(state_root / "selected-archives", funding_row)),
                    label=f"{symbol} {month}",
                )
            )
            parsed_bars = parse_kline_rows(
                archive_csv_rows(archive_local(state_root / "selected-archives", kline_row)),
                label=f"{symbol} {month}",
            )
            require_complete_monthly_hours(
                parsed_bars,
                month=month,
                label=f"{symbol} {month} contract",
            )
            for bar in parsed_bars:
                if bar.open_time_ms in bars:
                    raise EvidenceError(f"duplicate cross-month kline: {symbol}")
                bars[bar.open_time_ms] = bar
            parsed_marks = parse_kline_rows(
                archive_csv_rows(archive_local(state_root / "selected-archives", mark_row)),
                label=f"{symbol} {month} mark",
            )
            require_complete_monthly_hours(
                parsed_marks,
                month=month,
                label=f"{symbol} {month} mark",
            )
            for mark in parsed_marks:
                if mark.open_time_ms in marks:
                    raise EvidenceError(f"duplicate cross-month mark: {symbol}")
                marks[mark.open_time_ms] = mark.open
        output[symbol] = SymbolData(
            tuple(sorted(funding, key=lambda event: event.time_ms)), bars, marks
        )
    return output


def funding_score(
    events: Sequence[FundingEvent],
    *,
    signal_time_ms: int,
    lookback_hours: int,
) -> Decimal:
    start_ms = signal_time_ms - lookback_hours * HOUR_MS
    window = [event for event in events if start_ms <= event.time_ms < signal_time_ms]
    if not window:
        raise EvidenceError("funding signal window empty")
    tolerance_ms = 15_000
    first_interval_ms = int(window[0].interval_hours * HOUR_MS)
    last_interval_ms = int(window[-1].interval_hours * HOUR_MS)
    if (
        window[0].time_ms > start_ms + first_interval_ms + tolerance_ms
        or window[-1].time_ms < signal_time_ms - last_interval_ms - tolerance_ms
    ):
        raise EvidenceError("funding signal edge coverage incomplete")
    for previous, current in itertools.pairwise(window):
        maximum_gap = int(max(previous.interval_hours, current.interval_hours) * HOUR_MS)
        if current.time_ms - previous.time_ms > maximum_gap + tolerance_ms:
            raise EvidenceError("funding signal interval coverage incomplete")
    total_hours = sum((event.interval_hours for event in window), ZERO)
    if total_hours <= ZERO:
        raise EvidenceError("funding interval total invalid")
    return (
        sum(
            (event.rate * Decimal(24) for event in window),
            ZERO,
        )
        / total_hours
    )


def cross_sectional_scores(
    data: Mapping[str, SymbolData],
    *,
    signal_time_ms: int,
    lookback_hours: int,
) -> dict[str, Decimal]:
    scores: dict[str, Decimal] = {}
    for symbol, symbol_data in sorted(data.items()):
        try:
            scores[symbol] = funding_score(
                symbol_data.funding,
                signal_time_ms=signal_time_ms,
                lookback_hours=lookback_hours,
            )
        except EvidenceError:
            # Causal score unavailability removes only this symbol. The frozen
            # 20-symbol floor is applied before any tail is selected.
            continue
    return scores


def dispersion(scores: Sequence[Decimal]) -> Decimal:
    if len(scores) < 2:
        raise EvidenceError("dispersion needs at least two scores")
    center = median(scores)
    return median([abs(value - center) for value in scores])


def select_atomic_tails(
    scores: Mapping[str, Decimal],
    *,
    tail_fraction: Decimal = Decimal("0.2"),
    minimum: int = 4,
) -> tuple[tuple[str, ...], tuple[str, ...]]:
    target = int(Decimal(len(scores)) * tail_fraction)
    if target < minimum:
        raise EconomicGateFailure("tail target below minimum")

    def take(groups: Sequence[tuple[Decimal, tuple[str, ...]]]) -> tuple[str, ...]:
        selected: list[str] = []
        for _, symbols in groups:
            if len(selected) + len(symbols) > target:
                break
            selected.extend(symbols)
        if len(selected) < minimum:
            raise EconomicGateFailure("atomic boundary tie leaves tail below minimum")
        return tuple(sorted(selected))

    grouped: dict[Decimal, list[str]] = defaultdict(list)
    for symbol, score in scores.items():
        grouped[score].append(symbol)
    ascending = sorted((score, tuple(sorted(symbols))) for score, symbols in grouped.items())
    low = take(ascending)
    high = take(list(reversed(ascending)))
    if set(low) & set(high):
        raise EconomicGateFailure("funding tails overlap")
    return high, low


def log_returns(
    bars: Mapping[int, Bar],
    *,
    start_ms: int,
    end_ms: int,
) -> dict[int, float]:
    times = sorted(time for time in bars if start_ms <= time < end_ms)
    output: dict[int, float] = {}
    for previous_time, current_time in itertools.pairwise(times):
        if current_time - previous_time != HOUR_MS:
            continue
        previous = float(bars[previous_time].close)
        current = float(bars[current_time].close)
        output[current_time] = math.log(current / previous)
    return output


def beta_to_btc(
    symbol_bars: Mapping[int, Bar],
    btc_bars: Mapping[int, Bar],
    *,
    signal_time_ms: int,
    lookback_hours: int = 720,
    minimum_returns: int = 600,
) -> Decimal:
    start_ms = signal_time_ms - lookback_hours * HOUR_MS
    symbol_returns = log_returns(symbol_bars, start_ms=start_ms, end_ms=signal_time_ms)
    btc_returns = log_returns(btc_bars, start_ms=start_ms, end_ms=signal_time_ms)
    times = sorted(set(symbol_returns) & set(btc_returns))
    if len(times) < minimum_returns:
        raise EvidenceError("beta paired-return floor not met")
    x = [btc_returns[time] for time in times]
    y = [symbol_returns[time] for time in times]
    mean_x = sum(x) / len(x)
    mean_y = sum(y) / len(y)
    variance = sum((value - mean_x) ** 2 for value in x)
    if variance <= 0 or not math.isfinite(variance):
        raise EvidenceError("BTC beta variance unavailable")
    covariance = sum((left - mean_x) * (right - mean_y) for left, right in zip(x, y, strict=True))
    value = covariance / variance
    if not math.isfinite(value):
        raise EvidenceError("beta is non-finite")
    return Decimal(str(value))


def optimal_beta_matches(
    long_symbols: Sequence[str],
    short_symbols: Sequence[str],
    betas: Mapping[str, Decimal],
) -> tuple[Match, ...]:
    if len(long_symbols) != len(short_symbols) or not long_symbols:
        raise EvidenceError("beta matching requires equal nonempty tails")
    ordered_long = tuple(sorted(long_symbols))
    ordered_short = tuple(sorted(short_symbols))
    best_key: tuple[Decimal, tuple[str, ...]] | None = None
    best: tuple[Match, ...] | None = None
    for permutation in itertools.permutations(ordered_short):
        matches = tuple(
            Match(long_symbol, short_symbol, betas[long_symbol], betas[short_symbol])
            for long_symbol, short_symbol in zip(ordered_long, permutation, strict=True)
        )
        key = (sum((match.absolute_gap for match in matches), ZERO), permutation)
        if best_key is None or key < best_key:
            best_key = key
            best = matches
    if best is None:
        raise EvidenceError("beta matching produced no assignment")
    return best


def funding_cashflow(
    symbol_data: SymbolData,
    *,
    position_sign: int,
    quantity: Decimal,
    entry_time_ms: int,
    exit_time_ms: int,
) -> Decimal:
    total = ZERO
    for event in symbol_data.funding:
        if not entry_time_ms < event.time_ms < exit_time_ms:
            continue
        mark_time = event.time_ms - (event.time_ms % HOUR_MS)
        mark = symbol_data.marks.get(mark_time)
        if mark is None or mark <= ZERO:
            raise EvidenceError("funding settlement mark proxy missing")
        total -= Decimal(position_sign) * quantity * mark * event.rate
    return total


def leg_net(
    symbol_data: SymbolData,
    *,
    position_sign: int,
    notional: Decimal,
    entry_time_ms: int,
    exit_time_ms: int,
    scenario: CostScenario,
) -> Decimal:
    entry_bar = symbol_data.bars.get(entry_time_ms)
    exit_bar = symbol_data.bars.get(exit_time_ms)
    if entry_bar is None or exit_bar is None:
        raise EvidenceError("entry or exit kline missing")
    entry_multiplier = ONE + scenario.adverse_rate * Decimal(position_sign)
    exit_multiplier = ONE - scenario.adverse_rate * Decimal(position_sign)
    entry_fill = entry_bar.open * entry_multiplier
    exit_fill = exit_bar.open * exit_multiplier
    if entry_fill <= ZERO or exit_fill <= ZERO:
        raise EvidenceError("adverse fill invalid")
    quantity = notional / entry_fill
    price_pnl = Decimal(position_sign) * quantity * (exit_fill - entry_fill)
    fees = scenario.fee_rate * quantity * (entry_fill + exit_fill)
    funding = funding_cashflow(
        symbol_data,
        position_sign=position_sign,
        quantity=quantity,
        entry_time_ms=entry_time_ms,
        exit_time_ms=exit_time_ms,
    )
    return price_pnl + funding - fees


def capacity_pass(
    symbol_data: SymbolData,
    *,
    signal_time_ms: int,
    leg_notional: Decimal,
) -> bool:
    start_ms = signal_time_ms - DAY_MS
    bars = [bar for time, bar in symbol_data.bars.items() if start_ms <= time < signal_time_ms]
    if len(bars) != 24:
        raise EvidenceError("capacity history is not 24 complete hourly bars")
    return leg_notional <= sum((bar.quote_volume for bar in bars), ZERO) / TEN_THOUSAND


def simulate_cohort(
    data: Mapping[str, SymbolData],
    *,
    matches: Sequence[Match],
    signal_time_ms: int,
    hold_hours: int,
) -> Cohort:
    if not matches:
        raise EvidenceError("cohort has no matched pairs")
    entry_time = signal_time_ms + HOUR_MS
    exit_time = entry_time + hold_hours * HOUR_MS
    leg_notional = Decimal("500") / Decimal(len(matches))
    scenario_values: dict[str, Decimal] = {}
    all_capacity = True
    for scenario in scenarios():
        net = ZERO
        for match in matches:
            net += leg_net(
                data[match.long_symbol],
                position_sign=1,
                notional=leg_notional,
                entry_time_ms=entry_time,
                exit_time_ms=exit_time,
                scenario=scenario,
            )
            net += leg_net(
                data[match.short_symbol],
                position_sign=-1,
                notional=leg_notional,
                entry_time_ms=entry_time,
                exit_time_ms=exit_time,
                scenario=scenario,
            )
            all_capacity &= capacity_pass(
                data[match.long_symbol],
                signal_time_ms=signal_time_ms,
                leg_notional=leg_notional,
            )
            all_capacity &= capacity_pass(
                data[match.short_symbol],
                signal_time_ms=signal_time_ms,
                leg_notional=leg_notional,
            )
        scenario_values[scenario.name] = net
    portfolio_gap = abs(
        sum((match.long_beta for match in matches), ZERO) / Decimal(len(matches))
        - sum((match.short_beta for match in matches), ZERO) / Decimal(len(matches))
    )
    return Cohort(
        signal_time_ms,
        entry_time,
        exit_time,
        scenario_values["base"],
        scenario_values["stress"],
        portfolio_gap,
        max(match.absolute_gap for match in matches),
        all_capacity,
    )


def schedule(start_ms: int, end_ms: int, hold_hours: int) -> tuple[int, ...]:
    step = hold_hours * HOUR_MS
    rows: list[int] = []
    signal_time = start_ms
    while signal_time + HOUR_MS + step <= end_ms:
        rows.append(signal_time)
        signal_time += step
    return tuple(rows)


def circular_block_indices(
    length: int,
    *,
    rng: random.Random,
    block_days: int = 7,
) -> tuple[int, ...]:
    if length <= 0 or block_days <= 0:
        raise EvidenceError("circular block dimensions invalid")
    indices: list[int] = []
    while len(indices) < length:
        start = rng.randrange(length)
        indices.extend((start + offset) % length for offset in range(block_days))
    return tuple(indices[:length])


def bootstrap_lower(values: Sequence[Decimal], *, seed: int, replicates: int = 2048) -> Decimal:
    if not values:
        raise EvidenceError("bootstrap series empty")
    rng = random.Random(seed)
    count = len(values)
    block = min(7, count)
    means: list[Decimal] = []
    for _ in range(replicates):
        indices = circular_block_indices(count, rng=rng, block_days=block)
        means.append(sum((values[index] for index in indices), ZERO) / Decimal(count))
    means.sort()
    return means[max(0, int(Decimal("0.05") * Decimal(replicates)) - 1)]


def trial_metrics(cohorts: Sequence[Cohort], invalid_signals: int, trial: Trial) -> JsonObject:
    base = [cohort.base_net_usd for cohort in cohorts]
    stress = [cohort.stress_net_usd for cohort in cohorts]
    active_months = {
        datetime.fromtimestamp(cohort.entry_time_ms / 1000, tz=UTC).strftime("%Y-%m")
        for cohort in cohorts
    }
    return {
        "trialId": trial.trial_id,
        "completedCohorts": len(cohorts),
        "invalidSignals": invalid_signals,
        "activeUtcMonths": len(active_months),
        "baseNetUsd": str(sum(base, ZERO)),
        "stressNetUsd": str(sum(stress, ZERO)),
        "stressBootstrapLowerMeanUsd": None,
        "maximumPortfolioBetaGap": str(
            max((cohort.portfolio_beta_gap for cohort in cohorts), default=ZERO)
        ),
        "maximumPairBetaGap": str(
            max((cohort.maximum_pair_beta_gap for cohort in cohorts), default=ZERO)
        ),
        "capacityPass": bool(cohorts) and all(cohort.capacity_pass for cohort in cohorts),
    }


def evaluate_trial(
    data: Mapping[str, SymbolData],
    trial: Trial,
    *,
    partition_start_ms: int,
    partition_end_ms: int,
) -> tuple[JsonObject, tuple[Cohort, ...], dict[date, Decimal]]:
    history_start = partition_start_ms - 28 * trial.hold_hours * HOUR_MS
    dispersions: list[Decimal] = []
    cohorts: list[Cohort] = []
    invalid_signals = 0
    economic_gate_failures = 0
    for signal_time in schedule(history_start, partition_end_ms, trial.hold_hours):
        in_partition = signal_time >= partition_start_ms
        try:
            scores = cross_sectional_scores(
                data,
                signal_time_ms=signal_time,
                lookback_hours=trial.lookback_hours,
            )
            if len(scores) < 20:
                raise EvidenceError("eligible score count below 20")
            current_dispersion = dispersion(tuple(scores.values()))
            baseline = median(dispersions[-28:]) if len(dispersions) >= 28 else None
            dispersions.append(current_dispersion)
            if not in_partition or baseline is None:
                continue
            if baseline <= ZERO:
                raise EconomicGateFailure("causal dispersion baseline is zero")
            if current_dispersion < trial.dispersion_multiplier * baseline:
                continue
            long_symbols, short_symbols = select_atomic_tails(scores)
            btc_data = data.get("BTCUSDT")
            if btc_data is None:
                raise EvidenceError("BTCUSDT beta benchmark missing")
            betas = {
                symbol: beta_to_btc(
                    data[symbol].bars,
                    btc_data.bars,
                    signal_time_ms=signal_time,
                )
                for symbol in (*long_symbols, *short_symbols)
            }
            matches = optimal_beta_matches(long_symbols, short_symbols, betas)
            if max(match.absolute_gap for match in matches) > Decimal("0.35"):
                raise EconomicGateFailure("matched pair beta gap exceeds 0.35")
            cohort = simulate_cohort(
                data,
                matches=matches,
                signal_time_ms=signal_time,
                hold_hours=trial.hold_hours,
            )
            if cohort.portfolio_beta_gap > Decimal("0.10"):
                raise EconomicGateFailure("portfolio beta gap exceeds 0.10")
            cohorts.append(cohort)
        except EconomicGateFailure:
            if in_partition:
                economic_gate_failures += 1
        except EvidenceError:
            if in_partition:
                invalid_signals += 1
    daily: dict[date, Decimal] = defaultdict(lambda: ZERO)
    for cohort in cohorts:
        day = datetime.fromtimestamp(cohort.exit_time_ms / 1000, tz=UTC).date()
        daily[day] += cohort.stress_net_usd
    metrics = trial_metrics(cohorts, invalid_signals, trial)
    metrics["economicGateFailures"] = economic_gate_failures
    return metrics, tuple(cohorts), dict(daily)


def one_sided_block_pvalue(values: Sequence[Decimal], *, seed: int) -> Decimal:
    if not values:
        return ONE
    observed = sum(values, ZERO) / Decimal(len(values))
    centered = [value - observed for value in values]
    rng = random.Random(seed)
    exceed = 0
    replicates = 2048
    for _ in range(replicates):
        sample = [centered[index] for index in circular_block_indices(len(centered), rng=rng)]
        if sum(sample, ZERO) / Decimal(len(sample)) >= observed:
            exceed += 1
    return Decimal(exceed + 1) / Decimal(replicates + 1)


def holm_passes(pvalues: Mapping[str, Decimal], alpha: Decimal = Decimal("0.05")) -> set[str]:
    passing: set[str] = set()
    ordered = sorted(pvalues.items(), key=lambda row: (row[1], row[0]))
    family_size = len(ordered)
    for index, (trial_id, pvalue) in enumerate(ordered):
        if pvalue > alpha / Decimal(family_size - index):
            break
        passing.add(trial_id)
    return passing


def complete_daily_matrix(
    daily: Mapping[str, Mapping[date, Decimal]],
    *,
    start_ms: int,
    end_ms: int,
) -> dict[str, tuple[Decimal, ...]]:
    first = datetime.fromtimestamp(start_ms / 1000, tz=UTC).date()
    final = datetime.fromtimestamp((end_ms - 1) / 1000, tz=UTC).date()
    days: list[date] = []
    cursor = first
    while cursor <= final:
        days.append(cursor)
        cursor += timedelta(days=1)
    return {
        trial_id: tuple(values.get(day, ZERO) for day in days) for trial_id, values in daily.items()
    }


def reality_check_pvalue(matrix: Mapping[str, Sequence[Decimal]]) -> Decimal:
    if len(matrix) != 12 or not matrix:
        return ONE
    length = len(next(iter(matrix.values())))
    if length == 0 or any(len(values) != length for values in matrix.values()):
        return ONE
    observed_means = {
        trial_id: sum(values, ZERO) / Decimal(length) for trial_id, values in matrix.items()
    }
    observed_max = max(observed_means.values())
    centered = {
        trial_id: tuple(value - observed_means[trial_id] for value in values)
        for trial_id, values in matrix.items()
    }
    rng = random.Random(2026072902)
    exceed = 0
    replicates = 2048
    for _ in range(replicates):
        indices = circular_block_indices(length, rng=rng)
        candidate = max(
            sum((values[index] for index in indices), ZERO) / Decimal(length)
            for values in centered.values()
        )
        if candidate >= observed_max:
            exceed += 1
    return Decimal(exceed + 1) / Decimal(replicates + 1)


def pbo_value(matrix: Mapping[str, Sequence[Decimal]]) -> Decimal:
    if len(matrix) != 12:
        raise EvidenceError("PBO requires all 12 trials")
    length = len(next(iter(matrix.values())))
    if length < 8 or any(len(values) != length for values in matrix.values()):
        raise EvidenceError("PBO daily matrix invalid")
    boundaries = [round(index * length / 8) for index in range(9)]
    block_scores = {
        trial_id: tuple(
            sum(values[boundaries[index] : boundaries[index + 1]], ZERO) for index in range(8)
        )
        for trial_id, values in matrix.items()
    }
    underperformed = 0
    split_count = 0
    trial_ids = sorted(matrix)
    for in_sample in itertools.combinations(range(8), 4):
        in_set = set(in_sample)
        out_sample = [index for index in range(8) if index not in in_set]
        selected = max(
            trial_ids,
            key=lambda trial_id: (
                sum((block_scores[trial_id][index] for index in in_sample), ZERO),
                "".join(chr(255 - ord(char)) for char in trial_id),
            ),
        )
        out_scores = sorted(
            sum((block_scores[trial_id][index] for index in out_sample), ZERO)
            for trial_id in trial_ids
        )
        selected_score = sum((block_scores[selected][index] for index in out_sample), ZERO)
        if selected_score <= median(out_scores):
            underperformed += 1
        split_count += 1
    if split_count != 70:
        raise EvidenceError("PBO split count is not 70")
    return Decimal(underperformed) / Decimal(split_count)


def evaluate_development(
    data: Mapping[str, SymbolData],
    *,
    start_ms: int,
    end_ms: int,
) -> JsonObject:
    metrics: dict[str, JsonObject] = {}
    daily: dict[str, Mapping[date, Decimal]] = {}
    for trial in trial_family():
        trial_result, _, trial_daily = evaluate_trial(
            data,
            trial,
            partition_start_ms=start_ms,
            partition_end_ms=end_ms,
        )
        metrics[trial.trial_id] = trial_result
        daily[trial.trial_id] = trial_daily
    matrix = complete_daily_matrix(daily, start_ms=start_ms, end_ms=end_ms)
    for trial_id, values in matrix.items():
        metrics[trial_id]["stressBootstrapLowerMeanUsd"] = str(
            bootstrap_lower(
                values,
                seed=2026072902 + sum(map(ord, trial_id)),
            )
        )
    pvalues = {
        trial_id: one_sided_block_pvalue(values, seed=2026072902 + sum(map(ord, trial_id)))
        for trial_id, values in matrix.items()
    }
    holm = holm_passes(pvalues)
    reality_pvalue = reality_check_pvalue(matrix)
    pbo = pbo_value(matrix)
    evidence_complete = all(
        int(row["invalidSignals"]) == 0
        and int(row["completedCohorts"]) >= 24
        and int(row["activeUtcMonths"]) >= 6
        for row in metrics.values()
    )
    candidates = [
        trial_id
        for trial_id, row in metrics.items()
        if Decimal(row["baseNetUsd"]) > ZERO
        and Decimal(row["stressNetUsd"]) > ZERO
        and Decimal(row["stressBootstrapLowerMeanUsd"]) > ZERO
        and Decimal(row["maximumPortfolioBetaGap"]) <= Decimal("0.10")
        and Decimal(row["maximumPairBetaGap"]) <= Decimal("0.35")
        and row["capacityPass"] is True
        and int(row["economicGateFailures"]) == 0
        and trial_id in holm
    ]
    family_passed = (
        evidence_complete
        and bool(candidates)
        and reality_pvalue <= Decimal("0.05")
        and pbo <= Decimal("0.50")
    )
    champion = (
        max(
            candidates,
            key=lambda trial_id: (
                Decimal(metrics[trial_id]["stressBootstrapLowerMeanUsd"]),
                Decimal(metrics[trial_id]["stressNetUsd"]),
                "".join(chr(255 - ord(char)) for char in trial_id),
            ),
        )
        if family_passed
        else None
    )
    return {
        "schema": "cosmos.quant.research.s1n.development.v1",
        "trialCount": len(metrics),
        "trials": [metrics[trial_id] for trial_id in sorted(metrics)],
        "pvalues": {trial_id: str(value) for trial_id, value in sorted(pvalues.items())},
        "holmPassingTrials": sorted(holm),
        "realityCheckPvalue": str(reality_pvalue),
        "pbo": str(pbo),
        "evidenceComplete": evidence_complete,
        "economicGatesPassed": family_passed,
        "developmentPassed": family_passed,
        "championTrialId": champion,
    }


def trial_from_id(trial_id: str) -> Trial:
    for trial in trial_family():
        if trial.trial_id == trial_id:
            return trial
    raise EvidenceError(f"unknown trial id: {trial_id}")


def evaluate_holdout(
    data: Mapping[str, SymbolData],
    *,
    trial_id: str,
    start_ms: int,
    end_ms: int,
) -> JsonObject:
    metrics, cohorts, trial_daily = evaluate_trial(
        data,
        trial_from_id(trial_id),
        partition_start_ms=start_ms,
        partition_end_ms=end_ms,
    )
    holdout_matrix = complete_daily_matrix(
        {trial_id: trial_daily},
        start_ms=start_ms,
        end_ms=end_ms,
    )
    metrics["stressBootstrapLowerMeanUsd"] = str(
        bootstrap_lower(
            holdout_matrix[trial_id],
            seed=2026072902 + sum(map(ord, trial_id)),
        )
    )
    evidence_complete = (
        int(metrics["invalidSignals"]) == 0 and int(metrics["completedCohorts"]) >= 12
    )
    economic_pass = (
        evidence_complete
        and Decimal(metrics["baseNetUsd"]) > ZERO
        and Decimal(metrics["stressNetUsd"]) > ZERO
        and Decimal(metrics["stressBootstrapLowerMeanUsd"]) > ZERO
        and metrics["capacityPass"] is True
        and int(metrics["economicGateFailures"]) == 0
    )
    equity = Decimal("1000")
    peak = equity
    maximum_drawdown = ZERO
    for cohort in sorted(cohorts, key=lambda item: item.exit_time_ms):
        equity += cohort.stress_net_usd
        peak = max(peak, equity)
        if peak > ZERO:
            maximum_drawdown = max(maximum_drawdown, (peak - equity) / peak)
    economic_pass &= maximum_drawdown <= Decimal("0.10")
    return {
        "schema": "cosmos.quant.research.s1n.holdout.v1",
        "trial": metrics,
        "evidenceComplete": evidence_complete,
        "economicGatesPassed": economic_pass,
        "maximumDrawdownPct": str(maximum_drawdown * Decimal("100")),
    }


def terminal_result(
    *,
    freeze_sha256: str,
    manifest_sha256: str,
    development: Mapping[str, object] | None,
    failure: str | None,
    failure_phase: str | None,
    evaluator_sha256: str | None = None,
    run_marker_sha256: str | None = None,
) -> JsonObject:
    evidence_complete = development is not None and development.get("evidenceComplete") is True
    economic_pass = development is not None and development.get("economicGatesPassed") is True
    if failure is not None or not evidence_complete:
        measurement = "UNMEASURED"
        public_proxy = "INVALID_OR_INCOMPLETE"
        reason = "INTEGRITY_OR_SAMPLE_INCOMPLETE"
    elif not economic_pass:
        measurement = "NO_GO"
        public_proxy = "VALID_NEGATIVE"
        reason = "VALID_ECONOMIC_GATE_FAILURE"
    else:
        raise EvidenceError("terminal development result requested after pass")
    return {
        "schema": "cosmos.quant.research.s1n.result.v1",
        "state": f"TERMINAL_{measurement}_RUN_CONSUMED",
        "freezeSha256": freeze_sha256,
        "manifestSha256": manifest_sha256,
        "evaluatorSha256": evaluator_sha256,
        "runMarkerSha256": run_marker_sha256,
        "development": development,
        "holdout": None,
        "holdoutOpened": False,
        "failure": failure,
        "failurePhase": failure_phase,
        "measurementVerdict": measurement,
        "publicProxyVerdict": public_proxy,
        "verdictReason": reason,
        "accountEffectiveFees": "UNKNOWN",
        "historicalFundingRateType": "MISSING_POSITIVE_CAPITAL_BLOCKER",
        "capitalVerdict": "NO_GO",
        "executionAuthority": "NONE",
        "runCountAllowed": 1,
        "runCountConsumed": 1,
    }


def write_result_candidate(state_root: Path, result: Mapping[str, object]) -> None:
    exclusive_write(state_root / "result.candidate.json", canonical_bytes(result))


def seal_result(state_root: Path) -> JsonObject:
    freeze_value = verify_freeze(state_root)
    result, result_raw = load_json(state_root / "result.candidate.json")
    holdout_opened = result.get("holdoutOpened")
    if not isinstance(holdout_opened, bool):
        raise EvidenceError("result candidate holdout state invalid")
    _, manifest_sha256 = verify_manifest(
        state_root,
        holdout_fetched=holdout_opened,
        freeze_sha256=str(freeze_value["_sha256"]),
    )
    run_marker, run_marker_raw = load_json(state_root / "RUN_STARTED.json")
    if (
        result.get("schema") != "cosmos.quant.research.s1n.result.v1"
        or result.get("freezeSha256") != freeze_value["_sha256"]
        or result.get("manifestSha256") != manifest_sha256
        or result.get("evaluatorSha256") != sha256_file(Path(__file__).resolve())
        or result.get("runMarkerSha256") != sha256_bytes(run_marker_raw)
        or run_marker.get("evaluatorSha256") != result.get("evaluatorSha256")
        or result.get("measurementVerdict") not in {"NO_GO", "UNMEASURED"}
        or result.get("capitalVerdict") != "NO_GO"
        or result.get("executionAuthority") != "NONE"
        or result.get("runCountConsumed") != 1
    ):
        raise EvidenceError("result candidate bindings invalid")
    marker_exists = (state_root / "HOLDOUT_OPEN_STARTED.json").exists()
    if marker_exists != holdout_opened:
        raise EvidenceError("result holdout marker state mismatch")
    if holdout_opened:
        _, holdout_manifest_sha256 = verify_holdout_manifest(state_root)
        if result.get("holdoutManifestSha256") != holdout_manifest_sha256:
            raise EvidenceError("result holdout manifest binding invalid")
    exclusive_write(RESULT_PATH, result_raw)
    return {
        "schema": "cosmos.quant.research.s1n.result-seal.v1",
        "resultSha256": sha256_bytes(result_raw),
        "measurementVerdict": result["measurementVerdict"],
        "sealed": True,
    }


def run_development(state_root: Path) -> JsonObject:
    if (state_root / "RUN_STARTED.json").exists() or (
        state_root / "result.candidate.json"
    ).exists():
        raise EvidenceError("one-run marker or result already exists")
    freeze_value = verify_freeze(state_root)
    _, manifest_sha256 = verify_manifest(
        state_root,
        freeze_sha256=str(freeze_value["_sha256"]),
    )
    run_marker = {
        "schema": "cosmos.quant.research.s1n.run-start.v1",
        "freezeSha256": freeze_value["_sha256"],
        "manifestSha256": manifest_sha256,
        "evaluatorSha256": sha256_file(Path(__file__).resolve()),
        "runCount": 1,
    }
    run_marker_raw = canonical_bytes(run_marker)
    exclusive_write(state_root / "RUN_STARTED.json", run_marker_raw)
    start_ms = parse_utc("2025-07-01T00:00:00Z")
    end_ms = parse_utc("2026-04-01T00:00:00Z")
    try:
        data = load_partition_data(state_root, start_ms=start_ms, end_ms=end_ms, holdout=False)
        development = evaluate_development(data, start_ms=start_ms, end_ms=end_ms)
    except EvidenceError as error:
        result = terminal_result(
            freeze_sha256=freeze_value["_sha256"],
            manifest_sha256=manifest_sha256,
            development=None,
            failure=str(error),
            failure_phase="DEVELOPMENT_ARCHIVE_OPEN_OR_EVALUATION",
            evaluator_sha256=str(run_marker["evaluatorSha256"]),
            run_marker_sha256=sha256_bytes(run_marker_raw),
        )
        write_result_candidate(state_root, result)
        return result
    if development["developmentPassed"] is not True:
        result = terminal_result(
            freeze_sha256=freeze_value["_sha256"],
            manifest_sha256=manifest_sha256,
            development=development,
            failure=None,
            failure_phase=None,
            evaluator_sha256=str(run_marker["evaluatorSha256"]),
            run_marker_sha256=sha256_bytes(run_marker_raw),
        )
        write_result_candidate(state_root, result)
        return result
    candidate: JsonObject = {
        "schema": "cosmos.quant.research.s1n.candidate-seal.v1",
        "freezeSha256": freeze_value["_sha256"],
        "manifestSha256": manifest_sha256,
        "evaluatorSha256": run_marker["evaluatorSha256"],
        "runMarkerSha256": sha256_bytes(run_marker_raw),
        "developmentPassed": True,
        "championTrialId": development["championTrialId"],
        "trialIds": [trial.trial_id for trial in trial_family()],
        "development": development,
        "holdoutOpened": False,
    }
    candidate_raw = canonical_bytes(candidate)
    exclusive_write(state_root / "candidate-seal.v1.json", candidate_raw)
    authorization = {
        "schema": "cosmos.quant.research.s1n.holdout-acquisition-authorization.v1",
        "candidateSealSha256": sha256_bytes(candidate_raw),
        "manifestSha256": manifest_sha256,
        "holdoutBodiesMayBeFetched": True,
        "holdoutBodiesMayBeOpened": False,
    }
    exclusive_write(
        state_root / "HOLDOUT_ACQUISITION_AUTHORIZED.json", canonical_bytes(authorization)
    )
    return {
        "state": "DEVELOPMENT_PASS_HOLDOUT_ACQUISITION_AUTHORIZED",
        "candidateSealSha256": sha256_bytes(candidate_raw),
        "championTrialId": development["championTrialId"],
    }


def verify_holdout_manifest(state_root: Path) -> tuple[JsonObject, str]:
    manifest, raw = load_json(state_root / "holdout-manifest.v1.json")
    development_manifest, development_manifest_raw = load_json(
        state_root / "archive-manifest.v1.json"
    )
    candidate, candidate_raw = load_json(state_root / "candidate-seal.v1.json")
    authorization, authorization_raw = load_json(state_root / "HOLDOUT_ACQUISITION_AUTHORIZED.json")
    sources = manifest.get("sources")
    development_sources = development_manifest.get("sources")
    unsigned = {key: value for key, value in manifest.items() if key != "holdoutManifestSha256"}
    if (
        manifest.get("sourceCount") != 270
        or manifest.get("holdoutManifestSha256") != sha256_bytes(canonical_bytes(unsigned))
        or manifest.get("authorizationSha256") != sha256_bytes(authorization_raw)
        or manifest.get("candidateSealSha256") != sha256_bytes(candidate_raw)
        or candidate.get("manifestSha256") != sha256_bytes(development_manifest_raw)
        or authorization.get("candidateSealSha256") != sha256_bytes(candidate_raw)
        or authorization.get("manifestSha256") != candidate.get("manifestSha256")
        or not isinstance(sources, list)
        or not isinstance(development_sources, list)
    ):
        raise EvidenceError("holdout manifest is not the exact 270-source suffix")
    predeclared: dict[tuple[str, str, str], Mapping[str, object]] = {}
    for row in development_sources:
        if not isinstance(row, dict):
            raise EvidenceError("development manifest row malformed")
        symbol, month, dataset = row.get("symbol"), row.get("month"), row.get("dataset")
        if (
            isinstance(symbol, str)
            and isinstance(month, str)
            and isinstance(dataset, str)
            and month >= "2026-04"
        ):
            predeclared[(symbol, month, dataset)] = row
    if len(predeclared) != 270:
        raise EvidenceError("predeclared holdout suffix is not 270 unique sources")
    observed_identities: set[tuple[str, str, str]] = set()
    for row in sources:
        if not isinstance(row, dict):
            raise EvidenceError("holdout source row malformed")
        expected = row.get("expectedSha256")
        observed = row.get("observedSha256")
        symbol = row.get("symbol")
        month = row.get("month")
        dataset = row.get("dataset")
        if (
            not isinstance(symbol, str)
            or not isinstance(month, str)
            or not isinstance(dataset, str)
            or month < "2026-04"
            or row.get("bodyState") != "CHECKSUM_VERIFIED_AFTER_DEVELOPMENT_PASS"
        ):
            raise EvidenceError("holdout source state invalid")
        identity = (symbol, month, dataset)
        if identity in observed_identities:
            raise EvidenceError("duplicate holdout source identity")
        observed_identities.add(identity)
        frozen_row = predeclared.get(identity)
        if frozen_row is None or any(
            row.get(field) != frozen_row.get(field)
            for field in (
                "key",
                "url",
                "checksumUrl",
                "expectedSha256",
                "sidecarSha256",
            )
        ):
            raise EvidenceError("holdout source differs from predeclared Cartesian")
        path = archive_local(state_root / "selected-archives", row)
        if expected != observed or not path.is_file() or sha256_file(path) != expected:
            raise EvidenceError(f"holdout archive custody invalid: {path.name}")
    if observed_identities != set(predeclared):
        raise EvidenceError("holdout identities do not equal predeclared suffix")
    return manifest, sha256_bytes(raw)


def finalize_holdout(state_root: Path) -> JsonObject:
    if (state_root / "HOLDOUT_OPEN_STARTED.json").exists():
        raise EvidenceError("holdout open marker already exists")
    freeze_value = verify_freeze(state_root)
    run_marker, run_marker_raw = load_json(state_root / "RUN_STARTED.json")
    candidate, candidate_raw = load_json(state_root / "candidate-seal.v1.json")
    authorization, _ = load_json(state_root / "HOLDOUT_ACQUISITION_AUTHORIZED.json")
    _, development_manifest_raw = load_json(state_root / "archive-manifest.v1.json")
    _, holdout_manifest_sha256 = verify_holdout_manifest(state_root)
    if (
        candidate.get("developmentPassed") is not True
        or candidate.get("freezeSha256") != freeze_value["_sha256"]
        or candidate.get("manifestSha256") != sha256_bytes(development_manifest_raw)
        or candidate.get("runMarkerSha256") != sha256_bytes(run_marker_raw)
        or candidate.get("evaluatorSha256") != sha256_file(Path(__file__).resolve())
        or authorization.get("candidateSealSha256") != sha256_bytes(candidate_raw)
        or authorization.get("manifestSha256") != candidate.get("manifestSha256")
        or run_marker.get("freezeSha256") != candidate.get("freezeSha256")
        or run_marker.get("manifestSha256") != candidate.get("manifestSha256")
        or run_marker.get("evaluatorSha256") != candidate.get("evaluatorSha256")
    ):
        raise EvidenceError("holdout finalization bindings invalid")
    open_marker = {
        "schema": "cosmos.quant.research.s1n.holdout-open-start.v1",
        "candidateSealSha256": sha256_bytes(candidate_raw),
        "holdoutManifestSha256": holdout_manifest_sha256,
        "evaluatorSha256": candidate.get("evaluatorSha256"),
        "runMarkerSha256": candidate.get("runMarkerSha256"),
        "openCount": 1,
    }
    exclusive_write(state_root / "HOLDOUT_OPEN_STARTED.json", canonical_bytes(open_marker))
    champion = candidate.get("championTrialId")
    if not isinstance(champion, str):
        raise EvidenceError("candidate champion missing")
    start_ms = parse_utc("2026-04-08T00:00:00Z")
    end_ms = parse_utc("2026-07-01T00:00:00Z")
    failure: str | None = None
    try:
        data = load_partition_data(state_root, start_ms=start_ms, end_ms=end_ms, holdout=True)
        holdout = evaluate_holdout(data, trial_id=champion, start_ms=start_ms, end_ms=end_ms)
    except EvidenceError as error:
        holdout = None
        failure = str(error)
    if holdout is None or holdout.get("evidenceComplete") is not True:
        measurement = "UNMEASURED"
        proxy = "INVALID_OR_INCOMPLETE"
        reason = "HOLDOUT_INTEGRITY_OR_SAMPLE_INCOMPLETE"
    elif holdout.get("economicGatesPassed") is not True:
        measurement = "NO_GO"
        proxy = "VALID_NEGATIVE"
        reason = "VALID_HOLDOUT_ECONOMIC_GATE_FAILURE"
    else:
        measurement = "UNMEASURED"
        proxy = "VALID_POSITIVE_PUBLIC_PROXY"
        reason = "POSITIVE_PUBLIC_PROXY_ACCOUNT_COST_AND_RATETYPE_BLOCKERS"
    result: JsonObject = {
        "schema": "cosmos.quant.research.s1n.result.v1",
        "state": f"TERMINAL_{measurement}_RUN_CONSUMED",
        "freezeSha256": freeze_value["_sha256"],
        "manifestSha256": candidate.get("manifestSha256"),
        "evaluatorSha256": candidate.get("evaluatorSha256"),
        "runMarkerSha256": candidate.get("runMarkerSha256"),
        "candidateSealSha256": sha256_bytes(candidate_raw),
        "holdoutManifestSha256": holdout_manifest_sha256,
        "development": candidate.get("development"),
        "holdout": holdout,
        "holdoutOpened": True,
        "failure": failure,
        "failurePhase": "HOLDOUT_ARCHIVE_OPEN_OR_EVALUATION" if failure else None,
        "measurementVerdict": measurement,
        "publicProxyVerdict": proxy,
        "verdictReason": reason,
        "accountEffectiveFees": "UNKNOWN",
        "historicalFundingRateType": "MISSING_POSITIVE_CAPITAL_BLOCKER",
        "capitalVerdict": "NO_GO",
        "executionAuthority": "NONE",
        "runCountAllowed": 1,
        "runCountConsumed": 1,
    }
    write_result_candidate(state_root, result)
    return result


def report(state_root: Path) -> JsonObject:
    freeze_value = verify_freeze(state_root)
    result, result_raw = load_json(RESULT_PATH)
    result_candidate, result_candidate_raw = load_json(state_root / "result.candidate.json")
    holdout_opened = result.get("holdoutOpened")
    if not isinstance(holdout_opened, bool):
        raise EvidenceError("committed result holdout state invalid")
    manifest, manifest_sha256 = verify_manifest(
        state_root,
        holdout_fetched=holdout_opened,
        freeze_sha256=str(freeze_value["_sha256"]),
    )
    run_marker, run_marker_raw = load_json(state_root / "RUN_STARTED.json")
    if (
        result.get("schema") != "cosmos.quant.research.s1n.result.v1"
        or result.get("freezeSha256") != freeze_value["_sha256"]
        or result.get("manifestSha256") != manifest_sha256
        or result.get("runMarkerSha256") != sha256_bytes(run_marker_raw)
        or result.get("evaluatorSha256") != sha256_file(Path(__file__).resolve())
        or run_marker.get("evaluatorSha256") != result.get("evaluatorSha256")
        or result_candidate != result
        or result_candidate_raw != result_raw
        or result.get("capitalVerdict") != "NO_GO"
        or result.get("executionAuthority") != "NONE"
        or result.get("runCountConsumed") != 1
        or result.get("measurementVerdict") not in {"NO_GO", "UNMEASURED"}
    ):
        raise EvidenceError("committed result packet is invalid")
    if holdout_opened:
        _, holdout_manifest_sha256 = verify_holdout_manifest(state_root)
        if (
            result.get("holdoutManifestSha256") != holdout_manifest_sha256
            or not (state_root / "HOLDOUT_OPEN_STARTED.json").is_file()
        ):
            raise EvidenceError("committed holdout packet is invalid")
    elif (state_root / "HOLDOUT_OPEN_STARTED.json").exists():
        raise EvidenceError("unopened result has a holdout-open marker")
    return {
        "schema": "cosmos.quant.research.s1n.report.v1",
        "packetVerified": True,
        "resultSha256": sha256_bytes(result_raw),
        "sourceCount": manifest.get("sourceCount"),
        "manifestSha256": manifest_sha256,
        "measurementVerdict": result["measurementVerdict"],
        "capitalVerdict": "NO_GO",
        "executionAuthority": "NONE",
        "holdoutOpened": holdout_opened,
    }


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(description=__doc__)
    value.add_argument(
        "--state-root",
        type=Path,
        default=DEFAULT_STATE_ROOT,
        help="external custody directory",
    )
    commands = value.add_subparsers(dest="command", required=True)
    for name in (
        "discover",
        "freeze",
        "seal-freeze",
        "screen",
        "acquire",
        "run",
        "acquire-holdout",
        "finalize-holdout",
        "seal-result",
        "report",
    ):
        commands.add_parser(name)
    return value


def main(argv: Sequence[str] | None = None) -> int:
    arguments = parser().parse_args(argv)
    state_root = arguments.state_root.resolve()
    try:
        if arguments.command == "discover":
            output = discover(state_root)
        elif arguments.command == "freeze":
            output = freeze(state_root)
        elif arguments.command == "seal-freeze":
            output = seal_freeze(state_root)
        elif arguments.command == "screen":
            output = screen(state_root)
        elif arguments.command == "acquire":
            output = acquire(state_root)
        elif arguments.command == "run":
            output = run_development(state_root)
        elif arguments.command == "acquire-holdout":
            output = acquire_holdout(state_root)
        elif arguments.command == "finalize-holdout":
            output = finalize_holdout(state_root)
        elif arguments.command == "seal-result":
            output = seal_result(state_root)
        elif arguments.command == "report":
            output = report(state_root)
        else:
            raise EvidenceError(f"unknown command: {arguments.command}")
    except (EvidenceError, OSError, subprocess.CalledProcessError) as error:
        print(f"{MILESTONE} REFUSED: {error}", file=sys.stderr)
        return 2
    print(canonical_bytes(output).decode(), end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
