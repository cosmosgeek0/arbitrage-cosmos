#!/usr/bin/env python3
"""Sealed, network-free S-1V public USD-M research evaluator.

The lifecycle is intentionally irreversible::

    preseal -> screen -> freeze -> run

Every marker is written with ``O_CREAT|O_EXCL`` before the corresponding ZIP
member can be opened.  The evaluator never downloads data and never imports a
network, process, account, or order client.
"""

from __future__ import annotations

import argparse
import bisect
import csv
import hashlib
import io
import itertools
import json
import math
import os
import random
import re
import sys
import zipfile
from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path, PurePosixPath
from typing import Any, Final, cast

HERE: Final = Path(__file__).resolve().parent
BASE_COMMIT: Final = "a169b123fb186d1943a75ad648552c4d95be1be1"
SCHEMA_PREFIX: Final = "cosmos.quant.research.s1v"
DEFAULT_SOURCE_ROOT: Final = Path("/private/tmp/cosmos-s1v-funding-dispersion-transition-v1")
STATIC_FILES: Final = frozenset(
    {
        "OFFICIAL_SOURCE_RESEARCH.md",
        "README.md",
        "experiment.py",
        "protocol.v1.json",
        "source_plan.v1.json",
        "test_experiment.py",
        "test_verifier.py",
        "trial_ledger.v1.json",
        "verifier.py",
    }
)
FREEZE_BINDINGS: Final = STATIC_FILES | {
    "preseal.v1.json",
    "screen_consumed.v1.json",
    "source_manifest.v1.json",
    "universe.v1.json",
}
SCREEN_MONTHS: Final = ("2025-06",)
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
ALL_MONTHS: Final = SCREEN_MONTHS + DEVELOPMENT_MONTHS + HOLDOUT_MONTHS
SOURCE_KINDS: Final = ("fundingRate", "klines_1h", "markPriceKlines_1h")
HOUR_MS: Final = 3_600_000
DAY_MS: Final = 86_400_000
SCREEN_START_MS: Final = int(datetime(2025, 6, 1, tzinfo=UTC).timestamp() * 1000)
DEVELOPMENT_START_MS: Final = int(datetime(2025, 7, 1, tzinfo=UTC).timestamp() * 1000)
DEVELOPMENT_END_MS: Final = int(datetime(2026, 4, 1, tzinfo=UTC).timestamp() * 1000)
HOLDOUT_HISTORY_START_MS: Final = int(datetime(2026, 3, 1, tzinfo=UTC).timestamp() * 1000)
HOLDOUT_START_MS: Final = int(datetime(2026, 4, 8, tzinfo=UTC).timestamp() * 1000)
HOLDOUT_END_MS: Final = int(datetime(2026, 7, 1, tzinfo=UTC).timestamp() * 1000)
CAPITAL: Final = Decimal("1000")
SIDE_GROSS: Final = Decimal("500")
MEMBER_NOTIONAL: Final = SIDE_GROSS / Decimal(3)
BASE_PARTICIPATION: Final = Decimal("0.00005")
BOOTSTRAP_REPLICATES: Final = 4096
BOOTSTRAP_SEED: Final = 20260729
ALPHA: Final = Decimal("0.05")
MAX_ZIP_BYTES: Final = 512 * 1024 * 1024
MAX_MEMBER_BYTES: Final = 1024 * 1024 * 1024
MAX_SIDECAR_BYTES: Final = 4096
MAX_COMPRESSION_RATIO: Final = 250
SYMBOL_RE: Final = re.compile(r"^[A-Z0-9]+USDT$")
SHA256_RE: Final = re.compile(r"^[0-9a-fA-F]{64}$")
COMMIT_RE: Final = re.compile(r"^[0-9a-f]{40}$")
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
FUNDING_HEADER: Final = (
    "calc_time",
    "funding_interval_hours",
    "last_funding_rate",
)
EFFECTS: Final = {
    "live_trading": False,
    "money_moved_usd": 0,
    "orders_placed": 0,
    "private_api_used": False,
    "provider_mutation": False,
    "transfers": 0,
    "withdrawals": 0,
}
COSTS: Final = {
    "base": (Decimal("4"), Decimal("2")),
    "stress": (Decimal("8"), Decimal("5")),
    "severe": (Decimal("10"), Decimal("10")),
}
HOLDOUT_GATE_NAMES: Final = (
    "active_cohorts_min",
    "active_weeks_min",
    "base_capacity_min_usd_gte",
    "base_net_usd_per_1000_gt",
    "distinct_traded_symbols_min",
    "pointwise_base_lower_bound_gt",
    "pointwise_stress_lower_bound_gt",
    "remove_best_month_stress_net_usd_per_1000_gt",
    "remove_best_symbol_stress_net_usd_per_1000_gt",
    "severe_hourly_marked_equity_max_drawdown_lte",
    "stress_net_usd_per_1000_gt",
)
MEMBER_OPEN_COUNTS: dict[str, int] = {
    "development": 0,
    "holdout": 0,
    "screen": 0,
}
MEMBER_OPEN_STAGE: str | None = None


class S1VError(RuntimeError):
    """Stable experiment failure."""

    def __init__(self, code: str, detail: str = ""):
        super().__init__(f"{code}:{detail}" if detail else code)
        self.code = code
        self.detail = detail


class ContractError(S1VError):
    """Frozen lifecycle or packet contract failure."""


class EvidenceError(S1VError):
    """Checksum, archive, chronology, or selected-evidence failure."""


@dataclass(frozen=True, slots=True)
class Trial:
    trial_id: str
    compression_observations: int
    expansion_ratio: Decimal
    hold_hours: int


@dataclass(frozen=True, slots=True)
class FundingRow:
    time_ms: int
    interval_hours: int
    rate: Decimal

    @property
    def normalized_rate(self) -> Decimal:
        return self.rate * Decimal(8) / Decimal(self.interval_hours)


@dataclass(frozen=True, slots=True)
class Bar:
    open_time_ms: int
    open_price: Decimal
    high_price: Decimal
    low_price: Decimal
    close_price: Decimal
    close_time_ms: int
    quote_volume: Decimal


@dataclass(frozen=True, slots=True)
class Innovation:
    symbol: str
    delta: Decimal
    prior_rate: Decimal
    latest_rate: Decimal


@dataclass(frozen=True, slots=True)
class Snapshot:
    time_ms: int
    dispersion: Decimal
    baseline: Decimal | None
    innovations: tuple[Innovation, ...]


@dataclass(frozen=True, slots=True)
class Position:
    symbol: str
    side: int
    quantity: Decimal
    entry_notional: Decimal
    exit_notional: Decimal
    price_pnl: Decimal
    funding_pnl: Decimal
    net: Mapping[str, Decimal]
    costs: Mapping[str, Decimal]
    capacity_proxy_usd: Decimal


@dataclass(frozen=True, slots=True)
class Cohort:
    decision_ms: int
    entry_ms: int
    exit_ms: int
    pairs: tuple[tuple[str, str], ...]
    positions: tuple[Position, ...]
    net: Mapping[str, Decimal]
    severe_marked_path: tuple[tuple[int, Decimal], ...]
    capacity_proxy_usd: Decimal


@dataclass(frozen=True, slots=True)
class TrialResult:
    trial: Trial
    cohorts: tuple[Cohort, ...]
    valid_cash_epochs: int
    skipped_active_epochs: int
    valid_decision_epochs: int


@dataclass(slots=True)
class MarketData:
    funding: dict[str, tuple[FundingRow, ...]]
    mark: dict[str, dict[int, Bar]]
    contract: dict[str, dict[int, Bar]]


def canonical_bytes(value: Any) -> bytes:
    return (
        json.dumps(
            value,
            allow_nan=False,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
        + b"\n"
    )


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError as exc:
        raise ContractError("FILE_HASH_FAILED", str(path)) from exc
    return digest.hexdigest()


def load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ContractError("JSON_READ_FAILED", str(path)) from exc
    if not isinstance(value, dict):
        raise ContractError("JSON_OBJECT_REQUIRED", str(path))
    return dict(value)


def load_canonical_json(path: Path, schema: str) -> dict[str, Any]:
    value = load_json(path)
    try:
        raw = path.read_bytes()
    except OSError as exc:
        raise ContractError("JSON_READ_FAILED", str(path)) from exc
    if raw != canonical_bytes(value) or value.get("schema") != schema:
        raise ContractError("CANONICAL_SCHEMA_INVALID", str(path))
    if "artifactSha256" in value or "artifact_sha256" in value:
        raise ContractError("SELF_DIGEST_FORBIDDEN", str(path))
    return value


def write_once_json(path: Path, value: Mapping[str, Any]) -> None:
    """Write canonical JSON once; a failed write leaves the marker consumed."""

    path.parent.mkdir(parents=True, exist_ok=True)
    payload = canonical_bytes(dict(value))
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o444)
    except FileExistsError as exc:
        raise ContractError("CREATE_ONCE_REFUSED", str(path)) from exc
    with os.fdopen(descriptor, "wb") as stream:
        stream.write(payload)
        stream.flush()
        os.fsync(stream.fileno())


def utc_now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def iso_ms(value: int) -> str:
    return datetime.fromtimestamp(value / 1000, UTC).isoformat().replace("+00:00", "Z")


def month_bounds_ms(month: str) -> tuple[int, int]:
    start = datetime.strptime(month, "%Y-%m").replace(tzinfo=UTC)
    if start.month == 12:
        end = start.replace(year=start.year + 1, month=1)
    else:
        end = start.replace(month=start.month + 1)
    return int(start.timestamp() * 1000), int(end.timestamp() * 1000)


def day_start_ms(value: int) -> int:
    return value - value % DAY_MS


def decimal_value(value: Any, field: str) -> Decimal:
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise EvidenceError("DECIMAL_INVALID", field) from exc
    if not number.is_finite():
        raise EvidenceError("DECIMAL_NONFINITE", field)
    return number


def decimal_string(value: Decimal, places: str | None = None) -> str:
    if places is not None:
        value = value.quantize(Decimal(places))
    if value == 0:
        return "0"
    return format(value, "f")


def set_member_open_stage(stage: str) -> None:
    global MEMBER_OPEN_STAGE
    if stage not in MEMBER_OPEN_COUNTS:
        raise ContractError("MEMBER_OPEN_STAGE_INVALID", stage)
    MEMBER_OPEN_COUNTS[stage] = 0
    MEMBER_OPEN_STAGE = stage


def median_decimal(values: Sequence[Decimal]) -> Decimal:
    if not values:
        raise EvidenceError("MEDIAN_EMPTY")
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) / Decimal(2)


def trial_family() -> tuple[Trial, ...]:
    return tuple(
        Trial(
            f"c{compression}_x{str(expansion).replace('.', 'p')}_h{hold}",
            compression,
            expansion,
            hold,
        )
        for compression in (3, 6)
        for expansion in (Decimal("1.25"), Decimal("1.75"))
        for hold in (6, 12, 24)
    )


def validate_static_contracts() -> None:
    protocol = load_canonical_json(HERE / "protocol.v1.json", f"{SCHEMA_PREFIX}.protocol.v1")
    source_plan = load_canonical_json(
        HERE / "source_plan.v1.json", f"{SCHEMA_PREFIX}.source_plan.v1"
    )
    ledger = load_canonical_json(HERE / "trial_ledger.v1.json", f"{SCHEMA_PREFIX}.trial_ledger.v1")
    if protocol.get("canonical_base") != BASE_COMMIT:
        raise ContractError("PROTOCOL_BASE_INVALID")
    if source_plan.get("protocol_id") != protocol.get("protocol_id"):
        raise ContractError("SOURCE_PLAN_PROTOCOL_DRIFT")
    raw_trials = ledger.get("trials")
    if not isinstance(raw_trials, list):
        raise ContractError("TRIAL_LEDGER_INVALID")
    expected = [
        {
            "trial_id": item.trial_id,
            "compression_run_observations": item.compression_observations,
            "expansion_ratio": float(item.expansion_ratio),
            "hold_hours": item.hold_hours,
        }
        for item in trial_family()
    ]
    observed = [
        {
            key: raw.get(key)
            for key in (
                "trial_id",
                "compression_run_observations",
                "expansion_ratio",
                "hold_hours",
            )
        }
        for raw in raw_trials
        if isinstance(raw, dict)
    ]
    if observed != expected:
        raise ContractError("TRIAL_LEDGER_DRIFT")


