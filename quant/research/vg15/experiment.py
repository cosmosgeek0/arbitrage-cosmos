#!/usr/bin/env python3
"""Sealed Binance-public-only V-G15 volume-breadth regime experiment.

The command boundary is intentionally narrow:

* ``freeze`` authenticates compressed monthly ZIP bytes and their official
  checksum sidecars without opening any ZIP member.
* ``run`` consumes an exclusive marker, evaluates development, seals at most
  one champion, and opens the chronological holdout at most once.
* ``verify`` authenticates the frozen sources and terminal packet without
  rerunning or decompressing the experiment.
* ``hashes`` refreshes the packet-local SHA-256 inventory.

The strategy is cohort-or-cash.  On an OFF-to-ON transition, the current
notional is split equally across every predeclared cohort member.  Units remain
fixed until the next ON-to-OFF transition; there is no daily cross-sectional
rebalancing, no shorting, and no leverage.
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
SOURCE_ROOT = Path("/private/tmp/cosmos-s1f-weekly-momentum-cash-v1")
SOURCE_ACQUISITION = SOURCE_ROOT / "acquisition-manifest.v1.json"
SOURCE_DISCOVERY = SOURCE_ROOT / "discovery.v1.json"
SOURCE_ACQUISITION_SHA256 = "01f58272602e43bfb914b649adc00d8273b2d423492220a55f86443bb6441176"
SOURCE_DISCOVERY_SHA256 = "b4a8f7abd36df19eff0510dfcc3c61fd0df9fdcab5f4d248892ee10010fb21c3"

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
DEVELOPMENT_SOURCE_MONTHS = frozenset(SOURCE_MONTHS[:10])
HOLDOUT_SOURCE_MONTHS = frozenset(SOURCE_MONTHS[10:])
DEVELOPMENT_MONTHS = tuple(SOURCE_MONTHS[2:10])
HOLDOUT_MONTHS = tuple(SOURCE_MONTHS[10:])
SOURCE_START = date(2025, 5, 1)
DEVELOPMENT_START = date(2025, 7, 1)
DEVELOPMENT_END = date(2026, 3, 1)
HOLDOUT_START = date(2026, 3, 2)
HOLDOUT_END = date(2026, 7, 1)

STARTING_NOTIONAL_USD = Decimal("1000")
PUBLIC_FEE_PER_SIDE = Decimal("0.0010")
BASE_ADVERSE_PER_SIDE = Decimal("0.0010")
STRESS_ADVERSE_PER_SIDE = Decimal("0.0025")
BASE_COST_PER_SIDE = PUBLIC_FEE_PER_SIDE + BASE_ADVERSE_PER_SIDE
STRESS_COST_PER_SIDE = PUBLIC_FEE_PER_SIDE + STRESS_ADVERSE_PER_SIDE
CAPACITY_PARTICIPATION = Decimal("0.0001")
CAPACITY_GATE_USD = Decimal("1000")
MAX_DRAWDOWN = Decimal("0.10")
BOOTSTRAP_SEED = 202_607_291_515
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


class VG15Error(RuntimeError):
    """A terminal V-G15 custody, schema, protocol, or measurement error."""


@dataclass(frozen=True, slots=True)
class Trial:
    """One predeclared breadth configuration."""

    trial_id: str
    lookback_days: int
    breadth_threshold: Decimal


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
    equity_at_open: tuple[Decimal, ...]
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
    bootstrap: BootstrapSummary
    fold_returns: tuple[Decimal, ...]
    max_drawdown: Decimal
    base_total_return: Decimal
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
        raise VG15Error(f"{path.name} must contain a JSON object")
    return cast(dict[str, object], value)


def write_json_once(path: Path, value: object) -> None:
    """Create an immutable JSON receipt or accept identical existing bytes."""

    payload = canonical_bytes(value)
    if path.exists():
        if path.read_bytes() != payload:
            raise VG15Error(f"refusing to replace non-identical {path.name}")
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
        raise VG15Error(f"{field} is not a decimal") from error
    if not value.is_finite() or (nonnegative and value < 0):
        raise VG15Error(f"{field} is outside its declared decimal domain")
    return value


def date_range(start: date, end_exclusive: date) -> tuple[date, ...]:
    """Return every calendar day in a half-open UTC interval."""

    days = (end_exclusive - start).days
    if days < 0:
        raise VG15Error("date range is reversed")
    return tuple(start + timedelta(days=offset) for offset in range(days))


def month_bounds(month: str) -> tuple[date, date]:
    """Return the half-open calendar bounds for a YYYY-MM month."""

    try:
        start = date.fromisoformat(f"{month}-01")
    except ValueError as error:
        raise VG15Error(f"invalid source month {month}") from error
    end = date(start.year + 1, 1, 1) if start.month == 12 else date(start.year, start.month + 1, 1)
    return start, end


def median_decimal(values: Sequence[Decimal]) -> Decimal:
    """Return the exact median without binary floating-point conversion."""

    if not values:
        raise VG15Error("median requires at least one value")
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) / 2


def mean_decimal(values: Sequence[Decimal]) -> Decimal:
    """Return an exact arithmetic mean."""

    if not values:
        raise VG15Error("mean requires at least one value")
    return sum(values, Decimal(0)) / Decimal(len(values))


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
            trial_id=f"vg15-l{lookback:02d}-b{int(threshold * 10_000):04d}",
            lookback_days=lookback,
            breadth_threshold=threshold,
        )
        for lookback in (20, 40, 60)
        for threshold in (
            Decimal("0.50"),
            Decimal("0.60"),
            Decimal("0.70"),
            Decimal("0.80"),
        )
    ]
    return tuple(sorted(trials, key=lambda trial: trial.trial_id))


def trial_mapping(trial: Trial) -> dict[str, object]:
    """Return the public JSON contract for one trial."""

    return {
        "breadthThreshold": format(trial.breadth_threshold, "f"),
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


def verify_checksum_text(checksum_bytes: bytes, zip_name: str, zip_sha: str) -> None:
    """Validate an official Binance checksum sidecar against compressed bytes."""

    try:
        text = checksum_bytes.decode("ascii")
    except UnicodeDecodeError as error:
        raise VG15Error(f"{zip_name} checksum is not ASCII") from error
    match = CHECKSUM_RE.fullmatch(text)
    if match is None:
        raise VG15Error(f"{zip_name} checksum has invalid grammar")
    published_sha, published_name = match.groups()
    if published_name.strip() != zip_name:
        raise VG15Error(f"{zip_name} checksum names a different object")
    if published_sha != zip_sha:
        raise VG15Error(f"{zip_name} does not match its official checksum")


def mapping_list(value: object, *, field: str) -> list[dict[str, object]]:
    """Narrow an untyped JSON list to a list of object mappings."""

    if not isinstance(value, list) or any(not isinstance(item, dict) for item in value):
        raise VG15Error(f"{field} is not a list of objects")
    return cast(list[dict[str, object]], value)


def object_mapping(value: object, *, field: str) -> dict[str, object]:
    """Narrow an untyped JSON value to an object mapping."""

    if not isinstance(value, dict):
        raise VG15Error(f"{field} is not an object")
    return cast(dict[str, object], value)


def validate_protocol_contract(protocol: Mapping[str, object]) -> None:
    """Require the prose/JSON protocol to match executable frozen constants."""

    if protocol.get("schema") != "VG15VolumeBreadthRegimeProtocolV1":
        raise VG15Error("protocol schema mismatch")
    if protocol.get("baseCommit") != BASE_COMMIT:
        raise VG15Error("protocol base commit mismatch")
    universe = object_mapping(protocol.get("universe"), field="universe")
    if universe.get("cohort") != list(COHORT) or universe.get("quoteAsset") != "USDT":
        raise VG15Error("protocol cohort or quote asset differs from evaluator")
    signal = object_mapping(protocol.get("signal"), field="signal")
    grid = object_mapping(signal.get("candidateGrid"), field="signal.candidateGrid")
    if grid != {
        "lookbackCompleteDays": [20, 40, 60],
        "threshold": ["0.50", "0.60", "0.70", "0.80"],
        "trialCount": 12,
    }:
        raise VG15Error("protocol candidate grid differs from evaluator")
    data = object_mapping(protocol.get("data"), field="data")
    if (
        data.get("sourceMonths") != list(SOURCE_MONTHS)
        or data.get("warmupStartUtc") != "2025-05-01T00:00:00Z"
        or data.get("developmentStartUtc") != "2025-07-01T00:00:00Z"
        or data.get("developmentEndExclusiveUtc") != "2026-03-01T00:00:00Z"
        or data.get("holdoutStartUtc") != "2026-03-01T00:00:00Z"
        or data.get("holdoutEndExclusiveUtc") != "2026-07-01T00:00:00Z"
    ):
        raise VG15Error("protocol source or evaluation dates differ from evaluator")
    costs = object_mapping(protocol.get("costs"), field="costs")
    if (
        costs.get("publicRegularTakerFeeBpsPerExecutedSide") != 10
        or costs.get("baseAdversePriceBpsPerExecutedSide") != 10
        or costs.get("stressAdversePriceBpsPerExecutedSide") != 25
        or costs.get("accountEffectiveFeeTruth") != "UNKNOWN"
    ):
        raise VG15Error("protocol cost scenario differs from evaluator")


def source_artifact_row(pair: Mapping[str, object]) -> dict[str, object]:
    """Freeze one archive pair without opening its ZIP container."""

    symbol = str(pair.get("symbol", ""))
    month = str(pair.get("month", ""))
    zip_path, checksum_path = expected_archive_paths(symbol, month)
    if not zip_path.is_file() or not checksum_path.is_file():
        raise VG15Error(f"missing frozen source pair {symbol} {month}")
    if pair.get("state") != "DOWNLOADED_VERIFIED":
        raise VG15Error(f"source pair state is inadmissible for {symbol} {month}")
    zip_sha = sha256_path(zip_path)
    checksum_sha = sha256_path(checksum_path)
    if zip_sha != pair.get("zipSha256"):
        raise VG15Error(f"{zip_path.name} SHA-256 differs from acquisition receipt")
    if checksum_sha != pair.get("checksumSha256"):
        raise VG15Error(f"{checksum_path.name} SHA-256 differs from acquisition receipt")
    if zip_path.stat().st_size != int(str(pair.get("zipBytes", "-1"))):
        raise VG15Error(f"{zip_path.name} byte length differs from acquisition receipt")
    if checksum_path.stat().st_size != int(str(pair.get("checksumBytes", "-1"))):
        raise VG15Error(f"{checksum_path.name} byte length differs from acquisition receipt")
    verify_checksum_text(checksum_path.read_bytes(), zip_path.name, zip_sha)
    return {
        "checksumBytes": checksum_path.stat().st_size,
        "checksumEtag": pair.get("checksumFrozenEtag"),
        "checksumLastModified": pair.get("checksumFrozenLastModified"),
        "checksumPath": str(checksum_path.relative_to(SOURCE_ROOT)),
        "checksumSha256": checksum_sha,
        "month": month,
        "symbol": symbol,
        "zipBytes": zip_path.stat().st_size,
        "zipEtag": pair.get("zipFrozenEtag"),
        "zipLastModified": pair.get("zipFrozenLastModified"),
        "zipPath": str(zip_path.relative_to(SOURCE_ROOT)),
        "zipSha256": zip_sha,
    }


def build_source_manifest() -> dict[str, object]:
    """Freeze the exact 12-by-14 compressed public artifact matrix."""

    if sha256_path(SOURCE_ACQUISITION) != SOURCE_ACQUISITION_SHA256:
        raise VG15Error("source acquisition manifest drifted")
    if sha256_path(SOURCE_DISCOVERY) != SOURCE_DISCOVERY_SHA256:
        raise VG15Error("source discovery receipt drifted")
    acquisition = load_json(SOURCE_ACQUISITION)
    if acquisition.get("state") != "CHECKSUM_VERIFIED_ARCHIVES_NOT_DECOMPRESSED":
        raise VG15Error("source acquisition state is inadmissible")
    pairs = mapping_list(acquisition.get("artifactPairs"), field="artifactPairs")
    wanted = {(symbol, month) for symbol in COHORT for month in SOURCE_MONTHS}
    selected_pairs: dict[tuple[str, str], Mapping[str, object]] = {}
    for pair in pairs:
        identity = (str(pair.get("symbol", "")), str(pair.get("month", "")))
        if identity not in wanted:
            continue
        if identity in selected_pairs:
            raise VG15Error(f"duplicate acquisition receipt {identity[0]} {identity[1]}")
        selected_pairs[identity] = pair
    missing = sorted(wanted - set(selected_pairs))
    if missing:
        symbol, month = missing[0]
        raise VG15Error(f"missing required acquisition receipt {symbol} {month}")
    artifacts = [
        source_artifact_row(selected_pairs[(symbol, month)])
        for symbol in COHORT
        for month in SOURCE_MONTHS
    ]
    if len(artifacts) != len(COHORT) * len(SOURCE_MONTHS):
        raise VG15Error("source artifact matrix is not exactly 12 by 14")
    return {
        "acquisitionManifestPath": str(SOURCE_ACQUISITION),
        "acquisitionManifestSha256": SOURCE_ACQUISITION_SHA256,
        "archiveBodiesOpenedDuringFreeze": False,
        "artifactCount": len(artifacts),
        "artifacts": artifacts,
        "cohort": list(COHORT),
        "cohortSha256": canonical_sha(list(COHORT)),
        "discoveryReceiptPath": str(SOURCE_DISCOVERY),
        "discoveryReceiptSha256": SOURCE_DISCOVERY_SHA256,
        "monthCount": len(SOURCE_MONTHS),
        "months": list(SOURCE_MONTHS),
        "protocolSha256": sha256_path(PROTOCOL_PATH),
        "schema": "VG15FrozenBinancePublicSourceManifestV1",
        "sourceRoot": str(SOURCE_ROOT),
        "state": "CHECKSUM_VERIFIED_COMPRESSED_BYTES_NOT_OPENED_BY_VG15",
        "symbolCount": len(COHORT),
    }


def required_document_hashes() -> dict[str, str]:
    """Bind the frozen protocol and explanatory documents."""

    for path in (PROTOCOL_PATH, SOURCE_RESEARCH_PATH, README_PATH, TEST_PATH):
        if not path.is_file():
            raise VG15Error(f"required protocol document is absent: {path.name}")
    return {
        "officialSourceResearchSha256": sha256_path(SOURCE_RESEARCH_PATH),
        "protocolSha256": sha256_path(PROTOCOL_PATH),
        "readmeSha256": sha256_path(README_PATH),
        "testSha256": sha256_path(TEST_PATH),
    }


def freeze() -> None:
    """Seal protocol and compressed sources before any archive is opened."""

    if RUN_MARKER_PATH.exists() or RESULT_PATH.exists():
        raise VG15Error("freeze is forbidden after the one-run marker")
    git_output("cat-file", "-e", f"{BASE_COMMIT}^{{commit}}")
    if git_output("merge-base", "--is-ancestor", BASE_COMMIT, "HEAD"):
        raise VG15Error("unexpected merge-base output")
    if git_output("status", "--porcelain"):
        raise VG15Error("freeze requires committed protocol and a clean worktree")
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
        "evaluatorPath": "quant/research/vg15/experiment.py",
        "evaluatorSha256": sha256_path(Path(__file__)),
        "gitHead": git_output("rev-parse", "HEAD"),
        "schema": "VG15PreOutcomeFreezeV1",
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
        raise VG15Error(f"{field} is not an integer timestamp") from error
    if value < 1_000_000_000_000_000:
        raise VG15Error(f"{field} is not a post-2025 microsecond timestamp")
    seconds, microseconds = divmod(value, 1_000_000)
    try:
        parsed = datetime.fromtimestamp(seconds, tz=UTC) + timedelta(microseconds=microseconds)
    except (OverflowError, OSError, ValueError) as error:
        raise VG15Error(f"{field} timestamp is outside the supported range") from error
    return value, parsed


def parse_archive(artifact: Mapping[str, object]) -> tuple[Bar, ...]:
    """Open one post-freeze monthly archive and validate every daily row."""

    symbol = str(artifact.get("symbol", ""))
    month = str(artifact.get("month", ""))
    zip_path = SOURCE_ROOT / str(artifact.get("zipPath", ""))
    checksum_path = SOURCE_ROOT / str(artifact.get("checksumPath", ""))
    if symbol not in COHORT or month not in SOURCE_MONTHS:
        raise VG15Error("source artifact identity is outside the frozen matrix")
    if sha256_path(zip_path) != artifact.get("zipSha256"):
        raise VG15Error(f"{zip_path.name} changed after freeze")
    if sha256_path(checksum_path) != artifact.get("checksumSha256"):
        raise VG15Error(f"{checksum_path.name} changed after freeze")
    verify_checksum_text(
        checksum_path.read_bytes(),
        zip_path.name,
        str(artifact.get("zipSha256", "")),
    )
    if zip_path.stat().st_size > 10_000_000:
        raise VG15Error(f"{zip_path.name} exceeds the frozen parser bound")

    bars: list[Bar] = []
    with zipfile.ZipFile(zip_path) as archive:
        members = archive.infolist()
        if len(members) != 1 or members[0].is_dir():
            raise VG15Error(f"{zip_path.name} must contain exactly one regular member")
        member = members[0]
        expected_member = zip_path.name.removesuffix(".zip") + ".csv"
        if member.filename != expected_member or member.file_size > 20_000_000:
            raise VG15Error(f"{zip_path.name} member identity or size is invalid")
        with archive.open(member, "r") as raw:
            wrapper = io.TextIOWrapper(raw, encoding="ascii", newline="")
            reader = csv.reader(wrapper)
            for row_number, row in enumerate(reader, start=1):
                if row_number == 1 and tuple(row) == KLINE_HEADER:
                    continue
                if len(row) != 12:
                    raise VG15Error(f"{zip_path.name}:{row_number} does not have 12 kline fields")
                open_us, open_datetime = parse_timestamp_us(row[0], field="openTime")
                close_us, close_datetime = parse_timestamp_us(row[6], field="closeTime")
                if open_datetime.time() != datetime.min.time():
                    raise VG15Error(f"{zip_path.name}:{row_number} is not a UTC daily open")
                if open_datetime.strftime("%Y-%m") != month:
                    raise VG15Error(f"{zip_path.name}:{row_number} lies outside its month")
                if close_us != open_us + 86_400_000_000 - 1:
                    raise VG15Error(f"{zip_path.name}:{row_number} close boundary is invalid")
                if close_datetime.date() != open_datetime.date():
                    raise VG15Error(f"{zip_path.name}:{row_number} is not a closed daily bar")
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
                    raise VG15Error(
                        f"{zip_path.name}:{row_number} trade count is not an integer"
                    ) from error
                if (
                    open_price <= 0
                    or high <= 0
                    or low <= 0
                    or close <= 0
                    or high < max(open_price, close, low)
                    or low > min(open_price, close, high)
                ):
                    raise VG15Error(f"{zip_path.name}:{row_number} violates OHLC geometry")
                if trade_count < 0 or taker_base > base_volume or taker_quote > quote_volume:
                    raise VG15Error(f"{zip_path.name}:{row_number} violates volume/count bounds")
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
        raise VG15Error(f"{zip_path.name} contains duplicate UTC daily rows")
    if actual_days != tuple(sorted(actual_days)):
        raise VG15Error(f"{zip_path.name} daily rows are unsorted")
    if actual_days != expected_days:
        raise VG15Error(f"{zip_path.name} has a UTC calendar gap or extra row")
    return tuple(bars)


def manifest_artifacts(source_manifest: Mapping[str, object]) -> list[dict[str, object]]:
    """Return and validate the source-manifest artifact inventory."""

    artifacts = mapping_list(source_manifest.get("artifacts"), field="artifacts")
    if len(artifacts) != len(COHORT) * len(SOURCE_MONTHS):
        raise VG15Error("source manifest artifact count is not exactly 168")
    identities = {
        (str(artifact.get("symbol", "")), str(artifact.get("month", ""))) for artifact in artifacts
    }
    expected = {(symbol, month) for symbol in COHORT for month in SOURCE_MONTHS}
    if identities != expected:
        raise VG15Error("source manifest artifact matrix differs from the protocol")
    return artifacts


def load_bars(
    source_manifest: Mapping[str, object],
    months: frozenset[str],
    existing: Mapping[str, Mapping[date, Bar]] | None = None,
) -> dict[str, dict[date, Bar]]:
    """Open only declared source months and reject all duplicate/gap states."""

    if not months.issubset(set(SOURCE_MONTHS)):
        raise VG15Error("requested source month is outside the frozen matrix")
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
        raise VG15Error("requested source slice is incomplete")
    for artifact in sorted(
        selected,
        key=lambda item: (str(item.get("symbol", "")), str(item.get("month", ""))),
    ):
        for bar in parse_archive(artifact):
            by_day = loaded.setdefault(bar.symbol, {})
            if bar.day in by_day:
                raise VG15Error(f"duplicate daily bar {bar.symbol} {bar.day.isoformat()}")
            by_day[bar.day] = bar

    requested_days = tuple(
        day for month in sorted(months) for day in date_range(*month_bounds(month))
    )
    for symbol in COHORT:
        cohort_days = loaded.get(symbol)
        if cohort_days is None:
            raise VG15Error(f"required cohort member is absent: {symbol}")
        absent = [day for day in requested_days if day not in cohort_days]
        if absent:
            raise VG15Error(f"required daily bar gap {symbol} {absent[0].isoformat()}")
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
            raise VG15Error(f"missing cohort open {symbol} {day.isoformat()}") from error
    return prices


def target_at_open(
    bars: Mapping[str, Mapping[date, Bar]],
    trial: Trial,
    open_day: date,
) -> bool:
    """Compute the causal prior-close breadth state for one target open."""

    signal_day = open_day - timedelta(days=1)
    baseline_days = tuple(
        signal_day - timedelta(days=offset) for offset in range(trial.lookback_days, 0, -1)
    )
    above = 0
    for symbol in COHORT:
        try:
            signal_volume = bars[symbol][signal_day].quote_volume
            baseline = median_decimal(
                tuple(bars[symbol][day].quote_volume for day in baseline_days)
            )
        except KeyError as error:
            raise VG15Error(f"lagged breadth input gap {symbol} {open_day.isoformat()}") from error
        if signal_volume > baseline:
            above += 1
    breadth = Decimal(above) / Decimal(len(COHORT))
    return breadth >= trial.breadth_threshold


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
        raise VG15Error(f"lagged capacity input gap {open_day.isoformat()}") from error
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
        raise VG15Error("simulation segment requires at least two opens")
    targets = [target_at_open(bars, trial, day) for day in open_days]
    targets[-1] = False
    portfolio = Portfolio(cash=STARTING_NOTIONAL_USD)
    first_prices = prices_at_open(bars, open_days[0])
    prior_equity = STARTING_NOTIONAL_USD
    transition_legs = 0
    capacities: list[Decimal] = []
    if transition_at_open(portfolio, targets[0], first_prices, side_cost):
        transition_legs += 1
        capacities.append(capacity_at_open(bars, open_days[0]))

    daily_returns: list[Decimal] = []
    ending_days: list[date] = []
    equity_at_open: list[Decimal] = [marked_value(portfolio, first_prices)]
    for index in range(1, len(open_days)):
        day = open_days[index]
        prices = prices_at_open(bars, day)
        transitioned = transition_at_open(portfolio, targets[index], prices, side_cost)
        if transitioned:
            transition_legs += 1
            capacities.append(capacity_at_open(bars, day))
        equity = marked_value(portfolio, prices)
        if prior_equity <= 0 or equity <= 0:
            raise VG15Error("simulated equity is non-positive")
        daily_returns.append(equity / prior_equity - Decimal(1))
        ending_days.append(day)
        equity_at_open.append(equity)
        prior_equity = equity

    return ScenarioPath(
        ending_days=tuple(ending_days),
        daily_returns=tuple(daily_returns),
        equity_at_open=tuple(equity_at_open),
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
        and gross.transition_legs == base.transition_legs == stress.transition_legs
        and gross.on_days == base.on_days == stress.on_days
        and gross.off_days == base.off_days == stress.off_days
        and gross.transition_capacity_proxy_usd
        == base.transition_capacity_proxy_usd
        == stress.transition_capacity_proxy_usd
    ):
        raise VG15Error("cost-scenario paths are not aligned")
    return TrialPaths(trial=trial, gross=gross, base=base, stress=stress)


def circular_block_bootstrap(
    daily_returns: Sequence[Decimal],
    *,
    seed: int,
) -> BootstrapSummary:
    """Compute seeded one-sided inference using circular seven-day blocks."""

    if len(daily_returns) < BOOTSTRAP_BLOCK_DAYS * 2:
        raise VG15Error("daily path is too short for circular-block inference")
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


def max_drawdown(daily_returns: Sequence[Decimal]) -> Decimal:
    """Return positive peak-to-trough drawdown magnitude."""

    equity = Decimal(1)
    peak = Decimal(1)
    worst = Decimal(0)
    for daily_return in daily_returns:
        equity *= Decimal(1) + daily_return
        peak = max(peak, equity)
        worst = max(worst, Decimal(1) - equity / peak)
    return worst


def fold_compound_returns(
    ending_days: Sequence[date],
    daily_returns: Sequence[Decimal],
    month_folds: Sequence[Sequence[str]],
) -> tuple[Decimal, ...]:
    """Compound aligned daily returns into predeclared calendar folds."""

    if len(ending_days) != len(daily_returns):
        raise VG15Error("daily date and return paths differ in length")
    output: list[Decimal] = []
    for fold in month_folds:
        members = [
            value
            for day, value in zip(ending_days, daily_returns, strict=True)
            if day.strftime("%Y-%m") in fold
        ]
        if not members:
            raise VG15Error(f"calendar fold has no observations: {fold}")
        output.append(compound_return(members))
    return tuple(output)


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
    """Estimate report-only PBO over eight aligned monthly slices.

    Every 4-of-8 training split is paired with its four-month complement.
    The in-sample winner's out-of-sample percentile among all twelve trials is
    converted to log odds; PBO is the share of non-positive log odds.
    """

    if not evaluations:
        raise VG15Error("PBO requires development evaluations")
    distinct_paths = len(
        {
            canonical_sha([decimal_text(value) for value in item.paths.base.daily_returns])
            for item in evaluations
        }
    )
    if distinct_paths < 2:
        return {
            "distinctTrialPathCount": distinct_paths,
            "method": "CSCV_8_MONTHS_CHOOSE_4_REPORT_ONLY",
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
            raise VG15Error(f"PBO month has no aligned observations: {month}")
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
                tuple(evaluation.paths.base.daily_returns[index] for index in indices)
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
        "method": "CSCV_8_MONTHS_CHOOSE_4_REPORT_ONLY",
        "pbo": decimal_text(Decimal(nonpositive) / Decimal(len(logits))),
        "splitCount": len(logits),
        "status": "MEASURED_REPORT_ONLY",
    }


def scenario_metrics(path: ScenarioPath) -> dict[str, object]:
    """Serialize core metrics for one cost scenario."""

    total_return = compound_return(path.daily_returns)
    return {
        "dailyObservationCount": len(path.daily_returns),
        "endingEquityUsdPer1000": decimal_text(STARTING_NOTIONAL_USD * (Decimal(1) + total_return)),
        "maxDrawdown": decimal_text(max_drawdown(path.daily_returns)),
        "meanDailyReturn": decimal_text(mean_decimal(path.daily_returns)),
        "meanUsdPerDayPer1000": decimal_text(
            STARTING_NOTIONAL_USD * mean_decimal(path.daily_returns)
        ),
        "offDayCount": path.off_days,
        "onDayCount": path.on_days,
        "totalReturn": decimal_text(total_return),
        "totalUsdPer1000": decimal_text(STARTING_NOTIONAL_USD * total_return),
        "transitionLegCount": path.transition_legs,
    }


def development_folds(path: ScenarioPath) -> tuple[Decimal, ...]:
    """Return the four predeclared two-month development fold returns."""

    folds = (
        ("2025-07", "2025-08"),
        ("2025-09", "2025-10"),
        ("2025-11", "2025-12"),
        ("2026-01", "2026-02"),
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
            tuple[Decimal, ...],
            Decimal,
            Decimal,
            Decimal,
            Decimal | None,
        ]
    ] = []
    for trial in trial_grid():
        paths = simulate_segment(bars, trial, DEVELOPMENT_START, DEVELOPMENT_END)
        bootstrap = circular_block_bootstrap(
            paths.base.daily_returns,
            seed=BOOTSTRAP_SEED,
        )
        folds = development_folds(paths.base)
        capacity = (
            min(paths.base.transition_capacity_proxy_usd)
            if paths.base.transition_capacity_proxy_usd
            else None
        )
        raw.append(
            (
                paths,
                bootstrap,
                folds,
                max_drawdown(paths.base.daily_returns),
                compound_return(paths.base.daily_returns),
                mean_decimal(paths.stress.daily_returns),
                capacity,
            )
        )
    reference_days = raw[0][0].base.ending_days
    if any(item[0].base.ending_days != reference_days for item in raw):
        raise VG15Error("development trial paths are not date-aligned")
    adjusted = holm_adjusted(
        {paths.trial.trial_id: bootstrap.one_sided_p_value for paths, bootstrap, *_rest in raw}
    )
    evaluations: list[DevelopmentEvaluation] = []
    for (
        paths,
        bootstrap,
        folds,
        drawdown,
        base_total,
        stress_mean,
        capacity,
    ) in raw:
        gates = {
            "baseOneSided95LcbPositive": bootstrap.one_sided_95_lcb > 0,
            "capacityProxyAtLeast1000Usd": (capacity is not None and capacity >= CAPACITY_GATE_USD),
            "holmAdjustedPBelow005": (adjusted[paths.trial.trial_id] < ONE_SIDED_ALPHA),
            "maxDrawdownAtMost10Pct": drawdown <= MAX_DRAWDOWN,
            "offDayCountAtLeast20": paths.base.off_days >= 20,
            "onDayCountAtLeast20": paths.base.on_days >= 20,
            "positiveTwoMonthFoldsAtLeast3Of4": sum(value > 0 for value in folds) >= 3,
            "stressMeanPositive": stress_mean > 0,
        }
        evaluations.append(
            DevelopmentEvaluation(
                paths=paths,
                bootstrap=bootstrap,
                fold_returns=folds,
                max_drawdown=drawdown,
                base_total_return=base_total,
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
                -item.bootstrap.one_sided_95_lcb,
                item.paths.base.transition_legs,
                -item.paths.trial.breadth_threshold,
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
            "meanDailyReturn": decimal_text(evaluation.bootstrap.mean),
            "method": "SEEDED_CIRCULAR_BLOCK_BOOTSTRAP",
            "oneSided95Lcb": decimal_text(evaluation.bootstrap.one_sided_95_lcb),
            "oneSided95LcbUsdPerDayPer1000": decimal_text(
                STARTING_NOTIONAL_USD * evaluation.bootstrap.one_sided_95_lcb
            ),
            "oneSidedPValue": decimal_text(evaluation.bootstrap.one_sided_p_value),
            "replicates": BOOTSTRAP_REPLICATES,
            "seed": BOOTSTRAP_SEED,
            "twoSided90Ucb": decimal_text(evaluation.bootstrap.two_sided_90_ucb),
        },
        "positiveTwoMonthFoldCount": sum(value > 0 for value in evaluation.fold_returns),
        "stress": scenario_metrics(evaluation.paths.stress),
        "trial": trial_mapping(evaluation.paths.trial),
        "twoMonthFoldReturns": [decimal_text(value) for value in evaluation.fold_returns],
    }


def validate_frozen_identity() -> tuple[dict[str, object], dict[str, object]]:
    """Authenticate every pre-run identity binding without opening ZIPs."""

    if not FREEZE_PATH.is_file() or not SOURCE_MANIFEST_PATH.is_file():
        raise VG15Error("freeze receipt and source manifest are required")
    freeze_receipt = load_json(FREEZE_PATH)
    source_manifest = load_json(SOURCE_MANIFEST_PATH)
    validate_protocol_contract(load_json(PROTOCOL_PATH))
    if freeze_receipt.get("schema") != "VG15PreOutcomeFreezeV1":
        raise VG15Error("freeze schema is invalid")
    if freeze_receipt.get("state") != "READY_FOR_SOLE_ARCHIVE_DECOMPRESSION_RUN":
        raise VG15Error("freeze state is invalid")
    if freeze_receipt.get("baseCommit") != BASE_COMMIT:
        raise VG15Error("freeze base commit mismatch")
    if source_manifest.get("schema") != "VG15FrozenBinancePublicSourceManifestV1":
        raise VG15Error("source manifest schema is invalid")
    if source_manifest.get("state") != "CHECKSUM_VERIFIED_COMPRESSED_BYTES_NOT_OPENED_BY_VG15":
        raise VG15Error("source manifest state is invalid")
    if freeze_receipt.get("evaluatorSha256") != sha256_path(Path(__file__)):
        raise VG15Error("evaluator changed after freeze")
    if freeze_receipt.get("sourceManifestSha256") != sha256_path(SOURCE_MANIFEST_PATH):
        raise VG15Error("source manifest changed after freeze")
    if freeze_receipt.get("trialGridSha256") != canonical_sha(
        [trial_mapping(trial) for trial in trial_grid()]
    ):
        raise VG15Error("trial grid changed after freeze")
    for field, digest in required_document_hashes().items():
        if freeze_receipt.get(field) != digest:
            raise VG15Error(f"{field} changed after freeze")
    if source_manifest.get("protocolSha256") != sha256_path(PROTOCOL_PATH):
        raise VG15Error("source manifest protocol binding mismatch")
    manifest_artifacts(source_manifest)
    return freeze_receipt, source_manifest


def consume_run_marker(freeze_receipt: Mapping[str, object]) -> str:
    """Consume the experiment's exclusive run before any ZIP is opened."""

    if RUN_MARKER_PATH.exists() or RESULT_PATH.exists():
        raise VG15Error("the sole experiment run was already consumed")
    if git_output("status", "--porcelain"):
        raise VG15Error("run requires a committed freeze packet and clean worktree")
    marker = {
        "archiveDecompressionRunOrdinal": 1,
        "consumedAtUtc": utc_now(),
        "evaluatorSha256": freeze_receipt.get("evaluatorSha256"),
        "freezeSha256": sha256_path(FREEZE_PATH),
        "gitHead": git_output("rev-parse", "HEAD"),
        "holdoutReuseMaximum": 1,
        "schema": "VG15ExclusiveRunMarkerV1",
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
        raise VG15Error("cannot seal candidate after holdout open")
    seal: dict[str, object] = {
        "baseCommit": BASE_COMMIT,
        "candidate": trial_mapping(champion.paths.trial),
        "createdAtUtc": utc_now(),
        "developmentRowsSha256": development_rows_sha256,
        "freezeSha256": sha256_path(FREEZE_PATH),
        "pboReportOnly": dict(pbo),
        "schema": "VG15CandidateSealV1",
        "selectionRule": (
            "HIGHEST_BASE_NET_ONE_SIDED_95_PERCENT_LCB_THEN_LOWER_TURNOVER_"
            "THEN_HIGHER_THRESHOLD_THEN_LONGER_LOOKBACK_THEN_TRIAL_ID"
        ),
        "sourceManifestSha256": sha256_path(SOURCE_MANIFEST_PATH),
        "state": "CHAMPION_SEALED_BEFORE_HOLDOUT_OPEN",
    }
    write_json_once(CANDIDATE_SEAL_PATH, seal)
    return seal


def open_holdout_once(candidate_seal: Mapping[str, object]) -> dict[str, object]:
    """Create the sole holdout-open receipt before parsing holdout ZIPs."""

    if not CANDIDATE_SEAL_PATH.is_file():
        raise VG15Error("holdout requires a candidate seal")
    if HOLDOUT_OPEN_PATH.exists():
        raise VG15Error("holdout was already opened")
    receipt = {
        "candidateSealSha256": sha256_path(CANDIDATE_SEAL_PATH),
        "firstEligibleEntryOpenUtc": "2026-03-02T00:00:00Z",
        "openedAtUtc": utc_now(),
        "reuseCount": 1,
        "schema": "VG15HoldoutOpenReceiptV1",
        "sealedTrialId": cast(Mapping[str, object], candidate_seal["candidate"])["trialId"],
        "sourceMonths": list(HOLDOUT_MONTHS),
        "state": "HOLDOUT_OPENED_ONCE",
    }
    write_json_once(HOLDOUT_OPEN_PATH, receipt)
    return receipt


def holdout_month_returns(path: ScenarioPath) -> tuple[Decimal, ...]:
    """Return the four sealed holdout calendar-month returns."""

    return fold_compound_returns(
        path.ending_days,
        path.daily_returns,
        tuple((month,) for month in HOLDOUT_MONTHS),
    )


def holdout_analysis(paths: TrialPaths) -> tuple[dict[str, object], dict[str, bool]]:
    """Measure the sealed champion once and apply the predeclared gates."""

    bootstrap = circular_block_bootstrap(
        paths.base.daily_returns,
        seed=BOOTSTRAP_SEED + 1,
    )
    month_returns = holdout_month_returns(paths.base)
    capacity = (
        min(paths.base.transition_capacity_proxy_usd)
        if paths.base.transition_capacity_proxy_usd
        else None
    )
    drawdown = max_drawdown(paths.base.daily_returns)
    gates = {
        "baseMeanPositive": bootstrap.mean > 0,
        "baseOneSided95LcbPositive": bootstrap.one_sided_95_lcb > 0,
        "capacityProxyAtLeast1000Usd": (capacity is not None and capacity >= CAPACITY_GATE_USD),
        "maxDrawdownAtMost10Pct": drawdown <= MAX_DRAWDOWN,
        "offDayCountAtLeast20": paths.base.off_days >= 20,
        "onDayCountAtLeast20": paths.base.on_days >= 20,
        "oneSidedPBelow005": bootstrap.one_sided_p_value < ONE_SIDED_ALPHA,
        "positiveMonthsAtLeast3Of4": sum(value > 0 for value in month_returns) >= 3,
        "stressMeanPositive": mean_decimal(paths.stress.daily_returns) > 0,
    }
    metrics: dict[str, object] = {
        "base": scenario_metrics(paths.base),
        "boundaryPurge": {
            "firstEligibleSignalDay": "2026-03-01",
            "firstEligibleTargetOpen": "2026-03-02",
            "forcedFinalLiquidationOpen": "2026-06-30",
            "june30SignalTraded": False,
            "march01OpenTraded": False,
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
            "meanDailyReturn": decimal_text(bootstrap.mean),
            "method": "SEEDED_CIRCULAR_BLOCK_BOOTSTRAP",
            "oneSided95Lcb": decimal_text(bootstrap.one_sided_95_lcb),
            "oneSided95LcbUsdPerDayPer1000": decimal_text(
                STARTING_NOTIONAL_USD * bootstrap.one_sided_95_lcb
            ),
            "oneSidedPValue": decimal_text(bootstrap.one_sided_p_value),
            "replicates": BOOTSTRAP_REPLICATES,
            "seed": BOOTSTRAP_SEED + 1,
            "twoSided90Ucb": decimal_text(bootstrap.two_sided_90_ucb),
        },
        "monthReturns": [decimal_text(value) for value in month_returns],
        "positiveMonthCount": sum(value > 0 for value in month_returns),
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
            "developmentFinalLiquidationOpen": "2026-02-28",
            "february28SignalTraded": False,
            "holdoutFirstEligibleSignalDay": "2026-03-01",
            "holdoutFirstEligibleTargetOpen": "2026-03-02",
            "holdoutFinalLiquidationOpen": "2026-06-30",
            "june30SignalTraded": False,
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
        "schema": "VG15TerminalProfitabilityVerdictV1",
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
        key=lambda item: (item.base_total_return, item.paths.trial.trial_id),
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
                    "forcedFinalLiquidationOpen": "2026-02-28",
                    "february28SignalTraded": False,
                    "march01OpenRead": False,
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
                "baseNetMeanDailyReturn": decimal_text(reporting.bootstrap.mean),
                "baseNetOneSided95LcbDailyReturn": decimal_text(
                    reporting.bootstrap.one_sided_95_lcb
                ),
                "baseNetTotalUsdPer1000": decimal_text(
                    STARTING_NOTIONAL_USD * reporting.base_total_return
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
                    "forcedFinalLiquidationOpen": "2026-02-28",
                    "february28SignalTraded": False,
                    "march01OpenRead": False,
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
                "baseNetMeanDailyReturn": inference["meanDailyReturn"],
                "baseNetOneSided95LcbDailyReturn": inference["oneSided95Lcb"],
                "baseNetTotalUsdPer1000": base_metrics["totalUsdPer1000"],
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
                "baseNetMeanDailyReturn": None,
                "baseNetOneSided95LcbDailyReturn": None,
                "baseNetTotalUsdPer1000": None,
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
            if isinstance(error, VG15Error)
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
            raise VG15Error(f"source ZIP drift: {zip_path.name}")
        if sha256_path(checksum_path) != artifact.get("checksumSha256"):
            raise VG15Error(f"source checksum drift: {checksum_path.name}")
        if zip_path.stat().st_size != int(str(artifact.get("zipBytes", "-1"))):
            raise VG15Error(f"source ZIP byte-length drift: {zip_path.name}")
        if checksum_path.stat().st_size != int(str(artifact.get("checksumBytes", "-1"))):
            raise VG15Error(f"source checksum byte-length drift: {checksum_path.name}")
        verify_checksum_text(
            checksum_path.read_bytes(),
            zip_path.name,
            str(artifact.get("zipSha256", "")),
        )


def verify_sha256s() -> None:
    """Authenticate exact packet inventory and content."""

    if not SHA256SUMS_PATH.is_file():
        raise VG15Error("SHA256SUMS is absent")
    expected: dict[str, str] = {}
    for line in SHA256SUMS_PATH.read_text(encoding="ascii").splitlines():
        parts = line.split("  ", 1)
        if len(parts) != 2 or re.fullmatch(r"[0-9a-f]{64}", parts[0]) is None:
            raise VG15Error("SHA256SUMS grammar is invalid")
        digest, name = parts
        if "/" in name or name in expected or name.startswith("."):
            raise VG15Error("SHA256SUMS name is invalid or duplicate")
        expected[name] = digest
    actual_names = {path.name for path in packet_files()}
    if set(expected) != actual_names:
        raise VG15Error("SHA256SUMS inventory differs from packet files")
    for path in packet_files():
        if sha256_path(path) != expected[path.name]:
            raise VG15Error(f"packet digest mismatch: {path.name}")


def verify_packet() -> None:
    """Verify the terminal packet without rerunning or decompressing sources."""

    freeze_receipt, source_manifest = validate_frozen_identity()
    verify_source_artifacts(source_manifest)
    if not RUN_MARKER_PATH.is_file() or not RESULT_PATH.is_file():
        raise VG15Error("terminal run marker and result are required")
    marker = load_json(RUN_MARKER_PATH)
    result = load_json(RESULT_PATH)
    freeze_head = str(freeze_receipt.get("gitHead", ""))
    marker_head = str(marker.get("gitHead", ""))
    current_head = git_output("rev-parse", "HEAD")
    if re.fullmatch(r"[0-9a-f]{40}", freeze_head) is None:
        raise VG15Error("freeze Git head is invalid")
    if re.fullmatch(r"[0-9a-f]{40}", marker_head) is None:
        raise VG15Error("run marker Git head is invalid")
    if not git_commit_is_ancestor(BASE_COMMIT, freeze_head):
        raise VG15Error("freeze Git head is outside canonical lineage")
    if not git_commit_is_ancestor(freeze_head, marker_head):
        raise VG15Error("run marker does not descend from the frozen protocol")
    if not git_commit_is_ancestor(marker_head, current_head):
        raise VG15Error("current candidate does not descend from the committed freeze")
    frozen_code_paths = {
        "quant/research/vg15/OFFICIAL_SOURCE_RESEARCH.md": SOURCE_RESEARCH_PATH,
        "quant/research/vg15/README.md": README_PATH,
        "quant/research/vg15/experiment.py": Path(__file__),
        "quant/research/vg15/protocol.v1.json": PROTOCOL_PATH,
        "quant/research/vg15/test_experiment.py": TEST_PATH,
    }
    for relative_path, current_path in frozen_code_paths.items():
        if git_blob_sha256(freeze_head, relative_path) != sha256_path(current_path):
            raise VG15Error(f"frozen Git blob mismatch: {relative_path}")
    committed_freeze_paths = {
        "quant/research/vg15/freeze.v1.json": FREEZE_PATH,
        "quant/research/vg15/source-manifest.v1.json": SOURCE_MANIFEST_PATH,
    }
    for relative_path, current_path in committed_freeze_paths.items():
        if git_blob_sha256(marker_head, relative_path) != sha256_path(current_path):
            raise VG15Error(f"committed freeze blob mismatch: {relative_path}")
    if marker.get("state") != "SOLE_ARCHIVE_DECOMPRESSION_RUN_CONSUMED":
        raise VG15Error("run marker state is invalid")
    if marker.get("archiveDecompressionRunOrdinal") != 1:
        raise VG15Error("run marker ordinal is invalid")
    if marker.get("evaluatorSha256") != freeze_receipt.get("evaluatorSha256"):
        raise VG15Error("run marker evaluator binding mismatch")
    if marker.get("freezeSha256") != sha256_path(FREEZE_PATH):
        raise VG15Error("run marker freeze binding mismatch")
    if marker.get("sourceManifestSha256") != sha256_path(SOURCE_MANIFEST_PATH):
        raise VG15Error("run marker source binding mismatch")
    if result.get("runMarkerSha256") != sha256_path(RUN_MARKER_PATH):
        raise VG15Error("result run marker binding mismatch")
    if result.get("freezeSha256") != sha256_path(FREEZE_PATH):
        raise VG15Error("result freeze binding mismatch")
    if result.get("protocolSha256") != sha256_path(PROTOCOL_PATH):
        raise VG15Error("result protocol binding mismatch")
    if result.get("sourceManifestSha256") != sha256_path(SOURCE_MANIFEST_PATH):
        raise VG15Error("result source binding mismatch")
    verdict = result.get("verdict")
    holdout = result.get("holdout")
    if result.get("schema") != "VG15TerminalProfitabilityVerdictV1":
        raise VG15Error("result schema is invalid")
    if result.get("capitalAuthority") != "NONE":
        raise VG15Error("result grants forbidden capital authority")
    side_effects = result.get("noSideEffects")
    if side_effects != {
        "hostMutation": False,
        "moneyMovement": False,
        "orderPlacement": False,
        "privateApiRead": False,
        "signedApiCall": False,
        "uiMutation": False,
    }:
        raise VG15Error("result side-effect boundary is invalid")
    if not isinstance(verdict, dict) or verdict.get("status") not in {
        "GO",
        "NO_GO",
        "UNMEASURED",
    }:
        raise VG15Error("result verdict is invalid")
    if not isinstance(holdout, dict):
        raise VG15Error("result holdout state is invalid")
    status = str(verdict["status"])
    holdout_state = holdout.get("state")
    if status == "GO":
        if holdout_state != "OPENED_ONCE_COMPLETE" or holdout.get("reuseCount") != 1:
            raise VG15Error("GO requires one complete holdout opening")
        metrics = holdout.get("metrics")
        if not isinstance(metrics, dict):
            raise VG15Error("GO holdout metrics are absent")
        gates = metrics.get("gates")
        if (
            not isinstance(gates, dict)
            or not gates
            or any(value is not True for value in gates.values())
        ):
            raise VG15Error("GO has a failed or invalid holdout gate")
    elif status == "NO_GO" and holdout_state == "OPENED_ONCE_COMPLETE":
        metrics = holdout.get("metrics")
        if not isinstance(metrics, dict):
            raise VG15Error("opened NO_GO holdout metrics are absent")
        gates = metrics.get("gates")
        if (
            not isinstance(gates, dict)
            or not gates
            or all(value is True for value in gates.values())
        ):
            raise VG15Error("opened NO_GO lacks a failed holdout gate")
    elif status == "NO_GO":
        development = result.get("development")
        if (
            holdout_state != "UNOPENED_UNTOUCHED"
            or holdout.get("reuseCount") != 0
            or not isinstance(development, dict)
            or development.get("state") != "COMPLETE_NO_GATE_PASSER"
        ):
            raise VG15Error("unopened NO_GO is inconsistent with development")
    else:
        net_edge = result.get("netEdge")
        if (
            status != "UNMEASURED"
            or holdout_state not in {"UNOPENED_UNTOUCHED", "OPENED_INCOMPLETE"}
            or holdout.get("metrics") is not None
            or not isinstance(net_edge, dict)
            or net_edge.get("scope") != "UNMEASURED"
        ):
            raise VG15Error("UNMEASURED result contains measured evidence")
    candidate_seal: dict[str, object] | None = None
    if CANDIDATE_SEAL_PATH.exists():
        candidate_seal = load_json(CANDIDATE_SEAL_PATH)
        if candidate_seal.get("schema") != "VG15CandidateSealV1":
            raise VG15Error("candidate seal schema is invalid")
        if candidate_seal.get("freezeSha256") != sha256_path(FREEZE_PATH):
            raise VG15Error("candidate seal freeze binding mismatch")
        if candidate_seal.get("sourceManifestSha256") != sha256_path(SOURCE_MANIFEST_PATH):
            raise VG15Error("candidate seal source binding mismatch")
    if HOLDOUT_OPEN_PATH.exists():
        if candidate_seal is None:
            raise VG15Error("holdout open exists without candidate seal")
        if holdout.get("state") not in {
            "OPENED_ONCE_COMPLETE",
            "OPENED_INCOMPLETE",
        }:
            raise VG15Error("result denies its holdout-open receipt")
        open_receipt = load_json(HOLDOUT_OPEN_PATH)
        if open_receipt.get("reuseCount") != 1:
            raise VG15Error("holdout reuse count is not exactly one")
        if open_receipt.get("candidateSealSha256") != sha256_path(CANDIDATE_SEAL_PATH):
            raise VG15Error("holdout receipt candidate binding mismatch")
        candidate = candidate_seal.get("candidate")
        if not isinstance(candidate, dict):
            raise VG15Error("candidate seal identity is invalid")
        if open_receipt.get("sealedTrialId") != candidate.get("trialId"):
            raise VG15Error("holdout receipt trial binding mismatch")
        if holdout.get("state") == "OPENED_ONCE_COMPLETE":
            development = result.get("development")
            if not isinstance(development, dict):
                raise VG15Error("complete holdout result lacks development evidence")
            candidate_rows = development.get("candidateRows")
            if not isinstance(candidate_rows, list):
                raise VG15Error("complete holdout result lacks candidate rows")
            if canonical_sha(candidate_rows) != candidate_seal.get("developmentRowsSha256"):
                raise VG15Error("result candidate rows differ from their seal")
            if development.get("championTrialId") != candidate.get("trialId"):
                raise VG15Error("result champion differs from its seal")
            if canonical_sha(development.get("pbo")) != canonical_sha(
                candidate_seal.get("pboReportOnly")
            ):
                raise VG15Error("result PBO differs from its candidate seal")
    else:
        if holdout.get("state") != "UNOPENED_UNTOUCHED":
            raise VG15Error("result claims an absent holdout was opened")
        if candidate_seal is not None and verdict.get("status") != "UNMEASURED":
            raise VG15Error("measured result has a stranded candidate seal")
        if candidate_seal is not None and holdout.get("candidateSealPresent") is not True:
            raise VG15Error("terminal result omits its stranded candidate seal")
    verify_sha256s()
    print(
        f"VERIFIED verdict={verdict['status']} "
        f"holdout={holdout['state']} "
        f"result={sha256_path(RESULT_PATH)}"
    )


def parse_args(arguments: Sequence[str]) -> argparse.Namespace:
    """Parse the four-command evaluator interface."""

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("freeze", "run", "verify", "hashes"))
    return parser.parse_args(arguments)


def main(arguments: Sequence[str] | None = None) -> int:
    """Dispatch one bounded evaluator command."""

    parsed = parse_args(sys.argv[1:] if arguments is None else arguments)
    try:
        if parsed.command == "freeze":
            freeze()
        elif parsed.command == "run":
            run_experiment()
        elif parsed.command == "verify":
            verify_packet()
        else:
            write_sha256s()
            print(f"HASHED files={len(packet_files())}")
    except (
        VG15Error,
        OSError,
        subprocess.CalledProcessError,
        zipfile.BadZipFile,
    ) as error:
        print(f"VG15_ERROR {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
