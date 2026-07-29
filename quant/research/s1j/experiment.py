"""Sealed S-1J public-data Spot-hedged USD-M funding-carry experiment.

``prepare`` reads only parent manifest metadata. ``run`` must execute from the
clean freeze commit; it atomically consumes the sole run before opening any
archive member, evaluates development, seals one champion, and opens holdout
only when every development gate passes.
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
import subprocess
import sys
import zipfile
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal, InvalidOperation, getcontext
from pathlib import Path
from typing import Any, Final

getcontext().prec = 40
D = Decimal

HERE: Final = Path(__file__).resolve().parent
PROTOCOL_PATH: Final = HERE / "protocol.v1.json"
TRIAL_LEDGER_PATH: Final = HERE / "trial_ledger.v1.json"
SOURCE_PLAN_PATH: Final = HERE / "source_plan.v1.json"
FREEZE_PATH: Final = HERE / "freeze.v1.json"
RUN_MARKER_PATH: Final = HERE / "run_consumed.v1.json"
CANDIDATE_SEAL_PATH: Final = HERE / "candidate_seal.v1.json"
HOLDOUT_MARKER_PATH: Final = HERE / "holdout_opened.v1.json"
RESULT_PATH: Final = HERE / "result.v1.json"
SHA256SUMS_PATH: Final = HERE / "SHA256SUMS"

FUTURES_PARENT: Final = Path("/private/tmp/cosmos-s1d-funding-dispersion-v1")
FUTURES_MANIFEST: Final = FUTURES_PARENT / "s1d_acquisition_manifest.json"
SPOT_PARENT: Final = Path("/private/tmp/cosmos-s1f-weekly-momentum-cash-v1")
SPOT_ARCHIVES: Final = SPOT_PARENT / "archives"
SPOT_MANIFEST: Final = SPOT_PARENT / "acquisition-manifest.v1.json"

BASE_COMMIT: Final = "a169b123fb186d1943a75ad648552c4d95be1be1"
FREEZE_INPUTS: Final = (
    "README.md",
    "OFFICIAL_SOURCE_RESEARCH.md",
    "METHODOLOGY.md",
    "protocol.v1.json",
    "trial_ledger.v1.json",
    "source_plan.v1.json",
    "experiment.py",
    "verifier.py",
    "test_experiment.py",
    "test_verifier.py",
)
OUTPUT_NAMES: Final = (
    "run_consumed.v1.json",
    "candidate_seal.v1.json",
    "holdout_opened.v1.json",
    "result.v1.json",
    "SHA256SUMS",
)
SYMBOL_RE: Final = re.compile(r"^[A-Z][A-Z0-9]*USDT$")
LEVERAGED_RE: Final = re.compile(r"(UP|DOWN|BULL|BEAR)USDT$")
DAY_MS: Final = 86_400_000
DAY_US: Final = 86_400_000_000
FUNDING_HEADER: Final = (
    "calc_time",
    "funding_interval_hours",
    "last_funding_rate",
)
KLINE_HEADER: Final = (
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


class EvidenceError(RuntimeError):
    """Fail-closed custody, schema, chronology, or measurement error."""


@dataclass(frozen=True, slots=True)
class Trial:
    trial_id: str
    lookback_days: int
    slots: int


@dataclass(frozen=True, slots=True)
class Scenario:
    name: str
    spot_entry_fee_bps: Decimal
    spot_exit_fee_bps: Decimal
    futures_entry_fee_bps: Decimal
    futures_exit_fee_bps: Decimal
    adverse_bps: Decimal
    participation_bps: Decimal | None
    decision_authority: bool


@dataclass(frozen=True, slots=True)
class DailyBar:
    open: Decimal
    quote_volume: Decimal


@dataclass(frozen=True, slots=True)
class FundingEvent:
    timestamp: datetime
    interval_hours: int
    rate: Decimal
    mark_open: Decimal | None = None


@dataclass(slots=True)
class MarketData:
    spot: dict[str, dict[date, DailyBar]]
    futures: dict[str, dict[date, DailyBar]]
    mark_daily: dict[str, dict[date, Decimal]]
    funding: dict[str, list[FundingEvent]]
    opened_archives: int = 0
    opened_bytes: int = 0


@dataclass(frozen=True, slots=True)
class WeekReference:
    entry_day: date
    valid: bool
    reason: str | None
    cohort: tuple[str, ...]
    selected: tuple[str, ...]
    spot_pnl: Decimal
    futures_pnl: Decimal
    funding_pnl: Decimal
    spot_entry_notional: Decimal
    spot_exit_notional: Decimal
    futures_entry_notional: Decimal
    futures_exit_notional: Decimal
    capacity_ratios: tuple[Decimal, ...]
    daily_gross: tuple[tuple[date, Decimal], ...]

    @property
    def gross(self) -> Decimal:
        return self.spot_pnl + self.futures_pnl + self.funding_pnl


@dataclass(frozen=True, slots=True)
class WeekNet:
    entry_day: date
    valid: bool
    reason: str | None
    selected: tuple[str, ...]
    spot_pnl: Decimal | None
    futures_pnl: Decimal | None
    funding_pnl: Decimal | None
    spot_fees: Decimal | None
    futures_fees: Decimal | None
    adverse_execution: Decimal | None
    net: Decimal | None
    supported_account_capital: Decimal | None
    daily_net: tuple[tuple[date, Decimal], ...]


def canonical_bytes(value: object) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


def read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise EvidenceError(f"cannot read JSON {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise EvidenceError(f"expected object in {path}")
    return value


def write_json(path: Path, value: object) -> None:
    path.write_bytes(canonical_bytes(value))


def write_exclusive_json(path: Path, value: object) -> None:
    payload = canonical_bytes(value)
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
    except FileExistsError as exc:
        raise EvidenceError(f"single-use marker already exists: {path.name}") from exc
    with os.fdopen(fd, "wb") as stream:
        stream.write(payload)
        stream.flush()
        os.fsync(stream.fileno())


def sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_value(value: object) -> str:
    return hashlib.sha256(canonical_bytes(value)).hexdigest()


def utc_now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def decimal_text(value: Decimal | None) -> str | None:
    if value is None:
        return None
    if not value.is_finite():
        raise EvidenceError("non-finite Decimal")
    return format(value.quantize(D("0.00000001")), "f")


def float_or_fail(value: Decimal) -> float:
    result = float(value)
    if not math.isfinite(result):
        raise EvidenceError("non-finite float conversion")
    return result


def parse_decimal(raw: str, label: str) -> Decimal:
    try:
        value = D(raw)
    except InvalidOperation as exc:
        raise EvidenceError(f"invalid decimal for {label}: {raw!r}") from exc
    if not value.is_finite():
        raise EvidenceError(f"non-finite decimal for {label}")
    return value


def normalize_timestamp(raw: str) -> datetime:
    text = raw.strip()
    try:
        numeric = int(text)
    except ValueError:
        try:
            parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError as exc:
            raise EvidenceError(f"invalid timestamp {raw!r}") from exc
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=UTC)
        return parsed.astimezone(UTC)
    divisor = 1_000_000 if abs(numeric) >= 100_000_000_000_000 else 1_000
    try:
        return datetime.fromtimestamp(numeric / divisor, tz=UTC)
    except (OverflowError, OSError, ValueError) as exc:
        raise EvidenceError(f"timestamp outside supported range: {raw!r}") from exc


def funding_mark_hour(timestamp: datetime) -> datetime:
    """Map an exact funding timestamp, including Binance's +1ms rows, to its UTC hour."""
    return timestamp.astimezone(UTC).replace(minute=0, second=0, microsecond=0)


def month_range(first: str, last: str) -> list[str]:
    year, month = (int(part) for part in first.split("-"))
    end_year, end_month = (int(part) for part in last.split("-"))
    values: list[str] = []
    while (year, month) <= (end_year, end_month):
        values.append(f"{year:04d}-{month:02d}")
        month += 1
        if month == 13:
            year += 1
            month = 1
    return values


def weekly_dates(first: str, last: str) -> list[date]:
    start = date.fromisoformat(first)
    end = date.fromisoformat(last)
    result: list[date] = []
    cursor = start
    while cursor <= end:
        if cursor.weekday() != 0:
            raise EvidenceError(f"non-Monday schedule boundary {cursor}")
        result.append(cursor)
        cursor += timedelta(days=7)
    return result


def trials_from_ledger() -> list[Trial]:
    ledger = read_json(TRIAL_LEDGER_PATH)
    rows = ledger.get("trials")
    if not isinstance(rows, list) or len(rows) != 12:
        raise EvidenceError("trial ledger must contain exactly 12 rows")
    trials: list[Trial] = []
    for row in rows:
        if not isinstance(row, dict):
            raise EvidenceError("malformed trial row")
        trials.append(Trial(str(row["trialId"]), int(row["lookbackDays"]), int(row["slots"])))
    if len({trial.trial_id for trial in trials}) != len(trials):
        raise EvidenceError("duplicate trial id")
    return trials


