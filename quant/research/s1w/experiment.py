#!/usr/bin/env python3
"""Sealed public-only S-1W source gate and terminal evaluator.

Network access exists only in the explicit ``inspect-sources`` command. The
create-once ``run`` command is network-free and refuses to open outcome data
when the frozen causal source gate is not satisfied.
"""

from __future__ import annotations

import argparse
import contextlib
import csv
import hashlib
import io
import json
import os
import re
import sys
import tempfile
import urllib.request
import zipfile
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from typing import cast
from urllib.parse import urlparse

PACKET_ROOT = Path(__file__).resolve().parent
GENERATED_ROOT = PACKET_ROOT / "generated"
BASE_URL = "https://data.binance.vision/"
MAX_ARCHIVE_BYTES = 8_000_000
MAX_DOCUMENT_BYTES = 8_000_000
TEN_MINUTES_MS = 600_000


class EvidenceError(RuntimeError):
    """Fail-closed public research evidence error."""


@dataclass(frozen=True)
class FetchResult:
    """Bounded public HTTP response."""

    body: bytes
    final_url: str
    headers: dict[str, str]
    status: int = 200


@dataclass(frozen=True)
class ArchiveSample:
    """One fixed official archive observation."""

    dataset: str
    relative_path: str
    header: tuple[str, ...]
    timestamp_column: str
    timestamp_kind: str

    @property
    def url(self) -> str:
        return BASE_URL + self.relative_path


@dataclass(frozen=True)
class OISelectionRow:
    """The complete allowed S-1W selector input for one symbol."""

    symbol: str
    current_open_interest: Decimal
    previous_open_interest: Decimal
    prior_open_interest: Decimal


@dataclass(frozen=True)
class SelectedSymbol:
    """OI-only selector output before any funding or price read."""

    symbol: str
    acceleration: Decimal


METRICS_HEADER = (
    "create_time",
    "symbol",
    "sum_open_interest",
    "sum_open_interest_value",
    "count_toptrader_long_short_ratio",
    "sum_toptrader_long_short_ratio",
    "count_long_short_ratio",
    "sum_taker_long_short_vol_ratio",
)
FUNDING_HEADER = ("calc_time", "funding_interval_hours", "last_funding_rate")
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
SAMPLES = (
    ArchiveSample(
        dataset="metrics",
        relative_path=("data/futures/um/daily/metrics/BTCUSDT/BTCUSDT-metrics-2026-06-30.zip"),
        header=METRICS_HEADER,
        timestamp_column="create_time",
        timestamp_kind="UTC_TEXT",
    ),
    ArchiveSample(
        dataset="fundingRate",
        relative_path=(
            "data/futures/um/monthly/fundingRate/BTCUSDT/BTCUSDT-fundingRate-2026-06.zip"
        ),
        header=FUNDING_HEADER,
        timestamp_column="calc_time",
        timestamp_kind="UTC_MILLIS",
    ),
    ArchiveSample(
        dataset="contractKlines1h",
        relative_path=("data/futures/um/monthly/klines/BTCUSDT/1h/BTCUSDT-1h-2026-06.zip"),
        header=KLINE_HEADER,
        timestamp_column="open_time",
        timestamp_kind="UTC_MILLIS",
    ),
    ArchiveSample(
        dataset="markPriceKlines1h",
        relative_path=("data/futures/um/monthly/markPriceKlines/BTCUSDT/1h/BTCUSDT-1h-2026-06.zip"),
        header=KLINE_HEADER,
        timestamp_column="open_time",
        timestamp_kind="UTC_MILLIS",
    ),
)

OI_DOC_URL = (
    "https://developers.binance.com/en/docs/catalog/"
    "core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/"
    "market-data#open-interest-statistics"
)
FUNDING_DOC_URL = (
    "https://developers.binance.com/en/docs/catalog/"
    "core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/"
    "market-data#get-funding-rate-history"
)
PUBLIC_DATA_README_URL = (
    "https://raw.githubusercontent.com/binance/binance-public-data/master/README.md"
)

