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
import shutil
import statistics
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from collections import defaultdict
from collections.abc import Mapping, Sequence
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal, InvalidOperation, getcontext
from pathlib import Path
from typing import Any, cast
from xml.etree import ElementTree

getcontext().prec = 40

HERE = Path(__file__).resolve().parent
PROTOCOL_PATH = HERE / "protocol.v1.json"
OFFICIAL_SOURCES_PATH = HERE / "OFFICIAL_SOURCE_RESEARCH.md"
FREEZE_PATH = HERE / "freeze.v1.json"
RESULT_PATH = HERE / "result.v1.json"
DEFAULT_STATE_ROOT = Path("/private/tmp/cosmos-s1i-premium-dislocation-v1")
INVENTORY_NAME = "screen-manifest.v1.json"
ACQUISITION_NAME = "acquisition-manifest.v1.json"
RUN_MARKER_NAME = "run-marker.v1.json"
CANDIDATE_SEAL_NAME = "candidate-seal.v1.json"
HOLDOUT_OPEN_NAME = "holdout-open.v1.json"
RESULT_RECEIPT_NAME = "result-receipt.v1.json"
HOUR_MS = 3_600_000
ONE = Decimal(1)
ZERO = Decimal(0)
SYMBOL_RE = re.compile(r"^[A-Z0-9]+USDT$")


class EvidenceError(RuntimeError):
    """A fail-closed source, lifecycle, or experiment error."""


class ResultSealError(EvidenceError):
    """A staged terminal result exists but its two-file seal is incomplete."""


@dataclass(frozen=True)
class Bar:
    open_time_ms: int
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    quote_volume: Decimal


@dataclass(frozen=True)
class PremiumBar:
    open_time_ms: int
    close: Decimal


@dataclass(frozen=True)
class FundingEvent:
    time_ms: int
    interval_hours: int
    rate: Decimal


@dataclass(frozen=True)
class Trial:
    trial_id: str
    lookback_hours: int
    tail_fraction: Decimal
    hold_hours: int

    def as_mapping(self) -> dict[str, object]:
        return {
            "trialId": self.trial_id,
            "lookbackHours": self.lookback_hours,
            "tailFraction": decimal_text(self.tail_fraction),
            "holdHours": self.hold_hours,
        }


@dataclass
class Decomposition:
    gross_price: Decimal = ZERO
    funding: Decimal = ZERO
    fee: Decimal = ZERO
    adverse: Decimal = ZERO

    @property
    def net(self) -> Decimal:
        return self.gross_price + self.funding - self.fee - self.adverse

    def add(self, other: Decomposition) -> None:
        self.gross_price += other.gross_price
        self.funding += other.funding
        self.fee += other.fee
        self.adverse += other.adverse

    def as_mapping(self) -> dict[str, str]:
        return {
            "grossPriceUsd": money_text(self.gross_price),
            "fundingUsd": money_text(self.funding),
            "feeUsd": money_text(self.fee),
            "adverseExecutionUsd": money_text(self.adverse),
            "netUsd": money_text(self.net),
        }


@dataclass(frozen=True)
class CohortResult:
    entry_time_ms: int
    exit_time_ms: int
    long_symbols: tuple[str, ...]
    short_symbols: tuple[str, ...]
    gross: Decomposition
    base: Decomposition
    stress: Decomposition
    severe: Decomposition
    capacity_proxy_usd: Decimal
    capacity_fit: bool
    premium_convergence: Decimal
    signal_funding_correlation: Decimal
    selected_funding_exposure_8h: Decimal
    residualization_training_pairs: int
    funding_settlements: int


@dataclass(frozen=True)
class TrialRun:
    trial: Trial
    scheduled: int
    invalid: int
    invalid_reasons: Mapping[str, int]
    cohorts: tuple[CohortResult, ...]
    funding_settlements: int


@dataclass(frozen=True)
class DataBundle:
    bars: Mapping[str, Mapping[int, Bar]]
    premiums: Mapping[str, Mapping[int, PremiumBar]]
    funding: Mapping[str, tuple[FundingEvent, ...]]