def scenarios_from_protocol() -> dict[str, Scenario]:
    rows = read_json(PROTOCOL_PATH)["costScenarios"]
    if not isinstance(rows, dict):
        raise EvidenceError("costScenarios must be an object")
    result: dict[str, Scenario] = {}
    for name, raw in rows.items():
        if not isinstance(raw, dict):
            raise EvidenceError(f"malformed scenario {name}")
        participation_raw = raw["capacityParticipationBps"]
        result[str(name)] = Scenario(
            str(name),
            D(str(raw["spotEntryFeeBps"])),
            D(str(raw["spotExitFeeBps"])),
            D(str(raw["perpetualEntryFeeBps"])),
            D(str(raw["perpetualExitFeeBps"])),
            D(str(raw["adverseExecutionBpsPerFill"])),
            None if participation_raw is None else D(str(participation_raw)),
            bool(raw["decisionAuthority"]),
        )
    if set(result) != {"MAKER_SENSITIVITY", "PROXY", "STRESS"}:
        raise EvidenceError("scenario family drift")
    return result


def _valid_spot_rows(manifest: Mapping[str, Any], month: str) -> dict[str, Mapping[str, Any]]:
    rows = manifest.get("artifactPairs")
    if not isinstance(rows, list):
        raise EvidenceError("Spot manifest artifactPairs missing")
    result: dict[str, Mapping[str, Any]] = {}
    for row in rows:
        if (
            isinstance(row, dict)
            and row.get("month") == month
            and row.get("state") in {"DOWNLOADED_VERIFIED", "RESUMED_VERIFIED"}
        ):
            result[str(row["symbol"])] = row
    return result


def _valid_futures_rows(
    manifest: Mapping[str, Any], dataset: str, month: str
) -> dict[str, Mapping[str, Any]]:
    rows = manifest.get("artifacts")
    if not isinstance(rows, list):
        raise EvidenceError("USD-M manifest artifacts missing")
    result: dict[str, Mapping[str, Any]] = {}
    for row in rows:
        if (
            isinstance(row, dict)
            and row.get("dataset") == dataset
            and row.get("month") == month
            and row.get("status") == "AVAILABLE"
        ):
            result[str(row["symbol"])] = row
    return result


def prepare() -> None:
    if any((HERE / name).exists() for name in OUTPUT_NAMES):
        raise EvidenceError("outcome packet already started; prepare forbidden")
    if FREEZE_PATH.exists() or SOURCE_PLAN_PATH.exists():
        raise EvidenceError("freeze metadata already exists")
    futures_manifest = read_json(FUTURES_MANIFEST)
    spot_manifest = read_json(SPOT_MANIFEST)
    protocol = read_json(PROTOCOL_PATH)
    universe = protocol["universe"]
    screen_month = str(universe["screenMonth"])
    quarantine = {str(symbol) for symbol in universe["custodyQuarantineSymbols"]}
    spot = set(_valid_spot_rows(spot_manifest, screen_month))
    futures_sets = [
        set(_valid_futures_rows(futures_manifest, dataset, screen_month))
        for dataset in ("fundingRate", "kline1h", "markPriceKline1h")
    ]
    symbols = sorted(spot.intersection(*futures_sets))
    symbols = [
        symbol
        for symbol in symbols
        if SYMBOL_RE.fullmatch(symbol)
        and not LEVERAGED_RE.search(symbol)
        and symbol not in quarantine
    ]
    if len(symbols) < 30:
        raise EvidenceError("point-in-time common screen has fewer than 30 symbols")
    source_plan: dict[str, object] = {
        "schema": "cosmos.quant.s1j.source-plan.v1",
        "preparedAtUtc": utc_now(),
        "metadataOnlyPreparation": True,
        "screenMonth": screen_month,
        "screenRule": universe["screenRule"],
        "custodyQuarantineSymbols": sorted(quarantine),
        "prefreezeSchemaSampleMembers": 3,
        "eligibleOutcomeValuesInspectedBeforeFreeze": 0,
        "screenSymbolCount": len(symbols),
        "screenSymbols": symbols,
        "screenSymbolListSha256": hashlib.sha256(("\n".join(symbols) + "\n").encode()).hexdigest(),
        "outcomeMonths": {
            "developmentLoad": month_range("2024-06", "2025-06"),
            "holdoutLoad": month_range("2025-07", "2026-06"),
        },
        "futures": {
            "parentRoot": str(FUTURES_PARENT),
            "manifestPath": str(FUTURES_MANIFEST),
            "manifestSha256": sha256_path(FUTURES_MANIFEST),
            "datasets": ["fundingRate", "kline1h", "markPriceKline1h"],
            "archiveAccess": "READ_ONLY",
        },
        "spot": {
            "parentRoot": str(SPOT_PARENT),
            "archiveRoot": str(SPOT_ARCHIVES),
            "manifestPath": str(SPOT_MANIFEST),
            "manifestSha256": sha256_path(SPOT_MANIFEST),
            "dataset": "monthly 1d klines",
            "archiveAccess": "READ_ONLY",
        },
        "schemas": {
            "funding": ["calc_time", "funding_interval_hours", "last_funding_rate"],
            "klineColumns": 12,
            "spotTimestampUnit": "milliseconds before 2025-01-01; microseconds thereafter",
            "futuresTimestampUnit": "milliseconds",
        },
        "futureCompletenessSelection": False,
        "networkDuringRun": False,
    }
    write_json(SOURCE_PLAN_PATH, source_plan)
    missing = [name for name in FREEZE_INPUTS if not (HERE / name).is_file()]
    if missing:
        SOURCE_PLAN_PATH.unlink()
        raise EvidenceError(f"freeze inputs missing: {missing}")
    file_hashes = {name: sha256_path(HERE / name) for name in FREEZE_INPUTS}
    freeze: dict[str, object] = {
        "schema": "cosmos.quant.s1j.freeze.v1",
        "frozenAtUtc": utc_now(),
        "baseCommit": BASE_COMMIT,
        "s1jEvaluatorEligibleOutcomeArchiveMembersOpenedBeforeFreeze": 0,
        "prefreezeSchemaSampleMembers": 3,
        "custodyQuarantineSymbols": sorted(quarantine),
        "fileSha256": file_hashes,
        "sourcePlanSha256": file_hashes["source_plan.v1.json"],
        "protocolSha256": file_hashes["protocol.v1.json"],
        "trialLedgerSha256": file_hashes["trial_ledger.v1.json"],
        "singleRun": True,
    }
    write_json(FREEZE_PATH, freeze)
    print(json.dumps({"status": "FROZEN", "symbols": len(symbols)}, sort_keys=True))


def verify_freeze_inputs() -> dict[str, Any]:
    freeze = read_json(FREEZE_PATH)
    hashes = freeze.get("fileSha256")
    if not isinstance(hashes, dict) or set(hashes) != set(FREEZE_INPUTS):
        raise EvidenceError("freeze input inventory mismatch")
    for name, expected in hashes.items():
        actual = sha256_path(HERE / name)
        if actual != expected:
            raise EvidenceError(f"frozen byte drift: {name}")
    source_plan = read_json(SOURCE_PLAN_PATH)
    futures_sha = str(source_plan["futures"]["manifestSha256"])
    spot_sha = str(source_plan["spot"]["manifestSha256"])
    if sha256_path(FUTURES_MANIFEST) != futures_sha:
        raise EvidenceError("USD-M parent manifest drift")
    if sha256_path(SPOT_MANIFEST) != spot_sha:
        raise EvidenceError("Spot parent manifest drift")
    return freeze


def git_output(*args: str) -> str:
    completed = subprocess.run(
        ["git", *args],
        cwd=HERE,
        check=True,
        capture_output=True,
        text=True,
    )
    return completed.stdout.strip()


def verify_clean_freeze_commit() -> str:
    if git_output("status", "--porcelain"):
        raise EvidenceError("run requires a clean freeze commit")
    head = git_output("rev-parse", "HEAD")
    names = git_output("diff", "--name-only", f"{BASE_COMMIT}...{head}").splitlines()
    if not names or any(not name.startswith("quant/research/s1j/") for name in names):
        raise EvidenceError("freeze commit scope is empty or outside quant/research/s1j")
    return head


def _archive_rows(
    symbols: set[str], months: set[str]
) -> tuple[
    dict[tuple[str, str], Mapping[str, Any]],
    dict[tuple[str, str, str], Mapping[str, Any]],
]:
    spot_manifest = read_json(SPOT_MANIFEST)
    futures_manifest = read_json(FUTURES_MANIFEST)
    spot_rows: dict[tuple[str, str], Mapping[str, Any]] = {}
    raw_spot = spot_manifest.get("artifactPairs")
    if not isinstance(raw_spot, list):
        raise EvidenceError("Spot artifactPairs absent")
    for row in raw_spot:
        if (
            isinstance(row, dict)
            and row.get("symbol") in symbols
            and row.get("month") in months
            and row.get("state") in {"DOWNLOADED_VERIFIED", "RESUMED_VERIFIED"}
        ):
            spot_key = (str(row["symbol"]), str(row["month"]))
            if spot_key in spot_rows:
                raise EvidenceError(f"duplicate Spot manifest key {spot_key}")
            spot_rows[spot_key] = row
    futures_rows: dict[tuple[str, str, str], Mapping[str, Any]] = {}
    raw_futures = futures_manifest.get("artifacts")
    if not isinstance(raw_futures, list):
        raise EvidenceError("USD-M artifacts absent")
    for row in raw_futures:
        if (
            isinstance(row, dict)
            and row.get("symbol") in symbols
            and row.get("month") in months
            and row.get("dataset") in {"fundingRate", "kline1h", "markPriceKline1h"}
            and row.get("status") == "AVAILABLE"
        ):
            futures_key = (
                str(row["dataset"]),
                str(row["symbol"]),
                str(row["month"]),
            )
            if futures_key in futures_rows:
                raise EvidenceError(f"duplicate USD-M manifest key {futures_key}")
            if row.get("artifactSha256") != row.get("officialSha256"):
                raise EvidenceError(f"USD-M manifest checksum disagreement {futures_key}")
            futures_rows[futures_key] = row
    return spot_rows, futures_rows