FREEZE_BINDING_PATHS = (
    "__init__.py",
    "README.md",
    "OFFICIAL_SOURCE_RESEARCH.md",
    "PRE_FREEZE_EXPOSURE.v1.json",
    "protocol.v1.json",
    "source-plan.v1.json",
    "universe.v1.json",
    "experiment.py",
    "verifier.py",
    "test_experiment.py",
    "test_verifier.py",
    "generated/source-observations.v1.json",
)


def canonical_json_bytes(value: object) -> bytes:
    """Return the packet's canonical JSON encoding."""

    return (
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n"
    ).encode()


def sha256_bytes(value: bytes) -> str:
    """Hash bytes with SHA-256."""

    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    """Hash one local regular file."""

    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1 << 20):
            digest.update(chunk)
    return digest.hexdigest()


def load_json_object(path: Path) -> dict[str, object]:
    """Load one closed top-level JSON object."""

    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise EvidenceError(f"JSON_OBJECT_REQUIRED:{path}")
    return cast(dict[str, object], value)


def atomic_write(path: Path, value: bytes) -> None:
    """Atomically replace a generated artifact."""

    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(value)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_name, path)
    finally:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(temporary_name)


def atomic_create(path: Path, value: object) -> None:
    """Create a lifecycle artifact exactly once."""

    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(canonical_json_bytes(value))
            handle.flush()
            os.fsync(handle.fileno())
    except BaseException:
        path.unlink(missing_ok=True)
        raise


def utc_now_text() -> str:
    """Return a seconds-resolution UTC observation time."""

    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _validate_public_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme != "https":
        raise EvidenceError(f"HTTPS_REQUIRED:{url}")
    allowed_hosts = {
        "data.binance.vision",
        "developers.binance.com",
        "raw.githubusercontent.com",
    }
    if parsed.hostname not in allowed_hosts:
        raise EvidenceError(f"OFFICIAL_HOST_REQUIRED:{url}")
    if parsed.username is not None or parsed.password is not None:
        raise EvidenceError(f"URL_USERINFO_FORBIDDEN:{url}")


def fetch_url(url: str, maximum_bytes: int) -> FetchResult:
    """Fetch one bounded official public resource."""

    _validate_public_url(url)
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "cosmos-s1w-public-research/1.0"},
        method="GET",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        final_url = response.geturl()
        _validate_public_url(final_url)
        body = response.read(maximum_bytes + 1)
        if len(body) > maximum_bytes:
            raise EvidenceError(f"PUBLIC_RESOURCE_TOO_LARGE:{url}")
        headers = {
            key.lower(): value
            for key, value in response.headers.items()
            if key.lower()
            in {
                "content-length",
                "etag",
                "last-modified",
                "content-type",
                "x-amzn-waf-action",
            }
        }
        status = response.status
    return FetchResult(body=body, final_url=final_url, headers=headers, status=status)


def parse_checksum_sidecar(value: bytes, expected_basename: str) -> str:
    """Parse Binance's exact filename-bound SHA-256 sidecar."""

    try:
        text = value.decode("ascii").strip()
    except UnicodeDecodeError as error:
        raise EvidenceError("CHECKSUM_ASCII_REQUIRED") from error
    match = re.fullmatch(r"([0-9a-f]{64})  ([A-Za-z0-9._-]+)", text)
    if match is None:
        raise EvidenceError("CHECKSUM_FORMAT_INVALID")
    if match.group(2) != expected_basename:
        raise EvidenceError("CHECKSUM_FILENAME_MISMATCH")
    return match.group(1)


def _safe_zip_member(archive: zipfile.ZipFile, expected_basename: str) -> zipfile.ZipInfo:
    members = archive.infolist()
    if len(members) != 1:
        raise EvidenceError("ZIP_SINGLE_MEMBER_REQUIRED")
    member = members[0]
    expected_member = expected_basename.removesuffix(".zip") + ".csv"
    if member.filename != expected_member:
        raise EvidenceError(f"ZIP_MEMBER_MISMATCH:{member.filename}")
    if member.is_dir() or "/" in member.filename or "\\" in member.filename:
        raise EvidenceError("ZIP_MEMBER_PATH_FORBIDDEN")
    if member.file_size > MAX_ARCHIVE_BYTES:
        raise EvidenceError("ZIP_MEMBER_TOO_LARGE")
    return member


