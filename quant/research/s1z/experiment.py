#!/usr/bin/env python3
"""Network-free lifecycle and evaluator for sealed S-1Z."""

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
import statistics
import subprocess
import sys
import zipfile
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any, cast

PACKET = Path(__file__).resolve().parent
REPO_ROOT = PACKET.parents[2]
PROTOCOL_PATH = PACKET / "protocol.v1.json"
SEEDS_PATH = PACKET / "seed-table.v1.json"
MANIFEST_PATH = PACKET / "source-manifest.v1.json"
AUDIT_PATH = PACKET / "input-audit.v1.json"
FREEZE_PATH = PACKET / "freeze.v1.json"
MARKER_PATH = PACKET / "run-marker.v1.json"
CONSUMED_PATH = PACKET / "body-consumed.v1.json"
LEDGER_PATH = PACKET / "trial-ledger.v1.json"
RESULT_PATH = PACKET / "result.v1.json"
VERDICT_PATH = PACKET / "verdict.v1.json"
SHA256SUMS_PATH = PACKET / "SHA256SUMS"
STATE_ROOT = Path(
    os.environ.get(
        "S1Z_STATE_ROOT",
        "/private/tmp/cosmos-s1z-residual-momentum-1be1-8fad-state",
    )
)
RAW_ROOT = STATE_ROOT / "raw"
CONSUMPTION_ROOT = STATE_ROOT / "consumption"

BASE_COMMIT = "a169b123fb186d1943a75ad648552c4d95be1be1"
SCOPE_PREFIX = "quant/research/s1z/"
SOURCE_START = date(2025, 1, 1)
EVALUATION_START = date(2025, 6, 22)
EVALUATION_END = date(2026, 6, 22)
DEV_DECISION_START = date(2025, 6, 23)
DEV_DECISION_END = date(2026, 1, 27)
DEV_METRIC_END = date(2026, 2, 2)
HOLDOUT_DECISION_START = date(2026, 2, 9)
HOLDOUT_DECISION_END = date(2026, 6, 16)
HOUR_MS = 3_600_000
DAY_MS = 86_400_000
BOOTSTRAP_REPLICATES = 4096
PRIMARY_TRIAL_ID = "w120_l28_h3"