def _read_archive_rows(
    path: Path,
    expected_sha: str,
    expected_member: str,
    data: MarketData,
) -> list[list[str]]:
    if not path.is_file() or path.is_symlink():
        raise EvidenceError(f"archive missing or symlinked: {path}")
    actual_sha = sha256_path(path)
    if actual_sha != expected_sha:
        raise EvidenceError(f"archive SHA mismatch: {path}")
    with zipfile.ZipFile(path) as archive:
        members = [member for member in archive.infolist() if not member.is_dir()]
        if len(members) != 1 or members[0].filename != expected_member:
            raise EvidenceError(f"archive member mismatch: {path}")
        if members[0].file_size > 50_000_000:
            raise EvidenceError(f"archive member unexpectedly large: {path}")
        with archive.open(members[0], "r") as raw:
            text = io.TextIOWrapper(raw, encoding="utf-8", newline="")
            rows = [list(row) for row in csv.reader(text)]
    data.opened_archives += 1
    data.opened_bytes += path.stat().st_size
    return rows


def _spot_archive_path(symbol: str, month: str) -> Path:
    return SPOT_ARCHIVES / symbol / month / f"{symbol}-1d-{month}.zip"


def _require_month(timestamp: datetime, month: str, path: Path) -> None:
    if timestamp.strftime("%Y-%m") != month:
        raise EvidenceError(f"timestamp outside archive month: {path}")


def _data_rows_with_header(
    rows: Sequence[Sequence[str]], expected: Sequence[str], path: Path
) -> Sequence[Sequence[str]]:
    if not rows or tuple(rows[0]) != tuple(expected):
        raise EvidenceError(f"archive CSV header mismatch: {path}")
    data_rows = rows[1:]
    if not data_rows:
        raise EvidenceError(f"archive CSV has no data rows: {path}")
    for row in data_rows:
        if not row or tuple(row) == tuple(expected):
            raise EvidenceError(f"blank or repeated header row: {path}")
        if len(row) != len(expected):
            raise EvidenceError(f"archive CSV row width mismatch: {path}")
    return data_rows


def _futures_archive_path(row: Mapping[str, Any]) -> Path:
    local_path = row.get("localPath")
    archive_key = row.get("archiveKey")
    if (
        not isinstance(local_path, str)
        or local_path.startswith("/")
        or not isinstance(archive_key, str)
        or local_path != f"raw/{archive_key}"
    ):
        raise EvidenceError("invalid USD-M manifest localPath")
    path = (FUTURES_PARENT / local_path).resolve()
    if not path.is_relative_to(FUTURES_PARENT.resolve()):
        raise EvidenceError("USD-M archive path escapes parent")
    return path


def _parse_spot(
    symbol: str,
    month: str,
    row: Mapping[str, Any],
    data: MarketData,
) -> None:
    expected_key = f"data/spot/monthly/klines/{symbol}/1d/{symbol}-1d-{month}.zip"
    if row.get("zipKey") != expected_key:
        raise EvidenceError(f"Spot manifest identity mismatch {symbol} {month}")
    path = _spot_archive_path(symbol, month)
    rows = _read_archive_rows(
        path,
        str(row["zipSha256"]),
        f"{symbol}-1d-{month}.csv",
        data,
    )
    target = data.spot.setdefault(symbol, {})
    if not rows:
        raise EvidenceError(f"Spot archive has no data rows: {path}")
    for values in rows:
        if len(values) != 12:
            raise EvidenceError(f"Spot kline column count drift: {path}")
        timestamp = normalize_timestamp(values[0])
        _require_month(timestamp, month, path)
        if timestamp.time() != datetime.min.time():
            raise EvidenceError(f"Spot daily bar not at UTC midnight: {path}")
        day = timestamp.date()
        if day in target:
            raise EvidenceError(f"duplicate Spot day {symbol} {day}")
        target[day] = DailyBar(
            parse_decimal(values[1], "Spot open"),
            parse_decimal(values[7], "Spot quote volume"),
        )


def _parse_futures_daily(
    dataset: str,
    symbol: str,
    month: str,
    row: Mapping[str, Any],
    data: MarketData,
) -> None:
    path = _futures_archive_path(row)
    rows = _read_archive_rows(
        path,
        str(row["artifactSha256"]),
        f"{symbol}-1h-{month}.csv",
        data,
    )
    data_rows = _data_rows_with_header(rows, KLINE_HEADER, path)
    opens: dict[date, Decimal] = {}
    volumes: dict[date, Decimal] = {}
    hours: dict[date, set[int]] = {}
    seen: set[datetime] = set()
    for values in data_rows:
        timestamp = normalize_timestamp(values[0])
        _require_month(timestamp, month, path)
        if timestamp.minute or timestamp.second or timestamp.microsecond:
            raise EvidenceError(f"USD-M 1h bar off the hour: {path}")
        if timestamp in seen:
            raise EvidenceError(f"duplicate USD-M hour: {path}")
        seen.add(timestamp)
        day = timestamp.date()
        if timestamp.hour == 0:
            if day in opens:
                raise EvidenceError(f"duplicate midnight bar {dataset} {symbol} {day}")
            opens[day] = parse_decimal(values[1], f"{dataset} open")
        volumes[day] = volumes.get(day, D(0)) + parse_decimal(values[7], f"{dataset} quote volume")
        hours.setdefault(day, set()).add(timestamp.hour)
    if dataset == "kline1h":
        target = data.futures.setdefault(symbol, {})
        for day, opening in opens.items():
            if hours.get(day) != set(range(24)):
                continue
            if day in target:
                raise EvidenceError(f"duplicate USD-M day {symbol} {day}")
            target[day] = DailyBar(opening, volumes[day])
    else:
        target_mark = data.mark_daily.setdefault(symbol, {})
        for day, opening in opens.items():
            if day in target_mark:
                raise EvidenceError(f"duplicate mark day {symbol} {day}")
            target_mark[day] = opening


def _parse_funding(
    symbol: str,
    month: str,
    row: Mapping[str, Any],
    data: MarketData,
) -> None:
    path = _futures_archive_path(row)
    rows = _read_archive_rows(
        path,
        str(row["artifactSha256"]),
        f"{symbol}-fundingRate-{month}.csv",
        data,
    )
    target = data.funding.setdefault(symbol, [])
    data_rows = _data_rows_with_header(rows, FUNDING_HEADER, path)
    seen = {event.timestamp for event in target}
    for values in data_rows:
        timestamp = normalize_timestamp(values[0])
        _require_month(timestamp, month, path)
        if timestamp in seen:
            raise EvidenceError(f"duplicate funding timestamp {symbol} {timestamp}")
        seen.add(timestamp)
        try:
            interval_hours = int(values[1])
        except ValueError as exc:
            raise EvidenceError(f"funding interval is not integer: {path}") from exc
        if not 1 <= interval_hours <= 24:
            raise EvidenceError(f"funding interval outside 1..24: {path}")
        rate = parse_decimal(values[2], "funding rate")
        target.append(FundingEvent(timestamp, interval_hours, rate))


def _attach_funding_marks(
    symbols: Sequence[str],
    months: Sequence[str],
    futures_rows: Mapping[tuple[str, str, str], Mapping[str, Any]],
    data: MarketData,
) -> None:
    needed = {
        symbol: {funding_mark_hour(event.timestamp) for event in data.funding.get(symbol, [])}
        for symbol in symbols
    }
    marks: dict[str, dict[datetime, Decimal]] = {symbol: {} for symbol in symbols}
    for symbol in symbols:
        for month in months:
            row = futures_rows.get(("markPriceKline1h", symbol, month))
            if row is None:
                continue
            path = _futures_archive_path(row)
            rows = _read_archive_rows(
                path,
                str(row["artifactSha256"]),
                f"{symbol}-1h-{month}.csv",
                data,
            )
            data_rows = _data_rows_with_header(rows, KLINE_HEADER, path)
            seen: set[datetime] = set()
            for values in data_rows:
                timestamp = normalize_timestamp(values[0])
                _require_month(timestamp, month, path)
                if timestamp.minute or timestamp.second or timestamp.microsecond:
                    raise EvidenceError(f"mark bar off the hour: {path}")
                if timestamp in seen:
                    raise EvidenceError(f"duplicate mark hour: {path}")
                seen.add(timestamp)
                opening = parse_decimal(values[1], "mark open")
                if timestamp.hour == 0:
                    target = data.mark_daily.setdefault(symbol, {})
                    if timestamp.date() in target:
                        raise EvidenceError(f"duplicate mark day {symbol} {timestamp.date()}")
                    target[timestamp.date()] = opening
                if timestamp in needed[symbol]:
                    if timestamp in marks[symbol]:
                        raise EvidenceError(f"duplicate funding mark {symbol} {timestamp}")
                    marks[symbol][timestamp] = opening
    for symbol, events in data.funding.items():
        if len({funding_mark_hour(event.timestamp) for event in events}) != len(events):
            raise EvidenceError(f"duplicate funding settlement hour {symbol}")
        data.funding[symbol] = [
            FundingEvent(
                event.timestamp,
                event.interval_hours,
                event.rate,
                marks[symbol].get(funding_mark_hour(event.timestamp)),
            )
            for event in sorted(events, key=lambda item: item.timestamp)
        ]


