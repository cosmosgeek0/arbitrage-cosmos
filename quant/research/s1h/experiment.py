#!/usr/bin/env python3
"""Sealed S-1H BTC/ETH relative-basis dislocation experiment."""

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
import statistics
import subprocess
import sys
import urllib.request
import zipfile
from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any, Final, cast

HERE: Final = Path(__file__).resolve().parent
PROTOCOL_PATH: Final = HERE / "protocol.v1.json"
FREEZE_PATH: Final = HERE / "freeze.v1.json"
RESULT_PATH: Final = HERE / "result.v1.json"
CHECKSUMS_PATH: Final = HERE / "SHA256SUMS"
README_PATH: Final = HERE / "README.md"
RESEARCH_PATH: Final = HERE / "OFFICIAL_SOURCE_RESEARCH.md"
TEST_PATH: Final = HERE / "test_experiment.py"
DEFAULT_STATE_ROOT: Final = Path("/private/tmp/cosmos-s1h-btc-eth-rv-basis-v1")
DISCOVERY_NAME: Final = "DISCOVERY.v1.json"
FREEZE_CANDIDATE_NAME: Final = "FREEZE_CANDIDATE.v1.json"
RUN_MARKER_NAME: Final = "S1H_RUN_CONSUMED.v1.json"
CANDIDATE_SEAL_NAME: Final = "S1H_CANDIDATE_SEAL.v1.json"
HOLDOUT_MARKER_NAME: Final = "S1H_HOLDOUT_OPEN.v1.json"
RESULT_CANDIDATE_NAME: Final = "RESULT_CANDIDATE.v1.json"
BAR_MS: Final = 300_000
DAY_MS: Final = 86_400_000
CALIBRATION_DAYS: Final = 28
CALIBRATION_BARS: Final = CALIBRATION_DAYS * DAY_MS // BAR_MS
CAPITAL_USD: Final = 1_000.0
LEG_NOTIONAL_USD: Final = 500.0
SYMBOLS: Final = ("BTCUSDT", "ETHUSDT")
DEVELOPMENT_MONTHS: Final = (
    "2025-07",
    "2025-08",
    "2025-09",
    "2025-10",
    "2025-11",
    "2025-12",
    "2026-01",
    "2026-02",
    "2026-03",
)
HOLDOUT_MONTHS: Final = ("2026-04", "2026-05", "2026-06")
ALL_MONTHS: Final = DEVELOPMENT_MONTHS + HOLDOUT_MONTHS


class EvidenceError(RuntimeError):
    """Terminal evidence or lifecycle error."""


@dataclass(frozen=True)
class Bar:
    """One normalized five-minute public kline."""

    timestamp_ms: int
    open: float
    high: float
    low: float
    close: float
    quote_volume: float


@dataclass(frozen=True)
class FundingEvent:
    """One actual public funding settlement."""

    timestamp_ms: int
    rate: float
    mark_price: float


@dataclass(frozen=True)
class SymbolData:
    """Synchronized Spot/perpetual bars and actual funding events for one symbol."""

    symbol: str
    timestamps_ms: tuple[int, ...]
    spot: tuple[Bar, ...]
    perpetual: tuple[Bar, ...]
    funding: tuple[FundingEvent, ...]


@dataclass(frozen=True)
class MarketData:
    """Joint BTC/ETH synchronized market data."""

    timestamps_ms: tuple[int, ...]
    symbols: Mapping[str, SymbolData]


@dataclass(frozen=True)
class Calibration:
    """Causal daily-frozen relative and own-basis calibration."""

    location: float
    scale: float
    btc_median: float
    eth_median: float


@dataclass(frozen=True)
class Trial:
    """One frozen parameter combination."""

    trial_id: str
    entry_z: float
    maximum_hold_bars: int


@dataclass(frozen=True)
class CostScenario:
    """One public fee and adverse-execution sensitivity."""

    name: str
    spot_fee_bps: float
    perpetual_fee_bps: float
    adverse_execution_bps: float


@dataclass(frozen=True)
class Trade:
    """One non-overlapping richer-asset normal-basis compression trade."""

    asset: str
    entry_index: int
    exit_index: int
    entry_timestamp_ms: int
    exit_timestamp_ms: int
    quantity: float
    spot_entry: float
    spot_exit: float
    perpetual_entry: float
    perpetual_exit: float
    adverse_funding_usd: float
    omitted_favorable_funding_usd: float
    minimum_causal_quote_volume_usd: float
    exit_reason: str


@dataclass(frozen=True)
class TrialRun:
    """Reference trades plus deterministic trial diagnostics."""

    trial: Trial
    trades: tuple[Trade, ...]


def canonical_bytes(value: object) -> bytes:
    """Return deterministic UTF-8 JSON bytes."""

    return (
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True) + "\n"
    ).encode()


def sha256_bytes(raw: bytes) -> str:
    """Return a lowercase SHA-256 digest."""

    return hashlib.sha256(raw).hexdigest()


def sha256_file(path: Path) -> str:
    """Stream and hash a file."""

    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while block := handle.read(1 << 20):
            digest.update(block)
    return digest.hexdigest()


def load_json(path: Path) -> tuple[dict[str, Any], bytes]:
    """Load a JSON object and retain exact bytes."""

    raw = path.read_bytes()
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise EvidenceError(f"JSON root is not an object: {path}")
    return cast(dict[str, Any], value), raw


def exclusive_write(path: Path, raw: bytes) -> None:
    """Publish bytes durably without overwriting prior evidence."""

    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.parent / f".{path.name}.{os.getpid()}.tmp"
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        try:
            os.link(temporary, path)
        except FileExistsError as exc:
            raise EvidenceError(f"evidence already exists: {path}") from exc
        directory_descriptor = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory_descriptor)
        finally:
            os.close(directory_descriptor)
    finally:
        temporary.unlink(missing_ok=True)


def require_number(value: object, *, field: str) -> float:
    """Require a finite JSON number-like value."""

    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        raise EvidenceError(f"{field} is not numeric")
    try:
        parsed = float(value)
    except ValueError as exc:
        raise EvidenceError(f"{field} is not numeric") from exc
    if not math.isfinite(parsed):
        raise EvidenceError(f"{field} is not finite")
    return parsed


def parse_utc(value: str) -> int:
    """Parse a frozen UTC timestamp to epoch milliseconds."""

    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise EvidenceError(f"timestamp lacks timezone: {value}")
    return int(parsed.timestamp() * 1_000)


def utc_day(timestamp_ms: int) -> date:
    """Return the UTC date for an epoch-millisecond timestamp."""

    return datetime.fromtimestamp(timestamp_ms / 1_000, tz=UTC).date()


def trial_family() -> tuple[Trial, ...]:
    """Return the complete frozen four-trial family."""

    return tuple(
        Trial(f"Z{int(entry_z * 10):02d}_H{hold:03d}", entry_z, hold)
        for entry_z in (2.5, 3.5)
        for hold in (72, 288)
    )


def cost_scenarios() -> tuple[CostScenario, ...]:
    """Return frozen baseline, stress, and severe all-taker scenarios."""

    return (
        CostScenario("base", 10.0, 5.0, 2.0),
        CostScenario("stress", 10.0, 10.0, 5.0),
        CostScenario("severe", 10.0, 10.0, 10.0),
    )


def source_inventory_rows() -> list[dict[str, str]]:
    """Construct the complete expected official archive inventory."""

    rows: list[dict[str, str]] = []
    for month in ALL_MONTHS:
        phase = "development" if month in DEVELOPMENT_MONTHS else "holdout"
        for symbol in SYMBOLS:
            stem = f"{symbol}-5m-{month}.zip"
            sources = (
                (
                    "spotKlines",
                    f"data/spot/monthly/klines/{symbol}/5m/{stem}",
                ),
                (
                    "perpetualKlines",
                    f"data/futures/um/monthly/klines/{symbol}/5m/{stem}",
                ),
                (
                    "markPriceKlines",
                    f"data/futures/um/monthly/markPriceKlines/{symbol}/5m/{stem}",
                ),
                (
                    "fundingRate",
                    "data/futures/um/monthly/fundingRate/"
                    f"{symbol}/{symbol}-fundingRate-{month}.zip",
                ),
            )
            for kind, key in sources:
                url = f"https://data.binance.vision/{key}"
                rows.append(
                    {
                        "phase": phase,
                        "month": month,
                        "symbol": symbol,
                        "kind": kind,
                        "key": key,
                        "url": url,
                        "checksumUrl": f"{url}.CHECKSUM",
                    }
                )
    rows.sort(key=lambda row: row["key"])
    return rows


def fetch_bytes(url: str, *, timeout_seconds: int = 60) -> bytes:
    """Fetch public bytes with an explicit research user agent."""

    request = urllib.request.Request(url, headers={"User-Agent": "cosmos-s1h-research/1"})
    with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
        return cast(bytes, response.read())


def parse_checksum_sidecar(raw: bytes, *, expected_filename: str) -> str:
    """Parse an official SHA-256 sidecar."""

    try:
        line = raw.decode("ascii").strip()
    except UnicodeDecodeError as exc:
        raise EvidenceError("checksum sidecar is not ASCII") from exc
    parts = line.split()
    if len(parts) != 2:
        raise EvidenceError("checksum sidecar must contain digest and filename")
    digest, filename = parts
    if filename.lstrip("*") != expected_filename:
        raise EvidenceError(f"checksum filename mismatch: {filename!r} != {expected_filename!r}")
    if len(digest) != 64 or any(character not in "0123456789abcdefABCDEF" for character in digest):
        raise EvidenceError("checksum sidecar digest is not SHA-256")
    return digest.lower()


