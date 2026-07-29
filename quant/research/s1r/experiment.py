#!/usr/bin/env python3
"""Deterministic, network-free S-1R sealed public research evaluator.

The lifecycle is deliberately split:

    prepare -> run

``prepare`` authenticates checksum-addressed compressed files but never opens a
ZIP member. ``run`` creates its create-once marker before the first member open.
Holdout members are inaccessible until a development champion and holdout-open
marker exist.
"""

from __future__ import annotations

import argparse
import ast
import bisect
import contextlib
import csv
import hashlib
import io
import itertools
import json
import math
import os
import random
import sys
import zipfile
from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal, InvalidOperation, localcontext
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
PROTOCOL_PATH = HERE / "protocol.v1.json"
README_PATH = HERE / "README.md"
RESEARCH_PATH = HERE / "OFFICIAL_SOURCE_RESEARCH.md"
TEST_PATH = HERE / "test_experiment.py"
VERIFIER_PATH = HERE / "verifier.py"
VERIFIER_TEST_PATH = HERE / "test_verifier.py"

SOURCE_MANIFEST_NAME = "source_manifest.v1.json"
FREEZE_NAME = "freeze.v1.json"
RUN_NAME = "run_consumed.v1.json"
DEVELOPMENT_NAME = "development.v1.json"
CHAMPION_NAME = "champion.v1.json"
HOLDOUT_OPEN_NAME = "holdout_open.v1.json"
HOLDOUT_NAME = "holdout.v1.json"
RESULT_NAME = "result.v1.json"

SOURCE_MANIFEST_PATH = HERE / SOURCE_MANIFEST_NAME
FREEZE_PATH = HERE / FREEZE_NAME
RUN_PATH = HERE / RUN_NAME
DEVELOPMENT_PATH = HERE / DEVELOPMENT_NAME
CHAMPION_PATH = HERE / CHAMPION_NAME
HOLDOUT_OPEN_PATH = HERE / HOLDOUT_OPEN_NAME
HOLDOUT_PATH = HERE / HOLDOUT_NAME
RESULT_PATH = HERE / RESULT_NAME

GENERATED_PATHS = (
    SOURCE_MANIFEST_PATH,
    FREEZE_PATH,
    RUN_PATH,
    DEVELOPMENT_PATH,
    CHAMPION_PATH,
    HOLDOUT_OPEN_PATH,
    HOLDOUT_PATH,
    RESULT_PATH,
)

FIVE_MINUTES_MS = 300_000
DAY_MS = 86_400_000
DAY_BARS = 288
TEN_THOUSAND = Decimal("10000")
ZERO = Decimal("0")
ONE = Decimal("1")
BASE_COMMIT = "a169b123fb186d1943a75ad648552c4d95be1be1"
EXPECTED_DISCOVERY_SHA256 = "5fd5924a63fd31c08378002e3d508d6de5d895383c3322ce3cd82caad35b1c0f"


class S1RError(RuntimeError):
    """Stable, machine-readable experiment failure."""

    def __init__(self, code: str, detail: str = ""):
        super().__init__(f"{code}: {detail}" if detail else code)
        self.code = code
        self.detail = detail


class ContractError(S1RError):
    """Frozen contract or lifecycle failure."""


class EvidenceError(S1RError):
    """Public source or measurement failure."""


def canonical_bytes(value: Any) -> bytes:
    return (
        json.dumps(
            value,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
            allow_nan=False,
        ).encode("utf-8")
        + b"\n"
    )


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError as exc:
        raise ContractError("FILE_HASH_FAILED", f"{path}: {exc}") from exc
    return digest.hexdigest()


def load_json(path: Path) -> Any:
    try:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, json.JSONDecodeError) as exc:
        raise ContractError("JSON_READ_FAILED", f"{path}: {exc}") from exc


def utc_now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def artifact(document: Mapping[str, Any]) -> dict[str, Any]:
    signed = dict(document)
    if "artifactSha256" in signed:
        raise ContractError("ARTIFACT_ALREADY_SIGNED")
    signed["artifactSha256"] = sha256_bytes(canonical_bytes(signed))
    return signed


def verify_artifact(path: Path, schema: str) -> dict[str, Any]:
    raw = load_json(path)
    if not isinstance(raw, dict) or raw.get("schema") != schema:
        raise ContractError("ARTIFACT_SCHEMA_INVALID", f"{path}: {schema}")
    digest = raw.get("artifactSha256")
    if not isinstance(digest, str):
        raise ContractError("ARTIFACT_DIGEST_MISSING", str(path))
    unsigned = dict(raw)
    del unsigned["artifactSha256"]
    if sha256_bytes(canonical_bytes(unsigned)) != digest:
        raise ContractError("ARTIFACT_DIGEST_INVALID", str(path))
    return dict(raw)


def write_once_json(path: Path, document: Mapping[str, Any]) -> None:
    payload = canonical_bytes(document)
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    try:
        descriptor = os.open(path, flags, 0o600)
    except FileExistsError as exc:
        raise ContractError("CREATE_ONCE_REFUSED", str(path)) from exc
    try:
        with os.fdopen(descriptor, "wb", closefd=True) as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
    except BaseException:
        with contextlib.suppress(OSError):
            path.unlink()
        raise


def decimal(value: Any, field: str) -> Decimal:
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise EvidenceError("DECIMAL_INVALID", f"{field}={value!r}") from exc
    if not number.is_finite():
        raise EvidenceError("DECIMAL_NONFINITE", f"{field}={value!r}")
    return number


def dstr(value: Decimal, places: str | None = None) -> str:
    if places is not None:
        value = value.quantize(Decimal(places))
    if value == ZERO:
        return "0"
    return format(value, "f")


def parse_utc_ms(value: str) -> int:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ContractError("UTC_REQUIRED", value)
    return int(parsed.astimezone(UTC).timestamp() * 1000)


def utc_date(ts_ms: int) -> str:
    return datetime.fromtimestamp(ts_ms / 1000, UTC).strftime("%Y-%m-%d")


def utc_month(ts_ms: int) -> str:
    return datetime.fromtimestamp(ts_ms / 1000, UTC).strftime("%Y-%m")


def utc_week(ts_ms: int) -> str:
    return datetime.fromtimestamp(ts_ms / 1000, UTC).strftime("%G-W%V")


def date_range(start_ms: int, end_ms: int) -> tuple[str, ...]:
    current = datetime.fromtimestamp(start_ms / 1000, UTC)
    end = datetime.fromtimestamp(end_ms / 1000, UTC)
    values: list[str] = []
    while current < end:
        values.append(current.strftime("%Y-%m-%d"))
        current += timedelta(days=1)
    return tuple(values)


def median(values: Sequence[Decimal]) -> Decimal:
    if not values:
        raise EvidenceError("MEDIAN_EMPTY")
    ordered = sorted(values)
    midpoint = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[midpoint]
    return (ordered[midpoint - 1] + ordered[midpoint]) / Decimal(2)


def normalized_funding_bps(rate: Decimal, interval_hours: Decimal) -> Decimal:
    if interval_hours <= ZERO:
        raise EvidenceError("FUNDING_INTERVAL_NONPOSITIVE", dstr(interval_hours))
    return TEN_THOUSAND * rate * Decimal(8) / interval_hours


def funding_surprise_z(
    current: Funding,
    prior: Sequence[Funding],
    minimum_scale_bps: Decimal = Decimal("0.25"),
) -> Decimal | None:
    """Return the positive same-sign surprise; current is never in the baseline."""

    if current.rate <= ZERO or not prior or any(item.rate <= ZERO for item in prior):
        return None
    history = [normalized_funding_bps(item.rate, item.interval_hours) for item in prior]
    location = median(history)
    mad = median([abs(value - location) for value in history])
    scale = max(Decimal("1.4826") * mad, minimum_scale_bps)
    current_value = normalized_funding_bps(current.rate, current.interval_hours)
    return (current_value - location) / scale