def load_market_data(symbols: Sequence[str], months: Sequence[str]) -> MarketData:
    data = MarketData({}, {}, {}, {})
    spot_rows, futures_rows = _archive_rows(set(symbols), set(months))
    for symbol in symbols:
        for month in months:
            spot_row = spot_rows.get((symbol, month))
            if spot_row is not None:
                _parse_spot(symbol, month, spot_row, data)
            funding_row = futures_rows.get(("fundingRate", symbol, month))
            if funding_row is not None:
                _parse_funding(symbol, month, funding_row, data)
            regular_row = futures_rows.get(("kline1h", symbol, month))
            if regular_row is not None:
                _parse_futures_daily("kline1h", symbol, month, regular_row, data)
    _attach_funding_marks(symbols, months, futures_rows, data)
    return data


def merge_market_data(left: MarketData, right: MarketData) -> MarketData:
    result = MarketData({}, {}, {}, {})
    for attribute in ("spot", "futures", "mark_daily"):
        target = getattr(result, attribute)
        for source in (getattr(left, attribute), getattr(right, attribute)):
            for symbol, rows in source.items():
                destination = target.setdefault(symbol, {})
                overlap = set(destination).intersection(rows)
                if overlap:
                    raise EvidenceError(f"period overlap for {attribute} {symbol}")
                destination.update(rows)
    for source in (left.funding, right.funding):
        for symbol, events in source.items():
            result.funding.setdefault(symbol, []).extend(events)
    for symbol, events in result.funding.items():
        ordered = sorted(events, key=lambda item: item.timestamp)
        if len({event.timestamp for event in ordered}) != len(ordered):
            raise EvidenceError(f"duplicate funding timestamp {symbol}")
        if len({funding_mark_hour(event.timestamp) for event in ordered}) != len(ordered):
            raise EvidenceError(f"duplicate funding settlement hour {symbol}")
        result.funding[symbol] = ordered
    result.opened_archives = left.opened_archives + right.opened_archives
    result.opened_bytes = left.opened_bytes + right.opened_bytes
    return result


def median_decimal(values: Sequence[Decimal]) -> Decimal:
    if not values:
        raise EvidenceError("median of empty values")
    ordered = sorted(values)
    midpoint = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[midpoint]
    return (ordered[midpoint - 1] + ordered[midpoint]) / D(2)


def causal_liquidity(data: MarketData, symbol: str, entry_day: date) -> Decimal | None:
    spot_rows = data.spot.get(symbol, {})
    futures_rows = data.futures.get(symbol, {})
    days = [entry_day - timedelta(days=offset) for offset in range(1, 8)]
    if any(day not in spot_rows or day not in futures_rows for day in days):
        return None
    spot_values = [spot_rows[day].quote_volume for day in days]
    futures_values = [futures_rows[day].quote_volume for day in days]
    if any(value <= 0 for value in (*spot_values, *futures_values)):
        return None
    return min(
        spot_values[0],
        median_decimal(spot_values),
        futures_values[0],
        median_decimal(futures_values),
    )


def complete_funding_window(
    data: MarketData,
    symbol: str,
    start: datetime,
    end: datetime,
    *,
    strict_start: bool,
) -> list[FundingEvent] | None:
    if not start < end:
        raise EvidenceError("funding window is not increasing")
    events = [
        event
        for event in data.funding.get(symbol, [])
        if (
            start < funding_mark_hour(event.timestamp) < end
            if strict_start
            else start <= funding_mark_hour(event.timestamp) < end
        )
    ]
    if len(events) < 2:
        return None
    ordered = sorted(events, key=lambda event: funding_mark_hour(event.timestamp))
    hours = [funding_mark_hour(event.timestamp) for event in ordered]
    if len(set(hours)) != len(hours):
        return None
    tolerance = timedelta(seconds=15)
    if hours[0] > start + timedelta(hours=ordered[0].interval_hours) + tolerance:
        return None
    if hours[-1] < end - timedelta(hours=ordered[-1].interval_hours) - tolerance:
        return None
    for previous, current in itertools.pairwise(ordered):
        gap = funding_mark_hour(current.timestamp) - funding_mark_hour(previous.timestamp)
        permitted = (
            timedelta(hours=1.5 * max(previous.interval_hours, current.interval_hours)) + tolerance
        )
        if gap <= timedelta(0) or gap > permitted:
            return None
    return ordered


def positive_funding_score(
    data: MarketData, symbol: str, entry_day: date, lookback_days: int
) -> Decimal | None:
    end = datetime.combine(entry_day, datetime.min.time(), tzinfo=UTC)
    start = end - timedelta(days=lookback_days)
    events = complete_funding_window(data, symbol, start, end, strict_start=False)
    if events is None or events[-1].rate <= 0:
        return None
    score = sum((event.rate for event in events), D(0)) / D(lookback_days)
    return score if score > 0 else None


def _supported_ratio(
    data: MarketData, symbol: str, day: date, leg_notional: Decimal
) -> tuple[Decimal, Decimal] | None:
    if leg_notional <= 0:
        raise EvidenceError("non-positive leg notional")
    spot_liquidity = causal_liquidity(data, symbol, day)
    if spot_liquidity is None:
        return None
    spot = data.spot.get(symbol, {}).get(day - timedelta(days=1))
    futures = data.futures.get(symbol, {}).get(day - timedelta(days=1))
    if spot is None or futures is None:
        return None
    return spot_liquidity / leg_notional, min(
        spot.quote_volume, futures.quote_volume
    ) / leg_notional


def unlevered_equal_base_quantity(
    slot_budget: Decimal, spot_price: Decimal, futures_price: Decimal
) -> Decimal:
    if min(slot_budget, spot_price, futures_price) <= 0:
        raise EvidenceError("unlevered sizing requires positive inputs")
    return slot_budget / max(spot_price, futures_price)


