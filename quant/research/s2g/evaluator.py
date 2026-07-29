#!/usr/bin/env python3
"""Sealed S-2G Binance-public-only weekday x lagged-volume evaluator.

``freeze`` authenticates compressed shared-source bytes without opening a ZIP.
``run`` consumes a packet-local one-use marker before the first decompression.
``verify`` authenticates frozen and terminal packet bytes without opening ZIPs.

No command reads credentials, account state, private endpoints, orders, wallet
state, provider state, host state, or UI state.
"""

from __future__ import annotations

import argparse
import calendar
import csv
import hashlib
import io
import itertools
import json
import math
import os
import random
import re
import statistics
import subprocess
import sys
import zipfile
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import asdict, dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal, InvalidOperation, getcontext
from pathlib import Path
from typing import Any, cast

getcontext().prec = 50

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[2]
PROTOCOL_PATH = HERE / "protocol.v1.json"
README_PATH = HERE / "README.md"
SOURCE_RESEARCH_PATH = HERE / "OFFICIAL_SOURCE_RESEARCH.md"
DISTINCTNESS_PATH = HERE / "DISTINCTNESS.md"
OFFICIAL_SOURCES_PATH = HERE / "official_sources.v1.json"
INIT_PATH = HERE / "__init__.py"
EVALUATOR_PATH = HERE / "evaluator.py"
VERIFY_PATH = HERE / "verify.py"
TEST_PATH = HERE / "test_evaluator.py"
SOURCE_MANIFEST_PATH = HERE / "source-manifest.v1.json"
FREEZE_PATH = HERE / "freeze.v1.json"
RESULT_PATH = HERE / "result.v1.json"
SHA256SUMS_PATH = HERE / "SHA256SUMS"

BASE_COMMIT = "a169b123fb186d1943a75ad648552c4d95be1be1"
SOURCE_ROOT = Path("/private/tmp/cosmos-s1f-weekly-momentum-cash-v1")
SOURCE_DISCOVERY_PATH = SOURCE_ROOT / "discovery.v1.json"
SOURCE_ACQUISITION_PATH = SOURCE_ROOT / "acquisition-manifest.v1.json"
SOURCE_DISCOVERY_SHA256 = "b4a8f7abd36df19eff0510dfcc3c61fd0df9fdcab5f4d248892ee10010fb21c3"
SOURCE_ACQUISITION_SHA256 = "01f58272602e43bfb914b649adc00d8273b2d423492220a55f86443bb6441176"

STATE_ROOT = HERE
RUN_MARKER_PATH = STATE_ROOT / "run-marker.v1.json"
CANDIDATE_SEAL_PATH = STATE_ROOT / "candidate-seal.v1.json"
HOLDOUT_MARKER_PATH = STATE_ROOT / "holdout-open.v1.json"
TERMINAL_CORE_PATH = STATE_ROOT / "terminal-result-core.v1.json"

FIXED_COHORT = (
    "ADAUSDT",
    "AVAXUSDT",
    "BCHUSDT",
    "BNBUSDT",
    "BTCUSDT",
    "DOGEUSDT",
    "ETHUSDT",
    "LINKUSDT",
    "LTCUSDT",
    "SOLUSDT",
    "TRXUSDT",
    "XRPUSDT",
)
SOURCE_MONTHS = tuple(
    f"{year:04d}-{month:02d}"
    for year, start_month, end_month in ((2025, 5, 12), (2026, 1, 6))
    for month in range(start_month, end_month + 1)
)
DEVELOPMENT_MONTHS = SOURCE_MONTHS[:10]
HOLDOUT_MONTHS = SOURCE_MONTHS[10:]
DEVELOPMENT_START = date(2025, 7, 1)
DEVELOPMENT_END = date(2026, 3, 1)
HOLDOUT_START = DEVELOPMENT_END
EVALUATION_END = date(2026, 7, 1)

WEEKDAY_LOOKBACK_WEEKS = (4, 8)
VOLUME_LOOKBACK_DAYS = (1, 7, 28)
TAIL_COUNTS = (2, 3)
INITIAL_CAPITAL = Decimal("1000")
CAPACITY_PARTICIPATION = Decimal("0.0001")
BOOTSTRAP_REPLICATES = 4096
BOOTSTRAP_BLOCK_DAYS = 14
BOOTSTRAP_SEED = 2_026_073_002
TERMINAL_LIMITATIONS = (
    "CENTERED_PRODUCT_TAILS_NOT_ORTHOGONALIZED_TO_COMPONENT_CHARACTERISTICS",
    "SYNTHETIC_SHORT_BORROW_AVAILABILITY_AND_COST_UNKNOWN",
    "PUBLIC_QUOTE_VOLUME_CAPACITY_PROXY_NOT_EXECUTABLE_CAPACITY",
    "FIXED_COHORT_SURVIVORSHIP_AND_HISTORICAL_FILTER_TRUTH_UNRESOLVED",
    "BLOCK_INFERENCE_CONDITIONAL_ON_REALIZED_SIGNAL_AND_TURNOVER_PATH",
    "PBO_EIGHT_MONTH_DIAGNOSTIC_ONLY",
    "GLOBAL_HOLDOUT_NOT_CERTIFIED_DUE_TO_SHARED_CALENDAR_REUSE",
)

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
CHECKSUM_RE = re.compile(r"^([0-9a-f]{64})[ \t]+\*?([^\r\n]+)[\r\n]*$")


class S2GError(RuntimeError):
    """Terminal S-2G protocol, source, or measurement failure."""


@dataclass(frozen=True, slots=True)
class Trial:
    trial_id: str
    weekday_weeks: int
    volume_days: int
    tail_count: int


@dataclass(frozen=True, slots=True)
class Bar:
    symbol: str
    day: date
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    quote_volume: Decimal
    open_time: int
    close_time: int
    timestamp_unit: str
    fields: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class FormationSignal:
    entry_day: date
    cutoff_day: date
    weekday_weeks: int
    volume_days: int
    tail_count: int
    scores: tuple[tuple[str, Decimal], ...]
    long_symbols: tuple[str, ...]
    short_symbols: tuple[str, ...]
    active: bool


@dataclass(frozen=True, slots=True)
class Scenario:
    name: str
    fee_rate: Decimal
    adverse_rate: Decimal


@dataclass(frozen=True, slots=True)
class PathMetrics:
    trial_id: str
    scenario: str
    start_day: date
    end_exclusive: date
    final_nav: Decimal
    net_usdt: Decimal
    valid_formations: int
    active_days: int
    fills: int
    distinct_held_symbols: int
    maximum_drawdown_pct: Decimal
    positive_months: int
    capacity_p05_usdt: Decimal | None
    mean_daily_turnover: Decimal
    boundary_cost_log_return: float
    daily_log_returns: tuple[float, ...]
    monthly_log_returns: tuple[tuple[str, float], ...]
    monthly_net_usdt: tuple[tuple[str, Decimal], ...]


SCENARIOS = (
    Scenario("PUBLIC_GROSS", Decimal("0"), Decimal("0")),
    Scenario("PUBLIC_BASE", Decimal("0.0010"), Decimal("0.0010")),
    Scenario("PUBLIC_STRESS", Decimal("0.0010"), Decimal("0.0025")),
    Scenario("FEE_STRESS", Decimal("0.0020"), Decimal("0.0025")),
)
DEVELOPMENT_GATE_NAMES = frozenset(
    {
        "activeDaysAtLeast120",
        "capacityP05AtLeast1000",
        "distinctSymbolsAtLeast8",
        "drawdownAtMost25Pct",
        "holmPBelow0.05",
        "lcbAboveZero",
        "netAboveZero",
        "positiveMonthsAtLeast5",
        "rawPBelow0.05",
        "validFormationsAtLeast200",
        "whitePBelow0.05",
    }
)
HOLDOUT_GATE_NAMES = frozenset(
    {
        "activeDaysAtLeast60",
        "baseNetAboveZero",
        "capacityP05AtLeast1000",
        "distinctSymbolsAtLeast6",
        "drawdownAtMost25Pct",
        "feeStressNetAboveZero",
        "lcbAboveZero",
        "netAboveZero",
        "positiveMonthsAtLeast3",
        "rawPBelow0.05",
        "validFormationsAtLeast100",
    }
)
BOOTSTRAP_RESULT_NAMES = frozenset(
    {
        "lcb5Usdt",
        "pValueOneSided",
        "twoSided90LowerUsdt",
        "twoSided90UpperUsdt",
    }
)
SCENARIO_NAMES = frozenset(scenario.name for scenario in SCENARIOS)
PATH_RECORD_NAMES = frozenset(
    {
        "active_days",
        "boundary_cost_log_return",
        "capacity_p05_usdt",
        "distinct_held_symbols",
        "end_exclusive",
        "fills",
        "final_nav",
        "maximum_drawdown_pct",
        "mean_daily_turnover",
        "monthly_log_returns",
        "monthly_net_usdt",
        "net_usdt",
        "positive_months",
        "scenario",
        "start_day",
        "trial_id",
        "valid_formations",
    }
)
DEVELOPMENT_RECORD_NAMES = frozenset(
    {
        "championTrialId",
        "holmAdjustedP",
        "pbo",
        "qualifyingTrialIds",
        "selectedTrialId",
        "trialCount",
        "trials",
        "whiteRealityCheckP",
    }
)
HOLDOUT_RECORD_NAMES = frozenset({"championTrialId", "gates", "inference", "paths"})
TRIAL_RECORD_NAMES = frozenset({"gates", "inference", "paths"})
PBO_RECORD_NAMES = frozenset(
    {
        "blocks",
        "metric",
        "negativeLogitCount",
        "pboOfImplementedSelectionRule",
        "selectionRuleReproduced",
        "splitCount",
        "status",
    }
)
TERMINAL_CORE_RECORD_NAMES = frozenset(
    {
        "accountEffectiveFees",
        "authority",
        "blocker",
        "candidateSealSha256",
        "capitalVerdict",
        "consumer",
        "development",
        "executableCapacity",
        "globalHoldoutStatus",
        "holdout",
        "holdoutMarkerSha256",
        "limitations",
        "packetHoldoutState",
        "protocolSha256",
        "runMarkerSha256",
        "schema",
        "shortBorrowAvailabilityAndCost",
        "spotShortLeg",
        "terminalPhase",
        "verdict",
    }
)
RESULT_RECORD_NAMES = TERMINAL_CORE_RECORD_NAMES | frozenset({"terminalCoreSha256"})


def canonical_bytes(value: object) -> bytes:
    return (
        json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        ).encode("utf-8")
        + b"\n"
    )


def canonical_sha(value: object) -> str:
    return hashlib.sha256(canonical_bytes(value)).hexdigest()


def sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def read_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise S2GError(f"JSON_OBJECT_REQUIRED:{path}")
    return cast(dict[str, Any], value)


def write_once_or_match(path: Path, payload: object) -> None:
    expected = canonical_bytes(payload)
    if path.exists():
        if path.read_bytes() != expected:
            raise S2GError(f"EXISTING_BYTES_DIFFER:{path}")
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(expected)
            handle.flush()
            os.fsync(handle.fileno())
    except BaseException:
        path.unlink(missing_ok=True)
        raise


def write_exclusive(path: Path, payload: object) -> None:
    expected = canonical_bytes(payload)
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError as error:
        raise S2GError(f"ONE_USE_STATE_ALREADY_EXISTS:{path}") from error
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(expected)
            handle.flush()
            os.fsync(handle.fileno())
    except BaseException:
        path.unlink(missing_ok=True)
        raise


def trial_grid() -> tuple[Trial, ...]:
    return tuple(
        Trial(
            trial_id=f"W{weeks:02d}_V{volume:02d}_K{tail:02d}",
            weekday_weeks=weeks,
            volume_days=volume,
            tail_count=tail,
        )
        for weeks in WEEKDAY_LOOKBACK_WEEKS
        for volume in VOLUME_LOOKBACK_DAYS
        for tail in TAIL_COUNTS
    )


def iter_days(start: date, end_exclusive: date) -> Iterable[date]:
    current = start
    while current < end_exclusive:
        yield current
        current += timedelta(days=1)


def entry_days(start: date, end_exclusive: date) -> tuple[date, ...]:
    """Daily open-to-next-open entries with the endpoint reserved for liquidation."""
    return tuple(iter_days(start, end_exclusive - timedelta(days=1)))


