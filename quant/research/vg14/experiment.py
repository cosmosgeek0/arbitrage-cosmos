#!/usr/bin/env python3
"""Sealed public-only evaluator for the V-G14 preregistered experiment."""

from __future__ import annotations

import argparse
import contextlib
import csv
import hashlib
import io
import json
import math
import os
import random
import re
import subprocess
import urllib.request
import zipfile
from collections import defaultdict
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal, InvalidOperation
from pathlib import Path, PurePosixPath
from statistics import median
from typing import Final, cast

type JsonValue = None | bool | int | float | str | list[JsonValue] | dict[str, JsonValue]
type Fetcher = Callable[[str], bytes]

HERE: Final = Path(__file__).resolve().parent
PROTOCOL_PATH: Final = HERE / "protocol.v1.json"
FREEZE_PATH: Final = HERE / "freeze.v1.json"
SOURCE_RESEARCH_PATH: Final = HERE / "OFFICIAL_SOURCE_RESEARCH.md"
DISTINCTNESS_PATH: Final = HERE / "DISTINCTNESS.md"
DEFAULT_STATE_ROOT: Final = Path("/private/tmp/cosmos-vg14-volume-seasonality-residual-v1")
BAR_US: Final = 30 * 60 * 1_000_000
WEEK_US: Final = 7 * 24 * 60 * 60 * 1_000_000
MAX_ARCHIVE_BYTES: Final = 64 * 1024 * 1024
MAX_MEMBER_BYTES: Final = 96 * 1024 * 1024
CSV_HEADER: Final = (
    "open_time",
    "open",
    "high",
    "low",
    "close",
    "volume",
    "close_time",
    "quote_asset_volume",
    "number_of_trades",
    "taker_buy_base_asset_volume",
    "taker_buy_quote_asset_volume",
    "ignore",
)
SIDE_CAR_RE: Final = re.compile(rb"([0-9A-Fa-f]{64})[ \t]+([^\s/\\]+)(?:\r?\n)?\Z")


class UnmeasuredError(RuntimeError):
    """A preregistered custody, integrity, or lifecycle failure."""


@dataclass(frozen=True, slots=True)
class Bar:
    symbol: str
    open_time_us: int
    open_price: Decimal
    quote_volume: Decimal


@dataclass(frozen=True, slots=True)
class TrialSpec:
    trial_id: str
    residual_multiple: Decimal
    hold_hours: int


@dataclass(frozen=True, slots=True)
class RoundTrip:
    symbol: str
    signal_time_us: int
    entry_time_us: int
    exit_time_us: int
    residual_multiple: Decimal
    gross_return: float
    base_return: float
    stress_return: float
    severe_return: float
    capacity_pass: bool


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_json_bytes(value: JsonValue) -> bytes:
    return (
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True) + "\n"
    ).encode()


def read_json_object(path: Path) -> dict[str, JsonValue]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise UnmeasuredError(f"invalid JSON at {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise UnmeasuredError(f"JSON root is not an object: {path}")
    return cast(dict[str, JsonValue], value)


def write_once(path: Path, value: JsonValue) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = canonical_json_bytes(value)
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o444)
    except FileExistsError as exc:
        raise UnmeasuredError(f"immutable artifact already exists: {path}") from exc
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
    except BaseException:
        path.unlink(missing_ok=True)
        raise


