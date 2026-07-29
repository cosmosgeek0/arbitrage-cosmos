"""Sealed public S-1K COIN-M versus USD-M relative funding/basis experiment.

``discover`` may read public metadata and checksum sidecars, but never archive
bodies. ``freeze`` binds the complete evaluator before ``acquire`` obtains ZIP
bytes without decompression. ``run`` is network-free, creates an exclusive
marker before the first archive open, seals development before the one holdout
open, and refuses every second run.
"""

from __future__ import annotations

import argparse
import base64
import concurrent.futures
import csv
import hashlib
import io
import itertools
import json
import os
import random
import shutil
import statistics
import subprocess
import sys
import urllib.error
import urllib.request
import zipfile
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal, InvalidOperation, getcontext
from pathlib import Path
from typing import Any, Final, TypeVar, cast

getcontext().prec = 50

D = Decimal
T = TypeVar("T")
HERE: Final = Path(__file__).resolve().parent
PROTOCOL_PATH: Final = HERE / "protocol.v1.json"
RESEARCH_PATH: Final = HERE / "OFFICIAL_SOURCE_RESEARCH.md"
README_PATH: Final = HERE / "README.md"
TEST_PATH: Final = HERE / "test_experiment.py"
FREEZE_PATH: Final = HERE / "freeze.v1.json"
RESULT_PATH: Final = HERE / "result.v1.json"
DEFAULT_STATE_ROOT: Final = Path("/private/tmp/cosmos-s1k-coinm-usdm-relative-v1-019fae87")
ARCHIVE_BASE: Final = "https://data.binance.vision"
USER_AGENT: Final = "cosmos-s1k-public-research/1.0"
HOUR_MS: Final = 3_600_000
DAY_MS: Final = 86_400_000
FACE_USD: Final = D("1000")
MAKER_FEE_BPS: Final = D("2")
MAKER_ADVERSE_BPS: Final = D("1")
STRESS_FEE_BPS: Final = D("5")
STRESS_ADVERSE_BPS: Final = D("10")
MAX_MEMBER_BYTES: Final = 64 * 1024 * 1024


class EvidenceError(RuntimeError):
    """A fail-closed custody, lifecycle, schema, or measurement error."""


@dataclass(frozen=True, slots=True)
class PairSpec:
    underlying: str
    coin_symbol: str
    usd_symbol: str


@dataclass(frozen=True, slots=True)
class TrialSpec:
    trial_id: str
    threshold: Decimal
    basis_mode: str
    hold_hours: int

    def as_mapping(self) -> dict[str, object]:
        return {
            "trialId": self.trial_id,
            "fundingThreshold": decimal_text(self.threshold),
            "basisMode": self.basis_mode,
            "holdHours": self.hold_hours,
        }


@dataclass(frozen=True, slots=True)
class Bar:
    timestamp_ms: int
    open: Decimal
    close: Decimal
    auxiliary_volume: Decimal


@dataclass(frozen=True, slots=True)
class FundingEvent:
    timestamp_ms: int
    interval_hours: int
    rate: Decimal


@dataclass(slots=True)
class PairSeries:
    coin_trade: dict[int, Bar]
    coin_mark: dict[int, Bar]
    coin_funding: list[FundingEvent]
    usd_trade: dict[int, Bar]
    usd_mark: dict[int, Bar]
    usd_funding: list[FundingEvent]


@dataclass(frozen=True, slots=True)
class EntryCandidate:
    pair: PairSpec
    direction: int
    relative_funding: Decimal
    relative_basis: Decimal
    capacity_usd: Decimal
    coin_entry: Decimal
    usd_entry: Decimal


@dataclass(frozen=True, slots=True)
class CompletedCandidate:
    entry: EntryCandidate
    coin_exit: Decimal
    usd_exit: Decimal
    hold_funding_pnl_usd: Decimal


@dataclass(frozen=True, slots=True)
class CohortResult:
    entry_ms: int
    selected: str | None
    gross_usd: Decimal
    maker_net_usd: Decimal
    stress_net_usd: Decimal
    fee_maker_usd: Decimal
    adverse_maker_usd: Decimal
    fee_stress_usd: Decimal
    adverse_stress_usd: Decimal
    capacity_usd: Decimal | None

    @property
    def traded(self) -> bool:
        return self.selected is not None


@dataclass(frozen=True, slots=True)
class ScenarioResult:
    net_usd: Decimal
    fee_usd: Decimal
    adverse_execution_usd: Decimal


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
        raise EvidenceError(f"regular file missing: {path}")
    return path


def sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with safe_file(path).open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def load_json(path: Path) -> tuple[dict[str, Any], bytes]:
    raw = safe_file(path).read_bytes()
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as error:
        raise EvidenceError(f"invalid JSON: {path}") from error
    if not isinstance(value, dict):
        raise EvidenceError(f"JSON root must be an object: {path}")
    return cast(dict[str, Any], value), raw


def load_protocol() -> tuple[dict[str, Any], bytes]:
    return load_json(PROTOCOL_PATH)


def decimal_value(value: object, *, field: str) -> Decimal:
    if isinstance(value, bool) or not isinstance(value, (str, int)):
        raise EvidenceError(f"{field} must be an exact decimal")
    try:
        parsed = D(str(value))
    except InvalidOperation as error:
        raise EvidenceError(f"{field} is not a decimal") from error
    if not parsed.is_finite():
        raise EvidenceError(f"{field} must be finite")
    return parsed


def decimal_text(value: Decimal) -> str:
    if not value.is_finite():
        raise EvidenceError("cannot serialize a non-finite decimal")
    if value == 0:
        return "0"
    return format(value.normalize(), "f")


def quantile(values: Sequence[Decimal], probability: Decimal) -> Decimal:
    if not values:
        raise EvidenceError("quantile of empty sequence")
    if probability < 0 or probability > 1:
        raise EvidenceError("quantile probability outside [0,1]")
    ordered = sorted(values)
    index = min(len(ordered) - 1, int(probability * len(ordered)))
    return ordered[index]


def mean(values: Sequence[Decimal]) -> Decimal:
    if not values:
        raise EvidenceError("mean of empty sequence")
    return sum(values, D(0)) / D(len(values))


