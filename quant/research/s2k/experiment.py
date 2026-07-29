"""S-2K sealed Binance Spot cross-sectional realized-skewness experiment.

Only ``acquire`` uses the network. It downloads and checksum-verifies the exact
frozen archive set without opening a ZIP. ``run`` creates a durable exclusive
marker before the first economic decompression, evaluates development once, and
opens the internally sealed holdout only after every development gate passes.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import os
import random
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
import zipfile
from collections.abc import Mapping, Sequence
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from datetime import time as datetime_time
from decimal import ROUND_HALF_EVEN, Context, Decimal, InvalidOperation, localcontext
from fractions import Fraction
from pathlib import Path
from typing import Any, Final, cast

PACKAGE_DIR: Final = Path(__file__).resolve().parent
REPO_ROOT: Final = PACKAGE_DIR.parents[2]
STATE_ROOT: Final = Path("/private/tmp/cosmos-s2k-realized-skewness-2afc-v1")
BASE_COMMIT: Final = "a169b123fb186d1943a75ad648552c4d95be1be1"
ARCHIVE_ROOT: Final = "https://data.binance.vision/data/spot/monthly/klines"
INTERVAL: Final = "5m"
USER_AGENT: Final = "cosmos-s2k-public-research/1.0"
DECIMAL_CONTEXT: Final = Context(prec=50, rounding=ROUND_HALF_EVEN)
FIVE_MINUTES: Final = timedelta(minutes=5)
DAY: Final = timedelta(days=1)
SHA256_PATTERN: Final = re.compile(r"^[0-9a-f]{64}$")
MONTH_PATTERN: Final = re.compile(r"^\d{4}-\d{2}$")
SYMBOL_PATTERN: Final = re.compile(r"^[A-Z0-9]+USDT$")
STATIC_FILES: Final = (
    ".gitignore",
    "DISTINCTNESS.md",
    "OFFICIAL_SOURCE_RESEARCH.md",
    "README.md",
    "__init__.py",
    "attempt_ledger.v1.json",
    "experiment.py",
    "official_sources.v1.json",
    "prior_period_inventory.v1.json",
    "protocol.v1.json",
    "source_plan.v1.json",
    "test_experiment.py",
    "verifier.py",
)
TERMINAL_NAMES: Final = (
    "RUN_STARTED.v1.json",
    "development.v1.json",
    "CANDIDATE_SEALED.v1.json",
    "HOLDOUT_OPENED.v1.json",
    "holdout.v1.json",
    "source_manifest.v1.json",
    "result.v1.json",
    "SHA256SUMS",
)
SCENARIO_ORDER: Final = ("gross", "publicRegular", "base", "stress", "severe")
IGNORED_RUNTIME_DIRECTORIES: Final = ("__pycache__", ".pytest_cache")


class EvidenceError(RuntimeError):
    """A fail-closed evidence or lifecycle violation."""


@dataclass(frozen=True)
class Bar:
    """One validated five-minute Binance Spot kline."""

    open_time: datetime
    open_price: Decimal
    close_price: Decimal
    base_volume: Decimal
    quote_volume: Decimal


@dataclass(frozen=True)
class Scenario:
    """One frozen per-fill public cost proxy."""

    name: str
    fee_bps: Decimal
    adverse_bps: Decimal


@dataclass(frozen=True)
class Leg:
    """One synthetic long or short leg."""

    symbol: str
    direction: int
    notional: Decimal
    entry_reference: Decimal
    exit_reference: Decimal
    entry_quote_volume: Decimal
    exit_quote_volume: Decimal


@dataclass(frozen=True)
class DayEvaluation:
    """One synchronous signal-day portfolio row."""

    signal_date: date
    signal_valid: bool
    active: bool
    cash_reason: str | None
    low_symbols: tuple[str, ...]
    high_symbols: tuple[str, ...]
    scenario_pnl: Mapping[str, Decimal]
    decompositions: Mapping[str, Mapping[str, Decimal]]
    rank_ic: Decimal | None
    capacity_events: Mapping[tuple[datetime, str], tuple[Decimal, Decimal]]
    mark_pnl: Mapping[str, tuple[Decimal, ...]]


def canonical_bytes(value: object) -> bytes:
    """Return deterministic JSON bytes."""

    return (
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n"
    ).encode("utf-8")


def utc_now_text() -> str:
    """Return an RFC3339 UTC timestamp without fractional seconds."""

    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def sha256_bytes(raw: bytes) -> str:
    """Hash bytes."""

    return hashlib.sha256(raw).hexdigest()


def sha256_path(path: Path) -> str:
    """Hash one regular file."""

    if not path.is_file() or path.is_symlink():
        raise EvidenceError(f"not a safe regular file: {path}")
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def fsync_directory(path: Path) -> None:
    """Durably sync a directory entry update."""

    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def exclusive_write(path: Path, raw: bytes) -> None:
    """Create a mode-0600 file once and fsync file plus directory."""

    path.parent.mkdir(parents=True, exist_ok=True)
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    descriptor = os.open(path, flags, 0o600)
    try:
        offset = 0
        while offset < len(raw):
            offset += os.write(descriptor, raw[offset:])
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    fsync_directory(path.parent)


def load_json(path: Path) -> tuple[dict[str, Any], bytes]:
    """Load a JSON object and preserve its exact bytes."""

    raw = path.read_bytes()
    try:
        value = json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError) as error:
        raise EvidenceError(f"invalid JSON: {path.name}") from error
    if not isinstance(value, dict):
        raise EvidenceError(f"JSON root must be an object: {path.name}")
    return cast(dict[str, Any], value), raw


def require_text(value: object, *, field: str) -> str:
    """Require a non-empty string."""

    if not isinstance(value, str) or not value:
        raise EvidenceError(f"{field} must be a non-empty string")
    return value


def require_int(value: object, *, field: str, minimum: int = 0) -> int:
    """Require an integer."""

    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise EvidenceError(f"{field} must be an integer >= {minimum}")
    return value


def decimal_value(
    value: object,
    *,
    field: str,
    minimum: Decimal | None = None,
    exclusive_minimum: bool = False,
) -> Decimal:
    """Parse a finite Decimal and apply an optional floor."""

    if isinstance(value, bool) or not isinstance(value, (str, int)):
        raise EvidenceError(f"{field} must be a decimal string or integer")
    try:
        result = Decimal(str(value))
    except InvalidOperation as error:
        raise EvidenceError(f"{field} is not decimal") from error
    if not result.is_finite():
        raise EvidenceError(f"{field} must be finite")
    if minimum is not None:
        if exclusive_minimum and result <= minimum:
            raise EvidenceError(f"{field} must be > {minimum}")
        if not exclusive_minimum and result < minimum:
            raise EvidenceError(f"{field} must be >= {minimum}")
    return result


def decimal_text(value: Decimal, places: int = 8) -> str:
    """Render a Decimal with deterministic bounded precision."""

    quantum = Decimal(1).scaleb(-places)
    with localcontext(DECIMAL_CONTEXT):
        rounded = value.quantize(quantum)
    text = format(rounded, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return "0" if text in {"-0", ""} else text


def date_value(value: object, *, field: str) -> date:
    """Parse an ISO date."""

    text = require_text(value, field=field)
    try:
        return date.fromisoformat(text)
    except ValueError as error:
        raise EvidenceError(f"{field} must be ISO date") from error


def month_range(first: str, last: str) -> tuple[str, ...]:
    """Expand inclusive YYYY-MM bounds."""

    if MONTH_PATTERN.fullmatch(first) is None or MONTH_PATTERN.fullmatch(last) is None:
        raise EvidenceError("month bounds malformed")
    cursor = date.fromisoformat(f"{first}-01")
    end = date.fromisoformat(f"{last}-01")
    result: list[str] = []
    while cursor <= end:
        result.append(cursor.strftime("%Y-%m"))
        if cursor.month == 12:
            cursor = date(cursor.year + 1, 1, 1)
        else:
            cursor = date(cursor.year, cursor.month + 1, 1)
    return tuple(result)


def day_range(first: date, last: date) -> tuple[date, ...]:
    """Expand inclusive daily bounds."""

    if last < first:
        raise EvidenceError("daily bounds reversed")
    return tuple(first + timedelta(days=index) for index in range((last - first).days + 1))


def git_output(*arguments: str) -> str:
    """Run one read-only Git query in the S-2K worktree."""

    completed = subprocess.run(
        ["git", "-C", str(REPO_ROOT), *arguments],
        check=True,
        capture_output=True,
        text=True,
    )
    return completed.stdout.strip()


def load_protocol() -> dict[str, Any]:
    """Load and validate critical immutable protocol identities."""

    protocol, _ = load_json(PACKAGE_DIR / "protocol.v1.json")
    if protocol.get("schema") != "S2KRealizedSkewnessProtocolV1":
        raise EvidenceError("protocol schema mismatch")
    if protocol.get("canonicalBaseCommit") != BASE_COMMIT:
        raise EvidenceError("protocol base mismatch")
    lifecycle = protocol.get("lifecycle")
    if not isinstance(lifecycle, dict) or lifecycle.get("stateRoot") != str(STATE_ROOT):
        raise EvidenceError("protocol state root mismatch")
    data = protocol.get("data")
    if not isinstance(data, dict):
        raise EvidenceError("protocol data block missing")
    if data.get("archiveTimestampUnit") != "MICROSECONDS":
        raise EvidenceError("protocol timestamp unit mismatch")
    if data.get("interval") != INTERVAL:
        raise EvidenceError("protocol interval mismatch")
    return protocol


def load_source_plan() -> tuple[dict[str, Any], tuple[str, ...], tuple[str, ...]]:
    """Load the exact direct archive set."""

    plan, _ = load_json(PACKAGE_DIR / "source_plan.v1.json")
    if plan.get("schema") != "S2KSourcePlanV1":
        raise EvidenceError("source plan schema mismatch")
    raw_symbols = plan.get("symbols")
    if not isinstance(raw_symbols, list):
        raise EvidenceError("source symbols missing")
    symbols = tuple(require_text(item, field="source.symbol") for item in raw_symbols)
    if len(symbols) != 20 or tuple(sorted(symbols)) != symbols or len(set(symbols)) != 20:
        raise EvidenceError("source symbols must be twenty unique sorted names")
    if any(SYMBOL_PATTERN.fullmatch(symbol) is None for symbol in symbols):
        raise EvidenceError("source symbol grammar mismatch")
    raw_months = plan.get("monthsInclusive")
    if not isinstance(raw_months, list) or len(raw_months) != 2:
        raise EvidenceError("source month bounds missing")
    months = month_range(
        require_text(raw_months[0], field="months.first"),
        require_text(raw_months[1], field="months.last"),
    )
    if len(months) * len(symbols) != require_int(
        plan.get("expectedArchiveCount"), field="expectedArchiveCount", minimum=1
    ):
        raise EvidenceError("source archive count mismatch")
    return plan, symbols, months


def static_hashes() -> dict[str, str]:
    """Hash every pre-outcome static input."""

    hashes: dict[str, str] = {}
    for name in STATIC_FILES:
        path = PACKAGE_DIR / name
        if not path.is_file() or path.is_symlink():
            raise EvidenceError(f"missing static input: {name}")
        hashes[name] = sha256_path(path)
    return hashes


def freeze_protocol() -> dict[str, Any]:
    """Create the pre-outcome static freeze exactly once."""

    load_protocol()
    load_source_plan()
    freeze_path = PACKAGE_DIR / "protocol.freeze.v1.json"
    if freeze_path.exists():
        raise EvidenceError("protocol freeze already exists")
    if STATE_ROOT.exists():
        raise EvidenceError("external state root already exists")
    if git_output("rev-parse", "HEAD") != BASE_COMMIT:
        raise EvidenceError("freeze must start at exact canonical base")
    for name in TERMINAL_NAMES:
        if (PACKAGE_DIR / name).exists():
            raise EvidenceError(f"terminal artifact exists before freeze: {name}")
    STATE_ROOT.mkdir(mode=0o700, parents=True)
    fsync_directory(STATE_ROOT.parent)
    payload = {
        "schema": "S2KProtocolFreezeV1",
        "createdAtUtc": utc_now_text(),
        "canonicalBaseCommit": BASE_COMMIT,
        "scope": "quant/research/s2k/**",
        "python": {
            "implementation": sys.implementation.name,
            "version": sys.version.split()[0],
        },
        "decimal": {
            "precision": DECIMAL_CONTEXT.prec,
            "rounding": DECIMAL_CONTEXT.rounding,
        },
        "stateRoot": str(STATE_ROOT),
        "staticFileSha256": static_hashes(),
        "archiveBodiesOpened": 0,
        "economicRunCount": 0,
        "holdoutOpenCount": 0,
    }
    raw = canonical_bytes(payload)
    exclusive_write(freeze_path, raw)
    exclusive_write(STATE_ROOT / "protocol.freeze.v1.json", raw)
    return payload


def load_freeze() -> tuple[dict[str, Any], str]:
    """Authenticate the static freeze and all frozen input bytes."""

    path = PACKAGE_DIR / "protocol.freeze.v1.json"
    freeze, raw = load_json(path)
    if freeze.get("schema") != "S2KProtocolFreezeV1":
        raise EvidenceError("freeze schema mismatch")
    if freeze.get("canonicalBaseCommit") != BASE_COMMIT:
        raise EvidenceError("freeze base mismatch")
    if freeze.get("stateRoot") != str(STATE_ROOT):
        raise EvidenceError("freeze state root mismatch")
    expected = freeze.get("staticFileSha256")
    if not isinstance(expected, dict) or expected != static_hashes():
        raise EvidenceError("static input drift after freeze")
    external = STATE_ROOT / "protocol.freeze.v1.json"
    if not external.is_file() or external.read_bytes() != raw:
        raise EvidenceError("external freeze copy mismatch")
    return freeze, sha256_bytes(raw)


def archive_identity(symbol: str, month: str) -> tuple[str, str, str]:
    """Return filename, archive URL, and checksum URL."""

    filename = f"{symbol}-{INTERVAL}-{month}.zip"
    url = f"{ARCHIVE_ROOT}/{symbol}/{INTERVAL}/{filename}"
    return filename, url, f"{url}.CHECKSUM"


def http_get(url: str, *, retries: int = 4) -> tuple[bytes, Mapping[str, str]]:
    """GET one public object with bounded retry and response metadata."""

    last_error: BaseException | None = None
    for attempt in range(retries):
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                if response.status != 200:
                    raise EvidenceError(f"unexpected HTTP status {response.status}")
                raw = response.read()
                headers = {
                    "etag": response.headers.get("ETag", ""),
                    "lastModified": response.headers.get("Last-Modified", ""),
                    "contentLength": response.headers.get("Content-Length", ""),
                }
                return raw, headers
        except (TimeoutError, urllib.error.URLError, OSError) as error:
            last_error = error
            if attempt + 1 < retries:
                time.sleep(0.25 * (2**attempt))
    raise EvidenceError("public archive request failed after bounded retry") from last_error


def parse_checksum_sidecar(raw: bytes, expected_filename: str) -> str:
    """Parse an exact Binance SHA-256 sidecar."""

    try:
        text = raw.decode("ascii").strip()
    except UnicodeDecodeError as error:
        raise EvidenceError("checksum sidecar must be ASCII") from error
    fields = text.split()
    if len(fields) != 2:
        raise EvidenceError("checksum sidecar must contain digest and filename")
    digest, filename = fields
    if SHA256_PATTERN.fullmatch(digest) is None or filename.lstrip("*") != expected_filename:
        raise EvidenceError("checksum sidecar identity mismatch")
    return digest


def artifact_path(symbol: str, month: str) -> Path:
    """Return the external immutable archive path."""

    return STATE_ROOT / "archives" / symbol / f"{symbol}-{INTERVAL}-{month}.zip"


def download_pair(symbol: str, month: str) -> dict[str, object]:
    """Download and bind one ZIP plus checksum pair without opening the ZIP."""

    filename, url, checksum_url = archive_identity(symbol, month)
    target = artifact_path(symbol, month)
    checksum_raw, checksum_headers = http_get(checksum_url)
    expected_sha = parse_checksum_sidecar(checksum_raw, filename)
    archive_headers: Mapping[str, str]
    if target.exists():
        if not target.is_file() or target.is_symlink():
            raise EvidenceError(f"unsafe pre-existing archive target: {filename}")
        archive_raw = target.read_bytes()
        archive_headers = {"etag": "", "lastModified": "", "contentLength": ""}
        acquisition_mode = "REUSED_CHECKSUM_VERIFIED_PREVIOUS_DOWNLOAD"
    else:
        archive_raw, archive_headers = http_get(url)
        acquisition_mode = "DOWNLOADED"
    archive_sha = sha256_bytes(archive_raw)
    if archive_sha != expected_sha:
        raise EvidenceError(f"archive checksum mismatch: {filename}")
    if not target.exists():
        exclusive_write(target, archive_raw)
    return {
        "symbol": symbol,
        "month": month,
        "filename": filename,
        "url": url,
        "checksumUrl": checksum_url,
        "archiveSha256": archive_sha,
        "archiveByteLength": len(archive_raw),
        "checksumSidecarSha256": sha256_bytes(checksum_raw),
        "checksumSidecarByteLength": len(checksum_raw),
        "checksumSidecarAscii": checksum_raw.decode("ascii"),
        "archiveEtag": archive_headers["etag"],
        "archiveLastModified": archive_headers["lastModified"],
        "archiveContentLength": archive_headers["contentLength"],
        "checksumEtag": checksum_headers["etag"],
        "checksumLastModified": checksum_headers["lastModified"],
        "retrievedAtUtc": utc_now_text(),
        "acquisitionMode": acquisition_mode,
        "localRelativePath": str(target.relative_to(STATE_ROOT)),
        "openState": "CHECKSUM_VERIFIED_NOT_DECOMPRESSED",
        "member": None,
    }


def acquire_archives(workers: int) -> dict[str, Any]:
    """Acquire all frozen public archives without decompression."""

    _, freeze_sha = load_freeze()
    _, symbols, months = load_source_plan()
    if workers < 1 or workers > 16:
        raise EvidenceError("workers must be in [1,16]")
    acquisition_path = STATE_ROOT / "acquisition.v1.json"
    if acquisition_path.exists():
        raise EvidenceError("acquisition receipt already exists")
    if any((PACKAGE_DIR / name).exists() for name in TERMINAL_NAMES):
        raise EvidenceError("terminal artifact exists before acquisition")
    tasks = [(symbol, month) for symbol in symbols for month in months]
    entries: list[dict[str, object]] = []
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {
            executor.submit(download_pair, symbol, month): (symbol, month)
            for symbol, month in tasks
        }
        for future in as_completed(futures):
            entries.append(future.result())
    entries.sort(key=lambda item: (str(item["symbol"]), str(item["month"])))
    if len(entries) != len(tasks):
        raise EvidenceError("acquisition entry count mismatch")
    payload: dict[str, Any] = {
        "schema": "S2KAcquisitionV1",
        "createdAtUtc": utc_now_text(),
        "protocolFreezeSha256": freeze_sha,
        "archiveBodiesOpened": 0,
        "archiveCount": len(entries),
        "checksumCount": len(entries),
        "entries": entries,
    }
    exclusive_write(acquisition_path, canonical_bytes(payload))
    return payload


def load_acquisition() -> tuple[dict[str, Any], str]:
    """Authenticate the complete external acquisition receipt."""

    _, freeze_sha = load_freeze()
    path = STATE_ROOT / "acquisition.v1.json"
    acquisition, raw = load_json(path)
    if acquisition.get("schema") != "S2KAcquisitionV1":
        raise EvidenceError("acquisition schema mismatch")
    if acquisition.get("protocolFreezeSha256") != freeze_sha:
        raise EvidenceError("acquisition freeze binding mismatch")
    if acquisition.get("archiveBodiesOpened") != 0:
        raise EvidenceError("acquisition must not open archive bodies")
    if acquisition.get("archiveCount") != 260 or acquisition.get("checksumCount") != 260:
        raise EvidenceError("acquisition top-level counts must both be 260")
    entries = acquisition.get("entries")
    if not isinstance(entries, list) or len(entries) != 260:
        raise EvidenceError("acquisition must contain 260 entries")
    seen: set[tuple[str, str]] = set()
    for raw_entry in entries:
        if not isinstance(raw_entry, dict):
            raise EvidenceError("acquisition entry malformed")
        symbol = require_text(raw_entry.get("symbol"), field="entry.symbol")
        month = require_text(raw_entry.get("month"), field="entry.month")
        identity = (symbol, month)
        if identity in seen:
            raise EvidenceError("duplicate acquisition identity")
        seen.add(identity)
        filename, url, checksum_url = archive_identity(symbol, month)
        if (
            raw_entry.get("filename") != filename
            or raw_entry.get("url") != url
            or raw_entry.get("checksumUrl") != checksum_url
        ):
            raise EvidenceError("acquisition URL identity mismatch")
        if (
            raw_entry.get("openState") != "CHECKSUM_VERIFIED_NOT_DECOMPRESSED"
            or raw_entry.get("member") is not None
        ):
            raise EvidenceError("acquisition entry was opened before the run marker")
        expected_sha = require_text(raw_entry.get("archiveSha256"), field="entry.archiveSha256")
        if SHA256_PATTERN.fullmatch(expected_sha) is None:
            raise EvidenceError("acquisition archive digest malformed")
        path_value = require_text(
            raw_entry.get("localRelativePath"), field="entry.localRelativePath"
        )
        local_path = STATE_ROOT / path_value
        if local_path.resolve() != artifact_path(symbol, month).resolve():
            raise EvidenceError("acquisition local path mismatch")
        if sha256_path(local_path) != expected_sha:
            raise EvidenceError("acquired archive drift")
        if (
            require_int(
                raw_entry.get("archiveByteLength"),
                field="entry.archiveByteLength",
                minimum=1,
            )
            != local_path.stat().st_size
        ):
            raise EvidenceError("acquisition archive byte length mismatch")
        checksum_ascii = require_text(
            raw_entry.get("checksumSidecarAscii"), field="entry.checksumSidecarAscii"
        )
        if parse_checksum_sidecar(checksum_ascii.encode("ascii"), filename) != expected_sha:
            raise EvidenceError("acquisition sidecar digest mismatch")
        if sha256_bytes(checksum_ascii.encode("ascii")) != raw_entry.get("checksumSidecarSha256"):
            raise EvidenceError("acquisition sidecar byte hash mismatch")
        if require_int(
            raw_entry.get("checksumSidecarByteLength"),
            field="entry.checksumSidecarByteLength",
            minimum=1,
        ) != len(checksum_ascii.encode("ascii")):
            raise EvidenceError("acquisition sidecar byte length mismatch")
    _, symbols, months = load_source_plan()
    if seen != {(symbol, month) for symbol in symbols for month in months}:
        raise EvidenceError("acquisition set differs from frozen source plan")
    return acquisition, sha256_bytes(raw)


def month_bounds(month: str) -> tuple[datetime, datetime]:
    """Return inclusive-start/exclusive-end UTC bounds for a month."""

    start_date = date.fromisoformat(f"{month}-01")
    if start_date.month == 12:
        end_date = date(start_date.year + 1, 1, 1)
    else:
        end_date = date(start_date.year, start_date.month + 1, 1)
    return (
        datetime.combine(start_date, datetime_time(), UTC),
        datetime.combine(end_date, datetime_time(), UTC),
    )


def parse_microsecond_timestamp(value: str, *, field: str) -> datetime:
    """Parse an explicitly declared microsecond Unix timestamp."""

    try:
        raw = int(value)
    except ValueError as error:
        raise EvidenceError(f"{field} timestamp is not integer") from error
    if raw < 1_735_689_600_000_000 or raw % 300_000_000 != 0:
        raise EvidenceError(f"{field} timestamp is not aligned declared microseconds")
    return datetime.fromtimestamp(raw / 1_000_000, UTC)


def parse_decimal_csv(
    value: str,
    *,
    field: str,
    minimum: Decimal = Decimal(0),
    exclusive_minimum: bool = False,
) -> Decimal:
    """Parse a finite numeric CSV field."""

    try:
        result = Decimal(value)
    except InvalidOperation as error:
        raise EvidenceError(f"{field} is not decimal") from error
    if not result.is_finite():
        raise EvidenceError(f"{field} is not finite")
    if exclusive_minimum and result <= minimum:
        raise EvidenceError(f"{field} must be > {minimum}")
    if not exclusive_minimum and result < minimum:
        raise EvidenceError(f"{field} must be >= {minimum}")
    return result


def parse_archive(
    path: Path,
    *,
    symbol: str,
    month: str,
    expected_sha256: str,
) -> tuple[tuple[Bar, ...], dict[str, object]]:
    """Open and validate one exact Binance monthly 5m archive."""

    raw = path.read_bytes()
    if sha256_bytes(raw) != expected_sha256:
        raise EvidenceError("archive changed before decompression")
    expected_member = f"{symbol}-{INTERVAL}-{month}.csv"
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            infos = archive.infolist()
            if (
                len(infos) != 1
                or infos[0].is_dir()
                or infos[0].filename != expected_member
                or Path(infos[0].filename).name != infos[0].filename
            ):
                raise EvidenceError("archive member geometry mismatch")
            member_raw = archive.read(infos[0])
    except zipfile.BadZipFile as error:
        raise EvidenceError("invalid ZIP archive") from error
    try:
        text = member_raw.decode("utf-8")
    except UnicodeDecodeError as error:
        raise EvidenceError("archive CSV is not UTF-8") from error
    start, end = month_bounds(month)
    bars: list[Bar] = []
    seen: set[datetime] = set()
    reader = csv.reader(io.StringIO(text, newline=""))
    for row_number, row in enumerate(reader, start=1):
        if row_number == 1 and row and row[0].lower() in {"open_time", "open time"}:
            continue
        if len(row) != 12:
            raise EvidenceError("archive CSV row must have twelve columns")
        open_time = parse_microsecond_timestamp(row[0], field="open")
        try:
            close_raw = int(row[6])
        except ValueError as error:
            raise EvidenceError("close timestamp is not integer") from error
        expected_close = int(open_time.timestamp() * 1_000_000) + 299_999_999
        if close_raw != expected_close:
            raise EvidenceError("five-minute close boundary mismatch")
        if not start <= open_time < end or open_time in seen:
            raise EvidenceError("archive partition or duplicate timestamp violation")
        seen.add(open_time)
        open_price = parse_decimal_csv(row[1], field="open price", exclusive_minimum=True)
        close_price = parse_decimal_csv(row[4], field="close price", exclusive_minimum=True)
        base_volume = parse_decimal_csv(row[5], field="base volume")
        quote_volume = parse_decimal_csv(row[7], field="quote volume")
        bars.append(
            Bar(
                open_time=open_time,
                open_price=open_price,
                close_price=close_price,
                base_volume=base_volume,
                quote_volume=quote_volume,
            )
        )
    if not bars:
        raise EvidenceError("archive contains no data rows")
    bars.sort(key=lambda bar: bar.open_time)
    member = {
        "name": expected_member,
        "sha256": sha256_bytes(member_raw),
        "byteLength": len(member_raw),
        "rowCount": len(bars),
        "firstOpenTimeUtc": bars[0].open_time.isoformat().replace("+00:00", "Z"),
        "lastOpenTimeUtc": bars[-1].open_time.isoformat().replace("+00:00", "Z"),
        "timestampUnit": "MICROSECONDS",
        "columns": 12,
    }
    return tuple(bars), member


def acquisition_entry_map(
    acquisition: Mapping[str, Any],
) -> dict[tuple[str, str], dict[str, object]]:
    """Copy acquisition entries into a mutable identity map for run receipts."""

    raw_entries = acquisition.get("entries")
    if not isinstance(raw_entries, list):
        raise EvidenceError("acquisition entries missing")
    result: dict[tuple[str, str], dict[str, object]] = {}
    for raw_entry in raw_entries:
        if not isinstance(raw_entry, dict):
            raise EvidenceError("acquisition entry malformed")
        entry = cast(dict[str, object], dict(raw_entry))
        identity = (
            require_text(entry.get("symbol"), field="entry.symbol"),
            require_text(entry.get("month"), field="entry.month"),
        )
        if identity in result:
            raise EvidenceError("duplicate acquisition entry")
        result[identity] = entry
    return result


def load_months(
    entries: dict[tuple[str, str], dict[str, object]],
    *,
    symbols: Sequence[str],
    months: Sequence[str],
    open_state: str,
) -> dict[str, dict[datetime, Bar]]:
    """Decompress an exact month set and record every opened member."""

    bars_by_symbol: dict[str, dict[datetime, Bar]] = {symbol: {} for symbol in symbols}
    for symbol in symbols:
        for month in months:
            identity = (symbol, month)
            entry = entries.get(identity)
            if entry is None:
                raise EvidenceError("required acquisition entry missing")
            expected_sha = require_text(entry.get("archiveSha256"), field="entry.archiveSha256")
            entry["openState"] = f"{open_state}_STARTED"
            bars, member = parse_archive(
                artifact_path(symbol, month),
                symbol=symbol,
                month=month,
                expected_sha256=expected_sha,
            )
            destination = bars_by_symbol[symbol]
            for bar in bars:
                if bar.open_time in destination:
                    raise EvidenceError("duplicate bar across monthly partitions")
                destination[bar.open_time] = bar
            entry["openState"] = open_state
            entry["member"] = member
    return bars_by_symbol


def scenario_specs(protocol: Mapping[str, Any]) -> tuple[Scenario, ...]:
    """Load the five frozen per-fill cost scenarios."""

    costs = protocol.get("costs")
    if not isinstance(costs, dict):
        raise EvidenceError("protocol costs missing")
    raw_scenarios = costs.get("scenariosBpsPerFill")
    if not isinstance(raw_scenarios, dict):
        raise EvidenceError("protocol scenarios missing")
    scenarios: list[Scenario] = []
    for name in SCENARIO_ORDER:
        raw = raw_scenarios.get(name)
        if not isinstance(raw, dict):
            raise EvidenceError(f"scenario missing: {name}")
        scenarios.append(
            Scenario(
                name=name,
                fee_bps=decimal_value(raw.get("fee"), field=f"{name}.fee", minimum=Decimal(0)),
                adverse_bps=decimal_value(
                    raw.get("adverseExecution"),
                    field=f"{name}.adverseExecution",
                    minimum=Decimal(0),
                ),
            )
        )
    return tuple(scenarios)


def execution_reference(bar: Bar) -> Decimal | None:
    """Return public execution-bar quote/base VWAP when measurable."""

    if bar.base_volume <= 0 or bar.quote_volume <= 0:
        return None
    with localcontext(DECIMAL_CONTEXT):
        reference = bar.quote_volume / bar.base_volume
    return reference if reference > 0 and reference.is_finite() else None


def realized_skewness(
    bars: Mapping[datetime, Bar], signal_date: date, bars_per_day: int
) -> Decimal | None:
    """Compute the frozen raw five-minute realized-skewness statistic."""

    start = datetime.combine(signal_date, datetime_time(), UTC)
    previous_timestamp = start - FIVE_MINUTES
    previous = bars.get(previous_timestamp)
    if previous is None:
        return None
    previous_close = previous.close_price
    returns: list[Decimal] = []
    with localcontext(DECIMAL_CONTEXT):
        for offset in range(bars_per_day):
            timestamp = start + offset * FIVE_MINUTES
            bar = bars.get(timestamp)
            if bar is None or bar.close_price <= 0 or previous_close <= 0:
                return None
            returns.append((bar.close_price / previous_close).ln())
            previous_close = bar.close_price
        variance = sum((value * value for value in returns), Decimal(0))
        if variance <= 0:
            return None
        third = sum((value * value * value for value in returns), Decimal(0))
        return Decimal(bars_per_day).sqrt() * third / (variance * variance.sqrt())


def average_ranks(values: Mapping[str, Decimal]) -> dict[str, Decimal]:
    """Assign deterministic average ranks, preserving exact Decimal ties."""

    ordered = sorted(values.items(), key=lambda item: (item[1], item[0]))
    ranks: dict[str, Decimal] = {}
    cursor = 0
    while cursor < len(ordered):
        end = cursor + 1
        while end < len(ordered) and ordered[end][1] == ordered[cursor][1]:
            end += 1
        rank = (Decimal(cursor + 1) + Decimal(end)) / Decimal(2)
        for index in range(cursor, end):
            ranks[ordered[index][0]] = rank
        cursor = end
    return ranks


def spearman(values_x: Mapping[str, Decimal], values_y: Mapping[str, Decimal]) -> Decimal:
    """Return the Pearson correlation of deterministic average ranks."""

    if set(values_x) != set(values_y) or len(values_x) < 3:
        raise EvidenceError("rank-correlation cohort mismatch")
    ranks_x = average_ranks(values_x)
    ranks_y = average_ranks(values_y)
    symbols = tuple(sorted(values_x))
    with localcontext(DECIMAL_CONTEXT):
        mean_x = sum((ranks_x[symbol] for symbol in symbols), Decimal(0)) / Decimal(len(symbols))
        mean_y = sum((ranks_y[symbol] for symbol in symbols), Decimal(0)) / Decimal(len(symbols))
        centered_x = [ranks_x[symbol] - mean_x for symbol in symbols]
        centered_y = [ranks_y[symbol] - mean_y for symbol in symbols]
        numerator = sum(
            (left * right for left, right in zip(centered_x, centered_y, strict=True)),
            Decimal(0),
        )
        denominator_x = sum((value * value for value in centered_x), Decimal(0))
        denominator_y = sum((value * value for value in centered_y), Decimal(0))
        if denominator_x <= 0 or denominator_y <= 0:
            raise EvidenceError("rank-correlation variance is zero")
        return numerator / (denominator_x * denominator_y).sqrt()


def leg_components(leg: Leg, scenario: Scenario) -> tuple[Decimal, Decimal, Decimal]:
    """Return net PnL, adverse-execution cost, and fee cost for one leg."""

    with localcontext(DECIMAL_CONTEXT):
        adverse = scenario.adverse_bps / Decimal(10_000)
        fee = scenario.fee_bps / Decimal(10_000)
        if leg.direction == 1:
            entry_execution = leg.entry_reference * (Decimal(1) + adverse)
            exit_execution = leg.exit_reference * (Decimal(1) - adverse)
            ratio = exit_execution / entry_execution
            pre_fee = leg.notional * (ratio - Decimal(1))
            gross = leg.notional * (leg.exit_reference / leg.entry_reference - Decimal(1))
        elif leg.direction == -1:
            entry_execution = leg.entry_reference * (Decimal(1) - adverse)
            exit_execution = leg.exit_reference * (Decimal(1) + adverse)
            if entry_execution <= 0:
                raise EvidenceError("adversity makes short entry non-positive")
            ratio = exit_execution / entry_execution
            pre_fee = leg.notional * (Decimal(1) - ratio)
            gross = leg.notional * (Decimal(1) - leg.exit_reference / leg.entry_reference)
        else:
            raise EvidenceError("leg direction must be long or short")
        entry_fee = leg.notional * fee
        exit_fee = leg.notional * ratio * fee
        fee_cost = entry_fee + exit_fee
        adverse_cost = gross - pre_fee
        return pre_fee - fee_cost, adverse_cost, fee_cost


def cash_day(
    signal_date: date,
    *,
    signal_valid: bool,
    reason: str,
    scenarios: Sequence[Scenario],
    rank_ic: Decimal | None = None,
) -> DayEvaluation:
    """Construct one frozen full-cash synchronous row."""

    zeros = {scenario.name: Decimal(0) for scenario in scenarios}
    decompositions = {
        scenario.name: {
            "grossPnlUsd": Decimal(0),
            "adverseExecutionCostUsd": Decimal(0),
            "feeCostUsd": Decimal(0),
            "netPnlUsd": Decimal(0),
        }
        for scenario in scenarios
    }
    return DayEvaluation(
        signal_date=signal_date,
        signal_valid=signal_valid,
        active=False,
        cash_reason=reason,
        low_symbols=(),
        high_symbols=(),
        scenario_pnl=zeros,
        decompositions=decompositions,
        rank_ic=rank_ic,
        capacity_events={},
        mark_pnl={scenario.name: () for scenario in scenarios},
    )


def evaluate_signal_day(
    *,
    signal_date: date,
    bars_by_symbol: Mapping[str, Mapping[datetime, Bar]],
    symbols: Sequence[str],
    scenarios: Sequence[Scenario],
    tail_size: int,
    notional_per_leg: Decimal,
    bars_per_day: int,
) -> DayEvaluation:
    """Evaluate one causal signal day without replacing cohort members."""

    scores: dict[str, Decimal] = {}
    for symbol in symbols:
        score = realized_skewness(bars_by_symbol[symbol], signal_date, bars_per_day)
        if score is None:
            return cash_day(
                signal_date,
                signal_valid=False,
                reason=f"SIGNAL_UNAVAILABLE_{symbol}",
                scenarios=scenarios,
            )
        scores[symbol] = score
    ordered = sorted(scores, key=lambda symbol: (scores[symbol], symbol))
    boundary_tie = (
        scores[ordered[tail_size - 1]] == scores[ordered[tail_size]]
        or scores[ordered[-tail_size]] == scores[ordered[-tail_size - 1]]
    )
    low_symbols = tuple(ordered[:tail_size])
    high_symbols = tuple(ordered[-tail_size:])
    entry_timestamp = datetime.combine(signal_date + DAY, datetime_time(), UTC) + (FIVE_MINUTES)
    exit_timestamp = entry_timestamp + DAY

    entry_references: dict[str, Decimal] = {}
    entry_bars: dict[str, Bar] = {}
    for symbol in symbols:
        entry_bar = bars_by_symbol[symbol].get(entry_timestamp)
        if entry_bar is None:
            return cash_day(
                signal_date,
                signal_valid=True,
                reason=f"PRE_ENTRY_BAR_UNAVAILABLE_{symbol}",
                scenarios=scenarios,
            )
        reference = execution_reference(entry_bar)
        if reference is None:
            return cash_day(
                signal_date,
                signal_valid=True,
                reason=f"PRE_ENTRY_VWAP_UNAVAILABLE_{symbol}",
                scenarios=scenarios,
            )
        entry_bars[symbol] = entry_bar
        entry_references[symbol] = reference

    exit_references: dict[str, Decimal] = {}
    exit_bars: dict[str, Bar] = {}
    for symbol in symbols:
        exit_bar = bars_by_symbol[symbol].get(exit_timestamp)
        if exit_bar is None:
            raise EvidenceError(f"required post-entry exit bar unavailable: {symbol}")
        reference = execution_reference(exit_bar)
        if reference is None:
            raise EvidenceError(f"required post-entry exit VWAP unavailable: {symbol}")
        exit_bars[symbol] = exit_bar
        exit_references[symbol] = reference

    forward_returns = {
        symbol: exit_references[symbol] / entry_references[symbol] - Decimal(1)
        for symbol in symbols
    }
    negative_scores = {symbol: -scores[symbol] for symbol in symbols}
    rank_ic = spearman(negative_scores, forward_returns)
    if boundary_tie:
        return cash_day(
            signal_date,
            signal_valid=True,
            reason="TAIL_BOUNDARY_TIE",
            scenarios=scenarios,
            rank_ic=rank_ic,
        )

    legs: list[Leg] = []
    for symbol in low_symbols:
        legs.append(
            Leg(
                symbol=symbol,
                direction=1,
                notional=notional_per_leg,
                entry_reference=entry_references[symbol],
                exit_reference=exit_references[symbol],
                entry_quote_volume=entry_bars[symbol].quote_volume,
                exit_quote_volume=exit_bars[symbol].quote_volume,
            )
        )
    for symbol in high_symbols:
        legs.append(
            Leg(
                symbol=symbol,
                direction=-1,
                notional=notional_per_leg,
                entry_reference=entry_references[symbol],
                exit_reference=exit_references[symbol],
                entry_quote_volume=entry_bars[symbol].quote_volume,
                exit_quote_volume=exit_bars[symbol].quote_volume,
            )
        )

    scenario_pnl: dict[str, Decimal] = {}
    decompositions: dict[str, Mapping[str, Decimal]] = {}
    for scenario in scenarios:
        components = [leg_components(leg, scenario) for leg in legs]
        net = sum((component[0] for component in components), Decimal(0))
        adverse_cost = sum((component[1] for component in components), Decimal(0))
        fee_cost = sum((component[2] for component in components), Decimal(0))
        gross = sum((leg_components(leg, scenarios[0])[0] for leg in legs), Decimal(0))
        scenario_pnl[scenario.name] = net
        decompositions[scenario.name] = {
            "grossPnlUsd": gross,
            "adverseExecutionCostUsd": adverse_cost,
            "feeCostUsd": fee_cost,
            "netPnlUsd": net,
        }

    mark_pnl_lists: dict[str, list[Decimal]] = {scenario.name: [] for scenario in scenarios}
    cursor = entry_timestamp
    while cursor < exit_timestamp:
        mark_references: dict[str, Decimal] = {}
        for leg in legs:
            mark_bar = bars_by_symbol[leg.symbol].get(cursor)
            if mark_bar is None or mark_bar.close_price <= 0:
                raise EvidenceError(
                    f"required post-entry five-minute mark unavailable: {leg.symbol}"
                )
            mark_references[leg.symbol] = mark_bar.close_price
        for scenario in scenarios:
            mark_legs = [
                Leg(
                    symbol=leg.symbol,
                    direction=leg.direction,
                    notional=leg.notional,
                    entry_reference=leg.entry_reference,
                    exit_reference=mark_references[leg.symbol],
                    entry_quote_volume=leg.entry_quote_volume,
                    exit_quote_volume=Decimal(0),
                )
                for leg in legs
            ]
            mark_pnl_lists[scenario.name].append(
                sum(
                    (leg_components(mark_leg, scenario)[0] for mark_leg in mark_legs),
                    Decimal(0),
                )
            )
        cursor += FIVE_MINUTES
    for scenario in scenarios:
        mark_pnl_lists[scenario.name].append(scenario_pnl[scenario.name])

    capacity_events: dict[tuple[datetime, str], tuple[Decimal, Decimal]] = {}
    for leg in legs:
        entry_weight = leg.notional / Decimal(1000)
        exit_weight = leg.notional * leg.exit_reference / leg.entry_reference / Decimal(1000)
        capacity_events[(entry_timestamp, leg.symbol)] = (
            entry_weight,
            leg.entry_quote_volume,
        )
        capacity_events[(exit_timestamp, leg.symbol)] = (
            exit_weight,
            leg.exit_quote_volume,
        )
    return DayEvaluation(
        signal_date=signal_date,
        signal_valid=True,
        active=True,
        cash_reason=None,
        low_symbols=low_symbols,
        high_symbols=high_symbols,
        scenario_pnl=scenario_pnl,
        decompositions=decompositions,
        rank_ic=rank_ic,
        capacity_events=capacity_events,
        mark_pnl={name: tuple(values) for name, values in mark_pnl_lists.items()},
    )


def fraction_text(value: Fraction) -> str:
    """Render an exact probability fraction as a bounded decimal."""

    with localcontext(DECIMAL_CONTEXT):
        return decimal_text(Decimal(value.numerator) / Decimal(value.denominator), 10)


def nearest_rank(values: Sequence[Decimal], numerator: int, denominator: int) -> Decimal:
    """Return a deterministic nearest-rank quantile from non-empty values."""

    if not values or numerator < 0 or numerator > denominator or denominator <= 0:
        raise EvidenceError("invalid nearest-rank request")
    ordered = sorted(values)
    rank = (numerator * len(ordered) + denominator - 1) // denominator
    index = max(0, min(len(ordered) - 1, rank - 1))
    return ordered[index]


def bootstrap_family(
    primary_values: Sequence[Decimal],
    secondary_values: Sequence[Decimal],
    *,
    replicates: int,
    seed: int,
    block_length: int,
) -> tuple[dict[str, object], Fraction, Fraction]:
    """Run one synchronous seeded circular-block bootstrap for two hypotheses."""

    if (
        not primary_values
        or len(primary_values) != len(secondary_values)
        or block_length < 1
        or replicates < 1
    ):
        raise EvidenceError("bootstrap inputs are not synchronous")
    count = len(primary_values)
    randomizer = random.Random(seed)
    observed_primary = sum(primary_values, Decimal(0))
    observed_secondary_sum = sum(secondary_values, Decimal(0))
    with localcontext(DECIMAL_CONTEXT):
        mean_primary = observed_primary / Decimal(count)
        mean_secondary = observed_secondary_sum / Decimal(count)
    centered_primary = [value - mean_primary for value in primary_values]
    centered_secondary = [value - mean_secondary for value in secondary_values]
    primary_replicate_sums: list[Decimal] = []
    secondary_replicate_means: list[Decimal] = []
    primary_null_exceedances = 0
    secondary_null_exceedances = 0
    for _ in range(replicates):
        indices: list[int] = []
        while len(indices) < count:
            start = randomizer.randrange(count)
            indices.extend((start + offset) % count for offset in range(block_length))
        indices = indices[:count]
        sampled_primary = sum((primary_values[index] for index in indices), Decimal(0))
        sampled_secondary = sum((secondary_values[index] for index in indices), Decimal(0))
        primary_replicate_sums.append(sampled_primary)
        with localcontext(DECIMAL_CONTEXT):
            secondary_replicate_means.append(sampled_secondary / Decimal(count))
        centered_primary_sum = sum((centered_primary[index] for index in indices), Decimal(0))
        centered_secondary_sum = sum((centered_secondary[index] for index in indices), Decimal(0))
        if centered_primary_sum >= observed_primary:
            primary_null_exceedances += 1
        if centered_secondary_sum >= observed_secondary_sum:
            secondary_null_exceedances += 1
    primary_p = Fraction(primary_null_exceedances + 1, replicates + 1)
    secondary_p = Fraction(secondary_null_exceedances + 1, replicates + 1)
    payload: dict[str, object] = {
        "method": "SEEDED_SYNCHRONOUS_CIRCULAR_BLOCK",
        "replicates": replicates,
        "seed": seed,
        "blockLengthDays": block_length,
        "rowCount": count,
        "primary": {
            "observedNetUsdPer1000": decimal_text(observed_primary),
            "dailyMeanUsd": decimal_text(mean_primary),
            "bootstrap95IntervalNetUsdPer1000": [
                decimal_text(nearest_rank(primary_replicate_sums, 25, 1000)),
                decimal_text(nearest_rank(primary_replicate_sums, 975, 1000)),
            ],
            "oneSidedCenteredBootstrapP": fraction_text(primary_p),
            "null": "DAILY_MEAN_LESS_THAN_OR_EQUAL_TO_ZERO",
        },
        "secondary": {
            "observedMeanRankIc": decimal_text(mean_secondary, 10),
            "bootstrap95IntervalMeanRankIc": [
                decimal_text(nearest_rank(secondary_replicate_means, 25, 1000), 10),
                decimal_text(nearest_rank(secondary_replicate_means, 975, 1000), 10),
            ],
            "oneSidedCenteredBootstrapP": fraction_text(secondary_p),
            "null": "MEAN_RANK_IC_LESS_THAN_OR_EQUAL_TO_ZERO",
        },
    }
    return payload, primary_p, secondary_p


def holm_adjust(raw: Mapping[str, Fraction]) -> dict[str, Fraction]:
    """Return exact Holm step-down adjusted probabilities."""

    ordered = sorted(raw.items(), key=lambda item: (item[1], item[0]))
    adjusted: dict[str, Fraction] = {}
    running = Fraction(0, 1)
    family_size = len(ordered)
    for index, (name, probability) in enumerate(ordered):
        candidate = min(Fraction(1, 1), probability * (family_size - index))
        running = max(running, candidate)
        adjusted[name] = running
    return adjusted


def maximum_drawdown_pct(
    rows: Sequence[DayEvaluation], scenario_name: str, initial_capital: Decimal
) -> Decimal:
    """Measure the frozen five-minute hypothetical-liquidation drawdown."""

    peak = initial_capital
    realized = Decimal(0)
    maximum = Decimal(0)
    with localcontext(DECIMAL_CONTEXT):
        for row in rows:
            for mark in row.mark_pnl[scenario_name]:
                equity = initial_capital + realized + mark
                if equity > peak:
                    peak = equity
                if peak > 0:
                    drawdown = (peak - equity) / peak * Decimal(100)
                    maximum = max(maximum, drawdown)
            realized += row.scenario_pnl[scenario_name]
            ending_equity = initial_capital + realized
            if ending_equity > peak:
                peak = ending_equity
            if peak > 0:
                maximum = max(maximum, (peak - ending_equity) / peak * Decimal(100))
    return maximum


def serialize_day(row: DayEvaluation) -> dict[str, object]:
    """Serialize an auditable daily row without five-minute mark expansion."""

    return {
        "signalDate": row.signal_date.isoformat(),
        "signalValid": row.signal_valid,
        "active": row.active,
        "cashReason": row.cash_reason,
        "lowSymbols": list(row.low_symbols),
        "highSymbols": list(row.high_symbols),
        "scenarioPnlUsd": {name: decimal_text(value) for name, value in row.scenario_pnl.items()},
        "rankIc": None if row.rank_ic is None else decimal_text(row.rank_ic, 10),
        "capacityEventCount": len(row.capacity_events),
        "markCount": {name: len(values) for name, values in row.mark_pnl.items()},
    }


def aggregate_capacity_proxy(
    rows: Sequence[DayEvaluation],
    *,
    participation_bps: Decimal,
    target_capital_usd: Decimal,
) -> dict[str, object]:
    """Aggregate simultaneous entry/exit fills before measuring public capacity."""

    if participation_bps <= 0 or target_capital_usd <= 0:
        raise EvidenceError("capacity parameters must be positive")
    aggregated: dict[tuple[datetime, str], tuple[Decimal, Decimal]] = {}
    for row in rows:
        for identity, (weight, quote_volume) in row.capacity_events.items():
            if weight <= 0 or quote_volume <= 0:
                raise EvidenceError("capacity event must have positive weight and volume")
            prior = aggregated.get(identity)
            if prior is None:
                aggregated[identity] = (weight, quote_volume)
            else:
                if prior[1] != quote_volume:
                    raise EvidenceError("shared execution-bar quote volume drift")
                aggregated[identity] = (prior[0] + weight, quote_volume)
    participation = participation_bps / Decimal(10_000)
    pair_capacities = {
        identity: quote_volume * participation / weight
        for identity, (weight, quote_volume) in aggregated.items()
    }
    timestamp_capacities = tuple(
        min(
            capacity
            for (event_timestamp, _), capacity in pair_capacities.items()
            if event_timestamp == timestamp
        )
        for timestamp in sorted({identity[0] for identity in pair_capacities})
    )
    if not timestamp_capacities:
        return {
            "label": "PUBLIC_5M_QUOTE_VOLUME_CAPACITY_PROXY_ONLY",
            "executionTimestampObservationCount": 0,
            "symbolExecutionPairCount": 0,
            "participationBps": decimal_text(participation_bps),
            "p05Usd": None,
            "medianUsd": None,
            "minimumUsd": None,
            "targetCapitalUsd": decimal_text(target_capital_usd),
            "p05HeadroomUsd": None,
            "p05UtilizationPct": None,
            "maximumAggregateAbsoluteWeight": None,
            "historicalExecutableCapacity": "UNMEASURED",
        }
    p05 = nearest_rank(timestamp_capacities, 5, 100)
    median = nearest_rank(timestamp_capacities, 50, 100)
    maximum_weight = max(weight for weight, _ in aggregated.values())
    with localcontext(DECIMAL_CONTEXT):
        utilization = target_capital_usd / p05 * Decimal(100)
    return {
        "label": "PUBLIC_5M_QUOTE_VOLUME_CAPACITY_PROXY_ONLY",
        "executionTimestampObservationCount": len(timestamp_capacities),
        "symbolExecutionPairCount": len(pair_capacities),
        "participationBps": decimal_text(participation_bps),
        "p05Usd": decimal_text(p05),
        "medianUsd": decimal_text(median),
        "minimumUsd": decimal_text(min(timestamp_capacities)),
        "targetCapitalUsd": decimal_text(target_capital_usd),
        "p05HeadroomUsd": decimal_text(p05 - target_capital_usd),
        "p05UtilizationPct": decimal_text(utilization),
        "maximumAggregateAbsoluteWeight": decimal_text(maximum_weight, 10),
        "historicalExecutableCapacity": "UNMEASURED",
    }


def evaluate_period(
    *,
    label: str,
    first_signal_date: date,
    last_signal_date: date,
    bars_by_symbol: Mapping[str, Mapping[datetime, Bar]],
    symbols: Sequence[str],
    protocol: Mapping[str, Any],
) -> tuple[dict[str, object], tuple[DayEvaluation, ...], dict[str, Fraction]]:
    """Evaluate one sealed period and return packet plus exact raw p-values."""

    signal = protocol.get("signal")
    portfolio = protocol.get("portfolio")
    capacity = protocol.get("capacity")
    statistics = protocol.get("statistics")
    if not all(isinstance(block, dict) for block in (signal, portfolio, capacity, statistics)):
        raise EvidenceError("protocol evaluation block missing")
    signal_block = cast(dict[str, Any], signal)
    portfolio_block = cast(dict[str, Any], portfolio)
    capacity_block = cast(dict[str, Any], capacity)
    statistics_block = cast(dict[str, Any], statistics)
    bootstrap = statistics_block.get("bootstrap")
    if not isinstance(bootstrap, dict):
        raise EvidenceError("bootstrap protocol missing")
    scenarios = scenario_specs(protocol)
    rows = tuple(
        evaluate_signal_day(
            signal_date=signal_date,
            bars_by_symbol=bars_by_symbol,
            symbols=symbols,
            scenarios=scenarios,
            tail_size=require_int(portfolio_block.get("tailSize"), field="tailSize", minimum=1),
            notional_per_leg=decimal_value(
                portfolio_block.get("absoluteNotionalPerMemberUsd"),
                field="notionalPerLeg",
                minimum=Decimal(0),
                exclusive_minimum=True,
            ),
            bars_per_day=require_int(
                signal_block.get("barsPerUtcDay"), field="barsPerUtcDay", minimum=1
            ),
        )
        for signal_date in day_range(first_signal_date, last_signal_date)
    )
    primary_values = tuple(row.scenario_pnl["base"] for row in rows)
    if any(row.rank_ic is None for row in rows):
        raise EvidenceError("secondary rank-IC observation unavailable on a frozen signal date")
    secondary_values = tuple(cast(Decimal, row.rank_ic) for row in rows)
    bootstrap_packet, primary_p, secondary_p = bootstrap_family(
        primary_values,
        secondary_values,
        replicates=require_int(bootstrap.get("replicates"), field="replicates", minimum=1),
        seed=require_int(bootstrap.get("seed"), field="seed", minimum=0),
        block_length=require_int(
            bootstrap.get("blockLengthDays"), field="blockLengthDays", minimum=1
        ),
    )
    raw_probabilities = {"primary": primary_p, "secondary": secondary_p}
    adjusted = holm_adjust(raw_probabilities)
    scenario_totals = {
        name: sum((row.scenario_pnl[name] for row in rows), Decimal(0)) for name in SCENARIO_ORDER
    }
    decomposition_totals: dict[str, dict[str, str]] = {}
    for name in SCENARIO_ORDER:
        decomposition_totals[name] = {
            component: decimal_text(
                sum(
                    (row.decompositions[name][component] for row in rows),
                    Decimal(0),
                )
            )
            for component in (
                "grossPnlUsd",
                "adverseExecutionCostUsd",
                "feeCostUsd",
                "netPnlUsd",
            )
        }
    traded_symbols = sorted(
        {symbol for row in rows if row.active for symbol in (*row.low_symbols, *row.high_symbols)}
    )
    initial_capital = decimal_value(
        portfolio_block.get("initialCapitalUsd"),
        field="initialCapitalUsd",
        minimum=Decimal(0),
        exclusive_minimum=True,
    )
    capacity_packet = aggregate_capacity_proxy(
        rows,
        participation_bps=decimal_value(
            capacity_block.get("participationBps"),
            field="participationBps",
            minimum=Decimal(0),
            exclusive_minimum=True,
        ),
        target_capital_usd=decimal_value(
            capacity_block.get("targetCapitalUsd"),
            field="targetCapitalUsd",
            minimum=Decimal(0),
            exclusive_minimum=True,
        ),
    )
    packet: dict[str, object] = {
        "schema": "S2KPeriodEvaluationV1",
        "label": label,
        "signalDateInclusive": [
            first_signal_date.isoformat(),
            last_signal_date.isoformat(),
        ],
        "rowCount": len(rows),
        "validSignalDays": sum(row.signal_valid for row in rows),
        "activePortfolioDays": sum(row.active for row in rows),
        "cashDays": sum(not row.active for row in rows),
        "cashReasonCounts": {
            reason: sum(row.cash_reason == reason for row in rows)
            for reason in sorted({row.cash_reason for row in rows if row.cash_reason is not None})
        },
        "distinctTradedSymbols": len(traded_symbols),
        "tradedSymbols": traded_symbols,
        "scenarioNetUsdPer1000": {
            name: decimal_text(value) for name, value in scenario_totals.items()
        },
        "costDecompositionUsdPer1000": decomposition_totals,
        "baseBootstrap95IntervalNetUsdPer1000": cast(dict[str, Any], bootstrap_packet["primary"])[
            "bootstrap95IntervalNetUsdPer1000"
        ],
        "statistics": {
            **bootstrap_packet,
            "holmAdjustedP": {name: fraction_text(value) for name, value in adjusted.items()},
            "whiteRealityCheckSingleStrategyP": fraction_text(primary_p),
            "pbo": {
                "state": "NOT_APPLICABLE_SINGLE_FROZEN_CONFIGURATION",
                "attemptCount": 1,
                "numericValue": None,
                "role": "DIAGNOSTIC_ONLY_NOT_A_P_VALUE",
            },
        },
        "maximumFiveMinuteDrawdownPct": {
            name: decimal_text(maximum_drawdown_pct(rows, name, initial_capital))
            for name in SCENARIO_ORDER
        },
        "capacityProxy": capacity_packet,
        "daily": [serialize_day(row) for row in rows],
    }
    return packet, rows, raw_probabilities


def nested_mapping(value: object, *, field: str) -> Mapping[str, Any]:
    """Require a mapping while preserving read-only intent."""

    if not isinstance(value, dict):
        raise EvidenceError(f"{field} must be an object")
    return cast(Mapping[str, Any], value)


def period_decimal(packet: Mapping[str, Any], *path: str, field: str) -> Decimal:
    """Read a decimal leaf from a period packet."""

    cursor: object = packet
    for component in path:
        cursor = nested_mapping(cursor, field=field).get(component)
    return decimal_value(cursor, field=field)


def gate_receipt(
    *,
    name: str,
    observed: Decimal | int | str,
    threshold: Decimal | int,
    operator: str,
    passed: bool,
) -> dict[str, object]:
    """Construct one explicit frozen gate receipt."""

    return {
        "name": name,
        "observed": (observed if isinstance(observed, (int, str)) else decimal_text(observed, 10)),
        "operator": operator,
        "threshold": (threshold if isinstance(threshold, int) else decimal_text(threshold, 10)),
        "pass": passed,
    }


def evaluate_gates(
    packet: Mapping[str, Any],
    *,
    protocol: Mapping[str, Any],
    period: str,
) -> tuple[list[dict[str, object]], bool]:
    """Apply exactly the frozen development or holdout gates."""

    gates_root = nested_mapping(protocol.get("gates"), field="gates")
    gates = nested_mapping(gates_root.get(period), field=f"gates.{period}")
    valid_days = require_int(packet.get("validSignalDays"), field="validSignalDays", minimum=0)
    active_days = require_int(
        packet.get("activePortfolioDays"), field="activePortfolioDays", minimum=0
    )
    base_net = period_decimal(packet, "scenarioNetUsdPer1000", "base", field="baseNet")
    stress_net = period_decimal(packet, "scenarioNetUsdPer1000", "stress", field="stressNet")
    interval = packet.get("baseBootstrap95IntervalNetUsdPer1000")
    if not isinstance(interval, list) or len(interval) != 2:
        raise EvidenceError("base bootstrap interval malformed")
    lower = decimal_value(interval[0], field="baseBootstrapLower")
    base_drawdown = period_decimal(
        packet, "maximumFiveMinuteDrawdownPct", "base", field="baseDrawdown"
    )
    capacity_value = nested_mapping(packet.get("capacityProxy"), field="capacityProxy").get(
        "p05Usd"
    )
    capacity_p05 = (
        None if capacity_value is None else decimal_value(capacity_value, field="capacityP05")
    )
    receipts: list[dict[str, object]] = []

    minimum_valid = require_int(
        gates.get("minimumValidSignalDays"), field="minimumValidSignalDays", minimum=1
    )
    minimum_active = require_int(
        gates.get("minimumActivePortfolioDays"),
        field="minimumActivePortfolioDays",
        minimum=1,
    )
    receipts.append(
        gate_receipt(
            name="MINIMUM_VALID_SIGNAL_DAYS",
            observed=valid_days,
            threshold=minimum_valid,
            operator=">=",
            passed=valid_days >= minimum_valid,
        )
    )
    receipts.append(
        gate_receipt(
            name="MINIMUM_ACTIVE_PORTFOLIO_DAYS",
            observed=active_days,
            threshold=minimum_active,
            operator=">=",
            passed=active_days >= minimum_active,
        )
    )
    if period == "development":
        distinct = require_int(
            packet.get("distinctTradedSymbols"),
            field="distinctTradedSymbols",
            minimum=0,
        )
        minimum_distinct = require_int(
            gates.get("minimumDistinctTradedSymbols"),
            field="minimumDistinctTradedSymbols",
            minimum=1,
        )
        receipts.append(
            gate_receipt(
                name="MINIMUM_DISTINCT_TRADED_SYMBOLS",
                observed=distinct,
                threshold=minimum_distinct,
                operator=">=",
                passed=distinct >= minimum_distinct,
            )
        )
    base_floor = decimal_value(
        gates.get("basePublicProxyNetUsdExclusiveMinimum"),
        field="baseNetFloor",
    )
    stress_floor = decimal_value(
        gates.get("stressPublicProxyNetUsdExclusiveMinimum"),
        field="stressNetFloor",
    )
    lower_floor = decimal_value(
        gates.get("baseBootstrapLowerExclusiveMinimum"),
        field="bootstrapLowerFloor",
    )
    receipts.extend(
        (
            gate_receipt(
                name="BASE_PUBLIC_PROXY_NET_USD_PER_1000",
                observed=base_net,
                threshold=base_floor,
                operator=">",
                passed=base_net > base_floor,
            ),
            gate_receipt(
                name="STRESS_PUBLIC_PROXY_NET_USD_PER_1000",
                observed=stress_net,
                threshold=stress_floor,
                operator=">",
                passed=stress_net > stress_floor,
            ),
            gate_receipt(
                name="BASE_BOOTSTRAP_95_LOWER_USD_PER_1000",
                observed=lower,
                threshold=lower_floor,
                operator=">",
                passed=lower > lower_floor,
            ),
        )
    )
    statistics = nested_mapping(packet.get("statistics"), field="statistics")
    if period == "development":
        adjusted = nested_mapping(statistics.get("holmAdjustedP"), field="holmAdjustedP")
        primary_probability = decimal_value(
            adjusted.get("primary"), field="primaryHolmP", minimum=Decimal(0)
        )
        primary_limit = decimal_value(
            gates.get("primaryHolmAdjustedPExclusiveMaximum"),
            field="primaryHolmLimit",
            minimum=Decimal(0),
        )
        white_probability = decimal_value(
            statistics.get("whiteRealityCheckSingleStrategyP"),
            field="whiteP",
            minimum=Decimal(0),
        )
        white_limit = decimal_value(
            gates.get("whiteRealityCheckPExclusiveMaximum"),
            field="whiteLimit",
            minimum=Decimal(0),
        )
        receipts.extend(
            (
                gate_receipt(
                    name="PRIMARY_HOLM_ADJUSTED_P",
                    observed=primary_probability,
                    threshold=primary_limit,
                    operator="<",
                    passed=primary_probability < primary_limit,
                ),
                gate_receipt(
                    name="WHITE_REALITY_CHECK_SINGLE_STRATEGY_P",
                    observed=white_probability,
                    threshold=white_limit,
                    operator="<",
                    passed=white_probability < white_limit,
                ),
            )
        )
    else:
        primary = nested_mapping(statistics.get("primary"), field="statistics.primary")
        primary_probability = decimal_value(
            primary.get("oneSidedCenteredBootstrapP"),
            field="primaryRawP",
            minimum=Decimal(0),
        )
        primary_limit = decimal_value(
            gates.get("primaryOneSidedPExclusiveMaximum"),
            field="primaryRawLimit",
            minimum=Decimal(0),
        )
        receipts.append(
            gate_receipt(
                name="PRIMARY_ONE_SIDED_P",
                observed=primary_probability,
                threshold=primary_limit,
                operator="<",
                passed=primary_probability < primary_limit,
            )
        )
    drawdown_limit = decimal_value(
        gates.get("maximumBaseFiveMinuteDrawdownPct"),
        field="drawdownLimit",
        minimum=Decimal(0),
    )
    capacity_floor = decimal_value(
        gates.get("minimumPublicCapacityP05Usd"),
        field="capacityFloor",
        minimum=Decimal(0),
    )
    receipts.extend(
        (
            gate_receipt(
                name="MAXIMUM_BASE_FIVE_MINUTE_DRAWDOWN_PCT",
                observed=base_drawdown,
                threshold=drawdown_limit,
                operator="<=",
                passed=base_drawdown <= drawdown_limit,
            ),
            gate_receipt(
                name="MINIMUM_PUBLIC_CAPACITY_P05_USD",
                observed="UNMEASURED" if capacity_p05 is None else capacity_p05,
                threshold=capacity_floor,
                operator=">=",
                passed=capacity_p05 is not None and capacity_p05 >= capacity_floor,
            ),
        )
    )
    if period == "development":
        pbo = nested_mapping(statistics.get("pbo"), field="pbo")
        pbo_pass = (
            pbo.get("state") == "NOT_APPLICABLE_SINGLE_FROZEN_CONFIGURATION"
            and pbo.get("attemptCount") == 1
            and pbo.get("numericValue") is None
        )
        receipts.append(
            {
                "name": "PBO_SINGLE_CONFIGURATION_RECEIPT",
                "observed": pbo.get("state"),
                "operator": "==",
                "threshold": "NOT_APPLICABLE_SINGLE_FROZEN_CONFIGURATION",
                "numericValue": None,
                "pass": pbo_pass,
            }
        )
    return receipts, all(bool(receipt["pass"]) for receipt in receipts)


def terminal_json(name: str, payload: Mapping[str, object]) -> tuple[dict[str, Any], str]:
    """Write one repository terminal JSON artifact exactly once."""

    path = PACKAGE_DIR / name
    value = dict(payload)
    raw = canonical_bytes(value)
    exclusive_write(path, raw)
    return cast(dict[str, Any], value), sha256_bytes(raw)


def inclusive_months(plan: Mapping[str, Any], field: str) -> tuple[str, ...]:
    """Expand one two-element month range from the frozen source plan."""

    raw = plan.get(field)
    if not isinstance(raw, list) or len(raw) != 2:
        raise EvidenceError(f"{field} must contain two months")
    return month_range(
        require_text(raw[0], field=f"{field}.first"),
        require_text(raw[1], field=f"{field}.last"),
    )


def calendar_date_pair(protocol: Mapping[str, Any], field: str) -> tuple[date, date]:
    """Load one inclusive signal-date pair."""

    calendar = nested_mapping(protocol.get("calendar"), field="calendar")
    raw = calendar.get(field)
    if not isinstance(raw, list) or len(raw) != 2:
        raise EvidenceError(f"calendar.{field} malformed")
    return (
        date_value(raw[0], field=f"{field}.first"),
        date_value(raw[1], field=f"{field}.last"),
    )


def assert_run_preconditions() -> str:
    """Bind the one run to a clean static commit with exclusive S-2K history."""

    head = git_output("rev-parse", "HEAD")
    if head == BASE_COMMIT or SHA256_PATTERN.fullmatch(head) is None:
        raise EvidenceError("run requires the committed post-freeze static packet")
    if git_output("status", "--porcelain", "--untracked-files=all"):
        raise EvidenceError("run requires a clean worktree")
    changed = tuple(
        line for line in git_output("diff", "--name-only", BASE_COMMIT, head).splitlines() if line
    )
    if not changed or any(not name.startswith("quant/research/s2k/") for name in changed):
        raise EvidenceError("static commit exceeds exclusive S-2K scope")
    if any((PACKAGE_DIR / name).exists() for name in TERMINAL_NAMES):
        raise EvidenceError("terminal artifact exists before the one run")
    if (STATE_ROOT / "RUN_STARTED.v1.json").exists() or (STATE_ROOT / "result.v1.json").exists():
        raise EvidenceError("external lifecycle proves the run was already consumed")
    return head


def source_manifest_payload(
    entries: Mapping[tuple[str, str], Mapping[str, object]],
    *,
    freeze_sha: str,
    acquisition_sha: str,
    static_commit: str,
) -> dict[str, object]:
    """Construct the committed archive/member provenance manifest."""

    ordered = [
        dict(entries[identity]) for identity in sorted(entries, key=lambda item: (item[0], item[1]))
    ]
    opened = sum(
        entry.get("openState") != "CHECKSUM_VERIFIED_NOT_DECOMPRESSED" for entry in ordered
    )
    completed = sum(str(entry.get("openState", "")).endswith("_COMPLETE") for entry in ordered)
    return {
        "schema": "S2KSourceManifestV1",
        "createdAtUtc": utc_now_text(),
        "protocolFreezeSha256": freeze_sha,
        "acquisitionSha256": acquisition_sha,
        "staticCommit": static_commit,
        "archiveCount": len(ordered),
        "archiveBodiesOpenedOrStarted": opened,
        "archiveBodiesValidatedComplete": completed,
        "archiveBodiesStillSealed": len(ordered) - opened,
        "entries": ordered,
    }


def evaluation_result_summary(
    packet: Mapping[str, Any] | None,
) -> dict[str, object]:
    """Extract the terminal decision surfaces from a period packet."""

    if packet is None or packet.get("measurementState") == "UNMEASURED":
        return {
            "state": "UNMEASURED",
            "netUsdPer1000": "UNMEASURED",
            "bootstrap95IntervalNetUsdPer1000": "UNMEASURED",
            "multiplicity": "UNMEASURED",
            "maximumBaseFiveMinuteDrawdownPct": "UNMEASURED",
            "capacityProxy": "UNMEASURED",
        }
    statistics = nested_mapping(packet.get("statistics"), field="statistics")
    return {
        "state": "MEASURED",
        "netUsdPer1000": packet.get("scenarioNetUsdPer1000"),
        "baseBootstrap95IntervalNetUsdPer1000": packet.get("baseBootstrap95IntervalNetUsdPer1000"),
        "multiplicity": {
            "rawPrimaryP": nested_mapping(
                statistics.get("primary"), field="statistics.primary"
            ).get("oneSidedCenteredBootstrapP"),
            "rawSecondaryP": nested_mapping(
                statistics.get("secondary"), field="statistics.secondary"
            ).get("oneSidedCenteredBootstrapP"),
            "holmAdjustedP": statistics.get("holmAdjustedP"),
            "whiteRealityCheckSingleStrategyP": statistics.get("whiteRealityCheckSingleStrategyP"),
        },
        "pbo": statistics.get("pbo"),
        "maximumFiveMinuteDrawdownPct": packet.get("maximumFiveMinuteDrawdownPct"),
        "capacityProxy": packet.get("capacityProxy"),
        "validSignalDays": packet.get("validSignalDays"),
        "activePortfolioDays": packet.get("activePortfolioDays"),
        "gates": packet.get("gates"),
        "allGatesPass": packet.get("allGatesPass"),
    }


def build_result(
    *,
    verdict: str,
    failure_reason: str | None,
    static_commit: str,
    freeze_sha: str,
    acquisition_sha: str,
    run_marker_sha: str,
    source_manifest_sha: str,
    development: Mapping[str, Any] | None,
    development_sha: str,
    holdout: Mapping[str, Any] | None,
    holdout_sha: str | None,
    holdout_state: str,
    candidate_sha: str | None,
    holdout_marker_sha: str | None,
    protocol: Mapping[str, Any],
) -> dict[str, object]:
    """Construct the compact terminal verdict and authority boundary."""

    authority = nested_mapping(protocol.get("authority"), field="authority")
    calendar = nested_mapping(protocol.get("calendar"), field="calendar")
    costs = nested_mapping(protocol.get("costs"), field="costs")
    return {
        "schema": "S2KResultV1",
        "createdAtUtc": utc_now_text(),
        "researchVerdict": verdict,
        "measurementState": "UNMEASURED" if verdict == "UNMEASURED" else "MEASURED",
        "failureReason": failure_reason,
        "economicWindowUtc": calendar.get("economicWindow"),
        "capitalVerdict": "NO_GO",
        "executionAuthority": "NONE",
        "accountNetUsdPer1000": "UNMEASURED",
        "accountEffectiveFee": costs.get("accountEffectiveFee"),
        "borrowAvailabilityAndCost": costs.get("borrowAvailabilityAndCost"),
        "publicProxyNetExcludesUnknownBorrow": True,
        "staticCommit": static_commit,
        "protocolFreezeSha256": freeze_sha,
        "acquisitionSha256": acquisition_sha,
        "runMarkerSha256": run_marker_sha,
        "sourceManifestSha256": source_manifest_sha,
        "developmentSha256": development_sha,
        "candidateSealSha256": candidate_sha,
        "holdoutMarkerSha256": holdout_marker_sha,
        "holdoutSha256": holdout_sha,
        "development": evaluation_result_summary(development),
        "holdout": {
            "state": holdout_state,
            "evaluation": evaluation_result_summary(holdout),
        },
        "limitations": [
            "FIXED_20_SYMBOL_COHORT_DOES_NOT_PROVE_POINT_IN_TIME_FULL_MARKET_OR_REMOVE_SURVIVORSHIP",
            "SYNTHETIC_SHORT_LEGS_REQUIRE_BORROW_OR_MARGIN_INVENTORY_NOT_PROVED_BY_SPOT_ARCHIVES",
            "ACCOUNT_EFFECTIVE_FEES_AND_BORROW_COST_ARE_UNKNOWN",
            "USDT_EQUALS_USD_IS_A_RESEARCH_NORMALIZATION_NOT_REDEMPTION_TRUTH",
            "PUBLIC_5M_QUOTE_VOLUME_IS_NOT_EXECUTABLE_CAPACITY_OR_DEPTH",
            "SPREAD_DEPTH_QUEUE_LATENCY_IMPACT_FILTERS_COLLATERAL_AND_LIQUIDATION_ARE_UNMEASURED",
            "ONE_INTERNAL_HOLDOUT_IS_NOT_A_FRESH_GLOBAL_CORPUS",
            "PUBLIC_PROXY_RESULTS_CANNOT_AUTHORIZE_CAPITAL_OR_EXECUTION",
        ],
        "globalFreshHoldout": "UNAVAILABLE_SHARED_CORPUS",
        "consumer": authority.get("consumer"),
        "uiCanonicalLiveHostProviderPrivateOrderTransferWithdrawalMoney": "UNCHANGED_FORBIDDEN",
    }


def write_sha256sums() -> str:
    """Seal every committed packet file except the manifest itself."""

    target = PACKAGE_DIR / "SHA256SUMS"
    if target.exists():
        raise EvidenceError("SHA256SUMS already exists")
    paths: list[Path] = []
    for path in PACKAGE_DIR.iterdir():
        if path.is_dir() and not path.is_symlink():
            if path.name not in IGNORED_RUNTIME_DIRECTORIES:
                raise EvidenceError(f"unexpected packet directory: {path.name}")
            continue
        if path.is_symlink() or not path.is_file():
            raise EvidenceError(f"unsafe packet entry: {path.name}")
        if path.name != target.name:
            paths.append(path)
    paths.sort()
    raw = "".join(f"{sha256_path(path)}  {path.name}\n" for path in paths).encode("ascii")
    exclusive_write(target, raw)
    return sha256_bytes(raw)


def finalize_packet(
    *,
    verdict: str,
    failure_reason: str | None,
    static_commit: str,
    freeze_sha: str,
    acquisition_sha: str,
    run_marker_sha: str,
    entries: Mapping[tuple[str, str], Mapping[str, object]],
    development: Mapping[str, Any] | None,
    development_sha: str,
    holdout: Mapping[str, Any] | None,
    holdout_sha: str | None,
    holdout_state: str,
    candidate_sha: str | None,
    holdout_marker_sha: str | None,
    protocol: Mapping[str, Any],
) -> dict[str, object]:
    """Write provenance, result, external result copy, and packet checksums."""

    manifest, manifest_sha = terminal_json(
        "source_manifest.v1.json",
        source_manifest_payload(
            entries,
            freeze_sha=freeze_sha,
            acquisition_sha=acquisition_sha,
            static_commit=static_commit,
        ),
    )
    if manifest.get("archiveCount") != 260:
        raise EvidenceError("terminal source manifest archive count mismatch")
    result = build_result(
        verdict=verdict,
        failure_reason=failure_reason,
        static_commit=static_commit,
        freeze_sha=freeze_sha,
        acquisition_sha=acquisition_sha,
        run_marker_sha=run_marker_sha,
        source_manifest_sha=manifest_sha,
        development=development,
        development_sha=development_sha,
        holdout=holdout,
        holdout_sha=holdout_sha,
        holdout_state=holdout_state,
        candidate_sha=candidate_sha,
        holdout_marker_sha=holdout_marker_sha,
        protocol=protocol,
    )
    result_value, _ = terminal_json("result.v1.json", result)
    exclusive_write(STATE_ROOT / "result.v1.json", canonical_bytes(result_value))
    write_sha256sums()
    return cast(dict[str, object], result_value)


def unmeasured_development(reason: str) -> tuple[dict[str, Any], str]:
    """Write a development evidence-failure receipt when no evaluation exists."""

    payload: dict[str, object] = {
        "schema": "S2KPeriodEvaluationV1",
        "label": "DEVELOPMENT",
        "createdAtUtc": utc_now_text(),
        "measurementState": "UNMEASURED",
        "failureReason": reason,
        "allGatesPass": False,
        "gates": [],
    }
    return terminal_json("development.v1.json", payload)


def run_once() -> dict[str, object]:
    """Consume the single frozen economic run and seal its terminal verdict."""

    protocol = load_protocol()
    _, freeze_sha = load_freeze()
    acquisition, acquisition_sha = load_acquisition()
    plan, symbols, _ = load_source_plan()
    static_commit = assert_run_preconditions()
    entries = acquisition_entry_map(acquisition)
    run_marker: dict[str, object] = {
        "schema": "S2KRunStartedV1",
        "createdAtUtc": utc_now_text(),
        "runId": sha256_bytes(f"{static_commit}:{freeze_sha}:{acquisition_sha}".encode("ascii")),
        "staticCommit": static_commit,
        "protocolFreezeSha256": freeze_sha,
        "acquisitionSha256": acquisition_sha,
        "economicRunOrdinal": 1,
        "archiveBodiesOpenedBeforeMarker": 0,
    }
    run_marker_raw = canonical_bytes(run_marker)
    exclusive_write(STATE_ROOT / "RUN_STARTED.v1.json", run_marker_raw)
    exclusive_write(PACKAGE_DIR / "RUN_STARTED.v1.json", run_marker_raw)
    run_marker_sha = sha256_bytes(run_marker_raw)

    development: dict[str, Any] | None = None
    development_sha = ""
    holdout: dict[str, Any] | None = None
    holdout_sha: str | None = None
    candidate_sha: str | None = None
    holdout_marker_sha: str | None = None
    holdout_state = "SEALED_UNOPENED"
    try:
        development_months = inclusive_months(plan, "developmentOpenMonthsInclusive")
        development_bars = load_months(
            entries,
            symbols=symbols,
            months=development_months,
            open_state="DECOMPRESSED_DURING_DEVELOPMENT_COMPLETE",
        )
        development_dates = calendar_date_pair(protocol, "developmentSignalDates")
        development_packet, _, _ = evaluate_period(
            label="DEVELOPMENT",
            first_signal_date=development_dates[0],
            last_signal_date=development_dates[1],
            bars_by_symbol=development_bars,
            symbols=symbols,
            protocol=protocol,
        )
        development_gates, development_pass = evaluate_gates(
            development_packet, protocol=protocol, period="development"
        )
        development_packet["createdAtUtc"] = utc_now_text()
        development_packet["measurementState"] = "MEASURED"
        development_packet["gates"] = development_gates
        development_packet["allGatesPass"] = development_pass
        development, development_sha = terminal_json("development.v1.json", development_packet)
        if not development_pass:
            holdout_state = "SEALED_UNOPENED_DEVELOPMENT_GATES_FAILED"
            return finalize_packet(
                verdict="NO_GO",
                failure_reason="ONE_OR_MORE_FROZEN_DEVELOPMENT_GATES_FAILED",
                static_commit=static_commit,
                freeze_sha=freeze_sha,
                acquisition_sha=acquisition_sha,
                run_marker_sha=run_marker_sha,
                entries=entries,
                development=development,
                development_sha=development_sha,
                holdout=None,
                holdout_sha=None,
                holdout_state=holdout_state,
                candidate_sha=None,
                holdout_marker_sha=None,
                protocol=protocol,
            )

        candidate: dict[str, object] = {
            "schema": "S2KCandidateSealedV1",
            "createdAtUtc": utc_now_text(),
            "staticCommit": static_commit,
            "protocolFreezeSha256": freeze_sha,
            "acquisitionSha256": acquisition_sha,
            "runMarkerSha256": run_marker_sha,
            "developmentSha256": development_sha,
            "attemptId": "S2K-RS5M-D1-K4-EQ",
            "direction": "LONG_FOUR_LOWEST_SHORT_FOUR_HIGHEST",
            "allDevelopmentGatesPass": True,
            "fallbackCandidates": 0,
        }
        candidate_raw = canonical_bytes(candidate)
        exclusive_write(STATE_ROOT / "CANDIDATE_SEALED.v1.json", candidate_raw)
        exclusive_write(PACKAGE_DIR / "CANDIDATE_SEALED.v1.json", candidate_raw)
        candidate_sha = sha256_bytes(candidate_raw)
        holdout_marker: dict[str, object] = {
            "schema": "S2KHoldoutOpenedV1",
            "createdAtUtc": utc_now_text(),
            "staticCommit": static_commit,
            "acquisitionSha256": acquisition_sha,
            "runMarkerSha256": run_marker_sha,
            "candidateSealSha256": candidate_sha,
            "developmentSha256": development_sha,
            "holdoutOpenOrdinal": 1,
            "holdoutArchiveBodiesOpenedBeforeMarker": 0,
        }
        holdout_marker_raw = canonical_bytes(holdout_marker)
        exclusive_write(STATE_ROOT / "HOLDOUT_OPENED.v1.json", holdout_marker_raw)
        exclusive_write(PACKAGE_DIR / "HOLDOUT_OPENED.v1.json", holdout_marker_raw)
        holdout_marker_sha = sha256_bytes(holdout_marker_raw)
        holdout_state = "OPENED_AFTER_DEVELOPMENT_PASS"

        del development_bars
        holdout_months = inclusive_months(plan, "holdoutClosedMonthsInclusive")
        holdout_bars = load_months(
            entries,
            symbols=symbols,
            months=holdout_months,
            open_state="DECOMPRESSED_DURING_HOLDOUT_COMPLETE",
        )
        holdout_dates = calendar_date_pair(protocol, "holdoutSignalDates")
        holdout_packet, _, _ = evaluate_period(
            label="HOLDOUT",
            first_signal_date=holdout_dates[0],
            last_signal_date=holdout_dates[1],
            bars_by_symbol=holdout_bars,
            symbols=symbols,
            protocol=protocol,
        )
        holdout_gates, holdout_pass = evaluate_gates(
            holdout_packet, protocol=protocol, period="holdout"
        )
        holdout_packet["createdAtUtc"] = utc_now_text()
        holdout_packet["measurementState"] = "MEASURED"
        holdout_packet["gates"] = holdout_gates
        holdout_packet["allGatesPass"] = holdout_pass
        holdout, holdout_sha = terminal_json("holdout.v1.json", holdout_packet)
        holdout_state = "OPENED_EVALUATED"
        return finalize_packet(
            verdict="GO" if holdout_pass else "NO_GO",
            failure_reason=(None if holdout_pass else "ONE_OR_MORE_FROZEN_HOLDOUT_GATES_FAILED"),
            static_commit=static_commit,
            freeze_sha=freeze_sha,
            acquisition_sha=acquisition_sha,
            run_marker_sha=run_marker_sha,
            entries=entries,
            development=development,
            development_sha=development_sha,
            holdout=holdout,
            holdout_sha=holdout_sha,
            holdout_state=holdout_state,
            candidate_sha=candidate_sha,
            holdout_marker_sha=holdout_marker_sha,
            protocol=protocol,
        )
    except Exception as error:
        reason = f"{type(error).__name__}: {error!s}".replace("\n", " ")[:240]
        if not (PACKAGE_DIR / "development.v1.json").exists():
            development, development_sha = unmeasured_development(reason)
        if (PACKAGE_DIR / "result.v1.json").exists():
            raise
        if (PACKAGE_DIR / "source_manifest.v1.json").exists():
            raise
        if holdout_marker_sha is not None:
            holdout_state = "OPENED_EVIDENCE_FAILURE"
        else:
            holdout_state = "SEALED_UNOPENED_EVIDENCE_FAILURE"
        return finalize_packet(
            verdict="UNMEASURED",
            failure_reason=reason,
            static_commit=static_commit,
            freeze_sha=freeze_sha,
            acquisition_sha=acquisition_sha,
            run_marker_sha=run_marker_sha,
            entries=entries,
            development=development,
            development_sha=development_sha,
            holdout=holdout,
            holdout_sha=holdout_sha,
            holdout_state=holdout_state,
            candidate_sha=candidate_sha,
            holdout_marker_sha=holdout_marker_sha,
            protocol=protocol,
        )


def verify_sha256sums() -> dict[str, str]:
    """Verify exact direct-file coverage of the terminal checksum manifest."""

    path = PACKAGE_DIR / "SHA256SUMS"
    try:
        lines = path.read_text(encoding="ascii").splitlines()
    except (OSError, UnicodeDecodeError) as error:
        raise EvidenceError("SHA256SUMS is unreadable") from error
    expected: dict[str, str] = {}
    for line in lines:
        fields = line.split("  ")
        if (
            len(fields) != 2
            or SHA256_PATTERN.fullmatch(fields[0]) is None
            or not fields[1]
            or Path(fields[1]).name != fields[1]
        ):
            raise EvidenceError("SHA256SUMS line malformed")
        if fields[1] in expected:
            raise EvidenceError("SHA256SUMS duplicate filename")
        expected[fields[1]] = fields[0]
    actual_names: set[str] = set()
    for candidate in PACKAGE_DIR.iterdir():
        if candidate.is_dir() and not candidate.is_symlink():
            if candidate.name not in IGNORED_RUNTIME_DIRECTORIES:
                raise EvidenceError(f"unexpected terminal packet directory: {candidate.name}")
            continue
        if candidate.is_symlink() or not candidate.is_file():
            raise EvidenceError(f"unsafe terminal packet entry: {candidate.name}")
        if candidate.name != "SHA256SUMS":
            actual_names.add(candidate.name)
    if set(expected) != actual_names:
        raise EvidenceError("SHA256SUMS file coverage mismatch")
    for name, digest in expected.items():
        if sha256_path(PACKAGE_DIR / name) != digest:
            raise EvidenceError(f"terminal checksum mismatch: {name}")
    return expected


def verify_terminal_packet() -> dict[str, Any]:
    """Authenticate terminal bindings without network or economic recomputation."""

    expected = verify_sha256sums()
    _, freeze_sha = load_freeze()
    acquisition, acquisition_sha = load_acquisition()
    result, result_raw = load_json(PACKAGE_DIR / "result.v1.json")
    if result.get("schema") != "S2KResultV1":
        raise EvidenceError("result schema mismatch")
    verdict = result.get("researchVerdict")
    if verdict not in {"GO", "NO_GO", "UNMEASURED"}:
        raise EvidenceError("result verdict invalid")
    if result.get("capitalVerdict") != "NO_GO":
        raise EvidenceError("capital verdict must remain NO_GO")
    if result.get("executionAuthority") != "NONE":
        raise EvidenceError("execution authority must remain NONE")
    if result.get("accountNetUsdPer1000") != "UNMEASURED":
        raise EvidenceError("account net must remain UNMEASURED")
    if result.get("protocolFreezeSha256") != freeze_sha:
        raise EvidenceError("result freeze binding mismatch")
    if result.get("acquisitionSha256") != acquisition_sha:
        raise EvidenceError("result acquisition binding mismatch")
    static_commit = require_text(result.get("staticCommit"), field="result.staticCommit")
    if SHA256_PATTERN.fullmatch(static_commit) is None:
        raise EvidenceError("result static commit malformed")
    external_result = STATE_ROOT / "result.v1.json"
    if not external_result.is_file() or external_result.read_bytes() != result_raw:
        raise EvidenceError("external result copy mismatch")
    bindings = {
        "RUN_STARTED.v1.json": "runMarkerSha256",
        "development.v1.json": "developmentSha256",
        "source_manifest.v1.json": "sourceManifestSha256",
    }
    for filename, field in bindings.items():
        if expected.get(filename) != result.get(field):
            raise EvidenceError(f"result binding mismatch: {filename}")

    run_marker, run_marker_raw = load_json(PACKAGE_DIR / "RUN_STARTED.v1.json")
    external_run_marker = STATE_ROOT / "RUN_STARTED.v1.json"
    if not external_run_marker.is_file() or external_run_marker.read_bytes() != run_marker_raw:
        raise EvidenceError("external run-marker copy mismatch")
    if (
        run_marker.get("schema") != "S2KRunStartedV1"
        or run_marker.get("staticCommit") != static_commit
        or run_marker.get("protocolFreezeSha256") != freeze_sha
        or run_marker.get("acquisitionSha256") != acquisition_sha
        or run_marker.get("economicRunOrdinal") != 1
        or run_marker.get("archiveBodiesOpenedBeforeMarker") != 0
    ):
        raise EvidenceError("run-marker lifecycle fields mismatch")

    source, _ = load_json(PACKAGE_DIR / "source_manifest.v1.json")
    if (
        source.get("schema") != "S2KSourceManifestV1"
        or source.get("archiveCount") != 260
        or source.get("protocolFreezeSha256") != freeze_sha
        or source.get("acquisitionSha256") != acquisition_sha
        or source.get("staticCommit") != static_commit
    ):
        raise EvidenceError("source manifest top-level binding mismatch")
    raw_source_entries = source.get("entries")
    if not isinstance(raw_source_entries, list) or len(raw_source_entries) != 260:
        raise EvidenceError("source manifest entries incomplete")
    acquisition_entries = acquisition_entry_map(acquisition)
    source_entries: dict[tuple[str, str], Mapping[str, object]] = {}
    allowed_open_states = {
        "CHECKSUM_VERIFIED_NOT_DECOMPRESSED",
        "DECOMPRESSED_DURING_DEVELOPMENT_COMPLETE_STARTED",
        "DECOMPRESSED_DURING_DEVELOPMENT_COMPLETE",
        "DECOMPRESSED_DURING_HOLDOUT_COMPLETE_STARTED",
        "DECOMPRESSED_DURING_HOLDOUT_COMPLETE",
    }
    for raw_entry in raw_source_entries:
        if not isinstance(raw_entry, dict):
            raise EvidenceError("source manifest entry malformed")
        entry = cast(Mapping[str, object], raw_entry)
        identity = (
            require_text(entry.get("symbol"), field="source.symbol"),
            require_text(entry.get("month"), field="source.month"),
        )
        if identity in source_entries or identity not in acquisition_entries:
            raise EvidenceError("source manifest identity mismatch")
        acquisition_entry = acquisition_entries[identity]
        if set(entry) != set(acquisition_entry):
            raise EvidenceError("source manifest provenance field set drift")
        if any(
            entry.get(field) != acquisition_entry.get(field)
            for field in acquisition_entry
            if field not in {"openState", "member"}
        ):
            raise EvidenceError("source manifest immutable provenance drift")
        open_state = require_text(entry.get("openState"), field="source.openState")
        if open_state not in allowed_open_states:
            raise EvidenceError("source manifest open state invalid")
        member = entry.get("member")
        if open_state.endswith("_COMPLETE"):
            if not isinstance(member, dict):
                raise EvidenceError("completed archive lacks member receipt")
            expected_member = f"{identity[0]}-{INTERVAL}-{identity[1]}.csv"
            if (
                member.get("name") != expected_member
                or member.get("timestampUnit") != "MICROSECONDS"
                or member.get("columns") != 12
                or require_int(member.get("rowCount"), field="member.rowCount", minimum=1) < 1
                or SHA256_PATTERN.fullmatch(
                    require_text(member.get("sha256"), field="member.sha256")
                )
                is None
            ):
                raise EvidenceError("source member receipt malformed")
        elif member is not None:
            raise EvidenceError("sealed or partial archive has member receipt")
        source_entries[identity] = entry
    if set(source_entries) != set(acquisition_entries):
        raise EvidenceError("source manifest archive set mismatch")
    opened_count = sum(
        entry.get("openState") != "CHECKSUM_VERIFIED_NOT_DECOMPRESSED"
        for entry in source_entries.values()
    )
    completed_count = sum(
        str(entry.get("openState", "")).endswith("_COMPLETE") for entry in source_entries.values()
    )
    if (
        source.get("archiveBodiesOpenedOrStarted") != opened_count
        or source.get("archiveBodiesValidatedComplete") != completed_count
        or source.get("archiveBodiesStillSealed") != 260 - opened_count
    ):
        raise EvidenceError("source manifest open-count receipt mismatch")

    development, _ = load_json(PACKAGE_DIR / "development.v1.json")
    holdout_root = nested_mapping(result.get("holdout"), field="result.holdout")
    holdout_state = require_text(holdout_root.get("state"), field="holdout.state")
    allowed_holdout_states = {
        "SEALED_UNOPENED_DEVELOPMENT_GATES_FAILED",
        "SEALED_UNOPENED_EVIDENCE_FAILURE",
        "OPENED_EVALUATED",
        "OPENED_EVIDENCE_FAILURE",
    }
    if holdout_state not in allowed_holdout_states:
        raise EvidenceError("holdout state invalid")
    plan, symbols, _ = load_source_plan()
    development_months = set(inclusive_months(plan, "developmentOpenMonthsInclusive"))
    holdout_months = set(inclusive_months(plan, "holdoutClosedMonthsInclusive"))
    if set(symbols) != {identity[0] for identity in source_entries}:
        raise EvidenceError("source manifest symbol set mismatch")
    development_allowed_states = {
        "CHECKSUM_VERIFIED_NOT_DECOMPRESSED",
        "DECOMPRESSED_DURING_DEVELOPMENT_COMPLETE_STARTED",
        "DECOMPRESSED_DURING_DEVELOPMENT_COMPLETE",
    }
    holdout_allowed_states = {
        "CHECKSUM_VERIFIED_NOT_DECOMPRESSED",
        "DECOMPRESSED_DURING_HOLDOUT_COMPLETE_STARTED",
        "DECOMPRESSED_DURING_HOLDOUT_COMPLETE",
    }
    if any(
        source_entries[(symbol, month)].get("openState") not in development_allowed_states
        for symbol in symbols
        for month in development_months
    ):
        raise EvidenceError("development partition has an invalid open-state label")
    if any(
        source_entries[(symbol, month)].get("openState") not in holdout_allowed_states
        for symbol in symbols
        for month in holdout_months
    ):
        raise EvidenceError("holdout partition has an invalid open-state label")
    if holdout_state == "SEALED_UNOPENED_DEVELOPMENT_GATES_FAILED" and any(
        source_entries[(symbol, month)].get("openState")
        != "DECOMPRESSED_DURING_DEVELOPMENT_COMPLETE"
        for symbol in symbols
        for month in development_months
    ):
        raise EvidenceError("development-gate verdict lacks complete development data")
    if holdout_state.startswith("SEALED_UNOPENED") and any(
        source_entries[(symbol, month)].get("openState") != "CHECKSUM_VERIFIED_NOT_DECOMPRESSED"
        for symbol in symbols
        for month in holdout_months
    ):
        raise EvidenceError("sealed holdout has opened source entry")
    if holdout_state in {"OPENED_EVALUATED", "OPENED_EVIDENCE_FAILURE"} and any(
        source_entries[(symbol, month)].get("openState")
        != "DECOMPRESSED_DURING_DEVELOPMENT_COMPLETE"
        for symbol in symbols
        for month in development_months
    ):
        raise EvidenceError("opened holdout lacks complete development corpus")
    if holdout_state == "OPENED_EVALUATED" and any(
        source_entries[(symbol, month)].get("openState") != "DECOMPRESSED_DURING_HOLDOUT_COMPLETE"
        for symbol in symbols
        for month in holdout_months
    ):
        raise EvidenceError("evaluated holdout lacks complete holdout corpus")

    candidate_path = PACKAGE_DIR / "CANDIDATE_SEALED.v1.json"
    holdout_marker_path = PACKAGE_DIR / "HOLDOUT_OPENED.v1.json"
    holdout_path = PACKAGE_DIR / "holdout.v1.json"
    if holdout_state.startswith("SEALED_UNOPENED"):
        if candidate_path.exists() or holdout_marker_path.exists() or holdout_path.exists():
            raise EvidenceError("sealed holdout has open artifacts")
        if (STATE_ROOT / candidate_path.name).exists() or (
            STATE_ROOT / holdout_marker_path.name
        ).exists():
            raise EvidenceError("sealed holdout has external open artifacts")
        if any(
            result.get(field) is not None
            for field in (
                "candidateSealSha256",
                "holdoutMarkerSha256",
                "holdoutSha256",
            )
        ):
            raise EvidenceError("sealed holdout has non-null open binding")
    else:
        if not candidate_path.is_file() or not holdout_marker_path.is_file():
            raise EvidenceError("opened holdout lacks lifecycle markers")
        if expected.get(candidate_path.name) != result.get("candidateSealSha256"):
            raise EvidenceError("candidate seal binding mismatch")
        if expected.get(holdout_marker_path.name) != result.get("holdoutMarkerSha256"):
            raise EvidenceError("holdout marker binding mismatch")
        candidate, candidate_raw = load_json(candidate_path)
        marker, marker_raw = load_json(holdout_marker_path)
        external_candidate = STATE_ROOT / candidate_path.name
        external_marker = STATE_ROOT / holdout_marker_path.name
        if (
            not external_candidate.is_file()
            or external_candidate.read_bytes() != candidate_raw
            or not external_marker.is_file()
            or external_marker.read_bytes() != marker_raw
        ):
            raise EvidenceError("external candidate or holdout-marker copy mismatch")
        if (
            candidate.get("schema") != "S2KCandidateSealedV1"
            or candidate.get("staticCommit") != static_commit
            or candidate.get("protocolFreezeSha256") != freeze_sha
            or candidate.get("acquisitionSha256") != acquisition_sha
            or candidate.get("runMarkerSha256") != expected["RUN_STARTED.v1.json"]
            or candidate.get("developmentSha256") != expected["development.v1.json"]
            or candidate.get("allDevelopmentGatesPass") is not True
            or candidate.get("fallbackCandidates") != 0
        ):
            raise EvidenceError("candidate lifecycle binding mismatch")
        if (
            marker.get("schema") != "S2KHoldoutOpenedV1"
            or marker.get("staticCommit") != static_commit
            or marker.get("acquisitionSha256") != acquisition_sha
            or marker.get("runMarkerSha256") != expected["RUN_STARTED.v1.json"]
            or marker.get("candidateSealSha256") != expected[candidate_path.name]
            or marker.get("developmentSha256") != expected["development.v1.json"]
            or marker.get("holdoutOpenOrdinal") != 1
            or marker.get("holdoutArchiveBodiesOpenedBeforeMarker") != 0
        ):
            raise EvidenceError("holdout-marker lifecycle binding mismatch")
        if holdout_state == "OPENED_EVALUATED":
            if not holdout_path.is_file():
                raise EvidenceError("evaluated holdout artifact missing")
            if expected.get(holdout_path.name) != result.get("holdoutSha256"):
                raise EvidenceError("holdout result binding mismatch")
        elif holdout_path.exists():
            if not holdout_path.is_file() or expected.get(holdout_path.name) != result.get(
                "holdoutSha256"
            ):
                raise EvidenceError("evidence-failure holdout binding mismatch")
        elif result.get("holdoutSha256") is not None:
            raise EvidenceError("absent evidence-failure holdout has non-null hash")
    if development.get("measurementState") == "MEASURED":
        statistics = nested_mapping(development.get("statistics"), field="development.statistics")
        pbo = nested_mapping(statistics.get("pbo"), field="development.pbo")
        if (
            pbo.get("state") != "NOT_APPLICABLE_SINGLE_FROZEN_CONFIGURATION"
            or pbo.get("attemptCount") != 1
            or pbo.get("numericValue") is not None
        ):
            raise EvidenceError("PBO receipt drift")
    if verdict == "GO":
        if holdout_state != "OPENED_EVALUATED":
            raise EvidenceError("GO requires evaluated holdout")
        holdout, _ = load_json(holdout_path)
        if not development.get("allGatesPass") or not holdout.get("allGatesPass"):
            raise EvidenceError("GO requires every frozen gate")
    if verdict == "NO_GO":
        development_failed = development.get("allGatesPass") is False
        holdout_failed = False
        if holdout_path.is_file():
            holdout, _ = load_json(holdout_path)
            holdout_failed = holdout.get("allGatesPass") is False
        if not development_failed and not holdout_failed:
            raise EvidenceError("NO_GO lacks a failed frozen gate")
    if verdict == "UNMEASURED" and result.get("failureReason") is None:
        raise EvidenceError("UNMEASURED lacks failure reason")
    expected_state_for_verdict = {
        "SEALED_UNOPENED_DEVELOPMENT_GATES_FAILED": {"NO_GO"},
        "SEALED_UNOPENED_EVIDENCE_FAILURE": {"UNMEASURED"},
        "OPENED_EVALUATED": {"GO", "NO_GO"},
        "OPENED_EVIDENCE_FAILURE": {"UNMEASURED"},
    }
    if verdict not in expected_state_for_verdict[holdout_state]:
        raise EvidenceError("verdict and holdout state conflict")
    return result


def report_packet() -> dict[str, object]:
    """Return a compact verified terminal report."""

    result = verify_terminal_packet()
    report = {
        "researchVerdict": result["researchVerdict"],
        "capitalVerdict": result["capitalVerdict"],
        "executionAuthority": result["executionAuthority"],
        "economicWindowUtc": result["economicWindowUtc"],
        "accountNetUsdPer1000": result["accountNetUsdPer1000"],
        "development": result["development"],
        "holdout": result["holdout"],
        "limitations": result["limitations"],
        "consumer": result["consumer"],
    }
    print(json.dumps(report, sort_keys=True, indent=2))
    return cast(dict[str, object], report)


def build_parser() -> argparse.ArgumentParser:
    """Build the four-command lifecycle CLI."""

    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("freeze", help="seal static inputs before archive acquisition")
    acquire = subparsers.add_parser(
        "acquire", help="download and checksum archives without decompression"
    )
    acquire.add_argument("--workers", type=int, default=8)
    subparsers.add_parser("run", help="consume the one allowed economic run")
    subparsers.add_parser("report", help="verify and report without recomputation")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    """Run one lifecycle command with concise fail-closed errors."""

    arguments = build_parser().parse_args(argv)
    try:
        if arguments.command == "freeze":
            value: object = freeze_protocol()
        elif arguments.command == "acquire":
            value = acquire_archives(arguments.workers)
        elif arguments.command == "run":
            value = run_once()
        elif arguments.command == "report":
            report_packet()
            return 0
        else:
            raise EvidenceError("unknown command")
        print(json.dumps(value, sort_keys=True, indent=2))
        return 0
    except EvidenceError as error:
        print(f"S2K_EVIDENCE_ERROR: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
