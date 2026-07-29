"""Sealed V-G13 volume/volatility-decoupling experiment.

The ``freeze`` command reads only shared metadata and compressed-file bytes.
The ``run`` command consumes an external O_EXCL development marker before the
first ZIP central directory or member is opened. Development is evaluated and
one candidate is sealed before a second O_EXCL marker permits holdout opening.
Any necessary source or lifecycle defect is terminal ``UNMEASURED``.
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
import sys
import zipfile
from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal, InvalidOperation, localcontext
from pathlib import Path
from typing import Any, Final, cast

HERE: Final = Path(__file__).resolve().parent
QUANT_ROOT: Final = HERE.parents[1]
PROTOCOL_PATH: Final = HERE / "protocol.v1.json"
COLLISION_PATH: Final = HERE / "collision-matrix.v1.json"
SOURCE_RESEARCH_PATH: Final = HERE / "OFFICIAL_SOURCE_RESEARCH.md"
OFFICIAL_FREEZE_PATH: Final = HERE / "official-source-freeze.v1.json"
README_PATH: Final = HERE / "README.md"
VERIFIER_PATH: Final = HERE / "verify.py"
TEST_PATH: Final = HERE / "test_experiment.py"
UNIVERSE_PATH: Final = HERE / "universe.v1.json"
SOURCE_MANIFEST_PATH: Final = HERE / "source-manifest.v1.json"
FREEZE_PATH: Final = HERE / "freeze.v1.json"
DEVELOPMENT_MARKER_PATH: Final = HERE / "development-run-marker.v1.json"
DEVELOPMENT_RESULTS_PATH: Final = HERE / "development-results.v1.json"
CANDIDATE_SEAL_PATH: Final = HERE / "candidate-seal.v1.json"
HOLDOUT_MARKER_PATH: Final = HERE / "holdout-open-marker.v1.json"
RESULT_PATH: Final = HERE / "result.v1.json"
PROOF_PATH: Final = HERE / "proof.v1.json"
RESULT_MD_PATH: Final = HERE / "RESULT.md"
CHECKSUMS_PATH: Final = HERE / "SHA256SUMS"

BASE_SHA: Final = "a169b123fb186d1943a75ad648552c4d95be1be1"
BASE_TREE: Final = "37d1b88aa7c8d9ee1f70dc35d0e78613b6ed32f9"
DISCOVERY_SHA: Final = "b4a8f7abd36df19eff0510dfcc3c61fd0df9fdcab5f4d248892ee10010fb21c3"
ACQUISITION_SHA: Final = "01f58272602e43bfb914b649adc00d8273b2d423492220a55f86443bb6441176"
UNIVERSE_SHA: Final = "a597d8339aafb74c40b8899cade9445150c3f431f4c2e7fe2bfac37d8d1b0592"
STABLE_SHA: Final = "850acfaa5b3895914e22445631eec72cd31818d534c5869898210764556b30ff"
LEVERAGED_SHA: Final = "4a0836ed77c6114becd45241429a1c418bc3aa182d8c5035803b308d839772e4"
DAY_US: Final = 86_400_000_000
DECIMAL_RE: Final = re.compile(r"[0-9]+(?:\.[0-9]+)?\Z")
INTEGER_RE: Final = re.compile(r"[0-9]+\Z")
LIMITATION: Final = (
    "This is a sealed public Binance Spot daily-bar counterfactual using proxy "
    "costs. Account fees, historical spread, depth, filters, and fills are "
    "UNKNOWN. It is not account profitability, verified execution, forward "
    "assurance, capacity proof, capital authority, or execution authority."
)
TRUTH: Final = {
    "accountFees": "UNKNOWN",
    "authority": "NONE",
    "capitalAuthority": "NONE",
    "fills": "UNKNOWN",
    "historicalDepth": "UNKNOWN",
    "historicalFilters": "UNKNOWN",
    "historicalSpread": "UNKNOWN",
    "publicBarExecution": "COUNTERFACTUAL_SENSITIVITY_ONLY",
}


class EvidenceError(RuntimeError):
    """A fail-closed source, lifecycle, or measurement error."""


@dataclass(frozen=True, slots=True)
class Bar:
    """Only fields admitted to V-G13 signal/payoff code."""

    day: date
    open: float
    close: float
    quote_volume: float


@dataclass(frozen=True, slots=True)
class Trial:
    trial_id: str
    h_days: int
    top_k: int


@dataclass(frozen=True, slots=True)
class CostScenario:
    name: str
    fee_bps: float
    adverse_bps: float


@dataclass(frozen=True, slots=True)
class RankedName:
    symbol: str
    notional_percentile: float
    rv_percentile: float
    rank_gap: float


@dataclass(frozen=True, slots=True)
class Formation:
    signal_day: date
    entry_day: date
    selected: tuple[RankedName, ...]
    controls: tuple[RankedName, ...]
    eligible_count: int


@dataclass(frozen=True, slots=True)
class PendingCohort:
    entry_day: date
    exit_day: date
    symbols: tuple[str, ...]
    net_factors: tuple[float, ...]
    gross_factors: tuple[float, ...]
    allocation_per_slot: float


@dataclass(frozen=True, slots=True)
class PortfolioMetrics:
    start_usd: float
    end_usd: float
    net_usd: float
    valid_formations: int
    completed_round_trips: int
    fills: int
    distinct_symbols: tuple[str, ...]
    max_drawdown_pct: float
    daily_dates: tuple[date, ...]
    daily_returns: tuple[float, ...]
    positive_gross_by_symbol: Mapping[str, float]

    def summary(self) -> dict[str, object]:
        positive_total = sum(self.positive_gross_by_symbol.values())
        top_share = (
            0.0
            if positive_total <= 0
            else max(self.positive_gross_by_symbol.values(), default=0.0) / positive_total * 100.0
        )
        return {
            "startUsd": number_text(self.start_usd),
            "endUsd": number_text(self.end_usd),
            "netUsd": number_text(self.net_usd),
            "validFormations": self.valid_formations,
            "completedAssetRoundTrips": self.completed_round_trips,
            "fills": self.fills,
            "distinctSelectedSymbols": list(self.distinct_symbols),
            "distinctSelectedSymbolCount": len(self.distinct_symbols),
            "maximumRealizedDrawdownPct": number_text(self.max_drawdown_pct),
            "topAssetPositiveGrossProfitSharePct": number_text(top_share),
        }


def canonical_bytes(value: object) -> bytes:
    return (
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n"
    ).encode("utf-8")


def sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def safe_file(path: Path) -> Path:
    if path.is_symlink() or not path.is_file():
        raise EvidenceError(f"required regular file missing or unsafe: {path.name}")
    return path


def sha256_path(path: Path) -> str:
    return sha256_bytes(safe_file(path).read_bytes())


def load_json(path: Path) -> tuple[dict[str, Any], bytes]:
    raw = safe_file(path).read_bytes()
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as error:
        raise EvidenceError(f"invalid JSON: {path.name}") from error
    if not isinstance(value, dict):
        raise EvidenceError(f"JSON root must be an object: {path.name}")
    return cast(dict[str, Any], value), raw


def require_mapping(value: object, *, field: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise EvidenceError(f"{field} must be an object")
    return cast(dict[str, Any], value)


def require_list(value: object, *, field: str) -> list[Any]:
    if not isinstance(value, list):
        raise EvidenceError(f"{field} must be a list")
    return value


def require_text(value: object, *, field: str) -> str:
    if not isinstance(value, str) or not value:
        raise EvidenceError(f"{field} must be nonempty text")
    return value


def require_int(value: object, *, field: str, minimum: int = 0) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise EvidenceError(f"{field} must be an integer >= {minimum}")
    return value


def nested(mapping: Mapping[str, Any], *keys: str) -> Any:
    current: Any = mapping
    for key in keys:
        if not isinstance(current, dict) or key not in current:
            raise EvidenceError(f"missing required field: {'.'.join(keys)}")
        current = current[key]
    return current


def now_utc() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def number_text(value: float) -> str:
    if not math.isfinite(value):
        raise EvidenceError("non-finite value cannot be serialized")
    if value == 0:
        return "0"
    return format(value, ".12g")


def date_value(text: str) -> date:
    try:
        return date.fromisoformat(text)
    except ValueError as error:
        raise EvidenceError(f"invalid ISO date: {text}") from error


def daterange(start: date, end_inclusive: date) -> Iterable[date]:
    current = start
    while current <= end_inclusive:
        yield current
        current += timedelta(days=1)


def month_range(first: str, last: str) -> tuple[str, ...]:
    current = date_value(f"{first}-01")
    final = date_value(f"{last}-01")
    result: list[str] = []
    while current <= final:
        result.append(current.strftime("%Y-%m"))
        current = (
            date(current.year + 1, 1, 1)
            if current.month == 12
            else date(current.year, current.month + 1, 1)
        )
    return tuple(result)


def logical_lines_sha(values: Sequence[str]) -> str:
    return sha256_bytes(("\n".join(values) + "\n").encode("utf-8"))


def guarded_output(path: Path) -> Path:
    if path.parent.resolve() != HERE.resolve() or path == HERE or path.is_symlink():
        raise EvidenceError("output path escapes or is unsafe")
    return path


def write_once(path: Path, raw: bytes) -> None:
    guarded_output(path)
    if path.exists():
        raise EvidenceError(f"refusing to replace existing artifact: {path.name}")
    temporary = HERE / f".{path.name}.tmp-{os.getpid()}"
    if temporary.exists() or temporary.is_symlink():
        raise EvidenceError("unsafe temporary output")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def write_json_once(path: Path, value: object) -> bytes:
    raw = canonical_bytes(value)
    write_once(path, raw)
    return raw


def validate_protocol() -> dict[str, Any]:
    protocol, _ = load_json(PROTOCOL_PATH)
    if (
        protocol.get("schema") != "VG13VolumeVolatilityDecouplingProtocolV1"
        or protocol.get("canonicalBaseCommit") != BASE_SHA
        or protocol.get("canonicalBaseTree") != BASE_TREE
        or protocol.get("limitation") != LIMITATION
        or nested(protocol, "trials", "familySize") != 6
        or nested(protocol, "portfolio", "sleeves") != 7
        or nested(protocol, "calendar", "holdout", "allowedOpenCount") != 1
        or nested(protocol, "runControl", "invalidDevelopmentMeansHoldoutNeverOpens") is not True
    ):
        raise EvidenceError("frozen protocol invariant mismatch")
    if sha256_path(COLLISION_PATH) != nested(protocol, "sourceFreeze", "collisionMatrixSha256"):
        raise EvidenceError("collision-matrix binding mismatch")
    if sha256_path(OFFICIAL_FREEZE_PATH) != nested(
        protocol, "sourceFreeze", "officialSourceFreezeSha256"
    ):
        raise EvidenceError("official-source-freeze binding mismatch")
    if sha256_path(SOURCE_RESEARCH_PATH) != nested(
        protocol, "sourceFreeze", "officialSourceResearchSha256"
    ):
        raise EvidenceError("official source research binding mismatch")
    return protocol


def build_trials(protocol: Mapping[str, Any]) -> tuple[Trial, ...]:
    h_values = require_list(nested(protocol, "trials", "hDays"), field="hDays")
    k_values = require_list(nested(protocol, "trials", "topK"), field="topK")
    trials = tuple(
        Trial(f"H{int(h):02d}_K{int(k):02d}", int(h), int(k)) for h in h_values for k in k_values
    )
    expected = require_list(nested(protocol, "trials", "trialIds"), field="trialIds")
    if [trial.trial_id for trial in trials] != expected or len(trials) != 6:
        raise EvidenceError("trial family differs from frozen six cells")
    return trials


def exact_decimal(text: str, *, field: str) -> Decimal:
    if DECIMAL_RE.fullmatch(text) is None:
        raise EvidenceError(f"{field} is not a canonical unsigned decimal")
    try:
        value = Decimal(text)
    except InvalidOperation as error:
        raise EvidenceError(f"{field} is not a decimal") from error
    if not value.is_finite():
        raise EvidenceError(f"{field} must be finite")
    return value


def parse_archive(
    path: Path,
    *,
    symbol: str,
    month: str,
    expected_sha: str,
) -> tuple[Bar, ...]:
    """Open one ZIP after lifecycle admission and validate every row."""

    if sha256_path(path) != expected_sha:
        raise EvidenceError(f"source ZIP changed: {symbol}|{month}")
    expected_member = f"{symbol}-1d-{month}.csv"
    try:
        with zipfile.ZipFile(path, "r") as archive:
            infos = archive.infolist()
            if len(infos) != 1:
                raise EvidenceError(f"unsafe ZIP member count: {symbol}|{month}")
            info = infos[0]
            if (
                info.filename != expected_member
                or info.is_dir()
                or "/" in info.filename
                or "\\" in info.filename
                or info.flag_bits & 0x1
            ):
                raise EvidenceError(f"unsafe ZIP member shape: {symbol}|{month}")
            raw = archive.read(info)
    except (OSError, zipfile.BadZipFile, RuntimeError) as error:
        raise EvidenceError(f"unreadable ZIP: {symbol}|{month}") from error
    try:
        text = raw.decode("ascii", errors="strict")
    except UnicodeDecodeError as error:
        raise EvidenceError(f"non-ASCII CSV: {symbol}|{month}") from error
    if not text or text.startswith("\ufeff") or "\r" in text:
        raise EvidenceError(f"noncanonical CSV bytes: {symbol}|{month}")
    bars: list[Bar] = []
    reader = csv.reader(io.StringIO(text, newline=""))
    for row_number, row in enumerate(reader, start=1):
        if len(row) != 12 or any(field == "" for field in row):
            raise EvidenceError(f"malformed CSV row: {symbol}|{month}|{row_number}")
        if INTEGER_RE.fullmatch(row[0]) is None or INTEGER_RE.fullmatch(row[6]) is None:
            raise EvidenceError(f"invalid timestamp: {symbol}|{month}|{row_number}")
        if INTEGER_RE.fullmatch(row[8]) is None:
            raise EvidenceError(f"invalid trade count: {symbol}|{month}|{row_number}")
        open_us = int(row[0])
        close_us = int(row[6])
        if open_us % DAY_US != 0 or close_us != open_us + DAY_US - 1:
            raise EvidenceError(f"non-UTC microsecond daily grid: {symbol}|{month}")
        day = date(1970, 1, 1) + timedelta(days=open_us // DAY_US)
        if day.strftime("%Y-%m") != month:
            raise EvidenceError(f"row outside declared month: {symbol}|{month}")
        with localcontext() as context:
            context.prec = 50
            open_d = exact_decimal(row[1], field="open")
            high_d = exact_decimal(row[2], field="high")
            low_d = exact_decimal(row[3], field="low")
            close_d = exact_decimal(row[4], field="close")
            base_volume = exact_decimal(row[5], field="base_volume")
            quote_volume = exact_decimal(row[7], field="quote_volume")
            taker_base = exact_decimal(row[9], field="taker_buy_base")
            taker_quote = exact_decimal(row[10], field="taker_buy_quote")
            ignored = exact_decimal(row[11], field="ignore")
            if (
                min(open_d, high_d, low_d, close_d) <= 0
                or low_d > min(open_d, close_d)
                or high_d < max(open_d, close_d)
                or low_d > high_d
                or min(base_volume, quote_volume, taker_base, taker_quote) < 0
                or taker_base > base_volume
                or taker_quote > quote_volume
                or ignored != 0
            ):
                raise EvidenceError(f"out-of-domain row: {symbol}|{month}|{row_number}")
        bars.append(Bar(day, float(open_d), float(close_d), float(quote_volume)))
    if not bars:
        raise EvidenceError(f"empty present archive: {symbol}|{month}")
    for previous, current in itertools.pairwise(bars):
        if current.day == previous.day:
            raise EvidenceError(f"duplicate daily row: {symbol}|{current.day}")
        if current.day != previous.day + timedelta(days=1):
            raise EvidenceError(f"gapped daily row: {symbol}|{previous.day}|{current.day}")
    return tuple(bars)


def percentile_ranks(values: Mapping[str, float]) -> dict[str, float]:
    if len(values) < 2:
        raise EvidenceError("percentile rank requires at least two names")
    ordered = sorted(values.items(), key=lambda item: (item[1], item[0]))
    result: dict[str, float] = {}
    index = 0
    denominator = len(ordered) - 1
    while index < len(ordered):
        end = index + 1
        while end < len(ordered) and ordered[end][1] == ordered[index][1]:
            end += 1
        average_zero_based_rank = (index + end - 1) / 2.0
        percentile = average_zero_based_rank / denominator
        for offset in range(index, end):
            result[ordered[offset][0]] = percentile
        index = end
    return result


def consecutive_days_present(symbol_bars: Mapping[date, Bar], start: date, end: date) -> bool:
    return all(day in symbol_bars for day in daterange(start, end))


def build_formation(
    bars_by_symbol: Mapping[str, Mapping[date, Bar]],
    *,
    signal_day: date,
    trial: Trial,
) -> Formation:
    eligible: dict[str, Mapping[date, Bar]] = {}
    history_start = signal_day - timedelta(days=90)
    for symbol, bars in bars_by_symbol.items():
        if not consecutive_days_present(bars, history_start, signal_day):
            continue
        prior_liquidity = [
            bars[signal_day - timedelta(days=offset)].quote_volume for offset in range(30, 0, -1)
        ]
        if statistics.median(prior_liquidity) < 10_000_000:
            continue
        eligible[symbol] = bars
    if len(eligible) < 25:
        raise EvidenceError(
            f"formation has fewer than 25 eligible names: {signal_day}|{len(eligible)}"
        )
    notionals: dict[str, float] = {}
    realized_volatility: dict[str, float] = {}
    for symbol, bars in eligible.items():
        notionals[symbol] = sum(
            bars[signal_day - timedelta(days=offset)].quote_volume
            for offset in range(trial.h_days - 1, -1, -1)
        )
        squared = 0.0
        for offset in range(trial.h_days - 1, -1, -1):
            current_day = signal_day - timedelta(days=offset)
            prior_day = current_day - timedelta(days=1)
            ratio = bars[current_day].close / bars[prior_day].close
            if ratio <= 0 or not math.isfinite(ratio):
                raise EvidenceError(f"invalid close ratio: {symbol}|{current_day}")
            log_return = math.log(ratio)
            squared += log_return * log_return
        realized_volatility[symbol] = math.sqrt(squared)
    notional_percentiles = percentile_ranks(notionals)
    rv_percentiles = percentile_ranks(realized_volatility)
    ranked = tuple(
        sorted(
            (
                RankedName(
                    symbol,
                    notional_percentiles[symbol],
                    rv_percentiles[symbol],
                    notional_percentiles[symbol] - rv_percentiles[symbol],
                )
                for symbol in eligible
            ),
            key=lambda item: (
                -item.rank_gap,
                -item.notional_percentile,
                item.rv_percentile,
                item.symbol,
            ),
        )
    )
    selected = tuple(
        item for item in ranked if item.notional_percentile >= 0.80 and item.rv_percentile <= 0.40
    )[: trial.top_k]
    control_pool = [
        item
        for item in ranked
        if item.notional_percentile >= 0.80
        and item.rv_percentile >= 0.60
        and item.symbol not in {selected_item.symbol for selected_item in selected}
    ]
    controls: list[RankedName] = []
    used: set[str] = set()
    for signal_name in selected:
        available = [item for item in control_pool if item.symbol not in used]
        if not available:
            raise EvidenceError(f"insufficient matched controls: {signal_day}")
        match = min(
            available,
            key=lambda item: (
                abs(item.notional_percentile - signal_name.notional_percentile),
                -item.rv_percentile,
                item.symbol,
            ),
        )
        controls.append(match)
        used.add(match.symbol)
    return Formation(
        signal_day,
        signal_day + timedelta(days=1),
        selected,
        tuple(controls),
        len(eligible),
    )


def cost_factor(entry: float, exit_: float, scenario: CostScenario) -> float:
    fee = scenario.fee_bps / 10_000.0
    adverse = scenario.adverse_bps / 10_000.0
    return (exit_ * (1.0 - adverse) * (1.0 - fee)) / (entry * (1.0 + adverse)) * (1.0 - fee)


def simulate_portfolio(
    formations: Sequence[Formation],
    *,
    bars_by_symbol: Mapping[str, Mapping[date, Bar]],
    entry_start: date,
    entry_end: date,
    top_k: int,
    scenario: CostScenario,
    control: bool,
) -> PortfolioMetrics:
    expected_days = tuple(daterange(entry_start, entry_end))
    if tuple(formation.entry_day for formation in formations) != expected_days:
        raise EvidenceError("formation schedule is incomplete or reordered")
    formation_by_day = {formation.entry_day: formation for formation in formations}
    balances = [1000.0 / 7.0] * 7
    pending: list[PendingCohort | None] = [None] * 7
    daily_dates: list[date] = []
    daily_returns: list[float] = []
    selected_symbols: set[str] = set()
    positive_gross: defaultdict[str, float] = defaultdict(float)
    round_trips = 0
    peak = 1000.0
    maximum_drawdown = 0.0
    previous_total = 1000.0
    final_exit = entry_end + timedelta(days=7)
    for day in daterange(entry_start, final_exit):
        slot = (day - entry_start).days % 7
        cohort = pending[slot]
        if cohort is not None:
            if cohort.exit_day != day:
                raise EvidenceError("sleeve lifecycle collision")
            if len(cohort.net_factors) > top_k:
                raise EvidenceError("cohort exceeds top K")
            factor = (sum(cohort.net_factors) + (top_k - len(cohort.net_factors))) / top_k
            balances[slot] *= factor
            for symbol, gross_factor in zip(cohort.symbols, cohort.gross_factors, strict=True):
                gross_profit = cohort.allocation_per_slot * (gross_factor - 1.0)
                if gross_profit > 0:
                    positive_gross[symbol] += gross_profit
            round_trips += len(cohort.symbols)
            selected_symbols.update(cohort.symbols)
            pending[slot] = None
        total = sum(balances)
        daily_return = total / previous_total - 1.0
        daily_dates.append(day)
        daily_returns.append(daily_return)
        peak = max(peak, total)
        maximum_drawdown = max(maximum_drawdown, (peak - total) / peak * 100.0)
        previous_total = total
        if day <= entry_end:
            formation = formation_by_day[day]
            names = formation.controls if control else formation.selected
            if control and len(names) != len(formation.selected):
                raise EvidenceError("matched control count differs from signal count")
            net_factors: list[float] = []
            gross_factors: list[float] = []
            exit_day = day + timedelta(days=7)
            for ranked_name in names:
                bars = bars_by_symbol.get(ranked_name.symbol)
                if bars is None or day not in bars or exit_day not in bars:
                    raise EvidenceError(
                        f"missing selected entry or exit: {ranked_name.symbol}|{day}"
                    )
                entry_price = bars[day].open
                exit_price = bars[exit_day].open
                if min(entry_price, exit_price) <= 0:
                    raise EvidenceError("nonpositive selected execution reference")
                net_factors.append(cost_factor(entry_price, exit_price, scenario))
                gross_factors.append(exit_price / entry_price)
            pending[slot] = PendingCohort(
                day,
                exit_day,
                tuple(item.symbol for item in names),
                tuple(net_factors),
                tuple(gross_factors),
                balances[slot] / top_k,
            )
    if any(item is not None for item in pending):
        raise EvidenceError("partition ended with open sleeve")
    end_usd = sum(balances)
    return PortfolioMetrics(
        1000.0,
        end_usd,
        end_usd - 1000.0,
        len(formations),
        round_trips,
        round_trips * 2,
        tuple(sorted(selected_symbols)),
        maximum_drawdown,
        tuple(daily_dates),
        tuple(daily_returns),
        dict(sorted(positive_gross.items())),
    )


def bootstrap_stats(
    returns: Sequence[float],
    *,
    seed: int,
    replicates: int,
    block_length: int,
    compound: bool,
) -> dict[str, object]:
    if not returns:
        raise EvidenceError("bootstrap series is empty")
    rng = random.Random(seed)
    values: list[float] = []
    size = len(returns)
    for _ in range(replicates):
        sample: list[float] = []
        while len(sample) < size:
            start = rng.randrange(size)
            sample.extend(returns[(start + offset) % size] for offset in range(block_length))
        sample = sample[:size]
        if compound:
            total = 1000.0
            for value in sample:
                total *= 1.0 + value
            values.append(total - 1000.0)
        else:
            values.append(1000.0 * sum(sample))
    values.sort()
    lower = values[math.floor(0.05 * (replicates - 1))]
    p_value = (sum(value <= 0 for value in values) + 1) / (replicates + 1)
    return {
        "replicates": replicates,
        "blockLengthDays": block_length,
        "oneSidedLower05Usd": number_text(lower),
        "oneSidedProbabilityAtOrBelowZero": number_text(p_value),
    }


def holm_adjusted(p_values: Mapping[str, float], alpha: float) -> dict[str, dict[str, object]]:
    ordered = sorted(p_values.items(), key=lambda item: (item[1], item[0]))
    running = 0.0
    result: dict[str, dict[str, object]] = {}
    count = len(ordered)
    for index, (trial_id, p_value) in enumerate(ordered):
        adjusted = min(1.0, max(running, p_value * (count - index)))
        running = adjusted
        result[trial_id] = {
            "rawPValue": number_text(p_value),
            "adjustedPValue": number_text(adjusted),
            "rejectAtFamilyWiseAlpha": adjusted < alpha,
        }
    return dict(sorted(result.items()))


def positive_month_count(dates: Sequence[date], returns: Sequence[float]) -> int:
    monthly: defaultdict[str, float] = defaultdict(float)
    for day, value in zip(dates, returns, strict=True):
        monthly[day.strftime("%Y-%m")] += value
    return sum(value > 0 for value in monthly.values())


def calculate_pbo(
    trial_series: Mapping[str, tuple[tuple[date, ...], tuple[float, ...]]],
) -> dict[str, object]:
    trial_ids = sorted(trial_series)
    if len(trial_ids) != 6:
        raise EvidenceError("PBO requires the frozen six trials")
    months = (
        *(f"2025-{month:02d}" for month in range(7, 13)),
        "2026-01",
        "2026-02",
    )
    monthly: dict[str, dict[str, float]] = {}
    for trial_id, (dates, values) in trial_series.items():
        totals = dict.fromkeys(months, 0.0)
        for day, value in zip(dates, values, strict=True):
            key = day.strftime("%Y-%m")
            if key in totals:
                totals[key] += value
        monthly[trial_id] = totals
    below_median = 0
    splits = 0
    for in_sample_indices in itertools.combinations(range(8), 4):
        in_sample = {months[index] for index in in_sample_indices}
        out_sample = set(months) - in_sample
        in_scores = {
            trial_id: sum(monthly[trial_id][month] for month in in_sample) for trial_id in trial_ids
        }
        champion = min(trial_ids, key=lambda item: (-in_scores[item], item))
        out_scores = {
            trial_id: sum(monthly[trial_id][month] for month in out_sample)
            for trial_id in trial_ids
        }
        ordered_scores = sorted(out_scores.values())
        selected_score = out_scores[champion]
        average_rank = sum(
            index for index, score in enumerate(ordered_scores) if score == selected_score
        ) / sum(1 for score in ordered_scores if score == selected_score)
        percentile = average_rank / (len(trial_ids) - 1)
        if percentile <= 0.5:
            below_median += 1
        splits += 1
    if splits != 70:
        raise EvidenceError("PBO split count differs from 70")
    return {
        "method": "CSCV_8_MONTH_BLOCKS",
        "splitCount": splits,
        "belowMedianCount": below_median,
        "pbo": number_text(below_median / splits),
        "role": "DIAGNOSTIC_AND_GO_GATE",
    }


def evaluate_partition(
    protocol: Mapping[str, Any],
    bars: Mapping[str, Mapping[date, Bar]],
    *,
    entry_start: date,
    entry_end: date,
    trials: Sequence[Trial],
) -> tuple[list[dict[str, object]], dict[str, dict[str, Any]], dict[str, object]]:
    scenarios = (
        CostScenario("BASE", 10.0, 10.0),
        CostScenario("STRESS", 10.0, 25.0),
    )
    replicates = int(nested(protocol, "statistics", "bootstrap", "replicates"))
    seed = int(nested(protocol, "statistics", "bootstrap", "seed"))
    records: list[dict[str, object]] = []
    internal: dict[str, dict[str, Any]] = {}
    p_values: dict[str, float] = {}
    pbo_series: dict[str, tuple[tuple[date, ...], tuple[float, ...]]] = {}
    for trial_index, trial in enumerate(trials):
        formations = tuple(
            build_formation(
                bars,
                signal_day=entry_day - timedelta(days=1),
                trial=trial,
            )
            for entry_day in daterange(entry_start, entry_end)
        )
        scenario_records: dict[str, object] = {}
        scenario_internal: dict[str, Any] = {}
        for scenario in scenarios:
            signal_metrics = simulate_portfolio(
                formations,
                bars_by_symbol=bars,
                entry_start=entry_start,
                entry_end=entry_end,
                top_k=trial.top_k,
                scenario=scenario,
                control=False,
            )
            control_metrics = simulate_portfolio(
                formations,
                bars_by_symbol=bars,
                entry_start=entry_start,
                entry_end=entry_end,
                top_k=trial.top_k,
                scenario=scenario,
                control=True,
            )
            if signal_metrics.daily_dates != control_metrics.daily_dates:
                raise EvidenceError("signal/control calendar mismatch")
            excess_returns = tuple(
                signal_value - control_value
                for signal_value, control_value in zip(
                    signal_metrics.daily_returns,
                    control_metrics.daily_returns,
                    strict=True,
                )
            )
            absolute_bootstrap = bootstrap_stats(
                signal_metrics.daily_returns,
                seed=seed + trial_index,
                replicates=replicates,
                block_length=7,
                compound=True,
            )
            excess_bootstrap = bootstrap_stats(
                excess_returns,
                seed=seed + trial_index,
                replicates=replicates,
                block_length=7,
                compound=False,
            )
            excess_usd = signal_metrics.end_usd - control_metrics.end_usd
            positive_months = positive_month_count(signal_metrics.daily_dates, excess_returns)
            scenario_records[scenario.name] = {
                "signal": signal_metrics.summary(),
                "notionalMatchedHighRvControl": control_metrics.summary(),
                "matchedControlExcessUsd": number_text(excess_usd),
                "positiveMatchedControlExcessMonths": positive_months,
                "absoluteBootstrap": absolute_bootstrap,
                "matchedControlExcessBootstrap": excess_bootstrap,
            }
            scenario_internal[scenario.name] = {
                "signal": signal_metrics,
                "control": control_metrics,
                "excessReturns": excess_returns,
                "excessUsd": excess_usd,
                "excessBootstrap": excess_bootstrap,
                "positiveMonths": positive_months,
            }
        stress = scenario_internal["STRESS"]
        p_value = float(
            cast(
                str,
                cast(dict[str, object], stress["excessBootstrap"])[
                    "oneSidedProbabilityAtOrBelowZero"
                ],
            )
        )
        p_values[trial.trial_id] = p_value
        stress_signal = cast(PortfolioMetrics, stress["signal"])
        pbo_series[trial.trial_id] = (
            stress_signal.daily_dates,
            cast(tuple[float, ...], stress["excessReturns"]),
        )
        record = {
            "trialId": trial.trial_id,
            "hDays": trial.h_days,
            "topK": trial.top_k,
            "scenarios": scenario_records,
        }
        records.append(record)
        internal[trial.trial_id] = {
            "trial": trial,
            "scenarios": scenario_internal,
        }
    holm = holm_adjusted(p_values, 0.05)
    for record in records:
        record["stressMatchedExcessMultiplicity"] = holm[str(record["trialId"])]
    pbo = (
        calculate_pbo(pbo_series)
        if len(trials) == 6
        else {
            "method": "NOT_APPLICABLE_CHAMPION_ONLY_HOLDOUT",
            "splitCount": 0,
            "belowMedianCount": 0,
            "pbo": None,
            "role": "DEVELOPMENT_ONLY",
        }
    )
    return records, internal, pbo


def all_true(gates: Mapping[str, object]) -> bool:
    return bool(gates) and all(value is True for value in gates.values())


def development_gates(
    record: Mapping[str, Any],
    internal: Mapping[str, Any],
    *,
    pbo: Mapping[str, object],
) -> dict[str, bool]:
    stress = require_mapping(nested(internal, "scenarios", "STRESS"), field="stress")
    signal = cast(PortfolioMetrics, stress["signal"])
    excess_bootstrap = require_mapping(stress["excessBootstrap"], field="bootstrap")
    multiplicity = require_mapping(record["stressMatchedExcessMultiplicity"], field="multiplicity")
    return {
        "validFormationsAtLeast236": signal.valid_formations >= 236,
        "completedAssetRoundTripsAtLeast500": signal.completed_round_trips >= 500,
        "distinctSelectedSymbolsAtLeast15": len(signal.distinct_symbols) >= 15,
        "stressNetUsdPositive": signal.net_usd > 0,
        "stressAbsoluteBootstrapLowerPositive": float(
            nested(record, "scenarios", "STRESS", "absoluteBootstrap", "oneSidedLower05Usd")
        )
        > 0,
        "stressMatchedControlExcessUsdPositive": float(stress["excessUsd"]) > 0,
        "stressMatchedControlExcessBootstrapLowerPositive": float(
            excess_bootstrap["oneSidedLower05Usd"]
        )
        > 0,
        "holmAdjustedPValueBelow005": float(multiplicity["adjustedPValue"]) < 0.05,
        "positiveStressExcessMonthsAtLeast5": int(stress["positiveMonths"]) >= 5,
        "pboAtMost050": float(cast(str, pbo["pbo"])) <= 0.50,
        "maximumRealizedDrawdownAtMost25Pct": signal.max_drawdown_pct <= 25.0,
    }


def holdout_gates(record: Mapping[str, Any], internal: Mapping[str, Any]) -> dict[str, bool]:
    base_signal = cast(PortfolioMetrics, nested(internal, "scenarios", "BASE", "signal"))
    stress = require_mapping(nested(internal, "scenarios", "STRESS"), field="stress")
    stress_signal = cast(PortfolioMetrics, stress["signal"])
    stress_control = cast(PortfolioMetrics, stress["control"])
    excess_bootstrap = require_mapping(stress["excessBootstrap"], field="bootstrap")
    positive_total = sum(stress_signal.positive_gross_by_symbol.values())
    top_share = (
        0.0
        if positive_total <= 0
        else max(stress_signal.positive_gross_by_symbol.values(), default=0.0)
        / positive_total
        * 100.0
    )
    return {
        "validFormationsAtLeast115": stress_signal.valid_formations >= 115,
        "completedAssetRoundTripsAtLeast200": stress_signal.completed_round_trips >= 200,
        "distinctSelectedSymbolsAtLeast10": len(stress_signal.distinct_symbols) >= 10,
        "baseNetUsdPositive": base_signal.net_usd > 0,
        "stressNetUsdPositive": stress_signal.net_usd > 0,
        "stressAbsoluteBootstrapLowerPositive": float(
            nested(record, "scenarios", "STRESS", "absoluteBootstrap", "oneSidedLower05Usd")
        )
        > 0,
        "stressMatchedControlExcessUsdPositive": (stress_signal.end_usd - stress_control.end_usd)
        > 0,
        "stressMatchedControlExcessBootstrapLowerPositive": float(
            excess_bootstrap["oneSidedLower05Usd"]
        )
        > 0,
        "stressMatchedControlExcessPValueBelow005": float(
            excess_bootstrap["oneSidedProbabilityAtOrBelowZero"]
        )
        < 0.05,
        "positiveStressExcessMonthsAtLeast3": int(stress["positiveMonths"]) >= 3,
        "maximumRealizedDrawdownAtMost25Pct": stress_signal.max_drawdown_pct <= 25.0,
        "topAssetPositiveGrossProfitShareAtMost35Pct": top_share <= 35.0,
    }


def select_champion(
    records: Sequence[Mapping[str, Any]], internal: Mapping[str, Mapping[str, Any]]
) -> str:
    def key(record: Mapping[str, Any]) -> tuple[float, float, int, int, str]:
        trial_id = str(record["trialId"])
        stress = require_mapping(nested(internal[trial_id], "scenarios", "STRESS"), field="stress")
        lcb = float(
            nested(
                record,
                "scenarios",
                "STRESS",
                "matchedControlExcessBootstrap",
                "oneSidedLower05Usd",
            )
        )
        signal = cast(PortfolioMetrics, stress["signal"])
        trial = cast(Trial, internal[trial_id]["trial"])
        return (-lcb, -signal.net_usd, trial.top_k, trial.h_days, trial_id)

    return str(min(records, key=key)["trialId"])


def source_metadata(
    protocol: Mapping[str, Any], source_root: Path
) -> tuple[dict[str, object], dict[str, object]]:
    discovery_path = source_root / "discovery.v1.json"
    acquisition_path = source_root / "acquisition-manifest.v1.json"
    if sha256_path(discovery_path) != DISCOVERY_SHA:
        raise EvidenceError("shared discovery metadata changed")
    if sha256_path(acquisition_path) != ACQUISITION_SHA:
        raise EvidenceError("shared acquisition metadata changed")
    discovery, _ = load_json(discovery_path)
    acquisition, _ = load_json(acquisition_path)
    universe = require_mapping(discovery.get("universe"), field="universe")
    symbols_raw = require_list(universe.get("symbols"), field="universe.symbols")
    if not all(isinstance(item, str) for item in symbols_raw):
        raise EvidenceError("shared universe contains non-text symbol")
    symbols = cast(list[str], symbols_raw)
    if (
        universe.get("count") != 605
        or universe.get("sha256") != UNIVERSE_SHA
        or symbols != sorted(set(symbols))
        or logical_lines_sha(symbols) != UNIVERSE_SHA
    ):
        raise EvidenceError("shared universe logical binding mismatch")
    exclusions = require_mapping(discovery.get("exclusions"), field="exclusions")
    stable = cast(
        list[str],
        require_list(exclusions.get("stableOrFiatSymbols"), field="stable exclusions"),
    )
    leveraged = cast(
        list[str],
        require_list(exclusions.get("pairedLeveragedSymbols"), field="leveraged exclusions"),
    )
    if logical_lines_sha(stable) != STABLE_SHA or logical_lines_sha(leveraged) != LEVERAGED_SHA:
        raise EvidenceError("shared exclusion logical binding mismatch")
    if acquisition.get("archiveBodiesDecompressed") is not False:
        raise EvidenceError("shared acquisition metadata no longer describes sealed archives")
    months = month_range("2025-04", "2026-06")
    pairs: dict[tuple[str, str], dict[str, Any]] = {}
    for raw_pair in require_list(acquisition.get("artifactPairs"), field="artifactPairs"):
        pair = require_mapping(raw_pair, field="artifactPair")
        key = (
            require_text(pair.get("symbol"), field="pair.symbol"),
            require_text(pair.get("month"), field="pair.month"),
        )
        if key in pairs:
            raise EvidenceError(f"duplicate acquisition pair metadata: {key}")
        pairs[key] = pair
    rows: list[dict[str, object]] = []
    present_count = 0
    for symbol in symbols:
        for month in months:
            selected_pair = pairs.get((symbol, month))
            if selected_pair is None:
                rows.append({"symbol": symbol, "month": month, "state": "ABSENT"})
                continue
            if selected_pair.get("state") not in {
                "DOWNLOADED_VERIFIED",
                "RESUMED_VERIFIED",
            }:
                raise EvidenceError(f"unverified acquisition pair: {symbol}|{month}")
            zip_name = f"{symbol}-1d-{month}.zip"
            rows.append(
                {
                    "symbol": symbol,
                    "month": month,
                    "state": "PRESENT_CHECKSUM_VERIFIED_COMPRESSED_NOT_OPENED",
                    "zipRelativePath": f"archives/{symbol}/{month}/{zip_name}",
                    "zipSha256": require_text(selected_pair.get("zipSha256"), field="zipSha256"),
                    "zipBytes": require_int(selected_pair.get("zipBytes"), field="zipBytes"),
                    "checksumRelativePath": (f"archives/{symbol}/{month}/{zip_name}.CHECKSUM"),
                    "checksumSha256": require_text(
                        selected_pair.get("checksumSha256"), field="checksumSha256"
                    ),
                    "checksumBytes": require_int(
                        selected_pair.get("checksumBytes"), field="checksumBytes"
                    ),
                }
            )
            present_count += 1
    universe_artifact: dict[str, object] = {
        "schema": "VG13UniverseV1",
        "sourceMode": "SHARED_METADATA_READ_ONLY",
        "discoverySha256": DISCOVERY_SHA,
        "count": 605,
        "sha256": UNIVERSE_SHA,
        "symbols": symbols,
        "exclusions": {
            "stableOrFiatSha256": STABLE_SHA,
            "stableOrFiatSymbols": stable,
            "pairedLeveragedSha256": LEVERAGED_SHA,
            "pairedLeveragedSymbols": leveraged,
        },
    }
    source_manifest: dict[str, object] = {
        "schema": "VG13SourceManifestV1",
        "sourceRoot": str(source_root.resolve()),
        "sharedSourceMode": "READ_ONLY",
        "archiveBodiesOpened": False,
        "discoverySha256": DISCOVERY_SHA,
        "acquisitionManifestSha256": ACQUISITION_SHA,
        "universeSha256": UNIVERSE_SHA,
        "months": list(months),
        "selectedRowCount": len(rows),
        "presentRowCount": present_count,
        "absentRowCount": len(rows) - present_count,
        "rows": rows,
    }
    return universe_artifact, source_manifest


def freeze_packet(source_root: Path) -> None:
    protocol = validate_protocol()
    if FREEZE_PATH.exists() or RESULT_PATH.exists():
        raise EvidenceError("packet freeze or result already exists")
    if (
        source_root.resolve()
        != Path(
            require_text(nested(protocol, "sourceBindings", "sharedRoot"), field="sharedRoot")
        ).resolve()
    ):
        raise EvidenceError("source root differs from frozen protocol")
    universe, source_manifest = source_metadata(protocol, source_root)
    universe_raw = write_json_once(UNIVERSE_PATH, universe)
    source_raw = write_json_once(SOURCE_MANIFEST_PATH, source_manifest)
    static_files = (
        PROTOCOL_PATH,
        COLLISION_PATH,
        SOURCE_RESEARCH_PATH,
        OFFICIAL_FREEZE_PATH,
        README_PATH,
        HERE / "__init__.py",
        Path(__file__).resolve(),
        VERIFIER_PATH,
        TEST_PATH,
        QUANT_ROOT / "pyproject.toml",
        QUANT_ROOT / "uv.lock",
    )
    bindings = {path.name: sha256_path(path) for path in static_files}
    freeze = {
        "schema": "VG13FreezeV1",
        "createdAtUtc": now_utc(),
        "canonicalBaseCommit": BASE_SHA,
        "canonicalBaseTree": BASE_TREE,
        "archiveBodiesOpened": False,
        "trialCount": 6,
        "sourceBindings": {
            "universeFileSha256": sha256_bytes(universe_raw),
            "sourceManifestSha256": sha256_bytes(source_raw),
            "discoverySha256": DISCOVERY_SHA,
            "acquisitionManifestSha256": ACQUISITION_SHA,
        },
        "packetBindings": dict(sorted(bindings.items())),
        "truth": TRUTH,
        "limitation": LIMITATION,
    }
    write_json_once(FREEZE_PATH, freeze)


def verify_freeze() -> tuple[dict[str, Any], dict[str, Any], str]:
    protocol = validate_protocol()
    freeze, freeze_raw = load_json(FREEZE_PATH)
    universe, universe_raw = load_json(UNIVERSE_PATH)
    source, source_raw = load_json(SOURCE_MANIFEST_PATH)
    if (
        freeze.get("schema") != "VG13FreezeV1"
        or freeze.get("archiveBodiesOpened") is not False
        or freeze.get("trialCount") != 6
        or freeze.get("truth") != TRUTH
        or freeze.get("limitation") != LIMITATION
    ):
        raise EvidenceError("freeze invariant mismatch")
    if nested(freeze, "sourceBindings", "universeFileSha256") != sha256_bytes(universe_raw):
        raise EvidenceError("freeze universe binding mismatch")
    if nested(freeze, "sourceBindings", "sourceManifestSha256") != sha256_bytes(source_raw):
        raise EvidenceError("freeze source-manifest binding mismatch")
    if universe.get("sha256") != UNIVERSE_SHA or source.get("universeSha256") != UNIVERSE_SHA:
        raise EvidenceError("universe identity mismatch")
    bindings = require_mapping(freeze.get("packetBindings"), field="packetBindings")
    for path in (
        PROTOCOL_PATH,
        COLLISION_PATH,
        SOURCE_RESEARCH_PATH,
        OFFICIAL_FREEZE_PATH,
        README_PATH,
        HERE / "__init__.py",
        Path(__file__).resolve(),
        VERIFIER_PATH,
        TEST_PATH,
        QUANT_ROOT / "pyproject.toml",
        QUANT_ROOT / "uv.lock",
    ):
        if bindings.get(path.name) != sha256_path(path):
            raise EvidenceError(f"post-freeze packet change: {path.name}")
    return protocol, source, sha256_bytes(freeze_raw)


def verify_compressed_source(source: Mapping[str, Any], source_root: Path) -> int:
    frozen_root = Path(require_text(source.get("sourceRoot"), field="sourceRoot")).resolve()
    if frozen_root != source_root.resolve():
        raise EvidenceError("source root differs from sealed manifest")
    verified = 0
    for raw_row in require_list(source.get("rows"), field="source.rows"):
        row = require_mapping(raw_row, field="source row")
        if row.get("state") == "ABSENT":
            continue
        if row.get("state") != "PRESENT_CHECKSUM_VERIFIED_COMPRESSED_NOT_OPENED":
            raise EvidenceError("source row state mismatch")
        zip_path = source_root / require_text(row.get("zipRelativePath"), field="zipRelativePath")
        checksum_path = source_root / require_text(
            row.get("checksumRelativePath"), field="checksumRelativePath"
        )
        if sha256_path(zip_path) != row.get("zipSha256"):
            raise EvidenceError("source ZIP digest mismatch before member open")
        if zip_path.stat().st_size != row.get("zipBytes"):
            raise EvidenceError("source ZIP size mismatch before member open")
        if sha256_path(checksum_path) != row.get("checksumSha256"):
            raise EvidenceError("source checksum digest mismatch")
        if checksum_path.stat().st_size != row.get("checksumBytes"):
            raise EvidenceError("source checksum size mismatch")
        checksum_text = checksum_path.read_text(encoding="ascii")
        expected_line = f"{row['zipSha256']}  {zip_path.name}\n"
        if checksum_text not in {expected_line, expected_line[:-1]}:
            raise EvidenceError("publisher checksum sidecar bytes malformed")
        verified += 1
    return verified


def ensure_external_state_root(path: Path, expected: Path) -> Path:
    if not path.is_absolute() or path.resolve() != expected.resolve():
        raise EvidenceError("external state root differs from frozen absolute path")
    if path.exists():
        if path.is_symlink() or not path.is_dir():
            raise EvidenceError("external state root is unsafe")
    else:
        path.mkdir(mode=0o700, parents=False)
    return path


def exclusive_external_marker(path: Path, value: object) -> bytes:
    if path.parent.is_symlink() or not path.parent.is_dir() or path.exists():
        raise EvidenceError(f"external marker already consumed or unsafe: {path.name}")
    raw = canonical_bytes(value)
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(path, flags, 0o600)
    with os.fdopen(descriptor, "wb") as handle:
        handle.write(raw)
        handle.flush()
        os.fsync(handle.fileno())
    return raw


def load_bars_for_months(
    source: Mapping[str, Any],
    *,
    source_root: Path,
    months: set[str],
) -> dict[str, dict[date, Bar]]:
    bars: defaultdict[str, dict[date, Bar]] = defaultdict(dict)
    for raw_row in require_list(source.get("rows"), field="source.rows"):
        row = require_mapping(raw_row, field="source row")
        month = require_text(row.get("month"), field="month")
        if month not in months or row.get("state") == "ABSENT":
            continue
        symbol = require_text(row.get("symbol"), field="symbol")
        path = source_root / require_text(row.get("zipRelativePath"), field="zipRelativePath")
        parsed = parse_archive(
            path,
            symbol=symbol,
            month=month,
            expected_sha=require_text(row.get("zipSha256"), field="zipSha256"),
        )
        for bar in parsed:
            if bar.day in bars[symbol]:
                raise EvidenceError(f"duplicate symbol/day across archives: {symbol}|{bar.day}")
            bars[symbol][bar.day] = bar
    for symbol, symbol_bars in bars.items():
        days = sorted(symbol_bars)
        for previous, current in itertools.pairwise(days):
            if current != previous + timedelta(days=1):
                raise EvidenceError(
                    f"gapped necessary symbol history: {symbol}|{previous}|{current}"
                )
    return {symbol: dict(sorted(values.items())) for symbol, values in sorted(bars.items())}


def merge_bars(
    left: Mapping[str, Mapping[date, Bar]],
    right: Mapping[str, Mapping[date, Bar]],
) -> dict[str, dict[date, Bar]]:
    result: dict[str, dict[date, Bar]] = {symbol: dict(values) for symbol, values in left.items()}
    for symbol, values in right.items():
        target = result.setdefault(symbol, {})
        for day, bar in values.items():
            if day in target:
                raise EvidenceError(f"duplicate symbol/day across partitions: {symbol}|{day}")
            target[day] = bar
    for symbol, values in result.items():
        days = sorted(values)
        for previous, current in itertools.pairwise(days):
            if current != previous + timedelta(days=1):
                raise EvidenceError(
                    f"gapped necessary symbol history: {symbol}|{previous}|{current}"
                )
        result[symbol] = dict(sorted(values.items()))
    return dict(sorted(result.items()))


def marker_payload(
    *,
    schema: str,
    phase: str,
    freeze_sha: str,
    source_manifest_sha: str,
) -> dict[str, object]:
    return {
        "schema": schema,
        "createdAtUtc": now_utc(),
        "phase": phase,
        "attempt": 1,
        "state": "CONSUMED_BEFORE_FIRST_ARCHIVE_CENTRAL_DIRECTORY_OR_MEMBER_OPEN",
        "freezeSha256": freeze_sha,
        "sourceManifestSha256": source_manifest_sha,
        "networkPermitted": False,
        "repairDropDeduplicateFallbackRetryOrRerun": False,
    }


def sanitized_reason(error: Exception) -> str:
    reason = str(error).replace(str(Path("/private/tmp")), "<PRIVATE_TMP>")
    return reason[:500]


def terminal_result(
    *,
    phase: str,
    reason: str,
    freeze_sha: str,
    development_marker_sha: str,
    holdout_marker_sha: str | None = None,
    candidate_seal_sha: str | None = None,
) -> dict[str, object]:
    return {
        "schema": "VG13ResultV1",
        "taskId": "V-G13",
        "verdict": "UNMEASURED",
        "terminal": True,
        "terminalPhase": phase,
        "terminalReason": reason,
        "freezeSha256": freeze_sha,
        "developmentMarkerSha256": development_marker_sha,
        "holdoutMarkerSha256": holdout_marker_sha,
        "candidateSealSha256": candidate_seal_sha,
        "holdoutOpened": holdout_marker_sha is not None,
        "repairOrRerunAllowed": False,
        "truth": TRUTH,
        "limitation": LIMITATION,
    }


def markdown_result(result: Mapping[str, Any]) -> bytes:
    verdict = require_text(result.get("verdict"), field="verdict")
    if verdict == "UNMEASURED":
        body = (
            f"# V-G13 result: UNMEASURED\n\n"
            f"Terminal phase: `{result.get('terminalPhase')}`.\n\n"
            f"Reason: `{result.get('terminalReason')}`.\n\n"
        )
    else:
        champion = require_text(result.get("championTrialId"), field="champion")
        body = (
            f"# V-G13 result: {verdict}\n\n"
            f"Frozen champion: `{champion}`.\n\n"
            f"Development gates passed: `{result.get('developmentAllGatesPassed')}`. "
            f"Holdout gates passed: `{result.get('holdoutAllGatesPassed')}`.\n\n"
        )
    body += (
        "Account fees, historical spread, depth, filters, and fills remain "
        "`UNKNOWN`. This public counterfactual grants no capital or execution "
        "authority.\n"
    )
    return body.encode("utf-8")


def write_checksums() -> None:
    if CHECKSUMS_PATH.exists():
        raise EvidenceError("SHA256SUMS already exists")
    files = sorted(
        path
        for path in HERE.iterdir()
        if path.is_file() and not path.is_symlink() and path.name != "SHA256SUMS"
    )
    raw = "".join(f"{sha256_path(path)}  {path.name}\n" for path in files).encode()
    write_once(CHECKSUMS_PATH, raw)


def finalize_result(result: dict[str, object], proof: dict[str, object]) -> None:
    result_raw = write_json_once(RESULT_PATH, result)
    proof = {
        **proof,
        "resultSha256": sha256_bytes(result_raw),
        "truth": TRUTH,
        "authority": "NONE",
    }
    write_json_once(PROOF_PATH, proof)
    write_once(RESULT_MD_PATH, markdown_result(result))
    write_checksums()


def run_packet(source_root: Path, external_state_root: Path) -> None:
    if any(
        path.exists()
        for path in (
            DEVELOPMENT_MARKER_PATH,
            DEVELOPMENT_RESULTS_PATH,
            CANDIDATE_SEAL_PATH,
            HOLDOUT_MARKER_PATH,
            RESULT_PATH,
            PROOF_PATH,
            CHECKSUMS_PATH,
        )
    ):
        raise EvidenceError("sealed run artifact already exists; rerun refused")
    protocol, source, freeze_sha = verify_freeze()
    expected_external = Path(
        require_text(
            nested(protocol, "runControl", "externalStateRoot"),
            field="externalStateRoot",
        )
    )
    external = ensure_external_state_root(external_state_root, expected_external)
    source_manifest_sha = sha256_path(SOURCE_MANIFEST_PATH)
    development_payload = marker_payload(
        schema="VG13DevelopmentRunMarkerV1",
        phase="DEVELOPMENT",
        freeze_sha=freeze_sha,
        source_manifest_sha=source_manifest_sha,
    )
    external_development_raw = exclusive_external_marker(
        external / "development-run-marker.v1.json", development_payload
    )
    write_once(DEVELOPMENT_MARKER_PATH, external_development_raw)
    development_marker_sha = sha256_bytes(external_development_raw)
    proof_base: dict[str, object] = {
        "schema": "VG13FocusedProofV1",
        "freezeSha256": freeze_sha,
        "developmentMarkerSha256": development_marker_sha,
        "externalMarkerConsumedBeforeBodyOpen": True,
        "sharedSourceMode": "READ_ONLY",
        "networkDuringEvaluation": False,
        "collisionMatrixSha256": sha256_path(COLLISION_PATH),
    }
    try:
        verified_archives = verify_compressed_source(source, source_root)
        development_bars = load_bars_for_months(
            source,
            source_root=source_root,
            months=set(month_range("2025-04", "2026-02")),
        )
        trials = build_trials(protocol)
        development_records, development_internal, pbo = evaluate_partition(
            protocol,
            development_bars,
            entry_start=date(2025, 7, 1),
            entry_end=date(2026, 2, 21),
            trials=trials,
        )
        champion_id = select_champion(development_records, development_internal)
        champion_record = next(
            record for record in development_records if record["trialId"] == champion_id
        )
        champion_gates = development_gates(
            champion_record, development_internal[champion_id], pbo=pbo
        )
        for record in development_records:
            record["developmentGates"] = development_gates(
                record,
                development_internal[str(record["trialId"])],
                pbo=pbo,
            )
        development_artifact = {
            "schema": "VG13DevelopmentResultsV1",
            "freezeSha256": freeze_sha,
            "developmentMarkerSha256": development_marker_sha,
            "trialCount": 6,
            "trials": development_records,
            "pbo": pbo,
            "championTrialId": champion_id,
            "championDevelopmentGates": champion_gates,
            "championDevelopmentAllGatesPassed": all_true(champion_gates),
        }
        development_raw = write_json_once(DEVELOPMENT_RESULTS_PATH, development_artifact)
        candidate_seal = {
            "schema": "VG13CandidateSealV1",
            "createdAtUtc": now_utc(),
            "state": "SEALED_BEFORE_HOLDOUT_OPEN",
            "freezeSha256": freeze_sha,
            "developmentMarkerSha256": development_marker_sha,
            "developmentResultsSha256": sha256_bytes(development_raw),
            "championTrialId": champion_id,
            "championTrial": {
                "hDays": require_int(champion_record["hDays"], field="champion.hDays"),
                "topK": require_int(champion_record["topK"], field="champion.topK"),
            },
            "selectionLaw": nested(protocol, "trials", "selection"),
            "holdoutOpened": False,
        }
        candidate_raw = write_json_once(CANDIDATE_SEAL_PATH, candidate_seal)
        candidate_sha = sha256_bytes(candidate_raw)
    except Exception as error:
        result = terminal_result(
            phase="DEVELOPMENT",
            reason=sanitized_reason(error),
            freeze_sha=freeze_sha,
            development_marker_sha=development_marker_sha,
        )
        finalize_result(
            result,
            {
                **proof_base,
                "holdoutOpened": False,
                "terminalUnmeasured": True,
            },
        )
        return
    holdout_payload = {
        **marker_payload(
            schema="VG13HoldoutOpenMarkerV1",
            phase="HOLDOUT",
            freeze_sha=freeze_sha,
            source_manifest_sha=source_manifest_sha,
        ),
        "candidateSealSha256": candidate_sha,
        "championTrialId": champion_id,
    }
    external_holdout_raw = exclusive_external_marker(
        external / "holdout-open-marker.v1.json", holdout_payload
    )
    write_once(HOLDOUT_MARKER_PATH, external_holdout_raw)
    holdout_marker_sha = sha256_bytes(external_holdout_raw)
    try:
        holdout_only_bars = load_bars_for_months(
            source,
            source_root=source_root,
            months=set(month_range("2026-03", "2026-06")),
        )
        all_bars = merge_bars(development_bars, holdout_only_bars)
        champion_trial = cast(Trial, development_internal[champion_id]["trial"])
        holdout_records, holdout_internal, _ = evaluate_partition(
            protocol,
            all_bars,
            entry_start=date(2026, 3, 1),
            entry_end=date(2026, 6, 23),
            trials=(champion_trial,),
        )
        holdout_record = holdout_records[0]
        holdout_gate_status = holdout_gates(holdout_record, holdout_internal[champion_id])
        development_pass = all_true(champion_gates)
        holdout_pass = all_true(holdout_gate_status)
        verdict = "GO" if development_pass and holdout_pass else "NO_GO"
        result = {
            "schema": "VG13ResultV1",
            "taskId": "V-G13",
            "verdict": verdict,
            "terminal": True,
            "freezeSha256": freeze_sha,
            "developmentMarkerSha256": development_marker_sha,
            "developmentResultsSha256": sha256_path(DEVELOPMENT_RESULTS_PATH),
            "candidateSealSha256": candidate_sha,
            "holdoutMarkerSha256": holdout_marker_sha,
            "holdoutOpened": True,
            "holdoutOpenCount": 1,
            "championTrialId": champion_id,
            "developmentPbo": pbo,
            "developmentGates": champion_gates,
            "developmentAllGatesPassed": development_pass,
            "holdout": holdout_record,
            "holdoutGates": holdout_gate_status,
            "holdoutAllGatesPassed": holdout_pass,
            "repairOrRerunAllowed": False,
            "truth": TRUTH,
            "limitation": LIMITATION,
        }
        finalize_result(
            result,
            {
                **proof_base,
                "verifiedCompressedArchiveCount": verified_archives,
                "developmentSourceMonthsOpened": ["2025-04", "2026-02"],
                "candidateSealedBeforeHoldoutOpen": True,
                "candidateSealSha256": candidate_sha,
                "holdoutMarkerSha256": holdout_marker_sha,
                "holdoutSourceMonthsOpened": ["2026-03", "2026-06"],
                "holdoutOpenCount": 1,
                "trialCount": 6,
                "matchedHighRvControl": True,
                "familywiseHolm": True,
                "pboSplitCount": 70,
                "terminalUnmeasured": False,
            },
        )
    except Exception as error:
        result = terminal_result(
            phase="HOLDOUT",
            reason=sanitized_reason(error),
            freeze_sha=freeze_sha,
            development_marker_sha=development_marker_sha,
            holdout_marker_sha=holdout_marker_sha,
            candidate_seal_sha=candidate_sha,
        )
        finalize_result(
            result,
            {
                **proof_base,
                "candidateSealedBeforeHoldoutOpen": True,
                "candidateSealSha256": candidate_sha,
                "holdoutMarkerSha256": holdout_marker_sha,
                "holdoutOpenCount": 1,
                "terminalUnmeasured": True,
            },
        )


def parser() -> argparse.ArgumentParser:
    argument_parser = argparse.ArgumentParser(description=__doc__)
    subcommands = argument_parser.add_subparsers(dest="command", required=True)
    freeze = subcommands.add_parser("freeze")
    freeze.add_argument("--source-root", type=Path, required=True)
    run = subcommands.add_parser("run")
    run.add_argument("--source-root", type=Path, required=True)
    run.add_argument("--external-state-root", type=Path, required=True)
    return argument_parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = parser().parse_args(argv)
    try:
        if arguments.command == "freeze":
            freeze_packet(arguments.source_root)
        else:
            run_packet(arguments.source_root, arguments.external_state_root)
    except EvidenceError as error:
        print(f"V-G13 REFUSED: {error}", file=sys.stderr)
        return 2
    print(f"V-G13 {arguments.command.upper()} COMPLETE")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
