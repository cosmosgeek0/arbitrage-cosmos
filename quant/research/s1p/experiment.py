#!/usr/bin/env python3
"""Deterministic, network-free S-1P public research evaluator.

The command surface deliberately separates the pre-outcome freeze from the
single archive-body run:

    freeze-candidate -> run -> authenticate-report

No command imports a networking module.  Archive members are opened only by
``ArchiveReader`` after the lifecycle markers required by protocol.v1.json
exist and authenticate.
"""

from __future__ import annotations

import argparse
import contextlib
import csv
import hashlib
import io
import itertools
import json
import os
import random
import subprocess
import sys
import zipfile
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import ROUND_CEILING, Decimal, InvalidOperation, localcontext
from pathlib import Path
from typing import Any, cast

HERE = Path(__file__).resolve().parent
PROTOCOL_PATH = HERE / "protocol.v1.json"
SOURCES_PATH = HERE / "official_sources.v1.json"
RESEARCH_PATH = HERE / "OFFICIAL_SOURCE_RESEARCH.md"
DISTINCTNESS_PATH = HERE / "DISTINCTNESS.md"
README_PATH = HERE / "README.md"
TEST_PATH = HERE / "test_experiment.py"
COMMITTED_FREEZE_PATH = HERE / "freeze.v1.json"
COMMITTED_RESULT_PATH = HERE / "result.v1.json"
CHECKSUMS_PATH = HERE / "SHA256SUMS"
EXPECTED_ORIGIN_URL = "git@github.com:cosmosgeek0/arbitrage-cosmos.git"
GIT_EXECUTABLE = Path("/usr/bin/git")
DEFAULT_VG9_PROTOCOL_PATH = Path(
    "/Users/cosmosgeek/.codex/worktrees/"
    "cosmos-vg9-spot-usdm-volume-leadership-1be1-2f7c/"
    "quant/research/vg9/protocol.v1.json"
)

PRE_FREEZE_NAME = "S1P_PRE_OUTCOME_FREEZE_CANDIDATE.v1.json"
RUN_MARKER_NAME = "S1P_RUN_CONSUMED.v1.json"
DEVELOPMENT_RESULT_NAME = "S1P_DEVELOPMENT_RESULT.v1.json"
CHAMPION_SEAL_NAME = "S1P_FREEZE_CANDIDATE.v1.json"
HOLDOUT_MARKER_NAME = "S1P_HOLDOUT_OPEN.v1.json"
RESULT_NAME = "S1P_RESULT_CANDIDATE.v1.json"

LIFECYCLE_NAMES = (
    PRE_FREEZE_NAME,
    RUN_MARKER_NAME,
    DEVELOPMENT_RESULT_NAME,
    CHAMPION_SEAL_NAME,
    HOLDOUT_MARKER_NAME,
    RESULT_NAME,
)

PACKET_PATHS = (
    README_PATH,
    RESEARCH_PATH,
    DISTINCTNESS_PATH,
    PROTOCOL_PATH,
    SOURCES_PATH,
    Path(__file__).resolve(),
    TEST_PATH,
    COMMITTED_FREEZE_PATH,
    COMMITTED_RESULT_PATH,
)

FIVE_MINUTES_MS = 300_000
HOUR_MS = 3_600_000
DAY_BARS = 288
HISTORY_DAYS = 28
HISTORY_BARS = DAY_BARS * HISTORY_DAYS
ONE = Decimal("1")
ZERO = Decimal("0")
TEN_THOUSAND = Decimal("10000")


class S1PError(RuntimeError):
    """Base error with a stable machine-readable code."""

    def __init__(self, code: str, detail: str):
        super().__init__(f"{code}: {detail}")
        self.code = code
        self.detail = detail


class ContractError(S1PError):
    """Frozen-input or lifecycle-contract violation."""


class DataValidationError(S1PError):
    """Terminal public-data validity failure."""


def canonical_bytes(value: Any) -> bytes:
    return (
        json.dumps(
            value,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
            allow_nan=False,
        ).encode("utf-8")
        + b"\n"
    )


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_json(path: Path) -> Any:
    try:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, json.JSONDecodeError) as exc:
        raise ContractError("JSON_READ_FAILED", f"{path}: {exc}") from exc


