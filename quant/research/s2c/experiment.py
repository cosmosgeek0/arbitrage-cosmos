#!/usr/bin/env python3
"""Sealed Binance-public S-2C low residual-volatility experiment."""

from __future__ import annotations

import argparse
import csv
import hashlib
import itertools
import json
import math
import os
import random
import re
import statistics
import sys
import time
import urllib.error
import urllib.request
import zipfile
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
PROTOCOL_PATH = HERE / "protocol.v1.json"
SOURCES_PATH = HERE / "official_sources.v1.json"
SOURCE_PLAN_PATH = HERE / "source_plan.v1.json"
FREEZE_PATH = HERE / "protocol.freeze.v1.json"
MANIFEST_PATH = HERE / "source_manifest.v1.json"
RUN_STARTED_PATH = HERE / "RUN_STARTED.v1.json"
DEVELOPMENT_PATH = HERE / "development.v1.json"
CANDIDATE_PATH = HERE / "CANDIDATE_SEALED.v1.json"
HOLDOUT_PATH = HERE / "HOLDOUT_OPENED.v1.json"
RESULT_PATH = HERE / "result.v1.json"
STATE_ROOT = Path("/private/tmp/cosmos-s2c-low-residual-vol-1be1-54d8-state")
RAW_ROOT = STATE_ROOT / "raw"
STATE_RUN_MARKER = STATE_ROOT / "RUN_CONSUMED.v1.json"
STATE_HOLDOUT_MARKER = STATE_ROOT / "HOLDOUT_OPENED.v1.json"
BASE_COMMIT = "a169b123fb186d1943a75ad648552c4d95be1be1"
HEX64 = re.compile(r"^[0-9a-f]{64}$")
HOUR_MS = 3_600_000
DAY_MS = 86_400_000
STATIC_FILES = (
    ".gitignore",
    "DISTINCTNESS.md",
    "README.md",
    "__init__.py",
    "experiment.py",
    "official_sources.v1.json",
    "protocol.v1.json",
    "source_plan.v1.json",
    "test_experiment.py",
    "verifier.py",
)


class ExperimentError(RuntimeError):
    """A terminal protocol or source failure."""


@dataclass(frozen=True)
class HourBar:
    open_time_ms: int
    open_price: float
    close_price: float
    quote_volume: float


@dataclass(frozen=True)
class Funding:
    time_ms: int
    rate: float


@dataclass(frozen=True)
class ModelPoint:
    symbol: str
    beta: float
    residual_volatility: float


@dataclass(frozen=True)
class FormationResult:
    trial_id: str
    formation_time_ms: int
    entry_time_ms: int
    exit_time_ms: int
    valid: bool
    reason: str | None
    low_symbols: tuple[str, ...]
    high_symbols: tuple[str, ...]
    factor_hedge_usd: float | None
    factor_exposure_after_hedge_usd: float | None
    gross_price_pnl_usd: float
    funding_pnl_usd: float
    scenario_net_usd: dict[str, float]
    scenario_cost_usd: dict[str, float]
    public_capacity_usd: float | None


def load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ExperimentError(f"object required: {path.name}")
    return value


def canonical_bytes(value: Any) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


def sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def fsync_json(path: Path, value: Any, *, exclusive: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    flags = os.O_WRONLY | os.O_CREAT | (os.O_EXCL if exclusive else os.O_TRUNC)
    descriptor = os.open(path, flags, 0o600)
    try:
        with os.fdopen(descriptor, "wb", closefd=False) as handle:
            handle.write(canonical_bytes(value))
            handle.flush()
            os.fsync(handle.fileno())
    finally:
        os.close(descriptor)
    directory = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def utc_ms(text: str) -> int:
    return int(datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp() * 1000)


def month_range(start: str, end: str) -> list[str]:
    current = date.fromisoformat(f"{start}-01")
    final = date.fromisoformat(f"{end}-01")
    values: list[str] = []
    while current <= final:
        values.append(current.strftime("%Y-%m"))
        if current.month == 12:
            current = date(current.year + 1, 1, 1)
        else:
            current = date(current.year, current.month + 1, 1)
    return values


def archive_relative(dataset: str, symbol: str, month: str) -> str:
    if dataset == "klines":
        return f"klines/{symbol}/1h/{symbol}-1h-{month}.zip"
    if dataset == "fundingRate":
        return f"fundingRate/{symbol}/{symbol}-fundingRate-{month}.zip"
    if dataset == "markPriceKlines":
        return f"markPriceKlines/{symbol}/1h/{symbol}-1h-{month}.zip"
    raise ExperimentError(f"unknown dataset: {dataset}")


def planned_artifacts() -> list[tuple[str, str, str, str]]:
    plan = load_json(SOURCE_PLAN_PATH)
    symbols = plan["symbols"]["factorOnly"] + plan["symbols"]["trade"]
    artifacts: list[tuple[str, str, str, str]] = []
    for symbol in symbols:
        for month in month_range(*plan["months"]["klineInclusive"]):
            relative = archive_relative("klines", symbol, month)
            artifacts.append(("klines", symbol, month, relative))
        for month in month_range(*plan["months"]["fundingInclusive"]):
            relative = archive_relative("fundingRate", symbol, month)
            artifacts.append(("fundingRate", symbol, month, relative))
        for month in month_range(*plan["months"]["markPriceKlineInclusive"]):
            relative = archive_relative("markPriceKlines", symbol, month)
            artifacts.append(("markPriceKlines", symbol, month, relative))
    return artifacts


def freeze_protocol() -> dict[str, Any]:
    if FREEZE_PATH.exists():
        raise ExperimentError("PROTOCOL_ALREADY_FROZEN")
    missing = [name for name in STATIC_FILES if not (HERE / name).is_file()]
    if missing:
        raise ExperimentError(f"STATIC_FILES_MISSING:{','.join(missing)}")
    protocol = load_json(PROTOCOL_PATH)
    if protocol.get("canonicalBaseCommit") != BASE_COMMIT:
        raise ExperimentError("CANONICAL_BASE_MISMATCH")
    freeze = {
        "schema": "S2CProtocolFreezeV1",
        "state": "PROTOCOL_BYTES_FROZEN_BEFORE_ARCHIVE_OUTCOME_ACCESS",
        "canonicalBaseCommit": BASE_COMMIT,
        "frozenAtUtc": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "staticSha256": {name: sha256_path(HERE / name) for name in STATIC_FILES},
        "plannedArtifactCount": len(planned_artifacts()),
        "economicRunsAllowed": 1,
        "holdoutOpensAllowed": 1,
        "archiveBodyAccessBeforeThisFreeze": false_value(),
    }
    fsync_json(FREEZE_PATH, freeze, exclusive=True)
    return freeze


def false_value() -> bool:
    return False


def validate_freeze() -> dict[str, Any]:
    freeze = load_json(FREEZE_PATH)
    if freeze.get("state") != "PROTOCOL_BYTES_FROZEN_BEFORE_ARCHIVE_OUTCOME_ACCESS":
        raise ExperimentError("FREEZE_STATE_INVALID")
    hashes = freeze.get("staticSha256")
    if not isinstance(hashes, dict):
        raise ExperimentError("FREEZE_HASHES_INVALID")
    for name in STATIC_FILES:
        expected = hashes.get(name)
        if expected != sha256_path(HERE / name):
            raise ExperimentError(f"STATIC_HASH_MISMATCH:{name}")
    return freeze


def download(url: str, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".part")
    request = urllib.request.Request(url, headers={"User-Agent": "cosmos-s2c-public-research/1"})
    last_error: Exception | None = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                if response.status != 200:
                    raise ExperimentError(f"HTTP_{response.status}:{url}")
                descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
                try:
                    with os.fdopen(descriptor, "wb", closefd=False) as handle:
                        while chunk := response.read(1 << 20):
                            handle.write(chunk)
                        handle.flush()
                        os.fsync(handle.fileno())
                finally:
                    os.close(descriptor)
            os.replace(temporary, destination)
            return
        except (OSError, urllib.error.URLError, ExperimentError) as error:
            last_error = error
            if temporary.exists():
                temporary.unlink()
            time.sleep(0.25 * (attempt + 1))
    raise ExperimentError(f"DOWNLOAD_FAILED:{url}:{last_error}")


def parse_sidecar(path: Path) -> str:
    tokens = path.read_text(encoding="utf-8").strip().split()
    if not tokens or HEX64.fullmatch(tokens[0].lower()) is None:
        raise ExperimentError(f"CHECKSUM_FORMAT_INVALID:{path.name}")
    return tokens[0].lower()


def acquire_one(item: tuple[str, str, str, str], root_url: str) -> dict[str, Any]:
    dataset, symbol, month, relative = item
    archive = RAW_ROOT / relative
    sidecar = RAW_ROOT / f"{relative}.CHECKSUM"
    archive_url = f"{root_url}/{relative}"
    sidecar_url = f"{archive_url}.CHECKSUM"
    if not sidecar.exists():
        download(sidecar_url, sidecar)
    if not archive.exists():
        download(archive_url, archive)
    expected = parse_sidecar(sidecar)
    actual = sha256_path(archive)
    if actual != expected:
        raise ExperimentError(f"CHECKSUM_MISMATCH:{relative}")
    return {
        "dataset": dataset,
        "symbol": symbol,
        "month": month,
        "relativePath": relative,
        "checksumRelativePath": f"{relative}.CHECKSUM",
        "archiveSha256": actual,
        "checksumSha256": sha256_path(sidecar),
        "archiveBytes": archive.stat().st_size,
        "status": "CHECKSUM_VERIFIED_ARCHIVE_NOT_DECOMPRESSED",
    }


def acquire() -> dict[str, Any]:
    freeze = validate_freeze()
    if STATE_RUN_MARKER.exists() or RUN_STARTED_PATH.exists():
        raise ExperimentError("ACQUISITION_AFTER_RUN_FORBIDDEN")
    if MANIFEST_PATH.exists():
        raise ExperimentError("SOURCE_MANIFEST_ALREADY_EXISTS")
    plan = load_json(SOURCE_PLAN_PATH)
    root_url = str(plan["archiveRoot"]).rstrip("/")
    items = planned_artifacts()
    rows: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=8) as executor:
        futures = {executor.submit(acquire_one, item, root_url): item for item in items}
        for future in as_completed(futures):
            rows.append(future.result())
    rows.sort(key=lambda row: (row["dataset"], row["symbol"], row["month"]))
    manifest = {
        "schema": "S2CSourceManifestV1",
        "freezeSha256": sha256_path(FREEZE_PATH),
        "archiveRoot": root_url,
        "networkCalls": len(rows) * 2,
        "artifactCount": len(rows),
        "allChecksumVerified": all(
            row["status"] == "CHECKSUM_VERIFIED_ARCHIVE_NOT_DECOMPRESSED" for row in rows
        ),
        "archiveBodiesOpened": 0,
        "rows": rows,
        "freezeState": freeze["state"],
    }
    fsync_json(MANIFEST_PATH, manifest, exclusive=True)
    return manifest


def manifest_index() -> dict[tuple[str, str, str], dict[str, Any]]:
    manifest = load_json(MANIFEST_PATH)
    if manifest.get("freezeSha256") != sha256_path(FREEZE_PATH):
        raise ExperimentError("MANIFEST_FREEZE_MISMATCH")
    rows = manifest.get("rows")
    if not isinstance(rows, list) or len(rows) != len(planned_artifacts()):
        raise ExperimentError("MANIFEST_CARDINALITY_INVALID")
    index: dict[tuple[str, str, str], dict[str, Any]] = {}
    for raw in rows:
        if not isinstance(raw, dict):
            raise ExperimentError("MANIFEST_ROW_INVALID")
        key = (str(raw["dataset"]), str(raw["symbol"]), str(raw["month"]))
        if key in index:
            raise ExperimentError("MANIFEST_DUPLICATE")
        path = RAW_ROOT / str(raw["relativePath"])
        sidecar = RAW_ROOT / str(raw["checksumRelativePath"])
        if sha256_path(path) != raw["archiveSha256"]:
            raise ExperimentError(f"ARCHIVE_DIGEST_CHANGED:{raw['relativePath']}")
        if sha256_path(sidecar) != raw["checksumSha256"]:
            raise ExperimentError(f"SIDECAR_DIGEST_CHANGED:{raw['relativePath']}")
        if parse_sidecar(sidecar) != raw["archiveSha256"]:
            raise ExperimentError(f"SIDECAR_BINDING_CHANGED:{raw['relativePath']}")
        index[key] = raw
    return index