def evaluate_reference_week(
    data: MarketData,
    symbols: Sequence[str],
    trial: Trial,
    entry_day: date,
) -> WeekReference:
    exit_day = entry_day + timedelta(days=7)
    liquidity: list[tuple[Decimal, str]] = []
    for symbol in symbols:
        score = causal_liquidity(data, symbol, entry_day)
        if score is not None:
            liquidity.append((score, symbol))
    liquidity.sort(key=lambda item: (-item[0], item[1]))
    if len(liquidity) < 30:
        return WeekReference(
            entry_day=entry_day,
            valid=False,
            reason=f"causal cohort only {len(liquidity)}/30",
            cohort=tuple(symbol for _, symbol in liquidity),
            selected=(),
            spot_pnl=D(0),
            futures_pnl=D(0),
            funding_pnl=D(0),
            spot_entry_notional=D(0),
            spot_exit_notional=D(0),
            futures_entry_notional=D(0),
            futures_exit_notional=D(0),
            capacity_ratios=(),
            daily_gross=(),
        )
    cohort = tuple(symbol for _, symbol in liquidity[:30])
    scored: list[tuple[Decimal, str]] = []
    for symbol in cohort:
        score = positive_funding_score(data, symbol, entry_day, trial.lookback_days)
        if score is not None:
            scored.append((score, symbol))
    scored.sort(key=lambda item: (-item[0], item[1]))
    selected = tuple(symbol for _, symbol in scored[: trial.slots])
    if not selected:
        return WeekReference(
            entry_day=entry_day,
            valid=True,
            reason=None,
            cohort=cohort,
            selected=(),
            spot_pnl=D(0),
            futures_pnl=D(0),
            funding_pnl=D(0),
            spot_entry_notional=D(0),
            spot_exit_notional=D(0),
            futures_entry_notional=D(0),
            futures_exit_notional=D(0),
            capacity_ratios=(),
            daily_gross=tuple((entry_day + timedelta(days=offset), D(0)) for offset in range(8)),
        )
    spot_pnl = D(0)
    futures_pnl = D(0)
    funding_pnl = D(0)
    spot_entry_notional = D(0)
    spot_exit_notional = D(0)
    futures_entry_notional = D(0)
    futures_exit_notional = D(0)
    capacity_ratios: list[Decimal] = []
    daily_gross = {entry_day + timedelta(days=offset): D(0) for offset in range(8)}
    per_slot_spot = D(500) / D(trial.slots)
    start_dt = datetime.combine(entry_day, datetime.min.time(), tzinfo=UTC)
    end_dt = datetime.combine(exit_day, datetime.min.time(), tzinfo=UTC)
    for symbol in selected:
        spot_entry = data.spot.get(symbol, {}).get(entry_day)
        spot_exit = data.spot.get(symbol, {}).get(exit_day)
        futures_entry = data.futures.get(symbol, {}).get(entry_day)
        futures_exit = data.futures.get(symbol, {}).get(exit_day)
        if None in (spot_entry, spot_exit, futures_entry, futures_exit):
            return invalid_week(
                entry_day, cohort, selected, f"missing selected entry/exit {symbol}"
            )
        assert spot_entry is not None
        assert spot_exit is not None
        assert futures_entry is not None
        assert futures_exit is not None
        if min(spot_entry.open, spot_exit.open, futures_entry.open, futures_exit.open) <= 0:
            return invalid_week(
                entry_day, cohort, selected, f"non-positive selected price {symbol}"
            )
        quantity = unlevered_equal_base_quantity(per_slot_spot, spot_entry.open, futures_entry.open)
        s_entry = quantity * spot_entry.open
        s_exit = quantity * spot_exit.open
        f_entry = quantity * futures_entry.open
        f_exit = quantity * futures_exit.open
        spot_entry_notional += s_entry
        spot_exit_notional += s_exit
        futures_entry_notional += f_entry
        futures_exit_notional += f_exit
        spot_pnl += s_exit - s_entry
        futures_pnl += f_entry - f_exit
        entry_capacity = _supported_ratio(data, symbol, entry_day, max(s_entry, f_entry))
        exit_capacity = _supported_ratio(data, symbol, exit_day, max(s_exit, f_exit))
        if entry_capacity is None or exit_capacity is None:
            return invalid_week(entry_day, cohort, selected, f"missing selected capacity {symbol}")
        capacity_ratios.extend((*entry_capacity, *exit_capacity))
        events = complete_funding_window(data, symbol, start_dt, end_dt, strict_start=True)
        if events is None:
            return invalid_week(entry_day, cohort, selected, f"incomplete in-hold funding {symbol}")
        for event in events:
            if event.mark_open is None or event.mark_open <= 0:
                return invalid_week(entry_day, cohort, selected, f"missing funding mark {symbol}")
            funding_pnl += quantity * event.mark_open * event.rate
        for offset in range(8):
            day = entry_day + timedelta(days=offset)
            spot_mark = data.spot.get(symbol, {}).get(day)
            futures_mark = data.mark_daily.get(symbol, {}).get(day)
            if spot_mark is None or futures_mark is None or futures_mark <= 0:
                return invalid_week(
                    entry_day, cohort, selected, f"missing daily mark {symbol} {day}"
                )
            mark_dt = datetime.combine(day, datetime.min.time(), tzinfo=UTC)
            accrued = sum(
                (
                    quantity * event.mark_open * event.rate
                    for event in events
                    if funding_mark_hour(event.timestamp) < mark_dt and event.mark_open is not None
                ),
                D(0),
            )
            daily_gross[day] += (
                quantity * (spot_mark.open - spot_entry.open)
                + quantity * (futures_entry.open - futures_mark)
                + accrued
            )
    exact_gross = spot_pnl + futures_pnl + funding_pnl
    daily_gross[exit_day] = exact_gross
    return WeekReference(
        entry_day,
        True,
        None,
        cohort,
        selected,
        spot_pnl,
        futures_pnl,
        funding_pnl,
        spot_entry_notional,
        spot_exit_notional,
        futures_entry_notional,
        futures_exit_notional,
        tuple(capacity_ratios),
        tuple(sorted(daily_gross.items())),
    )


def invalid_week(
    entry_day: date, cohort: Sequence[str], selected: Sequence[str], reason: str
) -> WeekReference:
    return WeekReference(
        entry_day=entry_day,
        valid=False,
        reason=reason,
        cohort=tuple(cohort),
        selected=tuple(selected),
        spot_pnl=D(0),
        futures_pnl=D(0),
        funding_pnl=D(0),
        spot_entry_notional=D(0),
        spot_exit_notional=D(0),
        futures_entry_notional=D(0),
        futures_exit_notional=D(0),
        capacity_ratios=(),
        daily_gross=(),
    )


def apply_scenario(reference: WeekReference, scenario: Scenario) -> WeekNet:
    if not reference.valid:
        return WeekNet(
            entry_day=reference.entry_day,
            valid=False,
            reason=reference.reason,
            selected=reference.selected,
            spot_pnl=None,
            futures_pnl=None,
            funding_pnl=None,
            spot_fees=None,
            futures_fees=None,
            adverse_execution=None,
            net=None,
            supported_account_capital=None,
            daily_net=(),
        )
    spot_fee = (
        reference.spot_entry_notional * scenario.spot_entry_fee_bps
        + reference.spot_exit_notional * scenario.spot_exit_fee_bps
    ) / D(10_000)
    futures_fee = (
        reference.futures_entry_notional * scenario.futures_entry_fee_bps
        + reference.futures_exit_notional * scenario.futures_exit_fee_bps
    ) / D(10_000)
    entry_notional = reference.spot_entry_notional + reference.futures_entry_notional
    exit_notional = reference.spot_exit_notional + reference.futures_exit_notional
    entry_adverse = entry_notional * scenario.adverse_bps / D(10_000)
    exit_adverse = exit_notional * scenario.adverse_bps / D(10_000)
    adverse = entry_adverse + exit_adverse
    net = reference.gross - spot_fee - futures_fee - adverse
    accounted = (
        reference.spot_pnl
        + reference.futures_pnl
        + reference.funding_pnl
        - spot_fee
        - futures_fee
        - adverse
    )
    if abs(net - accounted) > D("0.0000000001"):
        raise EvidenceError("economic identity failure")
    daily_net: list[tuple[date, Decimal]] = []
    for day, gross in reference.daily_gross:
        value = gross - (
            reference.spot_entry_notional * scenario.spot_entry_fee_bps / D(10_000)
            + reference.futures_entry_notional * scenario.futures_entry_fee_bps / D(10_000)
            + entry_adverse
        )
        if day == reference.entry_day + timedelta(days=7):
            value = net
        daily_net.append((day, value))
    supported: Decimal | None = None
    if scenario.participation_bps is not None and reference.selected:
        if not reference.capacity_ratios:
            raise EvidenceError("active week missing capacity ratios")
        supported = (
            D(1000) * min(reference.capacity_ratios) * scenario.participation_bps / D(10_000)
        )
    return WeekNet(
        reference.entry_day,
        True,
        None,
        reference.selected,
        reference.spot_pnl,
        reference.futures_pnl,
        reference.funding_pnl,
        spot_fee,
        futures_fee,
        adverse,
        net,
        supported,
        tuple(daily_net),
    )


def evaluate_trial(
    data: MarketData,
    symbols: Sequence[str],
    trial: Trial,
    schedule: Sequence[date],
) -> list[WeekReference]:
    return [evaluate_reference_week(data, symbols, trial, entry_day) for entry_day in schedule]


def max_drawdown(weeks: Sequence[WeekNet]) -> tuple[Decimal, Decimal]:
    cumulative = D(0)
    peak = D(0)
    max_usd = D(0)
    for week in weeks:
        if not week.valid or week.net is None:
            raise EvidenceError("drawdown on invalid week")
        for _, within_week in week.daily_net:
            equity_pnl = cumulative + within_week
            peak = max(peak, equity_pnl)
            max_usd = max(max_usd, peak - equity_pnl)
        cumulative += week.net
        peak = max(peak, cumulative)
    return max_usd, max_usd / D(1000) * D(100)


