#!/usr/bin/env python3
"""Sealed public-only V-G20 synchronized-major volume-diffusion experiment."""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import itertools
import json
import math
import random
import statistics
import subprocess
import sys
import tempfile
import zipfile
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal, InvalidOperation, getcontext
from pathlib import Path
from typing import Any, cast

getcontext().prec = 50

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[2]
PROTOCOL_PATH = HERE / "protocol.v1.json"
SOURCE_RESEARCH_PATH = HERE / "OFFICIAL_SOURCE_RESEARCH.md"
README_PATH = HERE / "README.md"
TESTS_PATH = HERE / "test_experiment.py"
SOURCE_MANIFEST_PATH = HERE / "source-manifest.v1.json"
FREEZE_PATH = HERE / "freeze.v1.json"
RUN_MARKER_PATH = HERE / "run-marker.v1.json"
COHORT_SEAL_PATH = HERE / "cohort-seal.v1.json"
DEVELOPMENT_PATH = HERE / "development.v1.json"
SELECTION_PATH = HERE / "selection.v1.json"
HOLDOUT_OPEN_PATH = HERE / "holdout-open.v1.json"
RESULT_PATH = HERE / "result.v1.json"
SHA256SUMS_PATH = HERE / "SHA256SUMS"

BASE_COMMIT = "a169b123fb186d1943a75ad648552c4d95be1be1"
SOURCE_ROOT = Path("/private/tmp/cosmos-s1f-weekly-momentum-cash-v1")
SOURCE_ACQUISITION = SOURCE_ROOT / "acquisition-manifest.v1.json"
SOURCE_DISCOVERY = SOURCE_ROOT / "discovery.v1.json"
ACQUISITION_SHA = "01f58272602e43bfb914b649adc00d8273b2d423492220a55f86443bb6441176"
DISCOVERY_SHA = "b4a8f7abd36df19eff0510dfcc3c61fd0df9fdcab5f4d248892ee10010fb21c3"

WARMUP_START = date(2025, 5, 1)
DEVELOPMENT_START = date(2025, 7, 1)
DEVELOPMENT_END = date(2026, 3, 1)
HOLDOUT_START = DEVELOPMENT_END
HOLDOUT_END = date(2026, 7, 1)
SOURCE_MONTHS = tuple(
    f"{year:04d}-{month:02d}"
    for year, start, end in ((2025, 5, 12), (2026, 1, 6))
    for month in range(start, end + 1)
)
WARMUP_MONTHS = ("2025-05", "2025-06")
DEVELOPMENT_MONTHS = tuple(month for month in SOURCE_MONTHS if month < "2026-03")
HOLDOUT_MONTHS = ("2026-03", "2026-04", "2026-05", "2026-06")

LEADERS = ("BTCUSDT", "ETHUSDT")
COHORT_SIZE = 10
WARMUP_DAYS = 61
INITIAL_USD = Decimal("1000")
FEE_RATE = Decimal("0.0010")
BASE_ADVERSE = Decimal("0.0010")
STRESS_ADVERSE = Decimal("0.0025")
PARTICIPATION = Decimal("0.0001")
BOOTSTRAP_SEED = 202_607_292_020
BOOTSTRAP_REPLICATES = 4_096
BOOTSTRAP_BLOCK = 7
ALPHA = 0.05
DAY_US = 86_400_000_000
ZERO = Decimal(0)
ONE = Decimal(1)
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

JsonObject = dict[str, Any]


class VG20Error(RuntimeError):
    """A frozen contract or source-custody invariant failed."""


class MeasurementError(RuntimeError):
    """The preregistered estimate cannot be measured."""


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


@dataclass(frozen=True, slots=True)
class Trial:
    trial_id: str
    lookback_days: int
    joint_shock_ratio: Decimal
    hold_days: int


@dataclass(frozen=True, slots=True)
class Event:
    signal_day: date
    entry_day: date
    exit_day: date
    gross_return: Decimal
    base_return: Decimal
    stress_return: Decimal
    benchmark_stress_return: Decimal
    effective_capacity_proxy_usd: Decimal


@dataclass(frozen=True, slots=True)
class Simulation:
    trial: Trial
    days: tuple[date, ...]
    gross_daily_usd: tuple[Decimal, ...]
    base_daily_usd: tuple[Decimal, ...]
    stress_daily_usd: tuple[Decimal, ...]
    benchmark_excess_daily_usd: tuple[Decimal, ...]
    events: tuple[Event, ...]
    potential_events: int
    cash_overlap_events: int
    cash_incomplete_cohort_events: int
    active_months: int
    stress_max_drawdown: Decimal
    effective_capacity_proxy_usd: Decimal | None


def utc_now() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def canonical_bytes(value: object) -> bytes:
    return (
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n"
    ).encode()


def canonical_sha(value: object) -> str:
    return hashlib.sha256(canonical_bytes(value)).hexdigest()


def sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def load_json(path: Path) -> JsonObject:
    with path.open("rb") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise VG20Error(f"{path.name} must contain one JSON object")
    return cast(JsonObject, value)


def write_json_once(path: Path, value: object) -> None:
    if path.exists():
        raise VG20Error(f"refusing to overwrite {path.name}")
    write_json_replace(path, value)


def write_json_replace(path: Path, value: object) -> None:
    raw = canonical_bytes(value)
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as handle:
        temporary = Path(handle.name)
        handle.write(raw)
        handle.flush()
    temporary.replace(path)


def date_range(start: date, end_exclusive: date) -> tuple[date, ...]:
    return tuple(start + timedelta(days=offset) for offset in range((end_exclusive - start).days))


def trial_grid() -> tuple[Trial, ...]:
    trials: list[Trial] = []
    for lookback in (10, 20, 40):
        for threshold_text in ("1.50", "2.00"):
            for hold in (1, 3):
                threshold = Decimal(threshold_text)
                trial_id = f"VG20-L{lookback:02d}-J{int(threshold * 100):03d}-H{hold}"
                trials.append(Trial(trial_id, lookback, threshold, hold))
    return tuple(trials)


def verify_sidecar(raw: bytes, archive_name: str, archive_sha: str) -> None:
    try:
        text = raw.decode("ascii").strip()
    except UnicodeDecodeError as exc:
        raise VG20Error(f"non-ASCII checksum sidecar: {archive_name}") from exc
    fields = text.split()
    if len(fields) != 2:
        raise VG20Error(f"invalid checksum grammar: {archive_name}")
    digest, filename = fields
    if digest.lower() != archive_sha:
        raise VG20Error(f"official checksum mismatch: {archive_name}")
    if filename.lstrip("*") != archive_name:
        raise VG20Error(f"official checksum filename mismatch: {archive_name}")


