#!/usr/bin/env python3
"""Sealed Binance-public-only V-G24 volume lead-lag network experiment."""

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
import subprocess
import sys
import zipfile
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal, InvalidOperation, getcontext
from pathlib import Path
from typing import Any, cast

getcontext().prec = 50

D = Decimal
ZERO = D(0)
ONE = D(1)
HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[2]
BASE_COMMIT = "a169b123fb186d1943a75ad648552c4d95be1be1"

PROTOCOL_PATH = HERE / "protocol.v1.json"
SOURCE_RESEARCH_PATH = HERE / "OFFICIAL_SOURCE_RESEARCH.md"
DISTINCTNESS_PATH = HERE / "DISTINCTNESS.md"
README_PATH = HERE / "README.md"
OFFICIAL_SOURCES_PATH = HERE / "official_sources.v1.json"
TESTS_PATH = HERE / "test_experiment.py"
SOURCE_MANIFEST_PATH = HERE / "source-manifest.v1.json"
FREEZE_PATH = HERE / "freeze.v1.json"
RUN_MARKER_PATH = HERE / "run-marker.v1.json"
DEVELOPMENT_OPEN_PATH = HERE / "development-open.v1.json"
DEVELOPMENT_PATH = HERE / "development.v1.json"
SELECTION_PATH = HERE / "selection.v1.json"
HOLDOUT_OPEN_PATH = HERE / "holdout-open.v1.json"
RESULT_PATH = HERE / "result.v1.json"
TERMINAL_PATH = HERE / "terminal.v1.json"
SHA256SUMS_PATH = HERE / "SHA256SUMS"

STATIC_PATHS = (
    "quant/research/vg24/DISTINCTNESS.md",
    "quant/research/vg24/OFFICIAL_SOURCE_RESEARCH.md",
    "quant/research/vg24/README.md",
    "quant/research/vg24/__init__.py",
    "quant/research/vg24/experiment.py",
    "quant/research/vg24/official_sources.v1.json",
    "quant/research/vg24/protocol.v1.json",
    "quant/research/vg24/test_experiment.py",
)

SOURCE_ROOT = Path("/private/tmp/cosmos-s1f-weekly-momentum-cash-v1")
SOURCE_ACQUISITION = SOURCE_ROOT / "acquisition-manifest.v1.json"
SOURCE_DISCOVERY = SOURCE_ROOT / "discovery.v1.json"
ACQUISITION_SHA = "01f58272602e43bfb914b649adc00d8273b2d423492220a55f86443bb6441176"
DISCOVERY_SHA = "b4a8f7abd36df19eff0510dfcc3c61fd0df9fdcab5f4d248892ee10010fb21c3"

SOURCE_MONTHS = tuple(
    f"{year:04d}-{month:02d}"
    for year, first, last in ((2025, 1, 12), (2026, 1, 6))
    for month in range(first, last + 1)
)
DEVELOPMENT_MONTHS = tuple(month for month in SOURCE_MONTHS if month < "2026-03")
HOLDOUT_MONTHS = ("2026-03", "2026-04", "2026-05", "2026-06")
DEVELOPMENT_START = date(2025, 7, 1)
DEVELOPMENT_END = date(2026, 3, 1)
HOLDOUT_START = DEVELOPMENT_END
HOLDOUT_END = date(2026, 7, 1)

DAY_US = 86_400_000_000
ROBUST_LOOKBACK = 60
LIQUIDITY_LOOKBACK = 30
NETWORK_DAYS = 120
NETWORK_LAG = 2
COHORT_SIZE = 30
OUTGOING_EDGES = 3
SOURCE_THRESHOLD = D("2.0")
MAD_SCALE = D("1.4826")
ASYMMETRY_MINIMUM = D("0.05")
HALF_DIFFERENCE_MAXIMUM = D("0.50")
MINIMUM_FULL_PAIRS = 90
MINIMUM_HALF_PAIRS = 40
INITIAL_USD = D("1000")
PARTICIPATION_RATE = D("0.0001")
BOOTSTRAP_SEED = 2_026_072_924_24
BOOTSTRAP_REPLICATES = 4096
BOOTSTRAP_BLOCK_WEEKS = 4
ALPHA = 0.05

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

JsonObject = dict[str, Any]


class VG24Error(RuntimeError):
    """A frozen protocol, custody, or lifecycle invariant failed."""


class MeasurementError(RuntimeError):
    """The preregistered estimate cannot be measured."""


@dataclass(frozen=True, slots=True)
class Bar:
    symbol: str
    day: date
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    quote_volume: Decimal
    open_time_us: int
    close_time_us: int


@dataclass(frozen=True, slots=True)
class Trial:
    trial_id: str
    target_count: int
    hold_days: int


@dataclass(frozen=True, slots=True)
class Edge:
    source: str
    target: str
    forward: Decimal
    first_half: Decimal
    second_half: Decimal
    reverse: Decimal
    asymmetry: Decimal
    observations: int


@dataclass(frozen=True, slots=True)
class Signal:
    day: date
    causal_cohort: tuple[str, ...]
    residuals: Mapping[str, Decimal]
    downstream: tuple[str, ...]
    comparator: tuple[str, ...]
    active_sources: tuple[str, ...]
    retained_edges: tuple[Edge, ...]


@dataclass(frozen=True, slots=True)
class Simulation:
    trial: Trial
    signal_days: tuple[date, ...]
    weekly_returns: Mapping[str, tuple[Decimal, ...]]
    decomposition_weekly_returns: Mapping[str, tuple[Decimal, ...]]
    comparator_weekly_returns: Mapping[str, tuple[Decimal, ...]]
    mark_nav: Mapping[str, tuple[Decimal, ...]]
    normalized_two_way_turnover_usd: Mapping[str, Decimal]
    active_signal_days: tuple[date, ...]
    active_weeks: int
    cash_weeks: int
    round_trips: int
    distinct_targets: tuple[str, ...]
    capacities_usd: tuple[Decimal, ...]
    capacity_complete: bool
    asset_gross_profit_usd: Mapping[str, Decimal]
    event_gross_profit_usd: tuple[Decimal, ...]


COSTS: Mapping[str, tuple[Decimal, Decimal]] = {
    "gross": (D("0"), D("0")),
    "publicBase": (D("10"), D("10")),
    "publicStress": (D("10"), D("25")),
    "feeStress": (D("20"), D("25")),
}
DECOMPOSITION_COSTS: Mapping[str, tuple[Decimal, Decimal]] = {
    "adverseOnly10": (D("0"), D("10")),
    "adverseOnly25": (D("0"), D("25")),
}


def utc_now() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def canonical_bytes(value: object) -> bytes:
    return (
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n"
    ).encode("utf-8")


def canonical_sha(value: object) -> str:
    return hashlib.sha256(canonical_bytes(value)).hexdigest()


def safe_read(path: Path) -> bytes:
    if path.is_symlink():
        raise VG24Error(f"symlink refused: {path}")
    if not path.is_file():
        raise VG24Error(f"regular file required: {path}")
    return path.read_bytes()


def sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    if path.is_symlink() or not path.is_file():
        raise VG24Error(f"regular file required: {path}")
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def fsync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def write_once(path: Path, value: object) -> None:
    """Create one immutable seal with O_EXCL, file fsync, and parent fsync."""
    raw = canonical_bytes(value)
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "wb", closefd=True) as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
    except BaseException:
        raise
    fsync_directory(path.parent)


def load_json(path: Path) -> JsonObject:
    try:
        value = json.loads(safe_read(path))
    except json.JSONDecodeError as exc:
        raise VG24Error(f"invalid JSON: {path}") from exc
    if not isinstance(value, dict):
        raise VG24Error(f"JSON object required: {path}")
    return cast(JsonObject, value)


def git_output(*arguments: str) -> str:
    completed = subprocess.run(
        ("git", *arguments),
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return completed.stdout.strip()


def date_range(start: date, end_exclusive: date) -> tuple[date, ...]:
    return tuple(start + timedelta(days=index) for index in range((end_exclusive - start).days))


def prior_days(day: date, count: int) -> tuple[date, ...]:
    return tuple(day - timedelta(days=offset) for offset in range(count, 0, -1))


def scheduled_sundays(start: date, end_exclusive: date) -> tuple[date, ...]:
    first = start
    while first.weekday() != 6:
        first += timedelta(days=1)
    latest_exit_padding = 5
    return tuple(
        day
        for day in date_range(first, end_exclusive)
        if day.weekday() == 6 and day + timedelta(days=latest_exit_padding) < end_exclusive
    )


def trial_grid() -> tuple[Trial, ...]:
    return tuple(
        Trial(f"VG24-K{target_count:02d}-H{hold_days}", target_count, hold_days)
        for target_count in (3, 5, 8)
        for hold_days in (1, 3)
    )


def decimal_median(values: Sequence[Decimal]) -> Decimal:
    if not values:
        raise ValueError("median requires values")
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) / D(2)


def pearson(values_x: Sequence[Decimal], values_y: Sequence[Decimal]) -> Decimal | None:
    if len(values_x) != len(values_y) or len(values_x) < 2:
        return None
    mean_x = sum(values_x, ZERO) / D(len(values_x))
    mean_y = sum(values_y, ZERO) / D(len(values_y))
    centered_x = tuple(value - mean_x for value in values_x)
    centered_y = tuple(value - mean_y for value in values_y)
    variance_x = sum((value * value for value in centered_x), ZERO)
    variance_y = sum((value * value for value in centered_y), ZERO)
    if variance_x <= ZERO or variance_y <= ZERO:
        return None
    covariance = sum(
        (value_x * value_y for value_x, value_y in zip(centered_x, centered_y, strict=True)),
        ZERO,
    )
    return covariance / (variance_x * variance_y).sqrt()


def dynamic_cohort(panel: Mapping[str, Mapping[date, Bar]], day: date) -> tuple[str, ...]:
    days = prior_days(day, LIQUIDITY_LOOKBACK)
    ranked: list[tuple[Decimal, bytes, str]] = []
    for symbol, series in panel.items():
        volumes: list[Decimal] = []
        for history_day in days:
            bar = series.get(history_day)
            if bar is None or bar.quote_volume < ZERO:
                break
            volumes.append(bar.quote_volume)
        if len(volumes) == LIQUIDITY_LOOKBACK:
            ranked.append((decimal_median(volumes), symbol.encode("utf-8"), symbol))
    ranked.sort(key=lambda row: (-row[0], row[1]))
    if len(ranked) < COHORT_SIZE:
        return ()
    return tuple(row[2] for row in ranked[:COHORT_SIZE])