def scenario_summary(weeks: Sequence[WeekNet]) -> dict[str, Any]:
    if len(weeks) != 51:
        raise EvidenceError("scenario schedule must have 51 rows")
    invalid = [week for week in weeks if not week.valid]
    if invalid:
        return {
            "valid": False,
            "invalidWeeks": len(invalid),
            "invalidReasons": sorted({str(week.reason) for week in invalid}),
            "netUsdPer1000": None,
        }
    values = [week.net for week in weeks]
    if any(value is None for value in values):
        raise EvidenceError("valid week with null net")
    nets = [value for value in values if value is not None]
    net = sum(nets, D(0))
    active = [week for week in weeks if week.selected]
    symbols = sorted({symbol for week in weeks for symbol in week.selected})
    capacities = [
        week.supported_account_capital
        for week in active
        if week.supported_account_capital is not None
    ]
    drawdown_usd, drawdown_pct = max_drawdown(weeks)
    return {
        "valid": True,
        "scheduledWeeks": len(weeks),
        "activeWeeks": len(active),
        "zeroWeeks": len(weeks) - len(active),
        "pairedRoundTrips": sum(len(week.selected) for week in weeks),
        "fills": 4 * sum(len(week.selected) for week in weeks),
        "distinctSymbols": symbols,
        "distinctSymbolCount": len(symbols),
        "netUsdPer1000": decimal_text(net),
        "annualizedMeanWeeklyUsdPer1000": decimal_text(net / D(len(weeks)) * D(52)),
        "maxDailyMarkedDrawdownUsd": decimal_text(drawdown_usd),
        "maxDailyMarkedDrawdownPct": decimal_text(drawdown_pct),
        "minimumSupportedAccountCapitalUsd": decimal_text(min(capacities)) if capacities else None,
        "decomposition": {
            "spotPnlUsd": decimal_text(sum((week.spot_pnl or D(0) for week in weeks), D(0))),
            "perpetualPricePnlUsd": decimal_text(
                sum((week.futures_pnl or D(0) for week in weeks), D(0))
            ),
            "fundingPnlUsd": decimal_text(sum((week.funding_pnl or D(0) for week in weeks), D(0))),
            "spotFeesUsd": decimal_text(sum((week.spot_fees or D(0) for week in weeks), D(0))),
            "perpetualFeesUsd": decimal_text(
                sum((week.futures_fees or D(0) for week in weeks), D(0))
            ),
            "adverseExecutionUsd": decimal_text(
                sum((week.adverse_execution or D(0) for week in weeks), D(0))
            ),
            "netUsd": decimal_text(net),
        },
    }


def _circular_indices(n: int, block: int, rng: random.Random) -> list[int]:
    indices: list[int] = []
    while len(indices) < n:
        start = rng.randrange(n)
        indices.extend((start + offset) % n for offset in range(block))
    return indices[:n]


def _quantile(values: Sequence[float], probability: float) -> float:
    if not values:
        raise EvidenceError("quantile of empty list")
    ordered = sorted(values)
    position = probability * (len(ordered) - 1)
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    fraction = position - lower
    return ordered[lower] * (1 - fraction) + ordered[upper] * fraction


def holm_adjust(raw: Mapping[str, float]) -> dict[str, float]:
    ordered = sorted(raw.items(), key=lambda item: (item[1], item[0]))
    adjusted: dict[str, float] = {}
    running = 0.0
    total = len(ordered)
    for rank, (trial_id, value) in enumerate(ordered):
        running = max(running, min(1.0, (total - rank) * value))
        adjusted[trial_id] = running
    return adjusted


def family_bootstrap(
    matrix: Mapping[str, Sequence[Decimal]],
    block: int,
    replicates: int,
    seed: int,
    alpha: float,
) -> dict[str, Any]:
    trial_ids = sorted(matrix)
    if len(trial_ids) != 12:
        raise EvidenceError("bootstrap family must contain 12 trials")
    lengths = {len(matrix[trial_id]) for trial_id in trial_ids}
    if lengths != {51}:
        raise EvidenceError("bootstrap family must be synchronous 51 weeks")
    values = {
        trial_id: [float_or_fail(value) for value in matrix[trial_id]] for trial_id in trial_ids
    }
    observed = {trial_id: statistics.fmean(values[trial_id]) for trial_id in trial_ids}
    centered = {
        trial_id: [value - observed[trial_id] for value in values[trial_id]]
        for trial_id in trial_ids
    }
    rng = random.Random(seed + block)
    boot: dict[str, list[float]] = {trial_id: [] for trial_id in trial_ids}
    boot_max: list[float] = []
    for _ in range(replicates):
        indices = _circular_indices(51, block, rng)
        means = {
            trial_id: statistics.fmean(centered[trial_id][index] for index in indices)
            for trial_id in trial_ids
        }
        for trial_id, mean in means.items():
            boot[trial_id].append(mean)
        boot_max.append(max(means.values()))
    raw = {
        trial_id: (1 + sum(value >= observed[trial_id] for value in boot[trial_id]))
        / (replicates + 1)
        for trial_id in trial_ids
    }
    holm = holm_adjust(raw)
    observed_max = max(observed.values())
    white_p = (1 + sum(value >= observed_max for value in boot_max)) / (replicates + 1)
    bonferroni_tail = 1.0 - alpha / len(trial_ids)
    lcbs = {
        trial_id: observed[trial_id] - _quantile(boot[trial_id], bonferroni_tail)
        for trial_id in trial_ids
    }
    return {
        "blockWeeks": block,
        "replicates": replicates,
        "rawP": raw,
        "holmAdjustedP": holm,
        "whiteMaxMeanP": white_p,
        "bonferroniLcbMeanWeeklyUsd": lcbs,
        "observedMeanWeeklyUsd": observed,
    }


def pbo_cscv(matrix: Mapping[str, Sequence[Decimal]]) -> dict[str, Any]:
    trial_ids = sorted(matrix)
    if len(trial_ids) != 12 or any(len(matrix[trial_id]) != 51 for trial_id in trial_ids):
        raise EvidenceError("PBO matrix shape mismatch")
    block_scores = {
        trial_id: [
            sum((matrix[trial_id][week] for week in range(block * 4, block * 4 + 4)), D(0))
            for block in range(12)
        ]
        for trial_id in trial_ids
    }
    numerator = 0
    split_count = 0
    for in_blocks in itertools.combinations(range(12), 6):
        in_set = set(in_blocks)
        out_blocks = [block for block in range(12) if block not in in_set]
        in_scores = {
            trial_id: sum((block_scores[trial_id][block] for block in in_blocks), D(0))
            for trial_id in trial_ids
        }
        champion = sorted(trial_ids, key=lambda trial_id: (-in_scores[trial_id], trial_id))[0]
        out_scores = {
            trial_id: sum((block_scores[trial_id][block] for block in out_blocks), D(0))
            for trial_id in trial_ids
        }
        median_oos = median_decimal(list(out_scores.values()))
        if out_scores[champion] <= median_oos:
            numerator += 1
        split_count += 1
    if split_count != 924:
        raise EvidenceError("PBO split count drift")
    matrix_payload = {
        trial_id: [decimal_text(value) for value in block_scores[trial_id]]
        for trial_id in trial_ids
    }
    return {
        "role": "DIAGNOSTIC_ONLY",
        "blockCount": 12,
        "blockWeeks": 4,
        "splitCount": split_count,
        "overfitNumerator": numerator,
        "pbo": numerator / split_count,
        "blockTrialMatrixSha256": sha256_value(matrix_payload),
    }


def holdout_interval(
    values: Sequence[Decimal], block: int, replicates: int, seed: int
) -> dict[str, float]:
    if len(values) != 51:
        raise EvidenceError("holdout interval requires 51 values")
    numeric = [float_or_fail(value) for value in values]
    rng = random.Random(seed + 10_000 + block)
    totals: list[float] = []
    for _ in range(replicates):
        indices = _circular_indices(len(numeric), block, rng)
        totals.append(sum(numeric[index] for index in indices))
    return {
        "blockWeeks": block,
        "twoSided95LowNetUsdPer1000": _quantile(totals, 0.025),
        "twoSided95HighNetUsdPer1000": _quantile(totals, 0.975),
        "oneSided95LcbNetUsdPer1000": _quantile(totals, 0.05),
    }


def _decimal_matrix(
    references: Mapping[str, Sequence[WeekReference]], scenario: Scenario
) -> tuple[dict[str, list[Decimal]], dict[str, list[WeekNet]]]:
    matrix: dict[str, list[Decimal]] = {}
    weeks_by_trial: dict[str, list[WeekNet]] = {}
    for trial_id, trial_refs in references.items():
        weeks = [apply_scenario(reference, scenario) for reference in trial_refs]
        if any(not week.valid or week.net is None for week in weeks):
            reasons = sorted({str(week.reason) for week in weeks if not week.valid})
            raise EvidenceError(f"invalid scheduled week for {trial_id}: {reasons}")
        weeks_by_trial[trial_id] = weeks
        matrix[trial_id] = [week.net for week in weeks if week.net is not None]
    return matrix, weeks_by_trial


def _development_gates(
    trial_id: str,
    summaries: Mapping[str, Mapping[str, Any]],
    inference: Mapping[str, Mapping[str, Any]],
) -> tuple[bool, list[str]]:
    failures: list[str] = []
    for scenario_name in ("PROXY", "STRESS"):
        summary = summaries[scenario_name]
        if D(str(summary["netUsdPer1000"])) <= 0:
            failures.append(f"{scenario_name}_NET_NONPOSITIVE")
        if int(summary["activeWeeks"]) < 24:
            failures.append(f"{scenario_name}_ACTIVE_WEEKS")
        if int(summary["pairedRoundTrips"]) < 72:
            failures.append(f"{scenario_name}_ROUND_TRIPS")
        if int(summary["distinctSymbolCount"]) < 10:
            failures.append(f"{scenario_name}_DISTINCT_SYMBOLS")
        if D(str(summary["maxDailyMarkedDrawdownPct"])) > 10:
            failures.append(f"{scenario_name}_DRAWDOWN")
        capacity = summary["minimumSupportedAccountCapitalUsd"]
        if capacity is None or D(str(capacity)) < 1000:
            failures.append(f"{scenario_name}_CAPACITY")
        scenario_inference = inference[scenario_name]
        for block in ("4", "8"):
            lcb = scenario_inference[f"block{block}"]["bonferroniLcbMeanWeeklyUsd"][trial_id]
            if float(lcb) <= 0:
                failures.append(f"{scenario_name}_LCB_{block}")
        if float(scenario_inference["conservativeHolmAdjustedP"][trial_id]) > 0.05:
            failures.append(f"{scenario_name}_HOLM")
        if float(scenario_inference["conservativeWhiteP"]) > 0.05:
            failures.append(f"{scenario_name}_WHITE")
    return not failures, failures