def basis_bps(spot: Decimal, perpetual: Decimal) -> Decimal:
    if spot <= ZERO or perpetual <= ZERO:
        raise EvidenceError("BASIS_PRICE_NONPOSITIVE")
    with localcontext() as context:
        context.prec = 40
        return TEN_THOUSAND * (perpetual / spot).ln()


def first_entry_index(clocks: Sequence[int], settlement_ms: int, delay_seconds: int) -> int:
    eligible_after = settlement_ms + (delay_seconds * 1000)
    return bisect.bisect_right(clocks, eligible_after)


@dataclass(frozen=True)
class Bar:
    ts_ms: int
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    quote_volume: Decimal


@dataclass(frozen=True)
class Funding:
    ts_ms: int
    interval_hours: Decimal
    rate: Decimal


@dataclass(frozen=True)
class Trial:
    trial_id: str
    lookback: int
    threshold_z: Decimal
    hold_minutes: int


@dataclass(frozen=True)
class Candidate:
    symbol: str
    event: Funding
    z: Decimal
    entry_index: int
    exit_index: int
    current_row_implied_next_settlement_ms: int


@dataclass(frozen=True)
class Trade:
    trial_id: str
    symbol: str
    event_ts_ms: int
    entry_index: int
    exit_index: int
    entry_ts_ms: int
    exit_ts_ms: int
    surprise_z: Decimal
    quantity: Decimal
    entry_spot: Decimal
    entry_perpetual: Decimal
    exit_spot: Decimal
    exit_perpetual: Decimal
    entry_basis_bps: Decimal
    exit_basis_bps: Decimal
    gross_pnl: Decimal
    net_by_cost: Mapping[str, Decimal]
    capacity_proxy_usd: Decimal


@dataclass(frozen=True)
class PhaseData:
    phase: str
    start_ms: int
    end_ms: int
    bars: Mapping[str, Mapping[str, tuple[Bar, ...]]]
    funding: Mapping[str, tuple[Funding, ...]]


@dataclass(frozen=True)
class TrialResult:
    trial: Trial
    phase: str
    trades: tuple[Trade, ...]
    dates: tuple[str, ...]
    daily_net_by_cost: Mapping[str, tuple[Decimal, ...]]
    severe_drawdown_pct: Decimal
    rejection_counts: Mapping[str, int]


def expected_source_keys(protocol: Mapping[str, Any]) -> set[tuple[str, str, str]]:
    months = list(protocol["calendar"]["development"]["months"]) + list(
        protocol["calendar"]["holdout"]["months"]
    )
    return {
        (kind, symbol, month)
        for kind in (
            "fundingRate",
            "markPriceKlines",
            "perpetualKlines",
            "spotKlines",
        )
        for symbol in protocol["data"]["symbols"]
        for month in months
    }


def validate_discovery(
    discovery: Any, protocol: Mapping[str, Any]
) -> dict[tuple[str, str, str], dict[str, Any]]:
    if not isinstance(discovery, dict):
        raise EvidenceError("DISCOVERY_ROOT_INVALID")
    if discovery.get("archiveBodiesOpened") is not False:
        raise EvidenceError("DISCOVERY_OPEN_POSTURE_INVALID")
    rows = discovery.get("sources")
    if not isinstance(rows, list):
        raise EvidenceError("DISCOVERY_SOURCES_INVALID")
    if len(rows) != int(protocol["data"]["archiveCount"]):
        raise EvidenceError("DISCOVERY_COUNT_INVALID", str(len(rows)))
    expected = expected_source_keys(protocol)
    development = set(protocol["calendar"]["development"]["months"])
    indexed: dict[tuple[str, str, str], dict[str, Any]] = {}
    for raw in rows:
        if not isinstance(raw, dict):
            raise EvidenceError("DISCOVERY_ROW_INVALID")
        key = (
            str(raw.get("kind")),
            str(raw.get("symbol")),
            str(raw.get("month")),
        )
        if key not in expected:
            raise EvidenceError("DISCOVERY_UNEXPECTED_ROW", repr(key))
        if key in indexed:
            raise EvidenceError("DISCOVERY_DUPLICATE_ROW", repr(key))
        expected_phase = "development" if key[2] in development else "holdout"
        if raw.get("phase") != expected_phase:
            raise EvidenceError("DISCOVERY_PHASE_INVALID", repr(key))
        for field in ("sha256", "checksumSidecarSha256"):
            value = raw.get(field)
            if not isinstance(value, str) or len(value) != 64:
                raise EvidenceError("DISCOVERY_DIGEST_INVALID", f"{key}:{field}")
        indexed[key] = dict(raw)
    if set(indexed) != expected:
        raise EvidenceError("DISCOVERY_KEYSET_INVALID")
    return indexed


def protocol_document() -> dict[str, Any]:
    raw = load_json(PROTOCOL_PATH)
    if not isinstance(raw, dict):
        raise ContractError("PROTOCOL_ROOT_INVALID")
    if raw.get("baseCommit") != BASE_COMMIT:
        raise ContractError("PROTOCOL_BASE_INVALID")
    if raw.get("schema") != "cosmos.quant.research.s1r.protocol.v1":
        raise ContractError("PROTOCOL_SCHEMA_INVALID")
    return dict(raw)


