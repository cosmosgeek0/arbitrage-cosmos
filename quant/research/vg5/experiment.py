#!/usr/bin/env python3
"""One-use evaluator for the sealed V-G5 Binance Spot experiment."""

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
import stat
import subprocess
import sys
import tempfile
import zipfile
from collections.abc import Iterable, Iterator, Mapping, Sequence
from contextlib import contextmanager
from dataclasses import dataclass, replace
from datetime import UTC, date, datetime, timedelta
from decimal import (
    ROUND_CEILING,
    ROUND_HALF_EVEN,
    Context,
    Decimal,
    DivisionByZero,
    InvalidOperation,
    Overflow,
    getcontext,
    setcontext,
)
from pathlib import Path
from statistics import median
from typing import Any, BinaryIO

FROZEN_DECIMAL_CONTEXT = Context(
    prec=50,
    rounding=ROUND_HALF_EVEN,
    Emin=-999999,
    Emax=999999,
    capitals=1,
    clamp=0,
    traps=[InvalidOperation, DivisionByZero, Overflow],
)
setcontext(FROZEN_DECIMAL_CONTEXT.copy())

D = Decimal
ZERO = D("0")
INITIAL_CAPITAL = D("1000")
PACKET_DIR = Path(__file__).resolve().parent
PROTOCOL_PATH = PACKET_DIR / "protocol.v1.json"
SOURCE_RESEARCH_PATH = PACKET_DIR / "OFFICIAL_SOURCE_RESEARCH.md"
FREEZE_PATH = PACKET_DIR / "freeze.v1.json"
RESULT_PATH = PACKET_DIR / "result.v1.json"
CANDIDATE_SEAL_PATH = PACKET_DIR / "candidate-seal.v1.json"
CHECKSUMS_PATH = PACKET_DIR / "SHA256SUMS"
DEFAULT_STATE_ROOT = Path("/private/tmp/cosmos-vg5-abnormal-volume-breakout-v1")
DEFAULT_SHARED_ROOT = Path("/private/tmp/cosmos-s1f-weekly-momentum-cash-v1")
DEVELOPMENT_MARKER = "development-run-marker.v1.json"
HOLDOUT_MARKER = "holdout-open-marker.v1.json"
EXTERNAL_FREEZE = "freeze-receipt.v1.json"
PREFLIGHT_RECEIPT = "preflight-receipt.v1.json"
REQUIRED_PACKET_FILES = frozenset(
    {
        "OFFICIAL_SOURCE_RESEARCH.md",
        "README.md",
        "__init__.py",
        "experiment.py",
        "freeze.v1.json",
        "protocol.v1.json",
        "result.v1.json",
        "test_experiment.py",
    }
)
OPTIONAL_PACKET_FILES = frozenset({"candidate-seal.v1.json"})
CAPACITY_HEADLINE_KEY = "capacityShareBelowAggregatedSameSymbolSameOpenRequiredNotional"


class EvidenceError(RuntimeError):
    """Raised when a frozen evidence contract cannot be authenticated."""


class MeasurementError(RuntimeError):
    """Raised when the sealed measurement cannot produce a valid verdict."""


@dataclass(frozen=True, slots=True)
class Bar:
    """One authenticated complete Binance Spot daily kline."""

    day: date
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    quote_volume: Decimal
    trade_count: int


@dataclass(frozen=True, slots=True)
class TrialSpec:
    """One member of the fully enumerated 32-attempt family."""

    trial_id: str
    breakout_days: int
    volume_threshold: Decimal
    trend_days: int
    volatility_regime: str
    hold_days: int


@dataclass(frozen=True, slots=True)
class CostScenario:
    """Frozen public cost proxy."""

    name: str
    fee_bps: Decimal
    adverse_bps: Decimal
    capacity_bps: Decimal

    @property
    def fee_rate(self) -> Decimal:
        return self.fee_bps / D("10000")

    @property
    def adverse_rate(self) -> Decimal:
        return self.adverse_bps / D("10000")


@dataclass(frozen=True, slots=True)
class SignalMetric:
    """Causal metrics known after one complete signal-day bar."""

    symbol: str
    volume_multiple: Decimal
    breakout_excess_20_atr: Decimal | None
    breakout_excess_55_atr: Decimal | None
    breakout_20: bool
    breakout_55: bool
    trend_50: bool
    trend_100: bool
    volatility_regime: str


@dataclass(slots=True)
class Position:
    """One live sleeve position."""

    symbol: str
    signal_day: date
    entry_day: date
    exit_day: date
    entry_reference: Decimal
    entry_cash: Decimal
    quantity: Decimal
    signal_quote_volume: Decimal
    trailing_quote_volume: Decimal


@dataclass(slots=True)
class Decomposition:
    """Additive dollar attribution across compounded trades."""

    reference_gross: Decimal = ZERO
    entry_adverse: Decimal = ZERO
    buy_fee: Decimal = ZERO
    exit_adverse: Decimal = ZERO
    sell_fee: Decimal = ZERO
    net: Decimal = ZERO

    def add(self, other: Decomposition) -> None:
        self.reference_gross += other.reference_gross
        self.entry_adverse += other.entry_adverse
        self.buy_fee += other.buy_fee
        self.exit_adverse += other.exit_adverse
        self.sell_fee += other.sell_fee
        self.net += other.net

    def residual(self) -> Decimal:
        return (
            self.reference_gross
            + self.entry_adverse
            + self.buy_fee
            + self.exit_adverse
            + self.sell_fee
            - self.net
        )


@dataclass(frozen=True, slots=True)
class Trade:
    """One completed round trip."""

    symbol: str
    signal_day: date
    entry_day: date
    exit_day: date
    entry_cash: Decimal
    exit_cash: Decimal
    net_return: Decimal
    capacity_usd: Decimal
    entry_reference_notional_usd: Decimal
    exit_reference_notional_usd: Decimal
    required_capacity_notional_usd: Decimal
    capacity_below_sleeve: bool


@dataclass(frozen=True, slots=True)
class TrialRun:
    """One trial/scenario measurement over a frozen period."""

    spec: TrialSpec
    scenario: CostScenario
    period: str
    valid: bool
    invalid_reasons: tuple[str, ...]
    start_nav: Decimal
    end_nav: Decimal
    net_usd: Decimal
    fills: int
    round_trips: int
    distinct_symbols: tuple[str, ...]
    active_months: tuple[str, ...]
    cash_signal_days: int
    trades: tuple[Trade, ...]
    daily_dates: tuple[date, ...]
    daily_returns: tuple[Decimal, ...]
    exit_log_returns_by_day: tuple[Decimal, ...]
    max_drawdown_pct: Decimal
    max_drawdown_usd: Decimal
    min_capacity_usd: Decimal | None
    p05_capacity_usd: Decimal | None
    median_capacity_usd: Decimal | None
    capacity_share_below_sleeve: Decimal | None
    decomposition: Decomposition


def canonical_bytes(value: object) -> bytes:
    """Return the sole JSON serialization used by evidence files."""

    return (
        json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        + b"\n"
    )


def sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def safe_file(path: Path) -> Path:
    """Reject symlinks and non-regular evidence inputs."""

    info = path.lstat()
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
        raise EvidenceError(f"unsafe evidence file: {path}")
    return path


@contextmanager
def open_regular_file(path: Path) -> Iterator[BinaryIO]:
    """Open one regular file without following a final-component symlink."""

    nofollow = getattr(os, "O_NOFOLLOW", None)
    if not isinstance(nofollow, int):
        raise EvidenceError("runtime lacks O_NOFOLLOW")
    descriptor = os.open(path, os.O_RDONLY | nofollow)
    try:
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode):
            raise EvidenceError(f"unsafe evidence file: {path}")
        with os.fdopen(descriptor, "rb") as handle:
            descriptor = -1
            yield handle
    finally:
        if descriptor >= 0:
            os.close(descriptor)


def read_regular_file(path: Path) -> bytes:
    with open_regular_file(path) as handle:
        return handle.read()


def safe_directory(path: Path) -> Path:
    info = path.lstat()
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
        raise EvidenceError(f"unsafe evidence directory: {path}")
    return path


def directory_identity(path: Path) -> dict[str, int]:
    """Return a no-follow device/inode binding for an evidence root."""

    nofollow = getattr(os, "O_NOFOLLOW", None)
    directory = getattr(os, "O_DIRECTORY", None)
    if not isinstance(nofollow, int) or not isinstance(directory, int):
        raise EvidenceError("runtime lacks safe directory-open flags")
    descriptor = os.open(path, os.O_RDONLY | nofollow | directory)
    try:
        info = os.fstat(descriptor)
        if not stat.S_ISDIR(info.st_mode):
            raise EvidenceError(f"unsafe evidence directory: {path}")
        return {"device": info.st_dev, "inode": info.st_ino}
    finally:
        os.close(descriptor)


def sha256_handle(handle: BinaryIO) -> str:
    digest = hashlib.sha256()
    for chunk in iter(lambda: handle.read(1024 * 1024), b""):
        digest.update(chunk)
    return digest.hexdigest()


def sha256_path(path: Path) -> str:
    with open_regular_file(path) as handle:
        return sha256_handle(handle)


def sha256_and_size(path: Path) -> tuple[str, int]:
    with open_regular_file(path) as handle:
        digest = sha256_handle(handle)
        size = handle.tell()
    return digest, size


def load_json(path: Path) -> tuple[dict[str, Any], bytes]:
    raw = read_regular_file(path)
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise EvidenceError(f"invalid JSON: {path}") from exc
    if not isinstance(value, dict):
        raise EvidenceError(f"JSON root is not an object: {path}")
    return value, raw


def require_text(value: object, *, field_name: str) -> str:
    if not isinstance(value, str) or not value:
        raise EvidenceError(f"{field_name} must be non-empty text")
    return value


def require_int(value: object, *, field_name: str, minimum: int = 0) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < minimum:
        raise EvidenceError(f"{field_name} must be an integer >= {minimum}")
    return value


def decimal_value(
    value: object,
    *,
    field_name: str,
    minimum: Decimal | None = None,
) -> Decimal:
    if not isinstance(value, (str, int)) or isinstance(value, bool):
        raise EvidenceError(f"{field_name} must be decimal text or integer")
    try:
        parsed = D(str(value))
    except InvalidOperation as exc:
        raise EvidenceError(f"{field_name} is not a decimal") from exc
    if not parsed.is_finite() or (minimum is not None and parsed < minimum):
        raise EvidenceError(f"{field_name} is outside its frozen domain")
    return parsed


def decimal_text(value: Decimal) -> str:
    if not value.is_finite():
        raise EvidenceError("non-finite decimal cannot enter evidence")
    normalized = value.normalize()
    rendered = format(normalized, "f")
    return "0" if rendered in {"-0", ""} else rendered


def date_value(value: object, *, field_name: str) -> date:
    text = require_text(value, field_name=field_name)
    try:
        return date.fromisoformat(text)
    except ValueError as exc:
        raise EvidenceError(f"{field_name} is not an ISO date") from exc


def normalized_lines(values: Iterable[str]) -> bytes:
    return ("\n".join(values) + "\n").encode()


def fsync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def exclusive_write(path: Path, raw: bytes) -> None:
    """Publish complete fsynced bytes atomically and without replacement."""

    path.parent.mkdir(parents=True, exist_ok=True)
    safe_directory(path.parent)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.publish.",
        dir=path.parent,
    )
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        os.link(temporary, path, follow_symlinks=False)
        fsync_directory(path.parent)
    finally:
        if temporary.exists():
            temporary.unlink()
            fsync_directory(path.parent)