def _holdout_gates(
    summaries: Mapping[str, Mapping[str, Any]],
    intervals: Mapping[str, Sequence[Mapping[str, float]]],
) -> tuple[bool, list[str]]:
    failures: list[str] = []
    for scenario_name in ("PROXY", "STRESS"):
        summary = summaries[scenario_name]
        if D(str(summary["netUsdPer1000"])) <= 0:
            failures.append(f"{scenario_name}_NET_NONPOSITIVE")
        if int(summary["activeWeeks"]) < 16:
            failures.append(f"{scenario_name}_ACTIVE_WEEKS")
        if int(summary["pairedRoundTrips"]) < 36:
            failures.append(f"{scenario_name}_ROUND_TRIPS")
        if int(summary["distinctSymbolCount"]) < 8:
            failures.append(f"{scenario_name}_DISTINCT_SYMBOLS")
        if D(str(summary["maxDailyMarkedDrawdownPct"])) > 10:
            failures.append(f"{scenario_name}_DRAWDOWN")
        capacity = summary["minimumSupportedAccountCapitalUsd"]
        if capacity is None or D(str(capacity)) < 1000:
            failures.append(f"{scenario_name}_CAPACITY")
        for interval in intervals[scenario_name]:
            if float(interval["oneSided95LcbNetUsdPer1000"]) <= 0:
                failures.append(f"{scenario_name}_LCB_{interval['blockWeeks']}")
    return not failures, failures


def _terminal_unmeasured(
    frozen_commit: str,
    marker: Mapping[str, Any],
    error: Exception,
) -> None:
    if not CANDIDATE_SEAL_PATH.exists():
        terminal_seal = {
            "schema": "cosmos.quant.s1j.candidate-seal.v1",
            "sealedAtUtc": utc_now(),
            "frozenCommit": frozen_commit,
            "freezeSha256": sha256_path(FREEZE_PATH),
            "runMarkerSha256": sha256_path(RUN_MARKER_PATH),
            "championTrialId": None,
            "developmentPassed": False,
            "developmentGateFailures": ["TERMINAL_EVIDENCE_ERROR"],
            "terminalErrorType": type(error).__name__,
            "holdoutOpenedBeforeSeal": False,
        }
        write_exclusive_json(CANDIDATE_SEAL_PATH, terminal_seal)
    holdout_opened = HOLDOUT_MARKER_PATH.exists()
    result = {
        "schema": "cosmos.quant.s1j.result.v1",
        "taskId": "S-1J",
        "status": "TERMINAL",
        "verdict": "UNMEASURED",
        "publicProxyStatus": "INVALID_EVIDENCE",
        "capital": "NO_GO",
        "authority": "NONE",
        "frozenCommit": frozen_commit,
        "freezeSha256": sha256_path(FREEZE_PATH),
        "runMarkerSha256": sha256_value(marker),
        "candidateSealSha256": sha256_path(CANDIDATE_SEAL_PATH),
        "netUsdPer1000": {"developmentProxy": None, "holdoutProxy": None},
        "holdout": {
            "status": ("OPENED_TERMINAL_ERROR" if holdout_opened else "NOT_OPENED_TERMINAL_ERROR"),
            "markerSha256": (sha256_path(HOLDOUT_MARKER_PATH) if holdout_opened else None),
            "netUsdPer1000": None,
        },
        "source": {"sharedArchivesMutated": False},
        "fees": {
            "accountEffectiveSpot": "UNKNOWN",
            "accountEffectiveUsdM": "UNKNOWN",
        },
        "makerEntry": {
            "role": "NON_AUTHORITATIVE_SENSITIVITY",
            "fillTruth": "UNKNOWN",
        },
        "error": {"type": type(error).__name__, "message": str(error)},
        "limitations": [
            "The one S-1J run is consumed and cannot be repaired or rerun.",
            "Invalid evidence is null, never economic zero.",
        ],
    }
    write_json(RESULT_PATH, result)