def ensure_implementation_is_network_free() -> None:
    forbidden = {
        "aiohttp",
        "http",
        "requests",
        "socket",
        "subprocess",
        "urllib",
    }
    tree = ast.parse(Path(__file__).read_text(encoding="utf-8"))
    imported: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported.update(alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            imported.add(node.module.split(".")[0])
    collision = sorted(forbidden & imported)
    if collision:
        raise ContractError("NETWORK_OR_PROCESS_IMPORT_FORBIDDEN", repr(collision))


def prepare() -> dict[str, Any]:
    """Bind compressed archive bytes and freeze inputs without a ZIP-member open."""

    ensure_implementation_is_network_free()
    if any(path.exists() for path in GENERATED_PATHS):
        raise ContractError("PREPARE_REQUIRES_PRISTINE_GENERATED_STATE")
    protocol = protocol_document()
    discovery_path = Path(protocol["data"]["sharedDiscoveryPath"])
    discovery_sha = sha256_file(discovery_path)
    if discovery_sha != EXPECTED_DISCOVERY_SHA256:
        raise EvidenceError("DISCOVERY_SHA256_MISMATCH", discovery_sha)
    indexed = validate_discovery(load_json(discovery_path), protocol)
    archive_root = Path(protocol["data"]["sharedArchiveRoot"]).resolve()
    entries: list[dict[str, Any]] = []
    for key in sorted(indexed):
        row = indexed[key]
        expected_sha = str(row["sha256"])
        archive_path = (archive_root / f"{expected_sha}.zip").resolve()
        if archive_path.parent != archive_root:
            raise EvidenceError("ARCHIVE_PATH_ESCAPE", str(archive_path))
        actual_sha = sha256_file(archive_path)
        if actual_sha != expected_sha:
            raise EvidenceError("ARCHIVE_SHA256_MISMATCH", repr(key))
        entries.append(
            {
                "kind": key[0],
                "symbol": key[1],
                "month": key[2],
                "phase": row["phase"],
                "url": row["url"],
                "checksumUrl": row["checksumUrl"],
                "publisherSha256": expected_sha,
                "verifiedCompressedSha256": actual_sha,
                "checksumSidecarSha256": row["checksumSidecarSha256"],
                "compressedBytes": archive_path.stat().st_size,
                "selectedForMemberOpen": key[0] in set(protocol["data"]["seriesOpened"]),
            }
        )
    manifest = artifact(
        {
            "schema": "cosmos.quant.research.s1r.source_manifest.v1",
            "protocolId": protocol["protocolId"],
            "createdAt": utc_now(),
            "discoveryPath": str(discovery_path),
            "discoverySha256": discovery_sha,
            "archiveRoot": str(archive_root),
            "archivePolicy": "READ_ONLY",
            "zipMembersOpened": False,
            "entryCount": len(entries),
            "entries": entries,
        }
    )
    write_once_json(SOURCE_MANIFEST_PATH, manifest)
    static_paths = (
        README_PATH,
        RESEARCH_PATH,
        PROTOCOL_PATH,
        Path(__file__),
        TEST_PATH,
        VERIFIER_PATH,
        VERIFIER_TEST_PATH,
        SOURCE_MANIFEST_PATH,
    )
    missing = [str(path) for path in static_paths if not path.is_file()]
    if missing:
        raise ContractError("FREEZE_INPUT_MISSING", repr(missing))
    freeze = artifact(
        {
            "schema": "cosmos.quant.research.s1r.freeze.v1",
            "protocolId": protocol["protocolId"],
            "baseCommit": BASE_COMMIT,
            "createdAt": utc_now(),
            "status": "SEALED_DEVELOPMENT_AND_HOLDOUT_MEMBERS_CLOSED",
            "archiveMemberOpenCount": 0,
            "holdoutState": "CLOSED_UNREAD",
            "bindings": {
                path.name: sha256_file(path)
                for path in sorted(static_paths, key=lambda item: item.name)
            },
        }
    )
    write_once_json(FREEZE_PATH, freeze)
    return freeze


def verify_freeze() -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    protocol = protocol_document()
    manifest = verify_artifact(SOURCE_MANIFEST_PATH, "cosmos.quant.research.s1r.source_manifest.v1")
    freeze = verify_artifact(FREEZE_PATH, "cosmos.quant.research.s1r.freeze.v1")
    if freeze.get("baseCommit") != BASE_COMMIT:
        raise ContractError("FREEZE_BASE_INVALID")
    if freeze.get("holdoutState") != "CLOSED_UNREAD":
        raise ContractError("FREEZE_HOLDOUT_STATE_INVALID")
    bindings = freeze.get("bindings")
    if not isinstance(bindings, dict):
        raise ContractError("FREEZE_BINDINGS_INVALID")
    required = {
        README_PATH.name,
        RESEARCH_PATH.name,
        PROTOCOL_PATH.name,
        Path(__file__).name,
        TEST_PATH.name,
        VERIFIER_PATH.name,
        VERIFIER_TEST_PATH.name,
        SOURCE_MANIFEST_PATH.name,
    }
    if set(bindings) != required:
        raise ContractError("FREEZE_BINDING_SET_INVALID")
    for name, expected in bindings.items():
        path = HERE / str(name)
        if sha256_file(path) != str(expected):
            raise ContractError("FREEZE_BINDING_DRIFT", str(name))
    if manifest.get("discoverySha256") != EXPECTED_DISCOVERY_SHA256:
        raise ContractError("MANIFEST_DISCOVERY_BINDING_INVALID")
    return protocol, manifest, freeze


def manifest_index(
    manifest: Mapping[str, Any],
) -> dict[tuple[str, str, str], dict[str, Any]]:
    rows = manifest.get("entries")
    if not isinstance(rows, list):
        raise ContractError("MANIFEST_ENTRIES_INVALID")
    indexed: dict[tuple[str, str, str], dict[str, Any]] = {}
    for row in rows:
        if not isinstance(row, dict):
            raise ContractError("MANIFEST_ROW_INVALID")
        key = (str(row["kind"]), str(row["symbol"]), str(row["month"]))
        if key in indexed:
            raise ContractError("MANIFEST_DUPLICATE", repr(key))
        indexed[key] = dict(row)
    if len(indexed) != int(manifest.get("entryCount", -1)):
        raise ContractError("MANIFEST_COUNT_INVALID")
    return indexed


class ArchiveReader:
    """Only ZIP-member-open seam, guarded by the sealed lifecycle."""

    def __init__(self, archive_root: Path):
        self.archive_root = archive_root.resolve()

    def require_permission(self, phase: str) -> None:
        _protocol, _manifest, _freeze = verify_freeze()
        run = verify_artifact(RUN_PATH, "cosmos.quant.research.s1r.run_consumed.v1")
        if run.get("freezeFileSha256") != sha256_file(FREEZE_PATH):
            raise ContractError("RUN_FREEZE_LINK_INVALID")
        if phase == "holdout":
            champion = verify_artifact(CHAMPION_PATH, "cosmos.quant.research.s1r.champion.v1")
            development = verify_artifact(
                DEVELOPMENT_PATH, "cosmos.quant.research.s1r.development.v1"
            )
            if champion.get("developmentFileSha256") != sha256_file(DEVELOPMENT_PATH):
                raise ContractError("CHAMPION_DEVELOPMENT_LINK_INVALID")
            if development.get("admitted") is not True:
                raise ContractError("HOLDOUT_WITHOUT_ADMITTED_DEVELOPMENT")
            holdout_open = verify_artifact(
                HOLDOUT_OPEN_PATH, "cosmos.quant.research.s1r.holdout_open.v1"
            )
            if holdout_open.get("championFileSha256") != sha256_file(CHAMPION_PATH):
                raise ContractError("HOLDOUT_CHAMPION_LINK_INVALID")

    def read_csv(self, row: Mapping[str, Any], phase: str) -> str:
        self.require_permission(phase)
        if row.get("phase") != phase or row.get("selectedForMemberOpen") is not True:
            raise ContractError("ARCHIVE_ROW_NOT_OPENABLE", repr(row))
        digest = str(row["publisherSha256"])
        path = (self.archive_root / f"{digest}.zip").resolve()
        if path.parent != self.archive_root:
            raise EvidenceError("ARCHIVE_PATH_ESCAPE", str(path))
        if sha256_file(path) != digest:
            raise EvidenceError("ARCHIVE_SHA256_DRIFT", str(path))
        try:
            with zipfile.ZipFile(path, "r") as archive:
                members = [
                    item
                    for item in archive.infolist()
                    if not item.is_dir() and item.filename.lower().endswith(".csv")
                ]
                if len(members) != 1 or len(archive.infolist()) != 1:
                    raise EvidenceError("ZIP_SHAPE_INVALID", str(path))
                payload = archive.read(members[0])
        except (OSError, RuntimeError, zipfile.BadZipFile) as exc:
            if isinstance(exc, EvidenceError):
                raise
            raise EvidenceError("ZIP_READ_FAILED", f"{path}: {exc}") from exc
        try:
            return payload.decode("utf-8-sig")
        except UnicodeDecodeError as exc:
            raise EvidenceError("CSV_UTF8_INVALID", str(path)) from exc


def normalize_kline_timestamp(raw: str, kind: str) -> int:
    try:
        timestamp = int(raw)
    except ValueError as exc:
        raise EvidenceError("KLINE_TIMESTAMP_INVALID", raw) from exc
    if kind == "spotKlines":
        if timestamp < 100_000_000_000_000 or timestamp % 1000:
            raise EvidenceError("SPOT_TIMESTAMP_UNIT_INVALID", raw)
        return timestamp // 1000
    if timestamp >= 100_000_000_000_000:
        raise EvidenceError("USD_M_TIMESTAMP_UNIT_INVALID", raw)
    return timestamp


def parse_kline_csv(text: str, kind: str, start_ms: int, end_ms: int) -> tuple[Bar, ...]:
    reader = csv.reader(io.StringIO(text))
    bars: list[Bar] = []
    seen: set[int] = set()
    for row_number, row in enumerate(reader, start=1):
        if not row or all(not item.strip() for item in row):
            continue
        if row_number == 1:
            try:
                int(row[0])
            except ValueError:
                continue
        if len(row) != 12:
            raise EvidenceError("KLINE_COLUMN_COUNT_INVALID", f"{kind}:{row_number}")
        timestamp = normalize_kline_timestamp(row[0].strip(), kind)
        if timestamp < start_ms or timestamp >= end_ms:
            raise EvidenceError("KLINE_PHASE_RANGE_INVALID", f"{kind}:{timestamp}")
        if timestamp % FIVE_MINUTES_MS:
            raise EvidenceError("KLINE_GRID_INVALID", f"{kind}:{timestamp}")
        if timestamp in seen:
            raise EvidenceError("KLINE_DUPLICATE", f"{kind}:{timestamp}")
        seen.add(timestamp)
        values = [decimal(row[index], f"{kind}:{row_number}:{index}") for index in (1, 2, 3, 4)]
        open_price, high, low, close = values
        quote_volume = decimal(row[7], f"{kind}:{row_number}:quote_volume")
        if min(values) <= ZERO or quote_volume < ZERO:
            raise EvidenceError("KLINE_VALUE_INVALID", f"{kind}:{row_number}")
        if high < max(open_price, close, low) or low > min(open_price, close, high):
            raise EvidenceError("KLINE_OHLC_INVALID", f"{kind}:{row_number}")
        bars.append(Bar(timestamp, open_price, high, low, close, quote_volume))
    bars.sort(key=lambda item: item.ts_ms)
    return tuple(bars)


def parse_funding_csv(text: str, start_ms: int, end_ms: int) -> tuple[Funding, ...]:
    rows = list(csv.reader(io.StringIO(text)))
    if not rows:
        raise EvidenceError("FUNDING_EMPTY")
    header = {name.strip().lower(): index for index, name in enumerate(rows[0])}
    required = {
        "calc_time",
        "funding_interval_hours",
        "last_funding_rate",
    }
    if not required.issubset(header):
        raise EvidenceError("FUNDING_HEADER_INVALID", repr(sorted(header)))
    events: list[Funding] = []
    seen: set[int] = set()
    for row_number, row in enumerate(rows[1:], start=2):
        if not row or all(not item.strip() for item in row):
            continue
        try:
            timestamp = int(row[header["calc_time"]])
            interval = decimal(row[header["funding_interval_hours"]], "funding.interval")
            rate = decimal(row[header["last_funding_rate"]], "funding.rate")
        except (IndexError, ValueError) as exc:
            raise EvidenceError("FUNDING_ROW_INVALID", str(row_number)) from exc
        if timestamp >= 100_000_000_000_000:
            raise EvidenceError("FUNDING_TIMESTAMP_UNIT_INVALID", str(timestamp))
        if timestamp < start_ms or timestamp >= end_ms:
            raise EvidenceError("FUNDING_PHASE_RANGE_INVALID", str(timestamp))
        if timestamp in seen:
            raise EvidenceError("FUNDING_DUPLICATE", str(timestamp))
        if interval <= ZERO:
            raise EvidenceError("FUNDING_INTERVAL_NONPOSITIVE", str(timestamp))
        seen.add(timestamp)
        events.append(Funding(timestamp, interval, rate))
    events.sort(key=lambda item: item.ts_ms)
    return tuple(events)


def validate_complete_grid(bars: Sequence[Bar], start_ms: int, end_ms: int, identity: str) -> None:
    expected_count = (end_ms - start_ms) // FIVE_MINUTES_MS
    if len(bars) != expected_count:
        raise EvidenceError("KLINE_GRID_COUNT_INVALID", f"{identity}:{len(bars)}:{expected_count}")
    for index, bar in enumerate(bars):
        expected = start_ms + (index * FIVE_MINUTES_MS)
        if bar.ts_ms != expected:
            raise EvidenceError(
                "KLINE_GRID_CLOCK_INVALID", f"{identity}:{index}:{bar.ts_ms}:{expected}"
            )


def load_phase(
    protocol: Mapping[str, Any],
    manifest: Mapping[str, Any],
    reader: ArchiveReader,
    phase: str,
) -> PhaseData:
    calendar = protocol["calendar"][phase]
    start_ms = parse_utc_ms(calendar["startInclusive"])
    end_ms = parse_utc_ms(calendar["endExclusive"])
    indexed = manifest_index(manifest)
    bars: dict[str, dict[str, tuple[Bar, ...]]] = {}
    funding: dict[str, tuple[Funding, ...]] = {}
    for symbol in sorted(protocol["data"]["symbols"]):
        bars[symbol] = {}
        for kind in ("spotKlines", "perpetualKlines"):
            combined: list[Bar] = []
            for month in calendar["months"]:
                row = indexed[(kind, symbol, month)]
                combined.extend(
                    parse_kline_csv(
                        reader.read_csv(row, phase),
                        kind,
                        start_ms,
                        end_ms,
                    )
                )
            combined.sort(key=lambda item: item.ts_ms)
            validate_complete_grid(combined, start_ms, end_ms, f"{phase}:{symbol}:{kind}")
            bars[symbol][kind] = tuple(combined)
        if tuple(item.ts_ms for item in bars[symbol]["spotKlines"]) != tuple(
            item.ts_ms for item in bars[symbol]["perpetualKlines"]
        ):
            raise EvidenceError("PAIRED_CLOCK_MISMATCH", f"{phase}:{symbol}")
        combined_funding: list[Funding] = []
        for month in calendar["months"]:
            row = indexed[("fundingRate", symbol, month)]
            combined_funding.extend(
                parse_funding_csv(reader.read_csv(row, phase), start_ms, end_ms)
            )
        combined_funding.sort(key=lambda item: item.ts_ms)
        if len({item.ts_ms for item in combined_funding}) != len(combined_funding):
            raise EvidenceError("FUNDING_DUPLICATE_ACROSS_MONTHS", symbol)
        funding[symbol] = tuple(combined_funding)
    reference: tuple[int, ...] | None = None
    for symbol in sorted(bars):
        clocks = tuple(item.ts_ms for item in bars[symbol]["spotKlines"])
        if reference is None:
            reference = clocks
        elif clocks != reference:
            raise EvidenceError("SYMBOL_CLOCK_MISMATCH", f"{phase}:{symbol}")
    return PhaseData(phase, start_ms, end_ms, bars, funding)


def trials_from_protocol(protocol: Mapping[str, Any]) -> tuple[Trial, ...]:
    trials = [
        Trial(
            trial_id=f"L{lookback:02d}_Z{Decimal(threshold):.1f}_H{hold:02d}",
            lookback=int(lookback),
            threshold_z=Decimal(str(threshold)),
            hold_minutes=int(hold),
        )
        for lookback in protocol["signal"]["lookbackFundingObservations"]
        for threshold in protocol["signal"]["thresholdZ"]
        for hold in protocol["trials"]["maximumHoldMinutes"]
    ]
    trials.sort(key=lambda item: item.trial_id)
    if len(trials) != int(protocol["trials"]["count"]):
        raise ContractError("TRIAL_COUNT_INVALID", str(len(trials)))
    return tuple(trials)


def trade_cost(
    quantity: Decimal,
    entry_spot: Decimal,
    exit_spot: Decimal,
    entry_perpetual: Decimal,
    exit_perpetual: Decimal,
    schedule: Mapping[str, Any],
) -> Decimal:
    spot_notional = quantity * (entry_spot + exit_spot)
    perpetual_notional = quantity * (entry_perpetual + exit_perpetual)
    fees = (
        spot_notional * Decimal(str(schedule["spotFeeBpsPerFill"]))
        + perpetual_notional * Decimal(str(schedule["usdMFeeBpsPerFill"]))
    ) / TEN_THOUSAND
    adverse = (
        (spot_notional + perpetual_notional)
        * Decimal(str(schedule["adverseExecutionBpsPerFill"]))
        / TEN_THOUSAND
    )
    return fees + adverse


def build_trade(
    trial: Trial,
    candidate: Candidate,
    phase: PhaseData,
    protocol: Mapping[str, Any],
) -> Trade:
    spot = phase.bars[candidate.symbol]["spotKlines"]
    perpetual = phase.bars[candidate.symbol]["perpetualKlines"]
    entry_spot = spot[candidate.entry_index].open
    entry_perpetual = perpetual[candidate.entry_index].open
    exit_spot = spot[candidate.exit_index].open
    exit_perpetual = perpetual[candidate.exit_index].open
    if candidate.exit_index <= candidate.entry_index:
        raise EvidenceError("TRADE_INDEX_INVALID")
    entry_ts = spot[candidate.entry_index].ts_ms
    exit_ts = spot[candidate.exit_index].ts_ms
    if exit_ts >= candidate.current_row_implied_next_settlement_ms:
        raise EvidenceError(
            "CURRENT_ROW_INTERVAL_TOO_SHORT_FOR_FROZEN_HORIZON",
            (
                f"{candidate.symbol}:{entry_ts}:{exit_ts}:"
                f"{candidate.current_row_implied_next_settlement_ms}"
            ),
        )
    actual_later_settlements = [
        item.ts_ms
        for item in phase.funding[candidate.symbol]
        if candidate.event.ts_ms < item.ts_ms <= exit_ts
    ]
    if actual_later_settlements:
        raise EvidenceError(
            "UNEXPECTED_LATER_SETTLEMENT_WITHIN_FROZEN_HORIZON",
            (f"{candidate.symbol}:{candidate.event.ts_ms}:{exit_ts}:{actual_later_settlements[0]}"),
        )
    spot_budget = Decimal(str(protocol["trials"]["spotBudgetUsd"]))
    perpetual_budget = Decimal(str(protocol["trials"]["perpetualCollateralBudgetUsd"]))
    quantity = min(spot_budget / entry_spot, perpetual_budget / entry_perpetual)
    gross = quantity * ((exit_spot - entry_spot) + (entry_perpetual - exit_perpetual))
    net_by_cost: dict[str, Decimal] = {}
    for name in ("base", "stress", "severe", "makerSensitivity"):
        net_by_cost[name] = gross - trade_cost(
            quantity,
            entry_spot,
            exit_spot,
            entry_perpetual,
            exit_perpetual,
            protocol["costs"][name],
        )
    prior_start = candidate.entry_index - DAY_BARS
    if prior_start < 0:
        raise EvidenceError("CAPACITY_HISTORY_UNAVAILABLE", candidate.symbol)
    prior_spot_volume = sum(
        (item.quote_volume for item in spot[prior_start : candidate.entry_index]),
        ZERO,
    )
    prior_perpetual_volume = sum(
        (item.quote_volume for item in perpetual[prior_start : candidate.entry_index]),
        ZERO,
    )
    participation_fraction = Decimal(str(protocol["capacity"]["participationBps"])) / TEN_THOUSAND
    capacity = participation_fraction * min(prior_spot_volume, prior_perpetual_volume)
    return Trade(
        trial_id=trial.trial_id,
        symbol=candidate.symbol,
        event_ts_ms=candidate.event.ts_ms,
        entry_index=candidate.entry_index,
        exit_index=candidate.exit_index,
        entry_ts_ms=entry_ts,
        exit_ts_ms=exit_ts,
        surprise_z=candidate.z,
        quantity=quantity,
        entry_spot=entry_spot,
        entry_perpetual=entry_perpetual,
        exit_spot=exit_spot,
        exit_perpetual=exit_perpetual,
        entry_basis_bps=basis_bps(entry_spot, entry_perpetual),
        exit_basis_bps=basis_bps(exit_spot, exit_perpetual),
        gross_pnl=gross,
        net_by_cost=net_by_cost,
        capacity_proxy_usd=capacity,
    )


def trial_candidates(
    trial: Trial,
    phase: PhaseData,
    protocol: Mapping[str, Any],
) -> tuple[dict[int, list[Candidate]], dict[str, int]]:
    delay = int(protocol["signal"]["publicationDelaySecondsEventTimeProxy"])
    grouped: dict[int, list[Candidate]] = defaultdict(list)
    rejected: dict[str, int] = defaultdict(int)
    for symbol in sorted(phase.bars):
        clocks = tuple(item.ts_ms for item in phase.bars[symbol]["spotKlines"])
        events = phase.funding[symbol]
        for index, event in enumerate(events):
            if index < trial.lookback:
                rejected["INSUFFICIENT_PRIOR_SETTLEMENTS"] += 1
                continue
            prior = events[index - trial.lookback : index]
            z = funding_surprise_z(event, prior)
            if z is None:
                rejected["NOT_ALL_SAME_SIGN_POSITIVE"] += 1
                continue
            if z < trial.threshold_z:
                rejected["SURPRISE_BELOW_THRESHOLD"] += 1
                continue
            entry_index = first_entry_index(clocks, event.ts_ms, delay)
            exit_index = entry_index + (trial.hold_minutes // 5)
            if entry_index >= len(clocks) or exit_index >= len(clocks):
                rejected["PARTITION_BOUNDARY"] += 1
                continue
            if entry_index < DAY_BARS:
                rejected["CAPACITY_WARMUP"] += 1
                continue
            interval_ms = event.interval_hours * Decimal(3_600_000)
            if interval_ms != interval_ms.to_integral_value():
                raise EvidenceError(
                    "FUNDING_INTERVAL_NOT_EXACT_MILLISECONDS",
                    f"{symbol}:{event.ts_ms}:{dstr(event.interval_hours)}",
                )
            grouped[clocks[entry_index]].append(
                Candidate(
                    symbol=symbol,
                    event=event,
                    z=z,
                    entry_index=entry_index,
                    exit_index=exit_index,
                    current_row_implied_next_settlement_ms=(event.ts_ms + int(interval_ms)),
                )
            )
    return dict(grouped), dict(rejected)


def severe_drawdown(
    trades: Sequence[Trade],
    phase: PhaseData,
    protocol: Mapping[str, Any],
) -> Decimal:
    capital = Decimal(str(protocol["trials"]["portfolioCapitalUsd"]))
    realized = ZERO
    peak = capital
    maximum = ZERO
    severe = protocol["costs"]["severe"]
    for trade in sorted(trades, key=lambda item: item.entry_ts_ms):
        spot = phase.bars[trade.symbol]["spotKlines"]
        perpetual = phase.bars[trade.symbol]["perpetualKlines"]
        for index in range(trade.entry_index, trade.exit_index):
            current_spot = spot[index].close
            current_perpetual = perpetual[index].close
            gross = trade.quantity * (
                (current_spot - trade.entry_spot) + (trade.entry_perpetual - current_perpetual)
            )
            reserved_cost = trade_cost(
                trade.quantity,
                trade.entry_spot,
                current_spot,
                trade.entry_perpetual,
                current_perpetual,
                severe,
            )
            equity = capital + realized + gross - reserved_cost
            peak = max(peak, equity)
            if peak > ZERO:
                maximum = max(maximum, (peak - equity) / peak * Decimal(100))
        realized += trade.net_by_cost["severe"]
        realized_equity = capital + realized
        if peak > ZERO:
            maximum = max(
                maximum,
                (peak - realized_equity) / peak * Decimal(100),
            )
        peak = max(peak, capital + realized)
    return maximum


def simulate_trial(trial: Trial, phase: PhaseData, protocol: Mapping[str, Any]) -> TrialResult:
    grouped, rejected = trial_candidates(trial, phase, protocol)
    trades: list[Trade] = []
    busy_until = phase.start_ms
    for entry_ts in sorted(grouped):
        cohort = grouped[entry_ts]
        if entry_ts < busy_until:
            rejected["OVERLAP_IGNORED"] = rejected.get("OVERLAP_IGNORED", 0) + len(cohort)
            continue
        winner = sorted(cohort, key=lambda item: (-item.z, item.symbol))[0]
        rejected["SIMULTANEOUS_NOT_SELECTED"] = rejected.get("SIMULTANEOUS_NOT_SELECTED", 0) + (
            len(cohort) - 1
        )
        spot = phase.bars[winner.symbol]["spotKlines"][winner.entry_index].open
        perpetual = phase.bars[winner.symbol]["perpetualKlines"][winner.entry_index].open
        if perpetual <= spot:
            rejected["NONPOSITIVE_ENTRY_BASIS_NO_SUBSTITUTION"] = (
                rejected.get("NONPOSITIVE_ENTRY_BASIS_NO_SUBSTITUTION", 0) + 1
            )
            continue
        trade = build_trade(trial, winner, phase, protocol)
        trades.append(trade)
        busy_until = trade.exit_ts_ms
    dates = date_range(phase.start_ms, phase.end_ms)
    day_index = {value: index for index, value in enumerate(dates)}
    daily: dict[str, list[Decimal]] = {
        name: [ZERO] * len(dates) for name in ("base", "stress", "severe", "makerSensitivity")
    }
    for trade in trades:
        key = utc_date(trade.exit_ts_ms)
        if key not in day_index:
            raise EvidenceError("TRADE_DAY_OUTSIDE_PHASE", key)
        for name in daily:
            daily[name][day_index[key]] += trade.net_by_cost[name]
    return TrialResult(
        trial=trial,
        phase=phase.phase,
        trades=tuple(trades),
        dates=dates,
        daily_net_by_cost={name: tuple(values) for name, values in daily.items()},
        severe_drawdown_pct=severe_drawdown(trades, phase, protocol),
        rejection_counts=dict(sorted(rejected.items())),
    )


def empirical_quantile(values: Sequence[float], probability: float) -> float:
    if not values:
        raise ContractError("QUANTILE_EMPTY")
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, math.ceil(probability * len(ordered)) - 1))
    return ordered[index]


