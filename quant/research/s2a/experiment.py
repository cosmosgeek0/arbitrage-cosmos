#!/usr/bin/env python3
"""One-run public Binance USD-M S-2A evaluator.

Importing this module is network-free and mutation-free. Only ``main`` acquires
official archive bytes or creates custody/result artifacts.
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
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from functools import partial
from pathlib import Path
from typing import Any, Final

JsonObject = dict[str, Any]

HOUR_MS: Final = 3_600_000
DAY_MS: Final = 86_400_000
HEX_64: Final = re.compile(r"^[0-9a-fA-F]{64}$")
GIT_SHA_40: Final = re.compile(r"^[0-9a-f]{40}$")
SOURCE_DATASETS: Final = ("klines", "markPriceKlines", "fundingRate")
FROZEN_FILES: Final = frozenset(
    {
        "README.md",
        "OFFICIAL_SOURCE_RESEARCH.md",
        "DISTINCTNESS.md",
        "__init__.py",
        "protocol.v1.json",
        "experiment.py",
        "verifier.py",
        "test_experiment.py",
        "test_verifier.py",
    }
)


@dataclass(frozen=True, slots=True)
class Bar:
    """The S-2A fields admitted from one official hourly kline."""

    open_ms: int
    close_ms: int
    open_price: float
    close_price: float
    quote_volume: float


@dataclass(frozen=True, slots=True)
class MarkBar:
    """One hourly public mark-price proxy bar."""

    open_ms: int
    close_ms: int
    open_price: float


@dataclass(frozen=True, slots=True)
class Funding:
    """One observed public funding cash-flow row."""

    timestamp_ms: int
    rate: float
    interval_hours: int = 8
    source_offset_ms: int = 0


@dataclass(frozen=True, slots=True)
class Trial:
    """One member of the frozen 12-trial family."""

    z_threshold: float
    volume_threshold: float
    hold_hours: int

    @property
    def trial_id(self) -> str:
        z_code = round(self.z_threshold * 100)
        volume_code = round(self.volume_threshold * 100)
        return f"Z{z_code:03d}_V{volume_code:03d}_H{self.hold_hours:02d}"


@dataclass(frozen=True, slots=True)
class CostScenario:
    """Fee and adverse-execution proxy charged at each fill."""

    name: str
    fee_rate: float
    adverse_rate: float

    @property
    def combined_rate(self) -> float:
        return self.fee_rate + self.adverse_rate


@dataclass(frozen=True, slots=True)
class SignalSnapshot:
    """Causal factor residual and lagged-volume facts for one signal hour."""

    betas: dict[str, float]
    z_scores: dict[str, float]
    volume_ratios: dict[str, float]


@dataclass(frozen=True, slots=True)
class Selection:
    """Symmetric idiosyncratic tails plus their factor-neutral weights."""

    long_symbol: str
    short_symbol: str
    weights: dict[str, float]


@dataclass(slots=True)
class TrialLedger:
    """Complete development or holdout ledger for one frozen trial."""

    trial: Trial
    candidate_hours: int
    active_round_trips: int
    cash_reasons: Counter[str]
    daily: dict[str, list[float]]
    active_weeks: set[str]
    long_counts: Counter[str]
    short_counts: Counter[str]
    capacity_usd: list[float]
    btc_weights: list[float]


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

    atomic_write_bytes(path, canonical_bytes(value))


def atomic_write_bytes(path: Path, payload: bytes) -> None:
    """Persist one fresh custody object without overwrite or partial state."""

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
        directory_descriptor = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory_descriptor)
        finally:
            os.close(directory_descriptor)
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise


def parse_utc_ms(value: str | int | float) -> int:
    """Parse official millisecond/microsecond timestamps or UTC text."""

    text = str(value).strip()
    if isinstance(value, (int, float)) or re.fullmatch(r"-?\d+(?:\.0+)?", text):
        if isinstance(value, float):
            if not math.isfinite(value) or not value.is_integer():
                raise ValueError(f"invalid numeric timestamp: {value!r}")
            number = int(value)
        else:
            number = int(text.split(".", 1)[0])
        magnitude = abs(number)
        if magnitude >= 100_000_000_000_000_000:
            return number // 1_000_000
        if magnitude >= 100_000_000_000_000:
            return number // 1_000
        return number
    normalized = text.replace(" ", "T")
    if normalized.endswith("Z"):
        normalized = f"{normalized[:-1]}+00:00"
    parsed = datetime.fromisoformat(normalized)
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


def month_bounds(month: str) -> tuple[int, int]:
    start = datetime.strptime(month, "%Y-%m").replace(tzinfo=UTC)
    year = start.year + (1 if start.month == 12 else 0)
    next_month = 1 if start.month == 12 else start.month + 1
    end = start.replace(year=year, month=next_month)
    return int(start.timestamp() * 1000), int(end.timestamp() * 1000)


def median(values: Sequence[float]) -> float:
    if not values:
        raise ValueError("median requires at least one value")
    return statistics.median(values)


def log_returns(bars: Sequence[Bar]) -> list[float | None]:
    """Align close-to-close log returns to the ending bar index."""

    returns: list[float | None] = [None]
    for previous, current in itertools.pairwise(bars):
        if previous.close_price <= 0 or current.close_price <= 0:
            raise ValueError("close prices must be positive")
        value = math.log(current.close_price / previous.close_price)
        if not math.isfinite(value):
            raise ValueError("return must be finite")
        returns.append(value)
    return returns


def ols_residual_z(
    contract_returns: Sequence[float | None],
    factor_returns: Sequence[float | None],
    signal_index: int,
    lookback: int,
    minimum_scale: float,
) -> tuple[float, float] | None:
    """Return causal beta and standardized current residual."""

    start = signal_index - lookback
    if start < 1 or signal_index >= len(contract_returns):
        return None
    xs = factor_returns[start:signal_index]
    ys = contract_returns[start:signal_index]
    if len(xs) != lookback or len(ys) != lookback:
        return None
    if any(value is None for value in xs) or any(value is None for value in ys):
        return None
    x_values = [float(value) for value in xs if value is not None]
    y_values = [float(value) for value in ys if value is not None]
    x_mean = statistics.fmean(x_values)
    y_mean = statistics.fmean(y_values)
    denominator = math.fsum((value - x_mean) ** 2 for value in x_values)
    if not math.isfinite(denominator) or denominator <= minimum_scale:
        return None
    beta = (
        math.fsum(
            (x_value - x_mean) * (y_value - y_mean)
            for x_value, y_value in zip(x_values, y_values, strict=True)
        )
        / denominator
    )
    alpha = y_mean - beta * x_mean
    residuals = [
        y_value - (alpha + beta * x_value)
        for x_value, y_value in zip(x_values, y_values, strict=True)
    ]
    scale = statistics.stdev(residuals)
    current_x = factor_returns[signal_index]
    current_y = contract_returns[signal_index]
    if (
        current_x is None
        or current_y is None
        or not math.isfinite(beta)
        or not math.isfinite(scale)
        or scale <= minimum_scale
    ):
        return None
    residual = float(current_y) - (alpha + beta * float(current_x))
    z_score = residual / scale
    if not math.isfinite(z_score):
        return None
    return beta, z_score


def lagged_volume_ratio(
    bars: Sequence[Bar], signal_index: int, baseline_hours: int
) -> float | None:
    """Use confirmation t-1 against the earlier window ending at t-2."""

    confirmation_index = signal_index - 1
    baseline_start = confirmation_index - baseline_hours
    if baseline_start < 0 or confirmation_index >= len(bars):
        return None
    baseline = [bar.quote_volume for bar in bars[baseline_start:confirmation_index]]
    if len(baseline) != baseline_hours or any(value <= 0 for value in baseline):
        return None
    reference = median(baseline)
    confirmation = bars[confirmation_index].quote_volume
    if reference <= 0 or confirmation <= 0:
        return None
    ratio = confirmation / reference
    return ratio if math.isfinite(ratio) else None


def signal_snapshot(
    bars: Mapping[str, Sequence[Bar]],
    returns: Mapping[str, Sequence[float | None]],
    factor_symbol: str,
    idiosyncratic_symbols: Sequence[str],
    signal_index: int,
    fit_hours: int,
    baseline_hours: int,
    minimum_scale: float,
) -> SignalSnapshot | None:
    """Construct one all-member causal signal cut."""

    betas: dict[str, float] = {}
    z_scores: dict[str, float] = {}
    volume_ratios: dict[str, float] = {}
    factor_returns = returns[factor_symbol]
    for symbol in idiosyncratic_symbols:
        fit = ols_residual_z(
            returns[symbol],
            factor_returns,
            signal_index,
            fit_hours,
            minimum_scale,
        )
        ratio = lagged_volume_ratio(bars[symbol], signal_index, baseline_hours)
        if fit is None or ratio is None:
            return None
        beta, z_score = fit
        betas[symbol] = beta
        z_scores[symbol] = z_score
        volume_ratios[symbol] = ratio
    return SignalSnapshot(betas=betas, z_scores=z_scores, volume_ratios=volume_ratios)


def factor_neutral_weights(
    long_symbol: str,
    short_symbol: str,
    factor_symbol: str,
    betas: Mapping[str, float],
    maximum_btc_weight: float,
    maximum_member_weight: float,
    maximum_net_notional: float,
) -> dict[str, float] | None:
    """Hedge the raw equal-dollar idiosyncratic pair with BTC."""

    raw_long = 0.5
    raw_short = -0.5
    raw_btc = -(raw_long * betas[long_symbol] + raw_short * betas[short_symbol])
    gross = abs(raw_long) + abs(raw_short) + abs(raw_btc)
    if not math.isfinite(gross) or gross <= 0:
        return None
    weights = {
        long_symbol: raw_long / gross,
        short_symbol: raw_short / gross,
        factor_symbol: raw_btc / gross,
    }
    if (
        weights[long_symbol] <= 0
        or weights[short_symbol] >= 0
        or abs(weights[factor_symbol]) > maximum_btc_weight
        or abs(weights[long_symbol]) > maximum_member_weight
        or abs(weights[short_symbol]) > maximum_member_weight
        or abs(math.fsum(weights.values())) > maximum_net_notional
    ):
        return None
    beta_exposure = (
        weights[long_symbol] * betas[long_symbol]
        + weights[short_symbol] * betas[short_symbol]
        + weights[factor_symbol]
    )
    if not math.isclose(beta_exposure, 0.0, abs_tol=1e-12):
        return None
    if not math.isclose(math.fsum(abs(value) for value in weights.values()), 1.0):
        return None
    return weights


def select_tails(
    snapshot: SignalSnapshot,
    factor_symbol: str,
    z_threshold: float,
    volume_threshold: float,
    maximum_btc_weight: float,
    maximum_member_weight: float,
    maximum_net_notional: float,
) -> Selection | None:
    """Select strict qualifying residual tails without boundary tie mining."""

    negative = sorted(
        (
            (snapshot.z_scores[symbol], symbol)
            for symbol in snapshot.z_scores
            if snapshot.z_scores[symbol] <= -z_threshold
            and snapshot.volume_ratios[symbol] >= volume_threshold
        ),
        key=lambda item: (item[0], item[1]),
    )
    positive = sorted(
        (
            (snapshot.z_scores[symbol], symbol)
            for symbol in snapshot.z_scores
            if snapshot.z_scores[symbol] >= z_threshold
            and snapshot.volume_ratios[symbol] >= volume_threshold
        ),
        key=lambda item: (-item[0], item[1]),
    )
    if not negative or not positive:
        return None
    if len(negative) > 1 and negative[0][0] == negative[1][0]:
        return None
    if len(positive) > 1 and positive[0][0] == positive[1][0]:
        return None
    long_symbol = negative[0][1]
    short_symbol = positive[0][1]
    if long_symbol == short_symbol:
        return None
    weights = factor_neutral_weights(
        long_symbol,
        short_symbol,
        factor_symbol,
        snapshot.betas,
        maximum_btc_weight,
        maximum_member_weight,
        maximum_net_notional,
    )
    if weights is None:
        return None
    return Selection(long_symbol=long_symbol, short_symbol=short_symbol, weights=weights)


def funding_cashflow(
    events: Sequence[Funding],
    mark_prices: Mapping[int, float],
    weight: float,
    capital_usd: float,
    entry_price: float,
    entry_ms: int,
    exit_ms: int,
) -> float:
    """Apply public rates to fixed quantity using the hourly mark-open proxy."""

    if entry_price <= 0:
        raise ValueError("funding entry price must be positive")
    times = [event.timestamp_ms for event in events]
    start = bisect.bisect_right(times, entry_ms)
    end = bisect.bisect_right(times, exit_ms)
    cashflows: list[float] = []
    for index in range(start, end):
        event = events[index]
        mark_price = mark_prices.get(event.timestamp_ms)
        if mark_price is None or mark_price <= 0 or not math.isfinite(mark_price):
            raise ValueError("funding timestamp lacks a valid hourly mark-price open")
        cashflows.append(-weight * capital_usd * (mark_price / entry_price) * event.rate)
    return math.fsum(cashflows)


def cohort_pnl(
    selection: Selection,
    entry_prices: Mapping[str, float],
    exit_prices: Mapping[str, float],
    funding: Mapping[str, Sequence[Funding]],
    mark_prices: Mapping[str, Mapping[int, float]],
    entry_ms: int,
    exit_ms: int,
    capital_usd: float,
    scenarios: Sequence[CostScenario],
) -> dict[str, float]:
    """Compute linear-contract price, observed funding, and cost PnL."""

    price_pnl = 0.0
    funding_pnl = 0.0
    charged_notional = 0.0
    for symbol, weight in selection.weights.items():
        entry = entry_prices[symbol]
        exit_price = exit_prices[symbol]
        if entry <= 0 or exit_price <= 0:
            raise ValueError("entry and exit prices must be positive")
        ratio = exit_price / entry
        price_pnl += weight * capital_usd * (ratio - 1.0)
        funding_pnl += funding_cashflow(
            funding[symbol],
            mark_prices[symbol],
            weight,
            capital_usd,
            entry,
            entry_ms,
            exit_ms,
        )
        charged_notional += abs(weight) * capital_usd * (1.0 + ratio)
    gross = price_pnl + funding_pnl
    return {
        scenario.name: gross - charged_notional * scenario.combined_rate for scenario in scenarios
    }


def capacity_proxy_usd(
    selection: Selection,
    confirmation_quote_volume: Mapping[str, float],
    participation_rate: float,
) -> float:
    values = [
        participation_rate * confirmation_quote_volume[symbol] / abs(weight)
        for symbol, weight in selection.weights.items()
        if weight != 0
    ]
    if not values or any(not math.isfinite(value) or value <= 0 for value in values):
        raise ValueError("capacity inputs must be positive and finite")
    return min(values)


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


def holm_adjust(raw: Mapping[str, float]) -> dict[str, float]:
    ordered = sorted(raw.items(), key=lambda item: (item[1], item[0]))
    adjusted: dict[str, float] = {}
    running = 0.0
    for rank, (trial_id, value) in enumerate(ordered):
        running = max(running, min(1.0, (len(ordered) - rank) * value))
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
    if count <= 0 or length < count or count % 2:
        raise ValueError("CSCV needs an even block count and sufficient observations")
    return [
        list(range((block * length) // count, ((block + 1) * length) // count))
        for block in range(count)
    ]


def cscv_pbo(series_by_trial: Mapping[str, Sequence[float]], block_count: int) -> JsonObject:
    """Compute deterministic CSCV rank degradation as a diagnostic."""

    trial_ids = sorted(series_by_trial)
    if not trial_ids:
        raise ValueError("PBO requires trials")
    lengths = {len(series_by_trial[trial_id]) for trial_id in trial_ids}
    if len(lengths) != 1:
        raise ValueError("PBO trial calendars must be equal")
    length = lengths.pop()
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
        champion = min(trial_ids, key=lambda trial_id: (-train_totals[trial_id], trial_id))
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
        "role": "DIAGNOSTIC_ONLY",
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
    tokens = text.strip().split()
    if len(tokens) != 2 or not HEX_64.fullmatch(tokens[0]):
        raise ValueError("invalid official checksum sidecar")
    if tokens[1].lstrip("*") != expected_name:
        raise ValueError("official checksum filename mismatch")
    return tokens[0].lower()


def request_bytes(url: str, attempts: int = 3) -> tuple[bytes, JsonObject]:
    """Fetch one public object with bounded retries inside the consumed run."""

    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        request = urllib.request.Request(
            url,
            headers={"User-Agent": "cosmos-s2a-public-research/1.0"},
            method="GET",
        )
        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                payload = response.read()
                status = int(response.status)
                if status != 200 or not payload:
                    raise ValueError(f"public object returned status={status} or empty body")
                return payload, {
                    "http_status": status,
                    "content_length": len(payload),
                    "attempt": attempt,
                    "etag": response.headers.get("ETag"),
                    "last_modified": response.headers.get("Last-Modified"),
                }
        except (OSError, TimeoutError, urllib.error.URLError, ValueError) as error:
            last_error = error
    raise RuntimeError(
        f"public source acquisition failed after {attempts} attempts"
    ) from last_error


def archive_relative_path(dataset: str, symbol: str, month: str) -> str:
    if dataset == "klines":
        return f"klines/{symbol}/1h/{symbol}-1h-{month}.zip"
    if dataset == "markPriceKlines":
        return f"markPriceKlines/{symbol}/1h/{symbol}-1h-{month}.zip"
    if dataset == "fundingRate":
        return f"fundingRate/{symbol}/{symbol}-fundingRate-{month}.zip"
    raise ValueError(f"unsupported dataset {dataset}")


def expected_source_rows(
    root_url: str, symbols: Sequence[str], months: Sequence[str], phase: str
) -> list[JsonObject]:
    rows: list[JsonObject] = []
    for symbol in symbols:
        for month in months:
            for dataset in SOURCE_DATASETS:
                relative = archive_relative_path(dataset, symbol, month)
                rows.append(
                    {
                        "dataset": dataset,
                        "symbol": symbol,
                        "month": month,
                        "phase": phase,
                        "relative_path": relative,
                        "zip_url": f"{root_url}/{relative}",
                        "checksum_url": f"{root_url}/{relative}.CHECKSUM",
                        "status": "EXPECTED",
                    }
                )
    return rows


def acquire_rows(
    raw_root: Path,
    rows: Sequence[JsonObject],
    manifest: list[JsonObject],
    attempts: int,
) -> None:
    for expected in rows:
        relative = str(expected["relative_path"])
        zip_name = Path(relative).name
        zip_path = raw_root / "archives" / relative
        checksum_path = zip_path.with_name(f"{zip_path.name}.CHECKSUM")
        declared_sha256: str | None = None
        received_sha256: str | None = None
        checksum_payload: bytes | None = None
        zip_payload: bytes | None = None
        checksum_http: JsonObject | None = None
        zip_http: JsonObject | None = None
        try:
            checksum_payload, checksum_http = request_bytes(
                str(expected["checksum_url"]),
                attempts,
            )
            checksum_text = checksum_payload.decode("utf-8", errors="strict")
            declared_sha256 = parse_checksum(checksum_text, zip_name)
            zip_payload, zip_http = request_bytes(str(expected["zip_url"]), attempts)
            received_sha256 = sha256_bytes(zip_payload)
            if received_sha256 != declared_sha256:
                raise ValueError(f"official checksum mismatch for {relative}")
            atomic_write_bytes(checksum_path, checksum_payload)
            atomic_write_bytes(zip_path, zip_payload)
        except BaseException:
            if zip_path.exists() or checksum_path.exists():
                manifest.append(
                    {
                        **expected,
                        "status": "PARTIAL_CUSTODY_TERMINAL_FAILURE",
                        "declared_zip_sha256": declared_sha256,
                        "received_zip_sha256": (
                            sha256_file(zip_path) if zip_path.is_file() else None
                        ),
                        "checksum_sha256": (
                            sha256_file(checksum_path) if checksum_path.is_file() else None
                        ),
                        "zip_bytes": (zip_path.stat().st_size if zip_path.is_file() else None),
                        "checksum_bytes": (
                            checksum_path.stat().st_size if checksum_path.is_file() else None
                        ),
                        "zip_http": zip_http,
                        "checksum_http": checksum_http,
                        "local_relative_path": str(zip_path.relative_to(raw_root)),
                        "csv_member": None,
                        "member_opened": False,
                    }
                )
            raise
        if (
            checksum_payload is None
            or zip_payload is None
            or checksum_http is None
            or zip_http is None
            or declared_sha256 is None
            or received_sha256 is None
        ):
            raise AssertionError("completed acquisition lacks frozen evidence")
        manifest.append(
            {
                **expected,
                "status": "ACQUIRED_CHECKSUM_VERIFIED",
                "declared_zip_sha256": declared_sha256,
                "received_zip_sha256": received_sha256,
                "checksum_sha256": sha256_bytes(checksum_payload),
                "zip_bytes": len(zip_payload),
                "checksum_bytes": len(checksum_payload),
                "zip_http": zip_http,
                "checksum_http": checksum_http,
                "local_relative_path": str(zip_path.relative_to(raw_root)),
            }
        )


def safe_csv_member(
    path: Path,
    on_member_opened: Callable[[str], None] | None = None,
) -> tuple[str, bytes]:
    with zipfile.ZipFile(path) as archive:
        members = [
            item
            for item in archive.infolist()
            if not item.is_dir() and item.filename.lower().endswith(".csv")
        ]
        if len(members) != 1:
            raise ValueError(f"{path} must contain exactly one CSV member")
        member = members[0]
        if Path(member.filename).name != member.filename:
            raise ValueError(f"{path} CSV member must be a basename")
        if member.file_size > 64 * 1024 * 1024:
            raise ValueError(f"{path} CSV member exceeds the frozen bound")
        if on_member_opened is not None:
            on_member_opened(member.filename)
        return member.filename, archive.read(member)


def csv_rows(payload: bytes) -> list[list[str]]:
    text = payload.decode("utf-8", errors="strict")
    return [row for row in csv.reader(io.StringIO(text)) if row]


def parse_kline_zip(
    path: Path,
    month: str,
    on_member_opened: Callable[[str], None] | None = None,
) -> tuple[str, list[Bar]]:
    member, payload = safe_csv_member(path, on_member_opened)
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
    if not rows or [cell.strip().lower() for cell in rows[0]] != expected_header:
        raise ValueError(f"unexpected frozen kline schema in {path}")
    start_ms, end_ms = month_bounds(month)
    expected_count = (end_ms - start_ms) // HOUR_MS
    bars: list[Bar] = []
    for offset, row in enumerate(rows[1:]):
        if len(row) != 12:
            raise ValueError(f"unexpected kline column count in {path}")
        open_ms = parse_utc_ms(row[0])
        close_ms = parse_utc_ms(row[6])
        expected_open = start_ms + offset * HOUR_MS
        if open_ms != expected_open or close_ms != open_ms + HOUR_MS - 1:
            raise ValueError(f"invalid hourly kline boundary in {path}")
        open_price = float(row[1])
        high = float(row[2])
        low = float(row[3])
        close_price = float(row[4])
        base_volume = float(row[5])
        quote_volume = float(row[7])
        count = int(row[8])
        taker_base = float(row[9])
        taker_quote = float(row[10])
        numerics = [
            open_price,
            high,
            low,
            close_price,
            base_volume,
            quote_volume,
            taker_base,
            taker_quote,
        ]
        if (
            any(not math.isfinite(value) for value in numerics)
            or min(open_price, high, low, close_price) <= 0
            or high < max(open_price, close_price, low)
            or low > min(open_price, close_price, high)
            or base_volume < 0
            or quote_volume <= 0
            or count < 0
            or taker_base < 0
            or taker_quote < 0
            or taker_base > base_volume + 1e-9
            or taker_quote > quote_volume + 1e-6
        ):
            raise ValueError(f"invalid kline numeric semantics in {path}")
        bars.append(
            Bar(
                open_ms=open_ms,
                close_ms=close_ms,
                open_price=open_price,
                close_price=close_price,
                quote_volume=quote_volume,
            )
        )
    if len(bars) != expected_count or (bars and bars[-1].open_ms != end_ms - HOUR_MS):
        raise ValueError(f"incomplete hourly month in {path}")
    return member, bars


def parse_mark_price_zip(
    path: Path,
    month: str,
    on_member_opened: Callable[[str], None] | None = None,
) -> tuple[str, list[MarkBar]]:
    """Parse hourly mark prices while treating non-price tuple slots as ignored."""

    member, payload = safe_csv_member(path, on_member_opened)
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
    if not rows or [cell.strip().lower() for cell in rows[0]] != expected_header:
        raise ValueError(f"unexpected frozen mark-price schema in {path}")
    start_ms, end_ms = month_bounds(month)
    expected_count = (end_ms - start_ms) // HOUR_MS
    bars: list[MarkBar] = []
    for offset, row in enumerate(rows[1:]):
        if len(row) != 12:
            raise ValueError(f"unexpected mark-price column count in {path}")
        open_ms = parse_utc_ms(row[0])
        close_ms = parse_utc_ms(row[6])
        expected_open = start_ms + offset * HOUR_MS
        open_price = float(row[1])
        high = float(row[2])
        low = float(row[3])
        close_price = float(row[4])
        if (
            open_ms != expected_open
            or close_ms != open_ms + HOUR_MS - 1
            or any(not math.isfinite(value) for value in (open_price, high, low, close_price))
            or min(open_price, high, low, close_price) <= 0
            or high < max(open_price, close_price, low)
            or low > min(open_price, close_price, high)
        ):
            raise ValueError(f"invalid hourly mark-price row in {path}")
        bars.append(
            MarkBar(
                open_ms=open_ms,
                close_ms=close_ms,
                open_price=open_price,
            )
        )
    if len(bars) != expected_count or (bars and bars[-1].open_ms != end_ms - HOUR_MS):
        raise ValueError(f"incomplete hourly mark-price month in {path}")
    return member, bars


def parse_funding_zip(
    path: Path,
    month: str,
    on_member_opened: Callable[[str], None] | None = None,
) -> tuple[str, list[Funding]]:
    member, payload = safe_csv_member(path, on_member_opened)
    rows = csv_rows(payload)
    expected_header = ["calc_time", "funding_interval_hours", "last_funding_rate"]
    if not rows or [cell.strip().lower() for cell in rows[0]] != expected_header:
        raise ValueError(f"unexpected frozen funding schema in {path}")
    start_ms, end_ms = month_bounds(month)
    events: list[Funding] = []
    previous = -1
    for row in rows[1:]:
        if len(row) != 3:
            raise ValueError(f"unexpected funding column count in {path}")
        source_timestamp_ms = parse_utc_ms(row[0])
        timestamp_ms = ((source_timestamp_ms + HOUR_MS // 2) // HOUR_MS) * HOUR_MS
        source_offset_ms = source_timestamp_ms - timestamp_ms
        interval_hours = int(row[1])
        rate = float(row[2])
        if (
            timestamp_ms < start_ms
            or timestamp_ms >= end_ms
            or timestamp_ms <= previous
            or abs(source_offset_ms) > 1000
            or interval_hours < 1
            or interval_hours > 24
            or not math.isfinite(rate)
            or abs(rate) > 0.05
        ):
            raise ValueError(f"invalid funding row in {path}")
        events.append(
            Funding(
                timestamp_ms=timestamp_ms,
                rate=rate,
                interval_hours=interval_hours,
                source_offset_ms=source_offset_ms,
            )
        )
        previous = timestamp_ms
    if not events:
        raise ValueError(f"funding month is empty in {path}")
    return member, events


def validate_funding_grid(
    events: Sequence[Funding],
    start_ms: int,
    end_ms: int,
) -> None:
    """Reject missing canonical settlements, including partition boundaries."""

    if not events or events[0].timestamp_ms != start_ms:
        raise ValueError("funding history does not begin at the frozen boundary")
    intervals = {event.interval_hours for event in events}
    if len(intervals) != 1:
        raise ValueError("funding interval transition is ambiguous under the frozen archive")
    interval_ms = next(iter(intervals)) * HOUR_MS
    for previous, current in itertools.pairwise(events):
        gap = current.timestamp_ms - previous.timestamp_ms
        if gap != interval_ms:
            raise ValueError("funding history has a missing or irregular settlement")
    if events[-1].timestamp_ms + interval_ms < end_ms:
        raise ValueError("funding history does not cover the frozen end boundary")


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
        and row["status"] == "ACQUIRED_CHECKSUM_VERIFIED"
    ]
    if len(matches) != 1:
        raise ValueError(f"source manifest lookup is not unique for {dataset}/{symbol}/{month}")
    return raw_root / str(matches[0]["local_relative_path"])


def load_market_data(
    raw_root: Path,
    manifest: list[JsonObject],
    symbols: Sequence[str],
    months: Sequence[str],
) -> tuple[
    dict[str, list[Bar]],
    dict[str, list[Funding]],
    dict[str, dict[int, float]],
]:
    """Open only acquired compressed members and bind their member names."""

    bars: dict[str, list[Bar]] = {}
    funding: dict[str, list[Funding]] = {}
    mark_prices: dict[str, dict[int, float]] = {}

    def mark_opened(dataset: str, symbol: str, month: str, member: str) -> None:
        matches = [
            row
            for row in manifest
            if row["dataset"] == dataset
            and row["symbol"] == symbol
            and row["month"] == month
            and row["status"] == "ACQUIRED_CHECKSUM_VERIFIED"
        ]
        if len(matches) != 1:
            raise ValueError(f"cannot bind opened member for {dataset}/{symbol}/{month}")
        matches[0]["csv_member"] = member
        matches[0]["member_opened"] = True

    for symbol in symbols:
        symbol_bars: list[Bar] = []
        symbol_mark_bars: list[MarkBar] = []
        symbol_funding: list[Funding] = []
        for month in months:
            kline_path = source_path(raw_root, manifest, "klines", symbol, month)
            mark_path = source_path(
                raw_root,
                manifest,
                "markPriceKlines",
                symbol,
                month,
            )
            funding_path = source_path(raw_root, manifest, "fundingRate", symbol, month)
            _, month_bars = parse_kline_zip(
                kline_path,
                month,
                partial(mark_opened, "klines", symbol, month),
            )
            _, month_mark_bars = parse_mark_price_zip(
                mark_path,
                month,
                partial(mark_opened, "markPriceKlines", symbol, month),
            )
            _, month_funding = parse_funding_zip(
                funding_path,
                month,
                partial(mark_opened, "fundingRate", symbol, month),
            )
            symbol_bars.extend(month_bars)
            symbol_mark_bars.extend(month_mark_bars)
            symbol_funding.extend(month_funding)
        if any(
            current.open_ms != previous.open_ms + HOUR_MS
            for previous, current in itertools.pairwise(symbol_bars)
        ):
            raise ValueError(f"nonconsecutive combined kline grid for {symbol}")
        if any(
            current.timestamp_ms <= previous.timestamp_ms
            for previous, current in itertools.pairwise(symbol_funding)
        ):
            raise ValueError(f"non-increasing combined funding grid for {symbol}")
        combined_start, _ = month_bounds(months[0])
        _, combined_end = month_bounds(months[-1])
        validate_funding_grid(symbol_funding, combined_start, combined_end)
        if [bar.open_ms for bar in symbol_mark_bars] != [bar.open_ms for bar in symbol_bars]:
            raise ValueError(f"trade and mark-price hourly grids differ for {symbol}")
        bars[symbol] = symbol_bars
        funding[symbol] = symbol_funding
        mark_prices[symbol] = {bar.open_ms: bar.open_price for bar in symbol_mark_bars}
    reference_grid = [bar.open_ms for bar in bars[symbols[0]]]
    for symbol in symbols[1:]:
        if [bar.open_ms for bar in bars[symbol]] != reference_grid:
            raise ValueError(f"cross-symbol hourly grids differ for {symbol}")
    return bars, funding, mark_prices


def build_scenarios(protocol: JsonObject) -> list[CostScenario]:
    scenarios: list[CostScenario] = []
    for name, values in protocol["costs"]["scenarios"].items():
        scenarios.append(
            CostScenario(
                name=str(name),
                fee_rate=float(values["public_fee_bp_per_fill"]) / 10_000.0,
                adverse_rate=float(values["adverse_execution_bp_per_fill"]) / 10_000.0,
            )
        )
    return scenarios


def build_trials(protocol: JsonObject) -> list[Trial]:
    return [
        Trial(float(z_threshold), float(volume_threshold), int(hold_hours))
        for z_threshold, volume_threshold, hold_hours in itertools.product(
            protocol["signal"]["absolute_residual_z_thresholds"],
            protocol["volume_confirmation"]["thresholds"],
            protocol["response"]["hold_hours"],
        )
    ]


def new_ledger(trial: Trial, days: Sequence[str], scenarios: Sequence[CostScenario]) -> TrialLedger:
    return TrialLedger(
        trial=trial,
        candidate_hours=0,
        active_round_trips=0,
        cash_reasons=Counter(),
        daily={scenario.name: [0.0 for _ in days] for scenario in scenarios},
        active_weeks=set(),
        long_counts=Counter(),
        short_counts=Counter(),
        capacity_usd=[],
        btc_weights=[],
    )


def evaluate_trials(
    protocol: JsonObject,
    bars: Mapping[str, Sequence[Bar]],
    funding: Mapping[str, Sequence[Funding]],
    mark_prices: Mapping[str, Mapping[int, float]],
    start_ms: int,
    end_ms: int,
    trials: Sequence[Trial],
) -> tuple[list[str], dict[str, TrialLedger], JsonObject]:
    """Evaluate the frozen causal trials on one half-open partition."""

    factor_symbol = str(protocol["universe"]["factor_symbol"])
    idiosyncratic_symbols = [
        str(symbol) for symbol in protocol["universe"]["idiosyncratic_symbols"]
    ]
    symbols = [factor_symbol, *idiosyncratic_symbols]
    scenarios = build_scenarios(protocol)
    days = calendar_days(start_ms, end_ms)
    day_index = {day: index for index, day in enumerate(days)}
    ledgers = {trial.trial_id: new_ledger(trial, days, scenarios) for trial in trials}
    reference = bars[factor_symbol]
    open_to_index = {bar.open_ms: index for index, bar in enumerate(reference)}
    if start_ms not in open_to_index or end_ms - HOUR_MS not in open_to_index:
        raise ValueError("evaluation partition is not present on the hourly grid")
    returns = {symbol: log_returns(bars[symbol]) for symbol in symbols}
    residual = protocol["residualization"]
    allocation = protocol["allocation"]
    capacity = protocol["capacity"]
    fit_hours = int(residual["fit_rows"])
    baseline_hours = int(protocol["clock"]["volume_baseline_hours"])
    minimum_scale = float(residual["minimum_scale"])
    start_index = open_to_index[start_ms]
    end_index = open_to_index[end_ms - HOUR_MS] + 1
    earliest_index = max(start_index, fit_hours + 1, baseline_hours + 1)
    next_allowed = {trial.trial_id: start_ms for trial in trials}
    signal_hours = 0
    complete_signal_hours = 0
    first_signal_ms: int | None = None
    last_signal_ms: int | None = None

    for signal_index in range(earliest_index, end_index):
        signal_open_ms = reference[signal_index].open_ms
        entry_ms = signal_open_ms + HOUR_MS
        if entry_ms >= end_ms:
            continue
        signal_hours += 1
        first_signal_ms = signal_open_ms if first_signal_ms is None else first_signal_ms
        last_signal_ms = signal_open_ms
        snapshot = signal_snapshot(
            bars,
            returns,
            factor_symbol,
            idiosyncratic_symbols,
            signal_index,
            fit_hours,
            baseline_hours,
            minimum_scale,
        )
        if snapshot is not None:
            complete_signal_hours += 1
        for trial in trials:
            ledger = ledgers[trial.trial_id]
            ledger.candidate_hours += 1
            if entry_ms < next_allowed[trial.trial_id]:
                ledger.cash_reasons["PRIOR_COHORT_OPEN"] += 1
                continue
            exit_ms = entry_ms + trial.hold_hours * HOUR_MS
            if exit_ms >= end_ms or exit_ms not in open_to_index:
                ledger.cash_reasons["EXIT_OUTSIDE_PARTITION"] += 1
                continue
            if utc_day_key(entry_ms) != utc_day_key(exit_ms):
                ledger.cash_reasons["PBO_DAY_BOUNDARY_GUARD"] += 1
                continue
            if snapshot is None:
                ledger.cash_reasons["CAUSAL_SIGNAL_CUT_INCOMPLETE"] += 1
                continue
            selection = select_tails(
                snapshot,
                factor_symbol,
                trial.z_threshold,
                trial.volume_threshold,
                float(allocation["maximum_absolute_btc_weight"]),
                float(allocation["maximum_absolute_member_weight"]),
                float(allocation["maximum_absolute_net_notional"]),
            )
            if selection is None:
                ledger.cash_reasons["TAIL_OR_HEDGE_NOT_ELIGIBLE"] += 1
                continue
            entry_index = open_to_index[entry_ms]
            exit_index = open_to_index[exit_ms]
            entry_prices = {
                symbol: bars[symbol][entry_index].open_price for symbol in selection.weights
            }
            exit_prices = {
                symbol: bars[symbol][exit_index].open_price for symbol in selection.weights
            }
            pnl = cohort_pnl(
                selection,
                entry_prices,
                exit_prices,
                funding,
                mark_prices,
                entry_ms,
                exit_ms,
                float(allocation["capital_usd"]),
                scenarios,
            )
            exit_day = utc_day_key(exit_ms)
            if exit_day not in day_index:
                raise ValueError("accepted exit day is outside the daily calendar")
            index = day_index[exit_day]
            for scenario in scenarios:
                value = pnl[scenario.name]
                if not math.isfinite(value):
                    raise ValueError("cohort PnL must be finite")
                ledger.daily[scenario.name][index] += value
            confirmation_quote_volume = {
                symbol: bars[symbol][signal_index - 1].quote_volume for symbol in selection.weights
            }
            ledger.capacity_usd.append(
                capacity_proxy_usd(
                    selection,
                    confirmation_quote_volume,
                    float(capacity["participation_rate"]),
                )
            )
            ledger.btc_weights.append(selection.weights[factor_symbol])
            ledger.active_round_trips += 1
            ledger.active_weeks.add(utc_week_key(entry_ms))
            ledger.long_counts.update([selection.long_symbol])
            ledger.short_counts.update([selection.short_symbol])
            next_allowed[trial.trial_id] = exit_ms

    event_summary = {
        "candidate_signal_hours": signal_hours,
        "complete_causal_signal_hours": complete_signal_hours,
        "first_signal_hour": (
            datetime.fromtimestamp(first_signal_ms / 1000, tz=UTC).isoformat()
            if first_signal_ms is not None
            else None
        ),
        "last_signal_hour": (
            datetime.fromtimestamp(last_signal_ms / 1000, tz=UTC).isoformat()
            if last_signal_ms is not None
            else None
        ),
        "calendar_days": len(days),
        "pbo_day_boundary_guard": True,
    }
    return days, ledgers, event_summary


def trial_summary(
    protocol: JsonObject,
    ledger: TrialLedger,
    samples: Sequence[Sequence[int]],
    raw_p: Mapping[str, float],
    holm: Mapping[str, float],
    trial_count: int,
) -> JsonObject:
    base_bootstrap = bootstrap_totals(ledger.daily["base"], samples)
    net = {name: math.fsum(values) for name, values in sorted(ledger.daily.items())}
    traded_symbols = set(ledger.long_counts) | set(ledger.short_counts)
    capacity = {
        "observations": len(ledger.capacity_usd),
        "minimum": min(ledger.capacity_usd) if ledger.capacity_usd else None,
        "p05": quantile(ledger.capacity_usd, 0.05) if ledger.capacity_usd else None,
        "median": statistics.median(ledger.capacity_usd) if ledger.capacity_usd else None,
    }
    factor_weights = {
        "observations": len(ledger.btc_weights),
        "minimum": min(ledger.btc_weights) if ledger.btc_weights else None,
        "maximum": max(ledger.btc_weights) if ledger.btc_weights else None,
        "median": statistics.median(ledger.btc_weights) if ledger.btc_weights else None,
    }
    return {
        "trial_id": ledger.trial.trial_id,
        "z_threshold": ledger.trial.z_threshold,
        "volume_threshold": ledger.trial.volume_threshold,
        "hold_hours": ledger.trial.hold_hours,
        "candidate_hours": ledger.candidate_hours,
        "active_round_trips": ledger.active_round_trips,
        "cash_hours": ledger.candidate_hours - ledger.active_round_trips,
        "cash_reasons": dict(sorted(ledger.cash_reasons.items())),
        "active_weeks": len(ledger.active_weeks),
        "distinct_idiosyncratic_symbols": len(traded_symbols),
        "long_counts": dict(sorted(ledger.long_counts.items())),
        "short_counts": dict(sorted(ledger.short_counts.items())),
        "net_usd_per_1000": net,
        "base_interval_95_usd_per_1000": {
            "lower": quantile(base_bootstrap, 0.025),
            "upper": quantile(base_bootstrap, 0.975),
        },
        "base_familywise_bonferroni_lower_usd_per_1000": quantile(
            base_bootstrap, 0.05 / trial_count
        ),
        "centered_block_one_sided_p": raw_p[ledger.trial.trial_id],
        "holm_adjusted_p": holm[ledger.trial.trial_id],
        "max_realized_drawdown_fraction_of_1000": maximum_drawdown_fraction(
            ledger.daily["base"], float(protocol["allocation"]["capital_usd"])
        ),
        "public_capacity_proxy_usd": capacity,
        "btc_factor_hedge_weight": factor_weights,
        "complete_daily_pnl_usd": dict(sorted(ledger.daily.items())),
    }


def trial_gate_values(
    summary: JsonObject,
    gates: JsonObject,
    white_p: float,
) -> dict[str, bool]:
    capacity_p05 = summary["public_capacity_proxy_usd"]["p05"]
    return {
        "candidate_hours_min": int(summary["candidate_hours"]) >= int(gates["candidate_hours_min"]),
        "active_round_trips_min": int(summary["active_round_trips"])
        >= int(gates["active_round_trips_min"]),
        "active_weeks_min": int(summary["active_weeks"]) >= int(gates["active_weeks_min"]),
        "distinct_idiosyncratic_symbols_min": int(summary["distinct_idiosyncratic_symbols"])
        >= int(gates["distinct_idiosyncratic_symbols_min"]),
        "base_net_positive": float(summary["net_usd_per_1000"]["base"])
        > float(gates["base_net_usd_per_1000_gt"]),
        "stress_net_positive": float(summary["net_usd_per_1000"]["stress"])
        > float(gates["stress_net_usd_per_1000_gt"]),
        "pointwise_lower_bound_positive": float(summary["base_interval_95_usd_per_1000"]["lower"])
        > float(gates["pointwise_lower_bound_gt"]),
        "familywise_lower_bound_positive": float(
            summary["base_familywise_bonferroni_lower_usd_per_1000"]
        )
        > float(gates["familywise_lower_bound_gt"]),
        "champion_holm_p": float(summary["holm_adjusted_p"]) <= float(gates["champion_holm_p_lte"]),
        "white_reality_check_p": white_p <= float(gates["white_reality_check_p_lte"]),
        "max_drawdown": float(summary["max_realized_drawdown_fraction_of_1000"])
        <= float(gates["max_drawdown_lte"]),
        "capacity_p05": capacity_p05 is not None
        and float(capacity_p05) >= float(gates["capacity_p05_usd_gte"]),
    }


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
        int(bootstrap["development_seed"]),
    )
    base_series = {trial_id: ledger.daily["base"] for trial_id, ledger in ledgers.items()}
    raw_p = {
        trial_id: centered_block_p(series, samples) for trial_id, series in base_series.items()
    }
    holm = holm_adjust(raw_p)
    white_p = white_reality_check_p(base_series, samples)
    pbo = cscv_pbo(base_series, int(stats["pbo"]["chronological_blocks"]))
    summaries = {
        trial_id: trial_summary(
            protocol,
            ledger,
            samples,
            raw_p,
            holm,
            len(ledgers),
        )
        for trial_id, ledger in sorted(ledgers.items())
    }
    gates_config = protocol["development_gates"]
    gate_matrix = {
        trial_id: trial_gate_values(summary, gates_config, white_p)
        for trial_id, summary in summaries.items()
    }
    eligible = [trial_id for trial_id, gates in gate_matrix.items() if all(gates.values())]
    reporting_champion = min(
        summaries,
        key=lambda trial_id: (
            -float(summaries[trial_id]["net_usd_per_1000"]["base"]),
            trial_id,
        ),
    )
    eligible_champion = (
        min(
            eligible,
            key=lambda trial_id: (
                -float(summaries[trial_id]["net_usd_per_1000"]["base"]),
                trial_id,
            ),
        )
        if eligible
        else None
    )
    for trial_id, summary in summaries.items():
        summary["development_gates"] = gate_matrix[trial_id]
        summary["all_development_gates_pass"] = all(gate_matrix[trial_id].values())
    return {
        "schema": "s2a.development.v1",
        "window": {
            "start": protocol["window"]["study_start"],
            "end_exclusive": protocol["window"]["development_end"],
            "calendar_days": list(days),
        },
        "event_clock": event_summary,
        "trial_count": len(ledgers),
        "selection_rule": stats["selection_metric"],
        "selection_tie_break": stats["selection_tie_break"],
        "reporting_champion_trial_id": reporting_champion,
        "eligible_champion_trial_id": eligible_champion,
        "eligible_trial_ids": sorted(eligible),
        "white_reality_check_p": white_p,
        "pbo": pbo,
        "pbo_affects_verdict": False,
        "external_program_wide_multiplicity": "UNMEASURED",
        "all_development_gates_pass": eligible_champion is not None,
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
        int(bootstrap["holdout_seed"]),
    )
    raw_p = {trial_id: centered_block_p(ledger.daily["base"], samples)}
    summary = trial_summary(protocol, ledger, samples, raw_p, raw_p, 1)
    gates_config = protocol["holdout_gates_if_opened"]
    gates = {
        "active_round_trips_min": int(summary["active_round_trips"])
        >= int(gates_config["active_round_trips_min"]),
        "active_weeks_min": int(summary["active_weeks"]) >= int(gates_config["active_weeks_min"]),
        "base_net_positive": float(summary["net_usd_per_1000"]["base"])
        > float(gates_config["base_net_usd_per_1000_gt"]),
        "stress_net_positive": float(summary["net_usd_per_1000"]["stress"])
        > float(gates_config["stress_net_usd_per_1000_gt"]),
        "pointwise_lower_bound_positive": float(summary["base_interval_95_usd_per_1000"]["lower"])
        > float(gates_config["pointwise_lower_bound_gt"]),
        "max_drawdown": float(summary["max_realized_drawdown_fraction_of_1000"])
        <= float(gates_config["max_drawdown_lte"]),
    }
    return {
        "schema": "s2a.holdout.v1",
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
    if freeze.get("schema") != "s2a.freeze.v1":
        raise ValueError("unexpected freeze schema")
    frozen = freeze.get("frozen_files")
    if not isinstance(frozen, dict) or set(frozen) != FROZEN_FILES:
        raise ValueError("freeze file inventory differs from the executable packet")
    for relative, expected in frozen.items():
        if not isinstance(relative, str) or not isinstance(expected, str):
            raise ValueError("freeze inventory must be string-to-string")
        if not HEX_64.fullmatch(expected):
            raise ValueError(f"invalid frozen digest for {relative}")
        if sha256_file(packet_dir / relative) != expected:
            raise ValueError(f"frozen file digest mismatch for {relative}")


def git_output(packet_dir: Path, *arguments: str) -> str:
    completed = subprocess.run(
        ["git", "-C", str(packet_dir), *arguments],
        check=True,
        capture_output=True,
        text=True,
    )
    return completed.stdout.strip()


def validate_git_freeze(
    packet_dir: Path,
    freeze_commit: str,
    canonical_base: str,
    freeze: JsonObject,
) -> None:
    if not GIT_SHA_40.fullmatch(freeze_commit):
        raise ValueError("freeze commit must be a full Git SHA")
    head = git_output(packet_dir, "rev-parse", "HEAD")
    if head != freeze_commit:
        raise ValueError("freeze commit must equal current clean HEAD")
    if git_output(packet_dir, "status", "--porcelain=v1"):
        raise ValueError("worktree must be clean before the sole run")
    subprocess.run(
        ["git", "-C", str(packet_dir), "merge-base", "--is-ancestor", canonical_base, head],
        check=True,
        capture_output=True,
    )
    changed = [
        line
        for line in git_output(
            packet_dir, "diff", "--name-only", f"{canonical_base}..{head}"
        ).splitlines()
        if line
    ]
    if not changed or any(not path.startswith("quant/research/s2a/") for path in changed):
        raise ValueError("freeze commit changed paths outside the exclusive S-2A scope")
    repository = Path(git_output(packet_dir, "rev-parse", "--show-toplevel"))
    packet_relative = packet_dir.resolve().relative_to(repository.resolve())
    for relative in [*sorted(FROZEN_FILES), "freeze.v1.json"]:
        tracked = subprocess.run(
            [
                "git",
                "-C",
                str(packet_dir),
                "show",
                f"{freeze_commit}:{packet_relative / relative}",
            ],
            check=True,
            capture_output=True,
        ).stdout
        if tracked != (packet_dir / relative).read_bytes():
            raise ValueError(f"freeze commit bytes differ for {relative}")
    if freeze.get("canonical_base") != canonical_base:
        raise ValueError("freeze and protocol canonical bases differ")


def write_checksums(packet_dir: Path) -> None:
    names = [
        "README.md",
        "OFFICIAL_SOURCE_RESEARCH.md",
        "DISTINCTNESS.md",
        "__init__.py",
        "protocol.v1.json",
        "experiment.py",
        "verifier.py",
        "test_experiment.py",
        "test_verifier.py",
        "freeze.v1.json",
        "RUN_STARTED.v1.json",
        "RUN_CONSUMED.v1.json",
        "development.v1.json",
        "source_manifest.v1.json",
        "result.v1.json",
    ]
    if (packet_dir / "HOLDOUT_OPENED.v1.json").exists():
        names.append("HOLDOUT_OPENED.v1.json")
    if (packet_dir / "holdout.v1.json").exists():
        names.append("holdout.v1.json")
    lines = [
        f"{sha256_file(packet_dir / name)}  {name}"
        for name in sorted(names)
        if (packet_dir / name).exists()
    ]
    payload = ("\n".join(lines) + "\n").encode()
    atomic_write_bytes(packet_dir / "SHA256SUMS", payload)


def concise_champion(development: JsonObject) -> JsonObject:
    trial_id = development["eligible_champion_trial_id"]
    if trial_id is None:
        trial_id = development["reporting_champion_trial_id"]
    trial = development["trials"][trial_id]
    return {
        "trial_id": trial_id,
        "eligible_for_holdout": development["eligible_champion_trial_id"] is not None,
        "z_threshold": trial["z_threshold"],
        "volume_threshold": trial["volume_threshold"],
        "hold_hours": trial["hold_hours"],
        "candidate_hours": trial["candidate_hours"],
        "active_round_trips": trial["active_round_trips"],
        "active_weeks": trial["active_weeks"],
        "distinct_idiosyncratic_symbols": trial["distinct_idiosyncratic_symbols"],
        "net_usd_per_1000": trial["net_usd_per_1000"],
        "base_interval_95_usd_per_1000": trial["base_interval_95_usd_per_1000"],
        "base_familywise_bonferroni_lower_usd_per_1000": trial[
            "base_familywise_bonferroni_lower_usd_per_1000"
        ],
        "centered_block_one_sided_p": trial["centered_block_one_sided_p"],
        "holm_adjusted_p": trial["holm_adjusted_p"],
        "white_reality_check_p": development["white_reality_check_p"],
        "pbo": development["pbo"],
        "max_realized_drawdown_fraction_of_1000": trial["max_realized_drawdown_fraction_of_1000"],
        "public_capacity_proxy_usd": trial["public_capacity_proxy_usd"],
        "development_gates": trial["development_gates"],
    }


def build_result(
    protocol: JsonObject,
    run_marker: JsonObject,
    development: JsonObject,
    holdout: JsonObject | None,
) -> JsonObject:
    if not bool(development["all_development_gates_pass"]):
        research_verdict = str(protocol["verdict_law"]["development_gate_failure"])
        local_public_verdict = "NO_GO"
        holdout_state = "SEALED_UNOPENED_DEVELOPMENT_GATES_FAILED"
    elif holdout is None:
        research_verdict = str(protocol["verdict_law"]["measurement_failure_after_run_marker"])
        local_public_verdict = "UNMEASURED"
        holdout_state = "UNMEASURED_AFTER_DEVELOPMENT_PASS"
    elif not bool(holdout["all_holdout_gates_pass"]):
        research_verdict = str(protocol["verdict_law"]["holdout_gate_failure"])
        local_public_verdict = "NO_GO"
        holdout_state = "OPENED_ON_FROZEN_CHAMPION_HOLDOUT_GATES_FAILED"
    else:
        research_verdict = "UNMEASURED"
        local_public_verdict = str(protocol["verdict_law"]["public_proxy_all_gates_pass"])
        holdout_state = "OPENED_ON_FROZEN_CHAMPION_ALL_LOCAL_PUBLIC_GATES_PASSED"
    return {
        "schema": "s2a.result.v1",
        "strategy_id": "S-2A",
        "run_status": "COMPLETE",
        "research_verdict": research_verdict,
        "local_public_verdict": local_public_verdict,
        "program_wide_external_multiplicity": "UNMEASURED",
        "capital_verdict": "NO_GO",
        "capital_verdict_reason": protocol["verdict_law"]["capital_verdict"],
        "freeze_commit": run_marker["freeze_commit"],
        "one_run_id": run_marker["one_run_id"],
        "development": concise_champion(development),
        "holdout_state": holdout_state,
        "holdout": (
            {
                "trial_id": holdout["sealed_champion_trial_id"],
                "net_usd_per_1000": holdout["trial"]["net_usd_per_1000"],
                "base_interval_95_usd_per_1000": holdout["trial"]["base_interval_95_usd_per_1000"],
                "active_round_trips": holdout["trial"]["active_round_trips"],
                "active_weeks": holdout["trial"]["active_weeks"],
                "max_realized_drawdown_fraction_of_1000": holdout["trial"][
                    "max_realized_drawdown_fraction_of_1000"
                ],
                "public_capacity_proxy_usd": holdout["trial"]["public_capacity_proxy_usd"],
                "gates": holdout["gates"],
            }
            if holdout is not None
            else None
        ),
        "limitations": [
            "ACCOUNT_EFFECTIVE_FEES_UNKNOWN",
            "EXECUTABLE_CAPACITY_UNMEASURED",
            "PROGRAM_WIDE_MULTIPLICITY_UNMEASURED",
            "USDT_USD_PARITY_UNMEASURED",
            "CURRENT_EXCHANGE_INFO_NOT_HISTORICAL_UNIVERSE",
            "STATIC_PANEL_SURVIVORSHIP_LIMITATION",
            "REALIZED_DAILY_DRAWDOWN_NOT_INTRAPERIOD_MARK_DRAWDOWN",
            "PUBLIC_TURNOVER_NOT_EXECUTABLE_DEPTH",
            "HOURLY_MARK_OPEN_NOT_EXACT_FUNDING_SETTLEMENT_MARK",
        ],
        "authority": "NONE",
        "effects": {
            "ui": False,
            "canonical": False,
            "host": False,
            "provider": False,
            "private": False,
            "order": False,
            "transfer": False,
            "withdrawal": False,
            "money_usd": 0,
        },
    }


def failure_result(
    protocol: JsonObject,
    run_marker: JsonObject,
    stage: str,
    error: BaseException,
) -> tuple[JsonObject, JsonObject]:
    failure = {
        "schema": "s2a.development.v1",
        "status": "TERMINAL_MEASUREMENT_FAILURE",
        "stage": stage,
        "failure_type": type(error).__name__,
        "economics": None,
        "statistics": None,
        "drawdown": None,
        "capacity": None,
    }
    result = {
        "schema": "s2a.result.v1",
        "strategy_id": "S-2A",
        "run_status": "TERMINAL_MEASUREMENT_FAILURE",
        "research_verdict": protocol["verdict_law"]["measurement_failure_after_run_marker"],
        "local_public_verdict": "UNMEASURED",
        "program_wide_external_multiplicity": "UNMEASURED",
        "capital_verdict": "NO_GO",
        "capital_verdict_reason": protocol["verdict_law"]["capital_verdict"],
        "freeze_commit": run_marker["freeze_commit"],
        "one_run_id": run_marker["one_run_id"],
        "failure": {
            "stage": stage,
            "type": type(error).__name__,
            "detail": "See source_manifest.v1.json and the frozen evaluator; no rerun is allowed.",
        },
        "development": None,
        "holdout_state": "SEALED_UNOPENED_TERMINAL_MEASUREMENT_FAILURE",
        "holdout": None,
        "limitations": [
            "MEASUREMENT_INVALID_AFTER_RUN_CONSUMED",
            "ACCOUNT_EFFECTIVE_FEES_UNKNOWN",
            "EXECUTABLE_CAPACITY_UNMEASURED",
        ],
        "authority": "NONE",
        "effects": {
            "ui": False,
            "canonical": False,
            "host": False,
            "provider": False,
            "private": False,
            "order": False,
            "transfer": False,
            "withdrawal": False,
            "money_usd": 0,
        },
    }
    return failure, result


def holdout_failure_result(
    protocol: JsonObject,
    run_marker: JsonObject,
    development: JsonObject,
    stage: str,
    error: BaseException,
) -> JsonObject:
    return {
        "schema": "s2a.result.v1",
        "strategy_id": "S-2A",
        "run_status": "TERMINAL_HOLDOUT_MEASUREMENT_FAILURE",
        "research_verdict": protocol["verdict_law"]["measurement_failure_after_run_marker"],
        "local_public_verdict": "UNMEASURED",
        "program_wide_external_multiplicity": "UNMEASURED",
        "capital_verdict": "NO_GO",
        "capital_verdict_reason": protocol["verdict_law"]["capital_verdict"],
        "freeze_commit": run_marker["freeze_commit"],
        "one_run_id": run_marker["one_run_id"],
        "failure": {
            "stage": stage,
            "type": type(error).__name__,
            "detail": "Holdout opening consumed the sole run; no repair or rerun is allowed.",
        },
        "development": concise_champion(development),
        "holdout_state": "OPENED_TERMINAL_MEASUREMENT_FAILURE",
        "holdout": None,
        "limitations": [
            "HOLDOUT_MEASUREMENT_INVALID_AFTER_OPEN_MARKER",
            "ACCOUNT_EFFECTIVE_FEES_UNKNOWN",
            "EXECUTABLE_CAPACITY_UNMEASURED",
        ],
        "authority": "NONE",
        "effects": {
            "ui": False,
            "canonical": False,
            "host": False,
            "provider": False,
            "private": False,
            "order": False,
            "transfer": False,
            "withdrawal": False,
            "money_usd": 0,
        },
    }


def expected_manifest_with_unopened(
    acquired: Sequence[JsonObject],
    development_expected: Sequence[JsonObject],
    holdout_expected: Sequence[JsonObject],
    holdout_opened: bool,
) -> list[JsonObject]:
    acquired_keys = {
        (str(row["dataset"]), str(row["symbol"]), str(row["month"])) for row in acquired
    }
    rows = [dict(row) for row in acquired]
    for expected in [*development_expected, *holdout_expected]:
        key = (
            str(expected["dataset"]),
            str(expected["symbol"]),
            str(expected["month"]),
        )
        if key in acquired_keys:
            continue
        status = (
            "SEALED_UNOPENED"
            if expected["phase"] == "HOLDOUT" and not holdout_opened
            else "NOT_ACQUIRED_TERMINAL_FAILURE"
        )
        rows.append(
            {
                **expected,
                "status": status,
                "declared_zip_sha256": None,
                "received_zip_sha256": None,
                "checksum_sha256": None,
                "zip_bytes": None,
                "checksum_bytes": None,
                "csv_member": None,
                "member_opened": False,
            }
        )
    return sorted(
        rows,
        key=lambda row: (
            str(row["phase"]),
            str(row["symbol"]),
            str(row["month"]),
            str(row["dataset"]),
        ),
    )


def run_once(packet_dir: Path, raw_root: Path, freeze_commit: str) -> int:
    protocol = read_json(packet_dir / "protocol.v1.json")
    freeze = read_json(packet_dir / "freeze.v1.json")
    validate_freeze(packet_dir, freeze)
    canonical_base = str(protocol["canonical_base"])
    validate_git_freeze(packet_dir, freeze_commit, canonical_base, freeze)
    output_names = [
        "RUN_STARTED.v1.json",
        "RUN_CONSUMED.v1.json",
        "HOLDOUT_OPENED.v1.json",
        "development.v1.json",
        "holdout.v1.json",
        "source_manifest.v1.json",
        "result.v1.json",
        "SHA256SUMS",
    ]
    if any((packet_dir / name).exists() for name in output_names):
        raise FileExistsError("packet already contains run or result artifacts")
    if raw_root.exists():
        raise FileExistsError("durable external state root must not already exist")
    raw_root.mkdir(parents=True, mode=0o700)

    factor_symbol = str(protocol["universe"]["factor_symbol"])
    symbols = [
        factor_symbol,
        *[str(symbol) for symbol in protocol["universe"]["idiosyncratic_symbols"]],
    ]
    root_url = str(protocol["sources"]["root"])
    development_months = [str(month) for month in protocol["window"]["development_months"]]
    holdout_months = [str(month) for month in protocol["window"]["holdout_months"]]
    development_expected = expected_source_rows(
        root_url, symbols, development_months, "DEVELOPMENT"
    )
    holdout_expected = expected_source_rows(root_url, symbols, holdout_months, "HOLDOUT")
    source_plan_sha256 = sha256_bytes(
        canonical_bytes(
            {
                "development": development_expected,
                "holdout": holdout_expected,
            }
        )
    )
    marker_core: JsonObject = {
        "schema": "s2a.run-marker.v1",
        "strategy_id": "S-2A",
        "one_run_id": sha256_bytes(
            canonical_bytes(
                {
                    "freeze_commit": freeze_commit,
                    "protocol_sha256": sha256_file(packet_dir / "protocol.v1.json"),
                    "source_plan_sha256": source_plan_sha256,
                }
            )
        ),
        "freeze_commit": freeze_commit,
        "canonical_base": canonical_base,
        "protocol_sha256": sha256_file(packet_dir / "protocol.v1.json"),
        "freeze_sha256": sha256_file(packet_dir / "freeze.v1.json"),
        "source_plan_sha256": source_plan_sha256,
        "raw_root": str(raw_root.resolve()),
        "max_run_count": 1,
        "holdout_opened": False,
    }
    external_marker = raw_root / "RUN_CONSUMED.v1.json"
    manifest: list[JsonObject] = []
    development: JsonObject | None = None
    holdout: JsonObject | None = None
    holdout_opened = False
    atomic_create(external_marker, marker_core)
    stage = "PACKET_START_MARKER"
    try:
        atomic_create(packet_dir / "RUN_STARTED.v1.json", marker_core)
        stage = "DEVELOPMENT_ACQUISITION"
        attempts = int(protocol["sources"]["transport_retries_within_single_invocation"])
        acquire_rows(raw_root, development_expected, manifest, attempts)
        stage = "DEVELOPMENT_MEMBER_OPEN"
        development_bars, development_funding, development_mark_prices = load_market_data(
            raw_root, manifest, symbols, development_months
        )
        stage = "DEVELOPMENT_EVALUATION"
        trials = build_trials(protocol)
        if len(trials) != int(protocol["response"]["trials"]):
            raise ValueError("frozen trial count mismatch")
        development_days, development_ledgers, development_clock = evaluate_trials(
            protocol,
            development_bars,
            development_funding,
            development_mark_prices,
            iso_ms(str(protocol["window"]["study_start"])),
            iso_ms(str(protocol["window"]["development_end"])),
            trials,
        )
        development = summarize_development(
            protocol,
            development_days,
            development_ledgers,
            development_clock,
        )
        if bool(development["all_development_gates_pass"]):
            champion_id = str(development["eligible_champion_trial_id"])
            champion = next(trial for trial in trials if trial.trial_id == champion_id)
            holdout_marker = {
                "schema": "s2a.holdout-open.v1",
                "strategy_id": "S-2A",
                "one_run_id": marker_core["one_run_id"],
                "freeze_commit": freeze_commit,
                "champion_trial_id": champion_id,
                "development_sha256": sha256_bytes(canonical_bytes(development)),
                "holdout_source_plan_sha256": sha256_bytes(canonical_bytes(holdout_expected)),
            }
            stage = "HOLDOUT_MARKER"
            atomic_create(raw_root / "HOLDOUT_OPENED.v1.json", holdout_marker)
            holdout_opened = True
            atomic_create(packet_dir / "HOLDOUT_OPENED.v1.json", holdout_marker)
            stage = "HOLDOUT_ACQUISITION"
            acquire_rows(raw_root, holdout_expected, manifest, attempts)
            stage = "HOLDOUT_MEMBER_OPEN"
            all_months = [*development_months, *holdout_months]
            all_bars, all_funding, all_mark_prices = load_market_data(
                raw_root,
                manifest,
                symbols,
                all_months,
            )
            stage = "HOLDOUT_EVALUATION"
            holdout_days, holdout_ledgers, holdout_clock = evaluate_trials(
                protocol,
                all_bars,
                all_funding,
                all_mark_prices,
                iso_ms(str(protocol["window"]["development_end"])),
                iso_ms(str(protocol["window"]["holdout_end"])),
                [champion],
            )
            holdout = summarize_holdout(protocol, holdout_days, holdout_ledgers, holdout_clock)
        result = build_result(protocol, marker_core, development, holdout)
    except BaseException as error:
        if development is not None and holdout_opened:
            result = holdout_failure_result(protocol, marker_core, development, stage, error)
        else:
            development, result = failure_result(protocol, marker_core, stage, error)

    complete_manifest = expected_manifest_with_unopened(
        manifest,
        development_expected,
        holdout_expected,
        holdout_opened,
    )
    source_manifest = {
        "schema": "s2a.source-manifest.v1",
        "strategy_id": "S-2A",
        "one_run_id": marker_core["one_run_id"],
        "source_plan_sha256": source_plan_sha256,
        "expected_archive_pairs": len(development_expected) + len(holdout_expected),
        "expected_http_objects": 2 * (len(development_expected) + len(holdout_expected)),
        "acquired_archive_pairs": sum(
            row["status"] == "ACQUIRED_CHECKSUM_VERIFIED" for row in complete_manifest
        ),
        "acquired_http_objects": 2
        * sum(row["status"] == "ACQUIRED_CHECKSUM_VERIFIED" for row in complete_manifest),
        "opened_archive_members": sum(bool(row.get("member_opened")) for row in complete_manifest),
        "holdout_opened": holdout_opened,
        "rows": complete_manifest,
    }
    consumed_marker = {
        **marker_core,
        "terminal_research_verdict": result["research_verdict"],
        "local_public_verdict": result["local_public_verdict"],
        "holdout_opened": holdout_opened,
        "holdout_state": result["holdout_state"],
    }
    atomic_create(packet_dir / "development.v1.json", development)
    if holdout is not None:
        atomic_create(packet_dir / "holdout.v1.json", holdout)
    atomic_create(packet_dir / "source_manifest.v1.json", source_manifest)
    atomic_create(packet_dir / "RUN_CONSUMED.v1.json", consumed_marker)
    atomic_create(packet_dir / "result.v1.json", result)
    write_checksums(packet_dir)
    return 0


def parser() -> argparse.ArgumentParser:
    argument_parser = argparse.ArgumentParser(description=__doc__)
    argument_parser.add_argument("--raw-root", required=True, type=Path)
    argument_parser.add_argument("--freeze-commit", required=True)
    return argument_parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = parser().parse_args(argv)
    packet_dir = Path(__file__).resolve().parent
    try:
        return run_once(packet_dir, arguments.raw_root.resolve(), arguments.freeze_commit)
    except BaseException as error:
        print(f"S2A_REFUSED {type(error).__name__}: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
