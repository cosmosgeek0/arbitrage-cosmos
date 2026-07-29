#!/usr/bin/env python3
"""Sealed public-only S-1Y pair-residual mean-reversion evaluator.

The evaluator is intentionally standard-library only. ``freeze`` binds source
custody without opening an archive member. ``run`` consumes the single run
before opening development data and cannot be repeated. Holdout ZIP payloads
remain unread and unhashed unless every frozen development gate passes.
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
import sys
import urllib.request
import zipfile
from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, getcontext
from pathlib import Path
from typing import Final, cast

getcontext().prec = 50

PACKET_DIR: Final = Path(__file__).resolve().parent
UTC: Final = timezone.utc
EXPECTED_SHARED_ROOT: Final = Path("/private/tmp/cosmos-s1d-funding-dispersion-v1/raw")
BASE_COMMIT: Final = "a169b123fb186d1943a75ad648552c4d95be1be1"
EXCHANGE_INFO_URL: Final = "https://fapi.binance.com/fapi/v1/exchangeInfo"
HOUR_MS: Final = 3_600_000
DAY_MS: Final = 86_400_000
MAX_ZIP_BYTES: Final = 256 * 1024 * 1024
MAX_MEMBER_BYTES: Final = 512 * 1024 * 1024
MAX_SIDECAR_BYTES: Final = 4096
CAPITAL: Final = 1000.0
CAPACITY_PARTICIPATION: Final = 0.0001
BOOTSTRAP_REPLICATES: Final = 4096
BOOTSTRAP_SEED: Final = 2026073005
ALPHA: Final = 0.05
DEV_START_MS: Final = int(datetime(2025, 7, 1, tzinfo=UTC).timestamp() * 1000)
DEV_END_MS: Final = int(datetime(2026, 3, 1, tzinfo=UTC).timestamp() * 1000)
HOLDOUT_START_MS: Final = int(datetime(2026, 3, 8, tzinfo=UTC).timestamp() * 1000)
HOLDOUT_END_MS: Final = int(datetime(2026, 7, 1, tzinfo=UTC).timestamp() * 1000)
DATA_START_MS: Final = int(datetime(2025, 5, 1, tzinfo=UTC).timestamp() * 1000)
ALL_MONTHS: Final = (
    "2025-05",
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
NON_HOLDOUT_MONTHS: Final = ALL_MONTHS[:10]
DEFERRED_MONTHS: Final = ALL_MONTHS[10:]
PAIRS: Final = (
    ("BTCUSDT", "ETHUSDT"),
    ("SOLUSDT", "AVAXUSDT"),
    ("XRPUSDT", "ADAUSDT"),
    ("DOGEUSDT", "1000SHIBUSDT"),
    ("LTCUSDT", "BCHUSDT"),
    ("LINKUSDT", "DOTUSDT"),
)
SYMBOLS: Final = tuple(dict.fromkeys(symbol for pair in PAIRS for symbol in pair))
DATASETS: Final = ("klines_1h", "markPriceKlines_1h", "fundingRate")
BOUND_FILES: Final = (
    "OFFICIAL_SOURCE_RESEARCH.md",
    "README.md",
    "protocol.v1.json",
    "experiment.py",
    "test_experiment.py",
)
LIFECYCLE_ARTIFACTS: Final = (
    "PRESEAL.v1.json",
    "identity_snapshot.v1.json",
    "source_manifest.v1.json",
    "freeze.v1.json",
    "RUN_CONSUMED.v1.json",
    "development_ledger.v1.json",
    "candidate_seal.v1.json",
    "HOLDOUT_OPEN.v1.json",
    "terminal_failure.v1.json",
    "result.v1.json",
    "FINAL_RECEIPT.v1.json",
)
RUN_OUTPUT_ARTIFACTS: Final = LIFECYCLE_ARTIFACTS[4:]
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


class S1YError(RuntimeError):
    """Base fail-closed error."""


class CustodyError(S1YError):
    """Publisher, archive, schema, or time-custody failure."""


class SealError(S1YError):
    """Lifecycle or binding failure."""


@dataclass(frozen=True)
class Trial:
    trial_id: str
    lookback_hours: int
    entry_z: float
    max_hold_hours: int

    @property
    def primary(self) -> bool:
        return self.trial_id == "lb1440_entry2p0_hold168"


@dataclass(frozen=True)
class Bar:
    open_time_ms: int
    open_price: float
    close_price: float
    quote_volume: float


@dataclass(frozen=True)
class Funding:
    time_ms: int
    interval_hours: int
    rate: float


@dataclass(frozen=True)
class Signal:
    model_time_ms: int
    alpha: float
    beta: float
    sigma: float
    residual: float
    zscore: float
    r_squared: float
    ar1_phi: float
    half_life_hours: float
    residual_df_t: float


@dataclass(frozen=True)
class PairModel:
    alpha: float
    beta: float
    sigma: float
    r_squared: float
    ar1_phi: float
    half_life_hours: float
    residual_df_t: float


@dataclass(frozen=True)
class OpenPosition:
    pair_index: int
    pair: tuple[str, str]
    entry_signal_ms: int
    entry_ms: int
    model_time_ms: int
    alpha: float
    beta: float
    sigma: float
    r_squared: float
    ar1_phi: float
    half_life_hours: float
    residual_df_t: float
    entry_z: float
    side_a: int
    side_b: int
    weight_a: float
    weight_b: float


@dataclass(frozen=True)
class Trade:
    pair_index: int
    pair: tuple[str, str]
    entry_signal_ms: int
    entry_ms: int
    exit_ms: int
    model_time_ms: int
    exit_reason: str
    entry_z: float
    exit_z: float
    beta: float
    r_squared: float
    ar1_phi: float
    half_life_hours: float
    residual_df_t: float
    direction: str
    hold_hours: int
    price_pnl_usd: float
    funding_pnl_usd: float
    base_cost_usd: float
    stress_cost_usd: float
    severe_cost_usd: float
    base_net_usd: float
    stress_net_usd: float
    severe_net_usd: float
    capacity_proxy_usd: float


@dataclass
class Market:
    contract: dict[str, dict[int, Bar]]
    mark: dict[str, dict[int, Bar]]
    funding: dict[str, tuple[Funding, ...]]
    daily_quote: dict[str, dict[int, float]]
    start_ms: int
    end_ms: int


def canonical_json_bytes(value: object) -> bytes:
    """Deterministic JSON with non-finite values forbidden."""
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
        raise SealError(f"JSON object required: {path}")
    return cast(dict[str, object], value)


def create_once(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = canonical_json_bytes(value)
    temporary = path.parent / (
        f".{path.name}.{os.getpid()}.{os.urandom(8).hex()}.tmp"
    )
    try:
        descriptor = os.open(
            temporary,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL,
            0o444,
        )
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        try:
            os.link(temporary, path)
        except FileExistsError as error:
            raise SealError(
                f"create-once artifact already exists: {path.name}"
            ) from error
        directory_fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


def utc_now() -> str:
    return datetime.now(tz=UTC).isoformat().replace("+00:00", "Z")


def iso_ms(value: int) -> str:
    return datetime.fromtimestamp(value / 1000, tz=UTC).isoformat().replace(
        "+00:00", "Z"
    )


def rounded(value: float, places: int = 8) -> float:
    if not math.isfinite(value):
        raise S1YError("non-finite metric")
    return round(value, places)


def percentile(values: Sequence[float], probability: float) -> float:
    if not values:
        raise S1YError("percentile requires observations")
    ordered = sorted(values)
    index = int(math.floor(probability * (len(ordered) - 1)))
    return ordered[index]


def trial_family() -> tuple[Trial, ...]:
    return tuple(
        Trial(
            trial_id=f"lb{lookback}_entry{str(entry).replace('.', 'p')}_hold{hold}",
            lookback_hours=lookback,
            entry_z=entry,
            max_hold_hours=hold,
        )
        for lookback in (720, 1440)
        for entry in (1.5, 2.0, 2.5)
        for hold in (72, 168)
    )


def primary_trial() -> Trial:
    found = [trial for trial in trial_family() if trial.primary]
    if len(found) != 1:
        raise SealError("predeclared primary trial is not unique")
    return found[0]


def month_bounds_ms(month: str) -> tuple[int, int]:
    year, number = (int(part) for part in month.split("-"))
    start = datetime(year, number, 1, tzinfo=UTC)
    if number == 12:
        end = datetime(year + 1, 1, 1, tzinfo=UTC)
    else:
        end = datetime(year, number + 1, 1, tzinfo=UTC)
    return int(start.timestamp() * 1000), int(end.timestamp() * 1000)


def archive_path(root: Path, dataset: str, symbol: str, month: str) -> Path:
    if dataset == "klines_1h":
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
    elif dataset == "fundingRate":
        relative = Path(
            "data/futures/um/monthly/fundingRate",
            symbol,
            f"{symbol}-fundingRate-{month}.zip",
        )
    else:
        raise CustodyError(f"unknown dataset: {dataset}")
    candidate = root / relative
    try:
        candidate.resolve().relative_to(root.resolve())
    except ValueError as error:
        raise CustodyError("source path escapes shared root") from error
    return candidate


def parse_checksum_sidecar(raw: bytes, filename: str) -> str:
    if len(raw) > MAX_SIDECAR_BYTES:
        raise CustodyError("checksum sidecar exceeds size bound")
    try:
        fields = raw.decode("ascii").strip().split()
    except UnicodeDecodeError as error:
        raise CustodyError("checksum sidecar is not ASCII") from error
    if len(fields) != 2 or not HEX_RE.fullmatch(fields[0]):
        raise CustodyError("checksum sidecar must contain SHA-256 and filename")
    bound_name = fields[1].lstrip("*")
    if bound_name != filename or "/" in bound_name:
        raise CustodyError("checksum sidecar filename mismatch")
    return fields[0].lower()


def publisher_record(
    root: Path,
    dataset: str,
    symbol: str,
    month: str,
    *,
    verify_payload: bool,
) -> dict[str, object]:
    path = archive_path(root, dataset, symbol, month)
    sidecar = path.with_name(path.name + ".CHECKSUM")
    if path.is_symlink() or sidecar.is_symlink():
        raise CustodyError(f"symlink source rejected: {path}")
    if not path.is_file() or not sidecar.is_file():
        raise CustodyError(f"required source cell unavailable: {path}")
    size = path.stat().st_size
    if size <= 0 or size > MAX_ZIP_BYTES:
        raise CustodyError(f"archive size outside bound: {path}")
    raw_sidecar = sidecar.read_bytes()
    publisher_hash = parse_checksum_sidecar(raw_sidecar, path.name)
    observed: str | None = None
    status = "DEFERRED_UNTOUCHED"
    if verify_payload:
        observed = sha256_path(path)
        if observed != publisher_hash:
            raise CustodyError(f"publisher checksum mismatch: {path}")
        status = "VERIFIED"
    return {
        "dataset": dataset,
        "month": month,
        "path": str(path.relative_to(root)),
        "publisher_checksum_path": str(sidecar.relative_to(root)),
        "publisher_sidecar_sha256": sha256_bytes(raw_sidecar),
        "publisher_sha256": publisher_hash,
        "size_bytes": size,
        "symbol": symbol,
        "zip_sha256": observed,
        "zip_verification": status,
    }


def fetch_current_identity() -> dict[str, object]:
    request = urllib.request.Request(
        EXCHANGE_INFO_URL,
        headers={"User-Agent": "cosmos-s1y-public-research/1.0"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        if response.status != 200:
            raise CustodyError(f"exchangeInfo HTTP status {response.status}")
        payload = json.loads(response.read())
    raw_symbols = payload.get("symbols", [])
    if not isinstance(raw_symbols, list):
        raise CustodyError("exchangeInfo symbols is not a list")
    selected_rows = [
        row
        for row in raw_symbols
        if isinstance(row, dict) and row.get("symbol") in SYMBOLS
    ]
    rows: dict[str, dict[str, object]] = {}
    for symbol in SYMBOLS:
        matches = [row for row in selected_rows if row.get("symbol") == symbol]
        if len(matches) != 1:
            raise CustodyError(
                f"exchangeInfo requires exactly one selected row: {symbol}"
            )
        rows[symbol] = cast(dict[str, object], matches[0])
    selected: list[dict[str, object]] = []
    for symbol in SYMBOLS:
        row = rows[symbol]
        expected = {
            "status": "TRADING",
            "contractType": "PERPETUAL",
            "quoteAsset": "USDT",
            "marginAsset": "USDT",
        }
        for field, value in expected.items():
            if row.get(field) != value:
                raise CustodyError(f"{symbol} current {field} is not {value}")
        onboard_date = row.get("onboardDate")
        if not isinstance(onboard_date, int) or onboard_date > DATA_START_MS:
            raise CustodyError(f"{symbol} lacks required pre-window history")
        selected.append(
            {
                "contractType": row.get("contractType"),
                "deliveryDate": row.get("deliveryDate"),
                "marginAsset": row.get("marginAsset"),
                "onboardDate": onboard_date,
                "quoteAsset": row.get("quoteAsset"),
                "status": row.get("status"),
                "symbol": symbol,
            }
        )
    return {
        "captured_at": utc_now(),
        "endpoint": EXCHANGE_INFO_URL,
        "historical_applicability": "CURRENT_ONLY",
        "pairs": [list(pair) for pair in PAIRS],
        "request_security": "NONE_PUBLIC",
        "symbols": selected,
    }


def bound_file_hashes() -> dict[str, str]:
    hashes: dict[str, str] = {}
    for name in BOUND_FILES:
        path = PACKET_DIR / name
        if not path.is_file():
            raise SealError(f"bound file missing: {name}")
        hashes[name] = sha256_path(path)
    return hashes


def freeze(shared_root: Path) -> dict[str, object]:
    if shared_root.resolve() != EXPECTED_SHARED_ROOT.resolve():
        raise SealError("shared root does not match frozen read-only path")
    for name in LIFECYCLE_ARTIFACTS:
        if (PACKET_DIR / name).exists():
            raise SealError(f"fresh freeze required; found {name}")
    protocol = read_json(PACKET_DIR / "protocol.v1.json")
    if protocol.get("base_commit") != BASE_COMMIT:
        raise SealError("protocol base commit mismatch")
    if len(trial_family()) != 12:
        raise SealError("trial family size is not 12")
    preseal = {
        "schema": "cosmos.s1y.preseal.v1",
        "milestone": "S-1Y",
        "created_at": utc_now(),
        "base_commit": BASE_COMMIT,
        "bound_files": bound_file_hashes(),
        "pairs": [list(pair) for pair in PAIRS],
        "trial_ids": [trial.trial_id for trial in trial_family()],
        "archive_member_opened": false_value(),
        "authority": "PUBLIC_RESEARCH_ONLY",
    }
    create_once(PACKET_DIR / "PRESEAL.v1.json", preseal)

    identity = fetch_current_identity()
    create_once(PACKET_DIR / "identity_snapshot.v1.json", identity)

    records: list[dict[str, object]] = []
    for month in ALL_MONTHS:
        verify_payload = month in NON_HOLDOUT_MONTHS
        for symbol in SYMBOLS:
            for dataset in DATASETS:
                records.append(
                    publisher_record(
                        shared_root,
                        dataset,
                        symbol,
                        month,
                        verify_payload=verify_payload,
                    )
                )
    verified = sum(row["zip_verification"] == "VERIFIED" for row in records)
    deferred = sum(
        row["zip_verification"] == "DEFERRED_UNTOUCHED" for row in records
    )
    manifest = {
        "schema": "cosmos.s1y.source_manifest.v1",
        "created_at": utc_now(),
        "shared_root": str(EXPECTED_SHARED_ROOT),
        "shared_root_policy": "READ_ONLY",
        "publisher": "Binance public data",
        "publisher_base_url": "https://data.binance.vision/",
        "checksum_algorithm": "sha256",
        "cell_count": len(records),
        "verified_non_holdout_zip_count": verified,
        "deferred_embargo_holdout_zip_count": deferred,
        "records": records,
    }
    create_once(PACKET_DIR / "source_manifest.v1.json", manifest)
    frozen = {
        "schema": "cosmos.s1y.freeze.v1",
        "milestone": "S-1Y",
        "created_at": utc_now(),
        "base_commit": BASE_COMMIT,
        "preseal_sha256": sha256_path(PACKET_DIR / "PRESEAL.v1.json"),
        "identity_snapshot_sha256": sha256_path(
            PACKET_DIR / "identity_snapshot.v1.json"
        ),
        "source_manifest_sha256": sha256_path(
            PACKET_DIR / "source_manifest.v1.json"
        ),
        "protocol_sha256": sha256_path(PACKET_DIR / "protocol.v1.json"),
        "source_note_sha256": sha256_path(
            PACKET_DIR / "OFFICIAL_SOURCE_RESEARCH.md"
        ),
        "verified_non_holdout_zip_count": verified,
        "deferred_embargo_holdout_zip_count": deferred,
        "archive_members_opened": 0,
        "development_opened": False,
        "holdout_opened": False,
        "run_available": True,
    }
    create_once(PACKET_DIR / "freeze.v1.json", frozen)
    return frozen


def false_value() -> bool:
    """Keep the preseal's false value conspicuous in source review."""
    return False