def _timestamp_ms(value: str, kind: str) -> int:
    if kind == "UTC_MILLIS":
        parsed = int(value)
        if parsed < 0:
            raise EvidenceError("TIMESTAMP_NEGATIVE")
        return parsed
    if kind == "UTC_TEXT":
        parsed_time = datetime.strptime(value, "%Y-%m-%d %H:%M:%S").replace(tzinfo=UTC)
        return int(parsed_time.timestamp() * 1000)
    raise EvidenceError(f"TIMESTAMP_KIND_UNKNOWN:{kind}")


def inspect_archive(
    sample: ArchiveSample,
    fetcher: Callable[[str, int], FetchResult] = fetch_url,
) -> dict[str, object]:
    """Authenticate and summarize one fixed official archive sample."""

    archive_response = fetcher(sample.url, MAX_ARCHIVE_BYTES)
    checksum_response = fetcher(sample.url + ".CHECKSUM", 4096)
    basename = Path(sample.relative_path).name
    expected_sha = parse_checksum_sidecar(checksum_response.body, basename)
    actual_sha = sha256_bytes(archive_response.body)
    if actual_sha != expected_sha:
        raise EvidenceError(f"ARCHIVE_CHECKSUM_MISMATCH:{sample.dataset}")
    with zipfile.ZipFile(io.BytesIO(archive_response.body)) as archive:
        member = _safe_zip_member(archive, basename)
        member_bytes = archive.read(member)
    try:
        text = member_bytes.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise EvidenceError(f"CSV_UTF8_REQUIRED:{sample.dataset}") from error
    rows = list(csv.reader(io.StringIO(text)))
    if not rows or tuple(rows[0]) != sample.header:
        raise EvidenceError(f"CSV_HEADER_MISMATCH:{sample.dataset}")
    body_rows = rows[1:]
    if not body_rows:
        raise EvidenceError(f"CSV_BODY_REQUIRED:{sample.dataset}")
    if any(len(row) != len(sample.header) for row in body_rows):
        raise EvidenceError(f"CSV_WIDTH_MISMATCH:{sample.dataset}")
    timestamp_index = sample.header.index(sample.timestamp_column)
    timestamps = [_timestamp_ms(row[timestamp_index], sample.timestamp_kind) for row in body_rows]
    if len(set(timestamps)) != len(timestamps):
        raise EvidenceError(f"CSV_DUPLICATE_TIMESTAMP:{sample.dataset}")
    if timestamps != sorted(timestamps):
        raise EvidenceError(f"CSV_NONMONOTONIC_TIMESTAMP:{sample.dataset}")
    irregular_rows = sum(timestamp % 300_000 != 0 for timestamp in timestamps)
    return {
        "dataset": sample.dataset,
        "archiveUrl": archive_response.final_url,
        "checksumUrl": checksum_response.final_url,
        "archiveSha256": actual_sha,
        "checksumSidecarSha256": sha256_bytes(checksum_response.body),
        "archiveBytes": len(archive_response.body),
        "httpMetadata": archive_response.headers,
        "memberName": member.filename,
        "memberSha256": sha256_bytes(member_bytes),
        "header": list(sample.header),
        "rowCount": len(body_rows),
        "minimumTimestampMs": timestamps[0],
        "maximumTimestampMs": timestamps[-1],
        "nonFiveMinuteGridTimestampCount": irregular_rows,
        "sampleSymbolOutcomeEligibility": "QUARANTINED",
    }


