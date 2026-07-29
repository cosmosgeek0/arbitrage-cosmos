"""V-G11 sealed, network-free trade/notional intensity experiment.

The only data input is the authenticated read-only S-1F Binance Spot archive
cache. ``freeze`` seals the exact hand-authored packet before any archive body
is read. ``run`` consumes one exclusive development marker, evaluates exactly
three frozen trials, and opens holdout bodies only after development passes.
``verify`` and ``report`` never open archive bodies or recompute outcomes.
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
import stat
import sys
import zipfile
from collections import defaultdict
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation, getcontext
from pathlib import Path
from typing import Any, Final, TextIO, cast

getcontext().prec = 50

D = Decimal
HERE: Final = Path(__file__).resolve().parent
STATE_ROOT: Final = Path("/private/tmp/cosmos-vg11-trade-notional-intensity-1be1-019fae9b-state")
SHARED_ROOT: Final = Path("/private/tmp/cosmos-s1f-weekly-momentum-cash-v1")
DAY_US: Final = 86_400_000_000
SHA_RE: Final = re.compile(r"^[0-9a-f]{64}$")
SYMBOL_RE: Final = re.compile(r"^[A-Z0-9]+USDT$")
MONTH_RE: Final = re.compile(r"^\d{4}-\d{2}$")

STATIC_FILES: Final = (
    "METHODOLOGY.md",
    "README.md",
    "experiment.py",
    "official_sources.v1.json",
    "protocol.v1.json",
    "source_plan.v1.json",
    "test_experiment.py",
    "trial_ledger.v1.json",
)
GENERATED_FILES: Final = (
    "development.result.v1.json",
    "holdout.authorization.v1.json",
    "holdout.result.v1.json",
    "protocol.freeze.v1.json",
    "result.v1.json",
    "source.receipt.v1.json",
    "verdict.v1.json",
)
PRE_FREEZE_ABSENT_REPO: Final = (
    "SHA256SUMS",
    *GENERATED_FILES,
)
STATE_MARKERS: Final = (
    "freeze-marker.v1.json",
    "development-run-marker.v1.json",
    "holdout-authorization-marker.v1.json",
    "holdout-evaluation-marker.v1.json",
)
SHARED_PINS: Final = {
    "discovery.v1.json": "b4a8f7abd36df19eff0510dfcc3c61fd0df9fdcab5f4d248892ee10010fb21c3",
    "acquisition-manifest.v1.json": (
        "01f58272602e43bfb914b649adc00d8273b2d423492220a55f86443bb6441176"
    ),
    "run-marker.v1.json": "7160455ebb695bbf27f899c9a64aa71d50d2ecc9786fe7fefa4067b37c446489",
}


class EvidenceError(RuntimeError):
    """A fail-closed protocol, source, lifecycle, or semantic error."""


@dataclass(frozen=True)
class Bar:
    day: date
    open_price: Decimal
    quote_volume: Decimal
    trade_count: int


@dataclass(frozen=True)
class Signal:
    symbol: str
    signal_day: date
    entry_day: date
    exit_day: date
    threshold: Decimal
    intensity_multiple: Decimal
    trade_count_multiple: Decimal
    quote_volume_multiple: Decimal
    gross_return: Decimal
    public_fee_net_return: Decimal
    base_net_return: Decimal
    stress_net_return: Decimal
    bnb_conditional_net_return: Decimal


@dataclass
class OpenCounts:
    development: int = 0
    holdout: int = 0


def canonical_bytes(value: object) -> bytes:
    return (
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n"
    ).encode("utf-8")


def sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def lexists(path: Path) -> bool:
    return os.path.lexists(os.fspath(path))


def safe_regular(path: Path) -> Path:
    if path.is_symlink():
        raise EvidenceError(f"symlink refused: {path}")
    try:
        mode = path.stat().st_mode
    except FileNotFoundError as error:
        raise EvidenceError(f"required file missing: {path}") from error
    if not stat.S_ISREG(mode):
        raise EvidenceError(f"regular file required: {path}")
    return path


def sha256_path(path: Path) -> str:
    return sha256_bytes(safe_regular(path).read_bytes())


def load_json(path: Path, *, canonical: bool = True) -> tuple[dict[str, Any], bytes]:
    raw = safe_regular(path).read_bytes()
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as error:
        raise EvidenceError(f"invalid JSON: {path}") from error
    if not isinstance(value, dict):
        raise EvidenceError(f"JSON root must be an object: {path}")
    result = cast(dict[str, Any], value)
    if canonical and raw != canonical_bytes(result):
        raise EvidenceError(f"JSON is not canonical sorted compact bytes: {path}")
    return result, raw


def require_text(value: object, field: str) -> str:
    if not isinstance(value, str) or not value:
        raise EvidenceError(f"{field} must be nonempty text")
    return value


def require_int(value: object, field: str, minimum: int = 0) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise EvidenceError(f"{field} must be an integer >= {minimum}")
    return value


def require_bool(value: object, field: str) -> bool:
    if not isinstance(value, bool):
        raise EvidenceError(f"{field} must be boolean")
    return value


def decimal_value(value: object, field: str) -> Decimal:
    if not isinstance(value, str):
        raise EvidenceError(f"{field} must be an exact decimal string")
    try:
        parsed = D(value)
    except InvalidOperation as error:
        raise EvidenceError(f"{field} is not an exact decimal") from error
    if not parsed.is_finite():
        raise EvidenceError(f"{field} must be finite")
    return parsed


def decimal_text(value: Decimal) -> str:
    if not value.is_finite():
        raise EvidenceError("non-finite decimal cannot be serialized")
    if value == 0:
        return "0"
    return format(value.normalize(), "f")


def iso_date(value: object, field: str) -> date:
    text = require_text(value, field)
    try:
        return date.fromisoformat(text)
    except ValueError as error:
        raise EvidenceError(f"{field} must be an ISO date") from error


def utc_now() -> str:
    return (
        datetime.now(timezone.utc)  # noqa: UP017 - system Python 3.9 compatibility
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def fsync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def exclusive_write(path: Path, raw: bytes, *, mode: int) -> None:
    if lexists(path):
        raise EvidenceError(f"create-once path already exists: {path}")
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
    try:
        with os.fdopen(descriptor, "wb", closefd=True) as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
    except BaseException:
        raise
    fsync_directory(path.parent)


def emit_json(path: Path, value: object, *, mode: int = 0o644) -> str:
    raw = canonical_bytes(value)
    exclusive_write(path, raw, mode=mode)
    return sha256_bytes(raw)


def normalized_lines(values: Iterable[str]) -> bytes:
    return ("\n".join(values) + "\n").encode("utf-8")


def median_decimal(values: Sequence[Decimal]) -> Decimal:
    if not values:
        raise EvidenceError("median requires at least one value")
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) / D(2)


def date_range(first: date, last: date) -> tuple[date, ...]:
    if last < first:
        raise EvidenceError("date range is reversed")
    return tuple(first + timedelta(days=offset) for offset in range((last - first).days + 1))


def _static_payloads() -> tuple[dict[str, Any], dict[str, Any], dict[str, Any], dict[str, Any]]:
    official, _ = load_json(HERE / "official_sources.v1.json")
    protocol, _ = load_json(HERE / "protocol.v1.json")
    source_plan, _ = load_json(HERE / "source_plan.v1.json")
    ledger, _ = load_json(HERE / "trial_ledger.v1.json")
    validate_static(official, protocol, source_plan, ledger)
    return official, protocol, source_plan, ledger


def validate_static(
    official: Mapping[str, Any],
    protocol: Mapping[str, Any],
    source_plan: Mapping[str, Any],
    ledger: Mapping[str, Any],
) -> None:
    if official.get("schema") != "VG11OfficialSourcesV1":
        raise EvidenceError("official sources schema mismatch")
    immutable = official.get("immutableSources")
    if not isinstance(immutable, list) or len(immutable) != 5:
        raise EvidenceError("five immutable official source pins required")
    expected_source_hashes = {
        "085ab91377aa9325d44f4c7ad27cce4ab381e158403e1d7df2bad39d1a66f7c6",
        "49ea6809243fc7fb426e07f2fe662097736c7bb405bd2da5eef637d715427999",
        "4b5a8f0f5d15bcf68fd7ac2059ba6c88da641c06fd7885e642330c5ac8124dd3",
        "32bf73a0bed3b75e3ca981fdbaf48c53544bbdfb5944ef8ed1c4d7af9aceba0a",
        "580cfa59c9f55adae0d27bf38d2bc7f268ad759fdf054486e356464c30bbd54c",
    }
    actual_source_hashes = {
        require_text(item.get("sha256"), "immutableSources.sha256")
        for item in immutable
        if isinstance(item, dict)
    }
    if actual_source_hashes != expected_source_hashes:
        raise EvidenceError("official source byte pins mismatch")
    if protocol.get("schema") != "VG11TradeNotionalIntensityProtocolV1":
        raise EvidenceError("protocol schema mismatch")
    if protocol.get("hypothesis") != "ORDINARY_NOTIONAL_TRADE_FRAGMENTATION_CONTINUATION":
        raise EvidenceError("hypothesis mismatch")
    if protocol.get("canonicalBaseCommit") != ("a169b123fb186d1943a75ad648552c4d95be1be1"):
        raise EvidenceError("canonical base mismatch")
    if protocol.get("capitalAuthority") != "NONE" or protocol.get("executionAuthority") != "NONE":
        raise EvidenceError("authority must remain NONE")
    signal = protocol.get("signal")
    if not isinstance(signal, dict):
        raise EvidenceError("signal contract missing")
    if signal.get("thresholdMultiples") != ["1.5", "2.0", "3.0"]:
        raise EvidenceError("threshold family must remain exact")
    if signal.get("priceInputs") != [] or signal.get("selectionInputs") != [
        "NUMBER_OF_TRADES",
        "QUOTE_ASSET_VOLUME",
    ]:
        raise EvidenceError("selection inputs drifted")
    calendar = protocol.get("calendar")
    if not isinstance(calendar, dict):
        raise EvidenceError("calendar contract missing")
    if calendar.get("developmentSignalDatesInclusive") != ["2025-07-01", "2026-02-25"]:
        raise EvidenceError("development calendar drifted")
    if calendar.get("holdoutSignalDatesInclusive") != ["2026-03-01", "2026-06-27"]:
        raise EvidenceError("holdout calendar drifted")
    if source_plan.get("schema") != "VG11SourcePlanV1":
        raise EvidenceError("source plan schema mismatch")
    shared = source_plan.get("sharedReadOnlyInputs")
    if not isinstance(shared, dict):
        raise EvidenceError("shared input pins missing")
    for name, digest in SHARED_PINS.items():
        row = shared.get(name)
        if not isinstance(row, dict) or row.get("sha256") != digest:
            raise EvidenceError(f"shared pin mismatch: {name}")
    if source_plan.get("developmentArchiveMonths") != ["2025-05", "2026-02"]:
        raise EvidenceError("development archive partition drifted")
    if source_plan.get("holdoutArchiveMonths") != ["2026-03", "2026-06"]:
        raise EvidenceError("holdout archive partition drifted")
    if ledger.get("schema") != "VG11TrialLedgerV1":
        raise EvidenceError("trial ledger schema mismatch")
    trials = ledger.get("trials")
    if not isinstance(trials, list) or len(trials) != 3:
        raise EvidenceError("trial ledger must contain exactly three trials")
    ids = []
    thresholds = []
    for row in trials:
        if not isinstance(row, dict):
            raise EvidenceError("trial row must be an object")
        ids.append(require_text(row.get("trialId"), "trialId"))
        thresholds.append(require_text(row.get("thresholdMultiple"), "thresholdMultiple"))
        if row.get("amendable") is not False:
            raise EvidenceError("trial rows are closed and non-amendable")
    if ids != ["VG11-T1-1P5", "VG11-T2-2P0", "VG11-T3-3P0"]:
        raise EvidenceError("trial IDs drifted")
    if thresholds != ["1.5", "2.0", "3.0"]:
        raise EvidenceError("trial thresholds drifted")


def _validate_shared_metadata() -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    payloads: dict[str, dict[str, Any]] = {}
    for name, expected in SHARED_PINS.items():
        path = SHARED_ROOT / name
        if sha256_path(path) != expected:
            raise EvidenceError(f"shared metadata digest mismatch: {name}")
        payload, _ = load_json(path)
        payloads[name] = payload
    discovery = payloads["discovery.v1.json"]
    acquisition = payloads["acquisition-manifest.v1.json"]
    shared_marker = payloads["run-marker.v1.json"]
    if discovery.get("schema") != "S1FArchiveDiscoveryV1":
        raise EvidenceError("shared discovery schema mismatch")
    if discovery.get("state") != "METADATA_ONLY_NO_ARCHIVE_BODY_OPENED":
        raise EvidenceError("shared discovery state mismatch")
    if acquisition.get("schema") != "S1FAcquisitionManifestV1":
        raise EvidenceError("shared acquisition schema mismatch")
    if acquisition.get("state") != "CHECKSUM_VERIFIED_ARCHIVES_NOT_DECOMPRESSED":
        raise EvidenceError("shared acquisition state mismatch")
    if acquisition.get("archiveBodiesDecompressed") is not False:
        raise EvidenceError("shared acquisition body-state mismatch")
    if acquisition.get("discoverySha256") != SHARED_PINS["discovery.v1.json"]:
        raise EvidenceError("shared acquisition/discovery binding mismatch")
    if shared_marker.get("schema") != "S1FRunMarkerV1":
        raise EvidenceError("shared marker schema mismatch")
    if shared_marker.get("networkPermitted") is not False:
        raise EvidenceError("shared marker network posture mismatch")
    if shared_marker.get("acquisitionSha256") != SHARED_PINS["acquisition-manifest.v1.json"]:
        raise EvidenceError("shared marker/acquisition binding mismatch")
    if shared_marker.get("state") != "SOLE_ARCHIVE_DECOMPRESSION_RUN_CONSUMED":
        raise EvidenceError("shared marker is provenance but must be consumed")
    universe = discovery.get("universe")
    exclusions = discovery.get("exclusions")
    root = discovery.get("root")
    inventories = discovery.get("symbolInventories")
    if (
        not isinstance(universe, dict)
        or not isinstance(exclusions, dict)
        or not isinstance(root, dict)
        or not isinstance(inventories, list)
    ):
        raise EvidenceError("shared discovery structure invalid")
    symbols = universe.get("symbols")
    stable = exclusions.get("stableOrFiatSymbols")
    leveraged = exclusions.get("pairedLeveragedSymbols")
    if (
        not isinstance(symbols, list)
        or not isinstance(stable, list)
        or not isinstance(leveraged, list)
    ):
        raise EvidenceError("shared universe lists invalid")
    if any(not isinstance(value, str) for value in (*symbols, *stable, *leveraged)):
        raise EvidenceError("shared universe contains non-text symbol")
    symbol_text = cast(list[str], symbols)
    stable_text = cast(list[str], stable)
    leveraged_text = cast(list[str], leveraged)
    if symbol_text != sorted(set(symbol_text)) or any(
        SYMBOL_RE.fullmatch(symbol) is None for symbol in symbol_text
    ):
        raise EvidenceError("shared universe is not stable unique ASCII Spot USDT")
    if len(symbol_text) != require_int(universe.get("count"), "universe.count"):
        raise EvidenceError("shared universe count mismatch")
    if sha256_bytes(normalized_lines(symbol_text)) != universe.get("sha256"):
        raise EvidenceError("shared universe digest mismatch")
    if sha256_bytes(normalized_lines(stable_text)) != exclusions.get("stableOrFiatSha256"):
        raise EvidenceError("stable/fiat exclusion digest mismatch")
    if sha256_bytes(normalized_lines(leveraged_text)) != exclusions.get("pairedLeveragedSha256"):
        raise EvidenceError("leveraged-token exclusion digest mismatch")
    candidates = sorted((*symbol_text, *stable_text, *leveraged_text))
    if len(candidates) != require_int(root.get("usdtCandidateCount"), "usdtCandidateCount"):
        raise EvidenceError("candidate count mismatch")
    if sha256_bytes(normalized_lines(candidates)) != root.get("usdtCandidateSha256"):
        raise EvidenceError("candidate digest mismatch")
    if len(inventories) != len(symbol_text):
        raise EvidenceError("shared inventory/universe cardinality mismatch")
    pairs = acquisition.get("artifactPairs")
    if not isinstance(pairs, list):
        raise EvidenceError("artifactPairs missing")
    if len(pairs) != require_int(acquisition.get("artifactPairCount"), "artifactPairCount"):
        raise EvidenceError("artifact pair count mismatch")
    seen: set[tuple[str, str]] = set()
    for raw in pairs:
        if not isinstance(raw, dict):
            raise EvidenceError("artifact pair row is not an object")
        symbol = require_text(raw.get("symbol"), "artifact.symbol")
        month = require_text(raw.get("month"), "artifact.month")
        if symbol not in symbol_text or MONTH_RE.fullmatch(month) is None:
            raise EvidenceError("artifact row symbol/month invalid")
        identity = (symbol, month)
        if identity in seen:
            raise EvidenceError("duplicate artifact pair")
        seen.add(identity)
        zip_name = f"{symbol}-1d-{month}.zip"
        expected_key = f"data/spot/monthly/klines/{symbol}/1d/{zip_name}"
        if (
            raw.get("zipKey") != expected_key
            or raw.get("checksumKey") != f"{expected_key}.CHECKSUM"
        ):
            raise EvidenceError("artifact key mapping mismatch")
        for field in ("zipSha256", "checksumSha256"):
            digest = require_text(raw.get(field), f"artifact.{field}")
            if SHA_RE.fullmatch(digest) is None:
                raise EvidenceError("artifact digest malformed")
        require_int(raw.get("zipBytes"), "artifact.zipBytes", 1)
        require_int(raw.get("checksumBytes"), "artifact.checksumBytes", 1)
    return discovery, acquisition, shared_marker


def _assert_repo_pre_freeze_surface() -> None:
    actual = {path.name for path in HERE.iterdir()}
    if actual != set(STATIC_FILES):
        raise EvidenceError(
            "pre-freeze package surface mismatch: "
            f"expected {sorted(STATIC_FILES)}, got {sorted(actual)}"
        )
    for name in PRE_FREEZE_ABSENT_REPO:
        if lexists(HERE / name):
            raise EvidenceError(f"pre-freeze artifact already exists: {name}")


def preflight() -> dict[str, object]:
    _static_payloads()
    discovery, acquisition, _ = _validate_shared_metadata()
    _assert_repo_pre_freeze_surface()
    if lexists(STATE_ROOT):
        raise EvidenceError(f"state root already exists, including symlink: {STATE_ROOT}")
    universe = cast(dict[str, Any], discovery["universe"])
    return {
        "schema": "VG11PreflightReportV1",
        "state": "READY_TO_FREEZE",
        "networkCalls": 0,
        "repoOutputsAbsent": len(PRE_FREEZE_ABSENT_REPO),
        "stateRootAbsent": True,
        "universePrefixCount": require_int(universe["count"], "universe.count"),
        "artifactPairCount": require_int(acquisition["artifactPairCount"], "artifactPairCount"),
    }


def freeze() -> dict[str, object]:
    report = preflight()
    official, protocol, source_plan, ledger = _static_payloads()
    frozen_at = utc_now()
    static_digests = {name: sha256_path(HERE / name) for name in STATIC_FILES}
    freeze_payload: dict[str, object] = {
        "schema": "VG11ProtocolFreezeV1",
        "state": "PROTOCOL_BYTES_FROZEN_BEFORE_ARCHIVE_OUTCOMES",
        "frozenAtUtc": frozen_at,
        "canonicalBaseCommit": protocol["canonicalBaseCommit"],
        "hypothesis": protocol["hypothesis"],
        "stateRoot": os.fspath(STATE_ROOT),
        "networkCalls": 0,
        "staticFileSha256": static_digests,
        "protocolSha256": static_digests["protocol.v1.json"],
        "officialSourcesSha256": static_digests["official_sources.v1.json"],
        "sourcePlanSha256": static_digests["source_plan.v1.json"],
        "trialLedgerSha256": static_digests["trial_ledger.v1.json"],
        "evaluatorSha256": static_digests["experiment.py"],
        "sharedReadOnlySha256": SHARED_PINS,
        "trialCountDeclared": len(cast(list[object], ledger["trials"])),
        "distinctness": protocol["distinctness"],
        "preflight": report,
        "bindings": {
            "officialSchema": official["schema"],
            "sourcePlanSchema": source_plan["schema"],
            "protocolSchema": protocol["schema"],
            "trialLedgerSchema": ledger["schema"],
        },
    }
    freeze_raw = canonical_bytes(freeze_payload)
    freeze_digest = sha256_bytes(freeze_raw)
    os.mkdir(STATE_ROOT, 0o700)
    fsync_directory(STATE_ROOT.parent)
    marker = {
        "schema": "VG11FreezeMarkerV1",
        "state": "FREEZE_CONSUMED_CREATE_ONCE",
        "frozenAtUtc": frozen_at,
        "freezeArtifactSha256": freeze_digest,
        "protocolSha256": static_digests["protocol.v1.json"],
        "evaluatorSha256": static_digests["experiment.py"],
        "networkCalls": 0,
    }
    emit_json(STATE_ROOT / "freeze-marker.v1.json", marker, mode=0o600)
    exclusive_write(HERE / "protocol.freeze.v1.json", freeze_raw, mode=0o644)
    return freeze_payload


def _load_freeze() -> tuple[dict[str, Any], str]:
    payload, raw = load_json(HERE / "protocol.freeze.v1.json")
    digest = sha256_bytes(raw)
    if payload.get("schema") != "VG11ProtocolFreezeV1":
        raise EvidenceError("freeze schema mismatch")
    if payload.get("state") != "PROTOCOL_BYTES_FROZEN_BEFORE_ARCHIVE_OUTCOMES":
        raise EvidenceError("freeze state mismatch")
    static = payload.get("staticFileSha256")
    if not isinstance(static, dict) or set(static) != set(STATIC_FILES):
        raise EvidenceError("freeze static inventory mismatch")
    for name in STATIC_FILES:
        if static.get(name) != sha256_path(HERE / name):
            raise EvidenceError(f"post-freeze hand-authored drift: {name}")
    marker, _ = load_json(STATE_ROOT / "freeze-marker.v1.json")
    if marker.get("freezeArtifactSha256") != digest:
        raise EvidenceError("external freeze marker digest mismatch")
    if marker.get("protocolSha256") != static.get("protocol.v1.json"):
        raise EvidenceError("external freeze protocol binding mismatch")
    if stat.S_IMODE((STATE_ROOT / "freeze-marker.v1.json").stat().st_mode) != 0o600:
        raise EvidenceError("freeze marker mode must be 0600")
    return payload, digest


def _month_values(first: str, last: str) -> tuple[str, ...]:
    if MONTH_RE.fullmatch(first) is None or MONTH_RE.fullmatch(last) is None:
        raise EvidenceError("month range malformed")
    year, month = (int(part) for part in first.split("-"))
    end = tuple(int(part) for part in last.split("-"))
    result = []
    while (year, month) <= end:
        result.append(f"{year:04d}-{month:02d}")
        if month == 12:
            year += 1
            month = 1
        else:
            month += 1
    return tuple(result)


def _artifact_rows(acquisition: Mapping[str, Any]) -> dict[tuple[str, str], Mapping[str, Any]]:
    raw_rows = acquisition.get("artifactPairs")
    if not isinstance(raw_rows, list):
        raise EvidenceError("artifactPairs missing")
    result: dict[tuple[str, str], Mapping[str, Any]] = {}
    for raw in raw_rows:
        if not isinstance(raw, dict):
            raise EvidenceError("artifact pair row malformed")
        symbol = require_text(raw.get("symbol"), "artifact.symbol")
        month = require_text(raw.get("month"), "artifact.month")
        result[(symbol, month)] = raw
    return result


def _parse_decimal_csv(value: str, field: str, *, positive: bool) -> Decimal:
    try:
        parsed = D(value)
    except InvalidOperation as error:
        raise EvidenceError(f"{field} malformed") from error
    if not parsed.is_finite() or (positive and parsed <= 0) or (not positive and parsed < 0):
        raise EvidenceError(f"{field} outside valid range")
    return parsed


def _parse_zip(
    raw: bytes,
    *,
    symbol: str,
    month: str,
) -> tuple[Bar, ...]:
    expected_member = f"{symbol}-1d-{month}.csv"
    try:
        archive = zipfile.ZipFile(io.BytesIO(raw))
    except zipfile.BadZipFile as error:
        raise EvidenceError(f"bad ZIP: {symbol} {month}") from error
    with archive:
        members = archive.infolist()
        if len(members) != 1 or members[0].filename != expected_member or members[0].is_dir():
            raise EvidenceError(f"ZIP member contract mismatch: {symbol} {month}")
        member_mode = (members[0].external_attr >> 16) & 0o170000
        if member_mode == stat.S_IFLNK:
            raise EvidenceError(f"ZIP symlink member refused: {symbol} {month}")
        if members[0].file_size > 256_000:
            raise EvidenceError(f"ZIP member capacity exceeded: {symbol} {month}")
        csv_raw = archive.read(members[0])
    try:
        text = csv_raw.decode("utf-8")
    except UnicodeDecodeError as error:
        raise EvidenceError(f"CSV is not UTF-8: {symbol} {month}") from error
    bars = []
    previous: date | None = None
    for row_number, row in enumerate(csv.reader(io.StringIO(text)), start=1):
        if len(row) != 12:
            raise EvidenceError(f"CSV column count mismatch: {symbol} {month} row {row_number}")
        try:
            open_us = int(row[0])
            close_us = int(row[6])
            trade_count = int(row[8])
        except ValueError as error:
            raise EvidenceError(f"CSV integer field malformed: {symbol} {month}") from error
        if open_us % DAY_US != 0 or close_us != open_us + DAY_US - 1:
            raise EvidenceError(f"daily microsecond boundary invalid: {symbol} {month}")
        day = datetime.fromtimestamp(
            open_us / 1_000_000,
            tz=timezone.utc,  # noqa: UP017 - system Python 3.9 compatibility
        ).date()
        if day.strftime("%Y-%m") != month:
            raise EvidenceError(f"CSV row outside archive month: {symbol} {month}")
        if previous is not None and day != previous + timedelta(days=1):
            raise EvidenceError(f"archive rows are not consecutive: {symbol} {month}")
        previous = day
        open_price = _parse_decimal_csv(row[1], "open", positive=True)
        high = _parse_decimal_csv(row[2], "high", positive=True)
        low = _parse_decimal_csv(row[3], "low", positive=True)
        close = _parse_decimal_csv(row[4], "close", positive=True)
        quote_volume = _parse_decimal_csv(row[7], "quote volume", positive=False)
        if low > min(open_price, close) or high < max(open_price, close) or low > high:
            raise EvidenceError(f"OHLC relationship invalid: {symbol} {month}")
        if trade_count < 0:
            raise EvidenceError(f"negative trade count: {symbol} {month}")
        bars.append(Bar(day, open_price, quote_volume, trade_count))
    if not bars or len(bars) > 31:
        raise EvidenceError(f"daily row count invalid: {symbol} {month}")
    return tuple(bars)


def authenticate_archive(
    row: Mapping[str, Any],
    *,
    symbol: str,
    month: str,
    on_body_open: Callable[[], None] | None = None,
) -> tuple[Bar, ...]:
    zip_name = f"{symbol}-1d-{month}.zip"
    directory = SHARED_ROOT / "archives" / symbol / month
    zip_path = directory / zip_name
    sidecar_path = directory / f"{zip_name}.CHECKSUM"
    sidecar_raw = safe_regular(sidecar_path).read_bytes()
    if sha256_bytes(sidecar_raw) != row.get("checksumSha256"):
        raise EvidenceError(f"sidecar SHA mismatch: {symbol} {month}")
    expected_sidecar = f"{row.get('zipSha256')}  {zip_name}\n".encode("ascii")
    if sidecar_raw != expected_sidecar:
        raise EvidenceError(f"sidecar content mismatch: {symbol} {month}")
    archive_file = safe_regular(zip_path)
    if on_body_open is not None:
        on_body_open()
    archive_raw = archive_file.read_bytes()
    if len(archive_raw) != require_int(row.get("zipBytes"), "zipBytes", 1):
        raise EvidenceError(f"archive byte count mismatch: {symbol} {month}")
    if sha256_bytes(archive_raw) != row.get("zipSha256"):
        raise EvidenceError(f"archive SHA mismatch: {symbol} {month}")
    return _parse_zip(archive_raw, symbol=symbol, month=month)


def load_partition(
    acquisition: Mapping[str, Any],
    universe: Sequence[str],
    months: Sequence[str],
    *,
    partition: str,
    counts: OpenCounts,
) -> tuple[dict[str, dict[date, Bar]], int]:
    lookup = _artifact_rows(acquisition)
    bars: dict[str, dict[date, Bar]] = defaultdict(dict)
    planned = 0

    def record_open() -> None:
        if partition == "development":
            counts.development += 1
        elif partition == "holdout":
            counts.holdout += 1
        else:
            raise EvidenceError("unknown partition")

    for symbol in universe:
        for month in months:
            row = lookup.get((symbol, month))
            if row is None:
                continue
            planned += 1
            parsed = authenticate_archive(
                row,
                symbol=symbol,
                month=month,
                on_body_open=record_open,
            )
            for bar in parsed:
                if bar.day in bars[symbol]:
                    raise EvidenceError(f"duplicate daily bar: {symbol} {bar.day}")
                bars[symbol][bar.day] = bar
    return dict(bars), planned


def merge_bars(
    prior: Mapping[str, Mapping[date, Bar]],
    later: Mapping[str, Mapping[date, Bar]],
) -> dict[str, dict[date, Bar]]:
    result = {symbol: dict(series) for symbol, series in prior.items()}
    for symbol, series in later.items():
        target = result.setdefault(symbol, {})
        overlap = set(target).intersection(series)
        if overlap:
            raise EvidenceError(f"partition daily overlap: {symbol} {min(overlap)}")
        target.update(series)
    return result


def _event_measurements(
    series: Mapping[date, Bar],
    signal_day: date,
) -> tuple[Decimal, Decimal, Decimal, Decimal] | None:
    prior_days = tuple(signal_day - timedelta(days=offset) for offset in range(60, 0, -1))
    if signal_day not in series or any(day not in series for day in prior_days):
        return None
    prior = [series[day] for day in prior_days]
    current = series[signal_day]
    if current.quote_volume <= 0 or any(bar.quote_volume <= 0 for bar in prior):
        return None
    intensity_baseline = median_decimal([D(bar.trade_count) / bar.quote_volume for bar in prior])
    trade_baseline = median_decimal([D(bar.trade_count) for bar in prior])
    volume_baseline = median_decimal([bar.quote_volume for bar in prior])
    if intensity_baseline <= 0 or trade_baseline <= 0 or volume_baseline <= 0:
        return None
    current_intensity = D(current.trade_count) / current.quote_volume
    previous = prior[-1]
    previous_intensity = D(previous.trade_count) / previous.quote_volume
    return (
        current_intensity / intensity_baseline,
        previous_intensity / intensity_baseline,
        D(current.trade_count) / trade_baseline,
        current.quote_volume / volume_baseline,
    )


def signal_qualifies(
    series: Mapping[date, Bar],
    signal_day: date,
    threshold: Decimal,
) -> tuple[Decimal, Decimal, Decimal] | None:
    measured = _event_measurements(series, signal_day)
    if measured is None:
        return None
    intensity_multiple, previous_multiple, trade_multiple, volume_multiple = measured
    prior_days = tuple(signal_day - timedelta(days=offset) for offset in range(60, 0, -1))
    median_volume = median_decimal([series[day].quote_volume for day in prior_days])
    if (
        previous_multiple >= threshold
        or intensity_multiple < threshold
        or trade_multiple < D("1.25")
        or volume_multiple < D("0.75")
        or volume_multiple > D("1.25")
        or median_volume < D("10000000")
    ):
        return None
    return intensity_multiple, trade_multiple, volume_multiple


def net_returns(gross: Decimal) -> tuple[Decimal, Decimal, Decimal, Decimal]:
    return (
        gross - D("0.0020"),
        gross - D("0.0030"),
        gross - D("0.0070"),
        gross - D("0.0015"),
    )


def evaluate_trial(
    bars: Mapping[str, Mapping[date, Bar]],
    signal_days: Sequence[date],
    *,
    threshold: Decimal,
) -> tuple[Signal, ...]:
    events = []
    next_allowed: dict[str, date] = {}
    for signal_day in signal_days:
        for symbol in sorted(bars):
            if signal_day < next_allowed.get(symbol, signal_day):
                continue
            series = bars[symbol]
            qualified = signal_qualifies(series, signal_day, threshold)
            if qualified is None:
                continue
            entry_day = signal_day + timedelta(days=1)
            exit_day = signal_day + timedelta(days=3)
            entry = series.get(entry_day)
            exit_bar = series.get(exit_day)
            if entry is None or exit_bar is None:
                raise EvidenceError(f"label open missing after valid event: {symbol} {signal_day}")
            gross = exit_bar.open_price / entry.open_price - D(1)
            public_fee, base, stress, bnb = net_returns(gross)
            intensity_multiple, trade_multiple, volume_multiple = qualified
            events.append(
                Signal(
                    symbol=symbol,
                    signal_day=signal_day,
                    entry_day=entry_day,
                    exit_day=exit_day,
                    threshold=threshold,
                    intensity_multiple=intensity_multiple,
                    trade_count_multiple=trade_multiple,
                    quote_volume_multiple=volume_multiple,
                    gross_return=gross,
                    public_fee_net_return=public_fee,
                    base_net_return=base,
                    stress_net_return=stress,
                    bnb_conditional_net_return=bnb,
                )
            )
            next_allowed[symbol] = signal_day + timedelta(days=4)
    return tuple(events)


def mean_decimal(values: Sequence[Decimal]) -> Decimal | None:
    if not values:
        return None
    return sum(values, D(0)) / D(len(values))


def drawdown_pct(events: Sequence[Signal]) -> Decimal | None:
    if not events:
        return None
    daily: dict[date, list[Decimal]] = defaultdict(list)
    for event in events:
        daily[event.exit_day].append(event.stress_net_return)
    nav = D(1)
    peak = nav
    maximum = D(0)
    for day in sorted(daily):
        day_return = cast(Decimal, mean_decimal(daily[day]))
        nav *= D(1) + day_return
        peak = max(peak, nav)
        if peak > 0:
            maximum = max(maximum, (peak - nav) / peak * D(100))
    return maximum


def block_bootstrap_lower(
    events: Sequence[Signal],
    signal_days: Sequence[date],
    *,
    replicates: int,
    seed: int,
    block_days: int,
    lower_probability: Decimal,
) -> Decimal | None:
    if not events:
        return None
    clustered: dict[date, list[Decimal]] = defaultdict(list)
    for event in events:
        clustered[event.signal_day].append(event.stress_net_return)
    rows = tuple(
        (sum(clustered.get(day, []), D(0)), len(clustered.get(day, []))) for day in signal_days
    )
    if not rows:
        return None
    rng = random.Random(seed)
    estimates = []
    for _ in range(replicates):
        total = D(0)
        count = 0
        consumed = 0
        while consumed < len(rows):
            start = rng.randrange(len(rows))
            take = min(block_days, len(rows) - consumed)
            for offset in range(take):
                subtotal, subcount = rows[(start + offset) % len(rows)]
                total += subtotal
                count += subcount
            consumed += take
        if count == 0:
            raise EvidenceError("bootstrap replicate had no events")
        estimates.append(total / D(count))
    estimates.sort()
    index = min(len(estimates) - 1, int(lower_probability * D(len(estimates))))
    return estimates[index]


def signal_mapping(signal: Signal) -> dict[str, object]:
    return {
        "symbol": signal.symbol,
        "signalDate": signal.signal_day.isoformat(),
        "entryDate": signal.entry_day.isoformat(),
        "exitDate": signal.exit_day.isoformat(),
        "thresholdMultiple": decimal_text(signal.threshold),
        "intensityMultiple": decimal_text(signal.intensity_multiple),
        "tradeCountMultiple": decimal_text(signal.trade_count_multiple),
        "quoteVolumeMultiple": decimal_text(signal.quote_volume_multiple),
        "grossReturn": decimal_text(signal.gross_return),
        "publicScheduleFeeOnlyProxyNetReturn": decimal_text(signal.public_fee_net_return),
        "baseProxyNetReturn": decimal_text(signal.base_net_return),
        "stressProxyNetReturn": decimal_text(signal.stress_net_return),
        "conditionalBnbScenarioNetReturn": decimal_text(signal.bnb_conditional_net_return),
    }


def trial_summary(
    trial_id: str,
    threshold: Decimal,
    events: Sequence[Signal],
    signal_days: Sequence[date],
    protocol: Mapping[str, Any],
    trial_index: int,
) -> dict[str, object]:
    statistics = cast(Mapping[str, Any], protocol["statistics"])
    multiplicity = cast(Mapping[str, Any], statistics["multiplicity"])
    bootstrap = cast(Mapping[str, Any], statistics["blockBootstrap"])
    lower_probability = decimal_value(
        multiplicity["bonferroniOneSidedLowerProbability"],
        "bonferroniOneSidedLowerProbability",
    )
    lcb = block_bootstrap_lower(
        events,
        signal_days,
        replicates=require_int(bootstrap["replicates"], "bootstrap.replicates", 100),
        seed=require_int(bootstrap["seed"], "bootstrap.seed") + trial_index,
        block_days=require_int(bootstrap["blockLengthCalendarDays"], "blockLength", 1),
        lower_probability=lower_probability,
    )
    stress_values = [event.stress_net_return for event in events]
    return {
        "trialId": trial_id,
        "thresholdMultiple": decimal_text(threshold),
        "eventCount": len(events),
        "fillCount": len(events) * 2,
        "distinctSymbolCount": len({event.symbol for event in events}),
        "eventMonthCount": len({event.signal_day.strftime("%Y-%m") for event in events}),
        "meanGrossReturn": _optional_decimal(
            mean_decimal([event.gross_return for event in events])
        ),
        "meanPublicScheduleFeeOnlyProxyNetReturn": _optional_decimal(
            mean_decimal([event.public_fee_net_return for event in events])
        ),
        "meanBaseProxyNetReturn": _optional_decimal(
            mean_decimal([event.base_net_return for event in events])
        ),
        "meanStressProxyNetReturn": _optional_decimal(mean_decimal(stress_values)),
        "meanConditionalBnbScenarioNetReturn": _optional_decimal(
            mean_decimal([event.bnb_conditional_net_return for event in events])
        ),
        "stressBonferroniBlockBootstrapLowerBound": _optional_decimal(lcb),
        "stressDrawdownPct": _optional_decimal(drawdown_pct(events)),
        "events": [signal_mapping(event) for event in events],
    }


def _optional_decimal(value: Decimal | None) -> str | None:
    return decimal_text(value) if value is not None else None


def _trial_gate_decisions(
    trial: Mapping[str, Any],
    protocol: Mapping[str, Any],
    *,
    partition: str,
) -> list[dict[str, object]]:
    gates_root = cast(Mapping[str, Any], protocol["gates"])
    gates = cast(Mapping[str, Any], gates_root[partition])
    event_count = require_int(trial.get("eventCount"), "eventCount")
    symbol_count = require_int(trial.get("distinctSymbolCount"), "distinctSymbolCount")
    month_count = require_int(trial.get("eventMonthCount"), "eventMonthCount")
    mean_stress_raw = trial.get("meanStressProxyNetReturn")
    lcb_raw = trial.get("stressBonferroniBlockBootstrapLowerBound")
    drawdown_raw = trial.get("stressDrawdownPct")
    mean_stress = (
        decimal_value(mean_stress_raw, "meanStress") if mean_stress_raw is not None else None
    )
    lcb = decimal_value(lcb_raw, "lcb") if lcb_raw is not None else None
    drawdown = decimal_value(drawdown_raw, "drawdown") if drawdown_raw is not None else None
    decisions = [
        {
            "gate": "MINIMUM_EVENTS",
            "passed": event_count >= require_int(gates["minimumEvents"], "minimumEvents"),
            "observed": event_count,
            "required": gates["minimumEvents"],
        },
        {
            "gate": "MINIMUM_DISTINCT_SYMBOLS",
            "passed": symbol_count
            >= require_int(gates["minimumDistinctSymbols"], "minimumDistinctSymbols"),
            "observed": symbol_count,
            "required": gates["minimumDistinctSymbols"],
        },
        {
            "gate": "MINIMUM_EVENT_MONTHS",
            "passed": month_count >= require_int(gates["minimumEventMonths"], "minimumEventMonths"),
            "observed": month_count,
            "required": gates["minimumEventMonths"],
        },
        {
            "gate": "STRESS_MEAN_POSITIVE",
            "passed": mean_stress is not None and mean_stress > 0,
            "observed": mean_stress_raw,
            "required": ">0",
        },
        {
            "gate": "MULTIPLICITY_ADJUSTED_BLOCK_BOOTSTRAP_LCB_POSITIVE",
            "passed": lcb is not None and lcb > 0,
            "observed": lcb_raw,
            "required": ">0",
        },
        {
            "gate": "STRESS_DRAWDOWN_BOUNDED",
            "passed": drawdown is not None
            and drawdown <= decimal_value(gates["maximumStressDrawdownPct"], "maxDrawdown"),
            "observed": drawdown_raw,
            "required": f"<={gates['maximumStressDrawdownPct']}",
        },
    ]
    return decisions


def _candidate(trials: Sequence[Mapping[str, Any]]) -> Mapping[str, Any]:
    measurable = [trial for trial in trials if trial.get("meanStressProxyNetReturn") is not None]
    if not measurable:
        raise EvidenceError("no development trial has a stress mean")
    return min(
        measurable,
        key=lambda trial: (
            -decimal_value(trial["meanStressProxyNetReturn"], "meanStress"),
            require_text(trial.get("trialId"), "trialId"),
        ),
    )


def development_result(
    bars: Mapping[str, Mapping[date, Bar]],
    protocol: Mapping[str, Any],
    ledger: Mapping[str, Any],
) -> tuple[dict[str, object], Decimal]:
    calendar = cast(Mapping[str, Any], protocol["calendar"])
    first, last = cast(list[str], calendar["developmentSignalDatesInclusive"])
    signal_days = date_range(date.fromisoformat(first), date.fromisoformat(last))
    raw_trials = cast(list[Mapping[str, Any]], ledger["trials"])
    summaries = []
    for index, row in enumerate(raw_trials):
        threshold = decimal_value(row["thresholdMultiple"], "thresholdMultiple")
        events = evaluate_trial(bars, signal_days, threshold=threshold)
        summaries.append(
            trial_summary(
                require_text(row.get("trialId"), "trialId"),
                threshold,
                events,
                signal_days,
                protocol,
                index,
            )
        )
    selected = _candidate(summaries)
    decisions = _trial_gate_decisions(selected, protocol, partition="development")
    passed = all(require_bool(decision["passed"], "gate.passed") for decision in decisions)
    payload: dict[str, object] = {
        "schema": "VG11DevelopmentResultV1",
        "state": "DEVELOPMENT_GATES_PASS" if passed else "DEVELOPMENT_GATES_FAIL",
        "trialCountDeclared": len(raw_trials),
        "trialCountObserved": len(summaries),
        "candidateSelection": {
            "rule": "HIGHEST_STRESS_NET_MEAN_THEN_TRIAL_ID_ASC",
            "trialId": selected["trialId"],
            "thresholdMultiple": selected["thresholdMultiple"],
        },
        "candidateGates": decisions,
        "trials": summaries,
        "pricesUsedOnlyForLabels": True,
        "selectionInputs": ["NUMBER_OF_TRADES", "QUOTE_ASSET_VOLUME"],
        "pbo": None,
        "deflatedSharpeRatio": None,
        "capitalAuthority": "NONE",
    }
    return payload, decimal_value(selected["thresholdMultiple"], "selectedThreshold")


def holdout_result(
    bars: Mapping[str, Mapping[date, Bar]],
    protocol: Mapping[str, Any],
    *,
    trial_id: str,
    threshold: Decimal,
) -> dict[str, object]:
    calendar = cast(Mapping[str, Any], protocol["calendar"])
    first, last = cast(list[str], calendar["holdoutSignalDatesInclusive"])
    signal_days = date_range(date.fromisoformat(first), date.fromisoformat(last))
    events = evaluate_trial(bars, signal_days, threshold=threshold)
    summary = trial_summary(trial_id, threshold, events, signal_days, protocol, 100)
    decisions = _trial_gate_decisions(summary, protocol, partition="holdout")
    passed = all(require_bool(decision["passed"], "gate.passed") for decision in decisions)
    return {
        "schema": "VG11HoldoutResultV1",
        "state": "HOLDOUT_GATES_PASS" if passed else "HOLDOUT_GATES_FAIL",
        "fixedCandidateTrialId": trial_id,
        "fixedThresholdMultiple": decimal_text(threshold),
        "candidateGates": decisions,
        "trial": summary,
        "trialCountObserved": 1,
        "capitalAuthority": "NONE",
    }


def _planned_partition_count(
    acquisition: Mapping[str, Any],
    universe: set[str],
    months: set[str],
) -> int:
    rows = acquisition.get("artifactPairs")
    if not isinstance(rows, list):
        raise EvidenceError("artifactPairs missing")
    return sum(
        1
        for row in rows
        if isinstance(row, dict) and row.get("symbol") in universe and row.get("month") in months
    )


def source_receipt(
    *,
    state: str,
    discovery: Mapping[str, Any],
    acquisition: Mapping[str, Any],
    counts: OpenCounts,
    development_planned: int,
    holdout_planned: int,
    failure: str | None,
) -> dict[str, object]:
    universe = cast(Mapping[str, Any], discovery["universe"])
    return {
        "schema": "VG11SourceReceiptV1",
        "state": state,
        "sharedReadOnlyRoot": os.fspath(SHARED_ROOT),
        "sharedReadOnlySha256": SHARED_PINS,
        "sharedMarkerAuthorityForVG11": "NONE_PROVENANCE_ONLY",
        "universePrefixCount": universe["count"],
        "universeSha256": universe["sha256"],
        "developmentArchiveBodiesPlanned": development_planned,
        "developmentArchiveBodiesOpened": counts.development,
        "holdoutArchiveBodiesPlanned": holdout_planned,
        "holdoutArchiveBodiesOpened": counts.holdout,
        "allOpenedArchivesAuthenticatedAgainstManifestAndSiblingSidecar": failure is None,
        "failure": failure,
        "networkCalls": 0,
    }


def n3_projection(
    measurement: str,
    *,
    trial_observed: int,
    research_verdict: str,
) -> dict[str, object]:
    return {
        "schema": "VG11N3SuccessorProjectionV1",
        "compatibility": "SUCCESSOR_REGISTRY_CONTRACT_ONLY_NOT_CURRENT_N3_ADAPTER",
        "authority": "NONE",
        "capitalVerdict": "NO_GO",
        "researchVerdict": research_verdict,
        "measurementStatus": measurement,
        "trialCountDeclared": 3,
        "trialCountObserved": trial_observed,
        "multipleTestingFamilySize": 3,
        "pbo": None,
        "deflatedSharpeRatio": None,
        "acceptedGlobalTest": None,
        "accountEffectiveFeeBpsPerFill": None,
        "makerEntryEvidence": None,
        "completeRealizedCosts": None,
        "executableCapacityUsd": None,
        "historicalFilterEligibility": None,
        "regimeCoverage": None,
        "realizedSlippageImpact": None,
        "privateOrAccountEvidenceUsed": False,
    }


def final_result(
    *,
    measurement: str,
    research_verdict: str,
    state: str,
    freeze_digest: str,
    source_digest: str,
    development_digest: str | None,
    holdout_digest: str | None,
    trial_observed: int,
    failure_phase: str | None,
    failure_reason: str | None,
    counts: OpenCounts,
) -> dict[str, object]:
    return {
        "schema": "VG11TradeNotionalIntensityResultV1",
        "state": state,
        "measurementVerdict": measurement,
        "researchVerdict": research_verdict,
        "capitalVerdict": "NO_GO",
        "capitalAuthority": "NONE",
        "executionAuthority": "NONE",
        "bindings": {
            "protocolFreezeSha256": freeze_digest,
            "sourceReceiptSha256": source_digest,
            "developmentResultSha256": development_digest,
            "holdoutResultSha256": holdout_digest,
        },
        "lifecycle": {
            "failurePhase": failure_phase,
            "failureReason": failure_reason,
            "developmentArchiveBodiesOpened": counts.development,
            "holdoutArchiveBodiesOpened": counts.holdout,
            "networkCalls": 0,
            "rerunAllowed": False,
        },
        "unknowns": {
            "accountEffectiveFees": None,
            "historicalFilters": None,
            "slippage": None,
            "impact": None,
            "capacity": None,
        },
        "limitations": [
            "ACCOUNT_EFFECTIVE_FEES_UNKNOWN",
            "HISTORICAL_FILTERS_UNKNOWN_CURRENT_FILTERS_NOT_HISTORICAL",
            "SLIPPAGE_IMPACT_CAPACITY_UNMEASURED",
            "USDT_APPROX_USD_RESEARCH_NORMALIZATION_NOT_GUARANTEED_PARITY",
            "V_G9_V_G10_V_G13_V_G14_DISTINCTNESS_NOT_CERTIFIABLE_AT_FREEZE",
            "V_G12_ONLY_OBSERVED_UNCOMMITTED_DRAFT_CROSS_DISTINCT_NOT_ACCEPTED_GIT",
            "NO_FULL_ACTIVE_LANE_DISTINCTNESS_CERTIFICATION",
        ],
        "n3Projection": n3_projection(
            measurement, trial_observed=trial_observed, research_verdict=research_verdict
        ),
    }


def verdict_payload(result: Mapping[str, Any]) -> dict[str, object]:
    return {
        "schema": "VG11VerdictV1",
        "state": result["state"],
        "measurementVerdict": result["measurementVerdict"],
        "researchVerdict": result["researchVerdict"],
        "capitalVerdict": "NO_GO",
        "capitalAuthority": "NONE",
        "executionAuthority": "NONE",
        "holdoutArchiveBodiesOpened": cast(Mapping[str, Any], result["lifecycle"])[
            "holdoutArchiveBodiesOpened"
        ],
        "consumer": "N3_SUCCESSOR_REGISTRY_ADAPTER_ONLY",
    }


def _emit_terminal(
    *,
    result: dict[str, object],
    source: dict[str, object],
    development: dict[str, object] | None,
    holdout: dict[str, object] | None,
) -> dict[str, object]:
    if not lexists(HERE / "source.receipt.v1.json"):
        emit_json(HERE / "source.receipt.v1.json", source)
    if development is not None and not lexists(HERE / "development.result.v1.json"):
        emit_json(HERE / "development.result.v1.json", development)
    if holdout is not None and not lexists(HERE / "holdout.result.v1.json"):
        emit_json(HERE / "holdout.result.v1.json", holdout)
    emit_json(HERE / "result.v1.json", result)
    emit_json(HERE / "verdict.v1.json", verdict_payload(result))
    write_checksums()
    return result


def run_experiment() -> dict[str, object]:
    freeze_payload, freeze_digest = _load_freeze()
    official, protocol, source_plan, ledger = _static_payloads()
    del official
    discovery, acquisition, _ = _validate_shared_metadata()
    for name in (
        "development-run-marker.v1.json",
        "holdout-authorization-marker.v1.json",
        "holdout-evaluation-marker.v1.json",
    ):
        if lexists(STATE_ROOT / name):
            raise EvidenceError(f"run already consumed or partial marker present: {name}")
    for name in (
        "source.receipt.v1.json",
        "development.result.v1.json",
        "holdout.authorization.v1.json",
        "holdout.result.v1.json",
        "result.v1.json",
        "verdict.v1.json",
        "SHA256SUMS",
    ):
        if lexists(HERE / name):
            raise EvidenceError(f"result surface already exists: {name}")
    started_at = utc_now()
    marker = {
        "schema": "VG11DevelopmentRunMarkerV1",
        "state": "SOLE_DEVELOPMENT_RUN_CONSUMED",
        "startedAtUtc": started_at,
        "protocolFreezeSha256": freeze_digest,
        "protocolSha256": freeze_payload["protocolSha256"],
        "evaluatorSha256": freeze_payload["evaluatorSha256"],
        "allowedRunCount": 1,
        "consumedRunCount": 1,
        "networkCalls": 0,
    }
    emit_json(STATE_ROOT / "development-run-marker.v1.json", marker, mode=0o600)
    counts = OpenCounts()
    development: dict[str, object] | None = None
    holdout: dict[str, object] | None = None
    failure_phase = "DEVELOPMENT_SOURCE_OPEN"
    universe_list = cast(list[str], cast(Mapping[str, Any], discovery["universe"])["symbols"])
    universe = set(universe_list)
    development_months = set(
        _month_values(*cast(list[str], source_plan["developmentArchiveMonths"]))
    )
    holdout_months = set(_month_values(*cast(list[str], source_plan["holdoutArchiveMonths"])))
    development_planned = _planned_partition_count(acquisition, universe, development_months)
    holdout_planned = _planned_partition_count(acquisition, universe, holdout_months)
    try:
        development_bars, observed_development_planned = load_partition(
            acquisition,
            universe_list,
            sorted(development_months),
            partition="development",
            counts=counts,
        )
        if observed_development_planned != development_planned:
            raise EvidenceError("development planned/open traversal mismatch")
        failure_phase = "DEVELOPMENT_EVALUATION"
        development, threshold = development_result(development_bars, protocol, ledger)
        development_digest = emit_json(HERE / "development.result.v1.json", development)
        source = source_receipt(
            state="DEVELOPMENT_AUTHENTICATED",
            discovery=discovery,
            acquisition=acquisition,
            counts=counts,
            development_planned=development_planned,
            holdout_planned=holdout_planned,
            failure=None,
        )
        if development["state"] != "DEVELOPMENT_GATES_PASS":
            source_digest = emit_json(HERE / "source.receipt.v1.json", source)
            result = final_result(
                measurement="MEASURED",
                research_verdict="NO_GO",
                state="TERMINAL_DEVELOPMENT_NO_GO_HOLDOUT_UNTOUCHED",
                freeze_digest=freeze_digest,
                source_digest=source_digest,
                development_digest=development_digest,
                holdout_digest=None,
                trial_observed=3,
                failure_phase=None,
                failure_reason=None,
                counts=counts,
            )
            return _emit_terminal(
                result=result, source=source, development=development, holdout=None
            )
        candidate = cast(Mapping[str, Any], development["candidateSelection"])
        authorization = {
            "schema": "VG11HoldoutAuthorizationV1",
            "state": "HOLDOUT_AUTHORIZED_AFTER_DEVELOPMENT_GATES_PASS",
            "authorizedAtUtc": utc_now(),
            "protocolFreezeSha256": freeze_digest,
            "developmentResultSha256": development_digest,
            "fixedCandidateTrialId": candidate["trialId"],
            "fixedThresholdMultiple": candidate["thresholdMultiple"],
            "allowedHoldoutEvaluationCount": 1,
            "networkCalls": 0,
        }
        authorization_digest = emit_json(HERE / "holdout.authorization.v1.json", authorization)
        external_authorization = dict(authorization)
        external_authorization["authorizationArtifactSha256"] = authorization_digest
        emit_json(
            STATE_ROOT / "holdout-authorization-marker.v1.json",
            external_authorization,
            mode=0o600,
        )
        evaluation_marker = {
            "schema": "VG11HoldoutEvaluationMarkerV1",
            "state": "SOLE_HOLDOUT_EVALUATION_CONSUMED_BEFORE_BODY_OPEN",
            "startedAtUtc": utc_now(),
            "authorizationArtifactSha256": authorization_digest,
            "developmentResultSha256": development_digest,
            "fixedCandidateTrialId": candidate["trialId"],
            "fixedThresholdMultiple": candidate["thresholdMultiple"],
            "allowedEvaluationCount": 1,
            "consumedEvaluationCount": 1,
            "networkCalls": 0,
        }
        emit_json(
            STATE_ROOT / "holdout-evaluation-marker.v1.json",
            evaluation_marker,
            mode=0o600,
        )
        failure_phase = "HOLDOUT_SOURCE_OPEN"
        holdout_bars, observed_holdout_planned = load_partition(
            acquisition,
            universe_list,
            sorted(holdout_months),
            partition="holdout",
            counts=counts,
        )
        if observed_holdout_planned != holdout_planned:
            raise EvidenceError("holdout planned/open traversal mismatch")
        failure_phase = "HOLDOUT_EVALUATION"
        all_bars = merge_bars(development_bars, holdout_bars)
        holdout = holdout_result(
            all_bars,
            protocol,
            trial_id=require_text(candidate.get("trialId"), "candidate.trialId"),
            threshold=threshold,
        )
        holdout_digest = emit_json(HERE / "holdout.result.v1.json", holdout)
        source = source_receipt(
            state="DEVELOPMENT_AND_HOLDOUT_AUTHENTICATED",
            discovery=discovery,
            acquisition=acquisition,
            counts=counts,
            development_planned=development_planned,
            holdout_planned=holdout_planned,
            failure=None,
        )
        source_digest = emit_json(HERE / "source.receipt.v1.json", source)
        research_verdict = "GO" if holdout["state"] == "HOLDOUT_GATES_PASS" else "NO_GO"
        result = final_result(
            measurement="MEASURED",
            research_verdict=research_verdict,
            state=(
                "TERMINAL_RESEARCH_GO_CAPITAL_AUTHORITY_NONE"
                if research_verdict == "GO"
                else "TERMINAL_HOLDOUT_NO_GO"
            ),
            freeze_digest=freeze_digest,
            source_digest=source_digest,
            development_digest=development_digest,
            holdout_digest=holdout_digest,
            trial_observed=3,
            failure_phase=None,
            failure_reason=None,
            counts=counts,
        )
        return _emit_terminal(
            result=result,
            source=source,
            development=development,
            holdout=holdout,
        )
    except BaseException as error:
        reason = f"{type(error).__name__}:{error}"
        source = source_receipt(
            state="TERMINAL_SOURCE_OR_VALIDITY_FAILURE",
            discovery=discovery,
            acquisition=acquisition,
            counts=counts,
            development_planned=development_planned,
            holdout_planned=holdout_planned,
            failure=reason,
        )
        source_digest = (
            sha256_path(HERE / "source.receipt.v1.json")
            if lexists(HERE / "source.receipt.v1.json")
            else sha256_bytes(canonical_bytes(source))
        )
        terminal_development_digest: str | None = (
            sha256_path(HERE / "development.result.v1.json")
            if lexists(HERE / "development.result.v1.json")
            else None
        )
        terminal_holdout_digest: str | None = (
            sha256_path(HERE / "holdout.result.v1.json")
            if lexists(HERE / "holdout.result.v1.json")
            else None
        )
        result = final_result(
            measurement="UNMEASURED",
            research_verdict="NO_GO",
            state="TERMINAL_UNMEASURED_NO_REPAIR_OR_RERUN",
            freeze_digest=freeze_digest,
            source_digest=source_digest,
            development_digest=terminal_development_digest,
            holdout_digest=terminal_holdout_digest,
            trial_observed=3 if development is not None else 0,
            failure_phase=failure_phase,
            failure_reason=reason,
            counts=counts,
        )
        return _emit_terminal(
            result=result, source=source, development=development, holdout=holdout
        )


def write_checksums() -> None:
    if lexists(HERE / "SHA256SUMS"):
        raise EvidenceError("SHA256SUMS already exists")
    allowed = set(STATIC_FILES) | set(GENERATED_FILES)
    actual = set()
    for path in HERE.iterdir():
        if path.name == "SHA256SUMS":
            continue
        if path.is_symlink() or not path.is_file():
            raise EvidenceError(f"unexpected non-regular package entry: {path.name}")
        actual.add(path.name)
    if not actual.issubset(allowed) or not set(STATIC_FILES).issubset(actual):
        raise EvidenceError(f"checksum package surface invalid: {sorted(actual)}")
    if "protocol.freeze.v1.json" not in actual or "result.v1.json" not in actual:
        raise EvidenceError("checksum closure requires freeze and terminal result")
    lines = "".join(f"{sha256_path(HERE / name)}  {name}\n" for name in sorted(actual))
    exclusive_write(HERE / "SHA256SUMS", lines.encode("ascii"), mode=0o644)


def _checksum_inventory() -> set[str]:
    raw = safe_regular(HERE / "SHA256SUMS").read_text(encoding="ascii")
    seen: set[str] = set()
    for line in raw.splitlines():
        match = re.fullmatch(r"([0-9a-f]{64})  ([A-Za-z0-9_.-]+)", line)
        if match is None:
            raise EvidenceError("SHA256SUMS line malformed")
        digest, name = match.groups()
        if name in seen or name == "SHA256SUMS":
            raise EvidenceError("SHA256SUMS duplicate/self entry")
        if sha256_path(HERE / name) != digest:
            raise EvidenceError(f"checksum mismatch: {name}")
        seen.add(name)
    actual = {
        path.name
        for path in HERE.iterdir()
        if path.name != "SHA256SUMS" and path.is_file() and not path.is_symlink()
    }
    if seen != actual:
        raise EvidenceError("SHA256SUMS is not a closed package inventory")
    if any(path.is_symlink() or not path.is_file() for path in HERE.iterdir()):
        raise EvidenceError("package contains non-regular or symlink entry")
    return seen


def validate_result_semantics(
    result: Mapping[str, Any],
    verdict: Mapping[str, Any],
    source: Mapping[str, Any],
    development: Mapping[str, Any] | None,
    holdout: Mapping[str, Any] | None,
) -> None:
    if result.get("schema") != "VG11TradeNotionalIntensityResultV1":
        raise EvidenceError("result schema mismatch")
    if verdict.get("schema") != "VG11VerdictV1":
        raise EvidenceError("verdict schema mismatch")
    if source.get("schema") != "VG11SourceReceiptV1":
        raise EvidenceError("source receipt schema mismatch")
    if (
        result.get("capitalVerdict") != "NO_GO"
        or result.get("capitalAuthority") != "NONE"
        or result.get("executionAuthority") != "NONE"
    ):
        raise EvidenceError("result authority widened")
    for field in ("state", "measurementVerdict", "researchVerdict"):
        if verdict.get(field) != result.get(field):
            raise EvidenceError(f"verdict/result mismatch: {field}")
    lifecycle = result.get("lifecycle")
    n3 = result.get("n3Projection")
    bindings = result.get("bindings")
    if (
        not isinstance(lifecycle, dict)
        or not isinstance(n3, dict)
        or not isinstance(bindings, dict)
    ):
        raise EvidenceError("result structured contracts missing")
    if lifecycle.get("networkCalls") != 0 or lifecycle.get("rerunAllowed") is not False:
        raise EvidenceError("run-control semantics invalid")
    if n3.get("authority") != "NONE" or n3.get("capitalVerdict") != "NO_GO":
        raise EvidenceError("N3 projection authority widened")
    for field in (
        "pbo",
        "deflatedSharpeRatio",
        "acceptedGlobalTest",
        "accountEffectiveFeeBpsPerFill",
        "makerEntryEvidence",
        "completeRealizedCosts",
        "executableCapacityUsd",
        "historicalFilterEligibility",
        "regimeCoverage",
        "realizedSlippageImpact",
    ):
        if n3.get(field) is not None:
            raise EvidenceError(f"N3 unknown must stay null: {field}")
    if n3.get("trialCountDeclared") != 3 or n3.get("multipleTestingFamilySize") != 3:
        raise EvidenceError("N3 declared trial family mismatch")
    measurement = result.get("measurementVerdict")
    holdout_opened = require_int(lifecycle.get("holdoutArchiveBodiesOpened"), "holdoutOpened")
    if measurement == "MEASURED":
        if development is None or development.get("trialCountObserved") != 3:
            raise EvidenceError("measured result requires exact development family")
        if n3.get("trialCountObserved") != 3:
            raise EvidenceError("measured N3 observed trial count mismatch")
        if development.get("pbo") is not None or development.get("deflatedSharpeRatio") is not None:
            raise EvidenceError("unrun development diagnostics must stay null")
        raw_trials = development.get("trials")
        if not isinstance(raw_trials, list) or len(raw_trials) != 3:
            raise EvidenceError("development result must retain exactly three trial rows")
        trial_rows = []
        for raw_trial in raw_trials:
            if not isinstance(raw_trial, dict):
                raise EvidenceError("development trial row malformed")
            event_count = require_int(raw_trial.get("eventCount"), "trial.eventCount")
            if raw_trial.get("fillCount") != event_count * 2:
                raise EvidenceError("development fill/event identity mismatch")
            events = raw_trial.get("events")
            if not isinstance(events, list) or len(events) != event_count:
                raise EvidenceError("development event inventory mismatch")
            for field in (
                "meanGrossReturn",
                "meanPublicScheduleFeeOnlyProxyNetReturn",
                "meanBaseProxyNetReturn",
                "meanStressProxyNetReturn",
                "meanConditionalBnbScenarioNetReturn",
                "stressBonferroniBlockBootstrapLowerBound",
                "stressDrawdownPct",
            ):
                value = raw_trial.get(field)
                if value is not None:
                    decimal_value(value, f"trial.{field}")
            trial_rows.append(cast(Mapping[str, Any], raw_trial))
        if [trial["trialId"] for trial in trial_rows] != [
            "VG11-T1-1P5",
            "VG11-T2-2P0",
            "VG11-T3-3P0",
        ] or [trial["thresholdMultiple"] for trial in trial_rows] != ["1.5", "2", "3"]:
            raise EvidenceError("development trial identity/threshold family mismatch")
        selected = _candidate(trial_rows)
        candidate = development.get("candidateSelection")
        if (
            not isinstance(candidate, dict)
            or candidate.get("trialId") != selected.get("trialId")
            or candidate.get("thresholdMultiple") != selected.get("thresholdMultiple")
        ):
            raise EvidenceError("development candidate selection is not reproducible")
        decisions = development.get("candidateGates")
        if not isinstance(decisions, list) or not decisions:
            raise EvidenceError("development gate decisions missing")
        gates_passed = all(
            isinstance(decision, dict) and decision.get("passed") is True for decision in decisions
        )
        expected_development_state = (
            "DEVELOPMENT_GATES_PASS" if gates_passed else "DEVELOPMENT_GATES_FAIL"
        )
        if development.get("state") != expected_development_state:
            raise EvidenceError("development state/gate relationship mismatch")
    elif measurement == "UNMEASURED":
        if result.get("researchVerdict") != "NO_GO":
            raise EvidenceError("unmeasured result cannot be research GO")
    else:
        raise EvidenceError("measurement verdict invalid")
    if result.get("state") == "TERMINAL_DEVELOPMENT_NO_GO_HOLDOUT_UNTOUCHED":
        if holdout is not None or holdout_opened != 0:
            raise EvidenceError("development failure must leave holdout untouched")
        for name in (
            "holdout.authorization.v1.json",
            "holdout.result.v1.json",
        ):
            if lexists(HERE / name):
                raise EvidenceError("holdout repo artifact exists after development failure")
        for name in (
            "holdout-authorization-marker.v1.json",
            "holdout-evaluation-marker.v1.json",
        ):
            if lexists(STATE_ROOT / name):
                raise EvidenceError("holdout state marker exists after development failure")
    if holdout is not None and holdout_opened == 0:
        raise EvidenceError("holdout result exists without opened holdout bodies")
    if holdout is not None:
        if development is None or development.get("state") != "DEVELOPMENT_GATES_PASS":
            raise EvidenceError("holdout result requires passing development")
        candidate = cast(Mapping[str, Any], development["candidateSelection"])
        if holdout.get("fixedCandidateTrialId") != candidate.get("trialId") or holdout.get(
            "fixedThresholdMultiple"
        ) != candidate.get("thresholdMultiple"):
            raise EvidenceError("holdout did not preserve fixed development candidate")
        holdout_decisions = holdout.get("candidateGates")
        if not isinstance(holdout_decisions, list) or not holdout_decisions:
            raise EvidenceError("holdout gate decisions missing")
        holdout_passed = all(
            isinstance(decision, dict) and decision.get("passed") is True
            for decision in holdout_decisions
        )
        expected_holdout_state = "HOLDOUT_GATES_PASS" if holdout_passed else "HOLDOUT_GATES_FAIL"
        if holdout.get("state") != expected_holdout_state:
            raise EvidenceError("holdout state/gate relationship mismatch")
        if measurement == "MEASURED":
            expected_result_state = (
                "TERMINAL_RESEARCH_GO_CAPITAL_AUTHORITY_NONE"
                if holdout_passed
                else "TERMINAL_HOLDOUT_NO_GO"
            )
            expected_research_verdict = "GO" if holdout_passed else "NO_GO"
            if (
                result.get("state") != expected_result_state
                or result.get("researchVerdict") != expected_research_verdict
            ):
                raise EvidenceError("terminal result/holdout gate relationship mismatch")
        authorization, _ = load_json(HERE / "holdout.authorization.v1.json")
        authorization_digest = sha256_path(HERE / "holdout.authorization.v1.json")
        external_authorization, _ = load_json(STATE_ROOT / "holdout-authorization-marker.v1.json")
        evaluation_marker, _ = load_json(STATE_ROOT / "holdout-evaluation-marker.v1.json")
        if (
            authorization.get("developmentResultSha256")
            != sha256_path(HERE / "development.result.v1.json")
            or external_authorization.get("authorizationArtifactSha256") != authorization_digest
            or evaluation_marker.get("authorizationArtifactSha256") != authorization_digest
            or evaluation_marker.get("fixedCandidateTrialId") != candidate.get("trialId")
            or evaluation_marker.get("fixedThresholdMultiple") != candidate.get("thresholdMultiple")
        ):
            raise EvidenceError("holdout authorization/evaluation binding mismatch")
        for marker_name in (
            "holdout-authorization-marker.v1.json",
            "holdout-evaluation-marker.v1.json",
        ):
            if stat.S_IMODE((STATE_ROOT / marker_name).stat().st_mode) != 0o600:
                raise EvidenceError(f"holdout marker mode must be 0600: {marker_name}")
    if source.get("holdoutArchiveBodiesOpened") != holdout_opened:
        raise EvidenceError("source/result holdout count mismatch")


def verify() -> dict[str, object]:
    inventory = _checksum_inventory()
    _static_payloads()
    freeze_payload, freeze_digest = _load_freeze()
    del freeze_payload
    source, _ = load_json(HERE / "source.receipt.v1.json")
    result, _ = load_json(HERE / "result.v1.json")
    verdict, _ = load_json(HERE / "verdict.v1.json")
    development = (
        load_json(HERE / "development.result.v1.json")[0]
        if lexists(HERE / "development.result.v1.json")
        else None
    )
    holdout = (
        load_json(HERE / "holdout.result.v1.json")[0]
        if lexists(HERE / "holdout.result.v1.json")
        else None
    )
    validate_result_semantics(result, verdict, source, development, holdout)
    bindings = cast(Mapping[str, Any], result["bindings"])
    if bindings.get("protocolFreezeSha256") != freeze_digest:
        raise EvidenceError("result/freeze binding mismatch")
    if bindings.get("sourceReceiptSha256") != sha256_path(HERE / "source.receipt.v1.json"):
        raise EvidenceError("result/source binding mismatch")
    if development is not None and bindings.get("developmentResultSha256") != sha256_path(
        HERE / "development.result.v1.json"
    ):
        raise EvidenceError("result/development binding mismatch")
    if holdout is not None and bindings.get("holdoutResultSha256") != sha256_path(
        HERE / "holdout.result.v1.json"
    ):
        raise EvidenceError("result/holdout binding mismatch")
    for marker_name in ("freeze-marker.v1.json", "development-run-marker.v1.json"):
        marker_path = STATE_ROOT / marker_name
        safe_regular(marker_path)
        if stat.S_IMODE(marker_path.stat().st_mode) != 0o600:
            raise EvidenceError(f"marker mode must be 0600: {marker_name}")
    return {
        "schema": "VG11VerificationReportV1",
        "state": "VERIFIED_NETWORK_FREE_NO_OUTCOME_RECOMPUTATION",
        "fileCountExcludingChecksumManifest": len(inventory),
        "measurementVerdict": result["measurementVerdict"],
        "researchVerdict": result["researchVerdict"],
        "capitalAuthority": "NONE",
        "developmentArchiveBodiesOpened": cast(Mapping[str, Any], result["lifecycle"])[
            "developmentArchiveBodiesOpened"
        ],
        "holdoutArchiveBodiesOpened": cast(Mapping[str, Any], result["lifecycle"])[
            "holdoutArchiveBodiesOpened"
        ],
        "networkCalls": 0,
        "outcomesRecomputed": False,
    }


def report() -> dict[str, object]:
    verification = verify()
    result, _ = load_json(HERE / "result.v1.json")
    verdict, _ = load_json(HERE / "verdict.v1.json")
    source, _ = load_json(HERE / "source.receipt.v1.json")
    return {
        "schema": "VG11HumanReportV1",
        "verification": verification["state"],
        "measurementVerdict": verdict["measurementVerdict"],
        "researchVerdict": verdict["researchVerdict"],
        "capitalVerdict": "NO_GO",
        "capitalAuthority": "NONE",
        "executionAuthority": "NONE",
        "developmentArchiveBodiesOpened": source["developmentArchiveBodiesOpened"],
        "holdoutArchiveBodiesOpened": source["holdoutArchiveBodiesOpened"],
        "failurePhase": cast(Mapping[str, Any], result["lifecycle"])["failurePhase"],
        "failureReason": cast(Mapping[str, Any], result["lifecycle"])["failureReason"],
        "n3Compatibility": cast(Mapping[str, Any], result["n3Projection"])["compatibility"],
        "networkCalls": 0,
    }


def _print_json(value: object, stream: TextIO = sys.stdout) -> None:
    stream.write(canonical_bytes(value).decode("utf-8"))


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "command",
        choices=("preflight", "freeze", "run", "verify", "report"),
    )
    args = parser.parse_args(argv)
    try:
        if args.command == "preflight":
            value = preflight()
        elif args.command == "freeze":
            value = freeze()
        elif args.command == "run":
            value = run_experiment()
        elif args.command == "verify":
            value = verify()
        else:
            value = report()
        _print_json(value)
        return 0
    except EvidenceError as error:
        sys.stderr.write(f"VG11_ERROR:{error}\n")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