def verify_freeze_bindings() -> tuple[dict[str, object], dict[str, object]]:
    preseal_path = PACKET_DIR / "PRESEAL.v1.json"
    manifest_path = PACKET_DIR / "source_manifest.v1.json"
    identity_path = PACKET_DIR / "identity_snapshot.v1.json"
    freeze_path = PACKET_DIR / "freeze.v1.json"
    for path in (preseal_path, manifest_path, identity_path, freeze_path):
        if not path.is_file():
            raise SealError(f"frozen artifact missing: {path.name}")
    preseal = read_json(preseal_path)
    expected_hashes = preseal.get("bound_files")
    if not isinstance(expected_hashes, dict) or expected_hashes != bound_file_hashes():
        raise SealError("bound source files changed after preseal")
    frozen = read_json(freeze_path)
    expected = {
        "preseal_sha256": sha256_path(preseal_path),
        "identity_snapshot_sha256": sha256_path(identity_path),
        "source_manifest_sha256": sha256_path(manifest_path),
        "protocol_sha256": sha256_path(PACKET_DIR / "protocol.v1.json"),
        "source_note_sha256": sha256_path(
            PACKET_DIR / "OFFICIAL_SOURCE_RESEARCH.md"
        ),
    }
    for field, value in expected.items():
        if frozen.get(field) != value:
            raise SealError(f"freeze binding mismatch: {field}")
    return frozen, read_json(manifest_path)


def manifest_index(
    manifest: Mapping[str, object],
) -> dict[tuple[str, str, str], Mapping[str, object]]:
    records = manifest.get("records")
    if not isinstance(records, list):
        raise SealError("manifest records missing")
    result: dict[tuple[str, str, str], Mapping[str, object]] = {}
    for raw in records:
        if not isinstance(raw, dict):
            raise SealError("manifest record is not an object")
        record = cast(Mapping[str, object], raw)
        key = (
            str(record.get("dataset")),
            str(record.get("symbol")),
            str(record.get("month")),
        )
        if key in result:
            raise SealError(f"duplicate manifest key: {key}")
        result[key] = record
    if len(result) != len(ALL_MONTHS) * len(SYMBOLS) * len(DATASETS):
        raise SealError("manifest cell count mismatch")
    return result


def verify_manifest_payload(
    root: Path,
    record: Mapping[str, object],
) -> Path:
    relative = record.get("path")
    expected = record.get("publisher_sha256")
    if not isinstance(relative, str) or not isinstance(expected, str):
        raise CustodyError("manifest path or checksum missing")
    path = root / relative
    if path.is_symlink() or not path.is_file():
        raise CustodyError(f"source archive missing or symlinked: {path}")
    if path.stat().st_size != record.get("size_bytes"):
        raise CustodyError(f"source archive size changed: {path}")
    observed = sha256_path(path)
    if observed != expected:
        raise CustodyError(f"source archive checksum changed: {path}")
    return path


def archive_member_bytes(path: Path) -> bytes:
    with zipfile.ZipFile(path) as archive:
        members = [
            member
            for member in archive.infolist()
            if not member.is_dir() and not member.filename.startswith("__MACOSX/")
        ]
        if len(members) != 1:
            raise CustodyError(f"exactly one archive member required: {path}")
        member = members[0]
        if (
            member.file_size <= 0
            or member.file_size > MAX_MEMBER_BYTES
            or Path(member.filename).name != member.filename
            or member.filename != path.with_suffix(".csv").name
        ):
            raise CustodyError(f"archive member violates bound: {path}")
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


def int_field(raw: str, context: str) -> int:
    try:
        return int(raw)
    except ValueError as error:
        raise CustodyError(f"invalid integer: {context}") from error


def float_field(raw: str, context: str) -> float:
    try:
        decimal = Decimal(raw)
    except InvalidOperation as error:
        raise CustodyError(f"invalid decimal: {context}") from error
    value = float(decimal)
    if not math.isfinite(value):
        raise CustodyError(f"non-finite decimal: {context}")
    return value


