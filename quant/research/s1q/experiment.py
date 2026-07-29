#!/usr/bin/env python3
"""Sealed public-only S-1Q funding-sign-transition research evaluator.

The evaluator never calls a network or private endpoint. ``freeze`` opens only
the pre-development June 2025 universe screen, then binds every frozen input and
publisher checksum. ``run`` consumes the experiment before the first
development archive member is parsed. The holdout is gated and stays unopened
when any development admission requirement is false.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import itertools
import json
import os
import random
import re
import statistics
import sys
import zipfile
from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation, getcontext
from pathlib import Path
from typing import Final, cast

getcontext().prec = 50

PACKET_DIR: Final = Path(__file__).resolve().parent
EXPECTED_SHARED_ROOT: Final = Path("/private/tmp/cosmos-s1d-funding-dispersion-v1/raw")
EXPECTED_STATE_ROOT: Final = Path("/private/tmp/cosmos-s1q-usdm-funding-sign-flip-v1")
BASE_COMMIT: Final = "a169b123fb186d1943a75ad648552c4d95be1be1"
SOURCE_NOTE_SHA256: Final = "e004c202895b05039d14e1c443bcf3556fd04170b4d245fbb662e818ebf71e6b"
HOUR_MS: Final = 3_600_000
DAY_MS: Final = 86_400_000
MAX_ZIP_BYTES: Final = 256 * 1024 * 1024
MAX_MEMBER_BYTES: Final = 512 * 1024 * 1024
MAX_SIDECAR_BYTES: Final = 4096
SCREEN_MONTH: Final = "2025-06"
ALL_MONTHS: Final = (
    "2025-06",
    "2025-07",
    "2025-08",
    "2025-09",
    "2025-10",
    "2025-11",
    "2025-12",
    "2026-01",
    "2026-02",
    "2026-03",
    "2026-04",
    "2026-05",
    "2026-06",
)
DEV_MONTHS: Final = ALL_MONTHS[:10]
HOLDOUT_MONTHS: Final = ALL_MONTHS[10:]
DEV_START_MS: Final = int(datetime(2025, 7, 1, tzinfo=UTC).timestamp() * 1000)
DEV_END_MS: Final = int(datetime(2026, 4, 1, tzinfo=UTC).timestamp() * 1000)
HOLDOUT_START_MS: Final = int(datetime(2026, 4, 8, tzinfo=UTC).timestamp() * 1000)
HOLDOUT_END_MS: Final = int(datetime(2026, 7, 1, tzinfo=UTC).timestamp() * 1000)
CAPITAL: Final = Decimal("1000")
SIDE_NOTIONAL: Final = Decimal("500")
CAPACITY_PARTICIPATION: Final = Decimal("0.0001")
BOOTSTRAP_REPLICATES: Final = 4096
BOOTSTRAP_SEED: Final = 2026072904
ALPHA: Final = Decimal("0.05")
SYMBOL_RE: Final = re.compile(r"^[A-Z0-9]+USDT$")
HEX_RE: Final = re.compile(r"^[0-9a-fA-F]{64}$")
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
EXCLUDED_SYMBOLS: Final = frozenset(
    {
        "AUDUSDT",
        "BRLUSDT",
        "BUSDUSDT",
        "DAIUSDT",
        "EURUSDT",
        "FDUSDUSDT",
        "GBPUSDT",
        "IDRTUSDT",
        "JPYUSDT",
        "NGNUSDT",
        "RUBUSDT",
        "TUSDUSDT",
        "TRYUSDT",
        "UAHUSDT",
        "USDCUSDT",
        "USDPUSDT",
        "USDTUSDT",
    }
)


class S1QError(RuntimeError):
    """Fail-closed S-1Q error."""


class CustodyError(S1QError):
    """Publisher checksum, archive, path, or schema violation."""


class SealError(S1QError):
    """Frozen lifecycle or create-once control violation."""


@dataclass(frozen=True, slots=True)
class Trial:
    trial_id: str
    threshold_bps: Decimal
    hold_hours: int

    @property
    def primary(self) -> bool:
        return self.trial_id == "shock_1bps_hold_3h"


@dataclass(frozen=True, slots=True)
class FundingRow:
    time_ms: int
    interval_hours: int
    rate: Decimal


@dataclass(frozen=True, slots=True)
class KlineRow:
    open_time_ms: int
    open_price: Decimal
    close_time_ms: int
    quote_volume: Decimal


@dataclass(frozen=True, slots=True)
class Flip:
    symbol: str
    time_ms: int
    side: int
    shock_bps: Decimal


@dataclass(frozen=True, slots=True)
class Position:
    symbol: str
    side: int
    entry_ms: int
    exit_ms: int
    assigned_usd: Decimal
    price_pnl: Decimal
    funding_pnl: Decimal
    base_net: Decimal
    stress_net: Decimal
    severe_net: Decimal
    capacity_usd: Decimal


@dataclass(frozen=True, slots=True)
class Cohort:
    event_ms: int
    entry_ms: int
    exit_ms: int
    positions: tuple[Position, ...]

    @property
    def base_net(self) -> Decimal:
        return sum((item.base_net for item in self.positions), Decimal(0))

    @property
    def stress_net(self) -> Decimal:
        return sum((item.stress_net for item in self.positions), Decimal(0))

    @property
    def severe_net(self) -> Decimal:
        return sum((item.severe_net for item in self.positions), Decimal(0))


@dataclass(slots=True)
class MarketData:
    funding: dict[str, tuple[FundingRow, ...]]
    contract: dict[str, dict[int, KlineRow]]
    mark: dict[str, dict[int, KlineRow]]
    daily_quote: dict[str, dict[int, Decimal]]
    unmeasured_funding_months: frozenset[str]


def canonical_json_bytes(value: object) -> bytes:
    """Return deterministic JSON bytes."""
    return (
        json.dumps(
            value,
            allow_nan=False,
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
        + "\n"
    ).encode()


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def read_json(path: Path) -> dict[str, object]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise SealError(f"{path} is not a JSON object")
    return cast(dict[str, object], value)


def create_once(path: Path, value: object) -> None:
    """Atomically create a file and refuse replacement."""
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = canonical_json_bytes(value)
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o444)
    except FileExistsError as error:
        raise SealError(f"create-once artifact already exists: {path}") from error
    with os.fdopen(descriptor, "wb") as handle:
        handle.write(payload)
        handle.flush()
        os.fsync(handle.fileno())


def utc_now() -> str:
    return datetime.now(tz=UTC).isoformat().replace("+00:00", "Z")


def iso_ms(value: int) -> str:
    return datetime.fromtimestamp(value / 1000, tz=UTC).isoformat().replace("+00:00", "Z")


def day_start_ms(value: int) -> int:
    return value - value % DAY_MS


def month_bounds_ms(month: str) -> tuple[int, int]:
    start = datetime.strptime(month + "-01", "%Y-%m-%d").replace(tzinfo=UTC)
    if start.month == 12:
        end = start.replace(year=start.year + 1, month=1)
    else:
        end = start.replace(month=start.month + 1)
    return int(start.timestamp() * 1000), int(end.timestamp() * 1000)


def is_symbol_candidate(symbol: str) -> bool:
    if not SYMBOL_RE.fullmatch(symbol) or symbol in EXCLUDED_SYMBOLS:
        return False
    base = symbol.removesuffix("USDT")
    return not base.endswith(("UP", "DOWN", "BULL", "BEAR"))


def trial_family() -> tuple[Trial, ...]:
    thresholds = (
        ("0bps", Decimal("0")),
        ("0_5bps", Decimal("0.5")),
        ("1bps", Decimal("1")),
        ("2bps", Decimal("2")),
    )
    return tuple(
        Trial(f"shock_{label}_hold_{hold}h", threshold, hold)
        for label, threshold in thresholds
        for hold in (1, 3, 6)
    )


def primary_trial() -> Trial:
    matches = [trial for trial in trial_family() if trial.primary]
    if len(matches) != 1:
        raise SealError("frozen primary trial is not unique")
    return matches[0]


def parse_checksum_sidecar(raw: bytes, filename: str) -> str:
    if len(raw) > MAX_SIDECAR_BYTES:
        raise CustodyError("checksum sidecar exceeds bound")
    try:
        text = raw.decode("ascii").strip()
    except UnicodeDecodeError as error:
        raise CustodyError("checksum sidecar is not ASCII") from error
    fields = text.split()
    if len(fields) != 2 or not HEX_RE.fullmatch(fields[0]):
        raise CustodyError("checksum sidecar must contain one SHA-256 and filename")
    bound_name = fields[1].lstrip("*")
    if bound_name != filename or "/" in bound_name:
        raise CustodyError("checksum sidecar filename is not exactly bound")
    return fields[0].lower()


def archive_path(root: Path, dataset: str, symbol: str, month: str) -> Path:
    if dataset == "fundingRate":
        relative = Path(
            "data/futures/um/monthly/fundingRate",
            symbol,
            f"{symbol}-fundingRate-{month}.zip",
        )
    elif dataset == "klines_1h":
        relative = Path(
            "data/futures/um/monthly/klines",
            symbol,
            "1h",
            f"{symbol}-1h-{month}.zip",
        )
    elif dataset == "markPriceKlines_1h":
        relative = Path(
            "data/futures/um/monthly/markPriceKlines",
            symbol,
            "1h",
            f"{symbol}-1h-{month}.zip",
        )
    else:
        raise CustodyError(f"unknown dataset: {dataset}")
    candidate = root / relative
    try:
        candidate.resolve().relative_to(root.resolve())
    except ValueError as error:
        raise CustodyError("archive path escapes shared root") from error
    return candidate


def publisher_record(
    root: Path,
    dataset: str,
    symbol: str,
    month: str,
    *,
    verify_zip_payload: bool = True,
) -> dict[str, object]:
    path = archive_path(root, dataset, symbol, month)
    sidecar = path.with_name(path.name + ".CHECKSUM")
    if path.is_symlink() or sidecar.is_symlink():
        raise CustodyError(f"symlink source rejected: {path}")
    if not path.is_file() or not sidecar.is_file():
        raise CustodyError(f"required archive cell unavailable: {path}")
    size = path.stat().st_size
    if size <= 0 or size > MAX_ZIP_BYTES:
        raise CustodyError(f"archive size outside bounds: {path}")
    raw_sidecar = sidecar.read_bytes()
    expected = parse_checksum_sidecar(raw_sidecar, path.name)
    observed: str | None = None
    status = "DEFERRED_UNTOUCHED"
    if verify_zip_payload:
        observed = sha256_path(path)
        if observed != expected:
            raise CustodyError(f"publisher checksum mismatch: {path}")
        status = "VERIFIED"
    return {
        "dataset": dataset,
        "month": month,
        "path": str(path.relative_to(root)),
        "publisher_checksum_path": str(sidecar.relative_to(root)),
        "publisher_sidecar_sha256": sha256_bytes(raw_sidecar),
        "publisher_sha256": expected,
        "size_bytes": size,
        "symbol": symbol,
        "zip_sha256": observed,
        "zip_verification": status,
    }


def inventory_record(
    root: Path,
    dataset: str,
    symbol: str,
    month: str,
    *,
    verify_zip_payload: bool,
) -> dict[str, object]:
    path = archive_path(root, dataset, symbol, month)
    sidecar = path.with_name(path.name + ".CHECKSUM")
    if not path.is_file() or not sidecar.is_file():
        return {
            "availability": "UNAVAILABLE",
            "dataset": dataset,
            "month": month,
            "path": str(path.relative_to(root)),
            "publisher_checksum_path": str(sidecar.relative_to(root)),
            "reason": "ZIP_OR_ADJACENT_PUBLISHER_CHECKSUM_MISSING",
            "symbol": symbol,
            "zip_verification": "NOT_AVAILABLE",
        }
    record = publisher_record(
        root,
        dataset,
        symbol,
        month,
        verify_zip_payload=verify_zip_payload,
    )
    record["availability"] = "AVAILABLE"
    return record


def archive_member_bytes(path: Path) -> bytes:
    with zipfile.ZipFile(path) as archive:
        members = [
            member
            for member in archive.infolist()
            if not member.is_dir() and not member.filename.startswith("__MACOSX/")
        ]
        if len(members) != 1:
            raise CustodyError(f"archive must contain exactly one member: {path}")
        member = members[0]
        if (
            member.file_size <= 0
            or member.file_size > MAX_MEMBER_BYTES
            or Path(member.filename).name != member.filename
            or not member.filename.endswith(".csv")
        ):
            raise CustodyError(f"archive member violates bounds: {path}")
        return archive.read(member)


def csv_rows(raw: bytes, path: Path) -> list[list[str]]:
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise CustodyError(f"CSV is not UTF-8: {path}") from error
    rows = [row for row in csv.reader(io.StringIO(text)) if row]
    if not rows:
        raise CustodyError(f"CSV is empty: {path}")
    return rows


def decimal_field(raw: str, context: str) -> Decimal:
    try:
        value = Decimal(raw)
    except InvalidOperation as error:
        raise CustodyError(f"invalid decimal {context}") from error
    if not value.is_finite():
        raise CustodyError(f"non-finite decimal {context}")
    return value


def int_field(raw: str, context: str) -> int:
    try:
        return int(raw)
    except ValueError as error:
        raise CustodyError(f"invalid integer {context}") from error


def read_funding_archive(path: Path, month: str) -> tuple[FundingRow, ...]:
    rows = csv_rows(archive_member_bytes(path), path)
    header = tuple(field.strip() for field in rows[0])
    if header != FUNDING_HEADER:
        raise CustodyError(f"unexpected funding header: {path}")
    start_ms, end_ms = month_bounds_ms(month)
    parsed: list[FundingRow] = []
    previous = -1
    for index, row in enumerate(rows[1:], start=2):
        if len(row) != 3:
            raise CustodyError(f"funding row width at {path}:{index}")
        time_ms = int_field(row[0], f"{path}:{index}:calc_time")
        interval = int_field(row[1], f"{path}:{index}:funding_interval_hours")
        rate = decimal_field(row[2], f"{path}:{index}:last_funding_rate")
        if not start_ms <= time_ms < end_ms or interval <= 0 or interval > 24:
            raise CustodyError(f"funding time or cadence outside bounds: {path}:{index}")
        if time_ms <= previous:
            raise CustodyError(f"duplicate or out-of-order funding row: {path}:{index}")
        previous = time_ms
        parsed.append(FundingRow(time_ms, interval, rate))
    if not parsed:
        raise CustodyError(f"funding archive has no rows: {path}")
    return tuple(parsed)


def read_kline_archive(path: Path, month: str) -> tuple[KlineRow, ...]:
    rows = csv_rows(archive_member_bytes(path), path)
    first = tuple(field.strip().lower() for field in rows[0])
    data_rows = rows
    if first == KLINE_HEADER:
        data_rows = rows[1:]
    start_ms, end_ms = month_bounds_ms(month)
    parsed: list[KlineRow] = []
    previous = -1
    for index, row in enumerate(data_rows, start=2 if data_rows is not rows else 1):
        if len(row) != 12:
            raise CustodyError(f"kline row width at {path}:{index}")
        open_ms = int_field(row[0], f"{path}:{index}:open_time")
        open_price = decimal_field(row[1], f"{path}:{index}:open")
        close_ms = int_field(row[6], f"{path}:{index}:close_time")
        quote = decimal_field(row[7], f"{path}:{index}:quote_volume")
        if (
            not start_ms <= open_ms < end_ms
            or open_ms % HOUR_MS != 0
            or close_ms != open_ms + HOUR_MS - 1
            or open_price <= 0
            or quote < 0
        ):
            raise CustodyError(f"kline fields outside bounds: {path}:{index}")
        if open_ms <= previous:
            raise CustodyError(f"duplicate or out-of-order kline: {path}:{index}")
        previous = open_ms
        parsed.append(KlineRow(open_ms, open_price, close_ms, quote))
    if not parsed:
        raise CustodyError(f"kline archive has no rows: {path}")
    return tuple(parsed)


def candidate_symbols(root: Path) -> tuple[str, ...]:
    funding_root = root / "data/futures/um/monthly/fundingRate"
    found: list[str] = []
    for entry in funding_root.iterdir():
        symbol = entry.name
        if not entry.is_dir() or not is_symbol_candidate(symbol):
            continue
        if all(
            archive_path(root, dataset, symbol, SCREEN_MONTH).is_file()
            and archive_path(root, dataset, symbol, SCREEN_MONTH)
            .with_name(archive_path(root, dataset, symbol, SCREEN_MONTH).name + ".CHECKSUM")
            .is_file()
            for dataset in ("fundingRate", "klines_1h", "markPriceKlines_1h")
        ):
            found.append(symbol)
    return tuple(sorted(found))


def bound_file_hashes() -> dict[str, str]:
    names = (
        "OFFICIAL_SOURCE_RESEARCH.md",
        "protocol.v1.json",
        "experiment.py",
        "test_experiment.py",
    )
    return {name: sha256_path(PACKET_DIR / name) for name in names}


def trial_family_digest() -> str:
    value = [
        {
            "hold_hours": trial.hold_hours,
            "threshold_bps": str(trial.threshold_bps),
            "trial_id": trial.trial_id,
        }
        for trial in trial_family()
    ]
    return sha256_bytes(canonical_json_bytes(value))


def protocol_authority_digest() -> str:
    protocol = read_json(PACKET_DIR / "protocol.v1.json")
    names = (
        "calendar",
        "development_gates",
        "economics",
        "event",
        "holdout_gates",
        "sealing",
        "statistics",
        "trial_family",
        "verdict_law",
    )
    value = {name: protocol[name] for name in names}
    return sha256_bytes(canonical_json_bytes(value))


def guard_roots(shared_root: Path, state_root: Path) -> tuple[Path, Path]:
    shared = shared_root.resolve()
    state = state_root.resolve()
    if shared != EXPECTED_SHARED_ROOT.resolve():
        raise SealError(f"shared root must be exactly {EXPECTED_SHARED_ROOT}")
    if state != EXPECTED_STATE_ROOT:
        raise SealError(f"state root must be exactly {EXPECTED_STATE_ROOT}")
    if not shared.is_dir():
        raise SealError("shared root is unavailable")
    return shared, state


def screen_universe(root: Path) -> tuple[dict[str, object], ...]:
    candidates = candidate_symbols(root)
    if len(candidates) < 40:
        raise CustodyError("fewer than 40 pre-July archive-key candidates")
    screen: list[dict[str, object]] = []
    for symbol in candidates:
        record = publisher_record(root, "klines_1h", symbol, SCREEN_MONTH)
        path = root / cast(str, record["path"])
        rows = read_kline_archive(path, SCREEN_MONTH)
        if len(rows) != 720:
            continue
        quote = sum((row.quote_volume for row in rows), Decimal(0))
        screen.append(
            {
                "june_2025_hourly_rows": len(rows),
                "june_2025_quote_volume": str(quote),
                "june_2025_zip_sha256": record["zip_sha256"],
                "symbol": symbol,
            }
        )
    screen.sort(
        key=lambda item: (
            -Decimal(cast(str, item["june_2025_quote_volume"])),
            cast(str, item["symbol"]),
        )
    )
    if len(screen) < 40:
        raise CustodyError("fewer than 40 complete June screen symbols")
    return tuple(screen)


def build_source_manifest(root: Path, symbols: Sequence[str]) -> dict[str, object]:
    records = [
        inventory_record(
            root,
            dataset,
            symbol,
            month,
            verify_zip_payload=month not in HOLDOUT_MONTHS,
        )
        for symbol in symbols
        for month in ALL_MONTHS
        for dataset in ("fundingRate", "klines_1h", "markPriceKlines_1h")
    ]
    verified = sum(record["zip_verification"] == "VERIFIED" for record in records)
    deferred = sum(record["zip_verification"] == "DEFERRED_UNTOUCHED" for record in records)
    unavailable = sum(record["availability"] == "UNAVAILABLE" for record in records)
    return {
        "archive_body_policy": {
            "development": "UNOPENED_AT_FREEZE",
            "holdout": "ZIP_PAYLOAD_UNREAD_UNHASHED_AND_BODY_UNOPENED_AT_FREEZE",
            "screen": "JUNE_2025_CONTRACT_KLINES_OPENED_ONLY",
        },
        "checksum_algorithm": "sha256",
        "created_at": utc_now(),
        "deferred_holdout_zip_count": deferred,
        "publisher_checksum_count": len(records),
        "records": records,
        "schema": "cosmos.s1q.source_manifest.v1",
        "shared_root": str(root),
        "unavailable_cell_count": unavailable,
        "verified_non_holdout_zip_count": verified,
    }


def freeze(shared_root: Path, state_root: Path) -> None:
    shared, state = guard_roots(shared_root, state_root)
    if (PACKET_DIR / "freeze.v1.json").exists():
        raise SealError("freeze already exists")
    if sha256_path(PACKET_DIR / "OFFICIAL_SOURCE_RESEARCH.md") != SOURCE_NOTE_SHA256:
        raise SealError("official source note changed after source freeze")
    state.mkdir(mode=0o700, parents=False, exist_ok=False)
    preseal = {
        "base_commit": BASE_COMMIT,
        "bound_files": bound_file_hashes(),
        "created_at": utc_now(),
        "policy": ("CREATED_BEFORE_ANY_JUNE_2025_SCREEN_OR_WARMUP_ARCHIVE_MEMBER_DECOMPRESSION"),
        "schema": "cosmos.s1q.preseal.v1",
    }
    create_once(PACKET_DIR / "preseal.v1.json", preseal)
    create_once(
        state / "PRESEAL.v1.json",
        {
            "packet_preseal_sha256": sha256_path(PACKET_DIR / "preseal.v1.json"),
            "schema": "cosmos.s1q.external_preseal_pointer.v1",
        },
    )
    screen_marker = {
        "created_at": utc_now(),
        "policy": "CONSUMED_BEFORE_FIRST_JUNE_2025_SCREEN_MEMBER_DECOMPRESSION",
        "preseal_sha256": sha256_path(PACKET_DIR / "preseal.v1.json"),
        "protocol_sha256": sha256_path(PACKET_DIR / "protocol.v1.json"),
        "schema": "cosmos.s1q.screen_consumed.v1",
    }
    create_once(PACKET_DIR / "SCREEN_CONSUMED.v1.json", screen_marker)
    create_once(state / "SCREEN_CONSUMED.v1.json", screen_marker)
    screen = screen_universe(shared)
    selected = tuple(cast(str, item["symbol"]) for item in screen[:40])
    universe = {
        "candidate_count": len(screen),
        "candidate_rule": (
            "Pre-July official archive keys with June fundingRate, contract 1h, "
            "and mark-price 1h cells; stable, fiat, and leveraged-token exclusions."
        ),
        "created_at": utc_now(),
        "future_completeness_used": False,
        "screen": list(screen),
        "screen_month": SCREEN_MONTH,
        "selection_rule": (
            "Top 40 complete June 2025 symbols by contract quote volume descending, "
            "symbol ascending."
        ),
        "selected_count": 40,
        "selected_symbols": list(selected),
        "schema": "cosmos.s1q.universe.v1",
    }
    create_once(PACKET_DIR / "universe.v1.json", universe)
    manifest = build_source_manifest(shared, selected)
    create_once(PACKET_DIR / "source_manifest.v1.json", manifest)
    hashes = bound_file_hashes()
    hashes["universe.v1.json"] = sha256_path(PACKET_DIR / "universe.v1.json")
    hashes["source_manifest.v1.json"] = sha256_path(PACKET_DIR / "source_manifest.v1.json")
    hashes["preseal.v1.json"] = sha256_path(PACKET_DIR / "preseal.v1.json")
    hashes["SCREEN_CONSUMED.v1.json"] = sha256_path(PACKET_DIR / "SCREEN_CONSUMED.v1.json")
    frozen = {
        "base_commit": BASE_COMMIT,
        "bound_files": hashes,
        "created_at": utc_now(),
        "development_archive_bodies_opened": 0,
        "holdout_archive_bodies_opened": 0,
        "protocol_precedes_outcomes": True,
        "publisher_checksum_count": manifest["publisher_checksum_count"],
        "schema": "cosmos.s1q.freeze.v1",
        "selected_symbols": list(selected),
        "shared_archive_policy": "READ_ONLY",
    }
    create_once(PACKET_DIR / "freeze.v1.json", frozen)
    create_once(
        state / "FREEZE.v1.json",
        {
            "packet_freeze_sha256": sha256_path(PACKET_DIR / "freeze.v1.json"),
            "schema": "cosmos.s1q.external_freeze_pointer.v1",
        },
    )


def resume_freeze_after_inventory_correction(shared_root: Path, state_root: Path) -> None:
    """Finish the pre-development freeze without repeating the June screen."""
    shared, state = guard_roots(shared_root, state_root)
    required = (
        "preseal.v1.json",
        "SCREEN_CONSUMED.v1.json",
        "universe.v1.json",
    )
    if any(not (PACKET_DIR / name).is_file() for name in required):
        raise SealError("resume requires the preserved preseal, screen marker, and universe")
    if (
        (PACKET_DIR / "freeze.v1.json").exists()
        or (PACKET_DIR / "source_manifest.v1.json").exists()
        or (PACKET_DIR / "RUN_CONSUMED.v1.json").exists()
    ):
        raise SealError("resume boundary is no longer available")
    if not state.is_dir():
        raise SealError("preserved external state is absent")
    preseal = read_json(PACKET_DIR / "preseal.v1.json")
    bound = preseal.get("bound_files")
    if not isinstance(bound, dict):
        raise SealError("original preseal bound files are absent")
    original_bound = cast(dict[str, object], bound)
    for unchanged in ("OFFICIAL_SOURCE_RESEARCH.md", "protocol.v1.json"):
        expected = original_bound.get(unchanged)
        if not isinstance(expected, str) or sha256_path(PACKET_DIR / unchanged) != expected:
            raise SealError(f"preseal correction cannot change {unchanged}")
    correction = {
        "corrected_bound_files": {
            "experiment.py": sha256_path(PACKET_DIR / "experiment.py"),
            "test_experiment.py": sha256_path(PACKET_DIR / "test_experiment.py"),
        },
        "created_at": utc_now(),
        "declarations": {
            "development_archive_members_decompressed": 0,
            "holdout_payload_hashes": 0,
            "holdout_payload_opens": 0,
            "holdout_payload_reads": 0,
            "june_screen_repeated": False,
            "selected_symbols_changed": False,
        },
        "exact_trigger": {
            "path": ("data/futures/um/monthly/fundingRate/FUNUSDT/FUNUSDT-fundingRate-2026-05.zip"),
            "reason": "ZIP_OR_ADJACENT_PUBLISHER_CHECKSUM_MISSING",
        },
        "original_bound_files": {
            "experiment.py": original_bound["experiment.py"],
            "test_experiment.py": original_bound["test_experiment.py"],
        },
        "original_preseal_sha256": sha256_path(PACKET_DIR / "preseal.v1.json"),
        "policy": (
            "PRE_OUTCOME_SOURCE_AVAILABILITY_CORRECTION; MISSING FUNDING "
            "INVALIDATES THE COMPLETE MONTH; NO SYMBOL SUBSTITUTION"
        ),
        "protocol_sha256_unchanged": sha256_path(PACKET_DIR / "protocol.v1.json"),
        "schema": "cosmos.s1q.preseal_correction.v1",
        "source_note_sha256_unchanged": sha256_path(PACKET_DIR / "OFFICIAL_SOURCE_RESEARCH.md"),
        "universe_sha256_unchanged": sha256_path(PACKET_DIR / "universe.v1.json"),
    }
    create_once(PACKET_DIR / "PRESEAL_CORRECTION.v1.json", correction)
    create_once(
        state / "PRESEAL_CORRECTION.v1.json",
        {
            "packet_correction_sha256": sha256_path(PACKET_DIR / "PRESEAL_CORRECTION.v1.json"),
            "schema": "cosmos.s1q.external_preseal_correction_pointer.v1",
        },
    )
    universe = read_json(PACKET_DIR / "universe.v1.json")
    selected = read_symbols(universe)
    manifest = build_source_manifest(shared, selected)
    create_once(PACKET_DIR / "source_manifest.v1.json", manifest)
    hashes = bound_file_hashes()
    hashes["universe.v1.json"] = sha256_path(PACKET_DIR / "universe.v1.json")
    hashes["source_manifest.v1.json"] = sha256_path(PACKET_DIR / "source_manifest.v1.json")
    hashes["preseal.v1.json"] = sha256_path(PACKET_DIR / "preseal.v1.json")
    hashes["SCREEN_CONSUMED.v1.json"] = sha256_path(PACKET_DIR / "SCREEN_CONSUMED.v1.json")
    hashes["PRESEAL_CORRECTION.v1.json"] = sha256_path(PACKET_DIR / "PRESEAL_CORRECTION.v1.json")
    frozen = {
        "base_commit": BASE_COMMIT,
        "bound_files": hashes,
        "correction_status": "TRANSPARENT_PRE_OUTCOME_SOURCE_AVAILABILITY_CORRECTION",
        "created_at": utc_now(),
        "development_archive_bodies_opened": 0,
        "holdout_archive_bodies_opened": 0,
        "holdout_payload_hashes": 0,
        "publisher_checksum_count": manifest["publisher_checksum_count"],
        "schema": "cosmos.s1q.freeze.v1",
        "selected_symbols": list(selected),
        "shared_archive_policy": "READ_ONLY",
        "unavailable_cell_count": manifest["unavailable_cell_count"],
    }
    create_once(PACKET_DIR / "freeze.v1.json", frozen)
    create_once(
        state / "FREEZE.v1.json",
        {
            "packet_freeze_sha256": sha256_path(PACKET_DIR / "freeze.v1.json"),
            "schema": "cosmos.s1q.external_freeze_pointer.v1",
        },
    )


def verify_freeze() -> tuple[dict[str, object], dict[str, object]]:
    frozen = read_json(PACKET_DIR / "freeze.v1.json")
    bound = frozen.get("bound_files")
    if not isinstance(bound, dict):
        raise SealError("freeze bound_files missing")
    for name, expected in cast(dict[str, object], bound).items():
        if not isinstance(expected, str) or sha256_path(PACKET_DIR / name) != expected:
            raise SealError(f"frozen input changed: {name}")
    universe = read_json(PACKET_DIR / "universe.v1.json")
    manifest = read_json(PACKET_DIR / "source_manifest.v1.json")
    return universe, manifest


def manifest_index(
    manifest: Mapping[str, object],
) -> dict[tuple[str, str, str], str | None]:
    raw_records = manifest.get("records")
    if not isinstance(raw_records, list):
        raise SealError("source manifest records missing")
    index: dict[tuple[str, str, str], str | None] = {}
    for raw in raw_records:
        if not isinstance(raw, dict):
            raise SealError("invalid source record")
        record = cast(dict[str, object], raw)
        key = (
            cast(str, record["dataset"]),
            cast(str, record["symbol"]),
            cast(str, record["month"]),
        )
        if key in index:
            raise SealError("duplicate source record")
        if record.get("availability") == "UNAVAILABLE":
            index[key] = None
        else:
            index[key] = cast(str, record["publisher_sha256"])
    return index


def validate_manifest_cell(
    root: Path,
    index: Mapping[tuple[str, str, str], str | None],
    dataset: str,
    symbol: str,
    month: str,
) -> Path | None:
    path = archive_path(root, dataset, symbol, month)
    key = (dataset, symbol, month)
    if key not in index:
        raise SealError(f"source cell absent from frozen manifest: {path}")
    expected = index[key]
    if expected is None:
        return None
    if sha256_path(path) != expected:
        raise CustodyError(f"source cell differs from frozen manifest: {path}")
    return path


def merge_unique_funding(chunks: Iterable[Sequence[FundingRow]]) -> tuple[FundingRow, ...]:
    rows = sorted(itertools.chain.from_iterable(chunks), key=lambda item: item.time_ms)
    if any(left.time_ms >= right.time_ms for left, right in itertools.pairwise(rows)):
        raise CustodyError("duplicate or out-of-order funding across months")
    return tuple(rows)


def merge_unique_klines(chunks: Iterable[Sequence[KlineRow]]) -> dict[int, KlineRow]:
    result: dict[int, KlineRow] = {}
    for row in itertools.chain.from_iterable(chunks):
        if row.open_time_ms in result:
            raise CustodyError("duplicate kline across months")
        result[row.open_time_ms] = row
    return result


def load_market_data(
    root: Path,
    index: Mapping[tuple[str, str, str], str | None],
    symbols: Sequence[str],
    months: Sequence[str],
) -> MarketData:
    funding: dict[str, tuple[FundingRow, ...]] = {}
    contract: dict[str, dict[int, KlineRow]] = {}
    mark: dict[str, dict[int, KlineRow]] = {}
    daily_quote: dict[str, dict[int, Decimal]] = {}
    unmeasured_funding_months: set[str] = set()
    for symbol in symbols:
        funding_chunks: list[tuple[FundingRow, ...]] = []
        contract_chunks: list[tuple[KlineRow, ...]] = []
        mark_chunks: list[tuple[KlineRow, ...]] = []
        for month in months:
            funding_path = validate_manifest_cell(root, index, "fundingRate", symbol, month)
            if funding_path is None:
                unmeasured_funding_months.add(month)
            else:
                funding_chunks.append(read_funding_archive(funding_path, month))
            contract_path = validate_manifest_cell(root, index, "klines_1h", symbol, month)
            if contract_path is not None:
                contract_chunks.append(read_kline_archive(contract_path, month))
            mark_path = validate_manifest_cell(root, index, "markPriceKlines_1h", symbol, month)
            if mark_path is not None:
                mark_chunks.append(read_kline_archive(mark_path, month))
        funding[symbol] = merge_unique_funding(funding_chunks)
        contract[symbol] = merge_unique_klines(contract_chunks)
        mark[symbol] = merge_unique_klines(mark_chunks)
        quote: dict[int, Decimal] = defaultdict(Decimal)
        for row in contract[symbol].values():
            quote[day_start_ms(row.open_time_ms)] += row.quote_volume
        daily_quote[symbol] = dict(quote)
    return MarketData(
        funding,
        contract,
        mark,
        daily_quote,
        frozenset(unmeasured_funding_months),
    )


def funding_flips(market: MarketData, start_ms: int, end_ms: int) -> dict[int, tuple[Flip, ...]]:
    by_time: dict[int, list[Flip]] = defaultdict(list)
    for symbol, rows in market.funding.items():
        for previous, current in itertools.pairwise(rows):
            if not start_ms <= current.time_ms < end_ms:
                continue
            event_month = datetime.fromtimestamp(current.time_ms / 1000, tz=UTC).strftime("%Y-%m")
            if event_month in market.unmeasured_funding_months:
                continue
            if (
                previous.rate == 0
                or current.rate == 0
                or previous.interval_hours != current.interval_hours
                or current.time_ms - previous.time_ms != current.interval_hours * HOUR_MS
            ):
                continue
            side = 0
            if previous.rate > 0 > current.rate:
                side = 1
            elif previous.rate < 0 < current.rate:
                side = -1
            if side == 0:
                continue
            shock = (
                abs(current.rate - previous.rate)
                * Decimal(10_000)
                * Decimal(8)
                / Decimal(current.interval_hours)
            )
            by_time[current.time_ms].append(Flip(symbol, current.time_ms, side, shock))
    return {
        time_ms: tuple(sorted(flips, key=lambda item: item.symbol))
        for time_ms, flips in by_time.items()
    }


def position_cost(notional: Decimal, fee_bps: Decimal, adverse_bps: Decimal) -> Decimal:
    return notional * (fee_bps + adverse_bps) / Decimal(10_000) * Decimal(2)


def position_for(
    market: MarketData,
    flip: Flip,
    entry_ms: int,
    exit_ms: int,
    assigned_usd: Decimal,
) -> Position | None:
    contract = market.contract[flip.symbol]
    entry = contract.get(entry_ms)
    exit_row = contract.get(exit_ms)
    if entry is None or exit_row is None:
        return None
    quantity = assigned_usd / entry.open_price
    price_pnl = quantity * Decimal(flip.side) * (exit_row.open_price - entry.open_price)
    funding_pnl = Decimal(0)
    for funding in market.funding[flip.symbol]:
        if not entry_ms < funding.time_ms < exit_ms:
            continue
        mark = market.mark[flip.symbol].get(funding.time_ms)
        if mark is None:
            return None
        funding_pnl += -Decimal(flip.side) * quantity * mark.open_price * funding.rate
    prior_day = day_start_ms(entry_ms) - DAY_MS
    prior_quote = market.daily_quote[flip.symbol].get(prior_day)
    if prior_quote is None:
        return None
    capacity = prior_quote * CAPACITY_PARTICIPATION
    gross = price_pnl + funding_pnl
    return Position(
        symbol=flip.symbol,
        side=flip.side,
        entry_ms=entry_ms,
        exit_ms=exit_ms,
        assigned_usd=assigned_usd,
        price_pnl=price_pnl,
        funding_pnl=funding_pnl,
        base_net=gross - position_cost(assigned_usd, Decimal("5"), Decimal("2")),
        stress_net=gross - position_cost(assigned_usd, Decimal("8"), Decimal("5")),
        severe_net=gross - position_cost(assigned_usd, Decimal("10"), Decimal("10")),
        capacity_usd=capacity,
    )


def evaluate_trial(
    market: MarketData,
    flips: Mapping[int, Sequence[Flip]],
    trial: Trial,
) -> tuple[Cohort, ...]:
    accepted: list[Cohort] = []
    unavailable_until = -1
    for event_ms in sorted(flips):
        selected = [item for item in flips[event_ms] if item.shock_bps >= trial.threshold_bps]
        longs = [item for item in selected if item.side == 1]
        shorts = [item for item in selected if item.side == -1]
        if len(longs) < 2 or len(shorts) < 2:
            continue
        entry_ms = event_ms + HOUR_MS
        exit_ms = entry_ms + trial.hold_hours * HOUR_MS
        if entry_ms < unavailable_until:
            continue
        long_usd = SIDE_NOTIONAL / Decimal(len(longs))
        short_usd = SIDE_NOTIONAL / Decimal(len(shorts))
        positions: list[Position] = []
        valid = True
        for flip in (*longs, *shorts):
            assigned = long_usd if flip.side == 1 else short_usd
            position = position_for(market, flip, entry_ms, exit_ms, assigned)
            if position is None:
                valid = False
                break
            positions.append(position)
        if not valid:
            continue
        accepted.append(Cohort(event_ms, entry_ms, exit_ms, tuple(positions)))
        unavailable_until = exit_ms
    return tuple(accepted)


def date_range(start_ms: int, end_ms: int) -> tuple[int, ...]:
    return tuple(range(day_start_ms(start_ms), day_start_ms(end_ms), DAY_MS))


def daily_values(cohorts: Sequence[Cohort], days: Sequence[int], field: str) -> tuple[Decimal, ...]:
    by_day: dict[int, Decimal] = defaultdict(Decimal)
    for cohort in cohorts:
        by_day[day_start_ms(cohort.exit_ms)] += cast(Decimal, getattr(cohort, field))
    return tuple(by_day.get(day, Decimal(0)) for day in days)


def maximum_drawdown(values: Sequence[Decimal]) -> Decimal:
    wealth = CAPITAL
    peak = CAPITAL
    maximum = Decimal(0)
    for value in values:
        wealth += value
        peak = max(peak, wealth)
        maximum = max(maximum, peak - wealth)
    return maximum


def active_weeks(cohorts: Sequence[Cohort]) -> int:
    return len(
        {
            datetime.fromtimestamp(cohort.exit_ms / 1000, tz=UTC).date().isocalendar()[:2]
            for cohort in cohorts
        }
    )


def unique_symbols(cohorts: Sequence[Cohort], side: int) -> set[str]:
    return {
        position.symbol
        for cohort in cohorts
        for position in cohort.positions
        if position.side == side
    }


def leave_best_stress(cohorts: Sequence[Cohort]) -> tuple[Decimal, Decimal]:
    total = sum((cohort.stress_net for cohort in cohorts), Decimal(0))
    by_symbol: dict[str, Decimal] = defaultdict(Decimal)
    by_month: dict[str, Decimal] = defaultdict(Decimal)
    for cohort in cohorts:
        month = datetime.fromtimestamp(cohort.exit_ms / 1000, tz=UTC).strftime("%Y-%m")
        by_month[month] += cohort.stress_net
        for position in cohort.positions:
            by_symbol[position.symbol] += position.stress_net
    best_symbol = max(by_symbol.values(), default=Decimal(0))
    best_month = max(by_month.values(), default=Decimal(0))
    return total - best_symbol, total - best_month


def capacity_pass(cohorts: Sequence[Cohort]) -> bool:
    return all(
        position.assigned_usd <= position.capacity_usd
        for cohort in cohorts
        for position in cohort.positions
    )


def bootstrap_indices(
    length: int, replicates: int, seed: int, block: int = 7
) -> tuple[tuple[int, ...], ...]:
    if length <= 0 or block <= 0:
        raise ValueError("bootstrap dimensions must be positive")
    generator = random.Random(seed)
    paths: list[tuple[int, ...]] = []
    for _ in range(replicates):
        path: list[int] = []
        while len(path) < length:
            start = generator.randrange(length)
            path.extend((start + offset) % length for offset in range(block))
        paths.append(tuple(path[:length]))
    return tuple(paths)


def quantile(values: Sequence[Decimal], probability: Decimal) -> Decimal:
    if not values:
        raise ValueError("quantile requires values")
    ordered = sorted(values)
    position = int(
        (probability * Decimal(len(ordered) - 1)).to_integral_value(rounding="ROUND_FLOOR")
    )
    return ordered[position]


def bootstrap_statistics(
    vectors: Mapping[str, Sequence[Decimal]],
) -> tuple[dict[str, dict[str, Decimal]], Decimal]:
    if not vectors:
        raise ValueError("vectors required")
    length = len(next(iter(vectors.values())))
    if any(len(vector) != length for vector in vectors.values()):
        raise ValueError("synchronous vectors required")
    paths = bootstrap_indices(length, BOOTSTRAP_REPLICATES, BOOTSTRAP_SEED)
    means = {
        trial_id: sum(vector, Decimal(0)) / Decimal(length) for trial_id, vector in vectors.items()
    }
    centered = {
        trial_id: tuple(value - means[trial_id] for value in vector)
        for trial_id, vector in vectors.items()
    }
    result: dict[str, dict[str, Decimal]] = {}
    observed_max = max(means.values())
    reality_exceed = 0
    centered_maxima: list[Decimal] = []
    for path in paths:
        centered_means = [
            sum((centered[trial_id][index] for index in path), Decimal(0)) / Decimal(length)
            for trial_id in sorted(vectors)
        ]
        centered_max = max(centered_means)
        centered_maxima.append(centered_max)
        if centered_max >= observed_max:
            reality_exceed += 1
    for trial_id, vector in vectors.items():
        boot_means = [
            sum((vector[index] for index in path), Decimal(0)) / Decimal(length) for path in paths
        ]
        centered_means = [
            sum((centered[trial_id][index] for index in path), Decimal(0)) / Decimal(length)
            for path in paths
        ]
        family_alpha = ALPHA / Decimal(len(vectors))
        upper = quantile(boot_means, Decimal(1) - family_alpha)
        lower = Decimal(2) * means[trial_id] - upper
        exceed = sum(value >= means[trial_id] for value in centered_means)
        p_value = Decimal(exceed + 1) / Decimal(len(paths) + 1)
        result[trial_id] = {
            "familywise_lcb": lower,
            "mean": means[trial_id],
            "raw_p": p_value,
        }
    reality_p = Decimal(reality_exceed + 1) / Decimal(len(paths) + 1)
    return result, reality_p


def holm_adjust(raw: Mapping[str, Decimal]) -> dict[str, Decimal]:
    ordered = sorted(raw.items(), key=lambda item: (item[1], item[0]))
    adjusted: dict[str, Decimal] = {}
    running = Decimal(0)
    total = len(ordered)
    for index, (trial_id, value) in enumerate(ordered):
        candidate = min(Decimal(1), value * Decimal(total - index))
        running = max(running, candidate)
        adjusted[trial_id] = running
    return adjusted


def split_blocks(length: int, count: int) -> tuple[tuple[int, ...], ...]:
    if length < count:
        raise ValueError("not enough observations for blocks")
    return tuple(
        tuple(range(length * index // count, length * (index + 1) // count))
        for index in range(count)
    )


def cscv_pbo(vectors: Mapping[str, Sequence[Decimal]]) -> tuple[Decimal, int]:
    trial_ids = tuple(sorted(vectors))
    length = len(next(iter(vectors.values())))
    blocks = split_blocks(length, 12)
    underperform = 0
    cells = 0
    all_blocks = set(range(12))
    for selected_blocks in itertools.combinations(range(12), 6):
        selected = set(selected_blocks)
        train_indices = tuple(index for block in sorted(selected) for index in blocks[block])
        test_indices = tuple(
            index for block in sorted(all_blocks - selected) for index in blocks[block]
        )
        train_scores = {
            trial_id: sum((vectors[trial_id][index] for index in train_indices), Decimal(0))
            for trial_id in trial_ids
        }
        champion = min(trial_ids, key=lambda trial_id: (-train_scores[trial_id], trial_id))
        test_scores = sorted(
            sum((vectors[trial_id][index] for index in test_indices), Decimal(0))
            for trial_id in trial_ids
        )
        champion_score = sum((vectors[champion][index] for index in test_indices), Decimal(0))
        median = statistics.median(test_scores)
        if champion_score <= median:
            underperform += 1
        cells += 1
    return Decimal(underperform) / Decimal(cells), cells


def trial_summary(
    trial: Trial,
    cohorts: Sequence[Cohort],
    days: Sequence[int],
    bootstrap: Mapping[str, Decimal],
    holm_p: Decimal,
) -> dict[str, object]:
    stress_daily = daily_values(cohorts, days, "stress_net")
    leave_symbol, leave_month = leave_best_stress(cohorts)
    return {
        "active_iso_weeks": active_weeks(cohorts),
        "base_total_usd": str(sum((item.base_net for item in cohorts), Decimal(0))),
        "capacity_proxy_pass": capacity_pass(cohorts),
        "cohort_count": len(cohorts),
        "familywise_bootstrap_lcb_usd_per_day": str(bootstrap["familywise_lcb"]),
        "hold_hours": trial.hold_hours,
        "holm_adjusted_p": str(holm_p),
        "leave_best_month_stress_total_usd": str(leave_month),
        "leave_best_symbol_stress_total_usd": str(leave_symbol),
        "severe_total_usd": str(sum((item.severe_net for item in cohorts), Decimal(0))),
        "shock_threshold_bps_8h": str(trial.threshold_bps),
        "stress_maximum_drawdown_usd": str(maximum_drawdown(stress_daily)),
        "stress_mean_usd_per_day": str(sum(stress_daily, Decimal(0)) / Decimal(len(stress_daily))),
        "stress_total_usd": str(sum((item.stress_net for item in cohorts), Decimal(0))),
        "trial_id": trial.trial_id,
        "unique_long_symbols": len(unique_symbols(cohorts, 1)),
        "unique_short_symbols": len(unique_symbols(cohorts, -1)),
    }


def development_gate_map(
    summary: Mapping[str, object], pbo: Decimal, cells: int, reality_p: Decimal
) -> dict[str, bool]:
    return {
        "capacity_proxy": summary["capacity_proxy_pass"] is True,
        "cscv_924_cells": cells == 924,
        "familywise_bootstrap_lcb_positive": Decimal(
            cast(str, summary["familywise_bootstrap_lcb_usd_per_day"])
        )
        > 0,
        "holm_adjusted_p_lte_0_05": Decimal(cast(str, summary["holm_adjusted_p"])) <= ALPHA,
        "leave_best_month_positive": Decimal(
            cast(str, summary["leave_best_month_stress_total_usd"])
        )
        > 0,
        "leave_best_symbol_positive": Decimal(
            cast(str, summary["leave_best_symbol_stress_total_usd"])
        )
        > 0,
        "minimum_12_unique_long_symbols": cast(int, summary["unique_long_symbols"]) >= 12,
        "minimum_12_unique_short_symbols": cast(int, summary["unique_short_symbols"]) >= 12,
        "minimum_20_active_weeks": cast(int, summary["active_iso_weeks"]) >= 20,
        "minimum_60_primary_cohorts": cast(int, summary["cohort_count"]) >= 60,
        "pbo_lte_0_50": pbo <= Decimal("0.50"),
        "reality_check_p_lte_0_05": reality_p <= ALPHA,
        "stress_maximum_drawdown_lte_100_usd": Decimal(
            cast(str, summary["stress_maximum_drawdown_usd"])
        )
        <= Decimal("100"),
    }


def structural_gate_map() -> dict[str, bool]:
    """Unknown non-proxy truths block holdout admission and public-only GO."""
    return {
        "account_effective_fees_known": False,
        "archive_regular_rate_type_known": False,
        "executable_capacity_depth_spread_filters_fills_known": False,
        "publication_causality_known": False,
    }


def holdout_gate_map(summary: Mapping[str, object]) -> dict[str, bool]:
    return {
        "capacity_proxy": summary["capacity_proxy_pass"] is True,
        "leave_best_month_positive": Decimal(
            cast(str, summary["leave_best_month_stress_total_usd"])
        )
        > 0,
        "leave_best_symbol_positive": Decimal(
            cast(str, summary["leave_best_symbol_stress_total_usd"])
        )
        > 0,
        "minimum_20_primary_cohorts": cast(int, summary["cohort_count"]) >= 20,
        "minimum_8_active_weeks": cast(int, summary["active_iso_weeks"]) >= 8,
        "minimum_8_unique_long_symbols": cast(int, summary["unique_long_symbols"]) >= 8,
        "minimum_8_unique_short_symbols": cast(int, summary["unique_short_symbols"]) >= 8,
        "stress_bootstrap_lcb_positive": Decimal(
            cast(str, summary["familywise_bootstrap_lcb_usd_per_day"])
        )
        > 0,
        "stress_maximum_drawdown_lte_100_usd": Decimal(
            cast(str, summary["stress_maximum_drawdown_usd"])
        )
        <= Decimal("100"),
        "stress_total_positive": Decimal(cast(str, summary["stress_total_usd"])) > 0,
    }


def read_symbols(universe: Mapping[str, object]) -> tuple[str, ...]:
    raw = universe.get("selected_symbols")
    if (
        not isinstance(raw, list)
        or len(raw) != 40
        or any(not isinstance(value, str) for value in raw)
    ):
        raise SealError("frozen universe is invalid")
    symbols = tuple(cast(str, value) for value in raw)
    if len(set(symbols)) != 40:
        raise SealError("frozen universe has duplicates")
    return symbols


def development_ledger_value(
    cohorts: Mapping[str, Sequence[Cohort]],
) -> dict[str, object]:
    trials: list[dict[str, object]] = []
    for trial_id in sorted(cohorts):
        rows: list[dict[str, object]] = []
        for cohort in cohorts[trial_id]:
            rows.append(
                {
                    "base_net_usd": str(cohort.base_net),
                    "event_time": iso_ms(cohort.event_ms),
                    "exit_time": iso_ms(cohort.exit_ms),
                    "positions": [
                        {
                            "assigned_usd": str(position.assigned_usd),
                            "base_net_usd": str(position.base_net),
                            "capacity_usd_at_1bp": str(position.capacity_usd),
                            "funding_pnl_usd": str(position.funding_pnl),
                            "price_pnl_usd": str(position.price_pnl),
                            "severe_net_usd": str(position.severe_net),
                            "side": "LONG" if position.side == 1 else "SHORT",
                            "stress_net_usd": str(position.stress_net),
                            "symbol": position.symbol,
                        }
                        for position in cohort.positions
                    ],
                    "severe_net_usd": str(cohort.severe_net),
                    "stress_net_usd": str(cohort.stress_net),
                }
            )
        trials.append({"cohorts": rows, "trial_id": trial_id})
    return {
        "schema": "cosmos.s1q.development_ledger.v1",
        "trial_family_digest": trial_family_digest(),
        "trials": trials,
    }


def run(shared_root: Path, state_root: Path) -> None:
    shared, state = guard_roots(shared_root, state_root)
    universe, manifest = verify_freeze()
    symbols = read_symbols(universe)
    index = manifest_index(manifest)
    if not state.is_dir():
        raise SealError("external freeze state is absent")
    if (PACKET_DIR / "RUN_CONSUMED.v1.json").exists():
        raise SealError("sealed run already consumed")
    freeze_sha256 = sha256_path(PACKET_DIR / "freeze.v1.json")
    frozen = read_json(PACKET_DIR / "freeze.v1.json")
    frozen_bound_files = frozen.get("bound_files")
    if not isinstance(frozen_bound_files, dict):
        raise SealError("freeze bound files are unavailable")
    protocol = read_json(PACKET_DIR / "protocol.v1.json")
    cost_digest = sha256_bytes(canonical_json_bytes(protocol["economics"]))
    gates_digest = sha256_bytes(
        canonical_json_bytes(
            {
                "development": protocol["development_gates"],
                "holdout": protocol["holdout_gates"],
                "verdict": protocol["verdict_law"],
            }
        )
    )
    marker = {
        "bootstrap_seed": BOOTSTRAP_SEED,
        "costs_digest": cost_digest,
        "created_at": utc_now(),
        "failure_policy": "RUN_REMAINS_CONSUMED",
        "freeze_bound_files_digest": sha256_bytes(canonical_json_bytes(frozen_bound_files)),
        "freeze_sha256": freeze_sha256,
        "gates_digest": gates_digest,
        "policy": "CREATED_BEFORE_FIRST_DEVELOPMENT_ARCHIVE_MEMBER_DECOMPRESSION",
        "protocol_authority_digest": protocol_authority_digest(),
        "schema": "cosmos.s1q.run_consumed.v1",
        "source_manifest_sha256": sha256_path(PACKET_DIR / "source_manifest.v1.json"),
        "transitive_binding": (
            "freeze_sha256 binds protocol, evaluator, tests, official source note, "
            "preseal, June receipt, universe, and source manifest"
        ),
        "trial_family_digest": trial_family_digest(),
        "universe_sha256": sha256_path(PACKET_DIR / "universe.v1.json"),
    }
    create_once(PACKET_DIR / "RUN_CONSUMED.v1.json", marker)
    create_once(state / "RUN_CONSUMED.v1.json", marker)
    try:
        market = load_market_data(shared, index, symbols, DEV_MONTHS)
        flips = funding_flips(market, DEV_START_MS, DEV_END_MS)
        trials = trial_family()
        cohorts = {trial.trial_id: evaluate_trial(market, flips, trial) for trial in trials}
        days = date_range(DEV_START_MS, DEV_END_MS)
        vectors = {
            trial.trial_id: daily_values(cohorts[trial.trial_id], days, "stress_net")
            for trial in trials
        }
        bootstrap, reality_p = bootstrap_statistics(vectors)
        holm = holm_adjust({trial_id: values["raw_p"] for trial_id, values in bootstrap.items()})
        pbo, cells = cscv_pbo(vectors)
        summaries = [
            trial_summary(
                trial,
                cohorts[trial.trial_id],
                days,
                bootstrap[trial.trial_id],
                holm[trial.trial_id],
            )
            for trial in trials
        ]
        primary = next(item for item in summaries if item["trial_id"] == primary_trial().trial_id)
        measured_gates = development_gate_map(primary, pbo, cells, reality_p)
        structural_gates = structural_gate_map()
        proxy_pass = all(measured_gates.values())
        dev_admission = proxy_pass and all(structural_gates.values())
        ledger = development_ledger_value(cohorts)
        create_once(PACKET_DIR / "development_ledger.v1.json", ledger)
        ledger_sha256 = sha256_path(PACKET_DIR / "development_ledger.v1.json")
        development_metrics = {
            "cscv_cells": cells,
            "measured_proxy_gates": measured_gates,
            "pbo": str(pbo),
            "primary": primary,
            "proxy_gate_pass": proxy_pass,
            "reality_check_p": str(reality_p),
            "structural_gates": structural_gates,
            "trials": summaries,
        }
        development_metrics_digest = sha256_bytes(canonical_json_bytes(development_metrics))
        holdout_opened = False
        holdout_summary: dict[str, object] | None = None
        holdout_gates: dict[str, bool] | None = None
        if dev_admission:
            seal = {
                "created_at": utc_now(),
                "development_ledger_sha256": ledger_sha256,
                "development_metrics_digest": development_metrics_digest,
                "freeze_sha256": freeze_sha256,
                "measured_development_gates": measured_gates,
                "primary_trial_id": primary_trial().trial_id,
                "schema": "cosmos.s1q.candidate_seal.v1",
                "structural_development_gates": structural_gates,
            }
            create_once(PACKET_DIR / "candidate_seal.v1.json", seal)
            create_once(state / "candidate_seal.v1.json", seal)
            open_marker = {
                "candidate_seal_sha256": sha256_path(PACKET_DIR / "candidate_seal.v1.json"),
                "created_at": utc_now(),
                "freeze_sha256": freeze_sha256,
                "policy": "CREATED_BEFORE_FIRST_HOLDOUT_MEMBER_DECOMPRESSION",
                "schema": "cosmos.s1q.holdout_open.v1",
            }
            create_once(PACKET_DIR / "HOLDOUT_OPEN.v1.json", open_marker)
            create_once(state / "HOLDOUT_OPEN.v1.json", open_marker)
            holdout_opened = True
            holdout_market = load_market_data(shared, index, symbols, ("2026-03", *HOLDOUT_MONTHS))
            holdout_flips = funding_flips(holdout_market, HOLDOUT_START_MS, HOLDOUT_END_MS)
            holdout_cohorts = evaluate_trial(holdout_market, holdout_flips, primary_trial())
            holdout_days = date_range(HOLDOUT_START_MS, HOLDOUT_END_MS)
            holdout_vector = {
                primary_trial().trial_id: daily_values(holdout_cohorts, holdout_days, "stress_net")
            }
            holdout_bootstrap, _ = bootstrap_statistics(holdout_vector)
            holdout_summary = trial_summary(
                primary_trial(),
                holdout_cohorts,
                holdout_days,
                holdout_bootstrap[primary_trial().trial_id],
                Decimal(1),
            )
            holdout_gates = holdout_gate_map(holdout_summary)
        result = {
            "authority": {
                "account_effective_fees": "UNKNOWN",
                "capital": "NONE",
                "capital_disposition": "NO_GO",
                "executable_capacity": "UNKNOWN",
                "orders": "NONE",
                "publication_causality": "UNKNOWN",
                "rate_type_causality": "UNKNOWN",
            },
            "base_commit": BASE_COMMIT,
            "created_at": utc_now(),
            "development": {
                "admission_pass": dev_admission,
                "cscv_cells": cells,
                "development_ledger_sha256": ledger_sha256,
                "development_metrics_digest": development_metrics_digest,
                "measured_proxy_gates": measured_gates,
                "pbo": str(pbo),
                "primary": primary,
                "proxy_gate_pass": proxy_pass,
                "reality_check_p": str(reality_p),
                "structural_gates": structural_gates,
                "trials": summaries,
            },
            "holdout": {
                "gates": holdout_gates,
                "opened": holdout_opened,
                "status": "OPENED_ONCE" if holdout_opened else "UNTOUCHED",
                "summary": holdout_summary,
            },
            "limitations": [
                (
                    "Archive funding rows omit REST rateType and markPrice; "
                    "Regular classification is UNKNOWN."
                ),
                (
                    "Binance does not document a historical publication-latency "
                    "bound for this use; publication causality is UNKNOWN."
                ),
                "Kline and mark opens are price proxies, not fills.",
                "Public fees are sensitivities; account-effective fees are UNKNOWN.",
                (
                    "Prior-day quote volume is a capacity proxy; executable "
                    "capacity, depth, spread, filters, latency, and fills are UNKNOWN."
                ),
            ],
            "proxy_gate_verdict": "PASS" if proxy_pass else "FAIL",
            "research_verdict": "UNMEASURED" if proxy_pass else "NO_GO",
            "schema": "cosmos.s1q.result.v1",
            "source": {
                "publisher_checksum_count": manifest["publisher_checksum_count"],
                "public_only": True,
                "selected_symbol_count": len(symbols),
                "shared_archive_policy": "READ_ONLY",
            },
        }
        create_once(PACKET_DIR / "result.v1.json", result)
        create_once(
            state / "RESULT_POINTER.v1.json",
            {
                "packet_result_sha256": sha256_path(PACKET_DIR / "result.v1.json"),
                "schema": "cosmos.s1q.external_result_pointer.v1",
            },
        )
    except Exception as error:
        failure = {
            "error": f"{type(error).__name__}: {error}",
            "failed_at": utc_now(),
            "holdout_status": "UNTOUCHED"
            if not (PACKET_DIR / "HOLDOUT_OPEN.v1.json").exists()
            else "OPEN_MARKER_EXISTS",
            "research_verdict": "UNMEASURED",
            "run_remains_consumed": True,
            "schema": "cosmos.s1q.failure.v1",
        }
        create_once(PACKET_DIR / "failure.v1.json", failure)
        raise


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    for command in ("freeze", "resume-freeze", "run"):
        child = subparsers.add_parser(command)
        child.add_argument("--shared-root", type=Path, required=True)
        child.add_argument("--state-root", type=Path, required=True)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    arguments = parse_args(sys.argv[1:] if argv is None else argv)
    if arguments.command == "freeze":
        freeze(arguments.shared_root, arguments.state_root)
    elif arguments.command == "resume-freeze":
        resume_freeze_after_inventory_correction(arguments.shared_root, arguments.state_root)
    elif arguments.command == "run":
        run(arguments.shared_root, arguments.state_root)
    else:
        raise AssertionError("argparse accepted an unknown command")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