def write_bytes_atomic(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.part")
    if temporary.exists():
        raise UnmeasuredError(f"stale partial acquisition: {temporary}")
    try:
        with temporary.open("xb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        temporary.replace(path)
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise


def protocol() -> dict[str, JsonValue]:
    verify_protocol_freeze()
    return read_json_object(PROTOCOL_PATH)


def verify_protocol_freeze() -> None:
    frozen = read_json_object(FREEZE_PATH)
    files = frozen.get("files")
    if not isinstance(files, dict):
        raise UnmeasuredError("freeze file map is absent")
    expected_paths = {
        "protocol.v1.json": PROTOCOL_PATH,
        "OFFICIAL_SOURCE_RESEARCH.md": SOURCE_RESEARCH_PATH,
        "DISTINCTNESS.md": DISTINCTNESS_PATH,
    }
    if set(files) != set(expected_paths):
        raise UnmeasuredError("freeze file map differs from the three preregistered anchors")
    for name, path in expected_paths.items():
        expected = files.get(name)
        if not isinstance(expected, str) or sha256_file(path) != expected:
            raise UnmeasuredError(f"frozen anchor digest mismatch: {name}")


def find_repo_root() -> Path:
    result = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"],
        cwd=HERE,
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise UnmeasuredError("evaluator is not running inside a Git worktree")
    return Path(result.stdout.strip()).resolve()


def verify_repository_base() -> str:
    frozen = read_json_object(FREEZE_PATH)
    base = frozen.get("baseCommit")
    if not isinstance(base, str) or not re.fullmatch(r"[0-9a-f]{40}", base):
        raise UnmeasuredError("invalid frozen base commit")
    repo = find_repo_root()
    ancestor = subprocess.run(
        ["git", "merge-base", "--is-ancestor", base, "HEAD"],
        cwd=repo,
        check=False,
        capture_output=True,
    )
    if ancestor.returncode != 0:
        raise UnmeasuredError(f"HEAD does not descend from frozen base {base}")
    changed = subprocess.run(
        ["git", "diff", "--name-only", base, "--"],
        cwd=repo,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.splitlines()
    untracked = subprocess.run(
        ["git", "ls-files", "--others", "--exclude-standard"],
        cwd=repo,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.splitlines()
    if any(not item.startswith("quant/research/vg14/") for item in [*changed, *untracked]):
        raise UnmeasuredError("worktree contains changes outside quant/research/vg14")
    return base


def require_no_terminal(state_root: Path) -> None:
    if (state_root / "terminal_evidence.v1.json").exists():
        raise UnmeasuredError("terminal evidence already exists; rerun is forbidden")


def assert_holdout_absent(state_root: Path) -> None:
    forbidden = (
        state_root / "custody" / "holdout",
        state_root / "holdout_acquisition.v1.json",
        state_root / "holdout_source_manifest.v1.json",
        state_root / "holdout_result.v1.json",
        state_root / "markers" / "holdout_opened.v1.json",
        state_root / "markers" / "holdout_consumed.v1.json",
    )
    present = [str(path.relative_to(state_root)) for path in forbidden if path.exists()]
    if present:
        raise UnmeasuredError(
            "holdout must be physically absent before development: " + ",".join(sorted(present))
        )


def evaluator_digest() -> str:
    return sha256_file(Path(__file__).resolve())


def freeze_evaluator(state_root: Path) -> dict[str, JsonValue]:
    verify_protocol_freeze()
    base = verify_repository_base()
    if state_root.exists() and any(state_root.iterdir()):
        raise UnmeasuredError("evaluator freeze requires a fresh empty state root")
    payload: dict[str, JsonValue] = {
        "baseCommit": base,
        "evaluatorSha256": evaluator_digest(),
        "protocolFreezeSha256": sha256_file(FREEZE_PATH),
        "protocolSha256": sha256_file(PROTOCOL_PATH),
        "version": "VG14EvaluatorFreezeV1",
    }
    write_once(state_root / "evaluator_freeze.v1.json", payload)
    return payload


def verify_evaluator_freeze(state_root: Path) -> dict[str, JsonValue]:
    verify_protocol_freeze()
    verify_repository_base()
    path = state_root / "evaluator_freeze.v1.json"
    frozen = read_json_object(path)
    expected = {
        "evaluatorSha256": evaluator_digest(),
        "protocolFreezeSha256": sha256_file(FREEZE_PATH),
        "protocolSha256": sha256_file(PROTOCOL_PATH),
    }
    for key, value in expected.items():
        if frozen.get(key) != value:
            raise UnmeasuredError(f"evaluator freeze mismatch: {key}")
    return frozen


def require_mapping(value: JsonValue, name: str) -> dict[str, JsonValue]:
    if not isinstance(value, dict):
        raise UnmeasuredError(f"protocol field {name} is not an object")
    return value


def require_list_of_str(value: JsonValue, name: str) -> list[str]:
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise UnmeasuredError(f"protocol field {name} is not a string list")
    return cast(list[str], value)


def data_contract(config: Mapping[str, JsonValue]) -> dict[str, JsonValue]:
    return require_mapping(config.get("data"), "data")


def archive_specs(config: Mapping[str, JsonValue], partition: str) -> list[tuple[str, str, str]]:
    data = data_contract(config)
    symbols = require_list_of_str(data.get("fixedCohort"), "data.fixedCohort")
    months_key = (
        "developmentArchiveMonths" if partition == "development" else "holdoutArchiveMonths"
    )
    months = require_list_of_str(data.get(months_key), f"data.{months_key}")
    template = data.get("archiveUrlTemplate")
    if not isinstance(template, str):
        raise UnmeasuredError("archive URL template is invalid")
    return [
        (symbol, month, template.format(symbol=symbol, yyyy_mm=month))
        for symbol in symbols
        for month in months
    ]


def validate_public_url(url: str) -> None:
    prefix = "https://data.binance.vision/data/spot/monthly/klines/"
    if not url.startswith(prefix) or not (url.endswith(".zip") or url.endswith(".zip.CHECKSUM")):
        raise UnmeasuredError(f"non-frozen public archive URL rejected: {url}")


def http_fetch(url: str) -> bytes:
    validate_public_url(url)
    request = urllib.request.Request(url, headers={"User-Agent": "vg14-public-research/1"})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            final_url = response.geturl()
            validate_public_url(final_url)
            declared_length = response.headers.get("Content-Length")
            if declared_length is not None and int(declared_length) > MAX_ARCHIVE_BYTES:
                raise UnmeasuredError(f"remote object exceeds byte limit: {url}")
            payload = bytes(response.read(MAX_ARCHIVE_BYTES + 1))
    except (OSError, ValueError) as exc:
        raise UnmeasuredError(f"public acquisition failed for {url}: {exc}") from exc
    if len(payload) > MAX_ARCHIVE_BYTES:
        raise UnmeasuredError(f"download exceeds byte limit: {url}")
    return payload


def custody_paths(state_root: Path, partition: str, symbol: str, month: str) -> tuple[Path, Path]:
    directory = state_root / "custody" / partition
    archive = directory / f"{symbol}-30m-{month}.zip"
    return archive, archive.with_suffix(".zip.CHECKSUM")


def acquire_partition(
    state_root: Path,
    partition: str,
    *,
    fetcher: Fetcher = http_fetch,
) -> dict[str, JsonValue]:
    require_no_terminal(state_root)
    config = protocol()
    verify_evaluator_freeze(state_root)
    if partition == "holdout":
        verify_candidate_seal(state_root, config)
        write_once(
            state_root / "markers" / "holdout_opened.v1.json",
            {
                "law": "WRITTEN_BEFORE_FIRST_HOLDOUT_NETWORK_REQUEST_OR_MEMBER_OPEN",
                "version": "VG14HoldoutOpenMarkerV1",
            },
        )
    elif partition == "development":
        assert_holdout_absent(state_root)
    else:
        raise UnmeasuredError(f"unknown partition: {partition}")

    acquired: list[JsonValue] = []
    for symbol, month, url in archive_specs(config, partition):
        archive_path, sidecar_path = custody_paths(state_root, partition, symbol, month)
        if archive_path.exists() or sidecar_path.exists():
            raise UnmeasuredError(f"pre-existing custody object rejected: {archive_path.name}")
        sidecar_url = f"{url}.CHECKSUM"
        sidecar_bytes = fetcher(sidecar_url)
        archive_bytes = fetcher(url)
        write_bytes_atomic(sidecar_path, sidecar_bytes)
        write_bytes_atomic(archive_path, archive_bytes)
        acquired.append(
            {
                "archive": archive_path.name,
                "archiveBytes": len(archive_bytes),
                "archiveUrl": url,
                "sidecarBytes": len(sidecar_bytes),
                "sidecarUrl": sidecar_url,
                "symbol": symbol,
                "utcMonth": month,
            }
        )
    payload: dict[str, JsonValue] = {
        "objects": acquired,
        "partition": partition,
        "version": "VG14AcquisitionManifestV1",
    }
    write_once(state_root / f"{partition}_acquisition.v1.json", payload)
    return payload


def parse_sidecar(payload: bytes, expected_filename: str) -> str:
    match = SIDE_CAR_RE.fullmatch(payload)
    if match is None:
        raise UnmeasuredError(f"malformed checksum sidecar for {expected_filename}")
    declared_name = match.group(2).decode("ascii", errors="strict")
    if declared_name != expected_filename:
        raise UnmeasuredError(
            f"checksum sidecar filename mismatch: expected {expected_filename}, got {declared_name}"
        )
    return match.group(1).decode("ascii").lower()


def inventory_partition(state_root: Path, partition: str) -> dict[str, JsonValue]:
    require_no_terminal(state_root)
    config = protocol()
    verify_evaluator_freeze(state_root)
    objects: list[JsonValue] = []
    for symbol, month, url in archive_specs(config, partition):
        archive_path, sidecar_path = custody_paths(state_root, partition, symbol, month)
        if not archive_path.is_file() or not sidecar_path.is_file():
            raise UnmeasuredError(f"missing custody pair: {archive_path.name}")
        if archive_path.stat().st_size > MAX_ARCHIVE_BYTES:
            raise UnmeasuredError(f"archive exceeds byte limit: {archive_path.name}")
        sidecar_bytes = sidecar_path.read_bytes()
        declared = parse_sidecar(sidecar_bytes, archive_path.name)
        actual = sha256_file(archive_path)
        if actual != declared:
            raise UnmeasuredError(f"archive checksum mismatch: {archive_path.name}")
        objects.append(
            {
                "archiveBytes": archive_path.stat().st_size,
                "archiveSha256": actual,
                "archiveUrl": url,
                "sidecarBytes": len(sidecar_bytes),
                "sidecarSha256": sha256_bytes(sidecar_bytes),
                "sidecarUrl": f"{url}.CHECKSUM",
                "symbol": symbol,
                "utcMonth": month,
            }
        )
    payload: dict[str, JsonValue] = {
        "objects": objects,
        "partition": partition,
        "protocolSha256": sha256_file(PROTOCOL_PATH),
        "version": "VG14SourceManifestV1",
        "zipMembersOpened": 0,
    }
    return payload


def month_bounds_us(month: str) -> tuple[int, int]:
    if re.fullmatch(r"\d{4}-\d{2}", month) is None:
        raise UnmeasuredError(f"invalid month: {month}")
    try:
        start = datetime.strptime(f"{month}-01", "%Y-%m-%d").replace(tzinfo=UTC)
    except ValueError as exc:
        raise UnmeasuredError(f"invalid month: {month}") from exc
    if start.month == 12:
        end = start.replace(year=start.year + 1, month=1)
    else:
        end = start.replace(month=start.month + 1)
    return int(start.timestamp() * 1_000_000), int(end.timestamp() * 1_000_000)


def parse_positive_decimal(raw: str, field: str) -> Decimal:
    try:
        value = Decimal(raw)
    except InvalidOperation as exc:
        raise UnmeasuredError(f"invalid decimal {field}: {raw}") from exc
    if not value.is_finite() or value <= 0:
        raise UnmeasuredError(f"nonpositive or nonfinite {field}: {raw}")
    return value


def parse_csv_member(payload: bytes, symbol: str, month: str) -> list[Bar]:
    if len(payload) > MAX_MEMBER_BYTES:
        raise UnmeasuredError(f"CSV member exceeds byte limit: {symbol} {month}")
    try:
        text = payload.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise UnmeasuredError(f"CSV is not UTF-8: {symbol} {month}") from exc
    reader = csv.reader(io.StringIO(text, newline=""))
    rows = list(reader)
    if not rows:
        raise UnmeasuredError(f"empty CSV: {symbol} {month}")
    if tuple(rows[0]) == CSV_HEADER:
        rows = rows[1:]
    elif not rows[0] or not rows[0][0].isdigit():
        raise UnmeasuredError(f"undocumented CSV header/schema: {symbol} {month}")
    start_us, end_us = month_bounds_us(month)
    expected_count = (end_us - start_us) // BAR_US
    bars: list[Bar] = []
    expected_time = start_us
    seen: set[int] = set()
    for row_number, row in enumerate(rows, start=1):
        if len(row) != 12:
            raise UnmeasuredError(f"expected 12 CSV fields at {symbol} {month} row {row_number}")
        raw_time = row[0]
        if len(raw_time) != 16 or not raw_time.isdigit():
            raise UnmeasuredError(f"timestamp is not a 2025+ microsecond epoch: {raw_time}")
        open_time = int(raw_time)
        if open_time in seen:
            raise UnmeasuredError(f"duplicate bar: {symbol} {open_time}")
        if open_time != expected_time:
            raise UnmeasuredError(
                "30-minute UTC grid gap/conflict: "
                f"{symbol} expected {expected_time}, got {open_time}"
            )
        if not start_us <= open_time < end_us or open_time % BAR_US != 0:
            raise UnmeasuredError(f"timestamp outside exact UTC grid: {symbol} {open_time}")
        seen.add(open_time)
        bars.append(
            Bar(
                symbol=symbol,
                open_time_us=open_time,
                open_price=parse_positive_decimal(row[1], "open"),
                quote_volume=parse_positive_decimal(row[7], "quote_asset_volume"),
            )
        )
        expected_time += BAR_US
    if len(bars) != expected_count or expected_time != end_us:
        raise UnmeasuredError(
            f"incomplete month grid: {symbol} {month}; got {len(bars)}, expected {expected_count}"
        )
    return bars


def open_authenticated_archive(archive_path: Path, symbol: str, month: str) -> list[Bar]:
    expected_member = f"{symbol}-30m-{month}.csv"
    try:
        with zipfile.ZipFile(archive_path) as archive:
            members = archive.infolist()
            if len(members) != 1:
                raise UnmeasuredError(
                    f"archive must contain exactly one member: {archive_path.name}"
                )
            member = members[0]
            pure_name = PurePosixPath(member.filename)
            if (
                member.is_dir()
                or member.filename != expected_member
                or pure_name.is_absolute()
                or ".." in pure_name.parts
                or "\\" in member.filename
                or member.flag_bits & 0x1
            ):
                raise UnmeasuredError(f"unsafe or unexpected ZIP member: {member.filename}")
            if member.file_size > MAX_MEMBER_BYTES:
                raise UnmeasuredError(f"ZIP member exceeds byte limit: {member.filename}")
            with archive.open(member, "r") as handle:
                payload = handle.read(MAX_MEMBER_BYTES + 1)
    except (OSError, zipfile.BadZipFile, RuntimeError) as exc:
        raise UnmeasuredError(f"invalid ZIP archive {archive_path.name}: {exc}") from exc
    if len(payload) > MAX_MEMBER_BYTES:
        raise UnmeasuredError(f"ZIP member exceeds byte limit: {expected_member}")
    return parse_csv_member(payload, symbol, month)


def parse_utc_us(value: str) -> int:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise UnmeasuredError(f"invalid UTC instant: {value}") from exc
    if parsed.tzinfo is None or parsed.utcoffset() != timedelta(0):
        raise UnmeasuredError(f"instant is not UTC: {value}")
    return int(parsed.timestamp() * 1_000_000)


def trial_specs(config: Mapping[str, JsonValue]) -> list[TrialSpec]:
    trials = require_mapping(config.get("trials"), "trials")
    residuals = require_list_of_str(trials.get("residualMultiples"), "trials.residualMultiples")
    holds_raw = trials.get("holdHours")
    if not isinstance(holds_raw, list) or not all(
        isinstance(item, int) and not isinstance(item, bool) for item in holds_raw
    ):
        raise UnmeasuredError("trials.holdHours is not an integer list")
    holds = cast(list[int], holds_raw)
    specs = [
        TrialSpec(f"R{residual}x-H{hold}h", Decimal(residual), hold)
        for residual in residuals
        for hold in holds
    ]
    if trials.get("attemptedCount") != len(specs):
        raise UnmeasuredError("attempted trial count does not match frozen grid")
    return specs


def proxy_return(gross_factor: float, fee_bp: int, adverse_bp: int) -> float:
    per_fill = (fee_bp + adverse_bp) / 10_000
    return gross_factor * (1 - per_fill) ** 2 - 1


def evaluate_round_trips(
    bars: Sequence[Bar],
    spec: TrialSpec,
    partition_start_us: int,
    partition_end_us: int,
    config: Mapping[str, JsonValue],
) -> list[RoundTrip]:
    by_symbol_time = {(bar.symbol, bar.open_time_us): bar for bar in bars}
    symbols = require_list_of_str(data_contract(config).get("fixedCohort"), "data.fixedCohort")
    costs = require_mapping(config.get("costs"), "costs")
    base_cost = require_mapping(costs.get("base"), "costs.base")
    stress_cost = require_mapping(costs.get("stress"), "costs.stress")
    severe_cost = require_mapping(costs.get("severeDiagnostic"), "costs.severeDiagnostic")
    capacity = require_mapping(
        require_mapping(config.get("formalGoGates"), "formalGoGates").get("proxyCapacity"),
        "formalGoGates.proxyCapacity",
    )
    entry_notional = Decimal(str(capacity["entryNotionalUsd"]))
    participation_bp = Decimal(str(capacity["participationBasisPointsOfSignalBarQuoteVolume"]))

    def cost_pair(contract: Mapping[str, JsonValue]) -> tuple[int, int]:
        fee = contract.get("feeBasisPointsPerFill")
        adverse = contract.get("adverseExecutionBasisPointsPerFill")
        if not isinstance(fee, int) or not isinstance(adverse, int):
            raise UnmeasuredError("cost basis points must be integers")
        return fee, adverse

    base_pair = cost_pair(base_cost)
    stress_pair = cost_pair(stress_cost)
    severe_pair = cost_pair(severe_cost)
    hold_us = spec.hold_hours * 60 * 60 * 1_000_000
    # Entry and exit opens must both be inside the end-exclusive partition.
    # Subtract one additional bar so the latest exit is end - BAR_US, never end.
    latest_signal = partition_end_us - BAR_US * 3 - hold_us
    next_flat_us = partition_start_us
    result: list[RoundTrip] = []
    for signal_time in range(partition_start_us, latest_signal + 1, BAR_US):
        if signal_time < next_flat_us:
            continue
        candidates: list[tuple[Decimal, str, Bar]] = []
        for symbol in symbols:
            signal_bar = by_symbol_time.get((symbol, signal_time))
            if signal_bar is None:
                raise UnmeasuredError(f"missing signal bar: {symbol} {signal_time}")
            seasonal_values: list[Decimal] = []
            for prior_week in range(1, 9):
                prior = by_symbol_time.get((symbol, signal_time - prior_week * WEEK_US))
                if prior is None:
                    raise UnmeasuredError(
                        f"missing prior seasonal bar: {symbol} {signal_time} week {prior_week}"
                    )
                seasonal_values.append(prior.quote_volume)
            expected = median(seasonal_values)
            if expected <= 0:
                raise UnmeasuredError(f"nonpositive seasonal median: {symbol} {signal_time}")
            residual = signal_bar.quote_volume / expected
            if residual >= spec.residual_multiple:
                candidates.append((residual, symbol, signal_bar))
        if not candidates:
            continue
        residual, symbol, signal_bar = min(candidates, key=lambda item: (-item[0], item[1]))
        entry_time = signal_time + BAR_US * 2
        exit_time = entry_time + hold_us
        entry = by_symbol_time.get((symbol, entry_time))
        exit_bar = by_symbol_time.get((symbol, exit_time))
        if entry is None or exit_bar is None:
            raise UnmeasuredError(f"missing entry/exit bar: {symbol} {entry_time} {exit_time}")
        gross_factor = float(exit_bar.open_price / entry.open_price)
        capacity_limit = signal_bar.quote_volume * participation_bp / Decimal(10_000)
        result.append(
            RoundTrip(
                symbol=symbol,
                signal_time_us=signal_time,
                entry_time_us=entry_time,
                exit_time_us=exit_time,
                residual_multiple=residual,
                gross_return=gross_factor - 1,
                base_return=proxy_return(gross_factor, *base_pair),
                stress_return=proxy_return(gross_factor, *stress_pair),
                severe_return=proxy_return(gross_factor, *severe_pair),
                capacity_pass=entry_notional <= capacity_limit,
            )
        )
        next_flat_us = exit_time
    return result


def compounded_return(returns: Iterable[float]) -> float:
    equity = 1.0
    for value in returns:
        equity *= 1.0 + value
    return equity - 1.0


def maximum_drawdown(returns: Iterable[float]) -> float:
    equity = 1.0
    peak = 1.0
    drawdown = 0.0
    for value in returns:
        equity *= 1.0 + value
        peak = max(peak, equity)
        drawdown = max(drawdown, 1.0 - equity / peak)
    return drawdown


def bootstrap_inference(
    returns: Sequence[float], *, replicates: int, block_length: int, seed: int
) -> tuple[float, float]:
    if not returns:
        return 1.0, float("-inf")
    generator = random.Random(seed)
    sample_count = len(returns)
    bootstrap_means: list[float] = []
    for _ in range(replicates):
        sample: list[float] = []
        while len(sample) < sample_count:
            start = generator.randrange(sample_count)
            sample.extend(
                returns[(start + offset) % sample_count] for offset in range(block_length)
            )
        bootstrap_means.append(math.fsum(sample[:sample_count]) / sample_count)
    nonpositive = sum(value <= 0 for value in bootstrap_means)
    p_value = (nonpositive + 1) / (replicates + 1)
    ordered = sorted(bootstrap_means)
    lower_index = max(0, math.ceil(0.05 * replicates) - 1)
    return p_value, ordered[lower_index]


def utc_month_from_us(value: int) -> str:
    return datetime.fromtimestamp(value / 1_000_000, tz=UTC).strftime("%Y-%m")


def metric_string(value: float) -> str:
    if not math.isfinite(value):
        return "-Infinity" if value < 0 else "Infinity"
    return format(value, ".12g")


def summarize_trial(
    spec: TrialSpec,
    round_trips: Sequence[RoundTrip],
    config: Mapping[str, JsonValue],
    seed_offset: int,
) -> dict[str, JsonValue]:
    bootstrap = require_mapping(config.get("bootstrap"), "bootstrap")
    replicates = bootstrap.get("replicates")
    block_length = bootstrap.get("blockLengthRoundTrips")
    seed = bootstrap.get("seed")
    if not all(isinstance(item, int) for item in (replicates, block_length, seed)):
        raise UnmeasuredError("bootstrap integer contract is invalid")
    stress_returns = [trip.stress_return for trip in round_trips]
    raw_p, lower_bound = bootstrap_inference(
        stress_returns,
        replicates=cast(int, replicates),
        block_length=cast(int, block_length),
        seed=cast(int, seed) + seed_offset,
    )
    month_returns: dict[str, list[float]] = defaultdict(list)
    for trip in round_trips:
        month_returns[utc_month_from_us(trip.entry_time_us)].append(trip.stress_return)
    positive_months = sum(compounded_return(values) > 0 for values in month_returns.values())
    failed_capacity = sum(not trip.capacity_pass for trip in round_trips)
    failed_fraction = failed_capacity / len(round_trips) if round_trips else 1.0
    return {
        "activeUtcMonths": len(month_returns),
        "baseCompoundedReturn": metric_string(
            compounded_return(trip.base_return for trip in round_trips)
        ),
        "bootstrapLowerBoundMeanStressReturn": metric_string(lower_bound),
        "distinctSymbols": len({trip.symbol for trip in round_trips}),
        "grossCompoundedReturn": metric_string(
            compounded_return(trip.gross_return for trip in round_trips)
        ),
        "holdHours": spec.hold_hours,
        "maximumStressDrawdown": metric_string(maximum_drawdown(stress_returns)),
        "positiveUtcMonths": positive_months,
        "proxyCapacityFailedFraction": metric_string(failed_fraction),
        "rawOneSidedBootstrapPValue": metric_string(raw_p),
        "residualMultiple": str(spec.residual_multiple),
        "roundTrips": len(round_trips),
        "severeCompoundedReturn": metric_string(
            compounded_return(trip.severe_return for trip in round_trips)
        ),
        "stressCompoundedReturn": metric_string(compounded_return(stress_returns)),
        "trialId": spec.trial_id,
    }


def holm_adjust(raw_values: Mapping[str, float]) -> dict[str, float]:
    ordered = sorted(raw_values.items(), key=lambda item: (item[1], item[0]))
    count = len(ordered)
    adjusted: dict[str, float] = {}
    running = 0.0
    for rank, (trial_id, raw) in enumerate(ordered, start=1):
        running = max(running, min(1.0, raw * (count - rank + 1)))
        adjusted[trial_id] = running
    return adjusted


def decimal_metric(summary: Mapping[str, JsonValue], key: str) -> Decimal:
    value = summary.get(key)
    if not isinstance(value, str):
        raise UnmeasuredError(f"missing numeric metric: {key}")
    try:
        return Decimal(value)
    except InvalidOperation as exc:
        raise UnmeasuredError(f"invalid numeric metric: {key}") from exc


def apply_development_gates(
    summaries: Sequence[dict[str, JsonValue]], config: Mapping[str, JsonValue]
) -> None:
    raw_values = {
        cast(str, item["trialId"]): float(cast(str, item["rawOneSidedBootstrapPValue"]))
        for item in summaries
    }
    adjusted = holm_adjust(raw_values)
    gates = require_mapping(
        require_mapping(config.get("formalGoGates"), "formalGoGates").get("development"),
        "formalGoGates.development",
    )
    capacity = require_mapping(
        require_mapping(config.get("formalGoGates"), "formalGoGates").get("proxyCapacity"),
        "formalGoGates.proxyCapacity",
    )
    for item in summaries:
        trial_id = cast(str, item["trialId"])
        item["holmAdjustedPValue"] = metric_string(adjusted[trial_id])
        checks: dict[str, JsonValue] = {
            "activeUtcMonths": cast(int, item["activeUtcMonths"])
            >= cast(int, gates["activeUtcMonthsMinimum"]),
            "bootstrapLowerBound": decimal_metric(item, "bootstrapLowerBoundMeanStressReturn")
            > Decimal(cast(str, gates["bootstrapLowerBoundExclusiveMinimum"])),
            "distinctSymbols": cast(int, item["distinctSymbols"])
            >= cast(int, gates["distinctSymbolsMinimum"]),
            "holmAdjustedPValue": Decimal(cast(str, item["holmAdjustedPValue"]))
            <= Decimal(cast(str, gates["holmAdjustedPValueMaximum"])),
            "maximumStressDrawdown": decimal_metric(item, "maximumStressDrawdown")
            <= Decimal(cast(str, gates["maximumStressDrawdownMaximum"])),
            "positiveUtcMonths": cast(int, item["positiveUtcMonths"])
            >= cast(int, gates["positiveUtcMonthsMinimum"]),
            "proxyCapacity": decimal_metric(item, "proxyCapacityFailedFraction")
            <= Decimal(cast(str, capacity["maximumFailedRoundTripFraction"])),
            "roundTrips": cast(int, item["roundTrips"]) >= cast(int, gates["roundTripsMinimum"]),
            "stressCompoundedReturn": decimal_metric(item, "stressCompoundedReturn")
            > Decimal(cast(str, gates["stressCompoundedReturnExclusiveMinimum"])),
        }
        item["gateChecks"] = checks
        item["passesAllDevelopmentGates"] = all(cast(bool, value) for value in checks.values())


def select_champion(summaries: Sequence[dict[str, JsonValue]]) -> dict[str, JsonValue] | None:
    passers = [item for item in summaries if item.get("passesAllDevelopmentGates") is True]
    if not passers:
        return None
    return min(
        passers,
        key=lambda item: (
            -decimal_metric(item, "stressCompoundedReturn"),
            Decimal(cast(str, item["residualMultiple"])),
            cast(int, item["holdHours"]),
            cast(str, item["trialId"]),
        ),
    )


def verify_candidate_seal(
    state_root: Path, config: Mapping[str, JsonValue] | None = None
) -> dict[str, JsonValue]:
    active_config = protocol() if config is None else config
    verify_evaluator_freeze(state_root)
    seal_path = state_root / "candidate_seal.v1.json"
    result_path = state_root / "development_result.v1.json"
    source_manifest_path = state_root / "development_source_manifest.v1.json"
    consumption_marker_path = state_root / "markers" / "development_consumed.v1.json"
    evaluator_freeze_path = state_root / "evaluator_freeze.v1.json"
    if not seal_path.is_file():
        raise UnmeasuredError("holdout forbidden without candidate seal")
    required = (
        result_path,
        source_manifest_path,
        consumption_marker_path,
        evaluator_freeze_path,
    )
    missing = [str(path.relative_to(state_root)) for path in required if not path.is_file()]
    if missing:
        raise UnmeasuredError("candidate custody is incomplete: " + ",".join(sorted(missing)))

    seal = read_json_object(seal_path)
    exact_bindings = {
        "developmentConsumptionMarkerSha256": sha256_file(consumption_marker_path),
        "developmentResultSha256": sha256_file(result_path),
        "developmentSourceManifestSha256": sha256_file(source_manifest_path),
        "evaluatorFreezeSha256": sha256_file(evaluator_freeze_path),
        "evaluatorSha256": evaluator_digest(),
        "protocolFreezeSha256": sha256_file(FREEZE_PATH),
        "protocolSha256": sha256_file(PROTOCOL_PATH),
    }
    for field, actual in exact_bindings.items():
        if seal.get(field) != actual:
            raise UnmeasuredError(f"candidate seal binding mismatch: {field}")
    if seal.get("version") != "VG14CandidateSealV1":
        raise UnmeasuredError("candidate seal version is invalid")

    result = read_json_object(result_path)
    source_manifest = read_json_object(source_manifest_path)
    consumption_marker = read_json_object(consumption_marker_path)
    if result.get("version") != "VG14DevelopmentResultV1":
        raise UnmeasuredError("candidate development result version is invalid")
    if result.get("verdict") != "CANDIDATE_SEALED":
        raise UnmeasuredError("candidate development result is not a passing sealed result")
    if result.get("protocolSha256") != sha256_file(PROTOCOL_PATH):
        raise UnmeasuredError("candidate development result protocol mismatch")
    if (
        result.get("sourceManifestSha256") != sha256_file(source_manifest_path)
        or result.get("evaluatorSha256") != evaluator_digest()
        or result.get("protocolFreezeSha256") != sha256_file(FREEZE_PATH)
    ):
        raise UnmeasuredError("candidate development result custody binding mismatch")
    if source_manifest.get("version") != "VG14SourceManifestV1":
        raise UnmeasuredError("candidate development source manifest version is invalid")
    if source_manifest.get("partition") != "development":
        raise UnmeasuredError("candidate source manifest is not development")
    if source_manifest.get("protocolSha256") != sha256_file(PROTOCOL_PATH):
        raise UnmeasuredError("candidate source manifest protocol mismatch")
    if source_manifest.get("zipMembersOpened") != 0:
        raise UnmeasuredError("candidate source manifest was not a pre-open inventory")
    manifest_objects = source_manifest.get("objects")
    if not isinstance(manifest_objects, list):
        raise UnmeasuredError("candidate source manifest object list is invalid")
    if result.get("archiveObjectCount") != len(manifest_objects):
        raise UnmeasuredError("candidate archive count differs from source manifest")
    if (
        consumption_marker.get("version") != "VG14DevelopmentConsumptionMarkerV1"
        or consumption_marker.get("law") != "WRITTEN_BEFORE_FIRST_DEVELOPMENT_ZIP_MEMBER_OPEN"
        or consumption_marker.get("sourceManifestSha256") != sha256_file(source_manifest_path)
    ):
        raise UnmeasuredError("candidate development consumption marker is invalid")

    champion = seal.get("champion")
    trials = result.get("trials")
    champion_id = result.get("championTrialId")
    if (
        not isinstance(champion, dict)
        or not isinstance(trials, list)
        or not isinstance(champion_id, str)
    ):
        raise UnmeasuredError("candidate champion identity is invalid")
    typed_champion = champion
    typed_trials: list[dict[str, JsonValue]] = []
    for trial in trials:
        if not isinstance(trial, dict):
            raise UnmeasuredError("candidate development trial list is invalid")
        typed_trials.append(trial)
    matching = [trial for trial in typed_trials if trial.get("trialId") == champion_id]
    if len(matching) != 1 or matching[0] != typed_champion:
        raise UnmeasuredError("candidate champion does not exactly match development result")
    gate_checks = typed_champion.get("gateChecks")
    if (
        typed_champion.get("passesAllDevelopmentGates") is not True
        or not isinstance(gate_checks, dict)
        or not gate_checks
        or any(value is not True for value in gate_checks.values())
    ):
        raise UnmeasuredError("candidate champion did not pass every development gate")
    recomputed_trials = cast(
        list[dict[str, JsonValue]],
        json.loads(json.dumps(typed_trials, sort_keys=True, separators=(",", ":"))),
    )
    apply_development_gates(recomputed_trials, active_config)
    for recorded, recomputed in zip(typed_trials, recomputed_trials, strict=True):
        if (
            recorded.get("holmAdjustedPValue") != recomputed.get("holmAdjustedPValue")
            or recorded.get("gateChecks") != recomputed.get("gateChecks")
            or recorded.get("passesAllDevelopmentGates")
            != recomputed.get("passesAllDevelopmentGates")
        ):
            raise UnmeasuredError("candidate development gate record does not recompute")
    selected = select_champion(recomputed_trials)
    recomputed_champion = next(
        (trial for trial in recomputed_trials if trial.get("trialId") == champion_id),
        None,
    )
    if selected is None or recomputed_champion is None or selected != recomputed_champion:
        raise UnmeasuredError("candidate champion is not the deterministic frozen selection")

    frozen_specs = {spec.trial_id: spec for spec in trial_specs(active_config)}
    spec = frozen_specs.get(champion_id)
    if (
        spec is None
        or typed_champion.get("residualMultiple") != str(spec.residual_multiple)
        or typed_champion.get("holdHours") != spec.hold_hours
    ):
        raise UnmeasuredError("candidate champion is outside the frozen trial family")

    history_path_value = seal.get("historyTailPath")
    history_sha = seal.get("historyTailSha256")
    if not isinstance(history_path_value, str) or not isinstance(history_sha, str):
        raise UnmeasuredError("candidate history-tail binding is invalid")
    history_path = state_root / history_path_value
    if history_path.resolve().parent != state_root.resolve() or not history_path.is_file():
        raise UnmeasuredError("candidate history-tail path is invalid")
    if sha256_file(history_path) != history_sha:
        raise UnmeasuredError("candidate history-tail digest mismatch")
    return seal


def partition_bounds(config: Mapping[str, JsonValue], partition: str) -> tuple[int, int]:
    partitions = require_mapping(config.get("partitions"), "partitions")
    contract = require_mapping(partitions.get(partition), f"partitions.{partition}")
    start = contract.get("startInclusiveUtc")
    end = contract.get("endExclusiveUtc")
    if not isinstance(start, str) or not isinstance(end, str):
        raise UnmeasuredError(f"invalid partition bounds: {partition}")
    return parse_utc_us(start), parse_utc_us(end)


def consume_archives(state_root: Path, partition: str) -> tuple[list[Bar], dict[str, JsonValue]]:
    source_manifest = inventory_partition(state_root, partition)
    manifest_path = state_root / f"{partition}_source_manifest.v1.json"
    write_once(manifest_path, source_manifest)
    marker_path = state_root / "markers" / f"{partition}_consumed.v1.json"
    if partition == "development":
        write_once(
            marker_path,
            {
                "law": "WRITTEN_BEFORE_FIRST_DEVELOPMENT_ZIP_MEMBER_OPEN",
                "sourceManifestSha256": sha256_file(manifest_path),
                "version": "VG14DevelopmentConsumptionMarkerV1",
            },
        )
    else:
        if not (state_root / "markers" / "holdout_opened.v1.json").exists():
            raise UnmeasuredError("holdout open marker is absent")
        write_once(
            marker_path,
            {
                "law": "SINGLE_HOLDOUT_MEMBER_CONSUMPTION",
                "sourceManifestSha256": sha256_file(manifest_path),
                "version": "VG14HoldoutConsumptionMarkerV1",
            },
        )
    config = protocol()
    bars: list[Bar] = []
    for symbol, month, _url in archive_specs(config, partition):
        archive_path, _ = custody_paths(state_root, partition, symbol, month)
        bars.extend(open_authenticated_archive(archive_path, symbol, month))
    return bars, source_manifest


def serialize_tail(bars: Sequence[Bar], minimum_time_us: int) -> bytes:
    rows = [
        {
            "open": str(bar.open_price),
            "openTimeUs": bar.open_time_us,
            "quoteVolume": str(bar.quote_volume),
            "symbol": bar.symbol,
        }
        for bar in bars
        if bar.open_time_us >= minimum_time_us
    ]
    return b"".join(canonical_json_bytes(cast(JsonValue, row)) for row in rows)


def parse_tail(path: Path, expected_sha256: str) -> list[Bar]:
    payload = path.read_bytes()
    if sha256_bytes(payload) != expected_sha256:
        raise UnmeasuredError("sealed development history-tail digest mismatch")
    bars: list[Bar] = []
    for line_number, line in enumerate(payload.splitlines(), start=1):
        try:
            value = json.loads(line)
        except json.JSONDecodeError as exc:
            raise UnmeasuredError(f"invalid history-tail JSON line {line_number}") from exc
        if not isinstance(value, dict):
            raise UnmeasuredError(f"invalid history-tail object line {line_number}")
        try:
            symbol = value["symbol"]
            open_time = value["openTimeUs"]
            open_price = value["open"]
            quote_volume = value["quoteVolume"]
        except KeyError as exc:
            raise UnmeasuredError(f"missing history-tail field line {line_number}") from exc
        if not isinstance(symbol, str) or not isinstance(open_time, int):
            raise UnmeasuredError(f"invalid history-tail identity line {line_number}")
        bars.append(
            Bar(
                symbol,
                open_time,
                parse_positive_decimal(str(open_price), "tail.open"),
                parse_positive_decimal(str(quote_volume), "tail.quoteVolume"),
            )
        )
    return bars


def limitations() -> list[JsonValue]:
    return [
        "ACCOUNT_EFFECTIVE_FEES_UNKNOWN",
        "HISTORICAL_SPREAD_DEPTH_IMPACT_FILLABILITY_LATENCY_UNMEASURED",
        "PROXY_CAPACITY_IS_NOT_EXECUTABLE_CAPACITY",
        "FIXED_TEN_SYMBOL_COHORT_LIMITS_GENERALIZABILITY",
        "PUBLIC_RESEARCH_ONLY_NOT_CAPITAL_AUTHORITY",
    ]


def terminal_payload(
    verdict: str,
    *,
    phase: str,
    result_path: Path | None = None,
    reason: str | None = None,
) -> dict[str, JsonValue]:
    payload: dict[str, JsonValue] = {
        "accountEffectiveFees": "UNKNOWN",
        "capitalAuthority": "NONE",
        "effectUsd": "0",
        "limitations": limitations(),
        "phase": phase,
        "verdict": verdict,
        "version": "VG14TerminalEvidenceV1",
    }
    if result_path is not None:
        payload["resultPath"] = result_path.name
        payload["resultSha256"] = sha256_file(result_path)
    if reason is not None:
        payload["reason"] = reason
    return payload


def consume_development(state_root: Path) -> dict[str, JsonValue]:
    require_no_terminal(state_root)
    assert_holdout_absent(state_root)
    config = protocol()
    verify_evaluator_freeze(state_root)
    bars, source_manifest = consume_archives(state_root, "development")
    dev_start, dev_end = partition_bounds(config, "development")
    summaries: list[dict[str, JsonValue]] = []
    round_trips_by_id: dict[str, list[RoundTrip]] = {}
    for index, spec in enumerate(trial_specs(config)):
        trips = evaluate_round_trips(bars, spec, dev_start, dev_end, config)
        round_trips_by_id[spec.trial_id] = trips
        summaries.append(summarize_trial(spec, trips, config, index))
    apply_development_gates(summaries, config)
    champion = select_champion(summaries)
    result: dict[str, JsonValue] = {
        "accountEffectiveFees": "UNKNOWN",
        "archiveObjectCount": len(cast(list[JsonValue], source_manifest["objects"])),
        "barsValidated": len(bars),
        "evaluatorSha256": evaluator_digest(),
        "limitations": limitations(),
        "partition": "development",
        "protocolFreezeSha256": sha256_file(FREEZE_PATH),
        "protocolSha256": sha256_file(PROTOCOL_PATH),
        "sourceManifestSha256": sha256_bytes(
            canonical_json_bytes(cast(JsonValue, source_manifest))
        ),
        "trials": cast(list[JsonValue], summaries),
        "verdict": "NO_GO" if champion is None else "CANDIDATE_SEALED",
        "version": "VG14DevelopmentResultV1",
    }
    if champion is not None:
        champion_id = cast(str, champion["trialId"])
        result["championTrialId"] = champion_id
    result_path = state_root / "development_result.v1.json"
    write_once(result_path, result)
    if champion is not None:
        warmup_start, _ = partition_bounds(config, "warmup")
        tail_minimum = dev_end - 8 * WEEK_US
        if tail_minimum < warmup_start:
            raise UnmeasuredError("invalid history-tail boundary")
        tail_path = state_root / "development_history_tail.v1.jsonl"
        write_bytes_atomic(tail_path, serialize_tail(bars, tail_minimum))
        seal: dict[str, JsonValue] = {
            "champion": champion,
            "developmentConsumptionMarkerSha256": sha256_file(
                state_root / "markers" / "development_consumed.v1.json"
            ),
            "developmentResultSha256": sha256_file(result_path),
            "developmentSourceManifestSha256": sha256_file(
                state_root / "development_source_manifest.v1.json"
            ),
            "evaluatorFreezeSha256": sha256_file(state_root / "evaluator_freeze.v1.json"),
            "evaluatorSha256": evaluator_digest(),
            "historyTailPath": tail_path.name,
            "historyTailSha256": sha256_file(tail_path),
            "protocolFreezeSha256": sha256_file(FREEZE_PATH),
            "protocolSha256": sha256_file(PROTOCOL_PATH),
            "version": "VG14CandidateSealV1",
        }
        write_once(state_root / "candidate_seal.v1.json", seal)
    if champion is None:
        write_once(
            state_root / "terminal_evidence.v1.json",
            terminal_payload("NO_GO", phase="development", result_path=result_path),
        )
    return result


def apply_holdout_gates(
    summary: dict[str, JsonValue], config: Mapping[str, JsonValue]
) -> dict[str, JsonValue]:
    gates = require_mapping(
        require_mapping(config.get("formalGoGates"), "formalGoGates").get("holdout"),
        "formalGoGates.holdout",
    )
    capacity = require_mapping(
        require_mapping(config.get("formalGoGates"), "formalGoGates").get("proxyCapacity"),
        "formalGoGates.proxyCapacity",
    )
    checks: dict[str, JsonValue] = {
        "activeUtcMonths": cast(int, summary["activeUtcMonths"])
        >= cast(int, gates["activeUtcMonthsMinimum"]),
        "bootstrapLowerBound": decimal_metric(summary, "bootstrapLowerBoundMeanStressReturn")
        > Decimal(cast(str, gates["bootstrapLowerBoundExclusiveMinimum"])),
        "maximumStressDrawdown": decimal_metric(summary, "maximumStressDrawdown")
        <= Decimal(cast(str, gates["maximumStressDrawdownMaximum"])),
        "oneSidedPValue": decimal_metric(summary, "rawOneSidedBootstrapPValue")
        <= Decimal(cast(str, gates["oneSidedPValueMaximum"])),
        "positiveUtcMonths": cast(int, summary["positiveUtcMonths"])
        >= cast(int, gates["positiveUtcMonthsMinimum"]),
        "proxyCapacity": decimal_metric(summary, "proxyCapacityFailedFraction")
        <= Decimal(cast(str, capacity["maximumFailedRoundTripFraction"])),
        "roundTrips": cast(int, summary["roundTrips"]) >= cast(int, gates["roundTripsMinimum"]),
        "stressCompoundedReturn": decimal_metric(summary, "stressCompoundedReturn")
        > Decimal(cast(str, gates["stressCompoundedReturnExclusiveMinimum"])),
    }
    summary["gateChecks"] = checks
    summary["passesAllHoldoutGates"] = all(cast(bool, value) for value in checks.values())
    return summary


def consume_holdout(state_root: Path) -> dict[str, JsonValue]:
    require_no_terminal(state_root)
    config = protocol()
    verify_evaluator_freeze(state_root)
    seal = verify_candidate_seal(state_root, config)
    champion = require_mapping(seal.get("champion"), "candidateSeal.champion")
    trial_id = champion.get("trialId")
    if not isinstance(trial_id, str):
        raise UnmeasuredError("candidate seal has no trial ID")
    specs = {item.trial_id: item for item in trial_specs(config)}
    if trial_id not in specs:
        raise UnmeasuredError("candidate seal trial is outside frozen family")
    holdout_bars, source_manifest = consume_archives(state_root, "holdout")
    tail_path_value = seal.get("historyTailPath")
    tail_sha = seal.get("historyTailSha256")
    if not isinstance(tail_path_value, str) or not isinstance(tail_sha, str):
        raise UnmeasuredError("candidate seal history-tail custody is invalid")
    tail_path = state_root / tail_path_value
    if tail_path.resolve().parent != state_root.resolve():
        raise UnmeasuredError("candidate history-tail path escapes state root")
    bars = [*parse_tail(tail_path, tail_sha), *holdout_bars]
    holdout_start, holdout_end = partition_bounds(config, "holdout")
    trips = evaluate_round_trips(bars, specs[trial_id], holdout_start, holdout_end, config)
    summary = summarize_trial(specs[trial_id], trips, config, 100)
    apply_holdout_gates(summary, config)
    verdict = "GO" if summary["passesAllHoldoutGates"] is True else "NO_GO"
    result: dict[str, JsonValue] = {
        "accountEffectiveFees": "UNKNOWN",
        "archiveObjectCount": len(cast(list[JsonValue], source_manifest["objects"])),
        "barsValidated": len(holdout_bars),
        "championTrialId": trial_id,
        "evaluatorSha256": evaluator_digest(),
        "limitations": limitations(),
        "partition": "holdout",
        "protocolFreezeSha256": sha256_file(FREEZE_PATH),
        "protocolSha256": sha256_file(PROTOCOL_PATH),
        "sourceManifestSha256": sha256_bytes(
            canonical_json_bytes(cast(JsonValue, source_manifest))
        ),
        "trial": summary,
        "verdict": verdict,
        "version": "VG14HoldoutResultV1",
    }
    result_path = state_root / "holdout_result.v1.json"
    write_once(result_path, result)
    write_once(
        state_root / "terminal_evidence.v1.json",
        terminal_payload(verdict, phase="holdout", result_path=result_path),
    )
    return result


def record_unmeasured(state_root: Path, phase: str, reason: str) -> None:
    terminal_path = state_root / "terminal_evidence.v1.json"
    if terminal_path.exists():
        return
    write_once(
        terminal_path,
        terminal_payload("UNMEASURED", phase=phase, reason=reason),
    )


def status(state_root: Path) -> dict[str, JsonValue]:
    artifacts = [
        "evaluator_freeze.v1.json",
        "development_acquisition.v1.json",
        "development_source_manifest.v1.json",
        "development_result.v1.json",
        "candidate_seal.v1.json",
        "holdout_acquisition.v1.json",
        "holdout_source_manifest.v1.json",
        "holdout_result.v1.json",
        "terminal_evidence.v1.json",
    ]
    return {
        "artifacts": {name: (state_root / name).exists() for name in artifacts},
        "developmentConsumed": (state_root / "markers" / "development_consumed.v1.json").exists(),
        "holdoutOpened": (state_root / "markers" / "holdout_opened.v1.json").exists(),
        "stateRoot": str(state_root),
        "version": "VG14StatusV1",
    }


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "command",
        choices=(
            "freeze-evaluator",
            "acquire-development",
            "inventory-development",
            "consume-development",
            "acquire-holdout",
            "inventory-holdout",
            "consume-holdout",
            "status",
        ),
    )
    parser.add_argument("--state-root", type=Path, default=DEFAULT_STATE_ROOT)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    state_root = cast(Path, args.state_root).resolve()
    command = cast(str, args.command)
    try:
        if command == "freeze-evaluator":
            result = freeze_evaluator(state_root)
        elif command == "acquire-development":
            result = acquire_partition(state_root, "development")
        elif command == "inventory-development":
            result = inventory_partition(state_root, "development")
        elif command == "consume-development":
            result = consume_development(state_root)
        elif command == "acquire-holdout":
            result = acquire_partition(state_root, "holdout")
        elif command == "inventory-holdout":
            result = inventory_partition(state_root, "holdout")
        elif command == "consume-holdout":
            result = consume_holdout(state_root)
        else:
            result = status(state_root)
    except UnmeasuredError as exc:
        if command != "status":
            with contextlib.suppress(UnmeasuredError):
                record_unmeasured(state_root, command, str(exc))
        print(canonical_json_bytes({"error": str(exc), "verdict": "UNMEASURED"}).decode(), end="")
        return 2
    print(canonical_json_bytes(cast(JsonValue, result)).decode(), end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