def bound_files(names: Iterable[str]) -> dict[str, str]:
    return {name: sha256_file(HERE / name) for name in sorted(names)}


def source_root_guard(path: Path) -> Path:
    root = path.resolve()
    if root != DEFAULT_SOURCE_ROOT.resolve():
        raise ContractError("SOURCE_ROOT_INVALID", str(root))
    if not root.is_dir() or root.is_symlink():
        raise ContractError("SOURCE_ROOT_UNAVAILABLE", str(root))
    try:
        root.relative_to(HERE.parents[2])
    except ValueError:
        return root
    raise ContractError("SOURCE_ROOT_INSIDE_GIT", str(root))


def archive_path(root: Path, kind: str, symbol: str, month: str) -> Path:
    if kind == "fundingRate":
        relative = Path(
            "data/futures/um/monthly/fundingRate",
            symbol,
            f"{symbol}-fundingRate-{month}.zip",
        )
    elif kind == "klines_1h":
        relative = Path(
            "data/futures/um/monthly/klines",
            symbol,
            "1h",
            f"{symbol}-1h-{month}.zip",
        )
    elif kind == "markPriceKlines_1h":
        relative = Path(
            "data/futures/um/monthly/markPriceKlines",
            symbol,
            "1h",
            f"{symbol}-1h-{month}.zip",
        )
    else:
        raise ContractError("SOURCE_KIND_INVALID", kind)
    candidate = root / relative
    try:
        candidate.resolve(strict=False).relative_to(root.resolve())
    except ValueError as exc:
        raise EvidenceError("SOURCE_PATH_ESCAPE", str(candidate)) from exc
    return candidate


def relative_source_path(root: Path, path: Path) -> str:
    relative = path.relative_to(root).as_posix()
    pure = PurePosixPath(relative)
    if pure.is_absolute() or ".." in pure.parts or "." in pure.parts:
        raise EvidenceError("SOURCE_PATH_INVALID", relative)
    return relative


def parse_checksum(raw: bytes, filename: str) -> str:
    if not raw or len(raw) > MAX_SIDECAR_BYTES:
        raise EvidenceError("CHECKSUM_SIZE_INVALID", filename)
    try:
        fields = raw.decode("ascii").strip().split()
    except UnicodeDecodeError as exc:
        raise EvidenceError("CHECKSUM_ENCODING_INVALID", filename) from exc
    if len(fields) != 2 or SHA256_RE.fullmatch(fields[0]) is None:
        raise EvidenceError("CHECKSUM_SHAPE_INVALID", filename)
    bound_name = fields[1].lstrip("*")
    if bound_name != filename or "/" in bound_name or "\\" in bound_name:
        raise EvidenceError("CHECKSUM_FILENAME_INVALID", filename)
    return fields[0].lower()


def source_record(root: Path, kind: str, symbol: str, month: str) -> dict[str, Any]:
    path = archive_path(root, kind, symbol, month)
    sidecar = path.with_name(path.name + ".CHECKSUM")
    base: dict[str, Any] = {
        "acquisition_state": "UNAVAILABLE",
        "availability": "UNAVAILABLE",
        "byte_count": None,
        "http_status": None,
        "kind": kind,
        "local_relative_path": relative_source_path(root, path),
        "member_state": ("SCREEN_OPENED_ONCE" if month in SCREEN_MONTHS else "OPAQUE_UNOPENED"),
        "month": month,
        "sidecar_expected_zip_sha256": None,
        "sidecar_sha256": None,
        "source_url": ("https://data.binance.vision/" + relative_source_path(root, path)),
        "symbol": symbol,
        "zip_sha256": None,
    }
    if path.is_symlink() or sidecar.is_symlink() or not path.is_file() or not sidecar.is_file():
        return base
    size = path.stat().st_size
    if size <= 0 or size > MAX_ZIP_BYTES:
        return base
    raw_sidecar = sidecar.read_bytes()
    publisher = parse_checksum(raw_sidecar, path.name)
    observed = sha256_file(path)
    if observed != publisher:
        raise EvidenceError("PUBLISHER_CHECKSUM_MISMATCH", str(path))
    base.update(
        {
            "acquisition_state": "LOCAL_OFFICIAL_ARCHIVE_REUSE_CHECKSUM_VERIFIED",
            "availability": "AVAILABLE",
            "byte_count": size,
            "sidecar_expected_zip_sha256": publisher,
            "sidecar_sha256": sha256_bytes(raw_sidecar),
            "zip_sha256": observed,
        }
    )
    return base


def archive_member_bytes(path: Path) -> bytes:
    try:
        with zipfile.ZipFile(path) as archive:
            members = [member for member in archive.infolist() if not member.is_dir()]
            if len(members) != 1:
                raise EvidenceError("ZIP_MEMBER_COUNT_INVALID", str(path))
            member = members[0]
            if (
                member.flag_bits & 0x1
                or Path(member.filename).name != member.filename
                or "\\" in member.filename
                or not member.filename.endswith(".csv")
                or member.file_size <= 0
                or member.file_size > MAX_MEMBER_BYTES
                or (member.external_attr >> 16) & 0o170000 == 0o120000
            ):
                raise EvidenceError("ZIP_MEMBER_INVALID", str(path))
            compressed = max(member.compress_size, 1)
            if member.file_size / compressed > MAX_COMPRESSION_RATIO:
                raise EvidenceError("ZIP_COMPRESSION_RATIO_INVALID", str(path))
            if MEMBER_OPEN_STAGE is not None:
                MEMBER_OPEN_COUNTS[MEMBER_OPEN_STAGE] += 1
            return archive.read(member)
    except (OSError, zipfile.BadZipFile) as exc:
        raise EvidenceError("ZIP_READ_FAILED", str(path)) from exc


def csv_rows(path: Path) -> list[list[str]]:
    raw = archive_member_bytes(path)
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise EvidenceError("CSV_ENCODING_INVALID", str(path)) from exc
    rows = [row for row in csv.reader(io.StringIO(text)) if row]
    if not rows:
        raise EvidenceError("CSV_EMPTY", str(path))
    return rows


def _int_field(raw: str, field: str) -> int:
    try:
        return int(raw)
    except ValueError as exc:
        raise EvidenceError("INTEGER_INVALID", field) from exc


def read_funding_archive(path: Path, month: str) -> tuple[FundingRow, ...]:
    rows = csv_rows(path)
    if tuple(value.strip() for value in rows[0]) != FUNDING_HEADER:
        raise EvidenceError("FUNDING_HEADER_INVALID", str(path))
    start_ms, end_ms = month_bounds_ms(month)
    parsed: list[FundingRow] = []
    for number, row in enumerate(rows[1:], start=2):
        if len(row) != 3:
            raise EvidenceError("FUNDING_ROW_WIDTH_INVALID", f"{path}:{number}")
        time_ms = _int_field(row[0], f"{path}:{number}:calc_time")
        interval = _int_field(row[1], f"{path}:{number}:interval")
        rate = decimal_value(row[2], f"{path}:{number}:rate")
        if not start_ms <= time_ms < end_ms or not 1 <= interval <= 24:
            raise EvidenceError("FUNDING_FIELD_INVALID", f"{path}:{number}")
        if parsed:
            previous = parsed[-1]
            maximum_gap = Decimal("1.5") * Decimal(
                max(previous.interval_hours, interval)
            ) * Decimal(HOUR_MS) + Decimal(1000)
            if time_ms <= previous.time_ms or Decimal(time_ms - previous.time_ms) > maximum_gap:
                raise EvidenceError("FUNDING_CHRONOLOGY_INVALID", f"{path}:{number}")
        parsed.append(FundingRow(time_ms, interval, rate))
    if not parsed:
        raise EvidenceError("FUNDING_ROWS_EMPTY", str(path))
    first = parsed[0]
    first_boundary_limit = Decimal("1.5") * Decimal(first.interval_hours) * Decimal(
        HOUR_MS
    ) + Decimal(1000)
    if Decimal(first.time_ms - start_ms) > first_boundary_limit:
        raise EvidenceError("FUNDING_FIRST_BOUNDARY_STALE", str(path))
    last = parsed[-1]
    last_boundary_limit = Decimal("1.5") * Decimal(last.interval_hours) * Decimal(
        HOUR_MS
    ) + Decimal(1000)
    if Decimal(end_ms - last.time_ms) > last_boundary_limit:
        raise EvidenceError("FUNDING_LAST_BOUNDARY_STALE", str(path))
    return tuple(parsed)


def read_kline_archive(path: Path, month: str) -> tuple[Bar, ...]:
    rows = csv_rows(path)
    header = tuple(value.strip().lower() for value in rows[0])
    data = rows[1:] if header == KLINE_HEADER else rows
    start_ms, end_ms = month_bounds_ms(month)
    parsed: list[Bar] = []
    for number, row in enumerate(data, start=2 if data is not rows else 1):
        if len(row) != 12:
            raise EvidenceError("KLINE_ROW_WIDTH_INVALID", f"{path}:{number}")
        open_ms = _int_field(row[0], f"{path}:{number}:open_time")
        close_ms = _int_field(row[6], f"{path}:{number}:close_time")
        open_price = decimal_value(row[1], f"{path}:{number}:open")
        high = decimal_value(row[2], f"{path}:{number}:high")
        low = decimal_value(row[3], f"{path}:{number}:low")
        close = decimal_value(row[4], f"{path}:{number}:close")
        quote = decimal_value(row[7], f"{path}:{number}:quote_volume")
        if (
            not start_ms <= open_ms < end_ms
            or open_ms % HOUR_MS != 0
            or not open_ms <= close_ms < open_ms + HOUR_MS
            or min(open_price, high, low, close) <= 0
            or high < max(open_price, close, low)
            or low > min(open_price, close, high)
            or quote < 0
            or (parsed and open_ms <= parsed[-1].open_time_ms)
        ):
            raise EvidenceError("KLINE_FIELD_INVALID", f"{path}:{number}")
        parsed.append(Bar(open_ms, open_price, high, low, close, close_ms, quote))
    if not parsed:
        raise EvidenceError("KLINE_ROWS_EMPTY", str(path))
    return tuple(parsed)


def require_complete_month(bars: Sequence[Bar], month: str) -> None:
    start, end = month_bounds_ms(month)
    expected = tuple(range(start, end, HOUR_MS))
    observed = tuple(row.open_time_ms for row in bars)
    if observed != expected:
        raise EvidenceError("KLINE_MONTH_GRID_INVALID", month)


def candidate_symbols(root: Path) -> tuple[str, ...]:
    funding_root = root / "data/futures/um/monthly/fundingRate"
    if not funding_root.is_dir():
        raise EvidenceError("FUNDING_ROOT_UNAVAILABLE", str(funding_root))
    found: list[str] = []
    for entry in funding_root.iterdir():
        symbol = entry.name
        if not entry.is_dir() or SYMBOL_RE.fullmatch(symbol) is None:
            continue
        paths = [archive_path(root, kind, symbol, "2025-06") for kind in SOURCE_KINDS]
        if all(
            path.is_file() and path.with_name(path.name + ".CHECKSUM").is_file() for path in paths
        ):
            found.append(symbol)
    return tuple(sorted(found))


def _screen_open_delta(before: int, symbol: str) -> int:
    delta = MEMBER_OPEN_COUNTS["screen"] - before
    if not 0 <= delta <= len(SOURCE_KINDS):
        raise ContractError("SCREEN_MEMBER_OPEN_DELTA_INVALID", symbol)
    return delta


