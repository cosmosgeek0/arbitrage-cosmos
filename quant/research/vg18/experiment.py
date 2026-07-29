#!/usr/bin/env python3
"""Sealed public-only V-G18 lagged trade-size-skew experiment.

The evaluator separates compressed-source authentication, commit-bound protocol
freeze, one development opening, optional one holdout opening, and network-free
verification. It never reads credentials, private account state, order endpoints,
or host state.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import os
import re
import stat
import subprocess
import sys
import zipfile
from collections import Counter, defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal, InvalidOperation, getcontext
from fractions import Fraction
from pathlib import Path
from typing import Any, Final, cast

from quant_edge.labels.rational import ExactRatioV1, make_ratio
from quant_edge.randomness import DeterministicRandom
from quant_edge.validation.bootstrap import (
    BootstrapSpecV1,
    block_bootstrap_interval,
)
from quant_edge.validation.multiplicity import (
    TrialLedgerV1,
    TrialRecordV1,
    TrialStatus,
    holm_bonferroni,
    pbo_cscv,
)

getcontext().prec = 50

D = Decimal
HERE: Final = Path(__file__).resolve().parent
QUANT_ROOT: Final = HERE.parents[1]
REPO_ROOT: Final = HERE.parents[2]
STATE_ROOT: Final = Path("/private/tmp/cosmos-vg18-trade-size-skew-1be1-4712-state")
SOURCE_ROOT: Final = Path("/private/tmp/cosmos-s1f-weekly-momentum-cash-v1")
BASE_COMMIT: Final = "a169b123fb186d1943a75ad648552c4d95be1be1"

PROTOCOL_PATH: Final = HERE / "protocol.v1.json"
SOURCE_PLAN_PATH: Final = HERE / "source-plan.v1.json"
SOURCE_RESEARCH_PATH: Final = HERE / "OFFICIAL_SOURCE_RESEARCH.md"
TRIAL_LEDGER_PATH: Final = HERE / "trial-ledger.v1.json"
SOURCE_MANIFEST_PATH: Final = HERE / "source-manifest.v1.json"
FREEZE_PATH: Final = HERE / "freeze.v1.json"
RUN_MARKER_PATH: Final = HERE / "run-marker.v1.json"
DEVELOPMENT_RESULT_PATH: Final = HERE / "development-result.v1.json"
CANDIDATE_SEAL_PATH: Final = HERE / "candidate-seal.v1.json"
HOLDOUT_OPEN_PATH: Final = HERE / "holdout-open.v1.json"
HOLDOUT_RESULT_PATH: Final = HERE / "holdout-result.v1.json"
RESULT_PATH: Final = HERE / "result.v1.json"
SHA256SUMS_PATH: Final = HERE / "SHA256SUMS"

STATIC_FILES: Final = (
    "OFFICIAL_SOURCE_RESEARCH.md",
    "README.md",
    "__init__.py",
    "experiment.py",
    "protocol.v1.json",
    "source-manifest.v1.json",
    "source-plan.v1.json",
    "test_experiment.py",
    "trial-ledger.v1.json",
)
GENERATED_FILES: Final = (
    "candidate-seal.v1.json",
    "development-result.v1.json",
    "freeze.v1.json",
    "holdout-open.v1.json",
    "holdout-result.v1.json",
    "result.v1.json",
    "run-marker.v1.json",
)

SOURCE_MONTHS: Final = tuple(
    f"{year:04d}-{month:02d}"
    for year, first, last in ((2025, 1, 12), (2026, 1, 6))
    for month in range(first, last + 1)
)
DEVELOPMENT_SOURCE_MONTHS: Final = tuple(
    f"{year:04d}-{month:02d}"
    for year, first, last in ((2025, 1, 12), (2026, 1, 2))
    for month in range(first, last + 1)
)
HOLDOUT_SOURCE_MONTHS: Final = tuple(
    f"{year:04d}-{month:02d}"
    for year, first, last in ((2025, 11, 12), (2026, 1, 6))
    for month in range(first, last + 1)
)
DEVELOPMENT_SIGNAL_START: Final = date(2025, 7, 1)
DEVELOPMENT_SIGNAL_END: Final = date(2026, 2, 20)
HOLDOUT_SIGNAL_START: Final = date(2026, 3, 1)
HOLDOUT_SIGNAL_END: Final = date(2026, 6, 22)

DAY_US: Final = 86_400_000_000
USD_1000: Final = D("1000")
MEAN_NOTIONAL_LOOKBACK: Final = 120
LIQUIDITY_LOOKBACK: Final = 30
MIN_MEDIAN_QUOTE_VOLUME: Final = D("10000000")
MIN_ELIGIBLE_SYMBOLS: Final = 30
MAX_HOLD_DAYS: Final = 7
BASE_CAPACITY_PARTICIPATION: Final = D("0.0001")
STRESS_CAPACITY_PARTICIPATION: Final = D("0.00005")

BOOTSTRAP_SEED: Final = 2_026_072_918
BOOTSTRAP_REPLICATES: Final = 4_096
BOOTSTRAP_BLOCK_DAYS: Final = 7
ONE_SIDED_95_TWO_SIDED_COVERAGE: Final = 9_000
BONFERRONI_TWO_SIDED_COVERAGE: Final = 9_917
HOLM_ALPHA_PER_MYRIAD: Final = 500

SCENARIOS: Final = {
    "gross": (D("0"), D("0")),
    "publicFeeOnly": (D("0.0010"), D("0")),
    "baseProxy": (D("0.0010"), D("0.0005")),
    "stressProxy": (D("0.0020"), D("0.0015")),
}

SOURCE_PINS: Final = {
    "acquisition-manifest.v1.json": (
        7_814_495,
        "01f58272602e43bfb914b649adc00d8273b2d423492220a55f86443bb6441176",
    ),
    "discovery.v1.json": (
        4_337_787,
        "b4a8f7abd36df19eff0510dfcc3c61fd0df9fdcab5f4d248892ee10010fb21c3",
    ),
    "run-marker.v1.json": (
        618,
        "7160455ebb695bbf27f899c9a64aa71d50d2ecc9786fe7fefa4067b37c446489",
    ),
}

EXCLUDED_BASE_ASSETS: Final = frozenset(
    {
        "AEUR",
        "AUD",
        "BFUSD",
        "BIDR",
        "BKRW",
        "BRL",
        "BUSD",
        "DAI",
        "EUR",
        "EURI",
        "FDUSD",
        "FRAX",
        "GBP",
        "IDRT",
        "NGN",
        "PAX",
        "RLUSD",
        "RUB",
        "SUSD",
        "TUSD",
        "UAH",
        "USD1",
        "USDC",
        "USDE",
        "USDP",
        "USDS",
        "USDSOLD",
        "UST",
        "USTC",
        "VAI",
        "XUSD",
    }
)
EXCLUDED_LEVERAGED_SUFFIXES: Final = ("BEAR", "BULL", "DOWN", "UP")
SYMBOL_RE: Final = re.compile(r"^[A-Z0-9]+USDT$")
SHA_RE: Final = re.compile(r"^[0-9a-f]{64}$")
CHECKSUM_RE: Final = re.compile(r"^([0-9a-f]{64})[ \t]+\*?([^\r\n]+)[\r\n]*$")
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


class VG18Error(RuntimeError):
    """Protocol, custody, lifecycle, or semantic failure."""


class TerminalMeasurementError(VG18Error):
    """A consumed-run source or measurement failure that must seal UNMEASURED."""


@dataclass(frozen=True, slots=True)
class Trial:
    trial_id: str
    cohort_size: int
    shock_floor: Decimal
    hold_days: int


@dataclass(frozen=True, slots=True)
class Bar:
    symbol: str
    day: date
    open_price: Decimal
    quote_volume: Decimal
    trade_count: int
    row_digest: str


@dataclass(frozen=True, slots=True)
class SourceAnomaly:
    symbol: str
    day: date
    kind: str
    raw_digest: str
    row_count: int


@dataclass(frozen=True, slots=True)
class Candidate:
    symbol: str
    shock_multiple: Decimal
    mean_notional: Decimal
    baseline_mean_notional: Decimal
    trailing_median_quote_volume: Decimal


@dataclass(frozen=True, slots=True)
class CohortDecision:
    signal_day: date
    entry_day: date
    exit_day: date
    state: str
    reason: str
    eligible_symbol_count: int
    candidates: tuple[Candidate, ...]
    selected: tuple[Candidate, ...]
    stress_capacity_proxy_usd: Decimal | None


@dataclass(slots=True)
class Position:
    symbols: tuple[str, ...]
    quantities: dict[str, Decimal]
    exit_day: date


@dataclass(slots=True)
class Sleeve:
    cash: Decimal
    position: Position | None = None


@dataclass(frozen=True, slots=True)
class ScenarioSimulation:
    dates: tuple[date, ...]
    daily_returns: tuple[Decimal, ...]
    nav_values: tuple[Decimal, ...]
    final_nav: Decimal


@dataclass(frozen=True, slots=True)
class TrialSimulation:
    trial: Trial
    decisions: tuple[CohortDecision, ...]
    scenarios: Mapping[str, ScenarioSimulation]


def canonical_bytes(value: object) -> bytes:
    return (
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n"
    ).encode("utf-8")


def sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def lexists(path: Path) -> bool:
    return os.path.lexists(os.fspath(path))


def safe_regular(path: Path) -> Path:
    if path.is_symlink():
        raise VG18Error(f"symlink refused: {path}")
    try:
        mode = path.stat().st_mode
    except FileNotFoundError as error:
        raise VG18Error(f"required file missing: {path}") from error
    if not stat.S_ISREG(mode):
        raise VG18Error(f"regular file required: {path}")
    return path


def sha256_path(path: Path) -> str:
    return sha256_bytes(safe_regular(path).read_bytes())


def load_json(path: Path, *, canonical: bool = False) -> tuple[dict[str, Any], bytes]:
    raw = safe_regular(path).read_bytes()
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as error:
        raise VG18Error(f"invalid JSON: {path}") from error
    if not isinstance(value, dict):
        raise VG18Error(f"JSON root must be an object: {path}")
    result = cast(dict[str, Any], value)
    if canonical and raw != canonical_bytes(result):
        raise VG18Error(f"JSON is not canonical sorted compact bytes: {path}")
    return result, raw


def require_text(value: object, field: str) -> str:
    if not isinstance(value, str) or not value:
        raise VG18Error(f"{field} must be nonempty text")
    return value


def require_int(value: object, field: str, *, minimum: int = 0) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise VG18Error(f"{field} must be an integer >= {minimum}")
    return value


def require_bool(value: object, field: str) -> bool:
    if not isinstance(value, bool):
        raise VG18Error(f"{field} must be boolean")
    return value


def decimal_value(value: object, field: str) -> Decimal:
    if not isinstance(value, str):
        raise VG18Error(f"{field} must be an exact decimal string")
    try:
        parsed = D(value)
    except InvalidOperation as error:
        raise VG18Error(f"{field} is not an exact decimal") from error
    if not parsed.is_finite():
        raise VG18Error(f"{field} must be finite")
    return parsed


def decimal_text(value: Decimal) -> str:
    if not value.is_finite():
        raise VG18Error("non-finite decimal cannot be serialized")
    if value == 0:
        return "0"
    return format(value.normalize(), "f")


def iso_date(value: object, field: str) -> date:
    text = require_text(value, field)
    try:
        return date.fromisoformat(text)
    except ValueError as error:
        raise VG18Error(f"{field} must be an ISO date") from error


def utc_now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def fsync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def exclusive_write(path: Path, raw: bytes, *, mode: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if lexists(path):
        raise VG18Error(f"create-once path already exists: {path}")
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
    try:
        written = 0
        while written < len(raw):
            written += os.write(descriptor, raw[written:])
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    fsync_directory(path.parent)


def atomic_write(path: Path, raw: bytes, *, mode: int = 0o644) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp-{os.getpid()}")
    if lexists(temporary):
        raise VG18Error(f"temporary path already exists: {temporary}")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
    try:
        written = 0
        while written < len(raw):
            written += os.write(descriptor, raw[written:])
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    os.replace(temporary, path)
    fsync_directory(path.parent)


def emit_json_once(path: Path, value: object, *, mode: int = 0o644) -> str:
    raw = canonical_bytes(value)
    exclusive_write(path, raw, mode=mode)
    return sha256_bytes(raw)


def emit_json_atomic(path: Path, value: object, *, mode: int = 0o644) -> str:
    raw = canonical_bytes(value)
    atomic_write(path, raw, mode=mode)
    return sha256_bytes(raw)


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
    value = git_output("rev-parse", "HEAD")
    if not re.fullmatch(r"[0-9a-f]{40}", value):
        raise VG18Error("git HEAD is not a full commit")
    return value


def require_clean_git() -> None:
    if git_output("status", "--porcelain") != "":
        raise VG18Error("worktree must be clean")


def require_pushed_head() -> None:
    head = git_head()
    try:
        upstream = git_output("rev-parse", "@{upstream}")
        upstream_name = git_output(
            "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"
        )
    except subprocess.CalledProcessError as error:
        raise VG18Error("branch upstream is not configured") from error
    if not upstream_name.startswith("origin/"):
        raise VG18Error("branch upstream must be an origin remote-tracking ref")
    if upstream != head:
        raise VG18Error("current HEAD must be pushed before lifecycle mutation")


def changed_paths(old: str, new: str) -> tuple[str, ...]:
    raw = git_output("diff", "--name-only", f"{old}..{new}")
    return tuple(line for line in raw.splitlines() if line)


def ensure_scoped_history() -> None:
    if git_output("merge-base", BASE_COMMIT, "HEAD") != BASE_COMMIT:
        raise VG18Error("candidate does not descend from the exact base")
    history = git_output("rev-list", "--reverse", "--parents", f"{BASE_COMMIT}..HEAD")
    for row in history.splitlines():
        fields = row.split()
        if len(fields) != 2:
            raise VG18Error("candidate history must be linear and merge-free")
        commit = fields[0]
        raw_paths = git_output("diff-tree", "--no-commit-id", "--name-only", "-r", commit)
        paths = tuple(path for path in raw_paths.splitlines() if path)
        if not paths:
            raise VG18Error("empty candidate commit is forbidden")
        if any(not path.startswith("quant/research/vg18/") for path in paths):
            raise VG18Error(f"candidate commit escaped scope: {commit}")


def relative_repo_path(path: Path) -> str:
    try:
        return str(path.relative_to(REPO_ROOT))
    except ValueError as error:
        raise VG18Error(f"path is outside repository: {path}") from error


def latest_path_commit(path: Path) -> str:
    commit = git_output("rev-list", "-n", "1", "HEAD", "--", relative_repo_path(path))
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise VG18Error(f"path has no committed history: {path.name}")
    return commit


def require_exact_delta(parent: str, child: str, names: Sequence[str]) -> None:
    expected = tuple(sorted(f"quant/research/vg18/{name}" for name in names))
    if tuple(sorted(changed_paths(parent, child))) != expected:
        raise VG18Error(f"commit delta is not exact: {child}")


def date_range(first: date, last: date) -> tuple[date, ...]:
    if last < first:
        return ()
    return tuple(first + timedelta(days=offset) for offset in range((last - first).days + 1))


def month_values(first: str, last: str) -> tuple[str, ...]:
    current = date.fromisoformat(f"{first}-01")
    end = date.fromisoformat(f"{last}-01")
    values: list[str] = []
    while current <= end:
        values.append(current.strftime("%Y-%m"))
        current = (
            date(current.year + 1, 1, 1)
            if current.month == 12
            else date(current.year, current.month + 1, 1)
        )
    return tuple(values)


def median_decimal(values: Sequence[Decimal]) -> Decimal:
    if not values:
        raise VG18Error("median requires at least one value")
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) / D(2)


def mean_decimal(values: Sequence[Decimal]) -> Decimal | None:
    if not values:
        return None
    return sum(values, D(0)) / D(len(values))


def percentile(values: Sequence[Decimal], numerator: int, denominator: int) -> Decimal | None:
    if not values:
        return None
    ordered = sorted(values)
    index = (numerator * len(ordered) + denominator - 1) // denominator - 1
    return ordered[max(0, min(index, len(ordered) - 1))]


def decimal_ratio(value: Decimal) -> ExactRatioV1:
    numerator, denominator = value.as_integer_ratio()
    return make_ratio(numerator, denominator)


def fixed_mapping_to_decimal(mapping: Mapping[str, Any] | None) -> Decimal | None:
    if mapping is None:
        return None
    mantissa = mapping.get("mantissa")
    scale = mapping.get("scale")
    if not isinstance(mantissa, str) or not isinstance(scale, str):
        raise VG18Error("fixed-point mapping is invalid")
    divisor = D(scale)
    if divisor <= 0:
        raise VG18Error("fixed-point scale must be positive")
    return D(mantissa) / divisor


def eligible_symbol(symbol: str) -> bool:
    if SYMBOL_RE.fullmatch(symbol) is None:
        return False
    base = symbol.removesuffix("USDT")
    if base in EXCLUDED_BASE_ASSETS:
        return False
    return not any(base.endswith(suffix) for suffix in EXCLUDED_LEVERAGED_SUFFIXES)


def parse_trials() -> tuple[Trial, ...]:
    payload, _ = load_json(TRIAL_LEDGER_PATH)
    if payload.get("schema") != "VG18TrialLedgerV1" or payload.get("familySize") != 12:
        raise VG18Error("trial ledger schema or family size drifted")
    raw_trials = payload.get("trials")
    if not isinstance(raw_trials, list) or len(raw_trials) != 12:
        raise VG18Error("trial ledger must contain exactly 12 trials")
    trials: list[Trial] = []
    for raw in raw_trials:
        if not isinstance(raw, dict):
            raise VG18Error("trial ledger row is not an object")
        trial = Trial(
            trial_id=require_text(raw.get("trialId"), "trialId"),
            cohort_size=require_int(raw.get("cohortSize"), "cohortSize", minimum=1),
            shock_floor=decimal_value(raw.get("shockFloor"), "shockFloor"),
            hold_days=require_int(raw.get("holdDays"), "holdDays", minimum=1),
        )
        trials.append(trial)
    ids = tuple(trial.trial_id for trial in trials)
    if ids != tuple(sorted(set(ids))):
        raise VG18Error("trial IDs must be sorted and unique")
    expected = {
        (cohort, shock, hold)
        for cohort in (3, 5)
        for shock in (D("1.5"), D("2"), D("3"))
        for hold in (3, 7)
    }
    found = {(trial.cohort_size, trial.shock_floor, trial.hold_days) for trial in trials}
    if found != expected:
        raise VG18Error("trial grid drifted")
    return tuple(trials)


def validate_protocol() -> dict[str, Any]:
    protocol, _ = load_json(PROTOCOL_PATH)
    if protocol.get("schema") != "VG18TradeSizeSkewProtocolV1":
        raise VG18Error("protocol schema drifted")
    if protocol.get("baseCommit") != BASE_COMMIT:
        raise VG18Error("protocol base commit drifted")
    signal = protocol.get("signal")
    if not isinstance(signal, dict):
        raise VG18Error("protocol signal missing")
    if signal.get("metric") != "QUOTE_ASSET_VOLUME_DIV_NUMBER_OF_TRADES":
        raise VG18Error("signal metric drifted")
    if signal.get("priceInputsForSelection") != []:
        raise VG18Error("selection price inputs are forbidden")
    if signal.get("selectedCohortSizes") != [3, 5]:
        raise VG18Error("cohort sizes drifted")
    if signal.get("shockFloors") != ["1.5", "2", "3"]:
        raise VG18Error("shock floors drifted")
    if signal.get("holdingDays") != [3, 7]:
        raise VG18Error("holding days drifted")
    statistics = protocol.get("statistics")
    if not isinstance(statistics, dict) or statistics.get("familySize") != 12:
        raise VG18Error("statistics family size drifted")
    if statistics.get("cscvPbo", {}).get("status") != "DIAGNOSTIC_ONLY":
        raise VG18Error("PBO must remain diagnostic-only")
    run_control = protocol.get("runControl")
    if not isinstance(run_control, dict) or run_control.get("bodyConsumptionReceipt") != (
        "STATE_ONLY_O_CREAT_O_EXCL_0600_IMMEDIATELY_BEFORE_FIRST_ARCHIVE_BODY_OPEN"
    ):
        raise VG18Error("one-run body consumption law drifted")
    truth = protocol.get("truth")
    if not isinstance(truth, dict) or truth.get("capitalDecision") != "NO_GO":
        raise VG18Error("capital decision must remain NO_GO")
    capacity = protocol.get("capacityProxy")
    if (
        not isinstance(capacity, dict)
        or capacity.get("baseParticipationOfPrior30dMedianQuoteVolume") != "0.0001"
        or capacity.get("stressParticipationOfPrior30dMedianQuoteVolume") != "0.00005"
        or capacity.get("executableCapacity") is not None
    ):
        raise VG18Error("capacity proxy contract drifted")
    return protocol


def verify_checksum_text(checksum_bytes: bytes, zip_name: str, zip_sha: str) -> None:
    try:
        text = checksum_bytes.decode("ascii")
    except UnicodeDecodeError as error:
        raise VG18Error("checksum sidecar is not ASCII") from error
    match = CHECKSUM_RE.fullmatch(text)
    if match is None or match.group(1) != zip_sha or match.group(2) != zip_name:
        raise VG18Error(f"checksum sidecar does not bind {zip_name}")


def _source_artifact_path(symbol: str, month: str, suffix: str) -> Path:
    return SOURCE_ROOT / "archives" / symbol / month / f"{symbol}-1d-{month}.{suffix}"


def build_source_manifest() -> dict[str, object]:
    if lexists(SOURCE_MANIFEST_PATH):
        raise VG18Error("source manifest already exists")
    source_plan, _ = load_json(SOURCE_PLAN_PATH)
    if source_plan.get("schema") != "VG18SourcePlanV1":
        raise VG18Error("source plan schema drifted")
    for name, (expected_bytes, expected_sha) in SOURCE_PINS.items():
        path = SOURCE_ROOT / name
        if safe_regular(path).stat().st_size != expected_bytes or sha256_path(path) != expected_sha:
            raise VG18Error(f"shared source pin drifted: {name}")
    acquisition, acquisition_raw = load_json(SOURCE_ROOT / "acquisition-manifest.v1.json")
    if acquisition.get("schema") != "S1FAcquisitionManifestV1":
        raise VG18Error("shared acquisition schema drifted")
    if acquisition.get("archiveBodiesDecompressed") is not False:
        raise VG18Error("shared acquisition manifest opened archive bodies")
    raw_pairs = acquisition.get("artifactPairs")
    if not isinstance(raw_pairs, list):
        raise VG18Error("shared acquisition artifactPairs missing")
    records: list[dict[str, object]] = []
    seen: set[tuple[str, str]] = set()
    for raw in raw_pairs:
        if not isinstance(raw, dict):
            raise VG18Error("shared acquisition row is invalid")
        symbol = require_text(raw.get("symbol"), "symbol")
        month = require_text(raw.get("month"), "month")
        if month not in SOURCE_MONTHS or not eligible_symbol(symbol):
            continue
        identity = (symbol, month)
        if identity in seen:
            raise VG18Error(f"duplicate acquisition identity: {symbol} {month}")
        seen.add(identity)
        zip_path = _source_artifact_path(symbol, month, "zip")
        checksum_path = _source_artifact_path(symbol, month, "zip.CHECKSUM")
        pair_path = zip_path.parent / "pair.v1.json"
        expected_zip_sha = require_text(raw.get("zipSha256"), "zipSha256")
        expected_checksum_sha = require_text(raw.get("checksumSha256"), "checksumSha256")
        if (
            SHA_RE.fullmatch(expected_zip_sha) is None
            or SHA_RE.fullmatch(expected_checksum_sha) is None
        ):
            raise VG18Error("shared acquisition digest is malformed")
        zip_bytes = safe_regular(zip_path).stat().st_size
        checksum_bytes = safe_regular(checksum_path).stat().st_size
        if zip_bytes != require_int(raw.get("zipBytes"), "zipBytes", minimum=1):
            raise VG18Error(f"ZIP byte length drifted: {symbol} {month}")
        if checksum_bytes != require_int(raw.get("checksumBytes"), "checksumBytes", minimum=1):
            raise VG18Error(f"checksum byte length drifted: {symbol} {month}")
        zip_sha = sha256_path(zip_path)
        checksum_sha = sha256_path(checksum_path)
        if zip_sha != expected_zip_sha or checksum_sha != expected_checksum_sha:
            raise VG18Error(f"compressed source digest drifted: {symbol} {month}")
        verify_checksum_text(checksum_path.read_bytes(), zip_path.name, zip_sha)
        pair_bytes = safe_regular(pair_path).stat().st_size
        pair_sha = sha256_path(pair_path)
        records.append(
            {
                "checksumBytes": checksum_bytes,
                "checksumPath": str(checksum_path.relative_to(SOURCE_ROOT)),
                "checksumSha256": checksum_sha,
                "checksumUrl": (
                    "https://data.binance.vision/data/spot/monthly/klines/"
                    f"{symbol}/1d/{checksum_path.name}"
                ),
                "month": month,
                "pairBytes": pair_bytes,
                "pairPath": str(pair_path.relative_to(SOURCE_ROOT)),
                "pairSha256": pair_sha,
                "symbol": symbol,
                "zipBytes": zip_bytes,
                "zipPath": str(zip_path.relative_to(SOURCE_ROOT)),
                "zipSha256": zip_sha,
                "zipUrl": (
                    "https://data.binance.vision/data/spot/monthly/klines/"
                    f"{symbol}/1d/{zip_path.name}"
                ),
            }
        )
    records.sort(key=lambda row: (str(row["symbol"]), str(row["month"])))
    symbols = sorted({str(row["symbol"]) for row in records})
    expected_months = month_values("2025-01", "2026-06")
    if expected_months != SOURCE_MONTHS:
        raise VG18Error("source month constant drifted")
    manifest = {
        "acquisitionManifestBytes": len(acquisition_raw),
        "acquisitionManifestSha256": sha256_bytes(acquisition_raw),
        "archiveBodiesOpened": False,
        "artifactCount": len(records),
        "artifacts": records,
        "monthRange": ["2025-01", "2026-06"],
        "months": list(SOURCE_MONTHS),
        "normalizedArtifactDigest": sha256_bytes(canonical_bytes(records)),
        "schema": "VG18SourceManifestV1",
        "sourceRoot": str(SOURCE_ROOT),
        "symbolCount": len(symbols),
        "symbolSetSha256": sha256_bytes(("\n".join(symbols) + "\n").encode()),
    }
    emit_json_once(SOURCE_MANIFEST_PATH, manifest)
    return manifest


def validate_source_manifest(*, authenticate_files: bool) -> dict[str, Any]:
    manifest, _ = load_json(SOURCE_MANIFEST_PATH, canonical=True)
    if manifest.get("schema") != "VG18SourceManifestV1":
        raise VG18Error("source manifest schema drifted")
    if manifest.get("archiveBodiesOpened") is not False:
        raise VG18Error("source manifest must prove archive bodies unopened")
    if manifest.get("sourceRoot") != str(SOURCE_ROOT):
        raise VG18Error("source root drifted")
    raw_artifacts = manifest.get("artifacts")
    if not isinstance(raw_artifacts, list):
        raise VG18Error("source manifest artifacts missing")
    if manifest.get("artifactCount") != len(raw_artifacts):
        raise VG18Error("source manifest artifact count drifted")
    normalized = sha256_bytes(canonical_bytes(raw_artifacts))
    if manifest.get("normalizedArtifactDigest") != normalized:
        raise VG18Error("source manifest normalized digest drifted")
    identities: set[tuple[str, str]] = set()
    for raw in raw_artifacts:
        if not isinstance(raw, dict):
            raise VG18Error("source manifest artifact is invalid")
        symbol = require_text(raw.get("symbol"), "symbol")
        month = require_text(raw.get("month"), "month")
        if not eligible_symbol(symbol) or month not in SOURCE_MONTHS:
            raise VG18Error("source manifest contains an ineligible identity")
        if (symbol, month) in identities:
            raise VG18Error("source manifest repeats a symbol-month")
        identities.add((symbol, month))
        if authenticate_files:
            for path_field, bytes_field, sha_field in (
                ("zipPath", "zipBytes", "zipSha256"),
                ("checksumPath", "checksumBytes", "checksumSha256"),
                ("pairPath", "pairBytes", "pairSha256"),
            ):
                relative = require_text(raw.get(path_field), path_field)
                path = SOURCE_ROOT / relative
                if path.stat().st_size != require_int(raw.get(bytes_field), bytes_field, minimum=1):
                    raise VG18Error(f"source byte length drifted: {relative}")
                if sha256_path(path) != require_text(raw.get(sha_field), sha_field):
                    raise VG18Error(f"source digest drifted: {relative}")
            checksum_path = SOURCE_ROOT / require_text(raw.get("checksumPath"), "checksumPath")
            zip_path = SOURCE_ROOT / require_text(raw.get("zipPath"), "zipPath")
            verify_checksum_text(
                checksum_path.read_bytes(),
                zip_path.name,
                require_text(raw.get("zipSha256"), "zipSha256"),
            )
    return manifest


def parse_timestamp_us(raw: str, *, field: str) -> tuple[int, datetime]:
    try:
        value = int(raw)
    except ValueError as error:
        raise TerminalMeasurementError(f"{field} is not an integer timestamp") from error
    if value < 1_000_000_000_000_000:
        raise TerminalMeasurementError(f"{field} is not a post-2025 microsecond timestamp")
    seconds, micros = divmod(value, 1_000_000)
    parsed = datetime.fromtimestamp(seconds, tz=UTC) + timedelta(microseconds=micros)
    return value, parsed


def parse_decimal_csv(raw: str, *, field: str, positive: bool) -> Decimal:
    try:
        value = D(raw)
    except InvalidOperation as error:
        raise TerminalMeasurementError(f"{field} is not a decimal") from error
    if not value.is_finite() or (value <= 0 if positive else value < 0):
        qualifier = "positive" if positive else "nonnegative"
        raise TerminalMeasurementError(f"{field} is not {qualifier}")
    return value


def parse_archive(artifact: Mapping[str, Any]) -> tuple[tuple[Bar, ...], tuple[SourceAnomaly, ...]]:
    symbol = require_text(artifact.get("symbol"), "symbol")
    month = require_text(artifact.get("month"), "month")
    zip_path = SOURCE_ROOT / require_text(artifact.get("zipPath"), "zipPath")
    checksum_path = SOURCE_ROOT / require_text(artifact.get("checksumPath"), "checksumPath")
    if sha256_path(zip_path) != require_text(artifact.get("zipSha256"), "zipSha256"):
        raise TerminalMeasurementError(f"ZIP changed after freeze: {symbol} {month}")
    if sha256_path(checksum_path) != require_text(artifact.get("checksumSha256"), "checksumSha256"):
        raise TerminalMeasurementError(f"sidecar changed after freeze: {symbol} {month}")
    verify_checksum_text(
        checksum_path.read_bytes(),
        zip_path.name,
        require_text(artifact.get("zipSha256"), "zipSha256"),
    )
    if zip_path.stat().st_size > 10_000_000:
        raise TerminalMeasurementError(f"ZIP exceeds parser bound: {symbol} {month}")
    rows_by_day: dict[date, list[tuple[tuple[str, ...], Bar]]] = defaultdict(list)
    with zipfile.ZipFile(zip_path) as archive:
        members = archive.infolist()
        if len(members) != 1 or members[0].is_dir():
            raise TerminalMeasurementError(f"ZIP member count invalid: {symbol} {month}")
        member = members[0]
        expected = zip_path.name.removesuffix(".zip") + ".csv"
        if (
            member.filename != expected
            or member.file_size > 20_000_000
            or member.compress_size > 10_000_000
        ):
            raise TerminalMeasurementError(f"ZIP member invalid: {symbol} {month}")
        with archive.open(member, "r") as raw_file:
            wrapper = io.TextIOWrapper(raw_file, encoding="ascii", newline="")
            reader = csv.reader(wrapper)
            for row_number, raw_row in enumerate(reader, start=1):
                row = tuple(raw_row)
                if row_number == 1 and row == KLINE_HEADER:
                    continue
                if len(row) != 12:
                    raise TerminalMeasurementError(
                        f"{symbol} {month} row {row_number} has !=12 fields"
                    )
                open_us, open_dt = parse_timestamp_us(row[0], field="openTime")
                close_us, _close_dt = parse_timestamp_us(row[6], field="closeTime")
                if (
                    open_dt.tzinfo != UTC
                    or open_dt.time() != datetime.min.time()
                    or open_dt.strftime("%Y-%m") != month
                    or not open_us <= close_us < open_us + DAY_US
                ):
                    raise TerminalMeasurementError(
                        f"{symbol} {month} row {row_number} has invalid daily boundary"
                    )
                open_price = parse_decimal_csv(row[1], field="open", positive=True)
                high = parse_decimal_csv(row[2], field="high", positive=True)
                low = parse_decimal_csv(row[3], field="low", positive=True)
                close = parse_decimal_csv(row[4], field="close", positive=True)
                base_volume = parse_decimal_csv(row[5], field="baseVolume", positive=False)
                quote_volume = parse_decimal_csv(row[7], field="quoteVolume", positive=False)
                taker_buy_base = parse_decimal_csv(
                    row[9], field="takerBuyBaseVolume", positive=False
                )
                taker_buy_quote = parse_decimal_csv(
                    row[10], field="takerBuyQuoteVolume", positive=False
                )
                parse_decimal_csv(row[11], field="ignore", positive=False)
                try:
                    trade_count = int(row[8])
                except ValueError as error:
                    raise TerminalMeasurementError("trade count is not an integer") from error
                if (
                    trade_count < 0
                    or high < max(open_price, close, low)
                    or low > min(open_price, close, high)
                    or taker_buy_base > base_volume
                    or taker_buy_quote > quote_volume
                ):
                    raise TerminalMeasurementError(
                        f"{symbol} {month} row {row_number} violates kline semantics"
                    )
                digest = sha256_bytes(("\x1f".join(row) + "\n").encode("ascii"))
                rows_by_day[open_dt.date()].append(
                    (
                        row,
                        Bar(
                            symbol=symbol,
                            day=open_dt.date(),
                            open_price=open_price,
                            quote_volume=quote_volume,
                            trade_count=trade_count,
                            row_digest=digest,
                        ),
                    )
                )
    bars: list[Bar] = []
    anomalies: list[SourceAnomaly] = []
    for day in sorted(rows_by_day):
        rows = rows_by_day[day]
        if len(rows) == 1:
            bars.append(rows[0][1])
            continue
        unique = {row for row, _bar in rows}
        raw_digest = sha256_bytes(
            canonical_bytes(
                {
                    "day": day.isoformat(),
                    "rows": [list(row) for row, _bar in rows],
                    "symbol": symbol,
                }
            )
        )
        if len(unique) != 1:
            raise TerminalMeasurementError(
                f"CONFLICTING_DUPLICATE_KLINE:{symbol}:{day.isoformat()}"
            )
        anomalies.append(
            SourceAnomaly(
                symbol=symbol,
                day=day,
                kind="EXACT_DUPLICATE_SYMBOL_DAY_CAUSALLY_INELIGIBLE",
                raw_digest=raw_digest,
                row_count=len(rows),
            )
        )
    if len(rows_by_day) < 1 or len(rows_by_day) > 31:
        raise TerminalMeasurementError(f"daily row count invalid: {symbol} {month}")
    return tuple(bars), tuple(anomalies)


def load_bars(
    source_manifest: Mapping[str, Any],
    months: frozenset[str],
) -> tuple[dict[str, dict[date, Bar]], tuple[SourceAnomaly, ...]]:
    raw_artifacts = source_manifest.get("artifacts")
    if not isinstance(raw_artifacts, list):
        raise VG18Error("source manifest artifacts missing")
    bars: dict[str, dict[date, Bar]] = {}
    anomalies: list[SourceAnomaly] = []
    for raw in raw_artifacts:
        if not isinstance(raw, dict) or str(raw.get("month")) not in months:
            continue
        artifact = cast(Mapping[str, Any], raw)
        parsed, found_anomalies = parse_archive(artifact)
        symbol = require_text(raw.get("symbol"), "symbol")
        by_day = bars.setdefault(symbol, {})
        for bar in parsed:
            if bar.day in by_day:
                raise TerminalMeasurementError(
                    f"duplicate symbol-day across archives: {symbol} {bar.day.isoformat()}"
                )
            by_day[bar.day] = bar
        anomalies.extend(found_anomalies)
    anomalies.sort(key=lambda item: (item.symbol, item.day, item.kind))
    return bars, tuple(anomalies)


def source_receipt(
    bars: Mapping[str, Mapping[date, Bar]],
    anomalies: Sequence[SourceAnomaly],
) -> dict[str, object]:
    rows = [
        {
            "day": bar.day.isoformat(),
            "open": decimal_text(bar.open_price),
            "quoteVolume": decimal_text(bar.quote_volume),
            "rowSha256": bar.row_digest,
            "symbol": symbol,
            "tradeCount": bar.trade_count,
        }
        for symbol in sorted(bars)
        for bar in (bars[symbol][day] for day in sorted(bars[symbol]))
    ]
    anomaly_rows = [
        {
            "day": item.day.isoformat(),
            "kind": item.kind,
            "rawSha256": item.raw_digest,
            "rowCount": item.row_count,
            "symbol": item.symbol,
        }
        for item in anomalies
    ]
    all_days = [bar.day for by_day in bars.values() for bar in by_day.values()]
    return {
        "anomalies": anomaly_rows,
        "anomalyCount": len(anomaly_rows),
        "barCount": len(rows),
        "firstDay": min(all_days).isoformat() if all_days else None,
        "lastDay": max(all_days).isoformat() if all_days else None,
        "normalizedBarsSha256": sha256_bytes(canonical_bytes(rows)),
        "symbolCount": len(bars),
    }


def _consecutive_bars(
    series: Mapping[date, Bar],
    *,
    last_day: date,
    count: int,
) -> tuple[Bar, ...] | None:
    days = tuple(last_day - timedelta(days=offset) for offset in range(count - 1, -1, -1))
    if any(day not in series for day in days):
        return None
    return tuple(series[day] for day in days)


def candidate_for_symbol(
    symbol: str,
    series: Mapping[date, Bar],
    signal_day: date,
) -> Candidate | None:
    current = series.get(signal_day)
    history = _consecutive_bars(
        series,
        last_day=signal_day - timedelta(days=1),
        count=MEAN_NOTIONAL_LOOKBACK,
    )
    if current is None or history is None:
        return None
    if current.trade_count <= 0 or current.quote_volume <= 0:
        return None
    if any(bar.trade_count <= 0 or bar.quote_volume <= 0 for bar in history):
        return None
    mean_notional = current.quote_volume / D(current.trade_count)
    baseline = median_decimal(tuple(bar.quote_volume / D(bar.trade_count) for bar in history))
    if baseline <= 0:
        return None
    liquidity_history = history[-LIQUIDITY_LOOKBACK:]
    trailing_quote_volume = median_decimal(tuple(bar.quote_volume for bar in liquidity_history))
    if trailing_quote_volume < MIN_MEDIAN_QUOTE_VOLUME:
        return None
    return Candidate(
        symbol=symbol,
        shock_multiple=mean_notional / baseline,
        mean_notional=mean_notional,
        baseline_mean_notional=baseline,
        trailing_median_quote_volume=trailing_quote_volume,
    )


def build_candidate_rankings(
    bars: Mapping[str, Mapping[date, Bar]],
    signal_start: date,
    signal_end: date,
) -> dict[date, tuple[Candidate, ...]]:
    rankings: dict[date, tuple[Candidate, ...]] = {}
    for signal_day in date_range(signal_start, signal_end):
        candidates = tuple(
            candidate
            for symbol in sorted(bars)
            if (candidate := candidate_for_symbol(symbol, bars[symbol], signal_day)) is not None
        )
        rankings[signal_day] = tuple(
            sorted(candidates, key=lambda item: (-item.shock_multiple, item.symbol))
        )
    return rankings


def build_decisions(
    bars: Mapping[str, Mapping[date, Bar]],
    trial: Trial,
    signal_start: date,
    signal_end: date,
    *,
    rankings: Mapping[date, tuple[Candidate, ...]] | None = None,
) -> tuple[CohortDecision, ...]:
    frozen_rankings = (
        build_candidate_rankings(bars, signal_start, signal_end) if rankings is None else rankings
    )
    decisions: list[CohortDecision] = []
    for signal_day in date_range(signal_start, signal_end):
        ranked = frozen_rankings.get(signal_day)
        if ranked is None:
            raise VG18Error("candidate ranking date grid is incomplete")
        entry_day = signal_day + timedelta(days=1)
        exit_day = entry_day + timedelta(days=trial.hold_days)
        selected: tuple[Candidate, ...] = ()
        reason = "FEWER_THAN_MINIMUM_ELIGIBLE_SYMBOLS"
        state = "CASH"
        capacity: Decimal | None = None
        if len(ranked) >= MIN_ELIGIBLE_SYMBOLS:
            top = ranked[: trial.cohort_size]
            if len(top) < trial.cohort_size or top[-1].shock_multiple < trial.shock_floor:
                reason = "FULL_TOP_K_DOES_NOT_CLEAR_SHOCK_FLOOR"
            elif any(
                bars[item.symbol].get(entry_day) is None
                or cast(Bar, bars[item.symbol].get(entry_day)).open_price <= 0
                for item in top
            ):
                reason = "SELECTED_ENTRY_UNAVAILABLE_ENTIRE_SLEEVE_CASH_NO_REPLACEMENT"
            else:
                selected = top
                state = "ACTIVE"
                reason = "FULL_TOP_K_ACTIVE"
                capacity = (
                    D(trial.cohort_size)
                    * min(item.trailing_median_quote_volume for item in selected)
                    * STRESS_CAPACITY_PARTICIPATION
                )
        decisions.append(
            CohortDecision(
                signal_day=signal_day,
                entry_day=entry_day,
                exit_day=exit_day,
                state=state,
                reason=reason,
                eligible_symbol_count=len(ranked),
                candidates=ranked,
                selected=selected,
                stress_capacity_proxy_usd=capacity,
            )
        )
    return tuple(decisions)


def _liquidation_value(
    position: Position,
    bars: Mapping[str, Mapping[date, Bar]],
    day: date,
    *,
    fee: Decimal,
    adverse: Decimal,
) -> Decimal:
    value = D(0)
    for symbol in position.symbols:
        bar = bars.get(symbol, {}).get(day)
        if bar is None:
            raise TerminalMeasurementError(
                f"MISSING_MARK_OR_EXIT_AFTER_ENTRY:{symbol}:{day.isoformat()}"
            )
        value += position.quantities[symbol] * bar.open_price * (D(1) - adverse) * (D(1) - fee)
    return value


def simulate_scenario(
    bars: Mapping[str, Mapping[date, Bar]],
    decisions: Sequence[CohortDecision],
    *,
    hold_days: int,
    fee: Decimal,
    adverse: Decimal,
) -> ScenarioSimulation:
    if not decisions:
        raise VG18Error("scenario requires at least one cohort decision")
    first_entry = decisions[0].entry_day
    # Every trial is evaluated on the same calendar grid. Shorter-horizon
    # sleeves remain cash after their last frozen exit; this keeps synchronized
    # bootstrap draws and cross-trial comparisons causally aligned.
    last_exit = decisions[-1].entry_day + timedelta(days=MAX_HOLD_DAYS)
    by_entry = {decision.entry_day: decision for decision in decisions}
    sleeve_cash = USD_1000 / D(hold_days)
    sleeves = [
        Sleeve(
            cash=(
                sleeve_cash if index < hold_days - 1 else USD_1000 - sleeve_cash * D(hold_days - 1)
            )
        )
        for index in range(hold_days)
    ]
    dates: list[date] = []
    returns: list[Decimal] = []
    navs: list[Decimal] = []
    previous_nav = USD_1000
    for day in date_range(first_entry, last_exit):
        for sleeve in sleeves:
            if sleeve.position is not None and sleeve.position.exit_day == day:
                sleeve.cash = _liquidation_value(
                    sleeve.position, bars, day, fee=fee, adverse=adverse
                )
                sleeve.position = None
            elif sleeve.position is not None and sleeve.position.exit_day < day:
                raise VG18Error("position survived beyond its frozen exit")

        decision = by_entry.get(day)
        if decision is not None:
            slot = (day - first_entry).days % hold_days
            sleeve = sleeves[slot]
            if sleeve.position is not None:
                raise VG18Error("rotating sleeve was not cash at scheduled entry")
            if decision.state == "ACTIVE":
                allocation = sleeve.cash / D(len(decision.selected))
                quantities: dict[str, Decimal] = {}
                remaining_cash = sleeve.cash
                for index, selected in enumerate(decision.selected):
                    entry_bar = bars.get(selected.symbol, {}).get(day)
                    if entry_bar is None:
                        raise VG18Error("entry availability drifted after cohort decision")
                    symbol_cash = (
                        allocation if index < len(decision.selected) - 1 else remaining_cash
                    )
                    quantities[selected.symbol] = (
                        symbol_cash * (D(1) - fee) / (entry_bar.open_price * (D(1) + adverse))
                    )
                    remaining_cash -= symbol_cash
                sleeve.cash = D(0)
                sleeve.position = Position(
                    symbols=tuple(item.symbol for item in decision.selected),
                    quantities=quantities,
                    exit_day=decision.exit_day,
                )

        nav = D(0)
        for sleeve in sleeves:
            nav += sleeve.cash
            if sleeve.position is not None:
                nav += _liquidation_value(sleeve.position, bars, day, fee=fee, adverse=adverse)
        if previous_nav <= 0 or nav < 0:
            raise TerminalMeasurementError("portfolio NAV became invalid")
        dates.append(day)
        navs.append(nav)
        returns.append(nav / previous_nav - D(1))
        previous_nav = nav
    if any(sleeve.position is not None for sleeve in sleeves):
        raise VG18Error("scenario ended with an open position")
    return ScenarioSimulation(
        dates=tuple(dates),
        daily_returns=tuple(returns),
        nav_values=tuple(navs),
        final_nav=previous_nav,
    )


def simulate_trial(
    bars: Mapping[str, Mapping[date, Bar]],
    trial: Trial,
    signal_start: date,
    signal_end: date,
    *,
    rankings: Mapping[date, tuple[Candidate, ...]] | None = None,
) -> TrialSimulation:
    decisions = build_decisions(
        bars,
        trial,
        signal_start,
        signal_end,
        rankings=rankings,
    )
    scenarios = {
        name: simulate_scenario(
            bars,
            decisions,
            hold_days=trial.hold_days,
            fee=costs[0],
            adverse=costs[1],
        )
        for name, costs in SCENARIOS.items()
    }
    return TrialSimulation(trial=trial, decisions=decisions, scenarios=scenarios)


def maximum_drawdown(nav_values: Sequence[Decimal]) -> Decimal | None:
    if not nav_values:
        return None
    peak = USD_1000
    worst = D(0)
    for nav in nav_values:
        if nav > peak:
            peak = nav
        drawdown = D(1) - nav / peak
        if drawdown > worst:
            worst = drawdown
    return worst


def bootstrap_mapping(
    returns: Sequence[Decimal],
    *,
    coverage: int,
    seed: int,
) -> dict[str, object]:
    interval = block_bootstrap_interval(
        tuple(decimal_ratio(value) for value in returns),
        BootstrapSpecV1(
            seed=seed,
            block_length=BOOTSTRAP_BLOCK_DAYS,
            replicates=BOOTSTRAP_REPLICATES,
            coverage_per_myriad=coverage,
        ),
    )
    return interval.as_mapping()


def _ratio_mapping(value: ExactRatioV1) -> dict[str, object]:
    return value.as_mapping()


def _ratio_fraction(value: ExactRatioV1) -> Fraction:
    return Fraction(value.numerator, value.denominator)


def _bootstrap_null_pvalues(
    simulations: Sequence[TrialSimulation],
) -> tuple[dict[str, ExactRatioV1], ExactRatioV1]:
    if not simulations:
        raise VG18Error("null bootstrap requires trials")
    series = [
        tuple(decimal_ratio(value) for value in item.scenarios["stressProxy"].daily_returns)
        for item in simulations
    ]
    count = len(series[0])
    if count < BOOTSTRAP_BLOCK_DAYS or any(len(row) != count for row in series):
        raise VG18Error("synchronized trial returns must share a sufficient date grid")
    fractions = [
        tuple(Fraction(value.numerator, value.denominator) for value in row) for row in series
    ]
    observed = [sum(row, Fraction(0)) / count for row in fractions]
    centered = [
        tuple(value - observed[index] for value in row) for index, row in enumerate(fractions)
    ]
    exceed = [0 for _ in simulations]
    wrc_exceed = 0
    observed_max = max(observed)
    rng = DeterministicRandom.from_seed(BOOTSTRAP_SEED + 18)
    blocks_needed = -(-count // BOOTSTRAP_BLOCK_DAYS)
    for _ in range(BOOTSTRAP_REPLICATES):
        indexes: list[int] = []
        for _ in range(blocks_needed):
            start = rng.next_u64() % count
            indexes.extend((start + offset) % count for offset in range(BOOTSTRAP_BLOCK_DAYS))
        indexes = indexes[:count]
        replicate_means = [
            sum((row[index] for index in indexes), Fraction(0)) / count for row in centered
        ]
        for trial_index, value in enumerate(replicate_means):
            if value >= observed[trial_index]:
                exceed[trial_index] += 1
        if max(replicate_means) >= observed_max:
            wrc_exceed += 1
    denominator = BOOTSTRAP_REPLICATES + 1
    raw = {
        item.trial.trial_id: make_ratio(exceed[index] + 1, denominator)
        for index, item in enumerate(simulations)
    }
    return raw, make_ratio(wrc_exceed + 1, denominator)


def _trial_ledger(trials: Sequence[Trial]) -> TrialLedgerV1:
    return TrialLedgerV1(
        trials=tuple(
            TrialRecordV1(
                trial_id=trial.trial_id,
                family_id="VG18",
                model_id=trial.trial_id,
                metric_id="STRESS_DAILY_RETURN",
                status=TrialStatus.COMPLETED,
                note="Frozen public-only cohort-or-cash trial.",
            )
            for trial in trials
        )
    )


def _monthly_block_scores(
    simulations: Sequence[TrialSimulation],
    start: date,
    end: date,
) -> tuple[tuple[ExactRatioV1, ...], ...]:
    months = month_values(start.strftime("%Y-%m"), end.strftime("%Y-%m"))
    rows: list[tuple[ExactRatioV1, ...]] = []
    for simulation in simulations:
        scenario = simulation.scenarios["stressProxy"]
        dated = dict(zip(scenario.dates, scenario.daily_returns, strict=True))
        block_values: list[ExactRatioV1] = []
        for month in months:
            values = tuple(value for day, value in dated.items() if day.strftime("%Y-%m") == month)
            block_values.append(decimal_ratio(mean_decimal(values) or D(0)))
        rows.append(tuple(block_values))
    return tuple(rows)


def trial_metrics(
    simulation: TrialSimulation,
) -> dict[str, object]:
    active = tuple(decision for decision in simulation.decisions if decision.state == "ACTIVE")
    selected_symbols = [selected.symbol for decision in active for selected in decision.selected]
    selections = Counter(selected_symbols)
    total_selections = sum(selections.values())
    top_counts = sorted(selections.values(), reverse=True)
    top_symbol_share = D(top_counts[0]) / D(total_selections) if total_selections else None
    top_five_share = D(sum(top_counts[:5])) / D(total_selections) if total_selections else None
    capacities = tuple(
        decision.stress_capacity_proxy_usd
        for decision in active
        if decision.stress_capacity_proxy_usd is not None
    )
    scenario_rows: dict[str, object] = {}
    for index, (name, scenario) in enumerate(simulation.scenarios.items()):
        ordinary = bootstrap_mapping(
            scenario.daily_returns,
            coverage=ONE_SIDED_95_TWO_SIDED_COVERAGE,
            seed=BOOTSTRAP_SEED + index,
        )
        bonferroni = (
            bootstrap_mapping(
                scenario.daily_returns,
                coverage=BONFERRONI_TWO_SIDED_COVERAGE,
                seed=BOOTSTRAP_SEED + index,
            )
            if name == "stressProxy"
            else None
        )
        scenario_rows[name] = {
            "bootstrapOneSided95": ordinary,
            "bootstrapStressBonferroni": bonferroni,
            "dailyReturnCount": len(scenario.daily_returns),
            "finalNavUsd": decimal_text(scenario.final_nav),
            "maximumDrawdownFraction": (
                None
                if maximum_drawdown(scenario.nav_values) is None
                else decimal_text(cast(Decimal, maximum_drawdown(scenario.nav_values)))
            ),
            "netUsdPer1000": decimal_text(scenario.final_nav - USD_1000),
        }
    decision_rows = [
        {
            "eligibleSymbolCount": decision.eligible_symbol_count,
            "entryDay": decision.entry_day.isoformat(),
            "exitDay": decision.exit_day.isoformat(),
            "reason": decision.reason,
            "selected": [item.symbol for item in decision.selected],
            "signalDay": decision.signal_day.isoformat(),
            "state": decision.state,
            "stressCapacityProxyUsd": (
                None
                if decision.stress_capacity_proxy_usd is None
                else decimal_text(decision.stress_capacity_proxy_usd)
            ),
        }
        for decision in simulation.decisions
    ]
    return {
        "activeCohortCount": len(active),
        "activeMonthCount": len({item.signal_day.strftime("%Y-%m") for item in active}),
        "baseCapacityProxyP05Usd": (
            None
            if not capacities
            else decimal_text(cast(Decimal, percentile(capacities, 5, 100)) * D(2))
        ),
        "cohortDecisionCount": len(simulation.decisions),
        "cohortDecisionLedgerSha256": sha256_bytes(canonical_bytes(decision_rows)),
        "cohortDecisions": decision_rows,
        "distinctSelectedSymbolCount": len(selections),
        "holdDays": simulation.trial.hold_days,
        "scenarios": scenario_rows,
        "shockFloor": decimal_text(simulation.trial.shock_floor),
        "stressCapacityProxyP05Usd": (
            None if not capacities else decimal_text(cast(Decimal, percentile(capacities, 5, 100)))
        ),
        "topFiveSelectionShare": (None if top_five_share is None else decimal_text(top_five_share)),
        "topSymbolSelectionShare": (
            None if top_symbol_share is None else decimal_text(top_symbol_share)
        ),
        "trialId": simulation.trial.trial_id,
        "cohortSize": simulation.trial.cohort_size,
    }


def _interval_lower(scenario: Mapping[str, Any], field: str) -> Decimal | None:
    raw_interval = scenario.get(field)
    if not isinstance(raw_interval, dict) or raw_interval.get("status") != "AVAILABLE":
        return None
    raw_lower = raw_interval.get("lower")
    if not isinstance(raw_lower, dict):
        return None
    return fixed_mapping_to_decimal(cast(Mapping[str, Any], raw_lower))


def _scenario(metrics: Mapping[str, Any], name: str) -> Mapping[str, Any]:
    raw = metrics.get("scenarios")
    if not isinstance(raw, dict) or not isinstance(raw.get(name), dict):
        raise VG18Error(f"scenario metrics missing: {name}")
    return cast(Mapping[str, Any], raw[name])


def _gate_metrics(
    metrics: Mapping[str, Any],
    *,
    phase: str,
    holm_selected: bool | None,
    wrc_pass: bool | None,
) -> dict[str, object]:
    base = _scenario(metrics, "baseProxy")
    stress = _scenario(metrics, "stressProxy")
    minimum_cohorts = 40 if phase == "development" else 20
    minimum_months = 6 if phase == "development" else 3
    minimum_symbols = 12 if phase == "development" else 8
    checks: dict[str, bool] = {
        "activeCohorts": require_int(metrics.get("activeCohortCount"), "activeCohortCount")
        >= minimum_cohorts,
        "activeMonths": require_int(metrics.get("activeMonthCount"), "activeMonthCount")
        >= minimum_months,
        "distinctSymbols": require_int(
            metrics.get("distinctSelectedSymbolCount"), "distinctSelectedSymbolCount"
        )
        >= minimum_symbols,
        "baseNetPositive": decimal_value(base.get("netUsdPer1000"), "baseNet") > 0,
        "stressNetPositive": decimal_value(stress.get("netUsdPer1000"), "stressNet") > 0,
        "baseOneSided95LcbPositive": ((_interval_lower(base, "bootstrapOneSided95") or D(0)) > 0),
        "stressOneSided95LcbPositive": (
            (_interval_lower(stress, "bootstrapOneSided95") or D(0)) > 0
        ),
        "maximumStressDrawdown": decimal_value(
            stress.get("maximumDrawdownFraction"), "maximumDrawdownFraction"
        )
        <= D("0.20"),
        "topSymbolShare": (
            metrics.get("topSymbolSelectionShare") is not None
            and decimal_value(metrics.get("topSymbolSelectionShare"), "topSymbolSelectionShare")
            <= D("0.25")
        ),
        "topFiveShare": (
            metrics.get("topFiveSelectionShare") is not None
            and decimal_value(metrics.get("topFiveSelectionShare"), "topFiveSelectionShare")
            <= D("0.40")
        ),
        "stressCapacityProxyP05": (
            metrics.get("stressCapacityProxyP05Usd") is not None
            and decimal_value(
                metrics.get("stressCapacityProxyP05Usd"),
                "stressCapacityProxyP05Usd",
            )
            >= D("1000")
        ),
    }
    if phase == "development":
        checks["stressBonferroniLcbPositive"] = (
            _interval_lower(stress, "bootstrapStressBonferroni") or D(0)
        ) > 0
        checks["holmFamilywisePass"] = holm_selected is True
        checks["whiteRealityCheckPass"] = wrc_pass is True
    failed = sorted(name for name, passed in checks.items() if not passed)
    return {"checks": checks, "failed": failed, "passed": not failed}


def _candidate_sort_key(metrics: Mapping[str, Any]) -> tuple[Decimal, Decimal, str]:
    stress = _scenario(metrics, "stressProxy")
    lower = _interval_lower(stress, "bootstrapStressBonferroni")
    return (
        -(lower if lower is not None else D("-1E999")),
        -decimal_value(stress.get("netUsdPer1000"), "stressNetUsdPer1000"),
        require_text(metrics.get("trialId"), "trialId"),
    )


def analyze_development(
    bars: Mapping[str, Mapping[date, Bar]],
    anomalies: Sequence[SourceAnomaly],
) -> tuple[dict[str, object], dict[str, object] | None, dict[str, object] | None]:
    trials = parse_trials()
    rankings = build_candidate_rankings(bars, DEVELOPMENT_SIGNAL_START, DEVELOPMENT_SIGNAL_END)
    simulations = tuple(
        simulate_trial(
            bars,
            trial,
            DEVELOPMENT_SIGNAL_START,
            DEVELOPMENT_SIGNAL_END,
            rankings=rankings,
        )
        for trial in trials
    )
    metric_rows = [trial_metrics(simulation) for simulation in simulations]
    raw_pvalues, wrc_pvalue = _bootstrap_null_pvalues(simulations)
    ledger = _trial_ledger(trials)
    holm = holm_bonferroni(
        ledger,
        tuple((trial.trial_id, raw_pvalues[trial.trial_id]) for trial in trials),
        familywise_alpha_per_myriad=HOLM_ALPHA_PER_MYRIAD,
    )
    holm_selected = set(holm.rejected_trial_ids)
    wrc_pass = _ratio_fraction(wrc_pvalue) <= Fraction(HOLM_ALPHA_PER_MYRIAD, 10_000)
    gates_by_id: dict[str, dict[str, object]] = {}
    for metrics in metric_rows:
        trial_id = require_text(metrics.get("trialId"), "trialId")
        gates_by_id[trial_id] = _gate_metrics(
            metrics,
            phase="development",
            holm_selected=trial_id in holm_selected,
            wrc_pass=wrc_pass,
        )
        metrics["rawOneSidedNullPValue"] = _ratio_mapping(raw_pvalues[trial_id])
        metrics["gates"] = gates_by_id[trial_id]

    champion_metrics = min(metric_rows, key=_candidate_sort_key)
    champion_id = require_text(champion_metrics.get("trialId"), "trialId")
    pbo = pbo_cscv(
        _monthly_block_scores(simulations, DEVELOPMENT_SIGNAL_START, DEVELOPMENT_SIGNAL_END)
    )
    development = {
        "archiveBodiesOpened": True,
        "createdAt": utc_now(),
        "familySize": len(trials),
        "globalPositiveEdgeClaim": "NOT_MADE",
        "holmBonferroni": {
            "familywiseAlphaPerMyriad": holm.familywise_alpha_per_myriad,
            "rejectedTrialIds": list(holm.rejected_trial_ids),
            "testedCount": holm.tested_count,
        },
        "pbo": {
            **pbo.as_mapping(),
            "role": "DIAGNOSTIC_ONLY_NOT_A_GATE_NOT_A_SELECTOR",
        },
        "schema": "VG18DevelopmentResultV1",
        "selectedChampionTrialId": champion_id,
        "selectionRule": (
            "HIGHEST_STRESS_BONFERRONI_LCB_THEN_STRESS_NET_USD_PER_1000_THEN_TRIAL_ID_ASC"
        ),
        "sourceReceipt": source_receipt(bars, anomalies),
        "status": "MEASURED",
        "trials": metric_rows,
        "whiteRealityCheck": {
            "alpha": "0.05",
            "familyPValue": _ratio_mapping(wrc_pvalue),
            "passed": wrc_pass,
            "synchronized": True,
        },
    }
    champion_gates = gates_by_id[champion_id]
    if champion_gates["passed"] is not True:
        terminal = terminal_result(
            verdict="NO_GO",
            reason_codes=cast(list[str], champion_gates["failed"]),
            development=development,
            holdout=None,
            holdout_opened=False,
        )
        return development, None, terminal
    candidate = {
        "candidateTrialId": champion_id,
        "developmentGates": champion_gates,
        "developmentResultSha256": sha256_bytes(canonical_bytes(development)),
        "holdoutOpened": False,
        "schema": "VG18CandidateSealV1",
        "selectionRule": development["selectionRule"],
        "trial": {
            "cohortSize": champion_metrics["cohortSize"],
            "holdDays": champion_metrics["holdDays"],
            "shockFloor": champion_metrics["shockFloor"],
        },
    }
    return development, candidate, None


def _trial_from_candidate(candidate: Mapping[str, Any]) -> Trial:
    raw = candidate.get("trial")
    if not isinstance(raw, dict):
        raise VG18Error("candidate trial missing")
    return Trial(
        trial_id=require_text(candidate.get("candidateTrialId"), "candidateTrialId"),
        cohort_size=require_int(raw.get("cohortSize"), "cohortSize", minimum=1),
        shock_floor=decimal_value(raw.get("shockFloor"), "shockFloor"),
        hold_days=require_int(raw.get("holdDays"), "holdDays", minimum=1),
    )


def analyze_holdout(
    bars: Mapping[str, Mapping[date, Bar]],
    anomalies: Sequence[SourceAnomaly],
    candidate: Mapping[str, Any],
    development: Mapping[str, Any],
) -> tuple[dict[str, object], dict[str, object]]:
    trial = _trial_from_candidate(candidate)
    if trial not in parse_trials():
        raise VG18Error("candidate is outside frozen trial ledger")
    simulation = simulate_trial(bars, trial, HOLDOUT_SIGNAL_START, HOLDOUT_SIGNAL_END)
    metrics = trial_metrics(simulation)
    gates = _gate_metrics(
        metrics,
        phase="holdout",
        holm_selected=None,
        wrc_pass=None,
    )
    metrics["gates"] = gates
    holdout = {
        "archiveBodiesOpened": True,
        "candidateTrialId": trial.trial_id,
        "createdAt": utc_now(),
        "globalPositiveEdgeClaim": "NOT_MADE",
        "metrics": metrics,
        "schema": "VG18HoldoutResultV1",
        "sourceReceipt": source_receipt(bars, anomalies),
        "status": "MEASURED",
    }
    if gates["passed"] is True:
        result = terminal_result(
            verdict="LOCAL_PUBLIC_PROXY_PASS",
            reason_codes=[
                "ACCOUNT_EFFECTIVE_FEES_UNKNOWN",
                "EXECUTABLE_CAPACITY_UNMEASURED",
                "VG11_VG18_SIBLING_FAMILY_MULTIPLICITY_NOT_BOUND_BY_SUCCESSOR",
            ],
            development=development,
            holdout=holdout,
            holdout_opened=True,
        )
    else:
        result = terminal_result(
            verdict="NO_GO",
            reason_codes=cast(list[str], gates["failed"]),
            development=development,
            holdout=holdout,
            holdout_opened=True,
        )
    return holdout, result


def terminal_result(
    *,
    verdict: str,
    reason_codes: Sequence[str],
    development: Mapping[str, Any] | None,
    holdout: Mapping[str, Any] | None,
    holdout_opened: bool,
) -> dict[str, object]:
    return {
        "accountEffectiveFees": None,
        "capitalDecision": "NO_GO",
        "capitalAuthority": "NONE",
        "capacity": {
            "executable": None,
            "publicQuoteVolumeProxyOnly": True,
            "status": "UNMEASURED",
        },
        "consumer": "N3_SUCCESSOR_OR_FINAL_CONVERGENCE",
        "createdAt": utc_now(),
        "developmentResultSha256": (
            None if development is None else sha256_bytes(canonical_bytes(development))
        ),
        "executionAuthority": "NONE",
        "globalPositiveEdgeClaim": "NOT_MADE",
        "holdoutOpened": holdout_opened,
        "holdoutResultSha256": (
            None if holdout is None else sha256_bytes(canonical_bytes(holdout))
        ),
        "privateDataUsed": False,
        "publicOnly": True,
        "reasonCodes": list(reason_codes),
        "schema": "VG18TerminalResultV1",
        "verdict": verdict,
    }


def terminal_unmeasured(
    *,
    phase: str,
    reason: str,
    holdout_opened: bool,
    development: Mapping[str, Any] | None = None,
) -> tuple[dict[str, object], dict[str, object]]:
    phase_result: dict[str, object] = {
        "accountEffectiveFees": None,
        "archiveBodiesOpened": True,
        "createdAt": utc_now(),
        "economics": None,
        "globalPositiveEdgeClaim": "NOT_MADE",
        "phase": phase,
        "reason": reason,
        "schema": ("VG18DevelopmentResultV1" if phase == "development" else "VG18HoldoutResultV1"),
        "sourceReceipt": None,
        "status": "UNMEASURED",
    }
    result = terminal_result(
        verdict="UNMEASURED",
        reason_codes=[reason],
        development=phase_result if phase == "development" else development,
        holdout=phase_result if phase == "holdout" else None,
        holdout_opened=holdout_opened,
    )
    return phase_result, result


def _freeze() -> dict[str, Any]:
    freeze, _ = load_json(FREEZE_PATH, canonical=True)
    if freeze.get("schema") != "VG18FreezeV1":
        raise VG18Error("freeze schema drifted")
    raw_hashes = freeze.get("staticFileSha256")
    if not isinstance(raw_hashes, dict):
        raise VG18Error("freeze static hashes missing")
    for name in STATIC_FILES:
        if raw_hashes.get(name) != sha256_path(HERE / name):
            raise VG18Error(f"frozen static file changed: {name}")
    return freeze


def command_manifest(_args: argparse.Namespace) -> None:
    validate_protocol()
    parse_trials()
    manifest = build_source_manifest()
    print(
        f"MANIFEST artifactCount={manifest['artifactCount']} "
        f"symbolCount={manifest['symbolCount']} archiveBodiesOpened=false"
    )


def command_seal(_args: argparse.Namespace) -> None:
    require_clean_git()
    require_pushed_head()
    ensure_scoped_history()
    validate_protocol()
    validate_source_manifest(authenticate_files=True)
    for name in STATIC_FILES:
        safe_regular(HERE / name)
    if any(lexists(HERE / name) for name in GENERATED_FILES):
        raise VG18Error("generated lifecycle files exist before freeze")
    head = git_head()
    expected = tuple(f"quant/research/vg18/{name}" for name in STATIC_FILES)
    if tuple(sorted(changed_paths(BASE_COMMIT, head))) != tuple(sorted(expected)):
        raise VG18Error("static commit delta does not exactly match frozen files")
    freeze = {
        "archiveBodiesOpened": False,
        "baseCommit": BASE_COMMIT,
        "createdAt": utc_now(),
        "protocolSha256": sha256_path(PROTOCOL_PATH),
        "schema": "VG18FreezeV1",
        "sourceManifestSha256": sha256_path(SOURCE_MANIFEST_PATH),
        "staticCommit": head,
        "staticFileSha256": {name: sha256_path(HERE / name) for name in STATIC_FILES},
        "staticTree": git_output("rev-parse", "HEAD^{tree}"),
        "trialLedgerSha256": sha256_path(TRIAL_LEDGER_PATH),
    }
    emit_json_once(FREEZE_PATH, freeze)
    print(f"SEALED staticCommit={head} archiveBodiesOpened=false")


def _state_marker_path(name: str) -> Path:
    return STATE_ROOT / name


def command_arm_development(_args: argparse.Namespace) -> None:
    require_clean_git()
    require_pushed_head()
    ensure_scoped_history()
    freeze = _freeze()
    head = git_head()
    static_commit = require_text(freeze.get("staticCommit"), "staticCommit")
    if git_output("rev-parse", "HEAD^") != static_commit:
        raise VG18Error("freeze commit must immediately follow static commit")
    require_exact_delta(static_commit, head, ("freeze.v1.json",))
    marker = {
        "archiveBodiesOpenedBeforeMarker": False,
        "armedAt": utc_now(),
        "armedFromCommit": head,
        "developmentBodyRunsAllowed": 1,
        "ordinal": 1,
        "schema": "VG18DevelopmentRunMarkerV1",
        "staticCommit": static_commit,
    }
    raw = canonical_bytes(marker)
    exclusive_write(_state_marker_path("development-run-marker.v1.json"), raw, mode=0o600)
    exclusive_write(RUN_MARKER_PATH, raw, mode=0o600)
    print(f"ARMED phase=development ordinal=1 armedFromCommit={head}")


def _validate_development_marker(
    *,
    require_state: bool,
    require_head_marker: bool,
) -> tuple[dict[str, Any], str]:
    marker, raw = load_json(RUN_MARKER_PATH, canonical=True)
    if marker.get("schema") != "VG18DevelopmentRunMarkerV1":
        raise VG18Error("development marker schema drifted")
    if require_state:
        state_raw = safe_regular(_state_marker_path("development-run-marker.v1.json")).read_bytes()
        if state_raw != raw:
            raise VG18Error("repository and state development markers differ")
    freeze = _freeze()
    static_commit = require_text(freeze.get("staticCommit"), "staticCommit")
    if require_text(freeze.get("staticCommit"), "staticCommit") != marker.get("staticCommit"):
        raise VG18Error("development marker does not bind frozen static commit")
    freeze_commit = latest_path_commit(FREEZE_PATH)
    if git_output("rev-parse", f"{freeze_commit}^") != static_commit:
        raise VG18Error("freeze commit parent drifted")
    require_exact_delta(static_commit, freeze_commit, ("freeze.v1.json",))
    if marker.get("armedFromCommit") != freeze_commit:
        raise VG18Error("development marker does not bind freeze commit")
    marker_commit = latest_path_commit(RUN_MARKER_PATH)
    if git_output("rev-parse", f"{marker_commit}^") != freeze_commit:
        raise VG18Error("development marker commit parent drifted")
    require_exact_delta(freeze_commit, marker_commit, ("run-marker.v1.json",))
    git_output("merge-base", "--is-ancestor", marker_commit, "HEAD")
    if require_head_marker and git_head() != marker_commit:
        raise VG18Error("development body must open from marker commit HEAD")
    return marker, marker_commit


def _consume_body_once(
    *,
    phase: str,
    marker_path: Path,
    marker_commit: str,
) -> None:
    marker_raw = safe_regular(marker_path).read_bytes()
    receipt = {
        "consumedAt": utc_now(),
        "markerCommit": marker_commit,
        "markerSha256": sha256_bytes(marker_raw),
        "openingHead": git_head(),
        "ordinal": 1,
        "phase": phase,
        "schema": "VG18BodyConsumptionV1",
    }
    exclusive_write(
        _state_marker_path(f"{phase}-body-consumed.v1.json"),
        canonical_bytes(receipt),
        mode=0o600,
    )


def _validate_candidate_binding(
    candidate: Mapping[str, Any],
    candidate_raw: bytes,
    development: Mapping[str, Any],
    development_raw: bytes,
) -> Trial:
    if candidate.get("schema") != "VG18CandidateSealV1":
        raise VG18Error("candidate seal schema drifted")
    if candidate.get("developmentResultSha256") != sha256_bytes(development_raw):
        raise VG18Error("candidate does not bind development result")
    if development.get("status") != "MEASURED":
        raise VG18Error("unmeasured development cannot open holdout")
    candidate_id = require_text(candidate.get("candidateTrialId"), "candidateTrialId")
    if development.get("selectedChampionTrialId") != candidate_id:
        raise VG18Error("candidate is not the selected development champion")
    candidate_gates = candidate.get("developmentGates")
    if not isinstance(candidate_gates, dict) or candidate_gates.get("passed") is not True:
        raise VG18Error("candidate did not pass all development gates")
    raw_trials = development.get("trials")
    if not isinstance(raw_trials, list):
        raise VG18Error("development trial rows missing")
    champions = [
        row for row in raw_trials if isinstance(row, dict) and row.get("trialId") == candidate_id
    ]
    if len(champions) != 1:
        raise VG18Error("development champion row is not unique")
    champion = champions[0]
    if champion.get("gates") != candidate_gates:
        raise VG18Error("candidate gates differ from champion gates")
    trial = _trial_from_candidate(candidate)
    if (
        champion.get("cohortSize") != trial.cohort_size
        or champion.get("holdDays") != trial.hold_days
        or champion.get("shockFloor") != decimal_text(trial.shock_floor)
    ):
        raise VG18Error("candidate parameters differ from champion row")
    if trial not in parse_trials():
        raise VG18Error("candidate is outside frozen trial ledger")
    if sha256_bytes(candidate_raw) == sha256_bytes(development_raw):
        raise VG18Error("candidate and development artifacts unexpectedly collide")
    return trial


def write_checksums_once() -> None:
    names = sorted(
        name
        for name in (*STATIC_FILES, *GENERATED_FILES)
        if name != "SHA256SUMS" and lexists(HERE / name)
    )
    lines = [f"{sha256_path(HERE / name)}  {name}\n" for name in names]
    exclusive_write(SHA256SUMS_PATH, "".join(lines).encode("ascii"), mode=0o644)


def command_develop(_args: argparse.Namespace) -> None:
    require_clean_git()
    require_pushed_head()
    ensure_scoped_history()
    _marker, marker_commit = _validate_development_marker(
        require_state=True,
        require_head_marker=True,
    )
    _consume_body_once(
        phase="development",
        marker_path=RUN_MARKER_PATH,
        marker_commit=marker_commit,
    )
    try:
        source_manifest = validate_source_manifest(authenticate_files=True)
        bars, anomalies = load_bars(source_manifest, frozenset(DEVELOPMENT_SOURCE_MONTHS))
        development, candidate, terminal = analyze_development(bars, anomalies)
    # A consumed one-run marker may not be retried; every evaluation failure
    # therefore seals UNMEASURED rather than escaping without terminal evidence.
    except Exception as error:
        development, terminal = terminal_unmeasured(
            phase="development",
            reason=f"{type(error).__name__}:{error}",
            holdout_opened=False,
        )
        candidate = None
    emit_json_once(DEVELOPMENT_RESULT_PATH, development)
    if candidate is not None:
        emit_json_once(CANDIDATE_SEAL_PATH, candidate)
        print(f"DEVELOPMENT verdict=PASS_TO_HOLDOUT candidate={candidate['candidateTrialId']}")
        return
    if terminal is None:
        raise VG18Error("development ended without candidate or terminal result")
    emit_json_once(RESULT_PATH, terminal)
    write_checksums_once()
    print(f"DEVELOPMENT verdict={terminal['verdict']} holdoutOpened=false")


def command_arm_holdout(_args: argparse.Namespace) -> None:
    require_clean_git()
    require_pushed_head()
    ensure_scoped_history()
    _marker, marker_commit = _validate_development_marker(
        require_state=True,
        require_head_marker=False,
    )
    candidate, candidate_raw = load_json(CANDIDATE_SEAL_PATH, canonical=True)
    development, development_raw = load_json(DEVELOPMENT_RESULT_PATH, canonical=True)
    _validate_candidate_binding(candidate, candidate_raw, development, development_raw)
    head = git_head()
    if git_output("rev-parse", f"{head}^") != marker_commit:
        raise VG18Error("development result commit parent drifted")
    require_exact_delta(
        marker_commit,
        head,
        ("candidate-seal.v1.json", "development-result.v1.json"),
    )
    marker = {
        "armedAt": utc_now(),
        "armedFromCommit": head,
        "candidateSealSha256": sha256_bytes(candidate_raw),
        "developmentResultSha256": sha256_bytes(development_raw),
        "holdoutBodyRunsAllowed": 1,
        "ordinal": 1,
        "schema": "VG18HoldoutOpenV1",
    }
    raw = canonical_bytes(marker)
    exclusive_write(_state_marker_path("holdout-open.v1.json"), raw, mode=0o600)
    exclusive_write(HOLDOUT_OPEN_PATH, raw, mode=0o600)
    print(f"ARMED phase=holdout ordinal=1 candidate={candidate['candidateTrialId']}")


def _validate_holdout_marker(
    *,
    require_state: bool,
    require_head_marker: bool,
) -> tuple[dict[str, Any], dict[str, Any], str]:
    marker, marker_raw = load_json(HOLDOUT_OPEN_PATH, canonical=True)
    if marker.get("schema") != "VG18HoldoutOpenV1":
        raise VG18Error("holdout marker schema drifted")
    if require_state:
        state_raw = safe_regular(_state_marker_path("holdout-open.v1.json")).read_bytes()
        if state_raw != marker_raw:
            raise VG18Error("repository and state holdout markers differ")
    candidate, candidate_raw = load_json(CANDIDATE_SEAL_PATH, canonical=True)
    development, development_raw = load_json(DEVELOPMENT_RESULT_PATH, canonical=True)
    _validate_candidate_binding(candidate, candidate_raw, development, development_raw)
    if marker.get("candidateSealSha256") != sha256_bytes(candidate_raw):
        raise VG18Error("holdout marker does not bind candidate")
    if marker.get("developmentResultSha256") != sha256_bytes(development_raw):
        raise VG18Error("holdout marker does not bind development result")
    armed_from = require_text(marker.get("armedFromCommit"), "armedFromCommit")
    marker_commit = latest_path_commit(HOLDOUT_OPEN_PATH)
    if git_output("rev-parse", f"{marker_commit}^") != armed_from:
        raise VG18Error("holdout marker commit parent drifted")
    require_exact_delta(armed_from, marker_commit, ("holdout-open.v1.json",))
    git_output("merge-base", "--is-ancestor", marker_commit, "HEAD")
    if require_head_marker and git_head() != marker_commit:
        raise VG18Error("holdout body must open from marker commit HEAD")
    return marker, candidate, marker_commit


def command_holdout(_args: argparse.Namespace) -> None:
    require_clean_git()
    require_pushed_head()
    ensure_scoped_history()
    _marker, candidate, marker_commit = _validate_holdout_marker(
        require_state=True,
        require_head_marker=True,
    )
    development, _development_raw = load_json(DEVELOPMENT_RESULT_PATH, canonical=True)
    _consume_body_once(
        phase="holdout",
        marker_path=HOLDOUT_OPEN_PATH,
        marker_commit=marker_commit,
    )
    try:
        source_manifest = validate_source_manifest(authenticate_files=True)
        bars, anomalies = load_bars(source_manifest, frozenset(HOLDOUT_SOURCE_MONTHS))
        holdout, result = analyze_holdout(bars, anomalies, candidate, development)
    # The same one-run law applies to the sealed holdout body.
    except Exception as error:
        holdout, result = terminal_unmeasured(
            phase="holdout",
            reason=f"{type(error).__name__}:{error}",
            holdout_opened=True,
            development=development,
        )
    emit_json_once(HOLDOUT_RESULT_PATH, holdout)
    emit_json_once(RESULT_PATH, result)
    write_checksums_once()
    print(f"HOLDOUT verdict={result['verdict']} candidate={candidate['candidateTrialId']}")


def _verify_checksums() -> None:
    lines = safe_regular(SHA256SUMS_PATH).read_text(encoding="ascii").splitlines()
    expected_names = sorted(
        name for name in (*STATIC_FILES, *GENERATED_FILES) if lexists(HERE / name)
    )
    found_names: list[str] = []
    for line in lines:
        match = re.fullmatch(r"([0-9a-f]{64})  ([A-Za-z0-9_.-]+)", line)
        if match is None:
            raise VG18Error("SHA256SUMS line is malformed")
        digest, name = match.groups()
        if "/" in name or name == "SHA256SUMS":
            raise VG18Error("SHA256SUMS contains an invalid path")
        if sha256_path(HERE / name) != digest:
            raise VG18Error(f"checksum mismatch: {name}")
        found_names.append(name)
    if found_names != expected_names:
        raise VG18Error("SHA256SUMS file set drifted")


def _verify_exact_chronology(
    result: Mapping[str, Any],
    *,
    run_commit: str,
) -> None:
    development_commit = latest_path_commit(DEVELOPMENT_RESULT_PATH)
    if git_output("rev-parse", f"{development_commit}^") != run_commit:
        raise VG18Error("development result commit parent drifted")
    expected_names = set(STATIC_FILES) | {
        "freeze.v1.json",
        "run-marker.v1.json",
        "development-result.v1.json",
        "result.v1.json",
        "SHA256SUMS",
    }
    if lexists(HOLDOUT_OPEN_PATH):
        if not lexists(CANDIDATE_SEAL_PATH) or not lexists(HOLDOUT_RESULT_PATH):
            raise VG18Error("holdout chronology is missing candidate or result")
        require_exact_delta(
            run_commit,
            development_commit,
            ("candidate-seal.v1.json", "development-result.v1.json"),
        )
        _marker, _candidate, holdout_commit = _validate_holdout_marker(
            require_state=False,
            require_head_marker=False,
        )
        if git_output("rev-parse", f"{holdout_commit}^") != development_commit:
            raise VG18Error("holdout marker does not follow development result")
        terminal_commit = latest_path_commit(RESULT_PATH)
        if git_output("rev-parse", f"{terminal_commit}^") != holdout_commit:
            raise VG18Error("terminal holdout commit parent drifted")
        require_exact_delta(
            holdout_commit,
            terminal_commit,
            ("SHA256SUMS", "holdout-result.v1.json", "result.v1.json"),
        )
        expected_names.update(
            {
                "candidate-seal.v1.json",
                "holdout-open.v1.json",
                "holdout-result.v1.json",
            }
        )
    else:
        if lexists(CANDIDATE_SEAL_PATH) or lexists(HOLDOUT_RESULT_PATH):
            raise VG18Error("terminal development chronology has stray holdout files")
        terminal_commit = development_commit
        require_exact_delta(
            run_commit,
            terminal_commit,
            ("SHA256SUMS", "development-result.v1.json", "result.v1.json"),
        )
        if result.get("holdoutOpened") is not False:
            raise VG18Error("terminal development result claims a holdout")
    if git_head() != terminal_commit:
        raise VG18Error("terminal evidence commit must be current HEAD")
    expected_paths = tuple(sorted(f"quant/research/vg18/{name}" for name in expected_names))
    if tuple(sorted(changed_paths(BASE_COMMIT, "HEAD"))) != expected_paths:
        raise VG18Error("terminal tracked file set is not exact")


def command_verify(_args: argparse.Namespace) -> None:
    require_clean_git()
    require_pushed_head()
    ensure_scoped_history()
    validate_protocol()
    parse_trials()
    validate_source_manifest(authenticate_files=False)
    freeze = _freeze()
    static_commit = require_text(freeze.get("staticCommit"), "staticCommit")
    if git_output("cat-file", "-t", static_commit) != "commit":
        raise VG18Error("frozen static commit is absent")
    _marker, run_commit = _validate_development_marker(
        require_state=False,
        require_head_marker=False,
    )
    _verify_checksums()
    result, _result_raw = load_json(RESULT_PATH, canonical=True)
    development, development_raw = load_json(DEVELOPMENT_RESULT_PATH, canonical=True)
    if result.get("schema") != "VG18TerminalResultV1":
        raise VG18Error("terminal result schema drifted")
    if result.get("publicOnly") is not True or result.get("privateDataUsed") is not False:
        raise VG18Error("public-only result boundary drifted")
    if result.get("capitalAuthority") != "NONE" or result.get("executionAuthority") != "NONE":
        raise VG18Error("result claims forbidden authority")
    if result.get("capitalDecision") != "NO_GO":
        raise VG18Error("capital decision must remain NO_GO")
    if result.get("globalPositiveEdgeClaim") != "NOT_MADE":
        raise VG18Error("result makes a forbidden global positive claim")
    if result.get("accountEffectiveFees") is not None:
        raise VG18Error("account fee truth was fabricated")
    if result.get("capacity") != {
        "executable": None,
        "publicQuoteVolumeProxyOnly": True,
        "status": "UNMEASURED",
    }:
        raise VG18Error("executable capacity truth drifted")
    if result.get("developmentResultSha256") != sha256_bytes(development_raw):
        raise VG18Error("terminal result does not bind development result")
    if result.get("verdict") not in {
        "NO_GO",
        "UNMEASURED",
        "LOCAL_PUBLIC_PROXY_PASS",
    }:
        raise VG18Error("terminal verdict is invalid")
    if result.get("verdict") == "UNMEASURED":
        phase_path = (
            HOLDOUT_RESULT_PATH if result.get("holdoutOpened") is True else DEVELOPMENT_RESULT_PATH
        )
        phase, _ = load_json(phase_path, canonical=True)
        if phase.get("economics") is not None or phase.get("status") != "UNMEASURED":
            raise VG18Error("UNMEASURED result contains false-zero economics")
    if lexists(HOLDOUT_OPEN_PATH):
        candidate, candidate_raw = load_json(CANDIDATE_SEAL_PATH, canonical=True)
        _validate_candidate_binding(candidate, candidate_raw, development, development_raw)
        _validate_holdout_marker(
            require_state=False,
            require_head_marker=False,
        )
        holdout, holdout_raw = load_json(HOLDOUT_RESULT_PATH, canonical=True)
        if result.get("holdoutOpened") is not True:
            raise VG18Error("holdout marker contradicts terminal result")
        if result.get("holdoutResultSha256") != sha256_bytes(holdout_raw):
            raise VG18Error("terminal result does not bind holdout result")
        holdout_status = holdout.get("status")
        if holdout_status == "MEASURED":
            if holdout.get("candidateTrialId") != candidate.get("candidateTrialId"):
                raise VG18Error("measured holdout uses the wrong candidate")
            metrics = holdout.get("metrics")
            if not isinstance(metrics, dict) or not isinstance(metrics.get("gates"), dict):
                raise VG18Error("measured holdout gates are missing")
            gates = cast(Mapping[str, Any], metrics["gates"])
            if result.get("verdict") == "LOCAL_PUBLIC_PROXY_PASS":
                blockers = [
                    "ACCOUNT_EFFECTIVE_FEES_UNKNOWN",
                    "EXECUTABLE_CAPACITY_UNMEASURED",
                    "VG11_VG18_SIBLING_FAMILY_MULTIPLICITY_NOT_BOUND_BY_SUCCESSOR",
                ]
                if gates.get("passed") is not True or result.get("reasonCodes") != blockers:
                    raise VG18Error("local public proxy pass is incoherent")
            elif result.get("verdict") == "NO_GO":
                if gates.get("passed") is not False or result.get("reasonCodes") != gates.get(
                    "failed"
                ):
                    raise VG18Error("holdout NO_GO is incoherent")
            else:
                raise VG18Error("measured holdout has an invalid terminal verdict")
        elif holdout_status == "UNMEASURED":
            if (
                holdout.get("candidateTrialId") is not None
                or result.get("verdict") != "UNMEASURED"
                or result.get("reasonCodes") != [holdout.get("reason")]
            ):
                raise VG18Error("unmeasured holdout semantics drifted")
        else:
            raise VG18Error("holdout result status is invalid")
    else:
        if result.get("holdoutOpened") is not False:
            raise VG18Error("holdout status contradicts absent holdout marker")
        if lexists(HOLDOUT_RESULT_PATH):
            raise VG18Error("holdout result exists without holdout marker")
        if result.get("holdoutResultSha256") is not None:
            raise VG18Error("terminal result binds an absent holdout result")
        if development.get("status") == "MEASURED":
            raw_trials = development.get("trials")
            champion_id = development.get("selectedChampionTrialId")
            if not isinstance(raw_trials, list):
                raise VG18Error("measured development trials are missing")
            champions = [
                row
                for row in raw_trials
                if isinstance(row, dict) and row.get("trialId") == champion_id
            ]
            if len(champions) != 1 or not isinstance(champions[0].get("gates"), dict):
                raise VG18Error("development champion gates are missing")
            gates = cast(Mapping[str, Any], champions[0]["gates"])
            if (
                result.get("verdict") != "NO_GO"
                or gates.get("passed") is not False
                or result.get("reasonCodes") != gates.get("failed")
            ):
                raise VG18Error("development NO_GO is incoherent")
        elif development.get("status") == "UNMEASURED":
            if result.get("verdict") != "UNMEASURED" or result.get("reasonCodes") != [
                development.get("reason")
            ]:
                raise VG18Error("unmeasured development semantics drifted")
        else:
            raise VG18Error("development result status is invalid")
    _verify_exact_chronology(result, run_commit=run_commit)
    print(
        "VERIFY PASS "
        f"verdict={result['verdict']} head={git_head()} "
        "scope=quant/research/vg18 publicOnly=true authority=NONE"
    )


def command_report(_args: argparse.Namespace) -> None:
    result, _ = load_json(RESULT_PATH, canonical=True)
    print(
        "V-G18 | SEALED | "
        f"verdict={result.get('verdict')} holdoutOpened={str(result.get('holdoutOpened')).lower()} "
        f"capitalDecision={result.get('capitalDecision')} "
        "accountFees=UNKNOWN executableCapacity=UNMEASURED "
        "authority=NONE consumer=N3-successor/final-convergence"
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    commands = {
        "manifest": command_manifest,
        "seal": command_seal,
        "arm-development": command_arm_development,
        "develop": command_develop,
        "arm-holdout": command_arm_holdout,
        "holdout": command_holdout,
        "verify": command_verify,
        "report": command_report,
    }
    for name, function in commands.items():
        child = subparsers.add_parser(name)
        child.set_defaults(function=function)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        cast(Any, args.function)(args)
    except (VG18Error, subprocess.CalledProcessError, OSError) as error:
        print(f"VG18_ERROR {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