def family_statistics(
    results: Sequence[TrialResult], protocol: Mapping[str, Any]
) -> dict[str, Any]:
    if len(results) != int(protocol["trials"]["count"]):
        raise ContractError("STATISTICS_FAMILY_SIZE_INVALID")
    dates = results[0].dates
    if any(result.dates != dates for result in results):
        raise ContractError("STATISTICS_DATES_NOT_SYNCHRONOUS")
    rows = [[float(value) for value in result.daily_net_by_cost["stress"]] for result in results]
    count = len(dates)
    replicates = int(protocol["statistics"]["bootstrapReplicates"])
    block = int(protocol["statistics"]["blockLengthDays"])
    seed = int(protocol["statistics"]["seed"])
    alpha = float(protocol["statistics"]["familywiseAlpha"])
    observed = [sum(row) / count for row in rows]
    generator = random.Random(seed)
    bootstrap_means: list[list[float]] = [[] for _ in rows]
    centered_maxima: list[float] = []
    for _ in range(replicates):
        indices: list[int] = []
        while len(indices) < count:
            start = generator.randrange(count)
            indices.extend((start + offset) % count for offset in range(block))
        indices = indices[:count]
        current: list[float] = []
        for row_index, row in enumerate(rows):
            mean = sum(row[index] for index in indices) / count
            bootstrap_means[row_index].append(mean)
            current.append(mean)
        centered_maxima.append(max(current[index] - observed[index] for index in range(len(rows))))
    lower: dict[str, float] = {}
    bonferroni: dict[str, float] = {}
    raw_p: dict[str, float] = {}
    for index, result in enumerate(results):
        trial_id = result.trial.trial_id
        lower[trial_id] = 2 * observed[index] - empirical_quantile(
            bootstrap_means[index], 1 - alpha
        )
        bonferroni[trial_id] = 2 * observed[index] - empirical_quantile(
            bootstrap_means[index], 1 - (alpha / len(results))
        )
        exceed = sum(
            1 for value in bootstrap_means[index] if value - observed[index] >= observed[index]
        )
        raw_p[trial_id] = (exceed + 1) / (replicates + 1)
    ordered = sorted(raw_p.items(), key=lambda item: (item[1], item[0]))
    holm_adjusted: dict[str, float] = {}
    running = 0.0
    for rank, (trial_id, p_value) in enumerate(ordered):
        running = max(running, min(1.0, (len(results) - rank) * p_value))
        holm_adjusted[trial_id] = running
    best_observed = max(observed)
    white_exceed = sum(1 for value in centered_maxima if value >= best_observed)
    white_p = (white_exceed + 1) / (replicates + 1)
    return {
        "method": "SEEDED_SYNCHRONOUS_SEVEN_DAY_CIRCULAR_BLOCK_BOOTSTRAP",
        "replicates": replicates,
        "observedStressMeanUsdPerDay": {
            result.trial.trial_id: observed[index] for index, result in enumerate(results)
        },
        "oneSided95PctLowerMeanUsdPerDay": lower,
        "bonferroniLowerMeanUsdPerDay": bonferroni,
        "rawOneSidedPValue": raw_p,
        "holmAdjustedPValue": holm_adjusted,
        "whiteRealityCheckPValue": white_p,
    }