def atomic_write(path: Path, raw: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    safe_directory(path.parent)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        fsync_directory(path.parent)
    finally:
        if temporary.exists():
            temporary.unlink()
            fsync_directory(path.parent)


def repo_root() -> Path:
    return PACKET_DIR.parents[2]


def validate_roots(state_root: Path, shared_root: Path) -> tuple[Path, Path]:
    """Pin the one writable lifecycle root away from the exact read-only corpus."""

    if state_root != DEFAULT_STATE_ROOT:
        raise EvidenceError("state root differs from frozen unique V-G5 lifecycle root")
    if shared_root != DEFAULT_SHARED_ROOT:
        raise EvidenceError("shared root differs from frozen read-only corpus")
    safe_directory(shared_root)
    if state_root.exists() or state_root.is_symlink():
        safe_directory(state_root)
    else:
        safe_directory(state_root.parent)
    if (
        state_root == shared_root
        or state_root.is_relative_to(shared_root)
        or shared_root.is_relative_to(state_root)
    ):
        raise EvidenceError("writable state and read-only shared roots overlap")
    return state_root, shared_root


def git_output(*arguments: str) -> str:
    completed = subprocess.run(
        ("git", *arguments),
        cwd=repo_root(),
        check=True,
        capture_output=True,
        text=True,
    )
    return completed.stdout.strip()


def git_changed_paths(base: str, head: str = "HEAD") -> tuple[str, ...]:
    """Return every source and destination path with renames disabled."""

    completed = subprocess.run(
        ("git", "diff", "--name-only", "--no-renames", "-z", f"{base}..{head}"),
        cwd=repo_root(),
        check=True,
        capture_output=True,
    )
    raw_paths = completed.stdout.split(b"\0")
    if raw_paths and raw_paths[-1] == b"":
        raw_paths.pop()
    try:
        return tuple(path.decode("utf-8") for path in raw_paths)
    except UnicodeDecodeError as exc:
        raise EvidenceError("changed Git path is not UTF-8") from exc


def script_sha() -> str:
    return sha256_path(Path(__file__).resolve())


def runtime_binding() -> dict[str, object]:
    hash_seed = os.environ.get("PYTHONHASHSEED")
    if hash_seed != "0" or sys.flags.hash_randomization != 0:
        raise EvidenceError("PYTHONHASHSEED=0 must be present at interpreter startup")
    decimal_context = getcontext()
    decimal_binding = {
        "precision": decimal_context.prec,
        "rounding": decimal_context.rounding,
        "emin": decimal_context.Emin,
        "emax": decimal_context.Emax,
        "capitals": decimal_context.capitals,
        "clamp": decimal_context.clamp,
        "traps": sorted(
            signal.__name__ for signal, enabled in decimal_context.traps.items() if enabled
        ),
    }
    frozen_decimal_binding = {
        "precision": FROZEN_DECIMAL_CONTEXT.prec,
        "rounding": FROZEN_DECIMAL_CONTEXT.rounding,
        "emin": FROZEN_DECIMAL_CONTEXT.Emin,
        "emax": FROZEN_DECIMAL_CONTEXT.Emax,
        "capitals": FROZEN_DECIMAL_CONTEXT.capitals,
        "clamp": FROZEN_DECIMAL_CONTEXT.clamp,
        "traps": sorted(
            signal.__name__ for signal, enabled in FROZEN_DECIMAL_CONTEXT.traps.items() if enabled
        ),
    }
    if decimal_binding != frozen_decimal_binding:
        raise EvidenceError("Decimal context differs from the frozen runtime contract")
    return {
        "implementation": sys.implementation.name,
        "python": ".".join(str(part) for part in sys.version_info[:3]),
        "byteorder": sys.byteorder,
        "decimalContext": decimal_binding,
        "hashSeedObservedAtStartup": hash_seed,
        "hashRandomizationFlag": sys.flags.hash_randomization,
    }


def load_protocol() -> tuple[dict[str, Any], str]:
    protocol, raw = load_json(PROTOCOL_PATH)
    if protocol.get("schema") != "VG5AbnormalVolumeBreakoutProtocolV1":
        raise EvidenceError("unexpected V-G5 protocol schema")
    return protocol, sha256_bytes(raw)


def trial_specs(protocol: Mapping[str, Any]) -> tuple[TrialSpec, ...]:
    trials = protocol.get("trials")
    if not isinstance(trials, Mapping):
        raise EvidenceError("protocol trials missing")
    lookbacks = trials.get("breakoutLookbackDays")
    thresholds = trials.get("abnormalVolumeThresholds")
    trends = trials.get("trendSmaDays")
    regimes = trials.get("volatilityRegimes")
    holds = trials.get("holdDays")
    if not isinstance(lookbacks, list):
        raise EvidenceError("protocol breakout trial axis malformed")
    if not isinstance(thresholds, list):
        raise EvidenceError("protocol volume trial axis malformed")
    if not isinstance(trends, list):
        raise EvidenceError("protocol trend trial axis malformed")
    if not isinstance(regimes, list):
        raise EvidenceError("protocol volatility trial axis malformed")
    if not isinstance(holds, list):
        raise EvidenceError("protocol hold trial axis malformed")
    specs: list[TrialSpec] = []
    for lookback, threshold, trend, regime, hold in itertools.product(
        lookbacks,
        thresholds,
        trends,
        regimes,
        holds,
    ):
        lookback_days = require_int(lookback, field_name="breakoutLookbackDays", minimum=2)
        trend_days = require_int(trend, field_name="trendSmaDays", minimum=2)
        hold_days = require_int(hold, field_name="holdDays", minimum=1)
        volume_threshold = decimal_value(
            threshold,
            field_name="abnormalVolumeThresholds",
            minimum=D("1"),
        )
        regime_text = require_text(regime, field_name="volatilityRegimes")
        if regime_text not in {"LOW", "HIGH"}:
            raise EvidenceError("unknown volatility regime")
        trial_id = (
            f"VG5_L{lookback_days:02d}_V{decimal_text(volume_threshold).replace('.', 'P')}"
            f"_M{trend_days:03d}_R{regime_text}_H{hold_days}"
        )
        specs.append(
            TrialSpec(
                trial_id=trial_id,
                breakout_days=lookback_days,
                volume_threshold=volume_threshold,
                trend_days=trend_days,
                volatility_regime=regime_text,
                hold_days=hold_days,
            )
        )
    specs.sort(key=lambda item: item.trial_id.encode("utf-8"))
    expected = require_int(trials.get("familySize"), field_name="familySize", minimum=1)
    if len(specs) != expected or len({item.trial_id for item in specs}) != expected:
        raise EvidenceError("trial family does not match frozen familySize")
    return tuple(specs)


def scenario(protocol: Mapping[str, Any], name: str) -> CostScenario:
    costs = protocol.get("costs")
    if not isinstance(costs, Mapping):
        raise EvidenceError("protocol costs missing")
    scenarios = costs.get("scenarios")
    if not isinstance(scenarios, Mapping):
        raise EvidenceError("protocol cost scenarios missing")
    payload = scenarios.get(name)
    if not isinstance(payload, Mapping):
        raise EvidenceError(f"unknown scenario: {name}")
    return CostScenario(
        name=name,
        fee_bps=decimal_value(
            payload.get("feeBpsPerFill"),
            field_name=f"{name}.feeBpsPerFill",
            minimum=D("0"),
        ),
        adverse_bps=decimal_value(
            payload.get("adverseExecutionBpsPerFill"),
            field_name=f"{name}.adverseExecutionBpsPerFill",
            minimum=D("0"),
        ),
        capacity_bps=decimal_value(
            payload.get("capacityParticipationBps"),
            field_name=f"{name}.capacityParticipationBps",
            minimum=D("0"),
        ),
    )


def month_range(first: str, last: str) -> tuple[str, ...]:
    current = date.fromisoformat(f"{first}-01")
    final = date.fromisoformat(f"{last}-01")
    values: list[str] = []
    while current <= final:
        values.append(current.strftime("%Y-%m"))
        if current.month == 12:
            current = date(current.year + 1, 1, 1)
        else:
            current = date(current.year, current.month + 1, 1)
    return tuple(values)


def _artifact_rows(
    manifest: Mapping[str, Any],
    required_months: set[str],
) -> tuple[tuple[str, ...], dict[tuple[str, str], Mapping[str, Any]]]:
    pairs = manifest.get("artifactPairs")
    if not isinstance(pairs, list):
        raise EvidenceError("artifactPairs missing")
    rows: list[str] = []
    lookup: dict[tuple[str, str], Mapping[str, Any]] = {}
    for pair in pairs:
        if not isinstance(pair, Mapping):
            raise EvidenceError("artifact pair is not an object")
        symbol = require_text(pair.get("symbol"), field_name="artifactPair.symbol")
        month = require_text(pair.get("month"), field_name="artifactPair.month")
        key = (symbol, month)
        if key in lookup:
            raise EvidenceError(f"duplicate artifact pair: {symbol}|{month}")
        lookup[key] = pair
        if month not in required_months:
            continue
        zip_sha = require_text(pair.get("zipSha256"), field_name="artifactPair.zipSha256")
        checksum_sha = require_text(
            pair.get("checksumSha256"),
            field_name="artifactPair.checksumSha256",
        )
        zip_key = require_text(pair.get("zipKey"), field_name="artifactPair.zipKey")
        checksum_key = require_text(
            pair.get("checksumKey"),
            field_name="artifactPair.checksumKey",
        )
        rows.append("|".join((symbol, month, zip_key, zip_sha, checksum_key, checksum_sha)))
    rows.sort(key=lambda row: row.encode("utf-8"))
    return tuple(rows), lookup


def _validate_shared_metadata(
    protocol: Mapping[str, Any],
    shared_root: Path,
) -> tuple[dict[str, Any], dict[str, Any], tuple[str, ...]]:
    safe_directory(shared_root)
    data = protocol.get("data")
    if not isinstance(data, Mapping):
        raise EvidenceError("protocol data missing")
    discovery_path = shared_root / "discovery.v1.json"
    acquisition_path = shared_root / "acquisition-manifest.v1.json"
    discovery, discovery_raw = load_json(discovery_path)
    acquisition, acquisition_raw = load_json(acquisition_path)
    if sha256_bytes(discovery_raw) != data.get("discoverySha256"):
        raise EvidenceError("shared discovery hash mismatch")
    if sha256_bytes(acquisition_raw) != data.get("acquisitionManifestSha256"):
        raise EvidenceError("shared acquisition-manifest hash mismatch")
    if discovery.get("schema") != "S1FArchiveDiscoveryV1":
        raise EvidenceError("shared discovery schema mismatch")
    if discovery.get("state") != "METADATA_ONLY_NO_ARCHIVE_BODY_OPENED":
        raise EvidenceError("shared discovery state mismatch")
    if acquisition.get("schema") != "S1FAcquisitionManifestV1":
        raise EvidenceError("shared acquisition schema mismatch")
    if acquisition.get("state") != "CHECKSUM_VERIFIED_ARCHIVES_NOT_DECOMPRESSED":
        raise EvidenceError("shared acquisition state mismatch")
    if acquisition.get("archiveBodiesDecompressed") is not False:
        raise EvidenceError("shared acquisition does not preserve compressed state")
    if acquisition.get("artifactRowsSha256") != data.get("artifactRowsSha256"):
        raise EvidenceError("shared artifact-row hash mismatch")
    if acquisition.get("absentSha256") != data.get("absentRowsSha256"):
        raise EvidenceError("shared absent-row hash mismatch")
    universe = discovery.get("universe")
    if not isinstance(universe, Mapping):
        raise EvidenceError("shared universe missing")
    if universe.get("sha256") != data.get("universeSha256"):
        raise EvidenceError("shared universe hash mismatch")
    if universe.get("count") != data.get("universeCount"):
        raise EvidenceError("shared universe count mismatch")
    symbols = universe.get("symbols")
    if not isinstance(symbols, list) or not all(isinstance(item, str) for item in symbols):
        raise EvidenceError("shared universe symbols malformed")
    normalized = tuple(sorted(symbols, key=lambda item: item.encode("utf-8")))
    if len(normalized) != len(set(normalized)) or len(normalized) != universe.get("count"):
        raise EvidenceError("shared universe symbols are not unique")
    target_months = discovery.get("targetMonths")
    if not isinstance(target_months, list):
        raise EvidenceError("shared target months missing")
    required = data.get("requiredMonthsInclusive")
    if (
        not isinstance(required, list)
        or len(required) != 2
        or not all(isinstance(item, str) for item in required)
    ):
        raise EvidenceError("required month interval malformed")
    months = month_range(required[0], required[1])
    if not set(months).issubset(set(target_months)):
        raise EvidenceError("shared discovery lacks a required month")
    return discovery, acquisition, normalized


def _assert_freeze_stage_git(protocol: Mapping[str, Any]) -> None:
    base = require_text(protocol.get("canonicalBaseCommit"), field_name="canonicalBaseCommit")
    if git_output("rev-parse", "HEAD") != base:
        raise EvidenceError("freeze must start at exact canonical base")
    changed = git_output("status", "--porcelain=v1", "--untracked-files=all").splitlines()
    for row in changed:
        path = row[3:]
        if " -> " in path:
            raise EvidenceError("renames are not allowed in V-G5 freeze scope")
        if not path.startswith("quant/research/vg5/"):
            raise EvidenceError(f"path outside exclusive V-G5 scope: {path}")


def _restore_freeze_from_receipt(state_root: Path) -> dict[str, Any] | None:
    receipt_path = state_root / EXTERNAL_FREEZE
    if not receipt_path.exists():
        return None
    receipt, _ = load_json(receipt_path)
    embedded = receipt.get("freeze")
    if receipt.get("schema") != "VG5ExternalFreezeReceiptV1" or not isinstance(embedded, dict):
        raise EvidenceError("external freeze receipt lacks embedded freeze")
    raw = canonical_bytes(embedded)
    if (
        receipt.get("freezeSha256") != sha256_bytes(raw)
        or embedded.get("schema") != "VG5FreezeV1"
        or embedded.get("state") != "FROZEN_BEFORE_ANY_VG5_ARCHIVE_BODY_OPEN"
    ):
        raise EvidenceError("external freeze receipt is invalid")
    inputs = embedded.get("inputs")
    if not isinstance(inputs, Mapping) or inputs.get("stateRootIdentity") != directory_identity(
        state_root
    ):
        raise EvidenceError("external freeze receipt state-root identity mismatch")
    if FREEZE_PATH.exists():
        if sha256_path(FREEZE_PATH) != sha256_bytes(raw):
            atomic_write(FREEZE_PATH, raw)
    else:
        exclusive_write(FREEZE_PATH, raw)
    return embedded


def freeze(state_root: Path, shared_root: Path) -> dict[str, Any]:
    """Freeze metadata, evaluator, protocol, universe, and all compressed inputs."""

    state_root, shared_root = validate_roots(state_root, shared_root)
    current_runtime = runtime_binding()
    restored = _restore_freeze_from_receipt(state_root)
    if restored is not None:
        inputs = restored.get("inputs")
        if (
            restored.get("runtime") != current_runtime
            or not isinstance(inputs, Mapping)
            or inputs.get("stateRootIdentity") != directory_identity(state_root)
            or inputs.get("sharedRootIdentity") != directory_identity(shared_root)
        ):
            raise EvidenceError("recovered freeze differs from runtime or root identity")
        return restored
    if FREEZE_PATH.exists():
        raise EvidenceError("freeze exists without its authoritative external receipt")
    protocol, protocol_sha = load_protocol()
    trial_specs(protocol)
    for name in ("base", "stress", "severe"):
        scenario(protocol, name)
    _assert_freeze_stage_git(protocol)
    discovery, acquisition, symbols = _validate_shared_metadata(protocol, shared_root)
    data = protocol["data"]
    assert isinstance(data, Mapping)
    required = data["requiredMonthsInclusive"]
    assert isinstance(required, list)
    months = month_range(str(required[0]), str(required[1]))
    rows, _ = _artifact_rows(acquisition, set(months))
    if not rows:
        raise EvidenceError("no required artifact pairs found")
    state_root.mkdir(parents=True, exist_ok=True, mode=0o700)
    safe_directory(state_root)
    forbidden = (
        EXTERNAL_FREEZE,
        DEVELOPMENT_MARKER,
        HOLDOUT_MARKER,
        PREFLIGHT_RECEIPT,
        "candidate-seal.v1.json",
        "outcome-receipt.v1.json",
    )
    if any((state_root / name).exists() for name in forbidden):
        raise EvidenceError("V-G5 lifecycle state is not pristine")
    payload: dict[str, Any] = {
        "schema": "VG5FreezeV1",
        "protocolId": protocol["protocolId"],
        "state": "FROZEN_BEFORE_ANY_VG5_ARCHIVE_BODY_OPEN",
        "frozenAtUtc": datetime.now(UTC).isoformat(),
        "canonicalBaseCommit": protocol["canonicalBaseCommit"],
        "bindings": {
            "protocolSha256": protocol_sha,
            "evaluatorSha256": script_sha(),
            "officialSourceResearchSha256": sha256_path(SOURCE_RESEARCH_PATH),
            "sharedDiscoverySha256": data["discoverySha256"],
            "sharedAcquisitionManifestSha256": data["acquisitionManifestSha256"],
            "sharedArtifactRowsSha256": data["artifactRowsSha256"],
            "sharedAbsentRowsSha256": data["absentRowsSha256"],
            "requiredArtifactRowsSha256": sha256_bytes(normalized_lines(rows)),
        },
        "universe": {
            "count": len(symbols),
            "sha256": discovery["universe"]["sha256"],
            "symbolsSha256": sha256_bytes(normalized_lines(symbols)),
            "source": "SHARED_ARCHIVE_DISCOVERY_METADATA_ONLY",
        },
        "inputs": {
            "sharedRoot": str(shared_root),
            "stateRootIdentity": directory_identity(state_root),
            "sharedRootIdentity": directory_identity(shared_root),
            "requiredMonths": list(months),
            "requiredArtifactPairCount": len(rows),
            "sharedArtifactPairCount": acquisition["artifactPairCount"],
            "sharedAbsentSymbolMonthCount": acquisition["absentSymbolMonthCount"],
            "sharedCorpusMutationAuthority": "NONE",
        },
        "trials": {
            "familySize": len(trial_specs(protocol)),
            "trialIdsSha256": sha256_bytes(
                normalized_lines(spec.trial_id for spec in trial_specs(protocol))
            ),
        },
        "runtime": current_runtime,
        "outcomesObserved": False,
        "archiveBodiesOpenedByVG5": False,
        "holdoutOpened": False,
    }
    raw = canonical_bytes(payload)
    external = {
        "schema": "VG5ExternalFreezeReceiptV1",
        "freezeSha256": sha256_bytes(raw),
        "repoFreezePath": str(FREEZE_PATH),
        "state": payload["state"],
        "freeze": payload,
    }
    exclusive_write(state_root / EXTERNAL_FREEZE, canonical_bytes(external))
    exclusive_write(FREEZE_PATH, raw)
    return payload


def load_freeze(
    state_root: Path,
    shared_root: Path,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any], tuple[str, ...]]:
    state_root, shared_root = validate_roots(state_root, shared_root)
    restored = _restore_freeze_from_receipt(state_root)
    if restored is None:
        raise EvidenceError("authoritative external freeze receipt is missing")
    protocol, protocol_sha = load_protocol()
    freeze_payload, freeze_raw = load_json(FREEZE_PATH)
    if freeze_payload.get("schema") != "VG5FreezeV1":
        raise EvidenceError("freeze schema mismatch")
    if freeze_payload.get("state") != "FROZEN_BEFORE_ANY_VG5_ARCHIVE_BODY_OPEN":
        raise EvidenceError("freeze state mismatch")
    bindings = freeze_payload.get("bindings")
    if not isinstance(bindings, Mapping):
        raise EvidenceError("freeze bindings missing")
    expected = {
        "protocolSha256": protocol_sha,
        "evaluatorSha256": script_sha(),
        "officialSourceResearchSha256": sha256_path(SOURCE_RESEARCH_PATH),
    }
    for key, value in expected.items():
        if bindings.get(key) != value:
            raise EvidenceError(f"freeze binding mismatch: {key}")
    if freeze_payload.get("runtime") != runtime_binding():
        raise EvidenceError("executing runtime differs from frozen runtime")
    inputs = freeze_payload.get("inputs")
    if not isinstance(inputs, Mapping):
        raise EvidenceError("freeze input bindings missing")
    if inputs.get("stateRootIdentity") != directory_identity(state_root) or inputs.get(
        "sharedRootIdentity"
    ) != directory_identity(shared_root):
        raise EvidenceError("evidence root device/inode differs from freeze")
    external, _ = load_json(state_root / EXTERNAL_FREEZE)
    if (
        external.get("freezeSha256") != sha256_bytes(freeze_raw)
        or external.get("freeze") != freeze_payload
    ):
        raise EvidenceError("external freeze receipt mismatch")
    _, acquisition, symbols = _validate_shared_metadata(protocol, shared_root)
    data = protocol["data"]
    assert isinstance(data, Mapping)
    if bindings.get("sharedDiscoverySha256") != data["discoverySha256"]:
        raise EvidenceError("freeze discovery binding mismatch")
    if bindings.get("sharedAcquisitionManifestSha256") != data["acquisitionManifestSha256"]:
        raise EvidenceError("freeze acquisition binding mismatch")
    required = data["requiredMonthsInclusive"]
    assert isinstance(required, list)
    months = month_range(str(required[0]), str(required[1]))
    rows, _ = _artifact_rows(acquisition, set(months))
    if bindings.get("requiredArtifactRowsSha256") != sha256_bytes(normalized_lines(rows)):
        raise EvidenceError("freeze required artifact rows mismatch")
    if freeze_payload.get("universe", {}).get("symbolsSha256") != sha256_bytes(
        normalized_lines(symbols)
    ):
        raise EvidenceError("freeze universe symbols mismatch")
    return protocol, freeze_payload, acquisition, symbols


def _pair_paths(
    shared_root: Path,
    pair: Mapping[str, Any],
) -> tuple[Path, Path, str]:
    symbol = require_text(pair.get("symbol"), field_name="artifactPair.symbol")
    month = require_text(pair.get("month"), field_name="artifactPair.month")
    zip_key = require_text(pair.get("zipKey"), field_name="artifactPair.zipKey")
    checksum_key = require_text(
        pair.get("checksumKey"),
        field_name="artifactPair.checksumKey",
    )
    if (
        Path(symbol).name != symbol
        or symbol in {".", ".."}
        or "/" in symbol
        or "\\" in symbol
        or "\x00" in symbol
    ):
        raise EvidenceError("artifact symbol is not a safe UTF-8 path component")
    try:
        parsed_month = date.fromisoformat(f"{month}-01").strftime("%Y-%m")
    except ValueError as exc:
        raise EvidenceError("artifact month is malformed") from exc
    if parsed_month != month:
        raise EvidenceError("artifact month is not canonical YYYY-MM")
    zip_name = Path(zip_key).name
    checksum_name = Path(checksum_key).name
    expected_name = f"{symbol}-1d-{month}.zip"
    expected_key = f"data/spot/monthly/klines/{symbol}/1d/{expected_name}"
    if (
        zip_key != expected_key
        or checksum_key != f"{expected_key}.CHECKSUM"
        or zip_name != expected_name
        or checksum_name != f"{expected_name}.CHECKSUM"
    ):
        raise EvidenceError(f"unexpected artifact key shape: {symbol}|{month}")
    archives = safe_directory(shared_root / "archives")
    symbol_directory = safe_directory(archives / symbol)
    directory = safe_directory(symbol_directory / month)
    if not directory.resolve().is_relative_to(shared_root.resolve()):
        raise EvidenceError("artifact directory escapes the frozen shared root")
    return directory / zip_name, directory / checksum_name, expected_name


def verify_checksum_text(raw: bytes, expected_name: str, archive_sha: str) -> None:
    try:
        text = raw.decode("ascii").strip()
    except UnicodeDecodeError as exc:
        raise EvidenceError("checksum sidecar is not ASCII") from exc
    pieces = text.split()
    if len(pieces) != 2:
        raise EvidenceError("checksum sidecar has unexpected shape")
    digest, name = pieces
    if name.lstrip("*") != expected_name or digest.lower() != archive_sha:
        raise EvidenceError("checksum sidecar content mismatch")


def preflight(state_root: Path, shared_root: Path) -> dict[str, Any]:
    """Authenticate compressed files without opening a ZIP member."""

    state_root, shared_root = validate_roots(state_root, shared_root)
    protocol, freeze_payload, acquisition, _ = load_freeze(state_root, shared_root)
    if git_output("status", "--porcelain=v1"):
        raise EvidenceError("preflight requires a clean committed freeze")
    base = require_text(protocol.get("canonicalBaseCommit"), field_name="canonicalBaseCommit")
    if git_output("rev-parse", "HEAD^") != base:
        raise EvidenceError("freeze commit is not a direct child of canonical base")
    changed = git_changed_paths(base)
    if not changed or any(not path.startswith("quant/research/vg5/") for path in changed):
        raise EvidenceError("freeze commit violates exclusive V-G5 path scope")
    data = protocol["data"]
    assert isinstance(data, Mapping)
    required = data["requiredMonthsInclusive"]
    assert isinstance(required, list)
    months = set(month_range(str(required[0]), str(required[1])))
    rows, lookup = _artifact_rows(acquisition, months)
    verified = 0
    compressed_bytes = 0
    for symbol, month in sorted(lookup, key=lambda item: (item[0].encode(), item[1])):
        if month not in months:
            continue
        pair = lookup[(symbol, month)]
        zip_path, checksum_path, expected_name = _pair_paths(shared_root, pair)
        archive_sha, archive_size = sha256_and_size(zip_path)
        checksum_raw = read_regular_file(checksum_path)
        checksum_sha = sha256_bytes(checksum_raw)
        if archive_sha != pair.get("zipSha256"):
            raise EvidenceError(f"archive hash mismatch: {symbol}|{month}")
        if checksum_sha != pair.get("checksumSha256"):
            raise EvidenceError(f"sidecar hash mismatch: {symbol}|{month}")
        verify_checksum_text(checksum_raw, expected_name, archive_sha)
        compressed_bytes += archive_size
        verified += 1
    if verified != len(rows):
        raise EvidenceError("preflight artifact count mismatch")
    payload = {
        "schema": "VG5PreflightReceiptV1",
        "state": "COMPRESSED_BYTES_AND_SIDECARS_AUTHENTICATED_NO_ZIP_MEMBER_OPENED",
        "completedAtUtc": datetime.now(UTC).isoformat(),
        "freezeSha256": sha256_path(FREEZE_PATH),
        "freezeCommit": git_output("rev-parse", "HEAD"),
        "requiredArtifactPairCount": verified,
        "compressedBytes": compressed_bytes,
        "requiredArtifactRowsSha256": freeze_payload["bindings"]["requiredArtifactRowsSha256"],
        "archiveBodiesOpenedByVG5": False,
        "sharedCorpusMutationAuthority": "NONE",
    }
    receipt_path = state_root / PREFLIGHT_RECEIPT
    if receipt_path.exists():
        existing, _ = load_json(receipt_path)
        stable_keys = (
            "schema",
            "state",
            "freezeSha256",
            "freezeCommit",
            "requiredArtifactPairCount",
            "compressedBytes",
            "requiredArtifactRowsSha256",
        )
        if any(existing.get(key) != payload.get(key) for key in stable_keys):
            raise EvidenceError("existing preflight receipt conflicts with current proof")
        return existing
    exclusive_write(receipt_path, canonical_bytes(payload))
    return payload


