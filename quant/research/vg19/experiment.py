"""Sealed Binance public-only V-G19 abnormal-volume autocorrelation study."""

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
import subprocess
import threading
import time
import urllib.error
import urllib.request
import zipfile
from collections import defaultdict
from collections.abc import Mapping, Sequence
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any, cast

PACKET = Path(__file__).resolve().parent
PROTOCOL_PATH = PACKET / "protocol.v1.json"
LEDGER_PATH = PACKET / "trial_ledger.v1.json"
MANIFEST_PATH = PACKET / "source_manifest.v1.json"
FREEZE_PATH = PACKET / "freeze.v1.json"
RUN_MARKER_PATH = PACKET / "run-marker.v1.json"
DEVELOPMENT_OPENED_PATH = PACKET / "development-opened.v1.json"
PRIMARY_SEAL_PATH = PACKET / "primary-seal.v1.json"
HOLDOUT_OPEN_PATH = PACKET / "holdout-open.v1.json"
HOLDOUT_OPENED_PATH = PACKET / "holdout-opened.v1.json"
RESULT_PATH = PACKET / "result.v1.json"
SHA256SUMS_PATH = PACKET / "SHA256SUMS"

HOUR_US = 3_600_000_000
JsonObject = dict[str, Any]


class ContractError(RuntimeError):
    """A frozen lifecycle or evidence binding was violated."""


class MeasurementError(RuntimeError):
    """The preregistered estimate cannot be measured validly."""


@dataclass(frozen=True, slots=True)
class Bar:
    """One complete official hourly kline."""

    open_time_us: int
    open_price: float
    close_price: float
    quote_volume: float


@dataclass(frozen=True, slots=True)
class Trial:
    """One fully frozen diagnostic configuration."""

    lookback_weeks: int
    threshold_z: float
    top_k: int
    hold_hours: int
    trial_id: str


@dataclass(frozen=True, slots=True)
class Cohort:
    """One causal, non-overlapping selected cohort."""

    signal_us: int
    entry_us: int
    exit_us: int
    symbols: tuple[str, ...]


@dataclass(slots=True)
class Simulation:
    """One synchronous cohort-or-cash simulation."""

    trial_id: str
    cost_bps: int
    timeline: list[int]
    hourly_returns: list[float]
    benchmark_hourly_returns: list[float]
    daily_returns: list[float]
    benchmark_daily_returns: list[float]
    excess_daily_returns: list[float]
    cumulative_return: float
    benchmark_cumulative_return: float
    maximum_drawdown: float
    cohort_count: int
    round_trips: int
    ignored_signal_hours: int
    selection_counts: dict[str, int]
    distinct_weeks: int
    top_symbol_selection_share: float
    public_capacity_proxy_usd_at_1bp: float | None
    top_asset_positive_pnl_share: float | None
    top_five_trade_positive_pnl_share: float | None


def utc_now() -> str:
    """Return an explicit UTC receipt timestamp."""

    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def canonical_bytes(value: object) -> bytes:
    """Serialize JSON deterministically."""

    return (
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True) + "\n"
    ).encode()


def load_json(path: Path) -> JsonObject:
    """Load one JSON object."""

    value = json.loads(path.read_text())
    if not isinstance(value, dict):
        raise ContractError(f"{path.name} is not a JSON object")
    return cast(JsonObject, value)


def write_json_once(path: Path, value: object) -> None:
    """Create immutable JSON evidence."""

    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("xb") as handle:
        handle.write(canonical_bytes(value))


def write_bytes_once(path: Path, raw: bytes) -> None:
    """Create immutable raw evidence."""

    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("xb") as handle:
        handle.write(raw)


def sha256_bytes(raw: bytes) -> str:
    """Return a lowercase SHA-256 digest."""

    return hashlib.sha256(raw).hexdigest()


def sha256_file(path: Path) -> str:
    """Hash one file without transforming its bytes."""

    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def exact_float(value: float, places: int = 10) -> str:
    """Render finite numeric evidence without binary noise."""

    if not math.isfinite(value):
        raise MeasurementError("non-finite numeric result")
    return f"{value:.{places}f}"


def git_output(*args: str) -> str:
    """Run one read-only Git query against the isolated worktree."""

    root = PACKET.parents[2]
    return subprocess.check_output(
        ["git", *args], cwd=root, text=True, stderr=subprocess.STDOUT
    ).strip()


def protocol() -> JsonObject:
    """Load the frozen protocol."""

    return load_json(PROTOCOL_PATH)


def state_root() -> Path:
    """Resolve the protocol-owned external evidence root."""

    data = cast(JsonObject, protocol()["data"])
    return Path(cast(str, data["stateRoot"]))


def parse_utc(value: str) -> int:
    """Convert an ISO UTC boundary to archive microseconds."""

    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ContractError(f"naive timestamp boundary: {value}")
    return int(parsed.timestamp() * 1_000_000)


def utc_from_us(value: int) -> datetime:
    """Convert archive microseconds to UTC."""

    return datetime.fromtimestamp(value / 1_000_000, UTC)


def month_start(month: str) -> datetime:
    """Return the first UTC instant in YYYY-MM."""

    return datetime.strptime(f"{month}-01", "%Y-%m-%d").replace(tzinfo=UTC)


def next_month(value: datetime) -> datetime:
    """Return the next calendar-month boundary."""

    if value.month == 12:
        return value.replace(year=value.year + 1, month=1)
    return value.replace(month=value.month + 1)


def trials() -> tuple[Trial, ...]:
    """Generate and authenticate the complete 54-trial ledger."""

    spec = cast(JsonObject, protocol()["trials"])
    generated: list[Trial] = []
    for weeks, threshold, top_k, hold in itertools.product(
        cast(list[int], spec["lookbackWeeks"]),
        cast(list[str], spec["thresholdZ"]),
        cast(list[int], spec["topK"]),
        cast(list[int], spec["holdHours"]),
    ):
        threshold_float = float(threshold)
        trial_id = f"W{weeks:02d}-Z{threshold_float:.1f}-K{top_k}-H{hold}"
        generated.append(
            Trial(
                lookback_weeks=weeks,
                threshold_z=threshold_float,
                top_k=top_k,
                hold_hours=hold,
                trial_id=trial_id,
            )
        )
    generated.sort(key=lambda item: item.trial_id)
    ledger = load_json(LEDGER_PATH)
    expected = cast(list[str], ledger["trials"])
    found = [item.trial_id for item in generated]
    if found != expected or len(found) != cast(int, spec["attemptedCount"]):
        raise ContractError("diagnostic trial ledger does not match protocol")
    return tuple(generated)


def primary_trial() -> Trial:
    """Return the single preregistered primary configuration."""

    item = cast(JsonObject, protocol()["primary"])
    trial = Trial(
        lookback_weeks=cast(int, item["lookbackWeeks"]),
        threshold_z=float(cast(str, item["thresholdZ"])),
        top_k=cast(int, item["topK"]),
        hold_hours=cast(int, item["holdHours"]),
        trial_id=cast(str, item["trialId"]),
    )
    if trial.trial_id not in {candidate.trial_id for candidate in trials()}:
        raise ContractError("primary trial is absent from complete ledger")
    return trial


def verify_sidecar(sidecar: bytes, archive_name: str, archive_sha: str) -> None:
    """Authenticate Binance's raw SHA-256 sidecar."""

    try:
        text = sidecar.decode("ascii").strip()
    except UnicodeDecodeError as exc:
        raise MeasurementError(f"non-ASCII checksum sidecar: {archive_name}") from exc
    pieces = text.split()
    if len(pieces) != 2:
        raise MeasurementError(f"malformed checksum sidecar: {archive_name}")
    expected_sha, expected_name = pieces
    if expected_name.lstrip("*") != archive_name:
        raise MeasurementError(f"checksum filename mismatch: {archive_name}")
    if len(expected_sha) != 64 or expected_sha.lower() != archive_sha:
        raise MeasurementError(f"checksum mismatch: {archive_name}")


