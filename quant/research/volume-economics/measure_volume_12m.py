#!/usr/bin/env python3
"""Temp-only Binance Spot Volume signal-core measurement.

This intentionally does not import or execute any repository public-tape proxy.
It reuses only the repository's pure validation bootstrap implementation.
Official archives and adjacent checksum sidecars are fetched directly from
data.binance.vision.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import os
import re
import shutil
import statistics
import subprocess
import sys
import urllib.request
import zipfile
from collections import defaultdict
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import polars as pl


PERIOD_START_S = int(datetime(2025, 7, 1, tzinfo=UTC).timestamp())
PERIOD_END_S = int(datetime(2026, 7, 1, tzinfo=UTC).timestamp())
HOLDOUT_START_S = int(datetime(2026, 4, 1, tzinfo=UTC).timestamp())
MONTHS = tuple(
    [(2025, month) for month in range(7, 13)]
    + [(2026, month) for month in range(1, 7)]
)
CARRY_SECONDS = 28 * 60 * 60
COHORT = (
    "BTCUSDT",
    "SOLUSDT",
    "DOGEUSDT",
    "NEARUSDT",
    "AAVEUSDT",
    "FETUSDT",
    "INJUSDT",
    "DOTUSDT",
)
ARCHIVE_ORIGIN = "https://data.binance.vision"
REPO_QUANT_SRC = "/Users/cosmosgeek/Desktop/cosmos-merge/quant/src"
REPO_HEAD = "5d5733a6c6748e7844df966535bc0d66708d3a7d"

# Exact detector defaults mapped from the pinned source.
BASELINE_MIN_SAMPLES = 30
BASELINE_WINDOW_MINUTES = 240
BASELINE_FLOOR_QUOTE_PER_SEC = 1.0
VOL_1S_MULTIPLE = 8.0
VOL_5S_MULTIPLE = 4.0
VOL_15S_MULTIPLE = 2.5
MIN_ACTIVATION_QUOTE_1S = 250.0
MIN_TRADE_COUNT_MULTIPLE = 3.0
MIN_TAKER_IMBALANCE = 0.12
MIN_FOLLOWTHROUGH_PCT = 0.15
MAX_EXTENDED_MOVE_PCT = 3.0
ONE_PRINT_MAX_TRADES = 2
MIN_TRADES_FOR_IMBALANCE = 8
VOLUME_NORMALIZED_BELOW_MULTIPLE = 1.5
MIN_QUOTE_VOLUME_24H_USD = 3_000_000.0
DEAD_MAX_QUOTE_PER_MIN = 500.0
TICK_SECONDS = 2
FOCUS_DWELL_SECONDS = 4
FOCUS_MAX_AGE_SECONDS = 15 * 60
SOURCE_COOLDOWN_SECONDS = 600
# The runtime applies the app config maxOrderNotionalUsd on every tick.  The
# frozen app default is $12; an actually deployed mutable value is unavailable
# to this offline replay.
SUGGESTED_NOTIONAL_USD = 12.0

# External research horizon. The frozen proposal source has no filled-position
# exit contract, so this must never be described as production policy.
EXIT_DECISION_HORIZON_SECONDS = 60

# User-pinned regular Spot fee and conservative explicit execution surrogate.
FEE_BPS_PER_SIDE = 10.0
BASE_SLIPPAGE_BPS_PER_SIDE = 5.0
PARTICIPATION_CAP = 0.01

COLUMNS = (
    "open_time",
    "open",
    "high",
    "low",
    "close",
    "base_volume",
    "close_time",
    "quote_volume",
    "trade_count",
    "taker_buy_base",
    "taker_buy_quote",
    "ignore",
)
SCHEMA = {
    "open_time": pl.Int64,
    "open": pl.Float64,
    "high": pl.Float64,
    "low": pl.Float64,
    "close": pl.Float64,
    "base_volume": pl.Float64,
    "close_time": pl.Int64,
    "quote_volume": pl.Float64,
    "trade_count": pl.Int64,
    "taker_buy_base": pl.Float64,
    "taker_buy_quote": pl.Float64,
    "ignore": pl.Float64,
}
CHECKSUM_RE = re.compile(r"^([0-9a-f]{64})  ([A-Za-z0-9_.-]+)\n?$")


@dataclass(frozen=True)
class Event:
    symbol: str
    focus_session_id: int
    event_dedup: str
    focus_enter_s: int
    proposal_s: int
    entry_s: int
    exit_signal_s: int
    exit_fill_s: int
    direction: str
    entry_open: float
    exit_open: float
    pre_entry_quote_1s: float
    m1: float
    m5: float
    m15: float
    tc5: float
    taker_ratio_15s: float
    move_15s_pct: float
    move_5m_pct: float
    baseline_quote_per_min: float
    quote_volume_24h: float
    exit_reason: str


@dataclass
class DetectorFocusState:
    eligible: bool = False
    trigger_first_s: int | None = None
    focused: bool = False
    focus_open_s: int | None = None
    focus_session_id: int = 0
    event_emitted: bool = False
    cooldown_until_s: int = 0
    pending_housekeeping_s: int | None = None


@dataclass
class LifecycleCounters:
    eligibility_resets: int = 0
    focus_sessions_opened: int = 0
    external_events_emitted: int = 0
    hard_reject_cooldowns: int = 0
    aged_soft_reject_cooldowns: int = 0
    focused_ignore_cooldowns: int = 0
    focus_max_age_cooldowns: int = 0


@dataclass(frozen=True)
class Transition:
    sequence: int
    symbol: str
    decision_s: int
    kind: str
    focus_session_id: int
    detail: str
    cooldown_until_s: int


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def fetch(url: str, output: Path) -> None:
    if output.exists():
        return
    temp = output.with_suffix(output.suffix + ".part")
    request = urllib.request.Request(url, headers={"User-Agent": "volume12m-public-research/1"})
    with urllib.request.urlopen(request, timeout=120) as response, temp.open("wb") as target:
        shutil.copyfileobj(response, target, length=1024 * 1024)
    os.replace(temp, output)


def verify_archive(zip_path: Path, sidecar_path: Path) -> dict[str, object]:
    sidecar_text = sidecar_path.read_text(encoding="ascii")
    match = CHECKSUM_RE.fullmatch(sidecar_text)
    if match is None:
        raise RuntimeError(f"invalid checksum sidecar: {sidecar_path}")
    expected, filename = match.groups()
    if filename != zip_path.name:
        raise RuntimeError(f"checksum filename mismatch: {filename} != {zip_path.name}")
    actual = sha256_file(zip_path)
    if actual != expected:
        raise RuntimeError(f"checksum mismatch for {zip_path}")
    with zipfile.ZipFile(zip_path) as archive:
        members = archive.infolist()
        if len(members) != 1 or members[0].is_dir():
            raise RuntimeError(f"archive must contain one CSV member: {zip_path}")
        member = members[0]
        if member.filename != zip_path.name.removesuffix(".zip") + ".csv":
            raise RuntimeError(f"unexpected member name: {member.filename}")
    return {
        "archive": zip_path.name,
        "archiveSha256": actual,
        "compressedBytes": zip_path.stat().st_size,
        "member": member.filename,
        "memberBytes": member.file_size,
        "sidecarSha256": sha256_file(sidecar_path),
    }


def monthly_url(symbol: str, year: int, month: int) -> str:
    name = f"{symbol}-1s-{year:04d}-{month:02d}.zip"
    return f"{ARCHIVE_ORIGIN}/data/spot/monthly/klines/{symbol}/1s/{name}"


def daily_url(symbol: str, day: str) -> str:
    name = f"{symbol}-1s-{day}.zip"
    return f"{ARCHIVE_ORIGIN}/data/spot/daily/klines/{symbol}/1s/{name}"


def ensure_url(url: str, raw_dir: Path, manifest: list[dict[str, object]]) -> Path:
    name = url.rsplit("/", 1)[-1]
    zip_path = raw_dir / name
    sidecar_path = raw_dir / f"{name}.CHECKSUM"
    fetch(url, zip_path)
    fetch(f"{url}.CHECKSUM", sidecar_path)
    record = verify_archive(zip_path, sidecar_path)
    record["url"] = url
    record["checksumUrl"] = f"{url}.CHECKSUM"
    manifest.append(record)
    return zip_path


def read_archive(path: Path) -> dict[str, np.ndarray]:
    with zipfile.ZipFile(path) as archive:
        member = archive.infolist()[0]
        with archive.open(member) as handle:
            frame = pl.read_csv(
                handle,
                has_header=False,
                schema=SCHEMA,
                infer_schema=False,
            ).select(
                [
                    "open_time",
                    "open",
                    "high",
                    "low",
                    "close",
                    "quote_volume",
                    "trade_count",
                    "taker_buy_quote",
                ]
            )
    return {
        "ts": (frame["open_time"].to_numpy() // 1_000_000).astype(np.int64, copy=False),
        "open": frame["open"].to_numpy(),
        "high": frame["high"].to_numpy(),
        "low": frame["low"].to_numpy(),
        "close": frame["close"].to_numpy(),
        "q": frame["quote_volume"].to_numpy(),
        "n": frame["trade_count"].to_numpy().astype(np.float64),
        "tbq": frame["taker_buy_quote"].to_numpy(),
        "gap": np.zeros(frame.height, dtype=np.bool_),
    }


def concat_rows(left: dict[str, np.ndarray] | None, right: dict[str, np.ndarray]) -> dict[str, np.ndarray]:
    if left is None:
        return right
    return {key: np.concatenate((left[key], right[key])) for key in right}


def make_contiguous(
    rows: dict[str, np.ndarray],
) -> tuple[dict[str, np.ndarray], int, int, int]:
    ts = rows["ts"]
    if len(ts) == 0:
        raise RuntimeError("1s archive chronology is empty")
    raw_diff = np.diff(ts)
    out_of_order = int(np.sum(raw_diff < 0))
    duplicate_rows = 0
    if np.any(raw_diff <= 0):
        order = np.argsort(ts, kind="stable")
        sorted_rows = {key: value[order] for key, value in rows.items()}
        sorted_ts = sorted_rows["ts"]
        duplicated = np.r_[False, sorted_ts[1:] == sorted_ts[:-1]]
        duplicate_rows = int(duplicated.sum())
        if duplicate_rows:
            for index in np.flatnonzero(duplicated):
                prior = index - 1
                for key in ("open", "high", "low", "close", "q", "n", "tbq", "gap"):
                    if sorted_rows[key][index] != sorted_rows[key][prior]:
                        raise RuntimeError("conflicting duplicate 1s archive rows")
            keep = ~duplicated
            rows = {key: value[keep] for key, value in sorted_rows.items()}
            ts = rows["ts"]
        else:
            rows = sorted_rows
            ts = sorted_ts
        if np.any(np.diff(ts) <= 0):
            raise RuntimeError("1s archive chronology remains non-monotonic after canonicalization")
    gaps = int(np.sum(np.maximum(np.diff(ts) - 1, 0)))
    if gaps == 0:
        return rows, 0, duplicate_rows, out_of_order
    full_ts = np.arange(int(ts[0]), int(ts[-1]) + 1, dtype=np.int64)
    positions = (ts - ts[0]).astype(np.int64)
    present = np.zeros(len(full_ts), dtype=np.bool_)
    present[positions] = True
    prior_position = np.maximum.accumulate(
        np.where(present, np.arange(len(full_ts), dtype=np.int64), -1)
    )
    if prior_position[0] < 0:
        raise RuntimeError("contiguous reindex has no initial observation")
    output: dict[str, np.ndarray] = {"ts": full_ts}
    close_seed = np.empty(len(full_ts), dtype=np.float64)
    close_seed[positions] = rows["close"]
    carry_close = close_seed[prior_position]
    for key in ("open", "high", "low", "close"):
        values = carry_close.copy()
        values[positions] = rows[key]
        output[key] = values
    for key in ("q", "n", "tbq"):
        values = np.zeros(len(full_ts), dtype=np.float64)
        values[positions] = rows[key]
        output[key] = values
    gap = ~present
    gap[positions] |= rows["gap"]
    output["gap"] = gap
    return output, gaps, duplicate_rows, out_of_order


def rolling_sum(values: np.ndarray, window: int) -> np.ndarray:
    cumulative = np.concatenate((np.array([0.0]), np.cumsum(values, dtype=np.float64)))
    output = cumulative[1:].copy()
    output[window:] = cumulative[window + 1 :] - cumulative[1:-window]
    return output


def prior_rolling_sum(values: np.ndarray, window: int) -> np.ndarray:
    cumulative = np.concatenate((np.array([0.0]), np.cumsum(values, dtype=np.float64)))
    result = np.zeros(len(values), dtype=np.float64)
    positions = np.arange(len(values))
    starts = np.maximum(0, positions - window)
    result[:] = cumulative[positions] - cumulative[starts]
    return result


def prior_rolling_median(values: np.ndarray, window: int, minimum: int) -> tuple[np.ndarray, np.ndarray]:
    result = np.full(len(values), np.nan, dtype=np.float64)
    counts = np.minimum(np.arange(len(values)), window)
    for index in range(minimum, min(window, len(values))):
        result[index] = float(np.median(values[:index]))
    if len(values) > window:
        windows = np.lib.stride_tricks.sliding_window_view(values, window)
        # windows[k] is values[k:k+window], used by minute k+window.
        result[window:] = np.median(windows[:-1] if len(windows) == len(values) - window + 1 else windows, axis=1)[: len(values) - window]
    return result, counts


def seeded_eligible_prior_rolling_median(
    values: np.ndarray,
    eligible: np.ndarray,
    window: int,
    minimum: int,
    seed_minutes: int = 60,
) -> tuple[np.ndarray, np.ndarray]:
    """Prior-only median with the runtime's re-entry seed contract.

    On each eligible run the runtime fetches and seeds the last 60 completed
    Spot 1m candles, then grows the same bounded ring with new minutes.  This
    replay assumes that public REST seed succeeds immediately; latency/failure
    is disclosed as unknown.
    """
    result = np.full(len(values), np.nan, dtype=np.float64)
    counts = np.zeros(len(values), dtype=np.int64)
    changes = np.flatnonzero(np.r_[True, eligible[1:] != eligible[:-1], True])
    for start, end in zip(changes[:-1], changes[1:], strict=True):
        if not bool(eligible[start]):
            continue
        seeded_start = max(0, start - seed_minutes)
        run_result, run_counts = prior_rolling_median(
            values[seeded_start:end], window, minimum
        )
        offset = start - seeded_start
        result[start:end] = run_result[offset:]
        counts[start:end] = run_counts[offset:]
    return result, counts


def aggregate_minutes(rows: dict[str, np.ndarray]) -> dict[str, np.ndarray]:
    ts = rows["ts"]
    if len(ts) == 0 or np.any(np.diff(ts) != 1):
        raise RuntimeError("1s archive chronology is not complete and contiguous")
    minute = ts // 60
    starts = np.flatnonzero(np.r_[True, minute[1:] != minute[:-1]])
    minute_ids = minute[starts]
    q = np.add.reduceat(rows["q"], starts)
    n = np.add.reduceat(rows["n"], starts)
    return {"minute": minute_ids, "q": q, "n": n}


def derive_features(
    rows: dict[str, np.ndarray],
    tick_phase: int,
) -> dict[str, np.ndarray]:
    ts = rows["ts"]
    count = len(ts)
    if count < 86_500:
        raise RuntimeError("chunk lacks the required warmup")
    minute_rows = aggregate_minutes(rows)
    q24 = prior_rolling_sum(minute_rows["q"], 1_440)
    q24_valid_counts = np.minimum(
        np.arange(len(minute_rows["q"]), dtype=np.int64),
        1_440,
    )
    minute_refresh_bucket = minute_rows["minute"] // 15
    minute_refresh_starts = np.flatnonzero(
        np.r_[True, minute_refresh_bucket[1:] != minute_refresh_bucket[:-1]]
    )
    quote24_minute = np.repeat(
        q24[minute_refresh_starts],
        np.diff(np.r_[minute_refresh_starts, len(q24)]),
    )
    quote24_valid_minute = np.repeat(
        q24_valid_counts[minute_refresh_starts] >= 1_440,
        np.diff(np.r_[minute_refresh_starts, len(q24)]),
    )
    eligible_minute = (
        quote24_valid_minute
        & (quote24_minute >= MIN_QUOTE_VOLUME_24H_USD)
    )
    baseline_q, baseline_counts = seeded_eligible_prior_rolling_median(
        minute_rows["q"],
        eligible_minute,
        BASELINE_WINDOW_MINUTES,
        BASELINE_MIN_SAMPLES,
    )
    baseline_n, _ = seeded_eligible_prior_rolling_median(
        minute_rows["n"],
        eligible_minute,
        BASELINE_WINDOW_MINUTES,
        BASELINE_MIN_SAMPLES,
    )

    minute_index = np.searchsorted(minute_rows["minute"], ts // 60)
    q_med = baseline_q[minute_index]
    n_med = baseline_n[minute_index]
    sample_count = baseline_counts[minute_index]
    quote24 = quote24_minute[minute_index]
    eligible = eligible_minute[minute_index]
    quote_norm = np.maximum(q_med, BASELINE_FLOOR_QUOTE_PER_SEC * 60.0) / 60.0
    trade_norm = np.maximum(n_med, 0.5) / 60.0
    decision_ts = ts + 1

    # Fine live windows are not seeded by warmBaselines. Universe removal drops
    # them, so observations from ineligible seconds cannot leak across re-entry.
    q1 = np.where(eligible, rows["q"], 0.0)
    observed_n = np.where(eligible, rows["n"], 0.0)
    observed_tbq = np.where(eligible, rows["tbq"], 0.0)
    q5 = rolling_sum(q1, 5)
    q15 = rolling_sum(q1, 15)
    q60 = rolling_sum(q1, 60)
    n5 = rolling_sum(observed_n, 5)
    n15 = rolling_sum(observed_n, 15)
    tbq15 = rolling_sum(observed_tbq, 15)
    m1 = q1 / quote_norm
    m5 = q5 / (quote_norm * 5.0)
    m15 = q15 / (quote_norm * 15.0)
    m60 = q60 / (quote_norm * 60.0)
    tc5 = n5 / (trade_norm * 5.0)
    taker15 = np.divide(tbq15, q15, out=np.full(count, np.nan), where=q15 > 0)

    positions_zero = np.arange(count, dtype=np.int64)
    last_ineligible_index = np.maximum.accumulate(
        np.where(~eligible, positions_zero, -1)
    )
    eligible_run_start_index = np.where(
        eligible,
        last_ineligible_index + 1,
        positions_zero,
    )
    nominal_15s_start_index = np.maximum(positions_zero - 14, 0)
    price_15s_start_index = np.maximum(
        nominal_15s_start_index,
        eligible_run_start_index,
    )
    move15 = (
        rows["close"] / rows["open"][price_15s_start_index] - 1.0
    ) * 100.0
    aligned_start_ts = (ts // 60 - 4) * 60
    aligned_start_index = np.searchsorted(ts, aligned_start_ts)
    aligned_start_index = np.clip(aligned_start_index, 0, count - 1)
    move5m = (
        rows["close"] / rows["open"][aligned_start_index] - 1.0
    ) * 100.0
    gap_cumulative = np.concatenate(
        (np.array([0], dtype=np.int64), np.cumsum(rows["gap"], dtype=np.int64))
    )
    gap5m = (
        gap_cumulative[positions_zero + 1]
        - gap_cumulative[aligned_start_index]
    )

    ready = eligible & (sample_count >= BASELINE_MIN_SAMPLES)
    hot = ready & (m1 >= VOL_1S_MULTIPLE) & (q1 >= MIN_ACTIVATION_QUOTE_1S)
    tick_mask = decision_ts % TICK_SECONDS == tick_phase
    reset = (~hot) & (m60 < VOLUME_NORMALIZED_BELOW_MULTIPLE)

    direction = np.where(taker15 >= 0.5 + MIN_TAKER_IMBALANCE, 1, np.where(
        taker15 <= 0.5 - MIN_TAKER_IMBALANCE, -1, 0
    ))
    signed_move = direction * move15
    return {
        "tick_mask": tick_mask,
        "eligible": eligible,
        "ready": ready,
        "baseline_samples": sample_count,
        "quote24_valid": quote24_valid_minute[minute_index],
        "hot": hot,
        "reset": reset,
        "m60": m60,
        "n5": n5,
        "n15": n15,
        "signed_move": signed_move,
        "gap5m": gap5m,
        "q1": q1,
        "q5": q5,
        "direction": direction,
        "m1": m1,
        "m5": m5,
        "m15": m15,
        "tc5": tc5,
        "taker15": taker15,
        "move15": move15,
        "move5m": move5m,
        "q_med": q_med,
        "quote24": quote24,
    }


def exit_for(
    rows: dict[str, np.ndarray], proposal_index: int
) -> tuple[int, int, str] | None:
    # Bar t is fully known only at t+1. The proposal is recorded at t+1 and a
    # conservative one-second decision latency fills at the t+2 open.
    entry_index = proposal_index + 2
    final_signal_index = entry_index + EXIT_DECISION_HORIZON_SECONDS
    final_fill_index = final_signal_index + 1
    if final_fill_index >= len(rows["ts"]):
        return None
    return (
        final_signal_index,
        final_fill_index,
        "EXTERNAL_EXIT_DECISION_60S_PLUS_1S_FILL",
    )


def extract_events(
    symbol: str,
    rows: dict[str, np.ndarray],
    features: dict[str, np.ndarray],
    state: DetectorFocusState,
    counters: LifecycleCounters,
    transitions: list[Transition],
    evaluation_start_s: int,
    evaluation_end_s: int,
) -> list[Event]:
    events: list[Event] = []
    indices = np.flatnonzero(
        features["tick_mask"]
        & (rows["ts"] >= evaluation_start_s)
        & (rows["ts"] < evaluation_end_s)
    )

    def reset_focus() -> None:
        state.focused = False
        state.focus_open_s = None
        state.event_emitted = False

    def record(
        decision_s: int,
        kind: str,
        detail: str,
        cooldown_until_s: int = 0,
    ) -> None:
        transitions.append(
            Transition(
                sequence=len(transitions) + 1,
                symbol=symbol,
                decision_s=decision_s,
                kind=kind,
                focus_session_id=state.focus_session_id,
                detail=detail,
                cooldown_until_s=cooldown_until_s,
            )
        )

    def start_cooldown(decision_s: int, kind: str, reason: str) -> None:
        if state.focused:
            record(decision_s, "FOCUS_CLOSE", reason)
        reset_focus()
        state.cooldown_until_s = decision_s + SOURCE_COOLDOWN_SECONDS
        record(
            decision_s,
            "COOLDOWN_START",
            reason,
            state.cooldown_until_s,
        )
        if kind == "hard":
            counters.hard_reject_cooldowns += 1
        elif kind == "soft":
            counters.aged_soft_reject_cooldowns += 1
        else:
            counters.focused_ignore_cooldowns += 1

    def apply_pending_housekeeping() -> None:
        decision_s = state.pending_housekeeping_s
        state.pending_housekeeping_s = None
        if (
            decision_s is not None
            and state.focused
            and state.focus_open_s is not None
            and decision_s - state.focus_open_s > FOCUS_MAX_AGE_SECONDS
        ):
            record(decision_s, "FOCUS_CLOSE", "focus_max_age")
            reset_focus()
            state.cooldown_until_s = decision_s + SOURCE_COOLDOWN_SECONDS
            record(
                decision_s,
                "COOLDOWN_START",
                "focus_max_age",
                state.cooldown_until_s,
            )
            counters.focus_max_age_cooldowns += 1

    for index in indices:
        proposal_s = int(rows["ts"][index]) + 1
        # Source housekeeping follows the prior decision. Applying it at the
        # start of the next aligned tick preserves the observable ordering:
        # entered@0 survives 900, decision@902 runs, then cooldown lasts to1502.
        apply_pending_housekeeping()
        state.pending_housekeeping_s = proposal_s

        eligible = bool(features["eligible"][index])
        if not eligible:
            if (
                state.eligible
                or state.trigger_first_s is not None
                or state.focused
                or state.cooldown_until_s
            ):
                counters.eligibility_resets += 1
                if state.focused:
                    record(proposal_s, "FOCUS_CLOSE", "eligibility_reset")
                record(proposal_s, "ELIGIBILITY_RESET", "ineligible_refresh")
            state.eligible = False
            state.trigger_first_s = None
            reset_focus()
            state.cooldown_until_s = 0
            continue
        if not state.eligible:
            state.eligible = True
            state.trigger_first_s = None
            reset_focus()
            state.cooldown_until_s = 0
            record(
                proposal_s,
                "ELIGIBILITY_REENTRY",
                "assume_immediate_success_seeding_last_60_completed_1m_candles",
            )

        # The frozen timer path checks Focus cooldown before snapshotEx, so a
        # timer decision inside cooldown cannot mutate trigger age/state.
        # Eligibility reconciliation above remains an external reset.
        if proposal_s < state.cooldown_until_s:
            continue
        if state.cooldown_until_s:
            record(proposal_s, "COOLDOWN_END", "aligned_tick_at_or_after_until")
            state.cooldown_until_s = 0

        hot = bool(features["hot"][index])
        if hot:
            if state.trigger_first_s is None:
                state.trigger_first_s = proposal_s
        elif (
            state.trigger_first_s is not None
            and bool(features["reset"][index])
        ):
            state.trigger_first_s = None

        if not bool(features["ready"][index]):
            if float(features["q1"][index]) > DEAD_MAX_QUOTE_PER_MIN:
                start_cooldown(
                    proposal_s,
                    "hard",
                    "baseline_missing_with_raw_burst",
                )
            elif state.focused:
                start_cooldown(
                    proposal_s,
                    "ignore",
                    "focused_baseline_not_ready_ignore",
                )
            continue

        trigger_armed = state.trigger_first_s is not None
        m1 = float(features["m1"][index])
        m5 = float(features["m5"][index])
        m15 = float(features["m15"][index])
        q1 = float(features["q1"][index])
        q5 = float(features["q5"][index])
        m1_warm = m1 >= VOL_1S_MULTIPLE * 0.5 and q1 >= MIN_ACTIVATION_QUOTE_1S * 0.5
        m5_warm = m5 >= VOL_5S_MULTIPLE * 0.5 and q5 >= MIN_ACTIVATION_QUOTE_1S

        # Ignore closes focused state and starts source cooldown; watch retains
        # both candidate/focus state.
        if not hot and not trigger_armed:
            if not (m1_warm or m5_warm) and state.focused:
                start_cooldown(
                    proposal_s,
                    "ignore",
                    "focused_volume_normalized_ignore",
                )
            continue
        if m5 < VOL_5S_MULTIPLE or m15 < VOL_15S_MULTIPLE:
            continue

        # Historical book/depth and capped raw-tape gates are unavailable and
        # are explicitly assumed to pass.  Only reconstructable hard failures
        # mutate the modeled source cooldown.
        if (
            int(features["gap5m"][index]) > 0
            or abs(float(features["move5m"][index])) >= MAX_EXTENDED_MOVE_PCT
        ):
            start_cooldown(
                proposal_s,
                "hard",
                "gap_or_move_already_extended",
            )
            continue

        soft_failed = (
            float(features["n5"][index]) <= ONE_PRINT_MAX_TRADES
            or float(features["tc5"][index]) < MIN_TRADE_COUNT_MULTIPLE
            or float(features["n15"][index]) < MIN_TRADES_FOR_IMBALANCE
            or int(features["direction"][index]) == 0
            or float(features["signed_move"][index]) < MIN_FOLLOWTHROUGH_PCT
        )
        signal_age = (
            math.inf
            if state.trigger_first_s is None
            else proposal_s - state.trigger_first_s
        )
        if soft_failed:
            if signal_age >= 3:
                start_cooldown(
                    proposal_s,
                    "soft",
                    "aged_reconstructable_soft_gate_failure",
                )
            continue

        # First verified decision enters focus.  Any later verified decision at
        # least four seconds later is the first external proposal proxy for this
        # focus session.  Mark it emitted before participation filtering so a
        # failed $12/1% check cannot look ahead within the same session.
        if not state.focused:
            state.focused = True
            state.focus_open_s = proposal_s
            state.focus_session_id += 1
            state.event_emitted = False
            counters.focus_sessions_opened += 1
            record(proposal_s, "FOCUS_OPEN", "first_verified_cut")
            continue
        if (
            state.focus_open_s is None
            or proposal_s - state.focus_open_s < FOCUS_DWELL_SECONDS
            or state.event_emitted
        ):
            continue
        state.event_emitted = True
        counters.external_events_emitted += 1
        record(
            proposal_s,
            "FIRST_EXTERNAL_PROPOSAL",
            "dedup_consumed_before_participation",
        )

        if proposal_s < PERIOD_START_S or proposal_s >= PERIOD_END_S:
            continue
        exit_result = exit_for(rows, index)
        if exit_result is None:
            raise RuntimeError("lookahead tail missing for external fixed-horizon exit")
        signal_index, fill_index, reason = exit_result
        entry_index = index + 2
        events.append(
            Event(
                symbol=symbol,
                focus_session_id=state.focus_session_id,
                event_dedup="EXTERNAL_ONE_PER_FOCUS_SESSION",
                focus_enter_s=state.focus_open_s,
                proposal_s=proposal_s,
                entry_s=int(rows["ts"][entry_index]),
                exit_signal_s=int(rows["ts"][signal_index]),
                exit_fill_s=int(rows["ts"][fill_index]),
                direction="LONG" if features["direction"][index] > 0 else "SHORT_PREOWNED",
                entry_open=float(rows["open"][entry_index]),
                exit_open=float(rows["open"][fill_index]),
                pre_entry_quote_1s=float(rows["q"][index]),
                m1=float(features["m1"][index]),
                m5=float(features["m5"][index]),
                m15=float(features["m15"][index]),
                tc5=float(features["tc5"][index]),
                taker_ratio_15s=float(features["taker15"][index]),
                move_15s_pct=float(features["move15"][index]),
                move_5m_pct=float(features["move5m"][index]),
                baseline_quote_per_min=float(features["q_med"][index]),
                quote_volume_24h=float(features["quote24"][index]),
                exit_reason=reason,
            )
        )
    apply_pending_housekeeping()
    return events


def event_pnl(
    event: Event,
    slippage_bps: float,
    exit_decision_horizon_seconds: int = 60,
) -> float:
    # Holding sensitivity is calculated separately from stored path only for the
    # frozen 60-second path; shorter/longer horizons require rerunning extraction.
    if exit_decision_horizon_seconds != 60:
        raise ValueError("stored event supports the frozen 60-second path only")
    slip = slippage_bps / 10_000.0
    if event.direction == "LONG":
        entry = event.entry_open * (1.0 + slip)
        exit_price = event.exit_open * (1.0 - slip)
        gross = SUGGESTED_NOTIONAL_USD * (exit_price / entry - 1.0)
        exit_notional = SUGGESTED_NOTIONAL_USD * exit_price / entry
    else:
        entry = event.entry_open * (1.0 - slip)
        exit_price = event.exit_open * (1.0 + slip)
        gross = SUGGESTED_NOTIONAL_USD * (1.0 - exit_price / entry)
        exit_notional = SUGGESTED_NOTIONAL_USD * exit_price / entry
    fees = (FEE_BPS_PER_SIDE / 10_000.0) * (SUGGESTED_NOTIONAL_USD + exit_notional)
    return gross - fees


def apply_participation(events: list[Event]) -> tuple[list[Event], list[Event]]:
    accepted: list[Event] = []
    rejected: list[Event] = []
    for event in sorted(events, key=lambda item: (item.entry_s, item.symbol)):
        participation = (
            math.inf
            if event.pre_entry_quote_1s <= 0
            else SUGGESTED_NOTIONAL_USD / event.pre_entry_quote_1s
        )
        if participation > PARTICIPATION_CAP:
            rejected.append(event)
            continue
        accepted.append(event)
    return accepted, rejected


def bootstrap_daily(events: list[Event], slippage_bps: float) -> dict[str, object]:
    if REPO_QUANT_SRC not in sys.path:
        sys.path.insert(0, REPO_QUANT_SRC)
    from quant_edge.randomness import DeterministicRandom
    from quant_edge.validation.bootstrap import BootstrapSpecV1

    daily_pnl: dict[int, float] = defaultdict(float)
    daily_turnover: dict[int, float] = defaultdict(float)
    for event in events:
        day = (event.proposal_s - PERIOD_START_S) // 86_400
        daily_pnl[day] += event_pnl(event, slippage_bps)
        daily_turnover[day] += SUGGESTED_NOTIONAL_USD
    pnl = np.array([daily_pnl[day] for day in range(365)], dtype=np.float64)
    turnover = np.array([daily_turnover[day] for day in range(365)], dtype=np.float64)
    spec = BootstrapSpecV1(seed=20260728, block_length=7, replicates=2_000, coverage_per_myriad=9_500)
    rng = DeterministicRandom.from_seed(spec.seed)
    count = len(pnl)
    blocks_needed = -(-count // spec.block_length)
    replicates: list[float] = []
    for _ in range(spec.replicates):
        indices: list[int] = []
        for _ in range(blocks_needed):
            start = rng.next_u64() % count
            indices.extend((start + offset) % count for offset in range(spec.block_length))
        drawn = np.array(indices[:count], dtype=np.int64)
        denominator = float(turnover[drawn].sum())
        if denominator > 0:
            replicates.append(1_000.0 * float(pnl[drawn].sum()) / denominator)
    replicates.sort()
    alpha = (10_000 - spec.coverage_per_myriad) / 10_000.0
    lower_index = max(0, math.ceil((alpha / 2.0) * len(replicates)) - 1)
    upper_index = max(0, math.ceil((1.0 - alpha / 2.0) * len(replicates)) - 1)
    point = 1_000.0 * float(pnl.sum()) / float(turnover.sum()) if turnover.sum() > 0 else None
    return {
        "repositoryInfrastructure": [
            "quant_edge.validation.bootstrap.BootstrapSpecV1",
            "quant_edge.randomness.DeterministicRandom",
        ],
        "estimand": "net USD per 1,000 USD aggregate entry notional; daily PnL and entry notional resampled jointly",
        "spec": spec.as_mapping(),
        "status": "AVAILABLE" if replicates and point is not None else "INVALID",
        "reason": None if replicates and point is not None else "ZERO_TURNOVER",
        "pointNetUsdPer1000EntryNotional": point,
        "lowerNetUsdPer1000EntryNotional": replicates[lower_index] if replicates else None,
        "upperNetUsdPer1000EntryNotional": replicates[upper_index] if replicates else None,
    }


def summarize(events: list[Event], slippage_bps: float) -> dict[str, object]:
    pnls = np.array([event_pnl(event, slippage_bps) for event in events], dtype=np.float64)
    returns_bps = pnls / SUGGESTED_NOTIONAL_USD * 10_000.0 if len(pnls) else np.array([])
    participations = np.array(
        [
            SUGGESTED_NOTIONAL_USD / event.pre_entry_quote_1s
            if event.pre_entry_quote_1s > 0
            else math.inf
            for event in events
        ],
        dtype=np.float64,
    )
    research_mask = np.array([event.proposal_s < HOLDOUT_START_S for event in events], dtype=bool)
    temporal_split_mask = ~research_mask

    def segment(mask: np.ndarray) -> dict[str, object]:
        values = pnls[mask]
        turnover = float(mask.sum() * SUGGESTED_NOTIONAL_USD)
        aggregate = float(values.sum())
        return {
            "events": int(mask.sum()),
            "aggregatePnlAtEffectiveDefaultNotionalUsd": aggregate,
            "aggregateEntryNotionalUsd": turnover,
            "netUsdPer1000EntryNotional": (
                1_000.0 * aggregate / turnover if turnover > 0 else None
            ),
            "meanUsdPerEvent": float(values.mean()) if len(values) else None,
            "winRate": float((values > 0).mean()) if len(values) else None,
        }

    by_symbol: dict[str, dict[str, object]] = {}
    for symbol in COHORT:
        mask = np.array([event.symbol == symbol for event in events], dtype=bool)
        by_symbol[symbol] = segment(mask)
    turnover = float(len(events) * SUGGESTED_NOTIONAL_USD)
    aggregate = float(pnls.sum())
    return {
        "events": len(events),
        "aggregatePnlAtEffectiveDefaultNotionalUsd": aggregate,
        "aggregateEntryNotionalUsd": turnover,
        "netUsdPer1000EntryNotional": (
            1_000.0 * aggregate / turnover if turnover > 0 else None
        ),
        "meanNetBpsPerEvent": float(returns_bps.mean()) if len(returns_bps) else None,
        "medianNetBpsPerEvent": float(np.median(returns_bps)) if len(returns_bps) else None,
        "winRate": float((pnls > 0).mean()) if len(pnls) else None,
        "research": segment(research_mask),
        "temporalSplit": segment(temporal_split_mask),
        "bySymbol": by_symbol,
        "directions": {
            key: sum(event.direction == key for event in events)
            for key in ("LONG", "SHORT_PREOWNED")
        },
        "exitReasons": {
            key: sum(event.exit_reason == key for event in events)
            for key in sorted({event.exit_reason for event in events})
        },
        "participation": {
            "cap": PARTICIPATION_CAP,
            "median": float(np.median(participations)) if len(participations) else None,
            "p95": float(np.quantile(participations, 0.95)) if len(participations) else None,
            "maximum": float(np.max(participations)) if len(participations) else None,
        },
    }


def write_events(
    path: Path,
    events: list[Event],
    accepted: list[Event],
    slippage_bps: float,
) -> None:
    fields = list(Event.__dataclass_fields__) + [
        "participation_fraction_12usd",
        "participation_disposition",
        "net_pnl_usd_if_accepted",
        "split",
    ]
    accepted_keys = {
        (event.symbol, event.focus_session_id) for event in accepted
    }
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for event in events:
            row = asdict(event)
            participation = (
                math.inf
                if event.pre_entry_quote_1s <= 0
                else SUGGESTED_NOTIONAL_USD / event.pre_entry_quote_1s
            )
            accepted_event = (
                event.symbol, event.focus_session_id
            ) in accepted_keys
            row["participation_fraction_12usd"] = f"{participation:.12f}"
            row["participation_disposition"] = (
                "ACCEPTED_12USD_1PCT"
                if accepted_event
                else "REJECTED_12USD_1PCT"
            )
            row["net_pnl_usd_if_accepted"] = (
                f"{event_pnl(event, slippage_bps):.12f}"
                if accepted_event
                else ""
            )
            row["split"] = (
                "JUL_MAR_RESEARCH"
                if event.proposal_s < HOLDOUT_START_S
                else "APR_JUN_RETROSPECTIVE_SPLIT"
            )
            writer.writerow(row)


def write_transitions(path: Path, transitions: list[Transition]) -> None:
    fields = list(Transition.__dataclass_fields__)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for transition in transitions:
            writer.writerow(asdict(transition))


def validate_event_invariants(
    events: list[Event],
    accepted: list[Event],
    rejected: list[Event],
    tick_phase: int,
) -> dict[str, object]:
    violations: list[str] = []
    seen_sessions: set[tuple[str, int]] = set()
    focus_ages: list[int] = []
    accepted_keys = {
        (event.symbol, event.focus_session_id) for event in accepted
    }
    rejected_keys = {
        (event.symbol, event.focus_session_id) for event in rejected
    }
    for index, event in enumerate(events):
        key = (event.symbol, event.focus_session_id)
        if key in seen_sessions:
            violations.append(f"duplicate_focus_session:{index}")
        seen_sessions.add(key)
        age = event.proposal_s - event.focus_enter_s
        focus_ages.append(age)
        if event.event_dedup != "EXTERNAL_ONE_PER_FOCUS_SESSION":
            violations.append(f"dedup_label:{index}")
        if age < FOCUS_DWELL_SECONDS:
            violations.append(f"focus_dwell:{index}")
        if event.proposal_s % TICK_SECONDS != tick_phase:
            violations.append(f"tick_phase:{index}")
        if event.entry_s != event.proposal_s + 1:
            violations.append(f"entry_latency:{index}")
        if event.exit_signal_s != event.entry_s + EXIT_DECISION_HORIZON_SECONDS:
            violations.append(f"exit_horizon:{index}")
        if event.exit_fill_s != event.exit_signal_s + 1:
            violations.append(f"exit_fill_latency:{index}")
        participation = (
            math.inf
            if event.pre_entry_quote_1s <= 0
            else SUGGESTED_NOTIONAL_USD / event.pre_entry_quote_1s
        )
        if (key in accepted_keys) != (participation <= PARTICIPATION_CAP):
            violations.append(f"accepted_participation:{index}")
        if (key in rejected_keys) != (participation > PARTICIPATION_CAP):
            violations.append(f"rejected_participation:{index}")
    if len(accepted) + len(rejected) != len(events):
        violations.append("participation_reconciliation")
    if accepted_keys & rejected_keys:
        violations.append("participation_overlap")
    if violations:
        raise RuntimeError(
            "event invariant failure: " + ",".join(violations[:20])
        )
    return {
        "status": "PASS",
        "violations": 0,
        "uniqueExternalEventsPerFocusSession": len(seen_sessions),
        "minimumProposalFocusAgeSeconds": min(focus_ages) if focus_ages else None,
        "maximumProposalFocusAgeSeconds": max(focus_ages) if focus_ages else None,
        "proposalDecisionToEntrySeconds": 1,
        "entryToExitDecisionSeconds": EXIT_DECISION_HORIZON_SECONDS,
        "exitDecisionToFillSeconds": 1,
        "entryToExitFillExposureSeconds": EXIT_DECISION_HORIZON_SECONDS + 1,
        "participationOnlyFilter": True,
        "preParticipationEqualsAcceptedPlusRejected": True,
        "rejectedFirstEventCannotReenterSameFocus": True,
    }


def synthetic_boundary_preflight() -> dict[str, object]:
    """Prove why 28h is required even with source-mapped 60m re-entry seed."""
    start_s = int(datetime(2025, 6, 29, tzinfo=UTC).timestamp())
    quote_per_second = 3_020_000.0 / 86_400.0

    def constant_rows(seconds: int) -> dict[str, np.ndarray]:
        ts = np.arange(start_s, start_s + seconds, dtype=np.int64)
        price = np.full(seconds, 100.0, dtype=np.float64)
        return {
            "ts": ts,
            "open": price.copy(),
            "high": price.copy(),
            "low": price.copy(),
            "close": price.copy(),
            "q": np.full(seconds, quote_per_second, dtype=np.float64),
            "n": np.full(seconds, 2.0, dtype=np.float64),
            "tbq": np.full(seconds, quote_per_second * 0.6, dtype=np.float64),
            "gap": np.zeros(seconds, dtype=np.bool_),
        }

    short = derive_features(constant_rows(24 * 3_600 + 120), 0)
    full = derive_features(constant_rows(CARRY_SECONDS + 120), 0)
    jump_rows = constant_rows(CARRY_SECONDS + 120)
    jump_at = 24 * 3_600
    for key in ("open", "high", "low", "close"):
        jump_rows[key][:jump_at] = 50.0
        jump_rows[key][jump_at:] = 100.0
    jump = derive_features(jump_rows, 0)
    first_eligible = int(np.flatnonzero(jump["eligible"])[0])
    result = {
        "status": "PASS",
        "constantRolling24hQuoteUsd": 3_020_000.0,
        "short24hPlus120sBaselineSamples": int(short["baseline_samples"][-1]),
        "shortReadyViaSourceMapped60mSeed": bool(short["ready"][-1]),
        "full28hPlus120sBaselineSamples": int(full["baseline_samples"][-1]),
        "fullReady": bool(full["ready"][-1]),
        "fine15sMoveAtReentryPct": float(jump["move15"][first_eligible]),
        "coarse5mSeededMoveAtReentryPct": float(jump["move5m"][first_eligible]),
        "interpretation": "24h can only represent the re-entry seed; 28h preserves a full continuous prior-240m baseline with valid prior-24h eligibility cuts",
    }
    if not (
        result["shortReadyViaSourceMapped60mSeed"]
        and result["short24hPlus120sBaselineSamples"] < 240
        and result["fullReady"]
        and result["full28hPlus120sBaselineSamples"] == 240
        and abs(result["fine15sMoveAtReentryPct"]) < 1e-12
        and result["coarse5mSeededMoveAtReentryPct"] > 0
    ):
        raise RuntimeError("synthetic 28h eligibility/baseline preflight failed")
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workdir", type=Path, required=True)
    parser.add_argument("--tick-phase", type=int, choices=(0, 1), default=0)
    args = parser.parse_args()
    root = args.workdir.resolve()
    boundary_preflight = synthetic_boundary_preflight()
    raw_dir = root / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    manifest: list[dict[str, object]] = []
    all_events: list[Event] = []
    all_transitions: list[Transition] = []
    lifecycle_counters = LifecycleCounters()
    gap_seconds_by_symbol: dict[str, int] = defaultdict(int)
    duplicate_rows_by_symbol: dict[str, int] = defaultdict(int)
    out_of_order_rows_by_symbol: dict[str, int] = defaultdict(int)

    for symbol in COHORT:
        print(f"[{symbol}] downloading/verifying", flush=True)
        sources: list[Path] = [
            ensure_url(daily_url(symbol, "2025-06-29"), raw_dir, manifest),
            ensure_url(daily_url(symbol, "2025-06-30"), raw_dir, manifest),
        ]
        sources.extend(
            ensure_url(monthly_url(symbol, year, month), raw_dir, manifest)
            for year, month in MONTHS
        )
        sources.append(ensure_url(daily_url(symbol, "2026-07-01"), raw_dir, manifest))

        warmup = read_archive(sources[0])
        warmup, gap_seconds, duplicate_rows, out_of_order_rows = make_contiguous(warmup)
        gap_seconds_by_symbol[symbol] += gap_seconds
        duplicate_rows_by_symbol[symbol] += duplicate_rows
        out_of_order_rows_by_symbol[symbol] += out_of_order_rows
        carry: dict[str, np.ndarray] = {
            key: value[-CARRY_SECONDS:] for key, value in warmup.items()
        }
        lifecycle_state = DetectorFocusState()
        symbol_events: list[Event] = []
        # June 29 seeds the first 24h-valid eligibility cut; June 30 leaves a
        # full four-hour eligible baseline reserve before July 1. Each later
        # boundary retains 28h so all 240 prior baseline minutes have a valid
        # prior-24h eligibility observation. A short following prefix is used
        # solely for the external 61-second fill exposure.
        for source_index in range(1, len(sources) - 1):
            source = sources[source_index]
            print(f"[{symbol}] processing {source.name}", flush=True)
            current = read_archive(source)
            evaluation_start_s = (
                int(carry["ts"][0])
                if source_index == 1
                else int(np.min(current["ts"]))
            )
            evaluation_end_s = int(np.max(current["ts"])) + 1
            lookahead_full = read_archive(sources[source_index + 1])
            lookahead = {
                key: value[:120] for key, value in lookahead_full.items()
            }
            rows = concat_rows(carry, current)
            rows = concat_rows(rows, lookahead)
            rows, gap_seconds, duplicate_rows, out_of_order_rows = make_contiguous(rows)
            gap_seconds_by_symbol[symbol] += gap_seconds
            duplicate_rows_by_symbol[symbol] += duplicate_rows
            out_of_order_rows_by_symbol[symbol] += out_of_order_rows
            features = derive_features(rows, args.tick_phase)
            extracted = extract_events(
                symbol,
                rows,
                features,
                lifecycle_state,
                lifecycle_counters,
                all_transitions,
                evaluation_start_s,
                evaluation_end_s,
            )
            symbol_events.extend(extracted)
            current_mask = rows["ts"] < evaluation_end_s
            carry = {
                key: value[current_mask][-CARRY_SECONDS:]
                for key, value in rows.items()
            }
        print(f"[{symbol}] events={len(symbol_events)}", flush=True)
        all_events.extend(symbol_events)

    all_events.sort(key=lambda event: (event.proposal_s, event.symbol))
    all_transitions.sort(
        key=lambda transition: (
            transition.decision_s,
            transition.symbol,
            transition.sequence,
        )
    )
    accepted, participation_rejected_events = apply_participation(all_events)
    accepted.sort(key=lambda event: (event.proposal_s, event.symbol))
    event_invariants = validate_event_invariants(
        all_events,
        accepted,
        participation_rejected_events,
        args.tick_phase,
    )
    transition_counts: dict[str, int] = defaultdict(int)
    for transition in all_transitions:
        transition_counts[transition.kind] += 1
    period_proposal_transitions = {
        (
            transition.symbol,
            transition.focus_session_id,
            transition.decision_s,
        )
        for transition in all_transitions
        if (
            transition.kind == "FIRST_EXTERNAL_PROPOSAL"
            and PERIOD_START_S <= transition.decision_s < PERIOD_END_S
        )
    }
    event_identities = {
        (event.symbol, event.focus_session_id, event.proposal_s)
        for event in all_events
    }
    if period_proposal_transitions != event_identities:
        raise RuntimeError("transition ledger does not reconcile to period proposals")
    report = {
        "schema": "TEMP_VOLUME_12M_STATEFUL_CONDITIONAL_PROXY_V4",
        "resultClass": "CONDITIONAL_PROXY_ONLY",
        "generatedAt": datetime.now(UTC).isoformat(),
        "repositoryHead": REPO_HEAD,
        "frozenSourceDefaults": {
            "killSwitch": True,
            "allowedSymbols": [],
            "sourceNativeGrossEdgePct": None,
            "sourceNativeNetEdgePct": None,
            "sourceNativeEdgePer1000": None,
            "fillExitPnlPath": "NOT_WIRED",
            "interpretation": "source-native edge is undefined, not observed zero",
        },
        "deployedMutableRuntime": "UNKNOWN_OFFLINE",
        "conditionalReplayControls": {
            "operatorControlsNeutralized": True,
            "description": "kill switch and empty allowlist are neutralized only for this conditional research replay",
        },
        "period": {
            "startInclusive": "2025-07-01T00:00:00Z",
            "endExclusive": "2026-07-01T00:00:00Z",
            "researchEndExclusive": "2026-04-01T00:00:00Z",
            "temporalSplit": "APR_JUN_RETROSPECTIVE_SPLIT; not a prospective untouched holdout",
        },
        "eligibilityHistory": {
            "preRollStart": "2025-06-29T00:00:00Z",
            "firstFullyValidPrior24hCut": "2025-06-30T00:00:00Z",
            "prePeriodLifecycleWarmupHoursAfterFirstValidCut": 24,
            "boundaryCarrySeconds": CARRY_SECONDS,
            "boundaryCarryHours": CARRY_SECONDS / 3_600,
            "reason": "28h carry preserves a valid prior-24h eligibility cut for every one of the 240 prior baseline minutes",
            "syntheticBoundaryPreflight": boundary_preflight,
        },
        "cohort": list(COHORT),
        "cohortCoverage": {
            "currentEligibleSymbols": 87,
            "measuredSymbols": len(COHORT),
            "fraction": len(COHORT) / 87.0,
            "selectionWarning": "current-cohort survivorship; not a historical point-in-time universe",
            "full87Capacity": "UNKNOWN",
        },
        "sourceMappingCoverage": {
            "status": "PARTIAL",
            "known": [
                "frozen threshold literals and 2s decision cadence",
                "detector watch/focus/reject/ignore transition ordering",
                "source 600s cooldown and 4s focus dwell literals",
            ],
            "causalSurrogates": [
                "completed 1s kline windows cut at bar t and decided at t+1",
                "unseeded 15s price start clamped to the current eligible-run boundary; aligned 5m price uses source-mapped coarse candle seed",
                "prior-only median with immediate last-60 completed 1m seed on eligible re-entry, then bounded growth to 240m",
                "15m-refreshed rolling 24h kline sum for mini-ticker eligibility",
                "kline raw trade counts and taker-buy quote for aggTrade tape fields",
            ],
            "unknown": [
                "historical Spot bid/ask spread",
                "historical top-of-book depth score and depth-vs-norm",
                "aggTrade-row 5s trade-count multiple and min-8 gate; 1s kline count is raw trades",
                "15s taker-buy ratio under the engine 512-aggTrade raw-window cap",
                "raw-trade max dominance under the 512-print cap",
                "raw-trade wash-uniformity score",
                "historical rolling mini-ticker 24h volume; 15m-refreshed kline sum is a surrogate",
                "public REST seed latency, failure, and retry timing on eligible re-entry",
                "sub-second timer/transport ordering and HTTP snapshot-read cadence that can mutate trigger age",
                "full-87 focus competition, eviction, and protected occupancy",
                "proposal refresh, TTL, and invalidation interactions",
                "production protection-policy parameter values",
                "owner confirmation/add-permission stages",
            ],
            "unknownGatePolicy": "ASSUME_PASS for unavailable book/depth and capped raw-tape gates; result remains conditional only",
            "bookGateCoverageFraction": 0.0,
            "aggTradeCountGateCoverageFraction": 0.0,
            "rawTapeForensicsCoverageFraction": 0.0,
        },
        "executionSurrogate": {
            "notionalUsdPerEvent": SUGGESTED_NOTIONAL_USD,
            "notionalSource": "frozen app maxOrderNotionalUsd default applied by runtime each tick",
            "runtimeMutableCurrentNotional": "UNKNOWN_OFFLINE",
            "feeBpsPerSide": FEE_BPS_PER_SIDE,
            "slippageBpsPerSide": BASE_SLIPPAGE_BPS_PER_SIDE,
            "fillTiming": "completed bar t is decided at t+1; one-second latency fills at t+2 open",
            "shortInventory": "preowned base, no borrow or leverage",
            "exitPolicySource": "external hypothetical 60s exit-decision horizon plus 1s fill latency; no production exit exists",
            "exitDecisionHorizonSeconds": EXIT_DECISION_HORIZON_SECONDS,
            "entryToExitFillExposureSeconds": EXIT_DECISION_HORIZON_SECONDS + 1,
            "capacityScope": "$12 only via 1% of the fully completed pre-entry signal second; full-87 and single-$1k capacity UNKNOWN",
        },
        "modeledLifecycle": {
            "transitionModel": "chronological detector/focus state with watch retaining focus",
            "externalEventDedup": "one first qualifying event per focus session before participation filtering",
            "participationDoesNotMutateSourceState": True,
            "eligibilityReset": "ineligible resets trigger/focus/proposal/cooldown state; re-entry assumes immediate successful seed of the last 60 completed Spot1m candles",
            "baselineReentryPolicy": "SOURCE_MAPPED_60_CANDLE_SEED_WITH_IMMEDIATE_SUCCESS_ASSUMPTION; actual REST latency/failure is UNKNOWN",
            "counterScope": "includes June 29-30 pre-roll decisions used to initialize fully-valid July 1 state",
            "counters": asdict(lifecycle_counters),
            "transitionLedgerRows": len(all_transitions),
            "transitionCounts": dict(sorted(transition_counts.items())),
            "periodProposalTransitionsReconcile": True,
        },
        "preParticipationFocusEvents": len(all_events),
        "participationRejected": len(participation_rejected_events),
        "acceptedParticipationEvents": len(accepted),
        "eventInvariants": event_invariants,
        "archiveGapSecondsBySymbol": dict(sorted(gap_seconds_by_symbol.items())),
        "archiveIdenticalDuplicateRowsBySymbol": dict(sorted(duplicate_rows_by_symbol.items())),
        "archiveOutOfOrderTransitionsBySymbol": dict(sorted(out_of_order_rows_by_symbol.items())),
        "base": summarize(accepted, BASE_SLIPPAGE_BPS_PER_SIDE),
        "slippageSensitivity": {
            str(value): summarize(accepted, value)["netUsdPer1000EntryNotional"]
            for value in (2.5, 5.0, 10.0)
        },
        "bootstrap": bootstrap_daily(accepted, BASE_SLIPPAGE_BPS_PER_SIDE),
        "archiveManifestSha256": None,
    }

    manifest_path = root / "archive_manifest.json"
    manifest_path.write_text(
        json.dumps(sorted(manifest, key=lambda item: str(item["archive"])), indent=2) + "\n",
        encoding="utf-8",
    )
    report["archiveManifestSha256"] = sha256_file(manifest_path)
    phase = args.tick_phase
    proposals_path = root / f"focus_proposals_v4_phase{phase}.csv"
    accepted_path = root / f"accepted_events_v4_phase{phase}.csv"
    transitions_path = root / f"state_transitions_v4_phase{phase}.csv"
    result_path = root / f"result_v4_phase{phase}.json"
    metadata_path = root / f"run_metadata_v4_phase{phase}.json"
    write_events(
        proposals_path,
        all_events,
        accepted,
        BASE_SLIPPAGE_BPS_PER_SIDE,
    )
    write_events(
        accepted_path,
        accepted,
        accepted,
        BASE_SLIPPAGE_BPS_PER_SIDE,
    )
    write_transitions(transitions_path, all_transitions)
    artifact_bindings = {
        "script": {
            "path": str(Path(__file__).resolve()),
            "sha256": sha256_file(Path(__file__)),
        },
        "archiveManifest": {
            "path": str(manifest_path),
            "sha256": sha256_file(manifest_path),
        },
        "allFirstFocusProposals": {
            "path": str(proposals_path),
            "rows": len(all_events),
            "sha256": sha256_file(proposals_path),
        },
        "acceptedParticipationEvents": {
            "path": str(accepted_path),
            "rows": len(accepted),
            "sha256": sha256_file(accepted_path),
        },
        "sourceStateTransitions": {
            "path": str(transitions_path),
            "rows": len(all_transitions),
            "sha256": sha256_file(transitions_path),
        },
    }
    report["artifactBindings"] = artifact_bindings
    result_path.write_text(
        json.dumps(report, indent=2) + "\n", encoding="utf-8"
    )
    metadata_path.write_text(
        json.dumps(
            {
                "argv": sys.argv,
                "python": sys.version,
                "polars": pl.__version__,
                "numpy": np.__version__,
                "scriptSha256": sha256_file(Path(__file__)),
                "tickPhase": args.tick_phase,
                "artifactBindings": artifact_bindings,
                "result": {
                    "path": str(result_path),
                    "sha256": sha256_file(result_path),
                },
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(json.dumps(report["base"], indent=2), flush=True)


if __name__ == "__main__":
    main()