def zip_rows(path: Path) -> list[list[str]]:
    with zipfile.ZipFile(path) as archive:
        members = [name for name in archive.namelist() if not name.endswith("/")]
        if len(members) != 1 or not members[0].endswith(".csv"):
            raise ExperimentError(f"ZIP_MEMBER_INVALID:{path.name}")
        with archive.open(members[0]) as handle:
            text = (line.decode("utf-8-sig") for line in handle)
            return list(csv.reader(text))


def parse_kline_zip(path: Path) -> list[HourBar]:
    rows = zip_rows(path)
    if (
        rows
        and rows[0]
        and rows[0][0].strip().lower().replace(" ", "_")
        in {
            "open_time",
            "opentime",
        }
    ):
        rows = rows[1:]
    parsed: list[HourBar] = []
    seen: set[int] = set()
    for ordinal, row in enumerate(rows, 1):
        if len(row) != 12:
            raise ExperimentError(f"KLINE_COLUMN_COUNT:{path.name}:{ordinal}")
        try:
            timestamp = int(row[0])
            open_price = float(row[1])
            close_price = float(row[4])
            quote_volume = float(row[7])
        except ValueError as error:
            raise ExperimentError(f"KLINE_VALUE_INVALID:{path.name}:{ordinal}") from error
        if timestamp % HOUR_MS != 0 or timestamp in seen:
            raise ExperimentError(f"KLINE_TIMESTAMP_INVALID:{path.name}:{ordinal}")
        if not all(math.isfinite(v) for v in (open_price, close_price, quote_volume)):
            raise ExperimentError(f"KLINE_NONFINITE:{path.name}:{ordinal}")
        if open_price <= 0 or close_price <= 0 or quote_volume < 0:
            raise ExperimentError(f"KLINE_DOMAIN_INVALID:{path.name}:{ordinal}")
        seen.add(timestamp)
        parsed.append(HourBar(timestamp, open_price, close_price, quote_volume))
    parsed.sort(key=lambda bar: bar.open_time_ms)
    for left, right in itertools.pairwise(parsed):
        if right.open_time_ms - left.open_time_ms != HOUR_MS:
            raise ExperimentError(f"KLINE_HOURLY_BOUNDARY_INVALID:{path.name}")
    return parsed


def parse_funding_zip(path: Path) -> list[Funding]:
    rows = zip_rows(path)
    expected = ["calc_time", "funding_interval_hours", "last_funding_rate"]
    if not rows or [cell.strip() for cell in rows[0]] != expected:
        raise ExperimentError(f"FUNDING_HEADER_INVALID:{path.name}")
    parsed: list[Funding] = []
    seen: set[int] = set()
    prior = -1
    for ordinal, row in enumerate(rows[1:], 2):
        if len(row) != 3:
            raise ExperimentError(f"FUNDING_COLUMN_COUNT:{path.name}:{ordinal}")
        try:
            timestamp = int(row[0])
            interval = int(row[1])
            rate = float(row[2])
        except ValueError as error:
            raise ExperimentError(f"FUNDING_VALUE_INVALID:{path.name}:{ordinal}") from error
        if timestamp in seen or timestamp <= prior or interval <= 0 or not math.isfinite(rate):
            raise ExperimentError(f"FUNDING_ROW_INVALID:{path.name}:{ordinal}")
        if timestamp % HOUR_MS != 0:
            raise ExperimentError(f"FUNDING_TIME_NOT_HOURLY:{path.name}:{ordinal}")
        seen.add(timestamp)
        prior = timestamp
        parsed.append(Funding(timestamp, rate))
    return parsed


def load_data(
    symbols: list[str],
    kline_months: list[str],
    funding_months: list[str],
    index: dict[tuple[str, str, str], dict[str, Any]],
    mark_months: list[str] | None = None,
) -> tuple[
    dict[str, dict[int, HourBar]],
    dict[str, list[Funding]],
    dict[str, dict[int, HourBar]],
]:
    bars: dict[str, dict[int, HourBar]] = {}
    funding: dict[str, list[Funding]] = {}
    marks: dict[str, dict[int, HourBar]] = {}
    for symbol in symbols:
        symbol_bars: dict[int, HourBar] = {}
        for month in kline_months:
            row = index[("klines", symbol, month)]
            for bar in parse_kline_zip(RAW_ROOT / str(row["relativePath"])):
                if bar.open_time_ms in symbol_bars:
                    raise ExperimentError(f"KLINE_DUPLICATE_ACROSS_MONTHS:{symbol}")
                symbol_bars[bar.open_time_ms] = bar
        bars[symbol] = symbol_bars
        symbol_funding: list[Funding] = []
        for month in funding_months:
            row = index[("fundingRate", symbol, month)]
            symbol_funding.extend(parse_funding_zip(RAW_ROOT / str(row["relativePath"])))
        if len({item.time_ms for item in symbol_funding}) != len(symbol_funding):
            raise ExperimentError(f"FUNDING_DUPLICATE_ACROSS_MONTHS:{symbol}")
        funding[symbol] = sorted(symbol_funding, key=lambda item: item.time_ms)
        symbol_marks: dict[int, HourBar] = {}
        for month in mark_months or funding_months:
            row = index[("markPriceKlines", symbol, month)]
            for bar in parse_kline_zip(RAW_ROOT / str(row["relativePath"])):
                if bar.open_time_ms in symbol_marks:
                    raise ExperimentError(f"MARK_DUPLICATE_ACROSS_MONTHS:{symbol}")
                symbol_marks[bar.open_time_ms] = bar
        marks[symbol] = symbol_marks
    return bars, funding, marks