def inspect_document(
    identifier: str,
    url: str,
    required_fragments: Sequence[str],
    fetcher: Callable[[str, int], FetchResult] = fetch_url,
    *,
    allow_empty_waf_challenge: bool = False,
) -> dict[str, object]:
    """Hash one current official document and record required fragment presence."""

    response = fetcher(url, MAX_DOCUMENT_BYTES)
    text = response.body.decode("utf-8", errors="replace")
    presence = {fragment: fragment in text for fragment in required_fragments}
    waf_challenge = (
        allow_empty_waf_challenge
        and response.status == 202
        and not response.body
        and response.headers.get("x-amzn-waf-action") == "challenge"
    )
    if not all(presence.values()) and not waf_challenge:
        missing = sorted(fragment for fragment, present in presence.items() if not present)
        raise EvidenceError(f"OFFICIAL_DOCUMENT_FRAGMENT_MISSING:{identifier}:{missing}")
    return {
        "id": identifier,
        "requestedUrl": url,
        "finalUrl": response.final_url,
        "sha256": sha256_bytes(response.body),
        "bytes": len(response.body),
        "httpStatus": response.status,
        "httpMetadata": response.headers,
        "accessState": "AWS_WAF_CHALLENGE" if waf_challenge else "CONTENT_VERIFIED",
        "requiredFragmentsPresent": presence,
    }


def inspect_sources(packet_root: Path = PACKET_ROOT) -> Path:
    """Create the immutable current official-source observation."""

    generated_root = packet_root / "generated"
    if (generated_root / "freeze.v1.json").exists():
        raise EvidenceError("SOURCE_INSPECTION_AFTER_FREEZE_FORBIDDEN")
    output = generated_root / "source-observations.v1.json"
    documents = [
        inspect_document(
            "USD_M_OPEN_INTEREST_STATISTICS",
            OI_DOC_URL,
            (
                "/futures/data/openInterestHist",
                "Only the data of the latest 1 month is available.",
                "sumOpenInterest",
                "End time of the period, in milliseconds.",
            ),
            allow_empty_waf_challenge=True,
        ),
        inspect_document(
            "USD_M_FUNDING_RATE_HISTORY",
            FUNDING_DOC_URL,
            ("/fapi/v1/fundingRate", "fundingRate", "fundingTime", "markPrice", "rateType"),
            allow_empty_waf_challenge=True,
        ),
        inspect_document(
            "BINANCE_PUBLIC_DATA_README",
            PUBLIC_DATA_README_URL,
            (
                "new `daily` data becoming available the next day",
                "new `monthly` data at the first monday of the month",
                "Each zip file has a `.CHECKSUM` file",
                "Archived files may be updated at a later date",
            ),
        ),
    ]
    archives = [inspect_archive(sample) for sample in SAMPLES]
    observation = {
        "schema": "cosmos.quant.research.s1w.source-observations.v1",
        "milestone": "S-1W",
        "retrievedAt": utc_now_text(),
        "officialDocuments": documents,
        "officialArchiveSamples": archives,
        "sampleCustody": {
            "symbol": "BTCUSDT",
            "outcomeEligibility": "QUARANTINED_FOR_ALL_S1W_WINDOWS",
            "eligibleOutcomeArchiveMembersOpened": 0,
        },
        "assessment": {
            "restHistoricalOpenInterestWindow": "LATEST_ONE_MONTH_ONLY",
            "historicalArchiveAvailability": "PRESENT_CHECKSUM_BOUND",
            "archiveCreateTimeToRestTimestampMapping": "UNPROVEN_OFFICIAL_CONTRACT",
            "historicalRowPublicationTime": "ABSENT",
            "historicalPointInTimeRevision": "ABSENT",
            "pointInTimeCausalOpenInterestInput": "UNPROVEN",
            "pointInTimeFundingSignInput": "UNPROVEN",
            "fundingArchiveRateType": "ABSENT",
            "fundingArchiveSettlementMark": "ABSENT",
            "developerDocumentationDirectFetch": "AWS_WAF_CHALLENGE_OR_CONTENT_VERIFIED",
            "manualOfficialResearchRecord": "OFFICIAL_SOURCE_RESEARCH.md",
            "causalGate": "FAILED",
            "terminalVerdict": "UNMEASURED",
        },
    }
    atomic_create(output, observation)
    return output


