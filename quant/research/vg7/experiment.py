"""Sealed V-G7 public Binance Spot daily-bar experiment.

``freeze`` hashes publisher-checksummed compressed inputs without opening ZIP
members. ``run`` consumes one development attempt, seals one candidate only if
all development gates pass, and opens the holdout at most once after that seal.
No command in this module uses the network.
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
import statistics
import subprocess
import sys
import time
import zipfile
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal, InvalidOperation, getcontext
from pathlib import Path
from typing import Any, Final, cast

getcontext().prec = 50

D = Decimal
HERE: Final = Path(__file__).resolve().parent
PROTOCOL_PATH: Final = HERE / "protocol.v1.json"
SOURCE_RESEARCH_PATH: Final = HERE / "OFFICIAL_SOURCE_RESEARCH.md"
README_PATH: Final = HERE / "README.md"
VERIFIER_PATH: Final = HERE / "verify.py"
TEST_PATH: Final = HERE / "test_packet.py"
QUANT_ROOT: Final = HERE.parent.parent
PYPROJECT_PATH: Final = QUANT_ROOT / "pyproject.toml"
UV_LOCK_PATH: Final = QUANT_ROOT / "uv.lock"
UNIVERSE_PATH: Final = HERE / "universe.v1.json"
SOURCE_MANIFEST_PATH: Final = HERE / "source-manifest.v1.json"
FREEZE_PATH: Final = HERE / "freeze.v1.json"
DEVELOPMENT_MARKER_PATH: Final = HERE / "development-run-marker.v1.json"
CANDIDATE_SEAL_PATH: Final = HERE / "candidate-seal.v1.json"
HOLDOUT_MARKER_PATH: Final = HERE / "holdout-open-marker.v1.json"
RESULT_PATH: Final = HERE / "result.v1.json"
VERDICT_PATH: Final = HERE / "VERDICT.md"
ROW_PATH: Final = HERE / "PROPOSED_RUN_SECTION5_ROW.md"
CHECKSUMS_PATH: Final = HERE / "SHA256SUMS"
BASE_SHA: Final = "a169b123fb186d1943a75ad648552c4d95be1be1"
EXPECTED_DISCOVERY_SHA: Final = "b4a8f7abd36df19eff0510dfcc3c61fd0df9fdcab5f4d248892ee10010fb21c3"
EXPECTED_ACQUISITION_SHA: Final = "01f58272602e43bfb914b649adc00d8273b2d423492220a55f86443bb6441176"
EXPECTED_UNIVERSE_SHA: Final = "a597d8339aafb74c40b8899cade9445150c3f431f4c2e7fe2bfac37d8d1b0592"
DAY_US: Final = 86_400_000_000
LIMITATION: Final = (
    "This is a sealed 12-month public Binance Spot daily-bar simulation, not "
    "account-specific fee or fill truth, live profitability evidence, forward "
    "assurance, verified executable capacity, capital authorization, or "
    "execution authority."
)
EXECUTION_BANNER: Final = (
    "PUBLIC_BAR_EXECUTION_SENSITIVITY_ONLY; ACCOUNT_EFFECTIVE_FEES=UNKNOWN; "
    "HISTORICAL_FILTER_ADMISSIBILITY=UNKNOWN; HISTORICAL_BOOK=UNAVAILABLE; "
    "VERIFIED_EXECUTABLE_CAPACITY=UNMEASURED; EXECUTION_AUTHORITY=NONE."
)
KNOWN_WARMUP_SEMANTIC_UNAVAILABLE: Final = "AERGOUSDT|2025-03|DAILY_CLOSE_BOUNDARY_INVALID"


class EvidenceError(RuntimeError):
    """A fail-closed source, lifecycle, or measurement error."""


class ArchiveSemanticError(EvidenceError):
    """A publisher-checksummed archive whose member cannot supply valid bars."""


@dataclass(frozen=True, slots=True)
class Bar:
    day: date
    open: float
    high: float
    low: float
    close: float
    quote_volume: float
    trade_count: int


@dataclass(frozen=True, slots=True)
class Trial:
    trial_id: str
    volume_multiple: float
    pivot_return_maximum: float
    lower_wick_fraction: float
    hold_days: int

    def as_mapping(self) -> dict[str, object]:
        return {
            "trialId": self.trial_id,
            "volumeMultiple": number_text(self.volume_multiple),
            "pivotReturnMaximum": number_text(self.pivot_return_maximum),
            "lowerWickFraction": number_text(self.lower_wick_fraction),
            "holdDays": self.hold_days,
        }


@dataclass(frozen=True, slots=True)
class CostScenario:
    name: str
    fee_bps: float
    adverse_bps: float
    required: bool

    @property
    def all_in_bps_per_fill(self) -> float:
        return self.fee_bps + self.adverse_bps


@dataclass(frozen=True, slots=True)
class Signal:
    symbol: str
    pivot_day: date
    entry_day: date
    pivot_return: float
    volume_multiple: float
    lower_wick_fraction: float


@dataclass(frozen=True, slots=True)
class Position:
    signal: Signal
    exit_day: date
    quantity: float
    entry_reference: float
    entry_fill: float
    entry_equity: float
    entry_capacity_usdt: float


@dataclass(frozen=True, slots=True)
class RunMetrics:
    signal_events: int
    clustered_events: int
    executable_opportunities: int
    suppressed_partition_boundary: int
    rejected_portfolio_conflict: int
    round_trips: int
    fills: int
    distinct_symbols: tuple[str, ...]
    active_weeks: int
    active_months: int
    start_usd: float
    end_usd: float
    net_per_initial_1000_usd: float
    max_daily_close_marked_drawdown_pct: float
    supported_initial_capital_min_usdt: float | None
    supported_initial_capital_p05_usdt: float | None
    supported_initial_capital_median_usdt: float | None
    daily_returns: tuple[float, ...]

    def summary(self) -> dict[str, object]:
        return {
            "signalEvents": self.signal_events,
            "clusteredEvents": self.clustered_events,
            "executableOpportunities": self.executable_opportunities,
            "suppressedPartitionBoundary": self.suppressed_partition_boundary,
            "rejectedPortfolioConflict": self.rejected_portfolio_conflict,
            "selectedRoundTrips": self.round_trips,
            "fills": self.fills,
            "distinctSymbolCount": len(self.distinct_symbols),
            "distinctSymbols": list(self.distinct_symbols),
            "activeWeekCount": self.active_weeks,
            "activeMonthCount": self.active_months,
            "startUsd": number_text(self.start_usd),
            "endUsd": number_text(self.end_usd),
            "netPerInitial1000Usd": number_text(self.net_per_initial_1000_usd),
            "maxDailyCloseMarkedDrawdownPct": number_text(self.max_daily_close_marked_drawdown_pct),
            "capacityProxy": {
                "label": "PUBLIC_BAR_PARTICIPATION_PROXY_NOT_EXECUTABLE_CAPACITY",
                "supportedInitialCapitalMinUsdt": optional_number(
                    self.supported_initial_capital_min_usdt
                ),
                "supportedInitialCapitalP05Usdt": optional_number(
                    self.supported_initial_capital_p05_usdt
                ),
                "supportedInitialCapitalMedianUsdt": optional_number(
                    self.supported_initial_capital_median_usdt
                ),
                "verifiedExecutableCapacity": "UNMEASURED",
            },
        }


def canonical_bytes(value: object) -> bytes:
    return (
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n"
    ).encode("utf-8")


def sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def sha256_path(path: Path) -> str:
    return sha256_bytes(safe_file(path).read_bytes())


def normalized_lines(values: Iterable[str]) -> bytes:
    return ("\n".join(values) + "\n").encode()


def now_utc() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def number_text(value: float) -> str:
    if not math.isfinite(value):
        raise EvidenceError("non-finite number cannot be serialized")
    if value == 0:
        return "0"
    return format(value, ".17g")


def optional_number(value: float | None) -> str | None:
    return None if value is None else number_text(value)


def safe_file(path: Path) -> Path:
    if path.is_symlink() or not path.is_file():
        raise EvidenceError(f"required regular file missing or unsafe: {path.name}")
    return path


def load_json(path: Path) -> tuple[dict[str, Any], bytes]:
    raw = safe_file(path).read_bytes()
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as error:
        raise EvidenceError(f"invalid JSON: {path.name}") from error
    if not isinstance(value, dict):
        raise EvidenceError(f"JSON root must be an object: {path.name}")
    return cast(dict[str, Any], value), raw


def require_text(value: object, *, field: str) -> str:
    if not isinstance(value, str) or not value:
        raise EvidenceError(f"{field} must be nonempty text")
    return value


def require_int(value: object, *, field: str, minimum: int = 0) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise EvidenceError(f"{field} must be an integer >= {minimum}")
    return value


def require_list(value: object, *, field: str) -> list[Any]:
    if not isinstance(value, list):
        raise EvidenceError(f"{field} must be a list")
    return value


def nested(mapping: Mapping[str, Any], *keys: str) -> Any:
    current: Any = mapping
    for key in keys:
        if not isinstance(current, dict) or key not in current:
            raise EvidenceError(f"required field missing: {'.'.join(keys)}")
        current = current[key]
    return current


def exact_float(value: object, *, field: str) -> float:
    if not isinstance(value, (str, int)) or isinstance(value, bool):
        raise EvidenceError(f"{field} must be an exact decimal string or integer")
    try:
        parsed = D(str(value))
    except InvalidOperation as error:
        raise EvidenceError(f"{field} is not a decimal") from error
    if not parsed.is_finite():
        raise EvidenceError(f"{field} must be finite")
    return float(parsed)


def date_value(value: object, *, field: str) -> date:
    text = require_text(value, field=field)
    try:
        return date.fromisoformat(text)
    except ValueError as error:
        raise EvidenceError(f"{field} must be an ISO date") from error


def month_range(first: str, last: str) -> tuple[str, ...]:
    try:
        first_day = date.fromisoformat(f"{first}-01")
        last_day = date.fromisoformat(f"{last}-01")
    except ValueError as error:
        raise EvidenceError("source month range must use YYYY-MM") from error
    values: list[str] = []
    current = first_day
    while current <= last_day:
        values.append(current.strftime("%Y-%m"))
        current = (
            date(current.year + 1, 1, 1)
            if current.month == 12
            else date(current.year, current.month + 1, 1)
        )
    return tuple(values)


def daterange(start: date, end_exclusive: date) -> Iterable[date]:
    current = start
    while current < end_exclusive:
        yield current
        current += timedelta(days=1)


def fsync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def guarded_output(path: Path) -> Path:
    if path.parent.resolve() != HERE.resolve() or path == HERE:
        raise EvidenceError("write refused outside quant/research/vg7")
    if path.is_symlink():
        raise EvidenceError(f"symlink output refused: {path.name}")
    return path


def exclusive_write(path: Path, raw: bytes) -> None:
    guarded_output(path)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.{time.time_ns()}.no-clobber")
    guarded_output(temporary)
    try:
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        try:
            os.link(temporary, path)
        except FileExistsError as error:
            raise EvidenceError(f"exclusive output already exists: {path.name}") from error
        temporary.unlink()
        fsync_directory(HERE)
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise


def git(*arguments: str) -> str:
    completed = subprocess.run(
        ("git", "-C", str(HERE), *arguments),
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        raise EvidenceError(f"Git command failed: {' '.join(arguments)}")
    return completed.stdout.strip()


def git_head() -> str:
    value = git("rev-parse", "HEAD")
    if len(value) != 40:
        raise EvidenceError("Git HEAD is not a full SHA")
    return value


def assert_git_scope(*, require_clean: bool) -> None:
    root = Path(git("rev-parse", "--show-toplevel")).resolve()
    expected_here = root / "quant" / "research" / "vg7"
    if expected_here.resolve() != HERE.resolve():
        raise EvidenceError("V-G7 packet is not at the authorized repository path")
    if git("merge-base", "--is-ancestor", BASE_SHA, "HEAD"):
        raise EvidenceError("canonical base is not an ancestor")
    changed = tuple(
        line for line in git("diff", "--name-only", f"{BASE_SHA}..HEAD").splitlines() if line
    )
    if any(not path.startswith("quant/research/vg7/") for path in changed):
        raise EvidenceError("committed diff escapes V-G7 scope")
    if require_clean and git("status", "--porcelain=v1", "--untracked-files=all"):
        raise EvidenceError("worktree must be clean before sealed transition")


def runtime_binding() -> dict[str, object]:
    return {
        "pythonImplementation": sys.implementation.name,
        "pythonMajorMinor": f"{sys.version_info.major}.{sys.version_info.minor}",
        "pythonMicro": sys.version_info.micro,
        "decimalPrecision": getcontext().prec,
        "rng": "python_random_MT19937",
    }


def load_protocol() -> tuple[dict[str, Any], str]:
    if sys.implementation.name != "cpython" or sys.version_info[:2] != (3, 13):
        raise EvidenceError("sealed evaluator requires CPython 3.13")
    protocol, raw = load_json(PROTOCOL_PATH)
    required: dict[tuple[str, ...], object] = {
        ("schema",): "VG7VolumeClimaxExhaustionProtocolV1",
        ("protocolId",): "vg7-binance-spot-daily-volume-climax-exhaustion-reversal-v1",
        ("taskId",): "V-G7",
        ("canonicalBaseCommit",): BASE_SHA,
        ("artifacts", "resultSchema"): "VG7ResultV1",
        ("artifacts", "developmentMarkerSchema"): "VG7DevelopmentRunMarkerV1",
        ("artifacts", "holdoutMarkerSchema"): "VG7HoldoutOpenMarkerV1",
        ("calendar", "development", "startInclusive"): "2025-07-01",
        ("calendar", "development", "endExclusive"): "2026-04-01",
        ("calendar", "warmup", "startInclusive"): "2025-03-01",
        ("calendar", "sourceMonths", "first"): "2025-03",
        ("calendar", "holdout", "startInclusive"): "2026-04-01",
        ("calendar", "holdout", "endExclusive"): "2026-07-01",
        ("calendar", "holdout", "allowedOpenCount"): 1,
        ("calendar", "holdout", "causalWarmupDays"): 100,
        ("signal", "trials", "familySize"): 36,
        ("execution", "maxConcurrentPositions"): 3,
        ("gates", "development", "selectedRoundTripsMinimum"): 60,
        ("gates", "development", "signalEventsMinimum"): 60,
        ("gates", "development", "distinctSymbolsMinimum"): 8,
        ("gates", "development", "activeWeeksMinimum"): 20,
        ("gates", "development", "activeMonthsMinimum"): 6,
        ("gates", "holdout", "selectedRoundTripsMinimum"): 20,
        ("gates", "holdout", "signalEventsMinimum"): 20,
        ("gates", "holdout", "distinctSymbolsMinimum"): 4,
        ("gates", "holdout", "activeWeeksMinimum"): 8,
        ("gates", "holdout", "activeMonthsMinimum"): 3,
        ("signal", "eligibility", "consecutivePriorDailyBars"): 90,
        ("signal", "eligibility", "minimumPrior30dMedianQuoteVolumeUsd"): "10000000",
        ("signal", "fixedPivotRules", "freshLowLookbackDays"): 10,
        ("signal", "fixedPivotRules", "rangeMultipleMinimum"): "1.5",
        ("signal", "fixedPivotRules", "rangePriorMedianDays"): 20,
        ("signal", "fixedPivotRules", "volumePriorMedianDays"): 30,
        ("signal", "confirmation", "closeReturnMinimum"): "0.005",
        ("signal", "confirmation", "closeAbovePivotMidpoint"): True,
        ("signal", "confirmation", "greenClose"): True,
        ("signal", "confirmation", "lowAtOrAbovePivotLow"): True,
        ("signal", "clusterDaysPerSymbol"): 10,
        ("signal", "trials", "volumeMultiples"): ["2", "4", "8"],
        ("signal", "trials", "pivotReturnMaximums"): ["-0.03", "-0.05"],
        ("signal", "trials", "lowerWickFractions"): ["0.25", "0.40"],
        ("signal", "trials", "holdDays"): [3, 5, 7],
        ("capacity", "participationBps"): "1",
        ("statistics", "pbo", "purgeDaysAtAssignmentBoundary"): 7,
        ("statistics", "drawdown", "markingFrequency"): "UTC_DAILY_CLOSE",
        ("dataQuality", "warmupSemanticUnavailableSymbolMonthMaximum"): 1,
        ("trialLedger", "registeredFamilySize"): 36,
        ("trialLedger", "discardedOutcomeInspectedVariants"): 0,
        ("statistics", "bootstrap", "replicates"): 4096,
        ("statistics", "pbo", "partitions"): 8,
        ("statistics", "pbo", "splitCount"): 70,
        ("runControl", "archiveContentOpenRunsAllowed"): 1,
        ("runControl", "holdoutOpenRunsAllowed"): 1,
        ("runControl", "networkDuringEvaluation"): False,
        ("runControl", "repairOrRerunAfterContentOpen"): False,
        ("limitation",): LIMITATION,
    }
    for keys, expected in required.items():
        if nested(protocol, *keys) != expected:
            raise EvidenceError(f"protocol invariant changed: {'.'.join(keys)}")
    if len(build_trials(protocol)) != 36:
        raise EvidenceError("trial family does not contain exactly 36 unique trials")
    scenarios = build_scenarios(protocol)
    if tuple((item.name, item.fee_bps, item.adverse_bps, item.required) for item in scenarios) != (
        ("PUBLIC_FEE_ONLY", 10.0, 0.0, False),
        ("BASE", 10.0, 10.0, True),
        ("STRESS", 10.0, 25.0, True),
        ("FEE_STRESS", 20.0, 25.0, True),
        ("SEVERE_DIAGNOSTIC", 20.0, 50.0, False),
    ):
        raise EvidenceError("cost scenario grid changed")
    return protocol, sha256_bytes(raw)


def build_trials(protocol: Mapping[str, Any]) -> tuple[Trial, ...]:
    values = nested(protocol, "signal", "trials")
    if not isinstance(values, dict):
        raise EvidenceError("signal.trials malformed")
    volumes = [
        exact_float(item, field="volumeMultiple")
        for item in require_list(values["volumeMultiples"], field="volumeMultiples")
    ]
    returns = [
        exact_float(item, field="pivotReturnMaximum")
        for item in require_list(values["pivotReturnMaximums"], field="pivotReturnMaximums")
    ]
    wicks = [
        exact_float(item, field="lowerWickFraction")
        for item in require_list(values["lowerWickFractions"], field="lowerWickFractions")
    ]
    holds = [
        require_int(item, field="holdDays", minimum=1)
        for item in require_list(values["holdDays"], field="holdDays")
    ]
    trials: list[Trial] = []
    for volume, maximum, wick, hold in itertools.product(volumes, returns, wicks, holds):
        trial_id = (
            f"V{round(volume):02d}_"
            f"R{round(abs(maximum) * 100):02d}_"
            f"W{round(wick * 100):02d}_H{hold:02d}"
        )
        trials.append(Trial(trial_id, volume, maximum, wick, hold))
    if len({item.trial_id for item in trials}) != len(trials):
        raise EvidenceError("trial identifiers are not unique")
    return tuple(sorted(trials, key=lambda item: item.trial_id))


def build_scenarios(protocol: Mapping[str, Any]) -> tuple[CostScenario, ...]:
    raw = require_list(nested(protocol, "costs", "scenarios"), field="costs.scenarios")
    scenarios: list[CostScenario] = []
    for item in raw:
        if not isinstance(item, dict) or not isinstance(item.get("required"), bool):
            raise EvidenceError("cost scenario malformed")
        scenarios.append(
            CostScenario(
                require_text(item.get("name"), field="scenario.name"),
                exact_float(item.get("feeBpsPerFill"), field="feeBpsPerFill"),
                exact_float(
                    item.get("adverseExecutionBpsPerFill"),
                    field="adverseExecutionBpsPerFill",
                ),
                cast(bool, item["required"]),
            )
        )
    return tuple(scenarios)


def parse_sidecar(raw: bytes, expected_filename: str) -> str:
    try:
        tokens = raw.decode("ascii").strip().split()
    except UnicodeDecodeError as error:
        raise EvidenceError("publisher checksum sidecar is not ASCII") from error
    if len(tokens) != 2 or tokens[1].lstrip("*") != expected_filename:
        raise EvidenceError("publisher checksum sidecar filename contract failed")
    digest = tokens[0].lower()
    if len(digest) != 64 or any(char not in "0123456789abcdef" for char in digest):
        raise EvidenceError("publisher checksum sidecar digest malformed")
    return digest


def validate_discovery(discovery: Mapping[str, Any]) -> tuple[str, ...]:
    if discovery.get("schema") != "S1FArchiveDiscoveryV1":
        raise EvidenceError("discovery schema mismatch")
    if discovery.get("state") != "METADATA_ONLY_NO_ARCHIVE_BODY_OPENED":
        raise EvidenceError("discovery is not metadata-only")
    symbols_raw = require_list(nested(discovery, "universe", "symbols"), field="universe.symbols")
    if not all(isinstance(item, str) for item in symbols_raw):
        raise EvidenceError("discovery symbols malformed")
    symbols = tuple(cast(list[str], symbols_raw))
    if symbols != tuple(sorted(set(symbols))) or len(symbols) != 605:
        raise EvidenceError("discovery universe is not the frozen sorted 605-symbol set")
    digest = sha256_bytes(normalized_lines(symbols))
    if digest != EXPECTED_UNIVERSE_SHA or nested(discovery, "universe", "sha256") != digest:
        raise EvidenceError("discovery universe digest mismatch")
    return symbols


def acquisition_lookup(
    acquisition: Mapping[str, Any],
) -> tuple[dict[tuple[str, str], Mapping[str, Any]], set[tuple[str, str]]]:
    if acquisition.get("schema") != "S1FAcquisitionManifestV1":
        raise EvidenceError("acquisition schema mismatch")
    if acquisition.get("state") != "CHECKSUM_VERIFIED_ARCHIVES_NOT_DECOMPRESSED":
        raise EvidenceError("acquisition state mismatch")
    if acquisition.get("archiveBodiesDecompressed") is not False:
        raise EvidenceError("acquisition does not preserve unopened archive bodies")
    pairs: dict[tuple[str, str], Mapping[str, Any]] = {}
    for raw in require_list(acquisition.get("artifactPairs"), field="artifactPairs"):
        if not isinstance(raw, dict):
            raise EvidenceError("acquisition artifact pair malformed")
        symbol = require_text(raw.get("symbol"), field="artifact.symbol")
        month = require_text(raw.get("month"), field="artifact.month")
        key = (symbol, month)
        if key in pairs:
            raise EvidenceError("duplicate acquisition artifact pair")
        pairs[key] = cast(Mapping[str, Any], raw)
    absent: set[tuple[str, str]] = set()
    for raw in require_list(acquisition.get("absentSymbolMonths"), field="absentSymbolMonths"):
        text = require_text(raw, field="absentSymbolMonth")
        parts = text.split("|")
        if len(parts) != 2:
            raise EvidenceError("absence row malformed")
        absent.add((parts[0], parts[1]))
    if len(pairs) != require_int(acquisition.get("artifactPairCount"), field="artifactPairCount"):
        raise EvidenceError("acquisition artifact count mismatch")
    if len(absent) != require_int(
        acquisition.get("absentSymbolMonthCount"),
        field="absentSymbolMonthCount",
    ):
        raise EvidenceError("acquisition absence count mismatch")
    return pairs, absent


def freeze(state_root: Path) -> dict[str, Any]:
    assert_git_scope(require_clean=True)
    if any(path.exists() for path in (UNIVERSE_PATH, SOURCE_MANIFEST_PATH, FREEZE_PATH)):
        raise EvidenceError("freeze outputs already exist")
    protocol, protocol_sha = load_protocol()
    implementation_head = git_head()
    discovery_path = state_root / "discovery.v1.json"
    acquisition_path = state_root / "acquisition-manifest.v1.json"
    discovery, discovery_raw = load_json(discovery_path)
    acquisition, acquisition_raw = load_json(acquisition_path)
    if sha256_bytes(discovery_raw) != EXPECTED_DISCOVERY_SHA:
        raise EvidenceError("shared discovery bytes differ from audited source")
    if sha256_bytes(acquisition_raw) != EXPECTED_ACQUISITION_SHA:
        raise EvidenceError("shared acquisition bytes differ from audited source")
    symbols = validate_discovery(discovery)
    pairs, absent = acquisition_lookup(acquisition)
    if acquisition.get("discoverySha256") != EXPECTED_DISCOVERY_SHA:
        raise EvidenceError("acquisition does not bind the audited discovery")
    first_month = require_text(
        nested(protocol, "calendar", "sourceMonths", "first"),
        field="sourceMonths.first",
    )
    last_month = require_text(
        nested(protocol, "calendar", "sourceMonths", "last"),
        field="sourceMonths.last",
    )
    months = month_range(first_month, last_month)
    rows: list[dict[str, object]] = []
    present_count = 0
    absent_count = 0
    for symbol in symbols:
        for month in months:
            key = (symbol, month)
            raw = pairs.get(key)
            if raw is None:
                if key not in absent:
                    raise EvidenceError("selected symbol-month missing from acquisition coverage")
                rows.append({"month": month, "state": "ABSENT", "symbol": symbol})
                absent_count += 1
                continue
            filename = f"{symbol}-1d-{month}.zip"
            directory = state_root / "archives" / symbol / month
            zip_path = safe_file(directory / filename)
            sidecar_path = safe_file(directory / f"{filename}.CHECKSUM")
            zip_raw = zip_path.read_bytes()
            sidecar_raw = sidecar_path.read_bytes()
            zip_sha = sha256_bytes(zip_raw)
            sidecar_sha = sha256_bytes(sidecar_raw)
            expected_zip_sha = require_text(raw.get("zipSha256"), field="artifact.zipSha256")
            expected_sidecar_sha = require_text(
                raw.get("checksumSha256"),
                field="artifact.checksumSha256",
            )
            if zip_sha != expected_zip_sha or sidecar_sha != expected_sidecar_sha:
                raise EvidenceError("selected shared archive bytes changed")
            if parse_sidecar(sidecar_raw, filename) != zip_sha:
                raise EvidenceError("publisher checksum does not match selected archive")
            if len(zip_raw) != require_int(raw.get("zipBytes"), field="artifact.zipBytes"):
                raise EvidenceError("selected ZIP byte count mismatch")
            if len(sidecar_raw) != require_int(
                raw.get("checksumBytes"),
                field="artifact.checksumBytes",
            ):
                raise EvidenceError("selected sidecar byte count mismatch")
            rows.append(
                {
                    "checksumBytes": len(sidecar_raw),
                    "checksumKey": require_text(
                        raw.get("checksumKey"),
                        field="artifact.checksumKey",
                    ),
                    "checksumSha256": sidecar_sha,
                    "month": month,
                    "state": "PRESENT_PUBLISHER_SHA256_VERIFIED_COMPRESSED_NOT_OPENED",
                    "symbol": symbol,
                    "zipBytes": len(zip_raw),
                    "zipKey": require_text(raw.get("zipKey"), field="artifact.zipKey"),
                    "zipSha256": zip_sha,
                }
            )
            present_count += 1
    if len(rows) != len(symbols) * len(months):
        raise EvidenceError("source manifest coverage is not rectangular")
    universe: dict[str, object] = {
        "count": len(symbols),
        "discoverySha256": EXPECTED_DISCOVERY_SHA,
        "exclusions": nested(discovery, "exclusions"),
        "schema": "VG7UniverseV1",
        "selection": "FROZEN_DISCOVERY_UNIVERSE_POINT_IN_TIME_ELIGIBILITY_ONLY",
        "sha256": EXPECTED_UNIVERSE_SHA,
        "symbols": list(symbols),
    }
    universe_raw = canonical_bytes(universe)
    manifest: dict[str, object] = {
        "absentSymbolMonthCount": absent_count,
        "acquisitionManifestSha256": EXPECTED_ACQUISITION_SHA,
        "archiveBodiesOpened": False,
        "discoverySha256": EXPECTED_DISCOVERY_SHA,
        "presentSymbolMonthCount": present_count,
        "publisher": "BINANCE_DATA_VISION_SPOT_MONTHLY_KLINES_1D",
        "rows": rows,
        "schema": "VG7SourceManifestV1",
        "selectedMonths": list(months),
        "selectedRowCount": len(rows),
        "sharedInputMode": "READ_ONLY",
        "stateRoot": str(state_root.resolve()),
        "timestampUnit": "MICROSECONDS",
        "universeSha256": EXPECTED_UNIVERSE_SHA,
    }
    manifest_raw = canonical_bytes(manifest)
    freeze_payload: dict[str, object] = {
        "archiveBodiesOpened": False,
        "canonicalBaseCommit": BASE_SHA,
        "createdAtUtc": now_utc(),
        "implementationGitSha": implementation_head,
        "inputBindings": {
            "acquisitionManifestSha256": EXPECTED_ACQUISITION_SHA,
            "discoverySha256": EXPECTED_DISCOVERY_SHA,
            "sourceManifestSha256": sha256_bytes(manifest_raw),
            "universeFileSha256": sha256_bytes(universe_raw),
            "universeLogicalSha256": EXPECTED_UNIVERSE_SHA,
        },
        "packetBindings": {
            "dependencyLockSha256": sha256_path(UV_LOCK_PATH),
            "evaluatorSha256": sha256_path(Path(__file__).resolve()),
            "officialSourceResearchSha256": sha256_path(SOURCE_RESEARCH_PATH),
            "pyprojectSha256": sha256_path(PYPROJECT_PATH),
            "protocolSha256": protocol_sha,
            "readmeSha256": sha256_path(README_PATH),
            "testSha256": sha256_path(TEST_PATH),
            "verifierSha256": sha256_path(VERIFIER_PATH),
        },
        "protocolId": protocol["protocolId"],
        "runtime": runtime_binding(),
        "schema": "VG7FreezeV1",
        "state": "FROZEN_COMPRESSED_INPUTS_CHECKSUM_VERIFIED_NO_MEMBER_OPENED",
        "taskId": "V-G7",
        "trialCount": len(build_trials(protocol)),
    }
    exclusive_write(UNIVERSE_PATH, universe_raw)
    exclusive_write(SOURCE_MANIFEST_PATH, manifest_raw)
    exclusive_write(FREEZE_PATH, canonical_bytes(freeze_payload))
    return freeze_payload


def _timestamp_to_day(value: int) -> date:
    if value < 1_000_000_000_000_000:
        raise ArchiveSemanticError("POST_2025_TIMESTAMP_NOT_MICROSECONDS")
    seconds, micros = divmod(value, 1_000_000)
    try:
        parsed = datetime.fromtimestamp(seconds, tz=UTC).replace(microsecond=micros)
    except (OverflowError, OSError, ValueError) as error:
        raise ArchiveSemanticError("TIMESTAMP_OUTSIDE_UTC_RANGE") from error
    if parsed.time() != datetime.min.time():
        raise ArchiveSemanticError("DAILY_OPEN_NOT_MIDNIGHT_UTC")
    return parsed.date()


def _csv_float(value: str, *, field: str, positive: bool = False) -> float:
    try:
        parsed = D(value)
    except InvalidOperation as error:
        raise ArchiveSemanticError(f"{field.upper().replace(' ', '_')}_NOT_DECIMAL") from error
    if not parsed.is_finite() or (positive and parsed <= 0) or (not positive and parsed < 0):
        raise ArchiveSemanticError(f"{field.upper().replace(' ', '_')}_OUTSIDE_RANGE")
    result = float(parsed)
    if not math.isfinite(result):
        raise ArchiveSemanticError(f"{field.upper().replace(' ', '_')}_EXCEEDS_FLOAT_RANGE")
    return result


def parse_archive(
    path: Path,
    *,
    symbol: str,
    month: str,
    expected_sha: str,
) -> tuple[Bar, ...]:
    raw = safe_file(path).read_bytes()
    if sha256_bytes(raw) != expected_sha:
        raise EvidenceError("shared archive digest changed after freeze")
    try:
        archive = zipfile.ZipFile(io.BytesIO(raw))
    except zipfile.BadZipFile as error:
        raise ArchiveSemanticError("INVALID_ZIP") from error
    with archive:
        members = archive.infolist()
        expected_name = f"{symbol}-1d-{month}.csv"
        if len(members) != 1 or members[0].filename != expected_name:
            raise ArchiveSemanticError("ZIP_MEMBER_CONTRACT_MISMATCH")
        member = members[0]
        if member.is_dir() or member.file_size > 2_000_000:
            raise ArchiveSemanticError("ZIP_MEMBER_SIZE_OR_TYPE_REJECTED")
        csv_raw = archive.read(member)
    try:
        text = csv_raw.decode("utf-8")
    except UnicodeDecodeError as error:
        raise ArchiveSemanticError("CSV_NOT_UTF8") from error
    bars: list[Bar] = []
    previous: date | None = None
    for row_index, row in enumerate(csv.reader(io.StringIO(text, newline=""))):
        if row_index == 0 and row and row[0].strip().lower() in {"open_time", "opentime"}:
            continue
        if len(row) != 12:
            raise ArchiveSemanticError("KLINE_COLUMN_COUNT_NOT_12")
        try:
            opened_raw = int(row[0])
            closed_raw = int(row[6])
            trade_count = int(row[8])
        except ValueError as error:
            raise ArchiveSemanticError("INTEGER_FIELD_MALFORMED") from error
        day = _timestamp_to_day(opened_raw)
        if day.strftime("%Y-%m") != month:
            raise ArchiveSemanticError("ROW_MONTH_MISMATCH")
        if closed_raw - opened_raw != DAY_US - 1:
            raise ArchiveSemanticError("DAILY_CLOSE_BOUNDARY_INVALID")
        opened = _csv_float(row[1], field="open", positive=True)
        high = _csv_float(row[2], field="high", positive=True)
        low = _csv_float(row[3], field="low", positive=True)
        close = _csv_float(row[4], field="close", positive=True)
        quote_volume = _csv_float(row[7], field="quote volume")
        if low > min(opened, close) or high < max(opened, close) or low > high:
            raise ArchiveSemanticError("OHLC_GEOMETRY_INVALID")
        if trade_count < 0:
            raise ArchiveSemanticError("TRADE_COUNT_NEGATIVE")
        if previous is not None and day <= previous:
            raise ArchiveSemanticError("DAYS_NOT_STRICTLY_INCREASING")
        previous = day
        bars.append(Bar(day, opened, high, low, close, quote_volume, trade_count))
    if not bars:
        raise ArchiveSemanticError("ARCHIVE_CONTAINS_NO_BARS")
    return tuple(bars)


def load_source_manifest() -> tuple[dict[str, Any], str]:
    manifest, raw = load_json(SOURCE_MANIFEST_PATH)
    if manifest.get("schema") != "VG7SourceManifestV1":
        raise EvidenceError("V-G7 source manifest schema mismatch")
    if manifest.get("archiveBodiesOpened") is not False:
        raise EvidenceError("source manifest does not preserve pre-open state")
    rows = require_list(manifest.get("rows"), field="sourceManifest.rows")
    if len(rows) != require_int(manifest.get("selectedRowCount"), field="selectedRowCount"):
        raise EvidenceError("source manifest row count mismatch")
    return manifest, sha256_bytes(raw)


def load_bars(
    state_root: Path,
    manifest: Mapping[str, Any],
    months: set[str],
) -> tuple[dict[str, dict[date, Bar]], tuple[str, ...]]:
    result: dict[str, dict[date, Bar]] = {}
    semantic_unavailable: list[str] = []
    rows = require_list(manifest.get("rows"), field="sourceManifest.rows")
    for raw in rows:
        if not isinstance(raw, dict):
            raise EvidenceError("source manifest row malformed")
        month = require_text(raw.get("month"), field="source.month")
        if month not in months or raw.get("state") == "ABSENT":
            continue
        if raw.get("state") != "PRESENT_PUBLISHER_SHA256_VERIFIED_COMPRESSED_NOT_OPENED":
            raise EvidenceError("source manifest present-state mismatch")
        symbol = require_text(raw.get("symbol"), field="source.symbol")
        filename = f"{symbol}-1d-{month}.zip"
        path = state_root / "archives" / symbol / month / filename
        expected_sha = require_text(raw.get("zipSha256"), field="source.zipSha256")
        symbol_bars = result.setdefault(symbol, {})
        try:
            parsed = parse_archive(
                path,
                symbol=symbol,
                month=month,
                expected_sha=expected_sha,
            )
        except ArchiveSemanticError as error:
            semantic_unavailable.append(f"{symbol}|{month}|{error}")
            continue
        for bar in parsed:
            if bar.day in symbol_bars:
                raise EvidenceError("duplicate daily bar across selected archives")
            symbol_bars[bar.day] = bar
    return result, tuple(sorted(semantic_unavailable))


def consecutive_prior_days(
    ordered: Sequence[Bar],
    index: int,
    count: int,
) -> bool:
    if index < count:
        return False
    return ordered[index - count].day == ordered[index].day - timedelta(days=count)


def signal_bases(
    bars_by_symbol: Mapping[str, Mapping[date, Bar]],
    *,
    partition_start: date,
    partition_end: date,
) -> tuple[Signal, ...]:
    signals: list[Signal] = []
    for symbol in sorted(bars_by_symbol):
        mapping = bars_by_symbol[symbol]
        ordered = sorted(mapping.values(), key=lambda bar: bar.day)
        for index, pivot in enumerate(ordered):
            entry_day = pivot.day + timedelta(days=2)
            if entry_day < partition_start or entry_day >= partition_end:
                continue
            if not consecutive_prior_days(ordered, index, 90):
                continue
            previous = ordered[index - 1]
            prior_30 = ordered[index - 30 : index]
            prior_10 = ordered[index - 10 : index]
            median_quote = statistics.median(bar.quote_volume for bar in prior_30)
            if median_quote < 10_000_000 or median_quote <= 0:
                continue
            pivot_return = pivot.close / previous.close - 1
            if pivot_return > -0.03 or pivot.low >= min(bar.low for bar in prior_10):
                continue
            ranges: list[float] = []
            for prior_index in range(index - 20, index):
                prior_bar = ordered[prior_index]
                prior_close = ordered[prior_index - 1].close
                ranges.append((prior_bar.high - prior_bar.low) / prior_close)
            median_range = statistics.median(ranges)
            pivot_range = pivot.high - pivot.low
            if (
                median_range <= 0
                or pivot_range <= 0
                or pivot_range / previous.close < 1.5 * median_range
            ):
                continue
            lower_wick = (min(pivot.open, pivot.close) - pivot.low) / pivot_range
            volume_multiple = pivot.quote_volume / median_quote
            if lower_wick < 0.25 or volume_multiple < 2:
                continue
            confirmation = mapping.get(pivot.day + timedelta(days=1))
            if confirmation is None:
                raise EvidenceError(
                    "MINIMUM_PIVOT_HAS_NO_CONFIRMATION_BAR_"
                    f"{symbol}_{(pivot.day + timedelta(days=1)).isoformat()}"
                )
            midpoint = (pivot.high + pivot.low) / 2
            confirmation_return = confirmation.close / pivot.close - 1
            if not (
                confirmation.low >= pivot.low
                and confirmation.close > confirmation.open
                and confirmation.close > midpoint
                and confirmation_return >= 0.005
            ):
                continue
            if mapping.get(entry_day) is None:
                raise EvidenceError(
                    f"CONFIRMED_SIGNAL_HAS_NO_ENTRY_REFERENCE_BAR_{symbol}_{entry_day.isoformat()}"
                )
            signals.append(
                Signal(
                    symbol,
                    pivot.day,
                    entry_day,
                    pivot_return,
                    volume_multiple,
                    lower_wick,
                )
            )
    return tuple(
        sorted(
            signals,
            key=lambda item: (item.entry_day, item.symbol, item.pivot_day),
        )
    )


def percentile(sorted_values: Sequence[float], probability: float) -> float:
    if not sorted_values:
        raise EvidenceError("cannot calculate percentile of empty values")
    if probability <= 0:
        return sorted_values[0]
    if probability >= 1:
        return sorted_values[-1]
    position = (len(sorted_values) - 1) * probability
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return sorted_values[lower]
    weight = position - lower
    return sorted_values[lower] * (1 - weight) + sorted_values[upper] * weight


def prior_median_quote(
    mapping: Mapping[date, Bar],
    day: date,
    days: int = 30,
) -> float | None:
    values: list[float] = []
    for offset in range(1, days + 1):
        bar = mapping.get(day - timedelta(days=offset))
        if bar is None:
            return None
        values.append(bar.quote_volume)
    return statistics.median(values)


def max_drawdown_pct(equity: Sequence[float]) -> float:
    if not equity:
        raise EvidenceError("empty equity curve")
    peak = equity[0]
    worst = 0.0
    for value in equity:
        peak = max(peak, value)
        if peak > 0:
            worst = max(worst, (peak - value) / peak * 100)
    return worst


def evaluate_trial(
    *,
    trial: Trial,
    scenario: CostScenario,
    bases: Sequence[Signal],
    bars_by_symbol: Mapping[str, Mapping[date, Bar]],
    partition_start: date,
    partition_end: date,
) -> RunMetrics:
    thresholded = [
        item
        for item in bases
        if item.volume_multiple >= trial.volume_multiple
        and item.pivot_return <= trial.pivot_return_maximum
        and item.lower_wick_fraction >= trial.lower_wick_fraction
    ]
    clustered: list[Signal] = []
    last_pivot: dict[str, date] = {}
    for item in thresholded:
        previous = last_pivot.get(item.symbol)
        if previous is not None and (item.pivot_day - previous).days < 10:
            continue
        clustered.append(item)
        last_pivot[item.symbol] = item.pivot_day
    executable: list[Signal] = []
    suppressed_boundary = 0
    for item in clustered:
        exit_day = item.entry_day + timedelta(days=trial.hold_days)
        if exit_day >= partition_end:
            suppressed_boundary += 1
            continue
        mapping = bars_by_symbol[item.symbol]
        for required_day in (
            item.entry_day + timedelta(days=offset) for offset in range(trial.hold_days + 1)
        ):
            if mapping.get(required_day) is None:
                raise EvidenceError(
                    "CLUSTERED_OPPORTUNITY_REQUIRED_BAR_UNAVAILABLE_"
                    f"{item.symbol}_{required_day.isoformat()}"
                )
        executable.append(item)
    grouped: dict[date, list[Signal]] = {}
    for item in executable:
        grouped.setdefault(item.entry_day, []).append(item)
    for values in grouped.values():
        values.sort(
            key=lambda item: (
                -item.volume_multiple,
                item.pivot_return,
                -item.lower_wick_fraction,
                item.symbol,
            )
        )
    fee = scenario.fee_bps / 10_000
    adverse = scenario.adverse_bps / 10_000
    sleeve_count = 3
    sleeve_cash = [1_000.0 / sleeve_count for _ in range(sleeve_count)]
    positions: list[Position | None] = [None] * sleeve_count
    selected_symbols: set[str] = set()
    entry_days: list[date] = []
    capacity_values: list[float] = []
    conflict_count = 0
    equity_values: list[float] = []
    daily_returns: list[float] = []
    prior_equity = 1_000.0
    round_trips = 0
    for day in daterange(partition_start, partition_end):
        for sleeve_index, position in enumerate(positions):
            if position is None:
                continue
            mapping = bars_by_symbol[position.signal.symbol]
            current_bar = mapping.get(day)
            if current_bar is None:
                raise EvidenceError(
                    "OPEN_POSITION_REQUIRED_BAR_UNAVAILABLE_"
                    f"{position.signal.symbol}_{day.isoformat()}"
                )
            if day == position.exit_day:
                exit_reference = current_bar.open
                exit_fill = exit_reference * (1 - adverse)
                sleeve_cash[sleeve_index] = position.quantity * exit_fill * (1 - fee)
                exit_median = prior_median_quote(mapping, day)
                if exit_median is None:
                    raise EvidenceError("EXIT_CAPACITY_LAG_UNAVAILABLE")
                entry_reference_notional = position.quantity * position.entry_reference
                exit_reference_notional = position.quantity * exit_reference
                if entry_reference_notional <= 0 or exit_reference_notional <= 0:
                    raise EvidenceError("REFERENCE_NOTIONAL_NONPOSITIVE")
                supported_entry = position.entry_capacity_usdt * 1_000 / entry_reference_notional
                supported_exit = 0.0001 * exit_median * 1_000 / exit_reference_notional
                capacity_values.append(min(supported_entry, supported_exit))
                round_trips += 1
                positions[sleeve_index] = None
        candidates = grouped.get(day, [])
        if candidates:
            free_sleeves = [index for index, position in enumerate(positions) if position is None]
            selected = candidates[: len(free_sleeves)]
            conflict_count += len(candidates) - len(selected)
            for signal, sleeve_index in zip(selected, free_sleeves[: len(selected)], strict=True):
                mapping = bars_by_symbol[signal.symbol]
                entry_bar = mapping.get(day)
                if entry_bar is None:
                    raise EvidenceError(
                        f"CONFIRMED_SIGNAL_ENTRY_BAR_UNAVAILABLE_{signal.symbol}_{day.isoformat()}"
                    )
                entry_reference = entry_bar.open
                entry_fill = entry_reference * (1 + adverse)
                entry_equity = sleeve_cash[sleeve_index]
                quantity = entry_equity / (entry_fill * (1 + fee))
                exit_day = day + timedelta(days=trial.hold_days)
                entry_median = prior_median_quote(mapping, day)
                if entry_median is None:
                    raise EvidenceError("ENTRY_CAPACITY_LAG_UNAVAILABLE")
                positions[sleeve_index] = Position(
                    signal,
                    exit_day,
                    quantity,
                    entry_reference,
                    entry_fill,
                    entry_equity,
                    0.0001 * entry_median,
                )
                selected_symbols.add(signal.symbol)
                entry_days.append(day)
                sleeve_cash[sleeve_index] = 0.0
        equity = 0.0
        for sleeve_index, position in enumerate(positions):
            if position is None:
                equity += sleeve_cash[sleeve_index]
                continue
            current_bar = bars_by_symbol[position.signal.symbol].get(day)
            if current_bar is None:
                raise EvidenceError(
                    "OPEN_POSITION_DAILY_CLOSE_MARK_UNAVAILABLE_"
                    f"{position.signal.symbol}_{day.isoformat()}"
                )
            equity += position.quantity * current_bar.close * (1 - adverse) * (1 - fee)
        if equity <= 0 or not math.isfinite(equity):
            raise EvidenceError("portfolio equity became nonpositive or non-finite")
        daily_returns.append(equity / prior_equity - 1)
        equity_values.append(equity)
        prior_equity = equity
    if any(position is not None for position in positions):
        raise EvidenceError("partition ended with an open position")
    capacities = sorted(capacity_values)
    end_cash = sum(sleeve_cash)
    return RunMetrics(
        signal_events=len(thresholded),
        clustered_events=len(clustered),
        executable_opportunities=len(executable),
        suppressed_partition_boundary=suppressed_boundary,
        rejected_portfolio_conflict=conflict_count,
        round_trips=round_trips,
        fills=round_trips * 2,
        distinct_symbols=tuple(sorted(selected_symbols)),
        active_weeks=len({day.isocalendar()[:2] for day in entry_days}),
        active_months=len({(day.year, day.month) for day in entry_days}),
        start_usd=1_000.0,
        end_usd=end_cash,
        net_per_initial_1000_usd=end_cash - 1_000.0,
        max_daily_close_marked_drawdown_pct=max_drawdown_pct((1_000.0, *equity_values)),
        supported_initial_capital_min_usdt=capacities[0] if capacities else None,
        supported_initial_capital_p05_usdt=(percentile(capacities, 0.05) if capacities else None),
        supported_initial_capital_median_usdt=(percentile(capacities, 0.5) if capacities else None),
        daily_returns=tuple(daily_returns),
    )


def circular_bootstrap(
    returns: Sequence[float],
    *,
    replicates: int,
    block_length: int,
    seed: int,
) -> dict[str, object]:
    if not returns:
        raise EvidenceError("bootstrap input is empty")
    if any(value <= -1 or not math.isfinite(value) for value in returns):
        raise EvidenceError("bootstrap input contains invalid return")
    log_returns = tuple(math.log1p(value) for value in returns)
    observed_log_mean = statistics.fmean(log_returns)
    rng = random.Random(seed)
    nets: list[float] = []
    null_exceedances = 0
    n = len(returns)
    for _ in range(replicates):
        selected: list[float] = []
        while len(selected) < n:
            start = rng.randrange(n)
            take = min(block_length, n - len(selected))
            selected.extend(returns[(start + offset) % n] for offset in range(take))
        multiplier = math.prod(1 + value for value in selected)
        nets.append(1_000 * (multiplier - 1))
        centered_log_mean = statistics.fmean(
            math.log1p(value) - observed_log_mean for value in selected
        )
        if centered_log_mean >= observed_log_mean:
            null_exceedances += 1
    nets.sort()
    return {
        "blockLengthDays": block_length,
        "confidenceIntervalNetPer1000Usd": {
            "lower95": number_text(percentile(nets, 0.025)),
            "upper95": number_text(percentile(nets, 0.975)),
        },
        "oneSidedLower05NetPer1000Usd": number_text(percentile(nets, 0.05)),
        "oneSidedCenteredPValue": number_text((null_exceedances + 1) / (replicates + 1)),
        "oneSidedTestStatistic": "MEAN_DAILY_LOG_GROWTH",
        "replicates": replicates,
        "seed": seed,
    }


def holm_adjusted(p_values: Mapping[str, float], alpha: float) -> dict[str, dict[str, object]]:
    ordered = sorted(p_values.items(), key=lambda item: (item[1], item[0]))
    adjusted_so_far = 0.0
    rejection_open = True
    result: dict[str, dict[str, object]] = {}
    family_size = len(ordered)
    for index, (trial_id, p_value) in enumerate(ordered):
        multiplier = family_size - index
        adjusted_so_far = max(adjusted_so_far, min(1.0, p_value * multiplier))
        threshold = alpha / multiplier
        reject = rejection_open and p_value <= threshold
        if not reject:
            rejection_open = False
        result[trial_id] = {
            "adjustedPValue": number_text(adjusted_so_far),
            "rawPValue": number_text(p_value),
            "rejectAtFamilyWiseAlpha": reject,
            "stepThreshold": number_text(threshold),
        }
    return result


def contiguous_blocks(length: int, count: int) -> tuple[tuple[int, ...], ...]:
    if length < count:
        raise EvidenceError("PBO series shorter than partition count")
    blocks: list[tuple[int, ...]] = []
    for block in range(count):
        start = math.floor(block * length / count)
        end = math.floor((block + 1) * length / count)
        blocks.append(tuple(range(start, end)))
    return tuple(blocks)


def calculate_pbo(series: Mapping[str, Sequence[float]]) -> dict[str, object]:
    if len(series) != 36:
        raise EvidenceError("PBO requires all 36 registered candidates")
    lengths = {len(values) for values in series.values()}
    if len(lengths) != 1:
        raise EvidenceError("PBO candidate series are not aligned")
    length = lengths.pop()
    blocks = contiguous_blocks(length, 8)
    failures = 0
    split_count = 0
    degradations: list[float] = []
    valid_in_counts: list[int] = []
    valid_out_counts: list[int] = []
    trial_ids = tuple(sorted(series))
    for in_sample_blocks in itertools.combinations(range(8), 4):
        in_set = set(in_sample_blocks)
        assignment = [False] * length
        for block_index, block in enumerate(blocks):
            for index in block:
                assignment[index] = block_index in in_set
        valid_indices = tuple(
            index
            for index, is_in_sample in enumerate(assignment)
            if all(
                assignment[other] == is_in_sample
                for other in range(max(0, index - 7), min(length, index + 8))
            )
        )
        in_indices = tuple(index for index in valid_indices if assignment[index])
        out_indices = tuple(index for index in valid_indices if not assignment[index])
        if not in_indices or not out_indices:
            raise EvidenceError("PBO_PURGE_LEFT_EMPTY_SPLIT")
        valid_in_counts.append(len(in_indices))
        valid_out_counts.append(len(out_indices))
        in_scores = {
            trial_id: math.prod(1 + series[trial_id][index] for index in in_indices) - 1
            for trial_id in trial_ids
        }
        winner = min(trial_ids, key=lambda item: (-in_scores[item], item))
        out_scores = {
            trial_id: math.prod(1 + series[trial_id][index] for index in out_indices) - 1
            for trial_id in trial_ids
        }
        median_out = statistics.median(out_scores.values())
        if out_scores[winner] <= median_out:
            failures += 1
        in_log_growth = statistics.fmean(math.log1p(series[winner][index]) for index in in_indices)
        out_log_growth = statistics.fmean(
            math.log1p(series[winner][index]) for index in out_indices
        )
        degradations.append(out_log_growth - in_log_growth)
        split_count += 1
    if split_count != 70:
        raise EvidenceError("PBO did not produce the frozen 70 splits")
    return {
        "developmentOnly": True,
        "diagnosticOnly": True,
        "failureSplitCount": failures,
        "meanWinnerPerformanceDegradationDailyLogGrowth": number_text(
            statistics.fmean(degradations)
        ),
        "minimumPurgedInSampleDayCount": min(valid_in_counts),
        "minimumPurgedOutOfSampleDayCount": min(valid_out_counts),
        "partitions": 8,
        "pbo": number_text(failures / split_count),
        "purgeDaysAtAssignmentBoundary": 7,
        "splitCount": split_count,
        "diagnosticConcernThreshold": "0.5",
    }


def development_gate_status(
    *,
    metrics: RunMetrics,
    bootstrap: Mapping[str, Any],
    holm: Mapping[str, object],
    scenario_metrics: Mapping[str, RunMetrics],
) -> dict[str, bool]:
    capacity = metrics.supported_initial_capital_p05_usdt
    return {
        "activeMonths": metrics.active_months >= 6,
        "activeWeeks": metrics.active_weeks >= 20,
        "bootstrapLowerPositive": float(
            require_text(
                bootstrap.get("oneSidedLower05NetPer1000Usd"),
                field="bootstrap.lower",
            )
        )
        > 0,
        "capacityProxyP05": capacity is not None and capacity >= 1_000,
        "distinctSymbols": len(metrics.distinct_symbols) >= 8,
        "drawdown": metrics.max_daily_close_marked_drawdown_pct <= 20,
        "holm": holm.get("rejectAtFamilyWiseAlpha") is True,
        "requiredCostScenariosPositive": all(
            item.net_per_initial_1000_usd > 0
            for name, item in scenario_metrics.items()
            if name in {"BASE", "STRESS", "FEE_STRESS"}
        ),
        "roundTrips": metrics.round_trips >= 60,
        "signalEvents": metrics.signal_events >= 60,
    }


def holdout_gate_status(
    *,
    metrics: RunMetrics,
    bootstrap: Mapping[str, Any],
    scenario_metrics: Mapping[str, RunMetrics],
) -> dict[str, bool]:
    capacity = metrics.supported_initial_capital_p05_usdt
    return {
        "activeMonths": metrics.active_months >= 3,
        "activeWeeks": metrics.active_weeks >= 8,
        "bootstrapLowerPositive": float(
            require_text(
                bootstrap.get("oneSidedLower05NetPer1000Usd"),
                field="bootstrap.lower",
            )
        )
        > 0,
        "capacityProxyP05": capacity is not None and capacity >= 1_000,
        "distinctSymbols": len(metrics.distinct_symbols) >= 4,
        "drawdown": metrics.max_daily_close_marked_drawdown_pct <= 20,
        "requiredCostScenariosPositive": all(
            item.net_per_initial_1000_usd > 0
            for name, item in scenario_metrics.items()
            if name in {"BASE", "STRESS", "FEE_STRESS"}
        ),
        "roundTrips": metrics.round_trips >= 20,
        "signalEvents": metrics.signal_events >= 20,
    }


def all_passed(gates: Mapping[str, bool]) -> bool:
    return bool(gates) and all(gates.values())


def load_freeze() -> tuple[dict[str, Any], str]:
    freeze_payload, raw = load_json(FREEZE_PATH)
    if freeze_payload.get("schema") != "VG7FreezeV1":
        raise EvidenceError("freeze schema mismatch")
    if freeze_payload.get("state") != "FROZEN_COMPRESSED_INPUTS_CHECKSUM_VERIFIED_NO_MEMBER_OPENED":
        raise EvidenceError("freeze state mismatch")
    if freeze_payload.get("archiveBodiesOpened") is not False:
        raise EvidenceError("freeze does not prove unopened inputs")
    protocol, protocol_sha = load_protocol()
    if nested(freeze_payload, "packetBindings", "protocolSha256") != protocol_sha:
        raise EvidenceError("freeze protocol binding changed")
    if nested(freeze_payload, "packetBindings", "evaluatorSha256") != sha256_path(
        Path(__file__).resolve()
    ):
        raise EvidenceError("freeze evaluator binding changed")
    if nested(freeze_payload, "packetBindings", "officialSourceResearchSha256") != sha256_path(
        SOURCE_RESEARCH_PATH
    ):
        raise EvidenceError("freeze official-source binding changed")
    for path, key in (
        (README_PATH, "readmeSha256"),
        (TEST_PATH, "testSha256"),
        (VERIFIER_PATH, "verifierSha256"),
        (PYPROJECT_PATH, "pyprojectSha256"),
        (UV_LOCK_PATH, "dependencyLockSha256"),
    ):
        if nested(freeze_payload, "packetBindings", key) != sha256_path(path):
            raise EvidenceError(f"freeze packet binding changed: {path.name}")
    if freeze_payload.get("protocolId") != protocol["protocolId"]:
        raise EvidenceError("freeze protocol id mismatch")
    if freeze_payload.get("runtime") != runtime_binding():
        raise EvidenceError("freeze runtime binding changed")
    _, source_sha = load_source_manifest()
    if nested(freeze_payload, "inputBindings", "sourceManifestSha256") != source_sha:
        raise EvidenceError("freeze source manifest binding changed")
    if nested(freeze_payload, "inputBindings", "universeFileSha256") != sha256_path(UNIVERSE_PATH):
        raise EvidenceError("freeze universe file binding changed")
    return freeze_payload, sha256_bytes(raw)


def marker_payload(
    *,
    schema: str,
    state: str,
    freeze_sha: str,
    pre_run_sha: str,
) -> dict[str, object]:
    return {
        "attempt": 1,
        "createdAtUtc": now_utc(),
        "freezeSha256": freeze_sha,
        "preRunGitSha": pre_run_sha,
        "schema": schema,
        "state": state,
        "taskId": "V-G7",
    }


def scenario_table(
    scenario_metrics: Mapping[str, RunMetrics],
    scenarios: Sequence[CostScenario],
) -> dict[str, object]:
    result: dict[str, object] = {}
    for scenario in scenarios:
        result[scenario.name] = {
            "adverseExecutionBpsPerFill": number_text(scenario.adverse_bps),
            "allInBpsPerFill": number_text(scenario.all_in_bps_per_fill),
            "feeBpsPerFill": number_text(scenario.fee_bps),
            "metrics": scenario_metrics[scenario.name].summary(),
            "required": scenario.required,
        }
    return result


def evaluate_family(
    *,
    protocol: Mapping[str, Any],
    bars: Mapping[str, Mapping[date, Bar]],
    start: date,
    end: date,
) -> tuple[
    list[dict[str, object]],
    dict[str, Mapping[str, RunMetrics]],
    dict[str, object],
]:
    trials = build_trials(protocol)
    scenarios = build_scenarios(protocol)
    primary_name = require_text(
        nested(protocol, "costs", "primaryRequiredScenario"),
        field="primaryRequiredScenario",
    )
    bases = signal_bases(bars, partition_start=start, partition_end=end)
    metrics_by_trial: dict[str, dict[str, RunMetrics]] = {}
    bootstrap_by_trial: dict[str, dict[str, object]] = {}
    p_values: dict[str, float] = {}
    primary_series: dict[str, Sequence[float]] = {}
    replicates = require_int(
        nested(protocol, "statistics", "bootstrap", "replicates"),
        field="bootstrap.replicates",
    )
    block_length = require_int(
        nested(protocol, "statistics", "bootstrap", "blockLengthDays"),
        field="bootstrap.blockLengthDays",
    )
    seed = require_int(
        nested(protocol, "statistics", "bootstrap", "seed"),
        field="bootstrap.seed",
    )
    for trial_index, trial in enumerate(trials):
        scenario_runs = {
            scenario.name: evaluate_trial(
                trial=trial,
                scenario=scenario,
                bases=bases,
                bars_by_symbol=bars,
                partition_start=start,
                partition_end=end,
            )
            for scenario in scenarios
        }
        metrics_by_trial[trial.trial_id] = scenario_runs
        primary = scenario_runs[primary_name]
        primary_series[trial.trial_id] = primary.daily_returns
        bootstrap = circular_bootstrap(
            primary.daily_returns,
            replicates=replicates,
            block_length=block_length,
            seed=seed + trial_index,
        )
        bootstrap_by_trial[trial.trial_id] = bootstrap
        p_values[trial.trial_id] = float(
            require_text(
                bootstrap.get("oneSidedCenteredPValue"),
                field="bootstrap.pValue",
            )
        )
    pbo = calculate_pbo(primary_series)
    holm = holm_adjusted(
        p_values,
        exact_float(nested(protocol, "statistics", "holm", "alpha"), field="holm.alpha"),
    )
    records: list[dict[str, object]] = []
    for trial in trials:
        scenarios_for_trial = metrics_by_trial[trial.trial_id]
        primary = scenarios_for_trial[primary_name]
        gates = development_gate_status(
            metrics=primary,
            bootstrap=bootstrap_by_trial[trial.trial_id],
            holm=holm[trial.trial_id],
            scenario_metrics=scenarios_for_trial,
        )
        records.append(
            {
                "bootstrap": bootstrap_by_trial[trial.trial_id],
                "developmentEligible": all_passed(gates),
                "gates": gates,
                "holm": holm[trial.trial_id],
                "parameters": trial.as_mapping(),
                "primaryScenario": primary_name,
                "scenarios": scenario_table(scenarios_for_trial, scenarios),
                "trialId": trial.trial_id,
            }
        )
    return records, cast(dict[str, Mapping[str, RunMetrics]], metrics_by_trial), pbo


def trial_from_id(protocol: Mapping[str, Any], trial_id: str) -> Trial:
    matches = [item for item in build_trials(protocol) if item.trial_id == trial_id]
    if len(matches) != 1:
        raise EvidenceError("sealed candidate trial id not in registered family")
    return matches[0]


def record_metric(record: Mapping[str, Any], scenario: str, field: str) -> float:
    value = nested(record, "scenarios", scenario, "metrics", field)
    return float(require_text(value, field=field))


def seal_outputs(
    *,
    result: Mapping[str, object],
    verdict_markdown: str,
    proposed_row: str,
) -> None:
    exclusive_write(RESULT_PATH, canonical_bytes(result))
    exclusive_write(VERDICT_PATH, verdict_markdown.encode())
    exclusive_write(ROW_PATH, proposed_row.encode())
    filenames = sorted(
        path.name
        for path in HERE.iterdir()
        if path.is_file() and not path.is_symlink() and path.name != CHECKSUMS_PATH.name
    )
    checksum_lines = [f"{sha256_path(HERE / name)}  {name}" for name in filenames]
    exclusive_write(CHECKSUMS_PATH, normalized_lines(checksum_lines))


def verdict_document(result: Mapping[str, Any]) -> str:
    verdict = require_text(result.get("verdict"), field="verdict")
    reason = require_text(result.get("reason"), field="reason")
    best = nested(result, "development", "bestByFrozenMetric")
    if not isinstance(best, dict):
        raise EvidenceError("result best development record malformed")
    primary = nested(best, "primaryMetrics")
    if not isinstance(primary, dict):
        raise EvidenceError("result primary metrics malformed")
    holdout = nested(result, "holdout")
    if not isinstance(holdout, dict):
        raise EvidenceError("result holdout malformed")
    bootstrap = best.get("bootstrap")
    development_interval = (
        nested(
            bootstrap,
            "confidenceIntervalNetPer1000Usd",
        )
        if isinstance(bootstrap, dict)
        else None
    )
    holdout_metrics = holdout.get("metrics")
    holdout_bootstrap = holdout.get("bootstrap")
    holdout_interval = (
        nested(
            holdout_bootstrap,
            "confidenceIntervalNetPer1000Usd",
        )
        if isinstance(holdout_bootstrap, dict)
        else None
    )
    holdout_detail = (
        f"net / $1,000 `{holdout_metrics.get('netPerInitial1000Usd')}`; "
        f"round trips/fills `{holdout_metrics.get('selectedRoundTrips')}`/"
        f"`{holdout_metrics.get('fills')}`; 95% interval `{holdout_interval}`; "
        "daily-close marked drawdown "
        f"`{holdout_metrics.get('maxDailyCloseMarkedDrawdownPct')}%`; "
        "supported-initial-capital proxy p05 "
        f"`{nested(holdout_metrics, 'capacityProxy', 'supportedInitialCapitalP05Usdt')}` "
        "USDT"
        if isinstance(holdout_metrics, dict)
        else "net/samples/95% interval/drawdown `UNOPENED_OR_UNMEASURED`"
    )
    return (
        "# V-G7 verdict\n\n"
        f"**{verdict}** — `{reason}`\n\n"
        f"- Development best net / initial $1,000: "
        f"`{primary.get('netPerInitial1000Usd')}` under frozen fee stress.\n"
        f"- Development 95% block-bootstrap interval: `{development_interval}`.\n"
        f"- Samples/fills: `{primary.get('selectedRoundTrips')}` round trips / "
        f"`{primary.get('fills')}` fills; `{primary.get('signalEvents')}` signals.\n"
        f"- Holdout: `{holdout.get('startInclusive')}..{holdout.get('endExclusive')}` "
        f"— `{holdout.get('state')}`; {holdout_detail}.\n"
        f"- PBO: `{nested(result, 'development', 'pbo', 'pbo')}`; max daily-close "
        f"marked drawdown: `{primary.get('maxDailyCloseMarkedDrawdownPct')}%`.\n"
        f"- Capacity: supported-initial-capital participation proxy p05 "
        f"`{nested(primary, 'capacityProxy', 'supportedInitialCapitalP05Usdt')}` "
        "USDT; verified executable "
        "capacity `UNMEASURED`.\n"
        "- Account-effective fees `UNKNOWN`; historical book `UNAVAILABLE`; "
        "execution authority `NONE`.\n\n"
        f"{LIMITATION}\n\n"
        f"`{EXECUTION_BANNER}`\n"
    )


def proposed_section5_row(result: Mapping[str, Any], pre_run_sha: str) -> str:
    verdict = require_text(result.get("verdict"), field="verdict")
    best = cast(Mapping[str, Any], nested(result, "development", "bestByFrozenMetric"))
    metrics = cast(Mapping[str, Any], nested(best, "primaryMetrics"))
    holdout = cast(Mapping[str, Any], nested(result, "holdout"))
    development_bootstrap = best.get("bootstrap")
    development_interval = (
        nested(development_bootstrap, "confidenceIntervalNetPer1000Usd")
        if isinstance(development_bootstrap, dict)
        else None
    )
    holdout_metrics = holdout.get("metrics")
    holdout_bootstrap = holdout.get("bootstrap")
    holdout_interval = (
        nested(holdout_bootstrap, "confidenceIntervalNetPer1000Usd")
        if isinstance(holdout_bootstrap, dict)
        else None
    )
    holdout_summary = (
        f"net={holdout_metrics.get('netPerInitial1000Usd')}/$1k; "
        f"round-trips/fills={holdout_metrics.get('selectedRoundTrips')}/"
        f"{holdout_metrics.get('fills')}; interval={holdout_interval}; "
        f"daily-close-DD={holdout_metrics.get('maxDailyCloseMarkedDrawdownPct')}%; "
        "capacity-p05="
        f"{nested(holdout_metrics, 'capacityProxy', 'supportedInitialCapitalP05Usdt')}"
        " USDT"
        if isinstance(holdout_metrics, dict)
        else "net/samples/interval/DD=UNOPENED_OR_UNMEASURED"
    )
    return (
        "- item=`2026-07-29 V-G7 SEALED SPOT VOLUME-CLIMAX EXHAUSTION REVERSAL`"
        f" | expected=`12-month public Spot; frozen 36 trials; sealed holdout; "
        "net/$1k, samples/fills, interval, PBO, drawdown, capacity, fee stress`"
        f" | found=`pre-run …{pre_run_sha[-4:]}; verdict={verdict}; "
        f"best development fee-stress net=${metrics.get('netPerInitial1000Usd')}/$1k; "
        f"development interval={development_interval}; "
        f"signals={metrics.get('signalEvents')}; round-trips/fills="
        f"{metrics.get('selectedRoundTrips')}/{metrics.get('fills')}; "
        f"PBO={nested(result, 'development', 'pbo', 'pbo')}; "
        f"daily-close-marked DD={metrics.get('maxDailyCloseMarkedDrawdownPct')}%; "
        "supported-initial-capital proxy p05="
        f"{nested(metrics, 'capacityProxy', 'supportedInitialCapitalP05Usdt')} USDT; "
        f"holdout={holdout_summary}; state="
        f"{holdout.get('state')} {holdout.get('startInclusive')}.."
        f"{holdout.get('endExclusive')}; reason={result.get('reason')}; "
        "account fee UNKNOWN; verified capacity "
        "UNMEASURED; clean candidate SHA supplied separately; scope=vg7 only; "
        "canonical/host/provider/private/order/transfer/withdrawal/money NONE/$0`"
        f" | status=`{verdict}; execution authority NONE; consumer=N3 successor/"
        "orchestrator scoreboard; NOT_LANDED`\n"
    )


def safe_error_code(phase: str, error: Exception) -> str:
    raw = f"{phase}_{type(error).__name__}_{error}".upper()
    sanitized = "".join(character if character.isalnum() else "_" for character in raw)
    return "_".join(part for part in sanitized.split("_") if part)[:160]


def require_measurement_months_semantically_available(
    issues: Sequence[str],
    *,
    measurement_start: date,
) -> None:
    if len(issues) > 1:
        raise EvidenceError("WARMUP_SEMANTIC_UNAVAILABLE_COUNT_EXCEEDS_ONE")
    for issue in issues:
        parts = issue.split("|", 2)
        if len(parts) != 3:
            raise EvidenceError("SEMANTIC_UNAVAILABLE_RECEIPT_MALFORMED")
        if parts[1] >= measurement_start.strftime("%Y-%m"):
            raise EvidenceError(
                "MEASUREMENT_MONTH_ARCHIVE_SEMANTICALLY_UNAVAILABLE_" + "_".join(parts)
            )
    if issues and tuple(issues) != (KNOWN_WARMUP_SEMANTIC_UNAVAILABLE,):
        raise EvidenceError("WARMUP_SEMANTIC_UNAVAILABLE_DIFFERS_FROM_FROZEN_RECEIPT")


def unmeasured_result(
    *,
    freeze_sha: str,
    pre_run_sha: str,
    marker_sha: str,
    reason: str,
    development: Mapping[str, object] | None = None,
    holdout_blocker: str | None = None,
) -> dict[str, object]:
    empty_metrics: dict[str, object] = {
        "activeMonthCount": 0,
        "activeWeekCount": 0,
        "capacityProxy": {
            "label": "PUBLIC_BAR_PARTICIPATION_PROXY_NOT_EXECUTABLE_CAPACITY",
            "supportedInitialCapitalMedianUsdt": None,
            "supportedInitialCapitalMinUsdt": None,
            "supportedInitialCapitalP05Usdt": None,
            "verifiedExecutableCapacity": "UNMEASURED",
        },
        "distinctSymbolCount": 0,
        "distinctSymbols": [],
        "endUsd": None,
        "fills": 0,
        "maxDailyCloseMarkedDrawdownPct": None,
        "netPerInitial1000Usd": None,
        "selectedRoundTrips": 0,
        "signalEvents": 0,
        "startUsd": "1000",
    }
    development_payload: Mapping[str, object] = development or {
        "bestByFrozenMetric": {
            "primaryMetrics": empty_metrics,
            "trialId": None,
        },
        "pbo": {"pbo": None, "state": "UNMEASURED"},
        "state": "CONSUMED_INVALID",
    }
    return {
        "development": development_payload,
        "executionBanner": EXECUTION_BANNER,
        "freezeSha256": freeze_sha,
        "holdout": {
            "blocker": holdout_blocker,
            "bootstrap": None,
            "endExclusive": "2026-07-01",
            "metrics": None,
            "startInclusive": "2026-04-01",
            "state": ("CONSUMED_INVALID" if HOLDOUT_MARKER_PATH.exists() else "SEALED_UNOPENED"),
        },
        "limitation": LIMITATION,
        "preRunGitSha": pre_run_sha,
        "reason": reason,
        "runMarkerSha256": marker_sha,
        "schema": "VG7ResultV1",
        "taskId": "V-G7",
        "truth": {
            "accountEffectiveFees": "UNKNOWN",
            "capitalAuthority": "NONE",
            "historicalFilterAdmissibility": "UNKNOWN",
            "historicalOrderBook": "UNAVAILABLE",
            "publicBarExecution": "SENSITIVITY_ONLY",
            "verifiedExecutableCapacity": "UNMEASURED",
        },
        "verdict": "UNMEASURED",
    }


def run(state_root: Path) -> dict[str, object]:
    assert_git_scope(require_clean=True)
    prohibited = (
        DEVELOPMENT_MARKER_PATH,
        CANDIDATE_SEAL_PATH,
        HOLDOUT_MARKER_PATH,
        RESULT_PATH,
        VERDICT_PATH,
        ROW_PATH,
        CHECKSUMS_PATH,
    )
    if any(path.exists() for path in prohibited):
        raise EvidenceError("sealed run or output already exists; rerun refused")
    protocol, _ = load_protocol()
    _, freeze_sha = load_freeze()
    manifest, _ = load_source_manifest()
    if (
        Path(require_text(manifest.get("stateRoot"), field="stateRoot")).resolve()
        != state_root.resolve()
    ):
        raise EvidenceError("run state root differs from frozen state root")
    pre_run_sha = git_head()
    development_marker = marker_payload(
        schema="VG7DevelopmentRunMarkerV1",
        state="CONSUMED_BEFORE_FIRST_ARCHIVE_MEMBER_OPEN",
        freeze_sha=freeze_sha,
        pre_run_sha=pre_run_sha,
    )
    exclusive_write(DEVELOPMENT_MARKER_PATH, canonical_bytes(development_marker))
    marker_sha = sha256_path(DEVELOPMENT_MARKER_PATH)
    development_result: dict[str, object] | None = None
    try:
        development_start = date_value(
            nested(protocol, "calendar", "development", "startInclusive"),
            field="development.start",
        )
        development_end = date_value(
            nested(protocol, "calendar", "development", "endExclusive"),
            field="development.end",
        )
        warmup_start = date_value(
            nested(protocol, "calendar", "warmup", "startInclusive"),
            field="warmup.start",
        )
        dev_months = {day.strftime("%Y-%m") for day in daterange(warmup_start, development_end)}
        development_bars, development_semantic_issues = load_bars(state_root, manifest, dev_months)
        require_measurement_months_semantically_available(
            development_semantic_issues,
            measurement_start=development_start,
        )
        records, _metrics_by_trial, pbo = evaluate_family(
            protocol=protocol,
            bars=development_bars,
            start=development_start,
            end=development_end,
        )
        primary_name = require_text(
            nested(protocol, "costs", "primaryRequiredScenario"),
            field="primaryRequiredScenario",
        )
        best = min(
            records,
            key=lambda record: (
                -record_metric(record, primary_name, "netPerInitial1000Usd"),
                record_metric(record, primary_name, "maxDailyCloseMarkedDrawdownPct"),
                require_text(record.get("trialId"), field="trialId"),
            ),
        )
        eligible = [record for record in records if record.get("developmentEligible") is True]
        candidate = (
            min(
                eligible,
                key=lambda record: (
                    -record_metric(record, primary_name, "netPerInitial1000Usd"),
                    record_metric(record, primary_name, "maxDailyCloseMarkedDrawdownPct"),
                    require_text(record.get("trialId"), field="trialId"),
                ),
            )
            if eligible
            else None
        )
        reported = candidate or best
        best_metrics = cast(
            dict[str, Any],
            nested(reported, "scenarios", primary_name, "metrics"),
        )
        best_observed_metrics = cast(
            dict[str, Any],
            nested(best, "scenarios", primary_name, "metrics"),
        )
        development_result = {
            "bestByFrozenMetric": {
                "bootstrap": reported["bootstrap"],
                "developmentEligible": reported["developmentEligible"],
                "gates": reported["gates"],
                "holm": reported["holm"],
                "primaryMetrics": best_metrics,
                "role": (
                    "LOCKED_CANDIDATE"
                    if candidate is not None
                    else "BEST_OBSERVED_DIAGNOSTIC_NO_ELIGIBLE_CANDIDATE"
                ),
                "scenarioMetrics": reported["scenarios"],
                "trialId": reported["trialId"],
            },
            "bestObservedDiagnostic": {
                "developmentEligible": best["developmentEligible"],
                "primaryMetrics": best_observed_metrics,
                "trialId": best["trialId"],
            },
            "candidateCountPassingAllGates": len(eligible),
            "family": records,
            "lockedCandidateTrialId": (
                require_text(candidate.get("trialId"), field="candidate.trialId")
                if candidate is not None
                else None
            ),
            "pbo": pbo,
            "sourceSemanticUnavailableSymbolMonths": {
                "count": len(development_semantic_issues),
                "measurementMonthsAffected": 0,
                "rows": list(development_semantic_issues),
                "rule": "WHOLE_SYMBOL_MONTH_UNAVAILABLE_BREAKS_CAUSAL_ELIGIBILITY",
                "sha256": sha256_bytes(normalized_lines(development_semantic_issues)),
            },
            "startInclusive": development_start.isoformat(),
            "endExclusive": development_end.isoformat(),
            "state": "CONSUMED_VALID",
            "trialCount": len(records),
        }
        holdout_result: dict[str, object]
        verdict: str
        reason: str
        if candidate is None:
            verdict = "NO_GO"
            reason = "NO_DEVELOPMENT_TRIAL_CLEARED_ALL_FROZEN_GATES"
            holdout_result = {
                "blocker": None,
                "bootstrap": None,
                "endExclusive": "2026-07-01",
                "metrics": None,
                "startInclusive": "2026-04-01",
                "state": "SEALED_UNOPENED",
            }
        else:
            candidate_id = require_text(candidate.get("trialId"), field="candidate.trialId")
            candidate_payload: dict[str, object] = {
                "candidateTrialId": candidate_id,
                "createdAtUtc": now_utc(),
                "developmentRecordSha256": sha256_bytes(canonical_bytes(candidate)),
                "freezeSha256": freeze_sha,
                "preRunGitSha": pre_run_sha,
                "schema": "VG7CandidateSealV1",
                "selectionRule": "MAX_FEE_STRESS_NET_THEN_MIN_DRAWDOWN_THEN_TRIAL_ID_ASC",
                "state": "SEALED_BEFORE_HOLDOUT_OPEN",
            }
            exclusive_write(CANDIDATE_SEAL_PATH, canonical_bytes(candidate_payload))
            holdout_marker = marker_payload(
                schema="VG7HoldoutOpenMarkerV1",
                state="CONSUMED_BEFORE_FIRST_HOLDOUT_ARCHIVE_MEMBER_OPEN",
                freeze_sha=freeze_sha,
                pre_run_sha=pre_run_sha,
            )
            holdout_marker["candidateSealSha256"] = sha256_path(CANDIDATE_SEAL_PATH)
            exclusive_write(HOLDOUT_MARKER_PATH, canonical_bytes(holdout_marker))
            holdout_start = date_value(
                nested(protocol, "calendar", "holdout", "startInclusive"),
                field="holdout.start",
            )
            holdout_end = date_value(
                nested(protocol, "calendar", "holdout", "endExclusive"),
                field="holdout.end",
            )
            holdout_months = {
                day.strftime("%Y-%m")
                for day in daterange(
                    holdout_start
                    - timedelta(
                        days=require_int(
                            nested(
                                protocol,
                                "calendar",
                                "holdout",
                                "causalWarmupDays",
                            ),
                            field="holdout.causalWarmupDays",
                        )
                    ),
                    holdout_end,
                )
            }
            holdout_bars, holdout_semantic_issues = load_bars(state_root, manifest, holdout_months)
            require_measurement_months_semantically_available(
                holdout_semantic_issues,
                measurement_start=holdout_start,
            )
            candidate_trial = trial_from_id(protocol, candidate_id)
            holdout_bases = signal_bases(
                holdout_bars,
                partition_start=holdout_start,
                partition_end=holdout_end,
            )
            scenarios = build_scenarios(protocol)
            holdout_scenarios = {
                scenario.name: evaluate_trial(
                    trial=candidate_trial,
                    scenario=scenario,
                    bases=holdout_bases,
                    bars_by_symbol=holdout_bars,
                    partition_start=holdout_start,
                    partition_end=holdout_end,
                )
                for scenario in scenarios
            }
            primary_holdout = holdout_scenarios[primary_name]
            holdout_bootstrap = circular_bootstrap(
                primary_holdout.daily_returns,
                replicates=require_int(
                    nested(protocol, "statistics", "bootstrap", "replicates"),
                    field="bootstrap.replicates",
                ),
                block_length=require_int(
                    nested(protocol, "statistics", "bootstrap", "blockLengthDays"),
                    field="bootstrap.blockLengthDays",
                ),
                seed=require_int(
                    nested(protocol, "statistics", "bootstrap", "seed"),
                    field="bootstrap.seed",
                )
                + 10_000,
            )
            holdout_gates = holdout_gate_status(
                metrics=primary_holdout,
                bootstrap=holdout_bootstrap,
                scenario_metrics=holdout_scenarios,
            )
            holdout_result = {
                "blocker": None,
                "bootstrap": holdout_bootstrap,
                "endExclusive": holdout_end.isoformat(),
                "gates": holdout_gates,
                "metrics": primary_holdout.summary(),
                "scenarioMetrics": scenario_table(holdout_scenarios, scenarios),
                "sourceSemanticUnavailableSymbolMonths": {
                    "count": len(holdout_semantic_issues),
                    "measurementMonthsAffected": 0,
                    "rows": list(holdout_semantic_issues),
                    "rule": "WHOLE_SYMBOL_MONTH_UNAVAILABLE_BREAKS_CAUSAL_ELIGIBILITY",
                    "sha256": sha256_bytes(normalized_lines(holdout_semantic_issues)),
                },
                "startInclusive": holdout_start.isoformat(),
                "state": "CONSUMED_VALID",
            }
            if all_passed(holdout_gates):
                verdict = "GO"
                reason = "LOCKED_CANDIDATE_CLEARED_ALL_PUBLIC_RESEARCH_GATES"
            else:
                verdict = "NO_GO"
                reason = "LOCKED_CANDIDATE_FAILED_AT_LEAST_ONE_FROZEN_HOLDOUT_GATE"
        result: dict[str, object] = {
            "development": development_result,
            "executionBanner": EXECUTION_BANNER,
            "freezeSha256": freeze_sha,
            "holdout": holdout_result,
            "limitation": LIMITATION,
            "preRunGitSha": pre_run_sha,
            "reason": reason,
            "runMarkerSha256": marker_sha,
            "schema": "VG7ResultV1",
            "taskId": "V-G7",
            "truth": {
                "accountEffectiveFees": "UNKNOWN",
                "capitalAuthority": "NONE",
                "historicalFilterAdmissibility": "UNKNOWN",
                "historicalOrderBook": "UNAVAILABLE",
                "publicBarExecution": "SENSITIVITY_ONLY",
                "verifiedExecutableCapacity": "UNMEASURED",
            },
            "verdict": verdict,
        }
    except Exception as error:
        phase = "HOLDOUT" if HOLDOUT_MARKER_PATH.exists() else "DEVELOPMENT"
        reason = safe_error_code(phase, error)
        result = unmeasured_result(
            freeze_sha=freeze_sha,
            pre_run_sha=pre_run_sha,
            marker_sha=marker_sha,
            reason=reason,
            development=(development_result if HOLDOUT_MARKER_PATH.exists() else None),
            holdout_blocker=reason if HOLDOUT_MARKER_PATH.exists() else None,
        )
    markdown = verdict_document(cast(Mapping[str, Any], result))
    row = proposed_section5_row(cast(Mapping[str, Any], result), pre_run_sha)
    seal_outputs(result=result, verdict_markdown=markdown, proposed_row=row)
    return result


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    for name in ("freeze", "run"):
        command = subparsers.add_parser(name)
        command.add_argument("--state-root", required=True, type=Path)
    arguments = parser.parse_args(argv)
    try:
        if arguments.command == "freeze":
            payload = freeze(cast(Path, arguments.state_root))
            print(f"freeze={sha256_bytes(canonical_bytes(payload))}")
        else:
            payload = run(cast(Path, arguments.state_root))
            print(f"verdict={payload['verdict']}")
    except EvidenceError as error:
        print(f"V-G7 FAIL CLOSED: {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
