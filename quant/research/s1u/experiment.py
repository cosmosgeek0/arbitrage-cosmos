#!/usr/bin/env python3
"""One-run public Binance USD-M S-1U evaluator.

The module keeps acquisition, parsing, causal cohort construction, public-proxy
accounting, and frozen statistics in one inspectable file. Importing it has no
side effects. Only ``main`` touches the network or creates custody artifacts.
"""

from __future__ import annotations

import argparse
import bisect
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
import urllib.error
import urllib.request
import zipfile
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Final

JsonObject = dict[str, Any]

DAY_MS: Final = 86_400_000
MINUTE_MS: Final = 60_000
BAR_MS: Final = 300_000
SIDE_LONG: Final = 1
SIDE_SHORT: Final = -1
HEX_64: Final = re.compile(r"^[0-9a-fA-F]{64}$")
FROZEN_FILES: Final = frozenset(
    {
        "README.md",
        "OFFICIAL_SOURCE_RESEARCH.md",
        "DISTINCTNESS.md",
        "protocol.v1.json",
        "experiment.py",
        "verifier.py",
        "test_experiment.py",
        "test_verifier.py",
    }
)


@dataclass(frozen=True, slots=True)
class Bar:
    """The five kline fields S-1U is allowed to consume."""

    open_ms: int
    close_ms: int
    open_price: float
    quote_volume: float
    taker_buy_quote_volume: float


@dataclass(frozen=True, slots=True)
class Trial:
    """One member of the frozen nine-trial family."""

    lookback_minutes: int
    horizon_minutes: int

    @property
    def trial_id(self) -> str:
        return f"L{self.lookback_minutes:03d}_H{self.horizon_minutes:03d}"


@dataclass(frozen=True, slots=True)
class CostScenario:
    """Public-proxy cost components charged on both fill notionals."""

    name: str
    fee_rate: float
    adverse_rate: float

    @property
    def combined_rate(self) -> float:
        return self.fee_rate + self.adverse_rate


@dataclass(frozen=True, slots=True)
class Selection:
    """Atomic long/short tails selected from lagged flow."""

    longs: tuple[str, ...]
    shorts: tuple[str, ...]
    imbalance: dict[str, float]


@dataclass(slots=True)
class TrialLedger:
    """Complete development or holdout ledger for one frozen trial."""

    trial: Trial
    candidate_count: int
    active_count: int
    cash_reasons: Counter[str]
    daily: dict[str, list[float]]
    active_weeks: set[str]
    long_counts: Counter[str]
    short_counts: Counter[str]
    capacity_usd: list[float]


def canonical_bytes(value: Any) -> bytes:
    """Return the packet's canonical JSON representation."""

    return (
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True) + "\n"
    ).encode()


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_json(path: Path) -> JsonObject:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return value


def atomic_create(path: Path, value: Any) -> None:
    """Create a canonical JSON artifact exactly once."""

    path.parent.mkdir(parents=True, exist_ok=True)
    payload = canonical_bytes(value)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
    except BaseException:
        path.unlink(missing_ok=True)
        raise


def atomic_write_bytes(path: Path, payload: bytes) -> None:
    """Persist one fresh custody object without partial or overwrite states."""

    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.part")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.link(temporary, path)
        temporary.unlink()
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise


def parse_utc_ms(value: str | int | float) -> int:
    """Parse official archive timestamps without assuming their unit."""

    if isinstance(value, (int, float)) or re.fullmatch(r"-?\d+(?:\.0+)?", str(value).strip()):
        number = int(float(value))
        magnitude = abs(number)
        if magnitude >= 100_000_000_000_000_000:
            return number // 1_000_000
        if magnitude >= 100_000_000_000_000:
            return number // 1_000
        return number
    text = str(value).strip().replace(" ", "T")
    if text.endswith("Z"):
        text = f"{text[:-1]}+00:00"
    parsed = datetime.fromisoformat(text)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return int(parsed.astimezone(UTC).timestamp() * 1000)


def iso_ms(value: str) -> int:
    return parse_utc_ms(value)


def utc_day_key(timestamp_ms: int) -> str:
    return datetime.fromtimestamp(timestamp_ms / 1000, tz=UTC).date().isoformat()


def utc_week_key(timestamp_ms: int) -> str:
    iso = datetime.fromtimestamp(timestamp_ms / 1000, tz=UTC).date().isocalendar()
    return f"{iso.year:04d}-W{iso.week:02d}"


def calendar_days(start_ms: int, end_ms: int) -> list[str]:
    first = datetime.fromtimestamp(start_ms / 1000, tz=UTC).date()
    last_exclusive = datetime.fromtimestamp(end_ms / 1000, tz=UTC).date()
    return [
        (first + timedelta(days=offset)).isoformat()
        for offset in range((last_exclusive - first).days)
    ]


def month_range(start_month: str, end_month_exclusive: str) -> list[str]:
    current = datetime.strptime(start_month, "%Y-%m").replace(tzinfo=UTC)
    end = datetime.strptime(end_month_exclusive, "%Y-%m").replace(tzinfo=UTC)
    result: list[str] = []
    while current < end:
        result.append(current.strftime("%Y-%m"))
        year = current.year + (1 if current.month == 12 else 0)
        month = 1 if current.month == 12 else current.month + 1
        current = current.replace(year=year, month=month)
    return result