def _timestamp_datetime(value: int, *, field_name: str) -> tuple[datetime, str]:
    if value < 0:
        raise MeasurementError(f"{field_name} is negative")
    microseconds = value >= 1_000_000_000_000_000
    divisor = 1_000_000 if microseconds else 1_000
    seconds, remainder = divmod(value, divisor)
    try:
        return (
            datetime.fromtimestamp(seconds, UTC).replace(
                microsecond=(remainder * 1_000_000) // divisor
            ),
            "MICROSECONDS" if microseconds else "MILLISECONDS",
        )
    except (OverflowError, OSError, ValueError) as exc:
        raise MeasurementError(f"{field_name} is outside datetime range") from exc


def _csv_decimal(value: str, *, field_name: str, positive: bool = False) -> Decimal:
    try:
        parsed = D(value)
    except InvalidOperation as exc:
        raise MeasurementError(f"{field_name} is not decimal") from exc
    if not parsed.is_finite() or parsed < 0 or (positive and parsed <= 0):
        raise MeasurementError(f"{field_name} is outside its valid domain")
    return parsed


def parse_archive(
    path: Path,
    *,
    symbol: str,
    month: str,
    expected_sha: str,
) -> tuple[Bar, ...]:
    """Open one already-authenticated ZIP and validate its sole daily CSV."""

    expected_csv = f"{symbol}-1d-{month}.csv"
    try:
        with open_regular_file(path) as handle:
            if sha256_handle(handle) != expected_sha:
                raise MeasurementError(f"archive changed after preflight: {symbol}|{month}")
            handle.seek(0)
            with zipfile.ZipFile(handle, "r") as archive:
                members = archive.infolist()
                if len(members) != 1:
                    raise MeasurementError(f"archive member count invalid: {symbol}|{month}")
                member = members[0]
                if (
                    member.is_dir()
                    or member.filename != expected_csv
                    or Path(member.filename).name != member.filename
                    or member.file_size > 2_000_000
                ):
                    raise MeasurementError(f"archive member invalid: {symbol}|{month}")
                raw = archive.read(member)
    except MeasurementError:
        raise
    except (OSError, zipfile.BadZipFile, RuntimeError) as exc:
        raise MeasurementError(f"archive open failed: {symbol}|{month}") from exc
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise MeasurementError(f"CSV is not UTF-8: {symbol}|{month}") from exc
    rows = csv.reader(io.StringIO(text, newline=""))
    bars: list[Bar] = []
    seen: set[date] = set()
    for row_number, row in enumerate(rows, start=1):
        if (
            row_number == 1
            and row
            and row[0].strip().lower()
            in {
                "open_time",
                "opentime",
            }
        ):
            if len(row) != 12:
                raise MeasurementError(f"CSV header column count invalid: {symbol}|{month}")
            continue
        if len(row) != 12:
            raise MeasurementError(f"CSV column count invalid: {symbol}|{month}|{row_number}")
        try:
            open_timestamp = int(row[0])
            close_timestamp = int(row[6])
            trade_count = int(row[8])
        except ValueError as exc:
            raise MeasurementError(f"CSV integer invalid: {symbol}|{month}|{row_number}") from exc
        opened_at, open_unit = _timestamp_datetime(
            open_timestamp,
            field_name="openTime",
        )
        closed_at, close_unit = _timestamp_datetime(
            close_timestamp,
            field_name="closeTime",
        )
        if open_unit != "MICROSECONDS" or close_unit != "MICROSECONDS":
            raise MeasurementError(
                f"required 2025-plus archive timestamps are not microseconds: "
                f"{symbol}|{month}|{row_number}"
            )
        if opened_at.time().isoformat() != "00:00:00" or closed_at != (
            opened_at + timedelta(days=1) - timedelta(microseconds=1)
        ):
            raise MeasurementError(
                f"daily timestamp boundary invalid: {symbol}|{month}|{row_number}"
            )
        day = opened_at.date()
        if day.strftime("%Y-%m") != month or day in seen:
            raise MeasurementError(f"CSV month or duplicate invalid: {symbol}|{month}|{row_number}")
        opened = _csv_decimal(row[1], field_name="open", positive=True)
        high = _csv_decimal(row[2], field_name="high", positive=True)
        low = _csv_decimal(row[3], field_name="low", positive=True)
        close = _csv_decimal(row[4], field_name="close", positive=True)
        quote_volume = _csv_decimal(row[7], field_name="quoteVolume")
        if high < max(opened, close, low) or low > min(opened, close, high) or trade_count < 0:
            raise MeasurementError(f"OHLC or trade count invalid: {symbol}|{month}|{row_number}")
        seen.add(day)
        bars.append(
            Bar(
                day=day,
                open=opened,
                high=high,
                low=low,
                close=close,
                quote_volume=quote_volume,
                trade_count=trade_count,
            )
        )
    bars.sort(key=lambda item: item.day)
    if not bars or len(bars) > 31:
        raise MeasurementError(f"daily row count invalid: {symbol}|{month}")
    if tuple(bar.day for bar in bars) != tuple(sorted(seen)):
        raise MeasurementError(f"daily ordering invalid: {symbol}|{month}")
    return tuple(bars)


def artifact_lookup(
    manifest: Mapping[str, Any],
) -> dict[tuple[str, str], Mapping[str, Any]]:
    _, lookup = _artifact_rows(manifest, set())
    return lookup


def load_bars(
    shared_root: Path,
    acquisition: Mapping[str, Any],
    symbols: Sequence[str],
    months: Sequence[str],
) -> dict[str, dict[date, Bar]]:
    """Open exactly the requested authenticated months into an in-memory panel."""

    lookup = artifact_lookup(acquisition)
    panel: dict[str, dict[date, Bar]] = {}
    for symbol in symbols:
        series: dict[date, Bar] = {}
        for month in months:
            pair = lookup.get((symbol, month))
            if pair is None:
                continue
            path, _, _ = _pair_paths(shared_root, pair)
            parsed = parse_archive(
                path,
                symbol=symbol,
                month=month,
                expected_sha=require_text(
                    pair.get("zipSha256"),
                    field_name="artifactPair.zipSha256",
                ),
            )
            for bar in parsed:
                if bar.day in series:
                    raise MeasurementError(f"duplicate daily bar across archives: {symbol}")
                series[bar.day] = bar
        if series:
            panel[symbol] = series
    if not panel:
        raise MeasurementError("no bars loaded")
    return panel


def _dates(first: date, last: date) -> tuple[date, ...]:
    if last < first:
        raise EvidenceError("invalid date interval")
    return tuple(first + timedelta(days=offset) for offset in range((last - first).days + 1))


def _complete_window(
    series: Mapping[date, Bar],
    end_inclusive: date,
    count: int,
) -> tuple[Bar, ...] | None:
    first = end_inclusive - timedelta(days=count - 1)
    values: list[Bar] = []
    for day in _dates(first, end_inclusive):
        bar = series.get(day)
        if bar is None:
            return None
        values.append(bar)
    return tuple(values)


def _median_decimal(values: Sequence[Decimal]) -> Decimal:
    if not values:
        raise EvidenceError("median requires values")
    return median(values)


def _mean_decimal(values: Sequence[Decimal]) -> Decimal:
    if not values:
        raise EvidenceError("mean requires values")
    return sum(values, D("0")) / D(len(values))


def _true_range(current: Bar, previous: Bar) -> Decimal:
    return max(
        current.high - current.low,
        abs(current.high - previous.close),
        abs(current.low - previous.close),
    )


def _atr_ratio(
    series: Mapping[date, Bar],
    end_inclusive: date,
    days: int = 20,
) -> Decimal | None:
    window = _complete_window(series, end_inclusive, days + 1)
    if window is None:
        return None
    ranges = tuple(_true_range(window[index], window[index - 1]) for index in range(1, len(window)))
    if window[-1].close <= 0:
        return None
    return _mean_decimal(ranges) / window[-1].close


def liquid_cohort(
    panel: Mapping[str, Mapping[date, Bar]],
    signal_day: date,
    *,
    minimum_prior_days: int,
    liquidity_days: int,
    minimum_median_quote_volume: Decimal,
    cohort_size: int,
    minimum_cohort_size: int,
) -> tuple[str, ...]:
    """Build the point-in-time cohort using only days through t-1."""

    prior_day = signal_day - timedelta(days=1)
    eligible: list[tuple[Decimal, bytes, str]] = []
    for symbol, series in panel.items():
        history = _complete_window(series, prior_day, minimum_prior_days)
        if history is None:
            continue
        liquidity = history[-liquidity_days:]
        median_quote_volume = _median_decimal(tuple(bar.quote_volume for bar in liquidity))
        if median_quote_volume < minimum_median_quote_volume:
            continue
        eligible.append((-median_quote_volume, symbol.encode("utf-8"), symbol))
    eligible.sort()
    if len(eligible) < minimum_cohort_size:
        return ()
    return tuple(item[2] for item in eligible[:cohort_size])


def _breakout(
    series: Mapping[date, Bar],
    signal_day: date,
    lookback: int,
) -> tuple[bool, Decimal | None]:
    signal_bar = series.get(signal_day)
    prior = _complete_window(series, signal_day - timedelta(days=1), lookback)
    previous_prior = _complete_window(
        series,
        signal_day - timedelta(days=2),
        lookback,
    )
    previous_bar = series.get(signal_day - timedelta(days=1))
    lagged_atr = _atr_ratio(series, signal_day - timedelta(days=1))
    if (
        signal_bar is None
        or prior is None
        or previous_prior is None
        or previous_bar is None
        or lagged_atr is None
        or lagged_atr <= 0
    ):
        return False, None
    prior_high = max(bar.high for bar in prior)
    previous_prior_high = max(bar.high for bar in previous_prior)
    current_breakout = signal_bar.close > prior_high
    previous_breakout = previous_bar.close > previous_prior_high
    if not current_breakout or previous_breakout:
        return False, None
    lagged_atr_dollars = lagged_atr * previous_bar.close
    if lagged_atr_dollars <= 0:
        return False, None
    return True, (signal_bar.close - prior_high) / lagged_atr_dollars


def _trend(
    series: Mapping[date, Bar],
    signal_day: date,
    trend_days: int,
) -> bool:
    end = signal_day - timedelta(days=1)
    current = _complete_window(series, end, trend_days)
    past = _complete_window(series, end - timedelta(days=20), trend_days)
    previous_bar = series.get(end)
    if current is None or past is None or previous_bar is None:
        return False
    current_sma = _mean_decimal(tuple(bar.close for bar in current))
    past_sma = _mean_decimal(tuple(bar.close for bar in past))
    return previous_bar.close > current_sma and current_sma > past_sma


def _volatility_regime(
    series: Mapping[date, Bar],
    signal_day: date,
) -> str | None:
    current = _atr_ratio(series, signal_day - timedelta(days=1))
    if current is None:
        return None
    references: list[Decimal] = []
    for offset in range(2, 122):
        value = _atr_ratio(series, signal_day - timedelta(days=offset))
        if value is None:
            return None
        references.append(value)
    boundary = _median_decimal(references)
    return "HIGH" if current > boundary else "LOW"


def signal_metric(
    symbol: str,
    series: Mapping[date, Bar],
    signal_day: date,
) -> SignalMetric | None:
    signal_bar = series.get(signal_day)
    prior_volume = _complete_window(series, signal_day - timedelta(days=1), 20)
    if signal_bar is None or prior_volume is None:
        return None
    volume_denominator = _median_decimal(tuple(bar.quote_volume for bar in prior_volume))
    if volume_denominator <= 0:
        return None
    breakout_20, excess_20 = _breakout(series, signal_day, 20)
    breakout_55, excess_55 = _breakout(series, signal_day, 55)
    if not breakout_20 and not breakout_55:
        return None
    regime = _volatility_regime(series, signal_day)
    if regime is None:
        return None
    return SignalMetric(
        symbol=symbol,
        volume_multiple=signal_bar.quote_volume / volume_denominator,
        breakout_excess_20_atr=excess_20,
        breakout_excess_55_atr=excess_55,
        breakout_20=breakout_20,
        breakout_55=breakout_55,
        trend_50=_trend(series, signal_day, 50),
        trend_100=_trend(series, signal_day, 100),
        volatility_regime=regime,
    )


def _metric_matches(metric: SignalMetric, spec: TrialSpec) -> bool:
    breakout = metric.breakout_20 if spec.breakout_days == 20 else metric.breakout_55
    trend = metric.trend_50 if spec.trend_days == 50 else metric.trend_100
    return (
        breakout
        and trend
        and metric.volatility_regime == spec.volatility_regime
        and metric.volume_multiple >= spec.volume_threshold
    )


def rank_candidates(
    metrics: Iterable[SignalMetric],
    spec: TrialSpec,
) -> tuple[SignalMetric, ...]:
    candidates = [metric for metric in metrics if _metric_matches(metric, spec)]

    def breakout_excess(metric: SignalMetric) -> Decimal:
        value = (
            metric.breakout_excess_20_atr
            if spec.breakout_days == 20
            else metric.breakout_excess_55_atr
        )
        if value is None:
            raise MeasurementError("matching breakout metric lacks normalized excess")
        return value

    candidates.sort(
        key=lambda metric: (
            -metric.volume_multiple,
            -breakout_excess(metric),
            metric.symbol.encode("utf-8"),
        )
    )
    return tuple(candidates)


def build_signal_books(
    panel: Mapping[str, Mapping[date, Bar]],
    signal_days: Sequence[date],
    specs: Sequence[TrialSpec],
    protocol: Mapping[str, Any],
) -> tuple[dict[str, dict[date, tuple[SignalMetric, ...]]], dict[str, object]]:
    """Precompute causal candidate ranks without reference to any outcome."""

    universe = protocol.get("universe")
    if not isinstance(universe, Mapping):
        raise EvidenceError("protocol universe missing")
    cohort_protocol = universe.get("pointInTimeLiquidityCohort")
    if not isinstance(cohort_protocol, Mapping):
        raise EvidenceError("protocol liquidity cohort missing")
    minimum_prior = require_int(
        cohort_protocol.get("minimumPriorContiguousDays"),
        field_name="minimumPriorContiguousDays",
        minimum=1,
    )
    liquidity_days = require_int(
        cohort_protocol.get("trailingLiquidityDays"),
        field_name="trailingLiquidityDays",
        minimum=1,
    )
    minimum_volume = decimal_value(
        cohort_protocol.get("minimumMedianDailyQuoteVolumeUsd"),
        field_name="minimumMedianDailyQuoteVolumeUsd",
        minimum=D("0"),
    )
    cohort_size = require_int(
        cohort_protocol.get("cohortSize"),
        field_name="cohortSize",
        minimum=1,
    )
    minimum_cohort = require_int(
        cohort_protocol.get("minimumCohortSize"),
        field_name="minimumCohortSize",
        minimum=1,
    )
    books: dict[str, dict[date, tuple[SignalMetric, ...]]] = {spec.trial_id: {} for spec in specs}
    invalid_cohort_days = 0
    total_metrics = 0
    for signal_day in signal_days:
        cohort = liquid_cohort(
            panel,
            signal_day,
            minimum_prior_days=minimum_prior,
            liquidity_days=liquidity_days,
            minimum_median_quote_volume=minimum_volume,
            cohort_size=cohort_size,
            minimum_cohort_size=minimum_cohort,
        )
        if not cohort:
            invalid_cohort_days += 1
            for book in books.values():
                book[signal_day] = ()
            continue
        metrics = tuple(
            metric
            for symbol in cohort
            if (metric := signal_metric(symbol, panel[symbol], signal_day)) is not None
        )
        total_metrics += len(metrics)
        for spec in specs:
            books[spec.trial_id][signal_day] = rank_candidates(metrics, spec)
    diagnostics: dict[str, object] = {
        "signalDays": len(signal_days),
        "invalidMinimumCohortDays": invalid_cohort_days,
        "eligibleSignalMetricRowsBeforeTrialFilters": total_metrics,
    }
    return books, diagnostics


def _trade_exit(
    position: Position,
    exit_reference: Decimal,
    pre_exit_quote_volume: Decimal,
    scenario_value: CostScenario,
) -> tuple[Decimal, Decomposition, Trade]:
    """Exit a position with an exactly reconciled sequential cost attribution."""

    if exit_reference <= 0:
        raise MeasurementError("selected exit reference is non-positive")
    fee = scenario_value.fee_rate
    adverse = scenario_value.adverse_rate
    capital = position.entry_cash
    entry_reference = position.entry_reference
    gross_exit_cash = capital * exit_reference / entry_reference
    after_entry_adverse = capital * exit_reference / (entry_reference * (D("1") + adverse))
    after_buy_fee = after_entry_adverse * (D("1") - fee)
    after_exit_adverse = after_buy_fee * (D("1") - adverse)
    actual_exit_cash = after_exit_adverse * (D("1") - fee)
    decomposition = Decomposition(
        reference_gross=gross_exit_cash - capital,
        entry_adverse=after_entry_adverse - gross_exit_cash,
        buy_fee=after_buy_fee - after_entry_adverse,
        exit_adverse=after_exit_adverse - after_buy_fee,
        sell_fee=actual_exit_cash - after_exit_adverse,
        net=actual_exit_cash - capital,
    )
    if abs(decomposition.residual()) > D("1e-30"):
        raise MeasurementError("trade cost decomposition does not reconcile")
    capacity_basis = min(
        position.signal_quote_volume,
        position.trailing_quote_volume,
        pre_exit_quote_volume,
    )
    capacity = capacity_basis * scenario_value.capacity_bps / D("10000")
    required_capacity_notional = max(
        capital,
        position.quantity * exit_reference,
    )
    trade = Trade(
        symbol=position.symbol,
        signal_day=position.signal_day,
        entry_day=position.entry_day,
        exit_day=position.exit_day,
        entry_cash=capital,
        exit_cash=actual_exit_cash,
        net_return=(actual_exit_cash / capital) - D("1"),
        capacity_usd=capacity,
        entry_reference_notional_usd=capital,
        exit_reference_notional_usd=position.quantity * exit_reference,
        required_capacity_notional_usd=required_capacity_notional,
        capacity_below_sleeve=capacity < required_capacity_notional,
    )
    return actual_exit_cash, decomposition, trade


def _aggregate_capacity_flags(trades: Sequence[Trade]) -> tuple[Trade, ...]:
    """Apply same-symbol, same-open gross-turnover capacity conservatively."""

    event_usage: dict[tuple[str, date], Decimal] = {}
    event_capacity: dict[tuple[str, date], Decimal] = {}
    for trade in trades:
        for event_day, required in (
            (trade.entry_day, trade.entry_reference_notional_usd),
            (trade.exit_day, trade.exit_reference_notional_usd),
        ):
            key = (trade.symbol, event_day)
            event_usage[key] = event_usage.get(key, D("0")) + required
            event_capacity[key] = min(
                event_capacity.get(key, trade.capacity_usd),
                trade.capacity_usd,
            )
    failed = {key for key, required in event_usage.items() if required > event_capacity[key]}
    return tuple(
        replace(
            trade,
            capacity_below_sleeve=(
                (trade.symbol, trade.entry_day) in failed
                or (trade.symbol, trade.exit_day) in failed
            ),
        )
        for trade in trades
    )


