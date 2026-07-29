#!/usr/bin/env python3
"""Sealed public-data evaluator for S-1M.

The module deliberately uses only the Python standard library.  Every input is
an official Binance monthly archive whose published checksum is verified before
the ZIP member is opened.  The outcome runner is single use.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import itertools
import json
import math
import os
import random
import re
import statistics
import subprocess
import sys
import tempfile
import zipfile
from collections import defaultdict
from collections.abc import Iterable, Iterator, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation, getcontext
from pathlib import Path
from typing import Any

getcontext().prec = 40

PACKET_DIR = Path(__file__).resolve().parent
PROTOCOL_PATH = PACKET_DIR / "protocol.v1.json"
README_PATH = PACKET_DIR / "README.md"
SOURCES_PATH = PACKET_DIR / "OFFICIAL_SOURCE_RESEARCH.md"
UNIVERSE_PATH = PACKET_DIR / "universe.v1.json"
MANIFEST_PATH = PACKET_DIR / "source_manifest.v1.json"
LEDGER_PATH = PACKET_DIR / "trial_ledger.v1.json"
FREEZE_PATH = PACKET_DIR / "freeze.v1.json"
RUN_MARKER_PATH = PACKET_DIR / "RUN_CONSUMED.v1.json"
DEVELOPMENT_PATH = PACKET_DIR / "development_result.v1.json"
CANDIDATE_PATH = PACKET_DIR / "candidate_seal.v1.json"
HOLDOUT_MARKER_PATH = PACKET_DIR / "HOLDOUT_OPEN.v1.json"
RESULT_PATH = PACKET_DIR / "result.v1.json"
SHA_PATH = PACKET_DIR / "SHA256SUMS"
TEST_PATH = PACKET_DIR / "test_experiment.py"
CUSTODY_BREACH_PATH = PACKET_DIR / "CUSTODY_BREACH.v1.json"

SCHEMA_FUNDING = (
    "calc_time",
    "funding_interval_hours",
    "last_funding_rate",
)
SCHEMA_KLINE = (
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
BASE_COMMIT = "a169b123fb186d1943a75ad648552c4d95be1be1"
HOUR_MS = 3_600_000
DAY_MS = 86_400_000
NOTIONAL = Decimal("1000")
SYMBOL_RE = re.compile(r"^[A-Z0-9]+USDT$")
CHECKSUM_RE = re.compile(r"^([0-9a-fA-F]{64})[ \t]+\\*?([^/\\\r\n]+)\r?\n?$")
ALLOWED_GENERATED = {
    "universe.v1.json",
    "source_manifest.v1.json",
    "trial_ledger.v1.json",
    "freeze.v1.json",
    "RUN_CONSUMED.v1.json",
    "development_result.v1.json",
    "candidate_seal.v1.json",
    "HOLDOUT_OPEN.v1.json",
    "result.v1.json",
    "SHA256SUMS",
}


class ExperimentError(RuntimeError):
    """A fail-closed custody, chronology, or evaluator error."""


@dataclass(frozen=True)
class ArchiveRef:
    symbol: str
    product: str
    month: str
    zip_path: Path
    checksum_path: Path
    relative_zip: str
    relative_checksum: str


@dataclass(frozen=True)
class FundingEvent:
    symbol: str
    time_ms: int
    interval_hours: Decimal
    rate: Decimal


@dataclass(frozen=True)
class Kline:
    open_time_ms: int
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    quote_volume: Decimal


@dataclass(frozen=True)
class Feature:
    symbol: str
    event_index: int
    time_ms: int
    decision_ms: int
    normalized_rate_bp: float
    velocity: float
    acceleration: float
    z: float
    prior_24h_quote_volume: float


@dataclass(frozen=True)
class Trial:
    trial_id: str
    lookback: int
    entry_z: float
    minimum_rate_bp: float
    maximum_settlements: int


@dataclass
class MarketData:
    funding: dict[str, list[FundingEvent]]
    contract: dict[str, dict[int, Kline]]
    mark: dict[str, dict[int, Decimal]]
    daily_quote_volume: dict[str, dict[int, Decimal]]


@dataclass(frozen=True)
class Trade:
    symbol: str
    side: int
    signal_time_ms: int
    entry_time_ms: int
    exit_signal_time_ms: int
    exit_time_ms: int
    entry_price: Decimal
    exit_price: Decimal
    quantity: Decimal
    funding_cash_flows: tuple[tuple[int, Decimal], ...]
    capacity_proxy_usd: Decimal
    base_net: Decimal
    stress_net: Decimal
    severe_net: Decimal
    base_decomposition: Mapping[str, Decimal]
    stress_decomposition: Mapping[str, Decimal]
    severe_decomposition: Mapping[str, Decimal]
    maker_filled: bool
    maker_net: Decimal | None


def utc_now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def parse_utc(value: str) -> int:
    return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000)


def canonical_bytes(value: Any) -> bytes:
    return (
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True) + "\n"
    ).encode()


def load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ExperimentError(f"INVALID_JSON:{path.name}:{exc}") from exc
    if not isinstance(value, dict):
        raise ExperimentError(f"INVALID_JSON_OBJECT:{path.name}")
    return value


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as handle:
            for block in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(block)
    except OSError as exc:
        raise ExperimentError(f"READ_FAILED:{path}:{exc}") from exc
    return digest.hexdigest()


def atomic_write(path: Path, payload: bytes, *, exclusive: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        if exclusive:
            try:
                os.link(temporary, path)
            except FileExistsError as exc:
                raise ExperimentError(f"ONE_RUN_ARTIFACT_EXISTS:{path.name}") from exc
            temporary.unlink()
        else:
            os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def write_json(path: Path, value: Any, *, exclusive: bool = False) -> None:
    atomic_write(path, canonical_bytes(value), exclusive=exclusive)


def decimal_text(value: Decimal | None) -> str | None:
    if value is None:
        return None
    return format(value.quantize(Decimal("0.00000001")), "f")


def float_text(value: float | None, digits: int = 8) -> str | None:
    if value is None:
        return None
    return f"{value:.{digits}f}"


def month_range(first: str, last: str) -> list[str]:
    year, month = (int(piece) for piece in first.split("-"))
    last_year, last_month = (int(piece) for piece in last.split("-"))
    answer: list[str] = []
    while (year, month) <= (last_year, last_month):
        answer.append(f"{year:04d}-{month:02d}")
        month += 1
        if month == 13:
            year += 1
            month = 1
    return answer


def archive_ref(root: Path, symbol: str, product: str, month: str) -> ArchiveRef:
    if product == "fundingRate":
        relative = Path("fundingRate") / symbol / f"{symbol}-fundingRate-{month}.zip"
    elif product in {"klines", "markPriceKlines"}:
        relative = Path(product) / symbol / "1h" / f"{symbol}-1h-{month}.zip"
    else:
        raise ExperimentError(f"UNKNOWN_PRODUCT:{product}")
    zip_path = root / relative
    checksum_path = zip_path.with_suffix(".zip.CHECKSUM")
    return ArchiveRef(
        symbol=symbol,
        product=product,
        month=month,
        zip_path=zip_path,
        checksum_path=checksum_path,
        relative_zip=relative.as_posix(),
        relative_checksum=relative.with_suffix(".zip.CHECKSUM").as_posix(),
    )


def parse_publisher_checksum(reference: ArchiveRef) -> tuple[str, str]:
    try:
        raw = reference.checksum_path.read_text(encoding="ascii")
    except OSError as exc:
        raise ExperimentError(f"CHECKSUM_MISSING:{reference.relative_checksum}") from exc
    match = CHECKSUM_RE.fullmatch(raw)
    if not match:
        raise ExperimentError(f"CHECKSUM_MALFORMED:{reference.relative_checksum}")
    expected, filename = match.groups()
    if filename != reference.zip_path.name:
        raise ExperimentError(f"CHECKSUM_FILENAME_MISMATCH:{reference.relative_checksum}")
    return expected.lower(), hashlib.sha256(raw.encode("ascii")).hexdigest()


def verified_archive(reference: ArchiveRef) -> dict[str, Any]:
    if not reference.zip_path.is_file():
        raise ExperimentError(f"ARCHIVE_MISSING:{reference.relative_zip}")
    expected, checksum_bytes_sha = parse_publisher_checksum(reference)
    actual = sha256_file(reference.zip_path)
    if actual != expected:
        raise ExperimentError(f"CHECKSUM_MISMATCH:{reference.relative_zip}")
    expected_header = SCHEMA_FUNDING if reference.product == "fundingRate" else SCHEMA_KLINE
    try:
        with zipfile.ZipFile(reference.zip_path) as archive:
            members = archive.infolist()
            if len(members) != 1:
                raise ExperimentError(f"ZIP_MEMBER_COUNT:{reference.relative_zip}:{len(members)}")
            member = members[0]
            mode = (member.external_attr >> 16) & 0o170000
            if member.is_dir() or "/" in member.filename or "\\" in member.filename:
                raise ExperimentError(f"ZIP_MEMBER_PATH:{reference.relative_zip}")
            if mode == 0o120000:
                raise ExperimentError(f"ZIP_MEMBER_SYMLINK:{reference.relative_zip}")
            if not member.filename.endswith(".csv"):
                raise ExperimentError(f"ZIP_MEMBER_TYPE:{reference.relative_zip}")
            with archive.open(member, "r") as raw:
                header_line = raw.readline().decode("utf-8-sig").rstrip("\r\n")
    except (OSError, UnicodeDecodeError, zipfile.BadZipFile) as exc:
        raise ExperimentError(f"ZIP_INVALID:{reference.relative_zip}:{exc}") from exc
    header = tuple(header_line.split(","))
    if header != expected_header:
        raise ExperimentError(f"SCHEMA_MISMATCH:{reference.relative_zip}:{header}")
    return {
        "symbol": reference.symbol,
        "product": reference.product,
        "interval": None if reference.product == "fundingRate" else "1h",
        "month": reference.month,
        "publisherKey": reference.relative_zip,
        "publisherChecksumKey": reference.relative_checksum,
        "publisherChecksumSha256": checksum_bytes_sha,
        "expectedSha256": expected,
        "verifiedSha256": actual,
        "bytes": reference.zip_path.stat().st_size,
        "memberName": member.filename,
        "memberBytes": member.file_size,
        "header": list(header),
    }


def iter_csv_rows(
    reference: ArchiveRef, binding: Mapping[str, Mapping[str, Any]] | None = None
) -> Iterator[dict[str, str]]:
    metadata = verified_archive(reference)
    if binding is not None:
        frozen = binding.get(reference.relative_zip)
        if frozen is None:
            raise ExperimentError(f"MANIFEST_ENTRY_MISSING:{reference.relative_zip}")
        for key in (
            "verifiedSha256",
            "publisherChecksumSha256",
            "memberName",
            "header",
        ):
            if metadata[key] != frozen.get(key):
                raise ExperimentError(f"FROZEN_SOURCE_DRIFT:{reference.relative_zip}:{key}")
    try:
        with (
            zipfile.ZipFile(reference.zip_path) as archive,
            archive.open(str(metadata["memberName"]), "r") as raw,
        ):
            text = (line.decode("utf-8-sig") for line in raw)
            reader = csv.DictReader(text)
            for row in reader:
                if None in row or any(value is None for value in row.values()):
                    raise ExperimentError(f"CSV_ROW_SHAPE:{reference.relative_zip}")
                yield {str(key): str(value) for key, value in row.items()}
    except (OSError, UnicodeDecodeError, zipfile.BadZipFile, csv.Error) as exc:
        raise ExperimentError(f"CSV_INVALID:{reference.relative_zip}:{exc}") from exc


def excluded_base(symbol: str, excluded: Sequence[str]) -> bool:
    base = symbol.removesuffix("USDT")
    return base in set(excluded)


def screen_universe(shared_root: Path) -> dict[str, Any]:
    protocol = load_json(PROTOCOL_PATH)
    universe_rule = protocol["universe"]
    excluded = [str(value) for value in universe_rule["excludedBases"]]
    funding_root = shared_root / "fundingRate"
    if not funding_root.is_dir():
        raise ExperimentError(f"SHARED_ARCHIVE_INVALID:{funding_root}")
    candidates = sorted(path.name for path in funding_root.iterdir() if path.is_dir())
    eligible: list[dict[str, Any]] = []
    rejection_counts: dict[str, int] = defaultdict(int)
    required_months = [str(value) for value in universe_rule["requiredPreOutcomeMonths"]]
    for symbol in candidates:
        if not SYMBOL_RE.fullmatch(symbol):
            rejection_counts["SYMBOL_GRAMMAR"] += 1
            continue
        if excluded_base(symbol, excluded):
            rejection_counts["EXCLUDED_BASE"] += 1
            continue
        try:
            observations = 0
            june_quote_volume = Decimal("0")
            for month in required_months:
                for product in ("fundingRate", "klines", "markPriceKlines"):
                    reference = archive_ref(shared_root, symbol, product, month)
                    verified_archive(reference)
                for row in iter_csv_rows(archive_ref(shared_root, symbol, "fundingRate", month)):
                    int(row["calc_time"])
                    Decimal(row["funding_interval_hours"])
                    Decimal(row["last_funding_rate"])
                    observations += 1
                if month == str(protocol["calendar"]["screenMonth"]):
                    for row in iter_csv_rows(archive_ref(shared_root, symbol, "klines", month)):
                        int(row["open_time"])
                        june_quote_volume += Decimal(row["quote_volume"])
            if observations < int(universe_rule["minimumFundingObservationsBeforeDevelopment"]):
                rejection_counts["INSUFFICIENT_FUNDING_HISTORY"] += 1
                continue
        except (ExperimentError, InvalidOperation, ValueError):
            rejection_counts["CUSTODY_OR_SCHEMA"] += 1
            continue
        eligible.append(
            {
                "symbol": symbol,
                "preDevelopmentFundingObservations": observations,
                "screenMonthQuoteVolumeUsd": format(june_quote_volume, "f"),
            }
        )
    eligible.sort(
        key=lambda row: (-Decimal(str(row["screenMonthQuoteVolumeUsd"])), str(row["symbol"]))
    )
    count = int(universe_rule["selectionCount"])
    selected = eligible[:count]
    if len(selected) != count:
        raise ExperimentError(f"UNIVERSE_TOO_SMALL:{len(selected)}:{count}")
    result = {
        "schema": "cosmos.quant.research.s1m.universe.v1",
        "status": "FROZEN_PRE_OUTCOME_SCREEN",
        "baseCommit": BASE_COMMIT,
        "screenMonth": protocol["calendar"]["screenMonth"],
        "selectionRule": universe_rule["rank"],
        "futureCoverageCanReplaceSymbol": False,
        "currentExchangeMembershipUsed": False,
        "sourceRoot": "EXTERNAL_READ_ONLY_BINANCE_PUBLIC_MONTHLY_ARCHIVE",
        "discoveredSymbolDirectories": len(candidates),
        "eligibleBeforeRank": len(eligible),
        "rejectionCounts": dict(sorted(rejection_counts.items())),
        "selected": selected,
        "symbols": [str(row["symbol"]) for row in selected],
    }
    write_json(UNIVERSE_PATH, result)
    return result


def prepare_manifest(shared_root: Path) -> dict[str, Any]:
    protocol = load_json(PROTOCOL_PATH)
    universe = load_json(UNIVERSE_PATH)
    symbols = [str(value) for value in universe["symbols"]]
    first, last = (str(value) for value in protocol["calendar"]["archiveMonthsInclusive"])
    entries: list[dict[str, Any]] = []
    lifecycle_absences: list[dict[str, Any]] = []
    lifecycle_cutoffs: dict[str, str] = {}
    months = month_range(first, last)
    for symbol in symbols:
        funding_absent = False
        for month in months:
            funding_reference = archive_ref(shared_root, symbol, "fundingRate", month)
            zip_present = funding_reference.zip_path.is_file()
            checksum_present = funding_reference.checksum_path.is_file()
            if zip_present != checksum_present:
                raise ExperimentError(f"FUNDING_CUSTODY_PARTIAL:{symbol}:{month}")
            funding_present = zip_present and checksum_present
            if not funding_present:
                if funding_reference.zip_path.exists() or funding_reference.checksum_path.exists():
                    raise ExperimentError(f"FUNDING_CUSTODY_NONFILE:{symbol}:{month}")
                funding_absent = True
                lifecycle_cutoffs.setdefault(symbol, month)
                for product in ("fundingRate", "klines", "markPriceKlines"):
                    reference = archive_ref(shared_root, symbol, product, month)
                    if reference.zip_path.exists() or reference.checksum_path.exists():
                        raise ExperimentError(
                            f"LIFECYCLE_SOURCE_PRESENT_WITHOUT_FUNDING:{reference.relative_zip}"
                        )
                    lifecycle_absences.append(
                        {
                            "symbol": symbol,
                            "product": product,
                            "interval": None if product == "fundingRate" else "1h",
                            "month": month,
                            "publisherKey": reference.relative_zip,
                            "status": (
                                "OFFICIAL_FUNDING_ARCHIVE_NOT_PUBLISHED_TRAILING"
                                if product == "fundingRate"
                                else "NOT_REQUIRED_AFTER_TRAILING_FUNDING_ABSENCE"
                            ),
                        }
                    )
                continue
            if funding_absent:
                raise ExperimentError(f"FUNDING_ARCHIVE_REAPPEARS:{symbol}:{month}")
            for product in ("fundingRate", "klines", "markPriceKlines"):
                entries.append(verified_archive(archive_ref(shared_root, symbol, product, month)))
    declared = len(symbols) * len(months) * 3
    if len(entries) + len(lifecycle_absences) != declared:
        raise ExperimentError("MANIFEST_DECLARED_COVERAGE_MISMATCH")
    result = {
        "schema": "cosmos.quant.research.s1m.source-manifest.v1",
        "status": "CHECKSUM_VERIFIED_METADATA_ONLY_WITH_FROZEN_LIFECYCLE_ABSENCE",
        "publisher": "Binance public-data monthly USD-M archive",
        "sourceRoot": "EXTERNAL_READ_ONLY_BINANCE_PUBLIC_MONTHLY_ARCHIVE",
        "universeSha256": sha256_file(UNIVERSE_PATH),
        "declaredEntryCount": declared,
        "entryCount": len(entries),
        "lifecycleAbsenceCount": len(lifecycle_absences),
        "lifecycleCutoffs": dict(sorted(lifecycle_cutoffs.items())),
        "entries": entries,
        "lifecycleAbsences": lifecycle_absences,
    }
    write_json(MANIFEST_PATH, result)
    return result


def build_trial_ledger() -> dict[str, Any]:
    protocol = load_json(PROTOCOL_PATH)
    spec = protocol["trials"]
    trials: list[dict[str, Any]] = []
    for lookback, z_value, rate, settlements in itertools.product(
        spec["lookbackFundingObservations"],
        spec["absoluteZEntry"],
        spec["minimumAbsoluteNormalizedFundingBp"],
        spec["maximumSubsequentFundingSettlements"],
    ):
        trial_id = (
            f"s1m-l{int(lookback):03d}-z{int(Decimal(str(z_value)) * 100):03d}"
            f"-r{int(Decimal(str(rate))):03d}-h{int(settlements):02d}"
        )
        trials.append(
            {
                "trialId": trial_id,
                "lookbackFundingObservations": int(lookback),
                "absoluteZEntry": str(z_value),
                "minimumAbsoluteNormalizedFundingBp": str(rate),
                "maximumSubsequentFundingSettlements": int(settlements),
            }
        )
    trials.sort(key=lambda row: str(row["trialId"]))
    if len(trials) != 16 or len({str(row["trialId"]) for row in trials}) != 16:
        raise ExperimentError("TRIAL_LEDGER_NOT_EXACTLY_16")
    result = {
        "schema": "cosmos.quant.research.s1m.trial-ledger.v1",
        "status": "FROZEN_COMPLETE_FAMILY",
        "count": len(trials),
        "selectionMetric": spec["selectionMetric"],
        "tieBreak": spec["tieBreak"],
        "trials": trials,
    }
    write_json(LEDGER_PATH, result)
    return result


def git_output(*arguments: str) -> str:
    try:
        process = subprocess.run(
            ["git", *arguments],
            cwd=PACKET_DIR,
            check=True,
            capture_output=True,
            text=True,
        )
    except (OSError, subprocess.CalledProcessError) as exc:
        raise ExperimentError(f"GIT_CHECK_FAILED:{arguments}:{exc}") from exc
    return process.stdout.strip()


def assert_scope() -> None:
    top = Path(git_output("rev-parse", "--show-toplevel")).resolve()
    expected = (top / "quant" / "research" / "s1m").resolve()
    if expected != PACKET_DIR:
        raise ExperimentError(f"PACKET_SCOPE_INVALID:{PACKET_DIR}")
    status = git_output("status", "--porcelain=v1", "--untracked-files=all")
    for line in status.splitlines():
        relative = line[3:]
        if " -> " in relative:
            relative = relative.split(" -> ", 1)[1]
        if not relative.startswith("quant/research/s1m/"):
            raise ExperimentError(f"OUT_OF_SCOPE_WORKTREE_CHANGE:{relative}")


def freeze_packet() -> dict[str, Any]:
    assert_scope()
    if git_output("rev-parse", "HEAD") != BASE_COMMIT:
        raise ExperimentError("FREEZE_PARENT_NOT_EXACT_BASE")
    for path in (
        RUN_MARKER_PATH,
        DEVELOPMENT_PATH,
        CANDIDATE_PATH,
        HOLDOUT_MARKER_PATH,
        RESULT_PATH,
        SHA_PATH,
    ):
        if path.exists():
            raise ExperimentError(f"FREEZE_AFTER_OUTCOME_ARTIFACT:{path.name}")
    universe = load_json(UNIVERSE_PATH)
    manifest = load_json(MANIFEST_PATH)
    build_trial_ledger()
    if manifest.get("universeSha256") != sha256_file(UNIVERSE_PATH):
        raise ExperimentError("MANIFEST_UNIVERSE_BINDING_MISMATCH")
    declared = len(universe["symbols"]) * 15 * 3
    if int(manifest.get("declaredEntryCount", -1)) != declared:
        raise ExperimentError("MANIFEST_DECLARED_ENTRY_COUNT_MISMATCH")
    if (
        int(manifest.get("entryCount", -1)) + int(manifest.get("lifecycleAbsenceCount", -1))
        != declared
    ):
        raise ExperimentError("MANIFEST_ENTRY_COUNT_MISMATCH")
    bind_paths = [
        README_PATH,
        SOURCES_PATH,
        PROTOCOL_PATH,
        UNIVERSE_PATH,
        MANIFEST_PATH,
        LEDGER_PATH,
        Path(__file__).resolve(),
    ]
    if TEST_PATH.exists():
        bind_paths.append(TEST_PATH)
    if CUSTODY_BREACH_PATH.exists():
        bind_paths.append(CUSTODY_BREACH_PATH)
    bindings = {path.name: sha256_file(path) for path in sorted(bind_paths)}
    custody_invalid = CUSTODY_BREACH_PATH.exists()
    result = {
        "schema": "cosmos.quant.research.s1m.freeze.v1",
        "status": (
            "SEALED_CUSTODY_INVALID_HOLDOUT_PREOPEN" if custody_invalid else "SEALED_HOLDOUT_CLOSED"
        ),
        "createdAt": utc_now(),
        "baseCommit": BASE_COMMIT,
        "worktreeHeadAtFreeze": git_output("rev-parse", "HEAD"),
        "authority": "NONE",
        "accountEffectiveFees": "UNKNOWN",
        "holdoutState": (
            "UNOPENED_INVALIDATED_PREOPEN_ROWS_OBSERVED" if custody_invalid else "CLOSED_UNREAD"
        ),
        "bindings": bindings,
    }
    write_json(FREEZE_PATH, result)
    return result


def verify_freeze() -> dict[str, Any]:
    freeze = load_json(FREEZE_PATH)
    expected_status = (
        "SEALED_CUSTODY_INVALID_HOLDOUT_PREOPEN"
        if CUSTODY_BREACH_PATH.exists()
        else "SEALED_HOLDOUT_CLOSED"
    )
    if freeze.get("baseCommit") != BASE_COMMIT or freeze.get("status") != expected_status:
        raise ExperimentError("FREEZE_HEADER_INVALID")
    bindings = freeze.get("bindings")
    if not isinstance(bindings, dict):
        raise ExperimentError("FREEZE_BINDINGS_INVALID")
    required = {
        README_PATH.name,
        SOURCES_PATH.name,
        PROTOCOL_PATH.name,
        UNIVERSE_PATH.name,
        MANIFEST_PATH.name,
        LEDGER_PATH.name,
        Path(__file__).name,
    }
    if TEST_PATH.exists():
        required.add(TEST_PATH.name)
    if CUSTODY_BREACH_PATH.exists():
        required.add(CUSTODY_BREACH_PATH.name)
    if set(bindings) != required:
        raise ExperimentError("FREEZE_BINDING_SET_INVALID")
    for filename, expected in bindings.items():
        path = PACKET_DIR / str(filename)
        if not path.is_file() or sha256_file(path) != str(expected):
            raise ExperimentError(f"FREEZE_BINDING_DRIFT:{filename}")
    return freeze


def load_funding(
    reference: ArchiveRef, binding: Mapping[str, Mapping[str, Any]]
) -> list[FundingEvent]:
    events: list[FundingEvent] = []
    for row in iter_csv_rows(reference, binding):
        try:
            event = FundingEvent(
                symbol=reference.symbol,
                time_ms=int(row["calc_time"]),
                interval_hours=Decimal(row["funding_interval_hours"]),
                rate=Decimal(row["last_funding_rate"]),
            )
        except (InvalidOperation, ValueError) as exc:
            raise ExperimentError(f"FUNDING_PARSE:{reference.relative_zip}") from exc
        if event.interval_hours <= 0 or not event.rate.is_finite():
            raise ExperimentError(f"FUNDING_VALUE:{reference.relative_zip}")
        events.append(event)
    return events


def load_klines(reference: ArchiveRef, binding: Mapping[str, Mapping[str, Any]]) -> list[Kline]:
    rows: list[Kline] = []
    for row in iter_csv_rows(reference, binding):
        try:
            kline = Kline(
                open_time_ms=int(row["open_time"]),
                open=Decimal(row["open"]),
                high=Decimal(row["high"]),
                low=Decimal(row["low"]),
                close=Decimal(row["close"]),
                quote_volume=Decimal(row["quote_volume"]),
            )
        except (InvalidOperation, ValueError) as exc:
            raise ExperimentError(f"KLINE_PARSE:{reference.relative_zip}") from exc
        if (
            kline.open <= 0
            or kline.high <= 0
            or kline.low <= 0
            or kline.close <= 0
            or kline.quote_volume < 0
            or not all(
                value.is_finite()
                for value in (kline.open, kline.high, kline.low, kline.close, kline.quote_volume)
            )
        ):
            raise ExperimentError(f"KLINE_VALUE:{reference.relative_zip}")
        rows.append(kline)
    return rows


def validate_monotone_hours(symbol: str, product: str, rows: Mapping[int, Any]) -> None:
    keys = sorted(rows)
    if not keys:
        raise ExperimentError(f"EMPTY_SERIES:{symbol}:{product}")
    if len(keys) != len(rows):
        raise ExperimentError(f"DUPLICATE_HOUR:{symbol}:{product}")
    for prior, current in itertools.pairwise(keys):
        if current - prior != HOUR_MS:
            raise ExperimentError(f"HOURLY_GAP:{symbol}:{product}:{prior}:{current}")


def validate_funding_cadence(symbol: str, events: Sequence[FundingEvent]) -> None:
    if not events:
        raise ExperimentError(f"EMPTY_FUNDING:{symbol}")
    times = [event.time_ms for event in events]
    if times != sorted(times) or len(times) != len(set(times)):
        raise ExperimentError(f"FUNDING_ORDER_OR_DUPLICATE:{symbol}")
    for previous, current in itertools.pairwise(events):
        elapsed = current.time_ms - previous.time_ms
        expected_current = float(current.interval_hours) * HOUR_MS
        expected_previous = float(previous.interval_hours) * HOUR_MS
        if min(abs(elapsed - expected_current), abs(elapsed - expected_previous)) > 1_000:
            raise ExperimentError(f"FUNDING_CADENCE:{symbol}:{previous.time_ms}:{current.time_ms}")


def manifest_inventory() -> tuple[dict[str, Mapping[str, Any]], dict[str, Mapping[str, Any]]]:
    manifest = load_json(MANIFEST_PATH)
    entries = manifest.get("entries")
    if not isinstance(entries, list):
        raise ExperimentError("MANIFEST_ENTRIES_INVALID")
    binding: dict[str, Mapping[str, Any]] = {}
    for entry in entries:
        if not isinstance(entry, dict):
            raise ExperimentError("MANIFEST_ENTRY_INVALID")
        key = str(entry.get("publisherKey"))
        if key in binding:
            raise ExperimentError(f"MANIFEST_DUPLICATE_KEY:{key}")
        binding[key] = entry
    if len(binding) != int(manifest.get("entryCount", -1)):
        raise ExperimentError("MANIFEST_ENTRY_COUNT_INVALID")
    absences = manifest.get("lifecycleAbsences")
    if not isinstance(absences, list):
        raise ExperimentError("MANIFEST_LIFECYCLE_ABSENCES_INVALID")
    absence_binding: dict[str, Mapping[str, Any]] = {}
    for entry in absences:
        if not isinstance(entry, dict):
            raise ExperimentError("MANIFEST_LIFECYCLE_ABSENCE_ROW_INVALID")
        key = str(entry.get("publisherKey"))
        if key in absence_binding or key in binding:
            raise ExperimentError(f"MANIFEST_DUPLICATE_KEY:{key}")
        absence_binding[key] = entry
    if len(absence_binding) != int(manifest.get("lifecycleAbsenceCount", -1)):
        raise ExperimentError("MANIFEST_LIFECYCLE_ABSENCE_COUNT_INVALID")
    return binding, absence_binding


def month_hour_bounds(month: str) -> tuple[int, int]:
    start = datetime.strptime(month, "%Y-%m").replace(tzinfo=UTC)
    if start.month == 12:
        following = start.replace(year=start.year + 1, month=1)
    else:
        following = start.replace(month=start.month + 1)
    return int(start.timestamp() * 1000), int(following.timestamp() * 1000) - HOUR_MS


def validate_month_hours(symbol: str, product: str, month: str, rows: Sequence[Kline]) -> None:
    if not rows:
        raise ExperimentError(f"EMPTY_MONTH:{symbol}:{product}:{month}")
    expected_first, expected_last = month_hour_bounds(month)
    if rows[0].open_time_ms != expected_first or rows[-1].open_time_ms != expected_last:
        raise ExperimentError(
            f"MONTH_BOUNDARY_GAP:{symbol}:{product}:{month}:"
            f"{rows[0].open_time_ms}:{rows[-1].open_time_ms}"
        )


def load_market_data(
    shared_root: Path, symbols: Sequence[str], months: Sequence[str]
) -> MarketData:
    binding, absences = manifest_inventory()
    funding: dict[str, list[FundingEvent]] = {}
    contract: dict[str, dict[int, Kline]] = {}
    mark: dict[str, dict[int, Decimal]] = {}
    daily: dict[str, dict[int, Decimal]] = {}
    for symbol in symbols:
        funding_rows: list[FundingEvent] = []
        contract_rows: dict[int, Kline] = {}
        mark_rows: dict[int, Decimal] = {}
        daily_rows: dict[int, Decimal] = defaultdict(lambda: Decimal("0"))
        for month in months:
            references = {
                product: archive_ref(shared_root, symbol, product, month)
                for product in ("fundingRate", "klines", "markPriceKlines")
            }
            available = {
                product: references[product].relative_zip in binding for product in references
            }
            if not available["fundingRate"]:
                if any(available.values()):
                    raise ExperimentError(f"MANIFEST_LIFECYCLE_PARTIAL:{symbol}:{month}")
                for reference in references.values():
                    if reference.relative_zip not in absences:
                        raise ExperimentError(
                            f"MANIFEST_LIFECYCLE_ABSENCE_MISSING:{reference.relative_zip}"
                        )
                    if reference.zip_path.exists() or reference.checksum_path.exists():
                        raise ExperimentError(
                            f"FROZEN_LIFECYCLE_SOURCE_REAPPEARED:{reference.relative_zip}"
                        )
                continue
            if not all(available.values()):
                raise ExperimentError(f"MANIFEST_REQUIRED_PRODUCT_MISSING:{symbol}:{month}")
            funding_rows.extend(
                load_funding(
                    references["fundingRate"],
                    binding,
                )
            )
            contract_month = load_klines(references["klines"], binding)
            validate_month_hours(symbol, "contract", month, contract_month)
            for row in contract_month:
                if row.open_time_ms in contract_rows:
                    raise ExperimentError(f"DUPLICATE_CONTRACT_KLINE:{symbol}:{row.open_time_ms}")
                contract_rows[row.open_time_ms] = row
                day = (row.open_time_ms // DAY_MS) * DAY_MS
                daily_rows[day] += row.quote_volume
            mark_month = load_klines(references["markPriceKlines"], binding)
            validate_month_hours(symbol, "mark", month, mark_month)
            for row in mark_month:
                if row.open_time_ms in mark_rows:
                    raise ExperimentError(f"DUPLICATE_MARK_KLINE:{symbol}:{row.open_time_ms}")
                mark_rows[row.open_time_ms] = row.open
        validate_funding_cadence(symbol, funding_rows)
        validate_monotone_hours(symbol, "contract", contract_rows)
        validate_monotone_hours(symbol, "mark", mark_rows)
        funding[symbol] = funding_rows
        contract[symbol] = contract_rows
        mark[symbol] = mark_rows
        daily[symbol] = dict(daily_rows)
    return MarketData(funding=funding, contract=contract, mark=mark, daily_quote_volume=daily)


def median(values: Sequence[float]) -> float:
    if not values:
        raise ExperimentError("EMPTY_MEDIAN")
    return float(statistics.median(values))


def feature_map(data: MarketData, lookbacks: Iterable[int]) -> dict[int, dict[str, list[Feature]]]:
    answer: dict[int, dict[str, list[Feature]]] = {value: {} for value in lookbacks}
    for symbol, events in data.funding.items():
        normalized: list[float] = []
        velocity: list[float | None] = []
        acceleration: list[float | None] = []
        for index, event in enumerate(events):
            x_value = float(event.rate * Decimal("10000") * Decimal("8") / event.interval_hours)
            normalized.append(x_value)
            if index == 0:
                velocity.append(None)
                acceleration.append(None)
                continue
            elapsed = (event.time_ms - events[index - 1].time_ms) / (8 * HOUR_MS)
            if elapsed <= 0:
                raise ExperimentError(f"NONPOSITIVE_FUNDING_ELAPSED:{symbol}:{index}")
            current_velocity = (normalized[index] - normalized[index - 1]) / elapsed
            velocity.append(current_velocity)
            if index == 1:
                acceleration.append(None)
                continue
            previous_elapsed = (events[index - 1].time_ms - events[index - 2].time_ms) / (
                8 * HOUR_MS
            )
            previous_velocity = velocity[index - 1]
            if previous_velocity is None:
                raise ExperimentError("INTERNAL_VELOCITY_STATE")
            acceleration.append(
                (current_velocity - previous_velocity) / ((elapsed + previous_elapsed) / 2)
            )
        for lookback in lookbacks:
            features: list[Feature] = []
            for index, current_acceleration in enumerate(acceleration):
                if current_acceleration is None:
                    continue
                historical = [
                    float(value)
                    for value in acceleration[max(0, index - lookback) : index]
                    if value is not None
                ]
                if len(historical) != lookback:
                    continue
                location = median(historical)
                mad = median([abs(value - location) for value in historical])
                scale = max(1.4826 * mad, 0.05)
                z_value = (current_acceleration - location) / scale
                decision = (events[index].time_ms // HOUR_MS + 1) * HOUR_MS
                prior_hours = data.contract[symbol]
                volumes: list[Decimal] = []
                for hour in range(decision - 24 * HOUR_MS, decision, HOUR_MS):
                    row = prior_hours.get(hour)
                    if row is None:
                        raise ExperimentError(f"PRIOR_24H_GAP:{symbol}:{decision}:{hour}")
                    volumes.append(row.quote_volume)
                feature_velocity = velocity[index]
                if feature_velocity is None:
                    raise ExperimentError("INTERNAL_FEATURE_VELOCITY")
                features.append(
                    Feature(
                        symbol=symbol,
                        event_index=index,
                        time_ms=events[index].time_ms,
                        decision_ms=decision,
                        normalized_rate_bp=normalized[index],
                        velocity=feature_velocity,
                        acceleration=current_acceleration,
                        z=z_value,
                        prior_24h_quote_volume=float(sum(volumes, Decimal("0"))),
                    )
                )
            answer[lookback][symbol] = features
    return answer


def load_trials() -> list[Trial]:
    ledger = load_json(LEDGER_PATH)
    rows = ledger.get("trials")
    if not isinstance(rows, list) or len(rows) != 16:
        raise ExperimentError("TRIAL_LEDGER_INVALID")
    trials: list[Trial] = []
    for row in rows:
        if not isinstance(row, dict):
            raise ExperimentError("TRIAL_LEDGER_ROW_INVALID")
        trials.append(
            Trial(
                trial_id=str(row["trialId"]),
                lookback=int(row["lookbackFundingObservations"]),
                entry_z=float(row["absoluteZEntry"]),
                minimum_rate_bp=float(row["minimumAbsoluteNormalizedFundingBp"]),
                maximum_settlements=int(row["maximumSubsequentFundingSettlements"]),
            )
        )
    if len({trial.trial_id for trial in trials}) != 16:
        raise ExperimentError("TRIAL_LEDGER_IDS_INVALID")
    return sorted(trials, key=lambda trial: trial.trial_id)


def same_nonzero_sign(*values: float) -> bool:
    return all(value > 0 for value in values) or all(value < 0 for value in values)


def adjusted_funding(cash_flows: Sequence[tuple[int, Decimal]], scenario: str) -> Decimal:
    total = Decimal("0")
    for _, cash in cash_flows:
        if scenario == "base":
            multiplier = Decimal("1")
        elif scenario == "stress":
            multiplier = Decimal("0.5") if cash >= 0 else Decimal("1.5")
        elif scenario == "severe":
            multiplier = Decimal("0") if cash >= 0 else Decimal("2")
        else:
            raise ExperimentError(f"UNKNOWN_SCENARIO:{scenario}")
        total += cash * multiplier
    return total


def scenario_rates(scenario: str) -> tuple[Decimal, Decimal]:
    if scenario == "base":
        return Decimal("0.0004"), Decimal("0.0002")
    if scenario == "stress":
        return Decimal("0.0008"), Decimal("0.0005")
    if scenario == "severe":
        return Decimal("0.0010"), Decimal("0.0010")
    raise ExperimentError(f"UNKNOWN_SCENARIO:{scenario}")


def taker_economics(
    side: int,
    quantity: Decimal,
    entry_price: Decimal,
    exit_price: Decimal,
    cash_flows: Sequence[tuple[int, Decimal]],
    scenario: str,
) -> tuple[Decimal, dict[str, Decimal]]:
    fee_rate, execution_rate = scenario_rates(scenario)
    entry_notional = abs(quantity * entry_price)
    exit_notional = abs(quantity * exit_price)
    fill_notional = entry_notional + exit_notional
    price_gross = Decimal(side) * quantity * (exit_price - entry_price)
    funding = adjusted_funding(cash_flows, scenario)
    fees = fee_rate * fill_notional
    execution = execution_rate * fill_notional
    net = price_gross + funding - fees - execution
    return net, {
        "priceGrossUsd": price_gross,
        "adjustedFundingUsd": funding,
        "feesUsd": fees,
        "adverseExecutionUsd": execution,
        "netUsd": net,
    }


def maker_diagnostic(
    side: int,
    entry_reference: Decimal,
    exit_price: Decimal,
    entry_hour: Kline,
    cash_flow_events: Sequence[FundingEvent],
    mark: Mapping[int, Decimal],
) -> tuple[bool, Decimal | None]:
    one_bp = Decimal("0.0001")
    half_bp = Decimal("0.00005")
    if side == 1:
        limit = entry_reference * (Decimal("1") - one_bp)
        filled = entry_hour.low <= limit * (Decimal("1") - half_bp)
    else:
        limit = entry_reference * (Decimal("1") + one_bp)
        filled = entry_hour.high >= limit * (Decimal("1") + half_bp)
    if not filled:
        return False, None
    quantity = NOTIONAL / limit
    cash_flows: list[tuple[int, Decimal]] = []
    for event in cash_flow_events:
        mark_hour = (event.time_ms // HOUR_MS) * HOUR_MS
        mark_price = mark.get(mark_hour)
        if mark_price is None:
            raise ExperimentError(f"MAKER_FUNDING_MARK_GAP:{event.symbol}:{event.time_ms}")
        cash_flows.append(
            (
                event.time_ms,
                -Decimal(side) * quantity * mark_price * event.rate,
            )
        )
    price_gross = Decimal(side) * quantity * (exit_price - limit)
    funding = adjusted_funding(cash_flows, "base")
    entry_cost = NOTIONAL * (Decimal("0.0002") + Decimal("0.0001"))
    exit_notional = abs(quantity * exit_price)
    exit_cost = exit_notional * (Decimal("0.0004") + Decimal("0.0002"))
    return True, price_gross + funding - entry_cost - exit_cost


def capacity_proxy(
    symbol: str,
    entry_time_ms: int,
    daily_quote_volume: Mapping[str, Mapping[int, Decimal]],
) -> Decimal:
    entry_day = (entry_time_ms // DAY_MS) * DAY_MS
    prior_days = [entry_day - offset * DAY_MS for offset in range(1, 8)]
    values: list[Decimal] = []
    for day in prior_days:
        value = daily_quote_volume[symbol].get(day)
        if value is None:
            raise ExperimentError(f"CAPACITY_DAY_GAP:{symbol}:{day}")
        values.append(value)
    prior = values[0]
    rolling_median = Decimal(str(statistics.median(values)))
    return min(prior, rolling_median) * Decimal("0.00005")


def feature_by_event(features: Sequence[Feature]) -> dict[int, Feature]:
    return {feature.event_index: feature for feature in features}


def find_exit_event(
    feature: Feature,
    trial: Trial,
    events: Sequence[FundingEvent],
    features: Mapping[int, Feature],
    partition_end_ms: int,
) -> tuple[int, FundingEvent] | None:
    for later_count, index in enumerate(range(feature.event_index + 1, len(events)), start=1):
        event = events[index]
        if event.time_ms >= partition_end_ms:
            return None
        later_feature = features.get(index)
        reversal = (
            later_feature is not None and later_feature.acceleration * feature.acceleration < 0
        )
        normalized = later_feature is not None and abs(later_feature.z) <= 0.5
        if reversal or normalized or later_count >= trial.maximum_settlements:
            exit_time = (event.time_ms // HOUR_MS + 1) * HOUR_MS
            if exit_time >= partition_end_ms:
                return None
            return index, event
    return None


def build_trade(
    data: MarketData,
    feature: Feature,
    trial: Trial,
    event_features: Mapping[int, Feature],
    partition_end_ms: int,
) -> Trade | None:
    events = data.funding[feature.symbol]
    exit_pair = find_exit_event(feature, trial, events, event_features, partition_end_ms)
    if exit_pair is None:
        raise ExperimentError(
            f"SELECTED_SIGNAL_WITHOUT_CAUSAL_EXIT:{feature.symbol}:{feature.time_ms}"
        )
    exit_index, exit_event = exit_pair
    side = -1 if feature.normalized_rate_bp > 0 else 1
    contract = data.contract[feature.symbol]
    entry_row = contract.get(feature.decision_ms)
    exit_time = (exit_event.time_ms // HOUR_MS + 1) * HOUR_MS
    exit_row = contract.get(exit_time)
    if entry_row is None or exit_row is None:
        raise ExperimentError(
            f"CAUSAL_ENTRY_EXIT_GAP:{feature.symbol}:{feature.decision_ms}:{exit_time}"
        )
    quantity = NOTIONAL / entry_row.open
    funding_events = list(events[feature.event_index + 1 : exit_index + 1])
    cash_flows: list[tuple[int, Decimal]] = []
    for event in funding_events:
        mark_hour = (event.time_ms // HOUR_MS) * HOUR_MS
        mark_price = data.mark[feature.symbol].get(mark_hour)
        if mark_price is None:
            raise ExperimentError(f"FUNDING_MARK_GAP:{feature.symbol}:{event.time_ms}")
        cash_flows.append(
            (
                event.time_ms,
                -Decimal(side) * quantity * mark_price * event.rate,
            )
        )
    base_net, base_parts = taker_economics(
        side, quantity, entry_row.open, exit_row.open, cash_flows, "base"
    )
    stress_net, stress_parts = taker_economics(
        side, quantity, entry_row.open, exit_row.open, cash_flows, "stress"
    )
    severe_net, severe_parts = taker_economics(
        side, quantity, entry_row.open, exit_row.open, cash_flows, "severe"
    )
    maker_filled, maker_net = maker_diagnostic(
        side,
        entry_row.open,
        exit_row.open,
        entry_row,
        funding_events,
        data.mark[feature.symbol],
    )
    return Trade(
        symbol=feature.symbol,
        side=side,
        signal_time_ms=feature.time_ms,
        entry_time_ms=feature.decision_ms,
        exit_signal_time_ms=exit_event.time_ms,
        exit_time_ms=exit_time,
        entry_price=entry_row.open,
        exit_price=exit_row.open,
        quantity=quantity,
        funding_cash_flows=tuple(cash_flows),
        capacity_proxy_usd=capacity_proxy(
            feature.symbol, feature.decision_ms, data.daily_quote_volume
        ),
        base_net=base_net,
        stress_net=stress_net,
        severe_net=severe_net,
        base_decomposition=base_parts,
        stress_decomposition=stress_parts,
        severe_decomposition=severe_parts,
        maker_filled=maker_filled,
        maker_net=maker_net,
    )


def signal_candidates(
    data: MarketData,
    trial: Trial,
    features: Mapping[str, Sequence[Feature]],
    partition_start_ms: int,
    partition_end_ms: int,
) -> dict[int, list[Feature]]:
    grouped: dict[int, list[Feature]] = defaultdict(list)
    for symbol in sorted(features):
        for feature in features[symbol]:
            if not (partition_start_ms <= feature.time_ms < partition_end_ms):
                continue
            if abs(feature.z) < trial.entry_z:
                continue
            if abs(feature.normalized_rate_bp) < trial.minimum_rate_bp:
                continue
            if not same_nonzero_sign(
                feature.normalized_rate_bp, feature.velocity, feature.acceleration
            ):
                continue
            causal_latest_exit = (
                feature.decision_ms + (trial.maximum_settlements * 24 + 1) * HOUR_MS
            )
            if causal_latest_exit >= partition_end_ms:
                continue
            grouped[feature.decision_ms].append(feature)
    return grouped


def evaluate_trial(
    data: MarketData,
    trial: Trial,
    features: Mapping[str, Sequence[Feature]],
    partition_start_ms: int,
    partition_end_ms: int,
) -> list[Trade]:
    grouped = signal_candidates(data, trial, features, partition_start_ms, partition_end_ms)
    maps = {symbol: feature_by_event(rows) for symbol, rows in features.items()}
    trades: list[Trade] = []
    occupied_until = partition_start_ms
    last_close_event: dict[str, int] = {}
    for decision_time in sorted(grouped):
        if decision_time < occupied_until:
            continue
        eligible: list[Feature] = []
        for feature in grouped[decision_time]:
            closed_at = last_close_event.get(feature.symbol)
            if closed_at is not None:
                rearmed = any(
                    candidate.time_ms > closed_at
                    and candidate.time_ms < feature.time_ms
                    and abs(candidate.z) < 1
                    for candidate in features[feature.symbol]
                )
                if not rearmed:
                    continue
            eligible.append(feature)
        if not eligible:
            continue
        eligible.sort(
            key=lambda feature: (
                -abs(feature.z),
                -feature.prior_24h_quote_volume,
                feature.symbol,
            )
        )
        selected = eligible[0]
        trade = build_trade(data, selected, trial, maps[selected.symbol], partition_end_ms)
        if trade is None:
            continue
        trades.append(trade)
        occupied_until = trade.exit_time_ms
        last_close_event[trade.symbol] = trade.exit_signal_time_ms
    return trades


def partition_days(start_ms: int, end_ms: int) -> list[int]:
    first = (start_ms // DAY_MS) * DAY_MS
    return list(range(first, end_ms, DAY_MS))


def daily_series(trades: Sequence[Trade], start_ms: int, end_ms: int, scenario: str) -> list[float]:
    days = partition_days(start_ms, end_ms)
    index = {day: position for position, day in enumerate(days)}
    values = [0.0 for _ in days]
    attribute = f"{scenario}_net"
    for trade in trades:
        day = (trade.exit_time_ms // DAY_MS) * DAY_MS
        if day not in index:
            raise ExperimentError(f"TRADE_EXIT_OUTSIDE_PARTITION:{trade.symbol}:{day}")
        values[index[day]] += float(getattr(trade, attribute))
    return values


def drawdown(
    trades: Sequence[Trade],
    data: MarketData,
    scenario: str,
) -> tuple[Decimal, Decimal]:
    realized = Decimal("0")
    peak = Decimal("0")
    maximum = Decimal("0")
    fee_rate, execution_rate = scenario_rates(scenario)
    for trade in trades:
        entry_cost = NOTIONAL * (fee_rate + execution_rate)
        for hour in range(trade.entry_time_ms, trade.exit_time_ms, HOUR_MS):
            mark_price = data.mark[trade.symbol].get(hour)
            if mark_price is None:
                raise ExperimentError(f"DRAWDOWN_MARK_GAP:{trade.symbol}:{hour}")
            settled = adjusted_funding(
                [cash for cash in trade.funding_cash_flows if cash[0] <= hour], scenario
            )
            unrealized = Decimal(trade.side) * trade.quantity * (mark_price - trade.entry_price)
            reserve_exit = abs(trade.quantity * mark_price) * (fee_rate + execution_rate)
            equity = realized - entry_cost + unrealized + settled - reserve_exit
            peak = max(peak, equity)
            maximum = max(maximum, peak - equity)
        realized += getattr(trade, f"{scenario}_net")
        peak = max(peak, realized)
        maximum = max(maximum, peak - realized)
    return maximum, maximum / NOTIONAL


def percentile(values: Sequence[float], q_value: float) -> float:
    if not values:
        raise ExperimentError("EMPTY_PERCENTILE")
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, math.ceil(q_value * len(ordered)) - 1))
    return ordered[index]


def summarize_trial(
    trial: Trial,
    trades: Sequence[Trade],
    data: MarketData,
    start_ms: int,
    end_ms: int,
) -> dict[str, Any]:
    base_total = sum((trade.base_net for trade in trades), Decimal("0"))
    stress_total = sum((trade.stress_net for trade in trades), Decimal("0"))
    severe_total = sum((trade.severe_net for trade in trades), Decimal("0"))
    base_dd, base_dd_fraction = drawdown(trades, data, "base")
    stress_dd, stress_dd_fraction = drawdown(trades, data, "stress")
    exits = [datetime.fromtimestamp(trade.exit_time_ms / 1000, tz=UTC) for trade in trades]
    symbol_stress: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
    month_stress: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
    for trade, exit_time in zip(trades, exits, strict=True):
        symbol_stress[trade.symbol] += trade.stress_net
        month_stress[exit_time.strftime("%Y-%m")] += trade.stress_net
    best_symbol = max([Decimal("0"), *symbol_stress.values()])
    best_month = max([Decimal("0"), *month_stress.values()])
    capacities = sorted(trade.capacity_proxy_usd for trade in trades)
    capacity_min = capacities[0] if capacities else None
    capacity_median = Decimal(str(statistics.median(capacities))) if capacities else None
    capacity_p5 = (
        Decimal(str(percentile([float(value) for value in capacities], 0.05)))
        if capacities
        else None
    )
    decomposition: dict[str, dict[str, str]] = {}
    for scenario in ("base", "stress", "severe"):
        parts: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
        for trade in trades:
            source = getattr(trade, f"{scenario}_decomposition")
            for key, value in source.items():
                parts[key] += value
        decomposition[scenario] = {
            key: str(decimal_text(value)) for key, value in sorted(parts.items())
        }
    maker_values = [trade.maker_net for trade in trades if trade.maker_net is not None]
    raw_daily_stress = daily_series(trades, start_ms, end_ms, "stress")
    return {
        "trialId": trial.trial_id,
        "parameters": {
            "lookback": trial.lookback,
            "entryZ": trial.entry_z,
            "minimumRateBp": trial.minimum_rate_bp,
            "maximumSettlements": trial.maximum_settlements,
        },
        "completedTrades": len(trades),
        "activeWeeks": len(
            {(value.isocalendar().year, value.isocalendar().week) for value in exits}
        ),
        "symbols": len({trade.symbol for trade in trades}),
        "longTrades": sum(trade.side == 1 for trade in trades),
        "shortTrades": sum(trade.side == -1 for trade in trades),
        "baseNetUsdPerOriginal1000": decimal_text(base_total),
        "stressNetUsdPerOriginal1000": decimal_text(stress_total),
        "severeNetUsdPerOriginal1000": decimal_text(severe_total),
        "baseDrawdownUsd": decimal_text(base_dd),
        "baseDrawdownFraction": decimal_text(base_dd_fraction),
        "stressDrawdownUsd": decimal_text(stress_dd),
        "stressDrawdownFraction": decimal_text(stress_dd_fraction),
        "removeBestSymbolStressNetUsd": decimal_text(stress_total - best_symbol),
        "removeBestMonthStressNetUsd": decimal_text(stress_total - best_month),
        "capacity": {
            "state": "PUBLIC_QUOTE_VOLUME_PROXY",
            "minimumUsd": decimal_text(capacity_min),
            "medianUsd": decimal_text(capacity_median),
            "fifthPercentileUsd": decimal_text(capacity_p5),
            "everyTradePasses1000": bool(capacities)
            and all(value >= NOTIONAL for value in capacities),
            "executableCapacity": "UNKNOWN",
        },
        "makerDiagnostic": {
            "state": "HOURLY_STRICT_TRADE_THROUGH_PROXY_NOT_QUEUE_PROOF",
            "fills": len(maker_values),
            "netUsdPerOriginal1000": decimal_text(
                sum((value for value in maker_values if value is not None), Decimal("0"))
            )
            if maker_values
            else None,
        },
        "decomposition": decomposition,
        "dailyStressNetUsd": [float_text(value) for value in raw_daily_stress],
        "_baseNet": base_total,
        "_stressNet": stress_total,
        "_severeNet": severe_total,
        "_baseDrawdown": base_dd,
        "_baseDrawdownFraction": base_dd_fraction,
        "_stressDrawdown": stress_dd,
        "_stressDrawdownFraction": stress_dd_fraction,
        "_removeBestSymbolStress": stress_total - best_symbol,
        "_removeBestMonthStress": stress_total - best_month,
        "_dailyStressNetUsd": raw_daily_stress,
    }


def circular_indices(rng: random.Random, length: int, block_days: int) -> list[int]:
    indices: list[int] = []
    while len(indices) < length:
        start = rng.randrange(length)
        indices.extend((start + offset) % length for offset in range(block_days))
    return indices[:length]


def bootstrap_family(
    series_by_trial: Mapping[str, Sequence[float]],
    *,
    replicates: int = 4096,
    block_days: int = 7,
    seed: int = 2026072901,
) -> dict[str, dict[str, Any]]:
    trial_ids = sorted(series_by_trial)
    if len(trial_ids) != 16:
        raise ExperimentError(f"BOOTSTRAP_FAMILY_SIZE:{len(trial_ids)}")
    lengths = {len(series_by_trial[trial_id]) for trial_id in trial_ids}
    if len(lengths) != 1:
        raise ExperimentError("BOOTSTRAP_UNEQUAL_LENGTHS")
    length = lengths.pop()
    if length == 0:
        raise ExperimentError("BOOTSTRAP_EMPTY_SERIES")
    observed = {trial_id: sum(series_by_trial[trial_id]) for trial_id in trial_ids}
    centered = {
        trial_id: [value - observed[trial_id] / length for value in series_by_trial[trial_id]]
        for trial_id in trial_ids
    }
    samples: dict[str, list[float]] = {trial_id: [] for trial_id in trial_ids}
    null_exceedances = dict.fromkeys(trial_ids, 0)
    rng = random.Random(seed)
    for _ in range(replicates):
        indices = circular_indices(rng, length, block_days)
        for trial_id in trial_ids:
            sampled = sum(series_by_trial[trial_id][index] for index in indices)
            samples[trial_id].append(sampled)
            null_total = sum(centered[trial_id][index] for index in indices)
            if null_total >= observed[trial_id]:
                null_exceedances[trial_id] += 1
    family_q = 0.05 / len(trial_ids)
    result: dict[str, dict[str, Any]] = {}
    for trial_id in trial_ids:
        p_value = (1 + null_exceedances[trial_id]) / (replicates + 1)
        lower_bound = percentile(samples[trial_id], family_q)
        result[trial_id] = {
            "observedTotal": float_text(observed[trial_id]),
            "oneSidedPValue": float_text(p_value, 12),
            "familywiseLowerBound": float_text(lower_bound),
            "_oneSidedPValue": p_value,
            "_familywiseLowerBound": lower_bound,
        }
    ordered = sorted(
        trial_ids,
        key=lambda trial_id: (
            float(result[trial_id]["_oneSidedPValue"]),
            trial_id,
        ),
    )
    still_rejecting = True
    for rank, trial_id in enumerate(ordered):
        threshold = 0.05 / (len(trial_ids) - rank)
        p_value = float(result[trial_id]["_oneSidedPValue"])
        rejected = still_rejecting and p_value <= threshold
        if not rejected:
            still_rejecting = False
        result[trial_id]["holmRank"] = rank + 1
        result[trial_id]["holmThreshold"] = float_text(threshold, 12)
        result[trial_id]["holmRejected"] = rejected
    return result


def bootstrap_interval(
    values: Sequence[float],
    *,
    replicates: int = 4096,
    block_days: int = 7,
    seed: int = 2026072901,
) -> tuple[float, float]:
    if not values:
        raise ExperimentError("BOOTSTRAP_INTERVAL_EMPTY")
    rng = random.Random(seed)
    samples = [
        sum(values[index] for index in circular_indices(rng, len(values), block_days))
        for _ in range(replicates)
    ]
    return percentile(samples, 0.025), percentile(samples, 0.975)


def pbo(series_by_trial: Mapping[str, Sequence[float]]) -> dict[str, Any]:
    trial_ids = sorted(series_by_trial)
    if len(trial_ids) != 16:
        raise ExperimentError("PBO_FAMILY_SIZE")
    if any(len(series_by_trial[trial_id]) < 264 for trial_id in trial_ids):
        raise ExperimentError("PBO_INSUFFICIENT_DAYS")
    core = {trial_id: list(series_by_trial[trial_id][-264:]) for trial_id in trial_ids}
    blocks = [list(range(index * 22, (index + 1) * 22)) for index in range(12)]
    overfit = 0
    logits: list[float] = []
    split_count = 0
    for in_sample_blocks in itertools.combinations(range(12), 6):
        in_set = set(in_sample_blocks)
        in_indices = [index for block in in_set for index in blocks[block]]
        out_indices = [
            index for block in range(12) if block not in in_set for index in blocks[block]
        ]
        in_metrics = {
            trial_id: sum(core[trial_id][index] for index in in_indices) / len(in_indices)
            for trial_id in trial_ids
        }
        selected = min(trial_ids, key=lambda trial_id: (-in_metrics[trial_id], trial_id))
        out_metrics = {
            trial_id: sum(core[trial_id][index] for index in out_indices) / len(out_indices)
            for trial_id in trial_ids
        }
        ranked = sorted(trial_ids, key=lambda trial_id: (-out_metrics[trial_id], trial_id))
        rank = ranked.index(selected) + 1
        omega = (17 - rank) / 17
        logits.append(math.log(omega / (1 - omega)))
        overfit += rank > 8
        split_count += 1
    if split_count != 924:
        raise ExperimentError(f"PBO_SPLIT_COUNT:{split_count}")
    return {
        "state": "MEASURED_DIAGNOSTIC_ONLY",
        "coreDays": 264,
        "blocks": 12,
        "splits": split_count,
        "overfitEvents": overfit,
        "pbo": float_text(overfit / split_count, 12),
        "medianLogit": float_text(float(statistics.median(logits)), 12),
        "thresholdDiagnostic": "0.20",
        "thresholdPass": overfit / split_count <= 0.20,
    }


def champion_id(summaries: Mapping[str, Mapping[str, Any]]) -> str:
    return min(
        summaries,
        key=lambda trial_id: (
            -Decimal(summaries[trial_id]["_stressNet"]),
            Decimal(summaries[trial_id]["_stressDrawdownFraction"]),
            trial_id,
        ),
    )


def development_gates(
    summary: Mapping[str, Any], multiplicity: Mapping[str, Any]
) -> dict[str, bool]:
    capacity = summary["capacity"]
    return {
        "minimumCompletedTakerTrades": int(summary["completedTrades"]) >= 60,
        "minimumActiveWeeks": int(summary["activeWeeks"]) >= 20,
        "minimumSymbols": int(summary["symbols"]) >= 8,
        "minimumLongTrades": int(summary["longTrades"]) >= 20,
        "minimumShortTrades": int(summary["shortTrades"]) >= 20,
        "baseNetPositive": Decimal(summary["_baseNet"]) > 0,
        "stressNetPositive": Decimal(summary["_stressNet"]) > 0,
        "familywiseLowerBoundPositive": float(multiplicity["_familywiseLowerBound"]) > 0,
        "holmPass": bool(multiplicity["holmRejected"]),
        "removeBestSymbolStressPositive": Decimal(summary["_removeBestSymbolStress"]) > 0,
        "removeBestMonthStressPositive": Decimal(summary["_removeBestMonthStress"]) > 0,
        "maximumStressDrawdownFraction": Decimal(summary["_stressDrawdownFraction"])
        <= Decimal("0.10"),
        "capacityProxyPass": bool(capacity["everyTradePasses1000"]),
    }


def holdout_gates(summary: Mapping[str, Any], interval: tuple[float, float]) -> dict[str, bool]:
    capacity = summary["capacity"]
    return {
        "minimumCompletedTakerTrades": int(summary["completedTrades"]) >= 20,
        "minimumActiveWeeks": int(summary["activeWeeks"]) >= 8,
        "minimumSymbols": int(summary["symbols"]) >= 5,
        "minimumLongTrades": int(summary["longTrades"]) >= 5,
        "minimumShortTrades": int(summary["shortTrades"]) >= 5,
        "baseNetPositive": Decimal(summary["_baseNet"]) > 0,
        "stressNetPositive": Decimal(summary["_stressNet"]) > 0,
        "stress95PercentLowerBoundPositive": interval[0] > 0,
        "removeBestSymbolStressPositive": Decimal(summary["_removeBestSymbolStress"]) > 0,
        "removeBestMonthStressPositive": Decimal(summary["_removeBestMonthStress"]) > 0,
        "maximumStressDrawdownFraction": Decimal(summary["_stressDrawdownFraction"])
        <= Decimal("0.10"),
        "capacityProxyPass": bool(capacity["everyTradePasses1000"]),
    }


def public_value(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: public_value(item) for key, item in value.items() if not str(key).startswith("_")
        }
    if isinstance(value, list):
        return [public_value(item) for item in value]
    return value


def trade_json(trade: Trade) -> dict[str, Any]:
    return {
        "symbol": trade.symbol,
        "side": "LONG" if trade.side == 1 else "SHORT",
        "signalTimeMs": trade.signal_time_ms,
        "entryTimeMs": trade.entry_time_ms,
        "exitSignalTimeMs": trade.exit_signal_time_ms,
        "exitTimeMs": trade.exit_time_ms,
        "entryPrice": format(trade.entry_price, "f"),
        "exitPrice": format(trade.exit_price, "f"),
        "quantity": format(trade.quantity, "f"),
        "fundingCashFlows": [
            {"timeMs": time_ms, "cashUsd": decimal_text(cash)}
            for time_ms, cash in trade.funding_cash_flows
        ],
        "baseNetUsd": decimal_text(trade.base_net),
        "stressNetUsd": decimal_text(trade.stress_net),
        "severeNetUsd": decimal_text(trade.severe_net),
        "capacityProxyUsd": decimal_text(trade.capacity_proxy_usd),
        "makerFilledProxy": trade.maker_filled,
        "makerNetUsd": decimal_text(trade.maker_net),
    }


def static_limitations() -> list[str]:
    return [
        "HOLDOUT_PREOPEN_ROW_ACCESS_INVALIDATED_SEALED_ECONOMIC_EVALUATION",
        "ACCOUNT_EFFECTIVE_FEES_UNKNOWN_SIGNED_USER_DATA_NOT_ACCESSED",
        "FUNDING_RATE_TYPE_ARCHIVE_FIELD_UNAVAILABLE",
        "SETTLEMENT_MARK_ARCHIVE_FIELD_UNAVAILABLE_HOURLY_MARK_OPEN_PROXY",
        "MAKER_QUEUE_POST_ONLY_PARTIAL_FILL_AND_DEPTH_UNKNOWN",
        "INTRAHOUR_DRAWDOWN_UNKNOWN_HOURLY_MARK_PROXY_ONLY",
        "HISTORICAL_FILTERS_MARGIN_AND_EXECUTABLE_CAPACITY_UNKNOWN",
        "PUBLIC_PROXY_HAS_NO_ORDER_OR_CAPITAL_AUTHORITY",
    ]


def provenance(freeze: Mapping[str, Any], producer_head: str) -> dict[str, Any]:
    return {
        "baseCommit": BASE_COMMIT,
        "producerHead": producer_head,
        "freezeSha256": sha256_file(FREEZE_PATH),
        "protocolSha256": sha256_file(PROTOCOL_PATH),
        "evaluatorSha256": sha256_file(Path(__file__).resolve()),
        "universeSha256": sha256_file(UNIVERSE_PATH),
        "sourceManifestSha256": sha256_file(MANIFEST_PATH),
        "trialLedgerSha256": sha256_file(LEDGER_PATH),
        "freezeBindings": freeze["bindings"],
    }


def build_unmeasured_result(
    freeze: Mapping[str, Any], producer_head: str, reason: str
) -> dict[str, Any]:
    return {
        "schema": "cosmos.quant.research.s1m.result.v1",
        "milestone": "S-1M",
        "terminalState": "UNMEASURED",
        "capitalVerdict": "NO_GO",
        "reasonCodes": [reason],
        "consumer": "N3 successor / orchestrator scoreboard",
        "authority": "NONE",
        "headlinePartition": None,
        "headline": {
            "baseNetUsdPerOriginal1000": None,
            "stressNetUsdPerOriginal1000": None,
            "severeNetUsdPerOriginal1000": None,
        },
        "holdout": {
            "state": (
                "UNOPENED_INVALIDATED_PREOPEN_ROW_ACCESS"
                if CUSTODY_BREACH_PATH.exists()
                else "UNOPENED_OR_INVALID"
            ),
            "stress95PercentIntervalUsdPerOriginal1000": None,
        },
        "multiplicity": None,
        "pbo": None,
        "drawdown": None,
        "capacity": {
            "state": "UNMEASURED",
            "executableCapacity": "UNKNOWN",
        },
        "crediblePositiveCount": None,
        "accountEffectiveFees": "UNKNOWN",
        "fundingRateTypeState": "ARCHIVE_FIELD_UNAVAILABLE",
        "makerEntryState": "UNMEASURED",
        "limitations": static_limitations(),
        "provenance": provenance(freeze, producer_head),
        "markers": {
            "runConsumed": RUN_MARKER_PATH.exists(),
            "candidateSealed": CANDIDATE_PATH.exists(),
            "holdoutOpened": HOLDOUT_MARKER_PATH.exists(),
        },
    }


def optional_hash(path: Path) -> str | None:
    return sha256_file(path) if path.is_file() else None


def build_precheck_unmeasured_result(producer_head: str, reason: str) -> dict[str, Any]:
    return {
        "schema": "cosmos.quant.research.s1m.result.v1",
        "milestone": "S-1M",
        "terminalState": "UNMEASURED",
        "capitalVerdict": "NO_GO",
        "reasonCodes": [f"PRE_OUTCOME_FREEZE_OR_COMMIT_INVALID:{reason}"],
        "consumer": "N3 successor / orchestrator scoreboard",
        "authority": "NONE",
        "headlinePartition": None,
        "headline": {
            "baseNetUsdPerOriginal1000": None,
            "stressNetUsdPerOriginal1000": None,
            "severeNetUsdPerOriginal1000": None,
        },
        "holdout": {
            "state": "UNOPENED_PRECHECK_FAILED",
            "stress95PercentIntervalUsdPerOriginal1000": None,
        },
        "multiplicity": None,
        "pbo": None,
        "drawdown": None,
        "capacity": {"state": "UNMEASURED", "executableCapacity": "UNKNOWN"},
        "crediblePositiveCount": None,
        "accountEffectiveFees": "UNKNOWN",
        "fundingRateTypeState": "ARCHIVE_FIELD_UNAVAILABLE",
        "makerEntryState": "UNMEASURED",
        "limitations": static_limitations(),
        "provenance": {
            "baseCommit": BASE_COMMIT,
            "producerHead": producer_head,
            "freezeSha256": optional_hash(FREEZE_PATH),
            "protocolSha256": optional_hash(PROTOCOL_PATH),
            "evaluatorSha256": optional_hash(Path(__file__).resolve()),
            "universeSha256": optional_hash(UNIVERSE_PATH),
            "sourceManifestSha256": optional_hash(MANIFEST_PATH),
            "trialLedgerSha256": optional_hash(LEDGER_PATH),
            "freezeBindings": None,
        },
        "markers": {
            "runConsumed": True,
            "candidateSealed": False,
            "holdoutOpened": False,
        },
    }


def write_sha_manifest() -> None:
    paths = [
        README_PATH,
        SOURCES_PATH,
        PROTOCOL_PATH,
        UNIVERSE_PATH,
        MANIFEST_PATH,
        LEDGER_PATH,
        Path(__file__).resolve(),
        FREEZE_PATH,
        RUN_MARKER_PATH,
        DEVELOPMENT_PATH,
        CANDIDATE_PATH,
        HOLDOUT_MARKER_PATH,
        RESULT_PATH,
        CUSTODY_BREACH_PATH,
    ]
    if TEST_PATH.exists():
        paths.append(TEST_PATH)
    lines = [f"{sha256_file(path)}  {path.name}" for path in sorted(paths) if path.is_file()]
    atomic_write(SHA_PATH, ("\n".join(lines) + "\n").encode())


def clean_committed_run_state() -> str:
    assert_scope()
    if git_output("status", "--porcelain=v1", "--untracked-files=all"):
        raise ExperimentError("RUN_REQUIRES_CLEAN_COMMITTED_FREEZE")
    head = git_output("rev-parse", "HEAD")
    try:
        subprocess.run(
            ["git", "merge-base", "--is-ancestor", BASE_COMMIT, head],
            cwd=PACKET_DIR,
            check=True,
            capture_output=True,
        )
    except subprocess.CalledProcessError as exc:
        raise ExperimentError("RUN_HEAD_NOT_DESCENDED_FROM_EXACT_BASE") from exc
    changed = git_output("diff", "--name-only", f"{BASE_COMMIT}..{head}")
    if not changed:
        raise ExperimentError("RUN_FREEZE_COMMIT_MISSING")
    for relative in changed.splitlines():
        if not relative.startswith("quant/research/s1m/"):
            raise ExperimentError(f"RUN_COMMIT_OUT_OF_SCOPE:{relative}")
    committed_freeze = subprocess.run(
        ["git", "show", f"{head}:quant/research/s1m/freeze.v1.json"],
        cwd=PACKET_DIR,
        check=True,
        capture_output=True,
    ).stdout
    if hashlib.sha256(committed_freeze).hexdigest() != sha256_file(FREEZE_PATH):
        raise ExperimentError("RUN_FREEZE_NOT_COMMITTED_AT_HEAD")
    return head


def run_experiment(shared_root: Path) -> dict[str, Any]:
    for path in (
        RUN_MARKER_PATH,
        DEVELOPMENT_PATH,
        CANDIDATE_PATH,
        HOLDOUT_MARKER_PATH,
        RESULT_PATH,
        SHA_PATH,
    ):
        if path.exists():
            raise ExperimentError(f"RUN_ALREADY_CONSUMED_OR_OUTPUT_EXISTS:{path.name}")
    try:
        producer_head = git_output("rev-parse", "HEAD")
    except ExperimentError:
        producer_head = "UNKNOWN"
    try:
        freeze = verify_freeze()
        producer_head = clean_committed_run_state()
    except Exception as exc:
        reason = (
            str(exc)
            if isinstance(exc, ExperimentError)
            else f"UNEXPECTED_PRECHECK_FAILURE:{type(exc).__name__}:{exc}"
        )
        write_json(
            RUN_MARKER_PATH,
            {
                "schema": "cosmos.quant.research.s1m.run-consumed.v1",
                "state": "CONSUMED_PRECHECK_FAILED_NO_OUTCOME_READ",
                "createdAt": utc_now(),
                "freezeSha256": optional_hash(FREEZE_PATH),
                "producerHead": producer_head,
                "reason": reason,
            },
            exclusive=True,
        )
        result = build_precheck_unmeasured_result(producer_head, reason)
        write_json(RESULT_PATH, result, exclusive=True)
        write_sha_manifest()
        return result
    write_json(
        RUN_MARKER_PATH,
        {
            "schema": "cosmos.quant.research.s1m.run-consumed.v1",
            "state": "CONSUMED_BEFORE_DEVELOPMENT_OUTCOME_READ",
            "createdAt": utc_now(),
            "freezeSha256": sha256_file(FREEZE_PATH),
            "producerHead": producer_head,
        },
        exclusive=True,
    )
    if CUSTODY_BREACH_PATH.exists():
        result = build_unmeasured_result(
            freeze,
            producer_head,
            "HOLDOUT_PREOPEN_ROW_ACCESS",
        )
        result["reasonCodes"] = [
            "HOLDOUT_PREOPEN_ROW_ACCESS_BY_PRIMARY_WORKER",
            "HOLDOUT_PREOPEN_ROW_ACCESS_BY_BOUNDED_AUDITOR",
        ]
        write_json(RESULT_PATH, result, exclusive=True)
        write_sha_manifest()
        return result
    try:
        protocol = load_json(PROTOCOL_PATH)
        universe = load_json(UNIVERSE_PATH)
        symbols = [str(value) for value in universe["symbols"]]
        trials = load_trials()
        development_start = parse_utc(str(protocol["calendar"]["developmentStartInclusive"]))
        development_end = parse_utc(str(protocol["calendar"]["developmentEndExclusive"]))
        development_data = load_market_data(shared_root, symbols, month_range("2025-04", "2026-03"))
        lookbacks = sorted({trial.lookback for trial in trials})
        features = feature_map(development_data, lookbacks)
        trades_by_trial: dict[str, list[Trade]] = {}
        summaries: dict[str, dict[str, Any]] = {}
        series: dict[str, list[float]] = {}
        for trial in trials:
            trades = evaluate_trial(
                development_data,
                trial,
                features[trial.lookback],
                development_start,
                development_end,
            )
            summary = summarize_trial(
                trial, trades, development_data, development_start, development_end
            )
            trades_by_trial[trial.trial_id] = trades
            summaries[trial.trial_id] = summary
            series[trial.trial_id] = list(summary["_dailyStressNetUsd"])
        multiplicity = bootstrap_family(series)
        pbo_result = pbo(series)
        selected_id = champion_id(summaries)
        gates = development_gates(summaries[selected_id], multiplicity[selected_id])
        development_pass = all(gates.values())
        development_result = {
            "schema": "cosmos.quant.research.s1m.development-result.v1",
            "state": "MEASURED_VALID",
            "partition": {
                "startInclusive": protocol["calendar"]["developmentStartInclusive"],
                "endExclusive": protocol["calendar"]["developmentEndExclusive"],
            },
            "trialCount": len(trials),
            "selectedChampionTrialId": selected_id,
            "selectionBeforeAdmissionFiltering": True,
            "developmentAdmissionPassed": development_pass,
            "failedAdmissionGates": sorted(key for key, value in gates.items() if not value),
            "admissionGates": gates,
            "multiplicity": public_value(multiplicity),
            "pbo": pbo_result,
            "publicProxyPositiveTrials": sum(
                Decimal(summary["_stressNet"]) > 0 for summary in summaries.values()
            ),
            "trialSummaries": [public_value(summaries[trial_id]) for trial_id in sorted(summaries)],
            "championTrades": [trade_json(trade) for trade in trades_by_trial[selected_id]],
        }
        write_json(DEVELOPMENT_PATH, development_result, exclusive=True)
        candidate = {
            "schema": "cosmos.quant.research.s1m.candidate-seal.v1",
            "state": "SEALED_BEFORE_HOLDOUT_ROW_ACCESS",
            "createdAt": utc_now(),
            "freezeSha256": sha256_file(FREEZE_PATH),
            "developmentResultSha256": sha256_file(DEVELOPMENT_PATH),
            "selectedChampionTrialId": selected_id,
            "developmentAdmissionPassed": development_pass,
        }
        write_json(CANDIDATE_PATH, candidate, exclusive=True)
        champion = summaries[selected_id]
        if not development_pass:
            failed = [key for key, value in gates.items() if not value]
            result = {
                "schema": "cosmos.quant.research.s1m.result.v1",
                "milestone": "S-1M",
                "terminalState": "NO_GO",
                "capitalVerdict": "NO_GO",
                "reasonCodes": [f"DEVELOPMENT_GATE_FAILED:{key}" for key in failed],
                "consumer": "N3 successor / orchestrator scoreboard",
                "authority": "NONE",
                "headlinePartition": "DEVELOPMENT_HOLDOUT_UNOPENED",
                "headline": {
                    "trialId": selected_id,
                    "baseNetUsdPerOriginal1000": champion["baseNetUsdPerOriginal1000"],
                    "stressNetUsdPerOriginal1000": champion["stressNetUsdPerOriginal1000"],
                    "severeNetUsdPerOriginal1000": champion["severeNetUsdPerOriginal1000"],
                },
                "holdout": {
                    "state": "UNOPENED_DEVELOPMENT_ADMISSION_FAILED",
                    "stress95PercentIntervalUsdPerOriginal1000": None,
                    "markerExists": False,
                },
                "multiplicity": public_value(multiplicity[selected_id]),
                "pbo": pbo_result,
                "sample": {
                    key: champion[key]
                    for key in (
                        "completedTrades",
                        "activeWeeks",
                        "symbols",
                        "longTrades",
                        "shortTrades",
                    )
                },
                "drawdown": {
                    "state": "HOURLY_MARK_OPEN_PROXY",
                    "baseUsd": champion["baseDrawdownUsd"],
                    "baseFraction": champion["baseDrawdownFraction"],
                    "stressUsd": champion["stressDrawdownUsd"],
                    "stressFraction": champion["stressDrawdownFraction"],
                },
                "capacity": champion["capacity"],
                "crediblePositiveCount": None,
                "publicProxyPositiveTrials": development_result["publicProxyPositiveTrials"],
                "accountEffectiveFees": "UNKNOWN",
                "fundingRateTypeState": "ARCHIVE_FIELD_UNAVAILABLE",
                "makerEntryState": champion["makerDiagnostic"]["state"],
                "limitations": static_limitations(),
                "provenance": provenance(freeze, producer_head),
                "markers": {
                    "runConsumed": True,
                    "candidateSealed": True,
                    "holdoutOpened": False,
                },
            }
            write_json(RESULT_PATH, result, exclusive=True)
            write_sha_manifest()
            return result
        write_json(
            HOLDOUT_MARKER_PATH,
            {
                "schema": "cosmos.quant.research.s1m.holdout-open.v1",
                "state": "OPENED_ONCE_AFTER_ALL_DEVELOPMENT_GATES_PASSED",
                "createdAt": utc_now(),
                "candidateSealSha256": sha256_file(CANDIDATE_PATH),
                "selectedChampionTrialId": selected_id,
            },
            exclusive=True,
        )
        all_data = load_market_data(shared_root, symbols, month_range("2025-04", "2026-06"))
        all_features = feature_map(all_data, lookbacks)
        champion_trial = next(trial for trial in trials if trial.trial_id == selected_id)
        holdout_start = parse_utc(str(protocol["calendar"]["holdoutStartInclusive"]))
        holdout_end = parse_utc(str(protocol["calendar"]["holdoutEndExclusive"]))
        holdout_trades = evaluate_trial(
            all_data,
            champion_trial,
            all_features[champion_trial.lookback],
            holdout_start,
            holdout_end,
        )
        holdout_summary = summarize_trial(
            champion_trial, holdout_trades, all_data, holdout_start, holdout_end
        )
        interval = bootstrap_interval(
            daily_series(holdout_trades, holdout_start, holdout_end, "stress")
        )
        gates = holdout_gates(holdout_summary, interval)
        public_pass = all(gates.values())
        if public_pass:
            terminal = "UNMEASURED"
            reasons = ["PUBLIC_PROXY_PASSED_BUT_ACCOUNT_AND_EXECUTION_TRUTH_UNKNOWN"]
        else:
            terminal = "NO_GO"
            reasons = [f"HOLDOUT_GATE_FAILED:{key}" for key, value in gates.items() if not value]
        result = {
            "schema": "cosmos.quant.research.s1m.result.v1",
            "milestone": "S-1M",
            "terminalState": terminal,
            "capitalVerdict": "NO_GO",
            "reasonCodes": reasons,
            "consumer": "N3 successor / orchestrator scoreboard",
            "authority": "NONE",
            "headlinePartition": "HOLDOUT",
            "headline": {
                "trialId": selected_id,
                "baseNetUsdPerOriginal1000": holdout_summary["baseNetUsdPerOriginal1000"],
                "stressNetUsdPerOriginal1000": holdout_summary["stressNetUsdPerOriginal1000"],
                "severeNetUsdPerOriginal1000": holdout_summary["severeNetUsdPerOriginal1000"],
            },
            "holdout": {
                "state": "EVALUATED_ONCE",
                "stress95PercentIntervalUsdPerOriginal1000": [
                    float_text(interval[0]),
                    float_text(interval[1]),
                ],
                "admissionGates": gates,
                "trades": [trade_json(trade) for trade in holdout_trades],
            },
            "multiplicity": public_value(multiplicity[selected_id]),
            "pbo": pbo_result,
            "sample": {
                key: holdout_summary[key]
                for key in (
                    "completedTrades",
                    "activeWeeks",
                    "symbols",
                    "longTrades",
                    "shortTrades",
                )
            },
            "drawdown": {
                "state": "HOURLY_MARK_OPEN_PROXY",
                "baseUsd": holdout_summary["baseDrawdownUsd"],
                "baseFraction": holdout_summary["baseDrawdownFraction"],
                "stressUsd": holdout_summary["stressDrawdownUsd"],
                "stressFraction": holdout_summary["stressDrawdownFraction"],
            },
            "capacity": holdout_summary["capacity"],
            "crediblePositiveCount": None,
            "publicProxyPositiveTrials": development_result["publicProxyPositiveTrials"],
            "accountEffectiveFees": "UNKNOWN",
            "fundingRateTypeState": "ARCHIVE_FIELD_UNAVAILABLE",
            "makerEntryState": holdout_summary["makerDiagnostic"]["state"],
            "limitations": static_limitations(),
            "provenance": provenance(freeze, producer_head),
            "markers": {
                "runConsumed": True,
                "candidateSealed": True,
                "holdoutOpened": True,
            },
        }
        write_json(RESULT_PATH, result, exclusive=True)
        write_sha_manifest()
        return result
    except Exception as exc:
        reason = (
            str(exc)
            if isinstance(exc, ExperimentError)
            else f"UNEXPECTED_EVALUATOR_FAILURE:{type(exc).__name__}:{exc}"
        )
        result = build_unmeasured_result(freeze, producer_head, reason)
        if not RESULT_PATH.exists():
            write_json(RESULT_PATH, result, exclusive=True)
        write_sha_manifest()
        return result


def verify_packet() -> dict[str, Any]:
    assert_scope()
    freeze = verify_freeze()
    if not RUN_MARKER_PATH.is_file() or not RESULT_PATH.is_file() or not SHA_PATH.is_file():
        raise ExperimentError("TERMINAL_ARTIFACT_MISSING")
    lines = SHA_PATH.read_text(encoding="ascii").splitlines()
    if not lines:
        raise ExperimentError("SHA_MANIFEST_EMPTY")
    seen: set[str] = set()
    for line in lines:
        pieces = line.split("  ", 1)
        if len(pieces) != 2 or not re.fullmatch(r"[0-9a-f]{64}", pieces[0]):
            raise ExperimentError(f"SHA_MANIFEST_ROW_INVALID:{line}")
        expected, filename = pieces
        if filename in seen or "/" in filename or "\\" in filename:
            raise ExperimentError(f"SHA_MANIFEST_FILENAME_INVALID:{filename}")
        seen.add(filename)
        path = PACKET_DIR / filename
        if not path.is_file() or sha256_file(path) != expected:
            raise ExperimentError(f"SHA_MANIFEST_MISMATCH:{filename}")
    result = load_json(RESULT_PATH)
    if result.get("terminalState") not in {"GO", "NO_GO", "UNMEASURED"}:
        raise ExperimentError("TERMINAL_STATE_INVALID")
    if result.get("authority") != "NONE" or result.get("accountEffectiveFees") != "UNKNOWN":
        raise ExperimentError("AUTHORITY_OR_FEE_BOUNDARY_INVALID")
    markers = result.get("markers")
    if not isinstance(markers, dict):
        raise ExperimentError("RESULT_MARKERS_INVALID")
    if bool(markers.get("holdoutOpened")) != HOLDOUT_MARKER_PATH.exists():
        raise ExperimentError("HOLDOUT_MARKER_RESULT_MISMATCH")
    if CANDIDATE_PATH.exists():
        candidate = load_json(CANDIDATE_PATH)
        if candidate.get("freezeSha256") != sha256_file(FREEZE_PATH):
            raise ExperimentError("CANDIDATE_FREEZE_BINDING_MISMATCH")
        if candidate.get("developmentResultSha256") != sha256_file(DEVELOPMENT_PATH):
            raise ExperimentError("CANDIDATE_DEVELOPMENT_BINDING_MISMATCH")
    return {
        "status": "PASS",
        "terminalState": result["terminalState"],
        "resultSha256": sha256_file(RESULT_PATH),
        "freezeSha256": sha256_file(FREEZE_PATH),
        "checkedFiles": len(seen),
        "freezeStatus": freeze["status"],
    }


def report_result() -> str:
    result = load_json(RESULT_PATH)
    headline = result["headline"]
    holdout = result["holdout"]
    return (
        f"S-1M {result['terminalState']} | "
        f"net/$1k base={headline['baseNetUsdPerOriginal1000']} "
        f"stress={headline['stressNetUsdPerOriginal1000']} | "
        f"holdout={holdout['state']} "
        f"interval={holdout['stress95PercentIntervalUsdPerOriginal1000']} | "
        f"fees={result['accountEffectiveFees']} authority={result['authority']}"
    )


def command_line() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    for command in ("screen", "prepare", "run"):
        subparser = subparsers.add_parser(command)
        subparser.add_argument("--shared-root", required=True, type=Path)
    subparsers.add_parser("freeze")
    subparsers.add_parser("verify")
    subparsers.add_parser("report")
    return parser.parse_args()


def main() -> int:
    arguments = command_line()
    try:
        if arguments.command == "screen":
            value = screen_universe(arguments.shared_root.resolve())
            print(json.dumps({"symbols": value["symbols"]}, sort_keys=True))
        elif arguments.command == "prepare":
            value = prepare_manifest(arguments.shared_root.resolve())
            print(json.dumps({"entryCount": value["entryCount"]}, sort_keys=True))
        elif arguments.command == "freeze":
            value = freeze_packet()
            print(json.dumps({"status": value["status"]}, sort_keys=True))
        elif arguments.command == "run":
            value = run_experiment(arguments.shared_root.resolve())
            print(json.dumps({"terminalState": value["terminalState"]}, sort_keys=True))
        elif arguments.command == "verify":
            print(json.dumps(verify_packet(), sort_keys=True))
        elif arguments.command == "report":
            print(report_result())
        else:
            raise ExperimentError(f"UNKNOWN_COMMAND:{arguments.command}")
    except ExperimentError as exc:
        print(f"S-1M_ERROR:{exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
