#!/usr/bin/env python3
"""Independent, network-free verifier for the sealed S-1U packet."""

from __future__ import annotations

import argparse
import bisect
import csv
import hashlib
import io
import itertools
import json
import math
import random
import re
import statistics
import subprocess
import sys
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


def canonical_bytes(value: Any) -> bytes:
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


def validate_freeze(packet_dir: Path, freeze: JsonObject) -> None:
    require(freeze.get("schema") == "s1u.freeze.v1", "invalid freeze schema")
    files = freeze.get("frozen_files")
    require(
        isinstance(files, dict) and set(files) == FROZEN_FILES,
        "freeze must bind exact required files",
    )
    if not isinstance(files, dict):
        raise AssertionError("unreachable")
    for relative, expected in files.items():
        path = packet_dir / str(relative)
        require(path.is_file(), f"frozen file absent: {relative}")
        require(sha256_file(path) == expected, f"frozen file mismatch: {relative}")


def verify_git_freeze(
    packet_dir: Path,
    marker: JsonObject,
    freeze: JsonObject,
    protocol: JsonObject,
) -> JsonObject:
    repository = packet_dir.parents[2]
    freeze_commit = str(marker["freeze_commit"])
    head = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=repository,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    ancestry = subprocess.run(
        ["git", "merge-base", "--is-ancestor", freeze_commit, head],
        cwd=repository,
        check=False,
        capture_output=True,
        text=True,
    )
    require(ancestry.returncode == 0, "freeze commit is not an ancestor of final HEAD")
    canonical_base = str(protocol["canonical_base"])
    require(
        re.fullmatch(r"[0-9a-f]{40}", canonical_base) is not None,
        "invalid protocol canonical base",
    )
    base_ancestry = subprocess.run(
        ["git", "merge-base", "--is-ancestor", canonical_base, freeze_commit],
        cwd=repository,
        check=False,
        capture_output=True,
        text=True,
    )
    require(
        base_ancestry.returncode == 0,
        "protocol canonical base is not an ancestor of freeze",
    )
    merges = subprocess.run(
        ["git", "rev-list", "--merges", f"{canonical_base}..{head}"],
        cwd=repository,
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    require(not merges, "S-1U lineage contains a merge commit")
    changed = subprocess.run(
        ["git", "diff", "--name-only", f"{canonical_base}..{head}"],
        cwd=repository,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.splitlines()
    require(
        bool(changed) and all(name.startswith("quant/research/s1u/") for name in changed),
        "final lineage escapes exclusive S-1U scope",
    )
    relative_packet = packet_dir.relative_to(repository)
    for name, expected in freeze["frozen_files"].items():
        blob = subprocess.run(
            ["git", "show", f"{freeze_commit}:{relative_packet}/{name}"],
            cwd=repository,
            check=True,
            capture_output=True,
        ).stdout
        require(
            sha256_bytes(blob) == expected,
            f"freeze commit does not bind frozen file: {name}",
        )
    return {
        "canonical_base": canonical_base,
        "freeze_commit": freeze_commit,
        "final_head": head,
        "merge_commits": 0,
        "changed_files": changed,
    }


def quantile(values: Sequence[float], probability: float) -> float:
    require(bool(values), "quantile requires values")
    require(0.0 <= probability <= 1.0, "invalid quantile probability")
    ordered = sorted(values)
    location = (len(ordered) - 1) * probability
    lower = math.floor(location)
    upper = math.ceil(location)
    if lower == upper:
        return ordered[lower]
    weight = location - lower
    return ordered[lower] + weight * (ordered[upper] - ordered[lower])


def circular_block_indices(
    length: int, replicates: int, block_days: int, seed: int
) -> list[list[int]]:
    require(length > 0 and replicates > 0 and block_days > 0, "invalid bootstrap dimensions")
    generator = random.Random(seed)
    result: list[list[int]] = []
    for _ in range(replicates):
        sample: list[int] = []
        while len(sample) < length:
            start = generator.randrange(length)
            sample.extend((start + offset) % length for offset in range(block_days))
        result.append(sample[:length])
    return result


def bootstrap_totals(series: Sequence[float], samples: Sequence[Sequence[int]]) -> list[float]:
    return [math.fsum(series[index] for index in sample) for sample in samples]


def centered_block_p(series: Sequence[float], samples: Sequence[Sequence[int]]) -> float:
    observed = math.fsum(series)
    center = statistics.fmean(series)
    centered = [value - center for value in series]
    exceedances = 0
    for sample in samples:
        simulated = math.fsum(centered[index] for index in sample)
        if simulated >= observed:
            exceedances += 1
    return (exceedances + 1.0) / (len(samples) + 1.0)


def holm_adjust(raw: dict[str, float]) -> dict[str, float]:
    ordered = sorted(raw, key=lambda trial_id: (raw[trial_id], trial_id))
    adjusted: dict[str, float] = {}
    running = 0.0
    for rank, trial_id in enumerate(ordered):
        running = max(running, min(1.0, (len(ordered) - rank) * raw[trial_id]))
        adjusted[trial_id] = running
    return adjusted


def white_reality_check_p(
    series_by_trial: Mapping[str, Sequence[float]], samples: Sequence[Sequence[int]]
) -> float:
    observed = max(math.fsum(series) for series in series_by_trial.values())
    centered: dict[str, list[float]] = {}
    for trial_id, series in series_by_trial.items():
        center = statistics.fmean(series)
        centered[trial_id] = [value - center for value in series]
    exceedances = 0
    for sample in samples:
        simulated = max(
            math.fsum(series[index] for index in sample) for series in centered.values()
        )
        if simulated >= observed:
            exceedances += 1
    return (exceedances + 1.0) / (len(samples) + 1.0)


def chronological_blocks(length: int, count: int) -> list[list[int]]:
    require(length >= count > 0, "invalid CSCV dimensions")
    return [
        list(range((block * length) // count, ((block + 1) * length) // count))
        for block in range(count)
    ]


def cscv_pbo(series_by_trial: Mapping[str, Sequence[float]], block_count: int) -> JsonObject:
    trial_ids = sorted(series_by_trial)
    length = len(next(iter(series_by_trial.values())))
    blocks = chronological_blocks(length, block_count)
    failures = 0
    logits: list[float] = []
    splits = 0
    for train_blocks in itertools.combinations(range(block_count), block_count // 2):
        training = set(train_blocks)
        train_indices = [index for block in training for index in blocks[block]]
        test_indices = [
            index
            for block in range(block_count)
            if block not in training
            for index in blocks[block]
        ]
        train_total = {
            trial_id: math.fsum(series_by_trial[trial_id][index] for index in train_indices)
            for trial_id in trial_ids
        }
        champion = min(trial_ids, key=lambda trial_id: (-train_total[trial_id], trial_id))
        test_total = {
            trial_id: math.fsum(series_by_trial[trial_id][index] for index in test_indices)
            for trial_id in trial_ids
        }
        champion_value = test_total[champion]
        below = sum(value < champion_value for value in test_total.values())
        equal = sum(value == champion_value for value in test_total.values())
        percentile = (below + 0.5 * equal) / len(trial_ids)
        if percentile <= 0.5:
            failures += 1
        clipped = min(1.0 - 1e-12, max(1e-12, percentile))
        logits.append(math.log(clipped / (1.0 - clipped)))
        splits += 1
    return {
        "method": "CSCV",
        "blocks": block_count,
        "train_blocks": block_count // 2,
        "splits": splits,
        "pbo": failures / splits,
        "median_logit_oos_rank": statistics.median(logits),
    }


def maximum_drawdown_fraction(series: Sequence[float], bankroll: float) -> float:
    cumulative = 0.0
    peak = 0.0
    drawdown = 0.0
    for value in series:
        cumulative += value
        peak = max(peak, cumulative)
        drawdown = max(drawdown, peak - cumulative)
    return drawdown / bankroll


@dataclass(frozen=True, slots=True)
class VerifiedBar:
    open_ms: int
    close_ms: int
    open_price: float
    quote_volume: float
    taker_buy_quote_volume: float


def verified_timestamp_ms(value: str) -> int:
    text = value.strip()
    if re.fullmatch(r"-?\d+(?:\.0+)?", text):
        number = int(text.split(".", maxsplit=1)[0])
        if abs(number) >= 100_000_000_000_000_000:
            return number // 1_000_000
        if abs(number) >= 100_000_000_000_000:
            return number // 1_000
        return number
    normalized = text.replace(" ", "T")
    if normalized.endswith("Z"):
        normalized = f"{normalized[:-1]}+00:00"
    parsed = datetime.fromisoformat(normalized)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return int(parsed.astimezone(UTC).timestamp() * 1000)


def verified_month_bounds(path: Path) -> tuple[int, int]:
    match = re.search(r"-(\d{4}-\d{2})\.zip$", path.name)
    require(match is not None, f"archive month absent: {path}")
    if match is None:
        raise AssertionError("unreachable")
    current = datetime.strptime(match.group(1), "%Y-%m").replace(tzinfo=UTC)
    year = current.year + (1 if current.month == 12 else 0)
    month = 1 if current.month == 12 else current.month + 1
    following = current.replace(year=year, month=month)
    return int(current.timestamp() * 1000), int(following.timestamp() * 1000)


def verified_csv_rows(path: Path, header: Sequence[str]) -> list[list[str]]:
    with zipfile.ZipFile(path) as archive:
        members = [entry for entry in archive.infolist() if not entry.is_dir()]
        require(len(members) == 1, f"archive member count mismatch: {path}")
        member = members[0]
        require(member.filename == f"{path.stem}.csv", f"archive member identity mismatch: {path}")
        text = archive.read(member).decode("utf-8-sig")
    rows = [row for row in csv.reader(io.StringIO(text)) if row]
    require(bool(rows), f"empty archive: {path}")
    require(
        [field.strip().lower() for field in rows[0]] == list(header),
        f"archive schema mismatch: {path}",
    )
    return rows[1:]


def verified_kline_rows(path: Path) -> list[VerifiedBar]:
    header = (
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
    start, end = verified_month_bounds(path)
    result: list[VerifiedBar] = []
    previous = -1
    for row in verified_csv_rows(path, header):
        require(len(row) == 12, f"kline column count mismatch: {path}")
        open_ms = verified_timestamp_ms(row[0])
        close_ms = verified_timestamp_ms(row[6])
        open_price = float(row[1])
        quote_volume = float(row[7])
        taker_buy_quote = float(row[10])
        require(start <= open_ms < end, f"kline outside archive month: {path}")
        require(open_ms > previous, f"kline order mismatch: {path}")
        require(close_ms == open_ms + BAR_MS - 1, f"kline clock mismatch: {path}")
        require(
            math.isfinite(open_price)
            and math.isfinite(quote_volume)
            and math.isfinite(taker_buy_quote)
            and open_price > 0
            and quote_volume >= 0
            and 0 <= taker_buy_quote <= quote_volume * 1.000000001,
            f"kline numeric mismatch: {path}",
        )
        result.append(
            VerifiedBar(
                open_ms=open_ms,
                close_ms=close_ms,
                open_price=open_price,
                quote_volume=quote_volume,
                taker_buy_quote_volume=taker_buy_quote,
            )
        )
        previous = open_ms
    return result


def verified_funding_rows(path: Path) -> list[int]:
    header = ("calc_time", "funding_interval_hours", "last_funding_rate")
    start, end = verified_month_bounds(path)
    result: list[int] = []
    for row in verified_csv_rows(path, header):
        require(len(row) == 3, f"funding column count mismatch: {path}")
        timestamp = verified_timestamp_ms(row[0])
        interval = float(row[1])
        rate = float(row[2])
        require(start <= timestamp < end, f"funding outside archive month: {path}")
        require(
            math.isfinite(interval) and interval > 0 and math.isfinite(rate),
            f"funding numeric mismatch: {path}",
        )
        require(not result or timestamp > result[-1], f"funding order mismatch: {path}")
        result.append(timestamp)
    return result


def verified_source_map(manifest: JsonObject) -> dict[tuple[str, str, str], JsonObject]:
    return {
        (str(row["dataset"]), str(row["symbol"]), str(row["month"])): row
        for row in manifest["objects"]
    }


def rebuild_market_data(
    raw_root: Path,
    manifest: JsonObject,
    symbols: Sequence[str],
    months: Sequence[str],
) -> tuple[dict[str, list[VerifiedBar]], dict[str, list[int]]]:
    rows = verified_source_map(manifest)
    bars: dict[str, list[VerifiedBar]] = {}
    settlements: dict[str, list[int]] = {}
    for symbol in symbols:
        symbol_bars: list[VerifiedBar] = []
        symbol_settlements: list[int] = []
        for month in months:
            kline = rows[("klines", symbol, month)]
            funding = rows[("fundingRate", symbol, month)]
            require(
                kline["state"] == funding["state"] == "VERIFIED_BODY_PRESENT",
                f"measured split lacks parsed source: {symbol}/{month}",
            )
            symbol_bars.extend(verified_kline_rows(expected_raw_path(raw_root, kline)))
            symbol_settlements.extend(verified_funding_rows(expected_raw_path(raw_root, funding)))
        require(
            all(
                later.open_ms > earlier.open_ms
                for earlier, later in itertools.pairwise(symbol_bars)
            ),
            f"cross-month kline order mismatch: {symbol}",
        )
        require(
            all(later > earlier for earlier, later in itertools.pairwise(symbol_settlements)),
            f"cross-month funding order mismatch: {symbol}",
        )
        bars[symbol] = symbol_bars
        settlements[symbol] = symbol_settlements
    return bars, settlements


def rebuilt_candidate_events(
    settlements: Mapping[str, Sequence[int]],
    symbols: Sequence[str],
    start_ms: int,
    end_ms: int,
    maximum_deviation_ms: int,
) -> list[tuple[int, dict[str, int]]]:
    maps: dict[str, dict[int, list[int]]] = {}
    candidates: set[int] = set()
    for symbol in symbols:
        symbol_map: dict[int, list[int]] = {}
        for timestamp in settlements[symbol]:
            bucket = ((timestamp + MINUTE_MS // 2) // MINUTE_MS) * MINUTE_MS
            symbol_map.setdefault(bucket, []).append(timestamp)
            if start_ms <= bucket < end_ms:
                candidates.add(bucket)
        maps[symbol] = symbol_map
    result: list[tuple[int, dict[str, int]]] = []
    for bucket in sorted(candidates):
        actual: dict[str, int] = {}
        for symbol in symbols:
            values = maps[symbol].get(bucket, [])
            if len(values) == 1 and abs(values[0] - bucket) <= maximum_deviation_ms:
                actual[symbol] = values[0]
        result.append((bucket, actual))
    return result


def rebuilt_lagged_imbalance(
    bars: Sequence[VerifiedBar],
    close_times: Sequence[int],
    settlement_ms: int,
    lookback_minutes: int,
    minimum_lag_ms: int,
) -> float | None:
    count = lookback_minutes // 5
    end_index = bisect.bisect_right(close_times, settlement_ms - minimum_lag_ms)
    start_index = end_index - count
    if start_index < 0:
        return None
    rows = bars[start_index:end_index]
    if len(rows) != count or rows[-1].close_ms > settlement_ms - minimum_lag_ms:
        return None
    cutoff = settlement_ms - minimum_lag_ms
    expected_latest_open = ((cutoff - (BAR_MS - 1)) // BAR_MS) * BAR_MS
    if rows[-1].open_ms != expected_latest_open:
        return None
    if any(
        later.open_ms - earlier.open_ms != BAR_MS for earlier, later in itertools.pairwise(rows)
    ):
        return None
    quote = math.fsum(row.quote_volume for row in rows)
    taker_buy = math.fsum(row.taker_buy_quote_volume for row in rows)
    if not math.isfinite(quote) or quote <= 0:
        return None
    value = (2.0 * taker_buy - quote) / quote
    if not math.isfinite(value) or not -1.000000001 <= value <= 1.000000001:
        return None
    return min(1.0, max(-1.0, value))


def rebuilt_selection(
    values: Mapping[str, float], symbols: Sequence[str], tail_size: int
) -> tuple[tuple[str, ...], tuple[str, ...]] | None:
    if set(values) != set(symbols):
        return None
    ranked = sorted((values[symbol], symbol) for symbol in symbols)
    if math.isclose(
        ranked[tail_size - 1][0],
        ranked[tail_size][0],
        rel_tol=0.0,
        abs_tol=1e-12,
    ):
        return None
    high = len(ranked) - tail_size
    if math.isclose(ranked[high - 1][0], ranked[high][0], rel_tol=0.0, abs_tol=1e-12):
        return None
    return (
        tuple(symbol for _, symbol in ranked[:tail_size]),
        tuple(symbol for _, symbol in ranked[-tail_size:]),
    )


def rebuilt_prior_day_volume(
    bars_by_open: Mapping[int, VerifiedBar], event_bucket: int
) -> float | None:
    event_day = (event_bucket // DAY_MS) * DAY_MS
    prior = event_day - DAY_MS
    rows = [bars_by_open.get(prior + offset * BAR_MS) for offset in range(288)]
    if any(row is None for row in rows):
        return None
    complete = [row for row in rows if row is not None]
    if any(row.close_ms >= event_day for row in complete):
        return None
    total = math.fsum(row.quote_volume for row in complete)
    return total if math.isfinite(total) and total > 0 else None


def rebuilt_calendar_days(start_ms: int, end_ms: int) -> list[str]:
    start = datetime.fromtimestamp(start_ms / 1000, tz=UTC).date()
    end = datetime.fromtimestamp(end_ms / 1000, tz=UTC).date()
    return [(start + timedelta(days=offset)).isoformat() for offset in range((end - start).days)]


def rebuilt_day_key(timestamp_ms: int) -> str:
    return datetime.fromtimestamp(timestamp_ms / 1000, tz=UTC).date().isoformat()


def rebuilt_week_key(timestamp_ms: int) -> str:
    week = datetime.fromtimestamp(timestamp_ms / 1000, tz=UTC).date().isocalendar()
    return f"{week.year:04d}-W{week.week:02d}"


def rebuild_ledgers(
    protocol: JsonObject,
    bars: Mapping[str, Sequence[VerifiedBar]],
    settlements: Mapping[str, Sequence[int]],
    start_ms: int,
    end_ms: int,
    trials: Sequence[tuple[int, int]],
) -> tuple[list[str], dict[str, JsonObject], JsonObject]:
    symbols = [str(symbol) for symbol in protocol["universe"]["symbols"]]
    days = rebuilt_calendar_days(start_ms, end_ms)
    day_index = {day: index for index, day in enumerate(days)}
    bars_by_open = {symbol: {bar.open_ms: bar for bar in bars[symbol]} for symbol in symbols}
    close_times = {symbol: [bar.close_ms for bar in bars[symbol]] for symbol in symbols}
    scenario_rates = {
        name: (
            float(values["public_fee_bp_per_fill"]) + float(values["adverse_execution_bp_per_fill"])
        )
        / 10_000
        for name, values in protocol["costs"]["scenarios"].items()
    }
    ledgers: dict[str, JsonObject] = {}
    for lookback, horizon in trials:
        trial_id = f"L{lookback:03d}_H{horizon:03d}"
        ledgers[trial_id] = {
            "candidate_common_settlements": 0,
            "active_cohorts": 0,
            "cash_reasons": Counter(),
            "active_weeks_set": set(),
            "long_counts": Counter(),
            "short_counts": Counter(),
            "public_capacity_proxy_observations_usd": [],
            "complete_daily_pnl_usd": {name: [0.0 for _ in days] for name in scenario_rates},
        }
    events = rebuilt_candidate_events(
        settlements,
        symbols,
        start_ms,
        end_ms,
        int(protocol["clock"]["maximum_bucket_deviation_ms"]),
    )
    next_by_actual: dict[str, dict[int, int | None]] = {}
    for symbol in symbols:
        times = list(settlements[symbol])
        mapping: dict[int, int | None] = {}
        for timestamp in times:
            position = bisect.bisect_right(times, timestamp)
            mapping[timestamp] = times[position] if position < len(times) else None
        next_by_actual[symbol] = mapping
    tail_size = int(protocol["signal"]["tail_size"])
    member_notional = float(protocol["allocation"]["member_notional_usd"])
    participation = float(protocol["capacity"]["participation_rate"])
    for bucket, actual in events:
        day = rebuilt_day_key(bucket)
        for lookback, horizon in trials:
            trial_id = f"L{lookback:03d}_H{horizon:03d}"
            ledger = ledgers[trial_id]
            ledger["candidate_common_settlements"] += 1
            entry = bucket + int(protocol["clock"]["entry_grid_offset_ms"])
            exit_ms = entry + horizon * MINUTE_MS
            reason: str | None = None
            if set(actual) != set(symbols):
                reason = "SETTLEMENT_COHORT_INVALID"
            elif day not in day_index or exit_ms >= end_ms:
                reason = "RESPONSE_OUTSIDE_SPLIT"
            elif any(
                entry <= timestamp
                or entry - timestamp < int(protocol["clock"]["minimum_entry_delay_ms"])
                for timestamp in actual.values()
            ):
                reason = "ENTRY_CLOCK_INVALID"
            values: dict[str, float] = {}
            if reason is None:
                for symbol in symbols:
                    value = rebuilt_lagged_imbalance(
                        bars[symbol],
                        close_times[symbol],
                        actual[symbol],
                        lookback,
                        int(protocol["clock"]["minimum_signal_lag_ms"]),
                    )
                    if value is None:
                        reason = "LAG_WINDOW_INCOMPLETE"
                        break
                    values[symbol] = value
            selection = rebuilt_selection(values, symbols, tail_size) if reason is None else None
            if reason is None and selection is None:
                reason = "ATOMIC_TAIL_TIE_OR_INCOMPLETE"
            selected: tuple[str, ...] = ()
            if selection is not None:
                selected = selection[0] + selection[1]
            prices: dict[str, tuple[float, float]] = {}
            if reason is None:
                for symbol in selected:
                    entry_bar = bars_by_open[symbol].get(entry)
                    exit_bar = bars_by_open[symbol].get(exit_ms)
                    if entry_bar is None or exit_bar is None:
                        reason = "ENTRY_OR_EXIT_BAR_MISSING"
                        break
                    prices[symbol] = (entry_bar.open_price, exit_bar.open_price)
            if reason is None:
                for symbol in selected:
                    following = next_by_actual[symbol].get(actual[symbol])
                    if following is None or following <= exit_ms:
                        reason = "LATER_SETTLEMENT_GUARD_FAILED"
                        break
            prior_volumes: list[float] = []
            if reason is None:
                for symbol in selected:
                    volume = rebuilt_prior_day_volume(bars_by_open[symbol], bucket)
                    if volume is None:
                        reason = "PRIOR_COMPLETE_DAY_VOLUME_MISSING"
                        break
                    prior_volumes.append(volume)
            if reason is not None or selection is None:
                ledger["cash_reasons"][reason or "UNCLASSIFIED_CASH"] += 1
                continue
            pnl = dict.fromkeys(scenario_rates, 0.0)
            for side, members in ((1, selection[0]), (-1, selection[1])):
                for symbol in members:
                    entry_price, exit_price = prices[symbol]
                    ratio = exit_price / entry_price
                    gross = member_notional * side * (ratio - 1.0)
                    exit_notional = member_notional * ratio
                    for name, rate in scenario_rates.items():
                        pnl[name] += gross - rate * (member_notional + exit_notional)
            index = day_index[day]
            for name, value in pnl.items():
                ledger["complete_daily_pnl_usd"][name][index] += value
            ledger["active_cohorts"] += 1
            ledger["active_weeks_set"].add(rebuilt_week_key(bucket))
            ledger["long_counts"].update(selection[0])
            ledger["short_counts"].update(selection[1])
            ledger["public_capacity_proxy_observations_usd"].append(
                2.0 * tail_size * participation * min(prior_volumes)
            )
    event_clock = {
        "candidate_union_settlement_count": len(events),
        "complete_observed_settlement_count": sum(
            set(actual) == set(symbols) for _, actual in events
        ),
        "first_candidate_settlement": (
            datetime.fromtimestamp(events[0][0] / 1000, tz=UTC).isoformat() if events else None
        ),
        "last_candidate_settlement": (
            datetime.fromtimestamp(events[-1][0] / 1000, tz=UTC).isoformat() if events else None
        ),
        "calendar_days": len(days),
    }
    return days, ledgers, event_clock


def compare_rebuilt_ledgers(
    days: Sequence[str],
    rebuilt: Mapping[str, JsonObject],
    event_clock: JsonObject,
    stored: JsonObject,
) -> JsonObject:
    require(stored["window"]["calendar_days"] == list(days), "raw-rebuilt calendar mismatch")
    require(stored["event_clock"] == event_clock, "raw-rebuilt event clock mismatch")
    require(set(stored["trials"]) == set(rebuilt), "raw-rebuilt trial set mismatch")
    for trial_id, ledger in rebuilt.items():
        summary = stored["trials"][trial_id]
        trial_match = re.fullmatch(r"L(\d{3})_H(\d{3})", trial_id)
        require(trial_match is not None, f"invalid frozen trial id: {trial_id}")
        if trial_match is None:
            raise AssertionError("unreachable")
        require(summary["trial_id"] == trial_id, f"stored trial id mismatch: {trial_id}")
        require(
            int(summary["lookback_minutes"]) == int(trial_match.group(1)),
            f"stored lookback mismatch: {trial_id}",
        )
        require(
            int(summary["horizon_minutes"]) == int(trial_match.group(2)),
            f"stored horizon mismatch: {trial_id}",
        )
        require(
            int(summary["candidate_common_settlements"])
            == int(ledger["candidate_common_settlements"]),
            f"raw-rebuilt candidate mismatch: {trial_id}",
        )
        require(
            int(summary["active_cohorts"]) == int(ledger["active_cohorts"]),
            f"raw-rebuilt active mismatch: {trial_id}",
        )
        require(
            int(summary["cash_cohorts"])
            == int(ledger["candidate_common_settlements"]) - int(ledger["active_cohorts"]),
            f"raw-rebuilt cash count mismatch: {trial_id}",
        )
        require(
            summary["cash_reasons"] == dict(sorted(ledger["cash_reasons"].items())),
            f"raw-rebuilt cash reasons mismatch: {trial_id}",
        )
        require(
            int(summary["active_weeks"]) == len(ledger["active_weeks_set"]),
            f"raw-rebuilt active weeks mismatch: {trial_id}",
        )
        require(
            summary["long_counts"] == dict(sorted(ledger["long_counts"].items())),
            f"raw-rebuilt long counts mismatch: {trial_id}",
        )
        require(
            summary["short_counts"] == dict(sorted(ledger["short_counts"].items())),
            f"raw-rebuilt short counts mismatch: {trial_id}",
        )
        stored_capacity = summary["public_capacity_proxy_observations_usd"]
        rebuilt_capacity = ledger["public_capacity_proxy_observations_usd"]
        require(len(stored_capacity) == len(rebuilt_capacity), f"raw capacity count: {trial_id}")
        require(
            all(
                close(float(left), float(right))
                for left, right in zip(stored_capacity, rebuilt_capacity, strict=True)
            ),
            f"raw-rebuilt capacity mismatch: {trial_id}",
        )
        for scenario, values in ledger["complete_daily_pnl_usd"].items():
            stored_values = summary["complete_daily_pnl_usd"][scenario]
            require(len(stored_values) == len(values), f"raw daily count: {trial_id}/{scenario}")
            require(
                all(
                    close(float(left), float(right))
                    for left, right in zip(stored_values, values, strict=True)
                ),
                f"raw-rebuilt daily PnL mismatch: {trial_id}/{scenario}",
            )
    return {
        "status": "PASS",
        "trials": len(rebuilt),
        "candidate_union_settlements": event_clock["candidate_union_settlement_count"],
    }


def verify_raw_outcomes(
    packet_dir: Path,
    raw_root: Path,
    protocol: JsonObject,
    development: JsonObject,
) -> JsonObject:
    if development.get("measurement_state") == "UNMEASURED":
        return {"development": "UNMEASURED_NO_OUTCOME_TO_REBUILD"}
    manifest = read_json(packet_dir / "source_manifest.v1.json")
    symbols = [str(symbol) for symbol in protocol["universe"]["symbols"]]
    development_months = [str(month) for month in protocol["window"]["development_months"]]
    development_bars, development_settlements = rebuild_market_data(
        raw_root, manifest, symbols, development_months
    )
    development_trials = [
        (int(lookback), int(horizon))
        for lookback in protocol["signal"]["lookback_minutes"]
        for horizon in protocol["response"]["horizon_minutes"]
    ]
    development_days, rebuilt, event_clock = rebuild_ledgers(
        protocol,
        development_bars,
        development_settlements,
        verified_timestamp_ms(str(protocol["window"]["study_start"])),
        verified_timestamp_ms(str(protocol["window"]["development_end"])),
        development_trials,
    )
    proof: JsonObject = {
        "development": compare_rebuilt_ledgers(development_days, rebuilt, event_clock, development)
    }
    if development["all_development_gates_pass"]:
        result = read_json(packet_dir / "result.v1.json")
        if result.get("holdout") is None:
            proof["holdout"] = "OPENED_BUT_TERMINAL_UNMEASURED"
            return proof
        holdout = result["holdout"]
        holdout_months = [
            development_months[-1],
            *[str(month) for month in protocol["window"]["holdout_months"]],
        ]
        holdout_bars, holdout_settlements = rebuild_market_data(
            raw_root, manifest, symbols, holdout_months
        )
        champion_id = str(development["champion_trial_id"])
        champion_match = re.fullmatch(r"L(\d{3})_H(\d{3})", champion_id)
        require(champion_match is not None, "invalid champion trial id")
        if champion_match is None:
            raise AssertionError("unreachable")
        holdout_days, holdout_rebuilt, holdout_clock = rebuild_ledgers(
            protocol,
            holdout_bars,
            holdout_settlements,
            verified_timestamp_ms(str(protocol["window"]["development_end"])),
            verified_timestamp_ms(str(protocol["window"]["holdout_end"])),
            [
                (
                    int(champion_match.group(1)),
                    int(champion_match.group(2)),
                )
            ],
        )
        pseudo_stored = {
            "window": holdout["window"],
            "event_clock": holdout["event_clock"],
            "trials": {holdout["sealed_champion_trial_id"]: holdout["trial"]},
        }
        proof["holdout"] = compare_rebuilt_ledgers(
            holdout_days, holdout_rebuilt, holdout_clock, pseudo_stored
        )
    else:
        proof["holdout"] = "UNOPENED"
    return proof


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def close(left: float, right: float, tolerance: float = 1e-9) -> bool:
    return math.isclose(left, right, rel_tol=1e-12, abs_tol=tolerance)


def verify_checksum_file(packet_dir: Path) -> JsonObject:
    checksum_path = packet_dir / "SHA256SUMS"
    require(checksum_path.is_file(), "SHA256SUMS is absent")
    lines = checksum_path.read_text(encoding="utf-8").splitlines()
    observed: dict[str, str] = {}
    for line in lines:
        match = re.fullmatch(r"([0-9a-f]{64})  ([A-Za-z0-9_.-]+)", line)
        require(match is not None, f"malformed SHA256SUMS line: {line}")
        if match is None:
            raise AssertionError("unreachable")
        digest, name = match.groups()
        require(name not in observed, f"duplicate checksum entry: {name}")
        observed[name] = digest
    expected_names = {
        path.name for path in packet_dir.iterdir() if path.is_file() and path.name != "SHA256SUMS"
    }
    require(set(observed) == expected_names, "SHA256SUMS file set mismatch")
    for name, digest in observed.items():
        require(sha256_file(packet_dir / name) == digest, f"packet checksum mismatch: {name}")
    return {"files": len(observed), "sha256sums_sha256": sha256_file(checksum_path)}


def verify_run_marker(packet_dir: Path, raw_root: Path) -> JsonObject:
    tracked = read_json(packet_dir / "RUN_CONSUMED.v1.json")
    started = read_json(packet_dir / "RUN_STARTED.v1.json")
    external = read_json(raw_root / "RUN_CONSUMED.v1.json")
    for key in (
        "schema",
        "strategy_id",
        "state",
        "one_run_id",
        "freeze_commit",
        "run_started_utc",
        "raw_root",
        "rerun_allowed",
    ):
        require(tracked.get(key) == external.get(key), f"run marker mismatch: {key}")
        require(started.get(key) == external.get(key), f"start marker mismatch: {key}")
    require(tracked["state"] == "CONSUMED_BEFORE_FIRST_SOURCE_BODY_REQUEST", "bad run state")
    require(tracked["rerun_allowed"] is False, "rerun must be forbidden")
    require(str(raw_root.resolve()) == tracked["raw_root"], "raw-root binding mismatch")
    require(
        re.fullmatch(r"[0-9a-f]{40}", str(tracked["freeze_commit"])) is not None,
        "invalid freeze commit",
    )
    require(
        re.fullmatch(r"[0-9a-f]{64}", str(tracked["one_run_id"])) is not None,
        "invalid one-run id",
    )
    return tracked


def expected_raw_path(raw_root: Path, row: JsonObject) -> Path:
    dataset = str(row["dataset"])
    symbol = str(row["symbol"])
    month = str(row["month"])
    if dataset == "klines":
        relative = f"klines/{symbol}/5m/{symbol}-5m-{month}.zip"
    elif dataset == "fundingRate":
        relative = f"fundingRate/{symbol}/{symbol}-fundingRate-{month}.zip"
    else:
        raise ValueError(f"unknown manifest dataset: {dataset}")
    return raw_root / "raw" / relative


def verify_manifest(
    packet_dir: Path,
    raw_root: Path,
    protocol: JsonObject,
    marker: JsonObject,
    development: JsonObject,
) -> JsonObject:
    manifest = read_json(packet_dir / "source_manifest.v1.json")
    require(manifest["schema"] == "s1u.source-manifest.v1", "bad manifest schema")
    require(manifest["publisher"] == "Binance", "unexpected publisher")
    require(manifest["public_only"] is True, "manifest is not public-only")
    require(manifest["one_run_id"] == marker["one_run_id"], "manifest run mismatch")
    rows = manifest["objects"]
    require(isinstance(rows, list), "manifest objects must be a list")
    symbols = [str(symbol) for symbol in protocol["universe"]["symbols"]]
    months = [
        *[str(month) for month in protocol["window"]["development_months"]],
        *[str(month) for month in protocol["window"]["holdout_months"]],
    ]
    development_months = {str(month) for month in protocol["window"]["development_months"]}
    holdout_months = {str(month) for month in protocol["window"]["holdout_months"]}
    expected_keys = {
        (dataset, symbol, month)
        for dataset in ("klines", "fundingRate")
        for symbol in symbols
        for month in months
    }
    observed_keys = {(str(row["dataset"]), str(row["symbol"]), str(row["month"])) for row in rows}
    require(observed_keys == expected_keys, "manifest coverage mismatch")
    require(len(rows) == len(expected_keys), "manifest contains duplicate keys")
    root_url = str(protocol["sources"]["root"])
    verified = 0
    unopened = 0
    not_acquired = 0
    verified_unmeasured = 0
    for row in rows:
        path = expected_raw_path(raw_root, row)
        month = str(row["month"])
        expected_phase = (
            "PREHISTORY_OR_DEVELOPMENT" if month in development_months else "SEALED_HOLDOUT"
        )
        require(month in development_months | holdout_months, "manifest month outside freeze")
        require(row["phase"] == expected_phase, "manifest phase/month mismatch")
        if expected_phase == "PREHISTORY_OR_DEVELOPMENT":
            require(
                row["state"] != "NOT_REQUESTED_UNOPENED",
                "development source cannot masquerade as unopened holdout",
            )
        elif development.get("all_development_gates_pass", False):
            require(
                row["state"] != "NOT_REQUESTED_UNOPENED",
                "authorized holdout open contains never-requested row",
            )
        else:
            require(
                row["state"] == "NOT_REQUESTED_UNOPENED",
                "holdout source was touched before development pass",
            )
        expected_url = f"{root_url}/{path.relative_to(raw_root / 'raw').as_posix()}"
        require(row["url"] == expected_url, "manifest archive identity mismatch")
        require(row["checksum_url"] == f"{expected_url}.CHECKSUM", "bad checksum URL")
        if row["state"] in {
            "VERIFIED_BODY_PRESENT",
            "VERIFIED_BODY_PRESENT_UNMEASURED",
        }:
            verified += 1
            verified_unmeasured += row["state"] == "VERIFIED_BODY_PRESENT_UNMEASURED"
            require(path.is_file(), f"verified source body absent: {path}")
            require(
                row["raw_relative_path"] == str(path.relative_to(raw_root)),
                "raw-relative path mismatch",
            )
            digest = sha256_file(path)
            require(digest == row["actual_sha256"], f"actual source hash mismatch: {path}")
            require(digest == row["publisher_sha256"], f"publisher hash mismatch: {path}")
            require(path.stat().st_size == int(row["bytes"]), f"source size mismatch: {path}")
            sidecar = path.with_name(f"{path.name}.CHECKSUM")
            require(sidecar.is_file(), f"source sidecar absent: {sidecar}")
            require(
                sha256_file(sidecar) == row["sidecar_sha256"],
                f"sidecar hash mismatch: {sidecar}",
            )
            sidecar_text = sidecar.read_text(encoding="utf-8")
            sidecar_lines = [line for line in sidecar_text.splitlines() if line.strip()]
            require(len(sidecar_lines) == 1, f"sidecar must contain one record: {path}")
            sidecar_match = re.fullmatch(
                r"\s*([0-9a-fA-F]{64})\s+\*?([^/\s]+)\s*", sidecar_lines[0]
            )
            require(sidecar_match is not None, f"malformed sidecar: {path}")
            if sidecar_match is None:
                raise AssertionError("unreachable")
            require(sidecar_match.group(1).lower() == digest, f"sidecar digest mismatch: {path}")
            require(sidecar_match.group(2) == path.name, f"sidecar filename mismatch: {path}")
            if row["state"] == "VERIFIED_BODY_PRESENT":
                require(row.get("zip_opened") is True, f"verified body was not parsed: {path}")
                require(
                    isinstance(row.get("zip_member"), str)
                    and str(row["zip_member"]).endswith(".csv"),
                    f"missing safe ZIP member disclosure: {path}",
                )
            else:
                require(
                    row.get("zip_opened") is not True, f"parse-failed body marked opened: {path}"
                )
        elif row["state"] in {
            "NOT_REQUESTED_UNOPENED",
            "NOT_ACQUIRED_TERMINAL_FAILURE",
        }:
            unopened += row["state"] == "NOT_REQUESTED_UNOPENED"
            not_acquired += row["state"] == "NOT_ACQUIRED_TERMINAL_FAILURE"
            require(not path.exists(), f"unopened holdout body exists: {path}")
            require(
                not path.with_name(f"{path.name}.CHECKSUM").exists(),
                f"unopened holdout sidecar exists: {path}",
            )
            forbidden_fields = {
                "publisher_sha256",
                "actual_sha256",
                "bytes",
                "raw_relative_path",
                "zip_member",
                "zip_opened",
            }
            require(
                not forbidden_fields.intersection(row),
                f"absent row contains body-derived fields: {path}",
            )
        else:
            raise ValueError(f"unknown source state: {row['state']}")
    return {
        "objects": len(rows),
        "verified": verified,
        "unopened": unopened,
        "not_acquired": not_acquired,
        "verified_unmeasured": verified_unmeasured,
    }


def verify_development_statistics(protocol: JsonObject, development: JsonObject) -> JsonObject:
    require(development["schema"] == "s1u.development.v1", "bad development schema")
    if development.get("measurement_state") == "UNMEASURED":
        require(development["all_development_gates_pass"] is False, "unmeasured cannot pass")
        return {"measurement_state": "UNMEASURED"}
    trials = development["trials"]
    require(isinstance(trials, dict) and len(trials) == 9, "expected nine trials")
    days = development["window"]["calendar_days"]
    require(len(days) == 274, "development must contain 274 complete UTC days")
    require(
        development["window"]["start"] == protocol["window"]["study_start"],
        "development start metadata mismatch",
    )
    require(
        development["window"]["end_exclusive"] == protocol["window"]["development_end"],
        "development end metadata mismatch",
    )
    stats = protocol["statistics"]
    require(development["trial_count"] == len(trials), "development trial count mismatch")
    require(
        development["selection_rule"] == stats["selection_metric"],
        "development selection rule mismatch",
    )
    require(
        development["selection_tie_break"] == stats["selection_tie_break"],
        "development selection tie-break mismatch",
    )
    bootstrap = stats["bootstrap"]
    samples = circular_block_indices(
        len(days),
        int(bootstrap["replicates"]),
        int(bootstrap["circular_block_days"]),
        int(bootstrap["seed"]),
    )
    raw_p: dict[str, float] = {}
    series_by_trial: dict[str, Sequence[float]] = {}
    for trial_id, summary in sorted(trials.items()):
        daily = summary["complete_daily_pnl_usd"]
        require(set(daily) == {"base", "stress", "severe"}, f"cost family mismatch: {trial_id}")
        for scenario, values in daily.items():
            require(len(values) == len(days), f"incomplete calendar: {trial_id}/{scenario}")
            total = math.fsum(float(value) for value in values)
            require(
                close(total, float(summary["net_usd_per_1000"][scenario])),
                f"net mismatch: {trial_id}/{scenario}",
            )
        base = [float(value) for value in daily["base"]]
        series_by_trial[trial_id] = base
        distribution = bootstrap_totals(base, samples)
        require(
            close(
                quantile(distribution, 0.025),
                float(summary["base_interval_95_usd_per_1000"]["lower"]),
            ),
            f"lower interval mismatch: {trial_id}",
        )
        require(
            close(
                quantile(distribution, 0.975),
                float(summary["base_interval_95_usd_per_1000"]["upper"]),
            ),
            f"upper interval mismatch: {trial_id}",
        )
        require(
            close(
                quantile(distribution, 0.05 / len(trials)),
                float(summary["base_familywise_bonferroni_lower_usd_per_1000"]),
            ),
            f"familywise lower mismatch: {trial_id}",
        )
        raw_p[trial_id] = centered_block_p(base, samples)
        require(
            close(
                maximum_drawdown_fraction(
                    base, float(protocol["allocation"]["cohort_notional_usd"])
                ),
                float(summary["max_drawdown_fraction_of_1000"]),
            ),
            f"drawdown mismatch: {trial_id}",
        )
        capacity = [float(value) for value in summary["public_capacity_proxy_observations_usd"]]
        capacity_summary = summary["public_capacity_proxy_usd"]
        require(
            len(capacity) == int(capacity_summary["observations"]),
            f"capacity count mismatch: {trial_id}",
        )
        if capacity:
            require(
                close(min(capacity), float(capacity_summary["minimum"])),
                f"capacity minimum mismatch: {trial_id}",
            )
            require(
                close(quantile(capacity, 0.05), float(capacity_summary["p05"])),
                f"capacity p05 mismatch: {trial_id}",
            )
            require(
                close(statistics.median(capacity), float(capacity_summary["median"])),
                f"capacity median mismatch: {trial_id}",
            )
        else:
            require(
                capacity_summary["minimum"] is None
                and capacity_summary["p05"] is None
                and capacity_summary["median"] is None,
                f"empty capacity summary must remain null: {trial_id}",
            )
    adjusted = holm_adjust(raw_p)
    for trial_id, summary in trials.items():
        require(
            close(raw_p[trial_id], float(summary["centered_block_one_sided_p"])),
            f"raw p mismatch: {trial_id}",
        )
        require(
            close(adjusted[trial_id], float(summary["holm_adjusted_p"])),
            f"Holm p mismatch: {trial_id}",
        )
    white_p = white_reality_check_p(series_by_trial, samples)
    require(
        close(white_p, float(development["white_reality_check_p"])),
        "White Reality Check mismatch",
    )
    pbo = cscv_pbo(series_by_trial, int(stats["pbo"]["chronological_blocks"]))
    require(pbo["splits"] == 924, "PBO must contain all 924 splits")
    stored_pbo = development["pbo"]
    for key in ("method", "blocks", "train_blocks", "splits"):
        require(pbo[key] == stored_pbo[key], f"PBO metadata mismatch: {key}")
    require(close(float(pbo["pbo"]), float(stored_pbo["pbo"])), "PBO mismatch")
    require(
        close(
            float(pbo["median_logit_oos_rank"]),
            float(stored_pbo["median_logit_oos_rank"]),
        ),
        "PBO median logit mismatch",
    )
    champion = min(
        trials,
        key=lambda trial_id: (
            -float(trials[trial_id]["net_usd_per_1000"]["base"]),
            trial_id,
        ),
    )
    require(champion == development["champion_trial_id"], "champion selection mismatch")
    verify_development_gates(protocol, development)
    return {
        "measurement_state": "MEASURED",
        "trials": len(trials),
        "days": len(days),
        "bootstrap_replicates": len(samples),
        "pbo_splits": pbo["splits"],
    }


def verify_development_gates(protocol: JsonObject, development: JsonObject) -> None:
    champion = development["trials"][development["champion_trial_id"]]
    config = protocol["development_gates"]
    symbols = [str(symbol) for symbol in protocol["universe"]["symbols"]]
    p05 = champion["public_capacity_proxy_usd"]["p05"]
    expected = {
        "candidate_common_settlements_min": (
            int(champion["candidate_common_settlements"])
            >= int(config["candidate_common_settlements_min"])
        ),
        "active_cohorts_min": (
            int(champion["active_cohorts"]) >= int(config["active_cohorts_min"])
        ),
        "active_weeks_min": (int(champion["active_weeks"]) >= int(config["active_weeks_min"])),
        "each_symbol_long_min": all(
            int(champion["long_counts"].get(symbol, 0)) >= int(config["each_symbol_long_min"])
            for symbol in symbols
        ),
        "each_symbol_short_min": all(
            int(champion["short_counts"].get(symbol, 0)) >= int(config["each_symbol_short_min"])
            for symbol in symbols
        ),
        "base_net_positive": (
            float(champion["net_usd_per_1000"]["base"]) > float(config["base_net_usd_per_1000_gt"])
        ),
        "stress_net_positive": (
            float(champion["net_usd_per_1000"]["stress"])
            > float(config["stress_net_usd_per_1000_gt"])
        ),
        "pointwise_lower_bound_positive": (
            float(champion["base_interval_95_usd_per_1000"]["lower"])
            > float(config["pointwise_lower_bound_gt"])
        ),
        "familywise_lower_bound_positive": (
            float(champion["base_familywise_bonferroni_lower_usd_per_1000"])
            > float(config["familywise_lower_bound_gt"])
        ),
        "champion_holm_p": (
            float(champion["holm_adjusted_p"]) <= float(config["champion_holm_p_lte"])
        ),
        "white_reality_check_p": (
            float(development["white_reality_check_p"])
            <= float(config["white_reality_check_p_lte"])
        ),
        "pbo": float(development["pbo"]["pbo"]) <= float(config["pbo_lte"]),
        "max_drawdown": (
            float(champion["max_drawdown_fraction_of_1000"]) <= float(config["max_drawdown_lte"])
        ),
        "capacity_p05": (p05 is not None and float(p05) >= float(config["capacity_p05_usd_gte"])),
    }
    require(expected == development["development_gates"], "development gate mismatch")
    require(
        all(expected.values()) is development["all_development_gates_pass"],
        "development aggregate gate mismatch",
    )


def verify_holdout_statistics(
    protocol: JsonObject, development: JsonObject, result: JsonObject
) -> JsonObject:
    if not development.get("all_development_gates_pass", False):
        require(result.get("holdout") is None, "failed development contains holdout outcome")
        return {"state": "UNOPENED"}
    holdout = result.get("holdout")
    if holdout is None:
        require(
            result["verdict"] == protocol["verdict_law"]["measurement_failure_after_run_marker"],
            "missing holdout is not terminal UNMEASURED",
        )
        require(
            result["holdout_state"] == "OPENED_AFTER_DEVELOPMENT_PASS_TERMINAL_MEASUREMENT_FAILURE",
            "post-open terminal state mismatch",
        )
        return {"state": "OPENED_TERMINAL_UNMEASURED"}
    require(holdout["schema"] == "s1u.holdout.v1", "bad holdout schema")
    champion_id = str(development["champion_trial_id"])
    require(
        holdout["sealed_champion_trial_id"] == champion_id,
        "holdout champion differs from development seal",
    )
    trial = holdout["trial"]
    require(trial["trial_id"] == champion_id, "holdout trial identifier mismatch")
    days = holdout["window"]["calendar_days"]
    require(len(days) == 91, "holdout must contain 91 complete UTC days")
    require(
        holdout["window"]["start"] == protocol["window"]["development_end"],
        "holdout start metadata mismatch",
    )
    require(
        holdout["window"]["end_exclusive"] == protocol["window"]["holdout_end"],
        "holdout end metadata mismatch",
    )
    daily = trial["complete_daily_pnl_usd"]
    require(set(daily) == {"base", "stress", "severe"}, "holdout cost family mismatch")
    for scenario, values in daily.items():
        require(len(values) == len(days), f"holdout calendar mismatch: {scenario}")
        require(
            close(
                math.fsum(float(value) for value in values),
                float(trial["net_usd_per_1000"][scenario]),
            ),
            f"holdout net mismatch: {scenario}",
        )
    bootstrap = protocol["statistics"]["bootstrap"]
    samples = circular_block_indices(
        len(days),
        int(bootstrap["replicates"]),
        int(bootstrap["circular_block_days"]),
        int(bootstrap["seed"]) + 1,
    )
    base = [float(value) for value in daily["base"]]
    distribution = bootstrap_totals(base, samples)
    require(
        close(
            quantile(distribution, 0.025),
            float(trial["base_interval_95_usd_per_1000"]["lower"]),
        ),
        "holdout lower interval mismatch",
    )
    require(
        close(
            quantile(distribution, 0.975),
            float(trial["base_interval_95_usd_per_1000"]["upper"]),
        ),
        "holdout upper interval mismatch",
    )
    require(
        close(
            maximum_drawdown_fraction(base, float(protocol["allocation"]["cohort_notional_usd"])),
            float(trial["max_drawdown_fraction_of_1000"]),
        ),
        "holdout drawdown mismatch",
    )
    config = protocol["holdout_gates_if_opened"]
    expected_gates = {
        "active_cohorts_min": (int(trial["active_cohorts"]) >= int(config["active_cohorts_min"])),
        "base_net_positive": (
            float(trial["net_usd_per_1000"]["base"]) > float(config["base_net_usd_per_1000_gt"])
        ),
        "stress_net_positive": (
            float(trial["net_usd_per_1000"]["stress"]) > float(config["stress_net_usd_per_1000_gt"])
        ),
        "pointwise_lower_bound_positive": (
            float(trial["base_interval_95_usd_per_1000"]["lower"])
            > float(config["pointwise_lower_bound_gt"])
        ),
        "max_drawdown": (
            float(trial["max_drawdown_fraction_of_1000"]) <= float(config["max_drawdown_lte"])
        ),
    }
    require(expected_gates == holdout["gates"], "holdout gate mismatch")
    require(
        all(expected_gates.values()) is holdout["all_holdout_gates_pass"],
        "holdout aggregate gate mismatch",
    )
    expected_verdict = (
        protocol["verdict_law"]["public_proxy_pass"]
        if all(expected_gates.values())
        else "NO_GO_HOLDOUT"
    )
    require(result["verdict"] == expected_verdict, "holdout-derived verdict mismatch")
    return {
        "state": "VERIFIED",
        "days": len(days),
        "active_cohorts": trial["active_cohorts"],
        "all_gates_pass": holdout["all_holdout_gates_pass"],
    }


def expected_development_champion_report(development: JsonObject) -> JsonObject:
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


def verify_result(
    packet_dir: Path, protocol: JsonObject, marker: JsonObject, development: JsonObject
) -> JsonObject:
    result = read_json(packet_dir / "result.v1.json")
    require(result["schema"] == "s1u.result.v1", "bad result schema")
    require(result["strategy_id"] == "S-1U", "bad result strategy")
    require(result["freeze_commit"] == marker["freeze_commit"], "result freeze mismatch")
    require(result["one_run_id"] == marker["one_run_id"], "result run mismatch")
    require(
        result["capital_authority"] == protocol["verdict_law"]["capital_authority"],
        "capital law mismatch",
    )
    require(result["public_proxy_costs"] == protocol["costs"], "public cost report mismatch")
    require(all(value == 0 for value in result["effects"].values()), "nonzero effect claim")
    require(
        all(value == "UNKNOWN" for value in result["executable_limits"].values()),
        "executable unknown was promoted",
    )
    if development.get("measurement_state") == "UNMEASURED":
        require("development_champion" not in result, "unmeasured result claims a champion")
        require("development_gates" not in result, "unmeasured result claims development gates")
        require(
            result["verdict"] == protocol["verdict_law"]["measurement_failure_after_run_marker"],
            "unmeasured verdict mismatch",
        )
        require(result["holdout_state"].startswith("UNOPENED"), "failed run opened holdout")
    elif not development["all_development_gates_pass"]:
        require(
            result["development_champion"] == expected_development_champion_report(development),
            "result champion projection mismatch",
        )
        require(
            result["development_gates"] == development["development_gates"],
            "result development gate projection mismatch",
        )
        require(
            result["verdict"] == protocol["verdict_law"]["development_gate_failure"],
            "development no-go verdict mismatch",
        )
        require(
            result["holdout_state"] == "UNOPENED_DEVELOPMENT_GATES_FAILED",
            "development failure did not preserve holdout",
        )
        require(result["holdout"] is None, "holdout payload present after development failure")
        require(not (packet_dir / "holdout.v1.json").exists(), "unexpected holdout artifact")
    elif result["holdout"] is None:
        require(
            result["development_champion"] == expected_development_champion_report(development),
            "result champion projection mismatch",
        )
        require(
            result["development_gates"] == development["development_gates"],
            "result development gate projection mismatch",
        )
        require(
            result["verdict"] == protocol["verdict_law"]["measurement_failure_after_run_marker"],
            "post-open failure verdict mismatch",
        )
        require(
            result["holdout_state"] == "OPENED_AFTER_DEVELOPMENT_PASS_TERMINAL_MEASUREMENT_FAILURE",
            "post-open failure state mismatch",
        )
    else:
        require(
            result["development_champion"] == expected_development_champion_report(development),
            "result champion projection mismatch",
        )
        require(
            result["development_gates"] == development["development_gates"],
            "result development gate projection mismatch",
        )
        require(
            result["holdout_state"] == "OPENED_AFTER_ALL_DEVELOPMENT_GATES_PASSED",
            "passing development has wrong holdout state",
        )
    holdout_proof = verify_holdout_statistics(protocol, development, result)
    require(marker["terminal_verdict"] == result["verdict"], "marker verdict mismatch")
    require(marker["holdout_state"] == result["holdout_state"], "marker holdout mismatch")
    return {
        "verdict": result["verdict"],
        "capital_authority": result["capital_authority"],
        "holdout_state": result["holdout_state"],
        "holdout_proof": holdout_proof,
    }


def verify(packet_dir: Path, raw_root: Path) -> JsonObject:
    checksum_proof = verify_checksum_file(packet_dir)
    protocol = read_json(packet_dir / "protocol.v1.json")
    freeze = read_json(packet_dir / "freeze.v1.json")
    validate_freeze(packet_dir, freeze)
    marker = verify_run_marker(packet_dir, raw_root)
    git_proof = verify_git_freeze(packet_dir, marker, freeze, protocol)
    development = read_json(packet_dir / "development.v1.json")
    manifest_proof = verify_manifest(packet_dir, raw_root, protocol, marker, development)
    raw_outcome_proof = verify_raw_outcomes(packet_dir, raw_root, protocol, development)
    statistics_proof = verify_development_statistics(protocol, development)
    result_proof = verify_result(packet_dir, protocol, marker, development)
    if not development.get("all_development_gates_pass", False):
        require(
            manifest_proof["unopened"]
            == len(protocol["universe"]["symbols"]) * len(protocol["window"]["holdout_months"]) * 2,
            "failed development must leave every holdout object unopened",
        )
        require(
            not (raw_root / "HOLDOUT_OPENED.v1.json").exists(),
            "holdout-open marker exists after failed development",
        )
    else:
        require(
            manifest_proof["unopened"] == 0,
            "authorized holdout-open state contains never-requested holdout rows",
        )
        holdout_marker = read_json(raw_root / "HOLDOUT_OPENED.v1.json")
        require(holdout_marker["schema"] == "s1u.holdout-open.v1", "bad holdout-open schema")
        require(holdout_marker["one_run_id"] == marker["one_run_id"], "holdout run mismatch")
        require(
            holdout_marker["champion_trial_id"] == development["champion_trial_id"],
            "holdout champion marker mismatch",
        )
        require(
            holdout_marker["development_sha256"] == sha256_bytes(canonical_bytes(development)),
            "holdout marker does not bind development",
        )
    return {
        "schema": "s1u.verification.v1",
        "status": "PASS",
        "checksum_proof": checksum_proof,
        "git_proof": git_proof,
        "manifest_proof": manifest_proof,
        "raw_outcome_proof": raw_outcome_proof,
        "statistics_proof": statistics_proof,
        "result_proof": result_proof,
        "network_requests": 0,
    }


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--raw-root", type=Path, required=True)
    return result


def main(argv: Sequence[str] | None = None) -> int:
    arguments = parser().parse_args(argv)
    packet_dir = Path(__file__).resolve().parent
    proof = verify(packet_dir, arguments.raw_root.resolve())
    sys.stdout.write(sha256_bytes(canonical_bytes(proof)) + "\n")
    sys.stdout.write(f"{proof}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
