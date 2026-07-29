#!/usr/bin/env python3
"""Sealed Binance-public-only V-G26 price-volume-correlation regime experiment.

The command boundary is intentionally narrow:

* ``acquire`` downloads the exact public ZIP/checksum matrix without opening
  any ZIP member.
* ``freeze`` authenticates compressed monthly ZIP bytes and their official
  checksum sidecars without opening any ZIP member.
* ``run`` consumes an exclusive marker, evaluates development, seals at most
  one champion, and opens the chronological holdout at most once.
* ``verify`` authenticates the frozen sources and terminal packet without
  rerunning or decompressing the experiment.
* ``hashes`` refreshes the packet-local SHA-256 inventory.

The strategy is cohort-or-cash.  Each completed UTC day produces a strictly
lagged cross-symbol median of per-symbol Spearman correlations between daily
price returns and daily quote-volume changes.  A trial is ON when that median
meets its frozen threshold.  On an OFF-to-ON transition, the current notional
is split equally across every predeclared cohort member.  Units remain fixed
until the next ON-to-OFF transition; there is no daily cross-sectional
rebalancing, no shorting, and no leverage.  Every trial is also compared with
an identical always-on cohort benchmark so market beta cannot masquerade as a
price-volume regime edge.
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
import tempfile
import time
import urllib.error
import urllib.request
import zipfile
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal, InvalidOperation, getcontext
from pathlib import Path
from typing import cast

getcontext().prec = 50

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[2]
PROTOCOL_PATH = HERE / "protocol.v1.json"
SOURCE_RESEARCH_PATH = HERE / "OFFICIAL_SOURCE_RESEARCH.md"
README_PATH = HERE / "README.md"
TEST_PATH = HERE / "test_experiment.py"
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
CAPACITY_GATE_USD = Decimal("1000")
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


class VG26Error(RuntimeError):
    """A terminal V-G26 custody, schema, protocol, or measurement error."""


@dataclass(frozen=True, slots=True)
class Trial:
    """One predeclared price-volume-correlation regime configuration."""

    trial_id: str
    lookback_days: int
    correlation_threshold: Decimal


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
        raise VG26Error(f"{path.name} must contain a JSON object")
    return cast(dict[str, object], value)


def write_json_once(path: Path, value: object) -> None:
    """Create an immutable JSON receipt or accept identical existing bytes."""

    payload = canonical_bytes(value)
    if path.exists():
        if path.read_bytes() != payload:
            raise VG26Error(f"refusing to replace non-identical {path.name}")
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


def write_bytes_atomic(path: Path, payload: bytes) -> None:
    """Atomically replace a derived, reproducible packet file."""

    descriptor, raw_path = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary = Path(raw_path)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


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
        raise VG26Error(f"{field} is not a decimal") from error
    if not value.is_finite() or (nonnegative and value < 0):
        raise VG26Error(f"{field} is outside its declared decimal domain")
    return value


def date_range(start: date, end_exclusive: date) -> tuple[date, ...]:
    """Return every calendar day in a half-open UTC interval."""

    days = (end_exclusive - start).days
    if days < 0:
        raise VG26Error("date range is reversed")
    return tuple(start + timedelta(days=offset) for offset in range(days))


def month_bounds(month: str) -> tuple[date, date]:
    """Return the half-open calendar bounds for a YYYY-MM month."""

    try:
        start = date.fromisoformat(f"{month}-01")
    except ValueError as error:
        raise VG26Error(f"invalid source month {month}") from error
    end = date(start.year + 1, 1, 1) if start.month == 12 else date(start.year, start.month + 1, 1)
    return start, end


def median_decimal(values: Sequence[Decimal]) -> Decimal:
    """Return the exact median without binary floating-point conversion."""

    if not values:
        raise VG26Error("median requires at least one value")
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) / 2


def mean_decimal(values: Sequence[Decimal]) -> Decimal:
    """Return an exact arithmetic mean."""

    if not values:
        raise VG26Error("mean requires at least one value")
    return sum(values, Decimal(0)) / Decimal(len(values))


def average_ranks(values: Sequence[Decimal]) -> tuple[Decimal, ...]:
    """Return one-based average ranks with deterministic exact tie handling."""

    if not values:
        raise VG26Error("rank calculation requires at least one value")
    indexed = sorted(enumerate(values), key=lambda item: (item[1], item[0]))
    ranks = [Decimal(0) for _ in values]
    cursor = 0
    while cursor < len(indexed):
        end = cursor + 1
        while end < len(indexed) and indexed[end][1] == indexed[cursor][1]:
            end += 1
        average = (Decimal(cursor + 1) + Decimal(end)) / Decimal(2)
        for ordered_index in range(cursor, end):
            ranks[indexed[ordered_index][0]] = average
        cursor = end
    return tuple(ranks)


def spearman_correlation(
    left: Sequence[Decimal],
    right: Sequence[Decimal],
) -> Decimal:
    """Return exact Spearman rank correlation or fail on a constant input."""

    if len(left) != len(right) or len(left) < 3:
        raise VG26Error("Spearman inputs must be aligned with at least three rows")
    left_ranks = average_ranks(left)
    right_ranks = average_ranks(right)
    left_mean = mean_decimal(left_ranks)
    right_mean = mean_decimal(right_ranks)
    covariance = sum(
        (
            (left_rank - left_mean) * (right_rank - right_mean)
            for left_rank, right_rank in zip(left_ranks, right_ranks, strict=True)
        ),
        Decimal(0),
    )
    left_ss = sum(((rank - left_mean) ** 2 for rank in left_ranks), Decimal(0))
    right_ss = sum(((rank - right_mean) ** 2 for rank in right_ranks), Decimal(0))
    if left_ss == 0 or right_ss == 0:
        raise VG26Error("Spearman correlation is undefined for a constant input")
    denominator = (left_ss * right_ss).sqrt()
    value = covariance / denominator
    if value < Decimal(-1) or value > Decimal(1):
        raise VG26Error("Spearman correlation escaped [-1, 1]")
    return value


def compound_return(values: Sequence[Decimal]) -> Decimal:
    """Compound a sequence of simple returns."""

    wealth = Decimal(1)
    for value in values:
        wealth *= Decimal(1) + value
    return wealth - Decimal(1)


def trial_grid() -> tuple[Trial, ...]:
    """Return the frozen 3-by-4 trial grid in stable identifier order."""

    trials = [
        Trial(
            trial_id=f"vg26-l{lookback:02d}-r{int(threshold * 10_000):04d}",
            lookback_days=lookback,
            correlation_threshold=threshold,
        )
        for lookback in (20, 40, 60)
        for threshold in (
            Decimal("0.00"),
            Decimal("0.10"),
            Decimal("0.20"),
            Decimal("0.30"),
        )
    ]
    return tuple(sorted(trials, key=lambda trial: trial.trial_id))


def trial_mapping(trial: Trial) -> dict[str, object]:
    """Return the public JSON contract for one trial."""

    return {
        "correlationThreshold": format(trial.correlation_threshold, "f"),
        "lookbackDays": trial.lookback_days,
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


def fetch_public_bytes(url: str) -> tuple[bytes, str | None, str | None]:
    """Fetch one public object with bounded retries and no credential headers."""

    last_error: Exception | None = None
    for attempt in range(3):
        request = urllib.request.Request(
            url,
            headers={"User-Agent": "cosmos-vg26-public-research/1.0"},
            method="GET",
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                payload = response.read()
                if not payload:
                    raise VG26Error(f"public source returned empty bytes: {url}")
                return (
                    payload,
                    response.headers.get("ETag"),
                    response.headers.get("Last-Modified"),
                )
        except (TimeoutError, urllib.error.HTTPError, urllib.error.URLError) as error:
            last_error = error
            if attempt < 2:
                time.sleep(attempt + 1)
    raise VG26Error(f"public source fetch failed after three attempts: {url}") from last_error


def acquire_sources() -> None:
    """Download and checksum the exact source matrix without decompression."""

    if SOURCE_ACQUISITION.exists():
        raise VG26Error("source acquisition receipt already exists")
    if FREEZE_PATH.exists() or RUN_MARKER_PATH.exists() or RESULT_PATH.exists():
        raise VG26Error("source acquisition is closed after freeze or run")
    SOURCE_ROOT.mkdir(parents=True, exist_ok=True)
    artifact_pairs: list[dict[str, object]] = []
    for symbol in COHORT:
        for month in SOURCE_MONTHS:
            zip_path, checksum_path = expected_archive_paths(symbol, month)
            checksum_url = archive_url(symbol, month, checksum=True)
            zip_url = archive_url(symbol, month)
            checksum_bytes, checksum_etag, checksum_last_modified = fetch_public_bytes(checksum_url)
            zip_bytes, zip_etag, zip_last_modified = fetch_public_bytes(zip_url)
            zip_sha = hashlib.sha256(zip_bytes).hexdigest()
            verify_checksum_text(checksum_bytes, zip_path.name, zip_sha)
            zip_path.parent.mkdir(parents=True, exist_ok=True)
            write_bytes_atomic(zip_path, zip_bytes)
            write_bytes_atomic(checksum_path, checksum_bytes)
            artifact_pairs.append(
                {
                    "checksumBytes": len(checksum_bytes),
                    "checksumFrozenEtag": checksum_etag,
                    "checksumFrozenLastModified": checksum_last_modified,
                    "checksumSha256": hashlib.sha256(checksum_bytes).hexdigest(),
                    "checksumUrl": checksum_url,
                    "month": month,
                    "state": "DOWNLOADED_VERIFIED",
                    "symbol": symbol,
                    "zipBytes": len(zip_bytes),
                    "zipFrozenEtag": zip_etag,
                    "zipFrozenLastModified": zip_last_modified,
                    "zipSha256": zip_sha,
                    "zipUrl": zip_url,
                }
            )
    receipt = {
        "archiveBodiesOpened": False,
        "archiveSourceCommit": PUBLIC_DATA_COMMIT,
        "artifactPairCount": len(artifact_pairs),
        "artifactPairs": artifact_pairs,
        "completedAtUtc": utc_now(),
        "schema": "VG26BinancePublicAcquisitionV1",
        "spotDocsCommit": SPOT_DOCS_COMMIT,
        "state": "CHECKSUM_VERIFIED_ARCHIVES_NOT_DECOMPRESSED",
    }
    write_json_once(SOURCE_ACQUISITION, receipt)
    print(f"ACQUIRED pairs={len(artifact_pairs)} receipt={sha256_path(SOURCE_ACQUISITION)}")


def verify_checksum_text(checksum_bytes: bytes, zip_name: str, zip_sha: str) -> None:
    """Validate an official Binance checksum sidecar against compressed bytes."""

    try:
        text = checksum_bytes.decode("ascii")
    except UnicodeDecodeError as error:
        raise VG26Error(f"{zip_name} checksum is not ASCII") from error
    match = CHECKSUM_RE.fullmatch(text)
    if match is None:
        raise VG26Error(f"{zip_name} checksum has invalid grammar")
    published_sha, published_name = match.groups()
    if published_name.strip() != zip_name:
        raise VG26Error(f"{zip_name} checksum names a different object")
    if published_sha != zip_sha:
        raise VG26Error(f"{zip_name} does not match its official checksum")


def mapping_list(value: object, *, field: str) -> list[dict[str, object]]:
    """Narrow an untyped JSON list to a list of object mappings."""

    if not isinstance(value, list) or any(not isinstance(item, dict) for item in value):
        raise VG26Error(f"{field} is not a list of objects")
    return cast(list[dict[str, object]], value)


def object_mapping(value: object, *, field: str) -> dict[str, object]:
    """Narrow an untyped JSON value to an object mapping."""

    if not isinstance(value, dict):
        raise VG26Error(f"{field} is not an object")
    return cast(dict[str, object], value)


def validate_protocol_contract(protocol: Mapping[str, object]) -> None:
    """Require the prose/JSON protocol to match executable frozen constants."""

    if protocol.get("schema") != "VG26PriceVolumeCorrelationRegimeProtocolV1":
        raise VG26Error("protocol schema mismatch")
    if protocol.get("baseCommit") != BASE_COMMIT:
        raise VG26Error("protocol base commit mismatch")
    universe = object_mapping(protocol.get("universe"), field="universe")
    if universe.get("cohort") != list(COHORT) or universe.get("quoteAsset") != "USDT":
        raise VG26Error("protocol cohort or quote asset differs from evaluator")
    signal = object_mapping(protocol.get("signal"), field="signal")
    grid = object_mapping(signal.get("candidateGrid"), field="signal.candidateGrid")
    if grid != {
        "lookbackCompleteDays": [20, 40, 60],
        "medianSpearmanThreshold": ["0.00", "0.10", "0.20", "0.30"],
        "trialCount": 12,
    }:
        raise VG26Error("protocol candidate grid differs from evaluator")
    data = object_mapping(protocol.get("data"), field="data")
    if (
        data.get("sourceMonths") != list(SOURCE_MONTHS)
        or data.get("warmupStartUtc") != "2025-01-01T00:00:00Z"
        or data.get("developmentStartUtc") != "2025-03-03T00:00:00Z"
        or data.get("developmentEndExclusiveUtc") != "2026-01-01T00:00:00Z"
        or data.get("holdoutStartUtc") != "2026-01-01T00:00:00Z"
        or data.get("holdoutEndExclusiveUtc") != "2026-04-01T00:00:00Z"
        or data.get("sourceCorpusRoot") != str(SOURCE_ROOT)
    ):
        raise VG26Error("protocol source or evaluation dates differ from evaluator")
    costs = object_mapping(protocol.get("costs"), field="costs")
    if (
        costs.get("publicRegularTakerFeeBpsPerExecutedSide") != 10
        or costs.get("baseAdversePriceBpsPerExecutedSide") != 10
        or costs.get("baseTotalBpsPerExecutedSide") != 20
        or costs.get("stressAdversePriceBpsPerExecutedSide") != 25
        or costs.get("stressTotalBpsPerExecutedSide") != 35
        or costs.get("accountEffectiveFeeTruth") != "UNKNOWN"
    ):
        raise VG26Error("protocol cost scenario differs from evaluator")
    inference = object_mapping(protocol.get("inference"), field="inference")
    if (
        inference.get("bootstrapBlockLengthDays") != BOOTSTRAP_BLOCK_DAYS
        or inference.get("bootstrapReplicates") != BOOTSTRAP_REPLICATES
        or inference.get("bootstrapSeed") != str(BOOTSTRAP_SEED)
        or inference.get("cscvBlocks") != "TEN_DEVELOPMENT_CALENDAR_MONTHS_CHOOSE_FIVE"
        or inference.get("multiplicity")
        != ("HOLM_BONFERRONI_OVER_ALL_TWELVE_EXCESS_VS_ALWAYS_ON_ONE_SIDED_P_VALUES")
    ):
        raise VG26Error("protocol inference contract differs from evaluator")
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
        raise VG26Error("protocol bootstrap seed schedule differs from evaluator")
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
        "publicCapacityProxyMinimumUsd": "1000",
        "stressNetMeanMustExceedUsdPerDayPer1000": "0",
    }:
        raise VG26Error("protocol development gates differ from evaluator")
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
        "publicCapacityProxyMinimumUsd": "1000",
        "stressNetMeanMustExceedUsdPerDayPer1000": "0",
    }:
        raise VG26Error("protocol holdout gates differ from evaluator")
    provenance = object_mapping(protocol.get("provenance"), field="provenance")
    if provenance != {
        "binancePublicDataCommit": PUBLIC_DATA_COMMIT,
        "binanceSpotApiDocsCommit": SPOT_DOCS_COMMIT,
        "refreshDateUtc": "2026-07-29",
        "scope": "BINANCE_PUBLIC_ONLY_NO_CREDENTIALS_NO_SIGNED_ENDPOINTS",
    }:
        raise VG26Error("protocol official-source provenance differs from evaluator")


def source_artifact_row(pair: Mapping[str, object]) -> dict[str, object]:
    """Freeze one archive pair without opening its ZIP container."""

    symbol = str(pair.get("symbol", ""))
    month = str(pair.get("month", ""))
    if symbol not in COHORT or month not in SOURCE_MONTHS:
        raise VG26Error("source pair identity is outside the frozen matrix")
    if pair.get("zipUrl") != archive_url(symbol, month) or pair.get("checksumUrl") != archive_url(
        symbol, month, checksum=True
    ):
        raise VG26Error(f"source pair URL differs from protocol {symbol} {month}")
    zip_path, checksum_path = expected_archive_paths(symbol, month)
    if not zip_path.is_file() or not checksum_path.is_file():
        raise VG26Error(f"missing frozen source pair {symbol} {month}")
    if pair.get("state") != "DOWNLOADED_VERIFIED":
        raise VG26Error(f"source pair state is inadmissible for {symbol} {month}")
    zip_sha = sha256_path(zip_path)
    checksum_sha = sha256_path(checksum_path)
    if zip_sha != pair.get("zipSha256"):
        raise VG26Error(f"{zip_path.name} SHA-256 differs from acquisition receipt")
    if checksum_sha != pair.get("checksumSha256"):
        raise VG26Error(f"{checksum_path.name} SHA-256 differs from acquisition receipt")
    if zip_path.stat().st_size != int(str(pair.get("zipBytes", "-1"))):
        raise VG26Error(f"{zip_path.name} byte length differs from acquisition receipt")
    if checksum_path.stat().st_size != int(str(pair.get("checksumBytes", "-1"))):
        raise VG26Error(f"{checksum_path.name} byte length differs from acquisition receipt")
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
        raise VG26Error("source acquisition receipt is absent")
    acquisition_sha = sha256_path(SOURCE_ACQUISITION)
    acquisition = load_json(SOURCE_ACQUISITION)
    if (
        acquisition.get("schema") != "VG26BinancePublicAcquisitionV1"
        or acquisition.get("state") != "CHECKSUM_VERIFIED_ARCHIVES_NOT_DECOMPRESSED"
        or acquisition.get("archiveBodiesOpened") is not False
        or acquisition.get("archiveSourceCommit") != PUBLIC_DATA_COMMIT
        or acquisition.get("spotDocsCommit") != SPOT_DOCS_COMMIT
        or acquisition.get("artifactPairCount") != len(COHORT) * len(SOURCE_MONTHS)
    ):
        raise VG26Error("source acquisition state is inadmissible")
    pairs = mapping_list(acquisition.get("artifactPairs"), field="artifactPairs")
    wanted = {(symbol, month) for symbol in COHORT for month in SOURCE_MONTHS}
    selected_pairs: dict[tuple[str, str], Mapping[str, object]] = {}
    for pair in pairs:
        identity = (str(pair.get("symbol", "")), str(pair.get("month", "")))
        if identity not in wanted:
            continue
        if identity in selected_pairs:
            raise VG26Error(f"duplicate acquisition receipt {identity[0]} {identity[1]}")
        selected_pairs[identity] = pair
    missing = sorted(wanted - set(selected_pairs))
    if missing:
        symbol, month = missing[0]
        raise VG26Error(f"missing required acquisition receipt {symbol} {month}")
    artifacts = [
        source_artifact_row(selected_pairs[(symbol, month)])
        for symbol in COHORT
        for month in SOURCE_MONTHS
    ]
    if len(artifacts) != len(COHORT) * len(SOURCE_MONTHS):
        raise VG26Error("source artifact matrix is not exactly 12 by 15")
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
        "schema": "VG26FrozenBinancePublicSourceManifestV1",
        "sourceRoot": str(SOURCE_ROOT),
        "spotDocsCommit": SPOT_DOCS_COMMIT,
        "state": "CHECKSUM_VERIFIED_COMPRESSED_BYTES_NOT_OPENED_BY_VG26",
        "symbolCount": len(COHORT),
    }


def required_document_hashes() -> dict[str, str]:
    """Bind the frozen protocol and explanatory documents."""

    for path in (PROTOCOL_PATH, SOURCE_RESEARCH_PATH, README_PATH, TEST_PATH):
        if not path.is_file():
            raise VG26Error(f"required protocol document is absent: {path.name}")
    return {
        "officialSourceResearchSha256": sha256_path(SOURCE_RESEARCH_PATH),
        "protocolSha256": sha256_path(PROTOCOL_PATH),
        "readmeSha256": sha256_path(README_PATH),
        "testSha256": sha256_path(TEST_PATH),
    }


def freeze() -> None:
    """Seal protocol and compressed sources before any archive is opened."""

    if RUN_MARKER_PATH.exists() or RESULT_PATH.exists():
        raise VG26Error("freeze is forbidden after the one-run marker")
    git_output("cat-file", "-e", f"{BASE_COMMIT}^{{commit}}")
    if git_output("merge-base", "--is-ancestor", BASE_COMMIT, "HEAD"):
        raise VG26Error("unexpected merge-base output")
    if git_output("status", "--porcelain"):
        raise VG26Error("freeze requires committed protocol and a clean worktree")
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
        "evaluatorPath": "quant/research/vg26/experiment.py",
        "evaluatorSha256": sha256_path(Path(__file__)),
        "gitHead": git_output("rev-parse", "HEAD"),
        "schema": "VG26PreOutcomeFreezeV1",
        "sourceManifestSha256": sha256_path(SOURCE_MANIFEST_PATH),
        "state": "READY_FOR_SOLE_ARCHIVE_DECOMPRESSION_RUN",
        "trialGridSha256": canonical_sha([trial_mapping(trial) for trial in trial_grid()]),
    }
    receipt.update(hashes)
    write_json_once(FREEZE_PATH, receipt)
    write_sha256s()
    print(f"FROZEN artifacts={manifest['artifactCount']} source={receipt['sourceManifestSha256']}")


def parse_timestamp_us(raw: str, *, field: str) -> tuple[int, datetime]:
    """Parse Binance's post-2025 public-archive microsecond timestamps."""

    try:
        value = int(raw)
    except ValueError as error:
        raise VG26Error(f"{field} is not an integer timestamp") from error
    if value < 1_000_000_000_000_000:
        raise VG26Error(f"{field} is not a post-2025 microsecond timestamp")
    seconds, microseconds = divmod(value, 1_000_000)
    try:
        parsed = datetime.fromtimestamp(seconds, tz=UTC) + timedelta(microseconds=microseconds)
    except (OverflowError, OSError, ValueError) as error:
        raise VG26Error(f"{field} timestamp is outside the supported range") from error
    return value, parsed


