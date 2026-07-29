#!/usr/bin/env python3
"""Sealed, network-free S-1T retrospective USD-M funding-cadence research engine.

The lifecycle is irreversible and strictly ordered::

    preseal -> screen -> run          (verify is the only repeatable stage)

``preseal`` is the last stage permitted to execute the worktree engine; it binds
exact Git lineage and copies every allowlisted static file into the packet.
``screen``, ``run`` and ``verify`` execute only the immutable packet copy.

Every marker is created with ``O_CREAT|O_EXCL|O_NOFOLLOW`` before the CSV members
of its partition may be decompressed.  No network, credential, private, order,
transfer, host, or UI path exists.  The only subprocess ever spawned is a local
read-only ``git`` query used to establish static lineage during ``preseal``.

Findings are retrospective observational associations.  The decision hour is a
deterministic simulation index derived from the final confirmation settlement; it
is not a proven live-public availability time, and no causal, as-of, or lag-safe
claim is made anywhere in this engine or its outputs.
"""

from __future__ import annotations

import sys

if sys.version_info < (3, 13):  # enforced before any other module-level work
    raise SystemExit(
        "S1T_PYTHON_VERSION_UNSUPPORTED:Python 3.13 or newer is required, "
        f"found {sys.version_info.major}.{sys.version_info.minor}"
    )

import argparse
import csv
import hashlib
import io
import itertools
import json
import math
import os
import re
import shutil
import stat
import subprocess
import tempfile
import zipfile
from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from decimal import Context, Decimal, InvalidOperation, ROUND_HALF_EVEN, setcontext
from pathlib import Path, PurePosixPath
from typing import Any, Final, cast

# A pinned arithmetic context makes every reported figure reproducible on any
# host regardless of the caller's ambient decimal context.
setcontext(Context(prec=60, rounding=ROUND_HALF_EVEN))

if not hasattr(os, "O_NOFOLLOW"):  # artifact_write_law refuses without it
    raise SystemExit("S1T_O_NOFOLLOW_UNAVAILABLE:the platform cannot refuse symlink follows")

HERE: Final = Path(__file__).resolve().parent
CANONICAL_BASE: Final = "a169b123fb186d1943a75ad648552c4d95be1be1"
PROTOCOL_ID: Final = "s1t-binance-usdm-funding-interval-transition-v1"
STRATEGY_ID: Final = "S-1T"
SCHEMA_PREFIX: Final = "cosmos.quant.research.s1t"
PACKET_STATIC_ROOT: Final = PurePosixPath("static/quant/research/s1t")
REPO_STATIC_DIR: Final = PurePosixPath("quant/research/s1t")
STATIC_FILE_ALLOWLIST: Final = (
    "quant/research/s1t/DISTINCTNESS.md",
    "quant/research/s1t/OFFICIAL_SOURCE_RESEARCH.md",
    "quant/research/s1t/README.md",
    "quant/research/s1t/experiment.py",
    "quant/research/s1t/protocol.v1.json",
    "quant/research/s1t/source_plan.v1.json",
    "quant/research/s1t/trial_ledger.v1.json",
    "quant/research/s1t/verifier.py",
)

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

DATASETS: Final = ("fundingRate", "klines_1h", "markPriceKlines_1h")
PLAN_DATASET_NAMES: Final = {
    "fundingRate": "fundingRate",
    "klines_1h": "klines/1h",
    "markPriceKlines_1h": "markPriceKlines/1h",
}
DATASET_BY_PLAN_NAME: Final = {value: key for key, value in PLAN_DATASET_NAMES.items()}
PLAN_DATASET_ORDER: Final = ("fundingRate", "markPriceKlines/1h", "klines/1h")
ARCHIVE_ROOT_URL: Final = "https://data.binance.vision/data/futures/um/monthly"
ARCHIVE_PREFIX: Final = PurePosixPath("data/futures/um/monthly")
CACHE_MANIFEST_SCHEMA: Final = "S1DBinancePublicArchiveManifestV1"
CHECKSUM_SUFFIX: Final = ".CHECKSUM"

HOUR_MS: Final = 3_600_000
DAY_MS: Final = 86_400_000
SCREEN_START_MS: Final = int(datetime(2025, 6, 1, tzinfo=UTC).timestamp() * 1000)
SCREEN_END_MS: Final = int(datetime(2025, 7, 1, tzinfo=UTC).timestamp() * 1000)
DEVELOPMENT_START_MS: Final = SCREEN_END_MS
DEVELOPMENT_END_MS: Final = int(datetime(2026, 4, 1, tzinfo=UTC).timestamp() * 1000)
HOLDOUT_START_MS: Final = int(datetime(2026, 4, 8, tzinfo=UTC).timestamp() * 1000)
HOLDOUT_END_MS: Final = int(datetime(2026, 7, 1, tzinfo=UTC).timestamp() * 1000)
JUNE_SETTLEMENT_HOURS: Final = (0, 8, 16)
JUNE_FUNDING_ROWS: Final = 90
JUNE_HOURLY_ROWS: Final = 720
# The frozen universe cutoff.  N=100 is the only permitted value: no alternate N is
# computed, tested, reported, or used for sensitivity analysis anywhere in this engine.
RANK_CUTOFF_N: Final = 100
TESTED_RANK_CUTOFFS: Final = (100,)

CAPITAL: Final = Decimal("1000")
PARTICIPATION_RATE: Final = Decimal("0.00005")
CAPACITY_LOOKBACK_HOURS: Final = 168
CAPACITY_WINDOW_DAYS: Final = 7
CAPACITY_SORTED_INDEX: Final = 3  # "the fourth value after sorting" the seven sums
STABLE_INTERVAL_HOURS: Final = 8
PRE_TRANSITION_ROWS: Final = 6
ELIGIBLE_NEW_INTERVAL_HOURS: Final = (1, 4)
COOLDOWN_DAYS_PER_SYMBOL: Final = 7
COOLDOWN_MS: Final = COOLDOWN_DAYS_PER_SYMBOL * DAY_MS
GAP_TOLERANCE_MS: Final = 1000
MIN_INTERVAL_HOURS: Final = 1
MAX_INTERVAL_HOURS: Final = 24

FAMILY_SIZE: Final = 12
CONFIRMATION_ROWS: Final = (1, 2)
ENTRY_LAG_HOURS: Final = (1, 2)
HOLD_HOURS: Final = (4, 8, 12)

BOOTSTRAP_REPLICATES: Final = 4096
BOOTSTRAP_SEED: Final = 20260729
BOOTSTRAP_BLOCK_DAYS: Final = 7
ALPHA: Final = Decimal("0.05")
BONFERRONI_HYPOTHESES: Final = 24
BONFERRONI_QUANTILE: Final = Decimal(1) / Decimal(480)
PBO_BLOCKS: Final = 12
PBO_SPLITS: Final = 924
# Daily realized nets are quantized before resampling so every resample total is
# exact and independent of summation order.  1e-12 USD is twelve orders of
# magnitude below the smallest gate threshold.
DAILY_QUANTUM: Final = Decimal("0.000000000001")

DEVELOPMENT_PARTITION: Final = "development"
HOLDOUT_PARTITION: Final = "holdout"

SCENARIOS: Final = ("base", "stress", "severe")
COSTS: Final = {
    "base": (Decimal("5"), Decimal("2")),
    "stress": (Decimal("8"), Decimal("5")),
    "severe": (Decimal("10"), Decimal("10")),
}

DEVELOPMENT_GATE_THRESHOLDS: Final = {
    "active_cohorts_min": Decimal(30),
    "active_weeks_min": Decimal(12),
    "base_capacity_min_usd_gte": Decimal(1000),
    "base_net_usd_per_1000_gt": Decimal(0),
    "bonferroni_base_lower_bound_gt": Decimal(0),
    "bonferroni_stress_lower_bound_gt": Decimal(0),
    "champion_holm_p_lte": Decimal("0.05"),
    "distinct_traded_symbols_min": Decimal(12),
    "pbo_lte": Decimal("0.5"),
    "remove_best_month_stress_net_usd_per_1000_gt": Decimal(0),
    "remove_best_symbol_stress_net_usd_per_1000_gt": Decimal(0),
    "severe_hourly_marked_equity_max_drawdown_lte": Decimal("0.1"),
    "stress_net_usd_per_1000_gt": Decimal(0),
    "white_reality_check_base_p_lte": Decimal("0.05"),
    "white_reality_check_stress_p_lte": Decimal("0.05"),
}
HOLDOUT_GATE_THRESHOLDS: Final = {
    "active_cohorts_min": Decimal(10),
    "active_weeks_min": Decimal(6),
    "base_capacity_min_usd_gte": Decimal(1000),
    "base_net_usd_per_1000_gt": Decimal(0),
    "distinct_traded_symbols_min": Decimal(6),
    "pointwise_base_lower_bound_gt": Decimal(0),
    "pointwise_stress_lower_bound_gt": Decimal(0),
    "remove_best_month_stress_net_usd_per_1000_gt": Decimal(0),
    "remove_best_symbol_stress_net_usd_per_1000_gt": Decimal(0),
    "severe_hourly_marked_equity_max_drawdown_lte": Decimal("0.1"),
    "stress_net_usd_per_1000_gt": Decimal(0),
}
ALLOWED_VERDICTS: Final = (
    "PUBLIC_PROXY_PASS_CAPITAL_NO_GO",
    "NO_GO_DEVELOPMENT_HOLDOUT_UNOPENED",
    "NO_GO",
    "UNMEASURED_RUN_CONSUMED_NO_RERUN",
)

MAX_ZIP_BYTES: Final = 512 * 1024 * 1024
MAX_MEMBER_BYTES: Final = 1024 * 1024 * 1024
MAX_SIDECAR_BYTES: Final = 4096
MAX_COMPRESSION_RATIO: Final = 250
READ_CHUNK_BYTES: Final = 1024 * 1024
GIT_TIMEOUT_SECONDS: Final = 120
GIT_ALLOWED_SUBCOMMANDS: Final = frozenset({"ls-tree", "rev-parse", "status"})

SYMBOL_RE: Final = re.compile(r"^[A-Z0-9]+USDT$")
SHA256_RE: Final = re.compile(r"^[0-9a-fA-F]{64}$")
OID_RE: Final = re.compile(r"^[0-9a-f]{40}$")
GIT_MODE_RE: Final = re.compile(r"^[0-7]{6}$")
SHA256SUMS_LINE_RE: Final = re.compile(r"^([0-9a-f]{64})  (.+)$")
# screen.hourly_validation: an unsigned, non-exponent base-10 token.  Rejecting
# "1e5", "+1", "-0" and ".5" lexically is what makes the ranking sum reproducible
# in any arbitrary-precision implementation, not just this one.
UNSIGNED_DECIMAL_TOKEN_RE: Final = re.compile(r"^[0-9]+(\.[0-9]+)?$")

MANIFEST_FIELDS: Final = (
    "byte_count",
    "cache_sidecar_sha256",
    "cache_stat_identity",
    "cache_zip_sha256",
    "dataset",
    "inventory_state",
    "member_state",
    "month",
    "official_zip_sha256",
    "prior_schema_exposure",
    "relative_path",
    "source_url",
    "symbol",
)
BINDING_FIELDS: Final = ("byte_count", "raw_sha256", "relative_path")
# The single source of truth for multi-input artifacts, used both when writing an
# artifact and when authenticating it, so the two can never disagree.
MULTI_INPUT_BINDINGS: Final = {
    "freeze.v1.json": (
        "preseal.v1.json",
        "screen_consumed.v1.json",
        "screen_universe.v1.json",
        "source_manifest.v1.json",
    ),
    "opened_source_ledger.v1.json": ("event_universe.v1.json", "run_consumed.v1.json"),
    "development.v1.json": (
        "event_universe.v1.json",
        "opened_source_ledger.v1.json",
        "run_consumed.v1.json",
    ),
}
FAILURE_BINDING_FIELDS: Final = ("completed_artifact_bindings", "error_code", "stage")
ELIGIBILITY_STATES: Final = ("ELIGIBLE", "INELIGIBLE")
SELECTION_STATES: Final = ("REJECTED_BY_RANK", "SELECTED")

FUNDING_HEADER: Final = ("calc_time", "funding_interval_hours", "last_funding_rate")
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

EFFECTS: Final = {
    "credentials_used": False,
    "host_effects": False,
    "live_trading": False,
    "money_moved_usd": 0,
    "network_calls": 0,
    "orders_placed": 0,
    "private_api_used": False,
    "provider_mutation": False,
    "transfers": 0,
    "ui_effects": False,
    "withdrawals": 0,
}
LIMITATIONS: Final = (
    "Archive publication latency is UNKNOWN; the decision hour is a retrospective "
    "simulation index after the final confirmation settlement, not a proven "
    "live-public availability time. No causal, as-of, or lag-safe claim is made.",
    "Monthly archive rows are retrospective; their historical live-public availability "
    "time is not established.",
    "Mark opens and hourly settlement marks are public proxies, never fills, executable "
    "prices, or account debits.",
    "Every fee and adverse-movement figure is a frozen public scenario proxy; the "
    "account-effective fee is UNKNOWN.",
    "Quote volume is not spread, depth, impact, queue position, atomicity, filter, "
    "margin, or executable-capacity evidence.",
    "Reported USD capacity is a nominal 1 USDT = 1 USD proxy; the USDT/USD basis is "
    "unmeasured.",
    "A settlement cadence compression is an observed association only; no policy effect, "
    "effective timestamp, treatment effect, ATE, or impact is claimed.",
    "Interval changes are exchange-selected and may co-move with cap pressure and "
    "funding extremity; the endogeneity is stated, not corrected.",
    "Equality is claimed only to the frozen cached official bytes, never to a later "
    "remote archive revision.",
    "Three BTCUSDT June-2026 members are HEADER_ONLY_SCHEMA_EXPOSED from a prior schema "
    "probe that read zero data rows; their outcome rows remain sealed.",
)

MEMBER_OPEN_COUNTS: dict[str, int] = {"screen": 0, "development": 0, "holdout": 0}
MEMBER_OPEN_STAGE: str | None = None


class S1TError(RuntimeError):
    """Stable engine failure."""

    def __init__(self, code: str, detail: str = "") -> None:
        super().__init__(f"{code}:{detail}" if detail else code)
        self.code = code
        self.detail = detail


class ContractError(S1TError):
    """Frozen lifecycle, lineage, custody, or packet contract failure."""


class EvidenceError(S1TError):
    """Invalid required evidence: terminal INVALID_EVIDENCE_UNMEASURED."""


@dataclass(frozen=True, slots=True)
class Trial:
    trial_id: str
    confirmation_rows: int
    entry_lag_hours: int
    hold_hours: int


@dataclass(frozen=True, slots=True)
class Partition:
    partition_id: str
    start_ms: int
    end_ms: int
    months: tuple[str, ...]


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
    close_time_ms: int
    quote_volume: Decimal
    quote_volume_token: str


@dataclass(frozen=True, slots=True)
class ExactTotal:
    """An exact base-10 total held as an integer numerator over a power of ten.

    Python integers are unbounded, so accumulating scaled integers gives a sum with
    no binary floating point and no rounding whatsoever, independent of the decimal
    context.  ``Decimal`` is used only for ordering, where comparison is exact.
    """

    numerator: int
    scale: int

    @property
    def canonical(self) -> str:
        """No exponent, no insignificant leading or trailing zeros, one zero for zero."""

        digits = str(self.numerator)
        if self.scale == 0:
            integer, fraction = digits, ""
        else:
            padded = digits.rjust(self.scale + 1, "0")
            integer, fraction = padded[: -self.scale], padded[-self.scale :]
        integer = integer.lstrip("0") or "0"
        fraction = fraction.rstrip("0")
        return f"{integer}.{fraction}" if fraction else integer

    @property
    def exact(self) -> Decimal:
        return Decimal(self.canonical)


@dataclass(frozen=True, slots=True)
class Candidate:
    """One in-horizon transition candidate for one trial, carrying no return."""

    symbol: str
    event_ms: int
    final_confirmation_ms: int
    new_interval_hours: int
    confirmation_rows: int
    signal_rate: Decimal
    signal_normalized_rate: Decimal
    side: int
    decision_ms: int
    entry_ms: int
    exit_ms: int
    baseline_start_ms: int


@dataclass(frozen=True, slots=True)
class MemberValuation:
    symbol: str
    side: int
    quantity: Decimal
    member_notional: Decimal
    entry_price: Decimal
    exit_price: Decimal
    entry_fill_proxy: Decimal
    exit_fill_proxy: Decimal
    mark_price_pnl: Decimal
    funding_pnl: Decimal
    adverse_entry: Decimal
    adverse_exit: Decimal
    fee_entry: Decimal
    fee_exit: Decimal
    net: Decimal
    booked_funding: tuple[tuple[int, int, Decimal, Decimal, Decimal], ...]


@dataclass(frozen=True, slots=True)
class Cohort:
    decision_ms: int
    entry_ms: int
    exit_ms: int
    member_notional: Decimal
    symbols: tuple[str, ...]
    members: Mapping[str, tuple[MemberValuation, ...]]
    net: Mapping[str, Decimal]
    capacity_proxy_usd: Decimal
    member_capacity_proxy_usd: Mapping[str, Decimal]
    member_capacity_windows_usdt: Mapping[str, tuple[Decimal, ...]]


@dataclass(frozen=True, slots=True)
class TrialResult:
    trial: Trial
    candidates: tuple[Candidate, ...]
    cohorts: tuple[Cohort, ...]
    decisions: tuple[Mapping[str, Any], ...]
    candidate_hours: int
    cash_hours: int
    zero_signal_cash_hours: int
    cooldown_cash_hours: int
    overlap_cash_hours: int


@dataclass(slots=True)
class MarketData:
    funding: dict[str, tuple[FundingRow, ...]] = field(default_factory=dict)
    mark: dict[str, dict[int, Bar]] = field(default_factory=dict)
    contract: dict[str, dict[int, Bar]] = field(default_factory=dict)


@dataclass(slots=True)
class OpenedLedger:
    """Every packet member actually opened in the active stage."""

    rows: list[dict[str, Any]] = field(default_factory=list)

    def record(self, relative_path: str, digest: str, byte_count: int, stage: str) -> None:
        self.rows.append(
            {
                "member_open_ordinal": len(self.rows) + 1,
                "packet_relative_path": relative_path,
                "packet_zip_sha256": digest,
                "stage": stage,
                "zip_byte_count": byte_count,
            }
        )


def trial_family() -> tuple[Trial, ...]:
    return tuple(
        Trial(f"c{confirmation}-l{lag}-h{hold:02d}", confirmation, lag, hold)
        for confirmation in CONFIRMATION_ROWS
        for lag in ENTRY_LAG_HOURS
        for hold in HOLD_HOURS
    )


DEVELOPMENT: Final = Partition(
    DEVELOPMENT_PARTITION, DEVELOPMENT_START_MS, DEVELOPMENT_END_MS, DEVELOPMENT_MONTHS
)
HOLDOUT: Final = Partition(HOLDOUT_PARTITION, HOLDOUT_START_MS, HOLDOUT_END_MS, HOLDOUT_MONTHS)


def canonical_bytes(value: Any) -> bytes:
    """UTF-8, sorted keys, no insignificant whitespace, exactly one trailing LF."""

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


def sha256_descriptor(descriptor: int) -> tuple[str, int]:
    """Hash an open descriptor from offset zero and report the byte count."""

    os.lseek(descriptor, 0, os.SEEK_SET)
    digest = hashlib.sha256()
    total = 0
    while True:
        chunk = os.read(descriptor, READ_CHUNK_BYTES)
        if not chunk:
            break
        total += len(chunk)
        digest.update(chunk)
    return digest.hexdigest(), total


def sha256_path(path: Path) -> str:
    descriptor = open_regular_readonly(path)
    try:
        return sha256_descriptor(descriptor)[0]
    finally:
        os.close(descriptor)


def open_regular_readonly(path: Path) -> int:
    """Open a regular file read-only, refusing symlinks and special files."""

    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    except OSError as exc:
        raise ContractError("OPEN_READONLY_FAILED", str(path)) from exc
    try:
        if not stat.S_ISREG(os.fstat(descriptor).st_mode):
            raise ContractError("NOT_REGULAR_FILE", str(path))
    except Exception:
        os.close(descriptor)
        raise
    return descriptor


def open_source_readonly(path: Path) -> int:
    """Open an archive source read-only; a source problem is invalid evidence.

    Distinguishing this from ``open_regular_readonly`` is what lets a post-marker
    source failure be bound terminally, while a broken packet chain or lineage
    stays a contract failure that must not be blessed into a result.
    """

    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    except OSError as exc:
        raise EvidenceError("SOURCE_OPEN_FAILED", path.name) from exc
    try:
        if not stat.S_ISREG(os.fstat(descriptor).st_mode):
            raise EvidenceError("SOURCE_NOT_REGULAR_FILE", path.name)
    except Exception:
        os.close(descriptor)
        raise
    return descriptor


def stat_identity(info: os.stat_result) -> dict[str, int]:
    return {
        "ctime_ns": info.st_ctime_ns,
        "device": info.st_dev,
        "inode": info.st_ino,
        "mtime_ns": info.st_mtime_ns,
        "size": info.st_size,
    }


def require_directory(path: Path, code: str) -> None:
    if path.is_symlink() or not path.is_dir():
        raise ContractError(code, str(path))


def fsync_directory(path: Path) -> None:
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    except OSError as exc:
        raise ContractError("DIRECTORY_FSYNC_FAILED", str(path)) from exc
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def make_packet_directory(path: Path) -> None:
    """Create every missing packet directory with mode 0700, refusing symlinks."""

    if path.is_symlink():
        raise ContractError("PACKET_DIRECTORY_SYMLINK", str(path))
    if path.is_dir():
        return
    make_packet_directory(path.parent)
    try:
        os.mkdir(path, 0o700)
    except FileExistsError:
        require_directory(path, "PACKET_DIRECTORY_INVALID")
    except OSError as exc:
        raise ContractError("PACKET_DIRECTORY_CREATE_FAILED", str(path)) from exc
    fsync_directory(path.parent)


COMPLETED_ARTIFACT_MODE: Final = 0o444


def exclusive_create(path: Path, payload: bytes) -> str:
    """artifact_write_law exclusive_create; returns the raw SHA-256 written.

    The completion boundary is every one of: full bytes written, first fsync,
    ``fchmod`` of the same descriptor to 0444, second fsync, close, and a parent
    directory fsync.  Only after all of those succeed does a completed artifact
    exist; a name that already exists is refused outright.
    """

    require_directory(path.parent, "PACKET_DIRECTORY_INVALID")
    try:
        descriptor = os.open(
            path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600
        )
    except FileExistsError as exc:
        raise ContractError("CREATE_ONCE_REFUSED", str(path)) from exc
    except OSError as exc:
        raise ContractError("CREATE_ONCE_FAILED", str(path)) from exc
    identity: tuple[int, int] | None = None
    descriptor_open = True
    try:
        created = os.fstat(descriptor)
        identity = (created.st_dev, created.st_ino)
        written = 0
        while written < len(payload):
            written += os.write(descriptor, payload[written:])
        os.fsync(descriptor)
        os.fchmod(descriptor, COMPLETED_ARTIFACT_MODE)
        os.fsync(descriptor)
        os.close(descriptor)
        descriptor_open = False
        # Durability of the name is part of completion, not best-effort work
        # after it: a parent-fsync failure must roll the new inode back too.
        fsync_directory(path.parent)
    except BaseException:
        if descriptor_open:
            try:
                os.close(descriptor)
            except OSError:
                pass
        discard_incomplete(path, identity)
        raise
    return sha256_bytes(payload)


def discard_incomplete(path: Path, identity: tuple[int, int] | None) -> None:
    """Unlink a pre-completion path only after proving this attempt created it.

    Cleaning up a proven-incomplete path is not artifact deletion, because no
    completed artifact ever existed there.  If the exact device and inode this
    attempt created cannot still be identified, cleanup is not attempted and the
    stage stays terminally failed rather than removing someone else's file.
    """

    if identity is None:
        return
    try:
        info = os.lstat(path)
    except OSError:
        return
    if not stat.S_ISREG(info.st_mode) or (info.st_dev, info.st_ino) != identity:
        raise ContractError("INCOMPLETE_PATH_IDENTITY_MISMATCH", str(path))
    try:
        os.unlink(path)
        fsync_directory(path.parent)
    except OSError as exc:
        raise ContractError("INCOMPLETE_PATH_CLEANUP_FAILED", str(path)) from exc


def require_completed_artifact(path: Path) -> None:
    """Refuse to read a packet path that is not a completed artifact.

    An incomplete path is never hashed into the chain, parsed, accepted as a
    predecessor, reported, or verified; 0444 is the durable completion marker set
    on the same descriptor before close.
    """

    if path.is_symlink():
        raise ContractError("ARTIFACT_SYMLINK_REFUSED", str(path))
    try:
        info = os.lstat(path)
    except OSError as exc:
        raise ContractError("ARTIFACT_MISSING", str(path)) from exc
    if not stat.S_ISREG(info.st_mode):
        raise ContractError("ARTIFACT_NOT_REGULAR_FILE", str(path))
    if stat.S_IMODE(info.st_mode) != COMPLETED_ARTIFACT_MODE:
        raise ContractError("ARTIFACT_INCOMPLETE_MODE", str(path))


def write_artifact(packet_root: Path, relative: str, value: Mapping[str, Any]) -> str:
    payload = canonical_bytes(dict(value))
    return exclusive_create(packet_root / relative, payload)


def write_packet_text(packet_root: Path, relative: str, text: str) -> str:
    return exclusive_create(packet_root / relative, text.encode("utf-8"))


def load_raw(path: Path) -> bytes:
    descriptor = open_regular_readonly(path)
    try:
        os.lseek(descriptor, 0, os.SEEK_SET)
        chunks: list[bytes] = []
        while True:
            chunk = os.read(descriptor, READ_CHUNK_BYTES)
            if not chunk:
                break
            chunks.append(chunk)
        return b"".join(chunks)
    finally:
        os.close(descriptor)


def load_json_bytes(raw: bytes, detail: str) -> dict[str, Any]:
    try:
        value = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ContractError("JSON_PARSE_FAILED", detail) from exc
    if not isinstance(value, dict):
        raise ContractError("JSON_OBJECT_REQUIRED", detail)
    return dict(value)


def load_json_file(path: Path) -> dict[str, Any]:
    return load_json_bytes(load_raw(path), str(path))


def load_artifact(packet_root: Path, relative: str, schema: str) -> tuple[dict[str, Any], str]:
    """Load a packet artifact, requiring exact canonical bytes; return it and its digest."""

    require_completed_artifact(packet_root / relative)
    raw = load_raw(packet_root / relative)
    value = load_json_bytes(raw, relative)
    if raw != canonical_bytes(value):
        raise ContractError("ARTIFACT_NOT_CANONICAL", relative)
    if value.get("schema") != schema:
        raise ContractError("ARTIFACT_SCHEMA_INVALID", relative)
    if "raw_sha256" in value or "self_sha256" in value:
        raise ContractError("SELF_DIGEST_FORBIDDEN", relative)
    return value, sha256_bytes(raw)