def _percentile_decimal(
    values: Sequence[Decimal],
    probability: Decimal,
) -> Decimal | None:
    if not values:
        return None
    if probability < 0 or probability > 1:
        raise EvidenceError("percentile probability outside [0,1]")
    ordered = sorted(values)
    if probability == D("0.5"):
        return median(ordered)
    rank = int((probability * D(len(ordered))).to_integral_value(rounding=ROUND_CEILING))
    index = max(0, min(len(ordered) - 1, rank - 1))
    return ordered[index]


def _max_drawdown(
    close_equity: Sequence[Decimal],
    low_equity: Sequence[Decimal],
    initial: Decimal,
) -> tuple[Decimal, Decimal]:
    if len(close_equity) != len(low_equity):
        raise MeasurementError("drawdown close/low paths are not synchronous")
    peak = initial
    max_usd = D("0")
    max_pct = D("0")
    for close_value, low_value in zip(close_equity, low_equity, strict=True):
        drawdown = peak - low_value
        percentage = D("0") if peak == 0 else drawdown / peak * D("100")
        max_usd = max(max_usd, drawdown)
        max_pct = max(max_pct, percentage)
        peak = max(peak, close_value)
    return max_pct, max_usd


def simulate_trial(
    panel: Mapping[str, Mapping[date, Bar]],
    signal_book: Mapping[date, tuple[SignalMetric, ...]],
    spec: TrialSpec,
    scenario_value: CostScenario,
    *,
    period: str,
    signal_start: date,
    signal_end: date,
    entry_start: date,
    last_exit: date,
    initial_capital: Decimal = INITIAL_CAPITAL,
) -> TrialRun:
    """Run sleeves with a full staging day, second-open entry, and fixed-H exit."""

    if signal_end >= last_exit:
        raise EvidenceError("signal end must precede final exit")
    daily_dates = _dates(entry_start, last_exit)
    sleeve_count = spec.hold_days
    sleeve_cash = [initial_capital / D(sleeve_count) for _ in range(sleeve_count)]
    positions: list[Position | None] = [None] * sleeve_count
    trades: list[Trade] = []
    decomposition = Decomposition()
    cash_signal_days = 0
    close_equities: list[Decimal] = []
    low_equities: list[Decimal] = []
    daily_returns: list[Decimal] = []
    exit_logs: list[Decimal] = []
    previous_close_equity = initial_capital
    for current_day in daily_dates:
        for sleeve_index, position in enumerate(positions):
            if position is None or position.exit_day != current_day:
                continue
            exit_bar = panel.get(position.symbol, {}).get(current_day)
            pre_exit = panel.get(position.symbol, {}).get(current_day - timedelta(days=1))
            if exit_bar is None or pre_exit is None:
                raise MeasurementError(
                    f"selected exit proof missing: {position.symbol}|{current_day}"
                )
            exit_cash, attribution, trade = _trade_exit(
                position,
                exit_bar.open,
                pre_exit.quote_volume,
                scenario_value,
            )
            sleeve_cash[sleeve_index] = exit_cash
            positions[sleeve_index] = None
            trades.append(trade)
            decomposition.add(attribution)
        signal_day = current_day - timedelta(days=2)
        scheduled_sleeve = (current_day - entry_start).days % sleeve_count
        if signal_start <= signal_day <= signal_end:
            if positions[scheduled_sleeve] is not None:
                raise MeasurementError("rotating sleeve was not free on its scheduled day")
            held = {position.symbol for position in positions if position is not None}
            candidates = signal_book.get(signal_day, ())
            candidate = next(
                (metric for metric in candidates if metric.symbol not in held),
                None,
            )
            if candidate is None:
                cash_signal_days += 1
            else:
                entry_bar = panel.get(candidate.symbol, {}).get(current_day)
                signal_bar = panel.get(candidate.symbol, {}).get(signal_day)
                trailing = _complete_window(
                    panel.get(candidate.symbol, {}),
                    signal_day - timedelta(days=1),
                    7,
                )
                if entry_bar is None or signal_bar is None or trailing is None:
                    raise MeasurementError(
                        f"selected entry proof missing: {candidate.symbol}|{current_day}"
                    )
                cash = sleeve_cash[scheduled_sleeve]
                execution_price = entry_bar.open * (D("1") + scenario_value.adverse_rate)
                quantity = cash * (D("1") - scenario_value.fee_rate) / execution_price
                if cash <= 0 or quantity <= 0:
                    raise MeasurementError("non-positive sleeve or entry quantity")
                sleeve_cash[scheduled_sleeve] = D("0")
                positions[scheduled_sleeve] = Position(
                    symbol=candidate.symbol,
                    signal_day=signal_day,
                    entry_day=current_day,
                    exit_day=current_day + timedelta(days=sleeve_count),
                    entry_reference=entry_bar.open,
                    entry_cash=cash,
                    quantity=quantity,
                    signal_quote_volume=signal_bar.quote_volume,
                    trailing_quote_volume=_median_decimal(
                        tuple(bar.quote_volume for bar in trailing)
                    ),
                )
        close_equity = sum(sleeve_cash, D("0"))
        low_equity = sum(sleeve_cash, D("0"))
        for position in positions:
            if position is None:
                continue
            mark = panel.get(position.symbol, {}).get(current_day)
            if mark is None:
                raise MeasurementError(f"held daily mark missing: {position.symbol}|{current_day}")
            liquidation_multiplier = (D("1") - scenario_value.adverse_rate) * (
                D("1") - scenario_value.fee_rate
            )
            close_equity += position.quantity * mark.close * liquidation_multiplier
            low_equity += position.quantity * mark.low * liquidation_multiplier
        if previous_close_equity <= 0 or close_equity < 0 or low_equity < 0:
            raise MeasurementError("invalid daily equity")
        daily_return = close_equity / previous_close_equity - D("1")
        if daily_return <= D("-1"):
            raise MeasurementError("daily liquidation return reached total loss")
        close_equities.append(close_equity)
        low_equities.append(low_equity)
        daily_returns.append(daily_return)
        exit_logs.append((D("1") + daily_return).ln())
        previous_close_equity = close_equity
    if any(position is not None for position in positions):
        raise MeasurementError("position crosses frozen period boundary")
    end_nav = sum(sleeve_cash, D("0"))
    net_usd = end_nav - initial_capital
    if abs(decomposition.net - net_usd) > D("1e-24"):
        raise MeasurementError("aggregate cost decomposition does not reconcile")
    max_drawdown_pct, max_drawdown_usd = _max_drawdown(
        close_equities,
        low_equities,
        initial_capital,
    )
    aggregated_trades = _aggregate_capacity_flags(trades)
    capacities = tuple(trade.capacity_usd for trade in aggregated_trades)
    below = sum(1 for trade in aggregated_trades if trade.capacity_below_sleeve)
    active_months = tuple(sorted({trade.signal_day.strftime("%Y-%m") for trade in trades}))
    return TrialRun(
        spec=spec,
        scenario=scenario_value,
        period=period,
        valid=True,
        invalid_reasons=(),
        start_nav=initial_capital,
        end_nav=end_nav,
        net_usd=net_usd,
        fills=len(trades) * 2,
        round_trips=len(trades),
        distinct_symbols=tuple(
            sorted({trade.symbol for trade in trades}, key=lambda item: item.encode())
        ),
        active_months=active_months,
        cash_signal_days=cash_signal_days,
        trades=aggregated_trades,
        daily_dates=daily_dates,
        daily_returns=tuple(daily_returns),
        exit_log_returns_by_day=tuple(exit_logs),
        max_drawdown_pct=max_drawdown_pct,
        max_drawdown_usd=max_drawdown_usd,
        min_capacity_usd=min(capacities) if capacities else None,
        p05_capacity_usd=_percentile_decimal(capacities, D("0.05")),
        median_capacity_usd=_percentile_decimal(capacities, D("0.50")),
        capacity_share_below_sleeve=(D(below) / D(len(trades)) if trades else None),
        decomposition=decomposition,
    )


def circular_indices(
    length: int,
    block_length: int,
    rng: random.Random,
) -> tuple[int, ...]:
    if length < 1 or block_length < 1:
        raise EvidenceError("bootstrap dimensions must be positive")
    values: list[int] = []
    while len(values) < length:
        start = rng.randrange(length)
        values.extend((start + offset) % length for offset in range(block_length))
    return tuple(values[:length])


@dataclass(frozen=True, slots=True)
class BootstrapPacket:
    lower_90: Decimal
    upper_90: Decimal
    bonferroni_lower: Decimal
    replicates: int
    individual_p_value: Decimal


@dataclass(frozen=True, slots=True)
class FamilyStatistics:
    packets: Mapping[str, BootstrapPacket]
    holm_rejected: Mapping[str, bool]
    white_reality_check_p_value: Decimal
    seed: int
    block_length: int
    replicates: int


@dataclass(frozen=True, slots=True)
class StatisticsConfig:
    seed: int
    block_length: int
    replicates: int
    lower_probability: Decimal
    upper_probability: Decimal
    alpha: Decimal
    bonferroni_probability: Decimal


def _float_decimal(value: float) -> Decimal:
    if not math.isfinite(value):
        raise MeasurementError("non-finite bootstrap statistic")
    return D(repr(value))


def _bootstrap_quantile(
    values: Sequence[float],
    probability: Decimal,
) -> Decimal:
    if probability < 0 or probability > 1:
        raise EvidenceError("bootstrap probability outside [0,1]")
    ordered = sorted(values)
    index = int(probability * D(len(ordered)))
    if index >= len(ordered):
        index = len(ordered) - 1
    return _float_decimal(ordered[index])


def _circular_block_sums(
    values: Sequence[float],
    block_length: int,
) -> tuple[tuple[float, ...], tuple[float, ...]]:
    length = len(values)
    if length < 1 or block_length < 1:
        raise EvidenceError("bootstrap dimensions must be positive")
    remainder = length % block_length
    full = tuple(
        sum(values[(start + offset) % length] for offset in range(block_length))
        for start in range(length)
    )
    partial = (
        tuple(
            sum(values[(start + offset) % length] for offset in range(remainder))
            for start in range(length)
        )
        if remainder
        else ()
    )
    return full, partial


def family_statistics(
    runs: Mapping[str, TrialRun],
    *,
    seed: int,
    block_length: int,
    replicates: int,
    lower_probability: Decimal,
    upper_probability: Decimal,
    alpha: Decimal,
) -> FamilyStatistics:
    """Synchronous circular bootstrap, Holm, and White reality check."""

    if not runs:
        raise EvidenceError("family statistics require runs")
    trial_ids = tuple(sorted(runs, key=lambda item: item.encode()))
    lengths = {len(runs[trial_id].daily_returns) for trial_id in trial_ids}
    dates = {runs[trial_id].daily_dates for trial_id in trial_ids}
    if len(lengths) != 1 or len(dates) != 1:
        raise MeasurementError("family daily matrices are not synchronous")
    length = next(iter(lengths))
    if length < 1:
        raise MeasurementError("family daily matrix is empty")
    logs: dict[str, tuple[float, ...]] = {}
    centered: dict[str, tuple[float, ...]] = {}
    log_blocks: dict[str, tuple[tuple[float, ...], tuple[float, ...]]] = {}
    centered_blocks: dict[str, tuple[tuple[float, ...], tuple[float, ...]]] = {}
    observed: dict[str, float] = {}
    for trial_id in trial_ids:
        values = tuple(math.log1p(float(value)) for value in runs[trial_id].daily_returns)
        if any(not math.isfinite(value) for value in values):
            raise MeasurementError("daily log return is non-finite")
        mean_value = sum(values) / length
        logs[trial_id] = values
        centered[trial_id] = tuple(value - mean_value for value in values)
        log_blocks[trial_id] = _circular_block_sums(values, block_length)
        centered_blocks[trial_id] = _circular_block_sums(
            centered[trial_id],
            block_length,
        )
        observed[trial_id] = math.sqrt(length) * mean_value
    rng = random.Random(seed)
    terminal_replicates: dict[str, list[float]] = {trial_id: [] for trial_id in trial_ids}
    exceedances = dict.fromkeys(trial_ids, 0)
    white_observed = max(observed.values())
    white_exceedances = 0
    full_block_count, remainder = divmod(length, block_length)
    sampled_block_count = full_block_count + (1 if remainder else 0)
    for _ in range(replicates):
        starts = tuple(rng.randrange(length) for _ in range(sampled_block_count))
        white_bootstrap = -math.inf
        for trial_id in trial_ids:
            full_logs, partial_logs = log_blocks[trial_id]
            full_centered, partial_centered = centered_blocks[trial_id]
            sampled_log = sum(full_logs[start] for start in starts[:full_block_count])
            sampled_centered = sum(full_centered[start] for start in starts[:full_block_count])
            if remainder:
                sampled_log += partial_logs[starts[-1]]
                sampled_centered += partial_centered[starts[-1]]
            terminal = 1000.0 * math.expm1(sampled_log)
            terminal_replicates[trial_id].append(terminal)
            centered_statistic = sampled_centered / math.sqrt(length)
            if centered_statistic >= observed[trial_id]:
                exceedances[trial_id] += 1
            white_bootstrap = max(white_bootstrap, centered_statistic)
        if white_bootstrap >= white_observed:
            white_exceedances += 1
    denominator = D(replicates + 1)
    individual_p = {trial_id: D(exceedances[trial_id] + 1) / denominator for trial_id in trial_ids}
    ranked = sorted(
        individual_p.items(),
        key=lambda item: (item[1], item[0].encode()),
    )
    holm_rejected = dict.fromkeys(trial_ids, False)
    still_rejecting = True
    family_size = len(trial_ids)
    for rank, (trial_id, p_value) in enumerate(ranked):
        threshold = alpha / D(family_size - rank)
        if still_rejecting and p_value <= threshold:
            holm_rejected[trial_id] = True
        else:
            still_rejecting = False
    packets = {
        trial_id: BootstrapPacket(
            lower_90=_bootstrap_quantile(
                terminal_replicates[trial_id],
                lower_probability,
            ),
            upper_90=_bootstrap_quantile(
                terminal_replicates[trial_id],
                upper_probability,
            ),
            bonferroni_lower=_bootstrap_quantile(
                terminal_replicates[trial_id],
                alpha / D(family_size),
            ),
            replicates=replicates,
            individual_p_value=individual_p[trial_id],
        )
        for trial_id in trial_ids
    }
    white_p = D("1") if white_observed <= 0 else D(white_exceedances + 1) / denominator
    return FamilyStatistics(
        packets=packets,
        holm_rejected=holm_rejected,
        white_reality_check_p_value=white_p,
        seed=seed,
        block_length=block_length,
        replicates=replicates,
    )


def single_statistics(
    run: TrialRun,
    *,
    seed: int,
    block_length: int,
    replicates: int,
    lower_probability: Decimal,
    upper_probability: Decimal,
    alpha: Decimal,
) -> BootstrapPacket:
    family = family_statistics(
        {run.spec.trial_id: run},
        seed=seed,
        block_length=block_length,
        replicates=replicates,
        lower_probability=lower_probability,
        upper_probability=upper_probability,
        alpha=alpha,
    )
    return family.packets[run.spec.trial_id]