def run() -> None:
    terminal_paths = (
        RUN_MARKER_PATH,
        CANDIDATE_SEAL_PATH,
        HOLDOUT_MARKER_PATH,
        RESULT_PATH,
    )
    if any(path.exists() for path in terminal_paths):
        raise EvidenceError("S-1J run already started or completed")
    verify_freeze_inputs()
    frozen_commit = verify_clean_freeze_commit()
    marker: dict[str, object] = {
        "schema": "cosmos.quant.s1j.run-consumed.v1",
        "startedAtUtc": utc_now(),
        "frozenCommit": frozen_commit,
        "freezeSha256": sha256_path(FREEZE_PATH),
        "s1jEvaluatorEligibleOutcomeArchiveMembersOpenedBeforeMarker": 0,
        "singleRunConsumed": True,
        "rerunAuthorized": False,
    }
    write_exclusive_json(RUN_MARKER_PATH, marker)
    try:
        source_plan = read_json(SOURCE_PLAN_PATH)
        symbols_raw = source_plan["screenSymbols"]
        if not isinstance(symbols_raw, list):
            raise EvidenceError("screenSymbols malformed")
        symbols = [str(symbol) for symbol in symbols_raw]
        trials = trials_from_ledger()
        scenarios = scenarios_from_protocol()
        protocol = read_json(PROTOCOL_PATH)
        calendar = protocol["calendar"]
        statistics_config = protocol["statistics"]
        dev_schedule = weekly_dates(
            str(calendar["developmentEntryStartInclusive"]),
            str(calendar["developmentEntryEndInclusive"]),
        )
        holdout_schedule = weekly_dates(
            str(calendar["holdoutEntryStartInclusive"]),
            str(calendar["holdoutEntryEndInclusive"]),
        )
        if len(dev_schedule) != 51 or len(holdout_schedule) != 51:
            raise EvidenceError("calendar row count drift")
        dev_months = [str(month) for month in source_plan["outcomeMonths"]["developmentLoad"]]
        dev_data = load_market_data(symbols, dev_months)
        references = {
            trial.trial_id: evaluate_trial(dev_data, symbols, trial, dev_schedule)
            for trial in trials
        }
        invalid = {
            trial_id: sorted({str(reference.reason) for reference in rows if not reference.valid})
            for trial_id, rows in references.items()
            if any(not reference.valid for reference in rows)
        }
        if invalid:
            raise EvidenceError(f"development selected evidence invalid: {invalid}")
        matrices: dict[str, dict[str, list[Decimal]]] = {}
        weeks: dict[str, dict[str, list[WeekNet]]] = {}
        for scenario_name, scenario in scenarios.items():
            matrix, scenario_weeks = _decimal_matrix(references, scenario)
            matrices[scenario_name] = matrix
            weeks[scenario_name] = scenario_weeks
        seed = int(statistics_config["seed"])
        replicates = int(statistics_config["bootstrapReplicates"])
        alpha = float(statistics_config["familywiseAlpha"])
        inference: dict[str, dict[str, Any]] = {}
        for scenario_name in ("PROXY", "STRESS"):
            block4 = family_bootstrap(matrices[scenario_name], 4, replicates, seed, alpha)
            block8 = family_bootstrap(matrices[scenario_name], 8, replicates, seed, alpha)
            conservative_raw = {
                trial.trial_id: max(
                    float(block4["rawP"][trial.trial_id]),
                    float(block8["rawP"][trial.trial_id]),
                )
                for trial in trials
            }
            inference[scenario_name] = {
                "block4": block4,
                "block8": block8,
                "conservativeRawP": conservative_raw,
                "conservativeHolmAdjustedP": holm_adjust(conservative_raw),
                "conservativeWhiteP": max(
                    float(block4["whiteMaxMeanP"]), float(block8["whiteMaxMeanP"])
                ),
            }
        stress_lcb4 = inference["STRESS"]["block4"]["bonferroniLcbMeanWeeklyUsd"]
        stress_lcb8 = inference["STRESS"]["block8"]["bonferroniLcbMeanWeeklyUsd"]
        stress_nets = {
            trial.trial_id: sum(matrices["STRESS"][trial.trial_id], D(0)) for trial in trials
        }
        champion_id = sorted(
            (trial.trial_id for trial in trials),
            key=lambda trial_id: (
                -min(float(stress_lcb4[trial_id]), float(stress_lcb8[trial_id])),
                -float_or_fail(stress_nets[trial_id]),
                trial_id,
            ),
        )[0]
        champion_trial = next(trial for trial in trials if trial.trial_id == champion_id)
        dev_summaries = {
            scenario_name: scenario_summary(weeks[scenario_name][champion_id])
            for scenario_name in scenarios
        }
        pbo = pbo_cscv(matrices["STRESS"])
        dev_pass, dev_failures = _development_gates(champion_id, dev_summaries, inference)
        dev_digest_payload = {
            scenario_name: {
                trial_id: [decimal_text(value) for value in values]
                for trial_id, values in matrix.items()
            }
            for scenario_name, matrix in matrices.items()
        }
        candidate_seal: dict[str, object] = {
            "schema": "cosmos.quant.s1j.candidate-seal.v1",
            "sealedAtUtc": utc_now(),
            "frozenCommit": frozen_commit,
            "freezeSha256": sha256_path(FREEZE_PATH),
            "runMarkerSha256": sha256_path(RUN_MARKER_PATH),
            "championTrialId": champion_id,
            "champion": {
                "lookbackDays": champion_trial.lookback_days,
                "slots": champion_trial.slots,
            },
            "developmentMatrixSha256": sha256_value(dev_digest_payload),
            "developmentPassed": dev_pass,
            "developmentGateFailures": dev_failures,
            "pbo": pbo,
            "holdoutOpenedBeforeSeal": False,
        }
        write_exclusive_json(CANDIDATE_SEAL_PATH, candidate_seal)
        common_result: dict[str, Any] = {
            "schema": "cosmos.quant.s1j.result.v1",
            "taskId": "S-1J",
            "status": "TERMINAL",
            "capital": "NO_GO",
            "authority": "NONE",
            "consumer": "N3 successor/orchestrator scoreboard",
            "frozenCommit": frozen_commit,
            "baseCommit": BASE_COMMIT,
            "freezeSha256": sha256_path(FREEZE_PATH),
            "runMarkerSha256": sha256_path(RUN_MARKER_PATH),
            "candidateSealSha256": sha256_path(CANDIDATE_SEAL_PATH),
            "source": {
                "screenSymbolCount": len(symbols),
                "screenSymbolListSha256": source_plan["screenSymbolListSha256"],
                "futuresManifestSha256": source_plan["futures"]["manifestSha256"],
                "spotManifestSha256": source_plan["spot"]["manifestSha256"],
                "developmentArchivesOpened": dev_data.opened_archives,
                "developmentArchiveBytesRead": dev_data.opened_bytes,
                "sharedArchivesMutated": False,
            },
            "champion": {
                "trialId": champion_id,
                "lookbackDays": champion_trial.lookback_days,
                "slots": champion_trial.slots,
            },
            "development": {
                "scheduleRows": len(dev_schedule),
                "scenarios": dev_summaries,
                "passed": dev_pass,
                "gateFailures": dev_failures,
            },
            "multiplicity": inference,
            "pbo": pbo,
            "makerEntry": {
                "role": "NON_AUTHORITATIVE_SENSITIVITY",
                "fillTruth": "UNKNOWN",
                "development": dev_summaries["MAKER_SENSITIVITY"],
            },
            "fees": {
                "accountEffectiveSpot": "UNKNOWN",
                "accountEffectiveUsdM": "UNKNOWN",
                "decisionScenarios": ["PROXY", "STRESS"],
            },
            "capacity": {
                "basis": "PUBLIC_QUOTE_VOLUME_PROXY",
                "executableDepthQueueCapacityUsd": None,
                "executableCapacityStatus": "UNKNOWN",
            },
            "limitations": [
                "Account-effective Spot and USD-M fees are UNKNOWN.",
                (
                    "Maker queue, paired fill probability, historical BBO/depth, "
                    "and executable capacity are UNKNOWN."
                ),
                (
                    "Historical exchange filters and funding rateType are absent "
                    "from the reused archives."
                ),
                (
                    "Spot daily bars make adverse execution, intraday drawdown, "
                    "and capacity conditional proxies."
                ),
                (
                    "The holdout is S-1J evaluator-unopened before its marker, "
                    "not globally unpublished public data."
                ),
                (
                    "S-META1 does not preauthorize S-1J; cross-family p is "
                    "effectively 1 pending a prospective registry successor."
                ),
            ],
        }
        if not dev_pass:
            common_result.update(
                {
                    "verdict": "NO_GO",
                    "publicProxyStatus": "DEVELOPMENT_GATE_FAIL",
                    "netUsdPer1000": {
                        "developmentProxy": dev_summaries["PROXY"]["netUsdPer1000"],
                        "holdoutProxy": None,
                    },
                    "holdout": {
                        "status": "SEALED_NOT_OPENED_DEVELOPMENT_GATE_FAIL",
                        "markerExists": False,
                        "netUsdPer1000": None,
                    },
                    "zeroCrediblePositives": True,
                }
            )
            write_json(RESULT_PATH, common_result)
            print(json.dumps({"verdict": "NO_GO", "champion": champion_id}, sort_keys=True))
            return
        holdout_marker: dict[str, object] = {
            "schema": "cosmos.quant.s1j.holdout-opened.v1",
            "openedAtUtc": utc_now(),
            "frozenCommit": frozen_commit,
            "candidateSealSha256": sha256_path(CANDIDATE_SEAL_PATH),
            "championTrialId": champion_id,
            "july2025ThroughJune2026OutcomeArchiveMembersOpenedBeforeMarker": 0,
            "runnerUpFallbackAuthorized": False,
        }
        write_exclusive_json(HOLDOUT_MARKER_PATH, holdout_marker)
        holdout_months = [str(month) for month in source_plan["outcomeMonths"]["holdoutLoad"]]
        holdout_only = load_market_data(symbols, holdout_months)
        full_data = merge_market_data(dev_data, holdout_only)
        holdout_refs = evaluate_trial(full_data, symbols, champion_trial, holdout_schedule)
        if any(not reference.valid for reference in holdout_refs):
            reasons = sorted(
                {str(reference.reason) for reference in holdout_refs if not reference.valid}
            )
            raise EvidenceError(f"holdout selected evidence invalid: {reasons}")
        holdout_weeks = {
            scenario_name: [apply_scenario(reference, scenario) for reference in holdout_refs]
            for scenario_name, scenario in scenarios.items()
        }
        holdout_summaries = {
            scenario_name: scenario_summary(rows) for scenario_name, rows in holdout_weeks.items()
        }
        intervals = {
            scenario_name: [
                holdout_interval(
                    [week.net for week in rows if week.net is not None],
                    block,
                    replicates,
                    seed,
                )
                for block in (4, 8)
            ]
            for scenario_name, rows in holdout_weeks.items()
            if scenario_name in {"PROXY", "STRESS"}
        }
        holdout_pass, holdout_failures = _holdout_gates(holdout_summaries, intervals)
        common_result["source"]["holdoutArchivesOpened"] = holdout_only.opened_archives
        common_result["source"]["holdoutArchiveBytesRead"] = holdout_only.opened_bytes
        common_result["makerEntry"]["holdout"] = holdout_summaries["MAKER_SENSITIVITY"]
        common_result["holdout"] = {
            "status": "OPENED_CHAMPION_ONLY",
            "markerSha256": sha256_path(HOLDOUT_MARKER_PATH),
            "scheduleRows": len(holdout_schedule),
            "scenarios": holdout_summaries,
            "intervals": intervals,
            "passed": holdout_pass,
            "gateFailures": holdout_failures,
        }
        common_result["netUsdPer1000"] = {
            "developmentProxy": dev_summaries["PROXY"]["netUsdPer1000"],
            "holdoutProxy": holdout_summaries["PROXY"]["netUsdPer1000"],
        }
        if holdout_pass:
            common_result["verdict"] = "UNMEASURED"
            common_result["publicProxyStatus"] = (
                "PUBLIC_PROXY_POSITIVE_ACCOUNT_AND_EXECUTION_UNKNOWN"
            )
            common_result["zeroCrediblePositives"] = True
        else:
            common_result["verdict"] = "NO_GO"
            common_result["publicProxyStatus"] = "HOLDOUT_GATE_FAIL"
            common_result["zeroCrediblePositives"] = True
        write_json(RESULT_PATH, common_result)
        print(
            json.dumps(
                {"verdict": common_result["verdict"], "champion": champion_id},
                sort_keys=True,
            )
        )
    except Exception as exc:
        _terminal_unmeasured(frozen_commit, marker, exc)
        raise


def finalize() -> None:
    if not RESULT_PATH.is_file():
        raise EvidenceError("result absent")
    names = [
        name
        for name in (
            *FREEZE_INPUTS,
            "freeze.v1.json",
            "run_consumed.v1.json",
            "candidate_seal.v1.json",
            "holdout_opened.v1.json",
            "result.v1.json",
        )
        if (HERE / name).is_file()
    ]
    lines = [f"{sha256_path(HERE / name)}  {name}" for name in sorted(names)]
    SHA256SUMS_PATH.write_text("\n".join(lines) + "\n")
    print(json.dumps({"status": "FINALIZED", "files": len(lines)}, sort_keys=True))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("prepare", "run", "finalize"))
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    command = build_parser().parse_args(argv).command
    try:
        if command == "prepare":
            prepare()
        elif command == "run":
            run()
        else:
            finalize()
    except EvidenceError as exc:
        print(f"S1J_EVIDENCE_ERROR: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