def predecessor_record(
    packet_root: Path,
    target_relative: str,
    predecessor_relative: str,
) -> dict[str, Any]:
    """Directed predecessor plus the exact frozen input set for multi-input artifacts.

    The bound set is read from ``MULTI_INPUT_BINDINGS`` rather than passed in, so a
    write site cannot bind a set that authentication would later reject.
    """

    record: dict[str, Any] = {
        "predecessor_raw_sha256": sha256_path(packet_root / predecessor_relative),
        "predecessor_relative_path": predecessor_relative,
    }
    expected_inputs = MULTI_INPUT_BINDINGS.get(target_relative)
    if expected_inputs is not None:
        if predecessor_relative not in expected_inputs:
            raise ContractError("PREDECESSOR_NOT_IN_INPUT_SET", target_relative)
        record["input_bindings"] = [
            {
                "byte_count": len(load_raw(packet_root / relative)),
                "raw_sha256": sha256_path(packet_root / relative),
                "relative_path": relative,
            }
            for relative in sorted(expected_inputs)
        ]
    return record


def require_predecessor(
    packet_root: Path,
    artifact: Mapping[str, Any],
    relative: str,
    expected_predecessor: str,
) -> None:
    """Authenticate the directed link and, where required, the exact input set.

    ``input_bindings`` is non-optional for every multi-input artifact: the bound
    set must equal the frozen expectation exactly, be sorted, and every digest and
    byte count must still match the packet bytes.
    """

    if artifact.get("predecessor_relative_path") != expected_predecessor:
        raise ContractError("PREDECESSOR_PATH_INVALID", relative)
    if artifact.get("predecessor_raw_sha256") != sha256_path(packet_root / expected_predecessor):
        raise ContractError("PREDECESSOR_DIGEST_INVALID", relative)
    expected_inputs = MULTI_INPUT_BINDINGS.get(relative)
    bindings = artifact.get("input_bindings")
    if expected_inputs is None:
        if bindings is not None:
            raise ContractError("INPUT_BINDINGS_UNEXPECTED", relative)
        return
    if not isinstance(bindings, list) or not bindings:
        raise ContractError("INPUT_BINDINGS_REQUIRED", relative)
    observed: list[str] = []
    for binding in cast(list[Any], bindings):
        if not isinstance(binding, dict) or tuple(sorted(binding)) != BINDING_FIELDS:
            raise ContractError("INPUT_BINDING_FIELD_SET_INVALID", relative)
        bound = str(binding.get("relative_path"))
        require_completed_artifact(packet_root / bound)
        raw = load_raw(packet_root / bound)
        if binding.get("raw_sha256") != sha256_bytes(raw) or binding.get("byte_count") != len(raw):
            raise ContractError("INPUT_BINDING_DRIFT", f"{relative}:{bound}")
        observed.append(bound)
    if observed != sorted(observed):
        raise ContractError("INPUT_BINDINGS_UNSORTED", relative)
    if tuple(observed) != expected_inputs:
        raise ContractError(
            "INPUT_BINDING_SET_MISMATCH",
            f"{relative}:expected={','.join(expected_inputs)};found={','.join(observed)}",
        )


def utc_now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def iso_ms(value: int) -> str:
    return datetime.fromtimestamp(value / 1000, UTC).isoformat().replace("+00:00", "Z")