def oi_acceleration(
    current_open_interest: Decimal,
    previous_open_interest: Decimal,
    prior_open_interest: Decimal,
) -> Decimal:
    """Compute the frozen log second difference from positive base-unit OI."""

    values = (current_open_interest, previous_open_interest, prior_open_interest)
    if any(value <= 0 or not value.is_finite() for value in values):
        raise EvidenceError("OPEN_INTEREST_POSITIVE_FINITE_REQUIRED")
    return (
        current_open_interest.ln()
        - (Decimal(2) * previous_open_interest.ln())
        + (prior_open_interest.ln())
    )


def select_oi_cohort(
    rows: Iterable[OISelectionRow],
    minimum_acceleration: Decimal,
) -> tuple[SelectedSymbol, ...]:
    """Select a stable cohort using OI fields only."""

    if not minimum_acceleration.is_finite():
        raise EvidenceError("ACCELERATION_THRESHOLD_FINITE_REQUIRED")
    seen: set[str] = set()
    selected: list[SelectedSymbol] = []
    for row in rows:
        if not re.fullmatch(r"[A-Z0-9]+USDT", row.symbol):
            raise EvidenceError(f"SYMBOL_INVALID:{row.symbol}")
        if row.symbol in seen:
            raise EvidenceError(f"SYMBOL_DUPLICATE:{row.symbol}")
        seen.add(row.symbol)
        acceleration = oi_acceleration(
            row.current_open_interest,
            row.previous_open_interest,
            row.prior_open_interest,
        )
        if acceleration > minimum_acceleration:
            selected.append(SelectedSymbol(symbol=row.symbol, acceleration=acceleration))
    return tuple(sorted(selected, key=lambda item: item.symbol))


def as_of_value(
    rows: Sequence[tuple[int, Decimal]],
    cutoff_ms: int,
    maximum_age_ms: int = TEN_MINUTES_MS,
) -> Decimal:
    """Resolve the latest actual timestamp at or before a frozen cutoff."""

    if maximum_age_ms < 0:
        raise EvidenceError("AS_OF_MAXIMUM_AGE_INVALID")
    eligible = [(timestamp, value) for timestamp, value in rows if timestamp <= cutoff_ms]
    if not eligible:
        raise EvidenceError("AS_OF_VALUE_MISSING")
    timestamp, value = max(eligible, key=lambda item: item[0])
    if cutoff_ms - timestamp > maximum_age_ms:
        raise EvidenceError("AS_OF_VALUE_STALE")
    if not value.is_finite():
        raise EvidenceError("AS_OF_VALUE_NONFINITE")
    return value


def receive_funding_side(last_settled_rate: Decimal) -> int:
    """Return short (-1), long (+1), or cash (0) from funding sign only."""

    if not last_settled_rate.is_finite():
        raise EvidenceError("FUNDING_RATE_FINITE_REQUIRED")
    if last_settled_rate > 0:
        return -1
    if last_settled_rate < 0:
        return 1
    return 0


def funding_cash(
    position_sign: int,
    quantity: Decimal,
    settlement_mark_proxy: Decimal,
    funding_rate: Decimal,
) -> Decimal:
    """Compute one archived funding cash flow."""

    if position_sign not in {-1, 1}:
        raise EvidenceError("POSITION_SIGN_INVALID")
    values = (quantity, settlement_mark_proxy, funding_rate)
    if any(not value.is_finite() for value in values):
        raise EvidenceError("FUNDING_COMPONENT_NONFINITE")
    if quantity <= 0 or settlement_mark_proxy <= 0:
        raise EvidenceError("FUNDING_QUANTITY_MARK_POSITIVE_REQUIRED")
    return -Decimal(position_sign) * quantity * settlement_mark_proxy * funding_rate