STATIC_FILES = (
    "DISTINCTNESS.md",
    "OFFICIAL_SOURCE_RESEARCH.md",
    "README.md",
    "__init__.py",
    "acquire.py",
    "experiment.py",
    "protocol.v1.json",
    "seed-table.v1.json",
    "test_s1z.py",
    "verifier.py",
)
SOURCE_FILES = ("source-manifest.v1.json", "input-audit.v1.json")
TERMINAL_FILES = (
    "body-consumed.v1.json",
    "trial-ledger.v1.json",
    "result.v1.json",
    "verdict.v1.json",
)
KLINE_HEADER = (
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
FUNDING_HEADER = ("calc_time", "funding_interval_hours", "last_funding_rate")

SCENARIOS: dict[str, tuple[float, float]] = {
    "base": (5.0, 5.0),
    "stress": (10.0, 10.0),
    "severe": (15.0, 25.0),
}
PARTICIPATION: dict[str, float] = {
    "base": 0.00005,
    "stress": 0.000025,
    "severe": 0.00001,
}


class S1ZError(RuntimeError):
    """S-1Z lifecycle or measurement refusal."""


@dataclass(frozen=True, slots=True)
class Trial:
    trial_id: str
    regression_days: int
    formation_days: int
    holding_days: int


@dataclass(frozen=True, slots=True)
class HourBar:
    open: float
    close: float
    quote_volume: float


@dataclass(frozen=True, slots=True)
class ResidualPoint:
    z: float
    beta_btc: float
    beta_eth: float


@dataclass(frozen=True, slots=True)
class FundingSeries:
    times: tuple[int, ...]
    rates: tuple[float, ...]


@dataclass(slots=True)
class TrialRun:
    trial: Trial
    dates: tuple[date, ...]
    daily_gross: list[float]
    daily_funding: list[float]
    daily_cost: dict[str, list[float]]
    daily_net: dict[str, list[float]]
    asset_net: dict[str, dict[tuple[date, str], float]]
    turnover: dict[tuple[date, str], float]
    active_sleeves: int = 0
    cash_decisions: int = 0
    traded_symbols: set[str] = field(default_factory=set)
    ex_ante_abs_btc: list[float] = field(default_factory=list)
    ex_ante_abs_eth: list[float] = field(default_factory=list)
    ex_ante_abs_dollar: list[float] = field(default_factory=list)


@dataclass(frozen=True, slots=True)
class LegCashflows:
    cost_events: dict[str, tuple[tuple[date, float], ...]]
    exit_notional: float
    funding_events: tuple[tuple[date, float], ...]
    gross_events: tuple[tuple[date, float], ...]


@dataclass(frozen=True, slots=True)
class SourceData:
    contract: dict[str, dict[int, HourBar]]
    mark: dict[str, dict[int, float]]
    funding: dict[str, FundingSeries]
    daily_dates: tuple[date, ...]
    daily_returns: dict[str, dict[date, float]]


def canonical_bytes(value: object) -> bytes:
    return (
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n"
    ).encode()


def write_json(path: Path, value: object) -> None:
    raw = canonical_bytes(value)
    with path.open("xb") as handle:
        handle.write(raw)
        handle.flush()
        os.fsync(handle.fileno())


def load_json(path: Path, *, canonical: bool = True) -> dict[str, Any]:
    raw = path.read_bytes()
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise S1ZError(f"{path.name} must contain a JSON object")
    if canonical and raw != canonical_bytes(value):
        raise S1ZError(f"{path.name} must be canonical JSON")
    return cast(dict[str, Any], value)


def sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def utc_now() -> str:
    return datetime.now(tz=UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def git(*args: str) -> str:
    completed = subprocess.run(
        ("git", *args),
        cwd=REPO_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        raise S1ZError(f"git {' '.join(args)} failed: {completed.stderr.strip()}")
    return completed.stdout.strip()


def require_git_ready() -> str:
    if git("status", "--porcelain=v1", "--untracked-files=all"):
        raise S1ZError("worktree must be clean")
    head = git("rev-parse", "HEAD")
    upstream = git("rev-parse", "@{upstream}")
    if head != upstream:
        raise S1ZError("HEAD must equal configured upstream")
    if git("rev-list", "--merges", f"{BASE_COMMIT}..HEAD", "--count") != "0":
        raise S1ZError("candidate history must be merge-free")
    changed = git("diff", "--name-only", f"{BASE_COMMIT}..HEAD").splitlines()
    if any(not path.startswith(SCOPE_PREFIX) for path in changed):
        raise S1ZError("candidate history exceeds exclusive S-1Z scope")
    return head


def trial_family() -> tuple[Trial, ...]:
    return tuple(
        Trial(f"w{window}_l{formation}_h{holding}", window, formation, holding)
        for window in (60, 120)
        for formation in (14, 28)
        for holding in (1, 3, 5)
    )


def protocol_symbols_months() -> tuple[tuple[str, ...], tuple[str, ...], tuple[str, ...]]:
    protocol = load_json(PROTOCOL_PATH)
    universe = cast(dict[str, Any], protocol["universe"])
    data = cast(dict[str, Any], protocol["data"])
    factors = tuple(cast(list[str], universe["factorOnly"]))
    trade = tuple(cast(list[str], universe["tradeSymbols"]))
    months = tuple(cast(list[str], data["months"]))
    return factors, trade, months


def freeze() -> None:
    if FREEZE_PATH.exists() or MARKER_PATH.exists() or RESULT_PATH.exists():
        raise S1ZError("freeze/run artifact already exists")
    head = require_git_ready()
    audit = load_json(AUDIT_PATH)
    if (
        audit.get("status") != "PASS"
        or audit.get("economicValuesEmitted") is not False
        or audit.get("sourceBodiesOpened") is not False
    ):
        raise S1ZError("input audit did not pass the no-economic-output contract")
    manifest = load_json(MANIFEST_PATH)
    if manifest.get("artifactCount") != 864:
        raise S1ZError("source manifest must bind 864 artifacts")
    static_hashes = {name: sha256_path(PACKET / name) for name in (*STATIC_FILES, *SOURCE_FILES)}
    trials = [
        {
            "formationDays": trial.formation_days,
            "holdingDays": trial.holding_days,
            "regressionDays": trial.regression_days,
            "trialId": trial.trial_id,
        }
        for trial in trial_family()
    ]
    receipt: dict[str, object] = {
        "artifactCount": 864,
        "baseCommit": BASE_COMMIT,
        "createdAt": utc_now(),
        "emptyOutcomeState": all(not (PACKET / name).exists() for name in TERMINAL_FILES),
        "inputCommit": head,
        "inputTree": git("rev-parse", "HEAD^{tree}"),
        "primaryTrialId": PRIMARY_TRIAL_ID,
        "schemaVersion": "s1z.freeze.v1",
        "sourceRoot": str(STATE_ROOT),
        "staticSha256": static_hashes,
        "trialFamily": trials,
        "trialFamilySha256": hashlib.sha256(canonical_bytes(trials)).hexdigest(),
    }
    if not receipt["emptyOutcomeState"]:
        raise S1ZError("outcome artifacts existed before freeze")
    write_json(FREEZE_PATH, receipt)
    print(f"FROZEN input={head[-8:]} digest={sha256_path(FREEZE_PATH)}")


def arm() -> None:
    if MARKER_PATH.exists() or RESULT_PATH.exists():
        raise S1ZError("run marker or result already exists")
    head = require_git_ready()
    freeze_receipt = load_json(FREEZE_PATH)
    if freeze_receipt.get("inputCommit") != git("rev-parse", "HEAD^"):
        raise S1ZError("freeze does not directly follow its bound input commit")
    changed = git("diff", "--name-only", "HEAD^..HEAD").splitlines()
    if changed != [SCOPE_PREFIX + "freeze.v1.json"]:
        raise S1ZError("freeze commit chronology is invalid")
    marker: dict[str, object] = {
        "armedAt": utc_now(),
        "bodyOpenCountBefore": 0,
        "freezeCommit": head,
        "freezeSha256": sha256_path(FREEZE_PATH),
        "primaryTrialId": PRIMARY_TRIAL_ID,
        "schemaVersion": "s1z.run-marker.v1",
    }
    write_json(MARKER_PATH, marker)
    print(f"ARMED freeze={head[-8:]}")


def exclusive_consumption_receipt(head: str) -> dict[str, object]:
    marker = load_json(MARKER_PATH)
    parent = git("rev-parse", "HEAD^")
    if marker.get("freezeCommit") != parent:
        raise S1ZError("run-marker parent does not equal frozen commit")
    changed = git("diff", "--name-only", "HEAD^..HEAD").splitlines()
    if changed != [SCOPE_PREFIX + "run-marker.v1.json"]:
        raise S1ZError("run-marker commit is not an exclusive phase")
    receipt: dict[str, object] = {
        "consumedAt": utc_now(),
        "freezeSha256": sha256_path(FREEZE_PATH),
        "protocolSha256": sha256_path(PROTOCOL_PATH),
        "runMarkerCommit": head,
        "runMarkerSha256": sha256_path(MARKER_PATH),
        "schemaVersion": "s1z.body-consumed.v1",
    }
    CONSUMPTION_ROOT.mkdir(parents=True, exist_ok=True)
    lock_path = CONSUMPTION_ROOT / f"{head}.json"
    raw = canonical_bytes(receipt)
    descriptor = os.open(lock_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        os.write(descriptor, raw)
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    directory = os.open(CONSUMPTION_ROOT, os.O_RDONLY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)
    write_json(CONSUMED_PATH, receipt)
    return receipt


def artifact_path(dataset: str, symbol: str, month: str) -> Path:
    if dataset in {"klines", "markPriceKlines"}:
        filename = f"{symbol}-1h-{month}.zip"
        return RAW_ROOT / "data" / "futures" / "um" / "monthly" / dataset / symbol / "1h" / filename
    filename = f"{symbol}-fundingRate-{month}.zip"
    return RAW_ROOT / "data" / "futures" / "um" / "monthly" / dataset / symbol / filename


def zip_csv(path: Path) -> list[list[str]]:
    with zipfile.ZipFile(path) as archive:
        members = archive.infolist()
        if len(members) != 1:
            raise S1ZError(f"{path.name} member count changed")
        raw = archive.read(members[0])
    return list(csv.reader(io.StringIO(raw.decode("utf-8"), newline="")))


def month_bounds_ms(month: str) -> tuple[int, int]:
    start = datetime.strptime(month + "-01", "%Y-%m-%d").replace(tzinfo=UTC)
    if start.month == 12:
        end = start.replace(year=start.year + 1, month=1)
    else:
        end = start.replace(month=start.month + 1)
    return int(start.timestamp() * 1000), int(end.timestamp() * 1000)


def finite_float(text: str, label: str, *, positive: bool = False) -> float:
    try:
        value = float(text)
    except ValueError as error:
        raise S1ZError(f"{label} is not numeric") from error
    if not math.isfinite(value) or (positive and value <= 0):
        raise S1ZError(f"{label} is invalid")
    return value


def verify_frozen_artifact(path: Path, expected_sha: str) -> None:
    if sha256_path(path) != expected_sha:
        raise S1ZError(f"frozen artifact mutated: {path.name}")


def load_source_data() -> SourceData:
    manifest = load_json(MANIFEST_PATH)
    artifacts = cast(list[dict[str, Any]], manifest["artifacts"])
    expected = {
        cast(str, item["zipUrl"]).removeprefix("https://data.binance.vision/"): cast(
            str, item["zipSha256"]
        )
        for item in artifacts
    }
    factors, trade_symbols, months = protocol_symbols_months()
    symbols = tuple(sorted((*factors, *trade_symbols)))
    contract: dict[str, dict[int, HourBar]] = {}
    mark: dict[str, dict[int, float]] = {}
    funding: dict[str, FundingSeries] = {}
    start_ms = int(
        datetime.combine(SOURCE_START, datetime.min.time(), tzinfo=UTC).timestamp() * 1000
    )
    end_ms = int(
        datetime.combine(EVALUATION_END, datetime.min.time(), tzinfo=UTC).timestamp() * 1000
    )

    for symbol in symbols:
        symbol_contract: dict[int, HourBar] = {}
        symbol_mark: dict[int, float] = {}
        funding_rows: list[tuple[int, float, int]] = []
        for month in months:
            month_start_ms, month_end_ms = month_bounds_ms(month)
            for dataset in ("klines", "markPriceKlines", "fundingRate"):
                path = artifact_path(dataset, symbol, month)
                key = str(path.relative_to(RAW_ROOT))
                expected_sha = expected.get(key)
                if expected_sha is None:
                    raise S1ZError(f"manifest identity missing for {key}")
                verify_frozen_artifact(path, expected_sha)
                rows = zip_csv(path)
                if dataset in {"klines", "markPriceKlines"}:
                    if not rows or tuple(rows[0]) != KLINE_HEADER:
                        raise S1ZError(f"{path.name} schema changed")
                    previous: int | None = None
                    for row_number, row in enumerate(rows[1:], start=2):
                        if len(row) != 12:
                            raise S1ZError(f"{path.name}:{row_number} width changed")
                        try:
                            timestamp = int(row[0])
                            close_time = int(row[6])
                        except ValueError as error:
                            raise S1ZError(
                                f"{path.name}:{row_number} timestamp is not integer ms"
                            ) from error
                        if not month_start_ms <= timestamp < month_end_ms:
                            raise S1ZError(f"{path.name}:{row_number} outside month")
                        if previous is not None and timestamp <= previous:
                            raise S1ZError(f"{path.name} timestamps not strictly increasing")
                        previous = timestamp
                        if close_time != timestamp + HOUR_MS - 1:
                            raise S1ZError(f"{path.name}:{row_number} close boundary changed")
                        open_price = finite_float(
                            row[1], f"{path.name}:{row_number}:open", positive=True
                        )
                        finite_float(row[2], f"{path.name}:{row_number}:high", positive=True)
                        finite_float(row[3], f"{path.name}:{row_number}:low", positive=True)
                        close_price = finite_float(
                            row[4], f"{path.name}:{row_number}:close", positive=True
                        )
                        quote_volume = finite_float(
                            row[7], f"{path.name}:{row_number}:quote_volume"
                        )
                        if quote_volume < 0:
                            raise S1ZError(f"{path.name}:{row_number} negative quote volume")
                        if not (start_ms <= timestamp < end_ms):
                            continue
                        if dataset == "klines":
                            if timestamp in symbol_contract:
                                raise S1ZError(f"{symbol} duplicate contract hour {timestamp}")
                            symbol_contract[timestamp] = HourBar(
                                open=open_price,
                                close=close_price,
                                quote_volume=quote_volume,
                            )
                        else:
                            if timestamp in symbol_mark:
                                raise S1ZError(f"{symbol} duplicate mark hour {timestamp}")
                            symbol_mark[timestamp] = open_price
                else:
                    if not rows or tuple(rows[0]) != FUNDING_HEADER:
                        raise S1ZError(f"{path.name} schema changed")
                    previous = None
                    for row_number, row in enumerate(rows[1:], start=2):
                        if len(row) != 3:
                            raise S1ZError(f"{path.name}:{row_number} width changed")
                        try:
                            timestamp = int(row[0])
                            interval = int(row[1])
                        except ValueError as error:
                            raise S1ZError(
                                f"{path.name}:{row_number} funding field invalid"
                            ) from error
                        if not month_start_ms <= timestamp < month_end_ms:
                            raise S1ZError(f"{path.name}:{row_number} outside month")
                        if previous is not None and timestamp <= previous:
                            raise S1ZError(f"{path.name} funding timestamps not increasing")
                        previous = timestamp
                        if interval not in {1, 2, 4, 8}:
                            raise S1ZError(f"{path.name}:{row_number} interval is not 1/2/4/8")
                        rate = finite_float(row[2], f"{path.name}:{row_number}:funding_rate")
                        if start_ms <= timestamp < end_ms:
                            funding_rows.append((timestamp, rate, interval))
        expected_hours = (end_ms - start_ms) // HOUR_MS
        if len(symbol_contract) != expected_hours or len(symbol_mark) != expected_hours:
            raise S1ZError(
                f"{symbol} incomplete required hourly grid "
                f"contract={len(symbol_contract)} mark={len(symbol_mark)} "
                f"expected={expected_hours}"
            )
        for offset in range(expected_hours):
            required = start_ms + offset * HOUR_MS
            if required not in symbol_contract or required not in symbol_mark:
                raise S1ZError(f"{symbol} missing required hour {required}")
        if sum(bar.quote_volume for bar in symbol_contract.values()) <= 0:
            raise S1ZError(f"{symbol} required quote volume is not positive")
        contract[symbol] = symbol_contract
        mark[symbol] = symbol_mark
        funding_rows.sort()
        if not funding_rows:
            raise S1ZError(f"{symbol} has no required funding events")
        if funding_rows[0][0] - start_ms > 8 * HOUR_MS + 60_000:
            raise S1ZError(f"{symbol} funding starts too late")
        if end_ms - funding_rows[-1][0] > 8 * HOUR_MS + 60_000:
            raise S1ZError(f"{symbol} funding ends too early")
        for prior, current in itertools.pairwise(funding_rows):
            if current[0] == prior[0]:
                raise S1ZError(f"{symbol} duplicate funding time {current[0]}")
            delta = current[0] - prior[0]
            lower = min(prior[2], current[2]) * HOUR_MS - 60_000
            upper = max(prior[2], current[2]) * HOUR_MS + 60_000
            if not lower <= delta <= upper:
                raise S1ZError(f"{symbol} funding cadence gap at {current[0]}")
        funding[symbol] = FundingSeries(
            times=tuple(item[0] for item in funding_rows),
            rates=tuple(item[1] for item in funding_rows),
        )

    daily_dates: list[date] = []
    cursor = SOURCE_START
    while cursor < EVALUATION_END:
        daily_dates.append(cursor)
        cursor += timedelta(days=1)
    daily_returns: dict[str, dict[date, float]] = {}
    for symbol in symbols:
        closes: dict[date, float] = {}
        for day in daily_dates:
            timestamp = (
                int(datetime.combine(day, datetime.min.time(), tzinfo=UTC).timestamp() * 1000)
                + 23 * HOUR_MS
            )
            bar = contract[symbol].get(timestamp)
            if bar is None:
                raise S1ZError(f"{symbol} missing daily close at {day}")
            closes[day] = bar.close
        returns: dict[date, float] = {}
        for daily_prior, daily_current in itertools.pairwise(daily_dates):
            returns[daily_current] = math.log(closes[daily_current] / closes[daily_prior])
        daily_returns[symbol] = returns
    return SourceData(
        contract=contract,
        mark=mark,
        funding=funding,
        daily_dates=tuple(daily_dates),
        daily_returns=daily_returns,
    )


def solve3(matrix: list[list[float]], vector: list[float]) -> tuple[float, float, float]:
    augmented = [[*row, value] for row, value in zip(matrix, vector, strict=True)]
    for column in range(3):
        pivot = max(range(column, 3), key=lambda row: abs(augmented[row][column]))
        if abs(augmented[pivot][column]) < 1e-14:
            raise S1ZError("singular three-factor system")
        augmented[column], augmented[pivot] = augmented[pivot], augmented[column]
        scale = augmented[column][column]
        augmented[column] = [value / scale for value in augmented[column]]
        for row in range(3):
            if row == column:
                continue
            factor = augmented[row][column]
            augmented[row] = [
                value - factor * pivot_value
                for value, pivot_value in zip(augmented[row], augmented[column], strict=True)
            ]
    return augmented[0][3], augmented[1][3], augmented[2][3]


def invert3(matrix: list[list[float]]) -> list[list[float]]:
    columns: list[tuple[float, float, float]] = []
    for index in range(3):
        vector = [0.0, 0.0, 0.0]
        vector[index] = 1.0
        columns.append(solve3([row[:] for row in matrix], vector))
    return [[columns[column][row] for column in range(3)] for row in range(3)]


def fit_ols(
    y: list[float],
    btc: list[float],
    eth: list[float],
) -> tuple[float, float, float, float]:
    n = len(y)
    if n != len(btc) or n != len(eth) or n < 4:
        raise S1ZError("invalid OLS inputs")
    matrix = [
        [float(n), sum(btc), sum(eth)],
        [
            sum(btc),
            sum(value * value for value in btc),
            sum(a * b for a, b in zip(btc, eth, strict=True)),
        ],
        [
            sum(eth),
            sum(a * b for a, b in zip(btc, eth, strict=True)),
            sum(value * value for value in eth),
        ],
    ]
    vector = [
        sum(y),
        sum(a * b for a, b in zip(btc, y, strict=True)),
        sum(a * b for a, b in zip(eth, y, strict=True)),
    ]
    alpha, beta_btc, beta_eth = solve3(matrix, vector)
    squared = sum(
        (target - alpha - beta_btc * factor_btc - beta_eth * factor_eth) ** 2
        for target, factor_btc, factor_eth in zip(y, btc, eth, strict=True)
    )
    sigma = math.sqrt(squared / (n - 3))
    if sigma <= 1e-12 or not math.isfinite(sigma):
        raise S1ZError("residual volatility is not measurable")
    return alpha, beta_btc, beta_eth, sigma


def residual_points(data: SourceData) -> dict[tuple[str, int, date], ResidualPoint]:
    _, trade_symbols, _ = protocol_symbols_months()
    return_dates = tuple(sorted(data.daily_returns["BTCUSDT"]))
    points: dict[tuple[str, int, date], ResidualPoint] = {}
    btc_all = [data.daily_returns["BTCUSDT"][day] for day in return_dates]
    eth_all = [data.daily_returns["ETHUSDT"][day] for day in return_dates]
    for symbol in trade_symbols:
        y_all = [data.daily_returns[symbol][day] for day in return_dates]
        for window in (60, 120):
            for index in range(window, len(return_dates)):
                alpha, beta_btc, beta_eth, sigma = fit_ols(
                    y_all[index - window : index],
                    btc_all[index - window : index],
                    eth_all[index - window : index],
                )
                residual = (
                    y_all[index] - alpha - beta_btc * btc_all[index] - beta_eth * eth_all[index]
                )
                points[(symbol, window, return_dates[index])] = ResidualPoint(
                    z=residual / sigma,
                    beta_btc=beta_btc,
                    beta_eth=beta_eth,
                )
    return points


def project_weights(
    longs: tuple[str, ...],
    shorts: tuple[str, ...],
    points: dict[str, ResidualPoint],
) -> dict[str, float] | None:
    symbols = (*longs, *shorts)
    initial = [0.125] * len(longs) + [-0.125] * len(shorts)
    rows = [
        [1.0 for _ in symbols],
        [points[symbol].beta_btc for symbol in symbols],
        [points[symbol].beta_eth for symbol in symbols],
    ]
    matrix = [
        [sum(rows[i][k] * rows[j][k] for k in range(len(symbols))) for j in range(3)]
        for i in range(3)
    ]
    vector = [sum(rows[i][k] * initial[k] for k in range(len(symbols))) for i in range(3)]
    try:
        multipliers = solve3(matrix, vector)
    except S1ZError:
        return None
    weights = [
        initial[k] - sum(rows[row][k] * multipliers[row] for row in range(3))
        for k in range(len(symbols))
    ]
    gross = sum(abs(value) for value in weights)
    if gross <= 1e-12:
        return None
    weights = [value / gross for value in weights]
    if any(value <= 0.01 for value in weights[: len(longs)]):
        return None
    if any(value >= -0.01 for value in weights[len(longs) :]):
        return None
    if any(abs(value) > 0.30 for value in weights):
        return None
    dollar = sum(weights)
    btc = sum(
        weight * points[symbol].beta_btc for symbol, weight in zip(symbols, weights, strict=True)
    )
    eth = sum(
        weight * points[symbol].beta_eth for symbol, weight in zip(symbols, weights, strict=True)
    )
    if max(abs(dollar), abs(btc), abs(eth)) > 1e-8:
        return None
    return dict(zip(symbols, weights, strict=True))


def evaluation_dates() -> tuple[date, ...]:
    values: list[date] = []
    cursor = EVALUATION_START
    while cursor < EVALUATION_END:
        values.append(cursor)
        cursor += timedelta(days=1)
    return tuple(values)


def decision_dates(include_holdout: bool) -> tuple[date, ...]:
    values: list[date] = []
    cursor = DEV_DECISION_START
    while cursor <= DEV_DECISION_END:
        values.append(cursor)
        cursor += timedelta(days=1)
    if include_holdout:
        cursor = HOLDOUT_DECISION_START
        while cursor <= HOLDOUT_DECISION_END:
            values.append(cursor)
            cursor += timedelta(days=1)
    return tuple(values)


def signal_dates(decision: date, formation_days: int) -> tuple[date, ...]:
    latest = decision - timedelta(days=2)
    return tuple(latest - timedelta(days=offset) for offset in range(formation_days - 1, -1, -1))


def timestamp_ms(day: date, hour: int = 0) -> int:
    return (
        int(datetime.combine(day, datetime.min.time(), tzinfo=UTC).timestamp() * 1000)
        + hour * HOUR_MS
    )


def funding_cash_events(
    data: SourceData,
    symbol: str,
    entry_ms: int,
    exit_ms: int,
    side: float,
    quantity: float,
) -> list[tuple[date, float]]:
    series = data.funding[symbol]
    start = bisect.bisect_left(series.times, entry_ms)
    end = bisect.bisect_right(series.times, exit_ms)
    events: list[tuple[date, float]] = []
    for index in range(start, end):
        event_time = series.times[index]
        mark_time = event_time - event_time % HOUR_MS
        mark = data.mark[symbol].get(mark_time)
        if mark is None:
            raise S1ZError(f"{symbol} missing funding mark at {event_time}")
        cash = -side * abs(quantity) * mark * series.rates[index]
        if event_time in {entry_ms, exit_ms} and cash > 0:
            # Boundary ordering is not archived. Retain debits and discard credits.
            continue
        event_at = datetime.fromtimestamp(event_time / 1000, tz=UTC)
        remainder_ms = event_time % DAY_MS
        if remainder_ms <= HOUR_MS:
            bucket_end = event_at.date()
        else:
            bucket_end = event_at.date() + timedelta(days=1)
        events.append((bucket_end, cash))
    return events


def prior_quote_volume(data: SourceData, symbol: str, fill_ms: int) -> float:
    values = [
        data.contract[symbol][fill_ms - offset * HOUR_MS].quote_volume for offset in range(1, 25)
    ]
    return sum(values)


def leg_cashflows(
    data: SourceData,
    symbol: str,
    decision: date,
    holding_days: int,
    side: float,
    entry_notional: float,
) -> LegCashflows:
    entry_ms = timestamp_ms(decision, 1)
    exit_day = decision + timedelta(days=holding_days)
    exit_ms = timestamp_ms(exit_day, 1)
    entry = data.contract[symbol].get(entry_ms)
    exit_bar = data.contract[symbol].get(exit_ms)
    if entry is None or exit_bar is None:
        raise S1ZError(f"missing execution bar for {symbol}")
    quantity = entry_notional / entry.open
    gross_events: list[tuple[date, float]] = []
    for offset in range(1, holding_days + 1):
        prior_day = decision + timedelta(days=offset - 1)
        mark_day = decision + timedelta(days=offset)
        prior_bar = data.contract[symbol].get(timestamp_ms(prior_day, 1))
        next_bar = data.contract[symbol].get(timestamp_ms(mark_day, 1))
        if prior_bar is None or next_bar is None:
            raise S1ZError(f"missing daily mark bar for {symbol} at {mark_day}")
        gross_events.append((mark_day, side * quantity * (next_bar.open - prior_bar.open)))
    exit_notional = abs(quantity * exit_bar.open)
    cost_events: dict[str, tuple[tuple[date, float], ...]] = {
        scenario: (
            (decision, entry_notional * (fee_bp + adverse_bp) / 10_000.0),
            (exit_day, exit_notional * (fee_bp + adverse_bp) / 10_000.0),
        )
        for scenario, (fee_bp, adverse_bp) in SCENARIOS.items()
    }
    return LegCashflows(
        cost_events=cost_events,
        exit_notional=exit_notional,
        funding_events=tuple(
            funding_cash_events(
                data,
                symbol,
                entry_ms,
                exit_ms,
                side,
                quantity,
            )
        ),
        gross_events=tuple(gross_events),
    )


def run_trial(
    trial: Trial,
    data: SourceData,
    points: dict[tuple[str, int, date], ResidualPoint],
    *,
    include_holdout: bool,
) -> TrialRun:
    dates = evaluation_dates()
    index_by_date = {day: index for index, day in enumerate(dates)}
    daily_gross = [0.0] * len(dates)
    daily_funding = [0.0] * len(dates)
    daily_cost = {scenario: [0.0] * len(dates) for scenario in SCENARIOS}
    daily_net = {scenario: [0.0] * len(dates) for scenario in SCENARIOS}
    asset_net: dict[str, dict[tuple[date, str], float]] = {
        scenario: defaultdict(float) for scenario in SCENARIOS
    }
    run = TrialRun(
        trial=trial,
        dates=dates,
        daily_gross=daily_gross,
        daily_funding=daily_funding,
        daily_cost=daily_cost,
        daily_net=daily_net,
        asset_net=asset_net,
        turnover=defaultdict(float),
    )
    _, trade_symbols, _ = protocol_symbols_months()
    for decision in decision_dates(include_holdout):
        days_for_signal = signal_dates(decision, trial.formation_days)
        latest_points: dict[str, ResidualPoint] = {}
        scores: list[tuple[float, str]] = []
        for symbol in trade_symbols:
            series: list[ResidualPoint] = []
            for signal_day in days_for_signal:
                point = points.get((symbol, trial.regression_days, signal_day))
                if point is None:
                    raise S1ZError(f"{trial.trial_id} lacks {symbol} residual at {signal_day}")
                series.append(point)
            latest_points[symbol] = series[-1]
            score = sum(point.z for point in series) / math.sqrt(trial.formation_days)
            scores.append((round(score, 12), symbol))
        scores.sort()
        short_boundary_tied = abs(scores[3][0] - scores[4][0]) <= 1e-12
        long_boundary_tied = abs(scores[-4][0] - scores[-5][0]) <= 1e-12
        if short_boundary_tied or long_boundary_tied:
            run.cash_decisions += 1
            continue
        shorts = tuple(symbol for _, symbol in scores[:4])
        longs = tuple(symbol for _, symbol in scores[-4:])
        weights = project_weights(longs, shorts, latest_points)
        if weights is None:
            run.cash_decisions += 1
            continue
        exit_day = decision + timedelta(days=trial.holding_days)
        if exit_day not in index_by_date:
            raise S1ZError(f"{trial.trial_id} exit exceeds evaluation window")
        sleeve_gross = 1000.0 / trial.holding_days
        dollar = sum(weights.values())
        btc_beta = sum(
            weight * latest_points[symbol].beta_btc for symbol, weight in weights.items()
        )
        eth_beta = sum(
            weight * latest_points[symbol].beta_eth for symbol, weight in weights.items()
        )
        run.ex_ante_abs_dollar.append(abs(dollar))
        run.ex_ante_abs_btc.append(abs(btc_beta))
        run.ex_ante_abs_eth.append(abs(eth_beta))
        run.active_sleeves += 1
        for symbol, weight in weights.items():
            side = 1.0 if weight > 0 else -1.0
            notional = sleeve_gross * abs(weight)
            cashflows = leg_cashflows(
                data,
                symbol,
                decision,
                trial.holding_days,
                side,
                notional,
            )
            for event_day, gross in cashflows.gross_events:
                event_index = index_by_date[event_day]
                run.daily_gross[event_index] += gross
                for scenario in SCENARIOS:
                    run.daily_net[scenario][event_index] += gross
                    run.asset_net[scenario][(event_day, symbol)] += gross
            for event_day, funding in cashflows.funding_events:
                event_index = index_by_date[event_day]
                run.daily_funding[event_index] += funding
                for scenario in SCENARIOS:
                    run.daily_net[scenario][event_index] += funding
                    run.asset_net[scenario][(event_day, symbol)] += funding
            run.traded_symbols.add(symbol)
            run.turnover[(decision, symbol)] += notional / 1000.0
            run.turnover[(exit_day, symbol)] += cashflows.exit_notional / 1000.0
            for scenario, cost_events in cashflows.cost_events.items():
                for event_day, cost in cost_events:
                    event_index = index_by_date[event_day]
                    run.daily_cost[scenario][event_index] += cost
                    run.daily_net[scenario][event_index] -= cost
                    run.asset_net[scenario][(event_day, symbol)] -= cost
    return run


def slice_series(run: TrialRun, scenario: str, start: date, end: date) -> list[float]:
    return [
        value
        for day, value in zip(run.dates, run.daily_net[scenario], strict=True)
        if start <= day < end
    ]


def slice_component(
    values: list[float], dates: tuple[date, ...], start: date, end: date
) -> list[float]:
    return [value for day, value in zip(dates, values, strict=True) if start <= day < end]


def percentile(values: list[float], probability: float) -> float:
    if not values:
        raise S1ZError("percentile requires values")
    ordered = sorted(values)
    position = (len(ordered) - 1) * probability
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    fraction = position - lower
    return ordered[lower] * (1.0 - fraction) + ordered[upper] * fraction


def maximum_drawdown(values: list[float]) -> float:
    equity = 1000.0
    peak = equity
    maximum = 0.0
    for value in values:
        equity += value
        peak = max(peak, equity)
        if peak > 0:
            maximum = max(maximum, (peak - equity) / peak)
    return maximum


def bootstrap(
    series: list[float],
    block: int,
    seed: int,
) -> dict[str, float]:
    n = len(series)
    observed_mean = statistics.fmean(series)
    centered = [value - observed_mean for value in series]
    rng = random.Random(seed)
    raw_totals: list[float] = []
    null_means: list[float] = []
    for _ in range(BOOTSTRAP_REPLICATES):
        indices: list[int] = []
        while len(indices) < n:
            start = rng.randrange(n)
            indices.extend((start + offset) % n for offset in range(block))
        indices = indices[:n]
        raw_totals.append(sum(series[index] for index in indices))
        null_means.append(statistics.fmean(centered[index] for index in indices))
    p_value = (1.0 + sum(value >= observed_mean for value in null_means)) / (
        BOOTSTRAP_REPLICATES + 1.0
    )
    return {
        "blockDays": float(block),
        "lower95Usd": percentile(raw_totals, 0.025),
        "pOneSided": p_value,
        "upper95Usd": percentile(raw_totals, 0.975),
    }


def shared_bootstrap_p_values(
    series_by_trial: dict[str, list[float]],
    *,
    block: int,
    seed: int,
) -> tuple[dict[str, float], float]:
    trial_ids = sorted(series_by_trial)
    n = len(series_by_trial[trial_ids[0]])
    means = {trial_id: statistics.fmean(series_by_trial[trial_id]) for trial_id in trial_ids}
    centered = {
        trial_id: [value - means[trial_id] for value in series_by_trial[trial_id]]
        for trial_id in trial_ids
    }
    exceed = dict.fromkeys(trial_ids, 0)
    white_exceed = 0
    observed_best = max(means.values())
    rng = random.Random(seed)
    for _ in range(BOOTSTRAP_REPLICATES):
        indices: list[int] = []
        while len(indices) < n:
            start = rng.randrange(n)
            indices.extend((start + offset) % n for offset in range(block))
        indices = indices[:n]
        null_means = {
            trial_id: statistics.fmean(centered[trial_id][index] for index in indices)
            for trial_id in trial_ids
        }
        for trial_id in trial_ids:
            if null_means[trial_id] >= means[trial_id]:
                exceed[trial_id] += 1
        if max(null_means.values()) >= observed_best:
            white_exceed += 1
    raw = {
        trial_id: (1.0 + exceed[trial_id]) / (BOOTSTRAP_REPLICATES + 1.0) for trial_id in trial_ids
    }
    white = (1.0 + white_exceed) / (BOOTSTRAP_REPLICATES + 1.0)
    return raw, white


def holm_adjust(raw: dict[str, float]) -> dict[str, float]:
    ordered = sorted(raw, key=lambda trial_id: (raw[trial_id], trial_id))
    adjusted: dict[str, float] = {}
    running = 0.0
    count = len(ordered)
    for rank, trial_id in enumerate(ordered):
        running = max(running, min(1.0, (count - rank) * raw[trial_id]))
        adjusted[trial_id] = running
    return adjusted


def sharpe(values: list[float]) -> float:
    if len(values) < 2:
        return -math.inf
    deviation = statistics.stdev(values)
    if deviation <= 1e-15:
        return -math.inf if statistics.fmean(values) <= 0 else math.inf
    return statistics.fmean(values) / deviation


def cscv_pbo(series_by_trial: dict[str, list[float]]) -> dict[str, object]:
    trial_ids = sorted(series_by_trial)
    n = len(series_by_trial[trial_ids[0]])
    rows = n - n % 8
    block_size = rows // 8
    block_indices = [
        list(range(index * block_size, (index + 1) * block_size)) for index in range(8)
    ]
    bad = 0
    logits: list[float] = []
    combinations = 0
    for chosen in itertools.combinations(range(8), 4):
        in_blocks = set(chosen)
        in_indices = [row for block in in_blocks for row in block_indices[block]]
        out_indices = [
            row for block in range(8) if block not in in_blocks for row in block_indices[block]
        ]
        in_sharpes = {
            trial_id: sharpe([series_by_trial[trial_id][row] for row in in_indices])
            for trial_id in trial_ids
        }
        selected = max(trial_ids, key=lambda trial_id: (in_sharpes[trial_id], trial_id))
        out_sharpes = {
            trial_id: sharpe([series_by_trial[trial_id][row] for row in out_indices])
            for trial_id in trial_ids
        }
        ranking = sorted(trial_ids, key=lambda trial_id: (out_sharpes[trial_id], trial_id))
        rank = ranking.index(selected)
        percentile_rank = (rank + 0.5) / len(trial_ids)
        logits.append(math.log(percentile_rank / (1.0 - percentile_rank)))
        if percentile_rank <= 0.5:
            bad += 1
        combinations += 1
    return {
        "blocks": 8,
        "combinations": combinations,
        "diagnosticOnly": True,
        "logitRankMedian": statistics.median(logits),
        "pbo": bad / combinations,
        "rowsUsed": rows,
    }


def public_capacity(run: TrialRun, data: SourceData, scenario: str) -> dict[str, float | None]:
    capacities: list[float] = []
    for (day, symbol), fraction in sorted(run.turnover.items()):
        if fraction <= 0:
            continue
        fill_ms = timestamp_ms(day, 1)
        quote_volume = prior_quote_volume(data, symbol, fill_ms)
        capacities.append(PARTICIPATION[scenario] * quote_volume / fraction)
    if not capacities:
        return {"minimumUsd": None, "p05Usd": None}
    return {
        "minimumUsd": min(capacities),
        "p05Usd": percentile(capacities, 0.05),
    }


def segment_metrics(
    run: TrialRun,
    scenario: str,
    start: date,
    end: date,
) -> dict[str, object]:
    net = slice_series(run, scenario, start, end)
    gross = slice_component(run.daily_gross, run.dates, start, end)
    funding = slice_component(run.daily_funding, run.dates, start, end)
    costs = slice_component(run.daily_cost[scenario], run.dates, start, end)
    asset_totals: dict[str, float] = defaultdict(float)
    month_totals: dict[str, float] = defaultdict(float)
    for (day, symbol), value in run.asset_net[scenario].items():
        if start <= day < end:
            asset_totals[symbol] += value
            month_totals[day.strftime("%Y-%m")] += value
    best_asset = (
        max(asset_totals, key=lambda symbol: asset_totals[symbol]) if asset_totals else None
    )
    best_month = max(month_totals, key=lambda month: month_totals[month]) if month_totals else None
    total = sum(net)
    return {
        "bestAsset": best_asset,
        "bestAssetContributionUsd": asset_totals.get(best_asset) if best_asset else None,
        "bestMonth": best_month,
        "bestMonthContributionUsd": month_totals.get(best_month) if best_month else None,
        "costUsd": sum(costs),
        "fundingUsd": sum(funding),
        "grossTradingUsd": sum(gross),
        "maximumRealizedDrawdownFraction": maximum_drawdown(net),
        "netAfterRemovingBestAssetUsd": (total - asset_totals[best_asset] if best_asset else None),
        "netAfterRemovingBestMonthUsd": (total - month_totals[best_month] if best_month else None),
        "netUsdPer1000": total,
        "nonzeroDays": sum(abs(value) > 1e-12 for value in net),
        "rows": len(net),
    }


def matmul(left: list[list[float]], right: list[list[float]]) -> list[list[float]]:
    return [
        [
            sum(left[row][k] * right[k][column] for k in range(len(right)))
            for column in range(len(right[0]))
        ]
        for row in range(len(left))
    ]


def ex_post_factor_betas(run: TrialRun, data: SourceData) -> dict[str, object]:
    y = [value / 1000.0 for value in run.daily_net["stress"]]
    if not any(abs(value) > 1e-15 for value in y):
        return {
            "BTCUSDT": {"beta": None, "hac95": None},
            "ETHUSDT": {"beta": None, "hac95": None},
            "hacLagDays": 7,
            "status": "UNMEASURED_NO_TRADES",
        }
    btc = [
        math.log(
            data.contract["BTCUSDT"][timestamp_ms(day, 1)].open
            / data.contract["BTCUSDT"][timestamp_ms(day - timedelta(days=1), 1)].open
        )
        for day in run.dates
    ]
    eth = [
        math.log(
            data.contract["ETHUSDT"][timestamp_ms(day, 1)].open
            / data.contract["ETHUSDT"][timestamp_ms(day - timedelta(days=1), 1)].open
        )
        for day in run.dates
    ]
    try:
        alpha, beta_btc, beta_eth, _ = fit_ols(y, btc, eth)
    except S1ZError:
        return {
            "BTCUSDT": {"beta": None, "hac95": None},
            "ETHUSDT": {"beta": None, "hac95": None},
            "hacLagDays": 7,
            "status": "UNMEASURED_SINGULAR",
        }
    rows = [[1.0, b, e] for b, e in zip(btc, eth, strict=True)]
    residuals = [
        target - alpha - beta_btc * b - beta_eth * e
        for target, b, e in zip(y, btc, eth, strict=True)
    ]
    xtx = [[sum(row[i] * row[j] for row in rows) for j in range(3)] for i in range(3)]
    bread = invert3(xtx)
    meat = [[0.0] * 3 for _ in range(3)]
    for lag in range(8):
        weight = 1.0 - lag / 8.0
        for t in range(lag, len(rows)):
            prior = t - lag
            scale = residuals[t] * residuals[prior] * weight
            for i in range(3):
                for j in range(3):
                    meat[i][j] += scale * rows[t][i] * rows[prior][j]
                    if lag:
                        meat[i][j] += scale * rows[prior][i] * rows[t][j]
    covariance = matmul(matmul(bread, meat), bread)
    se_btc = math.sqrt(max(0.0, covariance[1][1]))
    se_eth = math.sqrt(max(0.0, covariance[2][2]))
    return {
        "BTCUSDT": {
            "beta": beta_btc,
            "hac95": [beta_btc - 1.96 * se_btc, beta_btc + 1.96 * se_btc],
        },
        "ETHUSDT": {
            "beta": beta_eth,
            "hac95": [beta_eth - 1.96 * se_eth, beta_eth + 1.96 * se_eth],
        },
        "hacLagDays": 7,
        "status": "MEASURED",
    }


def positive_number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and value > 0


def realized_factor_neutrality_pass(betas: dict[str, object]) -> bool:
    if betas.get("status") != "MEASURED":
        return False
    for symbol in ("BTCUSDT", "ETHUSDT"):
        record = cast(dict[str, object], betas[symbol])
        beta = record.get("beta")
        interval = record.get("hac95")
        if not isinstance(beta, float) or abs(beta) > 0.10:
            return False
        if (
            not isinstance(interval, list)
            or len(interval) != 2
            or not all(isinstance(value, float) for value in interval)
            or cast(float, interval[0]) > 0
            or cast(float, interval[1]) < 0
        ):
            return False
    return True


def round_floats(value: object) -> object:
    if isinstance(value, float):
        if not math.isfinite(value):
            return None
        return round(value, 10)
    if isinstance(value, dict):
        return {key: round_floats(item) for key, item in value.items()}
    if isinstance(value, list):
        return [round_floats(item) for item in value]
    if isinstance(value, tuple):
        return [round_floats(item) for item in value]
    return value


def create_sha256sums() -> None:
    names = sorted(
        path.name for path in PACKET.iterdir() if path.is_file() and path.name != "SHA256SUMS"
    )
    lines = [f"{sha256_path(PACKET / name)}  {name}" for name in names]
    raw = ("\n".join(lines) + "\n").encode()
    with SHA256SUMS_PATH.open("xb") as handle:
        handle.write(raw)
        handle.flush()
        os.fsync(handle.fileno())


def write_unmeasured(error: Exception, receipt: dict[str, object]) -> None:
    write_json(
        LEDGER_PATH,
        {
            "exactLimitation": str(error),
            "familyInference": None,
            "primaryTrialId": PRIMARY_TRIAL_ID,
            "schemaVersion": "s1z.trial-ledger.v1",
            "status": "UNMEASURED",
            "trials": [],
        },
    )
    result: dict[str, object] = {
        "accountProfitability": "UNMEASURED",
        "authority": "NONE",
        "bodyConsumed": True,
        "capitalVerdict": "NO_GO",
        "exactLimitation": str(error),
        "metrics": None,
        "publicProxyVerdict": "UNMEASURED",
        "rerun": "FORBIDDEN",
        "runMarkerCommit": receipt["runMarkerCommit"],
        "schemaVersion": "s1z.result.v1",
        "status": "UNMEASURED",
        "universeTruth": "CURRENT_SNAPSHOT_ONLY_HISTORICAL_MEMBERSHIP_UNMEASURED",
        "verdict": "UNMEASURED",
    }
    write_json(RESULT_PATH, result)
    write_json(
        VERDICT_PATH,
        {
            "accountProfitability": "UNMEASURED",
            "capital": "NO_GO",
            "executionAuthority": "NONE",
            "publicProxy": "UNMEASURED",
            "schemaVersion": "s1z.verdict.v1",
        },
    )
    create_sha256sums()


def run() -> None:
    if any((PACKET / name).exists() for name in TERMINAL_FILES) or SHA256SUMS_PATH.exists():
        raise S1ZError("terminal artifact exists; rerun forbidden")
    head = require_git_ready()
    receipt = exclusive_consumption_receipt(head)
    try:
        data = load_source_data()
        points = residual_points(data)
        runs: dict[str, TrialRun] = {}
        for trial in trial_family():
            runs[trial.trial_id] = run_trial(
                trial,
                data,
                points,
                include_holdout=trial.trial_id == PRIMARY_TRIAL_ID,
            )

        dev_series = {
            trial_id: slice_series(
                trial_run,
                "stress",
                DEV_DECISION_START,
                DEV_METRIC_END,
            )
            for trial_id, trial_run in runs.items()
        }
        seeds = cast(dict[str, Any], load_json(SEEDS_PATH)["seeds"])
        raw_p14, white_p14 = shared_bootstrap_p_values(
            dev_series,
            block=14,
            seed=cast(int, seeds["circularBlock14"]),
        )
        raw_p28, white_p28 = shared_bootstrap_p_values(
            dev_series,
            block=28,
            seed=cast(int, seeds["circularBlock28"]),
        )
        raw_p = {trial_id: max(raw_p14[trial_id], raw_p28[trial_id]) for trial_id in dev_series}
        holm = holm_adjust(raw_p)
        white = max(white_p14, white_p28)
        pbo = cscv_pbo(dev_series)

        trial_ledger: list[dict[str, object]] = []
        for trial_id, trial_run in sorted(runs.items()):
            trial_ledger.append(
                {
                    "activeSleeves": trial_run.active_sleeves,
                    "cashDecisions": trial_run.cash_decisions,
                    "developmentStress": segment_metrics(
                        trial_run,
                        "stress",
                        DEV_DECISION_START,
                        DEV_METRIC_END,
                    ),
                    "formationDays": trial_run.trial.formation_days,
                    "holdingDays": trial_run.trial.holding_days,
                    "holmP": holm[trial_id],
                    "holdoutEvaluated": trial_id == PRIMARY_TRIAL_ID,
                    "rawP": raw_p[trial_id],
                    "regressionDays": trial_run.trial.regression_days,
                    "trialId": trial_id,
                }
            )

        primary = runs[PRIMARY_TRIAL_ID]
        segments = {
            "development": (DEV_DECISION_START, DEV_METRIC_END),
            "holdout": (HOLDOUT_DECISION_START, EVALUATION_END),
            "fullWindow": (EVALUATION_START, EVALUATION_END),
        }
        metrics: dict[str, dict[str, object]] = {}
        for segment, (start, end) in segments.items():
            metrics[segment] = {
                scenario: segment_metrics(primary, scenario, start, end) for scenario in SCENARIOS
            }
        full_stress = slice_series(
            primary,
            "stress",
            EVALUATION_START,
            EVALUATION_END,
        )
        interval14 = bootstrap(
            full_stress,
            14,
            cast(int, seeds["circularBlock14"]),
        )
        interval28 = bootstrap(
            full_stress,
            28,
            cast(int, seeds["circularBlock28"]),
        )
        stress_capacity = public_capacity(primary, data, "stress")
        full_stress_metrics = cast(dict[str, object], metrics["fullWindow"]["stress"])
        full_severe_metrics = cast(dict[str, object], metrics["fullWindow"]["severe"])
        dev_stress_metrics = cast(dict[str, object], metrics["development"]["stress"])
        holdout_stress_metrics = cast(dict[str, object], metrics["holdout"]["stress"])
        factor_betas = ex_post_factor_betas(primary, data)
        gates: dict[str, bool] = {
            "developmentStressPositive": positive_number(dev_stress_metrics["netUsdPer1000"]),
            "holdoutStressPositive": positive_number(holdout_stress_metrics["netUsdPer1000"]),
            "fullStressPositive": positive_number(full_stress_metrics["netUsdPer1000"]),
            "block14LowerPositive": interval14["lower95Usd"] > 0,
            "block28LowerPositive": interval28["lower95Usd"] > 0,
            "primaryHolmP": holm[PRIMARY_TRIAL_ID] <= 0.05,
            "whiteRealityCheck": white <= 0.05,
            "fullSeverePositive": positive_number(full_severe_metrics["netUsdPer1000"]),
            "severeDrawdownAtMost10Pct": (
                isinstance(
                    full_severe_metrics["maximumRealizedDrawdownFraction"],
                    (int, float),
                )
                and cast(float, full_severe_metrics["maximumRealizedDrawdownFraction"]) <= 0.10
            ),
            "stressCapacityP05AtLeast1000": (
                stress_capacity["p05Usd"] is not None and stress_capacity["p05Usd"] >= 1000.0
            ),
            "removeBestAssetPositive": positive_number(
                full_stress_metrics["netAfterRemovingBestAssetUsd"]
            ),
            "removeBestMonthPositive": positive_number(
                full_stress_metrics["netAfterRemovingBestMonthUsd"]
            ),
            "realizedFactorNeutrality": realized_factor_neutrality_pass(factor_betas),
        }
        public_verdict = (
            "PUBLIC_PROXY_GO_FOR_PROSPECTIVE_SHADOW" if all(gates.values()) else "NO_GO"
        )
        ledger: dict[str, object] = {
            "familyInference": {
                "bootstrapReplicates": BOOTSTRAP_REPLICATES,
                "holmP": holm,
                "pbo": pbo,
                "rawP": raw_p,
                "whiteP": white,
            },
            "primaryTrialId": PRIMARY_TRIAL_ID,
            "schemaVersion": "s1z.trial-ledger.v1",
            "trials": trial_ledger,
        }
        write_json(LEDGER_PATH, round_floats(ledger))
        result: dict[str, object] = {
            "accountProfitability": "UNMEASURED",
            "authority": {
                "capital": "NO_GO",
                "execution": "NONE",
                "moneyEffectUsd": "0",
            },
            "bodyConsumed": True,
            "capacity": {
                "executable": "UNMEASURED",
                "stressPublicProxy": stress_capacity,
            },
            "costTruth": "CONSERVATIVE_PUBLIC_PROXY_ACCOUNT_EFFECTIVE_UNKNOWN",
            "drawdownTruth": "DAILY_01UTC_MARKED_PNL_NOT_INTRAHOUR_LIQUIDATION",
            "exPostFactorBetas": factor_betas,
            "fundingTruth": {
                "cash": "PUBLIC_HOURLY_MARK_PROXY_EXACT_CASH_UNMEASURED",
                "rates": "ACTUAL_ARCHIVED_SETTLED_RATES",
            },
            "gates": gates,
            "inference": {
                "fullStressInterval95": {
                    "block14": interval14,
                    "block28": interval28,
                    "envelopeUsd": [
                        min(interval14["lower95Usd"], interval28["lower95Usd"]),
                        max(interval14["upper95Usd"], interval28["upper95Usd"]),
                    ],
                },
                "globalMultiplicity": "NOT_CERTIFIED_SHARED_RESEARCH_REUSE_RISK",
                "holmPrimaryDevelopmentP": holm[PRIMARY_TRIAL_ID],
                "localTrials": 12,
                "pbo": pbo,
                "whiteDevelopmentP": white,
            },
            "metrics": metrics,
            "neutrality": {
                "maximumExAnteAbsBTCBeta": max(primary.ex_ante_abs_btc, default=0.0),
                "maximumExAnteAbsDollar": max(primary.ex_ante_abs_dollar, default=0.0),
                "maximumExAnteAbsETHBeta": max(primary.ex_ante_abs_eth, default=0.0),
            },
            "primaryTrialId": PRIMARY_TRIAL_ID,
            "publicProxyVerdict": public_verdict,
            "rerun": "FORBIDDEN",
            "runMarkerCommit": receipt["runMarkerCommit"],
            "schemaVersion": "s1z.result.v1",
            "status": "MEASURED",
            "universeTruth": "CURRENT_SNAPSHOT_ONLY_HISTORICAL_MEMBERSHIP_UNMEASURED",
            "verdict": public_verdict,
            "window": {
                "days": 365,
                "endExclusive": "2026-06-22T00:00:00Z",
                "start": "2025-06-22T00:00:00Z",
            },
        }
        write_json(RESULT_PATH, round_floats(result))
        verdict: dict[str, object] = {
            "accountProfitability": "UNMEASURED",
            "capital": "NO_GO",
            "executionAuthority": "NONE",
            "publicProxy": public_verdict,
            "schemaVersion": "s1z.verdict.v1",
        }
        write_json(VERDICT_PATH, verdict)
        create_sha256sums()
        print(
            "MEASURED "
            f"verdict={public_verdict} "
            f"stressUsd={cast(float, full_stress_metrics['netUsdPer1000']):.4f} "
            f"holmP={holm[PRIMARY_TRIAL_ID]:.6f} whiteP={white:.6f} "
            f"pbo={cast(float, pbo['pbo']):.4f}"
        )
    except Exception as error:
        write_unmeasured(error, receipt)
        raise


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("freeze", "arm", "run"))
    args = parser.parse_args()
    try:
        if args.command == "freeze":
            freeze()
        elif args.command == "arm":
            arm()
        else:
            run()
    except Exception as error:
        print(f"STOP {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