def raw_surprise(
    panel: Mapping[str, Mapping[date, Bar]],
    symbol: str,
    day: date,
) -> Decimal | None:
    series = panel.get(symbol)
    if series is None:
        return None
    current = series.get(day)
    if current is None or current.quote_volume < ZERO:
        return None
    history: list[Decimal] = []
    for history_day in prior_days(day, ROBUST_LOOKBACK):
        bar = series.get(history_day)
        if bar is None or bar.quote_volume < ZERO:
            return None
        history.append((ONE + bar.quote_volume).ln())
    center = decimal_median(history)
    mad = decimal_median(tuple(abs(value - center) for value in history))
    scale = MAD_SCALE * mad
    if scale <= ZERO:
        return None
    return ((ONE + current.quote_volume).ln() - center) / scale


class SignalCache:
    """Causal daily cohort and residual-surprise cache for one frozen panel."""

    def __init__(self, panel: Mapping[str, Mapping[date, Bar]]) -> None:
        self.panel = panel
        self._cohorts: dict[date, tuple[str, ...]] = {}
        self._residuals: dict[date, dict[str, Decimal]] = {}

    def cohort(self, day: date) -> tuple[str, ...]:
        if day not in self._cohorts:
            self._cohorts[day] = dynamic_cohort(self.panel, day)
        return self._cohorts[day]

    def residuals(self, day: date) -> Mapping[str, Decimal]:
        if day in self._residuals:
            return self._residuals[day]
        cohort = self.cohort(day)
        raw = {
            symbol: surprise
            for symbol in cohort
            if (surprise := raw_surprise(self.panel, symbol, day)) is not None
        }
        residuals: dict[str, Decimal] = {}
        if len(raw) == COHORT_SIZE:
            for symbol in cohort:
                peers = tuple(value for peer, value in raw.items() if peer != symbol)
                if len(peers) != COHORT_SIZE - 1:
                    continue
                residuals[symbol] = raw[symbol] - decimal_median(peers)
        self._residuals[day] = residuals
        return residuals