def iso_now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def parse_utc(value: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise EvidenceError(f"invalid UTC timestamp: {value}") from error
    if parsed.tzinfo != UTC:
        parsed = parsed.astimezone(UTC)
    return parsed


def timestamp_ms(value: str) -> int:
    return int(parse_utc(value).timestamp() * 1000)


def atomic_write(path: Path, raw: bytes, *, exclusive: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_symlink():
        raise EvidenceError(f"symlink target refused: {path}")
    if exclusive:
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
        try:
            descriptor = os.open(path, flags, 0o600)
        except FileExistsError as error:
            raise EvidenceError(f"exclusive path already exists: {path}") from error
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        return
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    if temporary.exists() or temporary.is_symlink():
        raise EvidenceError(f"temporary path already exists: {temporary}")
    with temporary.open("xb") as handle:
        handle.write(raw)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)


def pairs(protocol: Mapping[str, Any]) -> tuple[PairSpec, ...]:
    raw_pairs = protocol.get("matchedUnderlyings")
    if not isinstance(raw_pairs, list) or not raw_pairs:
        raise EvidenceError("matchedUnderlyings must be a nonempty list")
    parsed: list[PairSpec] = []
    for raw in raw_pairs:
        if not isinstance(raw, dict):
            raise EvidenceError("matched-underlying row must be an object")
        underlying = raw.get("underlying")
        coin_symbol = raw.get("coinMSymbol")
        usd_symbol = raw.get("usdMSymbol")
        if not all(
            isinstance(item, str) and item for item in (underlying, coin_symbol, usd_symbol)
        ):
            raise EvidenceError("invalid matched-underlying identity")
        parsed.append(
            PairSpec(
                cast(str, underlying),
                cast(str, coin_symbol),
                cast(str, usd_symbol),
            )
        )
    if len({item.underlying for item in parsed}) != len(parsed):
        raise EvidenceError("duplicate matched underlying")
    return tuple(parsed)


def month_range(first: str, last: str) -> tuple[str, ...]:
    try:
        cursor = date.fromisoformat(f"{first}-01")
        end = date.fromisoformat(f"{last}-01")
    except ValueError as error:
        raise EvidenceError("month range must use YYYY-MM") from error
    values: list[str] = []
    while cursor <= end:
        values.append(cursor.strftime("%Y-%m"))
        if cursor.month == 12:
            cursor = cursor.replace(year=cursor.year + 1, month=1)
        else:
            cursor = cursor.replace(month=cursor.month + 1)
    return tuple(values)


def trial_specs(protocol: Mapping[str, Any]) -> tuple[TrialSpec, ...]:
    signal = protocol.get("signal")
    if not isinstance(signal, dict):
        raise EvidenceError("signal object missing")
    thresholds = signal.get("fundingThresholds")
    modes = signal.get("basisModes")
    holds = signal.get("holdingHours")
    if (
        not isinstance(thresholds, list)
        or not isinstance(modes, list)
        or not isinstance(holds, list)
    ):
        raise EvidenceError("trial dimensions missing")
    trials: list[TrialSpec] = []
    for threshold_raw, mode_raw, hold_raw in itertools.product(thresholds, modes, holds):
        threshold = decimal_value(threshold_raw, field="fundingThreshold")
        if not isinstance(mode_raw, str) or mode_raw not in {"NONE", "MEAN_REVERSION"}:
            raise EvidenceError("unknown basis mode")
        if isinstance(hold_raw, bool) or not isinstance(hold_raw, int) or hold_raw <= 0:
            raise EvidenceError("holding hour must be positive integer")
        threshold_label = int(threshold * D(100_000))
        mode_label = "MR" if mode_raw == "MEAN_REVERSION" else "NONE"
        trial_id = f"F{threshold_label:05d}_BASIS_{mode_label}_H{hold_raw:03d}"
        trials.append(TrialSpec(trial_id, threshold, mode_raw, hold_raw))
    expected = signal.get("familySize")
    if expected != len(trials):
        raise EvidenceError("frozen family size mismatch")
    return tuple(trials)


def archive_relative(product: str, dataset: str, symbol: str, month: str) -> str:
    if product not in {"um", "cm"}:
        raise EvidenceError("unknown futures product")
    prefix = f"data/futures/{product}/monthly"
    if dataset == "fundingRate":
        return f"{prefix}/fundingRate/{symbol}/{symbol}-fundingRate-{month}.zip"
    if dataset in {"klines", "markPriceKlines"}:
        return f"{prefix}/{dataset}/{symbol}/1h/{symbol}-1h-{month}.zip"
    raise EvidenceError("unknown archive dataset")


def fetch_bytes(url: str, *, attempts: int = 4) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                return cast(bytes, response.read())
        except (urllib.error.URLError, TimeoutError) as error:
            if attempt + 1 == attempts:
                raise EvidenceError(f"public fetch failed: {url}") from error
            delay = 0.5 * (2**attempt)
            import time

            time.sleep(delay)
    raise EvidenceError(f"public fetch failed: {url}")


def fetch_json(url: str) -> tuple[object, bytes]:
    raw = fetch_bytes(url)
    try:
        return json.loads(raw), raw
    except json.JSONDecodeError as error:
        raise EvidenceError(f"public metadata is not JSON: {url}") from error


def parse_checksum(raw: bytes, expected_name: str) -> str:
    try:
        text = raw.decode("ascii").strip()
    except UnicodeDecodeError as error:
        raise EvidenceError("checksum sidecar is not ASCII") from error
    parts = text.split()
    if len(parts) != 2 or parts[1].lstrip("*") != expected_name:
        raise EvidenceError(f"checksum sidecar filename mismatch: {expected_name}")
    digest = parts[0].lower()
    if len(digest) != 64 or any(character not in "0123456789abcdef" for character in digest):
        raise EvidenceError("checksum sidecar digest is invalid")
    return digest


def compact_exchange_info(
    raw: object, selected_pairs: Sequence[PairSpec], product: str
) -> dict[str, object]:
    if not isinstance(raw, dict) or not isinstance(raw.get("symbols"), list):
        raise EvidenceError(f"{product} exchangeInfo schema mismatch")
    wanted = {item.usd_symbol if product == "um" else item.coin_symbol for item in selected_pairs}
    selected: list[dict[str, object]] = []
    for item in raw["symbols"]:
        if not isinstance(item, dict) or item.get("symbol") not in wanted:
            continue
        filters = item.get("filters")
        selected.append(
            {
                "symbol": item.get("symbol"),
                "pair": item.get("pair"),
                "baseAsset": item.get("baseAsset"),
                "quoteAsset": item.get("quoteAsset"),
                "marginAsset": item.get("marginAsset"),
                "contractType": item.get("contractType"),
                "status": item.get("status", item.get("contractStatus")),
                "contractSize": item.get("contractSize"),
                "filters": filters,
            }
        )
    if {item.get("symbol") for item in selected} != wanted:
        raise EvidenceError(f"{product} current metadata missing a frozen symbol")
    by_symbol = {cast(str, item["symbol"]): item for item in selected}
    for pair in selected_pairs:
        symbol = pair.usd_symbol if product == "um" else pair.coin_symbol
        item = by_symbol[symbol]
        if item.get("baseAsset") != pair.underlying:
            raise EvidenceError(f"{product} base-asset identity mismatch: {symbol}")
        if item.get("contractType") != "PERPETUAL" or item.get("status") != "TRADING":
            raise EvidenceError(f"{product} current perpetual status mismatch: {symbol}")
        if not isinstance(item.get("filters"), list):
            raise EvidenceError(f"{product} current filters missing: {symbol}")
        if product == "um":
            if item.get("quoteAsset") != "USDT" or item.get("marginAsset") != "USDT":
                raise EvidenceError(f"USD-M asset identity mismatch: {symbol}")
        else:
            contract_size = item.get("contractSize")
            if (
                item.get("quoteAsset") != "USD"
                or item.get("marginAsset") != pair.underlying
                or isinstance(contract_size, bool)
                or not isinstance(contract_size, (int, float))
                or contract_size <= 0
            ):
                raise EvidenceError(f"COIN-M contract identity mismatch: {symbol}")
    return {"serverTime": raw.get("serverTime"), "symbols": selected}


def compact_tickers(
    raw: object, selected_pairs: Sequence[PairSpec], product: str
) -> list[dict[str, object]]:
    if not isinstance(raw, list):
        raise EvidenceError(f"{product} ticker schema mismatch")
    wanted = {item.usd_symbol if product == "um" else item.coin_symbol for item in selected_pairs}
    selected: list[dict[str, object]] = []
    for item in raw:
        if not isinstance(item, dict) or item.get("symbol") not in wanted:
            continue
        selected.append(
            {
                "symbol": item.get("symbol"),
                "volume": item.get("volume"),
                "quoteVolume": item.get("quoteVolume"),
                "baseVolume": item.get("baseVolume"),
                "lastPrice": item.get("lastPrice"),
                "closeTime": item.get("closeTime"),
            }
        )
    if {item.get("symbol") for item in selected} != wanted:
        raise EvidenceError(f"{product} current ticker missing a frozen symbol")
    return selected


def compact_funding_info(
    raw: object, selected_pairs: Sequence[PairSpec], product: str
) -> list[dict[str, object]]:
    if not isinstance(raw, list):
        raise EvidenceError(f"{product} fundingInfo schema mismatch")
    wanted = {item.usd_symbol if product == "um" else item.coin_symbol for item in selected_pairs}
    selected: list[dict[str, object]] = []
    for item in raw:
        if isinstance(item, dict) and item.get("symbol") in wanted:
            selected.append(cast(dict[str, object], item))
    return selected


def discovery_archive_row(
    product: str,
    dataset: str,
    symbol: str,
    month: str,
    shared_root: Path,
) -> dict[str, object]:
    relative = archive_relative(product, dataset, symbol, month)
    name = Path(relative).name
    checksum_url = f"{ARCHIVE_BASE}/{relative}.CHECKSUM"
    if product == "um":
        checksum_path = shared_root / f"{relative}.CHECKSUM"
        zip_path = shared_root / relative
        checksum_raw = safe_file(checksum_path).read_bytes()
        zip_stat = safe_file(zip_path).stat()
        source = "SHARED_READ_ONLY"
        declared_size: int | None = zip_stat.st_size
    else:
        checksum_raw = fetch_bytes(checksum_url)
        source = "PUBLIC_DOWNLOAD_AFTER_FREEZE"
        declared_size = None
    return {
        "product": product,
        "dataset": dataset,
        "symbol": symbol,
        "month": month,
        "relativePath": relative,
        "url": f"{ARCHIVE_BASE}/{relative}",
        "checksumUrl": checksum_url,
        "checksumText": checksum_raw.decode("ascii"),
        "checksumSha256": sha256_bytes(checksum_raw),
        "expectedZipSha256": parse_checksum(checksum_raw, name),
        "declaredZipBytes": declared_size,
        "source": source,
    }


def command_discover(state_root: Path) -> None:
    protocol, _ = load_protocol()
    state_root.mkdir(parents=True, exist_ok=True)
    discovery_path = state_root / "discovery.v1.json"
    if discovery_path.exists() or discovery_path.is_symlink():
        raise EvidenceError("discovery already exists")
    if (state_root / "run-marker.v1.json").exists():
        raise EvidenceError("run marker already exists")

    selected_pairs = pairs(protocol)
    endpoints = {
        "umExchangeInfo": "https://fapi.binance.com/fapi/v1/exchangeInfo",
        "cmExchangeInfo": "https://dapi.binance.com/dapi/v1/exchangeInfo",
        "umTicker24h": "https://fapi.binance.com/fapi/v1/ticker/24hr",
        "cmTicker24h": "https://dapi.binance.com/dapi/v1/ticker/24hr",
        "umFundingInfo": "https://fapi.binance.com/fapi/v1/fundingInfo",
        "cmFundingInfo": "https://dapi.binance.com/dapi/v1/fundingInfo",
    }
    metadata: dict[str, object] = {}
    receipts: dict[str, object] = {}
    for name, url in endpoints.items():
        value, raw = fetch_json(url)
        receipts[name] = {
            "url": url,
            "retrievedAtUtc": iso_now(),
            "sha256": sha256_bytes(raw),
            "bytes": len(raw),
            "rawBodyBase64": base64.b64encode(raw).decode("ascii"),
        }
        if name == "umExchangeInfo":
            metadata[name] = compact_exchange_info(value, selected_pairs, "um")
        elif name == "cmExchangeInfo":
            metadata[name] = compact_exchange_info(value, selected_pairs, "cm")
        elif name == "umTicker24h":
            metadata[name] = compact_tickers(value, selected_pairs, "um")
        elif name == "cmTicker24h":
            metadata[name] = compact_tickers(value, selected_pairs, "cm")
        elif name == "umFundingInfo":
            metadata[name] = compact_funding_info(value, selected_pairs, "um")
        else:
            metadata[name] = compact_funding_info(value, selected_pairs, "cm")

    month_bounds = protocol.get("data")
    if not isinstance(month_bounds, dict):
        raise EvidenceError("data protocol object missing")
    months_raw = month_bounds.get("targetMonthsInclusive")
    shared_raw = month_bounds.get("sharedUsdMArchiveRoot")
    if (
        not isinstance(months_raw, list)
        or len(months_raw) != 2
        or not all(isinstance(item, str) for item in months_raw)
        or not isinstance(shared_raw, str)
    ):
        raise EvidenceError("data month or shared-root protocol invalid")
    months = month_range(cast(str, months_raw[0]), cast(str, months_raw[1]))
    shared_root = Path(shared_raw)
    requests: list[tuple[str, str, str, str, Path]] = []
    for pair in selected_pairs:
        for product, symbol in (("um", pair.usd_symbol), ("cm", pair.coin_symbol)):
            for dataset in ("fundingRate", "klines", "markPriceKlines"):
                for month in months:
                    requests.append((product, dataset, symbol, month, shared_root))

    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as executor:
        archives = list(executor.map(lambda args: discovery_archive_row(*args), requests))
    archives.sort(key=lambda row: cast(str, row["relativePath"]))

    discovery = {
        "schema": "S1KDiscoveryV1",
        "createdAtUtc": iso_now(),
        "archiveBodiesOpened": False,
        "protocolSha256": sha256_path(PROTOCOL_PATH),
        "metadataReceipts": receipts,
        "metadata": metadata,
        "archiveCount": len(archives),
        "archives": archives,
    }
    atomic_write(discovery_path, canonical_bytes(discovery), exclusive=True)
    print(json.dumps({"discovery": str(discovery_path), "archives": len(archives)}))


def frozen_input_paths() -> tuple[Path, ...]:
    return (PROTOCOL_PATH, Path(__file__).resolve(), TEST_PATH, RESEARCH_PATH, README_PATH)


def validate_discovery_inventory(
    protocol: Mapping[str, Any],
    discovery: Mapping[str, Any],
) -> None:
    if discovery.get("schema") != "S1KDiscoveryV1":
        raise EvidenceError("discovery schema mismatch")
    if discovery.get("archiveBodiesOpened") is not False:
        raise EvidenceError("discovery does not prove unopened archive bodies")
    if discovery.get("protocolSha256") != sha256_path(PROTOCOL_PATH):
        raise EvidenceError("discovery protocol binding mismatch")
    data = protocol.get("data")
    archives = discovery.get("archives")
    metadata = discovery.get("metadata")
    if (
        not isinstance(data, dict)
        or not isinstance(archives, list)
        or not isinstance(metadata, dict)
    ):
        raise EvidenceError("discovery inventory missing")
    selected_pairs = pairs(protocol)
    receipt_urls = {
        "umExchangeInfo": "https://fapi.binance.com/fapi/v1/exchangeInfo",
        "cmExchangeInfo": "https://dapi.binance.com/dapi/v1/exchangeInfo",
        "umTicker24h": "https://fapi.binance.com/fapi/v1/ticker/24hr",
        "cmTicker24h": "https://dapi.binance.com/dapi/v1/ticker/24hr",
        "umFundingInfo": "https://fapi.binance.com/fapi/v1/fundingInfo",
        "cmFundingInfo": "https://dapi.binance.com/dapi/v1/fundingInfo",
    }
    receipts = discovery.get("metadataReceipts")
    if not isinstance(receipts, dict) or set(receipts) != set(receipt_urls):
        raise EvidenceError("discovery metadata receipt set mismatch")
    decoded_receipts: dict[str, object] = {}
    for name, expected_url in receipt_urls.items():
        receipt = receipts.get(name)
        if (
            not isinstance(receipt, dict)
            or receipt.get("url") != expected_url
            or not isinstance(receipt.get("sha256"), str)
            or len(cast(str, receipt["sha256"])) != 64
            or isinstance(receipt.get("bytes"), bool)
            or not isinstance(receipt.get("bytes"), int)
            or cast(int, receipt["bytes"]) <= 0
            or not isinstance(receipt.get("retrievedAtUtc"), str)
            or not isinstance(receipt.get("rawBodyBase64"), str)
        ):
            raise EvidenceError(f"discovery metadata receipt invalid: {name}")
        try:
            raw_body = base64.b64decode(
                cast(str, receipt["rawBodyBase64"]),
                validate=True,
            )
            decoded = json.loads(raw_body)
        except (ValueError, json.JSONDecodeError) as error:
            raise EvidenceError(f"discovery metadata body invalid: {name}") from error
        if len(raw_body) != receipt["bytes"] or sha256_bytes(raw_body) != receipt["sha256"]:
            raise EvidenceError(f"discovery metadata body binding mismatch: {name}")
        decoded_receipts[name] = decoded
    recomputed_metadata = {
        "umExchangeInfo": compact_exchange_info(
            decoded_receipts["umExchangeInfo"], selected_pairs, "um"
        ),
        "cmExchangeInfo": compact_exchange_info(
            decoded_receipts["cmExchangeInfo"], selected_pairs, "cm"
        ),
        "umTicker24h": compact_tickers(decoded_receipts["umTicker24h"], selected_pairs, "um"),
        "cmTicker24h": compact_tickers(decoded_receipts["cmTicker24h"], selected_pairs, "cm"),
        "umFundingInfo": compact_funding_info(
            decoded_receipts["umFundingInfo"], selected_pairs, "um"
        ),
        "cmFundingInfo": compact_funding_info(
            decoded_receipts["cmFundingInfo"], selected_pairs, "cm"
        ),
    }
    if metadata != recomputed_metadata:
        raise EvidenceError("discovery compact metadata differs from raw receipts")
    month_bounds = data.get("targetMonthsInclusive")
    if (
        not isinstance(month_bounds, list)
        or len(month_bounds) != 2
        or not all(isinstance(item, str) for item in month_bounds)
    ):
        raise EvidenceError("frozen month bounds invalid")
    months = month_range(cast(str, month_bounds[0]), cast(str, month_bounds[1]))
    expected: dict[str, tuple[str, str, str, str]] = {}
    for pair in selected_pairs:
        for product, symbol in (("um", pair.usd_symbol), ("cm", pair.coin_symbol)):
            for dataset in ("fundingRate", "klines", "markPriceKlines"):
                for month in months:
                    relative = archive_relative(product, dataset, symbol, month)
                    expected[relative] = (product, dataset, symbol, month)
    found: set[str] = set()
    for row in archives:
        if not isinstance(row, dict) or not isinstance(row.get("relativePath"), str):
            raise EvidenceError("discovery archive row invalid")
        relative = cast(str, row["relativePath"])
        if relative in found:
            raise EvidenceError(f"duplicate discovery archive row: {relative}")
        found.add(relative)
        identity = expected.get(relative)
        if identity is None:
            raise EvidenceError(f"unexpected discovery archive row: {relative}")
        product, dataset, symbol, month = identity
        if (
            row.get("product") != product
            or row.get("dataset") != dataset
            or row.get("symbol") != symbol
            or row.get("month") != month
            or row.get("url") != f"{ARCHIVE_BASE}/{relative}"
            or row.get("checksumUrl") != f"{ARCHIVE_BASE}/{relative}.CHECKSUM"
        ):
            raise EvidenceError(f"discovery archive identity mismatch: {relative}")
        expected_digest = row.get("expectedZipSha256")
        checksum_text = row.get("checksumText")
        if not isinstance(expected_digest, str) or len(expected_digest) != 64:
            raise EvidenceError(f"discovery ZIP digest invalid: {relative}")
        if not isinstance(checksum_text, str):
            raise EvidenceError(f"discovery checksum text missing: {relative}")
        if parse_checksum(checksum_text.encode("ascii"), Path(relative).name) != expected_digest:
            raise EvidenceError(f"discovery checksum binding mismatch: {relative}")
        if row.get("checksumSha256") != sha256_bytes(checksum_text.encode("ascii")):
            raise EvidenceError(f"discovery checksum receipt mismatch: {relative}")
        required_source = (
            "SHARED_READ_ONLY"
            if relative.startswith("data/futures/um/")
            else "PUBLIC_DOWNLOAD_AFTER_FREEZE"
        )
        if row.get("source") != required_source:
            raise EvidenceError(f"discovery source classification mismatch: {relative}")
    if found != set(expected):
        raise EvidenceError("discovery Cartesian inventory mismatch")
    if discovery.get("archiveCount") != len(expected) or len(archives) != len(expected):
        raise EvidenceError("discovery archive count mismatch")


def command_freeze(state_root: Path) -> None:
    discovery_path = state_root / "discovery.v1.json"
    discovery, discovery_raw = load_json(discovery_path)
    protocol, _ = load_protocol()
    validate_discovery_inventory(protocol, discovery)
    if FREEZE_PATH.exists() or FREEZE_PATH.is_symlink():
        raise EvidenceError("freeze already exists")
    if (state_root / "acquisition.v1.json").exists() or (
        state_root / "run-marker.v1.json"
    ).exists():
        raise EvidenceError("freeze must precede acquisition and run")
    inputs = {
        str(path.relative_to(HERE)): {
            "sha256": sha256_path(path),
            "bytes": safe_file(path).stat().st_size,
        }
        for path in frozen_input_paths()
    }
    freeze = {
        "schema": "S1KFreezeV1",
        "frozenAtUtc": iso_now(),
        "canonicalBaseCommit": "a169b123fb186d1943a75ad648552c4d95be1be1",
        "archiveBodiesOpened": False,
        "discovery": {
            "path": str(discovery_path),
            "sha256": sha256_bytes(discovery_raw),
            "archiveCount": discovery.get("archiveCount"),
        },
        "frozenInputs": inputs,
        "requiredNextState": "COMMIT_FREEZE_BEFORE_ACQUIRE",
    }
    atomic_write(FREEZE_PATH, canonical_bytes(freeze), exclusive=True)
    print(json.dumps({"freeze": str(FREEZE_PATH), "sha256": sha256_path(FREEZE_PATH)}))


def repository_root() -> Path:
    return HERE.parents[2]


def git_output(arguments: Sequence[str]) -> bytes:
    completed = subprocess.run(
        ["git", "-C", str(repository_root()), *arguments],
        check=False,
        capture_output=True,
    )
    if completed.returncode != 0:
        raise EvidenceError(f"Git custody check failed: {' '.join(arguments)}")
    return completed.stdout


def committed_freeze(*, require_scope_clean: bool) -> str:
    relative = "quant/research/s1k/freeze.v1.json"
    commit = git_output(["log", "-1", "--format=%H", "--", relative]).decode().strip()
    if len(commit) != 40:
        raise EvidenceError("freeze commit is absent")
    committed = git_output(["show", f"{commit}:{relative}"])
    if committed != safe_file(FREEZE_PATH).read_bytes():
        raise EvidenceError("committed freeze differs from working freeze")
    lineage = git_output(["rev-list", "--parents", "-n", "1", commit]).decode().split()
    if lineage != [commit, "a169b123fb186d1943a75ad648552c4d95be1be1"]:
        raise EvidenceError("freeze commit is not a direct child of the exact canonical base")
    changed_paths = {
        path
        for path in git_output(["diff-tree", "--no-commit-id", "--name-only", "-r", commit])
        .decode()
        .splitlines()
        if path
    }
    if not changed_paths or any(
        not path.startswith("quant/research/s1k/") for path in changed_paths
    ):
        raise EvidenceError("freeze commit contains a path outside S-1K scope")
    if require_scope_clean:
        status = git_output(["status", "--porcelain", "--", "quant/research/s1k"])
        if status:
            raise EvidenceError("S-1K scope must be clean before acquisition")
        head = git_output(["rev-parse", "HEAD"]).decode().strip()
        if head != commit:
            raise EvidenceError("acquisition must start directly from the freeze commit")
    return commit


def verify_freeze(state_root: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    freeze, _ = load_json(FREEZE_PATH)
    discovery, discovery_raw = load_json(state_root / "discovery.v1.json")
    protocol, _ = load_protocol()
    validate_discovery_inventory(protocol, discovery)
    discovery_binding = freeze.get("discovery")
    frozen_inputs = freeze.get("frozenInputs")
    if not isinstance(discovery_binding, dict) or not isinstance(frozen_inputs, dict):
        raise EvidenceError("freeze bindings missing")
    if discovery_binding.get("sha256") != sha256_bytes(discovery_raw):
        raise EvidenceError("discovery changed after freeze")
    for path in frozen_input_paths():
        key = str(path.relative_to(HERE))
        binding = frozen_inputs.get(key)
        if not isinstance(binding, dict) or binding.get("sha256") != sha256_path(path):
            raise EvidenceError(f"frozen input changed: {key}")
    return freeze, discovery


def acquire_one(row: Mapping[str, Any], state_root: Path, shared_root: Path) -> dict[str, object]:
    relative_raw = row.get("relativePath")
    source = row.get("source")
    expected = row.get("expectedZipSha256")
    checksum_text = row.get("checksumText")
    url = row.get("url")
    if not all(
        isinstance(value, str) and value
        for value in (relative_raw, source, expected, checksum_text, url)
    ):
        raise EvidenceError("invalid discovery archive row")
    relative = cast(str, relative_raw)
    destination = state_root / "archives" / relative
    checksum_destination = Path(f"{destination}.CHECKSUM")
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        if destination.is_symlink() or sha256_path(destination) != expected:
            raise EvidenceError(f"existing archive cannot be resumed: {relative}")
    else:
        if source == "SHARED_READ_ONLY":
            source_path = shared_root / relative
            safe_file(source_path)
            temporary = destination.with_name(f".{destination.name}.{os.getpid()}.tmp")
            if temporary.exists() or temporary.is_symlink():
                raise EvidenceError(f"copy temporary already exists: {relative}")
            try:
                with source_path.open("rb") as source_handle, temporary.open("xb") as target:
                    shutil.copyfileobj(source_handle, target, length=1024 * 1024)
                    target.flush()
                    os.fsync(target.fileno())
                os.replace(temporary, destination)
            except Exception:
                temporary.unlink(missing_ok=True)
                raise
        elif source == "PUBLIC_DOWNLOAD_AFTER_FREEZE":
            raw = fetch_bytes(cast(str, url))
            atomic_write(destination, raw, exclusive=True)
        else:
            raise EvidenceError(f"unknown acquisition source: {source}")
    checksum_raw = cast(str, checksum_text).encode("ascii")
    if checksum_destination.exists():
        if (
            checksum_destination.is_symlink()
            or safe_file(checksum_destination).read_bytes() != checksum_raw
        ):
            raise EvidenceError(f"existing checksum cannot be resumed: {relative}")
    else:
        atomic_write(checksum_destination, checksum_raw, exclusive=True)
    actual = sha256_path(destination)
    if actual != expected:
        raise EvidenceError(f"ZIP checksum mismatch: {relative}")
    return {
        "relativePath": relative,
        "source": source,
        "zipSha256": actual,
        "zipBytes": destination.stat().st_size,
        "checksumSha256": sha256_path(checksum_destination),
    }


def command_acquire(state_root: Path) -> None:
    _, discovery = verify_freeze(state_root)
    freeze_commit = committed_freeze(require_scope_clean=True)
    acquisition_path = state_root / "acquisition.v1.json"
    if acquisition_path.exists() or acquisition_path.is_symlink():
        raise EvidenceError("acquisition already exists")
    if (state_root / "run-marker.v1.json").exists():
        raise EvidenceError("acquisition must precede run")
    protocol, _ = load_protocol()
    data = protocol.get("data")
    archives = discovery.get("archives")
    if not isinstance(data, dict) or not isinstance(data.get("sharedUsdMArchiveRoot"), str):
        raise EvidenceError("shared archive root missing")
    if not isinstance(archives, list):
        raise EvidenceError("discovery archive inventory missing")
    shared_root = Path(cast(str, data["sharedUsdMArchiveRoot"]))
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
        futures = [
            executor.submit(acquire_one, cast(Mapping[str, Any], row), state_root, shared_root)
            for row in archives
            if isinstance(row, dict)
        ]
        acquired = [future.result() for future in futures]
    if len(acquired) != len(archives):
        raise EvidenceError("acquisition inventory count mismatch")
    acquired.sort(key=lambda row: cast(str, row["relativePath"]))
    acquisition = {
        "schema": "S1KAcquisitionV1",
        "createdAtUtc": iso_now(),
        "freezeSha256": sha256_path(FREEZE_PATH),
        "freezeCommit": freeze_commit,
        "discoverySha256": sha256_path(state_root / "discovery.v1.json"),
        "archiveBodiesOpened": False,
        "archiveCount": len(acquired),
        "archives": acquired,
    }
    atomic_write(acquisition_path, canonical_bytes(acquisition), exclusive=True)
    print(json.dumps({"acquisition": str(acquisition_path), "archives": len(acquired)}))


def acquisition_index(state_root: Path) -> dict[str, dict[str, Any]]:
    _, discovery = verify_freeze(state_root)
    acquisition, _ = load_json(state_root / "acquisition.v1.json")
    if acquisition.get("archiveBodiesOpened") is not False:
        raise EvidenceError("acquisition archive-open flag invalid")
    if acquisition.get("freezeSha256") != sha256_path(FREEZE_PATH):
        raise EvidenceError("acquisition freeze binding mismatch")
    if acquisition.get("freezeCommit") != committed_freeze(require_scope_clean=False):
        raise EvidenceError("acquisition freeze-commit binding mismatch")
    acquired = acquisition.get("archives")
    discovered = discovery.get("archives")
    if not isinstance(acquired, list) or not isinstance(discovered, list):
        raise EvidenceError("archive manifests missing")
    if acquisition.get("archiveCount") != len(acquired) or len(acquired) != len(discovered):
        raise EvidenceError("acquisition archive count mismatch")
    discovered_by_path = {
        cast(str, row["relativePath"]): cast(dict[str, Any], row)
        for row in discovered
        if isinstance(row, dict) and isinstance(row.get("relativePath"), str)
    }
    indexed: dict[str, dict[str, Any]] = {}
    for row in acquired:
        if not isinstance(row, dict) or not isinstance(row.get("relativePath"), str):
            raise EvidenceError("bad acquisition row")
        relative = cast(str, row["relativePath"])
        path = state_root / "archives" / relative
        checksum_path = Path(f"{path}.CHECKSUM")
        if row.get("zipSha256") != sha256_path(path):
            raise EvidenceError(f"acquired archive changed: {relative}")
        discovered_row = discovered_by_path.get(relative)
        if discovered_row is None or discovered_row.get("expectedZipSha256") != row.get(
            "zipSha256"
        ):
            raise EvidenceError(f"archive discovery binding mismatch: {relative}")
        if row.get("checksumSha256") != sha256_path(checksum_path) or discovered_row.get(
            "checksumSha256"
        ) != row.get("checksumSha256"):
            raise EvidenceError(f"acquired checksum changed: {relative}")
        indexed[relative] = cast(dict[str, Any], row)
    if len(indexed) != len(discovered_by_path):
        raise EvidenceError("acquisition is incomplete")
    return indexed


def normalize_epoch_ms(raw: str) -> int:
    try:
        value = int(raw)
    except ValueError as error:
        raise EvidenceError("timestamp is not integer") from error
    while value > 10_000_000_000_000:
        value //= 1000
    if value < 1_000_000_000_000:
        raise EvidenceError("timestamp is outside expected epoch range")
    return value


def csv_rows(raw: bytes) -> list[list[str]]:
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise EvidenceError("archive CSV is not UTF-8") from error
    rows = [row for row in csv.reader(io.StringIO(text)) if row]
    if not rows:
        raise EvidenceError("archive CSV is empty")
    return rows


def parse_kline_csv(raw: bytes) -> dict[int, Bar]:
    rows = csv_rows(raw)
    if rows[0][0].lower() in {"open_time", "opentime"}:
        rows = rows[1:]
    parsed: dict[int, Bar] = {}
    for row in rows:
        if len(row) < 8:
            raise EvidenceError("kline row has fewer than eight fields")
        stamp = normalize_epoch_ms(row[0])
        if stamp % HOUR_MS != 0:
            raise EvidenceError("1h kline is not hour-aligned")
        opened = decimal_value(row[1], field="kline.open")
        closed = decimal_value(row[4], field="kline.close")
        auxiliary = decimal_value(row[7], field="kline.auxiliaryVolume")
        if opened <= 0 or closed <= 0 or auxiliary < 0:
            raise EvidenceError("invalid kline price or volume")
        if stamp in parsed:
            raise EvidenceError("duplicate kline timestamp")
        parsed[stamp] = Bar(stamp, opened, closed, auxiliary)
    return parsed


def parse_funding_csv(raw: bytes) -> list[FundingEvent]:
    rows = csv_rows(raw)
    header: list[str] | None = None
    if not rows[0][0].lstrip("-").isdigit():
        header = [field.strip().lower() for field in rows.pop(0)]
    parsed: list[FundingEvent] = []
    for row in rows:
        if header is not None:
            lookup = {name: index for index, name in enumerate(header)}
            time_index = lookup.get("calc_time", lookup.get("fundingtime"))
            rate_index = lookup.get("last_funding_rate", lookup.get("fundingrate"))
            interval_index = lookup.get("funding_interval_hours")
            if time_index is None or rate_index is None or interval_index is None:
                raise EvidenceError("funding header lacks time, interval, or rate")
            stamp_raw = row[time_index]
            interval_raw = row[interval_index]
            rate_raw = row[rate_index]
        else:
            if len(row) < 3:
                raise EvidenceError("headerless funding row has fewer than three fields")
            stamp_raw, interval_raw, rate_raw = row[0], row[1], row[2]
        stamp = normalize_epoch_ms(stamp_raw)
        try:
            interval = int(interval_raw)
        except ValueError as error:
            raise EvidenceError("funding interval is not integer hours") from error
        rate = decimal_value(rate_raw, field="funding.rate")
        if interval <= 0 or interval > 24:
            raise EvidenceError("funding interval outside (0,24]")
        parsed.append(FundingEvent(stamp, interval, rate))
    parsed.sort(key=lambda event: event.timestamp_ms)
    if len({event.timestamp_ms for event in parsed}) != len(parsed):
        raise EvidenceError("duplicate funding timestamp")
    return parsed


def open_archive(path: Path, dataset: str) -> dict[int, Bar] | list[FundingEvent]:
    safe_file(path)
    try:
        with zipfile.ZipFile(path) as archive:
            members = [member for member in archive.infolist() if not member.is_dir()]
            if len(members) != 1:
                raise EvidenceError("archive must contain exactly one CSV")
            member = members[0]
            if Path(member.filename).name != member.filename or not member.filename.endswith(
                ".csv"
            ):
                raise EvidenceError("archive member path or extension invalid")
            if member.file_size > MAX_MEMBER_BYTES:
                raise EvidenceError("archive member exceeds frozen size ceiling")
            raw = archive.read(member)
    except zipfile.BadZipFile as error:
        raise EvidenceError(f"invalid ZIP: {path}") from error
    if dataset == "fundingRate":
        return parse_funding_csv(raw)
    return parse_kline_csv(raw)


def merge_bars(target: dict[int, Bar], incoming: Mapping[int, Bar]) -> None:
    overlap = target.keys() & incoming.keys()
    if overlap:
        raise EvidenceError("monthly kline overlap")
    target.update(incoming)


def merge_funding(target: list[FundingEvent], incoming: Sequence[FundingEvent]) -> None:
    existing = {event.timestamp_ms for event in target}
    if any(event.timestamp_ms in existing for event in incoming):
        raise EvidenceError("monthly funding overlap")
    target.extend(incoming)
    target.sort(key=lambda event: event.timestamp_ms)


def empty_pair_series() -> PairSeries:
    return PairSeries({}, {}, [], {}, {}, [])


def load_months(
    state_root: Path,
    selected_pairs: Sequence[PairSpec],
    months: Sequence[str],
) -> dict[str, PairSeries]:
    loaded = {pair.underlying: empty_pair_series() for pair in selected_pairs}
    for pair in selected_pairs:
        series = loaded[pair.underlying]
        for product, symbol in (("cm", pair.coin_symbol), ("um", pair.usd_symbol)):
            for dataset in ("fundingRate", "klines", "markPriceKlines"):
                for month in months:
                    relative = archive_relative(product, dataset, symbol, month)
                    parsed = open_archive(state_root / "archives" / relative, dataset)
                    if dataset == "fundingRate":
                        if not isinstance(parsed, list):
                            raise EvidenceError("funding parser returned wrong type")
                        target_funding = (
                            series.coin_funding if product == "cm" else series.usd_funding
                        )
                        merge_funding(target_funding, parsed)
                    else:
                        if not isinstance(parsed, dict):
                            raise EvidenceError("kline parser returned wrong type")
                        if product == "cm" and dataset == "klines":
                            target_bars = series.coin_trade
                        elif product == "cm":
                            target_bars = series.coin_mark
                        elif dataset == "klines":
                            target_bars = series.usd_trade
                        else:
                            target_bars = series.usd_mark
                        merge_bars(target_bars, parsed)
    return loaded


def merge_pair_windows(
    development: Mapping[str, PairSeries],
    holdout: Mapping[str, PairSeries],
) -> dict[str, PairSeries]:
    merged: dict[str, PairSeries] = {}
    for underlying, first in development.items():
        second = holdout.get(underlying)
        if second is None:
            raise EvidenceError("holdout pair missing")
        combined = empty_pair_series()
        for target, left, right in (
            (combined.coin_trade, first.coin_trade, second.coin_trade),
            (combined.coin_mark, first.coin_mark, second.coin_mark),
            (combined.usd_trade, first.usd_trade, second.usd_trade),
            (combined.usd_mark, first.usd_mark, second.usd_mark),
        ):
            merge_bars(target, left)
            merge_bars(target, right)
        merge_funding(combined.coin_funding, first.coin_funding)
        merge_funding(combined.coin_funding, second.coin_funding)
        merge_funding(combined.usd_funding, first.usd_funding)
        merge_funding(combined.usd_funding, second.usd_funding)
        merged[underlying] = combined
    return merged


def funding_sum(
    events: Sequence[FundingEvent],
    start_ms: int,
    end_ms: int,
    *,
    require_coverage: bool,
) -> Decimal:
    selected = funding_window(
        events,
        start_ms,
        end_ms,
        require_coverage=require_coverage,
    )
    return sum((event.rate for event in selected), D(0))


def funding_window(
    events: Sequence[FundingEvent],
    start_ms: int,
    end_ms: int,
    *,
    require_coverage: bool,
) -> tuple[FundingEvent, ...]:
    ordered = tuple(events)
    if any(
        current.timestamp_ms <= previous.timestamp_ms
        for previous, current in itertools.pairwise(ordered)
    ):
        raise EvidenceError("funding events are not strictly chronological")
    selected_indices = tuple(
        index for index, event in enumerate(ordered) if start_ms <= event.timestamp_ms < end_ms
    )
    selected = tuple(ordered[index] for index in selected_indices)
    if not selected:
        raise EvidenceError("funding interval has no events")
    if require_coverage:
        first_index = selected_indices[0]
        last_index = selected_indices[-1]
        contextual = list(selected)
        if first_index > 0:
            contextual.insert(0, ordered[first_index - 1])
        if last_index + 1 < len(ordered):
            contextual.append(ordered[last_index + 1])
        if len({event.interval_hours for event in contextual}) != 1:
            raise EvidenceError("funding interval transition is unmeasured")
        tolerance_ms = 60_000
        first = selected[0]
        if first.timestamp_ms - start_ms > first.interval_hours * HOUR_MS + tolerance_ms:
            raise EvidenceError("funding interval opening boundary is incomplete")
        for previous, current in itertools.pairwise(selected):
            gap = current.timestamp_ms - previous.timestamp_ms
            if gap <= 0 or gap > current.interval_hours * HOUR_MS + tolerance_ms:
                raise EvidenceError("funding interval has a missing middle event")
        last = selected[-1]
        if end_ms - last.timestamp_ms > last.interval_hours * HOUR_MS + tolerance_ms:
            raise EvidenceError("funding interval closing boundary is incomplete")
    return selected


def hold_funding_cashflow(
    series: PairSeries,
    entry_ms: int,
    exit_ms: int,
    direction: int,
    coin_entry: Decimal,
) -> Decimal:
    coin_events = funding_window(
        series.coin_funding,
        entry_ms,
        exit_ms,
        require_coverage=True,
    )
    usd_events = funding_window(
        series.usd_funding,
        entry_ms,
        exit_ms,
        require_coverage=True,
    )
    coin_cashflow = D(0)
    for event in coin_events:
        hour = event.timestamp_ms - event.timestamp_ms % HOUR_MS
        coin_mark = series.coin_mark.get(hour)
        usd_mark = series.usd_mark.get(hour)
        if coin_mark is None or usd_mark is None:
            raise EvidenceError("COIN-M funding event mark proxy missing")
        coin_cashflow -= D(direction) * FACE_USD * (usd_mark.open / coin_mark.open) * event.rate
    usd_quantity = FACE_USD / coin_entry
    usd_cashflow = D(0)
    for event in usd_events:
        hour = event.timestamp_ms - event.timestamp_ms % HOUR_MS
        usd_mark = series.usd_mark.get(hour)
        if usd_mark is None:
            raise EvidenceError("USD-M funding event mark proxy missing")
        usd_cashflow += D(direction) * usd_quantity * usd_mark.open * event.rate
    return coin_cashflow + usd_cashflow


def complete_daily_notional(
    bars: Mapping[int, Bar],
    day_value: date,
    *,
    coin_m: bool,
) -> Decimal:
    midnight = int(datetime.combine(day_value, datetime.min.time(), UTC).timestamp() * 1000)
    selected = [bars.get(midnight + offset * HOUR_MS) for offset in range(24)]
    if any(bar is None for bar in selected):
        raise EvidenceError("daily volume has an incomplete 24-hour grid")
    typed = cast(list[Bar], selected)
    if coin_m:
        return sum((bar.auxiliary_volume * bar.close for bar in typed), D(0))
    return sum((bar.auxiliary_volume for bar in typed), D(0))


def trailing_capacity(series: PairSeries, entry_ms: int) -> Decimal:
    entry_day = datetime.fromtimestamp(entry_ms / 1000, UTC).date()
    coin_days: list[Decimal] = []
    usd_days: list[Decimal] = []
    for offset in range(28, 0, -1):
        day_value = entry_day - timedelta(days=offset)
        coin_days.append(complete_daily_notional(series.coin_trade, day_value, coin_m=True))
        usd_days.append(complete_daily_notional(series.usd_trade, day_value, coin_m=False))
    coin_median = D(str(statistics.median(coin_days)))
    usd_median = D(str(statistics.median(usd_days)))
    if coin_median < D("50000000") or usd_median < D("50000000"):
        raise EvidenceError("pair is below the frozen liquidity floor")
    return min(coin_median, usd_median) * D("0.0001")


def entry_candidate_for(
    pair: PairSpec,
    series: PairSeries,
    entry_ms: int,
) -> EntryCandidate:
    signal_ms = entry_ms - HOUR_MS
    required = (
        series.coin_trade.get(signal_ms),
        series.coin_mark.get(signal_ms),
        series.usd_trade.get(signal_ms),
        series.usd_mark.get(signal_ms),
        series.coin_trade.get(entry_ms),
        series.usd_trade.get(entry_ms),
    )
    if any(bar is None for bar in required):
        raise EvidenceError(f"required causal entry bar missing: {pair.underlying}")
    (
        coin_signal,
        coin_mark,
        usd_signal,
        usd_mark,
        coin_entry_bar,
        usd_entry_bar,
    ) = cast(tuple[Bar, Bar, Bar, Bar, Bar, Bar], required)
    lookback_start = entry_ms - 168 * HOUR_MS
    prior_coin = funding_sum(series.coin_funding, lookback_start, entry_ms, require_coverage=True)
    prior_usd = funding_sum(series.usd_funding, lookback_start, entry_ms, require_coverage=True)
    relative_funding = prior_usd - prior_coin
    direction = 0 if relative_funding == 0 else 1 if relative_funding > 0 else -1
    relative_basis = (coin_signal.close / coin_mark.close).ln() - (
        usd_signal.close / usd_mark.close
    ).ln()
    return EntryCandidate(
        pair=pair,
        direction=direction,
        relative_funding=relative_funding,
        relative_basis=relative_basis,
        capacity_usd=trailing_capacity(series, entry_ms),
        coin_entry=coin_entry_bar.open,
        usd_entry=usd_entry_bar.open,
    )


def complete_candidate(
    entry: EntryCandidate,
    series: PairSeries,
    entry_ms: int,
    hold_hours: int,
) -> CompletedCandidate:
    exit_ms = entry_ms + hold_hours * HOUR_MS
    coin_exit = series.coin_trade.get(exit_ms)
    usd_exit = series.usd_trade.get(exit_ms)
    if coin_exit is None or usd_exit is None:
        raise EvidenceError(f"selected exit bar missing: {entry.pair.underlying}")
    funding_pnl = hold_funding_cashflow(
        series,
        entry_ms,
        exit_ms,
        entry.direction,
        entry.coin_entry,
    )
    return CompletedCandidate(
        entry=entry,
        coin_exit=coin_exit.open,
        usd_exit=usd_exit.open,
        hold_funding_pnl_usd=funding_pnl,
    )


def round_trip_cost(fee_bps: Decimal, adverse_bps: Decimal) -> tuple[Decimal, Decimal]:
    fee = D(4) * FACE_USD * fee_bps / D(10_000)
    adverse = D(4) * FACE_USD * adverse_bps / D(10_000)
    return fee, adverse


def scenario_result(
    candidate: CompletedCandidate,
    fee_bps: Decimal,
    adverse_bps: Decimal,
) -> ScenarioResult:
    entry = candidate.entry
    direction = entry.direction
    if direction not in {-1, 1}:
        raise EvidenceError("completed candidate direction must be -1 or 1")
    fee_rate = fee_bps / D(10_000)
    adverse_rate = adverse_bps / D(10_000)
    cm_entry = entry.coin_entry * (D(1) + D(direction) * adverse_rate)
    cm_exit = candidate.coin_exit * (D(1) - D(direction) * adverse_rate)
    um_entry = entry.usd_entry * (D(1) - D(direction) * adverse_rate)
    um_exit = candidate.usd_exit * (D(1) + D(direction) * adverse_rate)
    usd_quantity = FACE_USD / entry.coin_entry
    cm_price_pnl = D(direction) * FACE_USD * (D(1) / cm_entry - D(1) / cm_exit) * candidate.usd_exit
    um_price_pnl = -D(direction) * usd_quantity * (um_exit - um_entry)
    scenario_price_pnl = cm_price_pnl + um_price_pnl
    reference_price_pnl = combined_price_pnl(
        direction,
        entry.coin_entry,
        candidate.coin_exit,
        entry.usd_entry,
        candidate.usd_exit,
    )
    cm_entry_fee = FACE_USD * fee_rate / cm_entry * entry.usd_entry
    cm_exit_fee = FACE_USD * fee_rate / cm_exit * candidate.usd_exit
    um_entry_fee = usd_quantity * um_entry * fee_rate
    um_exit_fee = usd_quantity * um_exit * fee_rate
    total_fee = cm_entry_fee + cm_exit_fee + um_entry_fee + um_exit_fee
    adverse = reference_price_pnl - scenario_price_pnl
    return ScenarioResult(
        net_usd=scenario_price_pnl + candidate.hold_funding_pnl_usd - total_fee,
        fee_usd=total_fee,
        adverse_execution_usd=adverse,
    )


def combined_price_pnl(
    direction: int,
    coin_entry: Decimal,
    coin_exit: Decimal,
    usd_entry: Decimal,
    usd_exit: Decimal,
    face_usd: Decimal = FACE_USD,
) -> Decimal:
    if direction not in {-1, 1}:
        raise EvidenceError("position direction must be -1 or 1")
    if min(coin_entry, coin_exit, usd_entry, usd_exit, face_usd) <= 0:
        raise EvidenceError("price and face inputs must be positive")
    return D(direction) * face_usd * (usd_entry / coin_entry - usd_exit / coin_exit)


def evaluate_cohort(
    pair_specs: Sequence[PairSpec],
    all_series: Mapping[str, PairSeries],
    entry_ms: int,
    trial: TrialSpec,
) -> CohortResult:
    candidates: list[EntryCandidate] = []
    for pair in pair_specs:
        series = all_series.get(pair.underlying)
        if series is None:
            raise EvidenceError(f"pair series missing: {pair.underlying}")
        try:
            candidates.append(entry_candidate_for(pair, series, entry_ms))
        except EvidenceError as error:
            if str(error) == "pair is below the frozen liquidity floor":
                continue
            raise
    if len(candidates) < 3:
        raise EvidenceError("fewer than three complete liquid underlyings")
    eligible = [
        candidate
        for candidate in candidates
        if candidate.direction != 0
        and abs(candidate.relative_funding) >= trial.threshold
        and (trial.basis_mode == "NONE" or D(candidate.direction) * candidate.relative_basis < 0)
    ]
    eligible.sort(key=lambda item: (-abs(item.relative_funding), item.pair.underlying))
    if not eligible:
        return CohortResult(
            entry_ms,
            None,
            D(0),
            D(0),
            D(0),
            D(0),
            D(0),
            D(0),
            D(0),
            None,
        )
    entry_selected = eligible[0]
    selected_series = all_series[entry_selected.pair.underlying]
    selected = complete_candidate(
        entry_selected,
        selected_series,
        entry_ms,
        trial.hold_hours,
    )
    direction = selected.entry.direction
    price_pnl = combined_price_pnl(
        direction,
        selected.entry.coin_entry,
        selected.coin_exit,
        selected.entry.usd_entry,
        selected.usd_exit,
    )
    gross = price_pnl + selected.hold_funding_pnl_usd
    maker = scenario_result(selected, MAKER_FEE_BPS, MAKER_ADVERSE_BPS)
    stress = scenario_result(selected, STRESS_FEE_BPS, STRESS_ADVERSE_BPS)
    return CohortResult(
        entry_ms=entry_ms,
        selected=selected.entry.pair.underlying,
        gross_usd=gross,
        maker_net_usd=maker.net_usd,
        stress_net_usd=stress.net_usd,
        fee_maker_usd=maker.fee_usd,
        adverse_maker_usd=maker.adverse_execution_usd,
        fee_stress_usd=stress.fee_usd,
        adverse_stress_usd=stress.adverse_execution_usd,
        capacity_usd=selected.entry.capacity_usd,
    )


def entry_grid(first: str, last: str) -> tuple[int, ...]:
    start = parse_utc(first)
    end = parse_utc(last)
    values: list[int] = []
    cursor = start
    while cursor <= end:
        values.append(int(cursor.timestamp() * 1000))
        cursor += timedelta(days=7)
    return tuple(values)


def circular_block_bootstrap_means(
    values: Sequence[Decimal],
    *,
    replicates: int,
    block_length: int,
    seed: int,
) -> tuple[Decimal, ...]:
    if not values or replicates <= 0 or block_length <= 0:
        raise EvidenceError("invalid bootstrap inputs")
    rng = random.Random(seed)
    size = len(values)
    sampled: list[Decimal] = []
    for _ in range(replicates):
        draw: list[Decimal] = []
        while len(draw) < size:
            start = rng.randrange(size)
            draw.extend(values[(start + offset) % size] for offset in range(block_length))
        sampled.append(mean(draw[:size]))
    return tuple(sampled)


def centered_bootstrap_pvalue(
    values: Sequence[Decimal],
    *,
    replicates: int,
    block_length: int,
    seed: int,
) -> Decimal:
    observed = mean(values)
    centered = tuple(value - observed for value in values)
    null_means = circular_block_bootstrap_means(
        centered,
        replicates=replicates,
        block_length=block_length,
        seed=seed,
    )
    exceedances = sum(1 for value in null_means if value >= observed)
    return D(exceedances + 1) / D(replicates + 1)


def holm_adjust(pvalues: Mapping[str, Decimal]) -> dict[str, Decimal]:
    ordered = sorted(pvalues.items(), key=lambda item: (item[1], item[0]))
    adjusted: dict[str, Decimal] = {}
    running = D(0)
    total = len(ordered)
    for index, (trial_id, value) in enumerate(ordered):
        candidate = min(D(1), D(total - index) * value)
        running = max(running, candidate)
        adjusted[trial_id] = running
    return adjusted


def maximum_drawdown(values: Sequence[Decimal]) -> Decimal:
    equity = D(0)
    peak = D(0)
    maximum = D(0)
    for value in values:
        equity += value
        peak = max(peak, equity)
        maximum = max(maximum, peak - equity)
    return maximum


def pbo_cscv(matrix: Mapping[str, Sequence[Decimal]], blocks: int = 8) -> Decimal:
    if not matrix or blocks <= 1 or blocks % 2 != 0:
        raise EvidenceError("invalid PBO matrix or block count")
    lengths = {len(values) for values in matrix.values()}
    if len(lengths) != 1:
        raise EvidenceError("PBO matrix is not synchronous")
    row_count = next(iter(lengths))
    usable = row_count - (row_count % blocks)
    if usable < blocks:
        raise EvidenceError("PBO matrix has too few rows")
    block_size = usable // blocks
    trial_ids = sorted(matrix)
    block_scores: dict[str, tuple[Decimal, ...]] = {}
    for trial_id in trial_ids:
        values = matrix[trial_id][:usable]
        block_scores[trial_id] = tuple(
            mean(values[index * block_size : (index + 1) * block_size]) for index in range(blocks)
        )
    failures = 0
    splits = 0
    for in_blocks_tuple in itertools.combinations(range(blocks), blocks // 2):
        in_blocks = set(in_blocks_tuple)
        out_blocks = set(range(blocks)) - in_blocks
        in_scores = {
            trial_id: mean(tuple(block_scores[trial_id][index] for index in in_blocks))
            for trial_id in trial_ids
        }
        selected = min(trial_ids, key=lambda trial_id: (-in_scores[trial_id], trial_id))
        out_scores = {
            trial_id: mean(tuple(block_scores[trial_id][index] for index in out_blocks))
            for trial_id in trial_ids
        }
        ordered = sorted(trial_ids, key=lambda trial_id: (-out_scores[trial_id], trial_id))
        rank = ordered.index(selected) + 1
        relative_rank = (D(rank) - D("0.5")) / D(len(ordered))
        if relative_rank >= D("0.5"):
            failures += 1
        splits += 1
    if splits == 0:
        raise EvidenceError("PBO produced no splits")
    return D(failures) / D(splits)


def cohort_mapping(result: CohortResult) -> dict[str, object]:
    return {
        "entryUtc": datetime.fromtimestamp(result.entry_ms / 1000, UTC)
        .isoformat()
        .replace("+00:00", "Z"),
        "selectedUnderlying": result.selected,
        "grossUsd": decimal_text(result.gross_usd),
        "makerNetUsd": decimal_text(result.maker_net_usd),
        "stressNetUsd": decimal_text(result.stress_net_usd),
        "capacityProxyUsd": (
            None if result.capacity_usd is None else decimal_text(result.capacity_usd)
        ),
    }


def summarize_trial(
    trial: TrialSpec,
    cohorts: Sequence[CohortResult],
    *,
    replicates: int,
    seed: int,
    family_size: int,
) -> dict[str, object]:
    maker_values = tuple(cohort.maker_net_usd for cohort in cohorts)
    stress_values = tuple(cohort.stress_net_usd for cohort in cohorts)
    bootstrap = circular_block_bootstrap_means(
        maker_values,
        replicates=replicates,
        block_length=4,
        seed=seed,
    )
    stress_bootstrap = circular_block_bootstrap_means(
        stress_values,
        replicates=replicates,
        block_length=4,
        seed=seed + 1,
    )
    capacities = [cohort.capacity_usd for cohort in cohorts if cohort.capacity_usd is not None]
    trades = sum(1 for cohort in cohorts if cohort.traded)
    maker_fee_total = sum((cohort.fee_maker_usd for cohort in cohorts), D(0))
    maker_adverse_total = sum((cohort.adverse_maker_usd for cohort in cohorts), D(0))
    stress_fee_total = sum((cohort.fee_stress_usd for cohort in cohorts), D(0))
    stress_adverse_total = sum((cohort.adverse_stress_usd for cohort in cohorts), D(0))
    return {
        **trial.as_mapping(),
        "scheduledCohorts": len(cohorts),
        "trades": trades,
        "makerMeanUsdPer1k": decimal_text(mean(maker_values)),
        "makerSumUsdPer1k": decimal_text(sum(maker_values, D(0))),
        "makerLower95UsdPer1k": decimal_text(quantile(bootstrap, D("0.025"))),
        "makerUpper95UsdPer1k": decimal_text(quantile(bootstrap, D("0.975"))),
        "makerBonferroniLowerUsdPer1k": decimal_text(
            quantile(bootstrap, D("0.05") / D(family_size))
        ),
        "stressMeanUsdPer1k": decimal_text(mean(stress_values)),
        "stressLower95UsdPer1k": decimal_text(quantile(stress_bootstrap, D("0.025"))),
        "stressUpper95UsdPer1k": decimal_text(quantile(stress_bootstrap, D("0.975"))),
        "stressBonferroniLowerUsdPer1k": decimal_text(
            quantile(stress_bootstrap, D("0.05") / D(family_size))
        ),
        "makerWeeklyRealizedDrawdownProxyUsdPer1k": decimal_text(maximum_drawdown(maker_values)),
        "stressWeeklyRealizedDrawdownProxyUsdPer1k": decimal_text(maximum_drawdown(stress_values)),
        "minimumCapacityProxyUsd": (None if not capacities else decimal_text(min(capacities))),
        "costDecomposition": {
            "makerFeeTotalUsd": decimal_text(maker_fee_total),
            "makerAdverseExecutionTotalUsd": decimal_text(maker_adverse_total),
            "stressFeeTotalUsd": decimal_text(stress_fee_total),
            "stressAdverseExecutionTotalUsd": decimal_text(stress_adverse_total),
        },
        "cohorts": [cohort_mapping(cohort) for cohort in cohorts],
    }


def evaluate_trials(
    selected_pairs: Sequence[PairSpec],
    series: Mapping[str, PairSeries],
    entries: Sequence[int],
    trials: Sequence[TrialSpec],
    *,
    replicates: int,
    seed: int,
) -> tuple[list[dict[str, object]], dict[str, tuple[Decimal, ...]], dict[str, Decimal]]:
    ledgers: list[dict[str, object]] = []
    matrix: dict[str, tuple[Decimal, ...]] = {}
    raw_pvalues: dict[str, Decimal] = {}
    for index, trial in enumerate(trials):
        cohorts = tuple(evaluate_cohort(selected_pairs, series, entry, trial) for entry in entries)
        stress_values = tuple(cohort.stress_net_usd for cohort in cohorts)
        matrix[trial.trial_id] = stress_values
        raw_pvalues[trial.trial_id] = centered_bootstrap_pvalue(
            stress_values,
            replicates=replicates,
            block_length=4,
            seed=seed + 100 + index,
        )
        ledgers.append(
            summarize_trial(
                trial,
                cohorts,
                replicates=replicates,
                seed=seed + 1_000 + index * 2,
                family_size=len(trials),
            )
        )
    adjusted = holm_adjust(raw_pvalues)
    for ledger in ledgers:
        trial_id = cast(str, ledger["trialId"])
        ledger["stressRawOneSidedPValue"] = decimal_text(raw_pvalues[trial_id])
        ledger["stressHolmAdjustedPValue"] = decimal_text(adjusted[trial_id])
    return ledgers, matrix, adjusted


def select_champion(
    trials: Sequence[TrialSpec],
    ledgers: Sequence[Mapping[str, object]],
) -> TrialSpec:
    ledger_by_id = {cast(str, ledger["trialId"]): ledger for ledger in ledgers}
    return min(
        trials,
        key=lambda trial: (
            -decimal_value(
                ledger_by_id[trial.trial_id]["stressMeanUsdPer1k"],
                field="stressMean",
            ),
            -decimal_value(
                ledger_by_id[trial.trial_id]["makerMeanUsdPer1k"],
                field="makerMean",
            ),
            trial.trial_id,
        ),
    )


def result_unmeasured(
    state_root: Path,
    limitation: str,
    *,
    holdout_opened: bool,
) -> dict[str, object]:
    candidate_path = state_root / "candidate-seal.v1.json"
    holdout_path = state_root / "holdout-open.v1.json"
    return {
        "schema": "S1KCoinMUsdMRelativeFundingBasisResultV1",
        "state": "TERMINAL_UNMEASURED",
        "measurementVerdict": "UNMEASURED",
        "capitalVerdict": "NO_GO",
        "executionAuthority": "NONE",
        "bindings": {
            "freezeSha256": sha256_path(FREEZE_PATH),
            "discoverySha256": (
                sha256_path(state_root / "discovery.v1.json")
                if (state_root / "discovery.v1.json").is_file()
                else None
            ),
            "acquisitionSha256": (
                sha256_path(state_root / "acquisition.v1.json")
                if (state_root / "acquisition.v1.json").is_file()
                else None
            ),
            "runMarkerSha256": (
                sha256_path(state_root / "run-marker.v1.json")
                if (state_root / "run-marker.v1.json").is_file()
                else None
            ),
            "candidateSealSha256": (
                sha256_path(candidate_path) if candidate_path.is_file() else None
            ),
            "holdoutOpenSha256": (sha256_path(holdout_path) if holdout_path.is_file() else None),
        },
        "lifecycle": {
            "runConsumed": True,
            "holdoutOpened": holdout_opened,
            "rerunAllowed": False,
        },
        "headline": {
            "netUsdPer1k": None,
            "confidenceInterval95Pct": None,
            "holdout": None,
            "pbo": None,
            "multiplicity": None,
            "drawdown": None,
            "capacity": None,
        },
        "development": None,
        "holdout": None,
        "multiplicity": None,
        "limitations": [limitation, "ACCOUNT_EFFECTIVE_FEE_AND_MARGIN_UNKNOWN"],
        "consumer": {
            "task": "N3-successor/orchestrator-scoreboard",
            "productAuthority": "NONE",
        },
    }


def classify_measurement(
    *,
    proxy_gate_pass: bool,
    exact_execution_and_risk_measured: bool,
) -> str:
    if not exact_execution_and_risk_measured:
        return "UNMEASURED"
    return "GO" if proxy_gate_pass else "NO_GO"


def terminal_result(
    state_root: Path,
    champion: TrialSpec,
    development_ledgers: Sequence[Mapping[str, object]],
    pbo: Decimal,
    holm: Mapping[str, Decimal],
    holdout_cohorts: Sequence[CohortResult],
    *,
    replicates: int,
    seed: int,
) -> dict[str, object]:
    holdout = summarize_trial(
        champion,
        holdout_cohorts,
        replicates=replicates,
        seed=seed + 90_000,
        family_size=1,
    )
    champion_development = next(
        ledger for ledger in development_ledgers if ledger["trialId"] == champion.trial_id
    )
    maker_mean = decimal_value(holdout["makerMeanUsdPer1k"], field="holdoutMakerMean")
    maker_lower = decimal_value(holdout["makerLower95UsdPer1k"], field="holdoutMakerLower")
    stress_mean = decimal_value(holdout["stressMeanUsdPer1k"], field="holdoutStressMean")
    stress_lower = decimal_value(holdout["stressLower95UsdPer1k"], field="holdoutStressLower")
    maker_drawdown_proxy = decimal_value(
        holdout["makerWeeklyRealizedDrawdownProxyUsdPer1k"],
        field="holdoutMakerDrawdownProxy",
    )
    stress_drawdown_proxy = decimal_value(
        holdout["stressWeeklyRealizedDrawdownProxyUsdPer1k"],
        field="holdoutStressDrawdownProxy",
    )
    trades_raw = holdout["trades"]
    if isinstance(trades_raw, bool) or not isinstance(trades_raw, int):
        raise EvidenceError("holdout trade count invalid")
    capacity_raw = holdout["minimumCapacityProxyUsd"]
    capacity = (
        None if capacity_raw is None else decimal_value(capacity_raw, field="holdoutCapacity")
    )
    development_bonferroni = decimal_value(
        champion_development["stressBonferroniLowerUsdPer1k"],
        field="developmentStressBonferroniLower",
    )
    gates = {
        "minimumHoldoutTrades": trades_raw >= 26,
        "holdoutMakerMeanPositive": maker_mean > 0,
        "holdoutMakerLower95Positive": maker_lower > 0,
        "holdoutStressMeanPositive": stress_mean > 0,
        "holdoutStressLower95Positive": stress_lower > 0,
        "developmentHolmPass": holm[champion.trial_id] <= D("0.05"),
        "developmentStressBonferroniLowerPositive": development_bonferroni > 0,
        "makerWeeklyRealizedDrawdownProxyAtMost100Usd": (maker_drawdown_proxy <= D("100")),
        "stressWeeklyRealizedDrawdownProxyAtMost100Usd": (stress_drawdown_proxy <= D("100")),
        "capacityProxyAtLeast1000Usd": capacity is not None and capacity >= D("1000"),
        "recentSymmetricExecutableBookEvidence": False,
        "accountEffectiveFeeKnown": False,
        "hourlyMarkedStrategyDrawdownMeasured": False,
        "historicalFilterCompliantQuantitiesMeasured": False,
    }
    proxy_gate_names = (
        "minimumHoldoutTrades",
        "holdoutMakerMeanPositive",
        "holdoutMakerLower95Positive",
        "holdoutStressMeanPositive",
        "holdoutStressLower95Positive",
        "developmentHolmPass",
        "developmentStressBonferroniLowerPositive",
        "makerWeeklyRealizedDrawdownProxyAtMost100Usd",
        "stressWeeklyRealizedDrawdownProxyAtMost100Usd",
        "capacityProxyAtLeast1000Usd",
    )
    proxy_pass = all(gates[name] for name in proxy_gate_names)
    measurement_verdict = classify_measurement(
        proxy_gate_pass=proxy_pass,
        exact_execution_and_risk_measured=False,
    )
    return {
        "schema": "S1KCoinMUsdMRelativeFundingBasisResultV1",
        "state": "TERMINAL_PROXY_MEASURED_EXECUTION_UNMEASURED",
        "measurementVerdict": measurement_verdict,
        "proxyStatisticalVerdict": "GO" if proxy_pass else "NO_GO",
        "capitalVerdict": "NO_GO",
        "executionAuthority": "NONE",
        "bindings": {
            "freezeSha256": sha256_path(FREEZE_PATH),
            "discoverySha256": sha256_path(state_root / "discovery.v1.json"),
            "acquisitionSha256": sha256_path(state_root / "acquisition.v1.json"),
            "runMarkerSha256": sha256_path(state_root / "run-marker.v1.json"),
            "candidateSealSha256": sha256_path(state_root / "candidate-seal.v1.json"),
            "holdoutOpenSha256": sha256_path(state_root / "holdout-open.v1.json"),
        },
        "lifecycle": {
            "runConsumed": True,
            "developmentOpenedBeforeCandidateSeal": True,
            "candidateSealedBeforeHoldout": True,
            "holdoutOpenedOnce": True,
            "rerunAllowed": False,
        },
        "headline": {
            "unit": "USD_PER_1000_MATCHED_FACE_PER_LEG",
            "grossTwoLegFaceUsd": "APPROXIMATELY_2000",
            "quantityBasis": "THEORETICAL_UNROUNDED_PUBLIC_PROXY",
            "netUsdPer1k": holdout["makerMeanUsdPer1k"],
            "confidenceInterval95Pct": [
                holdout["makerLower95UsdPer1k"],
                holdout["makerUpper95UsdPer1k"],
            ],
            "stressNetUsdPer1k": holdout["stressMeanUsdPer1k"],
            "holdoutTrades": trades_raw,
            "holdoutCohorts": holdout["scheduledCohorts"],
            "pbo": decimal_text(pbo),
            "pboRole": "DIAGNOSTIC_ONLY",
            "stressHolmAdjustedPValue": decimal_text(holm[champion.trial_id]),
            "developmentStressBonferroniLowerUsdPer1k": champion_development[
                "stressBonferroniLowerUsdPer1k"
            ],
            "drawdown": "UNMEASURED",
            "makerWeeklyRealizedDrawdownProxyUsdPer1k": holdout[
                "makerWeeklyRealizedDrawdownProxyUsdPer1k"
            ],
            "stressWeeklyRealizedDrawdownProxyUsdPer1k": holdout[
                "stressWeeklyRealizedDrawdownProxyUsdPer1k"
            ],
            "capacity": "UNMEASURED",
            "volumeParticipationCapacityProxyUsd": capacity_raw,
            "executableCapacity": "UNMEASURED",
            "historicalFilterCompliantQuantity": "UNMEASURED",
            "accountEffectiveFee": "UNKNOWN",
        },
        "costs": {
            "holdoutActualNotionalDecomposition": holdout["costDecomposition"],
            "makerProxyDiagnosticPerRoundTripUsd": "APPROXIMATELY_1.20",
            "stressDiagnosticPerRoundTripUsd": "APPROXIMATELY_6.00",
            "makerFillability": "UNMEASURED",
        },
        "champion": champion.as_mapping(),
        "development": {
            "scheduledCohorts": 52,
            "trialLedger": list(development_ledgers),
        },
        "holdout": holdout,
        "multiplicity": {
            "familySize": len(development_ledgers),
            "method": "CENTERED_BLOCK_BOOTSTRAP_HOLM_AND_BONFERRONI",
            "pbo": decimal_text(pbo),
            "pboDiagnosticOnly": True,
            "pboRows": 48,
            "pboExcludedDevelopmentRows": 4,
        },
        "gates": gates,
        "limitations": [
            "RECENT_SYMMETRIC_EXECUTABLE_BOOK_ARCHIVE_UNAVAILABLE",
            "MAKER_QUEUE_AND_FILLABILITY_UNMEASURED",
            "CAPACITY_IS_VOLUME_PARTICIPATION_PROXY_NOT_BOOK_DEPTH",
            "HOURLY_MARKED_STRATEGY_DRAWDOWN_UNMEASURED",
            "PBO_HAS_UNPURGED_ADJACENT_BLOCK_BOUNDARY_LIMITATION",
            "ACCOUNT_EFFECTIVE_FEE_MARGIN_COLLATERAL_AND_LIQUIDATION_UNKNOWN",
            "CURRENT_SYMBOL_METADATA_DOES_NOT_PROVE_HISTORICAL_MEMBERSHIP",
            "HISTORICAL_FILTER_COMPLIANT_QUANTITIES_UNMEASURED",
            "USD_USDT_PARITY_AND_COIN_CONVERSION_ARE_PUBLIC_MARKING_PROXIES",
        ],
        "consumer": {
            "task": "N3-successor/orchestrator-scoreboard",
            "productAuthority": "NONE",
        },
    }


def command_run(state_root: Path) -> None:
    protocol, _ = load_protocol()
    verify_freeze(state_root)
    acquisition_index(state_root)
    marker_path = state_root / "run-marker.v1.json"
    marker = {
        "schema": "S1KRunMarkerV1",
        "createdAtUtc": iso_now(),
        "freezeSha256": sha256_path(FREEZE_PATH),
        "freezeCommit": committed_freeze(require_scope_clean=False),
        "acquisitionSha256": sha256_path(state_root / "acquisition.v1.json"),
        "archiveBodiesOpenedBeforeMarker": False,
        "exclusiveRun": 1,
    }
    atomic_write(marker_path, canonical_bytes(marker), exclusive=True)
    holdout_opened = False
    try:
        selected_pairs = pairs(protocol)
        trials = trial_specs(protocol)
        development = load_months(
            state_root,
            selected_pairs,
            month_range("2024-05", "2025-06"),
        )
        dev_entries = entry_grid(
            "2024-06-03T01:00:00Z",
            "2025-05-26T01:00:00Z",
        )
        if len(dev_entries) != 52:
            raise EvidenceError("development entry grid mismatch")
        replicates = 8192
        seed = 2026072901
        ledgers, matrix, holm = evaluate_trials(
            selected_pairs,
            development,
            dev_entries,
            trials,
            replicates=replicates,
            seed=seed,
        )
        champion = select_champion(trials, ledgers)
        pbo = pbo_cscv(matrix)
        development_digest = sha256_bytes(canonical_bytes(ledgers))
        candidate_seal = {
            "schema": "S1KCandidateSealV1",
            "createdAtUtc": iso_now(),
            "freezeSha256": sha256_path(FREEZE_PATH),
            "acquisitionSha256": sha256_path(state_root / "acquisition.v1.json"),
            "runMarkerSha256": sha256_path(marker_path),
            "developmentLedgerSha256": development_digest,
            "champion": champion.as_mapping(),
            "pbo": decimal_text(pbo),
        }
        atomic_write(
            state_root / "candidate-seal.v1.json",
            canonical_bytes(candidate_seal),
            exclusive=True,
        )
        holdout_marker = {
            "schema": "S1KHoldoutOpenV1",
            "createdAtUtc": iso_now(),
            "freezeSha256": sha256_path(FREEZE_PATH),
            "runMarkerSha256": sha256_path(marker_path),
            "candidateSealSha256": sha256_path(state_root / "candidate-seal.v1.json"),
            "champion": champion.as_mapping(),
            "allowedOpenCount": 1,
            "consumedOpenCount": 1,
            "openedArchiveMonths": ["2025-07", "2026-06"],
        }
        atomic_write(
            state_root / "holdout-open.v1.json",
            canonical_bytes(holdout_marker),
            exclusive=True,
        )
        holdout_opened = True
        holdout_window = load_months(
            state_root,
            selected_pairs,
            month_range("2025-07", "2026-06"),
        )
        combined = merge_pair_windows(development, holdout_window)
        holdout_entries = entry_grid(
            "2025-07-07T01:00:00Z",
            "2026-06-22T01:00:00Z",
        )
        if len(holdout_entries) != 51:
            raise EvidenceError("holdout entry grid mismatch")
        holdout_cohorts = tuple(
            evaluate_cohort(selected_pairs, combined, entry, champion) for entry in holdout_entries
        )
        result = terminal_result(
            state_root,
            champion,
            ledgers,
            pbo,
            holm,
            holdout_cohorts,
            replicates=replicates,
            seed=seed,
        )
    except Exception as error:
        limitation = f"{type(error).__name__}:{error!s}"
        result = result_unmeasured(
            state_root,
            limitation,
            holdout_opened=holdout_opened,
        )
    atomic_write(RESULT_PATH, canonical_bytes(result), exclusive=True)
    print(
        json.dumps(
            {
                "result": str(RESULT_PATH),
                "verdict": result["measurementVerdict"],
                "state": result["state"],
            }
        )
    )


def validate_terminal_artifacts(
    state_root: Path,
    result: Mapping[str, Any],
) -> None:
    if result.get("schema") != "S1KCoinMUsdMRelativeFundingBasisResultV1":
        raise EvidenceError("result schema mismatch")
    if result.get("measurementVerdict") not in {"GO", "NO_GO", "UNMEASURED"}:
        raise EvidenceError("result verdict vocabulary mismatch")
    if result.get("capitalVerdict") != "NO_GO" or result.get("executionAuthority") != "NONE":
        raise EvidenceError("result authority boundary mismatch")
    bindings = result.get("bindings")
    if not isinstance(bindings, dict):
        raise EvidenceError("result bindings missing")
    expected_files = {
        "freezeSha256": FREEZE_PATH,
        "discoverySha256": state_root / "discovery.v1.json",
        "acquisitionSha256": state_root / "acquisition.v1.json",
        "runMarkerSha256": state_root / "run-marker.v1.json",
        "candidateSealSha256": state_root / "candidate-seal.v1.json",
        "holdoutOpenSha256": state_root / "holdout-open.v1.json",
    }
    for field, path in expected_files.items():
        if path.is_file():
            if bindings.get(field) != sha256_path(path):
                raise EvidenceError(f"result artifact binding mismatch: {field}")
        elif bindings.get(field) is not None:
            raise EvidenceError(f"result binds absent artifact: {field}")
    run_marker, _ = load_json(state_root / "run-marker.v1.json")
    if (
        run_marker.get("schema") != "S1KRunMarkerV1"
        or run_marker.get("freezeSha256") != sha256_path(FREEZE_PATH)
        or run_marker.get("freezeCommit") != committed_freeze(require_scope_clean=False)
        or run_marker.get("acquisitionSha256") != sha256_path(state_root / "acquisition.v1.json")
        or run_marker.get("archiveBodiesOpenedBeforeMarker") is not False
        or run_marker.get("exclusiveRun") != 1
    ):
        raise EvidenceError("run marker authentication failed")
    candidate_path = state_root / "candidate-seal.v1.json"
    holdout_path = state_root / "holdout-open.v1.json"
    candidate: dict[str, Any] | None = None
    holdout_receipt: dict[str, Any] | None = None
    if candidate_path.is_file():
        candidate, _ = load_json(candidate_path)
        if (
            candidate.get("schema") != "S1KCandidateSealV1"
            or candidate.get("freezeSha256") != sha256_path(FREEZE_PATH)
            or candidate.get("acquisitionSha256") != sha256_path(state_root / "acquisition.v1.json")
            or candidate.get("runMarkerSha256") != sha256_path(state_root / "run-marker.v1.json")
        ):
            raise EvidenceError("candidate seal authentication failed")
    if holdout_path.is_file():
        if candidate is None:
            raise EvidenceError("holdout receipt exists without candidate seal")
        holdout_receipt, _ = load_json(holdout_path)
        if (
            holdout_receipt.get("schema") != "S1KHoldoutOpenV1"
            or holdout_receipt.get("freezeSha256") != sha256_path(FREEZE_PATH)
            or holdout_receipt.get("runMarkerSha256")
            != sha256_path(state_root / "run-marker.v1.json")
            or holdout_receipt.get("candidateSealSha256") != sha256_path(candidate_path)
            or holdout_receipt.get("allowedOpenCount") != 1
            or holdout_receipt.get("consumedOpenCount") != 1
            or holdout_receipt.get("openedArchiveMonths") != ["2025-07", "2026-06"]
            or holdout_receipt.get("champion") != candidate.get("champion")
        ):
            raise EvidenceError("holdout receipt authentication failed")
    state = result.get("state")
    if state == "TERMINAL_PROXY_MEASURED_EXECUTION_UNMEASURED":
        development = result.get("development")
        multiplicity = result.get("multiplicity")
        headline = result.get("headline")
        if (
            not isinstance(development, dict)
            or not isinstance(development.get("trialLedger"), list)
            or not isinstance(multiplicity, dict)
            or not isinstance(headline, dict)
        ):
            raise EvidenceError("proxy-measured terminal evidence missing")
        ledger_digest = sha256_bytes(canonical_bytes(development["trialLedger"]))
        if (
            result.get("measurementVerdict") != "UNMEASURED"
            or candidate is None
            or holdout_receipt is None
            or result.get("champion") != candidate.get("champion")
            or candidate.get("developmentLedgerSha256") != ledger_digest
            or candidate.get("pbo") != multiplicity.get("pbo")
            or candidate.get("pbo") != headline.get("pbo")
        ):
            raise EvidenceError("proxy-measured terminal state is inconsistent")
    elif state == "TERMINAL_UNMEASURED":
        lifecycle = result.get("lifecycle")
        if not isinstance(lifecycle, dict):
            raise EvidenceError("unmeasured lifecycle missing")
        if lifecycle.get("holdoutOpened") is not holdout_path.is_file():
            raise EvidenceError("unmeasured holdout-open state mismatch")
    else:
        raise EvidenceError("unknown terminal result state")


def command_report(state_root: Path) -> None:
    verify_freeze(state_root)
    acquisition_index(state_root)
    result, raw = load_json(RESULT_PATH)
    validate_terminal_artifacts(state_root, result)
    sys.stdout.buffer.write(raw)


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--state-root",
        type=Path,
        default=DEFAULT_STATE_ROOT,
        help="external state and archive custody root",
    )
    parser.add_argument(
        "command",
        choices=("discover", "freeze", "acquire", "run", "report"),
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    arguments = parse_args(argv)
    try:
        if arguments.command == "discover":
            command_discover(arguments.state_root)
        elif arguments.command == "freeze":
            command_freeze(arguments.state_root)
        elif arguments.command == "acquire":
            command_acquire(arguments.state_root)
        elif arguments.command == "run":
            command_run(arguments.state_root)
        else:
            command_report(arguments.state_root)
    except EvidenceError as error:
        print(f"S1K_EVIDENCE_ERROR:{error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
