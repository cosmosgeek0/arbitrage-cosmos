#!/usr/bin/env python3
"""Immutable Binance-public-only V-G28 quote-volume-curvature experiment.

The five commands form a deliberately narrow custody boundary:

``inventory``
    Authenticate the exact external ZIP plus CHECKSUM byte inventory without
    opening a ZIP member, then exclusively create the packet source manifest.
``freeze``
    Bind the evaluator, tests, protocol, research note, README, manifest,
    exact trial fingerprint, and canonical base before outcomes are opened.
``run``
    Exclusively consume the sole run before opening any member; evaluate
    development, and open holdout only after a passing champion is sealed.
``seal``
    Exclusively create the terminal packet SHA-256 inventory.
``report``
    Network-free authentication and display only.  It never reruns research
    and never opens a ZIP member.

Acceleration and deceleration are separate long-only sleeves.  The latter is
only a matched comparator; neither sleeve shorts, borrows, or places orders.
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
import subprocess
import sys
import zipfile
from collections import defaultdict
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
README_PATH = HERE / "README.md"
OFFICIAL_RESEARCH_PATH = HERE / "OFFICIAL_SOURCE_RESEARCH.md"
INIT_PATH = HERE / "__init__.py"
TEST_PATH = HERE / "test_experiment.py"
SOURCE_MANIFEST_PATH = HERE / "source-manifest.v1.json"
FREEZE_PATH = HERE / "freeze.v1.json"
RUN_MARKER_PATH = HERE / "run-marker.v1.json"
CANDIDATE_SEAL_PATH = HERE / "candidate-seal.v1.json"
HOLDOUT_OPEN_PATH = HERE / "holdout-open.v1.json"
RESULT_PATH = HERE / "result.v1.json"
HANDOFF_PATH = HERE / "HANDOFF.md"
SHA256SUMS_PATH = HERE / "SHA256SUMS"

BASE_COMMIT = "a169b123fb186d1943a75ad648552c4d95be1be1"
SOURCE_ROOT = Path(
    "/Users/cosmosgeek/.codex/research-data/vg19-abnormal-volume-autocorrelation-1be1-019faead"
)
OBJECTS_ROOT = SOURCE_ROOT / "objects"
ARCHIVE_BASE_URL = "https://data.binance.vision/data/spot/monthly/klines"

SYMBOLS = (
    "ADAUSDT",
    "AVAXUSDT",
    "BNBUSDT",
    "BTCUSDT",
    "DOGEUSDT",
    "ETHUSDT",
    "LINKUSDT",
    "SOLUSDT",
    "TRXUSDT",
    "XRPUSDT",
)
SOURCE_MONTHS = tuple(
    f"{year:04d}-{month:02d}"
    for year, first, last in ((2025, 1, 12), (2026, 1, 6))
    for month in range(first, last + 1)
)
WARMUP_MONTHS = frozenset(SOURCE_MONTHS[:6])
DEVELOPMENT_MONTHS = tuple(SOURCE_MONTHS[6:14])
DEVELOPMENT_SOURCE_MONTHS = frozenset(SOURCE_MONTHS[:14])
HOLDOUT_MONTHS = tuple(SOURCE_MONTHS[14:])
HOLDOUT_SOURCE_MONTHS = frozenset(HOLDOUT_MONTHS)

DEVELOPMENT_START_US = 1_751_328_000_000_000  # 2025-07-01T00:00:00Z
DEVELOPMENT_END_US = 1_772_323_200_000_000  # 2026-03-01T00:00:00Z
HOLDOUT_START_US = DEVELOPMENT_END_US
HOLDOUT_END_US = 1_783_036_800_000_000  # 2026-07-01T00:00:00Z

HOUR_US = 3_600_000_000
DAY_US = 86_400_000_000
SIGNAL_STEP_HOURS = 6
ROBUST_HISTORY_COUNT = 28
LIQUIDITY_LOOKBACK_DAYS = 30
LIQUIDITY_MIN_MEDIAN_DAILY_QV = Decimal("10000000")
MIN_COHORT_SIZE = 3
CAPACITY_PARTICIPATION = Decimal("0.0001")
STARTING_NOTIONAL_USD = Decimal("1000")

PUBLIC_FEE_PER_FILL = Decimal("0.0010")
ADVERSE_PER_FILL = {
    "base": Decimal("0.0010"),
    "stress": Decimal("0.0025"),
    "severe": Decimal("0.0050"),
}
COST_SCENARIOS: dict[str, tuple[Decimal, Decimal]] = {
    "gross": (Decimal(0), Decimal(0)),
    **{name: (PUBLIC_FEE_PER_FILL, adverse) for name, adverse in ADVERSE_PER_FILL.items()},
}

BOOTSTRAP_SEED = 2_026_072_928
BOOTSTRAP_REPLICATES = 4_096
BOOTSTRAP_BLOCK_DAYS = 7
ONE_SIDED_ALPHA = Decimal("0.05")
WHITE_P_MAXIMUM = Decimal("0.10")
BASE_MAX_DRAWDOWN = Decimal("0.15")
STRESS_MAX_DRAWDOWN = Decimal("0.20")
MIN_DEVELOPMENT_EPISODES = 40
MIN_DEVELOPMENT_ACTIVE_DAYS = 30
MIN_DEVELOPMENT_ACTIVE_MONTHS = 6
MIN_HOLDOUT_EPISODES = 20
MIN_HOLDOUT_ACTIVE_DAYS = 20
MIN_HOLDOUT_ACTIVE_MONTHS = 3
CAPACITY_GATE_USD = Decimal("1000")
PBO_MAXIMUM = Decimal("0.20")

CHECKSUM_RE = re.compile(rb"^([0-9a-f]{64})[ \t]+\*?([^\r\n]+)(?:\n)?$")
DECIMAL_RE = re.compile(r"^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$")
INTEGER_RE = re.compile(r"^(?:0|[1-9][0-9]*)$")
KLINE_FIELDS = (
    "open_time",
    "open",
    "high",
    "low",
    "close",
    "volume",
    "close_time",
    "quote_volume",
    "trade_count",
    "taker_buy_base_volume",
    "taker_buy_quote_volume",
    "ignore",
)

JsonObject = dict[str, Any]


class VG28Error(RuntimeError):
    """A terminal custody, schema, causal, or measurement violation."""


@dataclass(frozen=True, slots=True)
class Trial:
    """One member of the exact predeclared 12-trial family."""

    trial_id: str
    window_hours: int
    threshold_z: Decimal
    hold_hours: int


@dataclass(frozen=True, slots=True)
class Bar:
    """One authenticated, complete Binance Spot one-hour kline."""

    symbol: str
    open_time_us: int
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    base_volume: Decimal
    quote_volume: Decimal
    close_time_us: int


@dataclass(frozen=True, slots=True)
class Cohort:
    """One causal all-qualifier episode in a single long-only sleeve."""

    direction: str
    signal_us: int
    entry_us: int
    exit_us: int
    symbols: tuple[str, ...]
    public_capacity_proxy_usd: Decimal


@dataclass(frozen=True, slots=True)
class ScenarioPath:
    """One flat-at-boundaries, hourly marked sleeve path."""

    direction: str
    fee_per_fill: Decimal
    adverse_per_fill: Decimal
    timeline_us: tuple[int, ...]
    hourly_returns: tuple[Decimal, ...]
    daily_dates: tuple[date, ...]
    daily_returns: tuple[Decimal, ...]
    equity_at_open: tuple[Decimal, ...]
    cohorts: tuple[Cohort, ...]
    symbol_round_trips: int
    symbol_fills: int
    capacity_episode_proxies_usd: tuple[Decimal, ...]


@dataclass(frozen=True, slots=True)
class SleevePair:
    """Acceleration strategy plus matched deceleration long comparator."""

    acceleration: ScenarioPath
    deceleration: ScenarioPath


@dataclass(frozen=True, slots=True)
class TrialPaths:
    """All four frozen public cost scenarios for one trial."""

    trial: Trial
    gross: SleevePair
    base: SleevePair
    stress: SleevePair
    severe: SleevePair


@dataclass(frozen=True, slots=True)
class BootstrapSummary:
    """Seeded circular-block interval and one-sided null p-value."""

    mean_daily_return: Decimal
    total_return: Decimal
    lower_one_sided_95_total_return: Decimal
    lower_95_total_return: Decimal
    upper_95_total_return: Decimal
    one_sided_p_value: Decimal


@dataclass(slots=True)
class DevelopmentEvaluation:
    """Internal development evidence for selection and gating."""

    paths: TrialPaths
    absolute_bootstrap: BootstrapSummary
    comparator_bootstrap: BootstrapSummary
    holm_adjusted_p: Decimal = Decimal(1)
    gates: dict[str, bool] | None = None


def utc_now() -> str:
    """Return an explicit UTC receipt time."""

    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def canonical_bytes(value: object) -> bytes:
    """Encode one stable newline-terminated JSON representation."""

    return (
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True) + "\n"
    ).encode()


def canonical_sha(value: object) -> str:
    """Hash canonical JSON bytes."""

    return hashlib.sha256(canonical_bytes(value)).hexdigest()


def sha256_bytes(value: bytes) -> str:
    """Return lowercase SHA-256 for bytes."""

    return hashlib.sha256(value).hexdigest()


def sha256_path(path: Path) -> str:
    """Return streaming lowercase SHA-256 for one regular file."""

    if not path.is_file() or path.is_symlink():
        raise VG28Error(f"not an owned regular file: {path}")
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_json_once(path: Path, value: object) -> None:
    """Exclusively create immutable JSON evidence."""

    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(canonical_bytes(value))
            handle.flush()
            os.fsync(handle.fileno())
    except BaseException:
        path.unlink(missing_ok=True)
        raise


def write_bytes_once(path: Path, payload: bytes) -> None:
    """Exclusively create immutable byte evidence."""

    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
    except BaseException:
        path.unlink(missing_ok=True)
        raise


def load_json(path: Path) -> JsonObject:
    """Load one JSON object and fail closed on other roots."""

    try:
        value = json.loads(path.read_bytes())
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise VG28Error(f"invalid JSON evidence: {path.name}") from error
    if not isinstance(value, dict):
        raise VG28Error(f"JSON evidence is not an object: {path.name}")
    return cast(JsonObject, value)


def git_output(*arguments: str) -> str:
    """Run one read-only Git query against this isolated worktree."""

    try:
        return subprocess.check_output(
            ["git", *arguments],
            cwd=REPO_ROOT,
            text=True,
            stderr=subprocess.STDOUT,
        ).strip()
    except subprocess.CalledProcessError as error:
        raise VG28Error(f"Git identity query failed: {' '.join(arguments)}") from error


def decimal_text(value: Decimal, places: int = 12) -> str:
    """Render finite Decimal evidence without binary-float noise."""

    if not value.is_finite():
        raise VG28Error("non-finite Decimal result")
    return f"{value:.{places}f}"


def mean_decimal(values: Sequence[Decimal]) -> Decimal:
    """Return the exact arithmetic mean of a nonempty sequence."""

    if not values:
        raise VG28Error("mean requires observations")
    return sum(values, Decimal(0)) / Decimal(len(values))


def median_decimal(values: Sequence[Decimal]) -> Decimal:
    """Return the exact median of a nonempty sequence."""

    if not values:
        raise VG28Error("median requires observations")
    ordered = sorted(values)
    midpoint = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[midpoint]
    return (ordered[midpoint - 1] + ordered[midpoint]) / Decimal(2)


def quantile_nearest(values: Sequence[Decimal], probability: Decimal) -> Decimal:
    """Return a deterministic nearest-rank empirical quantile."""

    if not values or probability < 0 or probability > 1:
        raise VG28Error("invalid empirical quantile request")
    ordered = sorted(values)
    rank = max(1, math.ceil(float(probability) * len(ordered)))
    return ordered[min(rank - 1, len(ordered) - 1)]


def compound_return(values: Sequence[Decimal]) -> Decimal:
    """Compound simple returns."""

    equity = Decimal(1)
    for value in values:
        if value <= Decimal(-1):
            raise VG28Error("return at or below -100 percent")
        equity *= Decimal(1) + value
    return equity - Decimal(1)


def max_drawdown(values: Sequence[Decimal]) -> Decimal:
    """Return positive peak-to-trough marked drawdown magnitude."""

    equity = Decimal(1)
    peak = Decimal(1)
    worst = Decimal(0)
    for value in values:
        equity *= Decimal(1) + value
        peak = max(peak, equity)
        worst = max(worst, Decimal(1) - equity / peak)
    return worst


def month_start(month: str) -> datetime:
    """Parse an exact YYYY-MM UTC month boundary."""

    try:
        return datetime.strptime(month + "-01", "%Y-%m-%d").replace(tzinfo=UTC)
    except ValueError as error:
        raise VG28Error(f"invalid month: {month}") from error


def next_month(moment: datetime) -> datetime:
    """Return the next UTC calendar-month boundary."""

    if moment.month == 12:
        return moment.replace(year=moment.year + 1, month=1)
    return moment.replace(month=moment.month + 1)


def us_to_datetime(timestamp_us: int) -> datetime:
    """Convert exact archive microseconds to UTC."""

    return datetime.fromtimestamp(timestamp_us / 1_000_000, UTC)


def trial_grid() -> tuple[Trial, ...]:
    """Return the exact W x threshold x hold family of twelve."""

    trials = tuple(
        Trial(
            trial_id=f"vg28-w{window}-z{str(threshold).replace('.', '')}-h{hold}",
            window_hours=window,
            threshold_z=threshold,
            hold_hours=hold,
        )
        for window, threshold, hold in itertools.product(
            (1, 2, 4),
            (Decimal("1.5"), Decimal("2.5")),
            (2, 6),
        )
    )
    if len(trials) != 12 or len({trial.trial_id for trial in trials}) != 12:
        raise VG28Error("trial family is not exactly twelve unique members")
    return trials


def trial_mapping(trial: Trial) -> JsonObject:
    """Serialize one trial."""

    return {
        "holdHours": trial.hold_hours,
        "thresholdZ": format(trial.threshold_z, "f"),
        "trialId": trial.trial_id,
        "windowHours": trial.window_hours,
    }


def expected_names() -> frozenset[str]:
    """Return the exact raw object inventory names."""

    return frozenset(
        name
        for symbol, month in itertools.product(SYMBOLS, SOURCE_MONTHS)
        for name in (
            f"{symbol}-1h-{month}.zip",
            f"{symbol}-1h-{month}.zip.CHECKSUM",
        )
    )


def verify_checksum_text(payload: bytes, archive_name: str, archive_sha: str) -> None:
    """Authenticate the exact Binance CHECKSUM grammar and binding."""

    match = CHECKSUM_RE.fullmatch(payload)
    if match is None:
        try:
            payload.decode("ascii")
        except UnicodeDecodeError as error:
            raise VG28Error(f"CHECKSUM is not ASCII: {archive_name}") from error
        raise VG28Error(f"CHECKSUM has invalid grammar: {archive_name}")
    digest = match.group(1).decode("ascii")
    try:
        bound_name = match.group(2).decode("ascii")
    except UnicodeDecodeError as error:
        raise VG28Error(f"CHECKSUM filename is not ASCII: {archive_name}") from error
    if bound_name != archive_name:
        raise VG28Error(f"CHECKSUM filename mismatch: {archive_name}")
    if digest != archive_sha:
        raise VG28Error(f"CHECKSUM digest mismatch: {archive_name}")


def safe_object_path(relative_name: str) -> Path:
    """Resolve one direct, non-symlink cache object."""

    if Path(relative_name).name != relative_name:
        raise VG28Error(f"unsafe object name: {relative_name}")
    path = OBJECTS_ROOT / relative_name
    if not path.is_file() or path.is_symlink():
        raise VG28Error(f"missing regular cache object: {relative_name}")
    if path.resolve().parent != OBJECTS_ROOT.resolve():
        raise VG28Error(f"cache object escaped root: {relative_name}")
    return path


def inventory_sources() -> None:
    """Authenticate raw cache bytes without opening a ZIP member."""

    if SOURCE_MANIFEST_PATH.exists():
        raise VG28Error("source manifest already exists")
    if not OBJECTS_ROOT.is_dir() or OBJECTS_ROOT.is_symlink():
        raise VG28Error("external raw cache object root is unavailable")
    actual = frozenset(
        path.name for path in OBJECTS_ROOT.iterdir() if path.is_file() or path.is_symlink()
    )
    expected = expected_names()
    if actual != expected:
        missing = sorted(expected - actual)
        extra = sorted(actual - expected)
        raise VG28Error(
            f"external object inventory mismatch missing={missing[:3]} extra={extra[:3]}"
        )
    records: list[JsonObject] = []
    for symbol, month in itertools.product(SYMBOLS, SOURCE_MONTHS):
        archive_name = f"{symbol}-1h-{month}.zip"
        archive_path = safe_object_path(archive_name)
        checksum_path = safe_object_path(f"{archive_name}.CHECKSUM")
        archive_sha = sha256_path(archive_path)
        checksum_bytes = checksum_path.read_bytes()
        verify_checksum_text(checksum_bytes, archive_name, archive_sha)
        records.append(
            {
                "archiveBytes": archive_path.stat().st_size,
                "archiveName": archive_name,
                "archiveSha256": archive_sha,
                "archiveUrl": (f"{ARCHIVE_BASE_URL}/{symbol}/1h/{archive_name}"),
                "checksumBytes": len(checksum_bytes),
                "checksumName": f"{archive_name}.CHECKSUM",
                "checksumSha256": sha256_bytes(checksum_bytes),
                "checksumUrl": (f"{ARCHIVE_BASE_URL}/{symbol}/1h/{archive_name}.CHECKSUM"),
                "month": month,
                "symbol": symbol,
            }
        )
    manifest = {
        "archiveCount": len(records),
        "baseCommit": BASE_COMMIT,
        "cacheMetadataTrusted": False,
        "cacheUse": "RAW_ZIP_AND_CHECKSUM_BYTES_ONLY",
        "checksumCount": len(records),
        "createdAtUtc": utc_now(),
        "expectedObjectCount": len(expected),
        "records": records,
        "schema": "VG28FrozenBinancePublicSourceManifestV1",
        "sourceRoot": str(SOURCE_ROOT),
        "sourceScope": "BINANCE_OFFICIAL_PUBLIC_MONTHLY_SPOT_1H_KLINES",
        "state": "COMPRESSED_BYTES_CHECKSUM_VERIFIED_MEMBERS_UNOPENED",
    }
    write_json_once(SOURCE_MANIFEST_PATH, manifest)


def mapping_records(value: object, *, field: str) -> list[JsonObject]:
    """Validate a list of JSON objects."""

    if not isinstance(value, list) or not all(isinstance(item, dict) for item in value):
        raise VG28Error(f"{field} is not a list of objects")
    return cast(list[JsonObject], value)


def manifest_records(manifest: Mapping[str, object]) -> list[JsonObject]:
    """Authenticate exact source-manifest identity without opening members."""

    if manifest.get("schema") != "VG28FrozenBinancePublicSourceManifestV1":
        raise VG28Error("source manifest schema mismatch")
    if manifest.get("baseCommit") != BASE_COMMIT:
        raise VG28Error("source manifest base mismatch")
    if manifest.get("cacheUse") != "RAW_ZIP_AND_CHECKSUM_BYTES_ONLY":
        raise VG28Error("source manifest cache scope mismatch")
    if manifest.get("sourceRoot") != str(SOURCE_ROOT):
        raise VG28Error("source manifest root mismatch")
    if (
        manifest.get("archiveCount") != len(SYMBOLS) * len(SOURCE_MONTHS)
        or manifest.get("checksumCount") != len(SYMBOLS) * len(SOURCE_MONTHS)
        or manifest.get("expectedObjectCount") != 2 * len(SYMBOLS) * len(SOURCE_MONTHS)
    ):
        raise VG28Error("source manifest count mismatch")
    if manifest.get("sourceScope") != "BINANCE_OFFICIAL_PUBLIC_MONTHLY_SPOT_1H_KLINES":
        raise VG28Error("source manifest scope mismatch")
    records = mapping_records(manifest.get("records"), field="records")
    if len(records) != len(SYMBOLS) * len(SOURCE_MONTHS):
        raise VG28Error("source manifest record count mismatch")
    keys = [(item.get("symbol"), item.get("month")) for item in records]
    expected_keys = list(itertools.product(SYMBOLS, SOURCE_MONTHS))
    if keys != expected_keys or len(set(keys)) != len(keys):
        raise VG28Error("source manifest symbol/month inventory mismatch")
    for item in records:
        symbol = cast(str, item["symbol"])
        month = cast(str, item["month"])
        expected_name = f"{symbol}-1h-{month}.zip"
        if item.get("archiveName") != expected_name:
            raise VG28Error(f"source archive name mismatch: {symbol} {month}")
        if item.get("checksumName") != f"{expected_name}.CHECKSUM":
            raise VG28Error(f"source checksum name mismatch: {symbol} {month}")
        expected_url = f"{ARCHIVE_BASE_URL}/{symbol}/1h/{expected_name}"
        if item.get("archiveUrl") != expected_url:
            raise VG28Error(f"source archive URL mismatch: {symbol} {month}")
        if item.get("checksumUrl") != f"{expected_url}.CHECKSUM":
            raise VG28Error(f"source checksum URL mismatch: {symbol} {month}")
        for field in ("archiveBytes", "checksumBytes"):
            size = item.get(field)
            if isinstance(size, bool) or not isinstance(size, int) or size <= 0:
                raise VG28Error(f"invalid source byte count: {field}")
        for field in ("archiveSha256", "checksumSha256"):
            digest = item.get(field)
            if (
                not isinstance(digest, str)
                or len(digest) != 64
                or re.fullmatch(r"[0-9a-f]{64}", digest) is None
            ):
                raise VG28Error(f"invalid source digest: {field}")
    return records


def verify_source_bytes(manifest: Mapping[str, object]) -> None:
    """Reauthenticate every compressed byte and sidecar without decompression."""

    for item in manifest_records(manifest):
        archive_name = cast(str, item["archiveName"])
        archive_path = safe_object_path(archive_name)
        checksum_path = safe_object_path(cast(str, item["checksumName"]))
        archive_sha = sha256_path(archive_path)
        checksum_bytes = checksum_path.read_bytes()
        if archive_path.stat().st_size != item["archiveBytes"]:
            raise VG28Error(f"archive byte count changed: {archive_name}")
        if len(checksum_bytes) != item["checksumBytes"]:
            raise VG28Error(f"CHECKSUM byte count changed: {archive_name}")
        if archive_sha != item["archiveSha256"]:
            raise VG28Error(f"archive bytes changed: {archive_name}")
        if sha256_bytes(checksum_bytes) != item["checksumSha256"]:
            raise VG28Error(f"CHECKSUM bytes changed: {archive_name}")
        verify_checksum_text(checksum_bytes, archive_name, archive_sha)


def required_static_hashes() -> JsonObject:
    """Hash every static input named by the freeze."""

    paths = {
        "evaluatorSha256": Path(__file__),
        "testSha256": TEST_PATH,
        "protocolSha256": PROTOCOL_PATH,
        "readmeSha256": README_PATH,
        "officialResearchSha256": OFFICIAL_RESEARCH_PATH,
        "initSha256": INIT_PATH,
        "quantPyprojectSha256": REPO_ROOT / "quant" / "pyproject.toml",
        "quantUvLockSha256": REPO_ROOT / "quant" / "uv.lock",
        "sourceManifestSha256": SOURCE_MANIFEST_PATH,
    }
    return {field: sha256_path(path) for field, path in paths.items()}


def validate_scope_lineage() -> str:
    """Require exact canonical ancestry and exclusive packet-scope changes."""

    head = git_output("rev-parse", "HEAD")
    if git_output("merge-base", BASE_COMMIT, head) != BASE_COMMIT:
        raise VG28Error("worktree is not descended from exact canonical base")
    changed = tuple(
        line
        for line in git_output("diff", "--name-only", f"{BASE_COMMIT}..{head}").splitlines()
        if line
    )
    if any(not line.startswith("quant/research/vg28/") for line in changed):
        raise VG28Error("branch contains changes outside quant/research/vg28")
    return head


def freeze() -> None:
    """Create the pre-outcome identity freeze without opening ZIP members."""

    if FREEZE_PATH.exists():
        raise VG28Error("freeze already exists")
    if git_output("status", "--porcelain"):
        raise VG28Error("freeze requires committed static inputs and a clean worktree")
    head = validate_scope_lineage()
    manifest = load_json(SOURCE_MANIFEST_PATH)
    verify_source_bytes(manifest)
    receipt: JsonObject = {
        "baseCommit": BASE_COMMIT,
        "createdAtUtc": utc_now(),
        "gitHead": head,
        "memberBodiesOpenedByVg28": 0,
        "pythonImplementation": sys.implementation.name,
        "pythonVersion": sys.version,
        "schema": "VG28PreOutcomeFreezeV1",
        "state": "READY_FOR_ONE_ARCHIVE_DECOMPRESSION_RUN",
        "trialCount": 12,
        "trialFingerprintSha256": canonical_sha([trial_mapping(trial) for trial in trial_grid()]),
        **required_static_hashes(),
    }
    write_json_once(FREEZE_PATH, receipt)


def validate_freeze() -> tuple[JsonObject, JsonObject]:
    """Authenticate all frozen pre-run inputs without decompression."""

    freeze_receipt = load_json(FREEZE_PATH)
    manifest = load_json(SOURCE_MANIFEST_PATH)
    if freeze_receipt.get("schema") != "VG28PreOutcomeFreezeV1":
        raise VG28Error("freeze schema mismatch")
    if freeze_receipt.get("state") != "READY_FOR_ONE_ARCHIVE_DECOMPRESSION_RUN":
        raise VG28Error("freeze state mismatch")
    if freeze_receipt.get("baseCommit") != BASE_COMMIT:
        raise VG28Error("freeze base mismatch")
    if freeze_receipt.get("trialCount") != 12:
        raise VG28Error("freeze trial count mismatch")
    if freeze_receipt.get("pythonImplementation") != sys.implementation.name:
        raise VG28Error("Python implementation changed after freeze")
    if freeze_receipt.get("pythonVersion") != sys.version:
        raise VG28Error("Python version changed after freeze")
    current_head = validate_scope_lineage()
    frozen_head = freeze_receipt.get("gitHead")
    if (
        not isinstance(frozen_head, str)
        or re.fullmatch(r"[0-9a-f]{40}", frozen_head) is None
        or git_output("merge-base", frozen_head, current_head) != frozen_head
    ):
        raise VG28Error("current branch is not descended from the frozen head")
    if freeze_receipt.get("trialFingerprintSha256") != canonical_sha(
        [trial_mapping(trial) for trial in trial_grid()]
    ):
        raise VG28Error("trial family changed after freeze")
    for field, digest in required_static_hashes().items():
        if freeze_receipt.get(field) != digest:
            raise VG28Error(f"{field} changed after freeze")
    manifest_records(manifest)
    return freeze_receipt, manifest


def parse_decimal(
    raw: str,
    *,
    field: str,
    positive: bool = False,
    nonnegative: bool = False,
) -> Decimal:
    """Parse Binance's plain nonnegative decimal grammar."""

    if DECIMAL_RE.fullmatch(raw) is None:
        raise VG28Error(f"invalid decimal {field}")
    try:
        value = Decimal(raw)
    except InvalidOperation as error:
        raise VG28Error(f"invalid decimal {field}") from error
    if not value.is_finite():
        raise VG28Error(f"non-finite decimal {field}")
    if positive and value <= 0:
        raise VG28Error(f"positive bound failed for {field}")
    if nonnegative and value < 0:
        raise VG28Error(f"nonnegative bound failed for {field}")
    return value