class RateLimiter:
    """Thread-safe maximum launch-rate owner."""

    def __init__(self, launches_per_second: int) -> None:
        self._interval = 1.0 / launches_per_second
        self._next = 0.0
        self._lock = threading.Lock()

    def wait(self) -> None:
        """Wait until one new request may start."""

        with self._lock:
            current = time.monotonic()
            delay = max(0.0, self._next - current)
            if delay:
                time.sleep(delay)
            self._next = max(self._next, time.monotonic()) + self._interval


def http_get(url: str, limiter: RateLimiter) -> tuple[bytes, dict[str, str]]:
    """Fetch one public object under the frozen retry law."""

    acquisition = cast(JsonObject, protocol()["acquisition"])
    retryable = set(cast(list[int], acquisition["retryableStatus"]))
    maximum = cast(int, acquisition["transportRetryMaximum"])
    last_error: Exception | None = None
    for attempt in range(maximum + 1):
        limiter.wait()
        request = urllib.request.Request(
            url,
            headers={"User-Agent": "cosmos-vg19-public-research/1.0"},
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                status = response.status
                raw = response.read()
                headers = {key.lower(): value for key, value in response.headers.items()}
                if status != 200:
                    raise MeasurementError(f"unexpected HTTP {status}: {url}")
                return raw, headers
        except urllib.error.HTTPError as exc:
            if exc.code == 418:
                raise MeasurementError("HTTP 418 acquisition stop") from exc
            if exc.code not in retryable or attempt == maximum:
                raise MeasurementError(f"HTTP {exc.code}: {url}") from exc
            last_error = exc
        except (TimeoutError, urllib.error.URLError) as exc:
            if attempt == maximum:
                raise MeasurementError(f"transport failure: {url}") from exc
            last_error = exc
        time.sleep(0.25 * (2**attempt))
    raise MeasurementError(f"unreachable acquisition failure: {last_error}")


def acquire_record(
    symbol: str,
    month: str,
    limiter: RateLimiter,
    objects: Path,
) -> JsonObject:
    """Acquire and bind one official archive plus checksum."""

    data = cast(JsonObject, protocol()["data"])
    template = cast(str, data["archiveUrlTemplate"])
    archive_url = template.format(symbol=symbol, month=month)
    archive_name = archive_url.rsplit("/", maxsplit=1)[-1]
    checksum_url = f"{archive_url}.CHECKSUM"
    sidecar, side_headers = http_get(checksum_url, limiter)
    archive, archive_headers = http_get(archive_url, limiter)
    archive_sha = sha256_bytes(archive)
    verify_sidecar(sidecar, archive_name, archive_sha)
    archive_path = objects / archive_name
    checksum_path = objects / f"{archive_name}.CHECKSUM"
    write_bytes_once(checksum_path, sidecar)
    write_bytes_once(archive_path, archive)
    return {
        "archiveBytes": len(archive),
        "archiveEtag": archive_headers.get("etag"),
        "archiveLastModified": archive_headers.get("last-modified"),
        "archiveName": archive_name,
        "archivePath": f"objects/{archive_name}",
        "archiveSha256": archive_sha,
        "archiveUrl": archive_url,
        "checksumBytes": len(sidecar),
        "checksumEtag": side_headers.get("etag"),
        "checksumLastModified": side_headers.get("last-modified"),
        "checksumPath": f"objects/{archive_name}.CHECKSUM",
        "checksumSha256": sha256_bytes(sidecar),
        "checksumUrl": checksum_url,
        "month": month,
        "symbol": symbol,
    }


def acquire_command() -> JsonObject:
    """Download compressed public bytes without opening outcome members."""

    root = state_root()
    if root.exists() or MANIFEST_PATH.exists():
        raise ContractError("V-G19 acquisition root or manifest already exists")
    objects = root / "objects"
    objects.mkdir(parents=True)
    spec = protocol()
    data = cast(JsonObject, spec["data"])
    acquisition = cast(JsonObject, spec["acquisition"])
    symbols = cast(list[str], data["symbols"])
    months = cast(list[str], data["archiveMonths"])
    limiter = RateLimiter(cast(int, acquisition["newRequestsPerSecondMaximum"]))
    records: list[JsonObject] = []
    tasks = [(symbol, month) for symbol in symbols for month in months]
    with ThreadPoolExecutor(max_workers=cast(int, acquisition["concurrencyMaximum"])) as executor:
        futures = {
            executor.submit(acquire_record, symbol, month, limiter, objects): (
                symbol,
                month,
            )
            for symbol, month in tasks
        }
        for index, future in enumerate(as_completed(futures), start=1):
            records.append(future.result())
            if index % 15 == 0 or index == len(tasks):
                print(f"acquired {index}/{len(tasks)} archives", flush=True)
    records.sort(key=lambda item: (cast(str, item["symbol"]), cast(str, item["month"])))
    manifest: JsonObject = {
        "acquiredAtUtc": utc_now(),
        "archiveCount": len(records),
        "canonicalBase": spec["canonicalBase"],
        "checksumCount": len(records),
        "objectsOpened": 0,
        "records": records,
        "source": "BINANCE_OFFICIAL_PUBLIC_MONTHLY_SPOT_KLINES",
        "version": "VG19SourceManifestV1",
    }
    write_json_once(MANIFEST_PATH, manifest)
    write_json_once(root / "source_manifest.v1.json", manifest)
    return manifest


def manifest_records(months: set[str]) -> tuple[JsonObject, ...]:
    """Authenticate the frozen source manifest and select months."""

    manifest = load_json(MANIFEST_PATH)
    records = cast(list[JsonObject], manifest["records"])
    selected = tuple(item for item in records if cast(str, item["month"]) in months)
    data = cast(JsonObject, protocol()["data"])
    expected = len(cast(list[str], data["symbols"])) * len(months)
    if len(selected) != expected:
        raise MeasurementError(f"source manifest has {len(selected)} records; expected {expected}")
    return selected


def parse_archive(record: JsonObject) -> tuple[list[Bar], JsonObject]:
    """Open one authenticated archive exactly once and validate every row."""

    root = state_root()
    archive_path = root / cast(str, record["archivePath"])
    checksum_path = root / cast(str, record["checksumPath"])
    if sha256_file(archive_path) != cast(str, record["archiveSha256"]):
        raise MeasurementError(f"archive hash changed: {archive_path.name}")
    if sha256_file(checksum_path) != cast(str, record["checksumSha256"]):
        raise MeasurementError(f"checksum bytes changed: {archive_path.name}")
    verify_sidecar(
        checksum_path.read_bytes(),
        cast(str, record["archiveName"]),
        cast(str, record["archiveSha256"]),
    )
    symbol = cast(str, record["symbol"])
    month = cast(str, record["month"])
    expected_member = f"{symbol}-1h-{month}.csv"
    try:
        with zipfile.ZipFile(archive_path) as archive:
            members = archive.infolist()
            if len(members) != 1 or members[0].filename != expected_member:
                raise MeasurementError(f"unexpected ZIP inventory: {archive_path.name}")
            if members[0].is_dir() or "/" in members[0].filename:
                raise MeasurementError(f"unsafe ZIP member: {archive_path.name}")
            raw_csv = archive.read(members[0])
    except zipfile.BadZipFile as exc:
        raise MeasurementError(f"invalid ZIP: {archive_path.name}") from exc
    bars: list[Bar] = []
    reader = csv.reader(io.StringIO(raw_csv.decode("utf-8")))
    for row_number, row in enumerate(reader, start=1):
        if len(row) != 12:
            raise MeasurementError(f"{archive_path.name} row {row_number}: expected 12 fields")
        try:
            open_time = int(row[0])
            open_price = float(row[1])
            close_price = float(row[4])
            quote_volume = float(row[7])
            close_time = int(row[6])
        except ValueError as exc:
            raise MeasurementError(
                f"{archive_path.name} row {row_number}: invalid numeric field"
            ) from exc
        if open_time < 1_000_000_000_000_000:
            raise MeasurementError(f"{archive_path.name} row {row_number}: not microseconds")
        if close_time != open_time + HOUR_US - 1:
            raise MeasurementError(f"{archive_path.name} row {row_number}: invalid close time")
        if (
            not math.isfinite(open_price)
            or not math.isfinite(close_price)
            or not math.isfinite(quote_volume)
            or open_price <= 0
            or close_price <= 0
            or quote_volume < 0
        ):
            raise MeasurementError(f"{archive_path.name} row {row_number}: invalid market value")
        bars.append(
            Bar(
                open_time_us=open_time,
                open_price=open_price,
                close_price=close_price,
                quote_volume=quote_volume,
            )
        )
    data = cast(JsonObject, protocol()["data"])
    expected_rows = cast(JsonObject, data["expectedRowsByMonth"])
    expected_count = cast(int, expected_rows[month])
    if len(bars) != expected_count:
        raise MeasurementError(f"{archive_path.name}: {len(bars)} rows; expected {expected_count}")
    start = int(month_start(month).timestamp() * 1_000_000)
    end = int(next_month(month_start(month)).timestamp() * 1_000_000)
    expected_times = list(range(start, end, HOUR_US))
    found_times = [item.open_time_us for item in bars]
    if found_times != expected_times:
        raise MeasurementError(f"{archive_path.name}: incomplete or unsorted grid")
    opened: JsonObject = {
        "archiveName": archive_path.name,
        "archiveSha256": cast(str, record["archiveSha256"]),
        "csvBytes": len(raw_csv),
        "csvSha256": sha256_bytes(raw_csv),
        "firstOpenTimeUs": found_times[0],
        "lastOpenTimeUs": found_times[-1],
        "month": month,
        "rowCount": len(bars),
        "symbol": symbol,
    }
    return bars, opened


def load_bars(months: set[str]) -> tuple[dict[str, dict[int, Bar]], list[JsonObject]]:
    """Open one frozen month set and require complete cross-month symbol grids."""

    by_symbol: dict[str, dict[int, Bar]] = defaultdict(dict)
    opened: list[JsonObject] = []
    for record in manifest_records(months):
        bars, receipt = parse_archive(record)
        symbol = cast(str, record["symbol"])
        target = by_symbol[symbol]
        for bar in bars:
            if bar.open_time_us in target:
                raise MeasurementError(f"duplicate full bar: {symbol}")
            target[bar.open_time_us] = bar
        opened.append(receipt)
    expected_symbols = cast(list[str], cast(JsonObject, protocol()["data"])["symbols"])
    if sorted(by_symbol) != sorted(expected_symbols):
        raise MeasurementError("opened symbol universe differs from protocol")
    reference: list[int] | None = None
    for symbol in sorted(by_symbol):
        times = sorted(by_symbol[symbol])
        if reference is None:
            reference = times
        elif times != reference:
            raise MeasurementError(f"cross-symbol grid differs: {symbol}")
    opened.sort(key=lambda item: (cast(str, item["symbol"]), cast(str, item["month"])))
    return dict(by_symbol), opened


def merge_bars(
    left: Mapping[str, Mapping[int, Bar]],
    right: Mapping[str, Mapping[int, Bar]],
) -> dict[str, dict[int, Bar]]:
    """Merge disjoint month sets without tolerating overlap."""

    merged: dict[str, dict[int, Bar]] = {}
    for symbol in sorted(set(left) | set(right)):
        target = dict(left.get(symbol, {}))
        for timestamp, bar in right.get(symbol, {}).items():
            if timestamp in target:
                raise MeasurementError(f"bar reopened or duplicated: {symbol}")
            target[timestamp] = bar
        merged[symbol] = target
    return merged


def median_absolute_deviation(values: Sequence[float]) -> tuple[float, float]:
    """Return the median and unscaled median absolute deviation."""

    center = statistics.median(values)
    deviation = statistics.median(abs(value - center) for value in values)
    return center, deviation


def compute_surprises(
    bars: Mapping[str, Mapping[int, Bar]],
    lookback_weeks: int,
) -> dict[str, dict[int, float]]:
    """Compute causal hour-of-week standardized log quote-volume surprise."""

    minimum = cast(int, cast(JsonObject, protocol()["seasonality"])["minimumValidObservations"])
    result: dict[str, dict[int, float]] = {}
    for symbol in sorted(bars):
        history: dict[int, list[float]] = defaultdict(list)
        surprises: dict[int, float] = {}
        for timestamp in sorted(bars[symbol]):
            current = math.log1p(bars[symbol][timestamp].quote_volume)
            moment = utc_from_us(timestamp)
            slot = moment.weekday() * 24 + moment.hour
            prior = history[slot][-lookback_weeks:]
            if len(prior) >= minimum:
                center, mad = median_absolute_deviation(prior)
                scale = 1.4826 * mad
                if scale > 0 and math.isfinite(scale):
                    surprises[timestamp] = (current - center) / scale
            history[slot].append(current)
        result[symbol] = surprises
    return result


def hourly_timeline(start_us: int, end_us: int) -> list[int]:
    """Build an explicit full-calendar UTC hourly index."""

    if end_us <= start_us or (end_us - start_us) % HOUR_US:
        raise ContractError("partition is not a positive whole-hour interval")
    return list(range(start_us, end_us, HOUR_US))


def select_cohorts(
    surprises: Mapping[str, Mapping[int, float]],
    trial: Trial,
    start_us: int,
    end_us: int,
) -> tuple[list[Cohort], int]:
    """Apply one causal, deterministic, non-overlapping cohort rule."""

    symbols = sorted(surprises)
    cohorts: list[Cohort] = []
    ignored = 0
    next_signal_allowed = start_us
    for signal_us in hourly_timeline(start_us, end_us):
        if signal_us < next_signal_allowed:
            ignored += 1
            continue
        ranked = sorted(
            (
                (surprises[symbol].get(signal_us), symbol)
                for symbol in symbols
                if surprises[symbol].get(signal_us) is not None
                and cast(float, surprises[symbol].get(signal_us)) >= trial.threshold_z
            ),
            key=lambda item: (-cast(float, item[0]), item[1]),
        )
        if len(ranked) < trial.top_k:
            continue
        entry_us = signal_us + 2 * HOUR_US
        exit_us = entry_us + trial.hold_hours * HOUR_US
        if entry_us < start_us or exit_us >= end_us:
            continue
        selected = tuple(symbol for _, symbol in ranked[: trial.top_k])
        cohorts.append(
            Cohort(
                signal_us=signal_us,
                entry_us=entry_us,
                exit_us=exit_us,
                symbols=selected,
            )
        )
        next_signal_allowed = signal_us + trial.hold_hours * HOUR_US
    return cohorts, ignored


def liquidation_multiplier(
    bars: Mapping[str, Mapping[int, Bar]],
    cohort: Cohort,
    timestamp: int,
    *,
    use_open: bool,
    symbols: Sequence[str],
    cost_bps: int,
) -> float:
    """Mark one equal-weight cohort under a frozen all-in round-trip cost."""

    ratios: list[float] = []
    for symbol in symbols:
        try:
            entry = bars[symbol][cohort.entry_us].open_price
            current_bar = bars[symbol][timestamp]
        except KeyError as exc:
            raise MeasurementError(
                f"missing selected entry/mark/exit: {symbol} {timestamp}"
            ) from exc
        current = current_bar.open_price if use_open else current_bar.close_price
        ratios.append(current / entry)
    cost_multiplier = 1.0 - cost_bps / 10_000
    if cost_multiplier <= 0:
        raise ContractError("round-trip cost must be below 10000 bps")
    return statistics.fmean(ratios) * cost_multiplier


def marked_equity(
    bars: Mapping[str, Mapping[int, Bar]],
    cohorts: Sequence[Cohort],
    timeline: Sequence[int],
    *,
    benchmark: bool,
    cost_bps: int,
) -> tuple[list[float], dict[str, float], list[float]]:
    """Build a complete marked equity path and realized trade contributions."""

    universe = sorted(bars)
    entries = {cohort.entry_us: cohort for cohort in cohorts}
    current: Cohort | None = None
    base_equity = 1000.0
    realized_equity = 1000.0
    points: list[float] = []
    asset_pnl: dict[str, float] = defaultdict(float)
    trade_positive_pnl: list[float] = []
    for timestamp in timeline:
        if current is not None and timestamp == current.exit_us:
            held = universe if benchmark else list(current.symbols)
            multiplier = liquidation_multiplier(
                bars,
                current,
                timestamp,
                use_open=True,
                symbols=held,
                cost_bps=cost_bps,
            )
            realized_equity = base_equity * multiplier
            if not benchmark:
                for symbol in current.symbols:
                    ratio = (
                        bars[symbol][timestamp].open_price
                        / bars[symbol][current.entry_us].open_price
                    )
                    pnl = (
                        base_equity
                        / len(current.symbols)
                        * (ratio * (1.0 - cost_bps / 10_000) - 1.0)
                    )
                    asset_pnl[symbol] += pnl
                    if pnl > 0:
                        trade_positive_pnl.append(pnl)
            current = None
        entering = entries.get(timestamp)
        if entering is not None:
            if current is not None:
                raise ContractError("cohort overlap exceeded 100% gross exposure")
            current = entering
            base_equity = realized_equity
        if current is None:
            mark = realized_equity
        else:
            held = universe if benchmark else list(current.symbols)
            mark = base_equity * liquidation_multiplier(
                bars,
                current,
                timestamp,
                use_open=False,
                symbols=held,
                cost_bps=cost_bps,
            )
        if not math.isfinite(mark) or mark <= 0:
            raise MeasurementError("non-positive or non-finite marked equity")
        points.append(mark)
    if current is not None:
        raise MeasurementError("position remains open at partition end")
    return points, dict(asset_pnl), trade_positive_pnl


def equity_returns(points: Sequence[float], initial: float = 1000.0) -> list[float]:
    """Convert a complete equity path into synchronous hourly returns."""

    returns: list[float] = []
    prior = initial
    for point in points:
        returns.append(point / prior - 1.0)
        prior = point
    return returns


def calendar_daily_returns(
    timeline: Sequence[int],
    points: Sequence[float],
    initial: float = 1000.0,
) -> list[float]:
    """Aggregate marked equity into every calendar day's return."""

    if len(timeline) != len(points):
        raise ContractError("timeline/equity length mismatch")
    last_by_day: dict[date, float] = {}
    for timestamp, point in zip(timeline, points, strict=True):
        last_by_day[utc_from_us(timestamp).date()] = point
    returns: list[float] = []
    prior = initial
    for day in sorted(last_by_day):
        current = last_by_day[day]
        returns.append(current / prior - 1.0)
        prior = current
    return returns


def maximum_drawdown(points: Sequence[float], initial: float = 1000.0) -> float:
    """Compute peak-to-trough loss on the marked path."""

    peak = initial
    worst = 0.0
    for point in points:
        peak = max(peak, point)
        worst = max(worst, (peak - point) / peak)
    return worst


def capacity_proxy(
    bars: Mapping[str, Mapping[int, Bar]],
    cohorts: Sequence[Cohort],
) -> float | None:
    """Return a causal 1-bp quote-volume participation screen."""

    portfolio_limits: list[float] = []
    for cohort in cohorts:
        per_symbol: list[float] = []
        for symbol in cohort.symbols:
            history: list[float] = []
            for offset in range(1, 721):
                timestamp = cohort.signal_us - offset * HOUR_US
                bar = bars[symbol].get(timestamp)
                if bar is None:
                    raise MeasurementError(
                        f"missing capacity lookback: {symbol} {cohort.signal_us}"
                    )
                history.append(bar.quote_volume)
            per_symbol.append(statistics.median(history) * 0.0001)
        portfolio_limits.append(len(cohort.symbols) * min(per_symbol))
    return min(portfolio_limits) if portfolio_limits else None


def simulate(
    bars: Mapping[str, Mapping[int, Bar]],
    surprises: Mapping[str, Mapping[int, float]],
    trial: Trial,
    start_us: int,
    end_us: int,
    *,
    cost_bps: int,
) -> Simulation:
    """Run one frozen full-calendar cohort-or-cash sensitivity."""

    timeline = hourly_timeline(start_us, end_us)
    for symbol in sorted(bars):
        missing = [timestamp for timestamp in timeline if timestamp not in bars[symbol]]
        if missing:
            raise MeasurementError(f"partition grid missing for {symbol}")
    cohorts, ignored = select_cohorts(surprises, trial, start_us, end_us)
    points, asset_pnl, positive_trade_pnl = marked_equity(
        bars, cohorts, timeline, benchmark=False, cost_bps=cost_bps
    )
    benchmark_points, _, _ = marked_equity(
        bars, cohorts, timeline, benchmark=True, cost_bps=cost_bps
    )
    hourly = equity_returns(points)
    benchmark_hourly = equity_returns(benchmark_points)
    daily = calendar_daily_returns(timeline, points)
    benchmark_daily = calendar_daily_returns(timeline, benchmark_points)
    excess_daily = [
        actual - baseline for actual, baseline in zip(daily, benchmark_daily, strict=True)
    ]
    selections: dict[str, int] = defaultdict(int)
    weeks: set[tuple[int, int]] = set()
    for cohort in cohorts:
        moment = utc_from_us(cohort.signal_us)
        iso = moment.isocalendar()
        weeks.add((iso.year, iso.week))
        for symbol in cohort.symbols:
            selections[symbol] += 1
    total_selections = sum(selections.values())
    top_share = max(selections.values(), default=0) / max(total_selections, 1)
    positive_by_asset = [value for value in asset_pnl.values() if value > 0]
    positive_total = sum(positive_by_asset)
    top_asset_share = max(positive_by_asset) / positive_total if positive_total > 0 else None
    positive_trade_total = sum(positive_trade_pnl)
    top_five_share = (
        sum(sorted(positive_trade_pnl, reverse=True)[:5]) / positive_trade_total
        if positive_trade_total > 0
        else None
    )
    return Simulation(
        trial_id=trial.trial_id,
        cost_bps=cost_bps,
        timeline=timeline,
        hourly_returns=hourly,
        benchmark_hourly_returns=benchmark_hourly,
        daily_returns=daily,
        benchmark_daily_returns=benchmark_daily,
        excess_daily_returns=excess_daily,
        cumulative_return=points[-1] / 1000.0 - 1.0,
        benchmark_cumulative_return=benchmark_points[-1] / 1000.0 - 1.0,
        maximum_drawdown=maximum_drawdown(points),
        cohort_count=len(cohorts),
        round_trips=len(cohorts) * trial.top_k,
        ignored_signal_hours=ignored,
        selection_counts=dict(sorted(selections.items())),
        distinct_weeks=len(weeks),
        top_symbol_selection_share=top_share,
        public_capacity_proxy_usd_at_1bp=capacity_proxy(bars, cohorts),
        top_asset_positive_pnl_share=top_asset_share,
        top_five_trade_positive_pnl_share=top_five_share,
    )


def rank_data(values: Sequence[float]) -> list[float]:
    """Return deterministic average ranks for ties."""

    ordered = sorted(enumerate(values), key=lambda item: (item[1], item[0]))
    ranks = [0.0] * len(values)
    cursor = 0
    while cursor < len(ordered):
        end = cursor + 1
        while end < len(ordered) and ordered[end][1] == ordered[cursor][1]:
            end += 1
        rank = (cursor + 1 + end) / 2.0
        for index in range(cursor, end):
            ranks[ordered[index][0]] = rank
        cursor = end
    return ranks


def pearson(values_x: Sequence[float], values_y: Sequence[float]) -> float:
    """Compute a finite Pearson correlation."""

    if len(values_x) != len(values_y) or len(values_x) < 3:
        raise MeasurementError("correlation requires aligned sample >= 3")
    mean_x = statistics.fmean(values_x)
    mean_y = statistics.fmean(values_y)
    numerator = 0.0
    square_x = 0.0
    square_y = 0.0
    for left, right in zip(values_x, values_y, strict=True):
        delta_x = left - mean_x
        delta_y = right - mean_y
        numerator += delta_x * delta_y
        square_x += delta_x * delta_x
        square_y += delta_y * delta_y
    denominator = math.sqrt(square_x * square_y)
    if denominator <= 0:
        raise MeasurementError("zero correlation variance")
    return numerator / denominator


def spearman(values_x: Sequence[float], values_y: Sequence[float]) -> float:
    """Compute Spearman correlation through deterministic average ranks."""

    return pearson(rank_data(values_x), rank_data(values_y))


def percentile(values: Sequence[float], probability: float) -> float:
    """Return a linearly interpolated sample percentile."""

    if not values or not 0 <= probability <= 1:
        raise ContractError("invalid percentile input")
    ordered = sorted(values)
    position = probability * (len(ordered) - 1)
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    weight = position - lower
    return ordered[lower] * (1.0 - weight) + ordered[upper] * weight


def circular_indices(
    sample_size: int,
    block_length: int,
    rng: random.Random,
) -> list[int]:
    """Draw one circular fixed-block bootstrap index."""

    if sample_size <= 0 or block_length <= 0:
        raise ContractError("bootstrap dimensions must be positive")
    result: list[int] = []
    while len(result) < sample_size:
        start = rng.randrange(sample_size)
        result.extend((start + offset) % sample_size for offset in range(block_length))
    return result[:sample_size]


def mechanism_report(
    surprises: Mapping[str, Mapping[int, float]],
    start_us: int,
    end_us: int,
) -> JsonObject:
    """Measure lagged persistence/decay and synchronously bootstrap lag one."""

    inference = cast(JsonObject, protocol()["inference"])
    mechanism = cast(JsonObject, inference["mechanism"])
    bootstrap = cast(JsonObject, inference["bootstrap"])
    lags = cast(list[int], mechanism["lagsHours"])
    symbols = sorted(surprises)
    full_timeline = hourly_timeline(start_us, end_us)
    aggregate_by_lag: dict[str, str] = {}
    per_symbol_by_lag: dict[str, dict[str, str]] = {}
    lag_one_rank_pairs: dict[str, tuple[list[float], list[float]]] = {}
    lag_one_common: list[int] = []
    coverage_by_lag: dict[str, str] = {}
    for lag in lags:
        offset = lag * HOUR_US
        common = [
            timestamp
            for timestamp in full_timeline
            if timestamp + offset < end_us
            and all(
                timestamp in surprises[symbol] and timestamp + offset in surprises[symbol]
                for symbol in symbols
            )
        ]
        possible = max(len(full_timeline) - lag, 1)
        coverage_by_lag[str(lag)] = exact_float(len(common) / possible)
        if len(common) < 100:
            raise MeasurementError(f"insufficient synchronized ACF pairs at lag {lag}")
        correlations: dict[str, str] = {}
        points: list[float] = []
        for symbol in symbols:
            values_x = [surprises[symbol][timestamp] for timestamp in common]
            values_y = [surprises[symbol][timestamp + offset] for timestamp in common]
            correlation = spearman(values_x, values_y)
            points.append(correlation)
            correlations[symbol] = exact_float(correlation)
            if lag == 1:
                lag_one_rank_pairs[symbol] = (
                    rank_data(values_x),
                    rank_data(values_y),
                )
        per_symbol_by_lag[str(lag)] = correlations
        aggregate_by_lag[str(lag)] = exact_float(statistics.median(points))
        if lag == 1:
            lag_one_common = common
    replicates = cast(int, bootstrap["replicates"])
    rng = random.Random(cast(int, bootstrap["seed"]) + 1)
    bootstrap_medians: list[float] = []
    for _ in range(replicates):
        indexes = circular_indices(
            len(lag_one_common),
            min(cast(int, bootstrap["blockLengthHours"]), len(lag_one_common)),
            rng,
        )
        bootstrap_correlations: list[float] = []
        for symbol in symbols:
            ranks_x, ranks_y = lag_one_rank_pairs[symbol]
            bootstrap_correlations.append(
                pearson(
                    [ranks_x[index] for index in indexes],
                    [ranks_y[index] for index in indexes],
                )
            )
        bootstrap_medians.append(statistics.median(bootstrap_correlations))
    point_values = {lag: float(aggregate_by_lag[str(lag)]) for lag in lags}
    half_threshold = 0.5 * point_values[1]
    half_decay: str | int = ">24"
    extinction: str | int = ">24"
    for lag in lags[1:]:
        if half_decay == ">24" and point_values[lag] <= half_threshold:
            half_decay = lag
        if extinction == ">24" and point_values[lag] <= 0:
            extinction = lag
    return {
        "aggregateMedianSpearmanByLag": aggregate_by_lag,
        "bootstrap": {
            "blockLengthHours": bootstrap["blockLengthHours"],
            "lag1Lower95": exact_float(percentile(bootstrap_medians, 0.025)),
            "lag1Upper95": exact_float(percentile(bootstrap_medians, 0.975)),
            "replicates": replicates,
            "synchronousAcrossSymbols": True,
        },
        "coverageByLag": coverage_by_lag,
        "extinctionLagHours": extinction,
        "halfDecayLagHours": half_decay,
        "perSymbolSpearmanByLag": per_symbol_by_lag,
        "primaryLagHours": 1,
    }


def compounded_return(values: Sequence[float]) -> float:
    """Compound a full-calendar return sequence."""

    wealth = 1.0
    for value in values:
        wealth *= 1.0 + value
    return wealth - 1.0


def bootstrap_report(
    values: Sequence[float],
    *,
    seed_offset: int,
    compound: bool,
) -> JsonObject:
    """Return a deterministic circular-week bootstrap interval."""

    if len(values) < 30:
        raise MeasurementError("bootstrap requires at least 30 calendar days")
    bootstrap = cast(JsonObject, cast(JsonObject, protocol()["inference"])["bootstrap"])
    replicates = cast(int, bootstrap["replicates"])
    block_days = max(1, cast(int, bootstrap["blockLengthHours"]) // 24)
    rng = random.Random(cast(int, bootstrap["seed"]) + seed_offset)
    estimates: list[float] = []
    for _ in range(replicates):
        indexes = circular_indices(len(values), min(block_days, len(values)), rng)
        sampled = [values[index] for index in indexes]
        estimates.append(compounded_return(sampled) if compound else sum(sampled))
    estimate = compounded_return(values) if compound else sum(values)
    return {
        "blockLengthDays": block_days,
        "estimate": exact_float(estimate),
        "lower95": exact_float(percentile(estimates, 0.025)),
        "replicates": replicates,
        "upper95": exact_float(percentile(estimates, 0.975)),
    }


def simulation_mapping(simulation: Simulation) -> JsonObject:
    """Render one simulation without embedding thousands of calendar rows."""

    excess = simulation.cumulative_return - simulation.benchmark_cumulative_return
    return {
        "benchmarkCumulativeReturn": exact_float(simulation.benchmark_cumulative_return),
        "cohortCount": simulation.cohort_count,
        "costBasisPointsRoundTrip": simulation.cost_bps,
        "cumulativeReturn": exact_float(simulation.cumulative_return),
        "distinctSelectedSymbols": len(simulation.selection_counts),
        "distinctWeeks": simulation.distinct_weeks,
        "excessCumulativeReturn": exact_float(excess),
        "ignoredSignalHoursDuringOpenCohorts": simulation.ignored_signal_hours,
        "maximumDrawdown": exact_float(simulation.maximum_drawdown),
        "publicCapacityProxyUsdAt1bp": (
            exact_float(simulation.public_capacity_proxy_usd_at_1bp, 2)
            if simulation.public_capacity_proxy_usd_at_1bp is not None
            else None
        ),
        "roundTrips": simulation.round_trips,
        "selectionCounts": simulation.selection_counts,
        "topAssetPositivePnlShare": (
            exact_float(simulation.top_asset_positive_pnl_share)
            if simulation.top_asset_positive_pnl_share is not None
            else None
        ),
        "topFiveTradePositivePnlShare": (
            exact_float(simulation.top_five_trade_positive_pnl_share)
            if simulation.top_five_trade_positive_pnl_share is not None
            else None
        ),
        "topSymbolSelectionShare": exact_float(simulation.top_symbol_selection_share),
        "trialId": simulation.trial_id,
    }


def pbo_report(simulations: Mapping[str, Simulation]) -> JsonObject:
    """Compute exact 16-block CSCV/PBO over every frozen diagnostic trial."""

    pbo = cast(JsonObject, cast(JsonObject, protocol()["inference"])["pbo"])
    block_count = cast(int, pbo["blockCount"])
    if sorted(simulations) != sorted(trial.trial_id for trial in trials()):
        raise ContractError("PBO matrix does not contain every frozen trial")
    first = next(iter(simulations.values()))
    start = parse_utc(cast(str, pbo["developmentCoreStartUtc"]))
    end = parse_utc(cast(str, pbo["developmentCoreEndExclusiveUtc"]))
    indexes = [index for index, timestamp in enumerate(first.timeline) if start <= timestamp < end]
    expected_hours = (end - start) // HOUR_US
    if len(indexes) != expected_hours or expected_hours % block_count:
        raise MeasurementError("PBO core is not an exact 16-block calendar")
    block_size = expected_hours // block_count
    trial_ids = sorted(simulations)
    block_means: dict[str, list[float]] = {}
    for trial_id in trial_ids:
        simulation = simulations[trial_id]
        if simulation.timeline != first.timeline:
            raise ContractError("PBO trial calendars are not synchronous")
        core = [simulation.hourly_returns[index] for index in indexes]
        block_means[trial_id] = [
            statistics.fmean(core[offset : offset + block_size])
            for offset in range(0, len(core), block_size)
        ]
    below_median = 0
    logits: list[float] = []
    split_count = 0
    all_blocks = set(range(block_count))
    for in_sample_tuple in itertools.combinations(range(block_count), block_count // 2):
        in_sample = set(in_sample_tuple)
        out_sample = sorted(all_blocks - in_sample)
        in_means = {
            trial_id: statistics.fmean(block_means[trial_id][index] for index in sorted(in_sample))
            for trial_id in trial_ids
        }
        winner = max(trial_ids, key=lambda item: (in_means[item], item))
        out_means = {
            trial_id: statistics.fmean(block_means[trial_id][index] for index in out_sample)
            for trial_id in trial_ids
        }
        ascending = sorted(trial_ids, key=lambda item: (out_means[item], item))
        rank = ascending.index(winner) + 1
        relative_rank = rank / (len(trial_ids) + 1)
        if relative_rank <= 0.5:
            below_median += 1
        logits.append(math.log(relative_rank / (1.0 - relative_rank)))
        split_count += 1
    expected_splits = cast(int, pbo["expectedSymmetricSplitCount"])
    if split_count != expected_splits:
        raise ContractError(f"PBO produced {split_count} splits; expected {expected_splits}")
    return {
        "blockCount": block_count,
        "blockLengthHours": block_size,
        "developmentCoreEndExclusiveUtc": pbo["developmentCoreEndExclusiveUtc"],
        "developmentCoreStartUtc": pbo["developmentCoreStartUtc"],
        "meanLogit": exact_float(statistics.fmean(logits)),
        "pbo": exact_float(below_median / split_count),
        "role": "DIAGNOSTIC_ONLY",
        "splitCount": split_count,
        "trialCount": len(trial_ids),
    }


def static_freeze_files() -> tuple[Path, ...]:
    """Return every pre-outcome semantic input."""

    return (
        PACKET / "__init__.py",
        PACKET / "OFFICIAL_SOURCE_RESEARCH.md",
        PACKET / "README.md",
        PROTOCOL_PATH,
        LEDGER_PATH,
        PACKET / "experiment.py",
        PACKET / "test_experiment.py",
        MANIFEST_PATH,
    )


def freeze_command() -> JsonObject:
    """Bind source custody and all semantic inputs before outcome access."""

    if FREEZE_PATH.exists():
        raise ContractError("freeze already exists")
    if any(
        path.exists()
        for path in (
            RUN_MARKER_PATH,
            DEVELOPMENT_OPENED_PATH,
            PRIMARY_SEAL_PATH,
            HOLDOUT_OPEN_PATH,
            HOLDOUT_OPENED_PATH,
            RESULT_PATH,
        )
    ):
        raise ContractError("outcome receipt exists before freeze")
    files = static_freeze_files()
    missing = [path.name for path in files if not path.is_file()]
    if missing:
        raise ContractError(f"freeze input missing: {missing}")
    manifest = load_json(MANIFEST_PATH)
    if cast(int, manifest["objectsOpened"]) != 0:
        raise ContractError("source manifest indicates pre-freeze outcome access")
    spec = protocol()
    git_output("merge-base", "--is-ancestor", cast(str, spec["canonicalBase"]), "HEAD")
    bound = {path.name: sha256_file(path) for path in files}
    freeze: JsonObject = {
        "authorityHead": git_output("rev-parse", "HEAD"),
        "boundFilesSha256": bound,
        "canonicalBase": spec["canonicalBase"],
        "createdAtUtc": utc_now(),
        "objectsOpenedBeforeFreeze": 0,
        "sourceManifestSha256": sha256_file(MANIFEST_PATH),
        "trialLedgerSha256": sha256_file(LEDGER_PATH),
        "version": "VG19FreezeV1",
    }
    write_json_once(FREEZE_PATH, freeze)
    write_json_once(state_root() / "freeze.v1.json", freeze)
    return freeze


def verify_freeze() -> JsonObject:
    """Authenticate the freeze without opening source outcomes."""

    freeze = load_json(FREEZE_PATH)
    bound = cast(JsonObject, freeze["boundFilesSha256"])
    expected_names = {path.name for path in static_freeze_files()}
    if set(bound) != expected_names:
        raise ContractError("freeze inventory differs from semantic inputs")
    for path in static_freeze_files():
        if sha256_file(path) != cast(str, bound[path.name]):
            raise ContractError(f"post-freeze semantic mutation: {path.name}")
    if sha256_file(MANIFEST_PATH) != cast(str, freeze["sourceManifestSha256"]):
        raise ContractError("source manifest changed after freeze")
    external = state_root() / "freeze.v1.json"
    if not external.is_file() or sha256_file(external) != sha256_file(FREEZE_PATH):
        raise ContractError("external freeze receipt mismatch")
    return freeze


def opened_receipt(
    *,
    stage: str,
    records: Sequence[JsonObject],
    marker_sha: str,
) -> JsonObject:
    """Build one complete opened-object receipt."""

    return {
        "archiveCount": len(records),
        "createdAtUtc": utc_now(),
        "markerSha256": marker_sha,
        "records": list(records),
        "stage": stage,
        "version": "VG19OpenedSourceReceiptV1",
    }


def terminal_unmeasured(reason: str, marker: JsonObject) -> JsonObject:
    """Seal a consumed run after a measurement-validity failure."""

    result: JsonObject = {
        "authority": {
            "capitalAuthority": "NONE",
            "effectUsd": "0",
            "execution": "FORBIDDEN",
            "scope": "PUBLIC_RESEARCH_ONLY",
        },
        "capacity": None,
        "costs": None,
        "createdAtUtc": utc_now(),
        "drawdown": None,
        "freezeSha256": sha256_file(FREEZE_PATH),
        "mechanism": None,
        "mechanismVerdict": "UNMEASURED",
        "pbo": None,
        "profitabilityVerdict": "UNMEASURED",
        "reason": reason,
        "runMarkerSha256": sha256_file(RUN_MARKER_PATH),
        "stageReached": (
            "HOLDOUT_OPENED"
            if HOLDOUT_OPEN_PATH.exists()
            else "PRIMARY_SEALED"
            if PRIMARY_SEAL_PATH.exists()
            else "DEVELOPMENT_OPENED"
        ),
        "version": "VG19ResultV1",
    }
    write_json_once(RESULT_PATH, result)
    write_json_once(state_root() / "result.v1.json", result)
    return result


def run_command() -> JsonObject:
    """Consume the single development/holdout authority and seal the verdict."""

    verify_freeze()
    if RUN_MARKER_PATH.exists() or RESULT_PATH.exists():
        raise ContractError("V-G19 run authority already consumed")
    marker: JsonObject = {
        "createdAtUtc": utc_now(),
        "developmentOpenMaximum": 1,
        "freezeCommit": git_output("rev-parse", "HEAD"),
        "freezeSha256": sha256_file(FREEZE_PATH),
        "holdoutOpenMaximum": 1,
        "repairOrRerun": "FORBIDDEN",
        "sourceManifestSha256": sha256_file(MANIFEST_PATH),
        "version": "VG19RunMarkerV1",
    }
    write_json_once(RUN_MARKER_PATH, marker)
    write_json_once(state_root() / "run-marker.v1.json", marker)
    try:
        spec = protocol()
        data = cast(JsonObject, spec["data"])
        months = cast(list[str], data["archiveMonths"])
        development_months = set(months[:14])
        holdout_months = set(months[14:])
        development_bars, development_opened = load_bars(development_months)
        development_receipt = opened_receipt(
            stage="WARMUP_AND_DEVELOPMENT",
            records=development_opened,
            marker_sha=sha256_file(RUN_MARKER_PATH),
        )
        write_json_once(DEVELOPMENT_OPENED_PATH, development_receipt)
        write_json_once(state_root() / "development-opened.v1.json", development_receipt)
        surprise_by_weeks = {
            weeks: compute_surprises(development_bars, weeks)
            for weeks in cast(list[int], cast(JsonObject, spec["trials"])["lookbackWeeks"])
        }
        partitions = cast(JsonObject, spec["partitions"])
        development = cast(JsonObject, partitions["development"])
        development_start = parse_utc(cast(str, development["startUtc"]))
        development_end = parse_utc(cast(str, development["endExclusiveUtc"]))
        grid_simulations = {
            trial.trial_id: simulate(
                development_bars,
                surprise_by_weeks[trial.lookback_weeks],
                trial,
                development_start,
                development_end,
                cost_bps=40,
            )
            for trial in trials()
        }
        diagnostic_pbo = pbo_report(grid_simulations)
        primary = primary_trial()
        sensitivity_costs = cast(
            list[int], cast(JsonObject, spec["costs"])["roundTripSensitivityBasisPoints"]
        )
        development_sensitivities = {
            cost: simulate(
                development_bars,
                surprise_by_weeks[primary.lookback_weeks],
                primary,
                development_start,
                development_end,
                cost_bps=cost,
            )
            for cost in sensitivity_costs
        }
        primary_seal: JsonObject = {
            "createdAtUtc": utc_now(),
            "developmentOpenedSha256": sha256_file(DEVELOPMENT_OPENED_PATH),
            "developmentSensitivity": {
                str(cost): simulation_mapping(simulation)
                for cost, simulation in sorted(development_sensitivities.items())
            },
            "freezeSha256": sha256_file(FREEZE_PATH),
            "pbo": diagnostic_pbo,
            "primaryTrialId": primary.trial_id,
            "primaryWasFrozenBeforeOutcomes": True,
            "runnerUpRescue": "FORBIDDEN",
            "version": "VG19PrimarySealV1",
        }
        write_json_once(PRIMARY_SEAL_PATH, primary_seal)
        write_json_once(state_root() / "primary-seal.v1.json", primary_seal)
        holdout_marker: JsonObject = {
            "createdAtUtcBeforeOutcomeAccess": utc_now(),
            "maximumOpenCount": 1,
            "primarySealSha256": sha256_file(PRIMARY_SEAL_PATH),
            "primaryTrialId": primary.trial_id,
            "version": "VG19HoldoutOpenV1",
        }
        write_json_once(HOLDOUT_OPEN_PATH, holdout_marker)
        write_json_once(state_root() / "holdout-open.v1.json", holdout_marker)
        holdout_bars, holdout_opened = load_bars(holdout_months)
        holdout_receipt = opened_receipt(
            stage="HOLDOUT",
            records=holdout_opened,
            marker_sha=sha256_file(HOLDOUT_OPEN_PATH),
        )
        write_json_once(HOLDOUT_OPENED_PATH, holdout_receipt)
        write_json_once(state_root() / "holdout-opened.v1.json", holdout_receipt)
        all_bars = merge_bars(development_bars, holdout_bars)
        primary_surprises = compute_surprises(all_bars, primary.lookback_weeks)
        holdout = cast(JsonObject, partitions["holdout"])
        holdout_start = parse_utc(cast(str, holdout["startUtc"]))
        holdout_end = parse_utc(cast(str, holdout["endExclusiveUtc"]))
        holdout_sensitivities = {
            cost: simulate(
                all_bars,
                primary_surprises,
                primary,
                holdout_start,
                holdout_end,
                cost_bps=cost,
            )
            for cost in sensitivity_costs
        }
        mechanism = mechanism_report(
            primary_surprises,
            holdout_start,
            holdout_end,
        )
        stress = holdout_sensitivities[40]
        absolute_bootstrap = bootstrap_report(stress.daily_returns, seed_offset=40, compound=True)
        excess_bootstrap = bootstrap_report(
            stress.excess_daily_returns, seed_offset=41, compound=False
        )
        development_stress = development_sensitivities[40]
        gates = cast(JsonObject, spec["formalGates"])
        lag_values = cast(JsonObject, mechanism["aggregateMedianSpearmanByLag"])
        mechanism_bootstrap = cast(JsonObject, mechanism["bootstrap"])
        measured_gates: dict[str, bool] = {
            "developmentToHoldoutSign": not (
                development_stress.cumulative_return * stress.cumulative_return < 0
            ),
            "holdoutAbsoluteBootstrapLower": (float(cast(str, absolute_bootstrap["lower95"])) > 0),
            "holdoutCohorts": stress.cohort_count >= cast(int, gates["holdoutCohortsMinimum"]),
            "holdoutDistinctSelectedSymbols": len(stress.selection_counts)
            >= cast(int, gates["holdoutDistinctSelectedSymbolsMinimum"]),
            "holdoutDistinctWeeks": stress.distinct_weeks
            >= cast(int, gates["holdoutDistinctWeeksMinimum"]),
            "holdoutExcessBootstrapLower": (float(cast(str, excess_bootstrap["lower95"])) > 0),
            "holdoutMaximumDrawdown": stress.maximum_drawdown
            <= float(cast(str, gates["holdoutMaximumDrawdownMaximum"])),
            "holdoutMaximumSymbolSelectionShare": stress.top_symbol_selection_share
            <= float(cast(str, gates["holdoutMaximumSymbolSelectionShare"])),
            "holdoutStressCumulativeReturn": stress.cumulative_return > 0,
            "mechanismLag1BootstrapLower": float(cast(str, mechanism_bootstrap["lag1Lower95"])) > 0,
            "mechanismLag1ExceedsLag24": float(cast(str, lag_values["1"]))
            > float(cast(str, lag_values["24"])),
        }
        failed_measured = sorted(name for name, passed in measured_gates.items() if not passed)
        unknown_gates = {
            "accountEffectiveFeesMeasured": False,
            "executableCapacityMeasured": False,
        }
        if failed_measured:
            verdict = "NO_GO"
            reason = "ONE_OR_MORE_FROZEN_MEASURED_GATES_FAILED"
        elif not all(unknown_gates.values()):
            verdict = "UNMEASURED"
            reason = "PUBLIC_GATES_PASS_BUT_ACCOUNT_FEE_OR_CAPACITY_TRUTH_ABSENT"
        else:
            verdict = "PUBLIC_RESEARCH_GO"
            reason = "ALL_PUBLIC_AND_AUTHORIZED_TRUTH_GATES_PASS"
        mechanism_supported = measured_gates["mechanismLag1BootstrapLower"]
        decay_supported = measured_gates["mechanismLag1ExceedsLag24"]
        if mechanism_supported and decay_supported:
            mechanism_verdict = "PERSISTENCE_WITH_DECAY_SUPPORTED"
        elif mechanism_supported:
            mechanism_verdict = "PERSISTENCE_WITHOUT_FROZEN_DECAY"
        else:
            mechanism_verdict = "NO_SUPPORTED_PERSISTENCE"
        result: JsonObject = {
            "authority": {
                "capitalAuthority": "NONE",
                "effectUsd": "0",
                "execution": "FORBIDDEN",
                "scope": "PUBLIC_RESEARCH_ONLY",
            },
            "capacity": {
                "executableCapacity": "UNKNOWN",
                "historicalBookDepth": "UNMEASURED",
                "publicScreeningProxyUsdAt1bp": simulation_mapping(stress)[
                    "publicCapacityProxyUsdAt1bp"
                ],
            },
            "costs": {
                "accountEffectiveFee": "UNKNOWN",
                "basePublicScenarioRoundTripBps": 24,
                "holdoutSensitivities": {
                    str(cost): simulation_mapping(simulation)
                    for cost, simulation in sorted(holdout_sensitivities.items())
                },
                "stressGateRoundTripBps": 40,
            },
            "createdAtUtc": utc_now(),
            "drawdown": {
                "frozenMaximum": gates["holdoutMaximumDrawdownMaximum"],
                "holdoutStressMaximum": exact_float(stress.maximum_drawdown),
            },
            "economics": {
                "absoluteStressBootstrap": absolute_bootstrap,
                "developmentStress": simulation_mapping(development_stress),
                "excessStressBootstrap": excess_bootstrap,
                "holdoutStress": simulation_mapping(stress),
            },
            "failedMeasuredGates": failed_measured,
            "freezeSha256": sha256_file(FREEZE_PATH),
            "holdoutOpenSha256": sha256_file(HOLDOUT_OPEN_PATH),
            "holdoutOpenedSha256": sha256_file(HOLDOUT_OPENED_PATH),
            "measuredGates": measured_gates,
            "mechanism": mechanism,
            "mechanismVerdict": mechanism_verdict,
            "pbo": diagnostic_pbo,
            "primarySealSha256": sha256_file(PRIMARY_SEAL_PATH),
            "primaryTrialId": primary.trial_id,
            "profitabilityVerdict": verdict,
            "reason": reason,
            "runMarkerSha256": sha256_file(RUN_MARKER_PATH),
            "source": {
                "developmentArchiveCount": len(development_opened),
                "developmentOpenedSha256": sha256_file(DEVELOPMENT_OPENED_PATH),
                "holdoutArchiveCount": len(holdout_opened),
                "holdoutOpenedSha256": sha256_file(HOLDOUT_OPENED_PATH),
                "sourceManifestSha256": sha256_file(MANIFEST_PATH),
            },
            "unknownTruthGates": unknown_gates,
            "version": "VG19ResultV1",
        }
        write_json_once(RESULT_PATH, result)
        write_json_once(state_root() / "result.v1.json", result)
        return result
    except MeasurementError as exc:
        return terminal_unmeasured(str(exc), marker)


def packet_files_without_inventory() -> tuple[Path, ...]:
    """List the exact evidence packet, excluding its self-referential inventory."""

    return tuple(
        sorted(
            (
                path
                for path in PACKET.iterdir()
                if path.is_file() and path.name != SHA256SUMS_PATH.name
            ),
            key=lambda path: path.name,
        )
    )


def seal_command() -> JsonObject:
    """Create the final exact packet hash inventory once."""

    if SHA256SUMS_PATH.exists():
        raise ContractError("SHA256SUMS already exists")
    if not RESULT_PATH.is_file():
        raise ContractError("terminal result is absent")
    lines = [f"{sha256_file(path)}  {path.name}\n" for path in packet_files_without_inventory()]
    write_bytes_once(SHA256SUMS_PATH, "".join(lines).encode("ascii"))
    return {
        "fileCount": len(lines),
        "sha256sSha256": sha256_file(SHA256SUMS_PATH),
        "version": "VG19PacketSealV1",
    }


def verify_sha256s() -> None:
    """Verify exact inventory membership and every listed digest."""

    if not SHA256SUMS_PATH.is_file():
        raise ContractError("SHA256SUMS is absent")
    parsed: dict[str, str] = {}
    for line in SHA256SUMS_PATH.read_text().splitlines():
        digest, separator, name = line.partition("  ")
        if not separator or len(digest) != 64 or Path(name).name != name or name in parsed:
            raise ContractError("malformed SHA256SUMS")
        parsed[name] = digest
    expected = {path.name for path in packet_files_without_inventory()}
    if set(parsed) != expected:
        raise ContractError("SHA256SUMS inventory membership mismatch")
    for name, digest in parsed.items():
        if sha256_file(PACKET / name) != digest:
            raise ContractError(f"packet digest mismatch: {name}")


def report_command() -> JsonObject:
    """Authenticate committed evidence without network or outcome recomputation."""

    verify_freeze()
    verify_sha256s()
    result = load_json(RESULT_PATH)
    marker_sha = cast(str, result["runMarkerSha256"])
    if sha256_file(RUN_MARKER_PATH) != marker_sha:
        raise ContractError("result/run-marker binding mismatch")
    if cast(str, result["freezeSha256"]) != sha256_file(FREEZE_PATH):
        raise ContractError("result/freeze binding mismatch")
    external_result = state_root() / "result.v1.json"
    if not external_result.is_file() or sha256_file(external_result) != sha256_file(RESULT_PATH):
        raise ContractError("external result receipt mismatch")
    return {
        "capitalAuthority": "NONE",
        "effectUsd": "0",
        "mechanismVerdict": result.get("mechanismVerdict"),
        "packetFileCount": len(packet_files_without_inventory()) + 1,
        "profitabilityVerdict": result["profitabilityVerdict"],
        "reportMode": "VERIFICATION_ONLY",
        "resultSha256": sha256_file(RESULT_PATH),
        "sha256sSha256": sha256_file(SHA256SUMS_PATH),
    }


def build_parser() -> argparse.ArgumentParser:
    """Build the bounded command-line surface."""

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "command",
        choices=("acquire", "freeze", "run", "seal", "report"),
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    """Execute one lifecycle command."""

    arguments = build_parser().parse_args(argv)
    commands = {
        "acquire": acquire_command,
        "freeze": freeze_command,
        "run": run_command,
        "seal": seal_command,
        "report": report_command,
    }
    result = commands[arguments.command]()
    print(canonical_bytes(result).decode(), end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
