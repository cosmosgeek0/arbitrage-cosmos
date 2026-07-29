"""Sealed V-G6 public Spot low-volume compression breakout experiment.

``inventory`` binds checksum-verified archive bytes without opening a ZIP
member. ``run`` consumes one marker, opens development once, and conditionally
opens the frozen champion-only holdout once. There is deliberately no reset or
rerun command.
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
import re
import statistics
import subprocess
import tempfile
import zipfile
from collections import defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal, InvalidOperation, getcontext
from pathlib import Path
from typing import Any, cast

getcontext().prec = 50

PACKET = Path(__file__).resolve().parent
PROTOCOL_PATH = PACKET / "protocol.v1.json"
README_PATH = PACKET / "README.md"
OFFICIAL_SOURCE_PATH = PACKET / "OFFICIAL_SOURCE_RESEARCH.md"
DISTINCTNESS_PATH = PACKET / "DISTINCTNESS.md"
TEST_PATH = PACKET / "test_experiment.py"
SOURCE_MANIFEST_PATH = PACKET / "source_manifest.v1.json"
FREEZE_PATH = PACKET / "freeze.v1.json"
MARKER_PATH = PACKET / "run-marker.v1.json"
RESULT_PATH = PACKET / "result.v1.json"
VERDICT_PATH = PACKET / "VERDICT.md"
SHA256SUMS_PATH = PACKET / "SHA256SUMS"

BASE_COMMIT = "a169b123fb186d1943a75ad648552c4d95be1be1"
DAY_US = 86_400_000_000
INITIAL_USD = Decimal("1000")
CAPACITY_PARTICIPATION = Decimal("0.0001")
MINIMUM_LIQUIDITY = Decimal("10000000")
ALPHA = 0.05
BOOTSTRAP_REPLICATES = 4096
BOOTSTRAP_BLOCK = 7
BOOTSTRAP_SEED = 2026072906
MAX_MEMBER_BYTES = 128 * 1024
SYMBOL_PATTERN = re.compile(r"^[A-Z0-9]+USDT$", flags=re.ASCII)
CODE_FREEZE_PATHS = (
    "quant/research/vg6/DISTINCTNESS.md",
    "quant/research/vg6/OFFICIAL_SOURCE_RESEARCH.md",
    "quant/research/vg6/README.md",
    "quant/research/vg6/experiment.py",
    "quant/research/vg6/protocol.v1.json",
    "quant/research/vg6/test_experiment.py",
)
GENERATED_FREEZE_PATHS = (
    "quant/research/vg6/freeze.v1.json",
    "quant/research/vg6/source_manifest.v1.json",
)
PREOUTCOME_PATHS = tuple(sorted((*CODE_FREEZE_PATHS, *GENERATED_FREEZE_PATHS)))
JsonObject = dict[str, Any]


class ContractError(RuntimeError):
    """A frozen custody, lifecycle, or schema contract failed."""


class MeasurementError(RuntimeError):
    """The preregistered estimate cannot be measured."""


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
    compression_days: int
    range_maximum: Decimal
    volume_maximum: Decimal
    holding_days: int


@dataclass(frozen=True, slots=True)
class Feature:
    signal_day: date
    symbol: str
    capacity_proxy_usd: Decimal
    range_ratio_5: Decimal
    range_ratio_10: Decimal
    volume_ratio_5: Decimal
    volume_ratio_10: Decimal


@dataclass(frozen=True, slots=True)
class Signal:
    signal_day: date
    symbol: str
    capacity_proxy_usd: Decimal


@dataclass(frozen=True, slots=True)
class Scenario:
    name: str
    fee_rate: Decimal
    adverse_rate: Decimal


@dataclass(frozen=True, slots=True)
class Position:
    symbol: str
    sleeve: int
    entry_day: date
    exit_day: date
    allocation: Decimal
    raw_entry: Decimal
    capacity_proxy_usd: Decimal


@dataclass(frozen=True, slots=True)
class Trade:
    symbol: str
    entry_day: date
    exit_day: date
    allocation: Decimal
    gross_pnl: Decimal
    fee_cost: Decimal
    adverse_cost: Decimal
    net_pnl: Decimal
    capacity_proxy_usd: Decimal


@dataclass(frozen=True, slots=True)
class Simulation:
    scenario: Scenario
    final_nav: Decimal
    net_usd: Decimal
    max_drawdown: Decimal
    daily_changes: tuple[Decimal, ...]
    trades: tuple[Trade, ...]
    raw_signals: int
    suppressed_signals: int
    skipped_entries: int


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
        raise ContractError(f"{path.name} must contain one JSON object")
    return cast(JsonObject, value)


def write_json_once(path: Path, value: object) -> None:
    if path.exists():
        raise ContractError(f"refusing to overwrite {path.name}")
    write_json_replace(path, value)


def write_json_replace(path: Path, value: object) -> None:
    raw = canonical_bytes(value)
    path.parent.mkdir(parents=True, exist_ok=True)
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


def repo_root() -> Path:
    return PACKET.parents[2]


def git_output(*arguments: str, commit: str | None = None) -> str:
    command = ["git", *arguments]
    if commit is not None:
        command.append(commit)
    return subprocess.run(
        command,
        cwd=repo_root(),
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


def git_paths(*arguments: str) -> tuple[str, ...]:
    output = git_output(*arguments)
    return tuple(sorted(line for line in output.splitlines() if line))


def exact_decimal(value: Decimal, places: int = 8) -> str:
    quantum = Decimal(1).scaleb(-places)
    return format(value.quantize(quantum), "f")


def finite_decimal(text: str, *, field: str) -> Decimal:
    try:
        value = Decimal(text)
    except InvalidOperation as exc:
        raise MeasurementError(f"{field} is not a decimal") from exc
    if not value.is_finite():
        raise MeasurementError(f"{field} must be finite")
    return value


def days(start: date, end: date) -> Iterable[date]:
    current = start
    while current <= end:
        yield current
        current += timedelta(days=1)


def month_range(start: str, end: str) -> tuple[str, ...]:
    year, month = (int(part) for part in start.split("-"))
    end_year, end_month = (int(part) for part in end.split("-"))
    result: list[str] = []
    while (year, month) <= (end_year, end_month):
        result.append(f"{year:04d}-{month:02d}")
        month += 1
        if month == 13:
            year += 1
            month = 1
    return tuple(result)


def protocol() -> JsonObject:
    value = load_json(PROTOCOL_PATH)
    if value.get("version") != "VG6ProtocolV1":
        raise ContractError("unexpected protocol version")
    return value


def trials() -> tuple[Trial, ...]:
    result: list[Trial] = []
    for compression in (5, 10):
        for range_text in ("0.04", "0.07"):
            for volume_text in ("0.50", "0.75"):
                for holding in (3, 7):
                    range_maximum = Decimal(range_text)
                    volume_maximum = Decimal(volume_text)
                    trial_id = (
                        f"VG6-C{compression:02d}"
                        f"-R{int(range_maximum * 100):02d}"
                        f"-V{int(volume_maximum * 100):02d}"
                        f"-H{holding:02d}"
                    )
                    result.append(
                        Trial(
                            trial_id=trial_id,
                            compression_days=compression,
                            range_maximum=range_maximum,
                            volume_maximum=volume_maximum,
                            holding_days=holding,
                        )
                    )
    if len(result) != 16:
        raise ContractError("frozen trial family must contain exactly 16 trials")
    return tuple(result)


def scenarios() -> dict[str, Scenario]:
    return {
        "feeOnly": Scenario("feeOnly", Decimal("0.0010"), Decimal("0")),
        "base": Scenario("base", Decimal("0.0010"), Decimal("0.0005")),
        "feeStress": Scenario("feeStress", Decimal("0.0020"), Decimal("0.0005")),
        "combinedStress": Scenario(
            "combinedStress",
            Decimal("0.0020"),
            Decimal("0.0010"),
        ),
    }


def verify_sidecar(sidecar: bytes, archive_name: str, archive_sha: str) -> None:
    try:
        fields = sidecar.decode("ascii").strip().split()
    except UnicodeDecodeError as exc:
        raise ContractError(f"non-ASCII checksum sidecar for {archive_name}") from exc
    if len(fields) != 2:
        raise ContractError(f"invalid checksum grammar for {archive_name}")
    advertised, filename = fields
    if advertised.lower() != archive_sha.lower():
        raise ContractError(f"official checksum mismatch for {archive_name}")
    if filename.lstrip("*") != archive_name:
        raise ContractError(f"checksum filename mismatch for {archive_name}")


def local_artifact_paths(source_root: Path, symbol: str, month: str) -> tuple[Path, Path]:
    archive_name = f"{symbol}-1d-{month}.zip"
    directory = source_root / "archives" / symbol / month
    return directory / archive_name, directory / f"{archive_name}.CHECKSUM"


def verify_code_freeze_commit() -> tuple[str, str]:
    status = git_output("status", "--porcelain", "--untracked-files=all")
    if status:
        raise ContractError("code-freeze Git tree must be clean before inventory")
    head = git_output("rev-parse", "HEAD")
    if head == BASE_COMMIT:
        raise ContractError("human-authored packet must be committed before inventory")
    ancestor = subprocess.run(
        ["git", "merge-base", "--is-ancestor", BASE_COMMIT, head],
        cwd=repo_root(),
        check=False,
    )
    if ancestor.returncode != 0:
        raise ContractError("code freeze is not descended from exact canonical base")
    changed = git_paths("diff", "--name-only", f"{BASE_COMMIT}..{head}")
    if changed != CODE_FREEZE_PATHS:
        raise ContractError("code-freeze commit does not contain the exact admitted path set")
    tracked = git_paths(
        "ls-tree",
        "-r",
        "--name-only",
        head,
        "--",
        "quant/research/vg6",
    )
    if tracked != CODE_FREEZE_PATHS:
        raise ContractError("code-freeze tree contains an unadmitted packet path")
    return head, git_output("rev-parse", f"{head}^{{tree}}")


def inventory(source_root: Path) -> JsonObject:
    for generated in (
        SOURCE_MANIFEST_PATH,
        FREEZE_PATH,
        MARKER_PATH,
        RESULT_PATH,
        VERDICT_PATH,
        SHA256SUMS_PATH,
    ):
        if generated.exists():
            raise ContractError(f"inventory forbidden while {generated.name} exists")

    code_freeze_commit, code_freeze_tree = verify_code_freeze_commit()
    proto = protocol()
    data = cast(JsonObject, proto["data"])
    expected_root = Path(cast(str, data["sourceRoot"]))
    if source_root.resolve() != expected_root.resolve():
        raise ContractError("source root differs from frozen protocol")
    discovery_path = source_root / "discovery.v1.json"
    acquisition_path = source_root / "acquisition-manifest.v1.json"
    if sha256_file(discovery_path) != data["discoverySha256"]:
        raise ContractError("discovery digest mismatch")
    if sha256_file(acquisition_path) != data["sourceAcquisitionManifestSha256"]:
        raise ContractError("acquisition-manifest digest mismatch")

    discovery = load_json(discovery_path)
    acquisition = load_json(acquisition_path)
    if discovery.get("state") != "METADATA_ONLY_NO_ARCHIVE_BODY_OPENED":
        raise ContractError("unexpected discovery state")
    if acquisition.get("state") != "CHECKSUM_VERIFIED_ARCHIVES_NOT_DECOMPRESSED":
        raise ContractError("unexpected acquisition state")

    universe_object = cast(JsonObject, discovery["universe"])
    discovered = cast(list[object], universe_object["symbols"])
    symbols: list[str] = []
    for raw_symbol in discovered:
        if not isinstance(raw_symbol, str) or SYMBOL_PATTERN.fullmatch(raw_symbol) is None:
            raise ContractError("discovery universe contains an invalid symbol")
        symbols.append(raw_symbol)
    if symbols != sorted(set(symbols)):
        raise ContractError("discovery universe must be sorted and unique")

    raw_pairs = cast(list[object], acquisition["artifactPairs"])
    by_key: dict[tuple[str, str], JsonObject] = {}
    for raw_pair in raw_pairs:
        if not isinstance(raw_pair, dict):
            raise ContractError("artifact pair must be an object")
        pair = cast(JsonObject, raw_pair)
        symbol = pair.get("symbol")
        month = pair.get("month")
        if not isinstance(symbol, str) or not isinstance(month, str):
            raise ContractError("artifact pair identity is malformed")
        key = (symbol, month)
        if key in by_key:
            raise ContractError(f"duplicate artifact pair: {symbol} {month}")
        by_key[key] = pair

    preperiod_months = ("2025-04", "2025-05", "2025-06")
    admitted_symbols = tuple(
        symbol for symbol in symbols if all((symbol, month) in by_key for month in preperiod_months)
    )
    if not admitted_symbols:
        raise ContractError("frozen pre-period universe is empty")
    target_months = month_range("2025-04", "2026-06")

    artifacts: list[JsonObject] = []
    missing: list[str] = []
    for symbol in admitted_symbols:
        for month in target_months:
            selected_pair = by_key.get((symbol, month))
            if selected_pair is None:
                missing.append(f"{symbol}|{month}")
                continue
            if selected_pair.get("state") not in {
                "DOWNLOADED_VERIFIED",
                "RESUMED_VERIFIED",
            }:
                raise ContractError(f"unverified pair state: {symbol} {month}")
            archive_path, checksum_path = local_artifact_paths(source_root, symbol, month)
            if not archive_path.is_file() or not checksum_path.is_file():
                raise ContractError(f"frozen artifact missing: {symbol} {month}")
            archive_sha = sha256_file(archive_path)
            checksum_sha = sha256_file(checksum_path)
            if archive_sha != selected_pair.get("zipSha256"):
                raise ContractError(f"archive digest mismatch: {symbol} {month}")
            if checksum_sha != selected_pair.get("checksumSha256"):
                raise ContractError(f"sidecar digest mismatch: {symbol} {month}")
            if archive_path.stat().st_size != selected_pair.get("zipBytes"):
                raise ContractError(f"archive size mismatch: {symbol} {month}")
            if checksum_path.stat().st_size != selected_pair.get("checksumBytes"):
                raise ContractError(f"sidecar size mismatch: {symbol} {month}")
            verify_sidecar(checksum_path.read_bytes(), archive_path.name, archive_sha)
            artifacts.append(
                {
                    "archiveBytes": archive_path.stat().st_size,
                    "archivePath": str(archive_path.relative_to(source_root)),
                    "archiveSha256": archive_sha,
                    "checksumBytes": checksum_path.stat().st_size,
                    "checksumPath": str(checksum_path.relative_to(source_root)),
                    "checksumSha256": checksum_sha,
                    "month": month,
                    "officialChecksumMatched": True,
                    "symbol": symbol,
                }
            )

    manifest: JsonObject = {
        "archiveBodiesOpened": False,
        "artifactCount": len(artifacts),
        "artifacts": artifacts,
        "createdAtUtc": utc_now(),
        "discoverySha256": sha256_file(discovery_path),
        "missingSymbolMonths": missing,
        "schema": "VG6SourceManifestV1",
        "sourceAcquisitionManifestSha256": sha256_file(acquisition_path),
        "sourceRoot": str(source_root.resolve()),
        "state": "BYTE_HASHES_AND_OFFICIAL_CHECKSUMS_VERIFIED_NO_ZIP_MEMBER_OPENED",
        "targetMonths": list(target_months),
        "universe": {
            "count": len(admitted_symbols),
            "sha256": sha256_bytes(canonical_bytes(list(admitted_symbols))),
            "symbols": list(admitted_symbols),
        },
    }
    write_json_once(SOURCE_MANIFEST_PATH, manifest)

    frozen_paths = (
        PROTOCOL_PATH,
        Path(__file__).resolve(),
        TEST_PATH,
        README_PATH,
        OFFICIAL_SOURCE_PATH,
        DISTINCTNESS_PATH,
        SOURCE_MANIFEST_PATH,
    )
    frozen_files = {path.name: sha256_file(path) for path in frozen_paths}
    freeze: JsonObject = {
        "admittedTrackedPaths": list(PREOUTCOME_PATHS),
        "archiveBodiesOpened": False,
        "baseCommit": BASE_COMMIT,
        "codeFreezeCommit": code_freeze_commit,
        "codeFreezeTree": code_freeze_tree,
        "createdAtUtc": utc_now(),
        "frozenFiles": frozen_files,
        "schema": "VG6FreezeV1",
        "sourceManifestSha256": frozen_files[SOURCE_MANIFEST_PATH.name],
        "state": "FROZEN_PRE_OUTCOME",
        "trialCount": len(trials()),
        "universeCount": len(admitted_symbols),
        "universeSha256": cast(JsonObject, manifest["universe"])["sha256"],
    }
    write_json_once(FREEZE_PATH, freeze)
    return freeze


def parse_kline_archive(
    raw_zip: bytes,
    *,
    archive_name: str,
    symbol: str,
    month: str,
) -> tuple[Bar, ...]:
    try:
        archive = zipfile.ZipFile(io.BytesIO(raw_zip))
    except zipfile.BadZipFile as exc:
        raise MeasurementError(f"invalid ZIP: {symbol} {month}") from exc
    with archive:
        members = archive.infolist()
        expected_member = archive_name.removesuffix(".zip") + ".csv"
        if len(members) != 1 or members[0].is_dir() or members[0].filename != expected_member:
            raise MeasurementError(f"unsafe ZIP member shape: {symbol} {month}")
        member = members[0]
        if member.file_size > MAX_MEMBER_BYTES:
            raise MeasurementError(f"ZIP member too large: {symbol} {month}")
        raw_csv = archive.read(member)
    if len(raw_csv) != member.file_size:
        raise MeasurementError(f"ZIP member size mismatch: {symbol} {month}")
    try:
        text = raw_csv.decode("ascii")
    except UnicodeDecodeError as exc:
        raise MeasurementError(f"non-ASCII CSV: {symbol} {month}") from exc

    result: list[Bar] = []
    previous_day: date | None = None
    for row_number, row in enumerate(csv.reader(io.StringIO(text)), start=1):
        if len(row) != 12:
            raise MeasurementError(f"malformed kline row: {symbol} {month} #{row_number}")
        try:
            open_time = int(row[0])
            close_time = int(row[6])
            trade_count = int(row[8])
        except ValueError as exc:
            raise MeasurementError(
                f"invalid integer kline field: {symbol} {month} #{row_number}"
            ) from exc
        if open_time % DAY_US != 0 or close_time != open_time + DAY_US - 1:
            raise MeasurementError(
                f"daily timestamp boundary invalid: {symbol} {month} #{row_number}"
            )
        day = datetime.fromtimestamp(open_time / 1_000_000, tz=UTC).date()
        if day.strftime("%Y-%m") != month:
            raise MeasurementError(f"kline month mismatch: {symbol} {month} #{row_number}")
        if previous_day is not None and day <= previous_day:
            raise MeasurementError(f"kline chronology invalid: {symbol} {month}")
        previous_day = day
        open_price = finite_decimal(row[1], field="open")
        high = finite_decimal(row[2], field="high")
        low = finite_decimal(row[3], field="low")
        close = finite_decimal(row[4], field="close")
        base_volume = finite_decimal(row[5], field="base volume")
        quote_volume = finite_decimal(row[7], field="quote volume")
        taker_base = finite_decimal(row[9], field="taker base volume")
        taker_quote = finite_decimal(row[10], field="taker quote volume")
        if min(open_price, high, low, close) <= 0:
            raise MeasurementError(f"non-positive price: {symbol} {month} #{row_number}")
        if high < max(open_price, close) or low > min(open_price, close) or high < low:
            raise MeasurementError(f"OHLC invariant invalid: {symbol} {month} #{row_number}")
        if min(base_volume, quote_volume, taker_base, taker_quote) < 0 or trade_count < 0:
            raise MeasurementError(f"negative volume/trades: {symbol} {month} #{row_number}")
        result.append(
            Bar(
                day=day,
                open=open_price,
                high=high,
                low=low,
                close=close,
                quote_volume=quote_volume,
            )
        )
    if not result:
        raise MeasurementError(f"empty kline archive: {symbol} {month}")
    return tuple(result)


def resolve_within(root: Path, relative: str) -> Path:
    candidate = (root / relative).resolve()
    try:
        candidate.relative_to(root.resolve())
    except ValueError as exc:
        raise ContractError("artifact path escapes frozen source root") from exc
    return candidate


def load_bars(
    manifest: JsonObject,
    *,
    months: set[str],
    existing: dict[str, dict[date, Bar]] | None = None,
) -> dict[str, dict[date, Bar]]:
    source_root = Path(cast(str, manifest["sourceRoot"]))
    bars = existing if existing is not None else {}
    raw_artifacts = cast(list[object], manifest["artifacts"])
    for raw_artifact in raw_artifacts:
        if not isinstance(raw_artifact, dict):
            raise ContractError("source artifact must be an object")
        artifact = cast(JsonObject, raw_artifact)
        month = cast(str, artifact["month"])
        if month not in months:
            continue
        symbol = cast(str, artifact["symbol"])
        archive_path = resolve_within(source_root, cast(str, artifact["archivePath"]))
        checksum_path = resolve_within(source_root, cast(str, artifact["checksumPath"]))
        if sha256_file(archive_path) != artifact["archiveSha256"]:
            raise MeasurementError(f"archive changed after freeze: {symbol} {month}")
        if sha256_file(checksum_path) != artifact["checksumSha256"]:
            raise MeasurementError(f"sidecar changed after freeze: {symbol} {month}")
        raw_zip = archive_path.read_bytes()
        verify_sidecar(
            checksum_path.read_bytes(),
            archive_path.name,
            cast(str, artifact["archiveSha256"]),
        )
        parsed = parse_kline_archive(
            raw_zip,
            archive_name=archive_path.name,
            symbol=symbol,
            month=month,
        )
        symbol_bars = bars.setdefault(symbol, {})
        for bar in parsed:
            if bar.day in symbol_bars:
                raise MeasurementError(f"duplicate daily bar: {symbol} {bar.day.isoformat()}")
            symbol_bars[bar.day] = bar
    return bars


def required_bars(
    symbol_bars: dict[date, Bar],
    end_exclusive: date,
    count: int,
) -> tuple[Bar, ...] | None:
    start = end_exclusive - timedelta(days=count)
    values: list[Bar] = []
    for day in days(start, end_exclusive - timedelta(days=1)):
        bar = symbol_bars.get(day)
        if bar is None:
            return None
        values.append(bar)
    return tuple(values)


def median_decimal(values: Sequence[Decimal]) -> Decimal:
    if not values:
        raise ContractError("median requires at least one value")
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) / Decimal(2)


def build_features(
    bars: dict[str, dict[date, Bar]],
    *,
    start: date,
    end: date,
) -> tuple[Feature, ...]:
    features: list[Feature] = []
    for symbol in sorted(bars):
        symbol_bars = bars[symbol]
        for signal_day in days(start, end):
            signal_bar = symbol_bars.get(signal_day)
            history = required_bars(symbol_bars, signal_day, 70)
            if signal_bar is None or history is None:
                continue
            prior_20 = history[-20:]
            if signal_bar.close <= max(bar.high for bar in prior_20):
                continue
            prior_20_quote = tuple(bar.quote_volume for bar in history[-20:])
            breakout_volume_baseline = median_decimal(prior_20_quote)
            if breakout_volume_baseline <= 0:
                continue
            if signal_bar.quote_volume / breakout_volume_baseline >= Decimal("1.50"):
                continue
            prior_30_liquidity = median_decimal(tuple(bar.quote_volume for bar in history[-30:]))
            if prior_30_liquidity < MINIMUM_LIQUIDITY:
                continue

            compression_5 = history[-5:]
            compression_10 = history[-10:]
            baseline_5 = history[-65:-5]
            baseline_10 = history[-70:-10]
            close_5 = compression_5[-1].close
            close_10 = compression_10[-1].close
            range_5 = (
                max(bar.high for bar in compression_5) - min(bar.low for bar in compression_5)
            ) / close_5
            range_10 = (
                max(bar.high for bar in compression_10) - min(bar.low for bar in compression_10)
            ) / close_10
            median_5 = median_decimal(tuple(bar.quote_volume for bar in baseline_5))
            median_10 = median_decimal(tuple(bar.quote_volume for bar in baseline_10))
            if median_5 <= 0 or median_10 <= 0:
                continue
            volume_5 = (
                sum((bar.quote_volume for bar in compression_5), Decimal(0)) / Decimal(5) / median_5
            )
            volume_10 = (
                sum((bar.quote_volume for bar in compression_10), Decimal(0))
                / Decimal(10)
                / median_10
            )
            features.append(
                Feature(
                    signal_day=signal_day,
                    symbol=symbol,
                    capacity_proxy_usd=prior_30_liquidity * CAPACITY_PARTICIPATION,
                    range_ratio_5=range_5,
                    range_ratio_10=range_10,
                    volume_ratio_5=volume_5,
                    volume_ratio_10=volume_10,
                )
            )
    features.sort(key=lambda item: (item.signal_day, item.symbol))
    return tuple(features)


def signals_for_trial(features: Sequence[Feature], trial: Trial) -> tuple[Signal, ...]:
    result: list[Signal] = []
    for feature in features:
        if trial.compression_days == 5:
            range_ratio = feature.range_ratio_5
            volume_ratio = feature.volume_ratio_5
        elif trial.compression_days == 10:
            range_ratio = feature.range_ratio_10
            volume_ratio = feature.volume_ratio_10
        else:
            raise ContractError("unknown compression length")
        if range_ratio <= trial.range_maximum and volume_ratio <= trial.volume_maximum:
            result.append(
                Signal(
                    signal_day=feature.signal_day,
                    symbol=feature.symbol,
                    capacity_proxy_usd=feature.capacity_proxy_usd,
                )
            )
    return tuple(result)


def modeled_proceeds(
    allocation: Decimal,
    raw_entry: Decimal,
    raw_exit: Decimal,
    scenario: Scenario,
) -> tuple[Decimal, Decimal, Decimal, Decimal]:
    gross_proceeds = allocation * raw_exit / raw_entry
    adverse_proceeds = gross_proceeds * (
        (Decimal(1) - scenario.adverse_rate) / (Decimal(1) + scenario.adverse_rate)
    )
    actual_proceeds = adverse_proceeds * (Decimal(1) - scenario.fee_rate) ** 2
    gross_pnl = gross_proceeds - allocation
    adverse_cost = gross_proceeds - adverse_proceeds
    fee_cost = adverse_proceeds - actual_proceeds
    return actual_proceeds, gross_pnl, adverse_cost, fee_cost


def simulate(
    bars: dict[str, dict[date, Bar]],
    signals: Sequence[Signal],
    *,
    start: date,
    end: date,
    holding_days: int,
    scenario: Scenario,
) -> Simulation:
    valid_signals = tuple(
        signal
        for signal in signals
        if start <= signal.signal_day
        and signal.signal_day + timedelta(days=holding_days + 1) <= end
    )
    by_signal_day: dict[date, list[Signal]] = defaultdict(list)
    for signal in valid_signals:
        by_signal_day[signal.signal_day].append(signal)
    for day_signals in by_signal_day.values():
        day_signals.sort(key=lambda item: item.symbol)

    sleeve_value = INITIAL_USD / Decimal(holding_days)
    sleeve_cash = [sleeve_value for _ in range(holding_days)]
    sleeve_cash[-1] = INITIAL_USD - sum(sleeve_cash[:-1], Decimal(0))
    positions: dict[str, Position] = {}
    scheduled: dict[date, list[Signal]] = defaultdict(list)
    trades: list[Trade] = []
    suppressed = 0
    skipped_entries = 0
    previous_nav = INITIAL_USD
    peak_nav = INITIAL_USD
    max_drawdown = Decimal(0)
    daily_changes: list[Decimal] = []

    for current_day in days(start, end):
        for symbol in sorted(
            symbol for symbol, position in positions.items() if position.exit_day == current_day
        ):
            position = positions.pop(symbol)
            exit_bar = bars.get(symbol, {}).get(current_day)
            if exit_bar is None:
                raise MeasurementError(
                    f"missing exit after successful entry: {symbol} {current_day}"
                )
            proceeds, gross_pnl, adverse_cost, fee_cost = modeled_proceeds(
                position.allocation,
                position.raw_entry,
                exit_bar.open,
                scenario,
            )
            sleeve_cash[position.sleeve] += proceeds
            trades.append(
                Trade(
                    symbol=symbol,
                    entry_day=position.entry_day,
                    exit_day=current_day,
                    allocation=position.allocation,
                    gross_pnl=gross_pnl,
                    fee_cost=fee_cost,
                    adverse_cost=adverse_cost,
                    net_pnl=proceeds - position.allocation,
                    capacity_proxy_usd=position.capacity_proxy_usd,
                )
            )

        entering = scheduled.get(current_day, [])
        if entering:
            sleeve = current_day.toordinal() % holding_days
            if any(position.sleeve == sleeve for position in positions.values()):
                raise ContractError("cash sleeve was not free on its rotation day")
            allocation = sleeve_cash[sleeve] / Decimal(len(entering))
            for signal in entering:
                entry_bar = bars.get(signal.symbol, {}).get(current_day)
                if entry_bar is None:
                    skipped_entries += 1
                    continue
                sleeve_cash[sleeve] -= allocation
                positions[signal.symbol] = Position(
                    symbol=signal.symbol,
                    sleeve=sleeve,
                    entry_day=current_day,
                    exit_day=current_day + timedelta(days=holding_days),
                    allocation=allocation,
                    raw_entry=entry_bar.open,
                    capacity_proxy_usd=signal.capacity_proxy_usd,
                )

        nav = sum(sleeve_cash, Decimal(0))
        for position in positions.values():
            mark_bar = bars.get(position.symbol, {}).get(current_day)
            if mark_bar is None:
                raise MeasurementError(
                    f"missing mark while position open: {position.symbol} {current_day}"
                )
            liquidation, _, _, _ = modeled_proceeds(
                position.allocation,
                position.raw_entry,
                mark_bar.open,
                scenario,
            )
            nav += liquidation
        daily_changes.append(nav - previous_nav)
        previous_nav = nav
        peak_nav = max(peak_nav, nav)
        if peak_nav > 0:
            max_drawdown = max(max_drawdown, (peak_nav - nav) / peak_nav)

        next_entry_day = current_day + timedelta(days=1)
        if next_entry_day + timedelta(days=holding_days) <= end:
            for signal in by_signal_day.get(current_day, []):
                if signal.symbol in positions:
                    suppressed += 1
                    continue
                scheduled[next_entry_day].append(signal)

    if positions:
        raise MeasurementError("terminal partition ended with open positions")
    final_nav = sum(sleeve_cash, Decimal(0))
    if abs(sum(daily_changes, Decimal(0)) - (final_nav - INITIAL_USD)) > Decimal("0.00000001"):
        raise ContractError("daily NAV changes do not reconcile to terminal NAV")
    return Simulation(
        scenario=scenario,
        final_nav=final_nav,
        net_usd=final_nav - INITIAL_USD,
        max_drawdown=max_drawdown,
        daily_changes=tuple(daily_changes),
        trades=tuple(trades),
        raw_signals=len(valid_signals),
        suppressed_signals=suppressed,
        skipped_entries=skipped_entries,
    )


def percentile(values: Sequence[float], probability: float) -> float:
    if not values:
        raise MeasurementError("percentile requires observations")
    ordered = sorted(values)
    position = probability * (len(ordered) - 1)
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    weight = position - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


def circular_resample_sum(
    values: Sequence[float],
    rng: random.Random,
    *,
    block_length: int,
) -> float:
    count = len(values)
    total = 0.0
    sampled = 0
    while sampled < count:
        block_start = rng.randrange(count)
        for offset in range(min(block_length, count - sampled)):
            total += values[(block_start + offset) % count]
            sampled += 1
    return total


def bootstrap_interval(
    changes: Sequence[Decimal],
    *,
    seed: int,
) -> tuple[float, float]:
    if len(changes) < BOOTSTRAP_BLOCK:
        raise MeasurementError("insufficient daily changes for bootstrap")
    values = tuple(float(value) for value in changes)
    rng = random.Random(seed)
    totals = [
        circular_resample_sum(values, rng, block_length=BOOTSTRAP_BLOCK)
        for _ in range(BOOTSTRAP_REPLICATES)
    ]
    return percentile(totals, 0.025), percentile(totals, 0.975)


def synchronous_centered_p_values(
    trial_changes: Sequence[Sequence[Decimal]],
) -> tuple[float, ...]:
    if not trial_changes:
        raise ContractError("p-value matrix must not be empty")
    count = len(trial_changes[0])
    if count < BOOTSTRAP_BLOCK or any(len(row) != count for row in trial_changes):
        raise MeasurementError("invalid synchronous bootstrap matrix")
    float_rows = [tuple(float(value) for value in row) for row in trial_changes]
    observed = [sum(row) for row in float_rows]
    centered = [tuple(value - statistics.fmean(row) for value in row) for row in float_rows]
    exceed = [0 for _ in centered]
    rng = random.Random(BOOTSTRAP_SEED)
    for _ in range(BOOTSTRAP_REPLICATES):
        indices: list[int] = []
        while len(indices) < count:
            block_start = rng.randrange(count)
            take = min(BOOTSTRAP_BLOCK, count - len(indices))
            indices.extend((block_start + offset) % count for offset in range(take))
        for trial_index, row in enumerate(centered):
            boot_total = sum(row[index] for index in indices)
            if boot_total >= observed[trial_index]:
                exceed[trial_index] += 1
    return tuple((value + 1) / (BOOTSTRAP_REPLICATES + 1) for value in exceed)


def holm_decisions(
    trial_ids: Sequence[str],
    p_values: Sequence[float],
) -> tuple[dict[str, object], ...]:
    if len(trial_ids) != len(p_values) or not trial_ids:
        raise ContractError("Holm identities and p-values must align")
    ordered = sorted(zip(p_values, trial_ids, strict=True))
    adjusted_by_id: dict[str, float] = {}
    selected_by_id: dict[str, bool] = {}
    running_adjusted = 0.0
    latched_failure = False
    total = len(ordered)
    for index, (raw_p, trial_id) in enumerate(ordered):
        remaining = total - index
        threshold = ALPHA / remaining
        running_adjusted = max(running_adjusted, min(1.0, raw_p * remaining))
        selected = not latched_failure and raw_p < threshold
        if not selected:
            latched_failure = True
        adjusted_by_id[trial_id] = running_adjusted
        selected_by_id[trial_id] = selected
    return tuple(
        {
            "adjustedPValue": f"{adjusted_by_id[trial_id]:.8f}",
            "rawPValue": f"{p_value:.8f}",
            "selected": selected_by_id[trial_id],
            "trialId": trial_id,
        }
        for trial_id, p_value in zip(trial_ids, p_values, strict=True)
    )


def cscv_pbo(block_scores: Sequence[Sequence[Decimal]]) -> JsonObject:
    trial_count = len(block_scores)
    if trial_count < 2:
        raise MeasurementError("PBO requires at least two trials")
    block_count = len(block_scores[0])
    if block_count < 4 or block_count > 16 or block_count % 2:
        raise MeasurementError("PBO block count must be even and between 4 and 16")
    if any(len(row) != block_count for row in block_scores):
        raise MeasurementError("PBO rows must have equal block counts")
    half = block_count // 2
    split_count = 0
    underperform_count = 0
    for in_sample in itertools.combinations(range(block_count), half):
        split_count += 1
        out_sample = tuple(index for index in range(block_count) if index not in in_sample)
        in_means = [
            sum((row[index] for index in in_sample), Decimal(0)) / Decimal(half)
            for row in block_scores
        ]
        best_trial = max(
            range(trial_count),
            key=lambda index: (in_means[index], -index),
        )
        out_means = [
            sum((row[index] for index in out_sample), Decimal(0)) / Decimal(half)
            for row in block_scores
        ]
        ordered = sorted(out_means)
        median = (ordered[(trial_count - 1) // 2] + ordered[trial_count // 2]) / Decimal(2)
        if out_means[best_trial] <= median:
            underperform_count += 1
    pbo = Decimal(underperform_count) / Decimal(split_count)
    distinct_rows = len({tuple(exact_decimal(value, 12) for value in row) for row in block_scores})
    return {
        "blockCount": block_count,
        "distinctTrialRows": distinct_rows,
        "pbo": exact_decimal(pbo, 8),
        "role": "DIAGNOSTIC_ONLY",
        "splitCount": split_count,
        "trialCount": trial_count,
        "underperformCount": underperform_count,
    }


def calendar_block_scores(
    simulation: Simulation,
    *,
    start: date,
    block_months: Sequence[str],
) -> tuple[Decimal, ...]:
    partition_days = tuple(
        start + timedelta(days=offset) for offset in range(len(simulation.daily_changes))
    )
    if not partition_days:
        raise MeasurementError("calendar block scoring requires daily changes")
    allowed = set(block_months)
    scores = {month: Decimal(0) for month in block_months}
    for day, change in zip(
        partition_days,
        simulation.daily_changes,
        strict=True,
    ):
        month = day.strftime("%Y-%m")
        if month not in allowed:
            raise MeasurementError("simulation day falls outside declared PBO blocks")
        scores[month] += change
    result = tuple(scores[month] for month in block_months)
    if abs(sum(result, Decimal(0)) - simulation.net_usd) > Decimal("0.00000001"):
        raise ContractError("calendar PBO blocks do not reconcile to development NAV")
    return result


def simulation_metrics(simulation: Simulation) -> JsonObject:
    trades = simulation.trades
    assets = sorted({trade.symbol for trade in trades})
    active_months = sorted({trade.entry_day.strftime("%Y-%m") for trade in trades})
    capacities = sorted(trade.capacity_proxy_usd for trade in trades)
    allocations = sorted(trade.allocation for trade in trades)
    positive_by_asset: dict[str, Decimal] = defaultdict(Decimal)
    positive_trades: list[Decimal] = []
    for trade in trades:
        positive = max(trade.gross_pnl, Decimal(0))
        positive_by_asset[trade.symbol] += positive
        positive_trades.append(positive)
    total_positive = sum(positive_trades, Decimal(0))
    if total_positive > 0:
        top_asset_share = max(positive_by_asset.values(), default=Decimal(0)) / total_positive
        top_five_share = sum(sorted(positive_trades, reverse=True)[:5], Decimal(0)) / total_positive
    else:
        top_asset_share = Decimal(1)
        top_five_share = Decimal(1)

    def decimal_percentile(values: Sequence[Decimal], probability: float) -> Decimal | None:
        if not values:
            return None
        result = percentile(tuple(float(value) for value in values), probability)
        return Decimal(str(result))

    capacity_p05 = decimal_percentile(capacities, 0.05)
    capacity_median = decimal_percentile(capacities, 0.50)
    allocation_maximum = max(allocations, default=None)
    return {
        "activeMonthCount": len(active_months),
        "activeMonths": active_months,
        "adverseExecutionCostUsd": exact_decimal(
            sum((trade.adverse_cost for trade in trades), Decimal(0))
        ),
        "capacityProxy": {
            "executableCapacity": "UNMEASURED",
            "minimumUsd": None if not capacities else exact_decimal(capacities[0]),
            "p05Usd": None if capacity_p05 is None else exact_decimal(capacity_p05),
            "medianUsd": (None if capacity_median is None else exact_decimal(capacity_median)),
            "maximumTradeAllocationUsd": (
                None if allocation_maximum is None else exact_decimal(allocation_maximum)
            ),
        },
        "distinctAssets": len(assets),
        "feeCostUsd": exact_decimal(sum((trade.fee_cost for trade in trades), Decimal(0))),
        "fills": len(trades) * 2,
        "finalNavUsd": exact_decimal(simulation.final_nav),
        "grossPnlUsd": exact_decimal(sum((trade.gross_pnl for trade in trades), Decimal(0))),
        "maximumDrawdown": exact_decimal(simulation.max_drawdown, 8),
        "netUsdPer1000": exact_decimal(simulation.net_usd),
        "rawSignals": simulation.raw_signals,
        "roundTrips": len(trades),
        "scenario": simulation.scenario.name,
        "skippedEntries": simulation.skipped_entries,
        "suppressedSignals": simulation.suppressed_signals,
        "topAssetPositiveGrossProfitShare": exact_decimal(top_asset_share, 8),
        "topFiveTradePositiveGrossProfitShare": exact_decimal(top_five_share, 8),
    }


def stitched_net_and_drawdown(
    simulations: Sequence[Simulation],
) -> tuple[Decimal, Decimal]:
    stitched_nav = INITIAL_USD
    peak_nav = INITIAL_USD
    maximum_drawdown = Decimal(0)
    for simulation in simulations:
        partition_nav = INITIAL_USD
        scale = stitched_nav / INITIAL_USD
        for change in simulation.daily_changes:
            partition_nav += change
            stitched_nav = partition_nav * scale
            peak_nav = max(peak_nav, stitched_nav)
            if peak_nav > 0:
                maximum_drawdown = max(
                    maximum_drawdown,
                    (peak_nav - stitched_nav) / peak_nav,
                )
        expected = simulation.final_nav * scale
        if abs(stitched_nav - expected) > Decimal("0.00000001"):
            raise ContractError("stitched partition NAV failed to reconcile")
    return stitched_nav - INITIAL_USD, maximum_drawdown


def combined_capacity_p05(simulations: Sequence[Simulation]) -> Decimal | None:
    capacities = sorted(
        trade.capacity_proxy_usd for simulation in simulations for trade in simulation.trades
    )
    if not capacities:
        return None
    return Decimal(str(percentile(tuple(float(value) for value in capacities), 0.05)))


def gate(
    gate_id: str,
    passed: bool,
    *,
    observed: object,
    required: object,
) -> JsonObject:
    return {
        "gateId": gate_id,
        "observed": observed,
        "passed": passed,
        "required": required,
    }


def metric_decimal(metrics: JsonObject, key: str) -> Decimal:
    value = metrics.get(key)
    if not isinstance(value, str):
        raise ContractError(f"metric {key} is not a decimal string")
    return Decimal(value)


def capacity_p05(metrics: JsonObject) -> Decimal | None:
    capacity = cast(JsonObject, metrics["capacityProxy"])
    value = capacity.get("p05Usd")
    if value is None:
        return None
    if not isinstance(value, str):
        raise ContractError("capacity p05 is malformed")
    return Decimal(value)


def concentration_gates(metrics: JsonObject) -> tuple[JsonObject, JsonObject]:
    asset_share = metric_decimal(metrics, "topAssetPositiveGrossProfitShare")
    trade_share = metric_decimal(metrics, "topFiveTradePositiveGrossProfitShare")
    return (
        gate(
            "TOP_ASSET_POSITIVE_GROSS_SHARE",
            asset_share <= Decimal("0.25"),
            observed=exact_decimal(asset_share, 8),
            required="<=0.25",
        ),
        gate(
            "TOP_FIVE_TRADE_POSITIVE_GROSS_SHARE",
            trade_share <= Decimal("0.40"),
            observed=exact_decimal(trade_share, 8),
            required="<=0.40",
        ),
    )


def development_gates(
    *,
    base_metrics: JsonObject,
    stress_metrics: JsonObject,
    base_interval: tuple[float, float],
    stress_interval: tuple[float, float],
    adjusted_p_value: float,
    holm_selected: bool,
) -> tuple[JsonObject, ...]:
    capacity = capacity_p05(stress_metrics)
    result = [
        gate(
            "DEVELOPMENT_ROUND_TRIPS",
            cast(int, stress_metrics["roundTrips"]) >= 60,
            observed=stress_metrics["roundTrips"],
            required=">=60",
        ),
        gate(
            "DEVELOPMENT_DISTINCT_ASSETS",
            cast(int, stress_metrics["distinctAssets"]) >= 12,
            observed=stress_metrics["distinctAssets"],
            required=">=12",
        ),
        gate(
            "DEVELOPMENT_ACTIVE_MONTHS",
            cast(int, stress_metrics["activeMonthCount"]) >= 6,
            observed=stress_metrics["activeMonthCount"],
            required=">=6",
        ),
        gate(
            "DEVELOPMENT_BASE_NET",
            metric_decimal(base_metrics, "netUsdPer1000") > 0,
            observed=base_metrics["netUsdPer1000"],
            required=">0",
        ),
        gate(
            "DEVELOPMENT_COMBINED_STRESS_NET",
            metric_decimal(stress_metrics, "netUsdPer1000") > 0,
            observed=stress_metrics["netUsdPer1000"],
            required=">0",
        ),
        gate(
            "DEVELOPMENT_BASE_BOOTSTRAP_LOWER",
            base_interval[0] > 0,
            observed=f"{base_interval[0]:.8f}",
            required=">0",
        ),
        gate(
            "DEVELOPMENT_COMBINED_STRESS_BOOTSTRAP_LOWER",
            stress_interval[0] > 0,
            observed=f"{stress_interval[0]:.8f}",
            required=">0",
        ),
        gate(
            "DEVELOPMENT_HOLM_FWER",
            holm_selected and adjusted_p_value < ALPHA,
            observed={
                "adjustedPValue": f"{adjusted_p_value:.8f}",
                "selected": holm_selected,
            },
            required="selected=true and adjustedPValue<0.05",
        ),
        gate(
            "DEVELOPMENT_MAXIMUM_DRAWDOWN",
            max(
                metric_decimal(base_metrics, "maximumDrawdown"),
                metric_decimal(stress_metrics, "maximumDrawdown"),
            )
            <= Decimal("0.20"),
            observed=max(
                metric_decimal(base_metrics, "maximumDrawdown"),
                metric_decimal(stress_metrics, "maximumDrawdown"),
            ).to_eng_string(),
            required="<=0.20",
        ),
        gate(
            "DEVELOPMENT_CAPACITY_PROXY_P05",
            capacity is not None and capacity >= Decimal("1000"),
            observed=None if capacity is None else exact_decimal(capacity),
            required=">=1000",
        ),
    ]
    result.extend(concentration_gates(stress_metrics))
    return tuple(result)


def holdout_gates(
    *,
    base_metrics: JsonObject,
    stress_metrics: JsonObject,
    base_interval: tuple[float, float],
    stress_interval: tuple[float, float],
) -> tuple[JsonObject, ...]:
    capacity = capacity_p05(stress_metrics)
    result = [
        gate(
            "HOLDOUT_ROUND_TRIPS",
            cast(int, stress_metrics["roundTrips"]) >= 20,
            observed=stress_metrics["roundTrips"],
            required=">=20",
        ),
        gate(
            "HOLDOUT_DISTINCT_ASSETS",
            cast(int, stress_metrics["distinctAssets"]) >= 8,
            observed=stress_metrics["distinctAssets"],
            required=">=8",
        ),
        gate(
            "HOLDOUT_ACTIVE_MONTHS",
            cast(int, stress_metrics["activeMonthCount"]) >= 3,
            observed=stress_metrics["activeMonthCount"],
            required=">=3",
        ),
        gate(
            "HOLDOUT_BASE_NET",
            metric_decimal(base_metrics, "netUsdPer1000") > 0,
            observed=base_metrics["netUsdPer1000"],
            required=">0",
        ),
        gate(
            "HOLDOUT_COMBINED_STRESS_NET",
            metric_decimal(stress_metrics, "netUsdPer1000") > 0,
            observed=stress_metrics["netUsdPer1000"],
            required=">0",
        ),
        gate(
            "HOLDOUT_BASE_BOOTSTRAP_LOWER",
            base_interval[0] > 0,
            observed=f"{base_interval[0]:.8f}",
            required=">0",
        ),
        gate(
            "HOLDOUT_COMBINED_STRESS_BOOTSTRAP_LOWER",
            stress_interval[0] > 0,
            observed=f"{stress_interval[0]:.8f}",
            required=">0",
        ),
        gate(
            "HOLDOUT_MAXIMUM_DRAWDOWN",
            max(
                metric_decimal(base_metrics, "maximumDrawdown"),
                metric_decimal(stress_metrics, "maximumDrawdown"),
            )
            <= Decimal("0.20"),
            observed=max(
                metric_decimal(base_metrics, "maximumDrawdown"),
                metric_decimal(stress_metrics, "maximumDrawdown"),
            ).to_eng_string(),
            required="<=0.20",
        ),
        gate(
            "HOLDOUT_CAPACITY_PROXY_P05",
            capacity is not None and capacity >= Decimal("1000"),
            observed=None if capacity is None else exact_decimal(capacity),
            required=">=1000",
        ),
    ]
    result.extend(concentration_gates(stress_metrics))
    return tuple(result)


def gates_pass(gates: Sequence[JsonObject]) -> bool:
    return all(item.get("passed") is True for item in gates)


def verify_preoutcome_freeze() -> tuple[JsonObject, JsonObject, str]:
    for required in (FREEZE_PATH, SOURCE_MANIFEST_PATH):
        if not required.is_file():
            raise ContractError(f"missing frozen file: {required.name}")
    for forbidden in (MARKER_PATH, RESULT_PATH, VERDICT_PATH, SHA256SUMS_PATH):
        if forbidden.exists():
            raise ContractError(f"run already attempted or terminal: {forbidden.name}")
    freeze = load_json(FREEZE_PATH)
    manifest = load_json(SOURCE_MANIFEST_PATH)
    if freeze.get("state") != "FROZEN_PRE_OUTCOME":
        raise ContractError("freeze state is not pre-outcome")
    if manifest.get("archiveBodiesOpened") is not False:
        raise ContractError("source manifest does not preserve unopened state")
    frozen_files = cast(JsonObject, freeze["frozenFiles"])
    current_paths = {
        PROTOCOL_PATH.name: PROTOCOL_PATH,
        Path(__file__).name: Path(__file__).resolve(),
        TEST_PATH.name: TEST_PATH,
        README_PATH.name: README_PATH,
        OFFICIAL_SOURCE_PATH.name: OFFICIAL_SOURCE_PATH,
        DISTINCTNESS_PATH.name: DISTINCTNESS_PATH,
        SOURCE_MANIFEST_PATH.name: SOURCE_MANIFEST_PATH,
    }
    if set(frozen_files) != set(current_paths):
        raise ContractError("frozen file identity set drifted")
    for name, path in current_paths.items():
        if sha256_file(path) != frozen_files[name]:
            raise ContractError(f"frozen file drifted: {name}")
    if sha256_file(SOURCE_MANIFEST_PATH) != freeze["sourceManifestSha256"]:
        raise ContractError("source manifest no longer matches freeze")
    admitted_paths = freeze.get("admittedTrackedPaths")
    if (
        not isinstance(admitted_paths, list)
        or not all(isinstance(path, str) for path in admitted_paths)
        or tuple(admitted_paths) != PREOUTCOME_PATHS
    ):
        raise ContractError("freeze admitted-path set drifted")

    status = git_output("status", "--porcelain", "--untracked-files=all")
    if status:
        raise ContractError("Git tree must be clean before marker consumption")
    head = git_output("rev-parse", "HEAD")
    code_freeze_commit = cast(str, freeze["codeFreezeCommit"])
    if head in {BASE_COMMIT, code_freeze_commit}:
        raise ContractError("source freeze must be committed after the code freeze")
    ancestor = subprocess.run(
        ["git", "merge-base", "--is-ancestor", BASE_COMMIT, head],
        cwd=repo_root(),
        check=False,
    )
    if ancestor.returncode != 0:
        raise ContractError("pre-outcome commit is not descended from exact canonical base")
    code_ancestor = subprocess.run(
        ["git", "merge-base", "--is-ancestor", code_freeze_commit, head],
        cwd=repo_root(),
        check=False,
    )
    if code_ancestor.returncode != 0:
        raise ContractError("source seal is not descended from frozen code commit")
    if git_output("rev-parse", f"{code_freeze_commit}^{{tree}}") != freeze["codeFreezeTree"]:
        raise ContractError("code-freeze tree identity drifted")
    code_changed = git_paths(
        "diff",
        "--name-only",
        f"{BASE_COMMIT}..{code_freeze_commit}",
    )
    if code_changed != CODE_FREEZE_PATHS:
        raise ContractError("frozen code commit contains an unadmitted path")
    seal_changed = git_paths(
        "diff",
        "--name-only",
        f"{code_freeze_commit}..{head}",
    )
    if seal_changed != GENERATED_FREEZE_PATHS:
        raise ContractError("source-seal commit contains anything beyond frozen evidence")
    tracked = git_paths(
        "ls-tree",
        "-r",
        "--name-only",
        head,
        "--",
        "quant/research/vg6",
    )
    if tracked != PREOUTCOME_PATHS:
        raise ContractError("pre-outcome tree contains an unadmitted packet path")
    return freeze, manifest, head


def trial_summary(
    trial: Trial,
    simulation: Simulation,
    holm: JsonObject,
) -> JsonObject:
    return {
        "adjustedPValue": holm["adjustedPValue"],
        "combinedStressNetUsdPer1000": exact_decimal(simulation.net_usd),
        "compressionDays": trial.compression_days,
        "holdingDays": trial.holding_days,
        "holmSelected": holm["selected"],
        "rangeRatioMaximum": exact_decimal(trial.range_maximum, 2),
        "rawPValue": holm["rawPValue"],
        "roundTrips": len(simulation.trades),
        "trialId": trial.trial_id,
        "volumeRatioMaximum": exact_decimal(trial.volume_maximum, 2),
    }


def marker_update(marker: JsonObject, **updates: object) -> JsonObject:
    durable = load_json(MARKER_PATH) if MARKER_PATH.exists() else marker
    for count_key in ("developmentOpenCount", "holdoutOpenCount"):
        durable_count = durable.get(count_key, 0)
        requested_count = updates.get(count_key, durable_count)
        if (
            not isinstance(durable_count, int)
            or not isinstance(requested_count, int)
            or requested_count < durable_count
        ):
            raise ContractError(f"{count_key} must be a monotone integer")
    changed = dict(durable)
    changed.update(updates)
    write_json_replace(MARKER_PATH, changed)
    return changed


def frozen_limitations() -> list[str]:
    return [
        "Account-effective Binance fees are UNKNOWN; the public regular schedule "
        "and synthetic stress are not account readback.",
        "Spread, slippage, impact, queue position, fill probability, and historical "
        "executable book depth are UNMEASURED.",
        "The one-basis-point quote-volume capacity figure is a causal public proxy, "
        "not executable capacity.",
        "Current exchangeInfo was intentionally not used; historical filter and "
        "exact notional feasibility remain UNMEASURED.",
        "Fractional fills, USDT/USD parity, taxes, BNB eligibility, VIP tier, and "
        "promotions are not established.",
        "Archive-listing eligibility mitigates but cannot eliminate delisting, "
        "listing, and archive-coverage selection effects.",
        "A public-research GO can authorize only a new frozen forward-shadow study; "
        "capitalVerdict remains NO_GO.",
    ]


def execute_measurement(
    freeze: JsonObject,
    manifest: JsonObject,
    preoutcome_commit: str,
    marker: JsonObject,
) -> tuple[JsonObject, JsonObject]:
    trial_family = trials()
    scenario_family = scenarios()
    development_months = set(month_range("2025-04", "2026-02"))
    bars = load_bars(manifest, months=development_months)
    development_start = date(2025, 7, 1)
    development_end = date(2026, 2, 28)
    development_features = build_features(
        bars,
        start=development_start,
        end=development_end,
    )
    signals_by_trial = {
        trial.trial_id: signals_for_trial(development_features, trial) for trial in trial_family
    }
    combined_simulations = tuple(
        simulate(
            bars,
            signals_by_trial[trial.trial_id],
            start=development_start,
            end=development_end,
            holding_days=trial.holding_days,
            scenario=scenario_family["combinedStress"],
        )
        for trial in trial_family
    )
    p_values = synchronous_centered_p_values(
        tuple(simulation.daily_changes for simulation in combined_simulations)
    )
    holm_rows = holm_decisions(
        tuple(trial.trial_id for trial in trial_family),
        p_values,
    )
    holm_by_id = {cast(str, row["trialId"]): row for row in holm_rows}

    ranked = sorted(
        zip(trial_family, combined_simulations, strict=True),
        key=lambda item: (
            -item[1].net_usd,
            item[0].holding_days,
            item[0].range_maximum,
            item[0].volume_maximum,
            item[0].compression_days,
            item[0].trial_id,
        ),
    )
    champion, champion_combined = ranked[0]
    champion_scenarios: dict[str, Simulation] = {
        "combinedStress": champion_combined,
    }
    for scenario_name in ("feeOnly", "base", "feeStress"):
        champion_scenarios[scenario_name] = simulate(
            bars,
            signals_by_trial[champion.trial_id],
            start=development_start,
            end=development_end,
            holding_days=champion.holding_days,
            scenario=scenario_family[scenario_name],
        )

    development_intervals = {
        scenario_name: bootstrap_interval(
            champion_scenarios[scenario_name].daily_changes,
            seed=BOOTSTRAP_SEED + index,
        )
        for index, scenario_name in enumerate(("base", "combinedStress"), start=1)
    }

    pbo_blocks = (
        "2025-07",
        "2025-08",
        "2025-09",
        "2025-10",
        "2025-11",
        "2025-12",
        "2026-01",
        "2026-02",
    )
    block_scores = [
        calendar_block_scores(
            simulation,
            start=development_start,
            block_months=pbo_blocks,
        )
        for simulation in combined_simulations
    ]
    pbo = cscv_pbo(tuple(block_scores))

    champion_holm = holm_by_id[champion.trial_id]
    base_metrics = simulation_metrics(champion_scenarios["base"])
    stress_metrics = simulation_metrics(champion_scenarios["combinedStress"])
    development_gate_rows = development_gates(
        base_metrics=base_metrics,
        stress_metrics=stress_metrics,
        base_interval=development_intervals["base"],
        stress_interval=development_intervals["combinedStress"],
        adjusted_p_value=float(cast(str, champion_holm["adjustedPValue"])),
        holm_selected=cast(bool, champion_holm["selected"]),
    )
    development_passed = gates_pass(development_gate_rows)

    scenario_metrics = {
        name: simulation_metrics(champion_scenarios[name])
        for name in ("feeOnly", "base", "feeStress", "combinedStress")
    }
    development: JsonObject = {
        "bootstrapIntervalsUsdPer1000": {
            name: {
                "coverage": "95%",
                "lower": f"{interval[0]:.8f}",
                "upper": f"{interval[1]:.8f}",
            }
            for name, interval in development_intervals.items()
        },
        "championTrialId": champion.trial_id,
        "gatePassed": development_passed,
        "gates": list(development_gate_rows),
        "holm": {
            "alpha": "0.05",
            "decisions": list(holm_rows),
            "familySize": len(trial_family),
        },
        "interval": {
            "endUtcDateInclusive": development_end.isoformat(),
            "startUtcDateInclusive": development_start.isoformat(),
        },
        "pbo": pbo,
        "scenarioMetrics": scenario_metrics,
        "status": "MEASURED",
        "trialLedger": [
            trial_summary(
                trial,
                simulation,
                holm_by_id[trial.trial_id],
            )
            for trial, simulation in zip(
                trial_family,
                combined_simulations,
                strict=True,
            )
        ],
    }
    selection_hash = sha256_bytes(
        canonical_bytes(
            {
                "championTrialId": champion.trial_id,
                "developmentGatePassed": development_passed,
                "developmentGates": list(development_gate_rows),
                "protocolSha256": sha256_file(PROTOCOL_PATH),
                "trialLedger": development["trialLedger"],
            }
        )
    )

    holdout_interval = {
        "embargoEndUtcDateInclusive": "2026-03-07",
        "endUtcDateInclusive": "2026-06-30",
        "startUtcDateInclusive": "2026-03-01",
    }
    if not development_passed:
        marker = marker_update(
            marker,
            completedAtUtc=utc_now(),
            developmentGatePassed=False,
            holdoutOpenCount=0,
            selectionHash=selection_hash,
            state="MEASUREMENT_COMPLETE_PENDING_SEAL",
            verdict="NO_GO",
        )
        result: JsonObject = {
            "authority": {
                "capitalAuthority": "NONE",
                "executionAuthority": "NONE",
                "publicResearchOnly": True,
            },
            "capitalVerdict": "NO_GO",
            "completedAtUtc": cast(str, marker["completedAtUtc"]),
            "development": development,
            "headline": {
                "baseNetUsdPer1000": base_metrics["netUsdPer1000"],
                "capacityProxyP05Usd": cast(JsonObject, stress_metrics["capacityProxy"])["p05Usd"],
                "combinedStressNetUsdPer1000": stress_metrics["netUsdPer1000"],
                "feeStressNetUsdPer1000": scenario_metrics["feeStress"]["netUsdPer1000"],
                "fills": stress_metrics["fills"],
                "holdoutBootstrapIntervalUsdPer1000": None,
                "maximumDrawdown": stress_metrics["maximumDrawdown"],
                "pbo": pbo["pbo"],
                "roundTrips": stress_metrics["roundTrips"],
                "samples": stress_metrics["rawSignals"],
                "valueHorizon": "DEVELOPMENT_ONLY_HOLDOUT_NOT_OPENED",
            },
            "holdout": {
                "bootstrapIntervalsUsdPer1000": None,
                "gatePassed": None,
                "gates": [],
                "interval": holdout_interval,
                "openCount": 0,
                "reason": "FROZEN_DEVELOPMENT_GATE_FAILED",
                "scenarioMetrics": None,
                "status": "NOT_OPENED_BY_FROZEN_GATE",
            },
            "limitations": frozen_limitations(),
            "lineage": {
                "baseCommit": BASE_COMMIT,
                "freezeSha256": sha256_file(FREEZE_PATH),
                "preOutcomeCommit": preoutcome_commit,
                "selectionHash": selection_hash,
            },
            "measurementWindow": {
                "endUtcDateInclusive": "2026-06-30",
                "holdoutOpened": False,
                "startUtcDateInclusive": "2025-07-01",
            },
            "schema": "VG6ResultV1",
            "twelveMonth": {
                "reason": "FROZEN_DEVELOPMENT_GATE_FAILED",
                "scenarioMetrics": None,
                "status": "NOT_MEASURED_HOLDOUT_NOT_OPENED",
            },
            "verdict": "NO_GO",
            "verdictReason": "ONE_OR_MORE_FROZEN_DEVELOPMENT_GATES_FAILED",
        }
        return result, marker

    marker = marker_update(
        marker,
        developmentGatePassed=True,
        holdoutAuthorizedAtUtc=utc_now(),
        holdoutOpenCount=1,
        selectionHash=selection_hash,
        state="HOLDOUT_OPEN_CONSUMED",
    )
    bars = load_bars(
        manifest,
        months=set(month_range("2026-03", "2026-06")),
        existing=bars,
    )
    holdout_start = date(2026, 3, 1)
    holdout_signal_start = date(2026, 3, 8)
    holdout_end = date(2026, 6, 30)
    holdout_features = build_features(
        bars,
        start=holdout_signal_start,
        end=holdout_end,
    )
    holdout_signals = signals_for_trial(holdout_features, champion)
    holdout_scenarios = {
        name: simulate(
            bars,
            holdout_signals,
            start=holdout_start,
            end=holdout_end,
            holding_days=champion.holding_days,
            scenario=scenario_family[name],
        )
        for name in ("feeOnly", "base", "feeStress", "combinedStress")
    }
    holdout_intervals = {
        scenario_name: bootstrap_interval(
            holdout_scenarios[scenario_name].daily_changes,
            seed=BOOTSTRAP_SEED + 100 + index,
        )
        for index, scenario_name in enumerate(("base", "combinedStress"), start=1)
    }
    holdout_scenario_metrics = {
        name: simulation_metrics(holdout_scenarios[name])
        for name in ("feeOnly", "base", "feeStress", "combinedStress")
    }
    holdout_base_metrics = holdout_scenario_metrics["base"]
    holdout_stress_metrics = holdout_scenario_metrics["combinedStress"]
    holdout_gate_rows = holdout_gates(
        base_metrics=holdout_base_metrics,
        stress_metrics=holdout_stress_metrics,
        base_interval=holdout_intervals["base"],
        stress_interval=holdout_intervals["combinedStress"],
    )
    holdout_passed = gates_pass(holdout_gate_rows)
    verdict = "GO" if holdout_passed else "NO_GO"
    marker = marker_update(
        marker,
        completedAtUtc=utc_now(),
        holdoutGatePassed=holdout_passed,
        state="MEASUREMENT_COMPLETE_PENDING_SEAL",
        verdict=verdict,
    )

    stitched_scenarios: dict[str, JsonObject] = {}
    for scenario_name in ("feeOnly", "base", "feeStress", "combinedStress"):
        net, drawdown = stitched_net_and_drawdown(
            (
                champion_scenarios[scenario_name],
                holdout_scenarios[scenario_name],
            )
        )
        stitched_scenarios[scenario_name] = {
            "developmentNetUsdPer1000": scenario_metrics[scenario_name]["netUsdPer1000"],
            "holdoutNetUsdPer1000": holdout_scenario_metrics[scenario_name]["netUsdPer1000"],
            "maximumContinuousDrawdown": exact_decimal(drawdown, 8),
            "netUsdPer1000": exact_decimal(net),
        }
    all_capacity = combined_capacity_p05(
        (
            champion_scenarios["combinedStress"],
            holdout_scenarios["combinedStress"],
        )
    )
    total_round_trips = cast(int, stress_metrics["roundTrips"]) + cast(
        int,
        holdout_stress_metrics["roundTrips"],
    )
    total_fills = total_round_trips * 2
    total_samples = cast(int, stress_metrics["rawSignals"]) + cast(
        int,
        holdout_stress_metrics["rawSignals"],
    )

    result = {
        "authority": {
            "capitalAuthority": "NONE",
            "executionAuthority": "NONE",
            "publicResearchOnly": True,
        },
        "capitalVerdict": "NO_GO",
        "completedAtUtc": cast(str, marker["completedAtUtc"]),
        "development": development,
        "headline": {
            "baseNetUsdPer1000": stitched_scenarios["base"]["netUsdPer1000"],
            "capacityProxyP05Usd": (None if all_capacity is None else exact_decimal(all_capacity)),
            "combinedStressNetUsdPer1000": stitched_scenarios["combinedStress"]["netUsdPer1000"],
            "feeStressNetUsdPer1000": stitched_scenarios["feeStress"]["netUsdPer1000"],
            "fills": total_fills,
            "holdoutBootstrapIntervalUsdPer1000": {
                name: {
                    "lower": f"{interval[0]:.8f}",
                    "upper": f"{interval[1]:.8f}",
                }
                for name, interval in holdout_intervals.items()
            },
            "maximumDrawdown": stitched_scenarios["combinedStress"]["maximumContinuousDrawdown"],
            "pbo": pbo["pbo"],
            "roundTrips": total_round_trips,
            "samples": total_samples,
            "valueHorizon": "TWELVE_MONTH_PURGED_PARTITIONS_STITCHED",
        },
        "holdout": {
            "bootstrapIntervalsUsdPer1000": {
                name: {
                    "coverage": "95%",
                    "lower": f"{interval[0]:.8f}",
                    "upper": f"{interval[1]:.8f}",
                }
                for name, interval in holdout_intervals.items()
            },
            "gatePassed": holdout_passed,
            "gates": list(holdout_gate_rows),
            "interval": holdout_interval,
            "openCount": 1,
            "reason": None,
            "scenarioMetrics": holdout_scenario_metrics,
            "status": "MEASURED_SINGLE_OPEN",
        },
        "limitations": frozen_limitations(),
        "lineage": {
            "baseCommit": BASE_COMMIT,
            "freezeSha256": sha256_file(FREEZE_PATH),
            "preOutcomeCommit": preoutcome_commit,
            "selectionHash": selection_hash,
        },
        "measurementWindow": {
            "endUtcDateInclusive": "2026-06-30",
            "holdoutOpened": True,
            "startUtcDateInclusive": "2025-07-01",
        },
        "schema": "VG6ResultV1",
        "twelveMonth": {
            "capacityProxyP05Usd": (None if all_capacity is None else exact_decimal(all_capacity)),
            "fills": total_fills,
            "method": (
                "LINEARLY_SCALED_DEVELOPMENT_AND_SINGLE_OPEN_HOLDOUT_NAV_PATHS_"
                "STITCHED_AFTER_FROZEN_PURGE_AND_EMBARGO"
            ),
            "roundTrips": total_round_trips,
            "samples": total_samples,
            "scenarioMetrics": stitched_scenarios,
            "status": "MEASURED",
        },
        "verdict": verdict,
        "verdictReason": (
            "ALL_FROZEN_PUBLIC_RESEARCH_GATES_PASSED"
            if verdict == "GO"
            else "ONE_OR_MORE_FROZEN_HOLDOUT_GATES_FAILED"
        ),
    }
    return result, marker


def unmeasured_result(
    *,
    reason: str,
    preoutcome_commit: str,
    marker: JsonObject,
) -> JsonObject:
    return {
        "authority": {
            "capitalAuthority": "NONE",
            "executionAuthority": "NONE",
            "publicResearchOnly": True,
        },
        "capitalVerdict": "NO_GO",
        "completedAtUtc": cast(str, marker["completedAtUtc"]),
        "development": {
            "bootstrapIntervalsUsdPer1000": None,
            "championTrialId": None,
            "gatePassed": None,
            "gates": [],
            "holm": None,
            "interval": {
                "endUtcDateInclusive": "2026-02-28",
                "startUtcDateInclusive": "2025-07-01",
            },
            "pbo": None,
            "scenarioMetrics": None,
            "status": "UNMEASURED",
            "trialLedger": None,
        },
        "headline": {
            "baseNetUsdPer1000": None,
            "capacityProxyP05Usd": None,
            "combinedStressNetUsdPer1000": None,
            "feeStressNetUsdPer1000": None,
            "fills": None,
            "holdoutBootstrapIntervalUsdPer1000": None,
            "maximumDrawdown": None,
            "pbo": None,
            "roundTrips": None,
            "samples": None,
            "valueHorizon": "UNMEASURED",
        },
        "holdout": {
            "bootstrapIntervalsUsdPer1000": None,
            "gatePassed": None,
            "gates": [],
            "interval": {
                "embargoEndUtcDateInclusive": "2026-03-07",
                "endUtcDateInclusive": "2026-06-30",
                "startUtcDateInclusive": "2026-03-01",
            },
            "openCount": marker.get("holdoutOpenCount", 0),
            "reason": "MEASUREMENT_FAILED_AFTER_MARKER_CONSUMPTION",
            "scenarioMetrics": None,
            "status": "UNMEASURED",
        },
        "limitations": [reason, *frozen_limitations()],
        "lineage": {
            "baseCommit": BASE_COMMIT,
            "freezeSha256": sha256_file(FREEZE_PATH),
            "preOutcomeCommit": preoutcome_commit,
            "selectionHash": marker.get("selectionHash"),
        },
        "measurementWindow": {
            "endUtcDateInclusive": "2026-06-30",
            "holdoutOpened": cast(int, marker.get("holdoutOpenCount", 0)) == 1,
            "startUtcDateInclusive": "2025-07-01",
        },
        "schema": "VG6ResultV1",
        "twelveMonth": {
            "reason": reason,
            "scenarioMetrics": None,
            "status": "UNMEASURED",
        },
        "verdict": "UNMEASURED",
        "verdictReason": reason,
    }


def verdict_markdown(result: JsonObject) -> str:
    headline = cast(JsonObject, result["headline"])
    holdout = cast(JsonObject, result["holdout"])
    lines = [
        "# V-G6 sealed verdict",
        "",
        f"- Public research verdict: `{result['verdict']}`",
        f"- Capital verdict: `{result['capitalVerdict']}`",
        f"- Reason: `{result['verdictReason']}`",
        f"- Headline value horizon: `{headline.get('valueHorizon')}`",
        f"- Base net / $1,000: `{headline.get('baseNetUsdPer1000')}`",
        f"- Fee-stress net / $1,000: `{headline.get('feeStressNetUsdPer1000')}`",
        (f"- Combined-stress net / $1,000: `{headline.get('combinedStressNetUsdPer1000')}`"),
        f"- Samples / round trips / fills: `{headline.get('samples')}` / "
        f"`{headline.get('roundTrips')}` / `{headline.get('fills')}`",
        f"- Holdout status: `{holdout.get('status')}`",
        (
            "- Holdout 95% intervals / $1,000: "
            f"`{headline.get('holdoutBootstrapIntervalUsdPer1000')}`"
        ),
        f"- PBO diagnostic: `{headline.get('pbo')}`",
        f"- Maximum drawdown: `{headline.get('maximumDrawdown')}`",
        f"- Capacity proxy p05: `{headline.get('capacityProxyP05Usd')}`",
        "",
        "No provider, private API, account, order, transfer, withdrawal, host, UI, "
        "or money action occurred. Execution authority is `NONE`.",
        "",
        "## Limitations",
        "",
    ]
    lines.extend(f"- {item}" for item in cast(list[str], result["limitations"]))
    return "\n".join(lines) + "\n"


def write_text_once(path: Path, text: str) -> None:
    if path.exists():
        raise ContractError(f"refusing to overwrite {path.name}")
    with tempfile.NamedTemporaryFile(
        dir=path.parent,
        delete=False,
        mode="w",
        encoding="utf-8",
    ) as handle:
        temporary = Path(handle.name)
        handle.write(text)
        handle.flush()
    temporary.replace(path)


def ensure_json(path: Path, value: object) -> None:
    expected = canonical_bytes(value)
    if path.exists():
        if path.read_bytes() != expected:
            raise ContractError(f"existing {path.name} differs from durable result")
        return
    write_json_once(path, value)


def ensure_text(path: Path, text: str) -> None:
    if path.exists():
        if path.read_text(encoding="utf-8") != text:
            raise ContractError(f"existing {path.name} differs from durable result")
        return
    write_text_once(path, text)


def checksum_text() -> str:
    admitted = sorted(
        path
        for path in PACKET.iterdir()
        if path.is_file() and path != SHA256SUMS_PATH and path.name != ".DS_Store"
    )
    lines = [f"{sha256_file(path)}  {path.name}" for path in admitted]
    return "\n".join(lines) + "\n"


def finalize_result(result: JsonObject) -> None:
    ensure_json(RESULT_PATH, result)
    ensure_text(VERDICT_PATH, verdict_markdown(result))
    marker = load_json(MARKER_PATH)
    terminal_state = "TERMINAL_UNMEASURED" if result.get("verdict") == "UNMEASURED" else "TERMINAL"
    if marker.get("state") not in {"TERMINAL", "TERMINAL_UNMEASURED"}:
        marker = marker_update(
            marker,
            state=terminal_state,
            terminalizedAtUtc=marker.get("terminalizedAtUtc", utc_now()),
            verdict=result["verdict"],
        )
    if marker.get("state") != terminal_state or marker.get("verdict") != result.get("verdict"):
        raise ContractError("terminal marker is incompatible with durable result")
    ensure_text(SHA256SUMS_PATH, checksum_text())


def run_once() -> JsonObject:
    freeze, manifest, preoutcome_commit = verify_preoutcome_freeze()
    marker: JsonObject = {
        "baseCommit": BASE_COMMIT,
        "developmentOpenCount": 1,
        "freezeSha256": sha256_file(FREEZE_PATH),
        "holdoutOpenCount": 0,
        "preOutcomeCommit": preoutcome_commit,
        "schema": "VG6RunMarkerV1",
        "startedAtUtc": utc_now(),
        "state": "DEVELOPMENT_OPEN_CONSUMED",
    }
    write_json_once(MARKER_PATH, marker)
    try:
        result, marker = execute_measurement(
            freeze,
            manifest,
            preoutcome_commit,
            marker,
        )
    except Exception as exc:
        reason = (f"{type(exc).__name__}: {exc!s}")[:500]
        marker = marker_update(
            marker,
            completedAtUtc=utc_now(),
            failureReason=reason,
            state="MEASUREMENT_UNMEASURED_PENDING_SEAL",
            verdict="UNMEASURED",
        )
        result = unmeasured_result(
            reason=reason,
            preoutcome_commit=preoutcome_commit,
            marker=marker,
        )
    finalize_result(result)
    return result


def finalize_without_data() -> JsonObject:
    if not MARKER_PATH.is_file() or not FREEZE_PATH.is_file():
        raise ContractError("finalize requires a consumed marker and frozen packet")
    marker = load_json(MARKER_PATH)
    preoutcome_commit = marker.get("preOutcomeCommit")
    if not isinstance(preoutcome_commit, str):
        raise ContractError("marker lacks pre-outcome commit")
    if RESULT_PATH.is_file():
        result = load_json(RESULT_PATH)
    else:
        reason = cast(
            str,
            marker.get(
                "failureReason",
                "INTERRUPTED_AFTER_MARKER_CONSUMPTION_BEFORE_DURABLE_RESULT",
            ),
        )
        marker = marker_update(
            marker,
            completedAtUtc=marker.get("completedAtUtc", utc_now()),
            failureReason=reason,
            state="MEASUREMENT_UNMEASURED_PENDING_SEAL",
            verdict="UNMEASURED",
        )
        result = unmeasured_result(
            reason=reason,
            preoutcome_commit=preoutcome_commit,
            marker=marker,
        )
    finalize_result(result)
    return verify_terminal()


def verify_terminal() -> JsonObject:
    if not RESULT_PATH.is_file() or not MARKER_PATH.is_file():
        raise ContractError("terminal result and marker are required")
    result = load_json(RESULT_PATH)
    marker = load_json(MARKER_PATH)
    if result.get("schema") != "VG6ResultV1":
        raise ContractError("unexpected result schema")
    if marker.get("state") not in {"TERMINAL", "TERMINAL_UNMEASURED"}:
        raise ContractError("marker is not terminal")
    if marker.get("verdict") != result.get("verdict"):
        raise ContractError("marker/result verdict mismatch")
    if cast(int, marker.get("holdoutOpenCount", 0)) > 1:
        raise ContractError("holdout opened more than once")
    if result.get("capitalVerdict") != "NO_GO":
        raise ContractError("capital verdict must remain NO_GO")
    checksum_lines = SHA256SUMS_PATH.read_text(encoding="utf-8").splitlines()
    expected_names: set[str] = set()
    for line in checksum_lines:
        fields = line.split("  ", 1)
        if len(fields) != 2:
            raise ContractError("invalid SHA256SUMS grammar")
        expected, name = fields
        path = PACKET / name
        if not path.is_file() or sha256_file(path) != expected:
            raise ContractError(f"terminal checksum mismatch: {name}")
        expected_names.add(name)
    actual_names = {
        path.name
        for path in PACKET.iterdir()
        if path.is_file() and path != SHA256SUMS_PATH and path.name != ".DS_Store"
    }
    if expected_names != actual_names:
        raise ContractError("SHA256SUMS does not cover the terminal packet exactly")
    return {
        "holdoutOpenCount": marker.get("holdoutOpenCount"),
        "resultSha256": sha256_file(RESULT_PATH),
        "schema": "VG6VerificationV1",
        "verdict": result["verdict"],
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    inventory_parser = subparsers.add_parser(
        "inventory",
        help="freeze byte hashes without opening a ZIP member",
    )
    inventory_parser.add_argument("--source-root", required=True, type=Path)
    subparsers.add_parser("run", help="consume the sealed experiment exactly once")
    subparsers.add_parser(
        "finalize",
        help="data-free idempotent terminal recovery after marker consumption",
    )
    subparsers.add_parser("verify", help="verify a terminal packet without reopening data")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = build_parser().parse_args(argv)
    if arguments.command == "inventory":
        output = inventory(cast(Path, arguments.source_root))
    elif arguments.command == "run":
        output = run_once()
    elif arguments.command == "finalize":
        output = finalize_without_data()
    elif arguments.command == "verify":
        output = verify_terminal()
    else:
        raise ContractError("unknown command")
    print(json.dumps(output, sort_keys=True, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