def decimal_field(raw: str, label: str) -> Decimal:
    try:
        value = Decimal(raw)
    except InvalidOperation as error:
        raise S2GError(f"INVALID_DECIMAL:{label}") from error
    if not value.is_finite():
        raise S2GError(f"NONFINITE_DECIMAL:{label}")
    return value


def timestamp_to_day(raw: str, label: str) -> tuple[date, int, str]:
    try:
        value = int(raw)
    except ValueError as error:
        raise S2GError(f"INVALID_TIMESTAMP:{label}") from error
    if value >= 1_000_000_000_000_000:
        seconds, unit = value // 1_000_000, "MICROSECOND"
        if value % 1_000_000 != 0:
            raise S2GError(f"OPEN_NOT_UTC_DAY_BOUNDARY:{label}")
    elif value >= 1_000_000_000_000:
        seconds, unit = value // 1_000, "MILLISECOND"
        if value % 1_000 != 0:
            raise S2GError(f"OPEN_NOT_UTC_DAY_BOUNDARY:{label}")
    else:
        raise S2GError(f"TIMESTAMP_MAGNITUDE_INVALID:{label}")
    moment = datetime.fromtimestamp(seconds, tz=UTC)
    if moment.time() != datetime.min.time():
        raise S2GError(f"OPEN_NOT_UTC_DAY_BOUNDARY:{label}")
    return moment.date(), value, unit


def parse_bar(symbol: str, fields: Sequence[str], row_number: int) -> Bar:
    if len(fields) != 12:
        raise S2GError(f"KLINE_FIELD_COUNT:{symbol}:{row_number}")
    day, open_time, unit = timestamp_to_day(fields[0], f"{symbol}:{row_number}:open")
    try:
        close_time = int(fields[6])
    except ValueError as error:
        raise S2GError(f"INVALID_CLOSE_TIMESTAMP:{symbol}:{row_number}") from error
    one_day = 86_400_000_000 if unit == "MICROSECOND" else 86_400_000
    if close_time != open_time + one_day - 1:
        raise S2GError(f"CLOSE_BOUNDARY_INVALID:{symbol}:{row_number}")
    if day >= date(2025, 1, 1) and unit != "MICROSECOND":
        raise S2GError(f"POST_2025_TIMESTAMP_NOT_MICROSECOND:{symbol}:{row_number}")
    if day < date(2025, 1, 1) and unit != "MILLISECOND":
        raise S2GError(f"PRE_2025_TIMESTAMP_NOT_MILLISECOND:{symbol}:{row_number}")
    open_price = decimal_field(fields[1], f"{symbol}:{row_number}:open")
    high = decimal_field(fields[2], f"{symbol}:{row_number}:high")
    low = decimal_field(fields[3], f"{symbol}:{row_number}:low")
    close = decimal_field(fields[4], f"{symbol}:{row_number}:close")
    quote_volume = decimal_field(fields[7], f"{symbol}:{row_number}:quote_volume")
    if min(open_price, high, low, close) <= 0:
        raise S2GError(f"NONPOSITIVE_PRICE_FIELD:{symbol}:{row_number}")
    if quote_volume < 0:
        raise S2GError(f"NEGATIVE_QUOTE_VOLUME:{symbol}:{row_number}")
    if high < max(open_price, close) or low > min(open_price, close) or high < low:
        raise S2GError(f"OHLC_ORDER_INVALID:{symbol}:{row_number}")
    return Bar(
        symbol=symbol,
        day=day,
        open=open_price,
        high=high,
        low=low,
        close=close,
        quote_volume=quote_volume,
        open_time=open_time,
        close_time=close_time,
        timestamp_unit=unit,
        fields=tuple(fields),
    )


def _artifact_paths(symbol: str, month: str) -> tuple[Path, Path, Path]:
    directory = SOURCE_ROOT / "archives" / symbol / month
    zip_name = f"{symbol}-1d-{month}.zip"
    return directory / zip_name, directory / f"{zip_name}.CHECKSUM", directory / "pair.v1.json"


def build_source_manifest() -> dict[str, object]:
    if sha256_path(SOURCE_DISCOVERY_PATH) != SOURCE_DISCOVERY_SHA256:
        raise S2GError("SHARED_DISCOVERY_DIGEST_MISMATCH")
    if sha256_path(SOURCE_ACQUISITION_PATH) != SOURCE_ACQUISITION_SHA256:
        raise S2GError("SHARED_ACQUISITION_DIGEST_MISMATCH")
    discovery = read_json(SOURCE_DISCOVERY_PATH)
    acquisition = read_json(SOURCE_ACQUISITION_PATH)
    if discovery.get("schema") != "S1FArchiveDiscoveryV1":
        raise S2GError("SHARED_DISCOVERY_SCHEMA_MISMATCH")
    if acquisition.get("schema") != "S1FAcquisitionManifestV1":
        raise S2GError("SHARED_ACQUISITION_SCHEMA_MISMATCH")
    if acquisition.get("archiveBodiesDecompressed") is not False:
        raise S2GError("SHARED_ACQUISITION_DECOMPRESSION_CLAIM_INVALID")
    universe = cast(dict[str, Any], discovery.get("universe"))
    symbols = universe.get("symbols")
    if not isinstance(symbols, list) or not set(FIXED_COHORT).issubset(set(symbols)):
        raise S2GError("FIXED_COHORT_NOT_IN_DISCOVERED_UNIVERSE")
    rows = acquisition.get("artifactPairs")
    if not isinstance(rows, list):
        raise S2GError("SHARED_ARTIFACT_ROWS_INVALID")
    by_key: dict[tuple[str, str], dict[str, Any]] = {}
    for raw_row in rows:
        if not isinstance(raw_row, dict):
            raise S2GError("SHARED_ARTIFACT_ROW_INVALID")
        row = cast(dict[str, Any], raw_row)
        symbol = row.get("symbol")
        month = row.get("month")
        if isinstance(symbol, str) and isinstance(month, str):
            by_key[(symbol, month)] = row
    artifacts: list[dict[str, object]] = []
    for symbol in FIXED_COHORT:
        for month in SOURCE_MONTHS:
            artifact_row = by_key.get((symbol, month))
            if artifact_row is None:
                raise S2GError(f"FIXED_COHORT_ARTIFACT_ABSENT:{symbol}:{month}")
            zip_path, checksum_path, pair_path = _artifact_paths(symbol, month)
            for local_path in (zip_path, checksum_path, pair_path):
                if not local_path.is_file():
                    raise S2GError(f"FIXED_SOURCE_FILE_ABSENT:{local_path}")
            zip_sha = sha256_path(zip_path)
            checksum_sha = sha256_path(checksum_path)
            if zip_sha != artifact_row.get("zipSha256"):
                raise S2GError(f"ZIP_DIGEST_MISMATCH:{symbol}:{month}")
            if checksum_sha != artifact_row.get("checksumSha256"):
                raise S2GError(f"CHECKSUM_DIGEST_MISMATCH:{symbol}:{month}")
            match = CHECKSUM_RE.fullmatch(checksum_path.read_text(encoding="ascii"))
            if match is None:
                raise S2GError(f"CHECKSUM_BYTES_INVALID:{symbol}:{month}")
            if match.group(1) != zip_sha or match.group(2) != zip_path.name:
                raise S2GError(f"CHECKSUM_ZIP_BINDING_INVALID:{symbol}:{month}")
            pair = read_json(pair_path)
            if pair.get("schema") != "S1FLocalArchivePairV1":
                raise S2GError(f"PAIR_SCHEMA_INVALID:{symbol}:{month}")
            for field_name in (
                "symbol",
                "month",
                "zipKey",
                "zipListedBytes",
                "zipSha256",
                "zipFrozenEtag",
                "zipFrozenLastModified",
                "checksumKey",
                "checksumListedBytes",
                "checksumSha256",
                "checksumFrozenEtag",
                "checksumFrozenLastModified",
            ):
                if pair.get(field_name) != artifact_row.get(field_name):
                    raise S2GError(
                        f"PAIR_ACQUISITION_BINDING_INVALID:{symbol}:{month}:{field_name}"
                    )
            if pair.get("zipSha256") != zip_sha or pair.get("checksumSha256") != checksum_sha:
                raise S2GError(f"PAIR_LOCAL_BYTES_BINDING_INVALID:{symbol}:{month}")
            artifacts.append(
                {
                    "checksumBytes": checksum_path.stat().st_size,
                    "checksumFrozenEtag": artifact_row["checksumFrozenEtag"],
                    "checksumFrozenLastModified": artifact_row["checksumFrozenLastModified"],
                    "checksumPath": str(checksum_path.relative_to(SOURCE_ROOT)),
                    "checksumSha256": checksum_sha,
                    "month": month,
                    "pairBytes": pair_path.stat().st_size,
                    "pairPath": str(pair_path.relative_to(SOURCE_ROOT)),
                    "pairSha256": sha256_path(pair_path),
                    "symbol": symbol,
                    "zipBytes": zip_path.stat().st_size,
                    "zipFrozenEtag": artifact_row["zipFrozenEtag"],
                    "zipFrozenLastModified": artifact_row["zipFrozenLastModified"],
                    "zipPath": str(zip_path.relative_to(SOURCE_ROOT)),
                    "zipSha256": zip_sha,
                }
            )
    protocol = read_json(PROTOCOL_PATH)
    return {
        "archiveBodiesOpenedByS2GDuringFreeze": False,
        "artifactCount": len(artifacts),
        "artifacts": artifacts,
        "baseCommit": BASE_COMMIT,
        "fixedCohort": list(FIXED_COHORT),
        "fixedCohortSha256": canonical_sha(list(FIXED_COHORT)),
        "protocolSha256": sha256_path(PROTOCOL_PATH),
        "schema": "S2GFrozenPublicSourceManifestV1",
        "sharedAcquisitionSha256": SOURCE_ACQUISITION_SHA256,
        "sharedDiscoverySha256": SOURCE_DISCOVERY_SHA256,
        "sourceMode": "READ_ONLY",
        "sourceMonths": list(SOURCE_MONTHS),
        "sourceRoot": str(SOURCE_ROOT),
        "state": "CHECKSUM_VERIFIED_COMPRESSED_BYTES_NOT_OPENED_BY_S2G",
        "trialIds": [trial.trial_id for trial in trial_grid()],
        "trialIdsSha256": canonical_sha([trial.trial_id for trial in trial_grid()]),
        "verdictConsumer": protocol["authority"]["consumer"],
    }


def static_paths() -> tuple[Path, ...]:
    return (
        INIT_PATH,
        SOURCE_RESEARCH_PATH,
        DISTINCTNESS_PATH,
        README_PATH,
        EVALUATOR_PATH,
        OFFICIAL_SOURCES_PATH,
        PROTOCOL_PATH,
        TEST_PATH,
        VERIFY_PATH,
    )