def load_json_with_sha256(path: Path) -> tuple[Any, str]:
    try:
        payload = path.read_bytes()
        document = json.loads(payload.decode("utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ContractError("JSON_READ_FAILED", f"{path}: {exc}") from exc
    return document, sha256_bytes(payload)


def with_artifact_digest(document: Mapping[str, Any]) -> dict[str, Any]:
    result = dict(document)
    if "artifactSha256" in result:
        raise ContractError("ARTIFACT_DIGEST_DUPLICATE", "artifactSha256 already set")
    result["artifactSha256"] = sha256_bytes(canonical_bytes(result))
    return result


def verify_artifact(document: Any, expected_schema: str | None = None) -> dict[str, Any]:
    if not isinstance(document, dict):
        raise ContractError("ARTIFACT_NOT_OBJECT", "artifact root must be an object")
    digest = document.get("artifactSha256")
    if not isinstance(digest, str) or len(digest) != 64:
        raise ContractError("ARTIFACT_DIGEST_MISSING", "artifactSha256 is absent or malformed")
    unsigned = dict(document)
    del unsigned["artifactSha256"]
    actual = sha256_bytes(canonical_bytes(unsigned))
    if actual != digest:
        raise ContractError("ARTIFACT_DIGEST_MISMATCH", f"expected {digest}, computed {actual}")
    if expected_schema is not None and document.get("schema") != expected_schema:
        raise ContractError(
            "ARTIFACT_SCHEMA_MISMATCH",
            f"expected {expected_schema}, found {document.get('schema')!r}",
        )
    return dict(document)


def exclusive_write_json(path: Path, document: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = canonical_bytes(document)
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    try:
        descriptor = os.open(path, flags, 0o600)
    except FileExistsError as exc:
        raise ContractError("SECOND_WRITE_REFUSED", f"{path} already exists") from exc
    try:
        with os.fdopen(descriptor, "wb", closefd=True) as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
    except BaseException:
        with contextlib.suppress(OSError):
            path.unlink()
        raise


def artifact_file_sha256(path: Path) -> str:
    return sha256_file(path)


def decimal(value: Any, field: str) -> Decimal:
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise DataValidationError("DECIMAL_INVALID", f"{field}={value!r}") from exc
    if not number.is_finite():
        raise DataValidationError("DECIMAL_NONFINITE", f"{field}={value!r}")
    return number


def dstr(value: Decimal) -> str:
    if value == ZERO:
        return "0"
    return format(value, "f")


def parse_utc_ms(value: str) -> int:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ContractError("UTC_REQUIRED", value)
    return int(parsed.astimezone(UTC).timestamp() * 1000)


def utc_day(ts_ms: int) -> str:
    return datetime.fromtimestamp(ts_ms / 1000, UTC).strftime("%Y-%m-%d")


def utc_month(ts_ms: int) -> str:
    return datetime.fromtimestamp(ts_ms / 1000, UTC).strftime("%Y-%m")


def utc_quarter(ts_ms: int) -> str:
    value = datetime.fromtimestamp(ts_ms / 1000, UTC)
    return f"{value.year}-Q{((value.month - 1) // 3) + 1}"


def median_decimal(values: Sequence[Decimal]) -> Decimal:
    if not values:
        raise DataValidationError("MEDIAN_EMPTY", "no observations")
    ordered = sorted(values)
    midpoint = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[midpoint]
    return (ordered[midpoint - 1] + ordered[midpoint]) / Decimal(2)


def robust_location_scale(
    values: Sequence[Decimal], minimum_scale: Decimal
) -> tuple[Decimal, Decimal]:
    location = median_decimal(values)
    mad = median_decimal([abs(value - location) for value in values])
    scale = max(Decimal("1.4826") * mad, minimum_scale)
    return location, scale


def deterministic_ln(value: Decimal) -> Decimal:
    if value <= ZERO:
        raise DataValidationError("LOG_DOMAIN_INVALID", dstr(value))
    with localcontext() as context:
        context.prec = 50
        return value.ln()


def deterministic_log1p(value: Decimal) -> Decimal:
    if value < ZERO:
        raise DataValidationError("LOG1P_DOMAIN_INVALID", dstr(value))
    return deterministic_ln(ONE + value)


@dataclass(frozen=True)
class Bar:
    ts_ms: int
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    quote_volume: Decimal


@dataclass(frozen=True)
class Funding:
    ts_ms: int
    interval_hours: int
    rate: Decimal


@dataclass(frozen=True)
class CalibrationPoint:
    ts_ms: int
    raw_basis_bps: Decimal
    basis_location: Decimal
    basis_scale: Decimal
    basis_z: Decimal
    spot_volume_location: Decimal
    spot_volume_scale: Decimal
    perpetual_volume_location: Decimal
    perpetual_volume_scale: Decimal
    relative_volume_intensity_z: Decimal


@dataclass(frozen=True)
class Trial:
    trial_id: str
    volume_threshold: Decimal
    basis_threshold: Decimal


@dataclass
class Arm:
    symbol: str
    event_index: int
    basis_location: Decimal
    basis_scale: Decimal
    spot_volume_location: Decimal
    spot_volume_scale: Decimal
    perpetual_volume_location: Decimal
    perpetual_volume_scale: Decimal


@dataclass
class Position:
    symbol: str
    entry_index: int
    entry_spot: Decimal
    entry_perpetual: Decimal
    quantity: Decimal
    entry_basis_z: Decimal
    basis_location: Decimal
    basis_scale: Decimal
    source_arm_index: int


@dataclass(frozen=True)
class CapacityFill:
    fill_id: str
    actual_fill_notional: Decimal
    prior_quote_volume: Decimal


@dataclass(frozen=True)
class SeverePathPoint:
    index: int
    ts_ms: int
    spot_close: Decimal
    perpetual_close: Decimal
    cumulative_adverse_funding_debit: Decimal
    severe_pnl: Decimal


@dataclass(frozen=True)
class Trade:
    symbol: str
    source_arm_index: int
    entry_index: int
    exit_index: int
    entry_ts_ms: int
    exit_ts_ms: int
    quantity: Decimal
    entry_spot: Decimal
    entry_perpetual: Decimal
    exit_spot: Decimal
    exit_perpetual: Decimal
    exit_reasons: tuple[str, ...]
    gross_pnl: Decimal
    adverse_funding_debit: Decimal
    discarded_favorable_funding_credit: Decimal
    net_by_cost: Mapping[str, Decimal]
    capacity_fills: tuple[CapacityFill, ...]
    severe_path: tuple[SeverePathPoint, ...]
    capacity_base_pass: bool
    capacity_stress_pass: bool


@dataclass(frozen=True)
class PhaseData:
    phase: str
    start_ms: int
    end_ms: int
    bars: Mapping[str, Mapping[str, tuple[Bar, ...]]]
    funding: Mapping[str, tuple[Funding, ...]]

    @property
    def length(self) -> int:
        first_symbol = sorted(self.bars)[0]
        return len(self.bars[first_symbol]["spotKlines"])


@dataclass(frozen=True)
class SimulationResult:
    trial: Trial
    phase: str
    trades: tuple[Trade, ...]
    daily_net_by_cost: Mapping[str, tuple[Decimal, ...]]
    daily_dates: tuple[str, ...]
    severe_equity_curve_usd: tuple[Decimal, ...]
    maximum_severe_drawdown_pct: Decimal


def load_frozen_bundle() -> tuple[dict[str, Any], dict[str, Any], dict[str, str]]:
    protocol = load_json(PROTOCOL_PATH)
    sources = load_json(SOURCES_PATH)
    if protocol.get("schema") != "S1PVolumeLeadBasisReversionProtocolV1":
        raise ContractError("PROTOCOL_SCHEMA_INVALID", repr(protocol.get("schema")))
    if sources.get("schema") != "S1POfficialSourcesV1":
        raise ContractError("SOURCES_SCHEMA_INVALID", repr(sources.get("schema")))
    hashes = {
        "protocolSha256": sha256_file(PROTOCOL_PATH),
        "officialSourcesSha256": sha256_file(SOURCES_PATH),
        "officialSourceResearchSha256": sha256_file(RESEARCH_PATH),
        "distinctnessSha256": sha256_file(DISTINCTNESS_PATH),
        "readmeSha256": sha256_file(README_PATH),
        "implementationSha256": sha256_file(Path(__file__).resolve()),
        "testSha256": sha256_file(TEST_PATH),
    }
    return protocol, sources, hashes


def flatten_json_strings(value: Any) -> tuple[str, ...]:
    found: list[str] = []
    if isinstance(value, str):
        found.append(value.upper().replace("-", "_").replace(" ", "_"))
    elif isinstance(value, list):
        for item in value:
            found.extend(flatten_json_strings(item))
    elif isinstance(value, dict):
        for key, item in value.items():
            found.append(str(key).upper())
            found.extend(flatten_json_strings(item))
    return tuple(found)


def vg9_collision_status(vg9_protocol: Any) -> str:
    """Conservatively detect the collision named by the frozen S-1P protocol."""

    if not isinstance(vg9_protocol, dict):
        raise ContractError("VG9_PROTOCOL_INVALID", "root must be an object")
    corpus = "_".join(flatten_json_strings(vg9_protocol))
    own_basis = (
        "OWN_SYMBOL" in corpus
        and "BASIS" in corpus
        and ("CROSS" in corpus or "CROSSES" in corpus)
        and ("LATER" in corpus or "ONE_TO_SIX" in corpus or "1_TO_6" in corpus)
    )
    paired_trade = (
        "LONG_SPOT" in corpus
        and ("SHORT_USD_M" in corpus or "SHORT_SAME_SYMBOL" in corpus)
        and ("PERPETUAL" in corpus or "PAIRED" in corpus or "BASIS_REVERSION" in corpus)
    )
    if own_basis and paired_trade:
        return "COLLISION_STOP_UNMEASURED"
    return "DISTINCT_CLEAR_TO_EVALUATE"


def expected_discovery_keys(protocol: Mapping[str, Any]) -> set[tuple[str, str, str]]:
    months: list[str] = []
    start, end = protocol["data"]["targetMonthsInclusive"]
    cursor = datetime.strptime(start, "%Y-%m").replace(tzinfo=UTC)
    end_cursor = datetime.strptime(end, "%Y-%m").replace(tzinfo=UTC)
    while cursor <= end_cursor:
        months.append(cursor.strftime("%Y-%m"))
        if cursor.month == 12:
            cursor = cursor.replace(year=cursor.year + 1, month=1)
        else:
            cursor = cursor.replace(month=cursor.month + 1)
    kinds = ("spotKlines", "perpetualKlines", "markPriceKlines", "fundingRate")
    return {
        (kind, symbol, month)
        for kind in kinds
        for symbol in protocol["data"]["symbols"]
        for month in months
    }


def validate_discovery(
    discovery: Any, protocol: Mapping[str, Any]
) -> dict[tuple[str, str, str], dict[str, Any]]:
    if not isinstance(discovery, dict):
        raise DataValidationError("DISCOVERY_INVALID", "root must be an object")
    if discovery.get("archiveBodiesOpened") is not False:
        raise DataValidationError(
            "DISCOVERY_BODY_POSTURE_INVALID", "archiveBodiesOpened must be false"
        )
    sources = discovery.get("sources")
    if not isinstance(sources, list):
        raise DataValidationError("DISCOVERY_SOURCES_INVALID", "sources must be a list")
    if len(sources) != protocol["data"]["archiveCount"]:
        raise DataValidationError(
            "DISCOVERY_COUNT_INVALID",
            f"expected {protocol['data']['archiveCount']}, found {len(sources)}",
        )
    expected = expected_discovery_keys(protocol)
    indexed: dict[tuple[str, str, str], dict[str, Any]] = {}
    development_months = set(protocol["calendar"]["development"]["months"])
    holdout_months = set(protocol["calendar"]["holdout"]["months"])
    for row in sources:
        if not isinstance(row, dict):
            raise DataValidationError("DISCOVERY_ROW_INVALID", repr(row))
        key = (row.get("kind"), row.get("symbol"), row.get("month"))
        if key not in expected:
            raise DataValidationError("DISCOVERY_UNEXPECTED_ROW", repr(key))
        if key in indexed:
            raise DataValidationError("DISCOVERY_DUPLICATE_ROW", repr(key))
        phase = row.get("phase")
        expected_phase = "development" if row.get("month") in development_months else "holdout"
        if row.get("month") not in development_months | holdout_months:
            raise DataValidationError("DISCOVERY_MONTH_INVALID", repr(row.get("month")))
        if phase != expected_phase:
            raise DataValidationError(
                "DISCOVERY_PHASE_INVALID", f"{key}: {phase!r} != {expected_phase!r}"
            )
        digest = row.get("sha256")
        if not isinstance(digest, str) or len(digest) != 64:
            raise DataValidationError("DISCOVERY_SHA_INVALID", repr(key))
        indexed[key] = dict(row)
    if set(indexed) != expected:
        missing = sorted(expected - set(indexed))
        raise DataValidationError("DISCOVERY_ROWS_MISSING", repr(missing))
    return indexed


def normalize_open_time(raw: str, kind: str) -> int:
    try:
        timestamp = int(raw)
    except ValueError as exc:
        raise DataValidationError("TIMESTAMP_INVALID", f"{kind}: {raw!r}") from exc
    if kind == "spotKlines":
        if timestamp < 100_000_000_000_000:
            raise DataValidationError("SPOT_TIMESTAMP_NOT_MICROSECONDS", str(timestamp))
        if timestamp % 1000:
            raise DataValidationError("SPOT_TIMESTAMP_SUBMILLISECOND_OPEN", str(timestamp))
        timestamp //= 1000
    elif timestamp >= 100_000_000_000_000:
        raise DataValidationError("USD_M_TIMESTAMP_NOT_MILLISECONDS", f"{kind}: {timestamp}")
    return timestamp


def parse_kline_csv(text: str, kind: str, start_ms: int, end_ms: int) -> tuple[Bar, ...]:
    reader = csv.reader(io.StringIO(text))
    bars: list[Bar] = []
    seen: set[int] = set()
    for row_number, row in enumerate(reader, start=1):
        if not row or all(not item.strip() for item in row):
            continue
        if row_number == 1:
            try:
                int(row[0])
            except ValueError:
                continue
        if len(row) != 12:
            raise DataValidationError(
                "KLINE_COLUMN_COUNT_INVALID", f"{kind} row {row_number}: {len(row)}"
            )
        timestamp = normalize_open_time(row[0].strip(), kind)
        if timestamp < start_ms or timestamp >= end_ms:
            raise DataValidationError("KLINE_TIMESTAMP_OUTSIDE_PHASE", f"{kind}: {timestamp}")
        if timestamp % FIVE_MINUTES_MS:
            raise DataValidationError("KLINE_TIMESTAMP_OFF_GRID", f"{kind}: {timestamp}")
        if timestamp in seen:
            raise DataValidationError("KLINE_TIMESTAMP_DUPLICATE", f"{kind}: {timestamp}")
        seen.add(timestamp)
        open_price = decimal(row[1], f"{kind}.open")
        high = decimal(row[2], f"{kind}.high")
        low = decimal(row[3], f"{kind}.low")
        close = decimal(row[4], f"{kind}.close")
        quote_volume = decimal(row[7], f"{kind}.quoteVolume")
        if min(open_price, high, low, close) <= ZERO:
            raise DataValidationError("KLINE_PRICE_NONPOSITIVE", f"{kind}: {timestamp}")
        if high < max(open_price, close, low) or low > min(open_price, close, high):
            raise DataValidationError("KLINE_OHLC_INCONSISTENT", f"{kind}: {timestamp}")
        if quote_volume < ZERO:
            raise DataValidationError("KLINE_QUOTE_VOLUME_NEGATIVE", f"{kind}: {timestamp}")
        bars.append(Bar(timestamp, open_price, high, low, close, quote_volume))
    bars.sort(key=lambda bar: bar.ts_ms)
    return tuple(bars)


def parse_funding_csv(text: str, start_ms: int, end_ms: int) -> tuple[Funding, ...]:
    rows = list(csv.reader(io.StringIO(text)))
    if not rows:
        raise DataValidationError("FUNDING_EMPTY", "CSV has no rows")
    expected_header = (
        "calc_time",
        "funding_interval_hours",
        "last_funding_rate",
    )
    header = tuple(name.strip().lower() for name in rows[0])
    if header != expected_header:
        raise DataValidationError(
            "FUNDING_HEADER_INVALID",
            f"{header!r} != {expected_header!r}",
        )
    if len(rows) == 1:
        raise DataValidationError("FUNDING_EMPTY", "header only")
    settlements: list[Funding] = []
    seen: set[int] = set()
    for row_number, row in enumerate(rows[1:], start=2):
        if not row or all(not item.strip() for item in row):
            continue
        if len(row) != len(expected_header):
            raise DataValidationError(
                "FUNDING_COLUMN_COUNT_INVALID",
                f"row {row_number}: {len(row)}",
            )
        try:
            timestamp = int(row[0].strip())
        except ValueError as exc:
            raise DataValidationError("FUNDING_TIMESTAMP_INVALID", f"row {row_number}") from exc
        if timestamp >= 100_000_000_000_000:
            raise DataValidationError("FUNDING_TIMESTAMP_NOT_MILLISECONDS", str(timestamp))
        if timestamp < start_ms or timestamp >= end_ms:
            raise DataValidationError("FUNDING_TIMESTAMP_OUTSIDE_PHASE", str(timestamp))
        if timestamp % HOUR_MS:
            raise DataValidationError("FUNDING_TIMESTAMP_OFF_HOUR", str(timestamp))
        if timestamp in seen:
            raise DataValidationError("FUNDING_TIMESTAMP_DUPLICATE", str(timestamp))
        seen.add(timestamp)
        interval = decimal(row[1], "funding.intervalHours")
        if interval != interval.to_integral_value() or interval <= ZERO or interval > Decimal(24):
            raise DataValidationError(
                "FUNDING_INTERVAL_INVALID",
                f"row {row_number}: {dstr(interval)}",
            )
        settlements.append(
            Funding(
                timestamp,
                int(interval),
                decimal(row[2], "funding.rate"),
            )
        )
    settlements.sort(key=lambda item: item.ts_ms)
    if not settlements:
        raise DataValidationError("FUNDING_EMPTY", "no data rows")
    return tuple(settlements)


def validate_funding_coverage(
    settlements: Sequence[Funding],
    start_ms: int,
    end_ms: int,
    identity: str,
) -> None:
    if not settlements:
        raise DataValidationError("FUNDING_EMPTY", identity)
    leading_limit = settlements[0].interval_hours * HOUR_MS
    if settlements[0].ts_ms - start_ms > leading_limit:
        raise DataValidationError(
            "FUNDING_LEADING_COVERAGE_GAP",
            f"{identity}: {settlements[0].ts_ms - start_ms}",
        )
    trailing_limit = settlements[-1].interval_hours * HOUR_MS
    if end_ms - settlements[-1].ts_ms > trailing_limit:
        raise DataValidationError(
            "FUNDING_TRAILING_COVERAGE_GAP",
            f"{identity}: {end_ms - settlements[-1].ts_ms}",
        )
    for previous, current in itertools.pairwise(settlements):
        if current.interval_hours != previous.interval_hours:
            raise DataValidationError(
                "FUNDING_INTERVAL_TRANSITION_UNSUPPORTED",
                (
                    f"{identity}: {previous.ts_ms}/{previous.interval_hours}"
                    f"->{current.ts_ms}/{current.interval_hours}"
                ),
            )
        gap = current.ts_ms - previous.ts_ms
        applicable_limit = current.interval_hours * HOUR_MS
        if gap <= 0 or gap > applicable_limit:
            raise DataValidationError(
                "FUNDING_INTERNAL_COVERAGE_GAP",
                f"{identity}: {previous.ts_ms}->{current.ts_ms}",
            )


class ArchiveReader:
    """The only ZIP-member-open seam; every open is marker and hash guarded."""

    def __init__(self, state_dir: Path, archive_root: Path):
        self.state_dir = state_dir.resolve()
        self.archive_root = archive_root.resolve()

    def _require_body_permission(self, phase: str) -> None:
        run_marker = self.state_dir / RUN_MARKER_NAME
        run_document = verify_artifact(load_json(run_marker), "S1PRunConsumedV1")
        pre_freeze_path = self.state_dir / PRE_FREEZE_NAME
        verify_artifact(load_json(pre_freeze_path), "S1PPreOutcomeFreezeCandidateV1")
        if run_document.get("preOutcomeFreezeFileSha256") != sha256_file(pre_freeze_path):
            raise ContractError(
                "RUN_MARKER_FREEZE_LINK_INVALID",
                "run marker does not bind the pre-outcome freeze file",
            )
        if phase == "holdout":
            champion_path = self.state_dir / CHAMPION_SEAL_NAME
            champion = verify_artifact(
                load_json(champion_path),
                "S1PDevelopmentChampionSealV1",
            )
            development_path = self.state_dir / DEVELOPMENT_RESULT_NAME
            verify_artifact(load_json(development_path), "S1PDevelopmentResultV1")
            if champion.get("developmentResultFileSha256") != sha256_file(development_path):
                raise ContractError(
                    "CHAMPION_DEVELOPMENT_LINK_INVALID",
                    "champion does not bind the development result file",
                )
            holdout = verify_artifact(
                load_json(self.state_dir / HOLDOUT_MARKER_NAME),
                "S1PHoldoutOpenV1",
            )
            if holdout.get("championSealFileSha256") != sha256_file(champion_path):
                raise ContractError(
                    "HOLDOUT_CHAMPION_LINK_INVALID",
                    "holdout marker does not bind the champion seal file",
                )

    def read_one_csv(self, row: Mapping[str, Any], phase: str) -> str:
        self._require_body_permission(phase)
        digest = row["sha256"]
        path = (self.archive_root / f"{digest}.zip").resolve()
        if path.parent != self.archive_root:
            raise DataValidationError("ARCHIVE_PATH_ESCAPE", str(path))
        try:
            actual_sha = sha256_file(path)
        except OSError as exc:
            raise DataValidationError("ARCHIVE_READ_FAILED", f"{path}: {exc}") from exc
        if actual_sha != digest:
            raise DataValidationError("ARCHIVE_SHA256_MISMATCH", str(path))
        try:
            with zipfile.ZipFile(path, "r") as archive:
                members = [
                    info
                    for info in archive.infolist()
                    if not info.is_dir() and info.filename.lower().endswith(".csv")
                ]
                if len(members) != 1 or len(archive.infolist()) != 1:
                    raise DataValidationError(
                        "ZIP_SHAPE_INVALID",
                        f"{path}: expected exactly one non-directory CSV member",
                    )
                data = archive.read(members[0])
        except (OSError, zipfile.BadZipFile, RuntimeError) as exc:
            if isinstance(exc, DataValidationError):
                raise
            raise DataValidationError("ZIP_READ_FAILED", f"{path}: {exc}") from exc
        try:
            return data.decode("utf-8-sig")
        except UnicodeDecodeError as exc:
            raise DataValidationError("CSV_UTF8_INVALID", str(path)) from exc


def expected_grid(start_ms: int, end_ms: int) -> tuple[int, ...]:
    if start_ms % FIVE_MINUTES_MS or end_ms % FIVE_MINUTES_MS or end_ms <= start_ms:
        raise ContractError("PHASE_GRID_INVALID", f"{start_ms}..{end_ms}")
    return tuple(range(start_ms, end_ms, FIVE_MINUTES_MS))


def month_bounds_utc(month: str) -> tuple[int, int]:
    start = datetime.strptime(month, "%Y-%m").replace(tzinfo=UTC)
    if start.month == 12:
        end = start.replace(year=start.year + 1, month=1)
    else:
        end = start.replace(month=start.month + 1)
    return int(start.timestamp() * 1000), int(end.timestamp() * 1000)


def validate_complete_grid(bars: Sequence[Bar], start_ms: int, end_ms: int, identity: str) -> None:
    actual = tuple(bar.ts_ms for bar in bars)
    expected = expected_grid(start_ms, end_ms)
    if actual != expected:
        first = next(
            (
                index
                for index, pair in enumerate(itertools.zip_longest(actual, expected))
                if pair[0] != pair[1]
            ),
            None,
        )
        raise DataValidationError(
            "KLINE_GRID_INCOMPLETE",
            f"{identity}: count {len(actual)} != {len(expected)}, first mismatch {first}",
        )


def load_phase_data(
    protocol: Mapping[str, Any],
    indexed_discovery: Mapping[tuple[str, str, str], Mapping[str, Any]],
    reader: ArchiveReader,
    phase: str,
) -> PhaseData:
    phase_contract = protocol["calendar"][phase]
    start_ms = parse_utc_ms(phase_contract["startInclusive"])
    end_ms = parse_utc_ms(phase_contract["endExclusive"])
    months = tuple(phase_contract["months"])
    bars: dict[str, dict[str, tuple[Bar, ...]]] = {}
    funding: dict[str, tuple[Funding, ...]] = {}
    for symbol in sorted(protocol["data"]["symbols"]):
        bars[symbol] = {}
        for kind in ("spotKlines", "perpetualKlines", "markPriceKlines"):
            combined: list[Bar] = []
            for month in months:
                row = indexed_discovery[(kind, symbol, month)]
                text = reader.read_one_csv(row, phase)
                month_start_ms, month_end_ms = month_bounds_utc(month)
                month_bars = parse_kline_csv(
                    text,
                    kind,
                    month_start_ms,
                    month_end_ms,
                )
                validate_complete_grid(
                    month_bars,
                    month_start_ms,
                    month_end_ms,
                    f"{symbol}/{kind}/{month}",
                )
                combined.extend(month_bars)
            combined.sort(key=lambda bar: bar.ts_ms)
            validate_complete_grid(combined, start_ms, end_ms, f"{symbol}/{kind}/{phase}")
            bars[symbol][kind] = tuple(combined)
        combined_funding: list[Funding] = []
        for month in months:
            row = indexed_discovery[("fundingRate", symbol, month)]
            text = reader.read_one_csv(row, phase)
            month_start_ms, month_end_ms = month_bounds_utc(month)
            month_funding = parse_funding_csv(text, month_start_ms, month_end_ms)
            validate_funding_coverage(
                month_funding,
                month_start_ms,
                month_end_ms,
                f"{symbol}/{month}",
            )
            combined_funding.extend(month_funding)
        combined_funding.sort(key=lambda item: item.ts_ms)
        if len({item.ts_ms for item in combined_funding}) != len(combined_funding):
            raise DataValidationError("FUNDING_TIMESTAMP_DUPLICATE_ACROSS_MONTHS", symbol)
        validate_funding_coverage(
            combined_funding,
            start_ms,
            end_ms,
            f"{symbol}/{phase}",
        )
        mark_times = {bar.ts_ms for bar in bars[symbol]["markPriceKlines"]}
        for item in combined_funding:
            if item.ts_ms not in mark_times:
                raise DataValidationError("FUNDING_MARK_OPEN_MISSING", f"{symbol}: {item.ts_ms}")
        funding[symbol] = tuple(combined_funding)
    reference: tuple[int, ...] | None = None
    for symbol in sorted(bars):
        for kind in ("spotKlines", "perpetualKlines", "markPriceKlines"):
            clocks = tuple(bar.ts_ms for bar in bars[symbol][kind])
            if reference is None:
                reference = clocks
            elif clocks != reference:
                raise DataValidationError("PHASE_CLOCKS_NOT_IDENTICAL", f"{phase}: {symbol}/{kind}")
    return PhaseData(phase, start_ms, end_ms, bars, funding)


def concatenate_phase_data(development: PhaseData, holdout: PhaseData) -> PhaseData:
    if development.end_ms != holdout.start_ms:
        raise ContractError("PHASES_NOT_CONTIGUOUS", "development and holdout")
    bars: dict[str, dict[str, tuple[Bar, ...]]] = {}
    funding: dict[str, tuple[Funding, ...]] = {}
    if set(development.bars) != set(holdout.bars):
        raise DataValidationError("PHASE_SYMBOLS_DIFFER", "development versus holdout")
    for symbol in sorted(development.bars):
        bars[symbol] = {}
        for kind in ("spotKlines", "perpetualKlines", "markPriceKlines"):
            joined = development.bars[symbol][kind] + holdout.bars[symbol][kind]
            validate_complete_grid(
                joined, development.start_ms, holdout.end_ms, f"{symbol}/{kind}/sample"
            )
            bars[symbol][kind] = joined
        funding[symbol] = development.funding[symbol] + holdout.funding[symbol]
        if len({row.ts_ms for row in funding[symbol]}) != len(funding[symbol]):
            raise DataValidationError("SAMPLE_FUNDING_DUPLICATE", symbol)
        validate_funding_coverage(
            funding[symbol],
            development.start_ms,
            holdout.end_ms,
            f"{symbol}/sample",
        )
    return PhaseData("sample", development.start_ms, holdout.end_ms, bars, funding)


def build_calibration_points(
    spot: Sequence[Bar], perpetual: Sequence[Bar]
) -> tuple[CalibrationPoint | None, ...]:
    if len(spot) != len(perpetual):
        raise DataValidationError(
            "CALIBRATION_SERIES_LENGTH_MISMATCH", f"{len(spot)} != {len(perpetual)}"
        )
    if tuple(bar.ts_ms for bar in spot) != tuple(bar.ts_ms for bar in perpetual):
        raise DataValidationError("CALIBRATION_CLOCK_MISMATCH", "spot versus perpetual")
    raw_basis = [
        TEN_THOUSAND * deterministic_ln(perp.close / cash.close)
        for cash, perp in zip(spot, perpetual, strict=False)
    ]
    spot_log_volume = [deterministic_log1p(bar.quote_volume) for bar in spot]
    perpetual_log_volume = [deterministic_log1p(bar.quote_volume) for bar in perpetual]
    points: list[CalibrationPoint | None] = [None] * len(spot)
    total_days = len(spot) // DAY_BARS
    if len(spot) % DAY_BARS:
        raise DataValidationError("CALIBRATION_NOT_COMPLETE_DAYS", f"{len(spot)} bars")
    for day_index in range(HISTORY_DAYS, total_days):
        day_start = day_index * DAY_BARS
        history_start = day_start - HISTORY_BARS
        basis_location, basis_scale = robust_location_scale(
            raw_basis[history_start:day_start], Decimal("1")
        )
        spot_slots: list[tuple[Decimal, Decimal]] = []
        perpetual_slots: list[tuple[Decimal, Decimal]] = []
        for slot in range(DAY_BARS):
            spot_values = [
                spot_log_volume[(prior_day * DAY_BARS) + slot]
                for prior_day in range(day_index - HISTORY_DAYS, day_index)
            ]
            perpetual_values = [
                perpetual_log_volume[(prior_day * DAY_BARS) + slot]
                for prior_day in range(day_index - HISTORY_DAYS, day_index)
            ]
            spot_slots.append(robust_location_scale(spot_values, Decimal("0.05")))
            perpetual_slots.append(robust_location_scale(perpetual_values, Decimal("0.05")))
        for slot in range(DAY_BARS):
            index = day_start + slot
            spot_location, spot_scale = spot_slots[slot]
            perpetual_location, perpetual_scale = perpetual_slots[slot]
            spot_z = (spot_log_volume[index] - spot_location) / spot_scale
            perpetual_z = (perpetual_log_volume[index] - perpetual_location) / perpetual_scale
            basis_z = (raw_basis[index] - basis_location) / basis_scale
            points[index] = CalibrationPoint(
                ts_ms=spot[index].ts_ms,
                raw_basis_bps=raw_basis[index],
                basis_location=basis_location,
                basis_scale=basis_scale,
                basis_z=basis_z,
                spot_volume_location=spot_location,
                spot_volume_scale=spot_scale,
                perpetual_volume_location=perpetual_location,
                perpetual_volume_scale=perpetual_scale,
                relative_volume_intensity_z=perpetual_z - spot_z,
            )
    return tuple(points)


def trials_from_protocol(protocol: Mapping[str, Any]) -> tuple[Trial, ...]:
    trials: list[Trial] = []
    for volume in protocol["trials"]["relativeVolumeIntensityThresholdZ"]:
        for basis in protocol["trials"]["basisThresholdZ"]:
            trials.append(
                Trial(
                    trial_id=f"RV{Decimal(volume):.1f}_B{Decimal(basis):.1f}",
                    volume_threshold=Decimal(volume),
                    basis_threshold=Decimal(basis),
                )
            )
    trials.sort(key=lambda item: item.trial_id)
    if len(trials) != protocol["trials"]["familySize"]:
        raise ContractError("TRIAL_FAMILY_SIZE_INVALID", str(len(trials)))
    return tuple(trials)


def funding_cashflows(
    symbol: str,
    entry_ts_ms: int,
    exit_ts_ms: int,
    quantity: Decimal,
    funding: Mapping[str, Sequence[Funding]],
    marks: Mapping[str, Sequence[Bar]],
) -> tuple[Decimal, Decimal]:
    mark_by_time = {bar.ts_ms: bar.open for bar in marks[symbol]}
    debit = ZERO
    discarded_credit = ZERO
    for settlement in funding[symbol]:
        if entry_ts_ms <= settlement.ts_ms < exit_ts_ms:
            if settlement.ts_ms not in mark_by_time:
                raise DataValidationError(
                    "FUNDING_MARK_OPEN_MISSING",
                    f"{symbol}: {settlement.ts_ms}",
                )
            cashflow = quantity * mark_by_time[settlement.ts_ms] * settlement.rate
            if cashflow < ZERO:
                debit += -cashflow
            elif cashflow > ZERO:
                discarded_credit += cashflow
    return debit, discarded_credit


def capacity_fill_pass(
    actual_fill_notional: Decimal,
    participation_bps: Decimal,
    prior_quote_volume: Decimal,
) -> bool:
    return actual_fill_notional <= (participation_bps / TEN_THOUSAND) * prior_quote_volume


def severe_mark_to_market_pnl(
    quantity: Decimal,
    entry_spot: Decimal,
    entry_perpetual: Decimal,
    current_spot: Decimal,
    current_perpetual: Decimal,
    cumulative_adverse_funding_debit: Decimal,
    protocol: Mapping[str, Any],
) -> Decimal:
    cost = protocol["costs"]["severe"]
    gross = quantity * ((current_spot - entry_spot) + (entry_perpetual - current_perpetual))
    spot_notional = quantity * (entry_spot + current_spot)
    perpetual_notional = quantity * (entry_perpetual + current_perpetual)
    fees = (
        spot_notional * Decimal(cost["spotFeeBpsPerFill"])
        + perpetual_notional * Decimal(cost["perpetualFeeBpsPerFill"])
    ) / TEN_THOUSAND
    adverse_execution = (
        (spot_notional + perpetual_notional)
        * Decimal(cost["adverseExecutionBpsPerFill"])
        / TEN_THOUSAND
    )
    return gross - fees - adverse_execution - cumulative_adverse_funding_debit


def build_severe_path(
    position: Position,
    exit_index: int,
    phase_data: PhaseData,
    protocol: Mapping[str, Any],
) -> tuple[SeverePathPoint, ...]:
    symbol = position.symbol
    spot = phase_data.bars[symbol]["spotKlines"]
    perpetual = phase_data.bars[symbol]["perpetualKlines"]
    mark_by_time = {bar.ts_ms: bar.open for bar in phase_data.bars[symbol]["markPriceKlines"]}
    settlements = phase_data.funding[symbol]
    entry_ts_ms = spot[position.entry_index].ts_ms
    points: list[SeverePathPoint] = []
    for index in range(position.entry_index, exit_index):
        cumulative_debit = ZERO
        close_boundary = spot[index].ts_ms + FIVE_MINUTES_MS
        for settlement in settlements:
            if entry_ts_ms <= settlement.ts_ms < close_boundary:
                cashflow = position.quantity * mark_by_time[settlement.ts_ms] * settlement.rate
                cumulative_debit += max(ZERO, -cashflow)
        current_spot = spot[index].close
        current_perpetual = perpetual[index].close
        points.append(
            SeverePathPoint(
                index=index,
                ts_ms=spot[index].ts_ms,
                spot_close=current_spot,
                perpetual_close=current_perpetual,
                cumulative_adverse_funding_debit=cumulative_debit,
                severe_pnl=severe_mark_to_market_pnl(
                    position.quantity,
                    position.entry_spot,
                    position.entry_perpetual,
                    current_spot,
                    current_perpetual,
                    cumulative_debit,
                    protocol,
                ),
            )
        )
    return tuple(points)


def build_trade(
    position: Position,
    exit_index: int,
    exit_reasons: Sequence[str],
    phase_data: PhaseData,
    protocol: Mapping[str, Any],
) -> Trade:
    symbol = position.symbol
    spot = phase_data.bars[symbol]["spotKlines"]
    perpetual = phase_data.bars[symbol]["perpetualKlines"]
    if position.entry_index <= 0 or exit_index <= position.entry_index:
        raise DataValidationError(
            "TRADE_INDEX_INVALID",
            f"{position.entry_index}->{exit_index}",
        )
    if exit_index >= len(spot):
        raise DataValidationError("TRADE_EXIT_OUTSIDE_PHASE", str(exit_index))
    exit_spot = spot[exit_index].open
    exit_perpetual = perpetual[exit_index].open
    entry_ts = spot[position.entry_index].ts_ms
    exit_ts = spot[exit_index].ts_ms
    adverse_funding, discarded_credit = funding_cashflows(
        symbol,
        entry_ts,
        exit_ts,
        position.quantity,
        phase_data.funding,
        {item: phase_data.bars[item]["markPriceKlines"] for item in phase_data.bars},
    )
    gross = position.quantity * (
        (exit_spot - position.entry_spot) + (position.entry_perpetual - exit_perpetual)
    )
    spot_fill_notional = position.quantity * (position.entry_spot + exit_spot)
    perpetual_fill_notional = position.quantity * (position.entry_perpetual + exit_perpetual)
    net_by_cost: dict[str, Decimal] = {}
    for cost_name in ("base", "stress", "severe"):
        cost = protocol["costs"][cost_name]
        fees = (
            spot_fill_notional * Decimal(cost["spotFeeBpsPerFill"])
            + perpetual_fill_notional * Decimal(cost["perpetualFeeBpsPerFill"])
        ) / TEN_THOUSAND
        adverse_execution = (
            (spot_fill_notional + perpetual_fill_notional)
            * Decimal(cost["adverseExecutionBpsPerFill"])
            / TEN_THOUSAND
        )
        net_by_cost[cost_name] = gross - fees - adverse_execution - adverse_funding
    prior_entry = position.entry_index - 1
    prior_exit = exit_index - 1
    base_participation = Decimal(protocol["capacity"]["baseParticipationBps"])
    stress_participation = Decimal(protocol["capacity"]["stressParticipationBps"])
    capacity_fills = (
        CapacityFill(
            "entrySpot",
            position.quantity * position.entry_spot,
            spot[prior_entry].quote_volume,
        ),
        CapacityFill(
            "entryPerpetual",
            position.quantity * position.entry_perpetual,
            perpetual[prior_entry].quote_volume,
        ),
        CapacityFill(
            "exitSpot",
            position.quantity * exit_spot,
            spot[prior_exit].quote_volume,
        ),
        CapacityFill(
            "exitPerpetual",
            position.quantity * exit_perpetual,
            perpetual[prior_exit].quote_volume,
        ),
    )
    capacity_base = all(
        capacity_fill_pass(
            fill.actual_fill_notional,
            base_participation,
            fill.prior_quote_volume,
        )
        for fill in capacity_fills
    )
    capacity_stress = all(
        capacity_fill_pass(
            fill.actual_fill_notional,
            stress_participation,
            fill.prior_quote_volume,
        )
        for fill in capacity_fills
    )
    severe_path = build_severe_path(position, exit_index, phase_data, protocol)
    if not severe_path or severe_path[-1].cumulative_adverse_funding_debit != adverse_funding:
        raise DataValidationError(
            "SEVERE_PATH_FUNDING_TERMINAL_MISMATCH",
            f"{symbol}: {position.entry_index}->{exit_index}",
        )
    return Trade(
        symbol=symbol,
        source_arm_index=position.source_arm_index,
        entry_index=position.entry_index,
        exit_index=exit_index,
        entry_ts_ms=entry_ts,
        exit_ts_ms=exit_ts,
        quantity=position.quantity,
        entry_spot=position.entry_spot,
        entry_perpetual=position.entry_perpetual,
        exit_spot=exit_spot,
        exit_perpetual=exit_perpetual,
        exit_reasons=tuple(exit_reasons),
        gross_pnl=gross,
        adverse_funding_debit=adverse_funding,
        discarded_favorable_funding_credit=discarded_credit,
        net_by_cost=net_by_cost,
        capacity_fills=capacity_fills,
        severe_path=severe_path,
        capacity_base_pass=capacity_base,
        capacity_stress_pass=capacity_stress,
    )


def severe_trade_path(trade: Trade) -> tuple[Decimal, ...]:
    return (
        *(point.severe_pnl for point in trade.severe_path),
        trade.net_by_cost["severe"],
    )


def severe_equity_curve_usd(
    trades: Sequence[Trade],
    protocol: Mapping[str, Any],
) -> tuple[Decimal, ...]:
    capital = Decimal(protocol["trials"]["portfolioCapitalUsd"])
    realized = ZERO
    curve = [capital]
    for trade in sorted(trades, key=lambda item: item.entry_index):
        for path_pnl in severe_trade_path(trade):
            curve.append(capital + realized + path_pnl)
        realized += trade.net_by_cost["severe"]
    return tuple(curve)


def maximum_drawdown_pct_from_equity(equity_curve: Sequence[Decimal]) -> Decimal:
    if not equity_curve:
        raise ContractError("SEVERE_EQUITY_CURVE_EMPTY", "no observations")
    peak = equity_curve[0]
    maximum = ZERO
    for equity in equity_curve:
        peak = max(peak, equity)
        if peak > ZERO:
            maximum = max(maximum, (peak - equity) / peak * Decimal(100))
    return maximum


def simulate_trial(
    trial: Trial,
    phase_data: PhaseData,
    points: Mapping[str, Sequence[CalibrationPoint | None]],
    protocol: Mapping[str, Any],
    start_index: int = 0,
    end_index: int | None = None,
    phase_label: str | None = None,
) -> SimulationResult:
    """Run one trial with the exact frozen close/open and same-bar priority law."""

    end = phase_data.length if end_index is None else end_index
    if start_index < 0 or end > phase_data.length or start_index >= end:
        raise ContractError("SIMULATION_RANGE_INVALID", f"{start_index}..{end}")
    symbols = tuple(sorted(phase_data.bars))
    for symbol in symbols:
        if len(points[symbol]) != phase_data.length:
            raise ContractError(
                "POINT_SERIES_LENGTH_INVALID",
                f"{symbol}: {len(points[symbol])} != {phase_data.length}",
            )
    offset = int(
        protocol["calendar"]["holdout" if phase_label == "holdout" else "development"][
            "worstCaseExitOpenIndexOffsetFromVolumeEvent"
        ]
    )
    maximum_hold = int(protocol["trials"]["maximumHoldBars"])
    arms: dict[str, Arm] = {}
    blocked: set[str] = set()
    position: Position | None = None
    pending_entry: Arm | None = None
    pending_entry_z: Decimal | None = None
    pending_exit_reasons: tuple[str, ...] | None = None
    trades: list[Trade] = []

    for index in range(start_index, end):
        # Open-index fills scheduled after the preceding closed bar.
        if pending_exit_reasons is not None:
            if position is None:
                raise DataValidationError("EXIT_WITHOUT_POSITION", f"{trial.trial_id}@{index}")
            trades.append(
                build_trade(
                    position,
                    index,
                    pending_exit_reasons,
                    phase_data,
                    protocol,
                )
            )
            blocked.add(position.symbol)
            position = None
            pending_exit_reasons = None
        if pending_entry is not None:
            if position is not None:
                raise DataValidationError("ENTRY_WHILE_POSITION_OPEN", f"{trial.trial_id}@{index}")
            symbol = pending_entry.symbol
            spot_open = phase_data.bars[symbol]["spotKlines"][index].open
            perpetual_open = phase_data.bars[symbol]["perpetualKlines"][index].open
            quantity = Decimal(protocol["trials"]["legNotionalUsd"]) / spot_open
            if pending_entry_z is None:
                raise DataValidationError("ENTRY_Z_MISSING", trial.trial_id)
            position = Position(
                symbol=symbol,
                entry_index=index,
                entry_spot=spot_open,
                entry_perpetual=perpetual_open,
                quantity=quantity,
                entry_basis_z=pending_entry_z,
                basis_location=pending_entry.basis_location,
                basis_scale=pending_entry.basis_scale,
                source_arm_index=pending_entry.event_index,
            )
            pending_entry = None
            pending_entry_z = None

        # A completed rearm condition is observed before future upward crosses.
        for symbol in symbols:
            point = points[symbol][index]
            if (
                symbol in blocked
                and symbol not in arms
                and (position is None or position.symbol != symbol)
                and point is not None
                and point.basis_z <= Decimal("0.5")
                and point.relative_volume_intensity_z < ONE
            ):
                blocked.remove(symbol)

        # 1. Existing position exit evaluation has first close-time priority.
        if position is not None:
            point = points[position.symbol][index]
            reasons: list[str] = []
            if point is None:
                reasons.append("DATA_INVALID")
            else:
                frozen_basis_z = (
                    point.raw_basis_bps - position.basis_location
                ) / position.basis_scale
                if frozen_basis_z <= Decimal("0.5"):
                    reasons.append("BASIS_REVERTED")
                if frozen_basis_z >= position.entry_basis_z + Decimal("1.5"):
                    reasons.append("BASIS_WORSENED")
            if index == position.entry_index + maximum_hold - 1:
                reasons.append("MAXIMUM_HOLD")
            if reasons:
                if index + 1 >= end:
                    raise DataValidationError(
                        "EXIT_FILL_OUTSIDE_PHASE",
                        f"{trial.trial_id}@{index + 1}",
                    )
                pending_exit_reasons = tuple(reasons)
            continue

        # 2. Existing arms evaluate under their captured calibration.
        basis_candidates: list[tuple[int, Decimal, str, Arm, Decimal]] = []
        for symbol in symbols:
            arm = arms.get(symbol)
            if arm is None:
                continue
            distance = index - arm.event_index
            if 1 <= distance <= 6:
                current = points[symbol][index]
                previous = points[symbol][index - 1]
                if current is None or previous is None:
                    raise DataValidationError(
                        "ARM_POINT_INVALID", f"{trial.trial_id}/{symbol}@{index}"
                    )
                previous_z = (previous.raw_basis_bps - arm.basis_location) / arm.basis_scale
                current_z = (current.raw_basis_bps - arm.basis_location) / arm.basis_scale
                if (
                    previous_z < trial.basis_threshold
                    and current_z >= trial.basis_threshold
                    and current.raw_basis_bps > ZERO
                ):
                    excess = current_z - trial.basis_threshold
                    basis_candidates.append((arm.event_index, -excess, symbol, arm, current_z))
        if basis_candidates:
            basis_candidates.sort(key=lambda item: (item[0], item[1], item[2]))
            _, _, _winner_symbol, winner_arm, winner_z = basis_candidates[0]
            pending_entry = winner_arm
            pending_entry_z = winner_z
            for symbol in tuple(arms):
                blocked.add(symbol)
            arms.clear()
            if index + 1 >= end:
                raise DataValidationError(
                    "ENTRY_FILL_OUTSIDE_PHASE", f"{trial.trial_id}@{index + 1}"
                )
            continue

        # Expiry is processed after bar event+6 had its final basis opportunity.
        for symbol, arm in tuple(arms.items()):
            if index == arm.event_index + 6:
                del arms[symbol]
                blocked.add(symbol)

        # 3. New events only when neither a position nor scheduled entry exists.
        for symbol in symbols:
            if symbol in arms or symbol in blocked:
                continue
            if index <= start_index or index + offset >= end:
                continue
            current = points[symbol][index]
            previous = points[symbol][index - 1]
            if current is None or previous is None:
                continue
            if (
                previous.relative_volume_intensity_z < trial.volume_threshold
                and current.relative_volume_intensity_z >= trial.volume_threshold
                and abs(current.basis_z) < ONE
            ):
                arms[symbol] = Arm(
                    symbol=symbol,
                    event_index=index,
                    basis_location=current.basis_location,
                    basis_scale=current.basis_scale,
                    spot_volume_location=current.spot_volume_location,
                    spot_volume_scale=current.spot_volume_scale,
                    perpetual_volume_location=current.perpetual_volume_location,
                    perpetual_volume_scale=current.perpetual_volume_scale,
                )

    if position is not None or pending_entry is not None or pending_exit_reasons:
        raise DataValidationError(
            "CROSS_BOUNDARY_POSITION",
            f"{trial.trial_id}/{phase_label or phase_data.phase}",
        )
    dates = tuple(
        utc_day(phase_data.bars[symbols[0]]["spotKlines"][index].ts_ms)
        for index in range(start_index, end, DAY_BARS)
    )
    daily: dict[str, list[Decimal]] = {
        name: [ZERO for _ in dates] for name in ("base", "stress", "severe")
    }
    date_index = {value: index for index, value in enumerate(dates)}
    for trade in trades:
        key = utc_day(trade.exit_ts_ms)
        if key not in date_index:
            raise DataValidationError("TRADE_EXIT_DAY_OUTSIDE_PHASE", key)
        for name in daily:
            daily[name][date_index[key]] += trade.net_by_cost[name]
    severe_equity = severe_equity_curve_usd(trades, protocol)
    return SimulationResult(
        trial=trial,
        phase=phase_label or phase_data.phase,
        trades=tuple(trades),
        daily_net_by_cost={name: tuple(values) for name, values in daily.items()},
        daily_dates=dates,
        severe_equity_curve_usd=severe_equity,
        maximum_severe_drawdown_pct=maximum_drawdown_pct_from_equity(severe_equity),
    )


def percentile(values: Sequence[Decimal], probability: Decimal) -> Decimal:
    if not values:
        raise ContractError("PERCENTILE_EMPTY", dstr(probability))
    ordered = sorted(values)
    rank = int((probability * Decimal(len(ordered))).to_integral_value(rounding=ROUND_CEILING))
    index = min(max(rank - 1, 0), len(ordered) - 1)
    return ordered[index]


def synchronous_bootstrap(
    results: Sequence[SimulationResult],
    protocol: Mapping[str, Any],
) -> dict[str, Any]:
    if not results:
        raise ContractError("BOOTSTRAP_RESULTS_EMPTY", "no trials")
    dates = results[0].daily_dates
    if any(result.daily_dates != dates for result in results):
        raise ContractError("DAILY_MATRIX_NOT_SYNCHRONOUS", "date mismatch")
    capital = Decimal(protocol["trials"]["portfolioCapitalUsd"])
    matrix = [
        tuple(value / capital for value in result.daily_net_by_cost["stress"]) for result in results
    ]
    count = len(dates)
    replicates = int(protocol["statistics"]["bootstrap"]["replicates"])
    block = int(protocol["statistics"]["bootstrap"]["blockLengthDays"])
    seed = int(protocol["statistics"]["bootstrap"]["seed"])
    generator = random.Random(seed)
    observed = [sum(row, ZERO) / Decimal(count) for row in matrix]
    boot_means: list[list[Decimal]] = [[] for _ in results]
    centered_maxima: list[Decimal] = []
    for _ in range(replicates):
        indices: list[int] = []
        while len(indices) < count:
            start = generator.randrange(count)
            indices.extend((start + offset) % count for offset in range(block))
        indices = indices[:count]
        replicate_means: list[Decimal] = []
        for trial_index, row in enumerate(matrix):
            mean = sum((row[index] for index in indices), ZERO) / Decimal(count)
            boot_means[trial_index].append(mean)
            replicate_means.append(mean)
        centered_maxima.append(
            max(replicate_means[index] - observed[index] for index in range(len(results)))
        )
    alpha = Decimal(protocol["statistics"]["bootstrap"]["oneSidedAlpha"])
    upper_probability = ONE - alpha
    lower_bounds: dict[str, Decimal] = {}
    p_values: dict[str, Decimal] = {}
    for index, result in enumerate(results):
        lower_bounds[result.trial.trial_id] = Decimal(2) * observed[index] - percentile(
            boot_means[index], upper_probability
        )
        exceed = sum(1 for value in boot_means[index] if value - observed[index] >= observed[index])
        p_values[result.trial.trial_id] = Decimal(exceed + 1) / Decimal(replicates + 1)
    ordered_p = sorted(p_values.items(), key=lambda item: (item[1], item[0]))
    family_alpha = Decimal(protocol["statistics"]["multiplicity"]["holmFwer"])
    holm: dict[str, bool] = {}
    still_passing = True
    family_size = len(ordered_p)
    for rank, (trial_id, p_value) in enumerate(ordered_p):
        threshold = family_alpha / Decimal(family_size - rank)
        current_pass = still_passing and p_value <= threshold
        holm[trial_id] = current_pass
        if not current_pass:
            still_passing = False
    observed_best = max(observed)
    max_exceed = sum(1 for value in centered_maxima if value >= observed_best)
    reality_p = Decimal(max_exceed + 1) / Decimal(replicates + 1)
    reality_pass = reality_p <= Decimal(
        protocol["statistics"]["multiplicity"]["synchronousMaxRealityCheckAlpha"]
    )
    return {
        "lowerBounds": lower_bounds,
        "pValues": p_values,
        "holmPass": holm,
        "maxRealityCheckPValue": reality_p,
        "maxRealityCheckPass": reality_pass,
    }


def calculate_pbo(results: Sequence[SimulationResult], protocol: Mapping[str, Any]) -> Decimal:
    if not results:
        raise ContractError("PBO_RESULTS_EMPTY", "no trials")
    count = len(results[0].daily_dates)
    if any(len(item.daily_dates) != count for item in results):
        raise ContractError("PBO_MATRIX_NOT_SYNCHRONOUS", "date count")
    block_count = int(protocol["statistics"]["pbo"]["developmentBlocks"])
    in_sample_blocks = int(protocol["statistics"]["pbo"]["inSampleBlocks"])
    if count < block_count:
        raise ContractError("PBO_TOO_FEW_DAYS", str(count))
    boundaries = [
        (block * count // block_count, (block + 1) * count // block_count)
        for block in range(block_count)
    ]
    underperform = 0
    splits = 0
    for chosen in itertools.combinations(range(block_count), in_sample_blocks):
        chosen_set = set(chosen)
        in_indices = [
            index
            for block, (start, end) in enumerate(boundaries)
            if block in chosen_set
            for index in range(start, end)
        ]
        out_indices = [
            index
            for block, (start, end) in enumerate(boundaries)
            if block not in chosen_set
            for index in range(start, end)
        ]
        in_scores: list[tuple[Decimal, str, int]] = []
        out_scores: list[Decimal] = []
        for trial_index, result in enumerate(results):
            row = result.daily_net_by_cost["stress"]
            in_score = sum((row[index] for index in in_indices), ZERO)
            out_score = sum((row[index] for index in out_indices), ZERO)
            in_scores.append((-in_score, result.trial.trial_id, trial_index))
            out_scores.append(out_score)
        in_scores.sort()
        selected_index = in_scores[0][2]
        cross_median = median_decimal(out_scores)
        if out_scores[selected_index] <= cross_median:
            underperform += 1
        splits += 1
    expected_splits = int(protocol["statistics"]["pbo"]["splits"])
    if splits != expected_splits:
        raise ContractError("PBO_SPLIT_COUNT_INVALID", f"{splits} != {expected_splits}")
    return Decimal(underperform) / Decimal(splits)


def cost_total(result: SimulationResult, cost: str) -> Decimal:
    return sum((trade.net_by_cost[cost] for trade in result.trades), ZERO)


def grouped_stress(result: SimulationResult, group: str) -> dict[str, Decimal]:
    grouped: dict[str, Decimal] = {}
    for trade in result.trades:
        if group == "symbol":
            key = trade.symbol
        elif group == "month":
            key = utc_month(trade.exit_ts_ms)
        elif group == "quarter":
            key = utc_quarter(trade.exit_ts_ms)
        else:
            raise ContractError("GROUP_INVALID", group)
        grouped[key] = grouped.get(key, ZERO) + trade.net_by_cost["stress"]
    return grouped


def bootstrap_single_lower_bound(result: SimulationResult, protocol: Mapping[str, Any]) -> Decimal:
    family = synchronous_bootstrap((result,), protocol)
    return cast(Decimal, family["lowerBounds"][result.trial.trial_id])


def development_gate(
    result: SimulationResult,
    fold_stress_totals: Sequence[Decimal],
    family_stats: Mapping[str, Any],
    pbo: Decimal,
    protocol: Mapping[str, Any],
) -> dict[str, Any]:
    trial_id = result.trial.trial_id
    per_asset = grouped_stress(result, "symbol")
    quarters = grouped_stress(result, "quarter")
    stress_total = cost_total(result, "stress")
    remove_best = stress_total - max(quarters.values(), default=ZERO)
    checks = {
        "minimumDevelopmentRoundTrips": len(result.trades)
        >= int(protocol["gates"]["minimumDevelopmentRoundTrips"]),
        "minimumRoundTripsPerAsset": all(
            sum(1 for trade in result.trades if trade.symbol == symbol)
            >= int(protocol["gates"]["minimumRoundTripsPerAsset"])
            for symbol in protocol["data"]["symbols"]
        ),
        "minimumActiveCalendarQuarters": len(quarters)
        >= int(protocol["gates"]["minimumActiveCalendarQuarters"]),
        "baseStressSevereNetPositive": all(
            cost_total(result, name) > ZERO for name in ("base", "stress", "severe")
        ),
        "stressWalkForwardNetPositiveEachFold": bool(fold_stress_totals)
        and all(value > ZERO for value in fold_stress_totals),
        "stressLowerBoundPositive": family_stats["lowerBounds"][trial_id] > ZERO,
        "holmPass": bool(family_stats["holmPass"][trial_id]),
        "maxRealityCheckPass": bool(family_stats["maxRealityCheckPass"]),
        "capacityProxyPass": bool(result.trades)
        and all(trade.capacity_stress_pass for trade in result.trades),
        "bothAssetsStressPositive": all(
            per_asset.get(symbol, ZERO) > ZERO for symbol in protocol["data"]["symbols"]
        ),
        "removeBestQuarterStressPositive": remove_best > ZERO,
        "maximumLiquidationDrawdownPct": result.maximum_severe_drawdown_pct
        <= Decimal(protocol["gates"]["maximumLiquidationDrawdownPct"]),
        "maximumPbo": pbo <= Decimal(protocol["gates"]["maximumPbo"]),
    }
    return {
        "pass": all(checks.values()),
        "checks": checks,
        "foldStressNetUsd": [dstr(value) for value in fold_stress_totals],
        "removeBestQuarterStressNetUsd": dstr(remove_best),
    }


def holdout_gate(
    result: SimulationResult, lower_bound: Decimal, protocol: Mapping[str, Any]
) -> dict[str, Any]:
    gate = protocol["gates"]["holdout"]
    per_asset = grouped_stress(result, "symbol")
    months = grouped_stress(result, "month")
    stress_total = cost_total(result, "stress")
    remove_best = stress_total - max(months.values(), default=ZERO)
    checks = {
        "minimumRoundTrips": len(result.trades) >= int(gate["minimumRoundTrips"]),
        "minimumRoundTripsPerAsset": all(
            sum(1 for trade in result.trades if trade.symbol == symbol)
            >= int(gate["minimumRoundTripsPerAsset"])
            for symbol in protocol["data"]["symbols"]
        ),
        "minimumActiveCalendarMonths": len(months) >= int(gate["minimumActiveCalendarMonths"]),
        "baseStressSevereNetPositive": all(
            cost_total(result, name) > ZERO for name in ("base", "stress", "severe")
        ),
        "stressLowerBoundPositive": lower_bound > ZERO,
        "capacityProxyPass": bool(result.trades)
        and all(trade.capacity_stress_pass for trade in result.trades),
        "bothAssetsStressPositive": all(
            per_asset.get(symbol, ZERO) > ZERO for symbol in protocol["data"]["symbols"]
        ),
        "removeBestMonthStressPositive": remove_best > ZERO,
        "maximumLiquidationDrawdownPct": result.maximum_severe_drawdown_pct
        <= Decimal(gate["maximumLiquidationDrawdownPct"]),
    }
    return {
        "pass": all(checks.values()),
        "checks": checks,
        "removeBestMonthStressNetUsd": dstr(remove_best),
        "multiplicity": gate["multiplicity"],
    }


def trade_document(trade: Trade) -> dict[str, Any]:
    return {
        "symbol": trade.symbol,
        "sourceArmIndex": trade.source_arm_index,
        "entryIndex": trade.entry_index,
        "exitIndex": trade.exit_index,
        "entryTimeMs": trade.entry_ts_ms,
        "exitTimeMs": trade.exit_ts_ms,
        "quantity": dstr(trade.quantity),
        "entrySpot": dstr(trade.entry_spot),
        "entryPerpetual": dstr(trade.entry_perpetual),
        "exitSpot": dstr(trade.exit_spot),
        "exitPerpetual": dstr(trade.exit_perpetual),
        "exitReasons": list(trade.exit_reasons),
        "grossPnlUsd": dstr(trade.gross_pnl),
        "adverseFundingDebitUsd": dstr(trade.adverse_funding_debit),
        "discardedFavorableFundingCreditUsd": dstr(trade.discarded_favorable_funding_credit),
        "netUsd": {name: dstr(value) for name, value in sorted(trade.net_by_cost.items())},
        "severeMarkToMarketPath": [
            {
                "index": point.index,
                "timeMs": point.ts_ms,
                "spotClose": dstr(point.spot_close),
                "perpetualClose": dstr(point.perpetual_close),
                "cumulativeAdverseFundingDebitUsd": dstr(point.cumulative_adverse_funding_debit),
                "severePnlUsd": dstr(point.severe_pnl),
            }
            for point in trade.severe_path
        ],
        "capacityProxy": {
            "basePass": trade.capacity_base_pass,
            "stressPass": trade.capacity_stress_pass,
            "usesImmediatelyPriorClosedBar": True,
            "fills": [
                {
                    "fill": fill.fill_id,
                    "actualFillNotionalUsd": dstr(fill.actual_fill_notional),
                    "priorSameLegQuoteVolumeUsd": dstr(fill.prior_quote_volume),
                }
                for fill in trade.capacity_fills
            ],
        },
    }


def simulation_document(result: SimulationResult) -> dict[str, Any]:
    return {
        "trialId": result.trial.trial_id,
        "relativeVolumeIntensityThresholdZ": dstr(result.trial.volume_threshold),
        "basisThresholdZ": dstr(result.trial.basis_threshold),
        "phase": result.phase,
        "roundTrips": len(result.trades),
        "roundTripsByAsset": {
            symbol: sum(1 for trade in result.trades if trade.symbol == symbol)
            for symbol in ("BTCUSDT", "ETHUSDT")
        },
        "netUsd": {name: dstr(cost_total(result, name)) for name in ("base", "stress", "severe")},
        "maximumSevereMarkToMarketDrawdownPct": dstr(result.maximum_severe_drawdown_pct),
        "dailyDates": list(result.daily_dates),
        "dailyNetUsd": {
            name: [dstr(value) for value in result.daily_net_by_cost[name]]
            for name in ("base", "stress", "severe")
        },
        "severeEquityCurveUsd": [dstr(value) for value in result.severe_equity_curve_usd],
        "trades": [trade_document(trade) for trade in result.trades],
    }


def family_stats_document(stats: Mapping[str, Any], pbo: Decimal) -> dict[str, Any]:
    return {
        "stressDailyBlockLowerBoundMeanReturn": {
            key: dstr(value) for key, value in sorted(stats["lowerBounds"].items())
        },
        "oneSidedPValues": {key: dstr(value) for key, value in sorted(stats["pValues"].items())},
        "holmPass": dict(sorted(stats["holmPass"].items())),
        "synchronousMaxRealityCheckPValue": dstr(stats["maxRealityCheckPValue"]),
        "synchronousMaxRealityCheckPass": stats["maxRealityCheckPass"],
        "pbo": dstr(pbo),
    }


def validate_vg9_distinctness(vg9_protocol: Any) -> str:
    if not isinstance(vg9_protocol, dict):
        raise ContractError("VG9_PROTOCOL_INVALID", "root must be an object")
    if vg9_protocol.get("schema") != "VG9SpotUsdMVolumeShareLeadershipProtocolV1":
        raise ContractError("VG9_SCHEMA_UNEXPECTED", repr(vg9_protocol.get("schema")))
    distinctness = vg9_protocol.get("distinctness")
    if not isinstance(distinctness, dict):
        raise ContractError("VG9_DISTINCTNESS_MISSING", "distinctness object")
    collision = vg9_collision_status(vg9_protocol)
    if collision == "COLLISION_STOP_UNMEASURED":
        return collision
    forbidden = distinctness.get("forbiddenSignalInputs")
    if not isinstance(forbidden, list) or "BASIS" not in forbidden:
        raise ContractError(
            "VG9_BASIS_FORBIDDANCE_NOT_PROVEN",
            "forbiddenSignalInputs must include BASIS",
        )
    not_s1p = distinctness.get("notS1P")
    required = (
        "NO_OWN_SYMBOL_TEMPORAL_SEQUENCE",
        "NO_BASIS_EVENT",
        "NO_PAIRED_TRADE",
    )
    if not isinstance(not_s1p, str) or any(token not in not_s1p for token in required):
        raise ContractError(
            "VG9_NOT_S1P_PROOF_INCOMPLETE",
            "notS1P must exclude own-symbol sequence, basis event, and paired trade",
        )
    return "DISTINCT_CLEAR_TO_EVALUATE"


def assert_state_root_safe(state_dir: Path, protocol: Mapping[str, Any]) -> Path:
    resolved = state_dir.resolve()
    shared_discovery = Path(protocol["data"]["sharedDiscoveryPath"]).resolve()
    shared_root = Path(protocol["data"]["sharedArchiveRoot"]).resolve()
    forbidden_roots = (shared_discovery.parent, shared_root)
    for root in forbidden_roots:
        if resolved == root or root in resolved.parents:
            raise ContractError(
                "STATE_ROOT_OVERLAPS_SHARED_READ_ONLY_DATA",
                f"{resolved} overlaps {root}",
            )
    return resolved


def expected_archive_bindings(
    indexed: Mapping[tuple[str, str, str], Mapping[str, Any]],
    archive_root: Path,
) -> list[dict[str, Any]]:
    root = archive_root.resolve()
    bindings: list[dict[str, Any]] = []
    for key in sorted(indexed):
        row = indexed[key]
        digest = row["sha256"]
        path = (root / f"{digest}.zip").resolve()
        if path.parent != root:
            raise DataValidationError("ARCHIVE_PATH_ESCAPE", str(path))
        bindings.append(
            {
                "kind": key[0],
                "symbol": key[1],
                "month": key[2],
                "phase": row["phase"],
                "sourceUrl": row["url"],
                "checksumUrl": row["checksumUrl"],
                "checksumSidecarSha256": row["checksumSidecarSha256"],
                "archiveSha256": digest,
                "contentAddressedPath": str(path),
            }
        )
    return bindings


def archive_bindings(
    indexed: Mapping[tuple[str, str, str], Mapping[str, Any]],
    archive_root: Path,
) -> list[dict[str, Any]]:
    bindings = expected_archive_bindings(indexed, archive_root)
    for binding in bindings:
        path = Path(binding["contentAddressedPath"])
        digest = binding["archiveSha256"]
        try:
            actual = sha256_file(path)
        except OSError as exc:
            raise DataValidationError("ARCHIVE_READ_FAILED", f"{path}: {exc}") from exc
        if actual != digest:
            raise DataValidationError("ARCHIVE_SHA256_MISMATCH", f"{path}: {actual} != {digest}")
    return bindings


def freeze_candidate(state_dir: Path, vg9_protocol_path: Path) -> dict[str, Any]:
    protocol, _sources, hashes = load_frozen_bundle()
    state_root = assert_state_root_safe(state_dir, protocol)
    state_root.mkdir(parents=True, exist_ok=True)
    for name in LIFECYCLE_NAMES:
        if (state_root / name).exists():
            raise ContractError("NONFRESH_STATE_ROOT", f"{state_root / name} exists")
    vg9_path = vg9_protocol_path.resolve()
    vg9_protocol, vg9_sha = load_json_with_sha256(vg9_path)
    collision_status = validate_vg9_distinctness(vg9_protocol)
    vg9_distinctness = vg9_protocol["distinctness"]
    vg9_forbidden = vg9_distinctness.get("forbiddenSignalInputs")
    vg9_not_s1p = vg9_distinctness.get("notS1P")
    discovery_path = Path(protocol["data"]["sharedDiscoveryPath"])
    discovery_sha = sha256_file(discovery_path)
    if discovery_sha != protocol["data"]["sharedDiscoverySha256"]:
        raise ContractError(
            "DISCOVERY_SHA256_MISMATCH",
            f"{discovery_sha} != {protocol['data']['sharedDiscoverySha256']}",
        )
    discovery = load_json(discovery_path)
    indexed = validate_discovery(discovery, protocol)
    bindings = archive_bindings(indexed, Path(protocol["data"]["sharedArchiveRoot"]))
    tracked_inputs = {
        **hashes,
        "discoverySha256": discovery_sha,
        "vg9ProtocolSha256AtFreeze": vg9_sha,
    }
    candidate = with_artifact_digest(
        {
            "schema": "S1PPreOutcomeFreezeCandidateV1",
            "protocolId": protocol["protocolId"],
            "frozenForDateUtc": protocol["frozenForDateUtc"],
            "trackedInputs": tracked_inputs,
            "vg9Comparison": {
                "path": str(vg9_path),
                "protocolId": vg9_protocol.get("protocolId"),
                "status": collision_status,
                "collisionDetectedBeforeDistinctProof": (
                    collision_status == "COLLISION_STOP_UNMEASURED"
                ),
                "forbiddenSignalInputsIncludesBasis": (
                    isinstance(vg9_forbidden, list) and "BASIS" in vg9_forbidden
                ),
                "notS1P": vg9_not_s1p,
            },
            "archiveBindings": bindings,
            "archiveBodiesOpened": False,
            "holdoutBodiesOpened": False,
            "accountEffectiveFees": {
                "spot": "UNKNOWN",
                "usdM": "UNKNOWN",
            },
            "capacityAuthority": "PUBLIC_PRIOR_QUOTE_VOLUME_PROXY_ONLY",
            "executableCapacity": "UNMEASURED",
            "capitalVerdict": "NO_GO",
            "executionAuthority": "NONE",
        }
    )
    exclusive_write_json(state_root / PRE_FREEZE_NAME, candidate)
    return candidate


def verify_pre_freeze(
    state_dir: Path,
    protocol: Mapping[str, Any],
    hashes: Mapping[str, str],
) -> dict[str, Any]:
    candidate = verify_artifact(
        load_json(state_dir / PRE_FREEZE_NAME),
        "S1PPreOutcomeFreezeCandidateV1",
    )
    tracked = candidate.get("trackedInputs")
    if not isinstance(tracked, dict):
        raise ContractError("FREEZE_TRACKED_INPUTS_INVALID", "not an object")
    expected = {
        **hashes,
        "discoverySha256": protocol["data"]["sharedDiscoverySha256"],
    }
    expected_keys = {*expected, "vg9ProtocolSha256AtFreeze"}
    if set(tracked) != expected_keys:
        raise ContractError(
            "FREEZE_TRACKED_INPUT_SET_INVALID",
            f"{sorted(tracked)} != {sorted(expected_keys)}",
        )
    for key, value in expected.items():
        if tracked.get(key) != value:
            raise ContractError("FREEZE_INPUT_DRIFT", f"{key}: {tracked.get(key)!r} != {value!r}")
    vg9_sha = tracked.get("vg9ProtocolSha256AtFreeze")
    if not isinstance(vg9_sha, str) or len(vg9_sha) != 64:
        raise ContractError("VG9_FREEZE_SHA_INVALID", repr(vg9_sha))
    # The compared V-G9 bytes become an immutable tracked input at freeze time.
    # Run/authentication intentionally do not follow the moving sibling path.
    bindings = candidate.get("archiveBindings")
    if not isinstance(bindings, list):
        raise ContractError("FREEZE_ARCHIVE_BINDINGS_INVALID", repr(type(bindings)))
    discovery_path = Path(protocol["data"]["sharedDiscoveryPath"])
    actual_discovery_sha = sha256_file(discovery_path)
    if actual_discovery_sha != protocol["data"]["sharedDiscoverySha256"]:
        raise ContractError(
            "DISCOVERY_SHA256_MISMATCH",
            f"{actual_discovery_sha} != {protocol['data']['sharedDiscoverySha256']}",
        )
    indexed = validate_discovery(load_json(discovery_path), protocol)
    expected_bindings = expected_archive_bindings(
        indexed,
        Path(protocol["data"]["sharedArchiveRoot"]),
    )
    if bindings != expected_bindings:
        raise ContractError(
            "FREEZE_ARCHIVE_BINDINGS_MISMATCH",
            "candidate bindings do not exactly match frozen discovery",
        )
    comparison = candidate.get("vg9Comparison")
    if not isinstance(comparison, dict):
        raise ContractError("VG9_COMPARISON_INVALID", "not an object")
    if comparison.get("status") not in (
        "DISTINCT_CLEAR_TO_EVALUATE",
        "COLLISION_STOP_UNMEASURED",
    ):
        raise ContractError("VG9_COMPARISON_STATUS_INVALID", repr(comparison.get("status")))
    if comparison["status"] == "DISTINCT_CLEAR_TO_EVALUATE":
        if comparison.get("forbiddenSignalInputsIncludesBasis") is not True:
            raise ContractError("VG9_COMPARISON_BASIS_PROOF_INVALID", repr(comparison))
        if not isinstance(comparison.get("notS1P"), str):
            raise ContractError(
                "VG9_COMPARISON_NOT_S1P_INVALID",
                repr(comparison.get("notS1P")),
            )
    elif comparison.get("collisionDetectedBeforeDistinctProof") is not True:
        raise ContractError(
            "VG9_COMPARISON_COLLISION_PROOF_INVALID",
            repr(comparison),
        )
    required_candidate = {
        "protocolId": protocol["protocolId"],
        "frozenForDateUtc": protocol["frozenForDateUtc"],
        "archiveBodiesOpened": False,
        "holdoutBodiesOpened": False,
        "accountEffectiveFees": {"spot": "UNKNOWN", "usdM": "UNKNOWN"},
        "capacityAuthority": "PUBLIC_PRIOR_QUOTE_VOLUME_PROXY_ONLY",
        "executableCapacity": "UNMEASURED",
        "capitalVerdict": "NO_GO",
        "executionAuthority": "NONE",
    }
    for key, value in required_candidate.items():
        if candidate.get(key) != value:
            raise ContractError(
                "FREEZE_TRUTH_BOUNDARY_INVALID",
                f"{key}: {candidate.get(key)!r} != {value!r}",
            )
    return candidate


def verify_committed_freeze(state_dir: Path) -> dict[str, Any]:
    external_path = state_dir / PRE_FREEZE_NAME
    if not COMMITTED_FREEZE_PATH.exists():
        raise ContractError(
            "COMMITTED_FREEZE_MISSING",
            str(COMMITTED_FREEZE_PATH),
        )
    external_sha = sha256_file(external_path)
    committed_sha = sha256_file(COMMITTED_FREEZE_PATH)
    if committed_sha != external_sha:
        raise ContractError(
            "COMMITTED_FREEZE_MISMATCH",
            f"{committed_sha} != {external_sha}",
        )
    return verify_artifact(
        load_json(COMMITTED_FREEZE_PATH),
        "S1PPreOutcomeFreezeCandidateV1",
    )


def artifact_chain(state_dir: Path, names: Iterable[str]) -> dict[str, str]:
    return {
        name: artifact_file_sha256(state_dir / name)
        for name in names
        if (state_dir / name).exists()
    }


def terminal_result_document(
    protocol: Mapping[str, Any],
    state_dir: Path,
    research_verdict: str,
    evidence_status: str,
    holdout_status: str,
    reason: Mapping[str, Any],
    extra: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    prior_names = (
        PRE_FREEZE_NAME,
        RUN_MARKER_NAME,
        DEVELOPMENT_RESULT_NAME,
        CHAMPION_SEAL_NAME,
        HOLDOUT_MARKER_NAME,
    )
    document: dict[str, Any] = {
        "schema": "S1PResultCandidateV1",
        "protocolId": protocol["protocolId"],
        "researchVerdict": research_verdict,
        "evidenceStatus": evidence_status,
        "holdoutStatus": holdout_status,
        "reason": dict(reason),
        "artifactChainFileSha256": artifact_chain(state_dir, prior_names),
        "truthBoundary": {
            "accountEffectiveSpotCommission": "UNKNOWN",
            "accountEffectiveUsdMCommission": "UNKNOWN",
            "historicalPromotionTaxAndDiscountState": "UNKNOWN",
            "frozenFees": "RESEARCH_PROXY_ONLY",
            "capacityProxy": "CAUSAL_PRIOR_COMPLETE_QUOTE_VOLUME_ONLY",
            "executableCapacity": "UNMEASURED",
            "productAuthority": "NONE",
            "capitalVerdict": "NO_GO",
            "executionAuthority": "NONE",
        },
        "postRunRepairOrRerun": "FORBIDDEN",
    }
    if extra:
        document.update(extra)
    return with_artifact_digest(document)


def write_terminal_result(
    protocol: Mapping[str, Any],
    state_dir: Path,
    research_verdict: str,
    evidence_status: str,
    holdout_status: str,
    reason: Mapping[str, Any],
    extra: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    result = terminal_result_document(
        protocol,
        state_dir,
        research_verdict,
        evidence_status,
        holdout_status,
        reason,
        extra,
    )
    exclusive_write_json(state_dir / RESULT_NAME, result)
    return result


def points_for_phase(
    phase_data: PhaseData,
) -> dict[str, tuple[CalibrationPoint | None, ...]]:
    return {
        symbol: build_calibration_points(
            phase_data.bars[symbol]["spotKlines"],
            phase_data.bars[symbol]["perpetualKlines"],
        )
        for symbol in sorted(phase_data.bars)
    }


def index_at(phase_data: PhaseData, timestamp: str) -> int:
    value = parse_utc_ms(timestamp)
    if value < phase_data.start_ms or value > phase_data.end_ms:
        raise ContractError("INDEX_TIMESTAMP_OUTSIDE_PHASE", timestamp)
    delta = value - phase_data.start_ms
    if delta % FIVE_MINUTES_MS:
        raise ContractError("INDEX_TIMESTAMP_OFF_GRID", timestamp)
    return delta // FIVE_MINUTES_MS


def validate_git_commit_anchor(value: str) -> str:
    if len(value) != 40 or any(character not in "0123456789abcdef" for character in value):
        raise ContractError("PRE_OUTCOME_GIT_ANCHOR_INVALID", repr(value))
    return value


def git_bytes(repo_root: Path, arguments: Sequence[str]) -> bytes:
    # Git exposes repository, object, ref, index, pager, and configuration
    # overrides through GIT_* variables.  Authentication must not inherit any
    # caller-controlled Git state, so construct the subprocess environment
    # from a fixed allowlist instead of trying to enumerate hostile variables.
    environment = {
        "PATH": "/usr/bin:/bin",
        "LANG": "C",
        "LC_ALL": "C",
        "GIT_ATTR_NOSYSTEM": "1",
        "GIT_CONFIG_COUNT": "0",
        "GIT_CONFIG_GLOBAL": os.devnull,
        "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_CONFIG_SYSTEM": os.devnull,
        "GIT_NO_REPLACE_OBJECTS": "1",
        "GIT_OPTIONAL_LOCKS": "0",
        "GIT_PAGER": "cat",
        "GIT_TERMINAL_PROMPT": "0",
    }
    try:
        completed = subprocess.run(
            [str(GIT_EXECUTABLE), *arguments],
            cwd=repo_root,
            env=environment,
            check=False,
            capture_output=True,
            timeout=15,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise ContractError(
            "GIT_COMMAND_FAILED",
            f"{arguments[0]}: {type(exc).__name__}",
        ) from exc
    if completed.returncode != 0:
        detail = completed.stderr.decode("utf-8", errors="replace").strip()
        raise ContractError(
            "GIT_COMMAND_FAILED",
            f"{arguments[0]}: {detail}",
        )
    return completed.stdout


def git_text(repo_root: Path, arguments: Sequence[str]) -> str:
    try:
        return git_bytes(repo_root, arguments).decode("utf-8").strip()
    except UnicodeDecodeError as exc:
        raise ContractError("GIT_OUTPUT_UTF8_INVALID", arguments[0]) from exc


def validate_pre_outcome_git_ref(value: str) -> str:
    if not value.startswith("refs/tags/s1p-pre-outcome-"):
        raise ContractError("PRE_OUTCOME_GIT_REF_INVALID", repr(value))
    if any(character not in "abcdefghijklmnopqrstuvwxyz0123456789-_/." for character in value):
        raise ContractError("PRE_OUTCOME_GIT_REF_INVALID", repr(value))
    return value


def verify_git_anchor(
    protocol: Mapping[str, Any],
    pre_freeze: Mapping[str, Any],
    state_root: Path,
    anchor: str,
    git_ref: str,
    *,
    require_current_head: bool,
) -> dict[str, Any]:
    commit = validate_git_commit_anchor(anchor)
    preserved_ref = validate_pre_outcome_git_ref(git_ref)
    expected_repo_root = HERE.parents[2].resolve()
    actual_repo_root = Path(
        git_text(expected_repo_root, ("rev-parse", "--show-toplevel"))
    ).resolve()
    if actual_repo_root != expected_repo_root:
        raise ContractError(
            "GIT_REPOSITORY_ROOT_INVALID",
            f"{actual_repo_root} != {expected_repo_root}",
        )
    origin_url = git_text(actual_repo_root, ("remote", "get-url", "origin"))
    if origin_url != EXPECTED_ORIGIN_URL:
        raise ContractError(
            "GIT_ORIGIN_URL_INVALID",
            f"{origin_url!r} != {EXPECTED_ORIGIN_URL!r}",
        )
    resolved_commit = git_text(
        actual_repo_root,
        ("rev-parse", "--verify", f"{commit}^{{commit}}"),
    )
    if resolved_commit != commit:
        raise ContractError("PRE_OUTCOME_GIT_OBJECT_INVALID", resolved_commit)
    git_text(actual_repo_root, ("check-ref-format", preserved_ref))
    resolved_ref = git_text(
        actual_repo_root,
        ("rev-parse", "--verify", f"{preserved_ref}^{{commit}}"),
    )
    if resolved_ref != commit:
        raise ContractError(
            "PRE_OUTCOME_GIT_REF_MISMATCH",
            f"{resolved_ref} != {commit}",
        )
    parents = git_text(
        actual_repo_root,
        ("rev-list", "--parents", "-n", "1", commit),
    ).split()
    canonical_base = protocol["canonicalBaseCommit"]
    if parents != [commit, canonical_base]:
        raise ContractError(
            "PRE_OUTCOME_GIT_PARENT_INVALID",
            repr(parents),
        )
    anchor_paths = set(
        git_text(
            actual_repo_root,
            ("diff-tree", "--no-commit-id", "--name-only", "-r", commit),
        ).splitlines()
    )
    expected_anchor_paths = {
        "quant/research/s1p/DISTINCTNESS.md",
        "quant/research/s1p/OFFICIAL_SOURCE_RESEARCH.md",
        "quant/research/s1p/README.md",
        "quant/research/s1p/experiment.py",
        "quant/research/s1p/freeze.v1.json",
        "quant/research/s1p/official_sources.v1.json",
        "quant/research/s1p/protocol.v1.json",
        "quant/research/s1p/test_experiment.py",
    }
    if anchor_paths != expected_anchor_paths:
        raise ContractError(
            "PRE_OUTCOME_GIT_SCOPE_INVALID",
            f"{sorted(anchor_paths)} != {sorted(expected_anchor_paths)}",
        )
    status = git_text(
        actual_repo_root,
        ("status", "--porcelain=v1", "--untracked-files=all"),
    )
    if status:
        raise ContractError("GIT_WORKTREE_NOT_CLEAN", status)
    current_head = git_text(actual_repo_root, ("rev-parse", "HEAD"))
    if require_current_head and current_head != commit:
        raise ContractError(
            "PRE_OUTCOME_GIT_ANCHOR_NOT_HEAD",
            f"{current_head} != {commit}",
        )
    if not require_current_head:
        current_parents = git_text(
            actual_repo_root,
            ("rev-list", "--parents", "-n", "1", current_head),
        ).split()
        if current_parents != [current_head, canonical_base]:
            raise ContractError("FINAL_GIT_PARENT_INVALID", repr(current_parents))
        changed_paths = set(
            git_text(
                actual_repo_root,
                ("diff-tree", "--no-commit-id", "--name-only", "-r", current_head),
            ).splitlines()
        )
        expected_final_paths = expected_anchor_paths | {
            "quant/research/s1p/SHA256SUMS",
            "quant/research/s1p/result.v1.json",
        }
        if changed_paths != expected_final_paths:
            raise ContractError(
                "FINAL_GIT_SCOPE_INVALID",
                f"{sorted(changed_paths)} != {sorted(expected_final_paths)}",
            )

    tracked = pre_freeze.get("trackedInputs")
    if not isinstance(tracked, dict):
        raise ContractError("FREEZE_TRACKED_INPUTS_INVALID", "git proof")
    tracked_files = {
        "protocol.v1.json": "protocolSha256",
        "official_sources.v1.json": "officialSourcesSha256",
        "OFFICIAL_SOURCE_RESEARCH.md": "officialSourceResearchSha256",
        "DISTINCTNESS.md": "distinctnessSha256",
        "README.md": "readmeSha256",
        "experiment.py": "implementationSha256",
        "test_experiment.py": "testSha256",
    }
    tree_bindings: dict[str, str] = {}
    for filename, tracked_key in tracked_files.items():
        relative_path = f"quant/research/s1p/{filename}"
        blob = git_bytes(
            actual_repo_root,
            ("show", f"{commit}:{relative_path}"),
        )
        digest = sha256_bytes(blob)
        if digest != tracked.get(tracked_key):
            raise ContractError(
                "PRE_OUTCOME_GIT_TREE_BINDING_MISMATCH",
                f"{filename}: {digest} != {tracked.get(tracked_key)!r}",
            )
        tree_bindings[filename] = digest
    freeze_blob = git_bytes(
        actual_repo_root,
        ("show", f"{commit}:quant/research/s1p/freeze.v1.json"),
    )
    external_freeze_sha = sha256_file(state_root / PRE_FREEZE_NAME)
    if sha256_bytes(freeze_blob) != external_freeze_sha:
        raise ContractError(
            "PRE_OUTCOME_GIT_FREEZE_MISMATCH",
            f"{sha256_bytes(freeze_blob)} != {external_freeze_sha}",
        )
    return {
        "schema": "S1PPreOutcomeGitAnchorProofV1",
        "anchorCommit": commit,
        "preservedRef": preserved_ref,
        "canonicalParent": canonical_base,
        "originUrl": origin_url,
        "anchorTreeBindings": tree_bindings,
        "committedFreezeFileSha256": external_freeze_sha,
        "worktreeClean": True,
        "anchorWasCurrentHead": current_head == commit,
        "currentHeadAtVerification": current_head,
        "networkUsed": False,
    }


def run_experiment(
    state_dir: Path,
    pre_outcome_git_anchor: str,
    pre_outcome_git_ref: str,
) -> dict[str, Any]:
    protocol, _sources, hashes = load_frozen_bundle()
    git_anchor = validate_git_commit_anchor(pre_outcome_git_anchor)
    state_root = assert_state_root_safe(state_dir, protocol)
    if (state_root / RESULT_NAME).exists():
        raise ContractError("SECOND_RUN_REFUSED", f"{state_root / RESULT_NAME} exists")
    if (state_root / RUN_MARKER_NAME).exists():
        raise ContractError("SECOND_RUN_REFUSED", f"{state_root / RUN_MARKER_NAME} exists")
    pre_freeze = verify_pre_freeze(state_root, protocol, hashes)
    committed_freeze = verify_committed_freeze(state_root)
    if committed_freeze["artifactSha256"] != pre_freeze["artifactSha256"]:
        raise ContractError(
            "COMMITTED_FREEZE_ARTIFACT_MISMATCH",
            "tracked and external freeze artifacts differ",
        )
    git_proof = verify_git_anchor(
        protocol,
        pre_freeze,
        state_root,
        git_anchor,
        pre_outcome_git_ref,
        require_current_head=True,
    )
    if pre_freeze["vg9Comparison"]["status"] != "DISTINCT_CLEAR_TO_EVALUATE":
        return write_terminal_result(
            protocol,
            state_root,
            "UNMEASURED",
            "VALID_PRE_RUN_COLLISION_STOP",
            "UNOPENED",
            {"code": "VG9_COLLISION", "detail": "archive bodies were not opened"},
            {
                "preOutcomeGitAnchor": git_anchor,
                "preOutcomeGitRef": pre_outcome_git_ref,
                "gitAnchorProof": git_proof,
            },
        )
    run_marker = with_artifact_digest(
        {
            "schema": "S1PRunConsumedV1",
            "protocolId": protocol["protocolId"],
            "preOutcomeGitAnchor": git_anchor,
            "preOutcomeGitRef": pre_outcome_git_ref,
            "gitAnchorProof": git_proof,
            "preOutcomeFreezeFileSha256": artifact_file_sha256(state_root / PRE_FREEZE_NAME),
            "committedFreezeFileSha256": sha256_file(COMMITTED_FREEZE_PATH),
            "archiveContentOpenRunOrdinal": 1,
            "developmentBodiesMayOpen": True,
            "holdoutBodiesMayOpen": False,
            "secondRunRefused": True,
        }
    )
    exclusive_write_json(state_root / RUN_MARKER_NAME, run_marker)
    try:
        discovery_path = Path(protocol["data"]["sharedDiscoveryPath"])
        try:
            actual_discovery_sha = sha256_file(discovery_path)
        except OSError as exc:
            raise DataValidationError("DISCOVERY_READ_FAILED", f"{discovery_path}: {exc}") from exc
        if actual_discovery_sha != protocol["data"]["sharedDiscoverySha256"]:
            raise DataValidationError(
                "DISCOVERY_SHA256_MISMATCH_AT_RUN",
                (f"{actual_discovery_sha} != {protocol['data']['sharedDiscoverySha256']}"),
            )
        discovery = load_json(discovery_path)
        indexed = validate_discovery(discovery, protocol)
        reader = ArchiveReader(state_root, Path(protocol["data"]["sharedArchiveRoot"]))
        development = load_phase_data(protocol, indexed, reader, "development")
        development_points = points_for_phase(development)
        trials = trials_from_protocol(protocol)
        development_results = tuple(
            simulate_trial(
                trial,
                development,
                development_points,
                protocol,
                phase_label="development",
            )
            for trial in trials
        )
        family_stats = synchronous_bootstrap(development_results, protocol)
        pbo = calculate_pbo(development_results, protocol)
        fold_totals: dict[str, list[Decimal]] = {trial.trial_id: [] for trial in trials}
        fold_documents: dict[str, list[dict[str, Any]]] = {trial.trial_id: [] for trial in trials}
        for fold_number, fold in enumerate(protocol["calendar"]["walkForward"], start=1):
            train_start = index_at(development, fold["trainStart"])
            train_end = index_at(development, fold["trainEnd"])
            start = index_at(development, fold["forwardStart"])
            end = index_at(development, fold["forwardEnd"])
            if train_start != 0 or train_end != start or start >= end:
                raise ContractError(
                    "WALK_FORWARD_GEOMETRY_INVALID",
                    f"fold {fold_number}: {train_start}/{train_end}/{start}/{end}",
                )
            for trial in trials:
                fold_result = simulate_trial(
                    trial,
                    development,
                    development_points,
                    protocol,
                    start_index=start,
                    end_index=end,
                    phase_label=f"walk_forward_{fold_number}",
                )
                fold_totals[trial.trial_id].append(cost_total(fold_result, "stress"))
                fold_documents[trial.trial_id].append(
                    {
                        "foldNumber": fold_number,
                        "trainStart": fold["trainStart"],
                        "trainEnd": fold["trainEnd"],
                        "forwardStart": fold["forwardStart"],
                        "forwardEnd": fold["forwardEnd"],
                        "simulation": simulation_document(fold_result),
                    }
                )
        gates = {
            result.trial.trial_id: development_gate(
                result,
                fold_totals[result.trial.trial_id],
                family_stats,
                pbo,
                protocol,
            )
            for result in development_results
        }
        champion = sorted(
            development_results,
            key=lambda result: (
                -family_stats["lowerBounds"][result.trial.trial_id],
                -cost_total(result, "stress"),
                result.trial.trial_id,
            ),
        )[0]
        development_document = with_artifact_digest(
            {
                "schema": "S1PDevelopmentResultV1",
                "protocolId": protocol["protocolId"],
                "runMarkerFileSha256": artifact_file_sha256(state_root / RUN_MARKER_NAME),
                "archivePhaseOpened": "DEVELOPMENT_ONLY",
                "family": [simulation_document(result) for result in development_results],
                "walkForward": fold_documents,
                "statistics": family_stats_document(family_stats, pbo),
                "gates": gates,
                "selectedChampionTrialId": champion.trial.trial_id,
                "selectionLaw": protocol["trials"]["championSelection"],
            }
        )
        exclusive_write_json(state_root / DEVELOPMENT_RESULT_NAME, development_document)
        champion_gate = gates[champion.trial.trial_id]
        if not champion_gate["pass"]:
            return write_terminal_result(
                protocol,
                state_root,
                "NO_GO",
                "VALID_MEASURED_DEVELOPMENT_GATE_FAILURE",
                "UNOPENED",
                {
                    "code": "DEVELOPMENT_CHAMPION_GATE_FAILED",
                    "detail": champion.trial.trial_id,
                },
                {
                    "developmentChampionTrialId": champion.trial.trial_id,
                    "developmentGate": champion_gate,
                },
            )
        champion_seal = with_artifact_digest(
            {
                "schema": "S1PDevelopmentChampionSealV1",
                "protocolId": protocol["protocolId"],
                "developmentResultFileSha256": artifact_file_sha256(
                    state_root / DEVELOPMENT_RESULT_NAME
                ),
                "trialId": champion.trial.trial_id,
                "relativeVolumeIntensityThresholdZ": dstr(champion.trial.volume_threshold),
                "basisThresholdZ": dstr(champion.trial.basis_threshold),
                "developmentGatePass": True,
                "holdoutBodiesOpened": False,
                "holdoutFallback": "FORBIDDEN",
            }
        )
        exclusive_write_json(state_root / CHAMPION_SEAL_NAME, champion_seal)
        holdout_marker = with_artifact_digest(
            {
                "schema": "S1PHoldoutOpenV1",
                "protocolId": protocol["protocolId"],
                "championSealFileSha256": artifact_file_sha256(state_root / CHAMPION_SEAL_NAME),
                "openOrdinal": 1,
                "championOnly": True,
                "trialId": champion.trial.trial_id,
            }
        )
        exclusive_write_json(state_root / HOLDOUT_MARKER_NAME, holdout_marker)
        holdout = load_phase_data(protocol, indexed, reader, "holdout")
        sample = concatenate_phase_data(development, holdout)
        sample_points = points_for_phase(sample)
        holdout_start = development.length
        holdout_result = simulate_trial(
            champion.trial,
            sample,
            sample_points,
            protocol,
            start_index=holdout_start,
            end_index=sample.length,
            phase_label="holdout",
        )
        holdout_lower = bootstrap_single_lower_bound(holdout_result, protocol)
        holdout_gate_result = holdout_gate(holdout_result, holdout_lower, protocol)
        research_verdict = "UNMEASURED" if holdout_gate_result["pass"] else "NO_GO"
        evidence_status = (
            "VALID_ALL_PUBLIC_PROXY_GATES_PASS_ACCOUNT_TRUTH_UNKNOWN"
            if holdout_gate_result["pass"]
            else "VALID_MEASURED_HOLDOUT_GATE_FAILURE"
        )
        return write_terminal_result(
            protocol,
            state_root,
            research_verdict,
            evidence_status,
            "OPENED_ONCE_CHAMPION_ONLY",
            {
                "code": (
                    "PUBLIC_PROXY_PASS_ACCOUNT_EFFECTIVE_PROFITABILITY_UNKNOWN"
                    if holdout_gate_result["pass"]
                    else "HOLDOUT_GATE_FAILED"
                ),
                "detail": champion.trial.trial_id,
            },
            {
                "developmentChampionTrialId": champion.trial.trial_id,
                "holdout": simulation_document(holdout_result),
                "holdoutStressDailyBlockLowerBoundMeanReturn": dstr(holdout_lower),
                "holdoutGate": holdout_gate_result,
            },
        )
    except Exception as exc:
        code = exc.code if isinstance(exc, S1PError) else f"UNEXPECTED_{type(exc).__name__.upper()}"
        detail = exc.detail if isinstance(exc, S1PError) else str(exc)
        return write_terminal_result(
            protocol,
            state_root,
            "UNMEASURED",
            "INVALID_EVIDENCE_TERMINAL",
            ("OPENED_AFTER_SEAL" if (state_root / HOLDOUT_MARKER_NAME).exists() else "UNOPENED"),
            {"code": code, "detail": detail},
        )


ARTIFACT_SCHEMAS = {
    PRE_FREEZE_NAME: "S1PPreOutcomeFreezeCandidateV1",
    RUN_MARKER_NAME: "S1PRunConsumedV1",
    DEVELOPMENT_RESULT_NAME: "S1PDevelopmentResultV1",
    CHAMPION_SEAL_NAME: "S1PDevelopmentChampionSealV1",
    HOLDOUT_MARKER_NAME: "S1PHoldoutOpenV1",
    RESULT_NAME: "S1PResultCandidateV1",
}


def parse_checksum_manifest(path: Path) -> dict[str, str]:
    rows: dict[str, str] = {}
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError as exc:
        raise ContractError("CHECKSUM_MANIFEST_READ_FAILED", f"{path}: {exc}") from exc
    for line in lines:
        parts = line.split(maxsplit=1)
        if len(parts) != 2:
            raise ContractError("CHECKSUM_MANIFEST_ROW_INVALID", repr(line))
        digest, filename = parts
        filename = filename.lstrip("*")
        if len(digest) != 64 or any(character not in "0123456789abcdef" for character in digest):
            raise ContractError("CHECKSUM_MANIFEST_DIGEST_INVALID", digest)
        if Path(filename).name != filename:
            raise ContractError("CHECKSUM_MANIFEST_PATH_INVALID", filename)
        if filename in rows:
            raise ContractError("CHECKSUM_MANIFEST_DUPLICATE", filename)
        rows[filename] = digest
    return rows


def verify_committed_packet(
    state_dir: Path,
    external_result: Mapping[str, Any],
) -> dict[str, Any]:
    committed_freeze = verify_committed_freeze(state_dir)
    if not COMMITTED_RESULT_PATH.exists():
        raise ContractError("COMMITTED_RESULT_MISSING", str(COMMITTED_RESULT_PATH))
    external_result_path = state_dir / RESULT_NAME
    external_result_sha = sha256_file(external_result_path)
    committed_result_sha = sha256_file(COMMITTED_RESULT_PATH)
    if committed_result_sha != external_result_sha:
        raise ContractError(
            "COMMITTED_RESULT_MISMATCH",
            f"{committed_result_sha} != {external_result_sha}",
        )
    committed_result = verify_artifact(
        load_json(COMMITTED_RESULT_PATH),
        "S1PResultCandidateV1",
    )
    if committed_result["artifactSha256"] != external_result["artifactSha256"]:
        raise ContractError(
            "COMMITTED_RESULT_ARTIFACT_MISMATCH",
            "tracked and external result artifacts differ",
        )
    manifest = parse_checksum_manifest(CHECKSUMS_PATH)
    expected_names = {path.name for path in PACKET_PATHS}
    if set(manifest) != expected_names:
        raise ContractError(
            "CHECKSUM_MANIFEST_FILE_SET_MISMATCH",
            f"{sorted(manifest)} != {sorted(expected_names)}",
        )
    for path in PACKET_PATHS:
        actual = sha256_file(path)
        if manifest[path.name] != actual:
            raise ContractError(
                "CHECKSUM_MANIFEST_MISMATCH",
                f"{path.name}: {manifest[path.name]} != {actual}",
            )
    return {
        "committedFreezeFileSha256": sha256_file(COMMITTED_FREEZE_PATH),
        "committedFreezeArtifactSha256": committed_freeze["artifactSha256"],
        "committedResultFileSha256": committed_result_sha,
        "committedResultArtifactSha256": committed_result["artifactSha256"],
        "checksumManifestStatus": "PASS",
        "checksumManifestFileCount": len(manifest),
    }


@dataclass(frozen=True)
class AuthenticatedTrade:
    symbol: str
    entry_index: int
    exit_index: int
    exit_ts_ms: int
    net_by_cost: Mapping[str, Decimal]
    severe_path_pnl: tuple[Decimal, ...]
    capacity_stress_pass: bool


@dataclass(frozen=True)
class AuthenticatedSimulation:
    trial: Trial
    phase: str
    trades: tuple[AuthenticatedTrade, ...]
    daily_dates: tuple[str, ...]
    daily_net_by_cost: Mapping[str, tuple[Decimal, ...]]
    severe_equity_curve_usd: tuple[Decimal, ...]
    maximum_severe_drawdown_pct: Decimal


def artifact_decimal(value: Any, field: str) -> Decimal:
    if not isinstance(value, str):
        raise ContractError("ARTIFACT_DECIMAL_INVALID", f"{field}: expected canonical string")
    try:
        number = Decimal(value)
    except InvalidOperation as exc:
        raise ContractError("ARTIFACT_DECIMAL_INVALID", f"{field}={value!r}") from exc
    if not number.is_finite() or dstr(number) != value:
        raise ContractError("ARTIFACT_DECIMAL_INVALID", f"{field}={value!r}")
    return number


def artifact_integer(value: Any, field: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ContractError("ARTIFACT_INTEGER_INVALID", f"{field}={value!r}")
    return value


def expected_daily_dates(start_ms: int, end_ms: int) -> tuple[str, ...]:
    day_ms = DAY_BARS * FIVE_MINUTES_MS
    if start_ms % day_ms or end_ms % day_ms or end_ms <= start_ms:
        raise ContractError("ARTIFACT_PHASE_DATES_INVALID", f"{start_ms}..{end_ms}")
    return tuple(utc_day(timestamp) for timestamp in range(start_ms, end_ms, day_ms))


def validate_trade_artifact(
    document: Any,
    *,
    trial_id: str,
    trade_number: int,
    phase_start_ms: int,
    phase_end_ms: int,
    index_origin_ms: int,
    protocol: Mapping[str, Any],
) -> AuthenticatedTrade:
    field = f"{trial_id}.trade[{trade_number}]"
    expected_keys = {
        "symbol",
        "sourceArmIndex",
        "entryIndex",
        "exitIndex",
        "entryTimeMs",
        "exitTimeMs",
        "quantity",
        "entrySpot",
        "entryPerpetual",
        "exitSpot",
        "exitPerpetual",
        "exitReasons",
        "grossPnlUsd",
        "adverseFundingDebitUsd",
        "discardedFavorableFundingCreditUsd",
        "netUsd",
        "severeMarkToMarketPath",
        "capacityProxy",
    }
    if not isinstance(document, dict) or set(document) != expected_keys:
        raise ContractError("TRADE_ARTIFACT_SHAPE_INVALID", field)
    symbol = document["symbol"]
    if symbol not in protocol["data"]["symbols"]:
        raise ContractError("TRADE_SYMBOL_INVALID", f"{field}: {symbol!r}")
    source_arm_index = artifact_integer(document["sourceArmIndex"], f"{field}.sourceArmIndex")
    entry_index = artifact_integer(document["entryIndex"], f"{field}.entryIndex")
    exit_index = artifact_integer(document["exitIndex"], f"{field}.exitIndex")
    entry_ts_ms = artifact_integer(document["entryTimeMs"], f"{field}.entryTimeMs")
    exit_ts_ms = artifact_integer(document["exitTimeMs"], f"{field}.exitTimeMs")
    source_ts_ms = index_origin_ms + source_arm_index * FIVE_MINUTES_MS
    source_to_entry = entry_index - source_arm_index
    holding_bars = exit_index - entry_index
    if (
        source_arm_index < 0
        or source_to_entry < 2
        or source_to_entry > 7
        or holding_bars <= 0
        or holding_bars > int(protocol["trials"]["maximumHoldBars"])
    ):
        raise ContractError(
            "TRADE_INDEX_SEMANTICS_INVALID",
            f"{field}: {source_arm_index}/{entry_index}/{exit_index}",
        )
    if (
        source_ts_ms < phase_start_ms
        or source_ts_ms >= phase_end_ms
        or entry_ts_ms != index_origin_ms + entry_index * FIVE_MINUTES_MS
        or exit_ts_ms != index_origin_ms + exit_index * FIVE_MINUTES_MS
        or entry_ts_ms < phase_start_ms
        or exit_ts_ms >= phase_end_ms
    ):
        raise ContractError(
            "TRADE_TIMESTAMP_SEMANTICS_INVALID",
            f"{field}: {entry_ts_ms}->{exit_ts_ms}",
        )
    quantity = artifact_decimal(document["quantity"], f"{field}.quantity")
    entry_spot = artifact_decimal(document["entrySpot"], f"{field}.entrySpot")
    entry_perpetual = artifact_decimal(document["entryPerpetual"], f"{field}.entryPerpetual")
    exit_spot = artifact_decimal(document["exitSpot"], f"{field}.exitSpot")
    exit_perpetual = artifact_decimal(document["exitPerpetual"], f"{field}.exitPerpetual")
    if quantity <= ZERO or any(
        price <= ZERO for price in (entry_spot, entry_perpetual, exit_spot, exit_perpetual)
    ):
        raise ContractError("TRADE_PRICE_OR_QUANTITY_INVALID", field)
    expected_quantity = Decimal(protocol["trials"]["legNotionalUsd"]) / entry_spot
    if quantity != expected_quantity:
        raise ContractError(
            "TRADE_FROZEN_LEG_NOTIONAL_INVALID",
            f"{field}: {dstr(quantity)} != {dstr(expected_quantity)}",
        )
    exit_reasons = document["exitReasons"]
    if (
        not isinstance(exit_reasons, list)
        or not exit_reasons
        or any(not isinstance(reason, str) or not reason for reason in exit_reasons)
    ):
        raise ContractError("TRADE_EXIT_REASONS_INVALID", field)
    gross = quantity * ((exit_spot - entry_spot) + (entry_perpetual - exit_perpetual))
    if artifact_decimal(document["grossPnlUsd"], f"{field}.grossPnlUsd") != gross:
        raise ContractError("TRADE_GROSS_PNL_INVALID", field)
    adverse_funding = artifact_decimal(
        document["adverseFundingDebitUsd"],
        f"{field}.adverseFundingDebitUsd",
    )
    discarded_credit = artifact_decimal(
        document["discardedFavorableFundingCreditUsd"],
        f"{field}.discardedFavorableFundingCreditUsd",
    )
    if adverse_funding < ZERO or discarded_credit < ZERO:
        raise ContractError("TRADE_FUNDING_SIGN_INVALID", field)
    spot_fill_notional = quantity * (entry_spot + exit_spot)
    perpetual_fill_notional = quantity * (entry_perpetual + exit_perpetual)
    net_document = document["netUsd"]
    if not isinstance(net_document, dict) or set(net_document) != {"base", "stress", "severe"}:
        raise ContractError("TRADE_NET_COST_SET_INVALID", field)
    net_by_cost: dict[str, Decimal] = {}
    for cost_name in ("base", "stress", "severe"):
        cost = protocol["costs"][cost_name]
        fees = (
            spot_fill_notional * Decimal(cost["spotFeeBpsPerFill"])
            + perpetual_fill_notional * Decimal(cost["perpetualFeeBpsPerFill"])
        ) / TEN_THOUSAND
        adverse_execution = (
            (spot_fill_notional + perpetual_fill_notional)
            * Decimal(cost["adverseExecutionBpsPerFill"])
            / TEN_THOUSAND
        )
        expected_net = gross - fees - adverse_execution - adverse_funding
        actual_net = artifact_decimal(net_document[cost_name], f"{field}.netUsd.{cost_name}")
        if actual_net != expected_net:
            raise ContractError("TRADE_NET_ARITHMETIC_INVALID", f"{field}/{cost_name}")
        net_by_cost[cost_name] = actual_net
    path_document = document["severeMarkToMarketPath"]
    if not isinstance(path_document, list) or len(path_document) != holding_bars:
        raise ContractError("TRADE_SEVERE_PATH_LENGTH_INVALID", field)
    severe_path_pnl: list[Decimal] = []
    previous_debit = ZERO
    for path_offset, point in enumerate(path_document):
        path_field = f"{field}.severeMarkToMarketPath[{path_offset}]"
        expected_index = entry_index + path_offset
        if not isinstance(point, dict) or set(point) != {
            "index",
            "timeMs",
            "spotClose",
            "perpetualClose",
            "cumulativeAdverseFundingDebitUsd",
            "severePnlUsd",
        }:
            raise ContractError("TRADE_SEVERE_PATH_SHAPE_INVALID", path_field)
        point_index = artifact_integer(point["index"], f"{path_field}.index")
        point_time_ms = artifact_integer(point["timeMs"], f"{path_field}.timeMs")
        if (
            point_index != expected_index
            or point_time_ms != index_origin_ms + expected_index * FIVE_MINUTES_MS
        ):
            raise ContractError("TRADE_SEVERE_PATH_CLOCK_INVALID", path_field)
        spot_close = artifact_decimal(point["spotClose"], f"{path_field}.spotClose")
        perpetual_close = artifact_decimal(
            point["perpetualClose"],
            f"{path_field}.perpetualClose",
        )
        cumulative_debit = artifact_decimal(
            point["cumulativeAdverseFundingDebitUsd"],
            f"{path_field}.cumulativeAdverseFundingDebitUsd",
        )
        if spot_close <= ZERO or perpetual_close <= ZERO or cumulative_debit < previous_debit:
            raise ContractError("TRADE_SEVERE_PATH_INPUT_INVALID", path_field)
        expected_path_pnl = severe_mark_to_market_pnl(
            quantity,
            entry_spot,
            entry_perpetual,
            spot_close,
            perpetual_close,
            cumulative_debit,
            protocol,
        )
        if (
            artifact_decimal(
                point["severePnlUsd"],
                f"{path_field}.severePnlUsd",
            )
            != expected_path_pnl
        ):
            raise ContractError("TRADE_SEVERE_PATH_ARITHMETIC_INVALID", path_field)
        severe_path_pnl.append(expected_path_pnl)
        previous_debit = cumulative_debit
    if previous_debit != adverse_funding:
        raise ContractError("TRADE_SEVERE_PATH_FUNDING_INVALID", field)
    capacity = document["capacityProxy"]
    if not isinstance(capacity, dict) or set(capacity) != {
        "basePass",
        "stressPass",
        "usesImmediatelyPriorClosedBar",
        "fills",
    }:
        raise ContractError("TRADE_CAPACITY_SHAPE_INVALID", field)
    fills = capacity["fills"]
    expected_fill_notionals = {
        "entrySpot": quantity * entry_spot,
        "entryPerpetual": quantity * entry_perpetual,
        "exitSpot": quantity * exit_spot,
        "exitPerpetual": quantity * exit_perpetual,
    }
    if not isinstance(fills, list) or len(fills) != len(expected_fill_notionals):
        raise ContractError("TRADE_CAPACITY_FILLS_INVALID", field)
    parsed_fills: list[tuple[Decimal, Decimal]] = []
    for fill_number, (fill, expected_fill_id) in enumerate(
        zip(fills, expected_fill_notionals, strict=True)
    ):
        fill_field = f"{field}.capacityProxy.fills[{fill_number}]"
        if (
            not isinstance(fill, dict)
            or set(fill)
            != {
                "fill",
                "actualFillNotionalUsd",
                "priorSameLegQuoteVolumeUsd",
            }
            or fill.get("fill") != expected_fill_id
        ):
            raise ContractError("TRADE_CAPACITY_FILL_SHAPE_INVALID", fill_field)
        actual_notional = artifact_decimal(
            fill["actualFillNotionalUsd"],
            f"{fill_field}.actualFillNotionalUsd",
        )
        prior_volume = artifact_decimal(
            fill["priorSameLegQuoteVolumeUsd"],
            f"{fill_field}.priorSameLegQuoteVolumeUsd",
        )
        if (
            actual_notional != expected_fill_notionals[expected_fill_id]
            or actual_notional <= ZERO
            or prior_volume < ZERO
        ):
            raise ContractError("TRADE_CAPACITY_FILL_ARITHMETIC_INVALID", fill_field)
        parsed_fills.append((actual_notional, prior_volume))
    base_participation = Decimal(protocol["capacity"]["baseParticipationBps"])
    stress_participation = Decimal(protocol["capacity"]["stressParticipationBps"])
    expected_base_pass = all(
        capacity_fill_pass(notional, base_participation, volume)
        for notional, volume in parsed_fills
    )
    expected_stress_pass = all(
        capacity_fill_pass(notional, stress_participation, volume)
        for notional, volume in parsed_fills
    )
    if (
        capacity["basePass"] is not expected_base_pass
        or capacity["stressPass"] is not expected_stress_pass
        or capacity["usesImmediatelyPriorClosedBar"] is not True
    ):
        raise ContractError("TRADE_CAPACITY_SEMANTICS_INVALID", field)
    return AuthenticatedTrade(
        symbol=cast(str, symbol),
        entry_index=entry_index,
        exit_index=exit_index,
        exit_ts_ms=exit_ts_ms,
        net_by_cost=net_by_cost,
        severe_path_pnl=tuple(severe_path_pnl),
        capacity_stress_pass=expected_stress_pass,
    )


def validate_simulation_artifact(
    document: Any,
    *,
    trial: Trial,
    phase: str,
    phase_start_ms: int,
    phase_end_ms: int,
    index_origin_ms: int,
    protocol: Mapping[str, Any],
) -> AuthenticatedSimulation:
    expected_keys = {
        "trialId",
        "relativeVolumeIntensityThresholdZ",
        "basisThresholdZ",
        "phase",
        "roundTrips",
        "roundTripsByAsset",
        "netUsd",
        "maximumSevereMarkToMarketDrawdownPct",
        "dailyDates",
        "dailyNetUsd",
        "severeEquityCurveUsd",
        "trades",
    }
    if not isinstance(document, dict) or set(document) != expected_keys:
        raise ContractError("SIMULATION_ARTIFACT_SHAPE_INVALID", trial.trial_id)
    if (
        document["trialId"] != trial.trial_id
        or document["relativeVolumeIntensityThresholdZ"] != dstr(trial.volume_threshold)
        or document["basisThresholdZ"] != dstr(trial.basis_threshold)
        or document["phase"] != phase
    ):
        raise ContractError("SIMULATION_TRIAL_BINDING_INVALID", trial.trial_id)
    trades_document = document["trades"]
    if not isinstance(trades_document, list):
        raise ContractError("SIMULATION_TRADES_INVALID", trial.trial_id)
    trades = tuple(
        validate_trade_artifact(
            row,
            trial_id=trial.trial_id,
            trade_number=index,
            phase_start_ms=phase_start_ms,
            phase_end_ms=phase_end_ms,
            index_origin_ms=index_origin_ms,
            protocol=protocol,
        )
        for index, row in enumerate(trades_document)
    )
    if any(
        current.entry_index <= previous.exit_index
        for previous, current in itertools.pairwise(trades)
    ):
        raise ContractError("SIMULATION_TRADE_OVERLAP_INVALID", trial.trial_id)
    if artifact_integer(document["roundTrips"], f"{trial.trial_id}.roundTrips") != len(trades):
        raise ContractError("SIMULATION_ROUND_TRIPS_INVALID", trial.trial_id)
    counts = {
        symbol: sum(1 for trade in trades if trade.symbol == symbol)
        for symbol in protocol["data"]["symbols"]
    }
    if document["roundTripsByAsset"] != counts:
        raise ContractError("SIMULATION_ROUND_TRIPS_BY_ASSET_INVALID", trial.trial_id)
    net_by_cost = {
        name: sum((trade.net_by_cost[name] for trade in trades), ZERO)
        for name in ("base", "stress", "severe")
    }
    net_document = document["netUsd"]
    if not isinstance(net_document, dict) or set(net_document) != set(net_by_cost):
        raise ContractError("SIMULATION_NET_SHAPE_INVALID", trial.trial_id)
    for cost_name, expected_value in net_by_cost.items():
        if (
            artifact_decimal(
                net_document[cost_name],
                f"{trial.trial_id}.netUsd.{cost_name}",
            )
            != expected_value
        ):
            raise ContractError("SIMULATION_NET_ARITHMETIC_INVALID", trial.trial_id)
    dates_document = document["dailyDates"]
    expected_dates = expected_daily_dates(phase_start_ms, phase_end_ms)
    if dates_document != list(expected_dates):
        raise ContractError("SIMULATION_DAILY_DATES_INVALID", trial.trial_id)
    daily_document = document["dailyNetUsd"]
    if not isinstance(daily_document, dict) or set(daily_document) != set(net_by_cost):
        raise ContractError("SIMULATION_DAILY_NET_SHAPE_INVALID", trial.trial_id)
    daily_net_by_cost: dict[str, tuple[Decimal, ...]] = {}
    date_index = {date: index for index, date in enumerate(expected_dates)}
    for cost_name in ("base", "stress", "severe"):
        row = daily_document[cost_name]
        if not isinstance(row, list) or len(row) != len(expected_dates):
            raise ContractError("SIMULATION_DAILY_NET_LENGTH_INVALID", trial.trial_id)
        parsed_row = tuple(
            artifact_decimal(value, f"{trial.trial_id}.dailyNetUsd.{cost_name}[{index}]")
            for index, value in enumerate(row)
        )
        expected_row = [ZERO for _ in expected_dates]
        for trade in trades:
            day = utc_day(trade.exit_ts_ms)
            if day not in date_index:
                raise ContractError("SIMULATION_TRADE_DAY_INVALID", f"{trial.trial_id}/{day}")
            expected_row[date_index[day]] += trade.net_by_cost[cost_name]
        if parsed_row != tuple(expected_row) or sum(parsed_row, ZERO) != net_by_cost[cost_name]:
            raise ContractError("SIMULATION_DAILY_NET_ARITHMETIC_INVALID", trial.trial_id)
        daily_net_by_cost[cost_name] = parsed_row
    curve_document = document["severeEquityCurveUsd"]
    if not isinstance(curve_document, list) or not curve_document:
        raise ContractError("SIMULATION_SEVERE_EQUITY_CURVE_INVALID", trial.trial_id)
    severe_equity = tuple(
        artifact_decimal(value, f"{trial.trial_id}.severeEquityCurveUsd[{index}]")
        for index, value in enumerate(curve_document)
    )
    capital = Decimal(protocol["trials"]["portfolioCapitalUsd"])
    expected_curve_length = 1 + sum(trade.exit_index - trade.entry_index + 1 for trade in trades)
    if (
        severe_equity[0] != capital
        or severe_equity[-1] != capital + net_by_cost["severe"]
        or len(severe_equity) != expected_curve_length
    ):
        raise ContractError("SIMULATION_SEVERE_EQUITY_TERMINAL_INVALID", trial.trial_id)
    expected_equity = [capital]
    cumulative_severe = ZERO
    for trade in trades:
        expected_equity.extend(
            capital + cumulative_severe + path_pnl for path_pnl in trade.severe_path_pnl
        )
        expected_equity.append(capital + cumulative_severe + trade.net_by_cost["severe"])
        cumulative_severe += trade.net_by_cost["severe"]
    if severe_equity != tuple(expected_equity):
        raise ContractError(
            "SIMULATION_SEVERE_EQUITY_RECOMPUTATION_INVALID",
            trial.trial_id,
        )
    drawdown = maximum_drawdown_pct_from_equity(severe_equity)
    if (
        artifact_decimal(
            document["maximumSevereMarkToMarketDrawdownPct"],
            f"{trial.trial_id}.maximumSevereMarkToMarketDrawdownPct",
        )
        != drawdown
    ):
        raise ContractError("SIMULATION_DRAWDOWN_ARITHMETIC_INVALID", trial.trial_id)
    return AuthenticatedSimulation(
        trial=trial,
        phase=phase,
        trades=trades,
        daily_dates=expected_dates,
        daily_net_by_cost=daily_net_by_cost,
        severe_equity_curve_usd=severe_equity,
        maximum_severe_drawdown_pct=drawdown,
    )


def statistics_result(simulation: AuthenticatedSimulation) -> SimulationResult:
    return SimulationResult(
        trial=simulation.trial,
        phase=simulation.phase,
        trades=(),
        daily_net_by_cost=simulation.daily_net_by_cost,
        daily_dates=simulation.daily_dates,
        severe_equity_curve_usd=simulation.severe_equity_curve_usd,
        maximum_severe_drawdown_pct=simulation.maximum_severe_drawdown_pct,
    )


def validate_family_statistics_artifact(
    document: Any,
    simulations: Sequence[AuthenticatedSimulation],
    protocol: Mapping[str, Any],
) -> tuple[dict[str, Any], Decimal]:
    if not isinstance(document, dict):
        raise ContractError("DEVELOPMENT_STATISTICS_INVALID", "not an object")
    trial_ids = {simulation.trial.trial_id for simulation in simulations}
    lower_bounds = document.get("stressDailyBlockLowerBoundMeanReturn")
    p_values = document.get("oneSidedPValues")
    holm_pass = document.get("holmPass")
    if (
        not isinstance(lower_bounds, dict)
        or set(lower_bounds) != trial_ids
        or not isinstance(p_values, dict)
        or set(p_values) != trial_ids
        or not isinstance(holm_pass, dict)
        or set(holm_pass) != trial_ids
        or any(not isinstance(value, bool) for value in holm_pass.values())
    ):
        raise ContractError("DEVELOPMENT_STATISTICS_SHAPE_INVALID", repr(document))
    for trial_id in trial_ids:
        artifact_decimal(lower_bounds[trial_id], f"{trial_id}.lowerBound")
        p_value = artifact_decimal(p_values[trial_id], f"{trial_id}.oneSidedPValue")
        if p_value < ZERO or p_value > ONE:
            raise ContractError("DEVELOPMENT_P_VALUE_RANGE_INVALID", trial_id)
    reality_p = artifact_decimal(
        document.get("synchronousMaxRealityCheckPValue"),
        "synchronousMaxRealityCheckPValue",
    )
    pbo_document = artifact_decimal(document.get("pbo"), "pbo")
    if (
        reality_p < ZERO
        or reality_p > ONE
        or pbo_document < ZERO
        or pbo_document > ONE
        or not isinstance(document.get("synchronousMaxRealityCheckPass"), bool)
    ):
        raise ContractError("DEVELOPMENT_STATISTIC_RANGE_INVALID", repr(document))
    runtime_results = tuple(statistics_result(simulation) for simulation in simulations)
    computed = synchronous_bootstrap(runtime_results, protocol)
    pbo = calculate_pbo(runtime_results, protocol)
    expected = family_stats_document(computed, pbo)
    if document != expected:
        raise ContractError("DEVELOPMENT_STATISTICS_RECOMPUTATION_INVALID", "artifact mismatch")
    return computed, pbo


def authenticated_cost_total(simulation: AuthenticatedSimulation, cost: str) -> Decimal:
    return sum((trade.net_by_cost[cost] for trade in simulation.trades), ZERO)


def authenticated_grouped_stress(
    simulation: AuthenticatedSimulation,
    group: str,
) -> dict[str, Decimal]:
    grouped: dict[str, Decimal] = {}
    for trade in simulation.trades:
        if group == "symbol":
            key = trade.symbol
        elif group == "month":
            key = utc_month(trade.exit_ts_ms)
        elif group == "quarter":
            key = utc_quarter(trade.exit_ts_ms)
        else:
            raise ContractError("GROUP_INVALID", group)
        grouped[key] = grouped.get(key, ZERO) + trade.net_by_cost["stress"]
    return grouped


def authenticated_development_gate(
    simulation: AuthenticatedSimulation,
    folds: Sequence[AuthenticatedSimulation],
    family_stats: Mapping[str, Any],
    pbo: Decimal,
    protocol: Mapping[str, Any],
) -> dict[str, Any]:
    trial_id = simulation.trial.trial_id
    per_asset = authenticated_grouped_stress(simulation, "symbol")
    quarters = authenticated_grouped_stress(simulation, "quarter")
    stress_total = authenticated_cost_total(simulation, "stress")
    remove_best = stress_total - max(quarters.values(), default=ZERO)
    fold_totals = [authenticated_cost_total(fold, "stress") for fold in folds]
    checks = {
        "minimumDevelopmentRoundTrips": len(simulation.trades)
        >= int(protocol["gates"]["minimumDevelopmentRoundTrips"]),
        "minimumRoundTripsPerAsset": all(
            sum(1 for trade in simulation.trades if trade.symbol == symbol)
            >= int(protocol["gates"]["minimumRoundTripsPerAsset"])
            for symbol in protocol["data"]["symbols"]
        ),
        "minimumActiveCalendarQuarters": len(quarters)
        >= int(protocol["gates"]["minimumActiveCalendarQuarters"]),
        "baseStressSevereNetPositive": all(
            authenticated_cost_total(simulation, name) > ZERO
            for name in ("base", "stress", "severe")
        ),
        "stressWalkForwardNetPositiveEachFold": bool(fold_totals)
        and all(value > ZERO for value in fold_totals),
        "stressLowerBoundPositive": family_stats["lowerBounds"][trial_id] > ZERO,
        "holmPass": bool(family_stats["holmPass"][trial_id]),
        "maxRealityCheckPass": bool(family_stats["maxRealityCheckPass"]),
        "capacityProxyPass": bool(simulation.trades)
        and all(trade.capacity_stress_pass for trade in simulation.trades),
        "bothAssetsStressPositive": all(
            per_asset.get(symbol, ZERO) > ZERO for symbol in protocol["data"]["symbols"]
        ),
        "removeBestQuarterStressPositive": remove_best > ZERO,
        "maximumLiquidationDrawdownPct": simulation.maximum_severe_drawdown_pct
        <= Decimal(protocol["gates"]["maximumLiquidationDrawdownPct"]),
        "maximumPbo": pbo <= Decimal(protocol["gates"]["maximumPbo"]),
    }
    return {
        "pass": all(checks.values()),
        "checks": checks,
        "foldStressNetUsd": [dstr(value) for value in fold_totals],
        "removeBestQuarterStressNetUsd": dstr(remove_best),
    }


def authenticated_holdout_gate(
    simulation: AuthenticatedSimulation,
    lower_bound: Decimal,
    protocol: Mapping[str, Any],
) -> dict[str, Any]:
    gate = protocol["gates"]["holdout"]
    per_asset = authenticated_grouped_stress(simulation, "symbol")
    months = authenticated_grouped_stress(simulation, "month")
    stress_total = authenticated_cost_total(simulation, "stress")
    remove_best = stress_total - max(months.values(), default=ZERO)
    checks = {
        "minimumRoundTrips": len(simulation.trades) >= int(gate["minimumRoundTrips"]),
        "minimumRoundTripsPerAsset": all(
            sum(1 for trade in simulation.trades if trade.symbol == symbol)
            >= int(gate["minimumRoundTripsPerAsset"])
            for symbol in protocol["data"]["symbols"]
        ),
        "minimumActiveCalendarMonths": len(months) >= int(gate["minimumActiveCalendarMonths"]),
        "baseStressSevereNetPositive": all(
            authenticated_cost_total(simulation, name) > ZERO
            for name in ("base", "stress", "severe")
        ),
        "stressLowerBoundPositive": lower_bound > ZERO,
        "capacityProxyPass": bool(simulation.trades)
        and all(trade.capacity_stress_pass for trade in simulation.trades),
        "bothAssetsStressPositive": all(
            per_asset.get(symbol, ZERO) > ZERO for symbol in protocol["data"]["symbols"]
        ),
        "removeBestMonthStressPositive": remove_best > ZERO,
        "maximumLiquidationDrawdownPct": simulation.maximum_severe_drawdown_pct
        <= Decimal(gate["maximumLiquidationDrawdownPct"]),
    }
    return {
        "pass": all(checks.values()),
        "checks": checks,
        "removeBestMonthStressNetUsd": dstr(remove_best),
        "multiplicity": gate["multiplicity"],
    }


def validate_lifecycle_semantics(
    protocol: Mapping[str, Any],
    pre_freeze: Mapping[str, Any],
    result: Mapping[str, Any],
    chain: Mapping[str, Any],
    documents: Mapping[str, Mapping[str, Any]],
) -> None:
    ordered_names = (
        PRE_FREEZE_NAME,
        RUN_MARKER_NAME,
        DEVELOPMENT_RESULT_NAME,
        CHAMPION_SEAL_NAME,
        HOLDOUT_MARKER_NAME,
    )
    if set(chain) not in (set(ordered_names[:count]) for count in range(1, 6)):
        raise ContractError(
            "RESULT_CHAIN_NOT_LIFECYCLE_PREFIX",
            repr(sorted(chain)),
        )
    protocol_id = protocol["protocolId"]
    if any(document.get("protocolId") != protocol_id for document in documents.values()):
        raise ContractError("LIFECYCLE_PROTOCOL_ID_MISMATCH", protocol_id)
    pre_sha = chain[PRE_FREEZE_NAME]
    run = documents.get(RUN_MARKER_NAME)
    if run is not None:
        run_anchor = run.get("preOutcomeGitAnchor")
        run_ref = run.get("preOutcomeGitRef")
        git_proof = run.get("gitAnchorProof")
        if not isinstance(run_anchor, str) or not isinstance(run_ref, str):
            raise ContractError("RUN_MARKER_GIT_IDENTITY_INVALID", repr(run))
        validate_git_commit_anchor(run_anchor)
        validate_pre_outcome_git_ref(run_ref)
        if not isinstance(git_proof, dict):
            raise ContractError("RUN_MARKER_GIT_PROOF_INVALID", repr(git_proof))
        expected_git_proof = {
            "schema": "S1PPreOutcomeGitAnchorProofV1",
            "anchorCommit": run_anchor,
            "preservedRef": run_ref,
            "canonicalParent": protocol["canonicalBaseCommit"],
            "originUrl": EXPECTED_ORIGIN_URL,
            "committedFreezeFileSha256": pre_sha,
            "worktreeClean": True,
            "anchorWasCurrentHead": True,
            "currentHeadAtVerification": run_anchor,
            "networkUsed": False,
        }
        for key, value in expected_git_proof.items():
            if git_proof.get(key) != value:
                raise ContractError(
                    "RUN_MARKER_GIT_PROOF_INVALID",
                    f"{key}: {git_proof.get(key)!r} != {value!r}",
                )
        if not isinstance(git_proof.get("anchorTreeBindings"), dict):
            raise ContractError("RUN_MARKER_GIT_TREE_BINDINGS_INVALID", repr(git_proof))
        expected_run = {
            "preOutcomeFreezeFileSha256": pre_sha,
            "committedFreezeFileSha256": pre_sha,
            "archiveContentOpenRunOrdinal": 1,
            "developmentBodiesMayOpen": True,
            "holdoutBodiesMayOpen": False,
            "secondRunRefused": True,
        }
        for key, value in expected_run.items():
            if run.get(key) != value:
                raise ContractError(
                    "RUN_MARKER_SEMANTICS_INVALID",
                    f"{key}: {run.get(key)!r} != {value!r}",
                )
    development = documents.get(DEVELOPMENT_RESULT_NAME)
    selected_trial_id: str | None = None
    selected_gate: Mapping[str, Any] | None = None
    trial_contracts = {trial.trial_id: trial for trial in trials_from_protocol(protocol)}
    development_simulations: dict[str, AuthenticatedSimulation] = {}
    if development is not None:
        if run is None or development.get("runMarkerFileSha256") != chain.get(RUN_MARKER_NAME):
            raise ContractError("DEVELOPMENT_RUN_LINK_INVALID", "semantic validation")
        if development.get("archivePhaseOpened") != "DEVELOPMENT_ONLY":
            raise ContractError(
                "DEVELOPMENT_ARCHIVE_PHASE_INVALID",
                repr(development.get("archivePhaseOpened")),
            )
        family = development.get("family")
        walk_forward = development.get("walkForward")
        gates = development.get("gates")
        statistics = development.get("statistics")
        if (
            not isinstance(family, list)
            or not isinstance(walk_forward, dict)
            or not isinstance(gates, dict)
        ):
            raise ContractError("DEVELOPMENT_FAMILY_OR_GATES_INVALID", "missing")
        if not isinstance(statistics, dict):
            raise ContractError("DEVELOPMENT_STATISTICS_INVALID", "missing")
        development_start = parse_utc_ms(protocol["calendar"]["development"]["startInclusive"])
        development_end = parse_utc_ms(protocol["calendar"]["development"]["endExclusive"])
        for row in family:
            if not isinstance(row, dict) or not isinstance(row.get("trialId"), str):
                raise ContractError("DEVELOPMENT_TRIAL_INVALID", repr(row))
            trial_id = row["trialId"]
            if trial_id not in trial_contracts:
                raise ContractError("DEVELOPMENT_TRIAL_UNKNOWN", trial_id)
            if trial_id in development_simulations:
                raise ContractError("DEVELOPMENT_TRIAL_DUPLICATE", trial_id)
            development_simulations[trial_id] = validate_simulation_artifact(
                row,
                trial=trial_contracts[trial_id],
                phase="development",
                phase_start_ms=development_start,
                phase_end_ms=development_end,
                index_origin_ms=development_start,
                protocol=protocol,
            )
        if (
            set(development_simulations) != set(trial_contracts)
            or set(walk_forward) != set(trial_contracts)
            or set(gates) != set(trial_contracts)
        ):
            raise ContractError(
                "DEVELOPMENT_TRIAL_SET_INVALID",
                repr(sorted(development_simulations)),
            )
        authenticated_folds: dict[str, tuple[AuthenticatedSimulation, ...]] = {}
        fold_contracts = protocol["calendar"]["walkForward"]
        for trial_id, rows in walk_forward.items():
            if not isinstance(rows, list) or len(rows) != len(fold_contracts):
                raise ContractError("WALK_FORWARD_ARTIFACT_COUNT_INVALID", trial_id)
            parsed_folds: list[AuthenticatedSimulation] = []
            for fold_index, (row, fold_contract) in enumerate(
                zip(rows, fold_contracts, strict=True),
                start=1,
            ):
                if not isinstance(row, dict) or set(row) != {
                    "foldNumber",
                    "trainStart",
                    "trainEnd",
                    "forwardStart",
                    "forwardEnd",
                    "simulation",
                }:
                    raise ContractError(
                        "WALK_FORWARD_ARTIFACT_SHAPE_INVALID",
                        f"{trial_id}/{fold_index}",
                    )
                expected_metadata = {
                    "foldNumber": fold_index,
                    "trainStart": fold_contract["trainStart"],
                    "trainEnd": fold_contract["trainEnd"],
                    "forwardStart": fold_contract["forwardStart"],
                    "forwardEnd": fold_contract["forwardEnd"],
                }
                if any(row[key] != value for key, value in expected_metadata.items()):
                    raise ContractError(
                        "WALK_FORWARD_ARTIFACT_BINDING_INVALID",
                        f"{trial_id}/{fold_index}",
                    )
                parsed_folds.append(
                    validate_simulation_artifact(
                        row["simulation"],
                        trial=trial_contracts[trial_id],
                        phase=f"walk_forward_{fold_index}",
                        phase_start_ms=parse_utc_ms(fold_contract["forwardStart"]),
                        phase_end_ms=parse_utc_ms(fold_contract["forwardEnd"]),
                        index_origin_ms=development_start,
                        protocol=protocol,
                    )
                )
            authenticated_folds[trial_id] = tuple(parsed_folds)
        ordered_simulations = tuple(
            development_simulations[trial.trial_id] for trial in trials_from_protocol(protocol)
        )
        family_stats, pbo = validate_family_statistics_artifact(
            statistics,
            ordered_simulations,
            protocol,
        )
        for trial_id, gate in gates.items():
            expected_gate = authenticated_development_gate(
                development_simulations[trial_id],
                authenticated_folds[trial_id],
                family_stats,
                pbo,
                protocol,
            )
            if gate != expected_gate:
                raise ContractError("DEVELOPMENT_GATE_RECOMPUTATION_INVALID", trial_id)
        selected_trial_id = development.get("selectedChampionTrialId")
        if not isinstance(selected_trial_id, str) or selected_trial_id not in trial_contracts:
            raise ContractError("DEVELOPMENT_SELECTED_TRIAL_INVALID", repr(selected_trial_id))
        if development.get("selectionLaw") != protocol["trials"]["championSelection"]:
            raise ContractError("DEVELOPMENT_SELECTION_LAW_INVALID", repr(selected_trial_id))
        expected_selected = sorted(
            trial_contracts,
            key=lambda trial_id: (
                -family_stats["lowerBounds"][trial_id],
                -authenticated_cost_total(development_simulations[trial_id], "stress"),
                trial_id,
            ),
        )[0]
        if selected_trial_id != expected_selected:
            raise ContractError(
                "DEVELOPMENT_SELECTION_INVALID",
                f"{selected_trial_id} != {expected_selected}",
            )
        selected_gate = gates[selected_trial_id]
    champion = documents.get(CHAMPION_SEAL_NAME)
    if champion is not None:
        if development is None or selected_trial_id is None or selected_gate is None:
            raise ContractError("CHAMPION_WITHOUT_DEVELOPMENT", "invalid prefix")
        trial = trial_contracts[selected_trial_id]
        expected_champion = {
            "developmentResultFileSha256": chain[DEVELOPMENT_RESULT_NAME],
            "trialId": selected_trial_id,
            "relativeVolumeIntensityThresholdZ": dstr(trial.volume_threshold),
            "basisThresholdZ": dstr(trial.basis_threshold),
            "developmentGatePass": True,
            "holdoutBodiesOpened": False,
            "holdoutFallback": "FORBIDDEN",
        }
        for key, value in expected_champion.items():
            if champion.get(key) != value:
                raise ContractError(
                    "CHAMPION_SEMANTICS_INVALID",
                    f"{key}: {champion.get(key)!r} != {value!r}",
                )
        if selected_gate.get("pass") is not True:
            raise ContractError("CHAMPION_GATE_NOT_PASSED", selected_trial_id)
    holdout_marker = documents.get(HOLDOUT_MARKER_NAME)
    if holdout_marker is not None:
        if champion is None or selected_trial_id is None:
            raise ContractError("HOLDOUT_MARKER_WITHOUT_CHAMPION", "invalid prefix")
        expected_holdout_marker = {
            "championSealFileSha256": chain[CHAMPION_SEAL_NAME],
            "openOrdinal": 1,
            "championOnly": True,
            "trialId": selected_trial_id,
        }
        for key, value in expected_holdout_marker.items():
            if holdout_marker.get(key) != value:
                raise ContractError(
                    "HOLDOUT_MARKER_SEMANTICS_INVALID",
                    f"{key}: {holdout_marker.get(key)!r} != {value!r}",
                )

    verdict = result.get("researchVerdict")
    evidence = result.get("evidenceStatus")
    holdout_status = result.get("holdoutStatus")
    reason = result.get("reason")
    if not isinstance(reason, dict) or not isinstance(reason.get("code"), str):
        raise ContractError("RESULT_REASON_INVALID", repr(reason))
    chain_size = len(chain)
    if evidence == "VALID_PRE_RUN_COLLISION_STOP":
        collision_anchor = result.get("preOutcomeGitAnchor")
        collision_ref = result.get("preOutcomeGitRef")
        collision_proof = result.get("gitAnchorProof")
        valid = (
            chain_size == 1
            and pre_freeze["vg9Comparison"]["status"] == "COLLISION_STOP_UNMEASURED"
            and verdict == "UNMEASURED"
            and holdout_status == "UNOPENED"
            and reason["code"] == "VG9_COLLISION"
            and isinstance(collision_anchor, str)
            and isinstance(collision_ref, str)
            and isinstance(collision_proof, dict)
            and collision_proof.get("anchorCommit") == collision_anchor
            and collision_proof.get("preservedRef") == collision_ref
            and collision_proof.get("anchorWasCurrentHead") is True
            and collision_proof.get("worktreeClean") is True
            and collision_proof.get("committedFreezeFileSha256") == pre_sha
        )
        if valid:
            validate_git_commit_anchor(cast(str, collision_anchor))
            validate_pre_outcome_git_ref(cast(str, collision_ref))
    elif evidence == "INVALID_EVIDENCE_TERMINAL":
        valid = (
            chain_size >= 2
            and verdict == "UNMEASURED"
            and holdout_status
            == ("OPENED_AFTER_SEAL" if holdout_marker is not None else "UNOPENED")
        )
    elif evidence == "VALID_MEASURED_DEVELOPMENT_GATE_FAILURE":
        valid = (
            chain_size == 3
            and selected_trial_id is not None
            and selected_gate is not None
            and selected_gate.get("pass") is False
            and verdict == "NO_GO"
            and holdout_status == "UNOPENED"
            and reason["code"] == "DEVELOPMENT_CHAMPION_GATE_FAILED"
            and result.get("developmentChampionTrialId") == selected_trial_id
            and result.get("developmentGate") == selected_gate
        )
    elif evidence in (
        "VALID_MEASURED_HOLDOUT_GATE_FAILURE",
        "VALID_ALL_PUBLIC_PROXY_GATES_PASS_ACCOUNT_TRUTH_UNKNOWN",
    ):
        holdout_gate_result = result.get("holdoutGate")
        expected_pass = evidence == "VALID_ALL_PUBLIC_PROXY_GATES_PASS_ACCOUNT_TRUTH_UNKNOWN"
        holdout_document = result.get("holdout")
        if selected_trial_id is None or not isinstance(holdout_document, dict):
            raise ContractError("HOLDOUT_SIMULATION_MISSING", repr(selected_trial_id))
        development_start = parse_utc_ms(protocol["calendar"]["development"]["startInclusive"])
        holdout_start = parse_utc_ms(protocol["calendar"]["holdout"]["startInclusive"])
        holdout_end = parse_utc_ms(protocol["calendar"]["holdout"]["endExclusive"])
        authenticated_holdout = validate_simulation_artifact(
            holdout_document,
            trial=trial_contracts[selected_trial_id],
            phase="holdout",
            phase_start_ms=holdout_start,
            phase_end_ms=holdout_end,
            index_origin_ms=development_start,
            protocol=protocol,
        )
        holdout_statistics = synchronous_bootstrap(
            (statistics_result(authenticated_holdout),),
            protocol,
        )
        expected_lower_bound = holdout_statistics["lowerBounds"][selected_trial_id]
        reported_lower_bound = artifact_decimal(
            result.get("holdoutStressDailyBlockLowerBoundMeanReturn"),
            "holdoutStressDailyBlockLowerBoundMeanReturn",
        )
        if reported_lower_bound != expected_lower_bound:
            raise ContractError(
                "HOLDOUT_STATISTICS_RECOMPUTATION_INVALID",
                selected_trial_id,
            )
        expected_holdout_gate = authenticated_holdout_gate(
            authenticated_holdout,
            expected_lower_bound,
            protocol,
        )
        if holdout_gate_result != expected_holdout_gate:
            raise ContractError("HOLDOUT_GATE_RECOMPUTATION_INVALID", selected_trial_id)
        valid = (
            chain_size == 5
            and expected_holdout_gate["pass"] is expected_pass
            and verdict == ("UNMEASURED" if expected_pass else "NO_GO")
            and holdout_status == "OPENED_ONCE_CHAMPION_ONLY"
            and result.get("developmentChampionTrialId") == selected_trial_id
            and reason["code"]
            == (
                "PUBLIC_PROXY_PASS_ACCOUNT_EFFECTIVE_PROFITABILITY_UNKNOWN"
                if expected_pass
                else "HOLDOUT_GATE_FAILED"
            )
        )
    else:
        raise ContractError("RESULT_EVIDENCE_STATUS_INVALID", repr(evidence))
    if not valid:
        raise ContractError(
            "RESULT_LIFECYCLE_SEMANTICS_INVALID",
            f"{evidence}/{verdict}/{holdout_status}",
        )


def authenticate_report(
    state_dir: Path,
    *,
    require_committed_packet: bool = True,
) -> dict[str, Any]:
    protocol, _sources, hashes = load_frozen_bundle()
    state_root = assert_state_root_safe(state_dir, protocol)
    pre_freeze = verify_pre_freeze(state_root, protocol, hashes)
    result = verify_artifact(load_json(state_root / RESULT_NAME), "S1PResultCandidateV1")
    chain = result.get("artifactChainFileSha256")
    if not isinstance(chain, dict):
        raise ContractError("RESULT_CHAIN_INVALID", "not an object")
    expected_chain = artifact_chain(
        state_root,
        (
            PRE_FREEZE_NAME,
            RUN_MARKER_NAME,
            DEVELOPMENT_RESULT_NAME,
            CHAMPION_SEAL_NAME,
            HOLDOUT_MARKER_NAME,
        ),
    )
    if chain != expected_chain:
        raise ContractError(
            "RESULT_CHAIN_MEMBERSHIP_MISMATCH",
            f"{chain!r} != {expected_chain!r}",
        )
    documents: dict[str, dict[str, Any]] = {}
    for name, expected_sha in chain.items():
        if name not in ARTIFACT_SCHEMAS or name == RESULT_NAME:
            raise ContractError("RESULT_CHAIN_NAME_INVALID", name)
        path = state_root / name
        actual_sha = sha256_file(path)
        if actual_sha != expected_sha:
            raise ContractError(
                "RESULT_CHAIN_SHA_MISMATCH",
                f"{name}: {actual_sha} != {expected_sha}",
            )
        documents[name] = verify_artifact(load_json(path), ARTIFACT_SCHEMAS[name])
    pre_sha = chain.get(PRE_FREEZE_NAME)
    if pre_sha is None:
        raise ContractError("RESULT_CHAIN_FREEZE_MISSING", PRE_FREEZE_NAME)
    if RUN_MARKER_NAME in documents and (
        documents[RUN_MARKER_NAME].get("preOutcomeFreezeFileSha256") != pre_sha
    ):
        raise ContractError(
            "RUN_MARKER_FREEZE_LINK_INVALID",
            "report-chain run marker link",
        )
    if DEVELOPMENT_RESULT_NAME in documents and (
        documents[DEVELOPMENT_RESULT_NAME].get("runMarkerFileSha256") != chain.get(RUN_MARKER_NAME)
    ):
        raise ContractError(
            "DEVELOPMENT_RUN_LINK_INVALID",
            "development result does not bind run marker",
        )
    if CHAMPION_SEAL_NAME in documents and (
        documents[CHAMPION_SEAL_NAME].get("developmentResultFileSha256")
        != chain.get(DEVELOPMENT_RESULT_NAME)
    ):
        raise ContractError(
            "CHAMPION_DEVELOPMENT_LINK_INVALID",
            "champion seal does not bind development result",
        )
    if HOLDOUT_MARKER_NAME in documents and (
        documents[HOLDOUT_MARKER_NAME].get("championSealFileSha256")
        != chain.get(CHAMPION_SEAL_NAME)
    ):
        raise ContractError(
            "HOLDOUT_CHAMPION_LINK_INVALID",
            "holdout marker does not bind champion seal",
        )
    verdict = result.get("researchVerdict")
    if verdict not in ("NO_GO", "UNMEASURED"):
        raise ContractError("RESULT_VERDICT_INVALID", repr(verdict))
    truth = result.get("truthBoundary")
    if not isinstance(truth, dict):
        raise ContractError("RESULT_TRUTH_BOUNDARY_INVALID", "missing")
    required_truth = {
        "accountEffectiveSpotCommission": "UNKNOWN",
        "accountEffectiveUsdMCommission": "UNKNOWN",
        "historicalPromotionTaxAndDiscountState": "UNKNOWN",
        "frozenFees": "RESEARCH_PROXY_ONLY",
        "capacityProxy": "CAUSAL_PRIOR_COMPLETE_QUOTE_VOLUME_ONLY",
        "executableCapacity": "UNMEASURED",
        "productAuthority": "NONE",
        "capitalVerdict": "NO_GO",
        "executionAuthority": "NONE",
    }
    if truth != required_truth:
        raise ContractError(
            "RESULT_TRUTH_BOUNDARY_MISMATCH",
            f"{truth!r} != {required_truth!r}",
        )
    if result.get("postRunRepairOrRerun") != "FORBIDDEN":
        raise ContractError(
            "RESULT_RERUN_BOUNDARY_INVALID",
            repr(result.get("postRunRepairOrRerun")),
        )
    validate_lifecycle_semantics(
        protocol,
        pre_freeze,
        result,
        chain,
        documents,
    )
    pre_outcome_git_anchor = (
        documents[RUN_MARKER_NAME]["preOutcomeGitAnchor"]
        if RUN_MARKER_NAME in documents
        else result["preOutcomeGitAnchor"]
    )
    packet = (
        verify_committed_packet(state_root, result)
        if require_committed_packet
        else {
            "checksumManifestStatus": "NOT_REQUESTED",
            "checksumManifestFileCount": 0,
        }
    )
    stored_git_proof = (
        documents[RUN_MARKER_NAME]["gitAnchorProof"]
        if RUN_MARKER_NAME in documents
        else result["gitAnchorProof"]
    )
    pre_outcome_git_ref = (
        documents[RUN_MARKER_NAME]["preOutcomeGitRef"]
        if RUN_MARKER_NAME in documents
        else result["preOutcomeGitRef"]
    )
    git_authentication: dict[str, Any]
    if require_committed_packet:
        current_git_proof = verify_git_anchor(
            protocol,
            pre_freeze,
            state_root,
            pre_outcome_git_anchor,
            pre_outcome_git_ref,
            require_current_head=False,
        )
        stable_keys = (
            "schema",
            "anchorCommit",
            "preservedRef",
            "canonicalParent",
            "originUrl",
            "anchorTreeBindings",
            "committedFreezeFileSha256",
            "worktreeClean",
            "networkUsed",
        )
        for key in stable_keys:
            if current_git_proof.get(key) != stored_git_proof.get(key):
                raise ContractError(
                    "GIT_ANCHOR_REAUTHENTICATION_MISMATCH",
                    f"{key}: {current_git_proof.get(key)!r} != {stored_git_proof.get(key)!r}",
                )
        git_authentication = {
            "gitAnchorStatus": "PRESERVED_AND_REAUTHENTICATED",
            "preOutcomeGitRef": pre_outcome_git_ref,
            "finalHead": current_git_proof["currentHeadAtVerification"],
        }
    else:
        git_authentication = {
            "gitAnchorStatus": "NOT_REQUESTED",
            "preOutcomeGitRef": pre_outcome_git_ref,
        }
    return {
        "schema": "S1PReportAuthenticationV1",
        "status": "AUTHENTIC",
        "protocolId": protocol["protocolId"],
        "preOutcomeFreezeArtifactSha256": pre_freeze["artifactSha256"],
        "resultArtifactSha256": result["artifactSha256"],
        "resultFileSha256": sha256_file(state_root / RESULT_NAME),
        "preOutcomeGitAnchor": pre_outcome_git_anchor,
        "researchVerdict": verdict,
        "capitalVerdict": "NO_GO",
        "archiveBodiesOpenedDuringAuthentication": False,
        "networkUsed": False,
        **packet,
        **git_authentication,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Deterministic network-free S-1P research evaluator"
    )
    subcommands = parser.add_subparsers(dest="command", required=True)
    freeze = subcommands.add_parser(
        "freeze-candidate",
        help="bind frozen inputs and archive hashes without opening ZIP members",
    )
    freeze.add_argument("--state-dir", type=Path, required=True)
    freeze.add_argument(
        "--vg9-protocol",
        type=Path,
        default=DEFAULT_VG9_PROTOCOL_PATH,
        help="final read-only V-G9 protocol used by the collision gate",
    )
    run = subcommands.add_parser(
        "run", help="consume the sole run and evaluate development before holdout"
    )
    run.add_argument("--state-dir", type=Path, required=True)
    run.add_argument(
        "--pre-outcome-git-anchor",
        required=True,
        help="clean immutable pre-outcome commit containing the exact tracked freeze",
    )
    run.add_argument(
        "--pre-outcome-git-ref",
        required=True,
        help="preserved local s1p-pre-outcome tag resolving to the anchor commit",
    )
    authenticate = subcommands.add_parser(
        "authenticate-report",
        help="authenticate the result chain without opening archive members",
    )
    authenticate.add_argument("--state-dir", type=Path, required=True)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = build_parser().parse_args(argv)
    try:
        if arguments.command == "freeze-candidate":
            output = freeze_candidate(arguments.state_dir, arguments.vg9_protocol)
        elif arguments.command == "run":
            output = run_experiment(
                arguments.state_dir,
                arguments.pre_outcome_git_anchor,
                arguments.pre_outcome_git_ref,
            )
        elif arguments.command == "authenticate-report":
            output = authenticate_report(arguments.state_dir)
        else:
            raise ContractError("COMMAND_INVALID", repr(arguments.command))
    except S1PError as exc:
        print(
            json.dumps(
                {"status": "REFUSED", "code": exc.code, "detail": exc.detail},
                sort_keys=True,
            ),
            file=sys.stderr,
        )
        return 2
    print(json.dumps(output, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