def evaluate_screen_attempts(
    root: Path,
    symbols: Sequence[str],
) -> list[dict[str, Any]]:
    attempts: list[dict[str, Any]] = []
    for symbol in sorted(symbols):
        before = MEMBER_OPEN_COUNTS["screen"]
        try:
            records = {kind: source_record(root, kind, symbol, "2025-06") for kind in SOURCE_KINDS}
            if any(record["availability"] != "AVAILABLE" for record in records.values()):
                raise EvidenceError("SCREEN_SOURCE_UNAVAILABLE", symbol)
            funding = read_funding_archive(
                archive_path(root, "fundingRate", symbol, "2025-06"),
                "2025-06",
            )
            contract = read_kline_archive(
                archive_path(root, "klines_1h", symbol, "2025-06"),
                "2025-06",
            )
            mark = read_kline_archive(
                archive_path(root, "markPriceKlines_1h", symbol, "2025-06"),
                "2025-06",
            )
            require_complete_month(contract, "2025-06")
            require_complete_month(mark, "2025-06")
            if not funding:
                raise EvidenceError("FUNDING_ROWS_EMPTY", symbol)
        except EvidenceError as exc:
            attempts.append(
                {
                    "archive_member_open_count": _screen_open_delta(before, symbol),
                    "reason_code": exc.code,
                    "status": "INVALID_EVIDENCE",
                    "symbol": symbol,
                }
            )
            continue
        delta = _screen_open_delta(before, symbol)
        if delta != len(SOURCE_KINDS):
            raise ContractError("SCREEN_SUCCESS_MEMBER_OPEN_COUNT_INVALID", symbol)
        attempts.append(
            {
                "archive_member_open_count": delta,
                "june_evidence": {
                    kind: {
                        "sidecar_sha256": records[kind]["sidecar_sha256"],
                        "zip_sha256": records[kind]["zip_sha256"],
                    }
                    for kind in SOURCE_KINDS
                },
                "reason_code": None,
                "screen_quote_volume": decimal_string(
                    sum((row.quote_volume for row in contract), Decimal(0))
                ),
                "status": "SUCCESS",
                "symbol": symbol,
            }
        )
    return attempts


def rank_successful_screen_attempts(
    attempts: Sequence[Mapping[str, Any]],
) -> list[dict[str, Any]]:
    ranked = [
        {
            "june_evidence": attempt["june_evidence"],
            "screen_quote_volume": attempt["screen_quote_volume"],
            "symbol": attempt["symbol"],
        }
        for attempt in attempts
        if attempt.get("status") == "SUCCESS"
    ]
    ranked.sort(
        key=lambda item: (
            -Decimal(str(item["screen_quote_volume"])),
            str(item["symbol"]),
        )
    )
    return ranked


def preseal() -> dict[str, Any]:
    validate_static_contracts()
    value = {
        "allowed_screen_count": 1,
        "bound_files": bound_files(STATIC_FILES),
        "canonical_base": BASE_COMMIT,
        "created_at": utc_now(),
        "policy": "CREATED_BEFORE_ANY_SCREEN_MEMBER_OPEN",
        "schema": f"{SCHEMA_PREFIX}.preseal.v1",
    }
    write_once_json(HERE / "preseal.v1.json", value)
    return value


def screen(source_root: Path) -> dict[str, Any]:
    root = source_root_guard(source_root)
    pre = load_canonical_json(HERE / "preseal.v1.json", f"{SCHEMA_PREFIX}.preseal.v1")
    if pre.get("bound_files") != bound_files(STATIC_FILES):
        raise ContractError("PRESEAL_BINDING_DRIFT")
    marker = {
        "allowed_screen_count": 1,
        "created_at": utc_now(),
        "marker_created_before_first_member": True,
        "marker_created_before_screen_open": True,
        "preseal_file_sha256": sha256_file(HERE / "preseal.v1.json"),
        "protocol_file_sha256": sha256_file(HERE / "protocol.v1.json"),
        "schema": f"{SCHEMA_PREFIX}.screen_consumed.v1",
        "screen_archive_member_open_count_before": 0,
        "screen_ordinal": 1,
    }
    write_once_json(HERE / "screen_consumed.v1.json", marker)
    write_once_json(root / "screen_consumed.v1.json", marker)
    set_member_open_stage("screen")
    attempts = evaluate_screen_attempts(root, candidate_symbols(root))
    if MEMBER_OPEN_COUNTS["screen"] != sum(
        int(attempt["archive_member_open_count"]) for attempt in attempts
    ):
        raise ContractError("SCREEN_MEMBER_OPEN_COUNT_RECONCILIATION_INVALID")
    ranked = rank_successful_screen_attempts(attempts)
    selected = ranked[:30]
    status = "FROZEN" if len(selected) == 30 else "INVALID_EVIDENCE"
    universe = {
        "candidate_count": len(ranked),
        "created_at": utc_now(),
        "preseal_file_sha256": sha256_file(HERE / "preseal.v1.json"),
        "schema": f"{SCHEMA_PREFIX}.universe.v1",
        "screen_archive_member_open_count": MEMBER_OPEN_COUNTS["screen"],
        "screen_attempt_count": len(attempts),
        "screen_attempts": attempts,
        "screen_consumed_file_sha256": sha256_file(HERE / "screen_consumed.v1.json"),
        "screen_month": "2025-06",
        "screen_rows": selected,
        "selected_count": len(selected),
        "selected_symbols": [item["symbol"] for item in selected],
        "status": status,
    }
    write_once_json(HERE / "universe.v1.json", universe)
    return universe


def freeze(source_root: Path) -> dict[str, Any]:
    root = source_root_guard(source_root)
    universe = load_canonical_json(HERE / "universe.v1.json", f"{SCHEMA_PREFIX}.universe.v1")
    symbols_value = universe.get("selected_symbols")
    if not isinstance(symbols_value, list):
        raise ContractError("UNIVERSE_INVALID")
    symbols = tuple(cast(str, item) for item in symbols_value)
    entries = [
        source_record(root, kind, symbol, month)
        for symbol in symbols
        for month in ALL_MONTHS
        for kind in SOURCE_KINDS
    ]
    screen_rows = universe.get("screen_rows")
    if not isinstance(screen_rows, list):
        raise ContractError("UNIVERSE_SCREEN_ROWS_INVALID")
    june_evidence: dict[tuple[str, str], Mapping[str, Any]] = {}
    for row in screen_rows:
        if not isinstance(row, dict) or not isinstance(row.get("june_evidence"), dict):
            raise ContractError("UNIVERSE_JUNE_EVIDENCE_INVALID")
        symbol = str(row.get("symbol"))
        raw_evidence = cast(Mapping[str, Any], row["june_evidence"])
        for kind in SOURCE_KINDS:
            evidence = raw_evidence.get(kind)
            if not isinstance(evidence, dict):
                raise ContractError("UNIVERSE_JUNE_EVIDENCE_INVALID", f"{symbol}:{kind}")
            june_evidence[(symbol, kind)] = evidence
    for entry in entries:
        if entry["month"] != "2025-06":
            continue
        evidence = june_evidence.get((str(entry["symbol"]), str(entry["kind"])))
        if (
            evidence is None
            or entry["availability"] != "AVAILABLE"
            or entry["zip_sha256"] != evidence.get("zip_sha256")
            or entry["sidecar_sha256"] != evidence.get("sidecar_sha256")
        ):
            raise EvidenceError(
                "SCREEN_EVIDENCE_DRIFT",
                f"{entry['symbol']}:{entry['kind']}",
            )
    complete = (
        universe.get("status") == "FROZEN"
        and len(symbols) == 30
        and len(entries) == 1170
        and all(entry["availability"] == "AVAILABLE" for entry in entries)
    )
    manifest = {
        "created_at": utc_now(),
        "development_archive_member_open_count": 0,
        "entries": entries,
        "entry_count": len(entries),
        "holdout_archive_member_open_count": 0,
        "schema": f"{SCHEMA_PREFIX}.source_manifest.v1",
        "selected_source_root_holdout_outcome_rows_opened_before_gates": 0,
        "status": "COMPLETE" if complete else "INVALID_EVIDENCE",
        "universe_file_sha256": sha256_file(HERE / "universe.v1.json"),
    }
    write_once_json(HERE / "source_manifest.v1.json", manifest)
    frozen = {
        "allowed_run_count": 1,
        "bound_files": bound_files(FREEZE_BINDINGS),
        "canonical_base": BASE_COMMIT,
        "created_at": utc_now(),
        "development_archive_member_open_count": 0,
        "holdout_archive_member_open_count": 0,
        "preseal_file_sha256": sha256_file(HERE / "preseal.v1.json"),
        "schema": f"{SCHEMA_PREFIX}.freeze.v1",
        "screen_consumed_file_sha256": sha256_file(HERE / "screen_consumed.v1.json"),
        "source_manifest_file_sha256": sha256_file(HERE / "source_manifest.v1.json"),
        "trial_ledger_file_sha256": sha256_file(HERE / "trial_ledger.v1.json"),
        "universe_file_sha256": sha256_file(HERE / "universe.v1.json"),
    }
    write_once_json(HERE / "freeze.v1.json", frozen)
    return frozen


def verify_freeze() -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    universe = load_canonical_json(HERE / "universe.v1.json", f"{SCHEMA_PREFIX}.universe.v1")
    manifest = load_canonical_json(
        HERE / "source_manifest.v1.json", f"{SCHEMA_PREFIX}.source_manifest.v1"
    )
    frozen = load_canonical_json(HERE / "freeze.v1.json", f"{SCHEMA_PREFIX}.freeze.v1")
    links = (
        ("preseal_file_sha256", "preseal.v1.json"),
        ("screen_consumed_file_sha256", "screen_consumed.v1.json"),
        ("universe_file_sha256", "universe.v1.json"),
        ("source_manifest_file_sha256", "source_manifest.v1.json"),
        ("trial_ledger_file_sha256", "trial_ledger.v1.json"),
    )
    for field, name in links:
        if frozen.get(field) != sha256_file(HERE / name):
            raise ContractError("FREEZE_LINK_INVALID", field)
    if frozen.get("bound_files") != bound_files(FREEZE_BINDINGS):
        raise ContractError("FREEZE_BINDING_DRIFT")
    return universe, manifest, frozen


def manifest_index(
    manifest: Mapping[str, Any],
) -> dict[tuple[str, str, str], Mapping[str, Any]]:
    raw = manifest.get("entries")
    if not isinstance(raw, list):
        raise ContractError("MANIFEST_ENTRIES_INVALID")
    index: dict[tuple[str, str, str], Mapping[str, Any]] = {}
    for value in raw:
        if not isinstance(value, dict):
            raise ContractError("MANIFEST_ENTRY_INVALID")
        key = (str(value.get("symbol")), str(value.get("month")), str(value.get("kind")))
        if key in index:
            raise ContractError("MANIFEST_DUPLICATE_ENTRY")
        index[key] = value
    return index


def verify_source_cell(
    root: Path,
    index: Mapping[tuple[str, str, str], Mapping[str, Any]],
    symbol: str,
    month: str,
    kind: str,
) -> Path:
    entry = index.get((symbol, month, kind))
    if entry is None or entry.get("availability") != "AVAILABLE":
        raise EvidenceError("SELECTED_SOURCE_UNAVAILABLE", f"{symbol}:{month}:{kind}")
    path = archive_path(root, kind, symbol, month)
    sidecar = path.with_name(path.name + ".CHECKSUM")
    detail = f"{symbol}:{month}:{kind}"
    try:
        if path.is_symlink() or sidecar.is_symlink() or not path.is_file() or not sidecar.is_file():
            raise EvidenceError("SELECTED_SOURCE_UNAVAILABLE", detail)
        sidecar_raw = sidecar.read_bytes()
        if (
            sha256_file(path) != entry.get("zip_sha256")
            or sha256_bytes(sidecar_raw) != entry.get("sidecar_sha256")
            or parse_checksum(sidecar_raw, path.name) != entry.get("sidecar_expected_zip_sha256")
        ):
            raise EvidenceError("SELECTED_SOURCE_DRIFT", detail)
    except EvidenceError:
        raise
    except (ContractError, OSError) as exc:
        raise EvidenceError("SELECTED_SOURCE_READ_FAILED", detail) from exc
    return path