def daily_maps(
    symbol_bars: dict[int, HourBar],
) -> tuple[dict[date, float], dict[date, float]]:
    grouped: dict[date, list[HourBar]] = defaultdict(list)
    for bar in symbol_bars.values():
        day = datetime.fromtimestamp(bar.open_time_ms / 1000, UTC).date()
        grouped[day].append(bar)
    closes: dict[date, float] = {}
    quote_volume: dict[date, float] = {}
    for day, bars in grouped.items():
        bars.sort(key=lambda item: item.open_time_ms)
        if len(bars) != 24:
            continue
        start = int(datetime(day.year, day.month, day.day, tzinfo=UTC).timestamp() * 1000)
        if [bar.open_time_ms for bar in bars] != [start + index * HOUR_MS for index in range(24)]:
            continue
        closes[day] = bars[-1].close_price
        quote_volume[day] = sum(bar.quote_volume for bar in bars)
    return closes, quote_volume


def model_point(
    symbol: str,
    formation_day: date,
    window: int,
    closes: dict[str, dict[date, float]],
) -> ModelPoint | None:
    common_days = sorted(
        day
        for day in closes["BTCUSDT"]
        if day < formation_day and day in closes["ETHUSDT"] and day in closes[symbol]
    )
    required = window + 1
    if len(common_days) < required:
        return None
    days = common_days[-required:]
    if any((right - left).days != 1 for left, right in itertools.pairwise(days)):
        return None
    market: list[float] = []
    target: list[float] = []
    for prior, current in itertools.pairwise(days):
        btc = math.log(closes["BTCUSDT"][current] / closes["BTCUSDT"][prior])
        eth = math.log(closes["ETHUSDT"][current] / closes["ETHUSDT"][prior])
        value = math.log(closes[symbol][current] / closes[symbol][prior])
        market.append((btc + eth) / 2)
        target.append(value)
    mean_x = statistics.fmean(market)
    mean_y = statistics.fmean(target)
    variance_x = sum((value - mean_x) ** 2 for value in market)
    if variance_x <= 0:
        return None
    beta = (
        sum(
            (x_value - mean_x) * (y_value - mean_y)
            for x_value, y_value in zip(market, target, strict=True)
        )
        / variance_x
    )
    alpha = mean_y - beta * mean_x
    residuals = [
        y_value - alpha - beta * x_value for x_value, y_value in zip(market, target, strict=True)
    ]
    denominator = len(residuals) - 2
    if denominator <= 0:
        return None
    residual_volatility = math.sqrt(sum(value * value for value in residuals) / denominator)
    if not math.isfinite(beta) or not math.isfinite(residual_volatility):
        return None
    if residual_volatility <= 0:
        return None
    return ModelPoint(symbol, beta, residual_volatility)


def median_prior_volume(
    symbol: str,
    formation_day: date,
    volumes: dict[str, dict[date, float]],
) -> float | None:
    days = sorted(day for day in volumes[symbol] if day < formation_day)
    if len(days) < 30:
        return None
    days = days[-30:]
    if any((right - left).days != 1 for left, right in itertools.pairwise(days)):
        return None
    values = [volumes[symbol][day] for day in days]
    if any(value <= 0 or not math.isfinite(value) for value in values):
        return None
    return statistics.median(values)


def cost_scenarios() -> dict[str, float]:
    protocol = load_json(PROTOCOL_PATH)
    raw = protocol["costs"]["scenariosBpPerFill"]
    return {
        str(name): float(values["fee"]) + float(values["adverseExecution"])
        for name, values in raw.items()
    }


def invalid_formation(trial_id: str, formation_ms: int, reason: str) -> FormationResult:
    return FormationResult(
        trial_id=trial_id,
        formation_time_ms=formation_ms,
        entry_time_ms=formation_ms + HOUR_MS,
        exit_time_ms=formation_ms + 7 * DAY_MS + HOUR_MS,
        valid=False,
        reason=reason,
        low_symbols=(),
        high_symbols=(),
        factor_hedge_usd=None,
        factor_exposure_after_hedge_usd=None,
        gross_price_pnl_usd=0.0,
        funding_pnl_usd=0.0,
        scenario_net_usd=dict.fromkeys(cost_scenarios(), 0.0),
        scenario_cost_usd=dict.fromkeys(cost_scenarios(), 0.0),
        public_capacity_usd=None,
    )