def parse_timestamp_us(raw: str, *, field: str) -> int:
    """Require a 16-digit positive microsecond timestamp."""

    if INTEGER_RE.fullmatch(raw) is None:
        raise VG28Error(f"invalid integer {field}")
    value = int(raw)
    if value < 1_000_000_000_000_000 or value >= 10_000_000_000_000_000:
        raise VG28Error(f"{field} is not a microsecond timestamp")
    return value


def parse_archive(artifact: Mapping[str, object]) -> tuple[Bar, ...]:
    """Open one hash-bound ZIP once and validate its headerless full-hour grid."""

    symbol = artifact.get("symbol")
    month = artifact.get("month")
    if symbol not in SYMBOLS or month not in SOURCE_MONTHS:
        raise VG28Error("archive artifact symbol/month outside frozen inventory")
    archive_name = f"{symbol}-1h-{month}.zip"
    if artifact.get("archiveName") != archive_name:
        raise VG28Error("archive artifact filename mismatch")
    archive_path = safe_object_path(archive_name)
    checksum_path = safe_object_path(f"{archive_name}.CHECKSUM")
    archive_sha = sha256_path(archive_path)
    checksum_bytes = checksum_path.read_bytes()
    if archive_sha != artifact.get("archiveSha256"):
        raise VG28Error(f"archive hash mismatch: {archive_name}")
    if sha256_bytes(checksum_bytes) != artifact.get("checksumSha256"):
        raise VG28Error(f"CHECKSUM hash mismatch: {archive_name}")
    verify_checksum_text(checksum_bytes, archive_name, archive_sha)
    expected_member = f"{symbol}-1h-{month}.csv"
    try:
        with zipfile.ZipFile(archive_path) as archive:
            members = archive.infolist()
            if (
                len(members) != 1
                or members[0].filename != expected_member
                or members[0].is_dir()
                or members[0].flag_bits & 0x1
                or Path(members[0].filename).name != members[0].filename
            ):
                raise VG28Error(f"invalid ZIP member inventory: {archive_name}")
            raw_csv = archive.read(members[0])
    except (OSError, zipfile.BadZipFile, RuntimeError) as error:
        if isinstance(error, VG28Error):
            raise
        raise VG28Error(f"invalid ZIP bytes: {archive_name}") from error
    try:
        text = raw_csv.decode("utf-8")
    except UnicodeDecodeError as error:
        raise VG28Error(f"CSV is not UTF-8: {archive_name}") from error
    reader = csv.reader(io.StringIO(text, newline=""))
    bars: list[Bar] = []
    for row_number, row in enumerate(reader, start=1):
        if len(row) != 12:
            raise VG28Error(f"{archive_name} row {row_number}: expected exactly 12 columns")
        try:
            open_time = parse_timestamp_us(row[0], field="openTime")
        except VG28Error as error:
            if row_number == 1 and INTEGER_RE.fullmatch(row[0]) is None:
                raise VG28Error(f"{archive_name}: archive must be headerless") from error
            raise
        close_time = parse_timestamp_us(row[6], field="closeTime")
        opened = us_to_datetime(open_time)
        open_price = parse_decimal(row[1], field="open", positive=True)
        high = parse_decimal(row[2], field="high", positive=True)
        low = parse_decimal(row[3], field="low", positive=True)
        close_price = parse_decimal(row[4], field="close", positive=True)
        base_volume = parse_decimal(row[5], field="baseVolume", nonnegative=True)
        quote_volume = parse_decimal(row[7], field="quoteVolume", nonnegative=True)
        if INTEGER_RE.fullmatch(row[8]) is None:
            raise VG28Error(f"{archive_name} row {row_number}: invalid trade count")
        taker_base = parse_decimal(row[9], field="takerBuyBaseVolume", nonnegative=True)
        taker_quote = parse_decimal(row[10], field="takerBuyQuoteVolume", nonnegative=True)
        parse_decimal(row[11], field="ignore", nonnegative=True)
        if open_time % HOUR_US or opened.minute or opened.second or opened.microsecond:
            raise VG28Error(f"{archive_name} row {row_number}: non-hourly UTC open")
        if close_time != open_time + HOUR_US - 1:
            raise VG28Error(f"{archive_name} row {row_number}: invalid close boundary")
        if high < max(open_price, close_price) or low > min(open_price, close_price):
            raise VG28Error(f"{archive_name} row {row_number}: invalid OHLC bounds")
        if low > high or taker_base > base_volume or taker_quote > quote_volume:
            raise VG28Error(f"{archive_name} row {row_number}: invalid volume bounds")
        bars.append(
            Bar(
                symbol=symbol,
                open_time_us=open_time,
                open=open_price,
                high=high,
                low=low,
                close=close_price,
                base_volume=base_volume,
                quote_volume=quote_volume,
                close_time_us=close_time,
            )
        )
    start_us = int(month_start(month).timestamp()) * 1_000_000
    end_us = int(next_month(month_start(month)).timestamp()) * 1_000_000
    expected_grid = tuple(range(start_us, end_us, HOUR_US))
    found_grid = tuple(bar.open_time_us for bar in bars)
    if len(set(found_grid)) != len(found_grid):
        raise VG28Error(f"{archive_name}: duplicate hourly rows")
    if found_grid != expected_grid:
        raise VG28Error(f"{archive_name}: incomplete, unsorted, or off-grid month")
    return tuple(bars)