def discover(state_root: Path) -> dict[str, Any]:
    """Fetch only checksum sidecars and freeze a normalized external inventory."""

    if (state_root / DISCOVERY_NAME).exists():
        raise EvidenceError("discovery already exists")
    rows = source_inventory_rows()
    for row in rows:
        raw = fetch_bytes(row["checksumUrl"])
        row["sha256"] = parse_checksum_sidecar(raw, expected_filename=Path(row["key"]).name)
        row["checksumSidecarSha256"] = sha256_bytes(raw)
    discovery: dict[str, Any] = {
        "schema": "S1HDiscoveryV1",
        "protocolId": "s1h-binance-btc-eth-relative-basis-dislocation-v1",
        "sourceAuthority": "https://data.binance.vision",
        "archiveBodiesDownloaded": False,
        "archiveBodiesOpened": False,
        "sourceCount": len(rows),
        "sources": rows,
    }
    exclusive_write(state_root / DISCOVERY_NAME, canonical_bytes(discovery))
    return {
        "state": "DISCOVERY_SEALED_NO_ARCHIVE_BODIES",
        "sourceCount": len(rows),
        "discoverySha256": sha256_bytes(canonical_bytes(discovery)),
    }


def git_output(arguments: Sequence[str], *, cwd: Path) -> str:
    """Run a read-only Git command and return trimmed stdout."""

    completed = subprocess.run(
        ["git", *arguments],
        cwd=cwd,
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        raise EvidenceError(f"git {' '.join(arguments)} failed: {completed.stderr.strip()}")
    return completed.stdout.strip()


def runtime_binding() -> dict[str, object]:
    """Bind the deterministic evaluator runtime."""

    return {
        "pythonImplementation": platform.python_implementation(),
        "pythonVersion": platform.python_version(),
        "pythonHexVersion": sys.hexversion,
        "platform": platform.platform(),
        "json": "CPYTHON_STDLIB_SORTED_COMPACT_UTF8",
        "rng": "PYTHON_RANDOM_MT19937_RANDRANGE",
        "float": "IEEE754_BINARY64",
    }


def freeze(state_root: Path) -> dict[str, Any]:
    """Emit the exact external freeze candidate before outcome acquisition."""

    candidate_path = state_root / FREEZE_CANDIDATE_NAME
    if candidate_path.exists():
        raise EvidenceError("freeze candidate already exists")
    discovery, discovery_raw = load_json(state_root / DISCOVERY_NAME)
    if discovery.get("archiveBodiesDownloaded") is not False:
        raise EvidenceError("discovery does not prove unopened archive bodies")
    sources = discovery.get("sources")
    if not isinstance(sources, list) or len(sources) != 96:
        raise EvidenceError("discovery source inventory is incomplete")
    archive_root = state_root / "archives"
    if archive_root.exists() and any(archive_root.iterdir()):
        raise EvidenceError("archive bytes exist before freeze")
    protocol, protocol_raw = load_json(PROTOCOL_PATH)
    expected_base = protocol.get("canonicalBaseCommit")
    repo_root = HERE.parents[2]
    head = git_output(("rev-parse", "HEAD"), cwd=repo_root)
    if head != expected_base:
        raise EvidenceError(f"wrong base commit: {head} != {expected_base}")
    tracked_inputs = {
        "README.md": sha256_file(README_PATH),
        "OFFICIAL_SOURCE_RESEARCH.md": sha256_file(RESEARCH_PATH),
        "protocol.v1.json": sha256_bytes(protocol_raw),
        "experiment.py": sha256_file(Path(__file__).resolve()),
        "test_experiment.py": sha256_file(TEST_PATH),
    }
    candidate: dict[str, Any] = {
        "schema": "S1HFreezeV1",
        "protocolId": protocol["protocolId"],
        "canonicalBaseCommit": expected_base,
        "worktreeHeadAtFreeze": head,
        "discoverySha256": sha256_bytes(discovery_raw),
        "sourceCount": len(sources),
        "trackedInputSha256": tracked_inputs,
        "runtime": runtime_binding(),
        "trialIds": [trial.trial_id for trial in trial_family()],
        "archiveBodiesDownloaded": False,
        "archiveBodiesOpened": False,
        "holdoutArchiveBodiesOpened": False,
        "runCountAllowed": 1,
    }
    exclusive_write(candidate_path, canonical_bytes(candidate))
    return candidate


def verify_committed_freeze(state_root: Path) -> dict[str, Any]:
    """Authenticate the committed freeze against its external candidate."""

    committed, committed_raw = load_json(FREEZE_PATH)
    external, external_raw = load_json(state_root / FREEZE_CANDIDATE_NAME)
    if canonical_bytes(committed) != canonical_bytes(external):
        raise EvidenceError("committed freeze differs from external freeze candidate")
    if sha256_bytes(committed_raw) != sha256_bytes(external_raw) and committed != external:
        raise EvidenceError("freeze bytes and value differ")
    tracked = committed.get("trackedInputSha256")
    if not isinstance(tracked, dict):
        raise EvidenceError("freeze tracked input map is invalid")
    checks = {
        "README.md": README_PATH,
        "OFFICIAL_SOURCE_RESEARCH.md": RESEARCH_PATH,
        "protocol.v1.json": PROTOCOL_PATH,
        "experiment.py": Path(__file__).resolve(),
        "test_experiment.py": TEST_PATH,
    }
    for name, path in checks.items():
        expected = tracked.get(name)
        if expected != sha256_file(path):
            raise EvidenceError(f"post-freeze mutation detected: {name}")
    return committed


def archive_path(state_root: Path, source: Mapping[str, object]) -> Path:
    """Return the content-addressed external ZIP path."""

    digest = source.get("sha256")
    if not isinstance(digest, str) or len(digest) != 64:
        raise EvidenceError("source digest is missing")
    return state_root / "archives" / f"{digest}.zip"


def acquire(state_root: Path) -> dict[str, Any]:
    """Download every checksum-bound ZIP without opening any ZIP body."""

    verify_committed_freeze(state_root)
    if (state_root / RUN_MARKER_NAME).exists():
        raise EvidenceError("run marker already exists")
    discovery, _ = load_json(state_root / DISCOVERY_NAME)
    sources = discovery.get("sources")
    if not isinstance(sources, list):
        raise EvidenceError("discovery sources are invalid")
    downloaded = 0
    reused = 0
    for raw_source in sources:
        if not isinstance(raw_source, dict):
            raise EvidenceError("source row is invalid")
        source = cast(dict[str, object], raw_source)
        target = archive_path(state_root, source)
        expected = source.get("sha256")
        url = source.get("url")
        if not isinstance(expected, str) or not isinstance(url, str):
            raise EvidenceError("source URL or digest is invalid")
        if target.exists():
            if sha256_file(target) != expected:
                raise EvidenceError(f"existing archive digest mismatch: {target}")
            reused += 1
            continue
        raw = fetch_bytes(url, timeout_seconds=180)
        actual = sha256_bytes(raw)
        if actual != expected:
            raise EvidenceError(f"download digest mismatch for {url}: {actual} != {expected}")
        exclusive_write(target, raw)
        downloaded += 1
    receipt = {
        "schema": "S1HAcquisitionReceiptV1",
        "sourceCount": len(sources),
        "downloaded": downloaded,
        "reused": reused,
        "archiveBodiesOpened": False,
    }
    receipt_path = state_root / "ACQUISITION.v1.json"
    if not receipt_path.exists():
        exclusive_write(receipt_path, canonical_bytes(receipt))
    return receipt


def normalized_timestamp_ms(raw: str) -> int:
    """Normalize Binance archive millisecond/microsecond timestamps."""

    try:
        value = int(raw)
    except ValueError as exc:
        raise EvidenceError(f"invalid integer timestamp: {raw!r}") from exc
    if value > 10**15:
        value //= 1_000
    if value < 1_500_000_000_000 or value > 2_000_000_000_000:
        raise EvidenceError(f"timestamp outside supported range: {value}")
    return value


def finite_float(raw: str, *, field: str) -> float:
    """Parse one finite CSV float."""

    try:
        value = float(raw)
    except ValueError as exc:
        raise EvidenceError(f"invalid {field}: {raw!r}") from exc
    if not math.isfinite(value):
        raise EvidenceError(f"non-finite {field}: {raw!r}")
    return value


def archive_csv_rows(path: Path) -> Iterable[list[str]]:
    """Yield rows from a one-member checksum-verified archive."""

    try:
        with zipfile.ZipFile(path) as archive:
            members = [name for name in archive.namelist() if not name.endswith("/")]
            if len(members) != 1 or not members[0].endswith(".csv"):
                raise EvidenceError(f"archive member shape invalid: {path}")
            with (
                archive.open(members[0], "r") as raw_handle,
                io.TextIOWrapper(raw_handle, encoding="utf-8", newline="") as text_handle,
            ):
                yield from csv.reader(text_handle)
    except zipfile.BadZipFile as exc:
        raise EvidenceError(f"invalid ZIP archive: {path}") from exc


def parse_kline_archive(path: Path) -> list[Bar]:
    """Parse one Spot, perpetual, or mark-price kline archive."""

    bars: list[Bar] = []
    for row in archive_csv_rows(path):
        if not row:
            continue
        if not row[0].isdigit():
            continue
        if len(row) < 8:
            raise EvidenceError(f"kline row has fewer than eight columns: {path}")
        timestamp_ms = normalized_timestamp_ms(row[0])
        bar = Bar(
            timestamp_ms=timestamp_ms,
            open=finite_float(row[1], field="open"),
            high=finite_float(row[2], field="high"),
            low=finite_float(row[3], field="low"),
            close=finite_float(row[4], field="close"),
            quote_volume=finite_float(row[7], field="quote volume"),
        )
        if min(bar.open, bar.high, bar.low, bar.close) <= 0.0:
            raise EvidenceError(f"kline contains non-positive price: {path}")
        if bar.quote_volume < 0.0:
            raise EvidenceError(f"kline contains negative quote volume: {path}")
        bars.append(bar)
    if not bars:
        raise EvidenceError(f"kline archive contains no data: {path}")
    return bars


def parse_funding_archive(path: Path) -> list[tuple[int, float]]:
    """Parse one official monthly funding-rate archive."""

    events: list[tuple[int, float]] = []
    for row in archive_csv_rows(path):
        if not row:
            continue
        if not row[0].isdigit():
            continue
        if len(row) < 3:
            raise EvidenceError(f"funding row has fewer than three columns: {path}")
        timestamp_ms = normalized_timestamp_ms(row[0])
        rate = finite_float(row[2], field="funding rate")
        events.append((timestamp_ms, rate))
    if not events:
        raise EvidenceError(f"funding archive contains no data: {path}")
    return events


def source_lookup(
    discovery: Mapping[str, object],
) -> dict[tuple[str, str, str], Mapping[str, object]]:
    """Index discovery rows by month, symbol, and kind."""

    raw_sources = discovery.get("sources")
    if not isinstance(raw_sources, list):
        raise EvidenceError("discovery source list missing")
    lookup: dict[tuple[str, str, str], Mapping[str, object]] = {}
    for raw_source in raw_sources:
        if not isinstance(raw_source, dict):
            raise EvidenceError("discovery source row invalid")
        source = cast(dict[str, object], raw_source)
        month = source.get("month")
        symbol = source.get("symbol")
        kind = source.get("kind")
        if not all(isinstance(value, str) for value in (month, symbol, kind)):
            raise EvidenceError("discovery source identity invalid")
        key = (cast(str, month), cast(str, symbol), cast(str, kind))
        if key in lookup:
            raise EvidenceError(f"duplicate discovery source: {key}")
        lookup[key] = source
    return lookup


def validate_bar_series(bars: Sequence[Bar], *, label: str) -> tuple[Bar, ...]:
    """Require strictly increasing, unique, complete five-minute bars."""

    ordered = tuple(sorted(bars, key=lambda bar: bar.timestamp_ms))
    if len({bar.timestamp_ms for bar in ordered}) != len(ordered):
        raise EvidenceError(f"duplicate timestamps in {label}")
    for previous, current in itertools.pairwise(ordered):
        if current.timestamp_ms - previous.timestamp_ms != BAR_MS:
            raise EvidenceError(
                f"non-contiguous five-minute series in {label}: "
                f"{previous.timestamp_ms} -> {current.timestamp_ms}"
            )
    return ordered


def load_symbol_data(
    state_root: Path,
    lookup: Mapping[tuple[str, str, str], Mapping[str, object]],
    *,
    symbol: str,
    months: Sequence[str],
) -> SymbolData:
    """Open and validate one symbol's phase archives."""

    spot_rows: list[Bar] = []
    perpetual_rows: list[Bar] = []
    mark_rows: list[Bar] = []
    funding_rows: list[tuple[int, float]] = []
    for month in months:
        spot_rows.extend(
            parse_kline_archive(archive_path(state_root, lookup[(month, symbol, "spotKlines")]))
        )
        perpetual_rows.extend(
            parse_kline_archive(
                archive_path(state_root, lookup[(month, symbol, "perpetualKlines")])
            )
        )
        mark_rows.extend(
            parse_kline_archive(
                archive_path(state_root, lookup[(month, symbol, "markPriceKlines")])
            )
        )
        funding_rows.extend(
            parse_funding_archive(archive_path(state_root, lookup[(month, symbol, "fundingRate")]))
        )
    spot = validate_bar_series(spot_rows, label=f"{symbol} Spot")
    perpetual = validate_bar_series(perpetual_rows, label=f"{symbol} perpetual")
    marks = validate_bar_series(mark_rows, label=f"{symbol} mark price")
    spot_timestamps = tuple(bar.timestamp_ms for bar in spot)
    perpetual_timestamps = tuple(bar.timestamp_ms for bar in perpetual)
    mark_timestamps = tuple(bar.timestamp_ms for bar in marks)
    if spot_timestamps != perpetual_timestamps or spot_timestamps != mark_timestamps:
        raise EvidenceError(f"{symbol} Spot/perpetual/mark clocks are not identical")
    mark_by_timestamp = {bar.timestamp_ms: bar.open for bar in marks}
    funding: list[FundingEvent] = []
    for timestamp_ms, rate in sorted(funding_rows):
        mark = mark_by_timestamp.get(timestamp_ms)
        if mark is None:
            raise EvidenceError(
                f"{symbol} funding settlement lacks same-clock mark: {timestamp_ms}"
            )
        funding.append(FundingEvent(timestamp_ms, rate, mark))
    if len({event.timestamp_ms for event in funding}) != len(funding):
        raise EvidenceError(f"{symbol} duplicate funding timestamps")
    return SymbolData(symbol, spot_timestamps, spot, perpetual, tuple(funding))


def load_market_data(
    state_root: Path,
    discovery: Mapping[str, object],
    *,
    months: Sequence[str],
) -> MarketData:
    """Open and join one phase of BTC/ETH public archives."""

    lookup = source_lookup(discovery)
    symbols = {
        symbol: load_symbol_data(
            state_root,
            lookup,
            symbol=symbol,
            months=months,
        )
        for symbol in SYMBOLS
    }
    timestamps = symbols["BTCUSDT"].timestamps_ms
    if timestamps != symbols["ETHUSDT"].timestamps_ms:
        raise EvidenceError("BTC and ETH clocks are not identical")
    expected_start = parse_utc(f"{months[0]}-01T00:00:00Z")
    last_month_start = datetime.fromisoformat(f"{months[-1]}-01T00:00:00+00:00")
    if last_month_start.month == 12:
        expected_end_dt = last_month_start.replace(year=last_month_start.year + 1, month=1)
    else:
        expected_end_dt = last_month_start.replace(month=last_month_start.month + 1)
    expected_end = int(expected_end_dt.timestamp() * 1_000)
    expected_count = (expected_end - expected_start) // BAR_MS
    if not timestamps or timestamps[0] != expected_start:
        raise EvidenceError("phase does not start at its exact first UTC month boundary")
    if timestamps[-1] != expected_end - BAR_MS:
        raise EvidenceError("phase does not end at its exact final UTC month boundary")
    if len(timestamps) != expected_count:
        raise EvidenceError(f"phase bar count mismatch: {len(timestamps)} != {expected_count}")
    return MarketData(timestamps, symbols)


def concatenate_market_data(left: MarketData, right: MarketData) -> MarketData:
    """Concatenate contiguous development and holdout data."""

    if not left.timestamps_ms or not right.timestamps_ms:
        raise EvidenceError("cannot concatenate empty market data")
    if right.timestamps_ms[0] - left.timestamps_ms[-1] != BAR_MS:
        raise EvidenceError("market phases are not contiguous")
    symbols: dict[str, SymbolData] = {}
    for symbol in SYMBOLS:
        left_symbol = left.symbols[symbol]
        right_symbol = right.symbols[symbol]
        symbols[symbol] = SymbolData(
            symbol,
            left_symbol.timestamps_ms + right_symbol.timestamps_ms,
            left_symbol.spot + right_symbol.spot,
            left_symbol.perpetual + right_symbol.perpetual,
            tuple(
                sorted(
                    left_symbol.funding + right_symbol.funding,
                    key=lambda event: event.timestamp_ms,
                )
            ),
        )
    return MarketData(left.timestamps_ms + right.timestamps_ms, symbols)


def median_and_mad(values: Sequence[float]) -> tuple[float, float]:
    """Return median and unscaled median absolute deviation."""

    if not values:
        raise EvidenceError("median requested for empty values")
    location = float(statistics.median(values))
    mad = float(statistics.median(abs(value - location) for value in values))
    if not math.isfinite(location) or not math.isfinite(mad):
        raise EvidenceError("median calibration became non-finite")
    return location, mad


def basis_arrays(data: MarketData) -> tuple[list[float], list[float], list[float]]:
    """Compute same-clock log Spot/perpetual bases and the ETH-minus-BTC residual."""

    bases: dict[str, list[float]] = {}
    for symbol in SYMBOLS:
        symbol_data = data.symbols[symbol]
        bases[symbol] = [
            10_000.0 * math.log(perpetual.close / spot.close)
            for spot, perpetual in zip(symbol_data.spot, symbol_data.perpetual, strict=True)
        ]
    btc = bases["BTCUSDT"]
    eth = bases["ETHUSDT"]
    relative = [eth_value - btc_value for btc_value, eth_value in zip(btc, eth, strict=True)]
    return btc, eth, relative


def build_calibrations(
    data: MarketData,
    btc_basis: Sequence[float],
    eth_basis: Sequence[float],
    relative: Sequence[float],
) -> tuple[Calibration | None, ...]:
    """Freeze prior-28-complete-day median/MAD once per UTC day."""

    if not (len(data.timestamps_ms) == len(btc_basis) == len(eth_basis) == len(relative)):
        raise EvidenceError("calibration input lengths differ")
    output: list[Calibration | None] = [None] * len(relative)
    current_day: date | None = None
    calibration: Calibration | None = None
    for index, timestamp_ms in enumerate(data.timestamps_ms):
        day = utc_day(timestamp_ms)
        if day != current_day:
            current_day = day
            if index >= CALIBRATION_BARS:
                window_start = index - CALIBRATION_BARS
                if data.timestamps_ms[window_start] != timestamp_ms - CALIBRATION_DAYS * DAY_MS:
                    raise EvidenceError("calibration window is not 28 complete UTC days")
                location, mad = median_and_mad(relative[window_start:index])
                btc_median = float(statistics.median(btc_basis[window_start:index]))
                eth_median = float(statistics.median(eth_basis[window_start:index]))
                calibration = Calibration(
                    location,
                    max(1.4826 * mad, 1.0),
                    btc_median,
                    eth_median,
                )
            else:
                calibration = None
        output[index] = calibration
    return tuple(output)


def funding_cashflows(
    symbol_data: SymbolData,
    *,
    entry_timestamp_ms: int,
    exit_timestamp_ms: int,
    quantity: float,
) -> tuple[float, float]:
    """Return adverse debit and omitted favorable credit for a short perpetual."""

    adverse = 0.0
    favorable = 0.0
    for event in symbol_data.funding:
        if event.timestamp_ms <= entry_timestamp_ms:
            continue
        if event.timestamp_ms >= exit_timestamp_ms:
            break
        cashflow = quantity * event.mark_price * event.rate
        if cashflow >= 0.0:
            favorable += cashflow
        else:
            adverse += -cashflow
    return adverse, favorable


def make_trade(
    data: MarketData,
    *,
    asset: str,
    entry_index: int,
    exit_index: int,
    exit_reason: str,
) -> Trade:
    """Create a reference-price trade and causal volume-capacity proxy."""

    symbol_data = data.symbols[asset]
    spot_entry = symbol_data.spot[entry_index].open
    spot_exit = symbol_data.spot[exit_index].open
    perpetual_entry = symbol_data.perpetual[entry_index].open
    perpetual_exit = symbol_data.perpetual[exit_index].open
    quantity = LEG_NOTIONAL_USD / spot_entry
    adverse, favorable = funding_cashflows(
        symbol_data,
        entry_timestamp_ms=data.timestamps_ms[entry_index],
        exit_timestamp_ms=data.timestamps_ms[exit_index],
        quantity=quantity,
    )
    entry_observation_index = entry_index - 1
    exit_observation_index = exit_index - 1
    if entry_observation_index < 0 or exit_observation_index < 0:
        raise EvidenceError("capacity proxy lacks prior complete bar")
    volumes = (
        symbol_data.spot[entry_observation_index].quote_volume,
        symbol_data.perpetual[entry_observation_index].quote_volume,
        symbol_data.spot[exit_observation_index].quote_volume,
        symbol_data.perpetual[exit_observation_index].quote_volume,
    )
    minimum_volume = min(volumes)
    return Trade(
        asset=asset,
        entry_index=entry_index,
        exit_index=exit_index,
        entry_timestamp_ms=data.timestamps_ms[entry_index],
        exit_timestamp_ms=data.timestamps_ms[exit_index],
        quantity=quantity,
        spot_entry=spot_entry,
        spot_exit=spot_exit,
        perpetual_entry=perpetual_entry,
        perpetual_exit=perpetual_exit,
        adverse_funding_usd=adverse,
        omitted_favorable_funding_usd=favorable,
        minimum_causal_quote_volume_usd=minimum_volume,
        exit_reason=exit_reason,
    )


def simulate_trial(
    data: MarketData,
    calibrations: Sequence[Calibration | None],
    btc_basis: Sequence[float],
    eth_basis: Sequence[float],
    relative: Sequence[float],
    trial: Trial,
    *,
    evaluation_start_ms: int,
    evaluation_end_ms: int,
) -> TrialRun:
    """Simulate one causal, non-overlapping dislocation trial."""

    if len(calibrations) != len(data.timestamps_ms):
        raise EvidenceError("calibration length differs from market data")
    start_index = next(
        (
            index
            for index, timestamp_ms in enumerate(data.timestamps_ms)
            if timestamp_ms >= evaluation_start_ms
        ),
        len(data.timestamps_ms),
    )
    end_index = next(
        (
            index
            for index, timestamp_ms in enumerate(data.timestamps_ms)
            if timestamp_ms >= evaluation_end_ms
        ),
        len(data.timestamps_ms),
    )
    if start_index >= end_index:
        raise EvidenceError("evaluation range is empty")
    trades: list[Trade] = []
    armed = True
    streak_direction = 0
    streak_count = 0
    pending_entry: tuple[str, Calibration, float] | None = None
    position: tuple[str, int, Calibration, float, int] | None = None
    pending_exit_reason: str | None = None
    for index in range(start_index, end_index):
        if pending_exit_reason is not None:
            if position is None:
                raise EvidenceError("pending exit has no position")
            asset, entry_index, _, _, _ = position
            trades.append(
                make_trade(
                    data,
                    asset=asset,
                    entry_index=entry_index,
                    exit_index=index,
                    exit_reason=pending_exit_reason,
                )
            )
            position = None
            pending_exit_reason = None
            pending_entry = None
            streak_direction = 0
            streak_count = 0
        if pending_entry is not None:
            if position is not None:
                raise EvidenceError("pending entry while already positioned")
            asset, entry_calibration, signed_entry_z = pending_entry
            position = (asset, index, entry_calibration, signed_entry_z, index)
            pending_entry = None
            armed = False
        calibration = calibrations[index]
        if calibration is None:
            continue
        z_value = (relative[index] - calibration.location) / calibration.scale
        if not math.isfinite(z_value):
            raise EvidenceError("signal z-score became non-finite")
        if position is not None:
            asset, entry_index, entry_calibration, signed_entry_z, _ = position
            frozen_z = (relative[index] - entry_calibration.location) / entry_calibration.scale
            direction = 1.0 if asset == "ETHUSDT" else -1.0
            directional_z = direction * frozen_z
            held_bars = index - entry_index
            if directional_z <= 0.5:
                pending_exit_reason = "RELATIVE_RESIDUAL_NORMALIZED"
            elif directional_z >= signed_entry_z + 1.5:
                pending_exit_reason = "RELATIVE_RESIDUAL_WORSENED"
            elif held_bars >= trial.maximum_hold_bars:
                pending_exit_reason = "MAXIMUM_HOLD"
            if pending_exit_reason is not None and index + 1 >= end_index:
                pending_exit_reason = None
            continue
        if abs(z_value) < 1.0:
            armed = True
            streak_direction = 0
            streak_count = 0
            continue
        if not armed:
            continue
        direction = 1 if z_value > 0.0 else -1
        if abs(z_value) < trial.entry_z:
            streak_direction = 0
            streak_count = 0
            continue
        if direction == streak_direction:
            streak_count += 1
        else:
            streak_direction = direction
            streak_count = 1
        if streak_count < 2:
            continue
        asset = "ETHUSDT" if direction > 0 else "BTCUSDT"
        own_basis = eth_basis[index] if asset == "ETHUSDT" else btc_basis[index]
        own_median = calibration.eth_median if asset == "ETHUSDT" else calibration.btc_median
        if own_basis <= 0.0 or own_basis <= own_median:
            continue
        entry_index = index + 1
        if entry_index + trial.maximum_hold_bars + 1 >= end_index:
            continue
        pending_entry = (asset, calibration, abs(z_value))
        streak_direction = 0
        streak_count = 0
    if position is not None or pending_entry is not None or pending_exit_reason is not None:
        raise EvidenceError("position lifecycle crossed the frozen evaluation boundary")
    return TrialRun(trial, tuple(trades))


def trade_pnl(trade: Trade, scenario: CostScenario) -> float:
    """Compute complete four-fill all-taker scenario P&L."""

    adverse = scenario.adverse_execution_bps / 10_000.0
    spot_fee = scenario.spot_fee_bps / 10_000.0
    perpetual_fee = scenario.perpetual_fee_bps / 10_000.0
    spot_entry = trade.spot_entry * (1.0 + adverse)
    spot_exit = trade.spot_exit * (1.0 - adverse)
    perpetual_entry = trade.perpetual_entry * (1.0 - adverse)
    perpetual_exit = trade.perpetual_exit * (1.0 + adverse)
    reference_pnl = trade.quantity * ((spot_exit - spot_entry) + (perpetual_entry - perpetual_exit))
    fees = trade.quantity * (
        spot_fee * (spot_entry + spot_exit) + perpetual_fee * (perpetual_entry + perpetual_exit)
    )
    net = reference_pnl - fees - trade.adverse_funding_usd
    if not math.isfinite(net):
        raise EvidenceError("trade P&L became non-finite")
    return net


def date_sequence(start_ms: int, end_ms: int) -> tuple[date, ...]:
    """Return every UTC date touched by a half-open range."""

    start = utc_day(start_ms)
    end = utc_day(end_ms - 1)
    days: list[date] = []
    current = start
    while current <= end:
        days.append(current)
        current += timedelta(days=1)
    return tuple(days)


def filtered_trades(
    run: TrialRun,
    *,
    start_ms: int,
    end_ms: int,
) -> tuple[Trade, ...]:
    """Keep only trades fully contained in a frozen half-open range."""

    return tuple(
        trade
        for trade in run.trades
        if trade.entry_timestamp_ms >= start_ms and trade.exit_timestamp_ms < end_ms
    )


def daily_returns(
    trades: Sequence[Trade],
    scenario: CostScenario,
    *,
    start_ms: int,
    end_ms: int,
) -> tuple[float, ...]:
    """Aggregate fixed-capital trade P&L into synchronous UTC daily returns."""

    days = date_sequence(start_ms, end_ms)
    pnl_by_day: defaultdict[date, float] = defaultdict(float)
    for trade in trades:
        pnl_by_day[utc_day(trade.exit_timestamp_ms)] += trade_pnl(trade, scenario)
    return tuple(pnl_by_day[day] / CAPITAL_USD for day in days)


def liquidation_pnl(
    data: MarketData,
    trade: Trade,
    scenario: CostScenario,
    *,
    mark_index: int,
) -> float:
    """Mark an open trade at a conservative immediate-liquidation close."""

    symbol_data = data.symbols[trade.asset]
    adverse = scenario.adverse_execution_bps / 10_000.0
    spot_fee = scenario.spot_fee_bps / 10_000.0
    perpetual_fee = scenario.perpetual_fee_bps / 10_000.0
    spot_entry = trade.spot_entry * (1.0 + adverse)
    perpetual_entry = trade.perpetual_entry * (1.0 - adverse)
    spot_exit = symbol_data.spot[mark_index].close * (1.0 - adverse)
    perpetual_exit = symbol_data.perpetual[mark_index].close * (1.0 + adverse)
    reference_pnl = trade.quantity * ((spot_exit - spot_entry) + (perpetual_entry - perpetual_exit))
    fees = trade.quantity * (
        spot_fee * (spot_entry + spot_exit) + perpetual_fee * (perpetual_entry + perpetual_exit)
    )
    funding_debit, _ = funding_cashflows(
        symbol_data,
        entry_timestamp_ms=trade.entry_timestamp_ms,
        exit_timestamp_ms=data.timestamps_ms[mark_index] + 1,
        quantity=trade.quantity,
    )
    return reference_pnl - fees - funding_debit


def maximum_drawdown_pct(
    data: MarketData,
    trades: Sequence[Trade],
    scenario: CostScenario,
) -> float:
    """Compute one continuous portfolio drawdown with intra-trade liquidation marks."""

    realized = 0.0
    peak = CAPITAL_USD
    maximum = 0.0
    for trade in trades:
        for index in range(trade.entry_index, trade.exit_index):
            equity = (
                CAPITAL_USD + realized + liquidation_pnl(data, trade, scenario, mark_index=index)
            )
            peak = max(peak, equity)
            if peak > 0.0:
                maximum = max(maximum, (peak - equity) / peak)
        realized += trade_pnl(trade, scenario)
        equity = CAPITAL_USD + realized
        peak = max(peak, equity)
        if peak > 0.0:
            maximum = max(maximum, (peak - equity) / peak)
    return 100.0 * maximum


def quantile(values: Sequence[float], probability: float) -> float:
    """Return a frozen nearest-lower empirical quantile."""

    if not values:
        raise EvidenceError("quantile requested for empty sequence")
    if probability < 0.0 or probability > 1.0:
        raise EvidenceError("quantile probability outside [0,1]")
    ordered = sorted(values)
    index = min(len(ordered) - 1, math.floor(probability * len(ordered)))
    return ordered[index]


def circular_block_indices(
    *,
    length: int,
    block_length: int,
    rng: random.Random,
) -> tuple[int, ...]:
    """Draw one circular fixed-block resample."""

    if length < 1 or block_length < 1:
        raise EvidenceError("invalid block-bootstrap dimensions")
    indices: list[int] = []
    while len(indices) < length:
        start = rng.randrange(length)
        indices.extend((start + offset) % length for offset in range(block_length))
    return tuple(indices[:length])


def block_statistics(
    matrix: Mapping[str, Sequence[float]],
    *,
    replicates: int,
    seed: int,
    block_length: int,
) -> dict[str, Any]:
    """Compute joint one-sided p-values, basic LCBs, and max reality check."""

    trial_ids = sorted(matrix)
    if not trial_ids:
        raise EvidenceError("statistics matrix is empty")
    lengths = {len(matrix[trial_id]) for trial_id in trial_ids}
    if len(lengths) != 1:
        raise EvidenceError("statistics matrix rows are not synchronous")
    length = next(iter(lengths))
    if length < block_length * 2:
        raise EvidenceError("statistics matrix is too short for block bootstrap")
    observed = {trial_id: statistics.fmean(matrix[trial_id]) for trial_id in trial_ids}
    centered = {
        trial_id: tuple(value - observed[trial_id] for value in matrix[trial_id])
        for trial_id in trial_ids
    }
    exceedances = dict.fromkeys(trial_ids, 0)
    bootstrap_means: dict[str, list[float]] = {trial_id: [] for trial_id in trial_ids}
    observed_max = max(observed.values())
    max_exceedances = 0
    rng = random.Random(seed)
    for _ in range(replicates):
        indices = circular_block_indices(length=length, block_length=block_length, rng=rng)
        centered_means: dict[str, float] = {}
        for trial_id in trial_ids:
            centered_mean = statistics.fmean(centered[trial_id][index] for index in indices)
            centered_means[trial_id] = centered_mean
            bootstrap_means[trial_id].append(observed[trial_id] + centered_mean)
            if centered_mean >= observed[trial_id]:
                exceedances[trial_id] += 1
        if max(centered_means.values()) >= observed_max:
            max_exceedances += 1
    p_values = {trial_id: (1 + exceedances[trial_id]) / (replicates + 1) for trial_id in trial_ids}
    lower_bounds = {
        trial_id: 2.0 * observed[trial_id] - quantile(bootstrap_means[trial_id], 0.95)
        for trial_id in trial_ids
    }
    max_p = (1 + max_exceedances) / (replicates + 1)
    return {
        "observedMeanDailyReturn": observed,
        "oneSidedPValue": p_values,
        "oneSidedBasicLowerBound": lower_bounds,
        "maxRealityCheckPValue": max_p,
        "replicates": replicates,
        "seed": seed,
        "blockLengthDays": block_length,
    }


def holm_decisions(
    p_values: Mapping[str, float],
    *,
    alpha: float,
) -> dict[str, bool]:
    """Apply Holm's step-down FWER procedure to every frozen trial."""

    ordered = sorted(p_values.items(), key=lambda item: (item[1], item[0]))
    decisions = dict.fromkeys(p_values, False)
    still_rejecting = True
    total = len(ordered)
    for index, (trial_id, p_value) in enumerate(ordered):
        threshold = alpha / (total - index)
        if still_rejecting and p_value <= threshold:
            decisions[trial_id] = True
        else:
            still_rejecting = False
    return decisions


def pbo_diagnostic(matrix: Mapping[str, Sequence[float]]) -> dict[str, Any]:
    """Compute frozen 8-block, 4/4 CSCV PBO on development days."""

    trial_ids = sorted(matrix)
    if not trial_ids:
        raise EvidenceError("PBO matrix is empty")
    length = len(matrix[trial_ids[0]])
    if any(len(matrix[trial_id]) != length for trial_id in trial_ids):
        raise EvidenceError("PBO matrix rows differ")
    blocks: list[tuple[int, ...]] = []
    for block in range(8):
        start = math.floor(block * length / 8)
        end = math.floor((block + 1) * length / 8)
        blocks.append(tuple(range(start, end)))
    underperform = 0
    splits = 0
    for in_sample_blocks in itertools.combinations(range(8), 4):
        in_set = set(in_sample_blocks)
        in_indices = tuple(
            index for block in range(8) if block in in_set for index in blocks[block]
        )
        out_indices = tuple(
            index for block in range(8) if block not in in_set for index in blocks[block]
        )
        in_scores = {
            trial_id: sum(matrix[trial_id][index] for index in in_indices) for trial_id in trial_ids
        }
        selected = max(
            trial_ids,
            key=lambda trial_id: (
                in_scores[trial_id],
                -trial_ids.index(trial_id),
            ),
        )
        out_scores = {
            trial_id: sum(matrix[trial_id][index] for index in out_indices)
            for trial_id in trial_ids
        }
        median_score = float(statistics.median(out_scores.values()))
        if out_scores[selected] <= median_score:
            underperform += 1
        splits += 1
    if splits != 70:
        raise EvidenceError(f"PBO split count mismatch: {splits}")
    return {
        "method": "CSCV_8_BLOCK_4_OF_8",
        "splits": splits,
        "underperformingSplits": underperform,
        "pbo": underperform / splits,
        "diagnosticOnly": True,
    }


def scenario_metrics(
    data: MarketData,
    trades: Sequence[Trade],
    scenario: CostScenario,
    *,
    start_ms: int,
    end_ms: int,
) -> dict[str, Any]:
    """Summarize one scenario over one fixed range."""

    selected = tuple(
        trade
        for trade in trades
        if trade.entry_timestamp_ms >= start_ms and trade.exit_timestamp_ms < end_ms
    )
    pnls = [trade_pnl(trade, scenario) for trade in selected]
    by_asset = {
        symbol: sum(trade_pnl(trade, scenario) for trade in selected if trade.asset == symbol)
        for symbol in SYMBOLS
    }
    quarter_pnl: defaultdict[str, float] = defaultdict(float)
    for trade in selected:
        exit_dt = datetime.fromtimestamp(trade.exit_timestamp_ms / 1_000, tz=UTC)
        quarter = f"{exit_dt.year}-Q{((exit_dt.month - 1) // 3) + 1}"
        quarter_pnl[quarter] += trade_pnl(trade, scenario)
    best_quarter = max(quarter_pnl.values(), default=0.0)
    net = sum(pnls)
    return {
        "roundTrips": len(selected),
        "netUsd": net,
        "returnOnInitialCapitalPct": 100.0 * net / CAPITAL_USD,
        "byAssetNetUsd": by_asset,
        "activeCalendarQuarters": sum(1 for value in quarter_pnl.values() if value != 0.0),
        "quarterNetUsd": dict(sorted(quarter_pnl.items())),
        "removeBestQuarterNetUsd": net - best_quarter,
        "maximumLiquidationDrawdownPct": maximum_drawdown_pct(data, selected, scenario),
    }


def capacity_metrics(trades: Sequence[Trade]) -> dict[str, Any]:
    """Evaluate the frozen causal prior-bar volume participation proxy."""

    minimum = min(
        (trade.minimum_causal_quote_volume_usd for trade in trades),
        default=0.0,
    )
    base_capacity = minimum * 1.0 / 10_000.0
    stress_capacity = minimum * 0.5 / 10_000.0
    return {
        "authority": "CAUSAL_PRIOR_COMPLETE_FIVE_MINUTE_QUOTE_VOLUME_PROXY_ONLY",
        "minimumObservedFourLegQuoteVolumeUsd": minimum,
        "baseOneWayLegCapacityUsd": base_capacity,
        "stressOneWayLegCapacityUsd": stress_capacity,
        "legNotionalUsd": LEG_NOTIONAL_USD,
        "basePass": bool(trades) and base_capacity >= LEG_NOTIONAL_USD,
        "stressPass": bool(trades) and stress_capacity >= LEG_NOTIONAL_USD,
        "executableCapacity": "UNMEASURED",
    }


def round_float_values(value: Any) -> Any:
    """Round finite floats recursively for stable reader-facing evidence."""

    if isinstance(value, float):
        if not math.isfinite(value):
            raise EvidenceError("result contains non-finite float")
        return round(value, 12)
    if isinstance(value, dict):
        return {
            str(key): round_float_values(item)
            for key, item in cast(dict[object, Any], value).items()
        }
    if isinstance(value, (list, tuple)):
        return [round_float_values(item) for item in cast(Sequence[Any], value)]
    return value


def walk_forward_evidence(
    runs: Mapping[str, TrialRun],
    scenarios: Mapping[str, CostScenario],
) -> dict[str, Any]:
    """Select causally on expanding training and score the next untouched fold."""

    folds = (
        (
            "WF1",
            parse_utc("2025-07-01T00:00:00Z"),
            parse_utc("2025-10-01T00:00:00Z"),
            parse_utc("2025-10-01T00:00:00Z"),
            parse_utc("2026-01-01T00:00:00Z"),
        ),
        (
            "WF2",
            parse_utc("2025-07-01T00:00:00Z"),
            parse_utc("2026-01-01T00:00:00Z"),
            parse_utc("2026-01-01T00:00:00Z"),
            parse_utc("2026-04-01T00:00:00Z"),
        ),
    )
    stress = scenarios["stress"]
    rows: list[dict[str, Any]] = []
    all_forward_positive = True
    for fold_id, train_start, train_end, forward_start, forward_end in folds:
        training_net = {
            trial_id: sum(
                trade_pnl(trade, stress)
                for trade in filtered_trades(run, start_ms=train_start, end_ms=train_end)
            )
            for trial_id, run in runs.items()
        }
        selected_id = sorted(
            training_net,
            key=lambda trial_id: (-training_net[trial_id], trial_id),
        )[0]
        forward_trades = filtered_trades(
            runs[selected_id],
            start_ms=forward_start,
            end_ms=forward_end,
        )
        forward_net = sum(trade_pnl(trade, stress) for trade in forward_trades)
        forward_positive = bool(forward_trades) and forward_net > 0.0
        all_forward_positive = all_forward_positive and forward_positive
        rows.append(
            {
                "foldId": fold_id,
                "selectedTrialId": selected_id,
                "trainingStressNetUsd": training_net[selected_id],
                "forwardStressNetUsd": forward_net,
                "forwardRoundTrips": len(forward_trades),
                "forwardPositive": forward_positive,
                "trainStartMs": train_start,
                "trainEndMs": train_end,
                "forwardStartMs": forward_start,
                "forwardEndMs": forward_end,
            }
        )
    return {
        "method": "TWO_EXPANDING_CAUSAL_TRAIN_FORWARD_FOLDS",
        "folds": rows,
        "allForwardStressNetPositive": all_forward_positive,
    }


def evaluate_development(data: MarketData, protocol: Mapping[str, Any]) -> dict[str, Any]:
    """Evaluate all frozen trials on development and causal walk-forward folds."""

    start_ms = parse_utc(cast(str, protocol["calendar"]["development"]["startInclusive"]))
    end_ms = parse_utc(cast(str, protocol["calendar"]["development"]["endExclusive"]))
    btc_basis, eth_basis, relative = basis_arrays(data)
    calibrations = build_calibrations(data, btc_basis, eth_basis, relative)
    runs = {
        trial.trial_id: simulate_trial(
            data,
            calibrations,
            btc_basis,
            eth_basis,
            relative,
            trial,
            evaluation_start_ms=start_ms,
            evaluation_end_ms=end_ms,
        )
        for trial in trial_family()
    }
    scenario_by_name = {scenario.name: scenario for scenario in cost_scenarios()}
    stress_matrix = {
        trial_id: daily_returns(
            run.trades,
            scenario_by_name["stress"],
            start_ms=start_ms,
            end_ms=end_ms,
        )
        for trial_id, run in runs.items()
    }
    statistics_config = cast(Mapping[str, Any], protocol["statistics"]["bootstrap"])
    block_result = block_statistics(
        stress_matrix,
        replicates=int(statistics_config["replicates"]),
        seed=int(statistics_config["seed"]),
        block_length=int(statistics_config["blockLengthDays"]),
    )
    p_values = cast(Mapping[str, float], block_result["oneSidedPValue"])
    lower_bounds = cast(Mapping[str, float], block_result["oneSidedBasicLowerBound"])
    holm = holm_decisions(p_values, alpha=0.05)
    pbo = pbo_diagnostic(stress_matrix)
    walk_forward = walk_forward_evidence(runs, scenario_by_name)
    max_rc_pass = (
        require_number(block_result["maxRealityCheckPValue"], field="max reality-check p") <= 0.05
    )
    pbo_pass = require_number(pbo["pbo"], field="PBO") <= 0.50
    trial_rows: dict[str, dict[str, Any]] = {}
    eligible: list[str] = []
    for trial_id in sorted(runs):
        run = runs[trial_id]
        scenarios = {
            scenario.name: scenario_metrics(
                data,
                run.trades,
                scenario,
                start_ms=start_ms,
                end_ms=end_ms,
            )
            for scenario in cost_scenarios()
        }
        stress_metrics = scenarios["stress"]
        route_counts = {
            symbol: sum(1 for trade in run.trades if trade.asset == symbol) for symbol in SYMBOLS
        }
        capacity = capacity_metrics(run.trades)
        gates = {
            "minimumDevelopmentRoundTrips": len(run.trades) >= 24,
            "minimumRoundTripsPerAsset": all(route_counts[symbol] >= 8 for symbol in SYMBOLS),
            "minimumActiveCalendarQuarters": int(stress_metrics["activeCalendarQuarters"]) >= 3,
            "baseStressAndSevereNetPositive": all(
                require_number(scenarios[name]["netUsd"], field=f"{name} net") > 0.0
                for name in ("base", "stress", "severe")
            ),
            "bothAssetsStressPositive": all(
                require_number(
                    cast(Mapping[str, object], stress_metrics["byAssetNetUsd"])[symbol],
                    field=f"{symbol} stress net",
                )
                > 0.0
                for symbol in SYMBOLS
            ),
            "removeBestQuarterStressPositive": require_number(
                stress_metrics["removeBestQuarterNetUsd"],
                field="remove-best-quarter stress net",
            )
            > 0.0,
            "maximumLiquidationDrawdownAtMostTenPct": all(
                require_number(
                    scenarios[name]["maximumLiquidationDrawdownPct"],
                    field=f"{name} drawdown",
                )
                <= 10.0
                for name in ("base", "stress", "severe")
            ),
            "stressLowerBoundPositive": lower_bounds[trial_id] > 0.0,
            "holmPass": holm[trial_id],
            "maxRealityCheckPass": max_rc_pass,
            "pboAtMostMaximum": pbo_pass,
            "walkForwardStressPositiveEachFold": bool(walk_forward["allForwardStressNetPositive"]),
            "baseAndStressCapacityProxyPass": bool(capacity["basePass"])
            and bool(capacity["stressPass"]),
        }
        is_eligible = all(gates.values())
        if is_eligible:
            eligible.append(trial_id)
        trial_rows[trial_id] = {
            "trialId": trial_id,
            "entryThresholdZ": run.trial.entry_z,
            "maximumHoldBars": run.trial.maximum_hold_bars,
            "roundTrips": len(run.trades),
            "routedRoundTrips": route_counts,
            "omittedFavorableFundingUsd": sum(
                trade.omitted_favorable_funding_usd for trade in run.trades
            ),
            "adverseFundingDebitedUsd": sum(trade.adverse_funding_usd for trade in run.trades),
            "exitReasons": dict(
                sorted(
                    {
                        reason: sum(1 for trade in run.trades if trade.exit_reason == reason)
                        for reason in {trade.exit_reason for trade in run.trades}
                    }.items()
                )
            ),
            "scenarios": scenarios,
            "capacity": capacity,
            "oneSidedPValue": p_values[trial_id],
            "oneSidedBasicLowerBoundDailyReturn": lower_bounds[trial_id],
            "holmPass": holm[trial_id],
            "gates": gates,
            "eligible": is_eligible,
        }
    champion: str | None = None
    if eligible:
        champion = sorted(
            eligible,
            key=lambda trial_id: (
                -lower_bounds[trial_id],
                -require_number(
                    trial_rows[trial_id]["scenarios"]["stress"]["netUsd"],
                    field="champion stress net",
                ),
                trial_id,
            ),
        )[0]
    return {
        "state": (
            "DEVELOPMENT_CHAMPION_ELIGIBLE"
            if champion is not None
            else "DEVELOPMENT_FAMILY_REJECTED"
        ),
        "sample": {
            "startMs": start_ms,
            "endMs": end_ms,
            "barsPerSymbol": len(data.timestamps_ms),
            "calendarDays": len(date_sequence(start_ms, end_ms)),
        },
        "trialCount": len(runs),
        "trials": trial_rows,
        "walkForward": walk_forward,
        "jointBlockStatistics": block_result,
        "holmDecisions": holm,
        "pbo": pbo,
        "eligibleTrialIds": eligible,
        "championTrialId": champion,
        "_runs": runs,
    }


def evaluate_holdout(
    data: MarketData,
    protocol: Mapping[str, Any],
    *,
    champion: Trial,
) -> dict[str, Any]:
    """Evaluate the single sealed champion on the once-opened holdout."""

    start_ms = parse_utc(cast(str, protocol["calendar"]["holdout"]["startInclusive"]))
    end_ms = parse_utc(cast(str, protocol["calendar"]["holdout"]["endExclusive"]))
    btc_basis, eth_basis, relative = basis_arrays(data)
    calibrations = build_calibrations(data, btc_basis, eth_basis, relative)
    run = simulate_trial(
        data,
        calibrations,
        btc_basis,
        eth_basis,
        relative,
        champion,
        evaluation_start_ms=start_ms,
        evaluation_end_ms=end_ms,
    )
    scenarios = {
        scenario.name: scenario_metrics(
            data,
            run.trades,
            scenario,
            start_ms=start_ms,
            end_ms=end_ms,
        )
        for scenario in cost_scenarios()
    }
    scenario_by_name = {scenario.name: scenario for scenario in cost_scenarios()}
    stress_returns = daily_returns(
        run.trades,
        scenario_by_name["stress"],
        start_ms=start_ms,
        end_ms=end_ms,
    )
    statistics_config = cast(Mapping[str, Any], protocol["statistics"]["bootstrap"])
    stats = block_statistics(
        {champion.trial_id: stress_returns},
        replicates=int(statistics_config["replicates"]),
        seed=int(statistics_config["seed"]) + 1,
        block_length=int(statistics_config["blockLengthDays"]),
    )
    p_value = require_number(
        cast(Mapping[str, object], stats["oneSidedPValue"])[champion.trial_id],
        field="holdout p-value",
    )
    lower_bound = require_number(
        cast(Mapping[str, object], stats["oneSidedBasicLowerBound"])[champion.trial_id],
        field="holdout lower bound",
    )
    capacity = capacity_metrics(run.trades)
    stress = scenarios["stress"]
    route_counts = {
        symbol: sum(1 for trade in run.trades if trade.asset == symbol) for symbol in SYMBOLS
    }
    gates = {
        "minimumHoldoutRoundTrips": len(run.trades) >= 8,
        "baseStressAndSevereNetPositive": all(
            require_number(scenarios[name]["netUsd"], field=f"holdout {name} net") > 0.0
            for name in ("base", "stress", "severe")
        ),
        "bothAssetsStressPositive": all(
            require_number(
                cast(Mapping[str, object], stress["byAssetNetUsd"])[symbol],
                field=f"holdout {symbol} stress net",
            )
            > 0.0
            for symbol in SYMBOLS
        ),
        "stressLowerBoundPositive": lower_bound > 0.0,
        "oneSidedPValueAtMostPointZeroFive": p_value <= 0.05,
        "maximumLiquidationDrawdownAtMostTenPct": all(
            require_number(
                scenarios[name]["maximumLiquidationDrawdownPct"],
                field=f"holdout {name} drawdown",
            )
            <= 10.0
            for name in ("base", "stress", "severe")
        ),
        "baseAndStressCapacityProxyPass": bool(capacity["basePass"])
        and bool(capacity["stressPass"]),
    }
    return {
        "state": ("HOLDOUT_PUBLIC_PROXY_POSITIVE" if all(gates.values()) else "HOLDOUT_REJECTED"),
        "championTrialId": champion.trial_id,
        "sample": {
            "startMs": start_ms,
            "endMs": end_ms,
            "calendarDays": len(date_sequence(start_ms, end_ms)),
        },
        "roundTrips": len(run.trades),
        "routedRoundTrips": route_counts,
        "omittedFavorableFundingUsd": sum(
            trade.omitted_favorable_funding_usd for trade in run.trades
        ),
        "adverseFundingDebitedUsd": sum(trade.adverse_funding_usd for trade in run.trades),
        "scenarios": scenarios,
        "capacity": capacity,
        "blockStatistics": stats,
        "gates": gates,
        "allGatesPass": all(gates.values()),
    }


def trial_by_id(trial_id: str) -> Trial:
    """Resolve one member of the immutable trial family."""

    for trial in trial_family():
        if trial.trial_id == trial_id:
            return trial
    raise EvidenceError(f"unknown frozen trial: {trial_id}")


def public_limitations() -> list[str]:
    """Return the terminal public-evidence limitations."""

    return [
        "ACCOUNT_EFFECTIVE_SPOT_AND_USD_M_FEES_UNKNOWN",
        "USD_M_FIVE_BPS_BASELINE_IS_OFFICIAL_FAQ_HYPOTHETICAL_NOT_CURRENT_ACCOUNT_TRUTH",
        "HISTORICAL_MATCHED_BID_ASK_DEPTH_QUEUE_IMPACT_AND_TWO_LEG_ATOMICITY_UNAVAILABLE",
        "NEXT_BAR_OPEN_PLUS_FIXED_ADVERSE_EXECUTION_IS_A_PROXY_NOT_FILL_PROOF",
        "HISTORICAL_FILTER_AND_SYMBOL_RULE_CONTINUITY_UNAVAILABLE",
        "QUOTE_VOLUME_PARTICIPATION_IS_NOT_EXECUTABLE_CAPACITY",
        "USDT_USD_PARITY_AND_CAPITAL_OPPORTUNITY_COST_UNMEASURED",
    ]


def terminal_result_base(
    *,
    freeze_digest: str,
    discovery_digest: str,
) -> dict[str, Any]:
    """Return fields shared by every terminal result."""

    return {
        "schema": "S1HResultV1",
        "protocolId": "s1h-binance-btc-eth-relative-basis-dislocation-v1",
        "canonicalBaseCommit": "a169b123fb186d1943a75ad648552c4d95be1be1",
        "consumer": "N3_PROFITABILITY_VERDICT",
        "freezeSha256": freeze_digest,
        "discoverySha256": discovery_digest,
        "runCountAllowed": 1,
        "runCountConsumed": 1,
        "publicOnly": True,
        "capitalVerdict": "NO_GO",
        "executionAuthority": "NONE",
        "knownLimitations": public_limitations(),
    }


def write_result_candidate(state_root: Path, result: Mapping[str, Any]) -> None:
    """Seal the sole external terminal result candidate."""

    path = state_root / RESULT_CANDIDATE_NAME
    exclusive_write(path, canonical_bytes(round_float_values(dict(result))))


def run_experiment(state_root: Path) -> dict[str, Any]:
    """Consume the one sealed evaluation run and emit one terminal candidate."""

    if RESULT_PATH.exists():
        raise EvidenceError("tracked result already exists")
    if (state_root / RESULT_CANDIDATE_NAME).exists():
        raise EvidenceError("external result candidate already exists")
    if (state_root / RUN_MARKER_NAME).exists():
        raise EvidenceError("sole run was already consumed")
    committed_freeze = verify_committed_freeze(state_root)
    discovery, discovery_raw = load_json(state_root / DISCOVERY_NAME)
    raw_sources = discovery.get("sources")
    if not isinstance(raw_sources, list) or len(raw_sources) != 96:
        raise EvidenceError("complete source inventory unavailable")
    for raw_source in raw_sources:
        if not isinstance(raw_source, dict):
            raise EvidenceError("source row invalid before run")
        source = cast(dict[str, object], raw_source)
        path = archive_path(state_root, source)
        expected = source.get("sha256")
        if not isinstance(expected, str) or not path.exists():
            raise EvidenceError(f"acquired archive missing: {path}")
        if sha256_file(path) != expected:
            raise EvidenceError(f"acquired archive digest mismatch: {path}")
    _, freeze_raw = load_json(FREEZE_PATH)
    freeze_digest = sha256_bytes(freeze_raw)
    discovery_digest = sha256_bytes(discovery_raw)
    marker = {
        "schema": "S1HRunConsumedV1",
        "protocolId": committed_freeze["protocolId"],
        "freezeSha256": freeze_digest,
        "discoverySha256": discovery_digest,
        "state": "SOLE_ARCHIVE_CONTENT_OPEN_RUN_CONSUMED",
        "consumedRunCount": 1,
        "networkPermitted": False,
    }
    exclusive_write(state_root / RUN_MARKER_NAME, canonical_bytes(marker))
    phase = "DEVELOPMENT_ARCHIVE_OPEN"
    try:
        protocol, _ = load_json(PROTOCOL_PATH)
        development_data = load_market_data(
            state_root,
            discovery,
            months=DEVELOPMENT_MONTHS,
        )
        phase = "DEVELOPMENT_EVALUATION"
        development = evaluate_development(development_data, protocol)
        runs = development.pop("_runs")
        if not isinstance(runs, dict):
            raise EvidenceError("development trial runs missing")
        champion_id = development.get("championTrialId")
        result = terminal_result_base(
            freeze_digest=freeze_digest,
            discovery_digest=discovery_digest,
        )
        result["development"] = development
        if champion_id is None:
            result.update(
                {
                    "state": "TERMINAL_NO_GO_HOLDOUT_UNOPENED",
                    "measurementVerdict": "NO_GO",
                    "publicProxyVerdict": "NO_GO",
                    "verdictReason": "NO_DEVELOPMENT_TRIAL_PASSED_ALL_PREDECLARED_GATES",
                    "holdoutOpened": False,
                    "holdout": None,
                }
            )
            write_result_candidate(state_root, result)
            return cast(dict[str, Any], round_float_values(result))
        if not isinstance(champion_id, str):
            raise EvidenceError("champion identity malformed")
        champion = trial_by_id(champion_id)
        phase = "CANDIDATE_SEAL"
        candidate_seal = {
            "schema": "S1HCandidateSealV1",
            "state": "ONE_DEVELOPMENT_CHAMPION_SEALED_BEFORE_HOLDOUT_OPEN",
            "championTrialId": champion_id,
            "freezeSha256": freeze_digest,
            "developmentEvidenceSha256": sha256_bytes(canonical_bytes(development)),
            "holdoutOpened": False,
        }
        exclusive_write(
            state_root / CANDIDATE_SEAL_NAME,
            canonical_bytes(round_float_values(candidate_seal)),
        )
        phase = "HOLDOUT_OPEN_MARKER"
        holdout_marker = {
            "schema": "S1HHoldoutOpenV1",
            "state": "SOLE_CHAMPION_ONLY_HOLDOUT_OPEN_CONSUMED",
            "championTrialId": champion_id,
            "candidateSealSha256": sha256_file(state_root / CANDIDATE_SEAL_NAME),
            "holdoutMonths": list(HOLDOUT_MONTHS),
            "openCount": 1,
            "networkPermitted": False,
        }
        exclusive_write(
            state_root / HOLDOUT_MARKER_NAME,
            canonical_bytes(holdout_marker),
        )
        phase = "HOLDOUT_ARCHIVE_OPEN"
        holdout_data = load_market_data(
            state_root,
            discovery,
            months=HOLDOUT_MONTHS,
        )
        phase = "HOLDOUT_EVALUATION"
        complete_data = concatenate_market_data(development_data, holdout_data)
        holdout = evaluate_holdout(complete_data, protocol, champion=champion)
        public_positive = bool(holdout["allGatesPass"])
        result.update(
            {
                "state": (
                    "TERMINAL_UNMEASURED_PUBLIC_PROXY_POSITIVE"
                    if public_positive
                    else "TERMINAL_NO_GO_HOLDOUT_REJECTED"
                ),
                "measurementVerdict": "UNMEASURED" if public_positive else "NO_GO",
                "publicProxyVerdict": (
                    "PUBLIC_BASELINE_SENSITIVITY_POSITIVE" if public_positive else "NO_GO"
                ),
                "verdictReason": (
                    "PUBLIC_PROXY_GATES_PASS_ACCOUNT_AND_EXECUTION_TRUTH_UNMEASURED"
                    if public_positive
                    else "SEALED_CHAMPION_FAILED_ONE_OR_MORE_HOLDOUT_GATES"
                ),
                "holdoutOpened": True,
                "holdout": holdout,
                "candidateSealSha256": sha256_file(state_root / CANDIDATE_SEAL_NAME),
                "holdoutOpenMarkerSha256": sha256_file(state_root / HOLDOUT_MARKER_NAME),
            }
        )
        write_result_candidate(state_root, result)
        return cast(dict[str, Any], round_float_values(result))
    except Exception as exc:
        terminal = terminal_result_base(
            freeze_digest=freeze_digest,
            discovery_digest=discovery_digest,
        )
        terminal.update(
            {
                "state": "TERMINAL_UNMEASURED_RUN_CONSUMED",
                "measurementVerdict": "UNMEASURED",
                "publicProxyVerdict": "INVALID",
                "verdictReason": "SEALED_RUN_EVIDENCE_INVALID",
                "failurePhase": phase,
                "failureType": type(exc).__name__,
                "failure": str(exc),
                "holdoutOpened": (state_root / HOLDOUT_MARKER_NAME).exists(),
                "holdout": None,
            }
        )
        write_result_candidate(state_root, terminal)
        return cast(dict[str, Any], round_float_values(terminal))


def parse_checksum_manifest(path: Path) -> dict[str, str]:
    """Parse the tracked SHA256SUMS manifest."""

    rows: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line:
            continue
        parts = line.split(maxsplit=1)
        if len(parts) != 2:
            raise EvidenceError("SHA256SUMS row malformed")
        digest, filename = parts
        filename = filename.lstrip("*")
        if Path(filename).name != filename:
            raise EvidenceError("SHA256SUMS may name only packet files")
        if filename in rows:
            raise EvidenceError("SHA256SUMS contains duplicate filename")
        rows[filename] = digest
    return rows


def report(state_root: Path) -> dict[str, Any]:
    """Authenticate the terminal committed packet without network or recomputation."""

    freeze = verify_committed_freeze(state_root)
    if not (state_root / RUN_MARKER_NAME).exists():
        return {
            "state": "FROZEN_NOT_RUN",
            "freezeSha256": sha256_file(FREEZE_PATH),
            "runCountConsumed": 0,
        }
    if not RESULT_PATH.exists():
        return {
            "state": "SEALED_RUN_CONSUMED_RESULT_NOT_COMMITTED",
            "freezeSha256": sha256_file(FREEZE_PATH),
            "runCountConsumed": 1,
        }
    result, _ = load_json(RESULT_PATH)
    external_result, _ = load_json(state_root / RESULT_CANDIDATE_NAME)
    if canonical_bytes(result) != canonical_bytes(external_result):
        raise EvidenceError("committed result differs from sealed external result")
    measurement = result.get("measurementVerdict")
    if measurement not in {"GO", "NO_GO", "UNMEASURED"}:
        raise EvidenceError("terminal measurement verdict malformed")
    if result.get("capitalVerdict") != "NO_GO":
        raise EvidenceError("capital verdict exceeded public research authority")
    if result.get("executionAuthority") != "NONE":
        raise EvidenceError("execution authority exceeded NONE")
    holdout_opened = bool(result.get("holdoutOpened"))
    if holdout_opened != (state_root / HOLDOUT_MARKER_NAME).exists():
        raise EvidenceError("holdout marker/result state contradiction")
    checksum_status = "NOT_COMMITTED"
    checked_files = 0
    if CHECKSUMS_PATH.exists():
        manifest = parse_checksum_manifest(CHECKSUMS_PATH)
        expected_names = {
            "README.md",
            "OFFICIAL_SOURCE_RESEARCH.md",
            "protocol.v1.json",
            "experiment.py",
            "test_experiment.py",
            "freeze.v1.json",
            "result.v1.json",
        }
        if set(manifest) != expected_names:
            raise EvidenceError("SHA256SUMS file set mismatch")
        for filename, digest in manifest.items():
            actual = sha256_file(HERE / filename)
            if actual != digest:
                raise EvidenceError(f"SHA256SUMS mismatch: {filename}")
            checked_files += 1
        checksum_status = "PASS"
    return {
        "state": "TERMINAL_PACKET_AUTHENTICATED",
        "protocolId": freeze["protocolId"],
        "measurementVerdict": measurement,
        "publicProxyVerdict": result.get("publicProxyVerdict"),
        "capitalVerdict": "NO_GO",
        "executionAuthority": "NONE",
        "holdoutOpened": holdout_opened,
        "freezeSha256": sha256_file(FREEZE_PATH),
        "resultSha256": sha256_file(RESULT_PATH),
        "checksumStatus": checksum_status,
        "checkedFiles": checked_files,
        "recomputedOutcomes": False,
        "networkUsed": False,
    }


def build_parser() -> argparse.ArgumentParser:
    """Build the sealed lifecycle CLI."""

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--state-root",
        type=Path,
        default=DEFAULT_STATE_ROOT,
        help="external raw/state evidence root",
    )
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("discover", help="fetch checksum sidecars only")
    commands.add_parser("freeze", help="emit pre-outcome freeze candidate")
    commands.add_parser("acquire", help="download but do not open archive ZIPs")
    commands.add_parser("run", help="consume the sole sealed evaluation run")
    commands.add_parser("report", help="authenticate without recomputation")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    """Run one CLI command and print canonical JSON."""

    parser = build_parser()
    arguments = parser.parse_args(argv)
    state_root = cast(Path, arguments.state_root).resolve()
    command = cast(str, arguments.command)
    try:
        if command == "discover":
            output = discover(state_root)
        elif command == "freeze":
            output = freeze(state_root)
        elif command == "acquire":
            output = acquire(state_root)
        elif command == "run":
            output = run_experiment(state_root)
        elif command == "report":
            output = report(state_root)
        else:
            raise EvidenceError(f"unknown command: {command}")
    except EvidenceError as exc:
        print(canonical_bytes({"error": str(exc), "state": "ERROR"}).decode(), end="")
        return 2
    print(canonical_bytes(round_float_values(output)).decode(), end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