def pbo_cscv(
    runs: Mapping[str, TrialRun],
    *,
    blocks: int,
    rows_per_block: int,
    excluded_tail_rows: int,
    expected_trials: int,
) -> dict[str, object]:
    """Compute repository-Q14 CSCV PBO on equal chronological blocks."""

    trial_ids = tuple(sorted(runs, key=lambda item: item.encode()))
    if len(trial_ids) != expected_trials:
        raise MeasurementError("PBO trial count differs from frozen complete family")
    if blocks != 8 or rows_per_block < 1:
        raise EvidenceError("PBO requires eight positive equal blocks")
    first_run = runs[trial_ids[0]]
    if any(runs[trial_id].daily_dates != first_run.daily_dates for trial_id in trial_ids):
        raise MeasurementError("PBO trial rows are not synchronous")
    used_rows = blocks * rows_per_block
    if len(first_run.daily_dates) != used_rows + excluded_tail_rows:
        raise MeasurementError("PBO row count differs from frozen equal-block law")
    block_indexes = tuple(
        tuple(range(block * rows_per_block, (block + 1) * rows_per_block))
        for block in range(blocks)
    )
    underperformance = 0
    selections: dict[str, int] = dict.fromkeys(trial_ids, 0)
    split_count = 0
    for in_sample_blocks in itertools.combinations(range(blocks), blocks // 2):
        in_sample = set(in_sample_blocks)
        out_sample = set(range(blocks)) - in_sample

        def score(trial_id: str, selected_blocks: set[int]) -> Decimal:
            run = runs[trial_id]
            return sum(
                (
                    run.exit_log_returns_by_day[index]
                    for block in selected_blocks
                    for index in block_indexes[block]
                ),
                D("0"),
            )

        in_scores = {trial_id: score(trial_id, in_sample) for trial_id in trial_ids}
        selected = min(
            trial_ids,
            key=lambda trial_id: (-in_scores[trial_id], trial_id.encode()),
        )
        selections[selected] += 1
        out_scores = sorted(score(trial_id, out_sample) for trial_id in trial_ids)
        midpoint = len(out_scores) // 2
        out_median = (out_scores[midpoint - 1] + out_scores[midpoint]) / D("2")
        if score(selected, out_sample) <= out_median:
            underperformance += 1
        split_count += 1
    if split_count != 70:
        raise MeasurementError("PBO split count mismatch")
    return {
        "schema": "VG5PboCscvV1",
        "method": "REPOSITORY_Q14_CSCV_PBO",
        "role": "DIAGNOSTIC_ONLY_NOT_RANK_GATE_OR_VERDICT_OVERRIDE",
        "chronologicalBlocks": blocks,
        "rowsPerBlock": rows_per_block,
        "developmentRowsUsed": used_rows,
        "excludedPurgedTailRows": excluded_tail_rows,
        "firstUsedDate": first_run.daily_dates[0].isoformat(),
        "lastUsedDate": first_run.daily_dates[used_rows - 1].isoformat(),
        "excludedTailDates": [day.isoformat() for day in first_run.daily_dates[used_rows:]],
        "trialCount": len(trial_ids),
        "splits": split_count,
        "underperformanceSplits": underperformance,
        "pbo": decimal_text(D(underperformance) / D(split_count)),
        "selectionCounts": selections,
        "tieBreak": "LOWEST_TRIAL_ID",
        "underperformanceRule": "SELECTED_OOS_AT_OR_BELOW_ALL_TRIAL_OOS_MEDIAN",
        "tieConvention": "REPOSITORY_Q14_IDENTICAL_CLONES_PBO_EQUALS_ONE",
    }


def _optional_decimal(value: Decimal | None) -> str:
    return "UNMEASURED" if value is None else decimal_text(value)


def decomposition_packet(value: Decomposition) -> dict[str, str]:
    packet = {
        "referenceGrossPriceMoveUsd": decimal_text(value.reference_gross),
        "entryAdverseExecutionUsd": decimal_text(value.entry_adverse),
        "buyFeeUsd": decimal_text(value.buy_fee),
        "exitAdverseExecutionUsd": decimal_text(value.exit_adverse),
        "sellFeeUsd": decimal_text(value.sell_fee),
        "netUsd": decimal_text(value.net),
        "residualUsd": decimal_text(value.residual()),
    }
    return packet


def run_summary(run: TrialRun) -> dict[str, object]:
    return {
        "trialId": run.spec.trial_id,
        "scenario": run.scenario.name,
        "period": run.period,
        "valid": run.valid,
        "invalidReasons": list(run.invalid_reasons),
        "startNavUsd": decimal_text(run.start_nav),
        "endNavUsd": decimal_text(run.end_nav),
        "netUsdPerInitial1000": decimal_text(run.net_usd),
        "fills": run.fills,
        "roundTrips": run.round_trips,
        "distinctSymbols": len(run.distinct_symbols),
        "distinctSymbolNames": list(run.distinct_symbols),
        "activeCalendarMonths": len(run.active_months),
        "activeCalendarMonthNames": list(run.active_months),
        "cashSignalDays": run.cash_signal_days,
        "maxDrawdownPct": decimal_text(run.max_drawdown_pct),
        "maxDrawdownUsd": decimal_text(run.max_drawdown_usd),
        "capacityProxyUsd": {
            "minimum": _optional_decimal(run.min_capacity_usd),
            "p05": _optional_decimal(run.p05_capacity_usd),
            "median": _optional_decimal(run.median_capacity_usd),
            "shareBelowAggregatedSameSymbolSameOpenRequiredNotional": _optional_decimal(
                run.capacity_share_below_sleeve
            ),
            "executableCapacity": "UNKNOWN",
        },
        "decomposition": decomposition_packet(run.decomposition),
    }


def bootstrap_packet(value: BootstrapPacket) -> dict[str, object]:
    return {
        "intervalCoveragePct": "90",
        "oneSidedLcbConfidencePct": "95",
        "lower90AndOneSided95LcbUsdPer1000": decimal_text(value.lower_90),
        "upper90UsdPer1000": decimal_text(value.upper_90),
        "bonferroniLowerUsdPer1000": decimal_text(value.bonferroni_lower),
        "individualNullCenteredPValue": decimal_text(value.individual_p_value),
        "replicates": value.replicates,
    }


def _gate_row(name: str, found: object, passed: bool) -> dict[str, object]:
    return {"gate": name, "found": found, "passed": passed}


def development_gates(
    champion_id: str,
    runs: Mapping[str, Mapping[str, TrialRun]],
    base_statistics: FamilyStatistics,
    stress_statistics: FamilyStatistics,
    protocol: Mapping[str, Any],
) -> tuple[dict[str, object], ...]:
    gates = protocol.get("gates")
    if not isinstance(gates, Mapping):
        raise EvidenceError("protocol gates missing")
    configured = gates.get("development")
    if not isinstance(configured, Mapping):
        raise EvidenceError("development gates missing")
    base = runs["base"][champion_id]
    stress = runs["stress"][champion_id]
    base_interval = base_statistics.packets[champion_id]
    stress_interval = stress_statistics.packets[champion_id]
    min_round_trips = require_int(
        configured.get("minimumRoundTrips"),
        field_name="development.minimumRoundTrips",
    )
    min_fills = require_int(
        configured.get("minimumFills"),
        field_name="development.minimumFills",
    )
    min_symbols = require_int(
        configured.get("minimumDistinctSymbols"),
        field_name="development.minimumDistinctSymbols",
    )
    min_months = require_int(
        configured.get("minimumActiveCalendarMonths"),
        field_name="development.minimumActiveCalendarMonths",
    )
    max_drawdown = decimal_value(
        configured.get("maximumDrawdownPct"),
        field_name="development.maximumDrawdownPct",
        minimum=D("0"),
    )
    matrix_complete = all(
        run.valid for scenario_runs in runs.values() for run in scenario_runs.values()
    )
    return (
        _gate_row("COMPLETE_32_TRIAL_X_3_SCENARIO_MATRIX", matrix_complete, matrix_complete),
        _gate_row("MINIMUM_ROUND_TRIPS", stress.round_trips, stress.round_trips >= min_round_trips),
        _gate_row("MINIMUM_FILLS", stress.fills, stress.fills >= min_fills),
        _gate_row(
            "MINIMUM_DISTINCT_SYMBOLS",
            len(stress.distinct_symbols),
            len(stress.distinct_symbols) >= min_symbols,
        ),
        _gate_row(
            "MINIMUM_ACTIVE_CALENDAR_MONTHS",
            len(stress.active_months),
            len(stress.active_months) >= min_months,
        ),
        _gate_row(
            "BASE_NET_POSITIVE",
            decimal_text(base.net_usd),
            base.net_usd > 0,
        ),
        _gate_row(
            "STRESS_NET_POSITIVE",
            decimal_text(stress.net_usd),
            stress.net_usd > 0,
        ),
        _gate_row(
            "BASE_ONE_SIDED_95_LCB_POSITIVE",
            decimal_text(base_interval.lower_90),
            base_interval.lower_90 > 0,
        ),
        _gate_row(
            "STRESS_ONE_SIDED_95_LCB_POSITIVE",
            decimal_text(stress_interval.lower_90),
            stress_interval.lower_90 > 0,
        ),
        _gate_row(
            "STRESS_BONFERRONI_LCB_POSITIVE",
            decimal_text(stress_interval.bonferroni_lower),
            stress_interval.bonferroni_lower > 0,
        ),
        _gate_row(
            "CHAMPION_HOLM_REJECTED",
            stress_statistics.holm_rejected[champion_id],
            stress_statistics.holm_rejected[champion_id],
        ),
        _gate_row(
            "WHITE_REALITY_CHECK_P_LE_0P05",
            decimal_text(stress_statistics.white_reality_check_p_value),
            stress_statistics.white_reality_check_p_value <= D("0.05"),
        ),
        _gate_row(
            "BASE_MAX_DRAWDOWN_AT_OR_BELOW_CAP",
            decimal_text(base.max_drawdown_pct),
            base.max_drawdown_pct <= max_drawdown,
        ),
        _gate_row(
            "STRESS_MAX_DRAWDOWN_AT_OR_BELOW_CAP",
            decimal_text(stress.max_drawdown_pct),
            stress.max_drawdown_pct <= max_drawdown,
        ),
        _gate_row(
            "STRESS_CAPACITY_PROXY_COVERS_AGGREGATED_SAME_SYMBOL_SAME_OPEN_NOTIONAL",
            _optional_decimal(stress.capacity_share_below_sleeve),
            stress.capacity_share_below_sleeve == 0,
        ),
        _gate_row(
            "INVALID_SELECTED_ENTRY_EXIT_OR_MARK_COUNT_ZERO",
            0,
            not stress.invalid_reasons,
        ),
    )


def holdout_gates(
    runs: Mapping[str, TrialRun],
    intervals: Mapping[str, BootstrapPacket],
    protocol: Mapping[str, Any],
) -> tuple[dict[str, object], ...]:
    gates = protocol.get("gates")
    if not isinstance(gates, Mapping):
        raise EvidenceError("protocol gates missing")
    configured = gates.get("holdout")
    if not isinstance(configured, Mapping):
        raise EvidenceError("holdout gates missing")
    base = runs["base"]
    stress = runs["stress"]
    min_round_trips = require_int(
        configured.get("minimumRoundTrips"),
        field_name="holdout.minimumRoundTrips",
    )
    min_fills = require_int(
        configured.get("minimumFills"),
        field_name="holdout.minimumFills",
    )
    min_symbols = require_int(
        configured.get("minimumDistinctSymbols"),
        field_name="holdout.minimumDistinctSymbols",
    )
    min_months = require_int(
        configured.get("minimumActiveCalendarMonths"),
        field_name="holdout.minimumActiveCalendarMonths",
    )
    max_drawdown = decimal_value(
        configured.get("maximumDrawdownPct"),
        field_name="holdout.maximumDrawdownPct",
        minimum=D("0"),
    )
    return (
        _gate_row("MINIMUM_ROUND_TRIPS", stress.round_trips, stress.round_trips >= min_round_trips),
        _gate_row("MINIMUM_FILLS", stress.fills, stress.fills >= min_fills),
        _gate_row(
            "MINIMUM_DISTINCT_SYMBOLS",
            len(stress.distinct_symbols),
            len(stress.distinct_symbols) >= min_symbols,
        ),
        _gate_row(
            "MINIMUM_ACTIVE_CALENDAR_MONTHS",
            len(stress.active_months),
            len(stress.active_months) >= min_months,
        ),
        _gate_row("BASE_NET_POSITIVE", decimal_text(base.net_usd), base.net_usd > 0),
        _gate_row("STRESS_NET_POSITIVE", decimal_text(stress.net_usd), stress.net_usd > 0),
        _gate_row(
            "BASE_ONE_SIDED_95_LCB_POSITIVE",
            decimal_text(intervals["base"].lower_90),
            intervals["base"].lower_90 > 0,
        ),
        _gate_row(
            "STRESS_ONE_SIDED_95_LCB_POSITIVE",
            decimal_text(intervals["stress"].lower_90),
            intervals["stress"].lower_90 > 0,
        ),
        _gate_row(
            "BASE_MAX_DRAWDOWN_AT_OR_BELOW_CAP",
            decimal_text(base.max_drawdown_pct),
            base.max_drawdown_pct <= max_drawdown,
        ),
        _gate_row(
            "STRESS_MAX_DRAWDOWN_AT_OR_BELOW_CAP",
            decimal_text(stress.max_drawdown_pct),
            stress.max_drawdown_pct <= max_drawdown,
        ),
        _gate_row(
            "STRESS_CAPACITY_PROXY_COVERS_AGGREGATED_SAME_SYMBOL_SAME_OPEN_NOTIONAL",
            _optional_decimal(stress.capacity_share_below_sleeve),
            stress.capacity_share_below_sleeve == 0,
        ),
        _gate_row(
            "INVALID_SELECTED_ENTRY_EXIT_OR_MARK_COUNT_ZERO",
            0,
            not stress.invalid_reasons,
        ),
    )


def _all_pass(rows: Sequence[Mapping[str, object]]) -> bool:
    return all(row.get("passed") is True for row in rows)


def _failed_gate_names(rows: Sequence[Mapping[str, object]]) -> list[str]:
    return [str(row.get("gate")) for row in rows if row.get("passed") is not True]


def _trial_matrix_packet(
    specs: Sequence[TrialSpec],
    runs: Mapping[str, Mapping[str, TrialRun]],
    statistics: Mapping[str, FamilyStatistics],
) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for spec in specs:
        row: dict[str, object] = {
            "trialId": spec.trial_id,
            "parameters": {
                "breakoutLookbackDays": spec.breakout_days,
                "abnormalVolumeThreshold": decimal_text(spec.volume_threshold),
                "trendSmaDays": spec.trend_days,
                "volatilityRegime": spec.volatility_regime,
                "holdDaysAndSleeves": spec.hold_days,
            },
            "scenarios": {},
        }
        scenarios_packet = row["scenarios"]
        assert isinstance(scenarios_packet, dict)
        for scenario_name in ("base", "stress", "severe"):
            packet = run_summary(runs[scenario_name][spec.trial_id])
            if scenario_name in statistics:
                packet["bootstrap"] = bootstrap_packet(
                    statistics[scenario_name].packets[spec.trial_id]
                )
                packet["holmRejected"] = statistics[scenario_name].holm_rejected[spec.trial_id]
            scenarios_packet[scenario_name] = packet
        row["costStress"] = {
            "stressIncrementVsBaseUsdPer1000": decimal_text(
                runs["stress"][spec.trial_id].net_usd - runs["base"][spec.trial_id].net_usd
            ),
            "severeIncrementVsBaseUsdPer1000": decimal_text(
                runs["severe"][spec.trial_id].net_usd - runs["base"][spec.trial_id].net_usd
            ),
        }
        rows.append(row)
    return rows


def _select_champion(
    specs: Sequence[TrialSpec],
    stress_runs: Mapping[str, TrialRun],
    *,
    selection_rows: int,
) -> TrialSpec:
    if selection_rows < 1:
        raise EvidenceError("champion selection rows must be positive")
    return min(
        specs,
        key=lambda spec: (
            -sum(
                stress_runs[spec.trial_id].exit_log_returns_by_day[:selection_rows],
                D("0"),
            ),
            spec.trial_id.encode(),
        ),
    )


def _period_calendar(
    protocol: Mapping[str, Any],
    period: str,
) -> tuple[date, date, date, date]:
    calendar = protocol.get("calendar")
    if not isinstance(calendar, Mapping):
        raise EvidenceError("protocol calendar missing")
    payload = calendar.get(period)
    if not isinstance(payload, Mapping):
        raise EvidenceError(f"calendar period missing: {period}")
    return (
        date_value(payload.get("signalStartInclusive"), field_name=f"{period}.signalStart"),
        date_value(payload.get("signalEndInclusive"), field_name=f"{period}.signalEnd"),
        date_value(payload.get("entryStartInclusive"), field_name=f"{period}.entryStart"),
        date_value(payload.get("lastExitInclusive"), field_name=f"{period}.lastExit"),
    )


def _statistics_config(protocol: Mapping[str, Any]) -> StatisticsConfig:
    statistics = protocol.get("statistics")
    if not isinstance(statistics, Mapping):
        raise EvidenceError("protocol statistics missing")
    bootstrap = statistics.get("bootstrap")
    if not isinstance(bootstrap, Mapping):
        raise EvidenceError("protocol bootstrap missing")
    trials = protocol.get("trials")
    if not isinstance(trials, Mapping):
        raise EvidenceError("protocol trials missing")
    family_size = require_int(
        trials.get("familySize"),
        field_name="trials.familySize",
        minimum=1,
    )
    alpha = decimal_value(
        statistics.get("multiplicity", {}).get("oneSidedAlpha")
        if isinstance(statistics.get("multiplicity"), Mapping)
        else None,
        field_name="multiplicity.oneSidedAlpha",
        minimum=D("0"),
    )
    lower_probability = decimal_value(
        bootstrap.get("lowerTailProbability"),
        field_name="bootstrap.lowerTailProbability",
        minimum=D("0"),
    )
    upper_probability = decimal_value(
        bootstrap.get("upperTailProbability"),
        field_name="bootstrap.upperTailProbability",
        minimum=D("0"),
    )
    bonferroni_probability = decimal_value(
        bootstrap.get("bonferroniLowerTailProbability"),
        field_name="bootstrap.bonferroniLowerTailProbability",
        minimum=D("0"),
    )
    if (
        lower_probability != alpha
        or upper_probability != D("1") - alpha
        or bonferroni_probability != alpha / D(family_size)
    ):
        raise EvidenceError("bootstrap probabilities disagree with frozen family alpha")
    return StatisticsConfig(
        seed=require_int(bootstrap.get("seed"), field_name="bootstrap.seed"),
        block_length=require_int(
            bootstrap.get("blockLengthDays"),
            field_name="bootstrap.blockLengthDays",
            minimum=1,
        ),
        replicates=require_int(
            bootstrap.get("replicates"),
            field_name="bootstrap.replicates",
            minimum=65_536,
        ),
        lower_probability=lower_probability,
        upper_probability=upper_probability,
        alpha=alpha,
        bonferroni_probability=bonferroni_probability,
    )


def _pbo_config(protocol: Mapping[str, Any]) -> tuple[int, int, int, int]:
    statistics = protocol.get("statistics")
    if not isinstance(statistics, Mapping):
        raise EvidenceError("protocol statistics missing")
    pbo = statistics.get("pbo")
    if not isinstance(pbo, Mapping):
        raise EvidenceError("protocol PBO missing")
    blocks = require_int(
        pbo.get("developmentChronologicalBlocks"),
        field_name="pbo.developmentChronologicalBlocks",
        minimum=4,
    )
    rows_per_block = require_int(
        pbo.get("rowsPerBlock"),
        field_name="pbo.rowsPerBlock",
        minimum=1,
    )
    excluded_tail_rows = require_int(
        pbo.get("excludedPurgedTailRows"),
        field_name="pbo.excludedPurgedTailRows",
    )
    expected_trials = require_int(
        pbo.get("allTrialsIncluded"),
        field_name="pbo.allTrialsIncluded",
        minimum=2,
    )
    if blocks % 2 or math.comb(blocks, blocks // 2) != 70:
        raise EvidenceError("PBO block law does not produce frozen 70 splits")
    if pbo.get("developmentRowsUsed") != blocks * rows_per_block:
        raise EvidenceError("PBO used-row declaration mismatch")
    return blocks, rows_per_block, excluded_tail_rows, expected_trials


def _run_scenarios(
    panel: Mapping[str, Mapping[date, Bar]],
    books: Mapping[str, Mapping[date, tuple[SignalMetric, ...]]],
    specs: Sequence[TrialSpec],
    protocol: Mapping[str, Any],
    *,
    period: str,
) -> dict[str, dict[str, TrialRun]]:
    signal_start, signal_end, entry_start, last_exit = _period_calendar(protocol, period)
    runs: dict[str, dict[str, TrialRun]] = {}
    for scenario_name in ("base", "stress", "severe"):
        scenario_value = scenario(protocol, scenario_name)
        scenario_runs: dict[str, TrialRun] = {}
        for spec in specs:
            scenario_runs[spec.trial_id] = simulate_trial(
                panel,
                books[spec.trial_id],
                spec,
                scenario_value,
                period=period,
                signal_start=signal_start,
                signal_end=signal_end,
                entry_start=entry_start,
                last_exit=last_exit,
            )
        runs[scenario_name] = scenario_runs
    return runs


def _merge_panels(
    left: Mapping[str, Mapping[date, Bar]],
    right: Mapping[str, Mapping[date, Bar]],
) -> dict[str, dict[date, Bar]]:
    merged = {symbol: dict(series) for symbol, series in left.items()}
    for symbol, series in right.items():
        target = merged.setdefault(symbol, {})
        overlap = set(target).intersection(series)
        if overlap:
            raise MeasurementError(f"panel merge overlap: {symbol}")
        target.update(series)
    return merged


def _candidate_seal_payload(
    champion: TrialSpec,
    gates: Sequence[Mapping[str, object]],
    matrix_packet: Sequence[Mapping[str, object]],
    pbo: Mapping[str, object],
    freeze_commit: str,
) -> dict[str, object]:
    evidence = {
        "developmentGateRows": list(gates),
        "developmentMatrix": list(matrix_packet),
        "pbo": dict(pbo),
    }
    return {
        "schema": "VG5CandidateSealV1",
        "state": "ONE_CHAMPION_SEALED_BEFORE_ANY_HOLDOUT_ARCHIVE_BODY_OPEN",
        "sealedAtUtc": datetime.now(UTC).isoformat(),
        "freezeCommit": freeze_commit,
        "freezeSha256": sha256_path(FREEZE_PATH),
        "championTrialId": champion.trial_id,
        "championParameters": {
            "breakoutLookbackDays": champion.breakout_days,
            "abnormalVolumeThreshold": decimal_text(champion.volume_threshold),
            "trendSmaDays": champion.trend_days,
            "volatilityRegime": champion.volatility_regime,
            "holdDaysAndSleeves": champion.hold_days,
        },
        "developmentGateRowsSha256": sha256_bytes(canonical_bytes(list(gates))),
        "developmentMatrixSha256": sha256_bytes(canonical_bytes(list(matrix_packet))),
        "pboSha256": sha256_bytes(canonical_bytes(dict(pbo))),
        "developmentEvidence": evidence,
        "runnerUpOrSubgroupRescue": False,
        "holdoutOutcomesObserved": False,
    }


def _candidate_development_evidence(
    candidate: Mapping[str, object],
) -> tuple[list[object], list[object], Mapping[str, object]]:
    if (
        candidate.get("schema") != "VG5CandidateSealV1"
        or candidate.get("state") != "ONE_CHAMPION_SEALED_BEFORE_ANY_HOLDOUT_ARCHIVE_BODY_OPEN"
    ):
        raise EvidenceError("candidate seal schema or state mismatch")
    evidence = _required_mapping(
        candidate.get("developmentEvidence"),
        field_name="candidate development evidence",
    )
    gates = evidence.get("developmentGateRows")
    matrix = evidence.get("developmentMatrix")
    pbo = evidence.get("pbo")
    if (
        not isinstance(gates, list)
        or any(not isinstance(row, Mapping) for row in gates)
        or not isinstance(matrix, list)
        or any(not isinstance(row, Mapping) for row in matrix)
        or not isinstance(pbo, Mapping)
    ):
        raise EvidenceError("candidate development evidence is malformed")
    if (
        candidate.get("developmentGateRowsSha256") != sha256_bytes(canonical_bytes(gates))
        or candidate.get("developmentMatrixSha256") != sha256_bytes(canonical_bytes(matrix))
        or candidate.get("pboSha256") != sha256_bytes(canonical_bytes(dict(pbo)))
    ):
        raise EvidenceError("candidate development evidence hash mismatch")
    return gates, matrix, pbo


def _outcome_receipt_payload(
    result_payload: Mapping[str, object],
) -> dict[str, object]:
    result_raw = canonical_bytes(dict(result_payload))
    holdout = result_payload.get("holdout")
    if not isinstance(holdout, Mapping):
        raise EvidenceError("result holdout packet missing")
    return {
        "schema": "VG5OutcomeReceiptV1",
        "resultSha256": sha256_bytes(result_raw),
        "measurementVerdict": result_payload["measurementVerdict"],
        "holdoutState": holdout["state"],
        "capitalAuthority": "NONE",
        "result": dict(result_payload),
    }


def _required_mapping(value: object, *, field_name: str) -> Mapping[str, object]:
    if not isinstance(value, Mapping):
        raise EvidenceError(f"{field_name} must be an object")
    return value


def _derived_scoreboard(result: Mapping[str, object]) -> dict[str, object]:
    """Derive every headline byte from the canonical period packets."""

    family = _required_mapping(result.get("family"), field_name="family")
    development = _required_mapping(
        result.get("development"),
        field_name="development",
    )
    holdout = _required_mapping(result.get("holdout"), field_name="holdout")
    champion = require_text(
        family.get("championTrialId"),
        field_name="family.championTrialId",
    )
    if development.get("championTrialId") != champion:
        raise EvidenceError("development champion differs from family champion")
    matrix = development.get("trialMatrix")
    if not isinstance(matrix, list):
        raise EvidenceError("development trial matrix missing")
    champion_rows = [
        row for row in matrix if isinstance(row, Mapping) and row.get("trialId") == champion
    ]
    if len(champion_rows) != 1:
        raise EvidenceError("development matrix does not contain one champion row")
    champion_row = champion_rows[0]
    scenarios = _required_mapping(
        champion_row.get("scenarios"),
        field_name="development champion scenarios",
    )
    base = _required_mapping(scenarios.get("base"), field_name="development base")
    stress = _required_mapping(scenarios.get("stress"), field_name="development stress")
    severe = _required_mapping(scenarios.get("severe"), field_name="development severe")
    base_bootstrap = _required_mapping(
        base.get("bootstrap"),
        field_name="development base bootstrap",
    )
    stress_bootstrap = _required_mapping(
        stress.get("bootstrap"),
        field_name="development stress bootstrap",
    )
    cost_stress = _required_mapping(
        champion_row.get("costStress"),
        field_name="development cost stress",
    )
    multiplicity = _required_mapping(
        development.get("multiplicity"),
        field_name="development multiplicity",
    )
    pbo = _required_mapping(development.get("pbo"), field_name="development pbo")
    stress_capacity = _required_mapping(
        stress.get("capacityProxyUsd"),
        field_name="development stress capacity",
    )
    development_gates = development.get("gates")
    if not isinstance(development_gates, list) or any(
        not isinstance(row, Mapping) for row in development_gates
    ):
        raise EvidenceError("development gate rows malformed")
    development_card: dict[str, object] = {
        "baseNetUsdPer1000": base.get("netUsdPerInitial1000"),
        "stressNetUsdPer1000": stress.get("netUsdPerInitial1000"),
        "severeNetUsdPer1000": severe.get("netUsdPerInitial1000"),
        "stressIncrementVsBaseUsdPer1000": cost_stress.get("stressIncrementVsBaseUsdPer1000"),
        "severeIncrementVsBaseUsdPer1000": cost_stress.get("severeIncrementVsBaseUsdPer1000"),
        "roundTrips": stress.get("roundTrips"),
        "fills": stress.get("fills"),
        "distinctSymbols": stress.get("distinctSymbols"),
        "activeCalendarMonths": stress.get("activeCalendarMonths"),
        "baseOneSided95LcbUsdPer1000": base_bootstrap.get("lower90AndOneSided95LcbUsdPer1000"),
        "stressOneSided95LcbUsdPer1000": stress_bootstrap.get("lower90AndOneSided95LcbUsdPer1000"),
        "stressBonferroniLcbUsdPer1000": stress_bootstrap.get("bonferroniLowerUsdPer1000"),
        "championHolmRejected": stress.get("holmRejected"),
        "whiteRealityCheckPValue": multiplicity.get("whiteRealityCheckPValue"),
        "pbo": pbo.get("pbo"),
        "maxDrawdownPct": stress.get("maxDrawdownPct"),
        "capacityProxyMinimumUsd": stress_capacity.get("minimum"),
        "capacityProxyP05Usd": stress_capacity.get("p05"),
        CAPACITY_HEADLINE_KEY: (
            stress_capacity.get("shareBelowAggregatedSameSymbolSameOpenRequiredNotional")
        ),
        "failedGateIds": _failed_gate_names(
            tuple(row for row in development_gates if isinstance(row, Mapping))
        ),
        "executableCapacity": "UNKNOWN",
    }
    if development.get("passed") is False:
        holdout_card: dict[str, object] = {
            "state": "UNOPENED_BY_GOVERNING_DEVELOPMENT_FAILURE",
            "baseNetUsdPer1000": "UNMEASURED",
            "stressNetUsdPer1000": "UNMEASURED",
            "baseOneSided95LcbUsdPer1000": "UNMEASURED",
            "stressOneSided95LcbUsdPer1000": "UNMEASURED",
            "roundTrips": "UNMEASURED",
            "fills": "UNMEASURED",
            "failedGateIds": [],
        }
    else:
        holdout_scenarios = _required_mapping(
            holdout.get("scenarios"),
            field_name="holdout scenarios",
        )
        holdout_base = _required_mapping(
            holdout_scenarios.get("base"),
            field_name="holdout base",
        )
        holdout_stress = _required_mapping(
            holdout_scenarios.get("stress"),
            field_name="holdout stress",
        )
        holdout_severe = _required_mapping(
            holdout_scenarios.get("severe"),
            field_name="holdout severe",
        )
        holdout_base_bootstrap = _required_mapping(
            holdout_base.get("bootstrap"),
            field_name="holdout base bootstrap",
        )
        holdout_stress_bootstrap = _required_mapping(
            holdout_stress.get("bootstrap"),
            field_name="holdout stress bootstrap",
        )
        holdout_capacity = _required_mapping(
            holdout_stress.get("capacityProxyUsd"),
            field_name="holdout stress capacity",
        )
        holdout_gates = holdout.get("gates")
        if not isinstance(holdout_gates, list) or any(
            not isinstance(row, Mapping) for row in holdout_gates
        ):
            raise EvidenceError("holdout gate rows malformed")
        holdout_card = {
            "state": holdout.get("state"),
            "baseNetUsdPer1000": holdout_base.get("netUsdPerInitial1000"),
            "stressNetUsdPer1000": holdout_stress.get("netUsdPerInitial1000"),
            "severeNetUsdPer1000": holdout_severe.get("netUsdPerInitial1000"),
            "baseOneSided95LcbUsdPer1000": holdout_base_bootstrap.get(
                "lower90AndOneSided95LcbUsdPer1000"
            ),
            "stressOneSided95LcbUsdPer1000": holdout_stress_bootstrap.get(
                "lower90AndOneSided95LcbUsdPer1000"
            ),
            "roundTrips": holdout_stress.get("roundTrips"),
            "fills": holdout_stress.get("fills"),
            "distinctSymbols": holdout_stress.get("distinctSymbols"),
            "activeCalendarMonths": holdout_stress.get("activeCalendarMonths"),
            "maxDrawdownPct": holdout_stress.get("maxDrawdownPct"),
            "capacityProxyMinimumUsd": holdout_capacity.get("minimum"),
            "capacityProxyP05Usd": holdout_capacity.get("p05"),
            CAPACITY_HEADLINE_KEY: (
                holdout_capacity.get("shareBelowAggregatedSameSymbolSameOpenRequiredNotional")
            ),
            "failedGateIds": _failed_gate_names(
                tuple(row for row in holdout_gates if isinstance(row, Mapping))
            ),
        }
    return {
        "verdict": result.get("measurementVerdict"),
        "championTrialId": champion,
        "development": development_card,
        "holdoutState": holdout.get("state"),
        "holdout": holdout_card,
    }


def validate_result_semantics(result: Mapping[str, object]) -> None:
    """Reject contradictory verdict, gate, holdout, scoreboard, or authority states."""

    if result.get("schema") != "VG5ResultV1":
        raise EvidenceError("result schema mismatch")
    verdict = result.get("measurementVerdict")
    if verdict not in {"GO", "NO_GO", "UNMEASURED"}:
        raise EvidenceError("result verdict outside frozen vocabulary")
    if result.get("capitalAuthority") != "NONE" or result.get("executionAuthority") != "NONE":
        raise EvidenceError("result authority exceeds frozen NONE boundary")
    development = result.get("development")
    holdout = result.get("holdout")
    scoreboard = result.get("scoreboard")
    if not isinstance(development, Mapping) or not isinstance(holdout, Mapping):
        raise EvidenceError("result period packets missing")
    if verdict == "UNMEASURED":
        if result.get("measurementState") != "TERMINAL_ONE_RUN_CONSUMED_INVALID_MEASUREMENT":
            raise EvidenceError("UNMEASURED result has contradictory measurement state")
        if holdout.get("state") not in {
            "UNOPENED_TERMINAL_UNMEASURED",
            "OPEN_ATTEMPTED_INVALID",
        }:
            raise EvidenceError("UNMEASURED result has contradictory holdout state")
        if scoreboard is not None:
            raise EvidenceError("UNMEASURED result must not carry a scoreboard")
        return
    if result.get("measurementState") != "TERMINAL_VALID_MEASUREMENT":
        raise EvidenceError("measured result has contradictory measurement state")
    development_gates = development.get("gates")
    development_passed = development.get("passed")
    if not isinstance(development_gates, list) or not isinstance(development_passed, bool):
        raise EvidenceError("development gate packet malformed")
    if development_passed != _all_pass(
        tuple(row for row in development_gates if isinstance(row, Mapping))
    ) or len(development_gates) != sum(1 for row in development_gates if isinstance(row, Mapping)):
        raise EvidenceError("development passed flag contradicts gate rows")
    if not development_passed:
        if verdict != "NO_GO" or holdout.get("state") != (
            "UNOPENED_BY_GOVERNING_DEVELOPMENT_FAILURE"
        ):
            raise EvidenceError("development failure did not preserve unopened NO_GO")
        if scoreboard != _derived_scoreboard(result):
            raise EvidenceError("scoreboard differs from canonical period evidence")
        return
    holdout_gates = holdout.get("gates")
    holdout_passed = holdout.get("passed")
    if (
        holdout.get("state") != "MEASURED_SINGLE_OPEN_CHAMPION_ONLY"
        or not isinstance(holdout_gates, list)
        or not isinstance(holdout_passed, bool)
    ):
        raise EvidenceError("development pass lacks measured single holdout")
    if holdout_passed != _all_pass(
        tuple(row for row in holdout_gates if isinstance(row, Mapping))
    ) or len(holdout_gates) != sum(1 for row in holdout_gates if isinstance(row, Mapping)):
        raise EvidenceError("holdout passed flag contradicts gate rows")
    expected_verdict = "GO" if holdout_passed else "NO_GO"
    if verdict != expected_verdict:
        raise EvidenceError("verdict contradicts holdout gates")
    if scoreboard != _derived_scoreboard(result):
        raise EvidenceError("scoreboard differs from canonical period evidence")


def _write_result(
    state_root: Path,
    payload: dict[str, Any],
) -> dict[str, Any]:
    validate_result_semantics(payload)
    result_raw = canonical_bytes(payload)
    receipt = _outcome_receipt_payload(payload)
    receipt_path = state_root / "outcome-receipt.v1.json"
    if receipt_path.exists():
        existing, _ = load_json(receipt_path)
        if existing.get("resultSha256") != sha256_bytes(result_raw):
            raise EvidenceError("existing outcome receipt binds a different result")
    else:
        exclusive_write(receipt_path, canonical_bytes(receipt))
    if not RESULT_PATH.exists():
        exclusive_write(RESULT_PATH, result_raw)
    elif sha256_path(RESULT_PATH) != sha256_bytes(result_raw):
        raise EvidenceError("existing result binds different bytes")
    return payload


def _restore_result_from_receipt(state_root: Path) -> dict[str, Any] | None:
    receipt_path = state_root / "outcome-receipt.v1.json"
    if not receipt_path.exists():
        return None
    receipt, receipt_raw = load_json(receipt_path)
    embedded = receipt.get("result")
    if receipt.get("schema") != "VG5OutcomeReceiptV1" or not isinstance(embedded, dict):
        raise EvidenceError("outcome receipt lacks embedded terminal result")
    embedded_raw = canonical_bytes(embedded)
    if receipt.get("resultSha256") != sha256_bytes(embedded_raw):
        raise EvidenceError("outcome receipt embedded result hash mismatch")
    validate_result_semantics(embedded)
    holdout = _required_mapping(
        embedded.get("holdout"),
        field_name="embedded result holdout",
    )
    if (
        receipt_raw != canonical_bytes(receipt)
        or receipt.get("measurementVerdict") != embedded.get("measurementVerdict")
        or receipt.get("holdoutState") != holdout.get("state")
        or receipt.get("capitalAuthority") != "NONE"
    ):
        raise EvidenceError("outcome receipt metadata contradicts embedded result")
    if RESULT_PATH.exists():
        if sha256_path(RESULT_PATH) != sha256_bytes(embedded_raw):
            atomic_write(RESULT_PATH, embedded_raw)
    else:
        exclusive_write(RESULT_PATH, embedded_raw)
    return embedded


def _restore_candidate_from_external(state_root: Path) -> dict[str, Any] | None:
    external_path = state_root / "candidate-seal.v1.json"
    if not external_path.exists():
        return None
    candidate, raw = load_json(external_path)
    if (
        candidate.get("schema") != "VG5CandidateSealV1"
        or candidate.get("state") != "ONE_CHAMPION_SEALED_BEFORE_ANY_HOLDOUT_ARCHIVE_BODY_OPEN"
        or raw != canonical_bytes(candidate)
    ):
        raise EvidenceError("external candidate seal is invalid")
    _candidate_development_evidence(candidate)
    if CANDIDATE_SEAL_PATH.exists():
        if sha256_path(CANDIDATE_SEAL_PATH) != sha256_bytes(raw):
            atomic_write(CANDIDATE_SEAL_PATH, raw)
    else:
        exclusive_write(CANDIDATE_SEAL_PATH, raw)
    return candidate


def _existing_sha(path: Path) -> str:
    return sha256_path(path) if path.exists() or path.is_symlink() else "NOT_CREATED"


def _terminal_unmeasured(
    state_root: Path,
    shared_root: Path,
    error: Exception,
) -> dict[str, Any]:
    restored = _restore_result_from_receipt(state_root)
    if restored is not None:
        return restored
    if RESULT_PATH.exists():
        raise EvidenceError("repo-only result lacks authoritative external outcome receipt")
    protocol, freeze_payload, _, _ = load_freeze(state_root, shared_root)
    _, protocol_sha = load_protocol()
    candidate = _restore_candidate_from_external(state_root)
    candidate_evidence = (
        _candidate_development_evidence(candidate) if candidate is not None else None
    )
    champion = (
        require_text(
            candidate.get("championTrialId"),
            field_name="candidate.championTrialId",
        )
        if candidate is not None
        else "UNMEASURED"
    )
    pbo_value: object = "UNMEASURED"
    if candidate_evidence is not None:
        pbo_value = candidate_evidence[2].get("pbo", "UNMEASURED")
    preflight_payload: Mapping[str, object] | None = None
    if (state_root / PREFLIGHT_RECEIPT).exists():
        preflight_payload, _ = load_json(state_root / PREFLIGHT_RECEIPT)
    freeze_commit = (
        require_text(
            preflight_payload.get("freezeCommit"),
            field_name="preflight.freezeCommit",
        )
        if preflight_payload is not None
        else git_output("rev-parse", "HEAD")
    )
    holdout_marker = state_root / HOLDOUT_MARKER
    result: dict[str, Any] = {
        "schema": "VG5ResultV1",
        "protocolId": protocol["protocolId"],
        "measurementVerdict": "UNMEASURED",
        "measurementState": "TERMINAL_ONE_RUN_CONSUMED_INVALID_MEASUREMENT",
        "capitalAuthority": "NONE",
        "executionAuthority": "NONE",
        "provenance": {
            "canonicalBaseCommit": protocol["canonicalBaseCommit"],
            "freezeCommit": freeze_commit,
            "freezeSha256": sha256_path(FREEZE_PATH),
            "protocolSha256": protocol_sha,
            "evaluatorSha256": script_sha(),
            "officialSourceResearchSha256": sha256_path(SOURCE_RESEARCH_PATH),
            "sharedDiscoverySha256": freeze_payload["bindings"]["sharedDiscoverySha256"],
            "sharedAcquisitionManifestSha256": freeze_payload["bindings"][
                "sharedAcquisitionManifestSha256"
            ],
            "preflightReceiptSha256": _existing_sha(state_root / PREFLIGHT_RECEIPT),
            "developmentRunMarkerSha256": _existing_sha(state_root / DEVELOPMENT_MARKER),
            "candidateSealSha256": _existing_sha(CANDIDATE_SEAL_PATH),
            "externalCandidateSealSha256": _existing_sha(state_root / "candidate-seal.v1.json"),
            "holdoutOpenMarkerSha256": _existing_sha(state_root / HOLDOUT_MARKER),
            "sharedRoot": str(shared_root),
            "sharedCorpusMutationAuthority": "NONE",
        },
        "family": {
            "attemptCount": len(trial_specs(protocol)),
            "championTrialId": champion,
            "pbo": pbo_value,
            "pboRole": "DIAGNOSTIC_ONLY_NOT_RANK_GATE_OR_VERDICT_OVERRIDE",
        },
        "failure": {
            "class": type(error).__name__,
            "reason": str(error)[:500],
            "rerunAllowed": False,
        },
        "development": {
            "state": "INVALID_OR_INCOMPLETE",
            "interval": {
                "signalStartInclusive": "2025-07-01",
                "signalEndInclusive": "2026-02-19",
            },
        },
        "holdout": {
            "state": (
                "OPEN_ATTEMPTED_INVALID"
                if holdout_marker.exists()
                else "UNOPENED_TERMINAL_UNMEASURED"
            ),
            "interval": {
                "signalStartInclusive": "2026-03-01",
                "signalEndInclusive": "2026-06-21",
                "windowEndExclusive": "2026-07-01",
            },
        },
        "limitations": [
            "ACCOUNT_EFFECTIVE_COMMISSION_UNKNOWN",
            "HISTORICAL_SPREAD_DEPTH_QUEUE_FILTERS_AND_IMPACT_UNKNOWN",
            "EXECUTABLE_CAPACITY_UNKNOWN",
            "PUBLIC_ARCHIVE_DISCOVERY_IS_NOT_HISTORICAL_EXCHANGE_INFO",
            "DONOR_605_SYMBOL_UNIVERSE_REUSED_NON_ASCII_COMPLETENESS_NOT_REASSERTED",
            "CAPITAL_AUTHORITY_NONE",
        ],
    }
    return _write_result(state_root, result)


def finalize_terminal(state_root: Path, shared_root: Path) -> dict[str, Any]:
    """Finalize durable receipt bytes or fail a consumed interrupted run closed."""

    state_root, shared_root = validate_roots(state_root, shared_root)
    load_freeze(state_root, shared_root)
    restored = _restore_result_from_receipt(state_root)
    if restored is not None:
        return restored
    if RESULT_PATH.exists():
        raise EvidenceError("repo-only result lacks authoritative external outcome receipt")
    if not (state_root / DEVELOPMENT_MARKER).exists():
        raise EvidenceError("no consumed V-G5 run exists to finalize")
    return _terminal_unmeasured(
        state_root,
        shared_root,
        EvidenceError("PROCESS_INTERRUPTED_AFTER_DEVELOPMENT_MARKER_NO_RERUN"),
    )


def _assert_run_stage_git(protocol: Mapping[str, Any]) -> str:
    if git_output("status", "--porcelain=v1"):
        raise EvidenceError("run requires a clean committed freeze packet")
    base = require_text(protocol.get("canonicalBaseCommit"), field_name="canonicalBaseCommit")
    head = git_output("rev-parse", "HEAD")
    if git_output("rev-parse", f"{head}^") != base:
        raise EvidenceError("run commit is not a direct child of canonical base")
    changed = git_changed_paths(base, head)
    if not changed or any(not path.startswith("quant/research/vg5/") for path in changed):
        raise EvidenceError("run commit violates exclusive V-G5 path scope")
    return head


def run_experiment(state_root: Path, shared_root: Path) -> dict[str, Any]:
    """Consume the sealed development run and, only after a pass, one holdout."""

    state_root, shared_root = validate_roots(state_root, shared_root)
    if RESULT_PATH.exists() or CANDIDATE_SEAL_PATH.exists():
        raise EvidenceError("V-G5 result or candidate seal already exists")
    protocol, protocol_sha = load_protocol()
    freeze_commit = _assert_run_stage_git(protocol)
    _, freeze_payload, acquisition, symbols = load_freeze(state_root, shared_root)
    preflight_payload = preflight(state_root, shared_root)
    if preflight_payload.get("freezeCommit") != freeze_commit:
        raise EvidenceError("preflight is not bound to current freeze commit")
    marker_payload = {
        "schema": "VG5DevelopmentRunMarkerV1",
        "state": "CREATED_BEFORE_FIRST_VG5_ZIP_MEMBER_OPEN",
        "createdAtUtc": datetime.now(UTC).isoformat(),
        "freezeCommit": freeze_commit,
        "freezeSha256": sha256_path(FREEZE_PATH),
        "preflightReceiptSha256": sha256_path(state_root / PREFLIGHT_RECEIPT),
        "allowedRunCount": 1,
        "archiveBodiesOpenedBeforeMarker": False,
        "rerunAllowed": False,
    }
    exclusive_write(
        state_root / DEVELOPMENT_MARKER,
        canonical_bytes(marker_payload),
    )
    try:
        specs = trial_specs(protocol)
        statistics_config = _statistics_config(protocol)
        data = protocol["data"]
        assert isinstance(data, Mapping)
        dev_allowed = protocol["calendar"]["development"][
            "archiveMonthsThatMayOpenBeforeCandidateSeal"
        ]
        assert isinstance(dev_allowed, list)
        assert len(dev_allowed) == 2
        development_months = month_range(str(dev_allowed[0]), str(dev_allowed[1]))
        if set(development_months).intersection(set(data["holdoutArchiveMonths"])):
            raise MeasurementError("development month set touches holdout")
        development_panel = load_bars(
            shared_root,
            acquisition,
            symbols,
            development_months,
        )
        dev_signal_start, dev_signal_end, _, _ = _period_calendar(
            protocol,
            "development",
        )
        dev_signal_days = _dates(dev_signal_start, dev_signal_end)
        development_books, development_diagnostics = build_signal_books(
            development_panel,
            dev_signal_days,
            specs,
            protocol,
        )
        development_runs = _run_scenarios(
            development_panel,
            development_books,
            specs,
            protocol,
            period="development",
        )
        base_statistics = family_statistics(
            development_runs["base"],
            seed=statistics_config.seed,
            block_length=statistics_config.block_length,
            replicates=statistics_config.replicates,
            lower_probability=statistics_config.lower_probability,
            upper_probability=statistics_config.upper_probability,
            alpha=statistics_config.alpha,
        )
        stress_statistics = family_statistics(
            development_runs["stress"],
            seed=statistics_config.seed,
            block_length=statistics_config.block_length,
            replicates=statistics_config.replicates,
            lower_probability=statistics_config.lower_probability,
            upper_probability=statistics_config.upper_probability,
            alpha=statistics_config.alpha,
        )
        statistics = {
            "base": base_statistics,
            "stress": stress_statistics,
        }
        pbo_blocks, pbo_rows, pbo_excluded, pbo_trials = _pbo_config(protocol)
        champion = _select_champion(
            specs,
            development_runs["stress"],
            selection_rows=pbo_blocks * pbo_rows,
        )
        pbo = pbo_cscv(
            development_runs["stress"],
            blocks=pbo_blocks,
            rows_per_block=pbo_rows,
            excluded_tail_rows=pbo_excluded,
            expected_trials=pbo_trials,
        )
        matrix_packet = _trial_matrix_packet(
            specs,
            development_runs,
            statistics,
        )
        dev_gate_rows = development_gates(
            champion.trial_id,
            development_runs,
            base_statistics,
            stress_statistics,
            protocol,
        )
        development_passed = _all_pass(dev_gate_rows)
        development_packet: dict[str, object] = {
            "state": "MEASURED",
            "interval": {
                "signalStartInclusive": dev_signal_start.isoformat(),
                "signalEndInclusive": dev_signal_end.isoformat(),
                "lastExitInclusive": _period_calendar(protocol, "development")[3].isoformat(),
            },
            "archiveMonthsOpened": list(development_months),
            "diagnostics": development_diagnostics,
            "championTrialId": champion.trial_id,
            "championSelectionLaw": protocol["trials"]["championSelection"],
            "gates": list(dev_gate_rows),
            "passed": development_passed,
            "multiplicity": {
                "familySize": len(specs),
                "whiteRealityCheckPValue": decimal_text(
                    stress_statistics.white_reality_check_p_value
                ),
                "holmRejectedTrialIds": [
                    trial_id
                    for trial_id in sorted(
                        stress_statistics.holm_rejected,
                        key=lambda item: item.encode(),
                    )
                    if stress_statistics.holm_rejected[trial_id]
                ],
                "siblingFamilyCorrectionOwner": "N3_SUCCESSOR_ORCHESTRATOR",
            },
            "pbo": pbo,
            "trialMatrix": matrix_packet,
        }
        holdout_packet: dict[str, object]
        holdout_scoreboard: dict[str, object]
        verdict: str
        if not development_passed:
            holdout_packet = {
                "state": "UNOPENED_BY_GOVERNING_DEVELOPMENT_FAILURE",
                "interval": {
                    "signalStartInclusive": "2026-03-01",
                    "signalEndInclusive": "2026-06-21",
                    "windowEndExclusive": "2026-07-01",
                },
                "archiveMonthsOpened": [],
                "bootstrapInterval": "UNMEASURED",
                "netUsdPerInitial1000": "UNMEASURED",
                "samplesFills": "UNMEASURED",
            }
            holdout_scoreboard = {
                "state": "UNOPENED_BY_GOVERNING_DEVELOPMENT_FAILURE",
                "baseNetUsdPer1000": "UNMEASURED",
                "stressNetUsdPer1000": "UNMEASURED",
                "baseOneSided95LcbUsdPer1000": "UNMEASURED",
                "stressOneSided95LcbUsdPer1000": "UNMEASURED",
                "roundTrips": "UNMEASURED",
                "fills": "UNMEASURED",
                "failedGateIds": [],
            }
            verdict = "NO_GO"
        else:
            candidate_payload = _candidate_seal_payload(
                champion,
                dev_gate_rows,
                matrix_packet,
                pbo,
                freeze_commit,
            )
            candidate_raw = canonical_bytes(candidate_payload)
            exclusive_write(
                state_root / "candidate-seal.v1.json",
                candidate_raw,
            )
            exclusive_write(CANDIDATE_SEAL_PATH, candidate_raw)
            holdout_marker_payload = {
                "schema": "VG5HoldoutOpenMarkerV1",
                "state": "CREATED_AFTER_ONE_CHAMPION_SEAL_BEFORE_FIRST_HOLDOUT_ZIP_MEMBER_OPEN",
                "createdAtUtc": datetime.now(UTC).isoformat(),
                "candidateSealSha256": sha256_bytes(candidate_raw),
                "championTrialId": champion.trial_id,
                "allowedOpenCount": 1,
                "rerunAllowed": False,
            }
            exclusive_write(
                state_root / HOLDOUT_MARKER,
                canonical_bytes(holdout_marker_payload),
            )
            holdout_months = tuple(str(item) for item in data["holdoutArchiveMonths"])
            holdout_only_panel = load_bars(
                shared_root,
                acquisition,
                symbols,
                holdout_months,
            )
            full_panel = _merge_panels(development_panel, holdout_only_panel)
            hold_signal_start, hold_signal_end, _, _ = _period_calendar(
                protocol,
                "holdout",
            )
            holdout_books, holdout_diagnostics = build_signal_books(
                full_panel,
                _dates(hold_signal_start, hold_signal_end),
                (champion,),
                protocol,
            )
            holdout_nested = _run_scenarios(
                full_panel,
                holdout_books,
                (champion,),
                protocol,
                period="holdout",
            )
            holdout_runs = {
                scenario_name: scenario_runs[champion.trial_id]
                for scenario_name, scenario_runs in holdout_nested.items()
            }
            holdout_intervals = {
                "base": single_statistics(
                    holdout_runs["base"],
                    seed=statistics_config.seed + 1,
                    block_length=statistics_config.block_length,
                    replicates=statistics_config.replicates,
                    lower_probability=statistics_config.lower_probability,
                    upper_probability=statistics_config.upper_probability,
                    alpha=statistics_config.alpha,
                ),
                "stress": single_statistics(
                    holdout_runs["stress"],
                    seed=statistics_config.seed + 1,
                    block_length=statistics_config.block_length,
                    replicates=statistics_config.replicates,
                    lower_probability=statistics_config.lower_probability,
                    upper_probability=statistics_config.upper_probability,
                    alpha=statistics_config.alpha,
                ),
            }
            hold_gate_rows = holdout_gates(
                holdout_runs,
                holdout_intervals,
                protocol,
            )
            holdout_passed = _all_pass(hold_gate_rows)
            holdout_packet = {
                "state": "MEASURED_SINGLE_OPEN_CHAMPION_ONLY",
                "interval": {
                    "signalStartInclusive": hold_signal_start.isoformat(),
                    "signalEndInclusive": hold_signal_end.isoformat(),
                    "windowEndExclusive": "2026-07-01",
                    "lastExitInclusive": _period_calendar(protocol, "holdout")[3].isoformat(),
                },
                "archiveMonthsOpened": list(holdout_months),
                "diagnostics": holdout_diagnostics,
                "championTrialId": champion.trial_id,
                "scenarios": {
                    scenario_name: {
                        **run_summary(holdout_runs[scenario_name]),
                        **(
                            {"bootstrap": bootstrap_packet(holdout_intervals[scenario_name])}
                            if scenario_name in holdout_intervals
                            else {}
                        ),
                    }
                    for scenario_name in ("base", "stress", "severe")
                },
                "costStress": {
                    "stressIncrementVsBaseUsdPer1000": decimal_text(
                        holdout_runs["stress"].net_usd - holdout_runs["base"].net_usd
                    ),
                    "severeIncrementVsBaseUsdPer1000": decimal_text(
                        holdout_runs["severe"].net_usd - holdout_runs["base"].net_usd
                    ),
                },
                "gates": list(hold_gate_rows),
                "passed": holdout_passed,
            }
            holdout_scoreboard = {
                "state": "MEASURED_SINGLE_OPEN_CHAMPION_ONLY",
                "baseNetUsdPer1000": decimal_text(holdout_runs["base"].net_usd),
                "stressNetUsdPer1000": decimal_text(holdout_runs["stress"].net_usd),
                "severeNetUsdPer1000": decimal_text(holdout_runs["severe"].net_usd),
                "baseOneSided95LcbUsdPer1000": decimal_text(holdout_intervals["base"].lower_90),
                "stressOneSided95LcbUsdPer1000": decimal_text(holdout_intervals["stress"].lower_90),
                "roundTrips": holdout_runs["stress"].round_trips,
                "fills": holdout_runs["stress"].fills,
                "distinctSymbols": len(holdout_runs["stress"].distinct_symbols),
                "activeCalendarMonths": len(holdout_runs["stress"].active_months),
                "maxDrawdownPct": decimal_text(holdout_runs["stress"].max_drawdown_pct),
                "capacityProxyMinimumUsd": _optional_decimal(
                    holdout_runs["stress"].min_capacity_usd
                ),
                "capacityProxyP05Usd": _optional_decimal(holdout_runs["stress"].p05_capacity_usd),
                CAPACITY_HEADLINE_KEY: _optional_decimal(
                    holdout_runs["stress"].capacity_share_below_sleeve
                ),
                "failedGateIds": _failed_gate_names(hold_gate_rows),
            }
            verdict = "GO" if holdout_passed else "NO_GO"
        champion_runs = {
            name: development_runs[name][champion.trial_id] for name in ("base", "stress", "severe")
        }
        result: dict[str, Any] = {
            "schema": "VG5ResultV1",
            "protocolId": protocol["protocolId"],
            "measurementVerdict": verdict,
            "measurementState": "TERMINAL_VALID_MEASUREMENT",
            "capitalAuthority": "NONE",
            "executionAuthority": "NONE",
            "provenance": {
                "canonicalBaseCommit": protocol["canonicalBaseCommit"],
                "freezeCommit": freeze_commit,
                "freezeSha256": sha256_path(FREEZE_PATH),
                "protocolSha256": protocol_sha,
                "evaluatorSha256": script_sha(),
                "officialSourceResearchSha256": sha256_path(SOURCE_RESEARCH_PATH),
                "sharedDiscoverySha256": freeze_payload["bindings"]["sharedDiscoverySha256"],
                "sharedAcquisitionManifestSha256": freeze_payload["bindings"][
                    "sharedAcquisitionManifestSha256"
                ],
                "preflightReceiptSha256": sha256_path(state_root / PREFLIGHT_RECEIPT),
                "developmentRunMarkerSha256": sha256_path(state_root / DEVELOPMENT_MARKER),
                "candidateSealSha256": _existing_sha(CANDIDATE_SEAL_PATH),
                "externalCandidateSealSha256": _existing_sha(state_root / "candidate-seal.v1.json"),
                "holdoutOpenMarkerSha256": (
                    sha256_path(state_root / HOLDOUT_MARKER)
                    if (state_root / HOLDOUT_MARKER).exists()
                    else "NOT_CREATED"
                ),
                "sharedRoot": str(shared_root),
                "sharedCorpusMutationAuthority": "NONE",
            },
            "family": {
                "attemptCount": len(specs),
                "championTrialId": champion.trial_id,
                "pbo": pbo["pbo"],
                "pboRole": pbo["role"],
            },
            "development": development_packet,
            "holdout": holdout_packet,
            "scoreboard": {
                "verdict": verdict,
                "championTrialId": champion.trial_id,
                "development": {
                    "baseNetUsdPer1000": decimal_text(champion_runs["base"].net_usd),
                    "stressNetUsdPer1000": decimal_text(champion_runs["stress"].net_usd),
                    "severeNetUsdPer1000": decimal_text(champion_runs["severe"].net_usd),
                    "stressIncrementVsBaseUsdPer1000": decimal_text(
                        champion_runs["stress"].net_usd - champion_runs["base"].net_usd
                    ),
                    "severeIncrementVsBaseUsdPer1000": decimal_text(
                        champion_runs["severe"].net_usd - champion_runs["base"].net_usd
                    ),
                    "roundTrips": champion_runs["stress"].round_trips,
                    "fills": champion_runs["stress"].fills,
                    "distinctSymbols": len(champion_runs["stress"].distinct_symbols),
                    "activeCalendarMonths": len(champion_runs["stress"].active_months),
                    "baseOneSided95LcbUsdPer1000": decimal_text(
                        base_statistics.packets[champion.trial_id].lower_90
                    ),
                    "stressOneSided95LcbUsdPer1000": decimal_text(
                        stress_statistics.packets[champion.trial_id].lower_90
                    ),
                    "stressBonferroniLcbUsdPer1000": decimal_text(
                        stress_statistics.packets[champion.trial_id].bonferroni_lower
                    ),
                    "championHolmRejected": stress_statistics.holm_rejected[champion.trial_id],
                    "whiteRealityCheckPValue": decimal_text(
                        stress_statistics.white_reality_check_p_value
                    ),
                    "pbo": pbo["pbo"],
                    "maxDrawdownPct": decimal_text(champion_runs["stress"].max_drawdown_pct),
                    "capacityProxyMinimumUsd": _optional_decimal(
                        champion_runs["stress"].min_capacity_usd
                    ),
                    "capacityProxyP05Usd": _optional_decimal(
                        champion_runs["stress"].p05_capacity_usd
                    ),
                    CAPACITY_HEADLINE_KEY: _optional_decimal(
                        champion_runs["stress"].capacity_share_below_sleeve
                    ),
                    "failedGateIds": _failed_gate_names(dev_gate_rows),
                    "executableCapacity": "UNKNOWN",
                },
                "holdoutState": holdout_packet["state"],
                "holdout": holdout_scoreboard,
            },
            "costTruth": {
                "publicRegularFeeBpsPerFill": "10",
                "baseTotalPerFillBps": "15",
                "stressTotalPerFillBps": "20",
                "severeTotalPerFillBps": "35",
                "accountEffectiveCommission": "UNKNOWN",
                "historicalSpreadImpactAndTaxState": "UNKNOWN",
            },
            "limitations": [
                "ACCOUNT_EFFECTIVE_COMMISSION_UNKNOWN",
                "HISTORICAL_SPREAD_DEPTH_QUEUE_FILTERS_AND_IMPACT_UNKNOWN",
                "EXECUTABLE_CAPACITY_UNKNOWN_PUBLIC_PARTICIPATION_PROXY_ONLY",
                "PUBLIC_ARCHIVE_DISCOVERY_IS_NOT_HISTORICAL_EXCHANGE_INFO",
                "DONOR_605_SYMBOL_UNIVERSE_REUSED_NON_ASCII_COMPLETENESS_NOT_REASSERTED",
                "USDT_IS_TREATED_AS_USD_AT_A_FROZEN_1_TO_1_REPORTING_CONVENTION",
                "PBO_IS_DIAGNOSTIC_ONLY",
                "N3_MUST_APPLY_SIBLING_FAMILY_MULTIPLICITY",
                "CAPITAL_AND_EXECUTION_AUTHORITY_NONE",
            ],
        }
        return _write_result(state_root, result)
    except Exception as error:
        return _terminal_unmeasured(state_root, shared_root, error)


def seal_checksums() -> dict[str, object]:
    if not RESULT_PATH.exists():
        raise EvidenceError("result.v1.json is required before SHA256SUMS")
    if CHECKSUMS_PATH.exists():
        raise EvidenceError("SHA256SUMS already exists")
    expected_names = _expected_packet_names()
    actual_names = _actual_packet_names()
    if actual_names != expected_names:
        raise EvidenceError("packet file set differs from frozen allowed set")
    rows: list[str] = []
    for name in sorted(actual_names, key=lambda item: item.encode()):
        path = PACKET_DIR / name
        rows.append(f"{sha256_path(path)}  {path.name}")
    exclusive_write(CHECKSUMS_PATH, normalized_lines(rows))
    return {
        "schema": "VG5ChecksumSealV1",
        "fileCount": len(rows),
        "sha256sumsSha256": sha256_path(CHECKSUMS_PATH),
    }


def _expected_packet_names() -> frozenset[str]:
    result, _ = load_json(RESULT_PATH)
    validate_result_semantics(result)
    provenance = result.get("provenance")
    if not isinstance(provenance, Mapping):
        raise EvidenceError("result provenance missing")
    candidate_hash = provenance.get("candidateSealSha256")
    if candidate_hash == "NOT_CREATED":
        return REQUIRED_PACKET_FILES
    if not isinstance(candidate_hash, str) or len(candidate_hash) != 64:
        raise EvidenceError("candidate provenance hash malformed")
    return REQUIRED_PACKET_FILES | OPTIONAL_PACKET_FILES


def _actual_packet_names() -> frozenset[str]:
    names: set[str] = set()
    for path in PACKET_DIR.iterdir():
        if path.name == "SHA256SUMS":
            continue
        safe_file(path)
        names.add(path.name)
    return frozenset(names)


def _verify_checksums() -> int:
    try:
        rows = read_regular_file(CHECKSUMS_PATH).decode("ascii").splitlines()
    except UnicodeDecodeError as exc:
        raise EvidenceError("SHA256SUMS is not ASCII") from exc
    expected_names = _expected_packet_names()
    actual_names = _actual_packet_names()
    if actual_names != expected_names:
        raise EvidenceError("packet file set differs from frozen allowed set")
    observed_names: list[str] = []
    for row in rows:
        pieces = row.split("  ", maxsplit=1)
        if len(pieces) != 2:
            raise EvidenceError("SHA256SUMS row malformed")
        expected, name = pieces
        if (
            Path(name).name != name
            or name == "SHA256SUMS"
            or len(expected) != 64
            or any(character not in "0123456789abcdef" for character in expected)
        ):
            raise EvidenceError("SHA256SUMS path malformed")
        path = PACKET_DIR / name
        if sha256_path(path) != expected:
            raise EvidenceError(f"checksum mismatch: {name}")
        observed_names.append(name)
    if (
        len(observed_names) != len(set(observed_names))
        or observed_names != sorted(observed_names, key=lambda item: item.encode())
        or frozenset(observed_names) != expected_names
    ):
        raise EvidenceError("SHA256SUMS names are duplicate, unsorted, or incomplete")
    return len(observed_names)


def _verify_bound_optional_file(
    provenance: Mapping[str, object],
    key: str,
    path: Path,
) -> None:
    expected = provenance.get(key)
    if expected == "NOT_CREATED":
        if path.exists() or path.is_symlink():
            raise EvidenceError(f"{key} says NOT_CREATED but file exists")
        return
    if not isinstance(expected, str) or sha256_path(path) != expected:
        raise EvidenceError(f"result provenance mismatch: {key}")


def _validate_lifecycle_presence(
    result: Mapping[str, object],
    provenance: Mapping[str, object],
) -> None:
    """Enforce the only legal terminal artifact-presence combinations."""

    preflight = provenance.get("preflightReceiptSha256") != "NOT_CREATED"
    development_marker = provenance.get("developmentRunMarkerSha256") != "NOT_CREATED"
    candidate = provenance.get("candidateSealSha256") != "NOT_CREATED"
    external_candidate = provenance.get("externalCandidateSealSha256") != "NOT_CREATED"
    holdout_marker = provenance.get("holdoutOpenMarkerSha256") != "NOT_CREATED"
    if not preflight or not development_marker:
        raise EvidenceError("terminal result lacks required preflight or development marker")
    if candidate != external_candidate:
        raise EvidenceError("candidate repository/external provenance is incomplete")
    development = _required_mapping(
        result.get("development"),
        field_name="result development",
    )
    holdout = _required_mapping(
        result.get("holdout"),
        field_name="result holdout",
    )
    verdict = result.get("measurementVerdict")
    holdout_state = holdout.get("state")
    if verdict == "UNMEASURED":
        if holdout_state == "OPEN_ATTEMPTED_INVALID":
            if not candidate or not holdout_marker:
                raise EvidenceError("open-attempted UNMEASURED lacks candidate or holdout marker")
        elif holdout_state == "UNOPENED_TERMINAL_UNMEASURED":
            if holdout_marker:
                raise EvidenceError("unopened UNMEASURED contradicts holdout marker presence")
        else:
            raise EvidenceError("UNMEASURED holdout state is outside lifecycle matrix")
        return
    development_passed = development.get("passed")
    if not isinstance(development_passed, bool):
        raise EvidenceError("measured development passed flag missing")
    if development_passed:
        if not candidate or not holdout_marker:
            raise EvidenceError("measured holdout lacks candidate or holdout marker")
    elif candidate or holdout_marker:
        raise EvidenceError("development-failure result contradicts candidate or holdout marker")


def report(state_root: Path, shared_root: Path) -> dict[str, object]:
    state_root, shared_root = validate_roots(state_root, shared_root)
    protocol, freeze_payload, _, _ = load_freeze(state_root, shared_root)
    result, result_raw = load_json(RESULT_PATH)
    validate_result_semantics(result)
    result_holdout = _required_mapping(
        result.get("holdout"),
        field_name="result holdout",
    )
    external, external_raw = load_json(state_root / "outcome-receipt.v1.json")
    if (
        external_raw != canonical_bytes(external)
        or external.get("schema") != "VG5OutcomeReceiptV1"
        or external.get("resultSha256") != sha256_bytes(result_raw)
        or external.get("measurementVerdict") != result.get("measurementVerdict")
        or external.get("holdoutState") != result_holdout.get("state")
        or external.get("capitalAuthority") != "NONE"
        or external.get("result") != result
    ):
        raise EvidenceError("external outcome receipt payload mismatch")
    provenance = result.get("provenance")
    if not isinstance(provenance, Mapping):
        raise EvidenceError("result provenance missing")
    protocol_payload, protocol_sha = load_protocol()
    bindings = _required_mapping(
        freeze_payload.get("bindings"),
        field_name="freeze bindings",
    )
    if (
        provenance.get("protocolSha256") != protocol_sha
        or provenance.get("evaluatorSha256") != script_sha()
        or provenance.get("freezeSha256") != sha256_path(FREEZE_PATH)
        or provenance.get("canonicalBaseCommit") != protocol_payload["canonicalBaseCommit"]
        or provenance.get("officialSourceResearchSha256") != sha256_path(SOURCE_RESEARCH_PATH)
        or provenance.get("sharedDiscoverySha256") != bindings.get("sharedDiscoverySha256")
        or provenance.get("sharedAcquisitionManifestSha256")
        != bindings.get("sharedAcquisitionManifestSha256")
        or provenance.get("sharedRoot") != str(shared_root)
        or provenance.get("sharedCorpusMutationAuthority") != "NONE"
    ):
        raise EvidenceError("result code/protocol/freeze provenance mismatch")
    _verify_bound_optional_file(
        provenance,
        "preflightReceiptSha256",
        state_root / PREFLIGHT_RECEIPT,
    )
    _verify_bound_optional_file(
        provenance,
        "developmentRunMarkerSha256",
        state_root / DEVELOPMENT_MARKER,
    )
    _verify_bound_optional_file(
        provenance,
        "candidateSealSha256",
        CANDIDATE_SEAL_PATH,
    )
    _verify_bound_optional_file(
        provenance,
        "externalCandidateSealSha256",
        state_root / "candidate-seal.v1.json",
    )
    _verify_bound_optional_file(
        provenance,
        "holdoutOpenMarkerSha256",
        state_root / HOLDOUT_MARKER,
    )
    _validate_lifecycle_presence(result, provenance)
    freeze_commit = require_text(
        provenance.get("freezeCommit"),
        field_name="result.provenance.freezeCommit",
    )
    base = require_text(
        protocol_payload.get("canonicalBaseCommit"),
        field_name="canonicalBaseCommit",
    )
    if (
        git_output("rev-parse", f"{freeze_commit}^") != base
        or git_output("merge-base", "--is-ancestor", freeze_commit, "HEAD") != ""
    ):
        raise EvidenceError("freeze commit lineage is not base to terminal HEAD")
    preflight_payload: Mapping[str, object] | None = None
    if provenance.get("preflightReceiptSha256") != "NOT_CREATED":
        preflight_payload, _ = load_json(state_root / PREFLIGHT_RECEIPT)
        if (
            preflight_payload.get("schema") != "VG5PreflightReceiptV1"
            or preflight_payload.get("state")
            != "COMPRESSED_BYTES_AND_SIDECARS_AUTHENTICATED_NO_ZIP_MEMBER_OPENED"
            or preflight_payload.get("freezeCommit") != freeze_commit
            or preflight_payload.get("freezeSha256") != sha256_path(FREEZE_PATH)
            or preflight_payload.get("archiveBodiesOpenedByVG5") is not False
            or preflight_payload.get("sharedCorpusMutationAuthority") != "NONE"
        ):
            raise EvidenceError("preflight receipt schema, state, or chain mismatch")
    if provenance.get("developmentRunMarkerSha256") != "NOT_CREATED":
        development_marker, _ = load_json(state_root / DEVELOPMENT_MARKER)
        if (
            development_marker.get("schema") != "VG5DevelopmentRunMarkerV1"
            or development_marker.get("state") != "CREATED_BEFORE_FIRST_VG5_ZIP_MEMBER_OPEN"
            or development_marker.get("freezeCommit") != freeze_commit
            or development_marker.get("freezeSha256") != sha256_path(FREEZE_PATH)
            or development_marker.get("preflightReceiptSha256")
            != provenance.get("preflightReceiptSha256")
            or development_marker.get("allowedRunCount") != 1
            or development_marker.get("archiveBodiesOpenedBeforeMarker") is not False
            or development_marker.get("rerunAllowed") is not False
            or preflight_payload is None
        ):
            raise EvidenceError("development marker schema, state, or chain mismatch")
    family = result.get("family")
    if not isinstance(family, Mapping):
        raise EvidenceError("result family packet missing")
    champion = require_text(
        family.get("championTrialId"),
        field_name="family.championTrialId",
    )
    if (
        family.get("attemptCount") != len(trial_specs(protocol_payload))
        or family.get("pboRole") != "DIAGNOSTIC_ONLY_NOT_RANK_GATE_OR_VERDICT_OVERRIDE"
    ):
        raise EvidenceError("result family packet contradicts frozen family")
    if result.get("measurementVerdict") != "UNMEASURED":
        development = _required_mapping(
            result.get("development"),
            field_name="result development",
        )
        development_pbo = _required_mapping(
            development.get("pbo"),
            field_name="result development pbo",
        )
        if development.get("championTrialId") != champion or family.get(
            "pbo"
        ) != development_pbo.get("pbo"):
            raise EvidenceError("result family differs from measured development")
    candidate_expected = provenance.get("candidateSealSha256") != "NOT_CREATED"
    external_candidate_expected = provenance.get("externalCandidateSealSha256") != "NOT_CREATED"
    if candidate_expected != external_candidate_expected:
        raise EvidenceError("candidate repository/external provenance is incomplete")
    if candidate_expected or external_candidate_expected:
        candidate: Mapping[str, object] | None = None
        candidate_raw: bytes | None = None
        if candidate_expected:
            candidate, candidate_raw = load_json(CANDIDATE_SEAL_PATH)
        if external_candidate_expected:
            external_candidate, external_candidate_raw = load_json(
                state_root / "candidate-seal.v1.json"
            )
            if candidate is None:
                candidate = external_candidate
                candidate_raw = external_candidate_raw
            elif candidate != external_candidate or candidate_raw != external_candidate_raw:
                raise EvidenceError("repository and external candidate seals differ")
        assert candidate is not None
        assert candidate_raw is not None
        gates, matrix, pbo = _candidate_development_evidence(candidate)
        matching_specs = [
            spec for spec in trial_specs(protocol_payload) if spec.trial_id == champion
        ]
        if len(matching_specs) != 1:
            raise EvidenceError("candidate champion is outside frozen trial family")
        spec = matching_specs[0]
        expected_parameters = {
            "breakoutLookbackDays": spec.breakout_days,
            "abnormalVolumeThreshold": decimal_text(spec.volume_threshold),
            "trendSmaDays": spec.trend_days,
            "volatilityRegime": spec.volatility_regime,
            "holdDaysAndSleeves": spec.hold_days,
        }
        if (
            candidate.get("freezeCommit") != freeze_commit
            or candidate.get("freezeSha256") != sha256_path(FREEZE_PATH)
            or candidate.get("championTrialId") != champion
            or candidate.get("championParameters") != expected_parameters
            or candidate.get("runnerUpOrSubgroupRescue") is not False
            or candidate.get("holdoutOutcomesObserved") is not False
        ):
            raise EvidenceError("candidate seal chain or evidence hashes mismatch")
        if result.get("measurementVerdict") == "UNMEASURED":
            if family.get("pbo") != pbo.get("pbo"):
                raise EvidenceError("terminal family PBO differs from candidate evidence")
        else:
            measured_development = _required_mapping(
                result.get("development"),
                field_name="result development",
            )
            if (
                measured_development.get("gates") != gates
                or measured_development.get("trialMatrix") != matrix
                or measured_development.get("pbo") != pbo
            ):
                raise EvidenceError("result differs from candidate-bound development evidence")
    if provenance.get("holdoutOpenMarkerSha256") != "NOT_CREATED":
        holdout_marker, _ = load_json(state_root / HOLDOUT_MARKER)
        if (
            holdout_marker.get("schema") != "VG5HoldoutOpenMarkerV1"
            or holdout_marker.get("state")
            != "CREATED_AFTER_ONE_CHAMPION_SEAL_BEFORE_FIRST_HOLDOUT_ZIP_MEMBER_OPEN"
            or holdout_marker.get("candidateSealSha256") != provenance.get("candidateSealSha256")
            or holdout_marker.get("championTrialId") != champion
            or holdout_marker.get("allowedOpenCount") != 1
            or holdout_marker.get("rerunAllowed") is not False
            or not candidate_expected
        ):
            raise EvidenceError("holdout marker chain mismatch")
    verified_files = _verify_checksums()
    if git_output("status", "--porcelain=v1"):
        raise EvidenceError("report requires a clean terminal commit")
    base = require_text(protocol.get("canonicalBaseCommit"), field_name="canonicalBaseCommit")
    if git_output("merge-base", "--is-ancestor", base, "HEAD") != "":
        raise EvidenceError("canonical base is not an ancestor")
    changed = git_changed_paths(base)
    if not changed or any(not path.startswith("quant/research/vg5/") for path in changed):
        raise EvidenceError("terminal commit violates exclusive V-G5 path scope")
    return {
        "schema": "VG5AuthenticatedReportV1",
        "measurementVerdict": result["measurementVerdict"],
        "terminalCommit": git_output("rev-parse", "HEAD"),
        "changedPathCount": len(changed),
        "verifiedPacketFiles": verified_files,
        "scoreboard": result.get("scoreboard"),
        "holdoutState": result["holdout"]["state"],
        "capitalAuthority": "NONE",
    }


def _command_summary(command: str, payload: Mapping[str, object]) -> dict[str, object]:
    if command == "freeze":
        inputs = payload.get("inputs")
        return {
            "command": command,
            "state": payload.get("state"),
            "requiredArtifactPairCount": (
                inputs.get("requiredArtifactPairCount") if isinstance(inputs, Mapping) else None
            ),
            "archiveBodiesOpenedByVG5": False,
        }
    if command == "preflight":
        return {
            "command": command,
            "state": payload.get("state"),
            "requiredArtifactPairCount": payload.get("requiredArtifactPairCount"),
            "archiveBodiesOpenedByVG5": False,
        }
    if command in {"run", "finalize"}:
        holdout = payload.get("holdout")
        return {
            "command": command,
            "measurementVerdict": payload.get("measurementVerdict"),
            "measurementState": payload.get("measurementState"),
            "holdoutState": (holdout.get("state") if isinstance(holdout, Mapping) else None),
            "capitalAuthority": "NONE",
        }
    return {"command": command, **payload}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--state-root",
        type=Path,
        default=DEFAULT_STATE_ROOT,
        help="V-G5 one-use external lifecycle root",
    )
    parser.add_argument(
        "--shared-root",
        type=Path,
        default=DEFAULT_SHARED_ROOT,
        help="read-only shared checksum corpus",
    )
    parser.add_argument(
        "command",
        choices=("freeze", "preflight", "run", "finalize", "seal", "report"),
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = build_parser().parse_args(argv)
    try:
        if arguments.command == "freeze":
            payload = freeze(arguments.state_root, arguments.shared_root)
        elif arguments.command == "preflight":
            payload = preflight(arguments.state_root, arguments.shared_root)
        elif arguments.command == "run":
            payload = run_experiment(arguments.state_root, arguments.shared_root)
        elif arguments.command == "finalize":
            payload = finalize_terminal(arguments.state_root, arguments.shared_root)
        elif arguments.command == "seal":
            payload = seal_checksums()
        else:
            payload = report(arguments.state_root, arguments.shared_root)
    except (EvidenceError, MeasurementError, OSError, subprocess.CalledProcessError) as exc:
        print(
            canonical_bytes(
                {
                    "command": arguments.command,
                    "error": type(exc).__name__,
                    "reason": str(exc),
                }
            ).decode(),
            end="",
            file=sys.stderr,
        )
        return 2
    print(canonical_bytes(_command_summary(arguments.command, payload)).decode(), end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
