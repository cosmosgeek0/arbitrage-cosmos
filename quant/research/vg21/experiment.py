"""Sealed Binance-public V-G21 residual-volume-beta experiment.

The lifecycle is deliberately fail closed:

* ``inventory`` authenticates stored objects without opening ZIP members;
* ``freeze`` binds protocol, source inventory, evaluator, tests, and trial family;
* ``run`` consumes the only run authority before the first ZIP member is opened;
* a custody or causality failure emits null economics and can never be repaired by
  rerunning this packet.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import itertools
import json
import math
import random
import statistics
import tempfile
import zipfile
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal, getcontext
from pathlib import Path
from typing import Any, cast

getcontext().prec = 50

PACKET = Path(__file__).resolve().parent
PROTOCOL_PATH = PACKET / "protocol.v1.json"
SOURCE_MANIFEST_PATH = PACKET / "source-manifest.v1.json"
FREEZE_PATH = PACKET / "freeze.v1.json"
MARKER_PATH = PACKET / "run-marker.v1.json"
SELECTION_PATH = PACKET / "selection.v1.json"
HOLDOUT_OPEN_PATH = PACKET / "holdout-open.v1.json"
RESULT_PATH = PACKET / "result.v1.json"
SHA256SUMS_PATH = PACKET / "SHA256SUMS"

DAY_US = 86_400_000_000
ZERO = Decimal(0)
ONE = Decimal(1)
INITIAL_USD = Decimal("1000")
FEE = Decimal("0.0010")
BASE_ADVERSE = Decimal("0.0010")
STRESS_ADVERSE = Decimal("0.0025")
SEVERE_ADVERSE = Decimal("0.0050")
BASE_PARTICIPATION = Decimal("0.0001")
STRESS_PARTICIPATION = Decimal("0.00005")
MIN_ADV = Decimal("5000000")
SCORE_QUANTUM = Decimal("0.000000000001")
BOOTSTRAP_REPLICATES = 4096
JsonObject = dict[str, Any]


class ContractError(RuntimeError):
    """A frozen lifecycle, custody, or causality contract failed."""


class MeasurementError(RuntimeError):
    """The preregistered estimate is not measurable from admitted evidence."""


@dataclass(frozen=True, slots=True)
class Bar:
    day: date
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    quote_volume: Decimal


@dataclass(frozen=True, slots=True)
class Trial:
    trial_id: str
    lookback: int
    top_fraction: Decimal
    hold_days: int


@dataclass(frozen=True, slots=True)
class ScoredAsset:
    symbol: str
    score: Decimal


@dataclass(slots=True)
class Position:
    symbol: str
    allocation: Decimal
    raw_entry: Decimal
    quantity: Decimal
    exit_day: date
    cohort_id: str


@dataclass(slots=True)
class Sleeve:
    cash: Decimal
    positions: list[Position] = field(default_factory=list)


@dataclass(slots=True)
class Simulation:
    trial: Trial
    label: str
    adverse: Decimal
    participation: Decimal
    daily_nav: list[tuple[date, Decimal]]
    daily_returns: list[tuple[date, Decimal]]
    net_usd: Decimal
    gross_pnl: Decimal
    fee_cost: Decimal
    adverse_cost: Decimal
    max_drawdown: Decimal
    valid_formation_days: int
    closed_cohorts: int
    round_trips: int
    distinct_assets: set[str]
    active_months: int
    positive_months: int
    capacity_proxy_usd: Decimal | None
    top_asset_gross_profit_share: Decimal
    top_five_cohort_gross_profit_share: Decimal


def utc_now() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def canonical_bytes(value: object) -> bytes:
    return (
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
        + b"\n"
    )


def load_json(path: Path) -> JsonObject:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ContractError(f"{path.name} must contain one JSON object")
    return cast(JsonObject, value)


def write_json_once(path: Path, value: object) -> None:
    if path.exists():
        raise ContractError(f"refusing to overwrite {path.name}")
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = canonical_bytes(value)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as handle:
        temporary = Path(handle.name)
        handle.write(raw)
        handle.flush()
    temporary.replace(path)


def sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while block := handle.read(1 << 20):
            digest.update(block)
    return digest.hexdigest()


def exact(value: Decimal, places: int = 12) -> str:
    return format(value.quantize(Decimal(1).scaleb(-places)), "f")


def days(start: date, end: date) -> Iterable[date]:
    current = start
    while current <= end:
        yield current
        current += timedelta(days=1)


def protocol() -> JsonObject:
    value = load_json(PROTOCOL_PATH)
    if value.get("version") != "VG21ProtocolV1":
        raise ContractError("unexpected protocol version")
    return value


def trial_family() -> tuple[Trial, ...]:
    values: list[Trial] = []
    for lookback in (30, 60):
        for fraction_text in ("0.10", "0.20"):
            for hold in (1, 3, 5):
                fraction = Decimal(fraction_text)
                values.append(
                    Trial(
                        f"VG21-L{lookback:02d}-Q{int(fraction * 100):02d}-H{hold}",
                        lookback,
                        fraction,
                        hold,
                    )
                )
    return tuple(values)


def verify_trial_ledger() -> None:
    ledger = load_json(PACKET / "trial-ledger.v1.json")
    rows = cast(list[JsonObject], ledger.get("trials"))
    expected = [trial.trial_id for trial in trial_family()]
    actual = [cast(str, row.get("trialId")) for row in rows]
    if ledger.get("attemptedCount") != 12 or actual != expected:
        raise ContractError("trial ledger differs from the frozen 12-trial family")


def verify_sidecar(sidecar: bytes, archive_name: str, archive_sha: str) -> None:
    try:
        fields = sidecar.decode("ascii").strip().split()
    except UnicodeDecodeError as exc:
        raise ContractError(f"non-ASCII sidecar: {archive_name}") from exc
    if len(fields) != 2:
        raise ContractError(f"invalid checksum grammar: {archive_name}")
    if fields[0].lower() != archive_sha:
        raise ContractError(f"advertised checksum mismatch: {archive_name}")
    if fields[1].lstrip("*") != archive_name:
        raise ContractError(f"checksum filename mismatch: {archive_name}")


def inventory(state_root: Path) -> JsonObject:
    if any(path.exists() for path in (SOURCE_MANIFEST_PATH, FREEZE_PATH, MARKER_PATH)):
        raise ContractError("inventory is allowed exactly once before freeze")
    proto = protocol()
    data = cast(JsonObject, proto["data"])
    if state_root.resolve() != Path(cast(str, data["sourceRoot"])).resolve():
        raise ContractError("state root differs from protocol")

    acquisition_path = state_root / "acquisition-manifest.v1.json"
    discovery_path = state_root / "discovery.v1.json"
    if sha256_file(acquisition_path) != data["sourceAcquisitionManifestSha256"]:
        raise ContractError("acquisition manifest digest mismatch")
    if sha256_file(discovery_path) != data["discoverySha256"]:
        raise ContractError("discovery digest mismatch")

    acquisition = load_json(acquisition_path)
    discovery = load_json(discovery_path)
    universe_obj = cast(JsonObject, discovery["universe"])
    symbols = cast(list[str], universe_obj["symbols"])
    if universe_obj.get("sha256") != data["universeSha256"]:
        raise ContractError("discovery universe digest mismatch")
    if symbols != sorted(set(symbols)):
        raise ContractError("discovery universe must be sorted and unique")

    months = set(cast(list[str], data["archiveMonths"]))
    universe = set(symbols)
    records: list[JsonObject] = []
    seen: set[tuple[str, str]] = set()
    for source in cast(list[JsonObject], acquisition["artifactPairs"]):
        symbol = cast(str, source["symbol"])
        month = cast(str, source["month"])
        if symbol not in universe or month not in months:
            continue
        identity = (symbol, month)
        if identity in seen:
            raise ContractError(f"duplicate acquisition record: {symbol} {month}")
        seen.add(identity)
        archive_name = f"{symbol}-1d-{month}.zip"
        pair_dir = state_root / "archives" / symbol / month
        archive_path = pair_dir / archive_name
        sidecar_path = pair_dir / f"{archive_name}.CHECKSUM"
        pair_path = pair_dir / "pair.v1.json"
        archive_raw = archive_path.read_bytes()
        sidecar_raw = sidecar_path.read_bytes()
        pair_raw = pair_path.read_bytes()
        archive_sha = sha256_bytes(archive_raw)
        sidecar_sha = sha256_bytes(sidecar_raw)
        if archive_sha != source["zipSha256"] or len(archive_raw) != source["zipBytes"]:
            raise ContractError(f"archive custody mismatch: {symbol} {month}")
        if sidecar_sha != source["checksumSha256"] or len(sidecar_raw) != source["checksumBytes"]:
            raise ContractError(f"sidecar custody mismatch: {symbol} {month}")
        verify_sidecar(sidecar_raw, archive_name, archive_sha)
        pair = json.loads(pair_raw)
        if not isinstance(pair, dict):
            raise ContractError(f"invalid pair record: {symbol} {month}")
        if (
            pair.get("symbol") != symbol
            or pair.get("month") != month
            or pair.get("zipSha256") != archive_sha
            or pair.get("checksumSha256") != sidecar_sha
        ):
            raise ContractError(f"pair binding mismatch: {symbol} {month}")
        records.append(
            {
                "checksumBytes": len(sidecar_raw),
                "checksumPath": str(sidecar_path),
                "checksumSha256": sidecar_sha,
                "checksumUrl": f"https://data.binance.vision/{source['checksumKey']}",
                "month": month,
                "pairBytes": len(pair_raw),
                "pairPath": str(pair_path),
                "pairSha256": sha256_bytes(pair_raw),
                "symbol": symbol,
                "zipBytes": len(archive_raw),
                "zipPath": str(archive_path),
                "zipSha256": archive_sha,
                "zipUrl": f"https://data.binance.vision/{source['zipKey']}",
            }
        )
    records.sort(key=lambda row: (cast(str, row["symbol"]), cast(str, row["month"])))
    if not records:
        raise ContractError("no admitted source records")
    manifest = {
        "schema": "VG21SourceManifestV1",
        "archiveBodiesOpened": False,
        "authenticatedAtUtc": utc_now(),
        "sourceRoot": str(state_root.resolve()),
        "acquisitionManifestSha256": data["sourceAcquisitionManifestSha256"],
        "discoverySha256": data["discoverySha256"],
        "universeSha256": data["universeSha256"],
        "universeCount": len(symbols),
        "recordCount": len(records),
        "recordRowsSha256": sha256_bytes(canonical_bytes(records)),
        "monthCounts": {
            month: sum(1 for row in records if row["month"] == month) for month in sorted(months)
        },
        "records": records,
    }
    write_json_once(SOURCE_MANIFEST_PATH, manifest)
    return manifest


def freeze() -> JsonObject:
    if FREEZE_PATH.exists() or MARKER_PATH.exists():
        raise ContractError("freeze authority is no longer available")
    if not SOURCE_MANIFEST_PATH.exists():
        raise ContractError("source inventory must exist before freeze")
    verify_trial_ledger()
    manifest = load_json(SOURCE_MANIFEST_PATH)
    if manifest.get("archiveBodiesOpened") is not False:
        raise ContractError("source inventory must predate archive access")
    bindings = {
        "collisionAuditSha256": sha256_file(PACKET / "collision-audit.v1.json"),
        "evaluatorSha256": sha256_file(Path(__file__).resolve()),
        "officialSourceResearchSha256": sha256_file(PACKET / "OFFICIAL_SOURCE_RESEARCH.md"),
        "protocolSha256": sha256_file(PROTOCOL_PATH),
        "readmeSha256": sha256_file(PACKET / "README.md"),
        "seedTableSha256": sha256_file(PACKET / "seed-table.v1.json"),
        "sourceManifestSha256": sha256_file(SOURCE_MANIFEST_PATH),
        "testsSha256": sha256_file(PACKET / "test_experiment.py"),
        "trialLedgerSha256": sha256_file(PACKET / "trial-ledger.v1.json"),
    }
    receipt = {
        "schema": "VG21FreezeV1",
        "frozenAtUtc": utc_now(),
        "canonicalBase": protocol()["canonicalBase"],
        "runMaximumCount": 1,
        "holdoutMaximumOpenCount": 1,
        "archiveBodiesOpenedBeforeFreeze": False,
        "globalVolumeFamilyHoldoutStatus": "NOT_CERTIFIED_SHARED_REUSE_RISK",
        **bindings,
    }
    write_json_once(FREEZE_PATH, receipt)
    return receipt


def verify_freeze() -> JsonObject:
    receipt = load_json(FREEZE_PATH)
    if receipt.get("schema") != "VG21FreezeV1":
        raise ContractError("unexpected freeze schema")
    expected = {
        "collisionAuditSha256": PACKET / "collision-audit.v1.json",
        "evaluatorSha256": Path(__file__).resolve(),
        "officialSourceResearchSha256": PACKET / "OFFICIAL_SOURCE_RESEARCH.md",
        "protocolSha256": PROTOCOL_PATH,
        "readmeSha256": PACKET / "README.md",
        "seedTableSha256": PACKET / "seed-table.v1.json",
        "sourceManifestSha256": SOURCE_MANIFEST_PATH,
        "testsSha256": PACKET / "test_experiment.py",
        "trialLedgerSha256": PACKET / "trial-ledger.v1.json",
    }
    for field_name, path in expected.items():
        if receipt.get(field_name) != sha256_file(path):
            raise ContractError(f"freeze binding mismatch: {field_name}")
    if receipt.get("runMaximumCount") != 1 or receipt.get("holdoutMaximumOpenCount") != 1:
        raise ContractError("freeze run authority mismatch")
    return receipt


def manifest_records(months: set[str]) -> tuple[JsonObject, ...]:
    manifest = load_json(SOURCE_MANIFEST_PATH)
    if (
        manifest.get("schema") != "VG21SourceManifestV1"
        or manifest.get("archiveBodiesOpened") is not False
    ):
        raise ContractError("invalid pre-open source manifest")
    records = tuple(
        row for row in cast(list[JsonObject], manifest["records"]) if row["month"] in months
    )
    if not records:
        raise ContractError("partition has no admitted archive records")
    return records


def parse_archive(record: JsonObject) -> tuple[list[Bar], JsonObject]:
    symbol = cast(str, record["symbol"])
    month = cast(str, record["month"])
    raw = Path(cast(str, record["zipPath"])).read_bytes()
    if len(raw) != record["zipBytes"] or sha256_bytes(raw) != record["zipSha256"]:
        raise MeasurementError(f"ARCHIVE_BYTES_CHANGED:{symbol}:{month}")
    expected_member = f"{symbol}-1d-{month}.csv"
    with zipfile.ZipFile(io.BytesIO(raw), "r") as archive:
        members = [member for member in archive.infolist() if not member.is_dir()]
        if len(members) != 1 or members[0].filename != expected_member:
            raise MeasurementError(f"ZIP_MEMBER_SHAPE_INVALID:{symbol}:{month}")
        csv_raw = archive.read(members[0])
    try:
        text = csv_raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise MeasurementError(f"CSV_NOT_UTF8:{symbol}:{month}") from exc

    parsed: list[Bar] = []
    previous: Bar | None = None
    raw_rows = 0
    partial_rows = 0
    for row in csv.reader(io.StringIO(text)):
        raw_rows += 1
        if len(row) != 12:
            raise MeasurementError(f"KLINE_FIELD_COUNT_INVALID:{symbol}:{month}")
        try:
            open_us = int(row[0])
            close_us = int(row[6])
            bar = Bar(
                datetime.fromtimestamp(open_us / 1_000_000, tz=UTC).date(),
                Decimal(row[1]),
                Decimal(row[2]),
                Decimal(row[3]),
                Decimal(row[4]),
                Decimal(row[7]),
            )
        except (ArithmeticError, ValueError) as exc:
            raise MeasurementError(f"KLINE_SCALAR_INVALID:{symbol}:{month}") from exc
        if open_us < 1_000_000_000_000_000:
            raise MeasurementError(f"TIMESTAMP_UNIT_INVALID:{symbol}:{month}")
        if open_us % DAY_US != 0:
            raise MeasurementError(f"OPEN_NOT_UTC_MIDNIGHT:{symbol}:{bar.day.isoformat()}")
        if close_us != open_us + DAY_US - 1:
            if open_us <= close_us < open_us + DAY_US - 1:
                partial_rows += 1
                continue
            raise MeasurementError(f"CLOSE_BOUNDARY_INVALID:{symbol}:{bar.day.isoformat()}")
        if bar.day.strftime("%Y-%m") != month:
            raise MeasurementError(f"ROW_MONTH_MISMATCH:{symbol}:{bar.day.isoformat()}")
        if (
            min(bar.open, bar.high, bar.low, bar.close) <= ZERO
            or bar.quote_volume <= ZERO
            or bar.high < max(bar.open, bar.close)
            or bar.low > min(bar.open, bar.close)
        ):
            raise MeasurementError(f"OHLCV_INVARIANT_INVALID:{symbol}:{bar.day.isoformat()}")
        if previous is not None and bar.day <= previous.day:
            duplicate_kind = "IDENTICAL" if bar == previous else "CONFLICTING"
            raise MeasurementError(
                f"DUPLICATE_{duplicate_kind}_DAILY_BAR:{symbol}:{bar.day.isoformat()}"
            )
        parsed.append(bar)
        previous = bar
    if raw_rows == 0:
        raise MeasurementError(f"EMPTY_ARCHIVE:{symbol}:{month}")
    return parsed, {
        "symbol": symbol,
        "month": month,
        "zipSha256": record["zipSha256"],
        "memberSha256": sha256_bytes(csv_raw),
        "memberBytes": len(csv_raw),
        "rawRowCount": raw_rows,
        "validRowCount": len(parsed),
        "partialRowCount": partial_rows,
        "firstValidDay": None if not parsed else parsed[0].day.isoformat(),
        "lastValidDay": None if not parsed else parsed[-1].day.isoformat(),
    }


def load_bars(months: set[str]) -> tuple[dict[str, dict[date, Bar]], list[JsonObject]]:
    bars: dict[str, dict[date, Bar]] = {}
    summaries: list[JsonObject] = []
    for record in manifest_records(months):
        parsed, summary = parse_archive(record)
        symbol_rows = bars.setdefault(cast(str, record["symbol"]), {})
        for bar in parsed:
            prior = symbol_rows.get(bar.day)
            if prior is not None:
                duplicate_kind = "IDENTICAL" if prior == bar else "CONFLICTING"
                raise MeasurementError(
                    f"DUPLICATE_{duplicate_kind}_DAILY_BAR:{record['symbol']}:{bar.day.isoformat()}"
                )
            symbol_rows[bar.day] = bar
        summaries.append(summary)
    summaries.sort(key=lambda row: (cast(str, row["symbol"]), cast(str, row["month"])))
    return bars, summaries


def median_excluding(
    ordered: tuple[tuple[Decimal, str], ...],
    positions: dict[str, int],
    excluded: str,
) -> Decimal | None:
    """Median after one named observation is removed, without rebuilding the list."""

    remove_at = positions.get(excluded)
    remaining = len(ordered) - (1 if remove_at is not None else 0)
    if remaining < 1:
        return None

    def value_at(index: int) -> Decimal:
        source = index
        if remove_at is not None and source >= remove_at:
            source += 1
        return ordered[source][0]

    middle = remaining // 2
    if remaining % 2:
        return value_at(middle)
    return (value_at(middle - 1) + value_at(middle)) / 2


class FeatureEngine:
    """Causal point-in-time volume features with cached leave-one-out medians."""

    def __init__(self, bars: dict[str, dict[date, Bar]]) -> None:
        self.bars = bars
        self._surprise: dict[tuple[str, date], Decimal | None] = {}
        self._factor_rows: dict[date, tuple[tuple[tuple[Decimal, str], ...], dict[str, int]]] = {}
        self._raw_residual: dict[tuple[str, date, int], Decimal | None] = {}
        self._scores: dict[tuple[date, int], tuple[tuple[ScoredAsset, ...], int]] = {}

    def surprise(self, symbol: str, current: date) -> Decimal | None:
        key = (symbol, current)
        if key in self._surprise:
            return self._surprise[key]
        series = self.bars[symbol]
        required = [current - timedelta(days=offset) for offset in range(60, -1, -1)]
        if any(day not in series for day in required):
            self._surprise[key] = None
            return None
        prior_30 = [
            series[current - timedelta(days=offset)].quote_volume for offset in range(30, 0, -1)
        ]
        if statistics.median(prior_30) < MIN_ADV:
            self._surprise[key] = None
            return None
        history = [
            series[current - timedelta(days=offset)].quote_volume.ln()
            for offset in range(20, 0, -1)
        ]
        value = series[current].quote_volume.ln() - statistics.median(history)
        self._surprise[key] = value
        return value

    def factor_rows(self, current: date) -> tuple[tuple[tuple[Decimal, str], ...], dict[str, int]]:
        cached = self._factor_rows.get(current)
        if cached is not None:
            return cached
        rows = tuple(
            sorted(
                (
                    (value, symbol)
                    for symbol in self.bars
                    if (value := self.surprise(symbol, current)) is not None
                ),
                key=lambda item: (item[0], item[1].encode()),
            )
        )
        positions = {symbol: index for index, (_, symbol) in enumerate(rows)}
        result = (rows, positions)
        self._factor_rows[current] = result
        return result

    def factor(self, current: date, excluded: str) -> Decimal | None:
        ordered, positions = self.factor_rows(current)
        remaining = len(ordered) - (1 if excluded in positions else 0)
        if remaining < 30:
            return None
        return median_excluding(ordered, positions, excluded)

    def raw_residual(self, symbol: str, current: date, lookback: int) -> Decimal | None:
        key = (symbol, current, lookback)
        if key in self._raw_residual:
            return self._raw_residual[key]
        current_surprise = self.surprise(symbol, current)
        current_factor = self.factor(current - timedelta(days=1), symbol)
        if current_surprise is None or current_factor is None:
            self._raw_residual[key] = None
            return None
        x_values: list[Decimal] = []
        y_values: list[Decimal] = []
        for offset in range(lookback, 0, -1):
            dependent_day = current - timedelta(days=offset)
            dependent = self.surprise(symbol, dependent_day)
            lagged_factor = self.factor(dependent_day - timedelta(days=1), symbol)
            if dependent is None or lagged_factor is None:
                self._raw_residual[key] = None
                return None
            y_values.append(dependent)
            x_values.append(lagged_factor)
        x_mean = sum(x_values, ZERO) / Decimal(len(x_values))
        y_mean = sum(y_values, ZERO) / Decimal(len(y_values))
        variance = sum(((value - x_mean) ** 2 for value in x_values), ZERO)
        if variance == ZERO:
            self._raw_residual[key] = None
            return None
        beta = (
            sum(
                (
                    (x_value - x_mean) * (y_value - y_mean)
                    for x_value, y_value in zip(x_values, y_values, strict=True)
                ),
                ZERO,
            )
            / variance
        )
        alpha = y_mean - beta * x_mean
        value = current_surprise - alpha - beta * current_factor
        self._raw_residual[key] = value
        return value

    def residual(self, symbol: str, current: date, lookback: int) -> Decimal | None:
        raw = self.raw_residual(symbol, current, lookback)
        if raw is None:
            return None
        prior: list[Decimal] = []
        for offset in range(20, 0, -1):
            value = self.raw_residual(symbol, current - timedelta(days=offset), lookback)
            if value is None:
                return None
            prior.append(value)
        center = statistics.median(prior)
        scale = statistics.median(abs(value - center) for value in prior)
        if scale <= ZERO:
            return None
        return (raw / scale).quantize(SCORE_QUANTUM)

    def ranked(self, current: date, lookback: int) -> tuple[tuple[ScoredAsset, ...], int]:
        key = (current, lookback)
        cached = self._scores.get(key)
        if cached is not None:
            return cached
        values: list[ScoredAsset] = []
        eligible = 0
        for symbol in sorted(self.bars):
            residual = self.residual(symbol, current, lookback)
            if residual is None:
                continue
            eligible += 1
            if residual > ZERO:
                values.append(ScoredAsset(symbol, residual))
        values.sort(key=lambda item: (-item.score, item.symbol.encode()))
        result = (tuple(values), eligible)
        self._scores[key] = result
        return result

    def select(self, current: date, trial: Trial) -> tuple[tuple[ScoredAsset, ...], int]:
        ranked, eligible = self.ranked(current, trial.lookback)
        target = max(3, math.floor(float(trial.top_fraction) * eligible))
        if eligible < 30 or len(ranked) < target:
            return (), eligible
        return ranked[:target], eligible


def trailing_capacity(
    series: dict[date, Bar], information_day: date, participation: Decimal
) -> Decimal | None:
    window = [information_day - timedelta(days=offset) for offset in range(30, 0, -1)]
    if any(day not in series for day in window):
        return None
    volumes = [series[day].quote_volume for day in window]
    return statistics.median(volumes) * participation


def trade_values(
    allocation: Decimal,
    entry: Decimal,
    exit_price: Decimal,
    adverse: Decimal,
) -> tuple[Decimal, Decimal, Decimal, Decimal]:
    gross_final = allocation * exit_price / entry
    fee_only_final = gross_final * (ONE - FEE) * (ONE - FEE)
    actual_final = (
        allocation
        * (ONE - FEE)
        / (entry * (ONE + adverse))
        * exit_price
        * (ONE - adverse)
        * (ONE - FEE)
    )
    gross_pnl = gross_final - allocation
    fee_cost = gross_final - fee_only_final
    adverse_cost = fee_only_final - actual_final
    return actual_final, gross_pnl, fee_cost, adverse_cost


def _profit_share(profits: Sequence[Decimal], take: int) -> Decimal:
    positive = sorted((value for value in profits if value > ZERO), reverse=True)
    total = sum(positive, ZERO)
    if total == ZERO:
        return ZERO
    return sum(positive[:take], ZERO) / total


def simulate(
    engine: FeatureEngine,
    trial: Trial,
    signal_start: date,
    signal_end: date,
    *,
    label: str,
    adverse: Decimal,
    participation: Decimal,
) -> Simulation:
    bars = engine.bars
    sleeves = [Sleeve(INITIAL_USD / trial.hold_days) for _ in range(trial.hold_days)]
    daily_nav: list[tuple[date, Decimal]] = []
    daily_returns: list[tuple[date, Decimal]] = []
    gross_pnl = ZERO
    fee_cost = ZERO
    adverse_cost = ZERO
    prior_nav = INITIAL_USD
    peak_nav = INITIAL_USD
    max_drawdown = ZERO
    valid_formation_days = 0
    closed_cohorts = 0
    round_trips = 0
    distinct_assets: set[str] = set()
    asset_profits: dict[str, Decimal] = {}
    cohort_profits: dict[str, Decimal] = {}
    capacity_scales: list[Decimal] = []

    first_day = signal_start
    final_day = signal_end + timedelta(days=2 + trial.hold_days)
    for current in days(first_day, final_day):
        sleeve = sleeves[current.toordinal() % trial.hold_days]
        if sleeve.positions:
            if any(position.exit_day != current for position in sleeve.positions):
                raise ContractError("sleeve overlap exceeds frozen no-leverage schedule")
            cohort_net = ZERO
            for position in sleeve.positions:
                exit_bar = bars.get(position.symbol, {}).get(current)
                if exit_bar is None:
                    raise MeasurementError(
                        f"MISSING_SUCCESSFUL_EXIT:{position.symbol}:{current.isoformat()}"
                    )
                actual, gross, fees, adverse_loss = trade_values(
                    position.allocation,
                    position.raw_entry,
                    exit_bar.open,
                    adverse,
                )
                sleeve.cash += actual
                gross_pnl += gross
                fee_cost += fees
                adverse_cost += adverse_loss
                net = actual - position.allocation
                cohort_net += net
                asset_profits[position.symbol] = asset_profits.get(position.symbol, ZERO) + gross
                round_trips += 1
                distinct_assets.add(position.symbol)
                exit_capacity = trailing_capacity(
                    bars[position.symbol],
                    current,
                    participation,
                )
                if exit_capacity is None:
                    raise MeasurementError(
                        f"EXIT_CAPACITY_LINEAGE_MISSING:{position.symbol}:{current.isoformat()}"
                    )
                capacity_scales.append(exit_capacity * INITIAL_USD / position.allocation)
            cohort_id = sleeve.positions[0].cohort_id
            cohort_profits[cohort_id] = cohort_net
            closed_cohorts += 1
            sleeve.positions.clear()

        signal_day = current - timedelta(days=2)
        if signal_start <= signal_day <= signal_end:
            selected, eligible = engine.select(signal_day, trial)
            if eligible >= 30:
                valid_formation_days += 1
            if selected:
                entry_rows = [bars.get(asset.symbol, {}).get(current) for asset in selected]
                if all(row is not None for row in entry_rows):
                    allocation = sleeve.cash / len(selected)
                    entry_capacities = [
                        trailing_capacity(bars[asset.symbol], signal_day, participation)
                        for asset in selected
                    ]
                    if any(value is None for value in entry_capacities):
                        raise MeasurementError(
                            f"ENTRY_CAPACITY_LINEAGE_MISSING:{signal_day.isoformat()}"
                        )
                    cohort_id = f"{trial.trial_id}:{signal_day.isoformat()}"
                    sleeve.cash = ZERO
                    for asset, entry_row, entry_capacity in zip(
                        selected, entry_rows, entry_capacities, strict=True
                    ):
                        assert entry_row is not None
                        assert entry_capacity is not None
                        quantity = allocation * (ONE - FEE) / (entry_row.open * (ONE + adverse))
                        sleeve.positions.append(
                            Position(
                                asset.symbol,
                                allocation,
                                entry_row.open,
                                quantity,
                                current + timedelta(days=trial.hold_days),
                                cohort_id,
                            )
                        )
                        capacity_scales.append(entry_capacity * INITIAL_USD / allocation)

        nav = sum((item.cash for item in sleeves), ZERO)
        for active in sleeves:
            for position in active.positions:
                current_bar = bars.get(position.symbol, {}).get(current)
                if current_bar is None:
                    raise MeasurementError(
                        f"MISSING_MARK_BAR:{position.symbol}:{current.isoformat()}"
                    )
                nav += position.quantity * current_bar.close * (ONE - adverse) * (ONE - FEE)
        daily_nav.append((current, nav))
        daily_returns.append((current, nav / prior_nav - ONE))
        prior_nav = nav
        peak_nav = max(peak_nav, nav)
        max_drawdown = max(max_drawdown, ONE - nav / peak_nav)

    month_returns: dict[str, Decimal] = {}
    for current, daily_return in daily_returns:
        key = current.strftime("%Y-%m")
        month_returns[key] = (ONE + month_returns.get(key, ZERO)) * (ONE + daily_return) - ONE
    active_months = sum(1 for value in month_returns.values() if value != ZERO)
    positive_months = sum(1 for value in month_returns.values() if value > ZERO)
    return Simulation(
        trial=trial,
        label=label,
        adverse=adverse,
        participation=participation,
        daily_nav=daily_nav,
        daily_returns=daily_returns,
        net_usd=prior_nav - INITIAL_USD,
        gross_pnl=gross_pnl,
        fee_cost=fee_cost,
        adverse_cost=adverse_cost,
        max_drawdown=max_drawdown,
        valid_formation_days=valid_formation_days,
        closed_cohorts=closed_cohorts,
        round_trips=round_trips,
        distinct_assets=distinct_assets,
        active_months=active_months,
        positive_months=positive_months,
        capacity_proxy_usd=None if not capacity_scales else min(capacity_scales),
        top_asset_gross_profit_share=_profit_share(list(asset_profits.values()), 1),
        top_five_cohort_gross_profit_share=_profit_share(list(cohort_profits.values()), 5),
    )


def bootstrap_means(
    values: Sequence[Decimal],
    *,
    block_days: int,
    seed: int,
    replicates: int = BOOTSTRAP_REPLICATES,
    centered: bool = False,
) -> list[Decimal]:
    if len(values) < block_days or block_days < 1:
        raise MeasurementError("BOOTSTRAP_SERIES_INSUFFICIENT")
    source = list(values)
    if centered:
        mean = statistics.mean(source)
        source = [value - mean for value in source]
    rng = random.Random(seed)
    count = len(source)
    blocks = math.ceil(count / block_days)
    result: list[Decimal] = []
    for _ in range(replicates):
        draw: list[Decimal] = []
        for _ in range(blocks):
            start = rng.randrange(count)
            draw.extend(source[(start + offset) % count] for offset in range(block_days))
        result.append(statistics.mean(draw[:count]))
    result.sort()
    return result


def empirical_lower(values: Sequence[Decimal], coverage: Decimal = Decimal("0.95")) -> Decimal:
    alpha = (ONE - coverage) / 2
    index = max(0, math.ceil(float(alpha) * len(values)) - 1)
    return sorted(values)[index]


def one_sided_p_value(observed: Decimal, centered_replicates: Sequence[Decimal]) -> Decimal:
    exceed = sum(1 for value in centered_replicates if value >= observed)
    return Decimal(exceed + 1) / Decimal(len(centered_replicates) + 1)


def holm_selected(p_values: dict[str, Decimal], alpha: Decimal) -> set[str]:
    ordered = sorted(p_values.items(), key=lambda item: (item[1], item[0]))
    selected: set[str] = set()
    total = len(ordered)
    for rank, (trial_id, value) in enumerate(ordered):
        if value <= alpha / Decimal(total - rank):
            selected.add(trial_id)
        else:
            break
    return selected


def pbo_cscv(block_scores: Sequence[Sequence[Decimal]]) -> JsonObject:
    trials = len(block_scores)
    blocks = len(block_scores[0]) if block_scores else 0
    if trials < 2 or blocks < 4 or blocks % 2:
        return {"status": "INVALID", "reason": "PBO_SHAPE_INVALID", "pbo": None}
    half = blocks // 2
    splits = 0
    underperform = 0
    for in_sample in itertools.combinations(range(blocks), half):
        out_sample = tuple(index for index in range(blocks) if index not in in_sample)
        in_scores = [statistics.mean([row[index] for index in in_sample]) for row in block_scores]
        champion = max(range(trials), key=lambda index: (in_scores[index], -index))
        out_scores = [statistics.mean([row[index] for index in out_sample]) for row in block_scores]
        if out_scores[champion] <= statistics.median(out_scores):
            underperform += 1
        splits += 1
    return {
        "status": "AVAILABLE",
        "reason": None,
        "splitCount": splits,
        "underperformCount": underperform,
        "pbo": exact(Decimal(underperform) / Decimal(splits)),
        "diagnosticOnly": True,
    }


def simulation_mapping(simulation: Simulation) -> JsonObject:
    return {
        "label": simulation.label,
        "trialId": simulation.trial.trial_id,
        "netUsdPer1000": exact(simulation.net_usd),
        "grossPnlUsd": exact(simulation.gross_pnl),
        "publicFeeScenarioCostUsd": exact(simulation.fee_cost),
        "adverseExecutionScenarioCostUsd": exact(simulation.adverse_cost),
        "accountEffectiveFee": "UNKNOWN",
        "maxDrawdown": exact(simulation.max_drawdown),
        "validFormationDays": simulation.valid_formation_days,
        "closedCohorts": simulation.closed_cohorts,
        "symbolRoundTrips": simulation.round_trips,
        "distinctAssets": len(simulation.distinct_assets),
        "activeMonths": simulation.active_months,
        "positiveMonths": simulation.positive_months,
        "capacityProxyUsd": (
            None if simulation.capacity_proxy_usd is None else exact(simulation.capacity_proxy_usd)
        ),
        "executableCapacity": "UNMEASURED",
        "topAssetGrossProfitShare": exact(simulation.top_asset_gross_profit_share),
        "topFiveCohortGrossProfitShare": exact(simulation.top_five_cohort_gross_profit_share),
    }


def monthly_scores(simulation: Simulation, months: Sequence[str]) -> list[Decimal]:
    by_month = dict.fromkeys(months, ZERO)
    for current, value in simulation.daily_returns:
        key = current.strftime("%Y-%m")
        if key in by_month:
            by_month[key] = (ONE + by_month[key]) * (ONE + value) - ONE
    return [by_month[month] for month in months]


def gate_simulation(
    base: Simulation,
    stress: Simulation,
    inference: JsonObject,
    *,
    holdout: bool,
) -> tuple[bool, list[str]]:
    limits = cast(
        JsonObject,
        cast(JsonObject, protocol()["gates"])[
            "holdoutMinimums" if holdout else "developmentMinimums"
        ],
    )
    failures: list[str] = []
    checks = {
        "VALID_FORMATION_DAYS": base.valid_formation_days >= limits["validFormationDays"],
        "CLOSED_COHORTS": base.closed_cohorts >= limits["closedCohorts"],
        "SYMBOL_ROUND_TRIPS": base.round_trips >= limits["symbolRoundTrips"],
        "DISTINCT_ASSETS": len(base.distinct_assets) >= limits["distinctAssets"],
        "ACTIVE_MONTHS": base.active_months >= limits["activeMonths"],
        "POSITIVE_MONTHS": base.positive_months >= limits["positiveMonths"],
        "BASE_NET": base.net_usd > ZERO,
        "STRESS_NET": stress.net_usd > ZERO,
        "BASE_LCB14": Decimal(cast(str, inference["baseLcb14"])) > ZERO,
        "BASE_LCB28": Decimal(cast(str, inference["baseLcb28"])) > ZERO,
        "STRESS_LCB14": Decimal(cast(str, inference["stressLcb14"])) > ZERO,
        "STRESS_LCB28": Decimal(cast(str, inference["stressLcb28"])) > ZERO,
        "STRESS_DRAWDOWN": stress.max_drawdown <= Decimal("0.40"),
        "BASE_CAPACITY": (
            base.capacity_proxy_usd is not None and base.capacity_proxy_usd >= INITIAL_USD
        ),
        "STRESS_CAPACITY": (
            stress.capacity_proxy_usd is not None and stress.capacity_proxy_usd >= INITIAL_USD
        ),
        "ASSET_CONCENTRATION": stress.top_asset_gross_profit_share <= Decimal("0.20"),
        "COHORT_CONCENTRATION": (stress.top_five_cohort_gross_profit_share <= Decimal("0.40")),
    }
    for name, passed in checks.items():
        if not passed:
            failures.append(name)
    return not failures, failures


def inference_for(base: Simulation, stress: Simulation, seed_offset: int = 0) -> JsonObject:
    base_values = [value for _, value in base.daily_returns]
    stress_values = [value for _, value in stress.daily_returns]
    return {
        "baseLcb14": exact(
            empirical_lower(bootstrap_means(base_values, block_days=14, seed=210014 + seed_offset))
        ),
        "baseLcb28": exact(
            empirical_lower(bootstrap_means(base_values, block_days=28, seed=210028 + seed_offset))
        ),
        "stressLcb14": exact(
            empirical_lower(
                bootstrap_means(stress_values, block_days=14, seed=211014 + seed_offset)
            )
        ),
        "stressLcb28": exact(
            empirical_lower(
                bootstrap_means(stress_values, block_days=28, seed=211028 + seed_offset)
            )
        ),
    }


def null_economics() -> JsonObject:
    return {
        "netUsdPer1000": None,
        "costs": {
            "grossPnlUsd": None,
            "publicFeeScenarioCostUsd": None,
            "adverseExecutionScenarioCostUsd": None,
            "accountEffectiveFee": "UNKNOWN",
        },
        "pbo": None,
        "holm": None,
        "whiteMaxT": None,
        "maxDrawdown": None,
        "capacityProxyUsd": None,
        "executableCapacity": "UNMEASURED",
        "historicalSpread": "UNMEASURED",
        "historicalDepth": "UNMEASURED",
        "historicalFilters": "UNMEASURED",
    }


def terminal_unmeasured(reason: str) -> JsonObject:
    result = {
        "schema": "VG21ResultV1",
        "completedAtUtc": utc_now(),
        "verdict": "UNMEASURED",
        "capitalVerdict": "NO_GO",
        "reason": reason,
        "economics": null_economics(),
        "development": {"state": "NOT_MEASURED", "archiveBodiesMayHaveOpened": True},
        "holdout": {
            "state": "SEALED_UNOPENED",
            "openCount": 0,
            "maximumOpenCount": 1,
        },
        "runCount": 1,
        "rerunAuthority": "NONE",
        "consumer": {
            "name": "N3 successor/final convergence",
            "admission": "SOURCE_ONLY",
            "pValue": "1",
            "executionAuthority": "NONE",
            "capitalAuthority": "NONE",
        },
    }
    write_json_once(RESULT_PATH, result)
    return result


def run() -> JsonObject:
    if MARKER_PATH.exists() or RESULT_PATH.exists():
        raise ContractError("single run already consumed")
    freeze_receipt = verify_freeze()
    marker = {
        "schema": "VG21RunMarkerV1",
        "state": "CONSUMED",
        "runCount": 1,
        "consumedAtUtc": utc_now(),
        "freezeSha256": sha256_file(FREEZE_PATH),
        "protocolSha256": freeze_receipt["protocolSha256"],
        "holdoutOpenCountAtConsumption": 0,
        "rerunAuthority": "NONE",
    }
    write_json_once(MARKER_PATH, marker)
    try:
        proto = protocol()
        data = cast(JsonObject, proto["data"])
        partitions = cast(JsonObject, proto["partitions"])
        development_months = set(cast(list[str], data["developmentArchiveMonths"]))
        bars, source_summaries = load_bars(development_months)
        engine = FeatureEngine(bars)
        development_start = date.fromisoformat(cast(str, partitions["developmentSignalStart"]))
        development_end = date.fromisoformat(cast(str, partitions["developmentSignalEnd"]))

        rows: list[JsonObject] = []
        bases: dict[str, Simulation] = {}
        stresses: dict[str, Simulation] = {}
        inference_by_trial: dict[str, JsonObject] = {}
        p_values: dict[str, Decimal] = {}
        for index, trial in enumerate(trial_family()):
            base = simulate(
                engine,
                trial,
                development_start,
                development_end,
                label="BASE",
                adverse=BASE_ADVERSE,
                participation=BASE_PARTICIPATION,
            )
            stress = simulate(
                engine,
                trial,
                development_start,
                development_end,
                label="STRESS",
                adverse=STRESS_ADVERSE,
                participation=STRESS_PARTICIPATION,
            )
            inference = inference_for(base, stress, index * 1000)
            observed = statistics.mean(value for _, value in stress.daily_returns)
            centered = bootstrap_means(
                [value for _, value in stress.daily_returns],
                block_days=14,
                seed=210105 + index,
                centered=True,
            )
            p_value = one_sided_p_value(observed, centered)
            inference["rawPValue"] = exact(p_value)
            bases[trial.trial_id] = base
            stresses[trial.trial_id] = stress
            inference_by_trial[trial.trial_id] = inference
            p_values[trial.trial_id] = p_value
            rows.append(
                {
                    "trialId": trial.trial_id,
                    "base": simulation_mapping(base),
                    "stress": simulation_mapping(stress),
                    "inference": inference,
                }
            )

        holm = holm_selected(p_values, Decimal("0.05"))
        champion_id = max(
            (trial.trial_id for trial in trial_family()),
            key=lambda trial_id: (
                Decimal(cast(str, inference_by_trial[trial_id]["stressLcb14"])),
                Decimal(cast(str, inference_by_trial[trial_id]["stressLcb28"])),
                stresses[trial_id].net_usd,
                -stresses[trial_id].round_trips,
                trial_id,
            ),
        )
        observed_max = max(
            statistics.mean(value for _, value in stresses[trial_id].daily_returns)
            for trial_id in stresses
        )
        synchronized_centered = [
            bootstrap_means(
                [value for _, value in stresses[trial_id].daily_returns],
                block_days=14,
                seed=210205,
                centered=True,
            )
            for trial_id in sorted(stresses)
        ]
        replicate_maxima = [
            max(row[replicate] for row in synchronized_centered)
            for replicate in range(BOOTSTRAP_REPLICATES)
        ]
        white_p = one_sided_p_value(observed_max, replicate_maxima)
        dev_base = bases[champion_id]
        dev_stress = stresses[champion_id]
        dev_inference = inference_by_trial[champion_id]
        dev_pass, dev_failures = gate_simulation(dev_base, dev_stress, dev_inference, holdout=False)
        if champion_id not in holm:
            dev_failures.append("HOLM_FWER")
            dev_pass = False
        if white_p > Decimal("0.05"):
            dev_failures.append("WHITE_MAX_T")
            dev_pass = False
        month_names = [
            "2025-07",
            "2025-08",
            "2025-09",
            "2025-10",
            "2025-11",
            "2025-12",
            "2026-01",
            "2026-02",
        ]
        pbo = pbo_cscv(
            [monthly_scores(stresses[trial.trial_id], month_names) for trial in trial_family()]
        )
        development = {
            "sourceSummaryCount": len(source_summaries),
            "trialRows": rows,
            "championTrialId": champion_id,
            "holmSelectedTrialIds": sorted(holm),
            "whiteMaxTPValue": exact(white_p),
            "pbo": pbo,
            "gatePass": dev_pass,
            "gateFailures": sorted(set(dev_failures)),
        }
        if not dev_pass:
            result = {
                "schema": "VG21ResultV1",
                "completedAtUtc": utc_now(),
                "verdict": "NO_GO",
                "capitalVerdict": "NO_GO",
                "reason": "DEVELOPMENT_GATES_FAILED",
                "development": development,
                "holdout": {
                    "state": "SEALED_UNOPENED",
                    "openCount": 0,
                    "maximumOpenCount": 1,
                },
                "runCount": 1,
                "rerunAuthority": "NONE",
                "consumer": {
                    "name": "N3 successor/final convergence",
                    "admission": "SOURCE_ONLY",
                    "pValue": "1",
                    "executionAuthority": "NONE",
                    "capitalAuthority": "NONE",
                },
            }
            write_json_once(RESULT_PATH, result)
            return result

        selection = {
            "schema": "VG21SelectionV1",
            "sealedAtUtc": utc_now(),
            "championTrialId": champion_id,
            "developmentSha256": sha256_bytes(canonical_bytes(development)),
            "evaluatorSha256": sha256_file(Path(__file__).resolve()),
            "protocolSha256": sha256_file(PROTOCOL_PATH),
            "holdoutOpenAuthority": 1,
        }
        write_json_once(SELECTION_PATH, selection)
        write_json_once(
            HOLDOUT_OPEN_PATH,
            {
                "schema": "VG21HoldoutOpenV1",
                "openedAtUtc": utc_now(),
                "openCount": 1,
                "selectionSha256": sha256_file(SELECTION_PATH),
            },
        )
        holdout_months = set(cast(list[str], data["holdoutArchiveMonths"]))
        holdout_bars, holdout_summaries = load_bars(holdout_months)
        for symbol, rows_by_day in holdout_bars.items():
            target = bars.setdefault(symbol, {})
            overlap = set(target).intersection(rows_by_day)
            if overlap:
                raise MeasurementError(f"HOLDOUT_DAY_OVERLAP:{symbol}")
            target.update(rows_by_day)
        holdout_engine = FeatureEngine(bars)
        champion = next(trial for trial in trial_family() if trial.trial_id == champion_id)
        holdout_start = date.fromisoformat(cast(str, partitions["holdoutSignalStart"]))
        holdout_end = date.fromisoformat(cast(str, partitions["holdoutSignalEnd"]))
        holdout_base = simulate(
            holdout_engine,
            champion,
            holdout_start,
            holdout_end,
            label="BASE",
            adverse=BASE_ADVERSE,
            participation=BASE_PARTICIPATION,
        )
        holdout_stress = simulate(
            holdout_engine,
            champion,
            holdout_start,
            holdout_end,
            label="STRESS",
            adverse=STRESS_ADVERSE,
            participation=STRESS_PARTICIPATION,
        )
        holdout_inference = inference_for(holdout_base, holdout_stress, 90000)
        holdout_pass, holdout_failures = gate_simulation(
            holdout_base, holdout_stress, holdout_inference, holdout=True
        )
        result = {
            "schema": "VG21ResultV1",
            "completedAtUtc": utc_now(),
            "verdict": "GO" if holdout_pass else "NO_GO",
            "capitalVerdict": "NO_GO",
            "reason": "ALL_LANE_LOCAL_GATES_PASS" if holdout_pass else "HOLDOUT_GATES_FAILED",
            "development": development,
            "holdout": {
                "state": "OPENED_ONCE",
                "openCount": 1,
                "maximumOpenCount": 1,
                "sourceSummaryCount": len(holdout_summaries),
                "base": simulation_mapping(holdout_base),
                "stress": simulation_mapping(holdout_stress),
                "inference": holdout_inference,
                "gatePass": holdout_pass,
                "gateFailures": sorted(set(holdout_failures)),
            },
            "globalVolumeFamilyHoldoutStatus": "NOT_CERTIFIED_SHARED_REUSE_RISK",
            "runCount": 1,
            "rerunAuthority": "NONE",
            "consumer": {
                "name": "N3 successor/final convergence",
                "admission": "SOURCE_ONLY",
                "pValue": "1",
                "executionAuthority": "NONE",
                "capitalAuthority": "NONE",
            },
        }
        write_json_once(RESULT_PATH, result)
        return result
    except (
        ContractError,
        MeasurementError,
        ArithmeticError,
        ValueError,
        zipfile.BadZipFile,
    ) as exc:
        if RESULT_PATH.exists():
            raise
        reason = f"{type(exc).__name__.upper()}:{exc!s}"
        return terminal_unmeasured(reason)


def write_checksums() -> None:
    if SHA256SUMS_PATH.exists():
        raise ContractError("refusing to overwrite SHA256SUMS")
    if not RESULT_PATH.exists():
        raise ContractError("terminal result must exist before checksums")
    paths = sorted(
        path for path in PACKET.iterdir() if path.is_file() and path.name != "SHA256SUMS"
    )
    lines = [f"{sha256_file(path)}  {path.name}" for path in paths]
    SHA256SUMS_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


def verify_checksums() -> None:
    if not SHA256SUMS_PATH.exists():
        raise ContractError("SHA256SUMS is missing")
    seen: set[str] = set()
    for line in SHA256SUMS_PATH.read_text(encoding="utf-8").splitlines():
        digest, name = line.split("  ", maxsplit=1)
        if name in seen or "/" in name or len(digest) != 64:
            raise ContractError("invalid SHA256SUMS grammar")
        seen.add(name)
        if sha256_file(PACKET / name) != digest:
            raise ContractError(f"checksum mismatch: {name}")
    expected = {
        path.name for path in PACKET.iterdir() if path.is_file() and path.name != "SHA256SUMS"
    }
    if seen != expected:
        raise ContractError("SHA256SUMS coverage mismatch")


def verify() -> JsonObject:
    verify_freeze()
    verify_trial_ledger()
    verify_checksums()
    marker = load_json(MARKER_PATH)
    result = load_json(RESULT_PATH)
    if marker.get("state") != "CONSUMED" or marker.get("runCount") != 1:
        raise ContractError("run marker does not prove exactly one consumed run")
    holdout_count = 1 if HOLDOUT_OPEN_PATH.exists() else 0
    holdout = cast(JsonObject, result["holdout"])
    if holdout.get("openCount") != holdout_count or holdout_count > 1:
        raise ContractError("holdout-open count mismatch")
    if result.get("verdict") == "UNMEASURED":
        economics = cast(JsonObject, result["economics"])
        if economics.get("netUsdPer1000") is not None:
            raise ContractError("UNMEASURED cannot carry numeric economics")
        if any(
            economics.get(field) is not None
            for field in ("pbo", "holm", "whiteMaxT", "maxDrawdown", "capacityProxyUsd")
        ):
            raise ContractError("UNMEASURED diagnostics must remain null")
    if cast(JsonObject, result["consumer"]).get("pValue") != "1":
        raise ContractError("N3 consumer p-value must remain conservative")
    return {
        "schema": "VG21VerificationV1",
        "status": "PASS",
        "verdict": result["verdict"],
        "runCount": 1,
        "holdoutOpenCount": holdout_count,
        "packetFileCount": len([path for path in PACKET.iterdir() if path.is_file()]),
    }


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    subparsers = result.add_subparsers(dest="command", required=True)
    inventory_parser = subparsers.add_parser("inventory")
    inventory_parser.add_argument("--state-root", type=Path, required=True)
    subparsers.add_parser("freeze")
    subparsers.add_parser("run")
    subparsers.add_parser("checksums")
    subparsers.add_parser("verify")
    return result


def main(argv: Sequence[str] | None = None) -> int:
    arguments = parser().parse_args(argv)
    if arguments.command == "inventory":
        value = inventory(cast(Path, arguments.state_root))
    elif arguments.command == "freeze":
        value = freeze()
    elif arguments.command == "run":
        value = run()
    elif arguments.command == "checksums":
        write_checksums()
        value = {"status": "WROTE", "path": str(SHA256SUMS_PATH)}
    elif arguments.command == "verify":
        value = verify()
    else:
        raise AssertionError("unreachable command")
    if arguments.command == "inventory":
        value = {
            "schema": value["schema"],
            "archiveBodiesOpened": value["archiveBodiesOpened"],
            "recordCount": value["recordCount"],
            "recordRowsSha256": value["recordRowsSha256"],
            "sourceManifestSha256": sha256_file(SOURCE_MANIFEST_PATH),
        }
    print(json.dumps(value, sort_keys=True, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