def settlement_bucket(timestamp_ms: int, bucket_ms: int = MINUTE_MS) -> int:
    """Round to the nearest minute; the caller enforces the deviation bound."""

    return ((timestamp_ms + bucket_ms // 2) // bucket_ms) * bucket_ms


def imbalance_for_bars(bars: Sequence[Bar]) -> float:
    quote = math.fsum(bar.quote_volume for bar in bars)
    if not math.isfinite(quote) or quote <= 0:
        raise ValueError("quote volume must be positive and finite")
    taker_buy = math.fsum(bar.taker_buy_quote_volume for bar in bars)
    value = (2.0 * taker_buy - quote) / quote
    if not math.isfinite(value) or value < -1.000000001 or value > 1.000000001:
        raise ValueError("taker-buy imbalance is outside its semantic range")
    return min(1.0, max(-1.0, value))


def lagged_imbalance(
    bars: Sequence[Bar],
    close_times: Sequence[int],
    actual_settlement_ms: int,
    lookback_minutes: int,
    minimum_lag_ms: int,
) -> float | None:
    """Use only a complete consecutive window ending before the strict cutoff."""

    count = lookback_minutes // 5
    cutoff = actual_settlement_ms - minimum_lag_ms
    end_index = bisect.bisect_right(close_times, cutoff)
    start_index = end_index - count
    if start_index < 0:
        return None
    selected = bars[start_index:end_index]
    if len(selected) != count:
        return None
    if selected[-1].close_ms > cutoff:
        return None
    expected_latest_open = ((cutoff - (BAR_MS - 1)) // BAR_MS) * BAR_MS
    if selected[-1].open_ms != expected_latest_open:
        return None
    if any(
        later.open_ms - earlier.open_ms != BAR_MS for earlier, later in itertools.pairwise(selected)
    ):
        return None
    try:
        return imbalance_for_bars(selected)
    except ValueError:
        return None


def select_atomic_tails(
    values: dict[str, float], symbols: Sequence[str], tail_size: int
) -> Selection | None:
    """Return contrarian tails, refusing a tie at either membership boundary."""

    if set(values) != set(symbols):
        return None
    ordered = sorted((values[symbol], symbol) for symbol in symbols)
    if len(ordered) < tail_size * 2:
        return None
    tolerance = 1e-12
    if math.isclose(
        ordered[tail_size - 1][0], ordered[tail_size][0], abs_tol=tolerance, rel_tol=0.0
    ):
        return None
    high_boundary = len(ordered) - tail_size
    if math.isclose(
        ordered[high_boundary - 1][0],
        ordered[high_boundary][0],
        abs_tol=tolerance,
        rel_tol=0.0,
    ):
        return None
    longs = tuple(symbol for _, symbol in ordered[:tail_size])
    shorts = tuple(symbol for _, symbol in ordered[-tail_size:])
    return Selection(longs=longs, shorts=shorts, imbalance=dict(values))


def position_pnl(
    entry_price: float,
    exit_price: float,
    side: int,
    entry_notional: float,
    cost_rate: float,
) -> float:
    """Linear-contract PnL minus costs on entry and exit notionals."""

    if entry_price <= 0 or exit_price <= 0:
        raise ValueError("prices must be positive")
    ratio = exit_price / entry_price
    gross = entry_notional * side * (ratio - 1.0)
    exit_notional = entry_notional * ratio
    costs = cost_rate * (entry_notional + exit_notional)
    return gross - costs


def cohort_pnl(
    prices: dict[str, tuple[float, float]],
    selection: Selection,
    member_notional: float,
    scenarios: Sequence[CostScenario],
) -> dict[str, float]:
    result = {scenario.name: 0.0 for scenario in scenarios}
    for side, members in ((SIDE_LONG, selection.longs), (SIDE_SHORT, selection.shorts)):
        for symbol in members:
            entry_price, exit_price = prices[symbol]
            for scenario in scenarios:
                result[scenario.name] += position_pnl(
                    entry_price,
                    exit_price,
                    side,
                    member_notional,
                    scenario.combined_rate,
                )
    return result


def exact_prior_day_quote_volume(
    bars_by_open: dict[int, Bar], event_bucket_ms: int
) -> float | None:
    event_day_start = (event_bucket_ms // DAY_MS) * DAY_MS
    prior_start = event_day_start - DAY_MS
    rows = [bars_by_open.get(prior_start + offset * BAR_MS) for offset in range(288)]
    if any(row is None for row in rows):
        return None
    complete = [row for row in rows if row is not None]
    if any(row.close_ms >= event_day_start for row in complete):
        return None
    total = math.fsum(row.quote_volume for row in complete)
    return total if math.isfinite(total) and total > 0 else None


def quantile(values: Sequence[float], probability: float) -> float:
    if not values:
        raise ValueError("quantile requires at least one value")
    if probability < 0 or probability > 1:
        raise ValueError("probability must be in [0, 1]")
    ordered = sorted(values)
    location = (len(ordered) - 1) * probability
    lower = math.floor(location)
    upper = math.ceil(location)
    if lower == upper:
        return ordered[lower]
    weight = location - lower
    return ordered[lower] * (1.0 - weight) + ordered[upper] * weight


def circular_block_indices(
    length: int, replicates: int, block_days: int, seed: int
) -> list[list[int]]:
    if length <= 0 or replicates <= 0 or block_days <= 0:
        raise ValueError("bootstrap dimensions must be positive")
    generator = random.Random(seed)
    samples: list[list[int]] = []
    for _ in range(replicates):
        indices: list[int] = []
        while len(indices) < length:
            start = generator.randrange(length)
            indices.extend((start + offset) % length for offset in range(block_days))
        samples.append(indices[:length])
    return samples


def bootstrap_totals(series: Sequence[float], samples: Sequence[Sequence[int]]) -> list[float]:
    return [math.fsum(series[index] for index in sample) for sample in samples]


def centered_block_p(series: Sequence[float], samples: Sequence[Sequence[int]]) -> float:
    observed = math.fsum(series)
    mean = statistics.fmean(series)
    centered = [value - mean for value in series]
    exceedances = sum(
        math.fsum(centered[index] for index in sample) >= observed for sample in samples
    )
    return (exceedances + 1.0) / (len(samples) + 1.0)


def holm_adjust(raw: dict[str, float]) -> dict[str, float]:
    ordered = sorted(raw.items(), key=lambda item: (item[1], item[0]))
    count = len(ordered)
    adjusted: dict[str, float] = {}
    running = 0.0
    for rank, (trial_id, value) in enumerate(ordered):
        running = max(running, min(1.0, (count - rank) * value))
        adjusted[trial_id] = running
    return adjusted


def white_reality_check_p(
    series_by_trial: Mapping[str, Sequence[float]], samples: Sequence[Sequence[int]]
) -> float:
    observed = max(math.fsum(series) for series in series_by_trial.values())
    centered = {
        trial_id: [value - statistics.fmean(series) for value in series]
        for trial_id, series in series_by_trial.items()
    }
    exceedances = 0
    for sample in samples:
        simulated_max = max(
            math.fsum(series[index] for index in sample) for series in centered.values()
        )
        exceedances += simulated_max >= observed
    return (exceedances + 1.0) / (len(samples) + 1.0)


def chronological_blocks(length: int, count: int) -> list[list[int]]:
    if count <= 0 or length < count:
        raise ValueError("calendar must have at least one observation per block")
    return [
        list(range((block * length) // count, ((block + 1) * length) // count))
        for block in range(count)
    ]


def cscv_pbo(series_by_trial: Mapping[str, Sequence[float]], block_count: int) -> JsonObject:
    """Compute deterministic CSCV rank degradation over all half splits."""

    trial_ids = sorted(series_by_trial)
    length = len(next(iter(series_by_trial.values())))
    blocks = chronological_blocks(length, block_count)
    train_count = block_count // 2
    failures = 0
    logits: list[float] = []
    splits = 0
    for train_blocks in itertools.combinations(range(block_count), train_count):
        train_set = set(train_blocks)
        train_indices = [index for block in train_set for index in blocks[block]]
        test_indices = [
            index
            for block in range(block_count)
            if block not in train_set
            for index in blocks[block]
        ]
        train_totals = {
            trial_id: math.fsum(series_by_trial[trial_id][index] for index in train_indices)
            for trial_id in trial_ids
        }
        champion = min(
            trial_ids,
            key=lambda trial_id: (-train_totals[trial_id], trial_id),
        )
        test_totals = {
            trial_id: math.fsum(series_by_trial[trial_id][index] for index in test_indices)
            for trial_id in trial_ids
        }
        champion_value = test_totals[champion]
        below = sum(value < champion_value for value in test_totals.values())
        equal = sum(value == champion_value for value in test_totals.values())
        percentile = (below + 0.5 * equal) / len(trial_ids)
        failures += percentile <= 0.5
        clipped = min(1.0 - 1e-12, max(1e-12, percentile))
        logits.append(math.log(clipped / (1.0 - clipped)))
        splits += 1
    return {
        "method": "CSCV",
        "blocks": block_count,
        "train_blocks": train_count,
        "splits": splits,
        "pbo": failures / splits,
        "median_logit_oos_rank": statistics.median(logits),
    }


def maximum_drawdown_fraction(series: Sequence[float], bankroll: float) -> float:
    cumulative = 0.0
    peak = 0.0
    maximum = 0.0
    for value in series:
        cumulative += value
        peak = max(peak, cumulative)
        maximum = max(maximum, peak - cumulative)
    return maximum / bankroll


def parse_checksum(text: str, expected_name: str) -> str:
    lines = [line for line in text.splitlines() if line.strip()]
    if len(lines) != 1:
        raise ValueError(f"checksum sidecar for {expected_name} must expose one record")
    match = re.fullmatch(r"\s*([0-9a-fA-F]{64})\s+\*?([^/\s]+)\s*", lines[0])
    if match is None or match.group(2) != expected_name:
        raise ValueError(f"checksum sidecar does not exactly bind {expected_name}")
    return match.group(1).lower()


def request_bytes(url: str, attempts: int = 3) -> tuple[bytes, JsonObject]:
    """Fetch one official object with bounded in-invocation transport retries."""

    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        request = urllib.request.Request(url, headers={"User-Agent": "S-1U-public-research/1.0"})
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                body = response.read()
                metadata = {
                    "url": url,
                    "status": int(response.status),
                    "etag": response.headers.get("ETag"),
                    "last_modified": response.headers.get("Last-Modified"),
                    "content_length_header": response.headers.get("Content-Length"),
                    "attempt": attempt,
                }
                if response.status != 200:
                    raise ValueError(f"unexpected HTTP status {response.status} for {url}")
                return body, metadata
        except (OSError, urllib.error.URLError, ValueError) as error:
            last_error = error
    raise RuntimeError(
        f"official source request failed after {attempts} attempts: {url}"
    ) from last_error


def archive_relative_path(dataset: str, symbol: str, month: str) -> str:
    if dataset == "klines":
        return f"klines/{symbol}/5m/{symbol}-5m-{month}.zip"
    if dataset == "fundingRate":
        return f"fundingRate/{symbol}/{symbol}-fundingRate-{month}.zip"
    raise ValueError(f"unsupported dataset: {dataset}")


def expected_source_rows(
    root_url: str, symbols: Sequence[str], months: Sequence[str], phase: str
) -> list[JsonObject]:
    result: list[JsonObject] = []
    for month in months:
        for symbol in symbols:
            for dataset in ("klines", "fundingRate"):
                relative = archive_relative_path(dataset, symbol, month)
                url = f"{root_url}/{relative}"
                result.append(
                    {
                        "dataset": dataset,
                        "symbol": symbol,
                        "month": month,
                        "phase": phase,
                        "url": url,
                        "checksum_url": f"{url}.CHECKSUM",
                        "state": "NOT_REQUESTED_UNOPENED",
                    }
                )
    return result


def acquire_rows(raw_root: Path, rows: Sequence[JsonObject], manifest: list[JsonObject]) -> None:
    for expected in rows:
        relative = archive_relative_path(
            str(expected["dataset"]), str(expected["symbol"]), str(expected["month"])
        )
        destination = raw_root / "raw" / relative
        sidecar_destination = destination.with_name(f"{destination.name}.CHECKSUM")
        if destination.exists() or sidecar_destination.exists():
            raise FileExistsError(f"fresh one-run custody requires absent object: {destination}")
        sidecar_body, sidecar_http = request_bytes(str(expected["checksum_url"]))
        sidecar_text = sidecar_body.decode("utf-8")
        publisher_sha = parse_checksum(sidecar_text, destination.name)
        body, object_http = request_bytes(str(expected["url"]))
        actual_sha = sha256_bytes(body)
        if actual_sha != publisher_sha:
            raise ValueError(f"publisher checksum mismatch for {expected['url']}")
        try:
            atomic_write_bytes(sidecar_destination, sidecar_body)
            atomic_write_bytes(destination, body)
        except BaseException:
            sidecar_destination.unlink(missing_ok=True)
            destination.unlink(missing_ok=True)
            raise
        row = dict(expected)
        row.update(
            {
                "state": "VERIFIED_BODY_PRESENT",
                "publisher_sha256": publisher_sha,
                "actual_sha256": actual_sha,
                "bytes": len(body),
                "sidecar_sha256": sha256_bytes(sidecar_body),
                "raw_relative_path": str(destination.relative_to(raw_root)),
                "http": object_http,
                "checksum_http": sidecar_http,
            }
        )
        manifest.append(row)


def safe_csv_member(path: Path) -> tuple[str, bytes]:
    with zipfile.ZipFile(path) as archive:
        members = [
            info
            for info in archive.infolist()
            if not info.is_dir() and not info.filename.startswith("__MACOSX/")
        ]
        if len(members) != 1 or not members[0].filename.endswith(".csv"):
            raise ValueError(f"{path} must contain exactly one CSV member")
        member = members[0]
        expected_member = f"{path.stem}.csv"
        if Path(member.filename).name != member.filename or member.filename != expected_member:
            raise ValueError(f"unsafe ZIP member name: {member.filename}")
        return member.filename, archive.read(member)


def csv_rows(payload: bytes) -> list[list[str]]:
    text = payload.decode("utf-8-sig")
    return [row for row in csv.reader(io.StringIO(text)) if row]


def archive_month_bounds(path: Path) -> tuple[int, int]:
    match = re.search(r"-(\d{4}-\d{2})\.zip$", path.name)
    if match is None:
        raise ValueError(f"archive name has no frozen month: {path.name}")
    current = datetime.strptime(match.group(1), "%Y-%m").replace(tzinfo=UTC)
    next_year = current.year + (1 if current.month == 12 else 0)
    next_month = 1 if current.month == 12 else current.month + 1
    following = current.replace(year=next_year, month=next_month)
    return int(current.timestamp() * 1000), int(following.timestamp() * 1000)


def parse_kline_zip(path: Path) -> tuple[str, list[Bar]]:
    member, payload = safe_csv_member(path)
    rows = csv_rows(payload)
    expected_header = [
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
    ]
    if not rows or [value.strip().lower() for value in rows[0]] != expected_header:
        raise ValueError(f"unexpected frozen kline schema in {path}")
    rows = rows[1:]
    month_start, month_end = archive_month_bounds(path)
    bars: list[Bar] = []
    prior_open: int | None = None
    for row in rows:
        if len(row) != 12:
            raise ValueError(f"unexpected kline column count in {path}")
        open_ms = parse_utc_ms(row[0])
        close_ms = parse_utc_ms(row[6])
        open_price = float(row[1])
        quote_volume = float(row[7])
        taker_buy_quote = float(row[10])
        if not month_start <= open_ms < month_end:
            raise ValueError(f"kline row outside archive month in {path}")
        if prior_open is not None and open_ms <= prior_open:
            raise ValueError(f"non-increasing kline open times in {path}")
        if close_ms != open_ms + BAR_MS - 1:
            raise ValueError(f"invalid five-minute close time in {path}")
        if (
            not math.isfinite(open_price)
            or not math.isfinite(quote_volume)
            or not math.isfinite(taker_buy_quote)
            or open_price <= 0
            or quote_volume < 0
            or taker_buy_quote < 0
            or taker_buy_quote > quote_volume * 1.000000001
        ):
            raise ValueError(f"invalid kline numeric semantics in {path}")
        bars.append(
            Bar(
                open_ms=open_ms,
                close_ms=close_ms,
                open_price=open_price,
                quote_volume=quote_volume,
                taker_buy_quote_volume=taker_buy_quote,
            )
        )
        prior_open = open_ms
    return member, bars


def parse_funding_zip(path: Path) -> tuple[str, list[int]]:
    member, payload = safe_csv_member(path)
    rows = csv_rows(payload)
    expected_header = ["calc_time", "funding_interval_hours", "last_funding_rate"]
    if not rows or [value.strip().lower() for value in rows[0]] != expected_header:
        raise ValueError(f"unexpected frozen funding schema in {path}")
    rows = rows[1:]
    month_start, month_end = archive_month_bounds(path)
    timestamps: list[int] = []
    for row in rows:
        if len(row) != 3:
            raise ValueError(f"unexpected funding column count in {path}")
        timestamp = parse_utc_ms(row[0])
        if not month_start <= timestamp < month_end:
            raise ValueError(f"funding row outside archive month in {path}")
        interval_hours = float(row[1])
        funding_rate = float(row[2])
        if (
            not math.isfinite(interval_hours)
            or interval_hours <= 0
            or not math.isfinite(funding_rate)
        ):
            raise ValueError(f"invalid funding numeric semantics in {path}")
        if timestamps and timestamp <= timestamps[-1]:
            raise ValueError(f"non-increasing funding timestamps in {path}")
        timestamps.append(timestamp)
    return member, timestamps


def source_path(
    raw_root: Path,
    manifest: Sequence[JsonObject],
    dataset: str,
    symbol: str,
    month: str,
) -> Path:
    matches = [
        row
        for row in manifest
        if row["dataset"] == dataset
        and row["symbol"] == symbol
        and row["month"] == month
        and row["state"] == "VERIFIED_BODY_PRESENT"
    ]
    if len(matches) != 1:
        raise ValueError(f"expected one verified source row for {dataset}/{symbol}/{month}")
    return raw_root / str(matches[0]["raw_relative_path"])


def load_market_data(
    raw_root: Path,
    manifest: list[JsonObject],
    symbols: Sequence[str],
    months: Sequence[str],
) -> tuple[dict[str, list[Bar]], dict[str, list[int]]]:
    bars: dict[str, list[Bar]] = {}
    settlements: dict[str, list[int]] = {}
    member_by_key: dict[tuple[str, str, str], str] = {}
    for symbol in symbols:
        symbol_bars: list[Bar] = []
        symbol_settlements: list[int] = []
        for month in months:
            kline_path = source_path(raw_root, manifest, "klines", symbol, month)
            funding_path = source_path(raw_root, manifest, "fundingRate", symbol, month)
            kline_member, month_bars = parse_kline_zip(kline_path)
            funding_member, month_settlements = parse_funding_zip(funding_path)
            member_by_key[("klines", symbol, month)] = kline_member
            member_by_key[("fundingRate", symbol, month)] = funding_member
            symbol_bars.extend(month_bars)
            symbol_settlements.extend(month_settlements)
        if any(
            later.open_ms <= earlier.open_ms for earlier, later in itertools.pairwise(symbol_bars)
        ):
            raise ValueError(f"duplicate or unordered cross-month bars for {symbol}")
        if any(later <= earlier for earlier, later in itertools.pairwise(symbol_settlements)):
            raise ValueError(f"duplicate or unordered cross-month settlements for {symbol}")
        bars[symbol] = symbol_bars
        settlements[symbol] = symbol_settlements
    for row in manifest:
        key = (str(row["dataset"]), str(row["symbol"]), str(row["month"]))
        if key in member_by_key:
            row["zip_member"] = member_by_key[key]
            row["zip_opened"] = True
    return bars, settlements


def common_settlement_events(
    settlements: dict[str, list[int]],
    symbols: Sequence[str],
    start_ms: int,
    end_ms: int,
    maximum_deviation_ms: int,
) -> list[tuple[int, dict[str, int]]]:
    """Build the union denominator; incomplete buckets remain cash candidates."""

    by_symbol: dict[str, dict[int, list[int]]] = {}
    candidate_buckets: set[int] = set()
    for symbol in symbols:
        bucket_map: dict[int, list[int]] = {}
        for timestamp in settlements[symbol]:
            bucket = settlement_bucket(timestamp)
            bucket_map.setdefault(bucket, []).append(timestamp)
            if start_ms <= bucket < end_ms:
                candidate_buckets.add(bucket)
        by_symbol[symbol] = bucket_map
    result: list[tuple[int, dict[str, int]]] = []
    for bucket in sorted(candidate_buckets):
        valid: dict[str, int] = {}
        for symbol in symbols:
            timestamps = by_symbol[symbol].get(bucket, [])
            if len(timestamps) == 1 and abs(timestamps[0] - bucket) <= maximum_deviation_ms:
                valid[symbol] = timestamps[0]
        result.append((bucket, valid))
    return result


def build_scenarios(protocol: JsonObject) -> list[CostScenario]:
    scenarios = protocol["costs"]["scenarios"]
    return [
        CostScenario(
            name=name,
            fee_rate=float(values["public_fee_bp_per_fill"]) / 10_000,
            adverse_rate=float(values["adverse_execution_bp_per_fill"]) / 10_000,
        )
        for name, values in scenarios.items()
    ]


def build_trials(protocol: JsonObject) -> list[Trial]:
    return [
        Trial(lookback_minutes=lookback, horizon_minutes=horizon)
        for lookback in protocol["signal"]["lookback_minutes"]
        for horizon in protocol["response"]["horizon_minutes"]
    ]


def new_ledger(trial: Trial, days: Sequence[str], scenarios: Sequence[CostScenario]) -> TrialLedger:
    return TrialLedger(
        trial=trial,
        candidate_count=0,
        active_count=0,
        cash_reasons=Counter(),
        daily={scenario.name: [0.0 for _ in days] for scenario in scenarios},
        active_weeks=set(),
        long_counts=Counter(),
        short_counts=Counter(),
        capacity_usd=[],
    )


def evaluate_trials(
    protocol: JsonObject,
    bars: dict[str, list[Bar]],
    settlements: dict[str, list[int]],
    start_ms: int,
    end_ms: int,
    trials: Sequence[Trial],
) -> tuple[list[str], dict[str, TrialLedger], JsonObject]:
    symbols = [str(symbol) for symbol in protocol["universe"]["symbols"]]
    scenarios = build_scenarios(protocol)
    days = calendar_days(start_ms, end_ms)
    day_index = {day: index for index, day in enumerate(days)}
    bars_by_open = {
        symbol: {bar.open_ms: bar for bar in symbol_bars} for symbol, symbol_bars in bars.items()
    }
    close_times = {
        symbol: [bar.close_ms for bar in symbol_bars] for symbol, symbol_bars in bars.items()
    }
    ledgers = {trial.trial_id: new_ledger(trial, days, scenarios) for trial in trials}
    clock = protocol["clock"]
    allocation = protocol["allocation"]
    capacity = protocol["capacity"]
    tail_size = int(protocol["signal"]["tail_size"])
    events = common_settlement_events(
        settlements,
        symbols,
        start_ms,
        end_ms,
        int(clock["maximum_bucket_deviation_ms"]),
    )
    next_settlement: dict[str, dict[int, int | None]] = {}
    for symbol in symbols:
        times = settlements[symbol]
        next_settlement[symbol] = {}
        for timestamp in times:
            next_index = bisect.bisect_right(times, timestamp)
            next_settlement[symbol][timestamp] = (
                times[next_index] if next_index < len(times) else None
            )

    for event_bucket, actual_by_symbol in events:
        event_day = utc_day_key(event_bucket)
        for trial in trials:
            ledger = ledgers[trial.trial_id]
            ledger.candidate_count += 1
            entry_ms = event_bucket + int(clock["entry_grid_offset_ms"])
            exit_ms = entry_ms + trial.horizon_minutes * MINUTE_MS
            reason: str | None = None
            if set(actual_by_symbol) != set(symbols):
                reason = "SETTLEMENT_COHORT_INVALID"
            elif event_day not in day_index or exit_ms >= end_ms:
                reason = "RESPONSE_OUTSIDE_SPLIT"
            if reason is None and any(
                entry_ms <= actual or entry_ms - actual < int(clock["minimum_entry_delay_ms"])
                for actual in actual_by_symbol.values()
            ):
                reason = "ENTRY_CLOCK_INVALID"
            values: dict[str, float] = {}
            if reason is None:
                for symbol in symbols:
                    value = lagged_imbalance(
                        bars[symbol],
                        close_times[symbol],
                        actual_by_symbol[symbol],
                        trial.lookback_minutes,
                        int(clock["minimum_signal_lag_ms"]),
                    )
                    if value is None:
                        reason = "LAG_WINDOW_INCOMPLETE"
                        break
                    values[symbol] = value
            selection = select_atomic_tails(values, symbols, tail_size) if reason is None else None
            if reason is None and selection is None:
                reason = "ATOMIC_TAIL_TIE_OR_INCOMPLETE"
            prices: dict[str, tuple[float, float]] = {}
            selected_symbols: tuple[str, ...] = ()
            if selection is not None:
                selected_symbols = selection.longs + selection.shorts
            if reason is None:
                for symbol in selected_symbols:
                    entry_bar = bars_by_open[symbol].get(entry_ms)
                    exit_bar = bars_by_open[symbol].get(exit_ms)
                    if entry_bar is None or exit_bar is None:
                        reason = "ENTRY_OR_EXIT_BAR_MISSING"
                        break
                    prices[symbol] = (entry_bar.open_price, exit_bar.open_price)
            if reason is None:
                for symbol in selected_symbols:
                    following = next_settlement[symbol].get(actual_by_symbol[symbol])
                    if following is None or following <= exit_ms:
                        reason = "LATER_SETTLEMENT_GUARD_FAILED"
                        break
            prior_volumes: list[float] = []
            if reason is None:
                for symbol in selected_symbols:
                    volume = exact_prior_day_quote_volume(bars_by_open[symbol], event_bucket)
                    if volume is None:
                        reason = "PRIOR_COMPLETE_DAY_VOLUME_MISSING"
                        break
                    prior_volumes.append(volume)
            if reason is not None or selection is None:
                ledger.cash_reasons[reason or "UNCLASSIFIED_CASH"] += 1
                continue
            pnl = cohort_pnl(
                prices,
                selection,
                float(allocation["member_notional_usd"]),
                scenarios,
            )
            index = day_index[event_day]
            for scenario in scenarios:
                ledger.daily[scenario.name][index] += pnl[scenario.name]
            ledger.active_count += 1
            ledger.active_weeks.add(utc_week_key(event_bucket))
            ledger.long_counts.update(selection.longs)
            ledger.short_counts.update(selection.shorts)
            ledger.capacity_usd.append(
                2.0 * tail_size * float(capacity["participation_rate"]) * min(prior_volumes)
            )

    event_summary = {
        "candidate_union_settlement_count": len(events),
        "complete_observed_settlement_count": sum(
            set(actual_by_symbol) == set(symbols) for _, actual_by_symbol in events
        ),
        "first_candidate_settlement": (
            datetime.fromtimestamp(events[0][0] / 1000, tz=UTC).isoformat() if events else None
        ),
        "last_candidate_settlement": (
            datetime.fromtimestamp(events[-1][0] / 1000, tz=UTC).isoformat() if events else None
        ),
        "calendar_days": len(days),
    }
    return days, ledgers, event_summary


def summarize_development(
    protocol: JsonObject,
    days: Sequence[str],
    ledgers: dict[str, TrialLedger],
    event_summary: JsonObject,
) -> JsonObject:
    stats = protocol["statistics"]
    bootstrap = stats["bootstrap"]
    samples = circular_block_indices(
        len(days),
        int(bootstrap["replicates"]),
        int(bootstrap["circular_block_days"]),
        int(bootstrap["seed"]),
    )
    trial_count = len(ledgers)
    raw_p = {
        trial_id: centered_block_p(ledger.daily["base"], samples)
        for trial_id, ledger in ledgers.items()
    }
    holm = holm_adjust(raw_p)
    base_series = {trial_id: ledger.daily["base"] for trial_id, ledger in ledgers.items()}
    white_p = white_reality_check_p(base_series, samples)
    pbo = cscv_pbo(base_series, int(stats["pbo"]["chronological_blocks"]))
    summaries: dict[str, JsonObject] = {}
    for trial_id, ledger in sorted(ledgers.items()):
        base_bootstrap = bootstrap_totals(ledger.daily["base"], samples)
        base_total = math.fsum(ledger.daily["base"])
        stress_total = math.fsum(ledger.daily["stress"])
        severe_total = math.fsum(ledger.daily["severe"])
        summaries[trial_id] = {
            "trial_id": trial_id,
            "lookback_minutes": ledger.trial.lookback_minutes,
            "horizon_minutes": ledger.trial.horizon_minutes,
            "candidate_common_settlements": ledger.candidate_count,
            "active_cohorts": ledger.active_count,
            "cash_cohorts": ledger.candidate_count - ledger.active_count,
            "cash_reasons": dict(sorted(ledger.cash_reasons.items())),
            "active_weeks": len(ledger.active_weeks),
            "long_counts": dict(sorted(ledger.long_counts.items())),
            "short_counts": dict(sorted(ledger.short_counts.items())),
            "net_usd_per_1000": {
                "base": base_total,
                "stress": stress_total,
                "severe": severe_total,
            },
            "base_interval_95_usd_per_1000": {
                "lower": quantile(base_bootstrap, 0.025),
                "upper": quantile(base_bootstrap, 0.975),
            },
            "base_familywise_bonferroni_lower_usd_per_1000": quantile(
                base_bootstrap, 0.05 / trial_count
            ),
            "centered_block_one_sided_p": raw_p[trial_id],
            "holm_adjusted_p": holm[trial_id],
            "max_drawdown_fraction_of_1000": maximum_drawdown_fraction(
                ledger.daily["base"], float(protocol["allocation"]["cohort_notional_usd"])
            ),
            "public_capacity_proxy_usd": {
                "observations": len(ledger.capacity_usd),
                "minimum": min(ledger.capacity_usd) if ledger.capacity_usd else None,
                "p05": quantile(ledger.capacity_usd, 0.05) if ledger.capacity_usd else None,
                "median": statistics.median(ledger.capacity_usd) if ledger.capacity_usd else None,
            },
            "public_capacity_proxy_observations_usd": ledger.capacity_usd,
            "complete_daily_pnl_usd": dict(sorted(ledger.daily.items())),
        }
    champion_id = min(
        summaries,
        key=lambda trial_id: (
            -float(summaries[trial_id]["net_usd_per_1000"]["base"]),
            trial_id,
        ),
    )
    champion = summaries[champion_id]
    gates_config = protocol["development_gates"]
    symbols = [str(symbol) for symbol in protocol["universe"]["symbols"]]
    capacity_p05 = champion["public_capacity_proxy_usd"]["p05"]
    gate_values = {
        "candidate_common_settlements_min": (
            int(champion["candidate_common_settlements"])
            >= int(gates_config["candidate_common_settlements_min"])
        ),
        "active_cohorts_min": (
            int(champion["active_cohorts"]) >= int(gates_config["active_cohorts_min"])
        ),
        "active_weeks_min": (
            int(champion["active_weeks"]) >= int(gates_config["active_weeks_min"])
        ),
        "each_symbol_long_min": all(
            int(champion["long_counts"].get(symbol, 0)) >= int(gates_config["each_symbol_long_min"])
            for symbol in symbols
        ),
        "each_symbol_short_min": all(
            int(champion["short_counts"].get(symbol, 0))
            >= int(gates_config["each_symbol_short_min"])
            for symbol in symbols
        ),
        "base_net_positive": (
            float(champion["net_usd_per_1000"]["base"])
            > float(gates_config["base_net_usd_per_1000_gt"])
        ),
        "stress_net_positive": (
            float(champion["net_usd_per_1000"]["stress"])
            > float(gates_config["stress_net_usd_per_1000_gt"])
        ),
        "pointwise_lower_bound_positive": (
            float(champion["base_interval_95_usd_per_1000"]["lower"])
            > float(gates_config["pointwise_lower_bound_gt"])
        ),
        "familywise_lower_bound_positive": (
            float(champion["base_familywise_bonferroni_lower_usd_per_1000"])
            > float(gates_config["familywise_lower_bound_gt"])
        ),
        "champion_holm_p": (
            float(champion["holm_adjusted_p"]) <= float(gates_config["champion_holm_p_lte"])
        ),
        "white_reality_check_p": (white_p <= float(gates_config["white_reality_check_p_lte"])),
        "pbo": float(pbo["pbo"]) <= float(gates_config["pbo_lte"]),
        "max_drawdown": (
            float(champion["max_drawdown_fraction_of_1000"])
            <= float(gates_config["max_drawdown_lte"])
        ),
        "capacity_p05": (
            capacity_p05 is not None
            and float(capacity_p05) >= float(gates_config["capacity_p05_usd_gte"])
        ),
    }
    return {
        "schema": "s1u.development.v1",
        "window": {
            "start": protocol["window"]["study_start"],
            "end_exclusive": protocol["window"]["development_end"],
            "calendar_days": list(days),
        },
        "event_clock": event_summary,
        "trial_count": trial_count,
        "selection_rule": stats["selection_metric"],
        "selection_tie_break": stats["selection_tie_break"],
        "champion_trial_id": champion_id,
        "white_reality_check_p": white_p,
        "pbo": pbo,
        "development_gates": gate_values,
        "all_development_gates_pass": all(gate_values.values()),
        "trials": summaries,
    }


def summarize_holdout(
    protocol: JsonObject,
    days: Sequence[str],
    ledgers: dict[str, TrialLedger],
    event_summary: JsonObject,
) -> JsonObject:
    if len(ledgers) != 1:
        raise ValueError("holdout must evaluate exactly one sealed champion")
    trial_id, ledger = next(iter(ledgers.items()))
    bootstrap = protocol["statistics"]["bootstrap"]
    samples = circular_block_indices(
        len(days),
        int(bootstrap["replicates"]),
        int(bootstrap["circular_block_days"]),
        int(bootstrap["seed"]) + 1,
    )
    base_bootstrap = bootstrap_totals(ledger.daily["base"], samples)
    summary: JsonObject = {
        "trial_id": trial_id,
        "lookback_minutes": ledger.trial.lookback_minutes,
        "horizon_minutes": ledger.trial.horizon_minutes,
        "candidate_common_settlements": ledger.candidate_count,
        "active_cohorts": ledger.active_count,
        "cash_cohorts": ledger.candidate_count - ledger.active_count,
        "cash_reasons": dict(sorted(ledger.cash_reasons.items())),
        "active_weeks": len(ledger.active_weeks),
        "long_counts": dict(sorted(ledger.long_counts.items())),
        "short_counts": dict(sorted(ledger.short_counts.items())),
        "net_usd_per_1000": {
            name: math.fsum(values) for name, values in sorted(ledger.daily.items())
        },
        "base_interval_95_usd_per_1000": {
            "lower": quantile(base_bootstrap, 0.025),
            "upper": quantile(base_bootstrap, 0.975),
        },
        "max_drawdown_fraction_of_1000": maximum_drawdown_fraction(
            ledger.daily["base"], float(protocol["allocation"]["cohort_notional_usd"])
        ),
        "public_capacity_proxy_observations_usd": ledger.capacity_usd,
        "complete_daily_pnl_usd": dict(sorted(ledger.daily.items())),
    }
    gates_config = protocol["holdout_gates_if_opened"]
    gates = {
        "active_cohorts_min": (
            int(summary["active_cohorts"]) >= int(gates_config["active_cohorts_min"])
        ),
        "base_net_positive": (
            float(summary["net_usd_per_1000"]["base"])
            > float(gates_config["base_net_usd_per_1000_gt"])
        ),
        "stress_net_positive": (
            float(summary["net_usd_per_1000"]["stress"])
            > float(gates_config["stress_net_usd_per_1000_gt"])
        ),
        "pointwise_lower_bound_positive": (
            float(summary["base_interval_95_usd_per_1000"]["lower"])
            > float(gates_config["pointwise_lower_bound_gt"])
        ),
        "max_drawdown": (
            float(summary["max_drawdown_fraction_of_1000"])
            <= float(gates_config["max_drawdown_lte"])
        ),
    }
    return {
        "schema": "s1u.holdout.v1",
        "window": {
            "start": protocol["window"]["development_end"],
            "end_exclusive": protocol["window"]["holdout_end"],
            "calendar_days": list(days),
        },
        "event_clock": event_summary,
        "sealed_champion_trial_id": trial_id,
        "gates": gates,
        "all_holdout_gates_pass": all(gates.values()),
        "trial": summary,
    }


def validate_freeze(packet_dir: Path, freeze: JsonObject) -> None:
    if freeze.get("schema") != "s1u.freeze.v1":
        raise ValueError("invalid freeze schema")
    files = freeze.get("frozen_files")
    if not isinstance(files, dict) or set(files) != FROZEN_FILES:
        raise ValueError("freeze must bind the exact required frozen file set")
    for relative, expected in files.items():
        path = packet_dir / str(relative)
        if not path.is_file() or sha256_file(path) != expected:
            raise ValueError(f"frozen file mismatch: {relative}")


def validate_git_freeze(packet_dir: Path, freeze_commit: str, canonical_base: str) -> None:
    """Bind the invocation to the exact clean commit containing the freeze."""

    repository = packet_dir.parents[2]
    head = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=repository,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    if head != freeze_commit:
        raise ValueError(f"freeze commit is not current HEAD: {freeze_commit} != {head}")
    ancestry = subprocess.run(
        ["git", "merge-base", "--is-ancestor", canonical_base, freeze_commit],
        cwd=repository,
        check=False,
        capture_output=True,
        text=True,
    )
    if ancestry.returncode != 0:
        raise ValueError("canonical base is not an ancestor of the freeze commit")
    merges = subprocess.run(
        ["git", "rev-list", "--merges", f"{canonical_base}..{freeze_commit}"],
        cwd=repository,
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    if merges:
        raise ValueError("freeze lineage contains a merge commit")
    changed = subprocess.run(
        ["git", "diff", "--name-only", f"{canonical_base}..{freeze_commit}"],
        cwd=repository,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.splitlines()
    if any(not name.startswith("quant/research/s1u/") for name in changed):
        raise ValueError("freeze lineage escapes the exclusive S-1U scope")
    dirty = subprocess.run(
        [
            "git",
            "status",
            "--porcelain=v1",
            "--untracked-files=all",
        ],
        cwd=repository,
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    if dirty:
        raise ValueError("S-1U packet must be clean before the one-run invocation")


def write_checksums(packet_dir: Path) -> None:
    names = sorted(
        path.name for path in packet_dir.iterdir() if path.is_file() and path.name != "SHA256SUMS"
    )
    lines = [f"{sha256_file(packet_dir / name)}  {name}" for name in names]
    payload = ("\n".join(lines) + "\n").encode()
    descriptor = os.open(packet_dir / "SHA256SUMS", os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "wb") as handle:
        handle.write(payload)
        handle.flush()
        os.fsync(handle.fileno())


def development_champion_report(development: JsonObject) -> JsonObject:
    champion = development["trials"][development["champion_trial_id"]]
    return {
        "trial_id": development["champion_trial_id"],
        "net_usd_per_1000": champion["net_usd_per_1000"],
        "base_interval_95_usd_per_1000": champion["base_interval_95_usd_per_1000"],
        "base_familywise_bonferroni_lower_usd_per_1000": champion[
            "base_familywise_bonferroni_lower_usd_per_1000"
        ],
        "holm_adjusted_p": champion["holm_adjusted_p"],
        "white_reality_check_p": development["white_reality_check_p"],
        "pbo": development["pbo"],
        "max_drawdown_fraction_of_1000": champion["max_drawdown_fraction_of_1000"],
        "public_capacity_proxy_usd": champion["public_capacity_proxy_usd"],
        "active_cohorts": champion["active_cohorts"],
        "candidate_common_settlements": champion["candidate_common_settlements"],
    }


def build_result(
    protocol: JsonObject,
    run_marker: JsonObject,
    development: JsonObject,
    holdout: JsonObject | None,
) -> JsonObject:
    if not bool(development["all_development_gates_pass"]):
        verdict = protocol["verdict_law"]["development_gate_failure"]
        holdout_state = "UNOPENED_DEVELOPMENT_GATES_FAILED"
    elif holdout is None:
        verdict = protocol["verdict_law"]["measurement_failure_after_run_marker"]
        holdout_state = "UNMEASURED"
    else:
        holdout_state = "OPENED_AFTER_ALL_DEVELOPMENT_GATES_PASSED"
        verdict = (
            protocol["verdict_law"]["public_proxy_pass"]
            if bool(holdout["all_holdout_gates_pass"])
            else "NO_GO_HOLDOUT"
        )
    return {
        "schema": "s1u.result.v1",
        "strategy_id": "S-1U",
        "verdict": verdict,
        "capital_authority": protocol["verdict_law"]["capital_authority"],
        "freeze_commit": run_marker["freeze_commit"],
        "one_run_id": run_marker["one_run_id"],
        "development_champion": development_champion_report(development),
        "development_gates": development["development_gates"],
        "public_proxy_costs": protocol["costs"],
        "holdout_state": holdout_state,
        "holdout": holdout,
        "executable_limits": {
            "account_effective_fee": "UNKNOWN",
            "spread": "UNKNOWN",
            "depth": "UNKNOWN",
            "queue": "UNKNOWN",
            "fill_probability": "UNKNOWN",
            "impact": "UNKNOWN",
            "latency": "UNKNOWN",
            "executable_capacity": "UNKNOWN",
        },
        "effects": {
            "orders": 0,
            "transfers": 0,
            "withdrawals": 0,
            "private_requests": 0,
            "provider_mutations": 0,
            "host_mutations": 0,
            "ui_mutations": 0,
            "canonical_branch_mutations": 0,
        },
    }


def failure_result(
    protocol: JsonObject,
    run_marker: JsonObject,
    error: BaseException,
) -> tuple[JsonObject, JsonObject]:
    development = {
        "schema": "s1u.development.v1",
        "measurement_state": "UNMEASURED",
        "all_development_gates_pass": False,
        "terminal_error_type": type(error).__name__,
        "terminal_error": str(error),
        "trials": {},
    }
    result = {
        "schema": "s1u.result.v1",
        "strategy_id": "S-1U",
        "verdict": protocol["verdict_law"]["measurement_failure_after_run_marker"],
        "capital_authority": protocol["verdict_law"]["capital_authority"],
        "freeze_commit": run_marker["freeze_commit"],
        "one_run_id": run_marker["one_run_id"],
        "holdout_state": "UNOPENED_TERMINAL_MEASUREMENT_FAILURE",
        "public_proxy_costs": protocol["costs"],
        "terminal_error_type": type(error).__name__,
        "terminal_error": str(error),
        "executable_limits": {
            "account_effective_fee": "UNKNOWN",
            "executable_capacity": "UNKNOWN",
        },
        "effects": {
            "orders": 0,
            "transfers": 0,
            "withdrawals": 0,
            "private_requests": 0,
            "provider_mutations": 0,
            "host_mutations": 0,
            "ui_mutations": 0,
            "canonical_branch_mutations": 0,
        },
    }
    return development, result


def holdout_failure_result(
    protocol: JsonObject,
    run_marker: JsonObject,
    development: JsonObject,
    error: BaseException,
) -> JsonObject:
    return {
        "schema": "s1u.result.v1",
        "strategy_id": "S-1U",
        "verdict": protocol["verdict_law"]["measurement_failure_after_run_marker"],
        "capital_authority": protocol["verdict_law"]["capital_authority"],
        "freeze_commit": run_marker["freeze_commit"],
        "one_run_id": run_marker["one_run_id"],
        "development_champion": development_champion_report(development),
        "development_gates": development["development_gates"],
        "public_proxy_costs": protocol["costs"],
        "holdout_state": "OPENED_AFTER_DEVELOPMENT_PASS_TERMINAL_MEASUREMENT_FAILURE",
        "holdout": None,
        "terminal_error_type": type(error).__name__,
        "terminal_error": str(error),
        "executable_limits": {
            "account_effective_fee": "UNKNOWN",
            "spread": "UNKNOWN",
            "depth": "UNKNOWN",
            "queue": "UNKNOWN",
            "fill_probability": "UNKNOWN",
            "impact": "UNKNOWN",
            "latency": "UNKNOWN",
            "executable_capacity": "UNKNOWN",
        },
        "effects": {
            "orders": 0,
            "transfers": 0,
            "withdrawals": 0,
            "private_requests": 0,
            "provider_mutations": 0,
            "host_mutations": 0,
            "ui_mutations": 0,
            "canonical_branch_mutations": 0,
        },
    }


def run_once(packet_dir: Path, raw_root: Path, freeze_commit: str) -> int:
    protocol = read_json(packet_dir / "protocol.v1.json")
    freeze = read_json(packet_dir / "freeze.v1.json")
    validate_freeze(packet_dir, freeze)
    if not re.fullmatch(r"[0-9a-f]{40}", freeze_commit):
        raise ValueError("freeze commit must be an exact lowercase 40-hex Git object")
    validate_git_freeze(packet_dir, freeze_commit, str(protocol["canonical_base"]))
    if raw_root.exists() and any(raw_root.iterdir()):
        raise FileExistsError("one-run raw root must be absent or empty")
    raw_root.mkdir(parents=True, exist_ok=True)
    external_marker = raw_root / "RUN_CONSUMED.v1.json"
    run_started = datetime.now(tz=UTC).isoformat()
    one_run_id = sha256_bytes(
        canonical_bytes(
            {
                "strategy_id": "S-1U",
                "freeze_commit": freeze_commit,
                "run_started": run_started,
                "raw_root": str(raw_root.resolve()),
            }
        )
    )
    run_marker: JsonObject = {
        "schema": "s1u.run-consumed.v1",
        "strategy_id": "S-1U",
        "state": "CONSUMED_BEFORE_FIRST_SOURCE_BODY_REQUEST",
        "one_run_id": one_run_id,
        "freeze_commit": freeze_commit,
        "run_started_utc": run_started,
        "raw_root": str(raw_root.resolve()),
        "rerun_allowed": False,
    }
    atomic_create(packet_dir / "RUN_STARTED.v1.json", run_marker)
    atomic_create(external_marker, run_marker)
    manifest: list[JsonObject] = []
    development_expected: list[JsonObject] = []
    holdout_expected: list[JsonObject] = []
    development: JsonObject | None = None
    holdout_opened = False
    exit_code = 0
    try:
        symbols = [str(symbol) for symbol in protocol["universe"]["symbols"]]
        root_url = str(protocol["sources"]["root"])
        development_months = [str(month) for month in protocol["window"]["development_months"]]
        holdout_months = [str(month) for month in protocol["window"]["holdout_months"]]
        development_expected = expected_source_rows(
            root_url, symbols, development_months, "PREHISTORY_OR_DEVELOPMENT"
        )
        holdout_expected = expected_source_rows(root_url, symbols, holdout_months, "SEALED_HOLDOUT")
        acquire_rows(raw_root, development_expected, manifest)
        development_bars, development_settlements = load_market_data(
            raw_root, manifest, symbols, development_months
        )
        trials = build_trials(protocol)
        development_days, development_ledgers, development_events = evaluate_trials(
            protocol,
            development_bars,
            development_settlements,
            iso_ms(str(protocol["window"]["study_start"])),
            iso_ms(str(protocol["window"]["development_end"])),
            trials,
        )
        development = summarize_development(
            protocol, development_days, development_ledgers, development_events
        )
        holdout: JsonObject | None = None
        if bool(development["all_development_gates_pass"]):
            holdout_open_marker = {
                "schema": "s1u.holdout-open.v1",
                "one_run_id": one_run_id,
                "state": "OPEN_AUTHORIZED_BY_ALL_DEVELOPMENT_GATES",
                "champion_trial_id": development["champion_trial_id"],
                "development_sha256": sha256_bytes(canonical_bytes(development)),
            }
            atomic_create(raw_root / "HOLDOUT_OPENED.v1.json", holdout_open_marker)
            holdout_opened = True
            acquire_rows(raw_root, holdout_expected, manifest)
            holdout_load_months = [development_months[-1], *holdout_months]
            holdout_bars, holdout_settlements = load_market_data(
                raw_root, manifest, symbols, holdout_load_months
            )
            champion_summary = development["trials"][development["champion_trial_id"]]
            champion = Trial(
                lookback_minutes=int(champion_summary["lookback_minutes"]),
                horizon_minutes=int(champion_summary["horizon_minutes"]),
            )
            holdout_days, holdout_ledgers, holdout_events = evaluate_trials(
                protocol,
                holdout_bars,
                holdout_settlements,
                iso_ms(str(protocol["window"]["development_end"])),
                iso_ms(str(protocol["window"]["holdout_end"])),
                [champion],
            )
            holdout = summarize_holdout(protocol, holdout_days, holdout_ledgers, holdout_events)
        result = build_result(protocol, run_marker, development, holdout)
    except BaseException as error:
        if development is not None and holdout_opened:
            result = holdout_failure_result(protocol, run_marker, development, error)
        else:
            development, result = failure_result(protocol, run_marker, error)
        exit_code = 2
        for row in manifest:
            if row["state"] == "VERIFIED_BODY_PRESENT" and row.get("zip_opened") is not True:
                row["state"] = "VERIFIED_BODY_PRESENT_UNMEASURED"
    present_keys = {
        (str(row["dataset"]), str(row["symbol"]), str(row["month"])) for row in manifest
    }
    for expected in [*development_expected, *holdout_expected]:
        key = (
            str(expected["dataset"]),
            str(expected["symbol"]),
            str(expected["month"]),
        )
        if key in present_keys:
            continue
        missing = dict(expected)
        if expected["phase"] == "PREHISTORY_OR_DEVELOPMENT" or holdout_opened:
            missing["state"] = "NOT_ACQUIRED_TERMINAL_FAILURE"
        manifest.append(missing)
    source_manifest = {
        "schema": "s1u.source-manifest.v1",
        "publisher": "Binance",
        "public_only": True,
        "one_run_id": one_run_id,
        "objects": sorted(
            manifest,
            key=lambda row: (str(row["month"]), str(row["symbol"]), str(row["dataset"])),
        ),
    }
    tracked_marker = dict(run_marker)
    tracked_marker["terminal_verdict"] = result["verdict"]
    tracked_marker["holdout_state"] = result["holdout_state"]
    atomic_create(packet_dir / "source_manifest.v1.json", source_manifest)
    atomic_create(packet_dir / "RUN_CONSUMED.v1.json", tracked_marker)
    atomic_create(packet_dir / "development.v1.json", development)
    atomic_create(packet_dir / "result.v1.json", result)
    write_checksums(packet_dir)
    return exit_code


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--raw-root", type=Path, required=True)
    result.add_argument("--freeze-commit", required=True)
    return result


def main(argv: Sequence[str] | None = None) -> int:
    arguments = parser().parse_args(argv)
    packet_dir = Path(__file__).resolve().parent
    outputs = (
        "RUN_STARTED.v1.json",
        "source_manifest.v1.json",
        "RUN_CONSUMED.v1.json",
        "development.v1.json",
        "result.v1.json",
        "SHA256SUMS",
    )
    if any((packet_dir / name).exists() for name in outputs):
        raise SystemExit("sealed packet outputs already exist; rerun refused")
    return run_once(packet_dir, arguments.raw_root.resolve(), arguments.freeze_commit)


if __name__ == "__main__":
    sys.exit(main())