def merge_funding(chunks: Iterable[Sequence[FundingRow]]) -> tuple[FundingRow, ...]:
    rows = sorted(itertools.chain.from_iterable(chunks), key=lambda row: row.time_ms)
    for left, right in itertools.pairwise(rows):
        maximum_gap = Decimal("1.5") * Decimal(
            max(left.interval_hours, right.interval_hours)
        ) * Decimal(HOUR_MS) + Decimal(1000)
        if right.time_ms <= left.time_ms or Decimal(right.time_ms - left.time_ms) > maximum_gap:
            raise EvidenceError("FUNDING_CROSS_MONTH_CHRONOLOGY_INVALID")
    return tuple(rows)


def merge_bars(chunks: Iterable[Sequence[Bar]]) -> dict[int, Bar]:
    merged: dict[int, Bar] = {}
    for row in itertools.chain.from_iterable(chunks):
        if row.open_time_ms in merged:
            raise EvidenceError("KLINE_CROSS_MONTH_DUPLICATE")
        merged[row.open_time_ms] = row
    return merged


def load_market(
    root: Path,
    manifest: Mapping[str, Any],
    symbols: Sequence[str],
    months: Sequence[str],
) -> MarketData:
    index = manifest_index(manifest)
    funding: dict[str, tuple[FundingRow, ...]] = {}
    mark: dict[str, dict[int, Bar]] = {}
    contract: dict[str, dict[int, Bar]] = {}
    for symbol in symbols:
        funding_chunks: list[tuple[FundingRow, ...]] = []
        mark_chunks: list[tuple[Bar, ...]] = []
        contract_chunks: list[tuple[Bar, ...]] = []
        for month in months:
            funding_chunks.append(
                read_funding_archive(
                    verify_source_cell(root, index, symbol, month, "fundingRate"),
                    month,
                )
            )
            contract_month = read_kline_archive(
                verify_source_cell(root, index, symbol, month, "klines_1h"),
                month,
            )
            mark_month = read_kline_archive(
                verify_source_cell(root, index, symbol, month, "markPriceKlines_1h"),
                month,
            )
            require_complete_month(contract_month, month)
            require_complete_month(mark_month, month)
            contract_chunks.append(contract_month)
            mark_chunks.append(mark_month)
        funding[symbol] = merge_funding(funding_chunks)
        contract[symbol] = merge_bars(contract_chunks)
        mark[symbol] = merge_bars(mark_chunks)
    return MarketData(funding=funding, mark=mark, contract=contract)


def _latest_index(rows: Sequence[FundingRow], before_ms: int) -> int:
    return bisect.bisect_left([row.time_ms for row in rows], before_ms) - 1


def changed_decision_epoch(funding: Mapping[str, Sequence[FundingRow]], time_ms: int) -> bool:
    """Return true only when a latest strictly-eligible row changed this hour."""

    previous_hour = time_ms - HOUR_MS
    for rows in funding.values():
        current = _latest_index(rows, time_ms)
        previous = _latest_index(rows, previous_hour)
        if current >= 0 and current != previous:
            return True
    return False


def build_snapshots(
    market: MarketData,
    symbols: Sequence[str],
    start_ms: int,
    end_ms: int,
) -> tuple[Snapshot, ...]:
    """Build distinct causal cross-sectional funding observations."""

    snapshots: list[Snapshot] = []
    for time_ms in range(start_ms, end_ms, HOUR_MS):
        if not changed_decision_epoch(market.funding, time_ms):
            continue
        latest_rows: dict[str, FundingRow] = {}
        prior_rows: dict[str, FundingRow] = {}
        any_missing_prior = False
        for symbol in symbols:
            rows = market.funding[symbol]
            index = _latest_index(rows, time_ms)
            if index < 0:
                raise EvidenceError("LATEST_FUNDING_ROW_MISSING", f"{symbol}:{time_ms}")
            freshness_limit = Decimal("1.5") * Decimal(rows[index].interval_hours) * Decimal(
                HOUR_MS
            ) + Decimal(1000)
            if Decimal(time_ms - rows[index].time_ms) > freshness_limit:
                raise EvidenceError("LATEST_FUNDING_ROW_STALE", f"{symbol}:{time_ms}")
            latest_rows[symbol] = rows[index]
            if index > 0:
                prior_rows[symbol] = rows[index - 1]
            else:
                any_missing_prior = True
        normalized = [row.normalized_rate for row in latest_rows.values()]
        center = median_decimal(normalized)
        dispersion = median_decimal([abs(value - center) for value in normalized])
        baseline = (
            median_decimal([item.dispersion for item in snapshots[-28:]])
            if len(snapshots) >= 28
            else None
        )
        innovations: list[Innovation] = []
        if not any_missing_prior:
            for symbol in symbols:
                latest = latest_rows[symbol]
                prior = prior_rows[symbol]
                gap_limit = Decimal("1.5") * Decimal(
                    max(latest.interval_hours, prior.interval_hours)
                ) * Decimal(HOUR_MS) + Decimal(1000)
                if (
                    latest.interval_hours != prior.interval_hours
                    or latest.rate == 0
                    or prior.rate == 0
                    or (latest.rate > 0) != (prior.rate > 0)
                    or Decimal(latest.time_ms - prior.time_ms) > gap_limit
                ):
                    continue
                innovations.append(
                    Innovation(
                        symbol,
                        latest.normalized_rate - prior.normalized_rate,
                        prior.normalized_rate,
                        latest.normalized_rate,
                    )
                )
        snapshots.append(
            Snapshot(
                time_ms=time_ms,
                dispersion=dispersion,
                baseline=baseline,
                innovations=tuple(sorted(innovations, key=lambda item: item.symbol)),
            )
        )
    return tuple(snapshots)


def transition_passes(
    snapshots: Sequence[Snapshot],
    index: int,
    trial: Trial,
) -> bool:
    current = snapshots[index]
    if current.baseline is None or current.baseline <= 0 or index == 0:
        return False
    if current.dispersion / current.baseline < trial.expansion_ratio:
        return False
    if snapshots[index - 1].dispersion > current.baseline:
        return False
    compression_start = index - trial.compression_observations
    if compression_start < 0:
        return False
    for snapshot in snapshots[compression_start:index]:
        if snapshot.baseline is None or snapshot.dispersion > snapshot.baseline:
            return False
    return True


def innovation_tails(
    innovations: Sequence[Innovation],
) -> tuple[tuple[Innovation, ...], tuple[Innovation, ...]] | None:
    positive = sorted(
        (item for item in innovations if item.delta > 0),
        key=lambda item: (-item.delta, item.symbol),
    )[:3]
    negative = sorted(
        (item for item in innovations if item.delta < 0),
        key=lambda item: (item.delta, item.symbol),
    )[:3]
    if len(positive) != 3 or len(negative) != 3:
        return None
    return tuple(positive), tuple(negative)


def exact_matching(
    longs: Sequence[Innovation], shorts: Sequence[Innovation]
) -> tuple[tuple[str, str], ...]:
    """Choose the globally minimum prior-rate-gap perfect matching."""

    if len(longs) != 3 or len(shorts) != 3:
        raise ValueError("exact matching requires three symbols per side")
    candidates: list[tuple[Decimal, tuple[tuple[str, str], ...]]] = []
    for permutation in itertools.permutations(shorts):
        pairs = tuple(
            sorted(
                (
                    (long.symbol, short.symbol)
                    for long, short in zip(longs, permutation, strict=True)
                ),
                key=lambda pair: pair,
            )
        )
        short_by_symbol = {item.symbol: item for item in shorts}
        long_by_symbol = {item.symbol: item for item in longs}
        gap = sum(
            (
                abs(
                    long_by_symbol[long_symbol].prior_rate
                    - short_by_symbol[short_symbol].prior_rate
                )
                for long_symbol, short_symbol in pairs
            ),
            Decimal(0),
        )
        candidates.append((gap, pairs))
    return min(candidates, key=lambda value: (value[0], value[1]))[1]


def causal_capacity_input(
    contract: Mapping[int, Bar],
    entry_ms: int,
) -> Decimal:
    trailing_hours = tuple(range(entry_ms - 24 * HOUR_MS, entry_ms, HOUR_MS))
    trailing_rows = [contract.get(time_ms) for time_ms in trailing_hours]
    if any(row is None or row.close_time_ms >= entry_ms for row in trailing_rows):
        raise EvidenceError("TRAILING_24H_CAPACITY_INCOMPLETE", iso_ms(entry_ms))
    trailing = sum((cast(Bar, row).quote_volume for row in trailing_rows), Decimal(0))
    current_day = day_start_ms(entry_ms)
    complete_days: list[Decimal] = []
    for offset in range(7, 0, -1):
        day = current_day - offset * DAY_MS
        rows = [contract.get(day + hour * HOUR_MS) for hour in range(24)]
        if any(row is None or row.close_time_ms >= current_day for row in rows):
            raise EvidenceError("PRIOR_UTC_DAY_CAPACITY_INCOMPLETE", iso_ms(day))
        complete_days.append(sum((cast(Bar, row).quote_volume for row in rows), Decimal(0)))
    return min(trailing, median_decimal(complete_days))


def scenario_cost(
    entry_notional: Decimal,
    exit_notional: Decimal,
    scenario: str,
) -> Decimal:
    fee, adverse = COSTS[scenario]
    return (entry_notional + exit_notional) * (fee + adverse) / Decimal(10_000)


def funding_cashflow(
    market: MarketData,
    symbol: str,
    side: int,
    quantity: Decimal,
    entry_ms: int,
    exit_ms: int,
) -> Decimal:
    total = Decimal(0)
    for funding in market.funding[symbol]:
        if not entry_ms < funding.time_ms < exit_ms:
            continue
        hour = funding.time_ms - funding.time_ms % HOUR_MS
        mark = market.mark[symbol].get(hour)
        if (
            mark is None
            or not mark.open_time_ms <= funding.time_ms <= mark.close_time_ms
            or mark.open_price <= 0
        ):
            raise EvidenceError("FUNDING_MARK_PROXY_MISSING", f"{symbol}:{funding.time_ms}")
        total += -Decimal(side) * quantity * mark.open_price * funding.rate
    return total


def build_position(
    market: MarketData,
    symbol: str,
    side: int,
    entry_ms: int,
    exit_ms: int,
) -> Position:
    entry = market.mark[symbol].get(entry_ms)
    exit_bar = market.mark[symbol].get(exit_ms)
    if entry is None or exit_bar is None:
        raise EvidenceError("SELECTED_ENTRY_EXIT_MISSING", f"{symbol}:{entry_ms}:{exit_ms}")
    quantity = MEMBER_NOTIONAL / entry.open_price
    exit_notional = quantity * exit_bar.open_price
    price_pnl = Decimal(side) * quantity * (exit_bar.open_price - entry.open_price)
    funding_pnl = funding_cashflow(market, symbol, side, quantity, entry_ms, exit_ms)
    gross = price_pnl + funding_pnl
    costs = {
        scenario: scenario_cost(MEMBER_NOTIONAL, exit_notional, scenario) for scenario in COSTS
    }
    net = {scenario: gross - cost for scenario, cost in costs.items()}
    capacity = causal_capacity_input(market.contract[symbol], entry_ms) * BASE_PARTICIPATION
    return Position(
        symbol=symbol,
        side=side,
        quantity=quantity,
        entry_notional=MEMBER_NOTIONAL,
        exit_notional=exit_notional,
        price_pnl=price_pnl,
        funding_pnl=funding_pnl,
        net=net,
        costs=costs,
        capacity_proxy_usd=capacity,
    )


