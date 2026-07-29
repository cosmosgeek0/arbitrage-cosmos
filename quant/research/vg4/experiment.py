#!/usr/bin/env python3
"""One-run public V-G4 volume-price divergence reversal experiment.

The evaluator deliberately has three phases:

* ``freeze`` hashes compressed public inputs without opening ZIP members;
* ``run`` consumes an exclusive marker, evaluates development, and opens the
  chronological holdout only if a sealed champion clears every development gate;
* ``verify`` authenticates the packet without rerunning the experiment.

No command reads credentials, private account state, order endpoints, or host state.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import math
import os
import re
import subprocess
import sys
import tempfile
import zipfile
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal, InvalidOperation, getcontext
from pathlib import Path
from typing import Any, cast

from quant_edge.labels.rational import ExactRatioV1, make_ratio
from quant_edge.lake.contracts import EvidencePosture, QualityState
from quant_edge.randomness import DeterministicRandom
from quant_edge.validation.bootstrap import (
    BootstrapSpecV1,
    BootstrapStatus,
    block_bootstrap_interval,
)
from quant_edge.validation.multiplicity import (
    PboStatus,
    TrialLedgerV1,
    TrialRecordV1,
    TrialStatus,
    distinct_trial_count,
    holm_bonferroni,
    pbo_cscv,
)
from quant_edge.validation.samples import SampleSetV1, ValidationSampleV1
from quant_edge.validation.splits import (
    HoldoutGrantV1,
    PlanStatus,
    SplitScheme,
    WalkForwardPlanV1,
    WalkForwardSpecV1,
    build_walk_forward_plan,
    open_holdout,
)

getcontext().prec = 50

HERE = Path(__file__).resolve().parent
QUANT_ROOT = HERE.parents[1]
REPO_ROOT = HERE.parents[2]
PROTOCOL_PATH = HERE / "protocol.v1.json"
SOURCE_RESEARCH_PATH = HERE / "OFFICIAL_SOURCE_RESEARCH.md"
SOURCE_MANIFEST_PATH = HERE / "source-manifest.v1.json"
FREEZE_PATH = HERE / "freeze.v1.json"
RUN_MARKER_PATH = HERE / "run-marker.v1.json"
CANDIDATE_SEAL_PATH = HERE / "candidate-seal.v1.json"
HOLDOUT_OPEN_PATH = HERE / "holdout-open.v1.json"
RESULT_PATH = HERE / "result.v1.json"
SHA256SUMS_PATH = HERE / "SHA256SUMS"

BASE_COMMIT = "a169b123fb186d1943a75ad648552c4d95be1be1"
SOURCE_ACQUISITION = Path(
    "/private/tmp/cosmos-s1f-weekly-momentum-cash-v1/acquisition-manifest.v1.json"
)
SOURCE_DISCOVERY = Path("/private/tmp/cosmos-s1f-weekly-momentum-cash-v1/discovery.v1.json")
SOURCE_ROOT = Path("/private/tmp/cosmos-s1f-weekly-momentum-cash-v1")

EVALUATION_START = date(2025, 7, 1)
DEVELOPMENT_END = date(2026, 3, 1)
EVALUATION_END = date(2026, 7, 1)
WARMUP_START = date(2025, 5, 1)
DEVELOPMENT_MONTHS = tuple(
    f"{year:04d}-{month:02d}"
    for year, start, end in ((2025, 7, 12), (2026, 1, 2))
    for month in range(start, end + 1)
)
HOLDOUT_MONTHS = ("2026-03", "2026-04", "2026-05", "2026-06")
SOURCE_MONTHS = ("2025-05", "2025-06", *DEVELOPMENT_MONTHS, *HOLDOUT_MONTHS)

USD_1000 = Decimal("1000")
PUBLIC_FEE = Decimal("0.0010")
BASE_ADVERSE = Decimal("0.0010")
STRESS_ADVERSE = Decimal("0.0025")
MIN_PRICE_RETURN = Decimal("-0.05")
MIN_CONFIRMATION_RETURN = Decimal("0.005")
RECENT_SHOCK_REJECT_RATIO = Decimal("1.50")
SIBLING_SHOCK_FLOOR = Decimal("2.00")
MIN_MEDIAN_DAILY_QUOTE_VOLUME = Decimal("10000000")
CAPACITY_PARTICIPATION = Decimal("0.0001")
CAPACITY_GATE_USD = Decimal("1000")
MAX_DRAWDOWN = Decimal("0.40")
BOOTSTRAP_SEED = 202_607_290_404
BOOTSTRAP_REPLICATES = 4_096
BOOTSTRAP_BLOCK_DAYS = 7
BOOTSTRAP_COVERAGE_PER_MYRIAD = 9_000
HOLM_ALPHA_PER_MYRIAD = 500
DAY_NS = 86_400 * 1_000_000_000

EXCLUDED_BASE_ASSETS = frozenset(
    {
        "AEUR",
        "BIDR",
        "BRL",
        "BUSD",
        "DAI",
        "EUR",
        "EURI",
        "FDUSD",
        "GBP",
        "IDRT",
        "NGN",
        "PAX",
        "RUB",
        "TUSD",
        "UAH",
        "USD1",
        "USDC",
        "USDP",
        "USDS",
        "VAI",
    }
)
EXCLUDED_LEVERAGED_SUFFIXES = ("BEAR", "BULL", "DOWN", "UP")
CHECKSUM_RE = re.compile(r"^([0-9a-f]{64})[ \t]+\*?([^\r\n]+)[\r\n]*$")


class VG4Error(RuntimeError):
    """A terminal protocol, source, or measurement failure."""


@dataclass(frozen=True, slots=True)
class Trial:
    trial_id: str
    lookback_days: int
    volume_ratio_cap: Decimal
    hold_days: int


@dataclass(frozen=True, slots=True)
class Bar:
    symbol: str
    day: date
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    quote_volume: Decimal
    open_time_us: int
    close_time_us: int


@dataclass(frozen=True, slots=True)
class Signal:
    symbol: str
    decision_day: date
    price_return: Decimal
    volume_ratio: Decimal
    confirmation_return: Decimal
    score: Decimal
    entry_capacity_proxy_usd: Decimal


@dataclass(frozen=True, slots=True)
class Trade:
    symbol: str
    decision_day: date
    entry_day: date
    exit_day: date
    entry_price: Decimal
    exit_price: Decimal
    entry_notional_usd: Decimal
    gross_pnl_usd: Decimal
    fee_cost_usd: Decimal
    base_adverse_cost_usd: Decimal
    base_net_pnl_usd: Decimal
    stress_net_pnl_usd: Decimal
    entry_capacity_proxy_usd: Decimal
    exit_capacity_proxy_usd: Decimal


@dataclass(frozen=True, slots=True)
class Simulation:
    trial_id: str
    days: tuple[date, ...]
    gross_daily_usd: tuple[Decimal, ...]
    base_daily_usd: tuple[Decimal, ...]
    stress_daily_usd: tuple[Decimal, ...]
    trades: tuple[Trade, ...]
    no_fill_count: int
    signal_count: int


@dataclass(slots=True)
class ScenarioState:
    cash: Decimal
    quantity: Decimal | None = None
    surplus: Decimal = Decimal("0")


@dataclass(frozen=True, slots=True)
class OpenPosition:
    signal: Signal
    entry_day: date
    exit_day: date
    entry_price: Decimal
    entry_cash: Mapping[str, Decimal]
    entry_notional: Mapping[str, Decimal]


def sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_bytes(value: object) -> bytes:
    return (
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n"
    ).encode()


def canonical_sha(value: object) -> str:
    return hashlib.sha256(canonical_bytes(value)).hexdigest()


def load_json(path: Path) -> dict[str, Any]:
    with path.open("rb") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise VG4Error(f"{path.name} must contain a JSON object")
    return cast(dict[str, Any], value)


def write_json_once(path: Path, value: object) -> None:
    payload = canonical_bytes(value)
    if path.exists():
        if path.read_bytes() != payload:
            raise VG4Error(f"refusing to replace non-identical {path.name}")
        return
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
    except BaseException:
        path.unlink(missing_ok=True)
        raise


def write_json_atomic(path: Path, value: object) -> None:
    payload = canonical_bytes(value)
    descriptor, raw_path = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    tmp = Path(raw_path)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


def utc_now() -> str:
    return datetime.now(tz=UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def decimal_text(value: Decimal, places: int = 8) -> str:
    quantum = Decimal(1).scaleb(-places)
    normalized = value.quantize(quantum)
    return format(normalized, "f")


def decimal_from_text(value: str, *, field: str, nonnegative: bool = False) -> Decimal:
    try:
        parsed = Decimal(value)
    except InvalidOperation as error:
        raise VG4Error(f"{field} is not a decimal") from error
    if not parsed.is_finite() or (nonnegative and parsed < 0):
        raise VG4Error(f"{field} is outside its declared decimal domain")
    return parsed


def median_decimal(values: Sequence[Decimal]) -> Decimal:
    if not values:
        raise VG4Error("median requires a non-empty sequence")
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) / 2


def date_range(start: date, end_exclusive: date) -> tuple[date, ...]:
    count = (end_exclusive - start).days
    if count < 0:
        raise VG4Error("date range is reversed")
    return tuple(start + timedelta(days=offset) for offset in range(count))


def month_of(day: date) -> str:
    return day.strftime("%Y-%m")


def day_ns(day: date) -> int:
    return int(datetime(day.year, day.month, day.day, tzinfo=UTC).timestamp()) * 1_000_000_000


def trial_grid() -> tuple[Trial, ...]:
    trials = []
    for lookback in (5, 10):
        for cap_text in ("0.65", "0.85"):
            for hold in (3, 5, 7):
                cap = Decimal(cap_text)
                trials.append(
                    Trial(
                        trial_id=f"vg4-l{lookback:02d}-v{int(cap * 100):03d}-h{hold:02d}",
                        lookback_days=lookback,
                        volume_ratio_cap=cap,
                        hold_days=hold,
                    )
                )
    return tuple(sorted(trials, key=lambda item: item.trial_id))


def eligible_symbol(symbol: str) -> bool:
    if not symbol.endswith("USDT") or len(symbol) <= 4:
        return False
    base = symbol[:-4]
    if base in EXCLUDED_BASE_ASSETS:
        return False
    return not base.endswith(EXCLUDED_LEVERAGED_SUFFIXES)


def expected_archive_paths(symbol: str, month: str) -> tuple[Path, Path, Path]:
    directory = SOURCE_ROOT / "archives" / symbol / month
    zip_path = directory / f"{symbol}-1d-{month}.zip"
    checksum_path = directory / f"{zip_path.name}.CHECKSUM"
    pair_path = directory / "pair.v1.json"
    return zip_path, checksum_path, pair_path


def verify_checksum_text(checksum_bytes: bytes, zip_name: str, zip_sha: str) -> None:
    try:
        text = checksum_bytes.decode("ascii")
    except UnicodeDecodeError as error:
        raise VG4Error(f"{zip_name} checksum is not ASCII") from error
    match = CHECKSUM_RE.fullmatch(text)
    if match is None:
        raise VG4Error(f"{zip_name} checksum has an invalid grammar")
    published_sha, published_name = match.groups()
    if published_name.strip() != zip_name:
        raise VG4Error(f"{zip_name} checksum names a different object")
    if published_sha != zip_sha:
        raise VG4Error(f"{zip_name} does not match its official checksum")


def source_artifact_row(pair: Mapping[str, Any]) -> dict[str, object]:
    symbol = str(pair["symbol"])
    month = str(pair["month"])
    zip_path, checksum_path, pair_path = expected_archive_paths(symbol, month)
    for path in (zip_path, checksum_path, pair_path):
        if not path.is_file():
            raise VG4Error(f"missing frozen source file: {path}")
    pair_bytes = pair_path.read_bytes()
    pair_local = json.loads(pair_bytes)
    if pair_local.get("symbol") != symbol or pair_local.get("month") != month:
        raise VG4Error(f"{pair_path} identity mismatch")

    zip_sha = sha256_path(zip_path)
    checksum_sha = sha256_path(checksum_path)
    pair_sha = hashlib.sha256(pair_bytes).hexdigest()
    if zip_sha != pair["zipSha256"] or zip_sha != pair_local.get("zipSha256"):
        raise VG4Error(f"{zip_path} SHA-256 drift")
    if checksum_sha != pair["checksumSha256"] or checksum_sha != pair_local.get("checksumSha256"):
        raise VG4Error(f"{checksum_path} SHA-256 drift")
    if zip_path.stat().st_size != int(pair["zipBytes"]):
        raise VG4Error(f"{zip_path} byte-length drift")
    if checksum_path.stat().st_size != int(pair["checksumBytes"]):
        raise VG4Error(f"{checksum_path} byte-length drift")
    verify_checksum_text(checksum_path.read_bytes(), zip_path.name, zip_sha)
    return {
        "checksumBytes": checksum_path.stat().st_size,
        "checksumEtag": pair["checksumFrozenEtag"],
        "checksumLastModified": pair["checksumFrozenLastModified"],
        "checksumPath": str(checksum_path.relative_to(SOURCE_ROOT)),
        "checksumSha256": checksum_sha,
        "month": month,
        "pairPath": str(pair_path.relative_to(SOURCE_ROOT)),
        "pairSha256": pair_sha,
        "symbol": symbol,
        "zipBytes": zip_path.stat().st_size,
        "zipEtag": pair["zipFrozenEtag"],
        "zipLastModified": pair["zipFrozenLastModified"],
        "zipPath": str(zip_path.relative_to(SOURCE_ROOT)),
        "zipSha256": zip_sha,
    }


def build_source_manifest() -> dict[str, object]:
    if sha256_path(SOURCE_ACQUISITION) != (
        "01f58272602e43bfb914b649adc00d8273b2d423492220a55f86443bb6441176"
    ):
        raise VG4Error("source acquisition manifest drifted")
    if sha256_path(SOURCE_DISCOVERY) != (
        "b4a8f7abd36df19eff0510dfcc3c61fd0df9fdcab5f4d248892ee10010fb21c3"
    ):
        raise VG4Error("source discovery manifest drifted")
    acquisition = load_json(SOURCE_ACQUISITION)
    if acquisition.get("state") != "CHECKSUM_VERIFIED_ARCHIVES_NOT_DECOMPRESSED":
        raise VG4Error("source acquisition state is inadmissible")
    raw_pairs = acquisition.get("artifactPairs")
    if not isinstance(raw_pairs, list):
        raise VG4Error("source acquisition artifactPairs is invalid")
    selected: list[dict[str, object]] = []
    for raw in raw_pairs:
        if not isinstance(raw, dict):
            raise VG4Error("source acquisition pair is invalid")
        symbol = str(raw.get("symbol"))
        month = str(raw.get("month"))
        if month in SOURCE_MONTHS and eligible_symbol(symbol):
            selected.append(source_artifact_row(cast(Mapping[str, Any], raw)))
    selected.sort(key=lambda item: (str(item["symbol"]), str(item["month"])))
    if not selected:
        raise VG4Error("source selection is empty")
    symbols = sorted({str(item["symbol"]) for item in selected})
    return {
        "acquisitionManifestPath": str(SOURCE_ACQUISITION),
        "acquisitionManifestSha256": sha256_path(SOURCE_ACQUISITION),
        "archiveBodiesDecompressedDuringFreeze": false_value(),
        "artifactCount": len(selected),
        "artifacts": selected,
        "discoveryManifestPath": str(SOURCE_DISCOVERY),
        "discoveryManifestSha256": sha256_path(SOURCE_DISCOVERY),
        "monthRange": list(SOURCE_MONTHS),
        "protocolSha256": sha256_path(PROTOCOL_PATH),
        "schema": "VG4FrozenPublicSourceManifestV1",
        "sourceRoot": str(SOURCE_ROOT),
        "state": "CHECKSUM_VERIFIED_COMPRESSED_BYTES_NOT_OPENED_BY_VG4",
        "symbolCount": len(symbols),
        "symbolSetSha256": canonical_sha(symbols),
    }


def false_value() -> bool:
    """Typed literal helper used to keep JSON truth claims obvious."""

    return False


def git_output(*args: str) -> str:
    completed = subprocess.run(
        ("git", *args),
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return completed.stdout.strip()


def freeze() -> None:
    if RUN_MARKER_PATH.exists() or RESULT_PATH.exists():
        raise VG4Error("freeze is forbidden after the one-run marker")
    if git_output("merge-base", "--is-ancestor", BASE_COMMIT, "HEAD") != "":
        raise VG4Error("unexpected merge-base output")
    protocol = load_json(PROTOCOL_PATH)
    if protocol.get("baseCommit") != BASE_COMMIT:
        raise VG4Error("protocol base commit mismatch")
    manifest = build_source_manifest()
    write_json_once(SOURCE_MANIFEST_PATH, manifest)
    evaluator_sha = sha256_path(Path(__file__))
    receipt = {
        "archiveBodiesDecompressed": False,
        "baseCommit": BASE_COMMIT,
        "createdAtUtc": utc_now(),
        "evaluatorPath": "quant/research/vg4/experiment.py",
        "evaluatorSha256": evaluator_sha,
        "officialSourceResearchSha256": sha256_path(SOURCE_RESEARCH_PATH),
        "protocolSha256": sha256_path(PROTOCOL_PATH),
        "schema": "VG4PreOutcomeFreezeV1",
        "sourceManifestSha256": sha256_path(SOURCE_MANIFEST_PATH),
        "state": "READY_FOR_SOLE_DECOMPRESSION_RUN",
        "trialGridSha256": canonical_sha([trial_mapping(item) for item in trial_grid()]),
    }
    write_json_once(FREEZE_PATH, receipt)
    write_sha256s()
    print(
        f"FROZEN artifacts={manifest['artifactCount']} symbols={manifest['symbolCount']} "
        f"source={receipt['sourceManifestSha256']}"
    )


def trial_mapping(trial: Trial) -> dict[str, object]:
    return {
        "holdDays": trial.hold_days,
        "lookbackDays": trial.lookback_days,
        "trialId": trial.trial_id,
        "volumeRatioCap": format(trial.volume_ratio_cap, "f"),
    }


def parse_timestamp_us(raw: str, *, field: str) -> tuple[int, datetime]:
    try:
        value = int(raw)
    except ValueError as error:
        raise VG4Error(f"{field} is not an integer timestamp") from error
    if value < 1_000_000_000_000_000:
        raise VG4Error(f"{field} is not a post-2025 microsecond timestamp")
    seconds, micros = divmod(value, 1_000_000)
    parsed = datetime.fromtimestamp(seconds, tz=UTC) + timedelta(microseconds=micros)
    return value, parsed


def parse_archive(artifact: Mapping[str, Any]) -> tuple[Bar, ...]:
    symbol = str(artifact["symbol"])
    month = str(artifact["month"])
    zip_path = SOURCE_ROOT / str(artifact["zipPath"])
    checksum_path = SOURCE_ROOT / str(artifact["checksumPath"])
    if sha256_path(zip_path) != artifact["zipSha256"]:
        raise VG4Error(f"{zip_path} changed after freeze")
    if sha256_path(checksum_path) != artifact["checksumSha256"]:
        raise VG4Error(f"{checksum_path} changed after freeze")
    verify_checksum_text(checksum_path.read_bytes(), zip_path.name, str(artifact["zipSha256"]))
    if zip_path.stat().st_size > 10_000_000:
        raise VG4Error(f"{zip_path} exceeds the frozen parser bound")

    with zipfile.ZipFile(zip_path) as archive:
        members = archive.infolist()
        if len(members) != 1 or members[0].is_dir():
            raise VG4Error(f"{zip_path} must contain exactly one regular member")
        member = members[0]
        expected_member = zip_path.name.removesuffix(".zip") + ".csv"
        if member.filename != expected_member or member.file_size > 20_000_000:
            raise VG4Error(f"{zip_path} member identity or size is invalid")
        with archive.open(member, "r") as raw:
            wrapper = io.TextIOWrapper(raw, encoding="ascii", newline="")
            reader = csv.reader(wrapper)
            bars: list[Bar] = []
            for row_number, row in enumerate(reader, start=1):
                if len(row) != 12:
                    raise VG4Error(f"{zip_path}:{row_number} does not have 12 kline fields")
                open_us, open_dt = parse_timestamp_us(row[0], field="openTime")
                close_us, _close_dt = parse_timestamp_us(row[6], field="closeTime")
                if open_dt.time() != datetime.min.time() or open_dt.tzinfo != UTC:
                    raise VG4Error(f"{zip_path}:{row_number} is not a UTC daily open")
                if not open_us <= close_us < open_us + 86_400_000_000:
                    raise VG4Error(f"{zip_path}:{row_number} close boundary is invalid")
                if open_dt.strftime("%Y-%m") != month:
                    raise VG4Error(f"{zip_path}:{row_number} lies outside its archive month")
                open_price = decimal_from_text(row[1], field="open", nonnegative=True)
                high = decimal_from_text(row[2], field="high", nonnegative=True)
                low = decimal_from_text(row[3], field="low", nonnegative=True)
                close = decimal_from_text(row[4], field="close", nonnegative=True)
                quote_volume = decimal_from_text(row[7], field="quoteVolume", nonnegative=True)
                if open_price <= 0 or close <= 0 or low <= 0:
                    raise VG4Error(f"{zip_path}:{row_number} has a non-positive price")
                if high < max(open_price, close, low) or low > min(open_price, close, high):
                    raise VG4Error(f"{zip_path}:{row_number} violates OHLC geometry")
                bars.append(
                    Bar(
                        symbol=symbol,
                        day=open_dt.date(),
                        open=open_price,
                        high=high,
                        low=low,
                        close=close,
                        quote_volume=quote_volume,
                        open_time_us=open_us,
                        close_time_us=close_us,
                    )
                )
    if not 1 <= len(bars) <= 31:
        raise VG4Error(f"{zip_path} daily row count is outside 1..31")
    if tuple(item.day for item in bars) != tuple(sorted({item.day for item in bars})):
        raise VG4Error(f"{zip_path} daily rows are duplicate or unsorted")
    return tuple(bars)


def load_bars(
    source_manifest: Mapping[str, Any],
    allowed_months: frozenset[str],
    existing: Mapping[str, Mapping[date, Bar]] | None = None,
) -> dict[str, dict[date, Bar]]:
    loaded = {
        symbol: dict(rows) for symbol, rows in (existing.items() if existing is not None else ())
    }
    raw_artifacts = source_manifest.get("artifacts")
    if not isinstance(raw_artifacts, list):
        raise VG4Error("source manifest artifacts is invalid")
    for raw in raw_artifacts:
        if not isinstance(raw, dict) or str(raw.get("month")) not in allowed_months:
            continue
        artifact = cast(Mapping[str, Any], raw)
        for bar in parse_archive(artifact):
            by_day = loaded.setdefault(bar.symbol, {})
            if bar.day in by_day:
                raise VG4Error(f"duplicate bar {bar.symbol} {bar.day.isoformat()}")
            by_day[bar.day] = bar
    return loaded


def build_validation_plan() -> tuple[SampleSetV1, WalkForwardPlanV1]:
    samples = tuple(
        ValidationSampleV1(
            sample_id=f"vg4-day-{day.isoformat()}",
            symbol="VG4_USDT_UNIVERSE",
            group_id=f"utc-{day.isoformat()}",
            cutoff_ns=day_ns(day),
            label_end_ns=day_ns(day) + 7 * DAY_NS,
            strata=(("calendarMonth", month_of(day)),),
            binary_outcome=None,
            gross_edge_ratio=None,
            base_cost_ratio=None,
            quality=QualityState.COMPLETE,
        )
        for day in date_range(EVALUATION_START, EVALUATION_END)
    )
    sample_set = SampleSetV1(
        dataset_id="vg4-public-daily-2025-07-01--2026-06-30",
        posture=EvidencePosture.REPLAY,
        samples=samples,
    )
    spec = WalkForwardSpecV1(
        scheme=SplitScheme.EXPANDING,
        fold_count=4,
        max_label_horizon_ns=7 * DAY_NS,
        max_feature_lookback_ns=30 * DAY_NS,
        embargo_ns=37 * DAY_NS,
        min_train_size=1,
        holdout_fraction=make_ratio(122, 365),
        rolling_train_size=None,
    )
    plan = build_walk_forward_plan(sample_set, spec)
    if plan.status is not PlanStatus.VALID:
        raise VG4Error("canonical Q14 walk-forward plan is invalid")
    holdout_days = tuple(
        sample_set.by_id(sample_id).cutoff_ns for sample_id in plan.holdout_sample_ids
    )
    expected_holdout = tuple(day_ns(day) for day in date_range(DEVELOPMENT_END, EVALUATION_END))
    if holdout_days != expected_holdout:
        raise VG4Error("canonical Q14 holdout is not the declared final 122 days")
    fold_holdout_overlap = {
        sample_id
        for fold in plan.folds
        for sample_id in fold.train_sample_ids + fold.validation_sample_ids
    } & set(plan.holdout_sample_ids)
    if fold_holdout_overlap:
        raise VG4Error("canonical Q14 folds touch the holdout")
    return sample_set, plan


def sample_day(sample_id: str) -> date:
    prefix = "vg4-day-"
    if not sample_id.startswith(prefix):
        raise VG4Error(f"unexpected sample id: {sample_id}")
    return date.fromisoformat(sample_id.removeprefix(prefix))


def validation_segments(plan: WalkForwardPlanV1) -> tuple[tuple[date, date], ...]:
    segments: list[tuple[date, date]] = []
    for fold in plan.folds:
        days = tuple(sample_day(sample_id) for sample_id in fold.validation_sample_ids)
        if not days:
            raise VG4Error(f"{fold.fold_id} has no validation days")
        expected = date_range(days[0], days[-1] + timedelta(days=1))
        if days != expected:
            raise VG4Error(f"{fold.fold_id} validation days are not consecutive")
        segments.append((days[0], days[-1] + timedelta(days=1)))
    return tuple(segments)


def calendar_month_segments(months: Sequence[str]) -> tuple[tuple[date, date], ...]:
    segments: list[tuple[date, date]] = []
    for month in months:
        start = date.fromisoformat(f"{month}-01")
        if start.month == 12:
            end = date(start.year + 1, 1, 1)
        else:
            end = date(start.year, start.month + 1, 1)
        segments.append((start, end))
    return tuple(segments)


def consecutive_symbol_bars(
    symbol_bars: Mapping[date, Bar], end_inclusive: date, count: int
) -> tuple[Bar, ...] | None:
    days = tuple(end_inclusive - timedelta(days=offset) for offset in range(count - 1, -1, -1))
    if any(day not in symbol_bars for day in days):
        return None
    return tuple(symbol_bars[day] for day in days)


def detect_signal(
    symbol: str,
    symbol_bars: Mapping[date, Bar],
    decision_day: date,
    trial: Trial,
) -> Signal | None:
    history = consecutive_symbol_bars(symbol_bars, decision_day, 31)
    if history is None:
        return None
    by_day = {bar.day: bar for bar in history}
    confirmation = by_day[decision_day]
    pivot_day = decision_day - timedelta(days=1)
    pivot = by_day[pivot_day]

    trailing_liquidity = median_decimal(tuple(bar.quote_volume for bar in history[:-1]))
    if trailing_liquidity < MIN_MEDIAN_DAILY_QUOTE_VOLUME:
        return None

    anchor_day = pivot_day - timedelta(days=trial.lookback_days)
    anchor = by_day[anchor_day]
    prior_days = tuple(
        pivot_day - timedelta(days=offset) for offset in range(trial.lookback_days, 0, -1)
    )
    prior_closes = tuple(by_day[day].close for day in prior_days)
    if pivot.close > min(prior_closes):
        return None
    price_return = pivot.close / anchor.close - 1
    if price_return > MIN_PRICE_RETURN:
        return None

    recent_days = tuple(pivot_day - timedelta(days=offset) for offset in (2, 1, 0))
    baseline_days = tuple(
        pivot_day - timedelta(days=offset) for offset in range(trial.lookback_days, 2, -1)
    )
    recent_volumes = tuple(by_day[day].quote_volume for day in recent_days)
    baseline_volumes = tuple(by_day[day].quote_volume for day in baseline_days)
    baseline = median_decimal(baseline_volumes)
    if baseline <= 0:
        return None
    volume_ratio = median_decimal(recent_volumes) / baseline
    if volume_ratio > trial.volume_ratio_cap:
        return None
    if max(recent_volumes) / baseline >= RECENT_SHOCK_REJECT_RATIO:
        return None
    if not RECENT_SHOCK_REJECT_RATIO < SIBLING_SHOCK_FLOOR:
        raise VG4Error("signal is not semantically disjoint from the sibling shock floor")

    confirmation_return = confirmation.close / pivot.close - 1
    if confirmation_return < MIN_CONFIRMATION_RETURN or confirmation.close <= confirmation.open:
        return None

    capacity_history = consecutive_symbol_bars(symbol_bars, decision_day, 7)
    if capacity_history is None:
        return None
    capacity_reference = min(
        confirmation.quote_volume,
        median_decimal(tuple(bar.quote_volume for bar in capacity_history)),
    )
    entry_capacity = capacity_reference * CAPACITY_PARTICIPATION
    if entry_capacity < CAPACITY_GATE_USD:
        return None
    score = (-price_return) * (Decimal(1) - volume_ratio) * confirmation_return
    return Signal(
        symbol=symbol,
        decision_day=decision_day,
        price_return=price_return,
        volume_ratio=volume_ratio,
        confirmation_return=confirmation_return,
        score=score,
        entry_capacity_proxy_usd=entry_capacity,
    )


def mark_value(
    state: ScenarioState, close_price: Decimal, *, fee: Decimal, adverse: Decimal
) -> Decimal:
    if state.quantity is None:
        return state.cash
    return state.surplus + state.quantity * close_price * (Decimal(1) - adverse) * (
        Decimal(1) - fee
    )


def enter_scenario(
    state: ScenarioState, price: Decimal, *, fee: Decimal, adverse: Decimal
) -> tuple[Decimal, Decimal]:
    if state.quantity is not None:
        raise VG4Error("scenario tried to enter while already long")
    notional = min(state.cash, USD_1000)
    if notional <= 0:
        raise VG4Error("scenario has no positive cash")
    state.surplus = state.cash - notional
    pre_fee_quantity = notional / (price * (Decimal(1) + adverse))
    state.quantity = pre_fee_quantity * (Decimal(1) - fee)
    state.cash = state.surplus
    return notional, pre_fee_quantity


def exit_scenario(
    state: ScenarioState, price: Decimal, *, fee: Decimal, adverse: Decimal
) -> Decimal:
    if state.quantity is None:
        raise VG4Error("scenario tried to exit while flat")
    proceeds = state.quantity * price * (Decimal(1) - adverse) * (Decimal(1) - fee)
    state.cash = state.surplus + proceeds
    state.quantity = None
    state.surplus = Decimal(0)
    return state.cash


def capacity_proxy(symbol_bars: Mapping[date, Bar], prior_complete_day: date) -> Decimal:
    history = consecutive_symbol_bars(symbol_bars, prior_complete_day, 7)
    if history is None:
        return Decimal(0)
    reference = min(
        symbol_bars[prior_complete_day].quote_volume,
        median_decimal(tuple(bar.quote_volume for bar in history)),
    )
    return reference * CAPACITY_PARTICIPATION


def attribution(
    notional: Decimal, entry_price: Decimal, exit_price: Decimal
) -> tuple[Decimal, Decimal, Decimal, Decimal, Decimal]:
    gross_out = notional / entry_price * exit_price
    fee_only_out = (
        notional / entry_price * (Decimal(1) - PUBLIC_FEE) * exit_price * (Decimal(1) - PUBLIC_FEE)
    )
    base_out = (
        notional
        / (entry_price * (Decimal(1) + BASE_ADVERSE))
        * (Decimal(1) - PUBLIC_FEE)
        * exit_price
        * (Decimal(1) - BASE_ADVERSE)
        * (Decimal(1) - PUBLIC_FEE)
    )
    stress_out = (
        notional
        / (entry_price * (Decimal(1) + STRESS_ADVERSE))
        * (Decimal(1) - PUBLIC_FEE)
        * exit_price
        * (Decimal(1) - STRESS_ADVERSE)
        * (Decimal(1) - PUBLIC_FEE)
    )
    return (
        gross_out - notional,
        gross_out - fee_only_out,
        fee_only_out - base_out,
        base_out - notional,
        stress_out - notional,
    )


def simulate_segment(
    bars: Mapping[str, Mapping[date, Bar]],
    trial: Trial,
    start: date,
    end_exclusive: date,
) -> Simulation:
    days = date_range(start, end_exclusive)
    states = {
        "gross": ScenarioState(USD_1000),
        "base": ScenarioState(USD_1000),
        "stress": ScenarioState(USD_1000),
    }
    scenario_costs = {
        "gross": (Decimal(0), Decimal(0)),
        "base": (PUBLIC_FEE, BASE_ADVERSE),
        "stress": (PUBLIC_FEE, STRESS_ADVERSE),
    }
    previous_values = dict.fromkeys(states, USD_1000)
    daily: dict[str, list[Decimal]] = {name: [] for name in states}
    pending: Signal | None = None
    position: OpenPosition | None = None
    trades: list[Trade] = []
    signal_count = 0
    no_fill_count = 0

    for current_day in days:
        if position is not None and current_day == position.exit_day:
            symbol_bars = bars[position.signal.symbol]
            exit_bar = symbol_bars.get(current_day)
            if exit_bar is None:
                raise VG4Error(
                    f"OPEN_POSITION_EXIT_BAR_MISSING:{position.signal.symbol}:{current_day}"
                )
            exit_cash: dict[str, Decimal] = {}
            for name, state in states.items():
                fee, adverse = scenario_costs[name]
                exit_cash[name] = exit_scenario(state, exit_bar.open, fee=fee, adverse=adverse)
            exit_capacity = capacity_proxy(symbol_bars, current_day - timedelta(days=1))
            gross_pnl, fee_cost, base_adverse_cost, base_pnl, stress_pnl = attribution(
                position.entry_notional["base"],
                position.entry_price,
                exit_bar.open,
            )
            trades.append(
                Trade(
                    symbol=position.signal.symbol,
                    decision_day=position.signal.decision_day,
                    entry_day=position.entry_day,
                    exit_day=position.exit_day,
                    entry_price=position.entry_price,
                    exit_price=exit_bar.open,
                    entry_notional_usd=position.entry_notional["base"],
                    gross_pnl_usd=gross_pnl,
                    fee_cost_usd=fee_cost,
                    base_adverse_cost_usd=base_adverse_cost,
                    base_net_pnl_usd=base_pnl,
                    stress_net_pnl_usd=stress_pnl,
                    entry_capacity_proxy_usd=position.signal.entry_capacity_proxy_usd,
                    exit_capacity_proxy_usd=exit_capacity,
                )
            )
            position = None

        if pending is not None and current_day == pending.decision_day + timedelta(days=1):
            entry_bar = bars[pending.symbol].get(current_day)
            if entry_bar is None:
                no_fill_count += 1
            else:
                exit_day = current_day + timedelta(days=trial.hold_days)
                if exit_day >= end_exclusive:
                    no_fill_count += 1
                else:
                    entry_cash = {name: state.cash for name, state in states.items()}
                    entry_notional: dict[str, Decimal] = {}
                    for name, state in states.items():
                        fee, adverse = scenario_costs[name]
                        notional, _ = enter_scenario(
                            state, entry_bar.open, fee=fee, adverse=adverse
                        )
                        entry_notional[name] = notional
                    position = OpenPosition(
                        signal=pending,
                        entry_day=current_day,
                        exit_day=exit_day,
                        entry_price=entry_bar.open,
                        entry_cash=entry_cash,
                        entry_notional=entry_notional,
                    )
            pending = None

        if position is not None:
            mark_bar = bars[position.signal.symbol].get(current_day)
            if mark_bar is None:
                raise VG4Error(
                    f"OPEN_POSITION_MARK_BAR_MISSING:{position.signal.symbol}:{current_day}"
                )
            values = {
                name: mark_value(state, mark_bar.close, fee=fee, adverse=adverse)
                for name, state in states.items()
                for fee, adverse in (scenario_costs[name],)
            }
        else:
            values = {name: state.cash for name, state in states.items()}

        for name, value in values.items():
            daily[name].append(value - previous_values[name])
            previous_values[name] = value

        if position is None and pending is None:
            latest_entry = current_day + timedelta(days=1)
            latest_exit = latest_entry + timedelta(days=trial.hold_days)
            if latest_exit < end_exclusive:
                signals = tuple(
                    signal
                    for symbol, symbol_bars in bars.items()
                    for signal in (detect_signal(symbol, symbol_bars, current_day, trial),)
                    if signal is not None
                )
                if signals:
                    signal_count += len(signals)
                    pending = sorted(signals, key=lambda item: (-item.score, item.symbol))[0]

    if position is not None:
        raise VG4Error("segment ended with an open position")
    return Simulation(
        trial_id=trial.trial_id,
        days=days,
        gross_daily_usd=tuple(daily["gross"]),
        base_daily_usd=tuple(daily["base"]),
        stress_daily_usd=tuple(daily["stress"]),
        trades=tuple(trades),
        no_fill_count=no_fill_count,
        signal_count=signal_count,
    )


def combine_simulations(trial: Trial, simulations: Sequence[Simulation]) -> Simulation:
    return Simulation(
        trial_id=trial.trial_id,
        days=tuple(day for item in simulations for day in item.days),
        gross_daily_usd=tuple(value for item in simulations for value in item.gross_daily_usd),
        base_daily_usd=tuple(value for item in simulations for value in item.base_daily_usd),
        stress_daily_usd=tuple(value for item in simulations for value in item.stress_daily_usd),
        trades=tuple(trade for item in simulations for trade in item.trades),
        no_fill_count=sum(item.no_fill_count for item in simulations),
        signal_count=sum(item.signal_count for item in simulations),
    )


def simulate_segments(
    bars: Mapping[str, Mapping[date, Bar]],
    trial: Trial,
    segments: Sequence[tuple[date, date]],
) -> Simulation:
    return combine_simulations(
        trial,
        tuple(simulate_segment(bars, trial, start, end) for start, end in segments),
    )


def decimal_ratio(value: Decimal) -> ExactRatioV1:
    numerator, denominator = value.as_integer_ratio()
    return make_ratio(numerator, denominator)


def mean_decimal(values: Sequence[Decimal]) -> Decimal:
    if not values:
        raise VG4Error("mean requires values")
    return sum(values, Decimal(0)) / len(values)


def fixed_point_decimal(mantissa: int) -> Decimal:
    return Decimal(mantissa) / Decimal(10**12)


def bootstrap_interval_mapping(values: Sequence[Decimal], seed: int) -> dict[str, object]:
    report = block_bootstrap_interval(
        tuple(decimal_ratio(value) for value in values),
        BootstrapSpecV1(
            seed=seed,
            block_length=BOOTSTRAP_BLOCK_DAYS,
            replicates=BOOTSTRAP_REPLICATES,
            coverage_per_myriad=BOOTSTRAP_COVERAGE_PER_MYRIAD,
        ),
    )
    mapping = report.as_mapping()
    mapping["interpretation"] = (
        "90_PERCENT_TWO_SIDED_PERCENTILE_INTERVAL; LOWER_IS_ONE_SIDED_95_PERCENT_LCB"
    )
    return mapping


def interval_lower(mapping: Mapping[str, Any]) -> Decimal | None:
    if mapping.get("status") != BootstrapStatus.AVAILABLE.value:
        return None
    lower = mapping.get("lower")
    if not isinstance(lower, dict):
        return None
    return Decimal(str(lower["mantissa"])) / Decimal(str(lower["scale"]))


def family_bootstrap_p_values(
    rows: Sequence[Sequence[Decimal]],
    *,
    seed: int = BOOTSTRAP_SEED,
    block_length: int = BOOTSTRAP_BLOCK_DAYS,
    replicates: int = BOOTSTRAP_REPLICATES,
) -> tuple[ExactRatioV1, ...]:
    if not rows:
        raise VG4Error("bootstrap family is empty")
    count = len(rows[0])
    if count < block_length:
        raise VG4Error("bootstrap family is shorter than its block")
    if any(len(row) != count for row in rows):
        raise VG4Error("bootstrap family paths are not aligned")
    observed = tuple(mean_decimal(row) for row in rows)
    centered = tuple(
        tuple(value - observed[index] for value in row) for index, row in enumerate(rows)
    )
    exceedances = [0 for _ in rows]
    blocks_needed = math.ceil(count / block_length)
    rng = DeterministicRandom.from_seed(seed)
    for _ in range(replicates):
        indices: list[int] = []
        for _ in range(blocks_needed):
            start = rng.next_u64() % count
            indices.extend((start + offset) % count for offset in range(block_length))
        indices = indices[:count]
        for row_index, row in enumerate(centered):
            replicate_mean = sum((row[index] for index in indices), Decimal(0)) / count
            if replicate_mean >= observed[row_index]:
                exceedances[row_index] += 1
    return tuple(make_ratio(exceedance + 1, replicates + 1) for exceedance in exceedances)


def maximum_drawdown(daily_values: Sequence[Decimal]) -> Decimal:
    equity = USD_1000
    peak = equity
    maximum = Decimal(0)
    for pnl in daily_values:
        equity += pnl
        if equity > peak:
            peak = equity
        if peak > 0:
            maximum = max(maximum, (peak - equity) / peak)
    return maximum


def concentration(values: Iterable[str]) -> Decimal | None:
    counts: dict[str, int] = {}
    total = 0
    for value in values:
        counts[value] = counts.get(value, 0) + 1
        total += 1
    if not counts:
        return None
    return Decimal(max(counts.values())) / total


def simulation_metrics(simulation: Simulation) -> dict[str, object]:
    closed = len(simulation.trades)
    symbols = sorted({trade.symbol for trade in simulation.trades})
    active_months = sorted({month_of(trade.exit_day) for trade in simulation.trades})
    capacity_values = tuple(
        value
        for trade in simulation.trades
        for value in (trade.entry_capacity_proxy_usd, trade.exit_capacity_proxy_usd)
    )
    interval = bootstrap_interval_mapping(
        simulation.base_daily_usd,
        BOOTSTRAP_SEED,
    )
    lower = interval_lower(interval)
    return {
        "activeCalendarMonthCount": len(active_months),
        "activeCalendarMonths": active_months,
        "baseNetMeanUsdPerDayPer1000": decimal_text(mean_decimal(simulation.base_daily_usd)),
        "baseNetOneSided95LcbUsdPerDayPer1000": (None if lower is None else decimal_text(lower)),
        "baseNetTotalUsdPer1000": decimal_text(sum(simulation.base_daily_usd, Decimal(0))),
        "bootstrap": interval,
        "closedTradeCount": closed,
        "distinctSymbolCount": len(symbols),
        "feeCostUsd": decimal_text(
            sum((trade.fee_cost_usd for trade in simulation.trades), Decimal(0))
        ),
        "grossTotalUsdPer1000": decimal_text(
            sum((trade.gross_pnl_usd for trade in simulation.trades), Decimal(0))
        ),
        "maximumDrawdownFraction": decimal_text(maximum_drawdown(simulation.base_daily_usd)),
        "maximumMonthFillConcentration": (
            None
            if (month_share := concentration(month_of(item.exit_day) for item in simulation.trades))
            is None
            else decimal_text(month_share)
        ),
        "maximumSymbolFillConcentration": (
            None
            if (symbol_share := concentration(item.symbol for item in simulation.trades)) is None
            else decimal_text(symbol_share)
        ),
        "minimumPublicCapacityProxyUsd": (
            None if not capacity_values else decimal_text(min(capacity_values))
        ),
        "noFillCount": simulation.no_fill_count,
        "observationDayCount": len(simulation.days),
        "signalCandidateCount": simulation.signal_count,
        "stressNetMeanUsdPerDayPer1000": decimal_text(mean_decimal(simulation.stress_daily_usd)),
        "stressNetTotalUsdPer1000": decimal_text(sum(simulation.stress_daily_usd, Decimal(0))),
        "symbolSetSha256": canonical_sha(symbols),
        "baseAdversePriceCostUsd": decimal_text(
            sum(
                (trade.base_adverse_cost_usd for trade in simulation.trades),
                Decimal(0),
            )
        ),
        "turnoverMultipleOf1000": decimal_text(
            sum((trade.entry_notional_usd * 2 for trade in simulation.trades), Decimal(0))
            / USD_1000
        ),
    }


def development_gate_reasons(
    metrics: Mapping[str, Any],
    *,
    holm_selected: bool,
    pbo_available: bool,
    pbo_value: Decimal | None,
) -> tuple[str, ...]:
    reasons: list[str] = []
    if int(metrics["closedTradeCount"]) < 40:
        reasons.append("DEVELOPMENT_CLOSED_TRADES_BELOW_40")
    if int(metrics["distinctSymbolCount"]) < 12:
        reasons.append("DEVELOPMENT_DISTINCT_SYMBOLS_BELOW_12")
    if int(metrics["activeCalendarMonthCount"]) < 6:
        reasons.append("DEVELOPMENT_ACTIVE_MONTHS_BELOW_6")
    lower_raw = metrics["baseNetOneSided95LcbUsdPerDayPer1000"]
    if lower_raw is None or Decimal(str(lower_raw)) <= 0:
        reasons.append("DEVELOPMENT_BASE_NET_LCB_NOT_POSITIVE")
    if Decimal(str(metrics["stressNetMeanUsdPerDayPer1000"])) <= 0:
        reasons.append("DEVELOPMENT_STRESS_NET_MEAN_NOT_POSITIVE")
    if Decimal(str(metrics["maximumDrawdownFraction"])) > MAX_DRAWDOWN:
        reasons.append("DEVELOPMENT_DRAWDOWN_ABOVE_40_PERCENT")
    capacity_raw = metrics["minimumPublicCapacityProxyUsd"]
    if capacity_raw is None or Decimal(str(capacity_raw)) < CAPACITY_GATE_USD:
        reasons.append("DEVELOPMENT_PUBLIC_CAPACITY_PROXY_BELOW_1000")
    if not holm_selected:
        reasons.append("DEVELOPMENT_HOLM_FAMILYWISE_GATE_FAILED")
    if not pbo_available:
        reasons.append("DEVELOPMENT_PBO_UNMEASURED")
    elif pbo_value is None or pbo_value > Decimal("0.50"):
        reasons.append("DEVELOPMENT_PBO_ABOVE_0_50")
    return tuple(reasons)


def holdout_gate_reasons(metrics: Mapping[str, Any]) -> tuple[str, ...]:
    reasons: list[str] = []
    if int(metrics["closedTradeCount"]) < 20:
        reasons.append("HOLDOUT_CLOSED_TRADES_BELOW_20")
    if int(metrics["distinctSymbolCount"]) < 8:
        reasons.append("HOLDOUT_DISTINCT_SYMBOLS_BELOW_8")
    if int(metrics["activeCalendarMonthCount"]) < 3:
        reasons.append("HOLDOUT_ACTIVE_MONTHS_BELOW_3")
    lower_raw = metrics["baseNetOneSided95LcbUsdPerDayPer1000"]
    if lower_raw is None or Decimal(str(lower_raw)) <= 0:
        reasons.append("HOLDOUT_BASE_NET_LCB_NOT_POSITIVE")
    if Decimal(str(metrics["stressNetMeanUsdPerDayPer1000"])) <= 0:
        reasons.append("HOLDOUT_STRESS_NET_MEAN_NOT_POSITIVE")
    if Decimal(str(metrics["maximumDrawdownFraction"])) > MAX_DRAWDOWN:
        reasons.append("HOLDOUT_DRAWDOWN_ABOVE_40_PERCENT")
    capacity_raw = metrics["minimumPublicCapacityProxyUsd"]
    if capacity_raw is None or Decimal(str(capacity_raw)) < CAPACITY_GATE_USD:
        reasons.append("HOLDOUT_PUBLIC_CAPACITY_PROXY_BELOW_1000")
    return tuple(reasons)


def trial_ledger() -> TrialLedgerV1:
    return TrialLedgerV1(
        trials=tuple(
            TrialRecordV1(
                trial_id=trial.trial_id,
                family_id="vg4-volume-price-divergence-reversal-v1",
                model_id=trial.trial_id,
                metric_id="base-net-usd-per-1000-per-day",
                status=TrialStatus.COMPLETED,
                note="predeclared daily false-breakdown candidate",
            )
            for trial in trial_grid()
        )
    )


def pbo_report(
    bars: Mapping[str, Mapping[date, Bar]],
    trials: Sequence[Trial],
) -> tuple[dict[str, object], int]:
    month_segments = calendar_month_segments(DEVELOPMENT_MONTHS)
    block_rows: list[tuple[ExactRatioV1, ...]] = []
    for trial in trials:
        scores = []
        for segment in month_segments:
            simulation = simulate_segment(bars, trial, *segment)
            scores.append(decimal_ratio(mean_decimal(simulation.base_daily_usd)))
        block_rows.append(tuple(scores))
    matrix = tuple(block_rows)
    distinct = distinct_trial_count(matrix)
    report = pbo_cscv(matrix)
    mapping = report.as_mapping()
    mapping["role"] = "DEVELOPMENT_ONLY_NONCAUSAL_SELECTION_DIAGNOSTIC_AND_FROZEN_CONSERVATIVE_GATE"
    mapping["holdoutTouched"] = False
    return mapping, distinct


def pbo_decimal(mapping: Mapping[str, Any]) -> Decimal | None:
    if mapping.get("status") != PboStatus.AVAILABLE.value:
        return None
    raw = mapping.get("pbo")
    if not isinstance(raw, dict):
        return None
    return Decimal(str(raw["mantissa"])) / Decimal(str(raw["scale"]))


def compact_plan_mapping(plan: WalkForwardPlanV1) -> dict[str, object]:
    return {
        "datasetDigest": plan.dataset_digest.hexdigest,
        "folds": [
            {
                "embargoedCount": fold.embargoed_count,
                "foldId": fold.fold_id,
                "purgedCount": fold.purged_count,
                "status": fold.status.value,
                "trainCount": len(fold.train_sample_ids),
                "validationCount": len(fold.validation_sample_ids),
                "validationEndExclusiveUtc": (
                    sample_day(fold.validation_sample_ids[-1]) + timedelta(days=1)
                ).isoformat(),
                "validationStartUtc": sample_day(fold.validation_sample_ids[0]).isoformat(),
            }
            for fold in plan.folds
        ],
        "holdoutCount": len(plan.holdout_sample_ids),
        "holdoutEndExclusiveUtc": EVALUATION_END.isoformat(),
        "holdoutStartUtc": DEVELOPMENT_END.isoformat(),
        "planDigest": plan.digest().hexdigest,
        "quarantinedCount": len(plan.quarantined_sample_ids),
        "spec": plan.spec.as_mapping(),
        "status": plan.status.value,
    }


def base_result_envelope(
    *,
    marker_sha: str,
    plan: WalkForwardPlanV1,
    source_manifest: Mapping[str, Any],
) -> dict[str, object]:
    return {
        "baseCommit": BASE_COMMIT,
        "consumer": "N3",
        "costTruth": {
            "accountEffectiveFees": "UNKNOWN",
            "adverseExecution": "FROZEN_MODEL_NOT_OBSERVED_EXECUTION",
            "publicRegularTakerFeeBpsPerLeg": 10,
        },
        "createdAtUtc": utc_now(),
        "freezeSha256": sha256_path(FREEZE_PATH),
        "holdoutReuseCount": 0,
        "officialSourceResearchSha256": sha256_path(SOURCE_RESEARCH_PATH),
        "protocolSha256": sha256_path(PROTOCOL_PATH),
        "publicSource": {
            "artifactCount": source_manifest["artifactCount"],
            "checksumState": "ALL_SELECTED_COMPRESSED_BYTES_AND_OFFICIAL_SIDECARS_VERIFIED",
            "sourceManifestSha256": sha256_path(SOURCE_MANIFEST_PATH),
            "symbolCount": source_manifest["symbolCount"],
        },
        "q14WalkForward": compact_plan_mapping(plan),
        "runMarkerSha256": marker_sha,
        "schema": "VG4VolumePriceDivergenceReversalResultV1",
        "strategyIdentity": {
            "name": "BULLISH_FALSE_BREAKDOWN_WITH_VOLUME_NONCONFIRMATION",
            "siblingVolumeShockFloor": "2.00",
            "vg4RecentMaximumVolumeRatio": "BELOW_1.50",
            "volumeShockSemanticallyAdmissible": False,
        },
        "truthBoundary": {
            "capitalAuthority": "NONE",
            "historicalExecutableBookCapacity": "UNMEASURED",
            "orderEffects": "NONE",
            "privateDataUsed": False,
            "publicCapacity": "OHLCV_PARTICIPATION_PROXY_ONLY",
        },
    }


def validate_frozen_identity() -> tuple[dict[str, Any], dict[str, Any]]:
    if not FREEZE_PATH.is_file() or not SOURCE_MANIFEST_PATH.is_file():
        raise VG4Error("freeze and source manifest are required")
    freeze_receipt = load_json(FREEZE_PATH)
    if freeze_receipt.get("state") != "READY_FOR_SOLE_DECOMPRESSION_RUN":
        raise VG4Error("freeze receipt state is invalid")
    expected = {
        "evaluatorSha256": sha256_path(Path(__file__)),
        "officialSourceResearchSha256": sha256_path(SOURCE_RESEARCH_PATH),
        "protocolSha256": sha256_path(PROTOCOL_PATH),
        "sourceManifestSha256": sha256_path(SOURCE_MANIFEST_PATH),
        "trialGridSha256": canonical_sha([trial_mapping(item) for item in trial_grid()]),
    }
    for key, value in expected.items():
        if freeze_receipt.get(key) != value:
            raise VG4Error(f"freeze identity mismatch: {key}")
    source_manifest = load_json(SOURCE_MANIFEST_PATH)
    if source_manifest.get("state") != "CHECKSUM_VERIFIED_COMPRESSED_BYTES_NOT_OPENED_BY_VG4":
        raise VG4Error("source manifest state is invalid")
    if source_manifest.get("protocolSha256") != expected["protocolSha256"]:
        raise VG4Error("source manifest protocol mismatch")
    return freeze_receipt, source_manifest


def consume_run_marker(freeze_receipt: Mapping[str, Any]) -> str:
    if RUN_MARKER_PATH.exists() or RESULT_PATH.exists():
        raise VG4Error("the sole decompression run is already consumed")
    status = git_output("status", "--porcelain")
    if status:
        raise VG4Error("run requires the committed freeze packet and a clean worktree")
    marker = {
        "archiveDecompressionRunOrdinal": 1,
        "candidateSealPresentAtStart": False,
        "consumedAtUtc": utc_now(),
        "evaluatorSha256": freeze_receipt["evaluatorSha256"],
        "gitHead": git_output("rev-parse", "HEAD"),
        "holdoutOpenedAtStart": False,
        "protocolSha256": freeze_receipt["protocolSha256"],
        "schema": "VG4SoleRunMarkerV1",
        "sourceManifestSha256": freeze_receipt["sourceManifestSha256"],
        "state": "SOLE_ARCHIVE_DECOMPRESSION_RUN_CONSUMED",
    }
    write_json_once(RUN_MARKER_PATH, marker)
    return sha256_path(RUN_MARKER_PATH)


def holm_mapping(report: Any) -> dict[str, object]:
    return {
        "decisions": [
            {
                "effectivePValue": item.effective_p_value.as_mapping(),
                "rawPValue": (None if item.raw_p_value is None else item.raw_p_value.as_mapping()),
                "selected": item.selected,
                "threshold": item.threshold.as_mapping(),
                "trialId": item.trial_id,
            }
            for item in report.decisions
        ],
        "familywiseAlphaPerMyriad": report.familywise_alpha_per_myriad,
        "rejectedTrialIds": list(report.rejected_trial_ids),
        "testedCount": report.tested_count,
    }


def development_analysis(
    bars: Mapping[str, Mapping[date, Bar]],
    plan: WalkForwardPlanV1,
) -> tuple[
    list[dict[str, object]],
    Trial | None,
    Trial,
    dict[str, object],
    dict[str, object],
]:
    trials = trial_grid()
    segments = validation_segments(plan)
    simulations = tuple(simulate_segments(bars, trial, segments) for trial in trials)
    path_lengths = {len(item.base_daily_usd) for item in simulations}
    if len(path_lengths) != 1:
        raise VG4Error("development paths are not aligned")
    p_values = family_bootstrap_p_values(tuple(item.base_daily_usd for item in simulations))
    ledger = trial_ledger()
    holm = holm_bonferroni(
        ledger,
        tuple((trial.trial_id, p_value) for trial, p_value in zip(trials, p_values, strict=True)),
        familywise_alpha_per_myriad=HOLM_ALPHA_PER_MYRIAD,
    )
    holm_selected = set(holm.rejected_trial_ids)
    pbo, distinct = pbo_report(bars, trials)
    pbo_value = pbo_decimal(pbo)
    pbo_available = pbo.get("status") == PboStatus.AVAILABLE.value and distinct >= 2
    pbo["distinctTrialPathCount"] = distinct
    pbo["effectiveStatus"] = (
        "AVAILABLE" if pbo_available else "UNMEASURED_INSUFFICIENT_DISTINCT_PATHS"
    )

    candidate_rows: list[dict[str, object]] = []
    by_id: dict[str, tuple[Trial, dict[str, object], tuple[str, ...]]] = {}
    for trial, simulation, p_value in zip(trials, simulations, p_values, strict=True):
        metrics = simulation_metrics(simulation)
        reasons = development_gate_reasons(
            metrics,
            holm_selected=trial.trial_id in holm_selected,
            pbo_available=pbo_available,
            pbo_value=pbo_value,
        )
        row: dict[str, object] = {
            "gatePass": not reasons,
            "gateReasons": list(reasons),
            "metrics": metrics,
            "rawOneSidedBootstrapPValue": p_value.as_mapping(),
            "trial": trial_mapping(trial),
        }
        candidate_rows.append(row)
        by_id[trial.trial_id] = (trial, metrics, reasons)

    def rank_key(
        item: tuple[Trial, dict[str, object], tuple[str, ...]],
    ) -> tuple[Decimal, int, str]:
        trial, metrics, _ = item
        lower_raw = metrics["baseNetOneSided95LcbUsdPerDayPer1000"]
        lower = Decimal("-1E100") if lower_raw is None else Decimal(str(lower_raw))
        return (-lower, cast(int, metrics["closedTradeCount"]), trial.trial_id)

    ranked = sorted(by_id.values(), key=rank_key)
    reporting_trial = ranked[0][0]
    qualifiers = [item for item in ranked if not item[2]]
    champion = qualifiers[0][0] if qualifiers else None
    inference: dict[str, object] = {
        "bootstrap": {
            "blockLengthDays": BOOTSTRAP_BLOCK_DAYS,
            "familyDrawsSharedAcrossCandidates": True,
            "replicates": BOOTSTRAP_REPLICATES,
            "seed": str(BOOTSTRAP_SEED),
        },
        "holm": holm_mapping(holm),
        "pbo": pbo,
        "trialLedger": ledger.as_mapping(),
    }
    reporting = next(
        row
        for row in candidate_rows
        if cast(Mapping[str, Any], row["trial"])["trialId"] == reporting_trial.trial_id
    )
    return candidate_rows, champion, reporting_trial, reporting, inference


def candidate_seal(
    champion: Trial,
    reporting_row: Mapping[str, Any],
    plan: WalkForwardPlanV1,
    inference: Mapping[str, Any],
) -> dict[str, object]:
    seal = {
        "candidate": trial_mapping(champion),
        "candidateMetricsSha256": canonical_sha(reporting_row["metrics"]),
        "createdAtUtc": utc_now(),
        "evaluatorSha256": sha256_path(Path(__file__)),
        "holdoutOpened": False,
        "holmSha256": canonical_sha(inference["holm"]),
        "pboSha256": canonical_sha(inference["pbo"]),
        "planDigest": plan.digest().hexdigest,
        "protocolSha256": sha256_path(PROTOCOL_PATH),
        "schema": "VG4DevelopmentChampionSealV1",
        "sourceManifestSha256": sha256_path(SOURCE_MANIFEST_PATH),
        "state": "DEVELOPMENT_GATES_PASS_CHAMPION_FROZEN",
    }
    write_json_once(CANDIDATE_SEAL_PATH, seal)
    return seal


def open_declared_holdout(
    sample_set: SampleSetV1,
    plan: WalkForwardPlanV1,
    champion: Trial,
) -> tuple[ValidationSampleV1, ...]:
    if not CANDIDATE_SEAL_PATH.is_file():
        raise VG4Error("candidate seal is required before holdout grant")
    grant = HoldoutGrantV1(
        grant_id="vg4-final-untouched-holdout-once",
        reason="single final evaluation of the development-qualified frozen V-G4 champion",
        plan_digest=plan.digest(),
    )
    holdout_samples = open_holdout(sample_set, plan, grant)
    expected_ids = tuple(
        f"vg4-day-{day.isoformat()}" for day in date_range(DEVELOPMENT_END, EVALUATION_END)
    )
    if tuple(sample.sample_id for sample in holdout_samples) != expected_ids:
        raise VG4Error("granted holdout differs from the declared final 122 days")
    receipt = {
        "candidateSealSha256": sha256_path(CANDIDATE_SEAL_PATH),
        "championTrialId": champion.trial_id,
        "grant": grant.as_mapping(),
        "holdoutArchiveMonths": list(HOLDOUT_MONTHS),
        "holdoutSampleCount": len(holdout_samples),
        "openedAtUtc": utc_now(),
        "schema": "VG4HoldoutOpenOnceV1",
        "state": "HOLDOUT_OPENED_ONCE_FOR_FROZEN_CHAMPION",
    }
    write_json_once(HOLDOUT_OPEN_PATH, receipt)
    return holdout_samples


def final_result(
    *,
    marker_sha: str,
    plan: WalkForwardPlanV1,
    source_manifest: Mapping[str, Any],
    candidate_rows: list[dict[str, object]],
    champion: Trial | None,
    reporting_trial: Trial,
    reporting_row: Mapping[str, Any],
    inference: Mapping[str, Any],
    holdout_metrics: Mapping[str, Any] | None,
) -> dict[str, object]:
    result = base_result_envelope(
        marker_sha=marker_sha,
        plan=plan,
        source_manifest=source_manifest,
    )
    result["development"] = {
        "bestObservedTrialId": reporting_trial.trial_id,
        "candidateCount": len(candidate_rows),
        "candidates": candidate_rows,
        "inference": inference,
        "qualifiedChampionTrialId": None if champion is None else champion.trial_id,
        "reportingCandidate": reporting_row,
    }
    if champion is None:
        reasons = (
            "NO_DEVELOPMENT_CHAMPION",
            *cast(list[str], reporting_row["gateReasons"]),
        )
        result["holdout"] = {
            "archiveBodiesOpened": False,
            "metrics": None,
            "reason": "DEVELOPMENT_GATES_FAILED",
            "state": "UNOPENED_UNTOUCHED",
        }
        result["netEdge"] = {
            "baseNetMeanUsdPerDayPer1000": reporting_row["metrics"]["baseNetMeanUsdPerDayPer1000"],
            "baseNetOneSided95LcbUsdPerDayPer1000": reporting_row["metrics"][
                "baseNetOneSided95LcbUsdPerDayPer1000"
            ],
            "baseNetTotalUsdPer1000": reporting_row["metrics"]["baseNetTotalUsdPer1000"],
            "scope": "BEST_OBSERVED_DEVELOPMENT_CANDIDATE_NOT_QUALIFIED",
            "trialId": reporting_trial.trial_id,
        }
        verdict = "NO_GO"
    else:
        if holdout_metrics is None:
            raise VG4Error("opened holdout result is missing")
        reasons = holdout_gate_reasons(holdout_metrics)
        result["holdoutReuseCount"] = 1
        result["holdout"] = {
            "archiveBodiesOpened": True,
            "candidateSealSha256": sha256_path(CANDIDATE_SEAL_PATH),
            "holdoutOpenReceiptSha256": sha256_path(HOLDOUT_OPEN_PATH),
            "metrics": holdout_metrics,
            "state": "OPENED_ONCE_COMPLETE",
        }
        result["netEdge"] = {
            "baseNetMeanUsdPerDayPer1000": holdout_metrics["baseNetMeanUsdPerDayPer1000"],
            "baseNetOneSided95LcbUsdPerDayPer1000": holdout_metrics[
                "baseNetOneSided95LcbUsdPerDayPer1000"
            ],
            "baseNetTotalUsdPer1000": holdout_metrics["baseNetTotalUsdPer1000"],
            "scope": "SINGLE_UNTOUCHED_HOLDOUT",
            "trialId": champion.trial_id,
        }
        verdict = "GO" if not reasons else "NO_GO"
    result["verdict"] = {
        "capitalAuthority": "NONE",
        "consumer": "N3",
        "feeScenario": "PUBLIC_REGULAR_USER_10_BPS_TAKER_PER_LEG",
        "goScope": "PUBLIC_RESEARCH_SCENARIO_ONLY",
        "reasons": list(reasons),
        "status": verdict,
    }
    return result


def terminal_unmeasured_result(
    *,
    marker_sha: str,
    reason: str,
    plan: WalkForwardPlanV1,
    source_manifest: Mapping[str, Any],
) -> dict[str, object]:
    result = base_result_envelope(
        marker_sha=marker_sha,
        plan=plan,
        source_manifest=source_manifest,
    )
    opened = HOLDOUT_OPEN_PATH.exists()
    result["holdoutReuseCount"] = 1 if opened else 0
    result["development"] = None
    result["holdout"] = {
        "archiveBodiesOpened": opened,
        "metrics": None,
        "state": "OPENED_INCOMPLETE" if opened else "UNOPENED_UNTOUCHED",
    }
    result["netEdge"] = {
        "baseNetMeanUsdPerDayPer1000": None,
        "baseNetOneSided95LcbUsdPerDayPer1000": None,
        "baseNetTotalUsdPer1000": None,
        "scope": "UNMEASURED",
        "trialId": None,
    }
    result["verdict"] = {
        "capitalAuthority": "NONE",
        "consumer": "N3",
        "feeScenario": "PUBLIC_REGULAR_USER_10_BPS_TAKER_PER_LEG",
        "goScope": "NONE",
        "reasons": [reason],
        "status": "UNMEASURED",
    }
    return result


def run_experiment() -> None:
    freeze_receipt, source_manifest = validate_frozen_identity()
    marker_sha = consume_run_marker(freeze_receipt)
    sample_set, plan = build_validation_plan()
    try:
        development_source_months = frozenset(("2025-05", "2025-06", *DEVELOPMENT_MONTHS))
        bars = load_bars(source_manifest, development_source_months)
        candidate_rows, champion, reporting_trial, reporting_row, inference = development_analysis(
            bars, plan
        )
        holdout_metrics: dict[str, object] | None = None
        if champion is not None:
            champion_row = next(
                row
                for row in candidate_rows
                if cast(dict[str, Any], row["trial"])["trialId"] == champion.trial_id
            )
            candidate_seal(champion, champion_row, plan, inference)
            open_declared_holdout(sample_set, plan, champion)
            bars = load_bars(source_manifest, frozenset(HOLDOUT_MONTHS), bars)
            holdout_simulation = simulate_segment(
                bars,
                champion,
                DEVELOPMENT_END,
                EVALUATION_END,
            )
            holdout_metrics = simulation_metrics(holdout_simulation)
        result = final_result(
            marker_sha=marker_sha,
            plan=plan,
            source_manifest=source_manifest,
            candidate_rows=candidate_rows,
            champion=champion,
            reporting_trial=reporting_trial,
            reporting_row=reporting_row,
            inference=inference,
            holdout_metrics=holdout_metrics,
        )
    except Exception as error:
        reason = (
            str(error)
            if isinstance(error, VG4Error)
            else f"EVALUATION_ERROR_{type(error).__name__.upper()}:{error}"
        )
        result = terminal_unmeasured_result(
            marker_sha=marker_sha,
            reason=reason,
            plan=plan,
            source_manifest=source_manifest,
        )
    write_json_once(RESULT_PATH, result)
    write_sha256s()
    verdict = cast(dict[str, Any], result["verdict"])
    edge = cast(dict[str, Any], result["netEdge"])
    print(
        f"{verdict['status']} scope={edge['scope']} "
        f"netUsdPer1000={edge['baseNetTotalUsdPer1000']} "
        f"holdout={cast(dict[str, Any], result['holdout'])['state']}"
    )


def packet_files() -> tuple[Path, ...]:
    return tuple(
        sorted(
            (
                path
                for path in HERE.iterdir()
                if path.is_file()
                and path.name != SHA256SUMS_PATH.name
                and not path.name.startswith(".")
            ),
            key=lambda path: path.name,
        )
    )


def write_bytes_atomic(path: Path, payload: bytes) -> None:
    descriptor, raw_path = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    tmp = Path(raw_path)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


def write_sha256s() -> None:
    lines = [f"{sha256_path(path)}  {path.name}\n" for path in packet_files()]
    write_bytes_atomic(SHA256SUMS_PATH, "".join(lines).encode("ascii"))


def verify_source_artifacts(source_manifest: Mapping[str, Any]) -> None:
    artifacts = source_manifest.get("artifacts")
    if not isinstance(artifacts, list):
        raise VG4Error("source manifest artifacts is invalid")
    for raw in artifacts:
        if not isinstance(raw, dict):
            raise VG4Error("source manifest artifact is invalid")
        artifact = cast(Mapping[str, Any], raw)
        zip_path = SOURCE_ROOT / str(artifact["zipPath"])
        checksum_path = SOURCE_ROOT / str(artifact["checksumPath"])
        pair_path = SOURCE_ROOT / str(artifact["pairPath"])
        if sha256_path(zip_path) != artifact["zipSha256"]:
            raise VG4Error(f"source ZIP drift: {zip_path.name}")
        if sha256_path(checksum_path) != artifact["checksumSha256"]:
            raise VG4Error(f"source checksum drift: {checksum_path.name}")
        if sha256_path(pair_path) != artifact["pairSha256"]:
            raise VG4Error(f"source pair receipt drift: {pair_path}")
        verify_checksum_text(
            checksum_path.read_bytes(),
            zip_path.name,
            str(artifact["zipSha256"]),
        )


def verify_sha256s() -> None:
    if not SHA256SUMS_PATH.is_file():
        raise VG4Error("SHA256SUMS is absent")
    expected: dict[str, str] = {}
    for line in SHA256SUMS_PATH.read_text(encoding="ascii").splitlines():
        parts = line.split("  ", 1)
        if len(parts) != 2 or re.fullmatch(r"[0-9a-f]{64}", parts[0]) is None:
            raise VG4Error("SHA256SUMS grammar is invalid")
        digest, name = parts
        if "/" in name or name in expected:
            raise VG4Error("SHA256SUMS name is invalid or duplicate")
        expected[name] = digest
    actual_names = {path.name for path in packet_files()}
    if set(expected) != actual_names:
        raise VG4Error("SHA256SUMS inventory differs from packet files")
    for path in packet_files():
        if sha256_path(path) != expected[path.name]:
            raise VG4Error(f"packet digest mismatch: {path.name}")


def verify_packet() -> None:
    freeze_receipt, source_manifest = validate_frozen_identity()
    verify_source_artifacts(source_manifest)
    if not RUN_MARKER_PATH.is_file() or not RESULT_PATH.is_file():
        raise VG4Error("terminal run marker and result are required")
    marker = load_json(RUN_MARKER_PATH)
    result = load_json(RESULT_PATH)
    if marker.get("state") != "SOLE_ARCHIVE_DECOMPRESSION_RUN_CONSUMED":
        raise VG4Error("run marker state is invalid")
    if marker.get("evaluatorSha256") != freeze_receipt["evaluatorSha256"]:
        raise VG4Error("run marker evaluator mismatch")
    if marker.get("sourceManifestSha256") != sha256_path(SOURCE_MANIFEST_PATH):
        raise VG4Error("run marker source mismatch")
    if result.get("runMarkerSha256") != sha256_path(RUN_MARKER_PATH):
        raise VG4Error("result run marker mismatch")
    if result.get("freezeSha256") != sha256_path(FREEZE_PATH):
        raise VG4Error("result freeze mismatch")
    verdict = result.get("verdict")
    holdout = result.get("holdout")
    if not isinstance(verdict, dict) or verdict.get("status") not in {
        "GO",
        "NO_GO",
        "UNMEASURED",
    }:
        raise VG4Error("result verdict is invalid")
    if not isinstance(holdout, dict):
        raise VG4Error("result holdout state is invalid")
    if HOLDOUT_OPEN_PATH.exists():
        if not CANDIDATE_SEAL_PATH.exists():
            raise VG4Error("holdout receipt exists without candidate seal")
        if holdout.get("state") not in {"OPENED_ONCE_COMPLETE", "OPENED_INCOMPLETE"}:
            raise VG4Error("result denies an existing holdout-open receipt")
        open_receipt = load_json(HOLDOUT_OPEN_PATH)
        if open_receipt.get("candidateSealSha256") != sha256_path(CANDIDATE_SEAL_PATH):
            raise VG4Error("holdout receipt candidate seal mismatch")
    else:
        if holdout.get("state") != "UNOPENED_UNTOUCHED":
            raise VG4Error("result claims an absent holdout was opened")
        if CANDIDATE_SEAL_PATH.exists() and verdict.get("status") != "UNMEASURED":
            raise VG4Error("candidate seal without holdout is only valid after a terminal error")
    verify_sha256s()
    print(
        f"VERIFIED verdict={verdict['status']} holdout={holdout['state']} "
        f"result={sha256_path(RESULT_PATH)}"
    )


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("freeze", "run", "verify", "hashes"))
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    try:
        if args.command == "freeze":
            freeze()
        elif args.command == "run":
            run_experiment()
        elif args.command == "verify":
            verify_packet()
        else:
            write_sha256s()
            print(f"HASHED files={len(packet_files())}")
    except (VG4Error, OSError, subprocess.CalledProcessError) as error:
        print(f"VG4_ERROR {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