def read_kline_archive(path: Path, month: str) -> tuple[Bar, ...]:
    rows = csv_rows(archive_member_bytes(path), path)
    first = tuple(field.strip().lower() for field in rows[0])
    data_rows = rows[1:] if first == KLINE_HEADER else rows
    start_ms, end_ms = month_bounds_ms(month)
    result: list[Bar] = []
    previous = -1
    for index, row in enumerate(data_rows, start=2 if data_rows is not rows else 1):
        if len(row) != 12:
            raise CustodyError(f"kline width mismatch: {path}:{index}")
        open_ms = int_field(row[0], f"{path}:{index}:open_time")
        open_price = float_field(row[1], f"{path}:{index}:open")
        close_price = float_field(row[4], f"{path}:{index}:close")
        close_ms = int_field(row[6], f"{path}:{index}:close_time")
        quote_volume = float_field(row[7], f"{path}:{index}:quote_volume")
        if (
            not start_ms <= open_ms < end_ms
            or open_ms % HOUR_MS != 0
            or close_ms != open_ms + HOUR_MS - 1
            or open_price <= 0
            or close_price <= 0
            or quote_volume < 0
            or open_ms <= previous
        ):
            raise CustodyError(f"kline field outside bound: {path}:{index}")
        previous = open_ms
        result.append(Bar(open_ms, open_price, close_price, quote_volume))
    if not result:
        raise CustodyError(f"kline archive has no rows: {path}")
    return tuple(result)


def read_funding_archive(path: Path, month: str) -> tuple[Funding, ...]:
    rows = csv_rows(archive_member_bytes(path), path)
    header = tuple(field.strip() for field in rows[0])
    if header != FUNDING_HEADER:
        raise CustodyError(f"funding header mismatch: {path}")
    start_ms, end_ms = month_bounds_ms(month)
    result: list[Funding] = []
    previous = -1
    for index, row in enumerate(rows[1:], start=2):
        if len(row) != 3:
            raise CustodyError(f"funding width mismatch: {path}:{index}")
        time_ms = int_field(row[0], f"{path}:{index}:calc_time")
        interval = int_field(row[1], f"{path}:{index}:funding_interval_hours")
        rate = float_field(row[2], f"{path}:{index}:last_funding_rate")
        if (
            not start_ms <= time_ms < end_ms
            or not 0 <= time_ms % HOUR_MS < 60_000
            or interval <= 0
            or interval > 24
            or time_ms <= previous
        ):
            raise CustodyError(f"funding field outside bound: {path}:{index}")
        previous = time_ms
        result.append(Funding(time_ms, interval, rate))
    if not result:
        raise CustodyError(f"funding archive has no rows: {path}")
    return tuple(result)


def validate_funding_cadence(
    rows: Sequence[Funding],
    symbol: str,
    start_ms: int,
    end_ms: int,
) -> None:
    if not rows:
        raise CustodyError(f"funding segment is empty: {symbol}")
    first = rows[0]
    last = rows[-1]
    if (
        first.time_ms < start_ms
        or first.time_ms - start_ms
        > first.interval_hours * HOUR_MS + 60_000
    ):
        raise CustodyError(f"funding leading coverage gap: {symbol}")
    if (
        last.time_ms >= end_ms
        or end_ms - last.time_ms
        > last.interval_hours * HOUR_MS + 60_000
    ):
        raise CustodyError(f"funding trailing coverage gap: {symbol}")
    for row_index in range(len(rows) - 1):
        previous = rows[row_index]
        current = rows[row_index + 1]
        if previous.time_ms >= current.time_ms:
            raise CustodyError(
                f"funding times not strictly increasing: {symbol}"
            )
        delta = current.time_ms - previous.time_ms
        expected = current.interval_hours * HOUR_MS
        if abs(delta - expected) >= 60_000:
            raise CustodyError(
                f"funding cadence gap or missing row: {symbol} "
                f"{iso_ms(previous.time_ms)}->{iso_ms(current.time_ms)}"
            )


def load_market(
    root: Path,
    manifest: Mapping[str, object],
    months: Sequence[str],
) -> Market:
    index = manifest_index(manifest)
    contract: dict[str, dict[int, Bar]] = {symbol: {} for symbol in SYMBOLS}
    mark: dict[str, dict[int, Bar]] = {symbol: {} for symbol in SYMBOLS}
    funding_lists: dict[str, list[Funding]] = {symbol: [] for symbol in SYMBOLS}
    for month in months:
        for symbol in SYMBOLS:
            for dataset in DATASETS:
                record = index[(dataset, symbol, month)]
                path = verify_manifest_payload(root, record)
                if dataset == "fundingRate":
                    funding_lists[symbol].extend(read_funding_archive(path, month))
                    continue
                target = contract[symbol] if dataset == "klines_1h" else mark[symbol]
                for bar in read_kline_archive(path, month):
                    if bar.open_time_ms in target:
                        raise CustodyError(f"duplicate kline time: {symbol}")
                    target[bar.open_time_ms] = bar
    start_ms = month_bounds_ms(months[0])[0]
    end_ms = month_bounds_ms(months[-1])[1]
    expected_times = range(start_ms, end_ms, HOUR_MS)
    for symbol in SYMBOLS:
        for time_ms in expected_times:
            if time_ms not in contract[symbol] or time_ms not in mark[symbol]:
                raise CustodyError(
                    f"incomplete hourly custody: {symbol} {iso_ms(time_ms)}"
                )
        rows = funding_lists[symbol]
        validate_funding_cadence(rows, symbol, start_ms, end_ms)
    daily_quote: dict[str, dict[int, float]] = {}
    for symbol in SYMBOLS:
        totals: defaultdict[int, float] = defaultdict(float)
        for bar in contract[symbol].values():
            day = bar.open_time_ms - bar.open_time_ms % DAY_MS
            totals[day] += bar.quote_volume
        daily_quote[symbol] = dict(totals)
    return Market(
        contract=contract,
        mark=mark,
        funding={
            symbol: tuple(funding_lists[symbol])
            for symbol in SYMBOLS
        },
        daily_quote=daily_quote,
        start_ms=start_ms,
        end_ms=end_ms,
    )


def merge_markets(left: Market, right: Market) -> Market:
    if left.end_ms != right.start_ms:
        raise CustodyError("market segments are not contiguous")
    contract: dict[str, dict[int, Bar]] = {}
    mark: dict[str, dict[int, Bar]] = {}
    funding: dict[str, tuple[Funding, ...]] = {}
    daily: dict[str, dict[int, float]] = {}
    for symbol in SYMBOLS:
        if set(left.contract[symbol]).intersection(right.contract[symbol]):
            raise CustodyError("contract market segments overlap")
        if set(left.mark[symbol]).intersection(right.mark[symbol]):
            raise CustodyError("mark market segments overlap")
        contract[symbol] = {**left.contract[symbol], **right.contract[symbol]}
        mark[symbol] = {**left.mark[symbol], **right.mark[symbol]}
        funding[symbol] = left.funding[symbol] + right.funding[symbol]
        validate_funding_cadence(
            funding[symbol],
            symbol,
            left.start_ms,
            right.end_ms,
        )
        daily[symbol] = {**left.daily_quote[symbol], **right.daily_quote[symbol]}
    return Market(contract, mark, funding, daily, left.start_ms, right.end_ms)


def fit_pair_model(
    x_window: Sequence[float],
    y_window: Sequence[float],
) -> PairModel | None:
    count = len(x_window)
    if count != len(y_window) or count < 24:
        return None
    sum_x = sum(x_window)
    sum_y = sum(y_window)
    sum_x2 = sum(value * value for value in x_window)
    sum_y2 = sum(value * value for value in y_window)
    sum_xy = sum(x * y for x, y in zip(x_window, y_window))
    denominator = sum_x2 - sum_x * sum_x / count
    centered_y = sum_y2 - sum_y * sum_y / count
    if denominator <= 1e-18 or centered_y <= 1e-18:
        return None
    beta = (sum_xy - sum_x * sum_y / count) / denominator
    alpha = (sum_y - beta * sum_x) / count
    sse = max(0.0, sum_y2 - alpha * sum_y - beta * sum_xy)
    if sse <= 1e-18:
        return None
    sigma = math.sqrt(sse / (count - 2))
    if sigma <= 0:
        return None
    residuals = [
        y_value - alpha - beta * x_value
        for x_value, y_value in zip(x_window, y_window)
    ]
    lagged = residuals[:-1]
    changes = [
        residuals[index] - residuals[index - 1]
        for index in range(1, len(residuals))
    ]
    lag_square = sum(value * value for value in lagged)
    if lag_square <= 1e-18:
        return None
    gamma = sum(
        lag * change for lag, change in zip(lagged, changes)
    ) / lag_square
    df_errors = [
        change - gamma * lag
        for lag, change in zip(lagged, changes)
    ]
    degrees = len(df_errors) - 1
    if degrees <= 0:
        return None
    error_variance = sum(error * error for error in df_errors) / degrees
    standard_error = math.sqrt(error_variance / lag_square)
    if standard_error <= 0:
        return None
    residual_df_t = gamma / standard_error
    ar1_phi = 1.0 + gamma
    half_life = (
        -math.log(2.0) / math.log(ar1_phi)
        if 0.0 < ar1_phi < 1.0
        else math.inf
    )
    r_squared = max(-1.0, min(1.0, 1.0 - sse / centered_y))
    return PairModel(
        alpha=alpha,
        beta=beta,
        sigma=sigma,
        r_squared=r_squared,
        ar1_phi=ar1_phi,
        half_life_hours=half_life,
        residual_df_t=residual_df_t,
    )


def score_pair_model(
    model_time_ms: int,
    model: PairModel,
    x_current: float,
    y_current: float,
) -> Signal:
    residual = y_current - model.alpha - model.beta * x_current
    return Signal(
        model_time_ms=model_time_ms,
        alpha=model.alpha,
        beta=model.beta,
        sigma=model.sigma,
        residual=residual,
        zscore=residual / model.sigma,
        r_squared=model.r_squared,
        ar1_phi=model.ar1_phi,
        half_life_hours=model.half_life_hours,
        residual_df_t=model.residual_df_t,
    )