def severe_marked_path(
    market: MarketData,
    positions: Sequence[Position],
    entry_ms: int,
    exit_ms: int,
) -> tuple[tuple[int, Decimal], ...]:
    """Return cohort PnL marked hourly with severe exit costs reserved."""

    result: list[tuple[int, Decimal]] = []
    severe_rate = sum(COSTS["severe"], Decimal(0)) / Decimal(10_000)
    for time_ms in range(entry_ms, exit_ms + HOUR_MS, HOUR_MS):
        cohort_value = Decimal(0)
        for position in positions:
            mark = market.mark[position.symbol].get(time_ms)
            entry = market.mark[position.symbol][entry_ms]
            if mark is None:
                raise EvidenceError("OPEN_POSITION_MARK_MISSING", f"{position.symbol}:{time_ms}")
            marked_price = (
                Decimal(position.side) * position.quantity * (mark.open_price - entry.open_price)
            )
            accrued = funding_cashflow(
                market,
                position.symbol,
                position.side,
                position.quantity,
                entry_ms,
                min(time_ms + 1, exit_ms),
            )
            entry_cost = position.entry_notional * severe_rate
            reserved_exit = position.quantity * mark.open_price * severe_rate
            cohort_value += marked_price + accrued - entry_cost - reserved_exit
        result.append((time_ms, cohort_value))
    return tuple(result)


def build_cohort(
    market: MarketData,
    snapshot: Snapshot,
    trial: Trial,
    pairs: tuple[tuple[str, str], ...],
) -> Cohort:
    entry_ms = snapshot.time_ms
    exit_ms = entry_ms + trial.hold_hours * HOUR_MS
    positions = tuple(
        [
            build_position(market, long_symbol, 1, entry_ms, exit_ms)
            for long_symbol, _short_symbol in pairs
        ]
        + [
            build_position(market, short_symbol, -1, entry_ms, exit_ms)
            for _long_symbol, short_symbol in pairs
        ]
    )
    if len({position.symbol for position in positions}) != 6:
        raise EvidenceError("COHORT_MEMBERS_NOT_DISTINCT")
    net = {
        scenario: sum((position.net[scenario] for position in positions), Decimal(0))
        for scenario in COSTS
    }
    strategy_capacity = min(
        (position.capacity_proxy_usd * Decimal(6) for position in positions),
        default=Decimal(0),
    )
    return Cohort(
        decision_ms=snapshot.time_ms,
        entry_ms=entry_ms,
        exit_ms=exit_ms,
        pairs=pairs,
        positions=positions,
        net=net,
        severe_marked_path=severe_marked_path(market, positions, entry_ms, exit_ms),
        capacity_proxy_usd=strategy_capacity,
    )


def evaluate_trial(
    market: MarketData,
    snapshots: Sequence[Snapshot],
    trial: Trial,
    score_start_ms: int,
    score_end_ms: int,
) -> TrialResult:
    cohorts: list[Cohort] = []
    valid_cash = 0
    skipped_active = 0
    decision_epochs = 0
    unavailable_until = -1
    for index, snapshot in enumerate(snapshots):
        if not score_start_ms <= snapshot.time_ms < score_end_ms:
            continue
        decision_epochs += 1
        if not transition_passes(snapshots, index, trial):
            valid_cash += 1
            continue
        tails = innovation_tails(snapshot.innovations)
        if tails is None:
            valid_cash += 1
            continue
        candidate_exit_ms = snapshot.time_ms + trial.hold_hours * HOUR_MS
        if candidate_exit_ms >= score_end_ms:
            # The score end is exclusive, so an exit at or beyond it crosses
            # the partition/source boundary. It is valid cash, not missing
            # exit evidence and not a reason to consume the run as UNMEASURED.
            valid_cash += 1
            continue
        if snapshot.time_ms <= unavailable_until:
            skipped_active += 1
            continue
        longs, shorts = tails
        pairs = exact_matching(longs, shorts)
        cohort = build_cohort(market, snapshot, trial, pairs)
        cohorts.append(cohort)
        unavailable_until = cohort.exit_ms
    return TrialResult(
        trial=trial,
        cohorts=tuple(cohorts),
        valid_cash_epochs=valid_cash,
        skipped_active_epochs=skipped_active,
        valid_decision_epochs=decision_epochs,
    )


def calendar_days(start_ms: int, end_ms: int) -> tuple[int, ...]:
    return tuple(range(day_start_ms(start_ms), day_start_ms(end_ms), DAY_MS))


def daily_vector(result: TrialResult, days: Sequence[int], scenario: str) -> tuple[Decimal, ...]:
    by_day: dict[int, Decimal] = defaultdict(Decimal)
    for cohort in result.cohorts:
        by_day[day_start_ms(cohort.exit_ms)] += cohort.net[scenario]
    return tuple(by_day.get(day, Decimal(0)) for day in days)


def bootstrap_paths(
    length: int,
    replicates: int = BOOTSTRAP_REPLICATES,
    seed: int = BOOTSTRAP_SEED,
    block_days: int = 7,
) -> tuple[tuple[int, ...], ...]:
    if length <= 0 or block_days <= 0 or replicates <= 0:
        raise ValueError("positive bootstrap dimensions required")
    generator = random.Random(seed)
    paths: list[tuple[int, ...]] = []
    for _ in range(replicates):
        indices: list[int] = []
        while len(indices) < length:
            start = generator.randrange(length)
            indices.extend((start + offset) % length for offset in range(block_days))
        paths.append(tuple(indices[:length]))
    return tuple(paths)


def empirical_quantile(values: Sequence[Decimal], probability: Decimal) -> Decimal:
    if not values or not Decimal(0) <= probability <= Decimal(1):
        raise ValueError("quantile input invalid")
    ordered = sorted(values)
    if probability == 0:
        return ordered[0]
    # Frozen 1-based nearest rank: ceil(p * B), translated to a zero-based
    # Python index. p=1-0.05/12 and B=4096 therefore selects rank 4079.
    index = math.ceil(probability * Decimal(len(ordered))) - 1
    return ordered[index]


def bootstrap_trial_statistics(
    vectors: Mapping[str, Mapping[str, Sequence[Decimal]]],
    paths: Sequence[Sequence[int]],
) -> tuple[
    dict[str, dict[str, dict[str, Decimal]]],
    dict[str, Decimal],
]:
    """Compute paired block intervals, p-values, Bonferroni LCBs, and White."""

    if not vectors:
        raise ValueError("vectors required")
    length = len(next(iter(next(iter(vectors.values())).values())))
    scenarios = ("base", "stress", "severe")
    observed: dict[str, dict[str, Decimal]] = {
        trial_id: {scenario: sum(data[scenario], Decimal(0)) for scenario in scenarios}
        for trial_id, data in vectors.items()
    }
    boot: dict[str, dict[str, list[Decimal]]] = {
        trial_id: {scenario: [] for scenario in scenarios} for trial_id in vectors
    }
    centered: dict[str, dict[str, tuple[Decimal, ...]]] = {}
    for trial_id, data in vectors.items():
        centered[trial_id] = {}
        for scenario in scenarios:
            mean = observed[trial_id][scenario] / Decimal(length)
            centered[trial_id][scenario] = tuple(value - mean for value in data[scenario])
    centered_maxima: dict[str, list[Decimal]] = {"base": [], "stress": []}
    for path in paths:
        for trial_id, data in vectors.items():
            for scenario in scenarios:
                boot[trial_id][scenario].append(
                    sum((data[scenario][index] for index in path), Decimal(0))
                )
        for scenario in ("base", "stress"):
            centered_maxima[scenario].append(
                max(
                    sum(
                        (centered[trial_id][scenario][index] for index in path),
                        Decimal(0),
                    )
                    for trial_id in sorted(vectors)
                )
            )
    statistics_by_trial: dict[str, dict[str, dict[str, Decimal]]] = {}
    for trial_id in sorted(vectors):
        statistics_by_trial[trial_id] = {}
        for scenario in scenarios:
            values = boot[trial_id][scenario]
            center_values = [
                sum(
                    (centered[trial_id][scenario][index] for index in path),
                    Decimal(0),
                )
                for path in paths
            ]
            observed_total = observed[trial_id][scenario]
            point_lower = Decimal(2) * observed_total - empirical_quantile(values, Decimal("0.975"))
            point_upper = Decimal(2) * observed_total - empirical_quantile(values, Decimal("0.025"))
            family_lower = Decimal(2) * observed_total - empirical_quantile(
                values, Decimal(1) - ALPHA / Decimal(12)
            )
            p_value = Decimal(
                sum(value >= observed_total for value in center_values) + 1
            ) / Decimal(len(paths) + 1)
            statistics_by_trial[trial_id][scenario] = {
                "bonferroni_lcb": family_lower,
                "interval_lower": point_lower,
                "interval_upper": point_upper,
                "observed": observed_total,
                "p_value": p_value,
            }
    white: dict[str, Decimal] = {}
    for scenario in ("base", "stress"):
        best = max(observed[trial_id][scenario] for trial_id in vectors)
        white[scenario] = Decimal(
            sum(value >= best for value in centered_maxima[scenario]) + 1
        ) / Decimal(len(paths) + 1)
    return statistics_by_trial, white


def holm_adjust(raw: Mapping[str, Decimal]) -> dict[str, Decimal]:
    ordered = sorted(raw.items(), key=lambda item: (item[1], item[0]))
    adjusted: dict[str, Decimal] = {}
    running = Decimal(0)
    total = len(ordered)
    for index, (trial_id, value) in enumerate(ordered):
        running = max(running, min(Decimal(1), value * Decimal(total - index)))
        adjusted[trial_id] = running
    return adjusted


def _cscv_block_scores(
    results: Sequence[TrialResult],
    days: Sequence[int],
) -> dict[str, tuple[Decimal, ...]]:
    if len(results) != 12 or len(days) < 264:
        raise ValueError("CSCV requires 12 trials and at least 264 days")
    first_days = tuple(days[:264])
    block_scores: dict[str, tuple[Decimal, ...]] = {}
    for result in results:
        scores: list[Decimal] = []
        for block in range(12):
            block_start = first_days[block * 22]
            score_end = first_days[block * 22 + 20]
            score = sum(
                (
                    cohort.net["stress"]
                    for cohort in result.cohorts
                    if cohort.entry_ms >= block_start and cohort.exit_ms < score_end
                ),
                Decimal(0),
            )
            scores.append(score / Decimal(20))
        block_scores[result.trial.trial_id] = tuple(scores)
    return block_scores


def cscv_pbo(
    results: Sequence[TrialResult],
    days: Sequence[int],
) -> dict[str, Any]:
    """CSCV on 12x22-day blocks, with the final two days purged."""

    block_scores = _cscv_block_scores(results, days)
    failures = 0
    splits = 0
    trial_ids = tuple(sorted(block_scores))
    all_blocks = set(range(12))
    for train_blocks in itertools.combinations(range(12), 6):
        train = set(train_blocks)
        test = all_blocks - train
        in_sample = {
            trial_id: sum((block_scores[trial_id][index] for index in train), Decimal(0))
            for trial_id in trial_ids
        }
        champion = min(trial_ids, key=lambda trial_id: (-in_sample[trial_id], trial_id))
        out_scores = {
            trial_id: sum((block_scores[trial_id][index] for index in test), Decimal(0))
            for trial_id in trial_ids
        }
        # Worst tie rank: every equal-score trial is ranked ahead of the
        # selected champion.  Rank seven or worse is an OOS loss.
        worst_rank = sum(score >= out_scores[champion] for score in out_scores.values())
        if worst_rank >= 7:
            failures += 1
        splits += 1
    return {
        "authority": "DIAGNOSTIC_ONLY",
        "pbo": decimal_string(Decimal(failures) / Decimal(splits)),
        "purged_days_per_block": 2,
        "score_days_per_block": 20,
        "splits": splits,
    }


def severe_max_drawdown(result: TrialResult) -> Decimal:
    realized = Decimal(0)
    peak = CAPITAL
    maximum_dollar_drawdown = Decimal(0)
    for cohort in result.cohorts:
        for _time_ms, open_pnl in cohort.severe_marked_path:
            equity = CAPITAL + realized + open_pnl
            peak = max(peak, equity)
            maximum_dollar_drawdown = max(maximum_dollar_drawdown, peak - equity)
        realized += cohort.net["severe"]
        peak = max(peak, CAPITAL + realized)
    return maximum_dollar_drawdown / CAPITAL


