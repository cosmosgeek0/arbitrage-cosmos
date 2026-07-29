#!/usr/bin/env python3
"""Sealed V-G31 Binance-public-only state-transition evaluator.

``freeze`` authenticates compressed shared-source bytes without opening a ZIP.
``run`` consumes a packet-local one-use marker before the first decompression.
``verify`` authenticates frozen and terminal packet bytes without opening ZIPs.

No command reads credentials, account state, private endpoints, orders, wallet
state, provider state, host state, or UI state.
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
    for year, start_month, end_month in ((2024, 12, 12), (2025, 1, 12), (2026, 1, 6))
    for month in range(start_month, end_month + 1)
)
DEVELOPMENT_MONTHS = SOURCE_MONTHS[:15]
HOLDOUT_MONTHS = SOURCE_MONTHS[15:]
DEVELOPMENT_START = date(2025, 7, 1)
DEVELOPMENT_END = date(2026, 3, 1)
HOLDOUT_START = DEVELOPMENT_END
EVALUATION_END = date(2026, 7, 1)

PRIOR_STATE_DAYS = 84
OLDER_TRANSITIONS = 84
RECENT_WINDOWS = (7, 14, 28)
THRESHOLDS = (Decimal("0.10"), Decimal("0.20"))
HOLD_DAYS = (3, 7)
INITIAL_CAPITAL = Decimal("1000")
CAPACITY_PARTICIPATION = Decimal("0.0001")
BOOTSTRAP_REPLICATES = 4096
BOOTSTRAP_BLOCK_DAYS = 14
BOOTSTRAP_SEED = 2_026_072_931

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


class VG31Error(RuntimeError):
    """Terminal V-G31 protocol, source, or measurement failure."""


@dataclass(frozen=True, slots=True)
class Trial:
    trial_id: str
    recent_days: int
    threshold: Decimal
    hold_days: int


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
    recent_days: int
    threshold: Decimal
    recent_matrix: tuple[Decimal, ...]
    older_matrix: tuple[Decimal, ...]
    delta: Decimal
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
    active_spells: int
    fills: int
    distinct_held_symbols: int
    maximum_drawdown_pct: Decimal
    positive_months: int
    active_capacity_p05_usdt: Decimal | None
    daily_log_returns: tuple[float, ...]
    monthly_net_usdt: tuple[tuple[str, Decimal], ...]


SCENARIOS = (
    Scenario("PUBLIC_GROSS", Decimal("0"), Decimal("0")),
    Scenario("PUBLIC_BASE", Decimal("0.0010"), Decimal("0.0010")),
    Scenario("PUBLIC_STRESS", Decimal("0.0010"), Decimal("0.0025")),
    Scenario("FEE_STRESS", Decimal("0.0020"), Decimal("0.0025")),
)
DEVELOPMENT_GATE_NAMES = frozenset(
    {
        "activeSpellsAtLeast20",
        "capacityP05AtLeast1000",
        "distinctSymbolsExactly12",
        "drawdownAtMost25Pct",
        "holmPBelow0.05",
        "lcbAboveZero",
        "netAboveZero",
        "positiveMonthsAtLeast5",
        "rawPBelow0.05",
        "validFormationsAtLeast30",
        "whitePBelow0.05",
    }
)
HOLDOUT_GATE_NAMES = frozenset(
    {
        "activeSpellsAtLeast8",
        "baseNetAboveZero",
        "capacityP05AtLeast1000",
        "distinctSymbolsExactly12",
        "drawdownAtMost25Pct",
        "feeStressNetAboveZero",
        "lcbAboveZero",
        "netAboveZero",
        "positiveMonthsAtLeast3",
        "rawPBelow0.05",
        "validFormationsAtLeast14",
    }
)


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
        raise VG31Error(f"JSON_OBJECT_REQUIRED:{path}")
    return cast(dict[str, Any], value)


def write_once_or_match(path: Path, payload: object) -> None:
    expected = canonical_bytes(payload)
    if path.exists():
        if path.read_bytes() != expected:
            raise VG31Error(f"EXISTING_BYTES_DIFFER:{path}")
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
        raise VG31Error(f"ONE_USE_STATE_ALREADY_EXISTS:{path}") from error
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
            trial_id=f"R{recent:02d}_D{int(threshold * 100):02d}_H{hold:02d}",
            recent_days=recent,
            threshold=threshold,
            hold_days=hold,
        )
        for recent in RECENT_WINDOWS
        for threshold in THRESHOLDS
        for hold in HOLD_DAYS
    )


def iter_days(start: date, end_exclusive: date) -> Iterable[date]:
    current = start
    while current < end_exclusive:
        yield current
        current += timedelta(days=1)


def monday_entries(start: date, end_exclusive: date, maximum_hold: int = 7) -> tuple[date, ...]:
    return tuple(
        day
        for day in iter_days(start, end_exclusive)
        if day.weekday() == 0 and day + timedelta(days=maximum_hold) < end_exclusive
    )


def decimal_field(raw: str, label: str) -> Decimal:
    try:
        value = Decimal(raw)
    except InvalidOperation as error:
        raise VG31Error(f"INVALID_DECIMAL:{label}") from error
    if not value.is_finite():
        raise VG31Error(f"NONFINITE_DECIMAL:{label}")
    return value


def timestamp_to_day(raw: str, label: str) -> tuple[date, int, str]:
    try:
        value = int(raw)
    except ValueError as error:
        raise VG31Error(f"INVALID_TIMESTAMP:{label}") from error
    if value >= 1_000_000_000_000_000:
        seconds, unit = value // 1_000_000, "MICROSECOND"
        if value % 1_000_000 != 0:
            raise VG31Error(f"OPEN_NOT_UTC_DAY_BOUNDARY:{label}")
    elif value >= 1_000_000_000_000:
        seconds, unit = value // 1_000, "MILLISECOND"
        if value % 1_000 != 0:
            raise VG31Error(f"OPEN_NOT_UTC_DAY_BOUNDARY:{label}")
    else:
        raise VG31Error(f"TIMESTAMP_MAGNITUDE_INVALID:{label}")
    moment = datetime.fromtimestamp(seconds, tz=UTC)
    if moment.time() != datetime.min.time():
        raise VG31Error(f"OPEN_NOT_UTC_DAY_BOUNDARY:{label}")
    return moment.date(), value, unit


def parse_bar(symbol: str, fields: Sequence[str], row_number: int) -> Bar:
    if len(fields) != 12:
        raise VG31Error(f"KLINE_FIELD_COUNT:{symbol}:{row_number}")
    day, open_time, unit = timestamp_to_day(fields[0], f"{symbol}:{row_number}:open")
    try:
        close_time = int(fields[6])
    except ValueError as error:
        raise VG31Error(f"INVALID_CLOSE_TIMESTAMP:{symbol}:{row_number}") from error
    one_day = 86_400_000_000 if unit == "MICROSECOND" else 86_400_000
    if close_time != open_time + one_day - 1:
        raise VG31Error(f"CLOSE_BOUNDARY_INVALID:{symbol}:{row_number}")
    if day >= date(2025, 1, 1) and unit != "MICROSECOND":
        raise VG31Error(f"POST_2025_TIMESTAMP_NOT_MICROSECOND:{symbol}:{row_number}")
    if day < date(2025, 1, 1) and unit != "MILLISECOND":
        raise VG31Error(f"PRE_2025_TIMESTAMP_NOT_MILLISECOND:{symbol}:{row_number}")
    open_price = decimal_field(fields[1], f"{symbol}:{row_number}:open")
    high = decimal_field(fields[2], f"{symbol}:{row_number}:high")
    low = decimal_field(fields[3], f"{symbol}:{row_number}:low")
    close = decimal_field(fields[4], f"{symbol}:{row_number}:close")
    quote_volume = decimal_field(fields[7], f"{symbol}:{row_number}:quote_volume")
    if min(open_price, high, low, close) <= 0:
        raise VG31Error(f"NONPOSITIVE_PRICE_FIELD:{symbol}:{row_number}")
    if quote_volume < 0:
        raise VG31Error(f"NEGATIVE_QUOTE_VOLUME:{symbol}:{row_number}")
    if high < max(open_price, close) or low > min(open_price, close) or high < low:
        raise VG31Error(f"OHLC_ORDER_INVALID:{symbol}:{row_number}")
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
        raise VG31Error("SHARED_DISCOVERY_DIGEST_MISMATCH")
    if sha256_path(SOURCE_ACQUISITION_PATH) != SOURCE_ACQUISITION_SHA256:
        raise VG31Error("SHARED_ACQUISITION_DIGEST_MISMATCH")
    discovery = read_json(SOURCE_DISCOVERY_PATH)
    acquisition = read_json(SOURCE_ACQUISITION_PATH)
    if discovery.get("schema") != "S1FArchiveDiscoveryV1":
        raise VG31Error("SHARED_DISCOVERY_SCHEMA_MISMATCH")
    if acquisition.get("schema") != "S1FAcquisitionManifestV1":
        raise VG31Error("SHARED_ACQUISITION_SCHEMA_MISMATCH")
    if acquisition.get("archiveBodiesDecompressed") is not False:
        raise VG31Error("SHARED_ACQUISITION_DECOMPRESSION_CLAIM_INVALID")
    universe = cast(dict[str, Any], discovery.get("universe"))
    symbols = universe.get("symbols")
    if not isinstance(symbols, list) or not set(FIXED_COHORT).issubset(set(symbols)):
        raise VG31Error("FIXED_COHORT_NOT_IN_DISCOVERED_UNIVERSE")
    rows = acquisition.get("artifactPairs")
    if not isinstance(rows, list):
        raise VG31Error("SHARED_ARTIFACT_ROWS_INVALID")
    by_key: dict[tuple[str, str], dict[str, Any]] = {}
    for raw_row in rows:
        if not isinstance(raw_row, dict):
            raise VG31Error("SHARED_ARTIFACT_ROW_INVALID")
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
                raise VG31Error(f"FIXED_COHORT_ARTIFACT_ABSENT:{symbol}:{month}")
            zip_path, checksum_path, pair_path = _artifact_paths(symbol, month)
            for local_path in (zip_path, checksum_path, pair_path):
                if not local_path.is_file():
                    raise VG31Error(f"FIXED_SOURCE_FILE_ABSENT:{local_path}")
            zip_sha = sha256_path(zip_path)
            checksum_sha = sha256_path(checksum_path)
            if zip_sha != artifact_row.get("zipSha256"):
                raise VG31Error(f"ZIP_DIGEST_MISMATCH:{symbol}:{month}")
            if checksum_sha != artifact_row.get("checksumSha256"):
                raise VG31Error(f"CHECKSUM_DIGEST_MISMATCH:{symbol}:{month}")
            match = CHECKSUM_RE.fullmatch(checksum_path.read_text(encoding="ascii"))
            if match is None:
                raise VG31Error(f"CHECKSUM_BYTES_INVALID:{symbol}:{month}")
            if match.group(1) != zip_sha or match.group(2) != zip_path.name:
                raise VG31Error(f"CHECKSUM_ZIP_BINDING_INVALID:{symbol}:{month}")
            artifacts.append(
                {
                    "checksumBytes": checksum_path.stat().st_size,
                    "checksumPath": str(checksum_path.relative_to(SOURCE_ROOT)),
                    "checksumSha256": checksum_sha,
                    "month": month,
                    "pairBytes": pair_path.stat().st_size,
                    "pairPath": str(pair_path.relative_to(SOURCE_ROOT)),
                    "pairSha256": sha256_path(pair_path),
                    "symbol": symbol,
                    "zipBytes": zip_path.stat().st_size,
                    "zipPath": str(zip_path.relative_to(SOURCE_ROOT)),
                    "zipSha256": zip_sha,
                }
            )
    protocol = read_json(PROTOCOL_PATH)
    return {
        "archiveBodiesOpenedByVG31DuringFreeze": False,
        "artifactCount": len(artifacts),
        "artifacts": artifacts,
        "baseCommit": BASE_COMMIT,
        "fixedCohort": list(FIXED_COHORT),
        "fixedCohortSha256": canonical_sha(list(FIXED_COHORT)),
        "protocolSha256": sha256_path(PROTOCOL_PATH),
        "schema": "VG31FrozenPublicSourceManifestV1",
        "sharedAcquisitionSha256": SOURCE_ACQUISITION_SHA256,
        "sharedDiscoverySha256": SOURCE_DISCOVERY_SHA256,
        "sourceMode": "READ_ONLY",
        "sourceMonths": list(SOURCE_MONTHS),
        "sourceRoot": str(SOURCE_ROOT),
        "state": "CHECKSUM_VERIFIED_COMPRESSED_BYTES_NOT_OPENED_BY_VG31",
        "trialIds": [trial.trial_id for trial in trial_grid()],
        "trialIdsSha256": canonical_sha([trial.trial_id for trial in trial_grid()]),
        "verdictConsumer": protocol["authority"]["consumer"],
    }


def static_paths() -> tuple[Path, ...]:
    return (
        INIT_PATH,
        SOURCE_RESEARCH_PATH,
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
        raise VG31Error("FREEZE_GIT_HEAD_NOT_EXACT_BASE")
    if not changed_paths or any(
        not path.startswith("quant/research/vg31/") for path in changed_paths
    ):
        raise VG31Error("FREEZE_GIT_SCOPE_INVALID")
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
        raise VG31Error("RUN_GIT_HEAD_NOT_EXACT_BASE")
    if any(not line.startswith("?? ") for line in status_lines):
        raise VG31Error("RUN_GIT_TRACKED_CHANGE_PRESENT")
    if changed_paths != required:
        raise VG31Error("RUN_GIT_FROZEN_PACKET_SCOPE_INVALID")
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
        raise VG31Error("RUN_CONTROL_INVALID")
    expected_python = run_control.get("pythonExact")
    actual_python = ".".join(str(item) for item in sys.version_info[:3])
    if expected_python != actual_python:
        raise VG31Error(f"PYTHON_VERSION_MISMATCH:{actual_python}")
    expected_hash_seed = run_control.get("pythonHashSeed")
    if os.environ.get("PYTHONHASHSEED") != expected_hash_seed:
        raise VG31Error("PYTHONHASHSEED_MISMATCH")


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
            raise VG31Error(f"FREEZE_REFUSES_OUTCOME_STATE:{forbidden}")
    manifest = build_source_manifest()
    write_once_or_match(SOURCE_MANIFEST_PATH, manifest)
    freeze_payload = {
        "archiveBodiesOpenedByVG31": False,
        "baseCommit": BASE_COMMIT,
        "createdAtUtc": "2026-07-29",
        "fixedCohortSha256": canonical_sha(list(FIXED_COHORT)),
        "git": git_snapshot(),
        "protocolSha256": sha256_path(PROTOCOL_PATH),
        "runtime": {
            "implementation": sys.implementation.name,
            "python": ".".join(str(item) for item in sys.version_info[:3]),
            "pythonHashSeed": os.environ.get("PYTHONHASHSEED"),
        },
        "schema": "VG31PreOutcomeFreezeV1",
        "sourceManifestSha256": sha256_path(SOURCE_MANIFEST_PATH),
        "state": "FROZEN_BEFORE_ANY_VG31_ARCHIVE_MEMBER_OPEN",
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
            raise VG31Error("SHA256SUMS_EXISTING_BYTES_DIFFER")
    else:
        SHA256SUMS_PATH.write_bytes(checksum_bytes)


def assert_frozen() -> dict[str, Any]:
    if not SOURCE_MANIFEST_PATH.is_file() or not FREEZE_PATH.is_file():
        raise VG31Error("FREEZE_PACKET_ABSENT")
    frozen = read_json(FREEZE_PATH)
    if frozen.get("schema") != "VG31PreOutcomeFreezeV1":
        raise VG31Error("FREEZE_SCHEMA_INVALID")
    if frozen.get("baseCommit") != BASE_COMMIT:
        raise VG31Error("FREEZE_BASE_INVALID")
    if frozen.get("archiveBodiesOpenedByVG31") is not False:
        raise VG31Error("FREEZE_ARCHIVE_CUSTODY_INVALID")
    if frozen.get("sourceManifestSha256") != sha256_path(SOURCE_MANIFEST_PATH):
        raise VG31Error("FREEZE_SOURCE_MANIFEST_DIGEST_MISMATCH")
    static_files = frozen.get("staticFiles")
    if not isinstance(static_files, dict):
        raise VG31Error("FREEZE_STATIC_FILES_INVALID")
    for relative, expected in static_files.items():
        if not isinstance(relative, str) or not isinstance(expected, str):
            raise VG31Error("FREEZE_STATIC_ROW_INVALID")
        path = REPO_ROOT / relative
        if not path.is_file() or sha256_path(path) != expected:
            raise VG31Error(f"FREEZE_STATIC_DRIFT:{relative}")
    source_manifest = read_json(SOURCE_MANIFEST_PATH)
    if source_manifest.get("archiveBodiesOpenedByVG31DuringFreeze") is not False:
        raise VG31Error("SOURCE_MANIFEST_CUSTODY_INVALID")
    artifacts = source_manifest.get("artifacts")
    if not isinstance(artifacts, list) or len(artifacts) != len(FIXED_COHORT) * len(SOURCE_MONTHS):
        raise VG31Error("SOURCE_MANIFEST_ARTIFACT_COUNT_INVALID")
    for raw in artifacts:
        if not isinstance(raw, dict):
            raise VG31Error("SOURCE_MANIFEST_ARTIFACT_INVALID")
        artifact = cast(dict[str, Any], raw)
        for field_name, digest_name in (
            ("zipPath", "zipSha256"),
            ("checksumPath", "checksumSha256"),
            ("pairPath", "pairSha256"),
        ):
            relative = artifact.get(field_name)
            expected = artifact.get(digest_name)
            if not isinstance(relative, str) or not isinstance(expected, str):
                raise VG31Error("SOURCE_MANIFEST_PATH_DIGEST_INVALID")
            path = SOURCE_ROOT / relative
            if not path.is_file() or sha256_path(path) != expected:
                raise VG31Error(f"FROZEN_SOURCE_DRIFT:{relative}")
    return frozen


def _load_archive(symbol: str, month: str) -> list[Bar]:
    zip_path, _, _ = _artifact_paths(symbol, month)
    expected_member = f"{symbol}-1d-{month}.csv"
    with zipfile.ZipFile(zip_path, "r") as archive:
        members = archive.infolist()
        if len(members) != 1 or members[0].is_dir() or members[0].filename != expected_member:
            raise VG31Error(f"ZIP_MEMBER_SHAPE_INVALID:{symbol}:{month}")
        raw_bytes = archive.read(members[0])
    try:
        text = raw_bytes.decode("utf-8")
    except UnicodeDecodeError as error:
        raise VG31Error(f"CSV_UTF8_INVALID:{symbol}:{month}") from error
    rows = list(csv.reader(io.StringIO(text, newline="")))
    if rows and tuple(rows[0]) == KLINE_HEADER:
        rows = rows[1:]
    parsed: list[Bar] = []
    seen: dict[date, tuple[str, ...]] = {}
    last_day: date | None = None
    for row_number, fields in enumerate(rows, start=1):
        bar = parse_bar(symbol, fields, row_number)
        prior = seen.get(bar.day)
        if prior is not None:
            raise VG31Error(f"DUPLICATE_OR_CONFLICTING_DAY:{symbol}:{bar.day}")
        if last_day is not None and bar.day <= last_day:
            raise VG31Error(f"NON_MONOTONIC_DAY:{symbol}:{bar.day}")
        seen[bar.day] = bar.fields
        parsed.append(bar)
        last_day = bar.day
    if not parsed:
        raise VG31Error(f"EMPTY_ARCHIVE:{symbol}:{month}")
    return parsed


def load_bars(months: Sequence[str]) -> dict[str, dict[date, Bar]]:
    bars: dict[str, dict[date, Bar]] = {symbol: {} for symbol in FIXED_COHORT}
    for symbol in FIXED_COHORT:
        for month in months:
            for bar in _load_archive(symbol, month):
                if bar.day in bars[symbol]:
                    raise VG31Error(f"CROSS_ARCHIVE_DUPLICATE:{symbol}:{bar.day}")
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
            raise VG31Error(f"MERGE_BAR_OVERLAP:{symbol}:{min(overlap)}")
        rows.update(second[symbol])
        merged[symbol] = rows
    return merged


def state_for_day(symbol_bars: Mapping[date, Bar], day: date) -> int:
    prior_days = [day - timedelta(days=offset) for offset in range(PRIOR_STATE_DAYS, 0, -1)]
    try:
        prior = sorted(symbol_bars[item].quote_volume for item in prior_days)
        current = symbol_bars[day].quote_volume
    except KeyError as error:
        raise VG31Error(f"STATE_REQUIRED_DAY_MISSING:{day}") from error
    q1, q2, q3 = prior[20], prior[41], prior[62]
    if current <= q1:
        return 0
    if current <= q2:
        return 1
    if current <= q3:
        return 2
    return 3


def transition_matrix(
    bars: Mapping[str, Mapping[date, Bar]],
    to_days: Sequence[date],
) -> tuple[Decimal, ...]:
    if not to_days:
        raise VG31Error("TRANSITION_WINDOW_EMPTY")
    if any(right != left + timedelta(days=1) for left, right in itertools.pairwise(to_days)):
        raise VG31Error("TRANSITION_WINDOW_NOT_CONSECUTIVE")
    counts = [0] * 16
    for symbol in FIXED_COHORT:
        symbol_bars = bars.get(symbol)
        if symbol_bars is None:
            raise VG31Error(f"FIXED_MEMBER_ABSENT:{symbol}")
        for to_day in to_days:
            source = state_for_day(symbol_bars, to_day - timedelta(days=1))
            target = state_for_day(symbol_bars, to_day)
            counts[source * 4 + target] += 1
    denominator = Decimal(len(FIXED_COHORT) * len(to_days))
    normalized = [Decimal(count) / denominator for count in counts]
    normalized[-1] += Decimal(1) - sum(normalized)
    matrix = tuple(normalized)
    if sum(matrix) != Decimal(1) or any(value < 0 for value in matrix):
        raise VG31Error("TRANSITION_MATRIX_NOT_NORMALIZED")
    return matrix


def total_variation(recent_matrix: Sequence[Decimal], older_matrix: Sequence[Decimal]) -> Decimal:
    if len(recent_matrix) != 16 or len(older_matrix) != 16:
        raise VG31Error("TRANSITION_MATRIX_CELL_COUNT_INVALID")
    delta = sum(
        (abs(recent - older) for recent, older in zip(recent_matrix, older_matrix, strict=True)),
        Decimal(0),
    ) / Decimal(2)
    if delta < 0 or delta > 1:
        raise VG31Error("TOTAL_VARIATION_OUT_OF_RANGE")
    return delta


def signal_for_entry(
    bars: Mapping[str, Mapping[date, Bar]],
    trial: Trial,
    entry_day: date,
) -> FormationSignal:
    if entry_day.weekday() != 0:
        raise VG31Error("ENTRY_NOT_MONDAY")
    cutoff = entry_day - timedelta(days=2)
    recent_days = tuple(
        cutoff - timedelta(days=offset) for offset in range(trial.recent_days - 1, -1, -1)
    )
    older_end = cutoff - timedelta(days=trial.recent_days)
    older_days = tuple(
        older_end - timedelta(days=offset) for offset in range(OLDER_TRANSITIONS - 1, -1, -1)
    )
    if set(recent_days).intersection(older_days):
        raise VG31Error("RECENT_OLDER_TRANSITION_OVERLAP")
    recent = transition_matrix(bars, recent_days)
    older = transition_matrix(bars, older_days)
    delta = total_variation(recent, older)
    return FormationSignal(
        entry_day=entry_day,
        cutoff_day=cutoff,
        recent_days=trial.recent_days,
        threshold=trial.threshold,
        recent_matrix=recent,
        older_matrix=older,
        delta=delta,
        active=delta >= trial.threshold,
    )


def capacity_for_entry(bars: Mapping[str, Mapping[date, Bar]], entry_day: date) -> Decimal:
    cutoff = entry_day - timedelta(days=2)
    medians: list[Decimal] = []
    for symbol in FIXED_COHORT:
        values: list[Decimal] = []
        for offset in range(29, -1, -1):
            day = cutoff - timedelta(days=offset)
            try:
                values.append(bars[symbol][day].quote_volume)
            except KeyError as error:
                raise VG31Error(f"CAPACITY_REQUIRED_DAY_MISSING:{symbol}:{day}") from error
        medians.append(statistics.median(values))
    return Decimal(len(FIXED_COHORT)) * min(medians) * CAPACITY_PARTICIPATION


def percentile_decimal(values: Sequence[Decimal], probability: Decimal) -> Decimal:
    if not values:
        raise VG31Error("PERCENTILE_EMPTY")
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
    entries = set(monday_entries(start_day, end_exclusive, maximum_hold=max(HOLD_DAYS)))
    cash = INITIAL_CAPITAL
    quantities: dict[str, Decimal] = {}
    exit_day: date | None = None
    nav_before = INITIAL_CAPITAL
    peak = INITIAL_CAPITAL
    max_drawdown = Decimal(0)
    active_spells = 0
    valid_formations = 0
    capacities: list[Decimal] = []
    held_symbols: set[str] = set()
    daily_logs: list[float] = []
    monthly_net: dict[str, Decimal] = {}

    for day in iter_days(start_day, end_exclusive):
        if exit_day == day:
            proceeds = Decimal(0)
            for symbol, quantity in quantities.items():
                try:
                    open_price = bars[symbol][day].open
                except KeyError as error:
                    raise VG31Error(f"EXIT_OPEN_MISSING:{symbol}:{day}") from error
                execution_price = open_price * (Decimal(1) - scenario.adverse_rate)
                proceeds += quantity * execution_price * (Decimal(1) - scenario.fee_rate)
            cash = proceeds
            quantities = {}
            exit_day = None

        if day in entries:
            if quantities:
                raise VG31Error(f"OVERLAPPING_POSITION:{trial.trial_id}:{day}")
            signal = signal_for_entry(bars, trial, day)
            valid_formations += 1
            if signal.active:
                active_spells += 1
                capacities.append(capacity_for_entry(bars, day))
                held_symbols.update(FIXED_COHORT)
                allocation = cash / Decimal(len(FIXED_COHORT))
                quantities = {}
                for symbol in FIXED_COHORT:
                    try:
                        open_price = bars[symbol][day].open
                    except KeyError as error:
                        raise VG31Error(f"ENTRY_OPEN_MISSING:{symbol}:{day}") from error
                    execution_price = open_price * (Decimal(1) + scenario.adverse_rate)
                    quantities[symbol] = (
                        allocation / execution_price * (Decimal(1) - scenario.fee_rate)
                    )
                cash = Decimal(0)
                exit_day = day + timedelta(days=trial.hold_days)

        if quantities:
            nav = Decimal(0)
            for symbol, quantity in quantities.items():
                try:
                    nav += quantity * bars[symbol][day].open
                except KeyError as error:
                    raise VG31Error(f"MARK_OPEN_MISSING:{symbol}:{day}") from error
        else:
            nav = cash
        if nav <= 0:
            raise VG31Error(f"NONPOSITIVE_NAV:{trial.trial_id}:{day}")
        daily_logs.append(math.log(float(nav / nav_before)))
        month = day.strftime("%Y-%m")
        monthly_net[month] = monthly_net.get(month, Decimal(0)) + (nav - nav_before)
        nav_before = nav
        peak = max(peak, nav)
        max_drawdown = max(max_drawdown, (peak - nav) / peak)

    if quantities or exit_day is not None:
        raise VG31Error(f"OPEN_POSITION_AT_PARTITION_END:{trial.trial_id}")
    capacity_p05 = percentile_decimal(capacities, Decimal("0.05")) if capacities else None
    return PathMetrics(
        trial_id=trial.trial_id,
        scenario=scenario.name,
        start_day=start_day,
        end_exclusive=end_exclusive,
        final_nav=cash,
        net_usdt=cash - INITIAL_CAPITAL,
        valid_formations=valid_formations,
        active_spells=active_spells,
        fills=active_spells * len(FIXED_COHORT) * 2,
        distinct_held_symbols=len(held_symbols),
        maximum_drawdown_pct=max_drawdown * Decimal(100),
        positive_months=sum(1 for value in monthly_net.values() if value > 0),
        active_capacity_p05_usdt=capacity_p05,
        daily_log_returns=tuple(daily_logs),
        monthly_net_usdt=tuple(sorted(monthly_net.items())),
    )


def circular_indices(length: int, block_length: int, rng: random.Random) -> list[int]:
    if length <= 0:
        raise VG31Error("BOOTSTRAP_LENGTH_INVALID")
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
        raise VG31Error("BOOTSTRAP_RETURNS_EMPTY")
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
        raise VG31Error("WHITE_PATHS_EMPTY")
    lengths = {len(values) for values in paths.values()}
    if len(lengths) != 1:
        raise VG31Error("WHITE_PATHS_NOT_SYNCHRONOUS")
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
        raise VG31Error("PBO_PATHS_EMPTY")
    trial_ids = sorted(paths)
    months = sorted({month for path in paths.values() for month, _ in path.monthly_net_usdt})
    if len(months) != 8:
        return {
            "blocks": months,
            "negativeLogitCount": None,
            "pboOfImplementedSelectionRule": None,
            "status": "HEURISTIC_UNMEASURED_REQUIRES_EIGHT_DEVELOPMENT_MONTHS",
        }
    by_trial = {trial_id: dict(paths[trial_id].monthly_net_usdt) for trial_id in trial_ids}
    logits: list[float] = []
    for in_sample_indices in itertools.combinations(range(8), 4):
        in_sample = set(in_sample_indices)
        out_sample = set(range(8)).difference(in_sample)
        in_sample_scores = {
            trial_id: sum(by_trial[trial_id].get(months[index], Decimal(0)) for index in in_sample)
            for trial_id in trial_ids
        }
        best_score = max(in_sample_scores.values())
        champion = min(
            trial_id
            for trial_id, trial_score in in_sample_scores.items()
            if trial_score == best_score
        )
        scores = {
            trial_id: sum(by_trial[trial_id].get(months[index], Decimal(0)) for index in out_sample)
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
    return {
        "blocks": months,
        "familyRankHeuristic": str(Decimal(negative) / Decimal(len(logits))),
        "metric": "MONTHLY_ABSOLUTE_NET_USDT_FAMILY_RANK",
        "negativeLogitCount": negative,
        "pboOfImplementedSelectionRule": None,
        "selectionRuleReproduced": False,
        "splitCount": len(logits),
        "status": "HEURISTIC_ONLY_NOT_SELECTION_RULE_PBO",
    }


def _metrics_dict(path: PathMetrics) -> dict[str, object]:
    value = asdict(path)
    value.pop("daily_log_returns")
    value["start_day"] = path.start_day.isoformat()
    value["end_exclusive"] = path.end_exclusive.isoformat()
    value["final_nav"] = str(path.final_nav)
    value["net_usdt"] = str(path.net_usdt)
    value["maximum_drawdown_pct"] = str(path.maximum_drawdown_pct)
    value["active_capacity_p05_usdt"] = (
        str(path.active_capacity_p05_usdt) if path.active_capacity_p05_usdt is not None else None
    )
    value["monthly_net_usdt"] = [[month, str(net)] for month, net in path.monthly_net_usdt]
    return value


def development_gate_rows(
    stress: PathMetrics,
    inference: Mapping[str, Decimal],
    holm_p: Decimal,
    white_p: Decimal,
) -> dict[str, bool]:
    return {
        "activeSpellsAtLeast20": stress.active_spells >= 20,
        "capacityP05AtLeast1000": stress.active_capacity_p05_usdt is not None
        and stress.active_capacity_p05_usdt >= Decimal("1000"),
        "distinctSymbolsExactly12": stress.distinct_held_symbols == len(FIXED_COHORT),
        "drawdownAtMost25Pct": stress.maximum_drawdown_pct <= Decimal("25"),
        "holmPBelow0.05": holm_p < Decimal("0.05"),
        "lcbAboveZero": inference["lcb5Usdt"] > 0,
        "netAboveZero": stress.net_usdt > 0,
        "positiveMonthsAtLeast5": stress.positive_months >= 5,
        "rawPBelow0.05": inference["pValueOneSided"] < Decimal("0.05"),
        "validFormationsAtLeast30": stress.valid_formations >= 30,
        "whitePBelow0.05": white_p < Decimal("0.05"),
    }


def holdout_gate_rows(
    paths: Mapping[str, PathMetrics], inference: Mapping[str, Decimal]
) -> dict[str, bool]:
    stress = paths["PUBLIC_STRESS"]
    return {
        "activeSpellsAtLeast8": stress.active_spells >= 8,
        "baseNetAboveZero": paths["PUBLIC_BASE"].net_usdt > 0,
        "capacityP05AtLeast1000": stress.active_capacity_p05_usdt is not None
        and stress.active_capacity_p05_usdt >= Decimal("1000"),
        "distinctSymbolsExactly12": stress.distinct_held_symbols == len(FIXED_COHORT),
        "drawdownAtMost25Pct": stress.maximum_drawdown_pct <= Decimal("25"),
        "feeStressNetAboveZero": paths["FEE_STRESS"].net_usdt > 0,
        "lcbAboveZero": inference["lcb5Usdt"] > 0,
        "netAboveZero": stress.net_usdt > 0,
        "positiveMonthsAtLeast3": stress.positive_months >= 3,
        "rawPBelow0.05": inference["pValueOneSided"] < Decimal("0.05"),
        "validFormationsAtLeast14": stress.valid_formations >= 14,
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
    champion = (
        max(
            qualifying,
            key=lambda trial: (
                inference[trial.trial_id]["lcb5Usdt"],
                paths[trial.trial_id]["PUBLIC_STRESS"].net_usdt,
                -paths[trial.trial_id]["PUBLIC_STRESS"].active_spells,
                trial.recent_days,
                trial.threshold,
                -trial.hold_days,
                trial.trial_id,
            ),
        )
        if qualifying
        else None
    )
    payload: dict[str, object] = {
        "championTrialId": champion.trial_id if champion else None,
        "holmAdjustedP": {key: str(value) for key, value in sorted(holm.items())},
        "pboFamilyHeuristic": pbo_cscv(
            {key: value["PUBLIC_STRESS"] for key, value in paths.items()}
        ),
        "qualifyingTrialIds": [trial.trial_id for trial in qualifying],
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
        "holdDays": trial.hold_days,
        "recentDays": trial.recent_days,
        "threshold": str(trial.threshold),
        "trialId": trial.trial_id,
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
        "holdoutMarkerSha256": (
            sha256_path(HOLDOUT_MARKER_PATH) if HOLDOUT_MARKER_PATH.is_file() else None
        ),
        "protocolSha256": sha256_path(PROTOCOL_PATH),
        "runMarkerSha256": sha256_path(RUN_MARKER_PATH),
        "schema": "VG31TerminalResultCoreV1",
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
        raise VG31Error("RUN_OR_OUTCOME_STATE_ALREADY_EXISTS")
    preoutcome_snapshot = frozen_candidate_snapshot()
    STATE_ROOT.mkdir(parents=True, exist_ok=True)
    write_exclusive(
        RUN_MARKER_PATH,
        _marker_payload(
            "VG31RunMarkerV1",
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
                    "VG31CandidateSealV1",
                    championTrial=_trial_payload(champion),
                    developmentSha256=canonical_sha(development_payload),
                ),
            )
            phase = "HOLDOUT_MARKER"
            write_exclusive(
                HOLDOUT_MARKER_PATH,
                _marker_payload(
                    "VG31HoldoutOpenMarkerV1",
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
        "schema": "VG31ResultV1",
        "terminalCoreSha256": sha256_path(TERMINAL_CORE_PATH),
    }
    write_once_or_match(RESULT_PATH, result)


def _validate_common_marker(marker: Mapping[str, Any], schema: str) -> None:
    if marker.get("schema") != schema:
        raise VG31Error(f"{schema}_SCHEMA_INVALID")
    if marker.get("baseCommit") != BASE_COMMIT:
        raise VG31Error(f"{schema}_BASE_INVALID")
    if marker.get("protocolSha256") != sha256_path(PROTOCOL_PATH):
        raise VG31Error(f"{schema}_PROTOCOL_DIGEST_MISMATCH")
    if marker.get("freezeSha256") != sha256_path(FREEZE_PATH):
        raise VG31Error(f"{schema}_FREEZE_DIGEST_MISMATCH")


def _validate_preoutcome_snapshot(value: object) -> None:
    if not isinstance(value, dict):
        raise VG31Error("RUN_MARKER_SNAPSHOT_INVALID")
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
        raise VG31Error("RUN_MARKER_FREEZE_GIT_INVALID")
    if value.get("baseHead") != BASE_COMMIT or value.get("baseHead") != frozen_git.get("head"):
        raise VG31Error("RUN_MARKER_BASE_HEAD_INVALID")
    if value.get("baseTree") != frozen_git.get("tree"):
        raise VG31Error("RUN_MARKER_BASE_TREE_INVALID")
    if changed_paths != required:
        raise VG31Error("RUN_MARKER_SNAPSHOT_PATHS_INVALID")
    if value.get("changedPathsSha256") != canonical_sha(changed_paths):
        raise VG31Error("RUN_MARKER_SNAPSHOT_PATH_DIGEST_MISMATCH")
    packet_files = value.get("packetFiles")
    expected_packet_files = {path: sha256_path(REPO_ROOT / path) for path in required}
    if packet_files != expected_packet_files:
        raise VG31Error("RUN_MARKER_SNAPSHOT_FILE_DIGESTS_INVALID")
    if value.get("packetFilesSha256") != canonical_sha(expected_packet_files):
        raise VG31Error("RUN_MARKER_SNAPSHOT_DIGEST_MISMATCH")


def _selection_key_from_result(trial: Trial, row: Mapping[str, Any]) -> tuple[object, ...]:
    inference = row.get("inference")
    paths = row.get("paths")
    if not isinstance(inference, dict) or not isinstance(paths, dict):
        raise VG31Error(f"DEVELOPMENT_SELECTION_FIELDS_INVALID:{trial.trial_id}")
    stress = paths.get("PUBLIC_STRESS")
    if not isinstance(stress, dict):
        raise VG31Error(f"DEVELOPMENT_STRESS_PATH_INVALID:{trial.trial_id}")
    lcb_raw = inference.get("lcb5Usdt")
    net_raw = stress.get("net_usdt")
    active_spells = stress.get("active_spells")
    if not isinstance(lcb_raw, str) or not isinstance(net_raw, str):
        raise VG31Error(f"DEVELOPMENT_SELECTION_DECIMAL_INVALID:{trial.trial_id}")
    if not isinstance(active_spells, int) or isinstance(active_spells, bool):
        raise VG31Error(f"DEVELOPMENT_ACTIVE_SPELLS_INVALID:{trial.trial_id}")
    lcb = decimal_field(lcb_raw, f"{trial.trial_id}:lcb5Usdt")
    net = decimal_field(net_raw, f"{trial.trial_id}:net_usdt")
    return (
        lcb,
        net,
        -active_spells,
        trial.recent_days,
        trial.threshold,
        -trial.hold_days,
        trial.trial_id,
    )


def verify_terminal_state(result: Mapping[str, Any]) -> None:
    verdict = result.get("verdict")
    if verdict not in {"GO", "NO_GO", "UNMEASURED"}:
        raise VG31Error("RESULT_VERDICT_INVALID")
    if result.get("authority") != "NONE" or result.get("capitalVerdict") != "NO_GO":
        raise VG31Error("RESULT_AUTHORITY_INVALID")
    if result.get("protocolSha256") != sha256_path(PROTOCOL_PATH):
        raise VG31Error("RESULT_PROTOCOL_DIGEST_MISMATCH")
    if result.get("consumer") != "N3 successor/final convergence":
        raise VG31Error("RESULT_CONSUMER_INVALID")
    if result.get("accountEffectiveFees") != "UNKNOWN":
        raise VG31Error("RESULT_ACCOUNT_FEE_AUTHORITY_INVALID")
    if result.get("executableCapacity") != "UNMEASURED":
        raise VG31Error("RESULT_EXECUTABLE_CAPACITY_INVALID")
    if result.get("globalHoldoutStatus") != "NOT_CERTIFIED_SHARED_REUSE_RISK":
        raise VG31Error("RESULT_GLOBAL_HOLDOUT_STATUS_INVALID")
    blocker = result.get("blocker")
    terminal_phase = result.get("terminalPhase")
    if verdict == "UNMEASURED":
        if not isinstance(blocker, str) or not blocker:
            raise VG31Error("UNMEASURED_BLOCKER_ABSENT")
    elif blocker is not None:
        raise VG31Error("MEASURED_BLOCKER_PRESENT")

    if not RUN_MARKER_PATH.is_file():
        raise VG31Error("RUN_MARKER_ABSENT")
    run_marker = read_json(RUN_MARKER_PATH)
    _validate_common_marker(run_marker, "VG31RunMarkerV1")
    if run_marker.get("allowedRunCount") != 1:
        raise VG31Error("RUN_MARKER_COUNT_INVALID")
    if run_marker.get("archiveMembersOpenedBeforeMarker") != 0:
        raise VG31Error("RUN_MARKER_PRIOR_OPEN_COUNT_INVALID")
    _validate_preoutcome_snapshot(run_marker.get("preOutcomeSnapshot"))
    if result.get("runMarkerSha256") != sha256_path(RUN_MARKER_PATH):
        raise VG31Error("RESULT_RUN_MARKER_DIGEST_MISMATCH")

    candidate_exists = CANDIDATE_SEAL_PATH.is_file()
    holdout_marker_exists = HOLDOUT_MARKER_PATH.is_file()
    expected_candidate_sha = sha256_path(CANDIDATE_SEAL_PATH) if candidate_exists else None
    expected_holdout_sha = sha256_path(HOLDOUT_MARKER_PATH) if holdout_marker_exists else None
    if result.get("candidateSealSha256") != expected_candidate_sha:
        raise VG31Error("RESULT_CANDIDATE_SEAL_DIGEST_MISMATCH")
    if result.get("holdoutMarkerSha256") != expected_holdout_sha:
        raise VG31Error("RESULT_HOLDOUT_MARKER_DIGEST_MISMATCH")

    development = result.get("development")
    champion: object = None
    development_trials: dict[str, Any] | None = None
    if development is None:
        if verdict != "UNMEASURED":
            raise VG31Error("MEASURED_RESULT_DEVELOPMENT_ABSENT")
        if terminal_phase not in {"DEVELOPMENT_LOAD", "DEVELOPMENT_EVALUATION"}:
            raise VG31Error("DEVELOPMENT_ABSENT_PHASE_INVALID")
    elif isinstance(development, dict):
        champion = development.get("championTrialId")
        trials = trial_grid()
        expected_trial_ids = [trial.trial_id for trial in trials]
        if development.get("trialCount") != len(trials):
            raise VG31Error("DEVELOPMENT_TRIAL_COUNT_INVALID")
        raw_trials = development.get("trials")
        if not isinstance(raw_trials, dict) or set(raw_trials) != set(expected_trial_ids):
            raise VG31Error("DEVELOPMENT_TRIAL_FAMILY_INVALID")
        development_trials = raw_trials
        computed_qualifying: list[str] = []
        for trial in trials:
            row = raw_trials.get(trial.trial_id)
            if not isinstance(row, dict):
                raise VG31Error(f"DEVELOPMENT_TRIAL_RESULT_INVALID:{trial.trial_id}")
            gates = row.get("gates")
            if (
                not isinstance(gates, dict)
                or set(gates) != DEVELOPMENT_GATE_NAMES
                or any(not isinstance(value, bool) for value in gates.values())
            ):
                raise VG31Error(f"DEVELOPMENT_GATES_INVALID:{trial.trial_id}")
            if all(value is True for value in gates.values()):
                computed_qualifying.append(trial.trial_id)
        if development.get("qualifyingTrialIds") != computed_qualifying:
            raise VG31Error("DEVELOPMENT_QUALIFYING_SET_INVALID")
        expected_champion = (
            max(
                (trial for trial in trials if trial.trial_id in computed_qualifying),
                key=lambda trial: _selection_key_from_result(trial, raw_trials[trial.trial_id]),
            ).trial_id
            if computed_qualifying
            else None
        )
        if champion != expected_champion:
            raise VG31Error("DEVELOPMENT_CHAMPION_SELECTION_INVALID")
    else:
        raise VG31Error("RESULT_DEVELOPMENT_INVALID")

    if champion is None:
        if candidate_exists or holdout_marker_exists:
            raise VG31Error("NO_CHAMPION_HAS_CANDIDATE_OR_HOLDOUT_STATE")
        if result.get("holdout") is not None:
            raise VG31Error("NO_CHAMPION_HAS_HOLDOUT_RESULT")
        if development is not None and (
            verdict != "NO_GO" or terminal_phase != "DEVELOPMENT_GATES_FAILED"
        ):
            raise VG31Error("DEVELOPMENT_GATE_VERDICT_INVALID")
    else:
        if not isinstance(champion, str):
            raise VG31Error("CHAMPION_ID_INVALID")
        matching_trials = [trial for trial in trial_grid() if trial.trial_id == champion]
        if len(matching_trials) != 1:
            raise VG31Error("CHAMPION_NOT_IN_FROZEN_GRID")
        if not isinstance(development, dict):
            raise VG31Error("CHAMPION_DEVELOPMENT_INVALID")
        if development_trials is None:
            raise VG31Error("DEVELOPMENT_TRIALS_INVALID")
        champion_result = development_trials.get(champion)
        if not isinstance(champion_result, dict):
            raise VG31Error("CHAMPION_DEVELOPMENT_RESULT_INVALID")
        champion_gates = champion_result.get("gates")
        if (
            not isinstance(champion_gates, dict)
            or set(champion_gates) != DEVELOPMENT_GATE_NAMES
            or not all(value is True for value in champion_gates.values())
        ):
            raise VG31Error("CHAMPION_DEVELOPMENT_GATES_INVALID")

        if not candidate_exists:
            if holdout_marker_exists:
                raise VG31Error("HOLDOUT_MARKER_WITHOUT_CANDIDATE")
            if verdict != "UNMEASURED" or terminal_phase != "CANDIDATE_SEAL":
                raise VG31Error("CANDIDATE_SEAL_FAILURE_STATE_INVALID")
            if result.get("holdout") is not None:
                raise VG31Error("CANDIDATE_SEAL_FAILURE_HAS_HOLDOUT_RESULT")
        else:
            candidate = read_json(CANDIDATE_SEAL_PATH)
            _validate_common_marker(candidate, "VG31CandidateSealV1")
            if candidate.get("championTrial") != _trial_payload(matching_trials[0]):
                raise VG31Error("CANDIDATE_CHAMPION_BINDING_INVALID")
            if candidate.get("developmentSha256") != canonical_sha(development):
                raise VG31Error("CANDIDATE_DEVELOPMENT_DIGEST_MISMATCH")

            if not holdout_marker_exists:
                if verdict != "UNMEASURED" or terminal_phase != "HOLDOUT_MARKER":
                    raise VG31Error("HOLDOUT_MARKER_FAILURE_STATE_INVALID")
                if result.get("holdout") is not None:
                    raise VG31Error("HOLDOUT_MARKER_FAILURE_HAS_HOLDOUT_RESULT")
            else:
                holdout_marker = read_json(HOLDOUT_MARKER_PATH)
                _validate_common_marker(holdout_marker, "VG31HoldoutOpenMarkerV1")
                if holdout_marker.get("allowedOpenCount") != 1:
                    raise VG31Error("HOLDOUT_MARKER_COUNT_INVALID")
                if holdout_marker.get("holdoutMembersOpenedBeforeMarker") != 0:
                    raise VG31Error("HOLDOUT_MARKER_PRIOR_OPEN_COUNT_INVALID")
                if holdout_marker.get("candidateSealSha256") != sha256_path(CANDIDATE_SEAL_PATH):
                    raise VG31Error("HOLDOUT_MARKER_CANDIDATE_DIGEST_MISMATCH")

                holdout = result.get("holdout")
                if holdout is None:
                    if verdict != "UNMEASURED" or terminal_phase not in {
                        "HOLDOUT_LOAD",
                        "HOLDOUT_EVALUATION",
                    }:
                        raise VG31Error("HOLDOUT_FAILURE_STATE_INVALID")
                elif isinstance(holdout, dict):
                    if holdout.get("championTrialId") != champion:
                        raise VG31Error("HOLDOUT_CHAMPION_BINDING_INVALID")
                    gates = holdout.get("gates")
                    if (
                        not isinstance(gates, dict)
                        or set(gates) != HOLDOUT_GATE_NAMES
                        or any(not isinstance(value, bool) for value in gates.values())
                    ):
                        raise VG31Error("HOLDOUT_GATES_INVALID")
                    all_pass = all(value is True for value in gates.values())
                    expected_verdict = "GO" if all_pass else "NO_GO"
                    if verdict != expected_verdict or terminal_phase != "HOLDOUT_MEASURED":
                        raise VG31Error("HOLDOUT_VERDICT_INVALID")
                else:
                    raise VG31Error("HOLDOUT_RESULT_INVALID")

    if not TERMINAL_CORE_PATH.is_file():
        raise VG31Error("TERMINAL_CORE_ABSENT")
    if result.get("terminalCoreSha256") != sha256_path(TERMINAL_CORE_PATH):
        raise VG31Error("RESULT_TERMINAL_CORE_DIGEST_MISMATCH")
    core = read_json(TERMINAL_CORE_PATH)
    result_core = dict(result)
    result_core.pop("terminalCoreSha256", None)
    result_core["schema"] = "VG31TerminalResultCoreV1"
    if canonical_bytes(result_core) != canonical_bytes(core):
        raise VG31Error("RESULT_TERMINAL_CORE_BYTES_MISMATCH")


def verify() -> str:
    assert_frozen()
    checksum_rows = SHA256SUMS_PATH.read_text(encoding="ascii").splitlines()
    expected_names = {path.name for path in (*static_paths(), SOURCE_MANIFEST_PATH, FREEZE_PATH)}
    observed_names: set[str] = set()
    for row in checksum_rows:
        digest, separator, name = row.partition("  ")
        if separator != "  " or not re.fullmatch(r"[0-9a-f]{64}", digest):
            raise VG31Error("SHA256SUMS_ROW_INVALID")
        if name in observed_names or name not in expected_names:
            raise VG31Error("SHA256SUMS_NAME_INVALID")
        observed_names.add(name)
        if sha256_path(HERE / name) != digest:
            raise VG31Error(f"SHA256SUMS_DIGEST_MISMATCH:{name}")
    if observed_names != expected_names:
        raise VG31Error("SHA256SUMS_COVERAGE_INVALID")
    if not RESULT_PATH.exists():
        for marker in (
            RUN_MARKER_PATH,
            CANDIDATE_SEAL_PATH,
            HOLDOUT_MARKER_PATH,
            TERMINAL_CORE_PATH,
        ):
            if marker.exists():
                raise VG31Error(f"PREOUTCOME_RESULT_ABSENT_WITH_MARKER:{marker}")
        return "VG31_VERIFY PASS state=PREOUTCOME_FROZEN verdict=UNMEASURED_PENDING_SEALED_RUN"
    result = read_json(RESULT_PATH)
    verify_terminal_state(result)
    return f"VG31_VERIFY PASS state=TERMINAL verdict={result['verdict']}"


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("freeze", "run", "verify"))
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        if args.command == "freeze":
            freeze()
            print("VG31_FREEZE PASS archive_members_opened=0")
        elif args.command == "run":
            run()
            print(verify())
        else:
            print(verify())
        return 0
    except VG31Error as error:
        print(f"VG31_{args.command.upper()} FAIL {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