def net_components(
    price_pnl: Decimal,
    funding_pnl: Decimal,
    fee_proxy: Decimal,
    adverse_fill_proxy: Decimal,
) -> tuple[Decimal, Decimal]:
    """Return total net and carry-only net."""

    values = (price_pnl, funding_pnl, fee_proxy, adverse_fill_proxy)
    if any(not value.is_finite() for value in values):
        raise EvidenceError("ECONOMIC_COMPONENT_NONFINITE")
    if fee_proxy < 0 or adverse_fill_proxy < 0:
        raise EvidenceError("ECONOMIC_COST_NEGATIVE")
    total = price_pnl + funding_pnl - fee_proxy - adverse_fill_proxy
    carry_only = funding_pnl - fee_proxy - adverse_fill_proxy
    return total, carry_only


def freeze_bindings(packet_root: Path) -> dict[str, str]:
    """Hash every pre-run artifact frozen by S-1W."""

    bindings: dict[str, str] = {}
    for relative_path in FREEZE_BINDING_PATHS:
        path = packet_root / relative_path
        if not path.is_file() or path.is_symlink():
            raise EvidenceError(f"FREEZE_BINDING_REGULAR_FILE_REQUIRED:{relative_path}")
        bindings[relative_path] = sha256_file(path)
    return bindings


def verify_freeze_bindings(packet_root: Path) -> dict[str, object]:
    """Recompute the exact pre-run binding graph."""

    freeze_path = packet_root / "generated/freeze.v1.json"
    freeze = load_json_object(freeze_path)
    if freeze.get("schema") != "cosmos.quant.research.s1w.freeze.v1":
        raise EvidenceError("FREEZE_SCHEMA_MISMATCH")
    recorded = freeze.get("bindings")
    if not isinstance(recorded, dict):
        raise EvidenceError("FREEZE_BINDINGS_REQUIRED")
    normalized = cast(dict[str, object], recorded)
    expected = freeze_bindings(packet_root)
    if normalized != expected:
        raise EvidenceError("FREEZE_BINDINGS_MISMATCH")
    return freeze


def seal_packet(packet_root: Path = PACKET_ROOT) -> Path:
    """Seal source observations and the complete pre-run packet."""

    generated_root = packet_root / "generated"
    if (generated_root / "RUN_CONSUMED.v1.json").exists():
        raise EvidenceError("SEAL_AFTER_RUN_FORBIDDEN")
    protocol = load_json_object(packet_root / "protocol.v1.json")
    observations = load_json_object(generated_root / "source-observations.v1.json")
    causal_gate = protocol.get("causalSourceGate")
    assessment = observations.get("assessment")
    if not isinstance(causal_gate, dict) or causal_gate.get("currentState") != "FAILED":
        raise EvidenceError("PROTOCOL_CAUSAL_GATE_NOT_FAILED")
    if not isinstance(assessment, dict) or assessment.get("causalGate") != "FAILED":
        raise EvidenceError("SOURCE_CAUSAL_GATE_NOT_FAILED")
    bindings = freeze_bindings(packet_root)
    freeze = {
        "schema": "cosmos.quant.research.s1w.freeze.v1",
        "milestone": "S-1W",
        "createdAt": utc_now_text(),
        "state": "SEALED_BEFORE_ANY_ELIGIBLE_OUTCOME_ARCHIVE_OPEN",
        "baseCommit": "a169b123fb186d1943a75ad648552c4d95be1be1",
        "bindings": bindings,
        "protocolSha256": bindings["protocol.v1.json"],
        "sourceObservationsSha256": bindings["generated/source-observations.v1.json"],
        "preFreezeExposureSha256": bindings["PRE_FREEZE_EXPOSURE.v1.json"],
        "eligibleOutcomeArchiveMembersOpened": 0,
        "quarantinedSymbol": "BTCUSDT",
        "declaredRuns": 1,
    }
    output = generated_root / "freeze.v1.json"
    atomic_create(output, freeze)
    return output