def active_weeks(result: TrialResult) -> int:
    return len(
        {
            datetime.fromtimestamp(cohort.entry_ms / 1000, UTC).isocalendar()[:2]
            for cohort in result.cohorts
        }
    )


def distinct_symbols(result: TrialResult) -> set[str]:
    return {position.symbol for cohort in result.cohorts for position in cohort.positions}


def robustness_targets(result: TrialResult) -> tuple[str | None, str | None]:
    by_symbol: dict[str, Decimal] = defaultdict(Decimal)
    for cohort in result.cohorts:
        for position in cohort.positions:
            by_symbol[position.symbol] += position.net["stress"]
    best_symbol = (
        min(
            by_symbol,
            key=lambda symbol: (-by_symbol[symbol], symbol),
        )
        if by_symbol
        else None
    )
    by_month: dict[str, Decimal] = defaultdict(Decimal)
    for cohort in result.cohorts:
        month = datetime.fromtimestamp(cohort.entry_ms / 1000, UTC).strftime("%Y-%m")
        by_month[month] += cohort.net["stress"]
    best_month = (
        min(
            by_month,
            key=lambda month: (-by_month[month], month),
        )
        if by_month
        else None
    )
    return best_symbol, best_month


def robustness(result: TrialResult) -> tuple[Decimal, Decimal]:
    total = sum((cohort.net["stress"] for cohort in result.cohorts), Decimal(0))
    best_symbol, best_month = robustness_targets(result)
    if best_symbol is not None:
        without_symbol = sum(
            (
                cohort.net["stress"]
                for cohort in result.cohorts
                if all(position.symbol != best_symbol for position in cohort.positions)
            ),
            Decimal(0),
        )
    else:
        without_symbol = total
    if best_month is not None:
        without_month = sum(
            (
                cohort.net["stress"]
                for cohort in result.cohorts
                if datetime.fromtimestamp(cohort.entry_ms / 1000, UTC).strftime("%Y-%m")
                != best_month
            ),
            Decimal(0),
        )
    else:
        without_month = total
    return without_symbol, without_month


def trial_summary(
    result: TrialResult,
    statistics_by_scenario: Mapping[str, Mapping[str, Decimal]],
    holm_p: Decimal,
) -> dict[str, Any]:
    without_symbol, without_month = robustness(result)
    capacities = sorted(cohort.capacity_proxy_usd for cohort in result.cohorts)
    capacity_min = capacities[0] if capacities else Decimal(0)
    capacity_p05 = (
        capacities[max(0, math.ceil(len(capacities) * 0.05) - 1)] if capacities else Decimal(0)
    )
    return {
        "active_cohorts": len(result.cohorts),
        "active_weeks": active_weeks(result),
        "base_bonferroni_lcb": decimal_string(statistics_by_scenario["base"]["bonferroni_lcb"]),
        "base_net_usd_per_1000": decimal_string(statistics_by_scenario["base"]["observed"]),
        "base_p_value": decimal_string(statistics_by_scenario["base"]["p_value"]),
        "bootstrap_interval_usd_per_1000": {
            scenario: [
                decimal_string(values["interval_lower"]),
                decimal_string(values["interval_upper"]),
            ]
            for scenario, values in statistics_by_scenario.items()
        },
        "distinct_traded_symbols": len(distinct_symbols(result)),
        "holm_adjusted_p": decimal_string(holm_p),
        "public_capacity_proxy_usd": {
            "minimum": decimal_string(capacity_min),
            "p05": decimal_string(capacity_p05),
        },
        "remove_best_month_stress_net_usd_per_1000": decimal_string(without_month),
        "remove_best_symbol_stress_net_usd_per_1000": decimal_string(without_symbol),
        "severe_hourly_marked_equity_max_drawdown": decimal_string(severe_max_drawdown(result)),
        "severe_net_usd_per_1000": decimal_string(statistics_by_scenario["severe"]["observed"]),
        "skipped_active_epochs": result.skipped_active_epochs,
        "stress_bonferroni_lcb": decimal_string(statistics_by_scenario["stress"]["bonferroni_lcb"]),
        "stress_net_usd_per_1000": decimal_string(statistics_by_scenario["stress"]["observed"]),
        "stress_p_value": decimal_string(statistics_by_scenario["stress"]["p_value"]),
        "trial_id": result.trial.trial_id,
        "valid_cash_epochs": result.valid_cash_epochs,
        "valid_decision_epochs": result.valid_decision_epochs,
    }


def select_champion(
    results: Sequence[TrialResult],
    summaries: Sequence[Mapping[str, Any]],
) -> TrialResult:
    by_id = {result.trial.trial_id: result for result in results}
    winner = min(
        summaries,
        key=lambda summary: (
            -min(
                Decimal(str(summary["base_bonferroni_lcb"])),
                Decimal(str(summary["stress_bonferroni_lcb"])),
            ),
            -Decimal(str(summary["stress_net_usd_per_1000"])),
            Decimal(str(summary["severe_hourly_marked_equity_max_drawdown"])),
            str(summary["trial_id"]),
        ),
    )
    return by_id[str(winner["trial_id"])]


def development_gates(
    champion: Mapping[str, Any],
    white: Mapping[str, Decimal],
    pbo: Mapping[str, Any],
) -> dict[str, bool]:
    capacity = cast(Mapping[str, str], champion["public_capacity_proxy_usd"])
    return {
        "active_cohorts_min": int(champion["active_cohorts"]) >= 24,
        "active_weeks_min": int(champion["active_weeks"]) >= 12,
        "base_capacity_min_usd_gte": Decimal(capacity["minimum"]) >= CAPITAL,
        "base_net_usd_per_1000_gt": Decimal(str(champion["base_net_usd_per_1000"])) > 0,
        "bonferroni_base_lower_bound_gt": (Decimal(str(champion["base_bonferroni_lcb"])) > 0),
        "bonferroni_stress_lower_bound_gt": (Decimal(str(champion["stress_bonferroni_lcb"])) > 0),
        "champion_holm_p_lte": Decimal(str(champion["holm_adjusted_p"])) <= ALPHA,
        "distinct_traded_symbols_min": int(champion["distinct_traded_symbols"]) >= 12,
        "pbo_lte": Decimal(str(pbo["pbo"])) <= Decimal("0.5"),
        "remove_best_month_stress_net_usd_per_1000_gt": Decimal(
            str(champion["remove_best_month_stress_net_usd_per_1000"])
        )
        > 0,
        "remove_best_symbol_stress_net_usd_per_1000_gt": Decimal(
            str(champion["remove_best_symbol_stress_net_usd_per_1000"])
        )
        > 0,
        "severe_hourly_marked_equity_max_drawdown_lte": (
            Decimal(str(champion["severe_hourly_marked_equity_max_drawdown"])) <= Decimal("0.10")
        ),
        "stress_net_usd_per_1000_gt": (Decimal(str(champion["stress_net_usd_per_1000"])) > 0),
        "valid_causal_decision_epochs_min": int(champion["valid_decision_epochs"]) >= 60,
        "valid_complete_source_manifest": True,
        "white_reality_check_base_p_lte": white["base"] <= ALPHA,
        "white_reality_check_stress_p_lte": white["stress"] <= ALPHA,
    }


def gate_and_select_development_trials(
    results: Sequence[TrialResult],
    summaries: Sequence[Mapping[str, Any]],
    white: Mapping[str, Decimal],
    pbo: Mapping[str, Any],
) -> tuple[list[dict[str, Any]], TrialResult | None, TrialResult]:
    enriched: list[dict[str, Any]] = []
    eligible: list[Mapping[str, Any]] = []
    for summary in summaries:
        gates = development_gates(summary, white, pbo)
        row = {
            **summary,
            "development_gates": gates,
            "passes_all_development_gates": all(gates.values()),
        }
        enriched.append(row)
        if row["passes_all_development_gates"] is True:
            eligible.append(row)
    champion = select_champion(results, eligible) if eligible else None
    reported = champion if champion is not None else select_champion(results, enriched)
    return enriched, champion, reported


def development_document(
    results: Sequence[TrialResult],
    days: Sequence[int],
    frozen_commit: str,
) -> tuple[dict[str, Any], TrialResult]:
    paths = bootstrap_paths(len(days))
    vectors = {
        result.trial.trial_id: {
            scenario: daily_vector(result, days, scenario) for scenario in COSTS
        }
        for result in results
    }
    stats, white = bootstrap_trial_statistics(vectors, paths)
    raw_for_holm = {
        trial_id: max(values["base"]["p_value"], values["stress"]["p_value"])
        for trial_id, values in stats.items()
    }
    holm = holm_adjust(raw_for_holm)
    summaries = [
        trial_summary(result, stats[result.trial.trial_id], holm[result.trial.trial_id])
        for result in results
    ]
    pbo = cscv_pbo(results, days)
    summaries, champion, reported = gate_and_select_development_trials(
        results,
        summaries,
        white,
        pbo,
    )
    reported_summary = next(
        item for item in summaries if item["trial_id"] == reported.trial.trial_id
    )
    gates = cast(dict[str, bool], reported_summary["development_gates"])
    document = {
        "admitted_to_holdout": champion is not None,
        "champion_trial_id": champion.trial.trial_id if champion is not None else None,
        "created_at": utc_now(),
        "development_archive_member_open_count": MEMBER_OPEN_COUNTS["development"],
        "freeze_file_sha256": sha256_file(HERE / "freeze.v1.json"),
        "frozen_commit": frozen_commit,
        "holdout_archive_member_open_count": 0,
        "holdout_open_gates": gates,
        "outcome_state": "MEASURED",
        "pbo": pbo,
        "protocol_file_sha256": sha256_file(HERE / "protocol.v1.json"),
        "reported_trial_id": reported.trial.trial_id,
        "run_consumed_file_sha256": sha256_file(HERE / "run_consumed.v1.json"),
        "schema": f"{SCHEMA_PREFIX}.development.v1",
        "source_manifest_file_sha256": sha256_file(HERE / "source_manifest.v1.json"),
        "trial_ledger_file_sha256": sha256_file(HERE / "trial_ledger.v1.json"),
        "trials": summaries,
        "white_reality_check_p_by_scenario": {
            scenario: decimal_string(value) for scenario, value in white.items()
        },
    }
    return document, reported


def pointwise_holdout_summary(
    result: TrialResult,
    days: Sequence[int],
) -> dict[str, Any]:
    paths = bootstrap_paths(len(days))
    scenario_summary: dict[str, dict[str, Decimal]] = {}
    for scenario in COSTS:
        vector = daily_vector(result, days, scenario)
        observed = sum(vector, Decimal(0))
        boot = [sum((vector[index] for index in path), Decimal(0)) for path in paths]
        scenario_summary[scenario] = {
            "interval_lower": Decimal(2) * observed - empirical_quantile(boot, Decimal("0.975")),
            "interval_upper": Decimal(2) * observed - empirical_quantile(boot, Decimal("0.025")),
            "lcb": Decimal(2) * observed - empirical_quantile(boot, Decimal("0.95")),
            "observed": observed,
        }
    without_symbol, without_month = robustness(result)
    capacities = sorted(cohort.capacity_proxy_usd for cohort in result.cohorts)
    capacity_min = capacities[0] if capacities else Decimal(0)
    capacity_p05 = (
        capacities[max(0, math.ceil(len(capacities) * 0.05) - 1)] if capacities else Decimal(0)
    )
    return {
        "active_cohorts": len(result.cohorts),
        "active_weeks": active_weeks(result),
        "bootstrap_intervals": {
            scenario: [
                decimal_string(values["interval_lower"]),
                decimal_string(values["interval_upper"]),
            ]
            for scenario, values in scenario_summary.items()
        },
        "distinct_traded_symbols": len(distinct_symbols(result)),
        "net_usd_per_1000_by_scenario": {
            scenario: decimal_string(values["observed"])
            for scenario, values in scenario_summary.items()
        },
        "pointwise_lcb": {
            scenario: decimal_string(values["lcb"]) for scenario, values in scenario_summary.items()
        },
        "public_capacity_proxy_usd": {
            "minimum": decimal_string(capacity_min),
            "p05": decimal_string(capacity_p05),
        },
        "remove_best_month_stress_net_usd_per_1000": decimal_string(without_month),
        "remove_best_symbol_stress_net_usd_per_1000": decimal_string(without_symbol),
        "severe_hourly_marked_equity_max_drawdown": decimal_string(severe_max_drawdown(result)),
        "skipped_active_epochs": result.skipped_active_epochs,
        "valid_cash_epochs": result.valid_cash_epochs,
        "valid_decision_epochs": result.valid_decision_epochs,
    }