def evaluate_formation(
    trial_id: str,
    formation_ms: int,
    window: int,
    tail_size: int,
    trade_symbols: list[str],
    bars: dict[str, dict[int, HourBar]],
    funding: dict[str, list[Funding]],
    marks: dict[str, dict[int, HourBar]],
    closes: dict[str, dict[date, float]],
    volumes: dict[str, dict[date, float]],
) -> FormationResult:
    formation_day = datetime.fromtimestamp(formation_ms / 1000, UTC).date()
    entry_ms = formation_ms + HOUR_MS
    exit_ms = formation_ms + 7 * DAY_MS + HOUR_MS
    models = [
        point
        for symbol in trade_symbols
        if (point := model_point(symbol, formation_day, window, closes)) is not None
    ]
    if len(models) < 12 or len(models) < tail_size * 2:
        return invalid_formation(trial_id, formation_ms, "ELIGIBLE_COHORT_TOO_SMALL")
    ranked = sorted(models, key=lambda point: (point.residual_volatility, point.symbol))
    low = ranked[:tail_size]
    high = ranked[-tail_size:]
    weights: dict[str, float] = {point.symbol: 500.0 / tail_size for point in low}
    weights.update({point.symbol: -500.0 / tail_size for point in high})
    betas = {point.symbol: point.beta for point in models}
    factor_exposure = sum(weight * betas[symbol] for symbol, weight in weights.items())
    hedge = -factor_exposure
    if abs(hedge) > 250:
        return invalid_formation(trial_id, formation_ms, "FACTOR_HEDGE_CAP_EXCEEDED")
    weights["BTCUSDT"] = hedge / 2
    weights["ETHUSDT"] = hedge / 2
    factor_exposure_after = factor_exposure + hedge
    gross_price = 0.0
    funding_pnl = 0.0
    entry_exit_notional = 0.0
    capacities: list[float] = []
    for symbol, signed_notional in weights.items():
        if abs(signed_notional) < 1e-12:
            continue
        entry = bars[symbol].get(entry_ms)
        exit_bar = bars[symbol].get(exit_ms)
        if entry is None or exit_bar is None:
            return invalid_formation(trial_id, formation_ms, f"ENTRY_EXIT_MARK_MISSING:{symbol}")
        quantity = abs(signed_notional) / entry.open_price
        side = 1.0 if signed_notional > 0 else -1.0
        exit_notional = quantity * exit_bar.open_price
        gross_price += side * quantity * (exit_bar.open_price - entry.open_price)
        entry_exit_notional += abs(signed_notional) + exit_notional
        for settlement in funding[symbol]:
            if entry_ms <= settlement.time_ms < exit_ms:
                mark = marks[symbol].get(settlement.time_ms)
                if mark is None:
                    return invalid_formation(
                        trial_id,
                        formation_ms,
                        f"FUNDING_MARK_MISSING:{symbol}:{settlement.time_ms}",
                    )
                funding_pnl += -side * quantity * mark.open_price * settlement.rate
        liquidity = median_prior_volume(symbol, formation_day, volumes)
        fraction = abs(signed_notional) / 1000
        if liquidity is None or fraction <= 0:
            return invalid_formation(trial_id, formation_ms, f"CAPACITY_INPUT_MISSING:{symbol}")
        capacities.append(liquidity * 0.0001 / fraction)
    scenario_cost: dict[str, float] = {}
    scenario_net: dict[str, float] = {}
    for name, bp_per_fill in cost_scenarios().items():
        cost = entry_exit_notional * bp_per_fill / 10_000
        scenario_cost[name] = cost
        scenario_net[name] = gross_price + funding_pnl - cost
    return FormationResult(
        trial_id=trial_id,
        formation_time_ms=formation_ms,
        entry_time_ms=entry_ms,
        exit_time_ms=exit_ms,
        valid=True,
        reason=None,
        low_symbols=tuple(point.symbol for point in low),
        high_symbols=tuple(point.symbol for point in high),
        factor_hedge_usd=hedge,
        factor_exposure_after_hedge_usd=factor_exposure_after,
        gross_price_pnl_usd=gross_price,
        funding_pnl_usd=funding_pnl,
        scenario_net_usd=scenario_net,
        scenario_cost_usd=scenario_cost,
        public_capacity_usd=min(capacities),
    )


def formation_times(start_ms: int, end_ms: int) -> list[int]:
    current = datetime.fromtimestamp(start_ms / 1000, UTC)
    while current.weekday() != 0:
        current += timedelta(days=1)
    current = current.replace(hour=0, minute=0, second=0, microsecond=0)
    values: list[int] = []
    while int((current + timedelta(days=7, hours=1)).timestamp() * 1000) < end_ms:
        values.append(int(current.timestamp() * 1000))
        current += timedelta(days=7)
    return values


def trial_id(window: int, tail: int) -> str:
    return f"F{window:02d}_T{tail}"


def evaluate_partition(
    start_ms: int,
    end_ms: int,
    trials: list[tuple[int, int]],
    trade_symbols: list[str],
    bars: dict[str, dict[int, HourBar]],
    funding: dict[str, list[Funding]],
    marks: dict[str, dict[int, HourBar]],
) -> dict[str, list[FormationResult]]:
    closes: dict[str, dict[date, float]] = {}
    volumes: dict[str, dict[date, float]] = {}
    for symbol, symbol_bars in bars.items():
        closes[symbol], volumes[symbol] = daily_maps(symbol_bars)
    output: dict[str, list[FormationResult]] = {}
    times = formation_times(start_ms, end_ms)
    for window, tail in trials:
        identifier = trial_id(window, tail)
        output[identifier] = [
            evaluate_formation(
                identifier,
                formation_ms,
                window,
                tail,
                trade_symbols,
                bars,
                funding,
                marks,
                closes,
                volumes,
            )
            for formation_ms in times
        ]
    return output


def resample_indices(n: int, block: int, rng: random.Random) -> list[int]:
    indices: list[int] = []
    while len(indices) < n:
        start = rng.randrange(n)
        indices.extend((start + offset) % n for offset in range(block))
    return indices[:n]


def quantile(values: list[float], probability: float) -> float:
    if not values:
        raise ExperimentError("QUANTILE_EMPTY")
    ordered = sorted(values)
    position = (len(ordered) - 1) * probability
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    fraction = position - lower
    return ordered[lower] * (1 - fraction) + ordered[upper] * fraction


def bootstrap_statistics(values: list[float], seed: int) -> dict[str, float]:
    if not values:
        raise ExperimentError("BOOTSTRAP_EMPTY")
    observed = sum(values)
    mean = statistics.fmean(values)
    rng = random.Random(seed)
    uncentered: list[float] = []
    centered: list[float] = []
    for _ in range(4096):
        indices = resample_indices(len(values), min(4, len(values)), rng)
        uncentered.append(sum(values[index] for index in indices))
        centered.append(sum(values[index] - mean for index in indices))
    p_value = (1 + sum(value >= observed for value in centered)) / (len(centered) + 1)
    return {
        "point": observed,
        "lower95": quantile(uncentered, 0.025),
        "upper95": quantile(uncentered, 0.975),
        "oneSidedCenteredP": p_value,
    }