def pbo(results: Sequence[TrialResult], protocol: Mapping[str, Any]) -> dict[str, Any]:
    dates = results[0].dates
    if any(result.dates != dates for result in results):
        raise ContractError("PBO_DATES_NOT_SYNCHRONOUS")
    blocks = int(protocol["statistics"]["pbo"]["blocks"])
    in_sample_blocks = int(protocol["statistics"]["pbo"]["inSampleBlocks"])
    boundaries = [
        (index * len(dates) // blocks, (index + 1) * len(dates) // blocks)
        for index in range(blocks)
    ]
    rows = [[float(value) for value in result.daily_net_by_cost["stress"]] for result in results]
    overfit = 0
    splits = 0
    ranks: list[int] = []
    for chosen in itertools.combinations(range(blocks), in_sample_blocks):
        selected_blocks = set(chosen)
        in_indices = [
            day
            for block_index, (start, end) in enumerate(boundaries)
            if block_index in selected_blocks
            for day in range(start, end)
        ]
        out_indices = [
            day
            for block_index, (start, end) in enumerate(boundaries)
            if block_index not in selected_blocks
            for day in range(start, end)
        ]
        in_scores = [
            (
                -sum(rows[index][day] for day in in_indices),
                results[index].trial.trial_id,
                index,
            )
            for index in range(len(results))
        ]
        in_scores.sort()
        selected = in_scores[0][2]
        out_scores = sorted(
            (
                -sum(rows[index][day] for day in out_indices),
                results[index].trial.trial_id,
                index,
            )
            for index in range(len(results))
        )
        rank = next(
            position for position, row in enumerate(out_scores, start=1) if row[2] == selected
        )
        ranks.append(rank)
        if rank > (len(results) // 2):
            overfit += 1
        splits += 1
    expected = int(protocol["statistics"]["pbo"]["splits"])
    if splits != expected:
        raise ContractError("PBO_SPLIT_COUNT_INVALID", f"{splits}:{expected}")
    return {
        "method": "CSCV_12_BLOCKS_6_IN_SAMPLE",
        "splits": splits,
        "overfitSplits": overfit,
        "probability": overfit / splits,
        "medianOutOfSampleRank": empirical_quantile([float(value) for value in ranks], 0.5),
        "authority": "DIAGNOSTIC_ONLY",
    }


def grouped_stress(result: TrialResult, field: str) -> dict[str, Decimal]:
    values: dict[str, Decimal] = defaultdict(lambda: ZERO)
    for trade in result.trades:
        if field == "symbol":
            key = trade.symbol
        elif field == "month":
            key = utc_month(trade.exit_ts_ms)
        else:
            raise ContractError("GROUP_FIELD_INVALID", field)
        values[key] += trade.net_by_cost["stress"]
    return dict(values)


def trial_total(result: TrialResult, cost: str) -> Decimal:
    return sum((trade.net_by_cost[cost] for trade in result.trades), ZERO)


def trial_summary(result: TrialResult) -> dict[str, Any]:
    by_symbol = grouped_stress(result, "symbol")
    by_month = grouped_stress(result, "month")
    capacity_values = sorted(trade.capacity_proxy_usd for trade in result.trades)
    return {
        "trialId": result.trial.trial_id,
        "lookbackSettlements": result.trial.lookback,
        "thresholdZ": dstr(result.trial.threshold_z),
        "holdMinutes": result.trial.hold_minutes,
        "roundTrips": len(result.trades),
        "activeWeeks": len({utc_week(trade.exit_ts_ms) for trade in result.trades}),
        "symbolsTraded": sorted({trade.symbol for trade in result.trades}),
        "grossUsdPerOriginal1000": dstr(
            sum((trade.gross_pnl for trade in result.trades), ZERO), "0.00000001"
        ),
        "netUsdPerOriginal1000": {
            name: dstr(trial_total(result, name), "0.00000001")
            for name in ("base", "stress", "severe", "makerSensitivity")
        },
        "maximumFiveMinuteSevereDrawdownPct": dstr(result.severe_drawdown_pct, "0.00000001"),
        "stressBySymbolUsd": {
            key: dstr(value, "0.00000001") for key, value in sorted(by_symbol.items())
        },
        "stressByMonthUsd": {
            key: dstr(value, "0.00000001") for key, value in sorted(by_month.items())
        },
        "capacityProxyUsd": {
            "minimum": (dstr(capacity_values[0], "0.00000001") if capacity_values else None),
            "median": (dstr(median(capacity_values), "0.00000001") if capacity_values else None),
            "executableCapacity": "UNMEASURED",
        },
        "fundingCashflowUsd": "0",
        "rejectionCounts": dict(result.rejection_counts),
        "trades": [
            {
                "symbol": trade.symbol,
                "eventTimeMs": trade.event_ts_ms,
                "entryTimeMs": trade.entry_ts_ms,
                "exitTimeMs": trade.exit_ts_ms,
                "surpriseZ": dstr(trade.surprise_z, "0.00000001"),
                "entryBasisBps": dstr(trade.entry_basis_bps, "0.00000001"),
                "exitBasisBps": dstr(trade.exit_basis_bps, "0.00000001"),
                "grossUsd": dstr(trade.gross_pnl, "0.00000001"),
                "netUsd": {
                    key: dstr(value, "0.00000001") for key, value in trade.net_by_cost.items()
                },
                "capacityProxyUsd": dstr(trade.capacity_proxy_usd, "0.00000001"),
                "fundingCashflowUsd": "0",
            }
            for trade in result.trades
        ],
    }


def development_checks(
    result: TrialResult,
    statistics: Mapping[str, Any],
    protocol: Mapping[str, Any],
) -> dict[str, bool]:
    admission = protocol["developmentAdmission"]
    stress = trial_total(result, "stress")
    by_symbol = grouped_stress(result, "symbol")
    by_month = grouped_stress(result, "month")
    remove_symbol = stress - max(by_symbol.values(), default=ZERO)
    remove_month = stress - max(by_month.values(), default=ZERO)
    trial_id = result.trial.trial_id
    required_capacity = Decimal(str(protocol["capacity"]["requiredPerLegUsd"]))
    checks = {
        "minimumRoundTrips": len(result.trades) >= int(admission["minimumRoundTrips"]),
        "minimumActiveWeeks": len({utc_week(trade.exit_ts_ms) for trade in result.trades})
        >= int(admission["minimumActiveWeeks"]),
        "minimumSymbols": len({trade.symbol for trade in result.trades})
        >= int(admission["minimumSymbols"]),
        "positiveBaseNet": trial_total(result, "base") > ZERO,
        "positiveStressNet": stress > ZERO,
        "positiveBonferroniLowerBound": float(statistics["bonferroniLowerMeanUsdPerDay"][trial_id])
        > 0,
        "holmChampionPass": float(statistics["holmAdjustedPValue"][trial_id])
        <= float(protocol["statistics"]["familywiseAlpha"]),
        "whiteRealityCheckPass": float(statistics["whiteRealityCheckPValue"])
        <= float(protocol["statistics"]["familywiseAlpha"]),
        "removeBestSymbolStressPositive": bool(by_symbol) and remove_symbol > ZERO,
        "removeBestMonthStressPositive": bool(by_month) and remove_month > ZERO,
        "drawdownPass": result.severe_drawdown_pct
        <= Decimal(str(protocol["risk"]["maximumDevelopmentDrawdownPct"])),
        "capacityProxyPass": bool(result.trades)
        and all(trade.capacity_proxy_usd >= required_capacity for trade in result.trades),
    }
    return checks


def select_champion(results: Sequence[TrialResult], statistics: Mapping[str, Any]) -> TrialResult:
    return sorted(
        results,
        key=lambda result: (
            -float(statistics["bonferroniLowerMeanUsdPerDay"][result.trial.trial_id]),
            -float(trial_total(result, "stress")),
            float(result.severe_drawdown_pct),
            result.trial.trial_id,
        ),
    )[0]


def development_document(
    results: Sequence[TrialResult], protocol: Mapping[str, Any]
) -> dict[str, Any]:
    statistics = family_statistics(results, protocol)
    pbo_result = pbo(results, protocol)
    champion = select_champion(results, statistics)
    checks = development_checks(champion, statistics, protocol)
    return artifact(
        {
            "schema": "cosmos.quant.research.s1r.development.v1",
            "protocolId": protocol["protocolId"],
            "createdAt": utc_now(),
            "phase": "development",
            "archiveMembersOpened": 54,
            "trialCount": len(results),
            "statistics": statistics,
            "pbo": pbo_result,
            "championTrialId": champion.trial.trial_id,
            "championChecks": checks,
            "admitted": all(checks.values()),
            "trials": [trial_summary(result) for result in results],
        }
    )


def single_lower_bound(
    result: TrialResult, protocol: Mapping[str, Any], alpha: float = 0.05
) -> float:
    row = [float(value) for value in result.daily_net_by_cost["stress"]]
    count = len(row)
    generator = random.Random(int(protocol["statistics"]["seed"]) + 1)
    block = int(protocol["statistics"]["blockLengthDays"])
    replicates = int(protocol["statistics"]["bootstrapReplicates"])
    observed = sum(row) / count
    values: list[float] = []
    for _ in range(replicates):
        indices: list[int] = []
        while len(indices) < count:
            start = generator.randrange(count)
            indices.extend((start + offset) % count for offset in range(block))
        values.append(sum(row[index] for index in indices[:count]) / count)
    return 2 * observed - empirical_quantile(values, 1 - alpha)


def holdout_document(result: TrialResult, protocol: Mapping[str, Any]) -> dict[str, Any]:
    lower = single_lower_bound(result, protocol)
    stress = trial_total(result, "stress")
    by_symbol = grouped_stress(result, "symbol")
    by_month = grouped_stress(result, "month")
    admission = protocol["holdoutAdmission"]
    required_capacity = Decimal(str(protocol["capacity"]["requiredPerLegUsd"]))
    checks = {
        "minimumRoundTrips": len(result.trades) >= int(admission["minimumRoundTrips"]),
        "minimumActiveWeeks": len({utc_week(trade.exit_ts_ms) for trade in result.trades})
        >= int(admission["minimumActiveWeeks"]),
        "minimumSymbols": len({trade.symbol for trade in result.trades})
        >= int(admission["minimumSymbols"]),
        "positiveBaseNet": trial_total(result, "base") > ZERO,
        "positiveStressNet": stress > ZERO,
        "positiveOneSided95PctLowerBound": lower > 0,
        "removeBestSymbolStressPositive": bool(by_symbol)
        and stress - max(by_symbol.values()) > ZERO,
        "removeBestMonthStressPositive": bool(by_month) and stress - max(by_month.values()) > ZERO,
        "drawdownPass": result.severe_drawdown_pct
        <= Decimal(str(protocol["risk"]["maximumDevelopmentDrawdownPct"])),
        "capacityProxyPass": bool(result.trades)
        and all(trade.capacity_proxy_usd >= required_capacity for trade in result.trades),
    }
    return artifact(
        {
            "schema": "cosmos.quant.research.s1r.holdout.v1",
            "protocolId": protocol["protocolId"],
            "createdAt": utc_now(),
            "phase": "holdout",
            "archiveMembersOpened": 18,
            "trialId": result.trial.trial_id,
            "oneSided95PctLowerMeanUsdPerDay": lower,
            "checks": checks,
            "admitted": all(checks.values()),
            "trial": trial_summary(result),
        }
    )


def result_document(
    protocol: Mapping[str, Any],
    verdict: str,
    reason: str,
    holdout_state: str,
    error: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    document: dict[str, Any] = {
        "schema": "cosmos.quant.research.s1r.result.v1",
        "protocolId": protocol["protocolId"],
        "createdAt": utc_now(),
        "strategyVerdict": verdict,
        "reason": reason,
        "capitalAuthority": "NO_GO",
        "executionAuthority": "NONE",
        "positiveEdgeClaim": False,
        "publicOnly": True,
        "holdoutState": holdout_state,
        "runFileSha256": sha256_file(RUN_PATH),
        "developmentFileSha256": (
            sha256_file(DEVELOPMENT_PATH) if DEVELOPMENT_PATH.exists() else None
        ),
        "championFileSha256": (sha256_file(CHAMPION_PATH) if CHAMPION_PATH.exists() else None),
        "holdoutFileSha256": (sha256_file(HOLDOUT_PATH) if HOLDOUT_PATH.exists() else None),
        "externalTruth": {
            "historicalFundingPublicationLatency": "UNMEASURED",
            "historicalArchiveFundingRateType": "UNAVAILABLE",
            "accountEffectiveFees": "UNKNOWN",
            "pairedFillAtomicity": "UNMEASURED",
            "executableCapacity": "UNMEASURED",
            "intrabarDrawdown": "UNMEASURED",
        },
        "effects": {
            "privateApiCalls": 0,
            "orders": 0,
            "testOrders": 0,
            "transfers": 0,
            "withdrawals": 0,
            "moneyUsd": "0",
        },
        "consumer": "N3 successor / final convergence",
    }
    if error is not None:
        document["terminalError"] = dict(error)
    return artifact(document)


def run_once() -> dict[str, Any]:
    """Consume the single run, then evaluate development and gated holdout."""

    protocol, manifest, freeze = verify_freeze()
    if any(
        path.exists()
        for path in (
            RUN_PATH,
            DEVELOPMENT_PATH,
            CHAMPION_PATH,
            HOLDOUT_OPEN_PATH,
            HOLDOUT_PATH,
            RESULT_PATH,
        )
    ):
        raise ContractError("RUN_ALREADY_CONSUMED_OR_DIRTY")
    run_marker = artifact(
        {
            "schema": "cosmos.quant.research.s1r.run_consumed.v1",
            "protocolId": protocol["protocolId"],
            "createdAt": utc_now(),
            "status": "CONSUMED_BEFORE_FIRST_ARCHIVE_MEMBER_OPEN",
            "freezeFileSha256": sha256_file(FREEZE_PATH),
            "freezeArtifactSha256": freeze["artifactSha256"],
            "allowedRunCount": 1,
            "currentRun": 1,
        }
    )
    write_once_json(RUN_PATH, run_marker)
    reader = ArchiveReader(Path(protocol["data"]["sharedArchiveRoot"]))
    try:
        development_phase = load_phase(protocol, manifest, reader, "development")
        trials = trials_from_protocol(protocol)
        development_results = tuple(
            simulate_trial(trial, development_phase, protocol) for trial in trials
        )
        development = development_document(development_results, protocol)
        write_once_json(DEVELOPMENT_PATH, development)
        if development["admitted"] is not True:
            final = result_document(
                protocol,
                "NO_GO",
                "VALID_MEASURED_DEVELOPMENT_PUBLIC_PROXY_GATES_FAILED",
                "UNOPENED",
            )
            write_once_json(RESULT_PATH, final)
            return final
        champion_id = str(development["championTrialId"])
        champion = artifact(
            {
                "schema": "cosmos.quant.research.s1r.champion.v1",
                "protocolId": protocol["protocolId"],
                "createdAt": utc_now(),
                "trialId": champion_id,
                "developmentFileSha256": sha256_file(DEVELOPMENT_PATH),
                "status": "SEALED_BEFORE_HOLDOUT_OPEN",
            }
        )
        write_once_json(CHAMPION_PATH, champion)
        holdout_open = artifact(
            {
                "schema": "cosmos.quant.research.s1r.holdout_open.v1",
                "protocolId": protocol["protocolId"],
                "createdAt": utc_now(),
                "openCount": 1,
                "championFileSha256": sha256_file(CHAMPION_PATH),
                "status": "AUTHORIZED_CHAMPION_ONLY",
            }
        )
        write_once_json(HOLDOUT_OPEN_PATH, holdout_open)
        holdout_phase = load_phase(protocol, manifest, reader, "holdout")
        champion_trial = next(trial for trial in trials if trial.trial_id == champion_id)
        holdout_result = simulate_trial(champion_trial, holdout_phase, protocol)
        holdout = holdout_document(holdout_result, protocol)
        write_once_json(HOLDOUT_PATH, holdout)
        if holdout["admitted"] is not True:
            verdict = "NO_GO"
            reason = "VALID_MEASURED_HOLDOUT_PUBLIC_PROXY_GATES_FAILED"
        else:
            verdict = "UNMEASURED"
            reason = "PUBLIC_PROXY_GATES_POSITIVE_EXTERNAL_EXECUTABILITY_TRUTH_ABSENT"
        final = result_document(protocol, verdict, reason, "OPENED_ONCE_CHAMPION_ONLY")
        write_once_json(RESULT_PATH, final)
        return final
    except S1RError as exc:
        final = result_document(
            protocol,
            "UNMEASURED",
            "SEALED_RUN_TERMINATED_BY_EVIDENCE_OR_CONTRACT_ERROR",
            "OPENED_ONCE_CHAMPION_ONLY" if HOLDOUT_OPEN_PATH.exists() else "UNOPENED",
            {"code": exc.code, "detail": exc.detail},
        )
        write_once_json(RESULT_PATH, final)
        return final


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("prepare", "run"))
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    try:
        result = prepare() if args.command == "prepare" else run_once()
    except S1RError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    print(json.dumps(result, sort_keys=True, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