def git_output(*arguments: str) -> str:
    completed = subprocess.run(
        ("git", *arguments),
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return completed.stdout.strip()


def freeze_command(state_root: Path) -> JsonObject:
    if any(
        path.exists()
        for path in (
            SOURCE_MANIFEST_PATH,
            FREEZE_PATH,
            RUN_MARKER_PATH,
            COHORT_SEAL_PATH,
            DEVELOPMENT_PATH,
            SELECTION_PATH,
            HOLDOUT_OPEN_PATH,
            RESULT_PATH,
        )
    ):
        raise VG20Error("freeze authority already consumed")
    if state_root.resolve() != SOURCE_ROOT.resolve():
        raise VG20Error("state root differs from frozen protocol")
    if sha256_path(SOURCE_ACQUISITION) != ACQUISITION_SHA:
        raise VG20Error("source acquisition manifest digest mismatch")
    if sha256_path(SOURCE_DISCOVERY) != DISCOVERY_SHA:
        raise VG20Error("source discovery digest mismatch")
    if subprocess.run(
        ("git", "merge-base", "--is-ancestor", BASE_COMMIT, "HEAD"),
        cwd=REPO_ROOT,
        check=False,
    ).returncode:
        raise VG20Error("candidate is not descended from the exact canonical base")

    acquisition = load_json(SOURCE_ACQUISITION)
    discovery = load_json(SOURCE_DISCOVERY)
    universe_obj = cast(JsonObject, discovery["universe"])
    symbols = tuple(cast(list[str], universe_obj["symbols"]))
    if symbols != tuple(sorted(symbols)) or len(symbols) != len(set(symbols)):
        raise VG20Error("discovery universe is not unique and sorted")
    admitted_symbols = set(symbols)
    admitted_months = set(SOURCE_MONTHS)
    records: list[JsonObject] = []
    seen: set[tuple[str, str]] = set()
    for source in cast(list[JsonObject], acquisition["artifactPairs"]):
        symbol = cast(str, source["symbol"])
        month = cast(str, source["month"])
        if symbol not in admitted_symbols or month not in admitted_months:
            continue
        identity = (symbol, month)
        if identity in seen:
            raise VG20Error(f"duplicate source pair: {symbol} {month}")
        seen.add(identity)
        archive_name = f"{symbol}-1d-{month}.zip"
        pair_dir = state_root / "archives" / symbol / month
        zip_path = pair_dir / archive_name
        checksum_path = pair_dir / f"{archive_name}.CHECKSUM"
        pair_path = pair_dir / "pair.v1.json"
        zip_raw = zip_path.read_bytes()
        checksum_raw = checksum_path.read_bytes()
        pair_raw = pair_path.read_bytes()
        zip_sha = hashlib.sha256(zip_raw).hexdigest()
        checksum_sha = hashlib.sha256(checksum_raw).hexdigest()
        if zip_sha != source["zipSha256"] or len(zip_raw) != source["zipBytes"]:
            raise VG20Error(f"archive custody mismatch: {symbol} {month}")
        if checksum_sha != source["checksumSha256"] or len(checksum_raw) != source["checksumBytes"]:
            raise VG20Error(f"checksum custody mismatch: {symbol} {month}")
        verify_sidecar(checksum_raw, archive_name, zip_sha)
        pair = json.loads(pair_raw)
        if (
            not isinstance(pair, dict)
            or pair.get("symbol") != symbol
            or pair.get("month") != month
            or pair.get("zipSha256") != zip_sha
            or pair.get("checksumSha256") != checksum_sha
        ):
            raise VG20Error(f"pair receipt mismatch: {symbol} {month}")
        records.append(
            {
                "checksumBytes": len(checksum_raw),
                "checksumPath": str(checksum_path.relative_to(state_root)),
                "checksumSha256": checksum_sha,
                "month": month,
                "pairBytes": len(pair_raw),
                "pairPath": str(pair_path.relative_to(state_root)),
                "pairSha256": hashlib.sha256(pair_raw).hexdigest(),
                "symbol": symbol,
                "zipBytes": len(zip_raw),
                "zipPath": str(zip_path.relative_to(state_root)),
                "zipSha256": zip_sha,
            }
        )
    records.sort(key=lambda row: (cast(str, row["symbol"]).encode(), cast(str, row["month"])))
    if not records:
        raise VG20Error("no source records admitted")
    leader_identities = {(leader, month) for leader in LEADERS for month in SOURCE_MONTHS}
    if not leader_identities.issubset(seen):
        raise VG20Error("required BTC/ETH source month is absent")
    exclusions = cast(JsonObject, discovery["exclusions"])
    manifest = {
        "acquisitionManifestSha256": ACQUISITION_SHA,
        "archiveBodiesOpened": False,
        "authenticatedAtUtc": utc_now(),
        "discoverySha256": DISCOVERY_SHA,
        "excludedPairedLeveragedSymbols": exclusions["pairedLeveragedSymbols"],
        "excludedPairedLeveragedSymbolsSha256": exclusions["pairedLeveragedSha256"],
        "excludedStableOrFiatSymbols": exclusions["stableOrFiatSymbols"],
        "excludedStableOrFiatSymbolsSha256": exclusions["stableOrFiatSha256"],
        "interval": "1d",
        "normalizedRecordSha256": canonical_sha(records),
        "recordCount": len(records),
        "records": records,
        "schema": "VG20SourceManifestV1",
        "sourceRoot": str(state_root.resolve()),
        "universeCount": len(symbols),
        "universeSha256": universe_obj["sha256"],
        "universeSymbols": symbols,
    }
    write_json_once(SOURCE_MANIFEST_PATH, manifest)
    freeze = {
        "baseCommit": BASE_COMMIT,
        "candidateCommitAtFreeze": git_output("rev-parse", "HEAD"),
        "evaluatorSha256": sha256_path(Path(__file__)),
        "frozenAtUtc": utc_now(),
        "holdoutArchiveBodiesOpened": False,
        "holdoutMaximumOpenCount": 1,
        "officialSourceResearchSha256": sha256_path(SOURCE_RESEARCH_PATH),
        "protocolSha256": sha256_path(PROTOCOL_PATH),
        "readmeSha256": sha256_path(README_PATH),
        "schema": "VG20FreezeV1",
        "sourceManifestSha256": sha256_path(SOURCE_MANIFEST_PATH),
        "sourceRoot": str(state_root.resolve()),
        "testsSha256": sha256_path(TESTS_PATH),
    }
    write_json_once(FREEZE_PATH, freeze)
    return {
        "candidateCommitAtFreeze": freeze["candidateCommitAtFreeze"],
        "normalizedRecordSha256": manifest["normalizedRecordSha256"],
        "recordCount": manifest["recordCount"],
        "sourceManifestSha256": freeze["sourceManifestSha256"],
    }


def verify_freeze(state_root: Path) -> JsonObject:
    freeze = load_json(FREEZE_PATH)
    if freeze.get("schema") != "VG20FreezeV1":
        raise VG20Error("unexpected freeze schema")
    expected = {
        "evaluatorSha256": Path(__file__),
        "officialSourceResearchSha256": SOURCE_RESEARCH_PATH,
        "protocolSha256": PROTOCOL_PATH,
        "readmeSha256": README_PATH,
        "sourceManifestSha256": SOURCE_MANIFEST_PATH,
        "testsSha256": TESTS_PATH,
    }
    for field, path in expected.items():
        if freeze.get(field) != sha256_path(path):
            raise VG20Error(f"freeze mismatch: {field}")
    if freeze.get("baseCommit") != BASE_COMMIT:
        raise VG20Error("freeze base mismatch")
    if freeze.get("sourceRoot") != str(state_root.resolve()):
        raise VG20Error("freeze source root mismatch")
    if freeze.get("holdoutMaximumOpenCount") != 1:
        raise VG20Error("freeze holdout authority mismatch")
    return freeze


def manifest_records(
    *,
    months: set[str],
    symbols: set[str] | None = None,
) -> tuple[JsonObject, ...]:
    manifest = load_json(SOURCE_MANIFEST_PATH)
    if manifest.get("schema") != "VG20SourceManifestV1":
        raise VG20Error("unexpected source manifest schema")
    if manifest.get("archiveBodiesOpened") is not False:
        raise VG20Error("source manifest did not predate semantic access")
    records = cast(list[JsonObject], manifest["records"])
    selected = tuple(
        row
        for row in records
        if row["month"] in months and (symbols is None or row["symbol"] in symbols)
    )
    return selected


def parse_archive(record: JsonObject, state_root: Path) -> tuple[Bar, ...]:
    symbol = cast(str, record["symbol"])
    month = cast(str, record["month"])
    zip_path = state_root / cast(str, record["zipPath"])
    checksum_path = state_root / cast(str, record["checksumPath"])
    pair_path = state_root / cast(str, record["pairPath"])
    zip_raw = zip_path.read_bytes()
    checksum_raw = checksum_path.read_bytes()
    pair_raw = pair_path.read_bytes()
    if (
        len(zip_raw) != record["zipBytes"]
        or hashlib.sha256(zip_raw).hexdigest() != record["zipSha256"]
    ):
        raise MeasurementError(f"archive changed: {symbol} {month}")
    if (
        len(checksum_raw) != record["checksumBytes"]
        or hashlib.sha256(checksum_raw).hexdigest() != record["checksumSha256"]
    ):
        raise MeasurementError(f"checksum changed: {symbol} {month}")
    if (
        len(pair_raw) != record["pairBytes"]
        or hashlib.sha256(pair_raw).hexdigest() != record["pairSha256"]
    ):
        raise MeasurementError(f"pair receipt changed: {symbol} {month}")
    verify_sidecar(checksum_raw, zip_path.name, cast(str, record["zipSha256"]))
    expected_member = f"{symbol}-1d-{month}.csv"
    try:
        with zipfile.ZipFile(io.BytesIO(zip_raw), "r") as archive:
            members = [item for item in archive.infolist() if not item.is_dir()]
            if len(members) != 1 or members[0].filename != expected_member:
                raise MeasurementError(f"unexpected ZIP member: {symbol} {month}")
            raw_csv = archive.read(members[0])
    except zipfile.BadZipFile as exc:
        raise MeasurementError(f"invalid ZIP: {symbol} {month}") from exc
    try:
        text = raw_csv.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise MeasurementError(f"non-UTF8 CSV: {symbol} {month}") from exc
    rows = list(csv.reader(io.StringIO(text)))
    if rows and tuple(rows[0]) == KLINE_HEADER:
        rows = rows[1:]
    if not rows:
        raise MeasurementError(f"empty archive: {symbol} {month}")
    parsed: list[Bar] = []
    previous_open: int | None = None
    for row in rows:
        if len(row) != 12:
            raise MeasurementError(f"wrong kline field count: {symbol} {month}")
        try:
            open_us = int(row[0])
            close_us = int(row[6])
            open_price = Decimal(row[1])
            high = Decimal(row[2])
            low = Decimal(row[3])
            close = Decimal(row[4])
            quote_volume = Decimal(row[7])
        except (ValueError, InvalidOperation) as exc:
            raise MeasurementError(f"invalid kline scalar: {symbol} {month}") from exc
        if open_us < 1_000_000_000_000_000 or close_us < 1_000_000_000_000_000:
            raise MeasurementError(f"non-microsecond 2025+ timestamp: {symbol} {month}")
        if open_us % DAY_US or close_us != open_us + DAY_US - 1:
            raise MeasurementError(f"invalid UTC daily boundary: {symbol} {month}")
        if previous_open is not None and open_us <= previous_open:
            raise MeasurementError(f"duplicate or unsorted open time: {symbol} {month}")
        previous_open = open_us
        if (
            min(open_price, high, low, close) <= ZERO
            or quote_volume < ZERO
            or high < max(open_price, close)
            or low > min(open_price, close)
        ):
            raise MeasurementError(f"invalid OHLCV invariant: {symbol} {month}")
        day = date(1970, 1, 1) + timedelta(days=open_us // DAY_US)
        if day.strftime("%Y-%m") != month:
            raise MeasurementError(f"row outside declared month: {symbol} {month}")
        parsed.append(
            Bar(
                symbol,
                day,
                open_price,
                high,
                low,
                close,
                quote_volume,
                open_us,
                close_us,
            )
        )
    return tuple(parsed)


def load_panel(
    records: Sequence[JsonObject],
    state_root: Path,
    required_identities: set[tuple[str, str]],
) -> dict[str, dict[date, Bar]]:
    actual = {(cast(str, row["symbol"]), cast(str, row["month"])) for row in records}
    missing = required_identities - actual
    if missing:
        symbol, month = sorted(missing)[0]
        raise MeasurementError(f"required archive absent: {symbol} {month}")
    panel: dict[str, dict[date, Bar]] = {}
    for record in records:
        symbol = cast(str, record["symbol"])
        series = panel.setdefault(symbol, {})
        for bar in parse_archive(record, state_root):
            if bar.day in series:
                raise MeasurementError(f"duplicate full bar across archives: {symbol} {bar.day}")
            series[bar.day] = bar
    return panel


def select_fixed_cohort(state_root: Path) -> tuple[tuple[str, ...], list[JsonObject]]:
    manifest = load_json(SOURCE_MANIFEST_PATH)
    universe = tuple(cast(list[str], manifest["universeSymbols"]))
    excluded = set(cast(list[str], manifest["excludedStableOrFiatSymbols"]))
    excluded.update(cast(list[str], manifest["excludedPairedLeveragedSymbols"]))
    excluded.update(LEADERS)
    warmup_days = date_range(WARMUP_START, DEVELOPMENT_START)
    records_by_symbol: dict[str, list[JsonObject]] = {}
    for record in manifest_records(months=set(WARMUP_MONTHS)):
        records_by_symbol.setdefault(cast(str, record["symbol"]), []).append(record)
    ranked: list[tuple[Decimal, bytes, str]] = []
    quarantine: list[JsonObject] = []
    for symbol in universe:
        if symbol in excluded:
            continue
        records = records_by_symbol.get(symbol, [])
        identities = {(symbol, month) for month in WARMUP_MONTHS}
        if {(symbol, cast(str, row["month"])) for row in records} != identities:
            quarantine.append({"reason": "WARMUP_ARCHIVE_ABSENT", "symbol": symbol})
            continue
        try:
            panel = load_panel(records, state_root, identities)
            series = panel[symbol]
            if tuple(sorted(series)) != warmup_days:
                raise MeasurementError("warmup is not exactly 61 consecutive days")
            volumes = [series[day].quote_volume for day in warmup_days]
            if any(volume <= ZERO for volume in volumes):
                raise MeasurementError("warmup contains non-positive quote volume")
            median_volume = statistics.median(volumes)
        except (MeasurementError, VG20Error, OSError) as exc:
            quarantine.append({"reason": f"WARMUP_INVALID:{exc}", "symbol": symbol})
            continue
        ranked.append((median_volume, symbol.encode("utf-8"), symbol))
    ranked.sort(key=lambda item: (-item[0], item[1]))
    if len(ranked) < COHORT_SIZE:
        raise MeasurementError("fewer than ten valid pre-development liquid alts")
    cohort = tuple(item[2] for item in ranked[:COHORT_SIZE])
    return cohort, quarantine


def merge_panel(
    destination: dict[str, dict[date, Bar]],
    addition: Mapping[str, Mapping[date, Bar]],
) -> None:
    for symbol, rows in addition.items():
        series = destination.setdefault(symbol, {})
        for day, bar in rows.items():
            if day in series and series[day] != bar:
                raise MeasurementError(f"conflicting merged bar: {symbol} {day}")
            series[day] = bar


def load_required_partition(
    state_root: Path,
    cohort: Sequence[str],
    months: Sequence[str],
) -> dict[str, dict[date, Bar]]:
    symbols = set(LEADERS) | set(cohort)
    month_set = set(months)
    required = {(symbol, month) for symbol in symbols for month in month_set}
    records = manifest_records(months=month_set, symbols=symbols)
    return load_panel(records, state_root, required)


def leader_event(
    panel: Mapping[str, Mapping[date, Bar]],
    signal_day: date,
    trial: Trial,
) -> bool:
    history = tuple(
        signal_day - timedelta(days=offset) for offset in range(trial.lookback_days, 0, -1)
    )
    for leader in LEADERS:
        series = panel.get(leader)
        if series is None or signal_day not in series or any(day not in series for day in history):
            raise MeasurementError(f"leader history incomplete: {leader} {signal_day}")
        current = series[signal_day].quote_volume
        prior = [series[day].quote_volume for day in history]
        if current <= ZERO or any(value <= ZERO for value in prior):
            raise MeasurementError(f"leader quote volume invalid: {leader} {signal_day}")
        if current / statistics.median(prior) < trial.joint_shock_ratio:
            return False
    return True


def round_trip_return(
    entry: Decimal,
    exit_price: Decimal,
    *,
    fee: Decimal,
    adverse: Decimal,
) -> Decimal:
    quantity = (ONE - fee) / (entry * (ONE + adverse))
    return quantity * exit_price * (ONE - adverse) * (ONE - fee) - ONE


def cohort_return(
    panel: Mapping[str, Mapping[date, Bar]],
    symbols: Sequence[str],
    entry_day: date,
    exit_day: date,
    *,
    fee: Decimal,
    adverse: Decimal,
) -> Decimal:
    returns = [
        round_trip_return(
            panel[symbol][entry_day].open,
            panel[symbol][exit_day].open,
            fee=fee,
            adverse=adverse,
        )
        for symbol in symbols
    ]
    return sum(returns, ZERO) / Decimal(len(returns))


def capacity_proxy(
    panel: Mapping[str, Mapping[date, Bar]],
    cohort: Sequence[str],
    entry_day: date,
) -> Decimal | None:
    history = tuple(entry_day - timedelta(days=offset) for offset in range(30, 0, -1))
    component_caps: list[Decimal] = []
    for symbol in cohort:
        series = panel[symbol]
        if any(day not in series or series[day].quote_volume <= ZERO for day in history):
            return None
        component_caps.append(
            statistics.median(series[day].quote_volume for day in history) * PARTICIPATION
        )
    return min(component_caps) * Decimal(len(cohort))


def max_drawdown(nav: Sequence[Decimal]) -> Decimal:
    if not nav:
        return ZERO
    peak = nav[0]
    maximum = ZERO
    for value in nav:
        peak = max(peak, value)
        if peak > ZERO:
            maximum = max(maximum, (peak - value) / peak)
    return maximum


def simulate(
    panel: Mapping[str, Mapping[date, Bar]],
    cohort: Sequence[str],
    trial: Trial,
    start: date,
    end_exclusive: date,
) -> Simulation:
    days = date_range(start, end_exclusive)
    day_index = {day: index for index, day in enumerate(days)}
    gross_daily = [ZERO for _ in days]
    base_daily = [ZERO for _ in days]
    stress_daily = [ZERO for _ in days]
    benchmark_excess_daily = [ZERO for _ in days]
    events: list[Event] = []
    potential = 0
    overlap = 0
    incomplete = 0
    busy_until = start
    open_event_marks: dict[date, Decimal] = {}

    for signal_day in days:
        entry_day = signal_day + timedelta(days=2)
        exit_day = entry_day + timedelta(days=trial.hold_days)
        if exit_day >= end_exclusive:
            continue
        if not leader_event(panel, signal_day, trial):
            continue
        potential += 1
        if signal_day < busy_until:
            overlap += 1
            continue
        busy_until = exit_day
        pre_entry_days = tuple(entry_day - timedelta(days=offset) for offset in range(30, 0, -1))
        pre_entry_complete = all(
            day in panel[symbol] for symbol in cohort for day in (*pre_entry_days, entry_day)
        )
        if not pre_entry_complete:
            incomplete += 1
            continue
        required_after_entry = tuple(
            entry_day + timedelta(days=offset) for offset in range((exit_day - entry_day).days + 1)
        )
        for symbol in (*cohort, *LEADERS):
            series = panel[symbol]
            if any(day not in series for day in required_after_entry):
                raise MeasurementError(f"successful entry lacks later bar: {symbol} {entry_day}")
        effective_capacity = capacity_proxy(panel, cohort, entry_day)
        if effective_capacity is None:
            incomplete += 1
            continue
        gross_return = cohort_return(
            panel,
            cohort,
            entry_day,
            exit_day,
            fee=ZERO,
            adverse=ZERO,
        )
        base_return = cohort_return(
            panel,
            cohort,
            entry_day,
            exit_day,
            fee=FEE_RATE,
            adverse=BASE_ADVERSE,
        )
        stress_return = cohort_return(
            panel,
            cohort,
            entry_day,
            exit_day,
            fee=FEE_RATE,
            adverse=STRESS_ADVERSE,
        )
        benchmark_stress = cohort_return(
            panel,
            LEADERS,
            entry_day,
            exit_day,
            fee=FEE_RATE,
            adverse=STRESS_ADVERSE,
        )
        event = Event(
            signal_day,
            entry_day,
            exit_day,
            gross_return,
            base_return,
            stress_return,
            benchmark_stress,
            effective_capacity,
        )
        events.append(event)
        exit_index = day_index[exit_day]
        gross_daily[exit_index] += INITIAL_USD * gross_return
        base_daily[exit_index] += INITIAL_USD * base_return
        stress_daily[exit_index] += INITIAL_USD * stress_return
        benchmark_excess_daily[exit_index] += INITIAL_USD * (stress_return - benchmark_stress)
        for mark_day in required_after_entry[:-1]:
            mark_return = cohort_return(
                panel,
                cohort,
                entry_day,
                mark_day,
                fee=FEE_RATE,
                adverse=STRESS_ADVERSE,
            )
            open_event_marks[mark_day] = INITIAL_USD * mark_return
    stress_nav_marks: list[Decimal] = []
    realized = ZERO
    for index, pnl in enumerate(stress_daily):
        realized += pnl
        stress_nav_marks.append(INITIAL_USD + realized + open_event_marks.get(days[index], ZERO))
    active_months = len({event.exit_day.strftime("%Y-%m") for event in events})
    effective_capacity = (
        None if not events else min(event.effective_capacity_proxy_usd for event in events)
    )
    return Simulation(
        trial,
        days,
        tuple(gross_daily),
        tuple(base_daily),
        tuple(stress_daily),
        tuple(benchmark_excess_daily),
        tuple(events),
        potential,
        overlap,
        incomplete,
        active_months,
        max_drawdown(stress_nav_marks),
        effective_capacity,
    )


def circular_indices(count: int, block: int, rng: random.Random) -> list[int]:
    result: list[int] = []
    while len(result) < count:
        start = rng.randrange(count)
        result.extend((start + offset) % count for offset in range(block))
    return result[:count]


def bootstrap_report(values: Sequence[Decimal], seed_offset: int) -> JsonObject:
    if len(values) < BOOTSTRAP_BLOCK:
        return {"status": "UNAVAILABLE", "reason": "INSUFFICIENT_DAYS"}
    observed = statistics.fmean(float(value) for value in values)
    rng = random.Random(BOOTSTRAP_SEED + seed_offset)
    bootstrap_means: list[float] = []
    centered = [float(value) - observed for value in values]
    exceed = 0
    for _ in range(BOOTSTRAP_REPLICATES):
        indices = circular_indices(len(values), BOOTSTRAP_BLOCK, rng)
        sample_mean = statistics.fmean(float(values[index]) for index in indices)
        bootstrap_means.append(sample_mean)
        null_mean = statistics.fmean(centered[index] for index in indices)
        if null_mean >= observed:
            exceed += 1
    bootstrap_means.sort()
    lower_index = math.floor(0.05 * (len(bootstrap_means) - 1))
    return {
        "blockLengthDays": BOOTSTRAP_BLOCK,
        "lowerBoundUsdPerDay": format(bootstrap_means[lower_index], ".10f"),
        "meanUsdPerDay": format(observed, ".10f"),
        "oneSidedPValue": format((exceed + 1) / (BOOTSTRAP_REPLICATES + 1), ".10f"),
        "replicates": BOOTSTRAP_REPLICATES,
        "status": "AVAILABLE",
    }


def holm_adjusted(raw: Mapping[str, float]) -> dict[str, float]:
    ordered = sorted(raw.items(), key=lambda item: (item[1], item[0]))
    count = len(ordered)
    adjusted: dict[str, float] = {}
    running = 0.0
    for rank, (trial_id, p_value) in enumerate(ordered):
        running = max(running, min(1.0, p_value * (count - rank)))
        adjusted[trial_id] = running
    return adjusted


def white_reality_check(matrix: Mapping[str, Sequence[Decimal]]) -> JsonObject:
    ordered = sorted(matrix)
    lengths = {len(matrix[trial_id]) for trial_id in ordered}
    if len(lengths) != 1 or not lengths or next(iter(lengths)) < BOOTSTRAP_BLOCK:
        return {"status": "UNAVAILABLE", "reason": "MATRIX_SHAPE_INVALID"}
    count = next(iter(lengths))
    means = {
        trial_id: statistics.fmean(float(value) for value in matrix[trial_id])
        for trial_id in ordered
    }
    observed = max(means.values())
    centered = {
        trial_id: [float(value) - means[trial_id] for value in matrix[trial_id]]
        for trial_id in ordered
    }
    rng = random.Random(BOOTSTRAP_SEED + 90_000)
    exceed = 0
    for _ in range(BOOTSTRAP_REPLICATES):
        indices = circular_indices(count, BOOTSTRAP_BLOCK, rng)
        maximum = max(
            statistics.fmean(centered[trial_id][index] for index in indices) for trial_id in ordered
        )
        if maximum >= observed:
            exceed += 1
    return {
        "observedMaximumMeanDailyUsd": format(observed, ".10f"),
        "pValue": format((exceed + 1) / (BOOTSTRAP_REPLICATES + 1), ".10f"),
        "replicates": BOOTSTRAP_REPLICATES,
        "status": "AVAILABLE",
        "testedCount": len(ordered),
    }


def pbo_report(matrix: Mapping[str, Sequence[Decimal]]) -> JsonObject:
    ordered = sorted(matrix)
    lengths = {len(matrix[trial_id]) for trial_id in ordered}
    if len(lengths) != 1 or not lengths:
        return {"status": "UNAVAILABLE", "reason": "MATRIX_SHAPE_INVALID"}
    count = next(iter(lengths))
    if count < 8:
        return {"status": "UNAVAILABLE", "reason": "INSUFFICIENT_DAYS"}
    blocks: list[list[int]] = [[] for _ in range(8)]
    for index in range(count):
        blocks[min(7, index * 8 // count)].append(index)
    underperform = 0
    degradations: list[float] = []
    logits: list[float] = []
    split_count = 0
    for in_blocks in itertools.combinations(range(8), 4):
        split_count += 1
        in_set = set(in_blocks)
        in_indices = [index for block in in_set for index in blocks[block]]
        out_indices = [
            index for block in range(8) if block not in in_set for index in blocks[block]
        ]
        in_scores = {
            trial_id: statistics.fmean(float(matrix[trial_id][index]) for index in in_indices)
            for trial_id in ordered
        }
        champion = max(ordered, key=lambda trial_id: (in_scores[trial_id], trial_id))
        out_scores = {
            trial_id: statistics.fmean(float(matrix[trial_id][index]) for index in out_indices)
            for trial_id in ordered
        }
        ordered_out = sorted(ordered, key=lambda trial_id: (out_scores[trial_id], trial_id))
        rank = ordered_out.index(champion) + 1
        percentile = rank / (len(ordered) + 1)
        if percentile <= 0.5:
            underperform += 1
        clipped = min(max(percentile, 1e-12), 1 - 1e-12)
        logits.append(math.log(clipped / (1 - clipped)))
        degradations.append(out_scores[champion] - in_scores[champion])
    return {
        "blockCount": 8,
        "diagnosticOnly": True,
        "medianOosMeanDegradationUsdPerDay": format(statistics.median(degradations), ".10f"),
        "medianRankLogit": format(statistics.median(logits), ".10f"),
        "pbo": format(underperform / split_count, ".10f"),
        "splitCount": split_count,
        "status": "AVAILABLE",
        "underperformCount": underperform,
    }


def exact(value: Decimal | None, places: int = 8) -> str | None:
    if value is None:
        return None
    return format(value.quantize(Decimal(1).scaleb(-places)), "f")


def simulation_summary(
    simulation: Simulation,
    bootstrap: JsonObject,
    adjusted_p: float,
    white_p: float | None,
    *,
    development: bool,
) -> JsonObject:
    gross_net = sum(simulation.gross_daily_usd, ZERO)
    base_net = sum(simulation.base_daily_usd, ZERO)
    stress_net = sum(simulation.stress_daily_usd, ZERO)
    benchmark_excess = sum(simulation.benchmark_excess_daily_usd, ZERO)
    lcb_text = bootstrap.get("lowerBoundUsdPerDay")
    lcb = None if lcb_text is None else Decimal(cast(str, lcb_text))
    failed: list[str] = []
    minimum_events = 12 if development else 5
    minimum_potential = 16 if development else 0
    minimum_months = 4 if development else 2
    if simulation.potential_events < minimum_potential:
        failed.append("POTENTIAL_EVENTS")
    if len(simulation.events) < minimum_events:
        failed.append("CLOSED_COHORT_EVENTS")
    if simulation.active_months < minimum_months:
        failed.append("ACTIVE_CALENDAR_MONTHS")
    if base_net <= ZERO:
        failed.append("BASE_NET")
    if stress_net <= ZERO:
        failed.append("STRESS_NET")
    if lcb is None or lcb <= ZERO:
        failed.append("BOOTSTRAP_LOWER_BOUND")
    if simulation.stress_max_drawdown > Decimal("0.25"):
        failed.append("MAX_DRAWDOWN")
    if benchmark_excess <= ZERO:
        failed.append("BENCHMARK_STRESS_EXCESS")
    if (
        simulation.effective_capacity_proxy_usd is None
        or simulation.effective_capacity_proxy_usd < INITIAL_USD
    ):
        failed.append("PUBLIC_CAPACITY_PROXY")
    if development:
        if adjusted_p >= ALPHA:
            failed.append("HOLM_ADJUSTED_P_VALUE")
        if white_p is None or white_p >= ALPHA:
            failed.append("WHITE_REALITY_CHECK")
    event_returns = [event.stress_return for event in simulation.events]
    gross_positive = [max(event.gross_return, ZERO) for event in simulation.events]
    total_positive = sum(gross_positive, ZERO)
    top_event_share = (
        None if total_positive == ZERO else max(gross_positive, default=ZERO) / total_positive
    )
    return {
        "activeCalendarMonths": simulation.active_months,
        "baseNetUsdPer1000": exact(base_net),
        "benchmarkStressExcessUsdPer1000": exact(benchmark_excess),
        "bootstrap": bootstrap,
        "cashIncompleteCohortEvents": simulation.cash_incomplete_cohort_events,
        "cashOverlapEvents": simulation.cash_overlap_events,
        "closedCohortEvents": len(simulation.events),
        "dailyStressPathSha256": canonical_sha(
            [exact(value, 10) for value in simulation.stress_daily_usd]
        ),
        "effectiveCapacityParticipationProxyUsd": exact(simulation.effective_capacity_proxy_usd),
        "failedFormalGates": failed,
        "grossNetUsdPer1000": exact(gross_net),
        "holmAdjustedPValue": format(adjusted_p, ".10f") if development else None,
        "maximumRealizedAndDailyMarkedDrawdown": exact(simulation.stress_max_drawdown),
        "meanStressReturnPerTradedEvent": (
            None
            if not event_returns
            else exact(sum(event_returns, ZERO) / Decimal(len(event_returns)), 10)
        ),
        "potentialEvents": simulation.potential_events,
        "stressNetUsdPer1000": exact(stress_net),
        "topEventGrossPositiveProfitShare": exact(top_event_share, 10),
        "trialId": simulation.trial.trial_id,
    }


def generate_sha256s() -> None:
    if SHA256SUMS_PATH.exists():
        raise VG20Error("SHA256SUMS already exists")
    names = sorted(
        path.name
        for path in HERE.iterdir()
        if path.is_file() and path.name not in {"SHA256SUMS"} and not path.name.endswith(".pyc")
    )
    lines = [f"{sha256_path(HERE / name)}  {name}" for name in names]
    SHA256SUMS_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


def terminal_unmeasured(marker: JsonObject, reason: str) -> JsonObject:
    result = {
        "accountEffectiveFee": "UNKNOWN",
        "baseNetUsdPer1000": None,
        "capacity": "UNMEASURED",
        "causalEffectVerdict": "NO_GO",
        "completedAtUtc": utc_now(),
        "consumer": "N3_SUCCESSOR_FINAL_CONVERGENCE",
        "holdout": {"openCount": marker.get("holdoutOpenCount", 0), "status": "UNOPENED"},
        "reason": reason,
        "schema": "VG20ResultV1",
        "stressNetUsdPer1000": None,
        "verdict": "UNMEASURED",
    }
    write_json_once(RESULT_PATH, result)
    marker.update(
        {
            "completedAtUtc": utc_now(),
            "resultSha256": sha256_path(RESULT_PATH),
            "state": "COMPLETE",
        }
    )
    write_json_replace(RUN_MARKER_PATH, marker)
    generate_sha256s()
    return result


def run_command(state_root: Path) -> JsonObject:
    freeze = verify_freeze(state_root)
    if any(
        path.exists()
        for path in (
            RUN_MARKER_PATH,
            COHORT_SEAL_PATH,
            DEVELOPMENT_PATH,
            SELECTION_PATH,
            HOLDOUT_OPEN_PATH,
            RESULT_PATH,
            SHA256SUMS_PATH,
        )
    ):
        raise VG20Error("single run authority already consumed")
    marker: JsonObject = {
        "baseCommit": BASE_COMMIT,
        "freezeSha256": sha256_path(FREEZE_PATH),
        "holdoutOpenCount": 0,
        "runId": canonical_sha(
            {
                "freezeSha256": sha256_path(FREEZE_PATH),
                "protocolSha256": freeze["protocolSha256"],
            }
        ),
        "schema": "VG20RunMarkerV1",
        "startedAtUtc": utc_now(),
        "state": "RUNNING",
    }
    write_json_once(RUN_MARKER_PATH, marker)
    try:
        cohort, quarantine = select_fixed_cohort(state_root)
        cohort_seal = {
            "cohort": cohort,
            "cohortCount": len(cohort),
            "cohortSha256": canonical_sha(cohort),
            "holdoutArchiveBodiesOpened": False,
            "quarantineCount": len(quarantine),
            "quarantineSha256": canonical_sha(quarantine),
            "rankingWindowEndExclusiveUtc": DEVELOPMENT_START.isoformat(),
            "rankingWindowStartUtc": WARMUP_START.isoformat(),
            "schema": "VG20CohortSealV1",
            "selectionLabel": "PREDEVELOPMENT_BINANCE_LIQUID_ALT_PROXY_NOT_MARKET_CAP",
        }
        write_json_once(COHORT_SEAL_PATH, cohort_seal)
        development_panel = load_required_partition(
            state_root,
            cohort,
            DEVELOPMENT_MONTHS,
        )
        simulations = {
            trial.trial_id: simulate(
                development_panel,
                cohort,
                trial,
                DEVELOPMENT_START,
                DEVELOPMENT_END,
            )
            for trial in trial_grid()
        }
        bootstrap = {
            trial_id: bootstrap_report(simulation.stress_daily_usd, index)
            for index, (trial_id, simulation) in enumerate(sorted(simulations.items()))
        }
        raw_p = {
            trial_id: float(cast(str, report["oneSidedPValue"]))
            for trial_id, report in bootstrap.items()
            if report.get("status") == "AVAILABLE"
        }
        if len(raw_p) != len(simulations):
            raise MeasurementError("development bootstrap family incomplete")
        adjusted = holm_adjusted(raw_p)
        matrix = {
            trial_id: simulation.stress_daily_usd for trial_id, simulation in simulations.items()
        }
        white = white_reality_check(matrix)
        white_p = None if white.get("pValue") is None else float(cast(str, white["pValue"]))
        summaries = {
            trial_id: simulation_summary(
                simulation,
                bootstrap[trial_id],
                adjusted[trial_id],
                white_p,
                development=True,
            )
            for trial_id, simulation in simulations.items()
        }
        ordered_trials = sorted(
            simulations,
            key=lambda trial_id: (
                Decimal(cast(str, bootstrap[trial_id]["lowerBoundUsdPerDay"])),
                sum(simulations[trial_id].stress_daily_usd, ZERO),
                -simulations[trial_id].trial.hold_days,
                simulations[trial_id].trial.lookback_days,
                simulations[trial_id].trial.joint_shock_ratio,
                trial_id,
            ),
            reverse=True,
        )
        champion_id = ordered_trials[0]
        champion_summary = summaries[champion_id]
        development = {
            "attemptedTrialCount": len(simulations),
            "cohortSealSha256": sha256_path(COHORT_SEAL_PATH),
            "completedAtUtc": utc_now(),
            "pbo": pbo_report(matrix),
            "schema": "VG20DevelopmentV1",
            "trialSummaries": [summaries[trial_id] for trial_id in sorted(summaries)],
            "whiteRealityCheck": white,
        }
        write_json_once(DEVELOPMENT_PATH, development)
        development_passed = not cast(list[str], champion_summary["failedFormalGates"])
        selection = {
            "championTrialId": champion_id,
            "developmentPassedAllGates": development_passed,
            "developmentSha256": sha256_path(DEVELOPMENT_PATH),
            "holdoutMetricsRead": False,
            "schema": "VG20SelectionV1",
            "selectedAtUtc": utc_now(),
            "trialGridSha256": canonical_sha(
                [
                    {
                        "holdDays": trial.hold_days,
                        "jointShockRatio": str(trial.joint_shock_ratio),
                        "leaderLookbackDays": trial.lookback_days,
                        "trialId": trial.trial_id,
                    }
                    for trial in trial_grid()
                ]
            ),
        }
        write_json_once(SELECTION_PATH, selection)
        marker.update(
            {
                "cohortSealSha256": sha256_path(COHORT_SEAL_PATH),
                "developmentSha256": sha256_path(DEVELOPMENT_PATH),
                "selectionSha256": sha256_path(SELECTION_PATH),
            }
        )
        write_json_replace(RUN_MARKER_PATH, marker)
        if not development_passed:
            result = {
                "accountEffectiveFee": "UNKNOWN",
                "baseNetUsdPer1000": champion_summary["baseNetUsdPer1000"],
                "capacity": {
                    "executable": "UNMEASURED",
                    "publicParticipationProxyUsd": champion_summary[
                        "effectiveCapacityParticipationProxyUsd"
                    ],
                },
                "causalEffectVerdict": "NO_GO",
                "championTrialId": champion_id,
                "completedAtUtc": utc_now(),
                "consumer": "N3_SUCCESSOR_FINAL_CONVERGENCE",
                "development": champion_summary,
                "developmentPbo": development["pbo"],
                "holdout": {"openCount": 0, "status": "UNOPENED"},
                "publicFeeScenario": "REGULAR_TAKER_10_BPS_PER_LEG_NO_DISCOUNT",
                "reason": "DEVELOPMENT_FORMAL_GATES_FAILED",
                "schema": "VG20ResultV1",
                "stressNetUsdPer1000": champion_summary["stressNetUsdPer1000"],
                "verdict": "NO_GO",
                "whiteRealityCheck": white,
            }
        else:
            holdout_open = {
                "championTrialId": champion_id,
                "openedAtUtc": utc_now(),
                "schema": "VG20HoldoutOpenV1",
                "selectionSha256": sha256_path(SELECTION_PATH),
            }
            write_json_once(HOLDOUT_OPEN_PATH, holdout_open)
            marker["holdoutOpenCount"] = 1
            marker["holdoutOpenSha256"] = sha256_path(HOLDOUT_OPEN_PATH)
            write_json_replace(RUN_MARKER_PATH, marker)
            holdout_panel = load_required_partition(
                state_root,
                cohort,
                HOLDOUT_MONTHS,
            )
            merge_panel(development_panel, holdout_panel)
            champion_trial = simulations[champion_id].trial
            holdout_simulation = simulate(
                development_panel,
                cohort,
                champion_trial,
                HOLDOUT_START,
                HOLDOUT_END,
            )
            holdout_bootstrap = bootstrap_report(
                holdout_simulation.stress_daily_usd,
                50_000,
            )
            holdout_summary = simulation_summary(
                holdout_simulation,
                holdout_bootstrap,
                0.0,
                None,
                development=False,
            )
            holdout_passed = not cast(list[str], holdout_summary["failedFormalGates"])
            result = {
                "accountEffectiveFee": "UNKNOWN",
                "baseNetUsdPer1000": holdout_summary["baseNetUsdPer1000"],
                "capacity": {
                    "executable": "UNMEASURED",
                    "publicParticipationProxyUsd": holdout_summary[
                        "effectiveCapacityParticipationProxyUsd"
                    ],
                },
                "causalEffectVerdict": "NO_GO",
                "championTrialId": champion_id,
                "completedAtUtc": utc_now(),
                "consumer": "N3_SUCCESSOR_FINAL_CONVERGENCE",
                "development": champion_summary,
                "developmentPbo": development["pbo"],
                "holdout": {
                    "metrics": holdout_summary,
                    "openCount": 1,
                    "status": "CONSUMED",
                },
                "publicFeeScenario": "REGULAR_TAKER_10_BPS_PER_LEG_NO_DISCOUNT",
                "reason": (
                    "ALL_PUBLIC_RESEARCH_GATES_PASSED"
                    if holdout_passed
                    else "HOLDOUT_FORMAL_GATES_FAILED"
                ),
                "schema": "VG20ResultV1",
                "stressNetUsdPer1000": holdout_summary["stressNetUsdPer1000"],
                "verdict": "GO" if holdout_passed else "NO_GO",
                "whiteRealityCheck": white,
            }
        write_json_once(RESULT_PATH, result)
        marker.update(
            {
                "completedAtUtc": utc_now(),
                "resultSha256": sha256_path(RESULT_PATH),
                "state": "COMPLETE",
            }
        )
        write_json_replace(RUN_MARKER_PATH, marker)
        generate_sha256s()
        return result
    except (MeasurementError, VG20Error, OSError, ValueError, ArithmeticError) as exc:
        return terminal_unmeasured(marker, f"{type(exc).__name__}:{exc}")


def verify_sha256s() -> None:
    if not SHA256SUMS_PATH.exists():
        raise VG20Error("SHA256SUMS absent")
    for line in SHA256SUMS_PATH.read_text(encoding="utf-8").splitlines():
        digest, filename = line.split("  ", 1)
        if filename == "SHA256SUMS":
            raise VG20Error("SHA256SUMS self-reference")
        if sha256_path(HERE / filename) != digest:
            raise VG20Error(f"SHA256SUMS mismatch: {filename}")


def verify_command(state_root: Path) -> JsonObject:
    verify_freeze(state_root)
    verify_sha256s()
    marker = load_json(RUN_MARKER_PATH)
    result = load_json(RESULT_PATH)
    if marker.get("state") != "COMPLETE":
        raise VG20Error("run marker is not terminal")
    if marker.get("resultSha256") != sha256_path(RESULT_PATH):
        raise VG20Error("run marker does not bind result")
    if marker.get("holdoutOpenCount") not in {0, 1}:
        raise VG20Error("invalid holdout open count")
    if result.get("verdict") not in {"GO", "NO_GO", "UNMEASURED"}:
        raise VG20Error("invalid terminal verdict")
    holdout = cast(JsonObject, result["holdout"])
    if holdout.get("openCount") != marker.get("holdoutOpenCount"):
        raise VG20Error("holdout count mismatch")
    if result.get("verdict") == "UNMEASURED" and (
        result.get("baseNetUsdPer1000") is not None or result.get("stressNetUsdPer1000") is not None
    ):
        raise VG20Error("UNMEASURED result invented a numeric edge")
    return {
        "accountEffectiveFee": result["accountEffectiveFee"],
        "authenticatedWithoutRecomputation": True,
        "baseNetUsdPer1000": result["baseNetUsdPer1000"],
        "capacity": result["capacity"],
        "causalEffectVerdict": result["causalEffectVerdict"],
        "consumer": result["consumer"],
        "holdoutOpenCount": marker["holdoutOpenCount"],
        "resultSha256": sha256_path(RESULT_PATH),
        "stressNetUsdPer1000": result["stressNetUsdPer1000"],
        "verdict": result["verdict"],
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("freeze", "run", "verify"))
    parser.add_argument("--state-root", required=True, type=Path)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = build_parser().parse_args(argv)
    try:
        if arguments.command == "freeze":
            value = freeze_command(arguments.state_root)
        elif arguments.command == "run":
            result = run_command(arguments.state_root)
            value = {
                "baseNetUsdPer1000": result["baseNetUsdPer1000"],
                "holdoutOpenCount": cast(JsonObject, result["holdout"])["openCount"],
                "stressNetUsdPer1000": result["stressNetUsdPer1000"],
                "verdict": result["verdict"],
            }
        else:
            value = verify_command(arguments.state_root)
    except (
        VG20Error,
        MeasurementError,
        OSError,
        ValueError,
        ArithmeticError,
        subprocess.CalledProcessError,
    ) as exc:
        print(f"VG20_ERROR:{type(exc).__name__}:{exc}", file=sys.stderr)
        return 2
    print(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