def build_signal_book(
    market: Market,
    lookbacks: Iterable[int],
    signal_start_ms: int,
    signal_end_ms: int,
) -> dict[tuple[int, int], dict[int, Signal]]:
    times = list(range(market.start_ms, market.end_ms, HOUR_MS))
    time_index = {time_ms: index for index, time_ms in enumerate(times)}
    result: dict[tuple[int, int], dict[int, Signal]] = {}
    for pair_index, (symbol_a, symbol_b) in enumerate(PAIRS):
        y_values = [
            math.log(market.contract[symbol_a][time].close_price)
            for time in times
        ]
        x_values = [
            math.log(market.contract[symbol_b][time].close_price)
            for time in times
        ]
        for lookback in lookbacks:
            signals: dict[int, Signal] = {}
            first_model_ms = (
                signal_start_ms - signal_start_ms % DAY_MS
            )
            for model_time_ms in range(
                first_model_ms, signal_end_ms, DAY_MS
            ):
                index = time_index.get(model_time_ms)
                if index is None or index < lookback:
                    continue
                model = fit_pair_model(
                    x_values[index - lookback : index],
                    y_values[index - lookback : index],
                )
                if model is None:
                    continue
                day_end_ms = min(model_time_ms + DAY_MS, signal_end_ms)
                for time_ms in range(
                    max(model_time_ms, signal_start_ms),
                    day_end_ms,
                    HOUR_MS,
                ):
                    current_index = time_index.get(time_ms)
                    if current_index is None:
                        raise CustodyError("signal hour absent from market")
                    signals[time_ms] = score_pair_model(
                        model_time_ms,
                        model,
                        x_values[current_index],
                        y_values[current_index],
                    )
            result[(pair_index, lookback)] = signals
    return result


def funding_pnl(
    market: Market,
    symbol: str,
    signed_quantity: float,
    entry_ms: int,
    exit_ms: int,
) -> float:
    total = 0.0
    for event in market.funding[symbol]:
        if event.time_ms <= entry_ms:
            continue
        if event.time_ms >= exit_ms:
            break
        mark_time_ms = event.time_ms - event.time_ms % HOUR_MS
        mark = market.mark[symbol].get(mark_time_ms)
        if mark is None:
            raise CustodyError(
                f"funding containing-hour mark unavailable: "
                f"{symbol} {iso_ms(event.time_ms)}"
            )
        total += -signed_quantity * mark.open_price * event.rate
    return total


def close_trade(
    market: Market,
    position: OpenPosition,
    exit_ms: int,
    exit_z: float,
    exit_reason: str,
) -> Trade:
    symbol_a, symbol_b = position.pair
    entry_a = market.contract[symbol_a][position.entry_ms].open_price
    entry_b = market.contract[symbol_b][position.entry_ms].open_price
    exit_a = market.contract[symbol_a][exit_ms].open_price
    exit_b = market.contract[symbol_b][exit_ms].open_price
    notional_a = CAPITAL * position.weight_a
    notional_b = CAPITAL * position.weight_b
    quantity_a = position.side_a * notional_a / entry_a
    quantity_b = position.side_b * notional_b / entry_b
    price_pnl = quantity_a * (exit_a - entry_a) + quantity_b * (exit_b - entry_b)
    funding = funding_pnl(
        market, symbol_a, quantity_a, position.entry_ms, exit_ms
    ) + funding_pnl(market, symbol_b, quantity_b, position.entry_ms, exit_ms)
    turnover = (
        abs(quantity_a) * entry_a
        + abs(quantity_b) * entry_b
        + abs(quantity_a) * exit_a
        + abs(quantity_b) * exit_b
    )
    base_cost = turnover * 7.0 / 10_000.0
    stress_cost = turnover * 13.0 / 10_000.0
    severe_cost = turnover * 20.0 / 10_000.0
    prior_day = (
        position.entry_ms - position.entry_ms % DAY_MS - DAY_MS
    )
    quote_a = market.daily_quote[symbol_a].get(prior_day, 0.0)
    quote_b = market.daily_quote[symbol_b].get(prior_day, 0.0)
    capacity = min(
        quote_a * CAPACITY_PARTICIPATION / position.weight_a,
        quote_b * CAPACITY_PARTICIPATION / position.weight_b,
    )
    direction = (
        "SHORT_A_LONG_B" if position.side_a < 0 else "LONG_A_SHORT_B"
    )
    return Trade(
        pair_index=position.pair_index,
        pair=position.pair,
        entry_signal_ms=position.entry_signal_ms,
        entry_ms=position.entry_ms,
        exit_ms=exit_ms,
        model_time_ms=position.model_time_ms,
        exit_reason=exit_reason,
        entry_z=position.entry_z,
        exit_z=exit_z,
        beta=position.beta,
        r_squared=position.r_squared,
        ar1_phi=position.ar1_phi,
        half_life_hours=position.half_life_hours,
        residual_df_t=position.residual_df_t,
        direction=direction,
        hold_hours=(exit_ms - position.entry_ms) // HOUR_MS,
        price_pnl_usd=price_pnl,
        funding_pnl_usd=funding,
        base_cost_usd=base_cost,
        stress_cost_usd=stress_cost,
        severe_cost_usd=severe_cost,
        base_net_usd=price_pnl + funding - base_cost,
        stress_net_usd=price_pnl + funding - stress_cost,
        severe_net_usd=price_pnl + funding - severe_cost,
        capacity_proxy_usd=capacity,
    )


def frozen_position_zscore(
    market: Market,
    position: OpenPosition,
    signal_time_ms: int,
) -> float:
    symbol_a, symbol_b = position.pair
    y_value = math.log(
        market.contract[symbol_a][signal_time_ms].close_price
    )
    x_value = math.log(
        market.contract[symbol_b][signal_time_ms].close_price
    )
    return (
        y_value - position.alpha - position.beta * x_value
    ) / position.sigma


def simulate_trial(
    market: Market,
    signals: Mapping[tuple[int, int], Mapping[int, Signal]],
    trial: Trial,
    start_ms: int,
    end_ms: int,
) -> tuple[Trade, ...]:
    trades: list[Trade] = []
    position: OpenPosition | None = None
    for time_ms in range(start_ms, end_ms, HOUR_MS):
        if position is not None:
            current_z = frozen_position_zscore(
                market, position, time_ms
            )
            exit_ms = time_ms + HOUR_MS
            reason: str | None = None
            if abs(current_z) <= 0.5:
                reason = "NORMALIZED"
            elif abs(current_z) >= 4.0:
                reason = "RESIDUAL_STOP"
            elif (
                exit_ms - position.entry_ms
                >= trial.max_hold_hours * HOUR_MS
            ):
                reason = "MAX_HOLD"
            if reason is not None:
                if exit_ms > end_ms:
                    raise CustodyError("exit crosses frozen segment")
                trades.append(
                    close_trade(
                        market,
                        position,
                        exit_ms,
                        current_z,
                        reason,
                    )
                )
                position = None
            continue

        entry_ms = time_ms + HOUR_MS
        if entry_ms + trial.max_hold_hours * HOUR_MS >= end_ms:
            continue
        eligible: list[tuple[float, int, Signal]] = []
        for pair_index, _pair in enumerate(PAIRS):
            signal = signals[(pair_index, trial.lookback_hours)].get(time_ms)
            if signal is None:
                continue
            if (
                abs(signal.zscore) >= trial.entry_z
                and 0.25 <= signal.beta <= 4.0
                and signal.r_squared >= 0.60
                and 0.0 < signal.ar1_phi < 1.0
                and signal.half_life_hours <= 168.0
                and signal.residual_df_t <= -3.34
            ):
                eligible.append((abs(signal.zscore), pair_index, signal))
        if not eligible:
            continue
        _magnitude, pair_index, signal = max(
            eligible, key=lambda item: (item[0], -item[1])
        )
        beta = signal.beta
        weight_a = 1.0 / (1.0 + beta)
        weight_b = beta / (1.0 + beta)
        residual_sign = 1 if signal.residual > 0 else -1
        position = OpenPosition(
            pair_index=pair_index,
            pair=PAIRS[pair_index],
            entry_signal_ms=time_ms,
            entry_ms=entry_ms,
            model_time_ms=signal.model_time_ms,
            alpha=signal.alpha,
            beta=beta,
            sigma=signal.sigma,
            r_squared=signal.r_squared,
            ar1_phi=signal.ar1_phi,
            half_life_hours=signal.half_life_hours,
            residual_df_t=signal.residual_df_t,
            entry_z=signal.zscore,
            side_a=-residual_sign,
            side_b=residual_sign,
            weight_a=weight_a,
            weight_b=weight_b,
        )
    if position is not None:
        raise CustodyError("segment ended with an open position")
    return tuple(trades)


def scenario_value(trade: Trade, scenario: str) -> float:
    if scenario == "base":
        return trade.base_net_usd
    if scenario == "stress":
        return trade.stress_net_usd
    if scenario == "severe":
        return trade.severe_net_usd
    raise S1YError(f"unknown scenario: {scenario}")


def scenario_cost_bps(scenario: str) -> float:
    if scenario == "base":
        return 7.0
    if scenario == "stress":
        return 13.0
    if scenario == "severe":
        return 20.0
    raise S1YError(f"unknown scenario: {scenario}")


def hourly_equity_increments(
    market: Market,
    trades: Sequence[Trade],
    start_ms: int,
    end_ms: int,
    scenario: str,
) -> list[float]:
    count = (end_ms - start_ms) // HOUR_MS
    values = [0.0] * count
    cost_rate = scenario_cost_bps(scenario) / 10_000.0
    for trade in trades:
        symbol_a, symbol_b = trade.pair
        weight_a = 1.0 / (1.0 + trade.beta)
        weight_b = trade.beta / (1.0 + trade.beta)
        side_a = -1 if trade.direction == "SHORT_A_LONG_B" else 1
        side_b = -side_a
        entry_a = market.contract[symbol_a][trade.entry_ms].open_price
        entry_b = market.contract[symbol_b][trade.entry_ms].open_price
        quantity_a = side_a * CAPITAL * weight_a / entry_a
        quantity_b = side_b * CAPITAL * weight_b / entry_b

        entry_index = (trade.entry_ms - start_ms) // HOUR_MS
        if not 0 <= entry_index < count:
            raise S1YError("entry lies outside marked-equity segment")
        values[entry_index] -= (
            abs(quantity_a) * entry_a + abs(quantity_b) * entry_b
        ) * cost_rate

        current_ms = trade.entry_ms
        while current_ms < trade.exit_ms:
            next_ms = current_ms + HOUR_MS
            current_a = market.contract[symbol_a][current_ms].open_price
            current_b = market.contract[symbol_b][current_ms].open_price
            next_a = market.contract[symbol_a][next_ms].open_price
            next_b = market.contract[symbol_b][next_ms].open_price
            index = (next_ms - start_ms) // HOUR_MS
            if not 0 <= index < count:
                raise S1YError("mark-to-market increment outside segment")
            values[index] += (
                quantity_a * (next_a - current_a)
                + quantity_b * (next_b - current_b)
            )
            current_ms = next_ms

        for symbol, quantity in (
            (symbol_a, quantity_a),
            (symbol_b, quantity_b),
        ):
            for event in market.funding[symbol]:
                if event.time_ms <= trade.entry_ms:
                    continue
                if event.time_ms >= trade.exit_ms:
                    break
                mark_time_ms = event.time_ms - event.time_ms % HOUR_MS
                mark = market.mark[symbol].get(mark_time_ms)
                if mark is None:
                    raise CustodyError(
                        f"funding containing-hour mark unavailable: "
                        f"{symbol} {iso_ms(event.time_ms)}"
                    )
                index = (mark_time_ms - start_ms) // HOUR_MS
                if not 0 <= index < count:
                    raise S1YError("funding increment outside segment")
                values[index] += -quantity * mark.open_price * event.rate

        exit_a = market.contract[symbol_a][trade.exit_ms].open_price
        exit_b = market.contract[symbol_b][trade.exit_ms].open_price
        exit_index = (trade.exit_ms - start_ms) // HOUR_MS
        values[exit_index] -= (
            abs(quantity_a) * exit_a + abs(quantity_b) * exit_b
        ) * cost_rate
        observed = sum(
            values[index]
            for index in range(entry_index, exit_index + 1)
        )
        expected = scenario_value(trade, scenario)
        if abs(observed - expected) > max(1e-6, abs(expected) * 1e-9):
            raise S1YError("marked-equity path does not reconcile to trade net")
    return values