def ceil_hour_ms(value: int) -> int:
    return value if value % HOUR_MS == 0 else (value // HOUR_MS + 1) * HOUR_MS


def month_bounds_ms(month: str) -> tuple[int, int]:
    try:
        start = datetime.strptime(month, "%Y-%m").replace(tzinfo=UTC)
    except ValueError as exc:
        raise ContractError("MONTH_INVALID", month) from exc
    end = (
        start.replace(year=start.year + 1, month=1)
        if start.month == 12
        else start.replace(month=start.month + 1)
    )
    return int(start.timestamp() * 1000), int(end.timestamp() * 1000)


def day_start_ms(value: int) -> int:
    return value - value % DAY_MS


def utc_month(value: int) -> str:
    return datetime.fromtimestamp(value / 1000, UTC).strftime("%Y-%m")


def iso_week(value: int) -> str:
    calendar = datetime.fromtimestamp(value / 1000, UTC).isocalendar()
    return f"{calendar[0]:04d}-W{calendar[1]:02d}"


def finite_decimal(value: Any, field_name: str) -> Decimal:
    """Parse a required numeric field; anything non-finite is invalid evidence."""

    text = str(value).strip()
    if not text:
        raise EvidenceError("NUMERIC_EMPTY", field_name)
    try:
        number = Decimal(text)
    except (InvalidOperation, ValueError) as exc:
        raise EvidenceError("NUMERIC_MALFORMED", field_name) from exc
    if not number.is_finite():
        raise EvidenceError("NUMERIC_NONFINITE", field_name)
    return number


def integer_field(raw: str, field_name: str) -> int:
    text = raw.strip()
    try:
        return int(text)
    except ValueError as exc:
        raise EvidenceError("INTEGER_MALFORMED", field_name) from exc


def unsigned_decimal_token(raw: str, field_name: str) -> tuple[str, str]:
    """Require an unsigned non-exponent base-10 token; return integer and fraction digits.

    The token is validated lexically before any numeric conversion, so exponent
    notation, signs, and a bare leading point are rejected as invalid evidence
    rather than silently accepted by a permissive parser.
    """

    if UNSIGNED_DECIMAL_TOKEN_RE.fullmatch(raw) is None:
        raise EvidenceError("QUOTE_VOLUME_TOKEN_INVALID", field_name)
    integer, _, fraction = raw.partition(".")
    return integer, fraction


def exact_token_total(tokens: Sequence[str], field_name: str) -> ExactTotal:
    """Sum unsigned decimal tokens with arbitrary-precision integer arithmetic."""

    if not tokens:
        raise EvidenceError("QUOTE_VOLUME_TOKENS_EMPTY", field_name)
    parsed = [unsigned_decimal_token(token, field_name) for token in tokens]
    scale = max(len(fraction) for _integer, fraction in parsed)
    numerator = sum(int(integer + fraction.ljust(scale, "0")) for integer, fraction in parsed)
    return ExactTotal(numerator=numerator, scale=scale)


def decimal_string(value: Decimal) -> str:
    if value == 0:
        return "0"
    return format(value, "f")


def quantize_daily(value: Decimal) -> Decimal:
    return value.quantize(DAILY_QUANTUM)


def note_member_open() -> None:
    if MEMBER_OPEN_STAGE is not None:
        MEMBER_OPEN_COUNTS[MEMBER_OPEN_STAGE] += 1


def set_member_open_stage(stage: str) -> None:
    global MEMBER_OPEN_STAGE
    if stage not in MEMBER_OPEN_COUNTS:
        raise ContractError("MEMBER_OPEN_STAGE_INVALID", stage)
    MEMBER_OPEN_COUNTS[stage] = 0
    MEMBER_OPEN_STAGE = stage


def _require(condition: bool, code: str, detail: str = "") -> None:
    if not condition:
        raise ContractError(code, detail)


def _section(value: Mapping[str, Any], key: str, detail: str) -> Mapping[str, Any]:
    section = value.get(key)
    _require(isinstance(section, dict), "SECTION_MISSING", f"{detail}:{key}")
    return cast(Mapping[str, Any], section)


def _numbers_equal(observed: Any, expected: Decimal) -> bool:
    if isinstance(observed, bool) or not isinstance(observed, int | float | str):
        return False
    try:
        return Decimal(str(observed)) == expected
    except InvalidOperation:
        return False


def _threshold_map_matches(observed: Any, expected: Mapping[str, Decimal]) -> bool:
    if not isinstance(observed, dict):
        return False
    return all(_numbers_equal(observed.get(key), value) for key, value in expected.items())


def _tuple_of(value: Any) -> tuple[Any, ...]:
    return tuple(cast(list[Any], value)) if isinstance(value, list) else ()


def validate_protocol(raw: bytes) -> Mapping[str, Any]:
    """Refuse to run when any frozen protocol parameter drifts from this engine."""

    protocol = load_json_bytes(raw, "protocol.v1.json")
    detail = "protocol.v1.json"
    _require(protocol.get("canonical_base") == CANONICAL_BASE, "PROTOCOL_BASE_INVALID")
    _require(protocol.get("protocol_id") == PROTOCOL_ID, "PROTOCOL_ID_INVALID")
    _require(protocol.get("strategy_id") == STRATEGY_ID, "PROTOCOL_STRATEGY_INVALID")

    allocation = _section(protocol, "allocation", detail)
    _require(_numbers_equal(allocation.get("gross_reference_usd"), CAPITAL), "ALLOCATION_DRIFT")
    for flag in ("compounding", "leverage_claim", "partial_cohort", "renormalization"):
        _require(allocation.get(flag) is False, "ALLOCATION_DRIFT", flag)
    _require(allocation.get("invalid_evidence_is_not_cash") is True, "ALLOCATION_DRIFT", "invalid")

    estimand = _section(protocol, "estimand", detail)
    _require(
        _numbers_equal(estimand.get("rank_cutoff_n"), Decimal(RANK_CUTOFF_N)),
        "ESTIMAND_DRIFT",
        "rank_cutoff_n",
    )
    _require(
        _tuple_of(estimand.get("tested_rank_cutoffs")) == TESTED_RANK_CUTOFFS,
        "ESTIMAND_DRIFT",
        "tested_rank_cutoffs",
    )
    _require(estimand.get("generalization_beyond_universe") == "NONE", "ESTIMAND_DRIFT", "scope")
    _require(
        "never padded" in str(estimand.get("eligible_count_below_cutoff")),
        "ESTIMAND_DRIFT",
        "below_cutoff",
    )
    _require(
        any(
            "other than the frozen N=100 rule" in str(item)
            for item in _tuple_of(protocol.get("forbidden"))
        ),
        "FORBIDDEN_DRIFT",
        "rank_cutoff",
    )

    clock = _section(protocol, "observation_clock", detail)
    _require(clock.get("label") == "RETROSPECTIVE_OBSERVED_SETTLEMENT_ASSOCIATION", "CLOCK_DRIFT")
    _require(
        "3599999) // 3600000) * 3600000" in str(clock.get("decision_hour")),
        "CLOCK_DRIFT",
        "decision_hour_formula",
    )
    for flag in ("future_or_target_row_as_signal", "historical_announcement_backfill",
                 "lag_safe_claim", "policy_effect_claim"):
        _require(clock.get(flag) is False, "CLOCK_DRIFT", flag)
    _require(clock.get("archive_publication_latency") == "UNKNOWN", "CLOCK_DRIFT", "latency")

    event = _section(protocol, "event", detail)
    _require(
        _numbers_equal(event.get("cooldown_days_per_symbol"), Decimal(COOLDOWN_DAYS_PER_SYMBOL)),
        "EVENT_DRIFT",
        "cooldown_days",
    )
    _require(event.get("cooldown_zero_or_cash_update") is False, "EVENT_DRIFT", "cooldown_update")
    _require(
        _numbers_equal(event.get("pre_transition_rows"), Decimal(PRE_TRANSITION_ROWS)),
        "EVENT_DRIFT",
        "pre_transition_rows",
    )
    _require(
        _tuple_of(event.get("eligible_new_interval_hours")) == ELIGIBLE_NEW_INTERVAL_HOURS,
        "EVENT_DRIFT",
        "eligible_intervals",
    )

    capacity = _section(protocol, "capacity", detail)
    _require(
        _numbers_equal(capacity.get("participation_rate"), PARTICIPATION_RATE),
        "CAPACITY_DRIFT",
        "participation",
    )
    _require(capacity.get("executable_capacity_usd") == "UNKNOWN", "CAPACITY_DRIFT", "executable")
    _require(
        capacity.get("label") == "PUBLIC_COARSE_PRIOR_VOLUME_PARTICIPATION_PROXY",
        "CAPACITY_DRIFT",
        "label",
    )

    costs = _section(protocol, "costs", detail)
    _require(costs.get("account_effective_fee") == "UNKNOWN", "COST_DRIFT", "account_fee")
    scenarios = _section(costs, "scenarios", detail)
    _require(tuple(sorted(scenarios)) == tuple(sorted(COSTS)), "COST_DRIFT", "scenario_set")
    for name, (fee, adverse) in COSTS.items():
        row = _section(scenarios, name, detail)
        _require(_numbers_equal(row.get("public_fee_bp_per_fill"), fee), "COST_DRIFT", name)
        _require(
            _numbers_equal(row.get("adverse_execution_bp_per_fill"), adverse), "COST_DRIFT", name
        )

    statistics = _section(protocol, "statistics", detail)
    bootstrap = _section(statistics, "bootstrap", detail)
    _require(_numbers_equal(bootstrap.get("alpha"), ALPHA), "BOOTSTRAP_DRIFT", "alpha")
    _require(
        _numbers_equal(bootstrap.get("circular_block_days"), Decimal(BOOTSTRAP_BLOCK_DAYS)),
        "BOOTSTRAP_DRIFT",
        "block_days",
    )
    _require(
        _numbers_equal(bootstrap.get("replicates"), Decimal(BOOTSTRAP_REPLICATES)),
        "BOOTSTRAP_DRIFT",
        "replicates",
    )
    _require(
        _numbers_equal(bootstrap.get("seed"), Decimal(BOOTSTRAP_SEED)), "BOOTSTRAP_DRIFT", "seed"
    )

    multiplicity = _section(protocol, "multiplicity", detail)
    _require(
        _numbers_equal(multiplicity.get("family_size"), Decimal(FAMILY_SIZE)),
        "MULTIPLICITY_DRIFT",
        "family_size",
    )
    _require(
        _numbers_equal(multiplicity.get("familywise_alpha"), ALPHA),
        "MULTIPLICITY_DRIFT",
        "alpha",
    )
    _require(
        _numbers_equal(multiplicity.get("bonferroni_hypotheses"), Decimal(BONFERRONI_HYPOTHESES)),
        "MULTIPLICITY_DRIFT",
        "hypotheses",
    )
    _require(
        multiplicity.get("bonferroni_lower_quantile_exact") == "1/480",
        "MULTIPLICITY_DRIFT",
        "quantile",
    )
    pbo = _section(multiplicity, "pbo", detail)
    _require(pbo.get("loss") == "lambda <= 0", "PBO_DRIFT", "loss")
    _require("924" in str(pbo.get("splits")), "PBO_DRIFT", "splits")

    _require(
        _threshold_map_matches(protocol.get("development_gates"), DEVELOPMENT_GATE_THRESHOLDS),
        "DEVELOPMENT_GATE_DRIFT",
    )
    _require(
        cast(Mapping[str, Any], protocol.get("development_gates", {})).get(
            "all_must_pass_before_holdout"
        )
        is True,
        "DEVELOPMENT_GATE_DRIFT",
        "all_must_pass",
    )
    _require(
        _threshold_map_matches(protocol.get("holdout_gates_if_opened"), HOLDOUT_GATE_THRESHOLDS),
        "HOLDOUT_GATE_DRIFT",
    )

    family = _section(protocol, "trial_family", detail)
    _require(_numbers_equal(family.get("count"), Decimal(FAMILY_SIZE)), "FAMILY_DRIFT", "count")
    _require(
        _tuple_of(family.get("confirmation_rows")) == CONFIRMATION_ROWS, "FAMILY_DRIFT", "rows"
    )
    _require(_tuple_of(family.get("entry_lag_hours")) == ENTRY_LAG_HOURS, "FAMILY_DRIFT", "lag")
    _require(_tuple_of(family.get("hold_hours")) == HOLD_HOURS, "FAMILY_DRIFT", "hold")

    window = _section(protocol, "window", detail)
    for key, expected in (
        ("screen_start", SCREEN_START_MS),
        ("screen_end", SCREEN_END_MS),
        ("development_start", DEVELOPMENT_START_MS),
        ("development_end", DEVELOPMENT_END_MS),
        ("holdout_start", HOLDOUT_START_MS),
        ("holdout_end", HOLDOUT_END_MS),
    ):
        _require(window.get(key) == iso_ms(expected), "WINDOW_DRIFT", key)

    screen = _section(protocol, "screen", detail)
    _require(screen.get("month") == SCREEN_MONTHS[0], "SCREEN_DRIFT", "month")
    _require(screen.get("outcome_scoring") is False, "SCREEN_DRIFT", "outcome_scoring")
    _require("^[A-Z0-9]+USDT$" in str(screen.get("candidate_symbol_rule")), "SCREEN_DRIFT", "regex")
    _require(
        str(JUNE_FUNDING_ROWS) in str(screen.get("funding_validation")), "SCREEN_DRIFT", "rows"
    )
    _require(
        str(JUNE_HOURLY_ROWS) in str(screen.get("hourly_validation")), "SCREEN_DRIFT", "hours"
    )
    _require(
        UNSIGNED_DECIMAL_TOKEN_RE.pattern in str(screen.get("hourly_validation")),
        "SCREEN_DRIFT",
        "quote_token_rule",
    )
    _require(
        _numbers_equal(screen.get("rank_cutoff_n"), Decimal(RANK_CUTOFF_N)),
        "SCREEN_DRIFT",
        "rank_cutoff_n",
    )
    _require(
        "N=100 is the only permitted cutoff" in str(screen.get("rank_cutoff_trials")),
        "SCREEN_DRIFT",
        "rank_cutoff_trials",
    )
    _require(
        "descending" in str(screen.get("ranking_order"))
        and "ASCII" in str(screen.get("ranking_order")),
        "SCREEN_DRIFT",
        "ranking_order",
    )
    _require(
        f"min({RANK_CUTOFF_N}, eligible_count)" in str(screen.get("selection_rule")),
        "SCREEN_DRIFT",
        "selection_rule",
    )
    _require(
        "SELECTED or REJECTED_BY_RANK" in str(screen.get("screen_ledger")),
        "SCREEN_DRIFT",
        "screen_ledger",
    )
    _require(
        "without exponent notation" in str(screen.get("volume_arithmetic")),
        "SCREEN_DRIFT",
        "volume_arithmetic",
    )
    _require(isinstance(screen.get("eligible_definition"), str), "SCREEN_DRIFT", "eligible")

    sources = _section(protocol, "sources", detail)
    for flag in ("engine_network_access", "fresh_public_download", "rest_or_private_fallback"):
        _require(sources.get(flag) is False, "SOURCE_POLICY_DRIFT", flag)
    _require(sources.get("archive_root") == ARCHIVE_ROOT_URL, "SOURCE_POLICY_DRIFT", "root")
    _require(sources.get("checksum_suffix") == CHECKSUM_SUFFIX, "SOURCE_POLICY_DRIFT", "checksum")

    authority = _section(protocol, "authority", detail)
    for key, value in authority.items():
        if key == "money_moved_usd":
            _require(_numbers_equal(value, Decimal(0)), "AUTHORITY_DRIFT", key)
        else:
            _require(value == "NONE", "AUTHORITY_DRIFT", key)

    lineage = _section(protocol, "git_lineage", detail)
    _require(
        "not equal to canonical_base" in str(lineage.get("static_producer_commit")),
        "LINEAGE_DRIFT",
        "producer",
    )

    contract = _section(protocol, "result_contract", detail)
    _require(contract.get("capital_authority_constant") == "NO_GO", "RESULT_CONTRACT_DRIFT")
    _require(
        _tuple_of(contract.get("allowed_verdicts")) == ALLOWED_VERDICTS,
        "RESULT_CONTRACT_DRIFT",
        "verdicts",
    )
    _require(bool(_tuple_of(contract.get("required_fields"))), "RESULT_CONTRACT_DRIFT", "fields")
    return protocol


def run_custody_partial_cleanup(plan: Mapping[str, Any]) -> Any:
    custody = plan.get("run_custody")
    if not isinstance(custody, dict):
        return None
    return cast(Mapping[str, Any], custody).get("partial_write_cleanup")


def validate_source_plan(raw: bytes) -> Mapping[str, Any]:
    plan = load_json_bytes(raw, "source_plan.v1.json")
    detail = "source_plan.v1.json"
    _require(plan.get("schema") == f"{SCHEMA_PREFIX}.source_plan.v1", "PLAN_SCHEMA_INVALID")
    _require(plan.get("protocol_id") == PROTOCOL_ID, "PLAN_PROTOCOL_DRIFT")
    _require(plan.get("canonical_base") == CANONICAL_BASE, "PLAN_BASE_INVALID")
    _require(plan.get("public_only") is True, "PLAN_PUBLIC_ONLY_DRIFT")
    _require(_tuple_of(plan.get("months")) == ALL_MONTHS, "PLAN_MONTHS_DRIFT")

    for key, value in _section(plan, "network_policy", detail).items():
        _require(value is False, "PLAN_NETWORK_POLICY_DRIFT", key)

    lineage = _section(plan, "git_preseal", detail)
    _require(
        _tuple_of(lineage.get("static_file_allowlist")) == STATIC_FILE_ALLOWLIST,
        "PLAN_ALLOWLIST_DRIFT",
    )
    _require(
        lineage.get("packet_copy_root") == PACKET_STATIC_ROOT.as_posix(),
        "PLAN_ALLOWLIST_DRIFT",
        "packet_copy_root",
    )

    write_law = _section(plan, "artifact_write_law", detail)
    for key in ("canonical_json", "completion_boundary", "digest", "exclusive_create",
                "failed_or_partial_write", "immutability", "incomplete_acceptance",
                "packet_root", "predecessor_record", "static_and_source_copies", "symlinks"):
        _require(isinstance(write_law.get(key), str), "PLAN_WRITE_LAW_DRIFT", key)
    _require("O_NOFOLLOW" in str(write_law.get("exclusive_create")), "PLAN_WRITE_LAW_DRIFT", "excl")
    _require(
        "fchmod the same descriptor to 0444" in str(write_law.get("exclusive_create")),
        "PLAN_WRITE_LAW_DRIFT",
        "fchmod_0444",
    )
    _require(
        "fchmod 0444 succeeds" in str(write_law.get("completion_boundary")),
        "PLAN_WRITE_LAW_DRIFT",
        "completion_boundary",
    )
    _require(
        "device and inode created by this attempt"
        in str(write_law.get("failed_or_partial_write")),
        "PLAN_WRITE_LAW_DRIFT",
        "cleanup_identity",
    )
    _require(
        "never hashed into the chain" in str(write_law.get("incomplete_acceptance")),
        "PLAN_WRITE_LAW_DRIFT",
        "incomplete_acceptance",
    )
    _require(
        isinstance(run_custody_partial_cleanup(plan), str), "PLAN_RUN_CUSTODY_DRIFT", "cleanup"
    )

    custody = _section(plan, "partition_custody", detail)
    development = _section(custody, "development", detail)
    holdout = _section(custody, "holdout", detail)
    screen = _section(custody, "screen", detail)
    _require(
        _tuple_of(development.get("months")) == DEVELOPMENT_MONTHS, "PLAN_CUSTODY_DRIFT", "dev"
    )
    _require(_tuple_of(holdout.get("months")) == HOLDOUT_MONTHS, "PLAN_CUSTODY_DRIFT", "holdout")
    _require(holdout.get("reselection") is False, "PLAN_CUSTODY_DRIFT", "reselection")
    _require(
        holdout.get("scored_start") == iso_ms(HOLDOUT_START_MS), "PLAN_CUSTODY_DRIFT", "scored"
    )
    _require(screen.get("month") == SCREEN_MONTHS[0], "PLAN_CUSTODY_DRIFT", "screen")
    _require(screen.get("outcome_scoring") is False, "PLAN_CUSTODY_DRIFT", "screen_scoring")
    _require(
        bool(_tuple_of(holdout.get("header_only_schema_exposed"))),
        "PLAN_CUSTODY_DRIFT",
        "exposure",
    )

    run_custody = _section(plan, "run_custody", detail)
    _require(run_custody.get("one_run") is True, "PLAN_RUN_CUSTODY_DRIFT", "one_run")
    _require(run_custody.get("repair") is False, "PLAN_RUN_CUSTODY_DRIFT", "repair")
    _require(run_custody.get("rerun") is False, "PLAN_RUN_CUSTODY_DRIFT", "rerun")
    _require(run_custody.get("second_invocation") == "REFUSE", "PLAN_RUN_CUSTODY_DRIFT", "second")
    screen_custody = _section(plan, "screen_custody", detail)
    _require(screen_custody.get("one_screen") is True, "PLAN_SCREEN_CUSTODY_DRIFT", "one")
    _require(
        screen_custody.get("second_invocation") == "REFUSE", "PLAN_SCREEN_CUSTODY_DRIFT", "second"
    )
    _require(
        f"N={RANK_CUTOFF_N} only" in str(screen_custody.get("rank_cutoff")),
        "PLAN_SCREEN_CUSTODY_DRIFT",
        "rank_cutoff",
    )
    _require(
        "SELECTED or REJECTED_BY_RANK" in str(screen_custody.get("rank_ledger")),
        "PLAN_SCREEN_CUSTODY_DRIFT",
        "rank_ledger",
    )
    _require(
        "no binary float" in str(screen_custody.get("rank_math")),
        "PLAN_SCREEN_CUSTODY_DRIFT",
        "rank_math",
    )
    _require(
        "june_only" in screen_custody and isinstance(screen_custody.get("june_only"), str),
        "PLAN_SCREEN_CUSTODY_DRIFT",
        "june_only",
    )

    cache = _section(plan, "cache", detail)
    _require(cache.get("upstream_outcomes") == "FORBIDDEN", "PLAN_CACHE_DRIFT", "outcomes")
    _require(
        cache.get("manifest_expected_schema") == CACHE_MANIFEST_SCHEMA, "PLAN_CACHE_DRIFT", "schema"
    )
    _require("no hardlinks" in str(cache.get("reuse_rule")), "PLAN_CACHE_DRIFT", "hardlinks")
    for key in ("root", "manifest"):
        value = cache.get(key)
        _require(isinstance(value, str) and value.startswith("/"), "PLAN_CACHE_DRIFT", key)

    copy_custody = _section(plan, "source_copy_custody", detail)
    for key in ("cache_identity", "copy", "official_checksum", "post_copy", "pre_member_open",
                "post_member_open", "toctou_failure"):
        _require(isinstance(copy_custody.get(key), str), "PLAN_COPY_CUSTODY_DRIFT", key)

    selected = _section(plan, "selected_source", detail)
    _require(_tuple_of(selected.get("datasets")) == PLAN_DATASET_ORDER, "PLAN_DATASET_DRIFT")
    _require(
        tuple(sorted(str(name) for name in _tuple_of(selected.get("manifest_fields"))))
        == MANIFEST_FIELDS,
        "PLAN_MANIFEST_FIELD_DRIFT",
    )
    _require(
        f"min({RANK_CUTOFF_N}, eligible_count)" in str(selected.get("estimand_population")),
        "PLAN_DATASET_DRIFT",
        "estimand_population",
    )
    _require(
        "INVALID_EVIDENCE_UNMEASURED" in str(selected.get("later_absence_or_mismatch")),
        "PLAN_DATASET_DRIFT",
        "absence",
    )

    templates = _section(plan, "templates", detail)
    _require(templates.get("checksum") == "{zip_path}.CHECKSUM", "PLAN_TEMPLATE_DRIFT", "checksum")
    for dataset in DATASETS:
        expected = archive_template(dataset)
        _require(templates.get(dataset) == expected, "PLAN_TEMPLATE_DRIFT", dataset)

    packet_default = plan.get("packet_root_default")
    _require(
        isinstance(packet_default, str) and packet_default.startswith("/"),
        "PLAN_PACKET_ROOT_DRIFT",
    )
    _require(bool(_tuple_of(plan.get("artifact_chain"))), "PLAN_CHAIN_DRIFT")
    _require(bool(_section(plan, "digest_chain_branches", detail)), "PLAN_CHAIN_DRIFT", "branches")
    return plan


def validate_trial_ledger(raw: bytes) -> Mapping[str, Any]:
    ledger = load_json_bytes(raw, "trial_ledger.v1.json")
    _require(ledger.get("schema") == f"{SCHEMA_PREFIX}.trial_ledger.v1", "LEDGER_SCHEMA_INVALID")
    _require(ledger.get("protocol_id") == PROTOCOL_ID, "LEDGER_PROTOCOL_DRIFT")
    _require(_numbers_equal(ledger.get("family_size"), Decimal(FAMILY_SIZE)), "LEDGER_SIZE_DRIFT")
    rows = ledger.get("trials")
    _require(isinstance(rows, list), "LEDGER_TRIALS_INVALID")
    expected = [
        {
            "confirmation_rows": trial.confirmation_rows,
            "entry_lag_hours": trial.entry_lag_hours,
            "hold_hours": trial.hold_hours,
            "trial_id": trial.trial_id,
        }
        for trial in trial_family()
    ]
    observed = [
        {
            key: row.get(key)
            for key in ("confirmation_rows", "entry_lag_hours", "hold_hours", "trial_id")
        }
        for row in cast(list[Any], rows)
        if isinstance(row, dict)
    ]
    _require(observed == expected, "LEDGER_DRIFT")
    return ledger


def archive_template(dataset: str) -> str:
    if dataset == "fundingRate":
        return f"{ARCHIVE_PREFIX}/fundingRate/{{symbol}}/{{symbol}}-fundingRate-{{month}}.zip"
    if dataset == "klines_1h":
        return f"{ARCHIVE_PREFIX}/klines/{{symbol}}/1h/{{symbol}}-1h-{{month}}.zip"
    if dataset == "markPriceKlines_1h":
        return f"{ARCHIVE_PREFIX}/markPriceKlines/{{symbol}}/1h/{{symbol}}-1h-{{month}}.zip"
    raise ContractError("DATASET_INVALID", dataset)


def archive_relative_path(dataset: str, symbol: str, month: str) -> PurePosixPath:
    return PurePosixPath(archive_template(dataset).format(symbol=symbol, month=month))


def source_url(dataset: str, symbol: str, month: str) -> str:
    return "https://data.binance.vision/" + archive_relative_path(dataset, symbol, month).as_posix()


def validate_static_set(static_dir: Path) -> tuple[Mapping[str, Any], ...]:
    """Validate the three machine-read static contracts from exact bytes."""

    protocol = validate_protocol(load_raw(static_dir / "protocol.v1.json"))
    plan = validate_source_plan(load_raw(static_dir / "source_plan.v1.json"))
    ledger = validate_trial_ledger(load_raw(static_dir / "trial_ledger.v1.json"))
    return protocol, plan, ledger


def git_query(repo: Path, *arguments: str) -> bytes:
    """Run one allowlisted local read-only git query with a scrubbed environment."""

    if not arguments or arguments[0] not in GIT_ALLOWED_SUBCOMMANDS:
        raise ContractError("GIT_SUBCOMMAND_FORBIDDEN", " ".join(arguments[:1]))
    executable = shutil.which("git")
    if executable is None:
        raise ContractError("GIT_UNAVAILABLE")
    environment = {
        "GIT_CONFIG_GLOBAL": os.devnull,
        "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_OPTIONAL_LOCKS": "0",
        "GIT_TERMINAL_PROMPT": "0",
        "HOME": os.devnull,
        "LC_ALL": "C",
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
    }
    try:
        completed = subprocess.run(  # noqa: S603 - fixed argv, no shell, local read-only
            [executable, "-C", str(repo), *arguments],
            capture_output=True,
            check=False,
            env=environment,
            shell=False,
            timeout=GIT_TIMEOUT_SECONDS,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise ContractError("GIT_QUERY_FAILED", arguments[0]) from exc
    if completed.returncode != 0:
        raise ContractError("GIT_QUERY_NONZERO", f"{arguments[0]}:{completed.returncode}")
    return completed.stdout


def git_object_id(repo: Path, revision: str) -> str:
    text = git_query(repo, "rev-parse", "--verify", "--end-of-options", revision).decode().strip()
    if OID_RE.fullmatch(text) is None:
        raise ContractError("GIT_OBJECT_ID_INVALID", revision)
    return text


def git_blob_id(payload: bytes) -> str:
    """Compute the Git blob object id locally, independent of the git binary."""

    return hashlib.sha1(  # noqa: S324 - Git object identity is defined as SHA-1
        b"blob " + str(len(payload)).encode("ascii") + b"\0" + payload
    ).hexdigest()


def git_static_lineage(repo: Path) -> dict[str, Any]:
    """Resolve exact static lineage; the producer commit is never the base."""

    if git_query(repo, "status", "--porcelain=v1", "-z") != b"":
        raise ContractError("GIT_WORKTREE_NOT_CLEAN", str(repo))
    producer_commit = git_object_id(repo, "HEAD")
    parent_commit = git_object_id(repo, "HEAD^")
    producer_tree = git_object_id(repo, "HEAD^{tree}")
    if parent_commit != CANONICAL_BASE:
        raise ContractError("GIT_FIRST_PARENT_NOT_CANONICAL_BASE", parent_commit)
    if producer_commit == CANONICAL_BASE:
        raise ContractError("GIT_PRODUCER_EQUALS_CANONICAL_BASE", producer_commit)

    listing = git_query(
        repo, "ls-tree", "-r", "-z", "--full-tree", "HEAD", "--", REPO_STATIC_DIR.as_posix()
    )
    entries: dict[str, tuple[str, str]] = {}
    for record in listing.split(b"\0"):
        if not record:
            continue
        try:
            metadata, path = record.decode("utf-8").split("\t", 1)
            mode, object_type, object_id = metadata.split()
        except ValueError as exc:
            raise ContractError("GIT_LS_TREE_MALFORMED") from exc
        if object_type != "blob" or GIT_MODE_RE.fullmatch(mode) is None:
            raise ContractError("GIT_TREE_ENTRY_INVALID", path)
        if OID_RE.fullmatch(object_id) is None:
            raise ContractError("GIT_TREE_OID_INVALID", path)
        entries[path] = (mode, object_id)
    if tuple(sorted(entries)) != STATIC_FILE_ALLOWLIST:
        missing = sorted(set(STATIC_FILE_ALLOWLIST) - set(entries))
        extra = sorted(set(entries) - set(STATIC_FILE_ALLOWLIST))
        raise ContractError(
            "GIT_PATH_SET_MISMATCH", f"missing={','.join(missing)};extra={','.join(extra)}"
        )

    files: list[dict[str, Any]] = []
    for path in STATIC_FILE_ALLOWLIST:
        mode, object_id = entries[path]
        payload = load_raw(repo / path)
        if git_blob_id(payload) != object_id:
            raise ContractError("GIT_WORKTREE_BLOB_MISMATCH", path)
        files.append(
            {
                "byte_count": len(payload),
                "git_blob_object_id": object_id,
                "git_mode": mode,
                "raw_sha256": sha256_bytes(payload),
                "repository_relative_path": path,
            }
        )
    return {
        "canonical_base_commit": CANONICAL_BASE,
        "producer_first_parent_commit": parent_commit,
        "producer_is_canonical_base": False,
        "static_files": files,
        "static_producer_commit": producer_commit,
        "static_producer_tree": producer_tree,
        "worktree_clean": True,
    }


def cache_root_from_plan(plan: Mapping[str, Any]) -> Path:
    """Pin the read surface to the frozen official-archive cache root."""

    declared = Path(cast(str, cast(Mapping[str, Any], plan["cache"])["root"]))
    if not declared.is_absolute():
        raise ContractError("CACHE_ROOT_NOT_ABSOLUTE", str(declared))
    if declared.resolve() != declared:
        raise ContractError("CACHE_ROOT_NOT_CANONICAL", str(declared))
    require_directory(declared, "CACHE_ROOT_UNAVAILABLE")
    return declared


def require_disjoint_trees(cache_root: Path, packet_root: Path) -> None:
    """The cache and packet trees must not contain one another."""

    cache = cache_root.resolve()
    packet = packet_root.resolve()
    if cache == packet:
        raise ContractError("CACHE_PACKET_IDENTICAL", str(packet))
    if packet.is_relative_to(cache):
        raise ContractError("PACKET_ROOT_INSIDE_CACHE", str(packet))
    if cache.is_relative_to(packet):
        raise ContractError("CACHE_ROOT_INSIDE_PACKET", str(cache))


def resolve_packet_root(packet_root: Path) -> Path:
    root = packet_root.expanduser()
    if not root.is_absolute():
        raise ContractError("PACKET_ROOT_NOT_ABSOLUTE", str(packet_root))
    if root.is_symlink():
        raise ContractError("PACKET_ROOT_SYMLINK", str(root))
    return root


def create_packet_root(packet_root: Path) -> Path:
    """Exclusive mkdir mode 0700; an existing path refuses preseal."""

    root = resolve_packet_root(packet_root)
    parent = root.parent
    if not parent.is_dir() or parent.is_symlink():
        raise ContractError("PACKET_PARENT_INVALID", str(parent))
    try:
        os.mkdir(root, 0o700)
    except FileExistsError as exc:
        raise ContractError("PACKET_ROOT_EXISTS", str(root)) from exc
    except OSError as exc:
        raise ContractError("PACKET_ROOT_CREATE_FAILED", str(root)) from exc
    fsync_directory(parent)
    return root


def packet_identity(packet_root: Path) -> dict[str, int]:
    require_directory(packet_root, "PACKET_ROOT_INVALID")
    info = os.stat(packet_root, follow_symlinks=False)
    return {"device": info.st_dev, "inode": info.st_ino}


def packet_static_path(packet_root: Path, name: str) -> Path:
    return packet_root / Path(*PACKET_STATIC_ROOT.parts) / name


def preseal_static_index(preseal: Mapping[str, Any]) -> dict[str, Mapping[str, Any]]:
    rows = preseal.get("static_files")
    if not isinstance(rows, list):
        raise ContractError("PRESEAL_STATIC_FILES_INVALID")
    index: dict[str, Mapping[str, Any]] = {}
    for row in cast(list[Any], rows):
        if not isinstance(row, dict):
            raise ContractError("PRESEAL_STATIC_FILES_INVALID")
        index[str(row.get("repository_relative_path"))] = cast(Mapping[str, Any], row)
    if tuple(sorted(index)) != STATIC_FILE_ALLOWLIST:
        raise ContractError("PRESEAL_STATIC_ALLOWLIST_DRIFT")
    return index


def require_static_copies(packet_root: Path, preseal: Mapping[str, Any]) -> None:
    """Every immutable static copy must still match the digest preseal bound."""

    for path, row in sorted(preseal_static_index(preseal).items()):
        name = PurePosixPath(path).name
        copy_relative = row.get("packet_copy_relative_path")
        if copy_relative != (PACKET_STATIC_ROOT / name).as_posix():
            raise ContractError("STATIC_COPY_PATH_INVALID", path)
        payload = load_raw(packet_root / str(copy_relative))
        if sha256_bytes(payload) != row.get("packet_copy_raw_sha256"):
            raise ContractError("STATIC_COPY_DIGEST_DRIFT", path)
        if sha256_bytes(payload) != row.get("raw_sha256"):
            raise ContractError("STATIC_COPY_NOT_BYTE_IDENTICAL", path)
        if git_blob_id(payload) != row.get("git_blob_object_id"):
            raise ContractError("STATIC_COPY_BLOB_DRIFT", path)


def require_packet_runtime(packet_root: Path, preseal: Mapping[str, Any]) -> None:
    """screen, run and verify may execute only the immutable packet copy."""

    running = Path(__file__).resolve()
    expected = packet_static_path(packet_root, "experiment.py").resolve()
    if running != expected:
        raise ContractError("ENGINE_NOT_PACKET_COPY", str(running))
    row = preseal_static_index(preseal)["quant/research/s1t/experiment.py"]
    if sha256_bytes(load_raw(running)) != row.get("packet_copy_raw_sha256"):
        raise ContractError("ENGINE_DIGEST_DRIFT", str(running))


def require_worktree_runtime() -> Path:
    """preseal is the last stage allowed to execute the worktree engine."""

    running = Path(__file__).resolve()
    if PACKET_STATIC_ROOT.as_posix() in running.as_posix():
        raise ContractError("PRESEAL_MUST_RUN_FROM_WORKTREE", str(running))
    repo = HERE.parents[2]
    if not (repo / ".git").exists():
        raise ContractError("GIT_REPOSITORY_NOT_FOUND", str(repo))
    return repo


def cache_manifest_attestation(plan: Mapping[str, Any]) -> dict[str, Any]:
    """Attest the upstream cache manifest by schema string and digest only.

    ``cache.upstream_outcomes`` is FORBIDDEN, so no other field is interpreted:
    the manifest is an opaque provenance witness, never an outcome input.
    """

    path = Path(cast(str, cast(Mapping[str, Any], plan["cache"])["manifest"]))
    if path.is_symlink() or not path.is_file():
        raise ContractError("CACHE_MANIFEST_UNAVAILABLE", str(path))
    raw = load_raw(path)
    document = load_json_bytes(raw, str(path))
    declaring = sorted(
        key for key, value in document.items()
        if isinstance(value, str) and value == CACHE_MANIFEST_SCHEMA
    )
    if not declaring:
        raise ContractError("CACHE_MANIFEST_SCHEMA_INVALID", str(path))
    return {
        "declared_schema": CACHE_MANIFEST_SCHEMA,
        "declaring_keys": declaring,
        "manifest_absolute_path": str(path),
        "manifest_raw_sha256": sha256_bytes(raw),
        "upstream_outcomes_read": False,
    }


def parse_official_checksum(raw: bytes, basename: str) -> str:
    """Parse exactly one 64-hex SHA-256 token bound to the expected ZIP basename."""

    if not raw or len(raw) > MAX_SIDECAR_BYTES:
        raise EvidenceError("CHECKSUM_SIZE_INVALID", basename)
    try:
        fields = raw.decode("ascii").strip().split()
    except UnicodeDecodeError as exc:
        raise EvidenceError("CHECKSUM_ENCODING_INVALID", basename) from exc
    if len(fields) != 2 or SHA256_RE.fullmatch(fields[0]) is None:
        raise EvidenceError("CHECKSUM_SHAPE_INVALID", basename)
    bound = fields[1].lstrip("*")
    if bound != basename or "/" in bound or "\\" in bound:
        raise EvidenceError("CHECKSUM_FILENAME_INVALID", basename)
    return fields[0].lower()


def sidecar_of(path: Path) -> Path:
    return path.with_name(path.name + CHECKSUM_SUFFIX)


def _stream_copy(source_descriptor: int, destination: Path) -> tuple[str, str, int]:
    """Copy an open descriptor into a newly created packet file, hashing both sides."""

    require_directory(destination.parent, "PACKET_DIRECTORY_INVALID")
    try:
        target = os.open(
            destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600
        )
    except FileExistsError as exc:
        raise EvidenceError("PACKET_SOURCE_EXISTS", destination.name) from exc
    except OSError as exc:
        raise EvidenceError("PACKET_SOURCE_CREATE_FAILED", destination.name) from exc
    source_digest = hashlib.sha256()
    written_digest = hashlib.sha256()
    total = 0
    identity: tuple[int, int] | None = None
    target_open = True
    try:
        created = os.fstat(target)
        identity = (created.st_dev, created.st_ino)
        os.lseek(source_descriptor, 0, os.SEEK_SET)
        while True:
            chunk = os.read(source_descriptor, READ_CHUNK_BYTES)
            if not chunk:
                break
            source_digest.update(chunk)
            offset = 0
            while offset < len(chunk):
                offset += os.write(target, chunk[offset:])
            written_digest.update(chunk)
            total += len(chunk)
        os.fsync(target)
        os.fchmod(target, 0o444)
        os.fsync(target)
        os.close(target)
        target_open = False
        # The parent-directory fsync is the final completion boundary.  A failure
        # here must remove even a 0444 inode created by this attempt.
        fsync_directory(destination.parent)
    except BaseException:
        # A copy that never reached mode 0444 and a durable fsync is not an
        # accepted packet source: remove it so no unverifiable byte range survives.
        if target_open:
            try:
                os.close(target)
            except OSError:
                pass
        discard_incomplete(destination, identity)
        raise
    return source_digest.hexdigest(), written_digest.hexdigest(), total


def copy_file_into_packet(
    cache_path: Path,
    packet_path: Path,
    max_bytes: int = MAX_ZIP_BYTES,
) -> dict[str, Any]:
    """source_copy_custody: identity, exclusive copy, fsync, and mutual rehash.

    No hardlink, symlink, rename-over, or reuse of an existing destination is
    permitted.  Every digest observed before, during and after the copy must
    agree, and the source's stat identity must be unchanged throughout.
    """

    if cache_path.is_symlink():
        raise EvidenceError("SOURCE_SYMLINK_REFUSED", cache_path.name)
    descriptor = open_source_readonly(cache_path)
    try:
        before = os.fstat(descriptor)
        identity = stat_identity(before)
        if before.st_size <= 0 or before.st_size > max_bytes:
            raise EvidenceError("SOURCE_SIZE_INVALID", cache_path.name)
        pre_digest, pre_bytes = sha256_descriptor(descriptor)
        source_digest, written_digest, copied = _stream_copy(descriptor, packet_path)
        after = os.fstat(descriptor)
        if stat_identity(after) != identity:
            raise EvidenceError("CACHE_IDENTITY_CHANGED_DURING_COPY", cache_path.name)
    finally:
        os.close(descriptor)

    reopened = open_source_readonly(cache_path)
    try:
        if stat_identity(os.fstat(reopened))["inode"] != identity["inode"]:
            raise EvidenceError("CACHE_INODE_CHANGED_AFTER_COPY", cache_path.name)
        if stat_identity(os.fstat(reopened))["device"] != identity["device"]:
            raise EvidenceError("CACHE_DEVICE_CHANGED_AFTER_COPY", cache_path.name)
        post_source_digest, post_source_bytes = sha256_descriptor(reopened)
    finally:
        os.close(reopened)
    copy_descriptor = open_source_readonly(packet_path)
    try:
        post_copy_digest, post_copy_bytes = sha256_descriptor(copy_descriptor)
    finally:
        os.close(copy_descriptor)

    digests = {pre_digest, source_digest, written_digest, post_source_digest, post_copy_digest}
    sizes = {pre_bytes, copied, post_source_bytes, post_copy_bytes, identity["size"]}
    if len(digests) != 1 or len(sizes) != 1:
        raise EvidenceError("COPY_DIGEST_DISAGREEMENT", cache_path.name)
    return {
        "byte_count": copied,
        "cache_stat_identity": identity,
        "zip_sha256": pre_digest,
    }


def reverify_packet_source(packet_zip: Path, expected_zip_sha256: str | None) -> str:
    """Re-authenticate an existing packet source copy and its official sidecar."""

    sidecar = sidecar_of(packet_zip)
    if packet_zip.is_symlink() or sidecar.is_symlink():
        raise EvidenceError("PACKET_SOURCE_SYMLINK", packet_zip.name)
    if not packet_zip.is_file() or not sidecar.is_file():
        raise EvidenceError("PACKET_SOURCE_INCOMPLETE", packet_zip.name)
    descriptor = open_source_readonly(packet_zip)
    try:
        digest, byte_count = sha256_descriptor(descriptor)
    finally:
        os.close(descriptor)
    if byte_count <= 0 or byte_count > MAX_ZIP_BYTES:
        raise EvidenceError("PACKET_SOURCE_SIZE_INVALID", packet_zip.name)
    if parse_official_checksum(load_raw(sidecar), packet_zip.name) != digest:
        raise EvidenceError("PACKET_SOURCE_OFFICIAL_MISMATCH", packet_zip.name)
    if expected_zip_sha256 is not None and expected_zip_sha256 != digest:
        raise EvidenceError("PACKET_SOURCE_MANIFEST_MISMATCH", packet_zip.name)
    return digest


def materialize_packet_source(
    cache_root: Path,
    packet_root: Path,
    dataset: str,
    symbol: str,
    month: str,
    expected_zip_sha256: str | None,
) -> tuple[Path, str]:
    """Copy one verified ZIP and its official sidecar into the packet, once."""

    relative = archive_relative_path(dataset, symbol, month)
    cache_zip = cache_root / Path(*relative.parts)
    packet_zip = packet_root / "sources" / Path(*relative.parts)
    if packet_zip.exists() or sidecar_of(packet_zip).exists():
        # An already-materialized copy is re-authenticated, never trusted: its bytes
        # must still match its own official sidecar and any manifest expectation.
        return packet_zip, reverify_packet_source(packet_zip, expected_zip_sha256)
    if sidecar_of(cache_zip).is_symlink():
        raise EvidenceError("SIDECAR_SYMLINK_REFUSED", cache_zip.name)
    make_packet_directory(packet_zip.parent)
    zip_record = copy_file_into_packet(cache_zip, packet_zip)
    sidecar_record = copy_file_into_packet(
        sidecar_of(cache_zip), sidecar_of(packet_zip), MAX_SIDECAR_BYTES
    )
    official = parse_official_checksum(load_raw(sidecar_of(packet_zip)), packet_zip.name)
    if official != zip_record["zip_sha256"]:
        raise EvidenceError("OFFICIAL_CHECKSUM_MISMATCH", packet_zip.name)
    if expected_zip_sha256 is not None and expected_zip_sha256 != zip_record["zip_sha256"]:
        raise EvidenceError("MANIFEST_DIGEST_MISMATCH", packet_zip.name)
    if sidecar_record["byte_count"] <= 0:
        raise EvidenceError("SIDECAR_EMPTY", packet_zip.name)
    return packet_zip, cast(str, zip_record["zip_sha256"])


def read_single_zip_member(descriptor: int, detail: str) -> bytes:
    """Read the single CSV member under hard byte bounds from one descriptor.

    The declared ``file_size`` is untrusted: decompression is streamed with a cap
    and the exact length is required, so a lying header cannot smuggle an
    oversized or truncated member into the evidence set.
    """

    os.lseek(descriptor, 0, os.SEEK_SET)
    handle = io.FileIO(descriptor, mode="r", closefd=False)
    try:
        with zipfile.ZipFile(handle) as archive:
            members = [item for item in archive.infolist() if not item.is_dir()]
            if len(members) != 1:
                raise EvidenceError("ZIP_MEMBER_COUNT_INVALID", detail)
            member = members[0]
            if (
                member.flag_bits & 0x1
                or PurePosixPath(member.filename).name != member.filename
                or "\\" in member.filename
                or not member.filename.endswith(".csv")
                or member.file_size <= 0
                or member.file_size > MAX_MEMBER_BYTES
                or (member.external_attr >> 16) & 0o170000 == 0o120000
            ):
                raise EvidenceError("ZIP_MEMBER_INVALID", detail)
            if member.file_size / max(member.compress_size, 1) > MAX_COMPRESSION_RATIO:
                raise EvidenceError("ZIP_COMPRESSION_RATIO_INVALID", detail)
            chunks: list[bytes] = []
            total = 0
            with archive.open(member) as stream:
                while True:
                    chunk = stream.read(READ_CHUNK_BYTES)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > member.file_size:
                        raise EvidenceError("ZIP_MEMBER_OVERRUN", detail)
                    chunks.append(chunk)
            if total != member.file_size:
                raise EvidenceError("ZIP_MEMBER_TRUNCATED", detail)
            return b"".join(chunks)
    except EvidenceError:
        raise
    except (OSError, zipfile.BadZipFile, ValueError, EOFError) as exc:
        raise EvidenceError("ZIP_READ_FAILED", detail) from exc
    finally:
        handle.close()


def open_packet_member(
    packet_zip: Path,
    expected_zip_sha256: str,
    stage: str,
    ledger: OpenedLedger | None,
    packet_root: Path,
) -> bytes:
    """pre_member_open / post_member_open custody around one CSV member read."""

    detail = packet_zip.name
    descriptor = open_regular_readonly(packet_zip)
    try:
        before = os.fstat(descriptor)
        identity = stat_identity(before)
        digest, byte_count = sha256_descriptor(descriptor)
        if digest != expected_zip_sha256:
            raise EvidenceError("PACKET_ZIP_DIGEST_DRIFT_BEFORE_OPEN", detail)
        payload = read_single_zip_member(descriptor, detail)
        if stat_identity(os.fstat(descriptor)) != identity:
            raise EvidenceError("PACKET_ZIP_IDENTITY_DRIFT", detail)
    finally:
        os.close(descriptor)
    verifier = open_regular_readonly(packet_zip)
    try:
        if sha256_descriptor(verifier)[0] != expected_zip_sha256:
            raise EvidenceError("PACKET_ZIP_DIGEST_DRIFT_AFTER_OPEN", detail)
        if stat_identity(os.fstat(verifier)) != identity:
            raise EvidenceError("PACKET_ZIP_IDENTITY_DRIFT_AFTER_OPEN", detail)
    finally:
        os.close(verifier)
    note_member_open()
    if ledger is not None:
        ledger.record(
            packet_zip.relative_to(packet_root).as_posix(), expected_zip_sha256, byte_count, stage
        )
    return payload


def csv_rows(payload: bytes, detail: str) -> list[list[str]]:
    try:
        text = payload.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise EvidenceError("CSV_ENCODING_INVALID", detail) from exc
    rows = [row for row in csv.reader(io.StringIO(text)) if row]
    if not rows:
        raise EvidenceError("CSV_EMPTY", detail)
    return rows


def read_funding_month(payload: bytes, month: str, detail: str) -> tuple[FundingRow, ...]:
    rows = csv_rows(payload, detail)
    if tuple(value.strip() for value in rows[0]) != FUNDING_HEADER:
        raise EvidenceError("FUNDING_HEADER_INVALID", detail)
    start_ms, end_ms = month_bounds_ms(month)
    parsed: list[FundingRow] = []
    for number, row in enumerate(rows[1:], start=2):
        where = f"{detail}:{number}"
        if len(row) != len(FUNDING_HEADER):
            raise EvidenceError("FUNDING_ROW_WIDTH_INVALID", where)
        time_ms = integer_field(row[0], f"{where}:calc_time")
        interval = integer_field(row[1], f"{where}:interval")
        rate = finite_decimal(row[2], f"{where}:last_funding_rate")
        if not start_ms <= time_ms < end_ms:
            raise EvidenceError("FUNDING_TIME_OUT_OF_MONTH", where)
        if not MIN_INTERVAL_HOURS <= interval <= MAX_INTERVAL_HOURS:
            raise EvidenceError("FUNDING_INTERVAL_OUT_OF_RANGE", where)
        if parsed and time_ms <= parsed[-1].time_ms:
            raise EvidenceError("FUNDING_CALC_TIME_NOT_INCREASING", where)
        parsed.append(FundingRow(time_ms, interval, rate))
    if not parsed:
        raise EvidenceError("FUNDING_ROWS_EMPTY", detail)
    return tuple(parsed)


def read_kline_month(
    payload: bytes,
    month: str,
    detail: str,
    strict_quote_token: bool = False,
) -> tuple[Bar, ...]:
    rows = csv_rows(payload, detail)
    header = tuple(value.strip().lower() for value in rows[0])
    data = rows[1:] if header == KLINE_HEADER else rows
    start_ms, end_ms = month_bounds_ms(month)
    parsed: list[Bar] = []
    for number, row in enumerate(data, start=2 if data is not rows else 1):
        where = f"{detail}:{number}"
        if len(row) != len(KLINE_HEADER):
            raise EvidenceError("KLINE_ROW_WIDTH_INVALID", where)
        open_ms = integer_field(row[0], f"{where}:open_time")
        close_ms = integer_field(row[6], f"{where}:close_time")
        open_price = finite_decimal(row[1], f"{where}:open")
        high = finite_decimal(row[2], f"{where}:high")
        low = finite_decimal(row[3], f"{where}:low")
        close = finite_decimal(row[4], f"{where}:close")
        quote_token = row[7].strip()
        if strict_quote_token:
            unsigned_decimal_token(quote_token, f"{where}:quote_volume")
        quote = finite_decimal(quote_token, f"{where}:quote_volume")
        if not start_ms <= open_ms < end_ms or open_ms % HOUR_MS != 0:
            raise EvidenceError("KLINE_OPEN_TIME_INVALID", where)
        if not open_ms <= close_ms < open_ms + HOUR_MS:
            raise EvidenceError("KLINE_CLOSE_TIME_INVALID", where)
        if min(open_price, high, low, close) <= 0:
            raise EvidenceError("KLINE_PRICE_NONPOSITIVE", where)
        if high < max(open_price, close, low) or low > min(open_price, close, high):
            raise EvidenceError("KLINE_RANGE_INCONSISTENT", where)
        if quote < 0:
            raise EvidenceError("KLINE_QUOTE_VOLUME_NEGATIVE", where)
        if parsed and open_ms <= parsed[-1].open_time_ms:
            raise EvidenceError("KLINE_OPEN_TIME_NOT_INCREASING", where)
        parsed.append(Bar(open_ms, open_price, close_ms, quote, quote_token))
    if not parsed:
        raise EvidenceError("KLINE_ROWS_EMPTY", detail)
    return tuple(parsed)


def june_expected_settlements() -> tuple[int, ...]:
    days = (SCREEN_END_MS - SCREEN_START_MS) // DAY_MS
    return tuple(
        SCREEN_START_MS + day * DAY_MS + hour * HOUR_MS
        for day in range(days)
        for hour in JUNE_SETTLEMENT_HOURS
    )


def june_expected_hours() -> tuple[int, ...]:
    return tuple(range(SCREEN_START_MS, SCREEN_END_MS, HOUR_MS))


def validate_june_funding(rows: Sequence[FundingRow], symbol: str) -> None:
    """June admission: exactly 90 stable 8h settlements at the expected marks."""

    expected = june_expected_settlements()
    if len(rows) != JUNE_FUNDING_ROWS or len(expected) != JUNE_FUNDING_ROWS:
        raise EvidenceError("JUNE_FUNDING_ROW_COUNT", symbol)
    for row, target in zip(rows, expected, strict=True):
        if abs(row.time_ms - target) > GAP_TOLERANCE_MS:
            raise EvidenceError("JUNE_FUNDING_SETTLEMENT_OFF_GRID", symbol)
        if row.interval_hours != STABLE_INTERVAL_HOURS:
            raise EvidenceError("JUNE_FUNDING_INTERVAL_NOT_8", symbol)
    for earlier, later in itertools.pairwise(rows):
        if abs((later.time_ms - earlier.time_ms) - STABLE_INTERVAL_HOURS * HOUR_MS) > (
            GAP_TOLERANCE_MS
        ):
            raise EvidenceError("JUNE_FUNDING_GAP_INVALID", symbol)


def validate_june_hours(bars: Sequence[Bar], symbol: str, dataset: str) -> None:
    expected = june_expected_hours()
    if len(bars) != JUNE_HOURLY_ROWS or len(expected) != JUNE_HOURLY_ROWS:
        raise EvidenceError("JUNE_HOURLY_ROW_COUNT", f"{symbol}:{dataset}")
    if tuple(bar.open_time_ms for bar in bars) != expected:
        raise EvidenceError("JUNE_HOURLY_GRID_INVALID", f"{symbol}:{dataset}")


def june_candidate_symbols(cache_root: Path) -> tuple[str, ...]:
    """Enumerate the candidate set from present June-2025 fundingRate paths only.

    Enumeration deliberately ignores the adjacent sidecar.  A symbol whose June
    ZIP exists but whose ``.CHECKSUM`` is absent must reach the post-marker
    ledger and be recorded there as ineligible with a reason; excluding it during
    pre-marker enumeration would drop it silently and leave no evidence that it
    was ever considered.  No later-month path, value, or metadata participates,
    and directory enumeration is not a member open.
    """

    funding_root = cache_root / Path(*(ARCHIVE_PREFIX / "fundingRate").parts)
    if not funding_root.is_dir() or funding_root.is_symlink():
        raise ContractError("FUNDING_ROOT_UNAVAILABLE", str(funding_root))
    found: list[str] = []
    for entry in sorted(funding_root.iterdir(), key=lambda item: item.name):
        symbol = entry.name
        if not entry.is_dir() or entry.is_symlink() or SYMBOL_RE.fullmatch(symbol) is None:
            continue
        june = cache_root / Path(*archive_relative_path("fundingRate", symbol, "2025-06").parts)
        if june.is_file() and not june.is_symlink():
            found.append(symbol)
    return tuple(found)


def screen_one_symbol(
    cache_root: Path,
    packet_root: Path,
    symbol: str,
) -> dict[str, Any]:
    """Apply the three June validations; returns the admission evidence row."""

    month = SCREEN_MONTHS[0]
    evidence: dict[str, Any] = {}
    payloads: dict[str, bytes] = {}
    for dataset in DATASETS:
        packet_zip, digest = materialize_packet_source(
            cache_root, packet_root, dataset, symbol, month, None
        )
        payloads[dataset] = open_packet_member(packet_zip, digest, "screen", None, packet_root)
        evidence[PLAN_DATASET_NAMES[dataset]] = digest
    funding = read_funding_month(payloads["fundingRate"], month, f"{symbol}:fundingRate")
    validate_june_funding(funding, symbol)
    contract = read_kline_month(
        payloads["klines_1h"], month, f"{symbol}:klines", strict_quote_token=True
    )
    validate_june_hours(contract, symbol, "klines/1h")
    mark = read_kline_month(payloads["markPriceKlines_1h"], month, f"{symbol}:markPriceKlines")
    validate_june_hours(mark, symbol, "markPriceKlines/1h")
    # Every one of the 720 original contract-hour tokens enters the ranking sum.
    total = exact_token_total(
        [bar.quote_volume_token for bar in contract], f"{symbol}:june_quote_volume"
    )
    if len(contract) != JUNE_HOURLY_ROWS:
        raise EvidenceError("JUNE_HOURLY_ROW_COUNT", f"{symbol}:klines/1h")
    return {
        "eligibility": "ELIGIBLE",
        "june_contract_quote_volume_total": total.canonical,
        "june_funding_rows": len(funding),
        "june_hourly_rows": len(contract),
        "june_zip_sha256_by_dataset": evidence,
        "reason_code": None,
        "symbol": symbol,
    }


def screen_source_bindings(packet_root: Path, symbol: str) -> list[dict[str, Any]]:
    """Bind every completed June ZIP/sidecar materialized for one attempt."""

    found: list[dict[str, Any]] = []
    for dataset in DATASETS:
        relative = archive_relative_path(dataset, symbol, SCREEN_MONTHS[0])
        for packet_path in (
            packet_root / "sources" / Path(*relative.parts),
            sidecar_of(packet_root / "sources" / Path(*relative.parts)),
        ):
            if not packet_path.exists():
                continue
            require_completed_artifact(packet_path)
            raw = load_raw(packet_path)
            found.append(
                {
                    "byte_count": len(raw),
                    "raw_sha256": sha256_bytes(raw),
                    "relative_path": packet_path.relative_to(packet_root).as_posix(),
                }
            )
    return sorted(found, key=lambda row: str(row["relative_path"]).encode("utf-8"))


def run_screen_ledger(
    cache_root: Path,
    packet_root: Path,
    symbols: Sequence[str],
) -> tuple[list[dict[str, Any]], tuple[str, ...]]:
    """June-only eligibility, exact volume ranking, and the frozen rank cutoff.

    Every enumerated candidate lands in the ledger.  An ineligible candidate keeps
    a reason code and no rank; every eligible symbol carries its canonical exact
    total, a one-based rank, and exactly SELECTED or REJECTED_BY_RANK.  Ranking is
    descending exact numeric total, then ascending raw ASCII symbol bytes.
    """

    ledger: list[dict[str, Any]] = []
    eligible: list[dict[str, Any]] = []
    for symbol in symbols:
        before = MEMBER_OPEN_COUNTS["screen"]
        try:
            row = screen_one_symbol(cache_root, packet_root, symbol)
        except EvidenceError as exc:
            ledger.append(
                {
                    "eligibility": "INELIGIBLE",
                    "june_member_open_count": MEMBER_OPEN_COUNTS["screen"] - before,
                    "reason_code": exc.code,
                    "selection_status": None,
                    "source_bindings": screen_source_bindings(packet_root, symbol),
                    "symbol": symbol,
                }
            )
            continue
        row["june_member_open_count"] = MEMBER_OPEN_COUNTS["screen"] - before
        row["source_bindings"] = screen_source_bindings(packet_root, symbol)
        eligible.append(row)
        ledger.append(row)

    ordered = sorted(
        eligible,
        key=lambda item: (
            -Decimal(str(item["june_contract_quote_volume_total"])),
            str(item["symbol"]).encode("ascii"),
        ),
    )
    cutoff = min(RANK_CUTOFF_N, len(ordered))
    selected: list[str] = []
    for position, row in enumerate(ordered, start=1):
        row["rank"] = position
        if position <= cutoff:
            row["selection_status"] = "SELECTED"
            selected.append(str(row["symbol"]))
        else:
            row["selection_status"] = "REJECTED_BY_RANK"
    for row in ledger:
        if row["eligibility"] == "ELIGIBLE" and "rank" not in row:
            raise ContractError("SCREEN_RANK_MISSING", str(row["symbol"]))
        if row["eligibility"] == "INELIGIBLE":
            row["rank"] = None
            row["june_contract_quote_volume_total"] = None
    if len(selected) != cutoff:
        raise ContractError("SCREEN_SELECTION_COUNT_INVALID", str(len(selected)))
    return ledger, tuple(selected)


ELIGIBLE_LEDGER_FIELDS: Final = (
    "eligibility",
    "june_contract_quote_volume_total",
    "june_funding_rows",
    "june_hourly_rows",
    "june_member_open_count",
    "june_zip_sha256_by_dataset",
    "rank",
    "reason_code",
    "selection_status",
    "source_bindings",
    "symbol",
)
INELIGIBLE_LEDGER_FIELDS: Final = (
    "eligibility",
    "june_contract_quote_volume_total",
    "june_member_open_count",
    "rank",
    "reason_code",
    "selection_status",
    "source_bindings",
    "symbol",
)


def validate_screen_ledger(
    ledger: Sequence[Mapping[str, Any]],
    selected: Sequence[str],
    candidate_count: int,
    eligible_count: int,
) -> None:
    """Exact-set validation of the June ledger, its ranking, and the frozen cutoff."""

    if len(ledger) != candidate_count:
        raise ContractError("SCREEN_LEDGER_CANDIDATE_COUNT_INVALID", str(len(ledger)))
    symbols = [str(row["symbol"]) for row in ledger]
    if len(set(symbols)) != len(symbols):
        raise ContractError("SCREEN_LEDGER_DUPLICATE_SYMBOL")
    ranked: list[tuple[int, Decimal, bytes, str]] = []
    for row in ledger:
        eligibility = row.get("eligibility")
        if eligibility not in ELIGIBILITY_STATES:
            raise ContractError("SCREEN_LEDGER_ELIGIBILITY_INVALID", str(row.get("symbol")))
        expected = (
            ELIGIBLE_LEDGER_FIELDS if eligibility == "ELIGIBLE" else INELIGIBLE_LEDGER_FIELDS
        )
        if tuple(sorted(row)) != expected:
            raise ContractError("SCREEN_LEDGER_FIELD_SET_INVALID", str(row.get("symbol")))
        if eligibility == "INELIGIBLE":
            if not isinstance(row.get("reason_code"), str) or not row["reason_code"]:
                raise ContractError("SCREEN_LEDGER_REASON_MISSING", str(row.get("symbol")))
            if row.get("rank") is not None or row.get("selection_status") is not None:
                raise ContractError("SCREEN_LEDGER_INELIGIBLE_RANKED", str(row.get("symbol")))
            if row.get("june_contract_quote_volume_total") is not None:
                raise ContractError("SCREEN_LEDGER_INELIGIBLE_TOTAL", str(row.get("symbol")))
            continue
        if row.get("reason_code") is not None:
            raise ContractError("SCREEN_LEDGER_ELIGIBLE_HAS_REASON", str(row.get("symbol")))
        if row.get("selection_status") not in SELECTION_STATES:
            raise ContractError("SCREEN_LEDGER_SELECTION_INVALID", str(row.get("symbol")))
        total = row.get("june_contract_quote_volume_total")
        if not isinstance(total, str) or UNSIGNED_DECIMAL_TOKEN_RE.fullmatch(total) is None:
            raise ContractError("SCREEN_LEDGER_TOTAL_NOT_CANONICAL", str(row.get("symbol")))
        if total != ExactTotal(int(total.replace(".", "")), len(total.partition(".")[2])).canonical:
            raise ContractError("SCREEN_LEDGER_TOTAL_NOT_CANONICAL", str(row.get("symbol")))
        rank = row.get("rank")
        if not isinstance(rank, int) or isinstance(rank, bool) or not 1 <= rank <= eligible_count:
            raise ContractError("SCREEN_LEDGER_RANK_OUT_OF_RANGE", str(row.get("symbol")))
        ranked.append((rank, Decimal(total), str(row["symbol"]).encode("ascii"),
                       str(row["selection_status"])))
    if len(ranked) != eligible_count:
        raise ContractError("SCREEN_LEDGER_ELIGIBLE_COUNT_INVALID", str(len(ranked)))
    if sorted(rank for rank, _t, _s, _st in ranked) != list(range(1, eligible_count + 1)):
        raise ContractError("SCREEN_LEDGER_RANKS_NOT_CONTIGUOUS")
    ranked.sort(key=lambda item: item[0])
    for earlier, later in itertools.pairwise(ranked):
        if (-earlier[1], earlier[2]) >= (-later[1], later[2]):
            raise ContractError("SCREEN_LEDGER_RANK_ORDER_INVALID", str(later[0]))
    cutoff = min(RANK_CUTOFF_N, eligible_count)
    for rank, _total, _symbol, status in ranked:
        expected_status = "SELECTED" if rank <= cutoff else "REJECTED_BY_RANK"
        if status != expected_status:
            raise ContractError("SCREEN_LEDGER_SELECTION_MISMATCH", str(rank))
    expected_selected = [
        symbol.decode("ascii") for rank, _t, symbol, _st in ranked if rank <= cutoff
    ]
    if sorted(selected) != sorted(expected_selected):
        raise ContractError("SCREEN_SELECTED_UNIVERSE_MISMATCH")


def exposed_relative_paths(plan: Mapping[str, Any]) -> frozenset[str]:
    """The disclosed HEADER_ONLY_SCHEMA_EXPOSED archive members."""

    holdout = cast(
        Mapping[str, Any], cast(Mapping[str, Any], plan["partition_custody"])["holdout"]
    )
    paths: set[str] = set()
    for entry in _tuple_of(holdout.get("header_only_schema_exposed")):
        suffix = str(entry).split(":", 1)[0].strip()
        if not suffix:
            raise ContractError("EXPOSURE_ENTRY_INVALID", str(entry))
        paths.add((ARCHIVE_PREFIX / suffix).as_posix())
    return frozenset(paths)


def inventory_member_state(month: str, relative: str, exposed: frozenset[str]) -> str:
    if month in SCREEN_MONTHS:
        return "SCREEN_OPENED_ONCE"
    if month in DEVELOPMENT_MONTHS:
        return "DEVELOPMENT_UNOPENED_AT_INVENTORY"
    if relative in exposed:
        return "HEADER_ONLY_SCHEMA_EXPOSED"
    return "SEALED_UNOPENED"


def build_source_inventory(
    cache_root: Path,
    universe: Sequence[str],
    exposed: frozenset[str],
) -> list[dict[str, Any]]:
    """Exhaustive compressed inventory; absence never changes membership.

    Compressed bytes are hashed only.  No development or holdout CSV member is
    decompressed here, so the seal is intact when the manifest is written.
    """

    entries: list[dict[str, Any]] = []
    for symbol in universe:
        for month in ALL_MONTHS:
            for dataset in DATASETS:
                relative = archive_relative_path(dataset, symbol, month).as_posix()
                cache_zip = cache_root / Path(*archive_relative_path(dataset, symbol, month).parts)
                sidecar = sidecar_of(cache_zip)
                present = (
                    cache_zip.is_file()
                    and not cache_zip.is_symlink()
                    and sidecar.is_file()
                    and not sidecar.is_symlink()
                )
                row: dict[str, Any] = {
                    "byte_count": None,
                    "cache_sidecar_sha256": None,
                    "cache_stat_identity": None,
                    "cache_zip_sha256": None,
                    "dataset": PLAN_DATASET_NAMES[dataset],
                    "inventory_state": "PRESENT" if present else "MISSING",
                    "member_state": (
                        inventory_member_state(month, relative, exposed)
                        if present
                        else "ABSENT_AT_INVENTORY"
                    ),
                    "month": month,
                    "official_zip_sha256": None,
                    "prior_schema_exposure": relative in exposed,
                    "relative_path": relative,
                    "source_url": source_url(dataset, symbol, month),
                    "symbol": symbol,
                }
                if present:
                    info = os.stat(cache_zip, follow_symlinks=False)
                    sidecar_raw = load_raw(sidecar)
                    cache_digest = sha256_path(cache_zip)
                    official_digest = parse_official_checksum(sidecar_raw, cache_zip.name)
                    # Hash validation is part of the source freeze, including
                    # compressed members that will remain holdout-sealed.  Deferring
                    # this check until a later open would permit invalid provenance
                    # to survive a development NO_GO terminal branch.
                    if official_digest != cache_digest:
                        raise EvidenceError(
                            "INVENTORY_OFFICIAL_CHECKSUM_MISMATCH",
                            relative,
                        )
                    row.update(
                        {
                            "byte_count": info.st_size,
                            "cache_sidecar_sha256": sha256_bytes(sidecar_raw),
                            "cache_stat_identity": stat_identity(info),
                            "cache_zip_sha256": cache_digest,
                            "official_zip_sha256": official_digest,
                        }
                    )
                entries.append(row)
    return entries


def manifest_index(
    manifest: Mapping[str, Any],
) -> dict[tuple[str, str, str], Mapping[str, Any]]:
    rows = manifest.get("entries")
    if not isinstance(rows, list):
        raise ContractError("MANIFEST_ENTRIES_INVALID")
    index: dict[tuple[str, str, str], Mapping[str, Any]] = {}
    for row in cast(list[Any], rows):
        if not isinstance(row, dict):
            raise ContractError("MANIFEST_ENTRY_INVALID")
        # Exact field set: an extra or absent manifest field is a contract failure,
        # never a silently tolerated shape.
        if tuple(sorted(row)) != MANIFEST_FIELDS:
            raise ContractError("MANIFEST_FIELD_SET_INVALID", str(row.get("relative_path")))
        state = row.get("inventory_state")
        if state not in ("PRESENT", "MISSING"):
            raise ContractError("MANIFEST_INVENTORY_STATE_INVALID", str(row.get("relative_path")))
        digest_fields = ("cache_zip_sha256", "cache_sidecar_sha256", "official_zip_sha256")
        if state == "PRESENT":
            for name in digest_fields:
                value = row.get(name)
                if not isinstance(value, str) or SHA256_RE.fullmatch(value) is None:
                    raise ContractError("MANIFEST_DIGEST_INVALID", f"{row.get('relative_path')}"
                                                                   f":{name}")
        elif any(row.get(name) is not None for name in digest_fields):
            raise ContractError("MANIFEST_ABSENT_ENTRY_HAS_DIGEST", str(row.get("relative_path")))
        key = (str(row.get("symbol")), str(row.get("month")), str(row.get("dataset")))
        if key in index:
            raise ContractError("MANIFEST_DUPLICATE_ENTRY", ":".join(key))
        index[key] = row
    expected = manifest.get("expected_entry_count")
    if isinstance(expected, int) and not isinstance(expected, bool) and len(index) != expected:
        raise ContractError("MANIFEST_ENTRY_COUNT_INVALID", str(len(index)))
    return index


def required_manifest_entry(
    index: Mapping[tuple[str, str, str], Mapping[str, Any]],
    dataset: str,
    symbol: str,
    month: str,
) -> Mapping[str, Any]:
    """A required member that the inventory recorded absent is invalid evidence.

    It is never removed from the universe, replaced, or turned into cash.
    """

    detail = f"{symbol}:{month}:{PLAN_DATASET_NAMES[dataset]}"
    entry = index.get((symbol, month, PLAN_DATASET_NAMES[dataset]))
    if entry is None:
        raise EvidenceError("REQUIRED_MEMBER_UNMANIFESTED", detail)
    if entry.get("inventory_state") != "PRESENT":
        raise EvidenceError("REQUIRED_MEMBER_ABSENT", detail)
    digest = entry.get("cache_zip_sha256")
    if not isinstance(digest, str) or SHA256_RE.fullmatch(digest) is None:
        raise EvidenceError("REQUIRED_MEMBER_DIGEST_INVALID", detail)
    if entry.get("official_zip_sha256") != digest:
        raise EvidenceError("REQUIRED_MEMBER_OFFICIAL_MISMATCH", detail)
    return entry


def load_partition_member(
    cache_root: Path,
    packet_root: Path,
    index: Mapping[tuple[str, str, str], Mapping[str, Any]],
    dataset: str,
    symbol: str,
    month: str,
    stage: str,
    ledger: OpenedLedger,
) -> bytes:
    entry = required_manifest_entry(index, dataset, symbol, month)
    expected = cast(str, entry["cache_zip_sha256"])
    packet_zip, digest = materialize_packet_source(
        cache_root, packet_root, dataset, symbol, month, expected
    )
    if digest != expected:
        raise EvidenceError("PACKET_COPY_DIGEST_MISMATCH", packet_zip.name)
    return open_packet_member(packet_zip, expected, stage, ledger, packet_root)


SCHEMA_BY_RELATIVE: Final = {
    "preseal.v1.json": f"{SCHEMA_PREFIX}.preseal.v1",
    "screen_consumed.v1.json": f"{SCHEMA_PREFIX}.screen_consumed.v1",
    "screen_universe.v1.json": f"{SCHEMA_PREFIX}.screen_universe.v1",
    "source_manifest.v1.json": f"{SCHEMA_PREFIX}.source_manifest.v1",
    "freeze.v1.json": f"{SCHEMA_PREFIX}.freeze.v1",
    "run_consumed.v1.json": f"{SCHEMA_PREFIX}.run_consumed.v1",
    "event_universe.v1.json": f"{SCHEMA_PREFIX}.event_universe.v1",
    "opened_source_ledger.v1.json": f"{SCHEMA_PREFIX}.opened_source_ledger.v1",
    "development.v1.json": f"{SCHEMA_PREFIX}.development.v1",
    "candidate_seal.v1.json": f"{SCHEMA_PREFIX}.candidate_seal.v1",
    "holdout_open.v1.json": f"{SCHEMA_PREFIX}.holdout_open.v1",
    "holdout.v1.json": f"{SCHEMA_PREFIX}.holdout.v1",
    "result.v1.json": f"{SCHEMA_PREFIX}.result.v1",
}
FROZEN_CHAIN: Final = (
    ("preseal.v1.json", None),
    ("screen_consumed.v1.json", "preseal.v1.json"),
    ("screen_universe.v1.json", "screen_consumed.v1.json"),
    ("source_manifest.v1.json", "screen_universe.v1.json"),
    ("freeze.v1.json", "source_manifest.v1.json"),
)
RUN_CHAIN: Final = (
    ("run_consumed.v1.json", "freeze.v1.json"),
    ("event_universe.v1.json", "run_consumed.v1.json"),
    ("opened_source_ledger.v1.json", "event_universe.v1.json"),
    ("development.v1.json", "opened_source_ledger.v1.json"),
    ("candidate_seal.v1.json", "development.v1.json"),
    ("holdout_open.v1.json", "candidate_seal.v1.json"),
    ("holdout.v1.json", "holdout_open.v1.json"),
)


def preseal(packet_root: Path, protocol_dir: Path) -> dict[str, Any]:
    """Bind exact Git lineage and copy every static file into a fresh packet."""

    repo = require_worktree_runtime()
    if protocol_dir.resolve() != HERE:
        raise ContractError("PROTOCOL_DIR_MISMATCH", str(protocol_dir))
    protocol, plan, _ledger = validate_static_set(HERE)
    lineage = git_static_lineage(repo)
    cache_root = cache_root_from_plan(plan)
    attestation = cache_manifest_attestation(plan)

    root = create_packet_root(packet_root)
    require_disjoint_trees(cache_root, root)
    static_dir = root / Path(*PACKET_STATIC_ROOT.parts)
    make_packet_directory(static_dir)

    files: list[dict[str, Any]] = []
    for row in cast(list[dict[str, Any]], lineage["static_files"]):
        repository_path = str(row["repository_relative_path"])
        name = PurePosixPath(repository_path).name
        destination = static_dir / name
        record = copy_file_into_packet(repo / repository_path, destination, MAX_ZIP_BYTES)
        if record["zip_sha256"] != row["raw_sha256"]:
            raise ContractError("STATIC_COPY_DIGEST_MISMATCH", repository_path)
        files.append(
            {
                **row,
                "packet_copy_raw_sha256": record["zip_sha256"],
                "packet_copy_relative_path": (PACKET_STATIC_ROOT / name).as_posix(),
            }
        )

    protocol_raw_sha256 = next(
        str(row["raw_sha256"])
        for row in files
        if row["repository_relative_path"] == "quant/research/s1t/protocol.v1.json"
    )
    document = {
        "allowed_screen_count": 1,
        "cache_manifest_attestation": attestation,
        "cache_root": str(cache_root),
        "canonical_base_commit": CANONICAL_BASE,
        "created_at": utc_now(),
        "engine_network_access": False,
        "n3_family_key": f"POST_SMETA1::{STRATEGY_ID}::{protocol_raw_sha256}",
        "packet_identity": packet_identity(root),
        "packet_root": str(root),
        "policy": "CREATED_BEFORE_ANY_SCREEN_MEMBER_OPEN",
        "producer_first_parent_commit": lineage["producer_first_parent_commit"],
        "producer_is_canonical_base": False,
        "protocol_id": PROTOCOL_ID,
        "protocol_raw_sha256": protocol_raw_sha256,
        "research_question": cast(str, protocol["research_question"]),
        "schema": SCHEMA_BY_RELATIVE["preseal.v1.json"],
        "static_files": sorted(files, key=lambda item: str(item["repository_relative_path"])),
        "static_producer_commit": lineage["static_producer_commit"],
        "static_producer_tree": lineage["static_producer_tree"],
        "strategy_id": STRATEGY_ID,
        "worktree_clean": True,
    }
    write_artifact(root, "preseal.v1.json", document)
    return document


def bind_packet_stage(packet_root: Path) -> tuple[Path, dict[str, Any], Mapping[str, Any],
                                                  Mapping[str, Any], Path]:
    """Common entry for screen, run and verify: authenticate the packet runtime."""

    root = resolve_packet_root(packet_root)
    require_directory(root, "PACKET_ROOT_INVALID")
    presealed, _digest = load_artifact(
        root, "preseal.v1.json", SCHEMA_BY_RELATIVE["preseal.v1.json"]
    )
    if presealed.get("packet_identity") != packet_identity(root):
        raise ContractError("PACKET_IDENTITY_DRIFT", str(root))
    if presealed.get("packet_root") != str(root):
        raise ContractError("PACKET_ROOT_DRIFT", str(root))
    require_packet_runtime(root, presealed)
    require_static_copies(root, presealed)
    static_dir = root / Path(*PACKET_STATIC_ROOT.parts)
    protocol, plan, _ledger = validate_static_set(static_dir)
    if presealed.get("protocol_raw_sha256") != sha256_path(static_dir / "protocol.v1.json"):
        raise ContractError("PROTOCOL_DIGEST_DRIFT")
    cache_root = cache_root_from_plan(plan)
    if presealed.get("cache_root") != str(cache_root):
        raise ContractError("CACHE_ROOT_DRIFT", str(cache_root))
    require_disjoint_trees(cache_root, root)
    return root, presealed, protocol, plan, cache_root


def screen(packet_root: Path) -> dict[str, Any]:
    """June-only membership: marker first, then the fixed universe and inventory."""

    root, presealed, protocol, plan, cache_root = bind_packet_stage(packet_root)
    exposed = sorted(exposed_relative_paths(plan))
    candidates = june_candidate_symbols(cache_root)
    marker = {
        "allowed_screen_count": 1,
        "created_at": utc_now(),
        "june_candidate_path_count": len(candidates),
        "marker_created_before_first_june_member": True,
        "schema": SCHEMA_BY_RELATIVE["screen_consumed.v1.json"],
        "screen_archive_member_open_count_before": 0,
        "screen_month": SCREEN_MONTHS[0],
        "screen_ordinal": 1,
        **predecessor_record(root, "screen_consumed.v1.json", "preseal.v1.json"),
    }
    write_artifact(root, "screen_consumed.v1.json", marker)
    set_member_open_stage("screen")
    completed = ["preseal.v1.json", "screen_consumed.v1.json"]
    try:
        return screen_after_marker(root, presealed, cache_root, candidates, exposed, completed)
    except (EvidenceError, ContractError) as exc:
        # screen_consumed.v1.json remains consumed: bind the screen marker and the
        # last completed screen artifact, and terminate UNMEASURED.
        result = unmeasured_result(
            root, presealed, "screen", exc.code, completed[-1], completed, exposed
        )
        require_result_semantics(result, protocol)
        finalize_packet(root, result)
        return result


def screen_after_marker(
    root: Path,
    presealed: Mapping[str, Any],
    cache_root: Path,
    candidates: Sequence[str],
    exposed: Sequence[str],
    completed: list[str],
) -> dict[str, Any]:
    """Everything the screen does after its marker is durably consumed."""

    ledger, ranked_universe = run_screen_ledger(cache_root, root, candidates)
    reconciled = sum(int(row["june_member_open_count"]) for row in ledger)
    if MEMBER_OPEN_COUNTS["screen"] != reconciled:
        raise ContractError("SCREEN_MEMBER_OPEN_RECONCILIATION_INVALID")
    eligible_count = sum(1 for row in ledger if row["eligibility"] == "ELIGIBLE")
    validate_screen_ledger(ledger, ranked_universe, len(candidates), eligible_count)
    universe = tuple(sorted(ranked_universe))
    universe_document = {
        "candidate_count": len(candidates),
        "created_at": utc_now(),
        "eligible_count": eligible_count,
        "fixed_universe": list(universe),
        "ineligible_count": len(ledger) - eligible_count,
        "june_only_admission": True,
        "later_month_availability_used": False,
        "outcome_scoring": False,
        "rank_cutoff_n": RANK_CUTOFF_N,
        "ranking_order": "exact_quote_volume_total_desc_then_ascii_symbol_asc",
        "rejected_by_rank_count": eligible_count - len(universe),
        "schema": SCHEMA_BY_RELATIVE["screen_universe.v1.json"],
        "screen_archive_member_open_count": MEMBER_OPEN_COUNTS["screen"],
        "screen_ledger": ledger,
        "screen_month": SCREEN_MONTHS[0],
        "selected_count": len(universe),
        "selection_rule": "first min(100, eligible_count); never padded, never replaced",
        "status": "FROZEN" if universe else "INVALID_EVIDENCE",
        "tested_rank_cutoffs": list(TESTED_RANK_CUTOFFS),
        **predecessor_record(root, "screen_universe.v1.json", "screen_consumed.v1.json"),
    }
    write_artifact(root, "screen_universe.v1.json", universe_document)
    completed.append("screen_universe.v1.json")
    if not universe:
        raise EvidenceError("FIXED_UNIVERSE_EMPTY")

    entries = build_source_inventory(cache_root, universe, frozenset(exposed))
    present = sum(1 for row in entries if row["inventory_state"] == "PRESENT")
    manifest = {
        "created_at": utc_now(),
        "development_archive_member_open_count": 0,
        "entries": entries,
        "entry_count": len(entries),
        "expected_entry_count": len(universe) * len(ALL_MONTHS) * len(DATASETS),
        "header_only_schema_exposed": sorted(exposed),
        "holdout_archive_member_open_count": 0,
        "holdout_outcome_rows_opened_before_gates": 0,
        "inventory_absence_changes_membership": False,
        "missing_count": len(entries) - present,
        "packet_source_prefix": "sources",
        "present_count": present,
        "remote_revision_equality_claim": False,
        "schema": SCHEMA_BY_RELATIVE["source_manifest.v1.json"],
        "universe_symbol_count": len(universe),
        **predecessor_record(root, "source_manifest.v1.json", "screen_universe.v1.json"),
    }
    write_artifact(root, "source_manifest.v1.json", manifest)
    completed.append("source_manifest.v1.json")

    frozen = {
        "allowed_run_count": 1,
        "canonical_base_commit": CANONICAL_BASE,
        "created_at": utc_now(),
        "development_archive_member_open_count": 0,
        "header_only_schema_exposed": sorted(exposed),
        "holdout_archive_member_open_count": 0,
        "schema": SCHEMA_BY_RELATIVE["freeze.v1.json"],
        "static_producer_commit": presealed["static_producer_commit"],
        "static_producer_tree": presealed["static_producer_tree"],
        "universe_symbol_count": len(universe),
        **predecessor_record(root, "freeze.v1.json", "source_manifest.v1.json"),
    }
    write_artifact(root, "freeze.v1.json", frozen)
    completed.append("freeze.v1.json")
    return universe_document


def revalidate_frozen_chain(packet_root: Path) -> dict[str, dict[str, Any]]:
    """Re-walk the directed preseal->freeze chain immediately before the run open.

    Every link, every artifact's canonical byte form, and every bound static byte
    is re-authenticated here, so the irreversible development open cannot proceed
    on a chain that drifted after the screen.
    """

    artifacts: dict[str, dict[str, Any]] = {}
    for relative, expected_predecessor in FROZEN_CHAIN:
        artifact, _digest = load_artifact(packet_root, relative, SCHEMA_BY_RELATIVE[relative])
        if expected_predecessor is not None:
            require_predecessor(packet_root, artifact, relative, expected_predecessor)
        artifacts[relative] = artifact
    presealed = artifacts["preseal.v1.json"]
    require_static_copies(packet_root, presealed)
    require_packet_runtime(packet_root, presealed)
    if presealed.get("packet_identity") != packet_identity(packet_root):
        raise ContractError("PACKET_IDENTITY_DRIFT", str(packet_root))
    frozen = artifacts["freeze.v1.json"]
    if frozen.get("static_producer_commit") != presealed.get("static_producer_commit"):
        raise ContractError("FREEZE_PRODUCER_DRIFT")
    if frozen.get("static_producer_tree") != presealed.get("static_producer_tree"):
        raise ContractError("FREEZE_TREE_DRIFT")
    universe = artifacts["screen_universe.v1.json"]
    if universe.get("status") != "FROZEN":
        raise ContractError("SCREEN_UNIVERSE_NOT_FROZEN")
    if universe.get("rank_cutoff_n") != RANK_CUTOFF_N:
        raise ContractError("SCREEN_UNIVERSE_RANK_CUTOFF_DRIFT")
    if _tuple_of(universe.get("tested_rank_cutoffs")) != TESTED_RANK_CUTOFFS:
        raise ContractError("SCREEN_UNIVERSE_ALTERNATE_CUTOFF")
    selected = _tuple_of(universe.get("fixed_universe"))
    eligible_count = universe.get("eligible_count")
    if not isinstance(eligible_count, int) or isinstance(eligible_count, bool):
        raise ContractError("SCREEN_UNIVERSE_ELIGIBLE_COUNT_INVALID")
    if len(selected) != min(RANK_CUTOFF_N, eligible_count):
        raise ContractError("SCREEN_UNIVERSE_SELECTION_COUNT_DRIFT", str(len(selected)))
    ledger = universe.get("screen_ledger")
    if not isinstance(ledger, list):
        raise ContractError("SCREEN_LEDGER_MISSING")
    validate_screen_ledger(
        cast(list[Mapping[str, Any]], ledger),
        [str(symbol) for symbol in selected],
        int(cast(int, universe.get("candidate_count"))),
        eligible_count,
    )
    return artifacts


def revalidate_chain_through(packet_root: Path, through: str) -> dict[str, dict[str, Any]]:
    """Re-authenticate the frozen chain plus the run chain up to ``through``.

    Called before every irreversible open and again in verify, so no stage acts on
    a predecessor that drifted after it was written.
    """

    artifacts = revalidate_frozen_chain(packet_root)
    reached = False
    for relative, predecessor in RUN_CHAIN:
        artifact, _digest = load_artifact(packet_root, relative, SCHEMA_BY_RELATIVE[relative])
        require_predecessor(packet_root, artifact, relative, predecessor)
        artifacts[relative] = artifact
        if relative == through:
            reached = True
            break
    if not reached:
        raise ContractError("RUN_CHAIN_TARGET_NOT_REACHED", through)
    return artifacts


def revalidate_terminal_prefix(
    packet_root: Path, through: str
) -> dict[str, dict[str, Any]]:
    """Authenticate a terminal prefix without requiring a never-reached freeze."""

    frozen_names = tuple(relative for relative, _predecessor in FROZEN_CHAIN)
    if through not in frozen_names:
        return revalidate_chain_through(packet_root, through)
    artifacts: dict[str, dict[str, Any]] = {}
    reached = False
    for relative, predecessor in FROZEN_CHAIN:
        artifact, _digest = load_artifact(
            packet_root, relative, SCHEMA_BY_RELATIVE[relative]
        )
        if predecessor is not None:
            require_predecessor(packet_root, artifact, relative, predecessor)
        artifacts[relative] = artifact
        if relative == through:
            reached = True
            break
    if not reached:
        raise ContractError("TERMINAL_CHAIN_TARGET_NOT_REACHED", through)
    presealed = artifacts["preseal.v1.json"]
    require_static_copies(packet_root, presealed)
    require_packet_runtime(packet_root, presealed)
    if presealed.get("packet_identity") != packet_identity(packet_root):
        raise ContractError("PACKET_IDENTITY_DRIFT", str(packet_root))
    return artifacts


def merge_funding_months(
    chunks: Sequence[Sequence[FundingRow]],
    symbol: str,
) -> tuple[FundingRow, ...]:
    rows: list[FundingRow] = []
    for chunk in chunks:
        for row in chunk:
            if rows and row.time_ms <= rows[-1].time_ms:
                raise EvidenceError("FUNDING_CROSS_MONTH_NOT_INCREASING", symbol)
            rows.append(row)
    if not rows:
        raise EvidenceError("FUNDING_STREAM_EMPTY", symbol)
    return tuple(rows)


def merge_bar_months(chunks: Iterable[Sequence[Bar]], symbol: str) -> dict[int, Bar]:
    merged: dict[int, Bar] = {}
    for row in itertools.chain.from_iterable(chunks):
        if row.open_time_ms in merged:
            raise EvidenceError("KLINE_DUPLICATE_BAR", f"{symbol}:{iso_ms(row.open_time_ms)}")
        merged[row.open_time_ms] = row
    return merged


def validate_funding_surveillance(
    rows: Sequence[FundingRow],
    symbol: str,
    coverage_start_ms: int,
    coverage_end_ms: int,
) -> None:
    """Require complete cadence coverage so no transition can hide in a gap.

    ``historical_interval_source`` cross-checks the stated interval against
    adjacent calc_time gaps, so every adjacency must match the *later* row's own
    stated interval.  Read that way one rule covers stable cadence and a
    compression boundary alike -- an 8h -> 1h change produces a one-hour gap into
    a row stating ``interval == 1`` -- while a dropped settlement doubles the gap
    and is caught.  The two boundary checks then reject a month that was
    truncated at either end, which would otherwise silently hide a transition.
    """

    if not rows:
        raise EvidenceError("FUNDING_SURVEILLANCE_EMPTY", symbol)
    for earlier, later in itertools.pairwise(rows):
        if later.time_ms <= earlier.time_ms:
            raise EvidenceError("FUNDING_SURVEILLANCE_NOT_INCREASING", symbol)
        expected = later.interval_hours * HOUR_MS
        if abs((later.time_ms - earlier.time_ms) - expected) > GAP_TOLERANCE_MS:
            raise EvidenceError(
                "FUNDING_SURVEILLANCE_GAP_INVALID", f"{symbol}:{iso_ms(later.time_ms)}"
            )
    first = rows[0]
    if first.time_ms - coverage_start_ms > first.interval_hours * HOUR_MS + GAP_TOLERANCE_MS:
        raise EvidenceError(
            "FUNDING_SURVEILLANCE_TRUNCATED_AT_START", f"{symbol}:{iso_ms(first.time_ms)}"
        )
    last = rows[-1]
    if coverage_end_ms - last.time_ms > last.interval_hours * HOUR_MS + GAP_TOLERANCE_MS:
        raise EvidenceError(
            "FUNDING_SURVEILLANCE_TRUNCATED_AT_END", f"{symbol}:{iso_ms(last.time_ms)}"
        )


def partition_rows(rows: Sequence[FundingRow], partition: Partition) -> tuple[FundingRow, ...]:
    """Restrict signal history to the partition: no cross-partition row is used."""

    return tuple(row for row in rows if partition.start_ms <= row.time_ms < partition.end_ms)


def _gap_matches(later: FundingRow, earlier: FundingRow, interval_hours: int) -> bool:
    return abs((later.time_ms - earlier.time_ms) - interval_hours * HOUR_MS) <= GAP_TOLERANCE_MS


def decision_hour_ms(final_confirmation_ms: int, entry_lag_hours: int) -> int:
    """The single frozen decision index: ceil_hour(final_confirmation + lag hours).

    Exactly ``((t + lag*3600000 + 3599999) // 3600000) * 3600000`` in integer
    milliseconds.  This is a retrospective simulation index, not a proven
    live-public availability time.
    """

    shifted = final_confirmation_ms + entry_lag_hours * HOUR_MS
    return ((shifted + HOUR_MS - 1) // HOUR_MS) * HOUR_MS


@dataclass(frozen=True, slots=True)
class TransitionSeed:
    symbol: str
    event_ms: int
    final_confirmation_ms: int
    new_interval_hours: int
    signal_rate: Decimal
    signal_normalized_rate: Decimal
    baseline_start_ms: int


def transition_seeds(
    symbol: str,
    rows: Sequence[FundingRow],
    confirmation_rows: int,
) -> tuple[TransitionSeed, ...]:
    """Observed 8h -> 4h/1h compressions inside one partition, carrying no return."""

    seeds: list[TransitionSeed] = []
    for index in range(PRE_TRANSITION_ROWS, len(rows) - confirmation_rows + 1):
        first_short = rows[index]
        new_interval = first_short.interval_hours
        if new_interval not in ELIGIBLE_NEW_INTERVAL_HOURS:
            continue
        stable = rows[index - PRE_TRANSITION_ROWS : index]
        if any(row.interval_hours != STABLE_INTERVAL_HOURS for row in stable):
            continue
        if any(
            not _gap_matches(later, earlier, STABLE_INTERVAL_HOURS)
            for earlier, later in itertools.pairwise(stable)
        ):
            continue
        if not _gap_matches(first_short, stable[-1], new_interval):
            continue
        window = rows[index : index + confirmation_rows]
        if any(row.interval_hours != new_interval for row in window):
            continue
        if any(
            not _gap_matches(later, earlier, new_interval)
            for earlier, later in itertools.pairwise(window)
        ):
            continue
        final = window[-1]
        seeds.append(
            TransitionSeed(
                symbol=symbol,
                event_ms=first_short.time_ms,
                final_confirmation_ms=final.time_ms,
                new_interval_hours=new_interval,
                signal_rate=final.rate,
                signal_normalized_rate=final.normalized_rate,
                baseline_start_ms=stable[0].time_ms,
            )
        )
    return tuple(seeds)


def in_horizon_candidate(
    seed: TransitionSeed,
    trial: Trial,
    partition: Partition,
) -> Candidate | None:
    """Admit only candidates whose complete input horizon lies inside the partition.

    A boundary-crossing candidate is structurally outside the partition: it is
    never scored and never carried, and it is not cash.
    """

    decision_ms = decision_hour_ms(seed.final_confirmation_ms, trial.entry_lag_hours)
    entry_ms = decision_ms
    exit_ms = entry_ms + trial.hold_hours * HOUR_MS
    lookback_start_ms = entry_ms - CAPACITY_LOOKBACK_HOURS * HOUR_MS
    if seed.baseline_start_ms < partition.start_ms or lookback_start_ms < partition.start_ms:
        return None
    if exit_ms >= partition.end_ms or entry_ms >= partition.end_ms:
        return None
    side = 0 if seed.signal_rate == 0 else (-1 if seed.signal_rate > 0 else 1)
    return Candidate(
        symbol=seed.symbol,
        event_ms=seed.event_ms,
        final_confirmation_ms=seed.final_confirmation_ms,
        new_interval_hours=seed.new_interval_hours,
        confirmation_rows=trial.confirmation_rows,
        signal_rate=seed.signal_rate,
        signal_normalized_rate=seed.signal_normalized_rate,
        side=side,
        decision_ms=decision_ms,
        entry_ms=entry_ms,
        exit_ms=exit_ms,
        baseline_start_ms=seed.baseline_start_ms,
    )


def required_bar(bars: Mapping[int, Bar], hour_ms: int, detail: str) -> Bar:
    bar = bars.get(hour_ms)
    if bar is None:
        raise EvidenceError("REQUIRED_BAR_MISSING", f"{detail}:{iso_ms(hour_ms)}")
    if bar.open_price <= 0:
        raise EvidenceError("REQUIRED_BAR_PRICE_NONPOSITIVE", f"{detail}:{iso_ms(hour_ms)}")
    return bar


def member_capacity_evidence(
    bars: Mapping[int, Bar],
    entry_ms: int,
    partition: Partition,
    detail: str,
) -> tuple[tuple[Decimal, ...], Decimal]:
    """participation_rate times the member volume reference over 168 prior hours."""

    hours = tuple(range(entry_ms - CAPACITY_LOOKBACK_HOURS * HOUR_MS, entry_ms, HOUR_MS))
    if len(hours) != CAPACITY_LOOKBACK_HOURS:
        raise EvidenceError("CAPACITY_LOOKBACK_SHAPE_INVALID", detail)
    window_sums: list[Decimal] = []
    for day in range(1, CAPACITY_WINDOW_DAYS + 1):
        window_start = entry_ms - day * 24 * HOUR_MS
        window_end = entry_ms - (day - 1) * 24 * HOUR_MS
        total = Decimal(0)
        for hour_ms in range(window_start, window_end, HOUR_MS):
            if not partition.start_ms <= hour_ms < partition.end_ms:
                raise EvidenceError("CAPACITY_HOUR_OUTSIDE_PARTITION", detail)
            bar = bars.get(hour_ms)
            if bar is None:
                raise EvidenceError("CAPACITY_BAR_MISSING", f"{detail}:{iso_ms(hour_ms)}")
            if bar.close_time_ms >= entry_ms:
                raise EvidenceError("CAPACITY_BAR_NOT_CAUSAL", f"{detail}:{iso_ms(hour_ms)}")
            if bar.quote_volume < 0:
                raise EvidenceError("CAPACITY_QUOTE_VOLUME_INVALID", f"{detail}:{iso_ms(hour_ms)}")
            total += bar.quote_volume
        window_sums.append(total)
    if len(window_sums) != CAPACITY_WINDOW_DAYS:
        raise EvidenceError("CAPACITY_WINDOW_SHAPE_INVALID", detail)
    trailing_24h = window_sums[0]
    fourth_sorted = sorted(window_sums)[CAPACITY_SORTED_INDEX]
    values = tuple(window_sums)
    return values, min(trailing_24h, fourth_sorted) * PARTICIPATION_RATE


def member_capacity_proxy(
    bars: Mapping[int, Bar],
    entry_ms: int,
    partition: Partition,
    detail: str,
) -> Decimal:
    return member_capacity_evidence(bars, entry_ms, partition, detail)[1]


def value_member(
    market: MarketData,
    symbol: str,
    side: int,
    member_notional: Decimal,
    entry_ms: int,
    exit_ms: int,
    scenario: str,
) -> MemberValuation:
    """The frozen cost equations, applied once per member per scenario."""

    marks = market.mark[symbol]
    entry_bar = required_bar(marks, entry_ms, f"{symbol}:entry")
    exit_bar = required_bar(marks, exit_ms, f"{symbol}:exit")
    price_0 = entry_bar.open_price
    price_1 = exit_bar.open_price
    fee_bp, adverse_bp = COSTS[scenario]
    fee_rate = fee_bp / Decimal(10_000)
    adverse_rate = adverse_bp / Decimal(10_000)
    quantity = member_notional / price_0
    entry_fill = price_0 * (Decimal(1) + Decimal(side) * adverse_rate)
    exit_fill = price_1 * (Decimal(1) - Decimal(side) * adverse_rate)
    if entry_fill <= 0 or exit_fill <= 0:
        raise EvidenceError("FILL_PROXY_NONPOSITIVE", symbol)
    mark_price_pnl = Decimal(side) * quantity * (price_1 - price_0)
    booked: list[tuple[int, int, Decimal, Decimal, Decimal]] = []
    funding_pnl = Decimal(0)
    for row in market.funding[symbol]:
        if not entry_ms < row.time_ms < exit_ms:
            continue
        settlement_hour = row.time_ms - row.time_ms % HOUR_MS
        settlement_bar = required_bar(marks, settlement_hour, f"{symbol}:settlement")
        amount = -Decimal(side) * quantity * settlement_bar.open_price * row.rate
        funding_pnl += amount
        booked.append(
            (
                row.time_ms,
                ceil_hour_ms(row.time_ms),
                settlement_bar.open_price,
                row.rate,
                amount,
            )
        )
    adverse_entry = -quantity * adverse_rate * price_0
    adverse_exit = -quantity * adverse_rate * price_1
    fee_entry = fee_rate * quantity * abs(entry_fill)
    fee_exit = fee_rate * quantity * abs(exit_fill)
    net = (
        mark_price_pnl
        + funding_pnl
        + (adverse_entry + adverse_exit)
        - (fee_entry + fee_exit)
    )
    return MemberValuation(
        symbol=symbol,
        side=side,
        quantity=quantity,
        member_notional=member_notional,
        entry_price=price_0,
        exit_price=price_1,
        entry_fill_proxy=entry_fill,
        exit_fill_proxy=exit_fill,
        mark_price_pnl=mark_price_pnl,
        funding_pnl=funding_pnl,
        adverse_entry=adverse_entry,
        adverse_exit=adverse_exit,
        fee_entry=fee_entry,
        fee_exit=fee_exit,
        net=net,
        booked_funding=tuple(booked),
    )


def build_cohort(
    market: MarketData,
    partition: Partition,
    decision_ms: int,
    exit_ms: int,
    members: Sequence[Candidate],
) -> Cohort:
    """The complete synchronized cohort: 1000 USD split equally, never partial."""

    symbols = tuple(member.symbol for member in members)
    if len(set(symbols)) != len(symbols):
        raise EvidenceError("COHORT_SYMBOLS_NOT_DISTINCT", iso_ms(decision_ms))
    member_notional = CAPITAL / Decimal(len(members))
    by_scenario: dict[str, tuple[MemberValuation, ...]] = {}
    for scenario in SCENARIOS:
        by_scenario[scenario] = tuple(
            value_member(
                market,
                member.symbol,
                member.side,
                member_notional,
                decision_ms,
                exit_ms,
                scenario,
            )
            for member in members
        )
    capacity_rows = [
        member_capacity_evidence(
            market.contract[member.symbol], decision_ms, partition, f"{member.symbol}:capacity"
        )
        for member in members
    ]
    return Cohort(
        decision_ms=decision_ms,
        entry_ms=decision_ms,
        exit_ms=exit_ms,
        member_notional=member_notional,
        symbols=symbols,
        members=by_scenario,
        net={
            scenario: sum((item.net for item in by_scenario[scenario]), Decimal(0))
            for scenario in SCENARIOS
        },
        capacity_proxy_usd=Decimal(len(members)) * min(row[1] for row in capacity_rows),
        member_capacity_proxy_usd={
            member.symbol: row[1]
            for member, row in zip(members, capacity_rows, strict=True)
        },
        member_capacity_windows_usdt={
            member.symbol: row[0]
            for member, row in zip(members, capacity_rows, strict=True)
        },
    )


def evaluate_trial(
    market: MarketData,
    seeds_by_symbol: Mapping[str, tuple[TransitionSeed, ...]],
    trial: Trial,
    partition: Partition,
) -> TrialResult:
    """Score one trial: complete cohort or exactly 1000 USD cash, never partial.

    Only an accepted noncash cohort advances the blocking exit or any per-symbol
    cooldown; a cash cohort never blocks a later candidate.
    """

    grouped: dict[int, list[Candidate]] = defaultdict(list)
    for symbol in sorted(seeds_by_symbol):
        for seed in seeds_by_symbol[symbol]:
            candidate = in_horizon_candidate(seed, trial, partition)
            if candidate is not None:
                grouped[candidate.decision_ms].append(candidate)

    cohorts: list[Cohort] = []
    decisions: list[Mapping[str, Any]] = []
    zero_signal = 0
    cooldown = 0
    overlap = 0
    blocking_exit_ms = -1
    last_accepted_final: dict[str, int] = {}
    for decision_ms in sorted(grouped):
        members = sorted(grouped[decision_ms], key=lambda item: item.symbol)
        exit_ms = decision_ms + trial.hold_hours * HOUR_MS
        reason: str | None = None
        if any(member.side == 0 for member in members):
            zero_signal += 1
            reason = "ZERO_SIGNAL"
        elif any(
            member.symbol in last_accepted_final
            and member.final_confirmation_ms - last_accepted_final[member.symbol] < COOLDOWN_MS
            for member in members
        ):
            cooldown += 1
            reason = "COOLDOWN"
        elif decision_ms <= blocking_exit_ms:
            overlap += 1
            reason = "OVERLAP"
        decisions.append(
            {
                "candidate_symbols": [member.symbol for member in members],
                "cash_reason": reason,
                "decision_ms": decision_ms,
                "state": "CASH" if reason is not None else "NONCASH",
            }
        )
        if reason is not None:
            continue
        cohort = build_cohort(market, partition, decision_ms, exit_ms, members)
        cohorts.append(cohort)
        blocking_exit_ms = cohort.exit_ms
        for member in members:
            last_accepted_final[member.symbol] = member.final_confirmation_ms
    return TrialResult(
        trial=trial,
        candidates=tuple(
            candidate
            for decision_ms in sorted(grouped)
            for candidate in sorted(grouped[decision_ms], key=lambda item: item.symbol)
        ),
        cohorts=tuple(cohorts),
        decisions=tuple(decisions),
        candidate_hours=len(grouped),
        cash_hours=zero_signal + cooldown + overlap,
        zero_signal_cash_hours=zero_signal,
        cooldown_cash_hours=cooldown,
        overlap_cash_hours=overlap,
    )


def severe_hourly_max_drawdown(
    market: MarketData,
    result: TrialResult,
    partition: Partition,
) -> Decimal:
    """Peak-to-trough on the complete hourly marked-equity grid, severe scenario.

    Ordering at each hour h: apply funding booked to h, close exits at h, then
    open entries at h.  Equity is recorded only after that complete ordering.
    """

    funding_by_hour: dict[int, Decimal] = defaultdict(Decimal)
    entries_by_hour: dict[int, list[tuple[int, MemberValuation]]] = defaultdict(list)
    exits_by_hour: dict[int, list[int]] = defaultdict(list)
    # Members carry a synthetic key so that two structurally identical positions
    # in different cohorts can never be confused when one of them closes.
    key = 0
    for cohort in result.cohorts:
        for member in cohort.members["severe"]:
            key += 1
            entries_by_hour[cohort.entry_ms].append((key, member))
            exits_by_hour[cohort.exit_ms].append(key)
            for _calc_ms, hour_ms, _mark, _rate, amount in member.booked_funding:
                funding_by_hour[hour_ms] += amount
    collisions = set(entries_by_hour) & set(exits_by_hour)
    if collisions:
        raise EvidenceError("SAME_HOUR_EXIT_AND_ENTRY", iso_ms(sorted(collisions)[0]))

    realized_price = Decimal(0)
    booked_funding = Decimal(0)
    adverse = Decimal(0)
    fees = Decimal(0)
    open_members: dict[int, MemberValuation] = {}
    peak = CAPITAL
    drawdown = Decimal(0)
    for hour_ms in range(partition.start_ms, partition.end_ms + HOUR_MS, HOUR_MS):
        if hour_ms in funding_by_hour:
            booked_funding += funding_by_hour[hour_ms]
        for closing in exits_by_hour.get(hour_ms, ()):
            member = open_members.pop(closing)
            realized_price += Decimal(member.side) * member.quantity * (
                member.exit_price - member.entry_price
            )
            adverse += member.adverse_exit
            fees += member.fee_exit
        for opening, member in entries_by_hour.get(hour_ms, ()):
            adverse += member.adverse_entry
            fees += member.fee_entry
            open_members[opening] = member
        unrealized = Decimal(0)
        for member in open_members.values():
            bar = required_bar(market.mark[member.symbol], hour_ms, f"{member.symbol}:mark")
            unrealized += Decimal(member.side) * member.quantity * (
                bar.open_price - member.entry_price
            )
        equity = CAPITAL + realized_price + booked_funding + adverse - fees + unrealized
        peak = max(peak, equity)
        drawdown = max(drawdown, (peak - equity) / CAPITAL)
    if open_members:
        raise EvidenceError("POSITION_OPEN_AT_PARTITION_END", partition.partition_id)
    return drawdown


def member_verification_evidence(cohort: Cohort, index: int) -> dict[str, Any]:
    base = cohort.members["base"][index]
    scenario_components: dict[str, Any] = {}
    for scenario in SCENARIOS:
        member = cohort.members[scenario][index]
        scenario_components[scenario] = {
            "adverse_attribution_usd": decimal_string(
                member.adverse_entry + member.adverse_exit
            ),
            "adverse_entry_usd": decimal_string(member.adverse_entry),
            "adverse_exit_usd": decimal_string(member.adverse_exit),
            "entry_fill_proxy": decimal_string(member.entry_fill_proxy),
            "exit_fill_proxy": decimal_string(member.exit_fill_proxy),
            "fee_entry_usd": decimal_string(-member.fee_entry),
            "fee_exit_usd": decimal_string(-member.fee_exit),
            "fee_usd": decimal_string(-(member.fee_entry + member.fee_exit)),
            "funding_usd": decimal_string(member.funding_pnl),
            "mark_price_pnl_usd": decimal_string(member.mark_price_pnl),
            "net_usd": decimal_string(member.net),
        }
    return {
        "capacity_quote_volume_24h_windows_usdt": [
            decimal_string(value)
            for value in cohort.member_capacity_windows_usdt[base.symbol]
        ],
        "entry_mark_price": decimal_string(base.entry_price),
        "exit_mark_price": decimal_string(base.exit_price),
        "funding_settlements": [
            {
                "amount_usd": decimal_string(amount),
                "booking_hour_ms": booking_ms,
                "calc_time_ms": calc_ms,
                "funding_rate": decimal_string(rate),
                "mark_price": decimal_string(mark),
            }
            for calc_ms, booking_ms, mark, rate, amount in base.booked_funding
        ],
        "member_capacity_proxy_usd": decimal_string(
            cohort.member_capacity_proxy_usd[base.symbol]
        ),
        "member_notional_usd": decimal_string(base.member_notional),
        "quantity": decimal_string(base.quantity),
        "scenario_components": scenario_components,
        "side_sign": base.side,
        "symbol": base.symbol,
    }


def severe_hourly_verification_evidence(
    market: MarketData,
    result: TrialResult,
    partition: Partition,
) -> list[dict[str, Any]]:
    entries: dict[int, list[tuple[tuple[int, str], MemberValuation]]] = defaultdict(list)
    exits: dict[int, list[tuple[int, str]]] = defaultdict(list)
    funding: dict[int, Decimal] = defaultdict(Decimal)
    for cohort in result.cohorts:
        for member in cohort.members["severe"]:
            key = (cohort.entry_ms, member.symbol)
            entries[cohort.entry_ms].append((key, member))
            exits[cohort.exit_ms].append(key)
            for _calc, booking, _mark, _rate, amount in member.booked_funding:
                funding[booking] += amount
    realized = Decimal(0)
    booked = Decimal(0)
    adverse = Decimal(0)
    fees = Decimal(0)
    opened: dict[tuple[int, str], MemberValuation] = {}
    rows: list[dict[str, Any]] = []
    for hour_ms in range(partition.start_ms, partition.end_ms + HOUR_MS, HOUR_MS):
        booked += funding.get(hour_ms, Decimal(0))
        for key in exits.get(hour_ms, ()):
            member = opened.pop(key)
            realized += member.mark_price_pnl
            adverse += member.adverse_exit
            fees += member.fee_exit
        for key, member in entries.get(hour_ms, ()):
            adverse += member.adverse_entry
            fees += member.fee_entry
            opened[key] = member
        marks: list[dict[str, Any]] = []
        unrealized = Decimal(0)
        for key, member in sorted(opened.items()):
            mark = required_bar(
                market.mark[member.symbol], hour_ms, f"{member.symbol}:verification_mark"
            ).open_price
            unrealized += Decimal(member.side) * member.quantity * (
                mark - member.entry_price
            )
            marks.append(
                {
                    "cohort_entry_ms": key[0],
                    "mark_price": decimal_string(mark),
                    "symbol": member.symbol,
                }
            )
        equity = CAPITAL + realized + booked + adverse - fees + unrealized
        rows.append(
            {
                "adverse_attribution_usd": decimal_string(adverse),
                "booked_funding_usd": decimal_string(booked),
                "equity_usd": decimal_string(equity),
                "fee_usd": decimal_string(-fees),
                "open_member_marks": marks,
                "open_unrealized_mark_price_pnl_usd": decimal_string(unrealized),
                "realized_mark_price_pnl_usd": decimal_string(realized),
                "timestamp_ms": hour_ms,
            }
        )
    if opened:
        raise EvidenceError("POSITION_OPEN_AT_PARTITION_END", partition.partition_id)
    return rows


def trial_verification_evidence(
    market: MarketData,
    result: TrialResult,
    partition: Partition,
    *,
    include_candidates: bool,
) -> dict[str, Any]:
    days = partition_days(partition)
    value: dict[str, Any] = {
        "cohorts": [
            {
                "capacity_proxy_usd": decimal_string(cohort.capacity_proxy_usd),
                "decision_ms": cohort.decision_ms,
                "entry_ms": cohort.entry_ms,
                "exit_ms": cohort.exit_ms,
                "members": [
                    member_verification_evidence(cohort, index)
                    for index in range(len(cohort.symbols))
                ],
                "net_usd_by_scenario": {
                    scenario: decimal_string(cohort.net[scenario])
                    for scenario in SCENARIOS
                },
            }
            for cohort in result.cohorts
        ],
        "daily_net_usd_per_1000_by_scenario": {
            scenario: [
                decimal_string(item)
                for item in daily_vector(result, days, scenario)
            ]
            for scenario in SCENARIOS
        },
        "decisions": [dict(row) for row in result.decisions],
        "hourly_equity_severe": severe_hourly_verification_evidence(
            market, result, partition
        ),
    }
    if include_candidates:
        value["candidates"] = [
            candidate_row(candidate, result.trial) for candidate in result.candidates
        ]
    return value


def partition_days(partition: Partition) -> tuple[int, ...]:
    """Every UTC calendar day whose start lies in the partition; zeros are explicit."""

    return tuple(range(day_start_ms(partition.start_ms), partition.end_ms, DAY_MS))


def daily_vector(
    result: TrialResult,
    days: Sequence[int],
    scenario: str,
) -> tuple[Decimal, ...]:
    """A cohort's complete realized net lands on its UTC exit day; all else zero."""

    by_day: dict[int, Decimal] = defaultdict(Decimal)
    for cohort in result.cohorts:
        by_day[day_start_ms(cohort.exit_ms)] += cohort.net[scenario]
    unplaced = set(by_day) - set(days)
    if unplaced:
        raise EvidenceError("EXIT_DAY_OUTSIDE_PARTITION_GRID", iso_ms(sorted(unplaced)[0]))
    return tuple(quantize_daily(by_day.get(day, Decimal(0))) for day in days)


def bootstrap_counts(n_days: int, partition_id: str) -> tuple[tuple[int, ...], ...]:
    """Shared circular seven-day block resamples with SHA-256 derived starts.

    No pseudo-random generator is used: for replicate b and block draw j the
    start index is the unsigned big-endian integer in the first eight raw digest
    bytes of SHA256("seed|partition|b|j") modulo n_days.  One index matrix per
    partition is reused for every trial and scenario, which is what makes the
    reality check a family-wide statement.  Multiplicities are stored so the
    resample total can skip the many zero days.
    """

    if n_days <= 0:
        raise ContractError("BOOTSTRAP_DIMENSION_INVALID", partition_id)
    if partition_id not in (DEVELOPMENT_PARTITION, HOLDOUT_PARTITION):
        raise ContractError("BOOTSTRAP_PARTITION_INVALID", partition_id)
    draws = math.ceil(n_days / BOOTSTRAP_BLOCK_DAYS)
    matrix: list[tuple[int, ...]] = []
    for replicate in range(BOOTSTRAP_REPLICATES):
        drawn: list[int] = []
        for draw in range(draws):
            key = f"{BOOTSTRAP_SEED}|{partition_id}|{replicate}|{draw}".encode("ascii")
            start = int.from_bytes(hashlib.sha256(key).digest()[:8], "big") % n_days
            drawn.extend((start + offset) % n_days for offset in range(BOOTSTRAP_BLOCK_DAYS))
        counts = [0] * n_days
        for index in drawn[:n_days]:
            counts[index] += 1
        matrix.append(tuple(counts))
    return tuple(matrix)


def nonzero_terms(vector: Sequence[Decimal]) -> tuple[tuple[int, Decimal], ...]:
    return tuple((index, value) for index, value in enumerate(vector) if value != 0)


def resample_total(terms: Sequence[tuple[int, Decimal]], counts: Sequence[int]) -> Decimal:
    return sum((Decimal(counts[index]) * value for index, value in terms), Decimal(0))


def nearest_rank_quantile(values: Sequence[Decimal], quantile: Decimal) -> Decimal:
    """For sorted B values and 0<q<=1, the element at max(0, ceil(q*B)-1)."""

    if not values or not Decimal(0) < quantile <= Decimal(1):
        raise ContractError("QUANTILE_INPUT_INVALID")
    ordered = sorted(values)
    index = max(0, math.ceil(quantile * Decimal(len(ordered))) - 1)
    return ordered[min(index, len(ordered) - 1)]


def scenario_statistics(
    vector: Sequence[Decimal],
    counts: Sequence[Sequence[int]],
) -> tuple[dict[str, Decimal], list[Decimal]]:
    """Uncentered resample totals plus every frozen bound for one cell."""

    terms = nonzero_terms(vector)
    observed = sum(vector, Decimal(0))
    boot = [resample_total(terms, path) for path in counts]
    replicates = Decimal(len(boot))
    # Centered totals collapse algebraically: every day is drawn exactly n times
    # per replicate, so sum(resample(x - mean)) == raw_total - observed_total.
    exceed = sum(1 for value in boot if value - observed >= observed)
    return (
        {
            "bonferroni_lcb": nearest_rank_quantile(boot, BONFERRONI_QUANTILE),
            "centered_one_sided_p": Decimal(exceed + 1) / (replicates + Decimal(1)),
            "interval_lower": nearest_rank_quantile(boot, ALPHA / Decimal(2)),
            "interval_upper": nearest_rank_quantile(boot, Decimal(1) - ALPHA / Decimal(2)),
            "observed": observed,
            "pointwise_lcb": nearest_rank_quantile(boot, ALPHA),
        },
        boot,
    )


def family_statistics(
    vectors: Mapping[str, Mapping[str, Sequence[Decimal]]],
    counts: Sequence[Sequence[int]],
) -> tuple[dict[str, dict[str, dict[str, Decimal]]], dict[str, Decimal]]:
    """Every trial-scenario cell plus White's reality check on shared resamples."""

    if not vectors:
        raise ContractError("BOOTSTRAP_VECTORS_MISSING")
    trial_ids = tuple(sorted(vectors))
    cells: dict[str, dict[str, dict[str, Decimal]]] = {}
    boots: dict[str, dict[str, list[Decimal]]] = {}
    for trial_id in trial_ids:
        cells[trial_id] = {}
        boots[trial_id] = {}
        for scenario in SCENARIOS:
            summary, boot = scenario_statistics(vectors[trial_id][scenario], counts)
            cells[trial_id][scenario] = summary
            boots[trial_id][scenario] = boot
    white: dict[str, Decimal] = {}
    for scenario in ("base", "stress"):
        observed_max = max(cells[trial_id][scenario]["observed"] for trial_id in trial_ids)
        exceed = 0
        for replicate in range(len(counts)):
            centered_max = max(
                boots[trial_id][scenario][replicate] - cells[trial_id][scenario]["observed"]
                for trial_id in trial_ids
            )
            exceed += int(centered_max >= observed_max)
        white[scenario] = Decimal(exceed + 1) / (Decimal(len(counts)) + Decimal(1))
    return cells, white


def holm_adjusted(raw: Mapping[str, Decimal]) -> dict[str, Decimal]:
    """min(1, max over k<=i of (family_size - k + 1) * raw_p_k) at sorted rank i."""

    ordered = sorted(raw.items(), key=lambda item: (item[1], item[0]))
    adjusted: dict[str, Decimal] = {}
    running = Decimal(0)
    for position, (trial_id, value) in enumerate(ordered):
        rank = position + 1
        running = max(running, Decimal(FAMILY_SIZE - rank + 1) * value)
        adjusted[trial_id] = min(Decimal(1), running)
    return adjusted


def pbo_block_ranges(n_days: int) -> tuple[tuple[int, int], ...]:
    """Twelve contiguous chronological blocks; the earliest r blocks hold q+1 days."""

    if n_days < PBO_BLOCKS:
        raise ContractError("PBO_DIMENSION_INVALID", str(n_days))
    quotient, remainder = divmod(n_days, PBO_BLOCKS)
    ranges: list[tuple[int, int]] = []
    cursor = 0
    for index in range(PBO_BLOCKS):
        size = quotient + 1 if index < remainder else quotient
        ranges.append((cursor, cursor + size))
        cursor += size
    if cursor != n_days:
        raise ContractError("PBO_BLOCK_COVERAGE_INVALID", str(n_days))
    return tuple(ranges)


def cscv_pbo(
    vectors: Mapping[str, Mapping[str, Sequence[Decimal]]],
    n_days: int,
) -> dict[str, Any]:
    """CSCV over all 924 six-of-twelve splits; a loss is lambda <= 0.

    With twelve trials the ascending worst-tie rank r gives percentile r/13, so
    lambda = logit(r/13) <= 0 is exactly r <= 6.  Ties are resolved against the
    champion, making the estimate pessimistic by construction.
    """

    ranges = pbo_block_ranges(n_days)
    trial_ids = tuple(sorted(vectors))
    if len(trial_ids) != FAMILY_SIZE:
        raise ContractError("PBO_FAMILY_SIZE_INVALID", str(len(trial_ids)))
    block_sums: dict[str, dict[str, tuple[Decimal, ...]]] = {}
    for trial_id in trial_ids:
        block_sums[trial_id] = {}
        for scenario in ("base", "stress"):
            vector = vectors[trial_id][scenario]
            block_sums[trial_id][scenario] = tuple(
                sum(vector[start:end], Decimal(0)) for start, end in ranges
            )

    def combined(trial_id: str, blocks: Iterable[int]) -> Decimal:
        chosen = tuple(blocks)
        return min(
            sum((block_sums[trial_id][scenario][index] for index in chosen), Decimal(0))
            for scenario in ("base", "stress")
        )

    all_blocks = set(range(PBO_BLOCKS))
    losses = 0
    splits = 0
    lambda_values: list[float] = []
    for in_sample in itertools.combinations(range(PBO_BLOCKS), PBO_BLOCKS // 2):
        out_of_sample = tuple(sorted(all_blocks - set(in_sample)))
        is_scores = {trial_id: combined(trial_id, in_sample) for trial_id in trial_ids}
        oos_scores = {trial_id: combined(trial_id, out_of_sample) for trial_id in trial_ids}
        ranks = {
            trial_id: 1
            + sum(
                1
                for other in trial_ids
                if other != trial_id and oos_scores[other] < oos_scores[trial_id]
            )
            for trial_id in trial_ids
        }
        best_is = max(is_scores.values())
        champion = min(
            (trial_id for trial_id in trial_ids if is_scores[trial_id] == best_is),
            key=lambda trial_id: (ranks[trial_id], trial_id),
        )
        rank = ranks[champion]
        percentile = rank / (FAMILY_SIZE + 1)
        lambda_values.append(math.log(percentile / (1 - percentile)))
        if rank <= FAMILY_SIZE // 2:
            losses += 1
        splits += 1
    if splits != PBO_SPLITS:
        raise ContractError("PBO_SPLIT_COUNT_INVALID", str(splits))
    return {
        "authority": "DIAGNOSTIC_ONLY",
        "blocks": PBO_BLOCKS,
        "loss_rule": "lambda_le_zero_worst_tie_ascending_rank",
        "median_lambda": f"{sorted(lambda_values)[len(lambda_values) // 2]:.6f}",
        "pbo": decimal_string(Decimal(losses) / Decimal(PBO_SPLITS)),
        "splits": splits,
    }


def robustness(result: TrialResult) -> dict[str, Any]:
    """Leave-one-out stress nets: drop the best symbol's members, then the best month.

    remove_best_symbol removes only that symbol's members; every other member
    keeps its original fixed notional and no removed notional is reassigned.
    remove_best_entry_month removes complete cohorts by UTC entry month.  In both
    cases the ranking quantity is exactly the quantity removed.
    """

    total = sum((cohort.net["stress"] for cohort in result.cohorts), Decimal(0))
    by_symbol: dict[str, Decimal] = defaultdict(Decimal)
    by_month: dict[str, Decimal] = defaultdict(Decimal)
    for cohort in result.cohorts:
        for member in cohort.members["stress"]:
            by_symbol[member.symbol] += member.net
        by_month[utc_month(cohort.entry_ms)] += cohort.net["stress"]
    best_symbol = (
        min(by_symbol, key=lambda symbol: (-by_symbol[symbol], symbol)) if by_symbol else None
    )
    best_month = min(by_month, key=lambda month: (-by_month[month], month)) if by_month else None
    without_symbol = total - by_symbol[best_symbol] if best_symbol is not None else total
    without_month = total - by_month[best_month] if best_month is not None else total
    return {
        "best_stress_month": best_month,
        "best_stress_month_contribution": (
            decimal_string(by_month[best_month]) if best_month is not None else None
        ),
        "best_stress_symbol": best_symbol,
        "best_stress_symbol_contribution": (
            decimal_string(by_symbol[best_symbol]) if best_symbol is not None else None
        ),
        "remove_best_month_stress_net_usd_per_1000": decimal_string(without_month),
        "remove_best_symbol_stress_net_usd_per_1000": decimal_string(without_symbol),
    }


def capacity_summary(result: TrialResult) -> dict[str, Any]:
    """Population is every accepted noncash cohort; zero cohorts is UNMEASURED."""

    population = sorted(cohort.capacity_proxy_usd for cohort in result.cohorts)
    if not population:
        return {
            "label": "PUBLIC_COARSE_PRIOR_VOLUME_PARTICIPATION_PROXY",
            "minimum": "UNMEASURED",
            "p05": "UNMEASURED",
            "population": 0,
            "unit_disclosure": "nominal 1 USDT = 1 USD proxy; USDT/USD basis unmeasured",
        }
    index = max(0, math.ceil(Decimal("0.05") * Decimal(len(population))) - 1)
    return {
        "label": "PUBLIC_COARSE_PRIOR_VOLUME_PARTICIPATION_PROXY",
        "minimum": decimal_string(population[0]),
        "p05": decimal_string(population[min(index, len(population) - 1)]),
        "population": len(population),
        "unit_disclosure": "nominal 1 USDT = 1 USD proxy; USDT/USD basis unmeasured",
    }


ACTIVITY_COUNTER_FIELDS: Final = (
    "active_cohorts",
    "active_weeks",
    "candidate_decision_hours",
    "cash_decision_hours",
    "cooldown_cash_hours",
    "distinct_traded_symbols",
    "overlap_cash_hours",
    "traded_members",
    "zero_signal_cash_hours",
)


def activity_counters(result: TrialResult) -> dict[str, int]:
    return {
        "active_cohorts": len(result.cohorts),
        "active_weeks": len({iso_week(cohort.entry_ms) for cohort in result.cohorts}),
        "candidate_decision_hours": result.candidate_hours,
        "cash_decision_hours": result.cash_hours,
        "cooldown_cash_hours": result.cooldown_cash_hours,
        "distinct_traded_symbols": len(
            {symbol for cohort in result.cohorts for symbol in cohort.symbols}
        ),
        "overlap_cash_hours": result.overlap_cash_hours,
        "traded_members": sum(len(cohort.symbols) for cohort in result.cohorts),
        "zero_signal_cash_hours": result.zero_signal_cash_hours,
    }


def attribution(result: TrialResult) -> dict[str, Any]:
    """G, U, A and F decomposition, reported per scenario."""

    rows: dict[str, Any] = {}
    for scenario in SCENARIOS:
        members = [member for cohort in result.cohorts for member in cohort.members[scenario]]
        price = sum((member.mark_price_pnl for member in members), Decimal(0))
        funding = sum((member.funding_pnl for member in members), Decimal(0))
        adverse = sum(
            (member.adverse_entry + member.adverse_exit for member in members), Decimal(0)
        )
        fees = sum((member.fee_entry + member.fee_exit for member in members), Decimal(0))
        rows[scenario] = {
            "adverse_attribution_usd": decimal_string(adverse),
            "fee_usd": decimal_string(-fees),
            "funding_usd": decimal_string(funding),
            "mark_price_pnl_usd": decimal_string(price),
            "net_usd": decimal_string(price + funding + adverse - fees),
        }
    return rows


def load_partition_funding(
    cache_root: Path,
    packet_root: Path,
    index: Mapping[tuple[str, str, str], Mapping[str, Any]],
    universe: Sequence[str],
    partition: Partition,
    stage: str,
    ledger: OpenedLedger,
) -> tuple[MarketData, dict[int, dict[str, tuple[TransitionSeed, ...]]]]:
    """Every universe funding month in the partition is mandatory surveillance."""

    market = MarketData()
    coverage_start_ms = month_bounds_ms(partition.months[0])[0]
    coverage_end_ms = month_bounds_ms(partition.months[-1])[1]
    for symbol in universe:
        chunks = [
            read_funding_month(
                load_partition_member(
                    cache_root, packet_root, index, "fundingRate", symbol, month, stage, ledger
                ),
                month,
                f"{symbol}:{month}:fundingRate",
            )
            for month in partition.months
        ]
        merged = merge_funding_months(chunks, symbol)
        # Surveillance completeness is checked across the whole loaded stream before
        # any partition restriction, so a truncated or gapped month cannot hide a
        # transition from the event scan.
        validate_funding_surveillance(merged, symbol, coverage_start_ms, coverage_end_ms)
        market.funding[symbol] = partition_rows(merged, partition)
    seeds: dict[int, dict[str, tuple[TransitionSeed, ...]]] = {}
    for confirmation in CONFIRMATION_ROWS:
        seeds[confirmation] = {
            symbol: transition_seeds(symbol, market.funding[symbol], confirmation)
            for symbol in universe
        }
    return market, seeds


def in_horizon_symbols(
    seeds: Mapping[int, Mapping[str, tuple[TransitionSeed, ...]]],
    partition: Partition,
) -> tuple[str, ...]:
    needed: set[str] = set()
    for trial in trial_family():
        for symbol, symbol_seeds in seeds[trial.confirmation_rows].items():
            for seed in symbol_seeds:
                if in_horizon_candidate(seed, trial, partition) is not None:
                    needed.add(symbol)
                    break
    return tuple(sorted(needed))


def load_partition_bars(
    cache_root: Path,
    packet_root: Path,
    index: Mapping[tuple[str, str, str], Mapping[str, Any]],
    market: MarketData,
    symbols: Sequence[str],
    partition: Partition,
    stage: str,
    ledger: OpenedLedger,
) -> None:
    """Market-data bars are mandatory for each in-horizon candidate symbol."""

    for symbol in symbols:
        for dataset, target in (
            ("klines_1h", market.contract),
            ("markPriceKlines_1h", market.mark),
        ):
            chunks = [
                read_kline_month(
                    load_partition_member(
                        cache_root, packet_root, index, dataset, symbol, month, stage, ledger
                    ),
                    month,
                    f"{symbol}:{month}:{dataset}",
                )
                for month in partition.months
            ]
            merged = merge_bar_months(chunks, symbol)
            target[symbol] = {
                hour: bar
                for hour, bar in merged.items()
                if partition.start_ms <= hour < partition.end_ms
            }


def candidate_row(candidate: Candidate, trial: Trial) -> dict[str, Any]:
    return {
        "baseline_start": iso_ms(candidate.baseline_start_ms),
        "confirmation_rows": candidate.confirmation_rows,
        "contrarian_side": candidate.side,
        "decision_hour": iso_ms(candidate.decision_ms),
        "entry_hour": iso_ms(candidate.entry_ms),
        "event_calc_time": iso_ms(candidate.event_ms),
        "exit_hour": iso_ms(candidate.exit_ms),
        "final_confirmation_calc_time": iso_ms(candidate.final_confirmation_ms),
        "new_interval_hours": candidate.new_interval_hours,
        "signal_normalized_rate_8h": decimal_string(candidate.signal_normalized_rate),
        "signal_rate": decimal_string(candidate.signal_rate),
        "symbol": candidate.symbol,
        "trial_id": trial.trial_id,
    }


def event_universe_document(
    packet_root: Path,
    seeds: Mapping[int, Mapping[str, tuple[TransitionSeed, ...]]],
    partition: Partition,
) -> dict[str, Any]:
    """Every in-horizon candidate, carrying no forward return of any kind."""

    rows: list[dict[str, Any]] = []
    seed_counts: dict[str, int] = {}
    for confirmation in CONFIRMATION_ROWS:
        seed_counts[str(confirmation)] = sum(
            len(items) for items in seeds[confirmation].values()
        )
    for trial in trial_family():
        for symbol in sorted(seeds[trial.confirmation_rows]):
            for seed in seeds[trial.confirmation_rows][symbol]:
                candidate = in_horizon_candidate(seed, trial, partition)
                if candidate is not None:
                    rows.append(candidate_row(candidate, trial))
    rows.sort(key=lambda row: (row["trial_id"], row["decision_hour"], row["symbol"]))
    return {
        "candidate_count": len(rows),
        "candidates": rows,
        "created_at": utc_now(),
        "decision_hour_definition": (
            "ceil_hour(final_confirmation_calc_time + entry_lag_hours hours); a retrospective "
            "simulation index, not a proven live-public availability time"
        ),
        "forward_returns_included": False,
        "lag_safe_claim": False,
        "partition_id": partition.partition_id,
        "partition_window": [iso_ms(partition.start_ms), iso_ms(partition.end_ms)],
        "schema": SCHEMA_BY_RELATIVE["event_universe.v1.json"],
        "transition_seed_count_by_confirmation_rows": seed_counts,
        **predecessor_record(packet_root, "event_universe.v1.json", "run_consumed.v1.json"),
    }


def trial_summary(
    market: MarketData,
    result: TrialResult,
    partition: Partition,
    cells: Mapping[str, Mapping[str, Decimal]],
    holm_p: Decimal,
) -> dict[str, Any]:
    return {
        **activity_counters(result),
        **robustness(result),
        "attribution": attribution(result),
        "base_bonferroni_lcb": decimal_string(cells["base"]["bonferroni_lcb"]),
        "base_centered_one_sided_p": decimal_string(cells["base"]["centered_one_sided_p"]),
        "bootstrap_interval_usd_per_1000": {
            scenario: [
                decimal_string(cells[scenario]["interval_lower"]),
                decimal_string(cells[scenario]["interval_upper"]),
            ]
            for scenario in SCENARIOS
        },
        "holm_adjusted_p": decimal_string(holm_p),
        "net_usd_per_1000_by_scenario": {
            scenario: decimal_string(cells[scenario]["observed"]) for scenario in SCENARIOS
        },
        "public_capacity_proxy_usd": capacity_summary(result),
        "severe_hourly_marked_equity_max_drawdown": decimal_string(
            severe_hourly_max_drawdown(market, result, partition)
        ),
        "stress_bonferroni_lcb": decimal_string(cells["stress"]["bonferroni_lcb"]),
        "stress_centered_one_sided_p": decimal_string(cells["stress"]["centered_one_sided_p"]),
        "trial_id": result.trial.trial_id,
    }


def _net(summary: Mapping[str, Any], scenario: str) -> Decimal:
    return Decimal(str(cast(Mapping[str, str], summary["net_usd_per_1000_by_scenario"])[scenario]))


def _capacity_minimum(summary: Mapping[str, Any]) -> Decimal | None:
    value = cast(Mapping[str, Any], summary["public_capacity_proxy_usd"])["minimum"]
    return None if value == "UNMEASURED" else Decimal(str(value))


def development_gates(
    summary: Mapping[str, Any],
    white: Mapping[str, Decimal],
    pbo: Mapping[str, Any],
) -> dict[str, bool]:
    threshold = DEVELOPMENT_GATE_THRESHOLDS
    capacity = _capacity_minimum(summary)
    return {
        "active_cohorts_min": Decimal(int(summary["active_cohorts"]))
        >= threshold["active_cohorts_min"],
        "active_weeks_min": Decimal(int(summary["active_weeks"])) >= threshold["active_weeks_min"],
        "base_capacity_min_usd_gte": capacity is not None
        and capacity >= threshold["base_capacity_min_usd_gte"],
        "base_net_usd_per_1000_gt": _net(summary, "base") > threshold["base_net_usd_per_1000_gt"],
        "bonferroni_base_lower_bound_gt": Decimal(str(summary["base_bonferroni_lcb"]))
        > threshold["bonferroni_base_lower_bound_gt"],
        "bonferroni_stress_lower_bound_gt": Decimal(str(summary["stress_bonferroni_lcb"]))
        > threshold["bonferroni_stress_lower_bound_gt"],
        "champion_holm_p_lte": Decimal(str(summary["holm_adjusted_p"]))
        <= threshold["champion_holm_p_lte"],
        "distinct_traded_symbols_min": Decimal(int(summary["distinct_traded_symbols"]))
        >= threshold["distinct_traded_symbols_min"],
        "pbo_lte": Decimal(str(pbo["pbo"])) <= threshold["pbo_lte"],
        "remove_best_month_stress_net_usd_per_1000_gt": Decimal(
            str(summary["remove_best_month_stress_net_usd_per_1000"])
        )
        > threshold["remove_best_month_stress_net_usd_per_1000_gt"],
        "remove_best_symbol_stress_net_usd_per_1000_gt": Decimal(
            str(summary["remove_best_symbol_stress_net_usd_per_1000"])
        )
        > threshold["remove_best_symbol_stress_net_usd_per_1000_gt"],
        "severe_hourly_marked_equity_max_drawdown_lte": Decimal(
            str(summary["severe_hourly_marked_equity_max_drawdown"])
        )
        <= threshold["severe_hourly_marked_equity_max_drawdown_lte"],
        "stress_net_usd_per_1000_gt": _net(summary, "stress")
        > threshold["stress_net_usd_per_1000_gt"],
        "white_reality_check_base_p_lte": white["base"]
        <= threshold["white_reality_check_base_p_lte"],
        "white_reality_check_stress_p_lte": white["stress"]
        <= threshold["white_reality_check_stress_p_lte"],
    }


def select_champion(summaries: Sequence[Mapping[str, Any]]) -> str:
    """Maximise min(base, stress) Bonferroni lower bound, then the frozen tie-breaks."""

    winner = min(
        summaries,
        key=lambda summary: (
            -min(
                Decimal(str(summary["base_bonferroni_lcb"])),
                Decimal(str(summary["stress_bonferroni_lcb"])),
            ),
            -_net(summary, "stress"),
            Decimal(str(summary["severe_hourly_marked_equity_max_drawdown"])),
            str(summary["trial_id"]),
        ),
    )
    return str(winner["trial_id"])


def development_document(
    packet_root: Path,
    market: MarketData,
    results: Sequence[TrialResult],
    partition: Partition,
) -> tuple[dict[str, Any], str, str | None]:
    days = partition_days(partition)
    counts = bootstrap_counts(len(days), partition.partition_id)
    vectors = {
        result.trial.trial_id: {
            scenario: daily_vector(result, days, scenario) for scenario in SCENARIOS
        }
        for result in results
    }
    cells, white = family_statistics(vectors, counts)
    raw_holm = {
        trial_id: max(
            cells[trial_id]["base"]["centered_one_sided_p"],
            cells[trial_id]["stress"]["centered_one_sided_p"],
        )
        for trial_id in cells
    }
    holm = holm_adjusted(raw_holm)
    pbo = cscv_pbo(vectors, len(days))
    summaries = [
        trial_summary(
            market, result, partition, cells[result.trial.trial_id], holm[result.trial.trial_id]
        )
        for result in results
    ]
    enriched: list[dict[str, Any]] = []
    eligible: list[dict[str, Any]] = []
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
    champion = select_champion(eligible) if eligible else None
    reported = champion if champion is not None else select_champion(enriched)
    reported_row = next(row for row in enriched if row["trial_id"] == reported)
    document = {
        "admitted_to_holdout": champion is not None,
        "champion_trial_id": champion,
        "created_at": utc_now(),
        "development_archive_member_open_count": MEMBER_OPEN_COUNTS["development"],
        "holdout_archive_member_open_count": 0,
        "outcome_state": "MEASURED",
        "partition_id": partition.partition_id,
        "pbo": pbo,
        "reported_trial_gates": reported_row["development_gates"],
        "reported_trial_id": reported,
        "schema": SCHEMA_BY_RELATIVE["development.v1.json"],
        "scored_days": len(days),
        "selection_metric": "max_min_base_stress_bonferroni_lcb_alpha_over_24",
        "trials": sorted(enriched, key=lambda row: str(row["trial_id"])),
        "verification_evidence": {
            "trials": {
                result.trial.trial_id: trial_verification_evidence(
                    market, result, partition, include_candidates=False
                )
                for result in sorted(results, key=lambda item: item.trial.trial_id)
            }
        },
        "white_reality_check_p_by_scenario": {
            scenario: decimal_string(value) for scenario, value in sorted(white.items())
        },
        **predecessor_record(
            packet_root, "development.v1.json", "opened_source_ledger.v1.json"
        ),
    }
    write_artifact(packet_root, "development.v1.json", document)
    return document, reported, champion


def pointwise_holdout_summary(
    market: MarketData,
    result: TrialResult,
    partition: Partition,
) -> dict[str, Any]:
    """Confirm the sealed champion pointwise; the holdout is never re-searched."""

    days = partition_days(partition)
    counts = bootstrap_counts(len(days), partition.partition_id)
    cells = {
        scenario: scenario_statistics(daily_vector(result, days, scenario), counts)[0]
        for scenario in SCENARIOS
    }
    return {
        **activity_counters(result),
        **robustness(result),
        "attribution": attribution(result),
        "bootstrap_intervals": {
            scenario: [
                decimal_string(cells[scenario]["interval_lower"]),
                decimal_string(cells[scenario]["interval_upper"]),
            ]
            for scenario in SCENARIOS
        },
        "net_usd_per_1000_by_scenario": {
            scenario: decimal_string(cells[scenario]["observed"]) for scenario in SCENARIOS
        },
        "pointwise_lcb": {
            scenario: decimal_string(cells[scenario]["pointwise_lcb"]) for scenario in SCENARIOS
        },
        "public_capacity_proxy_usd": capacity_summary(result),
        "scored_days": len(days),
        "severe_hourly_marked_equity_max_drawdown": decimal_string(
            severe_hourly_max_drawdown(market, result, partition)
        ),
    }


def holdout_gates(summary: Mapping[str, Any]) -> dict[str, bool]:
    threshold = HOLDOUT_GATE_THRESHOLDS
    lcb = cast(Mapping[str, str], summary["pointwise_lcb"])
    capacity = _capacity_minimum(summary)
    return {
        "active_cohorts_min": Decimal(int(summary["active_cohorts"]))
        >= threshold["active_cohorts_min"],
        "active_weeks_min": Decimal(int(summary["active_weeks"])) >= threshold["active_weeks_min"],
        "base_capacity_min_usd_gte": capacity is not None
        and capacity >= threshold["base_capacity_min_usd_gte"],
        "base_net_usd_per_1000_gt": _net(summary, "base") > threshold["base_net_usd_per_1000_gt"],
        "distinct_traded_symbols_min": Decimal(int(summary["distinct_traded_symbols"]))
        >= threshold["distinct_traded_symbols_min"],
        "pointwise_base_lower_bound_gt": Decimal(lcb["base"])
        > threshold["pointwise_base_lower_bound_gt"],
        "pointwise_stress_lower_bound_gt": Decimal(lcb["stress"])
        > threshold["pointwise_stress_lower_bound_gt"],
        "remove_best_month_stress_net_usd_per_1000_gt": Decimal(
            str(summary["remove_best_month_stress_net_usd_per_1000"])
        )
        > threshold["remove_best_month_stress_net_usd_per_1000_gt"],
        "remove_best_symbol_stress_net_usd_per_1000_gt": Decimal(
            str(summary["remove_best_symbol_stress_net_usd_per_1000"])
        )
        > threshold["remove_best_symbol_stress_net_usd_per_1000_gt"],
        "severe_hourly_marked_equity_max_drawdown_lte": Decimal(
            str(summary["severe_hourly_marked_equity_max_drawdown"])
        )
        <= threshold["severe_hourly_marked_equity_max_drawdown_lte"],
        "stress_net_usd_per_1000_gt": _net(summary, "stress")
        > threshold["stress_net_usd_per_1000_gt"],
    }


def custody_document(
    development_state: str,
    holdout_state: str,
    holdout_open_count: int,
    exposed: Sequence[str],
) -> dict[str, Any]:
    return {
        "development": {
            "archive_member_open_count": MEMBER_OPEN_COUNTS["development"],
            "months": list(DEVELOPMENT_MONTHS),
            "state": development_state,
            "window": [iso_ms(DEVELOPMENT_START_MS), iso_ms(DEVELOPMENT_END_MS)],
        },
        "embargo": {
            "scored": False,
            "window": [iso_ms(DEVELOPMENT_END_MS), iso_ms(HOLDOUT_START_MS)],
        },
        "holdout": {
            "archive_member_open_count": MEMBER_OPEN_COUNTS["holdout"],
            "header_only_schema_exposed": list(exposed),
            "months": list(HOLDOUT_MONTHS),
            "open_count": holdout_open_count,
            "outcome_rows_opened_before_gates": 0,
            "scored_start": iso_ms(HOLDOUT_START_MS),
            "state": holdout_state,
        },
        "one_run": True,
        "repair_or_rerun": False,
        "screen": {
            "archive_member_open_count": MEMBER_OPEN_COUNTS["screen"],
            "june_only_admission": True,
            "month": SCREEN_MONTHS[0],
            "open_count": 1,
            "outcome_scoring": False,
            "state": "OPENED_ONCE_JUNE_MEMBERSHIP_ONLY",
        },
    }


def result_scaffold(
    presealed: Mapping[str, Any],
    reported_trial_id: str | None,
) -> dict[str, Any]:
    return {
        "account_effective_fees": "UNKNOWN",
        "capital_authority": "NO_GO",
        "causal_policy_effect_claim": False,
        "created_at": utc_now(),
        "effects": EFFECTS,
        "executable_capacity": "UNKNOWN",
        "execution_authority": "NONE",
        "lag_safe_claim": False,
        "limitations": list(LIMITATIONS),
        "n3_handoff": {
            "acceptance_state": "DEFERRED_TO_N3_SUCCESSOR_NEW_VERSION",
            "family_key": presealed["n3_family_key"],
            "frozen_n3_v1_mutation": False,
            "producer_commit": presealed["static_producer_commit"],
            "producer_tree": presealed["static_producer_tree"],
            "protocol_path_and_blob": {
                "git_blob_object_id": next(
                    str(row["git_blob_object_id"])
                    for row in cast(list[dict[str, Any]], presealed["static_files"])
                    if row["repository_relative_path"] == "quant/research/s1t/protocol.v1.json"
                ),
                "repository_relative_path": "quant/research/s1t/protocol.v1.json",
            },
            "result_path_and_blob": "DEFERRED_TO_FINAL_RESULT_COMMIT",
        },
        "observation_label": "RETROSPECTIVE_OBSERVED_SETTLEMENT_ASSOCIATION",
        "positive_edge_claim": False,
        "protocol_id": PROTOCOL_ID,
        "protocol_raw_sha256": presealed["protocol_raw_sha256"],
        "reported_trial_id": reported_trial_id,
        "schema": SCHEMA_BY_RELATIVE["result.v1.json"],
        "static_producer_commit": presealed["static_producer_commit"],
        "static_producer_tree": presealed["static_producer_tree"],
        "strategy_id": STRATEGY_ID,
    }


def unmeasured_result(
    packet_root: Path,
    presealed: Mapping[str, Any],
    stage: str,
    error_code: str,
    predecessor: str,
    completed: Sequence[str],
    exposed: Sequence[str],
    reported_trial_id: str | None = None,
) -> dict[str, Any]:
    """Terminal UNMEASURED: no failed or partial file is treated as complete."""

    bindings = []
    for relative in sorted(completed):
        raw = load_raw(packet_root / relative)
        bindings.append(
            {
                "byte_count": len(raw),
                "raw_sha256": sha256_bytes(raw),
                "relative_path": relative,
            }
        )
    development_state, holdout_state, holdout_opens = {
        "screen": ("UNOPENED", "UNOPENED", 0),
        "run": ("RUN_CONSUMED_UNMEASURED", "UNOPENED", 0),
        "holdout": ("MEASURED_ONCE", "OPENED_ONCE_CHAMPION_ONLY", 1),
    }[stage]
    return {
        **result_scaffold(presealed, reported_trial_id),
        "activity_counters": None,
        "bootstrap_intervals": None,
        "development_and_holdout_custody": custody_document(
            development_state, holdout_state, holdout_opens, exposed
        ),
        "failure_binding": {
            "completed_artifact_bindings": bindings,
            "error_code": error_code,
            "stage": stage,
        },
        "holdout_state": holdout_state,
        "holm_p_values": None,
        "net_usd_per_1000_by_scenario": dict.fromkeys(SCENARIOS),
        "outcome_state": "TERMINAL_UNMEASURED",
        "pbo": None,
        "price_funding_fee_and_adverse_attribution": None,
        "public_capacity_proxy": None,
        "remove_best_symbol_and_month_stress_net": None,
        "severe_hourly_marked_equity_max_drawdown": None,
        "verdict": "UNMEASURED_RUN_CONSUMED_NO_RERUN",
        "white_reality_check_p_by_scenario": None,
        **predecessor_record(packet_root, "result.v1.json", predecessor),
    }


def measured_result(
    packet_root: Path,
    presealed: Mapping[str, Any],
    development: Mapping[str, Any],
    reported_trial_id: str,
    holdout: Mapping[str, Any] | None,
    exposed: Sequence[str],
) -> dict[str, Any]:
    rows = cast(Sequence[Mapping[str, Any]], development["trials"])
    source: Mapping[str, Any] = next(
        row for row in rows if row["trial_id"] == reported_trial_id
    )
    intervals_key = "bootstrap_interval_usd_per_1000"
    predecessor = "development.v1.json"
    holdout_state = "UNOPENED"
    verdict = "NO_GO_DEVELOPMENT_HOLDOUT_UNOPENED"
    outcome = "MEASURED_DEVELOPMENT_REJECTED"
    if holdout is not None:
        source = cast(Mapping[str, Any], holdout["summary"])
        intervals_key = "bootstrap_intervals"
        predecessor = "holdout.v1.json"
        holdout_state = "OPENED_ONCE_CHAMPION_ONLY"
        verdict = (
            "PUBLIC_PROXY_PASS_CAPITAL_NO_GO" if holdout.get("all_gates_pass") is True else "NO_GO"
        )
        outcome = "MEASURED_HOLDOUT"
    return {
        **result_scaffold(presealed, reported_trial_id),
        "activity_counters": {
            key: source[key] for key in ACTIVITY_COUNTER_FIELDS if key in source
        },
        "bootstrap_intervals": source[intervals_key],
        "development_and_holdout_custody": custody_document(
            "MEASURED_ONCE", holdout_state, 0 if holdout is None else 1, exposed
        ),
        "holdout_state": holdout_state,
        "holm_p_values": {row["trial_id"]: row["holm_adjusted_p"] for row in rows},
        "net_usd_per_1000_by_scenario": source["net_usd_per_1000_by_scenario"],
        "outcome_state": outcome,
        "pbo": development["pbo"],
        "price_funding_fee_and_adverse_attribution": source["attribution"],
        "public_capacity_proxy": source["public_capacity_proxy_usd"],
        "remove_best_symbol_and_month_stress_net": {
            "best_stress_month": source["best_stress_month"],
            "best_stress_symbol": source["best_stress_symbol"],
            "remove_best_month_stress_net_usd_per_1000": source[
                "remove_best_month_stress_net_usd_per_1000"
            ],
            "remove_best_symbol_stress_net_usd_per_1000": source[
                "remove_best_symbol_stress_net_usd_per_1000"
            ],
        },
        "severe_hourly_marked_equity_max_drawdown": source[
            "severe_hourly_marked_equity_max_drawdown"
        ],
        "verdict": verdict,
        "white_reality_check_p_by_scenario": development["white_reality_check_p_by_scenario"],
        **predecessor_record(packet_root, "result.v1.json", predecessor),
    }


def require_result_semantics(result: Mapping[str, Any], protocol: Mapping[str, Any]) -> None:
    contract = cast(Mapping[str, Any], protocol["result_contract"])
    missing = [
        field_name
        for field_name in cast(list[str], contract["required_fields"])
        if field_name not in result
    ]
    if missing:
        raise ContractError("RESULT_FIELD_MISSING", ",".join(sorted(missing)))
    if result["capital_authority"] != cast(str, contract["capital_authority_constant"]):
        raise ContractError("CAPITAL_AUTHORITY_INVALID")
    if result["verdict"] not in ALLOWED_VERDICTS:
        raise ContractError("VERDICT_NOT_ALLOWED", str(result["verdict"]))
    if result.get("positive_edge_claim") is not False:
        raise ContractError("POSITIVE_EDGE_CLAIM_FORBIDDEN")
    if result.get("causal_policy_effect_claim") is not False:
        raise ContractError("CAUSAL_CLAIM_FORBIDDEN")
    if result.get("lag_safe_claim") is not False:
        raise ContractError("LAG_SAFE_CLAIM_FORBIDDEN")
    if result.get("account_effective_fees") != "UNKNOWN":
        raise ContractError("ACCOUNT_FEE_MUST_BE_UNKNOWN")
    if result.get("executable_capacity") != "UNKNOWN":
        raise ContractError("EXECUTABLE_CAPACITY_MUST_BE_UNKNOWN")
    effects = result.get("effects")
    if not isinstance(effects, dict) or effects != EFFECTS:
        raise ContractError("EFFECTS_DRIFT")
    if result.get("observation_label") != "RETROSPECTIVE_OBSERVED_SETTLEMENT_ASSOCIATION":
        raise ContractError("OBSERVATION_LABEL_INVALID")
    if result["verdict"] == "UNMEASURED_RUN_CONSUMED_NO_RERUN":
        net = result.get("net_usd_per_1000_by_scenario")
        if not isinstance(net, dict) or tuple(sorted(net)) != tuple(sorted(SCENARIOS)):
            raise ContractError("UNMEASURED_NET_FIELD_SET_INVALID")
        if any(value is not None for value in net.values()):
            raise ContractError("UNMEASURED_MUST_NOT_FABRICATE_ZERO")
        failure = result.get("failure_binding")
        if not isinstance(failure, dict) or tuple(sorted(failure)) != FAILURE_BINDING_FIELDS:
            raise ContractError("FAILURE_BINDING_FIELD_SET_INVALID")
        bindings = failure.get("completed_artifact_bindings")
        if not isinstance(bindings, list) or not bindings:
            raise ContractError("FAILURE_BINDING_EMPTY")
        for binding in cast(list[Any], bindings):
            if not isinstance(binding, dict) or tuple(sorted(binding)) != BINDING_FIELDS:
                raise ContractError("FAILURE_BINDING_ENTRY_FIELD_SET_INVALID")
    elif result.get("failure_binding") is not None:
        raise ContractError("MEASURED_RESULT_HAS_FAILURE_BINDING")


def packet_relative_files(packet_root: Path) -> list[str]:
    names = [
        path.relative_to(packet_root).as_posix()
        for path in packet_root.rglob("*")
        if path.is_file() and not path.is_symlink()
    ]
    return sorted(
        (name for name in names if name != "SHA256SUMS"), key=lambda item: item.encode("utf-8")
    )


def sha256sums_text(packet_root: Path) -> str:
    return "".join(
        f"{sha256_path(packet_root / name)}  {name}\n"
        for name in packet_relative_files(packet_root)
    )


def finalize_packet(packet_root: Path, result: Mapping[str, Any]) -> str:
    result_digest = write_artifact(packet_root, "result.v1.json", result)
    net = result.get("net_usd_per_1000_by_scenario")
    net_text = "UNMEASURED"
    if isinstance(net, dict):
        net_text = "; ".join(f"{key}={net.get(key)}" for key in SCENARIOS)
    intervals = result.get("bootstrap_intervals")
    interval_text = "UNMEASURED"
    if isinstance(intervals, dict):
        interval_text = "; ".join(f"{key}={intervals.get(key)}" for key in SCENARIOS)
    holm = result.get("holm_p_values")
    white = result.get("white_reality_check_p_by_scenario")
    pbo = result.get("pbo")
    multiplicity = "UNMEASURED"
    if isinstance(holm, dict) and isinstance(white, dict) and isinstance(pbo, dict):
        values = sorted(Decimal(str(value)) for value in holm.values())
        multiplicity = (
            f"Holm min/max={decimal_string(values[0])}/{decimal_string(values[-1])}; "
            f"White base/stress={white.get('base')}/{white.get('stress')}; PBO={pbo.get('pbo')}"
        )
    custody = result.get("development_and_holdout_custody")
    custody_text = "UNMEASURED"
    if isinstance(custody, dict):
        development = custody.get("development")
        holdout = custody.get("holdout")
        if isinstance(development, dict) and isinstance(holdout, dict):
            custody_text = (
                f"development={development.get('state')}; holdout={holdout.get('state')}; "
                f"holdout opens={holdout.get('open_count')}"
            )
    drawdown = result.get("severe_hourly_marked_equity_max_drawdown")
    capacity = result.get("public_capacity_proxy")
    report = (
        f"# S-1T packet report\n\n"
        f"`result.v1.json` raw SHA-256: `{result_digest}`\n\n"
        f"That digest is the SHA-256 of the exact canonical bytes of `result.v1.json` as\n"
        f"written, and `SHA256SUMS` repeats it alongside every other final packet file.\n"
        f"Recompute it with `shasum -a 256 result.v1.json`.\n\n"
        f"S-1T reports a retrospective observational association only. The decision hour is\n"
        f"a simulation index after the final confirmation settlement, not a proven\n"
        f"live-public availability time. Capital authority is NO_GO in every branch.\n\n"
        f"| item | expected | found | status |\n"
        f"|---|---|---|---|\n"
        f"| S-1T verdict | sealed public-only verdict | {result['verdict']} | FINAL |\n"
        f"| producer commit | clean child of the canonical base | "
        f"{result['static_producer_commit']} | PINNED |\n"
        f"| net USD per $1k | base; stress; severe | {net_text} | SEALED |\n"
        f"| reported interval | base; stress; severe | {interval_text} | SEALED |\n"
        f"| multiplicity | Holm; White; PBO | {multiplicity} | SEALED |\n"
        f"| severe hourly drawdown | fixed $1k denominator | "
        f"{drawdown if drawdown is not None else 'UNMEASURED'} | SEALED |\n"
        f"| public capacity | coarse prior-volume proxy only | "
        f"{capacity if capacity is not None else 'UNMEASURED'} | NON_EXECUTABLE |\n"
        f"| holdout custody | gate-bound champion only | {custody_text} | SEALED |\n"
        f"| executable limits | no capital authority | account fees="
        f"{result['account_effective_fees']}; executable capacity="
        f"{result['executable_capacity']}; capital={result['capital_authority']} | NO_GO |\n"
    )
    write_packet_text(packet_root, "REPORT.md", report)
    write_packet_text(packet_root, "SHA256SUMS", sha256sums_text(packet_root))
    return result_digest


def run(packet_root: Path) -> dict[str, Any]:
    """One irreversible development run; a second invocation refuses."""

    root, presealed, protocol, plan, cache_root = bind_packet_stage(packet_root)
    exposed = sorted(exposed_relative_paths(plan))
    artifacts = revalidate_frozen_chain(root)
    completed = ["preseal.v1.json", "screen_consumed.v1.json", "screen_universe.v1.json",
                 "source_manifest.v1.json", "freeze.v1.json"]

    marker = {
        "allowed_run_count": 1,
        "created_at": utc_now(),
        "development_archive_member_open_count_before": 0,
        "holdout_archive_member_open_count_before": 0,
        "marker_created_before_any_development_member": True,
        "run_ordinal": 1,
        "schema": SCHEMA_BY_RELATIVE["run_consumed.v1.json"],
        "static_producer_commit": presealed["static_producer_commit"],
        **predecessor_record(root, "run_consumed.v1.json", "freeze.v1.json"),
    }
    write_artifact(root, "run_consumed.v1.json", marker)
    completed.append("run_consumed.v1.json")
    try:
        # The screen ran in a separate process; carry its recorded count forward so
        # the custody block reports the true June total rather than this run's zero.
        recorded_screen_opens = artifacts["screen_universe.v1.json"].get(
            "screen_archive_member_open_count"
        )
        if not isinstance(recorded_screen_opens, int) or recorded_screen_opens < 0:
            raise ContractError("SCREEN_MEMBER_OPEN_COUNT_INVALID")
        # run_consumed is itself re-authenticated and linked to freeze before the
        # first development member may be decompressed.
        revalidate_chain_through(root, "run_consumed.v1.json")
        set_member_open_stage("development")
        MEMBER_OPEN_COUNTS["screen"] = recorded_screen_opens

        universe = tuple(
            str(symbol)
            for symbol in _tuple_of(
                artifacts["screen_universe.v1.json"].get("fixed_universe")
            )
        )
        index = manifest_index(artifacts["source_manifest.v1.json"])
    except (EvidenceError, ContractError) as exc:
        result = unmeasured_result(
            root, presealed, "run", exc.code, completed[-1], completed, exposed
        )
        require_result_semantics(result, protocol)
        finalize_packet(root, result)
        return result

    ledger = OpenedLedger()
    try:
        if not universe:
            raise EvidenceError("FIXED_UNIVERSE_EMPTY")
        market, seeds = load_partition_funding(
            cache_root, root, index, universe, DEVELOPMENT, "development", ledger
        )
        event_universe = event_universe_document(root, seeds, DEVELOPMENT)
        write_artifact(root, "event_universe.v1.json", event_universe)
        completed.append("event_universe.v1.json")
        needed = in_horizon_symbols(seeds, DEVELOPMENT)
        load_partition_bars(
            cache_root, root, index, market, needed, DEVELOPMENT, "development", ledger
        )
        opened = {
            "created_at": utc_now(),
            "development_archive_member_open_count": MEMBER_OPEN_COUNTS["development"],
            "in_horizon_symbol_count": len(needed),
            "in_horizon_symbols": list(needed),
            "opened_members": ledger.rows,
            "opened_member_count": len(ledger.rows),
            "partition_id": DEVELOPMENT.partition_id,
            "schema": SCHEMA_BY_RELATIVE["opened_source_ledger.v1.json"],
            **predecessor_record(
                root, "opened_source_ledger.v1.json", "event_universe.v1.json"
            ),
        }
        write_artifact(root, "opened_source_ledger.v1.json", opened)
        completed.append("opened_source_ledger.v1.json")
        results = tuple(
            evaluate_trial(market, seeds[trial.confirmation_rows], trial, DEVELOPMENT)
            for trial in trial_family()
        )
        development, reported, champion = development_document(root, market, results, DEVELOPMENT)
        completed.append("development.v1.json")
    except (EvidenceError, ContractError) as exc:
        result = unmeasured_result(
            root, presealed, "run", exc.code, completed[-1], completed, exposed
        )
        require_result_semantics(result, protocol)
        finalize_packet(root, result)
        return result

    if champion is None:
        # A valid all-cash or gate-failing development is MEASURED: the net is an
        # observed zero-or-negative figure, never a fabricated one, and the
        # holdout stays sealed.
        try:
            result = measured_result(root, presealed, development, reported, None, exposed)
            require_result_semantics(result, protocol)
        except (EvidenceError, ContractError) as exc:
            result = unmeasured_result(
                root, presealed, "run", exc.code, completed[-1], completed, exposed
            )
            require_result_semantics(result, protocol)
        finalize_packet(root, result)
        return result

    champion_trial = next(trial for trial in trial_family() if trial.trial_id == champion)
    try:
        candidate = {
            "champion_trial_id": champion,
            "created_at": utc_now(),
            "reselection_forbidden": True,
            "schema": SCHEMA_BY_RELATIVE["candidate_seal.v1.json"],
            "trial_parameters": {
                "confirmation_rows": champion_trial.confirmation_rows,
                "entry_lag_hours": champion_trial.entry_lag_hours,
                "hold_hours": champion_trial.hold_hours,
            },
            **predecessor_record(root, "candidate_seal.v1.json", "development.v1.json"),
        }
        write_artifact(root, "candidate_seal.v1.json", candidate)
        completed.append("candidate_seal.v1.json")
        # Every branch predecessor from freeze through the sealed champion is
        # re-authenticated before the holdout seal may be broken.
        revalidate_chain_through(root, "candidate_seal.v1.json")
        open_marker = {
            "allowed_holdout_open_count": 1,
            "champion_trial_id": champion,
            "created_at": utc_now(),
            "holdout_archive_member_open_count_before": 0,
            "holdout_open_ordinal": 1,
            "marker_created_before_first_holdout_member": True,
            "schema": SCHEMA_BY_RELATIVE["holdout_open.v1.json"],
            **predecessor_record(root, "holdout_open.v1.json", "candidate_seal.v1.json"),
        }
        write_artifact(root, "holdout_open.v1.json", open_marker)
        completed.append("holdout_open.v1.json")
        revalidate_chain_through(root, "holdout_open.v1.json")
        set_member_open_stage("holdout")
    except (EvidenceError, ContractError) as exc:
        stage = "holdout" if "holdout_open.v1.json" in completed else "run"
        result = unmeasured_result(
            root, presealed, stage, exc.code, completed[-1], completed, exposed, reported
        )
        require_result_semantics(result, protocol)
        finalize_packet(root, result)
        return result

    holdout_ledger = OpenedLedger()
    try:
        holdout_market, holdout_seeds = load_partition_funding(
            cache_root, root, index, universe, HOLDOUT, "holdout", holdout_ledger
        )
        holdout_needed = in_horizon_symbols(holdout_seeds, HOLDOUT)
        load_partition_bars(
            cache_root, root, index, holdout_market, holdout_needed, HOLDOUT, "holdout",
            holdout_ledger,
        )
        holdout_result = evaluate_trial(
            holdout_market, holdout_seeds[champion_trial.confirmation_rows], champion_trial, HOLDOUT
        )
        summary = pointwise_holdout_summary(holdout_market, holdout_result, HOLDOUT)
        gates = holdout_gates(summary)
        holdout = {
            "all_gates_pass": all(gates.values()),
            "champion_trial_id": champion,
            "created_at": utc_now(),
            "gates": gates,
            "holdout_archive_member_open_count": MEMBER_OPEN_COUNTS["holdout"],
            "in_horizon_symbols": list(holdout_needed),
            "opened_members": holdout_ledger.rows,
            "outcome_state": "MEASURED",
            "partition_id": HOLDOUT.partition_id,
            "reselection": False,
            "schema": SCHEMA_BY_RELATIVE["holdout.v1.json"],
            "summary": summary,
            "verification_evidence": trial_verification_evidence(
                holdout_market,
                holdout_result,
                HOLDOUT,
                include_candidates=True,
            ),
            **predecessor_record(root, "holdout.v1.json", "holdout_open.v1.json"),
        }
    except (EvidenceError, ContractError) as exc:
        result = unmeasured_result(
            root, presealed, "holdout", exc.code, "holdout_open.v1.json", completed, exposed,
            reported,
        )
        require_result_semantics(result, protocol)
        finalize_packet(root, result)
        return result

    try:
        write_artifact(root, "holdout.v1.json", holdout)
        completed.append("holdout.v1.json")
        result = measured_result(root, presealed, development, champion, holdout, exposed)
        require_result_semantics(result, protocol)
    except (EvidenceError, ContractError) as exc:
        result = unmeasured_result(
            root, presealed, "holdout", exc.code, completed[-1], completed, exposed, reported
        )
        require_result_semantics(result, protocol)
    finalize_packet(root, result)
    return result


def validate_failure_binding(
    packet_root: Path,
    result: Mapping[str, Any],
    present: Iterable[str],
) -> str:
    """Exact-set validation of a terminal UNMEASURED failure binding.

    No failed or partial file may be treated as complete: every bound artifact must
    exist, still hash to its recorded digest, and be a chain member; the declared
    predecessor must itself be one of the bound artifacts.
    """

    failure = result.get("failure_binding")
    if not isinstance(failure, dict) or tuple(sorted(failure)) != FAILURE_BINDING_FIELDS:
        raise ContractError("FAILURE_BINDING_FIELD_SET_INVALID")
    if not isinstance(failure.get("stage"), str) or not failure["stage"]:
        raise ContractError("FAILURE_BINDING_STAGE_INVALID")
    if not isinstance(failure.get("error_code"), str) or not failure["error_code"]:
        raise ContractError("FAILURE_BINDING_ERROR_CODE_INVALID")
    bindings = failure.get("completed_artifact_bindings")
    if not isinstance(bindings, list) or not bindings:
        raise ContractError("FAILURE_BINDING_EMPTY")
    bound: list[str] = []
    for binding in cast(list[Any], bindings):
        if not isinstance(binding, dict) or tuple(sorted(binding)) != BINDING_FIELDS:
            raise ContractError("FAILURE_BINDING_ENTRY_FIELD_SET_INVALID")
        relative = str(binding.get("relative_path"))
        if relative not in SCHEMA_BY_RELATIVE:
            raise ContractError("FAILURE_BINDING_NOT_CHAIN_MEMBER", relative)
        if relative not in set(present):
            raise ContractError("FAILURE_BINDING_ARTIFACT_ABSENT", relative)
        raw = load_raw(packet_root / relative)
        if binding.get("raw_sha256") != sha256_bytes(raw) or binding.get("byte_count") != len(raw):
            raise ContractError("FAILURE_BINDING_DRIFT", relative)
        bound.append(relative)
    if bound != sorted(bound) or len(set(bound)) != len(bound):
        raise ContractError("FAILURE_BINDING_UNSORTED_OR_DUPLICATE")
    if "preseal.v1.json" not in bound:
        raise ContractError("FAILURE_BINDING_MISSING_PRESEAL")
    predecessor = str(result.get("predecessor_relative_path"))
    if predecessor not in bound:
        raise ContractError("FAILURE_PREDECESSOR_UNBOUND", predecessor)
    return predecessor


def validate_sha256sums(packet_root: Path) -> int:
    """Authenticate SHA256SUMS by parsing it; a regenerated file cannot bless tamper.

    The stored listing is parsed line by line, every listed digest is recomputed
    from the packet bytes, and the listed path set must equal the current packet
    file set exactly.  A tampered, added, or removed file therefore fails here
    rather than being silently absorbed by comparing regenerated text to itself.
    """

    path = packet_root / "SHA256SUMS"
    require_completed_artifact(path)
    text = load_raw(path).decode("utf-8")
    if text and not text.endswith("\n"):
        raise ContractError("SHA256SUMS_UNTERMINATED")
    listed: dict[str, str] = {}
    order: list[str] = []
    for number, line in enumerate(text.splitlines(), start=1):
        match = SHA256SUMS_LINE_RE.fullmatch(line)
        if match is None:
            raise ContractError("SHA256SUMS_LINE_INVALID", str(number))
        digest, relative = match.group(1), match.group(2)
        if relative in listed:
            raise ContractError("SHA256SUMS_DUPLICATE_PATH", relative)
        listed[relative] = digest
        order.append(relative)
    if order != sorted(order, key=lambda item: item.encode("utf-8")):
        raise ContractError("SHA256SUMS_NOT_BYTEWISE_SORTED")
    current = packet_relative_files(packet_root)
    if order != current:
        missing = sorted(set(current) - set(order))
        extra = sorted(set(order) - set(current))
        raise ContractError(
            "SHA256SUMS_PATH_SET_MISMATCH",
            f"unlisted={','.join(missing)};absent={','.join(extra)}",
        )
    for relative, digest in listed.items():
        if sha256_path(packet_root / relative) != digest:
            raise ContractError("SHA256SUMS_DIGEST_DRIFT", relative)
    return len(listed)


def verify(packet_root: Path) -> dict[str, Any]:
    """Authenticate lineage, every conditional link, result semantics and the packet."""

    root, presealed, protocol, _plan, _cache_root = bind_packet_stage(packet_root)
    artifacts: dict[str, dict[str, Any]] = {}
    result, result_digest = load_artifact(
        root, "result.v1.json", SCHEMA_BY_RELATIVE["result.v1.json"]
    )
    require_result_semantics(result, protocol)

    for field_name in ("static_producer_commit", "static_producer_tree", "protocol_raw_sha256"):
        if result.get(field_name) != presealed.get(field_name):
            raise ContractError("RESULT_LINEAGE_DRIFT", field_name)
    if result.get("static_producer_commit") == CANONICAL_BASE:
        raise ContractError("RESULT_PRODUCER_EQUALS_BASE")
    handoff = result.get("n3_handoff")
    if not isinstance(handoff, dict) or handoff.get("family_key") != presealed.get("n3_family_key"):
        raise ContractError("RESULT_N3_HANDOFF_DRIFT")

    verdict = str(result["verdict"])
    present = {
        relative
        for relative in SCHEMA_BY_RELATIVE
        if (root / relative).is_file()
    }
    if verdict == "UNMEASURED_RUN_CONSUMED_NO_RERUN":
        expected_predecessor = validate_failure_binding(root, result, present)
        artifacts.update(revalidate_terminal_prefix(root, expected_predecessor))
    elif verdict == "NO_GO_DEVELOPMENT_HOLDOUT_UNOPENED":
        expected_predecessor = "development.v1.json"
        for forbidden in ("candidate_seal.v1.json", "holdout_open.v1.json", "holdout.v1.json"):
            if forbidden in present:
                raise ContractError("HOLDOUT_ARTIFACT_PRESENT_WHILE_UNOPENED", forbidden)
        if result.get("holdout_state") != "UNOPENED":
            raise ContractError("HOLDOUT_STATE_INVALID")
        artifacts.update(revalidate_chain_through(root, "development.v1.json"))
        if result.get("failure_binding") is not None:
            raise ContractError("MEASURED_RESULT_HAS_FAILURE_BINDING")
    else:
        expected_predecessor = "holdout.v1.json"
        artifacts.update(revalidate_chain_through(root, "holdout.v1.json"))
        passes = artifacts["holdout.v1.json"].get("all_gates_pass") is True
        if (verdict == "PUBLIC_PROXY_PASS_CAPITAL_NO_GO") != passes:
            raise ContractError("VERDICT_CONTRADICTS_HOLDOUT_GATES")
        if result.get("holdout_state") != "OPENED_ONCE_CHAMPION_ONLY":
            raise ContractError("HOLDOUT_STATE_INVALID")
        if result.get("failure_binding") is not None:
            raise ContractError("MEASURED_RESULT_HAS_FAILURE_BINDING")
    require_predecessor(root, result, "result.v1.json", expected_predecessor)

    if verdict != "UNMEASURED_RUN_CONSUMED_NO_RERUN":
        if artifacts["event_universe.v1.json"].get("forward_returns_included") is not False:
            raise ContractError("EVENT_UNIVERSE_CARRIES_RETURNS")
        if artifacts["event_universe.v1.json"].get("lag_safe_claim") is not False:
            raise ContractError("EVENT_UNIVERSE_CLAIMS_LAG_SAFE")

    manifest = artifacts.get("source_manifest.v1.json")
    index = manifest_index(manifest) if manifest is not None else {}
    sealed = 0
    copied = 0
    for (symbol, month, dataset_name), entry in sorted(index.items()):
        dataset = DATASET_BY_PLAN_NAME.get(dataset_name)
        if dataset is None:
            raise ContractError("MANIFEST_DATASET_INVALID", dataset_name)
        if entry.get("member_state") == "SEALED_UNOPENED":
            sealed += 1
        packet_zip = root / "sources" / Path(*archive_relative_path(dataset, symbol, month).parts)
        if not packet_zip.exists():
            continue
        copied += 1
        if sha256_path(packet_zip) != entry.get("cache_zip_sha256"):
            raise ContractError("PACKET_SOURCE_DIGEST_DRIFT", packet_zip.name)
        official = parse_official_checksum(load_raw(sidecar_of(packet_zip)), packet_zip.name)
        if official != entry.get("official_zip_sha256"):
            raise ContractError("PACKET_SIDECAR_DRIFT", packet_zip.name)

    listed_files = validate_sha256sums(root)
    report = load_raw(root / "REPORT.md").decode("utf-8")
    if result_digest not in report:
        raise ContractError("REPORT_RESULT_DIGEST_MISSING")

    status = {
        "manifest_entries": len(index),
        "packet_files": listed_files,
        "packet_source_copies": copied,
        "result_raw_sha256": result_digest,
        "sealed_unopened_entries": sealed,
        "static_producer_commit": str(presealed["static_producer_commit"]),
        "verdict": verdict,
    }
    print(
        "S1T_VERIFY_OK "
        f"verdict={status['verdict']} result_sha256={status['result_raw_sha256']} "
        f"producer={status['static_producer_commit']} files={status['packet_files']} "
        f"manifest={status['manifest_entries']} copies={status['packet_source_copies']} "
        f"sealed={status['sealed_unopened_entries']}"
    )
    return status


def synthetic_regression_checks() -> dict[str, str]:
    """Exercise checksum freeze and parent-fsync rollback using temporary bytes only.

    This is intentionally disconnected from the packet lifecycle: it never reads a
    cached archive member, never invokes a stage, and leaves no packet behind.  It
    exists to keep the two failure boundaries that are easy to regress executable.
    """

    global fsync_directory
    with tempfile.TemporaryDirectory(prefix="cosmos-s1t-engine-self-check-") as raw_root:
        root = Path(raw_root)
        cache_root = root / "synthetic-cache"
        make_packet_directory(cache_root)
        symbol = "SYNTHUSDT"
        # A later holdout month proves checksum equality is enforced while outcome
        # rows remain sealed, rather than being deferred to a scored-member open.
        relative = archive_relative_path("fundingRate", symbol, HOLDOUT_MONTHS[-1])
        cache_zip = cache_root / Path(*relative.parts)
        make_packet_directory(cache_zip.parent)
        exclusive_create(cache_zip, b"synthetic-checksum-mismatch\n")
        exclusive_create(
            sidecar_of(cache_zip),
            f"{'0' * 64}  {cache_zip.name}\n".encode("ascii"),
        )
        try:
            build_source_inventory(cache_root, (symbol,), frozenset())
        except EvidenceError as exc:
            if exc.code != "INVENTORY_OFFICIAL_CHECKSUM_MISMATCH":
                raise ContractError("SYNTHETIC_INVENTORY_WRONG_FAILURE", exc.code) from exc
        else:
            raise ContractError("SYNTHETIC_INVENTORY_CHECKSUM_ACCEPTED")

        def assert_parent_fsync_rollback(
            destination: Path,
            attempt: Any,
            label: str,
        ) -> None:
            global fsync_directory
            original_fsync_directory = fsync_directory
            faulted = False

            def fail_once(path: Path) -> None:
                nonlocal faulted
                if path == destination.parent and not faulted:
                    faulted = True
                    raise ContractError("SYNTHETIC_PARENT_FSYNC_FAULT", label)
                original_fsync_directory(path)

            fsync_directory = fail_once
            try:
                try:
                    attempt()
                except ContractError as exc:
                    if exc.code != "SYNTHETIC_PARENT_FSYNC_FAULT":
                        raise ContractError(
                            "SYNTHETIC_PARENT_FSYNC_WRONG_FAILURE",
                            f"{label}:{exc.code}",
                        ) from exc
                else:
                    raise ContractError("SYNTHETIC_PARENT_FSYNC_ACCEPTED", label)
            finally:
                fsync_directory = original_fsync_directory
            if destination.exists():
                raise ContractError("SYNTHETIC_PARENT_FSYNC_ROLLBACK_FAILED", label)

        artifact_parent = root / "synthetic-artifacts"
        make_packet_directory(artifact_parent)
        artifact = artifact_parent / "parent-fsync-artifact.json"
        assert_parent_fsync_rollback(
            artifact,
            lambda: exclusive_create(artifact, b"synthetic-artifact\n"),
            "exclusive_create",
        )

        source_parent = root / "synthetic-copy-source"
        destination_parent = root / "synthetic-copy-destination"
        make_packet_directory(source_parent)
        make_packet_directory(destination_parent)
        source = source_parent / "source.bin"
        destination = destination_parent / "destination.bin"
        exclusive_create(source, b"synthetic-source\n")
        descriptor = open_source_readonly(source)
        try:
            assert_parent_fsync_rollback(
                destination,
                lambda: _stream_copy(descriptor, destination),
                "_stream_copy",
            )
        finally:
            os.close(descriptor)
    return {
        "inventory_checksum_mismatch": "PASS",
        "exclusive_create_parent_fsync_rollback": "PASS",
        "stream_copy_parent_fsync_rollback": "PASS",
    }


def default_packet_root() -> Path:
    try:
        declared = load_json_file(HERE / "source_plan.v1.json").get("packet_root_default")
    except ContractError:
        declared = None
    if not isinstance(declared, str) or not declared.startswith("/"):
        return Path(f"/private/tmp/cosmos-{PROTOCOL_ID}")
    return Path(declared)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Sealed S-1T public research engine.")
    commands = parser.add_subparsers(dest="command", required=True)
    default_root = default_packet_root()
    preseal_parser = commands.add_parser("preseal")
    preseal_parser.add_argument("--packet-root", type=Path, default=default_root)
    preseal_parser.add_argument("--protocol", type=Path, default=HERE)
    for name in ("screen", "run", "verify"):
        child = commands.add_parser(name)
        child.add_argument("--packet-root", type=Path, default=default_root)
    commands.add_parser("self-check")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = build_parser().parse_args(sys.argv[1:] if argv is None else argv)
    try:
        if arguments.command == "preseal":
            preseal(arguments.packet_root, arguments.protocol)
        elif arguments.command == "screen":
            screen(arguments.packet_root)
        elif arguments.command == "run":
            run(arguments.packet_root)
        elif arguments.command == "verify":
            verify(arguments.packet_root)
        elif arguments.command == "self-check":
            checks = synthetic_regression_checks()
            print("S1T_SELF_CHECK_OK " + " ".join(sorted(checks)))
        else:
            raise AssertionError("argparse accepted an unknown command")
    except S1TError as exc:
        print(f"S1T_{arguments.command.upper()}_FAILED:{exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