def maximum_drawdown_pct(values: list[float]) -> float:
    cumulative = 0.0
    peak = 0.0
    maximum = 0.0
    for value in values:
        cumulative += value
        peak = max(peak, cumulative)
        maximum = max(maximum, peak - cumulative)
    return maximum / 1000 * 100


def month_sums(formations: list[FormationResult], scenario: str) -> dict[str, float]:
    output: dict[str, float] = defaultdict(float)
    for formation in formations:
        month = datetime.fromtimestamp(formation.entry_time_ms / 1000, UTC).strftime("%Y-%m")
        output[month] += formation.scenario_net_usd[scenario]
    return dict(sorted(output.items()))


def summarize_trial(formations: list[FormationResult], seed: int) -> dict[str, Any]:
    scenarios: dict[str, Any] = {}
    for offset, name in enumerate(("gross", "base", "stress", "severe")):
        values = [formation.scenario_net_usd[name] for formation in formations]
        boot = bootstrap_statistics(values, seed + offset)
        scenarios[name] = {
            "netUsdPer1000": boot["point"],
            "interval95UsdPer1000": [boot["lower95"], boot["upper95"]],
            "oneSidedCenteredP": boot["oneSidedCenteredP"],
            "maximumDrawdownPct": maximum_drawdown_pct(values),
            "positiveMonths": sum(value > 0 for value in month_sums(formations, name).values()),
            "monthlyNetUsd": month_sums(formations, name),
        }
    capacities = [
        formation.public_capacity_usd
        for formation in formations
        if formation.valid and formation.public_capacity_usd is not None
    ]
    symbols = {
        symbol
        for formation in formations
        if formation.valid
        for symbol in (*formation.low_symbols, *formation.high_symbols)
    }
    return {
        "formations": len(formations),
        "validFormations": sum(formation.valid for formation in formations),
        "cashFormations": sum(not formation.valid for formation in formations),
        "distinctTradeSymbols": len(symbols),
        "scenarios": scenarios,
        "publicCapacityProxyUsd": {
            "p05": quantile(capacities, 0.05) if capacities else None,
            "minimum": min(capacities) if capacities else None,
            "historicalExecutableCapacity": "UNMEASURED",
        },
        "fundingPnlUsd": sum(formation.funding_pnl_usd for formation in formations),
        "grossPricePnlUsd": sum(formation.gross_price_pnl_usd for formation in formations),
        "invalidReasons": dict(
            sorted(
                {
                    reason: sum(formation.reason == reason for formation in formations)
                    for reason in {item.reason for item in formations if item.reason is not None}
                }.items()
            )
        ),
    }


def holm_adjust(p_values: dict[str, float]) -> dict[str, float]:
    ordered = sorted(p_values.items(), key=lambda item: (item[1], item[0]))
    count = len(ordered)
    adjusted: dict[str, float] = {}
    running = 0.0
    for index, (identifier, value) in enumerate(ordered):
        running = max(running, min(1.0, (count - index) * value))
        adjusted[identifier] = running
    return adjusted


def white_reality_check(
    trials: dict[str, list[FormationResult]],
    scenario: str,
    seed: int,
) -> float:
    identifiers = sorted(trials)
    values = {
        identifier: [item.scenario_net_usd[scenario] for item in trials[identifier]]
        for identifier in identifiers
    }
    lengths = {len(series) for series in values.values()}
    if len(lengths) != 1 or not lengths or next(iter(lengths)) == 0:
        raise ExperimentError("WHITE_INPUT_INVALID")
    n = next(iter(lengths))
    observed = max(sum(series) for series in values.values())
    means = {identifier: statistics.fmean(series) for identifier, series in values.items()}
    rng = random.Random(seed)
    exceed = 0
    for _ in range(4096):
        indices = resample_indices(n, min(4, n), rng)
        maximum = max(
            sum(values[identifier][index] - means[identifier] for index in indices)
            for identifier in identifiers
        )
        exceed += maximum >= observed
    return (1 + exceed) / 4097


def pbo(trials: dict[str, list[FormationResult]]) -> dict[str, Any]:
    identifiers = sorted(trials)
    months = [f"2025-{month:02d}" for month in range(7, 13)] + [
        "2026-01",
        "2026-02",
    ]
    matrix = {identifier: month_sums(trials[identifier], "stress") for identifier in identifiers}
    overfit = 0
    logits: list[float] = []
    splits = 0
    all_months = set(months)
    for train_tuple in itertools.combinations(months, 4):
        train = set(train_tuple)
        test = all_months - train
        in_scores = {
            identifier: sum(matrix[identifier].get(month, 0.0) for month in train)
            for identifier in identifiers
        }
        champion = min(identifiers, key=lambda item: (-in_scores[item], item))
        out_scores = {
            identifier: sum(matrix[identifier].get(month, 0.0) for month in test)
            for identifier in identifiers
        }
        ordered = sorted(identifiers, key=lambda item: (out_scores[item], item))
        rank = ordered.index(champion) + 1
        relative = rank / (len(identifiers) + 1)
        logits.append(math.log(relative / (1 - relative)))
        overfit += relative <= 0.5
        splits += 1
    return {
        "method": "CSCV",
        "splits": splits,
        "probability": overfit / splits,
        "medianLogit": statistics.median(logits),
        "role": "DIAGNOSTIC_ONLY",
    }


def development_gate_rows(
    summary: dict[str, Any],
    holm_p: float,
    white_p: float,
    pbo_value: float,
) -> dict[str, bool]:
    stress = summary["scenarios"]["stress"]
    capacity = summary["publicCapacityProxyUsd"]["p05"]
    return {
        "minimumValidFormations": summary["validFormations"] >= 30,
        "minimumDistinctTradeSymbols": summary["distinctTradeSymbols"] >= 12,
        "minimumPositiveStressMonths": stress["positiveMonths"] >= 5,
        "stressNetPositive": stress["netUsdPer1000"] > 0,
        "stressBootstrapLowerPositive": stress["interval95UsdPer1000"][0] > 0,
        "holmAdjustedPBelow005": holm_p < 0.05,
        "whiteRealityCheckPBelow005": white_p < 0.05,
        "pboBelow05": pbo_value < 0.5,
        "maximumStressDrawdownAtMost25Pct": stress["maximumDrawdownPct"] <= 25,
        "publicCapacityP05AtLeast10000": capacity is not None and capacity >= 10_000,
    }