def daily_vector(
    market: Market,
    trades: Sequence[Trade],
    start_ms: int,
    end_ms: int,
    scenario: str,
) -> list[float]:
    hourly = hourly_equity_increments(
        market, trades, start_ms, end_ms, scenario
    )
    day_count = (end_ms - start_ms) // DAY_MS
    values = [0.0] * day_count
    for index, value in enumerate(hourly):
        time_ms = start_ms + index * HOUR_MS
        day_index = (time_ms - start_ms) // DAY_MS
        values[day_index] += value
    return values


def bootstrap_indices(
    observation_count: int,
    replicates: int = BOOTSTRAP_REPLICATES,
    seed: int = BOOTSTRAP_SEED,
    block_size: int = 7,
) -> list[tuple[int, ...]]:
    if observation_count <= 0:
        raise S1YError("bootstrap requires observations")
    rng = random.Random(seed)
    result: list[tuple[int, ...]] = []
    for _ in range(replicates):
        indices: list[int] = []
        while len(indices) < observation_count:
            start = rng.randrange(observation_count)
            indices.extend(
                (start + offset) % observation_count
                for offset in range(block_size)
            )
        result.append(tuple(indices[:observation_count]))
    return result


def bootstrap_interval(
    values: Sequence[float],
    samples: Sequence[Sequence[int]],
) -> tuple[float, float]:
    totals = [sum(values[index] for index in sample) for sample in samples]
    return percentile(totals, 0.05), percentile(totals, 0.95)


def centered_bootstrap_pvalue(
    values: Sequence[float],
    samples: Sequence[Sequence[int]],
) -> float:
    observed = sum(values) / len(values)
    centered = [value - observed for value in values]
    exceed = sum(
        sum(centered[index] for index in sample) / len(sample) >= observed
        for sample in samples
    )
    return (exceed + 1.0) / (len(samples) + 1.0)


def holm_adjust(pvalues: Mapping[str, float]) -> dict[str, float]:
    ordered = sorted(pvalues.items(), key=lambda item: (item[1], item[0]))
    adjusted: dict[str, float] = {}
    running = 0.0
    count = len(ordered)
    for rank, (name, pvalue) in enumerate(ordered):
        running = max(running, min(1.0, (count - rank) * pvalue))
        adjusted[name] = running
    return adjusted


def reality_check_pvalue(
    vectors: Sequence[Sequence[float]],
    samples: Sequence[Sequence[int]],
) -> float:
    observed = max(sum(vector) / len(vector) for vector in vectors)
    centered = [
        [value - sum(vector) / len(vector) for value in vector]
        for vector in vectors
    ]
    exceed = 0
    for sample in samples:
        bootstrap_max = max(
            sum(vector[index] for index in sample) / len(sample)
            for vector in centered
        )
        if bootstrap_max >= observed:
            exceed += 1
    return (exceed + 1.0) / (len(samples) + 1.0)