def _terminal_result(packet_root: Path, freeze: dict[str, object]) -> dict[str, object]:
    observations = load_json_object(packet_root / "generated/source-observations.v1.json")
    assessment = observations.get("assessment")
    if not isinstance(assessment, dict):
        raise EvidenceError("SOURCE_ASSESSMENT_REQUIRED")
    if assessment.get("pointInTimeCausalOpenInterestInput") != "UNPROVEN":
        raise EvidenceError("UNEXPECTED_CAUSAL_GATE_STATE")
    freeze_sha = sha256_file(packet_root / "generated/freeze.v1.json")
    return {
        "schema": "cosmos.quant.research.s1w.result.v1",
        "milestone": "S-1W",
        "strategyFamily": ("USDM_LAGGED_BASE_OI_ACCELERATION_RECEIVE_FUNDING_COHORT_OR_CASH"),
        "terminalState": "UNMEASURED",
        "capitalVerdict": "NO_GO",
        "authority": "NONE",
        "consumer": "N3 successor / orchestrator scoreboard",
        "reasonCodes": [
            "HISTORICAL_OI_POINT_IN_TIME_AVAILABILITY_UNPROVEN",
            "HISTORICAL_FUNDING_SIGN_POINT_IN_TIME_AVAILABILITY_UNPROVEN",
            "ARCHIVE_CREATE_TIME_TO_REST_TIMESTAMP_MAPPING_UNPROVEN",
            "REST_OPEN_INTEREST_HISTORY_LIMITED_TO_LATEST_ONE_MONTH",
        ],
        "headline": {
            "baseNetUsdPerOriginal1000": None,
            "stressNetUsdPerOriginal1000": None,
            "severeNetUsdPerOriginal1000": None,
            "baseCarryOnlyNetUsdPerOriginal1000": None,
            "stressCarryOnlyNetUsdPerOriginal1000": None,
            "severeCarryOnlyNetUsdPerOriginal1000": None,
        },
        "samples": {
            "scheduledCohorts": None,
            "activeCohorts": None,
            "completedTrades": None,
            "symbols": None,
            "fills": None,
        },
        "intervals": {
            "stressTotal95Percent": None,
            "stressCarryOnly95Percent": None,
            "severeTotal95Percent": None,
            "severeCarryOnly95Percent": None,
            "stressIncrementalVsUnconditioned95Percent": None,
            "severeIncrementalVsUnconditioned95Percent": None,
        },
        "multiplicity": {
            "holm": None,
            "whiteRealityCheck": None,
            "pbo": None,
            "crossFamilyAdjustedEvidence": None,
        },
        "comparators": {
            "pairedNoFundingNetUsdPerOriginal1000": None,
            "unconditionedSignOnlyNetUsdPerOriginal1000": None,
            "unremuneratedCashNetUsdPerOriginal1000": None,
        },
        "drawdown": {
            "baseFraction": None,
            "stressFraction": None,
            "severeFraction": None,
        },
        "capacity": {
            "publicProxyUsd": None,
            "executableDepth": "UNKNOWN",
            "executableCapacity": "UNKNOWN",
        },
        "fees": {
            "accountEffectiveFees": "UNKNOWN",
            "publicScenarios": "FROZEN_NOT_EVALUATED",
        },
        "funding": {
            "rateType": "UNKNOWN_ARCHIVE_FIELD_ABSENT",
            "settlementMark": "UNMEASURED",
        },
        "development": {
            "state": "UNOPENED_CAUSAL_SOURCE_GATE_FAILED",
            "eligibleOutcomeArchiveMembersOpened": 0,
        },
        "holdout": {
            "state": "UNOPENED_CAUSAL_SOURCE_GATE_FAILED",
            "markerCreated": False,
            "eligibleOutcomeArchiveMembersOpened": 0,
        },
        "quarantine": {
            "symbol": "BTCUSDT",
            "outcomeEligibility": "NONE",
            "replacementUsed": False,
        },
        "provenance": {
            "baseCommit": "a169b123fb186d1943a75ad648552c4d95be1be1",
            "freezeSha256": freeze_sha,
            "runMarkerSha256": sha256_file(packet_root / "generated/RUN_CONSUMED.v1.json"),
            "protocolSha256": freeze["protocolSha256"],
            "sourceObservationsSha256": freeze["sourceObservationsSha256"],
            "preFreezeExposureSha256": freeze["preFreezeExposureSha256"],
            "runCount": 1,
        },
        "limitations": [
            "EVENT_TIME_LAGGED_EX_POST_ASSOCIATION_NOT_SUBSTITUTED_FOR_CAUSAL_INPUT",
            "ACCOUNT_EFFECTIVE_FEES_UNKNOWN",
            "EXECUTABLE_DEPTH_CAPACITY_IMPACT_AND_QUEUE_UNKNOWN",
            "FUNDING_ARCHIVE_RATE_TYPE_AND_SETTLEMENT_MARK_ABSENT",
            "CROSS_FAMILY_MULTIPLICITY_NOT_REGISTERED",
            "NO_PRIVATE_API_ORDER_TRANSFER_WITHDRAWAL_OR_MONEY_AUTHORITY",
        ],
    }


