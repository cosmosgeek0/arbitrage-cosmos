#!/usr/bin/env python3
"""Sealed V-G30 Binance-public quote-volume tail-concentration experiment."""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import math
import os
import random
import re
import stat
import subprocess
import sys
import zipfile
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from itertools import combinations
from pathlib import Path
from typing import Any, cast

D = Decimal
PACKET = Path(__file__).resolve().parent
QUANT_ROOT = PACKET.parents[1]
REPO_ROOT = PACKET.parents[2]
PROTOCOL_PATH = PACKET / "protocol.v1.json"
SOURCE_RESEARCH_PATH = PACKET / "OFFICIAL_SOURCE_RESEARCH.md"
README_PATH = PACKET / "README.md"
INIT_PATH = PACKET / "__init__.py"
TEST_PATH = PACKET / "test_experiment.py"
SOURCE_MANIFEST_PATH = PACKET / "source-manifest.v1.json"
FREEZE_PATH = PACKET / "freeze.v1.json"
RUN_MARKER_PATH = PACKET / "run-marker.v1.json"
BODY_CONSUMPTION_PATH = PACKET / "body-consumed.v1.json"
TRIAL_LEDGER_PATH = PACKET / "trial-ledger.v1.json"
DEVELOPMENT_RESULT_PATH = PACKET / "development-result.v1.json"
CANDIDATE_PATH = PACKET / "candidate.v1.json"
HOLDOUT_OPEN_PATH = PACKET / "holdout-open.v1.json"
HOLDOUT_RESULT_PATH = PACKET / "holdout-result.v1.json"
RESULT_PATH = PACKET / "result.v1.json"
SHA256SUMS_PATH = PACKET / "SHA256SUMS"

BASE_COMMIT = "a169b123fb186d1943a75ad648552c4d95be1be1"
SCOPE_PREFIX = "quant/research/vg30/"
SOURCE_ROOT = Path("/private/tmp/cosmos-s1f-weekly-momentum-cash-v1")
STATE_ROOT = Path("/private/tmp/cosmos-vg30-quote-volume-tail-concentration-1be1-e85b-state")
SOURCE_ACQUISITION = SOURCE_ROOT / "acquisition-manifest.v1.json"
SOURCE_DISCOVERY = SOURCE_ROOT / "discovery.v1.json"
SOURCE_ACQUISITION_SHA256 = "01f58272602e43bfb914b649adc00d8273b2d423492220a55f86443bb6441176"
SOURCE_DISCOVERY_SHA256 = "b4a8f7abd36df19eff0510dfcc3c61fd0df9fdcab5f4d248892ee10010fb21c3"

SOURCE_START = date(2024, 11, 1)
DEVELOPMENT_START = date(2025, 7, 1)
DEVELOPMENT_END_EXCLUSIVE = date(2026, 3, 1)
HOLDOUT_START = DEVELOPMENT_END_EXCLUSIVE
EVALUATION_END_EXCLUSIVE = date(2026, 7, 1)
SOURCE_MONTHS = tuple(
    f"{year:04d}-{month:02d}"
    for year, first, last in ((2024, 11, 12), (2025, 1, 12), (2026, 1, 6))
    for month in range(first, last + 1)
)
DEVELOPMENT_SOURCE_MONTHS = frozenset(month for month in SOURCE_MONTHS if month <= "2026-02")
HOLDOUT_SOURCE_MONTHS = frozenset(month for month in SOURCE_MONTHS if month >= "2026-03")

DAY_US = 86_400_000_000
INITIAL_USDT = D("1000")
MIN_PRIOR_30D_MEDIAN_QUOTE_VOLUME = D("5000000")
MIN_RISK_SET = 30
ANOMALY_LOOKBACK_DAYS = 60
LIQUIDITY_LOOKBACK_DAYS = 30
PRIOR_SUNDAYS = 26
BOOTSTRAP_REPLICATES = 4096
BOOTSTRAP_BLOCK_WEEKS = 4
BOOTSTRAP_SEED = 2_026_072_930
ALPHA = D("0.05")
BASE_CAPACITY_PARTICIPATION = D("0.0001")
STRESS_CAPACITY_PARTICIPATION = D("0.00005")
CAPACITY_GATE_USDT = D("1000")
MAX_DRAWDOWN = D("0.20")

STATIC_FILES = (
    "OFFICIAL_SOURCE_RESEARCH.md",
    "README.md",
    "__init__.py",
    "experiment.py",
    "protocol.v1.json",
    "test_experiment.py",
)
FREEZE_FILES = ("source-manifest.v1.json", "freeze.v1.json")
MARKER_FILES = ("run-marker.v1.json",)
CONSUMPTION_FILES = ("body-consumed.v1.json",)
DEVELOPMENT_FILES = ("trial-ledger.v1.json", "development-result.v1.json")
HOLDOUT_FILES = ("candidate.v1.json", "holdout-open.v1.json", "holdout-result.v1.json")
TERMINAL_FILES = ("result.v1.json",)
GENERATED_FILES = (
    *FREEZE_FILES,
    *MARKER_FILES,
    *CONSUMPTION_FILES,
    *DEVELOPMENT_FILES,
    *HOLDOUT_FILES,
    *TERMINAL_FILES,
    "SHA256SUMS",
)