def load_bars(
    manifest: Mapping[str, object],
    months: frozenset[str],
    existing: Mapping[str, Mapping[int, Bar]] | None = None,
) -> dict[str, dict[int, Bar]]:
    """Open only a named month partition and require a common full grid."""

    if not months or not months.issubset(set(SOURCE_MONTHS)):
        raise VG28Error("invalid source month partition")
    result = {symbol: dict((existing or {}).get(symbol, {})) for symbol in SYMBOLS}
    selected = [item for item in manifest_records(manifest) if item.get("month") in months]
    if len(selected) != len(SYMBOLS) * len(months):
        raise VG28Error("source partition record count mismatch")
    for artifact in selected:
        symbol = cast(str, artifact["symbol"])
        for bar in parse_archive(artifact):
            if bar.open_time_us in result[symbol]:
                raise VG28Error(f"duplicate opened bar: {symbol} {bar.open_time_us}")
            result[symbol][bar.open_time_us] = bar
    reference: tuple[int, ...] | None = None
    for symbol in SYMBOLS:
        grid = tuple(sorted(result[symbol]))
        if reference is None:
            reference = grid
        elif grid != reference:
            raise VG28Error(f"cross-symbol hourly grid mismatch: {symbol}")
    return result


def window_quote_volume(
    bars: Mapping[int, Bar],
    start_us: int,
    end_us: int,
) -> Decimal | None:
    """Sum an exact completed, half-open hourly quote-volume window."""

    if end_us <= start_us or (end_us - start_us) % HOUR_US:
        raise VG28Error("quote-volume window is not whole positive hours")
    values: list[Decimal] = []
    for timestamp in range(start_us, end_us, HOUR_US):
        bar = bars.get(timestamp)
        if bar is None or bar.close_time_us >= end_us:
            return None
        values.append(bar.quote_volume)
    total = sum(values, Decimal(0))
    return total if total > 0 else None


def curvature_at(
    bars: Mapping[int, Bar],
    signal_us: int,
    window_hours: int,
) -> Decimal | None:
    """Compute ln(V0)-2ln(V1)+ln(V2) from three completed windows."""

    width = window_hours * HOUR_US
    newest = window_quote_volume(bars, signal_us - width, signal_us)
    middle = window_quote_volume(bars, signal_us - 2 * width, signal_us - width)
    oldest = window_quote_volume(bars, signal_us - 3 * width, signal_us - 2 * width)
    if newest is None or middle is None or oldest is None:
        return None
    return newest.ln() - Decimal(2) * middle.ln() + oldest.ln()


def robust_z(current: Decimal, prior: Sequence[Decimal]) -> Decimal | None:
    """Standardize against exactly 28 prior same-UTC-slot curvatures."""

    if len(prior) != ROBUST_HISTORY_COUNT:
        return None
    center = median_decimal(prior)
    mad = median_decimal(tuple(abs(value - center) for value in prior))
    scale = Decimal("1.4826") * mad
    if scale <= 0:
        return None
    return (current - center) / scale