def git_snapshot() -> dict[str, object]:
    head = subprocess.run(
        ("git", "rev-parse", "HEAD"),
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    tree = subprocess.run(
        ("git", "rev-parse", "HEAD^{tree}"),
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    status_lines = subprocess.run(
        ("git", "status", "--short", "--untracked-files=all"),
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.splitlines()
    changed_paths = sorted(line[3:] for line in status_lines if line)
    if head != BASE_COMMIT:
        raise S2GError("FREEZE_GIT_HEAD_NOT_EXACT_BASE")
    if not changed_paths or any(
        not path.startswith("quant/research/s2g/") for path in changed_paths
    ):
        raise S2GError("FREEZE_GIT_SCOPE_INVALID")
    return {
        "changedPaths": changed_paths,
        "changedPathsSha256": canonical_sha(changed_paths),
        "head": head,
        "tree": tree,
    }


def frozen_candidate_snapshot() -> dict[str, object]:
    head = subprocess.run(
        ("git", "rev-parse", "HEAD"),
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    tree = subprocess.run(
        ("git", "rev-parse", "HEAD^{tree}"),
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    status_lines = subprocess.run(
        ("git", "status", "--short", "--untracked-files=all"),
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.splitlines()
    changed_paths = sorted(line[3:] for line in status_lines if line)
    required = sorted(
        {
            str(path.relative_to(REPO_ROOT))
            for path in (
                *static_paths(),
                SOURCE_MANIFEST_PATH,
                FREEZE_PATH,
                SHA256SUMS_PATH,
            )
        }
    )
    if head != BASE_COMMIT:
        raise S2GError("RUN_GIT_HEAD_NOT_EXACT_BASE")
    if any(not line.startswith("?? ") for line in status_lines):
        raise S2GError("RUN_GIT_TRACKED_CHANGE_PRESENT")
    if changed_paths != required:
        raise S2GError("RUN_GIT_FROZEN_PACKET_SCOPE_INVALID")
    packet_files = {path: sha256_path(REPO_ROOT / path) for path in required}
    return {
        "changedPaths": changed_paths,
        "changedPathsSha256": canonical_sha(changed_paths),
        "baseHead": head,
        "baseTree": tree,
        "packetFiles": packet_files,
        "packetFilesSha256": canonical_sha(packet_files),
    }


def assert_runtime_contract() -> None:
    protocol = read_json(PROTOCOL_PATH)
    run_control = protocol.get("runControl")
    if not isinstance(run_control, dict):
        raise S2GError("RUN_CONTROL_INVALID")
    expected_python = run_control.get("pythonExact")
    actual_python = ".".join(str(item) for item in sys.version_info[:3])
    if expected_python != actual_python:
        raise S2GError(f"PYTHON_VERSION_MISMATCH:{actual_python}")
    expected_hash_seed = run_control.get("pythonHashSeed")
    if os.environ.get("PYTHONHASHSEED") != expected_hash_seed:
        raise S2GError("PYTHONHASHSEED_MISMATCH")


def freeze() -> None:
    assert_runtime_contract()
    for forbidden in (
        RUN_MARKER_PATH,
        CANDIDATE_SEAL_PATH,
        HOLDOUT_MARKER_PATH,
        TERMINAL_CORE_PATH,
        RESULT_PATH,
    ):
        if forbidden.exists():
            raise S2GError(f"FREEZE_REFUSES_OUTCOME_STATE:{forbidden}")
    manifest = build_source_manifest()
    write_once_or_match(SOURCE_MANIFEST_PATH, manifest)
    freeze_payload = {
        "archiveBodiesOpenedByS2G": False,
        "baseCommit": BASE_COMMIT,
        "createdAtUtc": "2026-07-29T19:39:35Z",
        "fixedCohortSha256": canonical_sha(list(FIXED_COHORT)),
        "git": git_snapshot(),
        "protocolSha256": sha256_path(PROTOCOL_PATH),
        "runtime": {
            "implementation": sys.implementation.name,
            "python": ".".join(str(item) for item in sys.version_info[:3]),
            "pythonHashSeed": os.environ.get("PYTHONHASHSEED"),
        },
        "schema": "S2GPreOutcomeFreezeV1",
        "sourceManifestSha256": sha256_path(SOURCE_MANIFEST_PATH),
        "state": "FROZEN_BEFORE_ANY_S2G_ARCHIVE_MEMBER_OPEN",
        "staticFiles": {
            str(path.relative_to(REPO_ROOT)): sha256_path(path) for path in static_paths()
        },
        "trialIds": [trial.trial_id for trial in trial_grid()],
    }
    write_once_or_match(FREEZE_PATH, freeze_payload)
    checksummed = (*static_paths(), SOURCE_MANIFEST_PATH, FREEZE_PATH)
    checksum_lines = [
        f"{sha256_path(path)}  {path.name}"
        for path in sorted(checksummed, key=lambda item: item.name)
    ]
    checksum_bytes = ("\n".join(checksum_lines) + "\n").encode("ascii")
    if SHA256SUMS_PATH.exists():
        if SHA256SUMS_PATH.read_bytes() != checksum_bytes:
            raise S2GError("SHA256SUMS_EXISTING_BYTES_DIFFER")
    else:
        SHA256SUMS_PATH.write_bytes(checksum_bytes)


def assert_frozen() -> dict[str, Any]:
    if not SOURCE_MANIFEST_PATH.is_file() or not FREEZE_PATH.is_file():
        raise S2GError("FREEZE_PACKET_ABSENT")
    frozen = read_json(FREEZE_PATH)
    if frozen.get("schema") != "S2GPreOutcomeFreezeV1":
        raise S2GError("FREEZE_SCHEMA_INVALID")
    if frozen.get("baseCommit") != BASE_COMMIT:
        raise S2GError("FREEZE_BASE_INVALID")
    if frozen.get("archiveBodiesOpenedByS2G") is not False:
        raise S2GError("FREEZE_ARCHIVE_CUSTODY_INVALID")
    if frozen.get("sourceManifestSha256") != sha256_path(SOURCE_MANIFEST_PATH):
        raise S2GError("FREEZE_SOURCE_MANIFEST_DIGEST_MISMATCH")
    static_files = frozen.get("staticFiles")
    if not isinstance(static_files, dict):
        raise S2GError("FREEZE_STATIC_FILES_INVALID")
    for relative, expected in static_files.items():
        if not isinstance(relative, str) or not isinstance(expected, str):
            raise S2GError("FREEZE_STATIC_ROW_INVALID")
        path = REPO_ROOT / relative
        if not path.is_file() or sha256_path(path) != expected:
            raise S2GError(f"FREEZE_STATIC_DRIFT:{relative}")
    source_manifest = read_json(SOURCE_MANIFEST_PATH)
    if source_manifest.get("archiveBodiesOpenedByS2GDuringFreeze") is not False:
        raise S2GError("SOURCE_MANIFEST_CUSTODY_INVALID")
    artifacts = source_manifest.get("artifacts")
    if not isinstance(artifacts, list) or len(artifacts) != len(FIXED_COHORT) * len(SOURCE_MONTHS):
        raise S2GError("SOURCE_MANIFEST_ARTIFACT_COUNT_INVALID")
    for raw in artifacts:
        if not isinstance(raw, dict):
            raise S2GError("SOURCE_MANIFEST_ARTIFACT_INVALID")
        artifact = cast(dict[str, Any], raw)
        for field_name, digest_name in (
            ("zipPath", "zipSha256"),
            ("checksumPath", "checksumSha256"),
            ("pairPath", "pairSha256"),
        ):
            relative = artifact.get(field_name)
            expected = artifact.get(digest_name)
            if not isinstance(relative, str) or not isinstance(expected, str):
                raise S2GError("SOURCE_MANIFEST_PATH_DIGEST_INVALID")
            path = SOURCE_ROOT / relative
            if not path.is_file() or sha256_path(path) != expected:
                raise S2GError(f"FROZEN_SOURCE_DRIFT:{relative}")
    return frozen


def _load_archive(symbol: str, month: str) -> list[Bar]:
    zip_path, _, _ = _artifact_paths(symbol, month)
    expected_member = f"{symbol}-1d-{month}.csv"
    with zipfile.ZipFile(zip_path, "r") as archive:
        members = archive.infolist()
        if len(members) != 1 or members[0].is_dir() or members[0].filename != expected_member:
            raise S2GError(f"ZIP_MEMBER_SHAPE_INVALID:{symbol}:{month}")
        raw_bytes = archive.read(members[0])
    try:
        text = raw_bytes.decode("utf-8")
    except UnicodeDecodeError as error:
        raise S2GError(f"CSV_UTF8_INVALID:{symbol}:{month}") from error
    rows = list(csv.reader(io.StringIO(text, newline="")))
    if rows and tuple(rows[0]) == KLINE_HEADER:
        rows = rows[1:]
    parsed: list[Bar] = []
    seen: dict[date, tuple[str, ...]] = {}
    last_day: date | None = None
    for row_number, fields in enumerate(rows, start=1):
        bar = parse_bar(symbol, fields, row_number)
        if bar.day.strftime("%Y-%m") != month:
            raise S2GError(f"ARCHIVE_ROW_MONTH_MISMATCH:{symbol}:{month}:{bar.day}")
        prior = seen.get(bar.day)
        if prior is not None:
            raise S2GError(f"DUPLICATE_OR_CONFLICTING_DAY:{symbol}:{bar.day}")
        if last_day is not None and bar.day <= last_day:
            raise S2GError(f"NON_MONOTONIC_DAY:{symbol}:{bar.day}")
        seen[bar.day] = bar.fields
        parsed.append(bar)
        last_day = bar.day
    if not parsed:
        raise S2GError(f"EMPTY_ARCHIVE:{symbol}:{month}")
    try:
        year, month_number = (int(value) for value in month.split("-", maxsplit=1))
        expected_first = date(year, month_number, 1)
        expected_last = date(year, month_number, calendar.monthrange(year, month_number)[1])
    except (TypeError, ValueError) as error:
        raise S2GError(f"ARCHIVE_MONTH_LABEL_INVALID:{symbol}:{month}") from error
    if parsed[0].day != expected_first or parsed[-1].day != expected_last:
        raise S2GError(f"ARCHIVE_MONTH_BOUNDS_INVALID:{symbol}:{month}")
    if any(right.day != left.day + timedelta(days=1) for left, right in itertools.pairwise(parsed)):
        raise S2GError(f"ARCHIVE_DAILY_CONTINUITY_INVALID:{symbol}:{month}")
    return parsed


def load_bars(months: Sequence[str]) -> dict[str, dict[date, Bar]]:
    bars: dict[str, dict[date, Bar]] = {symbol: {} for symbol in FIXED_COHORT}
    for symbol in FIXED_COHORT:
        for month in months:
            for bar in _load_archive(symbol, month):
                if bar.day in bars[symbol]:
                    raise S2GError(f"CROSS_ARCHIVE_DUPLICATE:{symbol}:{bar.day}")
                bars[symbol][bar.day] = bar
    return bars


def merge_bars(
    first: Mapping[str, Mapping[date, Bar]],
    second: Mapping[str, Mapping[date, Bar]],
) -> dict[str, dict[date, Bar]]:
    merged: dict[str, dict[date, Bar]] = {}
    for symbol in FIXED_COHORT:
        rows = dict(first[symbol])
        overlap = set(rows).intersection(second[symbol])
        if overlap:
            raise S2GError(f"MERGE_BAR_OVERLAP:{symbol}:{min(overlap)}")
        rows.update(second[symbol])
        merged[symbol] = rows
    return merged


def _mean(values: Sequence[Decimal], label: str) -> Decimal:
    if not values:
        raise S2GError(f"MEAN_EMPTY:{label}")
    return sum(values, Decimal(0)) / Decimal(len(values))


def _required_bar(
    bars: Mapping[str, Mapping[date, Bar]], symbol: str, day: date, label: str
) -> Bar:
    symbol_bars = bars.get(symbol)
    if symbol_bars is None:
        raise S2GError(f"FIXED_MEMBER_ABSENT:{symbol}")
    try:
        return symbol_bars[day]
    except KeyError as error:
        raise S2GError(f"{label}_DAY_MISSING:{symbol}:{day}") from error


def cross_sectional_percentiles(values: Mapping[str, Decimal]) -> dict[str, Decimal]:
    """Midrank percentiles in [0, 1], with deterministic symbol-complete ties."""
    if set(values) != set(FIXED_COHORT):
        raise S2GError("PERCENTILE_FIXED_COHORT_MISMATCH")
    ordered = sorted(values.items(), key=lambda item: (item[1], item[0]))
    output: dict[str, Decimal] = {}
    cursor = 0
    denominator = Decimal(len(ordered) - 1)
    while cursor < len(ordered):
        end = cursor
        while end + 1 < len(ordered) and ordered[end + 1][1] == ordered[cursor][1]:
            end += 1
        midpoint = (Decimal(cursor) + Decimal(end)) / Decimal(2)
        percentile = midpoint / denominator
        for index in range(cursor, end + 1):
            output[ordered[index][0]] = percentile
        cursor = end + 1
    return output


def signal_for_entry(
    bars: Mapping[str, Mapping[date, Bar]],
    trial: Trial,
    entry_day: date,
) -> FormationSignal:
    """Form the centered weekday-return x lagged-volume joint score at E-2."""
    cutoff = entry_day - timedelta(days=2)
    seasonal: dict[str, Decimal] = {}
    lagged_volume: dict[str, Decimal] = {}
    for symbol in FIXED_COHORT:
        return_days = tuple(
            cutoff - timedelta(days=offset) for offset in range(7 * trial.weekday_weeks, 0, -1)
        )
        all_returns = [
            _required_bar(bars, symbol, day + timedelta(days=1), "SEASONAL_EXIT").open
            / _required_bar(bars, symbol, day, "SEASONAL_ENTRY").open
            - Decimal(1)
            for day in return_days
        ]
        matching_returns = [
            value
            for day, value in zip(return_days, all_returns, strict=True)
            if day.weekday() == entry_day.weekday()
        ]
        if len(matching_returns) != trial.weekday_weeks:
            raise S2GError(f"WEEKDAY_OBSERVATION_COUNT_INVALID:{symbol}:{entry_day}")
        seasonal[symbol] = _mean(matching_returns, f"WEEKDAY:{symbol}") - _mean(
            all_returns,
            f"SYMBOL_MAIN_EFFECT:{symbol}",
        )
        lagged_volume[symbol] = _mean(
            [
                _required_bar(
                    bars,
                    symbol,
                    cutoff - timedelta(days=offset),
                    "VOLUME_FORMATION",
                ).quote_volume
                for offset in range(trial.volume_days)
            ],
            f"VOLUME:{symbol}",
        )

    seasonal_cross_mean = _mean(list(seasonal.values()), "SEASONAL_CROSS_SECTION")
    volume_percentiles = cross_sectional_percentiles(lagged_volume)
    scores = {
        symbol: (seasonal[symbol] - seasonal_cross_mean)
        * (volume_percentiles[symbol] - Decimal("0.5"))
        for symbol in FIXED_COHORT
    }
    ordered = sorted(scores, key=lambda symbol: (scores[symbol], symbol))
    short_symbols = tuple(ordered[: trial.tail_count])
    long_symbols = tuple(reversed(ordered[-trial.tail_count :]))
    active = (
        not set(long_symbols).intersection(short_symbols)
        and all(scores[symbol] > 0 for symbol in long_symbols)
        and all(scores[symbol] < 0 for symbol in short_symbols)
    )
    if not active:
        long_symbols = ()
        short_symbols = ()
    return FormationSignal(
        entry_day=entry_day,
        cutoff_day=cutoff,
        weekday_weeks=trial.weekday_weeks,
        volume_days=trial.volume_days,
        tail_count=trial.tail_count,
        scores=tuple(sorted(scores.items())),
        long_symbols=long_symbols,
        short_symbols=short_symbols,
        active=active,
    )


def target_weights(signal: FormationSignal) -> dict[str, Decimal]:
    weights = {symbol: Decimal(0) for symbol in FIXED_COHORT}
    if not signal.active:
        return weights
    side_weight = Decimal("0.5") / Decimal(signal.tail_count)
    for symbol in signal.long_symbols:
        weights[symbol] = side_weight
    for symbol in signal.short_symbols:
        weights[symbol] = -side_weight
    if sum(weights.values(), Decimal(0)) != 0:
        raise S2GError("TARGET_NOT_MARKET_NEUTRAL")
    if sum((abs(value) for value in weights.values()), Decimal(0)) != 1:
        raise S2GError("TARGET_GROSS_NOT_ONE")
    return weights


def capacity_for_rebalance(
    bars: Mapping[str, Mapping[date, Bar]],
    entry_day: date,
    deltas: Mapping[str, Decimal],
) -> Decimal | None:
    """C_1bp capital ceiling from lagged public quote volume and target deltas."""
    cutoff = entry_day - timedelta(days=2)
    ceilings: list[Decimal] = []
    for symbol in FIXED_COHORT:
        delta = abs(deltas[symbol])
        if delta == 0:
            continue
        volumes = [
            _required_bar(
                bars,
                symbol,
                cutoff - timedelta(days=offset),
                "CAPACITY",
            ).quote_volume
            for offset in range(30)
        ]
        ceilings.append(statistics.median(volumes) * CAPACITY_PARTICIPATION / delta)
    return min(ceilings) if ceilings else None


def rebalance_deltas(
    target: Mapping[str, Decimal],
    current: Mapping[str, Decimal],
    cost_rate: Decimal,
) -> tuple[Decimal, dict[str, Decimal]]:
    """Solve turnover when target weights apply to post-cost NAV."""
    turnover = sum(
        (abs(target[symbol] - current[symbol]) for symbol in FIXED_COHORT),
        Decimal(0),
    )
    for _ in range(256):
        post_cost_factor = Decimal(1) - cost_rate * turnover
        if post_cost_factor <= 0:
            raise S2GError("NONPOSITIVE_REBALANCE_POST_COST_FACTOR")
        deltas = {
            symbol: target[symbol] * post_cost_factor - current[symbol] for symbol in FIXED_COHORT
        }
        updated = sum((abs(value) for value in deltas.values()), Decimal(0))
        if abs(updated - turnover) <= Decimal("1e-40"):
            return updated, deltas
        turnover = updated
    raise S2GError("REBALANCE_TURNOVER_FIXED_POINT_DID_NOT_CONVERGE")


def percentile_decimal(values: Sequence[Decimal], probability: Decimal) -> Decimal:
    if not values:
        raise S2GError("PERCENTILE_EMPTY")
    ordered = sorted(values)
    index = int((Decimal(len(ordered) - 1) * probability).to_integral_value(rounding="ROUND_FLOOR"))
    return ordered[index]


def simulate_trial(
    bars: Mapping[str, Mapping[date, Bar]],
    trial: Trial,
    scenario: Scenario,
    start_day: date,
    end_exclusive: date,
) -> PathMetrics:
    entries = entry_days(start_day, end_exclusive)
    nav = INITIAL_CAPITAL
    current_weights = {symbol: Decimal(0) for symbol in FIXED_COHORT}
    peak = INITIAL_CAPITAL
    max_drawdown = Decimal(0)
    active_days = 0
    valid_formations = 0
    capacities: list[Decimal] = []
    held_symbols: set[str] = set()
    daily_logs: list[float] = []
    monthly_logs: dict[str, float] = {}
    monthly_net: dict[str, Decimal] = {}
    total_turnover = Decimal(0)
    fills = 0
    initial_boundary_log = 0.0
    initial_boundary_index: int | None = None
    final_boundary_log = 0.0

    for entry_index, day in enumerate(entries):
        nav_before = nav
        signal = signal_for_entry(bars, trial, day)
        target = target_weights(signal)
        valid_formations += 1
        cost_rate = scenario.fee_rate + scenario.adverse_rate
        turnover, deltas = rebalance_deltas(
            target,
            current_weights,
            cost_rate,
        )
        total_turnover += turnover
        fills += sum(1 for value in deltas.values() if value != 0)
        if turnover:
            capacity = capacity_for_rebalance(bars, day, deltas)
            if capacity is not None:
                capacities.append(capacity)
        if signal.active:
            active_days += 1
            held_symbols.update((*signal.long_symbols, *signal.short_symbols))

        nav_after_cost = nav * (Decimal(1) - turnover * cost_rate)
        if nav_after_cost <= 0:
            raise S2GError(f"NONPOSITIVE_NAV_AFTER_COST:{trial.trial_id}:{day}")
        max_drawdown = max(max_drawdown, (peak - nav_after_cost) / peak)
        cost_log = math.log(float(nav_after_cost / nav_before))
        if turnover and initial_boundary_index is None:
            initial_boundary_log = cost_log
            initial_boundary_index = entry_index
        next_day = day + timedelta(days=1)
        relatives = {
            symbol: _required_bar(bars, symbol, next_day, "RETURN_EXIT").open
            / _required_bar(bars, symbol, day, "RETURN_ENTRY").open
            for symbol in FIXED_COHORT
        }
        portfolio_return = sum(
            (target[symbol] * (relatives[symbol] - Decimal(1)) for symbol in FIXED_COHORT),
            Decimal(0),
        )
        denominator = Decimal(1) + portfolio_return
        if denominator <= 0:
            raise S2GError(f"NONPOSITIVE_PORTFOLIO_FACTOR:{trial.trial_id}:{day}")
        nav = nav_after_cost * denominator
        if nav <= 0:
            raise S2GError(f"NONPOSITIVE_NAV:{trial.trial_id}:{day}")
        log_return = math.log(float(nav / nav_before))
        daily_logs.append(log_return)
        month = day.strftime("%Y-%m")
        monthly_logs[month] = monthly_logs.get(month, 0.0) + log_return
        monthly_net[month] = monthly_net.get(month, Decimal(0)) + (nav - nav_before)
        peak = max(peak, nav)
        max_drawdown = max(max_drawdown, (peak - nav) / peak)
        current_weights = {
            symbol: target[symbol] * relatives[symbol] / denominator for symbol in FIXED_COHORT
        }

    liquidation_turnover = sum((abs(value) for value in current_weights.values()), Decimal(0))
    if liquidation_turnover:
        nav_before = nav
        total_turnover += liquidation_turnover
        fills += sum(1 for value in current_weights.values() if value != 0)
        liquidation_deltas = {symbol: -current_weights[symbol] for symbol in FIXED_COHORT}
        liquidation_capacity = capacity_for_rebalance(
            bars,
            end_exclusive - timedelta(days=1),
            liquidation_deltas,
        )
        if liquidation_capacity is not None:
            capacities.append(liquidation_capacity)
        nav *= Decimal(1) - liquidation_turnover * (scenario.fee_rate + scenario.adverse_rate)
        if nav <= 0:
            raise S2GError(f"NONPOSITIVE_NAV_FINAL_LIQUIDATION:{trial.trial_id}")
        final_boundary_log = math.log(float(nav / nav_before))
        daily_logs[-1] += final_boundary_log
        month = (end_exclusive - timedelta(days=1)).strftime("%Y-%m")
        monthly_logs[month] = monthly_logs.get(month, 0.0) + final_boundary_log
        monthly_net[month] = monthly_net.get(month, Decimal(0)) + (nav - nav_before)
        max_drawdown = max(max_drawdown, (peak - nav) / peak)

    inference_logs = list(daily_logs)
    boundary_log = initial_boundary_log + final_boundary_log
    if initial_boundary_index is not None:
        inference_logs[initial_boundary_index] -= initial_boundary_log
    if final_boundary_log:
        inference_logs[-1] -= final_boundary_log
    boundary_per_observation = boundary_log / len(inference_logs)
    inference_logs = [value + boundary_per_observation for value in inference_logs]
    if not math.isclose(sum(inference_logs), sum(daily_logs), rel_tol=0, abs_tol=1e-12):
        raise S2GError("INFERENCE_BOUNDARY_COST_AMORTIZATION_DRIFT")

    capacity_p05 = percentile_decimal(capacities, Decimal("0.05")) if capacities else None
    return PathMetrics(
        trial_id=trial.trial_id,
        scenario=scenario.name,
        start_day=start_day,
        end_exclusive=end_exclusive,
        final_nav=nav,
        net_usdt=nav - INITIAL_CAPITAL,
        valid_formations=valid_formations,
        active_days=active_days,
        fills=fills,
        distinct_held_symbols=len(held_symbols),
        maximum_drawdown_pct=max_drawdown * Decimal(100),
        positive_months=sum(1 for value in monthly_net.values() if value > 0),
        capacity_p05_usdt=capacity_p05,
        mean_daily_turnover=total_turnover / Decimal(len(entries)),
        boundary_cost_log_return=boundary_log,
        daily_log_returns=tuple(inference_logs),
        monthly_log_returns=tuple(sorted(monthly_logs.items())),
        monthly_net_usdt=tuple(sorted(monthly_net.items())),
    )


def circular_indices(length: int, block_length: int, rng: random.Random) -> list[int]:
    if length <= 0:
        raise S2GError("BOOTSTRAP_LENGTH_INVALID")
    output: list[int] = []
    while len(output) < length:
        start = rng.randrange(length)
        output.extend((start + offset) % length for offset in range(block_length))
    return output[:length]


def bootstrap_inference(
    log_returns: Sequence[float],
    *,
    seed: int,
    replicates: int = BOOTSTRAP_REPLICATES,
    block_length: int = BOOTSTRAP_BLOCK_DAYS,
) -> dict[str, Decimal]:
    if not log_returns:
        raise S2GError("BOOTSTRAP_RETURNS_EMPTY")
    observed_log = sum(log_returns)
    mean = observed_log / len(log_returns)
    centered = [value - mean for value in log_returns]
    rng = random.Random(seed)
    totals: list[float] = []
    null_totals: list[float] = []
    for _ in range(replicates):
        indices = circular_indices(len(log_returns), block_length, rng)
        totals.append(sum(log_returns[index] for index in indices))
        null_totals.append(sum(centered[index] for index in indices))
    totals.sort()
    lower_index = int((replicates - 1) * 0.05)
    upper_index = int((replicates - 1) * 0.95)

    def to_usdt(value: float) -> Decimal:
        return INITIAL_CAPITAL * Decimal(str(math.expm1(value)))

    p_value = Decimal(1 + sum(1 for value in null_totals if value >= observed_log)) / Decimal(
        replicates + 1
    )
    return {
        "lcb5Usdt": to_usdt(totals[lower_index]),
        "pValueOneSided": p_value,
        "twoSided90LowerUsdt": to_usdt(totals[lower_index]),
        "twoSided90UpperUsdt": to_usdt(totals[upper_index]),
    }


def holm_adjust(raw: Mapping[str, Decimal]) -> dict[str, Decimal]:
    ordered = sorted(raw.items(), key=lambda item: (item[1], item[0]))
    adjusted: dict[str, Decimal] = {}
    running = Decimal(0)
    count = len(ordered)
    for rank, (trial_id, value) in enumerate(ordered):
        running = max(running, min(Decimal(1), Decimal(count - rank) * value))
        adjusted[trial_id] = running
    return adjusted


def white_reality_check(
    paths: Mapping[str, Sequence[float]],
    *,
    seed: int,
    replicates: int = BOOTSTRAP_REPLICATES,
    block_length: int = BOOTSTRAP_BLOCK_DAYS,
) -> Decimal:
    if not paths:
        raise S2GError("WHITE_PATHS_EMPTY")
    lengths = {len(values) for values in paths.values()}
    if len(lengths) != 1:
        raise S2GError("WHITE_PATHS_NOT_SYNCHRONOUS")
    length = lengths.pop()
    observed = max(sum(values) for values in paths.values())
    centered = {
        trial_id: [value - (sum(values) / length) for value in values]
        for trial_id, values in paths.items()
    }
    rng = random.Random(seed)
    exceed = 0
    for _ in range(replicates):
        indices = circular_indices(length, block_length, rng)
        maximum = max(sum(values[index] for index in indices) for values in centered.values())
        if maximum >= observed:
            exceed += 1
    return Decimal(exceed + 1) / Decimal(replicates + 1)


def pbo_cscv(paths: Mapping[str, PathMetrics]) -> dict[str, object]:
    if not paths:
        raise S2GError("PBO_PATHS_EMPTY")
    trial_ids = sorted(paths)
    months = sorted({month for path in paths.values() for month, _ in path.monthly_log_returns})
    if len(months) != 8:
        return {
            "blocks": months,
            "negativeLogitCount": None,
            "pboOfImplementedSelectionRule": None,
            "selectionRuleReproduced": False,
            "status": "UNMEASURED_REQUIRES_EIGHT_DEVELOPMENT_MONTHS",
        }
    by_trial = {trial_id: dict(paths[trial_id].monthly_log_returns) for trial_id in trial_ids}
    logits: list[float] = []
    for in_sample_indices in itertools.combinations(range(8), 4):
        in_sample = set(in_sample_indices)
        out_sample = set(range(8)).difference(in_sample)
        in_sample_scores = {
            trial_id: sum(by_trial[trial_id].get(months[index], 0.0) for index in in_sample)
            for trial_id in trial_ids
        }
        best_score = max(in_sample_scores.values())
        champion = min(
            trial_id
            for trial_id, trial_score in in_sample_scores.items()
            if trial_score == best_score
        )
        scores = {
            trial_id: sum(by_trial[trial_id].get(months[index], 0.0) for index in out_sample)
            for trial_id in trial_ids
        }
        champion_score = scores[champion]
        lower = sum(1 for score in scores.values() if score < champion_score)
        equal = sum(1 for score in scores.values() if score == champion_score)
        relative_rank = (Decimal(lower) + Decimal(equal) / Decimal(2)) / Decimal(len(trial_ids))
        epsilon = Decimal("1e-12")
        relative_rank = min(Decimal(1) - epsilon, max(epsilon, relative_rank))
        logits.append(math.log(float(relative_rank / (Decimal(1) - relative_rank))))
    negative = sum(1 for value in logits if value <= 0)
    pbo = Decimal(negative) / Decimal(len(logits))
    return {
        "blocks": months,
        "metric": "SUM_MONTHLY_PUBLIC_STRESS_LOG_RETURN",
        "negativeLogitCount": negative,
        "pboOfImplementedSelectionRule": str(pbo),
        "selectionRuleReproduced": True,
        "splitCount": len(logits),
        "status": "MEASURED",
    }


def _metrics_dict(path: PathMetrics) -> dict[str, object]:
    value = asdict(path)
    value.pop("daily_log_returns")
    value["start_day"] = path.start_day.isoformat()
    value["end_exclusive"] = path.end_exclusive.isoformat()
    value["final_nav"] = str(path.final_nav)
    value["net_usdt"] = str(path.net_usdt)
    value["maximum_drawdown_pct"] = str(path.maximum_drawdown_pct)
    value["capacity_p05_usdt"] = (
        str(path.capacity_p05_usdt) if path.capacity_p05_usdt is not None else None
    )
    value["mean_daily_turnover"] = str(path.mean_daily_turnover)
    value["monthly_log_returns"] = [
        [month, format(log_return, ".17g")] for month, log_return in path.monthly_log_returns
    ]
    value["monthly_net_usdt"] = [[month, str(net)] for month, net in path.monthly_net_usdt]
    return value


def development_gate_rows(
    stress: PathMetrics,
    inference: Mapping[str, Decimal],
    holm_p: Decimal,
    white_p: Decimal,
) -> dict[str, bool]:
    return {
        "activeDaysAtLeast120": stress.active_days >= 120,
        "capacityP05AtLeast1000": stress.capacity_p05_usdt is not None
        and stress.capacity_p05_usdt >= Decimal("1000"),
        "distinctSymbolsAtLeast8": stress.distinct_held_symbols >= 8,
        "drawdownAtMost25Pct": stress.maximum_drawdown_pct <= Decimal("25"),
        "holmPBelow0.05": holm_p < Decimal("0.05"),
        "lcbAboveZero": inference["lcb5Usdt"] > 0,
        "netAboveZero": stress.net_usdt > 0,
        "positiveMonthsAtLeast5": stress.positive_months >= 5,
        "rawPBelow0.05": inference["pValueOneSided"] < Decimal("0.05"),
        "validFormationsAtLeast200": stress.valid_formations >= 200,
        "whitePBelow0.05": white_p < Decimal("0.05"),
    }


def holdout_gate_rows(
    paths: Mapping[str, PathMetrics], inference: Mapping[str, Decimal]
) -> dict[str, bool]:
    stress = paths["PUBLIC_STRESS"]
    return {
        "activeDaysAtLeast60": stress.active_days >= 60,
        "baseNetAboveZero": paths["PUBLIC_BASE"].net_usdt > 0,
        "capacityP05AtLeast1000": stress.capacity_p05_usdt is not None
        and stress.capacity_p05_usdt >= Decimal("1000"),
        "distinctSymbolsAtLeast6": stress.distinct_held_symbols >= 6,
        "drawdownAtMost25Pct": stress.maximum_drawdown_pct <= Decimal("25"),
        "feeStressNetAboveZero": paths["FEE_STRESS"].net_usdt > 0,
        "lcbAboveZero": inference["lcb5Usdt"] > 0,
        "netAboveZero": stress.net_usdt > 0,
        "positiveMonthsAtLeast3": stress.positive_months >= 3,
        "rawPBelow0.05": inference["pValueOneSided"] < Decimal("0.05"),
        "validFormationsAtLeast100": stress.valid_formations >= 100,
    }


def evaluate_development(
    bars: Mapping[str, Mapping[date, Bar]],
) -> tuple[dict[str, object], Trial | None]:
    trials = trial_grid()
    paths: dict[str, dict[str, PathMetrics]] = {}
    inference: dict[str, dict[str, Decimal]] = {}
    for index, trial in enumerate(trials):
        scenario_paths = {
            scenario.name: simulate_trial(bars, trial, scenario, DEVELOPMENT_START, DEVELOPMENT_END)
            for scenario in SCENARIOS
        }
        paths[trial.trial_id] = scenario_paths
        inference[trial.trial_id] = bootstrap_inference(
            scenario_paths["PUBLIC_STRESS"].daily_log_returns,
            seed=BOOTSTRAP_SEED + index,
        )
    raw_p = {trial_id: values["pValueOneSided"] for trial_id, values in inference.items()}
    holm = holm_adjust(raw_p)
    white = white_reality_check(
        {
            trial_id: scenario_paths["PUBLIC_STRESS"].daily_log_returns
            for trial_id, scenario_paths in paths.items()
        },
        seed=BOOTSTRAP_SEED + 1000,
    )
    pbo = pbo_cscv({key: value["PUBLIC_STRESS"] for key, value in paths.items()})
    pbo_value_raw = pbo.get("pboOfImplementedSelectionRule")
    if not isinstance(pbo_value_raw, str):
        raise S2GError("PBO_IMPLEMENTED_SELECTION_RULE_UNMEASURED")
    pbo_value = decimal_field(pbo_value_raw, "PBO")
    if pbo_value < 0 or pbo_value > 1:
        raise S2GError("PBO_IMPLEMENTED_SELECTION_RULE_OUT_OF_RANGE")
    gate_rows = {
        trial.trial_id: development_gate_rows(
            paths[trial.trial_id]["PUBLIC_STRESS"],
            inference[trial.trial_id],
            holm[trial.trial_id],
            white,
        )
        for trial in trials
    }
    qualifying = [trial for trial in trials if all(gate_rows[trial.trial_id].values())]
    best_net = max(paths[trial.trial_id]["PUBLIC_STRESS"].net_usdt for trial in trials)
    selected = min(
        (trial for trial in trials if paths[trial.trial_id]["PUBLIC_STRESS"].net_usdt == best_net),
        key=lambda trial: trial.trial_id,
    )
    champion = selected if all(gate_rows[selected.trial_id].values()) else None
    payload: dict[str, object] = {
        "championTrialId": champion.trial_id if champion else None,
        "holmAdjustedP": {key: str(value) for key, value in sorted(holm.items())},
        "pbo": pbo,
        "qualifyingTrialIds": [trial.trial_id for trial in qualifying],
        "selectedTrialId": selected.trial_id,
        "trialCount": len(trials),
        "trials": {
            trial.trial_id: {
                "gates": gate_rows[trial.trial_id],
                "inference": {
                    key: str(value) for key, value in sorted(inference[trial.trial_id].items())
                },
                "paths": {
                    scenario: _metrics_dict(path)
                    for scenario, path in sorted(paths[trial.trial_id].items())
                },
            }
            for trial in trials
        },
        "whiteRealityCheckP": str(white),
    }
    return payload, champion


def _marker_payload(schema: str, **extra: object) -> dict[str, object]:
    return {
        "baseCommit": BASE_COMMIT,
        "freezeSha256": sha256_path(FREEZE_PATH),
        "protocolSha256": sha256_path(PROTOCOL_PATH),
        "schema": schema,
        **extra,
    }


def _trial_payload(trial: Trial) -> dict[str, object]:
    return {
        "tailCount": trial.tail_count,
        "trialId": trial.trial_id,
        "volumeDays": trial.volume_days,
        "weekdayWeeks": trial.weekday_weeks,
    }


def _terminal_result(
    verdict: str,
    *,
    development: Mapping[str, object] | None,
    holdout: Mapping[str, object] | None,
    blocker: str | None,
    terminal_phase: str,
) -> dict[str, object]:
    return {
        "accountEffectiveFees": "UNKNOWN",
        "authority": "NONE",
        "blocker": blocker,
        "candidateSealSha256": (
            sha256_path(CANDIDATE_SEAL_PATH) if CANDIDATE_SEAL_PATH.is_file() else None
        ),
        "capitalVerdict": "NO_GO",
        "consumer": "N3 successor/final convergence",
        "development": development,
        "executableCapacity": "UNMEASURED",
        "globalHoldoutStatus": "NOT_CERTIFIED_SHARED_REUSE_RISK",
        "holdout": holdout,
        "limitations": list(TERMINAL_LIMITATIONS),
        "packetHoldoutState": (
            "OPENED_ONCE_MEASURED"
            if holdout is not None
            else ("OPENED_ONCE_INCOMPLETE" if HOLDOUT_MARKER_PATH.is_file() else "UNOPENED")
        ),
        "holdoutMarkerSha256": (
            sha256_path(HOLDOUT_MARKER_PATH) if HOLDOUT_MARKER_PATH.is_file() else None
        ),
        "protocolSha256": sha256_path(PROTOCOL_PATH),
        "runMarkerSha256": sha256_path(RUN_MARKER_PATH),
        "schema": "S2GTerminalResultCoreV1",
        "shortBorrowAvailabilityAndCost": "UNKNOWN_NOT_MODELED",
        "spotShortLeg": "SYNTHETIC_RESEARCH_ONLY_NO_BORROW_OR_EXECUTION_AUTHORITY",
        "terminalPhase": terminal_phase,
        "verdict": verdict,
    }


def run() -> None:
    assert_frozen()
    assert_runtime_contract()
    if any(
        path.exists()
        for path in (
            RUN_MARKER_PATH,
            CANDIDATE_SEAL_PATH,
            HOLDOUT_MARKER_PATH,
            TERMINAL_CORE_PATH,
            RESULT_PATH,
        )
    ):
        raise S2GError("RUN_OR_OUTCOME_STATE_ALREADY_EXISTS")
    preoutcome_snapshot = frozen_candidate_snapshot()
    STATE_ROOT.mkdir(parents=True, exist_ok=True)
    write_exclusive(
        RUN_MARKER_PATH,
        _marker_payload(
            "S2GRunMarkerV1",
            archiveMembersOpenedBeforeMarker=0,
            allowedRunCount=1,
            preOutcomeSnapshot=preoutcome_snapshot,
        ),
    )
    development_payload: dict[str, object] | None = None
    holdout_payload: dict[str, object] | None = None
    phase = "DEVELOPMENT_LOAD"
    try:
        development_bars = load_bars(DEVELOPMENT_MONTHS)
        phase = "DEVELOPMENT_EVALUATION"
        development_payload, champion = evaluate_development(development_bars)
        if champion is None:
            core = _terminal_result(
                "NO_GO",
                development=development_payload,
                holdout=None,
                blocker=None,
                terminal_phase="DEVELOPMENT_GATES_FAILED",
            )
        else:
            phase = "CANDIDATE_SEAL"
            write_exclusive(
                CANDIDATE_SEAL_PATH,
                _marker_payload(
                    "S2GCandidateSealV1",
                    championTrial=_trial_payload(champion),
                    developmentSha256=canonical_sha(development_payload),
                ),
            )
            phase = "HOLDOUT_MARKER"
            write_exclusive(
                HOLDOUT_MARKER_PATH,
                _marker_payload(
                    "S2GHoldoutOpenMarkerV1",
                    allowedOpenCount=1,
                    candidateSealSha256=sha256_path(CANDIDATE_SEAL_PATH),
                    holdoutMembersOpenedBeforeMarker=0,
                ),
            )
            phase = "HOLDOUT_LOAD"
            holdout_bars = load_bars(HOLDOUT_MONTHS)
            phase = "HOLDOUT_EVALUATION"
            all_bars = merge_bars(development_bars, holdout_bars)
            holdout_paths = {
                scenario.name: simulate_trial(
                    all_bars, champion, scenario, HOLDOUT_START, EVALUATION_END
                )
                for scenario in SCENARIOS
            }
            holdout_inference = bootstrap_inference(
                holdout_paths["PUBLIC_STRESS"].daily_log_returns,
                seed=BOOTSTRAP_SEED + 2000,
            )
            holdout_gates = holdout_gate_rows(holdout_paths, holdout_inference)
            holdout_payload = {
                "championTrialId": champion.trial_id,
                "gates": holdout_gates,
                "inference": {key: str(value) for key, value in sorted(holdout_inference.items())},
                "paths": {
                    scenario: _metrics_dict(path)
                    for scenario, path in sorted(holdout_paths.items())
                },
            }
            core = _terminal_result(
                "GO" if all(holdout_gates.values()) else "NO_GO",
                development=development_payload,
                holdout=holdout_payload,
                blocker=None,
                terminal_phase="HOLDOUT_MEASURED",
            )
    except Exception as error:
        core = _terminal_result(
            "UNMEASURED",
            development=development_payload,
            holdout=holdout_payload,
            blocker=f"{type(error).__name__}:{error}",
            terminal_phase=phase,
        )
    write_once_or_match(TERMINAL_CORE_PATH, core)
    result = {
        **core,
        "schema": "S2GResultV1",
        "terminalCoreSha256": sha256_path(TERMINAL_CORE_PATH),
    }
    write_once_or_match(RESULT_PATH, result)


def _validate_common_marker(marker: Mapping[str, Any], schema: str) -> None:
    if marker.get("schema") != schema:
        raise S2GError(f"{schema}_SCHEMA_INVALID")
    if marker.get("baseCommit") != BASE_COMMIT:
        raise S2GError(f"{schema}_BASE_INVALID")
    if marker.get("protocolSha256") != sha256_path(PROTOCOL_PATH):
        raise S2GError(f"{schema}_PROTOCOL_DIGEST_MISMATCH")
    if marker.get("freezeSha256") != sha256_path(FREEZE_PATH):
        raise S2GError(f"{schema}_FREEZE_DIGEST_MISMATCH")


def _validate_preoutcome_snapshot(value: object) -> None:
    if not isinstance(value, dict):
        raise S2GError("RUN_MARKER_SNAPSHOT_INVALID")
    changed_paths = value.get("changedPaths")
    required = sorted(
        {
            str(path.relative_to(REPO_ROOT))
            for path in (
                *static_paths(),
                SOURCE_MANIFEST_PATH,
                FREEZE_PATH,
                SHA256SUMS_PATH,
            )
        }
    )
    frozen = read_json(FREEZE_PATH)
    frozen_git = frozen.get("git")
    if not isinstance(frozen_git, dict):
        raise S2GError("RUN_MARKER_FREEZE_GIT_INVALID")
    if value.get("baseHead") != BASE_COMMIT or value.get("baseHead") != frozen_git.get("head"):
        raise S2GError("RUN_MARKER_BASE_HEAD_INVALID")
    if value.get("baseTree") != frozen_git.get("tree"):
        raise S2GError("RUN_MARKER_BASE_TREE_INVALID")
    if changed_paths != required:
        raise S2GError("RUN_MARKER_SNAPSHOT_PATHS_INVALID")
    if value.get("changedPathsSha256") != canonical_sha(changed_paths):
        raise S2GError("RUN_MARKER_SNAPSHOT_PATH_DIGEST_MISMATCH")
    packet_files = value.get("packetFiles")
    expected_packet_files = {path: sha256_path(REPO_ROOT / path) for path in required}
    if packet_files != expected_packet_files:
        raise S2GError("RUN_MARKER_SNAPSHOT_FILE_DIGESTS_INVALID")
    if value.get("packetFilesSha256") != canonical_sha(expected_packet_files):
        raise S2GError("RUN_MARKER_SNAPSHOT_DIGEST_MISMATCH")


def _selection_net_from_result(trial: Trial, row: Mapping[str, Any]) -> Decimal:
    paths = row.get("paths")
    if not isinstance(paths, dict):
        raise S2GError(f"DEVELOPMENT_SELECTION_FIELDS_INVALID:{trial.trial_id}")
    stress = paths.get("PUBLIC_STRESS")
    if not isinstance(stress, dict):
        raise S2GError(f"DEVELOPMENT_STRESS_PATH_INVALID:{trial.trial_id}")
    net_raw = stress.get("net_usdt")
    if not isinstance(net_raw, str):
        raise S2GError(f"DEVELOPMENT_SELECTION_DECIMAL_INVALID:{trial.trial_id}")
    return decimal_field(net_raw, f"{trial.trial_id}:net_usdt")


def _record_mapping(value: object, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise S2GError(f"RESULT_MAPPING_INVALID:{label}")
    return cast(dict[str, Any], value)


def _record_decimal(row: Mapping[str, Any], key: str, label: str) -> Decimal:
    raw = row.get(key)
    if not isinstance(raw, str):
        raise S2GError(f"RESULT_DECIMAL_INVALID:{label}:{key}")
    return decimal_field(raw, f"{label}:{key}")


def _record_int(row: Mapping[str, Any], key: str, label: str) -> int:
    raw = row.get(key)
    if not isinstance(raw, int) or isinstance(raw, bool):
        raise S2GError(f"RESULT_INTEGER_INVALID:{label}:{key}")
    return raw


def _monthly_records(
    value: object,
    *,
    label: str,
    expected_months: Sequence[str],
    decimal_values: bool,
) -> dict[str, Decimal | float]:
    if not isinstance(value, list):
        raise S2GError(f"RESULT_MONTHLY_RECORDS_INVALID:{label}")
    output: dict[str, Decimal | float] = {}
    for raw_row in value:
        if (
            not isinstance(raw_row, list)
            or len(raw_row) != 2
            or not isinstance(raw_row[0], str)
            or not isinstance(raw_row[1], str)
        ):
            raise S2GError(f"RESULT_MONTHLY_ROW_INVALID:{label}")
        month, raw_value = raw_row
        if month in output:
            raise S2GError(f"RESULT_MONTHLY_DUPLICATE:{label}:{month}")
        if decimal_values:
            parsed: Decimal | float = decimal_field(raw_value, f"{label}:{month}")
        else:
            try:
                parsed = float(raw_value)
            except ValueError as error:
                raise S2GError(f"RESULT_MONTHLY_FLOAT_INVALID:{label}:{month}") from error
            if not math.isfinite(parsed):
                raise S2GError(f"RESULT_MONTHLY_FLOAT_NONFINITE:{label}:{month}")
        output[month] = parsed
    if list(output) != list(expected_months):
        raise S2GError(f"RESULT_MONTHLY_COVERAGE_INVALID:{label}")
    return output


def _validate_path_record(
    row: Mapping[str, Any],
    *,
    trial_id: str,
    scenario: str,
    start_day: date,
    end_exclusive: date,
    expected_months: Sequence[str],
) -> None:
    label = f"{trial_id}:{scenario}"
    if set(row) != PATH_RECORD_NAMES:
        raise S2GError(f"RESULT_PATH_FIELDS_INVALID:{label}")
    if row.get("trial_id") != trial_id or row.get("scenario") != scenario:
        raise S2GError(f"RESULT_PATH_IDENTITY_INVALID:{label}")
    if row.get("start_day") != start_day.isoformat():
        raise S2GError(f"RESULT_PATH_START_INVALID:{label}")
    if row.get("end_exclusive") != end_exclusive.isoformat():
        raise S2GError(f"RESULT_PATH_END_INVALID:{label}")
    final_nav = _record_decimal(row, "final_nav", label)
    net = _record_decimal(row, "net_usdt", label)
    if final_nav <= 0 or final_nav - INITIAL_CAPITAL != net:
        raise S2GError(f"RESULT_PATH_NAV_RECONCILIATION_INVALID:{label}")
    valid_formations = _record_int(row, "valid_formations", label)
    if valid_formations != len(entry_days(start_day, end_exclusive)):
        raise S2GError(f"RESULT_PATH_FORMATION_COUNT_INVALID:{label}")
    active_days = _record_int(row, "active_days", label)
    if active_days < 0 or active_days > valid_formations:
        raise S2GError(f"RESULT_PATH_ACTIVE_DAY_COUNT_INVALID:{label}")
    fills = _record_int(row, "fills", label)
    distinct = _record_int(row, "distinct_held_symbols", label)
    positive_months = _record_int(row, "positive_months", label)
    if fills < 0 or distinct < 0 or distinct > len(FIXED_COHORT):
        raise S2GError(f"RESULT_PATH_COUNT_RANGE_INVALID:{label}")
    drawdown = _record_decimal(row, "maximum_drawdown_pct", label)
    turnover = _record_decimal(row, "mean_daily_turnover", label)
    if drawdown < 0 or drawdown >= 100 or turnover < 0:
        raise S2GError(f"RESULT_PATH_RISK_RANGE_INVALID:{label}")
    capacity_raw = row.get("capacity_p05_usdt")
    if capacity_raw is not None:
        if not isinstance(capacity_raw, str):
            raise S2GError(f"RESULT_PATH_CAPACITY_INVALID:{label}")
        if decimal_field(capacity_raw, f"{label}:capacity") <= 0:
            raise S2GError(f"RESULT_PATH_CAPACITY_NONPOSITIVE:{label}")
    boundary = row.get("boundary_cost_log_return")
    if (
        not isinstance(boundary, (float, int))
        or isinstance(boundary, bool)
        or not math.isfinite(float(boundary))
        or float(boundary) > 1e-15
    ):
        raise S2GError(f"RESULT_PATH_BOUNDARY_COST_INVALID:{label}")
    if scenario == "PUBLIC_GROSS" and not math.isclose(
        float(boundary), 0.0, rel_tol=0, abs_tol=1e-15
    ):
        raise S2GError(f"RESULT_PATH_GROSS_BOUNDARY_COST_INVALID:{label}")
    monthly_net = _monthly_records(
        row.get("monthly_net_usdt"),
        label=f"{label}:monthly_net_usdt",
        expected_months=expected_months,
        decimal_values=True,
    )
    if sum((cast(Decimal, value) for value in monthly_net.values()), Decimal(0)) != net:
        raise S2GError(f"RESULT_PATH_MONTHLY_NET_RECONCILIATION_INVALID:{label}")
    if sum(1 for value in monthly_net.values() if cast(Decimal, value) > 0) != positive_months:
        raise S2GError(f"RESULT_PATH_POSITIVE_MONTH_COUNT_INVALID:{label}")
    monthly_log = _monthly_records(
        row.get("monthly_log_returns"),
        label=f"{label}:monthly_log_returns",
        expected_months=expected_months,
        decimal_values=False,
    )
    expected_total_log = math.log(float(final_nav / INITIAL_CAPITAL))
    observed_total_log = sum(cast(float, value) for value in monthly_log.values())
    if not math.isclose(observed_total_log, expected_total_log, rel_tol=0, abs_tol=1e-11):
        raise S2GError(f"RESULT_PATH_MONTHLY_LOG_RECONCILIATION_INVALID:{label}")


def _validate_paths_record(
    value: object,
    *,
    trial_id: str,
    start_day: date,
    end_exclusive: date,
    expected_months: Sequence[str],
) -> dict[str, Any]:
    paths = _record_mapping(value, f"{trial_id}:paths")
    if set(paths) != SCENARIO_NAMES:
        raise S2GError(f"RESULT_SCENARIO_FAMILY_INVALID:{trial_id}")
    for scenario in sorted(SCENARIO_NAMES):
        row = _record_mapping(paths[scenario], f"{trial_id}:{scenario}")
        _validate_path_record(
            row,
            trial_id=trial_id,
            scenario=scenario,
            start_day=start_day,
            end_exclusive=end_exclusive,
            expected_months=expected_months,
        )
    return paths


def _record_inference(row: Mapping[str, Any], label: str) -> dict[str, Decimal]:
    raw = _record_mapping(row.get("inference"), f"{label}:inference")
    if set(raw) != BOOTSTRAP_RESULT_NAMES:
        raise S2GError(f"RESULT_INFERENCE_FIELDS_INVALID:{label}")
    output = {key: _record_decimal(raw, key, f"{label}:inference") for key in raw}
    if output["pValueOneSided"] <= 0 or output["pValueOneSided"] > 1:
        raise S2GError(f"RESULT_INFERENCE_P_OUT_OF_RANGE:{label}")
    return output


def _development_gates_from_record(
    row: Mapping[str, Any],
    holm_p: Decimal,
    white_p: Decimal,
    label: str,
) -> dict[str, bool]:
    paths = _record_mapping(row.get("paths"), f"{label}:paths")
    stress = _record_mapping(paths.get("PUBLIC_STRESS"), f"{label}:PUBLIC_STRESS")
    inference = _record_inference(row, label)
    capacity_raw = stress.get("capacity_p05_usdt")
    capacity = (
        decimal_field(capacity_raw, f"{label}:capacity_p05_usdt")
        if isinstance(capacity_raw, str)
        else None
    )
    return {
        "activeDaysAtLeast120": _record_int(stress, "active_days", label) >= 120,
        "capacityP05AtLeast1000": capacity is not None and capacity >= Decimal("1000"),
        "distinctSymbolsAtLeast8": _record_int(stress, "distinct_held_symbols", label) >= 8,
        "drawdownAtMost25Pct": _record_decimal(stress, "maximum_drawdown_pct", label)
        <= Decimal("25"),
        "holmPBelow0.05": holm_p < Decimal("0.05"),
        "lcbAboveZero": inference["lcb5Usdt"] > 0,
        "netAboveZero": _record_decimal(stress, "net_usdt", label) > 0,
        "positiveMonthsAtLeast5": _record_int(stress, "positive_months", label) >= 5,
        "rawPBelow0.05": inference["pValueOneSided"] < Decimal("0.05"),
        "validFormationsAtLeast200": _record_int(stress, "valid_formations", label) >= 200,
        "whitePBelow0.05": white_p < Decimal("0.05"),
    }


def _holdout_gates_from_record(holdout: Mapping[str, Any]) -> dict[str, bool]:
    paths = _record_mapping(holdout.get("paths"), "holdout:paths")
    stress = _record_mapping(paths.get("PUBLIC_STRESS"), "holdout:PUBLIC_STRESS")
    base = _record_mapping(paths.get("PUBLIC_BASE"), "holdout:PUBLIC_BASE")
    fee_stress = _record_mapping(paths.get("FEE_STRESS"), "holdout:FEE_STRESS")
    inference = _record_inference(holdout, "holdout")
    capacity_raw = stress.get("capacity_p05_usdt")
    capacity = (
        decimal_field(capacity_raw, "holdout:capacity_p05_usdt")
        if isinstance(capacity_raw, str)
        else None
    )
    return {
        "activeDaysAtLeast60": _record_int(stress, "active_days", "holdout") >= 60,
        "baseNetAboveZero": _record_decimal(base, "net_usdt", "holdout:base") > 0,
        "capacityP05AtLeast1000": capacity is not None and capacity >= Decimal("1000"),
        "distinctSymbolsAtLeast6": _record_int(stress, "distinct_held_symbols", "holdout") >= 6,
        "drawdownAtMost25Pct": _record_decimal(stress, "maximum_drawdown_pct", "holdout")
        <= Decimal("25"),
        "feeStressNetAboveZero": _record_decimal(fee_stress, "net_usdt", "holdout:fee_stress") > 0,
        "lcbAboveZero": inference["lcb5Usdt"] > 0,
        "netAboveZero": _record_decimal(stress, "net_usdt", "holdout") > 0,
        "positiveMonthsAtLeast3": _record_int(stress, "positive_months", "holdout") >= 3,
        "rawPBelow0.05": inference["pValueOneSided"] < Decimal("0.05"),
        "validFormationsAtLeast100": _record_int(stress, "valid_formations", "holdout") >= 100,
    }


def verify_terminal_state(result: Mapping[str, Any]) -> None:
    if set(result) != RESULT_RECORD_NAMES:
        raise S2GError("RESULT_FIELDS_INVALID")
    if result.get("schema") != "S2GResultV1":
        raise S2GError("RESULT_SCHEMA_INVALID")
    verdict = result.get("verdict")
    if verdict not in {"GO", "NO_GO", "UNMEASURED"}:
        raise S2GError("RESULT_VERDICT_INVALID")
    if result.get("authority") != "NONE" or result.get("capitalVerdict") != "NO_GO":
        raise S2GError("RESULT_AUTHORITY_INVALID")
    if result.get("protocolSha256") != sha256_path(PROTOCOL_PATH):
        raise S2GError("RESULT_PROTOCOL_DIGEST_MISMATCH")
    if result.get("consumer") != "N3 successor/final convergence":
        raise S2GError("RESULT_CONSUMER_INVALID")
    if result.get("accountEffectiveFees") != "UNKNOWN":
        raise S2GError("RESULT_ACCOUNT_FEE_AUTHORITY_INVALID")
    if result.get("executableCapacity") != "UNMEASURED":
        raise S2GError("RESULT_EXECUTABLE_CAPACITY_INVALID")
    if result.get("globalHoldoutStatus") != "NOT_CERTIFIED_SHARED_REUSE_RISK":
        raise S2GError("RESULT_GLOBAL_HOLDOUT_STATUS_INVALID")
    if result.get("limitations") != list(TERMINAL_LIMITATIONS):
        raise S2GError("RESULT_LIMITATIONS_INVALID")
    if result.get("shortBorrowAvailabilityAndCost") != "UNKNOWN_NOT_MODELED":
        raise S2GError("RESULT_SHORT_BORROW_TRUTH_INVALID")
    if result.get("spotShortLeg") != "SYNTHETIC_RESEARCH_ONLY_NO_BORROW_OR_EXECUTION_AUTHORITY":
        raise S2GError("RESULT_SHORT_LEG_AUTHORITY_INVALID")
    blocker = result.get("blocker")
    terminal_phase = result.get("terminalPhase")
    if verdict == "UNMEASURED":
        if not isinstance(blocker, str) or not blocker:
            raise S2GError("UNMEASURED_BLOCKER_ABSENT")
    elif blocker is not None:
        raise S2GError("MEASURED_BLOCKER_PRESENT")

    if not RUN_MARKER_PATH.is_file():
        raise S2GError("RUN_MARKER_ABSENT")
    run_marker = read_json(RUN_MARKER_PATH)
    _validate_common_marker(run_marker, "S2GRunMarkerV1")
    if run_marker.get("allowedRunCount") != 1:
        raise S2GError("RUN_MARKER_COUNT_INVALID")
    if run_marker.get("archiveMembersOpenedBeforeMarker") != 0:
        raise S2GError("RUN_MARKER_PRIOR_OPEN_COUNT_INVALID")
    _validate_preoutcome_snapshot(run_marker.get("preOutcomeSnapshot"))
    if result.get("runMarkerSha256") != sha256_path(RUN_MARKER_PATH):
        raise S2GError("RESULT_RUN_MARKER_DIGEST_MISMATCH")

    candidate_exists = CANDIDATE_SEAL_PATH.is_file()
    holdout_marker_exists = HOLDOUT_MARKER_PATH.is_file()
    expected_candidate_sha = sha256_path(CANDIDATE_SEAL_PATH) if candidate_exists else None
    expected_holdout_sha = sha256_path(HOLDOUT_MARKER_PATH) if holdout_marker_exists else None
    if result.get("candidateSealSha256") != expected_candidate_sha:
        raise S2GError("RESULT_CANDIDATE_SEAL_DIGEST_MISMATCH")
    if result.get("holdoutMarkerSha256") != expected_holdout_sha:
        raise S2GError("RESULT_HOLDOUT_MARKER_DIGEST_MISMATCH")
    expected_packet_holdout = (
        "OPENED_ONCE_MEASURED"
        if result.get("holdout") is not None
        else ("OPENED_ONCE_INCOMPLETE" if holdout_marker_exists else "UNOPENED")
    )
    if result.get("packetHoldoutState") != expected_packet_holdout:
        raise S2GError("RESULT_PACKET_HOLDOUT_STATE_INVALID")

    development = result.get("development")
    champion: object = None
    development_trials: dict[str, Any] | None = None
    if development is None:
        if verdict != "UNMEASURED":
            raise S2GError("MEASURED_RESULT_DEVELOPMENT_ABSENT")
        if terminal_phase not in {"DEVELOPMENT_LOAD", "DEVELOPMENT_EVALUATION"}:
            raise S2GError("DEVELOPMENT_ABSENT_PHASE_INVALID")
    elif isinstance(development, dict):
        if set(development) != DEVELOPMENT_RECORD_NAMES:
            raise S2GError("DEVELOPMENT_FIELDS_INVALID")
        champion = development.get("championTrialId")
        trials = trial_grid()
        expected_trial_ids = [trial.trial_id for trial in trials]
        if development.get("trialCount") != len(trials):
            raise S2GError("DEVELOPMENT_TRIAL_COUNT_INVALID")
        raw_trials = development.get("trials")
        if not isinstance(raw_trials, dict) or set(raw_trials) != set(expected_trial_ids):
            raise S2GError("DEVELOPMENT_TRIAL_FAMILY_INVALID")
        development_trials = raw_trials
        raw_holm = _record_mapping(development.get("holmAdjustedP"), "development:holm")
        if set(raw_holm) != set(expected_trial_ids):
            raise S2GError("DEVELOPMENT_HOLM_FAMILY_INVALID")
        raw_p = {
            trial_id: _record_inference(
                _record_mapping(raw_trials[trial_id], f"development:{trial_id}"),
                f"development:{trial_id}",
            )["pValueOneSided"]
            for trial_id in expected_trial_ids
        }
        expected_holm = holm_adjust(raw_p)
        observed_holm = {
            trial_id: _record_decimal(raw_holm, trial_id, "development:holm")
            for trial_id in expected_trial_ids
        }
        if observed_holm != expected_holm:
            raise S2GError("DEVELOPMENT_HOLM_VALUES_INVALID")
        white_raw = development.get("whiteRealityCheckP")
        if not isinstance(white_raw, str):
            raise S2GError("DEVELOPMENT_WHITE_P_INVALID")
        white_p = decimal_field(white_raw, "development:whiteRealityCheckP")
        if white_p <= 0 or white_p > 1:
            raise S2GError("DEVELOPMENT_WHITE_P_OUT_OF_RANGE")
        pbo = _record_mapping(development.get("pbo"), "development:pbo")
        if set(pbo) != PBO_RECORD_NAMES:
            raise S2GError("DEVELOPMENT_PBO_FIELDS_INVALID")
        expected_blocks = [
            "2025-07",
            "2025-08",
            "2025-09",
            "2025-10",
            "2025-11",
            "2025-12",
            "2026-01",
            "2026-02",
        ]
        if (
            pbo.get("status") != "MEASURED"
            or pbo.get("selectionRuleReproduced") is not True
            or pbo.get("splitCount") != 70
            or pbo.get("blocks") != expected_blocks
        ):
            raise S2GError("DEVELOPMENT_PBO_SHAPE_INVALID")
        negative_count = pbo.get("negativeLogitCount")
        pbo_raw = pbo.get("pboOfImplementedSelectionRule")
        if (
            not isinstance(negative_count, int)
            or isinstance(negative_count, bool)
            or not isinstance(pbo_raw, str)
            or negative_count < 0
            or negative_count > 70
            or decimal_field(pbo_raw, "development:pbo") != Decimal(negative_count) / Decimal(70)
        ):
            raise S2GError("DEVELOPMENT_PBO_VALUE_INVALID")
        computed_qualifying: list[str] = []
        for trial in trials:
            row = raw_trials.get(trial.trial_id)
            if not isinstance(row, dict):
                raise S2GError(f"DEVELOPMENT_TRIAL_RESULT_INVALID:{trial.trial_id}")
            if set(row) != TRIAL_RECORD_NAMES:
                raise S2GError(f"DEVELOPMENT_TRIAL_FIELDS_INVALID:{trial.trial_id}")
            _validate_paths_record(
                row.get("paths"),
                trial_id=trial.trial_id,
                start_day=DEVELOPMENT_START,
                end_exclusive=DEVELOPMENT_END,
                expected_months=expected_blocks,
            )
            gates = row.get("gates")
            if (
                not isinstance(gates, dict)
                or set(gates) != DEVELOPMENT_GATE_NAMES
                or any(not isinstance(value, bool) for value in gates.values())
            ):
                raise S2GError(f"DEVELOPMENT_GATES_INVALID:{trial.trial_id}")
            expected_gates = _development_gates_from_record(
                row,
                observed_holm[trial.trial_id],
                white_p,
                f"development:{trial.trial_id}",
            )
            if gates != expected_gates:
                raise S2GError(f"DEVELOPMENT_GATE_VALUES_INVALID:{trial.trial_id}")
            if all(value is True for value in gates.values()):
                computed_qualifying.append(trial.trial_id)
        if development.get("qualifyingTrialIds") != computed_qualifying:
            raise S2GError("DEVELOPMENT_QUALIFYING_SET_INVALID")
        selection_nets = {
            trial.trial_id: _selection_net_from_result(trial, raw_trials[trial.trial_id])
            for trial in trials
        }
        best_net = max(selection_nets.values())
        selected_id = min(trial_id for trial_id, net in selection_nets.items() if net == best_net)
        if development.get("selectedTrialId") != selected_id:
            raise S2GError("DEVELOPMENT_PREDECLARED_SELECTION_INVALID")
        expected_champion = selected_id if selected_id in computed_qualifying else None
        if champion != expected_champion:
            raise S2GError("DEVELOPMENT_CHAMPION_SELECTION_INVALID")
    else:
        raise S2GError("RESULT_DEVELOPMENT_INVALID")

    if champion is None:
        if candidate_exists or holdout_marker_exists:
            raise S2GError("NO_CHAMPION_HAS_CANDIDATE_OR_HOLDOUT_STATE")
        if result.get("holdout") is not None:
            raise S2GError("NO_CHAMPION_HAS_HOLDOUT_RESULT")
        if development is not None and (
            verdict != "NO_GO" or terminal_phase != "DEVELOPMENT_GATES_FAILED"
        ):
            raise S2GError("DEVELOPMENT_GATE_VERDICT_INVALID")
    else:
        if not isinstance(champion, str):
            raise S2GError("CHAMPION_ID_INVALID")
        matching_trials = [trial for trial in trial_grid() if trial.trial_id == champion]
        if len(matching_trials) != 1:
            raise S2GError("CHAMPION_NOT_IN_FROZEN_GRID")
        if not isinstance(development, dict):
            raise S2GError("CHAMPION_DEVELOPMENT_INVALID")
        if development_trials is None:
            raise S2GError("DEVELOPMENT_TRIALS_INVALID")
        champion_result = development_trials.get(champion)
        if not isinstance(champion_result, dict):
            raise S2GError("CHAMPION_DEVELOPMENT_RESULT_INVALID")
        champion_gates = champion_result.get("gates")
        if (
            not isinstance(champion_gates, dict)
            or set(champion_gates) != DEVELOPMENT_GATE_NAMES
            or not all(value is True for value in champion_gates.values())
        ):
            raise S2GError("CHAMPION_DEVELOPMENT_GATES_INVALID")

        if not candidate_exists:
            if holdout_marker_exists:
                raise S2GError("HOLDOUT_MARKER_WITHOUT_CANDIDATE")
            if verdict != "UNMEASURED" or terminal_phase != "CANDIDATE_SEAL":
                raise S2GError("CANDIDATE_SEAL_FAILURE_STATE_INVALID")
            if result.get("holdout") is not None:
                raise S2GError("CANDIDATE_SEAL_FAILURE_HAS_HOLDOUT_RESULT")
        else:
            candidate = read_json(CANDIDATE_SEAL_PATH)
            _validate_common_marker(candidate, "S2GCandidateSealV1")
            if candidate.get("championTrial") != _trial_payload(matching_trials[0]):
                raise S2GError("CANDIDATE_CHAMPION_BINDING_INVALID")
            if candidate.get("developmentSha256") != canonical_sha(development):
                raise S2GError("CANDIDATE_DEVELOPMENT_DIGEST_MISMATCH")

            if not holdout_marker_exists:
                if verdict != "UNMEASURED" or terminal_phase != "HOLDOUT_MARKER":
                    raise S2GError("HOLDOUT_MARKER_FAILURE_STATE_INVALID")
                if result.get("holdout") is not None:
                    raise S2GError("HOLDOUT_MARKER_FAILURE_HAS_HOLDOUT_RESULT")
            else:
                holdout_marker = read_json(HOLDOUT_MARKER_PATH)
                _validate_common_marker(holdout_marker, "S2GHoldoutOpenMarkerV1")
                if holdout_marker.get("allowedOpenCount") != 1:
                    raise S2GError("HOLDOUT_MARKER_COUNT_INVALID")
                if holdout_marker.get("holdoutMembersOpenedBeforeMarker") != 0:
                    raise S2GError("HOLDOUT_MARKER_PRIOR_OPEN_COUNT_INVALID")
                if holdout_marker.get("candidateSealSha256") != sha256_path(CANDIDATE_SEAL_PATH):
                    raise S2GError("HOLDOUT_MARKER_CANDIDATE_DIGEST_MISMATCH")

                holdout = result.get("holdout")
                if holdout is None:
                    if verdict != "UNMEASURED" or terminal_phase not in {
                        "HOLDOUT_LOAD",
                        "HOLDOUT_EVALUATION",
                    }:
                        raise S2GError("HOLDOUT_FAILURE_STATE_INVALID")
                elif isinstance(holdout, dict):
                    if set(holdout) != HOLDOUT_RECORD_NAMES:
                        raise S2GError("HOLDOUT_FIELDS_INVALID")
                    if holdout.get("championTrialId") != champion:
                        raise S2GError("HOLDOUT_CHAMPION_BINDING_INVALID")
                    _validate_paths_record(
                        holdout.get("paths"),
                        trial_id=champion,
                        start_day=HOLDOUT_START,
                        end_exclusive=EVALUATION_END,
                        expected_months=("2026-03", "2026-04", "2026-05", "2026-06"),
                    )
                    gates = holdout.get("gates")
                    if (
                        not isinstance(gates, dict)
                        or set(gates) != HOLDOUT_GATE_NAMES
                        or any(not isinstance(value, bool) for value in gates.values())
                    ):
                        raise S2GError("HOLDOUT_GATES_INVALID")
                    if gates != _holdout_gates_from_record(holdout):
                        raise S2GError("HOLDOUT_GATE_VALUES_INVALID")
                    all_pass = all(value is True for value in gates.values())
                    expected_verdict = "GO" if all_pass else "NO_GO"
                    if verdict != expected_verdict or terminal_phase != "HOLDOUT_MEASURED":
                        raise S2GError("HOLDOUT_VERDICT_INVALID")
                else:
                    raise S2GError("HOLDOUT_RESULT_INVALID")

    if not TERMINAL_CORE_PATH.is_file():
        raise S2GError("TERMINAL_CORE_ABSENT")
    if result.get("terminalCoreSha256") != sha256_path(TERMINAL_CORE_PATH):
        raise S2GError("RESULT_TERMINAL_CORE_DIGEST_MISMATCH")
    core = read_json(TERMINAL_CORE_PATH)
    if set(core) != TERMINAL_CORE_RECORD_NAMES:
        raise S2GError("TERMINAL_CORE_FIELDS_INVALID")
    if core.get("schema") != "S2GTerminalResultCoreV1":
        raise S2GError("TERMINAL_CORE_SCHEMA_INVALID")
    result_core = dict(result)
    result_core.pop("terminalCoreSha256", None)
    result_core["schema"] = "S2GTerminalResultCoreV1"
    if canonical_bytes(result_core) != canonical_bytes(core):
        raise S2GError("RESULT_TERMINAL_CORE_BYTES_MISMATCH")


def verify() -> str:
    assert_frozen()
    checksum_rows = SHA256SUMS_PATH.read_text(encoding="ascii").splitlines()
    expected_names = {path.name for path in (*static_paths(), SOURCE_MANIFEST_PATH, FREEZE_PATH)}
    observed_names: set[str] = set()
    for row in checksum_rows:
        digest, separator, name = row.partition("  ")
        if separator != "  " or not re.fullmatch(r"[0-9a-f]{64}", digest):
            raise S2GError("SHA256SUMS_ROW_INVALID")
        if name in observed_names or name not in expected_names:
            raise S2GError("SHA256SUMS_NAME_INVALID")
        observed_names.add(name)
        if sha256_path(HERE / name) != digest:
            raise S2GError(f"SHA256SUMS_DIGEST_MISMATCH:{name}")
    if observed_names != expected_names:
        raise S2GError("SHA256SUMS_COVERAGE_INVALID")
    if not RESULT_PATH.exists():
        for marker in (
            RUN_MARKER_PATH,
            CANDIDATE_SEAL_PATH,
            HOLDOUT_MARKER_PATH,
            TERMINAL_CORE_PATH,
        ):
            if marker.exists():
                raise S2GError(f"PREOUTCOME_RESULT_ABSENT_WITH_MARKER:{marker}")
        return "S2G_VERIFY PASS state=PREOUTCOME_FROZEN verdict=UNMEASURED_PENDING_SEALED_RUN"
    result = read_json(RESULT_PATH)
    verify_terminal_state(result)
    return f"S2G_VERIFY PASS state=TERMINAL verdict={result['verdict']}"


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("freeze", "run", "verify"))
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        if args.command == "freeze":
            freeze()
            print("S2G_FREEZE PASS archive_members_opened=0")
        elif args.command == "run":
            run()
            print(verify())
        else:
            print(verify())
        return 0
    except S2GError as error:
        print(f"S2G_{args.command.upper()} FAIL {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