def parse_archive(artifact: Mapping[str, object]) -> tuple[Bar, ...]:
    """Open one post-freeze monthly archive and validate every daily row."""

    symbol = str(artifact.get("symbol", ""))
    month = str(artifact.get("month", ""))
    zip_path = SOURCE_ROOT / str(artifact.get("zipPath", ""))
    checksum_path = SOURCE_ROOT / str(artifact.get("checksumPath", ""))
    if symbol not in COHORT or month not in SOURCE_MONTHS:
        raise VG26Error("source artifact identity is outside the frozen matrix")
    if sha256_path(zip_path) != artifact.get("zipSha256"):
        raise VG26Error(f"{zip_path.name} changed after freeze")
    if sha256_path(checksum_path) != artifact.get("checksumSha256"):
        raise VG26Error(f"{checksum_path.name} changed after freeze")
    verify_checksum_text(
        checksum_path.read_bytes(),
        zip_path.name,
        str(artifact.get("zipSha256", "")),
    )
    if zip_path.stat().st_size > 10_000_000:
        raise VG26Error(f"{zip_path.name} exceeds the frozen parser bound")

    bars: list[Bar] = []
    with zipfile.ZipFile(zip_path) as archive:
        members = archive.infolist()
        if len(members) != 1 or members[0].is_dir():
            raise VG26Error(f"{zip_path.name} must contain exactly one regular member")
        member = members[0]
        expected_member = zip_path.name.removesuffix(".zip") + ".csv"
        if member.filename != expected_member or member.file_size > 20_000_000:
            raise VG26Error(f"{zip_path.name} member identity or size is invalid")
        with archive.open(member, "r") as raw:
            wrapper = io.TextIOWrapper(raw, encoding="ascii", newline="")
            reader = csv.reader(wrapper)
            for row_number, row in enumerate(reader, start=1):
                if row_number == 1 and tuple(row) == KLINE_HEADER:
                    continue
                if len(row) != 12:
                    raise VG26Error(f"{zip_path.name}:{row_number} does not have 12 kline fields")
                open_us, open_datetime = parse_timestamp_us(row[0], field="openTime")
                close_us, close_datetime = parse_timestamp_us(row[6], field="closeTime")
                if open_datetime.time() != datetime.min.time():
                    raise VG26Error(f"{zip_path.name}:{row_number} is not a UTC daily open")
                if open_datetime.strftime("%Y-%m") != month:
                    raise VG26Error(f"{zip_path.name}:{row_number} lies outside its month")
                if close_us != open_us + 86_400_000_000 - 1:
                    raise VG26Error(f"{zip_path.name}:{row_number} close boundary is invalid")
                if close_datetime.date() != open_datetime.date():
                    raise VG26Error(f"{zip_path.name}:{row_number} is not a closed daily bar")
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
                    raise VG26Error(
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
                    raise VG26Error(
                        f"{zip_path.name}:{row_number} violates OHLC or positive-volume bounds"
                    )
                if trade_count < 0 or taker_base > base_volume or taker_quote > quote_volume:
                    raise VG26Error(f"{zip_path.name}:{row_number} violates volume/count bounds")
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
        raise VG26Error(f"{zip_path.name} contains duplicate UTC daily rows")
    if actual_days != tuple(sorted(actual_days)):
        raise VG26Error(f"{zip_path.name} daily rows are unsorted")
    if actual_days != expected_days:
        raise VG26Error(f"{zip_path.name} has a UTC calendar gap or extra row")
    return tuple(bars)


def manifest_artifacts(source_manifest: Mapping[str, object]) -> list[dict[str, object]]:
    """Return and validate the source-manifest artifact inventory."""

    artifacts = mapping_list(source_manifest.get("artifacts"), field="artifacts")
    if len(artifacts) != len(COHORT) * len(SOURCE_MONTHS):
        raise VG26Error("source manifest artifact count is not exactly 180")
    identities = {
        (str(artifact.get("symbol", "")), str(artifact.get("month", ""))) for artifact in artifacts
    }
    expected = {(symbol, month) for symbol in COHORT for month in SOURCE_MONTHS}
    if identities != expected:
        raise VG26Error("source manifest artifact matrix differs from the protocol")
    return artifacts


def load_bars(
    source_manifest: Mapping[str, object],
    months: frozenset[str],
    existing: Mapping[str, Mapping[date, Bar]] | None = None,
) -> dict[str, dict[date, Bar]]:
    """Open only declared source months and reject all duplicate/gap states."""

    if not months.issubset(set(SOURCE_MONTHS)):
        raise VG26Error("requested source month is outside the frozen matrix")
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
        raise VG26Error("requested source slice is incomplete")
    for artifact in sorted(
        selected,
        key=lambda item: (str(item.get("symbol", "")), str(item.get("month", ""))),
    ):
        for bar in parse_archive(artifact):
            by_day = loaded.setdefault(bar.symbol, {})
            if bar.day in by_day:
                raise VG26Error(f"duplicate daily bar {bar.symbol} {bar.day.isoformat()}")
            by_day[bar.day] = bar

    requested_days = tuple(
        day for month in sorted(months) for day in date_range(*month_bounds(month))
    )
    for symbol in COHORT:
        cohort_days = loaded.get(symbol)
        if cohort_days is None:
            raise VG26Error(f"required cohort member is absent: {symbol}")
        absent = [day for day in requested_days if day not in cohort_days]
        if absent:
            raise VG26Error(f"required daily bar gap {symbol} {absent[0].isoformat()}")
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
            raise VG26Error(f"missing cohort open {symbol} {day.isoformat()}") from error
    return prices


def regime_score_at_open(
    bars: Mapping[str, Mapping[date, Bar]],
    trial: Trial,
    open_day: date,
) -> Decimal:
    """Compute the lagged cross-symbol median price-volume Spearman score."""

    signal_day = open_day - timedelta(days=1)
    history_days = tuple(
        signal_day - timedelta(days=offset) for offset in range(trial.lookback_days, -1, -1)
    )
    correlations: list[Decimal] = []
    for symbol in COHORT:
        try:
            history = tuple(bars[symbol][day] for day in history_days)
        except KeyError as error:
            raise VG26Error(
                f"lagged correlation input gap {symbol} {open_day.isoformat()}"
            ) from error
        price_returns: list[Decimal] = []
        volume_changes: list[Decimal] = []
        for previous, current in itertools.pairwise(history):
            if previous.close <= 0 or previous.quote_volume <= 0:
                raise VG26Error(
                    f"lagged correlation denominator invalid {symbol} {current.day.isoformat()}"
                )
            price_returns.append(current.close / previous.close - Decimal(1))
            volume_changes.append(current.quote_volume / previous.quote_volume - Decimal(1))
        correlations.append(spearman_correlation(price_returns, volume_changes))
    return median_decimal(correlations)


def target_at_open(
    bars: Mapping[str, Mapping[date, Bar]],
    trial: Trial,
    open_day: date,
) -> bool:
    """Return the causal regime state determined before the target open."""

    return regime_score_at_open(bars, trial, open_day) >= trial.correlation_threshold


def capacity_at_open(
    bars: Mapping[str, Mapping[date, Bar]],
    open_day: date,
) -> Decimal:
    """Conservative total cohort capacity from 1 bp of lagged quote volume.

    Because the cohort receives equal notional, the least-liquid constituent
    bounds each one-twelfth allocation.  The total proxy is therefore twelve
    times the smallest per-symbol 1 bp quote-volume amount.
    """

    signal_day = open_day - timedelta(days=1)
    lagged_days = tuple(signal_day - timedelta(days=offset) for offset in range(29, -1, -1))
    try:
        least = min(
            median_decimal(tuple(bars[symbol][day].quote_volume for day in lagged_days))
            for symbol in COHORT
        )
    except KeyError as error:
        raise VG26Error(f"lagged capacity input gap {open_day.isoformat()}") from error
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
        raise VG26Error("simulation segment requires at least two opens")
    scores = [regime_score_at_open(bars, trial, day) for day in open_days]
    targets = [score >= trial.correlation_threshold for score in scores]
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
        raise VG26Error("always-on benchmark failed to enter at its first open")

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
            raise VG26Error("simulated equity is non-positive")
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
        raise VG26Error("cost-scenario paths are not aligned")
    return TrialPaths(trial=trial, gross=gross, base=base, stress=stress)


def circular_block_bootstrap(
    daily_returns: Sequence[Decimal],
    *,
    seed: int,
) -> BootstrapSummary:
    """Compute seeded one-sided inference using circular seven-day blocks."""

    if len(daily_returns) < BOOTSTRAP_BLOCK_DAYS * 2:
        raise VG26Error("daily path is too short for circular-block inference")
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
    quantile_index = math.floor(float(ONE_SIDED_ALPHA) * (BOOTSTRAP_REPLICATES - 1))
    upper_index = math.ceil(float(Decimal(1) - ONE_SIDED_ALPHA) * (BOOTSTRAP_REPLICATES - 1))
    observed = mean_decimal(daily_returns)
    null_exceedances = sum(
        replicate_mean - observed >= observed for replicate_mean in replicate_means
    )
    p_value = Decimal(null_exceedances + 1) / Decimal(BOOTSTRAP_REPLICATES + 1)
    return BootstrapSummary(
        mean=observed,
        one_sided_95_lcb=replicate_means[quantile_index],
        two_sided_90_ucb=replicate_means[upper_index],
        one_sided_p_value=p_value,
    )


def max_drawdown_from_equity(equity_values: Sequence[Decimal]) -> Decimal:
    """Return positive peak-to-trough drawdown over an explicit equity path."""

    if not equity_values or any(value <= 0 for value in equity_values):
        raise VG26Error("drawdown requires a nonempty positive equity path")
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
        raise VG26Error("daily date and return paths differ in length")
    output: list[Decimal] = []
    for fold in month_folds:
        members = [
            value
            for day, value in zip(ending_days, daily_returns, strict=True)
            if day.strftime("%Y-%m") in fold
        ]
        if not members:
            raise VG26Error(f"calendar fold has no observations: {fold}")
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


def holm_adjusted(raw_p_values: Mapping[str, Decimal]) -> dict[str, Decimal]:
    """Return deterministic Holm-Bonferroni adjusted p-values."""

    ordered = sorted(raw_p_values.items(), key=lambda item: (item[1], item[0]))
    count = len(ordered)
    adjusted: dict[str, Decimal] = {}
    running = Decimal(0)
    for rank, (trial_id, p_value) in enumerate(ordered):
        candidate = min(Decimal(1), Decimal(count - rank) * p_value)
        running = max(running, candidate)
        adjusted[trial_id] = running
    return adjusted


def cscv_pbo(evaluations: Sequence[DevelopmentEvaluation]) -> dict[str, object]:
    """Estimate report-only PBO over ten aligned monthly slices.

    Every 5-of-10 training split is paired with its five-month complement.
    The in-sample winner's out-of-sample percentile among all twelve trials is
    converted to log odds; PBO is the share of non-positive log odds.
    """

    if not evaluations:
        raise VG26Error("PBO requires development evaluations")
    distinct_paths = len(
        {
            canonical_sha([decimal_text(value) for value in item.paths.base.excess_daily_returns])
            for item in evaluations
        }
    )
    if distinct_paths < 2:
        return {
            "distinctTrialPathCount": distinct_paths,
            "method": "CSCV_10_MONTHS_CHOOSE_5_REPORT_ONLY",
            "pbo": None,
            "splitCount": 0,
            "status": "NOT_ESTIMABLE_DISTINCT_PATHS_BELOW_2",
        }
    months = DEVELOPMENT_MONTHS
    month_indices: dict[str, tuple[int, ...]] = {}
    reference_days = evaluations[0].paths.base.ending_days
    for month in months:
        indices = tuple(
            index for index, day in enumerate(reference_days) if day.strftime("%Y-%m") == month
        )
        if not indices:
            raise VG26Error(f"PBO month has no aligned observations: {month}")
        month_indices[month] = indices
    logits: list[float] = []
    all_months = frozenset(months)
    for training in itertools.combinations(months, len(months) // 2):
        training_set = frozenset(training)
        testing_set = all_months - training_set

        def slice_score(
            evaluation: DevelopmentEvaluation,
            selected_months: frozenset[str],
        ) -> Decimal:
            indices = tuple(
                index for month in sorted(selected_months) for index in month_indices[month]
            )
            return mean_decimal(
                tuple(evaluation.paths.base.excess_daily_returns[index] for index in indices)
            )

        in_sample = sorted(
            (
                (slice_score(evaluation, training_set), evaluation.paths.trial.trial_id)
                for evaluation in evaluations
            ),
            key=lambda item: (-item[0], item[1]),
        )
        winner_id = in_sample[0][1]
        out_sample = {
            evaluation.paths.trial.trial_id: slice_score(evaluation, testing_set)
            for evaluation in evaluations
        }
        winner_score = out_sample[winner_id]
        lower_count = sum(score < winner_score for score in out_sample.values())
        tie_count = sum(score == winner_score for score in out_sample.values())
        percentile = (float(lower_count) + 0.5 * float(tie_count)) / len(out_sample)
        logits.append(0.0 if percentile == 0.5 else math.log(percentile / (1.0 - percentile)))
    nonpositive = sum(value <= 0 for value in logits)
    return {
        "distinctTrialPathCount": distinct_paths,
        "method": "CSCV_10_MONTHS_CHOOSE_5_REPORT_ONLY",
        "pbo": decimal_text(Decimal(nonpositive) / Decimal(len(logits))),
        "splitCount": len(logits),
        "status": "MEASURED_REPORT_ONLY",
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
        raise VG26Error("development trial paths are not date-aligned")
    adjusted = holm_adjusted(
        {
            paths.trial.trial_id: excess_bootstrap.one_sided_p_value
            for paths, _absolute_bootstrap, excess_bootstrap, *_rest in raw
        }
    )
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
            "capacityProxyAtLeast1000Usd": (capacity is not None and capacity >= CAPACITY_GATE_USD),
            "holmAdjustedPBelow005": (adjusted[paths.trial.trial_id] < ONE_SIDED_ALPHA),
            "maxDrawdownAtMost20Pct": drawdown <= MAX_DRAWDOWN,
            "offDayCountAtLeast30": paths.base.off_days >= 30,
            "onDayCountAtLeast30": paths.base.on_days >= 30,
            "positiveAbsoluteTwoMonthFoldsAtLeast4Of5": sum(value > 0 for value in folds) >= 4,
            "positiveExcessTwoMonthFoldsAtLeast4Of5": (
                sum(value > 0 for value in excess_folds) >= 4
            ),
            "excessOneSided95LcbPositive": excess_bootstrap.one_sided_95_lcb > 0,
            "stressMeanPositive": stress_mean > 0,
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
                holm_adjusted_p=adjusted[paths.trial.trial_id],
                gates=gates,
            )
        )
    ordered = tuple(sorted(evaluations, key=lambda item: item.paths.trial.trial_id))
    passing = [evaluation for evaluation in ordered if all(evaluation.gates.values())]
    champion = (
        sorted(
            passing,
            key=lambda item: (
                -item.excess_bootstrap.one_sided_95_lcb,
                -item.absolute_bootstrap.one_sided_95_lcb,
                item.paths.base.transition_legs,
                -item.paths.trial.correlation_threshold,
                -item.paths.trial.lookback_days,
                item.paths.trial.trial_id,
            ),
        )[0]
        if passing
        else None
    )
    return ordered, champion, cscv_pbo(ordered)


def evaluation_mapping(evaluation: DevelopmentEvaluation) -> dict[str, object]:
    """Serialize one development trial and every gate input."""

    return {
        "base": scenario_metrics(evaluation.paths.base),
        "capacity": {
            "gateUsd": decimal_text(CAPACITY_GATE_USD),
            "method": "12_X_MIN_CONSTITUENT_LAGGED_30D_MEDIAN_QUOTE_VOLUME_X_1BP",
            "minimumTransitionProxyUsd": (
                None
                if evaluation.capacity_proxy_usd is None
                else decimal_text(evaluation.capacity_proxy_usd)
            ),
            "scope": "PUBLIC_DAILY_VOLUME_PROXY_NOT_EXECUTABLE_DEPTH",
        },
        "gates": dict(evaluation.gates),
        "gross": scenario_metrics(evaluation.paths.gross),
        "inference": {
            "blockDays": BOOTSTRAP_BLOCK_DAYS,
            "holmAdjustedPValue": decimal_text(evaluation.holm_adjusted_p),
            "method": "SEEDED_CIRCULAR_BLOCK_BOOTSTRAP",
            "absoluteBase": {
                "meanDailyReturn": decimal_text(evaluation.absolute_bootstrap.mean),
                "oneSided95Lcb": decimal_text(evaluation.absolute_bootstrap.one_sided_95_lcb),
                "oneSided95LcbUsdPerDayPer1000": decimal_text(
                    STARTING_NOTIONAL_USD * evaluation.absolute_bootstrap.one_sided_95_lcb
                ),
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
        raise VG26Error("freeze receipt and source manifest are required")
    freeze_receipt = load_json(FREEZE_PATH)
    source_manifest = load_json(SOURCE_MANIFEST_PATH)
    validate_protocol_contract(load_json(PROTOCOL_PATH))
    if freeze_receipt.get("schema") != "VG26PreOutcomeFreezeV1":
        raise VG26Error("freeze schema is invalid")
    if freeze_receipt.get("state") != "READY_FOR_SOLE_ARCHIVE_DECOMPRESSION_RUN":
        raise VG26Error("freeze state is invalid")
    if freeze_receipt.get("baseCommit") != BASE_COMMIT:
        raise VG26Error("freeze base commit mismatch")
    if source_manifest.get("schema") != "VG26FrozenBinancePublicSourceManifestV1":
        raise VG26Error("source manifest schema is invalid")
    if source_manifest.get("state") != "CHECKSUM_VERIFIED_COMPRESSED_BYTES_NOT_OPENED_BY_VG26":
        raise VG26Error("source manifest state is invalid")
    if freeze_receipt.get("evaluatorSha256") != sha256_path(Path(__file__)):
        raise VG26Error("evaluator changed after freeze")
    if freeze_receipt.get("sourceManifestSha256") != sha256_path(SOURCE_MANIFEST_PATH):
        raise VG26Error("source manifest changed after freeze")
    if freeze_receipt.get("trialGridSha256") != canonical_sha(
        [trial_mapping(trial) for trial in trial_grid()]
    ):
        raise VG26Error("trial grid changed after freeze")
    for field, digest in required_document_hashes().items():
        if freeze_receipt.get(field) != digest:
            raise VG26Error(f"{field} changed after freeze")
    if source_manifest.get("protocolSha256") != sha256_path(PROTOCOL_PATH):
        raise VG26Error("source manifest protocol binding mismatch")
    manifest_artifacts(source_manifest)
    return freeze_receipt, source_manifest


def consume_run_marker(freeze_receipt: Mapping[str, object]) -> str:
    """Consume the experiment's exclusive run before any ZIP is opened."""

    if RUN_MARKER_PATH.exists() or RESULT_PATH.exists():
        raise VG26Error("the sole experiment run was already consumed")
    if git_output("status", "--porcelain"):
        raise VG26Error("run requires a committed freeze packet and clean worktree")
    marker = {
        "archiveDecompressionRunOrdinal": 1,
        "consumedAtUtc": utc_now(),
        "evaluatorSha256": freeze_receipt.get("evaluatorSha256"),
        "freezeSha256": sha256_path(FREEZE_PATH),
        "gitHead": git_output("rev-parse", "HEAD"),
        "holdoutReuseMaximum": 1,
        "schema": "VG26ExclusiveRunMarkerV1",
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
        raise VG26Error("cannot seal candidate after holdout open")
    seal: dict[str, object] = {
        "baseCommit": BASE_COMMIT,
        "candidate": trial_mapping(champion.paths.trial),
        "createdAtUtc": utc_now(),
        "developmentRowsSha256": development_rows_sha256,
        "freezeSha256": sha256_path(FREEZE_PATH),
        "pboReportOnly": dict(pbo),
        "schema": "VG26CandidateSealV1",
        "selectionRule": (
            "HIGHEST_EXCESS_VS_ALWAYS_ON_ONE_SIDED_95_PERCENT_LCB_THEN_HIGHEST_"
            "ABSOLUTE_BASE_LCB_THEN_LOWER_TURNOVER_THEN_HIGHER_THRESHOLD_THEN_"
            "LONGER_LOOKBACK_THEN_TRIAL_ID"
        ),
        "sourceManifestSha256": sha256_path(SOURCE_MANIFEST_PATH),
        "state": "CHAMPION_SEALED_BEFORE_HOLDOUT_OPEN",
    }
    write_json_once(CANDIDATE_SEAL_PATH, seal)
    return seal


def open_holdout_once(candidate_seal: Mapping[str, object]) -> dict[str, object]:
    """Create the sole holdout-open receipt before parsing holdout ZIPs."""

    if not CANDIDATE_SEAL_PATH.is_file():
        raise VG26Error("holdout requires a candidate seal")
    if HOLDOUT_OPEN_PATH.exists():
        raise VG26Error("holdout was already opened")
    receipt = {
        "candidateSealSha256": sha256_path(CANDIDATE_SEAL_PATH),
        "firstEligibleEntryOpenUtc": "2026-01-02T00:00:00Z",
        "openedAtUtc": utc_now(),
        "reuseCount": 1,
        "schema": "VG26HoldoutOpenReceiptV1",
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
        "capacityProxyAtLeast1000Usd": (capacity is not None and capacity >= CAPACITY_GATE_USD),
        "excessMeanPositive": excess_bootstrap.mean > 0,
        "excessOneSided95LcbPositive": excess_bootstrap.one_sided_95_lcb > 0,
        "excessOneSidedPBelow005": excess_bootstrap.one_sided_p_value < ONE_SIDED_ALPHA,
        "maxDrawdownAtMost20Pct": drawdown <= MAX_DRAWDOWN,
        "offDayCountAtLeast10": paths.base.off_days >= 10,
        "onDayCountAtLeast10": paths.base.on_days >= 10,
        "positiveAbsoluteMonthsAtLeast2Of3": sum(value > 0 for value in month_returns) >= 2,
        "positiveExcessMonthsAtLeast2Of3": (sum(value > 0 for value in excess_month_returns) >= 2),
        "stressMeanPositive": mean_decimal(paths.stress.daily_returns) > 0,
    }
    metrics: dict[str, object] = {
        "base": scenario_metrics(paths.base),
        "boundaryPurge": {
            "firstEligibleSignalDay": "2026-01-01",
            "firstEligibleTargetOpen": "2026-01-02",
            "forcedFinalLiquidationOpen": "2026-03-31",
            "january01OpenTraded": False,
            "march31SignalTraded": False,
        },
        "capacity": {
            "gateUsd": decimal_text(CAPACITY_GATE_USD),
            "method": ("12_X_MIN_CONSTITUENT_LAGGED_30D_MEDIAN_QUOTE_VOLUME_X_1BP"),
            "minimumTransitionProxyUsd": (None if capacity is None else decimal_text(capacity)),
            "scope": "PUBLIC_DAILY_VOLUME_PROXY_NOT_EXECUTABLE_DEPTH",
        },
        "gates": gates,
        "gross": scenario_metrics(paths.gross),
        "inference": {
            "blockDays": BOOTSTRAP_BLOCK_DAYS,
            "method": "SEEDED_CIRCULAR_BLOCK_BOOTSTRAP",
            "absoluteBase": {
                "meanDailyReturn": decimal_text(absolute_bootstrap.mean),
                "oneSided95Lcb": decimal_text(absolute_bootstrap.one_sided_95_lcb),
                "oneSided95LcbUsdPerDayPer1000": decimal_text(
                    STARTING_NOTIONAL_USD * absolute_bootstrap.one_sided_95_lcb
                ),
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
            "developmentFirstEligibleSignalDay": "2025-03-02",
            "developmentFirstEligibleTargetOpen": "2025-03-03",
            "developmentFinalLiquidationOpen": "2025-12-31",
            "december31SignalTraded": False,
            "holdoutFirstEligibleSignalDay": "2026-01-01",
            "holdoutFirstEligibleTargetOpen": "2026-01-02",
            "holdoutFinalLiquidationOpen": "2026-03-31",
            "march31SignalTraded": False,
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
        "schema": "VG26TerminalProfitabilityVerdictV1",
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
                    "december31SignalTraded": False,
                    "firstEligibleSignalDay": "2025-03-02",
                    "firstEligibleTargetOpen": "2025-03-03",
                    "forcedFinalLiquidationOpen": "2025-12-31",
                    "january01OpenRead": False,
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
                "consumer": "N3_SUCCESSOR_FINAL_CONVERGENCE",
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
                    "december31SignalTraded": False,
                    "firstEligibleSignalDay": "2025-03-02",
                    "firstEligibleTargetOpen": "2025-03-03",
                    "forcedFinalLiquidationOpen": "2025-12-31",
                    "january01OpenRead": False,
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
                "consumer": "N3_SUCCESSOR_FINAL_CONVERGENCE",
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
            if isinstance(error, VG26Error)
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
    """Return visible packet files except the self-referential hash inventory."""

    return tuple(
        sorted(
            (
                path
                for path in HERE.iterdir()
                if path.is_file()
                and path.name != SHA256SUMS_PATH.name
                and not path.name.startswith(".")
            ),
            key=lambda path: path.name,
        )
    )


def write_sha256s() -> None:
    """Write a deterministic packet-local SHA-256 inventory."""

    lines = [f"{sha256_path(path)}  {path.name}\n" for path in packet_files()]
    write_bytes_atomic(SHA256SUMS_PATH, "".join(lines).encode("ascii"))


def verify_source_artifacts(source_manifest: Mapping[str, object]) -> None:
    """Reauthenticate compressed bytes and sidecars without opening ZIPs."""

    for artifact in manifest_artifacts(source_manifest):
        zip_path = SOURCE_ROOT / str(artifact.get("zipPath", ""))
        checksum_path = SOURCE_ROOT / str(artifact.get("checksumPath", ""))
        if sha256_path(zip_path) != artifact.get("zipSha256"):
            raise VG26Error(f"source ZIP drift: {zip_path.name}")
        if sha256_path(checksum_path) != artifact.get("checksumSha256"):
            raise VG26Error(f"source checksum drift: {checksum_path.name}")
        if zip_path.stat().st_size != int(str(artifact.get("zipBytes", "-1"))):
            raise VG26Error(f"source ZIP byte-length drift: {zip_path.name}")
        if checksum_path.stat().st_size != int(str(artifact.get("checksumBytes", "-1"))):
            raise VG26Error(f"source checksum byte-length drift: {checksum_path.name}")
        verify_checksum_text(
            checksum_path.read_bytes(),
            zip_path.name,
            str(artifact.get("zipSha256", "")),
        )


def verify_sha256s() -> None:
    """Authenticate exact packet inventory and content."""

    if not SHA256SUMS_PATH.is_file():
        raise VG26Error("SHA256SUMS is absent")
    expected: dict[str, str] = {}
    for line in SHA256SUMS_PATH.read_text(encoding="ascii").splitlines():
        parts = line.split("  ", 1)
        if len(parts) != 2 or re.fullmatch(r"[0-9a-f]{64}", parts[0]) is None:
            raise VG26Error("SHA256SUMS grammar is invalid")
        digest, name = parts
        if "/" in name or name in expected or name.startswith("."):
            raise VG26Error("SHA256SUMS name is invalid or duplicate")
        expected[name] = digest
    actual_names = {path.name for path in packet_files()}
    if set(expected) != actual_names:
        raise VG26Error("SHA256SUMS inventory differs from packet files")
    for path in packet_files():
        if sha256_path(path) != expected[path.name]:
            raise VG26Error(f"packet digest mismatch: {path.name}")


def verify_packet() -> None:
    """Verify the terminal packet without rerunning or decompressing sources."""

    freeze_receipt, source_manifest = validate_frozen_identity()
    verify_source_artifacts(source_manifest)
    if not RUN_MARKER_PATH.is_file() or not RESULT_PATH.is_file():
        raise VG26Error("terminal run marker and result are required")
    marker = load_json(RUN_MARKER_PATH)
    result = load_json(RESULT_PATH)
    freeze_head = str(freeze_receipt.get("gitHead", ""))
    marker_head = str(marker.get("gitHead", ""))
    current_head = git_output("rev-parse", "HEAD")
    if re.fullmatch(r"[0-9a-f]{40}", freeze_head) is None:
        raise VG26Error("freeze Git head is invalid")
    if re.fullmatch(r"[0-9a-f]{40}", marker_head) is None:
        raise VG26Error("run marker Git head is invalid")
    if not git_commit_is_ancestor(BASE_COMMIT, freeze_head):
        raise VG26Error("freeze Git head is outside canonical lineage")
    if not git_commit_is_ancestor(freeze_head, marker_head):
        raise VG26Error("run marker does not descend from the frozen protocol")
    if not git_commit_is_ancestor(marker_head, current_head):
        raise VG26Error("current candidate does not descend from the committed freeze")
    frozen_code_paths = {
        "quant/research/vg26/OFFICIAL_SOURCE_RESEARCH.md": SOURCE_RESEARCH_PATH,
        "quant/research/vg26/README.md": README_PATH,
        "quant/research/vg26/experiment.py": Path(__file__),
        "quant/research/vg26/protocol.v1.json": PROTOCOL_PATH,
        "quant/research/vg26/test_experiment.py": TEST_PATH,
    }
    for relative_path, current_path in frozen_code_paths.items():
        if git_blob_sha256(freeze_head, relative_path) != sha256_path(current_path):
            raise VG26Error(f"frozen Git blob mismatch: {relative_path}")
    committed_freeze_paths = {
        "quant/research/vg26/freeze.v1.json": FREEZE_PATH,
        "quant/research/vg26/source-manifest.v1.json": SOURCE_MANIFEST_PATH,
    }
    for relative_path, current_path in committed_freeze_paths.items():
        if git_blob_sha256(marker_head, relative_path) != sha256_path(current_path):
            raise VG26Error(f"committed freeze blob mismatch: {relative_path}")
    if marker.get("state") != "SOLE_ARCHIVE_DECOMPRESSION_RUN_CONSUMED":
        raise VG26Error("run marker state is invalid")
    if marker.get("archiveDecompressionRunOrdinal") != 1:
        raise VG26Error("run marker ordinal is invalid")
    if marker.get("evaluatorSha256") != freeze_receipt.get("evaluatorSha256"):
        raise VG26Error("run marker evaluator binding mismatch")
    if marker.get("freezeSha256") != sha256_path(FREEZE_PATH):
        raise VG26Error("run marker freeze binding mismatch")
    if marker.get("sourceManifestSha256") != sha256_path(SOURCE_MANIFEST_PATH):
        raise VG26Error("run marker source binding mismatch")
    if result.get("runMarkerSha256") != sha256_path(RUN_MARKER_PATH):
        raise VG26Error("result run marker binding mismatch")
    if result.get("freezeSha256") != sha256_path(FREEZE_PATH):
        raise VG26Error("result freeze binding mismatch")
    if result.get("protocolSha256") != sha256_path(PROTOCOL_PATH):
        raise VG26Error("result protocol binding mismatch")
    if result.get("sourceManifestSha256") != sha256_path(SOURCE_MANIFEST_PATH):
        raise VG26Error("result source binding mismatch")
    verdict = result.get("verdict")
    holdout = result.get("holdout")
    if result.get("schema") != "VG26TerminalProfitabilityVerdictV1":
        raise VG26Error("result schema is invalid")
    if result.get("capitalAuthority") != "NONE":
        raise VG26Error("result grants forbidden capital authority")
    side_effects = result.get("noSideEffects")
    if side_effects != {
        "hostMutation": False,
        "moneyMovement": False,
        "orderPlacement": False,
        "privateApiRead": False,
        "signedApiCall": False,
        "uiMutation": False,
    }:
        raise VG26Error("result side-effect boundary is invalid")
    if not isinstance(verdict, dict) or verdict.get("status") not in {
        "GO",
        "NO_GO",
        "UNMEASURED",
    }:
        raise VG26Error("result verdict is invalid")
    if not isinstance(holdout, dict):
        raise VG26Error("result holdout state is invalid")
    status = str(verdict["status"])
    holdout_state = holdout.get("state")
    if status == "GO":
        if holdout_state != "OPENED_ONCE_COMPLETE" or holdout.get("reuseCount") != 1:
            raise VG26Error("GO requires one complete holdout opening")
        metrics = holdout.get("metrics")
        if not isinstance(metrics, dict):
            raise VG26Error("GO holdout metrics are absent")
        gates = metrics.get("gates")
        if (
            not isinstance(gates, dict)
            or not gates
            or any(value is not True for value in gates.values())
        ):
            raise VG26Error("GO has a failed or invalid holdout gate")
    elif status == "NO_GO" and holdout_state == "OPENED_ONCE_COMPLETE":
        metrics = holdout.get("metrics")
        if not isinstance(metrics, dict):
            raise VG26Error("opened NO_GO holdout metrics are absent")
        gates = metrics.get("gates")
        if (
            not isinstance(gates, dict)
            or not gates
            or all(value is True for value in gates.values())
        ):
            raise VG26Error("opened NO_GO lacks a failed holdout gate")
    elif status == "NO_GO":
        development = result.get("development")
        if (
            holdout_state != "UNOPENED_UNTOUCHED"
            or holdout.get("reuseCount") != 0
            or not isinstance(development, dict)
            or development.get("state") != "COMPLETE_NO_GATE_PASSER"
        ):
            raise VG26Error("unopened NO_GO is inconsistent with development")
    else:
        net_edge = result.get("netEdge")
        if (
            status != "UNMEASURED"
            or holdout_state not in {"UNOPENED_UNTOUCHED", "OPENED_INCOMPLETE"}
            or holdout.get("metrics") is not None
            or not isinstance(net_edge, dict)
            or net_edge.get("scope") != "UNMEASURED"
        ):
            raise VG26Error("UNMEASURED result contains measured evidence")
    candidate_seal: dict[str, object] | None = None
    if CANDIDATE_SEAL_PATH.exists():
        candidate_seal = load_json(CANDIDATE_SEAL_PATH)
        if candidate_seal.get("schema") != "VG26CandidateSealV1":
            raise VG26Error("candidate seal schema is invalid")
        if candidate_seal.get("freezeSha256") != sha256_path(FREEZE_PATH):
            raise VG26Error("candidate seal freeze binding mismatch")
        if candidate_seal.get("sourceManifestSha256") != sha256_path(SOURCE_MANIFEST_PATH):
            raise VG26Error("candidate seal source binding mismatch")
    if HOLDOUT_OPEN_PATH.exists():
        if candidate_seal is None:
            raise VG26Error("holdout open exists without candidate seal")
        if holdout.get("state") not in {
            "OPENED_ONCE_COMPLETE",
            "OPENED_INCOMPLETE",
        }:
            raise VG26Error("result denies its holdout-open receipt")
        open_receipt = load_json(HOLDOUT_OPEN_PATH)
        if open_receipt.get("reuseCount") != 1:
            raise VG26Error("holdout reuse count is not exactly one")
        if open_receipt.get("candidateSealSha256") != sha256_path(CANDIDATE_SEAL_PATH):
            raise VG26Error("holdout receipt candidate binding mismatch")
        candidate = candidate_seal.get("candidate")
        if not isinstance(candidate, dict):
            raise VG26Error("candidate seal identity is invalid")
        if open_receipt.get("sealedTrialId") != candidate.get("trialId"):
            raise VG26Error("holdout receipt trial binding mismatch")
        if holdout.get("state") == "OPENED_ONCE_COMPLETE":
            development = result.get("development")
            if not isinstance(development, dict):
                raise VG26Error("complete holdout result lacks development evidence")
            candidate_rows = development.get("candidateRows")
            if not isinstance(candidate_rows, list):
                raise VG26Error("complete holdout result lacks candidate rows")
            if canonical_sha(candidate_rows) != candidate_seal.get("developmentRowsSha256"):
                raise VG26Error("result candidate rows differ from their seal")
            if development.get("championTrialId") != candidate.get("trialId"):
                raise VG26Error("result champion differs from its seal")
            if canonical_sha(development.get("pbo")) != canonical_sha(
                candidate_seal.get("pboReportOnly")
            ):
                raise VG26Error("result PBO differs from its candidate seal")
    else:
        if holdout.get("state") != "UNOPENED_UNTOUCHED":
            raise VG26Error("result claims an absent holdout was opened")
        if candidate_seal is not None and verdict.get("status") != "UNMEASURED":
            raise VG26Error("measured result has a stranded candidate seal")
        if candidate_seal is not None and holdout.get("candidateSealPresent") is not True:
            raise VG26Error("terminal result omits its stranded candidate seal")
    verify_sha256s()
    print(
        f"VERIFIED verdict={verdict['status']} "
        f"holdout={holdout['state']} "
        f"result={sha256_path(RESULT_PATH)}"
    )


def parse_args(arguments: Sequence[str]) -> argparse.Namespace:
    """Parse the five-command evaluator interface."""

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "command",
        choices=("acquire", "freeze", "run", "verify", "hashes"),
    )
    return parser.parse_args(arguments)


def main(arguments: Sequence[str] | None = None) -> int:
    """Dispatch one bounded evaluator command."""

    parsed = parse_args(sys.argv[1:] if arguments is None else arguments)
    try:
        if parsed.command == "acquire":
            acquire_sources()
        elif parsed.command == "freeze":
            freeze()
        elif parsed.command == "run":
            run_experiment()
        elif parsed.command == "verify":
            verify_packet()
        else:
            write_sha256s()
            print(f"HASHED files={len(packet_files())}")
    except (
        VG26Error,
        OSError,
        subprocess.CalledProcessError,
        zipfile.BadZipFile,
    ) as error:
        print(f"VG26_ERROR {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