def pbo_probability(vectors: Sequence[Sequence[float]], blocks: int = 8) -> float:
    if not vectors or any(len(vector) != len(vectors[0]) for vector in vectors):
        raise S1YError("PBO requires a rectangular trial matrix")
    observations = len(vectors[0])
    block_indices = [
        tuple(range(index * observations // blocks, (index + 1) * observations // blocks))
        for index in range(blocks)
    ]
    failures = 0
    total = 0
    for train_blocks in itertools.combinations(range(blocks), blocks // 2):
        train_set = set(train_blocks)
        train_indices = tuple(
            item
            for block in train_blocks
            for item in block_indices[block]
        )
        test_indices = tuple(
            item
            for block in range(blocks)
            if block not in train_set
            for item in block_indices[block]
        )
        train_scores = [
            sum(vector[index] for index in train_indices) / len(train_indices)
            for vector in vectors
        ]
        selected = max(
            range(len(vectors)), key=lambda index: (train_scores[index], -index)
        )
        test_scores = [
            sum(vector[index] for index in test_indices) / len(test_indices)
            for vector in vectors
        ]
        chosen = test_scores[selected]
        lower = sum(value < chosen for value in test_scores)
        equal = sum(value == chosen for value in test_scores)
        average_rank = lower + (equal + 1.0) / 2.0
        relative_rank = average_rank / (len(vectors) + 1.0)
        if relative_rank <= 0.5:
            failures += 1
        total += 1
    return failures / total


def maximum_drawdown(values: Sequence[float]) -> float:
    cumulative = 0.0
    peak = 0.0
    drawdown = 0.0
    for value in values:
        cumulative += value
        peak = max(peak, cumulative)
        drawdown = max(drawdown, peak - cumulative)
    return drawdown


def trade_to_json(trade: Trade) -> dict[str, object]:
    return {
        "pair": list(trade.pair),
        "entry_signal": iso_ms(trade.entry_signal_ms),
        "entry": iso_ms(trade.entry_ms),
        "exit": iso_ms(trade.exit_ms),
        "model_time": iso_ms(trade.model_time_ms),
        "exit_reason": trade.exit_reason,
        "entry_z": rounded(trade.entry_z),
        "exit_z": rounded(trade.exit_z),
        "beta": rounded(trade.beta),
        "r_squared": rounded(trade.r_squared),
        "ar1_phi": rounded(trade.ar1_phi),
        "half_life_hours": rounded(trade.half_life_hours),
        "residual_df_t": rounded(trade.residual_df_t),
        "direction": trade.direction,
        "hold_hours": trade.hold_hours,
        "price_pnl_usd": rounded(trade.price_pnl_usd),
        "funding_pnl_usd": rounded(trade.funding_pnl_usd),
        "base_cost_usd": rounded(trade.base_cost_usd),
        "stress_cost_usd": rounded(trade.stress_cost_usd),
        "severe_cost_usd": rounded(trade.severe_cost_usd),
        "base_net_usd": rounded(trade.base_net_usd),
        "stress_net_usd": rounded(trade.stress_net_usd),
        "severe_net_usd": rounded(trade.severe_net_usd),
        "capacity_proxy_usd": rounded(trade.capacity_proxy_usd, 2),
    }


def trial_metrics(
    market: Market,
    trial: Trial,
    trades: Sequence[Trade],
    start_ms: int,
    end_ms: int,
) -> dict[str, object]:
    stress_hourly = hourly_equity_increments(
        market, trades, start_ms, end_ms, "stress"
    )
    capacities = [trade.capacity_proxy_usd for trade in trades]
    active_weeks = {
        datetime.fromtimestamp(trade.exit_ms / 1000, tz=UTC).isocalendar()[:2]
        for trade in trades
    }
    directions = {trade.direction for trade in trades}
    pairs = {trade.pair for trade in trades}
    return {
        "trial_id": trial.trial_id,
        "primary": trial.primary,
        "lookback_hours": trial.lookback_hours,
        "entry_z_abs": trial.entry_z,
        "maximum_hold_hours": trial.max_hold_hours,
        "trade_count": len(trades),
        "active_iso_weeks": len(active_weeks),
        "distinct_pairs": len(pairs),
        "directions": sorted(directions),
        "price_pnl_usd": rounded(sum(trade.price_pnl_usd for trade in trades)),
        "funding_pnl_usd": rounded(
            sum(trade.funding_pnl_usd for trade in trades)
        ),
        "base_cost_usd": rounded(sum(trade.base_cost_usd for trade in trades)),
        "stress_cost_usd": rounded(
            sum(trade.stress_cost_usd for trade in trades)
        ),
        "severe_cost_usd": rounded(
            sum(trade.severe_cost_usd for trade in trades)
        ),
        "base_net_usd_per_1000": rounded(
            sum(trade.base_net_usd for trade in trades)
        ),
        "stress_net_usd_per_1000": rounded(
            sum(trade.stress_net_usd for trade in trades)
        ),
        "severe_net_usd_per_1000": rounded(
            sum(trade.severe_net_usd for trade in trades)
        ),
        "stress_maximum_drawdown_usd": rounded(
            maximum_drawdown(stress_hourly)
        ),
        "stress_maximum_drawdown_fraction": rounded(
            maximum_drawdown(stress_hourly) / CAPITAL
        ),
        "capacity_proxy_p05_usd": (
            rounded(percentile(capacities, 0.05), 2) if capacities else None
        ),
        "executable_capacity": "UNKNOWN",
    }


def evaluate_development(
    market: Market,
) -> tuple[
    dict[str, tuple[Trade, ...]],
    list[dict[str, object]],
    dict[str, object],
    bool,
]:
    trials = trial_family()
    signals = build_signal_book(
        market,
        {trial.lookback_hours for trial in trials},
        DEV_START_MS,
        DEV_END_MS,
    )
    trades_by_trial = {
        trial.trial_id: simulate_trial(
            market, signals, trial, DEV_START_MS, DEV_END_MS
        )
        for trial in trials
    }
    metrics = [
        trial_metrics(
            market,
            trial,
            trades_by_trial[trial.trial_id],
            DEV_START_MS,
            DEV_END_MS,
        )
        for trial in trials
    ]
    stress_vectors = [
        daily_vector(
            market,
            trades_by_trial[trial.trial_id],
            DEV_START_MS,
            DEV_END_MS,
            "stress",
        )
        for trial in trials
    ]
    samples = bootstrap_indices(len(stress_vectors[0]))
    raw_pvalues = {
        trial.trial_id: centered_bootstrap_pvalue(vector, samples)
        for trial, vector in zip(trials, stress_vectors)
    }
    adjusted = holm_adjust(raw_pvalues)
    reality_p = reality_check_pvalue(stress_vectors, samples)
    pbo = pbo_probability(stress_vectors)
    primary = primary_trial()
    primary_index = [trial.trial_id for trial in trials].index(primary.trial_id)
    primary_trades = trades_by_trial[primary.trial_id]
    primary_base = daily_vector(
        market, primary_trades, DEV_START_MS, DEV_END_MS, "base"
    )
    primary_stress = stress_vectors[primary_index]
    base_interval = bootstrap_interval(primary_base, samples)
    stress_interval = bootstrap_interval(primary_stress, samples)
    for metric in metrics:
        trial_id = cast(str, metric["trial_id"])
        metric["centered_bootstrap_p"] = rounded(raw_pvalues[trial_id])
        metric["holm_adjusted_p"] = rounded(adjusted[trial_id])
    primary_metric = next(
        metric for metric in metrics if metric["trial_id"] == primary.trial_id
    )
    primary_metric["base_bootstrap_90pct_interval_usd_per_1000"] = [
        rounded(base_interval[0]),
        rounded(base_interval[1]),
    ]
    primary_metric["stress_bootstrap_90pct_interval_usd_per_1000"] = [
        rounded(stress_interval[0]),
        rounded(stress_interval[1]),
    ]
    gates = {
        "minimum_primary_trades": primary_metric["trade_count"] >= 20,
        "minimum_active_iso_weeks": primary_metric["active_iso_weeks"] >= 12,
        "minimum_distinct_pairs": primary_metric["distinct_pairs"] >= 3,
        "trade_directions": set(primary_metric["directions"])
        == {"LONG_A_SHORT_B", "SHORT_A_LONG_B"},
        "base_total_gt_zero": primary_metric["base_net_usd_per_1000"] > 0,
        "stress_total_gt_zero": primary_metric["stress_net_usd_per_1000"] > 0,
        "stress_bootstrap_lower_gt_zero": stress_interval[0] > 0,
        "holm_adjusted_primary_p_lte_0p05": adjusted[primary.trial_id] <= 0.05,
        "reality_check_p_lte_0p05": reality_p <= 0.05,
        "maximum_drawdown_lte_10pct": (
            primary_metric["stress_maximum_drawdown_fraction"] <= 0.10
        ),
        "capacity_proxy_p05_gte_1000": (
            primary_metric["capacity_proxy_p05_usd"] is not None
            and primary_metric["capacity_proxy_p05_usd"] >= 1000
        ),
    }
    family = {
        "trial_count": len(trials),
        "bootstrap_replicates": BOOTSTRAP_REPLICATES,
        "bootstrap_seed": BOOTSTRAP_SEED,
        "multiplicity_method": "HOLM_12_PLUS_REALITY_CHECK",
        "reality_check_p": rounded(reality_p),
        "pbo": rounded(pbo),
        "pbo_role": "DIAGNOSTIC_ONLY",
        "pbo_cscv_splits": math.comb(8, 4),
        "primary_trial_id": primary.trial_id,
        "primary_gates": gates,
        "all_primary_gates_pass": all(gates.values()),
    }
    return trades_by_trial, metrics, family, all(gates.values())


def evaluate_holdout(
    market: Market,
    trial: Trial,
) -> tuple[tuple[Trade, ...], dict[str, object], dict[str, bool]]:
    signals = build_signal_book(
        market,
        (trial.lookback_hours,),
        HOLDOUT_START_MS,
        HOLDOUT_END_MS,
    )
    trades = simulate_trial(
        market, signals, trial, HOLDOUT_START_MS, HOLDOUT_END_MS
    )
    metrics = trial_metrics(
        market, trial, trades, HOLDOUT_START_MS, HOLDOUT_END_MS
    )
    stress = daily_vector(
        market, trades, HOLDOUT_START_MS, HOLDOUT_END_MS, "stress"
    )
    base = daily_vector(
        market, trades, HOLDOUT_START_MS, HOLDOUT_END_MS, "base"
    )
    samples = bootstrap_indices(
        len(stress), seed=BOOTSTRAP_SEED + 1
    )
    stress_interval = bootstrap_interval(stress, samples)
    base_interval = bootstrap_interval(base, samples)
    metrics["base_bootstrap_90pct_interval_usd_per_1000"] = [
        rounded(base_interval[0]),
        rounded(base_interval[1]),
    ]
    metrics["stress_bootstrap_90pct_interval_usd_per_1000"] = [
        rounded(stress_interval[0]),
        rounded(stress_interval[1]),
    ]
    gates = {
        "minimum_primary_trades": metrics["trade_count"] >= 8,
        "minimum_active_iso_weeks": metrics["active_iso_weeks"] >= 6,
        "minimum_distinct_pairs": metrics["distinct_pairs"] >= 2,
        "trade_directions": set(metrics["directions"])
        == {"LONG_A_SHORT_B", "SHORT_A_LONG_B"},
        "stress_total_gt_zero": metrics["stress_net_usd_per_1000"] > 0,
        "stress_bootstrap_lower_gt_zero": stress_interval[0] > 0,
        "maximum_drawdown_lte_10pct": (
            metrics["stress_maximum_drawdown_fraction"] <= 0.10
        ),
        "capacity_proxy_p05_gte_1000": (
            metrics["capacity_proxy_p05_usd"] is not None
            and metrics["capacity_proxy_p05_usd"] >= 1000
        ),
    }
    return trades, metrics, gates


def run(shared_root: Path) -> dict[str, object]:
    if shared_root.resolve() != EXPECTED_SHARED_ROOT.resolve():
        raise SealError("shared root does not match frozen read-only path")
    frozen, manifest = verify_freeze_bindings()
    marker_path = PACKET_DIR / "RUN_CONSUMED.v1.json"
    if marker_path.is_file():
        if (PACKET_DIR / "FINAL_RECEIPT.v1.json").is_file():
            raise SealError("sealed run is already terminal; rerun refused")
        return seal_consumed_failure(
            SealError("INTERRUPTED_SEAL_RECOVERY_WITHOUT_OUTCOME_REPLAY")
        )
    for name in RUN_OUTPUT_ARTIFACTS[1:]:
        if (PACKET_DIR / name).exists():
            raise SealError(f"run is unavailable; found {name}")
    run_marker = {
        "schema": "cosmos.s1y.run_consumed.v1",
        "milestone": "S-1Y",
        "created_at": utc_now(),
        "freeze_sha256": sha256_path(PACKET_DIR / "freeze.v1.json"),
        "preseal_sha256": frozen["preseal_sha256"],
        "source_manifest_sha256": frozen["source_manifest_sha256"],
        "trial_ids": [trial.trial_id for trial in trial_family()],
        "primary_trial_id": primary_trial().trial_id,
        "bootstrap_seed": BOOTSTRAP_SEED,
        "rerun": "REFUSED_FOREVER",
        "created_before_development_member_open": True,
    }
    create_once(PACKET_DIR / "RUN_CONSUMED.v1.json", run_marker)

    development_market = load_market(
        shared_root, manifest, NON_HOLDOUT_MONTHS
    )
    (
        trades_by_trial,
        development_metrics,
        family_metrics,
        admitted,
    ) = evaluate_development(development_market)
    primary = primary_trial()
    primary_trades = trades_by_trial[primary.trial_id]
    ledger = {
        "schema": "cosmos.s1y.development_ledger.v1",
        "created_at": utc_now(),
        "run_marker_sha256": sha256_path(PACKET_DIR / "RUN_CONSUMED.v1.json"),
        "freeze_sha256": sha256_path(PACKET_DIR / "freeze.v1.json"),
        "interval": "[2025-07-01T00:00:00Z,2026-03-01T00:00:00Z)",
        "metrics": development_metrics,
        "family_statistics": family_metrics,
        "primary_trades": [trade_to_json(trade) for trade in primary_trades],
    }
    create_once(PACKET_DIR / "development_ledger.v1.json", ledger)

    holdout_state = "UNOPENED_DEVELOPMENT_REJECTED"
    holdout_metrics: dict[str, object] | None = None
    holdout_gates: dict[str, bool] | None = None
    holdout_trades: tuple[Trade, ...] = ()
    if admitted:
        candidate_seal = {
            "schema": "cosmos.s1y.candidate_seal.v1",
            "created_at": utc_now(),
            "freeze_sha256": sha256_path(PACKET_DIR / "freeze.v1.json"),
            "run_marker_sha256": sha256_path(
                PACKET_DIR / "RUN_CONSUMED.v1.json"
            ),
            "development_ledger_sha256": sha256_path(
                PACKET_DIR / "development_ledger.v1.json"
            ),
            "primary_trial_id": primary.trial_id,
            "all_development_gates_pass": True,
        }
        create_once(PACKET_DIR / "candidate_seal.v1.json", candidate_seal)
        holdout_marker = {
            "schema": "cosmos.s1y.holdout_open.v1",
            "created_at": utc_now(),
            "freeze_sha256": sha256_path(PACKET_DIR / "freeze.v1.json"),
            "candidate_seal_sha256": sha256_path(
                PACKET_DIR / "candidate_seal.v1.json"
            ),
            "created_before_first_deferred_zip_hash": True,
            "months": list(DEFERRED_MONTHS),
        }
        create_once(PACKET_DIR / "HOLDOUT_OPEN.v1.json", holdout_marker)
        deferred_market = load_market(shared_root, manifest, DEFERRED_MONTHS)
        complete_market = merge_markets(development_market, deferred_market)
        holdout_trades, holdout_metrics, holdout_gates = evaluate_holdout(
            complete_market, primary
        )
        holdout_state = "OPENED_ON_DEVELOPMENT_ADMISSION"

    development_primary = next(
        metric
        for metric in development_metrics
        if metric["trial_id"] == primary.trial_id
    )
    if not admitted:
        verdict = "NO_GO"
        reason = "PREDECLARED_DEVELOPMENT_GATES_FAILED"
    elif holdout_gates is not None and not all(holdout_gates.values()):
        verdict = "NO_GO"
        reason = "PREDECLARED_HOLDOUT_GATES_FAILED"
    else:
        verdict = "UNMEASURED"
        reason = "PUBLIC_PROXY_POSITIVE_BUT_EXECUTION_ACCOUNT_AND_CAPACITY_TRUTH_UNKNOWN"

    full_window: dict[str, object]
    if holdout_metrics is None:
        full_window = {
            "status": "UNMEASURED",
            "reason": "HOLDOUT_UNOPENED_AFTER_DEVELOPMENT_REJECTION",
            "base_net_usd_per_1000": "UNMEASURED",
            "stress_net_usd_per_1000": "UNMEASURED",
            "bootstrap_90pct_interval_usd_per_1000": "UNMEASURED",
        }
    else:
        combined = primary_trades + holdout_trades
        combined_base = (
            daily_vector(
                development_market,
                primary_trades,
                DEV_START_MS,
                DEV_END_MS,
                "base",
            )
            + daily_vector(
                complete_market,
                holdout_trades,
                HOLDOUT_START_MS,
                HOLDOUT_END_MS,
                "base",
            )
        )
        combined_stress = (
            daily_vector(
                development_market,
                primary_trades,
                DEV_START_MS,
                DEV_END_MS,
                "stress",
            )
            + daily_vector(
                complete_market,
                holdout_trades,
                HOLDOUT_START_MS,
                HOLDOUT_END_MS,
                "stress",
            )
        )
        combined_samples = bootstrap_indices(
            len(combined_stress), seed=BOOTSTRAP_SEED + 2
        )
        full_window = {
            "status": "MEASURED_PUBLIC_PROXY",
            "calendar": "[2025-07-01T00:00:00Z,2026-07-01T00:00:00Z) excluding frozen 7-day embargo",
            "trade_count": len(combined),
            "base_net_usd_per_1000": rounded(sum(combined_base)),
            "stress_net_usd_per_1000": rounded(sum(combined_stress)),
            "base_bootstrap_90pct_interval_usd_per_1000": [
                rounded(value)
                for value in bootstrap_interval(combined_base, combined_samples)
            ],
            "stress_bootstrap_90pct_interval_usd_per_1000": [
                rounded(value)
                for value in bootstrap_interval(
                    combined_stress, combined_samples
                )
            ],
        }

    result = {
        "schema": "cosmos.s1y.result.v1",
        "milestone": "S-1Y",
        "created_at": utc_now(),
        "verdict": verdict,
        "reason": reason,
        "base_commit": BASE_COMMIT,
        "run_consumed": True,
        "rerun_allowed": False,
        "public_only": True,
        "authority": {
            "capital": "NONE",
            "execution": "NONE",
            "orders": "NONE",
            "money_effect_usd": 0,
        },
        "planned_window": "[2025-07-01T00:00:00Z,2026-07-01T00:00:00Z)",
        "reported_development_interval": "[2025-07-01T00:00:00Z,2026-03-01T00:00:00Z)",
        "development": {
            "primary": development_primary,
            "family_statistics": family_metrics,
        },
        "holdout": {
            "state": holdout_state,
            "interval": "[2026-03-08T00:00:00Z,2026-07-01T00:00:00Z)",
            "metrics": holdout_metrics,
            "gates": holdout_gates,
            "zip_payloads_read_or_hashed_by_s1y": admitted,
        },
        "full_window": full_window,
        "capacity": {
            "public_prior_day_quote_volume_proxy": development_primary[
                "capacity_proxy_p05_usd"
            ],
            "historical_exchange_filters": "UNAVAILABLE",
            "book_depth_spread_impact": "UNAVAILABLE",
            "executable_capacity": "UNMEASURED",
        },
        "cost_truth": {
            "base_proxy": "5 bps taker plus 2 bps adverse execution per fill",
            "stress_proxy": "8 bps taker plus 5 bps adverse execution per fill",
            "severe_proxy": "10 bps taker plus 10 bps adverse execution per fill",
            "account_effective_commission": "UNKNOWN",
        },
        "limitations": [
            "Hourly contract and mark opens are not fills.",
            "Historical tick, lot, market-lot, minimum-notional, and status snapshots are unavailable.",
            "Account-effective commission, book depth, spread, impact, latency, queueing, and liquidation mechanics are unknown.",
            "Funding settlement versus hourly-open ordering is unknown; only strictly interior funding events are booked.",
            "Drawdown uses hourly public contract-open marks, not executable account equity.",
            "A public-only positive proxy cannot authorize capital or execution.",
        ],
        "bindings": {
            "freeze_sha256": sha256_path(PACKET_DIR / "freeze.v1.json"),
            "run_marker_sha256": sha256_path(
                PACKET_DIR / "RUN_CONSUMED.v1.json"
            ),
            "development_ledger_sha256": sha256_path(
                PACKET_DIR / "development_ledger.v1.json"
            ),
            "candidate_seal_sha256": (
                sha256_path(PACKET_DIR / "candidate_seal.v1.json")
                if (PACKET_DIR / "candidate_seal.v1.json").is_file()
                else None
            ),
            "holdout_open_sha256": (
                sha256_path(PACKET_DIR / "HOLDOUT_OPEN.v1.json")
                if (PACKET_DIR / "HOLDOUT_OPEN.v1.json").is_file()
                else None
            ),
        },
    }
    create_once(PACKET_DIR / "result.v1.json", result)
    ensure_final_receipt(result)
    return result


def expected_final_receipt_fields(
    result: Mapping[str, object],
) -> dict[str, object]:
    bindings = result.get("bindings")
    if not isinstance(bindings, dict):
        raise SealError("cannot seal result without bindings")
    return {
        "schema": "cosmos.s1y.final_receipt.v1",
        "verdict": result.get("verdict"),
        "freeze_sha256": bindings.get("freeze_sha256"),
        "run_marker_sha256": bindings.get("run_marker_sha256"),
        "development_ledger_sha256": bindings.get(
            "development_ledger_sha256"
        ),
        "result_sha256": sha256_path(PACKET_DIR / "result.v1.json"),
        "candidate_seal_sha256": bindings.get("candidate_seal_sha256"),
        "holdout_open_sha256": bindings.get("holdout_open_sha256"),
        "terminal_failure_sha256": bindings.get(
            "terminal_failure_sha256"
        ),
    }


def ensure_final_receipt(
    result: Mapping[str, object],
) -> dict[str, object]:
    path = PACKET_DIR / "FINAL_RECEIPT.v1.json"
    expected = expected_final_receipt_fields(result)
    if path.is_file():
        existing = read_json(path)
        for field, value in expected.items():
            if existing.get(field) != value:
                raise SealError(f"existing final receipt mismatch: {field}")
        return existing
    receipt = {"created_at": utc_now(), **expected}
    create_once(path, receipt)
    return receipt


def seal_consumed_failure(error: Exception) -> dict[str, object]:
    marker_path = PACKET_DIR / "RUN_CONSUMED.v1.json"
    if not marker_path.is_file():
        raise error
    result_path = PACKET_DIR / "result.v1.json"
    if result_path.is_file():
        result = read_json(result_path)
        ensure_final_receipt(result)
        return result
    if (PACKET_DIR / "HOLDOUT_OPEN.v1.json").is_file():
        stage = "DEFERRED_HOLDOUT_CUSTODY_OR_EVALUATION"
    elif (PACKET_DIR / "candidate_seal.v1.json").is_file():
        stage = "CANDIDATE_TO_HOLDOUT_TRANSITION"
    elif (PACKET_DIR / "development_ledger.v1.json").is_file():
        stage = "POST_DEVELOPMENT_SEALING"
    else:
        stage = "DEVELOPMENT_CUSTODY_SCHEMA_OR_EVALUATION"
    failure_path = PACKET_DIR / "terminal_failure.v1.json"
    if failure_path.is_file():
        failure = read_json(failure_path)
        if (
            failure.get("verdict") != "UNMEASURED"
            or failure.get("freeze_sha256")
            != sha256_path(PACKET_DIR / "freeze.v1.json")
            or failure.get("run_marker_sha256") != sha256_path(marker_path)
        ):
            raise SealError("existing terminal failure binding mismatch")
        stage = str(failure.get("stage"))
    else:
        failure = {
            "schema": "cosmos.s1y.terminal_failure.v1",
            "milestone": "S-1Y",
            "created_at": utc_now(),
            "verdict": "UNMEASURED",
            "stage": stage,
            "error_class": type(error).__name__,
            "error": str(error)[:500],
            "freeze_sha256": sha256_path(PACKET_DIR / "freeze.v1.json"),
            "run_marker_sha256": sha256_path(marker_path),
            "rerun_allowed": False,
            "authority": "NONE",
        }
        create_once(failure_path, failure)
    bindings = {
        "freeze_sha256": sha256_path(PACKET_DIR / "freeze.v1.json"),
        "run_marker_sha256": sha256_path(marker_path),
        "development_ledger_sha256": (
            sha256_path(PACKET_DIR / "development_ledger.v1.json")
            if (PACKET_DIR / "development_ledger.v1.json").is_file()
            else None
        ),
        "candidate_seal_sha256": (
            sha256_path(PACKET_DIR / "candidate_seal.v1.json")
            if (PACKET_DIR / "candidate_seal.v1.json").is_file()
            else None
        ),
        "holdout_open_sha256": (
            sha256_path(PACKET_DIR / "HOLDOUT_OPEN.v1.json")
            if (PACKET_DIR / "HOLDOUT_OPEN.v1.json").is_file()
            else None
        ),
        "terminal_failure_sha256": sha256_path(
            failure_path
        ),
    }
    result = {
        "schema": "cosmos.s1y.result.v1",
        "milestone": "S-1Y",
        "created_at": utc_now(),
        "verdict": "UNMEASURED",
        "reason": "SEALED_RUN_FAILURE",
        "failure_stage": stage,
        "run_consumed": True,
        "rerun_allowed": False,
        "public_only": True,
        "authority": {
            "capital": "NONE",
            "execution": "NONE",
            "orders": "NONE",
            "money_effect_usd": 0,
        },
        "development": "UNMEASURED",
        "holdout": "UNMEASURED",
        "full_window": "UNMEASURED",
        "bindings": bindings,
    }
    create_once(result_path, result)
    ensure_final_receipt(result)
    return result


def zero_effects() -> dict[str, object]:
    return {
        "host": False,
        "money_usd": 0,
        "orders": False,
        "private": False,
        "provider": False,
        "transfers": False,
        "ui": False,
        "withdrawals": False,
    }


def verify(shared_root: Path) -> dict[str, object]:
    if shared_root.resolve() != EXPECTED_SHARED_ROOT.resolve():
        raise SealError("shared root does not match frozen read-only path")
    frozen, manifest = verify_freeze_bindings()
    result_path = PACKET_DIR / "result.v1.json"
    marker_path = PACKET_DIR / "RUN_CONSUMED.v1.json"
    receipt_path = PACKET_DIR / "FINAL_RECEIPT.v1.json"
    for path in (result_path, marker_path, receipt_path):
        if not path.is_file():
            raise SealError(f"terminal artifact missing: {path.name}")
    result = read_json(PACKET_DIR / "result.v1.json")
    marker = read_json(PACKET_DIR / "RUN_CONSUMED.v1.json")
    receipt = read_json(receipt_path)
    freeze_hash = sha256_path(PACKET_DIR / "freeze.v1.json")
    marker_hash = sha256_path(marker_path)
    result_hash = sha256_path(result_path)
    if marker.get("freeze_sha256") != sha256_path(PACKET_DIR / "freeze.v1.json"):
        raise SealError("run marker freeze binding mismatch")
    bindings = result.get("bindings")
    if not isinstance(bindings, dict):
        raise SealError("result bindings missing")
    expected_binding_paths = {
        "freeze_sha256": PACKET_DIR / "freeze.v1.json",
        "run_marker_sha256": marker_path,
        "development_ledger_sha256": PACKET_DIR
        / "development_ledger.v1.json",
        "candidate_seal_sha256": PACKET_DIR / "candidate_seal.v1.json",
        "holdout_open_sha256": PACKET_DIR / "HOLDOUT_OPEN.v1.json",
        "terminal_failure_sha256": PACKET_DIR / "terminal_failure.v1.json",
    }
    for field, path in expected_binding_paths.items():
        expected_hash = sha256_path(path) if path.is_file() else None
        if bindings.get(field) != expected_hash:
            raise SealError(f"result chain binding mismatch: {field}")
        if receipt.get(field) != expected_hash:
            raise SealError(f"final receipt binding mismatch: {field}")
    if receipt.get("result_sha256") != result_hash:
        raise SealError("final receipt does not pin result")
    if receipt.get("verdict") != result.get("verdict"):
        raise SealError("final receipt verdict mismatch")
    terminal_path = PACKET_DIR / "terminal_failure.v1.json"
    terminal = terminal_path.is_file()
    if terminal:
        failure = read_json(terminal_path)
        if (
            result.get("verdict") != "UNMEASURED"
            or result.get("reason") != "SEALED_RUN_FAILURE"
            or failure.get("verdict") != "UNMEASURED"
            or failure.get("freeze_sha256") != freeze_hash
            or failure.get("run_marker_sha256") != marker_hash
            or result.get("failure_stage") != failure.get("stage")
        ):
            raise SealError("terminal failure/result contradiction")
        ledger_path = PACKET_DIR / "development_ledger.v1.json"
        candidate_path = PACKET_DIR / "candidate_seal.v1.json"
        holdout_marker_path = PACKET_DIR / "HOLDOUT_OPEN.v1.json"
        if ledger_path.is_file():
            ledger = read_json(ledger_path)
            if (
                ledger.get("run_marker_sha256") != marker_hash
                or ledger.get("freeze_sha256") != freeze_hash
            ):
                raise SealError("terminal ledger chain mismatch")
        if candidate_path.is_file():
            candidate = read_json(candidate_path)
            if (
                not ledger_path.is_file()
                or candidate.get("freeze_sha256") != freeze_hash
                or candidate.get("run_marker_sha256") != marker_hash
                or candidate.get("development_ledger_sha256")
                != sha256_path(ledger_path)
            ):
                raise SealError("terminal candidate chain mismatch")
        if holdout_marker_path.is_file():
            holdout_marker = read_json(holdout_marker_path)
            if (
                not candidate_path.is_file()
                or holdout_marker.get("freeze_sha256") != freeze_hash
                or holdout_marker.get("candidate_seal_sha256")
                != sha256_path(candidate_path)
            ):
                raise SealError("terminal holdout chain mismatch")
        return {
            "schema": "cosmos.s1y.verification.v1",
            "status": "PASS_TERMINAL_UNMEASURED",
            "verdict": "UNMEASURED",
            "failure_stage": failure.get("stage"),
            "result_sha256": result_hash,
            "final_receipt_sha256": sha256_path(receipt_path),
            "source_payload_reverification": "SKIPPED_SEALED_FAILURE",
            "shared_archive_policy": "READ_ONLY",
            "effects": zero_effects(),
        }

    ledger_path = PACKET_DIR / "development_ledger.v1.json"
    if not ledger_path.is_file():
        raise SealError("normal terminal packet lacks development ledger")
    ledger = read_json(ledger_path)
    if (
        ledger.get("run_marker_sha256") != marker_hash
        or ledger.get("freeze_sha256") != freeze_hash
    ):
        raise SealError("ledger chain binding mismatch")
    development = result.get("development")
    if not isinstance(development, dict):
        raise SealError("result development metrics missing")
    if (
        development.get("family_statistics")
        != ledger.get("family_statistics")
    ):
        raise SealError("result/ledger family statistics mismatch")
    ledger_metrics = ledger.get("metrics")
    if not isinstance(ledger_metrics, list):
        raise SealError("ledger metrics missing")
    ledger_primary = next(
        (
            metric
            for metric in ledger_metrics
            if isinstance(metric, dict)
            and metric.get("trial_id") == primary_trial().trial_id
        ),
        None,
    )
    if development.get("primary") != ledger_primary:
        raise SealError("result/ledger primary metrics mismatch")
    family = ledger.get("family_statistics")
    if not isinstance(family, dict):
        raise SealError("ledger family statistics missing")
    gates = family.get("primary_gates")
    if not isinstance(gates, dict):
        raise SealError("development gates missing")
    admitted = all(value is True for value in gates.values())
    if family.get("all_primary_gates_pass") is not admitted:
        raise SealError("development admission derivation mismatch")
    candidate_path = PACKET_DIR / "candidate_seal.v1.json"
    holdout_marker_path = PACKET_DIR / "HOLDOUT_OPEN.v1.json"
    if candidate_path.is_file() is not admitted:
        raise SealError("candidate seal contradicts development admission")
    if holdout_marker_path.is_file() is not admitted:
        raise SealError("holdout marker contradicts development admission")
    if admitted:
        candidate = read_json(candidate_path)
        holdout_marker = read_json(holdout_marker_path)
        if (
            candidate.get("freeze_sha256") != freeze_hash
            or candidate.get("run_marker_sha256") != marker_hash
            or candidate.get("development_ledger_sha256")
            != sha256_path(ledger_path)
            or candidate.get("all_development_gates_pass") is not True
        ):
            raise SealError("candidate seal chain mismatch")
        if (
            holdout_marker.get("freeze_sha256") != freeze_hash
            or holdout_marker.get("candidate_seal_sha256")
            != sha256_path(candidate_path)
        ):
            raise SealError("holdout marker chain mismatch")
    holdout = result.get("holdout")
    if not isinstance(holdout, dict):
        raise SealError("result holdout state missing")
    if bool(holdout.get("zip_payloads_read_or_hashed_by_s1y")) is not admitted:
        raise SealError("result holdout-open state mismatch")
    if not admitted:
        if (
            result.get("verdict") != "NO_GO"
            or result.get("reason")
            != "PREDECLARED_DEVELOPMENT_GATES_FAILED"
            or holdout.get("metrics") is not None
            or holdout.get("gates") is not None
        ):
            raise SealError("development rejection verdict mismatch")
    else:
        holdout_gates = holdout.get("gates")
        if not isinstance(holdout_gates, dict):
            raise SealError("opened holdout gates missing")
        holdout_pass = all(value is True for value in holdout_gates.values())
        expected_verdict = "UNMEASURED" if holdout_pass else "NO_GO"
        expected_reason = (
            "PUBLIC_PROXY_POSITIVE_BUT_EXECUTION_ACCOUNT_AND_CAPACITY_TRUTH_UNKNOWN"
            if holdout_pass
            else "PREDECLARED_HOLDOUT_GATES_FAILED"
        )
        if (
            result.get("verdict") != expected_verdict
            or result.get("reason") != expected_reason
        ):
            raise SealError("holdout verdict derivation mismatch")
    index = manifest_index(manifest)
    verified_non_holdout = 0
    for month in NON_HOLDOUT_MONTHS:
        for symbol in SYMBOLS:
            for dataset in DATASETS:
                verify_manifest_payload(
                    shared_root, index[(dataset, symbol, month)]
                )
                verified_non_holdout += 1
    marker_exists = (PACKET_DIR / "HOLDOUT_OPEN.v1.json").is_file()
    if bool(holdout.get("zip_payloads_read_or_hashed_by_s1y")) != marker_exists:
        raise SealError("holdout marker/state contradiction")
    if marker_exists:
        for month in DEFERRED_MONTHS:
            for symbol in SYMBOLS:
                for dataset in DATASETS:
                    verify_manifest_payload(
                        shared_root, index[(dataset, symbol, month)]
                    )
    else:
        for month in DEFERRED_MONTHS:
            for symbol in SYMBOLS:
                for dataset in DATASETS:
                    if (
                        index[(dataset, symbol, month)].get("zip_verification")
                        != "DEFERRED_UNTOUCHED"
                    ):
                        raise SealError("deferred manifest state changed")
    return {
        "schema": "cosmos.s1y.verification.v1",
        "status": "PASS",
        "verdict": result.get("verdict"),
        "freeze_sha256": sha256_path(PACKET_DIR / "freeze.v1.json"),
        "result_sha256": result_hash,
        "final_receipt_sha256": sha256_path(receipt_path),
        "verified_non_holdout_zip_count": verified_non_holdout,
        "holdout_open_marker": marker_exists,
        "holdout_zip_payload_verification": (
            len(DEFERRED_MONTHS) * len(SYMBOLS) * len(DATASETS)
            if marker_exists
            else "SKIPPED_UNTOUCHED"
        ),
        "shared_archive_policy": "READ_ONLY",
        "effects": zero_effects(),
        "frozen_deferred_count": frozen.get(
            "deferred_embargo_holdout_zip_count"
        ),
    }


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("freeze", "run", "verify"))
    parser.add_argument(
        "--shared-root",
        type=Path,
        default=EXPECTED_SHARED_ROOT,
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    try:
        if args.command == "freeze":
            output = freeze(args.shared_root)
        elif args.command == "run":
            output = run(args.shared_root)
        else:
            output = verify(args.shared_root)
    except Exception as error:
        if args.command == "run" and (
            PACKET_DIR / "RUN_CONSUMED.v1.json"
        ).is_file() and not (
            PACKET_DIR / "FINAL_RECEIPT.v1.json"
        ).is_file():
            try:
                output = seal_consumed_failure(error)
            except Exception as sealing_error:
                print(
                    json.dumps(
                        {
                            "schema": "cosmos.s1y.command_failure.v1",
                            "command": args.command,
                            "error": str(sealing_error),
                            "status": "FAIL_CLOSED_SEALING_ERROR",
                        },
                        sort_keys=True,
                    ),
                    file=sys.stderr,
                )
                return 1
            print(json.dumps(output, allow_nan=False, sort_keys=True))
            return 0
        print(
            json.dumps(
                {
                    "schema": "cosmos.s1y.command_failure.v1",
                    "command": args.command,
                    "error": str(error),
                    "status": "FAIL_CLOSED",
                },
                sort_keys=True,
            ),
            file=sys.stderr,
        )
        return 1
    print(json.dumps(output, allow_nan=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
