#!/usr/bin/env python3
"""One-run public V-G16 quote-volume concentration-change experiment.

``freeze`` hashes compressed public inputs without opening ZIP members.
``run`` consumes an exclusive marker before decompression, evaluates the full
development family, and opens the chronological holdout only after a qualifying
champion is sealed. ``verify`` authenticates committed packet bytes without
opening archives or recomputing outcomes.

No command reads credentials, account state, private endpoints, orders, wallet
state, provider state, host state, or UI state.
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
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal, InvalidOperation, getcontext
from pathlib import Path
from typing import Any, cast

from quant_edge.labels.rational import ExactRatioV1, make_ratio
from quant_edge.randomness import DeterministicRandom
from quant_edge.validation.bootstrap import (
    BootstrapSpecV1,
    BootstrapStatus,
    block_bootstrap_interval,
)
from quant_edge.validation.multiplicity import (
    TrialLedgerV1,
    TrialRecordV1,
    TrialStatus,
    distinct_trial_count,
    holm_bonferroni,
    pbo_cscv,
)

getcontext().prec = 50

HERE = Path(__file__).resolve().parent
QUANT_ROOT = HERE.parents[1]
REPO_ROOT = HERE.parents[2]
PROTOCOL_PATH = HERE / "protocol.v1.json"
SOURCE_RESEARCH_PATH = HERE / "OFFICIAL_SOURCE_RESEARCH.md"
README_PATH = HERE / "README.md"
INIT_PATH = HERE / "__init__.py"
TEST_PATH = HERE / "test_experiment.py"
DEPENDENCY_PATHS = (
    QUANT_ROOT / "src/quant_edge/labels/rational.py",
    QUANT_ROOT / "src/quant_edge/randomness.py",
    QUANT_ROOT / "src/quant_edge/validation/bootstrap.py",
    QUANT_ROOT / "src/quant_edge/validation/multiplicity.py",
)
SOURCE_MANIFEST_PATH = HERE / "source-manifest.v1.json"
FREEZE_PATH = HERE / "freeze.v1.json"
RUN_MARKER_PATH = HERE / "run-marker.v1.json"
CANDIDATE_SEAL_PATH = HERE / "candidate-seal.v1.json"
HOLDOUT_OPEN_PATH = HERE / "holdout-open.v1.json"
RESULT_PATH = HERE / "result.v1.json"
TERMINAL_PATH = HERE / "TERMINAL.md"
SHA256SUMS_PATH = HERE / "SHA256SUMS"

BASE_COMMIT = "a169b123fb186d1943a75ad648552c4d95be1be1"
PROTOCOL_SHA256 = "5069d2fc52cebeb8d7921ee17b0f35480b477cb56c99ba803eaf5c71f8cae2ec"
SOURCE_ROOT = Path("/private/tmp/cosmos-s1f-weekly-momentum-cash-v1")
SOURCE_ACQUISITION = SOURCE_ROOT / "acquisition-manifest.v1.json"
SOURCE_DISCOVERY = SOURCE_ROOT / "discovery.v1.json"
SOURCE_ACQUISITION_SHA256 = "01f58272602e43bfb914b649adc00d8273b2d423492220a55f86443bb6441176"
SOURCE_DISCOVERY_SHA256 = "b4a8f7abd36df19eff0510dfcc3c61fd0df9fdcab5f4d248892ee10010fb21c3"

WARMUP_START = date(2025, 5, 1)
FEATURE_START = date(2025, 7, 1)
DEVELOPMENT_START = date(2025, 11, 1)
DEVELOPMENT_END = date(2026, 3, 1)
HOLDOUT_START = DEVELOPMENT_END
EVALUATION_END = date(2026, 7, 1)
DEVELOPMENT_MONTHS = ("2025-11", "2025-12", "2026-01", "2026-02")
HOLDOUT_MONTHS = ("2026-03", "2026-04", "2026-05", "2026-06")
SOURCE_MONTHS = tuple(
    f"{year:04d}-{month:02d}"
    for year, start_month, end_month in ((2025, 5, 12), (2026, 1, 6))
    for month in range(start_month, end_month + 1)
)

USDT_1000 = Decimal("1000")
PUBLIC_FEE = Decimal("0.0010")
BASE_ADVERSE = Decimal("0.0010")
STRESS_ADVERSE = Decimal("0.0025")
SEVERE_ADVERSE = Decimal("0.0050")
MIN_MEDIAN_DAILY_QUOTE_VOLUME = Decimal("5000000")
MIN_RISK_SET_SIZE = 30
BASE_CAPACITY_PARTICIPATION = Decimal("0.0001")
STRESS_CAPACITY_PARTICIPATION = Decimal("0.00005")
CAPACITY_GATE_USDT = Decimal("1000")
MAX_DRAWDOWN = Decimal("0.20")
ROBUST_MAD_SCALE = Decimal("1.4826")
BOOTSTRAP_SEED = 202_607_291_616
BOOTSTRAP_REPLICATES = 4_096
BOOTSTRAP_COVERAGE_PER_MYRIAD = 9_000
HOLM_ALPHA_PER_MYRIAD = 500
WRC_ALPHA = Decimal("0.05")

EXCLUDED_STABLE_OR_FIAT_SYMBOLS = frozenset(
    {
        "AEURUSDT",
        "AUDUSDT",
        "BFUSDUSDT",
        "BKRWUSDT",
        "BUSDUSDT",
        "DAIUSDT",
        "EURIUSDT",
        "EURUSDT",
        "FDUSDUSDT",
        "FRAXUSDT",
        "GBPUSDT",
        "PAXUSDT",
        "RLUSDUSDT",
        "SUSDUSDT",
        "TUSDUSDT",
        "USD1USDT",
        "USDCUSDT",
        "USDEUSDT",
        "USDPUSDT",
        "USDSOLDUSDT",
        "USDSUSDT",
        "USTCUSDT",
        "USTUSDT",
        "XUSDUSDT",
    }
)
EXCLUDED_PAIRED_LEVERAGED_SYMBOLS = frozenset(
    {
        "1INCHDOWNUSDT",
        "1INCHUPUSDT",
        "AAVEDOWNUSDT",
        "AAVEUPUSDT",
        "ADADOWNUSDT",
        "ADAUPUSDT",
        "BCHDOWNUSDT",
        "BCHUPUSDT",
        "BEARUSDT",
        "BNBBEARUSDT",
        "BNBBULLUSDT",
        "BNBDOWNUSDT",
        "BNBUPUSDT",
        "BTCDOWNUSDT",
        "BTCUPUSDT",
        "BULLUSDT",
        "DOTDOWNUSDT",
        "DOTUPUSDT",
        "EOSBEARUSDT",
        "EOSBULLUSDT",
        "EOSDOWNUSDT",
        "EOSUPUSDT",
        "ETHBEARUSDT",
        "ETHBULLUSDT",
        "ETHDOWNUSDT",
        "ETHUPUSDT",
        "FILDOWNUSDT",
        "FILUPUSDT",
        "LINKDOWNUSDT",
        "LINKUPUSDT",
        "LTCDOWNUSDT",
        "LTCUPUSDT",
        "SUSHIDOWNUSDT",
        "SUSHIUPUSDT",
        "SXPDOWNUSDT",
        "SXPUPUSDT",
        "TRXDOWNUSDT",
        "TRXUPUSDT",
        "UNIDOWNUSDT",
        "UNIUPUSDT",
        "XLMDOWNUSDT",
        "XLMUPUSDT",
        "XRPBEARUSDT",
        "XRPBULLUSDT",
        "XRPDOWNUSDT",
        "XRPUPUSDT",
        "XTZDOWNUSDT",
        "XTZUPUSDT",
        "YFIDOWNUSDT",
        "YFIUPUSDT",
    }
)
DISCOVERY_PAIRED_LEVERAGED_SHA256 = (
    "4a0836ed77c6114becd45241429a1c418bc3aa182d8c5035803b308d839772e4"
)
DISCOVERY_STABLE_OR_FIAT_SHA256 = "850acfaa5b3895914e22445631eec72cd31818d534c5869898210764556b30ff"
CHECKSUM_RE = re.compile(r"^([0-9a-f]{64})[ \t]+\*?([^\r\n]+)[\r\n]*$")
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


class VG16Error(RuntimeError):
    """A terminal V-G16 protocol, source, or measurement failure."""


@dataclass(frozen=True, slots=True)
class Trial:
    trial_id: str
    history_days: int
    z_floor: Decimal
    cohort_size: int


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
    raw_fields: tuple[str, ...]
    decoded_fields_sha256: str


@dataclass(frozen=True, slots=True)
class LoadedBars:
    bars: dict[str, dict[date, Bar]]
    duplicate_rows: tuple[dict[str, object], ...]


@dataclass(frozen=True, slots=True)
class ConcentrationFeature:
    decision_day: date
    delta_hhi: Decimal
    risk_set_size: int
    positive_contributions: tuple[tuple[str, Decimal], ...]
    risk_set_sha256: str


@dataclass(frozen=True, slots=True)
class CohortSignal:
    decision_day: date
    symbols: tuple[str, ...]
    delta_hhi: Decimal
    robust_z: Decimal
    risk_set_size: int


@dataclass(slots=True)
class ScenarioState:
    cash: Decimal
    surplus: Decimal = Decimal(0)
    quantities: dict[str, Decimal] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class OpenCohort:
    signal: CohortSignal
    entry_day: date
    entry_prices: dict[str, Decimal]
    entry_notional_by_scenario: dict[str, Decimal]
    entry_capacity_base_usdt: Decimal
    entry_capacity_stress_usdt: Decimal


@dataclass(frozen=True, slots=True)
class CohortTrade:
    symbols: tuple[str, ...]
    decision_day: date
    entry_day: date
    exit_day: date
    entry_notional_usdt: Decimal
    reference_gross_pnl_usdt: Decimal
    entry_fee_cost_usdt: Decimal
    exit_fee_cost_usdt: Decimal
    entry_adverse_cost_usdt: Decimal
    exit_adverse_cost_usdt: Decimal
    base_net_pnl_usdt: Decimal
    stress_net_pnl_usdt: Decimal
    severe_net_pnl_usdt: Decimal
    base_capacity_proxy_usdt: Decimal
    stress_capacity_proxy_usdt: Decimal


@dataclass(frozen=True, slots=True)
class Simulation:
    trial_id: str
    days: tuple[date, ...]
    gross_daily_usdt: tuple[Decimal, ...]
    base_daily_usdt: tuple[Decimal, ...]
    stress_daily_usdt: tuple[Decimal, ...]
    severe_daily_usdt: tuple[Decimal, ...]
    base_nav: tuple[Decimal, ...]
    stress_nav: tuple[Decimal, ...]
    base_drawdown_nav: tuple[Decimal, ...]
    stress_drawdown_nav: tuple[Decimal, ...]
    base_log_returns: tuple[Decimal, ...]
    trades: tuple[CohortTrade, ...]
    cash_day_count: int
    active_signal_count: int


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


def dependency_sha256_mapping() -> dict[str, str]:
    return {path.relative_to(REPO_ROOT).as_posix(): sha256_path(path) for path in DEPENDENCY_PATHS}


def load_json(path: Path) -> dict[str, Any]:
    with path.open("rb") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise VG16Error(f"{path.name} must contain a JSON object")
    return cast(dict[str, Any], value)


def fsync_directory(directory: Path) -> None:
    descriptor = os.open(directory, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def write_bytes_once(path: Path, payload: bytes) -> None:
    if path.exists():
        if path.read_bytes() != payload:
            raise VG16Error(f"refusing to replace non-identical {path.name}")
        return
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        fsync_directory(path.parent)
    except BaseException:
        path.unlink(missing_ok=True)
        raise


def write_json_once(path: Path, value: object) -> None:
    write_bytes_once(path, canonical_bytes(value))


def write_bytes_atomic(path: Path, payload: bytes) -> None:
    descriptor, raw_path = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary = Path(raw_path)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        fsync_directory(path.parent)
    finally:
        temporary.unlink(missing_ok=True)


def utc_now() -> str:
    return datetime.now(tz=UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def decimal_text(value: Decimal, places: int = 12) -> str:
    quantum = Decimal(1).scaleb(-places)
    return format(value.quantize(quantum), "f")


def decimal_from_text(value: str, *, field_name: str, nonnegative: bool = False) -> Decimal:
    try:
        parsed = Decimal(value)
    except InvalidOperation as error:
        raise VG16Error(f"{field_name} is not a decimal") from error
    if not parsed.is_finite() or (nonnegative and parsed < 0):
        raise VG16Error(f"{field_name} is outside its declared decimal domain")
    return parsed


def median_decimal(values: Sequence[Decimal]) -> Decimal:
    if not values:
        raise VG16Error("median requires values")
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) / 2


def date_range(start: date, end_exclusive: date) -> tuple[date, ...]:
    count = (end_exclusive - start).days
    if count < 0:
        raise VG16Error("date range is reversed")
    return tuple(start + timedelta(days=offset) for offset in range(count))


def month_of(day: date) -> str:
    return day.strftime("%Y-%m")


def symbol_sort_key(symbol: str) -> bytes:
    return symbol.encode("utf-8")


def trial_grid() -> tuple[Trial, ...]:
    trials = [
        Trial(
            trial_id=(f"vg16-l{history_days:02d}-z{int(z_floor * 10):02d}-k{cohort_size:02d}"),
            history_days=history_days,
            z_floor=z_floor,
            cohort_size=cohort_size,
        )
        for history_days in (20, 60)
        for z_floor in (Decimal("1.0"), Decimal("2.0"))
        for cohort_size in (3, 5, 10)
    ]
    return tuple(sorted(trials, key=lambda item: item.trial_id))


def trial_mapping(trial: Trial) -> dict[str, object]:
    return {
        "cohortSize": trial.cohort_size,
        "historyDays": trial.history_days,
        "trialId": trial.trial_id,
        "zFloor": format(trial.z_floor, "f"),
    }


def eligible_symbol(symbol: str) -> bool:
    if not symbol.endswith("USDT") or len(symbol) <= 4:
        return False
    return (
        symbol not in EXCLUDED_STABLE_OR_FIAT_SYMBOLS
        and symbol not in EXCLUDED_PAIRED_LEVERAGED_SYMBOLS
    )


def require_regular_file(path: Path) -> None:
    if path.is_symlink() or not path.is_file():
        raise VG16Error(f"required regular file is absent: {path}")


def expected_archive_paths(symbol: str, month: str) -> tuple[Path, Path, Path]:
    directory = SOURCE_ROOT / "archives" / symbol / month
    zip_path = directory / f"{symbol}-1d-{month}.zip"
    checksum_path = directory / f"{zip_path.name}.CHECKSUM"
    return zip_path, checksum_path, directory / "pair.v1.json"


def verify_checksum_text(checksum_bytes: bytes, zip_name: str, zip_sha: str) -> None:
    try:
        text = checksum_bytes.decode("ascii")
    except UnicodeDecodeError as error:
        raise VG16Error(f"{zip_name} checksum is not ASCII") from error
    match = CHECKSUM_RE.fullmatch(text)
    if match is None:
        raise VG16Error(f"{zip_name} checksum grammar is invalid")
    published_sha, published_name = match.groups()
    if published_name.strip() != zip_name:
        raise VG16Error(f"{zip_name} checksum names another object")
    if published_sha != zip_sha:
        raise VG16Error(f"{zip_name} differs from its official checksum")


def source_artifact_row(pair: Mapping[str, Any]) -> dict[str, object]:
    symbol = str(pair["symbol"])
    month = str(pair["month"])
    zip_path, checksum_path, pair_path = expected_archive_paths(symbol, month)
    for path in (zip_path, checksum_path, pair_path):
        require_regular_file(path)
    pair_bytes = pair_path.read_bytes()
    pair_local = json.loads(pair_bytes)
    if not isinstance(pair_local, dict):
        raise VG16Error(f"{pair_path} receipt is not an object")
    if pair_local.get("symbol") != symbol or pair_local.get("month") != month:
        raise VG16Error(f"{pair_path} identity mismatch")
    zip_key = f"data/spot/monthly/klines/{symbol}/1d/{zip_path.name}"
    checksum_key = f"{zip_key}.CHECKSUM"
    shared_receipt_fields = (
        "checksumFrozenEtag",
        "checksumFrozenLastModified",
        "checksumKey",
        "checksumListedBytes",
        "checksumSha256",
        "month",
        "symbol",
        "zipFrozenEtag",
        "zipFrozenLastModified",
        "zipKey",
        "zipListedBytes",
        "zipSha256",
    )
    if any(pair_local.get(field) != pair.get(field) for field in shared_receipt_fields):
        raise VG16Error(f"{pair_path} differs from the frozen acquisition manifest")
    if pair.get("zipKey") != zip_key or pair.get("checksumKey") != checksum_key:
        raise VG16Error(f"{pair_path} official object-key identity mismatch")

    zip_sha = sha256_path(zip_path)
    checksum_sha = sha256_path(checksum_path)
    pair_sha = hashlib.sha256(pair_bytes).hexdigest()
    if zip_sha != pair["zipSha256"] or zip_sha != pair_local.get("zipSha256"):
        raise VG16Error(f"{zip_path} SHA-256 drift")
    if checksum_sha != pair["checksumSha256"] or checksum_sha != pair_local.get("checksumSha256"):
        raise VG16Error(f"{checksum_path} SHA-256 drift")
    if zip_path.stat().st_size != int(pair["zipBytes"]):
        raise VG16Error(f"{zip_path} byte-length drift")
    if checksum_path.stat().st_size != int(pair["checksumBytes"]):
        raise VG16Error(f"{checksum_path} byte-length drift")
    verify_checksum_text(checksum_path.read_bytes(), zip_path.name, zip_sha)
    return {
        "checksumBytes": checksum_path.stat().st_size,
        "checksumEtag": pair["checksumFrozenEtag"],
        "checksumKey": checksum_key,
        "checksumLastModified": pair["checksumFrozenLastModified"],
        "checksumPath": str(checksum_path.relative_to(SOURCE_ROOT)),
        "checksumSha256": checksum_sha,
        "checksumUrl": f"https://data.binance.vision/{checksum_key}",
        "month": month,
        "pairPath": str(pair_path.relative_to(SOURCE_ROOT)),
        "pairSha256": pair_sha,
        "symbol": symbol,
        "zipBytes": zip_path.stat().st_size,
        "zipEtag": pair["zipFrozenEtag"],
        "zipKey": zip_key,
        "zipLastModified": pair["zipFrozenLastModified"],
        "zipPath": str(zip_path.relative_to(SOURCE_ROOT)),
        "zipSha256": zip_sha,
        "zipUrl": f"https://data.binance.vision/{zip_key}",
    }


def build_source_manifest() -> dict[str, object]:
    for path in (SOURCE_ACQUISITION, SOURCE_DISCOVERY):
        require_regular_file(path)
    if sha256_path(SOURCE_ACQUISITION) != SOURCE_ACQUISITION_SHA256:
        raise VG16Error("source acquisition manifest drifted")
    if sha256_path(SOURCE_DISCOVERY) != SOURCE_DISCOVERY_SHA256:
        raise VG16Error("source discovery manifest drifted")
    acquisition = load_json(SOURCE_ACQUISITION)
    discovery = load_json(SOURCE_DISCOVERY)
    if acquisition.get("state") != "CHECKSUM_VERIFIED_ARCHIVES_NOT_DECOMPRESSED":
        raise VG16Error("source acquisition state is inadmissible")
    exclusions = discovery.get("exclusions")
    if not isinstance(exclusions, dict):
        raise VG16Error("source discovery exclusions are invalid")
    if (
        exclusions.get("pairedLeveragedSha256") != DISCOVERY_PAIRED_LEVERAGED_SHA256
        or exclusions.get("stableOrFiatSha256") != DISCOVERY_STABLE_OR_FIAT_SHA256
        or exclusions.get("pairedLeveragedSymbols")
        != sorted(EXCLUDED_PAIRED_LEVERAGED_SYMBOLS, key=symbol_sort_key)
        or exclusions.get("stableOrFiatSymbols")
        != sorted(EXCLUDED_STABLE_OR_FIAT_SYMBOLS, key=symbol_sort_key)
    ):
        raise VG16Error("source discovery semantic exclusions drifted")
    raw_pairs = acquisition.get("artifactPairs")
    if not isinstance(raw_pairs, list):
        raise VG16Error("source acquisition artifactPairs is invalid")
    selected: list[dict[str, object]] = []
    for raw_pair in raw_pairs:
        if not isinstance(raw_pair, dict):
            raise VG16Error("source acquisition pair is invalid")
        symbol = str(raw_pair.get("symbol"))
        month = str(raw_pair.get("month"))
        if month in SOURCE_MONTHS and eligible_symbol(symbol):
            selected.append(source_artifact_row(cast(Mapping[str, Any], raw_pair)))
    selected.sort(key=lambda row: (symbol_sort_key(str(row["symbol"])), str(row["month"])))
    if not selected:
        raise VG16Error("source selection is empty")
    identities = tuple((str(row["symbol"]), str(row["month"])) for row in selected)
    if len(identities) != len(set(identities)):
        raise VG16Error("source acquisition contains duplicate symbol-month identities")
    symbols = sorted({str(row["symbol"]) for row in selected}, key=symbol_sort_key)
    return {
        "acquisitionManifestPath": str(SOURCE_ACQUISITION),
        "acquisitionManifestSha256": sha256_path(SOURCE_ACQUISITION),
        "archiveBodiesDecompressedDuringFreeze": False,
        "artifactCount": len(selected),
        "artifacts": selected,
        "baseCommit": BASE_COMMIT,
        "discoveryManifestPath": str(SOURCE_DISCOVERY),
        "discoveryManifestSha256": sha256_path(SOURCE_DISCOVERY),
        "excludedPairedLeveragedSha256": DISCOVERY_PAIRED_LEVERAGED_SHA256,
        "excludedStableOrFiatSha256": DISCOVERY_STABLE_OR_FIAT_SHA256,
        "monthRange": list(SOURCE_MONTHS),
        "protocolSha256": sha256_path(PROTOCOL_PATH),
        "schema": "VG16FrozenPublicSourceManifestV1",
        "sourceRoot": str(SOURCE_ROOT),
        "state": "CHECKSUM_VERIFIED_COMPRESSED_BYTES_NOT_OPENED_BY_VG16",
        "symbolCount": len(symbols),
        "symbolSetSha256": canonical_sha(symbols),
    }


def git_output(*args: str) -> str:
    completed = subprocess.run(
        ("git", *args),
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return completed.stdout.strip()


def git_blob_sha256(commit: str, path: Path) -> str:
    relative = path.relative_to(REPO_ROOT).as_posix()
    completed = subprocess.run(
        ("git", "show", f"{commit}:{relative}"),
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
    )
    return hashlib.sha256(completed.stdout).hexdigest()


def changed_paths(base: str, head: str) -> tuple[str, ...]:
    output = git_output(
        "diff",
        "--name-only",
        "--diff-filter=ACMRTUXBD",
        f"{base}..{head}",
    )
    return tuple(line for line in output.splitlines() if line)


def require_exclusive_scope(paths: Sequence[str]) -> None:
    if not paths:
        raise VG16Error("exclusive V-G16 change set is empty")
    if any(not path.startswith("quant/research/vg16/") for path in paths):
        raise VG16Error("change set escapes exclusive quant/research/vg16 scope")


def packet_files() -> tuple[Path, ...]:
    return tuple(
        sorted(
            (
                path
                for path in HERE.iterdir()
                if path.is_file()
                and not path.is_symlink()
                and path.name != SHA256SUMS_PATH.name
                and not path.name.startswith(".")
                and path.name != "__pycache__"
            ),
            key=lambda path: path.name,
        )
    )


def write_sha256s() -> None:
    lines = [f"{sha256_path(path)}  {path.name}\n" for path in packet_files()]
    write_bytes_atomic(SHA256SUMS_PATH, "".join(lines).encode("ascii"))


def freeze() -> None:
    outcome_paths = (
        RUN_MARKER_PATH,
        CANDIDATE_SEAL_PATH,
        HOLDOUT_OPEN_PATH,
        RESULT_PATH,
        TERMINAL_PATH,
    )
    if any(path.exists() or path.is_symlink() for path in outcome_paths):
        raise VG16Error("freeze is forbidden when any outcome receipt already exists")
    if git_output("rev-parse", "HEAD") != BASE_COMMIT:
        raise VG16Error("freeze must start at the exact canonical base commit")
    status_lines = git_output(
        "status",
        "--porcelain",
        "--untracked-files=all",
    ).splitlines()
    require_exclusive_scope(
        tuple((line[3:].split(" -> ", 1)[-1] if len(line) >= 4 else "") for line in status_lines)
    )
    protocol = load_json(PROTOCOL_PATH)
    if (
        sha256_path(PROTOCOL_PATH) != PROTOCOL_SHA256
        or protocol.get("baseCommit") != BASE_COMMIT
        or protocol.get("schema") != "VG16LaggedQuoteVolumeConcentrationChangeProtocolV1"
    ):
        raise VG16Error("protocol identity or base commit mismatch")
    if len(trial_grid()) != 12:
        raise VG16Error("trial family is not exactly twelve")
    manifest = build_source_manifest()
    write_json_once(SOURCE_MANIFEST_PATH, manifest)
    receipt = {
        "archiveBodiesDecompressed": False,
        "baseCommit": BASE_COMMIT,
        "createdAtUtc": utc_now(),
        "dependencySha256": dependency_sha256_mapping(),
        "evaluatorPath": "quant/research/vg16/experiment.py",
        "evaluatorSha256": sha256_path(Path(__file__)),
        "initSha256": sha256_path(INIT_PATH),
        "officialSourceResearchSha256": sha256_path(SOURCE_RESEARCH_PATH),
        "protocolSha256": sha256_path(PROTOCOL_PATH),
        "pythonRuntime": sys.version,
        "readmeSha256": sha256_path(README_PATH),
        "schema": "VG16PreOutcomeFreezeV1",
        "sourceManifestSha256": sha256_path(SOURCE_MANIFEST_PATH),
        "state": "READY_FOR_SOLE_DECOMPRESSION_RUN",
        "testSha256": sha256_path(TEST_PATH),
        "trialGridSha256": canonical_sha([trial_mapping(trial) for trial in trial_grid()]),
    }
    write_json_once(FREEZE_PATH, receipt)
    write_sha256s()
    print(
        f"FROZEN artifacts={manifest['artifactCount']} symbols={manifest['symbolCount']} "
        f"source={receipt['sourceManifestSha256']}"
    )


def parse_timestamp_us(raw: str, *, field_name: str) -> tuple[int, datetime]:
    try:
        value = int(raw)
    except ValueError as error:
        raise VG16Error(f"{field_name} is not an integer timestamp") from error
    if value < 1_000_000_000_000_000:
        raise VG16Error(f"{field_name} is not a post-2025 microsecond timestamp")
    seconds, micros = divmod(value, 1_000_000)
    parsed = datetime.fromtimestamp(seconds, tz=UTC) + timedelta(microseconds=micros)
    return value, parsed


def parse_kline_row(
    symbol: str,
    month: str,
    row: tuple[str, ...],
    *,
    context: str,
) -> Bar:
    if len(row) != 12:
        raise VG16Error(f"{context} does not have 12 kline fields")
    open_us, open_dt = parse_timestamp_us(row[0], field_name="openTime")
    close_us, _close_dt = parse_timestamp_us(row[6], field_name="closeTime")
    if open_dt.time() != datetime.min.time() or open_dt.tzinfo != UTC:
        raise VG16Error(f"{context} is not a UTC daily open")
    if close_us != open_us + 86_400_000_000 - 1:
        raise VG16Error(f"{context} close boundary is invalid")
    if open_dt.strftime("%Y-%m") != month:
        raise VG16Error(f"{context} lies outside its archive month")

    open_price = decimal_from_text(row[1], field_name="open", nonnegative=True)
    high = decimal_from_text(row[2], field_name="high", nonnegative=True)
    low = decimal_from_text(row[3], field_name="low", nonnegative=True)
    close = decimal_from_text(row[4], field_name="close", nonnegative=True)
    base_volume = decimal_from_text(row[5], field_name="baseVolume", nonnegative=True)
    quote_volume = decimal_from_text(row[7], field_name="quoteVolume", nonnegative=True)
    taker_buy_base = decimal_from_text(row[9], field_name="takerBuyBaseVolume", nonnegative=True)
    taker_buy_quote = decimal_from_text(row[10], field_name="takerBuyQuoteVolume", nonnegative=True)
    decimal_from_text(row[11], field_name="ignore", nonnegative=True)
    try:
        trade_count = int(row[8])
    except ValueError as error:
        raise VG16Error(f"{context} trade count is not an integer") from error
    if trade_count < 0 or taker_buy_base > base_volume or taker_buy_quote > quote_volume:
        raise VG16Error(f"{context} has invalid trade or taker-volume fields")
    if open_price <= 0 or high <= 0 or low <= 0 or close <= 0:
        raise VG16Error(f"{context} has a non-positive price")
    if high < max(open_price, close, low) or low > min(open_price, close, high):
        raise VG16Error(f"{context} violates OHLC geometry")
    return Bar(
        symbol=symbol,
        day=open_dt.date(),
        open=open_price,
        high=high,
        low=low,
        close=close,
        quote_volume=quote_volume,
        open_time_us=open_us,
        close_time_us=close_us,
        raw_fields=row,
        decoded_fields_sha256=canonical_sha(list(row)),
    )


def parse_archive(
    artifact: Mapping[str, Any],
) -> tuple[tuple[Bar, ...], tuple[dict[str, object], ...]]:
    symbol = str(artifact["symbol"])
    month = str(artifact["month"])
    zip_path = SOURCE_ROOT / str(artifact["zipPath"])
    checksum_path = SOURCE_ROOT / str(artifact["checksumPath"])
    for path in (zip_path, checksum_path):
        require_regular_file(path)
    if sha256_path(zip_path) != artifact["zipSha256"]:
        raise VG16Error(f"{zip_path} changed after freeze")
    if sha256_path(checksum_path) != artifact["checksumSha256"]:
        raise VG16Error(f"{checksum_path} changed after freeze")
    verify_checksum_text(checksum_path.read_bytes(), zip_path.name, str(artifact["zipSha256"]))
    if zip_path.stat().st_size > 10_000_000:
        raise VG16Error(f"{zip_path} exceeds the frozen parser bound")

    bars: list[Bar] = []
    duplicates: list[dict[str, object]] = []
    seen: dict[int, tuple[tuple[str, ...], int, str]] = {}
    decoded_field_hashes: list[str] = []
    with zipfile.ZipFile(zip_path) as archive:
        members = archive.infolist()
        if len(members) != 1 or members[0].is_dir():
            raise VG16Error(f"{zip_path} must contain exactly one regular member")
        member = members[0]
        expected_member = zip_path.name.removesuffix(".zip") + ".csv"
        if member.filename != expected_member or member.file_size > 20_000_000:
            raise VG16Error(f"{zip_path} member identity or size is invalid")
        with archive.open(member, "r") as raw:
            wrapper = io.TextIOWrapper(raw, encoding="utf-8", newline="")
            reader = csv.reader(wrapper)
            for row_number, raw_row in enumerate(reader, start=1):
                row = tuple(raw_row)
                if row_number == 1 and row == KLINE_HEADER:
                    continue
                bar = parse_kline_row(
                    symbol,
                    month,
                    row,
                    context=f"{zip_path}:{row_number}",
                )
                decoded_field_hashes.append(bar.decoded_fields_sha256)
                previous = seen.get(bar.open_time_us)
                if previous is not None:
                    previous_fields, previous_row_number, previous_sha = previous
                    if previous_fields != row:
                        raise VG16Error(f"CONFLICTING_DUPLICATE:{symbol}:{bar.day.isoformat()}")
                    if previous_row_number != row_number - 1:
                        raise VG16Error(f"NON_ADJACENT_DUPLICATE:{symbol}:{bar.day.isoformat()}")
                    duplicates.append(
                        {
                            "canonicalRowNumber": previous_row_number,
                            "duplicateRowNumber": row_number,
                            "month": month,
                            "openTimeUs": str(bar.open_time_us),
                            "decodedFieldsSha256": previous_sha,
                            "symbol": symbol,
                        }
                    )
                    continue
                seen[bar.open_time_us] = (
                    row,
                    row_number,
                    bar.decoded_fields_sha256,
                )
                bars.append(bar)
    if not 1 <= len(bars) <= 31:
        raise VG16Error(f"{zip_path} canonical daily row count is outside 1..31")
    days = tuple(bar.day for bar in bars)
    if days != tuple(sorted(days)) or len(days) != len(set(days)):
        raise VG16Error(f"{zip_path} canonical daily rows are duplicate or unsorted")
    if duplicates:
        raw_to_canonical = {
            "canonicalDecodedFieldsSequenceSha256": canonical_sha(
                [bar.decoded_fields_sha256 for bar in bars]
            ),
            "rawDecodedFieldsSequenceSha256": canonical_sha(decoded_field_hashes),
        }
        for duplicate in duplicates:
            duplicate["rawToCanonicalDigest"] = canonical_sha(raw_to_canonical)
    return tuple(bars), tuple(duplicates)


def load_bars(
    source_manifest: Mapping[str, Any],
    allowed_months: frozenset[str],
    existing: LoadedBars | None = None,
) -> LoadedBars:
    loaded = {
        symbol: dict(rows)
        for symbol, rows in (existing.bars.items() if existing is not None else ())
    }
    duplicate_rows = list(existing.duplicate_rows if existing is not None else ())
    raw_artifacts = source_manifest.get("artifacts")
    if not isinstance(raw_artifacts, list):
        raise VG16Error("source manifest artifacts is invalid")
    for raw_artifact in raw_artifacts:
        if not isinstance(raw_artifact, dict):
            raise VG16Error("source manifest artifact is invalid")
        if str(raw_artifact.get("month")) not in allowed_months:
            continue
        bars, duplicates = parse_archive(cast(Mapping[str, Any], raw_artifact))
        duplicate_rows.extend(duplicates)
        for bar in bars:
            by_day = loaded.setdefault(bar.symbol, {})
            if bar.day in by_day:
                raise VG16Error(f"CROSS_ARCHIVE_DUPLICATE:{bar.symbol}:{bar.day.isoformat()}")
            by_day[bar.day] = bar
    return LoadedBars(loaded, tuple(duplicate_rows))


def consecutive_symbol_bars(
    symbol_bars: Mapping[date, Bar],
    end_inclusive: date,
    count: int,
) -> tuple[Bar, ...] | None:
    days = tuple(end_inclusive - timedelta(days=offset) for offset in range(count - 1, -1, -1))
    if any(day not in symbol_bars for day in days):
        return None
    return tuple(symbol_bars[day] for day in days)


def concentration_feature(
    bars: Mapping[str, Mapping[date, Bar]],
    decision_day: date,
) -> ConcentrationFeature | None:
    eligible: list[tuple[str, tuple[Bar, ...]]] = []
    for symbol in sorted(bars, key=symbol_sort_key):
        history = consecutive_symbol_bars(bars[symbol], decision_day, 31)
        if history is None:
            continue
        prior_median = median_decimal(tuple(bar.quote_volume for bar in history[:-1]))
        if prior_median >= MIN_MEDIAN_DAILY_QUOTE_VOLUME:
            eligible.append((symbol, history))
    if len(eligible) < MIN_RISK_SET_SIZE:
        return None
    current_total = sum((history[-1].quote_volume for _, history in eligible), Decimal(0))
    prior_total = sum((history[-2].quote_volume for _, history in eligible), Decimal(0))
    if current_total <= 0 or prior_total <= 0:
        return None
    contributions: list[tuple[str, Decimal]] = []
    delta_hhi = Decimal(0)
    for symbol, history in eligible:
        current_share = history[-1].quote_volume / current_total
        prior_share = history[-2].quote_volume / prior_total
        contribution = current_share * current_share - prior_share * prior_share
        delta_hhi += contribution
        if contribution > 0:
            contributions.append((symbol, contribution))
    contributions.sort(key=lambda item: (-item[1], symbol_sort_key(item[0])))
    risk_set = [symbol for symbol, _history in eligible]
    return ConcentrationFeature(
        decision_day=decision_day,
        delta_hhi=delta_hhi,
        risk_set_size=len(eligible),
        positive_contributions=tuple(contributions),
        risk_set_sha256=canonical_sha(risk_set),
    )


def build_features(
    bars: Mapping[str, Mapping[date, Bar]],
    end_exclusive: date,
) -> dict[date, ConcentrationFeature | None]:
    return {
        day: concentration_feature(bars, day) for day in date_range(FEATURE_START, end_exclusive)
    }


def signal_for_day(
    features: Mapping[date, ConcentrationFeature | None],
    trial: Trial,
    decision_day: date,
) -> CohortSignal | None:
    current = features.get(decision_day)
    if current is None:
        raise VG16Error(f"REQUIRED_CONCENTRATION_FEATURE_MISSING:{decision_day.isoformat()}")
    prior_days = tuple(
        decision_day - timedelta(days=offset) for offset in range(trial.history_days, 0, -1)
    )
    prior_features = tuple(features.get(day) for day in prior_days)
    for prior_day, prior_feature in zip(prior_days, prior_features, strict=True):
        if prior_feature is None:
            raise VG16Error(f"REQUIRED_CONCENTRATION_FEATURE_MISSING:{prior_day.isoformat()}")
    prior_values = tuple(
        cast(ConcentrationFeature, feature).delta_hhi for feature in prior_features
    )
    center = median_decimal(prior_values)
    mad = median_decimal(tuple(abs(value - center) for value in prior_values))
    if current.delta_hhi <= 0:
        return None
    if mad <= 0:
        raise VG16Error(f"REQUIRED_ROBUST_SCALE_ZERO:{decision_day.isoformat()}")
    robust_z = (current.delta_hhi - center) / (ROBUST_MAD_SCALE * mad)
    if robust_z < trial.z_floor:
        return None
    if len(current.positive_contributions) < trial.cohort_size:
        return None
    symbols = tuple(
        symbol for symbol, _value in current.positive_contributions[: trial.cohort_size]
    )
    return CohortSignal(
        decision_day=decision_day,
        symbols=symbols,
        delta_hhi=current.delta_hhi,
        robust_z=robust_z,
        risk_set_size=current.risk_set_size,
    )


def capacity_symbol_proxy(
    symbol_bars: Mapping[date, Bar],
    prior_complete_day: date,
    participation: Decimal,
) -> Decimal:
    history = consecutive_symbol_bars(symbol_bars, prior_complete_day, 7)
    if history is None:
        raise VG16Error(f"REQUIRED_CAPACITY_HISTORY_MISSING:{prior_complete_day.isoformat()}")
    reference = min(
        symbol_bars[prior_complete_day].quote_volume,
        median_decimal(tuple(bar.quote_volume for bar in history)),
    )
    return reference * participation


def cohort_capacity_proxy(
    bars: Mapping[str, Mapping[date, Bar]],
    symbols: Sequence[str],
    prior_complete_day: date,
    participation: Decimal,
) -> Decimal:
    if not symbols:
        raise VG16Error("capacity requires a cohort")
    per_symbol = tuple(
        capacity_symbol_proxy(bars[symbol], prior_complete_day, participation) for symbol in symbols
    )
    return Decimal(len(symbols)) * min(per_symbol)


def enter_scenario(
    state: ScenarioState,
    symbols: Sequence[str],
    entry_prices: Mapping[str, Decimal],
    *,
    fee: Decimal,
    adverse: Decimal,
) -> Decimal:
    if state.quantities:
        raise VG16Error("scenario tried to enter while already long")
    invest = min(state.cash, USDT_1000)
    if invest <= 0:
        raise VG16Error("scenario has no positive cash")
    state.surplus = state.cash - invest
    allocation = invest / Decimal(len(symbols))
    state.quantities = {
        symbol: allocation / (entry_prices[symbol] * (Decimal(1) + adverse)) * (Decimal(1) - fee)
        for symbol in symbols
    }
    state.cash = state.surplus
    return invest


def exit_scenario(
    state: ScenarioState,
    exit_prices: Mapping[str, Decimal],
    *,
    fee: Decimal,
    adverse: Decimal,
) -> Decimal:
    if not state.quantities:
        raise VG16Error("scenario tried to exit while flat")
    proceeds = sum(
        (
            quantity * exit_prices[symbol] * (Decimal(1) - adverse) * (Decimal(1) - fee)
            for symbol, quantity in state.quantities.items()
        ),
        Decimal(0),
    )
    state.cash = state.surplus + proceeds
    state.surplus = Decimal(0)
    state.quantities.clear()
    return state.cash


def mark_scenario(
    state: ScenarioState,
    close_prices: Mapping[str, Decimal],
    *,
    fee: Decimal,
    adverse: Decimal,
) -> Decimal:
    if not state.quantities:
        return state.cash
    liquidation = sum(
        (
            quantity * close_prices[symbol] * (Decimal(1) - adverse) * (Decimal(1) - fee)
            for symbol, quantity in state.quantities.items()
        ),
        Decimal(0),
    )
    return state.surplus + liquidation


def allocation_attribution(
    notional: Decimal,
    entry_price: Decimal,
    exit_price: Decimal,
) -> tuple[Decimal, Decimal, Decimal, Decimal, Decimal, Decimal, Decimal, Decimal]:
    gross_out = notional / entry_price * exit_price
    after_entry_fee = notional / entry_price * (Decimal(1) - PUBLIC_FEE) * exit_price
    after_exit_fee = after_entry_fee * (Decimal(1) - PUBLIC_FEE)
    after_entry_adverse = (
        notional
        / (entry_price * (Decimal(1) + BASE_ADVERSE))
        * (Decimal(1) - PUBLIC_FEE)
        * exit_price
        * (Decimal(1) - PUBLIC_FEE)
    )
    base_out = after_entry_adverse * (Decimal(1) - BASE_ADVERSE)
    stress_out = (
        notional
        / (entry_price * (Decimal(1) + STRESS_ADVERSE))
        * (Decimal(1) - PUBLIC_FEE)
        * exit_price
        * (Decimal(1) - STRESS_ADVERSE)
        * (Decimal(1) - PUBLIC_FEE)
    )
    severe_out = (
        notional
        / (entry_price * (Decimal(1) + SEVERE_ADVERSE))
        * (Decimal(1) - PUBLIC_FEE)
        * exit_price
        * (Decimal(1) - SEVERE_ADVERSE)
        * (Decimal(1) - PUBLIC_FEE)
    )
    return (
        gross_out - notional,
        gross_out - after_entry_fee,
        after_entry_fee - after_exit_fee,
        after_exit_fee - after_entry_adverse,
        after_entry_adverse - base_out,
        base_out - notional,
        stress_out - notional,
        severe_out - notional,
    )


def trade_attribution(
    open_cohort: OpenCohort,
    exit_day: date,
    exit_prices: Mapping[str, Decimal],
    exit_capacity_base: Decimal,
    exit_capacity_stress: Decimal,
) -> CohortTrade:
    notional = open_cohort.entry_notional_by_scenario["base"]
    allocation = notional / Decimal(len(open_cohort.signal.symbols))
    rows = tuple(
        allocation_attribution(
            allocation,
            open_cohort.entry_prices[symbol],
            exit_prices[symbol],
        )
        for symbol in open_cohort.signal.symbols
    )
    return CohortTrade(
        symbols=open_cohort.signal.symbols,
        decision_day=open_cohort.signal.decision_day,
        entry_day=open_cohort.entry_day,
        exit_day=exit_day,
        entry_notional_usdt=notional,
        reference_gross_pnl_usdt=sum((row[0] for row in rows), Decimal(0)),
        entry_fee_cost_usdt=sum((row[1] for row in rows), Decimal(0)),
        exit_fee_cost_usdt=sum((row[2] for row in rows), Decimal(0)),
        entry_adverse_cost_usdt=sum((row[3] for row in rows), Decimal(0)),
        exit_adverse_cost_usdt=sum((row[4] for row in rows), Decimal(0)),
        base_net_pnl_usdt=sum((row[5] for row in rows), Decimal(0)),
        stress_net_pnl_usdt=sum((row[6] for row in rows), Decimal(0)),
        severe_net_pnl_usdt=sum((row[7] for row in rows), Decimal(0)),
        base_capacity_proxy_usdt=min(
            open_cohort.entry_capacity_base_usdt,
            exit_capacity_base,
        ),
        stress_capacity_proxy_usdt=min(
            open_cohort.entry_capacity_stress_usdt,
            exit_capacity_stress,
        ),
    )


def simulate_period(
    bars: Mapping[str, Mapping[date, Bar]],
    features: Mapping[date, ConcentrationFeature | None],
    trial: Trial,
    start: date,
    end_exclusive: date,
) -> Simulation:
    days = date_range(start, end_exclusive)
    states = {
        "gross": ScenarioState(USDT_1000),
        "base": ScenarioState(USDT_1000),
        "stress": ScenarioState(USDT_1000),
        "severe": ScenarioState(USDT_1000),
    }
    costs = {
        "gross": (Decimal(0), Decimal(0)),
        "base": (PUBLIC_FEE, BASE_ADVERSE),
        "stress": (PUBLIC_FEE, STRESS_ADVERSE),
        "severe": (PUBLIC_FEE, SEVERE_ADVERSE),
    }
    previous_values = dict.fromkeys(states, USDT_1000)
    daily: dict[str, list[Decimal]] = {name: [] for name in states}
    nav: dict[str, list[Decimal]] = {"base": [], "stress": []}
    drawdown_nav: dict[str, list[Decimal]] = {
        "base": [USDT_1000],
        "stress": [USDT_1000],
    }
    log_returns: list[Decimal] = []
    open_cohort: OpenCohort | None = None
    trades: list[CohortTrade] = []
    cash_day_count = 0
    active_signal_count = 0

    for current_day in days:
        if open_cohort is not None:
            exit_prices: dict[str, Decimal] = {}
            for symbol in open_cohort.signal.symbols:
                exit_bar = bars[symbol].get(current_day)
                if exit_bar is None:
                    raise VG16Error(
                        f"REQUIRED_COHORT_EXIT_BAR_MISSING:{symbol}:{current_day.isoformat()}"
                    )
                exit_prices[symbol] = exit_bar.open
            for name, state in states.items():
                fee, adverse = costs[name]
                exit_scenario(state, exit_prices, fee=fee, adverse=adverse)
            for name in ("base", "stress"):
                drawdown_nav[name].append(states[name].cash)
            exit_capacity_base = cohort_capacity_proxy(
                bars,
                open_cohort.signal.symbols,
                current_day - timedelta(days=1),
                BASE_CAPACITY_PARTICIPATION,
            )
            exit_capacity_stress = cohort_capacity_proxy(
                bars,
                open_cohort.signal.symbols,
                current_day - timedelta(days=1),
                STRESS_CAPACITY_PARTICIPATION,
            )
            trades.append(
                trade_attribution(
                    open_cohort,
                    current_day,
                    exit_prices,
                    exit_capacity_base,
                    exit_capacity_stress,
                )
            )
            open_cohort = None

        if current_day + timedelta(days=1) < end_exclusive:
            signal = signal_for_day(features, trial, current_day - timedelta(days=1))
            if signal is not None:
                active_signal_count += 1
                entry_prices: dict[str, Decimal] = {}
                for symbol in signal.symbols:
                    entry_bar = bars[symbol].get(current_day)
                    if entry_bar is None:
                        raise VG16Error(
                            f"REQUIRED_SELECTED_ENTRY_BAR_MISSING:{symbol}:{current_day.isoformat()}"
                        )
                    entry_prices[symbol] = entry_bar.open
                entry_capacity_base = cohort_capacity_proxy(
                    bars,
                    signal.symbols,
                    current_day - timedelta(days=1),
                    BASE_CAPACITY_PARTICIPATION,
                )
                entry_capacity_stress = cohort_capacity_proxy(
                    bars,
                    signal.symbols,
                    current_day - timedelta(days=1),
                    STRESS_CAPACITY_PARTICIPATION,
                )
                notionals: dict[str, Decimal] = {}
                for name, state in states.items():
                    fee, adverse = costs[name]
                    notionals[name] = enter_scenario(
                        state,
                        signal.symbols,
                        entry_prices,
                        fee=fee,
                        adverse=adverse,
                    )
                open_cohort = OpenCohort(
                    signal=signal,
                    entry_day=current_day,
                    entry_prices=entry_prices,
                    entry_notional_by_scenario=notionals,
                    entry_capacity_base_usdt=entry_capacity_base,
                    entry_capacity_stress_usdt=entry_capacity_stress,
                )
                for name in ("base", "stress"):
                    fee, adverse = costs[name]
                    drawdown_nav[name].append(
                        mark_scenario(
                            states[name],
                            entry_prices,
                            fee=fee,
                            adverse=adverse,
                        )
                    )

        if open_cohort is None:
            cash_day_count += 1
            values = {name: state.cash for name, state in states.items()}
        else:
            close_prices: dict[str, Decimal] = {}
            for symbol in open_cohort.signal.symbols:
                mark_bar = bars[symbol].get(current_day)
                if mark_bar is None:
                    raise VG16Error(
                        f"REQUIRED_COHORT_MARK_BAR_MISSING:{symbol}:{current_day.isoformat()}"
                    )
                close_prices[symbol] = mark_bar.close
            values = {
                name: mark_scenario(state, close_prices, fee=fee, adverse=adverse)
                for name, state in states.items()
                for fee, adverse in (costs[name],)
            }

        prior_base = previous_values["base"]
        for name, value in values.items():
            daily[name].append(value - previous_values[name])
            previous_values[name] = value
        if prior_base <= 0 or values["base"] <= 0:
            raise VG16Error("NON_POSITIVE_NAV_PREVENTS_LOG_RETURN")
        log_returns.append((values["base"] / prior_base).ln())
        nav["base"].append(values["base"])
        nav["stress"].append(values["stress"])
        drawdown_nav["base"].append(values["base"])
        drawdown_nav["stress"].append(values["stress"])

    if open_cohort is not None or any(state.quantities for state in states.values()):
        raise VG16Error("period ended with an open cohort")
    return Simulation(
        trial_id=trial.trial_id,
        days=days,
        gross_daily_usdt=tuple(daily["gross"]),
        base_daily_usdt=tuple(daily["base"]),
        stress_daily_usdt=tuple(daily["stress"]),
        severe_daily_usdt=tuple(daily["severe"]),
        base_nav=tuple(nav["base"]),
        stress_nav=tuple(nav["stress"]),
        base_drawdown_nav=tuple(drawdown_nav["base"]),
        stress_drawdown_nav=tuple(drawdown_nav["stress"]),
        base_log_returns=tuple(log_returns),
        trades=tuple(trades),
        cash_day_count=cash_day_count,
        active_signal_count=active_signal_count,
    )


def decimal_ratio(value: Decimal) -> ExactRatioV1:
    numerator, denominator = value.as_integer_ratio()
    return make_ratio(numerator, denominator)


def mean_decimal(values: Sequence[Decimal]) -> Decimal:
    if not values:
        raise VG16Error("mean requires values")
    return sum(values, Decimal(0)) / len(values)


def bootstrap_interval_mapping(
    values: Sequence[Decimal],
    *,
    block_length: int,
    seed: int,
) -> dict[str, object]:
    report = block_bootstrap_interval(
        tuple(decimal_ratio(value) for value in values),
        BootstrapSpecV1(
            seed=seed,
            block_length=block_length,
            replicates=BOOTSTRAP_REPLICATES,
            coverage_per_myriad=BOOTSTRAP_COVERAGE_PER_MYRIAD,
        ),
    )
    mapping = report.as_mapping()
    mapping["blockLengthDays"] = block_length
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


def family_bootstrap_inference(
    rows: Sequence[Sequence[Decimal]],
    *,
    seed: int = BOOTSTRAP_SEED,
    block_length: int = 7,
    replicates: int = BOOTSTRAP_REPLICATES,
) -> tuple[tuple[ExactRatioV1, ...], ExactRatioV1]:
    if not rows:
        raise VG16Error("bootstrap family is empty")
    count = len(rows[0])
    if count < block_length or any(len(row) != count for row in rows):
        raise VG16Error("bootstrap family paths are short or misaligned")
    observed = tuple(mean_decimal(row) for row in rows)
    centered = tuple(
        tuple(value - observed[index] for value in row) for index, row in enumerate(rows)
    )
    exceedances = [0 for _ in rows]
    reality_check_exceedances = 0
    observed_maximum = max(observed)
    blocks_needed = math.ceil(count / block_length)
    rng = DeterministicRandom.from_seed(seed)
    for _ in range(replicates):
        indices: list[int] = []
        for _ in range(blocks_needed):
            start = rng.next_u64() % count
            indices.extend((start + offset) % count for offset in range(block_length))
        indices = indices[:count]
        replicate_means = tuple(
            sum((row[index] for index in indices), Decimal(0)) / count for row in centered
        )
        for row_index, replicate_mean in enumerate(replicate_means):
            if replicate_mean >= observed[row_index]:
                exceedances[row_index] += 1
        if max(replicate_means) >= observed_maximum:
            reality_check_exceedances += 1
    p_values = tuple(make_ratio(exceedance + 1, replicates + 1) for exceedance in exceedances)
    return p_values, make_ratio(reality_check_exceedances + 1, replicates + 1)


def maximum_drawdown(nav: Sequence[Decimal]) -> Decimal:
    peak = USDT_1000
    maximum = Decimal(0)
    for value in nav:
        if value > peak:
            peak = value
        if peak > 0:
            maximum = max(maximum, (peak - value) / peak)
    return maximum


def ratio_decimal(value: ExactRatioV1) -> Decimal:
    return Decimal(value.numerator) / Decimal(value.denominator)


def simulation_metrics(simulation: Simulation) -> dict[str, object]:
    interval_7 = bootstrap_interval_mapping(
        simulation.base_daily_usdt,
        block_length=7,
        seed=BOOTSTRAP_SEED,
    )
    interval_14 = bootstrap_interval_mapping(
        simulation.base_daily_usdt,
        block_length=14,
        seed=BOOTSTRAP_SEED + 1,
    )
    lower_7 = interval_lower(interval_7)
    lower_14 = interval_lower(interval_14)
    active_months = sorted({month_of(trade.exit_day) for trade in simulation.trades})
    distinct_symbols = sorted(
        {symbol for trade in simulation.trades for symbol in trade.symbols},
        key=symbol_sort_key,
    )
    stress_months: dict[str, Decimal] = {}
    for day, value in zip(simulation.days, simulation.stress_daily_usdt, strict=True):
        key = month_of(day)
        stress_months[key] = stress_months.get(key, Decimal(0)) + value
    positive_stress_months = sum(value > 0 for value in stress_months.values())
    capacities_base = tuple(trade.base_capacity_proxy_usdt for trade in simulation.trades)
    capacities_stress = tuple(trade.stress_capacity_proxy_usdt for trade in simulation.trades)

    reference_gross = sum(
        (trade.reference_gross_pnl_usdt for trade in simulation.trades),
        Decimal(0),
    )
    entry_fee = sum((trade.entry_fee_cost_usdt for trade in simulation.trades), Decimal(0))
    exit_fee = sum((trade.exit_fee_cost_usdt for trade in simulation.trades), Decimal(0))
    entry_adverse = sum(
        (trade.entry_adverse_cost_usdt for trade in simulation.trades),
        Decimal(0),
    )
    exit_adverse = sum(
        (trade.exit_adverse_cost_usdt for trade in simulation.trades),
        Decimal(0),
    )
    attributed_base = sum((trade.base_net_pnl_usdt for trade in simulation.trades), Decimal(0))
    reconciled = reference_gross - entry_fee - exit_fee - entry_adverse - exit_adverse
    reconciliation_error = attributed_base - reconciled
    if abs(reconciliation_error) > Decimal("1E-30"):
        raise VG16Error("COST_DECOMPOSITION_DOES_NOT_RECONCILE")
    base_total = sum(simulation.base_daily_usdt, Decimal(0))
    if abs(base_total - attributed_base) > Decimal("1E-24"):
        raise VG16Error("DAILY_BASE_PATH_DOES_NOT_RECONCILE_TO_TRADES")

    return {
        "activeCalendarMonthCount": len(active_months),
        "activeCalendarMonths": active_months,
        "activeSignalCount": simulation.active_signal_count,
        "baseNetMeanUsdtPerDayPer1000": decimal_text(mean_decimal(simulation.base_daily_usdt)),
        "baseNetOneSided95Lcb14DayUsdtPerDayPer1000": (
            None if lower_14 is None else decimal_text(lower_14)
        ),
        "baseNetOneSided95Lcb7DayUsdtPerDayPer1000": (
            None if lower_7 is None else decimal_text(lower_7)
        ),
        "baseNetTotalUsdtPer1000": decimal_text(base_total),
        "bootstrap14Day": interval_14,
        "bootstrap7Day": interval_7,
        "cashDayCount": simulation.cash_day_count,
        "closedCohortRoundTripCount": len(simulation.trades),
        "costDecomposition": {
            "baseNetPnlUsdt": decimal_text(attributed_base),
            "entryAdversePriceCostUsdt": decimal_text(entry_adverse),
            "entryFeeCostUsdt": decimal_text(entry_fee),
            "exitAdversePriceCostUsdt": decimal_text(exit_adverse),
            "exitFeeCostUsdt": decimal_text(exit_fee),
            "reconciliationErrorUsdt": decimal_text(reconciliation_error),
            "referenceGrossPnlUsdt": decimal_text(reference_gross),
        },
        "distinctHeldSymbolCount": len(distinct_symbols),
        "grossScenarioNetTotalUsdtPer1000": decimal_text(
            sum(simulation.gross_daily_usdt, Decimal(0))
        ),
        "heldSymbolSetSha256": canonical_sha(distinct_symbols),
        "drawdownObservationCount": len(simulation.base_drawdown_nav),
        "maximumBaseDrawdownFraction": decimal_text(maximum_drawdown(simulation.base_drawdown_nav)),
        "maximumStressDrawdownFraction": decimal_text(
            maximum_drawdown(simulation.stress_drawdown_nav)
        ),
        "minimumBasePublicCapacityProxyUsdt": (
            None if not capacities_base else decimal_text(min(capacities_base))
        ),
        "minimumStressPublicCapacityProxyUsdt": (
            None if not capacities_stress else decimal_text(min(capacities_stress))
        ),
        "observationDayCount": len(simulation.days),
        "positiveStressCalendarMonthCount": positive_stress_months,
        "severeNetMeanUsdtPerDayPer1000": decimal_text(mean_decimal(simulation.severe_daily_usdt)),
        "severeNetTotalUsdtPer1000": decimal_text(sum(simulation.severe_daily_usdt, Decimal(0))),
        "stressNetMeanUsdtPerDayPer1000": decimal_text(mean_decimal(simulation.stress_daily_usdt)),
        "stressNetTotalUsdtPer1000": decimal_text(sum(simulation.stress_daily_usdt, Decimal(0))),
        "turnoverMultipleOf1000": decimal_text(
            sum(
                (trade.entry_notional_usdt * Decimal(2) for trade in simulation.trades),
                Decimal(0),
            )
            / USDT_1000
        ),
    }


def trial_ledger() -> TrialLedgerV1:
    return TrialLedgerV1(
        trials=tuple(
            TrialRecordV1(
                trial_id=trial.trial_id,
                family_id="vg16-lagged-quote-volume-concentration-change-v1",
                model_id=trial.trial_id,
                metric_id="base-net-usdt-per-1000-per-day",
                status=TrialStatus.COMPLETED,
                note="predeclared HHI-contribution cohort-or-cash trial",
            )
            for trial in trial_grid()
        )
    )


def pbo_mapping(simulations: Sequence[Simulation]) -> dict[str, object]:
    if any(len(simulation.base_daily_usdt) != 120 for simulation in simulations):
        raise VG16Error("PBO requires twelve aligned ten-day blocks")
    matrix = tuple(
        tuple(
            decimal_ratio(sum(simulation.base_daily_usdt[offset : offset + 10], Decimal(0)))
            for offset in range(0, 120, 10)
        )
        for simulation in simulations
    )
    distinct = distinct_trial_count(matrix)
    report = pbo_cscv(matrix)
    mapping = report.as_mapping()
    mapping["blockCount"] = 12
    mapping["blockDays"] = 10
    mapping["cashDaysRetained"] = True
    mapping["distinctTrialPathCount"] = distinct
    mapping["holdoutTouched"] = False
    mapping["role"] = (
        "DEVELOPMENT_ONLY_DIAGNOSTIC; NEVER_SELECTION_HOLM_INTERVAL_VERDICT_OR_AUTHORITY"
    )
    return mapping


def holm_mapping(report: Any) -> dict[str, object]:
    return {
        "decisions": [
            {
                "effectivePValue": decision.effective_p_value.as_mapping(),
                "rawPValue": (
                    None if decision.raw_p_value is None else decision.raw_p_value.as_mapping()
                ),
                "selected": decision.selected,
                "threshold": decision.threshold.as_mapping(),
                "trialId": decision.trial_id,
            }
            for decision in report.decisions
        ],
        "familywiseAlphaPerMyriad": report.familywise_alpha_per_myriad,
        "rejectedTrialIds": list(report.rejected_trial_ids),
        "testedCount": report.tested_count,
    }


def development_gate_reasons(
    metrics: Mapping[str, Any],
    *,
    holm_selected: bool,
    white_reality_check_p: Decimal,
) -> tuple[str, ...]:
    reasons: list[str] = []
    if int(metrics["observationDayCount"]) != 120:
        reasons.append("DEVELOPMENT_OBSERVATION_DAYS_NOT_120")
    if int(metrics["closedCohortRoundTripCount"]) < 20:
        reasons.append("DEVELOPMENT_COHORT_ROUND_TRIPS_BELOW_20")
    if int(metrics["distinctHeldSymbolCount"]) < 8:
        reasons.append("DEVELOPMENT_DISTINCT_SYMBOLS_BELOW_8")
    if int(metrics["activeCalendarMonthCount"]) < 3:
        reasons.append("DEVELOPMENT_ACTIVE_MONTHS_BELOW_3")
    if int(metrics["positiveStressCalendarMonthCount"]) < 3:
        reasons.append("DEVELOPMENT_POSITIVE_STRESS_MONTHS_BELOW_3")
    for key in (
        "baseNetOneSided95Lcb7DayUsdtPerDayPer1000",
        "baseNetOneSided95Lcb14DayUsdtPerDayPer1000",
    ):
        raw = metrics[key]
        if raw is None or Decimal(str(raw)) <= 0:
            reasons.append(f"DEVELOPMENT_{key.upper()}_NOT_POSITIVE")
    if Decimal(str(metrics["stressNetMeanUsdtPerDayPer1000"])) <= 0:
        reasons.append("DEVELOPMENT_STRESS_NET_MEAN_NOT_POSITIVE")
    if Decimal(str(metrics["maximumBaseDrawdownFraction"])) > MAX_DRAWDOWN:
        reasons.append("DEVELOPMENT_BASE_DRAWDOWN_ABOVE_20_PERCENT")
    if Decimal(str(metrics["maximumStressDrawdownFraction"])) > MAX_DRAWDOWN:
        reasons.append("DEVELOPMENT_STRESS_DRAWDOWN_ABOVE_20_PERCENT")
    for key in (
        "minimumBasePublicCapacityProxyUsdt",
        "minimumStressPublicCapacityProxyUsdt",
    ):
        raw = metrics[key]
        if raw is None or Decimal(str(raw)) < CAPACITY_GATE_USDT:
            reasons.append(f"DEVELOPMENT_{key.upper()}_BELOW_1000")
    if not holm_selected:
        reasons.append("DEVELOPMENT_HOLM_FAMILYWISE_GATE_FAILED")
    if white_reality_check_p >= WRC_ALPHA:
        reasons.append("DEVELOPMENT_WHITE_REALITY_CHECK_GATE_FAILED")
    return tuple(reasons)


def holdout_gate_reasons(metrics: Mapping[str, Any]) -> tuple[str, ...]:
    reasons: list[str] = []
    if int(metrics["observationDayCount"]) != 122:
        reasons.append("HOLDOUT_OBSERVATION_DAYS_NOT_122")
    if int(metrics["closedCohortRoundTripCount"]) < 10:
        reasons.append("HOLDOUT_COHORT_ROUND_TRIPS_BELOW_10")
    if int(metrics["distinctHeldSymbolCount"]) < 5:
        reasons.append("HOLDOUT_DISTINCT_SYMBOLS_BELOW_5")
    if int(metrics["activeCalendarMonthCount"]) < 3:
        reasons.append("HOLDOUT_ACTIVE_MONTHS_BELOW_3")
    for key in (
        "baseNetOneSided95Lcb7DayUsdtPerDayPer1000",
        "baseNetOneSided95Lcb14DayUsdtPerDayPer1000",
    ):
        raw = metrics[key]
        if raw is None or Decimal(str(raw)) <= 0:
            reasons.append(f"HOLDOUT_{key.upper()}_NOT_POSITIVE")
    if Decimal(str(metrics["stressNetMeanUsdtPerDayPer1000"])) <= 0:
        reasons.append("HOLDOUT_STRESS_NET_MEAN_NOT_POSITIVE")
    if Decimal(str(metrics["maximumBaseDrawdownFraction"])) > MAX_DRAWDOWN:
        reasons.append("HOLDOUT_BASE_DRAWDOWN_ABOVE_20_PERCENT")
    if Decimal(str(metrics["maximumStressDrawdownFraction"])) > MAX_DRAWDOWN:
        reasons.append("HOLDOUT_STRESS_DRAWDOWN_ABOVE_20_PERCENT")
    for key in (
        "minimumBasePublicCapacityProxyUsdt",
        "minimumStressPublicCapacityProxyUsdt",
    ):
        raw = metrics[key]
        if raw is None or Decimal(str(raw)) < CAPACITY_GATE_USDT:
            reasons.append(f"HOLDOUT_{key.upper()}_BELOW_1000")
    return tuple(reasons)


def candidate_row_rank_key(
    row: Mapping[str, Any],
) -> tuple[Decimal, Decimal, int, Decimal, int, str]:
    trial = cast(Mapping[str, Any], row["trial"])
    metrics = cast(Mapping[str, Any], row["metrics"])
    lower_values = [
        Decimal(str(metrics[key])) if metrics[key] is not None else Decimal("-1E100")
        for key in (
            "baseNetOneSided95Lcb7DayUsdtPerDayPer1000",
            "baseNetOneSided95Lcb14DayUsdtPerDayPer1000",
        )
    ]
    return (
        -min(lower_values),
        -Decimal(str(metrics["stressNetTotalUsdtPer1000"])),
        int(trial["cohortSize"]),
        -Decimal(str(trial["zFloor"])),
        -int(trial["historyDays"]),
        str(trial["trialId"]),
    )


def development_analysis(
    bars: Mapping[str, Mapping[date, Bar]],
    features: Mapping[date, ConcentrationFeature | None],
) -> tuple[
    list[dict[str, object]],
    Trial | None,
    Trial,
    dict[str, object],
    dict[str, object],
]:
    trials = trial_grid()
    simulations = tuple(
        simulate_period(
            bars,
            features,
            trial,
            DEVELOPMENT_START,
            DEVELOPMENT_END,
        )
        for trial in trials
    )
    p_values, white_reality_check = family_bootstrap_inference(
        tuple(simulation.base_daily_usdt for simulation in simulations)
    )
    ledger = trial_ledger()
    holm = holm_bonferroni(
        ledger,
        tuple((trial.trial_id, p_value) for trial, p_value in zip(trials, p_values, strict=True)),
        familywise_alpha_per_myriad=HOLM_ALPHA_PER_MYRIAD,
    )
    holm_selected = set(holm.rejected_trial_ids)
    white_p = ratio_decimal(white_reality_check)
    pbo = pbo_mapping(simulations)

    candidate_rows: list[dict[str, object]] = []
    for trial, simulation, p_value in zip(trials, simulations, p_values, strict=True):
        metrics = simulation_metrics(simulation)
        reasons = development_gate_reasons(
            metrics,
            holm_selected=trial.trial_id in holm_selected,
            white_reality_check_p=white_p,
        )
        candidate_rows.append(
            {
                "gatePass": not reasons,
                "gateReasons": list(reasons),
                "metrics": metrics,
                "rawOneSidedBootstrapPValue": p_value.as_mapping(),
                "trial": trial_mapping(trial),
            }
        )
    ranked_candidate_rows = sorted(candidate_rows, key=candidate_row_rank_key)
    trial_by_id = {trial.trial_id: trial for trial in trials}
    reporting_trial_id = str(cast(Mapping[str, Any], ranked_candidate_rows[0]["trial"])["trialId"])
    reporting_trial = trial_by_id[reporting_trial_id]
    qualifier_row = next(
        (row for row in ranked_candidate_rows if row["gatePass"] is True),
        None,
    )
    champion = (
        None
        if qualifier_row is None
        else trial_by_id[str(cast(Mapping[str, Any], qualifier_row["trial"])["trialId"])]
    )
    reporting_row = next(
        row
        for row in candidate_rows
        if cast(Mapping[str, Any], row["trial"])["trialId"] == reporting_trial.trial_id
    )
    inference: dict[str, object] = {
        "bootstrap": {
            "blockLengthsDays": [7, 14],
            "cashDaysRetained": True,
            "familyDrawsSharedForPValues": True,
            "replicates": BOOTSTRAP_REPLICATES,
            "seed": str(BOOTSTRAP_SEED),
        },
        "candidateRanking": {
            "law": (
                "HIGHEST_MINIMUM_BASE_7D_14D_LCB_THEN_HIGHER_STRESS_NET_THEN_FEWER_K_"
                "THEN_HIGHER_Z_FLOOR_THEN_LONGER_HISTORY_THEN_TRIAL_ID"
            ),
            "rankedTrialIds": [
                str(cast(Mapping[str, Any], row["trial"])["trialId"])
                for row in ranked_candidate_rows
            ],
        },
        "holm": holm_mapping(holm),
        "pbo": pbo,
        "trialLedger": ledger.as_mapping(),
        "whiteRealityCheck": {
            "familySize": len(trials),
            "pValue": white_reality_check.as_mapping(),
            "role": "DEVELOPMENT_FAMILY_MULTIPLICITY_GATE",
        },
    }
    return candidate_rows, champion, reporting_trial, reporting_row, inference


def validate_frozen_identity() -> tuple[dict[str, Any], dict[str, Any]]:
    for path in (
        FREEZE_PATH,
        SOURCE_MANIFEST_PATH,
        PROTOCOL_PATH,
        SOURCE_RESEARCH_PATH,
        README_PATH,
        INIT_PATH,
        TEST_PATH,
        Path(__file__),
    ):
        require_regular_file(path)
    freeze_receipt = load_json(FREEZE_PATH)
    if (
        freeze_receipt.get("schema") != "VG16PreOutcomeFreezeV1"
        or freeze_receipt.get("state") != "READY_FOR_SOLE_DECOMPRESSION_RUN"
        or freeze_receipt.get("baseCommit") != BASE_COMMIT
        or freeze_receipt.get("archiveBodiesDecompressed") is not False
        or freeze_receipt.get("pythonRuntime") != sys.version
    ):
        raise VG16Error("freeze receipt state is invalid")
    expected = {
        "dependencySha256": dependency_sha256_mapping(),
        "evaluatorSha256": sha256_path(Path(__file__)),
        "initSha256": sha256_path(INIT_PATH),
        "officialSourceResearchSha256": sha256_path(SOURCE_RESEARCH_PATH),
        "protocolSha256": sha256_path(PROTOCOL_PATH),
        "readmeSha256": sha256_path(README_PATH),
        "sourceManifestSha256": sha256_path(SOURCE_MANIFEST_PATH),
        "testSha256": sha256_path(TEST_PATH),
        "trialGridSha256": canonical_sha([trial_mapping(trial) for trial in trial_grid()]),
    }
    if expected["protocolSha256"] != PROTOCOL_SHA256:
        raise VG16Error("protocol differs from the evaluator-bound contract")
    for key, value in expected.items():
        if freeze_receipt.get(key) != value:
            raise VG16Error(f"freeze identity mismatch: {key}")
    source_manifest = load_json(SOURCE_MANIFEST_PATH)
    if (
        source_manifest.get("schema") != "VG16FrozenPublicSourceManifestV1"
        or source_manifest.get("state") != "CHECKSUM_VERIFIED_COMPRESSED_BYTES_NOT_OPENED_BY_VG16"
        or source_manifest.get("baseCommit") != BASE_COMMIT
        or source_manifest.get("archiveBodiesDecompressedDuringFreeze") is not False
    ):
        raise VG16Error("source manifest state is invalid")
    if source_manifest.get("protocolSha256") != expected["protocolSha256"]:
        raise VG16Error("source manifest protocol mismatch")
    return freeze_receipt, source_manifest


def consume_run_marker(freeze_receipt: Mapping[str, Any]) -> str:
    outcome_paths = (
        RUN_MARKER_PATH,
        CANDIDATE_SEAL_PATH,
        HOLDOUT_OPEN_PATH,
        RESULT_PATH,
        TERMINAL_PATH,
    )
    if any(path.exists() or path.is_symlink() for path in outcome_paths):
        raise VG16Error("the sole decompression run is already consumed")
    if git_output("status", "--porcelain"):
        raise VG16Error("run requires the committed freeze packet and a clean worktree")
    head = git_output("rev-parse", "HEAD")
    if git_output("rev-parse", "HEAD^") != BASE_COMMIT:
        raise VG16Error("freeze commit must be the sole direct child of the canonical base")
    require_exclusive_scope(changed_paths(BASE_COMMIT, head))
    tree = git_output("rev-parse", "HEAD^{tree}")
    marker = {
        "archiveDecompressionRunOrdinal": 1,
        "candidateSealPresentAtStart": False,
        "consumedAtUtc": utc_now(),
        "evaluatorSha256": freeze_receipt["evaluatorSha256"],
        "freezeSha256": sha256_path(FREEZE_PATH),
        "freezeCommit": head,
        "freezeTree": tree,
        "holdoutOpenedAtStart": False,
        "networkCallsAllowedAfterMarker": 0,
        "baseCommit": BASE_COMMIT,
        "protocolSha256": freeze_receipt["protocolSha256"],
        "schema": "VG16SoleRunMarkerV1",
        "sourceManifestSha256": freeze_receipt["sourceManifestSha256"],
        "state": "SOLE_ARCHIVE_DECOMPRESSION_RUN_CONSUMED",
    }
    write_json_once(RUN_MARKER_PATH, marker)
    return sha256_path(RUN_MARKER_PATH)


def candidate_seal(
    champion: Trial,
    champion_row: Mapping[str, Any],
    candidate_rows: Sequence[Mapping[str, Any]],
    inference: Mapping[str, Any],
    marker_sha: str,
) -> dict[str, object]:
    validated_rows, qualified_id = validate_candidate_family(
        list(candidate_rows),
        dict(inference),
        champion.trial_id,
    )
    validated_champion_row = next(
        row
        for row in validated_rows
        if cast(Mapping[str, Any], row["trial"])["trialId"] == champion.trial_id
    )
    if (
        qualified_id != champion.trial_id
        or champion_row.get("gatePass") is not True
        or dict(champion_row) != validated_champion_row
    ):
        raise VG16Error("candidate seal requires the first ranked development gate pass")
    development_evidence = {
        "candidateCount": len(validated_rows),
        "candidates": validated_rows,
        "inference": dict(inference),
        "qualifiedChampionTrialId": champion.trial_id,
    }
    seal = {
        "candidate": trial_mapping(champion),
        "candidateRowSha256": canonical_sha(champion_row),
        "createdAtUtc": utc_now(),
        "developmentEvidence": development_evidence,
        "developmentEvidenceSha256": canonical_sha(development_evidence),
        "evaluatorSha256": sha256_path(Path(__file__)),
        "freezeSha256": sha256_path(FREEZE_PATH),
        "holdoutOpened": False,
        "protocolSha256": sha256_path(PROTOCOL_PATH),
        "runMarkerSha256": marker_sha,
        "schema": "VG16DevelopmentChampionSealV1",
        "sourceManifestSha256": sha256_path(SOURCE_MANIFEST_PATH),
        "state": "DEVELOPMENT_GATES_PASS_CHAMPION_FROZEN",
    }
    write_json_once(CANDIDATE_SEAL_PATH, seal)
    return seal


def open_holdout_once(champion: Trial) -> dict[str, object]:
    if not CANDIDATE_SEAL_PATH.is_file() or CANDIDATE_SEAL_PATH.is_symlink():
        raise VG16Error("candidate seal is required before holdout open")
    if HOLDOUT_OPEN_PATH.exists():
        raise VG16Error("holdout open is already consumed")
    seal = load_json(CANDIDATE_SEAL_PATH)
    candidate = seal.get("candidate")
    if (
        seal.get("state") != "DEVELOPMENT_GATES_PASS_CHAMPION_FROZEN"
        or not isinstance(candidate, dict)
        or candidate.get("trialId") != champion.trial_id
    ):
        raise VG16Error("candidate seal identity is invalid")
    receipt = {
        "candidateSealSha256": sha256_path(CANDIDATE_SEAL_PATH),
        "championTrialId": champion.trial_id,
        "holdoutArchiveMonths": list(HOLDOUT_MONTHS),
        "holdoutEndExclusiveUtc": EVALUATION_END.isoformat(),
        "holdoutOpenOrdinal": 1,
        "holdoutStartUtc": HOLDOUT_START.isoformat(),
        "openedAtUtc": utc_now(),
        "schema": "VG16HoldoutOpenOnceV1",
        "state": "HOLDOUT_OPENED_ONCE_FOR_FROZEN_CHAMPION",
    }
    write_json_once(HOLDOUT_OPEN_PATH, receipt)
    return receipt


def duplicate_summary(duplicate_rows: Sequence[Mapping[str, object]]) -> dict[str, object]:
    rows = [dict(row) for row in duplicate_rows]
    return {
        "canonicalizationRule": (
            "ADJACENT_IDENTICAL_SAME_SYMBOL_SAME_OPEN_TIME_ALL_12_FIELDS_COLLAPSE_TO_ONE"
        ),
        "duplicateRowCount": len(rows),
        "duplicateRows": rows,
        "duplicateRowsSha256": canonical_sha(rows),
        "extraCoverageGranted": False,
    }


def base_result_envelope(
    *,
    marker_sha: str,
    source_manifest: Mapping[str, Any],
    duplicate_rows: Sequence[Mapping[str, object]],
) -> dict[str, object]:
    return {
        "accountEffectiveFees": "UNKNOWN",
        "baseCommit": BASE_COMMIT,
        "consumer": "N3 successor/final convergence",
        "duplicateNormalization": duplicate_summary(duplicate_rows),
        "evaluationNetworkCalls": 0,
        "executableCapacity": "UNMEASURED",
        "freezeSha256": sha256_path(FREEZE_PATH),
        "generatedAtUtc": utc_now(),
        "historicalBookDepthSpreadImpactAndFilters": "UNMEASURED",
        "protocolSha256": sha256_path(PROTOCOL_PATH),
        "runMarkerSha256": marker_sha,
        "schema": "VG16TerminalResultV1",
        "sourceManifestSha256": sha256_path(SOURCE_MANIFEST_PATH),
        "sourceState": source_manifest["state"],
    }


def final_result(
    *,
    marker_sha: str,
    source_manifest: Mapping[str, Any],
    duplicate_rows: Sequence[Mapping[str, object]],
    candidate_rows: list[dict[str, object]],
    champion: Trial | None,
    reporting_trial: Trial,
    reporting_row: Mapping[str, Any],
    inference: Mapping[str, Any],
    holdout_metrics: Mapping[str, Any] | None,
) -> dict[str, object]:
    result = base_result_envelope(
        marker_sha=marker_sha,
        source_manifest=source_manifest,
        duplicate_rows=duplicate_rows,
    )
    result["development"] = {
        "bestObservedTrialId": reporting_trial.trial_id,
        "candidateCount": len(candidate_rows),
        "candidates": candidate_rows,
        "endExclusiveUtc": DEVELOPMENT_END.isoformat(),
        "inference": inference,
        "qualifiedChampionTrialId": None if champion is None else champion.trial_id,
        "reportingCandidate": reporting_row,
        "startUtc": DEVELOPMENT_START.isoformat(),
    }
    if champion is None:
        reasons = (
            "NO_DEVELOPMENT_CHAMPION",
            *cast(list[str], reporting_row["gateReasons"]),
        )
        result["holdoutReuseCount"] = 0
        result["holdout"] = {
            "archiveBodiesOpened": False,
            "metrics": None,
            "reason": "DEVELOPMENT_GATES_FAILED",
            "state": "UNOPENED_UNTOUCHED",
        }
        result["netEdge"] = {
            "baseNetMeanUsdtPerDayPer1000": reporting_row["metrics"][
                "baseNetMeanUsdtPerDayPer1000"
            ],
            "baseNetOneSided95Lcb14DayUsdtPerDayPer1000": reporting_row["metrics"][
                "baseNetOneSided95Lcb14DayUsdtPerDayPer1000"
            ],
            "baseNetOneSided95Lcb7DayUsdtPerDayPer1000": reporting_row["metrics"][
                "baseNetOneSided95Lcb7DayUsdtPerDayPer1000"
            ],
            "baseNetTotalUsdtPer1000": reporting_row["metrics"]["baseNetTotalUsdtPer1000"],
            "scope": "BEST_OBSERVED_DEVELOPMENT_CANDIDATE_NOT_QUALIFIED",
            "trialId": reporting_trial.trial_id,
        }
        verdict = "NO_GO"
    else:
        if holdout_metrics is None:
            raise VG16Error("opened holdout metrics are missing")
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
            "baseNetMeanUsdtPerDayPer1000": holdout_metrics["baseNetMeanUsdtPerDayPer1000"],
            "baseNetOneSided95Lcb14DayUsdtPerDayPer1000": holdout_metrics[
                "baseNetOneSided95Lcb14DayUsdtPerDayPer1000"
            ],
            "baseNetOneSided95Lcb7DayUsdtPerDayPer1000": holdout_metrics[
                "baseNetOneSided95Lcb7DayUsdtPerDayPer1000"
            ],
            "baseNetTotalUsdtPer1000": holdout_metrics["baseNetTotalUsdtPer1000"],
            "scope": "SINGLE_UNTOUCHED_HOLDOUT",
            "trialId": champion.trial_id,
        }
        verdict = "GO" if not reasons else "NO_GO"
    result["verdict"] = {
        "capitalAuthority": "NONE",
        "consumer": "N3 successor/final convergence",
        "feeScenario": "PUBLIC_REGULAR_USER_10_BPS_TAKER_EACH_FILL",
        "goScope": "PUBLIC_SCENARIO_ONLY" if verdict == "GO" else "NONE",
        "reasons": list(reasons),
        "repairOrRerun": False,
        "status": verdict,
    }
    return result


def terminal_unmeasured_result(
    *,
    marker_sha: str,
    reason: str,
    source_manifest: Mapping[str, Any],
    duplicate_rows: Sequence[Mapping[str, object]],
) -> dict[str, object]:
    result = base_result_envelope(
        marker_sha=marker_sha,
        source_manifest=source_manifest,
        duplicate_rows=duplicate_rows,
    )
    opened = HOLDOUT_OPEN_PATH.exists()
    result["development"] = None
    result["holdoutReuseCount"] = 1 if opened else 0
    result["holdout"] = {
        "archiveBodiesOpened": opened,
        "metrics": None,
        "state": "OPENED_INCOMPLETE" if opened else "UNOPENED_UNTOUCHED",
    }
    result["netEdge"] = {
        "baseNetMeanUsdtPerDayPer1000": None,
        "baseNetOneSided95Lcb14DayUsdtPerDayPer1000": None,
        "baseNetOneSided95Lcb7DayUsdtPerDayPer1000": None,
        "baseNetTotalUsdtPer1000": None,
        "scope": "UNMEASURED",
        "trialId": None,
    }
    result["riskAndInference"] = {
        "capacity": None,
        "costs": None,
        "drawdown": None,
        "pbo": None,
    }
    result["verdict"] = {
        "capitalAuthority": "NONE",
        "consumer": "N3 successor/final convergence",
        "feeScenario": "PUBLIC_REGULAR_USER_10_BPS_TAKER_EACH_FILL",
        "goScope": "NONE",
        "reasons": [reason],
        "repairOrRerun": False,
        "status": "UNMEASURED",
    }
    return result


def terminal_summary_bytes(result: Mapping[str, Any]) -> bytes:
    verdict = cast(Mapping[str, Any], result["verdict"])
    edge = cast(Mapping[str, Any], result["netEdge"])
    holdout = cast(Mapping[str, Any], result["holdout"])
    duplicate = cast(Mapping[str, Any], result["duplicateNormalization"])
    reasons = cast(Sequence[str], verdict["reasons"])
    return (
        "# V-G16 terminal result\n\n"
        f"- Verdict: `{verdict['status']}`\n"
        f"- Scope: `{edge['scope']}`\n"
        f"- Net USDT per 1,000 USDT: `{edge['baseNetTotalUsdtPer1000']}`\n"
        f"- Holdout: `{holdout['state']}`\n"
        f"- Canonicalized exact duplicate rows: `{duplicate['duplicateRowCount']}`\n"
        f"- Reasons: `{';'.join(reasons)}`\n"
        "- Account-effective fees: `UNKNOWN`\n"
        "- Executable capacity: `UNMEASURED`\n"
        "- Capital and execution authority: `NONE`\n"
        "- Repair or rerun: `false`\n"
    ).encode()


def write_terminal_summary(result: Mapping[str, Any]) -> None:
    write_bytes_once(TERMINAL_PATH, terminal_summary_bytes(result))


def run_experiment() -> None:
    freeze_receipt, source_manifest = validate_frozen_identity()
    marker_sha = consume_run_marker(freeze_receipt)
    loaded = LoadedBars({}, ())
    try:
        development_source_months = frozenset(
            month for month in SOURCE_MONTHS if month not in HOLDOUT_MONTHS
        )
        loaded = load_bars(source_manifest, development_source_months)
        features = build_features(loaded.bars, DEVELOPMENT_END)
        (
            candidate_rows,
            champion,
            reporting_trial,
            reporting_row,
            inference,
        ) = development_analysis(loaded.bars, features)
        holdout_metrics: dict[str, object] | None = None
        if champion is not None:
            champion_row = next(
                row
                for row in candidate_rows
                if cast(Mapping[str, Any], row["trial"])["trialId"] == champion.trial_id
            )
            candidate_seal(
                champion,
                champion_row,
                candidate_rows,
                inference,
                marker_sha,
            )
            open_holdout_once(champion)
            loaded = load_bars(source_manifest, frozenset(HOLDOUT_MONTHS), loaded)
            features = build_features(loaded.bars, EVALUATION_END)
            holdout_simulation = simulate_period(
                loaded.bars,
                features,
                champion,
                HOLDOUT_START,
                EVALUATION_END,
            )
            holdout_metrics = simulation_metrics(holdout_simulation)
        result = final_result(
            marker_sha=marker_sha,
            source_manifest=source_manifest,
            duplicate_rows=loaded.duplicate_rows,
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
            if isinstance(error, VG16Error)
            else f"EVALUATION_ERROR_{type(error).__name__.upper()}:{error}"
        )
        result = terminal_unmeasured_result(
            marker_sha=marker_sha,
            reason=reason,
            source_manifest=source_manifest,
            duplicate_rows=loaded.duplicate_rows,
        )
    write_json_once(RESULT_PATH, result)
    write_terminal_summary(result)
    write_sha256s()
    verdict = cast(Mapping[str, Any], result["verdict"])
    edge = cast(Mapping[str, Any], result["netEdge"])
    holdout = cast(Mapping[str, Any], result["holdout"])
    print(
        f"{verdict['status']} scope={edge['scope']} "
        f"netUsdtPer1000={edge['baseNetTotalUsdtPer1000']} holdout={holdout['state']}"
    )


def verify_sha256s() -> None:
    require_regular_file(SHA256SUMS_PATH)
    expected: dict[str, str] = {}
    for line in SHA256SUMS_PATH.read_text(encoding="ascii").splitlines():
        parts = line.split("  ", 1)
        if len(parts) != 2 or re.fullmatch(r"[0-9a-f]{64}", parts[0]) is None:
            raise VG16Error("SHA256SUMS grammar is invalid")
        digest, name = parts
        if "/" in name or name in expected:
            raise VG16Error("SHA256SUMS name is invalid or duplicate")
        expected[name] = digest
    actual_names = {path.name for path in packet_files()}
    if set(expected) != actual_names:
        raise VG16Error("SHA256SUMS inventory differs from packet files")
    for path in packet_files():
        if sha256_path(path) != expected[path.name]:
            raise VG16Error(f"packet digest mismatch: {path.name}")


def validate_candidate_family(
    raw_candidates: object,
    raw_inference: object,
    qualified_champion_id: object,
) -> tuple[list[dict[str, Any]], str | None]:
    if not isinstance(raw_candidates, list) or len(raw_candidates) != len(trial_grid()):
        raise VG16Error("development candidate family size is invalid")
    if any(not isinstance(row, dict) for row in raw_candidates):
        raise VG16Error("development candidate family row is invalid")
    candidates = cast(list[dict[str, Any]], raw_candidates)
    expected_trials = [trial_mapping(trial) for trial in trial_grid()]
    actual_trials = [row.get("trial") for row in candidates]
    if actual_trials != expected_trials:
        raise VG16Error("development candidate family differs from the frozen grid")
    for row in candidates:
        reasons = row.get("gateReasons")
        if (
            not isinstance(reasons, list)
            or any(not isinstance(reason, str) for reason in reasons)
            or row.get("gatePass") is not (not reasons)
            or not isinstance(row.get("metrics"), dict)
        ):
            raise VG16Error("development candidate gate row is invalid")
    if not isinstance(raw_inference, dict):
        raise VG16Error("development inference is invalid")
    inference = cast(dict[str, Any], raw_inference)
    ranking = inference.get("candidateRanking")
    if not isinstance(ranking, dict):
        raise VG16Error("candidate ranking receipt is missing")
    computed_ranking = [
        str(cast(Mapping[str, Any], row["trial"])["trialId"])
        for row in sorted(candidates, key=candidate_row_rank_key)
    ]
    if ranking.get("rankedTrialIds") != computed_ranking:
        raise VG16Error("candidate ranking differs from the frozen rank law")
    first_qualifier = next(
        (
            str(cast(Mapping[str, Any], row["trial"])["trialId"])
            for row in sorted(candidates, key=candidate_row_rank_key)
            if row["gatePass"] is True
        ),
        None,
    )
    if qualified_champion_id != first_qualifier:
        raise VG16Error("qualified champion differs from the first ranked gate pass")
    pbo = inference.get("pbo")
    ledger = inference.get("trialLedger")
    if (
        not isinstance(pbo, dict)
        or pbo.get("holdoutTouched") is not False
        or pbo.get("role")
        != "DEVELOPMENT_ONLY_DIAGNOSTIC; NEVER_SELECTION_HOLM_INTERVAL_VERDICT_OR_AUTHORITY"
        or not isinstance(ledger, dict)
        or ledger.get("attemptedCount") != len(trial_grid())
    ):
        raise VG16Error("development PBO or trial-ledger boundary is invalid")
    return candidates, first_qualifier


def validate_development_result(development: object) -> str | None:
    if not isinstance(development, dict):
        raise VG16Error("measured result requires development evidence")
    if (
        development.get("candidateCount") != len(trial_grid())
        or development.get("startUtc") != DEVELOPMENT_START.isoformat()
        or development.get("endExclusiveUtc") != DEVELOPMENT_END.isoformat()
    ):
        raise VG16Error("development result boundaries are invalid")
    candidates, champion_id = validate_candidate_family(
        development.get("candidates"),
        development.get("inference"),
        development.get("qualifiedChampionTrialId"),
    )
    ranked = sorted(candidates, key=candidate_row_rank_key)
    best_id = str(cast(Mapping[str, Any], ranked[0]["trial"])["trialId"])
    if (
        development.get("bestObservedTrialId") != best_id
        or development.get("reportingCandidate") != ranked[0]
    ):
        raise VG16Error("development reporting candidate is inconsistent")
    return champion_id


def validate_freeze_commit(
    marker: Mapping[str, Any],
    freeze_receipt: Mapping[str, Any],
) -> None:
    if (
        marker.get("schema") != "VG16SoleRunMarkerV1"
        or marker.get("state") != "SOLE_ARCHIVE_DECOMPRESSION_RUN_CONSUMED"
        or marker.get("archiveDecompressionRunOrdinal") != 1
        or marker.get("candidateSealPresentAtStart") is not False
        or marker.get("holdoutOpenedAtStart") is not False
        or marker.get("networkCallsAllowedAfterMarker") != 0
        or marker.get("baseCommit") != BASE_COMMIT
        or marker.get("evaluatorSha256") != freeze_receipt["evaluatorSha256"]
        or marker.get("protocolSha256") != freeze_receipt["protocolSha256"]
        or marker.get("sourceManifestSha256") != freeze_receipt["sourceManifestSha256"]
        or marker.get("freezeSha256") != sha256_path(FREEZE_PATH)
    ):
        raise VG16Error("run marker custody fields are invalid")
    freeze_commit = marker.get("freezeCommit")
    freeze_tree = marker.get("freezeTree")
    if (
        not isinstance(freeze_commit, str)
        or re.fullmatch(r"[0-9a-f]{40}", freeze_commit) is None
        or not isinstance(freeze_tree, str)
        or re.fullmatch(r"[0-9a-f]{40}", freeze_tree) is None
    ):
        raise VG16Error("run marker Git identity is invalid")
    if (
        git_output("rev-parse", "--verify", f"{freeze_commit}^{{commit}}") != freeze_commit
        or git_output("rev-parse", f"{freeze_commit}^{{tree}}") != freeze_tree
        or git_output("rev-parse", f"{freeze_commit}^") != BASE_COMMIT
    ):
        raise VG16Error("freeze commit ancestry or tree is invalid")
    if git_output("merge-base", "--is-ancestor", freeze_commit, "HEAD"):
        raise VG16Error("unexpected freeze ancestry output")
    require_exclusive_scope(changed_paths(BASE_COMMIT, freeze_commit))
    frozen_files = {
        Path(__file__): "evaluatorSha256",
        INIT_PATH: "initSha256",
        SOURCE_RESEARCH_PATH: "officialSourceResearchSha256",
        PROTOCOL_PATH: "protocolSha256",
        README_PATH: "readmeSha256",
        SOURCE_MANIFEST_PATH: "sourceManifestSha256",
        TEST_PATH: "testSha256",
    }
    for path, receipt_key in frozen_files.items():
        if git_blob_sha256(freeze_commit, path) != freeze_receipt[receipt_key]:
            raise VG16Error(f"freeze commit blob mismatch: {path.name}")
    dependencies = freeze_receipt.get("dependencySha256")
    if not isinstance(dependencies, dict):
        raise VG16Error("freeze dependency bindings are invalid")
    for path in DEPENDENCY_PATHS:
        relative = path.relative_to(REPO_ROOT).as_posix()
        if git_blob_sha256(freeze_commit, path) != dependencies.get(relative):
            raise VG16Error(f"freeze dependency blob mismatch: {relative}")
    if git_blob_sha256(freeze_commit, FREEZE_PATH) != sha256_path(FREEZE_PATH):
        raise VG16Error("freeze receipt differs from the committed freeze blob")


def validate_candidate_seal(
    result: Mapping[str, Any],
    marker_sha: str,
) -> str:
    require_regular_file(CANDIDATE_SEAL_PATH)
    seal = load_json(CANDIDATE_SEAL_PATH)
    evidence = seal.get("developmentEvidence")
    candidate = seal.get("candidate")
    if (
        seal.get("schema") != "VG16DevelopmentChampionSealV1"
        or seal.get("state") != "DEVELOPMENT_GATES_PASS_CHAMPION_FROZEN"
        or seal.get("holdoutOpened") is not False
        or seal.get("runMarkerSha256") != marker_sha
        or seal.get("freezeSha256") != sha256_path(FREEZE_PATH)
        or seal.get("evaluatorSha256") != sha256_path(Path(__file__))
        or seal.get("protocolSha256") != sha256_path(PROTOCOL_PATH)
        or seal.get("sourceManifestSha256") != sha256_path(SOURCE_MANIFEST_PATH)
        or not isinstance(evidence, dict)
        or canonical_sha(evidence) != seal.get("developmentEvidenceSha256")
        or not isinstance(candidate, dict)
    ):
        raise VG16Error("candidate seal custody fields are invalid")
    candidates, champion_id = validate_candidate_family(
        evidence.get("candidates"),
        evidence.get("inference"),
        evidence.get("qualifiedChampionTrialId"),
    )
    if evidence.get("candidateCount") != len(candidates) or champion_id is None:
        raise VG16Error("candidate seal development evidence is invalid")
    champion_row = next(
        row for row in candidates if cast(Mapping[str, Any], row["trial"])["trialId"] == champion_id
    )
    if candidate != champion_row["trial"] or seal.get("candidateRowSha256") != canonical_sha(
        champion_row
    ):
        raise VG16Error("candidate seal champion row is inconsistent")
    development = result.get("development")
    if development is not None:
        result_champion = validate_development_result(development)
        if (
            result_champion != champion_id
            or cast(Mapping[str, Any], development)["candidates"] != candidates
            or cast(Mapping[str, Any], development)["inference"] != evidence["inference"]
        ):
            raise VG16Error("result development differs from the pre-holdout seal")
    return champion_id


def verify_packet() -> None:
    freeze_receipt, source_manifest = validate_frozen_identity()
    for path in (RUN_MARKER_PATH, RESULT_PATH, TERMINAL_PATH):
        require_regular_file(path)
    marker = load_json(RUN_MARKER_PATH)
    result = load_json(RESULT_PATH)
    marker_sha = sha256_path(RUN_MARKER_PATH)
    validate_freeze_commit(marker, freeze_receipt)
    if (
        result.get("schema") != "VG16TerminalResultV1"
        or result.get("baseCommit") != BASE_COMMIT
        or result.get("consumer") != "N3 successor/final convergence"
        or result.get("runMarkerSha256") != marker_sha
        or result.get("freezeSha256") != sha256_path(FREEZE_PATH)
        or result.get("protocolSha256") != sha256_path(PROTOCOL_PATH)
        or result.get("sourceManifestSha256") != sha256_path(SOURCE_MANIFEST_PATH)
        or result.get("sourceState") != source_manifest["state"]
        or result.get("evaluationNetworkCalls") != 0
        or result.get("accountEffectiveFees") != "UNKNOWN"
        or result.get("executableCapacity") != "UNMEASURED"
        or result.get("historicalBookDepthSpreadImpactAndFilters") != "UNMEASURED"
    ):
        raise VG16Error("terminal result custody or truth fields are invalid")
    verdict = result.get("verdict")
    holdout = result.get("holdout")
    edge = result.get("netEdge")
    if not isinstance(verdict, dict) or verdict.get("status") not in {
        "GO",
        "NO_GO",
        "UNMEASURED",
    }:
        raise VG16Error("result verdict is invalid")
    if not isinstance(holdout, dict) or not isinstance(edge, dict):
        raise VG16Error("result holdout or edge is invalid")
    if (
        verdict.get("consumer") != "N3 successor/final convergence"
        or verdict.get("capitalAuthority") != "NONE"
        or verdict.get("repairOrRerun") is not False
        or not isinstance(verdict.get("reasons"), list)
    ):
        raise VG16Error("result authority or rerun boundary is invalid")
    holdout_opened = HOLDOUT_OPEN_PATH.exists() and not HOLDOUT_OPEN_PATH.is_symlink()
    candidate_sealed = CANDIDATE_SEAL_PATH.exists() and not CANDIDATE_SEAL_PATH.is_symlink()
    champion_id: str | None = None
    if candidate_sealed:
        champion_id = validate_candidate_seal(result, marker_sha)
    if holdout_opened:
        if not candidate_sealed:
            raise VG16Error("holdout opened without a candidate seal")
        receipt = load_json(HOLDOUT_OPEN_PATH)
        if (
            receipt.get("schema") != "VG16HoldoutOpenOnceV1"
            or receipt.get("state") != "HOLDOUT_OPENED_ONCE_FOR_FROZEN_CHAMPION"
            or receipt.get("holdoutOpenOrdinal") != 1
            or receipt.get("candidateSealSha256") != sha256_path(CANDIDATE_SEAL_PATH)
            or receipt.get("championTrialId") != champion_id
            or receipt.get("holdoutArchiveMonths") != list(HOLDOUT_MONTHS)
            or receipt.get("holdoutStartUtc") != HOLDOUT_START.isoformat()
            or receipt.get("holdoutEndExclusiveUtc") != EVALUATION_END.isoformat()
        ):
            raise VG16Error("holdout-open receipt custody fields are invalid")
        expected_holdout_state = (
            "OPENED_INCOMPLETE" if verdict.get("status") == "UNMEASURED" else "OPENED_ONCE_COMPLETE"
        )
        if (
            holdout.get("state") != expected_holdout_state
            or holdout.get("archiveBodiesOpened") is not True
            or result.get("holdoutReuseCount") != 1
        ):
            raise VG16Error("result holdout state differs from its open receipt")
    elif (
        holdout.get("state") != "UNOPENED_UNTOUCHED"
        or holdout.get("archiveBodiesOpened") is not False
        or result.get("holdoutReuseCount") != 0
    ):
        raise VG16Error("result claims an absent holdout was opened")
    if verdict.get("status") == "UNMEASURED":
        if (
            result.get("development") is not None
            or holdout.get("metrics") is not None
            or result.get("riskAndInference")
            != {
                "capacity": None,
                "costs": None,
                "drawdown": None,
                "pbo": None,
            }
            or edge.get("scope") != "UNMEASURED"
            or edge.get("trialId") is not None
        ):
            raise VG16Error("UNMEASURED result contains non-null analytical claims")
        for key in (
            "baseNetMeanUsdtPerDayPer1000",
            "baseNetOneSided95Lcb14DayUsdtPerDayPer1000",
            "baseNetOneSided95Lcb7DayUsdtPerDayPer1000",
            "baseNetTotalUsdtPer1000",
        ):
            if edge.get(key) is not None:
                raise VG16Error("UNMEASURED result contains numeric economics")
        if verdict.get("goScope") != "NONE" or not verdict["reasons"]:
            raise VG16Error("UNMEASURED verdict scope or reason is invalid")
    else:
        development = result.get("development")
        result_champion = validate_development_result(development)
        development_mapping = cast(Mapping[str, Any], development)
        expected_edge_metrics: Mapping[str, Any]
        if holdout_opened:
            holdout_metrics = holdout.get("metrics")
            if (
                result_champion != champion_id
                or edge.get("trialId") != champion_id
                or not isinstance(holdout_metrics, dict)
                or holdout.get("candidateSealSha256") != sha256_path(CANDIDATE_SEAL_PATH)
                or holdout.get("holdoutOpenReceiptSha256") != sha256_path(HOLDOUT_OPEN_PATH)
            ):
                raise VG16Error("measured holdout champion identity is inconsistent")
            expected_reasons = list(holdout_gate_reasons(holdout_metrics))
            expected_edge_metrics = holdout_metrics
            expected_scope = "SINGLE_UNTOUCHED_HOLDOUT"
        else:
            reporting_candidate = development_mapping.get("reportingCandidate")
            if (
                result_champion is not None
                or edge.get("scope") != "BEST_OBSERVED_DEVELOPMENT_CANDIDATE_NOT_QUALIFIED"
                or not isinstance(reporting_candidate, dict)
            ):
                raise VG16Error("unopened measured result incorrectly claims a champion")
            reporting_trial = cast(Mapping[str, Any], reporting_candidate["trial"])
            reporting_metrics = cast(Mapping[str, Any], reporting_candidate["metrics"])
            reporting_reasons = cast(list[str], reporting_candidate["gateReasons"])
            if edge.get("trialId") != reporting_trial["trialId"]:
                raise VG16Error("development edge trial differs from its reporting row")
            expected_reasons = ["NO_DEVELOPMENT_CHAMPION", *reporting_reasons]
            expected_edge_metrics = reporting_metrics
            expected_scope = "BEST_OBSERVED_DEVELOPMENT_CANDIDATE_NOT_QUALIFIED"
        edge_keys = (
            "baseNetMeanUsdtPerDayPer1000",
            "baseNetOneSided95Lcb14DayUsdtPerDayPer1000",
            "baseNetOneSided95Lcb7DayUsdtPerDayPer1000",
            "baseNetTotalUsdtPer1000",
        )
        if (
            edge.get("scope") != expected_scope
            or any(edge.get(key) != expected_edge_metrics.get(key) for key in edge_keys)
            or verdict["reasons"] != expected_reasons
        ):
            raise VG16Error("measured edge or verdict reasons differ from gate evidence")
        expected_status = "GO" if holdout_opened and not expected_reasons else "NO_GO"
        if verdict.get("status") != expected_status:
            raise VG16Error("measured verdict status differs from its declared gates")
        if expected_status == "GO":
            if (
                not holdout_opened
                or verdict.get("goScope") != "PUBLIC_SCENARIO_ONLY"
                or verdict["reasons"]
            ):
                raise VG16Error("GO verdict lacks its single-holdout gate proof")
        elif verdict.get("goScope") != "NONE" or not verdict["reasons"]:
            raise VG16Error("NO_GO verdict scope or reasons are invalid")
    if TERMINAL_PATH.read_bytes() != terminal_summary_bytes(result):
        raise VG16Error("terminal summary differs from the canonical result")
    verify_sha256s()
    print(
        f"VERIFIED verdict={verdict['status']} holdout={holdout['state']} "
        f"result={sha256_path(RESULT_PATH)}"
    )


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("freeze", "run", "verify"))
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    try:
        if args.command == "freeze":
            freeze()
        elif args.command == "run":
            run_experiment()
        else:
            verify_packet()
    except (VG16Error, OSError, subprocess.CalledProcessError, zipfile.BadZipFile) as error:
        print(f"VG16_ERROR {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