def six_hour_boundaries(start_us: int, end_us: int) -> tuple[int, ...]:
    """Return UTC 00/06/12/18 boundaries in a half-open partition."""

    step = SIGNAL_STEP_HOURS * HOUR_US
    first = ((start_us + step - 1) // step) * step
    return tuple(range(first, end_us, step))


def compute_z_scores(
    bars: Mapping[str, Mapping[int, Bar]],
    window_hours: int,
) -> dict[str, dict[int, Decimal]]:
    """Compute causal own-symbol z-scores using prior same-hour slots only."""

    if window_hours not in (1, 2, 4):
        raise VG28Error("window width is outside the frozen family")
    result: dict[str, dict[int, Decimal]] = {}
    for symbol in SYMBOLS:
        symbol_bars = bars[symbol]
        timestamps = sorted(symbol_bars)
        if not timestamps:
            raise VG28Error(f"empty bar history: {symbol}")
        start = timestamps[0]
        end = timestamps[-1] + HOUR_US + 1
        history: dict[int, list[Decimal]] = defaultdict(list)
        scores: dict[int, Decimal] = {}
        for signal_us in six_hour_boundaries(start, end):
            curvature = curvature_at(symbol_bars, signal_us, window_hours)
            if curvature is None:
                continue
            slot = us_to_datetime(signal_us).hour
            prior = history[slot][-ROBUST_HISTORY_COUNT:]
            score = robust_z(curvature, prior)
            if score is not None:
                scores[signal_us] = score
            history[slot].append(curvature)
        result[symbol] = scores
    return result


def prior_completed_daily_volumes(
    bars: Mapping[int, Bar],
    signal_us: int,
    lookback_days: int = LIQUIDITY_LOOKBACK_DAYS,
) -> tuple[Decimal, ...] | None:
    """Return prior full UTC-day quote volumes, excluding signal day."""

    signal_day = us_to_datetime(signal_us).date()
    daily: list[Decimal] = []
    for offset in range(lookback_days, 0, -1):
        day = signal_day - timedelta(days=offset)
        start = int(datetime(day.year, day.month, day.day, tzinfo=UTC).timestamp()) * 1_000_000
        total = window_quote_volume(bars, start, start + DAY_US)
        if total is None:
            return None
        daily.append(total)
    return tuple(daily)


def liquidity_eligible(
    bars: Mapping[int, Bar],
    signal_us: int,
) -> bool:
    """Apply the causal 30-completed-day median quote-volume screen."""

    volumes = prior_completed_daily_volumes(bars, signal_us)
    return volumes is not None and median_decimal(volumes) >= LIQUIDITY_MIN_MEDIAN_DAILY_QV


def build_liquidity_map(
    bars: Mapping[str, Mapping[int, Bar]],
    start_us: int,
    end_us: int,
) -> dict[str, dict[int, bool]]:
    """Precompute the frozen causal liquidity screen."""

    boundaries = six_hour_boundaries(start_us, end_us)
    return {
        symbol: {signal_us: liquidity_eligible(bars[symbol], signal_us) for signal_us in boundaries}
        for symbol in SYMBOLS
    }


def episode_capacity_proxy(
    bars: Mapping[str, Mapping[int, Bar]],
    symbols: Sequence[str],
    signal_us: int,
) -> Decimal:
    """Return N x bottleneck 1bp prior-completed-24h quote volume."""

    if not symbols:
        raise VG28Error("capacity proxy requires a cohort")
    member_proxies: list[Decimal] = []
    for symbol in symbols:
        trailing = window_quote_volume(bars[symbol], signal_us - 24 * HOUR_US, signal_us)
        if trailing is None:
            raise VG28Error(f"capacity history unavailable: {symbol}")
        member_proxies.append(trailing * CAPACITY_PARTICIPATION)
    return Decimal(len(symbols)) * min(member_proxies)


def select_cohorts(
    scores: Mapping[str, Mapping[int, Decimal]],
    bars: Mapping[str, Mapping[int, Bar]],
    trial: Trial,
    start_us: int,
    end_us: int,
    direction: str,
    liquidity: Mapping[str, Mapping[int, bool]] | None = None,
) -> tuple[Cohort, ...]:
    """Select every qualifying symbol or remain entirely cash."""

    if direction not in ("acceleration", "deceleration"):
        raise VG28Error("unknown sleeve direction")
    cohorts: list[Cohort] = []
    active_until = start_us
    for signal_us in six_hour_boundaries(start_us, end_us):
        if signal_us < active_until:
            continue
        selected: list[str] = []
        for symbol in SYMBOLS:
            liquid = (
                liquidity[symbol].get(signal_us, False)
                if liquidity is not None
                else liquidity_eligible(bars[symbol], signal_us)
            )
            score = scores[symbol].get(signal_us)
            threshold_pass = score is not None and (
                score >= trial.threshold_z
                if direction == "acceleration"
                else score <= -trial.threshold_z
            )
            if liquid and threshold_pass:
                selected.append(symbol)
        if len(selected) < MIN_COHORT_SIZE:
            continue
        entry_us = signal_us + HOUR_US
        exit_us = entry_us + trial.hold_hours * HOUR_US
        # A signal at D sees bars only through D.  [D,D+1) is the mandatory
        # intervening full bar, and the D+1 open is the first executable proxy.
        if entry_us >= end_us or exit_us >= end_us:
            continue
        selected_symbols = tuple(selected)
        cohorts.append(
            Cohort(
                direction=direction,
                signal_us=signal_us,
                entry_us=entry_us,
                exit_us=exit_us,
                symbols=selected_symbols,
                public_capacity_proxy_usd=episode_capacity_proxy(bars, selected_symbols, signal_us),
            )
        )
        active_until = exit_us
    return tuple(cohorts)


def daily_returns_from_hourly(
    timeline: Sequence[int],
    hourly_returns: Sequence[Decimal],
) -> tuple[tuple[date, ...], tuple[Decimal, ...]]:
    """Compound a full hourly path into aligned UTC calendar days."""

    if len(timeline) != len(hourly_returns):
        raise VG28Error("hourly timeline and returns are misaligned")
    grouped: dict[date, list[Decimal]] = defaultdict(list)
    for timestamp, value in zip(timeline, hourly_returns, strict=True):
        grouped[us_to_datetime(timestamp).date()].append(value)
    dates = tuple(sorted(grouped))
    for day in dates:
        if len(grouped[day]) != 24:
            raise VG28Error(f"partial UTC day in inference path: {day}")
    return dates, tuple(compound_return(grouped[day]) for day in dates)


def simulate_sleeve(
    bars: Mapping[str, Mapping[int, Bar]],
    cohorts: Sequence[Cohort],
    start_us: int,
    end_us: int,
    fee_per_fill: Decimal,
    adverse_per_fill: Decimal,
    direction: str,
) -> ScenarioPath:
    """Mark one non-overlapping equal-weight long-only sleeve at hourly opens."""

    if fee_per_fill < 0 or fee_per_fill >= 1 or adverse_per_fill < 0 or adverse_per_fill >= 1:
        raise VG28Error("invalid public fee or adverse-price proxy")
    timeline = tuple(range(start_us, end_us, HOUR_US))
    entries = {cohort.entry_us: cohort for cohort in cohorts}
    exits = {cohort.exit_us: cohort for cohort in cohorts}
    if len(entries) != len(cohorts) or len(exits) != len(cohorts):
        raise VG28Error("cohort episodes overlap or duplicate")
    cash = STARTING_NOTIONAL_USD
    units: dict[str, Decimal] | None = None
    current: Cohort | None = None
    previous_equity = STARTING_NOTIONAL_USD
    equity_path: list[Decimal] = []
    hourly_returns: list[Decimal] = []
    for timestamp in timeline:
        if timestamp in exits:
            expected = exits[timestamp]
            if current != expected or units is None:
                raise VG28Error("sleeve exit state mismatch")
            cash = sum(
                (
                    units[symbol]
                    * bars[symbol][timestamp].open
                    * (Decimal(1) - adverse_per_fill)
                    * (Decimal(1) - fee_per_fill)
                    for symbol in current.symbols
                ),
                Decimal(0),
            )
            units = None
            current = None
        if timestamp in entries:
            if current is not None or units is not None:
                raise VG28Error("sleeve entry overlaps an active episode")
            current = entries[timestamp]
            executed_quote_notional = cash / (Decimal(1) + fee_per_fill)
            member_notional = executed_quote_notional / Decimal(len(current.symbols))
            units = {
                symbol: member_notional
                / (bars[symbol][timestamp].open * (Decimal(1) + adverse_per_fill))
                for symbol in current.symbols
            }
            cash = Decimal(0)
        if current is None:
            equity = cash
        else:
            if units is None:
                raise VG28Error("active sleeve has no units")
            equity = sum(
                (
                    units[symbol]
                    * bars[symbol][timestamp].open
                    * (Decimal(1) - adverse_per_fill)
                    * (Decimal(1) - fee_per_fill)
                    for symbol in current.symbols
                ),
                Decimal(0),
            )
        if equity <= 0:
            raise VG28Error("nonpositive marked sleeve equity")
        hourly_returns.append(equity / previous_equity - Decimal(1))
        equity_path.append(equity)
        previous_equity = equity
    if current is not None or units is not None:
        raise VG28Error("sleeve was not flat before partition end")
    daily_dates, daily_returns = daily_returns_from_hourly(timeline, hourly_returns)
    round_trips = sum(len(cohort.symbols) for cohort in cohorts)
    return ScenarioPath(
        direction=direction,
        fee_per_fill=fee_per_fill,
        adverse_per_fill=adverse_per_fill,
        timeline_us=timeline,
        hourly_returns=tuple(hourly_returns),
        daily_dates=daily_dates,
        daily_returns=daily_returns,
        equity_at_open=tuple(equity_path),
        cohorts=tuple(cohorts),
        symbol_round_trips=round_trips,
        symbol_fills=round_trips * 2,
        capacity_episode_proxies_usd=tuple(cohort.public_capacity_proxy_usd for cohort in cohorts),
    )


def simulate_trial(
    bars: Mapping[str, Mapping[int, Bar]],
    scores: Mapping[str, Mapping[int, Decimal]],
    liquidity: Mapping[str, Mapping[int, bool]],
    trial: Trial,
    start_us: int,
    end_us: int,
) -> TrialPaths:
    """Simulate both sleeves under every frozen public cost scenario."""

    acceleration = select_cohorts(scores, bars, trial, start_us, end_us, "acceleration", liquidity)
    deceleration = select_cohorts(scores, bars, trial, start_us, end_us, "deceleration", liquidity)
    pairs: dict[str, SleevePair] = {}
    for name, (fee, adverse) in COST_SCENARIOS.items():
        pairs[name] = SleevePair(
            acceleration=simulate_sleeve(
                bars,
                acceleration,
                start_us,
                end_us,
                fee,
                adverse,
                "acceleration",
            ),
            deceleration=simulate_sleeve(
                bars,
                deceleration,
                start_us,
                end_us,
                fee,
                adverse,
                "deceleration",
            ),
        )
    return TrialPaths(
        trial=trial,
        gross=pairs["gross"],
        base=pairs["base"],
        stress=pairs["stress"],
        severe=pairs["severe"],
    )


def circular_indices(
    length: int,
    block_days: int,
    randomizer: random.Random,
) -> tuple[int, ...]:
    """Draw one circular block index vector of exact target length."""

    if length <= 0 or block_days <= 0:
        raise VG28Error("invalid circular-block dimensions")
    indices: list[int] = []
    while len(indices) < length:
        start = randomizer.randrange(length)
        indices.extend((start + offset) % length for offset in range(block_days))
    return tuple(indices[:length])


def circular_block_bootstrap(
    daily_returns: Sequence[Decimal],
    *,
    seed: int = BOOTSTRAP_SEED,
) -> BootstrapSummary:
    """Return a deterministic 7-day circular-block total-return interval."""

    if len(daily_returns) < BOOTSTRAP_BLOCK_DAYS * 2:
        raise VG28Error("daily path is too short for circular-block bootstrap")
    observed_mean = mean_decimal(daily_returns)
    observed_total = compound_return(daily_returns)
    centered = tuple(value - observed_mean for value in daily_returns)
    randomizer = random.Random(seed)
    totals: list[Decimal] = []
    null_exceedances = 0
    for _ in range(BOOTSTRAP_REPLICATES):
        indices = circular_indices(len(daily_returns), BOOTSTRAP_BLOCK_DAYS, randomizer)
        sample = tuple(daily_returns[index] for index in indices)
        totals.append(compound_return(sample))
        null_mean = mean_decimal(tuple(centered[index] for index in indices))
        if null_mean >= observed_mean:
            null_exceedances += 1
    return BootstrapSummary(
        mean_daily_return=observed_mean,
        total_return=observed_total,
        lower_one_sided_95_total_return=quantile_nearest(totals, Decimal("0.05")),
        lower_95_total_return=quantile_nearest(totals, Decimal("0.025")),
        upper_95_total_return=quantile_nearest(totals, Decimal("0.975")),
        one_sided_p_value=(Decimal(null_exceedances + 1) / Decimal(BOOTSTRAP_REPLICATES + 1)),
    )


def paired_terminal_difference_bootstrap(
    acceleration_daily_returns: Sequence[Decimal],
    comparator_daily_returns: Sequence[Decimal],
    *,
    seed: int = BOOTSTRAP_SEED,
) -> BootstrapSummary:
    """Bootstrap paired terminal-return differences with synchronous indices."""

    if (
        len(acceleration_daily_returns) != len(comparator_daily_returns)
        or len(acceleration_daily_returns) < BOOTSTRAP_BLOCK_DAYS * 2
    ):
        raise VG28Error("paired bootstrap paths are short or misaligned")
    daily_differences = tuple(
        acceleration - comparator
        for acceleration, comparator in zip(
            acceleration_daily_returns,
            comparator_daily_returns,
            strict=True,
        )
    )
    observed_mean = mean_decimal(daily_differences)
    observed_total = compound_return(acceleration_daily_returns) - compound_return(
        comparator_daily_returns
    )
    centered_differences = tuple(value - observed_mean for value in daily_differences)
    randomizer = random.Random(seed)
    totals: list[Decimal] = []
    null_exceedances = 0
    for _ in range(BOOTSTRAP_REPLICATES):
        indices = circular_indices(
            len(acceleration_daily_returns),
            BOOTSTRAP_BLOCK_DAYS,
            randomizer,
        )
        totals.append(
            compound_return(tuple(acceleration_daily_returns[index] for index in indices))
            - compound_return(tuple(comparator_daily_returns[index] for index in indices))
        )
        null_mean = mean_decimal(tuple(centered_differences[index] for index in indices))
        if null_mean >= observed_mean:
            null_exceedances += 1
    return BootstrapSummary(
        mean_daily_return=observed_mean,
        total_return=observed_total,
        lower_one_sided_95_total_return=quantile_nearest(totals, Decimal("0.05")),
        lower_95_total_return=quantile_nearest(totals, Decimal("0.025")),
        upper_95_total_return=quantile_nearest(totals, Decimal("0.975")),
        one_sided_p_value=(Decimal(null_exceedances + 1) / Decimal(BOOTSTRAP_REPLICATES + 1)),
    )


def holm_adjusted(
    raw_p_values: Mapping[str, Decimal],
) -> dict[str, Decimal]:
    """Return deterministic Holm-Bonferroni adjusted p-values."""

    ordered = sorted(raw_p_values.items(), key=lambda item: (item[1], item[0]))
    adjusted: dict[str, Decimal] = {}
    running = Decimal(0)
    count = len(ordered)
    for rank, (trial_id, p_value) in enumerate(ordered):
        candidate = min(Decimal(1), Decimal(count - rank) * p_value)
        running = max(running, candidate)
        adjusted[trial_id] = running
    return adjusted


def white_reality_check(
    trial_returns: Mapping[str, Sequence[Decimal]],
    *,
    seed: int = BOOTSTRAP_SEED,
) -> JsonObject:
    """White Reality Check over the aligned family of twelve base paths."""

    if len(trial_returns) != 12:
        raise VG28Error("White Reality Check requires exactly twelve trials")
    lengths = {len(path) for path in trial_returns.values()}
    if len(lengths) != 1:
        raise VG28Error("White Reality Check paths are not aligned")
    length = next(iter(lengths))
    if length < BOOTSTRAP_BLOCK_DAYS * 2:
        raise VG28Error("White Reality Check paths are too short")
    means = {trial_id: mean_decimal(tuple(path)) for trial_id, path in trial_returns.items()}
    observed = max(means.values())
    centered = {
        trial_id: tuple(value - means[trial_id] for value in path)
        for trial_id, path in trial_returns.items()
    }
    randomizer = random.Random(seed)
    exceedances = 0
    for _ in range(BOOTSTRAP_REPLICATES):
        indices = circular_indices(length, BOOTSTRAP_BLOCK_DAYS, randomizer)
        bootstrap_max = max(
            mean_decimal(tuple(path[index] for index in indices)) for path in centered.values()
        )
        if bootstrap_max >= observed:
            exceedances += 1
    return {
        "method": "WHITE_REALITY_CHECK_CENTERED_SYNCHRONOUS_CIRCULAR_7D",
        "observedBestMeanDailyReturn": decimal_text(observed),
        "pValue": decimal_text(Decimal(exceedances + 1) / Decimal(BOOTSTRAP_REPLICATES + 1)),
        "replicates": BOOTSTRAP_REPLICATES,
        "seed": seed,
        "trialCount": 12,
    }


def cscv_pbo(
    trial_returns: Mapping[str, Sequence[Decimal]],
) -> JsonObject:
    """Estimate CSCV PBO using eight contiguous blocks and all 70 4/4 splits."""

    if len(trial_returns) != 12:
        raise VG28Error("CSCV PBO requires exactly twelve trials")
    lengths = {len(path) for path in trial_returns.values()}
    if len(lengths) != 1:
        raise VG28Error("CSCV paths are not aligned")
    length = next(iter(lengths))
    distinct = len(
        {canonical_sha([decimal_text(value) for value in path]) for path in trial_returns.values()}
    )
    if distinct < 2:
        return {
            "blockCount": 8,
            "distinctTrialPathCount": distinct,
            "pbo": None,
            "splitCount": 0,
            "status": "NOT_ESTIMABLE_DISTINCT_PATHS_BELOW_2",
        }
    base, remainder = divmod(length, 8)
    blocks: list[tuple[int, ...]] = []
    cursor = 0
    for block_index in range(8):
        width = base + (1 if block_index < remainder else 0)
        if width == 0:
            raise VG28Error("CSCV path is too short for eight blocks")
        blocks.append(tuple(range(cursor, cursor + width)))
        cursor += width
    logits: list[float] = []
    all_blocks = frozenset(range(8))
    for training_tuple in itertools.combinations(range(8), 4):
        training = frozenset(training_tuple)
        testing = all_blocks - training
        train_indices = tuple(index for block in sorted(training) for index in blocks[block])
        test_indices = tuple(index for block in sorted(testing) for index in blocks[block])
        train_scores = {
            trial_id: mean_decimal(tuple(path[index] for index in train_indices))
            for trial_id, path in trial_returns.items()
        }
        winner = sorted(train_scores, key=lambda trial_id: (-train_scores[trial_id], trial_id))[0]
        test_scores = {
            trial_id: mean_decimal(tuple(path[index] for index in test_indices))
            for trial_id, path in trial_returns.items()
        }
        winner_score = test_scores[winner]
        lower = sum(value < winner_score for value in test_scores.values())
        ties = sum(value == winner_score for value in test_scores.values())
        percentile = (float(lower) + 0.5 * float(ties)) / len(test_scores)
        logits.append(math.log(percentile / (1.0 - percentile)))
    nonpositive = sum(value <= 0 for value in logits)
    return {
        "blockCount": 8,
        "distinctTrialPathCount": distinct,
        "method": "CSCV_8_CONTIGUOUS_BLOCKS_CHOOSE_4",
        "pbo": decimal_text(Decimal(nonpositive) / Decimal(len(logits))),
        "splitCount": len(logits),
        "status": "MEASURED",
    }


def p05_capacity(path: ScenarioPath) -> Decimal | None:
    """Return frozen lower empirical p05 episode proxy, or honest null."""

    if not path.capacity_episode_proxies_usd:
        return None
    ordered = sorted(path.capacity_episode_proxies_usd)
    index = math.floor(0.05 * (len(ordered) - 1))
    return ordered[index]


def active_dates(path: ScenarioPath) -> frozenset[date]:
    """Return UTC dates with at least one hour of long exposure."""

    return frozenset(
        us_to_datetime(timestamp).date()
        for cohort in path.cohorts
        for timestamp in range(cohort.entry_us, cohort.exit_us, HOUR_US)
    )


def active_months(path: ScenarioPath) -> frozenset[str]:
    """Return calendar months with at least one hour of long exposure."""

    return frozenset(day.strftime("%Y-%m") for day in active_dates(path))


def calendar_month_returns(path: ScenarioPath, months: Sequence[str]) -> tuple[Decimal, ...]:
    """Compound aligned returns in exact predeclared calendar months."""

    output: list[Decimal] = []
    for month in months:
        values = tuple(
            value
            for day, value in zip(path.daily_dates, path.daily_returns, strict=True)
            if day.strftime("%Y-%m") == month
        )
        if not values:
            raise VG28Error(f"month has no aligned return observations: {month}")
        output.append(compound_return(values))
    return tuple(output)


def bootstrap_mapping(summary: BootstrapSummary) -> JsonObject:
    """Serialize one bootstrap summary."""

    return {
        "lowerOneSided95TotalReturn": decimal_text(summary.lower_one_sided_95_total_return),
        "lowerOneSided95UsdPer1000": decimal_text(
            STARTING_NOTIONAL_USD * summary.lower_one_sided_95_total_return
        ),
        "lower95TotalReturn": decimal_text(summary.lower_95_total_return),
        "lower95UsdPer1000": decimal_text(STARTING_NOTIONAL_USD * summary.lower_95_total_return),
        "meanDailyReturn": decimal_text(summary.mean_daily_return),
        "oneSidedPValue": decimal_text(summary.one_sided_p_value),
        "totalReturn": decimal_text(summary.total_return),
        "totalUsdPer1000": decimal_text(STARTING_NOTIONAL_USD * summary.total_return),
        "upper95TotalReturn": decimal_text(summary.upper_95_total_return),
        "upper95UsdPer1000": decimal_text(STARTING_NOTIONAL_USD * summary.upper_95_total_return),
    }


def path_metrics(path: ScenarioPath) -> JsonObject:
    """Serialize one measured sleeve scenario."""

    total = compound_return(path.daily_returns)
    capacity = p05_capacity(path)
    return {
        "activeDayCount": len(active_dates(path)),
        "activeMonthCount": len(active_months(path)),
        "capacityEpisodeCount": len(path.capacity_episode_proxies_usd),
        "capacityP05Usd": None if capacity is None else decimal_text(capacity),
        "dailyObservationCount": len(path.daily_returns),
        "endingEquityUsdPer1000": decimal_text(STARTING_NOTIONAL_USD * (Decimal(1) + total)),
        "episodeCount": len(path.cohorts),
        "maxDrawdown": decimal_text(max_drawdown(path.hourly_returns)),
        "meanDailyReturn": decimal_text(mean_decimal(path.daily_returns)),
        "netTotalReturn": decimal_text(total),
        "netUsdPer1000": decimal_text(STARTING_NOTIONAL_USD * total),
        "symbolFills": path.symbol_fills,
        "symbolRoundTrips": path.symbol_round_trips,
    }


def evaluation_mapping(evaluation: DevelopmentEvaluation) -> JsonObject:
    """Serialize one development trial without exposing raw hourly paths."""

    stress_acceleration = evaluation.paths.stress.acceleration
    stress_deceleration = evaluation.paths.stress.deceleration
    month_returns = calendar_month_returns(stress_acceleration, DEVELOPMENT_MONTHS)
    return {
        "base": {
            "acceleration": path_metrics(evaluation.paths.base.acceleration),
            "decelerationLongComparator": path_metrics(evaluation.paths.base.deceleration),
        },
        "gates": dict(evaluation.gates or {}),
        "gross": {
            "acceleration": path_metrics(evaluation.paths.gross.acceleration),
            "decelerationLongComparator": path_metrics(evaluation.paths.gross.deceleration),
        },
        "holmAdjustedPValue": decimal_text(evaluation.holm_adjusted_p),
        "inference": {
            "accelerationBase": bootstrap_mapping(evaluation.absolute_bootstrap),
            "accelerationMinusDecelerationBase": bootstrap_mapping(evaluation.comparator_bootstrap),
        },
        "positiveStressMonthCount": sum(value > 0 for value in month_returns),
        "severe": {
            "acceleration": path_metrics(evaluation.paths.severe.acceleration),
            "decelerationLongComparator": path_metrics(evaluation.paths.severe.deceleration),
        },
        "stress": {
            "acceleration": path_metrics(stress_acceleration),
            "decelerationLongComparator": path_metrics(stress_deceleration),
        },
        "stressMonthReturns": [decimal_text(value) for value in month_returns],
        "trial": trial_mapping(evaluation.paths.trial),
    }


def diagnostic_champion(
    evaluations: Sequence[DevelopmentEvaluation],
) -> DevelopmentEvaluation:
    """Choose highest stress net with the frozen ascending-ID tie break."""

    if not evaluations:
        raise VG28Error("diagnostic champion requires trial evaluations")
    return sorted(
        evaluations,
        key=lambda evaluation: (
            -compound_return(evaluation.paths.stress.acceleration.daily_returns),
            evaluation.paths.trial.trial_id,
        ),
    )[0]


def choose_champion(
    evaluations: Sequence[DevelopmentEvaluation],
) -> DevelopmentEvaluation | None:
    """Return the diagnostic champion only when that same trial passes."""

    if not evaluations:
        return None
    diagnostic = diagnostic_champion(evaluations)
    return diagnostic if diagnostic.gates and all(diagnostic.gates.values()) else None


def development_analysis(
    bars: Mapping[str, Mapping[int, Bar]],
) -> tuple[
    tuple[DevelopmentEvaluation, ...],
    DevelopmentEvaluation | None,
    JsonObject,
    JsonObject,
]:
    """Evaluate all twelve development trials and apply strict global gates."""

    liquidity = build_liquidity_map(bars, DEVELOPMENT_START_US, DEVELOPMENT_END_US)
    scores_by_window = {window: compute_z_scores(bars, window) for window in (1, 2, 4)}
    evaluations: list[DevelopmentEvaluation] = []
    raw_p: dict[str, Decimal] = {}
    for trial in trial_grid():
        paths = simulate_trial(
            bars,
            scores_by_window[trial.window_hours],
            liquidity,
            trial,
            DEVELOPMENT_START_US,
            DEVELOPMENT_END_US,
        )
        acceleration = paths.base.acceleration.daily_returns
        comparator = paths.base.deceleration.daily_returns
        absolute = circular_block_bootstrap(acceleration, seed=BOOTSTRAP_SEED)
        relative = paired_terminal_difference_bootstrap(
            acceleration,
            comparator,
            seed=BOOTSTRAP_SEED,
        )
        evaluation = DevelopmentEvaluation(
            paths=paths,
            absolute_bootstrap=absolute,
            comparator_bootstrap=relative,
        )
        evaluations.append(evaluation)
        raw_p[trial.trial_id] = absolute.one_sided_p_value
    adjusted = holm_adjusted(raw_p)
    base_paths = {
        evaluation.paths.trial.trial_id: evaluation.paths.base.acceleration.daily_returns
        for evaluation in evaluations
    }
    white = white_reality_check(base_paths)
    pbo = cscv_pbo(base_paths)
    white_p = Decimal(cast(str, white["pValue"]))
    pbo_value = None if pbo["pbo"] is None else Decimal(cast(str, pbo["pbo"]))
    for evaluation in evaluations:
        base_path = evaluation.paths.base.acceleration
        stress_path = evaluation.paths.stress.acceleration
        capacity = p05_capacity(base_path)
        evaluation.holm_adjusted_p = adjusted[evaluation.paths.trial.trial_id]
        evaluation.gates = {
            "accelerationMinusDecelerationBaseLower95Positive": (
                evaluation.comparator_bootstrap.lower_one_sided_95_total_return > 0
            ),
            "activeDaysAtLeast30": (len(active_dates(base_path)) >= MIN_DEVELOPMENT_ACTIVE_DAYS),
            "activeMonthsAtLeast6": (
                len(active_months(base_path)) >= MIN_DEVELOPMENT_ACTIVE_MONTHS
            ),
            "baseBootstrapLower95Positive": (
                evaluation.absolute_bootstrap.lower_one_sided_95_total_return > 0
            ),
            "baseMaxDrawdownAtMost15Pct": (
                max_drawdown(base_path.hourly_returns) <= BASE_MAX_DRAWDOWN
            ),
            "baseNetPositive": (compound_return(base_path.daily_returns) > 0),
            "capacityP05AtLeast1000Usd": (capacity is not None and capacity >= CAPACITY_GATE_USD),
            "cscvPboAtMost020": (pbo_value is not None and pbo_value <= PBO_MAXIMUM),
            "episodeCountAtLeast40": (len(base_path.cohorts) >= MIN_DEVELOPMENT_EPISODES),
            "holmAdjustedPBelow005": (evaluation.holm_adjusted_p < ONE_SIDED_ALPHA),
            "stressMaxDrawdownAtMost20Pct": (
                max_drawdown(stress_path.hourly_returns) <= STRESS_MAX_DRAWDOWN
            ),
            "stressNetPositive": (compound_return(stress_path.daily_returns) > 0),
            "whiteRealityCheckPAtMost010": (white_p <= WHITE_P_MAXIMUM),
            "decelerationComparatorIsLongOnly": (
                evaluation.paths.base.deceleration.direction == "deceleration"
            ),
        }
    frozen = tuple(evaluations)
    return frozen, choose_champion(frozen), white, pbo


def consume_run_marker(freeze_receipt: Mapping[str, object]) -> str:
    """Exclusively consume the single experiment run before member opening."""

    if RUN_MARKER_PATH.exists() or RESULT_PATH.exists():
        raise VG28Error("the sole experiment run was already consumed")
    if git_output("status", "--porcelain"):
        raise VG28Error("run requires a committed freeze and clean worktree")
    marker = {
        "archiveMemberOpenRunOrdinal": 1,
        "consumedAtUtc": utc_now(),
        "evaluatorSha256": freeze_receipt.get("evaluatorSha256"),
        "freezeSha256": sha256_path(FREEZE_PATH),
        "gitHead": git_output("rev-parse", "HEAD"),
        "holdoutReuseMaximum": 1,
        "schema": "VG28ExclusiveRunMarkerV1",
        "sourceManifestSha256": sha256_path(SOURCE_MANIFEST_PATH),
        "state": "SOLE_ARCHIVE_MEMBER_OPEN_RUN_CONSUMED",
    }
    write_json_once(RUN_MARKER_PATH, marker)
    return sha256_path(RUN_MARKER_PATH)


def seal_candidate(
    champion: DevelopmentEvaluation,
    evaluations: Sequence[DevelopmentEvaluation],
    white: Mapping[str, object],
    pbo: Mapping[str, object],
) -> JsonObject:
    """Immutably seal the all-gate development champion before holdout."""

    if CANDIDATE_SEAL_PATH.exists() or HOLDOUT_OPEN_PATH.exists():
        raise VG28Error("candidate/holdout evidence already exists")
    if not champion.gates or not all(champion.gates.values()):
        raise VG28Error("candidate cannot be sealed before every gate passes")
    rows = [evaluation_mapping(evaluation) for evaluation in evaluations]
    receipt: JsonObject = {
        "candidate": trial_mapping(champion.paths.trial),
        "createdAtUtc": utc_now(),
        "developmentRowsSha256": canonical_sha(rows),
        "freezeSha256": sha256_path(FREEZE_PATH),
        "gates": dict(champion.gates),
        "pbo": dict(pbo),
        "schema": "VG28CandidateSealV1",
        "selectionRule": "HIGHEST_STRESS_NET_THEN_TRIAL_ID_ASCENDING_NO_RUNNER_UP",
        "state": "ALL_GATES_PASSED_CHAMPION_SEALED_BEFORE_HOLDOUT",
        "whiteRealityCheck": dict(white),
    }
    write_json_once(CANDIDATE_SEAL_PATH, receipt)
    return receipt


def open_holdout_once(candidate: Mapping[str, object]) -> JsonObject:
    """Create the one-use holdout receipt before any holdout member opens."""

    if not CANDIDATE_SEAL_PATH.is_file():
        raise VG28Error("holdout requires an immutable candidate seal")
    if HOLDOUT_OPEN_PATH.exists():
        raise VG28Error("holdout was already opened")
    receipt: JsonObject = {
        "candidateSealSha256": sha256_path(CANDIDATE_SEAL_PATH),
        "firstEligibleSignalUtc": "2026-03-01T00:00:00Z",
        "openedAtUtc": utc_now(),
        "reuseCount": 1,
        "schema": "VG28HoldoutOpenReceiptV1",
        "sealedTrialId": cast(Mapping[str, object], candidate["candidate"])["trialId"],
        "sourceMonths": list(HOLDOUT_MONTHS),
        "state": "HOLDOUT_OPENED_ONCE_AFTER_ALL_DEVELOPMENT_GATES",
    }
    write_json_once(HOLDOUT_OPEN_PATH, receipt)
    return receipt


def holdout_analysis(paths: TrialPaths) -> tuple[JsonObject, dict[str, bool]]:
    """Measure the sealed holdout champion and frozen terminal gates."""

    acceleration = paths.base.acceleration
    comparator = paths.base.deceleration
    absolute = circular_block_bootstrap(acceleration.daily_returns, seed=BOOTSTRAP_SEED)
    relative = paired_terminal_difference_bootstrap(
        acceleration.daily_returns,
        comparator.daily_returns,
        seed=BOOTSTRAP_SEED,
    )
    stress_acceleration = paths.stress.acceleration
    capacity = p05_capacity(acceleration)
    gates = {
        "accelerationMinusDecelerationBaseLower95Positive": (
            relative.lower_one_sided_95_total_return > 0
        ),
        "activeDaysAtLeast20": (len(active_dates(acceleration)) >= MIN_HOLDOUT_ACTIVE_DAYS),
        "activeMonthsAtLeast3": (len(active_months(acceleration)) >= MIN_HOLDOUT_ACTIVE_MONTHS),
        "baseBootstrapLower95Positive": (absolute.lower_one_sided_95_total_return > 0),
        "baseMaxDrawdownAtMost15Pct": (
            max_drawdown(acceleration.hourly_returns) <= BASE_MAX_DRAWDOWN
        ),
        "baseNetPositive": (compound_return(paths.base.acceleration.daily_returns) > 0),
        "capacityP05AtLeast1000Usd": (capacity is not None and capacity >= CAPACITY_GATE_USD),
        "episodeCountAtLeast20": (len(acceleration.cohorts) >= MIN_HOLDOUT_EPISODES),
        "stressMaxDrawdownAtMost20Pct": (
            max_drawdown(stress_acceleration.hourly_returns) <= STRESS_MAX_DRAWDOWN
        ),
        "stressNetPositive": (compound_return(stress_acceleration.daily_returns) > 0),
    }
    return {
        "base": {
            "acceleration": path_metrics(paths.base.acceleration),
            "decelerationLongComparator": path_metrics(paths.base.deceleration),
        },
        "gates": gates,
        "gross": {
            "acceleration": path_metrics(paths.gross.acceleration),
            "decelerationLongComparator": path_metrics(paths.gross.deceleration),
        },
        "inference": {
            "accelerationBase": bootstrap_mapping(absolute),
            "accelerationMinusDecelerationBase": bootstrap_mapping(relative),
            "blockDays": BOOTSTRAP_BLOCK_DAYS,
            "replicates": BOOTSTRAP_REPLICATES,
        },
        "severe": {
            "acceleration": path_metrics(paths.severe.acceleration),
            "decelerationLongComparator": path_metrics(paths.severe.deceleration),
        },
        "stress": {
            "acceleration": path_metrics(paths.stress.acceleration),
            "decelerationLongComparator": path_metrics(paths.stress.deceleration),
        },
        "trial": trial_mapping(paths.trial),
    }, gates


def base_result(
    marker_sha: str,
    manifest: Mapping[str, object],
) -> JsonObject:
    """Return common truthful provenance and executable-limit fields."""

    return {
        "accountEffectiveFeeRate": {
            "scope": "UNKNOWN",
            "value": None,
            "why": "PUBLIC_ONLY_PROTOCOL_FORBIDS_PRIVATE_ACCOUNT_FEE_READS",
        },
        "baseCommit": BASE_COMMIT,
        "capitalAuthority": "NONE",
        "capacityTruth": {
            "executableCapacityUsd": None,
            "publicProxy": ("EPISODE_P05_OF_N_X_MIN_MEMBER_1BP_PRIOR_COMPLETED_24H_QUOTE_VOLUME"),
            "scope": "UNMEASURED_EXECUTABLE_CAPACITY",
            "why": "PUBLIC_KLINES_DO_NOT_MEASURE_BOOK_DEPTH_QUEUE_FILL_PROBABILITY_OR_IMPACT",
        },
        "costScenarios": {
            name: {
                "adversePerFill": decimal_text(adverse, 4),
                "feePerFill": decimal_text(fee, 4),
                "nominalSumPerFill": decimal_text(fee + adverse, 4),
            }
            for name, (fee, adverse) in COST_SCENARIOS.items()
        },
        "createdAtUtc": utc_now(),
        "freezeSha256": sha256_path(FREEZE_PATH),
        "noSideEffects": {
            "hostMutation": False,
            "moneyMovement": False,
            "orderPlacement": False,
            "privateApiRead": False,
            "providerMutation": False,
            "signedRequest": False,
            "uiMutation": False,
        },
        "protocolSha256": sha256_path(PROTOCOL_PATH),
        "runMarkerSha256": marker_sha,
        "schema": "VG28TerminalProfitabilityVerdictV1",
        "sourceManifestSha256": sha256_path(SOURCE_MANIFEST_PATH),
        "sourceScope": manifest.get("sourceScope"),
        "strategyTruth": {
            "acceleration": "LONG_ONLY_STRATEGY",
            "allocation": "ALL_QUALIFIERS_EQUAL_WEIGHT_OR_100_PERCENT_CASH",
            "deceleration": "MATCHED_LONG_ONLY_COMPARATOR_NEVER_SHORT",
            "universe": list(SYMBOLS),
        },
    }


def terminal_unmeasured_result(
    marker_sha: str,
    manifest: Mapping[str, object],
    reason: str,
) -> JsonObject:
    """Return terminal honest nulls after any post-marker protocol failure."""

    result = base_result(marker_sha, manifest)
    result.update(
        {
            "development": None,
            "holdout": {
                "archiveBodiesOpened": (None if HOLDOUT_OPEN_PATH.exists() else False),
                "archiveBodiesOpenedTruth": (
                    "UNKNOWN_AFTER_OPEN_MARKER" if HOLDOUT_OPEN_PATH.exists() else "NO"
                ),
                "metrics": None,
                "reuseCount": 1 if HOLDOUT_OPEN_PATH.exists() else 0,
                "state": (
                    "OPEN_ATTEMPT_CONSUMED_INCOMPLETE"
                    if HOLDOUT_OPEN_PATH.exists()
                    else "UNOPENED_UNTOUCHED"
                ),
            },
            "netEdge": {
                "intervalUsdPer1000": {"lower95": None, "upper95": None},
                "netUsdPer1000": None,
                "publicCapacityP05Usd": None,
                "scope": "UNMEASURED",
                "trialId": None,
            },
            "verdict": {
                "consumer": "N3_SUCCESSOR_FINAL_CONVERGENCE",
                "goScope": "NONE",
                "reasons": [reason],
                "status": "UNMEASURED",
            },
        }
    )
    return result


def development_no_go_result(
    marker_sha: str,
    manifest: Mapping[str, object],
    evaluations: Sequence[DevelopmentEvaluation],
    white: Mapping[str, object],
    pbo: Mapping[str, object],
) -> JsonObject:
    """Return measured development NO_GO while leaving holdout untouched."""

    reporting = diagnostic_champion(evaluations)
    failed_gates = sorted(name for name, passed in (reporting.gates or {}).items() if not passed)
    result = base_result(marker_sha, manifest)
    result.update(
        {
            "development": {
                "candidateCount": len(evaluations),
                "candidateRows": [evaluation_mapping(evaluation) for evaluation in evaluations],
                "pbo": dict(pbo),
                "diagnosticChampionTrialId": reporting.paths.trial.trial_id,
                "state": "COMPLETE_DIAGNOSTIC_CHAMPION_FAILED_GATES",
                "whiteRealityCheck": dict(white),
            },
            "holdout": {
                "archiveBodiesOpened": False,
                "metrics": None,
                "reuseCount": 0,
                "state": "UNOPENED_UNTOUCHED",
            },
            "netEdge": {
                "intervalUsdPer1000": {
                    "lower95": decimal_text(
                        STARTING_NOTIONAL_USD * reporting.absolute_bootstrap.lower_95_total_return
                    ),
                    "upper95": decimal_text(
                        STARTING_NOTIONAL_USD * reporting.absolute_bootstrap.upper_95_total_return
                    ),
                },
                "netUsdPer1000": decimal_text(
                    STARTING_NOTIONAL_USD
                    * compound_return(reporting.paths.base.acceleration.daily_returns)
                ),
                "publicCapacityP05Usd": (
                    None
                    if p05_capacity(reporting.paths.base.acceleration) is None
                    else decimal_text(
                        cast(
                            Decimal,
                            p05_capacity(reporting.paths.base.acceleration),
                        )
                    )
                ),
                "scope": "DEVELOPMENT_PUBLIC_BASE_REPORTING_ONLY",
                "trialId": reporting.paths.trial.trial_id,
            },
            "verdict": {
                "consumer": "N3_SUCCESSOR_FINAL_CONVERGENCE",
                "goScope": "NONE",
                "reasons": [
                    "DIAGNOSTIC_CHAMPION_FAILED_PREDECLARED_DEVELOPMENT_GATES:"
                    + ",".join(failed_gates)
                ],
                "status": "NO_GO",
            },
        }
    )
    return result


def measured_holdout_result(
    marker_sha: str,
    manifest: Mapping[str, object],
    evaluations: Sequence[DevelopmentEvaluation],
    champion: DevelopmentEvaluation,
    white: Mapping[str, object],
    pbo: Mapping[str, object],
    metrics: Mapping[str, object],
    gates: Mapping[str, bool],
) -> JsonObject:
    """Return the one-use holdout GO/NO_GO packet."""

    status = "GO" if all(gates.values()) else "NO_GO"
    inference = cast(Mapping[str, object], metrics["inference"])
    acceleration_inference = cast(Mapping[str, object], inference["accelerationBase"])
    base = cast(Mapping[str, object], metrics["base"])
    acceleration = cast(Mapping[str, object], base["acceleration"])
    result = base_result(marker_sha, manifest)
    result.update(
        {
            "development": {
                "candidateCount": len(evaluations),
                "candidateRows": [evaluation_mapping(evaluation) for evaluation in evaluations],
                "championTrialId": champion.paths.trial.trial_id,
                "pbo": dict(pbo),
                "state": "COMPLETE_ALL_GATE_CHAMPION_SEALED",
                "whiteRealityCheck": dict(white),
            },
            "holdout": {
                "archiveBodiesOpened": True,
                "metrics": dict(metrics),
                "reuseCount": 1,
                "state": "OPENED_ONCE_COMPLETE",
            },
            "netEdge": {
                "intervalUsdPer1000": {
                    "lower95": acceleration_inference["lower95UsdPer1000"],
                    "upper95": acceleration_inference["upper95UsdPer1000"],
                },
                "netUsdPer1000": acceleration["netUsdPer1000"],
                "publicCapacityP05Usd": acceleration["capacityP05Usd"],
                "scope": "SEALED_HOLDOUT_PUBLIC_BASE_PROXY",
                "trialId": champion.paths.trial.trial_id,
            },
            "verdict": {
                "consumer": "N3_SUCCESSOR_FINAL_CONVERGENCE",
                "goScope": (
                    "PUBLIC_RESEARCH_ONLY_NO_CAPITAL_AUTHORITY" if status == "GO" else "NONE"
                ),
                "reasons": (
                    ["ALL_PREDECLARED_HOLDOUT_GATES_PASSED"]
                    if status == "GO"
                    else ["ONE_OR_MORE_PREDECLARED_HOLDOUT_GATES_FAILED"]
                ),
                "status": status,
            },
        }
    )
    return result


def run_experiment() -> None:
    """Consume the one-run lifecycle and exclusively write one terminal result."""

    freeze_receipt, manifest = validate_freeze()
    marker_sha: str | None = None
    try:
        marker_sha = consume_run_marker(freeze_receipt)
        development_bars = load_bars(manifest, DEVELOPMENT_SOURCE_MONTHS)
        evaluations, champion, white, pbo = development_analysis(development_bars)
        if champion is None:
            result = development_no_go_result(marker_sha, manifest, evaluations, white, pbo)
        else:
            candidate = seal_candidate(champion, evaluations, white, pbo)
            open_holdout_once(candidate)
            all_bars = load_bars(manifest, HOLDOUT_SOURCE_MONTHS, development_bars)
            liquidity = build_liquidity_map(all_bars, HOLDOUT_START_US, HOLDOUT_END_US)
            scores = compute_z_scores(all_bars, champion.paths.trial.window_hours)
            holdout_paths = simulate_trial(
                all_bars,
                scores,
                liquidity,
                champion.paths.trial,
                HOLDOUT_START_US,
                HOLDOUT_END_US,
            )
            metrics, gates = holdout_analysis(holdout_paths)
            result = measured_holdout_result(
                marker_sha,
                manifest,
                evaluations,
                champion,
                white,
                pbo,
                metrics,
                gates,
            )
    except BaseException as error:
        if marker_sha is None:
            if not RUN_MARKER_PATH.is_file():
                raise
            marker_sha = sha256_path(RUN_MARKER_PATH)
        reason = (
            str(error)
            if isinstance(error, VG28Error)
            else (
                f"CATCHABLE_INTERRUPTION_{type(error).__name__.upper()}"
                if isinstance(error, (KeyboardInterrupt, SystemExit))
                else f"EVALUATION_ERROR_{type(error).__name__.upper()}:{error}"
            )
        )
        result = terminal_unmeasured_result(marker_sha, manifest, reason)
    if marker_sha is None:
        raise VG28Error("run marker was not consumed")
    write_json_once(RESULT_PATH, result)
    verdict = cast(Mapping[str, object], result["verdict"])
    holdout = cast(Mapping[str, object], result["holdout"])
    edge = cast(Mapping[str, object], result["netEdge"])
    print(f"{verdict['status']} netUsdPer1000={edge['netUsdPer1000']} holdout={holdout['state']}")


def object_value(value: object, field: str) -> Mapping[str, object]:
    """Require one nested result object."""

    if not isinstance(value, dict):
        raise VG28Error(f"terminal result field is not an object: {field}")
    return cast(Mapping[str, object], value)


def display_value(value: object) -> str:
    """Render one already-canonical scalar for the one-line handoff."""

    if value is None:
        return "UNMEASURED"
    if isinstance(value, bool):
        return "true" if value else "false"
    if not isinstance(value, (str, int)):
        raise VG28Error("handoff scalar has unsupported type")
    rendered = str(value)
    if any(character in rendered for character in ("`", "\n", "\r", "|")):
        raise VG28Error("handoff scalar contains unsafe markdown")
    return rendered


def result_reporting_row(
    result: Mapping[str, object],
) -> Mapping[str, object] | None:
    """Find the immutable trial row named by the top-level reported edge."""

    development = result.get("development")
    if not isinstance(development, dict):
        return None
    rows = development.get("candidateRows")
    edge = object_value(result.get("netEdge"), "netEdge")
    trial_id = edge.get("trialId")
    if not isinstance(rows, list) or not isinstance(trial_id, str):
        return None
    for value in rows:
        if not isinstance(value, dict):
            raise VG28Error("development candidate row is not an object")
        trial = object_value(value.get("trial"), "candidateRow.trial")
        if trial.get("trialId") == trial_id:
            return cast(Mapping[str, object], value)
    raise VG28Error("reported trial is absent from development rows")


def render_handoff(result: Mapping[str, object]) -> str:
    """Derive exactly one ready-to-append FABLE5 section-5 row."""

    if result.get("schema") != "VG28TerminalProfitabilityVerdictV1":
        raise VG28Error("cannot render handoff from another result schema")
    verdict = object_value(result.get("verdict"), "verdict")
    holdout = object_value(result.get("holdout"), "holdout")
    edge = object_value(result.get("netEdge"), "netEdge")
    status = display_value(verdict.get("status"))
    trial_id = display_value(edge.get("trialId"))
    net = display_value(edge.get("netUsdPer1000"))
    interval = object_value(edge.get("intervalUsdPer1000"), "netEdge.intervalUsdPer1000")
    lower = display_value(interval.get("lower95"))
    upper = display_value(interval.get("upper95"))
    capacity = display_value(edge.get("publicCapacityP05Usd"))
    holdout_state = display_value(holdout.get("state"))

    row = result_reporting_row(result)
    measured_detail: str
    if row is None:
        measured_detail = (
            f"trial/net/95% interval/public capacity={trial_id}/{net}/"
            f"[{lower},{upper}]/{capacity}; multiplicity/PBO/drawdown "
            "UNMEASURED"
        )
    else:
        holdout_metrics = holdout.get("metrics")
        terminal_metrics = (
            object_value(holdout_metrics, "holdout.metrics")
            if isinstance(holdout_metrics, dict)
            else row
        )
        gross = object_value(terminal_metrics.get("gross"), "metrics.gross")
        base = object_value(terminal_metrics.get("base"), "metrics.base")
        stress = object_value(terminal_metrics.get("stress"), "metrics.stress")
        severe = object_value(terminal_metrics.get("severe"), "metrics.severe")
        gross_acceleration = object_value(gross.get("acceleration"), "row.gross.acceleration")
        base_acceleration = object_value(base.get("acceleration"), "row.base.acceleration")
        stress_acceleration = object_value(stress.get("acceleration"), "row.stress.acceleration")
        severe_acceleration = object_value(severe.get("acceleration"), "row.severe.acceleration")
        development = object_value(result.get("development"), "development")
        pbo = object_value(development.get("pbo"), "development.pbo")
        white = object_value(
            development.get("whiteRealityCheck"),
            "development.whiteRealityCheck",
        )
        gates = object_value(terminal_metrics.get("gates"), "metrics.gates")
        failed_gate_count = sum(value is not True for value in gates.values())
        measured_detail = (
            f"diagnostic champion {trial_id}; gross/base/stress/severe net "
            f"USD/$1k={display_value(gross_acceleration.get('netUsdPer1000'))}/"
            f"{display_value(base_acceleration.get('netUsdPer1000'))}/"
            f"{display_value(stress_acceleration.get('netUsdPer1000'))}/"
            f"{display_value(severe_acceleration.get('netUsdPer1000'))}; "
            f"base 95% interval=[{lower},{upper}]; episodes/active days/"
            f"active months={display_value(base_acceleration.get('episodeCount'))}/"
            f"{display_value(base_acceleration.get('activeDayCount'))}/"
            f"{display_value(base_acceleration.get('activeMonthCount'))}; "
            f"Holm/White/PBO={display_value(row.get('holmAdjustedPValue'))}/"
            f"{display_value(white.get('pValue'))}/"
            f"{display_value(pbo.get('pbo'))}; base/stress drawdown="
            f"{display_value(base_acceleration.get('maxDrawdown'))}/"
            f"{display_value(stress_acceleration.get('maxDrawdown'))}; "
            f"public capacity p05=${capacity}; failed gates={failed_gate_count}"
        )

    if status == "GO":
        verdict_status = "PUBLIC_RESEARCH_GO; CAPITAL_NO_GO"
    elif status == "NO_GO":
        verdict_status = "PROFITABILITY_NO_GO; CAPITAL_NO_GO"
    else:
        verdict_status = "UNMEASURED; CAPITAL_NO_GO"
    return (
        "- item=`2026-07-29 V-G28 INTRADAY QUOTE-VOLUME CURVATURE "
        "ACCELERATION/DECELERATION TERMINAL` | expected=`one sealed "
        "Binance-public-only intraday quote-volume acceleration/deceleration "
        "profitability verdict; causal full-cohort-or-cash; costs, interval, "
        "multiplicity/PBO, drawdown, public capacity; consumer=N3 successor/"
        "final convergence` | found=`exact base …1be1; 180 ZIPs+180 sidecars/"
        "10 symbols/18 months re-admitted and checksum-bound; exact 12-trial "
        "own-symbol second-difference family; one-run custody consumed; "
        f"{measured_detail}; holdout={holdout_state}; account-effective fee "
        "UNKNOWN; executable capacity and historical spread/depth/queue/fill/"
        "impact/latency UNMEASURED; focused tests/static checks and "
        "authenticated packet digests PASS; UI/canonical/live/host/provider/private/"
        "order/transfer/withdrawal/money unchanged/$0` | status=`"
        f"TERMINAL_EVIDENCE_READY; {verdict_status}; AUTHORITY NONE; "
        "PRESERVED_WAITING(N3 successor/final convergence); NOT_LANDED; STOP`\n"
    )


def verify_result_bindings(result: Mapping[str, object]) -> None:
    """Authenticate terminal provenance and conditional holdout receipts."""

    if result.get("schema") != "VG28TerminalProfitabilityVerdictV1":
        raise VG28Error("terminal result schema mismatch")
    expected = {
        "baseCommit": BASE_COMMIT,
        "freezeSha256": sha256_path(FREEZE_PATH),
        "protocolSha256": sha256_path(PROTOCOL_PATH),
        "runMarkerSha256": sha256_path(RUN_MARKER_PATH),
        "sourceManifestSha256": sha256_path(SOURCE_MANIFEST_PATH),
    }
    for field, value in expected.items():
        if result.get(field) != value:
            raise VG28Error(f"terminal result binding mismatch: {field}")
    marker = load_json(RUN_MARKER_PATH)
    if (
        marker.get("schema") != "VG28ExclusiveRunMarkerV1"
        or marker.get("freezeSha256") != expected["freezeSha256"]
        or marker.get("sourceManifestSha256") != expected["sourceManifestSha256"]
    ):
        raise VG28Error("run marker binding mismatch")
    verdict = object_value(result.get("verdict"), "verdict")
    status = verdict.get("status")
    if status not in ("GO", "NO_GO", "UNMEASURED"):
        raise VG28Error("terminal verdict status is invalid")
    edge = object_value(result.get("netEdge"), "netEdge")
    interval = object_value(edge.get("intervalUsdPer1000"), "netEdge.intervalUsdPer1000")
    if status == "UNMEASURED" and any(
        value is not None
        for value in (
            edge.get("netUsdPer1000"),
            edge.get("publicCapacityP05Usd"),
            interval.get("lower95"),
            interval.get("upper95"),
        )
    ):
        raise VG28Error("UNMEASURED economics must remain null")

    candidate_exists = CANDIDATE_SEAL_PATH.is_file()
    holdout_exists = HOLDOUT_OPEN_PATH.is_file()
    if holdout_exists and not candidate_exists:
        raise VG28Error("holdout receipt exists without a candidate seal")
    candidate_trial_id: str | None = None
    if candidate_exists:
        candidate = load_json(CANDIDATE_SEAL_PATH)
        if (
            candidate.get("schema") != "VG28CandidateSealV1"
            or candidate.get("freezeSha256") != expected["freezeSha256"]
            or candidate.get("selectionRule")
            != "HIGHEST_STRESS_NET_THEN_TRIAL_ID_ASCENDING_NO_RUNNER_UP"
        ):
            raise VG28Error("candidate seal binding mismatch")
        candidate_trial = object_value(candidate.get("candidate"), "candidateSeal.candidate")
        candidate_trial_value = candidate_trial.get("trialId")
        if not isinstance(candidate_trial_value, str):
            raise VG28Error("candidate seal trial ID is invalid")
        candidate_trial_id = candidate_trial_value
        candidate_gates = object_value(candidate.get("gates"), "candidateSeal.gates")
        if not candidate_gates or any(value is not True for value in candidate_gates.values()):
            raise VG28Error("candidate seal contains a failed gate")
        development_value = result.get("development")
        if isinstance(development_value, dict):
            candidate_rows = development_value.get("candidateRows")
            if not isinstance(candidate_rows, list) or candidate.get(
                "developmentRowsSha256"
            ) != canonical_sha(candidate_rows):
                raise VG28Error("candidate seal development rows mismatch")
    if holdout_exists:
        receipt = load_json(HOLDOUT_OPEN_PATH)
        if (
            receipt.get("schema") != "VG28HoldoutOpenReceiptV1"
            or receipt.get("reuseCount") != 1
            or receipt.get("candidateSealSha256") != sha256_path(CANDIDATE_SEAL_PATH)
            or receipt.get("sealedTrialId") != candidate_trial_id
            or receipt.get("sourceMonths") != list(HOLDOUT_MONTHS)
        ):
            raise VG28Error("holdout-open receipt binding mismatch")
    holdout = object_value(result.get("holdout"), "holdout")
    holdout_state = holdout.get("state")
    if holdout_state == "OPENED_ONCE_COMPLETE":
        if (
            status not in ("GO", "NO_GO")
            or not holdout_exists
            or not candidate_exists
            or holdout.get("reuseCount") != 1
            or not isinstance(holdout.get("metrics"), dict)
        ):
            raise VG28Error("measured holdout lacks its one-use evidence")
        development = object_value(result.get("development"), "development")
        metrics = object_value(holdout.get("metrics"), "holdout.metrics")
        metric_trial = object_value(metrics.get("trial"), "holdout.metrics.trial")
        metric_gates = object_value(metrics.get("gates"), "holdout.metrics.gates")
        all_holdout_gates = bool(metric_gates) and all(
            value is True for value in metric_gates.values()
        )
        base = object_value(metrics.get("base"), "holdout.metrics.base")
        acceleration = object_value(
            base.get("acceleration"),
            "holdout.metrics.base.acceleration",
        )
        inference = object_value(metrics.get("inference"), "holdout.metrics.inference")
        acceleration_inference = object_value(
            inference.get("accelerationBase"),
            "holdout.metrics.inference.accelerationBase",
        )
        if (
            development.get("state") != "COMPLETE_ALL_GATE_CHAMPION_SEALED"
            or development.get("championTrialId") != candidate_trial_id
            or edge.get("trialId") != candidate_trial_id
            or metric_trial.get("trialId") != candidate_trial_id
            or (status == "GO") != all_holdout_gates
            or edge.get("netUsdPer1000") != acceleration.get("netUsdPer1000")
            or edge.get("publicCapacityP05Usd") != acceleration.get("capacityP05Usd")
            or interval.get("lower95") != acceleration_inference.get("lower95UsdPer1000")
            or interval.get("upper95") != acceleration_inference.get("upper95UsdPer1000")
        ):
            raise VG28Error("measured holdout result is internally inconsistent")
    elif holdout_state == "UNOPENED_UNTOUCHED":
        if (
            status == "GO"
            or holdout_exists
            or (status == "NO_GO" and candidate_exists)
            or holdout.get("reuseCount") != 0
            or holdout.get("metrics") is not None
        ):
            raise VG28Error("unopened holdout state is inconsistent")
        if status == "NO_GO":
            development = object_value(result.get("development"), "development")
            if development.get(
                "state"
            ) != "COMPLETE_DIAGNOSTIC_CHAMPION_FAILED_GATES" or development.get(
                "diagnosticChampionTrialId"
            ) != edge.get("trialId"):
                raise VG28Error("development NO_GO identity mismatch")
    elif holdout_state == "OPEN_ATTEMPT_CONSUMED_INCOMPLETE":
        if (
            status != "UNMEASURED"
            or not holdout_exists
            or not candidate_exists
            or holdout.get("reuseCount") != 1
        ):
            raise VG28Error("incomplete holdout state is inconsistent")
    else:
        raise VG28Error("terminal holdout state is invalid")


def packet_files() -> tuple[Path, ...]:
    """Return the immutable packet files included in terminal authentication."""

    names = (
        "HANDOFF.md",
        "OFFICIAL_SOURCE_RESEARCH.md",
        "README.md",
        "__init__.py",
        "candidate-seal.v1.json",
        "experiment.py",
        "freeze.v1.json",
        "holdout-open.v1.json",
        "protocol.v1.json",
        "result.v1.json",
        "run-marker.v1.json",
        "source-manifest.v1.json",
        "test_experiment.py",
    )
    return tuple(HERE / name for name in names if (HERE / name).is_file())


def seal_packet() -> None:
    """Exclusively create the terminal packet hash inventory."""

    if SHA256SUMS_PATH.exists() or HANDOFF_PATH.exists():
        raise VG28Error("terminal packet is already sealed")
    if not RESULT_PATH.is_file() or not RUN_MARKER_PATH.is_file():
        raise VG28Error("terminal result and run marker are required before seal")
    result = load_json(RESULT_PATH)
    verify_result_bindings(result)
    write_bytes_once(HANDOFF_PATH, render_handoff(result).encode("utf-8"))
    lines = [f"{sha256_path(path)}  {path.name}\n" for path in packet_files()]
    write_bytes_once(SHA256SUMS_PATH, "".join(lines).encode("ascii"))


def verify_sha256s() -> None:
    """Authenticate the terminal packet inventory."""

    try:
        lines = SHA256SUMS_PATH.read_text(encoding="ascii").splitlines()
    except (OSError, UnicodeError) as error:
        raise VG28Error("terminal SHA256SUMS is unavailable") from error
    expected_names = {path.name for path in packet_files()}
    found: set[str] = set()
    for line in lines:
        match = re.fullmatch(r"([0-9a-f]{64})  ([A-Za-z0-9_.-]+)", line)
        if match is None:
            raise VG28Error("invalid SHA256SUMS grammar")
        digest, name = match.groups()
        if name in found or name == SHA256SUMS_PATH.name:
            raise VG28Error("duplicate or self-referential SHA256SUMS entry")
        path = HERE / name
        if path.parent != HERE or sha256_path(path) != digest:
            raise VG28Error(f"packet digest mismatch: {name}")
        found.add(name)
    if found != expected_names:
        raise VG28Error("SHA256SUMS inventory differs from packet files")


def report() -> None:
    """Network-free, member-closed authentication and result display."""

    verify_sha256s()
    freeze_receipt, manifest = validate_freeze()
    verify_source_bytes(manifest)
    marker = load_json(RUN_MARKER_PATH)
    result = load_json(RESULT_PATH)
    verify_result_bindings(result)
    if marker.get("freezeSha256") != sha256_path(FREEZE_PATH):
        raise VG28Error("run marker freeze binding mismatch")
    if freeze_receipt.get("sourceManifestSha256") != sha256_path(SOURCE_MANIFEST_PATH):
        raise VG28Error("freeze source binding mismatch")
    if HANDOFF_PATH.read_text(encoding="utf-8") != render_handoff(result):
        raise VG28Error("HANDOFF.md differs from the terminal result")
    print(json.dumps(result, indent=2, sort_keys=True))


def build_parser() -> argparse.ArgumentParser:
    """Build the narrow lifecycle CLI."""

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "command",
        choices=("inventory", "freeze", "run", "seal", "report"),
    )
    return parser


def main(arguments: Sequence[str] | None = None) -> int:
    """Dispatch one lifecycle action."""

    command = build_parser().parse_args(arguments).command
    actions = {
        "inventory": inventory_sources,
        "freeze": freeze,
        "run": run_experiment,
        "seal": seal_packet,
        "report": report,
    }
    try:
        actions[command]()
    except (VG28Error, FileExistsError) as error:
        print(f"V-G28 STOP: {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