def _checksum_paths(packet_root: Path) -> tuple[Path, ...]:
    paths: list[Path] = []
    for path in packet_root.rglob("*"):
        if not path.is_file() or path.is_symlink():
            continue
        relative = path.relative_to(packet_root)
        if path.name == "SHA256SUMS" or "__pycache__" in relative.parts:
            continue
        if path.suffix in {".pyc", ".pyo"}:
            continue
        paths.append(path)
    return tuple(sorted(paths, key=lambda path: path.relative_to(packet_root).as_posix()))


def write_checksums(packet_root: Path = PACKET_ROOT) -> Path:
    """Write the final packet digest inventory."""

    lines = [
        f"{sha256_file(path)}  {path.relative_to(packet_root).as_posix()}"
        for path in _checksum_paths(packet_root)
    ]
    output = packet_root / "SHA256SUMS"
    atomic_write(output, ("\n".join(lines) + "\n").encode())
    return output


def run_packet(packet_root: Path = PACKET_ROOT) -> Path:
    """Consume the only run and emit the terminal source-gate result."""

    generated_root = packet_root / "generated"
    marker_path = generated_root / "RUN_CONSUMED.v1.json"
    result_path = generated_root / "result.v1.json"
    if marker_path.exists() or result_path.exists():
        raise EvidenceError("RUN_ALREADY_CONSUMED")
    freeze = verify_freeze_bindings(packet_root)
    marker = {
        "schema": "cosmos.quant.research.s1w.run-consumed.v1",
        "milestone": "S-1W",
        "createdAt": utc_now_text(),
        "state": "CONSUMED_BEFORE_ANY_ELIGIBLE_DEVELOPMENT_OUTCOME_READ",
        "freezeSha256": sha256_file(generated_root / "freeze.v1.json"),
        "sourceObservationsSha256": freeze["sourceObservationsSha256"],
        "eligibleOutcomeArchiveMembersOpenedBeforeMarker": 0,
        "declaredRuns": 1,
    }
    atomic_create(marker_path, marker)
    result = _terminal_result(packet_root, freeze)
    atomic_create(result_path, result)
    write_checksums(packet_root)
    return result_path


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("inspect-sources")
    subparsers.add_parser("seal")
    subparsers.add_parser("run")
    subparsers.add_parser("checksums")
    subparsers.add_parser("verify")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    """Run one explicit packet command."""

    arguments = _build_parser().parse_args(argv)
    try:
        if arguments.command == "inspect-sources":
            path = inspect_sources()
        elif arguments.command == "seal":
            path = seal_packet()
        elif arguments.command == "run":
            path = run_packet()
        elif arguments.command == "checksums":
            path = write_checksums()
        elif arguments.command == "verify":
            from research.s1w.verifier import verify_packet

            verify_packet(PACKET_ROOT)
            print("S1W_AUTHENTIC UNMEASURED CAPITAL_NO_GO OUTCOME_ARCHIVE_MEMBERS_OPENED=0")
            return 0
        else:
            raise EvidenceError(f"COMMAND_UNKNOWN:{arguments.command}")
    except (EvidenceError, FileExistsError, OSError, ValueError, zipfile.BadZipFile) as error:
        print(f"S1W_ERROR {error}", file=sys.stderr)
        return 2
    print(path.relative_to(PACKET_ROOT))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
