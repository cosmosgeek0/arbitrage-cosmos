"""Sealed S-1L Binance USD-M quarterly/perpetual calendar-basis experiment.

Only ``discover`` and ``acquire`` use the network. ``discover`` reads official
S3 listing metadata without downloading archive bodies. ``freeze`` binds the
complete source plan and evaluator before ``acquire`` downloads checksum-bound
ZIP bytes without decompression. ``run`` consumes one marker, opens development,
seals one champion, consumes the holdout grant, and writes one terminal result.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import csv
import hashlib
import http.client
import io
import itertools
import json
import math
import os
import random
import re
import statistics
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal, InvalidOperation, getcontext
from pathlib import Path
from typing import Any, Final, cast
from xml.etree import ElementTree

getcontext().prec = 50

D = Decimal
HERE: Final = Path(__file__).resolve().parent
PROTOCOL_PATH: Final = HERE / "protocol.v1.json"
PLAN_PATH: Final = HERE / "source_plan.v1.json"
FREEZE_PATH: Final = HERE / "freeze.v1.json"
RUN_MARKER_PATH: Final = HERE / "run-marker.v1.json"
CANDIDATE_PATH: Final = HERE / "candidate-seal.v1.json"
HOLDOUT_MARKER_PATH: Final = HERE / "holdout-open.v1.json"
RESULT_PATH: Final = HERE / "result.v1.json"
CHECKSUMS_PATH: Final = HERE / "SHA256SUMS"
DEFAULT_STATE_ROOT: Final = Path("/private/tmp/cosmos-s1l-usdm-calendar-basis-v1")
S3_ENDPOINT: Final = "https://s3-ap-northeast-1.amazonaws.com/data.binance.vision"
USER_AGENT: Final = "cosmos-s1l-public-research/1.0"
HOUR_MS: Final = 3_600_000
DAY_MS: Final = 86_400_000
MAX_ZIP_BYTES: Final = 2_000_000
MAX_MEMBER_BYTES: Final = 16_000_000
MAX_COMPRESSION_RATIO: Final = 100
MAX_CSV_ROWS: Final = 100_000
SHA256_RE: Final = re.compile(r"^[0-9a-f]{64}$")
CHECKSUM_RE: Final = re.compile(r"^([0-9a-fA-F]{64})\s+\*?([^\s]+)$")
KLINE_COLUMNS: Final = (
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


class EvidenceError(RuntimeError):
    """A fail-closed source, protocol, lifecycle, or measurement error."""


@dataclass(frozen=True, slots=True)
class Bar:
    timestamp_ms: int
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    volume: Decimal
    quote_volume: Decimal
    count: int


@dataclass(frozen=True, slots=True)
class FundingEvent:
    timestamp_ms: int
    interval_hours: int
    rate: Decimal


@dataclass(frozen=True, slots=True)
class DepthPoint:
    timestamp_ms: int
    percentage: Decimal
    depth: Decimal
    notional: Decimal


@dataclass(frozen=True, slots=True)
class TrialSpec:
    trial_id: str
    entry_dte: int
    exit_dte: int

    def as_mapping(self) -> dict[str, object]:
        return {
            "trialId": self.trial_id,
            "entryDaysToDelivery": self.entry_dte,
            "exitDaysToDelivery": self.exit_dte,
        }


@dataclass(frozen=True, slots=True)
class Scenario:
    name: str
    fee_bps: Decimal
    adverse_bps: Decimal


@dataclass(slots=True)
class Decomposition:
    reference_gross: Decimal = field(default_factory=Decimal)
    funding: Decimal = field(default_factory=Decimal)
    adverse: Decimal = field(default_factory=Decimal)
    fees: Decimal = field(default_factory=Decimal)
    net: Decimal = field(default_factory=Decimal)

    def add(self, other: Decomposition) -> None:
        self.reference_gross += other.reference_gross
        self.funding += other.funding
        self.adverse += other.adverse
        self.fees += other.fees
        self.net += other.net

    def accounted_net(self) -> Decimal:
        return self.reference_gross + self.funding - self.adverse - self.fees

    def residual(self) -> Decimal:
        return self.accounted_net() - self.net

    def as_mapping(self) -> dict[str, str]:
        return {
            "referenceGrossPricePnlUsd": decimal_text(self.reference_gross),
            "perpetualFundingUsd": decimal_text(self.funding),
            "adverseExecutionUsd": decimal_text(self.adverse),
            "takerFeeProxyUsd": decimal_text(self.fees),
            "netUsd": decimal_text(self.net),
            "identityResidualUsd": decimal_text(self.residual()),
        }


@dataclass(frozen=True, slots=True)
class UnderlyingResult:
    pair: str
    dated_symbol: str
    side_dated: int
    entry_ms: int
    exit_ms: int
    decomposition: Decomposition
    path: tuple[tuple[int, Decimal], ...]
    public_20bps_capacity_scale: Decimal | None
    fills: int
    funding_events: int


@dataclass(frozen=True, slots=True)
class ClusterResult:
    delivery: str
    decomposition: Decomposition
    path: tuple[tuple[int, Decimal], ...]
    public_20bps_gross_capacity_usd: Decimal | None
    fills: int
    funding_events: int
    sides: tuple[tuple[str, int], ...]


@dataclass(frozen=True, slots=True)
class TrialResult:
    spec: TrialSpec
    scenario: Scenario
    clusters: tuple[ClusterResult, ...]
    decomposition: Decomposition
    net_usd_per_1000: Decimal
    maximum_drawdown_usd: Decimal
    maximum_drawdown_pct: Decimal
    minimum_capacity_usd: Decimal | None
    median_capacity_usd: Decimal | None
    fills: int
    funding_events: int

    def as_summary(self) -> dict[str, object]:
        return {
            "trial": self.spec.as_mapping(),
            "scenario": self.scenario.name,
            "clusterCount": len(self.clusters),
            "netUsdPer1000Gross": decimal_text(self.net_usd_per_1000),
            "maximumDrawdownUsd": decimal_text(self.maximum_drawdown_usd),
            "maximumDrawdownPct": decimal_text(self.maximum_drawdown_pct),
            "minimumPublic20BpsGrossCapacityUsd": optional_decimal_text(self.minimum_capacity_usd),
            "medianPublic20BpsGrossCapacityUsd": optional_decimal_text(self.median_capacity_usd),
            "fills": self.fills,
            "fundingEvents": self.funding_events,
            "decomposition": self.decomposition.as_mapping(),
        }


@dataclass(slots=True)
class DataStore:
    klines: dict[str, dict[int, Bar]] = field(default_factory=dict)
    marks: dict[str, dict[int, Bar]] = field(default_factory=dict)
    funding: dict[str, list[FundingEvent]] = field(default_factory=dict)
    depth: dict[str, dict[date, list[DepthPoint]]] = field(default_factory=dict)


def canonical_bytes(value: object) -> bytes:
    return (
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n"
    ).encode("utf-8")


def sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def safe_file(path: Path) -> Path:
    if path.is_symlink():
        raise EvidenceError(f"symlink refused: {path}")
    if not path.is_file():
        raise EvidenceError(f"required regular file missing: {path}")
    return path


def sha256_path(path: Path) -> str:
    return sha256_bytes(safe_file(path).read_bytes())


def load_json(path: Path) -> tuple[dict[str, Any], bytes]:
    raw = safe_file(path).read_bytes()
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as error:
        raise EvidenceError(f"invalid JSON: {path}") from error
    if not isinstance(value, dict):
        raise EvidenceError(f"JSON root must be an object: {path}")
    return cast(dict[str, Any], value), raw


def nested(mapping: Mapping[str, Any], *keys: str) -> Any:
    value: Any = mapping
    for key in keys:
        if not isinstance(value, dict) or key not in value:
            raise EvidenceError(f"required field missing: {'.'.join(keys)}")
        value = value[key]
    return value


def require_text(value: object, *, field_name: str) -> str:
    if not isinstance(value, str) or not value:
        raise EvidenceError(f"{field_name} must be nonempty text")
    return value


def require_int(value: object, *, field_name: str, minimum: int = 0) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise EvidenceError(f"{field_name} must be an integer >= {minimum}")
    return value


def require_list(value: object, *, field_name: str) -> list[Any]:
    if not isinstance(value, list):
        raise EvidenceError(f"{field_name} must be a list")
    return value


def decimal_value(value: object, *, field_name: str, minimum: Decimal | None = None) -> Decimal:
    if isinstance(value, bool) or not isinstance(value, (str, int)):
        raise EvidenceError(f"{field_name} must be an exact decimal string or integer")
    try:
        parsed = D(str(value))
    except InvalidOperation as error:
        raise EvidenceError(f"{field_name} is not a decimal") from error
    if not parsed.is_finite() or (minimum is not None and parsed < minimum):
        raise EvidenceError(f"{field_name} is outside its allowed range")
    return parsed


def decimal_text(value: Decimal) -> str:
    if not value.is_finite():
        raise EvidenceError("non-finite decimal cannot be serialized")
    if value == 0:
        return "0"
    return format(value.normalize(), "f")


def optional_decimal_text(value: Decimal | None) -> str | None:
    return None if value is None else decimal_text(value)


def parse_iso_z(value: object, *, field_name: str) -> datetime:
    text = require_text(value, field_name=field_name)
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as error:
        raise EvidenceError(f"{field_name} must be ISO-8601 UTC") from error
    if parsed.tzinfo != UTC:
        raise EvidenceError(f"{field_name} must use UTC")
    return parsed


def timestamp_ms(value: datetime) -> int:
    if value.tzinfo != UTC:
        raise EvidenceError("timestamp must be UTC")
    return int(value.timestamp() * 1000)


def datetime_from_ms(value: int) -> datetime:
    return datetime.fromtimestamp(value / 1000, UTC)


def month_strings(first: date, last: date) -> tuple[str, ...]:
    if first > last:
        raise EvidenceError("month range is inverted")
    year = first.year
    month = first.month
    end = (last.year, last.month)
    values: list[str] = []
    while (year, month) <= end:
        values.append(f"{year:04d}-{month:02d}")
        if month == 12:
            year += 1
            month = 1
        else:
            month += 1
    return tuple(values)


def fsync_directory(path: Path) -> None:
    if path.is_symlink() or not path.is_dir():
        raise EvidenceError(f"directory durability target invalid: {path}")
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def exclusive_write(path: Path, raw: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.{time.time_ns()}.no-clobber")
    try:
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        try:
            os.link(temporary, path)
        except FileExistsError as error:
            raise EvidenceError(f"exclusive output already exists: {path}") from error
        fsync_directory(path.parent)
        temporary.unlink()
        fsync_directory(path.parent)
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise


def write_once_or_equal(path: Path, raw: bytes) -> None:
    if path.exists():
        if safe_file(path).read_bytes() != raw:
            raise EvidenceError(f"existing artifact differs: {path}")
        return
    exclusive_write(path, raw)


def protocol_trials(protocol: Mapping[str, Any]) -> tuple[TrialSpec, ...]:
    entry_values = [
        require_int(value, field_name="trials.entryDaysToDelivery", minimum=1)
        for value in require_list(
            nested(protocol, "trials", "entryDaysToDelivery"),
            field_name="trials.entryDaysToDelivery",
        )
    ]
    exit_values = [
        require_int(value, field_name="trials.exitDaysToDelivery", minimum=1)
        for value in require_list(
            nested(protocol, "trials", "exitDaysToDelivery"),
            field_name="trials.exitDaysToDelivery",
        )
    ]
    trials = tuple(
        TrialSpec(
            trial_id=f"E{entry_dte:02d}-X{exit_dte:02d}",
            entry_dte=entry_dte,
            exit_dte=exit_dte,
        )
        for entry_dte in sorted(entry_values)
        for exit_dte in sorted(exit_values)
    )
    expected = require_int(nested(protocol, "trials", "familySize"), field_name="familySize")
    if len(trials) != expected or len(set(trials)) != len(trials):
        raise EvidenceError("trial family does not match frozen familySize")
    if any(trial.entry_dte <= trial.exit_dte for trial in trials):
        raise EvidenceError("every entry DTE must precede exit DTE")
    return trials


def protocol_deliveries(protocol: Mapping[str, Any], partition: str) -> tuple[datetime, ...]:
    key = "developmentDeliveries" if partition == "development" else "holdoutDeliveries"
    values = tuple(
        parse_iso_z(value, field_name=f"calendar.{key}")
        for value in require_list(nested(protocol, "calendar", key), field_name=key)
    )
    if values != tuple(sorted(values)) or len(set(values)) != len(values):
        raise EvidenceError(f"{key} must be sorted and unique")
    for value in values:
        if value.hour != 8 or value.minute != 0 or value.second != 0:
            raise EvidenceError(f"{key} must use 08:00 UTC")
        if value.weekday() != 4:
            raise EvidenceError(f"{key} must contain Friday deliveries")
    return values


def protocol_pairs(protocol: Mapping[str, Any]) -> tuple[str, ...]:
    pairs = tuple(
        require_text(value, field_name="universe.pairs")
        for value in require_list(
            nested(protocol, "universe", "pairs"), field_name="universe.pairs"
        )
    )
    if pairs != tuple(sorted(pairs)) or pairs != ("BTCUSDT", "ETHUSDT"):
        raise EvidenceError("universe must be the frozen sorted BTCUSDT/ETHUSDT pair")
    return pairs


def add_plan_object(
    objects: dict[str, dict[str, object]],
    *,
    zip_key: str,
    partition: str,
    data_type: str,
    symbol: str,
    period: str,
    interval: str | None,
) -> None:
    checksum_key = f"{zip_key}.CHECKSUM"
    prior = objects.get(zip_key)
    role = {
        "partition": partition,
        "dataType": data_type,
        "symbol": symbol,
        "period": period,
        "interval": interval,
    }
    if prior is None:
        objects[zip_key] = {
            "zipKey": zip_key,
            "checksumKey": checksum_key,
            "partition": partition,
            "roles": [role],
        }
        return
    if prior["partition"] != partition:
        raise EvidenceError(f"archive object crosses development/holdout boundary: {zip_key}")
    roles = cast(list[object], prior["roles"])
    if role not in roles:
        roles.append(role)


def build_source_plan(protocol: Mapping[str, Any], protocol_raw: bytes) -> dict[str, object]:
    trials = protocol_trials(protocol)
    pairs = protocol_pairs(protocol)
    max_entry_dte = max(trial.entry_dte for trial in trials)
    objects: dict[str, dict[str, object]] = {}
    deliveries: list[dict[str, object]] = []
    for partition in ("development", "holdout"):
        for delivery in protocol_deliveries(protocol, partition):
            suffix = delivery.strftime("%y%m%d")
            delivery_text = delivery.isoformat().replace("+00:00", "Z")
            deliveries.append({"deliveryUtc": delivery_text, "partition": partition})
            start_day = (delivery - timedelta(days=max_entry_dte)).date()
            for pair in pairs:
                dated_symbol = f"{pair}_{suffix}"
                for month in month_strings(start_day, delivery.date()):
                    add_plan_object(
                        objects,
                        zip_key=(
                            f"data/futures/um/monthly/klines/{dated_symbol}/1h/"
                            f"{dated_symbol}-1h-{month}.zip"
                        ),
                        partition=partition,
                        data_type="KLINE",
                        symbol=dated_symbol,
                        period=month,
                        interval="1h",
                    )
                    add_plan_object(
                        objects,
                        zip_key=(f"data/futures/um/monthly/klines/{pair}/1h/{pair}-1h-{month}.zip"),
                        partition=partition,
                        data_type="KLINE",
                        symbol=pair,
                        period=month,
                        interval="1h",
                    )
                    add_plan_object(
                        objects,
                        zip_key=(
                            f"data/futures/um/monthly/markPriceKlines/{pair}/1h/"
                            f"{pair}-1h-{month}.zip"
                        ),
                        partition=partition,
                        data_type="MARK",
                        symbol=pair,
                        period=month,
                        interval="1h",
                    )
                    add_plan_object(
                        objects,
                        zip_key=(
                            f"data/futures/um/monthly/fundingRate/{pair}/"
                            f"{pair}-fundingRate-{month}.zip"
                        ),
                        partition=partition,
                        data_type="FUNDING",
                        symbol=pair,
                        period=month,
                        interval=None,
                    )
                fill_dates = {
                    (delivery - timedelta(days=trial.entry_dte)).date() for trial in trials
                }
                fill_dates.update(
                    (delivery - timedelta(days=trial.exit_dte)).date() for trial in trials
                )
                for fill_day in sorted(fill_dates):
                    period = fill_day.isoformat()
                    for symbol in (dated_symbol, pair):
                        add_plan_object(
                            objects,
                            zip_key=(
                                f"data/futures/um/daily/bookDepth/{symbol}/"
                                f"{symbol}-bookDepth-{period}.zip"
                            ),
                            partition=partition,
                            data_type="DEPTH",
                            symbol=symbol,
                            period=period,
                            interval=None,
                        )
    ordered_objects: list[dict[str, object]] = []
    for key in sorted(objects):
        item = objects[key]
        roles = cast(list[dict[str, object]], item["roles"])
        item["roles"] = sorted(
            roles,
            key=lambda value: (
                str(value["dataType"]),
                str(value["symbol"]),
                str(value["period"]),
            ),
        )
        ordered_objects.append(item)
    return {
        "schema": "S1LSourcePlanV1",
        "protocolId": require_text(protocol.get("protocolId"), field_name="protocolId"),
        "protocolSha256": sha256_bytes(protocol_raw),
        "listingEndpoint": S3_ENDPOINT,
        "deliveries": deliveries,
        "objectCount": len(ordered_objects),
        "objects": ordered_objects,
    }


def cmd_plan(_: argparse.Namespace) -> None:
    protocol, protocol_raw = load_json(PROTOCOL_PATH)
    plan = build_source_plan(protocol, protocol_raw)
    exclusive_write(PLAN_PATH, canonical_bytes(plan))
    print(
        json.dumps(
            {
                "status": "PLANNED_NO_OUTCOMES_OPENED",
                "objects": plan["objectCount"],
                "path": str(PLAN_PATH),
            },
            sort_keys=True,
        )
    )


def http_bytes(url: str, *, attempts: int = 4) -> tuple[bytes, Mapping[str, str]]:
    last_error: BaseException | None = None
    for attempt in range(attempts):
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                return response.read(), cast(Mapping[str, str], response.headers)
        except (
            TimeoutError,
            OSError,
            http.client.HTTPException,
            urllib.error.URLError,
            urllib.error.HTTPError,
        ) as error:
            last_error = error
            if isinstance(error, urllib.error.HTTPError) and error.code == 404:
                break
            if attempt + 1 < attempts:
                time.sleep(min(2**attempt, 4))
    raise EvidenceError(f"official source request failed: {url}: {last_error}")


def xml_child_text(element: ElementTree.Element, name: str) -> str:
    child = element.find(f"{{*}}{name}")
    if child is None or child.text is None:
        raise EvidenceError(f"S3 listing entry missing {name}")
    return child.text


def list_s3_prefix(prefix: str) -> dict[str, dict[str, object]]:
    token: str | None = None
    found: dict[str, dict[str, object]] = {}
    while True:
        query: dict[str, str] = {"list-type": "2", "prefix": prefix}
        if token is not None:
            query["continuation-token"] = token
        raw, _ = http_bytes(f"{S3_ENDPOINT}?{urllib.parse.urlencode(query)}")
        try:
            root = ElementTree.fromstring(raw)
        except ElementTree.ParseError as error:
            raise EvidenceError(f"invalid S3 listing XML for {prefix}") from error
        for entry in root.findall(".//{*}Contents"):
            key = xml_child_text(entry, "Key")
            etag = xml_child_text(entry, "ETag").strip('"')
            size_text = xml_child_text(entry, "Size")
            try:
                size = int(size_text)
            except ValueError as error:
                raise EvidenceError(f"invalid listing size for {key}") from error
            if key in found:
                raise EvidenceError(f"duplicate listing key: {key}")
            found[key] = {
                "key": key,
                "size": size,
                "etag": etag,
                "lastModified": xml_child_text(entry, "LastModified"),
            }
        truncated = xml_child_text(root, "IsTruncated").lower() == "true"
        if not truncated:
            break
        token_element = root.find("{*}NextContinuationToken")
        if token_element is None or not token_element.text:
            raise EvidenceError(f"truncated S3 listing lacks continuation token: {prefix}")
        token = token_element.text
    return found


def cmd_discover(arguments: argparse.Namespace) -> None:
    plan, plan_raw = load_json(PLAN_PATH)
    objects = require_list(plan.get("objects"), field_name="objects")
    prefixes = sorted(
        {
            f"{require_text(item['zipKey'], field_name='zipKey').rsplit('/', 1)[0]}/"
            for item in objects
            if isinstance(item, dict)
        }
    )
    if len(prefixes) == 0:
        raise EvidenceError("source plan has no prefixes")
    listed: dict[str, dict[str, object]] = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        futures = {executor.submit(list_s3_prefix, prefix): prefix for prefix in prefixes}
        for future in concurrent.futures.as_completed(futures):
            prefix = futures[future]
            for key, metadata in future.result().items():
                if key in listed:
                    raise EvidenceError(f"key appeared in multiple prefix listings: {key}")
                listed[key] = metadata
            print(f"listed {prefix}", file=sys.stderr)
    discovered: list[dict[str, object]] = []
    for raw_item in objects:
        if not isinstance(raw_item, dict):
            raise EvidenceError("source plan object entry must be an object")
        item = cast(dict[str, Any], raw_item)
        zip_key = require_text(item.get("zipKey"), field_name="zipKey")
        checksum_key = require_text(item.get("checksumKey"), field_name="checksumKey")
        if zip_key not in listed or checksum_key not in listed:
            missing = zip_key if zip_key not in listed else checksum_key
            raise EvidenceError(f"planned official archive object missing: {missing}")
        discovered.append(
            {
                "zip": listed[zip_key],
                "checksum": listed[checksum_key],
                "partition": require_text(item.get("partition"), field_name="partition"),
            }
        )
    payload = {
        "schema": "S1LDiscoveryV1",
        "status": "LISTING_METADATA_ONLY_NO_ARCHIVE_BODY_OPENED",
        "discoveredAtUtc": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "sourcePlanSha256": sha256_bytes(plan_raw),
        "prefixCount": len(prefixes),
        "objectCount": len(discovered),
        "objects": discovered,
    }
    state_root = Path(arguments.state_root).resolve()
    state_root.mkdir(parents=True, exist_ok=True)
    discovery_path = state_root / "discovery.v1.json"
    write_once_or_equal(discovery_path, canonical_bytes(payload))
    print(
        json.dumps(
            {
                "status": payload["status"],
                "objects": len(discovered),
                "path": str(discovery_path),
            },
            sort_keys=True,
        )
    )


def tracked_input_paths() -> tuple[Path, ...]:
    return (
        HERE / "__init__.py",
        HERE / "README.md",
        HERE / "OFFICIAL_SOURCE_RESEARCH.md",
        HERE / "METHODOLOGY.md",
        PROTOCOL_PATH,
        PLAN_PATH,
        HERE / "experiment.py",
        HERE / "test_experiment.py",
    )


def current_input_hashes() -> dict[str, str]:
    return {path.name: sha256_path(path) for path in tracked_input_paths()}


def cmd_freeze(arguments: argparse.Namespace) -> None:
    forbidden = (
        RUN_MARKER_PATH,
        CANDIDATE_PATH,
        HOLDOUT_MARKER_PATH,
        RESULT_PATH,
        CHECKSUMS_PATH,
    )
    if any(path.exists() for path in forbidden):
        raise EvidenceError("outcome or run artifact exists before freeze")
    protocol, protocol_raw = load_json(PROTOCOL_PATH)
    plan, plan_raw = load_json(PLAN_PATH)
    expected_plan = build_source_plan(protocol, protocol_raw)
    if canonical_bytes(expected_plan) != plan_raw:
        raise EvidenceError("source plan does not match protocol-derived plan")
    state_root = Path(arguments.state_root).resolve()
    discovery_path = state_root / "discovery.v1.json"
    discovery, discovery_raw = load_json(discovery_path)
    if discovery.get("sourcePlanSha256") != sha256_bytes(plan_raw):
        raise EvidenceError("discovery does not bind the current source plan")
    if discovery.get("objectCount") != plan.get("objectCount"):
        raise EvidenceError("discovery object count does not match plan")
    payload = {
        "schema": "S1LProtocolFreezeV1",
        "status": "FROZEN_BEFORE_ARCHIVE_OUTCOME_BODIES",
        "protocolId": protocol["protocolId"],
        "canonicalBaseCommit": protocol["canonicalBaseCommit"],
        "frozenAtUtc": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "python": {
            "implementation": sys.implementation.name,
            "version": list(sys.version_info[:3]),
            "hashSeedRequiredForRun": "0",
        },
        "inputSha256": current_input_hashes(),
        "sourcePlanSha256": sha256_bytes(plan_raw),
        "discoverySha256": sha256_bytes(discovery_raw),
        "discovery": discovery,
    }
    exclusive_write(FREEZE_PATH, canonical_bytes(payload))
    print(
        json.dumps(
            {
                "status": payload["status"],
                "objects": discovery["objectCount"],
                "path": str(FREEZE_PATH),
            },
            sort_keys=True,
        )
    )


def verify_freeze() -> tuple[dict[str, Any], bytes]:
    freeze, freeze_raw = load_json(FREEZE_PATH)
    if freeze.get("status") != "FROZEN_BEFORE_ARCHIVE_OUTCOME_BODIES":
        raise EvidenceError("freeze status is invalid")
    expected_hashes = freeze.get("inputSha256")
    if not isinstance(expected_hashes, dict):
        raise EvidenceError("freeze inputSha256 must be an object")
    if cast(dict[str, str], expected_hashes) != current_input_hashes():
        raise EvidenceError("tracked evaluator/protocol bytes differ from freeze")
    _, plan_raw = load_json(PLAN_PATH)
    if freeze.get("sourcePlanSha256") != sha256_bytes(plan_raw):
        raise EvidenceError("freeze source-plan binding failed")
    discovery = freeze.get("discovery")
    if not isinstance(discovery, dict):
        raise EvidenceError("freeze lacks embedded discovery")
    if freeze.get("discoverySha256") != sha256_bytes(canonical_bytes(discovery)):
        raise EvidenceError("freeze discovery binding failed")
    return freeze, freeze_raw


def cache_path(cache_root: Path, key: str) -> Path:
    if key.startswith("/") or ".." in Path(key).parts:
        raise EvidenceError(f"unsafe archive key: {key}")
    target = cache_root.joinpath(*Path(key).parts)
    resolved_parent = target.parent.resolve()
    if cache_root.resolve() not in (resolved_parent, *resolved_parent.parents):
        raise EvidenceError(f"cache target escapes state root: {key}")
    return target


def verify_listing_etag(raw: bytes, expected_etag: str, *, key: str) -> None:
    if re.fullmatch(r"[0-9a-fA-F]{32}", expected_etag) is None:
        raise EvidenceError(f"non-MD5 listing ETag cannot bind object bytes: {key}")
    actual = hashlib.md5(raw, usedforsecurity=False).hexdigest()
    if actual.lower() != expected_etag.lower():
        raise EvidenceError(f"object bytes do not match frozen listing ETag: {key}")


def download_object(url: str, target: Path, expected_size: int, expected_etag: str) -> bytes:
    if target.exists():
        raw = safe_file(target).read_bytes()
        if len(raw) != expected_size:
            raise EvidenceError(f"cached object size mismatch: {target}")
        verify_listing_etag(raw, expected_etag, key=str(target))
        return raw
    target.parent.mkdir(parents=True, exist_ok=True)
    raw, _ = http_bytes(url)
    if len(raw) != expected_size:
        raise EvidenceError(f"downloaded object size mismatch: {url}")
    verify_listing_etag(raw, expected_etag, key=url)
    exclusive_write(target, raw)
    return raw


def parse_official_checksum(raw: bytes, zip_key: str) -> str:
    try:
        text = raw.decode("ascii").strip()
    except UnicodeDecodeError as error:
        raise EvidenceError(f"checksum sidecar is not ASCII: {zip_key}") from error
    match = CHECKSUM_RE.fullmatch(text)
    if match is None:
        raise EvidenceError(f"checksum sidecar format invalid: {zip_key}")
    if match.group(2) != Path(zip_key).name:
        raise EvidenceError(f"checksum filename does not match ZIP: {zip_key}")
    return match.group(1).lower()


def acquisition_entry(discovered: Mapping[str, Any], cache_root: Path) -> dict[str, object]:
    zip_meta = discovered.get("zip")
    checksum_meta = discovered.get("checksum")
    if not isinstance(zip_meta, dict) or not isinstance(checksum_meta, dict):
        raise EvidenceError("discovery entry lacks ZIP/checksum metadata")
    zip_key = require_text(zip_meta.get("key"), field_name="zip.key")
    checksum_key = require_text(checksum_meta.get("key"), field_name="checksum.key")
    zip_size = require_int(zip_meta.get("size"), field_name="zip.size")
    checksum_size = require_int(checksum_meta.get("size"), field_name="checksum.size")
    zip_etag = require_text(zip_meta.get("etag"), field_name="zip.etag")
    checksum_etag = require_text(checksum_meta.get("etag"), field_name="checksum.etag")
    checksum_raw = download_object(
        f"https://data.binance.vision/{checksum_key}",
        cache_path(cache_root, checksum_key),
        checksum_size,
        checksum_etag,
    )
    expected_zip_sha = parse_official_checksum(checksum_raw, zip_key)
    zip_raw = download_object(
        f"https://data.binance.vision/{zip_key}",
        cache_path(cache_root, zip_key),
        zip_size,
        zip_etag,
    )
    actual_zip_sha = sha256_bytes(zip_raw)
    if actual_zip_sha != expected_zip_sha:
        raise EvidenceError(f"official checksum mismatch: {zip_key}")
    return {
        "zipKey": zip_key,
        "checksumKey": checksum_key,
        "partition": require_text(discovered.get("partition"), field_name="partition"),
        "zipSize": zip_size,
        "zipSha256": actual_zip_sha,
        "checksumSha256": sha256_bytes(checksum_raw),
        "listingEtag": zip_etag,
        "checksumListingEtag": checksum_etag,
    }


def cmd_acquire(arguments: argparse.Namespace) -> None:
    freeze, freeze_raw = verify_freeze()
    if RUN_MARKER_PATH.exists():
        raise EvidenceError("acquisition mutation forbidden after run marker")
    discovery = cast(dict[str, Any], freeze["discovery"])
    discovered_objects = require_list(discovery.get("objects"), field_name="objects")
    state_root = Path(arguments.state_root).resolve()
    cache_root = state_root / "cache"
    cache_root.mkdir(parents=True, exist_ok=True)
    entries: list[dict[str, object]] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as executor:
        futures = {
            executor.submit(acquisition_entry, cast(dict[str, Any], item), cache_root): item
            for item in discovered_objects
            if isinstance(item, dict)
        }
        if len(futures) != len(discovered_objects):
            raise EvidenceError("discovery contains a non-object entry")
        for index, future in enumerate(concurrent.futures.as_completed(futures), start=1):
            entry = future.result()
            entries.append(entry)
            if index % 25 == 0 or index == len(futures):
                print(f"acquired {index}/{len(futures)}", file=sys.stderr)
    entries.sort(key=lambda value: str(value["zipKey"]))
    manifest = {
        "schema": "S1LAcquisitionV1",
        "status": "CHECKSUM_VERIFIED_ZIP_BYTES_NOT_DECOMPRESSED",
        "acquiredAtUtc": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "freezeSha256": sha256_bytes(freeze_raw),
        "objectCount": len(entries),
        "objects": entries,
    }
    manifest_path = state_root / "acquisition.v1.json"
    write_once_or_equal(manifest_path, canonical_bytes(manifest))
    print(
        json.dumps(
            {
                "status": manifest["status"],
                "objects": len(entries),
                "path": str(manifest_path),
            },
            sort_keys=True,
        )
    )


def verified_acquisition(
    state_root: Path, freeze: Mapping[str, Any], freeze_raw: bytes
) -> tuple[dict[str, Any], bytes, dict[str, dict[str, Any]]]:
    manifest, manifest_raw = load_json(state_root / "acquisition.v1.json")
    if manifest.get("status") != "CHECKSUM_VERIFIED_ZIP_BYTES_NOT_DECOMPRESSED":
        raise EvidenceError("acquisition manifest status invalid")
    if manifest.get("freezeSha256") != sha256_bytes(freeze_raw):
        raise EvidenceError("acquisition does not bind current freeze")
    discovery = freeze.get("discovery")
    if not isinstance(discovery, dict):
        raise EvidenceError("freeze discovery is missing")
    frozen_objects = require_list(discovery.get("objects"), field_name="discovery.objects")
    frozen_by_key: dict[str, dict[str, Any]] = {}
    for raw_frozen in frozen_objects:
        if not isinstance(raw_frozen, dict):
            raise EvidenceError("frozen discovery entry must be an object")
        frozen = cast(dict[str, Any], raw_frozen)
        zip_meta = frozen.get("zip")
        if not isinstance(zip_meta, dict):
            raise EvidenceError("frozen discovery ZIP metadata is missing")
        frozen_key = require_text(zip_meta.get("key"), field_name="discovery.zip.key")
        if frozen_key in frozen_by_key:
            raise EvidenceError(f"duplicate frozen ZIP: {frozen_key}")
        frozen_by_key[frozen_key] = frozen
    objects = require_list(manifest.get("objects"), field_name="acquisition.objects")
    by_key: dict[str, dict[str, Any]] = {}
    for raw_item in objects:
        if not isinstance(raw_item, dict):
            raise EvidenceError("acquisition entry must be an object")
        item = cast(dict[str, Any], raw_item)
        key = require_text(item.get("zipKey"), field_name="zipKey")
        if key in by_key:
            raise EvidenceError(f"duplicate acquired ZIP: {key}")
        if key not in frozen_by_key:
            raise EvidenceError(f"acquisition contains an unplanned ZIP: {key}")
        frozen = frozen_by_key[key]
        zip_meta = frozen.get("zip")
        checksum_meta = frozen.get("checksum")
        if not isinstance(zip_meta, dict) or not isinstance(checksum_meta, dict):
            raise EvidenceError(f"frozen metadata incomplete: {key}")
        checksum_key = require_text(checksum_meta.get("key"), field_name="discovery.checksum.key")
        frozen_zip_size = require_int(zip_meta.get("size"), field_name="zip.size")
        frozen_checksum_size = require_int(checksum_meta.get("size"), field_name="checksum.size")
        frozen_zip_etag = require_text(zip_meta.get("etag"), field_name="zip.etag")
        frozen_checksum_etag = require_text(checksum_meta.get("etag"), field_name="checksum.etag")
        expected_fields = {
            "checksumKey": checksum_key,
            "partition": require_text(frozen.get("partition"), field_name="partition"),
            "zipSize": frozen_zip_size,
            "listingEtag": frozen_zip_etag,
            "checksumListingEtag": frozen_checksum_etag,
        }
        for field_name, expected_value in expected_fields.items():
            if item.get(field_name) != expected_value:
                raise EvidenceError(f"acquisition field differs from freeze: {key} {field_name}")
        expected_sha = require_text(item.get("zipSha256"), field_name="zipSha256")
        if SHA256_RE.fullmatch(expected_sha) is None:
            raise EvidenceError(f"invalid acquired SHA-256: {key}")
        zip_raw = safe_file(cache_path(state_root / "cache", key)).read_bytes()
        if len(zip_raw) != frozen_zip_size:
            raise EvidenceError(f"cached ZIP size differs from freeze: {key}")
        verify_listing_etag(zip_raw, frozen_zip_etag, key=key)
        if sha256_bytes(zip_raw) != expected_sha:
            raise EvidenceError(f"cached ZIP changed after acquisition: {key}")
        expected_checksum_sha = require_text(
            item.get("checksumSha256"), field_name="checksumSha256"
        )
        if SHA256_RE.fullmatch(expected_checksum_sha) is None:
            raise EvidenceError(f"invalid acquired checksum SHA-256: {key}")
        checksum_raw = safe_file(cache_path(state_root / "cache", checksum_key)).read_bytes()
        if len(checksum_raw) != frozen_checksum_size:
            raise EvidenceError(f"cached checksum size differs from freeze: {key}")
        verify_listing_etag(checksum_raw, frozen_checksum_etag, key=checksum_key)
        if sha256_bytes(checksum_raw) != expected_checksum_sha:
            raise EvidenceError(f"cached checksum changed after acquisition: {key}")
        if parse_official_checksum(checksum_raw, key) != expected_sha:
            raise EvidenceError(f"official checksum no longer binds cached ZIP: {key}")
        by_key[key] = item
    if manifest.get("objectCount") != len(by_key) or set(by_key) != set(frozen_by_key):
        raise EvidenceError("acquisition object count mismatch")
    return manifest, manifest_raw, by_key


def zip_csv_bytes(path: Path, expected_sha: str) -> bytes:
    raw = safe_file(path).read_bytes()
    if len(raw) > MAX_ZIP_BYTES:
        raise EvidenceError(f"ZIP exceeds frozen byte limit: {path}")
    if sha256_bytes(raw) != expected_sha:
        raise EvidenceError(f"ZIP SHA changed before decompression: {path}")
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            members = [member for member in archive.infolist() if not member.is_dir()]
            if len(members) != 1:
                raise EvidenceError(f"archive must contain exactly one member: {path}")
            member = members[0]
            if Path(member.filename).name != member.filename or member.filename.startswith("."):
                raise EvidenceError(f"unsafe archive member: {member.filename}")
            expected_member = f"{path.stem}.csv"
            if member.filename != expected_member:
                raise EvidenceError(
                    f"archive member name mismatch: {member.filename} != {expected_member}"
                )
            if member.external_attr >> 16 & 0o170000 == 0o120000:
                raise EvidenceError(f"archive symlink member refused: {member.filename}")
            if member.file_size <= 0 or member.file_size > MAX_MEMBER_BYTES:
                raise EvidenceError(f"archive member size outside frozen bounds: {path}")
            if member.compress_size <= 0:
                raise EvidenceError(f"archive member has invalid compressed size: {path}")
            if member.file_size > member.compress_size * MAX_COMPRESSION_RATIO:
                raise EvidenceError(f"archive compression ratio exceeds frozen bound: {path}")
            return archive.read(member)
    except zipfile.BadZipFile as error:
        raise EvidenceError(f"invalid ZIP: {path}") from error


def csv_rows(raw: bytes, *, source: str) -> tuple[list[str], list[dict[str, str]]]:
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise EvidenceError(f"CSV is not UTF-8: {source}") from error
    reader = csv.DictReader(io.StringIO(text))
    if reader.fieldnames is None:
        raise EvidenceError(f"CSV has no header: {source}")
    rows: list[dict[str, str]] = []
    for row_number, raw_row in enumerate(reader, start=1):
        if row_number > MAX_CSV_ROWS:
            raise EvidenceError(f"CSV exceeds frozen row limit: {source}")
        if None in raw_row:
            raise EvidenceError(f"CSV row has extra columns: {source}")
        rows.append({str(key): str(value) for key, value in raw_row.items()})
    if not rows:
        raise EvidenceError(f"CSV has no data rows: {source}")
    return list(reader.fieldnames), rows


def positional_csv_rows(raw: bytes, *, source: str, columns: Sequence[str]) -> list[dict[str, str]]:
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise EvidenceError(f"CSV is not UTF-8: {source}") from error
    rows: list[list[str]] = []
    for row_number, row in enumerate(csv.reader(io.StringIO(text)), start=1):
        if row_number > MAX_CSV_ROWS + 1:
            raise EvidenceError(f"CSV exceeds frozen row limit: {source}")
        rows.append(row)
    if not rows:
        raise EvidenceError(f"CSV has no rows: {source}")
    start = 1 if tuple(rows[0]) == tuple(columns) else 0
    values: list[dict[str, str]] = []
    for row in rows[start:]:
        if len(row) != len(columns):
            raise EvidenceError(f"CSV positional width {len(row)} != {len(columns)}: {source}")
        values.append(dict(zip(columns, row, strict=True)))
    if not values:
        raise EvidenceError(f"CSV has no data rows: {source}")
    return values


def row_decimal(row: Mapping[str, str], key: str, source: str) -> Decimal:
    if key not in row:
        raise EvidenceError(f"{source} lacks column {key}")
    return decimal_value(row[key], field_name=f"{source}.{key}")


def row_int(row: Mapping[str, str], key: str, source: str) -> int:
    if key not in row:
        raise EvidenceError(f"{source} lacks column {key}")
    try:
        return int(row[key])
    except ValueError as error:
        raise EvidenceError(f"{source}.{key} is not an integer") from error


def parse_kline_csv(raw: bytes, *, source: str) -> dict[int, Bar]:
    rows = positional_csv_rows(raw, source=source, columns=KLINE_COLUMNS)
    values: dict[int, Bar] = {}
    for row in rows:
        open_time = row_int(row, "open_time", source)
        if open_time % HOUR_MS != 0:
            raise EvidenceError(f"non-hourly kline timestamp: {source}")
        bar = Bar(
            timestamp_ms=open_time,
            open=row_decimal(row, "open", source),
            high=row_decimal(row, "high", source),
            low=row_decimal(row, "low", source),
            close=row_decimal(row, "close", source),
            volume=row_decimal(row, "volume", source),
            quote_volume=row_decimal(row, "quote_volume", source),
            count=row_int(row, "count", source),
        )
        if min(bar.open, bar.high, bar.low, bar.close) <= 0:
            raise EvidenceError(f"non-positive kline price: {source}")
        if bar.high < max(bar.open, bar.close, bar.low) or bar.low > min(
            bar.open, bar.close, bar.high
        ):
            raise EvidenceError(f"invalid OHLC ordering: {source}")
        if bar.volume < 0 or bar.quote_volume < 0 or bar.count < 0:
            raise EvidenceError(f"invalid kline activity: {source}")
        if open_time in values:
            raise EvidenceError(f"duplicate kline timestamp: {source}")
        values[open_time] = bar
    return values


def parse_funding_csv(raw: bytes, *, source: str) -> list[FundingEvent]:
    _, rows = csv_rows(raw, source=source)
    values: list[FundingEvent] = []
    seen: set[int] = set()
    for row in rows:
        event = FundingEvent(
            timestamp_ms=row_int(row, "calc_time", source),
            interval_hours=row_int(row, "funding_interval_hours", source),
            rate=row_decimal(row, "last_funding_rate", source),
        )
        if event.timestamp_ms in seen:
            raise EvidenceError(f"duplicate funding timestamp: {source}")
        if event.interval_hours < 1 or event.interval_hours > 24:
            raise EvidenceError(f"funding interval outside 1..24h: {source}")
        seen.add(event.timestamp_ms)
        values.append(event)
    values.sort(key=lambda value: value.timestamp_ms)
    return values


def parse_depth_csv(raw: bytes, *, source: str) -> list[DepthPoint]:
    _, rows = csv_rows(raw, source=source)
    values: list[DepthPoint] = []
    seen: set[tuple[int, Decimal]] = set()
    for row in rows:
        raw_timestamp = row.get("timestamp")
        if raw_timestamp is None:
            raise EvidenceError(f"{source} lacks timestamp")
        try:
            parsed = datetime.strptime(raw_timestamp, "%Y-%m-%d %H:%M:%S").replace(tzinfo=UTC)
        except ValueError as error:
            raise EvidenceError(f"invalid depth timestamp: {source}") from error
        point = DepthPoint(
            timestamp_ms=timestamp_ms(parsed),
            percentage=row_decimal(row, "percentage", source),
            depth=row_decimal(row, "depth", source),
            notional=row_decimal(row, "notional", source),
        )
        key = (point.timestamp_ms, point.percentage)
        if key in seen:
            raise EvidenceError(f"duplicate depth timestamp/band: {source}")
        if point.depth < 0 or point.notional < 0:
            raise EvidenceError(f"negative depth: {source}")
        seen.add(key)
        values.append(point)
    values.sort(key=lambda value: (value.timestamp_ms, value.percentage))
    return values


def merge_unique[T](target: dict[int, T], source: Mapping[int, T], *, label: str) -> None:
    overlap = set(target).intersection(source)
    if overlap:
        raise EvidenceError(f"duplicate timestamp across {label} archives")
    target.update(source)


def load_partition_store(
    partition: str,
    plan: Mapping[str, Any],
    acquisition: Mapping[str, Mapping[str, Any]],
    state_root: Path,
) -> DataStore:
    store = DataStore()
    objects = require_list(plan.get("objects"), field_name="plan.objects")
    for raw_item in objects:
        if not isinstance(raw_item, dict):
            raise EvidenceError("plan object must be an object")
        item = cast(dict[str, Any], raw_item)
        if item.get("partition") != partition:
            continue
        key = require_text(item.get("zipKey"), field_name="zipKey")
        if key not in acquisition:
            raise EvidenceError(f"planned ZIP absent from acquisition: {key}")
        acquired = acquisition[key]
        expected_sha = require_text(acquired.get("zipSha256"), field_name="zipSha256")
        raw = zip_csv_bytes(cache_path(state_root / "cache", key), expected_sha)
        roles = require_list(item.get("roles"), field_name="roles")
        if len(roles) == 0 or not isinstance(roles[0], dict):
            raise EvidenceError(f"plan object lacks a role: {key}")
        role = cast(dict[str, Any], roles[0])
        data_type = require_text(role.get("dataType"), field_name="dataType")
        symbol = require_text(role.get("symbol"), field_name="symbol")
        period = require_text(role.get("period"), field_name="period")
        if data_type == "KLINE":
            merge_unique(
                store.klines.setdefault(symbol, {}),
                parse_kline_csv(raw, source=key),
                label=f"{symbol} kline",
            )
        elif data_type == "MARK":
            merge_unique(
                store.marks.setdefault(symbol, {}),
                parse_kline_csv(raw, source=key),
                label=f"{symbol} mark",
            )
        elif data_type == "FUNDING":
            events = parse_funding_csv(raw, source=key)
            existing = store.funding.setdefault(symbol, [])
            if {event.timestamp_ms for event in existing}.intersection(
                event.timestamp_ms for event in events
            ):
                raise EvidenceError(f"duplicate funding event across archives: {symbol}")
            existing.extend(events)
            existing.sort(key=lambda value: value.timestamp_ms)
        elif data_type == "DEPTH":
            try:
                day = date.fromisoformat(period)
            except ValueError as error:
                raise EvidenceError(f"invalid depth plan date: {period}") from error
            by_day = store.depth.setdefault(symbol, {})
            if day in by_day:
                raise EvidenceError(f"duplicate depth day: {symbol} {period}")
            by_day[day] = parse_depth_csv(raw, source=key)
        else:
            raise EvidenceError(f"unknown planned data type: {data_type}")
    return store


def protocol_scenarios(protocol: Mapping[str, Any]) -> tuple[Scenario, Scenario]:
    fee = decimal_value(
        nested(protocol, "costs", "publicProxyFeeBpsPerLegFill"),
        field_name="publicProxyFeeBpsPerLegFill",
        minimum=D(0),
    )
    base = decimal_value(
        nested(protocol, "costs", "baseAdverseExecutionBpsPerLegFill"),
        field_name="baseAdverseExecutionBpsPerLegFill",
        minimum=D(0),
    )
    stress = decimal_value(
        nested(protocol, "costs", "stressAdverseExecutionBpsPerLegFill"),
        field_name="stressAdverseExecutionBpsPerLegFill",
        minimum=base,
    )
    return (
        Scenario(name="PUBLIC_PROXY_BASE", fee_bps=fee, adverse_bps=base),
        Scenario(name="PUBLIC_PROXY_STRESS", fee_bps=fee, adverse_bps=stress),
    )


def sizing_contract(
    protocol: Mapping[str, Any], pairs: Sequence[str]
) -> tuple[Decimal, Decimal, Decimal]:
    initial = decimal_value(
        nested(protocol, "sizing", "initialCapitalUsd"),
        field_name="initialCapitalUsd",
        minimum=D("0.01"),
    )
    gross = decimal_value(
        nested(protocol, "sizing", "grossPortfolioNotionalUsd"),
        field_name="grossPortfolioNotionalUsd",
        minimum=D("0.01"),
    )
    per_underlying = decimal_value(
        nested(protocol, "sizing", "grossPerUnderlyingUsd"),
        field_name="grossPerUnderlyingUsd",
        minimum=D("0.01"),
    )
    zero_basis_leg = decimal_value(
        nested(protocol, "sizing", "referenceNotionalPerLegWhenBasisZeroUsd"),
        field_name="referenceNotionalPerLegWhenBasisZeroUsd",
        minimum=D("0.01"),
    )
    if initial != gross:
        raise EvidenceError("initial capital and normalized gross must be equal")
    if gross != per_underlying * D(len(pairs)):
        raise EvidenceError("gross must equal gross-per-underlying times pair count")
    if per_underlying != D(2) * zero_basis_leg:
        raise EvidenceError("zero-basis two-leg notionals must sum to underlying gross")
    return initial, gross, per_underlying


def required_bar(store: Mapping[str, Mapping[int, Bar]], symbol: str, at_ms: int) -> Bar:
    if symbol not in store or at_ms not in store[symbol]:
        moment = datetime_from_ms(at_ms).isoformat()
        raise EvidenceError(f"required hourly bar missing: {symbol} {moment}")
    return store[symbol][at_ms]


def funding_events_for_hold(
    store: DataStore, pair: str, entry_ms: int, exit_ms: int
) -> tuple[FundingEvent, ...]:
    events = tuple(
        event for event in store.funding.get(pair, []) if entry_ms < event.timestamp_ms < exit_ms
    )
    if exit_ms - entry_ms > DAY_MS and not events:
        raise EvidenceError(f"no funding events inside multi-day hold: {pair}")
    if events:
        first_allowance = events[0].interval_hours * HOUR_MS + 60_000
        last_allowance = events[-1].interval_hours * HOUR_MS + 60_000
        if events[0].timestamp_ms - entry_ms > first_allowance:
            raise EvidenceError(f"funding coverage starts too late: {pair}")
        if exit_ms - events[-1].timestamp_ms > last_allowance:
            raise EvidenceError(f"funding coverage ends too early: {pair}")
        for previous, current in itertools.pairwise(events):
            allowance = max(previous.interval_hours, current.interval_hours) * HOUR_MS + 60_000
            if current.timestamp_ms - previous.timestamp_ms > allowance:
                raise EvidenceError(f"funding continuity gap: {pair}")
    return events


def mark_for_funding(store: DataStore, pair: str, event: FundingEvent) -> Decimal:
    hour = event.timestamp_ms - event.timestamp_ms % HOUR_MS
    mark = required_bar(store.marks, pair, hour).open
    if mark <= 0:
        raise EvidenceError(f"non-positive funding mark proxy: {pair}")
    return mark


def directional_depth(store: DataStore, symbol: str, fill_ms: int, trade_side: int) -> Decimal:
    if trade_side not in (-1, 1):
        raise EvidenceError("depth direction must be -1 or +1")
    fill_day = datetime_from_ms(fill_ms).date()
    points = store.depth.get(symbol, {}).get(fill_day)
    if points is None:
        raise EvidenceError(f"depth day missing: {symbol} {fill_day}")
    eligible_times = [point.timestamp_ms for point in points if point.timestamp_ms <= fill_ms]
    if not eligible_times:
        raise EvidenceError(f"no depth snapshot at or before fill: {symbol} {fill_day}")
    latest = max(eligible_times)
    if fill_ms - latest > 60_000:
        raise EvidenceError(f"depth snapshot older than 60 seconds: {symbol} {fill_day}")
    band = D("0.20") if trade_side == 1 else D("-0.20")
    matches = [
        point for point in points if point.timestamp_ms == latest and point.percentage == band
    ]
    if len(matches) != 1:
        raise EvidenceError(f"directional 0.20% depth band missing: {symbol} {fill_day}")
    if matches[0].notional <= 0:
        raise EvidenceError(f"directional depth is non-positive: {symbol} {fill_day}")
    return matches[0].notional


def adverse_price(
    reference: Decimal, position_side: int, adverse_bps: Decimal, *, entry: bool
) -> Decimal:
    rate = adverse_bps / D(10_000)
    factor = D(1) + D(position_side) * rate if entry else D(1) - D(position_side) * rate
    value = reference * factor
    if value <= 0:
        raise EvidenceError("adverse execution produced non-positive price")
    return value


def leg_liquidation_pnl(
    *,
    position_side: int,
    quantity: Decimal,
    entry_execution: Decimal,
    current_reference: Decimal,
    fee_rate: Decimal,
    adverse_bps: Decimal,
) -> Decimal:
    exit_execution = adverse_price(current_reference, position_side, adverse_bps, entry=False)
    price_pnl = D(position_side) * quantity * (exit_execution - entry_execution)
    entry_fee = quantity * entry_execution * fee_rate
    exit_fee = quantity * exit_execution * fee_rate
    return price_pnl - entry_fee - exit_fee


def evaluate_underlying(
    *,
    pair: str,
    delivery: datetime,
    trial: TrialSpec,
    scenario: Scenario,
    store: DataStore,
    gross_underlying_usd: Decimal,
) -> UnderlyingResult:
    suffix = delivery.strftime("%y%m%d")
    dated_symbol = f"{pair}_{suffix}"
    signal_ms = timestamp_ms(delivery - timedelta(days=trial.entry_dte))
    entry_ms = signal_ms + HOUR_MS
    exit_ms = timestamp_ms(delivery - timedelta(days=trial.exit_dte)) + HOUR_MS
    if not entry_ms < exit_ms < timestamp_ms(delivery):
        raise EvidenceError("trial entry/exit does not stay before delivery")
    dated_signal = required_bar(store.klines, dated_symbol, signal_ms).close
    perp_signal = required_bar(store.klines, pair, signal_ms).close
    dated_entry_reference = required_bar(store.klines, dated_symbol, entry_ms).open
    perp_entry_reference = required_bar(store.klines, pair, entry_ms).open
    dated_exit_reference = required_bar(store.klines, dated_symbol, exit_ms).open
    perp_exit_reference = required_bar(store.klines, pair, exit_ms).open
    current_ms = entry_ms
    while current_ms < exit_ms:
        required_bar(store.klines, dated_symbol, current_ms)
        required_bar(store.klines, pair, current_ms)
        current_ms += HOUR_MS
    funding_events = funding_events_for_hold(store, pair, entry_ms, exit_ms)
    for event in funding_events:
        mark_for_funding(store, pair, event)
    if dated_signal > perp_signal:
        side_dated = -1
    elif dated_signal < perp_signal:
        side_dated = 1
    else:
        for symbol in (dated_symbol, pair):
            for fill_ms in (entry_ms, exit_ms):
                directional_depth(store, symbol, fill_ms, -1)
                directional_depth(store, symbol, fill_ms, 1)
        return UnderlyingResult(
            pair=pair,
            dated_symbol=dated_symbol,
            side_dated=0,
            entry_ms=entry_ms,
            exit_ms=exit_ms,
            decomposition=Decomposition(),
            path=((entry_ms, D(0)), (exit_ms, D(0))),
            public_20bps_capacity_scale=None,
            fills=0,
            funding_events=0,
        )
    side_perp = -side_dated
    base_quantity = gross_underlying_usd / (dated_entry_reference + perp_entry_reference)
    dated_quantity = base_quantity
    perp_quantity = base_quantity
    fee_rate = scenario.fee_bps / D(10_000)
    dated_entry_execution = adverse_price(
        dated_entry_reference, side_dated, scenario.adverse_bps, entry=True
    )
    perp_entry_execution = adverse_price(
        perp_entry_reference, side_perp, scenario.adverse_bps, entry=True
    )
    dated_exit_execution = adverse_price(
        dated_exit_reference, side_dated, scenario.adverse_bps, entry=False
    )
    perp_exit_execution = adverse_price(
        perp_exit_reference, side_perp, scenario.adverse_bps, entry=False
    )
    reference_gross = D(side_dated) * dated_quantity * (
        dated_exit_reference - dated_entry_reference
    ) + D(side_perp) * perp_quantity * (perp_exit_reference - perp_entry_reference)
    actual_price_pnl = D(side_dated) * dated_quantity * (
        dated_exit_execution - dated_entry_execution
    ) + D(side_perp) * perp_quantity * (perp_exit_execution - perp_entry_execution)
    adverse = reference_gross - actual_price_pnl
    if adverse < 0:
        raise EvidenceError("adverse execution unexpectedly improved P&L")
    fees = fee_rate * (
        dated_quantity * (dated_entry_execution + dated_exit_execution)
        + perp_quantity * (perp_entry_execution + perp_exit_execution)
    )
    funding_values: list[tuple[int, Decimal]] = []
    funding_total = D(0)
    for event in funding_events:
        value = -D(side_perp) * perp_quantity * mark_for_funding(store, pair, event) * event.rate
        funding_total += value
        funding_values.append((event.timestamp_ms, value))
    decomposition = Decomposition(
        reference_gross=reference_gross,
        funding=funding_total,
        adverse=adverse,
        fees=fees,
        net=actual_price_pnl + funding_total - fees,
    )
    if decomposition.residual() != 0:
        raise EvidenceError("underlying decomposition identity failed")
    depth_values = (
        directional_depth(store, dated_symbol, entry_ms, side_dated),
        directional_depth(store, pair, entry_ms, side_perp),
        directional_depth(store, dated_symbol, exit_ms, -side_dated),
        directional_depth(store, pair, exit_ms, -side_perp),
    )
    reference_notionals = (
        dated_quantity * dated_entry_reference,
        perp_quantity * perp_entry_reference,
        dated_quantity * dated_exit_reference,
        perp_quantity * perp_exit_reference,
    )
    capacity_scale = min(
        depth / notional for depth, notional in zip(depth_values, reference_notionals, strict=True)
    )
    path: list[tuple[int, Decimal]] = []

    def funding_through(at_ms: int) -> Decimal:
        return sum((value for event_ms, value in funding_values if event_ms <= at_ms), D(0))

    entry_liquidation = leg_liquidation_pnl(
        position_side=side_dated,
        quantity=dated_quantity,
        entry_execution=dated_entry_execution,
        current_reference=dated_entry_reference,
        fee_rate=fee_rate,
        adverse_bps=scenario.adverse_bps,
    ) + leg_liquidation_pnl(
        position_side=side_perp,
        quantity=perp_quantity,
        entry_execution=perp_entry_execution,
        current_reference=perp_entry_reference,
        fee_rate=fee_rate,
        adverse_bps=scenario.adverse_bps,
    )
    path.append((entry_ms, entry_liquidation))
    current_ms = entry_ms
    while current_ms < exit_ms:
        dated_bar = required_bar(store.klines, dated_symbol, current_ms)
        perp_bar = required_bar(store.klines, pair, current_ms)
        mark_ms = current_ms + HOUR_MS - 1
        liquidation = (
            leg_liquidation_pnl(
                position_side=side_dated,
                quantity=dated_quantity,
                entry_execution=dated_entry_execution,
                current_reference=dated_bar.close,
                fee_rate=fee_rate,
                adverse_bps=scenario.adverse_bps,
            )
            + leg_liquidation_pnl(
                position_side=side_perp,
                quantity=perp_quantity,
                entry_execution=perp_entry_execution,
                current_reference=perp_bar.close,
                fee_rate=fee_rate,
                adverse_bps=scenario.adverse_bps,
            )
            + funding_through(mark_ms)
        )
        path.append((mark_ms, liquidation))
        current_ms += HOUR_MS
    path.append((exit_ms, decomposition.net))
    return UnderlyingResult(
        pair=pair,
        dated_symbol=dated_symbol,
        side_dated=side_dated,
        entry_ms=entry_ms,
        exit_ms=exit_ms,
        decomposition=decomposition,
        path=tuple(path),
        public_20bps_capacity_scale=capacity_scale,
        fills=4,
        funding_events=len(funding_events),
    )


def aggregate_paths(
    paths: Sequence[tuple[tuple[int, Decimal], ...]],
) -> tuple[tuple[int, Decimal], ...]:
    if not paths:
        raise EvidenceError("cannot aggregate no paths")
    keys = tuple(timestamp for timestamp, _ in paths[0])
    totals = {timestamp: D(0) for timestamp in keys}
    for path in paths:
        if tuple(timestamp for timestamp, _ in path) != keys:
            raise EvidenceError("underlying hourly paths are not synchronized")
        for timestamp, value in path:
            totals[timestamp] += value
    return tuple((timestamp, totals[timestamp]) for timestamp in keys)


def evaluate_cluster(
    *,
    delivery: datetime,
    trial: TrialSpec,
    scenario: Scenario,
    store: DataStore,
    pairs: Sequence[str],
    gross_usd: Decimal,
) -> ClusterResult:
    gross_underlying = gross_usd / D(len(pairs))
    underlying = tuple(
        evaluate_underlying(
            pair=pair,
            delivery=delivery,
            trial=trial,
            scenario=scenario,
            store=store,
            gross_underlying_usd=gross_underlying,
        )
        for pair in pairs
    )
    decomposition = Decomposition()
    for result in underlying:
        decomposition.add(result.decomposition)
    if decomposition.residual() != 0:
        raise EvidenceError("cluster decomposition identity failed")
    active_scales = [
        result.public_20bps_capacity_scale
        for result in underlying
        if result.public_20bps_capacity_scale is not None
    ]
    capacity = min(active_scales) * gross_usd if active_scales else None
    return ClusterResult(
        delivery=delivery.isoformat().replace("+00:00", "Z"),
        decomposition=decomposition,
        path=aggregate_paths(tuple(result.path for result in underlying)),
        public_20bps_gross_capacity_usd=capacity,
        fills=sum(result.fills for result in underlying),
        funding_events=sum(result.funding_events for result in underlying),
        sides=tuple((result.pair, result.side_dated) for result in underlying),
    )


def drawdown_from_clusters(
    clusters: Sequence[ClusterResult], initial_capital: Decimal
) -> tuple[Decimal, Decimal]:
    realized = D(0)
    peak = initial_capital
    maximum_usd = D(0)
    maximum_pct = D(0)
    for cluster in clusters:
        for _, relative_pnl in cluster.path:
            equity = initial_capital + realized + relative_pnl
            peak = max(peak, equity)
            drawdown_usd = peak - equity
            drawdown_pct = drawdown_usd / peak * D(100) if peak > 0 else D("Infinity")
            maximum_usd = max(maximum_usd, drawdown_usd)
            maximum_pct = max(maximum_pct, drawdown_pct)
        realized += cluster.decomposition.net
    if not maximum_pct.is_finite():
        raise EvidenceError("non-positive running equity makes drawdown not estimable")
    return maximum_usd, maximum_pct


def trial_result_from_clusters(
    *,
    spec: TrialSpec,
    scenario: Scenario,
    clusters: Sequence[ClusterResult],
    initial_capital: Decimal,
) -> TrialResult:
    decomposition = Decomposition()
    for cluster in clusters:
        decomposition.add(cluster.decomposition)
    if decomposition.residual() != 0:
        raise EvidenceError("trial decomposition identity failed")
    maximum_drawdown, maximum_drawdown_pct = drawdown_from_clusters(clusters, initial_capital)
    capacities = [
        cluster.public_20bps_gross_capacity_usd
        for cluster in clusters
        if cluster.public_20bps_gross_capacity_usd is not None
    ]
    return TrialResult(
        spec=spec,
        scenario=scenario,
        clusters=tuple(clusters),
        decomposition=decomposition,
        net_usd_per_1000=decomposition.net,
        maximum_drawdown_usd=maximum_drawdown,
        maximum_drawdown_pct=maximum_drawdown_pct,
        minimum_capacity_usd=min(capacities) if capacities else None,
        median_capacity_usd=(statistics.median(capacities) if capacities else None),
        fills=sum(cluster.fills for cluster in clusters),
        funding_events=sum(cluster.funding_events for cluster in clusters),
    )


def evaluate_trial(
    *,
    trial: TrialSpec,
    scenario: Scenario,
    deliveries: Sequence[datetime],
    store: DataStore,
    pairs: Sequence[str],
    gross_usd: Decimal,
) -> TrialResult:
    clusters = tuple(
        evaluate_cluster(
            delivery=delivery,
            trial=trial,
            scenario=scenario,
            store=store,
            pairs=pairs,
            gross_usd=gross_usd,
        )
        for delivery in deliveries
    )
    return trial_result_from_clusters(
        spec=trial,
        scenario=scenario,
        clusters=clusters,
        initial_capital=gross_usd,
    )


def circular_draws(
    length: int, *, replicates: int, block_length: int, seed: int
) -> tuple[tuple[int, ...], ...]:
    if length < block_length or block_length < 1 or replicates < 1:
        raise EvidenceError("invalid circular bootstrap dimensions")
    rng = random.Random(seed)
    draws: list[tuple[int, ...]] = []
    for _ in range(replicates):
        indices: list[int] = []
        while len(indices) < length:
            start = rng.randrange(length)
            indices.extend((start + offset) % length for offset in range(block_length))
        draws.append(tuple(indices[:length]))
    return tuple(draws)


def empirical_quantile(values: Sequence[Decimal], probability: Decimal) -> Decimal:
    if not values or probability < 0 or probability > 1:
        raise EvidenceError("invalid empirical quantile request")
    ordered = sorted(values)
    index = min(int(probability * D(len(ordered))), len(ordered) - 1)
    return ordered[index]


def bootstrap_interval(
    values: Sequence[Decimal],
    *,
    draws: Sequence[Sequence[int]],
    lower_probability: Decimal,
    upper_probability: Decimal,
) -> tuple[Decimal, Decimal]:
    totals = [sum((values[index] for index in draw), D(0)) for draw in draws]
    return (
        empirical_quantile(totals, lower_probability),
        empirical_quantile(totals, upper_probability),
    )


def holm_adjusted(raw_p: Mapping[str, Decimal]) -> dict[str, Decimal]:
    ordered = sorted(raw_p.items(), key=lambda item: (item[1], item[0]))
    adjusted: dict[str, Decimal] = {}
    running = D(0)
    family_size = len(ordered)
    for rank, (trial_id, value) in enumerate(ordered):
        running = max(running, D(family_size - rank) * value)
        adjusted[trial_id] = min(D(1), running)
    return adjusted


def development_statistics(
    stress_results: Mapping[str, TrialResult],
    champion_id: str,
    *,
    replicates: int,
    block_length: int,
    seed: int,
    alpha: Decimal,
) -> dict[str, object]:
    trial_ids = tuple(sorted(stress_results))
    if champion_id not in stress_results or not trial_ids:
        raise EvidenceError("development statistics lack champion/family")
    length = len(stress_results[champion_id].clusters)
    if any(len(stress_results[trial_id].clusters) != length for trial_id in trial_ids):
        raise EvidenceError("development trial matrix is ragged")
    draws = circular_draws(length, replicates=replicates, block_length=block_length, seed=seed)
    values = {
        trial_id: tuple(cluster.decomposition.net for cluster in stress_results[trial_id].clusters)
        for trial_id in trial_ids
    }
    means = {trial_id: sum(series, D(0)) / D(length) for trial_id, series in values.items()}
    centered = {
        trial_id: tuple(value - means[trial_id] for value in series)
        for trial_id, series in values.items()
    }
    centered_means: dict[str, list[Decimal]] = {trial_id: [] for trial_id in trial_ids}
    max_centered: list[Decimal] = []
    for draw in draws:
        replicate_values: list[Decimal] = []
        for trial_id in trial_ids:
            replicate = sum((centered[trial_id][index] for index in draw), D(0)) / D(length)
            centered_means[trial_id].append(replicate)
            replicate_values.append(replicate)
        max_centered.append(max(replicate_values))
    denominator = D(replicates + 1)
    raw_p = {
        trial_id: (
            D(1) + D(sum(replicate >= means[trial_id] for replicate in centered_means[trial_id]))
        )
        / denominator
        for trial_id in trial_ids
    }
    adjusted = holm_adjusted(raw_p)
    max_t_p = (D(1) + D(sum(value >= means[champion_id] for value in max_centered))) / denominator
    bonferroni_alpha = alpha / D(len(trial_ids))
    champion_bootstrap = [
        sum((values[champion_id][index] for index in draw), D(0)) for draw in draws
    ]
    bonferroni_lower = empirical_quantile(champion_bootstrap, bonferroni_alpha)
    return {
        "replicates": replicates,
        "blockLengthClusters": block_length,
        "rawOneSidedP": {trial_id: decimal_text(raw_p[trial_id]) for trial_id in trial_ids},
        "holmAdjustedP": {trial_id: decimal_text(adjusted[trial_id]) for trial_id in trial_ids},
        "championHolmPass": adjusted[champion_id] <= alpha,
        "centeredMaxTRealityCheckP": decimal_text(max_t_p),
        "centeredMaxTRealityCheckPass": max_t_p <= alpha,
        "championBonferroniLowerNetUsdPer1000": decimal_text(bonferroni_lower),
        "championBonferroniLowerPositive": bonferroni_lower > 0,
    }


def pbo_cscv(stress_results: Mapping[str, TrialResult]) -> dict[str, object]:
    trial_ids = tuple(sorted(stress_results))
    if not trial_ids:
        raise EvidenceError("PBO family is empty")
    block_count = len(stress_results[trial_ids[0]].clusters)
    if block_count != 8 or any(
        len(stress_results[trial_id].clusters) != block_count for trial_id in trial_ids
    ):
        raise EvidenceError("PBO requires complete eight-block development matrix")
    matrix = {
        trial_id: tuple(cluster.decomposition.net for cluster in stress_results[trial_id].clusters)
        for trial_id in trial_ids
    }
    below = 0
    split_count = 0
    selections: dict[str, int] = dict.fromkeys(trial_ids, 0)
    all_indices = set(range(block_count))
    for in_sample_tuple in itertools.combinations(range(block_count), block_count // 2):
        in_sample = set(in_sample_tuple)
        out_sample = sorted(all_indices - in_sample)
        scores_is = {
            trial_id: sum((matrix[trial_id][index] for index in in_sample), D(0))
            for trial_id in trial_ids
        }
        selected = min(trial_ids, key=lambda trial_id: (-scores_is[trial_id], trial_id))
        selections[selected] += 1
        scores_oos = {
            trial_id: sum((matrix[trial_id][index] for index in out_sample), D(0))
            for trial_id in trial_ids
        }
        median_oos = statistics.median(scores_oos.values())
        if scores_oos[selected] <= median_oos:
            below += 1
        split_count += 1
    if split_count != math.comb(8, 4):
        raise EvidenceError("PBO split count mismatch")
    probability = D(below) / D(split_count)
    return {
        "method": "CSCV",
        "blocks": block_count,
        "splits": split_count,
        "belowOrEqualMedianSplits": below,
        "pbo": decimal_text(probability),
        "passesMaximum0_50": probability <= D("0.50"),
        "selectionCounts": selections,
    }


def cluster_as_mapping(cluster: ClusterResult) -> dict[str, object]:
    return {
        "deliveryUtc": cluster.delivery,
        "netUsdPer1000Gross": decimal_text(cluster.decomposition.net),
        "public20BpsGrossCapacityUsd": optional_decimal_text(
            cluster.public_20bps_gross_capacity_usd
        ),
        "fills": cluster.fills,
        "fundingEvents": cluster.funding_events,
        "datedSides": dict(cluster.sides),
        "decomposition": cluster.decomposition.as_mapping(),
    }


def trial_full_mapping(result: TrialResult) -> dict[str, object]:
    summary = result.as_summary()
    summary["clusters"] = [cluster_as_mapping(cluster) for cluster in result.clusters]
    return summary


def result_by_id(results: Iterable[TrialResult]) -> dict[str, TrialResult]:
    mapped: dict[str, TrialResult] = {}
    for result in results:
        if result.spec.trial_id in mapped:
            raise EvidenceError(f"duplicate trial result: {result.spec.trial_id}")
        mapped[result.spec.trial_id] = result
    return mapped


def select_champion(base: Mapping[str, TrialResult], stress: Mapping[str, TrialResult]) -> str:
    if set(base) != set(stress) or not base:
        raise EvidenceError("base/stress trial families differ")
    return min(
        base,
        key=lambda trial_id: (
            -stress[trial_id].net_usd_per_1000,
            -base[trial_id].net_usd_per_1000,
            trial_id,
        ),
    )


def bool_field(mapping: Mapping[str, object], key: str) -> bool:
    value = mapping.get(key)
    if not isinstance(value, bool):
        raise EvidenceError(f"required boolean missing: {key}")
    return value


def holdout_statistics(
    result: TrialResult,
    *,
    replicates: int,
    block_length: int,
    seed: int,
) -> dict[str, object]:
    values = tuple(cluster.decomposition.net for cluster in result.clusters)
    draws = circular_draws(len(values), replicates=replicates, block_length=block_length, seed=seed)
    lower, upper = bootstrap_interval(
        values,
        draws=draws,
        lower_probability=D("0.025"),
        upper_probability=D("0.975"),
    )
    return {
        "replicates": replicates,
        "blockLengthClusters": block_length,
        "totalNetUsdPer1000Gross": decimal_text(result.net_usd_per_1000),
        "meanClusterNetUsdPer1000Gross": decimal_text(result.net_usd_per_1000 / D(len(values))),
        "lower95NetUsdPer1000Gross": decimal_text(lower),
        "upper95NetUsdPer1000Gross": decimal_text(upper),
        "lower95Positive": lower > 0,
    }


def public_gates(
    *,
    dev_base: TrialResult,
    dev_stress: TrialResult,
    holdout_base: TrialResult,
    holdout_stress: TrialResult,
    combined_stress: TrialResult,
    development_stats: Mapping[str, object],
    pbo: Mapping[str, object],
    holdout_base_stats: Mapping[str, object],
    holdout_stress_stats: Mapping[str, object],
    minimum_capacity_required: Decimal,
    maximum_drawdown_pct: Decimal,
) -> dict[str, bool]:
    capacities = (
        dev_base.minimum_capacity_usd,
        dev_stress.minimum_capacity_usd,
        holdout_base.minimum_capacity_usd,
        holdout_stress.minimum_capacity_usd,
    )
    capacity_pass = all(
        value is not None and value >= minimum_capacity_required for value in capacities
    )
    return {
        "developmentBaseNetPositive": dev_base.net_usd_per_1000 > 0,
        "developmentStressNetPositive": dev_stress.net_usd_per_1000 > 0,
        "developmentStressBonferroniLowerPositive": bool_field(
            development_stats, "championBonferroniLowerPositive"
        ),
        "developmentHolmPass": bool_field(development_stats, "championHolmPass"),
        "developmentMaxTRealityCheckPass": bool_field(
            development_stats, "centeredMaxTRealityCheckPass"
        ),
        "pboAtMost0_50": bool_field(pbo, "passesMaximum0_50"),
        "holdoutBaseNetPositive": holdout_base.net_usd_per_1000 > 0,
        "holdoutStressNetPositive": holdout_stress.net_usd_per_1000 > 0,
        "holdoutBaseLower95Positive": bool_field(holdout_base_stats, "lower95Positive"),
        "holdoutStressLower95Positive": bool_field(holdout_stress_stats, "lower95Positive"),
        "stressMaximumDrawdownAtMost40Pct": (
            combined_stress.maximum_drawdown_pct <= maximum_drawdown_pct
        ),
        "public20BpsCapacityAtLeast1000Usd": capacity_pass,
    }


def terminal_unmeasured_result(
    *,
    reason: str,
    freeze_raw: bytes,
    acquisition_raw: bytes,
) -> dict[str, object]:
    return {
        "schema": "S1LResultV1",
        "protocolId": "s1l-binance-usdm-btc-eth-quarterly-perpetual-calendar-basis-v1",
        "verdict": "UNMEASURED",
        "status": "TERMINAL_ONE_RUN_CONSUMED",
        "reason": reason,
        "reasons": [reason],
        "netUsdPer1000Gross": None,
        "holdout": "NOT_ESTIMABLE",
        "pbo": None,
        "multiplicity": "NOT_ESTIMABLE",
        "drawdown": "NOT_ESTIMABLE",
        "capacity": "NOT_ESTIMABLE",
        "accountEffectiveFees": "UNKNOWN",
        "executionAuthority": "NONE",
        "freezeSha256": sha256_bytes(freeze_raw),
        "acquisitionSha256": sha256_bytes(acquisition_raw),
        "runMarkerSha256": sha256_path(RUN_MARKER_PATH),
        "candidateSealSha256": (sha256_path(CANDIDATE_PATH) if CANDIDATE_PATH.exists() else None),
        "holdoutOpenSha256": (
            sha256_path(HOLDOUT_MARKER_PATH) if HOLDOUT_MARKER_PATH.exists() else None
        ),
        "completedAtUtc": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
    }


def run_measured(
    *,
    protocol: Mapping[str, Any],
    plan: Mapping[str, Any],
    freeze_raw: bytes,
    acquisition_raw: bytes,
    acquisition_by_key: Mapping[str, Mapping[str, Any]],
    state_root: Path,
) -> dict[str, object]:
    trials = protocol_trials(protocol)
    pairs = protocol_pairs(protocol)
    base_scenario, stress_scenario = protocol_scenarios(protocol)
    _initial_capital, gross_usd, _gross_per_underlying = sizing_contract(protocol, pairs)
    development_deliveries = protocol_deliveries(protocol, "development")
    holdout_deliveries = protocol_deliveries(protocol, "holdout")
    dev_store = load_partition_store("development", plan, acquisition_by_key, state_root)
    development_base = result_by_id(
        evaluate_trial(
            trial=trial,
            scenario=base_scenario,
            deliveries=development_deliveries,
            store=dev_store,
            pairs=pairs,
            gross_usd=gross_usd,
        )
        for trial in trials
    )
    development_stress = result_by_id(
        evaluate_trial(
            trial=trial,
            scenario=stress_scenario,
            deliveries=development_deliveries,
            store=dev_store,
            pairs=pairs,
            gross_usd=gross_usd,
        )
        for trial in trials
    )
    champion_id = select_champion(development_base, development_stress)
    replicates = require_int(
        nested(protocol, "statistics", "bootstrap", "replicates"),
        field_name="bootstrap.replicates",
        minimum=100,
    )
    block_length = require_int(
        nested(protocol, "statistics", "bootstrap", "blockLengthClusters"),
        field_name="bootstrap.blockLengthClusters",
        minimum=1,
    )
    seed = require_int(
        nested(protocol, "statistics", "bootstrap", "seed"),
        field_name="bootstrap.seed",
        minimum=0,
    )
    development_stats = development_statistics(
        development_stress,
        champion_id,
        replicates=replicates,
        block_length=block_length,
        seed=seed,
        alpha=D("0.05"),
    )
    pbo = pbo_cscv(development_stress)
    candidate_payload = {
        "schema": "S1LCandidateSealV1",
        "status": "DEVELOPMENT_COMPLETE_CHAMPION_IMMUTABLE_BEFORE_HOLDOUT",
        "sealedAtUtc": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "freezeSha256": sha256_bytes(freeze_raw),
        "acquisitionSha256": sha256_bytes(acquisition_raw),
        "runMarkerSha256": sha256_path(RUN_MARKER_PATH),
        "championTrialId": champion_id,
        "selectionRule": nested(protocol, "trials", "championSelection"),
        "developmentBase": [
            development_base[trial_id].as_summary() for trial_id in sorted(development_base)
        ],
        "developmentStress": [
            development_stress[trial_id].as_summary() for trial_id in sorted(development_stress)
        ],
        "multiplicity": development_stats,
        "pbo": pbo,
    }
    exclusive_write(CANDIDATE_PATH, canonical_bytes(candidate_payload))
    holdout_keys = sorted(
        require_text(item.get("zipKey"), field_name="zipKey")
        for item in require_list(plan.get("objects"), field_name="plan.objects")
        if isinstance(item, dict) and item.get("partition") == "holdout"
    )
    holdout_marker = {
        "schema": "S1LHoldoutOpenV1",
        "status": "ONE_HOLDOUT_OPEN_GRANT_CONSUMED",
        "openedAtUtc": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "candidateSealSha256": sha256_path(CANDIDATE_PATH),
        "holdoutObjectKeysSha256": sha256_bytes(canonical_bytes(holdout_keys)),
        "holdoutObjectCount": len(holdout_keys),
    }
    exclusive_write(HOLDOUT_MARKER_PATH, canonical_bytes(holdout_marker))
    holdout_store = load_partition_store("holdout", plan, acquisition_by_key, state_root)
    champion = next(trial for trial in trials if trial.trial_id == champion_id)
    holdout_base = evaluate_trial(
        trial=champion,
        scenario=base_scenario,
        deliveries=holdout_deliveries,
        store=holdout_store,
        pairs=pairs,
        gross_usd=gross_usd,
    )
    holdout_stress = evaluate_trial(
        trial=champion,
        scenario=stress_scenario,
        deliveries=holdout_deliveries,
        store=holdout_store,
        pairs=pairs,
        gross_usd=gross_usd,
    )
    holdout_base_stats = holdout_statistics(
        holdout_base,
        replicates=replicates,
        block_length=block_length,
        seed=seed + 1,
    )
    holdout_stress_stats = holdout_statistics(
        holdout_stress,
        replicates=replicates,
        block_length=block_length,
        seed=seed + 1,
    )
    combined_base = trial_result_from_clusters(
        spec=champion,
        scenario=base_scenario,
        clusters=(
            *development_base[champion_id].clusters,
            *holdout_base.clusters,
        ),
        initial_capital=gross_usd,
    )
    combined_stress = trial_result_from_clusters(
        spec=champion,
        scenario=stress_scenario,
        clusters=(
            *development_stress[champion_id].clusters,
            *holdout_stress.clusters,
        ),
        initial_capital=gross_usd,
    )
    minimum_capacity = decimal_value(
        nested(protocol, "capacity", "minimumPublic20BpsGrossCapacityUsd"),
        field_name="minimumPublic20BpsGrossCapacityUsd",
        minimum=D(0),
    )
    maximum_drawdown = decimal_value(
        nested(protocol, "statistics", "drawdown", "stressMaximumPct"),
        field_name="stressMaximumPct",
        minimum=D(0),
    )
    gates = public_gates(
        dev_base=development_base[champion_id],
        dev_stress=development_stress[champion_id],
        holdout_base=holdout_base,
        holdout_stress=holdout_stress,
        combined_stress=combined_stress,
        development_stats=development_stats,
        pbo=pbo,
        holdout_base_stats=holdout_base_stats,
        holdout_stress_stats=holdout_stress_stats,
        minimum_capacity_required=minimum_capacity,
        maximum_drawdown_pct=maximum_drawdown,
    )
    public_pass = all(gates.values())
    account_gate = False
    verdict = "GO" if public_pass and account_gate else "NO_GO"
    failing_public_gates = sorted(key for key, value in gates.items() if not value)
    limitations = [
        "ACCOUNT_EFFECTIVE_FEES_UNKNOWN",
        "EXACT_TOP_OF_BOOK_SPREAD_QUEUE_POSITION_AND_REALIZED_IMPACT_UNKNOWN",
        "PUBLIC_20BPS_DEPTH_IS_COARSE_CAPACITY_PROXY_NOT_EXECUTABLE_ACCOUNT_CAPACITY",
        "FUNDING_MARK_USES_CONTEMPORANEOUS_1H_MARK_OPEN_PROXY",
        "HISTORICAL_EXCHANGE_INFO_FILTER_AND_STATUS_SNAPSHOTS_UNAVAILABLE",
        "INTRAHOUR_DRAWDOWN_MARGIN_LIQUIDATION_AND_COLLATERAL_PATH_UNKNOWN",
        "S1L_OUTSIDE_PRIOR_S_META1_REGISTRY_REQUIRES_SUCCESSOR_SCOREBOARD_INTEGRATION",
    ]
    reasons = ["ACCOUNT_EFFECTIVE_FEES_UNKNOWN"]
    reasons.extend(f"PUBLIC_GATE_FAILED:{value}" for value in failing_public_gates)
    reason = ";".join(reasons)
    return {
        "schema": "S1LResultV1",
        "protocolId": protocol["protocolId"],
        "verdict": verdict,
        "status": "TERMINAL_ONE_RUN_CONSUMED",
        "reason": reason,
        "reasons": reasons,
        "publicProxyCandidatePass": public_pass,
        "accountEffectiveFees": "UNKNOWN",
        "accountEffectiveGatePass": account_gate,
        "executionAuthority": "NONE",
        "consumer": nested(protocol, "consumer", "task"),
        "championTrial": champion.as_mapping(),
        "netUsdPer1000Gross": {
            "developmentBase": decimal_text(development_base[champion_id].net_usd_per_1000),
            "developmentStress": decimal_text(development_stress[champion_id].net_usd_per_1000),
            "holdoutBase": decimal_text(holdout_base.net_usd_per_1000),
            "holdoutStress": decimal_text(holdout_stress.net_usd_per_1000),
            "combinedBase": decimal_text(combined_base.net_usd_per_1000),
            "combinedStress": decimal_text(combined_stress.net_usd_per_1000),
        },
        "development": {
            "clusterCount": len(development_deliveries),
            "familyBase": [
                trial_full_mapping(development_base[trial_id])
                for trial_id in sorted(development_base)
            ],
            "familyStress": [
                trial_full_mapping(development_stress[trial_id])
                for trial_id in sorted(development_stress)
            ],
            "multiplicity": development_stats,
            "pbo": pbo,
        },
        "holdout": {
            "status": "OPENED_ONCE_AFTER_CANDIDATE_SEAL",
            "clusterCount": len(holdout_deliveries),
            "base": trial_full_mapping(holdout_base),
            "stress": trial_full_mapping(holdout_stress),
            "baseBootstrap": holdout_base_stats,
            "stressBootstrap": holdout_stress_stats,
        },
        "combined": {
            "base": trial_full_mapping(combined_base),
            "stress": trial_full_mapping(combined_stress),
        },
        "gates": {
            **gates,
            "accountEffectiveFeesProven": account_gate,
        },
        "drawdown": {
            "combinedBaseMaximumUsd": decimal_text(combined_base.maximum_drawdown_usd),
            "combinedBaseMaximumPct": decimal_text(combined_base.maximum_drawdown_pct),
            "combinedStressMaximumUsd": decimal_text(combined_stress.maximum_drawdown_usd),
            "combinedStressMaximumPct": decimal_text(combined_stress.maximum_drawdown_pct),
            "intrahourAndAccountLiquidation": "UNKNOWN",
        },
        "capacity": {
            "combinedMinimumPublic20BpsGrossUsd": optional_decimal_text(
                combined_stress.minimum_capacity_usd
            ),
            "combinedMedianPublic20BpsGrossUsd": optional_decimal_text(
                combined_stress.median_capacity_usd
            ),
            "requiredGrossUsd": decimal_text(minimum_capacity),
            "exactExecutableCapacity": "UNKNOWN",
        },
        "limitations": limitations,
        "freezeSha256": sha256_bytes(freeze_raw),
        "acquisitionSha256": sha256_bytes(acquisition_raw),
        "runMarkerSha256": sha256_path(RUN_MARKER_PATH),
        "candidateSealSha256": sha256_path(CANDIDATE_PATH),
        "holdoutOpenSha256": sha256_path(HOLDOUT_MARKER_PATH),
        "completedAtUtc": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
    }


def cmd_run(arguments: argparse.Namespace) -> None:
    if os.environ.get("PYTHONHASHSEED") != "0":
        raise EvidenceError("run requires PYTHONHASHSEED=0")
    if any(
        path.exists()
        for path in (RUN_MARKER_PATH, CANDIDATE_PATH, HOLDOUT_MARKER_PATH, RESULT_PATH)
    ):
        raise EvidenceError("run is create-once and has already been consumed")
    freeze, freeze_raw = verify_freeze()
    protocol, _ = load_json(PROTOCOL_PATH)
    plan, _ = load_json(PLAN_PATH)
    state_root = Path(arguments.state_root).resolve()
    _, acquisition_raw, acquisition_by_key = verified_acquisition(state_root, freeze, freeze_raw)
    run_marker = {
        "schema": "S1LRunMarkerV1",
        "status": "ONE_RUN_CONSUMED_BEFORE_FIRST_DECOMPRESSION",
        "startedAtUtc": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "freezeSha256": sha256_bytes(freeze_raw),
        "acquisitionSha256": sha256_bytes(acquisition_raw),
        "pythonHashSeed": "0",
        "pid": os.getpid(),
    }
    exclusive_write(RUN_MARKER_PATH, canonical_bytes(run_marker))
    try:
        result = run_measured(
            protocol=protocol,
            plan=plan,
            freeze_raw=freeze_raw,
            acquisition_raw=acquisition_raw,
            acquisition_by_key=acquisition_by_key,
            state_root=state_root,
        )
    except EvidenceError as error:
        result = terminal_unmeasured_result(
            reason=f"EVIDENCE_ERROR:{error}",
            freeze_raw=freeze_raw,
            acquisition_raw=acquisition_raw,
        )
    except Exception as error:
        result = terminal_unmeasured_result(
            reason=f"UNEXPECTED_EVALUATOR_FAILURE:{type(error).__name__}",
            freeze_raw=freeze_raw,
            acquisition_raw=acquisition_raw,
        )
    exclusive_write(RESULT_PATH, canonical_bytes(result))
    print(
        json.dumps(
            {
                "status": result["status"],
                "verdict": result["verdict"],
                "reason": result["reason"],
                "path": str(RESULT_PATH),
            },
            sort_keys=True,
        )
    )


def checksum_targets() -> tuple[Path, ...]:
    candidates = (
        HERE / "__init__.py",
        HERE / "README.md",
        HERE / "OFFICIAL_SOURCE_RESEARCH.md",
        HERE / "METHODOLOGY.md",
        PROTOCOL_PATH,
        PLAN_PATH,
        HERE / "experiment.py",
        HERE / "test_experiment.py",
        FREEZE_PATH,
        RUN_MARKER_PATH,
        CANDIDATE_PATH,
        HOLDOUT_MARKER_PATH,
        RESULT_PATH,
    )
    return tuple(path for path in candidates if path.exists())


def cmd_seal(_: argparse.Namespace) -> None:
    if not RESULT_PATH.exists():
        raise EvidenceError("result must exist before SHA256SUMS")
    lines = [f"{sha256_path(path)}  {path.name}" for path in sorted(checksum_targets())]
    exclusive_write(CHECKSUMS_PATH, ("\n".join(lines) + "\n").encode("ascii"))
    print(
        json.dumps(
            {
                "status": "SEALED",
                "files": len(lines),
                "path": str(CHECKSUMS_PATH),
            },
            sort_keys=True,
        )
    )


def verify_checksums() -> None:
    raw = safe_file(CHECKSUMS_PATH).read_text(encoding="ascii")
    seen: set[str] = set()
    for line in raw.splitlines():
        match = re.fullmatch(r"([0-9a-f]{64})  ([A-Za-z0-9_.-]+)", line)
        if match is None:
            raise EvidenceError("SHA256SUMS line format invalid")
        expected, name = match.groups()
        if name in seen:
            raise EvidenceError(f"duplicate SHA256SUMS entry: {name}")
        seen.add(name)
        if sha256_path(HERE / name) != expected:
            raise EvidenceError(f"SHA256SUMS mismatch: {name}")
    expected_names = {path.name for path in checksum_targets()}
    if seen != expected_names:
        raise EvidenceError("SHA256SUMS target set mismatch")


def cmd_report(_: argparse.Namespace) -> None:
    verify_checksums()
    freeze, freeze_raw = verify_freeze()
    result, _result_raw = load_json(RESULT_PATH)
    if result.get("freezeSha256") != sha256_bytes(freeze_raw):
        raise EvidenceError("result does not bind current freeze")
    if result.get("runMarkerSha256") != sha256_path(RUN_MARKER_PATH):
        raise EvidenceError("result does not bind current run marker")
    if result.get("verdict") != "UNMEASURED":
        if result.get("candidateSealSha256") != sha256_path(CANDIDATE_PATH):
            raise EvidenceError("result does not bind candidate seal")
        if result.get("holdoutOpenSha256") != sha256_path(HOLDOUT_MARKER_PATH):
            raise EvidenceError("result does not bind holdout marker")
    summary = {
        "protocolId": freeze["protocolId"],
        "verdict": result["verdict"],
        "reason": result["reason"],
        "netUsdPer1000Gross": result.get("netUsdPer1000Gross"),
        "holdout": result.get("holdout"),
        "pbo": (
            nested(result, "development", "pbo", "pbo")
            if result.get("verdict") != "UNMEASURED"
            else None
        ),
        "drawdown": result.get("drawdown"),
        "capacity": result.get("capacity"),
        "accountEffectiveFees": result.get("accountEffectiveFees"),
        "executionAuthority": result.get("executionAuthority"),
        "authentication": "NETWORK_FREE_SHA256_PASS",
    }
    print(json.dumps(summary, sort_keys=True, indent=2))


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(description=__doc__)
    value.add_argument(
        "--state-root",
        default=str(DEFAULT_STATE_ROOT),
        help="external discovery/acquisition/cache directory",
    )
    subparsers = value.add_subparsers(dest="command", required=True)
    subparsers.add_parser("plan").set_defaults(func=cmd_plan)
    subparsers.add_parser("discover").set_defaults(func=cmd_discover)
    subparsers.add_parser("freeze").set_defaults(func=cmd_freeze)
    subparsers.add_parser("acquire").set_defaults(func=cmd_acquire)
    subparsers.add_parser("run").set_defaults(func=cmd_run)
    subparsers.add_parser("seal").set_defaults(func=cmd_seal)
    subparsers.add_parser("report").set_defaults(func=cmd_report)
    return value


def main(argv: Sequence[str] | None = None) -> int:
    arguments = parser().parse_args(argv)
    try:
        cast(Any, arguments.func)(arguments)
    except EvidenceError as error:
        print(f"S1L_EVIDENCE_ERROR: {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