def canonical_bytes(value: object) -> bytes:
    return (
        json.dumps(
            value,
            ensure_ascii=False,
            allow_nan=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        + b"\n"
    )


def sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def sha256_path(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def load_json(path: Path) -> tuple[dict[str, Any], bytes]:
    try:
        raw = path.read_bytes()
        value = json.loads(raw)
    except (OSError, json.JSONDecodeError) as exc:
        raise EvidenceError(f"invalid JSON evidence {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise EvidenceError(f"JSON evidence root is not an object: {path}")
    return cast(dict[str, Any], value), raw


def require_text(value: object, *, field: str) -> str:
    if not isinstance(value, str) or not value:
        raise EvidenceError(f"{field} must be non-empty text")
    return value


def require_int(value: object, *, field: str, minimum: int = 0) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise EvidenceError(f"{field} must be an integer >= {minimum}")
    return value


def decimal_value(value: object, *, field: str, minimum: Decimal | None = None) -> Decimal:
    if not isinstance(value, (str, int)):
        raise EvidenceError(f"{field} must be exact decimal text or integer")
    try:
        result = Decimal(str(value))
    except InvalidOperation as exc:
        raise EvidenceError(f"{field} is not decimal") from exc
    if not result.is_finite() or (minimum is not None and result < minimum):
        raise EvidenceError(f"{field} is outside its valid domain")
    return result


def decimal_text(value: Decimal) -> str:
    if not value.is_finite():
        raise EvidenceError("cannot serialize non-finite decimal")
    text = format(value, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text if text not in {"", "-0"} else "0"


def money_text(value: Decimal) -> str:
    return format(value.quantize(Decimal("0.00000001")), "f")


def utc_text(time_ms: int) -> str:
    return datetime.fromtimestamp(time_ms / 1000, tz=UTC).isoformat().replace("+00:00", "Z")


def parse_utc(value: object, *, field: str) -> int:
    text = require_text(value, field=field)
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as exc:
        raise EvidenceError(f"{field} is not ISO UTC") from exc
    if parsed.tzinfo is None or parsed.utcoffset() != timedelta(0):
        raise EvidenceError(f"{field} must be UTC")
    return int(parsed.timestamp() * 1000)


def month_bounds(month: str) -> tuple[datetime, datetime]:
    if not re.fullmatch(r"\d{4}-\d{2}", month):
        raise EvidenceError(f"invalid month {month}")
    first = datetime.strptime(month + "-01", "%Y-%m-%d").replace(tzinfo=UTC)
    if first.month == 12:
        following = first.replace(year=first.year + 1, month=1)
    else:
        following = first.replace(month=first.month + 1)
    return first, following


def month_range(first: str, last: str) -> tuple[str, ...]:
    cursor, _ = month_bounds(first)
    end, _ = month_bounds(last)
    values: list[str] = []
    while cursor <= end:
        values.append(cursor.strftime("%Y-%m"))
        cursor = (
            cursor.replace(year=cursor.year + 1, month=1)
            if cursor.month == 12
            else cursor.replace(month=cursor.month + 1)
        )
    return tuple(values)


def exclusive_write(path: Path, raw: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with path.open("xb") as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
    except FileExistsError as exc:
        raise EvidenceError(f"refusing to overwrite sealed evidence: {path}") from exc


def atomic_write(path: Path, raw: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + f".tmp.{os.getpid()}")
    try:
        with temporary.open("xb") as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def script_sha() -> str:
    return sha256_path(Path(__file__).resolve())


def now_utc() -> str:
    return datetime.now(tz=UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def load_protocol() -> tuple[dict[str, Any], str]:
    protocol, raw = load_json(PROTOCOL_PATH)
    if protocol.get("schema") != "S1IPremiumDislocationProtocolV1":
        raise EvidenceError("protocol schema mismatch")
    if protocol.get("canonicalBaseCommit") != "a169b123fb186d1943a75ad648552c4d95be1be1":
        raise EvidenceError("canonical base binding mismatch")
    return protocol, sha256_bytes(raw)


def trials(protocol: Mapping[str, Any]) -> tuple[Trial, ...]:
    section = cast(Mapping[str, Any], protocol["trials"])
    lookbacks = cast(Sequence[object], section["premiumMeanLookbackHours"])
    tails = cast(Sequence[object], section["tailFractions"])
    holds = cast(Sequence[object], section["holdingHours"])
    result: list[Trial] = []
    for lookback in lookbacks:
        lookback_value = require_int(lookback, field="lookback", minimum=1)
        for tail in tails:
            tail_value = decimal_value(tail, field="tail", minimum=Decimal("0.01"))
            for hold in holds:
                hold_value = require_int(hold, field="hold", minimum=1)
                trial_id = (
                    f"lb{lookback_value:02d}_tail{int(tail_value * 100):02d}_hold{hold_value:02d}"
                )
                result.append(Trial(trial_id, lookback_value, tail_value, hold_value))
    result.sort(key=lambda item: item.trial_id)
    expected = require_int(section["familySize"], field="familySize", minimum=1)
    if len(result) != expected or len({item.trial_id for item in result}) != expected:
        raise EvidenceError("trial family is not exact")
    return tuple(result)


def _http_get(url: str, *, allow_not_found: bool = False, retries: int = 4) -> bytes | None:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Cosmos-S1I-public-research/1.0",
            "Accept-Encoding": "identity",
        },
    )
    last_error: Exception | None = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                return cast(bytes, response.read())
        except urllib.error.HTTPError as exc:
            if exc.code == 404 and allow_not_found:
                return None
            last_error = exc
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last_error = exc
        if attempt + 1 < retries:
            time.sleep(0.4 * (attempt + 1))
    raise EvidenceError(f"public download failed after {retries} attempts: {url}") from (last_error)


def _xml_values(root: ElementTree.Element, path: str) -> tuple[str, ...]:
    values: list[str] = []
    for element in root.findall(path):
        if element.text is not None:
            values.append(element.text)
    return tuple(values)


def list_common_prefixes(prefix: str) -> tuple[tuple[str, ...], str]:
    protocol, _ = load_protocol()
    endpoint = require_text(
        cast(Mapping[str, Any], protocol["data"])["listingEndpoint"],
        field="listingEndpoint",
    )
    token: str | None = None
    raw_pages: list[bytes] = []
    prefixes: list[str] = []
    while True:
        query: dict[str, str] = {
            "list-type": "2",
            "delimiter": "/",
            "prefix": prefix,
        }
        if token is not None:
            query["continuation-token"] = token
        raw = _http_get(endpoint + "?" + urllib.parse.urlencode(query))
        if raw is None:
            raise EvidenceError("listing unexpectedly missing")
        raw_pages.append(raw)
        try:
            root = ElementTree.fromstring(raw)
        except ElementTree.ParseError as exc:
            raise EvidenceError("invalid S3 listing XML") from exc
        prefixes.extend(_xml_values(root, "{*}CommonPrefixes/{*}Prefix"))
        truncated = root.findtext("{*}IsTruncated")
        if truncated != "true":
            break
        token = root.findtext("{*}NextContinuationToken")
        if not token:
            raise EvidenceError("truncated S3 listing lacks continuation token")
    normalized = tuple(sorted(set(prefixes)))
    page_binding = sha256_bytes(b"".join(raw_pages))
    return normalized, page_binding


def artifact_url(data_type: str, symbol: str, month: str) -> str:
    base = "https://data.binance.vision/data/futures/um/monthly"
    if data_type == "fundingRate":
        return f"{base}/{data_type}/{symbol}/{symbol}-{data_type}-{month}.zip"
    if data_type not in {"klines", "premiumIndexKlines"}:
        raise EvidenceError(f"unsupported data type {data_type}")
    return f"{base}/{data_type}/{symbol}/1h/{symbol}-1h-{month}.zip"


def _checksum_digest(checksum_raw: bytes, *, expected_filename: str, archive_raw: bytes) -> str:
    try:
        text = checksum_raw.decode("ascii").strip()
    except UnicodeDecodeError as exc:
        raise EvidenceError("checksum is not ASCII") from exc
    match = re.fullmatch(r"([0-9a-fA-F]{64})\s+\*?(.+)", text)
    if match is None or match.group(2) != expected_filename:
        raise EvidenceError(f"invalid checksum line for {expected_filename}")
    expected = match.group(1).lower()
    actual = sha256_bytes(archive_raw)
    if actual != expected:
        raise EvidenceError(f"publisher checksum mismatch for {expected_filename}")
    return actual


def _cached_pair(url: str, directory: Path, *, allow_not_found: bool) -> dict[str, object] | None:
    archive_path = directory / "archive.zip"
    checksum_path = directory / "archive.zip.CHECKSUM"
    if archive_path.exists() or checksum_path.exists():
        if not archive_path.is_file() or not checksum_path.is_file():
            raise EvidenceError(f"partial cached pair at {directory}")
        archive_raw = archive_path.read_bytes()
        checksum_raw = checksum_path.read_bytes()
        digest = _checksum_digest(
            checksum_raw,
            expected_filename=url.rsplit("/", 1)[-1],
            archive_raw=archive_raw,
        )
        return {
            "url": url,
            "sha256": digest,
            "bytes": len(archive_raw),
            "checksumSha256": sha256_bytes(checksum_raw),
            "archivePath": str(archive_path),
            "checksumPath": str(checksum_path),
        }
    fetched_checksum = _http_get(url + ".CHECKSUM", allow_not_found=allow_not_found)
    if fetched_checksum is None:
        return None
    fetched_archive = _http_get(url, allow_not_found=allow_not_found)
    if fetched_archive is None:
        raise EvidenceError(f"checksum exists but archive is missing: {url}")
    digest = _checksum_digest(
        fetched_checksum,
        expected_filename=url.rsplit("/", 1)[-1],
        archive_raw=fetched_archive,
    )
    exclusive_write(checksum_path, fetched_checksum)
    exclusive_write(archive_path, fetched_archive)
    return {
        "url": url,
        "sha256": digest,
        "bytes": len(fetched_archive),
        "checksumSha256": sha256_bytes(fetched_checksum),
        "archivePath": str(archive_path),
        "checksumPath": str(checksum_path),
    }


def _archive_csv_rows(raw: bytes, *, expected_member: str) -> list[list[str]]:
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            members = archive.namelist()
            if members != [expected_member]:
                raise EvidenceError(
                    f"archive member mismatch: expected {expected_member}, got {members}"
                )
            member = archive.getinfo(expected_member)
            if member.is_dir() or "/" in member.filename or "\\" in member.filename:
                raise EvidenceError("unsafe archive member")
            csv_raw = archive.read(member)
    except (zipfile.BadZipFile, KeyError, OSError) as exc:
        raise EvidenceError(f"invalid ZIP {expected_member}: {exc}") from exc
    try:
        text = csv_raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise EvidenceError(f"CSV is not UTF-8: {expected_member}") from exc
    return list(csv.reader(io.StringIO(text, newline="")))


def _exact_hour_grid(month: str) -> tuple[int, ...]:
    first, following = month_bounds(month)
    start = int(first.timestamp() * 1000)
    end = int(following.timestamp() * 1000)
    return tuple(range(start, end, HOUR_MS))


def _csv_decimal(value: str, *, field: str, positive: bool = False) -> Decimal:
    try:
        result = Decimal(value)
    except InvalidOperation as exc:
        raise EvidenceError(f"{field} is not decimal") from exc
    if not result.is_finite() or (positive and result <= ZERO):
        raise EvidenceError(f"{field} outside domain")
    return result


def parse_kline_archive(
    raw: bytes, *, symbol: str, month: str, require_full: bool = True
) -> tuple[Bar, ...]:
    member = f"{symbol}-1h-{month}.csv"
    rows = _archive_csv_rows(raw, expected_member=member)
    if rows and rows[0] and not rows[0][0].isdigit():
        rows = rows[1:]
    bars: list[Bar] = []
    for index, row in enumerate(rows):
        if len(row) != 12:
            raise EvidenceError(f"{member} row {index} does not have 12 fields")
        try:
            open_time = int(row[0])
            close_time = int(row[6])
            trades = int(row[8])
        except ValueError as exc:
            raise EvidenceError(f"{member} row {index} integer invalid") from exc
        open_price = _csv_decimal(row[1], field="open", positive=True)
        high = _csv_decimal(row[2], field="high", positive=True)
        low = _csv_decimal(row[3], field="low", positive=True)
        close = _csv_decimal(row[4], field="close", positive=True)
        quote_volume = _csv_decimal(row[7], field="quote_volume")
        if quote_volume < ZERO or trades < 0:
            raise EvidenceError(f"{member} row {index} negative activity")
        if not (high >= max(open_price, close) and low <= min(open_price, close)):
            raise EvidenceError(f"{member} row {index} OHLC relation invalid")
        if close_time != open_time + HOUR_MS - 1:
            raise EvidenceError(f"{member} row {index} close boundary invalid")
        bars.append(Bar(open_time, open_price, high, low, close, quote_volume))
    times = tuple(item.open_time_ms for item in bars)
    if len(times) != len(set(times)) or times != tuple(sorted(times)):
        raise EvidenceError(f"{member} duplicate or nonmonotonic timestamps")
    if require_full and times != _exact_hour_grid(month):
        raise EvidenceError(f"{member} is not a complete exact UTC month")
    return tuple(bars)


def parse_premium_archive(
    raw: bytes, *, symbol: str, month: str, require_full: bool = True
) -> tuple[PremiumBar, ...]:
    member = f"{symbol}-1h-{month}.csv"
    rows = _archive_csv_rows(raw, expected_member=member)
    if rows and rows[0] and not rows[0][0].isdigit():
        rows = rows[1:]
    bars: list[PremiumBar] = []
    for index, row in enumerate(rows):
        if len(row) != 12:
            raise EvidenceError(f"{member} row {index} does not have 12 fields")
        try:
            open_time = int(row[0])
            close_time = int(row[6])
        except ValueError as exc:
            raise EvidenceError(f"{member} row {index} integer invalid") from exc
        close = _csv_decimal(row[4], field="premium_close")
        if close_time != open_time + HOUR_MS - 1:
            raise EvidenceError(f"{member} row {index} close boundary invalid")
        bars.append(PremiumBar(open_time, close))
    times = tuple(item.open_time_ms for item in bars)
    if len(times) != len(set(times)) or times != tuple(sorted(times)):
        raise EvidenceError(f"{member} duplicate or nonmonotonic timestamps")
    if require_full and times != _exact_hour_grid(month):
        raise EvidenceError(f"{member} is not a complete exact UTC month")
    return tuple(bars)


def parse_funding_archive(raw: bytes, *, symbol: str, month: str) -> tuple[FundingEvent, ...]:
    member = f"{symbol}-fundingRate-{month}.csv"
    rows = _archive_csv_rows(raw, expected_member=member)
    if rows and rows[0] and not rows[0][0].isdigit():
        rows = rows[1:]
    first, following = month_bounds(month)
    lower = int(first.timestamp() * 1000)
    upper = int(following.timestamp() * 1000)
    events: list[FundingEvent] = []
    for index, row in enumerate(rows):
        if len(row) != 3:
            raise EvidenceError(f"{member} row {index} does not have 3 fields")
        try:
            event_time = int(row[0])
            interval = int(row[1])
        except ValueError as exc:
            raise EvidenceError(f"{member} row {index} integer invalid") from exc
        rate = _csv_decimal(row[2], field="funding_rate")
        if not lower <= event_time < upper or interval <= 0 or interval > 24:
            raise EvidenceError(f"{member} row {index} outside valid domain")
        events.append(FundingEvent(event_time, interval, rate))
    times = tuple(item.time_ms for item in events)
    if len(times) != len(set(times)) or times != tuple(sorted(times)):
        raise EvidenceError(f"{member} duplicate or nonmonotonic timestamps")
    if not events:
        raise EvidenceError(f"{member} has no funding coverage")
    tolerance_ms = 60_000
    if events[0].time_ms - lower > 24 * HOUR_MS + tolerance_ms:
        raise EvidenceError(f"{member} starts with an unbounded funding gap")
    if upper - events[-1].time_ms > 24 * HOUR_MS + tolerance_ms:
        raise EvidenceError(f"{member} ends with an unbounded funding gap")
    for previous, current in itertools.pairwise(events):
        maximum_gap = max(previous.interval_hours, current.interval_hours) * HOUR_MS
        if current.time_ms - previous.time_ms > maximum_gap + tolerance_ms:
            raise EvidenceError(f"{member} contains an unbounded funding gap")
    return tuple(events)


def _excluded_base(symbol: str, exclusions: set[str]) -> bool:
    if not symbol.endswith("USDT"):
        return True
    return symbol[:-4] in exclusions


def _screen_one(symbol: str, state_root: Path, month: str) -> dict[str, object]:
    directory = state_root / "screen" / symbol
    pair = _cached_pair(
        artifact_url("klines", symbol, month),
        directory,
        allow_not_found=True,
    )
    if pair is None:
        return {"symbol": symbol, "status": "MISSING"}
    raw = Path(require_text(pair["archivePath"], field="archivePath")).read_bytes()
    try:
        bars = parse_kline_archive(raw, symbol=symbol, month=month, require_full=True)
    except EvidenceError as exc:
        return {
            "symbol": symbol,
            "status": "INVALID",
            "reason": str(exc),
            "artifact": pair,
        }
    quote_volume = sum((bar.quote_volume for bar in bars), ZERO)
    return {
        "symbol": symbol,
        "status": "VALID",
        "rows": len(bars),
        "quoteVolume": decimal_text(quote_volume),
        "artifact": pair,
    }


def screen(state_root: Path, workers: int) -> dict[str, Any]:
    inventory_path = state_root / INVENTORY_NAME
    if inventory_path.exists():
        cached_payload, _ = load_json(inventory_path)
        return cached_payload
    protocol, protocol_sha = load_protocol()
    data = cast(Mapping[str, Any], protocol["data"])
    universe = cast(Mapping[str, Any], protocol["universe"])
    month = require_text(data["screenMonth"], field="screenMonth")
    kline_prefixes, kline_listing_sha = list_common_prefixes("data/futures/um/monthly/klines/")
    premium_prefixes, premium_listing_sha = list_common_prefixes(
        "data/futures/um/monthly/premiumIndexKlines/"
    )

    def symbols_from(prefixes: Sequence[str], base: str) -> set[str]:
        result: set[str] = set()
        for prefix in prefixes:
            if prefix.startswith(base) and prefix.endswith("/"):
                result.add(prefix[len(base) : -1])
        return result

    candidates = symbols_from(kline_prefixes, "data/futures/um/monthly/klines/") & symbols_from(
        premium_prefixes, "data/futures/um/monthly/premiumIndexKlines/"
    )
    exclusions = {
        require_text(item, field="stable exclusion")
        for item in cast(Sequence[object], universe["stableOrFiatBaseExclusions"])
    }
    candidates = {
        symbol
        for symbol in candidates
        if SYMBOL_RE.fullmatch(symbol) and not _excluded_base(symbol, exclusions)
    }
    if not candidates:
        raise EvidenceError("archive discovery found no eligible candidates")
    observations: list[dict[str, object]] = []
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {
            executor.submit(_screen_one, symbol, state_root, month): symbol
            for symbol in sorted(candidates)
        }
        for future in as_completed(futures):
            observations.append(future.result())
    observations.sort(key=lambda item: require_text(item["symbol"], field="symbol"))
    valid = [item for item in observations if item["status"] == "VALID"]
    valid.sort(
        key=lambda item: (
            -decimal_value(item["quoteVolume"], field="quoteVolume"),
            require_text(item["symbol"], field="symbol"),
        )
    )
    cohort_size = require_int(universe["cohortSize"], field="cohortSize", minimum=2)
    if len(valid) < cohort_size:
        raise EvidenceError("too few complete screen-month candidates")
    selected = valid[:cohort_size]
    payload: dict[str, Any] = {
        "schema": "S1IScreenManifestV1",
        "createdAtUtc": now_utc(),
        "protocolSha256": protocol_sha,
        "screenMonth": month,
        "klineListingSha256": kline_listing_sha,
        "premiumListingSha256": premium_listing_sha,
        "archiveDirectoryIntersectionCount": len(candidates),
        "validFullMonthCount": len(valid),
        "observations": observations,
        "selected": [
            {
                "rank": index + 1,
                "symbol": item["symbol"],
                "quoteVolume": item["quoteVolume"],
                "artifact": item["artifact"],
            }
            for index, item in enumerate(selected)
        ],
    }
    exclusive_write(inventory_path, canonical_bytes(payload))
    return payload


def freeze(state_root: Path) -> dict[str, Any]:
    if FREEZE_PATH.exists():
        cached_payload, _ = load_json(FREEZE_PATH)
        return cached_payload
    protocol, protocol_sha = load_protocol()
    inventory, inventory_raw = load_json(state_root / INVENTORY_NAME)
    if inventory.get("schema") != "S1IScreenManifestV1":
        raise EvidenceError("screen manifest schema mismatch")
    if inventory.get("protocolSha256") != protocol_sha:
        raise EvidenceError("screen manifest protocol binding mismatch")
    selected = cast(Sequence[Mapping[str, Any]], inventory.get("selected"))
    expected = require_int(
        cast(Mapping[str, Any], protocol["universe"])["cohortSize"],
        field="cohortSize",
        minimum=2,
    )
    if len(selected) != expected:
        raise EvidenceError("screen selected cohort size mismatch")
    symbols = [require_text(item["symbol"], field="selected symbol") for item in selected]
    if len(symbols) != len(set(symbols)):
        raise EvidenceError("screen selected duplicate symbol")
    selected_evidence: list[dict[str, object]] = []
    for item in selected:
        artifact = cast(Mapping[str, Any], item["artifact"])
        selected_evidence.append(
            {
                "rank": require_int(item["rank"], field="rank", minimum=1),
                "symbol": require_text(item["symbol"], field="symbol"),
                "screenQuoteVolume": require_text(item["quoteVolume"], field="quoteVolume"),
                "screenArchiveSha256": require_text(artifact["sha256"], field="screen archive sha"),
                "screenChecksumSha256": require_text(
                    artifact["checksumSha256"], field="screen checksum sha"
                ),
                "screenArchiveBytes": require_int(
                    artifact["bytes"], field="screen archive bytes", minimum=1
                ),
            }
        )
    payload: dict[str, Any] = {
        "schema": "S1IPremiumDislocationFreezeV1",
        "createdAtUtc": now_utc(),
        "canonicalBaseCommit": protocol["canonicalBaseCommit"],
        "bindings": {
            "protocolSha256": protocol_sha,
            "evaluatorSha256": script_sha(),
            "officialSourceResearchSha256": sha256_path(OFFICIAL_SOURCES_PATH),
            "screenManifestSha256": sha256_bytes(inventory_raw),
        },
        "selectedCohort": selected_evidence,
        "primaryTrialId": cast(Mapping[str, Any], protocol["trials"])["primary"],
        "trialLedger": [trial.as_mapping() for trial in trials(protocol)],
        "holdoutState": "SEALED_UNOPENED",
        "executionAuthority": "NONE",
    }
    exclusive_write(FREEZE_PATH, canonical_bytes(payload))
    return payload


def load_freeze(*, verify_evaluator: bool = True) -> tuple[dict[str, Any], str]:
    payload, raw = load_json(FREEZE_PATH)
    if payload.get("schema") != "S1IPremiumDislocationFreezeV1":
        raise EvidenceError("freeze schema mismatch")
    protocol, protocol_sha = load_protocol()
    bindings = cast(Mapping[str, Any], payload["bindings"])
    if bindings.get("protocolSha256") != protocol_sha:
        raise EvidenceError("freeze protocol binding mismatch")
    if verify_evaluator and bindings.get("evaluatorSha256") != script_sha():
        raise EvidenceError("freeze evaluator binding mismatch")
    if bindings.get("officialSourceResearchSha256") != sha256_path(OFFICIAL_SOURCES_PATH):
        raise EvidenceError("freeze source-research binding mismatch")
    if payload.get("canonicalBaseCommit") != protocol.get("canonicalBaseCommit"):
        raise EvidenceError("freeze canonical base mismatch")
    return payload, sha256_bytes(raw)


def _acquire_one(spec: tuple[str, str, str], state_root: Path) -> dict[str, object]:
    data_type, symbol, month = spec
    target = state_root / "archives" / data_type / symbol / month
    if data_type == "klines" and month == "2025-06":
        source = state_root / "screen" / symbol
        if source.exists() and not target.exists():
            target.mkdir(parents=True, exist_ok=False)
            shutil.copyfile(source / "archive.zip", target / "archive.zip")
            shutil.copyfile(source / "archive.zip.CHECKSUM", target / "archive.zip.CHECKSUM")
    archive_pair = _cached_pair(
        artifact_url(data_type, symbol, month),
        target,
        allow_not_found=True,
    )
    if archive_pair is None:
        return {
            "dataType": data_type,
            "symbol": symbol,
            "month": month,
            "status": "MISSING",
        }
    return {
        "dataType": data_type,
        "symbol": symbol,
        "month": month,
        "status": "VERIFIED_COMPRESSED_UNOPENED",
        **archive_pair,
    }


def acquire(state_root: Path, workers: int) -> dict[str, Any]:
    manifest_path = state_root / ACQUISITION_NAME
    if manifest_path.exists():
        cached_payload, _ = load_json(manifest_path)
        return cached_payload
    freeze_payload, freeze_sha = load_freeze()
    symbols = tuple(
        require_text(item["symbol"], field="freeze symbol")
        for item in cast(Sequence[Mapping[str, Any]], freeze_payload["selectedCohort"])
    )
    target_months = month_range("2025-07", "2026-06")
    kline_months = ("2025-06", *target_months)
    funding_months = ("2025-06", *target_months)
    specs = tuple(
        (data_type, symbol, month)
        for symbol in symbols
        for data_type, months in (
            ("klines", kline_months),
            ("premiumIndexKlines", kline_months),
            ("fundingRate", funding_months),
        )
        for month in months
    )
    artifacts: list[dict[str, object]] = []
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {executor.submit(_acquire_one, spec, state_root): spec for spec in specs}
        for future in as_completed(futures):
            artifacts.append(future.result())
    artifacts.sort(
        key=lambda item: (
            require_text(item["dataType"], field="data type"),
            require_text(item["symbol"], field="symbol"),
            require_text(item["month"], field="month"),
        )
    )
    payload: dict[str, Any] = {
        "schema": "S1IAcquisitionManifestV1",
        "createdAtUtc": now_utc(),
        "freezeSha256": freeze_sha,
        "artifactCount": len(artifacts),
        "verifiedCount": sum(
            item["status"] == "VERIFIED_COMPRESSED_UNOPENED" for item in artifacts
        ),
        "missingCount": sum(item["status"] == "MISSING" for item in artifacts),
        "artifacts": artifacts,
    }
    exclusive_write(manifest_path, canonical_bytes(payload))
    return payload


def load_acquisition(state_root: Path) -> tuple[dict[str, Any], str]:
    payload, raw = load_json(state_root / ACQUISITION_NAME)
    if payload.get("schema") != "S1IAcquisitionManifestV1":
        raise EvidenceError("acquisition manifest schema mismatch")
    _, freeze_sha = load_freeze()
    if payload.get("freezeSha256") != freeze_sha:
        raise EvidenceError("acquisition freeze binding mismatch")
    artifact_value = payload.get("artifacts")
    if not isinstance(artifact_value, list) or not all(
        isinstance(item, dict) for item in artifact_value
    ):
        raise EvidenceError("acquisition artifacts must be an object array")
    artifacts = cast(Sequence[Mapping[str, Any]], artifact_value)
    if require_int(payload.get("artifactCount"), field="artifactCount") != len(artifacts):
        raise EvidenceError("acquisition artifact count mismatch")
    verified_count = sum(
        artifact.get("status") == "VERIFIED_COMPRESSED_UNOPENED" for artifact in artifacts
    )
    missing_count = sum(artifact.get("status") == "MISSING" for artifact in artifacts)
    if verified_count + missing_count != len(artifacts):
        raise EvidenceError("acquisition contains an unknown artifact status")
    if require_int(payload.get("verifiedCount"), field="verifiedCount") != verified_count:
        raise EvidenceError("acquisition verified count mismatch")
    if require_int(payload.get("missingCount"), field="missingCount") != missing_count:
        raise EvidenceError("acquisition missing count mismatch")
    return payload, sha256_bytes(raw)


def _verify_screen_bindings(
    state_root: Path,
    freeze_payload: Mapping[str, Any],
    acquisition_lookup: Mapping[tuple[str, str, str], Mapping[str, Any]],
) -> None:
    screen, screen_raw = load_json(state_root / INVENTORY_NAME)
    if screen.get("schema") != "S1IScreenManifestV1":
        raise EvidenceError("screen manifest schema mismatch during acquisition preflight")
    bindings = cast(Mapping[str, Any], freeze_payload["bindings"])
    if sha256_bytes(screen_raw) != require_text(
        bindings["screenManifestSha256"], field="frozen screen manifest sha"
    ):
        raise EvidenceError("screen manifest drift after freeze")
    if screen.get("protocolSha256") != bindings.get("protocolSha256"):
        raise EvidenceError("screen protocol binding drift after freeze")
    frozen_rows = cast(Sequence[Mapping[str, Any]], freeze_payload["selectedCohort"])
    screen_rows = cast(Sequence[Mapping[str, Any]], screen["selected"])
    if len(frozen_rows) != len(screen_rows):
        raise EvidenceError("screen cohort cardinality drift after freeze")
    for frozen, screened in zip(frozen_rows, screen_rows, strict=True):
        screened_artifact = cast(Mapping[str, Any], screened["artifact"])
        expected = {
            "rank": require_int(frozen["rank"], field="frozen screen rank", minimum=1),
            "symbol": require_text(frozen["symbol"], field="frozen screen symbol"),
            "quoteVolume": require_text(
                frozen["screenQuoteVolume"], field="frozen screen quote volume"
            ),
            "sha256": require_text(
                frozen["screenArchiveSha256"], field="frozen screen archive sha"
            ),
            "checksumSha256": require_text(
                frozen["screenChecksumSha256"], field="frozen screen checksum sha"
            ),
            "bytes": require_int(
                frozen["screenArchiveBytes"], field="frozen screen archive bytes", minimum=1
            ),
        }
        observed = {
            "rank": require_int(screened["rank"], field="screen rank", minimum=1),
            "symbol": require_text(screened["symbol"], field="screen symbol"),
            "quoteVolume": require_text(screened["quoteVolume"], field="screen quote volume"),
            "sha256": require_text(screened_artifact["sha256"], field="screen archive sha"),
            "checksumSha256": require_text(
                screened_artifact["checksumSha256"], field="screen checksum sha"
            ),
            "bytes": require_int(
                screened_artifact["bytes"], field="screen archive bytes", minimum=1
            ),
        }
        if observed != expected:
            raise EvidenceError(f"frozen screen row drift: {expected['symbol']}")
        symbol = cast(str, expected["symbol"])
        acquisition_artifact = acquisition_lookup.get(("klines", symbol, "2025-06"))
        if acquisition_artifact is None:
            raise EvidenceError(f"acquisition lacks frozen screen artifact: {symbol}")
        acquisition_binding = {
            "sha256": require_text(
                acquisition_artifact["sha256"], field="acquired screen archive sha"
            ),
            "checksumSha256": require_text(
                acquisition_artifact["checksumSha256"],
                field="acquired screen checksum sha",
            ),
            "bytes": require_int(
                acquisition_artifact["bytes"],
                field="acquired screen archive bytes",
                minimum=1,
            ),
        }
        if acquisition_binding != {
            "sha256": expected["sha256"],
            "checksumSha256": expected["checksumSha256"],
            "bytes": expected["bytes"],
        }:
            raise EvidenceError(f"acquired June screen bytes differ from freeze: {symbol}")


def preflight_acquisition(
    acquisition: Mapping[str, Any],
    freeze_payload: Mapping[str, Any],
    state_root: Path,
) -> None:
    """Authenticate every frozen input without opening an archive or parsing JSON."""
    if require_int(acquisition.get("missingCount"), field="missingCount") != 0:
        raise EvidenceError("ACQUISITION_CONTAINS_MISSING_REQUIRED_ARTIFACTS")
    symbols = tuple(
        require_text(item["symbol"], field="freeze symbol")
        for item in cast(Sequence[Mapping[str, Any]], freeze_payload["selectedCohort"])
    )
    target_months = month_range("2025-07", "2026-06")
    kline_months = ("2025-06", *target_months)
    funding_months = ("2025-06", *target_months)
    expected = {
        (data_type, symbol, month)
        for symbol in symbols
        for data_type, months in (
            ("klines", kline_months),
            ("premiumIndexKlines", kline_months),
            ("fundingRate", funding_months),
        )
        for month in months
    }
    lookup = _artifact_lookup(acquisition)
    if set(lookup) != expected:
        missing = sorted(expected - set(lookup))
        unexpected = sorted(set(lookup) - expected)
        raise EvidenceError(
            "acquisition specification mismatch "
            f"(missing={missing[:3]}, unexpected={unexpected[:3]})"
        )
    _verify_screen_bindings(state_root, freeze_payload, lookup)
    for data_type, symbol, month in sorted(expected):
        artifact = lookup[(data_type, symbol, month)]
        archive_raw = _verified_archive_raw(artifact)
        url = artifact_url(data_type, symbol, month)
        if artifact.get("url") != url:
            raise EvidenceError(f"acquisition URL mismatch: {data_type}/{symbol}/{month}")
        if require_int(artifact.get("bytes"), field="archive bytes", minimum=1) != len(archive_raw):
            raise EvidenceError(f"acquisition byte count mismatch: {data_type}/{symbol}/{month}")
        checksum_path = Path(require_text(artifact.get("checksumPath"), field="checksumPath"))
        try:
            checksum_raw = checksum_path.read_bytes()
        except OSError as exc:
            raise EvidenceError(
                f"required checksum sidecar is unreadable: {checksum_path}"
            ) from exc
        if sha256_bytes(checksum_raw) != require_text(
            artifact.get("checksumSha256"), field="checksum sha"
        ):
            raise EvidenceError(f"cached checksum drift: {checksum_path}")
        _checksum_digest(
            checksum_raw,
            expected_filename=url.rsplit("/", 1)[-1],
            archive_raw=archive_raw,
        )


def _artifact_lookup(
    acquisition: Mapping[str, Any],
) -> dict[tuple[str, str, str], Mapping[str, Any]]:
    result: dict[tuple[str, str, str], Mapping[str, Any]] = {}
    for artifact in cast(Sequence[Mapping[str, Any]], acquisition["artifacts"]):
        key = (
            require_text(artifact["dataType"], field="dataType"),
            require_text(artifact["symbol"], field="symbol"),
            require_text(artifact["month"], field="month"),
        )
        if key in result:
            raise EvidenceError(f"duplicate acquisition artifact {key}")
        result[key] = artifact
    return result


def _verified_archive_raw(artifact: Mapping[str, Any]) -> bytes:
    if artifact.get("status") != "VERIFIED_COMPRESSED_UNOPENED":
        raise EvidenceError(
            "required artifact is not verified: "
            f"{artifact.get('dataType')}/{artifact.get('symbol')}/"
            f"{artifact.get('month')}"
        )
    path = Path(require_text(artifact["archivePath"], field="archivePath"))
    try:
        raw = path.read_bytes()
    except OSError as exc:
        raise EvidenceError(f"required cached archive is unreadable: {path}") from exc
    expected = require_text(artifact["sha256"], field="archive sha")
    if sha256_bytes(raw) != expected:
        raise EvidenceError(f"cached archive drift: {path}")
    return raw


def load_bundle(
    acquisition: Mapping[str, Any],
    *,
    symbols: Sequence[str],
    kline_months: Sequence[str],
    funding_months: Sequence[str],
) -> DataBundle:
    lookup = _artifact_lookup(acquisition)
    bars: dict[str, dict[int, Bar]] = {symbol: {} for symbol in symbols}
    premiums: dict[str, dict[int, PremiumBar]] = {symbol: {} for symbol in symbols}
    funding: dict[str, list[FundingEvent]] = {symbol: [] for symbol in symbols}
    for symbol in symbols:
        for month in kline_months:
            kline_artifact = lookup.get(("klines", symbol, month))
            premium_artifact = lookup.get(("premiumIndexKlines", symbol, month))
            if kline_artifact is None or premium_artifact is None:
                raise EvidenceError(f"missing required manifest entry {symbol}/{month}")
            for bar in parse_kline_archive(
                _verified_archive_raw(kline_artifact),
                symbol=symbol,
                month=month,
                require_full=True,
            ):
                if bar.open_time_ms in bars[symbol]:
                    raise EvidenceError(f"duplicate merged kline {symbol}")
                bars[symbol][bar.open_time_ms] = bar
            for premium in parse_premium_archive(
                _verified_archive_raw(premium_artifact),
                symbol=symbol,
                month=month,
                require_full=True,
            ):
                if premium.open_time_ms in premiums[symbol]:
                    raise EvidenceError(f"duplicate merged premium kline {symbol}")
                premiums[symbol][premium.open_time_ms] = premium
        for month in funding_months:
            artifact = lookup.get(("fundingRate", symbol, month))
            if artifact is None:
                raise EvidenceError(f"missing funding evidence entry {symbol}/{month}")
            funding[symbol].extend(
                parse_funding_archive(
                    _verified_archive_raw(artifact),
                    symbol=symbol,
                    month=month,
                )
            )
        funding[symbol].sort(key=lambda item: item.time_ms)
        if len({item.time_ms for item in funding[symbol]}) != len(funding[symbol]):
            raise EvidenceError(f"duplicate merged funding event {symbol}")
    return DataBundle(
        bars={symbol: dict(series) for symbol, series in bars.items()},
        premiums={symbol: dict(series) for symbol, series in premiums.items()},
        funding={symbol: tuple(series) for symbol, series in funding.items()},
    )


def entry_times(start_ms: int, end_ms: int, hours: Sequence[int]) -> tuple[int, ...]:
    start = datetime.fromtimestamp(start_ms / 1000, tz=UTC)
    end = datetime.fromtimestamp(end_ms / 1000, tz=UTC)
    day = datetime(start.year, start.month, start.day, tzinfo=UTC)
    result: list[int] = []
    allowed = sorted(set(hours))
    while day < end:
        for hour in allowed:
            candidate = day + timedelta(hours=hour)
            candidate_ms = int(candidate.timestamp() * 1000)
            if start_ms <= candidate_ms < end_ms:
                result.append(candidate_ms)
        day += timedelta(days=1)
    return tuple(result)


def _atomic_tail(signals: Mapping[str, Decimal], target: int, *, lowest: bool) -> tuple[str, ...]:
    grouped: dict[Decimal, list[str]] = defaultdict(list)
    for symbol, signal in signals.items():
        grouped[signal].append(symbol)
    scores = sorted(grouped, reverse=not lowest)
    selected: list[str] = []
    for score in scores:
        group = sorted(grouped[score])
        if len(selected) + len(group) > target:
            break
        selected.extend(group)
        if len(selected) == target:
            break
    return tuple(sorted(selected))


def _position_decomposition(
    *,
    entry: Decimal,
    exit_price: Decimal,
    notional: Decimal,
    sign: int,
    fee_rate: Decimal,
    adverse_rate: Decimal,
) -> Decomposition:
    quantity = notional / entry
    gross = Decimal(sign) * quantity * (exit_price - entry)
    round_trip_value = notional + quantity * exit_price
    return Decomposition(
        gross_price=gross,
        funding=ZERO,
        fee=fee_rate * round_trip_value,
        adverse=adverse_rate * round_trip_value,
    )


def _latest_funding_rate_8h(events: Sequence[FundingEvent], entry_ms: int) -> Decimal | None:
    latest: Decimal | None = None
    for event in events:
        if event.time_ms >= entry_ms:
            break
        if event.interval_hours <= 0:
            raise EvidenceError("funding interval must be positive")
        latest = event.rate * Decimal(8) / Decimal(event.interval_hours)
    return latest


def _position_funding(
    *,
    events: Sequence[FundingEvent],
    entry_ms: int,
    exit_ms: int,
) -> tuple[Decimal, int] | None:
    for event in events:
        if event.time_ms < entry_ms:
            continue
        if event.time_ms > exit_ms:
            break
        return None
    return ZERO, 0


def _premium_mean_at(
    premiums: Mapping[int, PremiumBar],
    *,
    entry_ms: int,
    lookback_hours: int,
) -> Decimal | None:
    values: list[Decimal] = []
    for offset in range(2, lookback_hours + 2):
        premium = premiums.get(entry_ms - offset * HOUR_MS)
        if premium is None:
            return None
        values.append(premium.close)
    return sum(values, ZERO) / Decimal(len(values))


def fit_prior_residualization(
    bundle: DataBundle,
    *,
    symbols: Sequence[str],
    trial: Trial,
    entry_ms: int,
    training_days: int,
    minimum_pairs: int,
) -> tuple[Decimal, Decimal, int] | None:
    pairs: list[tuple[Decimal, Decimal]] = []
    for day_offset in range(1, training_days + 1):
        training_entry = entry_ms - day_offset * 24 * HOUR_MS
        for symbol in symbols:
            premium_mean = _premium_mean_at(
                bundle.premiums[symbol],
                entry_ms=training_entry,
                lookback_hours=trial.lookback_hours,
            )
            funding_rate = _latest_funding_rate_8h(
                bundle.funding[symbol],
                training_entry,
            )
            if premium_mean is not None and funding_rate is not None:
                pairs.append((funding_rate, premium_mean))
    if len(pairs) < minimum_pairs:
        return None
    count = Decimal(len(pairs))
    funding_mean = sum((pair[0] for pair in pairs), ZERO) / count
    premium_mean = sum((pair[1] for pair in pairs), ZERO) / count
    funding_variance = sum(((pair[0] - funding_mean) ** 2 for pair in pairs), ZERO) / count
    if funding_variance == ZERO:
        slope = ZERO
    else:
        covariance = (
            sum(
                (
                    (funding_rate - funding_mean) * (premium - premium_mean)
                    for funding_rate, premium in pairs
                ),
                ZERO,
            )
            / count
        )
        slope = covariance / funding_variance
    intercept = premium_mean - slope * funding_mean
    return intercept, slope, len(pairs)


def residualize_premium_signal(
    premium_means: Mapping[str, Decimal],
    latest_funding_rates: Mapping[str, Decimal],
    *,
    intercept: Decimal,
    slope: Decimal,
) -> tuple[dict[str, Decimal], Decimal]:
    if set(premium_means) != set(latest_funding_rates) or len(premium_means) < 2:
        raise EvidenceError("premium/funding residualization matrix is missing or ragged")
    symbols = tuple(sorted(premium_means))
    count = Decimal(len(symbols))
    funding_mean = sum((latest_funding_rates[symbol] for symbol in symbols), ZERO) / count
    funding_deviations = {symbol: latest_funding_rates[symbol] - funding_mean for symbol in symbols}
    residuals = {
        symbol: premium_means[symbol] - (intercept + slope * latest_funding_rates[symbol])
        for symbol in symbols
    }
    residual_mean = sum(residuals.values(), ZERO) / count
    residual_deviations = {symbol: residuals[symbol] - residual_mean for symbol in symbols}
    funding_variance = sum((funding_deviations[symbol] ** 2 for symbol in symbols), ZERO) / count
    residual_variance = sum((residual_deviations[symbol] ** 2 for symbol in symbols), ZERO) / count
    if funding_variance == ZERO or residual_variance == ZERO:
        correlation = ZERO
    else:
        residual_funding_covariance = (
            sum(
                (funding_deviations[symbol] * residual_deviations[symbol] for symbol in symbols),
                ZERO,
            )
            / count
        )
        correlation = residual_funding_covariance / (funding_variance * residual_variance).sqrt()
    return residuals, correlation


def selected_portfolio_funding_exposure_8h(
    latest_funding_rates: Mapping[str, Decimal],
    *,
    long_symbols: Sequence[str],
    short_symbols: Sequence[str],
) -> Decimal:
    if not long_symbols or not short_symbols:
        raise EvidenceError("selected funding exposure requires both portfolio sides")
    try:
        long_mean = sum((latest_funding_rates[symbol] for symbol in long_symbols), ZERO) / Decimal(
            len(long_symbols)
        )
        short_mean = sum(
            (latest_funding_rates[symbol] for symbol in short_symbols), ZERO
        ) / Decimal(len(short_symbols))
    except KeyError as exc:
        raise EvidenceError("selected funding exposure is missing a symbol rate") from exc
    return abs((long_mean - short_mean) / Decimal(2))


def evaluate_cohort(
    bundle: DataBundle,
    *,
    symbols: Sequence[str],
    trial: Trial,
    entry_ms: int,
    minimum_eligible: int,
    fee_rate: Decimal,
    adverse_rates: tuple[Decimal, Decimal, Decimal],
    residualization_training_days: int = 30,
    residualization_minimum_pairs: int = 600,
) -> tuple[CohortResult | None, str | None]:
    exit_ms = entry_ms + trial.hold_hours * HOUR_MS
    coefficients = fit_prior_residualization(
        bundle,
        symbols=symbols,
        trial=trial,
        entry_ms=entry_ms,
        training_days=residualization_training_days,
        minimum_pairs=residualization_minimum_pairs,
    )
    if coefficients is None:
        return None, "INSUFFICIENT_PRIOR_RESIDUALIZATION_TRAINING"
    intercept, slope, training_pairs = coefficients
    premium_means: dict[str, Decimal] = {}
    latest_funding_rates: dict[str, Decimal] = {}
    capacities: dict[str, Decimal] = {}
    for symbol in symbols:
        symbol_bars = bundle.bars[symbol]
        symbol_premium = bundle.premiums[symbol]
        complete = True
        premium_mean = _premium_mean_at(
            symbol_premium,
            entry_ms=entry_ms,
            lookback_hours=trial.lookback_hours,
        )
        if premium_mean is None or entry_ms not in symbol_bars or exit_ms not in symbol_bars:
            continue
        trailing: list[Bar] = []
        for offset in range(1, 25):
            bar = symbol_bars.get(entry_ms - offset * HOUR_MS)
            if bar is None:
                complete = False
                break
            trailing.append(bar)
        if not complete:
            continue
        latest_funding = _latest_funding_rate_8h(bundle.funding[symbol], entry_ms)
        if latest_funding is None:
            continue
        premium_means[symbol] = premium_mean
        latest_funding_rates[symbol] = latest_funding
        capacities[symbol] = sum((bar.quote_volume for bar in trailing), ZERO) * Decimal("0.0001")
    if len(premium_means) < minimum_eligible:
        return None, "TOO_FEW_ELIGIBLE_SYMBOLS"
    signals, signal_funding_correlation = residualize_premium_signal(
        premium_means,
        latest_funding_rates,
        intercept=intercept,
        slope=slope,
    )
    target = int(Decimal(len(signals)) * trial.tail_fraction)
    long_symbols = _atomic_tail(signals, target, lowest=True)
    short_symbols = _atomic_tail(signals, target, lowest=False)
    if len(long_symbols) < 5 or len(short_symbols) < 5:
        return None, "ATOMIC_TAIL_TOO_SMALL"
    if set(long_symbols) & set(short_symbols):
        return None, "TAILS_OVERLAP"
    selected_funding_exposure = selected_portfolio_funding_exposure_8h(
        latest_funding_rates,
        long_symbols=long_symbols,
        short_symbols=short_symbols,
    )
    gross = Decomposition()
    base = Decomposition()
    stress = Decomposition()
    severe = Decomposition()
    side_notional_long = Decimal("500") / Decimal(len(long_symbols))
    side_notional_short = Decimal("500") / Decimal(len(short_symbols))
    capacity_fit = True
    capacity_scales: list[Decimal] = []
    convergence_values: list[Decimal] = []
    funding_settlements = 0
    for symbol, sign, notional in (
        *((symbol, 1, side_notional_long) for symbol in long_symbols),
        *((symbol, -1, side_notional_short) for symbol in short_symbols),
    ):
        entry_bar = bundle.bars[symbol].get(entry_ms)
        exit_bar = bundle.bars[symbol].get(exit_ms)
        exit_premium = bundle.premiums[symbol].get(exit_ms - HOUR_MS)
        if entry_bar is None or exit_bar is None or exit_premium is None:
            return None, "SELECTED_BOUNDARY_MISSING"
        funding_result = _position_funding(
            events=bundle.funding[symbol],
            entry_ms=entry_ms,
            exit_ms=exit_ms,
        )
        if funding_result is None:
            return None, "SELECTED_FUNDING_SETTLEMENT_UNMEASURED"
        funding_cash, funding_count = funding_result
        funding_settlements += funding_count
        if capacities[symbol] < notional:
            capacity_fit = False
        capacity_scales.append(capacities[symbol] / notional)
        gross.add(
            _position_decomposition(
                entry=entry_bar.open,
                exit_price=exit_bar.open,
                notional=notional,
                sign=sign,
                fee_rate=ZERO,
                adverse_rate=ZERO,
            )
        )
        gross.funding += funding_cash
        for decomposition, adverse in zip((base, stress, severe), adverse_rates, strict=True):
            decomposition.add(
                _position_decomposition(
                    entry=entry_bar.open,
                    exit_price=exit_bar.open,
                    notional=notional,
                    sign=sign,
                    fee_rate=fee_rate,
                    adverse_rate=adverse,
                )
            )
            decomposition.funding += funding_cash
        convergence_values.append(Decimal(sign) * (exit_premium.close - premium_means[symbol]))
    capacity_proxy = min(capacity_scales) * Decimal("1000")
    return (
        CohortResult(
            entry_time_ms=entry_ms,
            exit_time_ms=exit_ms,
            long_symbols=long_symbols,
            short_symbols=short_symbols,
            gross=gross,
            base=base,
            stress=stress,
            severe=severe,
            capacity_proxy_usd=capacity_proxy,
            capacity_fit=capacity_fit,
            premium_convergence=sum(convergence_values, ZERO) / Decimal(len(convergence_values)),
            signal_funding_correlation=signal_funding_correlation,
            selected_funding_exposure_8h=selected_funding_exposure,
            residualization_training_pairs=training_pairs,
            funding_settlements=funding_settlements,
        ),
        None,
    )


def evaluate_trial(
    bundle: DataBundle,
    *,
    symbols: Sequence[str],
    trial: Trial,
    start_ms: int,
    end_ms: int,
    entry_hours: Sequence[int],
    minimum_eligible: int,
    fee_rate: Decimal,
    adverse_rates: tuple[Decimal, Decimal, Decimal],
    residualization_training_days: int = 30,
    residualization_minimum_pairs: int = 600,
) -> TrialRun:
    schedule = tuple(
        entry
        for entry in entry_times(start_ms, end_ms, entry_hours)
        if entry + trial.hold_hours * HOUR_MS <= end_ms
    )
    cohorts: list[CohortResult] = []
    reasons: dict[str, int] = defaultdict(int)
    for entry in schedule:
        result, reason = evaluate_cohort(
            bundle,
            symbols=symbols,
            trial=trial,
            entry_ms=entry,
            minimum_eligible=minimum_eligible,
            fee_rate=fee_rate,
            adverse_rates=adverse_rates,
            residualization_training_days=residualization_training_days,
            residualization_minimum_pairs=residualization_minimum_pairs,
        )
        if result is None:
            reasons[reason or "UNKNOWN_INVALID"] += 1
        else:
            cohorts.append(result)
    funding_settlements = sum(cohort.funding_settlements for cohort in cohorts)
    return TrialRun(
        trial=trial,
        scheduled=len(schedule),
        invalid=len(schedule) - len(cohorts),
        invalid_reasons=dict(sorted(reasons.items())),
        cohorts=tuple(cohorts),
        funding_settlements=funding_settlements,
    )


def _scenario_decomposition(cohort: CohortResult, scenario: str) -> Decomposition:
    if scenario not in {"gross", "base", "stress", "severe"}:
        raise EvidenceError(f"unknown cost scenario {scenario}")
    return cast(Decomposition, getattr(cohort, scenario))


def daily_pnl(
    run: TrialRun, *, scenario: str, start_ms: int, end_ms: int
) -> tuple[tuple[date, ...], tuple[Decimal, ...]]:
    values: dict[date, Decimal] = defaultdict(Decimal)
    for cohort in run.cohorts:
        cohort_day = datetime.fromtimestamp(cohort.entry_time_ms / 1000, tz=UTC).date()
        values[cohort_day] += _scenario_decomposition(cohort, scenario).net
    start_day = datetime.fromtimestamp(start_ms / 1000, tz=UTC).date()
    end_day = datetime.fromtimestamp((end_ms - 1) / 1000, tz=UTC).date()
    days: list[date] = []
    pnl: list[Decimal] = []
    cursor = start_day
    while cursor <= end_day:
        days.append(cursor)
        pnl.append(values.get(cursor, ZERO))
        cursor += timedelta(days=1)
    return tuple(days), tuple(pnl)


def _sum_decomposition(cohorts: Sequence[CohortResult], scenario: str) -> Decomposition:
    result = Decomposition()
    for cohort in cohorts:
        result.add(_scenario_decomposition(cohort, scenario))
    return result


def maximum_drawdown(cohorts: Sequence[CohortResult], scenario: str) -> Decimal:
    equity = Decimal("1000")
    peak = equity
    maximum = ZERO
    for cohort in sorted(cohorts, key=lambda item: item.exit_time_ms):
        equity += _scenario_decomposition(cohort, scenario).net
        if equity > peak:
            peak = equity
        if peak > ZERO:
            maximum = max(maximum, (peak - equity) / peak)
    return maximum


def trial_summary(run: TrialRun) -> dict[str, object]:
    long_names = {symbol for cohort in run.cohorts for symbol in cohort.long_symbols}
    short_names = {symbol for cohort in run.cohorts for symbol in cohort.short_symbols}
    capacities = [cohort.capacity_proxy_usd for cohort in run.cohorts]
    convergence = [cohort.premium_convergence for cohort in run.cohorts]
    funding_correlations = [abs(cohort.signal_funding_correlation) for cohort in run.cohorts]
    funding_exposures = [abs(cohort.selected_funding_exposure_8h) for cohort in run.cohorts]
    training_pairs = [cohort.residualization_training_pairs for cohort in run.cohorts]
    return {
        "trial": run.trial.as_mapping(),
        "scheduledCohorts": run.scheduled,
        "completedCohorts": len(run.cohorts),
        "invalidCohorts": run.invalid,
        "invalidReasonCounts": dict(run.invalid_reasons),
        "actualFundingSettlements": run.funding_settlements,
        "distinctLongSymbols": len(long_names),
        "distinctShortSymbols": len(short_names),
        "gross": _sum_decomposition(run.cohorts, "gross").as_mapping(),
        "base": _sum_decomposition(run.cohorts, "base").as_mapping(),
        "stress": _sum_decomposition(run.cohorts, "stress").as_mapping(),
        "severe": _sum_decomposition(run.cohorts, "severe").as_mapping(),
        "baseExitBoundaryMaximumDrawdownPct": decimal_text(
            maximum_drawdown(run.cohorts, "base") * 100
        ),
        "stressExitBoundaryMaximumDrawdownPct": decimal_text(
            maximum_drawdown(run.cohorts, "stress") * 100
        ),
        "minimumCapacityProxyUsd": (money_text(min(capacities)) if capacities else None),
        "allActualLegsFitVolumeProxy": all(cohort.capacity_fit for cohort in run.cohorts),
        "meanPremiumConvergence": (
            decimal_text(sum(convergence, ZERO) / Decimal(len(convergence)))
            if convergence
            else None
        ),
        "meanAbsoluteOutOfSampleSignalFundingCorrelation": (
            decimal_text(sum(funding_correlations, ZERO) / Decimal(len(funding_correlations)))
            if funding_correlations
            else None
        ),
        "meanAbsoluteSelectedPortfolioFundingExposure8h": (
            decimal_text(sum(funding_exposures, ZERO) / Decimal(len(funding_exposures)))
            if funding_exposures
            else None
        ),
        "minimumPriorResidualizationTrainingPairs": (
            min(training_pairs) if training_pairs else None
        ),
    }


def circular_indices(length: int, block_length: int, rng: random.Random) -> tuple[int, ...]:
    if length <= 0 or block_length <= 0:
        raise EvidenceError("bootstrap dimensions must be positive")
    result: list[int] = []
    while len(result) < length:
        start = rng.randrange(length)
        for offset in range(block_length):
            result.append((start + offset) % length)
            if len(result) == length:
                break
    return tuple(result)


def percentile(values: Sequence[float], probability: float) -> float:
    if not values or not 0 <= probability <= 1:
        raise EvidenceError("invalid percentile request")
    ordered = sorted(values)
    index = min(len(ordered) - 1, math.floor(probability * len(ordered)))
    return ordered[index]


def bootstrap_interval(
    values: Sequence[Decimal],
    *,
    replicates: int,
    block_length: int,
    seed: int,
) -> dict[str, object]:
    if not values:
        return {"status": "UNKNOWN", "reason": "NO_OBSERVATIONS"}
    floats = tuple(float(item) for item in values)
    rng = random.Random(seed)
    totals: list[float] = []
    for _ in range(replicates):
        indices = circular_indices(len(floats), block_length, rng)
        totals.append(sum(floats[index] for index in indices))
    return {
        "status": "MEASURED_PUBLIC_SCENARIO",
        "pointUsd": money_text(sum(values, ZERO)),
        "lowerUsd": f"{percentile(totals, 0.025):.8f}",
        "upperUsd": f"{percentile(totals, 0.975):.8f}",
        "replicates": replicates,
        "blockLengthDays": block_length,
        "seed": seed,
    }


def development_multiplicity(
    runs: Mapping[str, TrialRun],
    *,
    start_ms: int,
    end_ms: int,
    primary_id: str,
    replicates: int,
    block_length: int,
    seed: int,
) -> dict[str, object]:
    trial_ids = tuple(sorted(runs))
    if not trial_ids or any(runs[trial_id].invalid for trial_id in trial_ids):
        return {
            "status": "UNKNOWN",
            "reason": "INCOMPLETE_TRIAL_MATRIX",
            "primaryPass": False,
        }
    matrix: dict[str, tuple[float, ...]] = {}
    expected_days: tuple[date, ...] | None = None
    for trial_id in trial_ids:
        days, pnl = daily_pnl(runs[trial_id], scenario="stress", start_ms=start_ms, end_ms=end_ms)
        if expected_days is None:
            expected_days = days
        elif days != expected_days:
            raise EvidenceError("development trial calendars differ")
        matrix[trial_id] = tuple(float(item) for item in pnl)
    length = len(next(iter(matrix.values())))
    if length == 0 or any(len(values) != length for values in matrix.values()):
        return {
            "status": "UNKNOWN",
            "reason": "EMPTY_OR_RAGGED_TRIAL_MATRIX",
            "primaryPass": False,
        }
    observed_means = {trial_id: statistics.fmean(values) for trial_id, values in matrix.items()}
    centered = {
        trial_id: tuple(value - observed_means[trial_id] for value in values)
        for trial_id, values in matrix.items()
    }
    exceed = dict.fromkeys(trial_ids, 0)
    boot_totals: dict[str, list[float]] = {trial_id: [] for trial_id in trial_ids}
    observed_max = max(observed_means.values())
    reality_exceed = 0
    rng = random.Random(seed)
    for _ in range(replicates):
        indices = circular_indices(length, block_length, rng)
        boot_means: dict[str, float] = {}
        for trial_id in trial_ids:
            centered_mean = statistics.fmean(centered[trial_id][index] for index in indices)
            boot_means[trial_id] = centered_mean
            if centered_mean >= observed_means[trial_id]:
                exceed[trial_id] += 1
            boot_totals[trial_id].append(sum(matrix[trial_id][index] for index in indices))
        if max(boot_means.values()) >= observed_max:
            reality_exceed += 1
    p_values = {trial_id: (exceed[trial_id] + 1) / (replicates + 1) for trial_id in trial_ids}
    alpha = 0.05
    rejected: list[str] = []
    for index, trial_id in enumerate(sorted(trial_ids, key=lambda item: (p_values[item], item))):
        threshold = alpha / (len(trial_ids) - index)
        if p_values[trial_id] <= threshold:
            rejected.append(trial_id)
        else:
            break
    bonf_probability = alpha / len(trial_ids)
    bonf_lower = {
        trial_id: percentile(boot_totals[trial_id], bonf_probability) for trial_id in trial_ids
    }
    reality_p = (reality_exceed + 1) / (replicates + 1)
    primary_pass = primary_id in rejected and bonf_lower[primary_id] > 0 and reality_p <= alpha
    return {
        "status": "MEASURED",
        "trialCount": len(trial_ids),
        "days": length,
        "replicates": replicates,
        "blockLengthDays": block_length,
        "oneSidedPValues": {trial_id: f"{p_values[trial_id]:.8f}" for trial_id in trial_ids},
        "holmRejected": rejected,
        "bonferroniStressTotalLowerUsd": {
            trial_id: f"{bonf_lower[trial_id]:.8f}" for trial_id in trial_ids
        },
        "whiteRealityCheckPValue": f"{reality_p:.8f}",
        "primaryPass": primary_pass,
    }


def pbo_cscv(
    runs: Mapping[str, TrialRun],
    *,
    start_ms: int,
    end_ms: int,
    core_days: int,
    blocks: int,
) -> dict[str, object]:
    trial_ids = tuple(sorted(runs))
    if not trial_ids or any(runs[trial_id].invalid for trial_id in trial_ids):
        return {"status": "UNKNOWN", "reason": "INCOMPLETE_TRIAL_MATRIX"}
    matrix: dict[str, tuple[float, ...]] = {}
    calendar: tuple[date, ...] | None = None
    for trial_id in trial_ids:
        days, pnl = daily_pnl(runs[trial_id], scenario="stress", start_ms=start_ms, end_ms=end_ms)
        if calendar is None:
            calendar = days
        elif calendar != days:
            raise EvidenceError("PBO trial calendars differ")
        matrix[trial_id] = tuple(float(value) for value in pnl[:core_days])
    if calendar is None or len(calendar) < core_days or core_days % blocks:
        return {"status": "UNKNOWN", "reason": "INSUFFICIENT_EQUAL_BLOCK_DAYS"}
    block_size = core_days // blocks
    combinations = tuple(itertools.combinations(range(blocks), blocks // 2))
    underperform = 0
    logits: list[float] = []
    chosen_counts: dict[str, int] = defaultdict(int)
    all_blocks = set(range(blocks))
    for training_blocks in combinations:
        training_indices = tuple(
            index
            for block in training_blocks
            for index in range(block * block_size, (block + 1) * block_size)
        )
        testing_blocks = sorted(all_blocks - set(training_blocks))
        testing_indices = tuple(
            index
            for block in testing_blocks
            for index in range(block * block_size, (block + 1) * block_size)
        )
        training_scores = {
            trial_id: sum(matrix[trial_id][index] for index in training_indices)
            for trial_id in trial_ids
        }
        chosen = min(trial_ids, key=lambda trial_id: (-training_scores[trial_id], trial_id))
        chosen_counts[chosen] += 1
        testing_scores = {
            trial_id: sum(matrix[trial_id][index] for index in testing_indices)
            for trial_id in trial_ids
        }
        median_score = statistics.median(testing_scores.values())
        if testing_scores[chosen] <= median_score:
            underperform += 1
        ordered = sorted(trial_ids, key=lambda trial_id: (testing_scores[trial_id], trial_id))
        rank = ordered.index(chosen) + 1
        percentile_rank = (rank - 0.5) / len(trial_ids)
        logits.append(math.log(percentile_rank / (1 - percentile_rank)))
    pbo = underperform / len(combinations)
    return {
        "status": "MEASURED",
        "coreDays": core_days,
        "blocks": blocks,
        "daysPerBlock": block_size,
        "splits": len(combinations),
        "pbo": f"{pbo:.8f}",
        "rankLogitMedian": f"{statistics.median(logits):.8f}",
        "rankLogitLower": f"{percentile(logits, 0.05):.8f}",
        "rankLogitUpper": f"{percentile(logits, 0.95):.8f}",
        "selectedTrialCounts": dict(sorted(chosen_counts.items())),
    }


def walk_forward(
    runs: Mapping[str, TrialRun],
    *,
    start_ms: int,
    end_ms: int,
    test_months: Sequence[str],
    primary_id: str,
) -> dict[str, object]:
    primary = runs.get(primary_id)
    if primary is None or primary.invalid:
        return {"status": "UNKNOWN", "reason": "PRIMARY_TRIAL_INCOMPLETE"}
    days, values = daily_pnl(primary, scenario="stress", start_ms=start_ms, end_ms=end_ms)
    records: list[dict[str, object]] = []
    total = ZERO
    for month in test_months:
        test_start, test_end = month_bounds(month)
        test_start_day = test_start.date()
        test_end_day = test_end.date()
        train_values = [
            value for day, value in zip(days, values, strict=True) if day < test_start_day
        ]
        test_values = [
            value
            for day, value in zip(days, values, strict=True)
            if test_start_day <= day < test_end_day
        ]
        training_days = len(train_values)
        if training_days < 90:
            return {"status": "UNKNOWN", "reason": "LESS_THAN_90_TRAINING_DAYS"}
        training_score = sum(train_values, ZERO)
        test_score = sum(test_values, ZERO)
        total += test_score
        records.append(
            {
                "testMonth": month,
                "trainingDays": training_days,
                "deployedTrialId": primary_id,
                "priorTrainingStressNetUsd": money_text(training_score),
                "testStressNetUsd": money_text(test_score),
            }
        )
    return {
        "status": "MEASURED",
        "folds": records,
        "foldCount": len(records),
        "deployedTrialId": primary_id,
        "stressNetUsd": money_text(total),
        "positiveMonths": sum(
            decimal_value(item["testStressNetUsd"], field="walk-forward test net") > ZERO
            for item in records
        ),
    }


def btc_daily_beta(
    bundle: DataBundle,
    run: TrialRun,
    *,
    start_ms: int,
    end_ms: int,
) -> dict[str, object]:
    btc = bundle.bars.get("BTCUSDT")
    if btc is None:
        return {"status": "UNKNOWN", "reason": "BTCUSDT_NOT_IN_FROZEN_COHORT"}
    days, pnl = daily_pnl(run, scenario="base", start_ms=start_ms, end_ms=end_ms)
    btc_by_day: dict[date, list[Bar]] = defaultdict(list)
    for bar in btc.values():
        if start_ms <= bar.open_time_ms < end_ms:
            btc_by_day[datetime.fromtimestamp(bar.open_time_ms / 1000, tz=UTC).date()].append(bar)
    strategy: list[float] = []
    benchmark: list[float] = []
    for day, day_pnl in zip(days, pnl, strict=True):
        bars = sorted(btc_by_day.get(day, []), key=lambda item: item.open_time_ms)
        if len(bars) != 24:
            continue
        strategy.append(float(day_pnl / Decimal("1000")))
        benchmark.append(float(bars[-1].close / bars[0].open - ONE))
    if len(strategy) < 30 or statistics.pvariance(benchmark) == 0:
        return {"status": "UNKNOWN", "reason": "INSUFFICIENT_BTC_DAILY_OVERLAP"}
    mean_strategy = statistics.fmean(strategy)
    mean_benchmark = statistics.fmean(benchmark)
    covariance = statistics.fmean(
        (left - mean_strategy) * (right - mean_benchmark)
        for left, right in zip(strategy, benchmark, strict=True)
    )
    variance = statistics.fmean((value - mean_benchmark) ** 2 for value in benchmark)
    correlation_denominator = math.sqrt(
        statistics.pvariance(strategy) * statistics.pvariance(benchmark)
    )
    correlation = covariance / correlation_denominator if correlation_denominator > 0 else math.nan
    return {
        "status": "MEASURED",
        "days": len(strategy),
        "beta": f"{covariance / variance:.8f}",
        "correlation": f"{correlation:.8f}" if math.isfinite(correlation) else None,
    }


def _binding(path: Path) -> str | None:
    return sha256_path(path) if path.is_file() else None


def _assert_frozen_evaluator(freeze_payload: Mapping[str, Any]) -> str:
    bindings = cast(Mapping[str, Any], freeze_payload["bindings"])
    expected = require_text(bindings["evaluatorSha256"], field="frozen evaluator sha")
    actual = script_sha()
    if expected != actual:
        raise EvidenceError("frozen evaluator changed after protocol freeze")
    return actual


def _assert_frozen_packet(
    freeze_payload: Mapping[str, Any],
    *,
    expected_freeze_sha: str,
) -> str:
    current_freeze, current_raw = load_json(FREEZE_PATH)
    if sha256_bytes(current_raw) != expected_freeze_sha or current_freeze != freeze_payload:
        raise EvidenceError("frozen evidence packet changed during the sealed run")
    bindings = cast(Mapping[str, Any], freeze_payload["bindings"])
    _, protocol_sha = load_protocol()
    if bindings.get("protocolSha256") != protocol_sha:
        raise EvidenceError("frozen protocol changed during the sealed run")
    if bindings.get("officialSourceResearchSha256") != sha256_path(OFFICIAL_SOURCES_PATH):
        raise EvidenceError("frozen official-source research changed during the sealed run")
    return _assert_frozen_evaluator(freeze_payload)


def _seal_exact(path: Path, raw: bytes) -> None:
    if path.exists():
        try:
            existing = path.read_bytes()
        except OSError as exc:
            raise ResultSealError(f"sealed evidence is unreadable: {path}") from exc
        if existing != raw:
            raise ResultSealError(f"sealed evidence conflicts with intended bytes: {path}")
        return
    try:
        exclusive_write(path, raw)
    except EvidenceError:
        if path.is_file() and path.read_bytes() == raw:
            return
        raise


def _write_result(
    state_root: Path,
    result: Mapping[str, Any],
    *,
    allow_evaluator_drift: bool = False,
) -> None:
    if allow_evaluator_drift:
        freeze_payload, freeze_raw = load_json(FREEZE_PATH)
        if freeze_payload.get("schema") != "S1IPremiumDislocationFreezeV1":
            raise ResultSealError("cannot stage result against an invalid freeze packet")
        freeze_sha = sha256_bytes(freeze_raw)
    else:
        freeze_payload, freeze_sha = load_freeze()
    bindings = cast(Mapping[str, Any], freeze_payload["bindings"])
    evaluator_sha = require_text(bindings["evaluatorSha256"], field="frozen evaluator sha")
    protocol_sha = require_text(bindings["protocolSha256"], field="frozen protocol sha")
    if not allow_evaluator_drift:
        _assert_frozen_evaluator(freeze_payload)
    raw = canonical_bytes(result)
    result_bindings = cast(Mapping[str, Any], result["bindings"])
    if (
        result_bindings.get("freezeSha256") != freeze_sha
        or result_bindings.get("evaluatorSha256") != evaluator_sha
        or result_bindings.get("protocolSha256") != protocol_sha
    ):
        raise ResultSealError("terminal result does not bind the frozen evaluator packet")
    receipt = {
        "schema": "S1IResultReceiptV1",
        "createdAtUtc": require_text(result["completedAtUtc"], field="result completed time"),
        "resultSha256": sha256_bytes(raw),
        "resultState": require_text(result["state"], field="result state"),
        "protocolSha256": protocol_sha,
        "freezeSha256": freeze_sha,
        "evaluatorSha256": evaluator_sha,
        "result": result,
    }
    try:
        _seal_exact(state_root / RESULT_RECEIPT_NAME, canonical_bytes(receipt))
        _seal_exact(RESULT_PATH, raw)
    except (EvidenceError, OSError) as exc:
        raise ResultSealError(
            "terminal result seal incomplete; rerun report to finalize the staged exact result"
        ) from exc


def _terminal_result(
    *,
    state_root: Path,
    acquisition_sha: str,
    reason: str,
    state: str,
) -> dict[str, Any]:
    freeze_payload, freeze_raw = load_json(FREEZE_PATH)
    if freeze_payload.get("schema") != "S1IPremiumDislocationFreezeV1":
        raise ResultSealError("cannot terminalize against an invalid freeze packet")
    freeze_sha = sha256_bytes(freeze_raw)
    freeze_bindings = cast(Mapping[str, Any], freeze_payload["bindings"])
    frozen_evaluator_sha = require_text(
        freeze_bindings["evaluatorSha256"], field="frozen evaluator sha"
    )
    frozen_protocol_sha = require_text(
        freeze_bindings["protocolSha256"], field="frozen protocol sha"
    )
    evaluator_drift_detected = script_sha() != frozen_evaluator_sha
    run_consumed = (state_root / RUN_MARKER_NAME).is_file()
    result: dict[str, Any] = {
        "schema": "S1IPremiumDislocationResultV1",
        "completedAtUtc": now_utc(),
        "state": state,
        "measurementVerdict": "UNMEASURED",
        "capitalVerdict": "NO_GO",
        "crediblePositiveCount": 0,
        "executionAuthority": "NONE",
        "consumer": "N3",
        "bindings": {
            "freezeSha256": freeze_sha,
            "acquisitionManifestSha256": acquisition_sha,
            "runMarkerSha256": _binding(state_root / RUN_MARKER_NAME),
            "candidateSealSha256": _binding(state_root / CANDIDATE_SEAL_NAME),
            "holdoutOpenSha256": _binding(state_root / HOLDOUT_OPEN_NAME),
            "protocolSha256": frozen_protocol_sha,
            "evaluatorSha256": frozen_evaluator_sha,
        },
        "lifecycle": {
            "reason": reason,
            "holdoutOpened": (state_root / HOLDOUT_OPEN_NAME).is_file(),
            "runConsumed": run_consumed,
            "studyTerminal": True,
            "retryAllowed": False,
            "terminalBasis": (
                "SEALED_RUN_CONSUMED" if run_consumed else "SEALED_ACQUISITION_PREFLIGHT"
            ),
            "evaluatorDriftDetected": evaluator_drift_detected,
            "postRunRepairAllowed": False,
        },
        "development": {"status": "UNMEASURED"},
        "holdout": {"status": "UNMEASURED"},
        "gates": {"measurementComplete": False, "decisions": []},
        "limitations": [
            "ACCOUNT_EFFECTIVE_COMMISSION_UNKNOWN_PUBLIC_ONLY",
            "HISTORICAL_BOOK_DEPTH_SPREAD_QUEUE_AND_REALIZED_IMPACT_UNAVAILABLE",
            "EXECUTABLE_CAPACITY_UNKNOWN_VOLUME_PROXY_ONLY",
            "OBSERVATIONAL_TEMPORAL_TEST_DOES_NOT_ESTABLISH_STRUCTURAL_CAUSALITY",
            (
                "SEALED_ONE_RUN_FAILURE_CANNOT_BE_REPAIRED_OR_RERUN"
                if run_consumed
                else "SEALED_ACQUISITION_PACKET_FAILED_BEFORE_RUN_MARKER"
            ),
        ],
    }
    _write_result(state_root, result, allow_evaluator_drift=True)
    return result


def _decimal_from_summary(summary: Mapping[str, Any], scenario: str, field: str) -> Decimal:
    packet = cast(Mapping[str, Any], summary[scenario])
    return decimal_value(packet[field], field=f"{scenario}.{field}")


def _decision(
    gate: str,
    status: str,
    *,
    observed: object,
    threshold: object | None = None,
    reason: str | None = None,
) -> dict[str, object]:
    if status not in {"PASS", "FAIL", "UNKNOWN"}:
        raise EvidenceError(f"invalid decision status {status}")
    result: dict[str, object] = {
        "gate": gate,
        "status": status,
        "observed": observed,
    }
    if threshold is not None:
        result["threshold"] = threshold
    if reason is not None:
        result["reason"] = reason
    return result


def _aggregate_decision_status(decisions: Sequence[Mapping[str, object]]) -> str:
    if any(item.get("status") == "FAIL" for item in decisions):
        return "FAIL"
    if any(item.get("status") == "UNKNOWN" for item in decisions):
        return "UNKNOWN"
    if decisions and all(item.get("status") == "PASS" for item in decisions):
        return "PASS"
    raise EvidenceError("decision set is empty or contains an invalid status")


def _preholdout_decisions(
    *,
    primary_summary: Mapping[str, Any],
    multiplicity: Mapping[str, Any],
    walk: Mapping[str, Any],
    minimum_development: int,
    maximum_funding_correlation: Decimal,
    maximum_selected_funding_exposure: Decimal,
) -> list[dict[str, object]]:
    completed = require_int(
        primary_summary["completedCohorts"],
        field="completed development cohorts",
    )
    invalid = require_int(
        primary_summary["invalidCohorts"],
        field="invalid development cohorts",
    )
    sample_complete = completed >= minimum_development and invalid == 0
    sample_status = "PASS" if sample_complete else "UNKNOWN"
    decisions = [
        _decision(
            "DEVELOPMENT_SAMPLE_COMPLETE",
            sample_status,
            observed={"completedCohorts": completed, "invalidCohorts": invalid},
            threshold={"minimumCompleted": minimum_development, "maximumInvalid": 0},
            reason=None if sample_complete else "PRIMARY_DEVELOPMENT_SAMPLE_INCOMPLETE",
        )
    ]
    gross_price = _decimal_from_summary(primary_summary, "gross", "grossPriceUsd")
    decisions.append(
        _decision(
            "DEVELOPMENT_GROSS_PRICE_POSITIVE",
            ("PASS" if gross_price > ZERO else "FAIL") if sample_complete else "UNKNOWN",
            observed=money_text(gross_price),
            threshold=">0",
            reason=None if sample_complete else "PRIMARY_DEVELOPMENT_SAMPLE_INCOMPLETE",
        )
    )
    for gate, scenario in (
        ("DEVELOPMENT_BASE_NET_POSITIVE", "base"),
        ("DEVELOPMENT_STRESS_NET_POSITIVE", "stress"),
    ):
        value = _decimal_from_summary(primary_summary, scenario, "netUsd")
        decisions.append(
            _decision(
                gate,
                ("PASS" if value > ZERO else "FAIL") if sample_complete else "UNKNOWN",
                observed=money_text(value),
                threshold=">0",
                reason=None if sample_complete else "PRIMARY_DEVELOPMENT_SAMPLE_INCOMPLETE",
            )
        )
    correlation_raw = primary_summary.get("meanAbsoluteOutOfSampleSignalFundingCorrelation")
    if correlation_raw is None or not sample_complete:
        decisions.append(
            _decision(
                "OUT_OF_SAMPLE_FUNDING_NEUTRAL_SIGNAL",
                "UNKNOWN",
                observed=correlation_raw,
                threshold=f"<={decimal_text(maximum_funding_correlation)}",
                reason=(
                    "PRIMARY_DEVELOPMENT_SAMPLE_INCOMPLETE"
                    if not sample_complete
                    else "SIGNAL_FUNDING_CORRELATION_UNAVAILABLE"
                ),
            )
        )
    else:
        correlation = decimal_value(
            correlation_raw,
            field="maximum signal-funding correlation",
        )
        decisions.append(
            _decision(
                "OUT_OF_SAMPLE_FUNDING_NEUTRAL_SIGNAL",
                "PASS" if correlation <= maximum_funding_correlation else "FAIL",
                observed=decimal_text(correlation),
                threshold=f"<={decimal_text(maximum_funding_correlation)}",
            )
        )
    exposure_raw = primary_summary.get("meanAbsoluteSelectedPortfolioFundingExposure8h")
    if exposure_raw is None or not sample_complete:
        decisions.append(
            _decision(
                "SELECTED_PORTFOLIO_FUNDING_EXPOSURE_8H",
                "UNKNOWN",
                observed=exposure_raw,
                threshold=f"<={decimal_text(maximum_selected_funding_exposure)}",
                reason=(
                    "PRIMARY_DEVELOPMENT_SAMPLE_INCOMPLETE"
                    if not sample_complete
                    else "SELECTED_FUNDING_EXPOSURE_UNAVAILABLE"
                ),
            )
        )
    else:
        exposure = decimal_value(
            exposure_raw,
            field="mean absolute selected portfolio funding exposure",
        )
        decisions.append(
            _decision(
                "SELECTED_PORTFOLIO_FUNDING_EXPOSURE_8H",
                "PASS" if exposure <= maximum_selected_funding_exposure else "FAIL",
                observed=decimal_text(exposure),
                threshold=f"<={decimal_text(maximum_selected_funding_exposure)}",
            )
        )
    if multiplicity.get("status") != "MEASURED":
        decisions.append(
            _decision(
                "DEVELOPMENT_MULTIPLICITY",
                "UNKNOWN",
                observed=multiplicity.get("status"),
                reason="MULTIPLICITY_NOT_MEASURED",
            )
        )
    else:
        multiplicity_pass = multiplicity.get("primaryPass") is True
        decisions.append(
            _decision(
                "DEVELOPMENT_MULTIPLICITY",
                "PASS" if multiplicity_pass else "FAIL",
                observed=multiplicity.get("primaryPass"),
                threshold=True,
            )
        )
    if walk.get("status") != "MEASURED":
        decisions.append(
            _decision(
                "CAUSAL_WALK_FORWARD_STRESS_POSITIVE",
                "UNKNOWN",
                observed=walk.get("status"),
                reason="WALK_FORWARD_NOT_MEASURED",
            )
        )
    else:
        walk_net = decimal_value(walk.get("stressNetUsd"), field="walk stress")
        decisions.append(
            _decision(
                "CAUSAL_WALK_FORWARD_STRESS_POSITIVE",
                "PASS" if walk_net > ZERO else "FAIL",
                observed=money_text(walk_net),
                threshold=">0",
            )
        )
    return decisions


def _final_decisions(
    *,
    holdout_summary: Mapping[str, Any],
    interval: Mapping[str, Any],
    beta: Mapping[str, Any],
    minimum_holdout: int,
    minimum_distinct: int,
    maximum_drawdown_pct: Decimal,
    maximum_abs_beta: Decimal,
    minimum_capacity: Decimal,
    maximum_funding_correlation: Decimal,
    maximum_selected_funding_exposure: Decimal,
) -> list[dict[str, object]]:
    completed = require_int(holdout_summary["completedCohorts"], field="holdout completed")
    invalid = require_int(holdout_summary["invalidCohorts"], field="holdout invalid")
    sample_complete = completed >= minimum_holdout and invalid == 0
    decisions = [
        _decision(
            "HOLDOUT_SAMPLE_COMPLETE",
            "PASS" if sample_complete else "UNKNOWN",
            observed={"completedCohorts": completed, "invalidCohorts": invalid},
            threshold={"minimumCompleted": minimum_holdout, "maximumInvalid": 0},
            reason=None if sample_complete else "PRIMARY_HOLDOUT_SAMPLE_INCOMPLETE",
        )
    ]
    long_count = require_int(holdout_summary["distinctLongSymbols"], field="distinct long")
    short_count = require_int(holdout_summary["distinctShortSymbols"], field="distinct short")
    distinct_pass = long_count >= minimum_distinct and short_count >= minimum_distinct
    decisions.append(
        _decision(
            "HOLDOUT_DISTINCT_SYMBOLS",
            ("PASS" if distinct_pass else "FAIL") if sample_complete else "UNKNOWN",
            observed={"long": long_count, "short": short_count},
            threshold={"minimumEachSide": minimum_distinct},
            reason=None if sample_complete else "PRIMARY_HOLDOUT_SAMPLE_INCOMPLETE",
        )
    )
    correlation_raw = holdout_summary.get("meanAbsoluteOutOfSampleSignalFundingCorrelation")
    if correlation_raw is None or not sample_complete:
        decisions.append(
            _decision(
                "OUT_OF_SAMPLE_FUNDING_NEUTRAL_SIGNAL",
                "UNKNOWN",
                observed=correlation_raw,
                threshold=f"<={decimal_text(maximum_funding_correlation)}",
                reason=(
                    "PRIMARY_HOLDOUT_SAMPLE_INCOMPLETE"
                    if not sample_complete
                    else "SIGNAL_FUNDING_CORRELATION_UNAVAILABLE"
                ),
            )
        )
    else:
        correlation = decimal_value(
            correlation_raw,
            field="maximum signal-funding correlation",
        )
        decisions.append(
            _decision(
                "OUT_OF_SAMPLE_FUNDING_NEUTRAL_SIGNAL",
                "PASS" if correlation <= maximum_funding_correlation else "FAIL",
                observed=decimal_text(correlation),
                threshold=f"<={decimal_text(maximum_funding_correlation)}",
            )
        )
    exposure_raw = holdout_summary.get("meanAbsoluteSelectedPortfolioFundingExposure8h")
    if exposure_raw is None or not sample_complete:
        decisions.append(
            _decision(
                "SELECTED_PORTFOLIO_FUNDING_EXPOSURE_8H",
                "UNKNOWN",
                observed=exposure_raw,
                threshold=f"<={decimal_text(maximum_selected_funding_exposure)}",
                reason=(
                    "PRIMARY_HOLDOUT_SAMPLE_INCOMPLETE"
                    if not sample_complete
                    else "SELECTED_FUNDING_EXPOSURE_UNAVAILABLE"
                ),
            )
        )
    else:
        exposure = decimal_value(
            exposure_raw,
            field="mean absolute selected portfolio funding exposure",
        )
        decisions.append(
            _decision(
                "SELECTED_PORTFOLIO_FUNDING_EXPOSURE_8H",
                "PASS" if exposure <= maximum_selected_funding_exposure else "FAIL",
                observed=decimal_text(exposure),
                threshold=f"<={decimal_text(maximum_selected_funding_exposure)}",
            )
        )
    gross_price = _decimal_from_summary(holdout_summary, "gross", "grossPriceUsd")
    decisions.append(
        _decision(
            "HOLDOUT_GROSS_PRICE_POSITIVE",
            ("PASS" if gross_price > ZERO else "FAIL") if sample_complete else "UNKNOWN",
            observed=money_text(gross_price),
            threshold=">0",
            reason=None if sample_complete else "PRIMARY_HOLDOUT_SAMPLE_INCOMPLETE",
        )
    )
    for gate, scenario in (
        ("HOLDOUT_BASE_NET_POSITIVE", "base"),
        ("HOLDOUT_STRESS_NET_POSITIVE", "stress"),
    ):
        value = _decimal_from_summary(holdout_summary, scenario, "netUsd")
        decisions.append(
            _decision(
                gate,
                ("PASS" if value > ZERO else "FAIL") if sample_complete else "UNKNOWN",
                observed=money_text(value),
                threshold=">0",
                reason=None if sample_complete else "PRIMARY_HOLDOUT_SAMPLE_INCOMPLETE",
            )
        )
    if interval.get("status") != "MEASURED_PUBLIC_SCENARIO" or not sample_complete:
        decisions.append(
            _decision(
                "HOLDOUT_BASE_95PCT_LOWER_POSITIVE",
                "UNKNOWN",
                observed=interval.get("status"),
                threshold=">0",
                reason=(
                    "PRIMARY_HOLDOUT_SAMPLE_INCOMPLETE"
                    if not sample_complete
                    else "BOOTSTRAP_INTERVAL_NOT_MEASURED"
                ),
            )
        )
    else:
        lower = decimal_value(interval.get("lowerUsd"), field="holdout interval lower")
        decisions.append(
            _decision(
                "HOLDOUT_BASE_95PCT_LOWER_POSITIVE",
                "PASS" if lower > ZERO else "FAIL",
                observed=money_text(lower),
                threshold=">0",
            )
        )
    drawdown = decimal_value(
        holdout_summary["baseExitBoundaryMaximumDrawdownPct"],
        field="drawdown",
    )
    decisions.append(
        _decision(
            "EXIT_BOUNDARY_DRAWDOWN",
            ("PASS" if drawdown <= maximum_drawdown_pct else "FAIL")
            if sample_complete
            else "UNKNOWN",
            observed=decimal_text(drawdown),
            threshold=f"<={decimal_text(maximum_drawdown_pct)}",
            reason=None if sample_complete else "PRIMARY_HOLDOUT_SAMPLE_INCOMPLETE",
        )
    )
    if beta.get("status") != "MEASURED" or not sample_complete:
        decisions.append(
            _decision(
                "BTC_DAILY_BETA",
                "UNKNOWN",
                observed=beta.get("status"),
                threshold=f"abs<={decimal_text(maximum_abs_beta)}",
                reason=(
                    "PRIMARY_HOLDOUT_SAMPLE_INCOMPLETE"
                    if not sample_complete
                    else "BTC_BETA_NOT_MEASURED"
                ),
            )
        )
    else:
        beta_value = decimal_value(beta.get("beta"), field="BTC beta")
        decisions.append(
            _decision(
                "BTC_DAILY_BETA",
                "PASS" if abs(beta_value) <= maximum_abs_beta else "FAIL",
                observed=decimal_text(beta_value),
                threshold=f"abs<={decimal_text(maximum_abs_beta)}",
            )
        )
    capacity_raw = holdout_summary.get("minimumCapacityProxyUsd")
    if capacity_raw is None or not sample_complete:
        decisions.append(
            _decision(
                "PUBLIC_VOLUME_CAPACITY_PROXY",
                "UNKNOWN",
                observed=capacity_raw,
                threshold=f">={decimal_text(minimum_capacity)}",
                reason=(
                    "PRIMARY_HOLDOUT_SAMPLE_INCOMPLETE"
                    if not sample_complete
                    else "PUBLIC_VOLUME_CAPACITY_PROXY_UNAVAILABLE"
                ),
            )
        )
    else:
        capacity = decimal_value(capacity_raw, field="minimum capacity proxy")
        capacity_pass = (
            capacity >= minimum_capacity
            and holdout_summary.get("allActualLegsFitVolumeProxy") is True
        )
        decisions.append(
            _decision(
                "PUBLIC_VOLUME_CAPACITY_PROXY",
                "PASS" if capacity_pass else "FAIL",
                observed={
                    "minimumPortfolioProxyUsd": money_text(capacity),
                    "allActualLegsFit": holdout_summary.get("allActualLegsFitVolumeProxy"),
                },
                threshold=f">={decimal_text(minimum_capacity)}_AND_ALL_LEGS_FIT",
            )
        )
    return decisions


def run_experiment(state_root: Path) -> dict[str, Any]:
    if RESULT_PATH.exists():
        raise EvidenceError("terminal result already exists")
    if (state_root / RESULT_RECEIPT_NAME).exists():
        raise EvidenceError("staged terminal result exists; run report to finalize it")
    run_marker_path = state_root / RUN_MARKER_NAME
    if run_marker_path.exists():
        raise EvidenceError("sealed experiment run was already consumed")
    for lifecycle_name in (CANDIDATE_SEAL_NAME, HOLDOUT_OPEN_NAME):
        if (state_root / lifecycle_name).exists():
            raise EvidenceError(
                f"orphaned lifecycle evidence blocks run admission: {lifecycle_name}"
            )
    protocol, protocol_sha = load_protocol()
    freeze_payload, freeze_sha = load_freeze()
    acquisition, acquisition_sha = load_acquisition(state_root)
    try:
        preflight_acquisition(acquisition, freeze_payload, state_root)
    except EvidenceError as exc:
        return _terminal_result(
            state_root=state_root,
            acquisition_sha=acquisition_sha,
            reason=str(exc),
            state="TERMINAL_UNMEASURED_ACQUISITION_PREFLIGHT",
        )
    evaluator_sha = _assert_frozen_packet(
        freeze_payload,
        expected_freeze_sha=freeze_sha,
    )
    marker = {
        "schema": "S1IRunMarkerV1",
        "createdAtUtc": now_utc(),
        "protocolSha256": protocol_sha,
        "freezeSha256": freeze_sha,
        "acquisitionManifestSha256": acquisition_sha,
        "evaluatorSha256": evaluator_sha,
        "runOrdinal": 1,
        "secondRunAllowed": False,
    }
    exclusive_write(run_marker_path, canonical_bytes(marker))
    try:
        symbols = tuple(
            require_text(item["symbol"], field="freeze symbol")
            for item in cast(Sequence[Mapping[str, Any]], freeze_payload["selectedCohort"])
        )
        calendar = cast(Mapping[str, Any], protocol["calendar"])
        development = cast(Mapping[str, Any], calendar["development"])
        holdout = cast(Mapping[str, Any], calendar["holdout"])
        development_start = parse_utc(development["startInclusive"], field="development start")
        development_end = parse_utc(development["endExclusive"], field="development end")
        holdout_start = parse_utc(holdout["startInclusive"], field="holdout start")
        holdout_end = parse_utc(holdout["endExclusive"], field="holdout end")
        entry_hours = tuple(
            require_int(item, field="entry hour")
            for item in cast(Sequence[object], calendar["entryHoursUtc"])
        )
        universe = cast(Mapping[str, Any], protocol["universe"])
        minimum_eligible = require_int(
            universe["minimumEntryEligible"], field="minimumEntryEligible", minimum=2
        )
        funding_protocol = cast(Mapping[str, Any], protocol["funding"])
        residualization_training_days = require_int(
            funding_protocol["residualizationTrainingDays"],
            field="residualization training days",
            minimum=1,
        )
        residualization_minimum_pairs = require_int(
            funding_protocol["minimumPriorTrainingPairs"],
            field="minimum prior residualization training pairs",
            minimum=2,
        )
        costs = cast(Mapping[str, Any], protocol["costs"])
        fee_rate = decimal_value(
            costs["officialIllustrativeTakerFeeBpsPerFill"],
            field="fee bps",
        ) / Decimal("10000")
        adverse_rates = tuple(
            decimal_value(costs[field], field=field) / Decimal("10000")
            for field in (
                "baseAdverseExecutionBpsPerFill",
                "stressAdverseExecutionBpsPerFill",
                "severeAdverseExecutionBpsPerFill",
            )
        )
        if len(adverse_rates) != 3:
            raise EvidenceError("cost scenario cardinality mismatch")
        family = trials(protocol)
        primary_id = require_text(
            cast(Mapping[str, Any], protocol["trials"])["primary"],
            field="primary trial",
        )
        if primary_id not in {trial.trial_id for trial in family}:
            raise EvidenceError("primary trial absent from family")
        development_bundle = load_bundle(
            acquisition,
            symbols=symbols,
            kline_months=month_range("2025-06", "2026-03"),
            funding_months=month_range("2025-06", "2026-03"),
        )
        development_runs = {
            trial.trial_id: evaluate_trial(
                development_bundle,
                symbols=symbols,
                trial=trial,
                start_ms=development_start,
                end_ms=development_end,
                entry_hours=entry_hours,
                minimum_eligible=minimum_eligible,
                fee_rate=fee_rate,
                adverse_rates=adverse_rates,
                residualization_training_days=residualization_training_days,
                residualization_minimum_pairs=residualization_minimum_pairs,
            )
            for trial in family
        }
        primary_development = development_runs[primary_id]
        primary_development_summary = trial_summary(primary_development)
        statistics_protocol = cast(Mapping[str, Any], protocol["statistics"])
        bootstrap = cast(Mapping[str, Any], statistics_protocol["bootstrap"])
        replicates = require_int(bootstrap["replicates"], field="bootstrap replicates", minimum=100)
        block_length = require_int(bootstrap["blockLengthDays"], field="block length", minimum=1)
        seed = require_int(bootstrap["seed"], field="bootstrap seed", minimum=1)
        multiplicity = development_multiplicity(
            development_runs,
            start_ms=development_start,
            end_ms=development_end,
            primary_id=primary_id,
            replicates=replicates,
            block_length=block_length,
            seed=seed,
        )
        pbo_protocol = cast(Mapping[str, Any], statistics_protocol["pbo"])
        pbo = pbo_cscv(
            development_runs,
            start_ms=development_start,
            end_ms=development_end,
            core_days=require_int(
                pbo_protocol["developmentCoreDays"], field="PBO core days", minimum=12
            ),
            blocks=require_int(pbo_protocol["blocks"], field="PBO blocks", minimum=2),
        )
        walk = walk_forward(
            development_runs,
            start_ms=development_start,
            end_ms=development_end,
            test_months=tuple(
                require_text(item, field="walk-forward month")
                for item in cast(Sequence[object], calendar["walkForwardTestMonths"])
            ),
            primary_id=primary_id,
        )
        gates = cast(Mapping[str, Any], protocol["gates"])
        preholdout = _preholdout_decisions(
            primary_summary=primary_development_summary,
            multiplicity=multiplicity,
            walk=walk,
            minimum_development=require_int(
                gates["minimumPrimaryDevelopmentCohorts"],
                field="minimum development cohorts",
            ),
            maximum_funding_correlation=decimal_value(
                gates["maximumMeanAbsoluteOutOfSampleSignalFundingCorrelation"],
                field="maximum mean absolute out-of-sample signal-funding correlation",
            ),
            maximum_selected_funding_exposure=decimal_value(
                gates["maximumMeanAbsoluteSelectedPortfolioFundingExposure8h"],
                field="maximum mean absolute selected portfolio funding exposure",
            ),
        )
        development_status = _aggregate_decision_status(preholdout)
        development_passed = development_status == "PASS"
        evaluator_sha = _assert_frozen_packet(
            freeze_payload,
            expected_freeze_sha=freeze_sha,
        )
        candidate_seal = {
            "schema": "S1ICandidateSealV1",
            "createdAtUtc": now_utc(),
            "primaryTrialId": primary_id,
            "primaryWasPredeclared": True,
            "developmentGateStatus": development_status,
            "developmentPassed": development_passed,
            "developmentSummarySha256": sha256_bytes(canonical_bytes(primary_development_summary)),
            "multiplicitySha256": sha256_bytes(canonical_bytes(multiplicity)),
            "pboSha256": sha256_bytes(canonical_bytes(pbo)),
            "walkForwardSha256": sha256_bytes(canonical_bytes(walk)),
            "evaluatorSha256": evaluator_sha,
            "holdoutOpenedAtSeal": False,
            "decisions": preholdout,
        }
        exclusive_write(state_root / CANDIDATE_SEAL_NAME, canonical_bytes(candidate_seal))
        if not development_passed:
            development_measured = development_status == "FAIL"
            result: dict[str, Any] = {
                "schema": "S1IPremiumDislocationResultV1",
                "completedAtUtc": now_utc(),
                "state": (
                    "TERMINAL_MEASURED_DEVELOPMENT_NO_GO_HOLDOUT_SEALED"
                    if development_measured
                    else "TERMINAL_UNMEASURED_DEVELOPMENT_HOLDOUT_SEALED"
                ),
                "measurementVerdict": "NO_GO" if development_measured else "UNMEASURED",
                "capitalVerdict": "NO_GO",
                "crediblePositiveCount": 0,
                "executionAuthority": "NONE",
                "consumer": "N3",
                "bindings": {
                    "protocolSha256": protocol_sha,
                    "freezeSha256": freeze_sha,
                    "acquisitionManifestSha256": acquisition_sha,
                    "runMarkerSha256": sha256_path(run_marker_path),
                    "candidateSealSha256": sha256_path(state_root / CANDIDATE_SEAL_NAME),
                    "holdoutOpenSha256": None,
                    "evaluatorSha256": evaluator_sha,
                },
                "lifecycle": {
                    "developmentGateStatus": development_status,
                    "developmentPassed": False,
                    "holdoutOpened": False,
                    "holdoutCannotRescueDevelopment": True,
                    "postRunRepairAllowed": False,
                },
                "development": {
                    "status": "MEASURED" if development_measured else "UNMEASURED",
                    "primary": primary_development_summary,
                    "multiplicity": multiplicity,
                    "pbo": pbo,
                    "walkForward": walk,
                },
                "holdout": {
                    "status": "SEALED_UNOPENED",
                    "reason": (
                        "PREDECLARED_DEVELOPMENT_GATES_FAILED"
                        if development_measured
                        else "PREDECLARED_DEVELOPMENT_GATES_UNKNOWN"
                    ),
                },
                "gates": {
                    "measurementComplete": development_measured,
                    "developmentGateStatus": development_status,
                    "decisions": preholdout,
                },
                "limitations": [
                    "ACCOUNT_EFFECTIVE_COMMISSION_UNKNOWN_PUBLIC_ONLY",
                    "HISTORICAL_BOOK_DEPTH_SPREAD_QUEUE_AND_REALIZED_IMPACT_UNAVAILABLE",
                    "EXECUTABLE_CAPACITY_UNKNOWN_VOLUME_PROXY_ONLY",
                    "PREMIUM_SHOCKS_ARE_OBSERVATIONAL_AND_ENDOGENOUS_CAUSAL_TIMING_IS_NOT_STRUCTURAL_CAUSALITY",
                    "HOLDOUT_REMAINS_UNTOUCHED_AND_CANNOT_RESCUE_FAILED_DEVELOPMENT",
                ],
            }
            _write_result(state_root, result)
            return result
        evaluator_sha = _assert_frozen_packet(
            freeze_payload,
            expected_freeze_sha=freeze_sha,
        )
        holdout_marker = {
            "schema": "S1IHoldoutOpenV1",
            "createdAtUtc": now_utc(),
            "candidateSealSha256": sha256_path(state_root / CANDIDATE_SEAL_NAME),
            "primaryTrialId": primary_id,
            "evaluatorSha256": evaluator_sha,
            "openOrdinal": 1,
            "secondOpenAllowed": False,
        }
        exclusive_write(state_root / HOLDOUT_OPEN_NAME, canonical_bytes(holdout_marker))
        holdout_bundle = load_bundle(
            acquisition,
            symbols=symbols,
            kline_months=month_range("2026-03", "2026-06"),
            funding_months=month_range("2026-03", "2026-06"),
        )
        primary_trial = next(trial for trial in family if trial.trial_id == primary_id)
        holdout_run = evaluate_trial(
            holdout_bundle,
            symbols=symbols,
            trial=primary_trial,
            start_ms=holdout_start,
            end_ms=holdout_end,
            entry_hours=entry_hours,
            minimum_eligible=minimum_eligible,
            fee_rate=fee_rate,
            adverse_rates=adverse_rates,
            residualization_training_days=residualization_training_days,
            residualization_minimum_pairs=residualization_minimum_pairs,
        )
        holdout_summary = trial_summary(holdout_run)
        interval: dict[str, object]
        beta: dict[str, object]
        if holdout_run.invalid:
            interval = {
                "status": "UNKNOWN",
                "reason": "PRIMARY_HOLDOUT_COHORTS_INCOMPLETE",
            }
            beta = {
                "status": "UNKNOWN",
                "reason": "PRIMARY_HOLDOUT_COHORTS_INCOMPLETE",
            }
        else:
            _, holdout_base_daily = daily_pnl(
                holdout_run,
                scenario="base",
                start_ms=holdout_start,
                end_ms=holdout_end,
            )
            interval = bootstrap_interval(
                holdout_base_daily,
                replicates=replicates,
                block_length=block_length,
                seed=seed + 1,
            )
            beta = btc_daily_beta(
                holdout_bundle,
                holdout_run,
                start_ms=holdout_start,
                end_ms=holdout_end,
            )
        final_decisions = _final_decisions(
            holdout_summary=holdout_summary,
            interval=interval,
            beta=beta,
            minimum_holdout=require_int(
                gates["minimumPrimaryHoldoutCohorts"],
                field="minimum holdout cohorts",
            ),
            minimum_distinct=require_int(
                gates["minimumDistinctSymbolsPerSideAcrossHoldout"],
                field="minimum distinct symbols",
            ),
            maximum_drawdown_pct=decimal_value(
                gates["maximumExitBoundaryDrawdownPct"],
                field="maximum drawdown",
            ),
            maximum_abs_beta=decimal_value(
                gates["maximumAbsoluteBtcDailyBeta"], field="maximum beta"
            ),
            minimum_capacity=decimal_value(
                cast(Mapping[str, Any], protocol["capacity"])["minimumPortfolioProxyUsd"],
                field="minimum capacity",
            ),
            maximum_funding_correlation=decimal_value(
                gates["maximumMeanAbsoluteOutOfSampleSignalFundingCorrelation"],
                field="maximum mean absolute out-of-sample signal-funding correlation",
            ),
            maximum_selected_funding_exposure=decimal_value(
                gates["maximumMeanAbsoluteSelectedPortfolioFundingExposure8h"],
                field="maximum mean absolute selected portfolio funding exposure",
            ),
        )
        public_gate_status = _aggregate_decision_status(final_decisions)
        all_public_gates_pass = public_gate_status == "PASS"
        measurement_complete = public_gate_status != "UNKNOWN"
        measurement_verdict = "NO_GO" if public_gate_status == "FAIL" else "UNMEASURED"
        evaluator_sha = _assert_frozen_packet(
            freeze_payload,
            expected_freeze_sha=freeze_sha,
        )
        result = {
            "schema": "S1IPremiumDislocationResultV1",
            "completedAtUtc": now_utc(),
            "state": (
                "TERMINAL_PUBLIC_SCENARIO_POSITIVE_REAL_COSTS_UNMEASURED"
                if public_gate_status == "PASS"
                else "TERMINAL_MEASURED_NO_GO"
                if public_gate_status == "FAIL"
                else "TERMINAL_UNMEASURED_HOLDOUT_EVIDENCE_INCOMPLETE"
            ),
            "measurementVerdict": measurement_verdict,
            "capitalVerdict": "NO_GO",
            "crediblePositiveCount": 0,
            "executionAuthority": "NONE",
            "consumer": "N3",
            "bindings": {
                "protocolSha256": protocol_sha,
                "freezeSha256": freeze_sha,
                "acquisitionManifestSha256": acquisition_sha,
                "runMarkerSha256": sha256_path(run_marker_path),
                "candidateSealSha256": sha256_path(state_root / CANDIDATE_SEAL_NAME),
                "holdoutOpenSha256": sha256_path(state_root / HOLDOUT_OPEN_NAME),
                "evaluatorSha256": evaluator_sha,
            },
            "lifecycle": {
                "developmentGateStatus": "PASS",
                "developmentPassed": True,
                "holdoutOpened": True,
                "holdoutOpenCount": 1,
                "postRunRepairAllowed": False,
            },
            "development": {
                "status": "MEASURED",
                "primary": primary_development_summary,
                "multiplicity": multiplicity,
                "pbo": pbo,
                "walkForward": walk,
            },
            "holdout": {
                "status": ("MEASURED_PUBLIC_SCENARIO" if measurement_complete else "UNMEASURED"),
                "primary": holdout_summary,
                "baseNetBootstrap95Pct": interval,
                "btcDailyBeta": beta,
            },
            "gates": {
                "measurementComplete": measurement_complete,
                "developmentDecisions": preholdout,
                "holdoutDecisions": final_decisions,
                "publicScenarioGateStatus": public_gate_status,
                "allPublicScenarioGatesPass": all_public_gates_pass,
                "accountEffectiveCostGate": "UNKNOWN",
                "executableCapacityGate": "UNKNOWN",
            },
            "limitations": [
                "ACCOUNT_EFFECTIVE_COMMISSION_UNKNOWN_PUBLIC_ONLY",
                "OFFICIAL_5_BP_TAKER_VALUE_IS_ILLUSTRATIVE_NOT_REALIZED_ACCOUNT_TRUTH",
                "FIXED_ADVERSE_EXECUTION_BPS_ARE_SCENARIOS_NOT_OBSERVED_SPREAD_OR_SLIPPAGE",
                "HISTORICAL_BOOK_DEPTH_QUEUE_REALIZED_IMPACT_MARGIN_AND_FILTERS_UNAVAILABLE",
                "PUBLIC_QUOTE_VOLUME_CAPACITY_PROXY_IS_NOT_EXECUTABLE_CAPACITY",
                "EXIT_BOUNDARY_DRAWDOWN_OMITS_INTRAHOUR_LIQUIDATION_PATH",
                "USDT_IS_TREATED_AS_USD_ONE_TO_ONE",
                "PREMIUM_SHOCKS_ARE_OBSERVATIONAL_AND_ENDOGENOUS_CAUSAL_TIMING_IS_NOT_STRUCTURAL_CAUSALITY",
            ],
        }
        _write_result(state_root, result)
        return result
    except ResultSealError:
        raise
    except (
        EvidenceError,
        OSError,
        KeyError,
        TypeError,
        ValueError,
        ArithmeticError,
    ) as exc:
        return _terminal_result(
            state_root=state_root,
            acquisition_sha=acquisition_sha,
            reason=str(exc),
            state="TERMINAL_UNMEASURED_SEALED_RUN_FAILURE",
        )


def report(state_root: Path) -> dict[str, object]:
    receipt, receipt_raw = load_json(state_root / RESULT_RECEIPT_NAME)
    if receipt.get("schema") != "S1IResultReceiptV1":
        raise EvidenceError("result receipt schema mismatch")
    embedded_value = receipt.get("result")
    if not isinstance(embedded_value, dict):
        raise EvidenceError("result receipt lacks the staged result object")
    embedded_result = cast(dict[str, Any], embedded_value)
    if embedded_result.get("schema") != "S1IPremiumDislocationResultV1":
        raise EvidenceError("staged result schema mismatch")
    embedded_raw = canonical_bytes(embedded_result)
    result_sha = sha256_bytes(embedded_raw)
    freeze_payload, freeze_raw = load_json(FREEZE_PATH)
    if freeze_payload.get("schema") != "S1IPremiumDislocationFreezeV1":
        raise EvidenceError("freeze schema mismatch during report")
    freeze_sha = sha256_bytes(freeze_raw)
    freeze_bindings = cast(Mapping[str, Any], freeze_payload["bindings"])
    frozen_protocol_sha = require_text(
        freeze_bindings["protocolSha256"], field="frozen protocol sha"
    )
    frozen_evaluator_sha = require_text(
        freeze_bindings["evaluatorSha256"], field="frozen evaluator sha"
    )
    lifecycle = cast(Mapping[str, Any], embedded_result["lifecycle"])
    declared_evaluator_drift = lifecycle.get("evaluatorDriftDetected") is True
    current_evaluator_matches = script_sha() == frozen_evaluator_sha
    bindings = cast(Mapping[str, Any], embedded_result["bindings"])
    checks: dict[str, bool] = {
        "resultReceipt": receipt.get("resultSha256") == result_sha
        and receipt.get("resultState") == embedded_result.get("state"),
        "receiptProtocol": receipt.get("protocolSha256") == frozen_protocol_sha,
        "receiptEvaluator": receipt.get("evaluatorSha256") == frozen_evaluator_sha,
        "receiptFreeze": receipt.get("freezeSha256") == freeze_sha,
        "freezeProtocolCurrent": frozen_protocol_sha == sha256_path(PROTOCOL_PATH),
        "freezeOfficialSourcesCurrent": freeze_bindings.get("officialSourceResearchSha256")
        == sha256_path(OFFICIAL_SOURCES_PATH),
        "protocol": bindings.get("protocolSha256") == sha256_path(PROTOCOL_PATH),
        "evaluator": bindings.get("evaluatorSha256") == frozen_evaluator_sha,
        "evaluatorDisposition": current_evaluator_matches
        or (declared_evaluator_drift and embedded_result.get("measurementVerdict") == "UNMEASURED"),
        "freeze": bindings.get("freezeSha256") == freeze_sha,
        "acquisition": bindings.get("acquisitionManifestSha256")
        == sha256_path(state_root / ACQUISITION_NAME),
        "runMarker": bindings.get("runMarkerSha256") == _binding(state_root / RUN_MARKER_NAME),
        "candidateSeal": bindings.get("candidateSealSha256")
        == _binding(state_root / CANDIDATE_SEAL_NAME),
        "holdoutOpen": bindings.get("holdoutOpenSha256")
        == _binding(state_root / HOLDOUT_OPEN_NAME),
    }
    if not all(checks.values()):
        raise EvidenceError(f"result evidence authentication failed: {checks}")
    _seal_exact(RESULT_PATH, embedded_raw)
    result, result_raw = load_json(RESULT_PATH)
    if result != embedded_result or result_raw != embedded_raw:
        raise EvidenceError("result file does not match authenticated staged result")
    return {
        "schema": result["schema"],
        "state": result["state"],
        "measurementVerdict": result["measurementVerdict"],
        "capitalVerdict": result["capitalVerdict"],
        "crediblePositiveCount": result["crediblePositiveCount"],
        "executionAuthority": result["executionAuthority"],
        "resultSha256": result_sha,
        "resultReceiptSha256": sha256_bytes(receipt_raw),
        "currentEvaluatorMatchesFreeze": current_evaluator_matches,
        "checks": checks,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="S-1I sealed public USD-M premium-dislocation experiment"
    )
    parser.add_argument(
        "--state-root",
        type=Path,
        default=DEFAULT_STATE_ROOT,
        help="external evidence and archive root",
    )
    commands = parser.add_subparsers(dest="command", required=True)
    screen_parser = commands.add_parser(
        "screen", help="causally screen only June 2025 regular klines"
    )
    screen_parser.add_argument("--workers", type=int, default=16)
    commands.add_parser("freeze", help="freeze protocol, evaluator, and cohort")
    acquire_parser = commands.add_parser(
        "acquire", help="checksum-verify outcome ZIPs without opening them"
    )
    acquire_parser.add_argument("--workers", type=int, default=16)
    commands.add_parser("run", help="consume the sole sealed experiment run")
    commands.add_parser("report", help="authenticate the terminal result")
    return parser


def _summary(command: str, payload: Mapping[str, Any]) -> dict[str, object]:
    if command == "screen":
        return {
            "command": command,
            "selected": len(cast(Sequence[object], payload["selected"])),
            "validFullMonthCount": payload["validFullMonthCount"],
        }
    if command == "freeze":
        return {
            "command": command,
            "selected": len(cast(Sequence[object], payload["selectedCohort"])),
            "primaryTrialId": payload["primaryTrialId"],
        }
    if command == "acquire":
        return {
            "command": command,
            "artifactCount": payload["artifactCount"],
            "verifiedCount": payload["verifiedCount"],
            "missingCount": payload["missingCount"],
        }
    return {"command": command, **payload}


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    arguments = parser.parse_args(argv)
    state_root = cast(Path, arguments.state_root).resolve()
    if cast(str, arguments.command) == "screen":
        workers = require_int(arguments.workers, field="workers", minimum=1)
        payload = screen(state_root, workers)
    elif arguments.command == "freeze":
        payload = freeze(state_root)
    elif arguments.command == "acquire":
        workers = require_int(arguments.workers, field="workers", minimum=1)
        payload = acquire(state_root, workers)
    elif arguments.command == "run":
        payload = run_experiment(state_root)
    elif arguments.command == "report":
        payload = report(state_root)
    else:
        raise EvidenceError("unknown command")
    print(canonical_bytes(_summary(arguments.command, payload)).decode(), end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
