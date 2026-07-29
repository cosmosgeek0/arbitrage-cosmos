#!/usr/bin/env python3
"""Sealed Binance-public-only V-G38 quote-volume VoV-compression experiment.

The command boundary is intentionally narrow:

* ``freeze`` authenticates compressed monthly ZIP bytes and their official
  checksum sidecars from the shared read-only corpus without opening a member.
* ``run`` consumes an exclusive marker, evaluates development, seals at most
  one champion, and opens the chronological holdout at most once.
* ``verify`` authenticates the frozen sources and terminal packet without
  rerunning or decompressing the experiment.

The strategy is one causal cohort-or-cash law.  For BTCUSDT only, it compares
the median absolute deviation of log quote-volume changes in a recent window
with the same statistic in a disjoint prior window.  The last feature bar is
two UTC days before the traded open, leaving one complete unused bar between
feature and execution.  When the ratio is at or below the frozen threshold,
the current notional enters the complete predeclared cohort in equal weights;
units remain fixed until exit.  Otherwise it holds USDT cash.  The score does
not contain a quote-volume level, one-bar shock predicate, entropy, turnover,
seasonality, peer aggregate, or synchronization term.
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
import subprocess
import sys
import zipfile
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal, InvalidOperation, getcontext
from fractions import Fraction
from pathlib import Path
from typing import cast

from quant_edge.labels.rational import ExactRatioV1, make_ratio
from quant_edge.validation.bootstrap import (
    BootstrapSpecV1,
    BootstrapStatus,
    block_bootstrap_interval,
)
from quant_edge.validation.multiplicity import (
    PboStatus,
    TrialLedgerV1,
    TrialRecordV1,
    TrialStatus,
    holm_bonferroni,
)
from quant_edge.validation.multiplicity import (
    pbo_cscv as q14_pbo_cscv,
)

getcontext().prec = 50

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[2]
INIT_PATH = HERE / "__init__.py"
PROTOCOL_PATH = HERE / "protocol.v1.json"
SOURCE_RESEARCH_PATH = HERE / "OFFICIAL_SOURCE_RESEARCH.md"
README_PATH = HERE / "README.md"
TEST_PATH = HERE / "test_experiment.py"
VERIFY_PATH = HERE / "verify.py"
SOURCE_MANIFEST_PATH = HERE / "source-manifest.v1.json"
FREEZE_PATH = HERE / "freeze.v1.json"
RUN_MARKER_PATH = HERE / "run-marker.v1.json"
CANDIDATE_SEAL_PATH = HERE / "candidate-seal.v1.json"
HOLDOUT_OPEN_PATH = HERE / "holdout-open.v1.json"
RESULT_PATH = HERE / "result.v1.json"
SHA256SUMS_PATH = HERE / "SHA256SUMS"

BASE_COMMIT = "a169b123fb186d1943a75ad648552c4d95be1be1"
PUBLIC_DATA_COMMIT = "5c7f3197591c0d54d85dc43066226bc4c671d47a"
SPOT_DOCS_COMMIT = "6b8372cad7cecbdf5dd88a3372eafff51988c5cf"
SOURCE_ROOT = Path("/private/tmp/cosmos-vg26-price-volume-correlation-v1")
SOURCE_ACQUISITION = SOURCE_ROOT / "acquisition-manifest.v1.json"
SOURCE_ACQUISITION_SHA256 = "fb9335c4372b979cb930bee059e41f02db355973ddf1e1ae4d878b828df3517a"
ARCHIVE_BASE_URL = "https://data.binance.vision/data/spot/monthly/klines"

COHORT = (
    "BTCUSDT",
    "ETHUSDT",
    "BNBUSDT",
    "XRPUSDT",
    "ADAUSDT",
    "DOGEUSDT",
    "SOLUSDT",
    "TRXUSDT",
    "LTCUSDT",
    "BCHUSDT",
    "LINKUSDT",
    "AVAXUSDT",
)
SOURCE_MONTHS = (
    "2025-01",
    "2025-02",
    "2025-03",
    "2025-04",
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
)
DEVELOPMENT_SOURCE_MONTHS = frozenset(SOURCE_MONTHS[:12])
HOLDOUT_SOURCE_MONTHS = frozenset(SOURCE_MONTHS[12:])
DEVELOPMENT_MONTHS = tuple(SOURCE_MONTHS[2:12])
HOLDOUT_MONTHS = tuple(SOURCE_MONTHS[12:])
SOURCE_START = date(2025, 1, 1)
DEVELOPMENT_START = date(2025, 3, 3)
DEVELOPMENT_END = date(2026, 1, 1)
HOLDOUT_START = date(2026, 1, 2)
HOLDOUT_END = date(2026, 4, 1)

STARTING_NOTIONAL_USD = Decimal("1000")
PUBLIC_FEE_PER_SIDE = Decimal("0.0010")
BASE_ADVERSE_PER_SIDE = Decimal("0.0010")
STRESS_ADVERSE_PER_SIDE = Decimal("0.0025")
BASE_COST_PER_SIDE = PUBLIC_FEE_PER_SIDE + BASE_ADVERSE_PER_SIDE
STRESS_COST_PER_SIDE = PUBLIC_FEE_PER_SIDE + STRESS_ADVERSE_PER_SIDE
CAPACITY_PARTICIPATION = Decimal("0.0001")
MAX_DRAWDOWN = Decimal("0.20")
BOOTSTRAP_SEED = 202_607_292_026
BOOTSTRAP_REPLICATES = 4_096
BOOTSTRAP_BLOCK_DAYS = 7
ONE_SIDED_ALPHA = Decimal("0.05")

CHECKSUM_RE = re.compile(r"^([0-9a-f]{64})[ \t]+\*?([^\r\n]+)[\r\n]*$")
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


class VG38Error(RuntimeError):
    """A terminal V-G38 custody, schema, protocol, or measurement error."""


@dataclass(frozen=True, slots=True)
class Trial:
    """One predeclared quote-volume-vov-compression regime configuration."""

    trial_id: str
    recent_days: int
    baseline_days: int
    compression_threshold: Decimal


@dataclass(frozen=True, slots=True)
class Bar:
    """One authenticated, fully closed UTC daily Binance Spot kline."""

    symbol: str
    day: date
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    base_volume: Decimal
    quote_volume: Decimal
    open_time_us: int
    close_time_us: int


@dataclass(slots=True)
class Portfolio:
    """A cash position or a fixed-unit holding of the complete cohort."""

    cash: Decimal
    units: dict[str, Decimal] | None = None


@dataclass(frozen=True, slots=True)
class ScenarioPath:
    """One cost scenario over an aligned daily segment."""

    ending_days: tuple[date, ...]
    daily_returns: tuple[Decimal, ...]
    benchmark_daily_returns: tuple[Decimal, ...]
    excess_daily_returns: tuple[Decimal, ...]
    equity_at_open: tuple[Decimal, ...]
    benchmark_equity_at_open: tuple[Decimal, ...]
    regime_scores: tuple[Decimal, ...]
    transition_legs: int
    on_days: int
    off_days: int
    transition_capacity_proxy_usd: tuple[Decimal, ...]


@dataclass(frozen=True, slots=True)
class TrialPaths:
    """Gross, base-cost, and stress-cost paths for one trial."""

    trial: Trial
    gross: ScenarioPath
    base: ScenarioPath
    stress: ScenarioPath


@dataclass(frozen=True, slots=True)
class BootstrapSummary:
    """Seeded circular-block inference for a daily path."""

    mean: Decimal
    one_sided_95_lcb: Decimal
    two_sided_90_ucb: Decimal
    one_sided_p_value: Decimal
    one_sided_p_exact: ExactRatioV1


@dataclass(frozen=True, slots=True)
class DevelopmentEvaluation:
    """Internal development metrics used for gate and candidate selection."""

    paths: TrialPaths
    absolute_bootstrap: BootstrapSummary
    excess_bootstrap: BootstrapSummary
    fold_returns: tuple[Decimal, ...]
    fold_excess_returns: tuple[Decimal, ...]
    max_drawdown: Decimal
    base_total_return: Decimal
    benchmark_total_return: Decimal
    base_excess_return: Decimal
    stress_mean: Decimal
    capacity_proxy_usd: Decimal | None
    holm_adjusted_p: Decimal
    holm_adjusted_p_exact: ExactRatioV1
    gates: Mapping[str, bool]


def sha256_path(path: Path) -> str:
    """Return a streaming SHA-256 digest."""

    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_bytes(value: object) -> bytes:
    """Encode JSON with one stable, newline-terminated representation."""

    return (
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n"
    ).encode()


def canonical_sha(value: object) -> str:
    """Hash the canonical JSON representation of a value."""

    return hashlib.sha256(canonical_bytes(value)).hexdigest()


def load_json(path: Path) -> dict[str, object]:
    """Load a JSON object and reject any other top-level shape."""

    with path.open("rb") as handle:
        value: object = json.load(handle)
    if not isinstance(value, dict):
        raise VG38Error(f"{path.name} must contain a JSON object")
    return cast(dict[str, object], value)


def write_json_once(path: Path, value: object) -> None:
    """Create an immutable JSON receipt or accept identical existing bytes."""

    payload = canonical_bytes(value)
    if path.exists():
        if path.read_bytes() != payload:
            raise VG38Error(f"refusing to replace non-identical {path.name}")
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
    except BaseException:
        path.unlink(missing_ok=True)
        raise


def write_bytes_once(path: Path, payload: bytes) -> None:
    """Create an immutable byte artifact and never refresh it."""

    if path.exists():
        raise VG38Error(f"refusing to refresh immutable {path.name}")
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
    except BaseException:
        path.unlink(missing_ok=True)
        raise


def utc_now() -> str:
    """Return a receipt timestamp; never use it in analytical selection."""

    return datetime.now(tz=UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def decimal_text(value: Decimal, places: int = 12) -> str:
    """Render deterministic fixed-point JSON text."""

    return format(value.quantize(Decimal(1).scaleb(-places)), "f")


def parse_decimal(raw: str, *, field: str, nonnegative: bool = False) -> Decimal:
    """Parse a finite decimal and enforce its declared sign domain."""

    try:
        value = Decimal(raw)
    except InvalidOperation as error:
        raise VG38Error(f"{field} is not a decimal") from error
    if not value.is_finite() or (nonnegative and value < 0):
        raise VG38Error(f"{field} is outside its declared decimal domain")
    return value


def date_range(start: date, end_exclusive: date) -> tuple[date, ...]:
    """Return every calendar day in a half-open UTC interval."""

    days = (end_exclusive - start).days
    if days < 0:
        raise VG38Error("date range is reversed")
    return tuple(start + timedelta(days=offset) for offset in range(days))


def month_bounds(month: str) -> tuple[date, date]:
    """Return the half-open calendar bounds for a YYYY-MM month."""

    try:
        start = date.fromisoformat(f"{month}-01")
    except ValueError as error:
        raise VG38Error(f"invalid source month {month}") from error
    end = date(start.year + 1, 1, 1) if start.month == 12 else date(start.year, start.month + 1, 1)
    return start, end


def median_decimal(values: Sequence[Decimal]) -> Decimal:
    """Return the exact median without binary floating-point conversion."""

    if not values:
        raise VG38Error("median requires at least one value")
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) / 2


def mean_decimal(values: Sequence[Decimal]) -> Decimal:
    """Return an exact arithmetic mean."""

    if not values:
        raise VG38Error("mean requires at least one value")
    return sum(values, Decimal(0)) / Decimal(len(values))


def mad_decimal(values: Sequence[Decimal]) -> Decimal:
    """Return exact median absolute deviation around the exact median."""

    center = median_decimal(values)
    return median_decimal(tuple(abs(value - center) for value in values))


def log_quote_volume_change(previous: Decimal, current: Decimal) -> Decimal:
    """Return ``ln(current / previous)`` for two strictly positive volumes."""

    if previous <= 0 or current <= 0:
        raise VG38Error("quote-volume log change requires positive inputs")
    return (current / previous).ln()


def decimal_ratio(value: Decimal) -> ExactRatioV1:
    """Convert one finite Decimal to Q14's reduced exact-rational contract."""

    if not value.is_finite():
        raise VG38Error("Q14 ratio conversion requires a finite Decimal")
    numerator, denominator = value.as_integer_ratio()
    return make_ratio(numerator, denominator)


def compound_return(values: Sequence[Decimal]) -> Decimal:
    """Compound a sequence of simple returns."""

    wealth = Decimal(1)
    for value in values:
        wealth *= Decimal(1) + value
    return wealth - Decimal(1)


def trial_grid() -> tuple[Trial, ...]:
    """Return the frozen 2-by-2-by-2 trial grid in stable order."""

    trials = [
        Trial(
            trial_id=(f"vg38-r{recent:02d}-b{baseline:02d}-c{int(threshold * 100):02d}"),
            recent_days=recent,
            baseline_days=baseline,
            compression_threshold=threshold,
        )
        for recent in (7, 14)
        for baseline in (30, 45)
        for threshold in (Decimal("0.50"), Decimal("0.75"))
    ]
    return tuple(sorted(trials, key=lambda trial: trial.trial_id))


def trial_mapping(trial: Trial) -> dict[str, object]:
    """Return the public JSON contract for one trial."""

    return {
        "baselineDays": trial.baseline_days,
        "compressionThreshold": format(trial.compression_threshold, "f"),
        "recentDays": trial.recent_days,
        "trialId": trial.trial_id,
    }