CHECKSUM_RE = re.compile(r"^([0-9a-f]{64})[ \t]+\*?([^\r\n]+)[\r\n]*$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
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
PAIR_FIELDS = (
    "checksumFrozenEtag",
    "checksumFrozenLastModified",
    "checksumKey",
    "checksumListedBytes",
    "checksumSha256",
    "month",
    "symbol",
    "zipFrozenEtag",
    "zipFrozenLastModified",
    "zipKey",
    "zipListedBytes",
    "zipSha256",
)

SCENARIOS: dict[str, tuple[Decimal, Decimal]] = {
    "feeOnly": (D("0.0010"), D("0")),
    "base": (D("0.0010"), D("0.0010")),
    "stress": (D("0.0010"), D("0.0025")),
    "severe": (D("0.0010"), D("0.0050")),
}

AUTHORITY_CONTRACT = {
    "accountData": "FORBIDDEN",
    "capitalAuthority": "NONE",
    "canonicalMutation": "FORBIDDEN",
    "consumer": "N3 successor/final convergence",
    "executionAuthority": "NONE",
    "globalPositiveEdgeAuthority": "NONE",
    "hostMutation": "FORBIDDEN",
    "moneyEffectUsdt": "0",
    "orders": "FORBIDDEN",
    "privateApi": "FORBIDDEN",
    "providerMutation": "FORBIDDEN",
    "scope": "PUBLIC_RESEARCH_ONLY",
    "transfer": "FORBIDDEN",
    "ui": "FORBIDDEN",
    "withdrawal": "FORBIDDEN",
}


class VG30Error(RuntimeError):
    """Base V-G30 refusal."""


class CustodyError(VG30Error):
    """Frozen byte or lifecycle failure."""


class MeasurementError(VG30Error):
    """Required preregistered measurement is unavailable."""


@dataclass(frozen=True, slots=True)
class Trial:
    trial_id: str
    tail_fraction: Decimal
    threshold_quantile: Decimal


@dataclass(frozen=True, slots=True)
class Bar:
    symbol: str
    day: date
    open: Decimal
    quote_volume: Decimal
    open_time_us: int
    close_time_us: int
    raw_fields: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class TailFeature:
    sunday: date
    tail_fraction: Decimal
    k: int
    concentration: Decimal
    ranked_anomalies: tuple[tuple[str, Decimal], ...]
    prior_30d_medians: tuple[tuple[str, Decimal], ...]
    risk_set_size: int
    risk_set_sha256: str


@dataclass(frozen=True, slots=True)
class WeeklyObservation:
    sunday: date
    entry_day: date
    exit_day: date
    active: bool
    reason: str
    symbols: tuple[str, ...]
    k: int
    risk_set_size: int | None
    concentration: Decimal | None
    threshold: Decimal | None
    gross_factors: tuple[Decimal, ...]
    prior_30d_medians: tuple[Decimal, ...]


def canonical_bytes(value: object) -> bytes:
    return (
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n"
    ).encode("utf-8")


def sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_sha(value: object) -> str:
    return sha256_bytes(canonical_bytes(value))


def utc_now() -> str:
    return datetime.now(tz=UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def decimal_text(value: Decimal, places: int | None = None) -> str:
    if not value.is_finite():
        raise MeasurementError("non-finite decimal cannot be serialized")
    if places is None:
        return format(value, "f")
    quantum = D(1).scaleb(-places)
    return format(value.quantize(quantum), "f")


def decimal_value(
    value: object,
    field: str,
    *,
    nonnegative: bool = False,
    positive: bool = False,
) -> Decimal:
    if not isinstance(value, (str, int)):
        raise VG30Error(f"{field} must be a decimal string or integer")
    try:
        parsed = D(value)
    except InvalidOperation as error:
        raise VG30Error(f"{field} is not decimal") from error
    if not parsed.is_finite():
        raise VG30Error(f"{field} is non-finite")
    if nonnegative and parsed < 0:
        raise VG30Error(f"{field} must be nonnegative")
    if positive and parsed <= 0:
        raise VG30Error(f"{field} must be positive")
    return parsed


def require_text(value: object, field: str) -> str:
    if not isinstance(value, str) or not value:
        raise VG30Error(f"{field} must be nonempty text")
    return value


def require_int(value: object, field: str, *, minimum: int | None = None) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise VG30Error(f"{field} must be an integer")
    if minimum is not None and value < minimum:
        raise VG30Error(f"{field} must be at least {minimum}")
    return value


def load_json(path: Path, *, canonical: bool = False) -> tuple[dict[str, Any], bytes]:
    raw = safe_regular(path).read_bytes()
    try:
        value = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise CustodyError(f"{path.name} is not valid JSON") from error
    if not isinstance(value, dict):
        raise CustodyError(f"{path.name} must contain a JSON object")
    if canonical and raw != canonical_bytes(value):
        raise CustodyError(f"{path.name} is not canonical JSON")
    return cast(dict[str, Any], value), raw


def lexists(path: Path) -> bool:
    return os.path.lexists(path)


def safe_regular(path: Path) -> Path:
    try:
        details = path.lstat()
    except FileNotFoundError as error:
        raise CustodyError(f"required file is absent: {path}") from error
    if stat.S_ISLNK(details.st_mode) or not stat.S_ISREG(details.st_mode):
        raise CustodyError(f"required path is not a regular file: {path}")
    return path


def fsync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def ensure_directory(path: Path, *, mode: int = 0o700) -> None:
    if lexists(path):
        details = path.lstat()
        if stat.S_ISLNK(details.st_mode) or not stat.S_ISDIR(details.st_mode):
            raise CustodyError(f"state root has invalid shape: {path}")
        if stat.S_IMODE(details.st_mode) & 0o077:
            raise CustodyError(f"state root permissions are too broad: {path}")
        return
    path.mkdir(mode=mode, parents=False)
    fsync_directory(path.parent)


def write_exclusive(path: Path, raw: bytes, *, mode: int = 0o644) -> None:
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        descriptor = os.open(path, flags, mode)
    except FileExistsError as error:
        raise CustodyError(f"exclusive file already exists: {path.name}") from error
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        if stat.S_IMODE(path.stat().st_mode) != mode:
            raise CustodyError(f"exclusive file mode drifted: {path.name}")
        fsync_directory(path.parent)
    except BaseException:
        # A lifecycle marker is deliberately not unlinked after creation.
        raise


def write_json_exclusive(path: Path, value: object, *, mode: int = 0o644) -> str:
    raw = canonical_bytes(value)
    write_exclusive(path, raw, mode=mode)
    return sha256_bytes(raw)


def median_decimal(values: Sequence[Decimal]) -> Decimal:
    if not values:
        raise MeasurementError("median requires at least one value")
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) / D(2)


def mean_decimal(values: Sequence[Decimal]) -> Decimal | None:
    if not values:
        return None
    return sum(values, D(0)) / D(len(values))


def nearest_rank(values: Sequence[Decimal], quantile: Decimal) -> Decimal:
    if not values:
        raise MeasurementError("nearest-rank quantile requires values")
    if quantile <= 0 or quantile > 1:
        raise VG30Error("nearest-rank quantile must lie in (0,1]")
    index = int((quantile * D(len(values))).to_integral_value(rounding="ROUND_CEILING"))
    return sorted(values)[index - 1]


def symbol_sort_key(symbol: str) -> bytes:
    return symbol.encode("utf-8")


def month_range(first: str, last: str) -> tuple[str, ...]:
    current = date.fromisoformat(f"{first}-01")
    end = date.fromisoformat(f"{last}-01")
    output: list[str] = []
    while current <= end:
        output.append(current.strftime("%Y-%m"))
        current = (
            date(current.year + 1, 1, 1)
            if current.month == 12
            else date(current.year, current.month + 1, 1)
        )
    return tuple(output)


def day_range(first: date, last_inclusive: date) -> tuple[date, ...]:
    if last_inclusive < first:
        return ()
    return tuple(
        first + timedelta(days=offset) for offset in range((last_inclusive - first).days + 1)
    )


def contained_sundays(start: date, end_exclusive: date) -> tuple[date, ...]:
    """Sundays whose D+2 entry and D+9 exit are fully inside the partition."""
    first = start
    while first.weekday() != 6:
        first += timedelta(days=1)
    output: list[date] = []
    current = first
    while current + timedelta(days=9) < end_exclusive:
        output.append(current)
        current += timedelta(days=7)
    return tuple(output)


def trial_grid() -> tuple[Trial, ...]:
    trials = [
        Trial(
            trial_id=f"VG30-P{int(p * 100):02d}-Q{int(q * 100):02d}",
            tail_fraction=p,
            threshold_quantile=q,
        )
        for p in (D("0.10"), D("0.20"))
        for q in (D("0.75"), D("0.90"), D("0.95"))
    ]
    return tuple(sorted(trials, key=lambda item: item.trial_id))


def trial_mapping(trial: Trial) -> dict[str, str]:
    return {
        "tailFraction": format(trial.tail_fraction, "f"),
        "thresholdQuantile": format(trial.threshold_quantile, "f"),
        "trialId": trial.trial_id,
    }


def load_protocol() -> dict[str, Any]:
    protocol, _ = load_json(PROTOCOL_PATH, canonical=False)
    if protocol.get("schema") != "VG30QuoteVolumeTailConcentrationProtocolV1":
        raise CustodyError("protocol schema drifted")
    if protocol.get("baseCommit") != BASE_COMMIT:
        raise CustodyError("protocol base commit drifted")
    signal = protocol.get("signal")
    if not isinstance(signal, dict) or signal.get("trialCount") != 6:
        raise CustodyError("protocol trial family drifted")
    if signal.get("tailFractions") != ["0.10", "0.20"]:
        raise CustodyError("protocol tail fractions drifted")
    if signal.get("thresholdQuantiles") != ["0.75", "0.90", "0.95"]:
        raise CustodyError("protocol threshold quantiles drifted")
    distinctness = protocol.get("distinctness")
    if not isinstance(distinctness, dict):
        raise CustodyError("protocol distinctness boundary is absent")
    forbidden = distinctness.get("forbiddenSignalInputs")
    required_forbidden = {
        "PRICE",
        "PRICE_RANGE",
        "HHI",
        "ENTROPY",
        "DISPERSION",
        "BREADTH",
        "RAW_CROSS_SECTIONAL_QUOTE_VOLUME_SHARE",
        "QUOTE_VOLUME_SHARE_ACCELERATION",
        "REGIME_GAP",
        "TAKER_FIELDS",
        "TRADE_COUNT",
        "FUNDING",
        "OPEN_INTEREST",
    }
    if not isinstance(forbidden, list) or set(forbidden) != required_forbidden:
        raise CustodyError("protocol forbidden-input boundary drifted")
    inference = protocol.get("inference")
    if not isinstance(inference, dict):
        raise CustodyError("protocol inference boundary is absent")
    bootstrap = inference.get("bootstrap")
    if (
        not isinstance(bootstrap, dict)
        or bootstrap.get("replicates") != BOOTSTRAP_REPLICATES
        or bootstrap.get("blockLengthWeeks") != BOOTSTRAP_BLOCK_WEEKS
    ):
        raise CustodyError("protocol bootstrap law drifted")
    authority = protocol.get("authority")
    if authority != AUTHORITY_CONTRACT:
        raise CustodyError("protocol authority widened")
    if len(trial_grid()) != 6:
        raise AssertionError("internal trial grid is not six")
    return protocol


def excluded_symbols(protocol: Mapping[str, Any]) -> tuple[frozenset[str], frozenset[str]]:
    universe = protocol.get("universe")
    if not isinstance(universe, dict):
        raise CustodyError("protocol universe is absent")
    stable = universe.get("excludedStableOrFiatSymbols")
    leveraged = universe.get("excludedPairedLeveragedSymbols")
    if not isinstance(stable, list) or not all(isinstance(item, str) for item in stable):
        raise CustodyError("stable/fiat exclusion list drifted")
    if not isinstance(leveraged, list) or not all(isinstance(item, str) for item in leveraged):
        raise CustodyError("leveraged exclusion list drifted")
    stable_set = frozenset(cast(list[str], stable))
    leveraged_set = frozenset(cast(list[str], leveraged))
    if len(stable_set) != len(stable) or len(leveraged_set) != len(leveraged):
        raise CustodyError("exclusion lists contain duplicates")
    return stable_set, leveraged_set


def eligible_symbol(symbol: str, protocol: Mapping[str, Any]) -> bool:
    stable, leveraged = excluded_symbols(protocol)
    return (
        symbol.endswith("USDT")
        and len(symbol) > 4
        and symbol not in stable
        and symbol not in leveraged
    )


def git_output(*args: str) -> str:
    completed = subprocess.run(
        ("git", *args),
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return completed.stdout.strip()


def git_head() -> str:
    head = git_output("rev-parse", "HEAD")
    if COMMIT_RE.fullmatch(head) is None:
        raise CustodyError("Git HEAD is not a full commit")
    return head


def require_clean_pushed_head() -> str:
    if git_output("status", "--porcelain", "--untracked-files=all"):
        raise CustodyError("worktree must be clean before lifecycle mutation")
    head = git_head()
    try:
        upstream = git_output("rev-parse", "@{upstream}")
        upstream_name = git_output(
            "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"
        )
    except subprocess.CalledProcessError as error:
        raise CustodyError("branch upstream is not configured") from error
    if not upstream_name.startswith("origin/") or upstream != head:
        raise CustodyError("HEAD must be upstream-equal on origin")
    return head


def changed_paths(base: str, head: str) -> tuple[str, ...]:
    output = git_output(
        "diff",
        "--name-only",
        "--diff-filter=ACMRTUXBD",
        f"{base}..{head}",
    )
    return tuple(line for line in output.splitlines() if line)


def ensure_scoped_linear_history() -> None:
    if git_output("merge-base", BASE_COMMIT, "HEAD") != BASE_COMMIT:
        raise CustodyError("candidate does not descend from exact canonical base")
    history = git_output("rev-list", "--reverse", "--parents", f"{BASE_COMMIT}..HEAD")
    if not history:
        raise CustodyError("candidate history is empty")
    for row in history.splitlines():
        fields = row.split()
        if len(fields) != 2:
            raise CustodyError("candidate history must be linear and merge-free")
        commit = fields[0]
        paths = git_output("diff-tree", "--no-commit-id", "--name-only", "-r", commit).splitlines()
        if not paths or any(not path.startswith(SCOPE_PREFIX) for path in paths):
            raise CustodyError(f"candidate commit escaped exclusive scope: {commit}")


def require_exact_repo_files(names: Sequence[str]) -> None:
    head = git_head()
    expected = tuple(sorted(f"{SCOPE_PREFIX}{name}" for name in names))
    found = tuple(sorted(changed_paths(BASE_COMMIT, head)))
    if found != expected:
        raise CustodyError("candidate delta does not match exact lifecycle file set")


def latest_path_commit(path: Path) -> str:
    relative = path.relative_to(REPO_ROOT).as_posix()
    commit = git_output("rev-list", "-n", "1", "HEAD", "--", relative)
    if COMMIT_RE.fullmatch(commit) is None:
        raise CustodyError(f"{path.name} has no committed identity")
    return commit


def expected_archive_paths(source_root: Path, symbol: str, month: str) -> tuple[Path, Path, Path]:
    directory = source_root / "archives" / symbol / month
    zip_path = directory / f"{symbol}-1d-{month}.zip"
    checksum_path = directory / f"{zip_path.name}.CHECKSUM"
    pair_path = directory / "pair.v1.json"
    return zip_path, checksum_path, pair_path


def verify_checksum_text(checksum_bytes: bytes, zip_name: str, zip_sha: str) -> None:
    try:
        text = checksum_bytes.decode("ascii")
    except UnicodeDecodeError as error:
        raise CustodyError(f"{zip_name} checksum sidecar is not ASCII") from error
    match = CHECKSUM_RE.fullmatch(text)
    if match is None:
        raise CustodyError(f"{zip_name} checksum grammar is invalid")
    published_sha, published_name = match.groups()
    if published_sha != zip_sha or published_name.strip() != zip_name:
        raise CustodyError(f"{zip_name} checksum sidecar identity differs")


def normalized_lines(values: Iterable[str]) -> bytes:
    return ("".join(f"{value}\n" for value in values)).encode("utf-8")


def _source_inventory(
    *,
    source_root: Path,
    enforce_shared_pins: bool,
) -> dict[str, object]:
    protocol = load_protocol()
    acquisition_path = source_root / "acquisition-manifest.v1.json"
    discovery_path = source_root / "discovery.v1.json"
    acquisition, acquisition_raw = load_json(acquisition_path, canonical=True)
    discovery, discovery_raw = load_json(discovery_path, canonical=True)
    if enforce_shared_pins:
        if sha256_bytes(acquisition_raw) != SOURCE_ACQUISITION_SHA256:
            raise CustodyError("shared acquisition manifest digest drifted")
        if sha256_bytes(discovery_raw) != SOURCE_DISCOVERY_SHA256:
            raise CustodyError("shared discovery manifest digest drifted")
    if acquisition.get("schema") != "S1FAcquisitionManifestV1":
        raise CustodyError("shared acquisition schema drifted")
    if acquisition.get("state") != "CHECKSUM_VERIFIED_ARCHIVES_NOT_DECOMPRESSED":
        raise CustodyError("shared acquisition state is inadmissible")
    if acquisition.get("archiveBodiesDecompressed") is not False:
        raise CustodyError("shared acquisition reports opened archive bodies")
    if discovery.get("schema") != "S1FArchiveDiscoveryV1":
        raise CustodyError("shared discovery schema drifted")
    if discovery.get("state") != "METADATA_ONLY_NO_ARCHIVE_BODY_OPENED":
        raise CustodyError("shared discovery state is inadmissible")
    if acquisition.get("discoverySha256") != sha256_bytes(discovery_raw):
        raise CustodyError("acquisition does not bind exact discovery bytes")

    exclusions = discovery.get("exclusions")
    universe_contract = protocol.get("universe")
    if not isinstance(exclusions, dict) or not isinstance(universe_contract, dict):
        raise CustodyError("source or protocol exclusions are absent")
    if (
        exclusions.get("stableOrFiatSymbols")
        != universe_contract.get("excludedStableOrFiatSymbols")
        or exclusions.get("pairedLeveragedSymbols")
        != universe_contract.get("excludedPairedLeveragedSymbols")
        or exclusions.get("stableOrFiatSha256")
        != universe_contract.get("excludedStableOrFiatSha256")
        or exclusions.get("pairedLeveragedSha256")
        != universe_contract.get("excludedPairedLeveragedSha256")
    ):
        raise CustodyError("source semantic exclusions differ from protocol")

    raw_pairs = acquisition.get("artifactPairs")
    raw_absent = acquisition.get("absentSymbolMonths")
    if not isinstance(raw_pairs, list) or not all(isinstance(item, dict) for item in raw_pairs):
        raise CustodyError("acquisition artifact pairs are invalid")
    if not isinstance(raw_absent, list) or not all(isinstance(item, str) for item in raw_absent):
        raise CustodyError("acquisition absence list is invalid")
    pairs = cast(list[dict[str, Any]], raw_pairs)
    absences = cast(list[str], raw_absent)
    if acquisition.get("artifactPairCount") != len(pairs):
        raise CustodyError("acquisition artifact-pair count drifted")
    if acquisition.get("absentSymbolMonthCount") != len(absences):
        raise CustodyError("acquisition absence count drifted")
    row_digests = [canonical_sha(row) for row in pairs]
    if acquisition.get("artifactRowsSha256") != sha256_bytes(normalized_lines(row_digests)):
        raise CustodyError("acquisition artifact-row digest drifted")
    if acquisition.get("absentSha256") != sha256_bytes(normalized_lines(absences)):
        raise CustodyError("acquisition absence digest drifted")
    if absences != sorted(set(absences)):
        raise CustodyError("acquisition absence list is not sorted unique")

    pair_lookup: dict[tuple[str, str], dict[str, Any]] = {}
    for pair in pairs:
        symbol = require_text(pair.get("symbol"), "pair.symbol")
        month = require_text(pair.get("month"), "pair.month")
        identity = (symbol, month)
        if identity in pair_lookup:
            raise CustodyError(f"duplicate acquisition identity: {symbol}|{month}")
        pair_lookup[identity] = pair
    absent_set = set(absences)

    raw_universe = discovery.get("universe")
    raw_inventories = discovery.get("symbolInventories")
    if not isinstance(raw_universe, dict) or not isinstance(raw_inventories, list):
        raise CustodyError("discovery universe is invalid")
    symbols_value = raw_universe.get("symbols")
    if not isinstance(symbols_value, list) or not all(
        isinstance(item, str) for item in symbols_value
    ):
        raise CustodyError("discovery symbols are invalid")
    symbols = cast(list[str], symbols_value)
    if symbols != sorted(set(symbols), key=symbol_sort_key):
        raise CustodyError("discovery symbols are not UTF-8 sorted unique")
    if raw_universe.get("count") != len(symbols):
        raise CustodyError("discovery symbol count drifted")
    if raw_universe.get("sha256") != sha256_bytes(normalized_lines(symbols)):
        raise CustodyError("discovery symbol-set digest drifted")
    inventory_lookup: dict[str, dict[str, Any]] = {}
    for raw_inventory in raw_inventories:
        if not isinstance(raw_inventory, dict):
            raise CustodyError("discovery symbol inventory row is invalid")
        symbol = require_text(raw_inventory.get("symbol"), "inventory.symbol")
        if symbol in inventory_lookup:
            raise CustodyError(f"duplicate discovery symbol inventory: {symbol}")
        inventory_lookup[symbol] = cast(dict[str, Any], raw_inventory)
    if set(inventory_lookup) != set(symbols):
        raise CustodyError("discovery symbol inventory is not exact")

    eligible = tuple(symbol for symbol in symbols if eligible_symbol(symbol, protocol))
    rows: list[dict[str, object]] = []
    seen_present: set[tuple[str, str]] = set()
    seen_absent: set[str] = set()
    for symbol in eligible:
        raw_months = inventory_lookup[symbol].get("months")
        if not isinstance(raw_months, dict):
            raise CustodyError(f"discovery months are invalid: {symbol}")
        for month in SOURCE_MONTHS:
            identity = (symbol, month)
            absence_id = f"{symbol}|{month}"
            acquisition_pair = pair_lookup.get(identity)
            discovery_month = raw_months.get(month)
            if acquisition_pair is None:
                if absence_id not in absent_set:
                    raise CustodyError(f"inventory is neither present nor absent: {absence_id}")
                if discovery_month is not None:
                    raise CustodyError(f"absent identity appears in discovery: {absence_id}")
                zip_path, checksum_path, pair_path = expected_archive_paths(
                    source_root, symbol, month
                )
                if any(lexists(path) for path in (zip_path, checksum_path, pair_path)):
                    raise CustodyError(f"absent identity has local bytes: {absence_id}")
                seen_absent.add(absence_id)
                rows.append({"month": month, "state": "ABSENT", "symbol": symbol})
                continue
            if absence_id in absent_set:
                raise CustodyError(f"identity is both present and absent: {absence_id}")
            if not isinstance(discovery_month, dict):
                raise CustodyError(f"present identity absent from discovery: {absence_id}")
            zip_meta = discovery_month.get("zip")
            checksum_meta = discovery_month.get("checksum")
            if not isinstance(zip_meta, dict) or not isinstance(checksum_meta, dict):
                raise CustodyError(f"discovery pair is incomplete: {absence_id}")
            expected_zip_key = f"data/spot/monthly/klines/{symbol}/1d/{symbol}-1d-{month}.zip"
            expected_checksum_key = f"{expected_zip_key}.CHECKSUM"
            if (
                acquisition_pair.get("zipKey") != expected_zip_key
                or acquisition_pair.get("checksumKey") != expected_checksum_key
                or zip_meta
                != {
                    "etag": acquisition_pair.get("zipFrozenEtag"),
                    "key": acquisition_pair.get("zipKey"),
                    "lastModified": acquisition_pair.get("zipFrozenLastModified"),
                    "size": acquisition_pair.get("zipListedBytes"),
                }
                or checksum_meta
                != {
                    "etag": acquisition_pair.get("checksumFrozenEtag"),
                    "key": acquisition_pair.get("checksumKey"),
                    "lastModified": acquisition_pair.get("checksumFrozenLastModified"),
                    "size": acquisition_pair.get("checksumListedBytes"),
                }
            ):
                raise CustodyError(f"discovery/acquisition metadata differs: {absence_id}")
            zip_path, checksum_path, pair_path = expected_archive_paths(source_root, symbol, month)
            pair_receipt, pair_raw = load_json(pair_path, canonical=True)
            if pair_receipt.get("schema") != "S1FLocalArchivePairV1":
                raise CustodyError(f"pair receipt schema drifted: {absence_id}")
            if any(pair_receipt.get(field) != acquisition_pair.get(field) for field in PAIR_FIELDS):
                raise CustodyError(f"pair receipt differs from acquisition: {absence_id}")
            zip_bytes = safe_regular(zip_path).stat().st_size
            checksum_bytes = safe_regular(checksum_path).stat().st_size
            zip_sha = sha256_path(zip_path)
            checksum_sha = sha256_path(checksum_path)
            if (
                zip_bytes
                != require_int(
                    acquisition_pair.get("zipBytes"),
                    "pair.zipBytes",
                    minimum=1,
                )
                or checksum_bytes
                != require_int(
                    acquisition_pair.get("checksumBytes"),
                    "pair.checksumBytes",
                    minimum=1,
                )
                or zip_sha != require_text(acquisition_pair.get("zipSha256"), "pair.zipSha256")
                or checksum_sha
                != require_text(
                    acquisition_pair.get("checksumSha256"),
                    "pair.checksumSha256",
                )
            ):
                raise CustodyError(f"local compressed bytes differ: {absence_id}")
            checksum_raw = checksum_path.read_bytes()
            verify_checksum_text(checksum_raw, zip_path.name, zip_sha)
            seen_present.add(identity)
            rows.append(
                {
                    "acquisitionRowSha256": canonical_sha(acquisition_pair),
                    "checksumBytes": checksum_bytes,
                    "checksumEtag": acquisition_pair["checksumFrozenEtag"],
                    "checksumLastModified": acquisition_pair["checksumFrozenLastModified"],
                    "checksumPath": checksum_path.relative_to(source_root).as_posix(),
                    "checksumSha256": checksum_sha,
                    "month": month,
                    "pairBytes": len(pair_raw),
                    "pairPath": pair_path.relative_to(source_root).as_posix(),
                    "pairSha256": sha256_bytes(pair_raw),
                    "state": "PRESENT",
                    "symbol": symbol,
                    "zipBytes": zip_bytes,
                    "zipEtag": acquisition_pair["zipFrozenEtag"],
                    "zipLastModified": acquisition_pair["zipFrozenLastModified"],
                    "zipPath": zip_path.relative_to(source_root).as_posix(),
                    "zipSha256": zip_sha,
                }
            )

    eligible_set = set(eligible)
    unexpected_present = {
        identity
        for identity in pair_lookup
        if identity[0] in eligible_set and identity[1] in SOURCE_MONTHS
    } - seen_present
    unexpected_absent = {
        identity
        for identity in absent_set
        if "|" in identity
        and identity.split("|", 1)[0] in eligible_set
        and identity.split("|", 1)[1] in SOURCE_MONTHS
    } - seen_absent
    if unexpected_present or unexpected_absent:
        raise CustodyError("target source inventory contains unaccounted identities")
    rows.sort(key=lambda row: (symbol_sort_key(str(row["symbol"])), str(row["month"])))
    present_count = sum(row["state"] == "PRESENT" for row in rows)
    absent_count = len(rows) - present_count
    return {
        "acquisitionManifestBytes": len(acquisition_raw),
        "acquisitionManifestSha256": sha256_bytes(acquisition_raw),
        "archiveBodiesOpenedDuringFreeze": False,
        "discoveryManifestBytes": len(discovery_raw),
        "discoveryManifestSha256": sha256_bytes(discovery_raw),
        "eligibleSymbolCount": len(eligible),
        "eligibleSymbolSetSha256": sha256_bytes(normalized_lines(eligible)),
        "excludedPairedLeveragedSha256": exclusions["pairedLeveragedSha256"],
        "excludedStableOrFiatSha256": exclusions["stableOrFiatSha256"],
        "inventory": rows,
        "inventoryAbsentCount": absent_count,
        "inventoryDigest": canonical_sha(rows),
        "inventoryPresentCount": present_count,
        "inventoryRowCount": len(rows),
        "months": list(SOURCE_MONTHS),
        "protocolSha256": sha256_path(PROTOCOL_PATH),
        "schema": "VG30FrozenPublicSourceManifestV1",
        "sourceRoot": str(source_root),
        "state": "EXACT_PRESENT_ABSENT_COMPRESSED_CUSTODY_NO_ARCHIVE_BODY_OPEN",
    }


def validate_source_manifest(
    *,
    authenticate_files: bool,
    source_root: Path = SOURCE_ROOT,
) -> dict[str, Any]:
    manifest, _ = load_json(SOURCE_MANIFEST_PATH, canonical=True)
    if manifest.get("schema") != "VG30FrozenPublicSourceManifestV1":
        raise CustodyError("source manifest schema drifted")
    if manifest.get("archiveBodiesOpenedDuringFreeze") is not False:
        raise CustodyError("source manifest does not preserve unopened bodies")
    if manifest.get("sourceRoot") != str(source_root):
        raise CustodyError("source manifest root drifted")
    if manifest.get("protocolSha256") != sha256_path(PROTOCOL_PATH):
        raise CustodyError("source manifest protocol binding drifted")
    raw_inventory = manifest.get("inventory")
    if not isinstance(raw_inventory, list) or not all(
        isinstance(item, dict) for item in raw_inventory
    ):
        raise CustodyError("source manifest inventory is invalid")
    inventory = cast(list[dict[str, Any]], raw_inventory)
    if manifest.get("inventoryRowCount") != len(inventory) or manifest.get(
        "inventoryDigest"
    ) != canonical_sha(inventory):
        raise CustodyError("source manifest inventory count or digest drifted")
    identities: set[tuple[str, str]] = set()
    present = 0
    absent = 0
    for row in inventory:
        symbol = require_text(row.get("symbol"), "inventory.symbol")
        month = require_text(row.get("month"), "inventory.month")
        identity = (symbol, month)
        if identity in identities or month not in SOURCE_MONTHS:
            raise CustodyError("source manifest identity is duplicate or out of range")
        identities.add(identity)
        state_value = row.get("state")
        if state_value == "ABSENT":
            absent += 1
            if set(row) != {"month", "state", "symbol"}:
                raise CustodyError("absent inventory row contains invented evidence")
            continue
        if state_value != "PRESENT":
            raise CustodyError("source manifest state is invalid")
        present += 1
        for digest_field in (
            "acquisitionRowSha256",
            "checksumSha256",
            "pairSha256",
            "zipSha256",
        ):
            if SHA256_RE.fullmatch(require_text(row.get(digest_field), digest_field)) is None:
                raise CustodyError("source manifest digest is malformed")
        if authenticate_files:
            for path_field, bytes_field, sha_field in (
                ("zipPath", "zipBytes", "zipSha256"),
                ("checksumPath", "checksumBytes", "checksumSha256"),
                ("pairPath", "pairBytes", "pairSha256"),
            ):
                relative = require_text(row.get(path_field), path_field)
                path = source_root / relative
                if safe_regular(path).stat().st_size != require_int(
                    row.get(bytes_field), bytes_field, minimum=1
                ):
                    raise CustodyError(f"source byte length drifted: {relative}")
                if sha256_path(path) != require_text(row.get(sha_field), sha_field):
                    raise CustodyError(f"source digest drifted: {relative}")
            zip_path = source_root / require_text(row.get("zipPath"), "zipPath")
            checksum_path = source_root / require_text(row.get("checksumPath"), "checksumPath")
            verify_checksum_text(
                checksum_path.read_bytes(),
                zip_path.name,
                require_text(row.get("zipSha256"), "zipSha256"),
            )
    if (
        manifest.get("inventoryPresentCount") != present
        or manifest.get("inventoryAbsentCount") != absent
    ):
        raise CustodyError("source manifest present/absent counts drifted")
    return manifest


def static_sha256_mapping() -> dict[str, str]:
    mapping: dict[str, str] = {}
    for name in STATIC_FILES:
        path = safe_regular(PACKET / name)
        mapping[name] = sha256_path(path)
    return mapping


def command_freeze(_args: argparse.Namespace) -> dict[str, object]:
    if any(lexists(PACKET / name) for name in GENERATED_FILES):
        raise CustodyError("generated lifecycle files already exist")
    require_clean_pushed_head()
    ensure_scoped_linear_history()
    require_exact_repo_files(STATIC_FILES)
    load_protocol()
    source_manifest = _source_inventory(
        source_root=SOURCE_ROOT,
        enforce_shared_pins=True,
    )
    source_manifest_sha = write_json_exclusive(SOURCE_MANIFEST_PATH, source_manifest)
    head = git_head()
    dependency_binding = {
        "implementation": sys.implementation.name,
        "pythonVersion": ".".join(str(item) for item in sys.version_info[:3]),
        "stdlibOnly": True,
    }
    freeze = {
        "archiveBodiesOpened": False,
        "baseCommit": BASE_COMMIT,
        "createdAtUtc": utc_now(),
        "dependencyBinding": dependency_binding,
        "dependencyBindingSha256": canonical_sha(dependency_binding),
        "protocolSha256": sha256_path(PROTOCOL_PATH),
        "schema": "VG30FreezeV1",
        "sourceManifestSha256": source_manifest_sha,
        "state": "FROZEN_COMPRESSED_CUSTODY_READY_FOR_MARK",
        "staticCommit": head,
        "staticFileSha256": static_sha256_mapping(),
        "staticTree": git_output("rev-parse", "HEAD^{tree}"),
        "trialFamily": [trial_mapping(trial) for trial in trial_grid()],
        "trialFamilySha256": canonical_sha([trial_mapping(trial) for trial in trial_grid()]),
    }
    write_json_exclusive(FREEZE_PATH, freeze)
    return freeze


def validate_freeze() -> dict[str, Any]:
    freeze, _ = load_json(FREEZE_PATH, canonical=True)
    if freeze.get("schema") != "VG30FreezeV1":
        raise CustodyError("freeze schema drifted")
    if freeze.get("baseCommit") != BASE_COMMIT:
        raise CustodyError("freeze base commit drifted")
    if freeze.get("archiveBodiesOpened") is not False:
        raise CustodyError("freeze does not prove unopened bodies")
    raw_static = freeze.get("staticFileSha256")
    if not isinstance(raw_static, dict) or raw_static != static_sha256_mapping():
        raise CustodyError("frozen static bytes changed")
    dependency_binding = freeze.get("dependencyBinding")
    if (
        not isinstance(dependency_binding, dict)
        or freeze.get("dependencyBindingSha256") != canonical_sha(dependency_binding)
        or dependency_binding.get("stdlibOnly") is not True
    ):
        raise CustodyError("frozen dependency binding changed")
    if freeze.get("sourceManifestSha256") != sha256_path(SOURCE_MANIFEST_PATH):
        raise CustodyError("frozen source manifest changed")
    expected_trials = [trial_mapping(trial) for trial in trial_grid()]
    if freeze.get("trialFamily") != expected_trials or freeze.get(
        "trialFamilySha256"
    ) != canonical_sha(expected_trials):
        raise CustodyError("frozen trial family changed")
    return freeze


def command_mark(_args: argparse.Namespace) -> dict[str, object]:
    if lexists(RUN_MARKER_PATH):
        raise CustodyError("run marker already exists")
    head = require_clean_pushed_head()
    ensure_scoped_linear_history()
    require_exact_repo_files((*STATIC_FILES, *FREEZE_FILES))
    freeze = validate_freeze()
    if latest_path_commit(FREEZE_PATH) != head:
        raise CustodyError("HEAD is not the committed freeze")
    if freeze.get("staticCommit") == head:
        raise CustodyError("freeze receipt was not committed after static packet")
    marker = {
        "archiveBodiesOpenedBeforeMarker": False,
        "createdAtUtc": utc_now(),
        "freezeCommit": head,
        "freezeSha256": sha256_path(FREEZE_PATH),
        "ordinal": 1,
        "runCountAllowed": 1,
        "schema": "VG30RunMarkerV1",
        "state": "SOLE_ARCHIVE_BODY_RUN_ARMED",
    }
    write_json_exclusive(RUN_MARKER_PATH, marker, mode=0o600)
    return marker


def validate_marker(*, require_head: bool) -> tuple[dict[str, Any], str]:
    marker, _ = load_json(RUN_MARKER_PATH, canonical=True)
    if marker.get("schema") != "VG30RunMarkerV1" or marker.get("ordinal") != 1:
        raise CustodyError("run marker schema or ordinal drifted")
    if stat.S_IMODE(RUN_MARKER_PATH.stat().st_mode) != 0o600:
        raise CustodyError("run marker mode drifted")
    freeze = validate_freeze()
    freeze_commit = require_text(marker.get("freezeCommit"), "marker.freezeCommit")
    if marker.get("freezeSha256") != sha256_path(FREEZE_PATH):
        raise CustodyError("run marker freeze digest drifted")
    if latest_path_commit(FREEZE_PATH) != freeze_commit:
        raise CustodyError("run marker does not bind committed freeze")
    marker_commit = latest_path_commit(RUN_MARKER_PATH)
    if git_output("rev-parse", f"{marker_commit}^") != freeze_commit:
        raise CustodyError("run marker commit does not immediately follow freeze")
    marker_delta = changed_paths(freeze_commit, marker_commit)
    if marker_delta != (f"{SCOPE_PREFIX}run-marker.v1.json",):
        raise CustodyError("run marker commit delta is not exact")
    if freeze.get("staticCommit") == marker_commit:
        raise CustodyError("lifecycle commits collapsed unexpectedly")
    if require_head and git_head() != marker_commit:
        raise CustodyError("run must start at exact marker commit HEAD")
    return marker, marker_commit


def consume_run_state(marker_commit: str) -> Path:
    ensure_directory(STATE_ROOT)
    if any(STATE_ROOT.iterdir()):
        raise CustodyError("one-run state is already consumed")
    marker_raw = safe_regular(RUN_MARKER_PATH).read_bytes()
    receipt = {
        "consumedAtUtc": utc_now(),
        "custodyScope": "PACKET_LINEAGE_PLUS_FIXED_LOCAL_STATE_ROOT",
        "markerCommit": marker_commit,
        "markerSha256": sha256_bytes(marker_raw),
        "ordinal": 1,
        "schema": "VG30BodyConsumptionV1",
        "stateRoot": str(STATE_ROOT),
        "state": "SOLE_RUN_CONSUMED_IMMEDIATELY_BEFORE_FIRST_ARCHIVE_BODY_OPEN",
    }
    raw = canonical_bytes(receipt)
    state_path = STATE_ROOT / "body-consumed.v1.json"
    write_exclusive(state_path, raw, mode=0o600)
    write_exclusive(BODY_CONSUMPTION_PATH, raw, mode=0o600)
    return BODY_CONSUMPTION_PATH


def validate_consumption(marker_commit: str) -> dict[str, Any]:
    receipt, packet_raw = load_json(BODY_CONSUMPTION_PATH, canonical=True)
    if (
        receipt.get("schema") != "VG30BodyConsumptionV1"
        or receipt.get("ordinal") != 1
        or receipt.get("state") != "SOLE_RUN_CONSUMED_IMMEDIATELY_BEFORE_FIRST_ARCHIVE_BODY_OPEN"
        or receipt.get("custodyScope") != "PACKET_LINEAGE_PLUS_FIXED_LOCAL_STATE_ROOT"
        or receipt.get("stateRoot") != str(STATE_ROOT)
        or receipt.get("markerCommit") != marker_commit
        or receipt.get("markerSha256") != sha256_path(RUN_MARKER_PATH)
    ):
        raise CustodyError("body-consumption receipt drifted")
    if stat.S_IMODE(BODY_CONSUMPTION_PATH.stat().st_mode) != 0o600:
        raise CustodyError("body-consumption packet mode drifted")
    state_path = STATE_ROOT / "body-consumed.v1.json"
    if safe_regular(state_path).read_bytes() != packet_raw:
        raise CustodyError("body-consumption local-state copy drifted")
    if stat.S_IMODE(state_path.stat().st_mode) != 0o600:
        raise CustodyError("body-consumption local-state mode drifted")
    return receipt


def parse_archive_timestamp(
    raw: str,
    *,
    field: str,
    month: str,
) -> tuple[int, int, datetime]:
    try:
        value = int(raw)
    except ValueError as error:
        raise MeasurementError(f"{field} is not an integer timestamp") from error
    if not re.fullmatch(r"\d{4}-\d{2}", month):
        raise MeasurementError(f"{field} archive month is invalid")
    if month >= "2025-01":
        if not 1_000_000_000_000_000 <= value < 10_000_000_000_000_000:
            raise MeasurementError(f"{field} is not a post-2025 microsecond timestamp")
        scale = 1
    else:
        if not 1_000_000_000_000 <= value < 10_000_000_000_000:
            raise MeasurementError(f"{field} is not a pre-2025 millisecond timestamp")
        scale = 1_000
    normalized_us = value * scale
    seconds, micros = divmod(normalized_us, 1_000_000)
    parsed = datetime.fromtimestamp(seconds, tz=UTC) + timedelta(microseconds=micros)
    return value, normalized_us, parsed


def parse_kline_row(
    symbol: str,
    month: str,
    row: tuple[str, ...],
    *,
    context: str,
) -> Bar:
    if len(row) != 12:
        raise MeasurementError(f"{context} does not contain 12 kline fields")
    open_raw, open_us, open_dt = parse_archive_timestamp(
        row[0],
        field="openTime",
        month=month,
    )
    close_raw, close_us_floor, _close_dt = parse_archive_timestamp(
        row[6],
        field="closeTime",
        month=month,
    )
    if open_dt.tzinfo != UTC or open_dt.time() != datetime.min.time():
        raise MeasurementError(f"{context} is not a UTC daily open")
    timestamp_scale = 1 if month >= "2025-01" else 1_000
    if close_raw != open_raw + DAY_US // timestamp_scale - 1:
        raise MeasurementError(f"{context} close boundary is invalid")
    close_us = close_us_floor + timestamp_scale - 1
    if open_dt.strftime("%Y-%m") != month:
        raise MeasurementError(f"{context} lies outside archive month")
    numeric = [
        decimal_value(row[index], f"{context}.field{index}", nonnegative=True)
        for index in (1, 2, 3, 4, 5, 7, 9, 10, 11)
    ]
    open_price, high, low, close, base_volume, quote_volume, taker_base, taker_quote, _ = numeric
    try:
        trade_count = int(row[8])
    except ValueError as error:
        raise MeasurementError(f"{context} trade count is not an integer") from error
    if (
        open_price <= 0
        or high <= 0
        or low <= 0
        or close <= 0
        or high < max(open_price, close, low)
        or low > min(open_price, close, high)
        or trade_count < 0
        or taker_base > base_volume
        or taker_quote > quote_volume
    ):
        raise MeasurementError(f"{context} kline semantics are invalid")
    return Bar(
        symbol=symbol,
        day=open_dt.date(),
        open=open_price,
        quote_volume=quote_volume,
        open_time_us=open_us,
        close_time_us=close_us,
        raw_fields=row,
    )


def parse_archive(
    artifact: Mapping[str, Any],
    *,
    source_root: Path = SOURCE_ROOT,
) -> tuple[tuple[Bar, ...], tuple[dict[str, object], ...]]:
    if artifact.get("state") != "PRESENT":
        raise MeasurementError("cannot open an absent artifact")
    symbol = require_text(artifact.get("symbol"), "artifact.symbol")
    month = require_text(artifact.get("month"), "artifact.month")
    zip_path = source_root / require_text(artifact.get("zipPath"), "artifact.zipPath")
    checksum_path = source_root / require_text(
        artifact.get("checksumPath"), "artifact.checksumPath"
    )
    if safe_regular(zip_path).stat().st_size != require_int(
        artifact.get("zipBytes"), "artifact.zipBytes", minimum=1
    ):
        raise CustodyError(f"ZIP length drifted: {symbol}|{month}")
    if safe_regular(checksum_path).stat().st_size != require_int(
        artifact.get("checksumBytes"), "artifact.checksumBytes", minimum=1
    ):
        raise CustodyError(f"checksum length drifted: {symbol}|{month}")
    zip_sha = sha256_path(zip_path)
    checksum_sha = sha256_path(checksum_path)
    if zip_sha != artifact.get("zipSha256") or checksum_sha != artifact.get("checksumSha256"):
        raise CustodyError(f"compressed source digest drifted: {symbol}|{month}")
    verify_checksum_text(checksum_path.read_bytes(), zip_path.name, zip_sha)
    if zip_path.stat().st_size > 10_000_000:
        raise CustodyError(f"ZIP exceeds parser bound: {symbol}|{month}")

    bars: list[Bar] = []
    duplicates: list[dict[str, object]] = []
    seen: dict[int, tuple[tuple[str, ...], int]] = {}
    raw_hashes: list[str] = []
    with zipfile.ZipFile(zip_path) as archive:
        members = archive.infolist()
        if len(members) != 1 or members[0].is_dir():
            raise MeasurementError(f"archive member count invalid: {symbol}|{month}")
        member = members[0]
        expected_member = f"{symbol}-1d-{month}.csv"
        if (
            member.filename != expected_member
            or member.file_size > 20_000_000
            or member.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED)
            or member.flag_bits & ~0x800
        ):
            raise MeasurementError(f"archive member safety invalid: {symbol}|{month}")
        if member.compress_size <= 0 or member.file_size / member.compress_size > 100:
            raise MeasurementError(f"archive compression ratio invalid: {symbol}|{month}")
        with archive.open(member, "r") as raw_member:
            wrapper = io.TextIOWrapper(raw_member, encoding="utf-8", newline="")
            reader = csv.reader(wrapper)
            for row_number, raw_row in enumerate(reader, start=1):
                row = tuple(raw_row)
                if row_number == 1 and row == KLINE_HEADER:
                    continue
                bar = parse_kline_row(
                    symbol,
                    month,
                    row,
                    context=f"{symbol}|{month}|row{row_number}",
                )
                row_sha = canonical_sha(list(row))
                raw_hashes.append(row_sha)
                previous = seen.get(bar.open_time_us)
                if previous is not None:
                    previous_fields, previous_row = previous
                    if previous_fields != row:
                        raise MeasurementError(
                            f"CONFLICTING_DUPLICATE:{symbol}:{bar.day.isoformat()}"
                        )
                    if previous_row != row_number - 1:
                        raise MeasurementError(
                            f"NON_ADJACENT_DUPLICATE:{symbol}:{bar.day.isoformat()}"
                        )
                    duplicates.append(
                        {
                            "canonicalRow": previous_row,
                            "decodedFieldsSha256": row_sha,
                            "duplicateRow": row_number,
                            "month": month,
                            "openTimeUs": str(bar.open_time_us),
                            "symbol": symbol,
                        }
                    )
                    continue
                seen[bar.open_time_us] = (row, row_number)
                bars.append(bar)
    if not 1 <= len(bars) <= 31:
        raise MeasurementError(f"canonical daily row count invalid: {symbol}|{month}")
    days = tuple(bar.day for bar in bars)
    if days != tuple(sorted(days)) or len(days) != len(set(days)):
        raise MeasurementError(f"daily rows are not strictly increasing: {symbol}|{month}")
    if duplicates:
        canonical_digest = canonical_sha([list(bar.raw_fields) for bar in bars])
        raw_digest = canonical_sha(raw_hashes)
        duplicates = [
            {
                **row,
                "canonicalSequenceSha256": canonical_digest,
                "rawSequenceSha256": raw_digest,
            }
            for row in duplicates
        ]
    return tuple(bars), tuple(duplicates)


def load_bars(
    manifest: Mapping[str, Any],
    months: frozenset[str],
    *,
    source_root: Path = SOURCE_ROOT,
    existing: Mapping[str, Mapping[date, Bar]] | None = None,
) -> tuple[dict[str, dict[date, Bar]], tuple[dict[str, object], ...]]:
    raw_inventory = manifest.get("inventory")
    if not isinstance(raw_inventory, list):
        raise CustodyError("source inventory is unavailable")
    bars = {
        symbol: dict(series)
        for symbol, series in (existing.items() if existing is not None else ())
    }
    duplicates: list[dict[str, object]] = []
    for raw in raw_inventory:
        if not isinstance(raw, dict):
            raise CustodyError("source inventory row is invalid")
        if raw.get("state") != "PRESENT" or raw.get("month") not in months:
            continue
        parsed, anomalies = parse_archive(raw, source_root=source_root)
        duplicates.extend(anomalies)
        for bar in parsed:
            series = bars.setdefault(bar.symbol, {})
            if bar.day in series:
                raise MeasurementError(
                    f"CROSS_ARCHIVE_DUPLICATE:{bar.symbol}:{bar.day.isoformat()}"
                )
            series[bar.day] = bar
    return bars, tuple(duplicates)


def consecutive_bars(
    series: Mapping[date, Bar],
    end_inclusive: date,
    count: int,
) -> tuple[Bar, ...] | None:
    required = tuple(end_inclusive - timedelta(days=offset) for offset in range(count - 1, -1, -1))
    if any(day not in series for day in required):
        return None
    return tuple(series[day] for day in required)


def tail_feature(
    bars: Mapping[str, Mapping[date, Bar]],
    sunday: date,
    tail_fraction: Decimal,
) -> TailFeature:
    if sunday.weekday() != 6:
        raise MeasurementError("tail feature must be evaluated on Sunday")
    if tail_fraction not in (D("0.10"), D("0.20")):
        raise MeasurementError("tail fraction is outside frozen family")
    eligible: list[tuple[str, Decimal, Decimal]] = []
    for symbol in sorted(bars, key=symbol_sort_key):
        history = consecutive_bars(
            bars[symbol],
            sunday,
            ANOMALY_LOOKBACK_DAYS + 1,
        )
        if history is None:
            continue
        prior_60 = tuple(bar.quote_volume for bar in history[:-1])
        prior_30 = tuple(bar.quote_volume for bar in history[-(LIQUIDITY_LOOKBACK_DAYS + 1) : -1])
        baseline = median_decimal(prior_60)
        liquidity = median_decimal(prior_30)
        if liquidity < MIN_PRIOR_30D_MEDIAN_QUOTE_VOLUME:
            continue
        if baseline <= 0:
            raise MeasurementError(
                f"ELIGIBLE_PRIOR_60_MEDIAN_NONPOSITIVE:{symbol}:{sunday.isoformat()}"
            )
        anomaly = max(history[-1].quote_volume / baseline - D(1), D(0))
        eligible.append((symbol, anomaly, liquidity))
    if len(eligible) < MIN_RISK_SET:
        raise MeasurementError(f"RISK_SET_BELOW_30:{sunday.isoformat()}")
    k = int((tail_fraction * D(len(eligible))).to_integral_value(rounding="ROUND_CEILING"))
    positives = [(symbol, anomaly) for symbol, anomaly, _ in eligible if anomaly > 0]
    positives.sort(key=lambda item: (-item[1], symbol_sort_key(item[0])))
    if len(positives) < k:
        raise MeasurementError(
            f"STRICTLY_POSITIVE_ANOMALIES_BELOW_K:{sunday.isoformat()}:{tail_fraction}"
        )
    total_positive = sum((value for _, value in positives), D(0))
    concentration = sum((value for _, value in positives[:k]), D(0)) / total_positive
    liquidity_rows = tuple(
        sorted(
            ((symbol, liquidity) for symbol, _anomaly, liquidity in eligible),
            key=lambda item: symbol_sort_key(item[0]),
        )
    )
    risk_set = [symbol for symbol, _anomaly, _liquidity in eligible]
    return TailFeature(
        sunday=sunday,
        tail_fraction=tail_fraction,
        k=k,
        concentration=concentration,
        ranked_anomalies=tuple(positives),
        prior_30d_medians=liquidity_rows,
        risk_set_size=len(eligible),
        risk_set_sha256=canonical_sha(risk_set),
    )


def feature_calendar(
    bars: Mapping[str, Mapping[date, Bar]],
    *,
    end_inclusive: date,
) -> dict[tuple[date, Decimal], TailFeature]:
    first = SOURCE_START + timedelta(days=ANOMALY_LOOKBACK_DAYS)
    while first.weekday() != 6:
        first += timedelta(days=1)
    output: dict[tuple[date, Decimal], TailFeature] = {}
    current = first
    while current <= end_inclusive:
        for fraction in (D("0.10"), D("0.20")):
            output[(current, fraction)] = tail_feature(bars, current, fraction)
        current += timedelta(days=7)
    return output


def _weekly_observation(
    *,
    trial: Trial,
    sunday: date,
    features: Mapping[tuple[date, Decimal], TailFeature],
    bars: Mapping[str, Mapping[date, Bar]],
    earliest_feature_sunday: date,
) -> WeeklyObservation:
    entry_day = sunday + timedelta(days=2)
    exit_day = sunday + timedelta(days=9)
    prior_days = tuple(
        sunday - timedelta(days=7 * offset) for offset in range(PRIOR_SUNDAYS, 0, -1)
    )
    if prior_days[0] < earliest_feature_sunday:
        raise MeasurementError(
            "EXACT_PRIOR_26_SUNDAY_TAIL_HISTORY_UNAVAILABLE:"
            f"{sunday.isoformat()}:{prior_days[0].isoformat()}"
        )
    key = (sunday, trial.tail_fraction)
    if key not in features:
        raise MeasurementError(f"CURRENT_TAIL_FEATURE_MISSING:{sunday.isoformat()}")
    prior_features: list[TailFeature] = []
    for prior_day in prior_days:
        prior_key = (prior_day, trial.tail_fraction)
        if prior_key not in features:
            raise MeasurementError(f"PRIOR_TAIL_FEATURE_MISSING:{prior_day.isoformat()}")
        prior_features.append(features[prior_key])
    current = features[key]
    threshold = nearest_rank(
        [item.concentration for item in prior_features],
        trial.threshold_quantile,
    )
    if current.concentration <= threshold:
        return WeeklyObservation(
            sunday=sunday,
            entry_day=entry_day,
            exit_day=exit_day,
            active=False,
            reason="EVENT_INACTIVE_STRICT_THRESHOLD_NOT_EXCEEDED",
            symbols=(),
            k=current.k,
            risk_set_size=current.risk_set_size,
            concentration=current.concentration,
            threshold=threshold,
            gross_factors=(),
            prior_30d_medians=(),
        )
    symbols = tuple(symbol for symbol, _ in current.ranked_anomalies[: current.k])
    liquidity = dict(current.prior_30d_medians)
    factors: list[Decimal] = []
    medians: list[Decimal] = []
    for symbol in symbols:
        series = bars.get(symbol)
        if series is None or entry_day not in series or exit_day not in series:
            raise MeasurementError(f"SELECTED_ENTRY_OR_EXIT_MISSING:{symbol}:{sunday.isoformat()}")
        entry = series[entry_day].open
        exit_price = series[exit_day].open
        if entry <= 0 or exit_price <= 0:
            raise MeasurementError(f"SELECTED_ENTRY_OR_EXIT_INVALID:{symbol}:{sunday.isoformat()}")
        if symbol not in liquidity:
            raise MeasurementError(
                f"SELECTED_CAPACITY_EVIDENCE_MISSING:{symbol}:{sunday.isoformat()}"
            )
        factors.append(exit_price / entry)
        medians.append(liquidity[symbol])
    if len(factors) != current.k:
        raise AssertionError("active observation is not a full cohort")
    return WeeklyObservation(
        sunday=sunday,
        entry_day=entry_day,
        exit_day=exit_day,
        active=True,
        reason="EVENT_ACTIVE_COMPLETE_COHORT",
        symbols=symbols,
        k=current.k,
        risk_set_size=current.risk_set_size,
        concentration=current.concentration,
        threshold=threshold,
        gross_factors=tuple(factors),
        prior_30d_medians=tuple(medians),
    )


def build_observations(
    *,
    trial: Trial,
    sundays: Sequence[date],
    features: Mapping[tuple[date, Decimal], TailFeature],
    bars: Mapping[str, Mapping[date, Bar]],
) -> tuple[WeeklyObservation, ...]:
    if not features:
        raise MeasurementError("tail feature calendar is empty")
    earliest = min(day for day, _fraction in features)
    return tuple(
        _weekly_observation(
            trial=trial,
            sunday=sunday,
            features=features,
            bars=bars,
            earliest_feature_sunday=earliest,
        )
        for sunday in sundays
    )


def cost_adjusted_factor(
    gross_factor: Decimal,
    *,
    fee: Decimal,
    adverse: Decimal,
) -> Decimal:
    if gross_factor <= 0 or fee < 0 or adverse < 0 or fee >= 1 or adverse >= 1:
        raise MeasurementError("cost-adjusted factor input is invalid")
    buy_quantity_factor = (D(1) - fee) / (D(1) + adverse)
    sell_proceeds_factor = gross_factor * (D(1) - adverse) * (D(1) - fee)
    return buy_quantity_factor * sell_proceeds_factor


def cohort_factor(
    gross_factors: Sequence[Decimal],
    *,
    fee: Decimal,
    adverse: Decimal,
) -> Decimal:
    if not gross_factors:
        raise MeasurementError("active cohort has no members")
    return sum(
        (cost_adjusted_factor(value, fee=fee, adverse=adverse) for value in gross_factors),
        D(0),
    ) / D(len(gross_factors))


def maximum_drawdown(nav: Sequence[Decimal]) -> Decimal:
    if not nav or any(value <= 0 for value in nav):
        raise MeasurementError("drawdown path is empty or nonpositive")
    peak = nav[0]
    worst = D(0)
    for value in nav:
        peak = max(peak, value)
        worst = max(worst, (peak - value) / peak)
    return worst


def percentile(values: Sequence[Decimal], probability: Decimal) -> Decimal | None:
    if not values:
        return None
    if probability < 0 or probability > 1:
        raise VG30Error("percentile probability is outside [0,1]")
    ordered = sorted(values)
    if probability == 0:
        return ordered[0]
    index = int((probability * D(len(ordered))).to_integral_value(rounding="ROUND_CEILING"))
    return ordered[min(max(index - 1, 0), len(ordered) - 1)]


def observation_mapping(value: WeeklyObservation) -> dict[str, object]:
    return {
        "active": value.active,
        "concentration": (
            decimal_text(value.concentration) if value.concentration is not None else None
        ),
        "entryDay": value.entry_day.isoformat(),
        "exitDay": value.exit_day.isoformat(),
        "k": value.k,
        "reason": value.reason,
        "riskSetSize": value.risk_set_size,
        "signalSunday": value.sunday.isoformat(),
        "symbols": list(value.symbols),
        "threshold": decimal_text(value.threshold) if value.threshold is not None else None,
    }


def _selection_summary(
    observations: Sequence[WeeklyObservation],
) -> dict[str, object]:
    active = [item for item in observations if item.active]
    counts: dict[str, int] = {}
    total_slots = 0
    for item in active:
        if len(item.symbols) != item.k:
            raise AssertionError("active observation lost full-cohort identity")
        total_slots += len(item.symbols)
        for symbol in item.symbols:
            counts[symbol] = counts.get(symbol, 0) + 1
    max_share = (
        max((D(count) / D(total_slots) for count in counts.values()), default=D(0))
        if total_slots
        else None
    )
    return {
        "activeCohorts": len(active),
        "activeMonths": sorted({item.entry_day.strftime("%Y-%m") for item in active}),
        "distinctHeldSymbols": sorted(counts, key=symbol_sort_key),
        "maxSingleSymbolSelectionShare": (
            decimal_text(max_share) if max_share is not None else None
        ),
        "selectionCounts": dict(sorted(counts.items(), key=lambda item: symbol_sort_key(item[0]))),
        "totalSelectionSlots": total_slots,
    }


def _capacity_summary(
    observations: Sequence[WeeklyObservation],
) -> dict[str, object]:
    active = [item for item in observations if item.active]
    base_values: list[Decimal] = []
    stress_values: list[Decimal] = []
    for item in active:
        if not item.prior_30d_medians or len(item.prior_30d_medians) != item.k:
            raise MeasurementError(f"ACTIVE_CAPACITY_EVIDENCE_INCOMPLETE:{item.sunday.isoformat()}")
        weakest = min(item.prior_30d_medians)
        base_values.append(D(item.k) * weakest * BASE_CAPACITY_PARTICIPATION)
        stress_values.append(D(item.k) * weakest * STRESS_CAPACITY_PARTICIPATION)
    base_p05 = percentile(base_values, D("0.05"))
    stress_p05 = percentile(stress_values, D("0.05"))
    return {
        "activeCapacityObservations": len(active),
        "baseParticipation": "0.0001",
        "baseP05Usdt": decimal_text(base_p05) if base_p05 is not None else None,
        "executableCapacity": None,
        "status": "PUBLIC_QUOTE_VOLUME_PARTICIPATION_PROXY_ONLY",
        "stressParticipation": "0.00005",
        "stressP05Usdt": decimal_text(stress_p05) if stress_p05 is not None else None,
    }


def scenario_path(
    observations: Sequence[WeeklyObservation],
    *,
    scenario_name: str,
) -> tuple[tuple[Decimal, ...], tuple[Decimal, ...]]:
    if scenario_name not in SCENARIOS:
        raise VG30Error(f"unknown cost scenario: {scenario_name}")
    fee, adverse = SCENARIOS[scenario_name]
    nav = INITIAL_USDT
    nav_path = [nav]
    weekly_per_1000: list[Decimal] = []
    for item in observations:
        if not item.active:
            weekly_per_1000.append(D(0))
            nav_path.append(nav)
            continue
        factor = cohort_factor(item.gross_factors, fee=fee, adverse=adverse)
        weekly_per_1000.append((factor - D(1)) * INITIAL_USDT)
        nav *= factor
        nav_path.append(nav)
    return tuple(weekly_per_1000), tuple(nav_path)


def scenario_mapping(
    observations: Sequence[WeeklyObservation],
    *,
    scenario_name: str,
) -> dict[str, object]:
    weekly, nav = scenario_path(observations, scenario_name=scenario_name)
    mean_value = mean_decimal(weekly)
    if mean_value is None:
        raise MeasurementError("scenario has no scheduled weeks")
    fee, adverse = SCENARIOS[scenario_name]
    return {
        "adversePriceBpsPerFill": decimal_text(adverse * D(10000), 4),
        "drawdownObservation": ("START_AND_POST_EXIT_TUESDAY_NAV_ONLY;INTRAWEEK_PATH_UNMEASURED"),
        "feeBpsPerFill": decimal_text(fee * D(10000), 4),
        "maximumDrawdown": decimal_text(maximum_drawdown(nav)),
        "netMeanUsdtPer1000PerWeek": decimal_text(mean_value),
        "netUsdtPer1000": decimal_text(nav[-1] - INITIAL_USDT),
        "scenario": scenario_name,
        "weeklyNetUsdtPer1000": [decimal_text(value) for value in weekly],
    }


def simulate_trial(
    *,
    trial: Trial,
    sundays: Sequence[date],
    features: Mapping[tuple[date, Decimal], TailFeature],
    bars: Mapping[str, Mapping[date, Bar]],
) -> dict[str, object]:
    observations = build_observations(
        trial=trial,
        sundays=sundays,
        features=features,
        bars=bars,
    )
    return {
        "capacity": _capacity_summary(observations),
        "observations": [observation_mapping(item) for item in observations],
        "scenarios": {
            name: scenario_mapping(observations, scenario_name=name) for name in SCENARIOS
        },
        "selection": _selection_summary(observations),
        **trial_mapping(trial),
    }


def circular_draw_indices(
    length: int,
    *,
    replicates: int = BOOTSTRAP_REPLICATES,
    block_length: int = BOOTSTRAP_BLOCK_WEEKS,
    seed: int = BOOTSTRAP_SEED,
) -> tuple[tuple[int, ...], ...]:
    if length <= 0 or replicates <= 0 or block_length <= 0:
        raise VG30Error("bootstrap dimensions must be positive")
    generator = random.Random(seed)
    draws: list[tuple[int, ...]] = []
    blocks = math.ceil(length / block_length)
    for _ in range(replicates):
        indices: list[int] = []
        for _block in range(blocks):
            start = generator.randrange(length)
            indices.extend((start + offset) % length for offset in range(block_length))
        draws.append(tuple(indices[:length]))
    return tuple(draws)


def _series_from_metrics(metrics: Mapping[str, Any], scenario: str) -> tuple[Decimal, ...]:
    raw_scenarios = metrics.get("scenarios")
    if not isinstance(raw_scenarios, dict):
        raise MeasurementError("trial scenarios are absent")
    raw = raw_scenarios.get(scenario)
    if not isinstance(raw, dict):
        raise MeasurementError(f"trial scenario is absent: {scenario}")
    values = raw.get("weeklyNetUsdtPer1000")
    if not isinstance(values, list):
        raise MeasurementError("weekly series is absent")
    return tuple(decimal_value(item, "weeklyNetUsdtPer1000") for item in values)


def bootstrap_interval(
    series: Sequence[Decimal],
    draws: Sequence[Sequence[int]],
) -> dict[str, object]:
    observed = mean_decimal(series)
    if observed is None:
        raise MeasurementError("bootstrap series is empty")
    sampled = [
        cast(Decimal, mean_decimal(tuple(series[index] for index in draw))) for draw in draws
    ]
    centered = tuple(value - observed for value in series)
    centered_sampled = [
        cast(Decimal, mean_decimal(tuple(centered[index] for index in draw))) for draw in draws
    ]
    lower = percentile(sampled, D("0.05"))
    upper = percentile(sampled, D("0.95"))
    if lower is None or upper is None:
        raise AssertionError("bootstrap percentile unexpectedly absent")
    exceedances = sum(value >= observed for value in centered_sampled)
    p_value = D(exceedances + 1) / D(len(draws) + 1)
    return {
        "blockLengthWeeks": BOOTSTRAP_BLOCK_WEEKS,
        "canonical90PctTwoSided": {
            "lowerUsdtPer1000PerWeek": decimal_text(lower),
            "upperUsdtPer1000PerWeek": decimal_text(upper),
        },
        "centeredOneSidedPValue": decimal_text(p_value),
        "meanUsdtPer1000PerWeek": decimal_text(observed),
        "oneSided95LcbUsdtPer1000PerWeek": decimal_text(lower),
        "replicates": len(draws),
    }


def holm_adjusted(p_values: Mapping[str, Decimal]) -> dict[str, Decimal]:
    ordered = sorted(p_values.items(), key=lambda item: (item[1], item[0]))
    adjusted: dict[str, Decimal] = {}
    running = D(0)
    family = len(ordered)
    for index, (trial_id, p_value) in enumerate(ordered):
        candidate = min(D(1), D(family - index) * p_value)
        running = max(running, candidate)
        adjusted[trial_id] = running
    return adjusted


def family_inference(
    metrics_by_trial: Mapping[str, Mapping[str, Any]],
    *,
    scenario: str,
    draws: Sequence[Sequence[int]],
) -> dict[str, object]:
    series = {
        trial_id: _series_from_metrics(metrics, scenario)
        for trial_id, metrics in metrics_by_trial.items()
    }
    lengths = {len(values) for values in series.values()}
    if len(lengths) != 1 or not lengths or next(iter(lengths)) == 0:
        raise MeasurementError("family weekly series are not synchronized")
    intervals = {trial_id: bootstrap_interval(values, draws) for trial_id, values in series.items()}
    raw_p = {
        trial_id: decimal_value(
            interval["centeredOneSidedPValue"],
            "centeredOneSidedPValue",
        )
        for trial_id, interval in intervals.items()
    }
    adjusted = holm_adjusted(raw_p)
    observed_means = {
        trial_id: cast(Decimal, mean_decimal(values)) for trial_id, values in series.items()
    }
    centered = {
        trial_id: tuple(value - observed_means[trial_id] for value in values)
        for trial_id, values in series.items()
    }
    observed_max = max(observed_means.values())
    bootstrap_maxima: list[Decimal] = []
    for draw in draws:
        bootstrap_maxima.append(
            max(
                cast(
                    Decimal,
                    mean_decimal(tuple(values[index] for index in draw)),
                )
                for values in centered.values()
            )
        )
    white_p = D(1 + sum(value >= observed_max for value in bootstrap_maxima)) / D(len(draws) + 1)
    return {
        "holmAdjustedPValues": {
            trial_id: decimal_text(value) for trial_id, value in sorted(adjusted.items())
        },
        "intervals": intervals,
        "scenario": scenario,
        "whiteRealityCheck": {
            "centeredMaximumStatisticPValue": decimal_text(white_p),
            "familySize": len(series),
            "replicates": len(draws),
            "synchronized": True,
        },
    }


def pbo_diagnostic(
    metrics_by_trial: Mapping[str, Mapping[str, Any]],
    *,
    scenario: str = "base",
) -> dict[str, object]:
    expected_months = (
        *(f"2025-{month:02d}" for month in range(7, 13)),
        "2026-01",
        "2026-02",
    )
    trial_ids = tuple(sorted(metrics_by_trial))
    if len(trial_ids) < 2:
        return {
            "blockCount": 8,
            "pbo": None,
            "reason": "FEWER_THAN_TWO_TRIALS",
            "splitCount": 0,
            "status": "UNDEFINED",
        }
    full_series = {
        trial_id: _series_from_metrics(metrics_by_trial[trial_id], scenario)
        for trial_id in trial_ids
    }
    distinct_digest_count = len(
        {
            canonical_sha([decimal_text(value) for value in series])
            for series in full_series.values()
        }
    )
    if distinct_digest_count < 2:
        return {
            "blockCount": 8,
            "distinctSeries": distinct_digest_count,
            "pbo": None,
            "reason": "FEWER_THAN_TWO_DISTINCT_TRIAL_SERIES",
            "splitCount": 0,
            "status": "UNDEFINED",
        }
    month_indices: dict[str, list[int]] = {month: [] for month in expected_months}
    reference_observations = metrics_by_trial[trial_ids[0]].get("observations")
    if not isinstance(reference_observations, list):
        raise MeasurementError("PBO observation calendar is absent")
    for index, raw in enumerate(reference_observations):
        if not isinstance(raw, dict):
            raise MeasurementError("PBO observation row is invalid")
        month = require_text(raw.get("entryDay"), "entryDay")[:7]
        if month in month_indices:
            month_indices[month].append(index)
    if any(not month_indices[month] for month in expected_months):
        return {
            "blockCount": 8,
            "distinctSeries": distinct_digest_count,
            "pbo": None,
            "reason": "ONE_OR_MORE_CALENDAR_MONTH_BLOCKS_EMPTY",
            "splitCount": 0,
            "status": "UNDEFINED",
        }
    overfit = 0
    split_rows: list[dict[str, object]] = []
    month_positions = tuple(range(8))
    for in_positions in combinations(month_positions, 4):
        in_months = {expected_months[index] for index in in_positions}
        out_months = set(expected_months) - in_months
        in_indices = [
            index
            for month in expected_months
            if month in in_months
            for index in month_indices[month]
        ]
        out_indices = [
            index
            for month in expected_months
            if month in out_months
            for index in month_indices[month]
        ]
        in_scores = {
            trial_id: cast(
                Decimal,
                mean_decimal(tuple(full_series[trial_id][index] for index in in_indices)),
            )
            for trial_id in trial_ids
        }
        best_in_score = max(in_scores.values())
        champions = tuple(
            trial_id for trial_id in trial_ids if in_scores[trial_id] == best_in_score
        )
        if len(champions) != 1:
            return {
                "blockCount": 8,
                "distinctSeries": distinct_digest_count,
                "pbo": None,
                "reason": "ONE_OR_MORE_CSCV_MEAN_SCORE_TIES",
                "splitCount": 0,
                "status": "UNDEFINED",
            }
        champion = champions[0]
        out_scores = {
            trial_id: cast(
                Decimal,
                mean_decimal(tuple(full_series[trial_id][index] for index in out_indices)),
            )
            for trial_id in trial_ids
        }
        if len(set(out_scores.values())) != len(out_scores):
            return {
                "blockCount": 8,
                "distinctSeries": distinct_digest_count,
                "pbo": None,
                "reason": "ONE_OR_MORE_CSCV_MEAN_SCORE_TIES",
                "splitCount": 0,
                "status": "UNDEFINED",
            }
        ranked = sorted(trial_ids, key=lambda item: (-out_scores[item], item))
        rank = ranked.index(champion) + 1
        below_median = rank > len(ranked) / 2
        overfit += int(below_median)
        split_rows.append(
            {
                "championTrialId": champion,
                "inSampleMonths": sorted(in_months),
                "outOfSampleRank": rank,
            }
        )
    if len(split_rows) != 70:
        raise AssertionError("8-block CSCV did not produce 70 symmetric splits")
    return {
        "blockCount": 8,
        "distinctSeries": distinct_digest_count,
        "pbo": decimal_text(D(overfit) / D(len(split_rows))),
        "reason": None,
        "splitCount": len(split_rows),
        "splitDigest": canonical_sha(split_rows),
        "status": "MEASURED_DIAGNOSTIC_ONLY",
    }


def _scenario(metrics: Mapping[str, Any], name: str) -> Mapping[str, Any]:
    raw = metrics.get("scenarios")
    if not isinstance(raw, dict) or not isinstance(raw.get(name), dict):
        raise MeasurementError(f"scenario missing: {name}")
    return cast(Mapping[str, Any], raw[name])


def _interval(inference: Mapping[str, Any], trial_id: str) -> Mapping[str, Any]:
    intervals = inference.get("intervals")
    if not isinstance(intervals, dict) or not isinstance(intervals.get(trial_id), dict):
        raise MeasurementError("trial interval is absent")
    return cast(Mapping[str, Any], intervals[trial_id])


def development_gate_reasons(
    metrics: Mapping[str, Any],
    *,
    base_inference: Mapping[str, Any],
    stress_inference: Mapping[str, Any],
) -> tuple[str, ...]:
    trial_id = require_text(metrics.get("trialId"), "trialId")
    selection = metrics.get("selection")
    capacity = metrics.get("capacity")
    if not isinstance(selection, dict) or not isinstance(capacity, dict):
        raise MeasurementError("selection or capacity summary is absent")
    reasons: list[str] = []
    if require_int(selection.get("activeCohorts"), "activeCohorts") < 12:
        reasons.append("ACTIVE_COHORTS_BELOW_12")
    active_months = selection.get("activeMonths")
    if not isinstance(active_months, list) or len(active_months) < 6:
        reasons.append("ACTIVE_MONTHS_BELOW_6")
    held = selection.get("distinctHeldSymbols")
    if not isinstance(held, list) or len(held) < 8:
        reasons.append("DISTINCT_HELD_SYMBOLS_BELOW_8")
    max_share_raw = selection.get("maxSingleSymbolSelectionShare")
    if max_share_raw is None or decimal_value(max_share_raw, "maxShare") > D("0.40"):
        reasons.append("MAX_SINGLE_SYMBOL_SELECTION_SHARE_ABOVE_0_40")
    stress_capacity_raw = capacity.get("stressP05Usdt")
    if (
        stress_capacity_raw is None
        or decimal_value(stress_capacity_raw, "stressCapacity") < CAPACITY_GATE_USDT
    ):
        reasons.append("STRESS_CAPACITY_PROXY_P05_BELOW_1000")
    for name, inference in (("BASE", base_inference), ("STRESS", stress_inference)):
        scenario = _scenario(metrics, name.lower())
        interval = _interval(inference, trial_id)
        if (
            decimal_value(
                scenario.get("netMeanUsdtPer1000PerWeek"),
                f"{name}.mean",
            )
            <= 0
        ):
            reasons.append(f"{name}_NET_MEAN_NOT_POSITIVE")
        if (
            decimal_value(
                interval.get("oneSided95LcbUsdtPer1000PerWeek"),
                f"{name}.lcb",
            )
            <= 0
        ):
            reasons.append(f"{name}_ONE_SIDED_95_LCB_NOT_POSITIVE")
    if (
        decimal_value(
            _scenario(metrics, "stress").get("maximumDrawdown"),
            "stress.maximumDrawdown",
        )
        > MAX_DRAWDOWN
    ):
        reasons.append("STRESS_MAXIMUM_DRAWDOWN_ABOVE_0_20")
    holm_values = stress_inference.get("holmAdjustedPValues")
    if (
        not isinstance(holm_values, dict)
        or decimal_value(holm_values.get(trial_id), "holmAdjustedP") >= ALPHA
    ):
        reasons.append("HOLM_ADJUSTED_P_NOT_BELOW_0_05")
    white = stress_inference.get("whiteRealityCheck")
    if (
        not isinstance(white, dict)
        or decimal_value(white.get("centeredMaximumStatisticPValue"), "whiteP") >= ALPHA
    ):
        reasons.append("WHITE_REALITY_CHECK_P_NOT_BELOW_0_05")
    return tuple(reasons)


def holdout_gate_reasons(
    metrics: Mapping[str, Any],
    *,
    base_interval: Mapping[str, Any],
    stress_interval: Mapping[str, Any],
) -> tuple[str, ...]:
    selection = metrics.get("selection")
    capacity = metrics.get("capacity")
    if not isinstance(selection, dict) or not isinstance(capacity, dict):
        raise MeasurementError("holdout selection or capacity summary is absent")
    reasons: list[str] = []
    if require_int(selection.get("activeCohorts"), "activeCohorts") < 6:
        reasons.append("ACTIVE_COHORTS_BELOW_6")
    active_months = selection.get("activeMonths")
    if not isinstance(active_months, list) or len(active_months) < 3:
        reasons.append("ACTIVE_MONTHS_BELOW_3")
    held = selection.get("distinctHeldSymbols")
    if not isinstance(held, list) or len(held) < 5:
        reasons.append("DISTINCT_HELD_SYMBOLS_BELOW_5")
    max_share_raw = selection.get("maxSingleSymbolSelectionShare")
    if max_share_raw is None or decimal_value(max_share_raw, "maxShare") > D("0.50"):
        reasons.append("MAX_SINGLE_SYMBOL_SELECTION_SHARE_ABOVE_0_50")
    capacity_raw = capacity.get("stressP05Usdt")
    if capacity_raw is None or decimal_value(capacity_raw, "capacity") < CAPACITY_GATE_USDT:
        reasons.append("STRESS_CAPACITY_PROXY_P05_BELOW_1000")
    for name, interval in (("BASE", base_interval), ("STRESS", stress_interval)):
        scenario = _scenario(metrics, name.lower())
        if decimal_value(scenario.get("netMeanUsdtPer1000PerWeek"), f"{name}.mean") <= 0:
            reasons.append(f"{name}_NET_MEAN_NOT_POSITIVE")
        if decimal_value(interval.get("oneSided95LcbUsdtPer1000PerWeek"), f"{name}.lcb") <= 0:
            reasons.append(f"{name}_ONE_SIDED_95_LCB_NOT_POSITIVE")
    if (
        decimal_value(
            _scenario(metrics, "stress").get("maximumDrawdown"),
            "stress.maximumDrawdown",
        )
        > MAX_DRAWDOWN
    ):
        reasons.append("STRESS_MAXIMUM_DRAWDOWN_ABOVE_0_20")
    return tuple(reasons)


def _candidate_rank(
    metrics: Mapping[str, Any],
    base_inference: Mapping[str, Any],
    stress_inference: Mapping[str, Any],
) -> tuple[Decimal, Decimal, str]:
    trial_id = require_text(metrics.get("trialId"), "trialId")
    base_lcb = decimal_value(
        _interval(base_inference, trial_id).get("oneSided95LcbUsdtPer1000PerWeek"),
        "baseLcb",
    )
    stress_lcb = decimal_value(
        _interval(stress_inference, trial_id).get("oneSided95LcbUsdtPer1000PerWeek"),
        "stressLcb",
    )
    stress_net = decimal_value(
        _scenario(metrics, "stress").get("netUsdtPer1000"),
        "stressNet",
    )
    return min(base_lcb, stress_lcb), stress_net, trial_id


def analyze_development(
    bars: Mapping[str, Mapping[date, Bar]],
    duplicate_rows: Sequence[Mapping[str, object]],
    *,
    replicates: int = BOOTSTRAP_REPLICATES,
) -> tuple[dict[str, object], dict[str, object]]:
    sundays = contained_sundays(DEVELOPMENT_START, DEVELOPMENT_END_EXCLUSIVE)
    features = feature_calendar(
        bars,
        end_inclusive=max(sundays),
    )
    metrics_by_trial = {
        trial.trial_id: simulate_trial(
            trial=trial,
            sundays=sundays,
            features=features,
            bars=bars,
        )
        for trial in trial_grid()
    }
    draws = circular_draw_indices(
        len(sundays),
        replicates=replicates,
        seed=BOOTSTRAP_SEED,
    )
    base_inference = family_inference(
        metrics_by_trial,
        scenario="base",
        draws=draws,
    )
    stress_inference = family_inference(
        metrics_by_trial,
        scenario="stress",
        draws=draws,
    )
    champion_id = sorted(
        metrics_by_trial,
        key=lambda trial_id: (
            -_candidate_rank(metrics_by_trial[trial_id], base_inference, stress_inference)[0],
            -_candidate_rank(metrics_by_trial[trial_id], base_inference, stress_inference)[1],
            trial_id,
        ),
    )[0]
    rows: list[dict[str, object]] = []
    for trial_id in sorted(metrics_by_trial):
        metrics = metrics_by_trial[trial_id]
        reasons = development_gate_reasons(
            metrics,
            base_inference=base_inference,
            stress_inference=stress_inference,
        )
        rows.append(
            {
                "baseInterval": _interval(base_inference, trial_id),
                "baseNetUsdtPer1000": _scenario(metrics, "base")["netUsdtPer1000"],
                "failedGates": list(reasons),
                "holmAdjustedPValue": cast(
                    Mapping[str, Any], stress_inference["holmAdjustedPValues"]
                )[trial_id],
                "metrics": metrics,
                "status": "MEASURED_GATE_PASS" if not reasons else "MEASURED_GATE_FAIL",
                "stressInterval": _interval(stress_inference, trial_id),
                "stressNetUsdtPer1000": _scenario(metrics, "stress")["netUsdtPer1000"],
                "trialId": trial_id,
            }
        )
    champion_row = next(row for row in rows if row["trialId"] == champion_id)
    champion_reasons = cast(list[str], champion_row["failedGates"])
    ledger = {
        "familySize": 6,
        "rows": rows,
        "rowsSha256": canonical_sha(rows),
        "schema": "VG30TrialLedgerV1",
        "status": "COMPLETE_SIX_TRIAL_LEDGER",
    }
    development = {
        "baseInference": base_inference,
        "championSelectionLaw": ("HIGHEST_MINIMUM_BASE_STRESS_LCB_THEN_STRESS_NET_THEN_TRIAL_ID"),
        "duplicateNormalization": {
            "count": len(duplicate_rows),
            "rows": list(duplicate_rows),
            "rowsSha256": canonical_sha(list(duplicate_rows)),
        },
        "gates": {
            "failed": champion_reasons,
            "passed": not champion_reasons,
        },
        "holdoutArchiveBodiesOpened": False,
        "pbo": pbo_diagnostic(metrics_by_trial),
        "schema": "VG30DevelopmentResultV1",
        "selectedChampionTrialId": champion_id,
        "status": "MEASURED",
        "stressInference": stress_inference,
        "trialLedgerSha256": canonical_sha(ledger),
        "window": {
            "endInclusive": "2026-02-28",
            "scheduledSundays": [item.isoformat() for item in sundays],
            "startInclusive": "2025-07-01",
        },
    }
    return development, ledger


def trial_from_id(trial_id: str) -> Trial:
    matches = [trial for trial in trial_grid() if trial.trial_id == trial_id]
    if len(matches) != 1:
        raise CustodyError("candidate trial ID is outside frozen family")
    return matches[0]


def analyze_holdout(
    bars: Mapping[str, Mapping[date, Bar]],
    champion: Trial,
    duplicate_rows: Sequence[Mapping[str, object]],
    *,
    replicates: int = BOOTSTRAP_REPLICATES,
) -> dict[str, object]:
    sundays = contained_sundays(HOLDOUT_START, EVALUATION_END_EXCLUSIVE)
    features = feature_calendar(bars, end_inclusive=max(sundays))
    metrics = simulate_trial(
        trial=champion,
        sundays=sundays,
        features=features,
        bars=bars,
    )
    draws = circular_draw_indices(
        len(sundays),
        replicates=replicates,
        seed=BOOTSTRAP_SEED + 1,
    )
    base_interval = bootstrap_interval(_series_from_metrics(metrics, "base"), draws)
    stress_interval = bootstrap_interval(_series_from_metrics(metrics, "stress"), draws)
    reasons = holdout_gate_reasons(
        metrics,
        base_interval=base_interval,
        stress_interval=stress_interval,
    )
    return {
        "baseInterval": base_interval,
        "duplicateNormalization": {
            "count": len(duplicate_rows),
            "rows": list(duplicate_rows),
            "rowsSha256": canonical_sha(list(duplicate_rows)),
        },
        "gates": {"failed": list(reasons), "passed": not reasons},
        "metrics": metrics,
        "schema": "VG30HoldoutResultV1",
        "status": "MEASURED",
        "stressInterval": stress_interval,
        "trialId": champion.trial_id,
        "window": {
            "endInclusive": "2026-06-30",
            "scheduledSundays": [item.isoformat() for item in sundays],
            "startInclusive": "2026-03-01",
        },
    }


def limitations() -> list[str]:
    return [
        "ACCOUNT_EFFECTIVE_FEES_UNKNOWN",
        "HISTORICAL_SPREAD_UNMEASURED",
        "HISTORICAL_ORDER_BOOK_DEPTH_UNMEASURED",
        "HISTORICAL_MARKET_IMPACT_UNMEASURED",
        "INTRAWEEK_DRAWDOWN_PATH_UNMEASURED",
        "HISTORICAL_FILTER_AND_FRACTIONAL_EXECUTABILITY_UNMEASURED",
        "FILL_PROBABILITY_AND_LATENCY_UNMEASURED",
        "EXECUTABLE_CAPACITY_UNMEASURED_PUBLIC_QUOTE_VOLUME_PROXY_ONLY",
        "ARCHIVE_DISCOVERY_IS_NOT_SURVIVOR_FREE_OR_POINT_IN_TIME_EXCHANGEINFO",
        "RETROSPECTIVE_PUBLIC_HOLDOUT_IS_NOT_FRESH_FORWARD_OPERATION",
        "GLOBAL_VG1_THROUGH_VG30_SEARCH_MULTIPLICITY_NOT_RESOLVED",
        "ONE_RUN_CUSTODY_IS_PACKET_LINEAGE_PLUS_FIXED_LOCAL_STATE_NOT_A_DISTRIBUTED_LOCK",
        "GLOBAL_POSITIVE_EDGE_CAPITAL_AND_EXECUTION_AUTHORITY_NONE",
    ]


def result_envelope(
    *,
    verdict: str,
    development: Mapping[str, Any] | None,
    holdout: Mapping[str, Any] | None,
    candidate_sealed: bool,
    holdout_opened: bool,
    reason: str | None = None,
) -> dict[str, object]:
    if verdict not in {"GO", "NO_GO", "UNMEASURED"}:
        raise VG30Error("terminal verdict is invalid")
    result: dict[str, object] = {
        "accountEffectiveFees": None,
        "authority": dict(AUTHORITY_CONTRACT),
        "bodyConsumptionSha256": sha256_path(BODY_CONSUMPTION_PATH),
        "candidateSealed": candidate_sealed,
        "capitalAuthority": "NONE",
        "completedAtUtc": utc_now(),
        "consumer": "N3 successor/final convergence",
        "developmentResultSha256": (
            sha256_path(DEVELOPMENT_RESULT_PATH) if lexists(DEVELOPMENT_RESULT_PATH) else None
        ),
        "executableCapacity": None,
        "executionAuthority": "NONE",
        "freezeSha256": sha256_path(FREEZE_PATH),
        "globalPositiveEdgeAuthority": "NONE",
        "holdoutOpened": holdout_opened,
        "holdoutResultSha256": (
            sha256_path(HOLDOUT_RESULT_PATH) if lexists(HOLDOUT_RESULT_PATH) else None
        ),
        "limitations": limitations(),
        "markerSha256": sha256_path(RUN_MARKER_PATH),
        "moneyEffectUsdt": "0",
        "protocolSha256": sha256_path(PROTOCOL_PATH),
        "publicScenarioScope": "PUBLIC_SCENARIO_ONLY",
        "publicScenarioVerdict": verdict,
        "reason": reason,
        "schema": "VG30TerminalResultV1",
        "sourceManifestSha256": sha256_path(SOURCE_MANIFEST_PATH),
        "trialLedgerSha256": (
            sha256_path(TRIAL_LEDGER_PATH) if lexists(TRIAL_LEDGER_PATH) else None
        ),
    }
    if development is not None:
        result["development"] = {
            "gates": development.get("gates"),
            "pbo": development.get("pbo"),
            "selectedChampionTrialId": development.get("selectedChampionTrialId"),
            "status": development.get("status"),
        }
    else:
        result["development"] = None
    if holdout is not None:
        result["holdout"] = {
            "gates": holdout.get("gates"),
            "status": holdout.get("status"),
            "trialId": holdout.get("trialId"),
        }
    else:
        result["holdout"] = None
    return result


def unmeasured_ledger(reason: str) -> dict[str, object]:
    rows = [
        {
            **trial_mapping(trial),
            "failedGates": [],
            "reason": reason,
            "status": "UNMEASURED",
        }
        for trial in trial_grid()
    ]
    return {
        "familySize": 6,
        "rows": rows,
        "rowsSha256": canonical_sha(rows),
        "schema": "VG30TrialLedgerV1",
        "status": "COMPLETE_SIX_TRIAL_LEDGER_UNMEASURED",
    }


def unmeasured_development(reason: str, *, holdout_opened: bool) -> dict[str, object]:
    return {
        "gates": {"failed": ["MEASUREMENT_UNAVAILABLE"], "passed": False},
        "holdoutArchiveBodiesOpened": holdout_opened,
        "pbo": {
            "blockCount": 8,
            "pbo": None,
            "reason": "DEVELOPMENT_UNMEASURED",
            "splitCount": 0,
            "status": "UNDEFINED",
        },
        "reason": reason,
        "schema": "VG30DevelopmentResultV1",
        "selectedChampionTrialId": None,
        "status": "UNMEASURED",
        "trialLedgerSha256": (
            sha256_path(TRIAL_LEDGER_PATH) if lexists(TRIAL_LEDGER_PATH) else None
        ),
    }


def terminal_expected_names(result: Mapping[str, Any]) -> tuple[str, ...]:
    expected = set(STATIC_FILES) | set(FREEZE_FILES) | set(MARKER_FILES) | set(CONSUMPTION_FILES)
    expected |= set(DEVELOPMENT_FILES) | set(TERMINAL_FILES)
    candidate_sealed = result.get("candidateSealed")
    holdout_opened = result.get("holdoutOpened")
    if not isinstance(candidate_sealed, bool) or not isinstance(holdout_opened, bool):
        raise CustodyError("terminal lifecycle booleans are invalid")
    if candidate_sealed:
        expected.add("candidate.v1.json")
    if holdout_opened:
        if not candidate_sealed:
            raise CustodyError("holdout cannot open without a candidate")
        expected.update(("holdout-open.v1.json", "holdout-result.v1.json"))
    return tuple(sorted(expected))


def holdout_open_authorized(development: Mapping[str, Any]) -> bool:
    gates = development.get("gates")
    return (
        development.get("status") == "MEASURED"
        and isinstance(gates, dict)
        and gates.get("passed") is True
        and gates.get("failed") == []
        and isinstance(development.get("selectedChampionTrialId"), str)
    )


def actual_packet_names(packet: Path = PACKET) -> tuple[str, ...]:
    names: list[str] = []
    for path in packet.iterdir():
        details = path.lstat()
        if stat.S_ISLNK(details.st_mode):
            raise CustodyError(f"packet contains a symlink: {path.name}")
        if not stat.S_ISREG(details.st_mode):
            raise CustodyError(f"packet contains an invalid entry: {path.name}")
        if path.name != "SHA256SUMS":
            names.append(path.name)
    return tuple(sorted(names))


def write_checksums_once(result: Mapping[str, Any]) -> None:
    expected = terminal_expected_names(result)
    if actual_packet_names() != expected:
        raise CustodyError("terminal packet file inventory is not exact")
    lines = [f"{sha256_path(PACKET / name)}  {name}\n" for name in expected]
    write_exclusive(SHA256SUMS_PATH, "".join(lines).encode("ascii"))


def verify_checksums(
    *,
    packet: Path = PACKET,
    expected_names: Sequence[str],
) -> None:
    checksum_path = safe_regular(packet / "SHA256SUMS")
    try:
        lines = checksum_path.read_text(encoding="ascii").splitlines()
    except UnicodeDecodeError as error:
        raise CustodyError("SHA256SUMS is not ASCII") from error
    expected = tuple(sorted(expected_names))
    found: list[str] = []
    for line in lines:
        match = re.fullmatch(r"([0-9a-f]{64})  ([A-Za-z0-9_.-]+)", line)
        if match is None:
            raise CustodyError("SHA256SUMS line is malformed")
        digest, name = match.groups()
        if name == "SHA256SUMS" or "/" in name or name in found:
            raise CustodyError("SHA256SUMS contains invalid or duplicate name")
        if sha256_path(safe_regular(packet / name)) != digest:
            raise CustodyError(f"checksum mismatch: {name}")
        found.append(name)
    if tuple(found) != expected:
        raise CustodyError("SHA256SUMS exact file set drifted")
    if actual_packet_names(packet) != expected:
        raise CustodyError("terminal directory inventory drifted")


def _candidate_receipt(
    development: Mapping[str, Any],
    ledger: Mapping[str, Any],
) -> dict[str, object]:
    champion_id = require_text(
        development.get("selectedChampionTrialId"),
        "selectedChampionTrialId",
    )
    gates = development.get("gates")
    if not isinstance(gates, dict) or gates.get("passed") is not True:
        raise CustodyError("failed development cannot seal a candidate")
    return {
        "createdAtUtc": utc_now(),
        "developmentGates": gates,
        "developmentResultSha256": sha256_path(DEVELOPMENT_RESULT_PATH),
        "freezeSha256": sha256_path(FREEZE_PATH),
        "holdoutArchiveBodiesOpened": False,
        "schema": "VG30CandidateV1",
        "state": "ONE_CHAMPION_LOCKED_NO_RETUNING_OR_RUNNER_UP",
        "trialId": champion_id,
        "trialLedgerSha256": sha256_path(TRIAL_LEDGER_PATH),
        "trialParameters": trial_mapping(trial_from_id(champion_id)),
        "trialRowsDigest": ledger.get("rowsSha256"),
    }


def _holdout_open_receipt(candidate: Mapping[str, Any]) -> dict[str, object]:
    return {
        "candidateSha256": sha256_path(CANDIDATE_PATH),
        "developmentResultSha256": sha256_path(DEVELOPMENT_RESULT_PATH),
        "freezeSha256": sha256_path(FREEZE_PATH),
        "openedAtUtc": utc_now(),
        "ordinal": 1,
        "schema": "VG30HoldoutOpenV1",
        "state": "SOLE_MARCH_THROUGH_JUNE_HOLDOUT_OPEN_CONSUMED",
        "trialId": candidate.get("trialId"),
    }


def command_run(
    _args: argparse.Namespace,
    *,
    replicates: int = BOOTSTRAP_REPLICATES,
) -> dict[str, object]:
    if any(
        lexists(PACKET / name)
        for name in (
            *CONSUMPTION_FILES,
            *DEVELOPMENT_FILES,
            *HOLDOUT_FILES,
            *TERMINAL_FILES,
            "SHA256SUMS",
        )
    ):
        raise CustodyError("outcome files already exist")
    require_clean_pushed_head()
    ensure_scoped_linear_history()
    require_exact_repo_files((*STATIC_FILES, *FREEZE_FILES, *MARKER_FILES))
    _marker, marker_commit = validate_marker(require_head=True)
    source_manifest = validate_source_manifest(authenticate_files=True)
    consume_run_state(marker_commit)

    development: dict[str, Any] | None = None
    ledger: dict[str, Any] | None = None
    holdout: dict[str, Any] | None = None
    candidate_sealed = False
    holdout_opened = False
    try:
        development_bars, development_duplicates = load_bars(
            source_manifest,
            DEVELOPMENT_SOURCE_MONTHS,
        )
        development_raw, ledger_raw = analyze_development(
            development_bars,
            development_duplicates,
            replicates=replicates,
        )
        development = cast(dict[str, Any], development_raw)
        ledger = cast(dict[str, Any], ledger_raw)
        write_json_exclusive(TRIAL_LEDGER_PATH, ledger)
        if development.get("trialLedgerSha256") != sha256_path(TRIAL_LEDGER_PATH):
            raise CustodyError("development trial-ledger binding drifted")
        write_json_exclusive(DEVELOPMENT_RESULT_PATH, development)
        gates = development.get("gates")
        if not isinstance(gates, dict):
            raise MeasurementError("development gates are absent")
        if not holdout_open_authorized(development):
            result = result_envelope(
                verdict="NO_GO",
                development=development,
                holdout=None,
                candidate_sealed=False,
                holdout_opened=False,
                reason="ONE_OR_MORE_FROZEN_DEVELOPMENT_GATES_FAILED",
            )
            write_json_exclusive(RESULT_PATH, result)
            write_checksums_once(result)
            return result

        candidate = _candidate_receipt(development, ledger)
        write_json_exclusive(CANDIDATE_PATH, candidate)
        candidate_sealed = True
        holdout_marker = _holdout_open_receipt(candidate)
        write_json_exclusive(HOLDOUT_OPEN_PATH, holdout_marker, mode=0o600)
        holdout_opened = True
        holdout_bars, holdout_duplicates = load_bars(
            source_manifest,
            HOLDOUT_SOURCE_MONTHS,
            existing=development_bars,
        )
        champion = trial_from_id(require_text(candidate.get("trialId"), "candidate.trialId"))
        holdout_raw = analyze_holdout(
            holdout_bars,
            champion,
            (*development_duplicates, *holdout_duplicates),
            replicates=replicates,
        )
        holdout = cast(dict[str, Any], holdout_raw)
        write_json_exclusive(HOLDOUT_RESULT_PATH, holdout)
        holdout_gates = holdout.get("gates")
        if not isinstance(holdout_gates, dict):
            raise MeasurementError("holdout gates are absent")
        verdict = "GO" if holdout_gates.get("passed") is True else "NO_GO"
        result = result_envelope(
            verdict=verdict,
            development=development,
            holdout=holdout,
            candidate_sealed=True,
            holdout_opened=True,
            reason=(
                "ALL_PUBLIC_SCENARIO_GATES_PASSED"
                if verdict == "GO"
                else "ONE_OR_MORE_FROZEN_HOLDOUT_GATES_FAILED"
            ),
        )
        write_json_exclusive(RESULT_PATH, result)
        write_checksums_once(result)
        return result
    except Exception as error:
        reason = f"{type(error).__name__}:{error}"
        if ledger is None:
            ledger = cast(dict[str, Any], unmeasured_ledger(reason))
            if not lexists(TRIAL_LEDGER_PATH):
                write_json_exclusive(TRIAL_LEDGER_PATH, ledger)
        if development is None:
            development = cast(
                dict[str, Any],
                unmeasured_development(reason, holdout_opened=holdout_opened),
            )
            development["trialLedgerSha256"] = sha256_path(TRIAL_LEDGER_PATH)
            if not lexists(DEVELOPMENT_RESULT_PATH):
                write_json_exclusive(DEVELOPMENT_RESULT_PATH, development)
        if holdout_opened and holdout is None and not lexists(HOLDOUT_RESULT_PATH):
            holdout = {
                "gates": {"failed": ["MEASUREMENT_UNAVAILABLE"], "passed": False},
                "reason": reason,
                "schema": "VG30HoldoutResultV1",
                "status": "UNMEASURED",
                "trialId": (
                    development.get("selectedChampionTrialId") if development is not None else None
                ),
            }
            write_json_exclusive(HOLDOUT_RESULT_PATH, holdout)
        result = result_envelope(
            verdict="UNMEASURED",
            development=development,
            holdout=holdout,
            candidate_sealed=candidate_sealed,
            holdout_opened=holdout_opened,
            reason=reason,
        )
        if not lexists(RESULT_PATH):
            write_json_exclusive(RESULT_PATH, result)
        write_checksums_once(result)
        return result


def _validated_gate_state(payload: Mapping[str, Any], field: str) -> bool:
    gates = payload.get("gates")
    if not isinstance(gates, dict):
        raise CustodyError(f"{field} gates are absent")
    passed = gates.get("passed")
    failed = gates.get("failed")
    if (
        not isinstance(passed, bool)
        or not isinstance(failed, list)
        or not all(isinstance(item, str) for item in failed)
    ):
        raise CustodyError(f"{field} gate state is malformed")
    if passed != (failed == []):
        raise CustodyError(f"{field} gate state is contradictory")
    return passed


def verify_verdict_semantics(
    result: Mapping[str, Any],
    development: Mapping[str, Any],
    holdout: Mapping[str, Any] | None,
) -> None:
    development_summary = result.get("development")
    expected_development_summary = {
        "gates": development.get("gates"),
        "pbo": development.get("pbo"),
        "selectedChampionTrialId": development.get("selectedChampionTrialId"),
        "status": development.get("status"),
    }
    if development_summary != expected_development_summary:
        raise CustodyError("terminal development summary drifted")
    expected_holdout_summary = (
        {
            "gates": holdout.get("gates"),
            "status": holdout.get("status"),
            "trialId": holdout.get("trialId"),
        }
        if holdout is not None
        else None
    )
    if result.get("holdout") != expected_holdout_summary:
        raise CustodyError("terminal holdout summary drifted")

    candidate_sealed = result.get("candidateSealed")
    holdout_opened = result.get("holdoutOpened")
    if not isinstance(candidate_sealed, bool) or not isinstance(holdout_opened, bool):
        raise CustodyError("terminal lifecycle booleans are malformed")
    development_passed = _validated_gate_state(development, "development")
    development_measured = development.get("status") == "MEASURED"
    if candidate_sealed and not (development_measured and development_passed):
        raise CustodyError("candidate exists without passed measured development")
    if holdout_opened and not candidate_sealed:
        raise CustodyError("holdout opened without candidate")
    holdout_passed = _validated_gate_state(holdout, "holdout") if holdout is not None else None
    holdout_measured = holdout is not None and holdout.get("status") == "MEASURED"

    verdict = result.get("publicScenarioVerdict")
    if verdict == "GO":
        valid = (
            development_measured
            and development_passed
            and candidate_sealed
            and holdout_opened
            and holdout_measured
            and holdout_passed is True
        )
    elif verdict == "NO_GO":
        valid_development_stop = (
            development_measured
            and not development_passed
            and not candidate_sealed
            and not holdout_opened
            and holdout is None
        )
        valid_holdout_stop = (
            development_measured
            and development_passed
            and candidate_sealed
            and holdout_opened
            and holdout_measured
            and holdout_passed is False
        )
        valid = valid_development_stop or valid_holdout_stop
    elif verdict == "UNMEASURED":
        valid = isinstance(result.get("reason"), str) and bool(result.get("reason"))
    else:
        raise CustodyError("terminal verdict is invalid")
    if not valid:
        raise CustodyError("terminal verdict contradicts lifecycle and gate state")


def command_verify(_args: argparse.Namespace) -> dict[str, object]:
    result, result_raw = load_json(RESULT_PATH, canonical=True)
    if result.get("schema") != "VG30TerminalResultV1":
        raise CustodyError("terminal result schema drifted")
    if (
        result.get("authority") != AUTHORITY_CONTRACT
        or result.get("moneyEffectUsdt") != "0"
        or result.get("capitalAuthority") != "NONE"
        or result.get("executionAuthority") != "NONE"
        or result.get("globalPositiveEdgeAuthority") != "NONE"
    ):
        raise CustodyError("terminal authority widened")
    expected = terminal_expected_names(result)
    verify_checksums(packet=PACKET, expected_names=expected)
    freeze = validate_freeze()
    source_manifest = validate_source_manifest(authenticate_files=False)
    marker, marker_commit = validate_marker(require_head=False)
    consumption = validate_consumption(marker_commit)
    development, development_raw = load_json(DEVELOPMENT_RESULT_PATH, canonical=True)
    ledger, ledger_raw = load_json(TRIAL_LEDGER_PATH, canonical=True)
    if (
        result.get("protocolSha256") != sha256_path(PROTOCOL_PATH)
        or result.get("freezeSha256") != sha256_path(FREEZE_PATH)
        or result.get("sourceManifestSha256") != sha256_path(SOURCE_MANIFEST_PATH)
        or result.get("markerSha256") != sha256_path(RUN_MARKER_PATH)
        or result.get("bodyConsumptionSha256") != sha256_path(BODY_CONSUMPTION_PATH)
        or result.get("developmentResultSha256") != sha256_bytes(development_raw)
        or result.get("trialLedgerSha256") != sha256_bytes(ledger_raw)
    ):
        raise CustodyError("terminal byte bindings drifted")
    if (
        freeze.get("sourceManifestSha256") != sha256_path(SOURCE_MANIFEST_PATH)
        or source_manifest.get("protocolSha256") != sha256_path(PROTOCOL_PATH)
        or marker.get("freezeSha256") != sha256_path(FREEZE_PATH)
    ):
        raise CustodyError("freeze/manifest/marker chain drifted")
    raw_rows = ledger.get("rows")
    if (
        ledger.get("schema") != "VG30TrialLedgerV1"
        or ledger.get("familySize") != 6
        or not isinstance(raw_rows, list)
        or len(raw_rows) != 6
        or ledger.get("rowsSha256") != canonical_sha(raw_rows)
    ):
        raise CustodyError("terminal trial ledger is not complete")
    if development.get("trialLedgerSha256") != sha256_bytes(ledger_raw):
        raise CustodyError("development does not bind exact trial ledger")
    holdout: dict[str, Any] | None = None
    if result.get("candidateSealed") is True:
        candidate, candidate_raw = load_json(CANDIDATE_PATH, canonical=True)
        if (
            candidate.get("schema") != "VG30CandidateV1"
            or candidate.get("developmentResultSha256") != sha256_bytes(development_raw)
            or candidate.get("trialId") != development.get("selectedChampionTrialId")
        ):
            raise CustodyError("candidate development binding drifted")
        if result.get("holdoutOpened") is True:
            holdout_open, _ = load_json(HOLDOUT_OPEN_PATH, canonical=True)
            holdout, holdout_raw = load_json(HOLDOUT_RESULT_PATH, canonical=True)
            if (
                holdout_open.get("schema") != "VG30HoldoutOpenV1"
                or holdout_open.get("ordinal") != 1
                or holdout_open.get("candidateSha256") != sha256_bytes(candidate_raw)
                or holdout_open.get("developmentResultSha256") != sha256_bytes(development_raw)
                or stat.S_IMODE(HOLDOUT_OPEN_PATH.stat().st_mode) != 0o600
            ):
                raise CustodyError("holdout-open candidate binding drifted")
            if result.get("holdoutResultSha256") != sha256_bytes(holdout_raw):
                raise CustodyError("terminal holdout binding drifted")
            if holdout.get("trialId") != candidate.get("trialId"):
                raise CustodyError("holdout trial differs from candidate")
    verify_verdict_semantics(result, development, holdout)
    return {
        "archiveBodiesOpened": False,
        "bodyConsumptionOrdinal": consumption.get("ordinal"),
        "economicsRecomputed": False,
        "packetFileCount": len(expected) + 1,
        "resultSha256": sha256_bytes(result_raw),
        "schema": "VG30VerificationV1",
        "status": "PASS_EXACT_PACKET_ONLY",
        "verdict": result.get("publicScenarioVerdict"),
    }


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("freeze", "mark", "run", "verify"))
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        if args.command == "freeze":
            payload = command_freeze(args)
        elif args.command == "mark":
            payload = command_mark(args)
        elif args.command == "run":
            payload = command_run(args)
        else:
            payload = command_verify(args)
        print(json.dumps(payload, sort_keys=True, indent=2))
    except VG30Error as error:
        print(f"V-G30 REFUSED: {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
