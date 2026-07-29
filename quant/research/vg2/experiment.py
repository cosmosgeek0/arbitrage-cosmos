"""Frozen public-only V-G2 volume-shock continuation experiment.

The lifecycle intentionally separates byte inventory, development selection, the
single holdout open, and verifier-only reporting.  Only the inventory command may
run before ``freeze.v1.json`` exists, and it never opens a ZIP member.
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
import sys
import tempfile
import zipfile
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal, getcontext
from pathlib import Path
from typing import Any, cast

getcontext().prec = 50

PACKET = Path(__file__).resolve().parent
PROTOCOL_PATH = PACKET / "protocol.v1.json"
SOURCE_MANIFEST_PATH = PACKET / "source_manifest.v1.json"
FREEZE_PATH = PACKET / "freeze.v1.json"
MARKER_PATH = PACKET / "run-marker.v1.json"
DEVELOPMENT_PATH = PACKET / "development.v1.json"
SELECTION_PATH = PACKET / "selection.v1.json"
RESULT_PATH = PACKET / "result.v1.json"
SHA256SUMS_PATH = PACKET / "SHA256SUMS"

DAY_US = 86_400_000_000
DAY_MS = 86_400_000
ZERO = Decimal(0)
ONE = Decimal(1)
INITIAL_USD = Decimal("1000")
FEE_RATE = Decimal("0.001")
BASE_ADVERSE = Decimal("0.001")
STRESS_ADVERSE = Decimal("0.0025")
PARTICIPATION = Decimal("0.0001")
MIN_ADV = Decimal("5000000")
ALPHA = 0.05
BOOTSTRAP_SEED = 421337
BOOTSTRAP_REPLICATES = 4096
BOOTSTRAP_BLOCK = 7

JsonObject = dict[str, Any]


class ContractError(RuntimeError):
    """A frozen protocol, custody, or lifecycle contract failed."""


class MeasurementError(RuntimeError):
    """The preregistered estimate cannot be measured from admitted evidence."""


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
class SelectedAsset:
    symbol: str
    shock: float
    signal_return: float
    prior_adv: Decimal


@dataclass(slots=True)
class Position:
    symbol: str
    allocation: Decimal
    quantity: Decimal
    raw_entry: Decimal
    adverse_entry: Decimal
    exit_day: date
    prior_adv: Decimal


@dataclass(slots=True)
class Sleeve:
    cash: Decimal
    positions: list[Position] = field(default_factory=list)


@dataclass(slots=True)
class TradeAccounting:
    symbol: str
    allocation: Decimal
    gross_pnl: Decimal
    entry_fee_cost: Decimal
    exit_fee_cost: Decimal
    adverse_execution_cost: Decimal
    net_pnl: Decimal


@dataclass(slots=True)
class Simulation:
    trial: Trial
    cost_label: str
    final_nav: Decimal
    net_usd: Decimal
    gross_pnl: Decimal
    entry_fee_cost: Decimal
    exit_fee_cost: Decimal
    adverse_execution_cost: Decimal
    daily_nav: list[tuple[date, Decimal]]
    daily_returns: list[tuple[date, float]]
    max_drawdown: Decimal
    valid_cohort_days: int
    selected_allocations: int
    skipped_entries: int
    round_trips: int
    distinct_assets: set[str]
    capacity_proxy_usd: Decimal | None
    top_asset_gross_profit_share: Decimal
    top_five_trade_gross_profit_share: Decimal


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
        raise ContractError(f"{path.name} must contain a JSON object")
    return cast(JsonObject, value)


def write_json_once(path: Path, value: object) -> None:
    if path.exists():
        raise ContractError(f"refusing to overwrite {path.name}")
    write_json_replace(path, value)


def write_json_replace(path: Path, value: object) -> None:
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


def exact_decimal(value: Decimal, places: int = 8) -> str:
    quantum = Decimal(1).scaleb(-places)
    return format(value.quantize(quantum), "f")


def parse_day(value: str) -> date:
    return date.fromisoformat(value)


def days(start: date, end: date) -> Iterable[date]:
    current = start
    while current <= end:
        yield current
        current += timedelta(days=1)


def protocol() -> JsonObject:
    value = load_json(PROTOCOL_PATH)
    if value.get("version") != "VG2ProtocolV1":
        raise ContractError("unexpected protocol version")
    return value


def trials() -> tuple[Trial, ...]:
    result: list[Trial] = []
    for lookback in (10, 20, 40):
        for top_text in ("0.10", "0.20"):
            for hold in (1, 3):
                top = Decimal(top_text)
                trial_id = f"VG2-L{lookback:02d}-Q{int(top * 100):02d}-H{hold}"
                result.append(Trial(trial_id, lookback, top, hold))
    return tuple(result)


def verify_sidecar(sidecar: bytes, archive_name: str, archive_sha: str) -> None:
    try:
        line = sidecar.decode("ascii").strip()
    except UnicodeDecodeError as exc:
        raise ContractError(f"non-ASCII checksum sidecar for {archive_name}") from exc
    fields = line.split()
    if len(fields) != 2:
        raise ContractError(f"invalid checksum grammar for {archive_name}")
    advertised, filename = fields
    if advertised.lower() != archive_sha:
        raise ContractError(f"official checksum mismatch for {archive_name}")
    if filename.lstrip("*") != archive_name:
        raise ContractError(f"checksum filename mismatch for {archive_name}")


def inventory(state_root: Path) -> JsonObject:
    if FREEZE_PATH.exists() or MARKER_PATH.exists():
        raise ContractError("inventory is forbidden after freeze or run authority exists")
    if SOURCE_MANIFEST_PATH.exists():
        raise ContractError("source manifest already exists")

    proto = protocol()
    expected_root = Path(cast(JsonObject, proto["data"])["sourceRoot"])
    if state_root.resolve() != expected_root.resolve():
        raise ContractError("state root differs from the frozen protocol")

    acquisition_path = state_root / "acquisition-manifest.v1.json"
    discovery_path = state_root / "discovery.v1.json"
    expected_acquisition = cast(JsonObject, proto["data"])["sourceAcquisitionManifestSha256"]
    expected_discovery = cast(JsonObject, proto["data"])["discoverySha256"]
    if sha256_file(acquisition_path) != expected_acquisition:
        raise ContractError("acquisition manifest digest mismatch")
    if sha256_file(discovery_path) != expected_discovery:
        raise ContractError("discovery digest mismatch")

    acquisition = load_json(acquisition_path)
    discovery = load_json(discovery_path)
    universe_obj = cast(JsonObject, discovery["universe"])
    symbols = tuple(cast(list[str], universe_obj["symbols"]))
    if len(symbols) != len(set(symbols)) or tuple(sorted(symbols)) != symbols:
        raise ContractError("frozen discovery universe is not unique and sorted")
    universe = set(symbols)

    data = cast(JsonObject, proto["data"])
    months = set(cast(list[str], data["developmentArchiveMonths"]))
    months.update(cast(list[str], data["holdoutArchiveMonths"]))
    records: list[JsonObject] = []
    seen: set[tuple[str, str]] = set()
    artifact_pairs = cast(list[JsonObject], acquisition["artifactPairs"])
    for source in artifact_pairs:
        symbol = cast(str, source["symbol"])
        month = cast(str, source["month"])
        if symbol not in universe or month not in months:
            continue
        identity = (symbol, month)
        if identity in seen:
            raise ContractError(f"duplicate acquisition pair {symbol} {month}")
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
        if archive_sha != source["zipSha256"]:
            raise ContractError(f"archive digest mismatch for {symbol} {month}")
        if sidecar_sha != source["checksumSha256"]:
            raise ContractError(f"sidecar digest mismatch for {symbol} {month}")
        if len(archive_raw) != source["zipBytes"]:
            raise ContractError(f"archive byte length mismatch for {symbol} {month}")
        if len(sidecar_raw) != source["checksumBytes"]:
            raise ContractError(f"sidecar byte length mismatch for {symbol} {month}")
        verify_sidecar(sidecar_raw, archive_name, archive_sha)
        pair_value = json.loads(pair_raw)
        if not isinstance(pair_value, dict):
            raise ContractError(f"invalid pair manifest for {symbol} {month}")
        if (
            pair_value.get("symbol") != symbol
            or pair_value.get("month") != month
            or pair_value.get("zipSha256") != archive_sha
            or pair_value.get("checksumSha256") != sidecar_sha
        ):
            raise ContractError(f"pair manifest binding mismatch for {symbol} {month}")
        key = cast(str, source["zipKey"])
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
                "zipUrl": f"https://data.binance.vision/{key}",
            }
        )
    records.sort(key=lambda row: (cast(str, row["symbol"]), cast(str, row["month"])))
    if not records:
        raise ContractError("no admitted source records")
    month_counts = {
        month: sum(1 for row in records if row["month"] == month) for month in sorted(months)
    }
    symbol_count = len({cast(str, row["symbol"]) for row in records})
    normalized_digest = sha256_bytes(canonical_bytes(records))
    manifest = {
        "acquisitionManifestBytes": acquisition_path.stat().st_size,
        "acquisitionManifestSha256": expected_acquisition,
        "archiveBodiesOpened": False,
        "authenticatedAtUtc": utc_now(),
        "discoveryBytes": discovery_path.stat().st_size,
        "discoverySha256": expected_discovery,
        "interval": "1d",
        "monthCounts": month_counts,
        "normalizedRecordSha256": normalized_digest,
        "recordCount": len(records),
        "records": records,
        "schema": "VG2SourceManifestV1",
        "sourceAcquisitionCompletedAtUtc": acquisition.get("completedAtUtc"),
        "sourceRoot": str(state_root.resolve()),
        "symbolCount": symbol_count,
        "universeCount": len(symbols),
        "universeSha256": universe_obj["sha256"],
    }
    write_json_once(SOURCE_MANIFEST_PATH, manifest)
    return manifest


def verify_freeze() -> JsonObject:
    freeze = load_json(FREEZE_PATH)
    if freeze.get("schema") != "VG2FreezeV1":
        raise ContractError("unexpected freeze schema")
    expected: dict[str, Path] = {
        "evaluatorSha256": Path(__file__).resolve(),
        "officialSourceResearchSha256": PACKET / "OFFICIAL_SOURCE_RESEARCH.md",
        "protocolSha256": PROTOCOL_PATH,
        "readmeSha256": PACKET / "README.md",
        "sourceManifestSha256": SOURCE_MANIFEST_PATH,
        "testsSha256": PACKET / "test_experiment.py",
    }
    for field_name, path in expected.items():
        if freeze.get(field_name) != sha256_file(path):
            raise ContractError(f"freeze mismatch: {field_name}")
    if freeze.get("sourceRoot") != protocol()["data"]["sourceRoot"]:
        raise ContractError("freeze source root mismatch")
    if freeze.get("holdoutMaximumOpenCount") != 1:
        raise ContractError("freeze holdout authority mismatch")
    return freeze


def manifest_records(months: set[str]) -> tuple[JsonObject, ...]:
    manifest = load_json(SOURCE_MANIFEST_PATH)
    if manifest.get("schema") != "VG2SourceManifestV1":
        raise ContractError("unexpected source manifest schema")
    if manifest.get("archiveBodiesOpened") is not False:
        raise ContractError("source manifest must predate archive-body access")
    records = cast(list[JsonObject], manifest["records"])
    selected = tuple(row for row in records if row["month"] in months)
    if not selected:
        raise ContractError("partition has no source records")
    return selected


def parse_archive(record: JsonObject) -> tuple[list[Bar], JsonObject]:
    symbol = cast(str, record["symbol"])
    month = cast(str, record["month"])
    archive_path = Path(cast(str, record["zipPath"]))
    archive_raw = archive_path.read_bytes()
    if len(archive_raw) != record["zipBytes"]:
        raise MeasurementError(f"archive length changed: {symbol} {month}")
    if sha256_bytes(archive_raw) != record["zipSha256"]:
        raise MeasurementError(f"archive digest changed: {symbol} {month}")
    expected_member = f"{symbol}-1d-{month}.csv"
    with zipfile.ZipFile(io.BytesIO(archive_raw), "r") as archive:
        members = [item for item in archive.infolist() if not item.is_dir()]
        if len(members) != 1 or members[0].filename != expected_member:
            raise MeasurementError(f"unexpected ZIP member for {symbol} {month}")
        raw_csv = archive.read(members[0])
    try:
        text = raw_csv.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise MeasurementError(f"non-UTF8 CSV for {symbol} {month}") from exc

    valid: list[Bar] = []
    partial_count = 0
    raw_count = 0
    previous_day: date | None = None
    for row in csv.reader(io.StringIO(text)):
        raw_count += 1
        if len(row) != 12:
            raise MeasurementError(f"wrong kline field count for {symbol} {month}")
        try:
            open_us = int(row[0])
            close_us = int(row[6])
            open_price = Decimal(row[1])
            high = Decimal(row[2])
            low = Decimal(row[3])
            close = Decimal(row[4])
            quote_volume = Decimal(row[7])
        except (ValueError, ArithmeticError) as exc:
            raise MeasurementError(f"invalid kline scalar for {symbol} {month}") from exc
        if open_us < 1_000_000_000_000_000 or close_us < 1_000_000_000_000_000:
            raise MeasurementError(f"2025+ timestamp is not microseconds: {symbol} {month}")
        if open_us % DAY_US != 0:
            raise MeasurementError(f"daily open is not UTC midnight: {symbol} {month}")
        if close_us != open_us + DAY_US - 1:
            if open_us <= close_us < open_us + DAY_US - 1:
                partial_count += 1
                continue
            raise MeasurementError(f"invalid daily close boundary: {symbol} {month}")
        if (
            min(open_price, high, low, close) <= ZERO
            or quote_volume < ZERO
            or high < max(open_price, close)
            or low > min(open_price, close)
        ):
            raise MeasurementError(f"invalid OHLCV values: {symbol} {month}")
        day = datetime.fromtimestamp((open_us // 1000) / 1000, tz=UTC).date()
        if day.strftime("%Y-%m") != month:
            raise MeasurementError(f"row month mismatch: {symbol} {month}")
        if previous_day is not None and day <= previous_day:
            raise MeasurementError(f"duplicate or unsorted day: {symbol} {month}")
        previous_day = day
        valid.append(Bar(day, open_price, high, low, close, quote_volume))
    if raw_count == 0:
        raise MeasurementError(f"empty archive: {symbol} {month}")
    summary: JsonObject = {
        "csvBytes": len(raw_csv),
        "firstValidDay": None if not valid else valid[0].day.isoformat(),
        "lastValidDay": None if not valid else valid[-1].day.isoformat(),
        "month": month,
        "partialRowCount": partial_count,
        "rawRowCount": raw_count,
        "symbol": symbol,
        "validRowCount": len(valid),
        "zipSha256": record["zipSha256"],
    }
    return valid, summary


def load_bars(months: set[str]) -> tuple[dict[str, dict[date, Bar]], list[JsonObject]]:
    by_symbol: dict[str, dict[date, Bar]] = {}
    summaries: list[JsonObject] = []
    for record in manifest_records(months):
        rows, summary = parse_archive(record)
        symbol = cast(str, record["symbol"])
        symbol_rows = by_symbol.setdefault(symbol, {})
        for bar in rows:
            if bar.day in symbol_rows:
                raise MeasurementError(f"duplicate full bar across archives: {symbol} {bar.day}")
            symbol_rows[bar.day] = bar
        summaries.append(summary)
    summaries.sort(key=lambda row: (cast(str, row["symbol"]), cast(str, row["month"])))
    return by_symbol, summaries


def previous_days(current: date, count: int) -> list[date]:
    return [current - timedelta(days=offset) for offset in range(count, 0, -1)]


def select_assets(
    bars: dict[str, dict[date, Bar]],
    signal_day: date,
    trial: Trial,
) -> tuple[list[SelectedAsset], int]:
    risk: list[SelectedAsset] = []
    required = max(40, trial.lookback, 30)
    history_days = previous_days(signal_day, required)
    for symbol in sorted(bars):
        series = bars[symbol]
        current = series.get(signal_day)
        if current is None:
            continue
        if any(day not in series for day in history_days):
            continue
        prior_30 = [series[day].quote_volume for day in history_days[-30:]]
        prior_adv = statistics.median(prior_30)
        if prior_adv < MIN_ADV or current.quote_volume <= ZERO:
            continue
        prior_close = series[signal_day - timedelta(days=1)].close
        signal_return = math.log(float(current.close / prior_close))
        log_history = [
            math.log(float(series[day].quote_volume))
            for day in history_days[-trial.lookback :]
            if series[day].quote_volume > ZERO
        ]
        if len(log_history) != trial.lookback:
            continue
        shock = math.log(float(current.quote_volume)) - statistics.median(log_history)
        risk.append(SelectedAsset(symbol, shock, signal_return, prior_adv))
    risk_count = len(risk)
    positive = [asset for asset in risk if asset.shock > 0.0 and asset.signal_return > 0.0]
    positive.sort(key=lambda item: (-item.shock, -item.signal_return, item.symbol.encode()))
    target = max(3, math.ceil(float(trial.top_fraction) * risk_count))
    if risk_count < 20 or len(positive) < 3:
        return [], risk_count
    return positive[:target], risk_count


def sell_value(position: Position, raw_exit: Decimal, adverse: Decimal) -> Decimal:
    adverse_exit = raw_exit * (ONE - adverse)
    return position.quantity * adverse_exit * (ONE - FEE_RATE)


def trade_accounting(
    position: Position,
    raw_exit: Decimal,
    adverse: Decimal,
) -> TradeAccounting:
    gross_final = position.allocation * raw_exit / position.raw_entry
    after_entry_fee = gross_final * (ONE - FEE_RATE)
    after_exit_fee = after_entry_fee * (ONE - FEE_RATE)
    actual_final = sell_value(position, raw_exit, adverse)
    gross_pnl = gross_final - position.allocation
    entry_fee_cost = gross_final - after_entry_fee
    exit_fee_cost = after_entry_fee - after_exit_fee
    adverse_cost = after_exit_fee - actual_final
    net_pnl = actual_final - position.allocation
    identity = gross_pnl - entry_fee_cost - exit_fee_cost - adverse_cost
    if abs(identity - net_pnl) > Decimal("0.00000000000000000001"):
        raise ContractError("trade accounting identity failed")
    return TradeAccounting(
        position.symbol,
        position.allocation,
        gross_pnl,
        entry_fee_cost,
        exit_fee_cost,
        adverse_cost,
        net_pnl,
    )


def simulate(
    bars: dict[str, dict[date, Bar]],
    trial: Trial,
    start: date,
    end: date,
    adverse: Decimal,
    cost_label: str,
) -> Simulation:
    sleeves = [Sleeve(INITIAL_USD / trial.hold_days) for _ in range(trial.hold_days)]
    daily_nav: list[tuple[date, Decimal]] = []
    daily_returns: list[tuple[date, float]] = []
    accounts: list[TradeAccounting] = []
    valid_cohort_days = 0
    selected_allocations = 0
    skipped_entries = 0
    capacity_scales: list[Decimal] = []
    previous_nav = INITIAL_USD

    for current in days(start, end):
        sleeve_index = current.toordinal() % trial.hold_days
        sleeve = sleeves[sleeve_index]
        if sleeve.positions:
            if any(position.exit_day != current for position in sleeve.positions):
                raise ContractError("sleeve reuse before the frozen exit day")
            for position in sleeve.positions:
                exit_bar = bars.get(position.symbol, {}).get(current)
                if exit_bar is None:
                    raise MeasurementError(
                        f"missing successful exit: {position.symbol} {current.isoformat()}"
                    )
                accounting = trade_accounting(position, exit_bar.open, adverse)
                sleeve.cash += position.allocation + accounting.net_pnl
                accounts.append(accounting)
            sleeve.positions.clear()

        latest_entry = end - timedelta(days=trial.hold_days)
        if current <= latest_entry:
            signal_day = current - timedelta(days=1)
            selected, risk_count = select_assets(bars, signal_day, trial)
            if risk_count >= 20:
                valid_cohort_days += 1
            if selected:
                selected_allocations += len(selected)
                allocation = sleeve.cash / len(selected)
                for asset in selected:
                    entry_bar = bars.get(asset.symbol, {}).get(current)
                    if entry_bar is None:
                        skipped_entries += 1
                        continue
                    adverse_entry = entry_bar.open * (ONE + adverse)
                    quantity = allocation * (ONE - FEE_RATE) / adverse_entry
                    sleeve.cash -= allocation
                    sleeve.positions.append(
                        Position(
                            symbol=asset.symbol,
                            allocation=allocation,
                            quantity=quantity,
                            raw_entry=entry_bar.open,
                            adverse_entry=adverse_entry,
                            exit_day=current + timedelta(days=trial.hold_days),
                            prior_adv=asset.prior_adv,
                        )
                    )
                    capacity_scales.append(
                        asset.prior_adv * PARTICIPATION / allocation
                        if allocation > ZERO
                        else Decimal("Infinity")
                    )

        nav = ZERO
        for current_sleeve in sleeves:
            nav += current_sleeve.cash
            for position in current_sleeve.positions:
                mark = bars.get(position.symbol, {}).get(current)
                if mark is None:
                    raise MeasurementError(
                        f"missing mark while position open: {position.symbol} {current}"
                    )
                nav += sell_value(position, mark.close, adverse)
        daily_nav.append((current, nav))
        daily_return = float(nav / previous_nav - ONE)
        daily_returns.append((current, daily_return))
        previous_nav = nav

    if any(sleeve.positions for sleeve in sleeves):
        raise ContractError("partition ended with an open position")
    final_nav = sum((sleeve.cash for sleeve in sleeves), ZERO)
    if abs(final_nav - daily_nav[-1][1]) > Decimal("0.00000000000000000001"):
        raise ContractError("terminal NAV reconciliation failed")

    gross = sum((item.gross_pnl for item in accounts), ZERO)
    entry_fees = sum((item.entry_fee_cost for item in accounts), ZERO)
    exit_fees = sum((item.exit_fee_cost for item in accounts), ZERO)
    adverse_cost = sum((item.adverse_execution_cost for item in accounts), ZERO)
    net = final_nav - INITIAL_USD
    if abs(gross - entry_fees - exit_fees - adverse_cost - net) > Decimal("0.000001"):
        raise ContractError("portfolio accounting identity failed")

    peak = INITIAL_USD
    maximum_drawdown = ZERO
    for _, nav in daily_nav:
        if nav > peak:
            peak = nav
        drawdown = (peak - nav) / peak
        maximum_drawdown = max(maximum_drawdown, drawdown)

    positive_gross = [item for item in accounts if item.gross_pnl > ZERO]
    total_positive = sum((item.gross_pnl for item in positive_gross), ZERO)
    if total_positive > ZERO:
        by_asset: dict[str, Decimal] = {}
        for item in positive_gross:
            by_asset[item.symbol] = by_asset.get(item.symbol, ZERO) + item.gross_pnl
        top_asset_share = max(by_asset.values()) / total_positive
        top_five_share = (
            sum(sorted((item.gross_pnl for item in positive_gross), reverse=True)[:5], ZERO)
            / total_positive
        )
    else:
        top_asset_share = ONE
        top_five_share = ONE
    capacity = None
    if capacity_scales:
        capacity = INITIAL_USD * min(capacity_scales)

    return Simulation(
        trial=trial,
        cost_label=cost_label,
        final_nav=final_nav,
        net_usd=net,
        gross_pnl=gross,
        entry_fee_cost=entry_fees,
        exit_fee_cost=exit_fees,
        adverse_execution_cost=adverse_cost,
        daily_nav=daily_nav,
        daily_returns=daily_returns,
        max_drawdown=maximum_drawdown,
        valid_cohort_days=valid_cohort_days,
        selected_allocations=selected_allocations,
        skipped_entries=skipped_entries,
        round_trips=len(accounts),
        distinct_assets={item.symbol for item in accounts},
        capacity_proxy_usd=capacity,
        top_asset_gross_profit_share=top_asset_share,
        top_five_trade_gross_profit_share=top_five_share,
    )


def simulation_mapping(simulation: Simulation, *, include_series: bool) -> JsonObject:
    coverage = (
        ONE
        if simulation.selected_allocations == 0
        else Decimal(simulation.round_trips) / Decimal(simulation.selected_allocations)
    )
    value: JsonObject = {
        "accountEffectiveFee": "UNKNOWN",
        "adverseExecutionCostUsd": exact_decimal(simulation.adverse_execution_cost),
        "capacityProxyUsd": (
            None
            if simulation.capacity_proxy_usd is None
            else exact_decimal(simulation.capacity_proxy_usd, 2)
        ),
        "costLabel": simulation.cost_label,
        "distinctAssetCount": len(simulation.distinct_assets),
        "entryCoverage": exact_decimal(coverage, 6),
        "entryFeeCostUsd": exact_decimal(simulation.entry_fee_cost),
        "executableCapacity": "UNKNOWN",
        "exitFeeCostUsd": exact_decimal(simulation.exit_fee_cost),
        "finalNavUsd": exact_decimal(simulation.final_nav),
        "grossPricePnlUsd": exact_decimal(simulation.gross_pnl),
        "historicalSpreadImpact": "UNKNOWN",
        "maximumDrawdown": exact_decimal(simulation.max_drawdown, 8),
        "netUsdPer1000": exact_decimal(simulation.net_usd),
        "roundTripCount": simulation.round_trips,
        "selectedAllocationCount": simulation.selected_allocations,
        "skippedEntryCount": simulation.skipped_entries,
        "topAssetGrossProfitShare": exact_decimal(simulation.top_asset_gross_profit_share, 8),
        "topFiveTradeGrossProfitShare": exact_decimal(
            simulation.top_five_trade_gross_profit_share, 8
        ),
        "validCohortDayCount": simulation.valid_cohort_days,
    }
    if include_series:
        value["dailyNav"] = [
            {"date": day.isoformat(), "navUsd": exact_decimal(nav)}
            for day, nav in simulation.daily_nav
        ]
        value["dailyReturns"] = [
            {"date": day.isoformat(), "return": format(value_float, ".17g")}
            for day, value_float in simulation.daily_returns
        ]
    return value


def circular_draw_indices(
    count: int,
    block_length: int,
    rng: random.Random,
) -> list[int]:
    result: list[int] = []
    while len(result) < count:
        start = rng.randrange(count)
        for offset in range(block_length):
            result.append((start + offset) % count)
            if len(result) == count:
                break
    return result


def compounded_net(values: Sequence[float]) -> float:
    nav = 1000.0
    for value in values:
        nav *= 1.0 + value
    return nav - 1000.0


def percentile(values: list[float], probability: float) -> float:
    if not values:
        raise ContractError("percentile requires values")
    values.sort()
    index = max(0, min(len(values) - 1, math.ceil(probability * len(values)) - 1))
    return values[index]


def bootstrap_report(values: Sequence[float], seed_offset: int = 0) -> JsonObject:
    if len(values) < BOOTSTRAP_BLOCK:
        return {
            "lowerNetUsdPer1000": None,
            "oneSidedPValue": None,
            "reason": "INSUFFICIENT_DAILY_RETURNS",
            "status": "UNAVAILABLE",
            "upperNetUsdPer1000": None,
        }
    rng = random.Random(BOOTSTRAP_SEED + seed_offset)
    mean_value = statistics.fmean(values)
    centered = [value - mean_value for value in values]
    nets: list[float] = []
    exceed = 0
    for _ in range(BOOTSTRAP_REPLICATES):
        indices = circular_draw_indices(len(values), BOOTSTRAP_BLOCK, rng)
        sample = [values[index] for index in indices]
        nets.append(compounded_net(sample))
        centered_mean = statistics.fmean(centered[index] for index in indices)
        if centered_mean >= mean_value:
            exceed += 1
    return {
        "blockLengthDays": BOOTSTRAP_BLOCK,
        "coveragePerMyriad": 9500,
        "lowerNetUsdPer1000": format(percentile(nets.copy(), 0.025), ".10f"),
        "oneSidedPValue": format((exceed + 1) / (BOOTSTRAP_REPLICATES + 1), ".10f"),
        "pointNetUsdPer1000": format(compounded_net(values), ".10f"),
        "replicates": BOOTSTRAP_REPLICATES,
        "seed": BOOTSTRAP_SEED + seed_offset,
        "status": "AVAILABLE",
        "upperNetUsdPer1000": format(percentile(nets.copy(), 0.975), ".10f"),
    }


def holm_report(p_values: dict[str, float]) -> JsonObject:
    ordered = sorted(p_values.items(), key=lambda item: (item[1], item[0]))
    decisions: list[JsonObject] = []
    still_rejecting = True
    rejected: list[str] = []
    running_adjusted = 0.0
    count = len(ordered)
    for rank, (trial_id, p_value) in enumerate(ordered, start=1):
        threshold = ALPHA / (count - rank + 1)
        running_adjusted = max(running_adjusted, min(1.0, p_value * (count - rank + 1)))
        selected = still_rejecting and p_value < threshold
        if selected:
            rejected.append(trial_id)
        else:
            still_rejecting = False
        decisions.append(
            {
                "adjustedPValue": format(running_adjusted, ".10f"),
                "rawPValue": format(p_value, ".10f"),
                "rejected": selected,
                "threshold": format(threshold, ".10f"),
                "trialId": trial_id,
            }
        )
    return {
        "alpha": format(ALPHA, ".2f"),
        "decisions": decisions,
        "rejectedTrialIds": sorted(rejected),
        "testedCount": count,
    }


def white_reality_check(
    matrix: Mapping[str, Sequence[float]],
) -> JsonObject:
    ordered_ids = sorted(matrix)
    lengths = {len(matrix[trial_id]) for trial_id in ordered_ids}
    if len(lengths) != 1 or not lengths or next(iter(lengths)) < BOOTSTRAP_BLOCK:
        return {"pValue": None, "reason": "MATRIX_SHAPE_INVALID", "status": "UNAVAILABLE"}
    count = next(iter(lengths))
    means = {trial_id: statistics.fmean(matrix[trial_id]) for trial_id in ordered_ids}
    observed = max(means.values())
    centered = {
        trial_id: [value - means[trial_id] for value in matrix[trial_id]]
        for trial_id in ordered_ids
    }
    rng = random.Random(BOOTSTRAP_SEED + 90_000)
    exceed = 0
    for _ in range(BOOTSTRAP_REPLICATES):
        indices = circular_draw_indices(count, BOOTSTRAP_BLOCK, rng)
        bootstrap_max = max(
            statistics.fmean(centered[trial_id][index] for index in indices)
            for trial_id in ordered_ids
        )
        if bootstrap_max >= observed:
            exceed += 1
    return {
        "observedMaximumMeanDailyReturn": format(observed, ".17g"),
        "pValue": format((exceed + 1) / (BOOTSTRAP_REPLICATES + 1), ".10f"),
        "replicates": BOOTSTRAP_REPLICATES,
        "status": "AVAILABLE",
        "testedCount": len(ordered_ids),
    }


def sharpe(values: Sequence[float]) -> float:
    if len(values) < 2:
        return float("-inf")
    deviation = statistics.stdev(values)
    if deviation == 0:
        return float("-inf") if statistics.fmean(values) <= 0 else float("inf")
    return statistics.fmean(values) / deviation


def pbo_report(matrix: Mapping[str, Sequence[float]]) -> JsonObject:
    ordered_ids = sorted(matrix)
    lengths = {len(matrix[trial_id]) for trial_id in ordered_ids}
    if len(lengths) != 1 or not lengths:
        return {"pbo": None, "reason": "MATRIX_SHAPE_INVALID", "status": "UNAVAILABLE"}
    count = next(iter(lengths))
    if count < 8:
        return {"pbo": None, "reason": "INSUFFICIENT_DAYS", "status": "UNAVAILABLE"}
    blocks: list[list[int]] = [[] for _ in range(8)]
    for index in range(count):
        block = min(7, index * 8 // count)
        blocks[block].append(index)
    underperform = 0
    degradations: list[float] = []
    rank_logits: list[float] = []
    split_count = 0
    for in_blocks in itertools.combinations(range(8), 4):
        split_count += 1
        in_set = set(in_blocks)
        in_indices = [index for block in in_set for index in blocks[block]]
        out_indices = [
            index for block in range(8) if block not in in_set for index in blocks[block]
        ]
        in_scores = {
            trial_id: sharpe([matrix[trial_id][index] for index in in_indices])
            for trial_id in ordered_ids
        }
        champion = max(ordered_ids, key=lambda trial_id: (in_scores[trial_id], trial_id))
        out_scores = {
            trial_id: sharpe([matrix[trial_id][index] for index in out_indices])
            for trial_id in ordered_ids
        }
        ordered_out = sorted(ordered_ids, key=lambda trial_id: (out_scores[trial_id], trial_id))
        rank = ordered_out.index(champion) + 1
        percentile_rank = rank / (len(ordered_ids) + 1)
        if percentile_rank <= 0.5:
            underperform += 1
        clipped = min(max(percentile_rank, 1e-12), 1 - 1e-12)
        rank_logits.append(math.log(clipped / (1 - clipped)))
        degradations.append(out_scores[champion] - in_scores[champion])
    return {
        "blockCount": 8,
        "diagnosticOnly": true_json(),
        "medianOosSharpeDegradation": format(statistics.median(degradations), ".10f"),
        "medianRankLogit": format(statistics.median(rank_logits), ".10f"),
        "pbo": format(underperform / split_count, ".10f"),
        "splitCount": split_count,
        "status": "AVAILABLE",
        "underperformCount": underperform,
    }


def true_json() -> bool:
    """Return a typed JSON boolean without truthy sentinel shortcuts."""

    return True


def concatenate_fold_returns(simulations: Sequence[Simulation]) -> list[float]:
    return [value for simulation in simulations for _, value in simulation.daily_returns]


def development_command(state_root: Path) -> JsonObject:
    freeze = verify_freeze()
    if any(path.exists() for path in (MARKER_PATH, DEVELOPMENT_PATH, SELECTION_PATH, RESULT_PATH)):
        raise ContractError("development authority was already consumed")
    if str(state_root.resolve()) != freeze["sourceRoot"]:
        raise ContractError("state root differs from freeze")
    marker: JsonObject = {
        "developmentOpenCount": 1,
        "freezeSha256": sha256_file(FREEZE_PATH),
        "holdoutMaximumOpenCount": 1,
        "holdoutOpenCount": 0,
        "schema": "VG2RunMarkerV1",
        "sourceManifestSha256": sha256_file(SOURCE_MANIFEST_PATH),
        "startedAtUtc": utc_now(),
        "state": "DEVELOPMENT_OPENED",
    }
    write_json_once(MARKER_PATH, marker)

    proto = protocol()
    months = set(cast(list[str], cast(JsonObject, proto["data"])["developmentArchiveMonths"]))
    bars, semantic_rows = load_bars(months)
    fold_specs = cast(
        list[JsonObject],
        cast(JsonObject, cast(JsonObject, proto["partitions"])["development"])["folds"],
    )
    all_trials = trials()
    trial_rows: list[JsonObject] = []
    return_matrix: dict[str, list[float]] = {}
    p_values: dict[str, float] = {}
    trial_simulations: dict[str, list[Simulation]] = {}
    for trial_index, trial in enumerate(all_trials):
        base_folds: list[Simulation] = []
        stress_folds: list[Simulation] = []
        fold_rows: list[JsonObject] = []
        for fold in fold_specs:
            start = parse_day(cast(str, fold["startUtcDate"]))
            end = parse_day(cast(str, fold["endUtcDate"]))
            base = simulate(bars, trial, start, end, BASE_ADVERSE, "BASE")
            stress = simulate(bars, trial, start, end, STRESS_ADVERSE, "STRESS")
            base_folds.append(base)
            stress_folds.append(stress)
            fold_rows.append(
                {
                    "base": simulation_mapping(base, include_series=True),
                    "foldId": fold["id"],
                    "stress": simulation_mapping(stress, include_series=False),
                }
            )
        values = concatenate_fold_returns(base_folds)
        stress_values = concatenate_fold_returns(stress_folds)
        bootstrap = bootstrap_report(values, trial_index)
        raw_p = float(cast(str, bootstrap["oneSidedPValue"]))
        p_values[trial.trial_id] = raw_p
        return_matrix[trial.trial_id] = values
        trial_simulations[trial.trial_id] = base_folds
        median_fold_net = statistics.median(float(sim.net_usd) for sim in base_folds)
        development_base_net = compounded_net(values)
        development_stress_net = compounded_net(stress_values)
        trial_rows.append(
            {
                "bootstrap": bootstrap,
                "developmentBaseNetUsdPer1000": format(development_base_net, ".10f"),
                "developmentStressNetUsdPer1000": format(development_stress_net, ".10f"),
                "folds": fold_rows,
                "holdDays": trial.hold_days,
                "lookbackDays": trial.lookback,
                "medianFoldBaseNetUsdPer1000": format(median_fold_net, ".10f"),
                "topFraction": exact_decimal(trial.top_fraction, 2),
                "trialId": trial.trial_id,
            }
        )
    holm = holm_report(p_values)
    white = white_reality_check(return_matrix)
    pbo = pbo_report(return_matrix)
    rejected = set(cast(list[str], holm["rejectedTrialIds"]))
    white_pass = white["status"] == "AVAILABLE" and float(cast(str, white["pValue"])) < ALPHA
    for row in trial_rows:
        trial_id = cast(str, row["trialId"])
        simulations = trial_simulations[trial_id]
        bootstrap = cast(JsonObject, row["bootstrap"])
        valid_days = sum(sim.valid_cohort_days for sim in simulations)
        round_trips = sum(sim.round_trips for sim in simulations)
        assets = set().union(*(sim.distinct_assets for sim in simulations))
        positive_folds = sum(1 for sim in simulations if sim.net_usd > ZERO)
        gates = {
            "adjustedMultiplicity": trial_id in rejected,
            "bootstrapLowerBoundPositive": (
                bootstrap["status"] == "AVAILABLE"
                and float(cast(str, bootstrap["lowerNetUsdPer1000"])) > 0
            ),
            "distinctAssets": len(assets) >= 20,
            "positiveFolds": positive_folds >= 3,
            "roundTrips": round_trips >= 100,
            "stressNetPositive": float(cast(str, row["developmentStressNetUsdPer1000"])) > 0,
            "validCohortDays": valid_days >= 80,
            "whiteRealityCheck": white_pass,
        }
        row["developmentGatePass"] = all(gates.values())
        row["gateEvidence"] = {
            "distinctAssetCount": len(assets),
            "gates": gates,
            "positiveFoldCount": positive_folds,
            "roundTripCount": round_trips,
            "validCohortDayCount": valid_days,
        }

    by_id = {trial.trial_id: trial for trial in all_trials}
    ranked = sorted(
        trial_rows,
        key=lambda row: (
            -float(cast(str, row["medianFoldBaseNetUsdPer1000"])),
            by_id[cast(str, row["trialId"])].hold_days,
            -by_id[cast(str, row["trialId"])].lookback,
            by_id[cast(str, row["trialId"])].top_fraction,
            cast(str, row["trialId"]),
        ),
    )
    champion_row = ranked[0]
    development = {
        "archiveBodyPartitionsOpened": ["DEVELOPMENT", "WARMUP"],
        "attemptedTrialCount": len(all_trials),
        "completedAtUtc": utc_now(),
        "freezeSha256": sha256_file(FREEZE_PATH),
        "holm": holm,
        "pbo": pbo,
        "schema": "VG2DevelopmentV1",
        "selectionMetric": "MEDIAN_FOUR_WALK_FORWARD_FOLD_BASE_NET_USD_PER_1000",
        "semanticRowLedger": semantic_rows,
        "semanticRowLedgerSha256": sha256_bytes(canonical_bytes(semantic_rows)),
        "trials": trial_rows,
        "whiteRealityCheck": white,
    }
    write_json_once(DEVELOPMENT_PATH, development)
    selected_id = cast(str, champion_row["trialId"])
    selected_trial = by_id[selected_id]
    selection = {
        "champion": {
            "developmentGatePass": champion_row["developmentGatePass"],
            "holdDays": selected_trial.hold_days,
            "lookbackDays": selected_trial.lookback,
            "medianFoldBaseNetUsdPer1000": champion_row["medianFoldBaseNetUsdPer1000"],
            "topFraction": exact_decimal(selected_trial.top_fraction, 2),
            "trialId": selected_id,
        },
        "developmentSha256": sha256_file(DEVELOPMENT_PATH),
        "freezeSha256": sha256_file(FREEZE_PATH),
        "holdoutMetricsRead": False,
        "lockedAtUtc": utc_now(),
        "schema": "VG2SelectionV1",
        "tieBreakApplied": [
            "LOWER_HOLD_DAYS",
            "LARGER_LOOKBACK_DAYS",
            "SMALLER_TOP_FRACTION",
            "LEXICOGRAPHIC_TRIAL_ID",
        ],
    }
    write_json_once(SELECTION_PATH, selection)
    marker.update(
        {
            "developmentCompletedAtUtc": utc_now(),
            "developmentSha256": sha256_file(DEVELOPMENT_PATH),
            "selectionSha256": sha256_file(SELECTION_PATH),
            "state": "DEVELOPMENT_COMPLETE_HOLDOUT_SEALED",
        }
    )
    write_json_replace(MARKER_PATH, marker)
    return selection


def selected_trial(selection: JsonObject) -> Trial:
    champion = cast(JsonObject, selection["champion"])
    trial_id = cast(str, champion["trialId"])
    candidates = {trial.trial_id: trial for trial in trials()}
    if trial_id not in candidates:
        raise ContractError("selection names a trial outside the frozen family")
    trial = candidates[trial_id]
    if (
        champion["lookbackDays"] != trial.lookback
        or champion["holdDays"] != trial.hold_days
        or Decimal(cast(str, champion["topFraction"])) != trial.top_fraction
    ):
        raise ContractError("selection parameters do not match the frozen trial")
    return trial


def holdout_command(state_root: Path) -> JsonObject:
    freeze = verify_freeze()
    if RESULT_PATH.exists():
        raise ContractError("holdout result already exists")
    marker = load_json(MARKER_PATH)
    selection = load_json(SELECTION_PATH)
    development = load_json(DEVELOPMENT_PATH)
    if marker.get("state") != "DEVELOPMENT_COMPLETE_HOLDOUT_SEALED":
        raise ContractError("holdout is not sealed and ready")
    if marker.get("holdoutOpenCount") != 0:
        raise ContractError("holdout authority already consumed")
    if marker.get("selectionSha256") != sha256_file(SELECTION_PATH):
        raise ContractError("selection changed after development")
    if marker.get("developmentSha256") != sha256_file(DEVELOPMENT_PATH):
        raise ContractError("development evidence changed after selection")
    if selection.get("developmentSha256") != sha256_file(DEVELOPMENT_PATH):
        raise ContractError("selection does not bind development evidence")
    if str(state_root.resolve()) != freeze["sourceRoot"]:
        raise ContractError("state root differs from freeze")

    marker.update(
        {
            "holdoutOpenedAtUtc": utc_now(),
            "holdoutOpenCount": 1,
            "state": "HOLDOUT_OPENED",
        }
    )
    write_json_replace(MARKER_PATH, marker)
    trial = selected_trial(selection)
    proto = protocol()
    result: JsonObject
    try:
        months = set(cast(list[str], cast(JsonObject, proto["data"])["holdoutArchiveMonths"]))
        bars, semantic_rows = load_bars(months)
        start = parse_day(cast(str, cast(JsonObject, proto["holdout"])["startUtcDate"]))
        end = parse_day(cast(str, cast(JsonObject, proto["holdout"])["endUtcDate"]))
        base = simulate(bars, trial, start, end, BASE_ADVERSE, "BASE")
        stress = simulate(bars, trial, start, end, STRESS_ADVERSE, "STRESS")
        values = [value for _, value in base.daily_returns]
        bootstrap = bootstrap_report(values, 200_000)
        p_value = (
            None
            if bootstrap["oneSidedPValue"] is None
            else float(cast(str, bootstrap["oneSidedPValue"]))
        )
        coverage = (
            ONE
            if base.selected_allocations == 0
            else Decimal(base.round_trips) / Decimal(base.selected_allocations)
        )
        holdout_gates = {
            "adjustedPValue": p_value is not None and p_value < ALPHA,
            "bootstrapLowerBoundPositive": (
                bootstrap["lowerNetUsdPer1000"] is not None
                and float(cast(str, bootstrap["lowerNetUsdPer1000"])) > 0
            ),
            "capacityProxyAtLeast1000": (
                base.capacity_proxy_usd is not None and base.capacity_proxy_usd >= INITIAL_USD
            ),
            "development": bool(cast(JsonObject, selection["champion"])["developmentGatePass"]),
            "distinctAssets": len(base.distinct_assets) >= 15,
            "entryCoverage": coverage >= Decimal("0.95"),
            "maximumDrawdown": base.max_drawdown <= Decimal("0.10"),
            "roundTrips": base.round_trips >= 40,
            "stressNetPositive": stress.net_usd > ZERO,
            "topAssetConcentration": (base.top_asset_gross_profit_share <= Decimal("0.20")),
            "topFiveTradeConcentration": (
                base.top_five_trade_gross_profit_share <= Decimal("0.40")
            ),
            "validCohortDays": base.valid_cohort_days >= 60,
        }
        verdict = "GO" if all(holdout_gates.values()) else "NO_GO"
        failed = sorted(name for name, passed in holdout_gates.items() if not passed)
        result = {
            "accountEffectiveFee": "UNKNOWN",
            "archiveBodyPartitionsOpened": ["HOLDOUT", "HOLDOUT_WARMUP"],
            "authority": {
                "capital": "NONE",
                "consumer": "N3 profitability verdict",
                "effectUsd": "0",
                "execution": "NONE",
                "scope": "PUBLIC_RESEARCH_ONLY",
            },
            "base": simulation_mapping(base, include_series=True),
            "bootstrap": bootstrap,
            "completedAtUtc": utc_now(),
            "failedFormalGates": failed,
            "formalGateEvidence": holdout_gates,
            "historicalFilterCompliance": "UNKNOWN",
            "historicalSpreadImpact": "UNKNOWN",
            "holdoutOpenCount": 1,
            "lockedTrialId": trial.trial_id,
            "netEdgeScope": "EXACT_FOR_DECLARED_PUBLIC_FEE_AND_ADVERSE_EXECUTION_SCENARIO",
            "pbo": {
                "diagnosticOnly": true_json(),
                "developmentReport": development["pbo"],
            },
            "reason": (
                "ALL_FORMAL_PUBLIC_RESEARCH_GATES_PASS"
                if verdict == "GO"
                else "ONE_OR_MORE_FORMAL_PUBLIC_RESEARCH_GATES_FAILED"
            ),
            "schema": "VG2ResultV1",
            "selectionSha256": sha256_file(SELECTION_PATH),
            "semanticRowLedger": semantic_rows,
            "semanticRowLedgerSha256": sha256_bytes(canonical_bytes(semantic_rows)),
            "stress": simulation_mapping(stress, include_series=False),
            "verdict": verdict,
        }
    except MeasurementError as exc:
        result = {
            "accountEffectiveFee": "UNKNOWN",
            "authority": {
                "capital": "NONE",
                "consumer": "N3 profitability verdict",
                "effectUsd": "0",
                "execution": "NONE",
                "scope": "PUBLIC_RESEARCH_ONLY",
            },
            "base": {
                "netUsdPer1000": None,
                "status": "NOT_ESTIMABLE",
            },
            "completedAtUtc": utc_now(),
            "failedFormalGates": ["MEASUREMENT"],
            "holdoutOpenCount": 1,
            "lockedTrialId": trial.trial_id,
            "reason": f"MEASUREMENT_ERROR:{exc}",
            "schema": "VG2ResultV1",
            "selectionSha256": sha256_file(SELECTION_PATH),
            "stress": {
                "netUsdPer1000": None,
                "status": "NOT_ESTIMABLE",
            },
            "verdict": "UNMEASURED",
        }
    write_json_once(RESULT_PATH, result)
    marker.update(
        {
            "completedAtUtc": utc_now(),
            "resultSha256": sha256_file(RESULT_PATH),
            "state": "COMPLETE",
        }
    )
    write_json_replace(MARKER_PATH, marker)
    return result


def verify_sha256s() -> None:
    if not SHA256SUMS_PATH.exists():
        return
    for line in SHA256SUMS_PATH.read_text(encoding="utf-8").splitlines():
        if not line:
            continue
        digest, filename = line.split("  ", 1)
        path = PACKET / filename
        if path == SHA256SUMS_PATH:
            raise ContractError("SHA256SUMS must not self-reference")
        if sha256_file(path) != digest:
            raise ContractError(f"SHA256SUMS mismatch: {filename}")


def report_command(state_root: Path) -> JsonObject:
    freeze = verify_freeze()
    marker = load_json(MARKER_PATH)
    selection = load_json(SELECTION_PATH)
    development = load_json(DEVELOPMENT_PATH)
    result = load_json(RESULT_PATH)
    if str(state_root.resolve()) != freeze["sourceRoot"]:
        raise ContractError("state root differs from freeze")
    if marker.get("state") != "COMPLETE" or marker.get("holdoutOpenCount") != 1:
        raise ContractError("run marker is not terminal with one holdout open")
    if marker.get("resultSha256") != sha256_file(RESULT_PATH):
        raise ContractError("run marker does not bind result")
    if marker.get("selectionSha256") != sha256_file(SELECTION_PATH):
        raise ContractError("run marker does not bind selection")
    if marker.get("developmentSha256") != sha256_file(DEVELOPMENT_PATH):
        raise ContractError("run marker does not bind development")
    if selection.get("holdoutMetricsRead") is not False:
        raise ContractError("selection claims holdout access")
    if result.get("selectionSha256") != sha256_file(SELECTION_PATH):
        raise ContractError("result does not bind locked selection")
    if result.get("verdict") not in {"GO", "NO_GO", "UNMEASURED"}:
        raise ContractError("invalid terminal verdict")
    if (
        result.get("verdict") == "UNMEASURED"
        and cast(JsonObject, result["base"]).get("netUsdPer1000") is not None
    ):
        raise ContractError("UNMEASURED result invented a numeric edge")
    if development.get("attemptedTrialCount") != 12:
        raise ContractError("development omitted a frozen trial")
    verify_sha256s()
    return {
        "accountEffectiveFee": result.get("accountEffectiveFee"),
        "authenticatedWithoutRecomputation": True,
        "baseNetUsdPer1000": cast(JsonObject, result["base"]).get("netUsdPer1000"),
        "consumer": "N3 profitability verdict",
        "holdoutOpenCount": marker["holdoutOpenCount"],
        "lockedTrialId": result["lockedTrialId"],
        "resultSha256": sha256_file(RESULT_PATH),
        "stressNetUsdPer1000": cast(JsonObject, result["stress"]).get("netUsdPer1000"),
        "verdict": result["verdict"],
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "command",
        choices=("inventory", "develop", "holdout", "report"),
    )
    parser.add_argument("--state-root", type=Path, required=True)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = build_parser().parse_args(argv)
    state_root = cast(Path, arguments.state_root)
    try:
        if arguments.command == "inventory":
            value = inventory(state_root)
            summary = {
                "normalizedRecordSha256": value["normalizedRecordSha256"],
                "recordCount": value["recordCount"],
                "schema": value["schema"],
                "symbolCount": value["symbolCount"],
            }
        elif arguments.command == "develop":
            value = development_command(state_root)
            summary = value
        elif arguments.command == "holdout":
            value = holdout_command(state_root)
            summary = {
                "baseNetUsdPer1000": cast(JsonObject, value["base"]).get("netUsdPer1000"),
                "lockedTrialId": value["lockedTrialId"],
                "stressNetUsdPer1000": cast(JsonObject, value["stress"]).get("netUsdPer1000"),
                "verdict": value["verdict"],
            }
        else:
            summary = report_command(state_root)
    except (ContractError, MeasurementError, OSError, ValueError, zipfile.BadZipFile) as exc:
        print(f"VG2_ERROR:{type(exc).__name__}:{exc}", file=sys.stderr)
        return 2
    print(json.dumps(summary, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