def holdout_gate_rows(summary: dict[str, Any]) -> dict[str, bool]:
    base = summary["scenarios"]["base"]
    stress = summary["scenarios"]["stress"]
    return {
        "minimumValidFormations": summary["validFormations"] >= 14,
        "baseNetPositive": base["netUsdPer1000"] > 0,
        "stressNetPositive": stress["netUsdPer1000"] > 0,
        "stressBootstrapLowerPositive": stress["interval95UsdPer1000"][0] > 0,
        "oneSidedPBelow005": stress["oneSidedCenteredP"] < 0.05,
        "maximumStressDrawdownAtMost25Pct": stress["maximumDrawdownPct"] <= 25,
    }


def create_run_marker() -> dict[str, Any]:
    marker = {
        "schema": "S2CRunMarkerV1",
        "state": "SOLE_ECONOMIC_RUN_CONSUMED",
        "startedAtUtc": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "freezeSha256": sha256_path(FREEZE_PATH),
        "manifestSha256": sha256_path(MANIFEST_PATH),
        "allowedRunCount": 1,
    }
    fsync_json(STATE_RUN_MARKER, marker, exclusive=True)
    try:
        fsync_json(RUN_STARTED_PATH, marker, exclusive=True)
    except Exception:
        STATE_RUN_MARKER.unlink(missing_ok=True)
        raise
    return marker