def holdout_gates(summary: Mapping[str, Any]) -> dict[str, bool]:
    net = cast(Mapping[str, str], summary["net_usd_per_1000_by_scenario"])
    lcb = cast(Mapping[str, str], summary["pointwise_lcb"])
    capacity = cast(Mapping[str, str], summary["public_capacity_proxy_usd"])
    return {
        "active_cohorts_min": int(summary["active_cohorts"]) >= 8,
        "active_weeks_min": int(summary["active_weeks"]) >= 6,
        "base_capacity_min_usd_gte": Decimal(capacity["minimum"]) >= CAPITAL,
        "base_net_usd_per_1000_gt": Decimal(net["base"]) > 0,
        "distinct_traded_symbols_min": int(summary["distinct_traded_symbols"]) >= 6,
        "pointwise_base_lower_bound_gt": Decimal(lcb["base"]) > 0,
        "pointwise_stress_lower_bound_gt": Decimal(lcb["stress"]) > 0,
        "remove_best_month_stress_net_usd_per_1000_gt": Decimal(
            str(summary["remove_best_month_stress_net_usd_per_1000"])
        )
        > 0,
        "remove_best_symbol_stress_net_usd_per_1000_gt": Decimal(
            str(summary["remove_best_symbol_stress_net_usd_per_1000"])
        )
        > 0,
        "severe_hourly_marked_equity_max_drawdown_lte": (
            Decimal(str(summary["severe_hourly_marked_equity_max_drawdown"])) <= Decimal("0.10")
        ),
        "stress_net_usd_per_1000_gt": Decimal(net["stress"]) > 0,
    }


def unmeasured_holdout_summary() -> dict[str, None]:
    return dict.fromkeys(
        (
            "active_cohorts",
            "active_weeks",
            "bootstrap_intervals",
            "distinct_traded_symbols",
            "net_usd_per_1000_by_scenario",
            "pointwise_lcb",
            "public_capacity_proxy_usd",
            "remove_best_month_stress_net_usd_per_1000",
            "remove_best_symbol_stress_net_usd_per_1000",
            "severe_hourly_marked_equity_max_drawdown",
            "skipped_active_epochs",
            "valid_cash_epochs",
            "valid_decision_epochs",
        ),
        None,
    )


def result_links(frozen_commit: str) -> dict[str, Any]:
    return {
        "freeze_file_sha256": sha256_file(HERE / "freeze.v1.json"),
        "frozen_commit": frozen_commit,
        "protocol_file_sha256": sha256_file(HERE / "protocol.v1.json"),
        "run_consumed_file_sha256": sha256_file(HERE / "run_consumed.v1.json"),
        "source_manifest_file_sha256": sha256_file(HERE / "source_manifest.v1.json"),
        "trial_ledger_file_sha256": sha256_file(HERE / "trial_ledger.v1.json"),
    }


def development_and_holdout_custody(
    development_state: str,
    holdout_state: str,
    holdout_open_count: int,
) -> dict[str, Any]:
    return {
        "development": {
            "archive_member_open_count": MEMBER_OPEN_COUNTS["development"],
            "state": development_state,
        },
        "holdout": {
            "archive_member_open_count": MEMBER_OPEN_COUNTS["holdout"],
            "open_count": holdout_open_count,
            "outcome_rows_opened_before_gates": 0,
            "state": holdout_state,
        },
        "schema_only_probe": {
            "disclosed": True,
            "outcome_rows_opened": 0,
            "outside_selected_source_root": True,
        },
        "screen": {
            "archive_member_open_count": MEMBER_OPEN_COUNTS["screen"],
            "open_count": 1,
            "state": "OPENED_ONCE_JUNE_ONLY",
        },
    }


def common_result(
    frozen_commit: str,
    reported_trial_id: str | None,
) -> dict[str, Any]:
    return {
        "account_effective_fees": "UNKNOWN",
        "capital_authority": "NO_GO",
        "created_at": utc_now(),
        "effects": EFFECTS,
        "executable_capacity": "UNKNOWN",
        "execution_authority": "NONE",
        "limitations": [
            "Historical publication latency is UNKNOWN.",
            "Mark opens and hourly funding marks are public proxies, not fills or account debits.",
            (
                "All fee and adverse-movement scenarios are public proxies; "
                "account-effective fees are UNKNOWN."
            ),
            (
                "Quote volume is not spread, depth, impact, queue, atomicity, "
                "filter, margin, or executable capacity evidence."
            ),
            (
                "Historical rateType and USDT/USD conversion truth are "
                "unavailable in the selected archives."
            ),
        ],
        "positive_edge_claim": False,
        "reported_trial_id": reported_trial_id,
        "schema": f"{SCHEMA_PREFIX}.result.v1",
        "selected_source_root_holdout_outcome_rows_opened_before_gates": 0,
        **result_links(frozen_commit),
    }


def terminal_unmeasured_result(
    frozen_commit: str,
    reason_code: str,
    reported_trial_id: str | None = None,
) -> dict[str, Any]:
    return {
        **common_result(frozen_commit, reported_trial_id),
        "bootstrap_intervals": None,
        "candidate_seal_file_sha256": None,
        "causal_and_activity_counters": None,
        "development_file_sha256": None,
        "development_and_holdout_custody": development_and_holdout_custody(
            "RUN_CONSUMED_UNMEASURED",
            "UNOPENED",
            0,
        ),
        "holdout_file_sha256": None,
        "holdout_open_file_sha256": None,
        "holdout_state": "UNOPENED",
        "holm_p_values": None,
        "net_usd_per_1000_by_scenario": {
            "base": None,
            "severe": None,
            "stress": None,
        },
        "outcome_state": "TERMINAL_UNMEASURED",
        "pbo": None,
        "public_capacity_proxy": None,
        "reason_code": reason_code,
        "remove_best_symbol_and_month_stress_net": None,
        "severe_hourly_marked_equity_max_drawdown": None,
        "strategy_verdict": "UNMEASURED",
        "verdict": "UNMEASURED_RUN_CONSUMED_NO_RERUN",
        "white_reality_check_p_by_scenario": None,
    }


def measured_result(
    frozen_commit: str,
    development: Mapping[str, Any],
    champion: TrialResult,
    holdout: Mapping[str, Any] | None,
) -> dict[str, Any]:
    trial_rows = cast(Sequence[Mapping[str, Any]], development["trials"])
    champion_row = next(row for row in trial_rows if row["trial_id"] == champion.trial.trial_id)
    if holdout is None:
        net = {
            "base": champion_row["base_net_usd_per_1000"],
            "stress": champion_row["stress_net_usd_per_1000"],
            "severe": champion_row["severe_net_usd_per_1000"],
        }
        intervals = champion_row["bootstrap_interval_usd_per_1000"]
        capacity = champion_row["public_capacity_proxy_usd"]
        drawdown = champion_row["severe_hourly_marked_equity_max_drawdown"]
        counters = {
            "active_cohorts": champion_row["active_cohorts"],
            "active_weeks": champion_row["active_weeks"],
            "distinct_traded_symbols": champion_row["distinct_traded_symbols"],
            "skipped_active_epochs": champion_row["skipped_active_epochs"],
            "valid_cash_epochs": champion_row["valid_cash_epochs"],
            "valid_causal_decision_epochs": champion_row["valid_decision_epochs"],
        }
        robustness_net = {
            "remove_best_month_stress_net_usd_per_1000": (
                champion_row["remove_best_month_stress_net_usd_per_1000"]
            ),
            "remove_best_symbol_stress_net_usd_per_1000": (
                champion_row["remove_best_symbol_stress_net_usd_per_1000"]
            ),
        }
        verdict = "NO_GO_DEVELOPMENT_HOLDOUT_UNOPENED"
        outcome = "MEASURED_DEVELOPMENT_REJECTED"
        holdout_state = "UNOPENED"
        holdout_links: dict[str, Any] = {
            "candidate_seal_file_sha256": None,
            "holdout_file_sha256": None,
            "holdout_open_file_sha256": None,
        }
    else:
        summary = cast(Mapping[str, Any], holdout["summary"])
        net = summary["net_usd_per_1000_by_scenario"]
        intervals = summary["bootstrap_intervals"]
        capacity = summary["public_capacity_proxy_usd"]
        drawdown = summary["severe_hourly_marked_equity_max_drawdown"]
        counters = {
            "active_cohorts": summary["active_cohorts"],
            "active_weeks": summary["active_weeks"],
            "distinct_traded_symbols": summary["distinct_traded_symbols"],
            "skipped_active_epochs": summary["skipped_active_epochs"],
            "valid_cash_epochs": summary["valid_cash_epochs"],
            "valid_causal_decision_epochs": summary["valid_decision_epochs"],
        }
        robustness_net = {
            "remove_best_month_stress_net_usd_per_1000": (
                summary["remove_best_month_stress_net_usd_per_1000"]
            ),
            "remove_best_symbol_stress_net_usd_per_1000": (
                summary["remove_best_symbol_stress_net_usd_per_1000"]
            ),
        }
        verdict = (
            "PUBLIC_PROXY_PASS_CAPITAL_NO_GO" if holdout.get("all_gates_pass") is True else "NO_GO"
        )
        outcome = "MEASURED_HOLDOUT"
        holdout_state = "OPENED_ONCE_CHAMPION_ONLY"
        holdout_links = {
            "candidate_seal_file_sha256": sha256_file(HERE / "candidate_seal.v1.json"),
            "holdout_file_sha256": sha256_file(HERE / "holdout.v1.json"),
            "holdout_open_file_sha256": sha256_file(HERE / "holdout_open.v1.json"),
        }
    return {
        **common_result(
            frozen_commit,
            cast(str, development["reported_trial_id"]),
        ),
        **holdout_links,
        "bootstrap_intervals": intervals,
        "causal_and_activity_counters": counters,
        "development_file_sha256": sha256_file(HERE / "development.v1.json"),
        "development_and_holdout_custody": development_and_holdout_custody(
            "MEASURED_ONCE",
            holdout_state,
            0 if holdout is None else 1,
        ),
        "holdout_state": holdout_state,
        "holm_p_values": {row["trial_id"]: row["holm_adjusted_p"] for row in trial_rows},
        "net_usd_per_1000_by_scenario": net,
        "outcome_state": outcome,
        "pbo": development["pbo"],
        "public_capacity_proxy": capacity,
        "remove_best_symbol_and_month_stress_net": robustness_net,
        "severe_hourly_marked_equity_max_drawdown": drawdown,
        "strategy_verdict": "NO_GO",
        "verdict": verdict,
        "white_reality_check_p_by_scenario": development["white_reality_check_p_by_scenario"],
    }


def write_once_text(path: Path, text: str) -> None:
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o444)
    except FileExistsError as exc:
        raise ContractError("CREATE_ONCE_REFUSED", str(path)) from exc
    with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as stream:
        stream.write(text)
        stream.flush()
        os.fsync(stream.fileno())


