"""V-G9 price-free cross-venue volume-share experiment.

The default Phase-1 path only enumerates archive names, sidecars, and file metadata.
ZIP bytes are reachable only from the marker-gated development and holdout commands.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import random
import re
import shutil
import stat
import sys
import tempfile
import zipfile
from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Final

from quant_edge.labels.rational import ExactRatioV1, make_ratio
from quant_edge.lake.contracts import EvidencePosture, QualityState
from quant_edge.validation import (
    BootstrapSpecV1,
    HoldoutGrantV1,
    PlanStatus,
    SampleSetV1,
    SplitScheme,
    TrialLedgerV1,
    TrialRecordV1,
    TrialStatus,
    ValidationSampleV1,
    WalkForwardSpecV1,
    block_bootstrap_interval,
    build_walk_forward_plan,
    holm_bonferroni,
    open_holdout,
    pbo_cscv,
)

HERE: Final = Path(__file__).resolve().parent
PROTOCOL_PATH: Final = HERE / "protocol.v1.json"
SOURCE_MANIFEST_PATH: Final = HERE / "source_manifest.v1.json"
FREEZE_PATH: Final = HERE / "freeze.v1.json"
DEFAULT_STATE_ROOT: Final = Path("/private/tmp/cosmos-vg9-spot-usdm-volume-leadership-v1")
SYMBOL_RE: Final = re.compile(r"^[A-Z0-9]+USDT$")
SHA256_RE: Final = re.compile(r"^[0-9a-f]{64}$")
DAY_US: Final = 86_400_000_000
HOUR_MS: Final = 3_600_000
RATIO_SCALE: Final = 10**12


class VG9Error(RuntimeError):
    """Base error for frozen V-G9 contract failures."""


class CustodyError(VG9Error):
    """A source, seal, checksum, or one-shot contract failed."""


class DataError(VG9Error):
    """An archive schema, timestamp, duplicate, or completeness contract failed."""


class MeasurementError(VG9Error):
    """Selected post-formation payoff evidence is unavailable."""


@dataclass(frozen=True, slots=True)
class ArchiveBinding:
    venue: str
    symbol: str
    month: str
    relative_path: str
    path: Path
    zip_bytes: int
    expected_zip_sha256: str
    sidecar_bytes: int
    sidecar_sha256: str

    def digest_mapping(self) -> dict[str, object]:
        return {
            "expectedZipSha256": self.expected_zip_sha256,
            "month": self.month,
            "relativePath": self.relative_path,
            "sidecarBytes": self.sidecar_bytes,
            "sidecarSha256": self.sidecar_sha256,
            "symbol": self.symbol,
            "venue": self.venue,
            "zipBytes": self.zip_bytes,
        }


@dataclass(frozen=True, slots=True)
class SourcePair:
    symbol: str
    month: str
    spot: ArchiveBinding
    usd_m: ArchiveBinding

    def digest_mapping(self) -> dict[str, object]:
        return {
            "month": self.month,
            "spot": self.spot.digest_mapping(),
            "symbol": self.symbol,
            "usdM": self.usd_m.digest_mapping(),
        }


@dataclass(frozen=True, slots=True)
class SpotBar:
    day: date
    open_price: Decimal
    close_price: Decimal
    quote_volume: Decimal


@dataclass(frozen=True, slots=True)
class VolumeBar:
    day: date
    quote_volume: Decimal


@dataclass(frozen=True, slots=True)
class TrialSpec:
    trial_id: str
    window_days: int
    top_fraction: Decimal


@dataclass(frozen=True, slots=True)
class Scenario:
    scenario_id: str
    fee_per_fill: Decimal
    adverse_per_fill: Decimal


@dataclass(frozen=True, slots=True)
class Formation:
    formation_day: date
    entry_day: date
    exit_day: date
    eligible_symbols: tuple[str, ...]
    spread_rank: tuple[str, ...]
    spot_rank: tuple[str, ...]
    selected_count: int
    trailing_spot_quote_volume: Mapping[str, Decimal]


@dataclass(frozen=True, slots=True)
class Simulation:
    trial_id: str
    scenario_id: str
    comparator: bool
    valid_weeks: int
    round_trips: int
    distinct_symbols: frozenset[str]
    weekly_log_returns: tuple[float, ...]
    weekly_exit_nav: tuple[float, ...]
    terminal_nav: float
    maximum_drawdown_pct: float
    maximum_participation_bps: float

    def as_mapping(self) -> dict[str, object]:
        return {
            "comparator": self.comparator,
            "distinctSymbols": len(self.distinct_symbols),
            "maximumParticipationBps": text_float(self.maximum_participation_bps),
            "maximumScheduledExitDrawdownPct": text_float(self.maximum_drawdown_pct),
            "netUsdPer1000": text_float(self.terminal_nav - 1000.0),
            "roundTrips": self.round_trips,
            "scenarioId": self.scenario_id,
            "terminalNav": text_float(self.terminal_nav),
            "trialId": self.trial_id,
            "validWeeks": self.valid_weeks,
        }


def canonical_bytes(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()


def sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_object(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise CustodyError(f"cannot read {path.name}: {exc}") from exc
    if not isinstance(value, dict):
        raise CustodyError(f"{path.name} must contain an object")
    return value


def text_float(value: float) -> str:
    if not math.isfinite(value):
        raise MeasurementError("non-finite statistic")
    return format(value, ".12g")


def month_range(first: str, last: str) -> tuple[str, ...]:
    try:
        cursor = datetime.strptime(first, "%Y-%m").replace(tzinfo=UTC)
        end = datetime.strptime(last, "%Y-%m").replace(tzinfo=UTC)
    except ValueError as exc:
        raise CustodyError("invalid month boundary") from exc
    if cursor > end:
        raise CustodyError("month range is reversed")
    output: list[str] = []
    while cursor <= end:
        output.append(cursor.strftime("%Y-%m"))
        year = cursor.year + (1 if cursor.month == 12 else 0)
        month = 1 if cursor.month == 12 else cursor.month + 1
        cursor = cursor.replace(year=year, month=month)
    return tuple(output)


def load_protocol() -> dict[str, Any]:
    protocol = read_object(PROTOCOL_PATH)
    if protocol.get("schema") != "VG9SpotUsdMVolumeShareLeadershipProtocolV1":
        raise CustodyError("protocol schema mismatch")
    if protocol.get("canonicalBaseCommit") != "a169b123fb186d1943a75ad648552c4d95be1be1":
        raise CustodyError("protocol base commit drift")
    if protocol.get("frozenForDateUtc") != "2026-07-29":
        raise CustodyError("protocol date drift")
    return protocol


def protocol_months(protocol: Mapping[str, Any]) -> tuple[str, ...]:
    data = require_mapping(protocol.get("data"), "data")
    bounds = require_string_pair(data.get("monthsInclusive"), "data.monthsInclusive")
    return month_range(*bounds)


def require_mapping(value: object, field: str) -> Mapping[str, Any]:
    if not isinstance(value, dict):
        raise CustodyError(f"{field} must be an object")
    return value


def require_string_pair(value: object, field: str) -> tuple[str, str]:
    if (
        not isinstance(value, list)
        or len(value) != 2
        or any(not isinstance(item, str) for item in value)
    ):
        raise CustodyError(f"{field} must be a two-string array")
    return value[0], value[1]


def _root(protocol: Mapping[str, Any], key: str) -> Path:
    data = require_mapping(protocol.get("data"), "data")
    value = data.get(key)
    if not isinstance(value, str):
        raise CustodyError(f"data.{key} must be a string")
    root = Path(value)
    if not root.is_dir() or root.is_symlink():
        raise CustodyError(f"source root unavailable or symlinked: {key}")
    return root


def parse_sidecar(raw: bytes, zip_name: str) -> str:
    try:
        lines = raw.decode("ascii").splitlines()
    except UnicodeDecodeError as exc:
        raise CustodyError(f"non-ASCII CHECKSUM for {zip_name}") from exc
    if len(lines) != 1:
        raise CustodyError(f"CHECKSUM must contain one line: {zip_name}")
    parts = lines[0].split()
    if len(parts) != 2 or parts[1].lstrip("*") != zip_name:
        raise CustodyError(f"CHECKSUM filename mismatch: {zip_name}")
    digest = parts[0].lower()
    if SHA256_RE.fullmatch(digest) is None:
        raise CustodyError(f"invalid CHECKSUM digest: {zip_name}")
    return digest


def _archive_binding(
    *,
    venue: str,
    root: Path,
    sidecar: Path,
    symbol: str,
    month: str,
) -> ArchiveBinding:
    if sidecar.is_symlink() or not sidecar.is_file():
        raise CustodyError(f"sidecar is not a regular file: {sidecar}")
    zip_path = sidecar.with_suffix("")
    if zip_path.is_symlink() or not zip_path.is_file():
        raise CustodyError(f"archive is not a regular file: {zip_path}")
    zip_stat = zip_path.lstat()
    sidecar_stat = sidecar.lstat()
    if not stat.S_ISREG(zip_stat.st_mode) or not stat.S_ISREG(sidecar_stat.st_mode):
        raise CustodyError(f"source member is not regular: {zip_path}")
    try:
        sidecar_raw = sidecar.read_bytes()
    except OSError as exc:
        raise CustodyError(f"cannot read sidecar metadata: {sidecar}") from exc
    expected = parse_sidecar(sidecar_raw, zip_path.name)
    return ArchiveBinding(
        venue=venue,
        symbol=symbol,
        month=month,
        relative_path=zip_path.relative_to(root).as_posix(),
        path=zip_path,
        zip_bytes=zip_stat.st_size,
        expected_zip_sha256=expected,
        sidecar_bytes=sidecar_stat.st_size,
        sidecar_sha256=sha256_bytes(sidecar_raw),
    )


def enumerate_source_pairs(
    protocol: Mapping[str, Any],
    months: Iterable[str] | None = None,
) -> dict[str, tuple[SourcePair, ...]]:
    spot_root = _root(protocol, "spotRoot")
    usd_m_root = _root(protocol, "usdMRoot")
    selected_months = tuple(months) if months is not None else protocol_months(protocol)
    output: dict[str, tuple[SourcePair, ...]] = {}
    for month in selected_months:
        spot_sidecars: dict[str, Path] = {}
        for sidecar in spot_root.glob(f"*/{month}/*-1d-{month}.zip.CHECKSUM"):
            symbol = sidecar.parent.parent.name
            expected_name = f"{symbol}-1d-{month}.zip.CHECKSUM"
            if SYMBOL_RE.fullmatch(symbol) is None or sidecar.name != expected_name:
                continue
            if symbol in spot_sidecars:
                raise CustodyError(f"duplicate Spot source path: {symbol} {month}")
            spot_sidecars[symbol] = sidecar
        usd_m_sidecars: dict[str, Path] = {}
        for sidecar in usd_m_root.glob(f"*/1h/*-1h-{month}.zip.CHECKSUM"):
            symbol = sidecar.parent.parent.name
            expected_name = f"{symbol}-1h-{month}.zip.CHECKSUM"
            if SYMBOL_RE.fullmatch(symbol) is None or sidecar.name != expected_name:
                continue
            if symbol in usd_m_sidecars:
                raise CustodyError(f"duplicate USD-M source path: {symbol} {month}")
            usd_m_sidecars[symbol] = sidecar
        pairs: list[SourcePair] = []
        for symbol in sorted(set(spot_sidecars) & set(usd_m_sidecars)):
            spot = _archive_binding(
                venue="SPOT",
                root=spot_root,
                sidecar=spot_sidecars[symbol],
                symbol=symbol,
                month=month,
            )
            usd_m = _archive_binding(
                venue="USD_M",
                root=usd_m_root,
                sidecar=usd_m_sidecars[symbol],
                symbol=symbol,
                month=month,
            )
            pairs.append(SourcePair(symbol=symbol, month=month, spot=spot, usd_m=usd_m))
        output[month] = tuple(pairs)
    return output


def _rows_digest(pairs: Iterable[SourcePair]) -> str:
    digest = hashlib.sha256()
    for pair in pairs:
        digest.update(canonical_bytes(pair.digest_mapping()))
        digest.update(b"\n")
    return digest.hexdigest()


def build_source_manifest(protocol: Mapping[str, Any]) -> dict[str, Any]:
    pairs_by_month = enumerate_source_pairs(protocol)
    month_rows: list[dict[str, object]] = []
    for month in protocol_months(protocol):
        pairs = pairs_by_month[month]
        month_rows.append(
            {
                "month": month,
                "pairCount": len(pairs),
                "firstSymbol": pairs[0].symbol if pairs else None,
                "lastSymbol": pairs[-1].symbol if pairs else None,
                "symbolsSha256": sha256_bytes(
                    "".join(f"{pair.symbol}\n" for pair in pairs).encode()
                ),
                "enumeratedRowsSha256": _rows_digest(pairs),
            }
        )
    return {
        "schema": "VG9ChecksumMetadataSourceManifestV1",
        "frozenForDateUtc": "2026-07-29",
        "protocolSha256": sha256_path(PROTOCOL_PATH),
        "spotRoot": str(_root(protocol, "spotRoot")),
        "usdMRoot": str(_root(protocol, "usdMRoot")),
        "archiveBodyBytesRead": False,
        "enumerationRow": (
            "canonical JSON of month,symbol,venue-relative ZIP path, ZIP byte size,"
            " CHECKSUM-declared ZIP SHA256, CHECKSUM byte size, and CHECKSUM SHA256"
        ),
        "monthInventory": month_rows,
        "inventorySha256": sha256_bytes(canonical_bytes(month_rows)),
        "futureCompleteUniverseIntersection": False,
        "currentExchangeInfoUsed": False,
    }


def verify_source_manifest(
    protocol: Mapping[str, Any],
    manifest: Mapping[str, Any] | None = None,
) -> dict[str, tuple[SourcePair, ...]]:
    expected = build_source_manifest(protocol)
    observed = read_object(SOURCE_MANIFEST_PATH) if manifest is None else dict(manifest)
    if canonical_bytes(observed) != canonical_bytes(expected):
        raise CustodyError("source manifest does not match current sidecar metadata enumeration")
    return enumerate_source_pairs(protocol)


def _verified_zip_member(binding: ArchiveBinding, expected_csv: str) -> bytes:
    try:
        raw = binding.path.read_bytes()
    except OSError as exc:
        raise CustodyError(f"cannot read archive body: {binding.relative_path}") from exc
    if len(raw) != binding.zip_bytes:
        raise CustodyError(f"archive byte length changed: {binding.relative_path}")
    if sha256_bytes(raw) != binding.expected_zip_sha256:
        raise CustodyError(f"archive checksum mismatch: {binding.relative_path}")
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            names = archive.namelist()
            if names != [expected_csv] or Path(names[0]).name != names[0]:
                raise DataError(f"archive member contract failed: {binding.relative_path}")
            return archive.read(names[0])
    except zipfile.BadZipFile as exc:
        raise DataError(f"invalid ZIP: {binding.relative_path}") from exc


def _decimal(raw: str, *, field: str, positive: bool = False) -> Decimal:
    try:
        value = Decimal(raw)
    except InvalidOperation as exc:
        raise DataError(f"{field} is not decimal") from exc
    if not value.is_finite() or (positive and value <= 0) or (not positive and value < 0):
        raise DataError(f"{field} violates numeric domain")
    return value


def _csv_rows(raw: bytes, *, source: str) -> list[list[str]]:
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise DataError(f"non-UTF8 CSV: {source}") from exc
    rows: list[list[str]] = []
    for line_number, line in enumerate(text.splitlines(), start=1):
        if not line:
            continue
        fields = line.split(",")
        if len(fields) != 12:
            raise DataError(f"{source}:{line_number} must have 12 columns")
        rows.append(fields)
    if not rows:
        raise DataError(f"empty CSV: {source}")
    return rows


def parse_spot_archive(binding: ArchiveBinding) -> tuple[SpotBar, ...]:
    csv_name = f"{binding.symbol}-1d-{binding.month}.csv"
    rows = _csv_rows(_verified_zip_member(binding, csv_name), source=binding.relative_path)
    bars: list[SpotBar] = []
    seen: set[date] = set()
    previous: date | None = None
    for fields in rows:
        try:
            open_us = int(fields[0])
            close_us = int(fields[6])
        except ValueError as exc:
            raise DataError(f"Spot timestamp is not integer: {binding.relative_path}") from exc
        if not 1_000_000_000_000_000 <= open_us < 10_000_000_000_000_000:
            raise DataError(
                f"Spot timestamp is not post-2025 microseconds: {binding.relative_path}"
            )
        if open_us % DAY_US != 0 or close_us != open_us + DAY_US - 1:
            raise DataError(f"Spot daily boundary invalid: {binding.relative_path}")
        opened = datetime.fromtimestamp(open_us / 1_000_000, tz=UTC)
        day = opened.date()
        if day.strftime("%Y-%m") != binding.month:
            raise DataError(f"Spot row outside archive month: {binding.relative_path}")
        if day in seen:
            raise DataError(f"duplicate Spot day: {binding.symbol} {day}")
        if previous is not None and day != previous + timedelta(days=1):
            raise DataError(f"non-contiguous Spot archive rows: {binding.relative_path}")
        seen.add(day)
        previous = day
        bars.append(
            SpotBar(
                day=day,
                open_price=_decimal(fields[1], field="Spot open", positive=True),
                close_price=_decimal(fields[4], field="Spot close", positive=True),
                quote_volume=_decimal(fields[7], field="Spot quote volume"),
            )
        )
    return tuple(bars)


def parse_usd_m_archive(binding: ArchiveBinding) -> tuple[VolumeBar, ...]:
    csv_name = f"{binding.symbol}-1h-{binding.month}.csv"
    rows = _csv_rows(_verified_zip_member(binding, csv_name), source=binding.relative_path)
    hourly: dict[date, dict[int, Decimal]] = defaultdict(dict)
    previous_open: int | None = None
    for fields in rows:
        try:
            open_ms = int(fields[0])
            close_ms = int(fields[6])
        except ValueError as exc:
            raise DataError(f"USD-M timestamp is not integer: {binding.relative_path}") from exc
        if not 1_000_000_000_000 <= open_ms < 10_000_000_000_000:
            raise DataError(f"USD-M timestamp is not milliseconds: {binding.relative_path}")
        if open_ms % HOUR_MS != 0 or close_ms != open_ms + HOUR_MS - 1:
            raise DataError(f"USD-M hourly boundary invalid: {binding.relative_path}")
        if previous_open is not None and open_ms != previous_open + HOUR_MS:
            raise DataError(f"non-contiguous USD-M archive rows: {binding.relative_path}")
        previous_open = open_ms
        opened = datetime.fromtimestamp(open_ms / 1000, tz=UTC)
        if opened.strftime("%Y-%m") != binding.month:
            raise DataError(f"USD-M row outside archive month: {binding.relative_path}")
        if opened.hour in hourly[opened.date()]:
            raise DataError(f"duplicate USD-M hour: {binding.symbol} {opened.isoformat()}")
        hourly[opened.date()][opened.hour] = _decimal(fields[7], field="USD-M quote volume")
    daily: list[VolumeBar] = []
    for day in sorted(hourly):
        hours = hourly[day]
        if set(hours) != set(range(24)):
            continue
        daily.append(VolumeBar(day=day, quote_volume=sum(hours.values(), Decimal(0))))
    return tuple(daily)


def load_pair_bars(
    pairs_by_month: Mapping[str, tuple[SourcePair, ...]],
    months: Iterable[str],
) -> tuple[dict[str, dict[date, SpotBar]], dict[str, dict[date, VolumeBar]]]:
    spot: dict[str, dict[date, SpotBar]] = defaultdict(dict)
    usd_m: dict[str, dict[date, VolumeBar]] = defaultdict(dict)
    for month in months:
        for pair in pairs_by_month[month]:
            for bar in parse_spot_archive(pair.spot):
                if bar.day in spot[pair.symbol]:
                    raise DataError(f"duplicate Spot day across archives: {pair.symbol} {bar.day}")
                spot[pair.symbol][bar.day] = bar
            for bar in parse_usd_m_archive(pair.usd_m):
                if bar.day in usd_m[pair.symbol]:
                    raise DataError(f"duplicate USD-M day across archives: {pair.symbol} {bar.day}")
                usd_m[pair.symbol][bar.day] = bar
    return dict(spot), dict(usd_m)


def trial_specs(protocol: Mapping[str, Any]) -> tuple[TrialSpec, ...]:
    trials = require_mapping(protocol.get("trials"), "trials")
    raw_ids = trials.get("trialIds")
    signal = require_mapping(protocol.get("signal"), "signal")
    windows = signal.get("trailingWindowDays")
    fractions = trials.get("topFractions")
    if (
        not isinstance(raw_ids, list)
        or not isinstance(windows, list)
        or not isinstance(fractions, list)
    ):
        raise CustodyError("trial grid is malformed")
    expected: list[TrialSpec] = []
    for window in windows:
        if not isinstance(window, int) or isinstance(window, bool) or window <= 0:
            raise CustodyError("trial window invalid")
        for raw_fraction in fractions:
            fraction = _decimal(str(raw_fraction), field="top fraction", positive=True)
            expected.append(
                TrialSpec(
                    trial_id=f"W{window:02d}_F{int(fraction * 100):02d}",
                    window_days=window,
                    top_fraction=fraction,
                )
            )
    if [spec.trial_id for spec in expected] != raw_ids:
        raise CustodyError("trial ID grid drift")
    return tuple(expected)


def scenarios(protocol: Mapping[str, Any]) -> tuple[Scenario, ...]:
    costs = require_mapping(protocol.get("costs"), "costs")
    output: list[Scenario] = []
    for scenario_id in ("BASE", "STRESS"):
        raw = require_mapping(costs.get(scenario_id), f"costs.{scenario_id}")
        fee = _decimal(str(raw.get("spotFeeBpsPerFill")), field="fee") / Decimal(10_000)
        adverse = _decimal(str(raw.get("adverseExecutionBpsPerFill")), field="adverse") / Decimal(
            10_000
        )
        output.append(Scenario(scenario_id, fee, adverse))
    return tuple(output)


def _complete_volume_sum(
    series: Mapping[date, SpotBar | VolumeBar],
    through: date,
    window_days: int,
) -> Decimal | None:
    total = Decimal(0)
    for offset in range(window_days):
        day = through - timedelta(days=offset)
        bar = series.get(day)
        if bar is None or bar.quote_volume <= 0:
            return None
        total += bar.quote_volume
    return total if total > 0 else None


def build_formation(
    spot: Mapping[str, Mapping[date, SpotBar]],
    usd_m: Mapping[str, Mapping[date, VolumeBar]],
    formation_day: date,
    spec: TrialSpec,
    minimum_eligible: int = 20,
) -> Formation | None:
    if formation_day.weekday() != 0:
        raise DataError("formation must be Monday")
    through = formation_day - timedelta(days=1)
    volumes: dict[str, tuple[Decimal, Decimal]] = {}
    for symbol in sorted(set(spot) & set(usd_m)):
        spot_sum = _complete_volume_sum(spot[symbol], through, spec.window_days)
        usd_m_sum = _complete_volume_sum(usd_m[symbol], through, spec.window_days)
        if spot_sum is not None and usd_m_sum is not None:
            volumes[symbol] = (spot_sum, usd_m_sum)
    if len(volumes) < minimum_eligible:
        return None
    spot_total = sum((value[0] for value in volumes.values()), Decimal(0))
    usd_m_total = sum((value[1] for value in volumes.values()), Decimal(0))
    scores = {
        symbol: (spot_sum / spot_total).ln() - (usd_m_sum / usd_m_total).ln()
        for symbol, (spot_sum, usd_m_sum) in volumes.items()
    }
    spread_rank = tuple(sorted(volumes, key=lambda symbol: (-scores[symbol], symbol)))
    spot_rank = tuple(sorted(volumes, key=lambda symbol: (-volumes[symbol][0], symbol)))
    selected_count = max(1, int(spec.top_fraction * len(volumes)))
    return Formation(
        formation_day=formation_day,
        entry_day=formation_day + timedelta(days=1),
        exit_day=formation_day + timedelta(days=8),
        eligible_symbols=tuple(sorted(volumes)),
        spread_rank=spread_rank,
        spot_rank=spot_rank,
        selected_count=selected_count,
        trailing_spot_quote_volume={
            symbol: values[0] / Decimal(spec.window_days) for symbol, values in volumes.items()
        },
    )


def formation_dates(first: date, last: date) -> tuple[date, ...]:
    if first.weekday() != 0 or last.weekday() != 0 or first > last:
        raise CustodyError("formation calendar boundary invalid")
    output: list[date] = []
    cursor = first
    while cursor <= last:
        output.append(cursor)
        cursor += timedelta(days=7)
    return tuple(output)


def build_formations(
    spot: Mapping[str, Mapping[date, SpotBar]],
    usd_m: Mapping[str, Mapping[date, VolumeBar]],
    dates: Iterable[date],
    spec: TrialSpec,
) -> tuple[Formation, ...]:
    output: list[Formation] = []
    for formation_day in dates:
        formation = build_formation(spot, usd_m, formation_day, spec)
        if formation is not None:
            output.append(formation)
    return tuple(output)


def simulate(
    *,
    spot: Mapping[str, Mapping[date, SpotBar]],
    formations: Iterable[Formation],
    spec: TrialSpec,
    scenario: Scenario,
    comparator: bool,
) -> Simulation:
    nav = 1000.0
    peak = nav
    drawdown = 0.0
    weekly_returns: list[float] = []
    nav_path: list[float] = []
    selected_symbols: set[str] = set()
    round_trips = 0
    max_participation = 0.0
    fee = float(scenario.fee_per_fill)
    adverse = float(scenario.adverse_per_fill)
    for formation in formations:
        rank = formation.spot_rank if comparator else formation.spread_rank
        selected = rank[: formation.selected_count]
        if len(selected) != formation.selected_count:
            raise MeasurementError("selected portfolio count unavailable")
        before = nav
        allocation = before / len(selected)
        multipliers: list[float] = []
        for symbol in selected:
            entry = spot.get(symbol, {}).get(formation.entry_day)
            exit_bar = spot.get(symbol, {}).get(formation.exit_day)
            if entry is None or exit_bar is None:
                raise MeasurementError(
                    f"selected Spot entry/exit unavailable: {symbol} {formation.entry_day}"
                )
            entry_price = float(entry.open_price)
            exit_price = float(exit_bar.open_price)
            multiplier = (
                ((1.0 - fee) ** 2)
                * ((1.0 - adverse) / (1.0 + adverse))
                * (exit_price / entry_price)
            )
            if multiplier <= 0 or not math.isfinite(multiplier):
                raise MeasurementError("invalid selected holding multiplier")
            multipliers.append(multiplier)
            selected_symbols.add(symbol)
            daily_volume = float(formation.trailing_spot_quote_volume[symbol])
            if daily_volume > 0:
                max_participation = max(max_participation, allocation / daily_volume * 10_000)
        weekly_multiplier = sum(multipliers) / len(multipliers)
        nav *= weekly_multiplier
        if nav <= 0 or not math.isfinite(nav):
            raise MeasurementError("portfolio NAV became invalid")
        weekly_returns.append(math.log(nav / before))
        nav_path.append(nav)
        round_trips += len(selected)
        peak = max(peak, nav)
        drawdown = max(drawdown, (peak - nav) / peak * 100)
    return Simulation(
        trial_id=spec.trial_id,
        scenario_id=scenario.scenario_id,
        comparator=comparator,
        valid_weeks=len(weekly_returns),
        round_trips=round_trips,
        distinct_symbols=frozenset(selected_symbols),
        weekly_log_returns=tuple(weekly_returns),
        weekly_exit_nav=tuple(nav_path),
        terminal_nav=nav,
        maximum_drawdown_pct=drawdown,
        maximum_participation_bps=max_participation,
    )


def _ratios(values: Iterable[float]) -> tuple[ExactRatioV1, ...]:
    return tuple(make_ratio(round(value * RATIO_SCALE), RATIO_SCALE) for value in values)


def bootstrap_packet(values: tuple[float, ...], *, seed: int) -> dict[str, object]:
    spec = BootstrapSpecV1(
        seed=seed,
        block_length=4,
        replicates=4096,
        coverage_per_myriad=9000,
    )
    report = block_bootstrap_interval(_ratios(values), spec)
    mapping = report.as_mapping()
    if report.lower is None or report.point_estimate is None:
        return {**mapping, "terminalNetLowerUsd": None}
    lower_mean = report.lower.mantissa / RATIO_SCALE
    point_mean = report.point_estimate.mantissa / RATIO_SCALE
    return {
        **mapping,
        "terminalNetLowerUsd": text_float(1000.0 * math.expm1(lower_mean * len(values))),
        "terminalNetPointUsd": text_float(1000.0 * math.expm1(point_mean * len(values))),
    }


def _draw_circular_mean(
    values: Sequence[float],
    *,
    rng: random.Random,
    block_length: int,
) -> float:
    drawn: list[float] = []
    while len(drawn) < len(values):
        start = rng.randrange(len(values))
        drawn.extend(values[(start + offset) % len(values)] for offset in range(block_length))
    return sum(drawn[: len(values)]) / len(values)


def one_sided_pvalue(values: tuple[float, ...], *, seed: int) -> ExactRatioV1:
    if len(values) < 4:
        return make_ratio(1, 1)
    observed = sum(values) / len(values)
    centered = tuple(value - observed for value in values)
    rng = random.Random(seed)
    exceed = 0
    replicates = 4096
    for _ in range(replicates):
        if _draw_circular_mean(centered, rng=rng, block_length=4) >= observed:
            exceed += 1
    return make_ratio(exceed + 1, replicates + 1)


def white_reality_check(
    matrix: tuple[tuple[float, ...], ...],
    *,
    seed: int,
) -> ExactRatioV1:
    if not matrix or any(len(row) != len(matrix[0]) for row in matrix):
        raise MeasurementError("White Reality Check matrix invalid")
    observed = max(sum(row) / len(row) for row in matrix)
    centered = tuple(tuple(value - sum(row) / len(row) for value in row) for row in matrix)
    rng = random.Random(seed)
    exceed = 0
    replicates = 4096
    count = len(matrix[0])
    for _ in range(replicates):
        starts: list[int] = []
        while len(starts) * 4 < count:
            starts.append(rng.randrange(count))
        maxima: list[float] = []
        for row in centered:
            drawn = [row[(start + offset) % count] for start in starts for offset in range(4)][
                :count
            ]
            maxima.append(sum(drawn) / count)
        if max(maxima) >= observed:
            exceed += 1
    return make_ratio(exceed + 1, replicates + 1)


def canonical_trial_ledger(specs: tuple[TrialSpec, ...]) -> TrialLedgerV1:
    return TrialLedgerV1(
        tuple(
            TrialRecordV1(
                trial_id=spec.trial_id,
                family_id="vg9.cross-venue-share-level",
                model_id=spec.trial_id.lower(),
                metric_id="stress-weekly-log-return",
                status=TrialStatus.COMPLETED,
                note="frozen V-G9 level-spread trial",
            )
            for spec in specs
        )
    )


def pbo_packet(
    stress_runs: Mapping[str, Simulation],
    specs: tuple[TrialSpec, ...],
) -> dict[str, object]:
    block_rows: list[tuple[ExactRatioV1, ...]] = []
    for spec in specs:
        values = stress_runs[spec.trial_id].weekly_log_returns
        if len(values) < 24:
            raise MeasurementError("fewer than 24 common development weeks for PBO")
        blocks = tuple(
            make_ratio(round(sum(values[index * 3 : index * 3 + 3]) * RATIO_SCALE), RATIO_SCALE)
            for index in range(8)
        )
        block_rows.append(blocks)
    return pbo_cscv(tuple(block_rows)).as_mapping()


def development_analysis(
    spot: Mapping[str, Mapping[date, SpotBar]],
    usd_m: Mapping[str, Mapping[date, VolumeBar]],
    protocol: Mapping[str, Any],
) -> tuple[dict[str, Any], str | None]:
    specs = trial_specs(protocol)
    dates = formation_dates(date(2025, 8, 25), date(2026, 2, 16))
    scenario_by_id = {scenario.scenario_id: scenario for scenario in scenarios(protocol)}
    trials: dict[str, dict[str, Any]] = {}
    stress_runs: dict[str, Simulation] = {}
    raw_p_values: list[tuple[str, ExactRatioV1 | None]] = []
    for index, spec in enumerate(specs):
        formations = build_formations(spot, usd_m, dates, spec)
        if tuple(item.formation_day for item in formations) != dates:
            raise MeasurementError(f"development formation calendar incomplete for {spec.trial_id}")
        base = simulate(
            spot=spot,
            formations=formations,
            spec=spec,
            scenario=scenario_by_id["BASE"],
            comparator=False,
        )
        stress = simulate(
            spot=spot,
            formations=formations,
            spec=spec,
            scenario=scenario_by_id["STRESS"],
            comparator=False,
        )
        matched = simulate(
            spot=spot,
            formations=formations,
            spec=spec,
            scenario=scenario_by_id["STRESS"],
            comparator=True,
        )
        excess = tuple(
            strategy - benchmark
            for strategy, benchmark in zip(
                stress.weekly_log_returns, matched.weekly_log_returns, strict=True
            )
        )
        bootstrap = bootstrap_packet(stress.weekly_log_returns, seed=2026072909 + index)
        excess_bootstrap = bootstrap_packet(excess, seed=2026073909 + index)
        p_value = one_sided_pvalue(stress.weekly_log_returns, seed=2026074909 + index)
        raw_p_values.append((spec.trial_id, p_value))
        stress_runs[spec.trial_id] = stress
        trials[spec.trial_id] = {
            "spec": {
                "topFraction": str(spec.top_fraction),
                "windowDays": spec.window_days,
            },
            "BASE": base.as_mapping(),
            "STRESS": stress.as_mapping(),
            "matchedSpotShareSTRESS": matched.as_mapping(),
            "stressBootstrap": bootstrap,
            "stressMatchedExcessNetUsdPer1000": text_float(1000.0 * math.expm1(sum(excess))),
            "stressMatchedExcessBootstrap": excess_bootstrap,
            "rawOneSidedP": p_value.as_mapping(),
        }
    ledger = canonical_trial_ledger(specs)
    holm = holm_bonferroni(
        ledger,
        tuple(raw_p_values),
        familywise_alpha_per_myriad=500,
    )
    white = white_reality_check(
        tuple(stress_runs[spec.trial_id].weekly_log_returns for spec in specs),
        seed=2026075909,
    )
    pbo = pbo_packet(stress_runs, specs)
    passing: list[TrialSpec] = []
    pbo_value = require_mapping(pbo.get("pbo"), "pbo.pbo")
    pbo_mantissa = int(str(pbo_value.get("mantissa")))
    for spec in specs:
        trial = trials[spec.trial_id]
        stress = stress_runs[spec.trial_id]
        bootstrap = require_mapping(trial["stressBootstrap"], "stressBootstrap")
        excess_bootstrap = require_mapping(
            trial["stressMatchedExcessBootstrap"], "stressMatchedExcessBootstrap"
        )
        excess_net = float(str(trial["stressMatchedExcessNetUsdPer1000"]))
        gates = {
            "minimumValidWeeks": stress.valid_weeks >= 20,
            "minimumRoundTrips": stress.round_trips >= 40,
            "minimumDistinctSymbols": len(stress.distinct_symbols) >= 8,
            "stressNetPositive": stress.terminal_nav > 1000,
            "stressLowerBoundPositive": float(str(bootstrap.get("terminalNetLowerUsd"))) > 0,
            "stressMatchedExcessPositive": excess_net > 0,
            "stressMatchedExcessLowerBoundPositive": float(
                str(excess_bootstrap.get("terminalNetLowerUsd"))
            )
            > 0,
            "holmPass": spec.trial_id in holm.rejected_trial_ids,
            "whiteRealityCheckPass": white.numerator / white.denominator < 0.05,
            "maximumPbo": pbo_mantissa <= 500_000_000_000,
            "maximumScheduledExitDrawdownPct": stress.maximum_drawdown_pct <= 25,
        }
        trial["gates"] = gates
        if all(gates.values()):
            passing.append(spec)
    champion: TrialSpec | None = None
    if passing:
        champion = max(
            passing,
            key=lambda spec: (
                float(
                    str(
                        require_mapping(trials[spec.trial_id]["stressBootstrap"], "bootstrap").get(
                            "terminalNetLowerUsd"
                        )
                    )
                ),
                stress_runs[spec.trial_id].terminal_nav,
                -spec.window_days,
                -float(spec.top_fraction),
                spec.trial_id,
            ),
        )
    return (
        {
            "schema": "VG9DevelopmentAnalysisV1",
            "calendarWeeks": len(dates),
            "trialLedger": ledger.as_mapping(),
            "trials": trials,
            "holmRejectedTrialIds": list(holm.rejected_trial_ids),
            "whiteRealityCheckP": white.as_mapping(),
            "pbo": pbo,
            "champion": champion.trial_id if champion else None,
            "status": "PASS_CANDIDATE" if champion else "NO_GO",
        },
        champion.trial_id if champion else None,
    )


def holdout_analysis(
    spot: Mapping[str, Mapping[date, SpotBar]],
    usd_m: Mapping[str, Mapping[date, VolumeBar]],
    protocol: Mapping[str, Any],
    champion_id: str,
) -> dict[str, Any]:
    spec = next((item for item in trial_specs(protocol) if item.trial_id == champion_id), None)
    if spec is None:
        raise CustodyError("candidate champion is not a frozen trial")
    dates = formation_dates(date(2026, 3, 2), date(2026, 6, 22))
    formations = build_formations(spot, usd_m, dates, spec)
    if tuple(item.formation_day for item in formations) != dates:
        raise MeasurementError("holdout formation calendar incomplete for champion")
    scenario_by_id = {scenario.scenario_id: scenario for scenario in scenarios(protocol)}
    base = simulate(
        spot=spot,
        formations=formations,
        spec=spec,
        scenario=scenario_by_id["BASE"],
        comparator=False,
    )
    stress = simulate(
        spot=spot,
        formations=formations,
        spec=spec,
        scenario=scenario_by_id["STRESS"],
        comparator=False,
    )
    matched = simulate(
        spot=spot,
        formations=formations,
        spec=spec,
        scenario=scenario_by_id["STRESS"],
        comparator=True,
    )
    excess = tuple(
        strategy - benchmark
        for strategy, benchmark in zip(
            stress.weekly_log_returns, matched.weekly_log_returns, strict=True
        )
    )
    bootstrap = bootstrap_packet(stress.weekly_log_returns, seed=2026076909)
    excess_bootstrap = bootstrap_packet(excess, seed=2026077909)
    excess_net = 1000.0 * math.expm1(sum(excess))
    gates = {
        "minimumValidWeeks": stress.valid_weeks >= 14,
        "minimumRoundTrips": stress.round_trips >= 28,
        "minimumDistinctSymbols": len(stress.distinct_symbols) >= 8,
        "baseNetPositive": base.terminal_nav > 1000,
        "stressNetPositive": stress.terminal_nav > 1000,
        "stressLowerBoundPositive": float(str(bootstrap["terminalNetLowerUsd"])) > 0,
        "stressMatchedExcessPositive": excess_net > 0,
        "stressMatchedExcessLowerBoundPositive": float(str(excess_bootstrap["terminalNetLowerUsd"]))
        > 0,
        "maximumScheduledExitDrawdownPct": stress.maximum_drawdown_pct <= 25,
    }
    return {
        "schema": "VG9HoldoutAnalysisV1",
        "champion": champion_id,
        "BASE": base.as_mapping(),
        "STRESS": stress.as_mapping(),
        "matchedSpotShareSTRESS": matched.as_mapping(),
        "stressBootstrap": bootstrap,
        "stressMatchedExcessNetUsdPer1000": text_float(excess_net),
        "stressMatchedExcessBootstrap": excess_bootstrap,
        "gates": gates,
        "verdict": "GO" if all(gates.values()) else "NO_GO",
        "authority": "NONE",
    }


def build_schedule_plan() -> tuple[SampleSetV1, Any]:
    dates = (
        *formation_dates(date(2025, 8, 25), date(2026, 2, 16)),
        *formation_dates(date(2026, 3, 2), date(2026, 6, 22)),
    )
    samples: list[ValidationSampleV1] = []
    for index, formation_day in enumerate(dates):
        cutoff_ns = int(
            datetime.combine(formation_day, datetime.min.time(), tzinfo=UTC).timestamp()
            * 1_000_000_000
        )
        samples.append(
            ValidationSampleV1(
                sample_id=f"vg9-week-{index:02d}",
                symbol="vg9-portfolio",
                group_id=f"vg9-week-{index:02d}",
                cutoff_ns=cutoff_ns,
                label_end_ns=cutoff_ns + 8 * 86_400 * 1_000_000_000,
                strata=(("partition", "development" if index < 26 else "holdout"),),
                binary_outcome=None,
                gross_edge_ratio=None,
                base_cost_ratio=None,
                quality=QualityState.COMPLETE,
            )
        )
    sample_set = SampleSetV1(
        dataset_id="vg9-weekly-schedule-v1",
        posture=EvidencePosture.REPLAY,
        samples=tuple(samples),
    )
    spec = WalkForwardSpecV1(
        scheme=SplitScheme.EXPANDING,
        fold_count=1,
        max_label_horizon_ns=8 * 86_400 * 1_000_000_000,
        max_feature_lookback_ns=56 * 86_400 * 1_000_000_000,
        embargo_ns=64 * 86_400 * 1_000_000_000,
        min_train_size=1,
        holdout_fraction=make_ratio(17, 43),
        rolling_train_size=None,
    )
    plan = build_walk_forward_plan(sample_set, spec)
    if plan.status is not PlanStatus.VALID:
        raise CustodyError("canonical walk-forward schedule plan is invalid")
    expected_holdout = tuple(sample.sample_id for sample in samples[26:])
    if plan.holdout_sample_ids != expected_holdout:
        raise CustodyError("canonical holdout membership differs from frozen calendar")
    return sample_set, plan


def guarded_open_holdout_schedule(state_root: Path) -> tuple[ValidationSampleV1, ...]:
    candidate_path = state_root / "candidate_seal.v1.json"
    marker_path = state_root / "holdout_opened.v1.json"
    if not candidate_path.is_file() or not marker_path.is_file():
        raise CustodyError("candidate seal and holdout marker must exist before holdout open")
    candidate = read_object(candidate_path)
    marker = read_object(marker_path)
    if marker.get("candidateSealSha256") != sha256_path(candidate_path):
        raise CustodyError("holdout marker does not bind candidate seal")
    samples, plan = build_schedule_plan()
    if candidate.get("walkForwardPlanSha256") != plan.digest().hexdigest:
        raise CustodyError("candidate does not bind canonical walk-forward plan")
    grant = HoldoutGrantV1(
        grant_id="vg9-holdout-open-v1",
        reason="V-G9 candidate sealed after passing frozen development gates",
        plan_digest=plan.digest(),
    )
    return open_holdout(samples, plan, grant)


def _write_exclusive(path: Path, payload: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with path.open("x") as stream:
            json.dump(payload, stream, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
            stream.write("\n")
    except FileExistsError as exc:
        raise CustodyError(f"one-shot artifact already exists: {path.name}") from exc


def _packet_binding() -> dict[str, str]:
    return {
        "freezeSha256": sha256_path(FREEZE_PATH),
        "protocolSha256": sha256_path(PROTOCOL_PATH),
        "sourceManifestSha256": sha256_path(SOURCE_MANIFEST_PATH),
    }


def run_development(state_root: Path) -> dict[str, Any]:
    forbidden = (
        "development_opened.v1.json",
        "development_result.v1.json",
        "candidate_seal.v1.json",
        "holdout_opened.v1.json",
        "result.v1.json",
    )
    if any((state_root / name).exists() for name in forbidden):
        raise CustodyError("development run already consumed or state root contaminated")
    protocol = load_protocol()
    pairs = verify_source_manifest(protocol)
    marker = {
        "schema": "VG9DevelopmentOpenedV1",
        "openedAtFrozenUtc": "2026-07-29T00:00:00Z",
        "archiveBodyOpenCount": 1,
        "sharedArchiveMutationPermitted": False,
        **_packet_binding(),
    }
    marker_path = state_root / "development_opened.v1.json"
    _write_exclusive(marker_path, marker)
    try:
        development_months = month_range("2025-07", "2026-02")
        spot, usd_m = load_pair_bars(pairs, development_months)
        analysis, champion = development_analysis(spot, usd_m, protocol)
        result = {
            "schema": "VG9DevelopmentResultV1",
            "status": analysis["status"],
            "analysis": analysis,
            "developmentMarkerSha256": sha256_path(marker_path),
            **_packet_binding(),
        }
    except VG9Error as exc:
        champion = None
        result = {
            "schema": "VG9DevelopmentResultV1",
            "status": "UNMEASURED",
            "reason": type(exc).__name__,
            "detail": str(exc),
            "analysis": None,
            "developmentMarkerSha256": sha256_path(marker_path),
            **_packet_binding(),
        }
    result_path = state_root / "development_result.v1.json"
    _write_exclusive(result_path, result)
    if champion is not None:
        _, plan = build_schedule_plan()
        candidate = {
            "schema": "VG9CandidateSealV1",
            "champion": champion,
            "developmentResultSha256": sha256_path(result_path),
            "walkForwardPlanSha256": plan.digest().hexdigest,
            **_packet_binding(),
        }
        _write_exclusive(state_root / "candidate_seal.v1.json", candidate)
    return result


def run_holdout(state_root: Path) -> dict[str, Any]:
    if (state_root / "holdout_opened.v1.json").exists() or (state_root / "result.v1.json").exists():
        raise CustodyError("holdout run already consumed")
    candidate_path = state_root / "candidate_seal.v1.json"
    development_path = state_root / "development_result.v1.json"
    if not candidate_path.is_file() or not development_path.is_file():
        raise CustodyError("passing development result and candidate seal are required")
    candidate = read_object(candidate_path)
    development = read_object(development_path)
    if candidate.get("developmentResultSha256") != sha256_path(development_path):
        raise CustodyError("candidate does not bind development result")
    if development.get("status") != "PASS_CANDIDATE":
        raise CustodyError("development did not pass frozen gates")
    for key, value in _packet_binding().items():
        if candidate.get(key) != value:
            raise CustodyError("candidate packet binding drift")
    marker = {
        "schema": "VG9HoldoutOpenedV1",
        "candidateSealSha256": sha256_path(candidate_path),
        "openedAtFrozenUtc": "2026-07-29T00:00:00Z",
        "archiveBodyOpenCount": 1,
    }
    marker_path = state_root / "holdout_opened.v1.json"
    _write_exclusive(marker_path, marker)
    opened = guarded_open_holdout_schedule(state_root)
    if len(opened) != 17:
        raise CustodyError("canonical holdout opener returned unexpected membership")
    protocol = load_protocol()
    try:
        pairs = verify_source_manifest(protocol)
        development_spot, development_usd_m = load_pair_bars(
            pairs, month_range("2025-07", "2026-02")
        )
        holdout_spot, holdout_usd_m = load_pair_bars(pairs, month_range("2026-03", "2026-06"))
        for symbol, series in holdout_spot.items():
            development_spot.setdefault(symbol, {}).update(series)
        for symbol, series in holdout_usd_m.items():
            development_usd_m.setdefault(symbol, {}).update(series)
        champion = candidate.get("champion")
        if not isinstance(champion, str):
            raise CustodyError("candidate champion missing")
        analysis = holdout_analysis(development_spot, development_usd_m, protocol, champion)
        result = {
            "schema": "VG9TerminalResultV1",
            "status": "TERMINAL",
            "verdict": analysis["verdict"],
            "analysis": analysis,
            "candidateSealSha256": sha256_path(candidate_path),
            "holdoutMarkerSha256": sha256_path(marker_path),
            "authority": "NONE",
            "accountEffectiveFees": "UNKNOWN",
            "executableCapacity": "UNKNOWN",
        }
    except VG9Error as exc:
        result = {
            "schema": "VG9TerminalResultV1",
            "status": "TERMINAL",
            "verdict": "UNMEASURED",
            "reason": type(exc).__name__,
            "detail": str(exc),
            "analysis": None,
            "candidateSealSha256": sha256_path(candidate_path),
            "holdoutMarkerSha256": sha256_path(marker_path),
            "authority": "NONE",
            "accountEffectiveFees": "UNKNOWN",
            "executableCapacity": "UNKNOWN",
        }
    _write_exclusive(state_root / "result.v1.json", result)
    return result


def seal_evidence(state_root: Path, target: Path = HERE / "evidence") -> dict[str, Any]:
    """Copy completed one-shot state into a tracked, checksum-bound evidence packet."""

    development_path = state_root / "development_result.v1.json"
    marker_path = state_root / "development_opened.v1.json"
    if not development_path.is_file() or not marker_path.is_file():
        raise CustodyError("development one-shot evidence is incomplete")
    development = read_object(development_path)
    candidate_path = state_root / "candidate_seal.v1.json"
    result_path = state_root / "result.v1.json"
    if candidate_path.exists():
        holdout_path = state_root / "holdout_opened.v1.json"
        if not result_path.is_file() or not holdout_path.is_file():
            raise CustodyError("candidate exists but terminal holdout evidence is incomplete")
        names = (
            "development_opened.v1.json",
            "development_result.v1.json",
            "candidate_seal.v1.json",
            "holdout_opened.v1.json",
            "result.v1.json",
        )
        stage = "HOLDOUT_TERMINAL"
    else:
        if development.get("status") not in {"NO_GO", "UNMEASURED"}:
            raise CustodyError("passing development requires candidate and holdout evidence")
        if result_path.exists() or (state_root / "holdout_opened.v1.json").exists():
            raise CustodyError("failed development cannot have holdout evidence")
        names = ("development_opened.v1.json", "development_result.v1.json")
        stage = "DEVELOPMENT_TERMINAL"
    if target.exists():
        raise CustodyError("tracked evidence directory already exists")
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise CustodyError("cannot create tracked evidence parent") from exc
    source_bytes: dict[str, bytes] = {}
    try:
        for name in names:
            source = state_root / name
            if source.is_symlink() or not source.is_file():
                raise CustodyError(f"state artifact is missing or symlinked: {name}")
            source_bytes[name] = source.read_bytes()
    except OSError as exc:
        raise CustodyError("cannot read one-shot state artifact") from exc
    copied = [{"name": name, "sha256": sha256_bytes(source_bytes[name])} for name in names]
    manifest = {
        "schema": "VG9TrackedEvidenceManifestV1",
        "stage": stage,
        "sourceStateRoot": str(state_root),
        "artifacts": copied,
        "outcomesRecomputedDuringSeal": False,
        **_packet_binding(),
    }
    try:
        staging = Path(tempfile.mkdtemp(prefix=f".{target.name}.staging-", dir=target.parent))
    except OSError as exc:
        raise CustodyError("cannot create evidence staging directory") from exc
    published = False
    try:
        for name in names:
            destination = staging / name
            with destination.open("xb") as stream:
                stream.write(source_bytes[name])
            if sha256_path(destination) != sha256_bytes(source_bytes[name]):
                raise CustodyError(f"staged evidence verification failed: {name}")
        _write_exclusive(staging / "evidence_manifest.v1.json", manifest)
        sums = "".join(f"{row['sha256']}  {row['name']}\n" for row in copied) + (
            f"{sha256_path(staging / 'evidence_manifest.v1.json')}  evidence_manifest.v1.json\n"
        )
        with (staging / "SHA256SUMS").open("x") as stream:
            stream.write(sums)
        for line in sums.splitlines():
            digest, name = line.split("  ", 1)
            if sha256_path(staging / name) != digest:
                raise CustodyError(f"staged checksum verification failed: {name}")
        staging.rename(target)
        published = True
    except OSError as exc:
        raise CustodyError("atomic tracked evidence staging failed") from exc
    finally:
        if not published and staging.is_dir():
            shutil.rmtree(staging, ignore_errors=True)
    return manifest


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser(
        "source-manifest",
        help="print sidecar/file-metadata manifest without reading ZIP bodies",
    )
    development = subparsers.add_parser("development")
    development.add_argument("--state-root", type=Path, default=DEFAULT_STATE_ROOT)
    holdout = subparsers.add_parser("holdout")
    holdout.add_argument("--state-root", type=Path, default=DEFAULT_STATE_ROOT)
    seal = subparsers.add_parser("seal")
    seal.add_argument("--state-root", type=Path, default=DEFAULT_STATE_ROOT)
    seal.add_argument("--target", type=Path, default=HERE / "evidence")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.command == "source-manifest":
            print(json.dumps(build_source_manifest(load_protocol()), indent=2, sort_keys=True))
            return 0
        if args.command == "development":
            print(
                json.dumps(
                    run_development(args.state_root.resolve()),
                    ensure_ascii=False,
                    sort_keys=True,
                )
            )
            return 0
        if args.command == "holdout":
            print(
                json.dumps(
                    run_holdout(args.state_root.resolve()),
                    ensure_ascii=False,
                    sort_keys=True,
                )
            )
            return 0
        if args.command == "seal":
            print(
                json.dumps(
                    seal_evidence(args.state_root.resolve(), args.target.resolve()),
                    ensure_ascii=False,
                    sort_keys=True,
                )
            )
            return 0
        raise AssertionError("unreachable command")
    except VG9Error as exc:
        print(f"VG9_ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
