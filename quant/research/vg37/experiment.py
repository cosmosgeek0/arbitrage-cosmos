#!/usr/bin/env python3
"""Sealed V-G37 Binance-public quote-volume synchronization experiment.

The evaluator has four lifecycle commands:

* ``freeze`` authenticates compressed source custody without opening ZIP members.
* ``run`` consumes a one-use marker before opening development members and opens
  holdout members only after a full development pass.
* ``seal`` creates a data-free handoff and packet checksum inventory.
* ``verify`` authenticates the sealed packet and compressed source bytes.

No command uses a credential, private endpoint, account, order, wallet, host,
provider, UI, or money surface.
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
import platform
import re
import subprocess
import zipfile
from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import asdict, dataclass
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any, cast

import numpy as np
import numpy.typing as npt

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[2]
PROTOCOL_PATH = HERE / "protocol.v1.json"
README_PATH = HERE / "README.md"
SOURCE_RESEARCH_PATH = HERE / "OFFICIAL_SOURCE_RESEARCH.md"
INIT_PATH = HERE / "__init__.py"
EXPERIMENT_PATH = HERE / "experiment.py"
VERIFY_PATH = HERE / "verify.py"
TEST_PATH = HERE / "test_experiment.py"
SOURCE_MANIFEST_PATH = HERE / "source-manifest.v1.json"
FREEZE_PATH = HERE / "freeze.v1.json"
RUN_MARKER_PATH = HERE / "run-marker.v1.json"
HOLDOUT_MARKER_PATH = HERE / "holdout-open.v1.json"
TERMINAL_CORE_PATH = HERE / "terminal-result-core.v1.json"
RESULT_PATH = HERE / "result.v1.json"
HANDOFF_PATH = HERE / "HANDOFF.md"
SHA256SUMS_PATH = HERE / "SHA256SUMS"

BASE_COMMIT = "a169b123fb186d1943a75ad648552c4d95be1be1"
SOURCE_ROOT = Path("/private/tmp/cosmos-s1f-weekly-momentum-cash-v1")
DISCOVERY_PATH = SOURCE_ROOT / "discovery.v1.json"
ACQUISITION_PATH = SOURCE_ROOT / "acquisition-manifest.v1.json"
DISCOVERY_SHA256 = "b4a8f7abd36df19eff0510dfcc3c61fd0df9fdcab5f4d248892ee10010fb21c3"
ACQUISITION_SHA256 = "01f58272602e43bfb914b649adc00d8273b2d423492220a55f86443bb6441176"

SOURCE_MONTHS = tuple(
    f"{year:04d}-{month:02d}"
    for year, start_month, end_month in ((2025, 1, 12), (2026, 1, 1))
    for month in range(start_month, end_month + 1)
)
DEVELOPMENT_BODY_MONTHS = SOURCE_MONTHS[:10]
HOLDOUT_BODY_MONTHS = SOURCE_MONTHS[10:]
DEVELOPMENT_START = date(2025, 5, 5)
DEVELOPMENT_END = date(2025, 10, 31)
HOLDOUT_START = date(2025, 11, 3)
HOLDOUT_END = date(2026, 1, 26)
OLDER_WINDOW_DAYS = 56
RECENT_WINDOWS = (7, 14, 28)
SHOCK_THRESHOLDS = (0.05, 0.10)
HOLD_DAYS = (3, 7)
MINIMUM_PANEL = 200
INITIAL_CAPITAL = 1000.0
CAPACITY_PARTICIPATION = 0.0001
BOOTSTRAP_REPLICATES = 4096
BOOTSTRAP_BLOCKS = (7, 14)
BOOTSTRAP_SEED = 2_026_072_937

TRADE_COHORT = (
    "ADAUSDT",
    "AVAXUSDT",
    "BCHUSDT",
    "BNBUSDT",
    "BTCUSDT",
    "DOGEUSDT",
    "ETHUSDT",
    "LINKUSDT",
    "LTCUSDT",
    "SOLUSDT",
    "TRXUSDT",
    "XRPUSDT",
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
CHECKSUM_RE = re.compile(r"^([0-9a-f]{64})[ \t]+\*?([^\r\n]+)[\r\n]*$")


class VG37Error(RuntimeError):
    """Terminal protocol, source-custody, or measurement failure."""


@dataclass(frozen=True, slots=True)
class Trial:
    """One member of the frozen 12-trial family."""

    trial_id: str
    recent_days: int
    threshold: float
    hold_days: int


@dataclass(frozen=True, slots=True)
class Bar:
    """Strict daily public kline fields needed by V-G37."""

    symbol: str
    day: date
    open_price: float
    close_price: float
    quote_volume: float
    open_time: int
    close_time: int


@dataclass(frozen=True, slots=True)
class Formation:
    """A causally evaluated synchronization formation."""

    entry_day: date
    cutoff_day: date
    recent_days: int
    eligible_symbols: int
    recent_sync: float | None
    older_sync: float | None
    shock: float | None
    valid: bool
    invalid_reason: str | None


@dataclass(frozen=True, slots=True)
class Scenario:
    """One frozen public cost scenario."""

    name: str
    fee_rate: float
    adverse_rate: float

    @property
    def side_cost(self) -> float:
        return self.fee_rate + self.adverse_rate


@dataclass(frozen=True, slots=True)
class PathMetrics:
    """Economic path and inference-ready daily observations."""

    trial_id: str
    scenario: str
    net_usdt: float
    final_nav_usdt: float
    episodes: int
    active_holding_days: int
    fills: int
    valid_formations: int
    maximum_drawdown_pct: float
    positive_months: int
    capacity_p05_usdt: float | None
    daily_log_returns: tuple[float, ...]
    daily_dates: tuple[str, ...]
    monthly_net_usdt: tuple[tuple[str, float], ...]


SCENARIOS = (
    Scenario("PUBLIC_GROSS", 0.0, 0.0),
    Scenario("PUBLIC_BASE", 0.0010, 0.0010),
    Scenario("PUBLIC_STRESS", 0.0010, 0.0025),
    Scenario("FEE_STRESS", 0.0020, 0.0025),
)

STATIC_PACKET_PATHS = (
    INIT_PATH,
    PROTOCOL_PATH,
    SOURCE_RESEARCH_PATH,
    README_PATH,
    EXPERIMENT_PATH,
    VERIFY_PATH,
    TEST_PATH,
)


def canonical_bytes(value: object) -> bytes:
    """Return deterministic UTF-8 JSON bytes."""

    return (
        json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        ).encode("utf-8")
        + b"\n"
    )


def sha256_bytes(value: bytes) -> str:
    """Return a lowercase SHA-256 digest."""

    return hashlib.sha256(value).hexdigest()


def sha256_path(path: Path) -> str:
    """Hash a regular file without following a symlink."""

    if path.is_symlink() or not path.is_file():
        raise VG37Error(f"REGULAR_FILE_REQUIRED:{path}")
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def read_json(path: Path) -> dict[str, Any]:
    """Read a JSON object."""

    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise VG37Error(f"JSON_OBJECT_REQUIRED:{path}")
    return cast(dict[str, Any], value)


def write_exclusive(path: Path, payload: object) -> None:
    """Create one canonical JSON artifact and never overwrite it."""

    encoded = canonical_bytes(payload)
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError as error:
        raise VG37Error(f"ONE_USE_STATE_ALREADY_EXISTS:{path.name}") from error
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(encoded)
            handle.flush()
            os.fsync(handle.fileno())
    except BaseException:
        path.unlink(missing_ok=True)
        raise


def write_text_exclusive(path: Path, text: str) -> None:
    """Create one UTF-8 text artifact and never overwrite it."""

    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError as error:
        raise VG37Error(f"ONE_USE_STATE_ALREADY_EXISTS:{path.name}") from error
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
    except BaseException:
        path.unlink(missing_ok=True)
        raise


def git_output(*arguments: str) -> str:
    """Run one read-only Git query from the isolated worktree."""

    process = subprocess.run(
        ("git", *arguments),
        cwd=REPO_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    if process.returncode != 0:
        raise VG37Error(f"GIT_QUERY_FAILED:{' '.join(arguments)}:{process.stderr.strip()}")
    return process.stdout.strip()


def assert_clean_head(commit: str) -> None:
    """Require exact immutable HEAD and a clean tree before a lifecycle step."""

    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise VG37Error("FULL_COMMIT_REQUIRED")
    head = git_output("rev-parse", "HEAD")
    if head != commit:
        raise VG37Error(f"HEAD_MISMATCH:{head}:{commit}")
    if git_output("status", "--porcelain=v1", "--untracked-files=all"):
        raise VG37Error("WORKTREE_NOT_CLEAN")
    base = git_output("merge-base", BASE_COMMIT, commit)
    if base != BASE_COMMIT:
        raise VG37Error(f"BASE_NOT_ANCESTOR:{base}")


def trial_grid() -> tuple[Trial, ...]:
    """Construct the exact frozen trial family."""

    return tuple(
        Trial(
            trial_id=f"R{recent:02d}_D{round(threshold * 100):02d}_H{hold:02d}",
            recent_days=recent,
            threshold=threshold,
            hold_days=hold,
        )
        for recent in RECENT_WINDOWS
        for threshold in SHOCK_THRESHOLDS
        for hold in HOLD_DAYS
    )


def iter_days(start: date, end_inclusive: date) -> Iterable[date]:
    """Yield every calendar day in an inclusive interval."""

    current = start
    while current <= end_inclusive:
        yield current
        current += timedelta(days=1)


def month_key(day: date) -> str:
    """Return YYYY-MM."""

    return day.strftime("%Y-%m")


def months_spanned(start: date, end: date) -> tuple[str, ...]:
    """Return inclusive YYYY-MM keys between two dates."""

    values: list[str] = []
    cursor = date(start.year, start.month, 1)
    final = date(end.year, end.month, 1)
    while cursor <= final:
        values.append(month_key(cursor))
        if cursor.month == 12:
            cursor = date(cursor.year + 1, 1, 1)
        else:
            cursor = date(cursor.year, cursor.month + 1, 1)
    return tuple(values)


def formation_days(start: date, end: date, hold_days: int) -> tuple[date, ...]:
    """Return Monday entries whose exits are inside the partition."""

    return tuple(
        day
        for day in iter_days(start, end)
        if day.weekday() == 0 and day + timedelta(days=hold_days) <= end
    )


def protocol_runtime() -> dict[str, str]:
    """Freeze the numerical runtime relevant to deterministic output."""

    return {
        "implementation": platform.python_implementation(),
        "machine": platform.machine(),
        "numpy": np.__version__,
        "python": platform.python_version(),
        "pythonHashSeed": os.environ.get("PYTHONHASHSEED", "UNSET"),
    }


def _artifact_local_paths(symbol: str, month: str) -> tuple[Path, Path, Path]:
    stem = f"{symbol}-1d-{month}.zip"
    root = SOURCE_ROOT / "archives" / symbol / month
    return root / stem, root / f"{stem}.CHECKSUM", root / "pair.v1.json"


def build_source_freeze(protocol_commit: str) -> tuple[dict[str, Any], dict[str, Any]]:
    """Authenticate and inventory compressed public archive custody."""

    assert_clean_head(protocol_commit)
    if platform.python_version() != "3.13.14":
        raise VG37Error(f"PYTHON_RUNTIME_MISMATCH:{platform.python_version()}")
    if os.environ.get("PYTHONHASHSEED") != "0":
        raise VG37Error("PYTHONHASHSEED_MUST_BE_ZERO")
    discovery_sha = sha256_path(DISCOVERY_PATH)
    acquisition_sha = sha256_path(ACQUISITION_PATH)
    if discovery_sha != DISCOVERY_SHA256:
        raise VG37Error(f"DISCOVERY_SHA_MISMATCH:{discovery_sha}")
    if acquisition_sha != ACQUISITION_SHA256:
        raise VG37Error(f"ACQUISITION_SHA_MISMATCH:{acquisition_sha}")

    acquisition = read_json(ACQUISITION_PATH)
    pairs_raw = acquisition.get("artifactPairs")
    if not isinstance(pairs_raw, list):
        raise VG37Error("ACQUISITION_ARTIFACT_PAIRS_REQUIRED")
    selected: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for raw in pairs_raw:
        if not isinstance(raw, dict):
            raise VG37Error("ACQUISITION_PAIR_OBJECT_REQUIRED")
        symbol = raw.get("symbol")
        month = raw.get("month")
        if not isinstance(symbol, str) or not isinstance(month, str):
            raise VG37Error("ACQUISITION_PAIR_KEY_REQUIRED")
        if month not in SOURCE_MONTHS:
            continue
        key = (symbol, month)
        if key in seen:
            raise VG37Error(f"DUPLICATE_ACQUISITION_PAIR:{symbol}:{month}")
        seen.add(key)
        zip_path, checksum_path, pair_path = _artifact_local_paths(symbol, month)
        for path in (zip_path, checksum_path, pair_path):
            if path.is_symlink() or not path.is_file():
                raise VG37Error(f"REGULAR_SOURCE_FILE_REQUIRED:{path}")
        pair_payload = read_json(pair_path)
        if pair_payload.get("symbol") != symbol or pair_payload.get("month") != month:
            raise VG37Error(f"PAIR_METADATA_KEY_MISMATCH:{symbol}:{month}")
        zip_sha = sha256_path(zip_path)
        checksum_sha = sha256_path(checksum_path)
        pair_sha = sha256_path(pair_path)
        if raw.get("zipSha256") != zip_sha or pair_payload.get("zipSha256") != zip_sha:
            raise VG37Error(f"ZIP_SHA_MISMATCH:{symbol}:{month}")
        if (
            raw.get("checksumSha256") != checksum_sha
            or pair_payload.get("checksumSha256") != checksum_sha
        ):
            raise VG37Error(f"CHECKSUM_SHA_MISMATCH:{symbol}:{month}")
        sidecar = checksum_path.read_text(encoding="utf-8")
        match = CHECKSUM_RE.fullmatch(sidecar)
        if match is None:
            raise VG37Error(f"CHECKSUM_SCHEMA_INVALID:{symbol}:{month}")
        if match.group(1) != zip_sha or match.group(2) != zip_path.name:
            raise VG37Error(f"CHECKSUM_LISTING_MISMATCH:{symbol}:{month}")
        if int(raw.get("zipBytes", -1)) != zip_path.stat().st_size:
            raise VG37Error(f"ZIP_SIZE_MISMATCH:{symbol}:{month}")
        if int(raw.get("checksumBytes", -1)) != checksum_path.stat().st_size:
            raise VG37Error(f"CHECKSUM_SIZE_MISMATCH:{symbol}:{month}")
        selected.append(
            {
                "checksumBytes": checksum_path.stat().st_size,
                "checksumEtag": raw.get("checksumFrozenEtag"),
                "checksumLastModified": raw.get("checksumFrozenLastModified"),
                "checksumRelativePath": str(checksum_path.relative_to(SOURCE_ROOT)),
                "checksumSha256": checksum_sha,
                "month": month,
                "pairRelativePath": str(pair_path.relative_to(SOURCE_ROOT)),
                "pairSha256": pair_sha,
                "symbol": symbol,
                "zipBytes": zip_path.stat().st_size,
                "zipEtag": raw.get("zipFrozenEtag"),
                "zipLastModified": raw.get("zipFrozenLastModified"),
                "zipRelativePath": str(zip_path.relative_to(SOURCE_ROOT)),
                "zipSha256": zip_sha,
            }
        )
    selected.sort(key=lambda item: (str(item["symbol"]), str(item["month"])))
    symbols = sorted({str(item["symbol"]) for item in selected})
    by_key = {(str(item["symbol"]), str(item["month"])) for item in selected}
    missing_trade = [
        f"{symbol}|{month}"
        for symbol in TRADE_COHORT
        for month in SOURCE_MONTHS
        if (symbol, month) not in by_key
    ]
    if missing_trade:
        raise VG37Error(f"TRADE_COHORT_SOURCE_MISSING:{','.join(missing_trade)}")

    manifest: dict[str, Any] = {
        "acquisitionManifestSha256": acquisition_sha,
        "archiveBodiesOpenedDuringFreeze": False,
        "artifactPairCount": len(selected),
        "artifactPairs": selected,
        "discoverySha256": discovery_sha,
        "holdoutArchiveMembersOpenedDuringFreeze": False,
        "schema": "VG37SourceManifestV1",
        "sourceMonths": list(SOURCE_MONTHS),
        "sourceRootContract": str(SOURCE_ROOT),
        "symbolCount": len(symbols),
        "symbols": symbols,
    }
    manifest_sha = sha256_bytes(canonical_bytes(manifest))
    static_hashes = {
        str(path.relative_to(REPO_ROOT)): sha256_path(path) for path in STATIC_PACKET_PATHS
    }
    freeze: dict[str, Any] = {
        "archiveBodiesOpenedDuringFreeze": False,
        "baseCommit": BASE_COMMIT,
        "holdoutArchiveMembersOpenedDuringFreeze": False,
        "preProtocolSchemaProbe": {
            "archive": "BTCUSDT-1d-2025-01.zip",
            "calculatedOutcomeOrStatistic": False,
            "purpose": "DOCUMENTED_TIMESTAMP_AND_COLUMN_SCHEMA_CONFIRMATION",
            "rowsDisplayed": 3,
        },
        "protocolCommit": protocol_commit,
        "runtime": protocol_runtime(),
        "schema": "VG37FreezeV1",
        "sourceManifestSha256": manifest_sha,
        "staticPacketSha256": static_hashes,
        "state": "COMPRESSED_SOURCE_AUTHENTICATED_NO_EVALUATOR_MEMBER_OPEN",
    }
    return manifest, freeze


def command_freeze(protocol_commit: str) -> None:
    """Create source-manifest and freeze artifacts exactly once."""

    for path in (
        SOURCE_MANIFEST_PATH,
        FREEZE_PATH,
        RUN_MARKER_PATH,
        HOLDOUT_MARKER_PATH,
        TERMINAL_CORE_PATH,
        RESULT_PATH,
        HANDOFF_PATH,
        SHA256SUMS_PATH,
    ):
        if path.exists():
            raise VG37Error(f"PREEXISTING_LIFECYCLE_ARTIFACT:{path.name}")
    manifest, freeze = build_source_freeze(protocol_commit)
    write_exclusive(SOURCE_MANIFEST_PATH, manifest)
    write_exclusive(FREEZE_PATH, freeze)
    print(
        json.dumps(
            {
                "artifactPairCount": manifest["artifactPairCount"],
                "protocolCommit": protocol_commit,
                "sourceManifestSha256": freeze["sourceManifestSha256"],
                "state": freeze["state"],
                "symbolCount": manifest["symbolCount"],
            },
            sort_keys=True,
        )
    )


def verify_static_freeze() -> tuple[dict[str, Any], dict[str, Any]]:
    """Authenticate frozen packet inputs without opening archive members."""

    freeze = read_json(FREEZE_PATH)
    manifest = read_json(SOURCE_MANIFEST_PATH)
    manifest_sha = sha256_bytes(canonical_bytes(manifest))
    if manifest_sha != freeze.get("sourceManifestSha256"):
        raise VG37Error("SOURCE_MANIFEST_FREEZE_MISMATCH")
    static_hashes = freeze.get("staticPacketSha256")
    if not isinstance(static_hashes, dict):
        raise VG37Error("STATIC_PACKET_HASHES_REQUIRED")
    for relative, expected in static_hashes.items():
        if not isinstance(relative, str) or not isinstance(expected, str):
            raise VG37Error("STATIC_PACKET_HASH_SCHEMA_INVALID")
        actual = sha256_path(REPO_ROOT / relative)
        if actual != expected:
            raise VG37Error(f"STATIC_PACKET_TAMPER:{relative}")
    if freeze.get("runtime") != protocol_runtime():
        raise VG37Error("RUNTIME_FREEZE_MISMATCH")
    return manifest, freeze


def verify_source_entry(entry: Mapping[str, Any]) -> tuple[Path, Path, Path]:
    """Re-authenticate one compressed pair before member access."""

    zip_path = SOURCE_ROOT / str(entry["zipRelativePath"])
    checksum_path = SOURCE_ROOT / str(entry["checksumRelativePath"])
    pair_path = SOURCE_ROOT / str(entry["pairRelativePath"])
    for path, digest_key, size_key in (
        (zip_path, "zipSha256", "zipBytes"),
        (checksum_path, "checksumSha256", "checksumBytes"),
        (pair_path, "pairSha256", None),
    ):
        if sha256_path(path) != entry[digest_key]:
            raise VG37Error(f"SOURCE_TAMPER:{entry['symbol']}:{entry['month']}:{path.name}")
        if size_key is not None and path.stat().st_size != int(entry[size_key]):
            raise VG37Error(f"SOURCE_SIZE_TAMPER:{entry['symbol']}:{entry['month']}:{path.name}")
    return zip_path, checksum_path, pair_path


def _parse_positive_float(value: str, label: str) -> float:
    try:
        parsed = float(value)
    except ValueError as error:
        raise VG37Error(f"NUMERIC_FIELD_INVALID:{label}:{value}") from error
    if not math.isfinite(parsed) or parsed <= 0.0:
        raise VG37Error(f"POSITIVE_NUMERIC_FIELD_REQUIRED:{label}:{value}")
    return parsed


def parse_archive(entry: Mapping[str, Any]) -> tuple[Bar, ...]:
    """Open and strictly parse one already-authenticated monthly ZIP."""

    symbol = str(entry["symbol"])
    month = str(entry["month"])
    zip_path, _, _ = verify_source_entry(entry)
    expected_member = f"{symbol}-1d-{month}.csv"
    try:
        with zipfile.ZipFile(zip_path, "r") as archive:
            members = archive.namelist()
            if members != [expected_member]:
                raise VG37Error(f"ZIP_MEMBER_SET_INVALID:{symbol}:{month}:{','.join(members)}")
            raw = archive.read(expected_member)
    except zipfile.BadZipFile as error:
        raise VG37Error(f"BAD_ZIP:{symbol}:{month}") from error
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as error:
        raise VG37Error(f"CSV_UTF8_INVALID:{symbol}:{month}") from error
    rows = list(csv.reader(io.StringIO(text, newline="")))
    if rows and tuple(rows[0]) == KLINE_HEADER:
        rows = rows[1:]
    if not rows:
        raise VG37Error(f"EMPTY_ARCHIVE:{symbol}:{month}")
    bars: list[Bar] = []
    prior_open_time = -1
    seen_days: set[date] = set()
    for row_index, row in enumerate(rows, start=1):
        if len(row) != 12:
            raise VG37Error(f"KLINE_FIELD_COUNT:{symbol}:{month}:{row_index}:{len(row)}")
        try:
            open_time = int(row[0])
            close_time = int(row[6])
        except ValueError as error:
            raise VG37Error(f"TIMESTAMP_FIELD_INVALID:{symbol}:{month}:{row_index}") from error
        if open_time < 1_000_000_000_000_000 or close_time < 1_000_000_000_000_000:
            raise VG37Error(f"MICROSECOND_TIMESTAMP_REQUIRED:{symbol}:{month}:{row_index}")
        if open_time <= prior_open_time:
            raise VG37Error(f"UNSORTED_OR_DUPLICATE_ROW:{symbol}:{month}:{row_index}")
        prior_open_time = open_time
        if open_time % 86_400_000_000 != 0:
            raise VG37Error(f"NON_UTC_DAILY_OPEN:{symbol}:{month}:{row_index}")
        if close_time != open_time + 86_400_000_000 - 1:
            raise VG37Error(f"DAILY_CLOSE_BOUNDARY_INVALID:{symbol}:{month}:{row_index}")
        day = datetime.fromtimestamp(open_time / 1_000_000, tz=UTC).date()
        if month_key(day) != month:
            raise VG37Error(f"ROW_OUTSIDE_DECLARED_MONTH:{symbol}:{month}:{day.isoformat()}")
        if day in seen_days:
            raise VG37Error(f"DUPLICATE_DAY:{symbol}:{month}:{day.isoformat()}")
        seen_days.add(day)
        open_price = _parse_positive_float(row[1], f"{symbol}:{day}:open")
        close_price = _parse_positive_float(row[4], f"{symbol}:{day}:close")
        try:
            quote_volume = float(row[7])
        except ValueError as error:
            raise VG37Error(f"QUOTE_VOLUME_INVALID:{symbol}:{day}") from error
        if not math.isfinite(quote_volume) or quote_volume < 0.0:
            raise VG37Error(f"NONNEGATIVE_QUOTE_VOLUME_REQUIRED:{symbol}:{day}")
        bars.append(
            Bar(
                symbol=symbol,
                day=day,
                open_price=open_price,
                close_price=close_price,
                quote_volume=quote_volume,
                open_time=open_time,
                close_time=close_time,
            )
        )
    return tuple(bars)


def _manifest_index(
    manifest: Mapping[str, Any],
) -> dict[tuple[str, str], Mapping[str, Any]]:
    raw_entries = manifest.get("artifactPairs")
    if not isinstance(raw_entries, list):
        raise VG37Error("SOURCE_MANIFEST_ENTRIES_REQUIRED")
    result: dict[tuple[str, str], Mapping[str, Any]] = {}
    for raw in raw_entries:
        if not isinstance(raw, dict):
            raise VG37Error("SOURCE_MANIFEST_ENTRY_OBJECT_REQUIRED")
        key = (str(raw["symbol"]), str(raw["month"]))
        if key in result:
            raise VG37Error(f"DUPLICATE_SOURCE_MANIFEST_KEY:{key[0]}:{key[1]}")
        result[key] = raw
    return result


def candidate_symbols_for_cutoff(
    manifest_index: Mapping[tuple[str, str], Mapping[str, Any]],
    cutoff: date,
    recent_days: int,
) -> tuple[str, ...]:
    """Select symbols using only metadata for the causal historical window."""

    oldest_innovation = cutoff - timedelta(days=OLDER_WINDOW_DAYS + recent_days - 1)
    predecessor = oldest_innovation - timedelta(days=1)
    required_months = months_spanned(predecessor, cutoff)
    symbols = {symbol for symbol, _ in manifest_index}
    return tuple(
        sorted(
            symbol
            for symbol in symbols
            if all((symbol, month) in manifest_index for month in required_months)
        )
    )


def required_archive_keys(
    manifest_index: Mapping[tuple[str, str], Mapping[str, Any]],
    entries: Sequence[date],
    body_months: Sequence[str],
) -> tuple[tuple[str, str], ...]:
    """Return only archives that can contribute to a causal formation."""

    body_set = set(body_months)
    required: set[tuple[str, str]] = set()
    for entry_day in entries:
        cutoff = entry_day - timedelta(days=2)
        for recent_days in RECENT_WINDOWS:
            candidates = candidate_symbols_for_cutoff(manifest_index, cutoff, recent_days)
            oldest = cutoff - timedelta(days=OLDER_WINDOW_DAYS + recent_days)
            for symbol in candidates:
                for month in months_spanned(oldest, cutoff):
                    if month in body_set:
                        required.add((symbol, month))
    trade_start = min(entries) - timedelta(days=31)
    trade_end = max(entries) + timedelta(days=max(HOLD_DAYS))
    for symbol in TRADE_COHORT:
        for month in months_spanned(trade_start, trade_end):
            if month in body_set:
                required.add((symbol, month))
    return tuple(sorted(required))


def load_archive_keys(
    manifest_index: Mapping[tuple[str, str], Mapping[str, Any]],
    keys: Sequence[tuple[str, str]],
    existing: dict[str, dict[date, Bar]] | None = None,
) -> dict[str, dict[date, Bar]]:
    """Open a frozen set of archive pairs and assemble symbol/day bars."""

    bars = existing if existing is not None else {}
    for key in keys:
        entry = manifest_index.get(key)
        if entry is None:
            raise VG37Error(f"REQUIRED_SOURCE_PAIR_MISSING:{key[0]}:{key[1]}")
        symbol_days = bars.setdefault(key[0], {})
        for bar in parse_archive(entry):
            prior = symbol_days.get(bar.day)
            if prior is not None:
                raise VG37Error(f"CROSS_ARCHIVE_DUPLICATE_DAY:{bar.symbol}:{bar.day}")
            symbol_days[bar.day] = bar
    return bars


def _average_ranks(values: npt.NDArray[np.float64]) -> npt.NDArray[np.float64]:
    """Return stable average ranks, one-based, for a one-dimensional vector."""

    order = np.argsort(values, kind="stable")
    ranks = np.empty(values.size, dtype=np.float64)
    position = 0
    while position < values.size:
        end = position + 1
        while end < values.size and values[order[end]] == values[order[position]]:
            end += 1
        average = (position + 1 + end) / 2.0
        ranks[order[position:end]] = average
        position = end
    return ranks


def median_pairwise_spearman(
    matrix: npt.NDArray[np.float64],
) -> tuple[float, npt.NDArray[np.bool_]]:
    """Return median off-diagonal Spearman and the nonconstant-row mask."""

    if matrix.ndim != 2 or matrix.shape[0] < 2 or matrix.shape[1] < 2:
        raise VG37Error("SPEARMAN_MATRIX_SHAPE_INVALID")
    ranked = np.vstack([_average_ranks(row) for row in matrix])
    centered = ranked - ranked.mean(axis=1, keepdims=True)
    norms = np.sqrt(np.sum(centered * centered, axis=1))
    keep = norms > 0.0
    usable = centered[keep]
    usable_norms = norms[keep]
    if usable.shape[0] < 2:
        raise VG37Error("SPEARMAN_TOO_FEW_NONCONSTANT_ROWS")
    normalized = usable / usable_norms[:, None]
    correlations = normalized @ normalized.T
    upper = correlations[np.triu_indices(correlations.shape[0], k=1)]
    return float(np.median(upper)), keep


def formation_signal(
    bars: Mapping[str, Mapping[date, Bar]],
    candidate_symbols: Sequence[str],
    entry_day: date,
    recent_days: int,
) -> Formation:
    """Calculate one lagged zero-lag synchronization shock."""

    cutoff = entry_day - timedelta(days=2)
    oldest = cutoff - timedelta(days=OLDER_WINDOW_DAYS + recent_days - 1)
    predecessor = oldest - timedelta(days=1)
    days = tuple(iter_days(predecessor, cutoff))
    innovations: list[list[float]] = []
    eligible = 0
    for symbol in candidate_symbols:
        symbol_bars = bars.get(symbol)
        if symbol_bars is None:
            continue
        try:
            volumes = [symbol_bars[day].quote_volume for day in days]
        except KeyError:
            continue
        if any(volume <= 0.0 for volume in volumes):
            continue
        eligible += 1
        logs = np.log1p(np.asarray(volumes, dtype=np.float64))
        innovations.append(np.diff(logs).tolist())
    if eligible < MINIMUM_PANEL:
        return Formation(
            entry_day=entry_day,
            cutoff_day=cutoff,
            recent_days=recent_days,
            eligible_symbols=eligible,
            recent_sync=None,
            older_sync=None,
            shock=None,
            valid=False,
            invalid_reason="MINIMUM_CAUSAL_PANEL_NOT_MET",
        )
    matrix = np.asarray(innovations, dtype=np.float64)
    older = matrix[:, :OLDER_WINDOW_DAYS]
    recent = matrix[:, OLDER_WINDOW_DAYS:]
    try:
        older_sync, older_keep = median_pairwise_spearman(older)
        recent_sync, recent_keep = median_pairwise_spearman(recent)
    except VG37Error:
        return Formation(
            entry_day=entry_day,
            cutoff_day=cutoff,
            recent_days=recent_days,
            eligible_symbols=eligible,
            recent_sync=None,
            older_sync=None,
            shock=None,
            valid=False,
            invalid_reason="PAIRWISE_DEPENDENCE_UNDEFINED",
        )
    common_keep = older_keep & recent_keep
    if int(np.sum(common_keep)) < MINIMUM_PANEL:
        return Formation(
            entry_day=entry_day,
            cutoff_day=cutoff,
            recent_days=recent_days,
            eligible_symbols=int(np.sum(common_keep)),
            recent_sync=None,
            older_sync=None,
            shock=None,
            valid=False,
            invalid_reason="MINIMUM_NONCONSTANT_PANEL_NOT_MET",
        )
    if not np.all(common_keep):
        older_sync, _ = median_pairwise_spearman(older[common_keep])
        recent_sync, _ = median_pairwise_spearman(recent[common_keep])
    shock = recent_sync - older_sync
    return Formation(
        entry_day=entry_day,
        cutoff_day=cutoff,
        recent_days=recent_days,
        eligible_symbols=int(np.sum(common_keep)),
        recent_sync=older_sync + shock,
        older_sync=older_sync,
        shock=shock,
        valid=True,
        invalid_reason=None,
    )


def compute_formations(
    bars: Mapping[str, Mapping[date, Bar]],
    manifest_index: Mapping[tuple[str, str], Mapping[str, Any]],
    entries: Sequence[date],
) -> dict[tuple[date, int], Formation]:
    """Compute each recent-window signal once for all trials."""

    result: dict[tuple[date, int], Formation] = {}
    for entry_day in sorted(set(entries)):
        cutoff = entry_day - timedelta(days=2)
        for recent_days in RECENT_WINDOWS:
            candidates = candidate_symbols_for_cutoff(manifest_index, cutoff, recent_days)
            result[(entry_day, recent_days)] = formation_signal(
                bars, candidates, entry_day, recent_days
            )
    return result


def _cohort_open_prices(bars: Mapping[str, Mapping[date, Bar]], day: date) -> dict[str, float]:
    prices: dict[str, float] = {}
    for symbol in TRADE_COHORT:
        try:
            price = bars[symbol][day].open_price
        except KeyError as error:
            raise VG37Error(f"TRADE_COHORT_OPEN_MISSING:{symbol}:{day.isoformat()}") from error
        if price <= 0.0 or not math.isfinite(price):
            raise VG37Error(f"TRADE_COHORT_OPEN_INVALID:{symbol}:{day.isoformat()}")
        prices[symbol] = price
    return prices


def capacity_at_entry(bars: Mapping[str, Mapping[date, Bar]], entry_day: date) -> float:
    """Calculate the causal 1 bp trade-print participation proxy."""

    end = entry_day - timedelta(days=2)
    start = end - timedelta(days=29)
    member_medians: list[float] = []
    for symbol in TRADE_COHORT:
        try:
            volumes = [bars[symbol][day].quote_volume for day in iter_days(start, end)]
        except KeyError as error:
            raise VG37Error(
                f"CAPACITY_LOOKBACK_MISSING:{symbol}:{entry_day.isoformat()}"
            ) from error
        member_medians.append(float(np.median(np.asarray(volumes, dtype=np.float64))))
    return len(TRADE_COHORT) * min(member_medians) * CAPACITY_PARTICIPATION


def percentile(values: Sequence[float], probability: float) -> float:
    """Deterministic linear percentile."""

    if not values:
        raise VG37Error("PERCENTILE_REQUIRES_VALUES")
    return float(np.quantile(np.asarray(values, dtype=np.float64), probability))


def build_episodes(
    trial: Trial,
    formations: Mapping[tuple[date, int], Formation],
    partition_start: date,
    partition_end: date,
) -> tuple[tuple[date, date], ...]:
    """Create nonoverlapping frozen episodes; in-position signals are ignored."""

    episodes: list[tuple[date, date]] = []
    invested_until: date | None = None
    for entry_day in formation_days(partition_start, partition_end, trial.hold_days):
        formation = formations[(entry_day, trial.recent_days)]
        if not formation.valid or formation.shock is None:
            continue
        if formation.shock < trial.threshold:
            continue
        if invested_until is not None and entry_day < invested_until:
            continue
        exit_day = entry_day + timedelta(days=trial.hold_days)
        episodes.append((entry_day, exit_day))
        invested_until = exit_day
    return tuple(episodes)


def simulate_path(
    trial: Trial,
    scenario: Scenario,
    formations: Mapping[tuple[date, int], Formation],
    bars: Mapping[str, Mapping[date, Bar]],
    partition_start: date,
    partition_end: date,
    *,
    always_on: bool = False,
) -> PathMetrics:
    """Simulate fixed-unit cohort/cash at UTC daily opens."""

    episodes: tuple[tuple[date, date], ...]
    if always_on:
        episodes = ((partition_start, partition_end),)
        trial_id = f"{trial.trial_id}:ALWAYS_ON"
    else:
        episodes = build_episodes(trial, formations, partition_start, partition_end)
        trial_id = trial.trial_id
    entries = dict(episodes)
    exit_days = {exit_day for _, exit_day in episodes}
    cash = INITIAL_CAPITAL
    units: dict[str, float] | None = None
    prior_nav = INITIAL_CAPITAL
    peak_nav = INITIAL_CAPITAL
    max_drawdown = 0.0
    daily_logs: list[float] = []
    daily_dates: list[str] = []
    monthly_pnl: dict[str, float] = defaultdict(float)
    capacities: list[float] = []
    for day in iter_days(partition_start, partition_end):
        prices = _cohort_open_prices(bars, day)
        marked = (
            cash
            if units is None
            else sum(units[symbol] * prices[symbol] for symbol in TRADE_COHORT)
        )
        if units is not None and day in exit_days:
            cash = marked * (1.0 - scenario.side_cost)
            units = None
            marked = cash
        if day in entries:
            if units is not None:
                raise VG37Error(f"OVERLAPPING_EPISODES:{trial_id}:{day.isoformat()}")
            investable = cash * (1.0 - scenario.side_cost)
            per_member = investable / len(TRADE_COHORT)
            units = {symbol: per_member / prices[symbol] for symbol in TRADE_COHORT}
            cash = 0.0
            marked = investable
            if not always_on:
                capacities.append(capacity_at_entry(bars, day))
        if marked <= 0.0 or not math.isfinite(marked):
            raise VG37Error(f"NAV_INVALID:{trial_id}:{scenario.name}:{day}")
        daily_logs.append(math.log(marked / prior_nav))
        daily_dates.append(day.isoformat())
        monthly_pnl[month_key(day)] += marked - prior_nav
        prior_nav = marked
        peak_nav = max(peak_nav, marked)
        max_drawdown = max(max_drawdown, (peak_nav - marked) / peak_nav * 100.0)
    if units is not None:
        raise VG37Error(f"PARTITION_BOUNDARY_NOT_CASH:{trial_id}:{scenario.name}")
    valid_formations = sum(
        1
        for entry_day in formation_days(partition_start, partition_end, trial.hold_days)
        if formations[(entry_day, trial.recent_days)].valid
    )
    monthly = tuple(sorted(monthly_pnl.items()))
    positive_months = sum(1 for _, value in monthly if value > 0.0)
    return PathMetrics(
        trial_id=trial_id,
        scenario=scenario.name,
        net_usdt=prior_nav - INITIAL_CAPITAL,
        final_nav_usdt=prior_nav,
        episodes=len(episodes) if not always_on else 1,
        active_holding_days=(
            sum((exit_day - entry).days for entry, exit_day in episodes)
            if not always_on
            else (partition_end - partition_start).days
        ),
        fills=len(episodes) * 2 * len(TRADE_COHORT),
        valid_formations=valid_formations,
        maximum_drawdown_pct=max_drawdown,
        positive_months=positive_months,
        capacity_p05_usdt=percentile(capacities, 0.05) if capacities else None,
        daily_log_returns=tuple(daily_logs),
        daily_dates=tuple(daily_dates),
        monthly_net_usdt=monthly,
    )


def circular_block_indices(
    length: int, block_length: int, rng: np.random.Generator
) -> npt.NDArray[np.int64]:
    """Sample exactly ``length`` synchronous circular block indices."""

    blocks = math.ceil(length / block_length)
    starts = rng.integers(0, length, size=blocks)
    offsets = np.arange(block_length)
    tiled = (starts[:, None] + offsets[None, :]) % length
    return cast(npt.NDArray[np.int64], tiled.reshape(-1)[:length])


def bootstrap_summary(
    values: Sequence[float],
    *,
    block_length: int,
    seed: int,
) -> dict[str, float | int]:
    """Return seeded interval and one-sided centered-null p-value."""

    array = np.asarray(values, dtype=np.float64)
    if array.size < block_length * 2:
        raise VG37Error(f"BOOTSTRAP_SERIES_TOO_SHORT:{array.size}:{block_length}")
    rng = np.random.default_rng(seed)
    sampled_nets = np.empty(BOOTSTRAP_REPLICATES, dtype=np.float64)
    centered_sums = np.empty(BOOTSTRAP_REPLICATES, dtype=np.float64)
    centered = array - array.mean()
    observed_sum = float(array.sum())
    for replicate in range(BOOTSTRAP_REPLICATES):
        indices = circular_block_indices(array.size, block_length, rng)
        sampled_nets[replicate] = INITIAL_CAPITAL * (math.exp(float(array[indices].sum())) - 1.0)
        centered_sums[replicate] = float(centered[indices].sum())
    return {
        "blockLengthDays": block_length,
        "coveragePct": 90,
        "lower90Usdt": float(np.quantile(sampled_nets, 0.05)),
        "oneSidedP": float(
            (1 + np.count_nonzero(centered_sums >= observed_sum)) / (BOOTSTRAP_REPLICATES + 1)
        ),
        "replicates": BOOTSTRAP_REPLICATES,
        "upper90Usdt": float(np.quantile(sampled_nets, 0.95)),
    }


def holm_adjust(raw: Mapping[str, float]) -> dict[str, float]:
    """Return monotone Holm-adjusted p-values."""

    ordered = sorted(raw.items(), key=lambda item: (item[1], item[0]))
    count = len(ordered)
    running = 0.0
    adjusted: dict[str, float] = {}
    for index, (name, value) in enumerate(ordered):
        candidate = min(1.0, (count - index) * value)
        running = max(running, candidate)
        adjusted[name] = running
    return adjusted


def white_reality_check(
    series_by_trial: Mapping[str, Sequence[float]],
    *,
    block_length: int,
    seed: int,
) -> float:
    """White-style max-statistic p-value under a centered synchronous bootstrap."""

    names = sorted(series_by_trial)
    matrix = np.asarray([series_by_trial[name] for name in names], dtype=np.float64)
    if matrix.ndim != 2 or matrix.shape[1] < block_length * 2:
        raise VG37Error("WHITE_SERIES_SHAPE_INVALID")
    observed = float(np.max(np.sum(matrix, axis=1)))
    centered = matrix - matrix.mean(axis=1, keepdims=True)
    rng = np.random.default_rng(seed)
    exceed = 0
    for _ in range(BOOTSTRAP_REPLICATES):
        indices = circular_block_indices(matrix.shape[1], block_length, rng)
        boot_max = float(np.max(np.sum(centered[:, indices], axis=1)))
        if boot_max >= observed:
            exceed += 1
    return (1 + exceed) / (BOOTSTRAP_REPLICATES + 1)


def pbo_diagnostic(series_by_trial: Mapping[str, Sequence[float]]) -> dict[str, Any]:
    """Compute eight-block CSCV/PBO over all 70 symmetric half-splits."""

    names = sorted(series_by_trial)
    matrix = np.asarray([series_by_trial[name] for name in names], dtype=np.float64)
    blocks = tuple(np.array_split(np.arange(matrix.shape[1]), 8))
    logits: list[float] = []
    below_median = 0
    for in_sample_ids in itertools.combinations(range(8), 4):
        in_set = set(in_sample_ids)
        out_sample_ids = tuple(index for index in range(8) if index not in in_set)
        in_indices = np.concatenate([blocks[index] for index in in_sample_ids])
        out_indices = np.concatenate([blocks[index] for index in out_sample_ids])
        in_scores = matrix[:, in_indices].mean(axis=1)
        champion = min(range(len(names)), key=lambda index: (-in_scores[index], names[index]))
        out_scores = matrix[:, out_indices].mean(axis=1)
        order = sorted(range(len(names)), key=lambda index: (out_scores[index], names[index]))
        rank = order.index(champion) + 1
        relative_rank = (rank - 0.5) / len(names)
        logits.append(math.log(relative_rank / (1.0 - relative_rank)))
        if relative_rank < 0.5:
            below_median += 1
    return {
        "blocks": 8,
        "logitMedian": float(np.median(np.asarray(logits, dtype=np.float64))),
        "method": "CSCV_ALL_70_SYMMETRIC_HALF_SPLITS",
        "pbo": below_median / len(logits),
        "splits": len(logits),
    }


def _metrics_public(metrics: PathMetrics) -> dict[str, Any]:
    """Serialize path metrics without duplicating inference-only raw arrays."""

    payload = asdict(metrics)
    payload.pop("daily_log_returns")
    payload.pop("daily_dates")
    payload["capacity_p05_usdt"] = (
        None if metrics.capacity_p05_usdt is None else round(metrics.capacity_p05_usdt, 8)
    )
    for key in (
        "net_usdt",
        "final_nav_usdt",
        "maximum_drawdown_pct",
    ):
        payload[key] = round(float(payload[key]), 8)
    payload["net_per_1k_usdt"] = payload["net_usdt"]
    payload["dollar_per_1k_proxy"] = payload["net_usdt"]
    payload["monthly_net_usdt"] = [
        [month, round(value, 8)] for month, value in metrics.monthly_net_usdt
    ]
    return payload


def evaluate_partition(
    trials: Sequence[Trial],
    formations: Mapping[tuple[date, int], Formation],
    bars: Mapping[str, Mapping[date, Bar]],
    partition_start: date,
    partition_end: date,
    *,
    development: bool,
) -> tuple[dict[str, Any], dict[str, dict[str, PathMetrics]]]:
    """Evaluate economics, intervals, and frozen gates for one partition."""

    path_map: dict[str, dict[str, PathMetrics]] = {}
    trial_payloads: list[dict[str, Any]] = []
    base_p: dict[str, float] = {}
    base_series: dict[str, Sequence[float]] = {}
    base_excess_series: dict[str, Sequence[float]] = {}
    stress_series: dict[str, Sequence[float]] = {}
    for trial_index, trial in enumerate(trials):
        paths: dict[str, PathMetrics] = {}
        comparators: dict[str, PathMetrics] = {}
        scenario_payload: dict[str, Any] = {}
        for scenario_index, scenario in enumerate(SCENARIOS):
            path = simulate_path(
                trial,
                scenario,
                formations,
                bars,
                partition_start,
                partition_end,
            )
            comparator = simulate_path(
                trial,
                scenario,
                formations,
                bars,
                partition_start,
                partition_end,
                always_on=True,
            )
            paths[scenario.name] = path
            comparators[scenario.name] = comparator
            excess = tuple(
                strategy - benchmark
                for strategy, benchmark in zip(
                    path.daily_log_returns,
                    comparator.daily_log_returns,
                    strict=True,
                )
            )
            absolute_bootstrap = {
                str(block): bootstrap_summary(
                    path.daily_log_returns,
                    block_length=block,
                    seed=BOOTSTRAP_SEED + trial_index * 100 + scenario_index * 10 + block,
                )
                for block in BOOTSTRAP_BLOCKS
            }
            excess_bootstrap = {
                str(block): bootstrap_summary(
                    excess,
                    block_length=block,
                    seed=BOOTSTRAP_SEED + 50_000 + trial_index * 100 + scenario_index * 10 + block,
                )
                for block in BOOTSTRAP_BLOCKS
            }
            scenario_payload[scenario.name] = {
                "absoluteBootstrap": absolute_bootstrap,
                "alwaysOnComparator": _metrics_public(comparator),
                "benchmarkExcessBootstrap": excess_bootstrap,
                "benchmarkExcessNetUsdt": round(INITIAL_CAPITAL * (math.exp(sum(excess)) - 1.0), 8),
                "path": _metrics_public(path),
            }
            if scenario.name == "PUBLIC_BASE":
                base_p[trial.trial_id] = float(absolute_bootstrap["14"]["oneSidedP"])
                base_series[trial.trial_id] = path.daily_log_returns
                base_excess_series[trial.trial_id] = excess
            if scenario.name == "PUBLIC_STRESS":
                stress_series[trial.trial_id] = path.daily_log_returns
        path_map[trial.trial_id] = paths
        trial_payloads.append(
            {
                "parameters": asdict(trial),
                "scenarios": scenario_payload,
            }
        )

    adjusted = holm_adjust(base_p)
    white_cash = white_reality_check(base_series, block_length=14, seed=BOOTSTRAP_SEED + 100_000)
    white_benchmark = white_reality_check(
        base_excess_series, block_length=14, seed=BOOTSTRAP_SEED + 200_000
    )
    pbo = pbo_diagnostic(stress_series)
    payload_by_id = {str(payload["parameters"]["trial_id"]): payload for payload in trial_payloads}
    for trial in trials:
        payload = payload_by_id[trial.trial_id]
        scenarios = cast(dict[str, Any], payload["scenarios"])
        base = cast(dict[str, Any], scenarios["PUBLIC_BASE"])
        stress = cast(dict[str, Any], scenarios["PUBLIC_STRESS"])
        fee_stress = cast(dict[str, Any], scenarios["FEE_STRESS"])
        base_path = cast(dict[str, Any], base["path"])
        stress_path = cast(dict[str, Any], stress["path"])
        fee_stress_path = cast(dict[str, Any], fee_stress["path"])
        base_abs = cast(dict[str, Any], base["absoluteBootstrap"])
        stress_abs = cast(dict[str, Any], stress["absoluteBootstrap"])
        base_excess = cast(dict[str, Any], base["benchmarkExcessBootstrap"])
        stress_excess = cast(dict[str, Any], stress["benchmarkExcessBootstrap"])
        capacity = stress_path["capacity_p05_usdt"]
        if development:
            checks = {
                "activeHoldingDays": int(stress_path["active_holding_days"]) >= 9,
                "baseAbsoluteLcb14Positive": float(base_abs["14"]["lower90Usdt"]) > 0.0,
                "baseBenchmarkExcessLcb14Positive": float(base_excess["14"]["lower90Usdt"]) > 0.0,
                "baseDrawdown": float(base_path["maximum_drawdown_pct"]) <= 20.0,
                "baseNetPositive": float(base_path["net_usdt"]) > 0.0,
                "capacityP05": capacity is not None and float(capacity) >= 1000.0,
                "closedEpisodes": int(stress_path["episodes"]) >= 3,
                "feeStressNetPositive": float(fee_stress_path["net_usdt"]) > 0.0,
                "holm": adjusted[trial.trial_id] < 0.05,
                "positiveStressMonths": int(stress_path["positive_months"]) >= 3,
                "stressAbsoluteLcb14Positive": float(stress_abs["14"]["lower90Usdt"]) > 0.0,
                "stressBenchmarkExcessLcb14Positive": float(stress_excess["14"]["lower90Usdt"])
                > 0.0,
                "stressDrawdown": float(stress_path["maximum_drawdown_pct"]) <= 25.0,
                "stressNetPositive": float(stress_path["net_usdt"]) > 0.0,
                "validFormations": int(stress_path["valid_formations"]) >= 20,
                "whiteBenchmark": white_benchmark < 0.05,
                "whiteCash": white_cash < 0.05,
            }
        else:
            checks = {
                "activeHoldingDays": int(stress_path["active_holding_days"]) >= 6,
                "baseAbsoluteLcb14Positive": float(base_abs["14"]["lower90Usdt"]) > 0.0,
                "baseBenchmarkExcessLcb14Positive": float(base_excess["14"]["lower90Usdt"]) > 0.0,
                "baseDrawdown": float(base_path["maximum_drawdown_pct"]) <= 20.0,
                "baseNetPositive": float(base_path["net_usdt"]) > 0.0,
                "capacityP05": capacity is not None and float(capacity) >= 1000.0,
                "closedEpisodes": int(stress_path["episodes"]) >= 2,
                "feeStressNetPositive": float(fee_stress_path["net_usdt"]) > 0.0,
                "positiveStressMonths": int(stress_path["positive_months"]) >= 2,
                "stressAbsoluteLcb14Positive": float(stress_abs["14"]["lower90Usdt"]) > 0.0,
                "stressBenchmarkExcessLcb14Positive": float(stress_excess["14"]["lower90Usdt"])
                > 0.0,
                "stressDrawdown": float(stress_path["maximum_drawdown_pct"]) <= 25.0,
                "stressNetPositive": float(stress_path["net_usdt"]) > 0.0,
                "validFormations": int(stress_path["valid_formations"]) >= 8,
            }
        payload["gateChecks"] = checks
        payload["fullPass"] = all(checks.values())
        payload["holmAdjustedP"] = adjusted[trial.trial_id]
        payload["rawBaseP"] = base_p[trial.trial_id]
    return (
        {
            "pboDiagnostic": pbo,
            "trialCount": len(trials),
            "trials": sorted(
                trial_payloads, key=lambda value: str(value["parameters"]["trial_id"])
            ),
            "whiteRealityCheckPAgainstAlwaysOn": white_benchmark,
            "whiteRealityCheckPAgainstCash": white_cash,
        },
        path_map,
    )


def _formation_public(formation: Formation) -> dict[str, Any]:
    payload = asdict(formation)
    payload["entry_day"] = formation.entry_day.isoformat()
    payload["cutoff_day"] = formation.cutoff_day.isoformat()
    for key in ("recent_sync", "older_sync", "shock"):
        value = payload[key]
        payload[key] = None if value is None else round(float(value), 10)
    return payload


def _champion_sort_key(payload: Mapping[str, Any]) -> tuple[Any, ...]:
    scenarios = cast(Mapping[str, Any], payload["scenarios"])
    stress = cast(Mapping[str, Any], scenarios["PUBLIC_STRESS"])
    bootstrap = cast(Mapping[str, Any], stress["absoluteBootstrap"])
    block14 = cast(Mapping[str, Any], bootstrap["14"])
    path = cast(Mapping[str, Any], stress["path"])
    params = cast(Mapping[str, Any], payload["parameters"])
    return (
        -float(block14["lower90Usdt"]),
        -float(path["net_usdt"]),
        -int(params["recent_days"]),
        -float(params["threshold"]),
        int(params["hold_days"]),
        str(params["trial_id"]),
    )


def _run_marker_payload(candidate_commit: str, freeze: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "allowedRunCount": 1,
        "candidateCommit": candidate_commit,
        "holdoutOpened": False,
        "networkAllowed": False,
        "protocolCommit": freeze["protocolCommit"],
        "schema": "VG37RunMarkerV1",
        "sourceManifestSha256": freeze["sourceManifestSha256"],
        "state": "CONSUMED_BEFORE_FIRST_DEVELOPMENT_ARCHIVE_MEMBER_OPEN",
    }


def _holdout_marker_payload(
    candidate_commit: str,
    freeze: Mapping[str, Any],
    champion_trial_id: str,
    development_core_sha: str,
) -> dict[str, Any]:
    return {
        "allowedOpenCount": 1,
        "candidateCommit": candidate_commit,
        "championTrialId": champion_trial_id,
        "developmentCoreSha256": development_core_sha,
        "protocolCommit": freeze["protocolCommit"],
        "schema": "VG37HoldoutOpenMarkerV1",
        "sourceManifestSha256": freeze["sourceManifestSha256"],
        "state": "CONSUMED_BEFORE_FIRST_HOLDOUT_ARCHIVE_MEMBER_OPEN",
    }


def command_run(candidate_commit: str) -> None:
    """Execute the sole development run and conditional holdout open."""

    assert_clean_head(candidate_commit)
    if any(
        path.exists()
        for path in (
            RUN_MARKER_PATH,
            HOLDOUT_MARKER_PATH,
            TERMINAL_CORE_PATH,
            RESULT_PATH,
            HANDOFF_PATH,
            SHA256SUMS_PATH,
        )
    ):
        raise VG37Error("RUN_OR_TERMINAL_STATE_ALREADY_EXISTS")
    manifest, freeze = verify_static_freeze()
    parent = git_output("rev-parse", f"{candidate_commit}^")
    if parent != freeze.get("protocolCommit"):
        raise VG37Error(f"FREEZE_COMMIT_PARENT_MISMATCH:{parent}")
    marker = _run_marker_payload(candidate_commit, freeze)
    write_exclusive(RUN_MARKER_PATH, marker)

    try:
        manifest_index = _manifest_index(manifest)
        trials = trial_grid()
        development_entries = sorted(
            {
                entry
                for trial in trials
                for entry in formation_days(DEVELOPMENT_START, DEVELOPMENT_END, trial.hold_days)
            }
        )
        development_keys = required_archive_keys(
            manifest_index, development_entries, DEVELOPMENT_BODY_MONTHS
        )
        bars = load_archive_keys(manifest_index, development_keys)
        formations = compute_formations(bars, manifest_index, development_entries)
        development, _ = evaluate_partition(
            trials,
            formations,
            bars,
            DEVELOPMENT_START,
            DEVELOPMENT_END,
            development=True,
        )
        development["archiveMembersOpened"] = len(development_keys)
        development["formations"] = [
            _formation_public(formations[key]) for key in sorted(formations)
        ]
        passed = [
            payload
            for payload in cast(list[dict[str, Any]], development["trials"])
            if bool(payload["fullPass"])
        ]
        diagnostic = min(
            cast(list[dict[str, Any]], development["trials"]),
            key=_champion_sort_key,
        )
        diagnostic_id = str(diagnostic["parameters"]["trial_id"])
        development["diagnosticBestTrialId"] = diagnostic_id
        development["fullPassCount"] = len(passed)
        development["holdoutQualified"] = bool(passed)

        core_base: dict[str, Any] = {
            "accountEffectiveCommission": "UNKNOWN",
            "authority": {
                "capital": "NONE",
                "execution": "NONE",
                "ordersTransfersWithdrawals": "FORBIDDEN",
            },
            "candidateCommit": candidate_commit,
            "capacity": {
                "executable": "UNMEASURED",
                "proxy": "ONE_BP_LAGGED_PUBLIC_QUOTE_VOLUME_ONLY",
            },
            "costScenarios": {
                scenario.name: {
                    "adverseExecutionBpsPerFill": scenario.adverse_rate * 10_000.0,
                    "feeBpsPerFill": scenario.fee_rate * 10_000.0,
                }
                for scenario in SCENARIOS
            },
            "development": development,
            "effect": {
                "deployed": False,
                "moneyMovedUsd": 0,
                "orders": 0,
            },
            "globalMultiplicity": {
                "programWideAttemptCount": "UNKNOWN",
                "sharedVolumeFamilyHoldoutIndependence": "NOT_CERTIFIED",
                "verifiedPositiveEligible": False,
            },
            "holdout": {
                "archiveMembersOpened": 0,
                "markerCreated": False,
                "state": "SEALED_UNOPENED",
            },
            "protocolCommit": freeze["protocolCommit"],
            "runControl": {
                "developmentMarkerSha256": sha256_path(RUN_MARKER_PATH),
                "developmentRunCount": 1,
                "holdoutOpenCount": 0,
                "networkDuringEvaluation": False,
            },
            "schema": "VG37TerminalResultCoreV1",
            "source": {
                "developmentArchiveMembersOpened": len(development_keys),
                "frozenArtifactPairs": manifest["artifactPairCount"],
                "frozenSymbols": manifest["symbolCount"],
                "holdoutArchiveMembersOpened": 0,
                "sourceManifestSha256": freeze["sourceManifestSha256"],
            },
        }
        if not passed:
            core_base["verdict"] = "NO_GO"
            core_base["verdictReason"] = "NO_DEVELOPMENT_TRIAL_PASSED_ALL_FROZEN_GATES"
            core_base["capitalVerdict"] = "NO_GO"
            write_terminal(core_base)
            return

        champion_payload = min(passed, key=_champion_sort_key)
        champion_params = cast(dict[str, Any], champion_payload["parameters"])
        champion = Trial(
            trial_id=str(champion_params["trial_id"]),
            recent_days=int(champion_params["recent_days"]),
            threshold=float(champion_params["threshold"]),
            hold_days=int(champion_params["hold_days"]),
        )
        development_core_sha = sha256_bytes(canonical_bytes(core_base))
        holdout_marker = _holdout_marker_payload(
            candidate_commit,
            freeze,
            champion.trial_id,
            development_core_sha,
        )
        write_exclusive(HOLDOUT_MARKER_PATH, holdout_marker)
        holdout_entries = formation_days(HOLDOUT_START, HOLDOUT_END, champion.hold_days)
        holdout_all_keys = required_archive_keys(manifest_index, holdout_entries, SOURCE_MONTHS)
        development_key_set = set(development_keys)
        holdout_keys = tuple(key for key in holdout_all_keys if key not in development_key_set)
        bars = load_archive_keys(manifest_index, holdout_keys, bars)
        holdout_formations = compute_formations(bars, manifest_index, holdout_entries)
        holdout, _ = evaluate_partition(
            (champion,),
            holdout_formations,
            bars,
            HOLDOUT_START,
            HOLDOUT_END,
            development=False,
        )
        holdout["archiveMembersOpened"] = len(holdout_keys)
        holdout["formations"] = [
            _formation_public(holdout_formations[key]) for key in sorted(holdout_formations)
        ]
        holdout_trial = cast(list[dict[str, Any]], holdout["trials"])[0]
        core_base["holdout"] = {
            **holdout,
            "championTrialId": champion.trial_id,
            "markerCreated": True,
            "markerSha256": sha256_path(HOLDOUT_MARKER_PATH),
            "state": "OPENED_ONCE_CHAMPION_ONLY",
        }
        core_base["runControl"] = {
            **cast(dict[str, Any], core_base["runControl"]),
            "holdoutOpenCount": 1,
        }
        core_base["source"] = {
            **cast(dict[str, Any], core_base["source"]),
            "holdoutArchiveMembersOpened": len(holdout_keys),
        }
        core_base["verdict"] = "GO" if holdout_trial["fullPass"] else "NO_GO"
        core_base["verdictReason"] = (
            "ALL_LOCAL_PUBLIC_SCENARIO_GATES_PASSED"
            if holdout_trial["fullPass"]
            else "CHAMPION_HOLDOUT_FAILED_ONE_OR_MORE_FROZEN_GATES"
        )
        core_base["capitalVerdict"] = "NO_GO"
        write_terminal(core_base)
    except VG37Error as error:
        core = {
            "accountEffectiveCommission": "UNKNOWN",
            "authority": {
                "capital": "NONE",
                "execution": "NONE",
            },
            "candidateCommit": candidate_commit,
            "capitalVerdict": "NO_GO",
            "error": str(error),
            "holdout": {
                "markerCreated": HOLDOUT_MARKER_PATH.exists(),
                "state": (
                    "OPEN_MARKER_CONSUMED" if HOLDOUT_MARKER_PATH.exists() else "SEALED_UNOPENED"
                ),
            },
            "protocolCommit": freeze["protocolCommit"],
            "schema": "VG37TerminalResultCoreV1",
            "verdict": "UNMEASURED",
            "verdictReason": "FROZEN_SOURCE_OR_MEASUREMENT_LAW_PREVENTED_ESTIMATE",
        }
        write_terminal(core)
    except Exception as error:
        core = {
            "accountEffectiveCommission": "UNKNOWN",
            "authority": {
                "capital": "NONE",
                "execution": "NONE",
            },
            "candidateCommit": candidate_commit,
            "capitalVerdict": "NO_GO",
            "error": f"{type(error).__name__}:{error}",
            "holdout": {
                "markerCreated": HOLDOUT_MARKER_PATH.exists(),
                "state": (
                    "OPEN_MARKER_CONSUMED" if HOLDOUT_MARKER_PATH.exists() else "SEALED_UNOPENED"
                ),
            },
            "protocolCommit": freeze["protocolCommit"],
            "schema": "VG37TerminalResultCoreV1",
            "verdict": "UNMEASURED",
            "verdictReason": "UNEXPECTED_POST_MARKER_FAILURE_PREVENTED_ESTIMATE",
        }
        write_terminal(core)


def write_terminal(core: Mapping[str, Any]) -> None:
    """Write immutable detailed core and compact result wrapper."""

    write_exclusive(TERMINAL_CORE_PATH, core)
    core_sha = sha256_path(TERMINAL_CORE_PATH)
    result = {
        "capitalVerdict": core["capitalVerdict"],
        "corePath": str(TERMINAL_CORE_PATH.relative_to(REPO_ROOT)),
        "coreSha256": core_sha,
        "schema": "VG37ResultV1",
        "state": "TERMINAL",
        "verdict": core["verdict"],
        "verdictReason": core["verdictReason"],
    }
    write_exclusive(RESULT_PATH, result)
    print(json.dumps(result, sort_keys=True))


def command_seal() -> None:
    """Create the data-free handoff and packet checksum inventory."""

    if HANDOFF_PATH.exists() or SHA256SUMS_PATH.exists():
        raise VG37Error("PACKET_ALREADY_SEALED")
    result = read_json(RESULT_PATH)
    core = read_json(TERMINAL_CORE_PATH)
    if result.get("coreSha256") != sha256_path(TERMINAL_CORE_PATH):
        raise VG37Error("TERMINAL_CORE_RESULT_MISMATCH")
    development = core.get("development")
    if isinstance(development, dict):
        diagnostic = str(development.get("diagnosticBestTrialId", "NONE"))
        pass_count = int(development.get("fullPassCount", 0))
    else:
        diagnostic = "NONE"
        pass_count = 0
    holdout = core.get("holdout")
    holdout_state = str(holdout.get("state", "UNKNOWN")) if isinstance(holdout, dict) else "UNKNOWN"
    handoff = (
        "# V-G37 terminal handoff\n\n"
        f"- Verdict: `{result['verdict']}`; reason: `{result['verdictReason']}`.\n"
        "- Capital verdict: `NO_GO`; execution/capital authority: `NONE`.\n"
        f"- Diagnostic development best: `{diagnostic}`; full pass count: "
        f"`{pass_count}`.\n"
        f"- Holdout: `{holdout_state}`.\n"
        "- Account-effective commission: `UNKNOWN`; executable capacity, book "
        "spread, impact, filters, and fills: `UNMEASURED`.\n"
        "- Consumer: `N3 successor/orchestrator scoreboard`.\n"
        "- Source-only candidate: not landed, not deployed, no UI/host/private "
        "API/order/transfer/withdrawal/money effect.\n"
    )
    write_text_exclusive(HANDOFF_PATH, handoff)
    packet_files = sorted(
        path for path in HERE.iterdir() if path.is_file() and path.name != SHA256SUMS_PATH.name
    )
    lines = [f"{sha256_path(path)}  {path.name}" for path in packet_files]
    write_text_exclusive(SHA256SUMS_PATH, "\n".join(lines) + "\n")
    print(
        json.dumps(
            {
                "fileCount": len(packet_files) + 1,
                "result": result["verdict"],
                "state": "PACKET_SEALED",
            },
            sort_keys=True,
        )
    )


def verify_packet() -> dict[str, Any]:
    """Authenticate packet and compressed source custody without decompression."""

    manifest, freeze = verify_static_freeze()
    result = read_json(RESULT_PATH)
    core = read_json(TERMINAL_CORE_PATH)
    if result.get("coreSha256") != sha256_path(TERMINAL_CORE_PATH):
        raise VG37Error("RESULT_CORE_SHA_MISMATCH")
    if result.get("verdict") != core.get("verdict"):
        raise VG37Error("RESULT_CORE_VERDICT_MISMATCH")
    marker = read_json(RUN_MARKER_PATH)
    if marker.get("candidateCommit") != core.get("candidateCommit"):
        raise VG37Error("RUN_MARKER_CANDIDATE_MISMATCH")
    if marker.get("sourceManifestSha256") != freeze.get("sourceManifestSha256"):
        raise VG37Error("RUN_MARKER_SOURCE_MISMATCH")
    holdout = core.get("holdout")
    if (
        isinstance(holdout, dict)
        and holdout.get("state") == "SEALED_UNOPENED"
        and HOLDOUT_MARKER_PATH.exists()
    ):
        raise VG37Error("UNOPENED_HOLDOUT_HAS_MARKER")
    if not SHA256SUMS_PATH.is_file():
        raise VG37Error("SHA256SUMS_REQUIRED")
    listed: set[str] = set()
    for line in SHA256SUMS_PATH.read_text(encoding="utf-8").splitlines():
        match = re.fullmatch(r"([0-9a-f]{64})  ([^\n]+)", line)
        if match is None:
            raise VG37Error("SHA256SUMS_LINE_INVALID")
        expected, name = match.groups()
        if name in listed:
            raise VG37Error(f"SHA256SUMS_DUPLICATE:{name}")
        listed.add(name)
        if sha256_path(HERE / name) != expected:
            raise VG37Error(f"PACKET_FILE_TAMPER:{name}")
    expected_names = {
        path.name for path in HERE.iterdir() if path.is_file() and path.name != SHA256SUMS_PATH.name
    }
    if listed != expected_names:
        raise VG37Error(f"SHA256SUMS_INVENTORY_MISMATCH:{sorted(expected_names ^ listed)}")
    raw_entries = manifest.get("artifactPairs")
    if not isinstance(raw_entries, list):
        raise VG37Error("SOURCE_MANIFEST_ENTRIES_REQUIRED")
    for raw in raw_entries:
        if not isinstance(raw, dict):
            raise VG37Error("SOURCE_MANIFEST_ENTRY_OBJECT_REQUIRED")
        verify_source_entry(raw)
    return {
        "candidateCommit": core["candidateCommit"],
        "compressedSourcePairsVerified": len(raw_entries),
        "holdoutState": (
            holdout.get("state", "UNKNOWN") if isinstance(holdout, dict) else "UNKNOWN"
        ),
        "packetFilesVerified": len(listed) + 1,
        "state": "VERIFIED_WITHOUT_ARCHIVE_MEMBER_OPEN",
        "verdict": result["verdict"],
    }


def command_verify() -> None:
    """Print compact verification proof."""

    print(json.dumps(verify_packet(), sort_keys=True))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    freeze = subparsers.add_parser("freeze")
    freeze.add_argument("--protocol-commit", required=True)
    run = subparsers.add_parser("run")
    run.add_argument("--candidate-commit", required=True)
    subparsers.add_parser("seal")
    subparsers.add_parser("verify")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = build_parser().parse_args(argv)
    if arguments.command == "freeze":
        command_freeze(str(arguments.protocol_commit))
    elif arguments.command == "run":
        command_run(str(arguments.candidate_commit))
    elif arguments.command == "seal":
        command_seal()
    elif arguments.command == "verify":
        command_verify()
    else:
        raise VG37Error(f"UNKNOWN_COMMAND:{arguments.command}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