def finalize_packet(result: Mapping[str, Any]) -> None:
    write_once_json(HERE / "result.v1.json", result)
    net = result.get("net_usd_per_1000_by_scenario")
    net_text = "UNMEASURED"
    if isinstance(net, dict):
        net_text = "; ".join(f"{key}={net.get(key)}" for key in ("base", "stress", "severe"))
    intervals = result.get("bootstrap_intervals")
    interval_text = "UNMEASURED"
    if isinstance(intervals, dict):
        interval_text = "; ".join(
            f"{key}={intervals.get(key)}" for key in ("base", "stress", "severe")
        )
    holm = result.get("holm_p_values")
    white = result.get("white_reality_check_p_by_scenario")
    pbo = result.get("pbo")
    multiplicity_text = "UNMEASURED"
    if isinstance(holm, dict) and isinstance(white, dict) and isinstance(pbo, dict):
        holm_values = sorted(Decimal(str(value)) for value in holm.values())
        multiplicity_text = (
            f"Holm min/max={decimal_string(holm_values[0])}/"
            f"{decimal_string(holm_values[-1])}; "
            f"White base/stress={white.get('base')}/{white.get('stress')}; "
            f"PBO={pbo.get('pbo')}"
        )
    drawdown = result.get("severe_hourly_marked_equity_max_drawdown")
    capacity = result.get("public_capacity_proxy")
    custody = result.get("development_and_holdout_custody")
    custody_text = "UNMEASURED"
    if isinstance(custody, dict):
        development = custody.get("development")
        holdout = custody.get("holdout")
        if isinstance(development, dict) and isinstance(holdout, dict):
            custody_text = (
                f"development={development.get('state')}; "
                f"holdout={holdout.get('state')}; "
                f"holdout opens={holdout.get('open_count')}"
            )
    report = (
        "| item | expected | found | status |\n"
        "|---|---|---|---|\n"
        f"| S-1V verdict | sealed public-only verdict | {result['verdict']} | FINAL |\n"
        f"| net USD per $1k | base; stress; severe | {net_text} | SEALED |\n"
        f"| reported interval | base; stress; severe | {interval_text} | SEALED |\n"
        f"| multiplicity | Holm; White; PBO | {multiplicity_text} | SEALED |\n"
        f"| severe hourly drawdown | fixed $1k denominator | "
        f"{drawdown if drawdown is not None else 'UNMEASURED'} | SEALED |\n"
        f"| public capacity | coarse causal proxy only | "
        f"{capacity if capacity is not None else 'UNMEASURED'} | NON_EXECUTABLE |\n"
        f"| holdout custody | gate-bound champion only | {custody_text} | SEALED |\n"
        f"| executable limits | no capital authority | account fees="
        f"{result['account_effective_fees']}; executable capacity="
        f"{result['executable_capacity']}; capital={result['capital_authority']} | NO_GO |\n"
    )
    write_once_text(HERE / "REPORT.md", report)
    names = sorted(
        path.name for path in HERE.iterdir() if path.is_file() and path.name != "SHA256SUMS"
    )
    sums = "".join(f"{sha256_file(HERE / name)}  {name}\n" for name in names)
    write_once_text(HERE / "SHA256SUMS", sums)


def run(source_root: Path, frozen_commit: str) -> dict[str, Any]:
    root = source_root_guard(source_root)
    if COMMIT_RE.fullmatch(frozen_commit) is None:
        raise ContractError("FROZEN_COMMIT_INVALID", frozen_commit)
    universe, manifest, _frozen = verify_freeze()
    marker = {
        "allowed_run_count": 1,
        "created_at": utc_now(),
        "development_archive_member_open_count_before": 0,
        "freeze_file_sha256": sha256_file(HERE / "freeze.v1.json"),
        "frozen_commit": frozen_commit,
        "holdout_archive_member_open_count_before": 0,
        "marker_created_before_development_open": True,
        "protocol_file_sha256": sha256_file(HERE / "protocol.v1.json"),
        "run_ordinal": 1,
        "schema": f"{SCHEMA_PREFIX}.run_consumed.v1",
        "source_manifest_file_sha256": sha256_file(HERE / "source_manifest.v1.json"),
        "trial_ledger_file_sha256": sha256_file(HERE / "trial_ledger.v1.json"),
        "universe_file_sha256": sha256_file(HERE / "universe.v1.json"),
    }
    write_once_json(HERE / "run_consumed.v1.json", marker)
    write_once_json(root / "run_consumed.v1.json", marker)
    screen_member_count = universe.get("screen_archive_member_open_count")
    if not isinstance(screen_member_count, int) or screen_member_count < 0:
        result = terminal_unmeasured_result(frozen_commit, "SCREEN_MEMBER_OPEN_COUNT_INVALID")
        finalize_packet(result)
        return result
    MEMBER_OPEN_COUNTS["screen"] = screen_member_count
    set_member_open_stage("development")
    symbols_value = universe.get("selected_symbols")
    pre_run_complete = (
        universe.get("status") == "FROZEN"
        and manifest.get("status") == "COMPLETE"
        and isinstance(symbols_value, list)
        and len(symbols_value) == 30
    )
    if not pre_run_complete:
        result = terminal_unmeasured_result(frozen_commit, "PRE_RUN_SOURCE_OR_UNIVERSE_INVALID")
        finalize_packet(result)
        return result
    symbols = tuple(cast(str, item) for item in cast(list[Any], symbols_value))
    try:
        development_market = load_market(
            root,
            manifest,
            symbols,
            SCREEN_MONTHS + DEVELOPMENT_MONTHS,
        )
        development_snapshots = build_snapshots(
            development_market,
            symbols,
            SCREEN_START_MS,
            DEVELOPMENT_END_MS,
        )
        trial_results = tuple(
            evaluate_trial(
                development_market,
                development_snapshots,
                trial,
                DEVELOPMENT_START_MS,
                DEVELOPMENT_END_MS,
            )
            for trial in trial_family()
        )
        development, champion = development_document(
            trial_results,
            calendar_days(DEVELOPMENT_START_MS, DEVELOPMENT_END_MS),
            frozen_commit,
        )
    except EvidenceError as exc:
        result = terminal_unmeasured_result(frozen_commit, exc.code)
        finalize_packet(result)
        return result
    write_once_json(HERE / "development.v1.json", development)
    if development["admitted_to_holdout"] is not True:
        result = measured_result(frozen_commit, development, champion, None)
        finalize_packet(result)
        return result
    candidate = {
        "champion_trial_id": champion.trial.trial_id,
        "created_at": utc_now(),
        "development_file_sha256": sha256_file(HERE / "development.v1.json"),
        "freeze_file_sha256": sha256_file(HERE / "freeze.v1.json"),
        "frozen_commit": frozen_commit,
        "run_consumed_file_sha256": sha256_file(HERE / "run_consumed.v1.json"),
        "schema": f"{SCHEMA_PREFIX}.candidate_seal.v1",
        "source_manifest_file_sha256": sha256_file(HERE / "source_manifest.v1.json"),
        "trial_ledger_file_sha256": sha256_file(HERE / "trial_ledger.v1.json"),
    }
    write_once_json(HERE / "candidate_seal.v1.json", candidate)
    open_marker = {
        "allowed_holdout_open_count": 1,
        "candidate_seal_file_sha256": sha256_file(HERE / "candidate_seal.v1.json"),
        "champion_trial_id": champion.trial.trial_id,
        "created_at": utc_now(),
        "development_file_sha256": sha256_file(HERE / "development.v1.json"),
        "frozen_commit": frozen_commit,
        "holdout_open_ordinal": 1,
        "holdout_archive_member_open_count_before": 0,
        "marker_created_before_first_member": True,
        "marker_created_before_holdout_open": True,
        "reserved_holdout_path": "holdout.v1.json",
        "reserved_result_path": "result.v1.json",
        "schema": f"{SCHEMA_PREFIX}.holdout_open.v1",
    }
    write_once_json(HERE / "holdout_open.v1.json", open_marker)
    write_once_json(root / "holdout_open.v1.json", open_marker)
    set_member_open_stage("holdout")
    try:
        holdout_market = load_market(
            root,
            manifest,
            symbols,
            ("2026-03", *HOLDOUT_MONTHS),
        )
        holdout_snapshots = build_snapshots(
            holdout_market,
            symbols,
            HOLDOUT_HISTORY_START_MS,
            HOLDOUT_END_MS,
        )
        holdout_result = evaluate_trial(
            holdout_market,
            holdout_snapshots,
            champion.trial,
            HOLDOUT_START_MS,
            HOLDOUT_END_MS,
        )
        summary = pointwise_holdout_summary(
            holdout_result,
            calendar_days(HOLDOUT_START_MS, HOLDOUT_END_MS),
        )
        gates = holdout_gates(summary)
        holdout = {
            "all_gates_pass": all(gates.values()),
            "candidate_seal_file_sha256": sha256_file(HERE / "candidate_seal.v1.json"),
            "champion_trial_id": champion.trial.trial_id,
            "created_at": utc_now(),
            "frozen_commit": frozen_commit,
            "gates": gates,
            "holdout_open_file_sha256": sha256_file(HERE / "holdout_open.v1.json"),
            "holdout_archive_member_open_count": MEMBER_OPEN_COUNTS["holdout"],
            "outcome_state": "MEASURED",
            "schema": f"{SCHEMA_PREFIX}.holdout.v1",
            "summary": summary,
        }
    except EvidenceError:
        # The marker remains consumed.  Preserve a complete bundle; the parent
        # verifier recognizes this explicit terminal branch.
        holdout = {
            "all_gates_pass": False,
            "candidate_seal_file_sha256": sha256_file(HERE / "candidate_seal.v1.json"),
            "champion_trial_id": champion.trial.trial_id,
            "created_at": utc_now(),
            "frozen_commit": frozen_commit,
            "gates": dict.fromkeys(HOLDOUT_GATE_NAMES, False),
            "holdout_open_file_sha256": sha256_file(HERE / "holdout_open.v1.json"),
            "holdout_archive_member_open_count": MEMBER_OPEN_COUNTS["holdout"],
            "outcome_state": "UNMEASURED",
            "schema": f"{SCHEMA_PREFIX}.holdout.v1",
            "summary": unmeasured_holdout_summary(),
        }
        write_once_json(HERE / "holdout.v1.json", holdout)
        result = {
            **terminal_unmeasured_result(
                frozen_commit,
                "HOLDOUT_EVIDENCE_INVALID_AFTER_OPEN",
                cast(str, development["reported_trial_id"]),
            ),
            "candidate_seal_file_sha256": sha256_file(HERE / "candidate_seal.v1.json"),
            "development_file_sha256": sha256_file(HERE / "development.v1.json"),
            "holdout_file_sha256": sha256_file(HERE / "holdout.v1.json"),
            "holdout_open_file_sha256": sha256_file(HERE / "holdout_open.v1.json"),
            "holdout_state": "OPENED_ONCE_CHAMPION_ONLY",
            "development_and_holdout_custody": development_and_holdout_custody(
                "MEASURED_ONCE",
                "OPENED_ONCE_CHAMPION_ONLY",
                1,
            ),
        }
        finalize_packet(result)
        return result
    write_once_json(HERE / "holdout.v1.json", holdout)
    result = measured_result(frozen_commit, development, champion, holdout)
    finalize_packet(result)
    return result


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("preseal")
    for name in ("screen", "freeze"):
        child = commands.add_parser(name)
        child.add_argument("--source-root", type=Path, default=DEFAULT_SOURCE_ROOT)
    run_parser = commands.add_parser("run")
    run_parser.add_argument("--source-root", type=Path, default=DEFAULT_SOURCE_ROOT)
    run_parser.add_argument("--frozen-commit", required=True)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = build_parser().parse_args(sys.argv[1:] if argv is None else argv)
    try:
        if arguments.command == "preseal":
            preseal()
        elif arguments.command == "screen":
            screen(arguments.source_root)
        elif arguments.command == "freeze":
            freeze(arguments.source_root)
        elif arguments.command == "run":
            run(arguments.source_root, arguments.frozen_commit)
        else:
            raise AssertionError("argparse accepted an unknown command")
    except S1VError as exc:
        print(f"S1V_{arguments.command.upper()}_FAILED:{exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