def git_output(*arguments: str) -> str:
    """Run a read-only Git query in the current isolated worktree."""

    completed = subprocess.run(
        ("git", *arguments),
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return completed.stdout.strip()


def git_commit_is_ancestor(ancestor: str, descendant: str) -> bool:
    """Return whether Git proves one commit is an ancestor of another."""

    completed = subprocess.run(
        ("git", "merge-base", "--is-ancestor", ancestor, descendant),
        cwd=REPO_ROOT,
        check=False,
        capture_output=True,
    )
    if completed.returncode not in {0, 1}:
        raise subprocess.CalledProcessError(
            completed.returncode,
            completed.args,
            output=completed.stdout,
            stderr=completed.stderr,
        )
    return completed.returncode == 0


def git_blob_sha256(commit: str, relative_path: str) -> str:
    """Hash exact bytes for one path as stored in a declared commit."""

    completed = subprocess.run(
        ("git", "show", f"{commit}:{relative_path}"),
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
    )
    return hashlib.sha256(completed.stdout).hexdigest()


def expected_archive_paths(symbol: str, month: str) -> tuple[Path, Path]:
    """Resolve one already-downloaded ZIP/checksum pair."""

    directory = SOURCE_ROOT / "archives" / symbol / month
    zip_path = directory / f"{symbol}-1d-{month}.zip"
    return zip_path, directory / f"{zip_path.name}.CHECKSUM"


def archive_url(symbol: str, month: str, *, checksum: bool = False) -> str:
    """Return one exact official monthly Spot daily-kline object URL."""

    name = f"{symbol}-1d-{month}.zip"
    if checksum:
        name += ".CHECKSUM"
    return f"{ARCHIVE_BASE_URL}/{symbol}/1d/{name}"


def verify_checksum_text(checksum_bytes: bytes, zip_name: str, zip_sha: str) -> None:
    """Validate an official Binance checksum sidecar against compressed bytes."""

    try:
        text = checksum_bytes.decode("ascii")
    except UnicodeDecodeError as error:
        raise VG38Error(f"{zip_name} checksum is not ASCII") from error
    match = CHECKSUM_RE.fullmatch(text)
    if match is None:
        raise VG38Error(f"{zip_name} checksum has invalid grammar")
    published_sha, published_name = match.groups()
    if published_name.strip() != zip_name:
        raise VG38Error(f"{zip_name} checksum names a different object")
    if published_sha != zip_sha:
        raise VG38Error(f"{zip_name} does not match its official checksum")


def mapping_list(value: object, *, field: str) -> list[dict[str, object]]:
    """Narrow an untyped JSON list to a list of object mappings."""

    if not isinstance(value, list) or any(not isinstance(item, dict) for item in value):
        raise VG38Error(f"{field} is not a list of objects")
    return cast(list[dict[str, object]], value)


def object_mapping(value: object, *, field: str) -> dict[str, object]:
    """Narrow an untyped JSON value to an object mapping."""

    if not isinstance(value, dict):
        raise VG38Error(f"{field} is not an object")
    return cast(dict[str, object], value)


def validate_protocol_contract(protocol: Mapping[str, object]) -> None:
    """Require the prose/JSON protocol to match executable frozen constants."""

    if protocol.get("schema") != "VG38QuoteVolumeVoVCompressionProtocolV1":
        raise VG38Error("protocol schema mismatch")
    if protocol.get("baseCommit") != BASE_COMMIT:
        raise VG38Error("protocol base commit mismatch")
    universe = object_mapping(protocol.get("universe"), field="universe")
    if universe.get("cohort") != list(COHORT) or universe.get("quoteAsset") != "USDT":
        raise VG38Error("protocol cohort or quote asset differs from evaluator")
    signal = object_mapping(protocol.get("signal"), field="signal")
    grid = object_mapping(signal.get("candidateGrid"), field="signal.candidateGrid")
    if grid != {
        "baselineCompleteChanges": [30, 45],
        "compressionRatioThreshold": ["0.50", "0.75"],
        "recentCompleteChanges": [7, 14],
        "trialCount": 8,
    }:
        raise VG38Error("protocol candidate grid differs from evaluator")
    data = object_mapping(protocol.get("data"), field="data")
    if (
        data.get("sourceMonths") != list(SOURCE_MONTHS)
        or data.get("warmupStartUtc") != "2025-01-01T00:00:00Z"
        or data.get("developmentStartUtc") != "2025-03-03T00:00:00Z"
        or data.get("developmentEndExclusiveUtc") != "2026-01-01T00:00:00Z"
        or data.get("holdoutStartUtc") != "2026-01-02T00:00:00Z"
        or data.get("holdoutEndExclusiveUtc") != "2026-04-01T00:00:00Z"
        or data.get("sourceCorpusRoot") != str(SOURCE_ROOT)
        or data.get("acquisitionManifestSha256") != SOURCE_ACQUISITION_SHA256
    ):
        raise VG38Error("protocol source or evaluation dates differ from evaluator")
    costs = object_mapping(protocol.get("costs"), field="costs")
    if (
        costs.get("publicRegularTakerFeeBpsPerExecutedSide") != 10
        or costs.get("baseAdversePriceBpsPerExecutedSide") != 10
        or costs.get("baseTotalBpsPerExecutedSide") != 20
        or costs.get("stressAdversePriceBpsPerExecutedSide") != 25
        or costs.get("stressTotalBpsPerExecutedSide") != 35
        or costs.get("accountEffectiveFeeTruth") != "UNKNOWN"
    ):
        raise VG38Error("protocol cost scenario differs from evaluator")
    inference = object_mapping(protocol.get("inference"), field="inference")
    if (
        inference.get("bootstrapBlockLengthDays") != BOOTSTRAP_BLOCK_DAYS
        or inference.get("bootstrapReplicates") != BOOTSTRAP_REPLICATES
        or inference.get("bootstrapSeed") != str(BOOTSTRAP_SEED)
        or inference.get("cscvBlocks") != "TEN_DEVELOPMENT_CALENDAR_MONTHS_CHOOSE_FIVE"
        or inference.get("multiplicity")
        != ("Q14_HOLM_BONFERRONI_OVER_ALL_EIGHT_EXCESS_ONE_SIDED_P_VALUES")
        or inference.get("pboGateMaximum") != "0.20"
    ):
        raise VG38Error("protocol inference contract differs from evaluator")
    bootstrap_seeds = object_mapping(
        inference.get("bootstrapSeeds"),
        field="inference.bootstrapSeeds",
    )
    if bootstrap_seeds != {
        "developmentAbsolute": str(BOOTSTRAP_SEED),
        "developmentExcess": str(BOOTSTRAP_SEED + 10_000),
        "holdoutAbsolute": str(BOOTSTRAP_SEED + 1),
        "holdoutExcess": str(BOOTSTRAP_SEED + 10_001),
    }:
        raise VG38Error("protocol bootstrap seed schedule differs from evaluator")
    development_gates = object_mapping(
        protocol.get("developmentGates"),
        field="developmentGates",
    )
    if development_gates != {
        "absoluteBaseOneSided95LcbMustExceedUsdPerDayPer1000": "0",
        "baseExcessTotalUsdPer1000MustExceed": "0",
        "excessOneSided95LcbMustExceedUsdPerDayPer1000": "0",
        "holmFamilywiseAlpha": "0.05",
        "maximumDrawdownFraction": "0.20",
        "minimumOffDays": 30,
        "minimumOnDays": 30,
        "minimumPositiveAbsoluteTwoMonthFolds": 4,
        "minimumPositiveExcessTwoMonthFolds": 4,
        "pboMustBeAvailableAndAtMost": "0.20",
        "stressExcessTotalUsdPer1000MustExceed": "0",
        "stressNetTotalUsdPer1000MustExceed": "0",
    }:
        raise VG38Error("protocol development gates differ from evaluator")
    holdout_gates = object_mapping(protocol.get("holdoutGates"), field="holdoutGates")
    if holdout_gates != {
        "absoluteBaseMeanMustExceedUsdPerDayPer1000": "0",
        "absoluteBaseOneSided95LcbMustExceedUsdPerDayPer1000": "0",
        "excessMeanMustExceedUsdPerDayPer1000": "0",
        "excessOneSided95LcbMustExceedUsdPerDayPer1000": "0",
        "excessOneSidedBootstrapPValueMustBeBelow": "0.05",
        "maximumDrawdownFraction": "0.20",
        "minimumOffDays": 10,
        "minimumOnDays": 10,
        "minimumPositiveAbsoluteCalendarMonths": 2,
        "minimumPositiveExcessCalendarMonths": 2,
        "stressExcessTotalUsdPer1000MustExceed": "0",
        "stressNetTotalUsdPer1000MustExceed": "0",
    }:
        raise VG38Error("protocol holdout gates differ from evaluator")
    provenance = object_mapping(protocol.get("provenance"), field="provenance")
    if provenance != {
        "binancePublicDataCommit": PUBLIC_DATA_COMMIT,
        "binanceSpotApiDocsCommit": SPOT_DOCS_COMMIT,
        "refreshDateUtc": "2026-07-29",
        "scope": "BINANCE_PUBLIC_ONLY_NO_CREDENTIALS_NO_SIGNED_ENDPOINTS",
    }:
        raise VG38Error("protocol official-source provenance differs from evaluator")


def source_artifact_row(pair: Mapping[str, object]) -> dict[str, object]:
    """Freeze one archive pair without opening its ZIP container."""

    symbol = str(pair.get("symbol", ""))
    month = str(pair.get("month", ""))
    if symbol not in COHORT or month not in SOURCE_MONTHS:
        raise VG38Error("source pair identity is outside the frozen matrix")
    if pair.get("zipUrl") != archive_url(symbol, month) or pair.get("checksumUrl") != archive_url(
        symbol, month, checksum=True
    ):
        raise VG38Error(f"source pair URL differs from protocol {symbol} {month}")
    zip_path, checksum_path = expected_archive_paths(symbol, month)
    if not zip_path.is_file() or not checksum_path.is_file():
        raise VG38Error(f"missing frozen source pair {symbol} {month}")
    if pair.get("state") != "DOWNLOADED_VERIFIED":
        raise VG38Error(f"source pair state is inadmissible for {symbol} {month}")
    zip_sha = sha256_path(zip_path)
    checksum_sha = sha256_path(checksum_path)
    if zip_sha != pair.get("zipSha256"):
        raise VG38Error(f"{zip_path.name} SHA-256 differs from acquisition receipt")
    if checksum_sha != pair.get("checksumSha256"):
        raise VG38Error(f"{checksum_path.name} SHA-256 differs from acquisition receipt")
    if zip_path.stat().st_size != int(str(pair.get("zipBytes", "-1"))):
        raise VG38Error(f"{zip_path.name} byte length differs from acquisition receipt")
    if checksum_path.stat().st_size != int(str(pair.get("checksumBytes", "-1"))):
        raise VG38Error(f"{checksum_path.name} byte length differs from acquisition receipt")
    verify_checksum_text(checksum_path.read_bytes(), zip_path.name, zip_sha)
    return {
        "checksumBytes": checksum_path.stat().st_size,
        "checksumEtag": pair.get("checksumFrozenEtag"),
        "checksumLastModified": pair.get("checksumFrozenLastModified"),
        "checksumPath": str(checksum_path.relative_to(SOURCE_ROOT)),
        "checksumSha256": checksum_sha,
        "checksumUrl": pair.get("checksumUrl"),
        "month": month,
        "symbol": symbol,
        "zipBytes": zip_path.stat().st_size,
        "zipEtag": pair.get("zipFrozenEtag"),
        "zipLastModified": pair.get("zipFrozenLastModified"),
        "zipPath": str(zip_path.relative_to(SOURCE_ROOT)),
        "zipSha256": zip_sha,
        "zipUrl": pair.get("zipUrl"),
    }


def build_source_manifest() -> dict[str, object]:
    """Freeze the exact 12-by-15 compressed public artifact matrix."""

    if not SOURCE_ACQUISITION.is_file():
        raise VG38Error("source acquisition receipt is absent")
    acquisition_sha = sha256_path(SOURCE_ACQUISITION)
    if acquisition_sha != SOURCE_ACQUISITION_SHA256:
        raise VG38Error("shared V-G26 acquisition manifest SHA-256 drift")
    acquisition = load_json(SOURCE_ACQUISITION)
    if (
        acquisition.get("schema") != "VG26BinancePublicAcquisitionV1"
        or acquisition.get("state") != "CHECKSUM_VERIFIED_ARCHIVES_NOT_DECOMPRESSED"
        or acquisition.get("archiveBodiesOpened") is not False
        or acquisition.get("archiveSourceCommit") != PUBLIC_DATA_COMMIT
        or acquisition.get("spotDocsCommit") != SPOT_DOCS_COMMIT
        or acquisition.get("artifactPairCount") != len(COHORT) * len(SOURCE_MONTHS)
    ):
        raise VG38Error("source acquisition state is inadmissible")
    pairs = mapping_list(acquisition.get("artifactPairs"), field="artifactPairs")
    wanted = {(symbol, month) for symbol in COHORT for month in SOURCE_MONTHS}
    selected_pairs: dict[tuple[str, str], Mapping[str, object]] = {}
    for pair in pairs:
        identity = (str(pair.get("symbol", "")), str(pair.get("month", "")))
        if identity not in wanted:
            continue
        if identity in selected_pairs:
            raise VG38Error(f"duplicate acquisition receipt {identity[0]} {identity[1]}")
        selected_pairs[identity] = pair
    missing = sorted(wanted - set(selected_pairs))
    if missing:
        symbol, month = missing[0]
        raise VG38Error(f"missing required acquisition receipt {symbol} {month}")
    artifacts = [
        source_artifact_row(selected_pairs[(symbol, month)])
        for symbol in COHORT
        for month in SOURCE_MONTHS
    ]
    if len(artifacts) != len(COHORT) * len(SOURCE_MONTHS):
        raise VG38Error("source artifact matrix is not exactly 12 by 15")
    return {
        "acquisitionManifestPath": str(SOURCE_ACQUISITION),
        "acquisitionManifestSha256": acquisition_sha,
        "archiveBodiesOpenedDuringFreeze": False,
        "archiveSourceCommit": PUBLIC_DATA_COMMIT,
        "artifactCount": len(artifacts),
        "artifacts": artifacts,
        "cohort": list(COHORT),
        "cohortSha256": canonical_sha(list(COHORT)),
        "monthCount": len(SOURCE_MONTHS),
        "months": list(SOURCE_MONTHS),
        "protocolSha256": sha256_path(PROTOCOL_PATH),
        "reuseLaw": "VG26_CORPUS_READ_ONLY_NO_SHARED_ARCHIVE_WRITE",
        "schema": "VG38FrozenBinancePublicSourceManifestV1",
        "sourceRoot": str(SOURCE_ROOT),
        "spotDocsCommit": SPOT_DOCS_COMMIT,
        "state": "CHECKSUM_VERIFIED_COMPRESSED_BYTES_NOT_OPENED_BY_VG38",
        "symbolCount": len(COHORT),
    }


def required_document_hashes() -> dict[str, str]:
    """Bind the frozen protocol and explanatory documents."""

    for path in (
        INIT_PATH,
        PROTOCOL_PATH,
        SOURCE_RESEARCH_PATH,
        README_PATH,
        TEST_PATH,
        VERIFY_PATH,
    ):
        if not path.is_file():
            raise VG38Error(f"required protocol document is absent: {path.name}")
    return {
        "initSha256": sha256_path(INIT_PATH),
        "officialSourceResearchSha256": sha256_path(SOURCE_RESEARCH_PATH),
        "protocolSha256": sha256_path(PROTOCOL_PATH),
        "readmeSha256": sha256_path(README_PATH),
        "testSha256": sha256_path(TEST_PATH),
        "verifierSha256": sha256_path(VERIFY_PATH),
    }


def freeze() -> None:
    """Seal protocol and compressed sources before any archive is opened."""

    if RUN_MARKER_PATH.exists() or RESULT_PATH.exists():
        raise VG38Error("freeze is forbidden after the one-run marker")
    git_output("cat-file", "-e", f"{BASE_COMMIT}^{{commit}}")
    if git_output("merge-base", "--is-ancestor", BASE_COMMIT, "HEAD"):
        raise VG38Error("unexpected merge-base output")
    if git_output("status", "--porcelain"):
        raise VG38Error("freeze requires committed protocol and a clean worktree")
    protocol = load_json(PROTOCOL_PATH)
    validate_protocol_contract(protocol)
    manifest = build_source_manifest()
    write_json_once(SOURCE_MANIFEST_PATH, manifest)
    hashes = required_document_hashes()
    receipt: dict[str, object] = {
        "archiveBodiesOpened": False,
        "baseCommit": BASE_COMMIT,
        "cohortSha256": canonical_sha(list(COHORT)),
        "createdAtUtc": utc_now(),
        "evaluatorPath": "quant/research/vg38/experiment.py",
        "evaluatorSha256": sha256_path(Path(__file__)),
        "gitHead": git_output("rev-parse", "HEAD"),
        "schema": "VG38PreOutcomeFreezeV1",
        "sourceManifestSha256": sha256_path(SOURCE_MANIFEST_PATH),
        "state": "READY_FOR_SOLE_ARCHIVE_DECOMPRESSION_RUN",
        "trialGridSha256": canonical_sha([trial_mapping(trial) for trial in trial_grid()]),
    }
    receipt.update(hashes)
    write_json_once(FREEZE_PATH, receipt)
    print(f"FROZEN artifacts={manifest['artifactCount']} source={receipt['sourceManifestSha256']}")


def parse_timestamp_us(raw: str, *, field: str) -> tuple[int, datetime]:
    """Parse Binance's post-2025 public-archive microsecond timestamps."""

    try:
        value = int(raw)
    except ValueError as error:
        raise VG38Error(f"{field} is not an integer timestamp") from error
    if value < 1_000_000_000_000_000:
        raise VG38Error(f"{field} is not a post-2025 microsecond timestamp")
    seconds, microseconds = divmod(value, 1_000_000)
    try:
        parsed = datetime.fromtimestamp(seconds, tz=UTC) + timedelta(microseconds=microseconds)
    except (OverflowError, OSError, ValueError) as error:
        raise VG38Error(f"{field} timestamp is outside the supported range") from error
    return value, parsed


def parse_archive(artifact: Mapping[str, object]) -> tuple[Bar, ...]:
    """Open one post-freeze monthly archive and validate every daily row."""

    symbol = str(artifact.get("symbol", ""))
    month = str(artifact.get("month", ""))
    zip_path = SOURCE_ROOT / str(artifact.get("zipPath", ""))
    checksum_path = SOURCE_ROOT / str(artifact.get("checksumPath", ""))
    if symbol not in COHORT or month not in SOURCE_MONTHS:
        raise VG38Error("source artifact identity is outside the frozen matrix")
    if sha256_path(zip_path) != artifact.get("zipSha256"):
        raise VG38Error(f"{zip_path.name} changed after freeze")
    if sha256_path(checksum_path) != artifact.get("checksumSha256"):
        raise VG38Error(f"{checksum_path.name} changed after freeze")
    verify_checksum_text(
        checksum_path.read_bytes(),
        zip_path.name,
        str(artifact.get("zipSha256", "")),
    )
    if zip_path.stat().st_size > 10_000_000:
        raise VG38Error(f"{zip_path.name} exceeds the frozen parser bound")

    bars: list[Bar] = []
    with zipfile.ZipFile(zip_path) as archive:
        members = archive.infolist()
        if len(members) != 1 or members[0].is_dir():
            raise VG38Error(f"{zip_path.name} must contain exactly one regular member")
        member = members[0]
        expected_member = zip_path.name.removesuffix(".zip") + ".csv"
        if member.filename != expected_member or member.file_size > 20_000_000:
            raise VG38Error(f"{zip_path.name} member identity or size is invalid")
        with archive.open(member, "r") as raw:
            wrapper = io.TextIOWrapper(raw, encoding="ascii", newline="")
            reader = csv.reader(wrapper)
            for row_number, row in enumerate(reader, start=1):
                if row_number == 1 and tuple(row) == KLINE_HEADER:
                    continue
                if len(row) != 12:
                    raise VG38Error(f"{zip_path.name}:{row_number} does not have 12 kline fields")
                open_us, open_datetime = parse_timestamp_us(row[0], field="openTime")
                close_us, close_datetime = parse_timestamp_us(row[6], field="closeTime")
                if open_datetime.time() != datetime.min.time():
                    raise VG38Error(f"{zip_path.name}:{row_number} is not a UTC daily open")
                if open_datetime.strftime("%Y-%m") != month:
                    raise VG38Error(f"{zip_path.name}:{row_number} lies outside its month")
                if close_us != open_us + 86_400_000_000 - 1:
                    raise VG38Error(f"{zip_path.name}:{row_number} close boundary is invalid")
                if close_datetime.date() != open_datetime.date():
                    raise VG38Error(f"{zip_path.name}:{row_number} is not a closed daily bar")
                open_price = parse_decimal(row[1], field="open", nonnegative=True)
                high = parse_decimal(row[2], field="high", nonnegative=True)
                low = parse_decimal(row[3], field="low", nonnegative=True)
                close = parse_decimal(row[4], field="close", nonnegative=True)
                base_volume = parse_decimal(row[5], field="volume", nonnegative=True)
                quote_volume = parse_decimal(row[7], field="quoteVolume", nonnegative=True)
                taker_base = parse_decimal(row[9], field="takerBuyVolume", nonnegative=True)
                taker_quote = parse_decimal(row[10], field="takerBuyQuoteVolume", nonnegative=True)
                parse_decimal(row[11], field="ignore", nonnegative=True)
                try:
                    trade_count = int(row[8])
                except ValueError as error:
                    raise VG38Error(
                        f"{zip_path.name}:{row_number} trade count is not an integer"
                    ) from error
                if (
                    open_price <= 0
                    or high <= 0
                    or low <= 0
                    or close <= 0
                    or base_volume <= 0
                    or quote_volume <= 0
                    or high < max(open_price, close, low)
                    or low > min(open_price, close, high)
                ):
                    raise VG38Error(
                        f"{zip_path.name}:{row_number} violates OHLC or positive-volume bounds"
                    )
                if trade_count < 0 or taker_base > base_volume or taker_quote > quote_volume:
                    raise VG38Error(f"{zip_path.name}:{row_number} violates volume/count bounds")
                bars.append(
                    Bar(
                        symbol=symbol,
                        day=open_datetime.date(),
                        open=open_price,
                        high=high,
                        low=low,
                        close=close,
                        base_volume=base_volume,
                        quote_volume=quote_volume,
                        open_time_us=open_us,
                        close_time_us=close_us,
                    )
                )

    expected_days = date_range(*month_bounds(month))
    actual_days = tuple(bar.day for bar in bars)
    if len(actual_days) != len(set(actual_days)):
        raise VG38Error(f"{zip_path.name} contains duplicate UTC daily rows")
    if actual_days != tuple(sorted(actual_days)):
        raise VG38Error(f"{zip_path.name} daily rows are unsorted")
    if actual_days != expected_days:
        raise VG38Error(f"{zip_path.name} has a UTC calendar gap or extra row")
    return tuple(bars)


def manifest_artifacts(source_manifest: Mapping[str, object]) -> list[dict[str, object]]:
    """Return and validate the source-manifest artifact inventory."""

    artifacts = mapping_list(source_manifest.get("artifacts"), field="artifacts")
    if len(artifacts) != len(COHORT) * len(SOURCE_MONTHS):
        raise VG38Error("source manifest artifact count is not exactly 180")
    identities = {
        (str(artifact.get("symbol", "")), str(artifact.get("month", ""))) for artifact in artifacts
    }
    expected = {(symbol, month) for symbol in COHORT for month in SOURCE_MONTHS}
    if identities != expected:
        raise VG38Error("source manifest artifact matrix differs from the protocol")
    return artifacts


def load_bars(
    source_manifest: Mapping[str, object],
    months: frozenset[str],
    existing: Mapping[str, Mapping[date, Bar]] | None = None,
) -> dict[str, dict[date, Bar]]:
    """Open only declared source months and reject all duplicate/gap states."""

    if not months.issubset(set(SOURCE_MONTHS)):
        raise VG38Error("requested source month is outside the frozen matrix")
    loaded = {
        symbol: dict(by_day)
        for symbol, by_day in (existing.items() if existing is not None else ())
    }
    selected = [
        artifact
        for artifact in manifest_artifacts(source_manifest)
        if str(artifact.get("month", "")) in months
    ]
    expected_count = len(COHORT) * len(months)
    if len(selected) != expected_count:
        raise VG38Error("requested source slice is incomplete")
    for artifact in sorted(
        selected,
        key=lambda item: (str(item.get("symbol", "")), str(item.get("month", ""))),
    ):
        for bar in parse_archive(artifact):
            by_day = loaded.setdefault(bar.symbol, {})
            if bar.day in by_day:
                raise VG38Error(f"duplicate daily bar {bar.symbol} {bar.day.isoformat()}")
            by_day[bar.day] = bar

    requested_days = tuple(
        day for month in sorted(months) for day in date_range(*month_bounds(month))
    )
    for symbol in COHORT:
        cohort_days = loaded.get(symbol)
        if cohort_days is None:
            raise VG38Error(f"required cohort member is absent: {symbol}")
        absent = [day for day in requested_days if day not in cohort_days]
        if absent:
            raise VG38Error(f"required daily bar gap {symbol} {absent[0].isoformat()}")
    return loaded


def prices_at_open(
    bars: Mapping[str, Mapping[date, Bar]],
    day: date,
) -> dict[str, Decimal]:
    """Return all twelve opening prices or fail closed."""

    prices: dict[str, Decimal] = {}
    for symbol in COHORT:
        try:
            prices[symbol] = bars[symbol][day].open
        except KeyError as error:
            raise VG38Error(f"missing cohort open {symbol} {day.isoformat()}") from error
    return prices


def regime_score_at_open(
    bars: Mapping[str, Mapping[date, Bar]],
    trial: Trial,
    open_day: date,
) -> Decimal:
    """Return BTC's strictly lagged recent/prior quote-volume-change MAD.

    ``signal_day`` is D-2 for an entry at D open, so D-1 is a complete,
    deliberately unused gap bar.  The baseline and recent change windows are
    adjacent to each other but disjoint.  Prices and every peer symbol are
    excluded from the score.
    """

    signal_day = open_day - timedelta(days=2)
    change_count = trial.baseline_days + trial.recent_days
    history_days = tuple(
        signal_day - timedelta(days=offset) for offset in range(change_count, -1, -1)
    )
    try:
        quote_volumes = tuple(bars["BTCUSDT"][day].quote_volume for day in history_days)
    except KeyError as error:
        raise VG38Error(f"lagged BTC quote-volume input gap {open_day.isoformat()}") from error
    changes = tuple(
        log_quote_volume_change(previous, current)
        for previous, current in itertools.pairwise(quote_volumes)
    )
    if len(changes) != change_count:
        raise VG38Error("quote-volume change window length mismatch")
    baseline = changes[: trial.baseline_days]
    recent = changes[trial.baseline_days :]
    if len(baseline) != trial.baseline_days or len(recent) != trial.recent_days:
        raise VG38Error("compression windows overlap or have wrong length")
    baseline_mad = mad_decimal(baseline)
    if baseline_mad <= 0:
        raise VG38Error(f"lagged baseline quote-volume MAD is non-positive {open_day.isoformat()}")
    recent_mad = mad_decimal(recent)
    return recent_mad / baseline_mad


def target_at_open(
    bars: Mapping[str, Mapping[date, Bar]],
    trial: Trial,
    open_day: date,
) -> bool:
    """Return the causal regime state determined before the target open."""

    return regime_score_at_open(bars, trial, open_day) <= trial.compression_threshold


def capacity_at_open(
    bars: Mapping[str, Mapping[date, Bar]],
    open_day: date,
) -> Decimal:
    """Public participation sensitivity from quote volume ending at D-2.

    Because the cohort receives equal notional, the least-liquid constituent
    bounds each one-twelfth allocation.  The total proxy is therefore twelve
    times the smallest per-symbol 1 bp quote-volume amount.  The D-1 gap bar is
    unused by this diagnostic as well as by the signal.
    """

    signal_day = open_day - timedelta(days=2)
    lagged_days = tuple(signal_day - timedelta(days=offset) for offset in range(29, -1, -1))
    try:
        least = min(
            median_decimal(tuple(bars[symbol][day].quote_volume for day in lagged_days))
            for symbol in COHORT
        )
    except KeyError as error:
        raise VG38Error(f"lagged capacity input gap {open_day.isoformat()}") from error
    return Decimal(len(COHORT)) * least * CAPACITY_PARTICIPATION


def marked_value(portfolio: Portfolio, prices: Mapping[str, Decimal]) -> Decimal:
    """Mark cash or fixed units at one cohort opening vector."""

    if portfolio.units is None:
        return portfolio.cash
    return sum(
        (portfolio.units[symbol] * prices[symbol] for symbol in COHORT),
        Decimal(0),
    )


def transition_at_open(
    portfolio: Portfolio,
    target_on: bool,
    prices: Mapping[str, Decimal],
    side_cost: Decimal,
) -> bool:
    """Apply an all-cohort entry or all-cohort exit at one open.

    Costs are proportional to risky notional.  Entry notional is solved as
    ``cash / (1 + side_cost)`` so notional plus costs exactly equals available
    cash.  Exit costs are deducted from gross sale proceeds.
    """

    if target_on and portfolio.units is None:
        risky_notional = portfolio.cash / (Decimal(1) + side_cost)
        per_symbol = risky_notional / Decimal(len(COHORT))
        portfolio.units = {symbol: per_symbol / prices[symbol] for symbol in COHORT}
        portfolio.cash = Decimal(0)
        return True
    if not target_on and portfolio.units is not None:
        gross_sale = marked_value(portfolio, prices)
        portfolio.cash = gross_sale * (Decimal(1) - side_cost)
        portfolio.units = None
        return True
    return False


def simulate_scenario(
    bars: Mapping[str, Mapping[date, Bar]],
    trial: Trial,
    start: date,
    end_exclusive: date,
    side_cost: Decimal,
) -> ScenarioPath:
    """Simulate fixed units between causal regime transitions.

    The final available open is a mandatory segment liquidation point.  This
    keeps development independent of the first holdout bar and keeps holdout
    independent of any post-window price.
    """

    open_days = date_range(start, end_exclusive)
    if len(open_days) < 2:
        raise VG38Error("simulation segment requires at least two opens")
    scores = [regime_score_at_open(bars, trial, day) for day in open_days]
    targets = [score <= trial.compression_threshold for score in scores]
    targets[-1] = False
    portfolio = Portfolio(cash=STARTING_NOTIONAL_USD)
    benchmark = Portfolio(cash=STARTING_NOTIONAL_USD)
    first_prices = prices_at_open(bars, open_days[0])
    prior_equity = STARTING_NOTIONAL_USD
    prior_benchmark_equity = STARTING_NOTIONAL_USD
    transition_legs = 0
    capacities: list[Decimal] = []
    if transition_at_open(portfolio, targets[0], first_prices, side_cost):
        transition_legs += 1
        capacities.append(capacity_at_open(bars, open_days[0]))
    if not transition_at_open(benchmark, True, first_prices, side_cost):
        raise VG38Error("always-on benchmark failed to enter at its first open")

    daily_returns: list[Decimal] = []
    benchmark_daily_returns: list[Decimal] = []
    excess_daily_returns: list[Decimal] = []
    ending_days: list[date] = []
    equity_at_open: list[Decimal] = [marked_value(portfolio, first_prices)]
    benchmark_equity_at_open: list[Decimal] = [marked_value(benchmark, first_prices)]
    for index in range(1, len(open_days)):
        day = open_days[index]
        prices = prices_at_open(bars, day)
        transitioned = transition_at_open(portfolio, targets[index], prices, side_cost)
        if transitioned:
            transition_legs += 1
            capacities.append(capacity_at_open(bars, day))
        benchmark_target = index != len(open_days) - 1
        transition_at_open(benchmark, benchmark_target, prices, side_cost)
        equity = marked_value(portfolio, prices)
        benchmark_equity = marked_value(benchmark, prices)
        if prior_equity <= 0 or equity <= 0 or prior_benchmark_equity <= 0 or benchmark_equity <= 0:
            raise VG38Error("simulated equity is non-positive")
        daily_return = equity / prior_equity - Decimal(1)
        benchmark_daily_return = benchmark_equity / prior_benchmark_equity - Decimal(1)
        daily_returns.append(daily_return)
        benchmark_daily_returns.append(benchmark_daily_return)
        excess_daily_returns.append(daily_return - benchmark_daily_return)
        ending_days.append(day)
        equity_at_open.append(equity)
        benchmark_equity_at_open.append(benchmark_equity)
        prior_equity = equity
        prior_benchmark_equity = benchmark_equity

    return ScenarioPath(
        ending_days=tuple(ending_days),
        daily_returns=tuple(daily_returns),
        benchmark_daily_returns=tuple(benchmark_daily_returns),
        excess_daily_returns=tuple(excess_daily_returns),
        equity_at_open=tuple(equity_at_open),
        benchmark_equity_at_open=tuple(benchmark_equity_at_open),
        regime_scores=tuple(scores[:-1]),
        transition_legs=transition_legs,
        on_days=sum(targets[:-1]),
        off_days=len(targets[:-1]) - sum(targets[:-1]),
        transition_capacity_proxy_usd=tuple(capacities),
    )


def simulate_segment(
    bars: Mapping[str, Mapping[date, Bar]],
    trial: Trial,
    start: date,
    end_exclusive: date,
) -> TrialPaths:
    """Simulate all three cost scenarios on one aligned segment."""

    gross = simulate_scenario(bars, trial, start, end_exclusive, Decimal(0))
    base = simulate_scenario(bars, trial, start, end_exclusive, BASE_COST_PER_SIDE)
    stress = simulate_scenario(bars, trial, start, end_exclusive, STRESS_COST_PER_SIDE)
    if not (
        gross.ending_days == base.ending_days == stress.ending_days
        and gross.regime_scores == base.regime_scores == stress.regime_scores
        and gross.transition_legs == base.transition_legs == stress.transition_legs
        and gross.on_days == base.on_days == stress.on_days
        and gross.off_days == base.off_days == stress.off_days
        and gross.transition_capacity_proxy_usd
        == base.transition_capacity_proxy_usd
        == stress.transition_capacity_proxy_usd
    ):
        raise VG38Error("cost-scenario paths are not aligned")
    return TrialPaths(trial=trial, gross=gross, base=base, stress=stress)


def circular_block_bootstrap(
    daily_returns: Sequence[Decimal],
    *,
    seed: int,
) -> BootstrapSummary:
    """Compute seeded one-sided inference using circular seven-day blocks."""

    if len(daily_returns) < BOOTSTRAP_BLOCK_DAYS * 2:
        raise VG38Error("daily path is too short for circular-block inference")
    exact_values = tuple(decimal_ratio(value) for value in daily_returns)
    q14_interval = block_bootstrap_interval(
        exact_values,
        BootstrapSpecV1(
            seed=seed,
            block_length=BOOTSTRAP_BLOCK_DAYS,
            replicates=BOOTSTRAP_REPLICATES,
            coverage_per_myriad=9_000,
        ),
    )
    if (
        q14_interval.status is not BootstrapStatus.AVAILABLE
        or q14_interval.point_estimate is None
        or q14_interval.lower is None
        or q14_interval.upper is None
    ):
        raise VG38Error(f"Q14 block bootstrap unavailable: {q14_interval.reason}")

    # The Q14 interval is binding.  A separate seeded centered bootstrap
    # supplies the one-sided p-value because Q14 intentionally exposes only
    # the exact interval contract.
    randomizer = random.Random(seed)
    replicate_means: list[Decimal] = []
    length = len(daily_returns)
    while len(replicate_means) < BOOTSTRAP_REPLICATES:
        sample: list[Decimal] = []
        while len(sample) < length:
            start = randomizer.randrange(length)
            sample.extend(
                daily_returns[(start + offset) % length] for offset in range(BOOTSTRAP_BLOCK_DAYS)
            )
        replicate_means.append(mean_decimal(sample[:length]))
    replicate_means.sort()
    observed = mean_decimal(daily_returns)
    null_exceedances = sum(
        replicate_mean - observed >= observed for replicate_mean in replicate_means
    )
    p_exact = make_ratio(null_exceedances + 1, BOOTSTRAP_REPLICATES + 1)
    p_value = Decimal(p_exact.numerator) / Decimal(p_exact.denominator)
    fixed_scale = Decimal(10**12)
    return BootstrapSummary(
        mean=Decimal(q14_interval.point_estimate.mantissa) / fixed_scale,
        one_sided_95_lcb=Decimal(q14_interval.lower.mantissa) / fixed_scale,
        two_sided_90_ucb=Decimal(q14_interval.upper.mantissa) / fixed_scale,
        one_sided_p_value=p_value,
        one_sided_p_exact=p_exact,
    )


def max_drawdown_from_equity(equity_values: Sequence[Decimal]) -> Decimal:
    """Return positive peak-to-trough drawdown over an explicit equity path."""

    if not equity_values or any(value <= 0 for value in equity_values):
        raise VG38Error("drawdown requires a nonempty positive equity path")
    peak = equity_values[0]
    worst = Decimal(0)
    for equity in equity_values:
        peak = max(peak, equity)
        worst = max(worst, Decimal(1) - equity / peak)
    return worst


def marked_open_drawdown(path: ScenarioPath) -> Decimal:
    """Measure drawdown from starting cash through every post-transition open mark."""

    return max_drawdown_from_equity(
        (STARTING_NOTIONAL_USD, *path.equity_at_open),
    )


def fold_compound_returns(
    ending_days: Sequence[date],
    daily_returns: Sequence[Decimal],
    month_folds: Sequence[Sequence[str]],
) -> tuple[Decimal, ...]:
    """Compound aligned daily returns into predeclared calendar folds."""

    if len(ending_days) != len(daily_returns):
        raise VG38Error("daily date and return paths differ in length")
    output: list[Decimal] = []
    for fold in month_folds:
        members = [
            value
            for day, value in zip(ending_days, daily_returns, strict=True)
            if day.strftime("%Y-%m") in fold
        ]
        if not members:
            raise VG38Error(f"calendar fold has no observations: {fold}")
        output.append(compound_return(members))
    return tuple(output)


def fold_excess_returns(
    ending_days: Sequence[date],
    strategy_daily_returns: Sequence[Decimal],
    benchmark_daily_returns: Sequence[Decimal],
    month_folds: Sequence[Sequence[str]],
) -> tuple[Decimal, ...]:
    """Return economic fold excess as strategy compound minus benchmark compound."""

    strategy_folds = fold_compound_returns(
        ending_days,
        strategy_daily_returns,
        month_folds,
    )
    benchmark_folds = fold_compound_returns(
        ending_days,
        benchmark_daily_returns,
        month_folds,
    )
    return tuple(
        strategy - benchmark
        for strategy, benchmark in zip(
            strategy_folds,
            benchmark_folds,
            strict=True,
        )
    )


def holm_adjusted(
    raw_p_values: Mapping[str, ExactRatioV1],
) -> dict[str, ExactRatioV1]:
    """Return exact Holm-adjusted values; Q14 decisions remain binding."""

    ordered = sorted(
        raw_p_values.items(),
        key=lambda item: (
            Fraction(item[1].numerator, item[1].denominator),
            item[0],
        ),
    )
    count = len(ordered)
    adjusted: dict[str, ExactRatioV1] = {}
    running = Fraction(0)
    for rank, (trial_id, p_value) in enumerate(ordered):
        fraction = Fraction(p_value.numerator, p_value.denominator)
        candidate = min(Fraction(1), (count - rank) * fraction)
        running = max(running, candidate)
        adjusted[trial_id] = make_ratio(running.numerator, running.denominator)
    return adjusted


def q14_trial_ledger() -> TrialLedgerV1:
    """Bind all eight attempts to the repository's exact trial-ledger law."""

    return TrialLedgerV1(
        trials=tuple(
            TrialRecordV1(
                trial_id=trial.trial_id,
                family_id="vg38-vov-compression",
                model_id=trial.trial_id,
                metric_id="base-excess-mean",
                status=TrialStatus.COMPLETED,
                note="frozen public-data trial",
            )
            for trial in trial_grid()
        )
    )


def cscv_pbo(evaluations: Sequence[DevelopmentEvaluation]) -> dict[str, object]:
    """Run Q14 CSCV-PBO over ten aligned development calendar months."""

    if not evaluations:
        raise VG38Error("PBO requires development evaluations")
    block_scores = tuple(
        tuple(
            decimal_ratio(value)
            for value in fold_excess_returns(
                evaluation.paths.base.ending_days,
                evaluation.paths.base.daily_returns,
                evaluation.paths.base.benchmark_daily_returns,
                tuple((month,) for month in DEVELOPMENT_MONTHS),
            )
        )
        for evaluation in evaluations
    )
    distinct_paths = len(set(block_scores))
    if distinct_paths < 2:
        return {
            "blockCount": len(DEVELOPMENT_MONTHS),
            "distinctTrialPathCount": distinct_paths,
            "gateAtMost020": False,
            "method": "Q14_CSCV_10_MONTHS_CHOOSE_5",
            "pbo": None,
            "splitCount": 0,
            "status": "INVALID_DISTINCT_PATHS_BELOW_2",
            "underperformCount": 0,
        }
    report = q14_pbo_cscv(block_scores)
    if report.status is not PboStatus.AVAILABLE or report.pbo is None:
        return {
            "blockCount": report.block_count,
            "distinctTrialPathCount": distinct_paths,
            "gateAtMost020": False,
            "method": "Q14_CSCV_10_MONTHS_CHOOSE_5",
            "pbo": None,
            "reason": report.reason,
            "splitCount": report.split_count,
            "status": "INVALID",
            "underperformCount": report.underperform_count,
        }
    pbo_value = Decimal(report.pbo.mantissa) / Decimal(10**12)
    return {
        "blockCount": report.block_count,
        "distinctTrialPathCount": distinct_paths,
        "gateAtMost020": pbo_value <= Decimal("0.20"),
        "method": "Q14_CSCV_10_MONTHS_CHOOSE_5",
        "pbo": decimal_text(pbo_value),
        "splitCount": report.split_count,
        "status": "AVAILABLE",
        "underperformCount": report.underperform_count,
    }


def scenario_metrics(path: ScenarioPath) -> dict[str, object]:
    """Serialize core metrics for one cost scenario."""

    total_return = compound_return(path.daily_returns)
    benchmark_total_return = compound_return(path.benchmark_daily_returns)
    excess_total_return = total_return - benchmark_total_return
    return {
        "alwaysOnBenchmarkEndingEquityUsdPer1000": decimal_text(
            STARTING_NOTIONAL_USD * (Decimal(1) + benchmark_total_return)
        ),
        "alwaysOnBenchmarkTotalReturn": decimal_text(benchmark_total_return),
        "alwaysOnBenchmarkTotalUsdPer1000": decimal_text(
            STARTING_NOTIONAL_USD * benchmark_total_return
        ),
        "dailyObservationCount": len(path.daily_returns),
        "endingEquityUsdPer1000": decimal_text(STARTING_NOTIONAL_USD * (Decimal(1) + total_return)),
        "excessMeanDailyReturn": decimal_text(mean_decimal(path.excess_daily_returns)),
        "excessTotalReturn": decimal_text(excess_total_return),
        "excessTotalUsdPer1000": decimal_text(STARTING_NOTIONAL_USD * excess_total_return),
        "maxDrawdown": decimal_text(marked_open_drawdown(path)),
        "meanDailyReturn": decimal_text(mean_decimal(path.daily_returns)),
        "meanUsdPerDayPer1000": decimal_text(
            STARTING_NOTIONAL_USD * mean_decimal(path.daily_returns)
        ),
        "offDayCount": path.off_days,
        "onDayCount": path.on_days,
        "regimeScoreMaximum": decimal_text(max(path.regime_scores)),
        "regimeScoreMedian": decimal_text(median_decimal(path.regime_scores)),
        "regimeScoreMinimum": decimal_text(min(path.regime_scores)),
        "totalReturn": decimal_text(total_return),
        "totalUsdPer1000": decimal_text(STARTING_NOTIONAL_USD * total_return),
        "transitionLegCount": path.transition_legs,
    }


def development_folds(path: ScenarioPath) -> tuple[Decimal, ...]:
    """Return the five predeclared two-month development fold returns."""

    folds = (
        ("2025-03", "2025-04"),
        ("2025-05", "2025-06"),
        ("2025-07", "2025-08"),
        ("2025-09", "2025-10"),
        ("2025-11", "2025-12"),
    )
    return fold_compound_returns(path.ending_days, path.daily_returns, folds)


def development_analysis(
    bars: Mapping[str, Mapping[date, Bar]],
) -> tuple[
    tuple[DevelopmentEvaluation, ...],
    DevelopmentEvaluation | None,
    dict[str, object],
]:
    """Evaluate all trials, apply Holm gates, and select at most one champion."""

    raw: list[
        tuple[
            TrialPaths,
            BootstrapSummary,
            BootstrapSummary,
            tuple[Decimal, ...],
            tuple[Decimal, ...],
            Decimal,
            Decimal,
            Decimal,
            Decimal,
            Decimal,
            Decimal | None,
        ]
    ] = []
    for trial in trial_grid():
        paths = simulate_segment(bars, trial, DEVELOPMENT_START, DEVELOPMENT_END)
        absolute_bootstrap = circular_block_bootstrap(
            paths.base.daily_returns,
            seed=BOOTSTRAP_SEED,
        )
        excess_bootstrap = circular_block_bootstrap(
            paths.base.excess_daily_returns,
            seed=BOOTSTRAP_SEED + 10_000,
        )
        folds = development_folds(paths.base)
        excess_folds = fold_excess_returns(
            paths.base.ending_days,
            paths.base.daily_returns,
            paths.base.benchmark_daily_returns,
            (
                ("2025-03", "2025-04"),
                ("2025-05", "2025-06"),
                ("2025-07", "2025-08"),
                ("2025-09", "2025-10"),
                ("2025-11", "2025-12"),
            ),
        )
        capacity = (
            min(paths.base.transition_capacity_proxy_usd)
            if paths.base.transition_capacity_proxy_usd
            else None
        )
        raw.append(
            (
                paths,
                absolute_bootstrap,
                excess_bootstrap,
                folds,
                excess_folds,
                marked_open_drawdown(paths.base),
                compound_return(paths.base.daily_returns),
                compound_return(paths.base.benchmark_daily_returns),
                compound_return(paths.base.daily_returns)
                - compound_return(paths.base.benchmark_daily_returns),
                mean_decimal(paths.stress.daily_returns),
                capacity,
            )
        )
    reference_days = raw[0][0].base.ending_days
    if any(item[0].base.ending_days != reference_days for item in raw):
        raise VG38Error("development trial paths are not date-aligned")
    raw_p_values = {
        paths.trial.trial_id: excess_bootstrap.one_sided_p_exact
        for paths, _absolute_bootstrap, excess_bootstrap, *_rest in raw
    }
    adjusted = holm_adjusted(raw_p_values)
    q14_holm = holm_bonferroni(
        q14_trial_ledger(),
        tuple((trial_id, raw_p_values[trial_id]) for trial_id in sorted(raw_p_values)),
        familywise_alpha_per_myriad=500,
    )
    q14_holm_selected = frozenset(q14_holm.rejected_trial_ids)
    evaluations: list[DevelopmentEvaluation] = []
    for (
        paths,
        absolute_bootstrap,
        excess_bootstrap,
        folds,
        excess_folds,
        drawdown,
        base_total,
        benchmark_total,
        base_excess,
        stress_mean,
        capacity,
    ) in raw:
        gates = {
            "absoluteBaseOneSided95LcbPositive": absolute_bootstrap.one_sided_95_lcb > 0,
            "baseExcessTotalPositive": base_excess > 0,
            "maxDrawdownAtMost20Pct": drawdown <= MAX_DRAWDOWN,
            "offDayCountAtLeast30": paths.base.off_days >= 30,
            "onDayCountAtLeast30": paths.base.on_days >= 30,
            "positiveAbsoluteTwoMonthFoldsAtLeast4Of5": sum(value > 0 for value in folds) >= 4,
            "positiveExcessTwoMonthFoldsAtLeast4Of5": (
                sum(value > 0 for value in excess_folds) >= 4
            ),
            "excessOneSided95LcbPositive": excess_bootstrap.one_sided_95_lcb > 0,
            "q14HolmSelectedAtFwer005": (paths.trial.trial_id in q14_holm_selected),
            "stressExcessTotalPositive": (
                compound_return(paths.stress.daily_returns)
                - compound_return(paths.stress.benchmark_daily_returns)
                > 0
            ),
            "stressNetTotalPositive": compound_return(paths.stress.daily_returns) > 0,
        }
        evaluations.append(
            DevelopmentEvaluation(
                paths=paths,
                absolute_bootstrap=absolute_bootstrap,
                excess_bootstrap=excess_bootstrap,
                fold_returns=folds,
                fold_excess_returns=excess_folds,
                max_drawdown=drawdown,
                base_total_return=base_total,
                benchmark_total_return=benchmark_total,
                base_excess_return=base_excess,
                stress_mean=stress_mean,
                capacity_proxy_usd=capacity,
                holm_adjusted_p=(
                    Decimal(adjusted[paths.trial.trial_id].numerator)
                    / Decimal(adjusted[paths.trial.trial_id].denominator)
                ),
                holm_adjusted_p_exact=adjusted[paths.trial.trial_id],
                gates=gates,
            )
        )
    preliminary = tuple(sorted(evaluations, key=lambda item: item.paths.trial.trial_id))
    pbo = cscv_pbo(preliminary)
    pbo_passes = pbo.get("gateAtMost020") is True
    ordered = tuple(
        replace(
            evaluation,
            gates={
                **evaluation.gates,
                "q14PboAvailableAndAtMost020": pbo_passes,
            },
        )
        for evaluation in preliminary
    )
    passing = [evaluation for evaluation in ordered if all(evaluation.gates.values())]
    champion = (
        sorted(
            passing,
            key=lambda item: (
                -item.excess_bootstrap.one_sided_95_lcb,
                -item.absolute_bootstrap.one_sided_95_lcb,
                item.paths.base.transition_legs,
                item.paths.trial.compression_threshold,
                -item.paths.trial.baseline_days,
                -item.paths.trial.recent_days,
                item.paths.trial.trial_id,
            ),
        )[0]
        if passing
        else None
    )
    return ordered, champion, pbo


def evaluation_mapping(evaluation: DevelopmentEvaluation) -> dict[str, object]:
    """Serialize one development trial and every gate input."""

    monthly_excess = fold_excess_returns(
        evaluation.paths.base.ending_days,
        evaluation.paths.base.daily_returns,
        evaluation.paths.base.benchmark_daily_returns,
        tuple((month,) for month in DEVELOPMENT_MONTHS),
    )
    return {
        "base": scenario_metrics(evaluation.paths.base),
        "capacity": {
            "executableCapacityUsd": None,
            "method": "12_X_MIN_CONSTITUENT_LAGGED_30D_MEDIAN_QUOTE_VOLUME_X_1BP",
            "minimumTransitionProxyUsd": (
                None
                if evaluation.capacity_proxy_usd is None
                else decimal_text(evaluation.capacity_proxy_usd)
            ),
            "scope": "UNMEASURED_EXECUTABLE_CAPACITY; PUBLIC_PARTICIPATION_SENSITIVITY_ONLY",
        },
        "gates": dict(evaluation.gates),
        "gross": scenario_metrics(evaluation.paths.gross),
        "inference": {
            "blockDays": BOOTSTRAP_BLOCK_DAYS,
            "holmAdjustedPExact": evaluation.holm_adjusted_p_exact.as_mapping(),
            "holmAdjustedPValue": decimal_text(evaluation.holm_adjusted_p),
            "method": "Q14_CIRCULAR_BLOCK_INTERVAL_PLUS_SEEDED_CENTERED_P_VALUE",
            "q14TrialLedgerSha256": q14_trial_ledger().digest().hexdigest,
            "absoluteBase": {
                "meanDailyReturn": decimal_text(evaluation.absolute_bootstrap.mean),
                "oneSided95Lcb": decimal_text(evaluation.absolute_bootstrap.one_sided_95_lcb),
                "oneSided95LcbUsdPerDayPer1000": decimal_text(
                    STARTING_NOTIONAL_USD * evaluation.absolute_bootstrap.one_sided_95_lcb
                ),
                "oneSidedPExact": evaluation.absolute_bootstrap.one_sided_p_exact.as_mapping(),
                "oneSidedPValue": decimal_text(evaluation.absolute_bootstrap.one_sided_p_value),
                "seed": BOOTSTRAP_SEED,
                "twoSided90Ucb": decimal_text(evaluation.absolute_bootstrap.two_sided_90_ucb),
            },
            "excessVsAlwaysOn": {
                "meanDailyReturn": decimal_text(evaluation.excess_bootstrap.mean),
                "oneSided95Lcb": decimal_text(evaluation.excess_bootstrap.one_sided_95_lcb),
                "oneSided95LcbUsdPerDayPer1000": decimal_text(
                    STARTING_NOTIONAL_USD * evaluation.excess_bootstrap.one_sided_95_lcb
                ),
                "oneSidedPExact": evaluation.excess_bootstrap.one_sided_p_exact.as_mapping(),
                "oneSidedPValue": decimal_text(evaluation.excess_bootstrap.one_sided_p_value),
                "seed": BOOTSTRAP_SEED + 10_000,
                "twoSided90Ucb": decimal_text(evaluation.excess_bootstrap.two_sided_90_ucb),
            },
            "replicates": BOOTSTRAP_REPLICATES,
        },
        "positiveAbsoluteTwoMonthFoldCount": sum(value > 0 for value in evaluation.fold_returns),
        "positiveExcessTwoMonthFoldCount": sum(
            value > 0 for value in evaluation.fold_excess_returns
        ),
        "developmentMonthlyExcessReturns": [
            {
                "exactReturn": decimal_ratio(value).as_mapping(),
                "month": month,
                "return": decimal_text(value),
            }
            for month, value in zip(
                DEVELOPMENT_MONTHS,
                monthly_excess,
                strict=True,
            )
        ],
        "stress": scenario_metrics(evaluation.paths.stress),
        "trial": trial_mapping(evaluation.paths.trial),
        "twoMonthAbsoluteFoldReturns": [decimal_text(value) for value in evaluation.fold_returns],
        "twoMonthExcessFoldReturns": [
            decimal_text(value) for value in evaluation.fold_excess_returns
        ],
    }


def validate_frozen_identity() -> tuple[dict[str, object], dict[str, object]]:
    """Authenticate every pre-run identity binding without opening ZIPs."""

    if not FREEZE_PATH.is_file() or not SOURCE_MANIFEST_PATH.is_file():
        raise VG38Error("freeze receipt and source manifest are required")
    freeze_receipt = load_json(FREEZE_PATH)
    source_manifest = load_json(SOURCE_MANIFEST_PATH)
    validate_protocol_contract(load_json(PROTOCOL_PATH))
    if freeze_receipt.get("schema") != "VG38PreOutcomeFreezeV1":
        raise VG38Error("freeze schema is invalid")
    if freeze_receipt.get("state") != "READY_FOR_SOLE_ARCHIVE_DECOMPRESSION_RUN":
        raise VG38Error("freeze state is invalid")
    if freeze_receipt.get("baseCommit") != BASE_COMMIT:
        raise VG38Error("freeze base commit mismatch")
    if source_manifest.get("schema") != "VG38FrozenBinancePublicSourceManifestV1":
        raise VG38Error("source manifest schema is invalid")
    if source_manifest.get("state") != "CHECKSUM_VERIFIED_COMPRESSED_BYTES_NOT_OPENED_BY_VG38":
        raise VG38Error("source manifest state is invalid")
    if freeze_receipt.get("evaluatorSha256") != sha256_path(Path(__file__)):
        raise VG38Error("evaluator changed after freeze")
    if freeze_receipt.get("sourceManifestSha256") != sha256_path(SOURCE_MANIFEST_PATH):
        raise VG38Error("source manifest changed after freeze")
    if freeze_receipt.get("trialGridSha256") != canonical_sha(
        [trial_mapping(trial) for trial in trial_grid()]
    ):
        raise VG38Error("trial grid changed after freeze")
    for field, digest in required_document_hashes().items():
        if freeze_receipt.get(field) != digest:
            raise VG38Error(f"{field} changed after freeze")
    if source_manifest.get("protocolSha256") != sha256_path(PROTOCOL_PATH):
        raise VG38Error("source manifest protocol binding mismatch")
    manifest_artifacts(source_manifest)
    return freeze_receipt, source_manifest


def consume_run_marker(freeze_receipt: Mapping[str, object]) -> str:
    """Consume the experiment's exclusive run before any ZIP is opened."""

    if RUN_MARKER_PATH.exists() or RESULT_PATH.exists():
        raise VG38Error("the sole experiment run was already consumed")
    if git_output("status", "--porcelain"):
        raise VG38Error("run requires a committed freeze packet and clean worktree")
    marker = {
        "archiveDecompressionRunOrdinal": 1,
        "consumedAtUtc": utc_now(),
        "evaluatorSha256": freeze_receipt.get("evaluatorSha256"),
        "freezeSha256": sha256_path(FREEZE_PATH),
        "gitHead": git_output("rev-parse", "HEAD"),
        "holdoutReuseMaximum": 1,
        "schema": "VG38ExclusiveRunMarkerV1",
        "sourceManifestSha256": sha256_path(SOURCE_MANIFEST_PATH),
        "state": "SOLE_ARCHIVE_DECOMPRESSION_RUN_CONSUMED",
    }
    write_json_once(RUN_MARKER_PATH, marker)
    return sha256_path(RUN_MARKER_PATH)


def seal_candidate(
    champion: DevelopmentEvaluation,
    development_rows_sha256: str,
    pbo: Mapping[str, object],
) -> dict[str, object]:
    """Seal the sole champion before a holdout archive is opened."""

    if HOLDOUT_OPEN_PATH.exists():
        raise VG38Error("cannot seal candidate after holdout open")
    seal: dict[str, object] = {
        "baseCommit": BASE_COMMIT,
        "candidate": trial_mapping(champion.paths.trial),
        "createdAtUtc": utc_now(),
        "developmentRowsSha256": development_rows_sha256,
        "freezeSha256": sha256_path(FREEZE_PATH),
        "pboGate": dict(pbo),
        "schema": "VG38CandidateSealV1",
        "selectionRule": (
            "HIGHEST_EXCESS_LCB_THEN_ABSOLUTE_LCB_THEN_LOWER_TRANSITIONS_THEN_"
            "LOWER_COMPRESSION_THRESHOLD_THEN_LONGER_BASELINE_THEN_LONGER_RECENT_"
            "THEN_TRIAL_ID"
        ),
        "sourceManifestSha256": sha256_path(SOURCE_MANIFEST_PATH),
        "state": "CHAMPION_SEALED_BEFORE_HOLDOUT_OPEN",
    }
    write_json_once(CANDIDATE_SEAL_PATH, seal)
    return seal


def open_holdout_once(candidate_seal: Mapping[str, object]) -> dict[str, object]:
    """Create the sole holdout-open receipt before parsing holdout ZIPs."""

    if not CANDIDATE_SEAL_PATH.is_file():
        raise VG38Error("holdout requires a candidate seal")
    if HOLDOUT_OPEN_PATH.exists():
        raise VG38Error("holdout was already opened")
    receipt = {
        "candidateSealSha256": sha256_path(CANDIDATE_SEAL_PATH),
        "firstEligibleEntryOpenUtc": "2026-01-02T00:00:00Z",
        "openedAtUtc": utc_now(),
        "reuseCount": 1,
        "schema": "VG38HoldoutOpenReceiptV1",
        "sealedTrialId": cast(Mapping[str, object], candidate_seal["candidate"])["trialId"],
        "sourceMonths": list(HOLDOUT_MONTHS),
        "state": "HOLDOUT_OPENED_ONCE",
    }
    write_json_once(HOLDOUT_OPEN_PATH, receipt)
    return receipt


def holdout_month_returns(path: ScenarioPath) -> tuple[Decimal, ...]:
    """Return the three sealed holdout calendar-month returns."""

    return fold_compound_returns(
        path.ending_days,
        path.daily_returns,
        tuple((month,) for month in HOLDOUT_MONTHS),
    )


def holdout_analysis(paths: TrialPaths) -> tuple[dict[str, object], dict[str, bool]]:
    """Measure the sealed champion once and apply the predeclared gates."""

    absolute_bootstrap = circular_block_bootstrap(
        paths.base.daily_returns,
        seed=BOOTSTRAP_SEED + 1,
    )
    excess_bootstrap = circular_block_bootstrap(
        paths.base.excess_daily_returns,
        seed=BOOTSTRAP_SEED + 10_001,
    )
    month_returns = holdout_month_returns(paths.base)
    excess_month_returns = fold_excess_returns(
        paths.base.ending_days,
        paths.base.daily_returns,
        paths.base.benchmark_daily_returns,
        tuple((month,) for month in HOLDOUT_MONTHS),
    )
    capacity = (
        min(paths.base.transition_capacity_proxy_usd)
        if paths.base.transition_capacity_proxy_usd
        else None
    )
    drawdown = marked_open_drawdown(paths.base)
    gates = {
        "absoluteBaseMeanPositive": absolute_bootstrap.mean > 0,
        "absoluteBaseOneSided95LcbPositive": absolute_bootstrap.one_sided_95_lcb > 0,
        "excessMeanPositive": excess_bootstrap.mean > 0,
        "excessOneSided95LcbPositive": excess_bootstrap.one_sided_95_lcb > 0,
        "excessOneSidedPBelow005": excess_bootstrap.one_sided_p_value < ONE_SIDED_ALPHA,
        "maxDrawdownAtMost20Pct": drawdown <= MAX_DRAWDOWN,
        "offDayCountAtLeast10": paths.base.off_days >= 10,
        "onDayCountAtLeast10": paths.base.on_days >= 10,
        "positiveAbsoluteMonthsAtLeast2Of3": sum(value > 0 for value in month_returns) >= 2,
        "positiveExcessMonthsAtLeast2Of3": (sum(value > 0 for value in excess_month_returns) >= 2),
        "stressExcessTotalPositive": (
            compound_return(paths.stress.daily_returns)
            - compound_return(paths.stress.benchmark_daily_returns)
            > 0
        ),
        "stressNetTotalPositive": compound_return(paths.stress.daily_returns) > 0,
    }
    metrics: dict[str, object] = {
        "base": scenario_metrics(paths.base),
        "boundaryPurge": {
            "firstEligibleLatestFeatureBar": "2025-12-31",
            "firstEligibleTargetOpen": "2026-01-02",
            "forcedFinalLiquidationOpen": "2026-03-31",
            "fullGapBar": "2026-01-01",
            "march31ComputedScoreTraded": False,
        },
        "capacity": {
            "executableCapacityUsd": None,
            "method": ("12_X_MIN_CONSTITUENT_LAGGED_30D_MEDIAN_QUOTE_VOLUME_X_1BP"),
            "minimumTransitionProxyUsd": (None if capacity is None else decimal_text(capacity)),
            "scope": "UNMEASURED_EXECUTABLE_CAPACITY; PUBLIC_PARTICIPATION_SENSITIVITY_ONLY",
        },
        "gates": gates,
        "gross": scenario_metrics(paths.gross),
        "inference": {
            "blockDays": BOOTSTRAP_BLOCK_DAYS,
            "method": "Q14_CIRCULAR_BLOCK_INTERVAL_PLUS_SEEDED_CENTERED_P_VALUE",
            "q14TrialLedgerSha256": q14_trial_ledger().digest().hexdigest,
            "absoluteBase": {
                "meanDailyReturn": decimal_text(absolute_bootstrap.mean),
                "oneSided95Lcb": decimal_text(absolute_bootstrap.one_sided_95_lcb),
                "oneSided95LcbUsdPerDayPer1000": decimal_text(
                    STARTING_NOTIONAL_USD * absolute_bootstrap.one_sided_95_lcb
                ),
                "oneSidedPExact": absolute_bootstrap.one_sided_p_exact.as_mapping(),
                "oneSidedPValue": decimal_text(absolute_bootstrap.one_sided_p_value),
                "seed": BOOTSTRAP_SEED + 1,
                "twoSided90Ucb": decimal_text(absolute_bootstrap.two_sided_90_ucb),
            },
            "excessVsAlwaysOn": {
                "meanDailyReturn": decimal_text(excess_bootstrap.mean),
                "oneSided95Lcb": decimal_text(excess_bootstrap.one_sided_95_lcb),
                "oneSided95LcbUsdPerDayPer1000": decimal_text(
                    STARTING_NOTIONAL_USD * excess_bootstrap.one_sided_95_lcb
                ),
                "oneSidedPExact": excess_bootstrap.one_sided_p_exact.as_mapping(),
                "oneSidedPValue": decimal_text(excess_bootstrap.one_sided_p_value),
                "seed": BOOTSTRAP_SEED + 10_001,
                "twoSided90Ucb": decimal_text(excess_bootstrap.two_sided_90_ucb),
            },
            "replicates": BOOTSTRAP_REPLICATES,
        },
        "absoluteMonthReturns": [decimal_text(value) for value in month_returns],
        "excessMonthReturns": [decimal_text(value) for value in excess_month_returns],
        "positiveAbsoluteMonthCount": sum(value > 0 for value in month_returns),
        "positiveExcessMonthCount": sum(value > 0 for value in excess_month_returns),
        "stress": scenario_metrics(paths.stress),
        "trial": trial_mapping(paths.trial),
    }
    return metrics, gates


def base_result_envelope(
    *,
    marker_sha: str,
    source_manifest: Mapping[str, object],
) -> dict[str, object]:
    """Return immutable provenance common to every terminal result."""

    return {
        "accountEffectiveFees": {
            "scope": "UNKNOWN",
            "value": None,
            "why": "PUBLIC_ONLY_PROTOCOL_FORBIDS_SIGNED_ACCOUNT_COMMISSION_READS",
        },
        "baseCommit": BASE_COMMIT,
        "boundaryPurge": {
            "developmentFirstEligibleLatestFeatureBar": "2025-03-01",
            "developmentFirstEligibleTargetOpen": "2025-03-03",
            "developmentFirstFullGapBar": "2025-03-02",
            "developmentFinalLiquidationOpen": "2025-12-31",
            "developmentFinalComputedScoreTraded": False,
            "holdoutFirstEligibleLatestFeatureBar": "2025-12-31",
            "holdoutFirstEligibleTargetOpen": "2026-01-02",
            "holdoutFirstFullGapBar": "2026-01-01",
            "holdoutFinalLiquidationOpen": "2026-03-31",
            "holdoutFinalComputedScoreTraded": False,
        },
        "capitalAuthority": "NONE",
        "capacityTruth": {
            "executableCapacityUsd": None,
            "scope": "UNMEASURED",
            "why": (
                "DAILY_PUBLIC_QUOTE_VOLUME_DOES_NOT_MEASURE_BOOK_DEPTH_FILL_PROBABILITY_OR_IMPACT"
            ),
        },
        "costScenarios": {
            "base": {
                "adversePerSide": format(BASE_ADVERSE_PER_SIDE, "f"),
                "feePerSide": format(PUBLIC_FEE_PER_SIDE, "f"),
                "totalPerSide": format(BASE_COST_PER_SIDE, "f"),
            },
            "scope": "PUBLIC_SCENARIOS_NOT_ACCOUNT_TRUTH",
            "stress": {
                "adversePerSide": format(STRESS_ADVERSE_PER_SIDE, "f"),
                "feePerSide": format(PUBLIC_FEE_PER_SIDE, "f"),
                "totalPerSide": format(STRESS_COST_PER_SIDE, "f"),
            },
        },
        "createdAtUtc": utc_now(),
        "freezeSha256": sha256_path(FREEZE_PATH),
        "noSideEffects": {
            "hostMutation": False,
            "moneyMovement": False,
            "orderPlacement": False,
            "privateApiRead": False,
            "signedApiCall": False,
            "uiMutation": False,
        },
        "protocolSha256": sha256_path(PROTOCOL_PATH),
        "runMarkerSha256": marker_sha,
        "schema": "VG38TerminalProfitabilityVerdictV1",
        "sourceManifestSha256": sha256_path(SOURCE_MANIFEST_PATH),
        "sourceScope": source_manifest.get("state"),
        "universeTruth": {
            "historicalWholeMarketMembership": "UNMEASURED",
            "limitation": "STATIC_RETROSPECTIVE_BENCHMARK_MAY_HAVE_SURVIVOR_SELECTION_BIAS",
        },
    }


def development_no_go_result(
    *,
    marker_sha: str,
    source_manifest: Mapping[str, object],
    evaluations: Sequence[DevelopmentEvaluation],
    pbo: Mapping[str, object],
) -> dict[str, object]:
    """Return a valid-data economic NO_GO without touching holdout."""

    rows = [evaluation_mapping(evaluation) for evaluation in evaluations]
    reporting = max(
        evaluations,
        key=lambda item: (
            item.base_total_return,
            item.base_excess_return,
            item.paths.trial.trial_id,
        ),
    )
    result = base_result_envelope(
        marker_sha=marker_sha,
        source_manifest=source_manifest,
    )
    result.update(
        {
            "development": {
                "alignedDailyPath": True,
                "boundaryPurge": {
                    "firstEligibleLatestFeatureBar": "2025-03-01",
                    "firstEligibleTargetOpen": "2025-03-03",
                    "forcedFinalLiquidationOpen": "2025-12-31",
                    "fullGapBar": "2025-03-02",
                    "forcedFinalComputedScoreTraded": False,
                },
                "candidateCount": len(rows),
                "candidateRows": rows,
                "pbo": dict(pbo),
                "reportingBestTrialId": reporting.paths.trial.trial_id,
                "state": "COMPLETE_NO_GATE_PASSER",
            },
            "holdout": {
                "archiveBodiesOpened": False,
                "metrics": None,
                "reuseCount": 0,
                "state": "UNOPENED_UNTOUCHED",
            },
            "netEdge": {
                "alwaysOnBenchmarkTotalUsdPer1000": decimal_text(
                    STARTING_NOTIONAL_USD * reporting.benchmark_total_return
                ),
                "baseNetMeanDailyReturn": decimal_text(reporting.absolute_bootstrap.mean),
                "baseNetOneSided95LcbDailyReturn": decimal_text(
                    reporting.absolute_bootstrap.one_sided_95_lcb
                ),
                "baseNetTotalUsdPer1000": decimal_text(
                    STARTING_NOTIONAL_USD * reporting.base_total_return
                ),
                "excessVsAlwaysOnMeanDailyReturn": decimal_text(reporting.excess_bootstrap.mean),
                "excessVsAlwaysOnOneSided95LcbDailyReturn": decimal_text(
                    reporting.excess_bootstrap.one_sided_95_lcb
                ),
                "excessVsAlwaysOnTotalUsdPer1000": decimal_text(
                    STARTING_NOTIONAL_USD * reporting.base_excess_return
                ),
                "scope": "DEVELOPMENT_REPORTING_ONLY",
                "trialId": reporting.paths.trial.trial_id,
            },
            "verdict": {
                "consumer": "N3_SUCCESSOR_ORCHESTRATOR_SCOREBOARD",
                "goScope": "NONE",
                "reasons": ["NO_PREDECLARED_TRIAL_CLEARED_ALL_DEVELOPMENT_GATES"],
                "status": "NO_GO",
            },
        }
    )
    return result


def holdout_result(
    *,
    marker_sha: str,
    source_manifest: Mapping[str, object],
    evaluations: Sequence[DevelopmentEvaluation],
    champion: DevelopmentEvaluation,
    pbo: Mapping[str, object],
    holdout_metrics: Mapping[str, object],
    holdout_gates: Mapping[str, bool],
) -> dict[str, object]:
    """Return the one-shot holdout GO or economic NO_GO."""

    status = "GO" if all(holdout_gates.values()) else "NO_GO"
    base_metrics = cast(Mapping[str, object], holdout_metrics["base"])
    inference = cast(Mapping[str, object], holdout_metrics["inference"])
    absolute_inference = cast(Mapping[str, object], inference["absoluteBase"])
    excess_inference = cast(Mapping[str, object], inference["excessVsAlwaysOn"])
    rows = [evaluation_mapping(evaluation) for evaluation in evaluations]
    result = base_result_envelope(
        marker_sha=marker_sha,
        source_manifest=source_manifest,
    )
    result.update(
        {
            "development": {
                "alignedDailyPath": True,
                "boundaryPurge": {
                    "firstEligibleLatestFeatureBar": "2025-03-01",
                    "firstEligibleTargetOpen": "2025-03-03",
                    "forcedFinalLiquidationOpen": "2025-12-31",
                    "fullGapBar": "2025-03-02",
                    "forcedFinalComputedScoreTraded": False,
                },
                "candidateCount": len(rows),
                "candidateRows": rows,
                "championTrialId": champion.paths.trial.trial_id,
                "pbo": dict(pbo),
                "state": "COMPLETE_CHAMPION_SEALED",
            },
            "holdout": {
                "archiveBodiesOpened": True,
                "metrics": dict(holdout_metrics),
                "reuseCount": 1,
                "state": "OPENED_ONCE_COMPLETE",
            },
            "netEdge": {
                "alwaysOnBenchmarkTotalUsdPer1000": base_metrics[
                    "alwaysOnBenchmarkTotalUsdPer1000"
                ],
                "baseNetMeanDailyReturn": absolute_inference["meanDailyReturn"],
                "baseNetOneSided95LcbDailyReturn": absolute_inference["oneSided95Lcb"],
                "baseNetTotalUsdPer1000": base_metrics["totalUsdPer1000"],
                "excessVsAlwaysOnMeanDailyReturn": excess_inference["meanDailyReturn"],
                "excessVsAlwaysOnOneSided95LcbDailyReturn": excess_inference["oneSided95Lcb"],
                "excessVsAlwaysOnTotalUsdPer1000": base_metrics["excessTotalUsdPer1000"],
                "scope": "SEALED_HOLDOUT_PUBLIC_COST_SCENARIO",
                "trialId": champion.paths.trial.trial_id,
            },
            "verdict": {
                "consumer": "N3_SUCCESSOR_ORCHESTRATOR_SCOREBOARD",
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


def terminal_unmeasured_result(
    *,
    marker_sha: str,
    reason: str,
    source_manifest: Mapping[str, object],
) -> dict[str, object]:
    """Return an honest null-economics terminal result after protocol failure."""

    holdout_opened = HOLDOUT_OPEN_PATH.exists()
    result = base_result_envelope(
        marker_sha=marker_sha,
        source_manifest=source_manifest,
    )
    result.update(
        {
            "development": None,
            "holdout": {
                "archiveBodiesOpened": holdout_opened,
                "candidateSealPresent": CANDIDATE_SEAL_PATH.exists(),
                "metrics": None,
                "reuseCount": 1 if holdout_opened else 0,
                "state": ("OPENED_INCOMPLETE" if holdout_opened else "UNOPENED_UNTOUCHED"),
            },
            "netEdge": {
                "alwaysOnBenchmarkTotalUsdPer1000": None,
                "baseNetMeanDailyReturn": None,
                "baseNetOneSided95LcbDailyReturn": None,
                "baseNetTotalUsdPer1000": None,
                "excessVsAlwaysOnMeanDailyReturn": None,
                "excessVsAlwaysOnOneSided95LcbDailyReturn": None,
                "excessVsAlwaysOnTotalUsdPer1000": None,
                "scope": "UNMEASURED",
                "trialId": None,
            },
            "verdict": {
                "consumer": "N3_SUCCESSOR_ORCHESTRATOR_SCOREBOARD",
                "goScope": "NONE",
                "reasons": [reason],
                "status": "UNMEASURED",
            },
        }
    )
    return result


def run_experiment() -> None:
    """Consume the one-run protocol and write exactly one terminal verdict."""

    freeze_receipt, source_manifest = validate_frozen_identity()
    marker_sha = consume_run_marker(freeze_receipt)
    try:
        development_bars = load_bars(
            source_manifest,
            DEVELOPMENT_SOURCE_MONTHS,
        )
        evaluations, champion, pbo = development_analysis(development_bars)
        if champion is None:
            result = development_no_go_result(
                marker_sha=marker_sha,
                source_manifest=source_manifest,
                evaluations=evaluations,
                pbo=pbo,
            )
        else:
            development_rows = [evaluation_mapping(evaluation) for evaluation in evaluations]
            candidate_seal = seal_candidate(
                champion,
                canonical_sha(development_rows),
                pbo,
            )
            open_holdout_once(candidate_seal)
            all_bars = load_bars(
                source_manifest,
                HOLDOUT_SOURCE_MONTHS,
                development_bars,
            )
            holdout_paths = simulate_segment(
                all_bars,
                champion.paths.trial,
                HOLDOUT_START,
                HOLDOUT_END,
            )
            holdout_metrics, holdout_gates = holdout_analysis(holdout_paths)
            result = holdout_result(
                marker_sha=marker_sha,
                source_manifest=source_manifest,
                evaluations=evaluations,
                champion=champion,
                pbo=pbo,
                holdout_metrics=holdout_metrics,
                holdout_gates=holdout_gates,
            )
    except Exception as error:
        reason = (
            str(error)
            if isinstance(error, VG38Error)
            else f"EVALUATION_ERROR_{type(error).__name__.upper()}:{error}"
        )
        result = terminal_unmeasured_result(
            marker_sha=marker_sha,
            reason=reason,
            source_manifest=source_manifest,
        )
    write_json_once(RESULT_PATH, result)
    write_sha256s()
    verdict = cast(Mapping[str, object], result["verdict"])
    holdout = cast(Mapping[str, object], result["holdout"])
    edge = cast(Mapping[str, object], result["netEdge"])
    print(
        f"{verdict['status']} "
        f"scope={edge['scope']} "
        f"netUsdPer1000={edge['baseNetTotalUsdPer1000']} "
        f"holdout={holdout['state']}"
    )


def packet_files() -> tuple[Path, ...]:
    """Return the fixed terminal packet inventory, excluding its own hash."""

    allowed = {
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
        "verify.py",
    }
    actual = {
        path.name
        for path in HERE.iterdir()
        if path.is_file() and path.name != SHA256SUMS_PATH.name and not path.name.startswith(".")
    }
    unexpected = actual - allowed
    if unexpected:
        raise VG38Error(f"unexpected packet file: {sorted(unexpected)[0]}")
    required = {
        "OFFICIAL_SOURCE_RESEARCH.md",
        "README.md",
        "__init__.py",
        "experiment.py",
        "freeze.v1.json",
        "protocol.v1.json",
        "result.v1.json",
        "run-marker.v1.json",
        "source-manifest.v1.json",
        "test_experiment.py",
        "verify.py",
    }
    missing = required - actual
    if missing:
        raise VG38Error(f"required terminal packet file absent: {sorted(missing)[0]}")
    return tuple(HERE / name for name in sorted(actual))


def write_sha256s() -> None:
    """Write a deterministic packet-local SHA-256 inventory."""

    lines = [f"{sha256_path(path)}  {path.name}\n" for path in packet_files()]
    write_bytes_once(SHA256SUMS_PATH, "".join(lines).encode("ascii"))


def verify_source_artifacts(source_manifest: Mapping[str, object]) -> None:
    """Reauthenticate compressed bytes and sidecars without opening ZIPs."""

    for artifact in manifest_artifacts(source_manifest):
        zip_path = SOURCE_ROOT / str(artifact.get("zipPath", ""))
        checksum_path = SOURCE_ROOT / str(artifact.get("checksumPath", ""))
        if sha256_path(zip_path) != artifact.get("zipSha256"):
            raise VG38Error(f"source ZIP drift: {zip_path.name}")
        if sha256_path(checksum_path) != artifact.get("checksumSha256"):
            raise VG38Error(f"source checksum drift: {checksum_path.name}")
        if zip_path.stat().st_size != int(str(artifact.get("zipBytes", "-1"))):
            raise VG38Error(f"source ZIP byte-length drift: {zip_path.name}")
        if checksum_path.stat().st_size != int(str(artifact.get("checksumBytes", "-1"))):
            raise VG38Error(f"source checksum byte-length drift: {checksum_path.name}")
        verify_checksum_text(
            checksum_path.read_bytes(),
            zip_path.name,
            str(artifact.get("zipSha256", "")),
        )


def verify_sha256s() -> None:
    """Authenticate exact packet inventory and content."""

    if not SHA256SUMS_PATH.is_file():
        raise VG38Error("SHA256SUMS is absent")
    expected: dict[str, str] = {}
    for line in SHA256SUMS_PATH.read_text(encoding="ascii").splitlines():
        parts = line.split("  ", 1)
        if len(parts) != 2 or re.fullmatch(r"[0-9a-f]{64}", parts[0]) is None:
            raise VG38Error("SHA256SUMS grammar is invalid")
        digest, name = parts
        if "/" in name or name in expected or name.startswith("."):
            raise VG38Error("SHA256SUMS name is invalid or duplicate")
        expected[name] = digest
    actual_names = {path.name for path in packet_files()}
    if set(expected) != actual_names:
        raise VG38Error("SHA256SUMS inventory differs from packet files")
    for path in packet_files():
        if sha256_path(path) != expected[path.name]:
            raise VG38Error(f"packet digest mismatch: {path.name}")


def verify_packet() -> None:
    """Verify the terminal packet without rerunning or decompressing sources."""

    freeze_receipt, source_manifest = validate_frozen_identity()
    verify_source_artifacts(source_manifest)
    if not RUN_MARKER_PATH.is_file() or not RESULT_PATH.is_file():
        raise VG38Error("terminal run marker and result are required")
    marker = load_json(RUN_MARKER_PATH)
    result = load_json(RESULT_PATH)
    freeze_head = str(freeze_receipt.get("gitHead", ""))
    marker_head = str(marker.get("gitHead", ""))
    current_head = git_output("rev-parse", "HEAD")
    if re.fullmatch(r"[0-9a-f]{40}", freeze_head) is None:
        raise VG38Error("freeze Git head is invalid")
    if re.fullmatch(r"[0-9a-f]{40}", marker_head) is None:
        raise VG38Error("run marker Git head is invalid")
    if not git_commit_is_ancestor(BASE_COMMIT, freeze_head):
        raise VG38Error("freeze Git head is outside canonical lineage")
    if not git_commit_is_ancestor(freeze_head, marker_head):
        raise VG38Error("run marker does not descend from the frozen protocol")
    if not git_commit_is_ancestor(marker_head, current_head):
        raise VG38Error("current candidate does not descend from the committed freeze")
    frozen_code_paths = {
        "quant/research/vg38/OFFICIAL_SOURCE_RESEARCH.md": SOURCE_RESEARCH_PATH,
        "quant/research/vg38/README.md": README_PATH,
        "quant/research/vg38/__init__.py": INIT_PATH,
        "quant/research/vg38/experiment.py": Path(__file__),
        "quant/research/vg38/protocol.v1.json": PROTOCOL_PATH,
        "quant/research/vg38/test_experiment.py": TEST_PATH,
        "quant/research/vg38/verify.py": VERIFY_PATH,
    }
    for relative_path, current_path in frozen_code_paths.items():
        if git_blob_sha256(freeze_head, relative_path) != sha256_path(current_path):
            raise VG38Error(f"frozen Git blob mismatch: {relative_path}")
    committed_freeze_paths = {
        "quant/research/vg38/freeze.v1.json": FREEZE_PATH,
        "quant/research/vg38/source-manifest.v1.json": SOURCE_MANIFEST_PATH,
    }
    for relative_path, current_path in committed_freeze_paths.items():
        if git_blob_sha256(marker_head, relative_path) != sha256_path(current_path):
            raise VG38Error(f"committed freeze blob mismatch: {relative_path}")
    if marker.get("state") != "SOLE_ARCHIVE_DECOMPRESSION_RUN_CONSUMED":
        raise VG38Error("run marker state is invalid")
    if marker.get("archiveDecompressionRunOrdinal") != 1:
        raise VG38Error("run marker ordinal is invalid")
    if marker.get("evaluatorSha256") != freeze_receipt.get("evaluatorSha256"):
        raise VG38Error("run marker evaluator binding mismatch")
    if marker.get("freezeSha256") != sha256_path(FREEZE_PATH):
        raise VG38Error("run marker freeze binding mismatch")
    if marker.get("sourceManifestSha256") != sha256_path(SOURCE_MANIFEST_PATH):
        raise VG38Error("run marker source binding mismatch")
    if result.get("runMarkerSha256") != sha256_path(RUN_MARKER_PATH):
        raise VG38Error("result run marker binding mismatch")
    if result.get("freezeSha256") != sha256_path(FREEZE_PATH):
        raise VG38Error("result freeze binding mismatch")
    if result.get("protocolSha256") != sha256_path(PROTOCOL_PATH):
        raise VG38Error("result protocol binding mismatch")
    if result.get("sourceManifestSha256") != sha256_path(SOURCE_MANIFEST_PATH):
        raise VG38Error("result source binding mismatch")
    verdict = result.get("verdict")
    holdout = result.get("holdout")
    if result.get("schema") != "VG38TerminalProfitabilityVerdictV1":
        raise VG38Error("result schema is invalid")
    if result.get("capitalAuthority") != "NONE":
        raise VG38Error("result grants forbidden capital authority")
    side_effects = result.get("noSideEffects")
    if side_effects != {
        "hostMutation": False,
        "moneyMovement": False,
        "orderPlacement": False,
        "privateApiRead": False,
        "signedApiCall": False,
        "uiMutation": False,
    }:
        raise VG38Error("result side-effect boundary is invalid")
    if not isinstance(verdict, dict) or verdict.get("status") not in {
        "GO",
        "NO_GO",
        "UNMEASURED",
    }:
        raise VG38Error("result verdict is invalid")
    if not isinstance(holdout, dict):
        raise VG38Error("result holdout state is invalid")
    status = str(verdict["status"])
    holdout_state = holdout.get("state")
    if status == "GO":
        if holdout_state != "OPENED_ONCE_COMPLETE" or holdout.get("reuseCount") != 1:
            raise VG38Error("GO requires one complete holdout opening")
        metrics = holdout.get("metrics")
        if not isinstance(metrics, dict):
            raise VG38Error("GO holdout metrics are absent")
        gates = metrics.get("gates")
        if (
            not isinstance(gates, dict)
            or not gates
            or any(value is not True for value in gates.values())
        ):
            raise VG38Error("GO has a failed or invalid holdout gate")
    elif status == "NO_GO" and holdout_state == "OPENED_ONCE_COMPLETE":
        metrics = holdout.get("metrics")
        if not isinstance(metrics, dict):
            raise VG38Error("opened NO_GO holdout metrics are absent")
        gates = metrics.get("gates")
        if (
            not isinstance(gates, dict)
            or not gates
            or all(value is True for value in gates.values())
        ):
            raise VG38Error("opened NO_GO lacks a failed holdout gate")
    elif status == "NO_GO":
        development = result.get("development")
        if (
            holdout_state != "UNOPENED_UNTOUCHED"
            or holdout.get("reuseCount") != 0
            or not isinstance(development, dict)
            or development.get("state") != "COMPLETE_NO_GATE_PASSER"
        ):
            raise VG38Error("unopened NO_GO is inconsistent with development")
    else:
        net_edge = result.get("netEdge")
        if (
            status != "UNMEASURED"
            or holdout_state not in {"UNOPENED_UNTOUCHED", "OPENED_INCOMPLETE"}
            or holdout.get("metrics") is not None
            or not isinstance(net_edge, dict)
            or net_edge.get("scope") != "UNMEASURED"
        ):
            raise VG38Error("UNMEASURED result contains measured evidence")
    candidate_seal: dict[str, object] | None = None
    if CANDIDATE_SEAL_PATH.exists():
        candidate_seal = load_json(CANDIDATE_SEAL_PATH)
        if candidate_seal.get("schema") != "VG38CandidateSealV1":
            raise VG38Error("candidate seal schema is invalid")
        if candidate_seal.get("freezeSha256") != sha256_path(FREEZE_PATH):
            raise VG38Error("candidate seal freeze binding mismatch")
        if candidate_seal.get("sourceManifestSha256") != sha256_path(SOURCE_MANIFEST_PATH):
            raise VG38Error("candidate seal source binding mismatch")
    if HOLDOUT_OPEN_PATH.exists():
        if candidate_seal is None:
            raise VG38Error("holdout open exists without candidate seal")
        if holdout.get("state") not in {
            "OPENED_ONCE_COMPLETE",
            "OPENED_INCOMPLETE",
        }:
            raise VG38Error("result denies its holdout-open receipt")
        open_receipt = load_json(HOLDOUT_OPEN_PATH)
        if open_receipt.get("reuseCount") != 1:
            raise VG38Error("holdout reuse count is not exactly one")
        if open_receipt.get("candidateSealSha256") != sha256_path(CANDIDATE_SEAL_PATH):
            raise VG38Error("holdout receipt candidate binding mismatch")
        candidate = candidate_seal.get("candidate")
        if not isinstance(candidate, dict):
            raise VG38Error("candidate seal identity is invalid")
        if open_receipt.get("sealedTrialId") != candidate.get("trialId"):
            raise VG38Error("holdout receipt trial binding mismatch")
        if holdout.get("state") == "OPENED_ONCE_COMPLETE":
            development = result.get("development")
            if not isinstance(development, dict):
                raise VG38Error("complete holdout result lacks development evidence")
            candidate_rows = development.get("candidateRows")
            if not isinstance(candidate_rows, list):
                raise VG38Error("complete holdout result lacks candidate rows")
            if canonical_sha(candidate_rows) != candidate_seal.get("developmentRowsSha256"):
                raise VG38Error("result candidate rows differ from their seal")
            if development.get("championTrialId") != candidate.get("trialId"):
                raise VG38Error("result champion differs from its seal")
            if canonical_sha(development.get("pbo")) != canonical_sha(
                candidate_seal.get("pboGate")
            ):
                raise VG38Error("result PBO differs from its candidate seal")
    else:
        if holdout.get("state") != "UNOPENED_UNTOUCHED":
            raise VG38Error("result claims an absent holdout was opened")
        if candidate_seal is not None and verdict.get("status") != "UNMEASURED":
            raise VG38Error("measured result has a stranded candidate seal")
        if candidate_seal is not None and holdout.get("candidateSealPresent") is not True:
            raise VG38Error("terminal result omits its stranded candidate seal")
    verify_sha256s()
    print(
        f"VERIFIED verdict={verdict['status']} "
        f"holdout={holdout['state']} "
        f"result={sha256_path(RESULT_PATH)}"
    )


def parse_args(arguments: Sequence[str]) -> argparse.Namespace:
    """Parse the closed three-command evaluator interface."""

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "command",
        choices=("freeze", "run", "verify"),
    )
    return parser.parse_args(arguments)


def main(arguments: Sequence[str] | None = None) -> int:
    """Dispatch one bounded evaluator command."""

    parsed = parse_args(sys.argv[1:] if arguments is None else arguments)
    try:
        if parsed.command == "freeze":
            freeze()
        elif parsed.command == "run":
            run_experiment()
        else:
            verify_packet()
    except (
        VG38Error,
        OSError,
        subprocess.CalledProcessError,
        zipfile.BadZipFile,
    ) as error:
        print(f"VG38_ERROR {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