def run_experiment() -> dict[str, Any]:
    validate_freeze()
    if RESULT_PATH.exists() or RUN_STARTED_PATH.exists() or STATE_RUN_MARKER.exists():
        raise ExperimentError("ECONOMIC_RUN_ALREADY_CONSUMED")
    if not MANIFEST_PATH.exists():
        raise ExperimentError("SOURCE_MANIFEST_MISSING")
    index = manifest_index()
    marker = create_run_marker()
    protocol = load_json(PROTOCOL_PATH)
    factor_symbols = list(protocol["universe"]["factorOnly"])
    trade_symbols = list(protocol["universe"]["trade"])
    all_symbols = factor_symbols + trade_symbols
    trials = [
        (int(window), int(tail))
        for window in protocol["trials"]["formationDays"]
        for tail in protocol["trials"]["tailSizes"]
    ]
    try:
        development_bars, development_funding, development_marks = load_data(
            all_symbols,
            month_range("2025-05", "2026-02"),
            month_range("2025-07", "2026-02"),
            index,
        )
        development_trials = evaluate_partition(
            utc_ms("2025-07-01T00:00:00Z"),
            utc_ms("2026-03-01T00:00:00Z"),
            trials,
            trade_symbols,
            development_bars,
            development_funding,
            development_marks,
        )
        development_summaries = {
            identifier: summarize_trial(formations, 202607302 + offset * 100)
            for offset, (identifier, formations) in enumerate(sorted(development_trials.items()))
        }
        p_values = {
            identifier: summary["scenarios"]["stress"]["oneSidedCenteredP"]
            for identifier, summary in development_summaries.items()
        }
        holm = holm_adjust(p_values)
        white_p = white_reality_check(development_trials, "stress", 202607399)
        pbo_result = pbo(development_trials)
        champion = min(
            development_summaries,
            key=lambda item: (
                -development_summaries[item]["scenarios"]["stress"]["netUsdPer1000"],
                item,
            ),
        )
        gates = development_gate_rows(
            development_summaries[champion],
            holm[champion],
            white_p,
            pbo_result["probability"],
        )
        development = {
            "schema": "S2CDevelopmentResultV1",
            "state": "MEASURED",
            "championTrialId": champion,
            "trialSummaries": development_summaries,
            "holmAdjustedP": holm,
            "whiteRealityCheckP": white_p,
            "pbo": pbo_result,
            "championGates": gates,
            "allChampionGatesPass": all(gates.values()),
            "formationAudit": {
                identifier: [asdict(item) for item in formations]
                for identifier, formations in development_trials.items()
            },
        }
        fsync_json(DEVELOPMENT_PATH, development, exclusive=True)
        candidate = {
            "schema": "S2CCandidateSealV1",
            "trialId": champion,
            "developmentSha256": sha256_path(DEVELOPMENT_PATH),
            "freezeSha256": sha256_path(FREEZE_PATH),
            "manifestSha256": sha256_path(MANIFEST_PATH),
            "holdoutEligible": all(gates.values()),
            "sealedBeforeHoldoutBodyAccess": True,
        }
        fsync_json(CANDIDATE_PATH, candidate, exclusive=True)
        holdout: dict[str, Any]
        verdict: str
        if all(gates.values()):
            holdout_marker = {
                "schema": "S2CHoldoutOpenMarkerV1",
                "state": "CHAMPION_HOLDOUT_OPEN_AUTHORIZED_AND_CONSUMED",
                "trialId": champion,
                "candidateSha256": sha256_path(CANDIDATE_PATH),
                "openedCount": 1,
            }
            fsync_json(STATE_HOLDOUT_MARKER, holdout_marker, exclusive=True)
            fsync_json(HOLDOUT_PATH, holdout_marker, exclusive=True)
            holdout_bars, holdout_funding, holdout_marks = load_data(
                all_symbols,
                month_range("2025-05", "2026-06"),
                month_range("2025-07", "2026-06"),
                index,
            )
            champion_window, champion_tail = next(
                pair for pair in trials if trial_id(*pair) == champion
            )
            holdout_trials = evaluate_partition(
                utc_ms("2026-03-08T00:00:00Z"),
                utc_ms("2026-07-01T00:00:00Z"),
                [(champion_window, champion_tail)],
                trade_symbols,
                holdout_bars,
                holdout_funding,
                holdout_marks,
            )
            holdout_summary = summarize_trial(holdout_trials[champion], 202607455)
            holdout_gates = holdout_gate_rows(holdout_summary)
            holdout = {
                "state": "OPENED_ONCE_CHAMPION_ONLY",
                "openedCount": 1,
                "trialId": champion,
                "summary": holdout_summary,
                "gates": holdout_gates,
                "allGatesPass": all(holdout_gates.values()),
                "formationAudit": [asdict(item) for item in holdout_trials[champion]],
            }
            verdict = "GO" if all(holdout_gates.values()) else "NO_GO"
        else:
            holdout = {
                "state": "UNOPENED",
                "openedCount": 0,
                "trialId": champion,
                "reason": "ONE_OR_MORE_FROZEN_DEVELOPMENT_GATES_FAILED",
                "summary": None,
                "gates": None,
                "allGatesPass": False,
            }
            verdict = "NO_GO"
        champion_summary = development_summaries[champion]
        primary_summary = holdout["summary"] if holdout["state"] != "UNOPENED" else champion_summary
        primary_partition = "HOLDOUT" if holdout["state"] != "UNOPENED" else "DEVELOPMENT"
        result = {
            "schema": "S2CResultV1",
            "state": "TERMINAL_MEASURED",
            "verdict": verdict,
            "capitalVerdict": "NO_GO",
            "executionAuthority": "NONE",
            "consumer": "N3 successor/final convergence",
            "selectedTrialId": champion,
            "reporting": {
                "partition": primary_partition,
                "baseNetUsdPer1000": primary_summary["scenarios"]["base"]["netUsdPer1000"],
                "stressNetUsdPer1000": primary_summary["scenarios"]["stress"]["netUsdPer1000"],
                "stressInterval95UsdPer1000": primary_summary["scenarios"]["stress"][
                    "interval95UsdPer1000"
                ],
                "maximumStressDrawdownPct": primary_summary["scenarios"]["stress"][
                    "maximumDrawdownPct"
                ],
                "publicCapacityP05Usd": primary_summary["publicCapacityProxyUsd"]["p05"],
                "historicalExecutableCapacity": "UNMEASURED",
                "accountEffectiveFees": "UNKNOWN",
            },
            "development": {
                "sha256": sha256_path(DEVELOPMENT_PATH),
                "championSummary": champion_summary,
                "holmAdjustedP": holm[champion],
                "whiteRealityCheckP": white_p,
                "pbo": pbo_result,
                "gates": gates,
                "allGatesPass": all(gates.values()),
            },
            "holdout": holdout,
            "lifecycle": {
                "runCount": 1,
                "runMarkerSha256": sha256_path(RUN_STARTED_PATH),
                "holdoutOpenCount": holdout["openedCount"],
                "networkCallsDuringEvaluation": 0,
                "repairRerunRetuneAllowed": False,
            },
            "provenance": {
                "baseCommit": BASE_COMMIT,
                "freezeSha256": sha256_path(FREEZE_PATH),
                "manifestSha256": sha256_path(MANIFEST_PATH),
                "candidateSha256": sha256_path(CANDIDATE_PATH),
                "sourceArtifactCount": len(index),
            },
            "limitations": [
                "FIXED_ESTABLISHED_CONTRACT_COHORT_NOT_FULL_HISTORICAL_MARKET",
                "HISTORICAL_EXCHANGE_FILTER_AND_LISTING_SNAPSHOTS_UNAVAILABLE",
                "PUBLIC_FEE_AND_ADVERSE_EXECUTION_PROXIES_NOT_ACCOUNT_TRUTH",
                "HISTORICAL_SPREAD_DEPTH_QUEUE_LATENCY_IMPACT_AND_FILL_PROBABILITY_UNMEASURED",
                "USDT_USD_PARITY_NOT_GUARANTEED",
                "FRACTIONAL_QUANTITY_AND_FACTOR_HEDGE_ARE_RESEARCH_ONLY",
                "TWELVE_MONTH_SAMPLE_AND_REUSED_PROGRAM_DATES_LIMIT_EXTERNAL_VALIDITY",
            ],
            "runMarker": marker["state"],
        }
        fsync_json(RESULT_PATH, result, exclusive=True)
        return result
    except Exception as error:
        terminal = {
            "schema": "S2CResultV1",
            "state": "TERMINAL_UNMEASURED",
            "verdict": "UNMEASURED",
            "capitalVerdict": "NO_GO",
            "executionAuthority": "NONE",
            "consumer": "N3 successor/final convergence",
            "selectedTrialId": None,
            "reporting": {
                "partition": None,
                "baseNetUsdPer1000": None,
                "stressNetUsdPer1000": None,
                "stressInterval95UsdPer1000": None,
                "maximumStressDrawdownPct": None,
                "publicCapacityP05Usd": None,
                "historicalExecutableCapacity": "UNMEASURED",
                "accountEffectiveFees": "UNKNOWN",
            },
            "holdout": {
                "state": "UNOPENED",
                "openedCount": 0,
                "reason": "DEVELOPMENT_MEASUREMENT_INVALID",
            },
            "lifecycle": {
                "runCount": 1,
                "holdoutOpenCount": 0,
                "networkCallsDuringEvaluation": 0,
                "repairRerunRetuneAllowed": False,
            },
            "blocker": f"{type(error).__name__}:{error}",
            "limitations": ["TERMINAL_ONE_RUN_NO_REPAIR_OR_RERUN"],
        }
        fsync_json(RESULT_PATH, terminal, exclusive=True)
        raise


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("freeze", "acquire", "run"))
    args = parser.parse_args(argv)
    try:
        if args.command == "freeze":
            result = freeze_protocol()
        elif args.command == "acquire":
            result = acquire()
        else:
            result = run_experiment()
    except ExperimentError as error:
        print(f"S2C_ERROR {error}", file=sys.stderr)
        return 2
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