def fit_edge(
    residual_history: Mapping[date, Mapping[str, Decimal]],
    signal_day: date,
    source: str,
    target: str,
) -> Edge | None:
    """Fit i[t] -> j[t+2] using sources through d-3 and targets through d-1."""
    if source == target:
        return None
    source_days = prior_days(signal_day - timedelta(days=2), NETWORK_DAYS)
    rows: list[tuple[int, Decimal, Decimal, Decimal, Decimal]] = []
    for index, source_day in enumerate(source_days):
        target_day = source_day + timedelta(days=NETWORK_LAG)
        at_source = residual_history.get(source_day, {})
        at_target = residual_history.get(target_day, {})
        if (
            all(name in mapping for name, mapping in ((source, at_source), (target, at_source)))
            and source in at_target
            and target in at_target
        ):
            rows.append(
                (
                    index,
                    at_source[source],
                    at_target[target],
                    at_source[target],
                    at_target[source],
                )
            )
    first = tuple(row for row in rows if row[0] < NETWORK_DAYS // 2)
    second = tuple(row for row in rows if row[0] >= NETWORK_DAYS // 2)
    if (
        len(rows) < MINIMUM_FULL_PAIRS
        or len(first) < MINIMUM_HALF_PAIRS
        or len(second) < MINIMUM_HALF_PAIRS
    ):
        return None
    forward = pearson(tuple(row[1] for row in rows), tuple(row[2] for row in rows))
    first_forward = pearson(tuple(row[1] for row in first), tuple(row[2] for row in first))
    second_forward = pearson(tuple(row[1] for row in second), tuple(row[2] for row in second))
    reverse = pearson(tuple(row[3] for row in rows), tuple(row[4] for row in rows))
    if None in {forward, first_forward, second_forward, reverse}:
        return None
    forward_value = cast(Decimal, forward)
    first_value = cast(Decimal, first_forward)
    second_value = cast(Decimal, second_forward)
    reverse_value = cast(Decimal, reverse)
    asymmetry = forward_value - reverse_value
    if (
        min(forward_value, first_value, second_value) <= ZERO
        or abs(first_value - second_value) > HALF_DIFFERENCE_MAXIMUM
        or asymmetry < ASYMMETRY_MINIMUM
    ):
        return None
    return Edge(
        source,
        target,
        forward_value,
        first_value,
        second_value,
        reverse_value,
        asymmetry,
        len(rows),
    )


def build_signal(cache: SignalCache, signal_day: date) -> Signal:
    cohort = cache.cohort(signal_day)
    current = cache.residuals(signal_day)
    if len(cohort) != COHORT_SIZE or len(current) != COHORT_SIZE:
        return Signal(signal_day, cohort, current, (), (), (), ())
    residual_history = {
        history_day: cache.residuals(history_day)
        for history_day in date_range(
            signal_day - timedelta(days=NETWORK_DAYS + 2),
            signal_day,
        )
    }
    retained: list[Edge] = []
    by_source: dict[str, tuple[Edge, ...]] = {}
    for source in cohort:
        candidates = tuple(
            edge
            for target in cohort
            if target != source
            if (edge := fit_edge(residual_history, signal_day, source, target)) is not None
        )
        ordered = tuple(
            sorted(
                candidates,
                key=lambda edge: (
                    -edge.forward,
                    -edge.asymmetry,
                    edge.target.encode("utf-8"),
                ),
            )
        )
        if len(ordered) >= OUTGOING_EDGES:
            by_source[source] = ordered[:OUTGOING_EDGES]
            retained.extend(ordered[:OUTGOING_EDGES])
    active_sources = tuple(
        sorted(
            (
                source
                for source in cohort
                if current[source] >= SOURCE_THRESHOLD and source in by_source
            ),
            key=lambda symbol: symbol.encode("utf-8"),
        )
    )
    scores: dict[str, Decimal] = {}
    for source in active_sources:
        for edge in by_source[source]:
            if edge.target not in active_sources:
                scores[edge.target] = scores.get(edge.target, ZERO) + current[source] * edge.forward
    downstream = tuple(
        sorted(
            (symbol for symbol, score in scores.items() if score > ZERO),
            key=lambda symbol: (-scores[symbol], symbol.encode("utf-8")),
        )
    )
    target_pool = tuple(symbol for symbol in cohort if symbol not in active_sources)
    comparator = tuple(
        sorted(
            target_pool,
            key=lambda symbol: (-current[symbol], symbol.encode("utf-8")),
        )
    )
    return Signal(
        signal_day,
        cohort,
        current,
        downstream,
        comparator,
        active_sources,
        tuple(retained),
    )


def verify_sidecar(raw: bytes, archive_name: str, archive_sha: str) -> None:
    try:
        text = raw.decode("ascii").strip()
    except UnicodeDecodeError as exc:
        raise VG24Error(f"non-ASCII sidecar: {archive_name}") from exc
    fields = text.split()
    if len(fields) != 2:
        raise VG24Error(f"invalid sidecar grammar: {archive_name}")
    digest, filename = fields
    if digest.lower() != archive_sha or filename.lstrip("*") != archive_name:
        raise VG24Error(f"sidecar binding mismatch: {archive_name}")


def build_source_manifest(
    state_root: Path,
    acquisition: Mapping[str, Any],
    discovery: Mapping[str, Any],
) -> JsonObject:
    """Hash compressed objects and sidecars without constructing a ZipFile."""
    if acquisition.get("schema") != "S1FAcquisitionManifestV1":
        raise VG24Error("unexpected source acquisition schema")
    if acquisition.get("state") != "CHECKSUM_VERIFIED_ARCHIVES_NOT_DECOMPRESSED":
        raise VG24Error("source acquisition is not pre-decompression")
    universe_obj = cast(JsonObject, discovery.get("universe"))
    universe = tuple(cast(list[str], universe_obj.get("symbols")))
    if universe != tuple(sorted(universe)) or len(universe) != len(set(universe)):
        raise VG24Error("source universe is not sorted unique")
    allowed_symbols = set(universe)
    allowed_months = set(SOURCE_MONTHS)
    records: list[JsonObject] = []
    seen: set[tuple[str, str]] = set()
    month_counts = dict.fromkeys(SOURCE_MONTHS, 0)
    for source in cast(list[JsonObject], acquisition.get("artifactPairs")):
        symbol = cast(str, source.get("symbol"))
        month = cast(str, source.get("month"))
        if symbol not in allowed_symbols or month not in allowed_months:
            continue
        identity = (symbol, month)
        if identity in seen:
            raise VG24Error(f"duplicate source identity: {symbol} {month}")
        seen.add(identity)
        archive_name = f"{symbol}-1d-{month}.zip"
        pair_dir = state_root / "archives" / symbol / month
        zip_path = pair_dir / archive_name
        checksum_path = pair_dir / f"{archive_name}.CHECKSUM"
        pair_path = pair_dir / "pair.v1.json"
        zip_raw = safe_read(zip_path)
        checksum_raw = safe_read(checksum_path)
        pair_raw = safe_read(pair_path)
        zip_sha = hashlib.sha256(zip_raw).hexdigest()
        checksum_sha = hashlib.sha256(checksum_raw).hexdigest()
        pair_sha = hashlib.sha256(pair_raw).hexdigest()
        if zip_sha != source.get("zipSha256") or len(zip_raw) != source.get("zipBytes"):
            raise VG24Error(f"ZIP custody mismatch: {symbol} {month}")
        if checksum_sha != source.get("checksumSha256") or len(checksum_raw) != source.get(
            "checksumBytes"
        ):
            raise VG24Error(f"sidecar custody mismatch: {symbol} {month}")
        verify_sidecar(checksum_raw, archive_name, zip_sha)
        pair = json.loads(pair_raw)
        if (
            not isinstance(pair, dict)
            or pair.get("symbol") != symbol
            or pair.get("month") != month
            or pair.get("zipSha256") != zip_sha
            or pair.get("checksumSha256") != checksum_sha
        ):
            raise VG24Error(f"pair receipt mismatch: {symbol} {month}")
        records.append(
            {
                "checksumBytes": len(checksum_raw),
                "checksumFrozenEtag": source.get("checksumFrozenEtag"),
                "checksumFrozenLastModified": source.get("checksumFrozenLastModified"),
                "checksumPath": str(checksum_path.relative_to(state_root)),
                "checksumSha256": checksum_sha,
                "month": month,
                "pairBytes": len(pair_raw),
                "pairPath": str(pair_path.relative_to(state_root)),
                "pairSha256": pair_sha,
                "symbol": symbol,
                "zipBytes": len(zip_raw),
                "zipFrozenEtag": source.get("zipFrozenEtag"),
                "zipFrozenLastModified": source.get("zipFrozenLastModified"),
                "zipPath": str(zip_path.relative_to(state_root)),
                "zipSha256": zip_sha,
            }
        )
        month_counts[month] += 1
    if any(count < COHORT_SIZE for count in month_counts.values()):
        raise VG24Error("a required month has fewer than thirty source records")
    records.sort(key=lambda row: (cast(str, row["month"]), cast(str, row["symbol"]).encode()))
    exclusions = cast(JsonObject, discovery.get("exclusions"))
    return {
        "acquisitionManifestSha256": ACQUISITION_SHA,
        "authenticatedAtUtc": utc_now(),
        "discoverySha256": DISCOVERY_SHA,
        "excludedPairedLeveragedSymbols": exclusions.get("pairedLeveragedSymbols"),
        "excludedPairedLeveragedSymbolsSha256": exclusions.get("pairedLeveragedSha256"),
        "excludedStableOrFiatSymbols": exclusions.get("stableOrFiatSymbols"),
        "excludedStableOrFiatSymbolsSha256": exclusions.get("stableOrFiatSha256"),
        "interval": "1d",
        "monthRecordCounts": month_counts,
        "normalizedRecordSha256": canonical_sha(records),
        "openedByVg24BeforeFreeze": False,
        "programWideFreshHoldout": False,
        "recordCount": len(records),
        "records": records,
        "schema": "VG24SourceManifestV1",
        "sourceRoot": str(state_root.resolve()),
        "universeCount": len(universe),
        "universeSha256": universe_obj.get("sha256"),
        "universeSymbols": universe,
        "zipContainerConstructedDuringFreeze": False,
        "zipMemberAccessDuringFreeze": False,
    }


def freeze_command(state_root: Path) -> JsonObject:
    generated = (
        SOURCE_MANIFEST_PATH,
        FREEZE_PATH,
        RUN_MARKER_PATH,
        DEVELOPMENT_OPEN_PATH,
        DEVELOPMENT_PATH,
        SELECTION_PATH,
        HOLDOUT_OPEN_PATH,
        RESULT_PATH,
        TERMINAL_PATH,
    )
    if any(path.exists() for path in generated):
        raise VG24Error("freeze authority already consumed")
    if state_root.resolve() != SOURCE_ROOT.resolve():
        raise VG24Error("source root differs from frozen protocol")
    if git_output("status", "--porcelain=v1"):
        raise VG24Error("static tree must be clean before freeze")
    head = git_output("rev-parse", "HEAD")
    parent = git_output("show", "-s", "--format=%P", "HEAD")
    if parent != BASE_COMMIT:
        raise VG24Error("static commit is not the exact linear child of base")
    if git_output("rev-list", "--count", f"{BASE_COMMIT}..HEAD") != "1":
        raise VG24Error("static history is not exactly one commit")
    changed = tuple(
        sorted(
            filter(
                None,
                git_output("diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD").splitlines(),
            )
        )
    )
    if changed != STATIC_PATHS:
        raise VG24Error("static commit changed-path set mismatch")
    if sha256_path(SOURCE_ACQUISITION) != ACQUISITION_SHA:
        raise VG24Error("S-1F acquisition manifest digest mismatch")
    if sha256_path(SOURCE_DISCOVERY) != DISCOVERY_SHA:
        raise VG24Error("S-1F discovery digest mismatch")
    acquisition = load_json(SOURCE_ACQUISITION)
    discovery = load_json(SOURCE_DISCOVERY)
    manifest = build_source_manifest(state_root, acquisition, discovery)
    write_once(SOURCE_MANIFEST_PATH, manifest)
    static_files = {
        "distinctnessSha256": DISTINCTNESS_PATH,
        "evaluatorSha256": Path(__file__),
        "officialSourceResearchSha256": SOURCE_RESEARCH_PATH,
        "officialSourcesSha256": OFFICIAL_SOURCES_PATH,
        "protocolSha256": PROTOCOL_PATH,
        "readmeSha256": README_PATH,
        "testsSha256": TESTS_PATH,
    }
    freeze: JsonObject = {
        "baseCommit": BASE_COMMIT,
        "frozenAtUtc": utc_now(),
        "holdoutMaximumOpenCount": 1,
        "openedByVg24BeforeFreeze": False,
        "programWideFreshHoldout": False,
        "schema": "VG24FreezeV1",
        "sourceManifestSha256": sha256_path(SOURCE_MANIFEST_PATH),
        "sourceRoot": str(state_root.resolve()),
        "staticChangedPaths": list(changed),
        "staticCommit": head,
        "staticParentCommit": parent,
        "zipContainerConstructed": False,
        "zipMemberAccess": False,
    }
    for field, path in static_files.items():
        freeze[field] = sha256_path(path)
    write_once(FREEZE_PATH, freeze)
    return {
        "normalizedRecordSha256": manifest["normalizedRecordSha256"],
        "recordCount": manifest["recordCount"],
        "sourceManifestSha256": freeze["sourceManifestSha256"],
        "staticCommit": head,
    }


def verify_freeze(
    state_root: Path,
    *,
    require_freeze_head: bool = False,
) -> JsonObject:
    freeze = load_json(FREEZE_PATH)
    if freeze.get("schema") != "VG24FreezeV1":
        raise VG24Error("unexpected freeze schema")
    if freeze.get("baseCommit") != BASE_COMMIT:
        raise VG24Error("freeze base mismatch")
    if freeze.get("sourceRoot") != str(state_root.resolve()):
        raise VG24Error("freeze source root mismatch")
    if freeze.get("staticParentCommit") != BASE_COMMIT:
        raise VG24Error("freeze static parent mismatch")
    if tuple(freeze.get("staticChangedPaths", ())) != STATIC_PATHS:
        raise VG24Error("freeze static path binding mismatch")
    expected = {
        "distinctnessSha256": DISTINCTNESS_PATH,
        "evaluatorSha256": Path(__file__),
        "officialSourceResearchSha256": SOURCE_RESEARCH_PATH,
        "officialSourcesSha256": OFFICIAL_SOURCES_PATH,
        "protocolSha256": PROTOCOL_PATH,
        "readmeSha256": README_PATH,
        "sourceManifestSha256": SOURCE_MANIFEST_PATH,
        "testsSha256": TESTS_PATH,
    }
    for field, path in expected.items():
        if freeze.get(field) != sha256_path(path):
            raise VG24Error(f"freeze digest mismatch: {field}")
    if freeze.get("holdoutMaximumOpenCount") != 1:
        raise VG24Error("freeze holdout authority mismatch")
    freeze_commit = git_output(
        "log",
        "-1",
        "--format=%H",
        "--",
        "quant/research/vg24/freeze.v1.json",
    )
    if not freeze_commit:
        raise VG24Error("freeze receipt is not committed")
    freeze_parent = git_output("show", "-s", "--format=%P", freeze_commit)
    if freeze_parent != freeze.get("staticCommit"):
        raise VG24Error("freeze commit is not the exact child of static commit")
    freeze_paths = tuple(
        sorted(
            filter(
                None,
                git_output(
                    "diff-tree",
                    "--no-commit-id",
                    "--name-only",
                    "-r",
                    freeze_commit,
                ).splitlines(),
            )
        )
    )
    if freeze_paths != (
        "quant/research/vg24/freeze.v1.json",
        "quant/research/vg24/source-manifest.v1.json",
    ):
        raise VG24Error("freeze commit changed-path set mismatch")
    if require_freeze_head:
        if git_output("rev-parse", "HEAD") != freeze_commit:
            raise VG24Error("first member access requires exact freeze-commit HEAD")
        if git_output("status", "--porcelain=v1"):
            raise VG24Error("first member access requires a clean freeze tree")
    return freeze


def manifest_records(
    months: set[str],
    symbols: set[str] | None = None,
) -> tuple[JsonObject, ...]:
    manifest = load_json(SOURCE_MANIFEST_PATH)
    if manifest.get("schema") != "VG24SourceManifestV1":
        raise VG24Error("unexpected source manifest schema")
    if manifest.get("openedByVg24BeforeFreeze") is not False:
        raise VG24Error("manifest does not prove lane-local pre-member freeze")
    records = cast(list[JsonObject], manifest.get("records"))
    return tuple(
        record
        for record in records
        if record.get("month") in months and (symbols is None or record.get("symbol") in symbols)
    )


def revalidate_record(record: Mapping[str, Any], state_root: Path) -> tuple[bytes, bytes]:
    symbol = cast(str, record.get("symbol"))
    month = cast(str, record.get("month"))
    zip_path = state_root / cast(str, record.get("zipPath"))
    checksum_path = state_root / cast(str, record.get("checksumPath"))
    pair_path = state_root / cast(str, record.get("pairPath"))
    zip_raw = safe_read(zip_path)
    checksum_raw = safe_read(checksum_path)
    pair_raw = safe_read(pair_path)
    if len(zip_raw) != record.get("zipBytes") or hashlib.sha256(zip_raw).hexdigest() != record.get(
        "zipSha256"
    ):
        raise MeasurementError(f"ZIP revision changed: {symbol} {month}")
    if len(checksum_raw) != record.get("checksumBytes") or hashlib.sha256(
        checksum_raw
    ).hexdigest() != record.get("checksumSha256"):
        raise MeasurementError(f"sidecar revision changed: {symbol} {month}")
    if len(pair_raw) != record.get("pairBytes") or hashlib.sha256(
        pair_raw
    ).hexdigest() != record.get("pairSha256"):
        raise MeasurementError(f"pair receipt changed: {symbol} {month}")
    verify_sidecar(checksum_raw, zip_path.name, cast(str, record.get("zipSha256")))
    return zip_raw, checksum_raw


def parse_archive(record: JsonObject, state_root: Path) -> tuple[Bar, ...]:
    """Revalidate compressed custody immediately before the only member access."""
    symbol = cast(str, record.get("symbol"))
    month = cast(str, record.get("month"))
    zip_raw, _ = revalidate_record(record, state_root)
    expected_member = f"{symbol}-1d-{month}.csv"
    try:
        with zipfile.ZipFile(io.BytesIO(zip_raw), "r") as archive:
            members = tuple(member for member in archive.infolist() if not member.is_dir())
            if (
                len(members) != 1
                or members[0].filename != expected_member
                or members[0].filename.startswith(("/", "\\"))
                or ".." in Path(members[0].filename).parts
            ):
                raise MeasurementError(f"unexpected ZIP member: {symbol} {month}")
            raw_csv = archive.read(members[0])
    except zipfile.BadZipFile as exc:
        raise MeasurementError(f"invalid ZIP: {symbol} {month}") from exc
    try:
        rows = list(csv.reader(io.StringIO(raw_csv.decode("utf-8"))))
    except UnicodeDecodeError as exc:
        raise MeasurementError(f"non-UTF8 CSV: {symbol} {month}") from exc
    if rows and tuple(rows[0]) == KLINE_HEADER:
        rows = rows[1:]
    if not rows:
        raise MeasurementError(f"empty archive: {symbol} {month}")
    parsed: list[Bar] = []
    previous_open: int | None = None
    for index, row in enumerate(rows):
        if len(row) != 12:
            raise MeasurementError(f"wrong field count: {symbol} {month}")
        try:
            open_us = int(row[0])
            close_us = int(row[6])
            open_price = D(row[1])
            high = D(row[2])
            low = D(row[3])
            close = D(row[4])
            quote_volume = D(row[7])
        except (ValueError, InvalidOperation) as exc:
            raise MeasurementError(f"invalid scalar: {symbol} {month}") from exc
        if open_us < 1_000_000_000_000_000 or close_us < 1_000_000_000_000_000:
            raise MeasurementError(f"millisecond timestamp rejected: {symbol} {month}")
        if open_us % DAY_US:
            raise MeasurementError(f"non-UTC daily open: {symbol} {month}")
        bar_day = date(1970, 1, 1) + timedelta(days=open_us // DAY_US)
        if bar_day.strftime("%Y-%m") != month:
            raise MeasurementError(f"row outside archive month: {symbol} {month}")
        if close_us < open_us:
            raise MeasurementError(f"close precedes open: {symbol} {month}")
        if previous_open is not None and open_us <= previous_open:
            raise MeasurementError(f"duplicate or unsorted day: {symbol} {month}")
        previous_open = open_us
        scalars = (open_price, high, low, close, quote_volume)
        if (
            not all(value.is_finite() for value in scalars)
            or min(open_price, high, low, close) <= ZERO
            or quote_volume < ZERO
            or high < max(open_price, close)
            or low > min(open_price, close)
        ):
            raise MeasurementError(f"invalid OHLCV: {symbol} {month}")
        expected_close = open_us + DAY_US - 1
        if close_us != expected_close:
            if index == len(rows) - 1 and close_us < expected_close:
                continue
            raise MeasurementError(f"invalid daily close boundary: {symbol} {month}")
        parsed.append(
            Bar(
                symbol,
                bar_day,
                open_price,
                high,
                low,
                close,
                quote_volume,
                open_us,
                close_us,
            )
        )
    return tuple(parsed)


def load_panel(records: Sequence[JsonObject], state_root: Path) -> dict[str, dict[date, Bar]]:
    panel: dict[str, dict[date, Bar]] = {}
    for record in records:
        symbol = cast(str, record.get("symbol"))
        series = panel.setdefault(symbol, {})
        for bar in parse_archive(record, state_root):
            if bar.day in series:
                raise MeasurementError(f"duplicate full bar across archives: {symbol} {bar.day}")
            series[bar.day] = bar
    return panel


def merge_panel(
    base: dict[str, dict[date, Bar]],
    extension: Mapping[str, Mapping[date, Bar]],
) -> None:
    for symbol, incoming in extension.items():
        series = base.setdefault(symbol, {})
        overlap = set(series).intersection(incoming)
        if overlap:
            raise MeasurementError(f"partition overlap: {symbol} {min(overlap)}")
        series.update(incoming)


def round_trip_return(
    entry: Decimal,
    exit_price: Decimal,
    *,
    fee_bps: Decimal,
    adverse_bps: Decimal,
) -> Decimal:
    if entry <= ZERO or exit_price <= ZERO:
        raise MeasurementError("nonpositive payoff price")
    fee = fee_bps / D(10_000)
    adverse = adverse_bps / D(10_000)
    received_base = (ONE - fee) / (entry * (ONE + adverse))
    proceeds = received_base * exit_price * (ONE - adverse) * (ONE - fee)
    return proceeds - ONE


def capacity_proxy(
    panel: Mapping[str, Mapping[date, Bar]],
    targets: Sequence[str],
    entry_day: date,
    exit_day: date,
) -> Decimal | None:
    """Take the conservative min of entry/exit 1 bp bases, each prior-only."""
    capacities: list[Decimal] = []
    for fill_day in (entry_day, exit_day):
        history_days = prior_days(fill_day, LIQUIDITY_LOOKBACK)
        for symbol in targets:
            series = panel.get(symbol, {})
            volumes: list[Decimal] = []
            for history_day in history_days:
                bar = series.get(history_day)
                if bar is None or bar.quote_volume < ZERO:
                    return None
                volumes.append(bar.quote_volume)
            capacities.append(decimal_median(volumes) * PARTICIPATION_RATE)
    if not capacities:
        return None
    return D(len(targets)) * min(capacities)


def _complete_preentry(
    panel: Mapping[str, Mapping[date, Bar]],
    targets: Sequence[str],
    signal_day: date,
) -> bool:
    monday = signal_day + timedelta(days=1)
    entry = signal_day + timedelta(days=2)
    return all(
        panel.get(symbol, {}).get(monday) is not None
        and panel.get(symbol, {}).get(entry) is not None
        for symbol in targets
    )


def _prices_for_hold(
    panel: Mapping[str, Mapping[date, Bar]],
    targets: Sequence[str],
    entry_day: date,
    exit_day: date,
) -> tuple[Mapping[str, Decimal], Mapping[date, Mapping[str, Decimal]], Mapping[str, Decimal]]:
    entries: dict[str, Decimal] = {}
    closes: dict[date, dict[str, Decimal]] = {}
    exits: dict[str, Decimal] = {}
    for symbol in targets:
        series = panel.get(symbol, {})
        entry_bar = series.get(entry_day)
        if entry_bar is None:
            raise MeasurementError(f"successful cohort lost entry bar: {symbol} {entry_day}")
        entries[symbol] = entry_bar.open
        for mark_day in date_range(entry_day, exit_day):
            mark = series.get(mark_day)
            if mark is None:
                raise MeasurementError(f"missing post-entry mark: {symbol} {mark_day}")
            closes.setdefault(mark_day, {})[symbol] = mark.close
        exit_bar = series.get(exit_day)
        if exit_bar is None:
            raise MeasurementError(f"missing scheduled post-entry exit: {symbol} {exit_day}")
        exits[symbol] = exit_bar.open
    return entries, closes, exits


def _cohort_return(
    entries: Mapping[str, Decimal],
    exits: Mapping[str, Decimal],
    targets: Sequence[str],
    *,
    fee_bps: Decimal,
    adverse_bps: Decimal,
) -> Decimal:
    return sum(
        (
            round_trip_return(
                entries[symbol],
                exits[symbol],
                fee_bps=fee_bps,
                adverse_bps=adverse_bps,
            )
            for symbol in targets
        ),
        ZERO,
    ) / D(len(targets))


def simulate_trial(
    panel: Mapping[str, Mapping[date, Bar]],
    signals: Mapping[date, Signal],
    signal_days: Sequence[date],
    trial: Trial,
) -> Simulation:
    weekly: dict[str, list[Decimal]] = {name: [] for name in COSTS}
    decomposition_weekly: dict[str, list[Decimal]] = {name: [] for name in DECOMPOSITION_COSTS}
    comparator_weekly: dict[str, list[Decimal]] = {name: [] for name in COSTS}
    nav = dict.fromkeys(COSTS, INITIAL_USD)
    comparator_nav = dict.fromkeys(COSTS, INITIAL_USD)
    mark_nav: dict[str, list[Decimal]] = {name: [INITIAL_USD] for name in COSTS}
    normalized_turnover = dict.fromkeys(COSTS, ZERO)
    targets_seen: set[str] = set()
    capacities: list[Decimal] = []
    capacity_complete = True
    asset_profit: dict[str, Decimal] = {}
    event_profit: list[Decimal] = []
    active_signal_days: list[date] = []
    active_weeks = 0
    cash_weeks = 0
    round_trips = 0

    for signal_day in signal_days:
        signal = signals[signal_day]
        if len(signal.downstream) < trial.target_count:
            for name in COSTS:
                weekly[name].append(ZERO)
                comparator_weekly[name].append(ZERO)
                mark_nav[name].append(nav[name])
            for name in DECOMPOSITION_COSTS:
                decomposition_weekly[name].append(ZERO)
            cash_weeks += 1
            continue
        targets = signal.downstream[: trial.target_count]
        comparator = signal.comparator[: trial.target_count]
        if len(comparator) != trial.target_count:
            raise MeasurementError("matched comparator cannot form exact K")
        if not _complete_preentry(panel, targets, signal_day):
            for name in COSTS:
                weekly[name].append(ZERO)
                comparator_weekly[name].append(ZERO)
                mark_nav[name].append(nav[name])
            for name in DECOMPOSITION_COSTS:
                decomposition_weekly[name].append(ZERO)
            cash_weeks += 1
            continue
        if not _complete_preentry(panel, comparator, signal_day):
            raise MeasurementError("matched comparator missing pre-entry on active network week")
        entry_day = signal_day + timedelta(days=2)
        exit_day = entry_day + timedelta(days=trial.hold_days)
        target_entries, target_closes, target_exits = _prices_for_hold(
            panel,
            targets,
            entry_day,
            exit_day,
        )
        comparator_entries, _, comparator_exits = _prices_for_hold(
            panel,
            comparator,
            entry_day,
            exit_day,
        )
        capacity = capacity_proxy(panel, targets, entry_day, exit_day)
        if capacity is None:
            capacity_complete = False
        else:
            capacities.append(capacity)
        active_weeks += 1
        active_signal_days.append(signal_day)
        round_trips += trial.target_count
        targets_seen.update(targets)
        gross_start_nav = nav["gross"]
        gross_event_profit = ZERO
        for symbol in targets:
            symbol_return = round_trip_return(
                target_entries[symbol],
                target_exits[symbol],
                fee_bps=ZERO,
                adverse_bps=ZERO,
            )
            profit = gross_start_nav * symbol_return / D(trial.target_count)
            asset_profit[symbol] = asset_profit.get(symbol, ZERO) + profit
            gross_event_profit += profit
        event_profit.append(gross_event_profit)
        for name, (fee_bps, adverse_bps) in DECOMPOSITION_COSTS.items():
            decomposition_weekly[name].append(
                _cohort_return(
                    target_entries,
                    target_exits,
                    targets,
                    fee_bps=fee_bps,
                    adverse_bps=adverse_bps,
                )
            )

        for name, (fee_bps, adverse_bps) in COSTS.items():
            network_return = _cohort_return(
                target_entries,
                target_exits,
                targets,
                fee_bps=fee_bps,
                adverse_bps=adverse_bps,
            )
            matched_return = _cohort_return(
                comparator_entries,
                comparator_exits,
                comparator,
                fee_bps=fee_bps,
                adverse_bps=adverse_bps,
            )
            weekly[name].append(network_return)
            comparator_weekly[name].append(matched_return)
            start_nav = nav[name]
            normalized_turnover[name] += D(2) * start_nav
            for mark_day in date_range(entry_day, exit_day):
                mark_return = sum(
                    (
                        round_trip_return(
                            target_entries[symbol],
                            target_closes[mark_day][symbol],
                            fee_bps=fee_bps,
                            adverse_bps=adverse_bps,
                        )
                        for symbol in targets
                    ),
                    ZERO,
                ) / D(trial.target_count)
                mark_nav[name].append(start_nav * (ONE + mark_return))
            nav[name] = start_nav * (ONE + network_return)
            comparator_nav[name] *= ONE + matched_return
            mark_nav[name].append(nav[name])

    expected = len(signal_days)
    if any(len(values) != expected for values in weekly.values()):
        raise MeasurementError("network weekly calendar is not synchronous")
    if any(len(values) != expected for values in decomposition_weekly.values()):
        raise MeasurementError("cost decomposition calendar is not synchronous")
    if any(len(values) != expected for values in comparator_weekly.values()):
        raise MeasurementError("comparator weekly calendar is not synchronous")
    return Simulation(
        trial,
        tuple(signal_days),
        {name: tuple(values) for name, values in weekly.items()},
        {name: tuple(values) for name, values in decomposition_weekly.items()},
        {name: tuple(values) for name, values in comparator_weekly.items()},
        {name: tuple(values) for name, values in mark_nav.items()},
        normalized_turnover,
        tuple(active_signal_days),
        active_weeks,
        cash_weeks,
        round_trips,
        tuple(sorted(targets_seen, key=lambda symbol: symbol.encode("utf-8"))),
        tuple(capacities),
        capacity_complete,
        asset_profit,
        tuple(event_profit),
    )


def compound_net(returns: Sequence[Decimal]) -> Decimal:
    nav = INITIAL_USD
    for value in returns:
        if value <= -ONE:
            raise MeasurementError("return at or below total loss")
        nav *= ONE + value
    return nav - INITIAL_USD


def matched_excess_log_returns(simulation: Simulation) -> tuple[Decimal, ...]:
    network = simulation.weekly_returns["publicStress"]
    comparator = simulation.comparator_weekly_returns["publicStress"]
    values: list[Decimal] = []
    for own, matched in zip(network, comparator, strict=True):
        if own <= -ONE or matched <= -ONE:
            raise MeasurementError("log excess undefined")
        values.append((ONE + own).ln() - (ONE + matched).ln())
    return tuple(values)


def cash_log_returns(simulation: Simulation) -> tuple[Decimal, ...]:
    values: list[Decimal] = []
    for weekly_return in simulation.weekly_returns["publicStress"]:
        if weekly_return <= -ONE:
            raise MeasurementError("cash-comparison log return undefined")
        values.append((ONE + weekly_return).ln())
    return tuple(values)


def max_drawdown(nav: Sequence[Decimal]) -> Decimal:
    if not nav:
        return ZERO
    peak = nav[0]
    maximum = ZERO
    for value in nav:
        peak = max(peak, value)
        if peak > ZERO:
            maximum = max(maximum, (peak - value) / peak)
    return maximum


def circular_indices(count: int, block: int, rng: random.Random) -> tuple[int, ...]:
    if count <= 0 or block <= 0:
        raise ValueError("positive count and block required")
    indices: list[int] = []
    while len(indices) < count:
        start = rng.randrange(count)
        indices.extend((start + offset) % count for offset in range(block))
    return tuple(indices[:count])


def bootstrap_terminal_interval(
    returns: Sequence[Decimal],
    *,
    seed: int,
) -> tuple[Decimal, Decimal]:
    if not returns:
        raise MeasurementError("bootstrap requires full cash-day calendar")
    rng = random.Random(seed)
    samples: list[Decimal] = []
    for _ in range(BOOTSTRAP_REPLICATES):
        indices = circular_indices(len(returns), BOOTSTRAP_BLOCK_WEEKS, rng)
        samples.append(compound_net(tuple(returns[index] for index in indices)))
    samples.sort()
    lower = samples[math.floor(D("0.05") * D(len(samples) - 1))]
    upper = samples[math.floor(D("0.95") * D(len(samples) - 1))]
    return lower, upper


def bootstrap_matched_excess_interval(
    network_returns: Sequence[Decimal],
    comparator_returns: Sequence[Decimal],
    *,
    seed: int,
) -> tuple[Decimal, Decimal]:
    if not network_returns or len(network_returns) != len(comparator_returns):
        raise MeasurementError("matched bootstrap requires synchronous calendars")
    rng = random.Random(seed)
    samples: list[Decimal] = []
    for _ in range(BOOTSTRAP_REPLICATES):
        indices = circular_indices(
            len(network_returns),
            BOOTSTRAP_BLOCK_WEEKS,
            rng,
        )
        network_net = compound_net(tuple(network_returns[index] for index in indices))
        comparator_net = compound_net(tuple(comparator_returns[index] for index in indices))
        samples.append(network_net - comparator_net)
    samples.sort()
    lower = samples[math.floor(D("0.05") * D(len(samples) - 1))]
    upper = samples[math.floor(D("0.95") * D(len(samples) - 1))]
    return lower, upper


def bootstrap_one_sided_pvalue(
    values: Sequence[Decimal],
    *,
    seed: int,
) -> float:
    if not values:
        return 1.0
    observed = sum(values, ZERO) / D(len(values))
    centered = tuple(value - observed for value in values)
    rng = random.Random(seed)
    exceed = 0
    for _ in range(BOOTSTRAP_REPLICATES):
        indices = circular_indices(len(values), BOOTSTRAP_BLOCK_WEEKS, rng)
        sampled = sum((centered[index] for index in indices), ZERO) / D(len(values))
        if sampled >= observed:
            exceed += 1
    return (exceed + 1) / (BOOTSTRAP_REPLICATES + 1)


def holm_adjusted(raw: Mapping[str, float]) -> dict[str, float]:
    ordered = sorted(raw.items(), key=lambda item: (item[1], item[0]))
    adjusted: dict[str, float] = {}
    running = 0.0
    total = len(ordered)
    for index, (trial_id, pvalue) in enumerate(ordered):
        running = max(running, min(1.0, pvalue * (total - index)))
        adjusted[trial_id] = running
    return adjusted


def white_reality_check(matrix: Mapping[str, Sequence[Decimal]]) -> JsonObject:
    if set(matrix) != {trial.trial_id for trial in trial_grid()}:
        raise MeasurementError("White family differs from all six trials")
    lengths = {len(values) for values in matrix.values()}
    if len(lengths) != 1 or not lengths or next(iter(lengths)) == 0:
        raise MeasurementError("White matrix calendar mismatch")
    count = next(iter(lengths))
    means = {trial_id: sum(values, ZERO) / D(count) for trial_id, values in matrix.items()}
    observed = max(means.values())
    centered = {
        trial_id: tuple(value - means[trial_id] for value in values)
        for trial_id, values in matrix.items()
    }
    rng = random.Random(BOOTSTRAP_SEED + 900)
    exceed = 0
    for _ in range(BOOTSTRAP_REPLICATES):
        indices = circular_indices(count, BOOTSTRAP_BLOCK_WEEKS, rng)
        boot_max = max(
            sum((values[index] for index in indices), ZERO) / D(count)
            for values in centered.values()
        )
        if boot_max >= observed:
            exceed += 1
    return {
        "blockLengthDays": BOOTSTRAP_BLOCK_WEEKS * 7,
        "familySize": len(matrix),
        "pValue": f"{(exceed + 1) / (BOOTSTRAP_REPLICATES + 1):.10f}",
        "replicates": BOOTSTRAP_REPLICATES,
    }


def pbo_report(
    matrix: Mapping[str, Sequence[Decimal]],
    days: Sequence[date],
) -> JsonObject:
    expected_months = (
        *(f"2025-{month:02d}" for month in range(7, 13)),
        "2026-01",
        "2026-02",
    )
    if len(days) == 0 or any(len(values) != len(days) for values in matrix.values()):
        raise MeasurementError("PBO matrix calendar mismatch")
    month_indices = {
        month: tuple(index for index, day in enumerate(days) if day.strftime("%Y-%m") == month)
        for month in expected_months
    }
    if any(not indices for indices in month_indices.values()):
        raise MeasurementError("PBO eight calendar-month blocks incomplete")
    failures = 0
    splits = 0
    trial_ids = tuple(sorted(matrix))
    for in_sample_months in itertools.combinations(expected_months, 4):
        in_sample = tuple(index for month in in_sample_months for index in month_indices[month])
        out_sample = tuple(
            index
            for month in expected_months
            if month not in in_sample_months
            for index in month_indices[month]
        )
        scores_in = {
            trial_id: sum((matrix[trial_id][index] for index in in_sample), ZERO)
            for trial_id in trial_ids
        }
        selected = max(trial_ids, key=lambda trial_id: (scores_in[trial_id], trial_id))
        scores_out = {
            trial_id: sum((matrix[trial_id][index] for index in out_sample), ZERO)
            for trial_id in trial_ids
        }
        median_out = decimal_median(tuple(scores_out.values()))
        failures += int(scores_out[selected] <= median_out)
        splits += 1
    if splits != 70:
        raise MeasurementError("PBO split count is not seventy")
    return {
        "blockCount": 8,
        "diagnosticOnly": True,
        "pbo": f"{D(failures) / D(splits):.10f}",
        "splitCount": splits,
    }


def concentration_report(simulation: Simulation) -> JsonObject:
    positive_assets = tuple(
        max(value, ZERO) for value in simulation.asset_gross_profit_usd.values()
    )
    total_asset_profit = sum(positive_assets, ZERO)
    top_asset_share = (
        max(positive_assets) / total_asset_profit
        if positive_assets and total_asset_profit > ZERO
        else None
    )
    positive_events = sorted(
        (max(value, ZERO) for value in simulation.event_gross_profit_usd),
        reverse=True,
    )
    total_event_profit = sum(positive_events, ZERO)
    top_five_share = (
        sum(positive_events[:5], ZERO) / total_event_profit
        if positive_events and total_event_profit > ZERO
        else None
    )
    return {
        "topAssetGrossProfitShare": None if top_asset_share is None else str(top_asset_share),
        "topFiveEventGrossProfitShare": (None if top_five_share is None else str(top_five_share)),
    }


def simulation_summary(
    simulation: Simulation,
    *,
    interval_seed: int,
    holm_cash_pvalue: float | None,
    holm_comparator_pvalue: float | None,
    white_cash_pvalue: float | None,
    white_comparator_pvalue: float | None,
    development: bool,
) -> JsonObject:
    nets = {name: compound_net(simulation.weekly_returns[name]) for name in COSTS}
    decomposition_nets = {
        name: compound_net(simulation.decomposition_weekly_returns[name])
        for name in DECOMPOSITION_COSTS
    }
    comparator_nets = {
        name: compound_net(simulation.comparator_weekly_returns[name]) for name in COSTS
    }
    stress_interval = bootstrap_terminal_interval(
        simulation.weekly_returns["publicStress"],
        seed=interval_seed,
    )
    excess_interval = bootstrap_matched_excess_interval(
        simulation.weekly_returns["publicStress"],
        simulation.comparator_weekly_returns["publicStress"],
        seed=interval_seed + 10_000,
    )
    concentration = concentration_report(simulation)
    cash_fraction = D(simulation.cash_weeks) / D(len(simulation.signal_days))
    active_months = len({day.strftime("%Y-%m") for day in simulation.active_signal_days})
    minimum_capacity = (
        min(simulation.capacities_usd)
        if simulation.capacity_complete and simulation.capacities_usd
        else None
    )
    cost_decomposition: dict[str, JsonObject] = {}
    for name in COSTS:
        if name == "gross":
            adverse_only_net = nets["gross"]
        elif name == "publicBase":
            adverse_only_net = decomposition_nets["adverseOnly10"]
        else:
            adverse_only_net = decomposition_nets["adverseOnly25"]
        adverse_drag = nets["gross"] - adverse_only_net
        fee_drag = adverse_only_net - nets[name]
        cost_decomposition[name] = {
            "adverseExecutionDragUsd": str(adverse_drag),
            "feeDragUsd": str(fee_drag),
            "grossReferenceUsd": str(nets["gross"]),
            "identityResidualUsd": str(nets["gross"] - adverse_drag - fee_drag - nets[name]),
            "netUsd": str(nets[name]),
            "normalizedTwoWayTurnoverUsd": str(simulation.normalized_two_way_turnover_usd[name]),
            "turnoverFills": simulation.round_trips * 2,
        }
    summary: JsonObject = {
        "activeMonths": active_months,
        "activeWeeks": simulation.active_weeks,
        "cashFraction": str(cash_fraction),
        "cashWeeks": simulation.cash_weeks,
        "comparatorNetUsdPer1000": {name: str(value) for name, value in comparator_nets.items()},
        "concentration": concentration,
        "costScenariosBasisPointsPerFill": {
            name: {"fee": str(values[0]), "adverse": str(values[1])}
            for name, values in COSTS.items()
        },
        "costAndTurnoverDecomposition": cost_decomposition,
        "distinctTargets": len(simulation.distinct_targets),
        "fills": simulation.round_trips * 2,
        "maximumObservedMarkDrawdown": str(max_drawdown(simulation.mark_nav["publicStress"])),
        "minimumOneBpCapacityProxyUsd": (
            None if minimum_capacity is None else str(minimum_capacity)
        ),
        "netUsdPerInitial1000": {name: str(value) for name, value in nets.items()},
        "publicStressComparatorExcessUsd": str(
            nets["publicStress"] - comparator_nets["publicStress"]
        ),
        "publicStressMatchedExcessOneSided95LowerUsd": str(excess_interval[0]),
        "publicStressMatchedExcessTwoSided90IntervalUsd": {
            "lower": str(excess_interval[0]),
            "upper": str(excess_interval[1]),
        },
        "publicStressNetOneSided95LowerUsd": str(stress_interval[0]),
        "publicStressNetTwoSided90IntervalUsd": {
            "lower": str(stress_interval[0]),
            "upper": str(stress_interval[1]),
        },
        "roundTrips": simulation.round_trips,
        "scheduledWeeks": len(simulation.signal_days),
        "trialId": simulation.trial.trial_id,
    }
    if development:
        summary["holmVsCashAdjustedPValue"] = (
            None if holm_cash_pvalue is None else f"{holm_cash_pvalue:.10f}"
        )
        summary["holmVsComparatorAdjustedPValue"] = (
            None if holm_comparator_pvalue is None else f"{holm_comparator_pvalue:.10f}"
        )
        summary["whiteVsCashPValue"] = (
            None if white_cash_pvalue is None else f"{white_cash_pvalue:.10f}"
        )
        summary["whiteVsComparatorPValue"] = (
            None if white_comparator_pvalue is None else f"{white_comparator_pvalue:.10f}"
        )
    return summary


def decimal_field(mapping: Mapping[str, Any], *path: str) -> Decimal | None:
    value: Any = mapping
    for key in path:
        if not isinstance(value, dict):
            return None
        value = value.get(key)
    if value is None:
        return None
    return D(cast(str, value))


def evaluate_gates(
    summary: Mapping[str, Any],
    *,
    development: bool,
) -> tuple[str, ...]:
    protocol = load_json(PROTOCOL_PATH)
    gates = cast(
        JsonObject,
        protocol["formalDevelopmentGates"] if development else protocol["formalHoldoutGates"],
    )
    failures: list[str] = []

    def minimum(name: str, actual: Decimal | int | None, required: str | int) -> None:
        if actual is None or D(actual) < D(required):
            failures.append(name)

    def positive(name: str, actual: Decimal | None) -> None:
        if actual is None or actual <= ZERO:
            failures.append(name)

    minimum("ACTIVE_MONTHS", cast(int, summary.get("activeMonths")), gates["activeMonthsMinimum"])
    minimum("ACTIVE_WEEKS", cast(int, summary.get("activeWeeks")), gates["activeWeeksMinimum"])
    minimum(
        "DISTINCT_TARGETS",
        cast(int, summary.get("distinctTargets")),
        gates["distinctTargetsMinimum"],
    )
    minimum("ROUND_TRIPS", cast(int, summary.get("roundTrips")), gates["roundTripsMinimum"])
    if D(cast(str, summary.get("cashFraction"))) > D(cast(str, gates["cashFractionMaximum"])):
        failures.append("CASH_FRACTION")
    positive(
        "PUBLIC_BASE_NET",
        decimal_field(summary, "netUsdPerInitial1000", "publicBase"),
    )
    positive(
        "PUBLIC_STRESS_NET",
        decimal_field(summary, "netUsdPerInitial1000", "publicStress"),
    )
    positive(
        "FEE_STRESS_NET",
        decimal_field(summary, "netUsdPerInitial1000", "feeStress"),
    )
    positive(
        "PUBLIC_STRESS_INTERVAL_LOWER",
        decimal_field(summary, "publicStressNetOneSided95LowerUsd"),
    )
    positive(
        "PUBLIC_STRESS_COMPARATOR_EXCESS",
        decimal_field(summary, "publicStressComparatorExcessUsd"),
    )
    positive(
        "PUBLIC_STRESS_COMPARATOR_EXCESS_INTERVAL_LOWER",
        decimal_field(summary, "publicStressMatchedExcessOneSided95LowerUsd"),
    )
    maximum_drawdown = decimal_field(summary, "maximumObservedMarkDrawdown")
    if maximum_drawdown is None or maximum_drawdown > D(cast(str, gates["maximumDrawdownMaximum"])):
        failures.append("MAXIMUM_DRAWDOWN")
    minimum(
        "ONE_BP_CAPACITY_PROXY",
        decimal_field(summary, "minimumOneBpCapacityProxyUsd"),
        cast(str, gates["minimumOneBpCapacityProxyUsd"]),
    )
    top_asset = decimal_field(summary, "concentration", "topAssetGrossProfitShare")
    top_five = decimal_field(summary, "concentration", "topFiveEventGrossProfitShare")
    if top_asset is None or top_asset > D(cast(str, gates["topAssetGrossProfitShareMaximum"])):
        failures.append("TOP_ASSET_CONCENTRATION")
    if top_five is None or top_five > D(cast(str, gates["topFiveEventGrossProfitShareMaximum"])):
        failures.append("TOP_FIVE_EVENT_CONCENTRATION")
    if development:
        holm_cash = decimal_field(summary, "holmVsCashAdjustedPValue")
        holm_comparator = decimal_field(summary, "holmVsComparatorAdjustedPValue")
        white_cash = decimal_field(summary, "whiteVsCashPValue")
        white_comparator = decimal_field(summary, "whiteVsComparatorPValue")
        if holm_cash is None or holm_cash >= D(
            cast(str, gates["holmVsCashAdjustedPValueExclusiveMaximum"])
        ):
            failures.append("HOLM_VS_CASH")
        if holm_comparator is None or holm_comparator >= D(
            cast(str, gates["holmVsComparatorAdjustedPValueExclusiveMaximum"])
        ):
            failures.append("HOLM_VS_COMPARATOR")
        if white_cash is None or white_cash >= D(
            cast(str, gates["whiteVsCashPValueExclusiveMaximum"])
        ):
            failures.append("WHITE_VS_CASH")
        if white_comparator is None or white_comparator >= D(
            cast(str, gates["whiteVsComparatorPValueExclusiveMaximum"])
        ):
            failures.append("WHITE_VS_COMPARATOR")
    return tuple(failures)


def select_champion(
    summaries: Mapping[str, Mapping[str, Any]],
    simulations: Mapping[str, Simulation],
) -> str:
    """Select once across all six; lower H/K/ID wins an exact metric tie."""
    if set(summaries) != set(simulations) or set(simulations) != {
        trial.trial_id for trial in trial_grid()
    }:
        raise MeasurementError("champion selection requires all six trials")
    return min(
        simulations,
        key=lambda trial_id: (
            -cast(
                Decimal,
                decimal_field(
                    summaries[trial_id],
                    "publicStressMatchedExcessOneSided95LowerUsd",
                ),
            ),
            -cast(
                Decimal,
                decimal_field(
                    summaries[trial_id],
                    "netUsdPerInitial1000",
                    "publicStress",
                ),
            ),
            simulations[trial_id].trial.hold_days,
            simulations[trial_id].trial.target_count,
            trial_id,
        ),
    )


def source_symbols() -> set[str]:
    manifest = load_json(SOURCE_MANIFEST_PATH)
    symbols = set(cast(list[str], manifest.get("universeSymbols")))
    symbols.difference_update(cast(list[str], manifest.get("excludedStableOrFiatSymbols")))
    symbols.difference_update(cast(list[str], manifest.get("excludedPairedLeveragedSymbols")))
    return symbols


def load_partition(
    state_root: Path,
    months: Sequence[str],
    symbols: set[str],
) -> dict[str, dict[date, Bar]]:
    records = manifest_records(set(months), symbols)
    if not records:
        raise MeasurementError("partition has no admitted records")
    return load_panel(records, state_root)


def generate_sha256s() -> None:
    candidates = (
        "DISTINCTNESS.md",
        "OFFICIAL_SOURCE_RESEARCH.md",
        "README.md",
        "__init__.py",
        "development-open.v1.json",
        "development.v1.json",
        "experiment.py",
        "freeze.v1.json",
        "official_sources.v1.json",
        "protocol.v1.json",
        "result.v1.json",
        "run-marker.v1.json",
        "selection.v1.json",
        "source-manifest.v1.json",
        "terminal.v1.json",
        "test_experiment.py",
        "holdout-open.v1.json",
    )
    names = tuple(name for name in candidates if (HERE / name).is_file())
    rows = tuple(f"{sha256_path(HERE / name)}  {name}" for name in sorted(names))
    raw = ("\n".join(rows) + "\n").encode("utf-8")
    descriptor = os.open(SHA256SUMS_PATH, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "wb", closefd=True) as handle:
        handle.write(raw)
        handle.flush()
        os.fsync(handle.fileno())
    fsync_directory(HERE)


def current_bindings() -> JsonObject:
    paths = {
        "developmentOpenSha256": DEVELOPMENT_OPEN_PATH,
        "developmentSha256": DEVELOPMENT_PATH,
        "freezeSha256": FREEZE_PATH,
        "holdoutOpenSha256": HOLDOUT_OPEN_PATH,
        "runMarkerSha256": RUN_MARKER_PATH,
        "selectionSha256": SELECTION_PATH,
    }
    return {field: sha256_path(path) for field, path in paths.items() if path.is_file()}


def terminal_state_for_result(result: Mapping[str, Any]) -> str:
    verdict = result.get("verdict")
    local_verdict = result.get("localPublicScreenVerdict")
    if verdict == "UNMEASURED" and local_verdict == "UNMEASURED":
        return "TERMINAL_UNMEASURED_NO_REPAIR_NO_RERUN"
    if verdict == "NO_GO" and local_verdict in {"GO", "NO_GO"}:
        return "TERMINAL_SEALED_NO_REPAIR_NO_RERUN"
    raise VG24Error("result and terminal verdict classes cannot be reconciled")


def terminal_unmeasured(reason: str, freeze: Mapping[str, Any]) -> JsonObject:
    if RESULT_PATH.exists():
        result = load_json(RESULT_PATH)
    else:
        result = {
            "accountEffectiveFee": "UNKNOWN",
            "authority": "NONE",
            "baseNetUsdPer1000": None,
            "bindings": current_bindings(),
            "capitalVerdict": "NO_GO",
            "completedAtUtc": utc_now(),
            "consumer": "N3 successor/final convergence",
            "executableCapacity": "UNMEASURED",
            "freezeSha256": sha256_path(FREEZE_PATH),
            "holdout": {
                "openCount": int(HOLDOUT_OPEN_PATH.exists()),
                "status": "UNMEASURED" if HOLDOUT_OPEN_PATH.exists() else "UNOPENED",
            },
            "localPublicScreenVerdict": "UNMEASURED",
            "programWideMultiplicity": "NOT_CONVERGED",
            "reason": reason,
            "schema": "VG24ResultV1",
            "stressNetUsdPer1000": None,
            "verdict": "UNMEASURED",
            "verifiedPositive": False,
            "widerProfitability": "UNKNOWN",
        }
        write_once(RESULT_PATH, result)
    terminal_state = terminal_state_for_result(result)
    terminal = {
        "completedAtUtc": utc_now(),
        "freezeSha256": sha256_path(FREEZE_PATH),
        "freezeStaticCommit": freeze.get("staticCommit"),
        "runMarkerSha256": sha256_path(RUN_MARKER_PATH),
        "resultSha256": sha256_path(RESULT_PATH),
        "schema": "VG24TerminalV1",
        "state": terminal_state,
    }
    if TERMINAL_PATH.exists():
        existing_terminal = load_json(TERMINAL_PATH)
        if any(
            (
                existing_terminal.get("schema") != terminal["schema"],
                existing_terminal.get("state") != terminal_state,
                existing_terminal.get("freezeSha256") != terminal["freezeSha256"],
                existing_terminal.get("runMarkerSha256") != terminal["runMarkerSha256"],
                existing_terminal.get("resultSha256") != terminal["resultSha256"],
            )
        ):
            raise VG24Error("existing terminal receipt conflicts with sealed result")
    else:
        write_once(TERMINAL_PATH, terminal)
    if not SHA256SUMS_PATH.exists():
        generate_sha256s()
    else:
        verify_sha256s()
    return result


def run_command(state_root: Path) -> JsonObject:
    freeze = verify_freeze(state_root, require_freeze_head=True)
    if any(
        path.exists()
        for path in (
            RUN_MARKER_PATH,
            DEVELOPMENT_OPEN_PATH,
            DEVELOPMENT_PATH,
            SELECTION_PATH,
            HOLDOUT_OPEN_PATH,
            RESULT_PATH,
            TERMINAL_PATH,
            SHA256SUMS_PATH,
        )
    ):
        raise VG24Error("sole evaluation authority already consumed")
    marker = {
        "consumedAtUtc": utc_now(),
        "freezeSha256": sha256_path(FREEZE_PATH),
        "schema": "VG24RunMarkerV1",
        "state": "SOLE_EVALUATION_RUN_CONSUMED_NO_RERUN",
        "staticCommit": freeze.get("staticCommit"),
    }
    write_once(RUN_MARKER_PATH, marker)
    try:
        write_once(
            DEVELOPMENT_OPEN_PATH,
            {
                "freezeSha256": sha256_path(FREEZE_PATH),
                "openedAtUtc": utc_now(),
                "runMarkerSha256": sha256_path(RUN_MARKER_PATH),
                "schema": "VG24DevelopmentOpenV1",
                "state": "DEVELOPMENT_MEMBER_ACCESS_CONSUMED",
            },
        )
        symbols = source_symbols()
        panel = load_partition(state_root, DEVELOPMENT_MONTHS, symbols)
        development_days = scheduled_sundays(DEVELOPMENT_START, DEVELOPMENT_END)
        cache = SignalCache(panel)
        signals = {day: build_signal(cache, day) for day in development_days}
        simulations = {
            trial.trial_id: simulate_trial(panel, signals, development_days, trial)
            for trial in trial_grid()
        }
        comparator_matrix = {
            trial_id: matched_excess_log_returns(simulation)
            for trial_id, simulation in simulations.items()
        }
        cash_matrix = {
            trial_id: cash_log_returns(simulation) for trial_id, simulation in simulations.items()
        }
        raw_comparator_p = {
            trial_id: bootstrap_one_sided_pvalue(
                values,
                seed=BOOTSTRAP_SEED + index,
            )
            for index, (trial_id, values) in enumerate(sorted(comparator_matrix.items()))
        }
        raw_cash_p = {
            trial_id: bootstrap_one_sided_pvalue(
                values,
                seed=BOOTSTRAP_SEED + 100 + index,
            )
            for index, (trial_id, values) in enumerate(sorted(cash_matrix.items()))
        }
        adjusted_comparator = holm_adjusted(raw_comparator_p)
        adjusted_cash = holm_adjusted(raw_cash_p)
        white_comparator = white_reality_check(comparator_matrix)
        white_cash = white_reality_check(cash_matrix)
        white_comparator_p = float(cast(str, white_comparator["pValue"]))
        white_cash_p = float(cast(str, white_cash["pValue"]))
        summaries: dict[str, JsonObject] = {}
        for index, trial_id in enumerate(sorted(simulations)):
            summary = simulation_summary(
                simulations[trial_id],
                interval_seed=BOOTSTRAP_SEED + 100 + index,
                holm_cash_pvalue=adjusted_cash[trial_id],
                holm_comparator_pvalue=adjusted_comparator[trial_id],
                white_cash_pvalue=white_cash_p,
                white_comparator_pvalue=white_comparator_p,
                development=True,
            )
            summary["failedFormalGates"] = list(evaluate_gates(summary, development=True))
            summaries[trial_id] = summary
        pbo = pbo_report(comparator_matrix, development_days)
        development = {
            "attemptedTrialCount": len(simulations),
            "completedAtUtc": utc_now(),
            "developmentOpenSha256": sha256_path(DEVELOPMENT_OPEN_PATH),
            "freezeSha256": sha256_path(FREEZE_PATH),
            "fullCashDayCalendarSha256": canonical_sha(
                tuple(day.isoformat() for day in development_days)
            ),
            "pbo": pbo,
            "runMarkerSha256": sha256_path(RUN_MARKER_PATH),
            "schema": "VG24DevelopmentV1",
            "trialSummaries": [summaries[trial_id] for trial_id in sorted(summaries)],
            "whiteRealityChecks": {
                "vsCash": white_cash,
                "vsMatchedComparator": white_comparator,
            },
        }
        write_once(DEVELOPMENT_PATH, development)
        champion_id = select_champion(summaries, simulations)
        champion = summaries[champion_id]
        development_passed = not cast(list[str], champion["failedFormalGates"])
        selection = {
            "championTrialId": champion_id,
            "developmentPassedAllGates": development_passed,
            "developmentSha256": sha256_path(DEVELOPMENT_PATH),
            "freezeSha256": sha256_path(FREEZE_PATH),
            "holdoutMetricsRead": False,
            "schema": "VG24SelectionV1",
            "selectedAtUtc": utc_now(),
            "runMarkerSha256": sha256_path(RUN_MARKER_PATH),
            "trialFamilySha256": canonical_sha(
                [
                    {
                        "holdDays": trial.hold_days,
                        "targetCount": trial.target_count,
                        "trialId": trial.trial_id,
                    }
                    for trial in trial_grid()
                ]
            ),
        }
        write_once(SELECTION_PATH, selection)
        if not development_passed:
            result: JsonObject = {
                "accountEffectiveFee": "UNKNOWN",
                "authority": "NONE",
                "bindings": current_bindings(),
                "capitalVerdict": "NO_GO",
                "capacity": {
                    "executable": "UNMEASURED",
                    "oneBpPublicProxyUsd": champion["minimumOneBpCapacityProxyUsd"],
                },
                "championTrialId": champion_id,
                "completedAtUtc": utc_now(),
                "consumer": "N3 successor/final convergence",
                "development": champion,
                "developmentPbo": pbo,
                "holdout": {"openCount": 0, "status": "UNOPENED_DEVELOPMENT_GATES_FAILED"},
                "localPublicScreenVerdict": "NO_GO",
                "programWideMultiplicity": "NOT_CONVERGED",
                "reason": "ONE_OR_MORE_FROZEN_DEVELOPMENT_GATES_FAILED",
                "schema": "VG24ResultV1",
                "verdict": "NO_GO",
                "verifiedPositive": False,
                "widerProfitability": "UNKNOWN",
                "whiteRealityChecks": {
                    "vsCash": white_cash,
                    "vsMatchedComparator": white_comparator,
                },
            }
        else:
            write_once(
                HOLDOUT_OPEN_PATH,
                {
                    "championTrialId": champion_id,
                    "developmentSha256": sha256_path(DEVELOPMENT_PATH),
                    "freezeSha256": sha256_path(FREEZE_PATH),
                    "openedAtUtc": utc_now(),
                    "runMarkerSha256": sha256_path(RUN_MARKER_PATH),
                    "schema": "VG24HoldoutOpenV1",
                    "selectionSha256": sha256_path(SELECTION_PATH),
                    "state": "SINGLE_HOLDOUT_MEMBER_ACCESS_CONSUMED",
                },
            )
            holdout_panel = load_partition(state_root, HOLDOUT_MONTHS, symbols)
            merge_panel(panel, holdout_panel)
            holdout_days = scheduled_sundays(HOLDOUT_START, HOLDOUT_END)
            holdout_cache = SignalCache(panel)
            holdout_signals = {day: build_signal(holdout_cache, day) for day in holdout_days}
            champion_trial = simulations[champion_id].trial
            holdout_simulation = simulate_trial(
                panel,
                holdout_signals,
                holdout_days,
                champion_trial,
            )
            holdout_summary = simulation_summary(
                holdout_simulation,
                interval_seed=BOOTSTRAP_SEED + 50_000,
                holm_cash_pvalue=None,
                holm_comparator_pvalue=None,
                white_cash_pvalue=None,
                white_comparator_pvalue=None,
                development=False,
            )
            holdout_failures = evaluate_gates(holdout_summary, development=False)
            holdout_summary["failedFormalGates"] = list(holdout_failures)
            local_pass = not holdout_failures
            result = {
                "accountEffectiveFee": "UNKNOWN",
                "authority": "NONE",
                "bindings": current_bindings(),
                "capitalVerdict": "NO_GO",
                "capacity": {
                    "executable": "UNMEASURED",
                    "oneBpPublicProxyUsd": holdout_summary["minimumOneBpCapacityProxyUsd"],
                },
                "championTrialId": champion_id,
                "completedAtUtc": utc_now(),
                "consumer": "N3 successor/final convergence",
                "development": champion,
                "developmentPbo": pbo,
                "holdout": {
                    "metrics": holdout_summary,
                    "openCount": 1,
                    "status": "CONSUMED",
                },
                "localPublicScreenVerdict": "GO" if local_pass else "NO_GO",
                "programWideMultiplicity": "NOT_CONVERGED",
                "reason": (
                    "ALL_LOCAL_PUBLIC_RESEARCH_GATES_PASSED"
                    if local_pass
                    else "ONE_OR_MORE_FROZEN_HOLDOUT_GATES_FAILED"
                ),
                "schema": "VG24ResultV1",
                "verdict": "NO_GO",
                "verifiedPositive": False,
                "widerProfitability": "UNKNOWN",
                "whiteRealityChecks": {
                    "vsCash": white_cash,
                    "vsMatchedComparator": white_comparator,
                },
            }
        write_once(RESULT_PATH, result)
        write_once(
            TERMINAL_PATH,
            {
                "completedAtUtc": utc_now(),
                "freezeSha256": sha256_path(FREEZE_PATH),
                "holdoutOpenCount": int(HOLDOUT_OPEN_PATH.exists()),
                "resultSha256": sha256_path(RESULT_PATH),
                "runMarkerSha256": sha256_path(RUN_MARKER_PATH),
                "schema": "VG24TerminalV1",
                "state": "TERMINAL_SEALED_NO_REPAIR_NO_RERUN",
            },
        )
        generate_sha256s()
        return result
    except Exception as exc:
        return terminal_unmeasured(f"{type(exc).__name__}:{exc}", freeze)


def verify_sha256s() -> None:
    lines = SHA256SUMS_PATH.read_text(encoding="utf-8").splitlines()
    rows: list[tuple[str, str]] = []
    for line in lines:
        if line.count("  ") != 1:
            raise VG24Error("invalid SHA256SUMS grammar")
        digest, filename = line.split("  ", 1)
        if (
            len(digest) != 64
            or any(character not in "0123456789abcdef" for character in digest)
            or "/" in filename
            or filename == "SHA256SUMS"
        ):
            raise VG24Error("invalid SHA256SUMS row")
        rows.append((digest, filename))
    filenames = tuple(filename for _, filename in rows)
    candidates = (
        "DISTINCTNESS.md",
        "OFFICIAL_SOURCE_RESEARCH.md",
        "README.md",
        "__init__.py",
        "development-open.v1.json",
        "development.v1.json",
        "experiment.py",
        "freeze.v1.json",
        "holdout-open.v1.json",
        "official_sources.v1.json",
        "protocol.v1.json",
        "result.v1.json",
        "run-marker.v1.json",
        "selection.v1.json",
        "source-manifest.v1.json",
        "terminal.v1.json",
        "test_experiment.py",
    )
    expected = tuple(sorted(name for name in candidates if (HERE / name).is_file()))
    if filenames != expected or len(filenames) != len(set(filenames)):
        raise VG24Error("SHA256SUMS exact filename set or order mismatch")
    for digest, filename in rows:
        if sha256_path(HERE / filename) != digest:
            raise VG24Error(f"SHA256SUMS mismatch: {filename}")


def verify_command(state_root: Path) -> JsonObject:
    freeze = verify_freeze(state_root)
    verify_sha256s()
    marker = load_json(RUN_MARKER_PATH)
    terminal = load_json(TERMINAL_PATH)
    result = load_json(RESULT_PATH)
    freeze_sha = sha256_path(FREEZE_PATH)
    marker_sha = sha256_path(RUN_MARKER_PATH)
    if (
        marker.get("schema") != "VG24RunMarkerV1"
        or marker.get("state") != "SOLE_EVALUATION_RUN_CONSUMED_NO_RERUN"
        or marker.get("freezeSha256") != freeze_sha
        or marker.get("staticCommit") != freeze.get("staticCommit")
    ):
        raise VG24Error("invalid run marker")
    if DEVELOPMENT_OPEN_PATH.exists():
        development_open = load_json(DEVELOPMENT_OPEN_PATH)
        if (
            development_open.get("schema") != "VG24DevelopmentOpenV1"
            or development_open.get("state") != "DEVELOPMENT_MEMBER_ACCESS_CONSUMED"
            or development_open.get("freezeSha256") != freeze_sha
            or development_open.get("runMarkerSha256") != marker_sha
        ):
            raise VG24Error("development-open receipt chain mismatch")
    if DEVELOPMENT_PATH.exists():
        if not DEVELOPMENT_OPEN_PATH.exists():
            raise VG24Error("development exists without open receipt")
        development = load_json(DEVELOPMENT_PATH)
        if (
            development.get("schema") != "VG24DevelopmentV1"
            or development.get("freezeSha256") != freeze_sha
            or development.get("runMarkerSha256") != marker_sha
            or development.get("developmentOpenSha256") != sha256_path(DEVELOPMENT_OPEN_PATH)
        ):
            raise VG24Error("development receipt chain mismatch")
    if SELECTION_PATH.exists():
        if not DEVELOPMENT_PATH.exists():
            raise VG24Error("selection exists without development")
        selection = load_json(SELECTION_PATH)
        if (
            selection.get("schema") != "VG24SelectionV1"
            or selection.get("freezeSha256") != freeze_sha
            or selection.get("runMarkerSha256") != marker_sha
            or selection.get("developmentSha256") != sha256_path(DEVELOPMENT_PATH)
        ):
            raise VG24Error("selection receipt chain mismatch")
    if HOLDOUT_OPEN_PATH.exists():
        if not SELECTION_PATH.exists():
            raise VG24Error("holdout exists without selection")
        holdout_open = load_json(HOLDOUT_OPEN_PATH)
        selection = load_json(SELECTION_PATH)
        if (
            holdout_open.get("schema") != "VG24HoldoutOpenV1"
            or holdout_open.get("state") != "SINGLE_HOLDOUT_MEMBER_ACCESS_CONSUMED"
            or holdout_open.get("freezeSha256") != freeze_sha
            or holdout_open.get("runMarkerSha256") != marker_sha
            or holdout_open.get("developmentSha256") != sha256_path(DEVELOPMENT_PATH)
            or holdout_open.get("selectionSha256") != sha256_path(SELECTION_PATH)
            or selection.get("developmentPassedAllGates") is not True
        ):
            raise VG24Error("holdout receipt chain mismatch")
    if (
        terminal.get("schema") != "VG24TerminalV1"
        or terminal.get("state")
        not in {
            "TERMINAL_SEALED_NO_REPAIR_NO_RERUN",
            "TERMINAL_UNMEASURED_NO_REPAIR_NO_RERUN",
        }
        or terminal.get("freezeSha256") != freeze_sha
        or terminal.get("runMarkerSha256") != marker_sha
        or terminal.get("resultSha256") != sha256_path(RESULT_PATH)
    ):
        raise VG24Error("terminal receipt does not bind result")
    if result.get("verdict") not in {"NO_GO", "UNMEASURED"}:
        raise VG24Error("invalid verdict")
    if result.get("localPublicScreenVerdict") not in {"GO", "NO_GO", "UNMEASURED"}:
        raise VG24Error("invalid local public-screen verdict")
    if (
        result.get("capitalVerdict") != "NO_GO"
        or result.get("widerProfitability") != "UNKNOWN"
        or result.get("authority") != "NONE"
    ):
        raise VG24Error("truth-boundary verdict fields mismatch")
    if result.get("verifiedPositive") is not False:
        raise VG24Error("local result cannot be VERIFIED_POSITIVE")
    if terminal.get("state") != terminal_state_for_result(result):
        raise VG24Error("terminal state and result verdict class mismatch")
    if result.get("bindings") != current_bindings():
        raise VG24Error("result receipt chain mismatch")
    holdout = cast(JsonObject, result.get("holdout"))
    open_count = cast(int, holdout.get("openCount"))
    if open_count not in {0, 1} or open_count != int(HOLDOUT_OPEN_PATH.exists()):
        raise VG24Error("holdout open count mismatch")
    if result.get("localPublicScreenVerdict") == "GO" and not HOLDOUT_OPEN_PATH.exists():
        raise VG24Error("local GO lacks the single holdout")
    return {
        "authenticatedWithoutRecomputation": True,
        "consumer": result["consumer"],
        "freezeStaticCommit": freeze["staticCommit"],
        "holdoutOpenCount": open_count,
        "resultSha256": sha256_path(RESULT_PATH),
        "verdict": result["verdict"],
        "verifiedPositive": False,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("freeze", "run", "verify"))
    parser.add_argument("--source-root", required=True, type=Path)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = build_parser().parse_args(argv)
    try:
        if arguments.command == "freeze":
            value = freeze_command(arguments.source_root)
        elif arguments.command == "run":
            result = run_command(arguments.source_root)
            value = {
                "holdoutOpenCount": cast(JsonObject, result["holdout"])["openCount"],
                "verdict": result["verdict"],
                "verifiedPositive": result["verifiedPositive"],
            }
        else:
            value = verify_command(arguments.source_root)
    except (
        VG24Error,
        MeasurementError,
        OSError,
        ValueError,
        ArithmeticError,
        subprocess.CalledProcessError,
    ) as exc:
        print(f"VG24_ERROR:{type(exc).__name__}:{exc}", file=sys.stderr)
        return 2
    print(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
